#!/usr/bin/env python3
"""
Build a FuelSphere seed workbook for FLIGHT_SCHEDULE and FLIGHT_DISPATCH
from the JetBlue ADS-B extract (JetBlue_flights_2026-09-24_to_2026-09-26.xlsx).

    python3 docs/test-data/jetblue/build_seed_workbook.py

Deterministic: every synthetic value is drawn from a hash of the flight leg ID,
so re-running produces the same workbook byte-for-byte in content.

Every value in the output is one of four kinds, stated per field on the
Field_Gap_Analysis sheet:
  SOURCE     taken from the ADS-B extract as-is
  INFERRED   recovered from the extract (tail rotation, registration series)
  DERIVED    computed from SOURCE/INFERRED values and master data by a stated rule
  SYNTHETIC  invented for test purposes. NOT real JetBlue data
Every seeded row carries created_by = SEED_B6_ADSB so it can be found and removed.
"""
import datetime as dt
import hashlib
import json
import math
import os
import uuid
from collections import Counter, defaultdict
from zoneinfo import ZoneInfo

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SRC = os.path.join(HERE, 'JetBlue_flights_2026-09-24_to_2026-09-26.xlsx')
OUT = os.path.join(HERE, 'JetBlue_FuelSphere_Seed_2026-09-24_to_26.xlsx')
AIRPORTS = json.load(open(os.path.join(HERE, 'airports_reference.json')))

SEED_USER = 'SEED_B6_ADSB'
SEED_TS = '2026-09-23T00:00:00Z'
NS = uuid.UUID('6b1e2f8a-0b6e-4c1d-9a5e-b6b6b6b6b6b6')
UTC = dt.timezone.utc
GST = dt.timezone(dt.timedelta(hours=4))   # the *_gst columns are on a UTC+4 clock


def uid(*parts):
    return str(uuid.uuid5(NS, '|'.join(map(str, parts))))


def h(key, salt=''):
    """Stable 0..1 draw for a key."""
    return int(hashlib.md5(f'{salt}|{key}'.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


def pick(key, salt, seq):
    return seq[int(h(key, salt) * len(seq)) % len(seq)]


def iso(t):
    return t.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%SZ') if t else None


def iso_off(t, tz):
    if not t:
        return None
    s = t.astimezone(tz).strftime('%Y-%m-%dT%H:%M:%S%z')
    return s[:-2] + ':' + s[-2:]


def floor5(t):
    return t.replace(second=0, microsecond=0) - dt.timedelta(minutes=t.minute % 5)


def gc_km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a['lat'], a['lon'], b['lat'], b['lon']))
    x = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(x))


def wall(t, tz):
    """Wall-clock time in tz WITHOUT an offset. HANA's SECONDDATE stores no zone, and an
    offset in a CSV value is a load risk there that SQLite never reports."""
    return t.astimezone(tz).strftime('%Y-%m-%dT%H:%M:%S') if t else None


def bearing(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a['lat'], a['lon'], b['lat'], b['lon']))
    y = math.sin(lo2 - lo1) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(lo2 - lo1)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def flight_level(km, eastbound, ceiling, key):
    """Target by sector length, then the FAA semicircular rule: eastbound odd, westbound even."""
    target = 240 if km < 300 else 300 if km < 600 else 340 if km < 1200 else 360 if km < 2500 else 380
    target += 10 * (int(h(key, 'flv') * 3) - 1)
    levels = [l for l in range(230, ceiling + 1, 10) if ((l // 10) % 2 == 1) == eastbound]
    return min(levels, key=lambda l: (abs(l - target), l))


def r2(x):
    return None if x is None else round(x, 2)


# ---------------------------------------------------------------------------
# Master data already in the repository
# ---------------------------------------------------------------------------
def read_csv(name):
    p = os.path.join(REPO, 'db', 'data', f'fuelsphere-{name}.csv')
    lines = open(p, encoding='utf-8').read().splitlines()
    hdr = lines[0].split(';')
    return [dict(zip(hdr, l.split(';'))) for l in lines[1:] if l.strip()]


existing_airports = {r['iata_code']: r for r in read_csv('MASTER_AIRPORTS')}
existing_countries = {r['land1'] for r in read_csv('T005_COUNTRY')}
aircraft_master = {r['type_code']: r for r in read_csv('AIRCRAFT_MASTER')}
existing_regs = {r['registration'] for r in read_csv('AIRCRAFT_REGISTRATIONS')}

# ---------------------------------------------------------------------------
# Reference rules
# ---------------------------------------------------------------------------
# Source "Aircraft Type" -> AIRCRAFT_MASTER.type_code
TYPE_MAP = {'A220-300': 'A223', 'A320': 'A320', 'A321': 'A321', 'A321neo': 'A21N'}
# JetBlue registration series, used only where the source says "Unknown"
def type_from_registration(reg):
    if reg.startswith('N3') and reg.endswith('J'):
        return 'A223'
    if reg.startswith(('N2', 'N4')) and reg.endswith('J'):
        return 'A21N'
    if reg.endswith('JB'):
        return 'A320'
    if reg.endswith('JT'):
        return 'A321'
    return None

NEW_TYPE_A21N = {  # added to AIRCRAFT_MASTER; published-order-of-magnitude figures
    'type_code': 'A21N', 'aircraft_model': 'Airbus A321neo', 'manufacturer_code': 'AB',
    'fuel_capacity_kg': '26000.00', 'mtow_kg': '97000.00', 'cruise_burn_kgph': '2200.00',
}
SEATS = {'A223': 140, 'A320': 162, 'A321': 200, 'A21N': 200}
DOW = {'A223': 38000, 'A320': 42600, 'A321': 48500, 'A21N': 50500}
APU = {'A223': 65, 'A320': 110, 'A321': 110, 'A21N': 110}
TAXI_KG_MIN = {'A223': 9, 'A320': 11, 'A321': 13, 'A21N': 11}
MAX_FL = {'A223': 410, 'A320': 390, 'A321': 390, 'A21N': 390}


def cruise_burn(t):
    return float(aircraft_master[t]['cruise_burn_kgph']) if t in aircraft_master else float(NEW_TYPE_A21N['cruise_burn_kgph'])


def fuel_cap(t):
    return float(aircraft_master[t]['fuel_capacity_kg']) if t in aircraft_master else float(NEW_TYPE_A21N['fuel_capacity_kg'])


# B6's N4xxxJ A321neo are the long-range variant (A321LR) with an additional centre
# tank: the registration-level fuel_capacity_kg override exists for exactly this.
A321LR_CAPACITY = 29000.0


def tail_cap(tail, t):
    return A321LR_CAPACITY if t == 'A21N' and tail.startswith('N4') else fuel_cap(t)


BUSY = {'JFK', 'EWR', 'LGA', 'BOS', 'ORD', 'ATL', 'LAX', 'SFO', 'LHR', 'CDG', 'AMS', 'DCA', 'PHL'}
TERMINALS = {'JFK': 'T5', 'BOS': 'C', 'FLL': 'T3', 'MCO': 'C', 'LGA': 'B', 'EWR': 'A', 'LHR': 'T2',
             'CDG': '2B', 'LAX': 'T5', 'SJU': 'A', 'AMS': 'D', 'DUB': 'T1'}
# Endpoints JetBlue does not serve commercially: GA fields, military, private.
# A leg touching one is an ADS-B nearest-airport artefact or a non-revenue movement.
NON_COMMERCIAL = {'BED', 'BKL', 'BVY', 'COU', 'CPX', 'EEN', 'FXE', 'JFN', 'LWM', 'NIP', 'OWD',
                  'PQI', 'VQQ', 'VRB', 'WRB', 'LAN', 'TVC', 'PHF'}
IATA_FIX = {'DJT': 'PBI'}   # source carries DJT/KPBI; reference IATA is PBI (ICAO now KDJT)
DELAY_CODES = [('93', 'Aircraft rotation, late arrival'), ('89', 'ATC restriction at departure'),
               ('81', 'ATFM en-route capacity'), ('63', 'Late crew boarding'), ('41', 'Aircraft defect'),
               ('87', 'Airport facilities'), ('15', 'Boarding discrepancies')]
T005_NEW = {  # land1: (landx, landx50, natio, landgr, currcode)
    'NL': ('Netherlands', 'Kingdom of the Netherlands', 'DUT', 'EUR', 'EUR'),
    'ES': ('Spain', 'Kingdom of Spain', 'SPA', 'EUR', 'EUR'),
    'IE': ('Ireland', 'Ireland', 'IRI', 'EUR', 'EUR'),
    'IT': ('Italy', 'Italian Republic', 'ITA', 'EUR', 'EUR'),
    'BM': ('Bermuda', 'Bermuda', 'BER', 'NAM', 'BMD'),
    'MX': ('Mexico', 'United Mexican States', 'MEX', 'LAM', 'MXN'),
    'JM': ('Jamaica', 'Jamaica', 'JAM', 'LAM', 'JMD'),
    'TT': ('Trinidad and Tobago', 'Republic of Trinidad and Tobago', 'TRI', 'LAM', 'TTD'),
    'CR': ('Costa Rica', 'Republic of Costa Rica', 'COS', 'LAM', 'CRC'),
    'PR': ('Puerto Rico', 'Commonwealth of Puerto Rico', 'PUE', 'NAM', 'USD'),
}

# ---------------------------------------------------------------------------
# 1. Read the extract
# ---------------------------------------------------------------------------
ws = openpyxl.load_workbook(SRC)['Flights']
src = []
for i, r in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
    date_utc, fno, callsign, o, oi, d, di, dep, arr, _dur, tail, actype, icaotype, status, hexid = r
    src.append(dict(row=i, date_utc=date_utc.date(), fno=fno, callsign=callsign,
                    o_src=o, d_src=d, o=IATA_FIX.get(o, o), d=IATA_FIX.get(d, d),
                    atot=dep.replace(tzinfo=UTC), last=arr.replace(tzinfo=UTC),
                    tail=tail, actype_src=actype, status_src=status, hex=hexid,
                    air_min=(arr - dep).total_seconds() / 60, flags=[], reason=None))

# ---------------------------------------------------------------------------
# 2. Quality: fragments and merged tracks first, so they do not poison inference
# ---------------------------------------------------------------------------
for f in src:
    if f['air_min'] < 20:
        f['reason'] = 'Track fragment: under 20 airborne minutes'
    elif f['air_min'] > 540:
        f['reason'] = 'Merged track: over 540 airborne minutes, longer than any B6 sector'
    elif f['status_src'] == 'Signal lost':
        f['reason'] = 'Signal lost: no touchdown observed, arrival time unknown'
    elif f['status_src'] == 'Airborne at end of data':
        f['reason'] = 'Airborne at end of data: no touchdown inside the extract window'

# 3. Tail rotation: recover blank origin/destination from the neighbouring legs
by_tail = defaultdict(list)
for f in src:
    if not f['reason']:
        by_tail[f['tail']].append(f)
for legs in by_tail.values():
    legs.sort(key=lambda x: x['atot'])
    for a, b in zip(legs, legs[1:]):
        gap_h = (b['atot'] - a['last']).total_seconds() / 3600
        if 0 < gap_h < 24:
            if not a['d'] and b['o_src']:
                a['d'] = IATA_FIX.get(b['o_src'], b['o_src'])
                a['flags'].append('destination INFERRED from next leg origin on same tail')
            if not b['o'] and a['d_src']:
                b['o'] = IATA_FIX.get(a['d_src'], a['d_src'])
                b['flags'].append('origin INFERRED from previous leg destination on same tail')

for f in src:
    if f['o_src'] in IATA_FIX or f['d_src'] in IATA_FIX:
        f['flags'].append('DJT normalised to PBI (reference IATA for KPBI/KDJT Palm Beach)')
    if f['reason']:
        continue
    if not f['o'] or not f['d']:
        f['reason'] = 'Origin or destination unknown and not recoverable from the rotation'
    elif f['o'] == f['d']:
        f['reason'] = 'Origin equals destination: training, air return or track artefact'
    elif f['o'] in NON_COMMERCIAL or f['d'] in NON_COMMERCIAL:
        f['reason'] = 'Endpoint is not a B6 commercial station (GA/military): nearest-airport artefact'
    else:
        km = gc_km(AIRPORTS[f['o']], AIRPORTS[f['d']])
        kmh = km / (f['air_min'] / 60)
        f['km'] = km
        if not 250 <= kmh <= 1000:
            f['reason'] = f'Implausible ground speed: {kmh:.0f} km/h over {km:.0f} km, mis-resolved airport'

# 4. Aircraft type
for f in src:
    t = TYPE_MAP.get(f['actype_src'])
    if not t:
        t = type_from_registration(f['tail'])
        f['flags'].append(f'aircraft type INFERRED as {t} from JetBlue registration series')
    f['type'] = t

# 5. Duplicate tail overlap: two kept legs of one tail airborne at once
kept = [f for f in src if not f['reason']]
by_tail = defaultdict(list)
for f in kept:
    by_tail[f['tail']].append(f)
for legs in by_tail.values():
    legs.sort(key=lambda x: x['atot'])
    for a, b in zip(legs, legs[1:]):
        if b['atot'] < a['last'] and not b['reason']:
            b['reason'] = f'Overlaps row {a["row"]} on the same tail'
kept = [f for f in src if not f['reason']]

# ---------------------------------------------------------------------------
# 6. Schedule timing
# ---------------------------------------------------------------------------
for f in kept:
    key = f'{f["fno"]}|{f["atot"].isoformat()}'
    f['key'] = key
    o, d = AIRPORTS[f['o']], AIRPORTS[f['d']]
    f['taxi_out'] = (18 if f['o'] in BUSY else 12) + int(h(key, 'txo') * 7)
    f['taxi_in'] = (8 if f['d'] in BUSY else 5) + int(h(key, 'txi') * 4)
    f['aldt'] = f['last']
    f['aobt'] = f['atot'] - dt.timedelta(minutes=f['taxi_out'])
    f['aibt'] = f['aldt'] + dt.timedelta(minutes=f['taxi_in'])
    actual_block = (f['aibt'] - f['aobt']).total_seconds() / 60
    # Delay: 18% of legs late by 15-90 minutes, the rest 0-9 minutes
    if h(key, 'dly') < 0.18:
        delay = 15 + int(h(key, 'dlm') * 76)
        code, _ = pick(key, 'dlc', DELAY_CODES)
    else:
        delay, code = int(h(key, 'dlm') * 10), None
    f['sobt'] = floor5(f['aobt'] - dt.timedelta(minutes=delay))
    f['delay'] = int((f['aobt'] - f['sobt']).total_seconds() // 60)
    f['delay_code'] = code if f['delay'] >= 15 else None
    planned_block = int(5 * math.ceil((actual_block * (0.97 + h(key, 'pbk') * 0.08)) / 5))
    f['planned_block'] = planned_block
    f['actual_block'] = round(actual_block)
    f['sibt'] = f['sobt'] + dt.timedelta(minutes=planned_block)
    f['o_tz'], f['d_tz'] = ZoneInfo(o['tz']), ZoneInfo(d['tz'])
    f['flight_date'] = f['sobt'].astimezone(f['o_tz']).date()
    f['flight_number'] = f['fno'].replace(' ', '')
    f['leg_id'] = f'{f["flight_number"]}-{f["flight_date"]:%Y%m%d}-{f["o"]}'
    f['id'] = uid('FS', f['leg_id'], f['atot'].isoformat())

# Leg ID must be unique: disambiguate the rare repeat (same number, date and origin)
seen = Counter()
for f in sorted(kept, key=lambda x: x['atot']):
    seen[f['leg_id']] += 1
    if seen[f['leg_id']] > 1:
        f['leg_id'] += f'-{seen[f["leg_id"]]}'
        f['flags'].append('flight_leg_id suffixed: repeat of number, date and origin')
dup_key = Counter((f['flight_number'], f['flight_date']) for f in kept)
for f in kept:
    if dup_key[(f['flight_number'], f['flight_date'])] > 1:
        f['flags'].append('DSP458: number+date shared with another leg; a dispatch Excel import cannot match it, '
                          'the CSV seed links by flight_schedule_ID instead')

# Rotation links
by_tail = defaultdict(list)
for f in kept:
    by_tail[f['tail']].append(f)
for legs in by_tail.values():
    legs.sort(key=lambda x: x['atot'])
    for i, f in enumerate(legs):
        f['prev'] = legs[i - 1] if i and 0 < (f['aobt'] - legs[i - 1]['aibt']).total_seconds() / 3600 < 24 else None
        f['next'] = legs[i + 1] if i + 1 < len(legs) and 0 < (legs[i + 1]['aobt'] - f['aibt']).total_seconds() / 3600 < 24 else None
        if f['prev'] and f['prev']['d'] != f['o']:
            f['flags'].append(f'rotation break: previous leg landed {f["prev"]["d"]}, this leg departs {f["o"]}')

# ---------------------------------------------------------------------------
# 7. Dispatch fuel stack, then the FOB chain along each tail (in time order)
# ---------------------------------------------------------------------------
perf = {t: round(98.5 + h(t, 'perf') * 4.5, 3) for t in {f['tail'] for f in kept}}
stations = sorted({f['o'] for f in kept} | {f['d'] for f in kept})


# ---- Fuel policy: JetBlue is a US carrier, so the plan follows 14 CFR Part 121 ----
# 121.639 DOMESTIC (48 contiguous states): trip + alternate + 45 min at normal cruise.
#   No contingency is required; the 45 minutes goes in final_reserve_kg.
# 121.645 FLAG (any leg touching a non-US-state point, incl. Puerto Rico and
#   Bermuda for B6 purposes): trip + 10% of the trip TIME as contingency +
#   alternate + 30 min holding at 1,500 ft.
# 121.645(c) ISLAND: a destination with no alternate within reach carries
#   2 hours at normal cruise instead of alternate + holding.
CLIMB_ALLOWANCE = {'A223': 350, 'A320': 500, 'A321': 600, 'A21N': 500}   # kg above cruise rate for climb/descent
PLAN_MARGIN = float(os.environ.get('PLAN_MARGIN', '0.02'))   # flight plans run ~2% conservative on trip burn
HOLD_FACTOR = 0.80            # holding burn as a fraction of cruise burn
ISLAND_MAX_ALT_KM = 700       # beyond this no alternate is planned


def is_domestic(o, d):
    return (AIRPORTS[o]['country'] == 'US' and AIRPORTS[d]['country'] == 'US'
            and not AIRPORTS[o]['tz'].startswith(('Pacific/', 'America/Anchorage'))
            and not AIRPORTS[d]['tz'].startswith(('Pacific/', 'America/Anchorage')))


# Where the usual alternate is not a station in the extract. Alternate-only: these
# go in the plan's alternate_airport string and are NOT added to MASTER_AIRPORTS.
ALT_OVERRIDE = {'SEA': 'PDX', 'SJU': 'BQN', 'SJO': 'LIR', 'KIN': 'MBJ', 'POS': 'BGI'}


def alternate_for(dest):
    """Nearest other commercial station 100 km or more away; None where the nearest is out of reach (island)."""
    if dest in ALT_OVERRIDE:
        return gc_km(AIRPORTS[dest], AIRPORTS[ALT_OVERRIDE[dest]]), ALT_OVERRIDE[dest]
    cands = sorted((gc_km(AIRPORTS[dest], AIRPORTS[s]), s) for s in stations
                   if s != dest and s not in NON_COMMERCIAL and gc_km(AIRPORTS[dest], AIRPORTS[s]) >= 100)
    same = [c for c in cands if AIRPORTS[c[1]]['country'] == AIRPORTS[dest]['country']]
    best = (same or cands)[0]
    return best if best[0] <= ISLAND_MAX_ALT_KM else (None, None)


def fuel_stack(f, planned_air_min, payload_delta=0.0):
    """The seven terms for one plan version. payload_delta scales trip for a heavier/lighter estimate."""
    t, key = f['type'], f['key']
    burn = cruise_burn(t)
    trip = (CLIMB_ALLOWANCE[t] + burn * max(planned_air_min - 20, 10) / 60) * (1 + payload_delta) * (1 + PLAN_MARGIN)
    alt_km, alt = ALT[f['d']]
    domestic = is_domestic(f['o'], f['d'])
    if alt is None:                                           # island reserve, no alternate
        alt_fuel, final_res = 0.0, 0.0
        additional = 120 / 60 * burn
        basis = 'FAR 121.645(c) island reserve 2 h, no alternate'
    else:
        alt_fuel = CLIMB_ALLOWANCE[t] * 0.5 + (alt_km / 650 * 60 + 8) / 60 * burn * 0.95
        if domestic:
            final_res, basis = 45 / 60 * burn, 'FAR 121.639 domestic: alternate + 45 min cruise'
        else:
            final_res, basis = 30 / 60 * burn * HOLD_FACTOR, 'FAR 121.645 flag: 10% contingency + alternate + 30 min hold'
        additional = 0.0
        if f['d'] in BUSY and h(key, 'add') < 0.25:           # dispatcher adds holding for forecast arrival delay
            additional = (10 + 5 * int(h(key, 'adm') * 3)) / 60 * burn * HOLD_FACTOR
    contingency = 0.0 if domestic else 0.10 * planned_air_min / 60 * burn
    taxi = f['taxi_out'] * TAXI_KG_MIN[t]
    # Commander's discretion: most legs none; some carry 300-900 kg; tankering from cheap-fuel hubs
    r = h(key, 'ext')
    extra = 0.0 if r < 0.72 else 100 * (3 + int(h(key, 'exa') * 7))
    return dict(trip=round(trip), cont=round(contingency), alt=round(alt_fuel), fres=round(final_res),
                add=round(additional), taxi=round(taxi), extra=round(extra)), alt, basis


ALT = {s: alternate_for(s) for s in stations}
# Plan revisions. Real dispatch re-issues a plan when payload firms up, weather or
# ATC changes, or the release is re-cut; the feed then sends only the latest.
#   ~70% of legs: one plan.  ~22%: v1 then v2.  ~6%: v1, v2, v3.
#   ~2%: FEED source where v2 never arrived (v1 then v3) - exercises DSP456.
REVISION_REASONS = ['Payload firmed up at close-out', 'Revised winds aloft', 'ATC reroute filed',
                    'Destination weather deteriorated: holding added', 'Alternate changed', 'MEL item: fuel penalty']
seq = 0
for f in sorted(kept, key=lambda x: x['atot']):
    seq += 1
    key = f['key']
    f['burn'] = cruise_burn(f['type'])
    planned_air = f['planned_block'] - f['taxi_out'] - f['taxi_in']
    f['stack'], f['alt'], f['basis'] = fuel_stack(f, planned_air)
    f['dispatch_order_id'] = f'FO-B6-2026-{seq:05d}'
    r = h(key, 'rev')
    if r < 0.70:
        f['versions'], f['vsource'] = [1], 'ASSIGNED'
    elif r < 0.92:
        f['versions'], f['vsource'] = [1, 2], 'ASSIGNED'
    elif r < 0.98:
        f['versions'], f['vsource'] = [1, 2, 3], 'FEED'
    else:
        f['versions'], f['vsource'] = [1, 3], 'FEED'
    f['earlier'] = []          # superseded plans, oldest first
    for i, v in enumerate(f['versions'][:-1]):
        delta = -0.02 - h(key, f'pd{v}') * 0.04                   # earlier payload estimates ran light
        st, alt, _ = fuel_stack(f, planned_air + int(h(key, f'pa{v}') * 10) - 5, delta)
        if h(key, f'rs{v}') < 0.5:
            st['extra'] = max(0, st['extra'] - 300)
        f['earlier'].append(dict(version=v, stack=st, alt=alt,
                                 reason=pick(key, f'rr{v}', REVISION_REASONS)))

# ---- Ground operations -------------------------------------------------------
HYDRANT = BUSY | {'FLL', 'MCO', 'LAS', 'SJU', 'DEN', 'IAH', 'DFW', 'SEA', 'MIA', 'TPA', 'BWI', 'IAD', 'SAN'}
FLOW_L_MIN = {'HYD': 900, 'REF': 600}
ALPHA = 0.00099          # ASTM D1250 volumetric coefficient, as order-service.js uses it
CONV_DENSITY = 0.8000    # the order-conversion density (UOM_MASTER), as the existing seed uses it
MIN_UPLIFT_KG = 500      # below this a flight is topped up to 500 kg rather than skipped
PRICE_REGION = {}        # filled in section 7b

# Five flights take no fuel because the previous sector tankered for them: a cheap
# Florida station feeding an expensive New York Harbor-priced one, both short legs.
NYH = {'JFK', 'LGA', 'EWR', 'HPN', 'ISP', 'SWF', 'ALB', 'BOS', 'PVD', 'BDL', 'ORH', 'PWM', 'ACK', 'SYR',
       'ROC', 'BUF', 'PHL', 'BWI', 'DCA', 'IAD', 'RIC', 'ORF', 'PIT'}
FLORIDA = {'FLL', 'MCO', 'TPA', 'PBI', 'RSW', 'JAX', 'SRQ'}
cands = sorted((f for f in kept if f['prev'] and f['prev']['o'] in FLORIDA and f['o'] in NYH
                and f['type'] != 'A223' and f['prev']['type'] != 'A223' and f['air_min'] < 150),
               key=lambda f: h(f['key'], 'tank'))
tankered, used = [], set()
for f in cands:
    pv = f['prev']
    if len(tankered) == 5:
        break
    if pv['id'] in used or f['id'] in used or (pv['prev'] and pv['prev']['id'] in used) or (f['next'] and f['next']['id'] in used):
        continue
    ps = pv['stack']
    prev_arr_plan = ps['cont'] + ps['alt'] + ps['fres'] + ps['add'] + ps['extra']
    need_est = sum(f['stack'].values()) - prev_arr_plan
    extra = need_est + 1200
    if sum(ps.values()) + extra > tail_cap(pv['tail'], pv['type']):
        continue
    f['no_uplift'] = True
    f['orig_order_kg'] = round(need_est, 2)
    pv['tanker_for'] = f
    ps['extra'] += round(extra)
    pv['basis'] += f' - tankering {round(extra)} kg for {f["flight_number"]} ex {f["o"]}'
    tankered.append(f)
    used |= {pv['id'], f['id']}
assert len(tankered) == 5, f'only {len(tankered)} tankering pairs found'

# Ten deliveries carry a gauge variance well outside tolerance; everything else sits
# within 25 kg / 0.1%. Five are ~500 kg absolute, five ~1% of the uplift.
var_pool = sorted((f for f in kept if not f.get('no_uplift')), key=lambda f: h(f['key'], 'var'))
for f in var_pool:
    f['var_kind'] = None
abs_n = pct_n = 0
for f in var_pool:
    if f['air_min'] < 150:             # long sectors only: a 500 kg or 1% gauge error on a large uplift
        continue
    if abs_n < 5:
        f['var_kind'], abs_n = 'ABS', abs_n + 1
    elif pct_n < 5:
        f['var_kind'], pct_n = 'PCT', pct_n + 1
    if abs_n == 5 and pct_n == 5:
        break


def apu_minutes(t0, t1, arrival_t, aobt):
    """APU running minutes inside [t0, t1]. On a turn of 90 min or less it runs throughout;
    on a longer one (overnight included) only for 20 min after on-blocks and the last 60 min
    before off-blocks - the aircraft is otherwise on ground power or shut down."""
    if t1 <= t0:
        return 0.0
    if (aobt - arrival_t).total_seconds() <= 90 * 60:
        windows = [(arrival_t, aobt)]
    else:
        windows = [(arrival_t, arrival_t + dt.timedelta(minutes=20)), (aobt - dt.timedelta(minutes=60), aobt)]
    return sum(max(0.0, (min(t1, b) - max(t0, a)).total_seconds() / 60) for a, b in windows)


def station_temp(code, key):
    lat = abs(AIRPORTS[code]['lat'])
    return round(28 - 0.45 * max(0.0, lat - 18) + (h(key, 'tmp') - 0.5) * 6, 1)


for legs in by_tail.values():
    legs.sort(key=lambda x: x['atot'])
    for f in legs:
        s, t, key = f['stack'], f['type'], f['key']
        pv = f['prev']
        if pv:
            rob = pv['fob_in']                    # ACTUAL fuel at on-blocks of the arriving leg
            rob_plan = pv['arr_plan_rob']         # what the planner knew: that leg's PLANNED on-block ROB
            f['rob_src'] = f'planned on-block ROB of inbound {pv["flight_number"]}'
            arrival_t = pv['aibt']
        else:
            rob = s['alt'] + s['fres'] + s['add'] + 400 + int(h(key, 'rob') * 800)
            rob_plan = rob
            f['rob_src'] = 'SEEDED: no previous leg in the extract (D59 shape)'
            f['flags'].append('opening ROB seeded, not carried: first leg of this tail in the extract')
            arrival_t = f['aobt'] - dt.timedelta(minutes=70 + int(h(key, 'arr') * 50))
        block = sum(s.values())
        if f.get('no_uplift'):
            if rob < block - s['extra']:
                f['flags'].append('TANKERING SHORT: arrival fuel below the minimum required block')
            if rob_plan > block:
                s['extra'] += round(rob_plan - block); block = sum(s.values())
        else:
            if rob_plan > block - MIN_UPLIFT_KG:              # tankered in: commander carries the surplus
                s['extra'] += round(rob_plan - block + MIN_UPLIFT_KG); block = sum(s.values())
        cap = tail_cap(f['tail'], t)
        if block > cap:
            f['flags'].append(f'block {block:.0f} kg exceeds {t} capacity {cap:.0f} kg; extra and additional trimmed')
            over = min(block - cap, max(0, block - rob_plan))
            for k in ('extra', 'add'):
                cut = min(over, s[k]); s[k] -= cut; over -= cut
            block = sum(s.values())
            if block > cap:
                f['flags'].append('STILL over capacity after trimming: check the type assumption for this tail')
        f['block'] = block
        f['rob'] = round(rob_plan, 2)           # the dispatch plan's fuel on board (DSP451 input)
        f['rob_actual'] = round(rob, 2)
        f['uplift'] = round(block - rob_plan, 2)
        apu = APU[t]
        f['arrival_t'] = arrival_t
        # Planned ROB at ON-BLOCKS: landing fuel less the planned taxi-in burn
        f['arr_plan_rob'] = s['cont'] + s['alt'] + s['fres'] + s['add'] + s['extra'] - f['taxi_in'] * TAXI_KG_MIN[t]
        # Order: dispatch quantity less the ARRIVING flight's planned ROB (first leg of a
        # tail: no arriving plan in the extract, so the seeded arrival figure stands in)
        f['order_kg'] = f['uplift'] if not f.get('no_uplift') else f['orig_order_kg']
        f['ordered_l'] = round(f['order_kg'] / CONV_DENSITY, 2)
        if f.get('no_uplift'):
            f['delivered_l'] = 0
            f['fob_out'] = round(rob - apu * apu_minutes(arrival_t, f['aobt'], arrival_t, f['aobt']) / 60, 2)
        else:
            method = 'HYD' if f['o'] in HYDRANT else 'REF'
            start = f['aobt'] - dt.timedelta(minutes=30 + int(h(key, 'rfs') * 20))
            if pv:
                start = max(start, pv['aibt'] + dt.timedelta(minutes=6))
            temp = station_temp(f['o'], key)
            rho15 = round(0.7980 + h(f['o'] + str(f['flight_date']), 'rho') * 0.0150, 4)
            rho = round(rho15 * (1 - ALPHA * (temp - 15)), 4)
            ground = apu * apu_minutes(arrival_t, start, arrival_t, f['aobt']) / 60
            before = rob - ground
            need_kg = block - before
            est_l = need_kg / rho
            dur = int(est_l / FLOW_L_MIN[method]) + 4
            end = start + dt.timedelta(minutes=dur)
            apu_after = apu * apu_minutes(end, f['aobt'], arrival_t, f['aobt']) / 60
            need_kg += apu_after
            want_l = max(round(need_kg / rho), round(MIN_UPLIFT_KG / rho))   # never a sixth no-uplift flight
            limit_l = math.floor(f['ordered_l'])
            delivered_l = max(0, min(want_l, limit_l))
            if (want_l - limit_l) * rho > 300:
                f['flags'].append(f'uplift held to the ordered {limit_l} L; the aircraft needed {want_l} L '
                                  f'because it arrived below the planned ROB')
            ticket_kg = round(delivered_l * rho, 2)
            if f.get('var_kind') == 'ABS':
                var = (1 if h(key, 'vs') < 0.5 else -1) * (480 + int(h(key, 'vm') * 60))
            elif f.get('var_kind') == 'PCT':
                var = (1 if h(key, 'vs') < 0.5 else -1) * ticket_kg * (0.010 + h(key, 'vm') * 0.003)
            else:
                lim = min(25.0, max(10.0, ticket_kg * 0.001))
                var = (h(key, 'vn') - 0.5) * 2 * lim
            var = round(var, 2)
            delta = round(ticket_kg - var, 2)
            after = round(before + delta, 2)
            f.update(method=method, refuel_start=start, refuel_end=end, temp=temp, rho15=rho15, rho=rho,
                     ground_kg=round(ground, 2), fob_before=round(before, 2), fob_after=after,
                     fob_delta=delta, ticket_kg=ticket_kg, recon_var=var, delivered_l=delivered_l)
            f['fob_out'] = round(after - apu_after, 2)
            if delivered_l < MIN_UPLIFT_KG / rho * 0.5:
                f['flags'].append(f'very small uplift ({delivered_l} L)')
        pf = perf[f['tail']] / 100
        f['fob_off'] = f['fob_out'] - f['taxi_out'] * TAXI_KG_MIN[t]
        f['fob_on'] = f['fob_off'] - (CLIMB_ALLOWANCE[t] + f['burn'] * max(f['air_min'] - 20, 10) / 60) * pf * (0.98 + h(key, 'wx') * 0.04)
        f['fob_in'] = f['fob_on'] - f['taxi_in'] * TAXI_KG_MIN[t]
        if f['fob_in'] < s['fres']:
            f['flags'].append('FOB at IN below final reserve: check plan')

# ---------------------------------------------------------------------------
# 7b. Suppliers, contracts, prices; orders, deliveries and tickets
# ---------------------------------------------------------------------------
from decimal import Decimal, ROUND_HALF_UP

GAL_L = 3.785411784


def money(x):
    """Number(x.toFixed(2)) exactly, as invoice-checks.js r2() computes it: round the EXACT
    binary value of the float half-up. Decimal(str(x)) rounds the shortest decimal text
    instead, and disagrees on products like 4650 x 1.3387 = 6224.95499... (INV469)."""
    return float(Decimal(float(x)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))


# Spot jet fuel, USD per US gallon, by pricing region and flight date. Sourced from
# web search results only (EIA / FRED / IATA / Argus pages are egress-blocked here):
#   USGC  Sep-2026 monthly 4.341, 11-Sep 4.418, mid-Sep ~4.55 (Bloomberg, 18-Sep)
#   NYH   mid-Sep ~4.75 (Bloomberg, 18-Sep)
#   global average 194.90 USD/bbl = 4.64 USD/gal, week to 25-Sep (IATA monitor, +7.4% w/w)
# CHI, ROCKY, WC and CARIB are USGC plus a stated regional basis - ASSUMED, not sourced.
USGC = {'2026-09-23': 4.40, '2026-09-24': 4.43, '2026-09-25': 4.47, '2026-09-26': 4.50, '2026-09-27': 4.52}
NYHP = {'2026-09-23': 4.70, '2026-09-24': 4.73, '2026-09-25': 4.77, '2026-09-26': 4.80, '2026-09-27': 4.82}
EURP = {'2026-09-23': 4.56, '2026-09-24': 4.59, '2026-09-25': 4.63, '2026-09-26': 4.66, '2026-09-27': 4.68}
BASIS = {'CHI': 0.06, 'ROCKY': 0.12, 'WC': 0.30, 'CARIB': 0.20, 'CANW': 0.35}
REGION = {}
for code in ('JFK LGA EWR HPN ISP SWF ALB BOS PVD BDL ORH PWM ACK SYR ROC BUF PHL BWI DCA IAD RIC ORF PIT').split():
    REGION[code] = 'NYH'
for code in ('FLL MCO TPA PBI RSW JAX SRQ SAV CHS CLT RDU GSO GSP ILM ATL BHM BNA MSY IAH AUS DFW MEM SDF').split():
    REGION[code] = 'USGC'
for code in 'ORD MDW DTW CLE MKE'.split():
    REGION[code] = 'CHI'
for code in 'DEN SLC ABQ'.split():
    REGION[code] = 'ROCKY'
for code in 'LAX SFO SAN SEA SMF BUR ONT LAS PHX'.split():
    REGION[code] = 'WC'
for code in 'SJU BDA KIN POS CUN SJO'.split():
    REGION[code] = 'CARIB'
for code in 'LHR CDG AMS DUB EDI MAD BCN MXP'.split():
    REGION[code] = 'EUR'
REGION['YVR'] = 'CANW'
missing_region = sorted({f['o'] for f in kept} - set(REGION))
assert not missing_region, f'no pricing region for {missing_region}'


def spot(code, day):
    r = REGION[code]
    if r == 'NYH':
        return NYHP[day]
    if r == 'EUR':
        return EURP[day]
    return USGC[day] + BASIS.get(r, 0.0)


# name, country, invoice prefix. Three already exist in the seed and are reused.
SUPPLIER_DEFS = {
    'WFSUS01':   ('World Fuel Services Inc', 'US', 'WFS'),
    'SHELLUS01': ('Shell Aviation LLC', 'US', 'SHL'),
    'BPUS01':    ('BP Air US', 'US', 'BPA'),
    'CHEVUS01':  ('Chevron Global Aviation', 'US', 'CGA'),
    'AVFUEL01':  ('Avfuel Corporation', 'US', 'AVF'),
    'PUMAPR01':  ('Puma Energy Caribe', 'PR', 'PMA'),
    'SOLCAR01':  ('Sol Aviation Services', 'JM', 'SOL'),
    'ASAMX01':   ('ASA Combustibles', 'MX', 'ASA'),
    'REPSOL01':  ('Repsol Aviacion', 'ES', 'REP'),
    'ENIAV01':   ('Eni Aviation', 'IT', 'ENI'),
    'SHELLNL01': ('Shell Aviation Netherlands', 'NL', 'SNL'),
    'BPUK001':   ('BP Aviation United Kingdom', 'GB', 'BPK'),   # existing
    'ATINT01':   ('Air Total International', 'FR', 'ATI'),       # existing
    'WFS001':    ('World Fuel Services Canada', 'CA', 'WFC'),    # existing
}
existing_suppliers = {r['supplier_code']: r for r in read_csv('MASTER_SUPPLIERS')}
# Station -> (primary, secondary). Secondary suppliers take ~40% of flight numbers.
STATION_SUPPLIERS = {}
for code in 'LGA HPN ISP SWF ALB PVD BDL ORH PWM ACK SYR ROC BUF'.split():
    STATION_SUPPLIERS[code] = ('WFSUS01', None)
for code in 'PHL BWI DCA IAD RIC ORF PIT'.split():
    STATION_SUPPLIERS[code] = ('BPUS01', None)
STATION_SUPPLIERS.update({'JFK': ('WFSUS01', 'SHELLUS01'), 'BOS': ('WFSUS01', 'SHELLUS01'),
                          'EWR': ('WFSUS01', 'BPUS01'), 'FLL': ('SHELLUS01', 'WFSUS01'),
                          'MCO': ('BPUS01', 'SHELLUS01'), 'LAX': ('CHEVUS01', 'WFSUS01'),
                          'TPA': ('BPUS01', None), 'PBI': ('SHELLUS01', None)})
for code in 'RSW JAX SRQ SAV CHS GSO GSP ILM BHM MEM SDF'.split():
    STATION_SUPPLIERS[code] = ('AVFUEL01', None)
for code in 'ATL CLT RDU BNA'.split():
    STATION_SUPPLIERS[code] = ('WFSUS01', None)
for code in 'MSY IAH AUS DFW DEN SLC ABQ SFO SAN SEA SMF BUR ONT LAS PHX'.split():
    STATION_SUPPLIERS[code] = ('CHEVUS01', None)
for code in 'ORD MDW DTW CLE MKE'.split():
    STATION_SUPPLIERS[code] = ('BPUS01', None)
STATION_SUPPLIERS.update({'SJU': ('PUMAPR01', None), 'BDA': ('SOLCAR01', None), 'KIN': ('SOLCAR01', None),
                          'POS': ('SOLCAR01', None), 'CUN': ('ASAMX01', None), 'SJO': ('SOLCAR01', None),
                          'LHR': ('BPUK001', None), 'EDI': ('BPUK001', None), 'DUB': ('BPUK001', None),
                          'CDG': ('ATINT01', None), 'AMS': ('SHELLNL01', None), 'MAD': ('REPSOL01', None),
                          'BCN': ('REPSOL01', None), 'MXP': ('ENIAV01', None), 'YVR': ('WFS001', None)})
missing_sup = sorted({f['o'] for f in kept} - set(STATION_SUPPLIERS))
assert not missing_sup, f'no supplier for {missing_sup}'


def supplier_for(f):
    prim, sec = STATION_SUPPLIERS[f['o']]
    return sec if sec and h(f['o'] + f['flight_number'], 'sup') < 0.4 else prim


def supplier_id(code):
    return existing_suppliers[code]['ID'] if code in existing_suppliers else uid('SUP', code)


used_suppliers = sorted({supplier_for(f) for f in kept})
supplier_rows = []
for i, code in enumerate(used_suppliers):
    if code in existing_suppliers:
        continue
    name, cc, _ = SUPPLIER_DEFS[code]
    supplier_rows.append(dict(ID=supplier_id(code), supplier_code=code, supplier_name=name, supplier_type='EXTERNAL',
                              country_code=cc, iata_code=None, icao_code=None, parent_supplier_ID=None,
                              payment_terms='NET30', s4_vendor_no=f'{300100 + i:010d}', is_active='true',
                              created_at=SEED_TS, created_by=SEED_USER, modified_at=SEED_TS, modified_by=SEED_USER))
contract_rows = []
CONTRACT = {}
for i, code in enumerate(used_suppliers):
    cid = uid('CON', code)
    CONTRACT[code] = cid
    contract_rows.append(dict(ID=cid, contract_number=f'B6-{SUPPLIER_DEFS[code][2]}-2026-001',
                              contract_name=f'JetBlue {SUPPLIER_DEFS[code][0]} into-plane supply 2026',
                              supplier_ID=supplier_id(code), valid_from='2026-01-01', valid_to='2026-12-31',
                              contract_type='TERM', price_type='CPE', currency_code='USD', payment_terms='NET30',
                              incoterms='DAP', min_volume_kg='1000000.00', max_volume_kg='250000000.00',
                              s4_contract_number=f'{4600300001 + i}', is_active='true', created_at=SEED_TS,
                              created_by=SEED_USER, modified_at=SEED_TS, modified_by=SEED_USER))
JETA_ID = uid('PROD', 'JETA')
JETA1_ID = read_csv('MASTER_PRODUCTS')[0]['ID']          # the seeded Jet A-1 row
product_rows = [dict(ID=JETA_ID, product_code='JETA-ASTM-001', product_name='Jet A Aviation Turbine Fuel',
                     product_type='JET_FUEL', specification='ASTM D1655 Jet A', uom_code='KG',
                     s4_material_number='10000004', is_active='true', created_at=SEED_TS, created_by=SEED_USER,
                     modified_at=SEED_TS, modified_by=SEED_USER)]


def product_for(code):
    return JETA_ID if AIRPORTS[code]['country'] == 'US' and code != 'SJU' else JETA1_ID


# Designated suppliers: a station default per station, plus a flight-level row for
# every flight number the SECONDARY supplier serves at a two-supplier station.
desig_rows = []
for code, (prim, sec) in sorted(STATION_SUPPLIERS.items()):
    if code not in {f['o'] for f in kept}:
        continue
    desig_rows.append(dict(ID=uid('DES', code), flight_number=None, station_code=code, carrier_code='B6',
                           supplier_ID=supplier_id(prim), supplier_contract_ID=CONTRACT[prim],
                           supplier_performs_uplift='true', designation_type='PRIMARY', valid_from='2026-01-01',
                           valid_to=None, priority=100, is_active='true',
                           notes='Station default for B6. The supplier fuels its own product, so no into-plane agent.',
                           created_at=SEED_TS, created_by=SEED_USER, modified_at=SEED_TS, modified_by=SEED_USER))
for code, fno in sorted({(f['o'], f['flight_number']) for f in kept}):
    prim, sec = STATION_SUPPLIERS[code]
    if sec and h(code + fno, 'sup') < 0.4:
        desig_rows.append(dict(ID=uid('DES', code, fno), flight_number=fno, station_code=code, carrier_code='B6',
                               supplier_ID=supplier_id(sec), supplier_contract_ID=CONTRACT[sec],
                               supplier_performs_uplift='true', designation_type='PRIMARY', valid_from='2026-01-01',
                               valid_to=None, priority=100, is_active='true',
                               notes=f'Flight-level: {fno} at {code} is fuelled by the second supplier.',
                               created_at=SEED_TS, created_by=SEED_USER, modified_at=SEED_TS, modified_by=SEED_USER))

order_rows, delivery_rows, ticket_rows = [], [], []
seq_o, seq_d, seq_t = Counter(), Counter(), Counter()
po_n = gr_n = 0
tkt_run = {}
for f in sorted(kept, key=lambda x: x['atot']):
    code, day = f['o'], str(f['flight_date'])
    sup = supplier_for(f)
    f['supplier'] = sup
    price_l = round((spot(code, day if day in USGC else '2026-09-24')
                     + (0.16 + h(code, 'dif') * 0.10 if code in HYDRANT else
                        0.45 + h(code, 'dif') * 0.20 if REGION[code] == 'CARIB' else
                        0.20 + h(code, 'dif') * 0.12 if REGION[code] == 'EUR' else
                        0.26 + h(code, 'dif') * 0.16)
                     + (h(code + sup, 'sdf') - 0.5) * 0.06) / GAL_L, 4)
    f['price_l'] = price_l
    seq_o[(code, day)] += 1
    ymd = day.replace('-', '')
    f['order_id'] = uid('FO', f['leg_id'])
    f['order_number'] = f'FO-{code}-{ymd}-{seq_o[(code, day)]:03d}'
    no_up = f.get('no_uplift')
    if not no_up:
        po_n += 1
    sobt_local = f['sobt'].astimezone(f['o_tz'])
    active_ts = f['sobt'] - dt.timedelta(minutes=35 + int(h(f['key'], 'l0') * 50))
    cap_name = f'Capt. {pick(f["tail"] + str(f["flight_date"]), "cap", [f"CAP-B6{n:04d}" for n in range(101, 401)])[4:]} (synthetic)'
    f['captain_name'] = cap_name
    pv = f['prev']
    order_rows.append(dict(
        ID=f['order_id'], order_number=f['order_number'], flight_ID=f['id'], airport_ID=None, station_code=code,
        supplier_ID=supplier_id(sup), contract_ID=CONTRACT[sup], product_ID=product_for(code), uom_code='LTR',
        conversion_density=f'{CONV_DENSITY:.4f}', conversion_source='UOM_MASTER',
        ordered_quantity_kg=r2(f['order_kg']), ordered_quantity=r2(f['ordered_l']),
        unit_price=price_l, total_amount=money(f['ordered_l'] * price_l), currency_code='USD',
        requested_date=day, requested_time=(sobt_local - dt.timedelta(minutes=40)).strftime('%H:%M:%S'),
        priority='Normal', status='Cancelled' if no_up else 'Completed',
        s4_po_number=None if no_up else f'{4500300000 + po_n}', s4_po_item=None if no_up else '00010',
        dispatch_fuel_order_id=f['dispatch_order_id'], dispatch_plan_ID=uid('FD', f['leg_id'], f['versions'][-1]),
        crew_review_status='CONFIRMED', crew_reviewed_by=cap_name,
        crew_reviewed_at=iso(f['sobt'] - dt.timedelta(minutes=50)),
        notes=f'Fuel order for {f["flight_number"]} {code}-{f["d"]}: dispatch {f["block"]:.0f} kg less planned ROB '
              f'{f["rob"]:.0f} kg ({f["rob_src"]}).'[:1000],
        cancelled_reason=(f'No uplift required: fuel tankered on {pv["flight_number"]} ex {pv["o"]}.' if no_up else None),
        cancelled_by=('dispatch@airline.com' if no_up else None),
        cancelled_at=(iso(f['sobt'] - dt.timedelta(minutes=70)) if no_up else None),
        communicated_at=iso(active_ts + dt.timedelta(minutes=5)), communication_status='ACKNOWLEDGED',
        communication_reference=f'MSG-{sup[:3]}-{ymd}-{seq_o[(code, day)]:03d}',
        order_relationship='ORIGINAL', is_tankering='true' if f.get('tanker_for') else 'false',
        tankering_sectors=2 if f.get('tanker_for') else None,
        order_type='TANKERING' if f.get('tanker_for') else 'ORIGINAL',
        planned_quantity_kg=r2(f['order_kg']), quantity_variance_reason=None,
        into_plane_agent_ID=None, into_plane_contract_ID=None,
        created_at=iso(active_ts + dt.timedelta(minutes=3)), created_by=SEED_USER,
        modified_at=iso(f['aibt']), modified_by=SEED_USER))
    if no_up:
        continue
    gr_n += 1
    seq_d[(code, day)] += 1
    seq_t[(code, day)] += 1
    ordered_l = f['ordered_l']
    dl = f['delivered_l']
    qv = round(dl - ordered_l, 2)
    qpct = round(qv / ordered_l * 100, 2)
    flagged = abs(qpct) > 5
    band = round(max(abs(f['ticket_kg']) * 0.005, 50.0), 2)
    recon = 'RECONCILED' if abs(f['recon_var']) <= band else 'VARIANCE'
    veh = f"{'HD' if f['method'] == 'HYD' else 'RF'}-{code}-{1 + int(h(f['key'], 'veh') * 24):02d}"
    f['delivery_id'] = uid('DL', f['leg_id'])
    f['gr_number'] = f'{5000300000 + gr_n}'
    delivery_rows.append(dict(
        ID=f['delivery_id'], order_ID=f['order_id'], flight_ID=f['id'], aircraft_reg=f['tail'],
        tail_registration=f['tail'], delivery_number=f'EPD-{code}-{ymd}-{seq_d[(code, day)]:04d}',
        delivery_date=f['refuel_start'].strftime('%Y-%m-%d'), delivery_time=f['refuel_start'].strftime('%H:%M:%S'),
        delivered_quantity=f'{dl:.2f}', uom_code='LTR', temperature=f'{f["temp"]:.2f}', density=f'{f["rho"]:.4f}',
        temperature_corrected_qty=r2(dl * round(1 - ALPHA * (f['temp'] - 15), 6)),
        vehicle_id=veh, driver_name=f'Fueler {100 + int(h(veh, "drv") * 800)} (synthetic)', pilot_name=f['captain_name'],
        ground_crew_name=f'Ramp agent {100 + int(h(f["key"], "gc") * 800)} (synthetic)',
        s4_gr_number=f['gr_number'], s4_gr_year='2026', s4_gr_item='0001', status='Verified',
        quantity_variance=qv, variance_percentage=qpct, variance_flag='true' if flagged else 'false',
        variance_reason=('Arrived with more fuel than planned, so the uplift was reduced to reach block fuel.' if flagged and qv < 0
                         else 'Uplift above order.' if flagged else None),
        fob_at_arrival_kg=r2(f['rob_actual']), fob_before_kg=r2(f['fob_before']), fob_after_kg=r2(f['fob_after']),
        fob_delta_kg=r2(f['fob_delta']), ground_burn_kg=r2(f['ground_kg']), fob_source='ACARS', fob_rounding_kg=0,
        recon_variance_kg=r2(f['recon_var']), recon_status=recon, supplier_count=1, delivery_method=f['method'],
        flight_variance_kg=r2(-f['recon_var']), flight_variance_status=recon, flight_metered_kg=r2(f['ticket_kg']),
        flight_delivered_kg=r2(f['fob_delta']), flight_tolerance_kg=band,
        refuel_start_utc=iso(f['refuel_start']), refuel_end_utc=iso(f['refuel_end']), refuel_complete='true',
        created_at=iso(f['refuel_start']), created_by=SEED_USER, modified_at=iso(f['refuel_end']), modified_by=SEED_USER))
    pref = SUPPLIER_DEFS[sup][2]
    base = tkt_run.setdefault((sup, code), 100000 + int(h(sup + code, 'run') * 700000))
    tkt_run[(sup, code)] = base + 1 + int(h(f['key'], 'gap') * 3)
    f['ticket_number'] = f'{pref}-{code}-{base:06d}'
    f['ticket_id'] = uid('FT', f['leg_id'])
    meter0 = round(100000 + h(veh + day, 'mtr') * 800000, 2)
    electronic = f['method'] == 'HYD' or REGION[code] == 'EUR'
    ticket_rows.append(dict(
        ID=f['ticket_id'], order_ID=f['order_id'], match_status='MATCHED', ticket_source='E' if electronic else 'M',
        ticket_capture_source='ELECTRONIC' if electronic else 'MANUAL', delivery_ID=f['delivery_id'],
        ticket_number=f['ticket_number'], internal_number=f'FT-{code}-{ymd}-{seq_t[(code, day)]:04d}',
        aircraft_reg=f['tail'], tail_registration=f['tail'], flight_ID=f['id'], flight_number=f['flight_number'],
        quantity=f'{dl:.2f}', uom_code='LTR', meter_start=f'{meter0:.2f}', meter_end=f'{meter0 + dl:.2f}',
        quantity_metered=f'{dl:.2f}', density_value=f'{f["rho"]:.4f}', density_uom='KGL', density_basis='MEA',
        density_temp_c=f'{f["temp"]:.2f}', quantity_flag='GR', quantity_kg=r2(f['ticket_kg']),
        batch_coa_ref=f'COA-{code}-{ymd}-{1 + int(h(code + day, "coa") * 3)}', rate_per_litre=f'{price_l:.4f}',
        total_amount=money(dl * price_l), delivery_timestamp=iso(f['refuel_start']),
        supplier_ticket_ref=f'{pref}-DN-{base:06d}', status='Verified', verified_by='fuel.ops@airline.com',
        verified_at=iso(f['refuel_end'] + dt.timedelta(hours=2)), vehicle_id=veh, meter_serial=f'MTR-{veh}',
        created_at=iso(f['refuel_end']), created_by=SEED_USER, modified_at=iso(f['refuel_end']), modified_by=SEED_USER))
    f['ticket_amount'] = money(dl * price_l)

# ---------------------------------------------------------------------------
# 8. Rows
# ---------------------------------------------------------------------------
new_airports = {}
for s in stations:
    if s in existing_airports:
        continue
    a = AIRPORTS[s]
    new_airports[s] = dict(ID=uid('AP', s), iata_code=s, icao_code=a['icao'], airport_name=a['name'][:100],
                           city=a['city'][:50], country_code=a['country'], timezone=a['tz'], s4_plant_code=None,
                           is_active='true', created_at=SEED_TS, created_by=SEED_USER,
                           modified_at=SEED_TS, modified_by=SEED_USER)


def airport_id(code):
    return existing_airports[code]['ID'] if code in existing_airports else new_airports[code]['ID']


FS_COLS = ['ID', 'flight_number', 'flight_date', 'aircraft_type', 'aircraft_reg', 'tail_registration',
           'flight_leg_id', 'origin_airport', 'destination_airport', 'scheduled_departure', 'scheduled_arrival',
           'status', 'fuel_order_number', 'airline_code', 'flight_suffix', 'service_type', 'departure_terminal',
           'arrival_terminal', 'gate_number', 'stand_number', 'sobt', 'sibt', 'eobt', 'eibt', 'aobt', 'aibt',
           'atot', 'aldt', 'planned_block_mins', 'actual_block_mins', 'flight_nature', 'linked_flight_number',
           'linked_flight_date', 'codeshare_flights', 'delay_code', 'delay_minutes', 'cancellation_reason',
           'booked_passengers', 'boarded_passengers', 'cargo_kg', 'captain_name', 'fob_at_out_kg',
           'fob_at_off_kg', 'fob_at_on_kg', 'fob_at_in_kg', 'fob_source', 'flight_closure_utc', 'closure_source',
           'closure_document_ID', 'flight_start_utc', 'start_source', 'actual_origin_ID', 'actual_origin_airport',
           'actual_destination_ID', 'actual_destination_airport', 'created_at', 'created_by', 'modified_at',
           'modified_by']
FD_COLS = ['ID', 'dispatch_order_id', 'flight_number', 'flight_date', 'flight_schedule_ID', 'fuel_order_ID',
           'tail_number', 'tail_registration', 'captain_id', 'dispatcher_id', 'atd', 'ata', 'atd_local',
           'ata_local', 'std_gst', 'sta_gst', 'atd_gst', 'ata_gst', 'dispatch_timestamp', 'dispatch_qty_kg',
           'trip_fuel_kg', 'contingency_fuel_kg', 'alternate_fuel_kg', 'final_reserve_kg', 'additional_fuel_kg',
           'taxi_fuel_kg', 'extra_fuel_kg', 'block_fuel_kg', 'required_uplift_kg', 'plan_group_id',
           'plan_version', 'plan_version_source', 'plan_status', 'superseded_by_ID', 'version_gap_flag',
           'versions_skipped', 'rob_departure_kg', 'payload_kg', 'payload_plan_kg', 'arrival_rob_plan_kg',
           'flight_level', 'wind_component', 'alternate_airport', 'dispatch_source', 'ofplan_reference',
           'remarks', 'created_at', 'created_by', 'modified_at', 'modified_by']

fs_rows, fd_rows = [], []
captains = [f'CAP-B6{n:04d}' for n in range(101, 401)]
for f in sorted(kept, key=lambda x: x['atot']):
    key, t = f['key'], f['type']
    seats = SEATS[t]
    booked = int(seats * (0.74 + h(key, 'lf') * 0.24))
    boarded = max(0, booked - int(h(key, 'ns') * 6))
    cargo = round(150 + h(key, 'cg') * (1800 if f['km'] > 2000 else 700), 2)
    cap_id = pick(f['tail'] + str(f['flight_date']), 'cap', captains)
    dep_t = TERMINALS.get(f['o'], 'MAIN')
    arr_t = TERMINALS.get(f['d'], 'MAIN')
    gate = f"{dep_t[0] if dep_t != 'MAIN' else 'G'}{1 + int(h(key, 'gate') * 30)}"
    stand = str(100 + int(h(key, 'stand') * 80))
    nxt = f['next']
    fs_rows.append(dict(
        ID=f['id'], flight_number=f['flight_number'], flight_date=str(f['flight_date']), aircraft_type=t,
        aircraft_reg=f['tail'], tail_registration=f['tail'], flight_leg_id=f['leg_id'],
        origin_airport=f['o'], destination_airport=f['d'],
        scheduled_departure=f['sobt'].strftime('%H:%M:%S'), scheduled_arrival=f['sibt'].strftime('%H:%M:%S'),
        status='ARRIVED', fuel_order_number=f['order_number'], airline_code='B6', flight_suffix=None, service_type='J',
        departure_terminal=dep_t, arrival_terminal=arr_t, gate_number=gate, stand_number=stand,
        sobt=iso(f['sobt']), sibt=iso(f['sibt']), eobt=iso(f['aobt']), eibt=iso(f['aibt']),
        aobt=iso(f['aobt']), aibt=iso(f['aibt']), atot=iso(f['atot']), aldt=iso(f['aldt']),
        planned_block_mins=f['planned_block'], actual_block_mins=f['actual_block'], flight_nature='PAX',
        linked_flight_number=nxt['flight_number'] if nxt else None,
        linked_flight_date=str(nxt['flight_date']) if nxt else None,
        codeshare_flights=None, delay_code=f['delay_code'], delay_minutes=f['delay'], cancellation_reason=None,
        booked_passengers=booked, boarded_passengers=boarded, cargo_kg=cargo,
        captain_name=f'Capt. {cap_id[4:]} (synthetic)',
        fob_at_out_kg=r2(f['fob_out']), fob_at_off_kg=r2(f['fob_off']), fob_at_on_kg=r2(f['fob_on']),
        fob_at_in_kg=r2(f['fob_in']), fob_source='ACARS',
        flight_closure_utc=iso(f['aibt']), closure_source='MANUAL', closure_document_ID=None,
        flight_start_utc=iso(f['aobt']), start_source='MANUAL',
        actual_origin_ID=airport_id(f['o']), actual_origin_airport=f['o'],
        actual_destination_ID=airport_id(f['d']), actual_destination_airport=f['d'],
        created_at=SEED_TS, created_by=SEED_USER, modified_at=SEED_TS, modified_by=SEED_USER))

    o, d = AIRPORTS[f['o']], AIRPORTS[f['d']]
    brg = bearing(o, d)
    eastbound = brg < 180
    # FAA AC 120-27F standard weights: 190 lb adult with carry-on + 0.6 checked bags at 28.5 lb = ~94 kg
    payload = boarded * 94 + cargo
    payload_plan = booked * 94 + cargo
    n_versions = len(f['earlier']) + 1
    # Release times: v1 early, each revision closer to departure, the active plan 35-110 min out
    lead = [150 + int(h(key, 'l1') * 90), 60 + int(h(key, 'l2') * 40), 35 + int(h(key, 'l3') * 20)]
    lead = lead[-n_versions:] if n_versions > 1 else [60 + int(h(key, 'l0') * 50)]
    plans = f['earlier'] + [dict(version=f['versions'][-1], stack=f['stack'], alt=f['alt'], reason=None)]
    ids = [uid('FD', f['leg_id'], p_['version']) for p_ in plans]
    for i, p_ in enumerate(plans):
        active = i == len(plans) - 1
        st = dict(p_['stack'])
        block = f['block'] if active else sum(st.values())
        if active:
            st = f['stack']
        elif block < f['rob']:
            st['extra'] += round(f['rob'] - block); block = sum(st.values())
        if not active and block > tail_cap(f['tail'], t):
            st['extra'] = max(0, st['extra'] - round(block - tail_cap(f['tail'], t))); block = sum(st.values())
        fl = flight_level(f['km'], eastbound, MAX_FL[t], key + str(p_['version']))
        jet = (35 + h(key, f'jet{p_["version"]}') * 50) * min(1.0, fl / 350)
        wind = round(-jet * math.sin(math.radians(brg)) + (h(key, f'wn{p_["version"]}') - 0.5) * 16, 1)
        skipped = f['versions'][i] - f['versions'][i - 1] - 1 if i else 0
        remark = ' - '.join(x for x in (
            'SYNTHETIC plan', f['basis'],
            None if active else f'superseded: {p_["reason"]}',
            f'ROB {f["rob_src"]}') if x)
        fd_rows.append(dict(
            ID=ids[i], dispatch_order_id=f['dispatch_order_id'],
            flight_number=f['flight_number'], flight_date=str(f['flight_date']), flight_schedule_ID=f['id'],
            fuel_order_ID=f['order_id'] if active else None, tail_number=f['tail'], tail_registration=f['tail'], captain_id=cap_id,
            dispatcher_id=pick(f['o'] + str(f['flight_date']), 'dsp', [f'DSP-B6{n:03d}' for n in range(1, 41)]),
            atd=iso(f['aobt']) if active else None, ata=iso(f['aibt']) if active else None,
            atd_local=wall(f['aobt'], f['o_tz']) if active else None,
            ata_local=wall(f['aibt'], f['d_tz']) if active else None,
            std_gst=wall(f['sobt'], GST), sta_gst=wall(f['sibt'], GST),
            atd_gst=wall(f['aobt'], GST) if active else None, ata_gst=wall(f['aibt'], GST) if active else None,
            dispatch_timestamp=iso(f['sobt'] - dt.timedelta(minutes=lead[i])),
            dispatch_qty_kg=r2(block), trip_fuel_kg=r2(st['trip']), contingency_fuel_kg=r2(st['cont']),
            alternate_fuel_kg=r2(st['alt']), final_reserve_kg=r2(st['fres']), additional_fuel_kg=r2(st['add']),
            taxi_fuel_kg=r2(st['taxi']), extra_fuel_kg=r2(st['extra']), block_fuel_kg=r2(block),
            required_uplift_kg=r2(block - f['rob']), plan_group_id=f['leg_id'], plan_version=p_['version'],
            plan_version_source=f['vsource'], plan_status='ACTIVE' if active else 'SUPERSEDED',
            superseded_by_ID=None if active else ids[i + 1],
            version_gap_flag='true' if skipped else 'false', versions_skipped=skipped,
            rob_departure_kg=r2(f['rob']),
            payload_kg=r2(payload if active else payload_plan * (0.96 + h(key, f'pp{i}') * 0.03)),
            payload_plan_kg=r2(payload_plan if active else payload_plan * (0.96 + h(key, f'pp{i}') * 0.03)),
            arrival_rob_plan_kg=r2(st['cont'] + st['alt'] + st['fres'] + st['add'] + st['extra'] - f['taxi_in'] * TAXI_KG_MIN[t]),
            flight_level=fl, wind_component=wind, alternate_airport=p_['alt'],
            dispatch_source='MANUAL',
            ofplan_reference=f'OFP-{f["flight_number"]}-{f["flight_date"]:%Y%m%d}' + (f'-V{p_["version"]}' if n_versions > 1 else ''),
            remarks=remark[:200],
            created_at=SEED_TS, created_by=SEED_USER, modified_at=SEED_TS, modified_by=SEED_USER))

for r in order_rows:
    r['airport_ID'] = airport_id(r['station_code'])

# ---------------------------------------------------------------------------
# 8b. Invoices: exactly one per supplier per station, USD
# ---------------------------------------------------------------------------
FET_PER_L = round(0.044 / GAL_L, 6)        # US federal excise tax on commercial jet fuel, 4.4 c/gal
INVOICE_DATE, RECEIVED, POSTED_ON = '2026-09-27', '2026-09-28', '2026-09-28'
billable = [f for f in sorted(kept, key=lambda x: x['atot']) if not f.get('no_uplift')]
groups = defaultdict(list)
for f in billable:
    groups[(f['supplier'], f['o'])].append(f)

# 6 tickets left uninvoiced (the unbilled-ticket exception report), at 6 different
# stations that still have other lines, and none of the gauge-variance deliveries.
unbilled = []
for f in sorted(billable, key=lambda f: h(f['key'], 'unb')):
    if len(unbilled) == 6:
        break
    if f.get('var_kind') or len(groups[(f['supplier'], f['o'])]) < 4 or any(u['o'] == f['o'] for u in unbilled):
        continue
    unbilled.append(f)
unbilled_ids = {f['id'] for f in unbilled}

inv_keys = sorted(groups, key=lambda k: (k[1], k[0]))
special = {}
ranked = sorted(inv_keys, key=lambda k: h('|'.join(k), 'inv'))
# WFS invoice A holds a ticket that is billed again on WFS invoice B (INV455 flags both)
wfs = [k for k in ranked if k[0] == 'WFSUS01' and len(groups[k]) >= 3]
special['A'], special['B'] = wfs[0], wfs[1]
rest = [k for k in ranked if k not in (special['A'], special['B']) and len(groups[k]) >= 2]
special['C'], special['D'], special['R'] = rest[0], rest[1], rest[2]      # C: 2 unknown tickets, D: 1, R: rate
others = [k for k in ranked if k not in special.values()]
posted = set()                      # nothing is posted: every invoice is awaiting posting
EXC = {special['A'], special['B'], special['C'], special['D'], special['R']}
AUTO = 'SYSTEM (auto-approved: three-way matched within tolerance)'
GATE_AT = '2026-09-27T16:00:00Z'

dup_ticket_flight = [f for f in groups[special['A']] if f['id'] not in unbilled_ids][0]['id']
invoice_rows, item_rows = [], []
existing_tickets = {f['ticket_number'] for f in billable}
seq_inv = Counter()
for n, key in enumerate(inv_keys, start=1):
    sup, code = key
    pref = SUPPLIER_DEFS[sup][2]
    seq_inv[pref] += 1
    inv_id = uid('INV', sup, code)
    lines = [dict(kind='TICKET', f=f) for f in groups[key] if f['id'] not in unbilled_ids]
    if key == special['B']:
        lines.append(dict(kind='DUP', f=next(f for f in billable if f['id'] == dup_ticket_flight)))
    if key in (special['C'], special['D']):
        for j in range(2 if key == special['C'] else 1):
            base = 900000 + int(h(code + str(j), 'ghost') * 90000)
            ghost = f'{pref}-{code}-{base:06d}'
            assert ghost not in existing_tickets
            lines.append(dict(kind='GHOST', number=ghost, qty=4000 + int(h(ghost, 'gq') * 9000),
                              day=['2026-09-24', '2026-09-25', '2026-09-26'][j % 3]))
    us = AIRPORTS[code]['country'] == 'US' and code != 'SJU'
    net_total = tax_total = price_var_total = 0.0
    counts = Counter()
    for i, ln in enumerate(lines):
        item = dict(ID=uid('II', inv_id, i), invoice_ID=inv_id, line_number=(i + 1) * 10, tax_code='U1' if us else 'V0',
                    uom_code='LTR', cost_center=f'FUEL{code}', gl_account='400000', review_status='NONE')
        if ln['kind'] == 'GHOST':
            qty, price = float(ln['qty']), round((spot(code, ln['day']) + 0.30) / GAL_L, 4)
            item.update(product_ID=product_for(code), description=f'Jet A into-plane {code} ticket {ln["number"]}',
                        po_number=None, po_item=None, ticket_number=ln['number'], ticket_ID=None, delivery_ID=None,
                        fuel_order_ID=None, flight_ID=None, resolved_po_number=None, resolved_gr_number=None,
                        resolution_source='UNRESOLVED', ticket_quantity_kg=None, ticket_rate=None, ticket_amount=None)
        else:
            f = ln['f']
            qty = float(f['delivered_l'])
            price = f['price_l']
            if key == special['R']:
                price = round(price + (1 + int(h(f['key'], 'rm') * 5)) / 100, 4)   # +1..5 cents per litre
            item.update(product_ID=product_for(f['o']),
                        description=f'Jet A into-plane {f["o"]} {f["flight_number"]} {f["flight_date"]:%d%b} {f["tail"]}',
                        po_item='00010',
                        ticket_number=f['ticket_number'], ticket_ID=f['ticket_id'], delivery_ID=f['delivery_id'],
                        fuel_order_ID=f['order_id'], flight_ID=f['id'], resolution_source='TICKET_NUMBER',
                        resolved_gr_number=f['gr_number'], ticket_quantity_kg=r2(f['ticket_kg']),
                        ticket_rate=round(f['ticket_amount'] / f['ticket_kg'], 4), ticket_amount=f['ticket_amount'])
            po = next(o['s4_po_number'] for o in order_rows if o['ID'] == f['order_id'])
            item.update(po_number=po, resolved_po_number=po)
        net = money(qty * price)
        tax = money(qty * FET_PER_L) if us else 0.0
        # The verdict validateForPosting reaches on this line (confirmed by running it)
        sev, lstat, pvp = None, 'MATCHED', 0.0
        if ln['kind'] == 'GHOST':
            sev, lstat = 'HARD', 'EXCEPTION'                                  # INV462
        elif ln['kind'] == 'DUP' or (key == special['A'] and ln['f']['id'] == dup_ticket_flight):
            sev, lstat = 'HARD', 'EXCEPTION'                                  # INV455, both lines
        elif key == special['R']:
            pvp = round((price - ln['f']['price_l']) / ln['f']['price_l'] * 100, 2)
            sev = 'HARD' if pvp >= 3 else 'SOFT' if pvp >= 1 else 'WARN' if pvp >= 0.25 else None
            lstat = 'PRICE_VARIANCE' if sev else 'MATCHED'                   # INV452 ladder
            price_var_total += money(qty * (price - ln['f']['price_l']))
        counts[sev] += 1
        net_total += net; tax_total += tax
        item.update(quantity=f'{qty:.3f}', unit_price=f'{price:.4f}', net_amount=f'{net:.2f}', tax_amount=f'{tax:.2f}',
                    line_match_status=lstat, price_variance_pct=f'{pvp:.2f}', qty_variance_pct='0.00' if ln['kind'] != 'GHOST' else None,
                    tolerance_status='EXCEEDED' if sev in ('HARD', 'SOFT') else 'WITHIN', sap_line_number=None)
        item_rows.append(item)
    net_total, tax_total = money(net_total), money(tax_total)
    tag = ('re-bills a ticket already invoiced on ' + f'{SUPPLIER_DEFS[special["A"][0]][2]}-{special["A"][1]}' if key == special['B']
           else 'holds the original line of a ticket re-billed on ' + f'{SUPPLIER_DEFS[special["B"][0]][2]}-{special["B"][1]}' if key == special['A']
           else '2 lines cite tickets that do not exist' if key == special['C']
           else '1 line cites a ticket that does not exist' if key == special['D']
           else 'unit rate 1-5 c/L above the order price on every line' if key == special['R'] else None)
    clean = key not in EXC
    gated = counts['HARD'] + counts['SOFT'] > 0
    assert clean != gated, key
    invoice_rows.append(dict(
        ID=inv_id, invoice_number=f'{pref}-{code}-260927-{seq_inv[pref]:02d}',
        internal_number=f'INV-{pref}-20260927-{seq_inv[pref]:03d}', supplier_ID=supplier_id(sup),
        invoice_date=INVOICE_DATE, posting_date=None, due_date='2026-10-27',
        baseline_date=INVOICE_DATE, currency_code='USD', net_amount=f'{net_total:.2f}', tax_amount=f'{tax_total:.2f}',
        gross_amount=f'{money(net_total + tax_total):.2f}', stated_net_amount=f'{net_total:.2f}',
        stated_gross_amount=f'{money(net_total + tax_total):.2f}', stated_line_count=len(lines),
        payment_terms='NET30', discount_percent=None, discount_date=None,
        match_status='MATCHED' if clean else 'PRICE_VARIANCE' if key == special['R'] else 'EXCEPTION',
        price_variance=f'{money(price_var_total):.2f}', quantity_variance='0.00',
        variance_percentage=f'{(price_var_total / net_total * 100) if net_total else 0:.2f}',
        approval_status='APPROVED' if clean else 'PENDING', requires_dual_approval='false',
        first_approver=AUTO if clean else None, first_approved_at=GATE_AT if clean else None,
        final_approver=AUTO if clean else None, final_approved_at=GATE_AT if clean else None,
        s4_document_number=None, s4_fiscal_year=None, s4_company_code='JB01', received_date=INVOICE_DATE,
        sap_invoice_number=None, s4_payment_document=None, payment_date=None,
        tolerance_status='WITHIN' if clean else 'EXCEEDED', fi_posting_status=None,
        status='VERIFIED' if clean else 'SUBMITTED',
        notes=(f'SYNTHETIC B6 test invoice, {code}, 24-26 Sep 2026. '
               + ('Three-way matched within tolerance and auto-approved. Not yet posted.' if clean
                  else f'Seeded exception: {tag}. Not approved, not posted.'))[:1000],
        rejection_reason=None, is_duplicate='false', duplicate_of_ID=None,
        posting_gate='GATED' if gated else 'CLEAR', gate_evaluated_at=GATE_AT,
        open_hard_count=counts['HARD'], open_soft_count=counts['SOFT'], warning_count=counts['WARN'],
        created_at='2026-09-27T15:00:00Z', created_by=SEED_USER, modified_at=GATE_AT, modified_by=SEED_USER))

type_counts = Counter()
tails = {}
for f in kept:
    tails[f['tail']] = f['type']
for tail, t in tails.items():
    type_counts[t] += 1
reg_rows = []
for tail, t in sorted(tails.items()):
    if tail in existing_regs:
        continue
    reg_rows.append(dict(registration=tail, aircraft_type_code=t, dry_operating_weight_kg=f'{DOW[t]:.2f}',
                         fuel_capacity_kg=f'{tail_cap(tail, t):.2f}', apu_burn_rate_kg_hr=f'{APU[t]:.2f}',
                         apu_rate_source='REGISTER', performance_factor_pct=f'{perf[tail]:.3f}',
                         record_status='CONFIRMED', provisional_expiry=None, confirmed_by='fleet.admin@airline.com',
                         confirmed_at=SEED_TS, operator_code='JBU', on_own_aoc='true', cost_object_type=None,
                         cost_object_id=None, is_active='true', created_at=SEED_TS, created_by=SEED_USER,
                         modified_at=SEED_TS, modified_by=SEED_USER))
am_rows = [dict(**NEW_TYPE_A21N, fleet_size=type_counts['A21N'], status_status_code='ACTIVE', is_active='true',
                created_at=SEED_TS, created_by=SEED_USER, modified_at=SEED_TS, modified_by=SEED_USER)]
countries_needed = sorted({AIRPORTS[s]['country'] for s in stations} - existing_countries)
t005_rows = [dict(land1=c, landx=T005_NEW[c][0], landx50=T005_NEW[c][1], natio=T005_NEW[c][2],
                  landgr=T005_NEW[c][3], currcode=T005_NEW[c][4], spras='E', is_active='true')
             for c in countries_needed]

# ---------------------------------------------------------------------------
# 9. Field gap analysis
# ---------------------------------------------------------------------------
S, I, D, Y, B = 'SOURCE', 'INFERRED', 'DERIVED', 'SYNTHETIC', 'BLANK BY DESIGN'
GAP_FS = [
    ('ID', 'UUID', 'key', '-', D, 'UUIDv5 of flight_leg_id + wheels-off time. Stable across re-runs'),
    ('flight_number', 'String(10)', 'mandatory', 'Flight No', S, '"B6 2725" -> "B62725" (repository format, e.g. AC901)'),
    ('flight_date', 'Date', 'mandatory', 'Date (UTC)', D, 'LOCAL date of scheduled departure at origin. The extract dates by UTC, which moves every evening US departure to the next day'),
    ('aircraft_type', 'String(10)', 'FK AIRCRAFT_MASTER', 'Aircraft Type', S + '/' + I, 'A220-300->A223, A320, A321, A321neo->A21N (NEW type row). 4 "Unknown" tails inferred from registration series (N3xxxJ = A220-300)'),
    ('aircraft_reg', 'String(10)', '', 'Tail Number', S, ''),
    ('tail_registration', 'FK', 'FK AIRCRAFT_REGISTRATIONS', 'Tail Number', S, 'Requires the tail on AIRCRAFT_REGISTRATIONS (NEW rows, CONFIRMED so MDM402 does not block orders)'),
    ('flight_leg_id', 'String(40)', 'ENR452', '-', D, '<flight_number>-<yyyymmdd>-<origin>; suffixed -2 on the rare exact repeat'),
    ('origin_airport', 'String(3)', 'mandatory, FK MASTER_AIRPORTS', 'Origin', S + '/' + I, 'Blank origins recovered from the previous leg on the same tail. Needs NEW MASTER_AIRPORTS rows'),
    ('destination_airport', 'String(3)', 'mandatory, FK MASTER_AIRPORTS', 'Destination', S + '/' + I, 'Blank destinations recovered from the next leg on the same tail'),
    ('scheduled_departure / scheduled_arrival', 'Time', '', '-', D, 'UTC clock time of sobt / sibt (backward-compatible fields)'),
    ('status', 'FlightStatus', '@assert.range', 'Status', D, 'Complete / Landing inferred -> ARRIVED. Signal lost and Airborne at end of data are excluded (no touchdown)'),
    ('fuel_order_number', 'String(25)', '', '-', D, 'The flight\'s FUEL_ORDERS.order_number (denormalised, as the order-creation path writes it)'),
    ('airline_code', 'String(3)', '', 'Flight No prefix', S, 'B6'),
    ('flight_suffix', 'String(2)', '', '-', B, 'Operational suffix is used only for re-timed/duplicated legs; none in the extract'),
    ('service_type', 'String(1)', '', '-', D, 'J (scheduled passenger)'),
    ('departure_terminal / arrival_terminal', 'String(10)', '', '-', Y, 'B6 terminals at 12 main stations (JFK T5, BOS C, FLL T3, MCO C ...); MAIN elsewhere'),
    ('gate_number / stand_number', 'String(10)', '', '-', Y, 'Hash-drawn per leg'),
    ('sobt / sibt', 'DateTime', '', '-', Y, 'sobt = AOBT less a synthetic delay, floored to 5 min (18% of legs 15-90 min late). sibt = sobt + planned block'),
    ('eobt / eibt', 'DateTime', '', '-', D, 'Equal to AOBT / AIBT: estimates collapse to actuals once the flight is complete'),
    ('atot', 'DateTime', '', 'Departure (UTC)', S, 'Wheels-off per ADS-B'),
    ('aldt', 'DateTime', '', 'Arrival (UTC)', S, 'Touchdown per ADS-B ("Landing inferred" = signal lost low on approach)'),
    ('aobt / aibt', 'DateTime', '', '-', D, 'ATOT less taxi-out (12-24 min, longer at busy hubs); ALDT plus taxi-in (5-11 min)'),
    ('planned_block_mins', 'Integer', '', '-', Y, 'Actual block x 0.97-1.05, rounded up to 5 min'),
    ('actual_block_mins', 'Integer', '', 'Duration (min)', D, 'AIBT - AOBT (the source duration is airborne only)'),
    ('flight_nature', 'String(10)', '', '-', D, 'PAX'),
    ('linked_flight_number / linked_flight_date', 'String/Date', '', 'Tail Number + times', I, 'NEXT leg of the same tail within 24 h. Real rotations from ADS-B, directional (see D60)'),
    ('codeshare_flights', 'String(100)', '', '-', B, 'Not in the extract; would need a schedule source'),
    ('delay_code / delay_minutes', 'String/Integer', '', '-', Y, 'IATA code only where delay >= 15 min'),
    ('cancellation_reason', 'String(200)', '', '-', B, 'No cancelled flights: ADS-B only sees flights that flew'),
    ('booked_passengers / boarded_passengers', 'Integer', '', '-', Y, 'Seats (A223 140, A320 162, A321/A21N 200) x load factor 74-98%; boarded = booked less 0-5 no-shows'),
    ('cargo_kg', 'Decimal', '', '-', Y, '150-850 kg domestic, up to 1,950 kg long sectors'),
    ('captain_name', 'String(100)', '', '-', Y, '"Capt. B6nnnn (synthetic)". Same captain as dispatch captain_id'),
    ('fob_at_out/off/on/in_kg', 'Decimal', '', '-', D, 'OUT = block fuel; OFF = OUT - taxi-out burn; ON = OFF - real airborne time x cruise burn x 1.05 x tail performance factor; IN = ON - taxi-in burn'),
    ('fob_source', 'FobSource', '', '-', Y, 'ACARS so the ACARS burn path is exercised. The values are computed, not downlinked: change to CREW_REPORTED if the claim matters'),
    ('flight_start_utc / start_source', 'Timestamp', '', '-', D, 'AOBT / MANUAL'),
    ('flight_closure_utc / closure_source', 'Timestamp', '', '-', D, 'AIBT / MANUAL'),
    ('closure_document_ID', 'FK SOURCE_DOCUMENTS', '', '-', B, 'Needs a scanned handover document row. None exists for these flights'),
    ('actual_origin(_ID/_airport)', 'FK + String(3)', '', 'Origin', D, 'As flown = planned (diversions were excluded). _ID points at the MASTER_AIRPORTS row'),
    ('actual_destination(_ID/_airport)', 'FK + String(3)', '', 'Destination', D, 'As flown = planned'),
    ('created_at/by, modified_at/by', 'AuditTrail', '', '-', D, 'SEED_B6_ADSB so every seeded row is identifiable'),
]
GAP_FD = [
    ('ID', 'UUID', 'key', '-', D, 'UUIDv5 of plan_group_id + plan_version'),
    ('dispatch_order_id', 'String(20)', 'mandatory', '-', Y, 'FO-B6-2026-nnnnn in wheels-off order. Same on every version of a plan: no order was confirmed to a supplier, so no commercial boundary was crossed (A7)'),
    ('flight_number / flight_date', '', 'mandatory', 'Flight No', D, 'Same as FLIGHT_SCHEDULE'),
    ('flight_schedule_ID', 'FK', '', '-', D, 'Links directly, so the DSP458 number+date ambiguity cannot bite in the CSV seed'),
    ('fuel_order_ID', 'FK', '', '-', D, 'The flight\'s order on the ACTIVE plan (the order claims the active plan, D44). Blank on superseded versions'),
    ('tail_number / tail_registration', '', 'import-required', 'Tail Number', S, ''),
    ('captain_id / dispatcher_id', 'String(20)', 'import-required', '-', Y, 'CAP-B6nnnn per tail per day; DSP-B6nnn per station per day'),
    ('atd / ata', 'DateTime', 'ATD import-required', '-', D, 'AOBT / AIBT on the ACTIVE plan. Blank on superseded plans: a plan replaced before departure never flew'),
    ('atd_local / ata_local', 'DateTime', '', '-', D, 'AOBT / AIBT as origin / destination wall-clock time, WITHOUT an offset (HANA stores none, and an offset is a load risk there)'),
    ('std_gst / sta_gst / atd_gst / ata_gst', 'DateTime', '', '-', D, 'Same instants on a UTC+4 wall clock, no offset. The GST clock is an inherited template field and means nothing for B6'),
    ('dispatch_timestamp', 'DateTime', 'import-required', '-', Y, 'Single plan: 60-110 min before STD. Revised: v1 150-240 min, v2 60-100 min, v3 35-55 min before STD'),
    ('trip_fuel_kg', 'Decimal', '', '-', D, 'Climb/descent allowance by type (A223 350, A320 500, A321 600, A21N 500 kg) + cruise burn x (planned airborne min - 20)'),
    ('contingency_fuel_kg', 'Decimal', '', '-', D, '14 CFR 121.645 flag legs: 10% of trip TIME at cruise burn. Domestic (121.639): 0, none required'),
    ('alternate_fuel_kg', 'Decimal', '', '-', D, 'Half the climb allowance + (km to alternate / 650 km/h + 8 min approach) x 95% cruise burn. 0 on an island-reserve plan'),
    ('final_reserve_kg', 'Decimal', '', '-', D, 'Domestic: 45 min at cruise burn (121.639). Flag: 30 min holding at 80% of cruise burn (121.645). 0 on an island-reserve plan'),
    ('additional_fuel_kg', 'Decimal', '', '-', Y, 'Island reserve (121.645(c), BDA): 2 h at cruise burn. Otherwise 10-20 min holding on 25% of legs into congested hubs; else 0'),
    ('taxi_fuel_kg', 'Decimal', '', '-', D, 'Taxi-out minutes x type taxi burn (A223 9, A320 11, A321 13, A21N 11 kg/min)'),
    ('extra_fuel_kg', 'Decimal', '', '-', Y, "Commander's discretion: 0 on 72% of legs, 300-900 kg otherwise; absorbs any tankered surplus so uplift is never negative"),
    ('block_fuel_kg / dispatch_qty_kg', 'Decimal', 'DISPATCH_QTY_KG import-required', '-', D, 'DSP450: sum of the seven terms; dispatch_qty_kg equals it. Capped at the tail\'s fuel capacity'),
    ('required_uplift_kg', 'Decimal', '', '-', D, 'DSP451: block - rob_departure_kg, exactly as deriveStack() computes it'),
    ('plan_group_id', 'String(40)', 'DSP452', '-', D, 'flight_leg_id. Exactly one ACTIVE row per group'),
    ('plan_version / plan_status', '', 'DSP453', '-', Y, '70% one plan; 22% v1+v2; 6% v1+v2+v3; 2% v1+v3 (v2 never arrived). Latest ACTIVE, earlier SUPERSEDED'),
    ('plan_version_source', 'PlanVersionSource', '', '-', Y, 'ASSIGNED for one- and two-version plans, FEED where the source numbered the versions (the three-version and gapped families)'),
    ('superseded_by_ID', 'FK', '', '-', D, 'On a SUPERSEDED row, the next version of the same plan. Blank on the ACTIVE row'),
    ('version_gap_flag / versions_skipped', '', 'DSP456', '-', D, 'Stamped on the row that arrived after a gap (v3 following v1: true / 1). false / 0 everywhere else'),
    ('rob_departure_kg', 'Decimal', 'import-required', '-', D, "Fuel on board as the PLANNER knows it: the inbound leg's planned on-block ROB (its arrival_rob_plan_kg). Seeded on each tail's first leg (flagged). So required_uplift_kg = dispatch qty - planned arrival ROB, the fuel order quantity"),
    ('payload_kg / payload_plan_kg', 'Decimal', 'PAYLOAD_KG import-required', '-', D, 'FAA AC 120-27F standard weights: 94 kg per passenger incl. bags, boarded (plan: booked) + cargo. Superseded plans carry a 1-4% lighter estimate'),
    ('arrival_rob_plan_kg', 'Decimal', '', '-', D, 'Planned ROB at ON-BLOCKS: contingency + alternate + final reserve + additional + extra, less planned taxi-in fuel. The NEXT leg orders against this'),
    ('flight_level', 'Integer', '', '-', D, 'Target by sector length (FL240 short hop to FL380 long haul), then the FAA semicircular rule: eastbound odd, westbound even; capped at type ceiling'),
    ('wind_component', 'Decimal', '', '-', Y, 'Westerly jet of 35-85 kt (weaker below FL350) resolved onto the route bearing: westbound headwind (+), eastbound tailwind (-), north-south near zero'),
    ('alternate_airport', 'String(3)', '', '-', D, 'Nearest commercial station 100 km+ away, same country first. PDX, BQN, LIR, MBJ, BGI used where the usual alternate is outside the extract. Blank = island reserve (BDA)'),
    ('dispatch_source', 'String(15)', 'import-required', '-', D, 'MANUAL (not TRIPRECORD: no real flight plan exists)'),
    ('ofplan_reference', 'String(30)', '', '-', Y, 'OFP-<flight>-<yyyymmdd>, with -V<n> where the plan was revised'),
    ('remarks', 'String(200)', '', '-', D, 'SYNTHETIC, the fuel rule applied, why a version was superseded, and where the ROB came from'),
]

GAP_TXN = [
    ('FUEL_ORDERS', 'ordered_quantity_kg / planned_quantity_kg', D, 'Active plan dispatch_qty_kg - rob_departure_kg (the inbound leg\'s PLANNED on-block ROB) = the plan\'s required_uplift_kg, so no variance reason is needed'),
    ('FUEL_ORDERS', 'ordered_quantity / uom_code / conversion_density', D, 'kg / 0.8000 (UOM_MASTER, as the seed\'s S1 order uses it), in LTR'),
    ('FUEL_ORDERS', 'unit_price / total_amount / currency_code', D, 'Station into-plane price on the flight date in USD/L (see Prices below); total = ordered litres x price'),
    ('FUEL_ORDERS', 'status', D, 'Completed, except 5 Cancelled: flights that needed no fuel because the previous sector tankered (that order is TANKERING, 2 sectors)'),
    ('FUEL_ORDERS', 'supplier / contract / product', D, 'Station supplier (6 stations have two, split by flight number), its 2026 USD contract, Jet A (US) or Jet A-1'),
    ('FUEL_ORDERS', 's4_po_number / s4_po_item', Y, '4500300001.. on every delivered order; none on cancelled ones'),
    ('FUEL_ORDERS', 'crew review, communication, dispatch_fuel_order_id, dispatch_plan', D, 'CONFIRMED by the flight\'s captain; ACKNOWLEDGED to the supplier; linked to the active dispatch plan'),
    ('FUEL_DELIVERIES', 'delivered_quantity (LTR)', D, 'Litres needed to reach block fuel at off-blocks (after APU burn), never above the ordered litres, and at least 500 kg'),
    ('FUEL_DELIVERIES', 'temperature / density / temperature_corrected_qty', Y, 'Late-September station temperature by latitude; Jet A 0.798-0.813 kg/L at 15 C corrected for temperature; ASTM D1250 alpha 0.00099'),
    ('FUEL_DELIVERIES', 'fob_at_arrival / before / after / delta / ground_burn', D, 'Arrival = inbound leg FOB at IN; before = arrival - APU burn to refuel start; after = before + delta; delta = ticket kg - gauge variance'),
    ('FUEL_DELIVERIES', 'recon_variance_kg / recon_status', D, 'EPD461: ticket kg - fob_delta. Within 25 kg or 0.1% on all but 10 deliveries (5 ~500 kg, 5 ~1%), which exceed TOL-FOB-ACARS (0.5% / 50 kg) and read VARIANCE'),
    ('FUEL_DELIVERIES', 'flight_variance_*', D, 'Delivered kg (gauge delta) - ticket kg, band max(0.5%, 50 kg): the figures flight-variance.js intends. It would recompute from delivered_quantity, which is LTR here - see README'),
    ('FUEL_DELIVERIES', 'refuel window, vehicle, method, GR', Y, 'Start 30-50 min before off-blocks (not before arrival + 6 min), 900 L/min hydrant or 600 L/min refueller; GR 5000300001..; status Posted'),
    ('FUEL_DELIVERIES', 'gauge / signature documents', B, 'No SOURCE_DOCUMENTS rows exist for these deliveries (D51)'),
    ('FUEL_TICKETS', 'quantity / meter_start / meter_end / quantity_metered', D, 'Metered litres = delivered litres; meter span equals the quantity (EPD411 clean)'),
    ('FUEL_TICKETS', 'density / quantity_kg', D, 'EPD453: metered x density, density KGL measured at the delivery temperature'),
    ('FUEL_TICKETS', 'rate_per_litre / total_amount', D, 'The order unit price; total = metered x rate'),
    ('FUEL_TICKETS', 'ticket_number', Y, '<supplier prefix>-<station>-<6-digit running number>, unique'),
    ('INVOICES', 'one per supplier per station', D, f'{len(invoice_rows)} invoices dated 27 Sep 2026, USD, NET30. NONE POSTED. Three-way matched ones: VERIFIED, MATCHED, APPROVED (auto, no manual approval needed), posting gate CLEAR - ready to post. The 6 with exceptions: SUBMITTED, PENDING, GATED'),
    ('INVOICES', 'net / tax / gross / stated_*', D, 'Derived from the lines (INV454); stated figures equal them. Tax = US federal excise 4.4 c/gal on US-station lines, 0 elsewhere'),
    ('INVOICE_ITEMS', 'quantity / unit_price / net_amount', D, 'Ticket litres exactly; ticket rate; net = qty x price (INV469). One invoice carries +1 to 5 c/L on every line'),
    ('INVOICE_ITEMS', 'ticket_number / ticket_ID / resolution', D, 'Resolved as the app writes it (TICKET_NUMBER), so the unbilled-ticket report reads correctly at once. 3 lines cite tickets that do not exist (UNRESOLVED)'),
    ('INVOICE_ITEMS', 'po_number / resolved PO and GR', D, 'The order PO and delivery GR, so INV464-466 resolve'),
]
# ---------------------------------------------------------------------------
# 10. Write the workbook
# ---------------------------------------------------------------------------
wb = openpyxl.Workbook()
HDR = PatternFill('solid', fgColor='1F3864')
HFONT = Font(bold=True, color='FFFFFF')
KIND_FILL = {S: 'E2EFDA', I: 'DDEBF7', D: 'FFF2CC', Y: 'FCE4D6', B: 'EDEDED'}


def sheet(title, cols, rows, widths=None):
    w = wb.create_sheet(title)
    w.append(cols)
    for c in w[1]:
        c.fill, c.font = HDR, HFONT
    for r in rows:
        w.append([r.get(c) if isinstance(r, dict) else r[i] for i, c in enumerate(cols)])
    w.freeze_panes = 'B2'
    for i, c in enumerate(cols, 1):
        w.column_dimensions[get_column_letter(i)].width = (widths or {}).get(c, max(12, min(40, len(c) + 2)))
    return w


kept_n = len(kept)
excl = Counter(f['reason'].split(':')[0] for f in src if f['reason'])
inferred_o = sum(1 for f in kept if any('origin INFERRED' in x for x in f['flags']))
inferred_d = sum(1 for f in kept if any('destination INFERRED' in x for x in f['flags']))
seeded_rob = sum(1 for f in kept if f['rob_src'].startswith('SEEDED'))
dsp458 = sum(1 for f in kept if any(x.startswith('DSP458') for x in f['flags']))

readme = wb.active
readme.title = 'README'
lines = [
    ('FuelSphere seed workbook: JetBlue (B6) 24-26 September 2026', True),
    ('Built by docs/test-data/jetblue/build_seed_workbook.py from the ADS-B extract. Re-run the script to regenerate.', False),
    ('', False),
    ('WHAT THE EXTRACT HAD, AND WHAT IT LACKED', True),
    (f'{len(src)} ADS-B tracks. 15 columns: flight no, origin/destination, wheels-off, touchdown, tail, type, status.', False),
    ('FLIGHT_SCHEDULE has 59 persistent columns and FLIGHT_DISPATCH 50. The extract fills 9 of them directly. See Field_Gap_Analysis for every field.', False),
    ('ADS-B sees wheels-off and touchdown only. It has no schedule times, no block times, no passengers, no crew, no fuel, and no flight plan. Everything else is inferred, derived or synthetic, and each field says which.', False),
    ('', False),
    ('ROWS', True),
    (f'{kept_n} flights are seed-ready. {len(src) - kept_n} tracks are excluded (Row_Quality sheet, one reason each):', False),
] + [(f'    {n:>4}  {r}', False) for r, n in excl.most_common()] + [
    (f'{inferred_o} origins and {inferred_d} destinations the extract left blank were recovered from the same tail\'s neighbouring legs.', False),
    (f'{seeded_rob} dispatches open a tail\'s chain in the extract, so their pre-uplift ROB is seeded rather than carried (flagged). All the others carry the previous leg\'s FOB at IN, so the ROB chain is closed on every tail from its second leg on, which fixes the D59 shape for this data.', False),
    (f'{dsp458} flights share flight number + date with another leg (through-numbered B6 flights). The CSV seed links by flight_schedule_ID so this does not matter. A dispatch EXCEL import of those rows would be refused as DSP458.', False),
    ('', False),
    ('LOAD ORDER. Master data first: FLIGHT_SCHEDULE references airports and tails, and the load fails without them.', True),
    (f'  1. T005_COUNTRY_add        -> append to db/data/fuelsphere-T005_COUNTRY.csv        ({len(t005_rows)} rows)', False),
    (f'  2. MASTER_AIRPORTS_add     -> append to db/data/fuelsphere-MASTER_AIRPORTS.csv     ({len(new_airports)} rows)', False),
    (f'  3. AIRCRAFT_MASTER_add     -> append to db/data/fuelsphere-AIRCRAFT_MASTER.csv     ({len(am_rows)} row: A21N)', False),
    (f'  4. AIRCRAFT_REGISTRATIONS_add -> append to db/data/fuelsphere-AIRCRAFT_REGISTRATIONS.csv ({len(reg_rows)} rows)', False),
    (f'  5. FLIGHT_SCHEDULE         -> append to db/data/fuelsphere-FLIGHT_SCHEDULE.csv     ({len(fs_rows)} rows)', False),
    (f'  6. FLIGHT_DISPATCH         -> append to db/data/fuelsphere-FLIGHT_DISPATCH.csv     ({len(fd_rows)} rows: every version of every plan)', False),
    (f'  7. MASTER_SUPPLIERS_add    -> fuelsphere-MASTER_SUPPLIERS.csv     ({len(supplier_rows)} rows; BPUK001, ATINT01, WFS001 are reused from the seed)', False),
    (f'  8. MASTER_CONTRACTS_add    -> fuelsphere-MASTER_CONTRACTS.csv     ({len(contract_rows)} rows, one USD 2026 contract per supplier)', False),
    (f'  9. MASTER_PRODUCTS_add     -> fuelsphere-MASTER_PRODUCTS.csv      ({len(product_rows)} row: Jet A for US stations)', False),
    (f' 10. DESIGNATED_SUPPLIERS_add -> fuelsphere-DESIGNATED_SUPPLIERS.csv ({len(desig_rows)} rows)', False),
    (f' 11. FUEL_ORDERS             -> fuelsphere-FUEL_ORDERS.csv          ({len(order_rows)} rows)', False),
    (f' 12. FUEL_DELIVERIES         -> fuelsphere-FUEL_DELIVERIES.csv      ({len(delivery_rows)} rows)', False),
    (f' 13. FUEL_TICKETS            -> fuelsphere-FUEL_TICKETS.csv         ({len(ticket_rows)} rows)', False),
    (f' 14. INVOICES                -> fuelsphere-INVOICES.csv             ({len(invoice_rows)} rows)', False),
    (f' 15. INVOICE_ITEMS           -> fuelsphere-INVOICE_ITEMS.csv        ({len(item_rows)} rows)', False),
    ('Save each sheet as a semicolon-delimited CSV. Headers are the CDS element names. Columns in the sheet that the existing CSV lacks must be added to that CSV header too (or kept in a separate CSV per entity: CAP loads one file per entity, so merge rather than add a second file).', False),
    ('', False),
    ('COLOUR KEY on Field_Gap_Analysis', True),
    ('  SOURCE     straight from the extract', False),
    ('  INFERRED   recovered from the extract (tail rotation, registration series)', False),
    ('  DERIVED    computed by a stated rule from source values and master data', False),
    ('  SYNTHETIC  invented for testing. Not real JetBlue data. Do not use for anything but tests', False),
    ('  BLANK BY DESIGN  must stay empty: filling it would claim a record (order, document, cancellation) that does not exist', False),
    ('', False),
    ('DECISIONS YOU MAY WANT TO CHANGE', True),
    ('  - Dispatch Plans (FLIGHT_DISPATCH, shown as "Dispatch Plans" on the flight page) follow 14 CFR Part 121: domestic legs carry alternate + 45 min and no contingency, flag legs 10% contingency + alternate + 30 min hold, Bermuda a 2 h island reserve.', False),
    (f'  - {sum(1 for f in kept if len(f["versions"]) > 1)} of {kept_n} flights have revised plans (2-3 versions, earlier ones SUPERSEDED), {len(fd_rows)} dispatch rows in all; '
     f'{sum(r["version_gap_flag"] == "true" for r in fd_rows)} plans arrive after a missing version to exercise DSP456.', False),
    ('  - atd_local, ata_local and the four *_gst columns are wall-clock times with no time-zone offset, so they load on HANA as well as SQLite.', False),
    ('  - fob_source = ACARS. The four FOB figures are computed, not downlinked. Change to CREW_REPORTED if the claim matters for your test.', False),
    ('  - DJT in the extract is normalised to PBI. The airport was renamed; the reference dataset keeps IATA PBI (ICAO now KDJT). Confirm which code your S/4 plant uses.', False),
    ('  - A21N is a new AIRCRAFT_MASTER row with order-of-magnitude figures (26,000 kg fuel, 97,000 kg MTOW, 2,200 kg/h). Replace with fleet figures if you have them.', False),
    ('  - N4xxxJ tails (B6 A321LR, the transatlantic fleet) carry a registration-level fuel_capacity_kg of 29,000 kg for the additional centre tank. Without it the BOS-MXP/BCN legs do not fit in the tanks.', False),
    ('  - mtow_kg / mlw_kg / mzfw_kg / engine_burn_rate_kgph on AIRCRAFT_REGISTRATIONS are left NULL: no source exists, and the tail-performance harness fails the day one carries an unsourced value.', False),
    ('  - s4_plant_code is blank on the new airports. Fuel orders at a station need a T001W plant; that is fuel-order seeding, not schedule or dispatch.', False),
    ('', False),
    ('ORDERS, DELIVERIES, TICKETS AND INVOICES', True),
    (f'  - {len(order_rows)} fuel orders, one per flight: quantity = dispatch qty less the inbound flight\'s planned on-block ROB. 5 Cancelled: no uplift needed, the previous sector tankered.', False),
    (f'  - {len(delivery_rows)} deliveries and {len(ticket_rows)} tickets (one each). {sum(1 for r in delivery_rows if r["recon_status"] == "RECONCILED")} gauge reconciliations within 25 kg / 0.1%; 10 with a deliberate variance (5 about 500 kg, 5 about 1%), status VARIANCE.', False),
    (f'  - {len(invoice_rows)} invoices, exactly one per supplier per station, all USD; {len(item_rows)} lines. {len(unbilled)} tickets deliberately NOT invoiced (unbilled report): ' + ', '.join(u['ticket_number'] for u in unbilled) + '.', False),
    (f'  - Seeded invoice exceptions: {SUPPLIER_DEFS[special["C"][0]][2]}-{special["C"][1]} has 2 lines and {SUPPLIER_DEFS[special["D"][0]][2]}-{special["D"][1]} 1 line citing tickets that do not exist (INV462); '
     f'{SUPPLIER_DEFS[special["B"][0]][2]}-{special["B"][1]} re-bills a ticket already invoiced on {SUPPLIER_DEFS[special["A"][0]][2]}-{special["A"][1]} (INV455, which flags BOTH invoices); '
     f'{SUPPLIER_DEFS[special["R"][0]][2]}-{special["R"][1]} bills every line 1-5 c/L above the order price (INV452). Every other line matches exactly one ticket at the ticket quantity and rate.', False),
    (f'  - NOTHING IS POSTED. {sum(r["status"] == "VERIFIED" for r in invoice_rows)} invoices are three-way matched within tolerance: VERIFIED, MATCHED, auto-APPROVED (no manual approval needed), posting gate CLEAR, so Post to S/4 works on them. '
     f'{sum(r["status"] == "SUBMITTED" for r in invoice_rows)} carry the seeded exceptions: SUBMITTED, approval PENDING, posting gate GATED. Press Validate on any invoice to see the rule-by-rule detail; it reproduces these verdicts.', False),
    ('  - Deliveries keep their goods-receipt numbers (a three-way match needs the GR) with status Verified; orders keep their PO numbers.', False),
    ('', False),
    ('PRICES (USD). Jet fuel spot for 23-27 Sep 2026 from web search results; the primary pages (EIA, FRED, IATA, Argus) are blocked from the build environment:', True),
    ('  - US Gulf Coast: September 2026 average $4.341/gal; $4.418 on 11 Sep; about $4.55 in mid-September (Bloomberg, 18 Sep). Seeded $4.40-4.52 rising through the week.', False),
    ('  - New York Harbor: about $4.75 in mid-September (Bloomberg, 18 Sep). Seeded $4.70-4.82.', False),
    ('  - Europe: IATA global average $194.90/bbl ($4.64/gal) for the week to 25 Sep, up 7.4%. Seeded $4.56-4.68.', False),
    ('  - ASSUMED, not sourced: Chicago +6 c, Rockies +12 c, West Coast +30 c, Caribbean +20 c over Gulf Coast; into-plane differential 16-26 c/gal at hydrant hubs, 26-42 c elsewhere, 45-65 c Caribbean. Replace with contract prices if you have them.', False),
    ('', False),
    ('UNIT OF MEASURE - A DECISION TO REVIEW', True),
    ('  - Orders, deliveries, tickets and invoices are in LITRES, as your per-litre rates and the seed\'s own demo delivery (AC410) are. The gauge figures are in the kg fields.', False),
    ('  - The delivery screens convert delivered_quantity to KG whenever gauge figures are present (order-service.js), and flight-variance.js assumes KG. An edit to one of these deliveries in the app would switch it to KG, and the invoice check would then report a unit mismatch (INV468) on its line. This is a code inconsistency, not a data one, and it affects the existing seed the same way.', False),
]
for text, bold in lines:
    readme.append([text])
    readme.cell(readme.max_row, 1).font = Font(bold=bold, size=13 if bold and readme.max_row == 1 else 11)
readme.column_dimensions['A'].width = 160

g = wb.create_sheet('Field_Gap_Analysis')
g.append(['Entity', 'Field', 'Type', 'Constraint', 'Extract column', 'How filled', 'Rule'])
for c in g[1]:
    c.fill, c.font = HDR, HFONT
for ent, rows in (('FLIGHT_SCHEDULE', GAP_FS), ('FLIGHT_DISPATCH', GAP_FD)):
    for fld, typ, con, srccol, kind, rule in rows:
        g.append([ent, fld, typ, con, srccol, kind, rule])
        g.cell(g.max_row, 6).fill = PatternFill('solid', fgColor=KIND_FILL[kind.split('/')[-1]])
for ent, fld, kind, rule in GAP_TXN:
    g.append([ent, fld, '', '', '-', kind, rule])
    g.cell(g.max_row, 6).fill = PatternFill('solid', fgColor=KIND_FILL[kind])
for col, wdt in zip('ABCDEFG', (18, 40, 18, 28, 18, 18, 120)):
    g.column_dimensions[col].width = wdt
for row in g.iter_rows(min_row=2):
    row[6].alignment = Alignment(wrap_text=True, vertical='top')
g.freeze_panes = 'C2'

sheet('FLIGHT_SCHEDULE', FS_COLS, fs_rows)
sheet('FLIGHT_DISPATCH', FD_COLS, fd_rows)
sheet('T005_COUNTRY_add', ['land1', 'landx', 'landx50', 'natio', 'landgr', 'currcode', 'spras', 'is_active'], t005_rows)
sheet('MASTER_AIRPORTS_add', ['ID', 'iata_code', 'icao_code', 'airport_name', 'city', 'country_code', 'timezone',
                              's4_plant_code', 'is_active', 'created_at', 'created_by', 'modified_at', 'modified_by'],
      [new_airports[k] for k in sorted(new_airports)], {'airport_name': 50})
sheet('AIRCRAFT_MASTER_add', ['type_code', 'aircraft_model', 'manufacturer_code', 'fuel_capacity_kg', 'mtow_kg',
                              'cruise_burn_kgph', 'fleet_size', 'status_status_code', 'is_active', 'created_at',
                              'created_by', 'modified_at', 'modified_by'], am_rows)
sheet('AIRCRAFT_REGISTRATIONS_add', list(reg_rows[0].keys()), reg_rows)


def cols_for(entity, rows):
    """The existing seed CSV's column order, then any column the rows add."""
    hdr = open(os.path.join(REPO, 'db', 'data', f'fuelsphere-{entity}.csv'), encoding='utf-8').readline().strip().split(';')
    keys = list(dict.fromkeys(k for r in rows for k in r))
    return [c for c in hdr if c in keys] + [k for k in keys if k not in hdr]


TXN_SHEETS = [('MASTER_SUPPLIERS_add', 'MASTER_SUPPLIERS', supplier_rows),
              ('MASTER_CONTRACTS_add', 'MASTER_CONTRACTS', contract_rows),
              ('MASTER_PRODUCTS_add', 'MASTER_PRODUCTS', product_rows),
              ('DESIGNATED_SUPPLIERS_add', 'DESIGNATED_SUPPLIERS', desig_rows),
              ('FUEL_ORDERS', 'FUEL_ORDERS', order_rows),
              ('FUEL_DELIVERIES', 'FUEL_DELIVERIES', delivery_rows),
              ('FUEL_TICKETS', 'FUEL_TICKETS', ticket_rows),
              ('INVOICES', 'INVOICES', invoice_rows),
              ('INVOICE_ITEMS', 'INVOICE_ITEMS', item_rows)]
for title, entity, rows in TXN_SHEETS:
    sheet(title, cols_for(entity, rows), rows)

q_rows = []
for f in src:
    q_rows.append(dict(source_row=f['row'], flight_no=f['fno'], date_utc=str(f['date_utc']), tail=f['tail'],
                       source_status=f['status_src'], origin_source=f['o_src'], destination_source=f['d_src'],
                       origin_final=f['o'], destination_final=f['d'], airborne_min=round(f['air_min'], 1),
                       seed_ready='N' if f['reason'] else 'Y', exclusion_reason=f['reason'],
                       flags='; '.join(f['flags']) or None,
                       flight_schedule_ID=f.get('id') if not f['reason'] else None))
qs = sheet('Row_Quality', list(q_rows[0].keys()), q_rows, {'exclusion_reason': 60, 'flags': 90})
qs.auto_filter.ref = qs.dimensions

# The seed CSVs are semicolon-delimited: a semicolon inside any value shifts every
# column after it (CLAUDE.md section 12). Refuse to write one.
for name, rs in [(e, r) for _, e, r in TXN_SHEETS] + [('FLIGHT_SCHEDULE', fs_rows), ('FLIGHT_DISPATCH', fd_rows), ('MASTER_AIRPORTS', list(new_airports.values())),
                 ('AIRCRAFT_REGISTRATIONS', reg_rows), ('AIRCRAFT_MASTER', am_rows), ('T005_COUNTRY', t005_rows)]:
    bad = [(r.get('ID') or r.get('registration') or r.get('land1') or r.get('type_code'), k)
           for r in rs for k, v in r.items() if isinstance(v, str) and ';' in v]
    assert not bad, f'{name}: semicolon inside a value {bad[:3]}'

wb.save(OUT)
print(f'kept {kept_n} of {len(src)}; airports +{len(new_airports)}; countries +{len(t005_rows)}; '
      f'tails +{len(reg_rows)}; inferred o/d {inferred_o}/{inferred_d}; seeded ROB {seeded_rob}; dsp458 {dsp458}')
print(excl.most_common())
print(OUT)

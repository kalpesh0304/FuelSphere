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


def alternate_for(dest):
    cands = [(gc_km(AIRPORTS[dest], AIRPORTS[s]), s) for s in stations
             if s != dest and s not in NON_COMMERCIAL and AIRPORTS[s]['country'] == AIRPORTS[dest]['country']]
    cands = [c for c in cands if c[0] >= 60] or [(gc_km(AIRPORTS[dest], AIRPORTS[s]), s) for s in stations if s != dest]
    return min(cands)


ALT = {s: alternate_for(s) for s in stations}
seq = 0
for f in sorted(kept, key=lambda x: x['atot']):
    seq += 1
    key, t = f['key'], f['type']
    burn = cruise_burn(t)
    f['burn'] = burn
    planned_air = f['planned_block'] - f['taxi_out'] - f['taxi_in']
    trip = planned_air / 60 * burn * 1.05                      # 5% for climb
    alt_km, alt = ALT[f['d']]
    f['alt'] = alt
    alt_fuel = (alt_km / 600 * 60 + 10) / 60 * burn            # 600 km/h low-level, +10 min approach
    final_res = 30 / 60 * burn * 0.85                         # 30 min holding at 85% of cruise burn
    long_or_water = f['km'] > 2500 or AIRPORTS[f['d']]['country'] != 'US' or AIRPORTS[f['o']]['country'] != 'US'
    additional = 0.0
    if long_or_water and h(key, 'add') < 0.5:
        additional = 15 / 60 * burn * 0.85                    # EDTO / isolated-aerodrome margin
    elif f['d'] in BUSY and h(key, 'add') < 0.15:
        additional = 10 / 60 * burn * 0.85                    # anticipated arrival delay
    taxi = f['taxi_out'] * TAXI_KG_MIN[t]
    extra = 0.0 if h(key, 'ext') < 0.7 else 100 * (2 + int(h(key, 'exa') * 7))
    f['stack'] = dict(trip=round(trip), cont=round(trip * 0.05), alt=round(alt_fuel), fres=round(final_res),
                      add=round(additional), taxi=round(taxi), extra=round(extra))
    f['dispatch_order_id'] = f'FO-B6-2026-{seq:05d}'

for legs in by_tail.values():
    legs.sort(key=lambda x: x['atot'])
    for f in legs:
        s, t = f['stack'], f['type']
        if f['prev']:
            rob = f['prev']['fob_in']
            f['rob_src'] = 'carried from previous leg FOB at IN'
        else:
            rob = s['alt'] + s['fres'] + 400 + int(h(f['key'], 'rob') * 800)
            f['rob_src'] = 'SEEDED: no previous leg in the extract (D59 shape)'
            f['flags'].append('opening ROB seeded, not carried: first leg of this tail in the extract')
        block = sum(s.values())
        if rob > block:                                       # tankered: commander carries the surplus
            s['extra'] += round(rob - block)
            block = sum(s.values())
        cap = tail_cap(f['tail'], t)
        if block > cap:
            f['flags'].append(f'block {block:.0f} kg exceeds {t} capacity {cap:.0f} kg; extra and additional trimmed')
            over = min(block - cap, max(0, block - rob))       # never trim below the fuel already on board
            for k in ('extra', 'add'):
                cut = min(over, s[k]); s[k] -= cut; over -= cut
            block = sum(s.values())
            if block > cap:
                f['flags'].append('STILL over capacity after trimming: check the type assumption for this tail')
        f['block'] = block
        f['rob'] = round(rob, 2)
        f['uplift'] = round(block - rob, 2)
        # Actuals: what the aircraft really burned, from real airborne time and the tail's performance factor
        pf = perf[f['tail']] / 100
        f['fob_out'] = block
        f['fob_off'] = block - f['taxi_out'] * TAXI_KG_MIN[t]
        f['fob_on'] = f['fob_off'] - f['air_min'] / 60 * f['burn'] * 1.05 * pf * (0.98 + h(f['key'], 'wx') * 0.04)
        f['fob_in'] = f['fob_on'] - f['taxi_in'] * TAXI_KG_MIN[t]
        if f['fob_in'] < s['fres']:
            f['flags'].append('FOB at IN below final reserve: check plan')

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
        status='ARRIVED', fuel_order_number=None, airline_code='B6', flight_suffix=None, service_type='J',
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

    s = f['stack']
    o, d = AIRPORTS[f['o']], AIRPORTS[f['d']]
    westbound = d['lon'] < o['lon']
    wind = round((15 + h(key, 'wnd') * 45) if westbound else -(20 + h(key, 'wnd') * 60), 1)
    air = f['air_min']
    fl = 280 if air < 60 else 340 if air < 120 else 360 if air < 240 else 380
    fl = min(fl + (10 if h(key, 'fl') < 0.5 and not westbound else 0), MAX_FL[t])
    payload = boarded * 100 + cargo
    payload_plan = booked * 100 + cargo
    fd_rows.append(dict(
        ID=uid('FD', f['leg_id'], 1), dispatch_order_id=f['dispatch_order_id'],
        flight_number=f['flight_number'], flight_date=str(f['flight_date']), flight_schedule_ID=f['id'],
        fuel_order_ID=None, tail_number=f['tail'], tail_registration=f['tail'], captain_id=cap_id,
        dispatcher_id=pick(f['o'] + str(f['flight_date']), 'dsp', [f'DSP-B6{n:03d}' for n in range(1, 41)]),
        atd=iso(f['aobt']), ata=iso(f['aibt']),
        atd_local=iso_off(f['aobt'], f['o_tz']), ata_local=iso_off(f['aibt'], f['d_tz']),
        std_gst=iso_off(f['sobt'], GST), sta_gst=iso_off(f['sibt'], GST),
        atd_gst=iso_off(f['aobt'], GST), ata_gst=iso_off(f['aibt'], GST),
        dispatch_timestamp=iso(f['sobt'] - dt.timedelta(minutes=75 + int(h(key, 'dts') * 30))),
        dispatch_qty_kg=r2(f['block']), trip_fuel_kg=r2(s['trip']), contingency_fuel_kg=r2(s['cont']),
        alternate_fuel_kg=r2(s['alt']), final_reserve_kg=r2(s['fres']), additional_fuel_kg=r2(s['add']),
        taxi_fuel_kg=r2(s['taxi']), extra_fuel_kg=r2(s['extra']), block_fuel_kg=r2(f['block']),
        required_uplift_kg=r2(f['uplift']), plan_group_id=f['leg_id'], plan_version=1,
        plan_version_source='ASSIGNED', plan_status='ACTIVE', superseded_by_ID=None, version_gap_flag='false',
        versions_skipped=0, rob_departure_kg=r2(f['rob']), payload_kg=r2(payload), payload_plan_kg=r2(payload_plan),
        arrival_rob_plan_kg=r2(s['cont'] + s['alt'] + s['fres'] + s['add'] + s['extra']),
        flight_level=fl, wind_component=wind, alternate_airport=f['alt'], dispatch_source='MANUAL',
        ofplan_reference=f'OFP-{f["flight_number"]}-{f["flight_date"]:%Y%m%d}',
        remarks=f'SYNTHETIC plan from ADS-B airborne time - ROB {f["rob_src"]}'[:200],
        created_at=SEED_TS, created_by=SEED_USER, modified_at=SEED_TS, modified_by=SEED_USER))

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
    ('fuel_order_number', 'String(25)', '', '-', B, 'Written when a fuel order is created for the flight. Seeding it would claim an order that does not exist'),
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
    ('ID', 'UUID', 'key', '-', D, 'UUIDv5 of plan_group_id + version'),
    ('dispatch_order_id', 'String(20)', 'mandatory', '-', Y, 'FO-B6-2026-nnnnn in wheels-off order'),
    ('flight_number / flight_date', '', 'mandatory', 'Flight No', D, 'Same as FLIGHT_SCHEDULE'),
    ('flight_schedule_ID', 'FK', '', '-', D, 'Links directly, so the DSP458 number+date ambiguity cannot bite in the CSV seed'),
    ('fuel_order_ID', 'FK', '', '-', B, 'No FUEL_ORDERS rows are seeded. Filled when an order is raised (or by the dispatch Excel import)'),
    ('tail_number / tail_registration', '', 'import-required', 'Tail Number', S, ''),
    ('captain_id / dispatcher_id', 'String(20)', 'import-required', '-', Y, 'CAP-B6nnnn per tail per day; DSP-B6nnn per station per day'),
    ('atd / ata', 'DateTime', 'ATD import-required', '-', D, 'AOBT / AIBT'),
    ('atd_local / ata_local', 'DateTime', '', '-', D, 'AOBT / AIBT at origin / destination timezone offset'),
    ('std_gst / sta_gst / atd_gst / ata_gst', 'DateTime', '', '-', D, 'Same instants on a UTC+04:00 clock, as the existing seed does. The GST clock is an inherited template field and means nothing for B6'),
    ('dispatch_timestamp', 'DateTime', 'import-required', '-', Y, 'SOBT less 75-105 min'),
    ('trip_fuel_kg', 'Decimal', '', '-', D, 'Planned airborne min (planned block - taxi) / 60 x AIRCRAFT_MASTER.cruise_burn_kgph x 1.05'),
    ('contingency_fuel_kg', 'Decimal', '', '-', D, '5% of trip'),
    ('alternate_fuel_kg', 'Decimal', '', '-', D, '(great-circle km to alternate / 600 km/h + 10 min) x cruise burn'),
    ('final_reserve_kg', 'Decimal', '', '-', D, '30 min holding at 85% of cruise burn'),
    ('additional_fuel_kg', 'Decimal', '', '-', Y, '15 min on half the long/over-water/international legs; 10 min on 15% of legs into congested hubs; else 0'),
    ('taxi_fuel_kg', 'Decimal', '', '-', D, 'Taxi-out minutes x type taxi burn (A223 9, A320 11, A321 13, A21N 11 kg/min)'),
    ('extra_fuel_kg', 'Decimal', '', '-', Y, "Commander's discretion: 0 on 70% of legs, 200-800 kg otherwise; absorbs any tankered surplus so uplift is never negative"),
    ('block_fuel_kg / dispatch_qty_kg', 'Decimal', 'DISPATCH_QTY_KG import-required', '-', D, 'DSP450: sum of the seven terms. dispatch_qty_kg equals it. Capped at type fuel capacity'),
    ('required_uplift_kg', 'Decimal', '', '-', D, 'DSP451: block - rob_departure_kg, exactly as deriveStack() computes it'),
    ('plan_group_id / plan_version / plan_version_source / plan_status', '', '', '-', D, 'flight_leg_id / 1 / ASSIGNED / ACTIVE'),
    ('superseded_by_ID', 'FK', '', '-', B, 'Only set on a superseded version; every seeded plan is v1 ACTIVE'),
    ('version_gap_flag / versions_skipped', '', '', '-', D, 'false / 0'),
    ('rob_departure_kg', 'Decimal', 'import-required', '-', D, 'PRE-uplift fuel on board, as deriveStack() uses it: previous leg FOB at IN on the same tail; seeded on each tail\'s first leg (flagged)'),
    ('payload_kg / payload_plan_kg', 'Decimal', 'PAYLOAD_KG import-required', '-', D, 'boarded (planned: booked) x 100 kg + cargo. No MZFW cap: mzfw_kg is null on every tail'),
    ('arrival_rob_plan_kg', 'Decimal', '', '-', D, 'contingency + alternate + final reserve + additional + extra'),
    ('flight_level', 'Integer', '', '-', Y, 'By sector length, +10 eastbound on half the legs, capped at type ceiling'),
    ('wind_component', 'Decimal', '', '-', Y, 'Westbound +15..+60 kt headwind, eastbound -20..-80 kt tailwind'),
    ('alternate_airport', 'String(3)', '', '-', D, 'Nearest other station in the extract, same country, >= 60 km'),
    ('dispatch_source', 'String(15)', 'import-required', '-', D, 'MANUAL (not TRIPRECORD: no real flight plan exists)'),
    ('ofplan_reference', 'String(30)', '', '-', Y, 'OFP-<flight>-<yyyymmdd>'),
    ('remarks', 'String(200)', '', '-', D, 'States the row is synthetic and where its ROB came from'),
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
    (f'  6. FLIGHT_DISPATCH         -> append to db/data/fuelsphere-FLIGHT_DISPATCH.csv     ({len(fd_rows)} rows)', False),
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
    ('  - fob_source = ACARS. The four FOB figures are computed, not downlinked. Change to CREW_REPORTED if the claim matters for your test.', False),
    ('  - DJT in the extract is normalised to PBI. The airport was renamed; the reference dataset keeps IATA PBI (ICAO now KDJT). Confirm which code your S/4 plant uses.', False),
    ('  - A21N is a new AIRCRAFT_MASTER row with order-of-magnitude figures (26,000 kg fuel, 97,000 kg MTOW, 2,200 kg/h). Replace with fleet figures if you have them.', False),
    ('  - N4xxxJ tails (B6 A321LR, the transatlantic fleet) carry a registration-level fuel_capacity_kg of 29,000 kg for the additional centre tank. Without it the BOS-MXP/BCN legs do not fit in the tanks.', False),
    ('  - mtow_kg / mlw_kg / mzfw_kg / engine_burn_rate_kgph on AIRCRAFT_REGISTRATIONS are left NULL: no source exists, and the tail-performance harness fails the day one carries an unsourced value.', False),
    ('  - s4_plant_code is blank on the new airports. Fuel orders at a station need a T001W plant; that is fuel-order seeding, not schedule or dispatch.', False),
    ('  - Not seeded, and needed before orders can flow at these stations: suppliers, contracts, designated suppliers, fuel orders. Out of scope here.', False),
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
for name, rs in (('FLIGHT_SCHEDULE', fs_rows), ('FLIGHT_DISPATCH', fd_rows), ('MASTER_AIRPORTS', list(new_airports.values())),
                 ('AIRCRAFT_REGISTRATIONS', reg_rows), ('AIRCRAFT_MASTER', am_rows), ('T005_COUNTRY', t005_rows)):
    bad = [(r.get('ID') or r.get('registration') or r.get('land1') or r.get('type_code'), k)
           for r in rs for k, v in r.items() if isinstance(v, str) and ';' in v]
    assert not bad, f'{name}: semicolon inside a value {bad[:3]}'

wb.save(OUT)
print(f'kept {kept_n} of {len(src)}; airports +{len(new_airports)}; countries +{len(t005_rows)}; '
      f'tails +{len(reg_rows)}; inferred o/d {inferred_o}/{inferred_d}; seeded ROB {seeded_rob}; dsp458 {dsp458}')
print(excl.most_common())
print(OUT)

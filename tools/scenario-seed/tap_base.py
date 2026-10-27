"""
TAP Air Portugal (TP) 20-22 October 2026 - the commercial layer the uploaded
workbook stops short of: carrier, suppliers, contracts, station maps, orders,
deliveries, tickets and invoices.

Same rules as the JetBlue seed already in db/data, so the two read alike:
one order per flight on the ACTIVE dispatch plan, one delivery and one ticket,
one fuel invoice per supplier per station, litres at a per-litre rate, gauge
reconciliation within 25 kg. Prices and into-plane rates are ASSUMPTIONS and
say so on every invoice.
"""
import datetime as dt
from collections import defaultdict
import openpyxl
from common import uid, f2, f3, f4, num, h, frac, ts, parse_ts, read_csv

AIRLINE = 'TP'
BY = 'SEED_TP_ADSB'
BY_C = 'SEED_TP_COMMERCIAL'
STAMP = '2026-10-19T00:00:00Z'
COMPANY = 'TP00'      # PLACEHOLDER - no TAP company code was supplied
INVOICE_DATE = '2026-10-23'

EURO = {'PT', 'ES', 'FR', 'BE', 'LU', 'IT', 'DE', 'NL', 'AT', 'IE', 'GR', 'FI', 'CY', 'GP', 'MT', 'SK', 'SI'}
HUBS = {'LIS', 'OPO', 'MAD', 'BCN', 'LHR', 'LGW', 'ORY', 'FRA', 'MUC', 'AMS', 'FCO', 'MXP', 'ZRH', 'GVA',
        'BRU', 'JFK', 'EWR', 'BOS', 'IAD', 'GRU', 'YYZ', 'MIA', 'ORD', 'SFO', 'LAX', 'CPH', 'ARN', 'VIE', 'DUB'}
JETA1 = 'c3d4e5f6-3333-4000-8000-000000000001'
JETA = '013573ad-8e1e-50ab-bfd5-140b70dbab8b'

# ---- suppliers ---------------------------------------------------------------
# Reused from the existing seed where one already trades at the station.
EXISTING = {
    'BPUK001': 'b2c3d4e5-2222-4000-8000-00000000A003',
    'ATINT01': 'b2c3d4e5-2222-4000-8000-00000000A004',
    'WFS001':  'b2c3d4e5-2222-4000-8000-00000000A001',
}
NEW_SUPPLIERS = [
    # code, name, type, country, prefix, vendor
    ('GALP01', 'Galp Energia Aviacao', 'EXTERNAL', 'PT', 'GLP', '1000201'),
    ('REPSOL01', 'Repsol Aviacion', 'EXTERNAL', 'ES', 'RPS', '1000202'),
    ('VIBRA01', 'Vibra Energia Aviacao', 'EXTERNAL', 'BR', 'VIB', '1000203'),
    ('LISITP01', 'Lisbon Into-Plane Services (synthetic)', 'INTO_PLANE', 'PT', 'LIP', '1000204'),
    ('OPOITP01', 'Porto Into-Plane Services (synthetic)', 'INTO_PLANE', 'PT', 'OIP', '1000205'),
]
AGENT_AT = {'LIS': ('LISITP01', 0.0140), 'OPO': ('OPOITP01', 0.0155)}   # EUR per litre, ASSUMED


def load_upload(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    out = {}
    for ws in wb:
        it = ws.iter_rows(values_only=True)
        head = next(it)
        out[ws.title] = (list(head), [dict(zip(head, ['' if v is None else
                                                      (('true' if v else 'false') if isinstance(v, bool) else str(v))
                                                      for v in r])) for r in it if any(x is not None for x in r)])
    return out


def build(D, upload_path):
    up = load_upload(upload_path)
    T = D.t

    # ---- master data the upload already carries -------------------------
    for sheet, ent in [('T005_COUNTRY_add', 'T005_COUNTRY'), ('MASTER_AIRPORTS_add', 'MASTER_AIRPORTS'),
                       ('AIRCRAFT_MASTER_add', 'AIRCRAFT_MASTER'),
                       ('AIRCRAFT_REGISTRATIONS_add', 'AIRCRAFT_REGISTRATIONS'),
                       ('FLIGHT_SCHEDULE', 'FLIGHT_SCHEDULE'), ('FLIGHT_DISPATCH', 'FLIGHT_DISPATCH')]:
        head, rows = up[sheet]
        for r in rows:
            T[ent].add(r)

    # Airports: the upload's plus those the JetBlue seed already holds.
    _, built_airports = read_csv('MASTER_AIRPORTS')
    airport = {a['iata_code']: a for a in built_airports}
    for a in T['MASTER_AIRPORTS'].rows:
        airport[a['iata_code']] = a
    country = {k: v['country_code'] for k, v in airport.items()}

    T['CARRIER_MASTER'].add({'carrier_code': 'TP', 'carrier_name': 'TAP Air Portugal', 'company_code': COMPANY,
                             'currency_code': 'EUR', 'volume_uom_code': 'LTR', 'mass_uom_code': 'KG',
                             'is_active': 'true',
                             'notes': 'COMPANY CODE IS A PLACEHOLDER (TP00) - set it before any posting is raised for this carrier.'})
    _, cur_rows = read_csv('CURRENCY_MASTER')
    if 'EUR' not in {r['currency_code'] for r in cur_rows}:
        T['CURRENCY_MASTER'].add({'currency_code': 'EUR', 'currency_name': 'Euro', 'decimal_places': '2'})

    sup_id, prefix = dict(EXISTING), {'BPUK001': 'BPK', 'ATINT01': 'ATI', 'WFS001': 'WFS'}
    for code, name, typ, cc, pfx, vendor in NEW_SUPPLIERS:
        sid = uid('TP', 'SUP', code)
        sup_id[code], prefix[code] = sid, pfx
        T['MASTER_SUPPLIERS'].add({'ID': sid, 'supplier_code': code, 'supplier_name': name, 'supplier_type': typ,
                                   'country_code': cc, 'payment_terms': 'NT30', 's4_vendor_no': vendor,
                                   'is_active': 'true', 'created_at': STAMP, 'created_by': BY_C,
                                   'modified_at': STAMP, 'modified_by': BY_C})

    # US stations: the supplier JetBlue already buys from there.
    _, ssm = read_csv('STATION_SUPPLIER_MAP')
    _, sups = read_csv('MASTER_SUPPLIERS')
    sup_by_id = {s['ID']: s for s in sups}
    b6_at = {}
    for m in ssm:
        if m['carrier_carrier_code'] == 'B6' and m['is_default'] == 'true':
            b6_at[m['airport_ID']] = m['supplier_ID']

    def supplier_for(stn):
        cc = country.get(stn)
        if cc == 'PT':
            return 'GALP01'
        if cc == 'ES':
            return 'REPSOL01'
        if cc in ('GB', 'IE'):
            return 'BPUK001'
        if cc == 'BR':
            return 'VIBRA01'
        if cc == 'US':
            sid = b6_at.get(airport[stn]['ID'])
            if sid:
                code = sup_by_id[sid]['supplier_code']
                sup_id.setdefault(code, sid)
                prefix.setdefault(code, code[:3].upper())
                return code
            return 'ATINT01'
        if cc == 'CA':
            return 'WFS001'
        return 'ATINT01'

    # TAP BOOKS IN EUR, so every TAP contract, order, ticket and invoice is in
    # EUR - including the UK, Swiss, Nordic, Americas and African stations a
    # real supplier might bill in local currency or USD. Nothing in FuelSphere
    # converts currency, so a carrier must buy in the one its ledger is kept
    # in (CARRIER_MASTER.currency_code).
    def currency_for(stn):
        return 'EUR'

    # ---- price per litre: ASSUMED, by region, rising a little each day ------
    BASE = {'PT': 1.0820, 'ES': 1.0760, 'FR': 1.0950, 'BE': 1.0950, 'LU': 1.0950, 'DE': 1.0900,
            'NL': 1.0880, 'AT': 1.0920, 'IT': 1.0910, 'IE': 1.0880, 'GR': 1.1050, 'CY': 1.1100,
            'GP': 1.1600, 'GB': 1.1000, 'CH': 1.1200, 'DK': 1.1100, 'SE': 1.1150, 'NO': 1.1200,
            'PL': 1.1000, 'CZ': 1.1050, 'US': 1.0200, 'CA': 1.0600, 'BR': 1.1600, 'SN': 1.2200}

    def price(stn, day):
        base = BASE.get(country.get(stn), 1.12)
        d = (dt.date.fromisoformat(day) - dt.date(2026, 10, 19)).days
        return round(base + 0.004 * d + (frac('price', stn) - 0.5) * 0.03, 4)   # EUR per litre, ASSUMED

    D.price = price

    # ---- contracts: one per supplier and currency, plus agents --------------
    flights = T['FLIGHT_SCHEDULE'].rows
    stations = sorted({f['origin_airport'] for f in flights})
    contract = {}
    seq = [4600400000]

    def add_contract(code, cur, name, ptype='CPE', ctype='TERM', suffix=''):
        key = (code, cur, suffix)
        if key in contract:
            return contract[key]
        seq[0] += 1
        num_ = f"TP-{code}-2026-{cur}{suffix}"
        cid = uid('TP', 'CON', num_)
        T['MASTER_CONTRACTS'].add({'ID': cid, 'contract_number': num_, 'contract_name': name,
                                   'supplier_ID': sup_id[code], 'valid_from': '2026-01-01',
                                   'valid_to': '2026-12-31', 'contract_type': ctype, 'price_type': ptype,
                                   'currency_code': cur, 'payment_terms': 'NET30',
                                   'incoterms': 'DAP' if ptype != 'FIXED' else '',
                                   'min_volume_kg': '1000000.00' if ptype != 'FIXED' else '',
                                   'max_volume_kg': '250000000.00' if ptype != 'FIXED' else '',
                                   's4_contract_number': str(seq[0]), 'uom_code': 'LTR', 'is_active': 'true',
                                   'created_at': STAMP, 'created_by': BY_C, 'modified_at': STAMP,
                                   'modified_by': BY_C})
        contract[key] = cid
        return cid

    D.add_contract = add_contract
    D.sup_id, D.prefix, D.airport, D.country = sup_id, prefix, airport, country
    station_contract = {}
    for stn in stations:
        code, cur = supplier_for(stn), currency_for(stn)
        cid = add_contract(code, cur, f'TAP {code} into-plane supply 2026 ({cur})')
        station_contract[stn] = (code, cid, cur)
        prod = JETA if country.get(stn) == 'US' else JETA1
        T['CONTRACT_LOCATIONS'].add({'ID': uid('TP', 'CL', cid, stn), 'contract_ID': cid,
                                     'airport_ID': airport[stn]['ID'], 'plant_code': '', 'location_type': 'PRIMARY',
                                     'location_premium': '0.0000', 'priority': '1', 'valid_from': '2026-01-01',
                                     'valid_to': '', 'is_active': 'true', 'created_at': STAMP, 'created_by': BY_C,
                                     'modified_at': STAMP, 'modified_by': BY_C})
        cpid = uid('TP', 'CP', cid, prod)
        if not T['CONTRACT_PRODUCTS'].get(cpid):
            T['CONTRACT_PRODUCTS'].add({'ID': cpid, 'contract_ID': cid, 'product_ID': prod, 'product_premium': '0.0000',
                                        'min_quantity': '500.00', 'max_quantity': '500000.00', 'is_default': 'true',
                                        'is_active': 'true', 'created_at': STAMP, 'created_by': BY_C,
                                        'modified_at': STAMP, 'modified_by': BY_C})
        agent = AGENT_AT.get(stn)
        icid = add_contract(agent[0], 'EUR', f'{agent[0]} into-plane handling 2026', ptype='FIXED') if agent else ''
        T['STATION_SUPPLIER_MAP'].add({
            'ID': uid('TP', 'SSM', stn), 'is_active': 'true', 'created_at': STAMP, 'created_by': BY_C,
            'modified_at': STAMP, 'modified_by': BY_C, 'airport_ID': airport[stn]['ID'],
            'carrier_carrier_code': 'TP', 'supplier_ID': sup_id[code], 'is_default': 'true',
            'supplier_performs_uplift': 'false' if agent else 'true',
            'into_plane_agent_ID': sup_id[agent[0]] if agent else '', 'into_plane_contract_ID': icid,
            'contract_ID': cid, 'contract_line_item': '10', 'valid_from': '2026-01-01', 'valid_to': '',
            'self_fuelled': 'false',
            'notes': (f'Into-plane by {agent[0]} at {stn}; fuel on the supplier contract. ASSUMED arrangement.'
                      if agent else 'Supplier performs the uplift. ASSUMED arrangement.')})
    D.station_contract = station_contract

    for reg in T['AIRCRAFT_REGISTRATIONS'].rows:
        T['AIRCRAFT_FUEL_TYPES'].add({'ID': uid('TP', 'AFT', reg['registration']),
                                      'registration': reg['registration'], 'fuel_type': 'JETA1',
                                      'valid_from': '2024-01-01', 'valid_to': '', 'is_default': 'true',
                                      'is_active': 'true', 'notes': 'TAP seed: Jet A-1 for every tail.',
                                      'created_at': STAMP, 'created_by': BY_C, 'modified_at': STAMP,
                                      'modified_by': BY_C})

    # ---- orders, deliveries, tickets ------------------------------------
    D.index()
    active = {}
    for fid, vs in D.versions.items():
        act = [v for v in vs if v['plan_status'] == 'ACTIVE']
        if act:
            active[fid] = act[-1]
    po, gr = [4500400000], [5000400000]
    seq_stn = defaultdict(int)
    tickets_by_station = defaultdict(list)

    for f in sorted(flights, key=lambda f: f['aobt'] or f['sobt']):
        d = active.get(f['ID'])
        if not d:
            continue
        stn = f['origin_airport']
        code, cid, cur = station_contract[stn]
        day = f['flight_date']
        ymd = day.replace('-', '')
        seq_stn[(stn, day)] += 1
        n = seq_stn[(stn, day)]
        req_kg = num(d['required_uplift_kg']) or 0
        litres = round(req_kg / 0.8, 2)
        p = price(stn, day)
        aobt = parse_ts(f['aobt'] or f['sobt'])
        prod = JETA if country.get(stn) == 'US' else JETA1
        agent = AGENT_AT.get(stn)
        po[0] += 1
        order_no = f'FO-{stn}-{ymd}-{n:03d}'
        oid = uid('TP', 'ORD', f['ID'])
        cancelled = req_kg <= 0
        T['FUEL_ORDERS'].add({
            'ID': oid, 'order_number': order_no, 'flight_ID': f['ID'], 'airport_ID': airport[stn]['ID'],
            'station_code': stn, 'supplier_ID': sup_id[code], 'contract_ID': cid, 'product_ID': prod,
            'uom_code': 'LTR', 'ordered_quantity': f2(litres), 'ordered_quantity_kg': f'{req_kg:g}',
            'conversion_source': 'UOM_MASTER', 'conversion_density': '0.8000', 'unit_price': f4(p),
            'total_amount': f2(litres * p), 'currency_code': cur, 'requested_date': day,
            'requested_time': (aobt - dt.timedelta(minutes=40)).strftime('%H:%M:%S'),
            'priority': 'Normal', 'status': 'Cancelled' if cancelled else 'Completed',
            's4_po_number': str(po[0]), 's4_po_item': '00010',
            'notes': f"Fuel order for {f['flight_number']} {stn}-{f['destination_airport']}: required uplift "
                     f"{req_kg:g} kg on dispatch plan v{d['plan_version']}.",
            'communicated_at': ts(aobt - dt.timedelta(hours=2)), 'communication_status': 'ACKNOWLEDGED',
            'order_relationship': 'ORIGINAL', 'is_tankering': 'false',
            'created_at': ts(aobt - dt.timedelta(hours=2, minutes=2)), 'created_by': BY_C,
            'modified_at': f['aibt'] or STAMP, 'modified_by': BY_C, 'crew_review_status': 'CONFIRMED',
            'crew_reviewed_by': f['captain_name'], 'crew_reviewed_at': ts(aobt - dt.timedelta(hours=1, minutes=30)),
            'dispatch_plan_ID': d['ID'], 'dispatch_fuel_order_id': d['dispatch_order_id'],
            'communication_reference': f"MSG-{prefix[code]}-{ymd}-{n:03d}", 'order_type': 'ORIGINAL',
            'planned_quantity_kg': f'{req_kg:g}', 'into_plane_agent_ID': sup_id[agent[0]] if agent else '',
            'into_plane_contract_ID': contract.get((agent[0], 'EUR', '')) if agent else '',
            'order_category': 'PLANNED'})
        f['fuel_order_number'] = order_no
        d['fuel_order_ID'] = oid
        if cancelled:
            continue

        # Delivery: within the hour before off-blocks.
        start = aobt - dt.timedelta(minutes=45 + h('st', f['ID']) % 20)
        end = start + dt.timedelta(minutes=12 + h('en', f['ID']) % 18)
        dens = round(0.790 + frac('dens', f['ID']) * 0.020, 4)
        temp = round(8 + frac('temp', f['ID']) * 14, 2)
        lit = float(int(litres))
        tkg = round(lit * dens, 2)
        noise = round((frac('rn', f['ID']) - 0.5) * 30, 2)
        delta = round(tkg - noise, 2)
        arrival = num(d['rob_departure_kg']) or 0
        gb = round(40 + frac('gb', f['ID']) * 110, 2)
        before = round(arrival - gb, 2)
        after = round(before + delta, 2)
        tol = round(max(50, tkg * 0.005), 2)
        hub = stn in HUBS
        veh = f"{'HD' if hub else 'TRK'}-{stn}-{h('veh', f['ID']) % 12 + 1:02d}"
        gr[0] += 1
        did = uid('TP', 'DEL', f['ID'])
        T['FUEL_DELIVERIES'].add({
            'ID': did, 'order_ID': oid, 'aircraft_reg': f['aircraft_reg'], 'tail_registration': f['aircraft_reg'],
            'delivery_number': f'EPD-{stn}-{ymd}-{n:04d}', 'delivery_date': start.strftime('%Y-%m-%d'),
            'delivery_time': start.strftime('%H:%M:%S'), 'delivered_quantity': f2(lit), 'uom_code': 'LTR',
            'temperature': f2(temp), 'density': f4(dens),
            'temperature_corrected_qty': f2(lit * (1 - 0.00099 * (temp - 15))),
            'fob_at_arrival_kg': f'{arrival:g}', 'fob_before_kg': f2(before), 'fob_after_kg': f2(after),
            'fob_delta_kg': f2(delta), 'ground_burn_kg': f2(gb), 'fob_source': 'ACARS', 'fob_rounding_kg': '0',
            'recon_variance_kg': f2(noise), 'recon_status': 'RECONCILED', 'supplier_count': '1',
            'delivery_method': 'HYD' if hub else 'TRK', 'vehicle_id': veh,
            'driver_name': f"Fueler {h('drv', f['ID']) % 900 + 100} (synthetic)", 'pilot_name': f['captain_name'],
            'ground_crew_name': f"Ramp agent {h('rmp', f['ID']) % 900 + 100} (synthetic)",
            's4_gr_number': str(gr[0]), 's4_gr_year': '2026', 's4_gr_item': '0001', 'status': 'Verified',
            'quantity_variance': f2(lit - litres), 'variance_percentage': f2((lit - litres) / litres * 100 if litres else 0),
            'variance_flag': 'false', 'refuel_start_utc': ts(start), 'refuel_end_utc': ts(end), 'refuel_complete': 'true',
            'created_at': ts(start), 'created_by': BY_C, 'modified_at': ts(end), 'modified_by': BY_C,
            'flight_ID': f['ID'], 'flight_variance_kg': f2(-noise), 'flight_variance_status': 'RECONCILED',
            'flight_metered_kg': f2(tkg), 'flight_delivered_kg': f2(delta), 'flight_tolerance_kg': f2(tol)})
        mstart = 100000 + h('mtr', veh) % 300000 + n * 37
        tnum = f"{prefix[code]}-{stn}-{600000 + h('tk', f['ID']) % 399999:06d}"
        tid = uid('TP', 'TKT', f['ID'])
        T['FUEL_TICKETS'].add({
            'ID': tid, 'order_ID': oid, 'match_status': 'MATCHED', 'ticket_source': 'E', 'delivery_ID': did,
            'ticket_number': tnum, 'internal_number': f'FT-{stn}-{ymd}-{n:04d}', 'aircraft_reg': f['aircraft_reg'],
            'tail_registration': f['aircraft_reg'], 'flight_number': f['flight_number'], 'quantity': f2(lit),
            'uom_code': 'LTR', 'meter_start': f2(mstart), 'meter_end': f2(mstart + lit), 'quantity_metered': f2(lit),
            'density_value': f4(dens), 'density_uom': 'KGL', 'density_basis': 'MEA', 'density_temp_c': f2(temp),
            'quantity_flag': 'GR', 'quantity_kg': f2(tkg), 'batch_coa_ref': f'COA-{stn}-{ymd}-{h("coa", stn, day) % 3 + 1}',
            'delivery_timestamp': ts(start), 'supplier_ticket_ref': tnum.replace(f'-{stn}-', '-DN-'),
            'status': 'Verified', 'verified_by': 'fuel.ops@airline.com', 'verified_at': ts(end + dt.timedelta(hours=2)),
            'vehicle_id': veh, 'meter_serial': f'MTR-{veh}', 'ticket_capture_source': 'ELECTRONIC',
            'created_at': ts(end), 'created_by': BY_C, 'modified_at': ts(end), 'modified_by': BY_C,
            'flight_ID': f['ID'], 'rate_per_litre': f4(p), 'total_amount': f2(lit * p), 'currency_code': cur})
        tickets_by_station[(stn, code)].append(tid)

    # ---- invoices: fuel, one per supplier per station -------------------
    D.index()
    inv_seq = defaultdict(int)
    for (stn, code), tids in sorted(tickets_by_station.items()):
        _, cid, cur = station_contract[stn]
        pfx = prefix[code]
        inv_seq[pfx] += 1
        number = f'{pfx}-{stn}-261023-01'
        iid = uid('TP', 'INV', number)
        inv = T['INVOICES'].add(invoice_header(iid, number, f'INV-{pfx}-20261023-{inv_seq[pfx]:03d}',
                                               sup_id[code], cur,
                                               f'SYNTHETIC TP test invoice, {stn}, 19-22 Oct 2026. Rates are ASSUMED, '
                                               f'not TAP contract prices.'))
        for i, tid in enumerate(sorted(tids, key=lambda t: T['FUEL_TICKETS'].get(t)['delivery_timestamp']), 1):
            T['INVOICE_ITEMS'].add(fuel_line(D, iid, i * 10, T['FUEL_TICKETS'].get(tid)))
        D.recompute_header(inv)

    # ---- into-plane invoices at LIS and OPO, one per agent per day ------
    for stn, (agent, rate) in AGENT_AT.items():
        by_day = defaultdict(list)
        code = station_contract[stn][0]
        for tid in tickets_by_station[(stn, code)]:
            t = T['FUEL_TICKETS'].get(tid)
            by_day[t['delivery_timestamp'][:10]].append(t)
        for day, ts_ in sorted(by_day.items()):
            number = f"ITP-{agent[:6]}-{stn}-{day.replace('-', '')}"
            iid = uid('TP', 'INV', number)
            inv = T['INVOICES'].add(invoice_header(
                iid, number, f"INV-{prefix[agent]}-{day.replace('-', '')}-001", sup_id[agent], 'EUR',
                f'Into-plane handling billed by {agent} at {stn} on {day}. {len(ts_)} uplift(s) at an ASSUMED '
                f'{rate} EUR/litre - no into-plane rate is recorded in FuelSphere, so this figure is illustrative.'))
            for i, t in enumerate(sorted(ts_, key=lambda t: t['delivery_timestamp']), 1):
                it = fuel_line(D, iid, i * 10, t)
                q = num(t['quantity'])
                it.update({'ID': uid('TP', 'ITM-ITP', t['ID']), 'charge_type': 'INTO_PLANE',
                           'description': f"Into-plane service {stn} {t['flight_number']} {t['aircraft_reg']}",
                           'unit_price': f4(rate), 'net_amount': f2(q * rate), 'tax_code': 'V0',
                           'tax_amount': '0.00', 'po_number': '', 'po_item': '', 'gl_account': '610110',
                           'product_ID': ''})
                T['INVOICE_ITEMS'].add(it)
            D.recompute_header(inv)
    D.index()
    return D


def invoice_header(iid, number, internal, supplier, cur, notes, date=INVOICE_DATE):
    due = (dt.date.fromisoformat(date) + dt.timedelta(days=30)).isoformat()
    return {'ID': iid, 'invoice_number': number, 'internal_number': internal, 'supplier_ID': supplier,
            'invoice_date': date, 'posting_date': '', 'due_date': due, 'baseline_date': date, 'currency_code': cur,
            'tax_amount': '0.00', 'payment_terms': 'NET30', 'match_status': 'UNMATCHED', 'approval_status': 'PENDING',
            'requires_dual_approval': 'false', 's4_company_code': COMPANY, 'status': 'SUBMITTED',
            'posting_gate': 'NOT_CHECKED', 'open_hard_count': '0', 'open_soft_count': '0', 'warning_count': '0',
            'notes': notes, 'is_duplicate': 'false', 'created_at': f'{date}T15:00:00Z', 'created_by': BY_C,
            'modified_at': f'{date}T15:00:00Z', 'modified_by': BY_C, 'received_date': date}


def fuel_line(D, iid, line_no, t):
    T = D.t
    o = T['FUEL_ORDERS'].get(t['order_ID'])
    f = T['FLIGHT_SCHEDULE'].get(t['flight_ID'])
    q, p = num(t['quantity']), num(t['rate_per_litre'])
    domestic = f and D.country.get(f['origin_airport']) == 'PT' and D.country.get(f['destination_airport']) == 'PT'
    net = round(q * p, 2)
    day = dt.date.fromisoformat(t['delivery_timestamp'][:10]).strftime('%d%b')
    return {'ID': uid('TP', 'ITM', t['ID']), 'invoice_ID': iid, 'line_number': str(line_no),
            'product_ID': o['product_ID'],
            'description': f"Jet A-1 into-plane {o['station_code']} {t['flight_number']} {day} {t['aircraft_reg']}",
            'po_number': o['s4_po_number'], 'po_item': '00010', 'quantity': f3(q), 'uom_code': 'LTR',
            'unit_price': f4(p), 'net_amount': f2(net),
            # Portuguese domestic legs carry 23% VAT; international supply is exempt.
            'tax_code': 'V23' if domestic else 'V0', 'tax_amount': f2(net * 0.23 if domestic else 0),
            'delivery_ID': t['delivery_ID'], 'fuel_order_ID': t['order_ID'], 'ticket_number': t['ticket_number'],
            'ticket_ID': t['ID'], 'cost_center': f"FUEL{o['station_code']}", 'gl_account': '610100',
            'line_match_status': 'UNMATCHED', 'review_status': 'NONE', 'flight_ID': t['flight_ID'] or '',
            'charge_type': 'FUEL'}

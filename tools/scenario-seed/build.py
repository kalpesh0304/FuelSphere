#!/usr/bin/env python3
"""
Build the JetBlue and TAP scenario seed workbooks.

    FS_COLS_JSON=<model columns json> python3 tools/scenario-seed/build.py <TAP upload .xlsx> <out dir>

The columns JSON comes from tools/scenario-seed/model-columns.js and is what
every sheet is checked against: a column the model does not have fails the
build rather than reaching a CSV.

NOTHING IS WRITTEN TO db/data.
"""
import sys, os, datetime as dt
from collections import defaultdict, Counter
sys.path.insert(0, os.path.dirname(__file__))
from common import Tagger, Table, uid, f2, f3, f4, num, read_csv, load_model_columns
from dataset import Dataset
import tap_base
from scenarios import Engine, Ctx
from workbook import write_workbook

TAP_UPLOAD, OUT = sys.argv[1], sys.argv[2]
COLS = load_model_columns()


CARRIER_ENTITIES = {
    # entity: columns that name a carrier source, in the hook's order (srv/lib/carrier-units.js)
    'FUEL_ORDERS': ['flight_ID'], 'FUEL_DELIVERIES': ['flight_ID', 'order_ID'],
    'FUEL_TICKETS': ['flight_ID', 'order_ID', 'delivery_ID'],
    'INVOICE_ITEMS': ['flight_ID', 'ticket_ID', 'fuel_order_ID', 'delivery_ID'],
    'FUEL_BURNS': ['flight_ID'], 'ROB_LEDGER': ['flight_ID', 'fuel_ticket_ID', 'fuel_order_ID'],
    'FLIGHT_DISPATCH': ['flight_schedule_ID'], 'APU_USAGE': ['flight_ID']}
SOURCE_OF = {'flight_ID': 'FLIGHT_SCHEDULE', 'flight_schedule_ID': 'FLIGHT_SCHEDULE', 'order_ID': 'FUEL_ORDERS',
             'fuel_order_ID': 'FUEL_ORDERS', 'ticket_ID': 'FUEL_TICKETS', 'fuel_ticket_ID': 'FUEL_TICKETS',
             'delivery_ID': 'FUEL_DELIVERIES'}


def fill_carrier(tables, only=None, fallback=None):
    """carrier_code on the rows a workbook writes, by the same rules as the hook.

    `only` limits it to rows whose key is in the set (the JetBlue diff fills only
    rows it ADDS: existing rows are tools/backfill-carrier-units.py's job, and
    touching them here would make every one an UPDATE)."""
    def code(ent, r):
        for col in CARRIER_ENTITIES[ent]:
            src = SOURCE_OF[col]
            hit = tables.get(src) and tables[src].get(r.get(col)) if r.get(col) else None
            if hit:
                c = hit.get('airline_code') if src == 'FLIGHT_SCHEDULE' else hit.get('carrier_code')
                if c:
                    return c
        return fallback
    for ent in CARRIER_ENTITIES:
        tb = tables.get(ent)
        if not tb:
            continue
        for r in tb.rows:
            if (only is None or tb.key(r) in only) and not r.get('carrier_code'):
                r['carrier_code'] = code(ent, r) or ''


def make_ctx(D, code):
    T = D.t
    if code == 'TP':
        pfx = {D.sup_id[k]: v for k, v in D.prefix.items()}
        airport_of = lambda iata: D.airport[iata]
    else:
        pfx = {}
        orders = T['FUEL_ORDERS'].by_id
        for t in T['FUEL_TICKETS'].rows:
            o = orders.get(t['order_ID'])
            if o and t['created_by'] == 'SEED_B6_ADSB':
                pfx.setdefault(o['supplier_ID'], t['ticket_number'].split('-')[0])
        aps = {a['iata_code']: a for a in T['MASTER_AIRPORTS'].rows}
        airport_of = lambda iata: aps[iata]
    common = dict(
        code=code, airport_of=airport_of, prefix_of=lambda sid: pfx.get(sid, 'SUP'),
    )
    if code == 'TP':
        c = Ctx(**common, by='SEED_TP_SCENARIO', stamp='2026-10-23T00:00:00Z', company='TP00',
                window=('2026-10-20', '2026-10-22'), close_period='2026-10', late_date='2026-11-03',
                late_invoice_date='2026-11-05', po_start=4500409000, gr_start=5000409000,
                component_stations=['FNC', 'PDL', 'FAO'], suppliers_with_formula=set(),
                components=[('Platts CIF NWE', 'BASE_INDEX', 0), ('Supplier Differential', 'PREMIUM', 0.0420),
                            ('Into-Plane Fee', 'INTO_PLANE', 0.0150), ('Airport Throughput Fee', 'HANDLING', 0.0085)],
                index_code='SAMPLE-JETA1-NWE-EUR-L', index_name='Jet A-1 CIF NWE, EUR per litre (SAMPLE)',
                index_type='PLATTS_CIF_NWE', index_region='NWE', formula_id='FRM-TP-CMP',
                cmp_s4_contract='4600409001', maint_station='LIS', evening_hour=21, inv_tag='261023',
                dup_numbers=('90012345', '90012346'), defuel_rate=0.0300,
                s07_note='The late invoice is dated 2026-11-05: until that date INV461 (invoice date in the future) '
                         'fires as SOFT. TAP has no movement-ledger rows yet - run tools/seed-burns-and-ledger.js '
                         'after loading so the reconciliation can see these uplifts.',
                gl_line='610100')
    else:
        c = Ctx(**common, by='SEED_B6_SCENARIO', stamp='2026-10-27T00:00:00Z', company='B600',
                window=('2026-09-24', '2026-09-26'), close_period='2026-09', late_date='2026-10-02',
                late_invoice_date='2026-10-05', po_start=4500309000, gr_start=5000309000,
                component_stations=[],
                suppliers_with_formula={f['supplier_id'] for f in T['PRICING_FORMULAS'].rows if f['supplier_id']},
                components=[('Platts USGC', 'BASE_INDEX', 0), ('Supplier Differential', 'PREMIUM', 0.0380),
                            ('Into-Plane Fee', 'INTO_PLANE', 0.0160), ('Airport Throughput Fee', 'HANDLING', 0.0090)],
                index_code='SAMPLE-JETA-USGC-USD-L', index_name='Jet A USGC, USD per litre (SAMPLE)',
                index_type='PLATTS_USGC', index_region='USGC', formula_id='FRM-B6-CMP',
                cmp_s4_contract='4600309001', maint_station='JFK', evening_hour=23, inv_tag='260927',
                dup_numbers=('77004512', '77004513'), defuel_rate=0.0320,
                s07_note='JetBlue already has movement-ledger rows for these tickets, so the shift shows as soon '
                         'as the changed ticket fields load.',
                gl_line='400000')

    def ccy_of(ref):
        for tb, col in (('FUEL_TICKETS', 'ticket_number'), ('INVOICES', 'invoice_number')):
            for r in T[tb].rows:
                if r[col] == ref.split(' ')[0]:
                    return r['currency_code']
        for r in D.proposed.get('DEFUEL_INVOICES', []):
            if r['invoice_number'] == ref.split(' ')[0]:
                return r['currency_code']
        reg = ref.split(' ')[0]
        for t in T['FUEL_TICKETS'].rows:
            if t['aircraft_reg'] == reg:
                return t['currency_code']
        return ''

    def new_line(D_, iid, line_no, t, o):
        day = dt.date.fromisoformat(t['delivery_timestamp'][:10]).strftime('%d%b')
        q, p = num(t['quantity']), num(t['rate_per_litre'])
        return {'ID': uid(code, 'ITM', t['ID']), 'invoice_ID': iid, 'line_number': str(line_no),
                'product_ID': o['product_ID'],
                'description': f"Jet fuel into-plane {o['station_code']} {t['flight_number']} {day} {t['aircraft_reg']}",
                'po_number': o['s4_po_number'], 'po_item': '00010', 'quantity': f3(q), 'uom_code': 'LTR',
                'unit_price': f4(p), 'net_amount': f2(q * p), 'tax_code': 'V0', 'tax_amount': '0.00',
                'delivery_ID': t['delivery_ID'], 'fuel_order_ID': o['ID'], 'ticket_number': t['ticket_number'],
                'ticket_ID': t['ID'], 'cost_center': f"FUEL{o['station_code']}", 'gl_account': c.gl_line,
                'line_match_status': 'UNMATCHED', 'review_status': 'NONE', 'flight_ID': t['flight_ID'] or '',
                'charge_type': 'FUEL'}

    def new_invoice(D_, supplier_id, number, cur, notes):
        date = dt.date.fromisoformat(c.window[1]) + dt.timedelta(days=1)
        hd = tap_base.invoice_header(uid(code, 'INV', number), number, f'INV-{number}'[:30], supplier_id, cur,
                                     notes, date=date.isoformat())
        hd.update({'s4_company_code': c.company if code == 'TP' else 'JB01', 'created_by': c.by, 'modified_by': c.by})
        return T['INVOICES'].add(hd)

    def defuel_header(iid, number, o, src, doc_type, ref_id, notes):
        hd = tap_base.invoice_header(iid, number, f'INV-{number}'[:30], o['supplier_ID'], o['currency_code'], notes,
                                     date=src['invoice_date'])
        hd = {**{k: '' for k in T['INVOICES'].header}, **hd,
              's4_company_code': c.company if code == 'TP' else 'JB01', 'created_by': c.by, 'modified_by': c.by,
              'PROPOSED_document_type': doc_type, 'PROPOSED_reference_invoice_ID': ref_id,
              'PROPOSED_reference_invoice_number': src['invoice_number'] if ref_id else ''}
        return hd

    def defuel_item(iid, n, dt_row, o, qty, price, charge, desc):
        net = round(qty * price, 2)
        return {**{k: '' for k in T['INVOICE_ITEMS'].header},
                'ID': uid(code, 'DFL-ITM', iid, n), 'invoice_ID': iid, 'line_number': str(n), 'product_ID': o['product_ID'],
                'description': desc, 'po_number': o['s4_po_number'], 'po_item': '00010', 'quantity': f3(qty),
                'uom_code': 'LTR', 'unit_price': f4(price), 'net_amount': f2(net), 'tax_code': 'V0', 'tax_amount': '0.00',
                'delivery_ID': dt_row['delivery_ID'], 'fuel_order_ID': o['ID'], 'ticket_number': dt_row['ticket_number'],
                'ticket_ID': dt_row['ID'], 'line_match_status': 'UNMATCHED', 'review_status': 'NONE',
                'flight_ID': dt_row['flight_ID'], 'charge_type': 'FUEL' if charge == 'FUEL' else '',
                'gl_account': c.gl_line, 'PROPOSED_charge_type': charge}

    c.ccy_of, c.new_line, c.new_invoice = ccy_of, new_line, new_invoice
    c.defuel_header, c.defuel_item = defuel_header, defuel_item
    return c


# --------------------------------------------------------------- validation
def validate(code, tables, existing, problems):
    """Every column a real element, mandatory filled, enums honoured, keys unique, FKs resolve."""
    for ent, rows in tables.items():
        if not rows:
            continue
        model = COLS[ent]
        for col in rows[0]:
            if col not in model:
                problems.append(f'{code} {ent}: column {col} is not an element of the model')
        for r in rows:
            for col, m in model.items():
                if m.get('mandatory') and col in r and r[col] in ('', None) and col not in ('ID',):
                    problems.append(f'{code} {ent} {r.get("ID", "")}: mandatory {col} empty')
                if m.get('enum') and r.get(col) not in (None, '') and r[col] not in m['enum']:
                    problems.append(f'{code} {ent} {r.get("ID", "")}: {col}={r[col]} not in {m["enum"]}')
    # FKs
    keys = defaultdict(set)
    for ent, rows in list(existing.items()) + list(tables.items()):
        for r in rows:
            for k in ('ID', 'registration', 'carrier_code', 'code', 'currency_code', 'land1', 'type_code', 'werks'):
                if k in r:
                    keys[ent].add(r[k])
                    break
    for ent, rows in tables.items():
        for col, m in COLS[ent].items():
            if m.get('type') != 'FK':
                continue
            target = m['target'].replace('fuelsphere.', '')
            if target not in keys:
                continue
            for r in rows:
                v = r.get(col)
                if v and v not in keys[target]:
                    problems.append(f'{code} {ent} {r.get("ID", "")}: {col}={v} resolves to nothing in {target}')


LEDGER = ['FUEL_BURNS', 'ROB_LEDGER', 'FUEL_STOCK_MOVEMENT_LEDGER', 'FUEL_STOCK_BALANCE', 'FUEL_BURN_HEADER']


def derive_ledger(base_rows):
    """TAP's burns, ROB ledger and valuation, derived by the project's own tools.

    FROM THE TAP DATA BEFORE THE SCENARIOS. The ledger records what the
    aircraft took on and burnt; the scenarios then change paperwork about it
    (a ticket left off an invoice, detached from its order, captured twice).
    Derived after them, the ledger would drop the uplifts scenarios 8 and 14
    detach - measured on JetBlue: N3162J to -380 kg - and post the duplicates
    scenario 15 says must not be posted. JetBlue's ledger was built the same
    way, before its scenarios existed.

    Run in a scratch copy, so db/data is never touched; only rows for TAP's own
    tails are kept, and the JetBlue rows the tools also regenerate are dropped.
    """
    import tempfile, shutil, subprocess, csv
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
    tmp = tempfile.mkdtemp(prefix='tp-ledger-')
    shutil.copytree(os.path.join(root, 'db'), os.path.join(tmp, 'db'))
    shutil.copytree(os.path.join(root, 'tools'), os.path.join(tmp, 'tools'))
    os.symlink(os.path.join(root, 'node_modules'), os.path.join(tmp, 'node_modules'))
    shutil.copy(os.path.join(root, 'package.json'), tmp)
    data = os.path.join(tmp, 'db', 'data')
    for ent, rows in base_rows.items():
        path = os.path.join(data, f'fuelsphere-{ent}.csv')
        with open(path, encoding='utf-8-sig', newline='') as f:
            r = csv.reader(f, delimiter=';')
            head = next(r)
            old = [dict(zip(head, x)) for x in r if any(x)]
        key = next((k for k in ('ID', 'registration', 'carrier_code', 'code', 'currency_code', 'land1', 'type_code')
                    if k in head), None)
        have = {o[key] for o in old} if key else set()
        for c in rows[0]:
            if c not in head:
                head.append(c)
        with open(path, 'w', encoding='utf-8', newline='') as f:
            w = csv.writer(f, delimiter=';', lineterminator='\n')
            w.writerow(head)
            for o in old + [x for x in rows if not key or x.get(key) not in have]:
                w.writerow([o.get(h, '') for h in head])
    for tool in (['node', 'tools/seed-burns-and-ledger.js'], ['node', 'tools/seed-fifo-valuation.js', '--write']):
        res = subprocess.run(tool, cwd=tmp, capture_output=True, text=True, timeout=1200)
        if res.returncode:
            raise RuntimeError(f'{tool[1]} failed: {res.stderr[-800:]}')
    tails = {r['registration'] for r in base_rows['AIRCRAFT_REGISTRATIONS']}
    out = {}
    for ent in LEDGER:
        with open(os.path.join(data, f'fuelsphere-{ent}.csv'), encoding='utf-8-sig', newline='') as f:
            r = csv.reader(f, delimiter=';')
            head = next(r)
            out[ent] = [dict(zip(head, x + [''] * (len(head) - len(x)))) for x in r
                        if any(x) and dict(zip(head, x)).get('tail_number') in tails]
    shutil.rmtree(tmp)
    print('TP ledger derived:', {e: len(v) for e, v in out.items()})
    return {e: v for e, v in out.items() if v}


def existing_rows():
    out = {}
    for e in COLS:
        p = os.path.join(os.path.dirname(__file__), '..', '..', 'db', 'data', f'fuelsphere-{e}.csv')
        if os.path.exists(p):
            out[e] = read_csv(e)[1]
    return out


def arithmetic(code, D, problems, only=None):
    for inv in D.t['INVOICES'].rows:
        if only is not None and inv['ID'] not in only:
            continue
        items = D.items_of(inv['ID'])
        if not items:
            continue
        s = round(sum(num(i['net_amount']) for i in items), 2)
        if abs(s - (num(inv['net_amount']) or 0)) > 0.011:
            problems.append(f'{code} invoice {inv["invoice_number"]}: header net {inv["net_amount"]} vs lines {s}')
        for i in items:
            if abs(num(i['quantity']) * num(i['unit_price']) - num(i['net_amount'])) > 0.011:
                problems.append(f'{code} line {i["ID"]}: q x p != net')


def main():
    problems = []
    built = existing_rows()
    results = {}

    # ---------------- JetBlue: a diff over the seed in the build -------------
    B = Dataset('B6', load_existing=True)
    tg_b = Tagger()
    cb = make_ctx(B, 'B6')
    refs_b = Engine(B, cb, tg_b).run()
    new_keys = {tb.key(r) for e, tb in B.t.items() for r in tb.rows if tb.key(r) not in B.snapshot[e]}
    fill_carrier(B.t, only=new_keys, fallback='B6')   # every row this workbook adds is JetBlue's
    adds, updates = B.diff()
    for u in updates:
        if u['column'] not in COLS[u['entity']]:
            problems.append(f"B6 UPDATE {u['entity']}.{u['column']}: not a model column")
    touched = {r['ID'] for r in adds.get('INVOICES', [])} | {u['key'] for u in updates if u['entity'] == 'INVOICES'} \
        | {B.t['INVOICE_ITEMS'].get(u['key'])['invoice_ID'] for u in updates if u['entity'] == 'INVOICE_ITEMS'} \
        | {r['invoice_ID'] for r in adds.get('INVOICE_ITEMS', [])}
    arithmetic('B6', B, problems, only=touched)
    validate('B6', adds, built, problems)
    for u in updates:
        m = COLS[u['entity']].get(u['column'])
        if not m:
            problems.append(f"B6 UPDATE {u['entity']}.{u['column']}: not an element")
            continue
        v = u['new_value']
        if m.get('enum') and v and v not in m['enum']:
            problems.append(f"B6 UPDATE {u['entity']}.{u['column']}={v} not in enum")
        if m.get('mandatory') and not v:
            problems.append(f"B6 UPDATE {u['entity']}.{u['column']} blanks a mandatory field")
        if m.get('type') == 'FK' and v:
            tgt = m['target'].replace('fuelsphere.', '')
            ok = v in {r.get('ID') for r in built.get(tgt, [])} | {r.get('ID') for r in adds.get(tgt, [])}
            if not ok:
                problems.append(f"B6 UPDATE {u['entity']}.{u['column']}={v} resolves to nothing")
    results['B6'] = (B, refs_b, tg_b, adds, updates)

    # ---------------- TAP: everything, built from the upload -----------------
    P = Dataset('TP', load_existing=False)
    tap_base.build(P, TAP_UPLOAD)
    base_rows = {e: [dict(r) for r in tb.rows] for e, tb in P.t.items() if tb.rows}
    tg_p = Tagger()
    cp = make_ctx(P, 'TP')
    refs_p = Engine(P, cp, tg_p).run()
    arithmetic('TP', P, problems)
    for ent, rows in derive_ledger(base_rows).items():
        P.t[ent] = Table(ent, list(rows[0].keys()), rows)
    fill_carrier(P.t, fallback='TP')
    for tb in P.t.values():
        tb.sync_header()
    full = {e: tb.rows for e, tb in P.t.items() if tb.rows}
    validate('TP', full, built, problems)
    results['TP'] = (P, refs_p, tg_p, full, [])
    for code, (_, refs, _, _, _) in results.items():
        for sid in range(1, 18):
            if len(refs.get(sid, [])) != 3:
                problems.append(f'{code} scenario {sid}: {len(refs.get(sid, []))} references, not 3')

    # Keys unique within each workbook - a collision here is two rows that
    # would load as one.
    for code, (_, _, _, rows, _) in results.items():
        for ent, rs in rows.items():
            k = next((k for k in ('ID', 'registration', 'carrier_code', 'code', 'currency_code', 'land1',
                                  'type_code', 'werks') if rs and k in rs[0]), None)
            c = Counter(r[k] for r in rs) if k else Counter()
            for v, n in c.items():
                if n > 1:
                    problems.append(f'{code} {ent}: key {v} appears {n} times in the workbook')
        cn = Counter(r['contract_number'] for r in rows.get('MASTER_CONTRACTS', []))
        problems += [f'{code} contract_number {v} x{n}' for v, n in cn.items() if n > 1]
        inv = Counter((r['invoice_number'], r['supplier_ID']) for r in rows.get('INVOICES', []))
        problems += [f'{code} invoice {v} x{n} (intended only for scenario 16A)' for v, n in inv.items()
                     if n > 1 and v[0] not in ('77004512', '90012345')]
    # Collisions with what is already in the build.
    for code, (_, _, _, rows, _) in results.items():
        for ent, rs in rows.items():
            if ent not in built:
                continue
            k = 'ID' if 'ID' in COLS[ent] else None
            if not k:
                continue
            have = {r['ID'] for r in built[ent]}
            for r in rs:
                if r.get('ID') in have:
                    problems.append(f'{code} {ent}: ID {r["ID"]} already in db/data')
    for ent, col in (('FUEL_ORDERS', 'order_number'), ('FUEL_TICKETS', 'internal_number'),
                     ('FUEL_DELIVERIES', 'delivery_number'), ('FUEL_ORDERS', 's4_po_number'),
                     ('FUEL_DELIVERIES', 's4_gr_number')):
        allv = Counter()
        for r in built.get(ent, []):
            allv[r[col]] += 1
        for code, (_, _, _, rows, _) in results.items():
            for r in rows.get(ent, []):
                allv[r[col]] += 1
        dup = [v for v, n in allv.items() if v and n > 1]
        if dup:
            problems.append(f'{ent}.{col}: {len(dup)} duplicate values, e.g. {dup[:3]}')

    os.makedirs(OUT, exist_ok=True)
    write_workbook(os.path.join(OUT, 'JetBlue_B6_Scenario_Seed_2026-09-24_to_26.xlsx'), 'B6', *results['B6'], COLS)
    write_workbook(os.path.join(OUT, 'TAP_TP_Scenario_Seed_2026-10-20_to_22.xlsx'), 'TP', *results['TP'], COLS)
    import re
    kinds = Counter(re.sub(r'[0-9a-f]{8}-[0-9a-f-]{27}', '<id>', p).split(':')[0] + ':' +
                    re.sub(r'[0-9a-f]{8}-[0-9a-f-]{27}', '<id>', ':'.join(p.split(':')[1:]))[:90] for p in problems)
    print('problems:', len(problems))
    for k, n in kinds.most_common(15):
        print(f'  x{n}  {k}')
    for p in problems[:80]:
        print('  ', p)
    for code, (D, refs, tg, rows, upd) in results.items():
        print(code, {e: len(v) for e, v in rows.items()}, 'updates', len(upd))


if __name__ == '__main__':
    main()

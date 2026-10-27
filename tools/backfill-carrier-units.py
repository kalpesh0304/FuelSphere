#!/usr/bin/env python3
"""
Seed the carrier currency and units, and backfill carrier_code on every fuel
record already in db/data.

    python3 tools/backfill-carrier-units.py [data dir]     (default db/data)

WHY A CSV BACKFILL AND NOT THE HOOK. srv/lib/carrier-units.js fills
carrier_code at write - but an HDI deploy on HANA loads CSVs with no
JavaScript in the path, so the seed must carry the column itself. The rules
here mirror the hook's, in the same order: the row's flight, then its order,
ticket or delivery, then the tail's own flights.

IDEMPOTENT. A row that already names a carrier keeps it; re-running writes the
same files. Line endings, quoting and untouched rows are preserved.
"""
import csv, os, sys
from collections import defaultdict

DATA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'db', 'data')

# Company-code currency and the units its fuel records are read in. B6/B7 in
# US gallons and pounds - CONFIRMED by the business, 27 Oct 2026. TP and AC in
# litres and kilograms.
CARRIERS = {
    'B6': ('USD', 'USG', 'LB'),
    'B7': ('USD', 'USG', 'LB'),
    'AC': ('CAD', 'LTR', 'KG'),
    'TP': ('EUR', 'LTR', 'KG'),
}
# Litres per unit, exact by definition; null on mass units.
LTR = {'LTR': '1.000000000', 'GAL': '3.785411784', 'USG': '3.785411784'}
LB_ROW = {'uom_code': 'LB', 'uom_name': 'Pound', 'uom_category': 'MASS', 'conversion_to_kg': '0.453592',
          'is_active': 'true', 'sap_uom': 'LB', 'sap_uom_iso': 'LBR', 'conversion_to_ltr': ''}

# entity: [(column, source entity)] in resolution order, and the tail column.
SOURCES = {
    'FUEL_ORDERS':     ([('flight_ID', 'FLIGHT_SCHEDULE')], None),
    'FUEL_DELIVERIES': ([('flight_ID', 'FLIGHT_SCHEDULE'), ('order_ID', 'FUEL_ORDERS')], 'aircraft_reg'),
    'FUEL_TICKETS':    ([('flight_ID', 'FLIGHT_SCHEDULE'), ('order_ID', 'FUEL_ORDERS'),
                         ('delivery_ID', 'FUEL_DELIVERIES')], 'aircraft_reg'),
    'INVOICE_ITEMS':   ([('flight_ID', 'FLIGHT_SCHEDULE'), ('ticket_ID', 'FUEL_TICKETS'),
                         ('fuel_order_ID', 'FUEL_ORDERS'), ('delivery_ID', 'FUEL_DELIVERIES')], None),
    'FUEL_BURNS':      ([('flight_ID', 'FLIGHT_SCHEDULE')], 'tail_number'),
    'ROB_LEDGER':      ([('flight_ID', 'FLIGHT_SCHEDULE'), ('fuel_ticket_ID', 'FUEL_TICKETS'),
                         ('fuel_order_ID', 'FUEL_ORDERS')], 'tail_number'),
    'FLIGHT_DISPATCH': ([('flight_schedule_ID', 'FLIGHT_SCHEDULE')], 'tail_number'),
    'APU_USAGE':       ([('flight_ID', 'FLIGHT_SCHEDULE')], 'tail_number'),
}
ORDER = ['FUEL_ORDERS', 'FUEL_DELIVERIES', 'FUEL_TICKETS', 'INVOICE_ITEMS', 'FUEL_BURNS', 'ROB_LEDGER',
         'FLIGHT_DISPATCH', 'APU_USAGE']


def path(e):
    return os.path.join(DATA, f'fuelsphere-{e}.csv')


def read(e):
    raw = open(path(e), encoding='utf-8-sig', newline='').read()
    eol = '\r\n' if '\r\n' in raw else '\n'
    r = csv.reader(raw.splitlines(), delimiter=';', quotechar='"')
    head = next(r)
    return head, [dict(zip(head, x + [''] * (len(head) - len(x)))) for x in r if any(x)], eol


def write(e, head, rows, eol):
    with open(path(e), 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, delimiter=';', quotechar='"', lineterminator=eol)
        w.writerow(head)
        for r in rows:
            w.writerow([r.get(h, '') or '' for h in head])


def ensure(head, col, after=None):
    if col not in head:
        head.insert(head.index(after) + 1 if after in head else len(head), col)


def main():
    # ---- master data --------------------------------------------------------
    head, rows, eol = read('CARRIER_MASTER')
    for c in ('currency_code', 'volume_uom_code', 'mass_uom_code'):
        ensure(head, c)
    for r in rows:
        cur, vol, mass = CARRIERS.get(r['carrier_code'], ('', '', ''))
        r.setdefault('currency_code', ''); r.setdefault('volume_uom_code', ''); r.setdefault('mass_uom_code', '')
        r['currency_code'] = r['currency_code'] or cur
        r['volume_uom_code'] = r['volume_uom_code'] or vol
        r['mass_uom_code'] = r['mass_uom_code'] or mass
    write('CARRIER_MASTER', head, rows, eol)

    head, rows, eol = read('UNIT_OF_MEASURE')
    ensure(head, 'conversion_to_ltr', 'conversion_to_kg')
    for r in rows:
        r['conversion_to_ltr'] = r.get('conversion_to_ltr') or LTR.get(r['uom_code'], '')
    if 'LB' not in {r['uom_code'] for r in rows}:
        rows.append(LB_ROW)
    write('UNIT_OF_MEASURE', head, rows, eol)

    head, rows, eol = read('MASTER_CONTRACTS')
    ensure(head, 'uom_code', 'currency_code')
    for r in rows:
        r['uom_code'] = r.get('uom_code') or 'LTR'   # every seeded contract prices per litre
    write('MASTER_CONTRACTS', head, rows, eol)

    # ---- carrier_code on every fuel record ---------------------------------
    flights = {f['ID']: f['airline_code'] for f in read('FLIGHT_SCHEDULE')[1]}
    tail_carrier = {}
    for f in read('FLIGHT_SCHEDULE')[1]:
        if f['aircraft_reg'] and f['airline_code']:
            tail_carrier.setdefault(f['aircraft_reg'], f['airline_code'])
    known = {'FLIGHT_SCHEDULE': flights}
    stats = {}
    for e in ORDER:
        head, rows, eol = read(e)
        ensure(head, 'carrier_code')
        cols, tail = SOURCES[e]
        n = 0
        for r in rows:
            if r.get('carrier_code'):
                continue
            code = ''
            for col, src in cols:
                code = known.get(src, {}).get(r.get(col, '')) or ''
                if code:
                    break
            if not code and tail:
                code = tail_carrier.get(r.get(tail, ''), '')
            r['carrier_code'] = code
            n += bool(code)
        known[e] = {r['ID']: r['carrier_code'] for r in rows}
        write(e, head, rows, eol)
        stats[e] = (n, sum(1 for r in rows if not r['carrier_code']))
    for e, (n, missing) in stats.items():
        print(f'  {e}: {n} rows given a carrier, {missing} with none')


if __name__ == '__main__':
    main()

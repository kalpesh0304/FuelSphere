#!/usr/bin/env python3
"""
Seed a DEFUEL and a TEMP storage location at every station.

    python3 tools/seed-storage-locations.py [data dir]     (default db/data)

A STATION IS ANY AIRPORT A FLIGHT LEAVES FROM OR ARRIVES AT, in
FLIGHT_SCHEDULE, for every carrier. STORAGE_LOCATION has no carrier, so a
station shared by two airlines gets one pair, as JFK, BOS and MCO already did.

NAMED AND SIZED AS THOSE THREE ARE: <IATA>-DEFUEL (awaiting vendor return or
disposal, 40,000 kg) and <IATA>-TEMP (held for re-uplift, 25,000 kg). Capacity
is advisory (db/defuel.cds); the figures are placeholders until a station
states its tanks.

IDEMPOTENT. A station that already has a location of a type keeps it; IDs are
derived from the code, so a re-run writes the same rows.
"""
import csv, os, sys, uuid

DATA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'db', 'data')
NS = uuid.UUID('d1f00000-0000-4000-8000-000000000000')
KINDS = [('DEFUEL', 'Defuel holding tank - awaiting vendor credit or disposal', '40000.00'),
         ('TEMP', 'Temporary holding - fuel awaiting re-uplift to another tail', '25000.00')]
STAMP = '2026-10-27T00:00:00Z'


def read(e):
    raw = open(os.path.join(DATA, f'fuelsphere-{e}.csv'), encoding='utf-8-sig', newline='').read()
    eol = '\r\n' if '\r\n' in raw else '\n'
    r = csv.reader(raw.splitlines(), delimiter=';', quotechar='"')
    head = next(r)
    return head, [dict(zip(head, x + [''] * (len(head) - len(x)))) for x in r if any(x)], eol


def main():
    _, airports, _ = read('MASTER_AIRPORTS')
    by_iata = {a['iata_code']: a for a in airports}
    _, flights, _ = read('FLIGHT_SCHEDULE')
    stations = sorted({f[k] for f in flights for k in ('origin_airport', 'destination_airport') if f[k]})
    head, rows, eol = read('STORAGE_LOCATION')
    have = {(r['station_code'], r['location_type']) for r in rows}
    added, unknown = 0, []
    for st in stations:
        a = by_iata.get(st)
        if not a:
            unknown.append(st)
            continue
        for kind, desc, cap in KINDS:
            if (st, kind) in have:
                continue
            code = f'{st}-{kind}'
            rows.append({'ID': str(uuid.uuid5(NS, code)), 'code': code, 'description': desc,
                         'airport_ID': a['ID'], 'station_code': st, 'location_type': kind,
                         'capacity_kg': cap, 'valid_from': '2026-01-01', 'valid_to': '',
                         'is_active': 'true', 'notes': '', 'created_at': STAMP,
                         'created_by': 'SEED_STORAGE_LOCATIONS', 'modified_at': STAMP,
                         'modified_by': 'SEED_STORAGE_LOCATIONS'})
            added += 1
    with open(os.path.join(DATA, 'fuelsphere-STORAGE_LOCATION.csv'), 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, delimiter=';', quotechar='"', lineterminator=eol)
        w.writerow(head)
        for r in rows:
            w.writerow([r.get(h, '') or '' for h in head])
    print(f'{len(stations)} stations; {added} location(s) added; {len(rows)} in total')
    if unknown:
        print('  no MASTER_AIRPORTS row, skipped:', ', '.join(unknown))


if __name__ == '__main__':
    main()

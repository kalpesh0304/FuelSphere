#!/usr/bin/env python3
"""
Merge a scenario workbook into a set of seed CSVs.

    python3 tools/scenario-seed/apply.py <workbook.xlsx> <source data dir> <target data dir>

Reads every CSV in <source>, applies the workbook, writes all CSVs to <target>.
TAP sheets and ADD_<ENTITY> sheets are appended; UPDATES are applied after the
appends; PROPOSED_* sheets are NEVER loaded. Headers are unioned, so a column
the existing CSV lacks (e.g. the s4_* posting fields on FUEL_TICKETS) is added
to the file and left empty on the existing rows.

A row whose key is already present is SKIPPED, not duplicated (skip-if-present,
as the TAP README asks for countries, airports and code-list rows).

Point <target> at db/data only when you mean to seed the build.
"""
import csv, os, sys, shutil
import openpyxl

ENT_SHEET = lambda name: name[4:] if name.startswith('ADD_') else name
KEYS = ('ID', 'registration', 'carrier_code', 'code', 'currency_code', 'land1', 'type_code', 'werks', 'uom_code')


def read(path):
    with open(path, encoding='utf-8-sig', newline='') as f:
        r = csv.reader(f, delimiter=';', quotechar='"')
        head = next(r)
        return head, [dict(zip(head, row + [''] * (len(head) - len(row)))) for row in r if any(row)]


def write(path, head, rows):
    with open(path, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, delimiter=';', quotechar='"', quoting=csv.QUOTE_MINIMAL, lineterminator='\n')
        w.writerow(head)
        for r in rows:
            w.writerow([r.get(h, '') or '' for h in head])


def main(book, src, dst):
    if os.path.abspath(src) != os.path.abspath(dst):
        os.makedirs(dst, exist_ok=True)
        for fn in os.listdir(src):
            if fn.endswith('.csv'):
                shutil.copy(os.path.join(src, fn), os.path.join(dst, fn))
    wb = openpyxl.load_workbook(book, read_only=True)
    skip = {'README', 'Scenario_Index', 'Findings', 'UPDATES', 'Proposed_Schema', 'Expected_Journal_Entries',
            'Scenario_Rows'}
    stats = {}
    for name in wb.sheetnames:
        if name in skip or name.startswith('PROPOSED_') or name.endswith('_add') and False:
            continue
        ent = ENT_SHEET(name).replace('_add', '')
        path = os.path.join(dst, f'fuelsphere-{ent}.csv')
        if not os.path.exists(path):
            print(f'  {name}: no CSV for {ent}, skipped')
            continue
        head, rows = read(path)
        it = wb[name].iter_rows(values_only=True)
        sh = [str(h) for h in next(it)]
        key = next((k for k in KEYS if k in head), None)
        have = {r[key] for r in rows} if key else set()
        for h in sh:
            if h not in head:
                head.append(h)
        added = skipped = 0
        for v in it:
            r = {h: ('' if x is None else str(x)) for h, x in zip(sh, v)}
            if key and r.get(key) in have:
                skipped += 1
                continue
            rows.append(r)
            have.add(r.get(key))
            added += 1
        write(path, head, rows)
        stats[ent] = (added, skipped)
    if 'UPDATES' in wb.sheetnames:
        it = wb['UPDATES'].iter_rows(values_only=True)
        next(it)
        by_ent = {}
        for e, kc, k, col, old, new in it:
            by_ent.setdefault(e, []).append((k, col, '' if old is None else str(old), '' if new is None else str(new)))
        for e, ups in by_ent.items():
            path = os.path.join(dst, f'fuelsphere-{e}.csv')
            head, rows = read(path)
            idx = {r['ID']: r for r in rows}
            stale = 0
            for k, col, old, new in ups:
                r = idx[k]
                if col not in head:
                    head.append(col)
                if (r.get(col, '') or '') != old:
                    stale += 1
                r[col] = new
            write(path, head, rows)
            stats[f'UPDATES {e}'] = (len(ups), stale)
            if stale:
                print(f'  WARNING {e}: {stale} updates found a value other than the one the workbook expected')
    for k, v in stats.items():
        print(f'  {k}: {v[0]} applied, {v[1]} skipped/stale')


if __name__ == '__main__':
    main(*sys.argv[1:4])

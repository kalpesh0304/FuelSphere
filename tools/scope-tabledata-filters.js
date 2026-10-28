#!/usr/bin/env node
/**
 * Scope a seed import to the rows it actually owns.
 *
 * ===========================================================================
 * THE DEPLOY THIS FIXES, 28 Oct 2026:
 *
 *   com.sap.hana.di.tabledata: The "include_filter" definitions match with 33
 *   records that already exist in the "FUELSPHERE_NUMBER_RANGES" table
 *   ...and then, once that was scoped:
 *   ...match with 8 records that already exist in the "FUELSPHERE_DEFUEL" table
 *
 * CAP emits `"include_filter": []` for seed data, and an EMPTY filter means
 * the import claims the WHOLE table. HDI then refuses to take ownership of
 * rows it did not create - correctly, because taking them would mean deleting
 * them on the next deploy.
 *
 * THAT IS FINE FOR MASTER DATA, where the seed IS the table. It breaks on any
 * table the APPLICATION also writes:
 *
 *   NUMBER_RANGES   every ticket, order and memo number allocated since the
 *                   last deploy. Deleting these would re-issue used numbers.
 *   DEFUEL          every defuel recorded through the app.
 *   the valuation   every ledger and balance row a defuel posted.
 *
 * HOW IT IS SCOPED. Each seeder stamps CREATED_BY with its own name, and the
 * application stamps a user or a service. So one filter entry - CREATED_BY =
 * the seeder - gives the import exactly its own rows and nothing else. That
 * is one entry instead of twelve thousand, and it stays correct as the seed
 * grows.
 *
 * NUMBER_RANGES is the exception: a counter carries no stamp, so it is scoped
 * by the four range keys the CSV actually contains.
 *
 * WHERE IT RUNS, AND WHY THAT MATTERS. Inside mta.yaml's `before-all`, after
 * `cds build --production` and before packaging. cds build regenerates gen/
 * wholesale, so patching those files from outside the build is erased by the
 * next one - which is exactly how this failed twice on 28 Oct after it had
 * supposedly been fixed.
 * ===========================================================================
 */
const fs = require('node:fs');
const path = require('node:path');

const GEN = path.resolve(__dirname, '..', 'gen', 'db', 'src', 'gen', 'data');

const RUNTIME_WRITTEN = {
    // A counter has no stamp, so it is scoped by the keys in the CSV.
    'fuelsphere-NUMBER_RANGES': { by: 'keys', keys: ['RANGE_KEY'] },

    // Seeded AND written by the application. One filter entry each.
    'fuelsphere-DEFUEL':
        { by: 'stamp', column: 'CREATED_BY', value: 'SEED_DEFUEL_SCENARIOS' },
    'fuelsphere-FUEL_STOCK_MOVEMENT_LEDGER':
        { by: 'stamp', column: 'CREATED_BY', value: 'SEED_FIFO_VALUATION' },
    'fuelsphere-FUEL_STOCK_BALANCE':
        { by: 'stamp', column: 'CREATED_BY', value: 'SEED_FIFO_VALUATION' }
};

let patched = 0;

for (const [base, rule] of Object.entries(RUNTIME_WRITTEN)) {
    const td = path.join(GEN, base + '.hdbtabledata');
    const csv = path.join(GEN, base + '.csv');
    if (!fs.existsSync(td) || !fs.existsSync(csv)) continue;

    const doc = JSON.parse(fs.readFileSync(td, 'utf8'));
    const imp = doc.imports && doc.imports[0];
    if (!imp || !imp.import_settings) continue;

    const existing = imp.import_settings.include_filter;
    if (Array.isArray(existing) && existing.length > 0) continue;   // already scoped

    let filter;
    let how;

    if (rule.by === 'stamp') {
        // ONE ENTRY: everything this seeder wrote, and nothing else.
        filter = [{ [rule.column]: rule.value }];
        how = rule.column + '=' + rule.value;
    } else {
        const text = fs.readFileSync(csv, 'utf8');
        const lines = text.split('\n').map((l) => l.replace('\r', '')).filter((l) => l.trim());
        const cols = lines[0].split(';').map((c) => c.trim().toUpperCase());
        const idx = rule.keys.map((k) => cols.indexOf(k));
        if (idx.some((i) => i < 0)) {
            console.error('  ' + base + ': key column(s) not in the CSV header - left alone');
            continue;
        }
        filter = lines.slice(1).map((l) => {
            const f = l.split(';');
            const row = {};
            rule.keys.forEach((k, n) => { row[k] = (f[idx[n]] || '').trim(); });
            return row;
        });
        how = filter.length + ' row(s) by ' + rule.keys.join(', ');
    }

    imp.import_settings.include_filter = filter;
    fs.writeFileSync(td, JSON.stringify(doc, null, 2) + '\n', 'utf8');
    console.log('  ' + base + ': scoped to ' + how);
    patched += 1;
}

console.log(patched ? 'scoped ' + patched + ' import(s)' : 'nothing to scope');

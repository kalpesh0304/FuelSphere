/**
 * Nothing points at a master row that does not exist.
 *
 * WRITTEN THE DAY IT WAS NEEDED, 2 Oct 2026. Somebody pressed Sync S/4 on the
 * Suppliers app. The sync ran "DELETE all -> INSERT from S/4", and mapRow
 * never set ID, so every row came back with a NEW uuid. MASTER_SUPPLIERS is
 * referenced by uuid from seven other tables, and all of those references were
 * left pointing at rows that no longer existed.
 *
 * NOTHING ERRORED. A dangling managed association renders as an EMPTY FIELD,
 * not as a failure - so the first symptom was a person noticing the supplier
 * column had gone blank on the Flight Schedule, with the contract number
 * beside it still filled because MASTER_CONTRACTS was never touched. There was
 * no log, no exception and no screen that said what had happened.
 *
 * That is what this harness is for: an invariant that cannot announce itself
 * needs an instrument. It checks the references rather than the sync, because
 * the sync is only one of the ways to break them - a careless DELETE in a
 * migration script does it just as quietly.
 *
 * EXIT-1  the reader finds a reference it is built to find
 * EXIT-2  every supplier reference resolves
 * EXIT-3  every other master reference resolves
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');

cds.test(PROJECT);
const out = (s) => process.stdout.write('      ' + s + '\n');
const db = () => cds.connect.to('db');

/** Every row of `table`.`column` that names an ID `master` does not hold. */
async function dangling(table, column, master) {
    const d = await db();
    const ids = new Set((await d.run(cds.ql.SELECT.from(master).columns('ID'))).map(r => r.ID));
    const rows = await d.run(cds.ql.SELECT.from(table).columns('ID', column));
    const bad = rows.filter(r => r[column] && !ids.has(r[column]));
    return { total: rows.length, filled: rows.filter(r => r[column]).length, bad, known: ids.size };
}

const SUPPLIER_REFS = [
    ['fuelsphere.DESIGNATED_SUPPLIERS', 'supplier_ID'],
    ['fuelsphere.DESIGNATED_SUPPLIERS', 'into_plane_agent_ID'],
    ['fuelsphere.MASTER_CONTRACTS',     'supplier_ID'],
    ['fuelsphere.FUEL_ORDERS',          'supplier_ID'],
    ['fuelsphere.INVOICES',             'supplier_ID'],
    ['fuelsphere.SUPPLIER_CONTACTS',    'supplier_ID'],
    ['fuelsphere.STATION_SUPPLIER_MAP', 'supplier_ID'],
    ['fuelsphere.FLIGHT_SUPPLIER_MAP',  'supplier_ID']
];

const OTHER_REFS = [
    ['fuelsphere.DESIGNATED_SUPPLIERS', 'supplier_contract_ID', 'fuelsphere.MASTER_CONTRACTS'],
    ['fuelsphere.STATION_SUPPLIER_MAP', 'contract_ID',          'fuelsphere.MASTER_CONTRACTS'],
    ['fuelsphere.STATION_SUPPLIER_MAP', 'airport_ID',           'fuelsphere.MASTER_AIRPORTS'],
    ['fuelsphere.FLIGHT_SUPPLIER_MAP',  'airport_ID',           'fuelsphere.MASTER_AIRPORTS'],
    ['fuelsphere.STATION_PLANT_MAP',    'airport_ID',           'fuelsphere.MASTER_AIRPORTS'],
    ['fuelsphere.FUEL_ORDERS',          'airport_ID',           'fuelsphere.MASTER_AIRPORTS']
];

describe('master reference integrity', () => {

    // ------------------------------------------------------------- EXIT-1 --
    // A checker that reports "zero dangling" because it read zero rows would
    // pass over a landscape in ruins. Prove it finds a reference first, and
    // prove it would call a fabricated one dangling.
    it('EXIT-1  the reader finds a reference it is built to find', async () => {
        const r = await dangling('fuelsphere.DESIGNATED_SUPPLIERS', 'supplier_ID',
            'fuelsphere.MASTER_SUPPLIERS');
        assert.ok(r.total > 0, 'DESIGNATED_SUPPLIERS read back empty - the reader sees nothing');
        assert.ok(r.filled > 0, 'not one designation carries a supplier_ID');
        assert.ok(r.known > 0, 'MASTER_SUPPLIERS read back empty');
        out(`${r.filled} of ${r.total} designations name a supplier, against ${r.known} suppliers`);

        // The control: a reference that cannot resolve must be reported.
        const d = await db();
        const ids = new Set((await d.run(cds.ql.SELECT.from('fuelsphere.MASTER_SUPPLIERS')
            .columns('ID'))).map(x => x.ID));
        assert.ok(!ids.has('00000000-dead-4000-8000-000000000000'),
            'the control id must not exist');
        out('control: a fabricated id is absent from the master, as the check assumes');
    });

    // ------------------------------------------------------------- EXIT-2 --
    it('EXIT-2  every supplier reference resolves', async () => {
        const broken = [];
        for (const [table, column] of SUPPLIER_REFS) {
            let r;
            try { r = await dangling(table, column, 'fuelsphere.MASTER_SUPPLIERS'); }
            catch (e) { out(`${table}.${column}: not in this model (${e.message.slice(0, 40)})`); continue; }
            out(`${table}.${column}: ${r.filled}/${r.total} filled, ${r.bad.length} dangling`);
            if (r.bad.length) broken.push(`${table}.${column}: ${r.bad.length} row(s), `
                + `e.g. ${r.bad[0][column]}`);
        }
        assert.deepStrictEqual(broken, [],
            'references name a supplier that does not exist. The supplier renders BLANK on every '
          + 'screen that shows it and nothing errors:\n  ' + broken.join('\n  '));
    });

    // ------------------------------------------------------------- EXIT-3 --
    it('EXIT-3  every other master reference resolves', async () => {
        const broken = [];
        for (const [table, column, master] of OTHER_REFS) {
            let r;
            try { r = await dangling(table, column, master); }
            catch (e) { out(`${table}.${column}: not in this model`); continue; }
            out(`${table}.${column} -> ${master.split('.')[1]}: ${r.filled}/${r.total} filled, `
              + `${r.bad.length} dangling`);
            if (r.bad.length) broken.push(`${table}.${column} -> ${master}: ${r.bad.length} row(s)`);
        }
        assert.deepStrictEqual(broken, [],
            'references name a master row that does not exist:\n  ' + broken.join('\n  '));
    });
});

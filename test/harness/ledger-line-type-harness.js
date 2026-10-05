/**
 * The Line type column survives the client not asking for entry_type.
 *
 * WHAT WENT WRONG, 5 Oct 2026. The ledger table shows line_type_v and does NOT
 * show entry_type beside it, so Fiori's $select never asks for entry_type - and
 * the handler was reading `row.entry_type` off the payload to look the words
 * up. It was undefined on every row, the lookup missed, and the column went
 * blank across the whole table. Nothing errored; a blank column is what an
 * after-READ handler produces when the column it reads from was not selected.
 *
 * THE $select IS THE WHOLE TEST. A criterion that reads the entity set without
 * one gets every column, entry_type included, and passes against the broken
 * code - which is exactly why this was not caught when line_type_v was added.
 *
 * EXIT-1  the ledger names its line types when asked for them alone
 * EXIT-2  every entry type in the data has words, APU burn included
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');

const test = cds.test(PROJECT);
const out = (s) => process.stdout.write('      ' + s + '\n');
const db = () => cds.connect.to('db');
const O = '/odata/v4/burn';

async function call(fn) {
    try { const r = await fn(); return { status: r.status, body: r.data }; }
    catch (e) {
        return { status: e.response?.status ?? 'ERR', body: e.response?.data,
                 msg: e.response?.data?.error?.message ?? e.message };
    }
}

describe('the ledger line type', () => {

    // ------------------------------------------------------------- EXIT-1 --
    it('EXIT-1  reads back when the client selects it ALONE', async () => {
        // EXACTLY WHAT THE TABLE SENDS: line_type_v and no entry_type. This is
        // the request that produced blanks.
        const r = await call(() => test.GET(`${O}/ROBLedger?$top=200&$select=ID,line_type_v`));
        assert.strictEqual(r.status, 200, r.msg);
        const rows = r.body.value;
        assert.ok(rows.length > 0, 'the ledger read back empty');

        const blank = rows.filter(x => !x.line_type_v);
        out(`${rows.length} row(s) requested with line_type_v alone; ${blank.length} blank`);
        assert.strictEqual(blank.length, 0,
            `${blank.length} of ${rows.length} rows have no line type when the client does not `
          + 'also select entry_type. The handler is reading the payload instead of the re-read.');
    });

    // ------------------------------------------------------------- EXIT-2 --
    it('EXIT-2  every entry type in the data has words, APU burn included', async () => {
        const d = await db();
        const stored = await d.run(cds.ql.SELECT.from('fuelsphere.ROB_LEDGER')
            .columns('entry_type').groupBy('entry_type'));
        const types = stored.map(s => s.entry_type).filter(Boolean);
        assert.ok(types.length > 1, 'only one entry type in the data - this proves little');
        out(`entry types present: ${types.join(', ')}`);

        // APU_BURN is named explicitly: it is the one that prompted this.
        assert.ok(types.includes('APU_BURN'),
            'no APU_BURN row in the ledger, so this criterion cannot prove it renders');

        const r = await call(() => test.GET(`${O}/ROBLedger?$top=2000&$select=ID,entry_type,line_type_v`));
        assert.strictEqual(r.status, 200, r.msg);

        const words = new Map();
        for (const x of r.body.value) {
            if (!words.has(x.entry_type)) words.set(x.entry_type, x.line_type_v);
        }
        for (const [code, text] of words) {
            out(`  ${code} -> ${text === null || text === undefined ? '(blank)' : text}`);
            assert.ok(text, `${code} renders no line type`);
            // The words, not the code read back at the reader.
            assert.notStrictEqual(text, code,
                `${code} renders as its own stored code - the lookup has no entry for it`);
        }
        assert.strictEqual(words.get('APU_BURN'), 'APU burn');
        assert.strictEqual(words.get('BURN'), 'Block burn');
        assert.strictEqual(words.get('UPLIFT'), 'Uplift');
    });
});

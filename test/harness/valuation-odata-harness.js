/**
 * The valuation screens, exercised the way the UI will exercise them.
 *
 * THE FILTER BAR IS SHARED AND THE VIEWS ARE NOT. One List Report over three
 * entity sets sends the same $filter to whichever one is showing, so a field
 * that works on movements and 500s on balances is a defect the reader meets by
 * switching tabs. This asks every selection field of every view.
 *
 * It also sorts by every column the views sort on, because a sortable-looking
 * column that cannot be sorted is how this project learned about virtuals.
 *
 * EXIT-1  all three entity sets answer a plain read
 * EXIT-2  every selection field filters on every view
 * EXIT-3  every sort the views declare is accepted
 * EXIT-4  $count works - the view selector asks for it
 * EXIT-5  the shared filter bar's fields exist on all three entity sets
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');

const { GET } = cds.test(PROJECT);
const out = (s) => process.stdout.write('      ' + s + '\n');
const BASE = '/odata/v4/valuation';

const SETS = ['StockMovements', 'StockBalances', 'BurnValuations'];

// Exactly the six the manifest's one filter bar offers.
const FILTER_FIELDS = [
    ['valuation_method', "valuation_method eq 'FIFO'"],
    // Added to the bar on 7 Oct 2026, so it joins the sweep the same day -
    // an untested filter field is the one that 400s on a view that lacks it.
    ['carrier_code',     "carrier_code eq 'B6'"],
    ['tail_number',      "tail_number eq 'N2151J'"],
    ['line_type',        "line_type eq 'UPLIFT'"],
    ['station',          "station eq 'BOS'"],
    ['flight_number',    "flight_number eq 'B61079'"],
    ['flight_date',      'flight_date ge 2026-09-01']
];

const SORTS = {
    StockMovements: ['tail_number', 'flight_aobt', 'line_order', 'sequence',
                     'qty_kg', 'rate_usd_per_kg', 'value_usd', 'batch_ref', 'map_usd_per_kg'],
    StockBalances:  ['tail_number', 'flight_aobt', 'batch_ref', 'balance_qty_kg',
                     'rate_usd_per_kg', 'value_usd', 'line_type'],
    BurnValuations: ['tail_number', 'flight_aobt', 'line_type', 'burn_qty_kg',
                     'burn_rate_usd_per_kg', 'burn_value_usd', 'layers_consumed']
};

const status = (e) => (e && e.response && e.response.status) || (e && e.message) || 'threw';

describe('valuation OData surface', () => {

    it('EXIT-1  all three entity sets answer a plain read', async () => {
        for (const s of SETS) {
            const r = await GET(`${BASE}/${s}?$top=3`);
            assert.strictEqual(r.status, 200, `${s} returned ${r.status}`);
            assert.ok(r.data.value.length > 0, `${s} is empty - the seed did not land`);
            out(`${s}: ${r.data.value.length} rows, ${Object.keys(r.data.value[0]).length} properties`);
        }
    });

    it('EXIT-2  every selection field filters on every view', async () => {
        const bad = [];
        for (const s of SETS) {
            for (const [name, expr] of FILTER_FIELDS) {
                try {
                    const r = await GET(`${BASE}/${s}?$filter=${encodeURIComponent(expr)}&$top=1`);
                    if (r.status !== 200) bad.push(`${s}.${name} -> ${r.status}`);
                } catch (e) {
                    bad.push(`${s}.${name} -> ${status(e)}`);
                }
            }
        }
        out(`${SETS.length * FILTER_FIELDS.length} filter combinations asked, ${bad.length} failed`);
        assert.deepStrictEqual(bad, [], 'a shared filter field broke on one of the views');
    });

    it('EXIT-3  every sort the views declare is accepted', async () => {
        const bad = [];
        for (const s of SETS) {
            for (const col of SORTS[s]) {
                for (const dir of ['asc', 'desc']) {
                    try {
                        const r = await GET(`${BASE}/${s}?$orderby=${col}%20${dir}&$top=1`);
                        if (r.status !== 200) bad.push(`${s}.${col} ${dir} -> ${r.status}`);
                    } catch (e) {
                        bad.push(`${s}.${col} ${dir} -> ${status(e)}`);
                    }
                }
            }
        }
        const total = SETS.reduce((t, s) => t + SORTS[s].length * 2, 0);
        out(`${total} sorts asked, ${bad.length} failed`);
        assert.deepStrictEqual(bad, [], 'a column the view sorts on cannot be sorted');
    });

    it('EXIT-4  $count works - the view selector asks for it', async () => {
        for (const s of SETS) {
            const r = await GET(`${BASE}/${s}?$count=true&$top=1`);
            assert.strictEqual(r.status, 200);
            const c = r.data['@odata.count'];
            assert.ok(typeof c === 'number' && c > 0, `${s} reported no count`);
            out(`${s}: ${c} rows`);
        }
    });

    it('EXIT-5  the filter bar fields exist on all three entity sets', () => {
        // The manifest's one filter bar is built from StockMovements and
        // applied to whichever view is showing. A field missing from one of
        // them is a 400 the reader meets by clicking a tab.
        const defs = cds.model.definitions;
        const missing = [];
        for (const s of SETS) {
            const el = defs[`ValuationService.${s}`].elements;
            for (const [name] of FILTER_FIELDS) if (!el[name]) missing.push(`${s}.${name}`);
        }
        out(`${FILTER_FIELDS.length} fields checked on ${SETS.length} entity sets`);
        assert.deepStrictEqual(missing, [], 'the shared filter bar names a field one view does not have');
    });
});

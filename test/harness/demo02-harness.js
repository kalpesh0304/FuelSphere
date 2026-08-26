/**
 * WP-DEMO-02 — the four AC contracts resolve in StationLookup.
 *
 * The value help drives four ValueListParameterOut derivations. "The station
 * appears" is not the criterion; "selecting it pushes four usable values" is.
 */
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const P = require('node:path').resolve(__dirname, '..', '..');; const cds=require(`${P}/node_modules/@sap/cds`);
const assert=require('node:assert');
const test=cds.test(P); const out=s=>process.stdout.write('      '+s+'\n');

const AC = { YYZ:'AC-WFS-2025-001', YVR:'AC-MENZ-2025-001',
             LHR:'AC-BPUK-2025-001', CDG:'AC-TOTAL-2025-001' };

const lookup = async (s) =>
    (await test.GET(`/odata/v4/orders/StationLookup?$filter=station_code eq '${s}'`)).data.value;

describe('WP-DEMO-02 — contract locations', function () {

    it('each AC station resolves, with all four derivations populated', async () => {
        for (const [s, contract] of Object.entries(AC)) {
            const rows = await lookup(s);
            assert.strictEqual(rows.length, 1, `${s}: expected exactly one lookup row, got ${rows.length}`);
            const r = rows[0];
            out(`${s} -> ${r.airport_name} | ${r.supplier_name} | ${r.contract_number} | ${r.product_name}`);
            for (const f of ['airport_ID', 'supplier_ID', 'contract_ID', 'product_ID']) {
                assert.ok(r[f], `${s}: ${f} is null — the derivation would push nothing`);
            }
            assert.strictEqual(r.contract_number, contract);
        }
    });

    it('product_ID was the one that was null before this change', async () => {
        // The others already resolved from the location join; only the
        // product came from CONTRACT_PRODUCTS, which the AC contracts had none
        // of. Locations alone surfaced the station and left product null.
        for (const s of Object.keys(AC)) {
            const r = (await lookup(s))[0];
            assert.ok(r.product_ID, `${s}: product_ID still null`);
            assert.strictEqual(r.product_name, 'Jet A-1 Aviation Turbine Fuel');
        }
        out('all four now carry Jet A-1, one row per station');
    });

    it('every fuel order sits at a station the value help can see', async () => {
        const db = await cds.connect.to('db');
        const known = new Set((await db.run(SELECT.from('FuelOrderService.StationLookup')
            .columns('station_code'))).map(r => r.station_code));
        const orders = await db.run(SELECT.from('fuelsphere.FUEL_ORDERS')
            .columns('order_number', 'station_code'));
        const blind = orders.filter(o => !known.has(o.station_code));
        out(`StationLookup knows: ${[...known].sort().join(', ')}`);
        out(`orders at an unknown station: ${blind.length} of ${orders.length}`);
        blind.forEach(o => out(`  ${o.order_number} (${o.station_code})`));
        assert.ok(orders.length > 0, 'instrument check: there must be orders to test');
        assert.deepStrictEqual(blind.map(o => o.order_number), []);
    });

    it('the existing Asia-Pacific lookups are unchanged', async () => {
        // Adding rows to a joined view can multiply existing rows. MNL carried
        // four before; it must still carry four, not eight.
        const mnl = await lookup('MNL');
        out(`MNL -> ${mnl.length} rows (two contracts x their products)`);
        assert.strictEqual(mnl.length, 4, 'MNL row count changed');
        const ceb = await lookup('CEB');
        out(`CEB -> ${ceb.length} row(s)`);
        assert.ok(ceb.length >= 1);
    });

    it('a station with no contract is still correctly absent', async () => {
        // Instrument check. If everything resolved, the checks above would
        // pass whether or not the lookup does anything.
        const yul = await lookup('YUL');
        out(`YUL -> ${yul.length} row(s) — no YUL contract exists, so this must stay 0`);
        assert.strictEqual(yul.length, 0);
    });

    it('the WP-DEMO-01 orders were never affected', async () => {
        // They were seeded with explicit FKs, so the derivation never ran for
        // them. Recorded so the fix is not credited with something it did not
        // change.
        const db = await cds.connect.to('db');
        const demo = await db.run(SELECT.from('fuelsphere.FUEL_ORDERS')
            .columns('order_number','airport_ID','supplier_ID','contract_ID','product_ID')
            .where({ created_by: 'WPDEMO01_SEED' }));
        assert.strictEqual(demo.length, 3);
        demo.forEach(o => {
            ['airport_ID','supplier_ID','contract_ID','product_ID'].forEach(f =>
                assert.ok(o[f], `${o.order_number}: ${f} missing`));
            out(`${o.order_number}: all four FKs populated (seeded, not derived)`);
        });
    });
});

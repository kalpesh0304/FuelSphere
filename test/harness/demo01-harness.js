/**
 * WP-DEMO-01 — the three demonstration scenarios.
 *
 * Every assertion is against the RUNNING SERVICE. The seed values are one
 * input to that, not the answer: if a seeded status disagreed with what the
 * reconciliation computes, this suite must fail rather than confirm the CSV.
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');

const test = cds.test(PROJECT);
const out = (s) => process.stdout.write('      ' + s + '\n');
const O = '/odata/v4/orders';

const S = {
    S1: { delivery: 'EPD-YYZ-20260410-0001', reg: 'C-FDMO', flight: 'AC410',
          // S1 corrected 25 Aug: the stack is a plan rather than a percentage
          // split, so the uplift halves. The floor still governs.
          metered: 2305.76, delta: 2305.00, variance: 0.76, tolerance: 50.00,
          status: 'RECONCILED', tickets: 1 },
    S2: { delivery: 'EPD-YYZ-20260410-0002', reg: 'C-GDMS', flight: 'AC856',
          // S2 corrected: rebuilt from the sector. 61,980 kg was a twelve-hour
          // uplift on a seven-hour A350 sector. 0.5% still governs over the
          // 50 kg floor, which is the property this scenario carries.
          metered: 42025.23, delta: 41950.00, variance: 75.23, tolerance: 210.13,
          status: 'RECONCILED', tickets: 2 },
    S3: { delivery: 'EPD-YYZ-20260410-0003', reg: 'C-FDMP', flight: 'AC412',
          // S3 corrected: the METER is now identical to S1's and only the
          // gauge differs, which is what "identical to S1 through the meter"
          // has always claimed. 120.76 fails here and would pass on S2.
          metered: 2305.76, delta: 2185.00, variance: 120.76, tolerance: 50.00,
          status: 'VARIANCE', tickets: 1 }
};

const db = () => cds.connect.to('db');
const byNum = async (n) => (await db()).run(
    SELECT.one.from('fuelsphere.FUEL_DELIVERIES').where({ delivery_number: n }));

async function runReconcile(deliveryNumber) {
    const d = await byNum(deliveryNumber);
    assert.ok(d, `delivery ${deliveryNumber} not seeded`);
    const r = await test.POST(
        `${O}/FuelDeliveries(ID=${d.ID},IsActiveEntity=true)/FuelOrderService.reconcile`, {});
    assert.strictEqual(r.status, 200);
    return r.data;
}

describe('WP-DEMO-01 — three scenarios', function () {

    for (const [name, e] of Object.entries(S)) {
        it(`${name} — ${e.status} (${e.tickets} ticket${e.tickets > 1 ? 's' : ''})`, async () => {
            const r = await runReconcile(e.delivery);
            out(`${e.delivery}  ${e.reg}  ${e.flight}`);
            out(`  metered=${r.meteredMassKg}  FQIS=${r.fqisMassKg}  variance=${r.reconVarianceKg}`);
            out(`  tolerance=${r.toleranceKg} (${r.fobSource})  suppliers=${r.supplierCount}  -> ${r.reconStatus}`);
            assert.strictEqual(Number(r.meteredMassKg), e.metered, 'metered mass');
            assert.strictEqual(Number(r.fqisMassKg), e.delta, 'gauge delta');
            assert.strictEqual(Number(r.reconVarianceKg), e.variance, 'variance');
            assert.strictEqual(Number(r.toleranceKg), e.tolerance, 'tolerance');
            assert.strictEqual(r.reconStatus, e.status, 'status');
            assert.strictEqual(Number(r.supplierCount), 1, 'one supplier');

            // The computed status must also be what the seed stored: a CSV
            // that disagrees with the code is the defect this checks for.
            const stored = await byNum(e.delivery);
            assert.strictEqual(stored.recon_status, e.status, 'seeded status disagrees with computed');
            assert.strictEqual(Number(stored.recon_variance_kg), e.variance, 'seeded variance disagrees');
        });
    }

    it('the tolerance resolves from the metered mass, not from a constant', async () => {
        // The check the package singles out. If S2 came back at 50.00 the
        // percentage is not being applied and the demonstration collapses.
        const [s1, s2] = [await runReconcile(S.S1.delivery), await runReconcile(S.S2.delivery)];
        out(`S1 metered ${s1.meteredMassKg} -> tolerance ${s1.toleranceKg}  (floor governs)`);
        out(`S2 metered ${s2.meteredMassKg} -> tolerance ${s2.toleranceKg}  (0.5% governs)`);
        assert.notStrictEqual(Number(s2.toleranceKg), 50.00,
            'S2 tolerance is the floor — the percentage is not resolving');
        // NOT a literal. 309.90 was pinned here and moved the moment S2's
        // quantity was corrected — the same failure as the fixture pins.
        // The criterion is that the tolerance IS 0.5% of the metered mass,
        // so assert that relationship rather than today's answer.
        assert.strictEqual(Number(s2.toleranceKg),
            Number((Number(s2.meteredMassKg) * 0.005).toFixed(2)),
            'S2 tolerance must be 0.5% of its own metered mass');
        // S1 is the other side of the same rule: 0.5% of its mass is below
        // the floor, so the floor governs. Both derived, neither pinned.
        assert.ok(Number(s1.meteredMassKg) * 0.005 < 50.00,
            'S1 is only a floor case while 0.5% of its mass is under 50');
        assert.strictEqual(Number(s1.toleranceKg), 50.00);
    });

    it('S2 passes on a variance larger than S3 fails on — the demonstration', async () => {
        const s2 = await runReconcile(S.S2.delivery);
        const s3 = await runReconcile(S.S3.delivery);
        out(`S2  variance ${s2.reconVarianceKg} kg on ${s2.meteredMassKg} kg -> ${s2.reconStatus}`);
        out(`S3  variance ${s3.reconVarianceKg} kg on ${s3.meteredMassKg} kg -> ${s3.reconStatus}`);
        assert.ok(Math.abs(Number(s2.reconVarianceKg)) > Number(S.S3.tolerance),
            "S2's variance must exceed S3's entire tolerance, or the point is lost");
        assert.strictEqual(s2.reconStatus, 'RECONCILED');
        assert.strictEqual(s3.reconStatus, 'VARIANCE');
        out(`  ${s2.reconVarianceKg} kg > S3's whole tolerance of ${S.S3.tolerance} kg, and S2 still passes`);
    });

    it('EXIT-4 — the chain resolves in both directions', async () => {
        const d = await db();
        for (const [name, e] of Object.entries(S)) {
            const del = await byNum(e.delivery);
            const ord = await d.run(SELECT.one.from('fuelsphere.FUEL_ORDERS').where({ ID: del.order_ID }));
            assert.ok(ord, `${name}: delivery -> order`);
            const sch = await d.run(SELECT.one.from('fuelsphere.FLIGHT_SCHEDULE').where({ ID: ord.flight_ID }));
            assert.ok(sch, `${name}: order -> flight schedule`);
            const dis = await d.run(SELECT.one.from('fuelsphere.FLIGHT_DISPATCH')
                .where({ flight_schedule_ID: sch.ID }));
            assert.ok(dis, `${name}: schedule -> dispatch`);
            assert.strictEqual(dis.fuel_order_ID, ord.ID, `${name}: dispatch -> order (back)`);
            const tks = await d.run(SELECT.from('fuelsphere.FUEL_TICKETS').where({ delivery_ID: del.ID }));
            assert.strictEqual(tks.length, e.tickets, `${name}: delivery -> tickets`);
            tks.forEach(t => assert.strictEqual(t.order_ID, ord.ID, `${name}: ticket -> order (back)`));
            const reg = await d.run(SELECT.one.from('fuelsphere.AIRCRAFT_REGISTRATIONS')
                .where({ registration: del.aircraft_reg }));
            assert.ok(reg, `${name}: delivery -> aircraft register`);
            assert.strictEqual(reg.record_status, 'CONFIRMED', `${name}: registration must be CONFIRMED`);
            const ap = await d.run(SELECT.one.from('fuelsphere.MASTER_AIRPORTS').where({ ID: ord.airport_ID }));
            const sup = await d.run(SELECT.one.from('fuelsphere.MASTER_SUPPLIERS').where({ ID: ord.supplier_ID }));
            assert.ok(ap && sup, `${name}: order -> airport and supplier`);
            out(`${name}: ${sch.flight_number} ${sch.origin_airport}-${sch.destination_airport} `
              + `${sch.status} | dispatch ${dis.dispatch_qty_kg} kg | order ${ord.ordered_quantity} ${ord.uom_code} `
              + `| ${tks.length} ticket(s) | ${reg.registration} ${reg.aircraft_type_code} ${reg.record_status} `
              + `| ${ap.iata_code} ${sup.supplier_code}`);
        }
    });

    it('EXIT-4b — the order conversion reproduces from its own evidence', async () => {
        const d = await db();
        for (const [name, e] of Object.entries(S)) {
            const del = await byNum(e.delivery);
            const o = await d.run(SELECT.one.from('fuelsphere.FUEL_ORDERS').where({ ID: del.order_ID }));
            const recomputed = Number((Number(o.ordered_quantity_kg) / Number(o.conversion_density)).toFixed(2));
            out(`${name}: ${o.ordered_quantity_kg} kg / ${o.conversion_density} = ${recomputed} `
              + `= ${o.ordered_quantity} ${o.uom_code} (${o.conversion_source})`);
            assert.strictEqual(recomputed, Number(o.ordered_quantity), `${name}: conversion not reproducible`);
            assert.strictEqual(o.uom_code, 'LTR');
        }
    });

    it('nothing in these three is PROVISIONAL, UNMATCHED or unreconciled', async () => {
        const d = await db();
        for (const [name, e] of Object.entries(S)) {
            const del = await byNum(e.delivery);
            const tks = await d.run(SELECT.from('fuelsphere.FUEL_TICKETS').where({ delivery_ID: del.ID }));
            const reg = await d.run(SELECT.one.from('fuelsphere.AIRCRAFT_REGISTRATIONS')
                .where({ registration: del.aircraft_reg }));
            tks.forEach(t => assert.strictEqual(t.match_status, 'MATCHED', `${name}: ticket UNMATCHED`));
            assert.strictEqual(reg.record_status, 'CONFIRMED');
            assert.ok(!['NOT_RECONCILED', 'NOT_ATTRIBUTABLE'].includes(del.recon_status), name);
            out(`${name}: registration CONFIRMED, ${tks.length} ticket(s) MATCHED, recon ${del.recon_status}`);
        }
    });

    it('EXIT-6 — the three deliveries come back over OData with recon_status', async () => {
        // Fetched, not assumed. An annotation that renders nothing and a field
        // that is not served look identical from the annotation file.
        const nums = Object.values(S).map(x => `'${x.delivery}'`).join(',');
        const r = await test.GET(`${O}/FuelDeliveries?$filter=delivery_number in (${nums})`
            + `&$select=delivery_number,recon_status,recon_variance_kg,fob_source,supplier_count,aircraft_reg`
            + `&$orderby=delivery_number`);
        assert.strictEqual(r.status, 200);
        const rows = r.data.value;
        rows.forEach(x => out(`${x.delivery_number}  ${x.aircraft_reg}  ${x.recon_status}  `
            + `variance=${x.recon_variance_kg}  source=${x.fob_source}  suppliers=${x.supplier_count}`));
        assert.strictEqual(rows.length, 3, 'all three must be served');
        rows.forEach(x => {
            assert.ok(x.recon_status, `${x.delivery_number}: recon_status not served`);
            assert.notStrictEqual(x.recon_variance_kg, null, `${x.delivery_number}: variance not served`);
        });
        assert.deepStrictEqual(rows.map(x => x.recon_status), ['RECONCILED', 'RECONCILED', 'VARIANCE']);

        // And the criticality that colours them is really in the metadata.
        const meta = await test.GET(`${O}/$metadata`);
        assert.match(meta.data, /<Path>recon_status<\/Path>/, 'no dynamic criticality on recon_status');
        out('recon_status criticality present in $metadata');
    });
});

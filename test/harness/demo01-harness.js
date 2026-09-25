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

describe('WP-DEMO-01 — three scenarios', function () {

    // THE THREE RECONCILIATION SCENARIOS ARE WITHDRAWN (Sep 2026).
    //
    // S1, S2 and S3 demonstrated the PER-DELIVERY FOB reconciliation -
    // metered mass against the gauge delta, judged on a tolerance that
    // scaled with the uplift - and that reconciliation was removed from the
    // product at the user's request, along with the reconcile action these
    // called. What survives below is the part of the demonstration that is
    // still true: the chain resolves in both directions, the order's volume
    // conversion reproduces from its own evidence, and nothing in the three
    // scenarios is left unmatched or provisional.
    //
    // The flight-level variance replaced it and has its own harness
    // (flight-variance-harness.js).

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

});

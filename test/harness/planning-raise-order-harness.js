/**
 * RAISING AN ORDER FROM THE FLIGHT PAGE A PLANNER ACTUALLY OPENS.
 *
 * PlanningService OFFERS the action; FuelOrderService PERFORMS it. There is
 * still exactly ONE INSERT, in `createOrderFromFlight` - D44 is two
 * independent implementations of one rule disagreeing one day with nothing to
 * notice, and a second INSERT here would be that shape.
 *
 * `@readonly` ON PlanningService.FuelOrders IS NOT THE BOUNDARY IT LOOKS LIKE,
 * and that is why this action is allowed to exist. It says "do not write
 * ORDERS through this projection", which stays true: the handler writes
 * nothing through it, it calls the service that owns the write. The READ
 * surface and the ACTION surface are different questions.
 *
 * WHAT NEEDED MEASURING WAS NOT THE CALL BUT THE ERROR. A cross-service
 * `send` is a different call from an in-service one, and transaction scope and
 * error propagation are where it bites. **A refusal raised inside
 * FuelOrderService has to reach the caller AS A REFUSAL.** If MDM402 arrives
 * as a 500, the gate is intact and the screen lies about why - which is worse
 * than no gate, because a 500 reads as "the system is broken" and somebody
 * retries.
 *
 *   EXIT-1  THE CONTROL SUCCEEDS on both services, or nothing below compares
 *   EXIT-2  the delegation writes ONE order, not two
 *   EXIT-3  MDM402 arrives as a REFUSAL, identically on both services
 *   EXIT-4  the variance rule fires through the Planning form too
 *   EXIT-5  D46: S6's tail cannot be reached through this path at all, and
 *           the criterion says so rather than appearing to have tested it
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const test = cds.test(PROJECT);
const out = s => process.stdout.write('      ' + s + '\n');
const { SELECT } = cds.ql;

const P = '/odata/v4/planning', O = '/odata/v4/orders';
const call = async f => {
    try { const r = await f(); return { status: r.status, data: r.data }; }
    catch (e) {
        return {
            status: e.response?.status || e.status || 0,
            msg: e.response?.data?.error?.message || e.message,
            code: e.response?.data?.error?.code
        };
    }
};
const raise = (svc, flightId, body) => call(() => test.POST(
    svc === 'Planning'
        ? `${P}/FlightSchedule(${flightId})/PlanningService.createFuelOrder`
        : `${O}/FlightSchedule(${flightId})/FuelOrderService.createFuelOrder`, body));

const QTY = { orderedQuantity: 1000, uomCode: 'KG', orderType: 'ORIGINAL' };

describe('Raise a fuel order from the planning flight page', function () {
    this.timeout(120000);

    let provisionalTails, flightOnProvisional, flightOnConfirmed;

    before(async () => {
        const regs = await cds.db.run(SELECT.from('fuelsphere.AIRCRAFT_REGISTRATIONS')
            .columns('registration', 'record_status'));
        provisionalTails = regs.filter(r => r.record_status === 'PROVISIONAL').map(r => r.registration);
        const flights = await cds.db.run(SELECT.from('fuelsphere.FLIGHT_SCHEDULE')
            .columns('ID', 'flight_number', 'aircraft_reg'));
        flightOnProvisional = flights.find(f => provisionalTails.includes(f.aircraft_reg));
        flightOnConfirmed = flights.find(f => f.aircraft_reg && !provisionalTails.includes(f.aircraft_reg));
        assert.ok(flightOnProvisional, 'no flight sits on a PROVISIONAL tail - EXIT-3 would test nothing');
        assert.ok(flightOnConfirmed, 'no flight sits on a CONFIRMED tail - the control cannot succeed');
    });

    // -------------------------------------------------------------- EXIT-1 --
    // A COMPARISON IS MEANINGLESS UNTIL ITS CONTROL SUCCEEDS, because a shared
    // failure is indistinguishable from a match. This exact comparison has
    // already produced a false agreement once: both arms refused on missing
    // mandatory fields and neither ever reached the gate.
    it('EXIT-1  the control SUCCEEDS on both services', async () => {
        const f = flightOnConfirmed;
        const results = {};
        for (const svc of ['Planning', 'FuelOrder']) {
            const r = await raise(svc, f.ID, QTY);
            results[svc] = r;
            out(`  ${svc.padEnd(9)} ${f.flight_number} (${f.aircraft_reg}) -> ${r.status} ${r.msg || 'order ' + (r.data && r.data.order_number)}`);
        }
        for (const svc of ['Planning', 'FuelOrder'])
            assert.strictEqual(results[svc].status, 200,
                `${svc} refused a CONFIRMED tail: ${results[svc].msg}. Every comparison below would be `
              + 'a shared failure reported as agreement.');
        assert.ok(results.Planning.data.order_number, 'the Planning form returned no order number');
    });

    // -------------------------------------------------------------- EXIT-2 --
    // ONE INSERT. The whole reason Planning delegates rather than writing is
    // D44: the cost of a second implementation is not that it is wrong today.
    it('EXIT-2  the delegation writes ONE order, not two', async () => {
        const before = (await cds.db.run(SELECT.from('fuelsphere.FUEL_ORDERS').columns('ID'))).length;
        const r = await raise('Planning', flightOnConfirmed.ID, QTY);
        const after = (await cds.db.run(SELECT.from('fuelsphere.FUEL_ORDERS').columns('ID'))).length;
        out(`  orders before ${before}, after ${after}, delta ${after - before}  (${r.status} ${r.data && r.data.order_number || r.msg})`);
        assert.strictEqual(r.status, 200, `the call failed: ${r.msg}`);
        assert.strictEqual(after - before, 1,
            'the Planning form did not write exactly one order - a second INSERT is D44 reintroduced');
    });

    // -------------------------------------------------------------- EXIT-3 --
    // THE ONE THAT NEEDED MEASURING. A refusal raised inside FuelOrderService
    // must cross the service boundary as a refusal. Both halves asserted: the
    // STATUS must be a client refusal rather than 500, and the two services
    // must agree - a Planning 500 beside a FuelOrder 409 is the gate intact
    // and the screen lying about why.
    it('EXIT-3  MDM402 arrives as a REFUSAL, identically on both services', async () => {
        const f = flightOnProvisional;
        out(`  PROVISIONAL tails: ${provisionalTails.join(', ')}`);
        out(`  flight on one: ${f.flight_number} (${f.aircraft_reg})`);
        const got = {};
        for (const svc of ['Planning', 'FuelOrder']) {
            const r = await raise(svc, f.ID, QTY);
            got[svc] = r;
            out(`  ${svc.padEnd(9)} -> ${r.status} code=${r.code || '-'} | ${String(r.msg || '').slice(0, 95)}`);
        }
        for (const svc of ['Planning', 'FuelOrder']) {
            assert.ok(got[svc].status >= 400 && got[svc].status < 500,
                `${svc} returned ${got[svc].status}. A refusal that arrives as a server error leaves the `
              + 'gate intact and the screen lying about why - and a 500 is retried.');
            assert.ok(/MDM402/.test(String(got[svc].msg)),
                `${svc} refused without naming MDM402: ${got[svc].msg}`);
        }
        assert.strictEqual(got.Planning.status, got.FuelOrder.status,
            'the two services disagree about the status of the same refusal - the cross-service send is '
          + 'not propagating it faithfully');
    });

    // -------------------------------------------------------------- EXIT-4 --
    // The variance rule was inert on the only path a screen takes until the
    // bound form was called once. The Planning form is a NEW path, so it gets
    // the same treatment rather than the assumption that it inherits.
    it('EXIT-4  the variance rule fires through the Planning form', async () => {
        const plans = await cds.db.run(SELECT.from('fuelsphere.FLIGHT_DISPATCH')
            .columns('flight_schedule_ID', 'required_uplift_kg', 'flight_number'));
        const withPlan = plans.find(p => p.required_uplift_kg != null && p.flight_schedule_ID);
        assert.ok(withPlan, 'no dispatch plan carries a required uplift - the rule cannot be exercised');
        const off = Number(withPlan.required_uplift_kg) + 500;

        const refused = await raise('Planning', withPlan.flight_schedule_ID,
            { orderedQuantity: off, uomCode: 'KG', orderType: 'ORIGINAL' });
        out(`  plan ${withPlan.required_uplift_kg} kg, ordered ${off} kg, no reason -> ${refused.status} | ${String(refused.msg || '').slice(0, 95)}`);
        assert.ok(refused.status >= 400 && refused.status < 500,
            'a quantity differing from the plan with no reason was accepted through the Planning form');

        const accepted = await raise('Planning', withPlan.flight_schedule_ID,
            { orderedQuantity: off, uomCode: 'KG', orderType: 'ORIGINAL',
              quantityVarianceReason: 'Tankering uplift for the return sector.' });
        out(`  same quantity WITH a reason -> ${accepted.status} ${accepted.data && accepted.data.order_number || accepted.msg}`);
        assert.strictEqual(accepted.status, 200,
            'the reason was supplied and the order was still refused - the control for this rule fails');
    });

    // -------------------------------------------------------------- EXIT-5 --
    // D46, ASSERTED RATHER THAN QUIETLY NOT TESTED.
    //
    // S6's tail is RP-C8803, PROVISIONAL, carrying a Delivered order with four
    // tickets. It CANNOT be reached through this action at all: the bound form
    // takes its flight from the binding context, and RP-C8803 has no flight.
    // That is D46 exactly - `assertOrderable` reads the flight's registration,
    // so an order with no flight is never gated - and the bound action cannot
    // reproduce it, because it can only ever address a flight.
    //
    // Stated as a criterion so nobody reads EXIT-3 as having covered D46. It
    // SELF-INVALIDATES the day RP-C8803 gains a flight: then the gate becomes
    // reachable for that tail and this must be replaced by a test of it.
    it('EXIT-5  S6 tail is unreachable through this path, which is D46 and not a gap here', async () => {
        const S6 = 'RP-C8803';
        assert.ok(provisionalTails.includes(S6), `${S6} is no longer PROVISIONAL - D46's premise has moved`);
        const flights = await cds.db.run(SELECT.from('fuelsphere.FLIGHT_SCHEDULE')
            .columns('ID', 'flight_number', 'aircraft_reg').where({ aircraft_reg: S6 }));
        // THE TAIL REACHES AN ORDER ONLY THROUGH ITS DELIVERIES. FUEL_ORDERS
        // carries `flight` and NOTHING ELSE naming a registration - no
        // aircraft_reg, no tail - which is the same absence D46 describes from
        // the other side: the gate reads the FLIGHT's registration because the
        // order has none of its own.
        const orders = await cds.db.run(SELECT.from('fuelsphere.FUEL_ORDERS')
            .columns('ID', 'order_number', 'status', 'flight_ID'));
        const dels = await cds.db.run(SELECT.from('fuelsphere.FUEL_DELIVERIES')
            .columns('order_ID', 'aircraft_reg'));
        const s6orderIds = new Set(dels.filter(d => d.aircraft_reg === S6).map(d => d.order_ID));
        const s6orders = orders.filter(o => s6orderIds.has(o.ID));
        out(`  ${S6}: PROVISIONAL, flights=${flights.length}, orders reached via deliveries=${s6orders.length}`);
        for (const o of s6orders) out(`     ${o.order_number} ${o.status} flight=${o.flight_ID || 'NONE'}`);
        out(`  orders with NO flight at all: ${orders.filter(o => !o.flight_ID).length} of ${orders.length}`);
        assert.strictEqual(flights.length, 0,
            `${S6} now has a flight, so the MDM402 gate IS reachable for it through this action - `
          + 'replace this criterion with one that exercises it');
    });
});

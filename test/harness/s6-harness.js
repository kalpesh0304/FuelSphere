/**
 * S6 — the provisional-register refusal scenario.
 *
 * AC418, 10 April, YYZ->YVR, on C-GLTA — an A321 the register holds as
 * PROVISIONAL, seeded beside S1, S2 and S3 rather than in Manila.
 *
 * The scenario is PLAN ALLOWED, ORDER REFUSED. It is not a fuel-flow
 * scenario: if the order is refused there is no ticket, no delivery and no
 * burn, and seeding any of them would seed a state the code refuses to
 * create. EXIT-3 and EXIT-6 together are the claim - the refusal happens,
 * and it happens BECAUSE of record_status rather than anything else about
 * this flight.
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');

const test = cds.test(PROJECT);
const out = (s) => process.stdout.write('      ' + s + '\n');
const db = () => cds.connect.to('db');

const FLIGHTS  = 'fuelsphere.FLIGHT_SCHEDULE';
const DISPATCH = 'fuelsphere.FLIGHT_DISPATCH';
const ORDERS   = 'fuelsphere.FUEL_ORDERS';
const REGISTER = 'fuelsphere.AIRCRAFT_REGISTRATIONS';

async function call(fn) {
    try { const r = await fn(); return { status: r.status, body: r.data }; }
    catch (e) {
        return { status: e.response?.status ?? 'ERR', body: e.response?.data,
                 msg: e.response?.data?.error?.message ?? e.message };
    }
}
const MANDATORY = { ordered_quantity: 2121, requested_date: '2026-04-07',
                    unit_price: 0.85, station_code: 'YYZ' };
/**
 * FuelOrders is DRAFT-ENABLED, so a POST to the collection creates a draft and
 * returns 201 without firing `before CREATE`. The A4 gate sits on that event,
 * which means it fires on draftActivate - at the point the order becomes a
 * commitment rather than at the point someone starts typing one.
 *
 * Asserting on the POST alone reports 201 and looks like the gate is missing.
 * It is the same draft-path rule WP-12 records, arriving as a false negative
 * in a test rather than as a missing handler.
 */
async function createOrder(flightId) {
    const d = await call(() =>
        test.POST('/odata/v4/orders/FuelOrders', { ...MANDATORY, flight_ID: flightId }));
    if (!d.body || !d.body.ID) return d;
    return call(() => test.POST(
        `/odata/v4/orders/FuelOrders(ID=${d.body.ID},IsActiveEntity=false)/draftActivate`, {}));
}

const s6 = () => (await0 => 0, db().then(d => d.run(
    SELECT.one.from(FLIGHTS).where({ flight_number: 'AC418' }))));

describe('S6 — plan allowed, order refused', () => {

  it('EXIT-1  the FLIGHT lands on a PROVISIONAL tail — the first in the seed', async () => {
    const f = await s6();
    assert.ok(f, 'AC418 not seeded');
    const reg = await (await db()).run(
      SELECT.one.from(REGISTER).where({ registration: f.tail_registration }));
    assert.ok(reg, 'the tail must be IN the register - that is what makes it provisional');
    assert.strictEqual(reg.record_status, 'PROVISIONAL');
    assert.strictEqual(f.tail_registration, f.aircraft_reg,
      'a provisional tail RESOLVES - applyPolicy never reads record_status');
    out(`AC418 ${f.flight_date} ${f.origin_airport}->${f.destination_airport} `
      + `tail=${f.tail_registration} record_status=${reg.record_status}`);
  });

  it('EXIT-2  the PLAN is allowed, and its stack DERIVES', async () => {
    const { deriveStack } = require(`${PROJECT}/srv/lib/dispatch-plan`);
    const d = await (await db()).run(
      SELECT.one.from(DISPATCH).where({ flight_number: 'AC418' }));
    assert.ok(d, 'no dispatch plan - "plan allowed" is half the scenario');
    const ROB_AT_GATE = 1800;   // a fresh registration has no ROB history
    const derived = deriveStack(d, ROB_AT_GATE);
    assert.strictEqual(Number(d.block_fuel_kg), derived.block_fuel_kg,
      'block must be the sum of the seven components (DSP450), never keyed');
    assert.strictEqual(Number(d.required_uplift_kg), derived.required_uplift_kg,
      'required uplift must be block less fuel on board (DSP451)');
    out(`block=${derived.block_fuel_kg} = sum(7)  |  uplift=${derived.required_uplift_kg} `
      + `= block - ${ROB_AT_GATE} (a fresh tail, so the uplift is unavoidable)`);
  });

  it('EXIT-3  the ORDER is refused — MDM402', async () => {
    const f = await s6();
    const r = await createOrder(f.ID);
    assert.strictEqual(r.status, 409, `expected 409, got ${r.status}`);
    assert.match(r.msg, /MDM402/, 'the refusal must carry its code');
    assert.match(r.msg, /C-GLTA/, 'and must name the tail');
    out(`POST FuelOrders -> ${r.status} :: ${r.msg.slice(0, 96)}`);
  });

  it('EXIT-4  no commercial commitment exists — and that is a MEANING, not a gap', async () => {
    const f = await s6();
    const orders = await (await db()).run(SELECT.from(ORDERS).where({ flight_ID: f.ID }));
    assert.strictEqual(orders.length, 0, 'S6 must carry no order - the code refuses to create one');
    const d = await (await db()).run(
      SELECT.one.from(DISPATCH).where({ flight_number: 'AC418' }));
    // dispatch_order_id is "the commercial commitment, set on confirmation"
    // (dispatch-plan.js). Empty because MDM402 refused it. Every other
    // dispatch row carries one because every other flight has an order.
    assert.ok(!d.dispatch_order_id, 'dispatch_order_id must be empty - no commitment was made');
    assert.ok(!d.fuel_order_ID,     'fuel_order_ID must be empty');
    const others = await (await db()).run(SELECT.from(DISPATCH));
    const withCommitment = others.filter(r => r.dispatch_order_id).length;
    assert.strictEqual(withCommitment, others.length - 1,
      'every OTHER dispatch row must carry a commitment - S6 is the only exception');
    out(`dispatch rows: ${others.length}, with a commercial commitment: ${withCommitment}, S6: none`);
  });

  it('EXIT-5  contingency is 5% of TRIP, not of block', async () => {
    const d = await (await db()).run(
      SELECT.one.from(DISPATCH).where({ flight_number: 'AC418' }));
    const trip = Number(d.trip_fuel_kg), cont = Number(d.contingency_fuel_kg);
    const blk  = Number(d.block_fuel_kg);
    assert.ok(Math.abs(cont / trip - 0.05) < 1e-4,
      `contingency is ${(cont/trip*100).toFixed(2)}% of trip, must be 5%`);
    assert.ok(Math.abs(cont / blk - 0.05) > 1e-3,
      'instrument check: 5% of trip must NOT coincide with 5% of block here');
    assert.strictEqual(Number(d.additional_fuel_kg), 0);
    assert.strictEqual(Number(d.extra_fuel_kg), 0);
    out(`contingency ${cont} = ${(cont/trip*100).toFixed(2)}% of trip `
      + `(${(cont/blk*100).toFixed(2)}% of block — the defect the family had)`);
  });

  it('EXIT-6  the refusal is caused by record_status, not by this flight', async () => {
    // The same call, same shape, on a CONFIRMED tail. If this also failed,
    // EXIT-3 would prove nothing about PROVISIONAL.
    const confirmed = await (await db()).run(SELECT.one.from(REGISTER)
      .where({ record_status: 'CONFIRMED' }));
    const id = cds.utils.uuid();
    await (await db()).run(INSERT.into(FLIGHTS).entries({
      ID: id, flight_number: 'PR599', flight_date: '2026-04-07',
      aircraft_reg: confirmed.registration, tail_registration: confirmed.registration,
      origin_airport: 'MNL', destination_airport: 'SIN', status: 'SCHEDULED'
    }));
    const ok = await createOrder(id);
    assert.strictEqual(ok.status, 201,
      `a CONFIRMED tail must permit the same call - got ${ok.status} :: ${ok.msg}`);
    out(`control: same POST on ${confirmed.registration} (CONFIRMED) -> ${ok.status}`);
  });
});

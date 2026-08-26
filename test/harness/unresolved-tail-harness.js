/**
 * The unresolved-tail display case.
 *
 * A registration the register has NEVER SEEN. The whole claim is that this is
 * a DIFFERENT STATE from a provisional tail, on both axes at once:
 *
 *     UNKNOWN_TAIL_POLICY   resolution     found / not found
 *     record_status         orderability   confirmed / provisional
 *
 * A provisional tail RESOLVES and BLOCKS the order. An unknown tail FAILS TO
 * RESOLVE and PERMITS it. EXIT-4 is that pair run against each other, and it
 * is the criterion that says one scenario cannot carry both.
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
const REGISTER = 'fuelsphere.AIRCRAFT_REGISTRATIONS';
const FEEDS = ['FLIGHT_SCHEDULE','FLIGHT_DISPATCH','FUEL_DELIVERIES',
               'FUEL_TICKETS','FUEL_BURNS','ROB_LEDGER','APU_USAGE'];

describe('Unresolved tail — the display case', () => {

  it('EXIT-1  a flight carries a registration the register has never seen', async () => {
    const f = await (await db()).run(
      SELECT.one.from(FLIGHTS).where({ flight_number: 'AC414' }));
    assert.ok(f, 'AC414 not seeded');
    assert.ok(f.aircraft_reg, 'aircraft_reg must carry the value AS RECEIVED');
    assert.strictEqual(f.tail_registration, null,
      'tail_registration must be null - the register has not seen this tail');
    const reg = await (await db()).run(
      SELECT.one.from(REGISTER).where({ registration: f.aircraft_reg }));
    assert.strictEqual(reg, undefined, `${f.aircraft_reg} must NOT be in the register`);
    out(`AC414  aircraft_reg=${f.aircraft_reg}  tail_registration=${f.tail_registration}  register=absent`);
  });

  it('EXIT-2  it is a DIFFERENT state from "no aircraft assigned"', async () => {
    const rows = await (await db()).run(SELECT.from(FLIGHTS)
      .columns('flight_number','aircraft_reg','tail_registration'));
    const unresolved = rows.filter(r =>  r.aircraft_reg && !r.tail_registration);
    const unassigned = rows.filter(r => !r.aircraft_reg && !r.tail_registration);
    assert.ok(unresolved.length >= 1, 'no unresolved-tail flight exists');
    assert.ok(unassigned.length >= 1, 'the unassigned case must remain, for contrast');
    assert.ok(!unresolved.some(r => unassigned.includes(r)), 'the two sets must not overlap');
    out(`unresolved (reg, no tail): ${unresolved.map(r=>r.flight_number).join(', ')}`);
    out(`unassigned (neither)     : ${unassigned.map(r=>r.flight_number).join(', ')}`);
  });

  it('EXIT-3  the seed writes what the RESOLVER writes - never a dangling FK', async () => {
    // No FK constraint exists on tail_registration, so a CSV *could* seed a
    // registration the register has never seen. It must not: applyPolicy
    // writes null on that branch and never a dangling value. A seeded
    // dangling FK would be a state the code cannot produce.
    const known = (await (await db()).run(
      SELECT.from(REGISTER).columns('registration'))).map(r => r.registration);
    for (const feed of FEEDS) {
      const rows = await (await db()).run(SELECT.from(`fuelsphere.${feed}`)
        .columns('tail_registration'));
      const dangling = rows.filter(r => r.tail_registration && !known.includes(r.tail_registration));
      assert.strictEqual(dangling.length, 0,
        `${feed} carries ${dangling.length} tail_registration value(s) absent from the register`);
    }
    out(`${FEEDS.length} feeds checked against ${known.length} registrations - 0 dangling`);
  });

  it('EXIT-4  unknown PERMITS the order; provisional BLOCKS it - opposite on both axes', async () => {
    const { assertOrderable } = require(`${PROJECT}/srv/lib/aircraft-register`);
    const { resolveTail, applyPolicy } = require(`${PROJECT}/srv/lib/tail-resolver`);

    const f = await (await db()).run(
      SELECT.one.from(FLIGHTS).where({ flight_number: 'AC414' }));
    const unknown = f.aircraft_reg;

    const prov = await (await db()).run(SELECT.one.from(REGISTER)
      .columns('registration').where({ record_status: 'PROVISIONAL' }));
    assert.ok(prov, 'no PROVISIONAL registration to contrast against');

    // Axis 1 - resolution.
    const rUnknown = await resolveTail(unknown);
    const rProv    = await resolveTail(prov.registration);
    assert.strictEqual(rUnknown, null, 'the unknown tail must NOT resolve');
    assert.ok(rProv, 'the provisional tail MUST resolve - record_status is not read here');
    assert.strictEqual(applyPolicy(unknown, rUnknown, 'FLIGHT_SCHEDULE').tail_registration, null);
    assert.strictEqual(applyPolicy(prov.registration, rProv, 'FLIGHT_SCHEDULE').tail_registration,
      prov.registration);

    // Axis 2 - orderability.
    await assertOrderable(unknown);            // must NOT throw
    await assertOrderable(null);               // no tail at all - must NOT throw
    await assert.rejects(() => assertOrderable(prov.registration),
      // MDM402 by CODE. A regex on the message passes for the wrong reason -
      // any error mentioning PROVISIONAL would satisfy it, including one
      // raised by something else entirely.
      e => e.code === 'MDM402',
      'a provisional tail must block order creation');

    out(`resolution : ${unknown} -> null      | ${prov.registration} -> ${rProv.registration}`);
    out(`orderable  : ${unknown} -> PERMITTED | ${prov.registration} -> BLOCKED`);
  });

  it('EXIT-5  the state is visible over OData - both fields, one populated', async () => {
    const r = await test.GET('/odata/v4/planning/FlightSchedule'
      + "?$filter=" + encodeURIComponent("flight_number eq 'AC414'")
      + '&$select=flight_number,aircraft_reg,tail_registration&$expand=tail');
    assert.strictEqual(r.status, 200);
    const row = r.data.value[0];
    assert.ok(row, 'AC414 not exposed on PlanningService');
    assert.ok(row.aircraft_reg, 'Registration must render');
    assert.strictEqual(row.tail_registration, null, 'Aircraft must be blank');
    assert.strictEqual(row.tail, null, 'the association must not resolve');
    out(`OData: Registration="${row.aircraft_reg}"  Aircraft=${row.tail}  (blank beside populated)`);
  });
});

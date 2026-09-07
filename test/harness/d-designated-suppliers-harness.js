/**
 * D — DESIGNATED_SUPPLIERS, and the cascade.
 *
 * The first real consumer of E's resolveEffective(). Everything about
 * validity, priority, specificity and open-ended windows belongs to E and is
 * not retested here. What IS tested is the one thing E cannot know: the
 * cascade, and what each rung means.
 *
 *   1  flight + date        the primary axis
 *   2  else station + date  the fallback
 *   3  else NOTHING         and nothing is an ANSWER, not a failure
 *
 * RUNG 3 IS THE CRITERION THAT MATTERS. An undesignated station must return
 * null so the order is created with an empty supplier. Two things it must
 * never do: refuse, or fall back to any contract at that station. The second
 * is the join that over-matches, which has produced a wrong answer here three
 * times, and it would be invisible - a plausible supplier on every order.
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert');
const test=cds.test(PROJECT); const out=s=>process.stdout.write('      '+s+'\n');
const { resolveDesignation, orderDefaultsFrom, AXIS } =
    require(`${PROJECT}/srv/lib/designation-resolver`);
const db=()=>cds.connect.to('db');

describe('D — who fuels this flight', () => {

  it('EXIT-1  the seed is present and every row is resolvable', async () => {
    const rows = await (await db()).run(SELECT.from('fuelsphere.DESIGNATED_SUPPLIERS'));
    assert.ok(rows.length >= 5, `only ${rows.length} designations - too few to exercise the cascade`);
    for (const r of rows) assert.ok(r.supplier_ID, 'a designation with no supplier designates nothing');
    // A row that names neither a flight nor a station can never be reached.
    const orphan = rows.filter(r => !r.flight_number && !r.station_code);
    assert.deepStrictEqual(orphan.map(r => r.ID), [],
      'a designation naming neither flight nor station is unreachable by either rung');
    out(`${rows.length} designations, all with a supplier and an axis`);
  });

  it('EXIT-2  RUNG 1 — the flight beats the station, and the AXIS is recorded', async () => {
    // AC410 has its own row AND YYZ has a station default. The flight wins.
    const r = await resolveDesignation({ flightNumber: 'AC410', stationCode: 'YYZ',
        asOfDate: '2026-04-10', carrierCode: 'AC' });
    assert.strictEqual(r.resolved, true);
    assert.strictEqual(r.axis, AXIS.FLIGHT, 'a flight-level row must be reached by the FLIGHT axis');
    assert.strictEqual(r.row.flight_number, 'AC410');

    // Instrument check: the station row must actually exist, or "the flight
    // won" is a statement about an empty set.
    const station = await (await db()).run(SELECT.from('fuelsphere.DESIGNATED_SUPPLIERS')
        .where({ station_code: 'YYZ', flight_number: null }));
    assert.ok(station.length > 0, 'instrument check: no YYZ station row, so nothing was beaten');
    out(`AC410 -> ${r.axis}, beating ${station.length} station row(s) at YYZ`);
  });

  it('EXIT-3  RUNG 2 — a flight with no row of its own falls to the station', async () => {
    const r = await resolveDesignation({ flightNumber: 'AC999-NO-SUCH', stationCode: 'YYZ',
        asOfDate: '2026-04-10', carrierCode: 'AC' });
    assert.strictEqual(r.resolved, true);
    assert.strictEqual(r.axis, AXIS.STATION);
    assert.strictEqual(r.row.flight_number, null, 'rung 2 must reach a row with NO flight number');
    out(`an undesignated flight at YYZ -> ${r.axis}, supplier resolved`);
  });

  it('EXIT-4  RUNG 2 does NOT let another flight answer for this station', async () => {
    // The over-matching join, one rung down. AC102 is designated AT LHR; a
    // different flight at LHR must NOT pick up AC102's row.
    const r = await resolveDesignation({ flightNumber: 'AC888-NO-SUCH', stationCode: 'LHR',
        asOfDate: '2026-04-10', carrierCode: 'AC' });
    assert.strictEqual(r.resolved, true);
    assert.strictEqual(r.axis, AXIS.STATION);
    assert.strictEqual(r.row.flight_number, null,
      'ANOTHER FLIGHT\'S designation answered a station question - the join over-matched');
    // and it is the BP row, not the Total row that AC101 carries
    const sup = await (await db()).run(SELECT.one.from('fuelsphere.MASTER_SUPPLIERS')
        .where({ ID: r.row.supplier_ID }));
    assert.strictEqual(sup.supplier_code, 'BPUK001',
      `LHR's station default is BP; got ${sup.supplier_code}`);
    out(`an undesignated flight at LHR -> ${sup.supplier_code}, not AC102's supplier`);
  });

  it('EXIT-5  RUNG 3 — nothing resolves, and NOTHING IS AN ANSWER', async () => {
    // CDG's designation closed 31 March 2026. An April order resolves to
    // nothing and must be CREATED ANYWAY with an empty supplier.
    const r = await resolveDesignation({ flightNumber: 'AC301', stationCode: 'CDG',
        asOfDate: '2026-04-10', carrierCode: 'AC' });
    assert.strictEqual(r.resolved, false, 'the CDG window closed 31 March - it must not resolve in April');
    assert.strictEqual(r.axis, AXIS.NONE);
    assert.strictEqual(r.row, null, 'a miss returns null, never an invented supplier');
    assert.ok(r.reason.includes('empty supplier'), 'the reason must say what happens next');

    // AND IT DID NOT THROW. Capture is never blocked.
    const d = orderDefaultsFrom(r);
    assert.strictEqual(d.supplier_ID, null);
    assert.strictEqual(d.designation_axis, AXIS.NONE);

    // Instrument check: the same station DOES resolve inside its window, or
    // this criterion is passing on a station that was never designated.
    const inside = await resolveDesignation({ flightNumber: 'AC301', stationCode: 'CDG',
        asOfDate: '2026-02-10', carrierCode: 'AC' });
    assert.strictEqual(inside.resolved, true,
      'instrument check: CDG never resolves at all, so the closed window proves nothing');
    out(`CDG on 2026-02-10 -> resolved; on 2026-04-10 -> ${r.axis}, empty supplier, no throw`);
  });

  it('EXIT-6  supplier_performs_uplift TRUE leaves the agent EMPTY BY DESIGN', async () => {
    // Empty-because-the-supplier-fuels-it and empty-because-we-do-not-know
    // are different states, and the axis beside them is what tells them apart.
    const bp = await resolveDesignation({ stationCode: 'LHR', asOfDate: '2026-04-10',
        carrierCode: 'AC' });
    assert.strictEqual(bp.resolved, true);
    assert.strictEqual(bp.row.supplier_performs_uplift, true);
    const d = orderDefaultsFrom(bp);
    assert.ok(d.supplier_ID, 'the supplier must still be set');
    assert.strictEqual(d.into_plane_agent_ID, null, 'the agent is empty when the supplier fuels');
    assert.strictEqual(d.designation_axis, AXIS.STATION,
      'and the axis says this was RESOLVED, which is what distinguishes it from unknown');

    // The contrasting case must exist, or "empty by design" is untested.
    const yyz = await resolveDesignation({ flightNumber: 'AC410', stationCode: 'YYZ',
        asOfDate: '2026-04-10', carrierCode: 'AC' });
    const dy = orderDefaultsFrom(yyz);
    assert.ok(dy.into_plane_agent_ID, 'instrument check: no agent anywhere, so the contrast is untested');
    assert.ok(dy.into_plane_contract_ID, 'an agent with no contract is half a designation');
    out(`LHR: supplier fuels, agent null. YYZ: agent set with its own contract. Both resolved.`);
  });

  it('EXIT-7  the flight axis wins on ORDER, not on priority', async () => {
    // AC101 at LHR is priority 900; the LHR station row is 100. Lower wins on
    // priority, so if the axis were expressed as a number the station would
    // take it. The flight must win anyway.
    const r = await resolveDesignation({ flightNumber: 'AC102', stationCode: 'LHR',
        asOfDate: '2026-04-10', carrierCode: 'AC' });
    assert.strictEqual(r.axis, AXIS.FLIGHT);
    assert.strictEqual(r.row.flight_number, 'AC102');
    const station = await (await db()).run(SELECT.one.from('fuelsphere.DESIGNATED_SUPPLIERS')
        .where({ station_code: 'LHR', flight_number: null }));
    assert.ok(Number(r.row.priority) > Number(station.priority),
      `instrument check: the flight row must have a WORSE priority than the station row, `
    + `or this proves nothing about the axis. flight=${r.row.priority} station=${station.priority}`);
    out(`AC102 priority ${r.row.priority} beats LHR station priority ${station.priority} on AXIS`);
  });

  it('EXIT-8  carrier scoping is UNEXERCISED BY DATA, and says so', async () => {
    // NOT A PASSING TEST DRESSED AS COVERAGE. carrier_code is a scope field on
    // the entity and on every resolver call, and the seed holds ONE carrier -
    // so no call has ever had to choose between two. This criterion asserts
    // the GAP so it cannot be mistaken for coverage.
    //
    // Seeding a second carrier is not one row: it needs flights, tails,
    // contracts and a company code, and FuelSphere has no carrier entity to
    // hang them on. The first multi-carrier tenant is this path's first test.
    const rows = await (await db()).run(SELECT.from('fuelsphere.DESIGNATED_SUPPLIERS'));
    const carriers = new Set(rows.map(r => r.carrier_code).filter(Boolean));
    assert.strictEqual(carriers.size, 1,
      `the seed now holds ${carriers.size} carriers - carrier scoping has become testable `
    + `and this criterion should be replaced by one that tests it`);

    // What CAN be shown today: the field is carried into the resolution and
    // reaches the evidence, so a second carrier would have something to act on.
    const r = await resolveDesignation({ flightNumber: 'AC410', stationCode: 'YYZ',
        asOfDate: '2026-04-10', carrierCode: 'AC' });
    assert.strictEqual(r.resolved, true);
    assert.ok('carrier_code' in r.evidence.scope_matched,
      'carrier_code is not among the scope fields the resolver reports');
    out(`carrier scoping UNTESTED: ${carriers.size} carrier in the seed (${[...carriers]}); `
      + `the field reaches evidence.scope_matched and nothing has had to choose`);
  });

  it('EXIT-9  RESOLVED, NEVER COPIED — the designation is not denormalised anywhere', async () => {
    // A supplier changes a number and every flight shows the new one. A copy
    // shows the old one forever and nothing says which is current.
    const m = await cds.load(`${PROJECT}/db`);
    const l = cds.linked(cds.compile.for.nodejs(m)).definitions;
    for (const ent of ['fuelsphere.FLIGHT_SCHEDULE', 'fuelsphere.FLIGHT_DISPATCH']) {
      const els = Object.keys(l[ent].elements);
      const copied = els.filter(k => /designated|into_plane/.test(k));
      assert.deepStrictEqual(copied, [],
        `${ent} carries a copy of the designation: ${copied.join(', ')}`);
    }
    // FUEL_ORDERS is the deliberate exception and must have the fields.
    const o = Object.keys(l['fuelsphere.FUEL_ORDERS'].elements);
    for (const k of ['into_plane_agent_ID','into_plane_contract_ID'])
      assert.ok(o.includes(k), `FUEL_ORDERS is missing ${k} - the agent cannot default into it`);
    out('no designation copied onto a flight or a plan; FUEL_ORDERS carries both agent fields');
  });
});

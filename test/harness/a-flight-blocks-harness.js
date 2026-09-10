/**
 * A — THE FLIGHT SCHEDULE'S BLOCKS AND LIST CHANGES.
 *
 * The only screen with a named requester: the SME asked for the supplier as a
 * FILTER and a COLUMN, twice in one session.
 *
 * Proved the way everything is proved here since the $fiori-preview
 * correction: every binding EXECUTED against live data. A 200 means a route
 * resolved; it has never meant a pixel. Eight distinct causes of an empty
 * section are recorded in CLAUDE.md and NOT ONE is visible by looking.
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert');
const test=cds.test(PROJECT); const out=s=>process.stdout.write('      '+s+'\n');
const P='/odata/v4/planning';
const M='/odata/v4/master';

describe('A — the flight schedule', () => {

  let edmx;
  before(() => { edmx = cds.compile.to.edmx(cds.model, { service: 'PlanningService', version: 'v4' }); });

  it('EXIT-1  the supplier is BOTH a filter and a column', () => {
    const blk = edmx.match(/<Annotations Target="PlanningService\.FlightSchedule">([\s\S]*?)<\/Annotations>/)[1];
    const sf = blk.match(/<Annotation Term="UI.SelectionFields">([\s\S]*?)<\/Annotation>/);
    assert.ok(sf, 'no SelectionFields at all');
    const li = blk.match(/<Annotation Term="UI.LineItem">([\s\S]*?)<\/Annotation>/);

    // THIS CRITERION ASSERTED station_default AND FIRED WHEN D56 WAS FIXED -
    // the second self-invalidating criterion this week to do its job.
    //
    // It was right that the SME asked for BOTH and right that both were
    // bound. It was wrong about what they were bound TO: station_default is
    // the STATION axis by construction, so the filter MISSED AC102 under its
    // real supplier and RETURNED it under LHR's default. Measured, both ways.
    //
    // Both halves of the ask still hold and now point at the resolved
    // designation. The station default is asserted OFF both, because it
    // agrees on 13 of 14 rows and differs on the one nobody is watching.
    for (const [what, txt] of [['FILTER', sf[1]], ['COLUMN', li[1]]]) {
      assert.ok(/designated\/supplier_name/.test(txt),
        `the designated supplier is not a ${what} - the SME asked for both, twice`);
      const stale = [...txt.matchAll(/Path="([^"]*)"/g)].map(m => m[1])
        .filter(x => x.split('/').includes('station_default'));
      assert.deepStrictEqual(stale, [],
        `the ${what} binds station_default (${stale.join(', ')}), which cannot show a flight-level `
      + `arrangement. See d56-designated-column EXIT-6 for the two flights it gets wrong.`);
    }
    // gate and stand were confirmed present by survey; terminal was NOT.
    assert.ok(/Path="gate_number"/.test(li[1]) && /Path="stand_number"/.test(li[1]));
    assert.strictEqual(/Path="terminal"/.test(li[1]), false,
      'terminal does not exist on FLIGHT_SCHEDULE and must not be bound');
    out('supplier is a filter AND a column; gate and stand present; terminal correctly absent');
  });

  it('EXIT-2  the column RETURNS VALUES, not just a binding', async () => {
    const { data } = await test.GET(`${P}/FlightSchedule`
      + `?$select=flight_number,origin_airport,gate_number,stand_number`
      + `&$expand=station_default($expand=supplier($select=supplier_name))&$top=200`);
    const named = data.value.filter(f => (f.station_default||[]).length
                                      && f.station_default[0].supplier?.supplier_name);
    assert.ok(named.length > 0, 'THE COLUMN WOULD RENDER EMPTY on every row');
    assert.ok(data.value.some(f => f.gate_number), 'the gate column is null everywhere');
    const suppliers = new Set(named.map(f => f.station_default[0].supplier.supplier_name));
    assert.ok(suppliers.size > 1,
      'every flight shows the SAME supplier - a filter with one value filters nothing');
    out(`${named.length}/${data.value.length} flights carry a supplier, across ${suppliers.size} suppliers`);
  });

  it('EXIT-3  TWO supplier blocks, and both always render', () => {
    const blk = edmx.match(/<Annotations Target="PlanningService\.FlightSchedule">([\s\S]*?)<\/Annotations>/)[1];
    for (const t of ['designation/@UI.LineItem#FlightBlock', 'station_default/@UI.LineItem#StationBlock'])
      assert.ok(blk.includes(`AnnotationPath="${t}"`), `the facet for ${t} is missing`);
    // NEITHER may be conditional. If the station block hid when a flight-level
    // designation exists, the page would change shape between rows - and a
    // viewer cannot tell a missing block from an absent one.
    assert.strictEqual(/StationDefault[\s\S]{0,400}?UI\.Hidden/.test(blk), false,
      'the station block is conditionally hidden - the page would change shape between rows');
    out('both facets present, neither conditional');
  });

  it('EXIT-4  each block resolves the RIGHT axis, and they differ', async () => {
    const one = async (fn) => (await test.GET(`${P}/FlightSchedule?$filter=flight_number eq '${fn}'`
      + `&$expand=designation($expand=supplier($select=supplier_name)),`
      + `station_default($expand=supplier($select=supplier_name))`)).data.value[0];

    // AC102 has BOTH, and they name DIFFERENT suppliers - which is the only
    // shape that proves the two blocks are reading different rows.
    const ac102 = await one('AC102');
    assert.ok((ac102.designation||[]).length, 'AC102 has no flight-level designation');
    assert.ok((ac102.station_default||[]).length, 'AC102 has no station default');
    const f = ac102.designation[0].supplier.supplier_name;
    const st = ac102.station_default[0].supplier.supplier_name;
    assert.notStrictEqual(f, st,
      'both blocks name the same supplier - they could be reading one row');

    // And a flight with NO arrangement of its own still shows its station's.
    const ac201 = await one('AC201');
    assert.strictEqual((ac201.designation||[]).length, 0);
    assert.ok((ac201.station_default||[]).length,
      'a flight with no designation shows nothing at all - the fallback is not reaching it');
    out(`AC102: flight=${f} vs station=${st}. AC201: no flight row, station=`
      + `${ac201.station_default[0].supplier.supplier_name}`);
  });

  it('EXIT-5  the agent block distinguishes EMPTY BY DESIGN from unknown', async () => {
    const { data } = await test.GET(`${P}/DesignatedSuppliers`
      + `?$select=station_code,flight_number,supplier_performs_uplift`
      + `&$expand=into_plane_agent($select=supplier_name),into_plane_contract($select=contract_number)`);
    const fuels = data.value.filter(d => d.supplier_performs_uplift === true);
    const agent = data.value.filter(d => d.supplier_performs_uplift === false);
    assert.ok(fuels.length && agent.length,
      'instrument check: one of the two states is unseeded, so the contrast is untested');
    for (const d of fuels) assert.strictEqual(d.into_plane_agent, null,
      'supplier_performs_uplift TRUE must leave the agent empty');
    for (const d of agent) assert.ok(d.into_plane_agent?.supplier_name,
      'supplier_performs_uplift FALSE with no agent is half a designation');
    out(`${fuels.length} supplier-fuels (agent null by design), ${agent.length} with a named agent`);
  });

  it('EXIT-6  the aircraft block, and THREE FIELDS DELIBERATELY NOT BOUND HERE', async () => {
    const { data } = await test.GET(`${P}/FlightSchedule?$filter=flight_number eq 'AC410'`
      + `&$expand=tail($select=registration,aircraft_type_code,dry_operating_weight_kg,`
      + `fuel_capacity_kg,apu_burn_rate_kg_hr,performance_factor_pct,record_status;`
      + `$expand=aircraft_type($select=mtow_kg))`);
    const t = data.value[0].tail;
    assert.ok(t, 'AC410 does not reach a tail');
    for (const f of ['registration','dry_operating_weight_kg','fuel_capacity_kg',
                     'apu_burn_rate_kg_hr','performance_factor_pct'])
      assert.ok(t[f] !== null && t[f] !== undefined, `the aircraft block would show a blank ${f}`);
    assert.ok(t.aircraft_type?.mtow_kg, 'MTOW is reached through the TYPE and is null');

    // THIS CRITERION SAID "MISSING RATHER THAN BLANK" AND IT FIRED WHEN THE
    // FIELDS ARRIVED — which is the criterion working, not breaking. Package
    // B added mlw_kg, mzfw_kg and engine_burn_rate_kgph to the tail master,
    // so the first half no longer holds.
    //
    // THE SECOND HALF STILL DOES, AND IT IS THE HALF THAT MATTERED. They are
    // NULL on every tail and must not be bound in THIS block — a field that is
    // not there is a question; one that is there and permanently blank is the
    // eighth cause of an empty section. They belong on the master-data page,
    // where an empty field is a prompt to fill it, and tail-performance
    // EXIT-4 asserts exactly that split.
    //
    // SCOPED TO #AircraftForFlight, NOT TO THE WHOLE EDMX. PlanningService
    // also carries the tail's own object page, and the day someone annotates
    // MLW there this criterion must not fire — it is about the FLIGHT's
    // aircraft block and nothing else.
    const fg = edmx.match(
      /<Annotation Term="UI.FieldGroup" Qualifier="AircraftForFlight">[\s\S]*?<\/Annotation>/);
    assert.ok(fg, 'the flight\'s aircraft block is gone from the EDMX');
    const m2 = cds.linked(cds.compile.for.nodejs(await cds.load(`${PROJECT}/db`))).definitions;
    const reg = m2['fuelsphere.AIRCRAFT_REGISTRATIONS'].elements;
    for (const f of ['mlw_kg','mzfw_kg','engine_burn_rate_kgph']) {
      assert.ok(reg[f], `${f} has gone from the tail master again`);
      // FORM-AGNOSTIC ON PURPOSE. `Path="mlw_kg"` is only ONE of the forms a
      // binding takes: MTOW in this very block emits as
      // `Path="aircraft_type/mtow_kg"`, so an exact-match check would report
      // "not bound" for a field that IS bound through one hop. Proved by
      // measuring this block: nine fields, and the exact form finds eight.
      const bound = [...fg[0].matchAll(/Path="([^"]*)"/g)]
        .map(x => x[1]).filter(x => x.split('/').includes(f));
      assert.deepStrictEqual(bound, [],
        `the flight's aircraft block binds ${f}. It is NULL on every tail, so it would render as a `
      + `permanently blank row on an operational page — the exact failure this criterion was written `
      + `for, arriving from the other direction now that the field exists.`);
    }
    const { data: nulls } = await test.GET(
      `${M}/AircraftRegistrations?$select=registration,mlw_kg,mzfw_kg,engine_burn_rate_kgph&$top=60`);
    assert.ok(nulls.value.length > 0, 'instrument check: no tails read back at all');
    const populated = nulls.value.filter(
      r => r.mlw_kg != null || r.mzfw_kg != null || r.engine_burn_rate_kgph != null);
    assert.strictEqual(populated.length, 0,
      `${populated.length} tail(s) now carry MLW/MZFW/engine burn — the aircraft block SHOULD gain them `
    + `and this criterion should change to assert they render.`);
    out(`C-FDMO: MTOW ${t.aircraft_type.mtow_kg} (via type), DOW ${t.dry_operating_weight_kg}, `
      + `cap ${t.fuel_capacity_kg}, APU ${t.apu_burn_rate_kg_hr}; MLW/MZFW/engine burn now EXIST `
      + `on the tail master, are null on all ${nulls.value.length} tails, and are not bound here`);
  });

  it('EXIT-7  nothing is COPIED onto the flight', async () => {
    const m = cds.linked(cds.compile.for.nodejs(await cds.load(`${PROJECT}/db`))).definitions;
    const els = Object.keys(m['fuelsphere.FLIGHT_SCHEDULE'].elements);
    const copied = els.filter(k => /supplier|into_plane|agent|mtow|dow_kg/.test(k));
    assert.deepStrictEqual(copied, [],
      `FLIGHT_SCHEDULE carries a copy instead of resolving: ${copied.join(', ')}`);
    out('no supplier, agent or aircraft figure copied onto FLIGHT_SCHEDULE');
  });
});

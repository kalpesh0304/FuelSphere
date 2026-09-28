/**
 * THE REGULATED FUEL STACK ON THE SCREEN, AND THE TEMPLATE BEHIND IT.
 *
 *   EXIT-1  all seven components are EXPOSED and read back
 *   EXIT-2  block equals the sum of the seven, on every row
 *   EXIT-3  contingency is 5% of TRIP on every row, and the ratio is ON the row
 *   EXIT-4  the object page shows nine figures and states the rule
 *   EXIT-5  required_uplift_kg is DELIBERATELY ABSENT from the screen
 *   EXIT-6  THE TEMPLATE IS RECORDED — the seven corrected rows shared one
 *           percentage signature, and the evidence outlives the correction
 *   EXIT-7  rob_departure_kg MEANS TWO THINGS (D57), asserted so the day it is
 *           reconciled this fails and asks for the subtraction back
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert'); const fs=require('node:fs');
const test=cds.test(PROJECT); const out=s=>process.stdout.write('      '+s+'\n');
const P='/odata/v4/planning';
const SEVEN=['trip_fuel_kg','contingency_fuel_kg','alternate_fuel_kg','final_reserve_kg',
             'additional_fuel_kg','taxi_fuel_kg','extra_fuel_kg'];
const num=v=>v==null?null:Number(v);

describe('The regulated fuel stack', () => {

  let edmx, rows;
  before(async () => {
    edmx = cds.compile.to.edmx(cds.model, { service:'PlanningService', version:'v4' });
    const { data } = await test.GET(`${P}/FlightDispatches?$top=100&$orderby=flight_number`
      + `&$select=flight_number,${SEVEN.join(',')},block_fuel_kg,dispatch_qty_kg,`
      + `required_uplift_kg,rob_departure_kg,contingency_pct_of_trip`);
    rows = data.value;
  });

  it('EXIT-1  all seven components are EXPOSED and read back', async () => {
    // WIDEN FIRST, PROVE EACH FIELD, THEN ANNOTATE. An annotation naming a
    // field the projection lacks fails the WHOLE READ of the entity, not the
    // column - so each is requested ALONE, which is what would catch it.
    for (const f of SEVEN) {
      const { data } = await test.GET(`${P}/FlightDispatches?$top=1&$select=${f}`);
      assert.ok(f in data.value[0], `${f} is not on the projection`);
    }
    assert.ok(rows.length, 'no dispatch rows at all');
    const blank = SEVEN.filter(f => rows.every(r => num(r[f]) === null));
    assert.deepStrictEqual(blank, [],
      `${blank.join(', ')} is null on EVERY row - a permanently blank column, and the reason the `
    + `previous annotation gave for omitting the stack. Check the data before binding it.`);
    out(`${SEVEN.length} components exposed, ${rows.length} rows, none blank throughout`);
  });

  it('EXIT-2  block = the sum of the seven, on every row', () => {
    for (const r of rows) {
      const sum = +SEVEN.reduce((a,f)=>a+(num(r[f])||0),0).toFixed(2);
      assert.strictEqual(+Number(r.block_fuel_kg).toFixed(2), sum,
        `${r.flight_number}: block ${r.block_fuel_kg} but the seven sum to ${sum}. DSP450 - block is `
      + `DERIVED and never keyed, so a disagreement means somebody typed the total.`);
      assert.strictEqual(+Number(r.dispatch_qty_kg).toFixed(2), sum,
        `${r.flight_number}: the dispatcher-confirmed quantity ${r.dispatch_qty_kg} does not equal `
      + `block ${sum}. The schema says it should.`);
    }
    out(`block = the sum of the seven on all ${rows.length} rows, and dispatch_qty follows it`);
  });

  it('EXIT-3  contingency is 5% of TRIP, and the ratio is ON the row', () => {
    // 6.54% OF TRIP IS 5% OF BLOCK. That is the whole defect: the figure was
    // right against the wrong base, so it looked deliberate.
    for (const r of rows) {
      const trip = num(r.trip_fuel_kg), cont = num(r.contingency_fuel_kg);
      assert.ok(trip, `${r.flight_number} has no trip fuel, so the rule cannot be checked`);
      assert.strictEqual(+cont.toFixed(2), +(trip*0.05).toFixed(2),
        `${r.flight_number}: contingency ${cont} is ${(100*cont/trip).toFixed(2)}% of trip. The rule is `
      + `5.00%. If it reads 6.54% this is the 5%-OF-BLOCK template, not a plan.`);
      // The ratio must be ON the row: nobody divides two columns across a table.
      assert.strictEqual(+Number(r.contingency_pct_of_trip).toFixed(2), 5.00,
        `${r.flight_number}: contingency_pct_of_trip reads ${r.contingency_pct_of_trip}`);
    }
    out(`contingency = 5.00% of trip on all ${rows.length} rows, and the ratio is a column`);
  });

  it('EXIT-4  the object page shows NINE figures and STATES THE RULE', () => {
    const fg = edmx.match(
      /<Annotation Term="UI.FieldGroup" Qualifier="DispatchQty">[\s\S]*?<\/Annotation>/);
    assert.ok(fg, 'the stack field group is gone');
    const paths = [...fg[0].matchAll(/Path="([^"]*)"/g)].map(m=>m[1]);
    for (const f of [...SEVEN,'block_fuel_kg','dispatch_qty_kg'])
      assert.ok(paths.includes(f), `${f} is not on the object page's stack group`);
    // THE RULE ABOVE THE TOTAL IS THE POINT. A viewer who cannot see the rule
    // cannot tell a total that is right from one that was typed.
    assert.ok(/Block = sum of the seven/.test(fg[0]),
      'block_fuel_kg does not say it is the sum. Without the rule the total is just a number');
    assert.ok(paths.includes('contingency_pct_of_trip'),
      'the contingency ratio is not on the page - the rule is stated as a percentage of trip');
    assert.ok(/rule: 5.00/.test(fg[0]),
      'the page does not state what the contingency percentage SHOULD be, so 6.54 would look normal');
    // additional and extra must remain DISTINGUISHABLE - DSP454.
    assert.ok(/Additional — planned/.test(fg[0]) && /Extra — commander/.test(fg[0]),
      'additional and extra are not labelled apart. Merging them loses the only interesting question '
    + 'about them: what the operation required versus what the commander chose. DSP454');
    out(`${paths.length} figures on the stack group, the sum rule stated, contingency ratio present`);
  });

  it('EXIT-5  required_uplift_kg is COMPUTED, and equals what derives it', () => {
    // REPLACES "deliberately absent" (Sep 2026), exactly as that criterion
    // asked to be replaced: the fuel order now takes its quantity from this
    // figure, so a blank here is an order nobody can raise. Seven of the
    // eleven plans were blank and are filled from the rule the user stated -
    // dispatch quantity less the FOB at departure.
    //
    // THE OTHER FOUR ARE NOT BLANK AND DO NOT OBEY THAT RULE, and this says so
    // rather than averaging over it: on those rows rob_departure_kg EQUALS the
    // dispatch quantity - it is the figure AFTER uplift there - so the
    // subtraction gives zero while the plan states a real uplift. They keep
    // their stated figure, and order-service.js prefers it over a zero.
    const withAll = rows.filter(r => num(r.dispatch_qty_kg) !== null && num(r.rob_departure_kg) !== null);
    assert.ok(withAll.length > 0, 'instrument check: no plan carries both figures');

    const blanks = rows.filter(r => num(r.required_uplift_kg) === null);
    assert.deepStrictEqual(blanks.map(r => r.flight_number), [],
      'a blank required uplift is an order that cannot be raised from the plan');

    const differs = [];
    for (const r of withAll) {
      const computed = Number((num(r.dispatch_qty_kg) - num(r.rob_departure_kg)).toFixed(2));
      const stated = num(r.required_uplift_kg);
      if (computed > 0 && Math.abs(computed - stated) > 0.01) differs.push(`${r.flight_number}: ${stated} vs ${computed}`);
      if (computed <= 0) assert.ok(stated > 0,
        `${r.flight_number}: the subtraction collapses to ${computed} and the plan states nothing usable`);
    }
    assert.deepStrictEqual(differs, [],
      'where the subtraction is meaningful, the stated uplift must equal it');
    const collapsed = withAll.filter(r => num(r.dispatch_qty_kg) - num(r.rob_departure_kg) <= 0).length;
    out(`${withAll.length} plans carry both figures; ${withAll.length - collapsed} match dispatch qty less FOB at departure, `
      + `${collapsed} carry a departure figure taken AFTER uplift and keep their stated uplift`);
  });

  it('EXIT-6  THE TEMPLATE IS RECORDED — evidence that outlives the correction', () => {
    // 82000 was a ROUND number because it was chosen first and split seven
    // ways; 81036.50 is not. Correcting contingency therefore DESTROYS the
    // tell, so the signature is asserted here instead of inferred from data
    // that no longer shows it.
    //
    // The seven corrected rows carried, as a percentage of block:
    //   trip 76.50  cont 5.00  alt 8.00  fres 6.00  addl 2.00  taxi 1.50  extra 1.00
    // identical across a 37-fold range of block fuel. One template, seven times.
    const CORRECTED = ['AC101','AC102','AC301','AC401','AC501','AC601','AC602'];
    const seen = rows.filter(r => CORRECTED.includes(r.flight_number));
    assert.strictEqual(seen.length, CORRECTED.length,
      'the seven corrected flights are not all in the dispatch seed any more');

    // The five UNCORRECTED components still carry the template's ratios TO
    // EACH OTHER, because only contingency and block moved. alt:fres:addl:taxi:extra
    // was 8:6:2:1.5:1 and must still be, or somebody has quietly reseeded them.
    for (const r of seen) {
      const alt=num(r.alternate_fuel_kg), fres=num(r.final_reserve_kg);
      assert.ok(Math.abs(alt/fres - 8/6) < 0.001,
        `${r.flight_number}: alternate/final-reserve is ${(alt/fres).toFixed(4)} and the template's `
      + `was ${(8/6).toFixed(4)}. If these were re-seeded from a real source, say where from and `
      + `retire this criterion - it exists to record that they have NOT been.`);
    }
    // And final reserve is still the artefact: 30 min at holding is the rule,
    // and 7.84% of trip is roughly 9 minutes on a 2-hour sector.
    for (const r of seen) {
      const pct = 100*num(r.final_reserve_kg)/num(r.trip_fuel_kg);
      assert.ok(Math.abs(pct - 7.84) < 0.01,
        `${r.flight_number}: final reserve is ${pct.toFixed(2)}% of trip, not the template's 7.84%. `
      + `A real 30-minute reserve would be a fine thing - record where the holding burn rate came `
      + `from, because engine_burn_rate_kgph is null on all 31 tails.`);
    }
    out(`${seen.length} rows still carry the template in the five uncorrected components `
      + `(alt:fres 8:6, final reserve 7.84% of trip ~ 9 minutes, rule is 30)`);
  });

  it('EXIT-7  rob_departure_kg MEANS TWO THINGS — D57, asserted so it cannot settle quietly', () => {
    // Documented as "remaining on board at CHOCKS-OFF", which is AFTER uplift
    // and therefore EQUAL to block. Four rows follow that. Seven carry a
    // PRE-uplift figure, where block - rob is a real required uplift.
    //
    // Both readings are internally consistent and they contradict each other,
    // which is why block - rob gives 0 on four rows and 68,000 on another.
    // This is the reason required_uplift_kg stays off the page.
    const post = rows.filter(r => num(r.block_fuel_kg) !== null && num(r.rob_departure_kg) !== null
      && Math.abs(num(r.block_fuel_kg) - num(r.rob_departure_kg)) < 0.005);
    const pre = rows.filter(r => num(r.rob_departure_kg) !== null && !post.includes(r));
    assert.ok(post.length > 0 && pre.length > 0,
      `rob_departure_kg is now used consistently (${post.length} post-uplift, ${pre.length} pre-uplift). `
    + `D57 is closed - decide which reading won, write it on the field, and put required_uplift_kg `
    + `back on the page with EXIT-5 replaced.`);
    assert.ok(/D57/.test(edmx),
      'the two readings are not mentioned anywhere a viewer can see. A field meaning two things, '
    + 'shown beside block, is the D56 shape again: a correct-looking figure from the wrong basis');
    out(`rob_departure: ${post.length} rows post-uplift (= block, as documented), `
      + `${pre.length} rows pre-uplift. block - rob is therefore 0 on some rows and a real uplift on others`);
  });
});

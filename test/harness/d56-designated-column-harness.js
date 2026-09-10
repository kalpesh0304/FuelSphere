/**
 * D56 — THE DESIGNATED SUPPLIER AS A COLUMN AND A FILTER.
 *
 * The SME asked for this twice in one session and it has never worked. What
 * was wrong is NOT what D56 recorded, and the criteria below assert the thing
 * that was actually broken.
 *
 *   EXIT-1  the column and the filter bind `designated`, not `station_default`
 *   EXIT-2  AT MOST ONE ROW PER FLIGHT — the property the to-one rests on
 *   EXIT-3  THE INVARIANT: the view agrees with resolveDesignation() or says
 *           nothing. It never shows a DIFFERENT supplier
 *   EXIT-4  the decline arm — a same-axis tie makes the view abstain while the
 *           resolver still answers. UNEXERCISED BY DATA, proved by a plant
 *   EXIT-5  THE AXIS IS LOAD-BEARING: AC102's flight row beats its station row
 *           although its PRIORITY IS WORSE. Two numbers that disagree
 *   EXIT-6  the filter returns the right flights, and the OLD binding is shown
 *           returning the wrong ones beside it
 *   EXIT-7  the entity set is ADDRESSABLE, and the filter labels exist
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert');
const test=cds.test(PROJECT); const out=s=>process.stdout.write('      '+s+'\n');
const P='/odata/v4/planning';

describe('D56 — the designated supplier column', () => {

  let edmx, sup, byName, flights;
  before(async () => {
    edmx = cds.compile.to.edmx(cds.model, { service: 'PlanningService', version: 'v4' });
    const { SELECT } = cds.ql;
    sup = Object.fromEntries((await cds.db.run(SELECT.from('fuelsphere.MASTER_SUPPLIERS')
      .columns('ID','supplier_name'))).map(s => [s.ID, s.supplier_name]));
    byName = Object.fromEntries(Object.entries(sup).map(([k,v]) => [v,k]));
    flights = await cds.db.run(SELECT.from('fuelsphere.FLIGHT_SCHEDULE')
      .columns('ID','flight_number','flight_date','origin_airport','airline_code')
      .orderBy('flight_number'));
  });

  const resolver = () => require(`${PROJECT}/srv/lib/designation-resolver`);
  const truthFor = async (f) => {
    const r = await resolver().resolveDesignation({
      flightNumber: f.flight_number, stationCode: f.origin_airport,
      asOfDate: String(f.flight_date).slice(0,10), carrierCode: f.airline_code });
    return { name: r.resolved ? sup[r.row.supplier_ID] : null, axis: r.axis,
             candidates: r.evidence ? r.evidence.candidates : 0 };
  };

  it('EXIT-1  the column and the filter bind the RESOLVED designation', () => {
    const blk = edmx.match(/<Annotations Target="PlanningService\.FlightSchedule">([\s\S]*?)<\/Annotations>/)[1];
    const sf = blk.match(/<Annotation Term="UI.SelectionFields">([\s\S]*?)<\/Annotation>/)[1];
    const li = blk.match(/<Annotation Term="UI.LineItem">([\s\S]*?)<\/Annotation>/)[1];

    assert.ok(/designated\/supplier_name/.test(sf),
      'the FILTER does not bind the resolved designation - the SME asked for it as a filter');
    assert.ok(/designated\/supplier_name/.test(li),
      'the COLUMN does not bind the resolved designation - the SME asked for it as a column');

    // AND THE STATION DEFAULT MUST BE OFF BOTH. It agrees with the answer on
    // 13 of 14 rows, so leaving it beside the right column gives two columns
    // that differ exactly once, on the row nobody is looking at.
    //
    // FORM-AGNOSTIC: a path is matched by SEGMENT, not by exact string. The
    // recorded fourth dress - `Path="mlw_kg"` found eight of nine fields
    // because MTOW emits as `Path="aircraft_type/mtow_kg"`.
    for (const [where, txt] of [['filter', sf], ['column', li]]) {
      const bound = [...txt.matchAll(/Path="([^"]*)"/g)].map(m => m[1])
        .filter(p => p.split('/').includes('station_default'));
      assert.deepStrictEqual(bound, [],
        `the ${where} still binds station_default (${bound.join(', ')}). It is the STATION axis by `
      + `construction and cannot show a flight-level arrangement.`);
    }
    // It must NOT have been deleted - the object page's station block is
    // package D's decision that both axes always render.
    assert.ok(/AnnotationPath="station_default\/@UI.LineItem#StationBlock"/.test(blk),
      'the station block facet has gone from the object page. The station default is not WRONG, '
    + 'it is not the ANSWER - it belongs on the page, labelled, beside the flight block.');
    out('filter and column bind designated/supplier_name; station_default off both, still on the object page');
  });

  it('EXIT-2  AT MOST ONE ROW PER FLIGHT — what the to-one rests on', async () => {
    const { data } = await test.GET(`${P}/FlightDesignatedSupplier?$top=500&$select=flight_ID`);
    const per = {};
    for (const r of data.value) per[r.flight_ID] = (per[r.flight_ID] || 0) + 1;
    const over = Object.entries(per).filter(([, n]) => n > 1);
    assert.deepStrictEqual(over, [],
      `${over.length} flight(s) have more than one row in FLIGHT_DESIGNATED_SUPPLIER. The to-one `
    + `association would then bind an ARBITRARY one of them and show it as the answer - which is `
    + `D44 arriving through the back door. The view must decline instead.`);
    assert.ok(data.value.length > 0, 'instrument check: the view is empty, so this proves nothing');
    out(`${data.value.length} rows across ${Object.keys(per).length} flights, max 1 per flight`);
  });

  it('EXIT-3  THE INVARIANT — agrees with the resolver, or says nothing', async () => {
    const { data } = await test.GET(`${P}/FlightSchedule?$top=100&$orderby=flight_number`
      + `&$select=flight_number&$expand=designated($select=supplier_name,axis)`);
    let agreed = 0, abstained = 0;
    for (const f of flights) {
      const row = data.value.find(x => x.flight_number === f.flight_number
        && x.ID === f.ID) || data.value.find(x => x.flight_number === f.flight_number);
      const shown = row && row.designated ? row.designated.supplier_name : null;
      const t = await truthFor(f);
      if (shown === null) { abstained++; continue; }
      assert.strictEqual(shown, t.name,
        `${f.flight_number}: the column shows "${shown}" and resolveDesignation() says "${t.name}". `
      + `The view may ABSTAIN, it may never DISAGREE - a blank is recoverable because somebody asks `
      + `why, and a confident wrong answer is not.`);
      assert.strictEqual(row.designated.axis, t.axis,
        `${f.flight_number}: the column says the ${row.designated.axis} axis answered, `
      + `the resolver says ${t.axis}.`);
      agreed++;
    }
    assert.ok(agreed > 0, 'instrument check: the column shows nothing anywhere, so nothing was compared');
    out(`${agreed} flights agree with resolveDesignation() on name AND axis, ${abstained} show nothing`);
  });

  it('EXIT-4  the DECLINE arm — unexercised by data, proved by a plant', async () => {
    // Specificity-then-priority lives in ONE place, parameter-store's
    // inScope(). The view does not reproduce it, so where two rows compete at
    // the SAME axis it must emit nothing rather than choose.
    //
    // NO SEEDED FLIGHT REACHES THIS. Said plainly rather than left to read as
    // coverage - the shape carrier scoping and rung 5 already use. The plant
    // below is the only thing that has ever exercised it.
    for (const f of flights) {
      const t = await truthFor(f);
      assert.ok(t.candidates <= 1,
        `${f.flight_number} now has ${t.candidates} rows competing at the answering rung. The decline `
      + `arm is LIVE in the seed - replace this criterion with one that asserts the column is blank `
      + `there and says why, because a planner meeting that blank needs to be told it is ambiguity `
      + `rather than absence.`);
    }

    const { INSERT, DELETE, SELECT } = cds.ql;
    const PLANT = '11111111-2222-3333-4444-555555555555';
    // AC901 resolves on the STATION axis at YYZ. A second YYZ station row is a
    // same-axis tie: the resolver separates them by priority, the view cannot.
    const before = await cds.db.run(SELECT.from('fuelsphere.FLIGHT_DESIGNATED_SUPPLIER')
      .where({ flight_ID: flights.find(f => f.flight_number === 'AC901').ID }));
    assert.strictEqual(before.length, 1,
      'PLANT ANCHOR: AC901 does not resolve to one row before the plant, so the plant proves nothing');

    try {
      await cds.db.run(INSERT.into('fuelsphere.DESIGNATED_SUPPLIERS').entries({
        ID: PLANT, flight_number: null, station_code: 'YYZ', carrier_code: 'AC',
        supplier_ID: byName['Air Total International'], designation_type: 'PRIMARY',
        priority: 50, is_active: true, valid_from: '2026-01-01', valid_to: null,
        supplier_performs_uplift: false }));

      const after = await cds.db.run(SELECT.from('fuelsphere.FLIGHT_DESIGNATED_SUPPLIER')
        .where({ flight_ID: flights.find(f => f.flight_number === 'AC901').ID }));
      assert.strictEqual(after.length, 0,
        `with two YYZ station rows in scope the view returned ${after.length} row(s) for AC901. It must `
      + `return NONE: picking between them needs specificity-then-priority, which lives in `
      + `parameter-store and must not be reimplemented in SQL.`);

      const t = await truthFor(flights.find(f => f.flight_number === 'AC901'));
      assert.strictEqual(t.candidates, 2, 'the plant did not create the tie it was meant to');
      assert.strictEqual(t.name, 'Air Total International',
        'the resolver should still answer, by priority 50 over 100');
      out(`plant: AC901 view rows 1 -> 0 (declines), resolver still answers `
        + `"${t.name}" from ${t.candidates} candidates by priority`);
    } finally {
      await cds.db.run(DELETE.from('fuelsphere.DESIGNATED_SUPPLIERS').where({ ID: PLANT }));
    }
  });

  it('EXIT-5  THE AXIS IS LOAD-BEARING — and priority DISAGREES with it', async () => {
    // ONE NUMBER PROVES NOTHING; TWO THAT DISAGREE PROVE THE RULE. That is the
    // recorded lesson from e-effective-dating EXIT-4, which "proved" specificity
    // beat priority using a pair where the two AGREED.
    //
    // AC410's flight row is priority 10 against a station row at 100 - axis and
    // priority agree, and it would pass with the ordering either way round.
    // AC102's flight row is priority 900 against a station row at 100. Flight
    // still wins. THAT is the pair that proves it.
    const { SELECT } = cds.ql;
    const rows = await cds.db.run(SELECT.from('fuelsphere.DESIGNATED_SUPPLIERS')
      .where({ station_code: 'LHR' }));
    const fl = rows.find(r => r.flight_number === 'AC102');
    const st = rows.find(r => r.flight_number === null);
    assert.ok(fl && st, 'ANCHOR: LHR no longer carries both a flight row and a station row');
    assert.ok(fl.priority > st.priority,
      `AC102's flight row is priority ${fl.priority} and LHR's station row is ${st.priority}. This `
    + `criterion needs them to DISAGREE - with the flight row also winning on priority it would pass `
    + `whichever rule the view applied, and prove nothing. Re-seed the conflict or find another pair.`);

    const f = flights.find(x => x.flight_number === 'AC102');
    const { data } = await test.GET(`${P}/FlightSchedule(${f.ID})`
      + `?$select=flight_number&$expand=designated($select=supplier_name,axis,priority)`);
    assert.strictEqual(data.designated.axis, 'FLIGHT',
      'the station row won on AC102, so the view is ordering by priority rather than by axis');
    assert.strictEqual(data.designated.supplier_name, sup[fl.supplier_ID]);
    out(`AC102: flight row priority ${fl.priority} BEATS station row priority ${st.priority} `
      + `-> ${data.designated.supplier_name} (${data.designated.axis}). Priority alone would pick `
      + `${sup[st.supplier_ID]}.`);
  });

  it('EXIT-6  the filter returns the RIGHT flights, and the old one did not', async () => {
    const get = async (path, name) => {
      const { data } = await test.GET(`${P}/FlightSchedule?$select=flight_number`
        + `&$filter=${path} eq '${name}'&$orderby=flight_number`);
      return data.value.map(r => r.flight_number);
    };
    const newAT  = await get('designated/supplier_name', 'Air Total International');
    const newBP  = await get('designated/supplier_name', 'BP Aviation United Kingdom');
    const oldAT  = await get('station_default/supplier/supplier_name', 'Air Total International');
    const oldBP  = await get('station_default/supplier/supplier_name', 'BP Aviation United Kingdom');

    assert.ok(newAT.includes('AC102'),
      'filtering for Air Total does not return AC102, whose designated supplier IS Air Total');
    assert.ok(!newBP.includes('AC102'),
      'filtering for BP still returns AC102. BP is what LHR does by default; AC102 has its own '
    + 'arrangement, so it is not BP\'s flight.');

    // THE OLD BINDING, ASSERTED AS WRONG. Not decoration: the day somebody
    // rebinds the filter to station_default this fails and names the row.
    assert.ok(!oldAT.includes('AC102'),
      'the station_default filter now returns AC102 for Air Total - if that is because the DATA '
    + 'changed, this contrast no longer demonstrates anything and needs re-deriving');
    assert.ok(oldBP.includes('AC102'),
      'the station_default filter no longer returns AC102 for BP - the same caveat');
    out(`designated:      Air Total -> ${newAT.join(', ')} | BP -> ${newBP.join(', ') || '(none)'}`);
    out(`station_default: Air Total -> ${oldAT.join(', ')} | BP -> ${oldBP.join(', ')}  <- MISSES AC102, and RETURNS it under BP`);
  });

  it('EXIT-7  ADDRESSABLE, and the filter carries a LABEL', async () => {
    // D47's third fact: an auto-exposed entity is navigable and NOT
    // addressable - 405, rendering empty with no error a viewer can see. The
    // filter bar addresses this set.
    const { status, data } = await test.GET(`${P}/FlightDesignatedSupplier?$top=1`);
    assert.strictEqual(status, 200,
      `the entity set returns ${status}. A filter bar addressing it would render empty and silent.`);
    assert.ok(data.value.length, 'addressable and empty');

    // A filter field has ONLY the property's label - no inline Label renders
    // there - so a property with none shows its technical name.
    const blk = edmx.match(
      /<Annotations Target="PlanningService\.FlightDesignatedSupplier\/supplier_name">([\s\S]*?)<\/Annotations>/);
    assert.ok(blk, 'supplier_name carries no annotations, so the filter renders as "supplier_name"');
    assert.ok(/Term="Common.Label" String="Designated Supplier"/.test(blk[1]),
      'supplier_name has no Common.Label - SelectionFields cannot carry an inline one');
    assert.ok(/Term="Common.QuickInfo"/.test(blk[1]),
      '"why is this blank" is asked while looking at the blank, so the explanation goes on the field');
    out('entity set 200 and addressable; supplier_name carries a label and a QuickInfo');
  });
});

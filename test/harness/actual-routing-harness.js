/**
 * ACTUAL ROUTING ON THE FLIGHT SCHEDULE OBJECT PAGE.
 *
 * Ajesh reported the fields blank. THE BLANK IS CORRECT — no actual_* routing
 * column exists in the seed at all, so there is nothing to show. What was
 * wrong is what would have happened the day something DID arrive.
 *
 *   EXIT-1  ONE field group, not two, and the facet reaches it
 *   EXIT-2  NO UUID is bound — the resolved value a reader wants is a CODE
 *   EXIT-3  BOTH forms stay: as-received and resolved are different facts
 *   EXIT-4  routing_status NEVER claims AS_PLANNED from an absence
 *   EXIT-5  every flight reads NOT_RECORDED today — and three arms are
 *           UNEXERCISED BY DATA, proved reachable by plants rather than rows
 *   EXIT-6  the status is FILTERABLE, which a virtual element would not be
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert'); const fs=require('node:fs');
const test=cds.test(PROJECT); const out=s=>process.stdout.write('      '+s+'\n');
const P='/odata/v4/planning';

describe('Actual routing', () => {

  let edmx, blk;
  before(() => {
    edmx = cds.compile.to.edmx(cds.model, { service:'PlanningService', version:'v4' });
    blk = /<Annotations Target="PlanningService\.FlightSchedule">([\s\S]*?)<\/Annotations>/.exec(edmx)[1];
  });
  const group = (q) => {
    const m = new RegExp(`<Annotation Term="UI.FieldGroup" Qualifier="${q}">[\\s\\S]*?</Annotation>`).exec(blk);
    return m ? m[0] : null;
  };
  const paths = (g) => [...g.matchAll(/Path="([^"]*)"/g)].map(x=>x[1]);

  it('EXIT-1  ONE field group for actual routing, and the facet reaches it', () => {
    // TWO EXISTED AND THE ONE THAT RENDERED WAS THE WRONG ONE. #ActualStations
    // bound the readable form and NO FACET REFERENCED IT; #ActualRouting was
    // on the page and bound the UUIDs. Both resolved, so no dangling sweep
    // would have said anything, and the data is null everywhere so nothing
    // rendered either way - there was no symptom to notice.
    assert.ok(group('ActualRouting'), '#ActualRouting is gone');
    assert.strictEqual(group('ActualStations'), null,
      '#ActualStations is back. Two field groups for one thing means one of them is on the page and '
    + 'the other is not, and nothing on either says which.');
    assert.ok(/AnnotationPath="@UI.FieldGroup#ActualRouting"/.test(blk),
      'no facet references #ActualRouting, so the whole section is off the object page');
    assert.strictEqual(/AnnotationPath="@UI.FieldGroup#ActualStations"/.test(blk), false);
    out('one group, referenced by a facet; #ActualStations folded in and gone');
  });

  it('EXIT-2  NO UUID is bound — a GUID is not an airport', () => {
    // actual_origin_ID was bound and LABELLED "Actual Origin (resolved)". It
    // resolves, so it is not D50's class; it renders a generated key where a
    // station belongs, and only the day a diversion arrives.
    const bad = paths(group('ActualRouting')).filter(p => /_ID$/.test(p.split('/').pop()));
    assert.deepStrictEqual(bad, [],
      `the actual-routing group binds a generated foreign key: ${bad.join(', ')}. It resolves, so no `
    + `sweep flags it - and it renders a UUID. The resolved value a reader wants is the airport CODE.`);
    // THE INSTRUMENT CHECK HERE WAS VACUOUS AND SAID SO IN ITS OWN OUTPUT:
    // "0 foreign keys in the group (0 bound elsewhere, so the reader does
    // find them)". Zero and zero — it would have read identically with a
    // broken regex, and it ASSERTED the reader worked while proving nothing.
    //
    // Proved against a KNOWN-PRESENT and a KNOWN-ABSENT string instead, which
    // is the recorded rule and costs two lines.
    const fkIn = (xml) => [...xml.matchAll(/Path="([^"]*)"/g)].map(x=>x[1])
      .filter(p => /_ID$/.test(p.split('/').pop()));
    assert.deepStrictEqual(fkIn('<a Path="actual_origin_ID"/><a Path="flight_number"/>'),
      ['actual_origin_ID'],
      'instrument check: the foreign-key reader does not find a known-present _ID, so its silence '
    + 'on the real group means nothing');
    assert.deepStrictEqual(fkIn('<a Path="actual_origin_airport"/>'), [],
      'instrument check: the reader reports a foreign key where there is none');
    const shown = paths(group('ActualRouting'));
    assert.ok(shown.length >= 5, `only ${shown.length} paths read from the group - the extractor is blind`);
    out(`${shown.length} paths read, 0 are foreign keys; reader proved on a known-present and a known-absent`);
  });

  it('EXIT-3  BOTH forms stay — as-received and resolved are different facts', () => {
    // WP-07B's convention, and it is not redundancy. A diversion airport may
    // not be in the register at all, so as-received can be a perfectly good
    // code while resolved is null. A screen showing only the resolved form
    // would report that diversion as NO diversion.
    const p = paths(group('ActualRouting'));
    for (const f of ['actual_origin_airport','actual_destination_airport'])
      assert.ok(p.includes(f), `the as-RECEIVED ${f} is not on the page`);
    for (const f of ['actual_origin/iata_code','actual_destination/iata_code'])
      assert.ok(p.includes(f), `the RESOLVED ${f} is not on the page`);
    out(`${p.length} fields: status, both as-received codes, both resolved codes`);
  });

  it('EXIT-4  routing_status NEVER claims AS_PLANNED from an absence', async () => {
    // THE SCHEMA FORBIDS THE ASSUMPTION IN SO MANY WORDS: "SEMANTICS OF NULL
    // ARE OPEN - it may mean 'no deviation' or 'the feed did not say'. Those
    // are different facts and nothing should assume one."
    //
    // Four blank rows on a page headed "Actual Routing" invite exactly that
    // reading. NOT_RECORDED says what is true instead.
    //
    // Planted rather than read, because the failure this guards is a
    // COMPUTATION choosing the wrong branch, and reading the CASE tells you
    // what you already believe.
    const { UPDATE, SELECT } = cds.ql;
    const f = (await cds.db.run(SELECT.from('fuelsphere.FLIGHT_SCHEDULE')
      .columns('ID','flight_number','origin_airport','destination_airport')
      .where({ flight_number: 'AC101' })))[0];
    assert.ok(f && f.origin_airport && f.destination_airport,
      'PLANT ANCHOR: AC101 has no planned origin/destination, so no comparison is possible');

    const read = async () => (await test.GET(
      `${P}/FlightSchedule(${f.ID})?$select=routing_status`)).data.routing_status;
    const set = (o,d) => cds.db.run(UPDATE('fuelsphere.FLIGHT_SCHEDULE').set({
      actual_origin_airport: o, actual_destination_airport: d }).where({ ID: f.ID }));

    try {
      assert.strictEqual(await read(), 'NOT_RECORDED', 'AC101 does not start blank');

      await set(f.origin_airport, f.destination_airport);
      assert.strictEqual(await read(), 'AS_PLANNED',
        'both recorded and both matching must read AS_PLANNED');

      await set('YUL', f.destination_airport);
      assert.strictEqual(await read(), 'DEVIATION',
        'an actual origin differing from the planned one must read DEVIATION');

      // THE ARM THAT MATTERS. One recorded, one not: coalescing the missing
      // half to the planned value would say AS_PLANNED, which asserts "no
      // deviation" from "did not say" - the forbidden assumption wearing
      // arithmetic.
      await set(f.origin_airport, null);
      assert.strictEqual(await read(), 'PARTIALLY_RECORDED',
        'ONE station recorded and the other absent read as a settled answer. No comparison is '
      + 'possible there, and defaulting the missing half to the planned value asserts exactly what '
      + 'the schema says must not be assumed.');

      await set(null, f.destination_airport);
      assert.strictEqual(await read(), 'PARTIALLY_RECORDED', 'the other half of the partial case');

      out('four states proved on AC101: NOT_RECORDED, AS_PLANNED, DEVIATION, PARTIALLY_RECORDED (both halves)');
    } finally {
      await set(null, null);
      assert.strictEqual(await read(), 'NOT_RECORDED', 'the plant did not clean up');
    }
  });

  it('EXIT-5  every flight reads NOT_RECORDED — three arms UNEXERCISED BY DATA', async () => {
    // Said plainly rather than left to read as coverage. Only NOT_RECORDED is
    // reached by any seeded row; EXIT-4's plants are the only thing that has
    // ever exercised the other three.
    //
    // SELF-INVALIDATING: the day a real deviation is recorded this fails and
    // asks for a criterion that tests the value rather than its absence.
    const { data } = await test.GET(`${P}/FlightSchedule?$top=200`
      + `&$select=flight_number,routing_status,actual_origin_airport,actual_destination_airport`);
    assert.ok(data.value.length, 'no flights at all');
    const other = data.value.filter(r => r.routing_status !== 'NOT_RECORDED');
    assert.deepStrictEqual(other.map(r => `${r.flight_number}:${r.routing_status}`), [],
      `${other.length} flight(s) now carry actual routing. If it is REAL, replace this criterion with `
    + `one that tests the comparison — and check the seed says where it came from, because a diversion `
    + `is a fact somebody recorded. If it was invented to fill the section, that is what this catches.`);

    // AND THE COLUMN IS GENUINELY ABSENT FROM THE SEED, not merely empty.
    const hdr = fs.readFileSync(`${PROJECT}/db/data/fuelsphere-FLIGHT_SCHEDULE.csv`,'utf8')
      .split('\n')[0].split(';');
    const cols = hdr.filter(h => /^actual_(origin|destination)/.test(h));
    assert.deepStrictEqual(cols, [],
      `the seed now has ${cols.join(', ')}. A column that exists and is empty is a different state `
    + `from one that was never there, and this criterion should say which.`);
    out(`${data.value.length}/${data.value.length} NOT_RECORDED; no actual_origin/destination column `
      + `in the seed at all, so the blank is the data rather than the binding`);
  });

  it('EXIT-6  the status is FILTERABLE — a virtual element would not be', async () => {
    // D52: $filter runs in the database before an after-READ handler ever sees
    // the row, so a virtual status can be displayed and never queried. "Show
    // me the flights that deviated" is the only reason this field exists.
    const { data } = await test.GET(`${P}/FlightSchedule?$select=flight_number`
      + `&$filter=routing_status eq 'NOT_RECORDED'&$top=100`);
    assert.ok(data.value.length > 0, 'the filter returns nothing, so it is not filterable');
    const { data: none } = await test.GET(`${P}/FlightSchedule?$select=flight_number`
      + `&$filter=routing_status eq 'DEVIATION'&$top=5`);
    assert.strictEqual(none.value.length, 0,
      'filtering for DEVIATION returns rows while EXIT-5 says none exist - one of the two is wrong');
    out(`$filter on routing_status serves: NOT_RECORDED ${data.value.length}, DEVIATION ${none.value.length}`);
  });
});

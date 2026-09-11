/**
 * THE TWO DESIGNATION BLOCKS SAY WHY THEY ARE EMPTY.
 *
 * Ajesh reported "Designated for this flight" blank on AC412. IT IS CORRECT:
 * two of twenty-two flights carry a flight-level designation and AC412 is not
 * one. The other twelve resolve to the station default in the block beneath.
 *
 * BUT THE BLANK SAID NOTHING, and a viewer cannot tell "no specific
 * arrangement exists" from "nobody filled it in". That distinction has now
 * been the fix FOUR times - NOT_APPLICABLE versus none-recorded on the
 * contacts strip, NOT_RECORDED versus AS_PLANNED on actual routing, and both
 * blocks here - and every time by DERIVING the common case rather than
 * rendering an absence.
 *
 *   EXIT-1  THREE states, not two, and each is a different sentence
 *   EXIT-2  the state AGREES with what the blocks actually render
 *   EXIT-3  NEITHER note is ever blank — an empty note is the bug returning
 *   EXIT-4  THE WORST CASE: 8 rows have NEITHER block and BOTH now explain it
 *   EXIT-5  both sections carry the note INSIDE them, above the rows
 *   EXIT-6  derived, never stored, and FILTERABLE
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert');
const test=cds.test(PROJECT); const out=s=>process.stdout.write('      '+s+'\n');
const P='/odata/v4/planning';
const SEL='flight_number,origin_airport,designation_state,'
        + 'flight_designation_note,station_designation_note';

describe('Designation states', () => {

  let rows, edmx, blk;
  before(async () => {
    const { data } = await test.GET(`${P}/FlightSchedule?$top=200&$orderby=flight_number`
      + `&$select=${SEL}&$expand=designation($select=ID),station_default($select=ID)`);
    rows = data.value;
    edmx = cds.compile.to.edmx(cds.model, { service:'PlanningService', version:'v4' });
    blk = /<Annotations Target="PlanningService\.FlightSchedule">([\s\S]*?)<\/Annotations>/.exec(edmx)[1];
  });

  it('EXIT-1  THREE states, not two, and each is a different sentence', () => {
    const seen = {};
    for (const r of rows) (seen[r.designation_state] ||= new Set()).add(r.flight_designation_note);
    for (const s of ['FLIGHT','STATION_DEFAULT','NONE'])
      assert.ok(seen[s], `no flight is in state ${s}, so that arm is untested by data`);
    // EACH STATE MUST READ DIFFERENTLY. Two states sharing a sentence is the
    // bug in a new dress: the viewer still cannot tell them apart.
    const sentences = Object.entries(seen).map(([s, set]) => {
      assert.strictEqual(set.size, 1, `${s} produces ${set.size} different sentences`);
      return [s, [...set][0]];
    });
    const texts = sentences.map(([,t]) => t);
    assert.strictEqual(new Set(texts).size, texts.length,
      `two states share a sentence, so the page still cannot tell them apart:\n  `
    + sentences.map(([s,t]) => `${s}: ${t}`).join('\n  '));
    out(sentences.map(([s]) => `${s}:${seen[s] && rows.filter(r=>r.designation_state===s).length}`).join('  '));
  });

  it('EXIT-2  the state AGREES with what the blocks actually render', () => {
    // DERIVED FROM THE SAME SOURCE THE BLOCKS ARE, which is the point: the
    // note describes what is on the screen beneath it, so it cannot drift
    // from it. Resolving through FLIGHT_DESIGNATED_SUPPLIER instead would
    // have been wrong here - that view DECLINES on an ambiguous designation,
    // and "declined" would have rendered as "no designation exists".
    for (const r of rows) {
      const fb = (r.designation||[]).length, sb = (r.station_default||[]).length;
      const want = fb ? 'FLIGHT' : (sb ? 'STATION_DEFAULT' : 'NONE');
      assert.strictEqual(r.designation_state, want,
        `${r.flight_number}: the page says ${r.designation_state} while the blocks render `
      + `${fb} flight row(s) and ${sb} station row(s). The sentence must describe what is beneath it.`);
    }
    out(`${rows.length} flights, 0 where the sentence disagrees with the blocks below it`);
  });

  it('EXIT-2b  and the SOURCE CHOICE is provable, not just asserted', async () => {
    // A PLANT THAT DID NOT FIRE IS WHY THIS EXISTS. Re-sourcing
    // designation_state from FLIGHT_DESIGNATED_SUPPLIER instead of the two
    // associations left all six criteria GREEN — because the two sources
    // agree on every seeded flight, and the condition that separates them
    // (two designations competing at one axis) exists in no row.
    //
    // So the comment beside the CASE claimed a design decision mattered and
    // NOTHING PROVED IT. Constructing the condition is what proves it: with a
    // tie in place the view DECLINES and would report NONE, while the blocks
    // still render rows and the page must still say STATION_DEFAULT.
    //
    // "No designation exists" and "I cannot tell you which" are different
    // facts, and only one of them is true there.
    const { SELECT, INSERT, DELETE } = cds.ql;
    const PLANT = '22222222-3333-4444-5555-666666666666';
    const f = (await cds.db.run(SELECT.from('fuelsphere.FLIGHT_SCHEDULE')
      .columns('ID','flight_number').where({ flight_number: 'AC901' })))[0];
    assert.ok(f, 'PLANT ANCHOR: AC901 is gone from the seed');
    const sup = (await cds.db.run(SELECT.from('fuelsphere.MASTER_SUPPLIERS')
      .columns('ID','supplier_name')))
      .find(x => x.supplier_name === 'Air Total International');
    assert.ok(sup, 'PLANT ANCHOR: Air Total International is gone from the seed');

    const read = async () => (await test.GET(
      `${P}/FlightSchedule(${f.ID})?$select=designation_state`
      + `&$expand=designated($select=supplier_name)`)).data;

    const before = await read();
    assert.strictEqual(before.designation_state, 'STATION_DEFAULT',
      'PLANT ANCHOR: AC901 does not start on the station default');
    assert.ok(before.designated, 'PLANT ANCHOR: AC901 does not resolve before the plant');

    try {
      await cds.db.run(INSERT.into('fuelsphere.DESIGNATED_SUPPLIERS').entries({
        ID: PLANT, flight_number: null, station_code: 'YYZ', carrier_code: 'AC',
        supplier_ID: sup.ID, designation_type: 'PRIMARY', priority: 50,
        is_active: true, valid_from: '2026-01-01', valid_to: null,
        supplier_performs_uplift: false }));

      const after = await read();
      assert.strictEqual(after.designated, null,
        'the resolved view no longer declines on a same-axis tie, so the two sources cannot be '
      + 'told apart and this criterion proves nothing. Re-derive it.');
      assert.strictEqual(after.designation_state, 'STATION_DEFAULT',
        `with two YYZ defaults in scope the page says ${after.designation_state}. The blocks still `
      + `render rows, so the sentence must still say the station default answers - a state sourced `
      + `from the resolved view would say NONE here, which claims no designation exists when two do.`);
      out('with a same-axis tie planted: the resolved view declines (null) and the page still '
        + 'reads STATION_DEFAULT — the two sources diverge, and the blocks are the right one');
    } finally {
      await cds.db.run(DELETE.from('fuelsphere.DESIGNATED_SUPPLIERS').where({ ID: PLANT }));
      assert.strictEqual((await read()).designation_state, 'STATION_DEFAULT',
        'the plant did not clean up');
    }
  });

  it('EXIT-3  NEITHER note is ever blank — an empty note is the bug returning', () => {
    const blank = rows.filter(r => !r.flight_designation_note || !r.station_designation_note);
    assert.deepStrictEqual(blank.map(r => r.flight_number), [],
      `${blank.length} flight(s) have a blank note. A blank field under a heading is exactly the `
    + `state this work replaced - it says nothing, and the viewer is back to guessing.`);
    out(`${rows.length} flights, both notes populated on every one`);
  });

  it('EXIT-4  THE WORST CASE — NEITHER block, and BOTH now explain it', () => {
    // 8 rows (7 distinct flight numbers - PR1041 is two legs) depart stations
    // with no designation at all. TODAY THOSE PAGES SHOWED TWO EMPTY TABLES
    // AND NO REASON, which reads as two failures rather than one deliberate
    // absence. It is rung 3 of designation-resolver.js made visible.
    const none = rows.filter(r => r.designation_state === 'NONE');
    assert.ok(none.length > 0,
      'no flight is in the NONE state any more. If designations were added, replace this criterion '
    + 'with one that tests them; if the state was removed, the worst case is unexplained again.');
    for (const r of none) {
      assert.strictEqual((r.designation||[]).length, 0);
      assert.strictEqual((r.station_default||[]).length, 0);
      // BOTH sentences, not one. Explaining the flight block and leaving the
      // station block bare turns two empty blocks into one empty block and
      // one explained one, which is not better.
      assert.ok(/No designation/.test(r.flight_designation_note),
        `${r.flight_number}: the flight block does not say there is no designation`);
      assert.ok(/No default supplier is designated at/.test(r.station_designation_note),
        `${r.flight_number}: the STATION block is still bare. Both blocks are empty on this flight, `
      + `so both need a sentence or the page still shows an unexplained gap.`);
      assert.ok(r.station_designation_note.includes(r.origin_airport),
        `${r.flight_number}: the station sentence does not name ${r.origin_airport}, so a viewer `
      + `cannot tell which station has no default`);
    }
    const distinct = new Set(none.map(r => r.flight_number));
    out(`${none.length} rows / ${distinct.size} distinct flights with NEITHER block — `
      + `both sentences present on every one, each naming its station`);
  });

  it('EXIT-5  both sections carry the note INSIDE them, above the rows', () => {
    // A LineItem over a to-many is a table, and no field can be added to it -
    // so the sentence needs its own field group under the SAME heading. A
    // separate section beside the block would read as a third thing.
    for (const [id, note, block] of [
      ['DesignatedForThisFlight','FlightDesignationNote','FlightBlock'],
      ['StationDefault','StationDesignationNote','StationBlock']]) {
      const m = new RegExp(`<PropertyValue Property="ID" String="${id}"/>[\\s\\S]{0,1500}`).exec(blk);
      assert.ok(m, `the ${id} facet is gone`);
      const iNote = m[0].indexOf(`@UI.FieldGroup#${note}`);
      const iRows = m[0].indexOf(`@UI.LineItem#${block}`);
      assert.ok(iNote > -1, `${id} does not carry its sentence`);
      assert.ok(iRows > -1, `${id} no longer carries its rows`);
      assert.ok(iNote < iRows,
        `${id} shows the rows before the sentence. The statement has to come first, or a viewer `
      + `meets the empty table before the reason for it.`);
    }
    out('both sections: sentence first, then the rows');
  });

  it('EXIT-6  derived, never stored, and FILTERABLE', async () => {
    // The view already knows the condition; a stored column would be a second
    // place holding one fact and would need maintaining. And calculated
    // rather than virtual so "which flights have no designation at all" is
    // answerable - $filter runs in the database before an after-READ handler
    // sees the row (D52).
    const m = cds.linked(cds.compile.for.nodejs(await cds.load(`${PROJECT}/db`))).definitions;
    const els = Object.keys(m['fuelsphere.FLIGHT_SCHEDULE'].elements);
    const stored = els.filter(k => /designation_state|designation_note/.test(k));
    assert.deepStrictEqual(stored, [],
      `FLIGHT_SCHEDULE stores ${stored.join(', ')}. The condition is derivable from the two `
    + `associations the blocks already render, so a stored column is a second place holding one fact.`);
    const { data } = await test.GET(`${P}/FlightSchedule?$select=flight_number`
      + `&$filter=designation_state eq 'NONE'&$orderby=flight_number`);
    assert.strictEqual(data.value.length, rows.filter(r=>r.designation_state==='NONE').length,
      'filtering on designation_state does not return what reading it says');
    out(`nothing stored on FLIGHT_SCHEDULE; $filter eq 'NONE' -> ${data.value.length} rows`);
  });
});

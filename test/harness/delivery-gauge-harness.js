/**
 * THE GAUGE READINGS ON THE DELIVERY PAGE A FLIGHT REACHES.
 *
 * THREE ROUTES TO ONE SUBJECT, AND THE ONE WITH THE GROUP WAS NOT THE ONE
 * ANYBODY WAS LOOKING AT. Measured before building:
 *
 *   PlanningService.FLIGHT_FUEL_DELIVERIES   19 props, object page with three
 *     field groups. FLIGHT_SCHEDULE.deliveries points HERE, so the flight
 *     object page's Deliveries facet lands here and nowhere else. It carried
 *     the VERDICT and none of the readings the verdict comes from.
 *   PlanningService.FuelDeliveries           52 props, carries everything,
 *     one card LineItem and NO facets. Nothing navigates to it.
 *   FuelOrderService.FuelDeliveries          53 props, and a full
 *     #AircraftGauge field group ON A FACET, complete, for some time - in a
 *     DIFFERENT APP, bound to /odata/v4/orders/.
 *
 * So the fields were not missing anywhere; they were missing HERE. And the
 * narrow view's own comment explains why: "the delivery's own object page
 * already shows everything; this answers one question and stops." That page
 * is the third route. THE NARROWING WAS JUSTIFIED BY A PAGE THE READER
 * CANNOT REACH FROM WHERE THEY ARE STANDING - true as written, and false as
 * applied, which is the shape that leaves a section thin without anyone
 * having decided it should be.
 *
 *   EXIT-1  all nine bind THROUGH FlightSchedule/deliveries - the actual
 *           navigation, not the entity set
 *   EXIT-2  no field sits in two field groups on this entity
 *   EXIT-3  the chain is in the order the two subtractions read
 *   EXIT-4  every mass carries a (kg) LABEL and no @Measures.Unit
 *   EXIT-5  fob_source distinguishes NONE from agreement, and the data
 *           backs the claim: NONE rows carry a BLANK variance, not zero
 *   EXIT-6  ONE OF THE TWO RULES IS A TAUTOLOGY, asserted as one - and the
 *           other family that would break it has NO DATA, so this
 *           self-invalidates the day one arrives
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const test = cds.test(PROJECT);
const out = s => process.stdout.write('      ' + s + '\n');
const P = '/odata/v4/planning';
const E = 'PlanningService.FLIGHT_FUEL_DELIVERIES';

// The chain, in the order the two subtractions read. Duplicated here on
// purpose: EXIT-3 compares the ANNOTATION against this list, so the list is
// the criterion's own statement of intent rather than a read of the file.
const CHAIN = ['fob_at_arrival_kg', 'ground_burn_kg', 'fob_before_kg',
               'fob_after_kg', 'fob_delta_kg', 'fob_source'];
const WINDOW = ['refuel_start_utc', 'refuel_end_utc', 'refuel_complete'];
const MASSES = ['fob_at_arrival_kg', 'ground_burn_kg', 'fob_before_kg',
                'fob_after_kg', 'fob_delta_kg'];

const call = async f => {
    try { const r = await f(); return { status: r.status, data: r.data }; }
    catch (e) { return { status: e.response?.status || e.status, msg: e.response?.data?.error?.message || e.message }; }
};

let edmx;
const block = target => {
    const i = edmx.indexOf(`<Annotations Target="${target}">`);
    if (i < 0) return '';
    return edmx.slice(i, edmx.indexOf('</Annotations>', i));
};

// FORM-AGNOSTIC ON THE TERM NAME, AND THIS READER'S FIRST VERSION WAS NOT.
//
// It searched `Term="com.sap.vocabularies.UI.v1.FieldGroup"` - the
// fully-qualified name - and found ZERO of everything, because this EDMX
// emits the ALIASED form: Term="UI.FieldGroup", Term="Common.Label",
// Term="Common.QuickInfo". Four criteria failed against annotations that
// were present and correct.
//
// That is the one-form search, written INTO A CRITERION by someone who had
// recorded the trap the same week. The lesson that actually transfers is
// not "remember the alias" - it is that a reader must be PROVED against a
// known-present and a known-absent string before its output means anything,
// which EXIT-2 now does before using it.
const term = name => `Term="(?:[\\w.]*\\.)?${name}"`;
const VALUE_PATH = /Property="Value"\s+Path="([^"]+)"/g;
const stringOf = (blk, name) => {
    const m = blk.match(new RegExp(term(name) + '\\s+String="([^"]*)"'));
    return m ? m[1] : null;
};

describe('The gauge readings on the delivery page a flight reaches', function () {
    this.timeout(120000);

    before(async () => { edmx = String((await call(() => test.GET(`${P}/$metadata`))).data); });

    // -------------------------------------------------------------- EXIT-1 --
    // THROUGH THE NAVIGATION, NOT THE ENTITY SET. Reading
    // /FLIGHT_FUEL_DELIVERIES proves the view carries the columns; it does
    // NOT prove the flight object page can reach them, and those are
    // different questions - D47 is an entity readable by navigation and 405
    // by name, this is the same distinction from the other side. The facet
    // binds `deliveries/@UI.LineItem`, so `deliveries` is what must expand.
    it('EXIT-1  all nine bind through FlightSchedule/deliveries', async () => {
        const fields = [...CHAIN, ...WINDOW];
        const r = await call(() => test.GET(
            `${P}/FlightSchedule?$filter=flight_number eq 'AC410'`
            + `&$select=flight_number&$expand=deliveries($select=${fields.join(',')})`));
        assert.strictEqual(r.status, 200, `the expand failed: ${r.msg}`);
        const rows = r.data.value[0]?.deliveries || [];
        out(`AC410 -> ${rows.length} delivery/deliveries through the navigation`);
        assert.ok(rows.length > 0, 'no delivery reachable from AC410 - the criterion would be vacuous');
        const row = rows[0];
        const missing = fields.filter(f => !(f in row));
        for (const f of fields) out(`  ${f.padEnd(19)} ${row[f] === null ? '(null)' : row[f]}`);
        assert.deepStrictEqual(missing, [], 'field(s) absent from the navigation payload');
    });

    // -------------------------------------------------------------- EXIT-2 --
    // THE DUPLICATED-ANNOTATION PATHOLOGY, IN ITS WORSE FORM. The recorded
    // case is two groups where only ONE is on a facet, so the orphan is
    // invisible. Here every group IS on a facet, so a field in two of them
    // renders TWICE on one page - and nothing looks wrong, which is why it
    // needs a criterion rather than a reading. fob_delta_kg and fob_source
    // were in #DeliveryRecon and MOVED into the chain; restoring either
    // fails this.
    it('EXIT-2  the reader is proved, then no field sits in two field groups', async () => {
        const blk = block(E);
        assert.ok(blk, 'no annotation block for the entity - the reader found nothing');

        // PROVE THE READER FIRST, against literal strings rather than against
        // the model. A control that depends on the EDMX containing a
        // known-absent term expires the day somebody adds it.
        const present = '<Annotation Term="UI.FieldGroup" Qualifier="Probe">'
            + '<Record><PropertyValue Property="Value" Path="probe_field"/></Record></Annotation>';
        const absentForm = '<Annotation Term="UI.NotATerm" Qualifier="Probe"/>';
        assert.ok(new RegExp(term('FieldGroup')).test(present),
            'the reader cannot find an aliased FieldGroup term - it is looking for the wrong form');
        assert.ok(new RegExp(term('FieldGroup')).test(
            '<Annotation Term="com.sap.vocabularies.UI.v1.FieldGroup"/>'),
            'the reader cannot find a fully-qualified FieldGroup term');
        assert.ok(!new RegExp(term('FieldGroup')).test(absentForm),
            'the reader matches a term that is not FieldGroup');
        out('  reader proved: aliased yes, fully-qualified yes, wrong term no');

        const starts = [];
        const re = new RegExp(term('FieldGroup') + '\\s+Qualifier="([^"]+)"', 'g');
        let m;
        while ((m = re.exec(blk))) starts.push({ q: m[1], at: m.index });
        const groups = {};
        for (let i = 0; i < starts.length; i++) {
            const seg = blk.slice(starts[i].at, i + 1 < starts.length ? starts[i + 1].at : blk.length);
            VALUE_PATH.lastIndex = 0;
            groups[starts[i].q] = [...seg.matchAll(VALUE_PATH)].map(x => x[1]);
        }
        const seen = new Map(), dup = [];
        for (const [q, fields] of Object.entries(groups)) {
            out(`  #${q}: ${fields.join(', ')}`);
            for (const f of fields) {
                if (seen.has(f)) dup.push(`${f} in #${seen.get(f)} AND #${q}`);
                else seen.set(f, q);
            }
        }
        assert.ok('AircraftGauge' in groups, 'no #AircraftGauge group');
        assert.ok('RefuelWindow' in groups, 'no #RefuelWindow group');
        assert.deepStrictEqual(dup, [], 'a field renders twice on one object page');
    });

    // -------------------------------------------------------------- EXIT-3 --
    // ORDER IS THE CONTENT HERE. The group carries two rules and the only
    // thing expressing them is the sequence: arrival and ground burn produce
    // before; after and before produce delta. Reordered, every field is
    // still present and the page says nothing.
    it('EXIT-3  the chain is in the order the two subtractions read', async () => {
        const blk = block(E);
        const i = blk.search(new RegExp(term('FieldGroup') + '\\s+Qualifier="AircraftGauge"'));
        assert.ok(i > 0, 'no #AircraftGauge group in the EDMX');
        const rest = blk.slice(i + 10);
        const nxt = rest.search(new RegExp(term('FieldGroup') + '|' + term('Facets') + '|' + term('LineItem')));
        const seg = blk.slice(i, nxt > 0 ? i + 10 + nxt : blk.length);
        VALUE_PATH.lastIndex = 0;
        const got = [...seg.matchAll(VALUE_PATH)].map(x => x[1]);
        out(`  expected: ${CHAIN.join(' -> ')}`);
        out(`  emitted:  ${got.join(' -> ')}`);
        assert.deepStrictEqual(got, CHAIN, 'the gauge chain is not in the order the subtractions read');
    });

    // -------------------------------------------------------------- EXIT-4 --
    // THE TRAP THIS GROUP IS THE FIRST TO MEET. uom_code on this entity is
    // the unit of the METERED volume - measured LTR on 10 of 26 rows - and
    // an FQIS reports mass unconditionally. A @Measures.Unit here renders a
    // kilogram figure as litres on ten deliveries and correctly on sixteen,
    // which is worse than no unit at all: right on most of the data is
    // indistinguishable from right.
    //
    // BOTH HALVES ASSERTED, because either alone passes vacuously - a field
    // carrying no annotations satisfies "no @Measures.Unit" - AND a control
    // that the one field which SHOULD carry the unit column still does,
    // because otherwise "no @Measures.Unit anywhere" would also pass on a
    // service where units were never wired up at all.
    it('EXIT-4  every mass carries a (kg) label and no @Measures.Unit', async () => {
        const measured = [], titles = {};
        for (const f of MASSES) {
            const blk = block(`${E}/${f}`);
            titles[f] = stringOf(blk, 'Label') || '(no label)';
            if (new RegExp(term('Unit')).test(blk)) measured.push(f);
            out(`  ${f.padEnd(19)} "${titles[f]}"${measured.includes(f) ? '  <- @Measures.Unit' : ''}`);
        }
        const unlabelled = MASSES.filter(f => !/\(kg\)/.test(titles[f]));

        const dqBlk = block(`${E}/delivered_quantity`);
        const dqUnit = new RegExp(term('Unit')).test(dqBlk);
        out(`  control - delivered_quantity keeps its unit column: ${dqUnit}`);

        assert.ok(dqUnit, 'the control failed: delivered_quantity has no unit column, so '
            + '"no @Measures.Unit on the masses" proves nothing about this reader');
        assert.deepStrictEqual(measured, [], 'a mass field points at uom_code - it would render kg as litres');
        assert.deepStrictEqual(unlabelled, [], 'a mass field does not say (kg) in its label');
    });

    // -------------------------------------------------------------- EXIT-5 --
    // THE FIELD CARRIES THE DISTINCTION AND THE DATA HAS TO BACK IT. A
    // QuickInfo saying "NONE means no reading, so the variance is blank
    // rather than zero" is a CLAIM ABOUT THE DATA; if a NONE row ever
    // carried a zero variance the field would be lying on the screen, and
    // a zero reads as agreement.
    it('EXIT-5  fob_source distinguishes NONE from agreement, and the data agrees', async () => {
        const blk = block(`${E}/fob_source`);
        const text = stringOf(blk, 'QuickInfo');
        assert.ok(text, 'fob_source carries no QuickInfo');
        out(`  QuickInfo: ${text.slice(0, 100)}...`);
        assert.ok(/NONE/.test(text), 'the QuickInfo does not name NONE');
        assert.ok(/not agreement|Unknown is not/i.test(text),
            'the QuickInfo does not say that unknown is not agreement');

        const db = await cds.connect.to('db');
        const rows = await db.run(SELECT.from('fuelsphere.FUEL_DELIVERIES')
            .columns('delivery_number', 'fob_source', 'recon_status', 'recon_variance_kg'));
        const none = rows.filter(r => r.fob_source === 'NONE' || r.fob_source === null);
        const zeroed = none.filter(r => r.recon_variance_kg !== null && Number(r.recon_variance_kg) === 0);
        out(`  NONE-source deliveries: ${none.length}/${rows.length}; of those with a ZERO variance: ${zeroed.length}`);
        assert.ok(none.length > 0, 'no NONE-source delivery exists - the claim is untested');
        assert.deepStrictEqual(zeroed.map(r => r.delivery_number), [],
            'a NONE-source delivery carries a zero variance, which reads as agreement');
    });

    // -------------------------------------------------------------- EXIT-6 --
    // ONE OF THE TWO RULES IS NOT A CHECK, AND SAYING SO IS THE POINT.
    //
    // "arrival less ground burn gives the before-reading" reads like
    // something a viewer verifies. On the gauge path ground_burn_kg IS
    // computed as arrival minus before, so the identity holds for ANY
    // inputs and cannot fail - it is the same subtraction rearranged.
    // Asserted against the FUNCTION rather than against the seed, because a
    // seed check only says today's rows are consistent; this says the
    // property is structural, which is what makes it a tautology.
    //
    // HOW IT FAILS: change deriveGaugeFigures so ground_burn is anything
    // other than arrival - before, and the identity breaks - at which point
    // the QuickInfo on the field is wrong and must be rewritten.
    //
    // AND THE SECOND FAMILY HAS NO DATA. On ACARS_DERIVED, ground_burn is
    // the APU total and is an INPUT to the uplift; the identity is false
    // there and fob_before_kg may not exist at all. No seeded delivery
    // carries that source, so that arm is asserted BY CONSTRUCTION only.
    // This criterion says so and FAILS THE DAY ONE ARRIVES, which is when
    // somebody has to test the arm rather than read about it.
    it('EXIT-6  the arrival rule is a tautology on the gauge path, and the other family has no data', async () => {
        const { deriveGaugeFigures } = require(`${PROJECT}/srv/lib/fuel-uom.js`);
        const cases = [
            { fob_at_arrival_kg: 1950, fob_before_kg: 1897.5, fob_after_kg: 4202.5 },
            { fob_at_arrival_kg: 22850, fob_before_kg: 22000, fob_after_kg: 41200 },
            { fob_at_arrival_kg: 7, fob_before_kg: 6.25, fob_after_kg: 9 },
            { fob_at_arrival_kg: 0, fob_before_kg: -13.5, fob_after_kg: 1 }
        ];
        for (const c of cases) {
            const d = deriveGaugeFigures(c);
            const back = Number((Number(c.fob_at_arrival_kg) - Number(d.ground_burn_kg)).toFixed(2));
            out(`  arrival ${c.fob_at_arrival_kg} - ground burn ${d.ground_burn_kg} = ${back}  (before = ${c.fob_before_kg})`);
            assert.strictEqual(back, Number(c.fob_before_kg),
                'the identity failed - ground_burn_kg is no longer arrival minus before, so the QuickInfo is now wrong');
        }
        out('  => structural, not a check a viewer performs. Shown for legibility.');

        const db = await cds.connect.to('db');
        const rows = await db.run(SELECT.from('fuelsphere.FUEL_DELIVERIES').columns('delivery_number', 'fob_source'));
        const derived = rows.filter(r => r.fob_source === 'ACARS_DERIVED');
        const sources = {};
        for (const r of rows) sources[r.fob_source || '(null)'] = (sources[r.fob_source || '(null)'] || 0) + 1;
        out(`  fob_source across ${rows.length} deliveries: ${JSON.stringify(sources)}`);
        assert.deepStrictEqual(derived.map(r => r.delivery_number), [],
            'an ACARS_DERIVED delivery now exists: ground_burn_kg is an INPUT on that row, the arrival '
            + 'identity is false for it, and this criterion must be replaced by one that tests that arm');
    });
});

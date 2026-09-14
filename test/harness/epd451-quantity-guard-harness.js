/**
 * EPD451 - AN ORDER MUST NAME A QUANTITY, AND THE GUARD IS WIDER THAN THE
 * ANNOTATION IT REPLACED.
 *
 * WHERE THIS CRITERION'S RULE CAME FROM, WHICH IS THE QUESTION SECTION 13 ASKS.
 * NOT from the guard - a criterion written from the same understanding as the
 * code it guards is a restatement wearing a test's clothes. The rule was taken
 * from the RUNTIME BEHAVIOUR OF THE CODE BEFORE THE CHANGE: `@mandatory` on
 * `orderedQuantity` was called with `{}` and returned
 *   400  {"message":"Value is required","target":"orderedQuantity"}
 * That measurement is the specification here. EPD451 has to reproduce a
 * refusal that already existed, and EXIT-2 extends it to a door that never
 * had one.
 *
 * WHY THE ANNOTATION WENT. @mandatory emits a STATIC Common.FieldControl on
 * the parameter and no Nullable="false", and the two actions carrying one are
 * exactly the two whose Fiori header buttons do not render. That is a
 * HYPOTHESIS UNDER TEST by a probe on the flight page, not a finding - and
 * THIS FILE DELIBERATELY DOES NOT ASSERT IT. If the probe comes back "the
 * parameters were the problem", somebody may reasonably put @mandatory back,
 * and a criterion forbidding it would veto that repair while showing green -
 * the `units-harness` EXIT-3 shape exactly. So what is ratcheted is that
 * ENFORCEMENT LIVES IN JAVASCRIPT (EXIT-5), which stays true either way.
 *
 *   EXIT-1  the BOUND door refuses with EPD451 - the refusal @mandatory gave
 *   EXIT-2  the UNBOUND door refuses too - it NEVER had @mandatory, so this
 *           is enforcement that did not previously exist
 *   EXIT-3  THE CONTROL SUCCEEDS, or the refusals above prove nothing: a
 *           shared failure is indistinguishable from a match
 *   EXIT-4  ZERO IS NOT ABSENCE - qty 0 passes EPD451 and is refused by the
 *           variance rule, whose business it is
 *   EXIT-5  the refusal is raised from srv/ JavaScript, so it does not depend
 *           on an annotation that this week's open question may yet change
 *   EXIT-7  the MASS form alone is accepted - orderedQuantityKg with no
 *           orderedQuantity is how a plan-sourced order arrives (WP-11 / A2),
 *           and the first version of this guard refused it while BOTH PLANTS
 *           PASSED. A plant tests the rule its author believes
 *   EXIT-6  the probe, IF IT IS STILL HERE, is zero-parameter and annotated.
 *           Written conditional ON PURPOSE: the probe is temporary and a
 *           criterion that goes red when it is deleted would make deleting it
 *           look like a regression
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const fs = require('node:fs');
const test = cds.test(PROJECT);
const out = s => process.stdout.write('      ' + s + '\n');

const P = '/odata/v4/planning', O = '/odata/v4/orders';
const AC410 = 'e5f6a7b8-5555-4000-8000-0000000d0001';

const post = async (url, body) => {
    try { const r = await test.post(url, body); return { status: r.status, data: r.data }; }
    catch (e) { return { status: e.response?.status ?? e.status, message: e.response?.data?.error?.message ?? e.message }; }
};

describe('EPD451 - an order must name a quantity', () => {

    it('EXIT-1: the BOUND door refuses with EPD451', async () => {
        const r = await post(`${P}/FlightSchedule(${AC410})/PlanningService.createFuelOrder`, {});
        out(`bound, no quantity -> ${r.status} ${r.message}`);
        assert.strictEqual(r.status, 400);
        assert.match(r.message, /EPD451/);
        out('this is the refusal @mandatory used to give ("Value is required"), now coded');
    });

    it('EXIT-2: the UNBOUND door refuses too, and never had @mandatory', async () => {
        const r = await post(`${O}/createOrderFromFlight`, { flightId: AC410 });
        out(`unbound, no quantity -> ${r.status} ${r.message}`);
        assert.strictEqual(r.status, 400);
        assert.match(r.message, /EPD451/);
        out('createOrderFromFlight carried no @mandatory: this door was ALWAYS open');
    });

    it('EXIT-3: THE CONTROL SUCCEEDS - a shared failure would prove nothing', async () => {
        const r = await post(`${P}/FlightSchedule(${AC410})/PlanningService.createFuelOrder`,
            { orderedQuantity: 2500, uomCode: 'LTR', quantityVarianceReason: 'harness control' });
        out(`with a quantity -> ${r.status} ${r.data?.order_number ?? r.message}`);
        assert.strictEqual(r.status, 200);
        assert.ok(r.data?.order_number, 'the control must CREATE, or EXIT-1 and EXIT-2 compare nothing');
        assert.strictEqual(Number(r.data.ordered_quantity), 2500);
    });

    it('EXIT-4: zero is a VALUE - it passes EPD451 and the variance rule owns it', async () => {
        const r = await post(`${P}/FlightSchedule(${AC410})/PlanningService.createFuelOrder`, { orderedQuantity: 0 });
        out(`quantity 0 -> ${r.status} ${r.message}`);
        assert.strictEqual(r.status, 400);
        assert.doesNotMatch(r.message, /EPD451/, 'EPD451 refuses ABSENCE, not a value somebody dislikes');
        assert.match(r.message, /differs from the plan/);
        out('refused by its proper owner, not by a second criterion riding along');
    });

    it('EXIT-5: enforcement is in JavaScript, not in an annotation', async () => {
        const js = fs.readFileSync(`${PROJECT}/srv/order-service.js`, 'utf8');
        // prove the reader before trusting it
        assert.ok(js.includes('EPD451'), 'known-present control');
        assert.ok(!js.includes('EPD9XX_NOT_A_CODE'), 'known-absent control');
        const raises = (js.match(/EPD451/g) || []).length;
        out(`EPD451 appears ${raises}x in srv/order-service.js`);
        assert.ok(raises >= 1);
        out('ratcheted here rather than "no @mandatory anywhere": the probe may yet');
        out('say the annotation was innocent, and a criterion forbidding it would');
        out('veto that repair while showing green');
    });

    it('EXIT-7: the MASS form alone is accepted - two units name a quantity', async () => {
        // THE FIRST VERSION OF THE GUARD REFUSED THIS, and both of my plants
        // passed anyway: a plant tests the rule its author believes. wp11
        // EXIT-1 tested the rule that is true. Locked here so the guard's own
        // contract states it, rather than depending on a harness about
        // conversion to notice a change in a harness about refusal.
        // 9600 kg against AC410's 2305 kg plan trips the VARIANCE rule, which is
        // a different owner refusing for a different reason - the first draft of
        // this criterion read that 400 as a failure of the guard. The reason is
        // supplied so the only thing left that can refuse is EPD451.
        const r = await post(`${O}/createOrderFromFlight`,
            { flightId: AC410, orderedQuantityKg: 9600, quantityVarianceReason: 'harness: mass form' });
        out(`mass only (orderedQuantityKg=9600, no orderedQuantity) -> ${r.status} ${r.data?.order_number ?? r.message}`);
        assert.doesNotMatch(String(r.message ?? ''), /EPD451/, 'the mass form names a quantity');
        assert.strictEqual(r.status, 200, 'a plan-sourced order names its quantity in kg (WP-11 / A2)');
        assert.ok(r.data?.order_number);
    });

    it('EXIT-6: the probe, IF present, is zero-parameter and annotated', async () => {
        const csn = await cds.load([`${PROJECT}/db`, `${PROJECT}/srv`]);
        const edmx = cds.compile.to.edmx(csn, { service: 'PlanningService', version: 'v4' });
        const i = edmx.indexOf('<Action Name="probeHeaderButton"');
        if (i < 0) {
            out('probe is GONE - the 2x2 was read and it was removed. Nothing to assert.');
            return;
        }
        const seg = edmx.slice(i, edmx.indexOf('</Action>', i));
        const nparams = [...seg.matchAll(/<Parameter Name="/g)].length - 1;
        out(`probe still present, ${nparams} parameters beyond the bound 'in'`);
        assert.strictEqual(nparams, 0, 'the probe is only meaningful at zero parameters');
        assert.ok(edmx.includes('String="PlanningService.probeHeaderButton"'),
            'an unannotated probe is on no screen and answers nothing');
    });
});

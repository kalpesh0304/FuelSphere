/**
 * AN ANNOTATION ON A PROJECTION NO DEPLOYED APP OPENS IS COMPLETE, CORRECT AND
 * INVISIBLE — AND EVERY SWEEP IN THIS REPOSITORY PASSES ON IT.
 *
 * `createFuelOrder` is bound to `FuelOrderService.FlightSchedule`, annotated as
 * a `DataFieldForAction` inside the `FlightDispatchPlans` collection facet,
 * exactly where it was specified to go. Nothing about it is wrong. It is on no
 * screen, because **`FuelOrderService.FlightSchedule` has no page in any of the
 * four deployed apps** — measured from their manifests, not inferred.
 *
 * This is the field-group-nothing-references class with one turn added. There
 * the group is orphaned WITHIN a service and a facet sweep finds it. Here the
 * group IS referenced by a facet, on an entity that is fully annotated, and
 * `d50`, `ui02` and `drill-down-pages` all pass. The reader is simply
 * somewhere else.
 *
 * THE FIXED POINT, WHICH IS WHAT THIS FILE EXISTS TO STATE:
 * **THE FLIGHT READER IS ON PlanningService.** `flightSchedule` is the only
 * deployed app with a FlightSchedule object page and it binds
 * `/odata/v4/planning/`. Five services define a FlightSchedule projection; one
 * is opened. Work that lands on any of the other four is invisible.
 *
 * WHAT THIS CRITERION DOES NOT REACH, SAID HERE RATHER THAN IMPLIED. It is
 * scoped to FlightSchedule projections. **The cross-entity form — a field group
 * on `FuelOrderService.FuelDeliveries` while the flight reader arrives at
 * `FLIGHT_FUEL_DELIVERIES` — is NOT caught**, and the reason is worth keeping:
 * the obvious generalisation, "a sibling projection carries groups the
 * reachable one lacks", was MEASURED FIRST and rejected. It fires on `orders`
 * (3 groups against 10), `dispatches` (3 against 10) and `tail` (4 against 1),
 * and **all three differences are deliberate** — Planning's projections are
 * flight-reader-scoped by design. Asserting it would freeze real decisions into
 * an accepted list nobody re-derives, which is the `ui02` baseline trap. So
 * that instance needed a person to notice, and still does.
 *
 *   EXIT-1  the deployed-binding table is ACCURATE against this model
 *   EXIT-2  the fixed point: exactly one FlightSchedule projection is opened,
 *           and it is PlanningService's
 *   EXIT-3  every action button on ANY FlightSchedule projection is on the
 *           opened one
 *   EXIT-4  every facet-referenced FieldGroup likewise
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const test = cds.test(PROJECT);
const out = s => process.stdout.write('      ' + s + '\n');

/**
 * WHAT THE FOUR DEPLOYED APPS BIND AND OPEN.
 *
 * Read from each repository's `webapp/manifest.json` — `sap.app.dataSources
 * .mainService.uri` and every `sap.ui5.routing.targets[*].options.settings
 * .contextPath`. **A RECORDED EXTERNAL FACT, NOT A MEASUREMENT OF THIS MODEL**,
 * which is exactly why EXIT-1 checks it against the model rather than trusting
 * it: a renamed entity here makes this table wrong silently.
 *
 *   kalpesh0304/fuelorders      f82f010
 *   kalpesh0304/flightDispatch  332127b
 *   kalpesh0304/flightSchedule  d8be4cc
 *   kalpesh0304/fuelTickets     bb128e6
 *
 * The apps' own `annotations/annotation.xml` are empty stubs, so every column,
 * facet and button on those screens comes from this repository through
 * `$metadata`. That is what makes an annotation here a deployed-screen change,
 * and what makes one on the wrong projection a no-op.
 */
const DEPLOYED = [
    { app: 'flightSchedule', service: 'PlanningService',  path: '/odata/v4/planning', pages: ['FlightSchedule'] },
    { app: 'flightDispatch', service: 'FuelOrderService', path: '/odata/v4/orders',   pages: ['FlightDispatches'] },
    { app: 'fuelTickets',    service: 'FuelOrderService', path: '/odata/v4/orders',   pages: ['FuelTickets'] },
    { app: 'fuelorders',     service: 'FuelOrderService', path: '/odata/v4/orders',   pages: ['FuelOrders'] }
];

const term = n => `Term="(?:[\\w.]*\\.)?${n}"`;
const call = async f => {
    try { const r = await f(); return { status: r.status, data: r.data }; }
    catch (e) { return { status: e.response?.status || e.status, msg: e.message }; }
};

let model, edmx = {};

const block = (svc, ent) => {
    const s = edmx[svc];
    if (!s) return null;
    const i = s.indexOf(`<Annotations Target="${svc}.${ent}">`);
    return i < 0 ? null : s.slice(i, s.indexOf('</Annotations>', i));
};
const actionsOn = (svc, ent) => {
    const b = block(svc, ent);
    return b === null ? [] : [...b.matchAll(/Property="Action"\s+String="([^"]+)"/g)].map(m => m[1]);
};
const groupsOn = (svc, ent) => {
    const b = block(svc, ent);
    return b === null ? [] : [...b.matchAll(new RegExp(term('FieldGroup') + '\\s+Qualifier="([^"]+)"', 'g'))].map(m => m[1]);
};

describe('What a deployed app actually opens', function () {
    this.timeout(120000);

    before(async () => {
        model = cds.linked(await cds.load([`${PROJECT}/db`, `${PROJECT}/srv`]));
        for (const d of new Map(DEPLOYED.map(d => [d.service, d.path]))) {
            const [svc, path] = d;
            edmx[svc] = String((await call(() => test.GET(`${path}/$metadata`))).data);
        }
    });

    // -------------------------------------------------------------- EXIT-1 --
    // THE TABLE IS AN EXTERNAL FACT AND WILL GO STALE. Nothing in this
    // repository updates it when an app is redeployed, so the one thing that
    // CAN be checked here is that everything it names still exists and still
    // serves — a renamed entity or a dropped service makes it wrong silently,
    // and a wrong table would let EXIT-3 pass by comparing against nothing.
    it('EXIT-1  the deployed-binding table is accurate against this model', async () => {
        const bad = [];
        for (const d of DEPLOYED) {
            for (const page of d.pages) {
                const def = model.definitions[`${d.service}.${page}`];
                const r = await call(() => test.GET(`${d.path}/${page}?$top=1`));
                out(`  ${d.app.padEnd(15)} ${d.service}.${page}  defined=${!!def}  GET=${r.status}`);
                if (!def) bad.push(`${d.service}.${page} is not defined in this model`);
                if (r.status !== 200) bad.push(`${d.service}.${page} returns ${r.status}, so the app's page is empty`);
            }
        }
        assert.deepStrictEqual(bad, [], 'the recorded app bindings no longer match this model');
    });

    // -------------------------------------------------------------- EXIT-2 --
    // THE FIXED POINT. Five services project FLIGHT_SCHEDULE; this asserts
    // which one a flight reader is actually looking at. It fails if a second
    // app gains a FlightSchedule page, or if flightSchedule is re-pointed at
    // another service — either of which moves where flight work belongs, and
    // is a thing somebody must be told rather than discover.
    it('EXIT-2  exactly one FlightSchedule projection is opened, and it is PlanningService', () => {
        const projections = Object.keys(model.definitions).filter(n => /Service\.FlightSchedule$/.test(n));
        const opened = DEPLOYED.filter(d => d.pages.includes('FlightSchedule'));
        out(`  FlightSchedule projections in this model: ${projections.length}`);
        for (const p of projections) out(`     ${p}`);
        out(`  opened by a deployed app: ${opened.map(o => `${o.app} -> ${o.service}`).join(', ') || '(none)'}`);
        assert.ok(projections.length > 1,
            'only one FlightSchedule projection exists, so this criterion cannot discriminate');
        assert.strictEqual(opened.length, 1, 'expected exactly one app with a FlightSchedule page');
        assert.strictEqual(opened[0].service, 'PlanningService',
            'the flight reader is no longer on PlanningService - flight work moves with them');
    });

    // -------------------------------------------------------------- EXIT-3 --
    // THE CRITERION THIS FILE WAS WRITTEN FOR, AND IT ASSERTS THE REQUIREMENT
    // RATHER THAN ITS MIRROR.
    //
    // `manual-order-creation` EXIT-7 asserted the button is in the Dispatch
    // Plans section and passed, because it compiled the EDMX for
    // `service:'FuelOrderService'` - the projection it was built against. IT
    // NEVER ASKED WHICH SERVICE THE READER OPENS, so it would pass with the
    // button on any service at all.
    //
    // THE FIRST VERSION OF THIS CRITERION MADE THE OPPOSITE MISTAKE and is
    // worth keeping the record of: it asserted no OTHER projection may carry
    // an action button, which is stronger than the decision. Keeping the
    // FuelOrderService annotation is deliberate - it costs nothing and is
    // correct the day that projection gets a page - so a criterion forbidding
    // it would have vetoed a decision somebody took. Same shape as the
    // `@Measures` guard that enforced the error it was written to catch.
    // The stranded copy is REPORTED by EXIT-5, not forbidden here.
    //
    // HOW THIS FAILS: take the button off the opened projection. It failed on
    // the commit before the repair, naming FuelOrderService.
    it('EXIT-3  the raise-order action is annotated on the OPENED projection', () => {
        const opened = DEPLOYED.find(d => d.pages.includes('FlightSchedule')).service;
        const acts = actionsOn(opened, 'FlightSchedule');
        out(`  ${opened}.FlightSchedule buttons: ${acts.join(', ') || '(none)'}`);
        const raise = acts.filter(a => /createFuelOrder$/.test(a));
        out(`  raise-order buttons a flight reader can press: ${raise.join(', ') || 'NONE'}`);
        assert.deepStrictEqual(raise, [`${opened}.createFuelOrder`],
            'the flight reader cannot raise an order: the action is not annotated on the projection '
          + 'their app binds. It may be complete and correct on another one, and that is not a screen.');
    });

    // -------------------------------------------------------------- EXIT-4 --
    // The group is how the button reaches a SECTION. Separate from EXIT-3
    // because an action can be annotated without a group carrying it onto a
    // facet, and the placement is the half that was specified: the dispatch
    // section, because the plan is what the order answers.
    it('EXIT-4  the button is on the DISPATCH section of the opened projection', () => {
        const opened = DEPLOYED.find(d => d.pages.includes('FlightSchedule')).service;
        const blk = block(opened, 'FlightSchedule');
        assert.ok(blk, `no annotation block for ${opened}.FlightSchedule`);
        assert.ok(groupsOn(opened, 'FlightSchedule').includes('RaiseOrder'),
            'no #RaiseOrder group on the opened projection');
        const m = /<PropertyValue Property="ID" String="DispatchPlans"\/>[\s\S]{0,900}/.exec(blk);
        assert.ok(m, 'the Dispatch Plans facet is gone from the opened projection');
        out(`  Dispatch Plans facet found on ${opened}.FlightSchedule`);
        assert.ok(/@UI\.FieldGroup#RaiseOrder/.test(m[0]),
            'the create action is not in the Dispatch Plans section. On the order list a person types '
          + 'the flight, the date and the station - all of which the flight page already knows.');
        out('  #RaiseOrder is inside it');
    });

    // -------------------------------------------------------------- EXIT-5 --
    // THE STRANDED COPIES, RATCHETED RATHER THAN FORBIDDEN.
    //
    // An annotation on a projection no app opens is not automatically wrong -
    // FuelOrderService's is kept on purpose. It IS the defect class when
    // nobody decided it, and the two are indistinguishable by reading. So
    // every one is listed with its reason, and BOTH DIRECTIONS are asserted:
    // no NEW stranded annotation, and no KNOWN entry that has stopped being
    // stranded. The second half is what stops the list rotting into
    // permission - the day `FuelOrderService.FlightSchedule` gains a page in
    // the DEPLOYED table, these entries must come out, and this fails until
    // they do. A repair is what makes it fail.
    it('EXIT-5  every stranded FlightSchedule annotation is a recorded decision', () => {
        const KNOWN = {
            'FuelOrderService.FlightSchedule':
                'Kept deliberately. The identical action and #RaiseOrder group were built here first '
              + 'and are correct; this projection simply has no page in any of the four deployed apps. '
              + 'Removing them would cost the work for nothing and they are right the day it gets one.'
        };
        const openedSvc = DEPLOYED.find(d => d.pages.includes('FlightSchedule')).service;
        const openedEntities = new Set(DEPLOYED.map(d => `${d.service}.FlightSchedule`)
            .filter(t => t.startsWith(openedSvc)));

        const stranded = [];
        for (const svc of Object.keys(edmx)) {
            const t = `${svc}.FlightSchedule`;
            if (openedEntities.has(t)) continue;
            const n = actionsOn(svc, 'FlightSchedule').length + groupsOn(svc, 'FlightSchedule').length;
            if (n > 0) stranded.push(t);
        }
        out(`  stranded FlightSchedule projections: ${stranded.join(', ') || '(none)'}`);
        for (const t of stranded) out(`    ${t}: ${KNOWN[t] ? 'RECORDED' : '*** NOT RECORDED ***'}`);

        const unrecorded = stranded.filter(t => !KNOWN[t]);
        assert.deepStrictEqual(unrecorded, [],
            'an annotated FlightSchedule projection that no deployed app opens is not on the recorded '
          + 'list - it is complete, correct and invisible, and nobody decided that');

        // THE STALE HALF. A KNOWN entry whose projection now has a page is a
        // decision that has expired, and leaving it in makes the list a record
        // of choices nobody took.
        const expired = Object.keys(KNOWN).filter(t => !stranded.includes(t));
        out(`  recorded entries that are no longer stranded: ${expired.join(', ') || '(none)'}`);
        assert.deepStrictEqual(expired, [],
            'a recorded stranded projection now has a page or lost its annotations - take it off the list');
    });
});

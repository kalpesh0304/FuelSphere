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
    // THE CRITERION THIS FILE WAS WRITTEN FOR.
    //
    // `manual-order-creation` EXIT-7 asserted the button is in the Dispatch
    // Plans section and passed, because it compiled the EDMX for
    // `service:'FuelOrderService'` — the projection it was built against. IT
    // NEVER ASKED WHICH SERVICE THE READER OPENS, so it would pass with the
    // button on any service at all. Same family as a 200 from $fiori-preview:
    // an instrument answering a narrower question than the one being asked.
    //
    // HOW THIS ONE FAILS: put an action button on a FlightSchedule projection
    // no app opens. It fails on the state that prompted it.
    it('EXIT-3  every action button on a FlightSchedule projection is on the opened one', () => {
        const openedSvc = DEPLOYED.find(d => d.pages.includes('FlightSchedule')).service;
        const stranded = [];
        for (const svc of Object.keys(edmx)) {
            const acts = actionsOn(svc, 'FlightSchedule');
            out(`  ${svc}.FlightSchedule buttons: ${acts.join(', ') || '(none)'}${svc === openedSvc ? '   <- OPENED' : ''}`);
            if (svc !== openedSvc) for (const a of acts) stranded.push(`${a} is annotated on ${svc}.FlightSchedule, which no deployed app opens`);
        }
        for (const s of stranded) out(`  STRANDED: ${s}`);
        assert.deepStrictEqual(stranded, [],
            'an action button sits on a FlightSchedule projection with no page - it is complete, correct and invisible');
    });

    // -------------------------------------------------------------- EXIT-4 --
    // The same question for field groups, which is how the button GETS onto a
    // section: #RaiseOrder is referenced by a facet on the pageless projection.
    // Separate from EXIT-3 because a group can be stranded with no action in
    // it, and an action can be placed without a group.
    it('EXIT-4  every facet-referenced FieldGroup on a FlightSchedule projection is on the opened one', () => {
        const openedSvc = DEPLOYED.find(d => d.pages.includes('FlightSchedule')).service;
        const stranded = [];
        for (const svc of Object.keys(edmx)) {
            const grps = groupsOn(svc, 'FlightSchedule');
            out(`  ${svc}.FlightSchedule groups: ${grps.length}${svc === openedSvc ? '   <- OPENED' : '  ' + (grps.join(', ') || '')}`);
            if (svc !== openedSvc) for (const g of grps) stranded.push(`#${g} on ${svc}.FlightSchedule, which no deployed app opens`);
        }
        for (const s of stranded) out(`  STRANDED: ${s}`);
        assert.deepStrictEqual(stranded, [],
            'a field group sits on a FlightSchedule projection with no page');
    });
});

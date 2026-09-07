/**
 * OVP MANIFEST — THE CARD IS HAND-WRITTEN, SO SOMETHING MUST READ IT.
 *
 * The Fiori Elements writer emits `"cards": {}`. Every card in this repository
 * is written by hand, and there was no check between the hand and SAP's own
 * specification - which was sitting in node_modules the whole time.
 *
 * THAT COST A CARD. The Fuel Status card named `sap.ovp.cards.list`, the
 * OData V2 card component, against a V4 model. The shell rendered. The filter
 * bar rendered. THE CARD FRAME RENDERED. The body bound nothing, and nothing
 * errored.
 *
 * WHY THAT IS A DIFFERENT CLASS FROM THE EIGHT.
 *
 * The eight recorded causes of an empty section are all a binding that
 * RESOLVES TO NOTHING - a dangling path, an unexposed target, an unmodelled
 * navigation, a wrong field name, a null FK, an unwritten virtual element, a
 * facet on an unannotated entity, a 405 on an auto-exposed set.
 *
 * This is a binding that resolves PERFECTLY, read by a component that cannot
 * read it. And it is the first one where the failure ASSERTS something: an
 * empty section says "nothing here"; a rendered card frame says "this works
 * and there is no data", which is a claim rather than a silence.
 *
 * AND THE HARNESS GAP IS THE SHARPER HALF. e2a-ovp-card-harness checks the
 * entity, the annotation, the qualifier, the fields and the rows. Every one of
 * its assertions was TRUE. It never checked what READS them.
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
const assert  = require('node:assert');
const fs      = require('node:fs');
const path    = require('node:path');
// THE RUNNER COUNTS MOCHA, SO THIS HARNESS MUST BE MOCHA.
//
// Written with node:test, it ran under `npx mocha <file>` and mocha saw NO
// TESTS. Six criteria executed inside node:test's own runner, printed TAP,
// and were invisible to run-harnesses.sh, which scrapes mocha's "N passing".
// It reported `ovp-manifest-harness 0 0 0` for weeks.
//
// AND IT COULD NOT TURN THE SUITE RED. Measured with a planted failure:
// node:test sets process.exitCode = 1, mocha then calls process.exit(0)
// because ITS OWN failure count is zero, and the shell sees 0. A harness
// that cannot fail is the vacuous pass one level up - not an assertion that
// cannot fail, a whole harness that cannot.
//
// Every other harness here uses mocha's globals. This one is the outlier and
// is now the same shape as the rest.
const out = s => process.stdout.write('      ' + s + '\n');

const SCHEMA = JSON.parse(fs.readFileSync(`${__dirname}/../schemas/OverviewPageConfig.json`, 'utf8'));

/** Every OVP app in the repository, found rather than listed. */
function ovpApps() {
    const apps = [];
    const root = `${PROJECT}/app`;
    if (!fs.existsSync(root)) return apps;
    for (const d of fs.readdirSync(root)) {
        const m = path.join(root, d, 'webapp', 'manifest.json');
        if (!fs.existsSync(m)) continue;
        const j = JSON.parse(fs.readFileSync(m, 'utf8'));
        if (j['sap.ovp']) apps.push({ name: d, file: m, manifest: j });
    }
    return apps;
}

/** The card component families the schema enumerates, split by OData version. */
function templatesByVersion() {
    const txt = JSON.stringify(SCHEMA);
    const v2 = new Set(), v4 = new Set();
    for (const m of txt.matchAll(/"(sap\.ovp\.cards\.(v4\.)?\w+)"/g))
        (m[2] ? v4 : v2).add(m[1]);
    return { v2, v4 };
}

describe('OVP manifest — validated against SAP\'s own specification', () => {

  it('EXIT-1  the specification is present and enumerates BOTH card families', () => {
    const { v2, v4 } = templatesByVersion();
    assert.ok(v2.size >= 3, `only ${v2.size} v2 card components found - the schema copy looks wrong`);
    assert.ok(v4.size >= 3, `only ${v4.size} v4 card components found - the schema copy looks wrong`);
    // The pair that cost a card. If these ever collapse to one name, the whole
    // criterion below is meaningless and should be re-derived.
    assert.ok(v2.has('sap.ovp.cards.list') && v4.has('sap.ovp.cards.v4.list'),
      'the list card no longer has two version-specific components');
    out(`v2: ${[...v2].sort().join(', ')}`);
    out(`v4: ${[...v4].sort().join(', ')}`);
  });

  it('EXIT-2  THE CRITERION THAT WOULD HAVE CAUGHT IT — card template matches OData version', () => {
    const apps = ovpApps();
    assert.ok(apps.length > 0, 'instrument check: no OVP app found, so nothing is being validated');
    const { v4: v4set } = templatesByVersion();
    let checked = 0;
    for (const app of apps) {
        const ds = app.manifest['sap.app'].dataSources || {};
        for (const [id, card] of Object.entries(app.manifest['sap.ovp'].cards || {})) {
            const modelName = card.model;
            const model = (app.manifest['sap.ui5'].models || {})[modelName];
            assert.ok(model, `${app.name}/${id}: names model "${modelName}", which the manifest does not define`);
            const src = ds[model.dataSource];
            assert.ok(src, `${app.name}/${id}: model "${modelName}" names dataSource "${model.dataSource}", which does not exist`);
            const version = (src.settings || {}).odataVersion;
            assert.ok(version, `${app.name}/${id}: the dataSource declares no odataVersion`);
            const isV4Template = v4set.has(card.template);
            checked++;
            if (String(version).startsWith('4')) {
                assert.ok(isV4Template,
                  `${app.name}/${id}: template "${card.template}" is the V${isV4Template?4:2} card component `
                + `against an OData ${version} model. It renders its FRAME and binds NOTHING. `
                + `Use the sap.ovp.cards.v4.* form.`);
            } else {
                assert.strictEqual(isV4Template, false,
                  `${app.name}/${id}: a v4 card component against an OData ${version} model`);
            }
        }
    }
    assert.ok(checked > 0, 'instrument check: no cards were checked');
    out(`${checked} card(s) across ${apps.length} app(s), every template matched to its model's OData version`);
  });

  it('EXIT-3  and it BITES — the exact mistake, planted', () => {
    const { v4: v4set } = templatesByVersion();
    // Replay EXIT-2's rule against a manifest carrying the original defect.
    const bad = { template: 'sap.ovp.cards.list', version: '4.0' };
    const wouldPass = v4set.has(bad.template) || !String(bad.version).startsWith('4');
    assert.strictEqual(wouldPass, false,
      'the rule accepts a V2 card component on a V4 model - it would not have caught this');
    const good = { template: 'sap.ovp.cards.v4.list', version: '4.0' };
    assert.ok(v4set.has(good.template), 'the rule rejects the CORRECT template - it is over-strict');
    out('v2 list on a 4.0 model: rejected. v4 list on a 4.0 model: accepted.');
  });

  it('EXIT-4  every card names a template and a model the schema requires', () => {
    // The schema marks both mandatory. A card missing either renders a frame
    // and nothing else - the same visible outcome by a different route.
    const required = SCHEMA.definitions?.ListCard?.required || [];
    assert.deepStrictEqual([...required].sort(), ['model','template'],
      'the schema no longer requires exactly model and template - re-read it');
    for (const app of ovpApps())
        for (const [id, card] of Object.entries(app.manifest['sap.ovp'].cards || {}))
            for (const k of required)
                assert.ok(card[k], `${app.name}/${id}: no "${k}"`);
    out(`schema requires [${required.join(', ')}]; every card carries both`);
  });

  it('EXIT-5  every card setting is one the schema knows', () => {
    // additionalProperties is false on the card, so an invented key is a
    // silent no-op rather than an error. Settings are checked against the
    // union of the schema's card-settings definitions.
    const known = new Set();
    for (const [name, def] of Object.entries(SCHEMA.definitions || {}))
        if (/CardSettings$/.test(name))
            for (const k of Object.keys(def.properties || {})) known.add(k);
    assert.ok(known.size > 10, `only ${known.size} known settings - the schema read is wrong`);
    const unknown = [];
    for (const app of ovpApps())
        for (const [id, card] of Object.entries(app.manifest['sap.ovp'].cards || {}))
            for (const k of Object.keys(card.settings || {}))
                if (!known.has(k)) unknown.push(`${app.name}/${id}.${k}`);
    assert.deepStrictEqual(unknown, [],
      'a card carries a setting the specification does not define - it is being ignored silently');
    out(`${known.size} settings defined by the schema; no card carries one outside it`);
  });

  it('EXIT-6  the committed schema still matches the installed package, where one exists', () => {
    // The copy can go stale. Where the package is present, prove it has not.
    const candidates = [
      `${PROJECT}/node_modules/@sap/ux-specification/dist/schemas/v2/OverviewPageConfig.json`,
      `${PROJECT}/app/flight-overview/node_modules/@sap/ux-specification/dist/schemas/v2/OverviewPageConfig.json`,
    ].filter(fs.existsSync);
    if (!candidates.length) {
      out('no installed @sap/ux-specification to compare against - skipped, not failed');
      return;
    }
    // NO SELF-COMPARISON HERE. An earlier draft asserted
    // templatesByVersion() equals templatesByVersion(), which is true whatever
    // either schema says - the vacuous pass arriving inside the guard against
    // vacuous passes, for the second time in three days.
    const live = JSON.parse(fs.readFileSync(candidates[0], 'utf8'));
    const liveTxt = JSON.stringify(live), ourTxt = JSON.stringify(SCHEMA);
    assert.strictEqual(ourTxt === liveTxt, true,
      `the committed schema differs from ${candidates[0]} - refresh the copy`);
    out(`matches ${candidates[0].replace(PROJECT+'/','')}`);
  });
});

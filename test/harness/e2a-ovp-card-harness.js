/**
 * E2a — THE FUEL STATUS CARD, PROVED WITHOUT LOOKING AT IT.
 *
 * $fiori-preview cannot show an OVP: its router is /:service/:entity and its
 * synthesised manifest hardcodes ListReport and ObjectPage. And in the build
 * container nothing renders at all - ui5.sap.com answers 403 to CONNECT, so
 * A 200 FROM $fiori-preview HAS NEVER BEEN EVIDENCE THAT ANYTHING RENDERED.
 *
 * So the card is proved by the two things a person looking at the page could
 * NOT tell apart anyway:
 *
 *   the annotation the card names EXISTS on the entity the card names
 *   and the binding RETURNS ROWS
 *
 * A human sees an empty card either way. Seven distinct causes have produced
 * an empty section in this repository - a dangling path, an unexposed target,
 * an unmodelled navigation, a wrong field name, a null FK, a virtual element
 * nobody wrote, and a facet on an unannotated entity. NOT ONE of them is
 * visible by looking.
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert');
const fs=require('node:fs');
const test=cds.test(PROJECT); const out=s=>process.stdout.write('      '+s+'\n');
const APP=`${PROJECT}/app/flight-overview`;
const M=`${APP}/webapp/manifest.json`;

const manifest = () => JSON.parse(fs.readFileSync(M,'utf8'));

describe('E2a — the one-card OVP', () => {

  let edmx;
  before(() => { edmx = cds.compile.to.edmx(cds.model, { service: 'PlanningService', version: 'v4' }); });

  it('EXIT-1  the app is a real OVP, not a List Report wearing the name', () => {
    const m = manifest();
    assert.ok(m['sap.ovp'], 'no sap.ovp section - this is not an overview page');
    assert.ok(m['sap.ui5'].dependencies.libs['sap.ovp'], 'sap.ovp is not declared as a dependency');
    assert.strictEqual(m['sap.app'].dataSources.mainService.uri, '/odata/v4/planning/');
    // GENERATED, NOT HAND-WRITTEN, and the generator says so itself. It
    // overrode the id passed to it with its own stamp, which is stronger
    // evidence than the one I supplied: this app came out of the writer's
    // ovp template at a named version.
    assert.strictEqual(m['sap.app'].sourceTemplate.id, '@sap-ux/fiori-elements-writer:ovp',
      'the app was not produced by the Fiori Elements writer ovp template');
    assert.ok(m['sap.app'].sourceTemplate.version, 'the template version is not recorded');
    for (const f of ['webapp/Component.js','webapp/index.html','ui5.yaml','package.json'])
      assert.ok(fs.existsSync(`${APP}/${f}`), `${f} is missing - the app will not start`);
    out(`sap.ovp present, libs include sap.ovp, bound to ${m['sap.app'].dataSources.mainService.uri}`);
  });

  it('EXIT-2  exactly one card, and it names an entity set and an annotation', () => {
    const cards = manifest()['sap.ovp'].cards;
    const names = Object.keys(cards);
    assert.strictEqual(names.length, 1, `expected one card, found ${names.length}`);
    const s = cards[names[0]].settings;
    assert.ok(s.entitySet, 'the card names no entity set');
    assert.ok(s.annotationPath, 'the card names no annotation');
    out(`${names[0]}: ${s.entitySet} / ${s.annotationPath}`);
  });

  it('EXIT-3  THE ANNOTATION EXISTS — checked in the emitted EDMX, with the qualifier', () => {
    const s = Object.values(manifest()['sap.ovp'].cards)[0].settings;
    const [term, qualifier] = s.annotationPath.split('#');
    const short = term.replace('com.sap.vocabularies.UI.v1.', 'UI.');

    const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blk = edmx.match(new RegExp(
        `<Annotations Target="PlanningService\\.${esc(s.entitySet)}">([\\s\\S]*?)</Annotations>`));
    assert.ok(blk, `no annotations at all on PlanningService.${s.entitySet}`);

    const want = `Term="${short}"` + (qualifier ? ` Qualifier="${qualifier}"` : '');
    assert.ok(blk[1].includes(want),
      `the card names ${s.annotationPath} and the EDMX does not carry it`);

    // AND THE QUALIFIER MATTERS. Without it the card would silently fall back
    // to the unqualified LineItem, which is the seven-column delivery table.
    assert.ok(qualifier, 'the card must use a qualified LineItem, not the table');
    const wrong = blk[1].includes(`Term="${short}" Qualifier="NotThisOne"`);
    assert.strictEqual(wrong, false, 'instrument check: the matcher accepts any qualifier');
    out(`${short}#${qualifier} found on PlanningService.${s.entitySet}`);
  });

  it('EXIT-4  every field the card displays exists on the entity it binds to', () => {
    const s = Object.values(manifest()['sap.ovp'].cards)[0].settings;
    const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const et = edmx.match(new RegExp(
        `<EntityType Name="${esc(s.entitySet)}"[^>]*>([\\s\\S]*?)</EntityType>`));
    assert.ok(et, `${s.entitySet} is not an entity type on PlanningService`);
    const props = new Set([...et[1].matchAll(/<Property Name="(\w+)"/g)].map(m => m[1]));

    const [term, qualifier] = s.annotationPath.split('#');
    const short = term.replace('com.sap.vocabularies.UI.v1.', 'UI.');
    const blk = edmx.match(new RegExp(
        `<Annotations Target="PlanningService\\.${esc(s.entitySet)}">([\\s\\S]*?)</Annotations>`))[1];
    const coll = blk.match(new RegExp(
        `<Annotation Term="${short}" Qualifier="${qualifier}">([\\s\\S]*?)</Annotation>`));
    assert.ok(coll, 'the qualified collection did not parse');
    const paths = [...coll[1].matchAll(/<PropertyValue Property="Value" Path="([^"]+)"/g)].map(m => m[1]);
    assert.ok(paths.length >= 3, `the card shows only ${paths.length} fields - too thin to be a verdict`);
    const missing = paths.filter(p => !props.has(p));
    assert.deepStrictEqual(missing, [], `the card names fields the entity does not have`);
    // sortBy is a binding too, and it dangles just as silently.
    if (s.sortBy) assert.ok(props.has(s.sortBy), `sortBy "${s.sortBy}" is not a property`);
    out(`${paths.length} fields, all present: ${paths.join(', ')}`);
  });

  it('EXIT-5  THE BINDING RETURNS ROWS — the check a person looking cannot make', async () => {
    const s = Object.values(manifest()['sap.ovp'].cards)[0].settings;
    const [term, qualifier] = s.annotationPath.split('#');
    const short = term.replace('com.sap.vocabularies.UI.v1.', 'UI.');
    const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blk = edmx.match(new RegExp(
        `<Annotations Target="PlanningService\\.${esc(s.entitySet)}">([\\s\\S]*?)</Annotations>`))[1];
    const coll = blk.match(new RegExp(
        `<Annotation Term="${short}" Qualifier="${qualifier}">([\\s\\S]*?)</Annotation>`))[1];
    const paths = [...coll.matchAll(/<PropertyValue Property="Value" Path="([^"]+)"/g)].map(m => m[1]);

    // Exactly what the card asks the service for.
    const url = `/odata/v4/planning/${s.entitySet}?$select=${paths.join(',')}`
              + (s.sortBy ? `&$orderby=${s.sortBy} ${s.sortOrder === 'descending' ? 'desc' : 'asc'}` : '');
    const { data } = await test.GET(url);
    assert.ok(Array.isArray(data.value), 'the card query did not return a collection');
    assert.ok(data.value.length > 0,
      'THE CARD WOULD RENDER EMPTY. The binding resolves and returns no rows.');

    // And not merely rows - rows with VALUES. A card of nulls is an empty card
    // that passes a row count.
    for (const p of paths) {
      const populated = data.value.filter(r => r[p] !== null && r[p] !== undefined).length;
      assert.ok(populated > 0, `every row is null in "${p}" - the card would show a blank column`);
    }
    const r = data.value[0];
    out(`${data.value.length} rows; first: ` + paths.map(p => `${p}=${r[p]}`).join('  '));
  });

  it('EXIT-6  the global filter entity is real, and relates the card to a flight', async () => {
    const m = manifest();
    const gf = m['sap.ovp'].globalFilterEntitySet;
    assert.ok(gf, 'no global filter entity set');
    const { data } = await test.GET(`/odata/v4/planning/${gf}?$top=1`);
    assert.ok(data.value.length > 0, `${gf} has no rows - the filter bar would offer nothing`);
    // The card's entity must be reachable FROM the filter entity, or filtering
    // the page would leave the card showing everything.
    const et = edmx.match(new RegExp(`<EntityType Name="${gf}"[^>]*>([\\s\\S]*?)</EntityType>`));
    const navs = [...et[1].matchAll(/<NavigationProperty Name="(\w+)" Type="([^"]+)"/g)]
        .filter(x => x[2].includes(m['sap.ovp'].cards.card00_fuelStatus.settings.entitySet));
    assert.ok(navs.length > 0,
      `${gf} cannot navigate to the card's entity - the page filter would not reach the card`);
    out(`${gf} -> ${navs.map(n => n[1]).join(', ')}`);
  });
});

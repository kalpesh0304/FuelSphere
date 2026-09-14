/**
 * THE LOCAL FIORI APP — the one surface in this project where an action can
 * actually be PRESSED.
 *
 * WHY IT EXISTS. `$fiori-preview` DRAWS some action buttons and EXECUTES NONE
 * (section 12, four rounds and a four-cell table). A real Fiori Elements app
 * does execute them. `app/flight-schedule` is the smallest one that opens the
 * page a planner reads, against the running service.
 *
 * WHAT THIS FILE CAN AND CANNOT DO. It cannot render and it cannot press -
 * UI5 loads from a CDN this container answers 403 to, and that limit is now
 * named rather than worked around. What it CAN do is guard every link in the
 * chain BETWEEN the model and the browser, and those are the links that break
 * silently: an entity renamed in `srv/` leaves the manifest pointing at
 * nothing, the app loads, and a section is simply empty. Nobody would see a
 * stack trace.
 *
 * WHERE THE RULE COMES FROM. The manifest is an artefact written by hand, and
 * the model is generated from `srv/`. The criteria compare ONE against the
 * OTHER - neither is derived from the other, which is the independence
 * section 13 asks for. A criterion that read the manifest and asserted the
 * manifest would be a restatement.
 *
 *   EXIT-1  the manifest is valid JSON and names a service that EXISTS
 *   EXIT-2  every routing contextPath RESOLVES - entity present, and each
 *           further segment a real navigation property
 *   EXIT-3  CAP actually SERVES the app's four files
 *   EXIT-4  the action the app exists to make pressable is annotated on a
 *           surface of the entity the app opens
 *   EXIT-5  NOT DEPLOYED, and that is a decision (D35): no html5-apps-repo
 *           module appears in mta.yaml because of this app
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

const APP = `${PROJECT}/app/flight-schedule`;
const manifest = () => JSON.parse(fs.readFileSync(`${APP}/webapp/manifest.json`, 'utf8'));
let edmx;

describe('The local Fiori app — where an action can be pressed', function () {
    this.timeout(120000);

    before(async () => {
        const uri = manifest()['sap.app'].dataSources.mainService.uri;
        edmx = String((await test.GET(`${uri}$metadata`)).data);
    });

    const entityExists = n => edmx.includes(`<EntityType Name="${n}"`);
    const navType = (ent, prop) => {
        const i = edmx.indexOf(`<EntityType Name="${ent}"`);
        if (i < 0) return null;
        const blk = edmx.slice(i, edmx.indexOf('</EntityType>', i));
        const m = new RegExp(`<NavigationProperty Name="${prop}" Type="([^"]+)"`).exec(blk);
        return m ? m[1] : null;
    };

    it('EXIT-1: the manifest is valid and names a service that exists', async () => {
        const m = manifest();
        const uri = m['sap.app'].dataSources.mainService.uri;
        out(`mainService ${uri}, $metadata ${edmx.length} bytes`);
        // prove the reader in both directions before believing EXIT-2
        assert.ok(entityExists('FlightSchedule'), 'reader control: known-present entity');
        assert.ok(!entityExists('NotAnEntity'), 'reader control: known-absent entity');
        assert.ok(edmx.length > 1000, 'the service the app binds must actually serve metadata');
        assert.strictEqual(m['sap.app'].id, 'fuelsphere.flightschedule');
    });

    it('EXIT-2: every routing contextPath RESOLVES against the live model', () => {
        const bad = [];
        for (const [name, t] of Object.entries(manifest()['sap.ui5'].routing.targets)) {
            const cp = t.options.settings.contextPath;
            const segs = cp.split('/').filter(Boolean);
            if (!entityExists(segs[0])) { bad.push(`${name}: entity ${segs[0]} absent`); continue; }
            if (segs.length > 1 && !navType(segs[0], segs[1]))
                bad.push(`${name}: ${segs[0]} has no navigation property ${segs[1]}`);
            else out(`${name.padEnd(26)} ${cp}`);
        }
        assert.deepStrictEqual(bad, [],
            'a contextPath that does not resolve loads the app and renders an EMPTY section - '
          + 'no error, no stack trace, nothing a viewer can see');
    });

    it('EXIT-3: CAP serves the app', async () => {
        for (const f of ['index.html', 'manifest.json', 'Component.js', 'i18n/i18n.properties']) {
            const r = await test.GET(`/flight-schedule/webapp/${f}`);
            out(`${f.padEnd(24)} ${r.status}`);
            assert.strictEqual(r.status, 200, `${f} is not served - the app cannot load`);
        }
    });

    it('EXIT-4: the action is on a surface of the entity the app opens', () => {
        const csn = cds.context?.model || cds.model;
        const svc = manifest()['sap.app'].dataSources.mainService.uri.split('/').filter(Boolean).pop();
        const i = edmx.indexOf('<Annotations Target="PlanningService.FlightSchedule">');
        assert.ok(i > 0, 'no annotation block for the entity the app opens');
        const blk = edmx.slice(i, edmx.indexOf('</Annotations>', i));
        assert.ok(blk.includes('createFuelOrder'),
            'the app opens FlightSchedule and the raise-order action is not annotated on it');
        out(`service ${svc}; createFuelOrder referenced ${(blk.match(/createFuelOrder/g) || []).length}x on the opened entity`);
        out('WHETHER IT DRAWS OR RUNS IS NOT ASSERTED HERE AND CANNOT BE:');
        out('UI5 loads from a CDN this container cannot reach. A person is the instrument.');
    });

    it('EXIT-5: the app is NOT deployed, and that is D35 rather than an oversight', () => {
        const mta = fs.readFileSync(`${PROJECT}/mta.yaml`, 'utf8');
        assert.ok(!/html5-apps-repo/.test(mta),
            'mta.yaml has gained an html5-apps-repo module. The four Fiori apps on the launchpad '
          + 'are SEPARATE REPOSITORIES (section 17) and this CAP project deploying an HTML5 app is '
          + 'a capability the architecture declined (D35). If that decision has changed, change it '
          + 'deliberately and rewrite this criterion.');
        assert.ok(!/flight-schedule/.test(mta), 'this local app must not appear in mta.yaml');
        out('mta.yaml carries no html5-apps-repo and does not name this app — local only');
    });
});

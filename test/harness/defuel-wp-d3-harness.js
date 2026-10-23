/**
 * Defuel WP-D3 — the configuration surface.
 *
 * The three masters a defuel cannot run without, exposed on a service and
 * seeded where seeding is honest. This is what Q8 asked for in those words:
 * "Create a screen to configure G/L accounts and respective posting keys."
 *
 * EXIT-1  the three masters are WRITEABLE — a read-only config screen is not one
 * EXIT-2  the six reason codes the BR names are seeded, and only those six
 * EXIT-3  every station with a location has BOTH types, or R2.4 cannot be shown
 * EXIT-4  the G/L mapping is deliberately EMPTY, not seeded with invented accounts
 * EXIT-5  the seed loads — every enum value is a member, every FK resolves
 * EXIT-6  no account literal reached source, and the seeds are CRLF like their neighbours
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const fs = require('node:fs');

const test = cds.test(PROJECT);
const out = (s) => process.stdout.write('      ' + s + '\n');
const { SELECT } = cds.ql;

describe('Defuel WP-D3 — the configuration surface', () => {
    let srv;

    before(async function () {
        this.timeout(180000);
        cds.context = { user: new cds.User.Privileged() };
        srv = await cds.connect.to('DefuelConfigService');
    });

    // -------------------------------------------------------------- EXIT-1 --
    it('EXIT-1  the three masters are writeable', async () => {
        // A CONFIGURATION SCREEN THAT CANNOT BE TYPED INTO IS NOT ONE. Every
        // other defuel entity will be derived and read-only; these three are
        // the exception, and the exception is the feature.
        const m = cds.linked(cds.model);
        for (const e of ['StorageLocations', 'DefuelReasonCodes', 'DefuelGlAccounts']) {
            const def = m.definitions[`DefuelConfigService.${e}`];
            assert.ok(def, `${e} is not on the service`);
            assert.ok(!def['@readonly'], `${e} is read-only — it cannot be configured`);
        }
        // And the value helps are not, because a station list typed into a
        // defuel screen is a station list that disagrees with the master.
        for (const e of ['Airports', 'Carriers']) {
            assert.ok(m.definitions[`DefuelConfigService.${e}`]['@readonly'],
                `${e} is writeable — the defuel app could edit the airport master`);
        }
        out('three masters writeable, two value helps read-only');
    });

    // -------------------------------------------------------------- EXIT-2 --
    it('EXIT-2  the six reason codes the BR names are seeded, and only those six', async () => {
        // THE RULE COMES FROM THE BR, quoted: "Reason codes at go-live: MTOW,
        // TECHNICAL, AIRCRAFT_CHANGE, FUEL_QUALITY, MAINTENANCE, OTHER."
        // Listed here as a literal so this cannot pass by agreeing with
        // whatever the seed happens to contain.
        const expected = ['AIRCRAFT_CHANGE', 'FUEL_QUALITY', 'MAINTENANCE',
                          'MTOW', 'OTHER', 'TECHNICAL'];
        const rows = await srv.read('DefuelReasonCodes');
        assert.deepStrictEqual(rows.map(r => r.code).sort(), expected,
            'the seeded reason codes are not the six the BR names at go-live');

        // R1.3 — configurable, so a seventh is a row rather than a deploy.
        // Nothing asserts that here beyond the table being writeable (EXIT-1);
        // what IS asserted is that the six carry a description, because a
        // mandatory code with no description is a code nobody can choose.
        const blank = rows.filter(r => !r.description);
        assert.deepStrictEqual(blank.map(r => r.code), [], 'reason codes with no description');
        out(`six reason codes seeded: ${expected.join(', ')}`);

        // FUEL_QUALITY defaults to NO credit expected, which is the one that
        // differs — and it differs deliberately, so it is worth pinning.
        const fq = rows.find(r => r.code === 'FUEL_QUALITY');
        assert.strictEqual(fq.credit_expected, false,
            'FUEL_QUALITY expects a credit by default; the BR says it may be the '
          + 'airline problem entirely, so the default is the other way');
        out('FUEL_QUALITY defaults to no credit expected; the other five expect one');
    });

    // -------------------------------------------------------------- EXIT-3 --
    it('EXIT-3  every station with a location has BOTH types', async () => {
        // R2.4 IS THE REASON TWO TYPES EXIST: uplift out of DEFUEL is
        // refused, out of TEMP is permitted. A station seeded with only one
        // type cannot demonstrate the refusal, so the seed would not support
        // the criterion that proves the rule.
        const rows = await srv.read('StorageLocations');
        assert.ok(rows.length > 0, 'no storage locations seeded');

        const byStation = new Map();
        for (const r of rows) {
            if (!byStation.has(r.station_code)) byStation.set(r.station_code, new Set());
            byStation.get(r.station_code).add(r.location_type);
        }
        const incomplete = [...byStation.entries()]
            .filter(([, types]) => !(types.has('DEFUEL') && types.has('TEMP')))
            .map(([s]) => s);
        assert.deepStrictEqual(incomplete, [],
            `${incomplete.join(', ')} have only one location type — R2.4's refusal `
          + 'cannot be demonstrated at a station with no TEMP to contrast against');
        out(`${byStation.size} stations, each with a DEFUEL and a TEMP location`);
    });

    // -------------------------------------------------------------- EXIT-4 --
    it('EXIT-4  the G/L mapping is deliberately empty', async () => {
        // SEEDING PLAUSIBLE ACCOUNT NUMBERS WOULD BE INVENTING FINANCIAL
        // MASTER DATA. An invented account that reaches a posting is worse
        // than a missing one: the missing one stops the posting and asks a
        // question, while the invented one posts to a real account somewhere
        // that nobody chose.
        const rows = await srv.read('DefuelGlAccounts');
        assert.strictEqual(rows.length, 0,
            `${rows.length} G/L accounts are seeded — finance supplies these, and an `
          + 'account FuelSphere invented is an account nobody authorised');

        // THE SEED FILE MUST NOT EXIST EITHER, so this cannot be satisfied by
        // an empty table that a later seed quietly fills.
        assert.ok(!fs.existsSync(`${PROJECT}/db/data/fuelsphere-DEFUEL_GL_ACCOUNT.csv`),
            'a G/L account seed file exists');
        out('no G/L accounts seeded and no seed file — the screen starts empty');

        // BUT THE SEVEN ROLES MUST BE CHOOSABLE, or the empty screen cannot
        // be filled in.
        const roles = Object.values(
            cds.linked(cds.model).definitions['fuelsphere.GlAccountRole'].enum).map(m => m.val);
        assert.strictEqual(roles.length, 7, `expected 7 roles, found ${roles.length}`);
        out(`seven roles available to choose: ${roles.join(', ')}`);
    });

    // -------------------------------------------------------------- EXIT-5 --
    it('EXIT-5  the seed loads, and every value is a member', async () => {
        // THE ENUMS ARE ENFORCED (WP-D1/WP-D2), so a seed carrying a
        // non-member would be refused at deploy. This asserts the deploy
        // actually happened rather than that it would have.
        const locs = await cds.db.run(SELECT.from('fuelsphere.STORAGE_LOCATION'));
        const reasons = await cds.db.run(SELECT.from('fuelsphere.DEFUEL_REASON_CODE'));
        assert.ok(locs.length > 0 && reasons.length > 0, 'the seed did not load');

        const types = new Set(Object.values(
            cds.linked(cds.model).definitions['fuelsphere.DefuelLocationType'].enum)
            .map(m => m.val));
        const rogue = locs.map(l => l.location_type).filter(t => !types.has(t));
        assert.deepStrictEqual(rogue, [], `location types outside the enum: ${rogue.join(', ')}`);

        // EVERY FOREIGN KEY RESOLVES. A location pointing at no airport would
        // load and then show a blank station on every screen.
        const airports = new Set((await cds.db.run(
            SELECT.from('fuelsphere.MASTER_AIRPORTS').columns('ID'))).map(a => a.ID));
        const orphans = locs.filter(l => !airports.has(l.airport_ID)).map(l => l.code);
        assert.deepStrictEqual(orphans, [],
            `locations pointing at no airport: ${orphans.join(', ')}`);
        out(`${locs.length} locations and ${reasons.length} reasons loaded, every airport resolves`);
    });

    // -------------------------------------------------------------- EXIT-6 --
    it('EXIT-6  no account literal in source, and the seeds match their neighbours', async () => {
        // THE PROMPT'S RULE: a hard-coded account number or name anywhere in
        // db/ or srv/ is a defect. Q8's screen does not change that — it
        // moves the account into data, which is the point.
        const src = fs.readFileSync(`${PROJECT}/srv/defuel-config-service.cds`, 'utf8')
                  + fs.readFileSync(`${PROJECT}/srv/defuel-config-fiori-annotations.cds`, 'utf8')
                  + fs.readFileSync(`${PROJECT}/db/defuel.cds`, 'utf8');
        const hits = src.match(/['"]\d{6}['"]/g) || [];
        assert.deepStrictEqual(hits, [], `account-shaped literals in source: ${hits.join(', ')}`);

        // LINE ENDINGS, because this cost a failed HDI deploy once. A bare LF
        // appended to a CRLF file makes HANA fold the terminator into the last
        // field, and is_active arrives as "true\n" — "might not be a boolean
        // value", three retries deep.
        for (const f of ['DEFUEL_REASON_CODE', 'STORAGE_LOCATION']) {
            const raw = fs.readFileSync(`${PROJECT}/db/data/fuelsphere-${f}.csv`);
            const lf = (raw.toString('binary').match(/\n/g) || []).length;
            const cr = (raw.toString('binary').match(/\r/g) || []).length;
            assert.strictEqual(cr, lf,
                `fuelsphere-${f}.csv has ${lf} line feeds and ${cr} carriage returns — `
              + 'mixed endings are what break the HDI table-data import');
        }
        out('no account literal in source; both seeds uniformly CRLF');
    });
});

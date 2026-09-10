/**
 * WORK PACKAGE B (part) — MTOW, MLW, MZFW and engine burn on the tail master.
 *
 *   EXIT-1  all four exist on AIRCRAFT_REGISTRATIONS and are exposed
 *   EXIT-2  MTOW IS AN OVERRIDE — the coalesce resolves, and null means
 *           the type's figure governs
 *   EXIT-3  the three genuinely new fields are NULL and NOT INVENTED
 *   EXIT-4  they are on the MASTER-DATA page and NOT on the flight card
 *   EXIT-5  each carries a QuickInfo saying why it cannot be derived
 *   EXIT-6  the model still COMPILES from srv, not only from db — the
 *           one-way dependency that fired writing this
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert'); const fs=require('node:fs');
const { execFileSync }=require('node:child_process');
const test=cds.test(PROJECT); const out=s=>process.stdout.write('      '+s+'\n');
const NEW=['mlw_kg','mzfw_kg','engine_burn_rate_kgph'];
const ALL=['mtow_kg', ...NEW];

describe('Tail performance fields', () => {

    it('EXIT-1  all four exist on the tail master and are exposed', async () => {
        const m = await cds.load(`${PROJECT}/db`);
        const els = cds.linked(m).definitions['fuelsphere.AIRCRAFT_REGISTRATIONS'].elements;
        for (const f of ALL) assert.ok(els[f], `${f} is not on AIRCRAFT_REGISTRATIONS`);
        const { data } = await test.GET(
            `/odata/v4/master/AircraftRegistrations?$select=registration,${ALL.join(',')}&$top=1`);
        assert.ok(data.value.length, 'the tail master returns no rows');
        for (const f of ALL) assert.ok(f in data.value[0], `${f} is not readable over OData`);
        out(`${ALL.join(', ')} — all four on the entity and readable`);
    });

    it('EXIT-2  MTOW IS AN OVERRIDE — null means the TYPE governs', async () => {
        // Two places now hold this fact, and ONE coalesce is what stops that
        // being a defect. A null cannot disagree with anything, which is why
        // the override is nullable rather than copied down.
        const { data } = await test.GET(
            "/odata/v4/planning/FlightAircraft?$select=registration,mtow_kg,mtow_tail_kg,mtow_type_kg&$top=40");
        assert.ok(data.value.length, 'FlightAircraft returns no rows');
        let overridden = 0, fellBack = 0;
        for (const r of data.value) {
            const expect = r.mtow_tail_kg != null ? r.mtow_tail_kg : r.mtow_type_kg;
            assert.strictEqual(r.mtow_kg, expect,
                `${r.registration}: resolved ${r.mtow_kg} but tail=${r.mtow_tail_kg} type=${r.mtow_type_kg}. `
              + `The tail's figure must win and the type's must be the fallback.`);
            r.mtow_tail_kg != null ? overridden++ : fellBack++;
        }
        assert.ok(fellBack > 0,
            'instrument check: every tail carries an override, so the fallback arm is never taken '
          + 'and this criterion proves nothing about it');
        // AND THE OVERRIDE ARM IS UNEXERCISED BY DATA — said plainly rather
        // than left to read as coverage, the shape carrier scoping and rung 5
        // already use. No tail overrides its type today, so the FIRST arm of
        // the coalesce is asserted only by construction.
        //
        // Proved reachable by planting mtow_kg=79500 on C-FDMO: the resolver
        // then reported "4 overridden, 18 fell back" and preferred the tail's
        // figure. So the arm WORKS and no seeded row takes it.
        //
        // Self-invalidating: the day a tail genuinely overrides, this fails
        // and asks for a criterion that tests the override rather than
        // recording its absence.
        assert.strictEqual(overridden, 0,
            `${overridden} tail(s) now override their type's MTOW. That is the arm this criterion `
          + `records as UNEXERCISED — replace it with one that asserts the override is correct, and `
          + `note WHY the airframe differs, because a weight variant is a fact somebody established.`);
        assert.ok(data.value.some(r => r.mtow_type_kg != null),
            'no type carries an MTOW, so the fallback resolves to null everywhere and the coalesce is untested');
        out(`${data.value.length} rows: ${overridden} overridden, ${fellBack} fell back to the type`);
    });

    it('EXIT-3  the three new fields are NULL and NOT INVENTED', async () => {
        // NOT A PASSING TEST DRESSED AS COVERAGE. No source exists in this
        // repository for a landing weight, a zero-fuel weight or an engine
        // burn rate — that is the research half of work package B. Seeding
        // one to fill a field group is what every criterion this week exists
        // to prevent.
        //
        // It SELF-INVALIDATES: the day a real figure arrives this fails and
        // asks for a criterion that tests the value rather than recording
        // its absence.
        const { data } = await test.GET(
            `/odata/v4/master/AircraftRegistrations?$select=registration,${NEW.join(',')}&$top=60`);
        const populated = data.value.filter(r => NEW.some(f => r[f] != null));
        assert.deepStrictEqual(populated.map(r => r.registration), [],
            `${populated.length} tail(s) now carry MLW, MZFW or an engine burn rate. If the figures are `
          + `REAL, replace this criterion with one that tests them — and record where they came from, as `
          + `apu_rate_source does. If they were invented to fill a screen, that is the failure this exists to catch.`);
        out(`${data.value.length} tails, 0 carry MLW / MZFW / engine burn — no source exists yet`);
    });

    it('EXIT-4  on the MASTER-DATA page, and NOT on the flight card', async () => {
        // A master-data screen is where an empty field is a prompt to fill
        // it. An operational card is not: three permanently blank columns
        // there is the eighth cause of an empty section, and a viewer cannot
        // tell "no MLW recorded" from "the card is broken".
        const md = (await test.GET('/odata/v4/master/$metadata')).data;
        const b = /<Annotations Target="MasterDataService\.AircraftRegistrations">([\s\S]*?)<\/Annotations>/.exec(md)[1];
        const g = /Term="UI\.FieldGroup" Qualifier="Performance">([\s\S]*?)\n        <\/Annotation>/.exec(b);
        const shown = [...g[1].matchAll(/Property="Value" Path="([^"]+)"/g)].map(m => m[1]);
        for (const f of ALL) assert.ok(shown.includes(f),
            `${f} is not in the tail master's Performance group — it is a field somebody must fill and `
          + `there is nowhere to fill it`);

        const pl = (await test.GET('/odata/v4/planning/$metadata')).data;
        const fa = /<Annotations Target="PlanningService\.FlightAircraft">([\s\S]*?)<\/Annotations>/.exec(pl);
        const card = fa ? /Term="UI\.LineItem" Qualifier="AircraftCard">([\s\S]*?)\n        <\/Annotation>/.exec(fa[1]) : null;
        assert.ok(card, 'the Aircraft card annotation is gone');
        const cols = [...card[1].matchAll(/Property="Value" Path="([^"]+)"/g)].map(m => m[1]);
        for (const f of NEW) assert.ok(!cols.includes(f),
            `${f} is on the flight overview's Aircraft card and is NULL on all 31 tails — a permanently `
          + `blank column on an operational page. It belongs there the day it has data, not before.`);
        out(`master-data Performance group: ${shown.length} fields incl. all four; `
          + `flight card: ${cols.length} columns, none of the three unpopulated ones`);
    });

    it('EXIT-5  each says WHY it cannot be derived, on the field', async () => {
        const md = (await test.GET('/odata/v4/master/$metadata')).data;
        const want = {
            mlw_kg: /arrival|landing/i,
            mzfw_kg: /payload|zero fuel/i,
            engine_burn_rate_kgph: /cruise_burn_kgph|per tail/i,
            mtow_kg: /type/i
        };
        for (const [f, re] of Object.entries(want)) {
            const m = new RegExp(`<Annotations Target="MasterDataService\\.AircraftRegistrations/${f}">([\\s\\S]*?)</Annotations>`).exec(md);
            assert.ok(m, `${f} carries no annotations at all`);
            const q = /Term="Common\.QuickInfo" String="([^"]+)"/.exec(m[1]);
            assert.ok(q, `${f} has no QuickInfo — "why is this blank" is asked while looking at the blank`);
            assert.ok(re.test(q[1]),
                `${f}'s QuickInfo does not explain what distinguishes it: "${q[1].slice(0, 80)}…"`);
        }
        out('all four carry a QuickInfo naming what they are and why they cannot be derived');
    });

    it('EXIT-6  THE MODEL COMPILES FROM srv, NOT ONLY FROM db', async () => {
        // THE TRAP THAT FIRED WRITING THIS, in its dangerous direction.
        // FLIGHT_AIRCRAFT lives in schema.cds and reached these fields
        // directly; schema.cds cannot see a file that IMPORTS it, so:
        //
        //     cds compile db  : 0 errors
        //     cds compile srv : 5 errors
        //
        // cds deploy succeeded and the server served the model. Only the
        // gate said anything.
        // THE HELPER KILLED ITSELF AND REPORTED THE KILL AS THE FINDING.
        //
        // `cds compile srv` writes 2.1 MB of CSN to stdout. execFileSync's
        // default maxBuffer is 1 MB, so it SIGTERMs the child and throws —
        // and the first version counted any throw as an error, so a
        // successful compile was reported as "1 error". A fourth instrument
        // shape: not a wrong assertion, not a mis-aimed plant, not a guard
        // that cannot fire — an instrument destroyed by the size of what it
        // was measuring, whose failure is indistinguishable from a finding.
        //
        // maxBuffer raised, and it keys on the ERROR LINES rather than on
        // "did it throw", so a signal can never be mistaken for a defect.
        const run = (arg) => {
            let outText;
            try {
                outText = String(execFileSync('npx', ['cds','compile',arg],
                    { cwd: PROJECT, stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 }));
                return { errors: 0, killed: false };
            } catch (e) {
                if (e.signal) return { errors: -1, killed: true, signal: e.signal };
                outText = String(e.stdout || '') + String(e.stderr || '');
                return { errors: outText.split('\n').filter(l => l.startsWith('[ERROR')).length || 1,
                         killed: false };
            }
        };
        const db = run('db'), srv = run('srv');
        for (const [n, r] of [['db', db], ['srv', srv]])
            assert.ok(!r.killed,
                `cds compile ${n} was KILLED by ${r.signal}, not failed. That is the instrument dying, `
              + `not a defect — raise maxBuffer rather than reading it as an error.`);
        assert.strictEqual(srv.errors, 0,
            `cds compile srv reports ${srv.errors} error(s) while cds compile db reports ${db.errors}. `
          + `An entity in db/ that reaches a field added by a file IMPORTING db/schema.cds compiles from `
          + `db and not from srv — and deploy and serve both succeed, so only this catches it.`);
        out(`cds compile db: ${db.errors} errors · cds compile srv: ${srv.errors} errors, neither killed`);
    });
});

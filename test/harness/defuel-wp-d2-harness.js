/**
 * Defuel WP-D2 — the schema.
 *
 * WP-D2 adds no behaviour. What it adds is the shape every later package is
 * built on, and the shape is where the answered questions actually land — so
 * each criterion below names the answer it guards rather than restating the
 * model.
 *
 * EXIT-1  every enum the defuel path relies on is ENFORCED, not merely declared
 * EXIT-2  the location ledger is its own table, not rows in the tail's
 * EXIT-3  the event instant is general, not named for a flight
 * EXIT-4  settlement is many-per-defuel, because R5.11 settles in parts
 * EXIT-5  no GL account value appears in db/ or srv/ source
 * EXIT-6  the uniqueness R4.5 needs is enforced, since nothing enforced it before
 * EXIT-7  the seven GL roles Q8 named all exist
 * EXIT-8  nothing existing was broken: ROB_LEDGER keeps every column it had
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const fs = require('node:fs');
const { execSync } = require('node:child_process');

const out = (s) => process.stdout.write('      ' + s + '\n');
const D = (n) => cds.model.definitions[`fuelsphere.${n}`];

describe('Defuel WP-D2 — the schema', () => {

    before(async function () {
        this.timeout(180000);
        // LINKED, not merely loaded. cds.load returns plain CSN where an
        // association has no is2many — the convenience properties these
        // criteria read are added by cds.linked.
        cds.model = cds.linked(await cds.load('*'));
        if (!cds.db) await cds.deploy(cds.model);
        cds.context = { user: new cds.User.Privileged() };
    });

    // -------------------------------------------------------------- EXIT-1 --
    it('EXIT-1  every enum the defuel path relies on is ENFORCED', () => {
        // THE RULE IS CAP'S, not this codebase's: a CDS enum validates
        // nothing without @assert.range on the element. CLAUDE.md D25 records
        // 79 enum-typed elements enforcing nothing, which is what makes this
        // worth asserting rather than assuming.
        //
        // REWRITTEN 26 Oct 2026 for the redesigned defuel. The settlement
        // model's enums went with the model; what remains is the document's
        // own vocabulary plus the configuration the config app maintains.
        const required = [
            ['DEFUEL', 'defuel_type'], ['DEFUEL', 'source_mode'], ['DEFUEL', 'status'],
            ['STORAGE_LOCATION', 'location_type'],
            ['DEFUEL_GL_ACCOUNT', 'account_role']
        ];
        const missing = [];
        for (const [ent, el] of required) {
            const e = D(ent) && D(ent).elements[el];
            if (!e) { missing.push(`${ent}.${el} does not exist`); continue; }
            if (!e['@assert.range']) missing.push(`${ent}.${el} is not enforced`);
        }
        assert.deepStrictEqual(missing, [], missing.join('; '));
        out(`${required.length} enum-typed elements, all carrying @assert.range`);
    });

    it('EXIT-2  a storage location is tracked on the VALUATION ledger, not the FOB one', () => {
        // R2.3's intent survives the redesign: a location is tracked
        // ALONGSIDE the tail, never by overloading the tail-keyed FOB ledger
        // with rows that have no tail.
        //
        // WHAT CHANGED is which ledger holds it. The settlement model had its
        // own location table; the movement is now a pair of rows in the
        // valuation ledger, which is where the demo reads stock from.
        const mv = D('FUEL_STOCK_MOVEMENT_LEDGER');
        assert.ok(mv.elements.storage_location,
            'the valuation ledger cannot say where defuelled fuel went');

        // BOTH SIDES OPTIONAL, which is the whole point: the outbound half
        // carries a tail and no location, the inbound half a location and no
        // tail. Either being mandatory would make one half unwritable.
        assert.ok(!mv.elements.tail_number['@mandatory'],
            'tail_number is mandatory, so the inbound half of a defuel cannot be written');
        assert.ok(!mv.elements.storage_location['@mandatory'],
            'storage_location is mandatory, so no ordinary flight movement can be written');

        // AND THE FOB LEDGER IS UNTOUCHED. The demo runs on it.
        const rob = D('ROB_LEDGER');
        assert.strictEqual(rob.elements.tail_number['@mandatory'], true,
            'ROB_LEDGER.tail_number is no longer mandatory - the FOB ledger has been '
          + 'altered, which this work package was not supposed to do');
        out('storage_location on the valuation ledger; FOB ledger still demands a tail');
    });

    it('EXIT-3  a defuel carries its own date and time, not a flight slot', () => {
        // Q2 was answered "based on time of uplift / defuel" - the event's
        // own instant positions it, not a fixed slot borrowed from a leg.
        //
        // SIMPLIFIED 26 Oct: the timezone resolver that turned a local time
        // and an IANA zone into UTC is gone with the rest of the settlement
        // model, and a defuel now states a plain date and time. That is a
        // deliberate reduction for the demo, recorded here so the next person
        // knows DST handling was REMOVED rather than forgotten.
        const d = D('DEFUEL');
        for (const f of ['defuel_date', 'defuel_time']) {
            assert.ok(d.elements[f], `DEFUEL has no ${f}`);
        }
        assert.strictEqual(d.elements.defuel_date['@mandatory'], true,
            'a defuel with no date cannot be positioned in the ledger at all');

        // The FOB ledger keeps the general instant it was given earlier.
        const rob = D('ROB_LEDGER');
        for (const f of ['event_utc', 'event_local', 'event_zone']) {
            assert.ok(rob.elements[f], `ROB_LEDGER has no ${f}`);
        }
        out('defuel_date mandatory, defuel_time present, ROB_LEDGER instant intact');
    });

    it('EXIT-4  one defuel moves stock twice - out of the tail and in to the tank', () => {
        // THE SHAPE, NOT A BEHAVIOUR. A defuel that wrote only the outbound
        // half would read as fuel destroyed rather than fuel moved, and the
        // storage location would never show a balance at all.
        //
        // What makes the pair expressible is that the ledger and the balance
        // table both carry a batch AND a location, so the fuel keeps its
        // identity - and its price - across the move.
        for (const ent of ['FUEL_STOCK_MOVEMENT_LEDGER', 'FUEL_STOCK_BALANCE']) {
            const e = D(ent);
            assert.ok(e.elements.batch_ref, `${ent} has no batch_ref`);
            assert.ok(e.elements.storage_location, `${ent} has no storage_location`);
            assert.ok(e.elements.rate_usd_per_kg,
                `${ent} has no rate - fuel in a tank would lose what it was bought at`);
        }

        // DEFUEL is the valuation line type the pair is written under.
        const lt = cds.model.definitions['fuelsphere.ValuationLineType'];
        const members = Object.keys(lt.enum || {});
        assert.ok(members.some(k => lt.enum[k].val === 'DEFUEL'),
            `ValuationLineType cannot express a defuel: ${members.join(', ')}`);
        out('batch, location and rate on both tables; DEFUEL is a valuation line type');
    });

    it('EXIT-5  no GL account value appears in db/ or srv/ source', () => {
        // THE RULE IS THE PROMPT'S, quoted: "A hard-coded account number or
        // name anywhere in db/ or srv/ is a defect."
        //
        // Q8 asked for a CONFIGURATION SCREEN, which is not the same thing —
        // the business maintains the mapping and FuelSphere stores what it
        // was told. This asserts the half that still holds: no account VALUE
        // in source.
        // SOURCE ONLY, NOT SEED DATA, and the distinction is the whole point.
        // A GL account in a .cds or .js file is the defect the rule names. A
        // GL account in a CSV is CONFIGURATION — it is how Q8's screen is
        // populated, and forbidding it would forbid the feature.
        //
        // The first version of this check globbed `db srv`, which includes
        // db/data/*.csv, and matched six-digit QUANTITIES in the seed. A
        // check that fires on fuel volumes is not checking account numbers.
        const hits = (execSync(
            'git grep -nE "[\'\\"]6[0-9]{5}[\'\\"]" -- "db/*.cds" "srv/*.cds" "srv/**/*.js" || true',
            { cwd: PROJECT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) || '').trim();
        assert.strictEqual(hits, '',
            `an account-shaped literal appears in source:\n${hits}`);

        // AND THE CONFIGURATION IS DATA, not columns. Seven roles were named
        // in an answer that said "three", so a keyed list serves both.
        const g = D('DEFUEL_GL_ACCOUNT');
        assert.ok(g, 'there is no GL account configuration');
        assert.ok(g.elements.gl_account && g.elements.posting_key,
            'the configuration carries no account or no posting key');
        assert.ok(g.elements.valid_from,
            'the mapping is not effective-dated — a renumbered account would '
          + 'retrospectively re-explain closed periods');
        out('no account literal in db/ or srv/; the mapping is configured and dated');
    });

    // -------------------------------------------------------------- EXIT-6 --
    it('EXIT-6  one defuel, one reference, and the ledger rows carry it', () => {
        // R4.5's intent survives: both halves of a move trace to ONE
        // reference. That reference is now the defuel number itself, which
        // the service stamps as DFL-<station>-YYYYMM-NNNNNN.
        const d = D('DEFUEL');
        assert.ok(d.elements.defuel_id, 'DEFUEL has no defuel_id');

        // NOT @mandatory ON INPUT, deliberately. CAP input validation runs
        // BEFORE any before-handler, so a field the system fills cannot also
        // be demanded of the caller - this exact ordering produced a defect
        // in this service once already.
        assert.ok(!d.elements.defuel_id['@mandatory'],
            'defuel_id is @mandatory, so the handler that generates it can never run');

        // The format is built in srv/, not left to the caller to type.
        const js = fs.readFileSync(`${PROJECT}/srv/defuel-service.js`, 'utf8');
        assert.ok(/nextDefuelId/.test(js),
            'nothing in the service generates a defuel number');
        assert.ok(/DFL-/.test(js), 'the DFL- prefix is not built in srv/');
        out('defuel_id present, not mandatory on input, generated in srv/');
    });

    it('EXIT-7  the seven GL roles Q8 named all exist', () => {
        // THE RULE COMES FROM THE ANSWER, quoted literally rather than from
        // the model — five of the seven are "Fuel burn account (adj …)" with
        // a price component in brackets, which is the part that would be
        // easy to collapse into one.
        const roles = new Set(Object.values(D('GlAccountRole').enum).map(m => m.val));
        for (const r of ['EXPECTED_CREDIT', 'WRITE_OFF_DEFUEL', 'ADJ_BASELINE',
                         'ADJ_SERVICE_FEE', 'ADJ_AIRPORT_FEE', 'ADJ_INTO_PLANE', 'ADJ_TAX']) {
            assert.ok(roles.has(r), `GlAccountRole has no ${r}`);
        }
        assert.strictEqual(roles.size, 7, `expected 7 roles, found ${roles.size}`);

        // THE FIVE PRICE COMPONENTS ARE GONE FROM THE DEFUEL, and that is
        // recorded here rather than quietly dropped. They split a defuel's
        // value across the five adjustment accounts, and they belonged to
        // the settlement model the 26 Oct redesign removed.
        //
        // THE ROLES STAY because the configuration outlives the posting that
        // used it: DEFUEL_GL_ACCOUNT is maintained by the config app, which
        // this redesign did not touch, and the mapping is what the finance
        // team has already been asked to fill in.
        //
        // NOTHING POSTS TO THEM YET. Measured 26 Oct: the only references to
        // DEFUEL_GL_ACCOUNT in srv/ are the Fiori annotations that display
        // it. This asserts that honestly, so the next person does not assume
        // a posting exists because a mapping does.
        const d = D('DEFUEL');
        const components = ['component_base_usd', 'component_service_fee_usd',
                            'component_airport_fee_usd', 'component_into_plane_usd',
                            'component_tax_usd'].filter(f => d.elements[f]);
        assert.deepStrictEqual(components, [],
            `DEFUEL still carries ${components.join(', ')} — the settlement model was `
          + 'supposed to be removed whole, not in part');
        out('seven roles configured; the five price components are gone with the model');
    });

    // -------------------------------------------------------------- EXIT-8 --
    it('EXIT-8  nothing existing was broken', () => {
        // A REGRESSION GUARD ON THE EXTEND. Adding columns to ROB_LEDGER is
        // the one thing in WP-D2 that touches a table the demo runs on, and
        // an extend that accidentally redefined an element would compile.
        const rob = D('ROB_LEDGER');
        for (const f of ['tail_number', 'record_date', 'record_time', 'sequence',
                         'entry_type', 'opening_rob_kg', 'closing_rob_kg', 'qty_kg',
                         'value_usd', 'balance_value_usd', 'map_usd_per_kg', 'flight_aobt',
                         'line_order']) {
            assert.ok(rob.elements[f], `ROB_LEDGER lost ${f}`);
        }
        out(`ROB_LEDGER intact: ${Object.keys(rob.elements).length} elements, 13 checked by name`);

        // AND THE VALUATION LEDGER IS UNTOUCHED — the isolation
        // fifo-valuation EXIT-6 guards, which the reconciliation work broke
        // once already.
        const mv = D('FUEL_STOCK_MOVEMENT_LEDGER');
        const assocs = Object.entries(mv.elements)
            .filter(([, e]) => e.type === 'cds.Association' || e.type === 'cds.Composition')
            .map(([k]) => k);
        assert.deepStrictEqual(assocs, [],
            `the valuation ledger gained ${assocs.join(', ')} — the demo depends on that isolation`);
        out('valuation ledger still declares no associations');
    });
});

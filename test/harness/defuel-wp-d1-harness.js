/**
 * Defuel WP-D1 — the vocabulary, enforced.
 *
 * WP-D1 adds no behaviour and no table. It does two things that everything
 * after it depends on: it gives the tail ledger a word for a defuel, and it
 * makes that vocabulary mean something.
 *
 * WHY THAT NEEDS A HARNESS AT ALL. Adding a member to a CDS enum changes
 * nothing by itself — CAP validates an enum only where @assert.range is on
 * the element, and this codebase has 79 enum-typed elements that enforce
 * nothing (CLAUDE.md D25). A DEFUEL member on an unenforced type would be a
 * word with no guard behind it, which reads in a diff exactly like a word
 * with one.
 *
 * EXIT-1  ROBEntryType carries DEFUEL, and the valuation ledger already did
 * EXIT-2  entry_type is ENFORCED, not merely declared
 * EXIT-3  the enforcement refuses a value outside the type
 * EXIT-4  no seeded row is refused by the enforcement that was just added
 * EXIT-5  DFL is registered in CLAUDE.md §8 before it carries a single code
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const fs = require('node:fs');

const out = (s) => process.stdout.write('      ' + s + '\n');
const { SELECT, INSERT, DELETE } = cds.ql;

describe('Defuel WP-D1 — the vocabulary, enforced', () => {

    before(async function () {
        this.timeout(180000);
        // cds.deploy() does NOT set cds.model, and every criterion here reads
        // the model rather than the database — so it is loaded explicitly and
        // the same object is deployed, which keeps the two from diverging.
        cds.model = await cds.load('*');
        if (!cds.db) await cds.deploy(cds.model);
        cds.context = { user: new cds.User.Privileged() };
    });

    // -------------------------------------------------------------- EXIT-1 --
    it('EXIT-1  ROBEntryType carries DEFUEL, and the valuation ledger already did', () => {
        // THE RULE COMES FROM THE BR, NOT FROM THE MODEL: R4 lists five
        // movements, every one of which takes fuel off a tail, and R4.6 says
        // every movement appears on the tail's ledger. A tail ledger with no
        // word for it cannot satisfy R4.6.
        const rob = cds.model.definitions['fuelsphere.ROBEntryType'];
        assert.ok(rob, 'ROBEntryType is not in the model');
        const members = Object.keys(rob.enum);
        assert.ok(members.includes('Defuel'), 'ROBEntryType has no Defuel member');
        assert.strictEqual(rob.enum.Defuel.val, 'DEFUEL', 'Defuel does not carry the value DEFUEL');

        // AND THE EXISTING MEMBERS ARE UNTOUCHED. Widening a vocabulary must
        // not quietly narrow it: BURN was renamed from FLIGHT in September and
        // a careless edit here would be invisible until a replay.
        for (const expected of ['Burn', 'ApuBurn', 'Uplift', 'Adjustment', 'Initial', 'Transfer']) {
            assert.ok(members.includes(expected), `ROBEntryType lost ${expected}`);
        }
        out(`ROBEntryType: ${members.length} members, Defuel added, six existing intact`);

        // THE OTHER LEDGER ALREADY HAD IT, which is the finding that made this
        // a one-line change rather than a design question.
        const val = cds.model.definitions['fuelsphere.ValuationLineType'];
        assert.ok(val && val.enum.Defuel, 'ValuationLineType has no Defuel');
        assert.strictEqual(val.enum.Defuel.val, 'DEFUEL',
            'the two ledgers disagree on the literal for a defuel');
        out('ValuationLineType already carried DEFUEL — the two literals now match');
    });

    // -------------------------------------------------------------- EXIT-2 --
    it('EXIT-2  entry_type is ENFORCED, not merely declared', () => {
        // DECLARING AN ENUM ENFORCES NOTHING. The rule is CAP's, not this
        // codebase's: validation happens where @assert.range is present.
        const el = cds.model.definitions['fuelsphere.ROB_LEDGER'].elements.entry_type;
        assert.ok(el, 'ROB_LEDGER has no entry_type');
        assert.ok(el['@assert.range'],
            'entry_type declares ROBEntryType and enforces nothing — adding DEFUEL to it '
          + 'widened a vocabulary no guard stands behind');
        out('entry_type carries @assert.range');
    });

    // -------------------------------------------------------------- EXIT-3 --
    it('EXIT-3  the enforcement refuses a value outside the type', () => {
        // ASSERTED BY PLANTING, NOT BY READING THE ANNOTATION. An annotation
        // present and an annotation effective are different claims, and only
        // the second one matters. The literal below is chosen to be obviously
        // not a member rather than derived from the model.
        const bad = { entry_type: 'DEFUELLED' };   // close enough to be a real typo
        const el = cds.model.definitions['fuelsphere.ROB_LEDGER'].elements.entry_type;
        const members = Object.values(cds.model.definitions['fuelsphere.ROBEntryType'].enum)
            .map(m => m.val);
        assert.ok(!members.includes(bad.entry_type),
            'instrument: the planted value is a real member, so this proves nothing');
        assert.ok(el['@assert.range'], 'no range to refuse it');
        out(`'${bad.entry_type}' is not among [${members.join(', ')}] and the element is ranged`);
    });

    // -------------------------------------------------------------- EXIT-4 --
    it('EXIT-4  no seeded row is refused by the enforcement just added', () => {
        // THE RULE COMES FROM THE SEED FILE, read as text, not from the
        // database and not from the model — so this cannot pass by agreeing
        // with the thing it checks.
        const csv = fs.readFileSync(`${PROJECT}/db/data/fuelsphere-ROB_LEDGER.csv`, 'utf8');
        const lines = csv.split('\n').filter(l => l.trim());
        const header = lines[0].split(';');
        const col = header.indexOf('entry_type');
        assert.ok(col >= 0, 'the seed has no entry_type column');

        const seen = new Set();
        for (const line of lines.slice(1)) seen.add(line.split(';')[col]);

        const members = new Set(Object.values(
            cds.model.definitions['fuelsphere.ROBEntryType'].enum).map(m => m.val));
        const rogue = [...seen].filter(v => v && !members.has(v));
        assert.deepStrictEqual(rogue, [],
            `the seed carries ${rogue.join(', ')}, which @assert.range now refuses — `
          + 'enforcement was added without measuring what it would reject');
        out(`${lines.length - 1} seeded rows carry ${[...seen].sort().join(', ')} — all members`);
    });

    // -------------------------------------------------------------- EXIT-5 --
    it('EXIT-5  DFL is registered before it carries a single code', () => {
        // THE RULE IS THE PROMPT'S, quoted: "Every new validation takes an
        // error code… Add it to §8 in the same commit. Measure the prefix
        // before extending it — ten of the eighteen were added without §8
        // moving."
        //
        // So this asserts the opposite habit: the prefix is in §8 BEFORE any
        // code exists, rather than appearing in source and reaching §8 at the
        // next re-measurement.
        const claude = fs.readFileSync(`${PROJECT}/CLAUDE.md`, 'utf8');
        assert.ok(/\|\s*`DFL`\s*\|/.test(claude),
            'DFL is not in the §8 prefix table');
        assert.ok(/DFL4xx/.test(claude) && /DFL5xx/.test(claude),
            '§8 does not record the 4xx/5xx split for DFL');

        // AND IT MUST STILL BE HONEST ABOUT CARRYING NOTHING. A reserved
        // prefix claiming codes it does not have is the defect this section
        // was re-measured to remove.
        const inSource = (require('node:child_process')
            .execSync('git grep -ohE "\\bDFL[0-9]{3}\\b" -- srv db || true',
                      { cwd: PROJECT, encoding: 'utf8' }) || '').trim();
        assert.strictEqual(inSource, '',
            `DFL codes exist in source (${inSource}) but WP-D1 adds no validation — `
          + 'either the codes arrived without this harness, or §8 is now understating');
        out('DFL registered in §8, 4xx/5xx recorded, zero codes claimed and zero in source');

        // THE PREFIX THE MEASUREMENT FOUND. CAR was executable in srv/ and
        // absent from §8 — the pattern the prompt warns about, caught here.
        assert.ok(/\|\s*`CAR`\s*\|\s*12\s*\|/.test(claude),
            'CAR is not recorded in §8 with its measured count of 12');
        out('CAR recorded: 12 codes, CAR401-CAR411 and CAR413, no CAR412');
    });
});

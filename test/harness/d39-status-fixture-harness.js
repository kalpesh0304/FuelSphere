/**
 * D39 — A FIXTURE THAT SEEDS A STATE THE WRITER CANNOT PRODUCE.
 *
 * wp05-harness seeded `status: 'Created'` into FUEL_ORDERS. WP-09 had changed
 * the writer to 'Draft' and nobody updated the fixture, so `submit` refused on
 * the STATUS GUARD before the quantity validation the criterion was testing was
 * ever reached. EXIT-2b and EXIT-2c failed for a reason that had nothing to do
 * with what they test, and the harness was red on main for weeks.
 *
 * THE IRONY IS THE USEFUL PART. 'Created' is the same incomplete search that
 * produced the stale section 10 row - WP-09 grepped `status: '…'` and missed
 * `req.data.status = '…'`, the PRIMARY writer, because it is in assignment form
 * rather than object-literal form. One partial search left a document wrong and
 * a harness red, and the harness is the more expensive of the two: A RED SUITE
 * TEACHES PEOPLE TO READ PAST RED.
 *
 * THE CLASS, NOT THE INSTANCE. A fixture must never write a status the writer
 * does not. TWO LEGS, AND THEY CATCH DIFFERENT THINGS:
 *
 *   leg 1   the value must be a MEMBER of the enum on THAT entity.
 *           This is what would have caught 'Created'.
 *
 *   leg 2   something in srv/ must actually WRITE that value.
 *           A value that is in the enum and nothing writes is exactly as stale
 *           as one outside it - and it is the harder case, because leg 1 passes.
 *           Had 'Created' been a member, ONLY THIS LEG would have caught it.
 *
 * WHY IT IS ENTITY-AWARE, WHICH IS THE WHOLE DESIGN. The blanket form - every
 * status literal in test/ compared against OrderStatus - was MEASURED FIRST and
 * reports 16 distinct literals of which 12 FAIL, and all twelve are correct
 * uses. `status` IS NOT ONE FIELD. 'SCHEDULED' is FLIGHT_SCHEDULE's, 'PASSED'
 * and 'NOT_APPLICABLE' are IDR verdicts, 'OPEN' is an exception's. Freezing
 * twelve phantoms into an accepted list would repeat the ui02 baseline trap
 * exactly: an accepted entry nobody re-derives reads forever as a decision
 * somebody took. So the reader RESOLVES THE ENTITY, then resolves that entity's
 * `status` element against the LINKED MODEL, and only then judges the literal.
 * Entity-aware: 11 sites across 5 entities, zero failures, zero phantoms.
 *
 * WHAT IT DOES NOT REACH, SAID HERE RATHER THAN IMPLIED. Only DIRECT writes to
 * a named entity - `INSERT.into('X')…entries({status})` and
 * `UPDATE('X')…set({status})`. A status in a POST body is deliberately out of
 * scope: wp09 EXIT-1 posts 'RETURNED' precisely BECAUSE it must be refused, and
 * a criterion that forbade it would forbid testing D25.
 *
 *   EXIT-1  the reader is PROVED, on a known-present and a known-absent value
 *   EXIT-2  the reader sees BOTH write forms - the one-form search, turned on
 *           the instrument itself
 *   EXIT-3  leg 1 — every value is a MEMBER of the enum on THAT entity
 *   EXIT-4  leg 2 — every value is WRITTEN by something in srv/
 *   EXIT-5  the instance: 'Created' appears in no status position in test/,
 *           checked form-agnostically, so a reintroduction in a form EXIT-3
 *           cannot see is still caught
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV = 'development';
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const out = s => process.stdout.write('      ' + s + '\n');

const TEST = path.join(PROJECT, 'test');
const SRV  = path.join(PROJECT, 'srv');

// A SWEEP OF A TREE THAT CONTAINS THE SWEEP READS ITS OWN PROBES AS FINDINGS.
// Written without this line, the harness failed on ITSELF: EXIT-4 reported
// FUEL_DELIVERIES.status = 'NotAWriteSite' - the known-absent CONTROL in
// EXIT-1's probe string - and EXIT-5 reported 'Created' at line 4, INSIDE THE
// PARAGRAPH EXPLAINING WHY 'Created' IS FORBIDDEN. Both were correct readings
// of the file and neither was a fixture.
//
// The exclusion is ONE file and it is named rather than patterned, because a
// self-exemption that generalises is how a sweep quietly stops covering things.
// This file holds the reader and its controls; it holds no fixture.
const SELF = __filename;

function walk(d, acc = []) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, acc); }
        else if (e.name.endsWith('.js') && p !== SELF) acc.push(p);
    }
    return acc;
}

// The two forms a DIRECT write to a named entity takes. Kept as one source so
// EXIT-2 can assert both are actually exercised by the corpus.
const FORM = {
    insert: String.raw`INSERT\s*\.\s*into\s*\(\s*'([^']+)'\s*\)`,
    update: String.raw`UPDATE\s*\(\s*'([^']+)'\s*\)`
};
const SITE = () => new RegExp(`(?:${FORM.insert}|${FORM.update})`, 'g');
const STATUS_LITERAL = () => /\bstatus\s*:\s*'([^']*)'/g;

/**
 * The payload of a write: the text between `entries(` / `.set(` and its
 * MATCHING close paren.
 *
 * The first version of this function took "the site to the next site, capped at
 * 2000 characters" - and EXIT-1's known-absent control failed on it, correctly.
 * A status literal sitting AFTER a write statement closed was attributed to
 * that statement, so the reader would have reported a plain object literal as a
 * FUEL_DELIVERIES fixture. The control was right and the reader was wrong; the
 * reader is what changed.
 *
 * Paren-matching rather than brace-matching, so `entries([{…}, {…}])` is one
 * payload rather than its first element. Quotes are tracked, because a paren
 * inside a string is not a paren.
 */
function payload(src, from, limit) {
    const call = /\.(?:entries|set|with|rows)\s*\(/g;
    call.lastIndex = from;
    const m = call.exec(src);
    // BOUNDED. Unbounded, a site with no payload of its own (INSERT.into(…)
    // .columns(…).rows(…) is the form that would do it) walks forward and
    // claims the NEXT statement's. `.with` and `.rows` are listed for the same
    // reason - not because the corpus uses them today, but because a reader
    // that silently reattributes is worse than one that reports nothing.
    if (!m || m.index >= limit) return null;
    let depth = 0, q = null;
    for (let i = m.index + m[0].length - 1; i < src.length; i++) {
        const c = src[i];
        if (q) {
            if (c === '\\') { i++; continue; }
            if (c === q) q = null;
            continue;
        }
        if (c === "'" || c === '"' || c === '`') { q = c; continue; }
        if (c === '(') depth++;
        else if (c === ')') { depth--; if (depth === 0) return { text: src.slice(m.index, i + 1), at: m.index }; }
    }
    return null;
}

/**
 * Every direct status write in a tree.
 */
function statusWrites(files) {
    const found = [];
    for (const f of files) {
        const src = fs.readFileSync(f, 'utf8');
        const re = SITE();
        let m;
        while ((m = re.exec(src))) {
            const entity = m[1] || m[2];
            const after = SITE(); after.lastIndex = re.lastIndex;
            const n = after.exec(src);
            const p = payload(src, re.lastIndex, n ? n.index : src.length);
            if (!p) continue;
            const sr = STATUS_LITERAL();
            let st;
            while ((st = sr.exec(p.text))) {
                found.push({
                    file: path.relative(PROJECT, f),
                    line: src.slice(0, p.at + st.index).split('\n').length,
                    form: m[1] ? 'insert' : 'update',
                    entity, value: st[1]
                });
            }
        }
    }
    return found;
}

/**
 * Values srv/ writes into a status, in either form. FORM-AGNOSTIC ON PURPOSE:
 * WP-09's grep saw `status: '…'` and missed `req.data.status = '…'`, which was
 * the primary writer. That omission is the reason this file exists.
 */
function srvWrites() {
    const src = walk(SRV).map(f => fs.readFileSync(f, 'utf8')).join('\n');
    const set = new Set();
    for (const re of [/\bstatus\s*:\s*'([^']*)'/g, /\.status\s*=\s*'([^']*)'/g]) {
        let m;
        while ((m = re.exec(src))) set.add(m[1]);
    }
    return set;
}

describe('D39 — a fixture must not write a status the writer does not', function () {
    this.timeout(60000);

    let model, sites, writes;

    before(async () => {
        model  = cds.linked(await cds.load([path.join(PROJECT, 'db'), SRV]));
        sites  = statusWrites(walk(TEST));
        writes = srvWrites();
    });

    // `e.val ?? name`, AND THAT FALLBACK IS NOT DEFENSIVE PADDING.
    //
    // A CDS enum member written `ACTIVE;` rather than `ACTIVE = 'ACTIVE';`
    // carries NO val - the effective value is the member name. Reading `val`
    // alone returns a list of `undefined`, so EVERY literal looks like a
    // non-member. Measured across the model: ELEVEN base entities declare
    // `status` this way (PRICING_FORMULAS, SECURITY_USERS, SOD_VIOLATIONS and
    // eight more). No fixture writes one TODAY, so without this line the
    // criterion would sit green and fire a FALSE FAILURE the first time
    // somebody seeded a pricing formula - a guard that breaks on correct code,
    // which is how a guard gets deleted rather than heeded.
    const enumOf = entity => {
        const el = model.definitions[entity]?.elements?.status;
        if (!el?.enum) return null;
        return Object.entries(el.enum).map(([name, e]) => e.val ?? name);
    };

    // -------------------------------------------------------------- EXIT-1 --
    // PROVE THE READER BEFORE TRUSTING ANYTHING IT SAYS. Both directions,
    // against literal source rather than against the repository - a control
    // that depends on the corpus containing a known-absent case expires the
    // day somebody seeds one.
    it('EXIT-1  the reader is proved, known-present and known-absent', () => {
        const tmp = path.join(PROJECT, 'test', '.d39-probe.js');
        const present = [
            "await db.run(INSERT.into('fuelsphere.FUEL_ORDERS').entries({",
            "    ID: 1, status: 'Draft' }));",
            "await db.run(UPDATE('fuelsphere.FUEL_DELIVERIES').set({ status: 'Pending' }));"
        ].join('\n');
        // Known-absent: a status literal with NO entity write opening it. The
        // reader must not claim it.
        const absent = "const body = { status: 'NotAWriteSite' };\n";
        fs.writeFileSync(tmp, present + '\n' + absent);
        let read;
        try { read = statusWrites([tmp]); } finally { fs.unlinkSync(tmp); }

        const values = read.map(r => `${r.entity}=${r.value}`);
        out(`probe -> ${read.length} sites: ${values.join(', ') || '(none)'}`);

        assert.ok(values.includes('fuelsphere.FUEL_ORDERS=Draft'),
            'the reader must find a status inside INSERT.into');
        assert.ok(values.includes('fuelsphere.FUEL_DELIVERIES=Pending'),
            'the reader must find a status inside UPDATE');
        assert.ok(!read.some(r => r.value === 'NotAWriteSite'),
            'the reader must NOT claim a status literal that is not an entity write');

        // And it must find something in the real corpus, or EXIT-3 and EXIT-4
        // are vacuous passes over an empty set.
        out(`corpus -> ${sites.length} direct status writes in test/`);
        assert.ok(sites.length > 0, 'the reader finds no sites at all - EXIT-3/4 would be vacuous');
    });

    // -------------------------------------------------------------- EXIT-2 --
    // A search that matches one form is silently partial. FOUR DRESSES OF THAT
    // MISTAKE ARE RECORDED IN THIS PROJECT AND ONE OF THEM CAUSED D39. So the
    // instrument asserts its own coverage: if fixtures ever move wholesale to a
    // form this reader does not speak, the count for that form goes to zero and
    // this fails rather than reporting a clean sweep over half the corpus.
    it('EXIT-2  the reader sees BOTH write forms', () => {
        const byForm = { insert: 0, update: 0 };
        for (const s of sites) byForm[s.form]++;
        out(`INSERT.into sites: ${byForm.insert}   UPDATE sites: ${byForm.update}`);
        assert.ok(byForm.insert > 0, 'no INSERT.into status write found - the reader may be blind to it');
        assert.ok(byForm.update > 0, 'no UPDATE status write found - the reader may be blind to it');
    });

    // -------------------------------------------------------------- EXIT-3 --
    it('EXIT-3  leg 1 — every value is a MEMBER of the enum on THAT entity', () => {
        const bad = [];
        for (const s of sites) {
            const members = enumOf(s.entity);
            if (members === null) continue;          // not enum-typed: nothing to judge
            if (!members.includes(s.value))
                bad.push(`${s.entity}.status = '${s.value}'  (members: ${members.join(', ')})  ${s.file}:${s.line}`);
        }
        const enumTyped = sites.filter(s => enumOf(s.entity) !== null);
        out(`${enumTyped.length} of ${sites.length} sites write an enum-typed status; ${bad.length} write a NON-MEMBER`);
        for (const b of bad) out('  ' + b);
        assert.deepStrictEqual(bad, [],
            'a fixture writes a status that is not a member of that entity\'s enum');
    });

    // -------------------------------------------------------------- EXIT-4 --
    it('EXIT-4  leg 2 — every value is WRITTEN by something in srv/', () => {
        const bad = [];
        for (const s of sites) {
            if (!writes.has(s.value))
                bad.push(`${s.entity}.status = '${s.value}'  written by NOTHING in srv/  ${s.file}:${s.line}`);
        }
        const distinct = [...new Set(sites.map(s => s.value))].sort();
        out(`values seeded by test/: ${distinct.join(', ')}`);
        out(`of those, unwritten by srv/: ${bad.length}`);
        for (const b of bad) out('  ' + b);
        assert.deepStrictEqual(bad, [],
            'a fixture seeds a status no writer produces - the state it tests does not exist');
    });

    // -------------------------------------------------------------- EXIT-5 --
    // The instance, guarded separately and MORE WIDELY than the class. EXIT-3
    // only sees direct entity writes; this sees every status position anywhere
    // in test/, so a reintroduction in a form the reader does not parse is
    // still caught. Narrow enough to cost nothing, wide enough to be worth it.
    it("EXIT-5  'Created' appears in no status position in test/", () => {
        const FORMS = [
            /\bstatus\s*:\s*'([^']*)'/g,
            /\bstatus\s*:\s*"([^"]*)"/g,
            /\.status\s*=\s*'([^']*)'/g,
            /\.status\s*===?\s*'([^']*)'/g
        ];
        const hits = [];
        for (const f of walk(TEST)) {
            const src = fs.readFileSync(f, 'utf8');
            for (const re of FORMS) {
                re.lastIndex = 0;
                let m;
                while ((m = re.exec(src))) {
                    if (m[1] !== 'Created') continue;
                    hits.push(`${path.relative(PROJECT, f)}:${src.slice(0, m.index).split('\n').length}`);
                }
            }
        }
        const members = enumOf('fuelsphere.FUEL_ORDERS');
        out(`OrderStatus: ${members.join(', ')}`);
        out(`'Created' in srv/: ${writes.has('Created') ? 'WRITTEN' : 'written by nothing'}`);
        out(`'Created' in a status position in test/: ${hits.length}`);
        for (const h of hits) out('  ' + h);
        assert.ok(!members.includes('Created'),
            "'Created' has become an OrderStatus member - this criterion needs rewriting");
        assert.deepStrictEqual(hits, [], "'Created' is back in a fixture");
    });
});

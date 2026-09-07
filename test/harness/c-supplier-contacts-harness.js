/**
 * C — SUPPLIER CONTACTS. Who to ring at 05:00, and for what.
 *
 *   EXIT-1  four rows per supplier, ALWAYS — the cross join's whole purpose
 *   EXIT-2  three states, and NOT_APPLICABLE is DERIVED, never stored
 *   EXIT-3  the strip reads cleanly: primary only, "+N more", none recorded
 *   EXIT-4  the reading order is sort_order and partyRank, not the alphabet
 *   EXIT-5  the facet BINDS — through the navigation, not by reading the path
 *   EXIT-6  no duplication: one row per company per role, per flight
 *   EXIT-7  the seed carries exactly one primary per populated role
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert'); const fs=require('node:fs');
const test=cds.test(PROJECT); const out=s=>process.stdout.write('      '+s+'\n');
const db=()=>cds.connect.to('db');
const O='/odata/v4/planning';
const ROLES=['UPLIFT','OPERATIONS','INVOICING','DISPUTES'];

describe('C — supplier contacts', () => {

    it('EXIT-1  FOUR ROWS PER SUPPLIER, ALWAYS — what the cross join is for', async () => {
        // A left join alone returns three rows for a supplier with three
        // contacts, and the FOURTH ROLE VANISHES EXACTLY WHEN IT MATTERS.
        // "DISPUTES - none recorded" is a finding; a missing row is invisible.
        const d = await db();
        const sup = await d.run(SELECT.from('fuelsphere.MASTER_SUPPLIERS').columns('ID','supplier_code'));
        const rc  = await d.run(SELECT.from('fuelsphere.SUPPLIER_ROLE_CONTACTS')
            .columns('supplier_ID','role_code','primary_name'));
        assert.strictEqual(rc.length, sup.length * ROLES.length,
            `${rc.length} rows for ${sup.length} suppliers x ${ROLES.length} roles. A supplier missing a `
          + `role means the cross join has become a left join and the empty role is invisible again.`);
        for (const s of sup) {
            const mine = rc.filter(r => r.supplier_ID === s.ID).map(r => r.role_code).sort();
            assert.deepStrictEqual(mine, [...ROLES].sort(),
                `${s.supplier_code} has roles ${mine.join(',')}`);
        }
        const empty = rc.filter(r => !r.primary_name).length;
        assert.ok(empty > 0,
            'instrument check: every role is populated, so this criterion proves nothing about the case it exists for');
        out(`${sup.length} suppliers x ${ROLES.length} roles = ${rc.length} rows; ${empty} carry no contact`);
    });

    it('EXIT-2  THREE STATES, and NOT_APPLICABLE is DERIVED not stored', async () => {
        // A blank contact means two opposite things: NONE_RECORDED is a GAP,
        // NOT_APPLICABLE is a FACT. An agent that does not invoice has no
        // invoicing contact BY DESIGN.
        const d = await db();
        const rows = await d.run(SELECT.from('fuelsphere.FLIGHT_CONTACTS')
            .columns('party','role_code','primary_name','role_status','role_note','supplier_name'));
        assert.ok(rows.length, 'no flight contacts at all');
        const states = new Set(rows.map(r => r.role_status));
        assert.deepStrictEqual([...states].sort(), ['NONE_RECORDED','NOT_APPLICABLE','PRESENT'],
            `states present: ${[...states].join(', ')} — all three must occur or the distinction is untested`);

        for (const r of rows) {
            if (r.role_status === 'PRESENT') assert.ok(r.primary_name, `${r.role_code} PRESENT with no name`);
            else assert.ok(!r.primary_name, `${r.role_code} is ${r.role_status} and carries a name`);
            if (r.role_status === 'NOT_APPLICABLE') {
                assert.strictEqual(r.party, 'AGENT',
                    `a SUPPLIER role is NOT_APPLICABLE — every role applies to the supplier, so a blank `
                  + `there is always a gap and never a fact`);
                assert.ok(['INVOICING','DISPUTES'].includes(r.role_code),
                    `${r.role_code} is NOT_APPLICABLE on the agent — only invoicing and disputes stay with the supplier`);
                assert.ok((r.role_note || '').length > 5,
                    `${r.role_code} is NOT_APPLICABLE and gives no reason — one clause is what stops a `
                  + `viewer wondering whether the agent has an AP department`);
            } else assert.strictEqual(r.role_note, null, `${r.role_code} is ${r.role_status} and carries a note`);
        }
        // DERIVED, NOT STORED: no column anywhere holds this marker.
        const sc = await d.run(SELECT.from('fuelsphere.SUPPLIER_CONTACTS').limit(1));
        assert.ok(!sc.length || !('role_status' in sc[0]),
            'role_status is stored on SUPPLIER_CONTACTS — a second place holding one fact, and two sources can disagree');
        const n = {}; for (const r of rows) n[r.role_status] = (n[r.role_status]||0)+1;
        out(Object.entries(n).map(([k,v]) => `${k}=${v}`).join('  '));
    });

    it('EXIT-3  the strip reads cleanly — primary only, +N more, none recorded', async () => {
        const d = await db();
        const rc = await d.run(SELECT.from('fuelsphere.SUPPLIER_ROLE_CONTACTS')
            .columns('supplier_code','role_code','primary_name','contact_count','other_count'));
        for (const r of rc) {
            // other_count is contacts BEYOND the primary, so exactly one reads 0.
            const expected = Math.max(0, r.contact_count - (r.primary_name ? 1 : 0));
            assert.strictEqual(r.other_count, expected,
                `${r.supplier_code}/${r.role_code}: other_count ${r.other_count} against ${r.contact_count} `
              + `contacts and ${r.primary_name ? 'a' : 'no'} primary. It must count contacts BEYOND the one `
              + `shown, or a role with exactly one renders "+1 more" and the strip stops being quiet.`);
            if (!r.primary_name) assert.strictEqual(r.other_count, 0,
                `${r.supplier_code}/${r.role_code} shows no contact and claims ${r.other_count} more`);
        }
        const withMore = rc.filter(r => r.other_count > 0);
        assert.ok(withMore.length > 0,
            'instrument check: no role has a second contact, so "+N more" is never exercised');
        const single = rc.filter(r => r.contact_count === 1);
        assert.ok(single.every(r => r.other_count === 0), 'a single contact must read 0 more');
        out(`${withMore.length} role(s) show "+N more" (${withMore.map(r=>`${r.supplier_code}/${r.role_code}+${r.other_count}`).join(' ')}); `
          + `${single.length} single-contact roles all read 0`);
    });

    it('EXIT-4  the reading order is DECIDED, not alphabetical', async () => {
        // DISPUTES comes first alphabetically and is the one you ring last.
        // 'AGENT' < 'SUPPLIER' would work today by accident.
        const { data } = await test.GET(
            `${O}/FlightContacts?$select=party,partyRank,role_code,sort_order&$orderby=partyRank,sort_order&$top=200`);
        const parties = [...new Set(data.value.map(r => `${r.partyRank}:${r.party}`))];
        assert.deepStrictEqual(parties, ['1:AGENT','2:SUPPLIER'],
            `party order is ${parties.join(' ')} — AGENT first, because where the supplier does not `
          + `perform its own uplift the agent is who a planner actually rings`);
        const first = data.value.filter(r => r.partyRank === 1).map(r => r.role_code);
        assert.strictEqual(first[0], 'UPLIFT',
            `the first role is ${first[0]}, not UPLIFT. Sorting on role_code would put DISPUTES first, `
          + `which is the one you ring last.`);
        const ann = fs.readFileSync(`${PROJECT}/srv/planning-fiori-annotations.cds`,'utf8');
        const pv = /annotate PlanningService\.FlightContacts[\s\S]*?SortOrder: \[([\s\S]*?)\]/.exec(ann)[1];
        assert.ok(!/Property: party\b/.test(pv) && !/Property: role_name/.test(pv),
            'the strip sorts on a string whose order is an accident — use partyRank and sort_order');
        out(`${parties.join('  ')}; roles ${first.join(' ')}`);
    });

    it('EXIT-5  THE FACET BINDS — through the navigation, not by reading the path', async () => {
        // The obvious path designation/supplier/role_contacts CANNOT BIND:
        // designation is an Association to MANY and Fiori has no key for the
        // first hop. GET FlightSchedule(<id>)/designation/supplier -> 404.
        // Every hop real, the annotation correct, nothing rendered.
        const d = await db();
        const f = await d.run(SELECT.one.from('fuelsphere.FLIGHT_SCHEDULE')
            .columns('ID','flight_number').where({ flight_number: 'AC410' }));
        assert.ok(f, 'instrument check: AC410 is gone from the seed');

        let dead = null;
        try { await test.GET(`${O}/FlightSchedule(${f.ID})/designation/supplier`); }
        catch (e) { dead = e.response ? e.response.status : (e.status || 0); }
        assert.ok(dead === 404 || dead === 400,
            `the to-many path now returns ${dead} — if it binds, the FlightContacts view may be `
          + `unnecessary and this criterion should be revisited rather than left asserting a limit `
          + `that no longer exists`);

        const { data } = await test.GET(`${O}/FlightSchedule(${f.ID})/contacts`
            + `?$select=party,supplier_name,role_name,primary_name,role_status,role_note,primary_phone,other_count`
            + `&$orderby=partyRank,sort_order`);
        assert.strictEqual(data.value.length, 8,
            `${data.value.length} rows through the navigation — two parties x four roles is 8`);
        for (const r of data.value) {
            assert.ok(r.supplier_name, 'a row with no company');
            assert.ok(r.role_name, 'a row with no role');
            if (r.role_status === 'PRESENT') assert.ok(r.primary_phone,
                `${r.role_name} is PRESENT with no phone — the strip exists to be rung`);
        }
        out(`${f.flight_number}: ${data.value.length} rows bind through contacts/, direct to-many path -> ${dead}`);
    });

    it('EXIT-6  NO DUPLICATION — one row per company per role', async () => {
        // Keyed on designation_ID it returned SIXTEEN rows for AC410: two
        // applicable designations naming the SAME supplier, so every number
        // appeared twice on a strip whose purpose is to be scanned at 05:00.
        const d = await db();
        const rows = await d.run(SELECT.from('fuelsphere.FLIGHT_CONTACTS')
            .columns('flight_ID','supplier_ID','role_code','party'));
        const seen = new Map();
        for (const r of rows) {
            const k = `${r.flight_ID}|${r.supplier_ID}|${r.role_code}|${r.party}`;
            seen.set(k, (seen.get(k) || 0) + 1);
        }
        const dupes = [...seen].filter(([, n]) => n > 1);
        assert.deepStrictEqual(dupes.map(([k]) => k), [],
            `${dupes.length} duplicated row(s). A flight with two applicable designations naming the `
          + `SAME company must show each contact ONCE — and still show TWO companies where they name `
          + `different ones, which is not duplication but two parties.`);
        out(`${rows.length} rows, ${seen.size} distinct (flight, company, role, party) — no duplication`);
    });

    it('EXIT-7  exactly one primary per populated role', async () => {
        // is_primary is NOT unique-constrained, deliberately: there are zero
        // @assert.unique in db/ and a constraint would reject a legitimate
        // mid-handover state. So the SEED is asserted instead.
        const d = await db();
        const c = await d.run(SELECT.from('fuelsphere.SUPPLIER_CONTACTS')
            .columns('supplier_ID','role_code','is_primary','contact_name'));
        const by = {};
        for (const x of c) (by[`${x.supplier_ID}|${x.role_code}`] ||= []).push(x);
        for (const [k, list] of Object.entries(by)) {
            const primaries = list.filter(x => x.is_primary === true || x.is_primary === 1);
            assert.strictEqual(primaries.length, 1,
                `${k} has ${primaries.length} primaries among ${list.length} contacts `
              + `(${list.map(x=>x.contact_name).join(', ')}) — "who do I ring for uplift" has one answer`);
        }
        const multi = Object.values(by).filter(l => l.length > 1);
        assert.ok(multi.length > 0,
            'instrument check: no role has two contacts, so is_primary is never exercised');
        out(`${c.length} contacts across ${Object.keys(by).length} populated roles, one primary each; `
          + `${multi.length} role(s) have more than one contact`);
    });
});

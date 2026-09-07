/**
 * IDR RULE STATUS — WHAT RAN, WHAT PASSED, AND WHAT NOBODY LOOKED AT.
 *
 * The proposal's §4 correction. One row per document per applicable rule,
 * so a rule that PASSED and a rule that NEVER RAN stop being the same
 * absence — which is all a join to INVOICE_EXCEPTIONS could ever produce.
 *
 * WHAT EACH CRITERION IS FOR, AND HOW IT FAILS. Written at the moment of
 * writing the assertion, not afterwards, because afterwards the question
 * has quietly become "does it pass".
 *
 *   EXIT-1  the five sum                    fails if a verdict is recorded
 *                                           under no status, or a counter is
 *                                           written from something other
 *                                           than the rows
 *   EXIT-2  the five are COMPLETE           fails if a rule is silently never
 *                                           recorded. THE SUM CANNOT CATCH
 *                                           THIS - it held on all thirteen
 *                                           invoices while INV470 was missing
 *                                           from ten of them
 *   EXIT-3  seed equals computation         fails if the seed goes stale
 *   EXIT-4  the cascade is grey, not green  fails if a rung below a failure
 *                                           is recorded as PASSED - the
 *                                           join-by-absence defect itself
 *   EXIT-5  every NOT_APPLICABLE gives a
 *           reason                          fails if a verdict says "did not
 *                                           apply" and cannot say why, which
 *                                           is indistinguishable from a rule
 *                                           nobody bothered to record
 *   EXIT-6  the rows the FACET will show    fails if the table's own sort
 *                                           puts grey above red, or a visible
 *                                           row has a blank in a bound column
 *   EXIT-7  exceptions unchanged            fails if the verdict recorder
 *                                           altered what gets raised
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert');
const test=cds.test(PROJECT); const out=s=>process.stdout.write('      '+s+'\n');
const db=()=>cds.connect.to('db');
const O='/odata/v4/invoice';
const C=require(`${PROJECT}/srv/lib/invoice-checks`);

// Header rules are evaluated once per DOCUMENT; the rest once per LINE.
// Named here rather than derived, so that moving a rule between the two is a
// visible edit rather than a silent change in what "complete" means.
const HEADER_RULES = ['INV459','INV460','INV461','INV454','INV473'];

const runAll = async () => {
    const invs = await (await db()).run(SELECT.from('fuelsphere.INVOICES').columns('ID','invoice_number'));
    for (const i of invs)
        await test.POST(`${O}/Invoices(ID=${i.ID},IsActiveEntity=true)/InvoiceService.validateForPosting`, {});
    return invs;
};

describe('IDR rule status — the verdicts, and the counters over them', () => {

    it('EXIT-1  the five counters SUM, on every invoice, seeded and re-run', async () => {
        const check = async (when) => {
            // KEYED ON ID, NEVER ON invoice_number. INV-WFS-2026W21-003 is
            // a DELIBERATELY SEEDED DUPLICATE supplier number, so a lookup
            // by number matches two documents and counts one's rows against
            // the other's counter. Caught by this criterion failing on the
            // one invoice the seed exists to make ambiguous.
            const rows = await (await db()).run(SELECT.from('fuelsphere.INVOICES')
                .columns('ID','invoice_number','rules_evaluated','rules_passed','rules_failed',
                         'rules_bypassed','rules_not_applicable'));
            assert.ok(rows.length, 'no invoices to check');
            for (const r of rows) {
                const sum = r.rules_passed + r.rules_failed + r.rules_bypassed + r.rules_not_applicable;
                assert.strictEqual(sum, r.rules_evaluated,
                    `${when}: ${r.invoice_number} does not sum — ${r.rules_evaluated} evaluated but `
                  + `${r.rules_passed}+${r.rules_failed}+${r.rules_bypassed}+${r.rules_not_applicable}=${sum}. `
                  + `A verdict was written under a status none of the four counts.`);
                // AND AGAINST THE ROWS, not only against each other. Four
                // numbers can agree with one another and with nothing else.
                const actual = await (await db()).run(SELECT.from('fuelsphere.IDR_RULE_STATUS')
                    .columns('count(*) as n').where({ invoice_ID: r.ID }));
                assert.strictEqual(actual[0].n, r.rules_evaluated,
                    `${when}: ${r.invoice_number} claims ${r.rules_evaluated} evaluated and `
                  + `${actual[0].n} rows exist. The counter is not counting the rows.`);
            }
            return rows.length;
        };
        const seeded = await check('as seeded');
        await runAll();
        const rerun = await check('after re-running every check');
        out(`${seeded} invoices sum as seeded; ${rerun} sum after a full re-run`);
    });

    it('EXIT-2  COMPLETE, not merely consistent — the sum cannot catch a missing rule', async () => {
        // THIS IS THE CRITERION THE SUM COULD NOT BE. A sum over what is
        // present says nothing about what is absent: it held on all thirteen
        // invoices while INV470 was missing from ten of them and INV452 from
        // one. Both came from an edit that aborted after its first change.
        const d = await db();
        const registry = [...(await C.loadRegistry('2026-09-01')).keys()];
        const lineRules = registry.filter(c => !HEADER_RULES.includes(c));
        assert.ok(registry.length >= 20 && lineRules.length >= 15,
            `instrument check: registry looks wrong — ${registry.length} rules, ${lineRules.length} line rules`);

        const invs = await d.run(SELECT.from('fuelsphere.INVOICES').columns('ID','invoice_number'));
        let checked = 0;
        for (const inv of invs) {
            const items = await d.run(SELECT.from('fuelsphere.INVOICE_ITEMS')
                .columns('ID','line_number').where({ invoice_ID: inv.ID }));
            const rows = await d.run(SELECT.from('fuelsphere.IDR_RULE_STATUS')
                .columns('check_code','invoice_item_ID').where({ invoice_ID: inv.ID }));
            const have = new Set(rows.map(r => `${r.check_code}|${r.invoice_item_ID || ''}`));

            const missing = [];
            for (const c of HEADER_RULES) if (!have.has(`${c}|`)) missing.push(`${c} (header)`);
            for (const it of items) for (const c of lineRules)
                if (!have.has(`${c}|${it.ID}`)) missing.push(`${c} line ${it.line_number}`);
            assert.strictEqual(missing.length, 0,
                `${inv.invoice_number}: ${missing.length} rule(s) NEVER RECORDED A VERDICT — `
              + `${missing.slice(0,4).join(', ')}. The counters would still sum, and the screen `
              + `would under-report by exactly this much.`);

            const dupes = rows.length - have.size;
            assert.strictEqual(dupes, 0, `${inv.invoice_number}: ${dupes} duplicate verdict(s)`);
            assert.strictEqual(rows.length, HEADER_RULES.length + lineRules.length * items.length,
                `${inv.invoice_number}: ${rows.length} verdicts, expected `
              + `${HEADER_RULES.length} + ${lineRules.length} x ${items.length} lines`);
            checked++;
        }
        out(`${checked} invoices complete: ${HEADER_RULES.length} header + ${lineRules.length} line rules x lines, `
          + `no gaps, no duplicates`);
    });

    it('EXIT-3  the seeded verdicts ARE the computed verdicts — READ FROM THE CSV', async () => {
        // THIS CRITERION WAS VACUOUS ON ITS FIRST WRITING AND THE PLANT IS
        // WHAT SAID SO. It read `before` from the DATABASE, then re-ran the
        // checks, then compared. But EXIT-1 above already re-runs every
        // check, so by the time this executed the seed had been overwritten
        // and it compared THE COMPUTATION TO ITSELF - true whatever the CSV
        // says. Flipping a seeded NOT_APPLICABLE to PASSED did not fail it.
        //
        // Third instance of this shape in a week, and this one landed in a
        // harness carrying the rule at the top of its own file. It reads the
        // CSV now: the authored artefact against the computation, which is
        // what the criterion claims and what makes it independent of the
        // order mocha happens to run the others in.
        const fs = require('node:fs');
        const csv = fs.readFileSync(`${PROJECT}/db/data/fuelsphere-IDR_RULE_STATUS.csv`, 'utf8')
            .trim().split('\n');
        const cols = csv[0].split(';');
        const ix = n => { const i = cols.indexOf(n);
                          assert.ok(i >= 0, `instrument check: no ${n} column in the seed CSV`); return i; };
        const [cInv, cCode, cItem, cStat] =
            ['invoice_ID','check_code','invoice_item_ID','status'].map(ix);
        const seeded = new Set(csv.slice(1).map(l => {
            const f = l.split(';');
            return `${f[cInv]}|${f[cCode]}|${f[cItem]}|${f[cStat]}`;
        }));
        assert.ok(seeded.size > 300, `instrument check: only ${seeded.size} seeded verdicts parsed`);

        await runAll();
        const computed = new Set((await (await db()).run(SELECT.from('fuelsphere.IDR_RULE_STATUS')))
            .map(r => `${r.invoice_ID}|${r.check_code}|${r.invoice_item_ID || ''}|${r.status}`));

        const gone = [...seeded].filter(k => !computed.has(k));
        const born = [...computed].filter(k => !seeded.has(k));
        assert.deepStrictEqual([gone.length, born.length], [0, 0],
            `the seed is stale: ${gone.length} seeded verdict(s) the computation does not produce `
          + `(${gone.slice(0,3).join(' / ')}) and ${born.length} it produces that were not seeded `
          + `(${born.slice(0,3).join(' / ')})`);
        out(`${seeded.size} verdicts in the CSV, identical to what the run computes`);
    });

    it('EXIT-4  BELOW A FAILED RUNG THE CASCADE IS GREY, NEVER GREEN', async () => {
        // THE DEFECT ITSELF, ASSERTED. A line whose ticket is missing fails
        // INV450; INV462, INV463, INV464 and INV466 have nothing to look at.
        // Join-by-absence renders all four PASSED. If any of them is PASSED
        // here, the entity has been built and is lying in the same way.
        const d = await db();
        const BELOW = ['INV462','INV463','INV464','INV466'];
        const failedTicket = await d.run(SELECT.from('fuelsphere.IDR_RULE_STATUS')
            .columns('invoice_ID','invoice_item_ID','line_number')
            .where({ check_code: 'INV450', status: 'FAILED' }));
        assert.ok(failedTicket.length,
            'instrument check: no line fails INV450 in the seed, so this criterion proves nothing');

        let asserted = 0;
        for (const f of failedTicket) {
            const below = await d.run(SELECT.from('fuelsphere.IDR_RULE_STATUS')
                .columns('check_code','status','na_reason')
                .where({ invoice_ID: f.invoice_ID, invoice_item_ID: f.invoice_item_ID,
                         check_code: { in: BELOW } }));
            assert.strictEqual(below.length, BELOW.length,
                `line ${f.line_number}: only ${below.length} of the ${BELOW.length} rungs below INV450 recorded anything`);
            for (const b of below) {
                assert.strictEqual(b.status, 'NOT_APPLICABLE',
                    `line ${f.line_number}: ${b.check_code} is ${b.status} below a FAILED INV450. `
                  + `Nothing evaluated it, and ${b.status === 'PASSED' ? 'PASSED is the join-by-absence lie' : 'that verdict cannot be right'}.`);
                assert.ok(b.na_reason && b.na_reason.length > 20,
                    `${b.check_code} did not run and does not say why`);
                asserted++;
            }
        }
        out(`${failedTicket.length} line(s) fail INV450; all ${asserted} rungs below them are `
          + `NOT_APPLICABLE with a reason, none PASSED`);
    });

    it('EXIT-5  every NOT_APPLICABLE says why, and no other verdict claims one', async () => {
        const d = await db();
        const rows = await d.run(SELECT.from('fuelsphere.IDR_RULE_STATUS')
            .columns('check_code','status','na_reason','line_number','invoice_ID'));
        const naked = rows.filter(r => r.status === 'NOT_APPLICABLE' && !(r.na_reason || '').trim());
        assert.strictEqual(naked.length, 0,
            `${naked.length} NOT_APPLICABLE verdict(s) carry no reason — indistinguishable from a rule `
          + `nobody bothered to record: ${naked.slice(0,3).map(r => r.check_code).join(', ')}`);
        // And the other direction: a PASSED row with an na_reason would mean
        // the two branches got crossed somewhere.
        const crossed = rows.filter(r => r.status !== 'NOT_APPLICABLE' && (r.na_reason || '').trim());
        assert.strictEqual(crossed.length, 0,
            `${crossed.length} verdict(s) that are not NOT_APPLICABLE carry a "did not run" reason`);
        const na = rows.filter(r => r.status === 'NOT_APPLICABLE').length;
        out(`${na} of ${rows.length} verdicts are NOT_APPLICABLE, every one with a reason; `
          + `0 crossed the other way`);
    });

    it('EXIT-6  THE ROWS THE FACET WILL SHOW — its own sort, its own columns', async () => {
        // Not "the data exists". The facet's own $orderby, and every visible
        // row carrying a value in every bound column. This is where the
        // criticality-as-sort-key error was caught: ascending criticality
        // puts 0 (neutral) above 1 (red), so sixteen grey rows would have
        // rendered above the one red one.
        const inv = await (await db()).run(SELECT.one.from('fuelsphere.INVOICES')
            .columns('ID','invoice_number').where({ invoice_number: 'INV-BPUK-20260325-001' }));
        assert.ok(inv, 'instrument check: INV-BPUK-20260325-001 is gone from the seed');

        const VISIBLE = 8;
        const { data } = await test.GET(
            `${O}/Invoices(ID=${inv.ID},IsActiveEntity=true)/rule_statuses`
          + `?$select=check_code,line_number,status,na_reason,statusCriticality,verdictRank`
          + `&$expand=rule($select=check_name)`
          + `&$orderby=verdictRank,line_number,check_code&$top=${VISIBLE}`);
        assert.strictEqual(data.value.length, VISIBLE,
            `the facet can only show ${data.value.length} rows`);

        // THE RED ROW IS FIRST. Sorting on statusCriticality instead would
        // put NOT_APPLICABLE here and this is the assertion that says so.
        assert.strictEqual(data.value[0].status, 'FAILED',
            `the first row of the table is ${data.value[0].status}, not FAILED. If the sort was moved `
          + `to statusCriticality, note that 0 is NEUTRAL and 1 is RED, so ascending buries the `
          + `finding under sixteen grey rows.`);
        for (const [n, r] of data.value.entries()) {
            assert.ok(r.rule && r.rule.check_name,
                `visible row ${n+1} (${r.check_code}) has no rule.check_name — the "What it checks" column is blank`);
            assert.ok(r.status && r.verdictRank,
                `visible row ${n+1} has no verdict`);
            if (r.status === 'NOT_APPLICABLE') assert.ok(r.na_reason,
                `visible row ${n+1} says it did not run and the reason column is blank`);
        }
        // And the rank is monotone, which is what "sorted" means.
        const ranks = data.value.map(r => r.verdictRank);
        assert.deepStrictEqual(ranks, [...ranks].sort((a,b)=>a-b), `rows are not in rank order: ${ranks}`);
        out(`${inv.invoice_number}: row 1 is ${data.value[0].check_code} FAILED, then ranks `
          + `${ranks.join(',')}; no blank cell in any visible row`);
    });

    it('EXIT-7  the exceptions raised are UNCHANGED by the verdict recorder', async () => {
        // The recorder restructured every check site. This is the criterion
        // that says the restructure was additive: same exceptions, same
        // count, same gate. It fails the moment a note() edit changes which
        // branch raises.
        const d = await db();
        await runAll();
        const exc = await d.run(SELECT.from('fuelsphere.INVOICE_EXCEPTIONS').columns('check_code','severity'));
        const failed = await d.run(SELECT.from('fuelsphere.IDR_RULE_STATUS')
            .columns('check_code').where({ status: 'FAILED' }));
        assert.strictEqual(failed.length, exc.length,
            `${failed.length} FAILED verdicts against ${exc.length} open exceptions. Every failure must `
          + `appear on both sides or the table and the list beside it contradict each other.`);

        const linked = await d.run(SELECT.from('fuelsphere.IDR_RULE_STATUS')
            .columns('count(*) as n').where({ status: 'FAILED', exception_ID: null }));
        assert.strictEqual(linked[0].n, 0,
            `${linked[0].n} FAILED verdict(s) point at no exception`);
        out(`${exc.length} exceptions, ${failed.length} FAILED verdicts, all linked`);
    });
});

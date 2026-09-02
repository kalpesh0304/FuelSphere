/**
 * WP-21A — invoice capture, the check registry and the posting gate.
 *
 * Criterion 4 is the sharpest: one check, one varying value, four outcomes.
 * Criterion 6 is the one that would pass while testing nothing, so it asserts
 * BOTH halves — that the duplicate is found AND that the resolution alone
 * finds nothing wrong with either line.
 */
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert');
const K=require(`${PROJECT}/srv/lib/invoice-checks`);
const test=cds.test(PROJECT);
const out=s=>process.stdout.write('      '+s+'\n');
const I='/odata/v4/invoice';

const INV=n=>`21a00004-0000-4000-8000-${String(n).padStart(12,'0')}`;
const S1=INV(1), S2=INV(2), S3=INV(3), S3B=INV(4), S4=INV(5), S5=INV(6);

const db=()=>cds.connect.to('db');
// Invoices is @odata.draft.enabled, so its key is (ID=...,IsActiveEntity=true),
// not a bare id. A bare id returns 400 "Key ID is missing", which reads like a
// missing value rather than a missing key SEGMENT.
const key=id=>`Invoices(ID=${id},IsActiveEntity=true)`;
const validate=id=>test.post(`${I}/${key(id)}/InvoiceService.validateForPosting`,{});
const invoice=id=>db().then(d=>d.run(SELECT.one.from('fuelsphere.INVOICES').where({ID:id})));
const excs=id=>db().then(d=>d.run(SELECT.from('fuelsphere.INVOICE_EXCEPTIONS')
    .where({invoice_ID:id}).orderBy('line_number','check_code')));
const show=r=>r.exceptions.forEach(e=>out(
  `    ${e.checkCode} ${String(e.severity).padEnd(11)} ${e.lineNumber?('L'+e.lineNumber).padEnd(4):'hdr '} `
+ `${e.severitySource==='TOLERANCE_LADDER'?'[ladder '+e.rung+']':'[registry]'} ${e.message.slice(0,88)}`));

describe('WP-21A — invoice validation and the posting gate', function () {

// ======================================================================
it('EXIT-1 — an invoice with hard errors is CAPTURED, exceptions against it, posting gated', async () => {
    const before = await invoice(S2);
    assert.ok(before, 'the invoice exists before validation — capture was never blocked');

    // REPOINTED. This asserted `before.posting_gate === 'NOT_CHECKED'`, which
    // was a statement about WHAT THE SEED HAPPENED TO CONTAIN. The seed now
    // carries the verdict so the demo can stay read-only, and the criterion
    // failed on a deliberate data change rather than on any behaviour.
    //
    // The relationship it was reaching for is that NOT_CHECKED IS NOT CLEAR
    // and the gate is COMPUTED rather than stored. Demonstrating the
    // transition proves both, and proves more than the original: put the row
    // back to unchecked, confirm it reads NOT_CHECKED and not CLEAR, then run.
    await (await db()).run(UPDATE('fuelsphere.INVOICES').set({
        posting_gate: 'NOT_CHECKED', gate_evaluated_at: null,
        open_hard_count: 0, open_soft_count: 0, warning_count: 0
    }).where({ ID: S2 }));
    const reset = await invoice(S2);
    assert.strictEqual(reset.posting_gate, 'NOT_CHECKED');
    assert.notStrictEqual(reset.posting_gate, 'CLEAR', 'and NOT_CHECKED is not CLEAR');
    out(`reset to ${reset.posting_gate} before the run, so the gate below is computed`);

    const { data } = await validate(S2);
    out(`${data.invoiceNumber}: gate=${data.postingGate} canPost=${data.canPost}`);
    out(`  ${data.hardErrors} hard, ${data.softErrors} soft, ${data.warnings} warning across ${data.linesResolved + data.linesUnresolved} line(s)`);
    show(data);

    assert.strictEqual(data.success, true, 'THE RUN succeeded even though the invoice did not');
    assert.strictEqual(data.postingGate, 'GATED');
    assert.strictEqual(data.canPost, false);
    assert.ok(data.hardErrors >= 3, `expected at least 3 hard, got ${data.hardErrors}`);

    // CAPTURE IS NEVER BLOCKED. The invoice and every line survive the run.
    const after = await invoice(S2);
    const lines = await (await db()).run(SELECT.from('fuelsphere.INVOICE_ITEMS').where({invoice_ID:S2}));
    assert.ok(after, 'the invoice is still captured');
    assert.strictEqual(lines.length, 3, 'every line is still captured');
    assert.strictEqual(after.posting_gate, 'GATED');
    out(`  invoice and all ${lines.length} lines still captured. Only POSTING is held.`);

    const stored = await excs(S2);
    assert.strictEqual(stored.length, data.exceptionsRaised);
    assert.ok(stored.every(e => e.status === 'OPEN'));
});

// ======================================================================
it('EXIT-2 — changing a configured severity makes the SAME invoice gate differently', async () => {
    // S4 raises exactly one exception: INV465, SOFT by configuration.
    const first = await validate(S4);
    out(`before: gate=${first.data.postingGate} soft=${first.data.softErrors} warn=${first.data.warnings}`);
    show(first.data);
    assert.strictEqual(first.data.postingGate, 'GATED');
    assert.strictEqual(first.data.softErrors, 1);
    const code = first.data.exceptions[0].checkCode;

    // ONE ROW IN THE REGISTRY. No redeploy, no code change.
    await (await db()).run(UPDATE('fuelsphere.INVOICE_CHECK_REGISTRY')
        .set({ default_severity: 'WARNING' }).where({ check_code: code }));
    out(`  registry: ${code} default_severity SOFT_ERROR -> WARNING`);

    const second = await validate(S4);
    out(`after:  gate=${second.data.postingGate} soft=${second.data.softErrors} warn=${second.data.warnings}`);
    show(second.data);
    assert.strictEqual(second.data.postingGate, 'CLEAR', 'the same invoice now clears');
    assert.strictEqual(second.data.softErrors, 0);
    assert.strictEqual(second.data.warnings, 1, 'the check still fires — it just no longer gates');

    // A check REMOVED from the registry does not run at all. That is the
    // registry being a registry rather than a switch statement beside a table.
    await (await db()).run(UPDATE('fuelsphere.INVOICE_CHECK_REGISTRY')
        .set({ is_active: false }).where({ check_code: code }));
    const third = await validate(S4);
    out(`deregistered: ${third.data.checksRegistered} check(s) registered, ${third.data.exceptionsRaised} raised`);
    assert.strictEqual(third.data.exceptionsRaised, 0, 'a deregistered check raises nothing');

    // restore, so the tests after this see the seeded configuration
    await (await db()).run(UPDATE('fuelsphere.INVOICE_CHECK_REGISTRY')
        .set({ default_severity: 'SOFT_ERROR', is_active: true }).where({ check_code: code }));
    const back = await validate(S4);
    assert.strictEqual(back.data.postingGate, 'GATED', 'and restoring the row restores the gate');
    out(`restored: gate=${back.data.postingGate}`);
});

// ======================================================================
it('EXIT-3/4 — the ladder resolves from TOLERANCE_RULES and produces all four outcomes', async () => {
    const { data } = await validate(S1);
    const stored = await excs(S1);
    const rule = await (await db()).run(SELECT.one.from('fuelsphere.TOLERANCE_RULES')
        .where({ rule_code: 'TOL-INV-QTY' }));
    out(`TOL-INV-QTY  warning<=${rule.warning_threshold}  error<=${rule.error_threshold}  critical<=${rule.critical_threshold}  applies_to=${rule.applies_to}`);

    // Four lines. SAME goods receipt (10000), SAME price, SAME everything.
    // Only the invoiced quantity moves — the bounds are fixed and the value
    // travels across them, so subject and variable do not move together.
    const byLine = new Map(stored.filter(e => e.check_code === 'INV451').map(e => [e.line_number, e]));
    const lines = await (await db()).run(SELECT.from('fuelsphere.INVOICE_ITEMS')
        .where({ invoice_ID: S1 }).orderBy('line_number'));
    for (const l of lines) {
        const e = byLine.get(l.line_number);
        out(`  L${l.line_number}  qty ${l.quantity} vs GR 10000  = ${e ? e.variance_pct + '%' : '+0.3000%'}`
          + `  -> ${e ? e.severity : 'NOTHING RAISED'}`
          + (e ? `  threshold ${e.threshold_crossed}  rule ${rule.rule_code}` : ''));
    }
    assert.strictEqual(byLine.get(10), undefined, 'L10 at +0.30% is inside the warning threshold — nothing raised');
    assert.strictEqual(byLine.get(20).severity, 'WARNING',    'L20 at +1.00%');
    assert.strictEqual(byLine.get(30).severity, 'SOFT_ERROR', 'L30 at +3.00%');
    assert.strictEqual(byLine.get(40).severity, 'HARD_ERROR', 'L40 at +8.00%');

    // EXIT-3: the row that resolved is recorded, not just the number.
    for (const ln of [20, 30, 40]) {
        assert.strictEqual(byLine.get(ln).tolerance_rule_ID, rule.ID, `L${ln} names the row`);
        assert.strictEqual(byLine.get(ln).severity_source, 'TOLERANCE_LADDER',
            'the ladder decided, not the registry default');
    }
    out(`  all three name tolerance_rule ${rule.rule_code} (${rule.ID.slice(0,8)}...) and severity_source=TOLERANCE_LADDER`);

    // The instrument could have failed: the registry default for INV451 is
    // SOFT_ERROR, so a ladder that did nothing would make all three SOFT.
    const reg = await (await db()).run(SELECT.one.from('fuelsphere.INVOICE_CHECK_REGISTRY')
        .where({ check_code: 'INV451' }));
    assert.strictEqual(reg.default_severity, 'SOFT_ERROR');
    out(`  INV451's registry default is SOFT_ERROR — a dead ladder would have made all three SOFT`);
    assert.strictEqual(data.postingGate, 'GATED');

    // applies_to is what stops the invoice check reading the FOB tolerance.
    const t = await K.resolveTolerance('INVOICE_LINE', 'QUANTITY', {}, '2026-04-15');
    const other = await K.resolveTolerance('DELIVERY_FOB', 'QUANTITY', {}, '2026-04-15');
    out(`  applies_to INVOICE_LINE -> ${t.rule.rule_code}; DELIVERY_FOB -> ${other.rule.rule_code}`);
    assert.strictEqual(t.rule.rule_code, 'TOL-INV-QTY');
    assert.notStrictEqual(other.rule.rule_code, 'TOL-INV-QTY', 'a different control must not get this row');
});

// ======================================================================
it('EXIT-5 — a SOFT error is bypassed and recorded; a HARD error cannot be', async () => {
    await validate(S4);
    const soft = (await excs(S4)).find(e => e.severity === 'SOFT_ERROR');
    assert.ok(soft, 'setup: a soft error to bypass');

    // too short a reason is refused, and records nothing
    const short = await test.post(`${I}/InvoiceExceptions(ID=${soft.ID},IsActiveEntity=true)/InvoiceService.bypass`, { reason: 'ok' });
    out(`short reason: success=${short.data.success} — ${short.data.message.slice(0,80)}`);
    assert.strictEqual(short.data.success, false);
    assert.strictEqual((await (await db()).run(SELECT.from('fuelsphere.INVOICE_EXCEPTION_BYPASSES'))).length, 0);

    const reason = 'PO 4500999999 is the supplier internal reference, confirmed by phone with WFS AP';
    const ok = await test.post(`${I}/InvoiceExceptions(ID=${soft.ID},IsActiveEntity=true)/InvoiceService.bypass`, { reason });
    out(`bypass: success=${ok.data.success} gate ${soft.severity} -> ${ok.data.postingGate}`);
    assert.strictEqual(ok.data.success, true);
    assert.strictEqual(ok.data.postingGate, 'CLEAR', 'the gate opens');

    const rec = await (await db()).run(SELECT.one.from('fuelsphere.INVOICE_EXCEPTION_BYPASSES')
        .where({ exception_ID: soft.ID }));
    out(`  recorded: who=${rec.bypassed_by}  when=${rec.bypassed_at}  why="${rec.bypass_reason.slice(0,60)}..."`);
    assert.ok(rec.bypassed_by && rec.bypassed_at && rec.bypass_reason === reason, 'who, when and why');
    assert.strictEqual(rec.second_approver, null, 'the second signature is WP-27 and stays unwritten');

    // BYPASSED is not CLEARED. The exception is still true.
    const after = await (await db()).run(SELECT.one.from('fuelsphere.INVOICE_EXCEPTIONS').where({ ID: soft.ID }));
    assert.strictEqual(after.status, 'BYPASSED');
    out(`  the exception is retained as BYPASSED, not deleted — it is still true`);

    // and it SURVIVES a re-run rather than being quietly re-raised or erased
    const rerun = await validate(S4);
    const still = await (await db()).run(SELECT.one.from('fuelsphere.INVOICE_EXCEPTIONS').where({ ID: soft.ID }));
    assert.strictEqual(still.status, 'BYPASSED', 're-running must not erase a judgement somebody made');
    assert.strictEqual(rerun.data.postingGate, 'CLEAR');
    out(`  survives re-validation: still BYPASSED, gate still ${rerun.data.postingGate}`);

    // ---- a HARD error cannot be bypassed --------------------------------
    await validate(S2);
    const hard = (await excs(S2)).find(e => e.severity === 'HARD_ERROR');
    const refused = await test.post(`${I}/InvoiceExceptions(ID=${hard.ID},IsActiveEntity=true)/InvoiceService.bypass`,
        { reason: 'commercially agreed with the supplier, please let it through' });
    out(`HARD ${hard.check_code}: success=${refused.data.success} — ${refused.data.message.slice(0,92)}`);
    assert.strictEqual(refused.data.success, false);
    assert.strictEqual(refused.data.bypassed, false);
    assert.strictEqual(refused.data.postingGate, 'GATED', 'and the gate stays shut');
    const none = await (await db()).run(SELECT.from('fuelsphere.INVOICE_EXCEPTION_BYPASSES')
        .where({ exception_ID: hard.ID }));
    assert.strictEqual(none.length, 0, 'nothing was recorded');

    // even if configuration says it is bypassable — code overrides the
    // registry in the SAFE direction only
    await (await db()).run(UPDATE('fuelsphere.INVOICE_CHECK_REGISTRY')
        .set({ is_bypassable: true }).where({ check_code: hard.check_code }));
    const still2 = await test.post(`${I}/InvoiceExceptions(ID=${hard.ID},IsActiveEntity=true)/InvoiceService.bypass`,
        { reason: 'the registry now says this check is bypassable' });
    assert.strictEqual(still2.data.success, false,
        'configuration may narrow what can be waived, never widen it');
    out(`  registry set is_bypassable=true for ${hard.check_code} — STILL refused`);
    await (await db()).run(UPDATE('fuelsphere.INVOICE_CHECK_REGISTRY')
        .set({ is_bypassable: false }).where({ check_code: hard.check_code }));
});

// ======================================================================
it('EXIT-6 — a duplicate is found on all three keys, AND the resolution alone finds nothing', async () => {
    // ---- HALF ONE: the resolution passes both lines ----------------------
    // This is the half that makes the criterion mean something. If the
    // resolution flagged these lines, the duplicate check could do nothing at
    // all and the test would still go green.
    const lines = await (await db()).run(SELECT.from('fuelsphere.INVOICE_ITEMS')
        .where({ invoice_ID: S3 }).orderBy('line_number'));
    for (const l of lines) {
        const res = await K.resolveLine(l);
        out(`  L${l.line_number} ticket ${l.ticket_number} -> PO ${res.resolved_po_number} GR ${res.resolved_gr_number}  failure=${res.failure || 'NONE'}`);
        assert.strictEqual(res.failure, null, `L${l.line_number} resolves cleanly`);
        assert.strictEqual(Number(l.quantity), 10000, 'and its quantity equals the goods receipt exactly');
        assert.strictEqual(Number(l.unit_price), 0.85, 'and its price equals the order price exactly');
    }
    out(`  BOTH lines are individually correct. A matcher has nothing to report.`);

    const { data } = await validate(S3);
    const nonDup = data.exceptions.filter(e => e.checkGroup !== 'DUPLICATE');
    out(`  non-duplicate exceptions on this invoice: ${nonDup.length ? nonDup.map(e=>e.checkCode).join(', ') : 'NONE'}`);
    assert.strictEqual(nonDup.length, 0, 'nothing but the duplicate checks fires — that is the point');

    // ---- HALF TWO: all three keys ----------------------------------------
    show(data);
    const codes = new Set(data.exceptions.map(e => e.checkCode));
    assert.ok(codes.has('INV455'), 'key 2: same ticket invoiced twice');
    assert.ok(codes.has('INV474'), 'key 3: same order and GR combination twice');

    const b = await validate(S3B);
    const bCodes = new Set(b.data.exceptions.map(e => e.checkCode));
    out(`  S3b (same invoice number and vendor): ${[...bCodes].join(', ')}`);
    assert.ok(bCodes.has('INV473'), 'key 1: same invoice number, same vendor');

    for (const c of ['INV473','INV455','INV474']) {
        const reg = await (await db()).run(SELECT.one.from('fuelsphere.INVOICE_CHECK_REGISTRY')
            .where({ check_code: c }));
        assert.strictEqual(reg.default_severity, 'HARD_ERROR', `${c} must be HARD`);
    }
    out(`  all three keys are HARD_ERROR, and none of them is a tolerance question`);
    assert.strictEqual(data.postingGate, 'GATED');
});

// ======================================================================
it('EXIT-7 — a ticket that resolves to nothing raises HARD and the line is still captured', async () => {
    const { data } = await validate(S2);
    const byLine = new Map((await excs(S2)).filter(e => e.line_number).map(e => [e.line_number, e]));
    const lines = await (await db()).run(SELECT.from('fuelsphere.INVOICE_ITEMS')
        .where({ invoice_ID: S2 }).orderBy('line_number'));
    for (const l of lines) {
        const e = byLine.get(l.line_number);
        out(`  L${l.line_number} "${l.ticket_number}" -> ${e.check_code} ${e.severity}`);
        out(`       ${e.message.slice(0,100)}`);
        assert.strictEqual(e.severity, 'HARD_ERROR');
        // THE LINE SURVIVES. Capture is never blocked.
        assert.ok(l.ID && Number(l.quantity) === 10000, 'the line is captured in full');
    }
    // Three DIFFERENT failures, because they send a clerk to three different
    // places. Collapsing them into "unresolved" would lose that.
    assert.deepStrictEqual([...new Set(lines.map(l => byLine.get(l.line_number).check_code))].sort(),
        ['INV462','INV463','INV464']);
    out(`  three distinct codes, not one "unresolved" — each names a different place to go`);
    assert.strictEqual(data.linesUnresolved, 3);
});

// ======================================================================
it('EXIT-8 — a provisional price raises the WARNING and NO price variance', async () => {
    const { data } = await validate(S5);
    show(data);
    const codes = data.exceptions.map(e => e.checkCode);
    assert.ok(codes.includes('INV470'), 'the provisional warning is raised');
    assert.ok(!codes.includes('INV452'), 'and the price comparison did NOT run');

    const warn = data.exceptions.find(e => e.checkCode === 'INV470');
    assert.strictEqual(warn.severity, 'WARNING');
    assert.strictEqual(warn.isGating, false);
    assert.ok(/SUSPENDED/.test(warn.message), 'the message must say suspended, not passed');
    out(`  ${warn.message.slice(0,130)}`);

    // Distinguishable from a line that PASSED the price check. On S1 the price
    // check ran and found nothing; here it did not run at all. A single "no
    // INV452 row" cannot tell those apart — the WARNING is what does.
    const s1 = await excs(1 && '21a00004-0000-4000-8000-000000000001');
    const s1Price = s1.filter(e => e.check_code === 'INV452' || e.check_code === 'INV470');
    out(`  S1 (real comparison, no variance): ${s1Price.length ? s1Price.map(e=>e.check_code).join(',') : 'no price exception at all'}`);
    assert.strictEqual(s1Price.length, 0, 'S1 compared and found nothing — it has no INV470 either');
    out(`  "not compared" and "compared and fine" are different rows, not the same absence`);
});

// ======================================================================
it('EXIT-9 — the header total derives from lines, and the three readers still work', async () => {
    // REPOINTED. This read the SEED FILE and asserted net_amount was the empty
    // string — "seeded EMPTY, a total is an output of capture". That was a
    // statement about the seed's contents standing in for one about the code,
    // and the seed now carries the derived total as a cached computation so
    // the demo can stay read-only.
    //
    // The relationship is that THE TOTAL IS AN OUTPUT: whatever the header
    // holds, a run replaces it with the sum of the lines. Blanking the live
    // row and watching it come back is a direct demonstration of that, where
    // reading a blank cell in a CSV was an inference from it.
    //
    // stated_net_amount stays asserted from the seed file, because THAT one
    // genuinely is an input and nothing derives it.
    const fs0=require('fs');
    const csv=fs0.readFileSync(`${PROJECT}/db/data/fuelsphere-INVOICES.csv`,'utf8').trim().split('\n');
    const hdr=csv[0].split(';');
    const seedRow=csv.slice(1).map(l=>l.split(';')).find(c=>c[hdr.indexOf('invoice_number')]==='INV-WFS-2026W21-001');
    out(`seed row: net_amount="${seedRow[hdr.indexOf('net_amount')]}" stated_net_amount="${seedRow[hdr.indexOf('stated_net_amount')]}"`);
    assert.notStrictEqual(seedRow[hdr.indexOf('stated_net_amount')], '',
        'the STATED figure is an input and must be seeded');

    // Blank the derived total, and require the run to put it back.
    await (await db()).run(UPDATE('fuelsphere.INVOICES')
        .set({ net_amount: null, gross_amount: null }).where({ ID: S1 }));
    const blanked = await invoice(S1);
    assert.strictEqual(blanked.net_amount, null, 'instrument check: the blanking did not take');
    out(`  header net_amount blanked to null before the run`);

    const before = await invoice(S1);
    const { data } = await validate(S1);
    const after = await invoice(S1);
    const lines = await (await db()).run(SELECT.from('fuelsphere.INVOICE_ITEMS').where({ invoice_ID: S1 }));
    const sum = K.r2(lines.reduce((a,l)=>a+Number(l.net_amount),0));
    out(`  ${lines.length} lines sum to ${sum}; header net_amount is now ${after.net_amount}, gross ${after.gross_amount}`);
    assert.strictEqual(Number(after.net_amount), sum, 'derived, never keyed (INV454)');
    assert.strictEqual(Number(after.gross_amount), K.r2(sum + Number(after.tax_amount)));
    assert.strictEqual(Number(before.stated_net_amount), sum, 'this document happens to agree');

    // and a document that DISAGREES is overridden, with the disagreement recorded
    await (await db()).run(UPDATE('fuelsphere.INVOICES')
        .set({ stated_net_amount: 99999.99 }).where({ ID: S1 }));
    const dis = await validate(S1);
    const row = await invoice(S1);
    const e = dis.data.exceptions.find(x => x.checkCode === 'INV454');
    out(`  stated 99999.99 vs derived ${row.net_amount}: ${e.checkCode} ${e.severity} raised, header holds ${row.net_amount}`);
    assert.ok(e, 'INV454 is raised');
    assert.strictEqual(Number(row.net_amount), sum, 'THE DERIVED FIGURE GOVERNS — the stated one is overridden');
    assert.strictEqual(Number(row.stated_net_amount), 99999.99, 'and the stated one is retained as evidence');
    await (await db()).run(UPDATE('fuelsphere.INVOICES')
        .set({ stated_net_amount: sum }).where({ ID: S1 }));

    // the three readers. All in invoice-fiori-annotations.cds, all display-only.
    const fs = require('fs');
    const ann = fs.readFileSync(`${PROJECT}/srv/invoice-fiori-annotations.cds`,'utf8');
    const refs = (ann.match(/\b(net_amount|gross_amount)\b/g)||[]).length;
    out(`  ${refs} annotation reference(s) to the relaxed fields, all display-only`);
    const meta = await test.get(`${I}/$metadata`);
    assert.strictEqual(meta.status, 200);
    // Null-safety, demonstrated rather than inferred: NULL a total deliberately
    // and read it back. Counting incidental nulls would depend on which
    // criteria had already run and would pass or fail on test order.
    await (await db()).run(UPDATE('fuelsphere.INVOICES')
        .set({ net_amount: null, gross_amount: null }).where({ ID: S5 }));
    const rows = await test.get(`${I}/Invoices?$select=invoice_number,net_amount,gross_amount&$top=20`);
    assert.strictEqual(rows.status, 200, 'the relaxed fields still read over OData with nulls present');
    const nulled = rows.data.value.find(r => r.net_amount === null);
    assert.ok(nulled, 'the deliberately nulled row is genuinely null, so this is not a vacuous pass');
    out(`  ${nulled.invoice_number} read back with net_amount=null over OData, status 200 — null is safe`);
    await validate(S5);   // restore it by deriving again
});

// ======================================================================
it('EXIT-10 — no path is conditional on recon_status, textually and behaviourally', async () => {
    const fs=require('fs'), path=require('path');
    const files=['srv/invoice-service.js','srv/lib/invoice-checks.js','srv/invoice-service.cds'];
    // Strip comments first. A comment saying the code does not read a field is
    // not a path that reads it, and counting it would make the check
    // unpassable for the wrong reason.
    const strip=src=>src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'');
    const PAT=/recon_status|reconStatus|recon_variance|reconVariance/g;
    for (const f of files) {
        const raw=fs.readFileSync(path.join(PROJECT,f),'utf8');
        const code=strip(raw);
        const inCode=(code.match(PAT)||[]).length;
        const inComments=(raw.match(PAT)||[]).length - inCode;
        out(`  ${f.padEnd(30)} ${inCode} in code, ${inComments} in comments`);
        assert.strictEqual(inCode, 0, `${f} must not READ recon_status`);
    }
    // Prove the instrument on both a known-present and a known-absent case,
    // AFTER stripping, so a broken stripper cannot produce a false pass.
    const fob=strip(fs.readFileSync(path.join(PROJECT,'srv/lib/fob-reconciliation.js'),'utf8'));
    assert.ok((fob.match(PAT)||[]).length > 0,
        'known-present: fob-reconciliation.js reads recon_status in CODE, not only in comments');
    assert.strictEqual((strip('// recon_status\n/* recon_status */\nconst x=1;').match(PAT)||[]).length, 0,
        'known-absent: a file whose only mentions are comments must read as zero');
    out(`  instrument proven: fob-reconciliation.js reads it in code; a comments-only file reads zero`);

    // BEHAVIOURALLY. Move a delivery to VARIANCE and re-run: the gate must not
    // move. C-1 — the supplier is paid on metered volume and the dispute runs
    // on its own track.
    const d=await db();
    const before=await validate(S3B);
    const del=await d.run(SELECT.one.from('fuelsphere.FUEL_DELIVERIES')
        .where({ID:'21a00002-0000-4000-8000-000000000002'}));
    await d.run(UPDATE('fuelsphere.FUEL_DELIVERIES')
        .set({recon_status:'VARIANCE', recon_variance_kg:-850}).where({ID:del.ID}));
    const after=await validate(S3B);
    out(`  delivery recon_status ${del.recon_status} -> VARIANCE (-850 kg)`);
    out(`  gate ${before.data.postingGate} -> ${after.data.postingGate}, exceptions ${before.data.exceptionsRaised} -> ${after.data.exceptionsRaised}`);
    assert.strictEqual(after.data.postingGate, before.data.postingGate, 'the gate must not move');
    assert.strictEqual(after.data.exceptionsRaised, before.data.exceptionsRaised, 'and no exception may appear');
    await d.run(UPDATE('fuelsphere.FUEL_DELIVERIES')
        .set({recon_status:del.recon_status, recon_variance_kg:del.recon_variance_kg}).where({ID:del.ID}));
});

// ======================================================================
it('EXIT-13 — the registry is complete and every declared check is implemented', async () => {
    const reg = await (await db()).run(SELECT.from('fuelsphere.INVOICE_CHECK_REGISTRY').orderBy('check_code'));
    const groups = {};
    for (const r of reg) (groups[r.check_group] ||= []).push(r.check_code);
    for (const [g,c] of Object.entries(groups)) out(`  ${g.padEnd(11)} ${c.length}  ${c.join(' ')}`);
    assert.strictEqual(reg.length, 22, '22 checks in scope for 21A');
    const unimplemented = reg.filter(r => r.is_implemented === false);
    out(`  ${reg.length} registered, ${unimplemented.length} not implemented`);
    assert.strictEqual(unimplemented.length, 0, 'every 21A check has an implementation — the S/4 ones are 21B');

    // every registered code is one the engine can actually raise
    const known = new Set(Object.values(K.C));
    const orphans = reg.filter(r => !known.has(r.check_code)).map(r => r.check_code);
    assert.deepStrictEqual(orphans, [], 'a registered code the engine never emits is a silent no-op');
    out(`  all 22 codes are emitted by the engine — none is a declared no-op`);
});

});

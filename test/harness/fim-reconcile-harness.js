/**
 * FIM — RECONCILE INVOICE.
 *
 * The screen where the check panel and the ladder live together. Three things
 * have to hold for it to be worth opening, and each of them was false before
 * this package:
 *
 *   1. THE VERDICT IS SEEDED AND TRUE. posting_gate, its three counters and
 *      the derived amounts are OUTPUTS OF A RUN. Seeding them lets the demo
 *      stay read-only; it also lets the seed drift, so the seeded verdict is
 *      compared against a fresh computation FIELD FOR FIELD. Before this, all
 *      thirteen invoices read NOT_CHECKED with twenty-five exceptions
 *      underneath - a header arguing with its own rows.
 *
 *   2. THE RESOLUTION IS SEEDED AND TRUE. ticket_ID, resolved_po_number,
 *      resolved_gr_number and resolution_source are written by the same run
 *      and were empty in the seed, so six RESOLUTION-group checks were raised
 *      against lines carrying none of the evidence they name.
 *
 *   3. NOTHING ON THE SCREEN POINTS AT NOTHING. Every Path= and every
 *      AnnotationPath= the service emits is walked against the entity types
 *      it is written on. This is the check that would have caught the six
 *      dangling Criticality paths, which compiled clean for months.
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert');
const test=cds.test(PROJECT); const out=s=>process.stdout.write('      '+s+'\n');
const db=()=>cds.connect.to('db');
const O='/odata/v4/invoice';

const num = v => v === null || v === undefined ? null : Number(v);

async function runAll() {
    const invs = await (await db()).run(SELECT.from('fuelsphere.INVOICES').columns('ID'));
    for (const i of invs)
        await test.POST(`${O}/Invoices(ID=${i.ID},IsActiveEntity=true)/InvoiceService.validateForPosting`, {});
    return invs.length;
}

// ---------------------------------------------------------------------------
// THE EDMX WALKER.
//
// Proved against a known-present and a known-absent form BEFORE it is trusted.
// The known-absent control is the one that matters: `Path="` is a substring of
// `AnnotationPath="`, and a reader that does not exclude it reports every
// correct facet as a broken value binding. That over-match cost a package.
// ---------------------------------------------------------------------------
const PATH    = /(?<!Annotation)(?<!NavigationProperty)Path="([^"]+)"/g;
const ANNPATH = /AnnotationPath="([^"]+)"/g;
const all = (re, s) => [...s.matchAll(new RegExp(re.source, 'g'))].map(m => m[1]);

function parseEdmx(x) {
    const props = {}, navs = {}, navtype = {};
    for (const m of x.matchAll(/<EntityType Name="(\w+)"[^>]*>([\s\S]*?)<\/EntityType>/g)) {
        const [, n, body] = m;
        props[n] = new Set(all(/<Property Name="(\w+)"/, body));
        navs[n]  = new Set(all(/<NavigationProperty Name="(\w+)"/, body));
        navtype[n] = {};
        for (const nm of body.matchAll(/<NavigationProperty Name="(\w+)" Type="([^"]+)"/g))
            navtype[n][nm[1]] = nm[2].replace('Collection(','').replace(')','').split('.').pop();
    }
    return { props, navs, navtype };
}

/** Walk every emitted binding. Returns { paths, facets, badPaths, badFacets }. */
function walk(x) {
    const { props, navs, navtype } = parseEdmx(x);
    const resolve = (ent, path) => {
        const parts = path.split('/'); let cur = ent;
        for (let i = 0; i < parts.length; i++) {
            const last = i === parts.length - 1, p = parts[i];
            if (last) return (props[cur]?.has(p) || navs[cur]?.has(p)) === true;
            if (navtype[cur]?.[p]) cur = navtype[cur][p]; else return false;
        }
        return false;
    };
    const badPaths = [], badFacets = []; let paths = 0, facets = 0;
    for (const m of x.matchAll(/<Annotations Target="InvoiceService\.(\w+)">([\s\S]*?)<\/Annotations>/g)) {
        const [, ent, body] = m;
        if (!props[ent]) continue;                    // property-level target
        for (const p of all(PATH, body)) { paths++; if (!resolve(ent, p)) badPaths.push(`${ent} -> ${p}`); }
        for (const ap of all(ANNPATH, body)) {
            facets++;
            const i = ap.lastIndexOf('/');
            const nav = i < 0 ? '' : ap.slice(0, i), term = (i < 0 ? ap : ap.slice(i + 1)).replace(/^@/, '');
            let target = ent, ok = true;
            for (const hop of nav.split('/').filter(Boolean)) {
                if (navtype[target]?.[hop]) target = navtype[target][hop]; else { ok = false; break; }
            }
            if (ok) {
                const blk = x.match(new RegExp(`<Annotations Target="InvoiceService\\.${target}">([\\s\\S]*?)</Annotations>`));
                const [base, qual] = term.split('#');
                const want = `Term="${base}"` + (qual ? ` Qualifier="${qual}"` : '');
                ok = !!blk && blk[1].includes(want);
            }
            if (!ok) badFacets.push(`${ent} -> ${ap}`);
        }
    }
    return { paths, facets, badPaths, badFacets };
}

describe('FIM — Reconcile Invoice', () => {

  let seededHdr, seededItm, edmx;
  before(async () => {
    seededHdr = await (await db()).run(SELECT.from('fuelsphere.INVOICES'));
    seededItm = await (await db()).run(SELECT.from('fuelsphere.INVOICE_ITEMS'));
    edmx = (await test.GET(`${O}/$metadata`)).data;
  });

  it('EXIT-1  the seeded verdict IS the computed verdict, field for field', async () => {
    // Instrument first: a seed of all-NOT_CHECKED would make this vacuous.
    const checked = seededHdr.filter(r => r.posting_gate !== 'NOT_CHECKED');
    assert.ok(checked.length > 0,
      'instrument check: every invoice reads NOT_CHECKED, so nothing is being compared');
    assert.ok(seededHdr.every(r => r.gate_evaluated_at),
      'a verdict with no evaluation timestamp is not evidence of anything');

    const before = new Map(seededHdr.map(r => [r.ID, r]));
    await runAll();
    const after = await (await db()).run(SELECT.from('fuelsphere.INVOICES'));

    const F = ['posting_gate','open_hard_count','open_soft_count','warning_count'];
    const N = ['net_amount','tax_amount','gross_amount'];
    const diffs = [];
    for (const a of after) {
      const b = before.get(a.ID);
      for (const f of F) if (b[f] !== a[f]) diffs.push(`${b.invoice_number}.${f}: seeded ${b[f]} vs computed ${a[f]}`);
      for (const f of N) if (num(b[f]) !== num(a[f])) diffs.push(`${b.invoice_number}.${f}: seeded ${b[f]} vs computed ${a[f]}`);
    }
    for (const d of diffs) out('  ' + d);
    assert.deepStrictEqual(diffs, [], 'the seeded verdict has drifted from what the checks produce');
    const g = after.filter(r => r.posting_gate === 'GATED').length;
    out(`${after.length} invoices, ${g} GATED / ${after.length - g} CLEAR, 7 fields each, 0 drift`);
  });

  it('EXIT-2  the seeded resolution IS the computed resolution, field for field', async () => {
    const resolved = seededItm.filter(r => r.resolution_source);
    assert.ok(resolved.length > 0,
      'instrument check: resolution_source is empty on every line, so nothing is being compared');

    const before = new Map(seededItm.map(r => [r.ID, r]));
    const after = await (await db()).run(SELECT.from('fuelsphere.INVOICE_ITEMS'));  // EXIT-1 already ran

    // WHAT the line resolved to is stable and is asserted row for row.
    // HOW it was found is NOT - see EXIT-6, which pins that separately rather
    // than letting this criterion quietly tolerate it.
    const F = ['ticket_ID','resolved_po_number','resolved_gr_number'];
    const diffs = [];
    for (const a of after) {
      const b = before.get(a.ID);
      for (const f of F) if ((b[f] ?? null) !== (a[f] ?? null))
        diffs.push(`line ${b.line_number}.${f}: seeded ${b[f]} vs computed ${a[f]}`);
      // resolution_source may change WITHIN its equivalence class; it may not
      // cross between resolved and unresolved. That is the relationship.
      const cls = v => (v == null || v === 'UNRESOLVED') ? 'unresolved' : 'resolved';
      if (cls(b.resolution_source) !== cls(a.resolution_source))
        diffs.push(`line ${b.line_number}: seeded ${cls(b.resolution_source)} vs computed ${cls(a.resolution_source)}`);
    }
    for (const d of diffs) out('  ' + d);
    assert.deepStrictEqual(diffs, [], 'the seeded resolution has drifted from what the resolver produces');
    const un = after.filter(r => r.resolution_source === 'UNRESOLVED').length;
    out(`${after.length} lines, ${after.length - un} resolved / ${un} UNRESOLVED, 3 fields each, 0 drift`);
  });

  it('EXIT-3  the eight criticality elements evaluate, and the null arm is 0', async () => {
    const inv = (await test.GET(`${O}/Invoices?$select=invoice_number,status,statusCriticality,`
      + `approval_status,approvalCriticality,match_status,matchingCriticality,posting_gate,gateCriticality`)).data.value;
    const rule = (v, m) => v === null || v === undefined ? 0 : (m[v] ?? 0);
    for (const r of inv) {
      assert.strictEqual(r.statusCriticality,    rule(r.status,          {POSTED:3, PAID:3, CANCELLED:1}), `${r.invoice_number} status`);
      assert.strictEqual(r.approvalCriticality,  rule(r.approval_status, {APPROVED:3, REJECTED:1, ESCALATED:2}), `${r.invoice_number} approval`);
      assert.strictEqual(r.matchingCriticality,  rule(r.match_status,    {MATCHED:3, EXCEPTION:1, PARTIAL_MATCH:2, PRICE_VARIANCE:2, QTY_VARIANCE:2}), `${r.invoice_number} matching`);
      assert.strictEqual(r.gateCriticality,      rule(r.posting_gate,    {CLEAR:3, GATED:1}), `${r.invoice_number} gate`);
    }
    // NOT_CHECKED must be NEUTRAL, never green. The one that carries the screen.
    for (const r of inv) if (r.posting_gate === 'NOT_CHECKED')
      assert.strictEqual(r.gateCriticality, 0, 'NOT_CHECKED must never read as CLEAR');

    const it_ = (await test.GET(`${O}/InvoiceItems?$select=line_number,resolution_source,resolutionCriticality,`
      + `po_number,resolved_po_number,poAgreementCriticality&$top=500`)).data.value;
    for (const r of it_) {
      // THE NULL ARM. A simple `case ... when null` never matches in SQL, so
      // every unresolved line rendered GREEN until this was a searched case.
      const want = r.resolution_source == null ? 0 : (r.resolution_source === 'UNRESOLVED' ? 1 : 3);
      assert.strictEqual(r.resolutionCriticality, want, `line ${r.line_number} resolution`);
      const wantPo = (r.resolved_po_number == null || r.po_number == null) ? 0
                   : (r.po_number !== r.resolved_po_number ? 2 : 3);
      assert.strictEqual(r.poAgreementCriticality, wantPo, `line ${r.line_number} po agreement`);
    }
    const disagree = it_.filter(r => r.poAgreementCriticality === 2);
    assert.ok(disagree.length > 0,
      'no line states a PO that disagrees with the resolved one, so INV465 has nothing to colour');

    const ex = (await test.GET(`${O}/InvoiceExceptions?$select=severity,severityCriticality,status,lifecycleCriticality&$top=500`)).data.value;
    for (const r of ex) {
      assert.strictEqual(r.severityCriticality, {HARD_ERROR:1, SOFT_ERROR:2}[r.severity] ?? 0);
      assert.strictEqual(r.lifecycleCriticality, {CLEARED:3, BYPASSED:2}[r.status] ?? 0);
    }
    const warn = ex.filter(r => r.severity === 'WARNING');
    assert.ok(warn.length > 0 && warn.every(r => r.severityCriticality === 0),
      'WARNING must be neutral - green would read as "checked and fine"');
    out(`${inv.length} invoices x4, ${it_.length} lines x2, ${ex.length} exceptions x2; `
      + `${disagree.length} PO disagreement, ${warn.length} neutral warnings`);
  });

  it('EXIT-4  every emitted binding resolves — instrument proved, then run', () => {
    // KNOWN-PRESENT and KNOWN-ABSENT, both directions, before trusting it.
    assert.deepStrictEqual(all(PATH, '<PropertyValue Property="Value" Path="invoice_number"/>'),
      ['invoice_number'], 'instrument: known-present form not matched');
    assert.deepStrictEqual(all(PATH, '<PropertyValue Property="Target" AnnotationPath="items/@UI.LineItem"/>'),
      [], 'instrument: OVER-MATCHED AnnotationPath as a value path');
    assert.deepStrictEqual(all(ANNPATH, '<PropertyValue Property="Target" AnnotationPath="items/@UI.LineItem"/>'),
      ['items/@UI.LineItem'], 'instrument: facet-target reader not matched');

    // AND IT MUST BITE. Two plants, one per half.
    const p1 = edmx.replace('Path="invoice_number"', 'Path="no_such_column"');
    assert.ok(walk(p1).badPaths.length > 0, 'plant did not fire: a dangling value path went unreported');
    const p2 = edmx.replace(/AnnotationPath="([^"/]+)\/@/, 'AnnotationPath="no_such_nav/@');
    assert.ok(walk(p2).badFacets.length > 0, 'plant did not fire: a dangling facet target went unreported');

    const r = walk(edmx);
    for (const b of r.badPaths)  out('  DANGLING PATH  ' + b);
    for (const b of r.badFacets) out('  DANGLING FACET ' + b);
    assert.deepStrictEqual(r.badPaths, [], 'an annotation points at a property that does not exist');
    assert.deepStrictEqual(r.badFacets, [], 'a facet points at a target that does not exist');
    assert.ok(r.paths > 200 && r.facets > 20, 'instrument check: too little walked to mean anything');
    out(`${r.paths} value paths and ${r.facets} facet targets walked, 0 dangling`);
  });

  it('EXIT-5  the screen reaches what it argues about', async () => {
    // The check panel hangs off the invoice, in one round trip.
    const inv = (await test.GET(`${O}/Invoices?$filter=invoice_number eq 'INV-WFS-2026W21-001'`
      + `&$expand=exceptions($select=check_code,severity,threshold_crossed,line_number)`)).data.value[0];
    assert.ok(inv, 'the ladder invoice is missing from the seed');
    const rungs = inv.exceptions.filter(e => e.check_code === 'INV451');
    assert.strictEqual(new Set(rungs.map(e => e.severity)).size, 3,
      'the ladder invoice must show three distinct rungs of ONE check');
    for (const e of rungs) assert.ok(e.threshold_crossed !== null,
      'a rung that does not name its threshold cannot be argued with');
    out(`  ladder: ${rungs.map(e => `L${e.line_number} ${e.severity}@${e.threshold_crossed}`).join('  ')}`);

    // INV465: the line must carry BOTH PO numbers, which is the whole finding.
    const l = (await test.GET(`${O}/InvoiceItems?$filter=po_number eq '4500999999'`
      + `&$select=line_number,po_number,resolved_po_number,ticket_number`)).data.value[0];
    assert.ok(l, 'the PO-disagreement line is missing from the seed');
    assert.notStrictEqual(l.resolved_po_number, null, 'the resolved PO is the half that was missing');
    assert.notStrictEqual(l.po_number, l.resolved_po_number);
    out(`  INV465: states ${l.po_number}, resolves to ${l.resolved_po_number} via ${l.ticket_number}`);

    // The last hop: line -> ticket -> the fuel itself.
    const c = (await test.GET(`${O}/InvoiceItems?$filter=invoice/invoice_number eq 'INV-WFS-20260416-101'`
      + `&$select=line_number,quantity,uom_code&$expand=ticket($select=ticket_number,quantity_metered,density_value,quantity_kg,aircraft_reg,flight_number)`)).data.value[0];
    assert.ok(c && c.ticket, 'the clean line does not reach its ticket');
    assert.ok(c.ticket.quantity_kg && c.ticket.density_value,
      'the ticket facet shows metered x density = kg; two of the three are missing');
    out(`  last hop: ${c.quantity} ${c.uom_code} -> ${c.ticket.ticket_number} `
      + `${c.ticket.quantity_metered} x ${c.ticket.density_value} = ${c.ticket.quantity_kg} kg `
      + `${c.ticket.aircraft_reg} ${c.ticket.flight_number}`);
  });

  // -------------------------------------------------------------------------
  // D49 — resolution_source IS NOT IDEMPOTENT, AND THIS PINS IT.
  //
  // resolveLine prefers item.ticket_ID when it is present; persistResolution
  // writes ticket_ID back after every run. So a line that resolved from the
  // SUPPLIER'S STRING on the first run reports TICKET_ID on the second, and
  // the record of how the link was originally established is destroyed by the
  // act of re-checking it.
  //
  // That matters on this screen specifically: resolution_source is the field
  // the reconcile page colours, and it is what tells a clerk whether the
  // ticket number printed on the supplier's document was any good. After one
  // re-run every line claims we already had the id.
  //
  // NOT FIXED HERE - it is the resolver's behaviour, not the screen's, and
  // the repair is a decision about what the field means (how it was found
  // THIS time, or how the link was FIRST made). This test asserts the defect
  // so that fixing it cannot pass unnoticed: the day resolution_source stops
  // moving, this criterion fails and the decision gets recorded.
  // -------------------------------------------------------------------------
  it('EXIT-6  D49: re-running rewrites resolution_source — pinned, not fixed', async () => {
    // seededItm was read BEFORE any run. EXIT-1 has since run every invoice
    // once, so the comparison here is seed -> first re-check, which is where
    // the rewrite happens.
    const now = new Map((await (await db()).run(SELECT.from('fuelsphere.INVOICE_ITEMS')
      .columns('ID','resolution_source','ticket_ID'))).map(r => [r.ID, r]));

    const byNumber = seededItm.filter(r => r.resolution_source === 'TICKET_NUMBER');
    assert.ok(byNumber.length > 0,
      'instrument check: the seed holds no TICKET_NUMBER line, so nothing can drift');

    const moved = [];
    for (const a of seededItm) {
      const b = now.get(a.ID);
      assert.strictEqual(b.ticket_ID ?? null, a.ticket_ID ?? null,
        `line ${a.line_number}: the TICKET must not move between runs, only the provenance`);
      if (a.resolution_source !== b.resolution_source)
        moved.push(`L${a.line_number} ${a.resolution_source} -> ${b.resolution_source}`);
    }
    assert.strictEqual(moved.length, byNumber.length,
      'D49 has changed shape: re-check the resolver before editing this test');
    assert.ok(byNumber.every(r => now.get(r.ID).resolution_source === 'TICKET_ID'),
      'every line that resolved from the supplier string now claims the id');

    // And it is a ONE-SHOT rewrite, not an oscillation: a further run leaves
    // it where it is, because ticket_ID is now always present.
    await runAll();
    const third = await (await db()).run(SELECT.from('fuelsphere.INVOICE_ITEMS')
      .columns('ID','resolution_source'));
    for (const r of third) assert.strictEqual(r.resolution_source, now.get(r.ID).resolution_source,
      'the rewrite is not one-shot - D49 is worse than recorded');

    for (const m of moved.slice(0, 3)) out('  ' + m);
    out(`D49 holds: ${moved.length} of ${seededItm.length} lines rewrote their provenance on `
      + `the first re-check, and stayed put on the second`);
  });
});

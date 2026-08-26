/**
 * WP-13 — parameter resolution and applied evidence. Eleven exit criteria.
 * Criterion 5 is the one this package would otherwise fail silently.
 */
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert');
const test=cds.test(PROJECT);
const out=s=>process.stdout.write('      '+s+'\n');
const O='/odata/v4/orders';
const P=require(`${PROJECT}/srv/lib/parameter-store`);
const TAIL=require(`${PROJECT}/srv/lib/tail-resolver`);
const FOB=require(`${PROJECT}/srv/lib/fob-reconciliation`);
const UOM=require(`${PROJECT}/srv/lib/fuel-uom`);

describe('WP-13 — parameter resolution and applied evidence', function () {

it('EXIT-1 — a scalar resolves by scope and transaction date, and the row is recorded', async () => {
    const r = await P.resolveParameter('BURN_POSTING_TRIGGER', {}, '2026-04-01');
    out(`BURN_POSTING_TRIGGER -> ${r.value}`);
    out(`  evidence: row ${r.evidence.parameter_id.slice(-4)}  specificity ${r.evidence.specificity}  `
      + `priority ${r.evidence.priority}  window ${r.evidence.valid_from}..${r.evidence.valid_to||'open'}  as at ${r.evidence.as_of}`);
    assert.strictEqual(r.value, 'ON_CONFIRMATION');
    assert.strictEqual(r.evidence.source, 'TOLERANCE_RULES');
    assert.strictEqual(r.evidence.decision_ref, 'C-2');
    // The instrument could fail: an unregistered code resolves to nothing, loudly.
    const none = await P.resolveParameter('NO_SUCH_PARAMETER', {}, '2026-04-01');
    assert.strictEqual(none.resolved, false);
    assert.ok(none.reason.includes('CFG450'));
    out(`  an unregistered code -> CFG450, not a silent default`);
});

it('EXIT-2 — two windows, two transaction dates, two answers', async () => {
    const before = await P.resolveParameter('FLIGHT_COST_OBJECT_MODEL', {}, '2026-03-01');
    const after  = await P.resolveParameter('FLIGHT_COST_OBJECT_MODEL', {}, '2026-09-01');
    out(`as at 2026-03-01 -> ${before.value}   (row ${before.evidence.parameter_id.slice(-4)}, `
      + `${before.evidence.valid_from}..${before.evidence.valid_to})`);
    out(`as at 2026-09-01 -> ${after.value}   (row ${after.evidence.parameter_id.slice(-4)}, `
      + `${after.evidence.valid_from}..${after.evidence.valid_to||'open'})`);
    assert.strictEqual(before.value, 'COST_CENTER');
    assert.strictEqual(after.value, 'PM_ORDER');
    assert.notStrictEqual(before.evidence.parameter_id, after.evidence.parameter_id);
    // CFG402: the transaction date, never today. Today is neither of those dates.
    const today = await P.resolveParameter('FLIGHT_COST_OBJECT_MODEL', {});
    out(`with no date supplied it falls to today (${today.evidence.as_of}) -> ${today.value}`);
});

it('EXIT-3 — specificity beats generality, and the global still answers', async () => {
    const scoped = await P.resolveParameter('UNKNOWN_TAIL_POLICY', { company_code:'2000' }, '2026-04-01');
    const global = await P.resolveParameter('UNKNOWN_TAIL_POLICY', { company_code:'1000' }, '2026-04-01');
    out(`company 2000 -> ${scoped.value}  (specificity ${scoped.evidence.specificity}, priority ${scoped.evidence.priority})`);
    out(`company 1000 -> ${global.value}  (specificity ${global.evidence.specificity}, priority ${global.evidence.priority})`);
    assert.strictEqual(scoped.value, 'REJECT');
    assert.strictEqual(global.value, 'ACCEPT_PROVISIONAL');
    assert.ok(scoped.evidence.specificity > global.evidence.specificity,
        'the scoped row must be more specific, not merely first');
    assert.strictEqual(global.evidence.scope_company_code, null, 'the global row names no company');
    assert.strictEqual(scoped.evidence.candidates, 2, 'both rows were eligible; specificity chose');
});

it('EXIT-4 — all five blocks resolve, at the values they held as constants', async () => {
    const rows = [];
    const burn = await P.resolveToleranceRule({ ruleCode:'TOL-BURN-VARIANCE' }, {}, '2026-04-01');
    rows.push(['burn variance ladder', '5 / 10 / 20',
        `${Number(burn.rule.warning_threshold)} / ${Number(burn.rule.error_threshold)} / ${Number(burn.rule.critical_threshold)}`]);
    const t = await P.resolveToleranceRule({ ruleCode:'TOL-EPD-TEMP' }, {}, '2026-04-01');
    rows.push(['EPD403 temperature', '-40 / 50', `${Number(t.rule.lower_limit)} / ${Number(t.rule.upper_limit)}`]);
    const d = await P.resolveToleranceRule({ ruleCode:'TOL-EPD-DENSITY' }, {}, '2026-04-01');
    rows.push(['EPD404 density', '0.775 / 0.84', `${Number(d.rule.lower_limit)} / ${Number(d.rule.upper_limit)}`]);
    for (const src of ['ACARS','CREW_REPORTED','PANEL_PRESET']) {
        const before = FOB.resolveTolerance(src);
        const after  = await FOB.resolveToleranceFromStore(src, {}, '2026-04-01');
        rows.push([`FOB ${src}`, `${before.percent}% floor ${before.floorKg}`, `${after.percent}% floor ${after.floorKg}`]);
        assert.strictEqual(after.percent, before.percent, `${src} percent moved`);
        assert.strictEqual(after.floorKg, before.floorKg, `${src} floor moved`);
        assert.ok(after.source.startsWith('TOLERANCE_RULES:'), `${src} did not come from the store`);
    }
    const pol = await TAIL.resolvePolicy();
    rows.push(['UNKNOWN_TAIL_POLICY', TAIL.UNKNOWN_TAIL_POLICY, pol.policy]);
    const u = await UOM.resolveDefaultVolumeUom();
    rows.push(['DEFAULT_VOLUME_UOM', UOM.DEFAULT_VOLUME_UOM, u.uom]);
    out('block                    as a constant        from the store');
    rows.forEach(([a,b,c]) => out(`${a.padEnd(24)} ${String(b).padEnd(20)} ${c}`));
    assert.strictEqual(Number(burn.rule.warning_threshold), 5);
    assert.strictEqual(Number(burn.rule.error_threshold), 10);
    assert.strictEqual(Number(burn.rule.critical_threshold), 20);
    assert.strictEqual(Number(t.rule.lower_limit), -40);
    assert.strictEqual(Number(t.rule.upper_limit), 50);
    assert.strictEqual(Number(d.rule.lower_limit), 0.775);
    assert.strictEqual(Number(d.rule.upper_limit), 0.84);
    assert.strictEqual(pol.policy, TAIL.UNKNOWN_TAIL_POLICY);
    assert.ok(pol.source.startsWith('TOLERANCE_RULES:'));
    assert.strictEqual(u.uom, UOM.DEFAULT_VOLUME_UOM);
    assert.ok(u.source.startsWith('TOLERANCE_RULES:'));
});

it('EXIT-5 — the rejection boundary MOVES when the row moves', async () => {
    const db = await cds.connect.to('db');
    const draftPost = async (label, temp) => {
        const order = await db.run(SELECT.one.from('fuelsphere.FUEL_ORDERS')
            .where({ status:'Draft' }).orderBy({ order_number:'asc' }));
        await test.post(`${O}/FuelOrders(ID=${order.ID},IsActiveEntity=true)/FuelOrderService.draftEdit`,{}).catch(()=>{});
        try {
            await test.post(`${O}/FuelOrders(ID=${order.ID},IsActiveEntity=false)/deliveries`, {
                delivery_number:`EPD-BND-${label}`, delivery_date:'2026-04-01', delivery_time:'10:00:00',
                delivered_quantity:1000, uom_code:'LTR', aircraft_reg:order.aircraft_reg||'C-FITU',
                temperature:temp, density:0.800 });
            return null;
        } catch(e){ return ((e.response.data.error)||{}).message||''; }
    };
    // 45 is inside the seeded bound of 50.
    out(`with TOL-EPD-TEMP upper = 50:`);
    const a = await draftPost('a', 45);
    out(`  temperature 45 -> ${a ? 'REFUSED' : 'ACCEPTED'}`);
    assert.strictEqual(a, null, '45 must be inside the seeded bound');

    // MOVE THE ROW. Nothing else changes — no redeploy, no code.
    await db.run(UPDATE('fuelsphere.TOLERANCE_RULES')
        .set({ upper_limit: 40 }).where({ rule_code:'TOL-EPD-TEMP' }));
    out(`row updated: upper_limit 50 -> 40`);
    const b = await draftPost('b', 45);
    out(`  temperature 45 -> ${b ? 'REFUSED' : 'ACCEPTED'}`);
    if (b) out(`     ${b.slice(0,110)}`);
    assert.ok(b, 'the SAME value must now be refused — the bound is resolved, not literal');
    assert.ok(b.includes('outside -40 to 40'), 'the refusal must quote the NEW bound');
    assert.ok(b.includes('TOL-EPD-TEMP'), 'and name the row it came from');

    // Put it back, and prove the move was the cause rather than the order.
    await db.run(UPDATE('fuelsphere.TOLERANCE_RULES')
        .set({ upper_limit: 50 }).where({ rule_code:'TOL-EPD-TEMP' }));
    const c = await draftPost('c', 45);
    out(`restored to 50:  temperature 45 -> ${c ? 'REFUSED' : 'ACCEPTED'}`);
    assert.strictEqual(c, null, 'restoring the row must restore the behaviour');
});

it('EXIT-12 — every numeric assertion in the repository, and what backs it', async () => {
    const fs=require('fs');
    // The whole model, db AND srv: @Common.FieldControl sits on the SERVICE
    // projection, not on the db entity, so loading db alone cannot see why a
    // db-level assertion is inert.
    const model = cds.linked(await cds.load([`${PROJECT}/db`, `${PROJECT}/srv`]));
    const found=[];
    for (const [n,d] of Object.entries(model.definitions)) {
        if (!n.startsWith('fuelsphere.') || !d.elements) continue;
        for (const [en,e] of Object.entries(d.elements))
            if (Array.isArray(e['@assert.range'])) {
                // does ANY service projection mark it read-only?
                const ro = Object.entries(model.definitions).some(([sn,sd]) =>
                    !sn.startsWith('fuelsphere.') && sd.elements && sd.elements[en] &&
                    sd.elements[en]['@Common.FieldControl'] &&
                    JSON.stringify(sd.projection||sd.query||'').includes(n.replace('fuelsphere.','')));
                found.push({ entity:n.replace('fuelsphere.',''), element:en,
                             range:JSON.stringify(e['@assert.range']), readonly: ro });
            }
    }
    // COMMENTS STRIPPED FIRST. The two WP-13 converted are still in the file
    // as comment text, and a raw grep counts them — which is the whole reason
    // this convention exists. It fired here, in the test that inventories them.
    const schema=fs.readFileSync(`${PROJECT}/db/schema.cds`,'utf8');
    const live=schema.split('\n').filter(l=>!l.trim().startsWith('//')).join('\n');
    const raw=(schema.match(/@assert\.range: \[/g)||[]).length;
    const stripped=(live.match(/@assert\.range: \[/g)||[]).length;
    out(`numeric @assert.range — compiled model ${found.length}, live source ${stripped}, `
      + `raw grep ${raw} (${raw-stripped} of them commented out by this package)`);
    assert.strictEqual(found.length, stripped, 'the model and the live source must agree');
    assert.ok(raw > stripped, 'the converted ones must still be readable as comments');
    found.forEach(f=>out(`  ${f.entity.padEnd(20)} ${f.element.padEnd(18)} ${f.range.padEnd(12)} `
        + `${f.readonly?'READ-ONLY, so the value never arrives':''}`));
    // The two WP-13 collected are gone; only the read-only one is left, and it
    // is inert for a reason unrelated to ranges.
    assert.ok(!found.some(f=>f.entity==='FUEL_DELIVERIES'), 'the two collected must be comments now');
    const rob=found.find(f=>f.element==='closing_rob_kg');
    assert.ok(rob, 'ROB_LEDGER.closing_rob_kg must still be there');
    assert.ok(rob.readonly, 'and it is inert because it is read-only, not because it is numeric');
    // Is it backed by a handler check? FB402.
    const burn=fs.readFileSync(`${PROJECT}/srv/burn-service.js`,'utf8');
    const backed=/FB402: Closing ROB cannot be negative/.test(burn);
    out(`  backed by a handler check: ${backed ? 'YES — FB402, burn-service.js' : 'NO'}`);
    assert.ok(backed, 'B8 stands on the handler, not the assertion');
});

it('EXIT-6 — the burn ladder resolves from one place, and all three sites use it', async () => {
    const fs=require('fs');
    const src=fs.readFileSync(`${PROJECT}/srv/burn-service.js`,'utf8')
        .split('\n').filter(l=>!l.trim().startsWith('//')).join('\n');
    const calls=(src.match(/await burnLadder\(/g)||[]).length;
    const literals=(src.match(/absPct <= 5|absPct > 20|absPct <= 10|absPct <= 20/g)||[]).length;
    out(`burnLadder call sites: ${calls}   surviving ladder literals: ${literals}`);
    assert.strictEqual(calls, 3, 'all three former sites must call the one resolver');
    assert.strictEqual(literals, 0, 'no ladder literal may survive');
    const rule=(await P.resolveToleranceRule({ ruleCode:'TOL-BURN-VARIANCE' },{},'2026-04-01')).rule;
    for (const [pct,want] of [[3,'NORMAL'],[7,'WARNING'],[15,'EXCEPTION'],[25,'CRITICAL']]) {
        const l=P.burnVarianceStatus(pct,rule);
        out(`  ${String(pct).padStart(2)}% -> ${l.status.padEnd(9)} requiresReview=${l.requiresReview}`);
        assert.strictEqual(l.status,want);
    }
    // Both former forms agreed; the test must show the ladder is live, not that 5<=5.
    assert.strictEqual(P.burnVarianceStatus(5,rule).status,'NORMAL','the boundary is inclusive, as both forms were');
    assert.strictEqual(P.burnVarianceStatus(5.01,rule).status,'WARNING');
});

it('EXIT-7 — UNKNOWN_TAIL_POLICY still behaves as WP-07B built it', async () => {
    const unknown='ZZ-NOPE';
    for (const policy of ['ACCEPT_PROVISIONAL','REJECT']) {
        const d=TAIL.applyPolicy(unknown,null,'FUEL_TICKET',policy);
        out(`ticket capture under ${policy.padEnd(18)} -> accept=${d.accept}`);
        assert.strictEqual(d.accept,true,'A1: ticket capture is never blockable');
    }
    const sched=TAIL.applyPolicy(unknown,null,'FLIGHT_SCHEDULE','REJECT');
    out(`schedule feed under REJECT              -> accept=${sched.accept}  ${(sched.reason||'').slice(0,60)}`);
    assert.strictEqual(sched.accept,false,'a blockable feed under REJECT must refuse');
    const r=await TAIL.resolvePolicy();
    out(`  and the policy now comes from ${r.source}`);
    assert.ok(r.source.startsWith('TOLERANCE_RULES:'));
});

it('EXIT-8 — HOLD_PAYMENT_ON_DISCREPANCY is registered and changes nothing', async () => {
    const h=await P.resolveParameter('HOLD_PAYMENT_ON_DISCREPANCY',{},'2026-04-01');
    out(`HOLD_PAYMENT_ON_DISCREPANCY = ${h.value}   is_wired=${h.evidence.is_wired}   ${h.evidence.decision_ref}`);
    assert.strictEqual(h.value,false,'C-1: it defaults OFF');
    // Assert the STORED value, not the coerced one. evidence.is_wired reads
    // null as false, so an unpopulated column would have passed this — it did,
    // once, until the seed was fixed.
    const dbx = await cds.connect.to('db');
    const raw = await dbx.run(SELECT.one.from('fuelsphere.TOLERANCE_RULES')
        .where({ rule_code:'HOLD_PAYMENT_ON_DISCREPANCY', row_kind:'PARAMETER' }));
    assert.strictEqual(raw.is_wired, false, 'the row must SAY false, not be silent');
    assert.notStrictEqual(raw.is_wired, null, 'null is not a declaration');
    assert.strictEqual(raw.priority, 100, 'priority must be populated, not null');
    out(`  stored: is_wired=${raw.is_wired} (not null), priority=${raw.priority}`);
    const fs=require('fs'), path=require('path');
    const strip=s=>s.replace(/\/\*[\s\S]*?\*\//g,'').split('\n').filter(l=>!l.trim().startsWith('//')).join('\n');
    let code=0, comment=0;
    (function walk(d){ for(const f of fs.readdirSync(d)){ const p=path.join(d,f);
      if(fs.statSync(p).isDirectory()) walk(p);
      else if(f.endsWith('.js')||f.endsWith('.cds')){ const raw=fs.readFileSync(p,'utf8');
        const inCode=(strip(raw).match(/recon_status/g)||[]).length;
        code+=inCode; comment+=(raw.match(/recon_status/g)||[]).length-inCode; } } })(`${PROJECT}/srv`);
    out(`recon_status across srv/: ${code} in code, ${comment} in comments`);
    // The instrument is proved on a known-present and a known-absent case
    // AFTER stripping, so a broken stripper cannot produce a false pass.
    const fob=strip(fs.readFileSync(`${PROJECT}/srv/lib/fob-reconciliation.js`,'utf8'));
    assert.ok(/recon_status/.test(fob),'known-present: fob-reconciliation writes it in code');
    const store=strip(fs.readFileSync(`${PROJECT}/srv/lib/parameter-store.js`,'utf8'));
    assert.ok(!/recon_status/.test(store),'known-absent: the parameter store never mentions it');
    out(`  instrument proved: fob-reconciliation present, parameter-store absent, after stripping`);
});

it('EXIT-9/10 — the gate, and clean by exit code', async () => {
    const { execFileSync } = require('child_process');
    let gate=0;
    try { execFileSync('node',[`${__dirname}/code-gate.js`],{cwd:PROJECT}); } catch(e){ gate=e.status; }
    out(`extraction gate exit=${gate}  (0 = no emitted code is undocumented)`);
    assert.strictEqual(gate,0);
    const r=await test.get(`${O}/$metadata`);
    assert.strictEqual(r.status,200);
    const paths=[...new Set(Object.values(cds.services)
        .filter(s=>s.definition&&s.path&&s.path.startsWith('/odata')).map(s=>s.path))];
    for (const p of paths) assert.strictEqual((await test.get(p+'/$metadata')).status,200,p);
    out(`${paths.length} OData services all served 200`);
});

it('EXIT-11 — the survey: what the store holds, and one literal no comment pointed here', async () => {
    const db=await cds.connect.to('db');
    const params=await db.run(SELECT.from('fuelsphere.TOLERANCE_RULES').where({row_kind:'PARAMETER'}).orderBy('rule_code'));
    out('TOLERANCE_RULES, row_kind=PARAMETER:');
    params.forEach(p=>out(`  ${p.rule_code.padEnd(30)} ${String(p.value_boolean??p.value_text??p.value_number).padEnd(20)} `
      + `${(p.company_code||'global').padEnd(7)} wired=${p.is_wired} ${p.decision_ref}`));
    const tols=await db.run(SELECT.from('fuelsphere.TOLERANCE_RULES')
        .where({ applies_to:{'!=':null} }).orderBy('rule_code'));
    out(`TOLERANCE_RULES with applies_to: ${tols.length}`);
    tols.forEach(t=>out(`  ${t.rule_code.padEnd(24)} ${String(t.applies_to).padEnd(18)} ${t.tolerance_type}`));
    assert.ok(params.length>=7);
});

});

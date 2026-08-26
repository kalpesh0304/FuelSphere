/**
 * WP-20 — pricing derivation (A10). Eleven exit criteria.
 *
 * Criterion 6 is what the harness is built around: everything else passes on a
 * write-once model, and restatement is what proves it is not one.
 */
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert');
const E=require(`${PROJECT}/srv/lib/pricing-engine`);
const test=cds.test(PROJECT);
const out=s=>process.stdout.write('      '+s+'\n');
const P='/odata/v4/pricing';

const F=n=>`550e8400-e29b-41d4-a716-446655446${n}`;
const SIN=F('001'), RTM=F('002');
const C_PETAV ='d4e5f6a7-4444-4000-8000-000000000001';   // NATIVE,   FRM-001
const C_PETRON='d4e5f6a7-4444-4000-8000-000000000002';   // NATIVE,   FRM-002
const C_BP    ='d4e5f6a7-4444-4000-8000-000000000003';   // CPE,      FRM-004
const C_TOTAL ='d4e5f6a7-4444-4000-8000-000000000004';   // CPE,      FRM-003 (expired)
const C_CALTEX='d4e5f6a7-4444-4000-8000-000000000006';   // NATIVE,   FRM-006

const db = () => cds.connect.to('db');
const derive = (body) => test.post(`${P}/derivePrice`, body);
const priceRow = (id) => db().then(d => d.run(SELECT.one.from('fuelsphere.DERIVED_PRICES').where({ ID: id })));
const logsFor  = (id) => db().then(d => d.run(SELECT.from('fuelsphere.PRICE_DERIVATION_LOGS')
                                       .where({ derived_price_ID: id }).orderBy('sequence')));
const bd = (row) => JSON.parse(row.component_breakdown);

const fails = async (body, code, needle) => {
    try { await derive(body); assert.fail(`expected ${code}, got 200`); }
    catch (e) {
        assert.strictEqual(e.response.status, code, `status: ${JSON.stringify(e.response.data)}`);
        const msg = JSON.stringify(e.response.data);
        assert.ok(msg.includes(needle), `expected '${needle}' in ${msg}`);
        return msg;
    }
};

describe('WP-20 — pricing derivation', function () {

// ======================================================================
it('EXIT-1 — a formula resolves for a contract at a date, and the row that resolved is recorded', async () => {
    const { data } = await derive({ contractId: C_PETAV, effectiveDate: '2026-01-17', companyCode: '1000' });
    out(`FRM resolved: ${data.formulaId} v${data.formulaVersion} via scope ${data.scopeResolvedBy}`);
    assert.strictEqual(data.formulaId, 'FRM-001');
    assert.strictEqual(data.scopeResolvedBy, 'SUPPLIER+COMPANY');

    const row = await priceRow(data.derivedPriceId);
    const ev = bd(row).resolvedFrom;
    out(`  evidence: tier ${ev.scope_tier} ${ev.scope_name}, supplier ${ev.scope_supplier_id}, company ${ev.scope_company_code}`);
    out(`            valid ${ev.valid_from} to ${ev.valid_to || 'open'}, ${ev.effective_candidates} effective, ${ev.candidates_at_tier} in scope`);
    assert.strictEqual(ev.resolved_by, 'PRICING_FORMULAS');
    assert.strictEqual(ev.scope_supplier_id, 'b2c3d4e5-2222-4000-8000-000000000001');
    assert.strictEqual(row.formula_ID, F('101'), 'the resolved row is stamped on the price');

    // The instrument could have failed: a different contract resolves a
    // different formula over the same seed and date.
    const other = await derive({ contractId: C_PETRON, effectiveDate: '2026-01-17', companyCode: '1000' });
    assert.strictEqual(other.data.formulaId, 'FRM-002');
    out(`  a different contract resolves FRM-002 — the scope discriminates`);

    // DRAFT is not a formula anybody agreed to; expired priced a closed period.
    await fails({ contractId: C_TOTAL, effectiveDate: '2026-01-17', companyCode: '1000' }, 404, 'PRC450');
    out(`  FRM-003 expired 2025-12-31 -> PRC450 at a 2026 date`);
    const m = await fails({ contractId: C_PETAV, effectiveDate: '2026-01-17' }, 404, 'PRC450');
    out(`  no companyCode -> PRC450: a scope that cannot be verified does not match`);
    assert.ok(m.includes('company unstated'));
});

// ======================================================================
it('EXIT-2 — components apply in sequence and stay individually visible', async () => {
    const { data } = await derive({ contractId: C_PETAV, effectiveDate: '2026-01-17', companyCode: '1000' });
    const b = bd(await priceRow(data.derivedPriceId));
    b.components.forEach(c => out(`  seq${c.sequence} ${c.name.padEnd(30)} ${String(c.value).padStart(9)}  ${c.basis}`));
    assert.deepStrictEqual(b.components.map(c => c.sequence), [1,2,3,4,5], 'sequence order');
    assert.deepStrictEqual(b.components.map(c => c.name),
        ['Base Index','Premium','Into-Plane Fee','Handling Fee','Excise Duty']);

    // PRC404. The list IS the answer and the total is derivable FROM it.
    const priced = b.components.filter(c => !c.excluded_from_price);
    const sum = E.r4(priced.reduce((a, c) => a + c.value, 0));
    assert.strictEqual(sum, data.derivedPrice, 'the components reconstruct the price');
    out(`  ${priced.map(c=>c.value).join(' + ')} = ${sum} = derived_price`);

    // PRC403. The duty is carried at its declared value and NOT priced.
    const duty = b.components.find(c => c.component_type === 'EXCISE_DUTY');
    assert.strictEqual(duty.value, 0.5);
    assert.strictEqual(duty.excluded_from_price, true);
    assert.strictEqual(data.taxComponentCount, 1);
    assert.strictEqual(b.subtotals.cumulativeIncludingTaxComponents, E.r4(sum + 0.5));
    out(`  Excise Duty 0.5 carried in the breakdown, excluded from ${data.derivedPrice} (PRC403)`);
});

// ======================================================================
it('EXIT-3 — a capped and a floored component behave correctly at the boundary', async () => {
    // The levy is 1% of the base index, floored 0.7700 and capped 0.7800. The
    // SUBJECT is the bound; the VARIABLE is the index. They do not move
    // together — the bounds are fixed and the curve crosses them.
    const levy = async (date) => {
        const { data } = await derive({ contractId: C_PETRON, effectiveDate: date, companyCode: '1000' });
        const c = bd(await priceRow(data.derivedPriceId)).components.find(x => x.name === 'Index-Linked Levy');
        return { c, base: bd(await priceRow(data.derivedPriceId)).components[0].value, price: data.derivedPrice };
    };
    const hi = await levy('2026-01-17');   // 1% of 78.30 = 0.7830 -> capped
    const mid= await levy('2026-01-16');   // 1% of 77.85 = 0.7785 -> free
    const lo = await levy('2026-01-12');   // 1% of 76.90 = 0.7690 -> floored
    for (const [l, r] of [['capped',hi],['free',mid],['floored',lo]])
        out(`  ${l.padEnd(8)} base ${r.base}  raw ${E.r4(r.base/100)}  applied ${r.c.value}  ${r.c.note || ''}`);

    assert.strictEqual(hi.c.value, 0.78,   'raw 0.7830 must cap at max_value');
    assert.ok(hi.c.note.includes('capped at max_value 0.78'));
    assert.strictEqual(mid.c.value, 0.7785, 'inside the band it is untouched');
    assert.strictEqual(mid.c.note, null);
    assert.strictEqual(lo.c.value, 0.77,   'raw 0.7690 must rise to min_value');
    assert.ok(lo.c.note.includes('raised to min_value 0.77'));

    // Either bound would pass vacuously if the raw value never crossed it.
    assert.ok(E.r4(hi.base/100) > 0.78,  'the capped case must genuinely exceed the cap');
    assert.ok(E.r4(lo.base/100) < 0.77,  'the floored case must genuinely fall below the floor');
});

// ======================================================================
it('EXIT-4 — a conditional component fires and does not fire, per its condition', async () => {
    const run = async (status, settles) => {
        const { data } = await derive({ contractId: C_PETRON, effectiveDate: '2026-01-16',
            companyCode: '1000', priceStatus: status, settlesForPeriod: settles });
        const c = bd(await priceRow(data.derivedPriceId)).components.find(x => x.sequence === 5);
        return { c, price: data.derivedPrice };
    };
    const f = await run('FINAL');
    const p = await run('PROVISIONAL', '2026-01');
    out(`  FINAL       seq5 fired=${f.c.fired} value=${f.c.value}  ${f.c.note}`);
    out(`  PROVISIONAL seq5 fired=${p.c.fired} value=${p.c.value}  ${p.c.note}`);
    assert.strictEqual(f.c.fired, false);
    assert.strictEqual(f.c.value, 0);
    assert.ok(f.c.note.includes('condition not met'));
    assert.strictEqual(p.c.fired, true);
    assert.strictEqual(p.c.value, 0.25);
    assert.strictEqual(E.r4(p.price - f.price), 0.25, 'the whole difference is the component');

    // An unknown field is NOT a silent pass.
    const unknown = E.conditionHolds({ condition_field: 'nope', condition_operator: 'EQ', condition_value: 'x' }, {});
    assert.strictEqual(unknown.fires, false);
    out(`  an absent condition field does not fire: ${unknown.why}`);
});

// ======================================================================
it('EXIT-5 — a provisional and a final price for the same uplift are both representable and distinguishable', async () => {
    const prov = await derive({ contractId: C_PETRON, effectiveDate: '2026-01-16', companyCode: '1000',
        priceStatus: 'PROVISIONAL', settlesForPeriod: '2026-01' });
    const fin  = await derive({ contractId: C_PETRON, effectiveDate: '2026-01-16', companyCode: '1000',
        priceStatus: 'FINAL' });
    out(`  PROVISIONAL ${prov.data.derivedPrice} settles ${prov.data.settlesForPeriod}`);
    out(`  FINAL       ${fin.data.derivedPrice} settles ${fin.data.settlesForPeriod || '(already settled)'}`);
    assert.notStrictEqual(prov.data.derivedPrice, fin.data.derivedPrice);

    // BOTH are current. A provisional price is not a draft of the final one —
    // it is a real price from a contracted proxy, and it settles.
    const both = await (await db()).run(SELECT.from('fuelsphere.DERIVED_PRICES')
        .where({ contract_ID: C_PETRON, price_date: '2026-01-16', is_current: true }));
    const byStatus = Object.fromEntries(both.map(r => [r.price_status, r]));
    assert.strictEqual(both.length, 2, 'the final must not supersede the provisional');
    assert.strictEqual(byStatus.PROVISIONAL.settles_for_period, '2026-01');
    assert.strictEqual(byStatus.FINAL.settles_for_period, null);
    out(`  ${both.length} current rows for the same date, one per status — the difference is ${E.r4(prov.data.derivedPrice - fin.data.derivedPrice)}`);

    // PRC409: a provisional price that cannot say what it settles against
    // cannot be settled.
    await fails({ contractId: C_PETRON, effectiveDate: '2026-01-16', companyCode: '1000',
        priceStatus: 'PROVISIONAL' }, 400, 'PRC409');
    out(`  PROVISIONAL without settlesForPeriod -> PRC409`);
});

// ======================================================================
it('EXIT-7 — the log decomposes the price without recomputing it', async () => {
    const { data } = await derive({ contractId: C_PETAV, effectiveDate: '2026-01-17', companyCode: '1000' });
    const logs = await logsFor(data.derivedPriceId);
    logs.forEach(l => out(`  ${String(l.sequence).padStart(2)} ${l.log_level.padEnd(7)} ${l.log_category.padEnd(9)} ${l.log_message.slice(0,96)}`));
    assert.strictEqual(logs.length, data.logEntries);

    const cats = new Set(logs.map(l => l.log_category));
    for (const c of ['CONFIG','INDEX','COMPONENT','RESULT']) assert.ok(cats.has(c), `missing category ${c}`);

    // PRC407. Every quote used and the formula version, so the price is
    // re-explainable WITHOUT recomputation.
    const b = bd(await priceRow(data.derivedPriceId));
    const base = b.components.find(c => c.index);
    assert.ok(base.index.quotes_used.length >= 1);
    assert.ok(base.index.quotes_used.every(q => q.id && q.date && q.value !== undefined),
        'a quote must be identified by ID, not only by date and value');
    out(`  quote ids stamped: ${base.index.quotes_used.map(q=>`${q.date}=${q.value}`).join(', ')}`);
    assert.strictEqual(b.formula.version, 1);

    // Every component has its own log line carrying input, output and the
    // expression that produced it.
    const compLogs = logs.filter(l => l.component_id);
    assert.strictEqual(new Set(compLogs.map(l => l.component_id)).size, 5, 'one line per component');
    const handling = logs.find(l => l.log_message.includes('Handling Fee'));
    out(`  Handling Fee: input ${handling.input_value} -> output ${handling.output_value} via "${handling.calculation_expression}"`);
    assert.strictEqual(Number(handling.input_value), 93);
    assert.strictEqual(Number(handling.output_value), 1.395);

    const result = logs.find(l => l.log_category === 'RESULT');
    out(`  RESULT expression: ${result.calculation_expression}`);
    assert.ok(result.calculation_expression.endsWith(`= ${data.derivedPrice}`));

    // The failure path does NOT log, and that is measured rather than assumed.
    // req.error rolls the request transaction back; cds.tx() without req and
    // req.on('failed') both deadlock on the single connection. The reason
    // survives in the error, not in the table.
    const count = async () => (await (await db()).run(SELECT.from('fuelsphere.PRICE_DERIVATION_LOGS')
        .where({ derived_price_ID: null }))).length;
    const before = await count();
    await fails({ contractId: C_CALTEX, effectiveDate: '2026-01-18', companyCode: '1000' }, 422, 'PRC411');
    await new Promise(r => setImmediate(r));
    out(`  a refused derivation carries PRC411 in the error and logs ${await count() - before} row(s) — `
      + `req.error rolls the log back with the request (finding F, WP-20)`);
    assert.strictEqual(await count(), before);
});

// ======================================================================
it('EXIT-8 — index resolution picks the RIGHT value from a curve, not the only value', async () => {
    const curve = await E.publishedCurve(SIN, '2026-01-19');
    out(`  published curve to 2026-01-19: ${curve.length} day(s) — ${curve.map(q=>q.effective_date).reverse().join(' ')}`);
    assert.ok(curve.length >= 10, 'a curve, not a point');
    assert.ok(!curve.some(q => q.effective_date === '2026-01-19'), 'the market holiday is not on the curve');

    // ---- N+0 and N-1 select DIFFERENT DAYS on the same date ----------
    const n0 = await derive({ contractId: C_PETAV,  effectiveDate: '2026-01-16', companyCode: '1000' });
    const n1 = await derive({ contractId: C_CALTEX, effectiveDate: '2026-01-16', companyCode: '1000' });
    const b0 = bd(await priceRow(n0.data.derivedPriceId)).components[0].index;
    const b1 = bd(await priceRow(n1.data.derivedPriceId)).components[0].index;
    out(`  N+0 -> ${b0.effective_date} = ${b0.value}`);
    out(`  N-1 -> ${b1.effective_date} = ${b1.value}`);
    assert.strictEqual(b0.effective_date, '2026-01-16');
    assert.strictEqual(b1.effective_date, '2026-01-15');
    assert.notStrictEqual(b0.value, b1.value, 'a different day with the same value would prove nothing');
    assert.strictEqual(b0.offset_applied, 0);
    assert.strictEqual(b1.offset_applied, 1);

    // ---- the offset counts PUBLISHED days, not calendar days --------
    // 2026-01-12 is a Monday: N-1 must be Friday 01-09, not Sunday 01-11.
    const back = await E.resolveIndexValue(SIN, '2026-01-12', 1, 'PRIOR_PUBLISHED');
    out(`  N-1 from Monday 2026-01-12 -> ${back.effective_date} (Friday), skipping the weekend`);
    assert.strictEqual(back.effective_date, '2026-01-09');

    // ---- averaging picks a window, not a point ----------------------
    const avg = await derive({ contractId: C_BP, effectiveDate: '2026-01-16', companyCode: '2000' });
    const ba = bd(await priceRow(avg.data.derivedPriceId)).components[0].index;
    out(`  5-day average to 2026-01-16 = ${ba.value} over ${ba.quotes_used.map(q=>`${q.date}:${q.value}`).join(' ')}`);
    assert.strictEqual(ba.actual_days, 5);
    assert.strictEqual(ba.value, 82.6);
    assert.notStrictEqual(ba.value, b0.value, 'the average must differ from the spot it contains');

    // ---- a missing quote day, handled PER THE FORMULA'S POLICY ------
    // 2026-01-18 is a Sunday. Same index, same date, two policies.
    const sub = await derive({ contractId: C_PETAV, effectiveDate: '2026-01-18', companyCode: '1000' });
    const bs = bd(await priceRow(sub.data.derivedPriceId)).components[0].index;
    out(`  PRIOR_PUBLISHED on 2026-01-18 -> substituted ${bs.effective_date} = ${bs.value}, substituted=${bs.substituted}`);
    assert.strictEqual(bs.substituted, true);
    assert.strictEqual(bs.substituted_from, '2026-01-18');
    assert.strictEqual(bs.effective_date, '2026-01-17');
    assert.strictEqual(bs.missing_quote_policy, 'PRIOR_PUBLISHED');
    const subLog = (await logsFor(sub.data.derivedPriceId)).find(l => l.log_message.includes('PRC411'));
    assert.ok(subLog, 'a substitution must be stated, never silent');
    out(`    logged: ${subLog.log_message.slice(0,110)}`);

    await fails({ contractId: C_CALTEX, effectiveDate: '2026-01-18', companyCode: '1000' }, 422, 'PRC411');
    out(`  FAIL on 2026-01-18 -> refused. Same index, same date, different policy`);

    // ---- the market holiday row exists and is still not priced on ---
    const hol = await derive({ contractId: C_PETAV, effectiveDate: '2026-01-19', companyCode: '1000' });
    const bh = bd(await priceRow(hol.data.derivedPriceId)).components[0].index;
    out(`  2026-01-19 has a row (is_holiday) -> resolved ${bh.effective_date} = ${bh.value}, substituted=${bh.substituted}`);
    assert.strictEqual(bh.effective_date, '2026-01-17', 'a closed market published no assessment');
    assert.strictEqual(bh.substituted, true);
});

// ======================================================================
it('EXIT-9 — engine selection is per contract, and CPE is resolvable and unimplemented', async () => {
    const nat = await derive({ contractId: C_PETAV, effectiveDate: '2026-01-17', companyCode: '1000' });
    const cpe = await derive({ contractId: C_BP,    effectiveDate: '2026-01-17', companyCode: '2000' });
    out(`  PAL-PETAV  price_type NATIVE -> ${nat.data.pricingEngine}`);
    out(`  PAL-BP     price_type CPE    -> ${cpe.data.pricingEngine}`);
    assert.strictEqual(nat.data.pricingEngine, 'NATIVE');
    assert.strictEqual(cpe.data.pricingEngine, 'NATIVE_FALLBACK');
    const e = bd(await priceRow(cpe.data.derivedPriceId)).engine;
    assert.strictEqual(e.requested, 'CPE');
    assert.strictEqual(e.source, 'MASTER_CONTRACTS.price_type');
    const w = (await logsFor(cpe.data.derivedPriceId)).find(l => l.log_message.includes('PRC402'));
    out(`    ${w.log_message.slice(0,140)}`);
    assert.strictEqual(w.log_level, 'WARNING', 'a fallback is not an INFO');
});

// ======================================================================
it('EXIT-10/11 — the survey: readers of a derived price, and what unit it is per', async () => {
    const d = await db();
    const dp = await d.run(SELECT.one.from('fuelsphere.DERIVED_PRICES')
        .where({ ID: (await derive({ contractId: C_PETAV, effectiveDate: '2026-01-17', companyCode: '1000' })).data.derivedPriceId }));
    out(`  DERIVED_PRICES.uom is EXPLICIT: ${dp.uom_uom_code}, currency ${dp.currency_currency_code}`);
    assert.strictEqual(dp.uom_uom_code, 'KG');

    // FUEL_ORDERS.unit_price has no unit of its own — it follows uom_code.
    const orders = await d.run(SELECT.from('fuelsphere.FUEL_ORDERS')
        .columns('order_number','uom_code','unit_price').where({ unit_price: { '!=': null } }));
    const byUom = {};
    for (const o of orders) (byUom[o.uom_code || '(unstated)'] ||= []).push(Number(o.unit_price));
    for (const [u, v] of Object.entries(byUom))
        out(`  FUEL_ORDERS.unit_price per ${u}: ${v.length} order(s), rates ${[...new Set(v)].sort().join(', ')}`);
    out(`  FUEL_ORDERS.unit_price has NO unit of its own — it follows uom_code.`);
    out(`  DERIVED_PRICES.uom IS explicit. Writing a ${dp.uom_uom_code} price onto an LTR order`);
    out(`  is wrong by the density factor, and nothing in the model would catch it.`);
    assert.ok(Object.keys(byUom).length >= 1);
});

// ======================================================================
// EXIT-6 RUNS LAST ON PURPOSE. It restates a quote that EXIT-8's offset and
// averaging assertions both read. Run in declaration order it would move the
// curve under them, and the failure would look like a resolution bug rather
// than a test asserting against state it had modified itself.
it('EXIT-6 — a restated index value reprices what depended on it, and the original survives', async () => {
    // Three prices over the SAME quote, reached three different ways: at N+0,
    // at N-1 from the next day, and inside a five-day average. Only the first
    // names 2026-01-15 as its base_index_date, so a reprice keyed on that
    // column would silently miss the other two.
    const spot = await derive({ contractId: C_PETAV,  effectiveDate: '2026-01-15', companyCode: '1000' });
    const n1   = await derive({ contractId: C_CALTEX, effectiveDate: '2026-01-16', companyCode: '1000' });
    const avg  = await derive({ contractId: C_BP,     effectiveDate: '2026-01-16', companyCode: '2000' });
    out(`  before: spot(N+0 on 01-15) ${spot.data.derivedPrice}  N-1(from 01-16) ${n1.data.derivedPrice}  avg(5d to 01-16) ${avg.data.derivedPrice}`);
    assert.strictEqual(n1.data.baseIndexValue, 83.25, 'N-1 from 01-16 is the 01-15 quote');
    assert.strictEqual(avg.data.baseIndexValue, 82.6);

    const quote = await (await db()).run(SELECT.one.from('fuelsphere.MARKET_INDEX_VALUES')
        .where({ market_index_ID: SIN, effective_date: '2026-01-15', is_current: true }));
    assert.strictEqual(Number(quote.index_value), 83.25);

    // 83.2500 -> 84.0000
    const res = await test.post(`${P}/MarketIndexValues(${quote.ID})/PricingService.correct`,
        { newValue: 84.0, correctionReason: 'Platts republished the 15 January assessment' });
    out(`  restated: ${res.data.index_value} is_corrected=${res.data.is_corrected} restates=${res.data.restates_ID === quote.ID}`);
    assert.strictEqual(Number(res.data.index_value), 84);
    assert.strictEqual(res.data.restates_ID, quote.ID);

    // THE ORIGINAL VALUE IS RETAINED. It was a fact about the day.
    const original = await (await db()).run(SELECT.one.from('fuelsphere.MARKET_INDEX_VALUES').where({ ID: quote.ID }));
    assert.strictEqual(Number(original.index_value), 83.25, 'the original row must still hold 83.25');
    assert.strictEqual(original.is_current, false, 'and must be stood down');
    out(`  original row survives at ${original.index_value}, is_current=${original.is_current}`);

    // All three reprice, and all three prior rows are superseded rather than
    // overwritten — DERIVED_PRICES is not write-once either.
    // The deltas are not all 0.75. FRM-001 carries a 1.5% handling component on
    // the running total, so the restatement compounds through it; FRM-004
    // averages over five published days, so one restated day moves the average
    // by a fifth. A test expecting 0.75 everywhere would be asserting that the
    // formula does not apply.
    for (const [label, before, expectDelta, why] of [
            ['spot', spot, 0.7612, '0.75 plus 1.5% handling on it'],
            ['N-1',  n1,   0.75,   'no percentage component'],
            ['avg',  avg,  0.15,   '0.75 over a five day window']]) {
        const old = await priceRow(before.data.derivedPriceId);
        const now = await (await db()).run(SELECT.one.from('fuelsphere.DERIVED_PRICES')
            .where({ contract_ID: old.contract_ID, price_date: old.price_date,
                     price_status: old.price_status, is_current: true }));
        out(`  ${label.padEnd(5)} ${old.derived_price} -> ${now.derived_price}  delta ${E.r4(now.derived_price - old.derived_price)} (${why})  superseded_by set: ${old.superseded_by === now.ID}`);
        assert.strictEqual(old.is_current, false, `${label}: the prior price must be superseded, not overwritten`);
        assert.strictEqual(old.superseded_by, now.ID);
        assert.ok(old.superseded_reason.includes('restated'), old.superseded_reason);
        assert.strictEqual(E.r4(now.derived_price - old.derived_price), expectDelta,
            `${label}: the reprice must move by the restatement, not by an arbitrary amount`);
    }
    // The base index the reprice USED, not the price it produced.
    const spotNow = await (await db()).run(SELECT.one.from('fuelsphere.DERIVED_PRICES')
        .where({ contract_ID: C_PETAV, price_date: '2026-01-15', is_current: true }));
    assert.strictEqual(Number(spotNow.base_index_value), 84, 'the reprice must read the restated quote');
    out(`  the repriced spot reads base_index_value 84.0000, the restated assessment`);

    // A quote already restated cannot be restated again.
    try {
        await test.post(`${P}/MarketIndexValues(${quote.ID})/PricingService.correct`,
            { newValue: 85, correctionReason: 'again' });
        assert.fail('expected 409');
    } catch (e) { assert.strictEqual(e.response.status, 409); }
    out(`  restating a superseded row -> 409`);
});

});

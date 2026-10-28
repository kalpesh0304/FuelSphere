/**
 * CREDIT MEMO — FS-SPEC-CM-001 at BTP level.
 *
 * Every reference is real. The invoice line: the posted invoice
 * INV-WFS-20260324-001 bills 2200 KG (ordered) at 0.85 where 2180 KG was
 * delivered, so 17.00 + 12% tax is a credit the supplier owes. The expected
 * credits: defuels to a supplier, created and posted through DefuelService
 * exactly as the defuel app does — an expected credit IS such a defuel.
 *
 *   EXIT-1  the seeded memo balances and simulates clean; post moves it to POSTED, S/4 number stays null
 *   EXIT-2  a second credit on the same invoice line beyond what is left is refused (CRD402)
 *   EXIT-3  duplicate is an error (CRD407); same number, other amount, is only a warning (CRD408)
 *   EXIT-4  VENDOR: the defuel's and the uplift ticket's vendor must be the credit memo's (CRD404, naming both)
 *   EXIT-5  a defuel whose credit has not been agreed (PARKED) cannot be credited (CRD406)
 *   EXIT-6  within tolerance CLEARS with variance; short beyond tolerance posts AND lands on the worklist
 *   EXIT-7  "close & write off" writes off the shortfall; reversal re-derives the clearing to OPEN
 *   EXIT-8  status guards: a POSTED memo cannot be edited, an unposted one cannot be reversed
 *   EXIT-9  proposeLines on an invoice proposes its lines with what is still open
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV = 'development'; process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const test = cds.test(PROJECT); const out = s => process.stdout.write('      ' + s + '\n');
const S = '/odata/v4/credit-memo';
const D = '/odata/v4/defuel/Defuels';
const WFS = 'b2c3d4e5-2222-4000-8000-00000000A001';
const SEED_MEMO = 'cd000000-0000-4000-8000-000000000001';
const INV_LINE = '550e8400-e29b-41d4-a716-44665544A211';
const INVOICE = '550e8400-e29b-41d4-a716-44665544A201';
const UPLIFT_TICKET = 'b8c9d0e1-8888-4000-8000-00000000A002';   // WFS-YYZ-2026032401, order supplier WFS

const r2 = v => Math.round(Number(v) * 100) / 100;
const fail = async p => { try { await p; } catch (e) { return e.response ? e.response.data.error : e; } assert.fail('expected a refusal'); };
const codes = err => [err.message, ...(err.details || []).map(d => d.message)].join(' | ');
const memo = (cmNo, gross, lines, extra = {}) => test.post(`${S}/CreditMemos`, {
    memo_type: 'CREDIT_MEMO', supplier_ID: WFS, supplier_cm_number: cmNo, document_date: '2026-09-25',
    posting_date: '2026-09-25', company_code: '3000', currency_code: 'USD',
    stated_gross_amount: gross, tax_amount: 0, reason_code: 'DEFUEL_RETURN', lines, ...extra });
const post = id => test.post(`${S}/CreditMemos(${id})/CreditMemoService.postMemo`, {});
const sim = async id => (await test.get(`${S}/CreditMemos(${id})/CreditMemoService.simulate()`)).data;
const ec = async id => (await test.get(`${S}/ExpectedCredits(${id})`)).data;
const ecLine = (id, amount, extra = {}) => ({ reference_type: 'EXPECTED_CREDIT', defuel_ID: id, amount, ...extra });

describe('Credit memo — FS-SPEC-CM-001, BTP level', () => {
    let tail, location, other, when;
    const defuels = {};

    // A defuel to a supplier, through the draft flow the defuel app uses.
    async function defuel(litres, supplierId, credit) {
        const draft = await test.post(D, { defuel_type: 'TO_SUPPLIER', source_mode: 'WITHOUT_FLIGHT',
            tail_registration: tail, station_code: location.station_code, location_code: location.code,
            defuel_date: when.date, defuel_time: when.time, quantity_vol: litres,
            supplier_ID: supplierId, ticket_number: `DF-${Math.random().toString(36).slice(2, 8).toUpperCase()}` });
        const id = draft.data.ID;
        if (draft.data.IsActiveEntity === false)
            await test.post(`${D}(ID=${id},IsActiveEntity=false)/DefuelService.draftActivate`, {});
        if (credit !== undefined)
            await test.post(`${D}(ID=${id},IsActiveEntity=true)/DefuelService.postToSupplier`, { expected_credit_usd: credit });
        return SELECT.one.from('fuelsphere.DEFUEL').where({ ID: id });
    }

    before(async function () {
        this.timeout(180000);
        cds.context = { user: new cds.User.Privileged() };
        // The tail carrying the most valued stock, so three defuels fit.
        const stock = await SELECT.from('fuelsphere.FUEL_STOCK_BALANCE').columns('tail_number', 'balance_qty_kg', 'rate_usd_per_kg')
            .where({ valuation_method: 'FIFO', storage_location: null, balance_qty_kg: { '>': 0 } });
        const by = {};
        for (const b of stock) if (Number(b.rate_usd_per_kg) > 0) by[b.tail_number] = (by[b.tail_number] || 0) + Number(b.balance_qty_kg);
        tail = Object.entries(by).sort((a, b) => b[1] - a[1])[0][0];
        // A defuel draws on the stock the tail held AT ITS OWN TIME (DFL425/432),
        // so date it the day after the tail's last ledger movement: all of the
        // tail's stock is on board then, and no later movement can go negative.
        const last = await SELECT.one.from('fuelsphere.ROB_LEDGER').columns('record_date')
            .where({ tail_number: tail }).orderBy('record_date desc');
        const next = new Date(`${last.record_date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
        when = { date: next.toISOString().slice(0, 10), time: '12:00:00' };
        location = await SELECT.one.from('fuelsphere.STORAGE_LOCATION').where({ location_type: 'DEFUEL', is_active: true });
        other = await SELECT.one.from('fuelsphere.MASTER_SUPPLIERS').columns('ID', 'supplier_code').where({ ID: { '!=': WFS } });

        // Expected credits a little under the fuel's value, so DFL431 never fires.
        for (const k of ['clear', 'short']) {
            const d = await defuel(400, WFS);    // well above the 25.00 floor at any tail's rate
            const credit = r2(Math.min(1000, Number(d.fuel_value_usd) * 0.9));
            await test.post(`${D}(ID=${d.ID},IsActiveEntity=true)/DefuelService.postToSupplier`, { expected_credit_usd: credit });
            defuels[k] = { ID: d.ID, credit };
        }
        defuels.otherVendor = await defuel(20, other.ID, 10);
        defuels.parked = await defuel(20, WFS);            // no credit agreed yet
        out(`tail ${tail}, ${location.code}: credits ${defuels.clear.credit} / ${defuels.short.credit}`);
        assert.ok(defuels.short.credit > 100, 'the short case needs a credit well above the 25.00 tolerance floor');
    });

    it('EXIT-1  seeded memo balances, simulates clean, and posts', async () => {
        const { data: m } = await test.get(`${S}/CreditMemos(${SEED_MEMO})?$expand=lines`);
        assert.strictEqual(Number(m.balance), 0);
        assert.strictEqual(m.balanceCriticality, 3);
        assert.strictEqual(Number(m.lines[0].open_amount), 1870, 'nothing credited yet: the full line is open');
        assert.strictEqual((await sim(SEED_MEMO)).canPost, true);
        const { data: r } = await post(SEED_MEMO);
        assert.strictEqual(r.status, 'POSTED');
        const { data: after } = await test.get(`${S}/CreditMemos(${SEED_MEMO})?$expand=lines,log`);
        assert.strictEqual(after.s4_document_number, null, 'no S/4 call exists, so no S/4 number may appear');
        assert.strictEqual(Number(after.lines[0].open_amount), 1853, '1870 less the 17.00 credited');
        assert.ok(after.log.some(l => l.event === 'POSTED'));
        out(`${after.document_number} POSTED; invoice line open 1870 -> ${after.lines[0].open_amount}`);
    });

    it('EXIT-2  over-credit on the same reference is refused, net of the earlier credit', async () => {
        const { data: m } = await memo('WFS-CN-OVER', 1860,
            [{ reference_type: 'INVOICE_LINE', invoice_item_ID: INV_LINE, amount: 1860, value_only: true }]);
        assert.strictEqual(m.lines[0].po_number, '4500100002', 'PO derived from the reference');
        const err = await fail(post(m.ID));
        assert.match(codes(err), /CRD402.*1877\.00 exceeds 1870\.00.*17\.00 credited earlier/);
        await test.delete(`${S}/CreditMemos(${m.ID})`);
    });

    it('EXIT-3  duplicate is an error; reused number with another amount is a warning', async () => {
        const line = [ecLine(defuels.short.ID, 10)];
        const { data: a } = await memo('WFS-CN-DUP', 10, line);
        const { data: b } = await memo('WFS-CN-DUP', 10, line);
        const { data: c } = await memo('WFS-CN-DUP', 11, line, { tax_amount: 1 });
        assert.ok((await sim(b.ID)).messages.some(x => x.code === 'CRD407' && x.severity === 'ERROR'));
        const simC = await sim(c.ID);
        assert.ok(!simC.messages.some(x => x.code === 'CRD407'));
        assert.ok(simC.messages.some(x => x.code === 'CRD408' && x.severity === 'WARNING'));
        for (const id of [a.ID, b.ID, c.ID]) await test.delete(`${S}/CreditMemos(${id})`);
    });

    it('EXIT-4  VENDOR on the defuel and on the uplift ticket must be the credit memo vendor', async () => {
        // A WFS credit memo against another vendor's defuel.
        const { data: a } = await memo('WFS-CN-VENDOR', 10, [ecLine(defuels.otherVendor.ID, 10)]);
        const va = (await sim(a.ID)).messages.find(x => x.code === 'CRD404');
        assert.ok(va, 'a defuel from another vendor was accepted');
        assert.match(va.message, new RegExp(`vendor on defuel .* is ${other.supplier_code}.*credit memo is from WFS001`));

        // Another vendor's credit memo against WFS's uplift ticket.
        const { data: b } = await memo('OTHER-CN-1', 10,
            [{ reference_type: 'FUEL_TICKET', ticket_ID: UPLIFT_TICKET, amount: 10, value_only: true }],
            { supplier_ID: other.ID });
        const vb = (await sim(b.ID)).messages.find(x => x.code === 'CRD404');
        assert.ok(vb, 'an uplift ticket from another vendor was accepted');
        assert.match(vb.message, /vendor on uplift ticket WFS-YYZ-2026032401 is WFS001.*credit memo is from/);

        // The same uplift ticket under its own vendor raises no CRD404.
        const { data: c } = await memo('WFS-CN-TICKET', 10,
            [{ reference_type: 'FUEL_TICKET', ticket_ID: UPLIFT_TICKET, amount: 10, value_only: true }]);
        assert.ok(!(await sim(c.ID)).messages.some(x => x.code === 'CRD404'));
        out(va.message); out(vb.message);
        for (const id of [a.ID, b.ID, c.ID]) await test.delete(`${S}/CreditMemos(${id})`);
    });

    it('EXIT-5  a defuel with no agreed credit cannot be credited', async () => {
        const { data: m } = await memo('WFS-CN-PARKED', 10, [ecLine(defuels.parked.ID, 10)]);
        const x = (await sim(m.ID)).messages.find(y => y.code === 'CRD406');
        assert.ok(x && /PARKED - no expected credit has been agreed/.test(x.message), JSON.stringify(x));
        await test.delete(`${S}/CreditMemos(${m.ID})`);
    });

    it('EXIT-6  within tolerance clears; beyond posts and goes to the worklist', async () => {
        const c1 = r2(defuels.clear.credit - 20);
        const { data: m1 } = await memo('WFS-CN-EC1', c1, [ecLine(defuels.clear.ID, c1)]);
        await post(m1.ID);
        const e1 = await ec(defuels.clear.ID);
        assert.strictEqual(e1.credit_status, 'CLEARED');
        assert.strictEqual(Number(e1.variance_amount), 20, 'the 20.00 short goes to Defuel Credit Variance');
        assert.strictEqual(Number(e1.open_amount), 0);

        const c2 = r2(defuels.short.credit * 0.6);
        const { data: m2 } = await memo('WFS-CN-EC2', c2, [ecLine(defuels.short.ID, c2)]);
        assert.strictEqual((await post(m2.ID)).data.status, 'POSTED', 'never held: posting continues');
        const e2 = await ec(defuels.short.ID);
        assert.strictEqual(e2.credit_status, 'PARTIALLY_CLEARED');
        assert.strictEqual(Number(e2.open_amount), r2(defuels.short.credit - c2));
        const { data: x } = await test.get(`${S}/Exceptions?$filter=memo_ID eq ${m2.ID}`);
        assert.strictEqual(x.value.length, 1);
        assert.strictEqual(x.value[0].code, 'CRD413');
        out(`clear: CLEARED variance ${e1.variance_amount}; short: PARTIALLY_CLEARED open ${e2.open_amount}`);
        defuels.short.memo = m2.ID;
    });

    it('EXIT-7  close & write off, then reversal re-derives the clearing', async () => {
        const c3 = r2(defuels.short.credit * 0.2);
        const { data: m3 } = await memo('WFS-CN-EC2-FINAL', c3, [ecLine(defuels.short.ID, c3, { final_clearing: true })]);
        await post(m3.ID);
        let e = await ec(defuels.short.ID);
        assert.strictEqual(e.credit_status, 'WRITTEN_OFF');
        assert.strictEqual(Number(e.shortfall_written_off), r2(defuels.short.credit - r2(defuels.short.credit * 0.6) - c3));
        assert.strictEqual(Number(e.open_amount), 0);

        await test.post(`${S}/CreditMemos(${m3.ID})/CreditMemoService.reverse`, { reason: 'keyed twice', reversalDate: '2026-09-26' });
        assert.strictEqual((await ec(defuels.short.ID)).credit_status, 'PARTIALLY_CLEARED');
        await test.post(`${S}/CreditMemos(${defuels.short.memo})/CreditMemoService.reverse`, { reason: 'wrong memo', reversalDate: '2026-09-26' });
        e = await ec(defuels.short.ID);
        assert.strictEqual(e.credit_status, 'OPEN');
        assert.strictEqual(Number(e.open_amount), defuels.short.credit);
        const { data: x } = await test.get(`${S}/Exceptions?$filter=memo_ID eq ${defuels.short.memo}`);
        assert.strictEqual(x.value[0].status, 'RESOLVED');
        // The defuel itself is untouched: the credit memo never writes to it.
        const d = await SELECT.one.from('fuelsphere.DEFUEL').columns('status', 'expected_credit_usd').where({ ID: defuels.short.ID });
        assert.strictEqual(d.status, 'POSTING_PENDING');
        assert.strictEqual(Number(d.expected_credit_usd), defuels.short.credit);
    });

    it('EXIT-8  status guards', async () => {
        let err = await fail(test.patch(`${S}/CreditMemos(${SEED_MEMO})`, { reason_text: 'x' }));
        assert.match(codes(err), /CRD411/);
        const { data: d } = await memo('WFS-CN-GUARD', 5, [ecLine(defuels.short.ID, 5)]);
        err = await fail(test.post(`${S}/CreditMemos(${d.ID})/CreditMemoService.reverse`, { reason: 'x', reversalDate: '2026-09-26' }));
        assert.match(codes(err), /CRD411.*DRAFT/);
        err = await fail(test.post(`${S}/CreditMemos(${SEED_MEMO})/CreditMemoService.reverse`, { reason: 'x', reversalDate: '2026-01-01' }));
        assert.match(codes(err), /CRD418/);
    });

    it('EXIT-9  proposeLines on an invoice proposes its lines with what is open', async () => {
        const { data } = await test.get(`${S}/proposeLines(referenceType='INVOICE',referenceId=${INVOICE},memoType='SUBSEQUENT_CREDIT')`);
        assert.strictEqual(data.value.length, 1);
        assert.strictEqual(data.value[0].reference_type, 'INVOICE_LINE');
        assert.strictEqual(Number(data.value[0].open_amount), 1853);
        assert.strictEqual(data.value[0].quantity, null, 'subsequent credit is value only');
    });
});

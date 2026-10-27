/**
 * CREDIT MEMO — FS-SPEC-CM-001 at BTP level.
 *
 * Every figure here is computed from data the seed carries for another
 * reason: the posted invoice INV-WFS-20260324-001 bills 2200 KG (ordered) at
 * 0.85 where 2180 KG was delivered, so 17.00 + 12% tax is a real credit the
 * supplier owes. The two expected credits are seeded for this service.
 *
 *   EXIT-1  the seeded memo balances and simulates clean; post moves it to POSTED, S/4 number stays null
 *   EXIT-2  a second credit on the same invoice line beyond what is left is refused (CRD402), naming the earlier credit
 *   EXIT-3  duplicate is an error (CRD407); same number, other amount, is only a warning (CRD408)
 *   EXIT-4  expected credit: within tolerance CLEARS with variance; short beyond tolerance posts AND lands on the worklist
 *   EXIT-5  "close & write off" writes off the rest, and reversal re-derives the expected credit to OPEN
 *   EXIT-6  status guards: a POSTED memo cannot be edited, an unposted one cannot be reversed
 *   EXIT-7  proposeLines on an invoice proposes its lines with what is still open
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV = 'development'; process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const test = cds.test(PROJECT); const out = s => process.stdout.write('      ' + s + '\n');
const S = '/odata/v4/credit-memo';
const WFS = 'b2c3d4e5-2222-4000-8000-00000000A001';
const SEED_MEMO = 'cd000000-0000-4000-8000-000000000001';
const INV_LINE = '550e8400-e29b-41d4-a716-44665544A211';
const INVOICE = '550e8400-e29b-41d4-a716-44665544A201';
const EC1 = 'ec000000-0000-4000-8000-000000000001';   // 1200.00, tolerance max(2%, 25) = 25.00
const EC2 = 'ec000000-0000-4000-8000-000000000002';   //  480.00, tolerance 25.00

const fail = async p => { try { await p; } catch (e) { return e.response ? e.response.data.error : e; } assert.fail('expected a refusal'); };
const codes = err => [err.message, ...(err.details || []).map(d => d.message)].join(' | ');
const memo = (cmNo, gross, tax, lines, extra = {}) => test.post(`${S}/CreditMemos`, {
    memo_type: 'CREDIT_MEMO', supplier_ID: WFS, supplier_cm_number: cmNo, document_date: '2026-04-20',
    posting_date: '2026-04-20', company_code: '3000', station_code: 'YYZ', currency_code: 'USD',
    stated_gross_amount: gross, tax_amount: tax, reason_code: 'DEFUEL_RETURN', lines, ...extra });
const post = id => test.post(`${S}/CreditMemos(${id})/CreditMemoService.postMemo`, {});
const ec = async id => (await test.get(`${S}/ExpectedCredits(${id})`)).data;

describe('Credit memo — FS-SPEC-CM-001, BTP level', () => {

    it('EXIT-1  seeded memo balances, simulates clean, and posts', async () => {
        const { data: m } = await test.get(`${S}/CreditMemos(${SEED_MEMO})?$expand=lines`);
        assert.strictEqual(Number(m.balance), 0);
        assert.strictEqual(m.balanceCriticality, 3);
        assert.strictEqual(Number(m.lines[0].open_amount), 1870, 'nothing credited yet: the full line is open');
        const { data: sim } = await test.get(`${S}/CreditMemos(${SEED_MEMO})/CreditMemoService.simulate()`);
        assert.strictEqual(sim.canPost, true, JSON.stringify(sim.messages));
        const { data: r } = await post(SEED_MEMO);
        assert.strictEqual(r.status, 'POSTED');
        const { data: after } = await test.get(`${S}/CreditMemos(${SEED_MEMO})?$expand=lines,log`);
        assert.strictEqual(after.status, 'POSTED');
        assert.strictEqual(after.s4_document_number, null, 'no S/4 call exists, so no S/4 number may appear');
        assert.strictEqual(Number(after.lines[0].open_amount), 1853, '1870 less the 17.00 credited');
        assert.ok(after.log.some(l => l.event === 'POSTED'));
        out(`${after.document_number} POSTED; invoice line open 1870 -> ${after.lines[0].open_amount}`);
    });

    it('EXIT-2  over-credit on the same reference is refused, net of the earlier credit', async () => {
        const { data: m } = await memo('WFS-CN-OVER', 1860, 0,
            [{ reference_type: 'INVOICE_LINE', invoice_item_ID: INV_LINE, amount: 1860, value_only: true }]);
        assert.strictEqual(m.lines[0].reference_display, 'INV-WFS-20260324-001/10');
        assert.strictEqual(m.lines[0].po_number, '4500100002', 'PO derived from the reference');
        const err = await fail(post(m.ID));
        assert.match(codes(err), /CRD402.*1877\.00 exceeds 1870\.00.*17\.00 credited earlier/);
        out(codes(err));
    });

    it('EXIT-3  duplicate is an error; reused number with another amount is a warning', async () => {
        const line = [{ reference_type: 'EXPECTED_CREDIT', expected_credit_ID: EC2, amount: 10 }];
        const { data: a } = await memo('WFS-CN-DUP', 10, 0, line);
        const { data: b } = await memo('WFS-CN-DUP', 10, 0, line);
        const { data: c } = await memo('WFS-CN-DUP', 11, 1, line);
        const simB = (await test.get(`${S}/CreditMemos(${b.ID})/CreditMemoService.simulate()`)).data;
        assert.ok(simB.messages.some(x => x.code === 'CRD407' && x.severity === 'ERROR'));
        const simC = (await test.get(`${S}/CreditMemos(${c.ID})/CreditMemoService.simulate()`)).data;
        assert.ok(!simC.messages.some(x => x.code === 'CRD407'));
        assert.ok(simC.messages.some(x => x.code === 'CRD408' && x.severity === 'WARNING'));
        for (const id of [a.ID, b.ID, c.ID]) await test.delete(`${S}/CreditMemos(${id})`);
    });

    it('EXIT-4  expected credit: within tolerance clears; beyond posts and goes to the worklist', async () => {
        const { data: m1 } = await memo('WFS-CN-EC1', 1180, 0,
            [{ reference_type: 'EXPECTED_CREDIT', expected_credit_ID: EC1, amount: 1180, quantity: 1500 }]);
        await post(m1.ID);
        const e1 = await ec(EC1);
        assert.strictEqual(e1.status, 'CLEARED');
        assert.strictEqual(Number(e1.variance_amount), 20, '1200 - 1180 to Defuel Credit Variance');
        assert.strictEqual(Number(e1.open_amount), 0);

        const { data: m2 } = await memo('WFS-CN-EC2', 300, 0,
            [{ reference_type: 'EXPECTED_CREDIT', expected_credit_ID: EC2, amount: 300 }]);
        const { data: r } = await post(m2.ID);
        assert.strictEqual(r.status, 'POSTED', 'never held: posting continues');
        const e2 = await ec(EC2);
        assert.strictEqual(e2.status, 'PARTIALLY_CLEARED');
        assert.strictEqual(Number(e2.open_amount), 180);
        const { data: x } = await test.get(`${S}/Exceptions?$filter=memo_ID eq ${m2.ID}`);
        assert.strictEqual(x.value.length, 1);
        assert.strictEqual(x.value[0].code, 'CRD413');
        out(`EC1 CLEARED variance ${e1.variance_amount}; EC2 PARTIALLY_CLEARED open ${e2.open_amount}, worklist: ${x.value[0].message}`);
        globalThis.__m2 = m2.ID;
    });

    it('EXIT-5  close & write off, then reversal re-derives the expected credit', async () => {
        const { data: m3 } = await memo('WFS-CN-EC2-FINAL', 100, 0,
            [{ reference_type: 'EXPECTED_CREDIT', expected_credit_ID: EC2, amount: 100, final_clearing: true }]);
        await post(m3.ID);
        let e2 = await ec(EC2);
        assert.strictEqual(e2.status, 'WRITTEN_OFF');
        assert.strictEqual(Number(e2.written_off_amount), 80, '480 - 300 - 100');

        await test.post(`${S}/CreditMemos(${m3.ID})/CreditMemoService.reverse`, { reason: 'keyed twice', reversalDate: '2026-04-21' });
        e2 = await ec(EC2);
        assert.strictEqual(e2.status, 'PARTIALLY_CLEARED', 'back to what the remaining posted memo says');
        await test.post(`${S}/CreditMemos(${globalThis.__m2})/CreditMemoService.reverse`, { reason: 'wrong supplier memo', reversalDate: '2026-04-21' });
        e2 = await ec(EC2);
        assert.strictEqual(e2.status, 'OPEN');
        assert.strictEqual(Number(e2.credited_amount), 0);
        const { data: x } = await test.get(`${S}/Exceptions?$filter=memo_ID eq ${globalThis.__m2}`);
        assert.strictEqual(x.value[0].status, 'RESOLVED');
    });

    it('EXIT-6  status guards', async () => {
        let err = await fail(test.patch(`${S}/CreditMemos(${SEED_MEMO})`, { reason_text: 'x' }));
        assert.match(codes(err), /CRD411/);
        const { data: d } = await memo('WFS-CN-GUARD', 5, 0, [{ reference_type: 'EXPECTED_CREDIT', expected_credit_ID: EC1, amount: 5 }]);
        err = await fail(test.post(`${S}/CreditMemos(${d.ID})/CreditMemoService.reverse`, { reason: 'x', reversalDate: '2026-04-21' }));
        assert.match(codes(err), /CRD411.*DRAFT/);
        err = await fail(test.post(`${S}/CreditMemos(${SEED_MEMO})/CreditMemoService.reverse`, { reason: 'x', reversalDate: '2026-01-01' }));
        assert.match(codes(err), /CRD418/);
    });

    it('EXIT-7  proposeLines on an invoice proposes its lines with what is open', async () => {
        const { data } = await test.get(`${S}/proposeLines(referenceType='INVOICE',referenceId=${INVOICE},memoType='SUBSEQUENT_CREDIT')`);
        assert.strictEqual(data.value.length, 1);
        assert.strictEqual(data.value[0].reference_type, 'INVOICE_LINE');
        assert.strictEqual(Number(data.value[0].open_amount), 1853);
        assert.strictEqual(data.value[0].quantity, null, 'subsequent credit is value only');
    });
});

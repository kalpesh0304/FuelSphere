/**
 * THE INVOICE HEADER - what the clerk types, and what the system decides.
 *
 * The invoice object page mixed inputs with fields the system owns, and let
 * the clerk type into both. This pins the division down:
 *
 *   typed      supplier invoice number, invoice date, supplier, the amounts
 *              as printed, currency
 *   decided    internal number, payment terms (from the supplier), due date,
 *              status, approval status, match status, every variance, and the
 *              whole of Stated against derived
 *
 *   EXIT-1  payment terms carry their days, and the due date adds them
 *   EXIT-2  picking a supplier fills its terms and the due date, in the draft
 *   EXIT-3  changing the invoice date afterwards moves the due date
 *   EXIT-4  on create: SUBMITTED, and an internal number keyed on the supplier
 *   EXIT-5  the checks ran by themselves - nobody pressed Validate
 *   EXIT-6  stated against derived compares what was typed with the lines,
 *           live in the draft, before anything is saved
 *   EXIT-7  qty variance is in litres; value variance is lines against tickets
 *   EXIT-8  re-saving a posted invoice does not drag it back to SUBMITTED
 *   EXIT-9  the screen: system fields read-only, discount and price variance
 *           gone, exceptions cannot be created or deleted by hand
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const test = cds.test(PROJECT);
const out = s => process.stdout.write('      ' + s + '\n');

const { paymentTermDays, dueDateFor } = require(`${PROJECT}/srv/lib/invoice-header`);

const INV = '/odata/v4/invoice/Invoices';
const n = v => (v === null || v === undefined ? null : Number(v));

// PETRON01: NT45 terms, and the longest supplier code in the seed - 8 chars,
// which is what pushed the generated number past the old 25-char column.
const SUPPLIER    = 'b2c3d4e5-2222-4000-8000-000000000003';
const SUPPLIER_CODE = 'PETRON01';
const CLEAR_INV   = 'f1c00000-0000-4000-8000-000000000001';   // gate CLEAR, one line

const call = async f => {
    try { const r = await f(); return { status: r.status, data: r.data }; }
    catch (e) { return { status: e.response?.status || e.status, msg: e.response?.data?.error?.message || e.message }; }
};

/** A new invoice draft, the way the Create button starts one. */
async function newDraft() {
    const r = await test.POST(INV, {});
    assert.strictEqual(r.data.IsActiveEntity, false, 'a new invoice starts as a draft');
    return r.data.ID;
}
const D = (id) => `${INV}(ID=${id},IsActiveEntity=false)`;
const A = (id) => `${INV}(ID=${id},IsActiveEntity=true)`;

describe('Invoice header - typed versus decided', () => {
    before(test.data.reset);

    it('EXIT-1 - payment terms carry their days, and the due date adds them', () => {
        assert.strictEqual(paymentTermDays('NT30'), 30);
        assert.strictEqual(paymentTermDays('NT45'), 45);
        // No number, no guess. A due date from an invented 30 days is a
        // wrong date that looks right.
        assert.strictEqual(paymentTermDays('IMMEDIATE'), null);
        assert.strictEqual(paymentTermDays(null), null);
        assert.strictEqual(dueDateFor('2026-09-22', 'NT30'), '2026-10-22');
        assert.strictEqual(dueDateFor('2026-01-31', 'NT30'), '2026-03-02', 'calendar days, across a short month');
        assert.strictEqual(dueDateFor('2026-09-22', 'IMMEDIATE'), null);
        out('NT30 -> 30, NT45 -> 45, no digits -> null; 22 Sep + NT30 = 22 Oct');
    });

    it('EXIT-2 - picking a supplier fills its terms and the due date', async () => {
        const id = await newDraft();
        await test.PATCH(D(id), { invoice_date: '2026-09-22' });
        await test.PATCH(D(id), { supplier_ID: SUPPLIER });

        const r = (await test.GET(D(id))).data;
        assert.strictEqual(r.payment_terms, 'NT45', 'the supplier\'s own terms must be filled in');
        assert.strictEqual(String(r.due_date).slice(0, 10), '2026-11-06',
            `22 Sep + 45 days = 6 Nov; got ${r.due_date}`);
        out(`supplier picked -> terms ${r.payment_terms}, due ${String(r.due_date).slice(0, 10)}`);
    });

    it('EXIT-3 - changing the invoice date afterwards moves the due date', async () => {
        const id = await newDraft();
        await test.PATCH(D(id), { invoice_date: '2026-09-22' });
        await test.PATCH(D(id), { supplier_ID: SUPPLIER });
        // Terms were set by the EARLIER patch; this one carries only the date.
        await test.PATCH(D(id), { invoice_date: '2026-10-01' });

        const r = (await test.GET(D(id))).data;
        assert.strictEqual(String(r.due_date).slice(0, 10), '2026-11-15',
            `1 Oct + 45 days = 15 Nov, reading the terms already stored; got ${r.due_date}`);
        out(`date moved to 1 Oct -> due ${String(r.due_date).slice(0, 10)}, terms read from the stored draft`);
    });

    it('EXIT-4 - on create: SUBMITTED, and an internal number keyed on the supplier', async () => {
        const id = await newDraft();
        await test.PATCH(D(id), {
            invoice_number: 'SUP-INV-7781', invoice_date: '2026-09-22',
            supplier_ID: SUPPLIER, currency_code: 'USD'
        });
        const act = await call(() => test.POST(`${D(id)}/InvoiceService.draftActivate`, {}));
        assert.ok(act.status === 200 || act.status === 201, `create failed: ${act.msg}`);

        const r = (await test.GET(A(id))).data;
        assert.strictEqual(r.status, 'SUBMITTED', 'a created invoice must be SUBMITTED, not DRAFT');
        assert.match(r.internal_number || '', new RegExp(`^INV-${SUPPLIER_CODE}-20260922-\\d{4}$`),
            `internal number must be INV-{supplier}-{date}-{seq}; got ${r.internal_number}`);
        assert.ok(r.internal_number.length > 25,
            'instrument check: this number is longer than the old 25-char column held');
        out(`created -> ${r.status}, ${r.internal_number} (${r.internal_number.length} chars)`);
    });

    it('EXIT-5 - the checks ran by themselves; nobody pressed Validate', async () => {
        const id = await newDraft();
        await test.PATCH(D(id), {
            invoice_number: 'SUP-INV-7782', invoice_date: '2026-09-22',
            supplier_ID: SUPPLIER, currency_code: 'USD'
        });
        await test.POST(`${D(id)}/InvoiceService.draftActivate`, {});

        // The rule-status rows are what the check run writes. Their presence
        // is the proof it ran - there is no other way they get there.
        const rules = await cds.db.run(SELECT.from('fuelsphere.IDR_RULE_STATUS').where({ invoice_ID: id }));
        assert.ok(rules.length > 0, 'no check results on a freshly created invoice - the checks did not run');
        const inv = await cds.db.run(SELECT.one.from('fuelsphere.INVOICES')
            .columns('posting_gate', 'gate_evaluated_at').where({ ID: id }));
        assert.notStrictEqual(inv.posting_gate, 'NOT_CHECKED', 'the gate must have been evaluated');
        assert.ok(inv.gate_evaluated_at, 'the gate must carry when it was evaluated');
        out(`created -> ${rules.length} rule verdicts recorded, gate ${inv.posting_gate}, without a Validate press`);
    });

    it('EXIT-6 - stated against derived compares typed with the lines, live in the draft', async () => {
        const id = await newDraft();
        // What the clerk typed off the supplier's invoice...
        await test.PATCH(D(id), { net_amount: 1000, tax_amount: 50, gross_amount: 1050, currency_code: 'USD' });
        // ...and two lines that add up to something slightly different.
        await test.POST(`${D(id)}/items`, { line_number: 10, quantity: 500, net_amount: 600, tax_amount: 30 });
        await test.POST(`${D(id)}/items`, { line_number: 20, quantity: 300, net_amount: 380, tax_amount: 19 });

        // Still a DRAFT - nothing saved. The figures must already be live.
        const r = (await test.GET(D(id))).data;
        assert.strictEqual(n(r.entered_net_v), 1000, 'entered net is what was typed');
        assert.strictEqual(n(r.derived_net), 980, 'derived net is the lines: 600 + 380');
        assert.strictEqual(n(r.net_difference), 20, 'the finding: typed 1000, lines 980');
        assert.strictEqual(n(r.derived_tax), 49, 'derived tax: 30 + 19');
        assert.strictEqual(n(r.derived_gross), 1029, 'derived gross: 980 + 49');
        assert.strictEqual(n(r.gross_difference), 21, 'typed 1050 against lines 1029');
        assert.strictEqual(r.total_lines, 2);
        out(`draft, unsaved: typed net 1000 vs lines ${r.derived_net} -> difference ${r.net_difference}; `
            + `gross ${r.entered_gross_v} vs ${r.derived_gross} -> ${r.gross_difference}`);
    });

    it('EXIT-7 - qty variance is in litres; value variance is lines against tickets', async () => {
        const r = (await test.GET(A(CLEAR_INV))).data;
        // One line: 2,881.25 L invoiced against a ticket that metered 2,884 L.
        assert.strictEqual(n(r.qty_variance_ltr), Number((2881.25 - 2884).toFixed(2)),
            `invoiced litres less metered litres; got ${r.qty_variance_ltr}`);
        // The seed ticket was never priced, so there is no ticket value to
        // compare against - blank, not zero.
        assert.strictEqual(r.variance_value, null, 'no ticket price -> no value variance, not zero');
        out(`qty variance ${r.qty_variance_ltr} L (2,881.25 invoiced vs 2,884 metered); `
            + `value variance blank - the ticket was never priced`);
    });

    it('EXIT-8 - re-saving a posted invoice does not drag it back to SUBMITTED', async () => {
        const post = await call(() => test.POST(`${A(CLEAR_INV)}/InvoiceService.postToS4HANA`, {}));
        assert.strictEqual(post.status, 200, `posting failed: ${post.msg}`);
        await test.POST(`${A(CLEAR_INV)}/InvoiceService.draftEdit`, {});
        await test.POST(`${D(CLEAR_INV)}/InvoiceService.draftActivate`, {});
        const r = (await test.GET(A(CLEAR_INV))).data;
        assert.strictEqual(r.status, 'POSTED', `a posted invoice was dragged back to ${r.status} by a re-save`);
        out(`posted -> edited -> saved: still ${r.status}`);
    });

    it('EXIT-9 - the screen: system fields read-only, clutter gone', async () => {
        const def = cds.model.definitions['InvoiceService.Invoices'];
        const el = def.elements;
        const ro = (f) => {
            const fc = el[f] && el[f]['@Common.FieldControl'];
            return fc && (fc['#'] === 'ReadOnly' || fc === 'ReadOnly' || fc['='] === 'ReadOnly');
        };
        for (const f of ['internal_number', 'due_date', 'status', 'approval_status', 'match_status']) {
            assert.ok(ro(f), `${f} is decided by the system and must be read-only`);
        }

        const groupValues = (g) => {
            const data = def[`@UI.FieldGroup#${g}.Data`] || (def[`@UI.FieldGroup#${g}`] || {}).Data || [];
            return data.map(d => d.Value && (d.Value['='] || d.Value)).filter(Boolean);
        };
        const amount = groupValues('AmountDetails');
        assert.ok(!amount.includes('discount_percent') && !amount.includes('discount_date'),
            'the discount fields must be gone from Amount Details');
        assert.ok(['net_amount', 'tax_amount', 'gross_amount', 'currency_code'].every(f => amount.includes(f)),
            'Amount Details keeps the typed amounts and the currency');

        const twm = groupValues('ThreeWayMatching');
        assert.ok(!twm.includes('price_variance'), 'price (rate) variance must be removed');
        assert.ok(twm.includes('variance_value') && twm.includes('qty_variance_ltr'),
            'value variance and qty variance (LTR) must be shown');

        // Stated against derived: every field read-only. The entered figures
        // are virtual copies precisely so they can be read-only here while
        // staying inputs in Amount Details.
        const svd = groupValues('StatedVsDerived');
        const editable = svd.filter(f => el[f] && !el[f].virtual && !ro(f));
        assert.deepStrictEqual(editable, [], `Stated against derived has editable fields: ${editable.join(', ')}`);

        const supplier = groupValues('SupplierInfo');
        assert.ok(supplier.includes('supplier_ID'), 'Supplier Information must carry the supplier PICKER');
        assert.ok(!supplier.includes('invoice_number'), 'the invoice number must not be repeated there');

        const vl = el.currency_code['@Common.ValueList.CollectionPath']
            || (el.currency_code['@Common.ValueList'] || {}).CollectionPath;
        assert.strictEqual(vl, 'Currencies', 'currency needs its value help');

        // CHECKS THAT FIRED AND RULES THAT RAN: read-only WHERE THEY ARE
        // EMBEDDED, and only there. Both entities have their own apps, where a
        // person does work an exception - an entity-wide lock reached those
        // too, which is why this asserts the NAVIGATION restriction.
        const navRules = def['@Capabilities.NavigationRestrictions.RestrictedProperties']
            || (def['@Capabilities.NavigationRestrictions'] || {}).RestrictedProperties || [];
        for (const nav of ['exceptions', 'rule_statuses']) {
            const r = navRules.find(x => {
                const p = x.NavigationProperty;
                return (p && (p['='] || p)) === nav;
            });
            assert.ok(r, `${nav} is editable inside the invoice page`);
            assert.strictEqual(r.InsertRestrictions?.Insertable, false, `${nav} must not offer Create here`);
            assert.strictEqual(r.UpdateRestrictions?.Updatable, false, `${nav} must not be editable here`);
            assert.strictEqual(r.DeleteRestrictions?.Deletable, false, `${nav} must not offer Delete here`);
        }
        // ...and NOT locked entity-wide, or their own apps lose editing.
        const ex = cds.model.definitions['InvoiceService.InvoiceExceptions'];
        assert.notStrictEqual(ex['@Capabilities.UpdateRestrictions.Updatable'], false,
            'the exception entity is locked everywhere - its own app cannot work an exception');
        out('system fields read-only; discount and price variance gone; stated-vs-derived '
            + 'all read-only; supplier picker in place; checks and rules read-only on THIS page only');
    });
});

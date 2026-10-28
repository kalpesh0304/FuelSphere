/**
 * FuelSphere — Supplier Credit Memo service (FS-SPEC-CM-001).
 *
 * BTP level only. post() moves a memo to POSTED and clears expected credits
 * inside FuelSphere; it calls nothing outside. The S/4 hand-off belongs in
 * postCore() where the comment says so, and POSTING_ATTEMPTED / reprocess()
 * exist for it.
 *
 * Every "how much is still creditable" figure is derived from POSTED lines at
 * the moment it is asked. Nothing is decremented, so reversal is a status
 * change followed by the same refresh — there is no compensating write to get
 * wrong.
 *
 * Codes (CRD4xx business rule, CRD5xx technical):
 *   CRD401 reference or mandatory field missing     CRD411 status does not allow this
 *   CRD402 credit exceeds what is still creditable  CRD412 four-eyes: creator cannot post
 *   CRD403 quantity exceeds referenced quantity     CRD413 expected credit short beyond tolerance (worklist)
 *   CRD404 supplier mismatch                        CRD414 reference carries no amount
 *   CRD405 currency mismatch                        CRD416 memo has no lines
 *   CRD406 reference in invalid status              CRD418 reversal date before posting date
 *   CRD407 duplicate credit memo                    CRD419 line amount must be positive
 *   CRD408 CM number reused, date/amount differ (W) CRD420 expected credit written off (worklist)
 *   CRD409 ticket not yet invoiced (W)              CRD501 tolerance / parameter not configured
 *   CRD410 balance is not zero
 */
const cds = require('@sap/cds');
const { SELECT, UPDATE, INSERT } = cds.ql;
const { allocate, reportAllocationError } = require('./lib/number-range');
const { resolveToleranceRule, resolveParameter, effectiveTolerance } = require('./lib/parameter-store');

const T = {
    MEMO: 'fuelsphere.CREDIT_MEMOS', LINE: 'fuelsphere.CREDIT_MEMO_LINES',
    LOG: 'fuelsphere.CREDIT_MEMO_LOG', EXC: 'fuelsphere.CREDIT_MEMO_EXCEPTIONS',
    DEFUEL: 'fuelsphere.DEFUEL', CLR: 'fuelsphere.DEFUEL_CREDIT_CLEARING', TICKET: 'fuelsphere.FUEL_TICKETS',
    ORDER: 'fuelsphere.FUEL_ORDERS', ITEM: 'fuelsphere.INVOICE_ITEMS',
    INVOICE: 'fuelsphere.INVOICES', SUPPLIER: 'fuelsphere.MASTER_SUPPLIERS'
};

const EDITABLE = ['DRAFT', 'PARKED'];
const COUNTED = ['POSTED', 'PAID', 'POSTING_ATTEMPTED'];   // statuses whose lines consume a reference
const INVOICE_OK = ['POSTED', 'PAID'];
const DEFUEL_OK = ['POSTING_PENDING', 'POSTED'];     // credit agreed by postToSupplier
const CLEARING_OPEN = ['OPEN', 'PARTIALLY_CLEARED'];
const DEFUEL_TOLERANCE = 'TOL-CM-DEFUEL';
const FOUR_EYES = 'CM_POST_FOUR_EYES';

const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
const r2 = v => Math.round(v * 100) / 100;
const msg = (severity, code, message, line = null) => ({ severity, code, message: `${code}: ${message}`, line });
const refIdOf = l => l.reference_type === 'EXPECTED_CREDIT' ? l.defuel_ID
    : l.reference_type === 'FUEL_TICKET' ? l.ticket_ID
    : l.reference_type === 'INVOICE_LINE' ? l.invoice_item_ID : null;
const refColumn = { EXPECTED_CREDIT: 'defuel_ID', FUEL_TICKET: 'ticket_ID', INVOICE_LINE: 'invoice_item_ID' };

// ===========================================================================
// REFERENCES — one shape whatever the reference is
// ===========================================================================

/**
 * What a reference is worth and who it belongs to. `amount` null means the
 * reference carries no value, which is CRD414 — never treated as zero.
 */
async function loadReference(type, id) {
    if (!id) return null;
    if (type === 'EXPECTED_CREDIT') {
        // The expected credit IS the defuel to a supplier (db/defuel.cds).
        const d = await SELECT.one.from(T.DEFUEL).where({ ID: id });
        if (!d) return null;
        const clr = await SELECT.one.from(T.CLR).columns('status').where({ defuel_ID: id });
        const clearing = clr ? clr.status : 'OPEN';
        let statusOk = true, status = d.status;
        if (d.defuel_type !== 'TO_SUPPLIER') { statusOk = false; status = `${d.defuel_type}, not a defuel to a supplier`; }
        else if (!DEFUEL_OK.includes(d.status)) {
            statusOk = false;
            status = d.status === 'PARKED' ? 'PARKED - no expected credit has been agreed (postToSupplier)' : d.status;
        } else if (!CLEARING_OPEN.includes(clearing)) { statusOk = false; status = `already ${clearing}`; }
        return { type, id, display: d.ticket_number ? `${d.defuel_id} / ticket ${d.ticket_number}` : d.defuel_id,
            supplier_ID: d.supplier_ID, vendorLabel: 'defuel', currency_code: 'USD', status, statusOk,
            amount: num(d.expected_credit_usd), quantity: num(d.quantity_l), uom_code: 'LTR',
            flight_ID: d.flight_ID, aircraft_reg: d.tail_number, station_code: d.station_code };
    }
    if (type === 'FUEL_TICKET') {
        const t = await SELECT.one.from(T.TICKET).where({ ID: id });
        if (!t) return null;
        const o = t.order_ID ? await SELECT.one.from(T.ORDER)
            .columns('supplier_ID', 'station_code', 'currency_code', 's4_po_number', 's4_po_item')
            .where({ ID: t.order_ID }) : null;
        return { type, id, display: t.ticket_number, supplier_ID: o ? o.supplier_ID : null, vendorLabel: 'uplift ticket',
            currency_code: t.currency_code || (o && o.currency_code) || null, status: t.status,
            statusOk: true, amount: num(t.total_amount), quantity: num(t.quantity), uom_code: t.uom_code,
            flight_ID: t.flight_ID, aircraft_reg: t.aircraft_reg, station_code: o ? o.station_code : null,
            po_number: o ? o.s4_po_number : null, po_item: o ? o.s4_po_item : null, noOrder: !o };
    }
    if (type === 'INVOICE_LINE') {
        const i = await SELECT.one.from(T.ITEM).where({ ID: id });
        if (!i) return null;
        const inv = await SELECT.one.from(T.INVOICE)
            .columns('invoice_number', 'supplier_ID', 'currency_code', 'status').where({ ID: i.invoice_ID });
        return { type, id, display: `${inv.invoice_number}/${i.line_number}`, supplier_ID: inv.supplier_ID, vendorLabel: 'invoice',
            currency_code: inv.currency_code, status: inv.status, statusOk: INVOICE_OK.includes(inv.status),
            amount: num(i.net_amount), quantity: num(i.quantity), uom_code: i.uom_code, tax_code: i.tax_code,
            flight_ID: i.flight_ID, po_number: i.po_number, po_item: i.po_item, cost_center: i.cost_center };
    }
    return null;
}

const countedMemos = () => SELECT('ID').from(T.MEMO).where({ status: { in: COUNTED } });

/** Still creditable on each line's reference, posted memos only. */
async function applyOpenAmounts(lines) {
    for (const l of [].concat(lines || [])) {
        if (!l || !l.reference_type) continue;
        const id = refIdOf(l);
        const ref = id && await loadReference(l.reference_type, id);
        if (!ref || ref.amount === null) { l.open_amount = null; continue; }
        const done = await creditedSoFar(l.reference_type, id, null);
        l.open_amount = r2(ref.amount - done.amount);
    }
}

/** Amount and quantity already credited on a reference by counted memos. */
async function creditedSoFar(type, id, excludeMemo) {
    const col = refColumn[type];
    const rows = await SELECT.from(T.LINE).columns('amount', 'quantity', 'value_only', 'memo_ID')
        .where({ [col]: id, memo_ID: { in: countedMemos() } });
    const counted = rows.filter(r => r.memo_ID !== excludeMemo);
    return {
        amount: r2(counted.reduce((s, r) => s + Number(r.amount || 0), 0)),
        quantity: counted.filter(r => !r.value_only).reduce((s, r) => s + Number(r.quantity || 0), 0)
    };
}

async function vendorName(id) {
    const v = id && await SELECT.one.from(T.SUPPLIER).columns('supplier_code', 'supplier_name').where({ ID: id });
    return v ? `${v.supplier_code} ${v.supplier_name}` : 'no vendor';
}

async function defuelTolerance(memo, expected) {
    const res = await resolveToleranceRule({ ruleCode: DEFUEL_TOLERANCE },
        { company_code: memo && memo.company_code }, memo && memo.posting_date);
    if (!res.resolved) return { tol: 0, evidence: null, warning: res.reason };
    return { tol: effectiveTolerance(res.rule, expected) || 0, evidence: res.evidence };
}

/** Copy what the reference says onto the line. Read-only to the UI. */
function deriveLine(line, ref, memo) {
    line.reference_display = ref.display;
    line.po_number = ref.po_number || null;
    line.po_item = ref.po_item || null;
    line.flight_ID = ref.flight_ID || null;
    line.aircraft_reg = ref.aircraft_reg || null;
    line.station_code = ref.station_code || (memo && memo.station_code) || null;
    line.cost_center = ref.cost_center || null;
    if (!line.uom_code) line.uom_code = ref.uom_code || null;
    if (!line.tax_code) line.tax_code = ref.tax_code || null;
    if (memo && memo.memo_type === 'SUBSEQUENT_CREDIT') { line.value_only = true; line.quantity = null; }
}

// ===========================================================================
// THE CHECK — one function behind simulate, park, post and massPost
// ===========================================================================

async function check(memoId) {
    const memo = await SELECT.one.from(T.MEMO).where({ ID: memoId });
    const lines = await SELECT.from(T.LINE).where({ memo_ID: memoId }).orderBy('line_number');
    const messages = [];
    const add = (...a) => messages.push(msg(...a));

    // ---- header
    for (const f of ['supplier_ID', 'supplier_cm_number', 'document_date', 'posting_date',
                     'currency_code', 'stated_gross_amount', 'reason_code'])
        if (memo[f] === null || memo[f] === undefined || memo[f] === '') add('ERROR', 'CRD401', `${f} is required`);

    if (memo.supplier_cm_number && memo.supplier_ID) {
        const same = await SELECT.from(T.MEMO)
            .columns('ID', 'document_number', 'document_date', 'stated_gross_amount')
            .where({ supplier_ID: memo.supplier_ID, supplier_cm_number: memo.supplier_cm_number,
                     ID: { '!=': memo.ID }, status: { '!=': 'REVERSED' } });
        for (const o of same) {
            const dup = String(o.document_date) === String(memo.document_date)
                && num(o.stated_gross_amount) === num(memo.stated_gross_amount);
            if (dup) add('ERROR', 'CRD407', `duplicate of ${o.document_number}: same supplier, credit memo number, date and amount`);
            else add('WARNING', 'CRD408', `credit memo number ${memo.supplier_cm_number} already used on ${o.document_number} with a different date or amount`);
        }
    }

    if (memo.original_invoice_ID) {
        const inv = await SELECT.one.from(T.INVOICE).columns('invoice_number', 'supplier_ID', 'status')
            .where({ ID: memo.original_invoice_ID });
        if (!inv) add('ERROR', 'CRD401', 'original invoice not found');
        else {
            if (inv.supplier_ID !== memo.supplier_ID) add('ERROR', 'CRD404', `original invoice ${inv.invoice_number} belongs to another supplier`);
            if (!INVOICE_OK.includes(inv.status)) add('ERROR', 'CRD406', `original invoice ${inv.invoice_number} is ${inv.status}, not posted`);
        }
    }

    if (!lines.length) add('ERROR', 'CRD416', 'the credit memo has no lines');

    // ---- lines. Lines of THIS memo on the same reference add up against it.
    const thisMemo = {};
    for (const l of lines) {
        const n = l.line_number;
        const id = refIdOf(l);
        const ref = await loadReference(l.reference_type, id);
        if (!ref) { add('ERROR', 'CRD401', `${l.reference_type} reference is missing or not found`, n); continue; }
        const amount = num(l.amount);
        if (!(amount > 0)) add('ERROR', 'CRD419', 'line amount must be greater than zero', n);

        if (!ref.supplier_ID) add('ERROR', 'CRD404', l.reference_type === 'FUEL_TICKET'
            ? `uplift ticket ${ref.display} has no order, so it has no vendor to compare`
            : `${ref.vendorLabel} ${ref.display} records no vendor`, n);
        else if (ref.supplier_ID !== memo.supplier_ID)
            add('ERROR', 'CRD404', `vendor on ${ref.vendorLabel} ${ref.display} is ${await vendorName(ref.supplier_ID)}; `
                + `the credit memo is from ${await vendorName(memo.supplier_ID)}`, n);
        if (ref.currency_code && memo.currency_code && ref.currency_code !== memo.currency_code)
            add('ERROR', 'CRD405', `${ref.display} is in ${ref.currency_code}, the memo in ${memo.currency_code}`, n);
        if (!ref.statusOk) add('ERROR', 'CRD406', `${ref.display} is ${ref.status}`, n);

        const key = `${l.reference_type}:${id}`;
        const prior = thisMemo[key] || { amount: 0, quantity: 0 };
        const earlier = await creditedSoFar(l.reference_type, id, memo.ID);
        const cumAmount = r2(earlier.amount + prior.amount + (amount || 0));

        if (ref.amount === null) {
            add('ERROR', 'CRD414', `${ref.display} carries no amount, so what is creditable on it cannot be determined`, n);
        } else {
            let allowed = ref.amount;
            if (l.reference_type === 'EXPECTED_CREDIT') allowed += (await defuelTolerance(memo, ref.amount)).tol;
            if (cumAmount > r2(allowed))
                add('ERROR', 'CRD402', `cumulative credit ${cumAmount.toFixed(2)} exceeds ${ref.amount.toFixed(2)} referenced`
                    + ` (${earlier.amount.toFixed(2)} credited earlier)`, n);
        }

        const qty = num(l.quantity);
        if (!l.value_only && qty !== null && ref.quantity !== null) {
            const cumQty = earlier.quantity + prior.quantity + qty;
            if (cumQty > ref.quantity)
                add('ERROR', 'CRD403', `cumulative quantity ${cumQty} exceeds ${ref.quantity} ${ref.uom_code || ''} on ${ref.display}`, n);
        }

        if (l.reference_type === 'FUEL_TICKET') {
            const billed = await SELECT.one.from(T.ITEM).columns('ID').where({ ticket_ID: id });
            if (!billed) add('WARNING', 'CRD409', `ticket ${ref.display} has not been invoiced yet`, n);
        }

        thisMemo[key] = { amount: prior.amount + (amount || 0),
                          quantity: prior.quantity + (!l.value_only && qty ? qty : 0) };
    }

    const linesAmount = r2(lines.reduce((s, l) => s + Number(l.amount || 0), 0));
    const balance = memo.stated_gross_amount === null ? null
        : r2(Number(memo.stated_gross_amount) - linesAmount - Number(memo.tax_amount || 0));
    if (balance !== 0) add('ERROR', 'CRD410', `balance is ${balance === null ? 'undetermined' : balance.toFixed(2)}; post requires zero`);

    return { memo, lines, messages, balance,
             canPost: !messages.some(m => m.severity === 'ERROR') && EDITABLE.concat('POSTING_ATTEMPTED').includes(memo.status) };
}

// ===========================================================================
// EXPECTED CREDIT CLEARING — derived, so reversal needs no undo
// ===========================================================================

async function refreshExpectedCredit(defuelId, memo) {
    const d = await SELECT.one.from(T.DEFUEL).columns('defuel_id', 'expected_credit_usd').where({ ID: defuelId });
    const rows = await SELECT.from(T.LINE).columns('amount', 'final_clearing')
        .where({ defuel_ID: defuelId, memo_ID: { in: countedMemos() } });
    const expected = Number(d.expected_credit_usd);
    const credited = r2(rows.reduce((s, r) => s + Number(r.amount || 0), 0));
    const open = r2(expected - credited);
    const { tol, evidence } = await defuelTolerance(memo, expected);

    let upd;
    if (!rows.length) upd = { status: 'OPEN', credited_amount: 0, variance_amount: 0, shortfall_written_off: 0 };
    else if (Math.abs(open) <= tol) upd = { status: 'CLEARED', credited_amount: credited, variance_amount: open, shortfall_written_off: 0 };
    else if (rows.some(r => r.final_clearing)) upd = { status: 'WRITTEN_OFF', credited_amount: credited, variance_amount: 0, shortfall_written_off: open };
    else upd = { status: 'PARTIALLY_CLEARED', credited_amount: credited, variance_amount: 0, shortfall_written_off: 0 };
    upd.refreshed_at = new Date().toISOString();
    if (await SELECT.one.from(T.CLR).columns('defuel_ID').where({ defuel_ID: defuelId }))
        await UPDATE(T.CLR).set(upd).where({ defuel_ID: defuelId });
    else await INSERT.into(T.CLR).entries({ defuel_ID: defuelId, ...upd });
    return { ...upd, open, tol, evidence, credit_number: d.defuel_id };
}

async function refreshTotals(memoId) {
    const memo = await SELECT.one.from(T.MEMO).columns('stated_gross_amount', 'tax_amount').where({ ID: memoId });
    if (!memo) return;
    const rows = await SELECT.from(T.LINE).columns('amount').where({ memo_ID: memoId });
    const lines = r2(rows.reduce((s, r) => s + Number(r.amount || 0), 0));
    const balance = memo.stated_gross_amount === null ? null
        : r2(Number(memo.stated_gross_amount) - lines - Number(memo.tax_amount || 0));
    await UPDATE(T.MEMO).set({ lines_amount: lines, balance }).where({ ID: memoId });
}

async function log(memoId, event, severity, code, message) {
    await INSERT.into(T.LOG).entries({ memo_ID: memoId, event, severity, code, message });
}

// ===========================================================================

module.exports = class CreditMemoService extends cds.ApplicationService {
    async init() {
        const { CreditMemos, CreditMemoLines, Exceptions } = this.entities;

        const guardEditable = async (req, memoId) => {
            const m = await SELECT.one.from(T.MEMO).columns('status').where({ ID: memoId });
            if (!m) return req.reject(404, `CRD401: credit memo ${memoId} not found`);
            if (!EDITABLE.includes(m.status))
                return req.reject(409, `CRD411: a ${m.status} credit memo cannot be changed`);
        };

        const deriveAll = async (req, memo, lines) => {
            let next = 10;
            const existing = memo.ID ? await SELECT.one.from(T.LINE)
                .columns('max(line_number) as n').where({ memo_ID: memo.ID }) : null;
            if (existing && existing.n) next = existing.n + 10;
            for (const l of lines) {
                if (!l.reference_type) { req.error(400, 'CRD401: reference_type is required'); continue; }
                const ref = await loadReference(l.reference_type, refIdOf(l));
                if (!ref) { req.error(400, `CRD401: ${l.reference_type} reference is missing or not found`); continue; }
                deriveLine(l, ref, memo);
                if (!l.line_number) { l.line_number = next; next += 10; }
            }
        };

        // ---- header create: number it, force DRAFT, derive nested lines
        this.before('CREATE', CreditMemos, async (req) => {
            const d = req.data;
            d.status = 'DRAFT';
            const sup = d.supplier_ID && await SELECT.one.from(T.SUPPLIER).columns('supplier_code').where({ ID: d.supplier_ID });
            if (!sup) return req.reject(400, 'CRD401: supplier is required and must exist');
            try { d.document_number = await allocate('CM', sup.supplier_code, d.document_date, 'Supplier'); }
            catch (e) { if (!reportAllocationError(req, e)) throw e; return; }
            if (Array.isArray(d.lines)) await deriveAll(req, { ...d, ID: null }, d.lines);
        });

        this.before('UPDATE', CreditMemos, req => guardEditable(req, req.data.ID));
        this.before('DELETE', CreditMemos, req => guardEditable(req, req.data.ID));

        // ---- lines
        this.before('CREATE', CreditMemoLines, async (req) => {
            if (!req.data.memo_ID) return req.reject(400, 'CRD401: memo_ID is required');
            await guardEditable(req, req.data.memo_ID);
            const memo = await SELECT.one.from(T.MEMO).where({ ID: req.data.memo_ID });
            await deriveAll(req, memo, [req.data]);
        });
        this.before('UPDATE', CreditMemoLines, async (req) => {
            const cur = await SELECT.one.from(T.LINE).where({ ID: req.data.ID });
            if (!cur) return req.reject(404, 'CRD401: line not found');
            await guardEditable(req, cur.memo_ID);
            const merged = { ...cur, ...req.data };
            const memo = await SELECT.one.from(T.MEMO).where({ ID: cur.memo_ID });
            const ref = await loadReference(merged.reference_type, refIdOf(merged));
            if (!ref) return req.reject(400, `CRD401: ${merged.reference_type} reference is missing or not found`);
            deriveLine(merged, ref, memo);
            for (const f of ['reference_display', 'po_number', 'po_item', 'flight_ID', 'aircraft_reg',
                             'station_code', 'cost_center', 'uom_code', 'tax_code', 'value_only', 'quantity'])
                req.data[f] = merged[f];
        });
        this.before('DELETE', CreditMemoLines, async (req) => {
            const cur = await SELECT.one.from(T.LINE).columns('memo_ID').where({ ID: req.data.ID });
            if (!cur) return req.reject(404, 'CRD401: line not found');
            await guardEditable(req, cur.memo_ID);
            req._cmMemo = cur.memo_ID;
        });

        // ---- totals after every write
        this.after(['CREATE', 'UPDATE'], CreditMemos, async (res, req) => { await refreshTotals(res?.ID || req.data.ID); });
        this.after(['CREATE', 'UPDATE'], CreditMemoLines, async (res, req) => {
            const id = res?.memo_ID || (await SELECT.one.from(T.LINE).columns('memo_ID').where({ ID: req.data.ID }))?.memo_ID;
            if (id) await refreshTotals(id);
        });
        this.after('DELETE', CreditMemoLines, async (_, req) => { if (req._cmMemo) await refreshTotals(req._cmMemo); });

        // ---- open amount on a line: still creditable, posted memos only
        this.after('READ', CreditMemoLines, applyOpenAmounts);
        this.after('READ', CreditMemos, async (data) => {
            for (const m of [].concat(data || [])) if (m && Array.isArray(m.lines)) await applyOpenAmounts(m.lines);
        });

        // ---- actions
        const result = (c, status) => ({ status: status || c.memo.status, balance: c.balance,
            canPost: c.canPost, messages: c.messages });

        this.on('simulate', CreditMemos, async (req) => result(await check(req.params[0].ID ?? req.params[0])));

        this.on('park', CreditMemos, async (req) => {
            const id = req.params[0].ID ?? req.params[0];
            await guardEditable(req, id);
            if (req.errors) return;
            const c = await check(id);
            await UPDATE(T.MEMO).set({ status: 'PARKED' }).where({ ID: id });
            await log(id, 'PARKED', 'INFO', null, `parked with ${c.messages.length} message(s)`);
            for (const m of c.messages) await log(id, 'MESSAGE', m.severity, m.code, m.message);
            return result(c, 'PARKED');
        });

        /**
         * The posting core. Returns messages rather than raising, so massPost
         * can carry on past a failure. Nothing is written unless it succeeds.
         */
        const postCore = async (id, user, allowFrom) => {
            const c = await check(id);
            if (!c.memo) return { ok: false, c, messages: [msg('ERROR', 'CRD401', 'not found')] };
            if (!allowFrom.includes(c.memo.status))
                return { ok: false, c, messages: [msg('ERROR', 'CRD411', `a ${c.memo.status} credit memo cannot be posted`)] };

            const four = await resolveParameter(FOUR_EYES, { company_code: c.memo.company_code }, c.memo.posting_date);
            if (!four.resolved) c.messages.push(msg('WARNING', 'CRD501', `${FOUR_EYES} not configured; four-eyes not applied`));
            else if (four.value === true && c.memo.created_by && c.memo.created_by === user)
                c.messages.push(msg('ERROR', 'CRD412', `${user} created this credit memo and cannot post it`));

            const errors = c.messages.filter(m => m.severity === 'ERROR');
            if (errors.length) return { ok: false, c, messages: errors };

            // S/4 HAND-OFF GOES HERE. Until it exists nothing is sent, so
            // s4_document_number stays null rather than being invented.
            await UPDATE(T.MEMO).set({ status: 'POSTED', posted_at: new Date().toISOString(), posted_by: user })
                .where({ ID: id });
            await log(id, 'POSTED', 'INFO', null, 'posted in FuelSphere; S/4 posting not wired (BTP level)');
            for (const m of c.messages) await log(id, 'MESSAGE', m.severity, m.code, m.message);

            // Clear expected credits. Never held: what falls short goes to the worklist.
            const ecIds = [...new Set(c.lines.filter(l => l.reference_type === 'EXPECTED_CREDIT').map(l => l.defuel_ID))];
            for (const ecId of ecIds) {
                const r = await refreshExpectedCredit(ecId, c.memo);
                const line = c.lines.find(l => l.defuel_ID === ecId);
                if (r.status === 'PARTIALLY_CLEARED' || r.status === 'WRITTEN_OFF') {
                    const code = r.status === 'WRITTEN_OFF' ? 'CRD420' : 'CRD413';
                    const text = r.status === 'WRITTEN_OFF'
                        ? `expected credit ${r.credit_number} closed and ${r.shortfall_written_off.toFixed(2)} written off (Write-off Defueling)`
                        : `expected credit ${r.credit_number} short by ${r.open.toFixed(2)}, beyond tolerance ${r.tol.toFixed(2)}`;
                    await INSERT.into(T.EXC).entries({ memo_ID: id, line_ID: line && line.ID, defuel_ID: ecId,
                        code, message: `${code}: ${text}`, amount: r.status === 'WRITTEN_OFF' ? r.shortfall_written_off : r.open });
                    c.messages.push(msg('WARNING', code, text));
                } else if (r.status === 'CLEARED' && r.variance_amount !== 0) {
                    c.messages.push(msg('INFO', 'CRD413', `expected credit ${r.credit_number} cleared with variance ${r.variance_amount.toFixed(2)} to Defuel Credit Variance`));
                }
            }
            return { ok: true, c, messages: c.messages };
        };

        const respond = (req, out, status) => {
            if (!out.ok) { for (const m of out.messages) req.error(m.code === 'CRD411' ? 409 : 400, m.message); return; }
            return { status, balance: out.c.balance, canPost: false, messages: out.messages };
        };

        this.on('postMemo', CreditMemos, async (req) => {
            const id = req.params[0].ID ?? req.params[0];
            return respond(req, await postCore(id, req.user.id, EDITABLE), 'POSTED');
        });

        this.on('reprocess', CreditMemos, async (req) => {
            const id = req.params[0].ID ?? req.params[0];
            return respond(req, await postCore(id, req.user.id, ['POSTING_ATTEMPTED']), 'POSTED');
        });

        this.on('massPost', async (req) => {
            const out = [];
            for (const id of req.data.memos || []) {
                const r = await postCore(id, req.user.id, EDITABLE);
                out.push({ ID: id, ok: r.ok, status: r.ok ? 'POSTED' : (r.c.memo ? r.c.memo.status : null),
                    message: r.messages.filter(m => m.severity === 'ERROR').map(m => m.message).join(' | ') || 'posted' });
            }
            return out;
        });

        this.on('reverse', CreditMemos, async (req) => {
            const id = req.params[0].ID ?? req.params[0];
            const { reason, reversalDate } = req.data;
            const memo = await SELECT.one.from(T.MEMO).where({ ID: id });
            if (!memo) return req.reject(404, 'CRD401: credit memo not found');
            if (memo.status === 'PAID') return req.reject(409, 'CRD411: a PAID credit memo cannot be reversed here; reverse the clearing in S/4 first');
            if (memo.status !== 'POSTED') return req.reject(409, `CRD411: only a POSTED credit memo can be reversed; this one is ${memo.status}`);
            if (!reason || !reversalDate) return req.reject(400, 'CRD401: reason and reversal date are required');
            if (String(reversalDate) < String(memo.posting_date))
                return req.reject(400, `CRD418: reversal date ${reversalDate} is before posting date ${memo.posting_date}`);

            await UPDATE(T.MEMO).set({ status: 'REVERSED', reversal_reason: reason, reversal_date: reversalDate,
                reversed_at: new Date().toISOString(), reversed_by: req.user.id }).where({ ID: id });

            // Undo every FuelSphere update: expected credits re-derive without
            // this memo's lines, and its open exceptions close.
            const ecs = await SELECT.from(T.LINE).columns('defuel_ID')
                .where({ memo_ID: id, reference_type: 'EXPECTED_CREDIT' });
            for (const ecId of new Set(ecs.map(r => r.defuel_ID))) await refreshExpectedCredit(ecId, memo);
            await UPDATE(T.EXC).set({ status: 'RESOLVED', resolution_note: `credit memo reversed: ${reason}` })
                .where({ memo_ID: id, status: 'OPEN' });
            await log(id, 'REVERSED', 'INFO', null, `reversed on ${reversalDate}: ${reason}`);
            return { status: 'REVERSED', balance: num(memo.balance), canPost: false, messages: [] };
        });

        this.on('resolve', Exceptions, async (req) => {
            const id = req.params[0].ID ?? req.params[0];
            await UPDATE(T.EXC).set({ status: 'RESOLVED', resolution_note: req.data.note }).where({ ID: id });
            return SELECT.one.from(Exceptions).where({ ID: id });
        });

        // ---- proposals for the UI to tick
        this.on('proposeLines', async (req) => {
            const { referenceType, referenceId, memoType } = req.data;
            let refs = [];
            if (referenceType === 'INVOICE') {
                const items = await SELECT.from(T.ITEM).columns('ID').where({ invoice_ID: referenceId }).orderBy('line_number');
                refs = items.map(i => ['INVOICE_LINE', i.ID]);
            } else refs = [[referenceType, referenceId]];

            const out = [];
            for (const [type, id] of refs) {
                const ref = await loadReference(type, id);
                if (!ref) continue;
                const done = await creditedSoFar(type, id, null);
                const open = ref.amount === null ? null : r2(ref.amount - done.amount);
                const flight = ref.flight_ID && await SELECT.one.from('fuelsphere.FLIGHT_SCHEDULE')
                    .columns('flight_number').where({ ID: ref.flight_ID });
                const valueOnly = memoType === 'SUBSEQUENT_CREDIT';
                out.push({ reference_type: type, reference_id: id, reference_display: ref.display,
                    quantity: valueOnly || ref.quantity === null ? null : ref.quantity - done.quantity,
                    uom_code: ref.uom_code || null, amount: open, open_amount: open, tax_code: ref.tax_code || null,
                    po_number: ref.po_number || null, flight_number: flight ? flight.flight_number : null,
                    aircraft_reg: ref.aircraft_reg || null });
            }
            return out;
        });

        return super.init();
    }
};

/**
 * FuelSphere - Invoice pre-posting validation (WP-21A)
 *
 * FuelSphere does NOT perform the three-way match. SAP does, at MIRO, and its
 * verdict is the definitive one. What this does is run FuelSphere's own checks
 * BEFORE the invoice is handed over, because MIRO is the wrong place to
 * discover that a ticket number resolves to nothing — the ticket, the delivery
 * and the price components do not live there.
 *
 * THE POINT IS TO MAKE THE MIRO CALL SUCCEED FIRST TIME.
 *
 * Two stores, each shaped for its job:
 *
 *   TOLERANCE_RULES          how big a numeric variance may be, on a ladder
 *   INVOICE_CHECK_REGISTRY   which checks run, how hard they bite, and
 *                            whether a human may waive one
 *
 * The check LOGIC is here in code. What is configured is whether a check runs,
 * its severity, and its bypassability — which is what makes changing a
 * severity a configuration change rather than a deployment.
 */

const cds = require('@sap/cds');
const { SELECT } = cds.ql;

const r2 = (v) => Number(Number(v).toFixed(2));
const r4 = (v) => Number(Number(v).toFixed(4));
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

const SEV = { WARNING: 'WARNING', SOFT: 'SOFT_ERROR', HARD: 'HARD_ERROR' };
const GATING = [SEV.SOFT, SEV.HARD];
const isGating = (s) => GATING.includes(s);

// ===========================================================================
// CHECK CODES
//
// Looked up in 03-VALIDATION-RULES.md before assigning, not invented. INV450
// to INV458 were ALREADY DOCUMENTED as this package's rules, and six of them
// describe checks in this scope — so they are reused rather than duplicated at
// a new number. New codes start at INV459, because 450 is taken.
//
//   INV450  every line must resolve to exactly one ticket_id
//   INV451  invoiced quantity must agree with the ticket within tolerance
//   INV452  unit price must equal the contract price within tolerance
//   INV454  total and line count derived from lines, never keyed
//   INV455  a ticket may appear on at most one payable line, ever
//   INV456  negative lines are valid for DEFUEL and must reduce the total
// ===========================================================================
const C = {
    // CAPTURE AND DOCUMENT
    HEADER_FIELD_MISSING:  'INV459',
    LINE_COUNT_MISMATCH:   'INV460',
    DATE_IN_FUTURE:        'INV461',
    // RESOLUTION
    TICKET_MISSING:        'INV450',
    TICKET_NOT_FOUND:      'INV462',
    TICKET_NO_ORDER:       'INV463',
    ORDER_NO_PO:           'INV464',
    PO_DISAGREES:          'INV465',
    NO_GR:                 'INV466',
    // QUANTITY
    QTY_VS_GR:             'INV451',
    QTY_EXCEEDS_ORDER:     'INV467',
    UOM_MISMATCH:          'INV468',
    QTY_NOT_POSITIVE:      'INV456',
    // PRICE AND VALUE
    PRICE_VS_ORDER:        'INV452',
    LINE_VALUE_WRONG:      'INV469',
    HEADER_TOTAL_WRONG:    'INV454',
    PRICE_PROVISIONAL:     'INV470',
    CHARGE_NO_COMPONENT:   'INV471',
    COMPONENT_ABSENT:      'INV472',
    // DUPLICATE
    DUP_INVOICE_NUMBER:    'INV473',
    DUP_TICKET:            'INV455',
    DUP_ORDER_GR:          'INV474'
};

// ===========================================================================
// 1. THE REGISTRY
// ===========================================================================

/**
 * Load the active registry as of a date.
 *
 * A check absent from the registry DOES NOT RUN. That is the point of a
 * registry — but it also means a missing row is silent, so the caller is told
 * how many rows it found and the harness asserts on that.
 */
async function loadRegistry(asOfDate, tx) {
    const db = tx || cds.db;
    const rows = await db.run(SELECT.from('fuelsphere.INVOICE_CHECK_REGISTRY'));
    const active = rows.filter(r =>
        r.is_active !== false &&
        (!r.valid_from || String(r.valid_from) <= String(asOfDate)) &&
        (!r.valid_to   || String(r.valid_to)   >= String(asOfDate)));
    const map = new Map();
    for (const r of active) map.set(r.check_code, r);
    return map;
}

// ===========================================================================
// 2. THE TOLERANCE LADDER
// ===========================================================================

/**
 * Resolve a tolerance row.
 *
 * CFG401: the highest-specificity row whose scope matches. TOLERANCE_RULES has
 * no specificity_rank; it has `priority`, documented as lower = higher, and
 * the seed already encodes specificity that way. Priority is the authority
 * because it is the column that exists.
 *
 * CFG402: the as-of date is the TRANSACTION date, never today.
 * CFG406: the row that resolved is returned so the exception can name it.
 *
 * applies_to is what stops an invoice check picking up the FOB
 * reconciliation's tolerance. Two controls, different questions.
 */
async function resolveTolerance(appliesTo, toleranceType, scope, asOfDate, tx) {
    const db = tx || cds.db;
    const rows = await db.run(SELECT.from('fuelsphere.TOLERANCE_RULES')
        .where({ tolerance_type: toleranceType }));

    const candidates = rows.filter(r => {
        if (r.is_active === false) return false;
        if (r.applies_to && r.applies_to !== appliesTo) return false;
        if (r.valid_from && String(r.valid_from) > String(asOfDate)) return false;
        if (r.valid_to   && String(r.valid_to)   < String(asOfDate)) return false;
        // A scope column set on the rule must match; unset means "any".
        if (r.company_code      && r.company_code      !== scope.companyCode) return false;
        if (r.supplier_category && r.supplier_category !== scope.supplierCategory) return false;
        if (r.product_type      && r.product_type      !== scope.productType) return false;
        return true;
    });

    if (!candidates.length) {
        return { rule: null, reason:
            `No TOLERANCE_RULES row for ${toleranceType} applies_to ${appliesTo} at ${asOfDate}.` };
    }
    // A rule naming applies_to beats one that matches everything, before
    // priority is consulted at all — an explicit scope is more specific than
    // an absent one whatever number sits beside it.
    candidates.sort((a, b) =>
        (b.applies_to ? 1 : 0) - (a.applies_to ? 1 : 0) ||
        (a.priority || 999) - (b.priority || 999));

    return { rule: candidates[0], candidates: candidates.length };
}

/**
 * Which rung a variance lands on.
 *
 * ON ABSOLUTE MAGNITUDE. An under-invoice and an over-invoice of the same size
 * are the same size — direction is recorded on the exception, and the rung is
 * about how far, not which way.
 *
 * A rule with no ladder falls back to the single lower/upper line, and the
 * registry's configured severity applies beyond it. That is a real fallback,
 * not a failure: a rule may legitimately be a line rather than a ladder.
 */
function ladder(variancePct, rule, fallbackSeverity) {
    const v = Math.abs(Number(variancePct));
    const warn = num(rule && rule.warning_threshold);
    const err  = num(rule && rule.error_threshold);
    const crit = num(rule && rule.critical_threshold);

    if (warn === null && err === null && crit === null) {
        // No ladder. The single line, then the registry's severity.
        const lo = num(rule && rule.lower_limit);
        const hi = num(rule && rule.upper_limit);
        const line = hi !== null ? Math.abs(hi) : (lo !== null ? Math.abs(lo) : null);
        if (line === null) return { severity: null, rung: 'NO_TOLERANCE' };
        return v <= line
            ? { severity: null, rung: 'WITHIN', threshold: line, laddered: false }
            : { severity: fallbackSeverity, rung: 'BEYOND', threshold: line, laddered: false };
    }

    if (warn !== null && v <= warn) return { severity: null,      rung: 'WITHIN_WARNING', threshold: warn, laddered: true };
    if (err  !== null && v <= err)  return { severity: SEV.WARNING, rung: 'WARNING',      threshold: warn, laddered: true };
    if (crit !== null && v <= crit) return { severity: SEV.SOFT,    rung: 'SOFT',         threshold: err,  laddered: true };
    return { severity: SEV.HARD, rung: 'HARD', threshold: crit, laddered: true };
}

// ===========================================================================
// 3. RAISING
// ===========================================================================

/**
 * Build one exception.
 *
 * severity_source records whether the ladder decided or the registry did,
 * because "SOFT because the variance was 3.2%" and "SOFT because that is what
 * the registry says" are different facts and only one of them moves when the
 * data moves.
 *
 * A check absent from the registry raises nothing AND SAYS SO — it does not
 * fall back to a hardcoded severity, because that would make the registry
 * decorative.
 */
function raise(registry, code, opts = {}) {
    const reg = registry.get(code);
    if (!reg) return { skipped: 'NOT_REGISTERED', check_code: code };
    if (reg.is_implemented === false) return { skipped: 'NOT_IMPLEMENTED', check_code: code };

    const severity = opts.severity || reg.default_severity;
    return {
        check_code: code,
        check_group: reg.check_group,
        severity,
        severity_source: opts.severity ? 'TOLERANCE_LADDER' : 'REGISTRY_DEFAULT',
        is_gating: isGating(severity),
        message: opts.message,
        line_number: opts.line_number !== undefined ? opts.line_number : null,
        invoice_item_ID: opts.itemId || null,
        observed_value: opts.observed !== undefined ? opts.observed : null,
        expected_value: opts.expected !== undefined ? opts.expected : null,
        variance_value: opts.variance !== undefined ? opts.variance : null,
        variance_pct: opts.variancePct !== undefined ? opts.variancePct : null,
        threshold_crossed: opts.threshold !== undefined ? opts.threshold : null,
        tolerance_rule_ID: opts.toleranceRuleId || null,
        // Carried for the harness and the PR, not stored
        _rung: opts.rung || null,
        _bypassable: reg.is_bypassable === true && severity !== SEV.HARD
    };
}

// ===========================================================================
// 4. RESOLUTION — THE TICKET NUMBER TO ITS PO AND GR
//
// This is the chain the supplier cannot walk and we can. They quote a ticket
// number; they do not know our PO. REQ-CP-006.
//
//     ticket_number -> FUEL_TICKETS -> order -> s4_po_number
//                                   -> delivery -> s4_gr_number
//
// Every step can fail, and each failure is a DIFFERENT exception, because
// "the ticket does not exist" and "the ticket exists and was never ordered"
// send an accounts payable clerk to different places.
// ===========================================================================
async function resolveLine(item, tx) {
    const db = tx || cds.db;
    const out = {
        ticket: null, order: null, delivery: null,
        resolved_po_number: null, resolved_gr_number: null,
        resolution_source: 'UNRESOLVED', failure: null
    };

    const stated = (item.ticket_number || '').trim();
    if (!stated && !item.ticket_ID) { out.failure = 'TICKET_MISSING'; return out; }

    // An explicit ticket_ID is a resolution somebody already made. The stated
    // number is the supplier's string and has to be looked up.
    let ticket = null;
    if (item.ticket_ID) {
        ticket = await db.run(SELECT.one.from('fuelsphere.FUEL_TICKETS').where({ ID: item.ticket_ID }));
        if (ticket) out.resolution_source = 'TICKET_ID';
    }
    if (!ticket && stated) {
        const hits = await db.run(SELECT.from('fuelsphere.FUEL_TICKETS').where({ ticket_number: stated }));
        // INV450 says EXACTLY ONE. Two tickets with one number is not a
        // resolution, and picking the first would invent one.
        if (hits.length === 1) { ticket = hits[0]; out.resolution_source = 'TICKET_NUMBER'; }
        else if (hits.length > 1) { out.failure = 'TICKET_AMBIGUOUS'; out.candidates = hits.length; return out; }
    }
    if (!ticket) { out.failure = 'TICKET_NOT_FOUND'; return out; }
    out.ticket = ticket;

    if (!ticket.order_ID) { out.failure = 'TICKET_NO_ORDER'; return out; }
    out.order = await db.run(SELECT.one.from('fuelsphere.FUEL_ORDERS').where({ ID: ticket.order_ID }));
    if (!out.order) { out.failure = 'TICKET_NO_ORDER'; return out; }

    out.resolved_po_number = out.order.s4_po_number || null;
    if (!out.resolved_po_number) out.failure = 'ORDER_NO_PO';

    // The GR hangs off the delivery, and a ticket may name one directly or
    // reach it through its order.
    const deliveryId = ticket.delivery_ID || null;
    if (deliveryId) out.delivery = await db.run(SELECT.one.from('fuelsphere.FUEL_DELIVERIES').where({ ID: deliveryId }));
    if (!out.delivery && out.order) {
        out.delivery = await db.run(SELECT.one.from('fuelsphere.FUEL_DELIVERIES').where({ order_ID: out.order.ID }));
    }
    out.resolved_gr_number = (out.delivery && out.delivery.s4_gr_number) || null;
    if (!out.failure && !out.resolved_gr_number) out.failure = 'NO_GR';

    return out;
}

// ===========================================================================
// 5. DUPLICATE DETECTION — THREE KEYS, ALL HARD
//
// A DUPLICATE LINE IS A VALID LINE IN THE WRONG PLACE. Right quantity, right
// price, right ticket — wrong because it is the second occurrence. Every
// resolution check and every tolerance check passes on it, individually,
// because individually it is correct.
//
// So this cannot be a by-product of the resolution. It is its own pass, over
// a set the resolution never looks at: every OTHER line, on this invoice and
// on every invoice already captured.
// ===========================================================================
async function detectDuplicates(invoice, items, resolutions, registry, tx) {
    const db = tx || cds.db;
    const found = [];

    // ---- key 1: same invoice number, same vendor --------------------------
    const sameNumber = (await db.run(SELECT.from('fuelsphere.INVOICES')
        .columns('ID', 'invoice_number', 'supplier_ID', 'invoice_date')
        .where({ invoice_number: invoice.invoice_number, supplier_ID: invoice.supplier_ID })))
        .filter(r => r.ID !== invoice.ID);
    if (sameNumber.length) {
        found.push(raise(registry, C.DUP_INVOICE_NUMBER, {
            message: `Invoice number ${invoice.invoice_number} is already captured for this supplier `
                   + `(${sameNumber.length} other: ${sameNumber.map(r => r.invoice_date).join(', ')}).`,
            observed: sameNumber.length }));
    }

    // ---- key 2: same TICKET invoiced twice --------------------------------
    // Across all invoices AND within this one. INV455: a ticket may appear on
    // at most one payable line, ever.
    const allItems = await db.run(SELECT.from('fuelsphere.INVOICE_ITEMS')
        .columns('ID', 'invoice_ID', 'line_number', 'ticket_number', 'ticket_ID'));

    for (const it of items) {
        const res = resolutions.get(it.ID);
        const tid = (res && res.ticket && res.ticket.ID) || it.ticket_ID;
        const tnum = (it.ticket_number || '').trim();
        if (!tid && !tnum) continue;

        const others = allItems.filter(o => o.ID !== it.ID &&
            ((tid && o.ticket_ID === tid) ||
             (tnum && (o.ticket_number || '').trim() === tnum)));
        if (!others.length) continue;

        const sameInvoice = others.filter(o => o.invoice_ID === invoice.ID).length;
        found.push(raise(registry, C.DUP_TICKET, {
            itemId: it.ID, line_number: it.line_number,
            message: `Ticket ${tnum || tid} is invoiced on ${others.length + 1} lines in total `
                   + `(${sameInvoice + 1} on this invoice). A ticket is payable once.`,
            observed: others.length + 1, expected: 1 }));
    }

    // ---- key 3: same ORDER and GR combination -----------------------------
    const seen = new Map();
    for (const it of items) {
        const res = resolutions.get(it.ID);
        if (!res || !res.order || !res.resolved_gr_number) continue;
        const key = `${res.order.ID}|${res.resolved_gr_number}`;
        if (seen.has(key)) {
            found.push(raise(registry, C.DUP_ORDER_GR, {
                itemId: it.ID, line_number: it.line_number,
                message: `Order ${res.order.order_number} and GR ${res.resolved_gr_number} are already `
                       + `invoiced on line ${seen.get(key)} of this invoice.`,
                observed: 2, expected: 1 }));
        } else seen.set(key, it.line_number);
    }

    return found.filter(f => !f.skipped);
}

// ===========================================================================
// 6. HEADER TOTALS — DERIVED FROM LINES, NEVER KEYED (INV454)
// ===========================================================================
function deriveTotals(items) {
    const net = r2(items.reduce((a, i) => a + Number(i.net_amount || 0), 0));
    const tax = r2(items.reduce((a, i) => a + Number(i.tax_amount || 0), 0));
    return { net_amount: net, tax_amount: tax, gross_amount: r2(net + tax), line_count: items.length };
}

// ===========================================================================
// 7. THE RUN
// ===========================================================================

/**
 * Run every registered check over one invoice.
 *
 * Returns exceptions, the derived totals and the per-line resolution. It
 * writes nothing — the caller decides what to persist, so this is testable
 * without a transaction and the same code answers "what would happen".
 *
 * NOTHING HERE READS recon_status. A meter-versus-gauge variance is a
 * different control answering a different question, and decision C-1 says
 * payment is not held for one.
 */
async function runChecks(invoice, items, opts, tx) {
    const asOf = String(invoice.invoice_date || opts.today);
    const registry = opts.registry || await loadRegistry(asOf, tx);
    const exceptions = [];
    const push = (e) => { if (e && !e.skipped) exceptions.push(e); else if (e && e.skipped) skipped.push(e); };
    const skipped = [];

    const scope = {
        companyCode: opts.companyCode || null,
        supplierCategory: opts.supplierCategory || null,
        productType: opts.productType || null
    };

    // ---- CAPTURE AND DOCUMENT --------------------------------------------
    const missing = ['invoice_number', 'supplier_ID', 'invoice_date', 'currency_code']
        .filter(f => invoice[f] === null || invoice[f] === undefined || invoice[f] === '');
    if (missing.length) {
        push(raise(registry, C.HEADER_FIELD_MISSING, {
            message: `Mandatory header field(s) missing: ${missing.join(', ')}.`, observed: missing.length }));
    }

    if (invoice.stated_line_count !== null && invoice.stated_line_count !== undefined
        && Number(invoice.stated_line_count) !== items.length) {
        push(raise(registry, C.LINE_COUNT_MISMATCH, {
            message: `The document states ${invoice.stated_line_count} line(s); ${items.length} were received.`,
            observed: items.length, expected: Number(invoice.stated_line_count),
            variance: items.length - Number(invoice.stated_line_count) }));
    }

    if (invoice.invoice_date && String(invoice.invoice_date) > String(opts.today)) {
        push(raise(registry, C.DATE_IN_FUTURE, {
            message: `Invoice date ${invoice.invoice_date} is after today (${opts.today}).` }));
    }

    // ---- PER LINE ---------------------------------------------------------
    const resolutions = new Map();
    for (const it of items) {
        const res = await resolveLine(it, tx);
        resolutions.set(it.ID, res);
        const at = { itemId: it.ID, line_number: it.line_number };

        // RESOLUTION
        switch (res.failure) {
            case 'TICKET_MISSING':
                push(raise(registry, C.TICKET_MISSING, { ...at,
                    message: `Line ${it.line_number} states no ticket number. `
                           + `The ticket is what the supplier references and what resolves the PO.` }));
                break;
            case 'TICKET_NOT_FOUND':
                push(raise(registry, C.TICKET_NOT_FOUND, { ...at,
                    message: `Ticket "${it.ticket_number}" is not in FuelSphere. `
                           + `Nothing links this line to a delivery.` }));
                break;
            case 'TICKET_AMBIGUOUS':
                push(raise(registry, C.TICKET_NOT_FOUND, { ...at,
                    message: `Ticket "${it.ticket_number}" matches ${res.candidates} tickets. `
                           + `INV450 requires exactly one; picking one would invent a resolution.`,
                    observed: res.candidates, expected: 1 }));
                break;
            case 'TICKET_NO_ORDER':
                push(raise(registry, C.TICKET_NO_ORDER, { ...at,
                    message: `Ticket ${res.ticket.ticket_number} exists but carries no order (UNMATCHED). `
                           + `There is no PO to invoice against.` }));
                break;
            case 'ORDER_NO_PO':
                push(raise(registry, C.ORDER_NO_PO, { ...at,
                    message: `Order ${res.order.order_number} has no s4_po_number. `
                           + `The invoice cannot reference a purchase order that was never created.` }));
                break;
            case 'NO_GR':
                push(raise(registry, C.NO_GR, { ...at,
                    message: `No goods receipt against order ${res.order.order_number}. `
                           + `Nothing records that the fuel was received.` }));
                break;
        }

        // Stated PO versus resolved PO — SOFT, because the invoice may simply
        // quote a PO we superseded, and the resolution through the ticket is
        // the one we trust.
        const statedPo = (it.po_number || '').trim();
        if (statedPo && res.resolved_po_number && statedPo !== res.resolved_po_number) {
            push(raise(registry, C.PO_DISAGREES, { ...at,
                message: `Line states PO ${statedPo}; the ticket resolves to PO ${res.resolved_po_number}.` }));
        }

        // QUANTITY
        const qty = num(it.quantity);
        if (qty === null || qty === 0) {
            push(raise(registry, C.QTY_NOT_POSITIVE, { ...at,
                message: `Line quantity is ${qty === null ? 'absent' : 'zero'}.`, observed: qty }));
        } else if (qty < 0) {
            // INV456 permits a negative line for DEFUEL. NO FIELD ON
            // FUEL_TICKETS OR INVOICE_ITEMS DISTINGUISHES A DEFUEL LINE, so
            // the carve-out cannot be applied and every negative raises.
            // Reported rather than silently treated as valid.
            push(raise(registry, C.QTY_NOT_POSITIVE, { ...at,
                message: `Line quantity is negative (${qty}). INV456 permits this for a defuel, `
                       + `but no field distinguishes a defuel line, so it cannot be confirmed.`,
                observed: qty }));
        }

        if (res.delivery && qty !== null && qty !== 0) {
            const grUom = res.delivery.uom_code;
            if (grUom && it.uom_code && grUom !== it.uom_code) {
                push(raise(registry, C.UOM_MISMATCH, { ...at,
                    message: `Line is in ${it.uom_code}; the goods receipt is in ${grUom}. `
                           + `Comparing the numbers would compare different things.` }));
            } else {
                const grQty = num(res.delivery.delivered_quantity);
                if (grQty) {
                    const variance = r4(qty - grQty);
                    const pct = r4((variance / grQty) * 100);
                    const t = await resolveTolerance('INVOICE_LINE', 'QUANTITY', scope, asOf, tx);
                    const reg = registry.get(C.QTY_VS_GR);
                    const rung = ladder(pct, t.rule, reg && reg.default_severity);
                    if (rung.severity) {
                        push(raise(registry, C.QTY_VS_GR, { ...at,
                            severity: rung.severity, rung: rung.rung,
                            message: `Invoiced ${qty} ${it.uom_code} against goods receipt ${grQty} `
                                   + `(${pct > 0 ? '+' : ''}${pct}%), which is the ${rung.rung} rung `
                                   + `of ${t.rule ? t.rule.rule_code : 'no tolerance rule'}.`,
                            observed: qty, expected: grQty, variance, variancePct: pct,
                            threshold: rung.threshold, toleranceRuleId: t.rule && t.rule.ID }));
                    }
                }
            }
        }

        if (res.order && qty !== null && qty > 0) {
            const ordered = num(res.order.ordered_quantity);
            if (ordered && qty > ordered) {
                push(raise(registry, C.QTY_EXCEEDS_ORDER, { ...at,
                    message: `Invoiced ${qty} exceeds the ordered ${ordered} on `
                           + `${res.order.order_number}.`,
                    observed: qty, expected: ordered, variance: r4(qty - ordered) }));
            }
        }

        // PRICE AND VALUE
        const price = num(it.unit_price);
        const netAmt = num(it.net_amount);
        if (price !== null && qty !== null && netAmt !== null) {
            const computed = r2(qty * price);
            if (Math.abs(computed - netAmt) > 0.01) {
                push(raise(registry, C.LINE_VALUE_WRONG, { ...at,
                    message: `Line value ${netAmt} does not equal quantity x price (${qty} x ${price} = ${computed}).`,
                    observed: netAmt, expected: computed, variance: r2(netAmt - computed) }));
            }
        }

        // A PROVISIONAL PRICE SUSPENDS THE COMPARISON.
        //
        // Comparing a proxy against a contract that has not resolved produces
        // a variance every time, so the variance would be noise. The WARNING
        // is raised INSTEAD of the check, never alongside a pass — "not
        // compared" must not read as "compared and fine".
        let provisional = null;
        if (res.order && res.order.contract_ID) {
            const dp = await (tx || cds.db).run(SELECT.one.from('fuelsphere.DERIVED_PRICES')
                .where({ contract_ID: res.order.contract_ID, is_current: true,
                         price_status: 'PROVISIONAL' })
                .orderBy({ price_date: 'desc' }));
            if (dp) provisional = dp;
        }
        if (provisional) {
            push(raise(registry, C.PRICE_PROVISIONAL, { ...at,
                message: `Contract price for ${res.order.order_number} is PROVISIONAL `
                       + `(${provisional.derived_price} ${provisional.currency_currency_code}/`
                       + `${provisional.uom_uom_code}, settles ${provisional.settles_for_period}). `
                       + `The price comparison is SUSPENDED, not passed.`,
                observed: price, expected: num(provisional.derived_price) }));
        } else if (res.order && price !== null) {
            const ref = num(res.order.unit_price);
            if (ref) {
                const variance = r4(price - ref);
                const pct = r4((variance / ref) * 100);
                const t = await resolveTolerance('INVOICE_LINE', 'PRICE', scope, asOf, tx);
                const reg = registry.get(C.PRICE_VS_ORDER);
                const rung = ladder(pct, t.rule, reg && reg.default_severity);
                if (rung.severity) {
                    push(raise(registry, C.PRICE_VS_ORDER, { ...at,
                        severity: rung.severity, rung: rung.rung,
                        message: `Invoiced ${price} against order price ${ref} `
                               + `(${pct > 0 ? '+' : ''}${pct}%), the ${rung.rung} rung of `
                               + `${t.rule ? t.rule.rule_code : 'no tolerance rule'}.`,
                        observed: price, expected: ref, variance, variancePct: pct,
                        threshold: rung.threshold, toleranceRuleId: t.rule && t.rule.ID }));
                }
            }
        }
    }

    // ---- COMPONENT COVERAGE ----------------------------------------------
    // WP-20 keeps the components separate for exactly this. A charge the
    // contract does not carry, and a contract charge the invoice omits, are
    // different findings and neither shows up in a total.
    const componentFindings = await checkComponents(invoice, items, resolutions, registry, tx);
    componentFindings.forEach(push);

    // ---- HEADER TOTAL ------------------------------------------------------
    const derived = deriveTotals(items);
    const statedNet = num(invoice.stated_net_amount);
    if (statedNet !== null && Math.abs(statedNet - derived.net_amount) > 0.01) {
        push(raise(registry, C.HEADER_TOTAL_WRONG, {
            message: `Document states a net total of ${statedNet}; the lines sum to ${derived.net_amount}. `
                   + `The derived figure governs (INV454).`,
            observed: statedNet, expected: derived.net_amount,
            variance: r2(statedNet - derived.net_amount) }));
    }

    // ---- DUPLICATES, as their own pass ------------------------------------
    const dups = await detectDuplicates(invoice, items, resolutions, registry, tx);
    dups.forEach(d => exceptions.push(d));

    return { exceptions, skipped, derived, resolutions, registrySize: registry.size };
}

/**
 * A charge with no contract component, and a contract component absent.
 *
 * Only runs where the order resolves to a contract with an ACTIVE formula.
 * Where it does not, nothing is raised — an absent comparison is not a
 * failed one.
 */
async function checkComponents(invoice, items, resolutions, registry, tx) {
    const db = tx || cds.db;
    const out = [];
    for (const it of items) {
        const res = resolutions.get(it.ID);
        if (!res || !res.order || !res.order.contract_ID) continue;

        const dp = await db.run(SELECT.one.from('fuelsphere.DERIVED_PRICES')
            .columns('component_breakdown', 'price_date')
            .where({ contract_ID: res.order.contract_ID, is_current: true })
            .orderBy({ price_date: 'desc' }));
        if (!dp || !dp.component_breakdown) continue;

        let contractComponents = [];
        try {
            const b = JSON.parse(dp.component_breakdown);
            contractComponents = (b.components || []).filter(c => c.fired).map(c => c.name);
        } catch { continue; }
        if (!contractComponents.length) continue;

        // The invoice's charges, as named on the line. One line with a
        // description naming no component is a charge nobody contracted.
        const desc = (it.description || '').toLowerCase();
        const invoiced = contractComponents.filter(n => desc.includes(n.toLowerCase()));

        if (it.description && !invoiced.length && contractComponents.length) {
            out.push(raise(registry, C.CHARGE_NO_COMPONENT, {
                itemId: it.ID, line_number: it.line_number,
                message: `Line describes "${it.description}", which names none of the `
                       + `${contractComponents.length} contract component(s): `
                       + `${contractComponents.join(', ')}.`,
                observed: 0, expected: contractComponents.length }));
        }
        const absent = contractComponents.filter(n => !desc.includes(n.toLowerCase()));
        if (invoiced.length && absent.length) {
            out.push(raise(registry, C.COMPONENT_ABSENT, {
                itemId: it.ID, line_number: it.line_number,
                message: `Contract component(s) absent from the invoice line: ${absent.join(', ')}.`,
                observed: invoiced.length, expected: contractComponents.length }));
        }
    }
    return out.filter(o => !o.skipped);
}

module.exports = {
    C, SEV, GATING, isGating, r2, r4, num,
    loadRegistry, resolveTolerance, ladder, raise,
    resolveLine, detectDuplicates, deriveTotals, checkComponents, runChecks
};

/**
 * FuelSphere - the invoice header and line item views (WP-36, WP-37).
 *
 * THE LINE IS WHERE THE COMPARISON LIVES; THE HEADER IS ITS SUM. Every figure
 * on the header view is an aggregate of the line figures below it, computed
 * once here so the two views cannot disagree about the same invoice.
 *
 * LITRES ON BOTH SIDES (Sep 2026, replacing decision Q3's kilograms). Both
 * documents METER A VOLUME - the invoice in its line's uom_code, the ticket on
 * the bowser - so litres are what the two actually have in common. Comparing
 * in kilograms meant converting the invoice at the ticket's density, which put
 * a density in the middle of every variance: a disagreement about density then
 * read as a disagreement about quantity. Kilograms are still computed for the
 * ROB ledger and the ticket's own record, and are not what the screens judge.
 *
 * THE THREE VARIANCES ADD UP, and are defined so that they must:
 *
 *   total   = invoice amount - ticket amount                    money
 *   qty     = invoice litres - ticket litres                    litres
 *   price   = (invoice rate - ticket rate) x invoice litres     money
 *
 *   price + qty x ticket rate = total, exactly.
 *
 * TWO AXES - decision Q2. tolerance is a MEASUREMENT (within / exceeded) and
 * review is where a PERSON has got to. They are held apart and merged only in
 * the display string, so the measurement survives a review being opened.
 *
 * TOLERANCE IS NOT RE-IMPLEMENTED. It resolves through invoice-checks.js
 * resolveTolerance - the same ladder, the same TOL-INV-QTY and TOL-INV-PRICE
 * rows, the same applies_to INVOICE_LINE - so this view and the checker can
 * never reach different verdicts on one line.
 *
 * WHY THE BASE COLUMNS ARE RE-READ: an after-READ handler receives only what
 * the client selected, and Fiori selects the displayed columns and nothing
 * else. ticket_ID is displayed nowhere, so it would arrive undefined and every
 * lookup would silently miss. Proven the hard way on the Fuel Burns list.
 */

const cds = require('@sap/cds');
const { SELECT } = cds.ql;
const { toLitres } = require('./fuel-uom');
const { resolveTolerance } = require('./invoice-checks');

const ITEMS   = 'fuelsphere.INVOICE_ITEMS';
const INVS    = 'fuelsphere.INVOICES';
const TICKETS = 'fuelsphere.FUEL_TICKETS';
const FLIGHTS = 'fuelsphere.FLIGHT_SCHEDULE';

const num   = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const money = (v) => (v === null || v === undefined ? null : Number(Number(v).toFixed(2)));
const kg    = (v) => (v === null || v === undefined ? null : Number(Number(v).toFixed(2)));
const r4    = (v) => (v === null || v === undefined ? null : Number(Number(v).toFixed(4)));

function total(rows, pick) {
    let sum = null;
    for (const r of rows) {
        const v = pick(r);
        if (v === null || v === undefined || Number.isNaN(v)) continue;
        sum = (sum === null ? 0 : sum) + Number(v);
    }
    return sum;
}

/** DRAFT, SUBMITTED and VERIFIED are one thing to the reader: not done yet. */
function statusDisplay(status) {
    switch (status) {
        case 'DRAFT': case 'SUBMITTED': case 'VERIFIED': return 'In process';
        case 'POSTED':    return 'Posted';
        case 'PAID':      return 'Paid';
        case 'CANCELLED': return 'Cancelled';
        default:          return status || null;
    }
}

/** The two axes, merged for the screen and only for the screen. */
function toleranceDisplay(tol, review) {
    if (tol === 'WITHIN') return 'Within tolerance';
    if (tol !== 'EXCEEDED') return null;
    if (review === 'DISPUTED')  return 'Dispute raised to supplier';
    if (review === 'REVIEWING') return 'Exceeded - reviewing';
    return 'Exceeds tolerance';
}

const LINE_BASE = ['invoice_ID', 'ticket_ID', 'quantity', 'uom_code', 'unit_price',
                   'net_amount', 'tax_amount', 'flight_ID', 'ticket_quantity_kg',
                   'ticket_rate', 'ticket_amount', 'review_status'];

/**
 * Compute every derived figure for a set of invoice lines.
 *
 * Batched: a fixed handful of queries whatever the number of lines, so the
 * header view - which needs every line of every invoice on the page - costs
 * the same as the line view.
 *
 * @param {object[]} lines  rows carrying at least ID
 * @returns {Promise<Map<string, object>>} line ID -> computed figures
 */
async function computeLines(lines, opts = {}) {
    const out = new Map();
    const rows = lines.filter(r => r && r.ID);
    if (!rows.length) return out;

    // ---- base columns, whatever the client selected -------------------
    const base = new Map(rows.map(r => [r.ID, Object.fromEntries(LINE_BASE.map(k => [k, r[k]]))]));
    const gaps = rows.filter(r => LINE_BASE.some(k => r[k] === undefined));
    if (gaps.length) {
        const stored = await cds.db.run(SELECT.from(opts.source || ITEMS).columns('ID', ...LINE_BASE)
            .where({ ID: { in: gaps.map(r => r.ID) } }));
        for (const s of stored) {
            const b = base.get(s.ID);
            // Only the gaps: a draft line carries edits the stored row lacks.
            if (b) for (const k of LINE_BASE) if (b[k] === undefined) b[k] = s[k];
        }
    }
    const B = (id) => base.get(id) || {};

    // ---- the tickets the lines resolved to ------------------------------
    const ticketIds = [...new Set(rows.map(r => B(r.ID).ticket_ID).filter(Boolean))];
    const tickets = ticketIds.length ? await cds.db.run(SELECT.from(TICKETS)
        .columns('ID', 'quantity_kg', 'quantity_metered', 'quantity', 'uom_code',
                 'total_amount', 'flight_ID', 'flight_number', 'delivery_timestamp')
        .where({ ID: { in: ticketIds } })) : [];
    const ticketById = new Map(tickets.map(t => [t.ID, t]));

    // ---- the parent invoices, for the header fields shown on each line --
    const invIds = [...new Set(rows.map(r => B(r.ID).invoice_ID).filter(Boolean))];
    const invs = invIds.length ? await cds.db.run(SELECT.from(INVS)
        .columns('ID', 'invoice_number', 'sap_invoice_number', 'status', 'received_date',
                 'created_at', 'invoice_date', 's4_document_number', 'posting_date',
                 's4_payment_document', 'payment_date')
        .where({ ID: { in: invIds } })) : [];
    const invById = new Map(invs.map(i => [i.ID, i]));

    // ---- flights, three ways in -----------------------------------------
    // The line's own flight first (WP-35 put it there so it survives a failed
    // ticket resolution), then the ticket's flight, then the ticket's flight
    // NUMBER on its delivery date - the same key FLIGHT_DISPATCH matches on,
    // and the only route seed tickets have, since they predate ticket.flight.
    const directIds = new Set();
    for (const r of rows) {
        const b = B(r.ID), t = ticketById.get(b.ticket_ID);
        if (b.flight_ID) directIds.add(b.flight_ID);
        if (t && t.flight_ID) directIds.add(t.flight_ID);
    }
    const numbers = [...new Set(tickets.filter(t => !t.flight_ID && t.flight_number)
        .map(t => t.flight_number))];
    const flightRows = [];
    if (directIds.size) flightRows.push(...await cds.db.run(SELECT.from(FLIGHTS)
        .columns('ID', 'flight_number', 'flight_date', 'origin_airport', 'destination_airport', 'status')
        .where({ ID: { in: [...directIds] } })));
    if (numbers.length) flightRows.push(...await cds.db.run(SELECT.from(FLIGHTS)
        .columns('ID', 'flight_number', 'flight_date', 'origin_airport', 'destination_airport', 'status')
        .where({ flight_number: { in: numbers } })));
    const flightById = new Map(flightRows.map(f => [f.ID, f]));

    const flightFor = (b, t) => {
        if (b.flight_ID && flightById.get(b.flight_ID)) return flightById.get(b.flight_ID);
        if (t && t.flight_ID && flightById.get(t.flight_ID)) return flightById.get(t.flight_ID);
        if (t && t.flight_number) {
            // Date is part of the key - a flight number recurs every day it
            // flies, and number alone would attach Tuesday's leg to Monday.
            const day = t.delivery_timestamp ? String(t.delivery_timestamp).slice(0, 10) : null;
            const hits = flightRows.filter(f => f.flight_number === t.flight_number &&
                (!day || String(f.flight_date).slice(0, 10) === day));
            if (hits.length === 1) return hits[0];
        }
        return null;
    };

    // ---- tolerance, resolved once per rule per date --------------------
    const tolCache = new Map();
    const tolerance = async (type, asOf) => {
        const key = type + '|' + asOf;
        if (!tolCache.has(key)) {
            const res = await resolveTolerance('INVOICE_LINE', type, {}, asOf);
            tolCache.set(key, res && res.rule ? res.rule : null);
        }
        return tolCache.get(key);
    };
    const inBand = (rule, pct) => {
        if (!rule || pct === null) return null;
        const lo = num(rule.lower_limit), hi = num(rule.upper_limit);
        if (lo === null || hi === null) return null;
        return pct >= lo && pct <= hi;
    };

    // ---- per line ---------------------------------------------------------
    for (const r of rows) {
        const b = B(r.ID);
        const t = ticketById.get(b.ticket_ID) || null;
        const inv = invById.get(b.invoice_ID) || {};
        const f = flightFor(b, t);

        // Ticket side: the stored figure where the matcher wrote one, the
        // resolved ticket's otherwise. Stored wins because it is the figure the
        // variance was computed FROM, and survives a later ticket correction.
        const tktKg  = num(b.ticket_quantity_kg) ?? (t ? num(t.quantity_kg) : null);
        const tktAmt = num(b.ticket_amount) ?? (t ? num(t.total_amount) : null);
        const tktRate = num(b.ticket_rate) ??
            ((tktAmt !== null && tktKg) ? tktAmt / tktKg : null);

        // Invoice side, in kilograms at the ticket's own density.
        const invQty = num(b.quantity), invAmt = num(b.net_amount);
        let invKg = null;
        if (invQty !== null) {
            if (b.uom_code === 'KG') invKg = invQty;
            else if (t) {
                const tLitres = toLitres(t.quantity_metered ?? t.quantity, t.uom_code);
                const kgPerLitre = (tLitres && num(t.quantity_kg)) ? num(t.quantity_kg) / tLitres : null;
                const iLitres = toLitres(invQty, b.uom_code);
                if (kgPerLitre !== null && iLitres !== null) invKg = iLitres * kgPerLitre;
            }
        }
        // LITRES ON BOTH SIDES, AND THE COMPARISON IS MADE IN THEM (Sep 2026).
        // The invoice and the ticket both metered a volume, and toLitres only
        // normalises gallons and cubic metres, so this comparison carries no
        // density to argue about. The kilogram figures above stay for the ROB
        // ledger and the ticket's own record; nothing here is judged on them.
        const invL = invQty !== null ? toLitres(invQty, b.uom_code) : null;
        const tktL = t ? toLitres(t.quantity_metered ?? t.quantity, t.uom_code) : null;
        const invRateL = (invAmt !== null && invL) ? invAmt / invL : null;
        const tktRateL = (tktAmt !== null && tktL) ? tktAmt / tktL : null;

        // The three variances. Only where both sides exist - a line that
        // resolved to no ticket has no comparison, and zero would claim one.
        const totalVar = (invAmt !== null && tktAmt !== null) ? invAmt - tktAmt : null;
        const qtyVarL = (invL !== null && tktL !== null) ? invL - tktL : null;
        const priceVar = (invRateL !== null && tktRateL !== null && invL !== null)
            ? (invRateL - tktRateL) * invL : null;

        // Percentages for the tolerance bands - relative to the TICKET, the
        // reference the invoice is being checked against.
        const qtyPct   = (qtyVarL !== null && tktL) ? (qtyVarL / tktL) * 100 : null;
        const pricePct = (invRateL !== null && tktRateL) ? ((invRateL - tktRateL) / tktRateL) * 100 : null;

        const asOf = String(inv.invoice_date || inv.created_at || '').slice(0, 10) || null;
        const qtyOk   = inBand(await tolerance('QUANTITY', asOf), qtyPct);
        const priceOk = inBand(await tolerance('PRICE', asOf), pricePct);

        // EXCEEDED if either band is breached; WITHIN only if both were
        // assessed and both hold; otherwise unassessed, never a false pass.
        let tol = null, breach = null;
        if (qtyOk === false || priceOk === false) {
            tol = 'EXCEEDED';
            breach = (qtyOk === false && priceOk === false) ? 'BOTH'
                   : (qtyOk === false ? 'QUANTITY' : 'PRICE');
        } else if (qtyOk === true && priceOk === true) {
            tol = 'WITHIN';
        }

        out.set(r.ID, {
            invoice_ID: b.invoice_ID,
            resolved: !!t,
            // flight
            flight_number_v: f ? f.flight_number : (t ? t.flight_number : null),
            flight_date_v: f ? f.flight_date : null,
            dep_airport: f ? f.origin_airport : null,
            arr_airport: f ? f.destination_airport : null,
            flight_status_v: f ? f.status : null,
            // the parent invoice, shown on the line
            vendor_invoice_number: inv.invoice_number || null,
            sap_invoice_number_v: inv.sap_invoice_number || null,
            invoice_status_v: statusDisplay(inv.status),
            // received_date falls back to when the record reached FuelSphere,
            // which is the truthful answer until an inbound feed supplies one.
            received_date_v: inv.received_date ||
                (inv.created_at ? String(inv.created_at).slice(0, 10) : null),
            s4_document_number_v: inv.s4_document_number || null,
            posting_date_v: inv.posting_date || null,
            s4_payment_document_v: inv.s4_payment_document || null,
            payment_date_v: inv.payment_date || null,
            // both sides, in litres - what the screen compares
            inv_qty_ltr: kg(invL),
            inv_rate_ltr: r4(invRateL),
            ticket_qty_ltr: kg(tktL),
            ticket_rate_ltr: r4(tktRateL),
            ticket_amount: money(tktAmt),
            // the matcher's kilogram snapshot, kept for the ledger and the
            // ticket's own record rather than for this comparison
            ticket_quantity_kg: kg(tktKg),
            ticket_rate: r4(tktRate),
            // the three variances
            total_variance: money(totalVar),
            qty_variance_ltr: kg(qtyVarL),
            price_variance: money(priceVar),
            // the two axes, and their merge
            tolerance_status: tol,
            tolerance_breach: breach,
            tolerance_v: toleranceDisplay(tol, b.review_status || 'NONE'),
            // raw, for the header rollup
            _invKg: invKg, _invAmt: invAmt, _tktKg: tktKg, _tktAmt: tktAmt,
            _invL: invL, _tktL: tktL, _tax: num(b.tax_amount),
            _flightId: f ? f.ID : null
        });
    }
    return out;
}

// Stored columns shown by the views. Filled from the derivation ONLY where the
// client selected them and the stored value is null - never overwriting a
// figure the matcher persisted, never adding a property nobody asked for.
const STORED_FILL = ['ticket_quantity_kg', 'ticket_rate', 'ticket_amount', 'tolerance_status'];

/** After-READ for InvoiceItems (active and draft). */
async function applyLineSummary(data, opts = {}) {
    const rows = (Array.isArray(data) ? data : [data]).filter(r => r && r.ID);
    if (!rows.length) return;
    const computed = await computeLines(rows, opts);
    // The header's currency on each line (currency_v) - from the draft header
    // where the line is a draft, since a new invoice exists only as a draft.
    const invIds = [...new Set([...computed.values()].map(c => c.invoice_ID).filter(Boolean))];
    const heads = invIds.length ? await cds.db.run(SELECT.from(opts.headSource || INVS)
        .columns('ID', 'currency_code').where({ ID: { in: invIds } })) : [];
    const curById = new Map(heads.map(h => [h.ID, h.currency_code]));
    for (const row of rows) {
        const c = computed.get(row.ID);
        if (!c) continue;
        row.currency_v = curById.get(c.invoice_ID) || null;
        for (const [k, v] of Object.entries(c)) {
            if (k.startsWith('_') || k === 'invoice_ID' || k === 'resolved') continue;
            if (STORED_FILL.includes(k)) {
                if (k in row && (row[k] === null || row[k] === undefined)) row[k] = v;
            } else {
                row[k] = v;
            }
        }
    }
}

/**
 * After-READ for Invoices (active and draft): the header is the sum of its lines.
 *
 * DRAFT-AWARE, and that is the point of the opts. An invoice being created
 * exists only as a draft, and so do the lines being added to it - reading the
 * active tables alone left every total blank until the invoice was saved, so
 * nothing on the page moved as the clerk worked. A draft invoice's lines are
 * read from the draft table, the same fallback that fixed the order screens.
 *
 * @param {object|object[]} data
 * @param {{draftItems?: object, draftInvoices?: object}} opts  the service's
 *        .drafts entities; without them drafts read as active (tests, lists)
 */
async function applyHeaderSummary(data, opts = {}) {
    const rows = (Array.isArray(data) ? data : [data]).filter(r => r && r.ID);
    if (!rows.length) return;

    // opts.draft from the handler: after-READ rows do not carry IsActiveEntity
    // yet, so without it every draft read as active and found no lines.
    const isDraft = (r) => opts.draft === true || r.IsActiveEntity === false;
    const activeIds = rows.filter(r => !isDraft(r)).map(r => r.ID);
    const draftIds  = rows.filter(isDraft).map(r => r.ID);

    // Every line of every invoice on the page, from the table it actually lives in.
    const lines = [];
    if (activeIds.length) lines.push(...await cds.db.run(SELECT.from(ITEMS)
        .columns('ID', ...LINE_BASE).where({ invoice_ID: { in: activeIds } })));
    if (draftIds.length) {
        const src = opts.draftItems || ITEMS;
        lines.push(...await cds.db.run(SELECT.from(src)
            .columns('ID', ...LINE_BASE).where({ invoice_ID: { in: draftIds } })));
    }
    const computed = await computeLines(lines);

    const byInv = new Map();
    for (const c of computed.values()) {
        if (!byInv.has(c.invoice_ID)) byInv.set(c.invoice_ID, []);
        byInv.get(c.invoice_ID).push(c);
    }

    // The header's own figures - re-read for the same $select reason, and
    // from the draft table where the invoice is a draft.
    const HEAD = ['ID', 'status', 'received_date', 'created_at',
                  'net_amount', 'tax_amount', 'gross_amount'];
    const heads = [];
    if (activeIds.length) heads.push(...await cds.db.run(SELECT.from(INVS)
        .columns(...HEAD).where({ ID: { in: activeIds } })));
    if (draftIds.length && opts.draftInvoices) heads.push(...await cds.db.run(SELECT.from(opts.draftInvoices)
        .columns(...HEAD).where({ ID: { in: draftIds } })));
    const headById = new Map(heads.map(h => [h.ID, h]));

    for (const row of rows) {
        const ls = byInv.get(row.ID) || [];
        const h = headById.get(row.ID) || row;

        row.total_lines = ls.length;
        row.reconciled_lines = ls.filter(l => l.resolved).length;
        row.unreconciled_lines = ls.length - row.reconciled_lines;

        // LITRES, like the lines beneath (Sep 2026). The kilogram totals came
        // off this view with the kilogram comparison: two units on one screen
        // is how a reader ends up comparing one against the other.
        const invL   = total(ls, l => l._invL);
        const invAmt = total(ls, l => l._invAmt);
        const tktL   = total(ls, l => l._tktL);
        const tktAmt = total(ls, l => l._tktAmt);

        row.total_inv_qty_ltr = kg(invL);
        row.total_inv_amount = money(invAmt);
        row.total_tkt_qty_ltr = kg(tktL);
        row.total_tkt_amount = money(tktAmt);

        const wi = ls.filter(l => l._invL && l._invAmt !== null);
        const wiL = total(wi, l => l._invL);
        row.wavg_inv_rate = wiL ? r4(total(wi, l => l._invAmt) / wiL) : null;
        const wt = ls.filter(l => l._tktL && l._tktAmt !== null);
        const wtL = total(wt, l => l._tktL);
        row.wavg_tkt_rate = wtL ? r4(total(wt, l => l._tktAmt) / wtL) : null;

        // VALUE VARIANCE: the lines' total price against the tickets' total
        // price. Additive with the two totals shown beside it.
        row.variance_value = (invAmt !== null && tktAmt !== null) ? money(invAmt - tktAmt) : null;

        // QTY VARIANCE, IN LITRES as asked - invoiced litres less metered
        // litres. Over the lines that carry BOTH, so an unresolved line does
        // not report its whole volume as a shortfall.
        const both = ls.filter(l => l._invL !== null && l._tktL !== null);
        row.qty_variance_ltr = both.length
            ? kg(total(both, l => l._invL) - total(both, l => l._tktL)) : null;

        // ---- STATED AGAINST DERIVED ----------------------------------------
        // Entered = what the clerk typed in Amount Details, off the supplier's
        // invoice. Derived = what the lines add up to. Shown side by side and
        // read-only; the difference is the finding. The entered figures are
        // COPIED into read-only virtuals, because the same field cannot be an
        // input in one section and read-only in another.
        const eNet = num(h.net_amount), eTax = num(h.tax_amount), eGross = num(h.gross_amount);
        const dNet = total(ls, l => l._invAmt);
        const dTax = total(ls, l => l._tax);
        const dGross = (dNet !== null || dTax !== null) ? (dNet || 0) + (dTax || 0) : null;
        row.entered_net_v   = money(eNet);
        row.entered_tax_v   = money(eTax);
        row.entered_gross_v = money(eGross);
        row.derived_net     = money(dNet);
        row.derived_tax     = money(dTax);
        row.derived_gross   = money(dGross);
        row.net_difference   = (eNet !== null && dNet !== null) ? money(eNet - dNet) : null;
        row.gross_difference = (eGross !== null && dGross !== null) ? money(eGross - dGross) : null;

        // One flight if every line agrees, blank otherwise - decision Q1.
        const flightIds = new Set(ls.map(l => l._flightId));
        const one = (flightIds.size === 1 && !flightIds.has(null)) ? ls[0] : null;
        row.flight_number_v = one ? one.flight_number_v : null;
        row.flight_date_v   = one ? one.flight_date_v : null;
        row.dep_airport     = one ? one.dep_airport : null;
        row.arr_airport     = one ? one.arr_airport : null;
        row.flight_status_v = one ? one.flight_status_v : null;

        const anyOver = ls.some(l => l.tolerance_status === 'EXCEEDED');
        const allIn = ls.length > 0 && ls.every(l => l.tolerance_status === 'WITHIN');
        const tol = anyOver ? 'EXCEEDED' : (allIn ? 'WITHIN' : null);
        if ('tolerance_status' in row && row.tolerance_status == null) row.tolerance_status = tol;
        row.tolerance_v = tol === 'EXCEEDED' ? 'Exceeded' : (tol === 'WITHIN' ? 'Within' : null);

        // MATCH STATUS IS NOT OVERRIDDEN HERE, deliberately. Its colour
        // (matchingCriticality) is computed in SQL from the STORED value, so
        // showing a derived status on read painted one status's text in
        // another's colour - caught by fim-reconcile EXIT-3. It is calculated
        // and STORED when the invoice is saved or validated instead, which is
        // also when it becomes knowable: it depends on each line resolving to
        // its ticket, and resolution happens in those checks.

        row.invoice_status_v = statusDisplay(h.status);
        row.received_date_v = h.received_date ||
            (h.created_at ? String(h.created_at).slice(0, 10) : null);
    }
}

module.exports = {
    computeLines, applyLineSummary, applyHeaderSummary,
    statusDisplay, toleranceDisplay
};

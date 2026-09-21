/**
 * FuelSphere - the invoice header and line item views (WP-36, WP-37).
 *
 * THE LINE IS WHERE THE COMPARISON LIVES; THE HEADER IS ITS SUM. Every figure
 * on the header view is an aggregate of the line figures below it, computed
 * once here so the two views cannot disagree about the same invoice.
 *
 * KILOGRAMS ON BOTH SIDES - decision Q3. Invoice quantity arrives in the
 * line's uom_code, usually litres; the ticket's comparable figure is mass.
 * The invoice volume is converted at THE TICKET'S OWN density (its mass over
 * its metered litres), because that is the density the fuel was actually
 * delivered at. A planning density would manufacture a variance out of the
 * difference between two densities rather than between two quantities.
 *
 * THE THREE VARIANCES ADD UP, and are defined so that they must:
 *
 *   total   = invoice amount - ticket amount                    money
 *   qty     = invoice kg     - ticket kg                        kg
 *   price   = (invoice rate - ticket rate) x invoice kg         money
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
                   'net_amount', 'flight_ID', 'ticket_quantity_kg', 'ticket_rate',
                   'ticket_amount', 'review_status'];

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
async function computeLines(lines) {
    const out = new Map();
    const rows = lines.filter(r => r && r.ID);
    if (!rows.length) return out;

    // ---- base columns, whatever the client selected -------------------
    const base = new Map(rows.map(r => [r.ID, Object.fromEntries(LINE_BASE.map(k => [k, r[k]]))]));
    const gaps = rows.filter(r => LINE_BASE.some(k => r[k] === undefined));
    if (gaps.length) {
        const stored = await cds.db.run(SELECT.from(ITEMS).columns('ID', ...LINE_BASE)
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
        const invRate = (invAmt !== null && invKg) ? invAmt / invKg : null;

        // The three variances. Only where both sides exist - a line that
        // resolved to no ticket has no comparison, and zero would claim one.
        const totalVar = (invAmt !== null && tktAmt !== null) ? invAmt - tktAmt : null;
        const qtyVarKg = (invKg !== null && tktKg !== null) ? invKg - tktKg : null;
        const priceVar = (invRate !== null && tktRate !== null && invKg !== null)
            ? (invRate - tktRate) * invKg : null;

        // Percentages for the tolerance bands - relative to the TICKET, the
        // reference the invoice is being checked against.
        const qtyPct   = (qtyVarKg !== null && tktKg) ? (qtyVarKg / tktKg) * 100 : null;
        const pricePct = (invRate !== null && tktRate) ? ((invRate - tktRate) / tktRate) * 100 : null;

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
            // both sides, in the same units
            inv_qty_kg: kg(invKg),
            inv_rate_kg: r4(invRate),
            ticket_quantity_kg: kg(tktKg),
            ticket_rate: r4(tktRate),
            ticket_amount: money(tktAmt),
            // the three variances
            total_variance: money(totalVar),
            qty_variance_kg: kg(qtyVarKg),
            price_variance: money(priceVar),
            // the two axes, and their merge
            tolerance_status: tol,
            tolerance_breach: breach,
            tolerance_v: toleranceDisplay(tol, b.review_status || 'NONE'),
            // raw, for the header rollup
            _invKg: invKg, _invAmt: invAmt, _tktKg: tktKg, _tktAmt: tktAmt,
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
async function applyLineSummary(data) {
    const rows = (Array.isArray(data) ? data : [data]).filter(r => r && r.ID);
    if (!rows.length) return;
    const computed = await computeLines(rows);
    for (const row of rows) {
        const c = computed.get(row.ID);
        if (!c) continue;
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

/** After-READ for Invoices (active and draft): the header is the sum of its lines. */
async function applyHeaderSummary(data) {
    const rows = (Array.isArray(data) ? data : [data]).filter(r => r && r.ID);
    if (!rows.length) return;

    // Every line of every invoice on the page, in one read.
    const lines = await cds.db.run(SELECT.from(ITEMS)
        .columns('ID', ...LINE_BASE).where({ invoice_ID: { in: rows.map(r => r.ID) } }));
    const computed = await computeLines(lines);

    const byInv = new Map();
    for (const c of computed.values()) {
        if (!byInv.has(c.invoice_ID)) byInv.set(c.invoice_ID, []);
        byInv.get(c.invoice_ID).push(c);
    }

    // The header's own status and dates. Re-read, same $select reason.
    const heads = await cds.db.run(SELECT.from(INVS)
        .columns('ID', 'status', 'received_date', 'created_at')
        .where({ ID: { in: rows.map(r => r.ID) } }));
    const headById = new Map(heads.map(h => [h.ID, h]));

    for (const row of rows) {
        const ls = byInv.get(row.ID) || [];
        const h = headById.get(row.ID) || {};

        row.total_lines = ls.length;
        row.reconciled_lines = ls.filter(l => l.resolved).length;
        row.unreconciled_lines = ls.length - row.reconciled_lines;

        const invKg  = total(ls, l => l._invKg);
        const invAmt = total(ls, l => l._invAmt);
        const tktKg  = total(ls, l => l._tktKg);
        const tktAmt = total(ls, l => l._tktAmt);

        row.total_inv_qty_kg = kg(invKg);
        row.total_inv_amount = money(invAmt);
        row.total_tkt_qty_kg = kg(tktKg);
        row.total_tkt_amount = money(tktAmt);

        // Weighted by the lines that carry BOTH halves of their own ratio -
        // a line with an amount and no mass would drag the average toward
        // zero without being a price at all.
        const wi = ls.filter(l => l._invKg && l._invAmt !== null);
        const wiKg = total(wi, l => l._invKg);
        row.wavg_inv_rate = wiKg ? r4(total(wi, l => l._invAmt) / wiKg) : null;
        const wt = ls.filter(l => l._tktKg && l._tktAmt !== null);
        const wtKg = total(wt, l => l._tktKg);
        row.wavg_tkt_rate = wtKg ? r4(total(wt, l => l._tktAmt) / wtKg) : null;

        // Additive with the two totals shown beside it: an unreconciled line's
        // whole amount IS variance, and the unreconciled count says why.
        row.variance_value = (invAmt !== null && tktAmt !== null) ? money(invAmt - tktAmt) : null;

        // One flight if every line agrees, blank otherwise - decision Q1.
        const flightIds = new Set(ls.map(l => l._flightId));
        const one = (flightIds.size === 1 && !flightIds.has(null)) ? ls[0] : null;
        row.flight_number_v = one ? one.flight_number_v : null;
        row.flight_date_v   = one ? one.flight_date_v : null;
        row.dep_airport     = one ? one.dep_airport : null;
        row.arr_airport     = one ? one.arr_airport : null;
        row.flight_status_v = one ? one.flight_status_v : null;

        // EXCEEDED if any line is; WITHIN only if every line was assessed and
        // held. An unassessed line means the invoice is not fully checked,
        // and claiming WITHIN over it would be a pass nobody earned.
        const anyOver = ls.some(l => l.tolerance_status === 'EXCEEDED');
        const allIn = ls.length > 0 && ls.every(l => l.tolerance_status === 'WITHIN');
        const tol = anyOver ? 'EXCEEDED' : (allIn ? 'WITHIN' : null);
        if ('tolerance_status' in row && row.tolerance_status == null) row.tolerance_status = tol;
        row.tolerance_v = tol === 'EXCEEDED' ? 'Exceeded' : (tol === 'WITHIN' ? 'Within' : null);

        row.invoice_status_v = statusDisplay(h.status);
        row.received_date_v = h.received_date ||
            (h.created_at ? String(h.created_at).slice(0, 10) : null);
    }
}

module.exports = {
    computeLines, applyLineSummary, applyHeaderSummary,
    statusDisplay, toleranceDisplay
};

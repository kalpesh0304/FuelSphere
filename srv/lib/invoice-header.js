/**
 * FuelSphere - the invoice header's derived fields.
 *
 * Three rules the invoice object page applies as the clerk works: the payment
 * terms follow the supplier, the due date follows the terms, and the match
 * status follows the lines. Pure functions, so each can be tested without a
 * database - the service handlers only read and write around them.
 */

/**
 * Days in an SAP-style payment terms code.
 *
 * The suppliers carry codes like NT30 and NT45 - "net 30 days" - and there is
 * no payment terms master to look them up in. The number of days is written
 * into the code itself, so it is read from there: the trailing digits.
 *
 * Returns null for a code with no number in it, rather than guessing a
 * default. A due date computed from an invented 30 days is a wrong date that
 * looks right; a blank one sends someone to check the terms.
 *
 * @param {string} code   e.g. 'NT30'
 * @returns {number|null}
 */
function paymentTermDays(code) {
    if (!code) return null;
    const m = /(\d+)\s*$/.exec(String(code).trim());
    if (!m) return null;
    const days = Number(m[1]);
    return Number.isFinite(days) && days >= 0 && days <= 365 ? days : null;
}

/**
 * Invoice date plus the terms' days, as an ISO date.
 *
 * Calendar days, counted from the invoice date - the plain reading of "net
 * 30". SAP can also count from a baseline date or roll to month end; neither
 * is configured here, so neither is assumed.
 */
function dueDateFor(invoiceDate, terms) {
    const days = paymentTermDays(terms);
    if (!invoiceDate || days === null) return null;
    const d = new Date(`${String(invoiceDate).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/**
 * The invoice's match status, from its lines.
 *
 * Built from each line's own verdict (invoice-summary.js computeLines), so the
 * header can never contradict the lines beneath it:
 *
 *   no lines                       UNMATCHED
 *   none resolved to a ticket      UNMATCHED
 *   some resolved, some not        PARTIAL_MATCH
 *   any line breached quantity AND
 *     any breached price           EXCEPTION
 *   any breached quantity only     QTY_VARIANCE
 *   any breached price only        PRICE_VARIANCE
 *   every line assessed and within MATCHED
 *   resolved, but not all assessed PARTIAL_MATCH
 *
 * That last row is deliberate. A line whose ticket was never priced cannot be
 * checked for price, and calling the invoice MATCHED over it would be a pass
 * nobody earned - the same reason tolerance has no default.
 *
 * @param {object[]} lines  computed lines: resolved, tolerance_status, tolerance_breach
 */
function deriveMatchStatus(lines) {
    if (!lines || !lines.length) return 'UNMATCHED';
    const resolved = lines.filter(l => l.resolved);
    if (!resolved.length) return 'UNMATCHED';
    if (resolved.length < lines.length) return 'PARTIAL_MATCH';

    const qty   = lines.some(l => l.tolerance_breach === 'QUANTITY' || l.tolerance_breach === 'BOTH');
    const price = lines.some(l => l.tolerance_breach === 'PRICE'    || l.tolerance_breach === 'BOTH');
    if (qty && price) return 'EXCEPTION';
    if (qty)   return 'QTY_VARIANCE';
    if (price) return 'PRICE_VARIANCE';

    return lines.every(l => l.tolerance_status === 'WITHIN') ? 'MATCHED' : 'PARTIAL_MATCH';
}

module.exports = { paymentTermDays, dueDateFor, deriveMatchStatus };

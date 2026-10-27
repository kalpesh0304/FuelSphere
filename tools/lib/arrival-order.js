/**
 * FuelSphere - validate invoices in the order they ARRIVED, where a duplicate
 * came later. Used by tools/seed-idr-rule-status.js, which writes the seeded
 * verdicts, and by the harnesses that compare the seed with the computation,
 * so both sides apply one rule rather than two copies of it.
 *
 * WHY. INV473 (same number, same vendor) and INV455 (same ticket, same
 * charge) are symmetric: run against an original AFTER its duplicate exists,
 * they gate the original too (scenario Finding F6). In the running system the
 * original was validated when it arrived, before the duplicate did, and is not
 * validated again - so its verdict is the one computed then. Re-validating
 * every invoice against the whole seed computes a state that never existed.
 *
 * THE RULE. An invoice with a counterpart (same supplier and number, or a line
 * on the same ticket and charge) that ARRIVED STRICTLY LATER is validated with
 * that counterpart out of the database, and the counterpart is put back
 * unchanged. Arrival is received_date, else the date of created_at.
 *
 * A TIE IS NOT AN ORDER. Counterparts that arrived on the same day, or carry
 * no date, see each other exactly as a plain run would - the baseline's
 * deliberately seeded duplicate pairs keep both halves gated.
 */

/** invoice ID -> Set of counterpart IDs that arrived strictly later. */
async function laterCounterparts(db, SELECT) {
    const heads = await db.run(SELECT.from('fuelsphere.INVOICES')
        .columns('ID', 'invoice_number', 'supplier_ID', 'received_date', 'created_at'));
    const items = await db.run(SELECT.from('fuelsphere.INVOICE_ITEMS')
        .columns('invoice_ID', 'ticket_ID', 'ticket_number', 'charge_type'));
    const arrival = new Map(heads.map(h => [h.ID,
        String(h.received_date || h.created_at || '').slice(0, 10)]));
    const groups = new Map();
    const join = (key, id) => { if (!groups.has(key)) groups.set(key, new Set()); groups.get(key).add(id); };
    for (const h of heads) join(`N|${h.supplier_ID}|${h.invoice_number}`, h.ID);
    for (const it of items) {
        const t = it.ticket_ID || (it.ticket_number || '').trim();
        if (t) join(`T|${t}|${it.charge_type || 'FUEL'}`, it.invoice_ID);
    }
    const later = new Map();
    for (const ids of groups.values()) {
        if (ids.size < 2) continue;
        for (const a of ids) for (const b of ids) {
            const ta = arrival.get(a), tb = arrival.get(b);
            if (a !== b && ta && tb && tb > ta) {
                if (!later.has(a)) later.set(a, new Set());
                later.get(a).add(b);
            }
        }
    }
    return later;
}

/** Run fn() with the given invoices (header and lines) out of the database. */
async function withoutInvoices(db, { SELECT, INSERT, DELETE }, ids, fn) {
    ids = [...ids];
    const heads = await db.run(SELECT.from('fuelsphere.INVOICES').where({ ID: { in: ids } }));
    const items = await db.run(SELECT.from('fuelsphere.INVOICE_ITEMS').where({ invoice_ID: { in: ids } }));
    await db.run(DELETE.from('fuelsphere.INVOICE_ITEMS').where({ invoice_ID: { in: ids } }));
    await db.run(DELETE.from('fuelsphere.INVOICES').where({ ID: { in: ids } }));
    try {
        return await fn();
    } finally {
        if (heads.length) await db.run(INSERT.into('fuelsphere.INVOICES').entries(heads));
        if (items.length) await db.run(INSERT.into('fuelsphere.INVOICE_ITEMS').entries(items));
    }
}

/**
 * Validate every invoice once, in arrival order where a duplicate came later.
 * validate(id) is the caller's own call - the service in-process, or the
 * OData action over HTTP in a harness. Returns the invoice numbers that were
 * validated before a later counterpart, so the caller can report them.
 */
async function validateAll(db, ql, invoices, validate) {
    const later = await laterCounterparts(db, ql.SELECT);
    const early = [];
    for (const inv of invoices) {
        if (later.has(inv.ID)) {
            await withoutInvoices(db, ql, later.get(inv.ID), () => validate(inv));
            early.push(inv.invoice_number || inv.ID);
        } else {
            await validate(inv);
        }
    }
    return early;
}

module.exports = { laterCounterparts, withoutInvoices, validateAll };

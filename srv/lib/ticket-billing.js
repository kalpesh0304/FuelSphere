const cds = require('@sap/cds');
const { SELECT } = cds.ql;

/**
 * FuelSphere - who sold the fuel on a ticket, and where it was billed.
 *
 * READ AT READ TIME, NOT STORED. The supplier belongs to the order and the
 * invoice line belongs to the invoice; copying either onto the ticket would
 * leave it asserting something the source has since corrected - a supplier
 * renamed, an invoice line moved, a ticket re-matched. The ticket is the
 * physical record of an uplift and owns none of that.
 *
 * THE BILLING STATE IS THE SAME RULE UNBILLED_TICKETS USES, deliberately, so
 * the ticket screen and the un-invoiced report cannot disagree:
 *
 *   BILLED      an invoice line references this ticket
 *   UNBILLED    no invoice line, but the ticket has an order
 *   UNBILLABLE  no invoice line AND no order - nothing to match against, ever
 *
 * A TICKET WITH TWO INVOICE LINES USED TO BE WRONG. Since 7 Oct 2026 it is
 * routine: where a third-party into-plane agent fuels the aircraft, the
 * supplier bills the fuel and the agent bills the uplift, so two lines on two
 * invoices from two vendors are both correct. INV455 is keyed on ticket AND
 * charge to match, and the object page lists every line.
 *
 * THE SCALARS BELOW NAME THE FUEL LINE, DELIBERATELY. They feed the LIST
 * column "Invoice number" and the deep link that opens that invoice, and a
 * ticket is first of all a record of fuel delivered - so the fuel invoice is
 * the one a reader means. This mattered immediately: the agent's lines are
 * numbered from 10 and the fuel lines run to 80, so ordering by line number
 * alone handed the headline to the handling invoice on 716 tickets and pointed
 * the deep link at the wrong document.
 *
 * invoice_count_v still counts ALL lines, and two is no longer a finding by
 * itself - two lines of the SAME charge are, which is INV455's job.
 */

const TICKET_COLUMNS = ['ID', 'order_ID'];

async function applyTicketBilling(rows) {
    const list = (Array.isArray(rows) ? rows : [rows]).filter(r => r && r.ID);
    if (!list.length) return;

    // Re-read the keys the derivation needs: a list report selects the columns
    // it shows, so order_ID arrives undefined on exactly the screens that want
    // the supplier. Same fix the ledger and the invoice views use.
    const ids = list.map(r => r.ID);
    const stored = await cds.db.run(SELECT.from('fuelsphere.FUEL_TICKETS')
        .columns(...TICKET_COLUMNS).where({ ID: { in: ids } }));
    const orderOf = new Map(stored.map(t => [t.ID, t.order_ID]));

    // ---- the supplier, through the order ---------------------------------
    const orderIds = [...new Set(stored.map(t => t.order_ID).filter(Boolean))];
    const orders = orderIds.length
        ? await cds.db.run(SELECT.from('fuelsphere.FUEL_ORDERS')
            .columns('ID', 'supplier_ID').where({ ID: { in: orderIds } }))
        : [];
    const supplierOf = new Map(orders.map(o => [o.ID, o.supplier_ID]));

    const supplierIds = [...new Set(orders.map(o => o.supplier_ID).filter(Boolean))];
    const suppliers = supplierIds.length
        ? await cds.db.run(SELECT.from('fuelsphere.MASTER_SUPPLIERS')
            .columns('ID', 'supplier_name', 's4_vendor_no').where({ ID: { in: supplierIds } }))
        : [];
    const supplierById = new Map(suppliers.map(s => [s.ID, s]));

    // ---- the invoice lines that reference these tickets -------------------
    const lines = await cds.db.run(SELECT.from('fuelsphere.INVOICE_ITEMS')
        .columns('ID', 'ticket_ID', 'invoice_ID', 'line_number', 'charge_type')
        .where({ ticket_ID: { in: ids } }));

    const invoiceIds = [...new Set(lines.map(l => l.invoice_ID).filter(Boolean))];
    const invoices = invoiceIds.length
        ? await cds.db.run(SELECT.from('fuelsphere.INVOICES')
            .columns('ID', 'invoice_number', 'status').where({ ID: { in: invoiceIds } }))
        : [];
    const invoiceById = new Map(invoices.map(i => [i.ID, i]));

    const linesByTicket = new Map();
    for (const l of lines) {
        if (!linesByTicket.has(l.ticket_ID)) linesByTicket.set(l.ticket_ID, []);
        linesByTicket.get(l.ticket_ID).push(l);
    }

    // ---- onto the rows ----------------------------------------------------
    for (const r of list) {
        const orderId = orderOf.get(r.ID) || null;
        const supplier = supplierById.get(supplierOf.get(orderId)) || null;

        r.supplier_name_v = supplier ? supplier.supplier_name : null;
        r.s4_vendor_no_v  = supplier ? supplier.s4_vendor_no : null;

        // FUEL FIRST, THEN BY LINE NUMBER. A null charge counts as fuel: the
        // column was added after 1,776 lines had been captured, and a line
        // that predates it is a fuel line.
        const chargeRank = (l) => ((l.charge_type || 'FUEL') === 'FUEL' ? 0 : 1);
        const own = (linesByTicket.get(r.ID) || [])
            .sort((a, b) => chargeRank(a) - chargeRank(b)
                         || (a.line_number || 0) - (b.line_number || 0));
        const first = own[0] || null;
        const invoice = first ? invoiceById.get(first.invoice_ID) : null;

        r.invoice_count_v  = own.length;
        // THE INVOICE'S KEY, so the link can open THAT invoice rather than a
        // list. Fiori deep-links to an object page when the startup
        // parameters carry the target entity's key; without one it can only
        // open the list report, which is what the ticket's invoice link did
        // until 5 Oct 2026.
        //
        // THE KEY AND NOT THE NUMBER, because the number is not unique. It is
        // unique per SUPPLIER - INV473 exists to enforce exactly that - and
        // the seed deliberately carries a repeated supplier invoice number to
        // prove the check works. A semantic key on the number would open one
        // of two documents on those, with nothing to say which.
        r.invoice_id_v     = invoice ? invoice.ID : null;
        r.invoice_number_v = invoice ? invoice.invoice_number : null;
        r.invoice_line_v   = first ? first.line_number : null;
        r.invoice_status_v = invoice ? invoice.status : null;

        r.billing_status_v = own.length ? 'BILLED' : (orderId ? 'UNBILLED' : 'UNBILLABLE');
    }
}

module.exports = { applyTicketBilling };

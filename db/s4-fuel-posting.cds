namespace fuelsphere;

using { fuelsphere as db } from './schema';

/**
 * FuelSphere - what S/4HANA created for a fuel ticket.
 *
 * RECONSTRUCTED, NOT SUPPLIED. The handover package listed this file and did
 * not contain it; only the service action came with it. Every column below is
 * taken from what srv/lib/s4-fuel-posting.js actually writes - the thirteen
 * that mapPostingResult returns plus the stamp the handler adds - so the model
 * matches the code rather than a second reading of the README.
 *
 * AN EXTEND, SO schema.cds IS UNTOUCHED. FUEL_TICKETS is 180 lines of a 5,000
 * line schema that eighteen services project; adding to it here keeps the
 * integration removable in one file.
 *
 * ---------------------------------------------------------------------------
 * THESE ARE THE SECOND HOME FOR THE PO AND GR NUMBERS, and that is the fact
 * worth knowing before reading further.
 *
 * FUEL_ORDERS.s4_po_number and FUEL_DELIVERIES.s4_gr_number already exist and
 * are filled by a SIMULATION in srv/order-service.js (Math.random, around
 * line 1203). srv/lib/invoice-checks.js resolves every invoice line through
 * them - resolved_po_number from the order, resolved_gr_number from the
 * delivery - and INV464, INV466 and INV474 are built on that resolution.
 *
 * So the ticket's numbers are now the AUTHORITATIVE ones, because S/4 issued
 * them, and the resolution prefers them while still falling back to the
 * order and delivery. The fallback is not politeness: 2,494 seeded invoice
 * lines resolve through order and delivery numbers today, and a hard switch
 * would fail INV464 and INV466 on every one of them. Retiring the simulation
 * is a separate job that needs the seed regenerated with it.
 * ---------------------------------------------------------------------------
 *
 * EVERY COLUMN IS NULLABLE AND NONE HAS A DEFAULT. A ticket that has not been
 * posted must be distinguishable from one that was posted and returned
 * nothing; a default would make the first look like the second. HDI adds
 * these as ALTER TABLE ADD with no data migration.
 */
extend db.FUEL_TICKETS with {

    // ---- the outcome ------------------------------------------------------
    //
    // S complete, P partial, E error - ZFS_S_FUEL_POSTING-STATUS. NULL means
    // never attempted, which is a fourth state and a real one: it is what
    // tells the retry button apart from the posting that failed.
    s4_posting_status    : String(1);

    // The S/4 message, already prefixed with the FuelSphere code for the step
    // that is still missing (INT401 no PO, INT402 no GR, INV406 no invoice).
    // 220 characters because that is BAPI_MSG, and the mapper truncates to it.
    s4_posting_message   : String(220);

    // WHEN, AND NOT WHETHER. Stamped on every attempt including the failures,
    // so "posted an hour ago and still E" is readable - a timestamp written
    // only on success would make a stale error look fresh.
    s4_posted_at         : Timestamp;

    // ---- step 1: the purchase order ---------------------------------------
    //
    // The contract S/4 actually called off against. It can differ from the
    // order's contract: where the payload carries no contract number, S/4
    // picks the valid one for plant and material with open quantity, and
    // which one it chose is a fact worth keeping.
    s4_contract_number   : String(10);

    s4_po_number         : String(10);
    s4_po_item           : String(5);

    // The quantity and unit AS THE PO CARRIES THEM, which is not always what
    // the ticket says. A KG ticket against a contract in litres is converted
    // by S/4 using the density, so this is the figure a buyer reconciling
    // against ME23N will see.
    s4_po_quantity       : Decimal(13,3);
    s4_po_unit           : String(3);

    // ---- step 2: the goods receipt ----------------------------------------
    //
    // The year is part of the key in S/4, not decoration: a material document
    // number is unique only within its year, so MB03 needs both.
    s4_gr_number         : String(10);
    s4_gr_year           : String(4);

    // ---- step 3: the supplier invoice -------------------------------------
    //
    // POSTED FROM THE INVOICES APP, NOT ON TICKET SAVE. Decision of 13 Oct
    // 2026: PO and GR follow the physical uplift and belong to ticket
    // capture, while the invoice follows the supplier's document and belongs
    // to whoever verifies it. InvoiceService.postToS4HANA drives this step.
    //
    // ONE S/4 INVOICE PER TICKET, where a FuelSphere invoice spans many. That
    // asymmetry is why the number lives here and not only on INVOICES: an
    // 80-line invoice produces up to 80 S/4 invoice documents, and a single
    // column on the header could hold only one of them.
    s4_invoice_number    : String(10);
    s4_invoice_year      : String(4);
    s4_invoice_amount    : Decimal(15,3);
    s4_invoice_currency  : String(5);
};

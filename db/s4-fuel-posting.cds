namespace fuelsphere;

using { fuelsphere as db } from './schema';
using { cuid } from '@sap/cds/common';

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

    // ---- WHEN FINANCE SEES IT, which is not when we sent it ----------
    //
    // THE FI DOCUMENT'S POSTING DATE, and it is the date the reconciliation
    // turns on. An uplift flown on 30 September whose goods receipt posts on
    // 2 October belongs to September operationally and to October in the
    // books, and "Posting to subsequent period" on the reconciliation screen
    // is the whole value of that gap.
    //
    // IT IS NOT s4_posted_at. That is when FuelSphere called S/4; this is the
    // date S/4 booked against, and they differ whenever a period is closed, a
    // posting is backdated, or the two systems sit in different time zones at
    // month end - which is precisely when the difference matters.
    //
    // NULL ON EVERY ROW TODAY. ZFS_FUEL_POSTING_SRV does not return it - that
    // is CR-2. The column exists now so the handler has somewhere to put it
    // the day it does, and so the reconciliation can report how many postings
    // it cannot yet place rather than quietly assuming they landed on time.
    s4_fi_posting_date   : Date;

    // ---- EVERY ATTEMPT, NOT JUST THE LATEST --------------------------
    //
    // UNMANAGED, so it adds no column: the reverse of
    // S4_POSTING_ATTEMPTS.ticket below. The fourteen fields above hold the
    // LATEST posting, which is what the card, the list column and the
    // invoice line read. This is how the ticket page reaches the rest -
    // posted, reversed, reposted - which columns cannot express.
    s4_attempts          : Association to many S4_POSTING_ATTEMPTS
                               on s4_attempts.ticket = $self;
};

// ===========================================================================
// S4_POSTING_ATTEMPTS - every posting of a ticket, not just the last one
// ===========================================================================
//
// WHY A TABLE AND NOT MORE COLUMNS. The fourteen s4_* fields above hold ONE
// posting. The business requires a ticket amendment to be reversed in S/4 and
// posted again, and asked that FuelSphere "keep track of all postings
// (multiple posting and reversals) related to a ticket amendment". A ticket
// posted, reversed and reposted has three outcomes and three sets of document
// numbers; columns can hold one.
//
// THE COLUMNS ABOVE STAY, AND STAY AUTHORITATIVE FOR THE SCREEN. They carry
// the LATEST attempt, which is what the ticket page, the list column and the
// invoice line all read today. This table is additive: nothing that renders
// now changes because it exists. The alternative - making those columns a
// projection of this table - would have rewritten five screens to gain
// nothing a reader can see.
//
// ONE ROW PER ATTEMPT, INCLUDING THE FAILURES. An attempt that created
// nothing is the most useful row in the table: it is the one somebody opens
// the error log to understand.
entity S4_POSTING_ATTEMPTS : cuid, db.AuditTrail {
        ticket          : Association to db.FUEL_TICKETS @mandatory;

        // 1, 2, 3 within a ticket, in the order attempted. Not a timestamp:
        // two attempts can land in one second and the order still matters.
        attempt_no      : Integer @mandatory;
        attempted_at    : Timestamp;

        // WHICH POSTING THIS WAS. The uplift's PO+GR, the into-plane agent's
        // service chain, the goods issue from own storage, the supplier
        // invoice, or a reversal of an earlier attempt. One history serves
        // all of them, because a reader asking "what did S/4 do with this
        // ticket" means all of it.
        posting_kind    : String(16);   // UPLIFT | INTO_PLANE | GOODS_ISSUE | INVOICE | REVERSAL

        // S complete, POERR the purchase order failed, GRERR the goods
        // receipt failed, P partial, E error. The two middle values are the
        // ones the business asked for by name.
        outcome         : String(8);
        message         : String(220);

        // ---- what S/4 created on this attempt ---------------------------
        //
        // NULL IS THE NORMAL CASE on most of these: a failed PO leaves every
        // one of them empty, and an uplift posting fills the PO and GR
        // columns and none of the invoice ones.
        company_code    : String(4);
        contract_number : String(10);

        po_number       : String(10);
        po_item         : String(5);
        po_quantity     : Decimal(13,3);
        po_unit         : String(3);

        gr_number       : String(10);
        gr_year         : String(4);

        // THE FI DOCUMENT THE GR CREATES. Asked for explicitly, and not
        // returned by ZFS_FUEL_POSTING_SRV today - see CR-2 in
        // docs/S4_Backend_Change_Requests.md. The column exists now so the
        // handler has somewhere to put it the day the service returns it.
        fi_doc_number   : String(10);
        fi_fiscal_year  : String(4);
        // The date the FI document posted - BUDAT, not the date we called.
        // Same reasoning as s4_fi_posting_date above, and the same CR.
        fi_posting_date : Date;

        // ---- filled by postings this integration cannot make yet --------
        // CR-4 (into-plane service chain) and CR-6 (goods issue from own
        // storage). Declared here rather than added later so the history has
        // one shape across all five posting kinds.
        ses_number      : String(10);
        gi_doc_number   : String(10);
        gi_doc_year     : String(4);

        invoice_number  : String(10);
        invoice_item    : String(6);
        invoice_year    : String(4);
        supplier_invoice_number : String(16);   // XBLNR, 16 characters

        // WHICH ATTEMPT THIS ONE UNDOES. Set only on a REVERSAL, so the
        // history reads as a chain rather than a list: posted, reversed,
        // posted again. Without it nobody can tell which of three postings
        // the reversal cancelled.
        reverses        : Association to S4_POSTING_ATTEMPTS;

        // ---- WHAT WE SENT, added 19 Oct 2026 ----------------------------
        //
        // THE REQUEST, VERBATIM, AS JSON. Until now the only record of what
        // FuelSphere sent S/4 was a line in the Cloud Foundry log, which
        // rotates within hours and needs a CF login to read. The question it
        // answers - "is the posting wrong, or is the master data wrong?" -
        // gets asked days later, by somebody who cannot run `cf logs`.
        //
        // IT IS THE ONE THING THE RESPONSE CANNOT TELL YOU. S/4 answering
        // "contract 7000000033 item 10 has no open quantity" is only half an
        // argument; whether WE should have sent that contract at all is the
        // other half, and it is unanswerable without the payload beside it.
        //
        // NO CREDENTIALS PASS THROUGH HERE. The payload is plant, supplier,
        // material, contract, quantity and dates - master data that every
        // reader of this table can already see on the ticket. The
        // destination's client certificate lives in the BTP destination and
        // never enters the payload, so storing this adds no secret.
        //
        // LargeString, NOT String(n). A payload truncated at some round
        // number is worse than none: it reads as complete and is not.
        request_payload : LargeString;

        // The S/4 messages behind this attempt, in full.
        messages        : Composition of many S4_POSTING_MESSAGES
                              on messages.attempt = $self;
}

// ===========================================================================
// S4_POSTING_MESSAGES - the application log, as S/4 words it
// ===========================================================================
//
// THE BAPI RETURN STRUCTURE, FIELD FOR FIELD. The business asked for an error
// log "similar to the SAP application log", reachable from a tile, showing
// the reason and the resolution. A 220-character message column cannot carry
// that: an SAP message is a type, a class, a number and four variables, and
// it is the class and number that a functional person looks up.
//
// SHAPED FOR WHAT S/4 WILL SEND, NOT FOR WHAT IT SENDS TODAY.
// ZFS_FUEL_POSTING_SRV returns one flat message string right now (CR-2d asks
// for the table). Storing the flat string in msg_text with the rest null
// costs nothing and means this table does not change shape when the service
// starts returning the real thing.
entity S4_POSTING_MESSAGES : cuid {
        attempt     : Association to S4_POSTING_ATTEMPTS @mandatory;
        sequence    : Integer;

        // E error, W warning, I information, S success - as S/4 types them.
        msg_type    : String(1);
        msg_id      : String(20);       // message class, e.g. M8
        msg_number  : String(3);        // e.g. 215
        msg_text    : String(255);

        msg_v1      : String(50);
        msg_v2      : String(50);
        msg_v3      : String(50);
        msg_v4      : String(50);

        // WHICH STEP RAISED IT. The same message class can come from the PO
        // or the invoice, and "where did this fail" is the first question
        // anyone asks of the log.
        step        : String(16);       // PO | GR | FI | SES | GI | INVOICE
}

// ===========================================================================
// AIRCRAFT_FUEL_TYPES - which fuels a tail may take, and when
// ===========================================================================
//
// ASKED FOR ON 19 Oct 2026, and it replaces what was built the day before:
// "Option to have multiple fuel type mapped to each tail. Uplift can happen
// only for fuels types that are allowed to be used for a tail. This needs to
// be time dependent data."
//
// AIRCRAFT_REGISTRATIONS.fuel_type WAS A SINGLE COLUMN, which answered the
// first instruction ("add a Field Fuel Type in Tail Master, map it as JETA1
// of all tails") and cannot answer this one. A column holds one value for all
// time; a tail re-certified for a second fuel next March needs two rows with
// two windows.
//
// THIS TABLE IS THE ONLY SOURCE. The column on the tail master is left in
// place - dropping a column from a deployed HDI container needs a migration
// and is not worth the risk for a field nothing reads - but no code reads it
// any more. It is dead and marked dead, rather than a second truth that can
// drift from this table.
//
// is_default PICKS AMONG SEVERAL. Where a tail is approved for two fuels on
// one date, the uplift's own product decides which was actually taken; where
// the uplift does not say, this is what the posting falls back to. Without
// it, a tail with two approved fuels would make the posting choose, and a
// posting that chooses a material is a posting that can be wrong silently.
entity AIRCRAFT_FUEL_TYPES : cuid, db.AuditTrail {
        // THE REGISTRATION, NOT AN ASSOCIATION. AIRCRAFT_REGISTRATIONS is
        // keyed on `registration` rather than a UUID, and the uplift records
        // a tail by that string too - so this joins the way the data is
        // actually addressed.
        registration   : String(10) @mandatory;

        // The S/4 material, e.g. JETA1. Same convention as the maps: what
        // S/4 will accept, not what MASTER_PRODUCTS happens to carry.
        fuel_type      : String(20) @mandatory;

        valid_from     : Date @mandatory;
        valid_to       : Date;                      // null = open-ended

        // Exactly one default per tail per window - CAR412 refuses a second.
        is_default     : Boolean default false;

        is_active      : Boolean default true;

        // Why this tail may take this fuel: a certification, an STC, an
        // operational approval. The reason somebody will ask for in an audit.
        notes          : String(500);
}

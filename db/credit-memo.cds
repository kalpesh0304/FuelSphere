namespace fuelsphere;

using { fuelsphere as db } from './schema';
using { fuelsphere as dfl } from './defuel';
using { cuid } from '@sap/cds/common';

/**
 * FuelSphere — SUPPLIER CREDIT MEMO (FS-SPEC-CM-001 v0.1)
 *
 * A supplier's credit memo reduces what we owe them. Modelled on MIRO's
 * Credit Memo and Subsequent Credit, kept at BTP level for R1: nothing here
 * calls S/4. See docs/design/Credit_Memo_Service.md for the review of the
 * spec and the service contract a UI5 app builds against.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT HOLD
 *
 *   - A GL account. FuelSphere never determines GL (spec §8); S/4 account
 *     determination does, once posting is wired.
 *   - A fabricated S/4 document number. `s4_document_number` stays null until
 *     a real posting returns one. The FuelSphere number is `document_number`.
 *   - Open amounts. What is still creditable on a reference is DERIVED from
 *     the posted lines every time it is asked, so a reversal undoes it by
 *     construction rather than by a compensating write somebody can forget.
 *
 * Error prefix CRD4xx (business rule) / CRD5xx (technical), new domain,
 * documented in CLAUDE.md section 8.
 */

type CreditMemoType : String(20) enum {
    CreditMemo       = 'CREDIT_MEMO';        // quantity and value reversed
    SubsequentCredit = 'SUBSEQUENT_CREDIT';  // value only
}

type CreditMemoStatus : String(20) enum {
    Draft            = 'DRAFT';
    Parked           = 'PARKED';
    Posted           = 'POSTED';
    PostingAttempted = 'POSTING_ATTEMPTED';  // reserved for the S/4 call; no R1 path writes it
    Paid             = 'PAID';               // reserved for S/4 clearing; no R1 path writes it
    Reversed         = 'REVERSED';
}

type CreditMemoRefType : String(20) enum {
    ExpectedCredit = 'EXPECTED_CREDIT';   // a DEFUEL to a supplier, carrying expected_credit_usd
    FuelTicket     = 'FUEL_TICKET';       // an uplift ticket
    InvoiceLine    = 'INVOICE_LINE';      // the strongest reference: priced, posted, PO-linked
    // There is no separate DEFUEL_TICKET type. A defuel's ticket number is
    // DEFUEL.ticket_number, and the defuel IS the expected credit, so
    // referencing the defuel references its ticket too.
}

type CreditPriceComponent : String(20) enum {
    Base         = 'BASE';
    Differential = 'DIFFERENTIAL';
    IntoPlane    = 'INTO_PLANE';
    Fees         = 'FEES';
}

type ExpectedCreditStatus : String(20) enum {
    Open             = 'OPEN';
    PartiallyCleared = 'PARTIALLY_CLEARED';
    Cleared          = 'CLEARED';
    WrittenOff       = 'WRITTEN_OFF';
}

type CreditExceptionStatus : String(10) enum {
    Open     = 'OPEN';
    Resolved = 'RESOLVED';
}

/** Reason codes — a code list rather than an enum so finance can extend it. */
entity CREDIT_MEMO_REASONS {
    key code               : String(20);
        name               : String(60) @mandatory;
        description        : String(255);
        is_active          : Boolean default true;
}

/**
 * THREE ENUMS THAT HAVE TO BE PICKED FROM, so they are tables.
 *
 * A CDS enum reaches OData as a plain string and Fiori renders a text box for
 * it: the user types CREDIT_MEMO or mistypes it. A value help needs ROWS, so
 * the three enums a user chooses between on the entry screen are mirrored as
 * code lists. The enums stay the contract the service validates against -
 * these are the list the screen offers, and `sort` is the order it offers it
 * in rather than alphabetical.
 */
entity CREDIT_MEMO_TYPE_CODE : db.AuditTrail {
    key code : String(20);
        name : String(60) @mandatory;
        sort : Integer;
}

entity CREDIT_MEMO_REF_TYPE_CODE : db.AuditTrail {
    key code : String(20);
        name : String(60) @mandatory;
        sort : Integer;
}

entity CREDIT_PRICE_COMPONENT_CODE : db.AuditTrail {
    key code : String(20);
        name : String(60) @mandatory;
        sort : Integer;
}

/**
 * EXPECTED CREDITS ARE NOT MODELLED HERE. They already exist: a DEFUEL of type
 * TO_SUPPLIER, once postToSupplier has stated `expected_credit_usd`, IS the
 * expected credit (db/defuel.cds). The vendor is DEFUEL.supplier and the
 * defuel ticket number is DEFUEL.ticket_number.
 *
 * What the defuel does not hold is how far a supplier credit memo has
 * cleared it. That is this table: one row per defuel, a CACHE rewritten from
 * posted credit memo lines on every post and reversal, never edited. It sits
 * beside DEFUEL rather than adding columns to it, because the defuel is
 * another work package's entity.
 *
 * NOT TO BE CONFUSED WITH DEFUEL.write_off_usd. That is the fuel's value
 * less the AGREED credit - what the airline lost on the defuel. This
 * table's shortfall_written_off is the agreed credit less what the supplier
 * ACTUALLY credited, closed off by "Close & write off".
 */
entity DEFUEL_CREDIT_CLEARING {
    key defuel                : Association to dfl.DEFUEL;
        credited_amount       : Decimal(15,2) default 0;
        variance_amount       : Decimal(15,2) default 0;   // within tolerance -> Defuel Credit Variance
        shortfall_written_off : Decimal(15,2) default 0;   // "Close & write off" -> Write-off (Defueling)
        status                : ExpectedCreditStatus default 'OPEN';
        refreshed_at          : Timestamp;
}

extend dfl.DEFUEL with {
        credit_clearing : Association to one DEFUEL_CREDIT_CLEARING on credit_clearing.defuel = $self;
}

entity CREDIT_MEMOS : cuid, db.AuditTrail {
        document_number     : String(40);                   // CM-{supplier}-{YYYYMMDD}-{NNNN}, on first save
        memo_type           : CreditMemoType default 'CREDIT_MEMO' @mandatory;
        status              : CreditMemoStatus default 'DRAFT';

        supplier            : Association to db.MASTER_SUPPLIERS @mandatory;
        supplier_cm_number  : String(30) @mandatory;
        original_invoice    : Association to db.INVOICES;   // optional, F4 on posted invoices

        document_date       : Date @mandatory;
        posting_date        : Date @mandatory;
        company_code        : String(4);
        station_code        : String(3);
        currency_code       : String(3) @mandatory;

        stated_gross_amount : Decimal(15,2) @mandatory;     // as printed by the supplier
        tax_amount          : Decimal(15,2);                // entered; FS calculates no tax (§8)
        lines_amount        : Decimal(15,2) default 0;      // DERIVED: sum of line amounts
        balance             : Decimal(15,2);                // DERIVED: stated − (lines + tax)

        reason              : Association to CREDIT_MEMO_REASONS @mandatory;
        reason_text         : String(500);

        posted_at           : DateTime;
        posted_by           : String(100);
        s4_document_number  : String(10);                   // null until S/4 is wired
        s4_fiscal_year      : String(4);

        reversal_date       : Date;
        reversal_reason     : String(500);
        reversed_at         : DateTime;
        reversed_by         : String(100);

        lines               : Composition of many CREDIT_MEMO_LINES       on lines.memo = $self;
        attachments         : Composition of many CREDIT_MEMO_ATTACHMENTS on attachments.memo = $self;
        log                 : Composition of many CREDIT_MEMO_LOG         on log.memo = $self;
        exceptions          : Association to many CREDIT_MEMO_EXCEPTIONS  on exceptions.memo = $self;
}

entity CREDIT_MEMO_LINES : cuid {
        memo                : Association to CREDIT_MEMOS @mandatory;
        line_number         : Integer;

        reference_type      : CreditMemoRefType @mandatory;
        defuel              : Association to dfl.DEFUEL;          // EXPECTED_CREDIT
        ticket              : Association to db.FUEL_TICKETS;
        invoice_item        : Association to db.INVOICE_ITEMS;
        reference_display   : String(80);                   // DERIVED: the reference's own number

        // WHAT THE USER PICKS BY. A value help bound to defuel_ID shows a
        // GUID, because a generated foreign key is not an annotatable
        // element - the picker binds to the number and brings the key back
        // beside it. One column per reference type, each shown only for its
        // own type, because the three lists have nothing in common.
        defuel_number       : String(30);                   // EXPECTED_CREDIT: DFL-...
        ref_ticket_number   : String(30);                   // FUEL_TICKET
        ref_invoice_number  : String(30);                   // INVOICE_LINE: the invoice
        ref_line_number     : Integer;                      // INVOICE_LINE: its line

        // DERIVED from the reference on save, read-only to the UI
        po_number           : String(10);
        po_item             : String(5);
        flight              : Association to db.FLIGHT_SCHEDULE;
        aircraft_reg        : String(10);
        station_code        : String(3);
        cost_center         : String(10);                   // cost object, as derived

        value_only          : Boolean default false;
        quantity            : Decimal(15,3);
        uom_code            : String(3);
        amount              : Decimal(15,2) @mandatory;
        price_component     : CreditPriceComponent;
        // FOUR, NOT TWO. The line copies the reference's tax code and
        // INVOICE_ITEMS.tax_code was widened to String(4) for V23; copying a
        // four-character code into String(2) truncates it to a code that
        // means something else.
        tax_code            : String(4);
        text                : String(255);

        final_clearing      : Boolean default false;        // expected credit: "Close & write off"
}

entity CREDIT_MEMO_ATTACHMENTS : cuid, db.AuditTrail {
        memo                : Association to CREDIT_MEMOS @mandatory;
        @Core.MediaType: mime_type @Core.ContentDisposition.Filename: file_name
        content             : LargeBinary;
        @Core.IsMediaType
        mime_type           : String(100) default 'application/pdf';
        file_name           : String(255);
}

/** Document log: every state change and every message raised at it. */
entity CREDIT_MEMO_LOG : cuid {
        memo                : Association to CREDIT_MEMOS @mandatory;
        logged_at           : DateTime @cds.on.insert: $now;
        logged_by           : String(100) @cds.on.insert: $user;
        event               : String(20);                   // SAVED, PARKED, POSTED, REVERSED, MESSAGE
        severity            : String(10);                   // INFO, WARNING, ERROR
        code                : String(10);
        message             : String(500);
}

/**
 * The worklist. A credit memo is never held for payment (spec §1): what would
 * have stopped it is recorded here and posting continues.
 */
entity CREDIT_MEMO_EXCEPTIONS : cuid, db.AuditTrail {
        memo                : Association to CREDIT_MEMOS @mandatory;
        line                : Association to CREDIT_MEMO_LINES;
        defuel              : Association to dfl.DEFUEL;
        code                : String(10) @mandatory;
        message             : String(500);
        amount              : Decimal(15,2);
        status              : CreditExceptionStatus default 'OPEN';
        resolution_note     : String(500);
}

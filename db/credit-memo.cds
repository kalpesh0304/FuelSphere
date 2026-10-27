namespace fuelsphere;

using { fuelsphere as db } from './schema';
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
    ExpectedCredit = 'EXPECTED_CREDIT';
    FuelTicket     = 'FUEL_TICKET';
    InvoiceLine    = 'INVOICE_LINE';
    // DEFUEL_TICKET is in the spec and NOT here: nothing on FUEL_TICKETS marks
    // a defuel (00-DECISIONS F26). A defuel is credited through the expected
    // credit it raises until that marker exists.
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
 * Money the airline expects a supplier to credit — a defuel, a known price
 * correction. A receivable in waiting. Cleared by credit memo lines.
 *
 * credited / variance / written_off and status are a CACHE of the posted
 * lines, rewritten by refresh on every post and reversal, never edited.
 */
entity EXPECTED_CREDITS : cuid, db.AuditTrail {
        credit_number      : String(30);
        supplier           : Association to db.MASTER_SUPPLIERS @mandatory;
        currency_code      : String(3) @mandatory;
        station_code       : String(3);
        company_code       : String(4);
        source_type        : String(20) default 'DEFUEL';   // DEFUEL, PRICE_ADJUSTMENT, OTHER
        ticket             : Association to db.FUEL_TICKETS;
        flight             : Association to db.FLIGHT_SCHEDULE;
        aircraft_reg       : String(10);
        quantity           : Decimal(15,3);
        uom_code           : String(3);
        expected_amount    : Decimal(15,2) @mandatory;
        credited_amount    : Decimal(15,2) default 0;
        variance_amount    : Decimal(15,2) default 0;       // "Defuel Credit Variance" — Write-off (Defueling)
        written_off_amount : Decimal(15,2) default 0;
        status             : ExpectedCreditStatus default 'OPEN';
        notes              : String(500);
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
        expected_credit     : Association to EXPECTED_CREDITS;
        ticket              : Association to db.FUEL_TICKETS;
        invoice_item        : Association to db.INVOICE_ITEMS;
        reference_display   : String(80);                   // DERIVED: the reference's own number

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
        tax_code            : String(2);
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
        expected_credit     : Association to EXPECTED_CREDITS;
        code                : String(10) @mandatory;
        message             : String(500);
        amount              : Decimal(15,2);
        status              : CreditExceptionStatus default 'OPEN';
        resolution_note     : String(500);
}

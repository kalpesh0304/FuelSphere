using { fuelsphere as db } from '../db/schema';
using { fuelsphere as cm } from '../db/credit-memo';

/**
 * FuelSphere — Supplier Credit Memo service (FS-SPEC-CM-001).
 *
 * The backend for an independent UI5 app. Non-draft on purpose: a credit
 * memo already has its own working states (DRAFT, PARKED), and an OData draft
 * on top of them would be a second "not yet real" state with different rules.
 * The contract is in docs/design/Credit_Memo_Service.md.
 *
 * BTP LEVEL ONLY. post() writes POSTED and a FuelSphere document number and
 * calls nothing. s4_document_number stays null until S/4 is wired.
 */
@path: '/odata/v4/credit-memo'
@impl: './credit-memo-service.js'
service CreditMemoService {

    type Message : {
        severity : String;    // ERROR, WARNING, INFO
        code     : String;
        message  : String;
        line     : Integer;
    };

    type CheckResult : {
        status   : String;
        balance  : Decimal(15,2);
        canPost  : Boolean;
        messages : array of Message;
    };

    entity CreditMemos as projection on cm.CREDIT_MEMOS {
        *,
        case when balance = 0 then 3 when balance is null then 0 else 1 end as balanceCriticality : Integer,
        case status when 'POSTED' then 3 when 'PAID' then 3 when 'PARKED' then 2
                    when 'POSTING_ATTEMPTED' then 1 when 'REVERSED' then 0 else 0 end as statusCriticality : Integer
    } actions {
        /** Every check, nothing saved. */
        function simulate() returns CheckResult;
        /** Save with errors allowed; messages logged. */
        action park() returns CheckResult;
        /** Errors block; balance must be zero; exceptions go to the worklist and posting continues. */
        action postMemo() returns CheckResult;
        /** MR8M: only POSTED, never PAID. Undoes every FuelSphere update. */
        action reverse(reason : String @mandatory, reversalDate : Date @mandatory) returns CheckResult;
        /** Re-send a POSTING_ATTEMPTED memo. */
        action reprocess() returns CheckResult;
    };

    entity CreditMemoLines as projection on cm.CREDIT_MEMO_LINES {
        *,
        virtual null as open_amount : Decimal(15,2)   // still creditable on the reference, posted lines only
    };

    entity Attachments  as projection on cm.CREDIT_MEMO_ATTACHMENTS;
    @readonly entity Log as projection on cm.CREDIT_MEMO_LOG;

    entity Exceptions as projection on cm.CREDIT_MEMO_EXCEPTIONS actions {
        action resolve(note : String @mandatory) returns Exceptions;
    };

    entity ExpectedCredits as projection on cm.EXPECTED_CREDITS {
        *,
        expected_amount - credited_amount - written_off_amount - variance_amount as open_amount : Decimal(15,2)
    };

    @readonly entity Reasons as projection on cm.CREDIT_MEMO_REASONS;

    // ---- value helps -----------------------------------------------------
    @readonly entity Suppliers as projection on db.MASTER_SUPPLIERS {
        key ID, supplier_code, supplier_name, s4_vendor_no
    };
    @readonly entity Currencies as projection on db.CURRENCY_MASTER;

    /** F4 for "Original Supplier Invoice No." — posted invoices only. */
    @readonly entity PostedInvoices as projection on db.INVOICES {
        key ID, invoice_number, internal_number, supplier, invoice_date,
            currency_code, net_amount, tax_amount, gross_amount, status
    } where status in ('POSTED', 'PAID');

    @readonly entity InvoiceLines as projection on db.INVOICE_ITEMS {
        key ID, invoice, line_number, description, po_number, po_item, quantity,
            uom_code, unit_price, net_amount, tax_code, ticket_number, cost_center, flight
    };

    @readonly entity Flights as projection on db.FLIGHT_SCHEDULE {
        key ID, flight_number, flight_date, aircraft_reg
    };

    @readonly entity FuelTickets as projection on db.FUEL_TICKETS {
        key ID, ticket_number, internal_number, flight, flight_number, aircraft_reg,
            quantity, uom_code, total_amount, currency_code, delivery_timestamp, status
    };

    /**
     * Lines a reference would propose, for the UI to tick and POST.
     * referenceType EXPECTED_CREDIT / FUEL_TICKET take that record's ID;
     * INVOICE takes an invoice ID and proposes its lines (as INVOICE_LINE);
     * INVOICE_LINE takes one line's ID.
     */
    function proposeLines(referenceType : String, referenceId : UUID, memoType : String) returns array of {
        reference_type    : String;
        reference_id      : UUID;
        reference_display : String;
        quantity          : Decimal(15,3);
        uom_code          : String;
        amount            : Decimal(15,2);
        open_amount       : Decimal(15,2);
        tax_code          : String;
        po_number         : String;
        flight_number     : String;
        aircraft_reg      : String;
    };

    /** List-report mass action. One result per memo; one failure stops none of the others. */
    action massPost(memos : many UUID) returns array of {
        ID      : UUID;
        status  : String;
        ok      : Boolean;
        message : String;
    };
}

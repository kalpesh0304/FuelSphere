using { fuelsphere as db } from '../db/schema';
using { fuelsphere as cm } from '../db/credit-memo';
using { fuelsphere as dfl } from '../db/defuel';

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

    // open_amount is computed after READ, so it has no column: a $filter or
    // $orderby on it would be a 500. Withheld here, beside the declaration,
    // as srv/virtual-restrictions.cds does for the rest of the model.
    @Capabilities.FilterRestrictions.NonFilterableProperties: [open_amount]
    @Capabilities.SortRestrictions.NonSortableProperties: [open_amount]
    entity CreditMemoLines as projection on cm.CREDIT_MEMO_LINES {
        *,
        virtual null as open_amount : Decimal(15,2)   // still creditable on the reference, posted lines only
    };

    entity Attachments  as projection on cm.CREDIT_MEMO_ATTACHMENTS;
    @readonly entity Log as projection on cm.CREDIT_MEMO_LOG;

    entity Exceptions as projection on cm.CREDIT_MEMO_EXCEPTIONS actions {
        action resolve(note : String @mandatory) returns Exceptions;
    };

    /**
     * EXPECTED CREDITS ARE DEFUELS TO A SUPPLIER with a credit stated by
     * postToSupplier (DefuelService). Read-only here: the defuel app owns
     * them. Clearing comes from DEFUEL_CREDIT_CLEARING, OPEN where no posted
     * credit memo has touched the defuel yet.
     */
    @readonly entity ExpectedCredits as select from dfl.DEFUEL {
        key ID,
            defuel_id,
            ticket_number,                          // the defuel ticket
            supplier,
            supplier_name,
            station_code,
            tail_number,
            flight_number,
            defuel_date,
            quantity_l,
            expected_credit_usd                                     as expected_amount       : Decimal(15,2),
            'USD'                                                   as currency_code         : String(3),
            status                                                  as defuel_status         : String(16),
            coalesce(credit_clearing.status, 'OPEN')                as credit_status         : String(20),
            coalesce(credit_clearing.credited_amount, 0)            as credited_amount       : Decimal(15,2),
            coalesce(credit_clearing.variance_amount, 0)            as variance_amount       : Decimal(15,2),
            coalesce(credit_clearing.shortfall_written_off, 0)      as shortfall_written_off : Decimal(15,2),
            // ROUND because SQLite holds decimals as floats: 448.55 less its
            // three parts reads 4e-14, not 0, and a UI shows that.
            round(expected_credit_usd - coalesce(credit_clearing.credited_amount, 0)
                - coalesce(credit_clearing.variance_amount, 0)
                - coalesce(credit_clearing.shortfall_written_off, 0), 2) as open_amount      : Decimal(15,2)
    } where defuel_type = 'TO_SUPPLIER' and status in ('POSTING_PENDING', 'POSTED');

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

using { CreditMemoService } from './credit-memo-service';

/**
 * Credit Memo — the screen.
 *
 * ===========================================================================
 * THE BACKEND CAME FIRST AND IT ALREADY DECIDED THINGS. statusCriticality and
 * balanceCriticality are computed in the projection, and open_amount is
 * withheld from $filter and $orderby because it is filled after READ. This
 * file uses those rather than inventing its own - a second opinion about what
 * colour POSTED is would be a second answer to one question.
 *
 * WHAT A CREDIT MEMO IS: a vendor says they owe the airline money back. The
 * memo states a gross amount, the lines say what it is FOR, and the two must
 * agree before it can post. `balance` is the disagreement, and it being zero
 * is the whole gate - which is why it is on the list, in the header, and
 * coloured in all three places.
 *
 * FIVE ACTIONS, TWO OF WHICH NEED MORE THAN AN ANNOTATION:
 *
 *   simulate   runs every check and saves NOTHING. Its answer is the point,
 *              so it must be SHOWN. Fiori renders an action's return value
 *              only if the action is annotated to; a toast saying "Simulate
 *              executed" would discard the only thing it produced.
 *   reverse    takes a reason and a date, so it opens a dialog. Fiori builds
 *              that automatically from the action's parameters.
 *
 * park, postMemo and reprocess take nothing and act in place.
 *
 * REPROCESS IS HIDDEN UNLESS POSTING WAS ATTEMPTED. It re-sends a memo S/4
 * never confirmed; offering it on a draft invites somebody to press it. The
 * other four are hidden on the statuses they cannot act on for the same
 * reason - a Reverse button on an unposted memo is a question with no answer.
 *
 * ENTERED HERE SINCE 29 OCT 2026, not only read. That changes what the file
 * has to carry:
 *
 *   PICKERS FOR WHAT A LINE CREDITS. A line refers to an expected credit, a
 *   fuel ticket or an invoice line, and until now none of the three had a
 *   value help - a screen that could not name a reference could not enter a
 *   memo. Each is bound to the READABLE number and brings the key back
 *   beside it, because a value help on a generated foreign key shows a GUID.
 *
 *   ONE PICKER VISIBLE AT A TIME. The three lists have nothing in common, so
 *   each is hidden unless its own reference type is chosen - the same
 *   treatment the defueling screen gives its flight fields.
 *
 *   SIDE EFFECTS, OR THE DERIVED FIELDS NEVER ARRIVE. Picking a reference
 *   fills the PO, the tail, the cost object, the quantity and the amount on
 *   the server, and Fiori will not re-read any of it unless told. A line
 *   amount also moves the memo's balance, which lives on the PARENT, so that
 *   side effect names the memo as a target entity rather than a property.
 *   This pattern has cost a defect three times in this codebase.
 * ===========================================================================
 */
annotate CreditMemoService.CreditMemos with @(

    UI: {
        SelectionFields: [
            document_number, supplier_cm_number, memo_type, status,
            supplier_ID, document_date, posting_date, station_code
        ],

        LineItem: [
            { Value: document_number,     Label: 'Memo No.',        ![@UI.Importance]: #High },
            { Value: supplier_cm_number,  Label: 'Vendor CM No.',   ![@UI.Importance]: #High },
            { Value: memo_type,           Label: 'Type',            ![@UI.Importance]: #Medium },
            { Value: supplier_ID,         Label: 'Vendor',          ![@UI.Importance]: #High },
            { Value: document_date,       Label: 'Document Date',   ![@UI.Importance]: #Medium },
            { Value: posting_date,        Label: 'Posting Date',    ![@UI.Importance]: #Medium },
            { Value: stated_gross_amount, Label: 'Stated Gross',    ![@UI.Importance]: #High },
            { Value: lines_amount,        Label: 'Lines',           ![@UI.Importance]: #Medium },
            // THE GATE, COLOURED. A memo posts only when the lines account
            // for the stated amount; this is the difference, and the backend
            // already says green at zero.
            { Value: balance,             Label: 'Balance',         ![@UI.Importance]: #High,
              Criticality: balanceCriticality },
            { Value: status,              Label: 'Status',          ![@UI.Importance]: #High,
              Criticality: statusCriticality },

            { $Type: 'UI.DataFieldForAction', Action: 'CreditMemoService.simulate',
              Label: 'Simulate',
              ![@UI.Hidden]: { $edmJson: { $Not: { $Or: [ { $Eq: [{ $Path: 'status' }, 'DRAFT'] }, { $Eq: [{ $Path: 'status' }, 'PARKED'] }, { $Eq: [{ $Path: 'status' }, 'POSTING_ATTEMPTED'] } ] } } } },
            // PARK IS A SAVE WITH ERRORS ALLOWED, so it belongs to a memo
            // still being worked and nothing else.
            { $Type: 'UI.DataFieldForAction', Action: 'CreditMemoService.park',
              Label: 'Park',
              ![@UI.Hidden]: { $edmJson: { $Not: { $Or: [ { $Eq: [{ $Path: 'status' }, 'DRAFT'] }, { $Eq: [{ $Path: 'status' }, 'PARKED'] } ] } } } },
            { $Type: 'UI.DataFieldForAction', Action: 'CreditMemoService.postMemo',
              Label: 'Post',
              ![@UI.Hidden]: { $edmJson: { $Not: { $Or: [ { $Eq: [{ $Path: 'status' }, 'DRAFT'] }, { $Eq: [{ $Path: 'status' }, 'PARKED'] }, { $Eq: [{ $Path: 'status' }, 'POSTING_ATTEMPTED'] } ] } } } },
            // ONLY WHAT HAS POSTED CAN BE REVERSED. MR8M says so and so does
            // the service (CRD411) - this stops the button being offered
            // where pressing it is an error.
            { $Type: 'UI.DataFieldForAction', Action: 'CreditMemoService.reverse',
              Label: 'Reverse',
              ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'status' }, 'POSTED'] } } },
            { $Type: 'UI.DataFieldForAction', Action: 'CreditMemoService.reprocess',
              Label: 'Reprocess',
              ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'status' }, 'POSTING_ATTEMPTED'] } } }
        ],

        // ---- the object page --------------------------------------------
        HeaderInfo: {
            TypeName      : 'Credit Memo',
            TypeNamePlural: 'Credit Memos',
            Title         : { Value: document_number },
            Description   : { Value: supplier_cm_number }
        },

        HeaderFacets: [
            { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#HeaderStatus',
              Label: 'Status' },
            { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#HeaderAmounts',
              Label: 'Amounts' }
        ],

        FieldGroup#HeaderStatus: { Data: [
            { Value: status,        Label: 'Status', Criticality: statusCriticality },
            { Value: memo_type,     Label: 'Type' },
            { Value: document_date, Label: 'Document Date' }
        ]},

        FieldGroup#HeaderAmounts: { Data: [
            { Value: stated_gross_amount, Label: 'Stated Gross' },
            { Value: lines_amount,        Label: 'Lines' },
            { Value: balance,             Label: 'Balance', Criticality: balanceCriticality }
        ]},

        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'MemoGeneral',
              Target: '@UI.FieldGroup#General',  Label: 'General' },
            { $Type: 'UI.ReferenceFacet', ID: 'MemoAmounts',
              Target: '@UI.FieldGroup#Amounts',  Label: 'Amounts and reason' },
            // WHAT THE MEMO IS FOR. A memo with no lines has nothing to post.
            { $Type: 'UI.ReferenceFacet', ID: 'MemoLines',
              Target: 'lines/@UI.LineItem',      Label: 'Lines' },
            { $Type: 'UI.ReferenceFacet', ID: 'MemoExceptions',
              Target: 'exceptions/@UI.LineItem', Label: 'Exceptions' },
            { $Type: 'UI.ReferenceFacet', ID: 'MemoAttachments',
              Target: 'attachments/@UI.LineItem', Label: 'Attachments' },
            // THE AUDIT TRAIL, LAST. It is read, not worked.
            { $Type: 'UI.ReferenceFacet', ID: 'MemoLog',
              Target: 'log/@UI.LineItem',        Label: 'Log' },
            { $Type: 'UI.ReferenceFacet', ID: 'MemoReversal',
              Target: '@UI.FieldGroup#Reversal', Label: 'Reversal',
              // ONLY ON A REVERSED MEMO. Four empty fields on every other
              // memo invite somebody to fill them in.
              ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'status' }, 'REVERSED'] } } }
        ],

        FieldGroup#General: { Data: [
            { Value: supplier_ID,        Label: 'Vendor' },
            { Value: supplier_cm_number, Label: 'Vendor CM No.' },
            { Value: memo_type,          Label: 'Type' },
            { Value: original_invoice_ID, Label: 'Original Invoice' },
            { Value: document_date,      Label: 'Document Date' },
            { Value: posting_date,       Label: 'Posting Date' },
            { Value: company_code,       Label: 'Company Code' },
            { Value: station_code,       Label: 'Station' }
        ]},

        FieldGroup#Amounts: { Data: [
            { Value: currency_code,       Label: 'Currency' },
            { Value: stated_gross_amount, Label: 'Stated Gross' },
            { Value: tax_amount,          Label: 'Tax' },
            { Value: lines_amount,        Label: 'Lines' },
            { Value: balance,             Label: 'Balance', Criticality: balanceCriticality },
            { Value: reason_code,         Label: 'Reason' },
            { Value: reason_text,         Label: 'Reason Text' }
        ]},

        FieldGroup#Reversal: { Data: [
            { Value: reversal_date,   Label: 'Reversal Date' },
            { Value: reversal_reason, Label: 'Reversal Reason' },
            { Value: reversed_at,     Label: 'Reversed At' },
            { Value: reversed_by,     Label: 'Reversed By' }
        ]},

        // THE ANSWER SIMULATE PRODUCES HAS TO BE SHOWN. Without this Fiori
        // discards the CheckResult and says only that the action ran, which
        // is the one thing the user did not ask.
        Identification: [
            { $Type: 'UI.DataFieldForAction', Action: 'CreditMemoService.simulate',
              Label: 'Simulate',
              ![@UI.Hidden]: { $edmJson: { $Not: { $Or: [ { $Eq: [{ $Path: 'status' }, 'DRAFT'] }, { $Eq: [{ $Path: 'status' }, 'PARKED'] }, { $Eq: [{ $Path: 'status' }, 'POSTING_ATTEMPTED'] } ] } } } },
            // PARK IS A SAVE WITH ERRORS ALLOWED, so it belongs to a memo
            // still being worked and nothing else.
            { $Type: 'UI.DataFieldForAction', Action: 'CreditMemoService.park',
              Label: 'Park',
              ![@UI.Hidden]: { $edmJson: { $Not: { $Or: [ { $Eq: [{ $Path: 'status' }, 'DRAFT'] }, { $Eq: [{ $Path: 'status' }, 'PARKED'] } ] } } } },
            { $Type: 'UI.DataFieldForAction', Action: 'CreditMemoService.postMemo',
              Label: 'Post',
              ![@UI.Hidden]: { $edmJson: { $Not: { $Or: [ { $Eq: [{ $Path: 'status' }, 'DRAFT'] }, { $Eq: [{ $Path: 'status' }, 'PARKED'] }, { $Eq: [{ $Path: 'status' }, 'POSTING_ATTEMPTED'] } ] } } } },
            // ONLY WHAT HAS POSTED CAN BE REVERSED. MR8M says so and so does
            // the service (CRD411) - this stops the button being offered
            // where pressing it is an error.
            { $Type: 'UI.DataFieldForAction', Action: 'CreditMemoService.reverse',
              Label: 'Reverse',
              ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'status' }, 'POSTED'] } } },
            { $Type: 'UI.DataFieldForAction', Action: 'CreditMemoService.reprocess',
              Label: 'Reprocess',
              ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'status' }, 'POSTING_ATTEMPTED'] } } }
        ]
    }
);

// ===========================================================================
// WHAT MAY BE EDITED, AND WHEN
// ===========================================================================
//
// A POSTED MEMO IS A DOCUMENT, not a form. The service refuses to change one
// (CRD411, and the same guard now sits on EDIT so it refuses before the user
// types rather than after). These two annotations are the screen agreeing
// with it: no Edit button and no Delete button once a memo has left DRAFT or
// PARKED. Reversal is the way back, and it has its own action.
annotate CreditMemoService.CreditMemos with @(
    UI.UpdateHidden: { $edmJson: { $Not: { $Or: [ { $Eq: [{ $Path: 'status' }, 'DRAFT'] }, { $Eq: [{ $Path: 'status' }, 'PARKED'] } ] } } },
    UI.DeleteHidden: { $edmJson: { $Not: { $Or: [ { $Eq: [{ $Path: 'status' }, 'DRAFT'] }, { $Eq: [{ $Path: 'status' }, 'PARKED'] } ] } } }
);

// THE BALANCE HAS THREE TERMS and the user types two of them. Without this
// the screen shows the balance from before the amount was changed, which is
// the one number the whole page is about.
annotate CreditMemoService.CreditMemos with @(
    Common.SideEffects #AmountsChanged: {
        SourceProperties: [ stated_gross_amount, tax_amount ],
        TargetProperties: [ 'balance', 'lines_amount' ]
    },

    // A SUBSEQUENT CREDIT IS VALUE ONLY, so switching the type re-derives
    // every line - the quantity on each of them is dropped.
    Common.SideEffects #MemoTypeChanged: {
        SourceProperties: [ memo_type ],
        TargetProperties: [ 'balance', 'lines_amount' ],
        TargetEntities: [ lines ]
    },

    // Picking the vendor decides which references are creditable at all, so
    // the lines are re-read: a line now belonging to another vendor is
    // CRD404 and the user should see it immediately.
    Common.SideEffects #VendorPicked: {
        SourceProperties: [ supplier_ID ],
        TargetEntities: [ lines ]
    }
);

annotate CreditMemoService.CreditMemos with {
    // NOT @mandatory, DELIBERATELY. The service allocates it when the memo is
    // saved, and CAP input validation runs before any handler could fill it
    // in - a mandatory document number is a memo that can never be saved.
    document_number     @title: 'Memo No.'        @readonly;
    supplier_cm_number  @title: 'Vendor CM No.'   @Common.FieldControl: #Mandatory;
    memo_type           @title: 'Type'            @Common.FieldControl: #Mandatory;
    status              @title: 'Status'          @readonly;
    document_date       @title: 'Document Date'   @Common.FieldControl: #Mandatory;
    posting_date        @title: 'Posting Date'    @Common.FieldControl: #Mandatory;
    company_code        @title: 'Company Code';
    station_code        @title: 'Station';
    currency_code       @title: 'Currency'        @Common.FieldControl: #Mandatory;
    stated_gross_amount @title: 'Stated Gross'    @Common.FieldControl: #Mandatory
                        @Measures.ISOCurrency: currency_code;
    tax_amount          @title: 'Tax'             @Measures.ISOCurrency: currency_code;
    // DERIVED FROM THE LINES, never typed: it is their sum, and a field a
    // user could edit would be a second opinion about what the lines say.
    lines_amount        @title: 'Lines'           @readonly
                        @Measures.ISOCurrency: currency_code;
    balance             @title: 'Balance'         @readonly
                        @Measures.ISOCurrency: currency_code
                        @Common.QuickInfo: 'Stated gross less the lines. A memo posts only when this is zero.';
    reason_text         @title: 'Reason Text'     @UI.MultiLineText;
    posted_at           @title: 'Posted At'       @readonly;
    posted_by           @title: 'Posted By'       @readonly;
    reversal_date       @title: 'Reversal Date'   @readonly;
    reversal_reason     @title: 'Reversal Reason' @readonly;
    reversed_at         @title: 'Reversed At'     @readonly;
    reversed_by         @title: 'Reversed By'     @readonly;
};

// ---- the pickers ------------------------------------------------------
//
// ON THE ASSOCIATION, NOT THE FOREIGN KEY. A generated key is not an
// annotatable element of the CDS model, so a value list on supplier_ID is
// discarded silently and the user is shown a GUID. This cost a deploy on the
// defueling app; it is not repeated here.
annotate CreditMemoService.CreditMemos with {

    // TWO ROWS, SO IT IS A SELECT. An enum reaches OData as a plain string
    // and Fiori gives a string a text box: the user types CREDIT_MEMO, or
    // mistypes it. A dropdown needs rows, which is what MemoTypes is.
    memo_type @(Common: {
        ValueListWithFixedValues: true,
        ValueList: {
            CollectionPath: 'MemoTypes',
            Label: 'Credit memo type',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: memo_type, ValueListProperty: 'code' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' }
            ]
        }
    });

    supplier         @title: 'Vendor'           @Common.FieldControl: #Mandatory;
    original_invoice @title: 'Original Invoice';
    reason           @title: 'Reason'           @Common.FieldControl: #Mandatory;

    supplier @(Common: {
        Text: supplier.supplier_name, TextArrangement: #TextOnly,
        ValueList: {
            CollectionPath: 'Suppliers',
            Label: 'Vendors',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: supplier_ID, ValueListProperty: 'ID' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'supplier_name' }
            ]
        }
    });

    reason @(Common: {
        ValueListWithFixedValues: true,
        ValueList: {
            CollectionPath: 'Reasons',
            Label: 'Reasons',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: reason_code, ValueListProperty: 'code' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' }
            ]
        }
    });

    original_invoice @(Common: {
        ValueList: {
            CollectionPath: 'PostedInvoices',
            Label: 'Posted Invoices',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: original_invoice_ID, ValueListProperty: 'ID' }
            ]
        }
    });
};

// ===========================================================================
// Lines — what the memo is FOR
// ===========================================================================
//
// reference_type IS THE COLUMN THAT MATTERS. A line credits an expected
// credit (a defuel to a supplier), a fuel ticket, or an invoice line, and
// those are three different strengths of evidence. reference_display carries
// the readable identifier so the row does not show a key.
annotate CreditMemoService.CreditMemoLines with @(
    UI: {
        // A LINE IS ENTERED ON ITS OWN PAGE, not in a cell. It has three
        // pickers of which one applies, a quantity, an amount and seven
        // fields derived from whatever it refers to - that is a form, and the
        // table lists them once they exist.
        HeaderInfo: {
            TypeName      : 'Credit Memo Line',
            TypeNamePlural: 'Credit Memo Lines',
            Title         : { Value: reference_display },
            Description   : { Value: reference_type }
        },

        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'LineReference',
              Target: '@UI.FieldGroup#LineReference', Label: 'What this line credits' },
            { $Type: 'UI.ReferenceFacet', ID: 'LineAmount',
              Target: '@UI.FieldGroup#LineAmount',    Label: 'Quantity and amount' },
            // DERIVED, SO SHOWN SEPARATELY. Everything in this group comes
            // from the reference; a user editing any of it would be
            // disagreeing with the document it points at.
            { $Type: 'UI.ReferenceFacet', ID: 'LineDerived',
              Target: '@UI.FieldGroup#LineDerived',   Label: 'From the reference' }
        ],

        FieldGroup#LineReference: { Data: [
            { Value: reference_type,    Label: 'Reference' },
            // ONE OF THE THREE, decided by the reference type. The lists have
            // nothing in common - a defuel number, a ticket number and an
            // invoice line are three different things to look up - so all
            // three fields exist and two of them are always hidden.
            { Value: defuel_number,      Label: 'Expected Credit (Defuel No.)',
              ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'reference_type' }, 'EXPECTED_CREDIT'] } } },
            { Value: ref_ticket_number,  Label: 'Fuel Ticket No.',
              ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'reference_type' }, 'FUEL_TICKET'] } } },
            { Value: ref_invoice_number, Label: 'Invoice No.',
              ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'reference_type' }, 'INVOICE_LINE'] } } },
            { Value: ref_line_number,    Label: 'Invoice Line',
              ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'reference_type' }, 'INVOICE_LINE'] } } },
            { Value: reference_display,  Label: 'Refers To' },
            { Value: open_amount,        Label: 'Still Open' },
            { Value: text,               Label: 'Text' }
        ]},

        FieldGroup#LineAmount: { Data: [
            { Value: value_only,      Label: 'Value Only' },
            { Value: quantity,        Label: 'Quantity' },
            { Value: uom_code,        Label: 'UoM' },
            { Value: amount,          Label: 'Amount' },
            { Value: price_component, Label: 'Component' },
            { Value: tax_code,        Label: 'Tax Code' },
            { Value: final_clearing,  Label: 'Final Clearing' }
        ]},

        FieldGroup#LineDerived: { Data: [
            { Value: po_number,    Label: 'PO No.' },
            { Value: po_item,      Label: 'PO Item' },
            { Value: flight_ID,    Label: 'Flight' },
            { Value: aircraft_reg, Label: 'Tail' },
            { Value: station_code, Label: 'Station' },
            { Value: cost_center,  Label: 'Cost Object' }
        ]},

        LineItem: [
            { Value: line_number,       Label: 'Line',        ![@UI.Importance]: #High },
            { Value: reference_type,    Label: 'Reference',   ![@UI.Importance]: #High },
            { Value: reference_display, Label: 'Refers To',   ![@UI.Importance]: #High },
            { Value: po_number,         Label: 'PO No.',      ![@UI.Importance]: #Low },
            { Value: quantity,          Label: 'Quantity',    ![@UI.Importance]: #Medium },
            { Value: uom_code,          Label: 'UoM',         ![@UI.Importance]: #Low },
            { Value: amount,            Label: 'Amount',      ![@UI.Importance]: #High },
            { Value: open_amount,       Label: 'Still Open',  ![@UI.Importance]: #Medium },
            { Value: price_component,   Label: 'Component',   ![@UI.Importance]: #Low },
            { Value: tax_code,          Label: 'Tax Code',    ![@UI.Importance]: #Low },
            { Value: final_clearing,    Label: 'Final',       ![@UI.Importance]: #Medium },
            { Value: text,              Label: 'Text',        ![@UI.Importance]: #Low }
        ]
    }
);

// ---- what a line refers to, picked rather than typed ---------------------
//
// BOUND TO THE NUMBER, WITH THE KEY BESIDE IT. defuel_ID, ticket_ID and
// invoice_item_ID are generated foreign keys: a value list on one of them is
// discarded by the compiler and the user is shown a GUID. So each picker
// binds to a readable column and carries the key out as a second parameter.
// A number typed rather than picked arrives without the key, and the service
// resolves it - but the picker is what the screen offers.
annotate CreditMemoService.CreditMemoLines with {

    reference_type @(Common: {
        ValueListWithFixedValues: true,
        ValueList: {
            CollectionPath: 'RefTypes',
            Label: 'Reference type',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: reference_type, ValueListProperty: 'code' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' }
            ]
        }
    });

    price_component @(Common: {
        ValueListWithFixedValues: true,
        ValueList: {
            CollectionPath: 'PriceComponents',
            Label: 'Price component',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: price_component, ValueListProperty: 'code' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' }
            ]
        }
    });

    // AN EXPECTED CREDIT IS A DEFUEL TO A SUPPLIER whose credit the vendor has
    // agreed. The list shows what is still open on each, because that is the
    // figure that decides how much this line may credit.
    defuel_number @(Common: {
        ValueList: {
            CollectionPath: 'ExpectedCredits',
            Label: 'Expected credits (defuels to a supplier)',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: defuel_number, ValueListProperty: 'defuel_id' },
                { $Type: 'Common.ValueListParameterOut',
                  LocalDataProperty: defuel_ID, ValueListProperty: 'ID' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'supplier_name' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'station_code' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'defuel_date' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'quantity_l' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'expected_amount' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'open_amount' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'credit_status' }
            ]
        }
    });

    ref_ticket_number @(Common: {
        ValueList: {
            CollectionPath: 'FuelTickets',
            Label: 'Fuel tickets',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: ref_ticket_number, ValueListProperty: 'ticket_number' },
                { $Type: 'Common.ValueListParameterOut',
                  LocalDataProperty: ticket_ID, ValueListProperty: 'ID' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'flight_number' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'aircraft_reg' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'delivery_timestamp' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'quantity' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'total_amount' }
            ]
        }
    });

    // TWO PARAMETERS IN, because an invoice line is identified by its invoice
    // AND its number - line 10 alone names a line on every invoice there is.
    ref_invoice_number @(Common: {
        ValueList: {
            CollectionPath: 'InvoiceLines',
            Label: 'Invoice lines (posted invoices)',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: ref_invoice_number, ValueListProperty: 'invoice_number' },
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: ref_line_number, ValueListProperty: 'line_number' },
                { $Type: 'Common.ValueListParameterOut',
                  LocalDataProperty: invoice_item_ID, ValueListProperty: 'ID' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'description' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'po_number' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'quantity' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'net_amount' }
            ]
        }
    });

    // THE FLIGHT IS SHOWN BY ITS NUMBER. The column is a generated key, so
    // without this the derived group shows the user a GUID.
    flight @(Common: { Text: flight.flight_number, TextArrangement: #TextOnly });
};

// ---- the derived fields have to be told to re-read ------------------------
//
// THE SERVER FILLS THESE IN THE MOMENT A REFERENCE IS PICKED and Fiori asks
// for none of them unless named here. A side effect that omits a derived
// field leaves the screen showing the value from before the change, and
// nothing errors - the field simply disagrees with the data.
//
// THE MEMO IS A TARGET TOO. A line amount moves lines_amount and balance,
// which live on the PARENT: naming the memo as a target entity is what makes
// the balance in the header follow the lines in the table.
annotate CreditMemoService.CreditMemoLines with @(
    Common.SideEffects #ReferencePicked: {
        SourceProperties: [
            reference_type, defuel_number, ref_ticket_number,
            ref_invoice_number, ref_line_number
        ],
        TargetProperties: [
            'reference_display', 'open_amount', 'quantity', 'uom_code', 'amount',
            'po_number', 'po_item', 'flight_ID', 'aircraft_reg', 'station_code',
            'cost_center', 'tax_code', 'value_only', 'line_number',
            'defuel_number', 'ref_ticket_number', 'ref_invoice_number', 'ref_line_number'
        ],
        TargetEntities: [ memo ]
    },

    Common.SideEffects #AmountChanged: {
        SourceProperties: [ amount, value_only ],
        TargetProperties: [ 'quantity', 'open_amount' ],
        TargetEntities: [ memo ]
    }
);

annotate CreditMemoService.CreditMemoLines with {
    line_number       @title: 'Line'              @readonly;
    reference_type    @title: 'Reference'         @Common.FieldControl: #Mandatory;
    defuel_number     @title: 'Expected Credit (Defuel No.)';
    ref_ticket_number @title: 'Fuel Ticket No.';
    ref_invoice_number @title: 'Invoice No.';
    ref_line_number   @title: 'Invoice Line';
    // DERIVED FROM THE REFERENCE, every one of them. A user who could edit
    // these would be disagreeing with the document the line points at.
    po_number         @title: 'PO No.'            @readonly;
    po_item           @title: 'PO Item'           @readonly;
    flight            @title: 'Flight'            @readonly;
    aircraft_reg      @title: 'Tail'              @readonly;
    station_code      @title: 'Station'           @readonly;
    cost_center       @title: 'Cost Object'       @readonly;
    value_only        @title: 'Value Only';
    reference_display @title: 'Refers To' @readonly;
    quantity          @title: 'Quantity';
    uom_code          @title: 'UoM';
    amount            @title: 'Amount';
    // COMPUTED AFTER READ, which is why the service withholds it from
    // $filter and $orderby. Shown, not sorted on.
    open_amount       @title: 'Still Open' @readonly
                      @Common.QuickInfo: 'What remains creditable on the reference, across posted lines.';
    price_component   @title: 'Component';
    tax_code          @title: 'Tax Code';
    final_clearing    @title: 'Final Clearing'
                      @Common.QuickInfo: 'Closes the reference even if some value remains open.';
    text              @title: 'Text';
};

// ===========================================================================
// Exceptions — what posting could not settle
// ===========================================================================
//
// POSTING CONTINUES AND THESE GO TO A WORKLIST, which is the backend's
// decision: a memo that half-posted and stopped would leave S/4 and
// FuelSphere disagreeing. So they are worked afterwards, and resolve() takes
// a note because "resolved" without a reason is not an audit trail.
annotate CreditMemoService.Exceptions with @(
    UI: {
        LineItem: [
            { Value: code,            Label: 'Code',     ![@UI.Importance]: #High },
            { Value: message,         Label: 'Message',  ![@UI.Importance]: #High },
            { Value: amount,          Label: 'Amount',   ![@UI.Importance]: #Medium },
            { Value: status,          Label: 'Status',   ![@UI.Importance]: #High },
            { Value: resolution_note, Label: 'Note',     ![@UI.Importance]: #Medium },
            { $Type: 'UI.DataFieldForAction', Action: 'CreditMemoService.resolve',
              Label: 'Resolve' }
        ]
    }
);

annotate CreditMemoService.Exceptions with {
    code            @title: 'Code'   @readonly;
    message         @title: 'Message' @readonly;
    amount          @title: 'Amount' @readonly;
    status          @title: 'Status' @readonly;
    resolution_note @title: 'Note'   @readonly;
};

annotate CreditMemoService.Log with @(
    UI: {
        LineItem: [
            { Value: logged_at, Label: 'When',     ![@UI.Importance]: #High },
            { Value: event,     Label: 'Event',    ![@UI.Importance]: #High },
            { Value: severity,  Label: 'Severity', ![@UI.Importance]: #Medium },
            { Value: code,      Label: 'Code',     ![@UI.Importance]: #Medium },
            { Value: message,   Label: 'Message',  ![@UI.Importance]: #High },
            { Value: logged_by, Label: 'By',       ![@UI.Importance]: #Low }
        ],
        PresentationVariant: {
            $Type: 'UI.PresentationVariantType',
            // NEWEST FIRST: the last thing that happened is what a reader
            // opening a log wants.
            SortOrder: [ { Property: logged_at, Descending: true } ],
            Visualizations: ['@UI.LineItem']
        }
    }
);

annotate CreditMemoService.Log with {
    logged_at @title: 'When';
    logged_by @title: 'By';
    event     @title: 'Event';
    severity  @title: 'Severity';
    code      @title: 'Code';
    message   @title: 'Message';
};

annotate CreditMemoService.Attachments with @(
    UI: {
        LineItem: [
            { Value: file_name, Label: 'File',      ![@UI.Importance]: #High },
            { Value: mime_type, Label: 'Type',      ![@UI.Importance]: #Low }
        ]
    }
);

annotate CreditMemoService.Attachments with {
    file_name @title: 'File';
    mime_type @title: 'Type';
    content   @title: 'Content' @Core.MediaType: mime_type;
};

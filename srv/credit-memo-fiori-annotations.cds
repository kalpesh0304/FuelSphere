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
 * never confirmed; offering it on a draft invites somebody to press it.
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
              Label: 'Simulate' },
            { $Type: 'UI.DataFieldForAction', Action: 'CreditMemoService.park',
              Label: 'Park' },
            { $Type: 'UI.DataFieldForAction', Action: 'CreditMemoService.postMemo',
              Label: 'Post' },
            { $Type: 'UI.DataFieldForAction', Action: 'CreditMemoService.reverse',
              Label: 'Reverse' },
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
              Label: 'Simulate' },
            { $Type: 'UI.DataFieldForAction', Action: 'CreditMemoService.park',
              Label: 'Park' },
            { $Type: 'UI.DataFieldForAction', Action: 'CreditMemoService.postMemo',
              Label: 'Post' },
            { $Type: 'UI.DataFieldForAction', Action: 'CreditMemoService.reverse',
              Label: 'Reverse' },
            { $Type: 'UI.DataFieldForAction', Action: 'CreditMemoService.reprocess',
              Label: 'Reprocess',
              ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'status' }, 'POSTING_ATTEMPTED'] } } }
        ]
    }
);

annotate CreditMemoService.CreditMemos with {
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
        LineItem: [
            { Value: line_number,       Label: 'Line',        ![@UI.Importance]: #High },
            { Value: reference_type,    Label: 'Reference',   ![@UI.Importance]: #High },
            { Value: reference_display, Label: 'Refers To',   ![@UI.Importance]: #High },
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

annotate CreditMemoService.CreditMemoLines with {
    line_number       @title: 'Line';
    reference_type    @title: 'Reference';
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

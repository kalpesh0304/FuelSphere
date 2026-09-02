/**
 * FuelSphere - Invoice Service Fiori Annotations
 * Based on FDD-06: Invoice Verification & Three-Way Matching
 *
 * Screens:
 * - INV-001: Invoice List (List Report)
 * - INV-002: Invoice Detail (Object Page)
 * - INV-003: Invoice Verification Workbench
 */

using InvoiceService from './invoice-service';

// =============================================================================
// INVOICES - List Report + Object Page
// =============================================================================

annotate InvoiceService.Invoices with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: false }
    }
);

annotate InvoiceService.Invoices with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Invoice',
            TypeNamePlural : 'Invoices',
            Title          : { Value: invoice_number },
            Description    : { Value: supplier.supplier_name },
            ImageUrl       : 'sap-icon://receipt'
        },

        SelectionFields: [
            invoice_number,
            supplier_ID,
            invoice_date,
            status,
            approval_status,
            match_status,
            // The reconcile filter. Without it the worklist cannot be
            // narrowed to the invoices that are actually stuck.
            posting_gate
        ],

        LineItem: [
            { Value: invoice_number, Label: 'Invoice Number', ![@UI.Importance]: #High },
            { Value: supplier.supplier_name, Label: 'Supplier', ![@UI.Importance]: #High },
            { Value: invoice_date, Label: 'Invoice Date', ![@UI.Importance]: #High },
            { Value: gross_amount, Label: 'Gross Amount', ![@UI.Importance]: #High },
            { Value: currency_code, Label: 'Currency', ![@UI.Importance]: #Medium },
            {
                Value: status,
                Label: 'Status',
                Criticality: statusCriticality,
                ![@UI.Importance]: #High
            },
            {
                Value: approval_status,
                Label: 'Approval',
                Criticality: approvalCriticality,
                ![@UI.Importance]: #Medium
            },
            {
                Value: match_status,
                Label: 'Matching',
                Criticality: matchingCriticality,
                ![@UI.Importance]: #Medium
            },
            { Value: due_date, Label: 'Due Date', ![@UI.Importance]: #Medium },

            // THE VERDICT, IN THE LIST. An AP clerk opening this screen is
            // asking which invoices are stuck, and until now the list could
            // not answer - posting_gate and its three counters were on the
            // entity and on no screen at all.
            {
                Value: posting_gate,
                Label: 'Posting Gate',
                Criticality: gateCriticality,
                ![@UI.Importance]: #High
            },
            { Value: open_hard_count, Label: 'Hard', ![@UI.Importance]: #High },
            { Value: open_soft_count, Label: 'Soft', ![@UI.Importance]: #Medium },
            { Value: warning_count,   Label: 'Warnings', ![@UI.Importance]: #Low },

            { Value: s4_document_number, Label: 'S/4 Doc', ![@UI.Importance]: #Low }
        ],

        PresentationVariant: {
            SortOrder: [
                { Property: invoice_date, Descending: true }
            ],
            Visualizations: [ '@UI.LineItem' ]
        },

        HeaderFacets: [
            // FIRST, because it is the answer to the question the screen is
            // open to settle.
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#PostingGate',
                Label  : 'Posting Gate'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#InvoiceStatus',
                Label  : 'Status'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#InvoiceAmount',
                Label  : 'Amount'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#MatchingStatus',
                Label  : 'Matching'
            }
        ],

        // WHY THE GATE IS ITS OWN GROUP AND NOT A LINE IN #InvoiceStatus.
        // status is where the invoice is in its own lifecycle; posting_gate
        // is whether FuelSphere will let it leave. A SUBMITTED invoice with
        // four hard errors is both, and collapsing them would lose the one
        // the reader came for.
        FieldGroup#PostingGate: {
            Data: [
                { Value: posting_gate, Label: 'Gate', Criticality: gateCriticality },
                { Value: open_hard_count, Label: 'Hard errors' },
                { Value: open_soft_count, Label: 'Soft errors' },
                { Value: warning_count, Label: 'Warnings' },
                // WITHOUT THIS THE VERDICT IS UNDATED, and an undated verdict
                // on a document that changes is not evidence of anything.
                { Value: gate_evaluated_at, Label: 'Last evaluated' }
            ]
        },

        FieldGroup#InvoiceStatus: {
            Data: [
                { Value: status, Label: 'Status', Criticality: statusCriticality },
                { Value: approval_status, Label: 'Approval', Criticality: approvalCriticality }
            ]
        },

        FieldGroup#InvoiceAmount: {
            Data: [
                { Value: gross_amount, Label: 'Gross Amount' },
                { Value: net_amount, Label: 'Net Amount' },
                { Value: currency_code, Label: 'Currency' }
            ]
        },

        FieldGroup#MatchingStatus: {
            Data: [
                { Value: match_status, Label: 'Matching', Criticality: matchingCriticality },
                { Value: price_variance, Label: 'Variance' }
            ]
        },

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'GeneralInfo',
                Label  : 'General Information',
                Target : '@UI.FieldGroup#InvoiceGeneral'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'SupplierInfo',
                Label  : 'Supplier Information',
                Target : '@UI.FieldGroup#SupplierInfo'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'AmountDetails',
                Label  : 'Amount Details',
                Target : '@UI.FieldGroup#AmountDetails'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'ThreeWayMatching',
                Label  : 'Three-Way Matching',
                Target : '@UI.FieldGroup#ThreeWayMatching'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'LineItems',
                Label  : 'Line Items',
                Target : 'items/@UI.LineItem'
            },

            // ----------------------------------------------------------
            // THE ARGUMENT. Four facets that existed as data and as no
            // screen. `exceptions` is a composition on INVOICES and a
            // navigation property in the emitted EDMX; nothing pointed at
            // it, so twenty-five raised exceptions were reachable only by
            // typing an OData URL.
            // ----------------------------------------------------------
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Exceptions',
                Label  : 'Checks that fired',
                Target : 'exceptions/@UI.LineItem'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'StatedVsDerived',
                Label  : 'Stated against derived',
                Target : '@UI.FieldGroup#StatedVsDerived'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'ThreeWayMatchLines',
                Label  : 'Match evidence',
                Target : 'matches/@UI.LineItem'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'ApprovalTrail',
                Label  : 'Approval trail',
                Target : 'approvals/@UI.LineItem'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'DuplicateCheck',
                Label  : 'Duplicate',
                Target : '@UI.FieldGroup#Duplicate'
            },

            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'S4Integration',
                Label  : 'S/4HANA Integration',
                Target : '@UI.FieldGroup#InvoiceS4'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Workflow',
                Label  : 'Approval Workflow',
                Target : '@UI.FieldGroup#Workflow'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Administrative',
                Label  : 'Administrative',
                Target : '@UI.FieldGroup#InvoiceAdmin'
            }
        ],

        FieldGroup#InvoiceGeneral: {
            Label: 'General Information',
            Data: [
                { Value: invoice_number, Label: 'Invoice Number' },
                { Value: internal_number, Label: 'Internal Number' },
                { Value: invoice_date, Label: 'Invoice Date' },
                { Value: posting_date, Label: 'Posting Date' },
                { Value: due_date, Label: 'Due Date' },
                { Value: payment_terms, Label: 'Payment Terms' },
                { Value: status, Label: 'Status' }
            ]
        },

        FieldGroup#SupplierInfo: {
            Label: 'Supplier Information',
            Data: [
                { Value: supplier.supplier_name, Label: 'Supplier Name' },
                { Value: supplier.supplier_code, Label: 'Supplier Code' },
                { Value: invoice_number, Label: 'Supplier Invoice #' }
            ]
        },

        FieldGroup#AmountDetails: {
            Label: 'Amount Details',
            Data: [
                { Value: net_amount, Label: 'Net Amount' },
                { Value: tax_amount, Label: 'Tax Amount' },
                { Value: gross_amount, Label: 'Gross Amount' },
                { Value: currency_code, Label: 'Currency' },
                { Value: discount_percent, Label: 'Discount %' },
                { Value: discount_date, Label: 'Discount Date' }
            ]
        },

        // INV454 AND INV460, SIDE BY SIDE. The whole point of keeping
        // stated_* beside the derived figures is that the two can disagree,
        // and the disagreement is the finding. Showing only one of them
        // makes both checks unreadable: a reader looking at "header total
        // differs from the sum of lines" had one number and no other.
        //
        // The derived figures are OUTPUTS OF THE RUN, so a null here means
        // the registry has not run - not that the invoice is worth nothing.
        // gate_evaluated_at above says which.
        FieldGroup#StatedVsDerived: {
            Label: 'Stated against derived',
            Data: [
                { Value: stated_net_amount, Label: 'Net - stated by supplier' },
                { Value: net_amount, Label: 'Net - derived from lines' },
                { Value: stated_gross_amount, Label: 'Gross - stated by supplier' },
                { Value: gross_amount, Label: 'Gross - derived from lines' },
                { Value: tax_amount, Label: 'Tax - derived from lines' },
                { Value: stated_line_count, Label: 'Lines - stated by supplier' },
                { Value: currency_code, Label: 'Currency' }
            ]
        },

        // INV405 / INV473. is_duplicate and duplicate_of are on the entity
        // and were on no screen, so an invoice flagged as a duplicate looked
        // identical to one that was not.
        FieldGroup#Duplicate: {
            Label: 'Duplicate',
            Data: [
                { Value: is_duplicate, Label: 'Flagged as duplicate' },
                {
                    $Type: 'UI.DataFieldWithNavigationPath',
                    Value: duplicate_of.invoice_number,
                    Label: 'Original invoice',
                    Target: duplicate_of
                }
            ]
        },

        FieldGroup#ThreeWayMatching: {
            Label: 'Three-Way Matching',
            Data: [
                { Value: match_status, Label: 'Match Status' },
                { Value: approval_status, Label: 'Approval Status' },
                { Value: price_variance, Label: 'Price Variance' },
                { Value: quantity_variance, Label: 'Quantity Variance' },
                { Value: variance_percentage, Label: 'Variance %' },
                { Value: requires_dual_approval, Label: 'Requires Dual Approval' }
            ]
        },

        FieldGroup#InvoiceS4: {
            Label: 'S/4HANA Integration',
            Data: [
                { Value: s4_document_number, Label: 'Invoice Document' },
                { Value: s4_fiscal_year, Label: 'Fiscal Year' },
                { Value: s4_company_code, Label: 'Company Code' },
                { Value: fi_posting_status, Label: 'Posting Status' }
            ]
        },

        FieldGroup#Workflow: {
            Label: 'Approval Workflow',
            Data: [
                { Value: first_approver, Label: 'First Approver' },
                { Value: first_approved_at, Label: 'First Approved At' },
                { Value: final_approver, Label: 'Final Approver' },
                { Value: final_approved_at, Label: 'Final Approved At' },
                { Value: rejection_reason, Label: 'Rejection Reason' }
            ]
        },

        FieldGroup#InvoiceAdmin: {
            Label: 'Administrative',
            Data: [
                { Value: created_at, Label: 'Created At' },
                { Value: created_by, Label: 'Created By' },
                { Value: modified_at, Label: 'Modified At' },
                { Value: modified_by, Label: 'Modified By' }
            ]
        }
    }
);

// Field-level annotations
annotate InvoiceService.Invoices with {
    ID                   @UI.Hidden;
    invoice_number       @title: 'Invoice Number' @mandatory;
    internal_number      @title: 'Internal Number';
    invoice_date         @title: 'Invoice Date' @mandatory;
    posting_date         @title: 'Posting Date';
    due_date             @title: 'Due Date';
    baseline_date        @title: 'Baseline Date';
    net_amount           @title: 'Net Amount' @Measures.ISOCurrency: currency_code;
    tax_amount           @title: 'Tax Amount' @Measures.ISOCurrency: currency_code;
    gross_amount         @title: 'Gross Amount' @Measures.ISOCurrency: currency_code;
    currency_code        @title: 'Currency';
    payment_terms        @title: 'Payment Terms';
    discount_percent     @title: 'Discount %';
    discount_date        @title: 'Discount Date';
    match_status         @title: 'Match Status';
    price_variance       @title: 'Price Variance' @Measures.ISOCurrency: currency_code;
    quantity_variance    @title: 'Quantity Variance';
    variance_percentage  @title: 'Variance %';
    approval_status      @title: 'Approval Status';
    requires_dual_approval @title: 'Requires Dual Approval';
    first_approver       @title: 'First Approver';
    first_approved_at    @title: 'First Approved At';
    final_approver       @title: 'Final Approver';
    final_approved_at    @title: 'Final Approved At';
    s4_document_number   @title: 'S/4 Document' @Common.FieldControl: #ReadOnly;
    s4_fiscal_year       @title: 'Fiscal Year' @Common.FieldControl: #ReadOnly;
    s4_company_code      @title: 'Company Code' @Common.FieldControl: #ReadOnly;
    fi_posting_status    @title: 'FI Posting Status' @Common.FieldControl: #ReadOnly;
    status               @title: 'Status';
    notes                @title: 'Notes' @UI.MultiLineText;
    rejection_reason     @title: 'Rejection Reason' @UI.MultiLineText;
    is_duplicate         @title: 'Is Duplicate';
    created_at           @title: 'Created At' @Common.FieldControl: #ReadOnly;
    created_by           @title: 'Created By' @Common.FieldControl: #ReadOnly;
    modified_at          @title: 'Modified At' @Common.FieldControl: #ReadOnly;
    modified_by          @title: 'Modified By' @Common.FieldControl: #ReadOnly;
};

// =============================================================================
// INVOICE LINE ITEMS
// =============================================================================

annotate InvoiceService.InvoiceItems with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Invoice Item',
            TypeNamePlural : 'Invoice Items',
            Title          : { Value: line_number }
        },

        LineItem: [
            { Value: line_number, Label: 'Item', ![@UI.Importance]: #High },
            { Value: description, Label: 'Description', ![@UI.Importance]: #High },
            { Value: quantity, Label: 'Quantity', ![@UI.Importance]: #High },
            { Value: unit_price, Label: 'Unit Price', ![@UI.Importance]: #High },
            { Value: net_amount, Label: 'Net Amount', ![@UI.Importance]: #High },

            // ------------------------------------------------------------
            // WHAT THE SUPPLIER QUOTED, AND WHAT IT RESOLVED TO.
            //
            // ticket_number is the key the supplier actually references -
            // they do not know our PO - and it was on the entity, in the
            // seed and on no screen. Six checks in the RESOLUTION group
            // (INV450, 462, 463, 464, 465, 466) all read from these three
            // fields, and every one of them was unreadable on the line it
            // was raised against.
            // ------------------------------------------------------------
            {
                $Type : 'UI.DataFieldWithNavigationPath',
                Value : ticket_number,
                Label : 'Ticket stated',
                Target: ticket,
                ![@UI.Importance]: #High
            },
            {
                Value: resolution_source,
                Label: 'Resolved by',
                Criticality: resolutionCriticality,
                ![@UI.Importance]: #High
            },

            { Value: tax_code, Label: 'Tax Code', ![@UI.Importance]: #Medium },
            { Value: tax_amount, Label: 'Tax Amount', ![@UI.Importance]: #Medium },
            { Value: po_number, Label: 'PO Number', ![@UI.Importance]: #Low },
            { Value: po_item, Label: 'PO Item', ![@UI.Importance]: #Low }
        ],

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'ItemDetails',
                Label  : 'Item Details',
                Target : '@UI.FieldGroup#ItemDetails'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'ItemResolution',
                Label  : 'Resolution',
                Target : '@UI.FieldGroup#ItemResolution'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Matching',
                Label  : 'Matching',
                Target : '@UI.FieldGroup#ItemMatching'
            },
            // The last hop. FuelTickets was exposed on this service for
            // exactly this facet; its #TicketFuel group is metered x density
            // = kg, which is the only place on an AP screen where the volume
            // the supplier billed meets the mass the aircraft received.
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'ItemTicket',
                Label  : 'The fuel behind this line',
                Target : 'ticket/@UI.FieldGroup#TicketFuel'
            }
        ],

        FieldGroup#ItemDetails: {
            Data: [
                { Value: line_number, Label: 'Line Number' },
                { Value: description, Label: 'Description' },
                { Value: product.product_name, Label: 'Product' },
                { Value: quantity, Label: 'Quantity' },
                { Value: uom_code, Label: 'UoM' },
                { Value: unit_price, Label: 'Unit Price' },
                { Value: net_amount, Label: 'Net Amount' },
                { Value: tax_code, Label: 'Tax Code' },
                { Value: tax_amount, Label: 'Tax Amount' },
                { Value: cost_center, Label: 'Cost Center' },
                { Value: gl_account, Label: 'G/L Account' }
            ]
        },

        // WHERE INV465 FINALLY HAS BOTH ITS NUMBERS. The exception reads
        // "line states PO 4500999999; the ticket resolves to PO 4500210010",
        // and until this group existed the screen carried only the first of
        // the two. An exception naming a value the screen cannot show is an
        // assertion the reader has to take on trust.
        FieldGroup#ItemResolution: {
            Label: 'Resolution',
            Data: [
                { Value: ticket_number, Label: 'Ticket stated on the document' },
                {
                    $Type: 'UI.DataFieldWithNavigationPath',
                    Value: ticket.ticket_number,
                    Label: 'Ticket it resolved to',
                    Target: ticket
                },
                { Value: resolution_source, Label: 'Resolved by', Criticality: resolutionCriticality },
                { Value: po_number, Label: 'PO stated on the document' },
                {
                    Value: resolved_po_number,
                    Label: 'PO reached through the ticket',
                    Criticality: poAgreementCriticality
                },
                { Value: resolved_gr_number, Label: 'GR reached through the ticket' },
                {
                    $Type: 'UI.DataFieldWithNavigationPath',
                    Value: delivery.delivery_number,
                    Label: 'Goods receipt',
                    Target: delivery
                },
                {
                    $Type: 'UI.DataFieldWithNavigationPath',
                    Value: fuel_order.order_number,
                    Label: 'Fuel order',
                    Target: fuel_order
                }
            ]
        },

        FieldGroup#ItemMatching: {
            Data: [
                { Value: po_number, Label: 'PO Number' },
                { Value: po_item, Label: 'PO Item' },
                { Value: line_match_status, Label: 'Line Match Status' },
                { Value: price_variance_pct, Label: 'Price Variance %' },
                { Value: qty_variance_pct, Label: 'Quantity Variance %' }
            ]
        }
    }
);

// Value Help for Invoice associations
annotate InvoiceService.Invoices with {
    supplier @(
        Common: {
            Text: supplier.supplier_name,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Suppliers',
                CollectionPath: 'Suppliers',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: supplier_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'supplier_code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'supplier_name' }
                ]
            }
        }
    );

    // REMOVED: a value help for `contract`, which INVOICES does not have.
    // The compiler warned on every build - "Artifact InvoiceService.Invoices
    // has no element contract" - and it was the ONLY warning this file
    // produced, so it was the only dangling reference anyone could see. The
    // six dangling Criticality paths beside it warned about nothing.
    //
    // An invoice reaches its contract THROUGH the line's fuel_order, which
    // is a real path; the header has no contract of its own and inventing
    // one to satisfy this annotation would have been the wrong repair.
};

// ============================================================================
// FOUR BLOCKS FOR ENTITIES THE SERVICE EXPOSED AND NEVER ANNOTATED.
//
// InvoiceExceptions, InvoiceCheckRegistry and ToleranceRules were all exposed
// with no annotation at all, so the Exception Worklist and the check panel had
// nowhere to land. FuelTickets was not exposed, so InvoiceItems.ticket
// resolved to nothing.
//
// Every field named here was checked against ITS OWN projection before being
// written. A LineItem naming a field the projection lacks fails the whole
// read, not the column, and four new blocks is four chances at it.
// ============================================================================

annotate InvoiceService.InvoiceExceptions with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Exception',
            TypeNamePlural : 'Exception Worklist',
            Title          : { Value: check_code },
            Description    : { Value: message }
        },
        // SEVERITY BEFORE AGE. A hard error found this morning outranks a
        // warning from last week, and sorting by age would bury the gate.
        PresentationVariant: {
            SortOrder: [
                { Property: severity,    Descending: false },
                { Property: detected_at, Descending: true }
            ],
            Visualizations: ['@UI.LineItem']
        },
        SelectionFields: [ severity, check_group, status, is_gating, check_code ],
        LineItem: [
            {
                Value: severity,
                Label: 'Severity',
                // WARNING is neutral, not green. See severityCriticality in
                // invoice-service.cds: a row exists because something was
                // worth saying, and green would read as "checked and fine".
                Criticality: severityCriticality,
                ![@UI.Importance]: #High
            },
            { Value: check_code,      Label: 'Check',      ![@UI.Importance]: #High },
            { Value: message,         Label: 'What happened', ![@UI.Importance]: #High },
            { Value: line_number,     Label: 'Line',       ![@UI.Importance]: #Medium },
            { Value: is_gating,       Label: 'Gating',     ![@UI.Importance]: #High },
            // THE ANSWER TO "IS THE THRESHOLD HARDCODED", without anyone
            // having to ask. TOLERANCE_LADDER means a configured rung decided
            // this; REGISTRY_DEFAULT means the registry did.
            { Value: severity_source, Label: 'Decided by', ![@UI.Importance]: #High },
            {
                Value: status,
                Label: 'Status',
                // BYPASSED is orange, never green - it is still true and
                // someone accepted it anyway.
                Criticality: lifecycleCriticality,
                ![@UI.Importance]: #Medium
            },
            { Value: detected_at,     Label: 'Detected',   ![@UI.Importance]: #Low }
        ],
        HeaderFacets: [
            { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#ExcVerdict', Label: 'Verdict' }
        ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'ExcEvidence',
              Target: '@UI.FieldGroup#ExcEvidence', Label: 'Evidence' },
            { $Type: 'UI.ReferenceFacet', ID: 'ExcLifecycle',
              Target: '@UI.FieldGroup#ExcLifecycle', Label: 'Lifecycle' }
        ],
        FieldGroup #ExcVerdict: {
            Data: [
                { Value: severity,        Label: 'Severity' },
                { Value: severity_source, Label: 'Decided by' },
                { Value: is_gating,       Label: 'Gating' }
            ]
        },
        FieldGroup #ExcEvidence: {
            Data: [
                { Value: message,           Label: 'What happened' },
                { Value: observed_value,    Label: 'Invoice said' },
                { Value: expected_value,    Label: 'FuelSphere resolved' },
                { Value: variance_value,    Label: 'Variance' },
                { Value: variance_pct,      Label: 'Variance %' },
                // The rung's value where a ladder resolved. Null where the
                // registry decided, which is the distinction that matters.
                { Value: threshold_crossed, Label: 'Threshold crossed' },

                // WHICH ROW DECIDED IT. severity_source says A LADDER decided
                // and threshold_crossed says what it crossed; neither says
                // WHICH rule, and the standing convention is that a resolved
                // value records the configuration row behind it. The
                // association existed and pointed at an exposed entity - it
                // was simply on no facet, so the one thing an argued-with
                // severity needs was a URL away.
                {
                    $Type: 'UI.DataFieldWithNavigationPath',
                    Value: tolerance_rule.rule_code,
                    Label: 'Rule that decided it',
                    Target: tolerance_rule
                },
                { Value: tolerance_rule.rule_name, Label: 'Rule name' },

                // AND THE LINE IT WAS RAISED AGAINST. line_number is a bare
                // integer; without this an exception on line 30 could not be
                // opened, only read about.
                {
                    $Type: 'UI.DataFieldWithNavigationPath',
                    Value: line_number,
                    Label: 'Line',
                    Target: invoice_item
                }
            ]
        },
        FieldGroup #ExcLifecycle: {
            Data: [
                { Value: status,         Label: 'Status' },
                { Value: detected_at,    Label: 'Detected' },
                { Value: detected_by,    Label: 'Detected by' },
                { Value: cleared_at,     Label: 'Cleared' },
                { Value: cleared_reason, Label: 'Why it stopped being true' }
            ]
        }
    }
);

annotate InvoiceService.InvoiceExceptions with {
    check_code        @title: 'Check';
    check_group       @title: 'Group';
    severity          @title: 'Severity';
    severity_source   @title: 'Decided by';
    message           @title: 'What happened';
    line_number       @title: 'Line';
    observed_value    @title: 'Invoice said';
    expected_value    @title: 'FuelSphere resolved';
    variance_value    @title: 'Variance';
    variance_pct      @title: 'Variance %';
    threshold_crossed @title: 'Threshold crossed';
    is_gating         @title: 'Gating';
    detected_at       @title: 'Detected';
    detected_by       @title: 'Detected by';
    cleared_at        @title: 'Cleared';
    cleared_reason    @title: 'Why it stopped being true';
};

// ============================================================================
// THE CHECK PANEL - all 22, and PASSED BY ABSENCE.
//
// Section 2A. The registry is the list of every check that RAN; the exceptions
// are the ones that FAILED. A check appearing here and not among an invoice's
// exceptions passed - which is why the panel defaults to the failures and a
// toggle shows all twenty-two.
//
// "Checked and clean" and "never checked" must not look alike. They do not:
// checksRegistered and checksSkipped are on the run, gate_evaluated_at and the
// three counts are on the invoice, and INVOICE_EXCEPTIONS holds failures only
// because severity and message are mandatory on it. The evidence of a clean
// run belongs on the thing that was run against.
// ============================================================================
annotate InvoiceService.InvoiceCheckRegistry with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Check',
            TypeNamePlural : 'Check Registry',
            Title          : { Value: check_code },
            Description    : { Value: check_name }
        },
        PresentationVariant: {
            SortOrder: [ { Property: check_group, Descending: false },
                         { Property: check_code,  Descending: false } ],
            Visualizations: ['@UI.LineItem']
        },
        SelectionFields: [ check_group, default_severity, is_bypassable, is_implemented ],
        LineItem: [
            { Value: check_code,          Label: 'Check',      ![@UI.Importance]: #High },
            { Value: check_name,          Label: 'Name',       ![@UI.Importance]: #High },
            { Value: check_group,         Label: 'Group',      ![@UI.Importance]: #High },
            { Value: default_severity,    Label: 'Default severity', ![@UI.Importance]: #High },
            // Bypassable EXACTLY where the default is SOFT_ERROR: bypass is
            // refused on a HARD error, and a WARNING does not gate so
            // bypassing one would mean nothing.
            { Value: is_bypassable,       Label: 'Bypassable', ![@UI.Importance]: #Medium },
            { Value: tolerance_rule_code, Label: 'Tolerance',  ![@UI.Importance]: #Medium },
            // A check absent from the registry DOES NOT RUN, and one marked
            // not implemented is skipped and SAYS SO rather than passing.
            { Value: is_implemented,      Label: 'Implemented',![@UI.Importance]: #Medium }
        ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'CheckWhat',
              Target: '@UI.FieldGroup#CheckWhat', Label: 'What it checks' },
            { $Type: 'UI.ReferenceFacet', ID: 'CheckConfig',
              Target: '@UI.FieldGroup#CheckConfig', Label: 'Configuration' }
        ],
        FieldGroup #CheckWhat: {
            Data: [
                { Value: check_code,        Label: 'Check' },
                { Value: check_name,        Label: 'Name' },
                { Value: check_description, Label: 'Description' },
                { Value: check_group,       Label: 'Group' }
            ]
        },
        FieldGroup #CheckConfig: {
            Data: [
                { Value: default_severity,       Label: 'Default severity' },
                { Value: tolerance_rule_code,    Label: 'Tolerance rule' },
                { Value: is_bypassable,          Label: 'Bypassable' },
                { Value: bypass_scope,           Label: 'Bypass scope' },
                { Value: is_implemented,         Label: 'Implemented' },
                { Value: not_implemented_reason, Label: 'If not, why' },
                { Value: valid_from,             Label: 'Valid from' },
                { Value: valid_to,               Label: 'Valid to' }
            ]
        }
    }
);

annotate InvoiceService.InvoiceCheckRegistry with {
    check_code             @title: 'Check';
    check_name             @title: 'Name';
    check_description      @title: 'Description';
    check_group            @title: 'Group';
    default_severity       @title: 'Default severity';
    tolerance_rule_code    @title: 'Tolerance rule';
    is_bypassable          @title: 'Bypassable';
    bypass_scope           @title: 'Bypass scope';
    is_implemented         @title: 'Implemented';
    not_implemented_reason @title: 'If not, why';
};

// ============================================================================
// THE THRESHOLDS THEMSELVES. Where a SOFT_ERROR came from, one click on.
// ============================================================================
annotate InvoiceService.ToleranceRules with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Tolerance Rule',
            TypeNamePlural : 'Tolerances',
            Title          : { Value: rule_code },
            Description    : { Value: rule_name }
        },
        SelectionFields: [ applies_to, tolerance_type, company_code, station_code ],
        LineItem: [
            { Value: rule_code,          Label: 'Rule',      ![@UI.Importance]: #High },
            { Value: rule_name,          Label: 'Name',      ![@UI.Importance]: #High },
            { Value: applies_to,         Label: 'Applies to',![@UI.Importance]: #High },
            { Value: tolerance_type,     Label: 'Type',      ![@UI.Importance]: #High },
            { Value: warning_threshold,  Label: 'Warning',   ![@UI.Importance]: #High },
            { Value: error_threshold,    Label: 'Soft',      ![@UI.Importance]: #High },
            { Value: critical_threshold, Label: 'Hard',      ![@UI.Importance]: #High },
            { Value: is_percentage,      Label: 'Percent',   ![@UI.Importance]: #Medium },
            // CFG401: the highest-specificity row whose scope matches, and
            // priority is the column that carries it - lower is higher.
            { Value: priority,           Label: 'Priority',  ![@UI.Importance]: #Medium }
        ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'TolLadder',
              Target: '@UI.FieldGroup#TolLadder', Label: 'The ladder' },
            { $Type: 'UI.ReferenceFacet', ID: 'TolScope',
              Target: '@UI.FieldGroup#TolScope', Label: 'Scope and validity' }
        ],
        FieldGroup #TolLadder: {
            Data: [
                { Value: warning_threshold,     Label: 'Warning rung' },
                { Value: error_threshold,       Label: 'Soft rung' },
                { Value: critical_threshold,    Label: 'Hard rung' },
                { Value: is_percentage,         Label: 'Percentage' },
                { Value: floor_value,           Label: 'Floor' },
                { Value: floor_uom,             Label: 'Floor unit' },
                { Value: block_on_exceed,       Label: 'Blocks on exceed' },
                { Value: require_dual_approval, Label: 'Dual approval' }
            ]
        },
        FieldGroup #TolScope: {
            Data: [
                { Value: applies_to,     Label: 'Applies to' },
                { Value: tolerance_type, Label: 'Type' },
                { Value: company_code,   Label: 'Company' },
                { Value: station_code,   Label: 'Station' },
                { Value: priority,       Label: 'Priority' },
                { Value: valid_from,     Label: 'Valid from' },
                { Value: valid_to,       Label: 'Valid to' }
            ]
        }
    }
);

annotate InvoiceService.ToleranceRules with {
    rule_code            @title: 'Rule';
    rule_name            @title: 'Name';
    applies_to           @title: 'Applies to';
    tolerance_type       @title: 'Type';
    warning_threshold    @title: 'Warning rung';
    error_threshold      @title: 'Soft rung';
    critical_threshold   @title: 'Hard rung';
    is_percentage        @title: 'Percentage';
    floor_value          @title: 'Floor';
    floor_uom            @title: 'Floor unit';
    block_on_exceed      @title: 'Blocks on exceed';
    require_dual_approval @title: 'Dual approval';
    priority             @title: 'Priority';
};

// ============================================================================
// THE TICKET - the leg nothing else can match, sized to an invoice reader.
// ============================================================================
annotate InvoiceService.FuelTickets with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Fuel Ticket',
            TypeNamePlural : 'Fuel Tickets',
            Title          : { Value: ticket_number },
            Description    : { Value: aircraft_reg }
        },
        LineItem: [
            { Value: ticket_number,      Label: 'Ticket',     ![@UI.Importance]: #High },
            { Value: quantity_metered,   Label: 'Metered',    ![@UI.Importance]: #High },
            { Value: quantity_kg,        Label: 'Mass (kg)',  ![@UI.Importance]: #High },
            { Value: density_value,      Label: 'Density',    ![@UI.Importance]: #Medium },
            { Value: aircraft_reg,       Label: 'Aircraft',   ![@UI.Importance]: #High },
            { Value: flight_number,      Label: 'Flight',     ![@UI.Importance]: #High },
            { Value: match_status,       Label: 'Match',      ![@UI.Importance]: #Medium }
        ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'TicketFuel',
              Target: '@UI.FieldGroup#TicketFuel', Label: 'What fuel was this' }
        ],
        FieldGroup #TicketFuel: {
            Data: [
                { Value: ticket_number,      Label: 'Ticket' },
                { Value: quantity_metered,   Label: 'Metered' },
                { Value: uom_code,           Label: 'Unit' },
                // The conversion, so the mass is explainable rather than
                // asserted: metered x density = kg.
                { Value: density_value,      Label: 'Density' },
                { Value: quantity_kg,        Label: 'Mass (kg)' },
                { Value: aircraft_reg,       Label: 'Aircraft' },
                { Value: flight_number,      Label: 'Flight' },
                { Value: delivery_timestamp, Label: 'Delivered at' }
            ]
        }
    }
);

annotate InvoiceService.FuelTickets with {
    ticket_number      @title: 'Ticket';
    quantity_metered   @title: 'Metered';
    quantity_kg        @title: 'Mass (kg)';
    density_value      @title: 'Density';
    aircraft_reg       @title: 'Aircraft';
    flight_number      @title: 'Flight';
    match_status       @title: 'Match';
    delivery_timestamp @title: 'Delivered at';
};

// ============================================================================
// THE TWO COMPOSITIONS THAT CARRIED ROWS AND HAD NO SCREEN.
//
// InvoiceMatches (2 rows) and InvoiceApprovals (3 rows) are exposed, read-only
// and were never annotated, so the two facets added to the invoice object page
// above would have rendered as empty shells. A facet pointing at an entity
// with no LineItem is worse than no facet: it asserts there is nothing there.
// ============================================================================

// ----------------------------------------------------------------------------
// INVOICE MATCHES - the three-way match record, PO against GR against invoice
//
// This is the LEGACY match record, written by executeThreeWayMatch, and it is
// NOT what validateForPosting produces. Both are kept and neither is renamed:
// the checks are FuelSphere's own pre-posting gate, and the match is the
// PO/GR/invoice reconciliation SAP performs at MIRO. Showing them on separate
// facets is the honest arrangement - collapsing them would imply one supersedes
// the other, and the decision on which survives has not been taken.
// ----------------------------------------------------------------------------
annotate InvoiceService.InvoiceMatches with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Match',
            TypeNamePlural : 'Match Evidence',
            Title          : { Value: po_number },
            Description    : { Value: match_status }
        },

        LineItem: [
            { Value: po_number,             Label: 'PO',           ![@UI.Importance]: #High },
            { Value: gr_number,             Label: 'GR',           ![@UI.Importance]: #High },
            { Value: po_quantity,           Label: 'PO qty',       ![@UI.Importance]: #High },
            { Value: gr_quantity,           Label: 'GR qty',       ![@UI.Importance]: #High },
            { Value: inv_quantity,          Label: 'Invoiced qty', ![@UI.Importance]: #High },
            { Value: quantity_variance_pct, Label: 'Qty var %',    ![@UI.Importance]: #High },
            { Value: price_variance_pct,    Label: 'Price var %',  ![@UI.Importance]: #High },
            { Value: within_tolerance,      Label: 'In tolerance', ![@UI.Importance]: #High },
            { Value: match_status,          Label: 'Status',       ![@UI.Importance]: #Medium },
            { Value: match_date,            Label: 'Matched',      ![@UI.Importance]: #Low }
        ],

        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'MatchThree',
              Target: '@UI.FieldGroup#MatchThreeWay', Label: 'PO, GR and invoice' },
            { $Type: 'UI.ReferenceFacet', ID: 'MatchVerdict',
              Target: '@UI.FieldGroup#MatchVerdict', Label: 'Variance and verdict' }
        ],

        // THE THREE LEGS IN COLUMNS, not three separate groups. The reader is
        // comparing them; putting each on its own facet would make the one
        // comparison the entity exists for the hardest thing on the screen.
        FieldGroup#MatchThreeWay: {
            Data: [
                { Value: po_number, Label: 'PO number' },
                { Value: po_item, Label: 'PO item' },
                { Value: po_quantity, Label: 'PO quantity' },
                { Value: po_price, Label: 'PO price' },
                { Value: po_amount, Label: 'PO amount' },
                { Value: gr_number, Label: 'GR number' },
                { Value: gr_item, Label: 'GR item' },
                { Value: gr_year, Label: 'GR year' },
                { Value: gr_quantity, Label: 'GR quantity' },
                { Value: gr_date, Label: 'GR date' },
                { Value: inv_quantity, Label: 'Invoiced quantity' },
                { Value: inv_price, Label: 'Invoiced price' },
                { Value: inv_amount, Label: 'Invoiced amount' }
            ]
        },

        FieldGroup#MatchVerdict: {
            Data: [
                { Value: quantity_variance, Label: 'Quantity variance' },
                { Value: quantity_variance_pct, Label: 'Quantity variance %' },
                { Value: price_variance, Label: 'Price variance' },
                { Value: price_variance_pct, Label: 'Price variance %' },
                { Value: amount_variance, Label: 'Amount variance' },
                { Value: match_status, Label: 'Match status' },
                { Value: within_tolerance, Label: 'Within tolerance' },
                // WHICH ROW DECIDED IT. The same recording convention as
                // severity_source on an exception: a verdict that does not
                // name the configuration behind it cannot be argued with.
                { Value: tolerance_rule.rule_code, Label: 'Tolerance rule applied' },
                { Value: matched_by, Label: 'Matched by' },
                { Value: match_date, Label: 'Matched at' },
                { Value: match_notes, Label: 'Notes' }
            ]
        }
    }
);

annotate InvoiceService.InvoiceMatches with {
    ID                   @UI.Hidden;
    invoice              @title: 'Invoice';
    invoice_item         @title: 'Invoice Line';
    po_number            @title: 'PO Number';
    po_item              @title: 'PO Item';
    po_quantity          @title: 'PO Quantity';
    po_price             @title: 'PO Price';
    po_amount            @title: 'PO Amount';
    gr_number            @title: 'GR Number';
    gr_year              @title: 'GR Year';
    gr_item              @title: 'GR Item';
    gr_quantity          @title: 'GR Quantity';
    gr_date              @title: 'GR Date';
    inv_quantity         @title: 'Invoiced Quantity';
    inv_price            @title: 'Invoiced Price';
    inv_amount           @title: 'Invoiced Amount';
    quantity_variance    @title: 'Quantity Variance';
    quantity_variance_pct @title: 'Quantity Variance %';
    price_variance       @title: 'Price Variance';
    price_variance_pct   @title: 'Price Variance %';
    amount_variance      @title: 'Amount Variance';
    match_status         @title: 'Match Status';
    match_date           @title: 'Matched At';
    matched_by           @title: 'Matched By';
    tolerance_rule       @title: 'Tolerance Rule';
    within_tolerance     @title: 'Within Tolerance';
    match_notes          @title: 'Notes' @UI.MultiLineText;
};

// ----------------------------------------------------------------------------
// INVOICE APPROVALS - SOX control INV-007, the approval audit trail
//
// Ordered by sequence ASCENDING, which is the reverse of every other worklist
// in this file. An audit trail is read forwards: the argument is what happened
// and in what order, and newest-first would show the outcome before the reason.
// ----------------------------------------------------------------------------
annotate InvoiceService.InvoiceApprovals with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Approval Step',
            TypeNamePlural : 'Approval Trail',
            Title          : { Value: action },
            Description    : { Value: action_by }
        },

        PresentationVariant: {
            SortOrder: [ { Property: sequence, Descending: false } ],
            Visualizations: ['@UI.LineItem']
        },

        LineItem: [
            { Value: sequence,        Label: 'Step',    ![@UI.Importance]: #High },
            { Value: action,          Label: 'Action',  ![@UI.Importance]: #High },
            { Value: action_by,       Label: 'By',      ![@UI.Importance]: #High },
            { Value: action_date,     Label: 'When',    ![@UI.Importance]: #High },
            { Value: comments,        Label: 'Comment', ![@UI.Importance]: #High },
            { Value: invoice_amount,  Label: 'Amount',  ![@UI.Importance]: #Medium },
            { Value: variance_amount, Label: 'Variance',![@UI.Importance]: #Medium },
            { Value: within_limit,    Label: 'In limit',![@UI.Importance]: #Medium }
        ],

        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'ApprovalAct',
              Target: '@UI.FieldGroup#ApprovalAct', Label: 'What was done' },
            { $Type: 'UI.ReferenceFacet', ID: 'ApprovalLimit',
              Target: '@UI.FieldGroup#ApprovalLimit', Label: 'Authority and escalation' }
        ],

        FieldGroup#ApprovalAct: {
            Data: [
                { Value: sequence, Label: 'Step' },
                { Value: action, Label: 'Action' },
                { Value: action_by, Label: 'Performed by' },
                { Value: action_date, Label: 'Performed at' },
                { Value: comments, Label: 'Comment' },
                { Value: rejection_reason, Label: 'Rejection reason' }
            ]
        },

        // INV-008, approval value limits per role. approver_limit and
        // within_limit are null on all three seeded rows because no limit is
        // enforced anywhere - the fields are shown ANYWAY, empty, because a
        // control that is designed and not built should read as absent rather
        // than be invisible.
        FieldGroup#ApprovalLimit: {
            Data: [
                { Value: invoice_amount, Label: 'Invoice amount' },
                { Value: variance_amount, Label: 'Variance amount' },
                { Value: approver_limit, Label: 'Approver limit' },
                { Value: within_limit, Label: 'Within limit' },
                { Value: escalated_to, Label: 'Escalated to' },
                { Value: escalation_reason, Label: 'Escalation reason' }
            ]
        }
    }
);

annotate InvoiceService.InvoiceApprovals with {
    ID                @UI.Hidden;
    invoice           @title: 'Invoice';
    sequence          @title: 'Step';
    action            @title: 'Action';
    action_date       @title: 'Performed At';
    action_by         @title: 'Performed By';
    comments          @title: 'Comment' @UI.MultiLineText;
    rejection_reason  @title: 'Rejection Reason' @UI.MultiLineText;
    invoice_amount    @title: 'Invoice Amount';
    variance_amount   @title: 'Variance Amount';
    approver_limit    @title: 'Approver Limit';
    within_limit      @title: 'Within Limit';
    escalated_to      @title: 'Escalated To';
    escalation_reason @title: 'Escalation Reason' @UI.MultiLineText;
};

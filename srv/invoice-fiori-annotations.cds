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
            match_status
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
            { Value: s4_document_number, Label: 'S/4 Doc', ![@UI.Importance]: #Low }
        ],

        PresentationVariant: {
            SortOrder: [
                { Property: invoice_date, Descending: true }
            ],
            Visualizations: [ '@UI.LineItem' ]
        },

        HeaderFacets: [
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
                ID     : 'Matching',
                Label  : 'Matching',
                Target : '@UI.FieldGroup#ItemMatching'
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

    contract @(
        Common: {
            Text: contract.contract_number,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Contracts',
                CollectionPath: 'Contracts',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: contract_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'contract_number' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'contract_name' }
                ]
            }
        }
    );
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
            { Value: severity,        Label: 'Severity',   ![@UI.Importance]: #High },
            { Value: check_code,      Label: 'Check',      ![@UI.Importance]: #High },
            { Value: message,         Label: 'What happened', ![@UI.Importance]: #High },
            { Value: line_number,     Label: 'Line',       ![@UI.Importance]: #Medium },
            { Value: is_gating,       Label: 'Gating',     ![@UI.Importance]: #High },
            // THE ANSWER TO "IS THE THRESHOLD HARDCODED", without anyone
            // having to ask. TOLERANCE_LADDER means a configured rung decided
            // this; REGISTRY_DEFAULT means the registry did.
            { Value: severity_source, Label: 'Decided by', ![@UI.Importance]: #High },
            { Value: status,          Label: 'Status',     ![@UI.Importance]: #Medium },
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
                { Value: threshold_crossed, Label: 'Threshold crossed' }
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

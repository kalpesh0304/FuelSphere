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

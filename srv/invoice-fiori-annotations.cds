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
            verification_status,
            matching_status
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
                Value: verification_status,
                Label: 'Verification',
                Criticality: verificationCriticality,
                ![@UI.Importance]: #Medium
            },
            {
                Value: matching_status,
                Label: 'Matching',
                Criticality: matchingCriticality,
                ![@UI.Importance]: #Medium
            },
            { Value: due_date, Label: 'Due Date', ![@UI.Importance]: #Medium },
            { Value: s4_invoice_doc, Label: 'S/4 Doc', ![@UI.Importance]: #Low }
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
                { Value: verification_status, Label: 'Verification', Criticality: verificationCriticality }
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
                { Value: matching_status, Label: 'Matching', Criticality: matchingCriticality },
                { Value: variance_amount, Label: 'Variance' }
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
                { Value: external_reference, Label: 'External Reference' },
                { Value: invoice_date, Label: 'Invoice Date' },
                { Value: receipt_date, Label: 'Receipt Date' },
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
                { Value: supplier_invoice_number, Label: 'Supplier Invoice #' },
                { Value: contract.contract_number, Label: 'Contract' }
            ]
        },

        FieldGroup#AmountDetails: {
            Label: 'Amount Details',
            Data: [
                { Value: net_amount, Label: 'Net Amount' },
                { Value: tax_amount, Label: 'Tax Amount' },
                { Value: gross_amount, Label: 'Gross Amount' },
                { Value: currency_code, Label: 'Currency' },
                { Value: exchange_rate, Label: 'Exchange Rate' },
                { Value: local_currency_amount, Label: 'Local Currency Amount' },
                { Value: local_currency, Label: 'Local Currency' }
            ]
        },

        FieldGroup#ThreeWayMatching: {
            Label: 'Three-Way Matching',
            Data: [
                { Value: verification_status, Label: 'Verification Status' },
                { Value: matching_status, Label: 'Matching Status' },
                { Value: po_amount, Label: 'PO Amount' },
                { Value: gr_amount, Label: 'GR Amount' },
                { Value: invoice_amount, Label: 'Invoice Amount' },
                { Value: variance_amount, Label: 'Variance Amount' },
                { Value: variance_percentage, Label: 'Variance %' },
                { Value: tolerance_exceeded, Label: 'Tolerance Exceeded' },
                { Value: matched_at, Label: 'Matched At' },
                { Value: matched_by, Label: 'Matched By' }
            ]
        },

        FieldGroup#InvoiceS4: {
            Label: 'S/4HANA Integration',
            Data: [
                { Value: s4_invoice_doc, Label: 'Invoice Document' },
                { Value: s4_fiscal_year, Label: 'Fiscal Year' },
                { Value: s4_company_code, Label: 'Company Code' },
                { Value: s4_posting_date, Label: 'Posting Date' },
                { Value: s4_document_date, Label: 'Document Date' }
            ]
        },

        FieldGroup#Workflow: {
            Label: 'Approval Workflow',
            Data: [
                { Value: submitted_by, Label: 'Submitted By' },
                { Value: submitted_at, Label: 'Submitted At' },
                { Value: approved_by, Label: 'Approved By' },
                { Value: approved_at, Label: 'Approved At' },
                { Value: rejected_by, Label: 'Rejected By' },
                { Value: rejected_at, Label: 'Rejected At' },
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
    invoice_date         @title: 'Invoice Date' @mandatory;
    due_date             @title: 'Due Date';
    net_amount           @title: 'Net Amount' @Measures.ISOCurrency: currency_code;
    tax_amount           @title: 'Tax Amount' @Measures.ISOCurrency: currency_code;
    gross_amount         @title: 'Gross Amount' @Measures.ISOCurrency: currency_code;
    currency_code        @title: 'Currency';
    status               @title: 'Status';
    verification_status  @title: 'Verification Status';
    matching_status      @title: 'Matching Status';
    variance_amount      @title: 'Variance' @Measures.ISOCurrency: currency_code;
};

// =============================================================================
// INVOICE LINE ITEMS
// =============================================================================

annotate InvoiceService.InvoiceItems with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Invoice Item',
            TypeNamePlural : 'Invoice Items',
            Title          : { Value: item_number }
        },

        LineItem: [
            { Value: item_number, Label: 'Item', ![@UI.Importance]: #High },
            { Value: description, Label: 'Description', ![@UI.Importance]: #High },
            { Value: quantity, Label: 'Quantity', ![@UI.Importance]: #High },
            { Value: unit_price, Label: 'Unit Price', ![@UI.Importance]: #High },
            { Value: net_amount, Label: 'Net Amount', ![@UI.Importance]: #High },
            { Value: tax_code, Label: 'Tax Code', ![@UI.Importance]: #Medium },
            { Value: tax_amount, Label: 'Tax Amount', ![@UI.Importance]: #Medium },
            { Value: po_item, Label: 'PO Item', ![@UI.Importance]: #Low },
            { Value: gr_item, Label: 'GR Item', ![@UI.Importance]: #Low }
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
                { Value: item_number, Label: 'Item Number' },
                { Value: description, Label: 'Description' },
                { Value: product.product_name, Label: 'Product' },
                { Value: quantity, Label: 'Quantity' },
                { Value: uom_code, Label: 'UoM' },
                { Value: unit_price, Label: 'Unit Price' },
                { Value: net_amount, Label: 'Net Amount' },
                { Value: tax_code, Label: 'Tax Code' },
                { Value: tax_amount, Label: 'Tax Amount' },
                { Value: gross_amount, Label: 'Gross Amount' }
            ]
        },

        FieldGroup#ItemMatching: {
            Data: [
                { Value: po_number, Label: 'PO Number' },
                { Value: po_item, Label: 'PO Item' },
                { Value: gr_number, Label: 'GR Number' },
                { Value: gr_item, Label: 'GR Item' },
                { Value: matched_quantity, Label: 'Matched Quantity' },
                { Value: variance_quantity, Label: 'Variance Quantity' }
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

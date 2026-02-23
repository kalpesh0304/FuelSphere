/**
 * FuelSphere - Allocation Service Fiori Annotations (FDD-09)
 *
 * Screens:
 * - COST_ALLOCATION_001: Cost Allocations (List Report + Object Page)
 * - ALLOCATION_RULE_001: Allocation Rules (List Report + Object Page)
 * - ALLOCATION_RUN_001: Allocation Runs (List Report + Object Page)
 */

using CostAllocationService as service from './allocation-service';

// =============================================================================
// COST ALLOCATIONS - List Report + Object Page
// =============================================================================

annotate service.CostAllocations with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: false }
    }
);

annotate service.CostAllocations with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Cost Allocation',
            TypeNamePlural : 'Cost Allocations',
            Title          : { Value: cost_center },
            Description    : { Value: period },
            ImageUrl       : 'sap-icon://money-bills'
        },

        SelectionFields: [
            period,
            company_code,
            cost_center,
            allocation_type,
            status,
            currency_code
        ],

        LineItem: [
            { Value: period, Label: 'Period', ![@UI.Importance]: #High },
            { Value: company_code, Label: 'Company', ![@UI.Importance]: #High },
            { Value: cost_center, Label: 'Cost Center', ![@UI.Importance]: #High },
            { Value: gl_account, Label: 'G/L Account', ![@UI.Importance]: #Medium },
            { Value: allocated_amount, Label: 'Amount', ![@UI.Importance]: #High },
            { Value: currency_code, Label: 'Currency', ![@UI.Importance]: #Medium },
            { Value: allocation_type, Label: 'Type', ![@UI.Importance]: #High },
            { Value: status, Label: 'Status', ![@UI.Importance]: #High }
        ],

        PresentationVariant: {
            SortOrder: [{ Property: allocation_date, Descending: true }],
            Visualizations: [ '@UI.LineItem' ]
        },

        HeaderFacets: [
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#AllocatedAmount',
                Label  : 'Allocated Amount'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#AllocationType',
                Label  : 'Type'
            }
        ],

        DataPoint#AllocatedAmount: {
            Value: allocated_amount,
            Title: 'Allocated Amount'
        },

        DataPoint#AllocationType: {
            Value: allocation_type,
            Title: 'Allocation Type'
        },

        // Object Page Sections (4)
        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'AllocationDetails',
                Label  : 'Allocation Details',
                Target : '@UI.FieldGroup#AllocationDetails'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'CostAssignment',
                Label  : 'Cost Assignment',
                Target : '@UI.FieldGroup#CostAssignment'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'S4Posting',
                Label  : 'S/4HANA Posting',
                Target : '@UI.FieldGroup#S4Posting'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Administrative',
                Label  : 'Administrative',
                Target : '@UI.FieldGroup#AllocAdmin'
            }
        ],

        FieldGroup#AllocationDetails: {
            Label: 'Allocation Details',
            Data: [
                { Value: allocation_date, Label: 'Allocation Date' },
                { Value: period, Label: 'Period' },
                { Value: allocation_type, Label: 'Type' },
                { Value: allocated_amount, Label: 'Amount' },
                { Value: currency_code, Label: 'Currency' },
                { Value: status, Label: 'Status' }
            ]
        },

        FieldGroup#CostAssignment: {
            Label: 'Cost Assignment',
            Data: [
                { Value: company_code, Label: 'Company Code' },
                { Value: cost_center, Label: 'Cost Center' },
                { Value: internal_order, Label: 'Internal Order' },
                { Value: profit_center, Label: 'Profit Center' },
                { Value: wbs_element, Label: 'WBS Element' },
                { Value: gl_account, Label: 'G/L Account' },
                { Value: copa_segment, Label: 'CO-PA Segment' },
                { Value: copa_route, Label: 'CO-PA Route' },
                { Value: copa_aircraft_type, Label: 'CO-PA Aircraft Type' }
            ]
        },

        FieldGroup#S4Posting: {
            Label: 'S/4HANA Posting',
            Data: [
                { Value: s4_document_number, Label: 'FI Document Number' },
                { Value: s4_fiscal_year, Label: 'Fiscal Year' },
                { Value: s4_posting_date, Label: 'Posting Date' },
                { Value: posting_error, Label: 'Posting Error' },
                { Value: requires_approval, Label: 'Requires Approval' },
                { Value: approved_by, Label: 'Approved By' },
                { Value: approved_at, Label: 'Approved At' }
            ]
        },

        FieldGroup#AllocAdmin: {
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

annotate service.CostAllocations with {
    allocation_date  @title: 'Allocation Date';
    period           @title: 'Period';
    company_code     @title: 'Company Code';
    cost_center      @title: 'Cost Center';
    gl_account       @title: 'G/L Account';
    allocated_amount @title: 'Amount';
    currency_code    @title: 'Currency';
    allocation_type  @title: 'Type';
    status           @title: 'Status';
};

// =============================================================================
// ALLOCATION RULES - List Report + Object Page
// =============================================================================

annotate service.AllocationRules with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: true }
    }
);

annotate service.AllocationRules with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Allocation Rule',
            TypeNamePlural : 'Allocation Rules',
            Title          : { Value: rule_name },
            Description    : { Value: rule_code },
            ImageUrl       : 'sap-icon://detail-view'
        },

        SelectionFields: [
            rule_code,
            rule_name,
            allocation_method,
            is_active
        ],

        LineItem: [
            { Value: rule_code, Label: 'Rule Code', ![@UI.Importance]: #High },
            { Value: rule_name, Label: 'Rule Name', ![@UI.Importance]: #High },
            { Value: allocation_method, Label: 'Method', ![@UI.Importance]: #High },
            { Value: effective_from, Label: 'Effective From', ![@UI.Importance]: #Medium },
            { Value: effective_to, Label: 'Effective To', ![@UI.Importance]: #Medium },
            { Value: is_active, Label: 'Active', ![@UI.Importance]: #High }
        ],

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'RuleDetails',
                Label  : 'Rule Details',
                Target : '@UI.FieldGroup#RuleDetails'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'RuleValidation',
                Label  : 'Validation',
                Target : '@UI.FieldGroup#RuleValidation'
            }
        ],

        FieldGroup#RuleDetails: {
            Label: 'Rule Details',
            Data: [
                { Value: rule_code, Label: 'Rule Code' },
                { Value: rule_name, Label: 'Rule Name' },
                { Value: description, Label: 'Description' },
                { Value: allocation_method, Label: 'Allocation Method' },
                { Value: allocation_basis, Label: 'Allocation Basis' },
                { Value: effective_from, Label: 'Effective From' },
                { Value: effective_to, Label: 'Effective To' },
                { Value: is_active, Label: 'Active' }
            ]
        },

        FieldGroup#RuleValidation: {
            Label: 'Validation',
            Data: [
                { Value: last_validated_at, Label: 'Last Validated' },
                { Value: validation_status, Label: 'Validation Status' }
            ]
        }
    }
);

annotate service.AllocationRules with {
    rule_code         @title: 'Rule Code';
    rule_name         @title: 'Rule Name';
    allocation_method @title: 'Allocation Method';
};

// =============================================================================
// ALLOCATION RUNS - List Report + Object Page
// =============================================================================

annotate service.AllocationRuns with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: false }
    }
);

annotate service.AllocationRuns with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Allocation Run',
            TypeNamePlural : 'Allocation Runs',
            Title          : { Value: run_id },
            Description    : { Value: period },
            ImageUrl       : 'sap-icon://process'
        },

        SelectionFields: [
            run_id,
            period,
            status,
            run_type
        ],

        LineItem: [
            { Value: run_id, Label: 'Run ID', ![@UI.Importance]: #High },
            { Value: period, Label: 'Period', ![@UI.Importance]: #High },
            { Value: run_type, Label: 'Type', ![@UI.Importance]: #High },
            { Value: total_records, Label: 'Records', ![@UI.Importance]: #Medium },
            { Value: total_amount, Label: 'Total Amount', ![@UI.Importance]: #High },
            { Value: started_at, Label: 'Started', ![@UI.Importance]: #Medium },
            { Value: completed_at, Label: 'Completed', ![@UI.Importance]: #Medium },
            { Value: status, Label: 'Status', ![@UI.Importance]: #High }
        ],

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'RunDetails',
                Label  : 'Run Details',
                Target : '@UI.FieldGroup#RunDetails'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'RunResults',
                Label  : 'Results',
                Target : '@UI.FieldGroup#RunResults'
            }
        ],

        FieldGroup#RunDetails: {
            Label: 'Run Details',
            Data: [
                { Value: run_id, Label: 'Run ID' },
                { Value: period, Label: 'Period' },
                { Value: run_type, Label: 'Run Type' },
                { Value: status, Label: 'Status' },
                { Value: started_at, Label: 'Started At' },
                { Value: started_by, Label: 'Started By' }
            ]
        },

        FieldGroup#RunResults: {
            Label: 'Results',
            Data: [
                { Value: total_records, Label: 'Total Records' },
                { Value: success_count, Label: 'Success Count' },
                { Value: error_count, Label: 'Error Count' },
                { Value: total_amount, Label: 'Total Amount' },
                { Value: completed_at, Label: 'Completed At' }
            ]
        }
    }
);

annotate service.AllocationRuns with {
    run_id        @title: 'Run ID';
    period        @title: 'Period';
    run_type      @title: 'Run Type';
    status        @title: 'Status';
    total_records @title: 'Total Records';
    total_amount  @title: 'Total Amount';
};

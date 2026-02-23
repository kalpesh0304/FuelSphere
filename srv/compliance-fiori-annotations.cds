/**
 * FuelSphere - Compliance Service Fiori Annotations (FDD-07)
 *
 * Screens:
 * - SANCTION_LIST_001: Sanction Lists (List Report + Object Page)
 * - COMPLIANCE_EXCEPTION_001: Compliance Exceptions (List Report + Object Page)
 */

using ComplianceService as service from './compliance-service';

// =============================================================================
// SANCTION LISTS - List Report + Object Page
// =============================================================================

annotate service.SanctionLists with @(
    Common.SemanticKey: [list_code],
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: false }
    }
);

annotate service.SanctionLists with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Sanction List',
            TypeNamePlural : 'Sanction Lists',
            Title          : { Value: list_name },
            Description    : { Value: list_code },
            ImageUrl       : 'sap-icon://shield'
        },

        SelectionFields: [
            list_code,
            list_name,
            jurisdiction,
            update_frequency,
            is_active
        ],

        LineItem: [
            { Value: list_code, Label: 'List Code', ![@UI.Importance]: #High },
            { Value: list_name, Label: 'List Name', ![@UI.Importance]: #High },
            { Value: jurisdiction, Label: 'Jurisdiction', ![@UI.Importance]: #High },
            { Value: entity_count, Label: 'Entities', ![@UI.Importance]: #Medium },
            { Value: last_update, Label: 'Last Update', ![@UI.Importance]: #High },
            { Value: update_frequency, Label: 'Frequency', ![@UI.Importance]: #Medium },
            { Value: version, Label: 'Version', ![@UI.Importance]: #Medium },
            { Value: is_active, Label: 'Active', ![@UI.Importance]: #High }
        ],

        PresentationVariant: {
            SortOrder: [{ Property: list_code, Descending: false }],
            Visualizations: [ '@UI.LineItem' ]
        },

        // Object Page Header
        HeaderFacets: [
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#EntityCount',
                Label  : 'Entity Count'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#Jurisdiction',
                Label  : 'Jurisdiction'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#LastUpdate',
                Label  : 'Last Update'
            }
        ],

        DataPoint#EntityCount: {
            Value: entity_count,
            Title: 'Sanctioned Entities'
        },

        DataPoint#Jurisdiction: {
            Value: jurisdiction,
            Title: 'Jurisdiction'
        },

        DataPoint#LastUpdate: {
            Value: last_update,
            Title: 'Last Updated'
        },

        // Object Page Sections (4)
        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'ListDetails',
                Label  : 'List Details',
                Target : '@UI.FieldGroup#ListDetails'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'SanctionedEntities',
                Label  : 'Sanctioned Entities',
                Target : 'entities/@UI.LineItem'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'UpdateSchedule',
                Label  : 'Update Schedule',
                Target : '@UI.FieldGroup#UpdateSchedule'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Administrative',
                Label  : 'Administrative',
                Target : '@UI.FieldGroup#SanctionAdmin'
            }
        ],

        FieldGroup#ListDetails: {
            Label: 'List Details',
            Data: [
                { Value: list_code, Label: 'List Code' },
                { Value: list_name, Label: 'List Name' },
                { Value: jurisdiction, Label: 'Jurisdiction' },
                { Value: description, Label: 'Description' },
                { Value: source_url, Label: 'Source URL' },
                { Value: is_active, Label: 'Active' }
            ]
        },

        FieldGroup#UpdateSchedule: {
            Label: 'Update Schedule',
            Data: [
                { Value: update_frequency, Label: 'Frequency' },
                { Value: last_update, Label: 'Last Update' },
                { Value: version, Label: 'Version' },
                { Value: entity_count, Label: 'Entity Count' }
            ]
        },

        FieldGroup#SanctionAdmin: {
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
annotate service.SanctionLists with {
    list_code        @title: 'List Code';
    list_name        @title: 'List Name';
    jurisdiction     @title: 'Jurisdiction';
    entity_count     @title: 'Entity Count';
    last_update      @title: 'Last Update';
    update_frequency @title: 'Update Frequency';
    version          @title: 'Version';
    source_url       @title: 'Source URL';
    description      @title: 'Description';
};

// Sanctioned Entities - Inline table
annotate service.SanctionedEntities with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Sanctioned Entity',
            TypeNamePlural : 'Sanctioned Entities'
        },
        LineItem: [
            { Value: entity_name, Label: 'Entity Name', ![@UI.Importance]: #High },
            { Value: entity_type, Label: 'Type', ![@UI.Importance]: #High },
            { Value: country_codes, Label: 'Countries', ![@UI.Importance]: #Medium },
            { Value: listed_date, Label: 'Listed Date', ![@UI.Importance]: #Medium },
            { Value: reason, Label: 'Reason', ![@UI.Importance]: #Medium },
            { Value: is_active, Label: 'Active', ![@UI.Importance]: #High }
        ]
    }
);

// =============================================================================
// COMPLIANCE EXCEPTIONS - List Report + Object Page
// =============================================================================

annotate service.ComplianceExceptions with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: false }
    }
);

annotate service.ComplianceExceptions with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Compliance Exception',
            TypeNamePlural : 'Compliance Exceptions',
            Title          : { Value: exception_reason },
            Description    : { Value: status },
            ImageUrl       : 'sap-icon://alert'
        },

        SelectionFields: [
            status,
            risk_level,
            exception_type,
            requested_by
        ],

        LineItem: [
            { Value: exception_reason, Label: 'Reason', ![@UI.Importance]: #High },
            { Value: exception_type, Label: 'Type', ![@UI.Importance]: #High },
            { Value: risk_level, Label: 'Risk Level', ![@UI.Importance]: #High },
            { Value: requested_by, Label: 'Requested By', ![@UI.Importance]: #Medium },
            { Value: valid_from, Label: 'Valid From', ![@UI.Importance]: #Medium },
            { Value: valid_to, Label: 'Valid To', ![@UI.Importance]: #Medium },
            { Value: status, Label: 'Status', ![@UI.Importance]: #High }
        ],

        PresentationVariant: {
            SortOrder: [{ Property: created_at, Descending: true }],
            Visualizations: [ '@UI.LineItem' ]
        },

        // Object Page Sections (3)
        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'ExceptionDetails',
                Label  : 'Exception Details',
                Target : '@UI.FieldGroup#CompExceptionDetails'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Justification',
                Label  : 'Justification',
                Target : '@UI.FieldGroup#Justification'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Approval',
                Label  : 'Approval',
                Target : '@UI.FieldGroup#CompApproval'
            }
        ],

        FieldGroup#CompExceptionDetails: {
            Label: 'Exception Details',
            Data: [
                { Value: exception_reason, Label: 'Exception Reason' },
                { Value: exception_type, Label: 'Exception Type' },
                { Value: risk_level, Label: 'Risk Level' },
                { Value: status, Label: 'Status' },
                { Value: valid_from, Label: 'Valid From' },
                { Value: valid_to, Label: 'Valid To' }
            ]
        },

        FieldGroup#Justification: {
            Label: 'Justification',
            Data: [
                { Value: business_justification, Label: 'Business Justification' },
                { Value: compensating_controls, Label: 'Compensating Controls' },
                { Value: requested_by, Label: 'Requested By' },
                { Value: requested_at, Label: 'Requested At' }
            ]
        },

        FieldGroup#CompApproval: {
            Label: 'Approval',
            Data: [
                { Value: compliance_approver, Label: 'Compliance Approver' },
                { Value: compliance_approved_at, Label: 'Compliance Approved At' },
                { Value: legal_approver, Label: 'Legal Approver' },
                { Value: legal_approved_at, Label: 'Legal Approved At' },
                { Value: rejection_reason, Label: 'Rejection Reason' }
            ]
        }
    }
);

annotate service.ComplianceExceptions with {
    exception_reason  @title: 'Exception Reason';
    exception_type    @title: 'Exception Type';
    risk_level        @title: 'Risk Level';
    status            @title: 'Status';
    requested_by      @title: 'Requested By';
};

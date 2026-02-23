/**
 * FuelSphere - Security Service Fiori Annotations (FDD-13)
 *
 * Screens:
 * - SECURITY_USER_001: Security Users (List Report + Object Page)
 * - SOD_RULE_001: SoD Rules (List Report + Object Page)
 * - SOD_EXCEPTION_001: SoD Exceptions (List Report + Object Page)
 * - SECURITY_INCIDENT_001: Security Incidents (List Report + Object Page)
 * - ACCESS_REVIEW_001: Access Review Campaigns (List Report + Object Page)
 * - SECURITY_CONFIG_001: Security Configurations (List Report + Object Page)
 */

using SecurityService as service from './security-service';

// =============================================================================
// SECURITY USERS - List Report + Object Page
// =============================================================================

annotate service.SecurityUsers with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: false }
    }
);

annotate service.SecurityUsers with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Security User',
            TypeNamePlural : 'Security Users',
            Title          : { Value: display_name },
            Description    : { Value: email },
            ImageUrl       : 'sap-icon://person-placeholder'
        },

        SelectionFields: [
            user_name,
            email,
            display_name,
            department,
            status,
            mfa_enabled,
            is_active
        ],

        LineItem: [
            { Value: display_name, Label: 'Name', ![@UI.Importance]: #High },
            { Value: email, Label: 'Email', ![@UI.Importance]: #High },
            { Value: department, Label: 'Department', ![@UI.Importance]: #Medium },
            { Value: job_title, Label: 'Job Title', ![@UI.Importance]: #Medium },
            { Value: status, Label: 'Status', ![@UI.Importance]: #High },
            { Value: mfa_enabled, Label: 'MFA', ![@UI.Importance]: #Medium },
            { Value: last_login_time, Label: 'Last Login', ![@UI.Importance]: #Medium },
            { Value: is_active, Label: 'Active', ![@UI.Importance]: #High }
        ],

        PresentationVariant: {
            SortOrder: [{ Property: display_name, Descending: false }],
            Visualizations: [ '@UI.LineItem' ]
        },

        // Object Page Header
        HeaderFacets: [
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#UserStatus',
                Label  : 'Status'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#LastLogin',
                Label  : 'Last Login'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#MFAEnabled',
                Label  : 'MFA'
            }
        ],

        FieldGroup#UserStatus: {
            Data: [
                { Value: status, Label: 'Status' },
                { Value: is_active, Label: 'Active' }
            ]
        },

        DataPoint#LastLogin: {
            Value: last_login_time,
            Title: 'Last Login'
        },

        DataPoint#MFAEnabled: {
            Value: mfa_enabled,
            Title: 'MFA Enabled'
        },

        // Object Page Sections (6)
        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'UserDetails',
                Label  : 'User Details',
                Target : '@UI.FieldGroup#UserDetails'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Organization',
                Label  : 'Organization',
                Target : '@UI.FieldGroup#Organization'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'RoleAssignments',
                Label  : 'Role Assignments',
                Target : 'role_assignments/@UI.LineItem'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'LoginActivity',
                Label  : 'Login Activity',
                Target : '@UI.FieldGroup#LoginActivity'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Lifecycle',
                Label  : 'Lifecycle',
                Target : '@UI.FieldGroup#UserLifecycle'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Administrative',
                Label  : 'Administrative',
                Target : '@UI.FieldGroup#SecurityUserAdmin'
            }
        ],

        FieldGroup#UserDetails: {
            Label: 'User Details',
            Data: [
                { Value: display_name, Label: 'Display Name' },
                { Value: first_name, Label: 'First Name' },
                { Value: last_name, Label: 'Last Name' },
                { Value: email, Label: 'Email' },
                { Value: user_name, Label: 'Username' },
                { Value: ias_user_id, Label: 'IAS User ID' },
                { Value: employee_id, Label: 'Employee ID' },
                { Value: phone, Label: 'Phone' },
                { Value: mobile, Label: 'Mobile' }
            ]
        },

        FieldGroup#Organization: {
            Label: 'Organization',
            Data: [
                { Value: department, Label: 'Department' },
                { Value: job_title, Label: 'Job Title' },
                { Value: cost_center, Label: 'Cost Center' },
                { Value: company_code, Label: 'Company Code' },
                { Value: location, Label: 'Location' },
                { Value: manager.display_name, Label: 'Manager' },
                { Value: employment_status, Label: 'Employment Status' },
                { Value: employment_end_date, Label: 'Employment End Date' }
            ]
        },

        FieldGroup#LoginActivity: {
            Label: 'Login Activity',
            Data: [
                { Value: last_login_time, Label: 'Last Login' },
                { Value: last_login_ip, Label: 'Last Login IP' },
                { Value: failed_login_count, Label: 'Failed Login Count' },
                { Value: last_failed_login, Label: 'Last Failed Login' },
                { Value: password_changed_at, Label: 'Password Changed At' },
                { Value: mfa_enabled, Label: 'MFA Enabled' },
                { Value: locked_reason, Label: 'Lock Reason' },
                { Value: lock_expiry, Label: 'Lock Expiry' }
            ]
        },

        FieldGroup#UserLifecycle: {
            Label: 'Lifecycle',
            Data: [
                { Value: provisioned_date, Label: 'Provisioned Date' },
                { Value: provisioned_by, Label: 'Provisioned By' },
                { Value: deactivated_date, Label: 'Deactivated Date' },
                { Value: deactivated_by, Label: 'Deactivated By' },
                { Value: deactivation_reason, Label: 'Deactivation Reason' },
                { Value: status_reason, Label: 'Status Reason' }
            ]
        },

        FieldGroup#SecurityUserAdmin: {
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

annotate service.SecurityUsers with {
    display_name @title: 'Name';
    email        @title: 'Email';
    user_name    @title: 'Username';
    department   @title: 'Department';
    job_title    @title: 'Job Title';
    status       @title: 'Status';
    mfa_enabled  @title: 'MFA Enabled';
    is_active    @title: 'Active';
};

// Role Assignments - Inline table
annotate service.RoleAssignments with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Role Assignment',
            TypeNamePlural : 'Role Assignments'
        },
        LineItem: [
            { Value: role_template, Label: 'Role Template', ![@UI.Importance]: #High },
            { Value: assigned_by, Label: 'Assigned By', ![@UI.Importance]: #Medium },
            { Value: assigned_at, Label: 'Assigned At', ![@UI.Importance]: #Medium },
            { Value: valid_from, Label: 'Valid From', ![@UI.Importance]: #Medium },
            { Value: valid_to, Label: 'Valid To', ![@UI.Importance]: #Medium },
            { Value: justification, Label: 'Justification', ![@UI.Importance]: #Medium }
        ]
    }
);

// =============================================================================
// SOD RULES - List Report + Object Page
// =============================================================================

annotate service.SoDRules with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: true }
    }
);

annotate service.SoDRules with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'SoD Rule',
            TypeNamePlural : 'SoD Rules',
            Title          : { Value: rule_name },
            Description    : { Value: rule_code },
            ImageUrl       : 'sap-icon://locked'
        },

        SelectionFields: [
            rule_code,
            rule_name,
            risk_level,
            is_active
        ],

        LineItem: [
            { Value: rule_code, Label: 'Rule Code', ![@UI.Importance]: #High },
            { Value: rule_name, Label: 'Rule Name', ![@UI.Importance]: #High },
            { Value: risk_level, Label: 'Risk Level', ![@UI.Importance]: #High },
            { Value: conflicting_scope_1, Label: 'Scope 1', ![@UI.Importance]: #Medium },
            { Value: conflicting_scope_2, Label: 'Scope 2', ![@UI.Importance]: #Medium },
            { Value: violation_count, Label: 'Violations', ![@UI.Importance]: #Medium },
            { Value: is_active, Label: 'Active', ![@UI.Importance]: #High }
        ],

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'RuleDetails',
                Label  : 'Rule Details',
                Target : '@UI.FieldGroup#SoDRuleDetails'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Testing',
                Label  : 'Testing',
                Target : '@UI.FieldGroup#SoDTesting'
            }
        ],

        FieldGroup#SoDRuleDetails: {
            Label: 'Rule Details',
            Data: [
                { Value: rule_code, Label: 'Rule Code' },
                { Value: rule_name, Label: 'Rule Name' },
                { Value: description, Label: 'Description' },
                { Value: risk_level, Label: 'Risk Level' },
                { Value: conflicting_scope_1, Label: 'Conflicting Scope 1' },
                { Value: conflicting_scope_2, Label: 'Conflicting Scope 2' },
                { Value: mitigation_control, Label: 'Mitigation Control' },
                { Value: is_active, Label: 'Active' }
            ]
        },

        FieldGroup#SoDTesting: {
            Label: 'Testing',
            Data: [
                { Value: last_scan_at, Label: 'Last Scan' },
                { Value: violation_count, Label: 'Violation Count' },
                { Value: exception_count, Label: 'Exception Count' }
            ]
        }
    }
);

annotate service.SoDRules with {
    rule_code   @title: 'Rule Code';
    rule_name   @title: 'Rule Name';
    risk_level  @title: 'Risk Level';
};

// =============================================================================
// SOD EXCEPTIONS - List Report + Object Page
// =============================================================================

annotate service.SoDExceptions with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: false }
    }
);

annotate service.SoDExceptions with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'SoD Exception',
            TypeNamePlural : 'SoD Exceptions',
            Title          : { Value: exception_reason },
            Description    : { Value: status },
            ImageUrl       : 'sap-icon://permission'
        },

        SelectionFields: [
            status,
            risk_level,
            requested_by
        ],

        LineItem: [
            { Value: exception_reason, Label: 'Reason', ![@UI.Importance]: #High },
            { Value: risk_level, Label: 'Risk', ![@UI.Importance]: #High },
            { Value: requested_by, Label: 'Requested By', ![@UI.Importance]: #Medium },
            { Value: valid_from, Label: 'Valid From', ![@UI.Importance]: #Medium },
            { Value: valid_to, Label: 'Valid To', ![@UI.Importance]: #Medium },
            { Value: status, Label: 'Status', ![@UI.Importance]: #High }
        ],

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'ExceptionDetails',
                Label  : 'Exception Details',
                Target : '@UI.FieldGroup#SoDExceptionDetails'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Approval',
                Label  : 'Approval',
                Target : '@UI.FieldGroup#SoDApproval'
            }
        ],

        FieldGroup#SoDExceptionDetails: {
            Label: 'Exception Details',
            Data: [
                { Value: exception_reason, Label: 'Reason' },
                { Value: risk_level, Label: 'Risk Level' },
                { Value: compensating_controls, Label: 'Compensating Controls' },
                { Value: valid_from, Label: 'Valid From' },
                { Value: valid_to, Label: 'Valid To' },
                { Value: status, Label: 'Status' }
            ]
        },

        FieldGroup#SoDApproval: {
            Label: 'Approval',
            Data: [
                { Value: requested_by, Label: 'Requested By' },
                { Value: requested_at, Label: 'Requested At' },
                { Value: first_approver, Label: 'First Approver' },
                { Value: first_approved_at, Label: 'First Approved At' },
                { Value: second_approver, Label: 'Second Approver' },
                { Value: second_approved_at, Label: 'Second Approved At' },
                { Value: rejection_reason, Label: 'Rejection Reason' }
            ]
        }
    }
);

annotate service.SoDExceptions with {
    exception_reason @title: 'Reason';
    risk_level       @title: 'Risk Level';
    status           @title: 'Status';
};

// =============================================================================
// SECURITY INCIDENTS - List Report + Object Page
// =============================================================================

annotate service.SecurityIncidents with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: false }
    }
);

annotate service.SecurityIncidents with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Security Incident',
            TypeNamePlural : 'Security Incidents',
            Title          : { Value: incident_title },
            Description    : { Value: incident_id },
            ImageUrl       : 'sap-icon://warning'
        },

        SelectionFields: [
            incident_id,
            incident_type,
            severity,
            status
        ],

        LineItem: [
            { Value: incident_id, Label: 'Incident ID', ![@UI.Importance]: #High },
            { Value: incident_title, Label: 'Title', ![@UI.Importance]: #High },
            { Value: incident_type, Label: 'Type', ![@UI.Importance]: #High },
            { Value: severity, Label: 'Severity', ![@UI.Importance]: #High },
            { Value: detected_at, Label: 'Detected', ![@UI.Importance]: #Medium },
            { Value: assigned_to, Label: 'Assigned To', ![@UI.Importance]: #Medium },
            { Value: status, Label: 'Status', ![@UI.Importance]: #High }
        ],

        PresentationVariant: {
            SortOrder: [{ Property: detected_at, Descending: true }],
            Visualizations: [ '@UI.LineItem' ]
        },

        HeaderFacets: [
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#Severity',
                Label  : 'Severity'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#IncidentStatus',
                Label  : 'Status'
            }
        ],

        DataPoint#Severity: {
            Value: severity,
            Title: 'Severity'
        },

        DataPoint#IncidentStatus: {
            Value: status,
            Title: 'Status'
        },

        // Object Page Sections (3)
        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'IncidentDetails',
                Label  : 'Incident Details',
                Target : '@UI.FieldGroup#IncidentDetails'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Investigation',
                Label  : 'Investigation',
                Target : '@UI.FieldGroup#IncidentInvestigation'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Resolution',
                Label  : 'Resolution',
                Target : '@UI.FieldGroup#IncidentResolution'
            }
        ],

        FieldGroup#IncidentDetails: {
            Label: 'Incident Details',
            Data: [
                { Value: incident_id, Label: 'Incident ID' },
                { Value: incident_title, Label: 'Title' },
                { Value: incident_type, Label: 'Type' },
                { Value: severity, Label: 'Severity' },
                { Value: description, Label: 'Description' },
                { Value: detected_at, Label: 'Detected At' },
                { Value: detection_source, Label: 'Detection Source' },
                { Value: affected_users, Label: 'Affected Users' },
                { Value: status, Label: 'Status' }
            ]
        },

        FieldGroup#IncidentInvestigation: {
            Label: 'Investigation',
            Data: [
                { Value: assigned_to, Label: 'Assigned To' },
                { Value: investigation_started_at, Label: 'Investigation Started' },
                { Value: root_cause, Label: 'Root Cause' },
                { Value: investigation_notes, Label: 'Investigation Notes' },
                { Value: evidence, Label: 'Evidence' }
            ]
        },

        FieldGroup#IncidentResolution: {
            Label: 'Resolution',
            Data: [
                { Value: resolution_action, Label: 'Resolution Action' },
                { Value: prevention_measures, Label: 'Prevention Measures' },
                { Value: resolved_by, Label: 'Resolved By' },
                { Value: resolved_at, Label: 'Resolved At' },
                { Value: closed_at, Label: 'Closed At' }
            ]
        }
    }
);

annotate service.SecurityIncidents with {
    incident_id    @title: 'Incident ID';
    incident_title @title: 'Title';
    incident_type  @title: 'Type';
    severity       @title: 'Severity';
    status         @title: 'Status';
    assigned_to    @title: 'Assigned To';
};

// =============================================================================
// ACCESS REVIEW CAMPAIGNS - List Report + Object Page
// =============================================================================

annotate service.AccessReviewCampaigns with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: false }
    }
);

annotate service.AccessReviewCampaigns with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Access Review',
            TypeNamePlural : 'Access Reviews',
            Title          : { Value: campaign_name },
            Description    : { Value: campaign_id },
            ImageUrl       : 'sap-icon://checklist-item'
        },

        SelectionFields: [
            campaign_id,
            campaign_name,
            status,
            deadline
        ],

        LineItem: [
            { Value: campaign_id, Label: 'Campaign ID', ![@UI.Importance]: #High },
            { Value: campaign_name, Label: 'Campaign', ![@UI.Importance]: #High },
            { Value: scope, Label: 'Scope', ![@UI.Importance]: #Medium },
            { Value: deadline, Label: 'Deadline', ![@UI.Importance]: #High },
            { Value: completion_pct, Label: 'Completion %', ![@UI.Importance]: #Medium },
            { Value: status, Label: 'Status', ![@UI.Importance]: #High }
        ],

        PresentationVariant: {
            SortOrder: [{ Property: deadline, Descending: false }],
            Visualizations: [ '@UI.LineItem' ]
        },

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'CampaignDetails',
                Label  : 'Campaign Details',
                Target : '@UI.FieldGroup#CampaignDetails'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'ReviewItems',
                Label  : 'Review Items',
                Target : 'review_items/@UI.LineItem'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Completion',
                Label  : 'Completion & Evidence',
                Target : '@UI.FieldGroup#CampaignCompletion'
            }
        ],

        FieldGroup#CampaignDetails: {
            Label: 'Campaign Details',
            Data: [
                { Value: campaign_id, Label: 'Campaign ID' },
                { Value: campaign_name, Label: 'Campaign Name' },
                { Value: description, Label: 'Description' },
                { Value: scope, Label: 'Scope' },
                { Value: reviewer, Label: 'Reviewer' },
                { Value: deadline, Label: 'Deadline' },
                { Value: status, Label: 'Status' }
            ]
        },

        FieldGroup#CampaignCompletion: {
            Label: 'Completion & Evidence',
            Data: [
                { Value: completion_pct, Label: 'Completion %' },
                { Value: total_items, Label: 'Total Items' },
                { Value: reviewed_items, Label: 'Reviewed Items' },
                { Value: signed_off_by, Label: 'Signed Off By' },
                { Value: signed_off_at, Label: 'Signed Off At' }
            ]
        }
    }
);

annotate service.AccessReviewCampaigns with {
    campaign_id   @title: 'Campaign ID';
    campaign_name @title: 'Campaign';
    status        @title: 'Status';
    deadline      @title: 'Deadline';
    completion_pct @title: 'Completion %';
};

// Access Review Items - Inline table
annotate service.AccessReviewItems with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Review Item',
            TypeNamePlural : 'Review Items'
        },
        LineItem: [
            { Value: user_display_name, Label: 'User', ![@UI.Importance]: #High },
            { Value: role_template, Label: 'Role', ![@UI.Importance]: #High },
            { Value: decision, Label: 'Decision', ![@UI.Importance]: #High },
            { Value: reviewer, Label: 'Reviewer', ![@UI.Importance]: #Medium },
            { Value: reviewed_at, Label: 'Reviewed At', ![@UI.Importance]: #Medium },
            { Value: comments, Label: 'Comments', ![@UI.Importance]: #Medium }
        ]
    }
);

// =============================================================================
// SECURITY CONFIGURATIONS - List Report + Object Page
// =============================================================================

annotate service.SecurityConfigurations with @(
    Capabilities: {
        InsertRestrictions: { Insertable: false },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: false }
    }
);

annotate service.SecurityConfigurations with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Security Configuration',
            TypeNamePlural : 'Security Configurations',
            Title          : { Value: config_name },
            Description    : { Value: config_key },
            ImageUrl       : 'sap-icon://action-settings'
        },

        SelectionFields: [
            config_key,
            config_category,
            is_active
        ],

        LineItem: [
            { Value: config_key, Label: 'Key', ![@UI.Importance]: #High },
            { Value: config_name, Label: 'Name', ![@UI.Importance]: #High },
            { Value: config_value, Label: 'Value', ![@UI.Importance]: #High },
            { Value: config_category, Label: 'Category', ![@UI.Importance]: #Medium },
            { Value: is_active, Label: 'Active', ![@UI.Importance]: #High }
        ],

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'ConfigDetails',
                Label  : 'Configuration Details',
                Target : '@UI.FieldGroup#SecurityConfigDetails'
            }
        ],

        FieldGroup#SecurityConfigDetails: {
            Label: 'Configuration Details',
            Data: [
                { Value: config_key, Label: 'Configuration Key' },
                { Value: config_name, Label: 'Configuration Name' },
                { Value: config_value, Label: 'Value' },
                { Value: config_category, Label: 'Category' },
                { Value: description, Label: 'Description' },
                { Value: default_value, Label: 'Default Value' },
                { Value: is_active, Label: 'Active' }
            ]
        }
    }
);

annotate service.SecurityConfigurations with {
    config_key      @title: 'Key';
    config_name     @title: 'Name';
    config_value    @title: 'Value';
    config_category @title: 'Category';
};

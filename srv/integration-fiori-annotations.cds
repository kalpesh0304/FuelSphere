/**
 * FuelSphere - Integration Service Fiori Annotations (FDD-11)
 *
 * Screens:
 * - EXCEPTION_ITEM_001: Exception Items (List Report + Object Page)
 * - INTEGRATION_CONFIG_001: Integration Configs (List Report + Object Page)
 * - ALERT_DEFINITION_001: Alert Definitions (List Report + Object Page)
 */

using IntegrationService as service from './integration-service';

// =============================================================================
// EXCEPTION ITEMS - List Report + Object Page
// =============================================================================

annotate service.ExceptionItems with @(
    Capabilities: {
        InsertRestrictions: { Insertable: false },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: false }
    }
);

annotate service.ExceptionItems with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Exception Item',
            TypeNamePlural : 'Exception Items',
            Title          : { Value: error_message },
            Description    : { Value: source_system },
            ImageUrl       : 'sap-icon://message-warning'
        },

        SelectionFields: [
            source_system,
            message_type,
            severity,
            status,
            created_at
        ],

        LineItem: [
            { Value: source_system, Label: 'Source System', ![@UI.Importance]: #High },
            { Value: message_type, Label: 'Message Type', ![@UI.Importance]: #High },
            { Value: error_message, Label: 'Error', ![@UI.Importance]: #High },
            { Value: severity, Label: 'Severity', ![@UI.Importance]: #High },
            { Value: retry_count, Label: 'Retries', ![@UI.Importance]: #Medium },
            { Value: assigned_to, Label: 'Assigned To', ![@UI.Importance]: #Medium },
            { Value: created_at, Label: 'Created', ![@UI.Importance]: #Medium },
            { Value: status, Label: 'Status', ![@UI.Importance]: #High }
        ],

        PresentationVariant: {
            SortOrder: [{ Property: created_at, Descending: true }],
            Visualizations: [ '@UI.LineItem' ]
        },

        HeaderFacets: [
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#ExceptionSeverity',
                Label  : 'Severity'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#RetryCount',
                Label  : 'Retry Count'
            }
        ],

        DataPoint#ExceptionSeverity: {
            Value: severity,
            Title: 'Severity'
        },

        DataPoint#RetryCount: {
            Value: retry_count,
            Title: 'Retry Count'
        },

        // Object Page Sections (3)
        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'ExceptionDetails',
                Label  : 'Exception Details',
                Target : '@UI.FieldGroup#IntExceptionDetails'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'RetryInfo',
                Label  : 'Retry Information',
                Target : '@UI.FieldGroup#RetryInfo'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Resolution',
                Label  : 'Resolution',
                Target : '@UI.FieldGroup#IntResolution'
            }
        ],

        FieldGroup#IntExceptionDetails: {
            Label: 'Exception Details',
            Data: [
                { Value: source_system, Label: 'Source System' },
                { Value: message_type, Label: 'Message Type' },
                { Value: error_message, Label: 'Error Message' },
                { Value: error_code, Label: 'Error Code' },
                { Value: severity, Label: 'Severity' },
                { Value: source_entity_type, Label: 'Entity Type' },
                { Value: source_entity_id, Label: 'Entity ID' },
                { Value: status, Label: 'Status' }
            ]
        },

        FieldGroup#RetryInfo: {
            Label: 'Retry Information',
            Data: [
                { Value: retry_count, Label: 'Retry Count' },
                { Value: max_retries, Label: 'Max Retries' },
                { Value: last_retry_at, Label: 'Last Retry' },
                { Value: next_retry_at, Label: 'Next Retry' }
            ]
        },

        FieldGroup#IntResolution: {
            Label: 'Resolution',
            Data: [
                { Value: assigned_to, Label: 'Assigned To' },
                { Value: resolution_notes, Label: 'Resolution Notes' },
                { Value: resolved_by, Label: 'Resolved By' },
                { Value: resolved_at, Label: 'Resolved At' }
            ]
        }
    }
);

annotate service.ExceptionItems with {
    source_system @title: 'Source System';
    message_type  @title: 'Message Type';
    error_message @title: 'Error';
    severity      @title: 'Severity';
    status        @title: 'Status';
    retry_count   @title: 'Retries';
    assigned_to   @title: 'Assigned To';
};

// =============================================================================
// INTEGRATION CONFIGS - List Report + Object Page
// =============================================================================

annotate service.IntegrationConfigs with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: true }
    }
);

annotate service.IntegrationConfigs with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Integration Config',
            TypeNamePlural : 'Integration Configs',
            Title          : { Value: config_name },
            Description    : { Value: system_id },
            ImageUrl       : 'sap-icon://connected'
        },

        SelectionFields: [
            system_id,
            config_name,
            auth_type,
            is_active
        ],

        LineItem: [
            { Value: system_id, Label: 'System ID', ![@UI.Importance]: #High },
            { Value: config_name, Label: 'Config Name', ![@UI.Importance]: #High },
            { Value: endpoint_url, Label: 'Endpoint', ![@UI.Importance]: #Medium },
            { Value: auth_type, Label: 'Auth Type', ![@UI.Importance]: #Medium },
            { Value: timeout_ms, Label: 'Timeout (ms)', ![@UI.Importance]: #Medium },
            { Value: is_active, Label: 'Active', ![@UI.Importance]: #High }
        ],

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'ConfigDetails',
                Label  : 'Configuration',
                Target : '@UI.FieldGroup#IntConfigDetails'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'HealthMonitoring',
                Label  : 'Health & Monitoring',
                Target : '@UI.FieldGroup#HealthMonitoring'
            }
        ],

        FieldGroup#IntConfigDetails: {
            Label: 'Configuration',
            Data: [
                { Value: system_id, Label: 'System ID' },
                { Value: config_name, Label: 'Configuration Name' },
                { Value: endpoint_url, Label: 'Endpoint URL' },
                { Value: auth_type, Label: 'Authentication Type' },
                { Value: timeout_ms, Label: 'Timeout (ms)' },
                { Value: retry_policy, Label: 'Retry Policy' },
                { Value: max_retries, Label: 'Max Retries' },
                { Value: is_active, Label: 'Active' }
            ]
        },

        FieldGroup#HealthMonitoring: {
            Label: 'Health & Monitoring',
            Data: [
                { Value: last_health_check, Label: 'Last Health Check' },
                { Value: health_status, Label: 'Health Status' },
                { Value: uptime_pct, Label: 'Uptime %' },
                { Value: avg_response_ms, Label: 'Avg Response (ms)' }
            ]
        }
    }
);

annotate service.IntegrationConfigs with {
    system_id   @title: 'System ID';
    config_name @title: 'Config Name';
    auth_type   @title: 'Auth Type';
    endpoint_url @title: 'Endpoint';
};

// =============================================================================
// ALERT DEFINITIONS - List Report + Object Page
// =============================================================================

annotate service.AlertDefinitions with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: true }
    }
);

annotate service.AlertDefinitions with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Alert Definition',
            TypeNamePlural : 'Alert Definitions',
            Title          : { Value: alert_name },
            Description    : { Value: alert_type },
            ImageUrl       : 'sap-icon://bell'
        },

        SelectionFields: [
            alert_name,
            alert_type,
            severity,
            is_enabled
        ],

        LineItem: [
            { Value: alert_name, Label: 'Alert Name', ![@UI.Importance]: #High },
            { Value: alert_type, Label: 'Type', ![@UI.Importance]: #High },
            { Value: severity, Label: 'Severity', ![@UI.Importance]: #High },
            { Value: condition_expression, Label: 'Condition', ![@UI.Importance]: #Medium },
            { Value: trigger_count, Label: 'Triggers', ![@UI.Importance]: #Medium },
            { Value: is_enabled, Label: 'Enabled', ![@UI.Importance]: #High }
        ],

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'AlertDetails',
                Label  : 'Alert Details',
                Target : '@UI.FieldGroup#AlertDetails'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'NotificationSettings',
                Label  : 'Notification Settings',
                Target : '@UI.FieldGroup#NotificationSettings'
            }
        ],

        FieldGroup#AlertDetails: {
            Label: 'Alert Details',
            Data: [
                { Value: alert_name, Label: 'Alert Name' },
                { Value: alert_type, Label: 'Alert Type' },
                { Value: severity, Label: 'Severity' },
                { Value: description, Label: 'Description' },
                { Value: condition_expression, Label: 'Condition Expression' },
                { Value: evaluation_interval, Label: 'Evaluation Interval' },
                { Value: trigger_count, Label: 'Total Triggers' },
                { Value: last_triggered_at, Label: 'Last Triggered' },
                { Value: is_enabled, Label: 'Enabled' }
            ]
        },

        FieldGroup#NotificationSettings: {
            Label: 'Notification Settings',
            Data: [
                { Value: notification_channels, Label: 'Channels' },
                { Value: recipients, Label: 'Recipients' },
                { Value: escalation_after_mins, Label: 'Escalation After (min)' },
                { Value: escalation_recipients, Label: 'Escalation Recipients' }
            ]
        }
    }
);

annotate service.AlertDefinitions with {
    alert_name  @title: 'Alert Name';
    alert_type  @title: 'Alert Type';
    severity    @title: 'Severity';
    is_enabled  @title: 'Enabled';
};

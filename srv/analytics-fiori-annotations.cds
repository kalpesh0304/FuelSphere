/**
 * FuelSphere - Analytics Service Fiori Annotations (FDD-12)
 *
 * Screens:
 * - REPORT_DEF_001: Report Definitions (List Report + Object Page)
 * - DASHBOARD_CONFIG_001: Dashboard Configurations (List Report + Object Page)
 * - KPI_DEF_001: KPI Definitions (List Report + Object Page)
 */

using AnalyticsService as service from './analytics-service';

// =============================================================================
// REPORT DEFINITIONS - List Report + Object Page
// =============================================================================

annotate service.ReportDefinitions with @(
    Common.SemanticKey: [report_code],
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: true }
    }
);

annotate service.ReportDefinitions with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Report Definition',
            TypeNamePlural : 'Report Definitions',
            Title          : { Value: report_name },
            Description    : { Value: report_code },
            ImageUrl       : 'sap-icon://business-objects-experience'
        },

        SelectionFields: [
            report_code,
            report_name,
            report_category,
            report_type,
            schedule_enabled,
            is_active
        ],

        LineItem: [
            { Value: report_code, Label: 'Report Code', ![@UI.Importance]: #High },
            { Value: report_name, Label: 'Report Name', ![@UI.Importance]: #High },
            { Value: report_category, Label: 'Category', ![@UI.Importance]: #High },
            { Value: report_type, Label: 'Type', ![@UI.Importance]: #Medium },
            { Value: supported_formats, Label: 'Formats', ![@UI.Importance]: #Medium },
            { Value: schedule_enabled, Label: 'Scheduled', ![@UI.Importance]: #Medium },
            { Value: generation_count, Label: 'Runs', ![@UI.Importance]: #Medium },
            { Value: is_active, Label: 'Active', ![@UI.Importance]: #High }
        ],

        PresentationVariant: {
            SortOrder: [{ Property: report_code, Descending: false }],
            Visualizations: [ '@UI.LineItem' ]
        },

        HeaderFacets: [
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#ReportCategory',
                Label  : 'Category'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#GenerationCount',
                Label  : 'Total Runs'
            }
        ],

        DataPoint#ReportCategory: {
            Value: report_category,
            Title: 'Report Category'
        },

        DataPoint#GenerationCount: {
            Value: generation_count,
            Title: 'Total Runs'
        },

        // Object Page Sections (4)
        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'ReportConfig',
                Label  : 'Report Configuration',
                Target : '@UI.FieldGroup#ReportConfig'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'OutputSettings',
                Label  : 'Output Settings',
                Target : '@UI.FieldGroup#OutputSettings'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Scheduling',
                Label  : 'Scheduling',
                Target : '@UI.FieldGroup#Scheduling'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Administrative',
                Label  : 'Administrative',
                Target : '@UI.FieldGroup#ReportAdmin'
            }
        ],

        FieldGroup#ReportConfig: {
            Label: 'Report Configuration',
            Data: [
                { Value: report_code, Label: 'Report Code' },
                { Value: report_name, Label: 'Report Name' },
                { Value: report_description, Label: 'Description' },
                { Value: report_category, Label: 'Category' },
                { Value: report_type, Label: 'Report Type' },
                { Value: floorplan_type, Label: 'Floorplan Type' },
                { Value: base_entity, Label: 'Base Entity' },
                { Value: required_scope, Label: 'Required Scope' },
                { Value: is_active, Label: 'Active' }
            ]
        },

        FieldGroup#OutputSettings: {
            Label: 'Output Settings',
            Data: [
                { Value: supported_formats, Label: 'Supported Formats' },
                { Value: default_format, Label: 'Default Format' },
                { Value: template_file, Label: 'Template File' },
                { Value: version, Label: 'Version' },
                { Value: last_generated_at, Label: 'Last Generated' },
                { Value: generation_count, Label: 'Generation Count' }
            ]
        },

        FieldGroup#Scheduling: {
            Label: 'Scheduling',
            Data: [
                { Value: schedule_enabled, Label: 'Schedule Enabled' },
                { Value: schedule_cron, Label: 'Cron Expression' },
                { Value: distribution_list, Label: 'Distribution List' }
            ]
        },

        FieldGroup#ReportAdmin: {
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

annotate service.ReportDefinitions with {
    report_code     @title: 'Report Code';
    report_name     @title: 'Report Name';
    report_category @title: 'Category';
    report_type     @title: 'Type';
    schedule_enabled @title: 'Scheduled';
    generation_count @title: 'Runs';
};

// =============================================================================
// DASHBOARD CONFIGS - List Report + Object Page
// =============================================================================

annotate service.DashboardConfigs with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: true }
    }
);

annotate service.DashboardConfigs with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Dashboard',
            TypeNamePlural : 'Dashboards',
            Title          : { Value: dashboard_name },
            Description    : { Value: dashboard_code },
            ImageUrl       : 'sap-icon://dashboard'
        },

        SelectionFields: [
            dashboard_code,
            dashboard_name,
            dashboard_type,
            is_active
        ],

        LineItem: [
            { Value: dashboard_code, Label: 'Code', ![@UI.Importance]: #High },
            { Value: dashboard_name, Label: 'Dashboard Name', ![@UI.Importance]: #High },
            { Value: dashboard_type, Label: 'Type', ![@UI.Importance]: #Medium },
            { Value: is_home_page, Label: 'Home Page', ![@UI.Importance]: #Medium },
            { Value: is_active, Label: 'Active', ![@UI.Importance]: #High }
        ],

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'DashboardLayout',
                Label  : 'Dashboard Layout',
                Target : '@UI.FieldGroup#DashboardLayout'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'WidgetConfig',
                Label  : 'Widget Configuration',
                Target : '@UI.FieldGroup#WidgetConfig'
            }
        ],

        FieldGroup#DashboardLayout: {
            Label: 'Dashboard Layout',
            Data: [
                { Value: dashboard_code, Label: 'Dashboard Code' },
                { Value: dashboard_name, Label: 'Dashboard Name' },
                { Value: description, Label: 'Description' },
                { Value: dashboard_type, Label: 'Dashboard Type' },
                { Value: layout_config, Label: 'Layout Config' },
                { Value: is_home_page, Label: 'Is Home Page' },
                { Value: is_active, Label: 'Active' }
            ]
        },

        FieldGroup#WidgetConfig: {
            Label: 'Widget Configuration',
            Data: [
                { Value: widget_count, Label: 'Widget Count' },
                { Value: refresh_interval, Label: 'Refresh Interval (sec)' },
                { Value: required_scope, Label: 'Required Scope' }
            ]
        }
    }
);

annotate service.DashboardConfigs with {
    dashboard_code @title: 'Dashboard Code';
    dashboard_name @title: 'Dashboard Name';
    dashboard_type @title: 'Type';
    is_home_page   @title: 'Home Page';
};

// =============================================================================
// KPI DEFINITIONS - List Report + Object Page
// =============================================================================

annotate service.KPIDefinitions with @(
    Common.SemanticKey: [kpi_code],
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: true }
    }
);

annotate service.KPIDefinitions with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'KPI Definition',
            TypeNamePlural : 'KPI Definitions',
            Title          : { Value: kpi_name },
            Description    : { Value: kpi_code },
            ImageUrl       : 'sap-icon://kpi-managing-my-area'
        },

        SelectionFields: [
            kpi_code,
            kpi_name,
            kpi_category,
            is_active
        ],

        LineItem: [
            { Value: kpi_code, Label: 'KPI Code', ![@UI.Importance]: #High },
            { Value: kpi_name, Label: 'KPI Name', ![@UI.Importance]: #High },
            { Value: kpi_category, Label: 'Category', ![@UI.Importance]: #High },
            { Value: target_value, Label: 'Target', ![@UI.Importance]: #Medium },
            { Value: warning_threshold, Label: 'Warning', ![@UI.Importance]: #Medium },
            { Value: critical_threshold, Label: 'Critical', ![@UI.Importance]: #Medium },
            { Value: uom, Label: 'UoM', ![@UI.Importance]: #Medium },
            { Value: is_active, Label: 'Active', ![@UI.Importance]: #High }
        ],

        PresentationVariant: {
            SortOrder: [{ Property: kpi_code, Descending: false }],
            Visualizations: [ '@UI.LineItem' ]
        },

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'KPIDetails',
                Label  : 'KPI Details',
                Target : '@UI.FieldGroup#KPIDetails'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Thresholds',
                Label  : 'Thresholds',
                Target : '@UI.FieldGroup#Thresholds'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Calculation',
                Label  : 'Calculation',
                Target : '@UI.FieldGroup#Calculation'
            }
        ],

        FieldGroup#KPIDetails: {
            Label: 'KPI Details',
            Data: [
                { Value: kpi_code, Label: 'KPI Code' },
                { Value: kpi_name, Label: 'KPI Name' },
                { Value: kpi_description, Label: 'Description' },
                { Value: kpi_category, Label: 'Category' },
                { Value: uom, Label: 'Unit of Measure' },
                { Value: is_active, Label: 'Active' }
            ]
        },

        FieldGroup#Thresholds: {
            Label: 'Thresholds',
            Data: [
                { Value: target_value, Label: 'Target Value' },
                { Value: warning_threshold, Label: 'Warning Threshold' },
                { Value: critical_threshold, Label: 'Critical Threshold' },
                { Value: trend_direction, Label: 'Desired Trend' }
            ]
        },

        FieldGroup#Calculation: {
            Label: 'Calculation',
            Data: [
                { Value: calculation_formula, Label: 'Formula' },
                { Value: data_source, Label: 'Data Source' },
                { Value: refresh_frequency, Label: 'Refresh Frequency' },
                { Value: last_calculated_at, Label: 'Last Calculated' }
            ]
        }
    }
);

annotate service.KPIDefinitions with {
    kpi_code          @title: 'KPI Code';
    kpi_name          @title: 'KPI Name';
    kpi_category      @title: 'Category';
    target_value      @title: 'Target';
    warning_threshold @title: 'Warning Threshold';
    critical_threshold @title: 'Critical Threshold';
};

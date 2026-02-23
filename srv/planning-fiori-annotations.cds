/**
 * FuelSphere - Planning Service Fiori Annotations (FDD-02)
 *
 * Screens:
 * - PLANNING_VERSION_001: Planning Versions (List Report + Object Page)
 * - ROUTE_AIRCRAFT_MATRIX_001: Route-Aircraft Matrix (List Report + Object Page)
 */

using PlanningService as service from './planning-service';

// =============================================================================
// PLANNING VERSIONS - List Report + Object Page
// =============================================================================

annotate service.PlanningVersions with @(
    Common.SemanticKey: [version_id],
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: true }
    }
);

annotate service.PlanningVersions with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Planning Version',
            TypeNamePlural : 'Planning Versions',
            Title          : { Value: version_name },
            Description    : { Value: version_id },
            ImageUrl       : 'sap-icon://business-objects-experience'
        },

        SelectionFields: [
            version_id,
            version_name,
            version_type,
            fiscal_year,
            status,
            sac_writeback_status
        ],

        LineItem: [
            { Value: version_id, Label: 'Version ID', ![@UI.Importance]: #High },
            { Value: version_name, Label: 'Version Name', ![@UI.Importance]: #High },
            { Value: version_type, Label: 'Type', ![@UI.Importance]: #High },
            { Value: fiscal_year, Label: 'Fiscal Year', ![@UI.Importance]: #High },
            { Value: planning_period, Label: 'Period', ![@UI.Importance]: #Medium },
            { Value: status, Label: 'Status', ![@UI.Importance]: #High },
            { Value: sac_writeback_status, Label: 'SAC Status', ![@UI.Importance]: #Medium },
            { Value: approved_by, Label: 'Approved By', ![@UI.Importance]: #Medium }
        ],

        PresentationVariant: {
            SortOrder: [{ Property: fiscal_year, Descending: true }],
            Visualizations: [ '@UI.LineItem' ]
        },

        // Object Page Header
        HeaderFacets: [
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#VersionType',
                Label  : 'Version Type'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#FiscalYear',
                Label  : 'Fiscal Year'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#VersionStatus',
                Label  : 'Status'
            }
        ],

        DataPoint#VersionType: {
            Value: version_type,
            Title: 'Version Type'
        },

        DataPoint#FiscalYear: {
            Value: fiscal_year,
            Title: 'Fiscal Year'
        },

        FieldGroup#VersionStatus: {
            Data: [
                { Value: status, Label: 'Status' },
                { Value: sac_writeback_status, Label: 'SAC Writeback' }
            ]
        },

        // Object Page Sections (5)
        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'VersionDetails',
                Label  : 'Version Details',
                Target : '@UI.FieldGroup#VersionDetails'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'PlanningLines',
                Label  : 'Planning Lines',
                Target : 'lines/@UI.LineItem'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'DemandCalculations',
                Label  : 'Demand Calculations',
                Target : 'calculations/@UI.LineItem'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'SACIntegration',
                Label  : 'SAC Integration',
                Target : '@UI.FieldGroup#SACIntegration'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Administrative',
                Label  : 'Administrative',
                Target : '@UI.FieldGroup#PlanningAdmin'
            }
        ],

        FieldGroup#VersionDetails: {
            Label: 'Version Details',
            Data: [
                { Value: version_id, Label: 'Version ID' },
                { Value: version_name, Label: 'Version Name' },
                { Value: version_type, Label: 'Version Type' },
                { Value: fiscal_year, Label: 'Fiscal Year' },
                { Value: planning_period, Label: 'Planning Period' },
                { Value: status, Label: 'Status' },
                { Value: description, Label: 'Description' }
            ]
        },

        FieldGroup#SACIntegration: {
            Label: 'SAC Integration',
            Data: [
                { Value: sac_writeback_status, Label: 'Writeback Status' },
                { Value: sac_model_id, Label: 'SAC Model ID' },
                { Value: sac_writeback_at, Label: 'Last Writeback' },
                { Value: approved_by, Label: 'Approved By' },
                { Value: approved_at, Label: 'Approved At' }
            ]
        },

        FieldGroup#PlanningAdmin: {
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
annotate service.PlanningVersions with {
    version_id           @title: 'Version ID';
    version_name         @title: 'Version Name';
    version_type         @title: 'Version Type';
    fiscal_year          @title: 'Fiscal Year';
    planning_period      @title: 'Planning Period';
    status               @title: 'Status';
    description          @title: 'Description';
    sac_writeback_status @title: 'SAC Status';
    sac_model_id         @title: 'SAC Model ID';
    sac_writeback_at     @title: 'Last SAC Writeback';
    approved_by          @title: 'Approved By';
    approved_at          @title: 'Approved At';
};

// Planning Lines - Inline table
annotate service.PlanningLines with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Planning Line',
            TypeNamePlural : 'Planning Lines'
        },
        LineItem: [
            { Value: station_code, Label: 'Station', ![@UI.Importance]: #High },
            { Value: period_start, Label: 'Period Start', ![@UI.Importance]: #High },
            { Value: period_end, Label: 'Period End', ![@UI.Importance]: #Medium },
            { Value: planned_volume_kg, Label: 'Planned Volume (kg)', ![@UI.Importance]: #High },
            { Value: planned_amount, Label: 'Planned Amount', ![@UI.Importance]: #High },
            { Value: currency_code, Label: 'Currency', ![@UI.Importance]: #Medium },
            { Value: price_assumption, Label: 'Price Assumption', ![@UI.Importance]: #Medium },
            { Value: adjustment_factor, Label: 'Adj. Factor', ![@UI.Importance]: #Medium }
        ]
    }
);

// Demand Calculations - Inline table
annotate service.DemandCalculations with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Demand Calculation',
            TypeNamePlural : 'Demand Calculations'
        },
        LineItem: [
            { Value: route_route_code, Label: 'Route', ![@UI.Importance]: #High },
            { Value: aircraft_type_type_code, Label: 'Aircraft', ![@UI.Importance]: #High },
            { Value: calculated_demand, Label: 'Calculated Demand', ![@UI.Importance]: #High },
            { Value: uom_code, Label: 'UoM', ![@UI.Importance]: #Medium },
            { Value: calculation_method, Label: 'Method', ![@UI.Importance]: #Medium },
            { Value: seasonal_factor, Label: 'Seasonal Factor', ![@UI.Importance]: #Medium },
            { Value: historical_avg, Label: 'Historical Avg', ![@UI.Importance]: #Medium },
            { Value: historical_variance, Label: 'Hist. Variance', ![@UI.Importance]: #Medium }
        ]
    }
);

// =============================================================================
// ROUTE-AIRCRAFT MATRIX - List Report + Object Page
// =============================================================================

annotate service.RouteAircraftMatrix with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: true }
    }
);

annotate service.RouteAircraftMatrix with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Route-Aircraft Matrix',
            TypeNamePlural : 'Route-Aircraft Matrix',
            Title          : { Value: route_route_code },
            Description    : { Value: aircraft_type_type_code },
            ImageUrl       : 'sap-icon://map-2'
        },

        SelectionFields: [
            route_route_code,
            aircraft_type_type_code,
            data_source,
            is_active
        ],

        LineItem: [
            { Value: route_route_code, Label: 'Route', ![@UI.Importance]: #High },
            { Value: aircraft_type_type_code, Label: 'Aircraft', ![@UI.Importance]: #High },
            { Value: total_standard_fuel, Label: 'Total Fuel (kg)', ![@UI.Importance]: #High },
            { Value: trip_fuel, Label: 'Trip Fuel (kg)', ![@UI.Importance]: #Medium },
            { Value: taxi_fuel, Label: 'Taxi (kg)', ![@UI.Importance]: #Medium },
            { Value: contingency_fuel, Label: 'Contingency (kg)', ![@UI.Importance]: #Medium },
            { Value: data_source, Label: 'Source', ![@UI.Importance]: #Medium },
            { Value: effective_from, Label: 'Effective From', ![@UI.Importance]: #Medium },
            { Value: is_active, Label: 'Active', ![@UI.Importance]: #High }
        ],

        PresentationVariant: {
            SortOrder: [{ Property: route_route_code, Descending: false }],
            Visualizations: [ '@UI.LineItem' ]
        },

        // Object Page Header
        HeaderFacets: [
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#TotalFuel',
                Label  : 'Total Standard Fuel'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#TripFuel',
                Label  : 'Trip Fuel'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#DataSource',
                Label  : 'Data Source'
            }
        ],

        DataPoint#TotalFuel: {
            Value: total_standard_fuel,
            Title: 'Total Standard Fuel (kg)'
        },

        DataPoint#TripFuel: {
            Value: trip_fuel,
            Title: 'Trip Fuel (kg)'
        },

        DataPoint#DataSource: {
            Value: data_source,
            Title: 'Data Source'
        },

        // Object Page Sections (4)
        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'MatrixDetails',
                Label  : 'Matrix Details',
                Target : '@UI.FieldGroup#MatrixDetails'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'FuelComponents',
                Label  : 'Fuel Components',
                Target : '@UI.FieldGroup#FuelComponents'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'SeasonalAdj',
                Label  : 'Seasonal Adjustments',
                Target : '@UI.FieldGroup#SeasonalAdjustments'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Administrative',
                Label  : 'Administrative',
                Target : '@UI.FieldGroup#MatrixAdmin'
            }
        ],

        FieldGroup#MatrixDetails: {
            Label: 'Matrix Details',
            Data: [
                { Value: route_route_code, Label: 'Route' },
                { Value: aircraft_type_type_code, Label: 'Aircraft Type' },
                { Value: data_source, Label: 'Data Source' },
                { Value: effective_from, Label: 'Effective From' },
                { Value: effective_to, Label: 'Effective To' },
                { Value: notes, Label: 'Notes' },
                { Value: is_active, Label: 'Active' }
            ]
        },

        FieldGroup#FuelComponents: {
            Label: 'Fuel Components (kg)',
            Data: [
                { Value: trip_fuel, Label: 'Trip Fuel' },
                { Value: taxi_fuel, Label: 'Taxi Fuel' },
                { Value: contingency_fuel, Label: 'Contingency Fuel' },
                { Value: alternate_fuel, Label: 'Alternate Fuel' },
                { Value: reserve_fuel, Label: 'Reserve Fuel' },
                { Value: extra_fuel, Label: 'Extra Fuel' },
                { Value: total_standard_fuel, Label: 'Total Standard Fuel' }
            ]
        },

        FieldGroup#SeasonalAdjustments: {
            Label: 'Seasonal Adjustments',
            Data: [
                { Value: summer_factor, Label: 'Summer Factor' },
                { Value: winter_factor, Label: 'Winter Factor' }
            ]
        },

        FieldGroup#MatrixAdmin: {
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
annotate service.RouteAircraftMatrix with {
    route_route_code         @title: 'Route';
    aircraft_type_type_code  @title: 'Aircraft Type';
    trip_fuel                @title: 'Trip Fuel (kg)';
    taxi_fuel                @title: 'Taxi Fuel (kg)';
    contingency_fuel         @title: 'Contingency (kg)';
    alternate_fuel           @title: 'Alternate (kg)';
    reserve_fuel             @title: 'Reserve (kg)';
    extra_fuel               @title: 'Extra (kg)';
    total_standard_fuel      @title: 'Total Fuel (kg)';
    summer_factor            @title: 'Summer Factor';
    winter_factor            @title: 'Winter Factor';
    effective_from           @title: 'Effective From';
    effective_to             @title: 'Effective To';
    data_source              @title: 'Data Source';
    notes                    @title: 'Notes';
};

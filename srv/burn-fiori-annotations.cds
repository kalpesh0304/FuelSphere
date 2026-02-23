/**
 * FuelSphere - Burn Service Fiori Annotations (FDD-08)
 *
 * Screens:
 * - FUEL_BURN_001: Fuel Burns (List Report + Object Page)
 * - FUEL_BURN_EXCEPTION_001: Burn Exceptions (List Report + Object Page)
 */

using BurnService as service from './burn-service';

// =============================================================================
// FUEL BURNS - List Report + Object Page
// =============================================================================

annotate service.FuelBurns with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: false }
    }
);

annotate service.FuelBurns with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Fuel Burn Record',
            TypeNamePlural : 'Fuel Burn Records',
            Title          : { Value: tail_number },
            Description    : { Value: burn_date },
            ImageUrl       : 'sap-icon://heating-cooling'
        },

        SelectionFields: [
            tail_number,
            burn_date,
            data_source,
            variance_status,
            status,
            requires_review
        ],

        LineItem: [
            { Value: tail_number, Label: 'Tail Number', ![@UI.Importance]: #High },
            { Value: burn_date, Label: 'Burn Date', ![@UI.Importance]: #High },
            { Value: actual_burn_kg, Label: 'Actual Burn (kg)', ![@UI.Importance]: #High },
            { Value: planned_burn_kg, Label: 'Planned Burn (kg)', ![@UI.Importance]: #High },
            { Value: variance_kg, Label: 'Variance (kg)', ![@UI.Importance]: #Medium },
            { Value: variance_pct, Label: 'Variance %', ![@UI.Importance]: #Medium },
            { Value: variance_status, Label: 'Var. Status', ![@UI.Importance]: #High },
            { Value: data_source, Label: 'Source', ![@UI.Importance]: #Medium },
            { Value: status, Label: 'Status', ![@UI.Importance]: #High }
        ],

        PresentationVariant: {
            SortOrder: [{ Property: burn_date, Descending: true }],
            Visualizations: [ '@UI.LineItem' ]
        },

        // Object Page Header
        HeaderFacets: [
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#ActualBurn',
                Label  : 'Actual Burn'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#PlannedBurn',
                Label  : 'Planned Burn'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#VariancePct',
                Label  : 'Variance'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#BurnStatus',
                Label  : 'Status'
            }
        ],

        DataPoint#ActualBurn: {
            Value: actual_burn_kg,
            Title: 'Actual Burn (kg)'
        },

        DataPoint#PlannedBurn: {
            Value: planned_burn_kg,
            Title: 'Planned Burn (kg)'
        },

        DataPoint#VariancePct: {
            Value: variance_pct,
            Title: 'Variance %'
        },

        FieldGroup#BurnStatus: {
            Data: [
                { Value: status, Label: 'Status' },
                { Value: data_source, Label: 'Data Source' }
            ]
        },

        // Object Page Sections (6)
        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'BurnDetails',
                Label  : 'Burn Details',
                Target : '@UI.FieldGroup#BurnDetails'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'FlightInfo',
                Label  : 'Flight Information',
                Target : '@UI.FieldGroup#FlightInfo'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'FuelQuantities',
                Label  : 'Fuel Quantities',
                Target : '@UI.FieldGroup#FuelQuantities'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'VarianceAnalysis',
                Label  : 'Variance Analysis',
                Target : '@UI.FieldGroup#VarianceAnalysis'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'FinancePosting',
                Label  : 'Finance Posting',
                Target : '@UI.FieldGroup#FinancePosting'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Administrative',
                Label  : 'Administrative',
                Target : '@UI.FieldGroup#BurnAdmin'
            }
        ],

        FieldGroup#BurnDetails: {
            Label: 'Burn Details',
            Data: [
                { Value: burn_date, Label: 'Burn Date' },
                { Value: burn_time, Label: 'Burn Time' },
                { Value: data_source, Label: 'Data Source' },
                { Value: source_message_id, Label: 'Source Message ID' },
                { Value: status, Label: 'Status' }
            ]
        },

        FieldGroup#FlightInfo: {
            Label: 'Flight Information',
            Data: [
                { Value: tail_number, Label: 'Tail Number' },
                { Value: aircraft.aircraft_model, Label: 'Aircraft Model' },
                { Value: origin_airport.iata_code, Label: 'Origin' },
                { Value: destination_airport.iata_code, Label: 'Destination' },
                { Value: block_off_time, Label: 'Block Off' },
                { Value: block_on_time, Label: 'Block On' },
                { Value: flight_duration_mins, Label: 'Duration (min)' }
            ]
        },

        FieldGroup#FuelQuantities: {
            Label: 'Fuel Quantities (kg)',
            Data: [
                { Value: planned_burn_kg, Label: 'Planned Burn' },
                { Value: actual_burn_kg, Label: 'Actual Burn' },
                { Value: taxi_out_kg, Label: 'Taxi Out' },
                { Value: taxi_in_kg, Label: 'Taxi In' },
                { Value: trip_fuel_kg, Label: 'Trip Fuel' }
            ]
        },

        FieldGroup#VarianceAnalysis: {
            Label: 'Variance Analysis',
            Data: [
                { Value: variance_kg, Label: 'Variance (kg)' },
                { Value: variance_pct, Label: 'Variance %' },
                { Value: variance_status, Label: 'Variance Status' },
                { Value: requires_review, Label: 'Requires Review' },
                { Value: review_notes, Label: 'Review Notes' },
                { Value: reviewed_by, Label: 'Reviewed By' },
                { Value: reviewed_at, Label: 'Reviewed At' }
            ]
        },

        FieldGroup#FinancePosting: {
            Label: 'Finance Posting',
            Data: [
                { Value: confirmed_by, Label: 'Confirmed By' },
                { Value: confirmed_at, Label: 'Confirmed At' },
                { Value: finance_posted, Label: 'Posted to Finance' },
                { Value: finance_post_date, Label: 'Post Date' }
            ]
        },

        FieldGroup#BurnAdmin: {
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
annotate service.FuelBurns with {
    tail_number       @title: 'Tail Number';
    burn_date         @title: 'Burn Date';
    burn_time         @title: 'Burn Time';
    actual_burn_kg    @title: 'Actual Burn (kg)';
    planned_burn_kg   @title: 'Planned Burn (kg)';
    variance_kg       @title: 'Variance (kg)';
    variance_pct      @title: 'Variance %';
    variance_status   @title: 'Variance Status';
    data_source       @title: 'Data Source';
    status            @title: 'Status';
    requires_review   @title: 'Requires Review';
};

// =============================================================================
// FUEL BURN EXCEPTIONS - List Report + Object Page
// =============================================================================

annotate service.FuelBurnExceptions with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: false }
    }
);

annotate service.FuelBurnExceptions with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Burn Exception',
            TypeNamePlural : 'Burn Exceptions',
            Title          : { Value: tail_number },
            Description    : { Value: exception_date },
            ImageUrl       : 'sap-icon://warning2'
        },

        SelectionFields: [
            tail_number,
            exception_date,
            exception_type,
            severity,
            status
        ],

        LineItem: [
            { Value: tail_number, Label: 'Tail Number', ![@UI.Importance]: #High },
            { Value: exception_date, Label: 'Date', ![@UI.Importance]: #High },
            { Value: exception_type, Label: 'Exception Type', ![@UI.Importance]: #High },
            { Value: severity, Label: 'Severity', ![@UI.Importance]: #High },
            { Value: variance_amount_kg, Label: 'Variance (kg)', ![@UI.Importance]: #Medium },
            { Value: variance_percentage, Label: 'Variance %', ![@UI.Importance]: #Medium },
            { Value: assigned_to, Label: 'Assigned To', ![@UI.Importance]: #Medium },
            { Value: status, Label: 'Status', ![@UI.Importance]: #High }
        ],

        PresentationVariant: {
            SortOrder: [{ Property: exception_date, Descending: true }],
            Visualizations: [ '@UI.LineItem' ]
        },

        // Object Page Sections (3)
        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'ExceptionDetails',
                Label  : 'Exception Details',
                Target : '@UI.FieldGroup#ExceptionDetails'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Investigation',
                Label  : 'Investigation',
                Target : '@UI.FieldGroup#Investigation'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Resolution',
                Label  : 'Resolution',
                Target : '@UI.FieldGroup#Resolution'
            }
        ],

        FieldGroup#ExceptionDetails: {
            Label: 'Exception Details',
            Data: [
                { Value: tail_number, Label: 'Tail Number' },
                { Value: exception_date, Label: 'Exception Date' },
                { Value: exception_type, Label: 'Exception Type' },
                { Value: severity, Label: 'Severity' },
                { Value: variance_amount_kg, Label: 'Variance Amount (kg)' },
                { Value: variance_percentage, Label: 'Variance Percentage' },
                { Value: status, Label: 'Status' }
            ]
        },

        FieldGroup#Investigation: {
            Label: 'Investigation',
            Data: [
                { Value: assigned_to, Label: 'Assigned To' },
                { Value: root_cause, Label: 'Root Cause' },
                { Value: investigation_notes, Label: 'Investigation Notes' }
            ]
        },

        FieldGroup#Resolution: {
            Label: 'Resolution',
            Data: [
                { Value: resolution_action, Label: 'Resolution Action' },
                { Value: resolved_by, Label: 'Resolved By' },
                { Value: resolved_at, Label: 'Resolved At' },
                { Value: corrective_action, Label: 'Corrective Action' }
            ]
        }
    }
);

annotate service.FuelBurnExceptions with {
    tail_number         @title: 'Tail Number';
    exception_date      @title: 'Exception Date';
    exception_type      @title: 'Exception Type';
    severity            @title: 'Severity';
    variance_amount_kg  @title: 'Variance (kg)';
    variance_percentage @title: 'Variance %';
    status              @title: 'Status';
    assigned_to         @title: 'Assigned To';
};

// =============================================================================
// FUEL ORDERS (Burn Module View) - Flight Search & Selection (POST-2)
// List Report: "All Fuel Uplift and ROB Records"
// Shows fuel orders from post-delivery/burn operations perspective
// =============================================================================

annotate service.FuelOrders with @(
    Capabilities: {
        InsertRestrictions: { Insertable: false },
        UpdateRestrictions: { Updatable: false },
        DeleteRestrictions: { Deletable: false }
    }
);

annotate service.FuelOrders with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Fuel Uplift Record',
            TypeNamePlural : 'All Fuel Uplift and ROB Records',
            Title          : { Value: order_number },
            Description    : { Value: station_code }
        },

        SelectionFields: [
            order_number,
            station_code,
            status,
            supplier_ID,
            requested_date
        ],

        LineItem: [
            { Value: order_number, Label: 'Fuel Order ID', ![@UI.Importance]: #High },
            { Value: flight.flight_number, Label: 'Flight', ![@UI.Importance]: #High },
            { Value: requested_date, Label: 'Date', ![@UI.Importance]: #High },
            { Value: station_code, Label: 'Station', ![@UI.Importance]: #High },
            { Value: status, Label: 'Status', ![@UI.Importance]: #High },
            { Value: supplier.supplier_name, Label: 'Supplier', ![@UI.Importance]: #Medium },
            { Value: ordered_quantity, Label: 'Uplifted Qty (kg)', ![@UI.Importance]: #High }
        ],

        PresentationVariant: {
            SortOrder: [{ Property: requested_date, Descending: true }],
            Visualizations: [ '@UI.LineItem' ]
        }
    }
);

annotate service.FuelOrders with {
    order_number      @title: 'Fuel Order ID';
    station_code      @title: 'Station';
    status            @title: 'Status';
    requested_date    @title: 'Date';
    ordered_quantity  @title: 'Uplifted Qty (kg)';
};

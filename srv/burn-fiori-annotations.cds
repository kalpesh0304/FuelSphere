/**
 * FuelSphere - Burn Service Fiori Annotations
 * Document: FDD-08 - Fuel Burn & ROB Tracking
 *
 * UI Screens:
 * - FB-001: Fuel Burns (List Report + Object Page)
 * - FB-002: ROB Ledger (List Report + Object Page)
 * - FB-003: Fuel Burn Exceptions (List Report)
 */

using BurnService from './burn-service';

// ============================================================================
// FUEL BURNS - List Report + Object Page
// ============================================================================

annotate BurnService.FuelBurns with @(
    UI: {
        // --- Header ---
        HeaderInfo: {
            TypeName       : 'Fuel Burn',
            TypeNamePlural : 'Fuel Burns',
            Title          : { Value: tail_number },
            Description    : { Value: burn_date }
        },

        // --- Filter Bar ---
        SelectionFields: [
            tail_number,
            burn_date,
            data_source,
            status,
            variance_status
        ],

        // --- List Report Table ---
        LineItem: [
            { Value: tail_number, Label: 'Aircraft', ![@UI.Importance]: #High },
            { Value: burn_date, Label: 'Burn Date', ![@UI.Importance]: #High },
            { Value: origin_airport, Label: 'Origin', ![@UI.Importance]: #High },
            { Value: destination_airport, Label: 'Destination', ![@UI.Importance]: #High },
            { Value: actual_burn_kg, Label: 'Actual Burn (kg)', ![@UI.Importance]: #High },
            { Value: planned_burn_kg, Label: 'Planned Burn (kg)', ![@UI.Importance]: #Medium },
            { Value: variance_kg, Label: 'Variance (kg)', ![@UI.Importance]: #Medium },
            { Value: variance_pct, Label: 'Variance %', ![@UI.Importance]: #Medium },
            { Value: variance_status, Label: 'Variance Status', ![@UI.Importance]: #Medium },
            { Value: data_source, Label: 'Source', ![@UI.Importance]: #Medium },
            { Value: status, Label: 'Status', ![@UI.Importance]: #High },
            {
                $Type  : 'UI.DataFieldForAction',
                Action : 'BurnService.importFuelBurnExcel',
                Label  : 'Upload Fuel Burns',
                Inline : false
            },
            {
                $Type  : 'UI.DataFieldForAction',
                Action : 'BurnService.importPlannedBurnExcel',
                Label  : 'Upload Planned Burns',
                Inline : false
            }
        ],

        // --- Default Sort ---
        PresentationVariant: {
            SortOrder: [
                { Property: burn_date, Descending: true },
                { Property: tail_number, Descending: false }
            ],
            Visualizations: ['@UI.LineItem']
        },

        // --- Object Page Header ---
        HeaderFacets: [
            { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#BurnStatus', Label: 'Status' },
            { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#BurnQuantities', Label: 'Quantities' },
            { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#BurnVariance', Label: 'Variance' }
        ],

        FieldGroup #BurnStatus: {
            Data: [
                { Value: status, Label: 'Status' },
                { Value: data_source, Label: 'Data Source' }
            ]
        },

        FieldGroup #BurnQuantities: {
            Data: [
                { Value: actual_burn_kg, Label: 'Actual Burn (kg)' },
                { Value: planned_burn_kg, Label: 'Planned Burn (kg)' }
            ]
        },

        FieldGroup #BurnVariance: {
            Data: [
                { Value: variance_kg, Label: 'Variance (kg)' },
                { Value: variance_pct, Label: 'Variance %' },
                { Value: variance_status, Label: 'Status' }
            ]
        },

        // --- Object Page Sections ---
        Facets: [
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'BurnDetails',
                Label  : 'Burn Details',
                Facets : [
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#FlightInfo', Label: 'Flight' },
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#TimingInfo', Label: 'Timing' }
                ]
            },
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'RouteSection',
                Label  : 'Route',
                Facets : [
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#RouteInfo', Label: 'Route' }
                ]
            },
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'VarianceSection',
                Label  : 'Variance Analysis',
                Facets : [
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#VarianceDetails', Label: 'Variance' }
                ]
            },
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'ReviewSection',
                Label  : 'Review',
                Facets : [
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#ReviewInfo', Label: 'Review' }
                ]
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'BurnAdmin',
                Target : '@UI.FieldGroup#BurnAdmin',
                Label  : 'Administration'
            }
        ],

        // --- Field Groups ---
        FieldGroup #FlightInfo: {
            Data: [
                { Value: tail_number, Label: 'Aircraft Tail' },
                { Value: burn_date, Label: 'Burn Date' },
                { Value: data_source, Label: 'Data Source' },
                { Value: source_message_id, Label: 'Source Message ID' },
                { Value: status, Label: 'Status' }
            ]
        },

        FieldGroup #TimingInfo: {
            Data: [
                { Value: block_off_time, Label: 'Block-Off Time' },
                { Value: block_on_time, Label: 'Block-On Time' },
                { Value: flight_duration_mins, Label: 'Flight Duration (min)' }
            ]
        },

        FieldGroup #RouteInfo: {
            Data: [
                { Value: origin_airport, Label: 'Departure Airport' },
                { Value: destination_airport, Label: 'Arrival Airport' }
            ]
        },

        FieldGroup #VarianceDetails: {
            Data: [
                { Value: actual_burn_kg, Label: 'Actual Burn (kg)' },
                { Value: planned_burn_kg, Label: 'Planned Burn (kg)' },
                { Value: taxi_out_kg, Label: 'Taxi Out (kg)' },
                { Value: taxi_in_kg, Label: 'Taxi In (kg)' },
                { Value: trip_fuel_kg, Label: 'Trip Fuel (kg)' },
                { Value: variance_kg, Label: 'Variance (kg)' },
                { Value: variance_pct, Label: 'Variance %' },
                { Value: variance_status, Label: 'Variance Status' }
            ]
        },

        FieldGroup #ReviewInfo: {
            Data: [
                { Value: requires_review, Label: 'Requires Review' },
                { Value: review_notes, Label: 'Review Notes' },
                { Value: reviewed_by, Label: 'Reviewed By' },
                { Value: reviewed_at, Label: 'Reviewed At' },
                { Value: confirmed_by, Label: 'Confirmed By' },
                { Value: confirmed_at, Label: 'Confirmed At' }
            ]
        },

        FieldGroup #BurnAdmin: {
            Data: [
                { Value: created_at, Label: 'Created At' },
                { Value: created_by, Label: 'Created By' },
                { Value: modified_at, Label: 'Modified At' },
                { Value: modified_by, Label: 'Modified By' }
            ]
        }
    }
);

// FuelBurns field-level annotations
annotate BurnService.FuelBurns with {
    ID                            @UI.Hidden;
    tail_number                   @title: 'Aircraft Tail';
    burn_date                     @title: 'Burn Date';
    burn_time                     @title: 'Burn Time';
    block_off_time                @title: 'Block-Off Time';
    block_on_time                 @title: 'Block-On Time';
    flight_duration_mins          @title: 'Duration (min)';
    origin_airport      @title: 'Origin';
    destination_airport @title: 'Destination';
    actual_burn_kg                @title: 'Actual Burn (kg)';
    planned_burn_kg               @title: 'Planned Burn (kg)';
    taxi_out_kg                   @title: 'Taxi Out (kg)';
    taxi_in_kg                    @title: 'Taxi In (kg)';
    trip_fuel_kg                  @title: 'Trip Fuel (kg)';
    variance_kg                   @title: 'Variance (kg)' @Common.FieldControl: #ReadOnly;
    variance_pct                  @title: 'Variance %' @Common.FieldControl: #ReadOnly;
    variance_status               @title: 'Variance Status' @Common.FieldControl: #ReadOnly;
    data_source                   @title: 'Data Source';
    source_message_id             @title: 'Source Message ID';
    status                        @title: 'Status' @Common.FieldControl: #ReadOnly;
    requires_review               @title: 'Requires Review' @Common.FieldControl: #ReadOnly;
    review_notes                  @title: 'Review Notes' @UI.MultiLineText;
    reviewed_by                   @title: 'Reviewed By' @Common.FieldControl: #ReadOnly;
    reviewed_at                   @title: 'Reviewed At' @Common.FieldControl: #ReadOnly;
    confirmed_by                  @title: 'Confirmed By' @Common.FieldControl: #ReadOnly;
    confirmed_at                  @title: 'Confirmed At' @Common.FieldControl: #ReadOnly;
    finance_posted                @title: 'Finance Posted' @Common.FieldControl: #ReadOnly;
    finance_post_date             @title: 'Finance Post Date' @Common.FieldControl: #ReadOnly;
    created_at                    @title: 'Created At' @Common.FieldControl: #ReadOnly;
    created_by                    @title: 'Created By' @Common.FieldControl: #ReadOnly;
    modified_at                   @title: 'Modified At' @Common.FieldControl: #ReadOnly;
    modified_by                   @title: 'Modified By' @Common.FieldControl: #ReadOnly;
};

// ============================================================================
// ROB LEDGER - List Report + Object Page
// ============================================================================

annotate BurnService.ROBLedger with @(
    UI: {
        // --- Header ---
        HeaderInfo: {
            TypeName       : 'ROB Entry',
            TypeNamePlural : 'ROB Ledger',
            Title          : { Value: tail_number },
            Description    : { Value: record_date }
        },

        // --- Filter Bar ---
        SelectionFields: [
            tail_number,
            record_date,
            airport_code,
            entry_type
        ],

        // --- List Report Table ---
        LineItem: [
            { Value: tail_number, Label: 'Aircraft', ![@UI.Importance]: #High },
            { Value: record_date, Label: 'Date', ![@UI.Importance]: #High },
            { Value: record_time, Label: 'Time', ![@UI.Importance]: #Medium },
            { Value: airport_code, Label: 'Airport', ![@UI.Importance]: #High },
            { Value: entry_type, Label: 'Entry Type', ![@UI.Importance]: #High },
            { Value: opening_rob_kg, Label: 'Opening ROB (kg)', ![@UI.Importance]: #High },
            { Value: uplift_kg, Label: 'Uplift (kg)', ![@UI.Importance]: #Medium },
            { Value: burn_kg, Label: 'Burn (kg)', ![@UI.Importance]: #Medium },
            { Value: adjustment_kg, Label: 'Adjustment (kg)', ![@UI.Importance]: #Low },
            { Value: closing_rob_kg, Label: 'Closing ROB (kg)', ![@UI.Importance]: #High },
            { Value: rob_percentage, Label: 'ROB %', ![@UI.Importance]: #Medium },
            {
                $Type  : 'UI.DataFieldForAction',
                Action : 'BurnService.importROBInitialExcel',
                Label  : 'Upload ROB Data',
                Inline : false
            }
        ],

        // --- Default Sort ---
        PresentationVariant: {
            SortOrder: [
                { Property: record_date, Descending: true },
                { Property: record_time, Descending: true },
                { Property: tail_number, Descending: false }
            ],
            Visualizations: ['@UI.LineItem']
        },

        // --- Object Page Header ---
        HeaderFacets: [
            { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#ROBEntryType', Label: 'Entry Type' },
            { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#ROBSummary', Label: 'ROB Summary' }
        ],

        FieldGroup #ROBEntryType: {
            Data: [
                { Value: entry_type, Label: 'Entry Type' },
                { Value: data_source, Label: 'Data Source' }
            ]
        },

        FieldGroup #ROBSummary: {
            Data: [
                { Value: closing_rob_kg, Label: 'Closing ROB (kg)' },
                { Value: rob_percentage, Label: 'ROB %' },
                { Value: max_capacity_kg, Label: 'Max Capacity (kg)' }
            ]
        },

        // --- Object Page Sections ---
        Facets: [
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'ROBEntry',
                Label  : 'ROB Entry',
                Facets : [
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#ROBIdentification', Label: 'Identification' }
                ]
            },
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'ROBQuantities',
                Label  : 'Quantities',
                Facets : [
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#ROBQuantityDetails', Label: 'Quantities' }
                ]
            },
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'AdjustmentSection',
                Label  : 'Adjustment',
                Facets : [
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#AdjustmentDetails', Label: 'Adjustment' }
                ]
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'ROBAdmin',
                Target : '@UI.FieldGroup#ROBAdmin',
                Label  : 'Administration'
            }
        ],

        // --- Field Groups ---
        FieldGroup #ROBIdentification: {
            Data: [
                { Value: tail_number, Label: 'Aircraft Tail' },
                { Value: record_date, Label: 'Record Date' },
                { Value: record_time, Label: 'Record Time' },
                { Value: sequence, Label: 'Sequence' },
                { Value: airport_code, Label: 'Airport' },
                { Value: entry_type, Label: 'Entry Type' },
                { Value: data_source, Label: 'Data Source' },
                { Value: is_estimated, Label: 'Is Estimated' }
            ]
        },

        FieldGroup #ROBQuantityDetails: {
            Data: [
                { Value: opening_rob_kg, Label: 'Opening ROB (kg)' },
                { Value: uplift_kg, Label: 'Uplift (kg)' },
                { Value: burn_kg, Label: 'Burn (kg)' },
                { Value: adjustment_kg, Label: 'Adjustment (kg)' },
                { Value: closing_rob_kg, Label: 'Closing ROB (kg)' },
                { Value: max_capacity_kg, Label: 'Max Capacity (kg)' },
                { Value: rob_percentage, Label: 'ROB %' }
            ]
        },

        FieldGroup #AdjustmentDetails: {
            Data: [
                { Value: adjustment_reason, Label: 'Adjustment Reason' },
                { Value: adjustment_approved_by, Label: 'Approved By' },
                { Value: adjustment_approved_at, Label: 'Approved At' }
            ]
        },

        FieldGroup #ROBAdmin: {
            Data: [
                { Value: created_at, Label: 'Created At' },
                { Value: created_by, Label: 'Created By' },
                { Value: modified_at, Label: 'Modified At' },
                { Value: modified_by, Label: 'Modified By' }
            ]
        }
    }
);

// ROBLedger field-level annotations
annotate BurnService.ROBLedger with {
    ID                     @UI.Hidden;
    tail_number            @title: 'Aircraft Tail';
    record_date            @title: 'Record Date';
    record_time            @title: 'Record Time';
    sequence               @title: 'Sequence' @Common.FieldControl: #ReadOnly;
    airport_code           @title: 'Airport';
    entry_type             @title: 'Entry Type';
    opening_rob_kg         @title: 'Opening ROB (kg)';
    uplift_kg              @title: 'Uplift (kg)';
    burn_kg                @title: 'Burn (kg)';
    adjustment_kg          @title: 'Adjustment (kg)';
    closing_rob_kg         @title: 'Closing ROB (kg)' @Common.FieldControl: #ReadOnly;
    max_capacity_kg        @title: 'Max Capacity (kg)';
    rob_percentage         @title: 'ROB %' @Common.FieldControl: #ReadOnly;
    adjustment_reason      @title: 'Adjustment Reason' @UI.MultiLineText;
    adjustment_approved_by @title: 'Approved By' @Common.FieldControl: #ReadOnly;
    adjustment_approved_at @title: 'Approved At' @Common.FieldControl: #ReadOnly;
    data_source            @title: 'Data Source';
    is_estimated           @title: 'Is Estimated';
    created_at             @title: 'Created At' @Common.FieldControl: #ReadOnly;
    created_by             @title: 'Created By' @Common.FieldControl: #ReadOnly;
    modified_at            @title: 'Modified At' @Common.FieldControl: #ReadOnly;
    modified_by            @title: 'Modified By' @Common.FieldControl: #ReadOnly;
};

// ============================================================================
// UPLOAD ACTION ANNOTATIONS
// ============================================================================

annotate BurnService with @(
    Common.SideEffects #BurnImport: {
        TargetEntities: [FuelBurns]
    }
);

annotate BurnService with @(
    Common.SideEffects #ROBImport: {
        TargetEntities: [ROBLedger]
    }
);

annotate BurnService.importFuelBurnExcel with (
    fileContent @title: 'Excel File'
                @Core.MediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                @Core.ContentDisposition.Filename: fileName
                @Core.ContentDisposition.Type: 'inline',
    fileName    @title: 'File Name'
                @UI.Hidden: true
);

annotate BurnService.importROBInitialExcel with (
    fileContent @title: 'Excel File'
                @Core.MediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                @Core.ContentDisposition.Filename: fileName
                @Core.ContentDisposition.Type: 'inline',
    fileName    @title: 'File Name'
                @UI.Hidden: true
);

annotate BurnService.importPlannedBurnExcel with (
    fileContent @title: 'Excel File'
                @Core.MediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                @Core.ContentDisposition.Filename: fileName
                @Core.ContentDisposition.Type: 'inline',
    fileName    @title: 'File Name'
                @UI.Hidden: true
);

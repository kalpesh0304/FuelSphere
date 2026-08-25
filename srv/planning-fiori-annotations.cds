/**
 * FuelSphere - Planning Service Fiori Annotations
 * Document: FDD-02 - Annual Planning & Forecasting
 *
 * UI Screens:
 * - FS-001: Flight Schedule (List Report)
 * - FS-002: Flight Schedule Detail (Object Page)
 * - FS-003: Flight Schedule Import (Excel Upload)
 */

using PlanningService from './planning-service';

// ============================================================================
// FLIGHT SCHEDULE - List Report + Object Page
// ============================================================================

// PlanningService exposes FuelOrders and never gave it a LineItem, so a facet
// listing a flight's orders had nothing to render. A LineItem here is
// annotation work rather than a schema change - the projection already exists.
annotate PlanningService.FuelOrders with @(
    UI: {
        // ONLY what this projection exposes. PlanningService.FuelOrders is a
        // RESTRICTED projection - twelve elements, no uom_code and no
        // ordered_quantity_kg - and a LineItem naming a field the projection
        // does not carry fails the read, not just the column.
        LineItem: [
            { Value: order_number,     Label: 'Order Number',  ![@UI.Importance]: #High },
            { Value: station_code,     Label: 'Station',       ![@UI.Importance]: #High },
            { Value: ordered_quantity, Label: 'Quantity',      ![@UI.Importance]: #High },
            { Value: total_amount,     Label: 'Total',         ![@UI.Importance]: #Medium },
            { Value: currency_code,    Label: 'Currency',      ![@UI.Importance]: #Low },
            { Value: status,           Label: 'Status',        ![@UI.Importance]: #High },
            { Value: requested_date,   Label: 'Requested',     ![@UI.Importance]: #Medium }
        ]
    }
);

annotate PlanningService.FuelOrders with {
    order_number     @title: 'Order Number';
    station_code     @title: 'Station';
    ordered_quantity @title: 'Quantity';
    total_amount     @title: 'Total';
    currency_code    @title: 'Currency';
    requested_date   @title: 'Requested';
};

annotate PlanningService.FlightSchedule with @(
    UI: {
        // --- Header ---
        HeaderInfo: {
            TypeName       : 'Flight Schedule',
            TypeNamePlural : 'Flight Schedule',
            Title          : { Value: flight_number },
            Description    : { Value: flight_date }
        },

        // --- Selection Fields (filter bar) ---
        SelectionFields: [
            flight_number,
            flight_date,
            origin_airport,
            destination_airport,
            aircraft_type,
            airline_code,
            status
        ],

        // --- List Report Table ---
        LineItem: [
            { Value: flight_number, Label: 'Flight Number' },
            { Value: flight_date, Label: 'Date' },
            { Value: airline_code, Label: 'Airline' },
            { Value: aircraft_type, Label: 'Aircraft Type' },
            { Value: aircraft_reg, Label: 'Registration' },
            { Value: origin_airport, Label: 'Origin' },
            { Value: destination_airport, Label: 'Destination' },
            { Value: scheduled_departure, Label: 'Departure' },
            { Value: scheduled_arrival, Label: 'Arrival' },
            { Value: status, Label: 'Status' },
            { Value: fuel_order_number, Label: 'Fuel Order' },
            {
                $Type  : 'UI.DataFieldForAction',
                Action : 'PlanningService.importFlightScheduleExcel',
                Label  : 'Upload Flight Schedule',
                Inline : false
            }
        ],

        // --- Object Page Header Facets ---
        HeaderFacets: [
            { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#FlightStatus', Label: 'Status' },
            { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#BlockTime', Label: 'Block Time' }
        ],

        // --- Object Page Sections ---
        Facets: [
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'FlightDetails',
                Label  : 'Flight Details',
                Facets : [
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#FlightIdentification', Label: 'Identification' },
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#RouteInfo', Label: 'Route' },
                    // WP-33. Beside the planned route, because it is the same fact observed.
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#ActualRouting', Label: 'Actual Routing' },
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#AircraftInfo', Label: 'Aircraft' }
                ]
            },
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'TerminalGate',
                Label  : 'Terminal & Gate',
                Facets : [
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#TerminalInfo', Label: 'Terminal & Stand' }
                ]
            },
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'ScheduleTimestamps',
                Label  : 'Schedule & Timestamps',
                Facets : [
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#ScheduledTimes', Label: 'Scheduled' },
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#EstimatedTimes', Label: 'Estimated' },
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#ActualTimes', Label: 'Actual' },
                    // WP-33. Immediately after the Actual timestamps, because the four figures
                    // are read AT those events - aobt / atot / aldt / aibt.
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#FuelOnBoard', Label: 'Fuel on Board' },
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#GroundHandover', Label: 'Ground Handover' }
                ]
            },
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'LinkedFlights',
                Label  : 'Linked Flights & Codeshare',
                Facets : [
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#LinkedFlightInfo', Label: 'Linked Flights' }
                ]
            },
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'DelayInfo',
                Label  : 'Delay & Cancellation',
                Facets : [
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#DelayDetails', Label: 'Delay Details' }
                ]
            },
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'FuelOrderSection',
                Label  : 'Fuel Orders',
                Facets : [
                    // A LIST, not a single order. The field group below reads
                    // through `fuel_order`, which is a to-one over a
                    // one-to-many condition and therefore shows one arbitrary
                    // order - PR1041 has two. It is kept because the number is
                    // useful at a glance; the list beside it is what is
                    // complete.
                    { $Type: 'UI.ReferenceFacet', Target: 'orders/@UI.LineItem', Label: 'All Orders for this Flight' },
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#FuelOrderInfo', Label: 'Order Details' }
                ]
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'AdminSection',
                Target : '@UI.FieldGroup#AdminInfo',
                Label  : 'Administration'
            }
        ],

        // --- Field Groups ---

        FieldGroup #FlightStatus: {
            Data: [
                { Value: status, Label: 'Status' },
                { Value: flight_nature, Label: 'Flight Nature' },
                { Value: service_type, Label: 'Service Type' }
            ]
        },

        FieldGroup #BlockTime: {
            Data: [
                { Value: planned_block_mins, Label: 'Planned Block (min)' },
                { Value: actual_block_mins, Label: 'Actual Block (min)' }
            ]
        },

        FieldGroup #FlightIdentification: {
            Data: [
                { Value: flight_number, Label: 'Flight Number' },
                { Value: flight_date, Label: 'Flight Date' },
                { Value: airline_code, Label: 'Airline Code' },
                { Value: flight_suffix, Label: 'Suffix' },
                { Value: service_type, Label: 'Service Type' },
                { Value: flight_nature, Label: 'Flight Nature' }
            ]
        },

        FieldGroup #RouteInfo: {
            Data: [
                { Value: origin_airport, Label: 'Origin Airport' },
                { Value: destination_airport, Label: 'Destination Airport' },
                { Value: scheduled_departure, Label: 'Departure Time' },
                { Value: scheduled_arrival, Label: 'Arrival Time' },
                { Value: status, Label: 'Status' }
            ]
        },

        FieldGroup #AircraftInfo: {
            Data: [
                { Value: aircraft_type, Label: 'Aircraft Type' },
                { Value: aircraft_reg, Label: 'Registration' }
            ]
        },

        FieldGroup #TerminalInfo: {
            Data: [
                { Value: departure_terminal, Label: 'Departure Terminal' },
                { Value: arrival_terminal, Label: 'Arrival Terminal' },
                { Value: gate_number, Label: 'Gate Number' },
                { Value: stand_number, Label: 'Stand Number' }
            ]
        },

        FieldGroup #ScheduledTimes: {
            Data: [
                { Value: sobt, Label: 'SOBT - Scheduled Off Block' },
                { Value: sibt, Label: 'SIBT - Scheduled In Block' },
                { Value: scheduled_departure, Label: 'Departure (Local)' },
                { Value: scheduled_arrival, Label: 'Arrival (Local)' }
            ]
        },

        FieldGroup #EstimatedTimes: {
            Data: [
                { Value: eobt, Label: 'EOBT - Estimated Off Block' },
                { Value: eibt, Label: 'EIBT - Estimated In Block' }
            ]
        },

        FieldGroup #ActualTimes: {
            Data: [
                { Value: aobt, Label: 'AOBT - Actual Off Block' },
                { Value: aibt, Label: 'AIBT - Actual In Block' },
                { Value: atot, Label: 'ATOT - Actual Take Off' },
                { Value: aldt, Label: 'ALDT - Actual Landing' },
                { Value: planned_block_mins, Label: 'Planned Block (min)' },
                { Value: actual_block_mins, Label: 'Actual Block (min)' }
            ]
        },

        // --- WP-33 ---------------------------------------------------------
        // A label is not a placement. These three groups exist so the fields
        // WP-33 adds are reachable, not merely titled.

        // The four figures read at OUT / OFF / ON / IN, with the flag saying how
        // they were obtained. WP-19 defines trip burn as OFF minus ON.
        FieldGroup #FuelOnBoard: {
            Data: [
                { Value: fob_at_out_kg, Label: 'FOB at OUT (kg)' },
                { Value: fob_at_off_kg, Label: 'FOB at OFF (kg)' },
                { Value: fob_at_on_kg,  Label: 'FOB at ON (kg)' },
                { Value: fob_at_in_kg,  Label: 'FOB at IN (kg)' },
                { Value: fob_source,    Label: 'Reading Source' }
            ]
        },

        // UI-B-03. WP-07B's convention: the association RESOLVES, the string
        // beside it is what was RECEIVED. Both, because a station the master
        // has never seen still has to be recordable.
        FieldGroup #ActualStations: {
            Data: [
                { Value: actual_origin.iata_code,      Label: 'Actual Origin (resolved)' },
                { Value: actual_origin_airport,        Label: 'Actual Origin (as received)' },
                { Value: actual_destination.iata_code, Label: 'Actual Destination (resolved)' },
                { Value: actual_destination_airport,   Label: 'Actual Destination (as received)' }
            ]
        },

        // The two ground-gap boundaries. An empty timestamp is NOT a zero gap -
        // it means there is no split point, which is a different answer.
        FieldGroup #GroundHandover: {
            Data: [
                { Value: flight_closure_utc, Label: 'Flight Closure (UTC)' },
                { Value: closure_source,     Label: 'Closure Source' },
                { Value: flight_start_utc,   Label: 'Flight Start (UTC)' },
                { Value: start_source,       Label: 'Start Source' }
            ]
        },

        // Where the flight actually operated, as received and as resolved.
        // Empty does NOT mean 'went as planned' - see the schema comment.
        FieldGroup #ActualRouting: {
            Data: [
                { Value: actual_origin_airport,      Label: 'Actual Origin' },
                { Value: actual_origin_ID,           Label: 'Actual Origin (resolved)' },
                { Value: actual_destination_airport, Label: 'Actual Destination' },
                { Value: actual_destination_ID,      Label: 'Actual Destination (resolved)' }
            ]
        },

        FieldGroup #LinkedFlightInfo: {
            Data: [
                { Value: linked_flight_number, Label: 'Linked Flight Number' },
                { Value: linked_flight_date, Label: 'Linked Flight Date' },
                { Value: codeshare_flights, Label: 'Codeshare Flights' }
            ]
        },

        FieldGroup #DelayDetails: {
            Data: [
                { Value: delay_code, Label: 'IATA Delay Code' },
                { Value: delay_minutes, Label: 'Delay Duration (min)' },
                { Value: cancellation_reason, Label: 'Cancellation Reason' }
            ]
        },

        FieldGroup #FuelOrderInfo: {
            Data: [
                { Value: fuel_order_number, Label: 'Fuel Order Number' },
                { Value: fuel_order.status, Label: 'Order Status' },
                { Value: fuel_order.station_code, Label: 'Station' },
                { Value: fuel_order.ordered_quantity, Label: 'Ordered Quantity (KG)' },
                { Value: fuel_order.priority, Label: 'Priority' },
                { Value: fuel_order.notes, Label: 'Notes' }
            ]
        },

        FieldGroup #AdminInfo: {
            Data: [
                { Value: created_at, Label: 'Created At' },
                { Value: created_by, Label: 'Created By' },
                { Value: modified_at, Label: 'Modified At' },
                { Value: modified_by, Label: 'Modified By' }
            ]
        }
    }
);

// ============================================================================
// Field-level annotations
// ============================================================================

annotate PlanningService.FlightSchedule with {
    ID                   @UI.Hidden;
    // WP-33 - a label for every field the groups above place.
    fob_at_out_kg                 @title: 'FOB at OUT (kg)';
    fob_at_off_kg                 @title: 'FOB at OFF (kg)';
    fob_at_on_kg                  @title: 'FOB at ON (kg)';
    fob_at_in_kg                  @title: 'FOB at IN (kg)';
    fob_source                    @title: 'Gauge Reading Source';
    // WP-31. On the association so the label reaches closure_document_ID.
    closure_document              @title: 'Tech Log Image';
    flight_closure_utc            @title: 'Flight Closure (UTC)';
    closure_source                @title: 'Closure Source';
    flight_start_utc              @title: 'Flight Start (UTC)';
    start_source                  @title: 'Start Source';
    // WP-33. The String(3) IATA codes carry the plain titles...
    actual_origin_airport         @title: 'Actual Origin';
    actual_destination_airport    @title: 'Actual Destination';
    // ...and the titles go on the ASSOCIATIONS so CAP propagates them to the
    // generated foreign keys actual_origin_ID / actual_destination_ID, which
    // are the properties that actually render.
    actual_origin                 @title: 'Actual Origin (resolved)';
    actual_destination            @title: 'Actual Destination (resolved)';
    flight_number        @title: 'Flight Number';
    flight_date          @title: 'Date';
    aircraft_type        @title: 'Aircraft Type';
    aircraft_reg         @title: 'Registration';
    origin_airport       @title: 'Origin';
    destination_airport  @title: 'Destination';
    scheduled_departure  @title: 'Departure';
    scheduled_arrival    @title: 'Arrival';
    status               @title: 'Status';
    airline_code         @title: 'Airline';
    flight_suffix        @title: 'Suffix';
    service_type         @title: 'Service Type';
    departure_terminal   @title: 'Dep. Terminal';
    arrival_terminal     @title: 'Arr. Terminal';
    gate_number          @title: 'Gate';
    stand_number         @title: 'Stand';
    sobt                 @title: 'SOBT (UTC)';
    sibt                 @title: 'SIBT (UTC)';
    eobt                 @title: 'EOBT (UTC)';
    eibt                 @title: 'EIBT (UTC)';
    aobt                 @title: 'AOBT (UTC)';
    aibt                 @title: 'AIBT (UTC)';
    atot                 @title: 'ATOT (UTC)';
    aldt                 @title: 'ALDT (UTC)';
    planned_block_mins   @title: 'Planned Block (min)';
    actual_block_mins    @title: 'Actual Block (min)';
    flight_nature        @title: 'Flight Nature';
    linked_flight_number @title: 'Linked Flight';
    linked_flight_date   @title: 'Linked Flight Date';
    codeshare_flights    @title: 'Codeshare';
    delay_code           @title: 'Delay Code';
    delay_minutes        @title: 'Delay (min)';
    cancellation_reason  @title: 'Cancellation Reason';
    fuel_order_number    @title: 'Fuel Order';
    fuel_order           @title: 'Fuel Order';
    created_at           @title: 'Created At';
    created_by           @title: 'Created By';
    modified_at          @title: 'Modified At';
    modified_by          @title: 'Modified By';
};

// ============================================================================
// IMPORT FLIGHT SCHEDULE FROM EXCEL - Action Annotations
// ============================================================================

annotate PlanningService with @(
    Common.SideEffects #FlightImport: {
        TargetEntities: [FlightSchedule]
    }
);

annotate PlanningService.importFlightScheduleExcel with (
    fileContent @title: 'Excel File'
                @Core.MediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                @Core.ContentDisposition.Filename: fileName
                @Core.ContentDisposition.Type: 'inline',
    fileName    @title: 'File Name'
                @UI.Hidden: true
);

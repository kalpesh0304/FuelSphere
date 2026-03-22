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
            { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#FuelOrderHeader', Label: 'Fuel Order' },
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
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#ActualTimes', Label: 'Actual' }
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
                $Type  : 'UI.ReferenceFacet',
                ID     : 'FuelOrderSection',
                Target : '@UI.FieldGroup#FuelOrderInfo',
                Label  : 'Fuel Order'
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

        FieldGroup #FuelOrderHeader: {
            Data: [
                { Value: fuel_order_number, Label: 'Order Number' },
                { Value: fuel_order.status, Label: 'Status' }
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
    fileContent @title: 'Excel File'       @Core.MediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileName    @title: 'File Name'
);

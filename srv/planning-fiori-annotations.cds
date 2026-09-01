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
// ============================================================================
// The dispatch plan, as a flight reaches it.
//
// PACKAGE B'S PER-SERVICE ANNOTATION WAS FORCED, NOT CHOSEN, and it has read
// as a choice ever since. Measured in an isolated model: annotating
// FuelOrderService.X does NOT propagate to PlanningService.X - sibling
// projections of one entity inherit nothing from each other. Only an
// annotation on the DATABASE entity propagates, and that route is worse here,
// because every projection would then have to carry every field named and
// nothing warns when one does not. PlanningService.FuelOrders exposes 12 of
// FUEL_ORDERS' 52 elements.
//
// So this is not the duplication Package D rejected. That was a 49-element
// annotation mirrored across services to maintain one screen. This is nine
// columns written against a projection that exposes fifteen.
// ============================================================================
// ============================================================================
// The fuel that went into this aircraft for this leg.
//
// Both entities are VIEWS (db/schema.cds) and CAP AUTO-EXPOSED them - they are
// association targets of FLIGHT_SCHEDULE, so they appear on every service that
// exposes it, under their database names. Nothing here declares them; the
// entity set name shows only in the URL, and the screen reads HeaderInfo.
//
// Columns chosen for a reader looking at a FLIGHT, not at a delivery. The
// delivery's own object page already shows everything; this answers one
// question and stops.
// ============================================================================
annotate PlanningService.FLIGHT_FUEL_DELIVERIES with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Delivery',
            TypeNamePlural : 'Deliveries',
            Title          : { Value: delivery_number },
            Description    : { Value: recon_status }
        },
        LineItem: [
            { Value: delivery_number,    Label: 'Delivery',        ![@UI.Importance]: #High },
            { Value: delivered_quantity, Label: 'Delivered',       ![@UI.Importance]: #High },
            { Value: fob_delta_kg,       Label: 'Gauge Delta (kg)',![@UI.Importance]: #High },
            // NOT_RECONCILED must never read as a pass. Unknown is not agreement.
            { Value: recon_variance_kg,  Label: 'Variance (kg)',   ![@UI.Importance]: #High },
            { Value: recon_status,       Label: 'Reconciliation',  ![@UI.Importance]: #High },
            { Value: fob_source,         Label: 'Gauge Source',    ![@UI.Importance]: #Medium },
            { Value: supplier_count,     Label: 'Suppliers',       ![@UI.Importance]: #Medium }
        ]
    }
);

annotate PlanningService.FLIGHT_FUEL_DELIVERIES with {
    delivery_number    @title: 'Delivery';
    delivery_date      @title: 'Date';
    delivered_quantity @title: 'Delivered';
    fob_delta_kg       @title: 'Gauge Delta (kg)';
    fob_source         @title: 'Gauge Source';
    recon_variance_kg  @title: 'Variance (kg)';
    recon_status       @title: 'Reconciliation';
    supplier_count     @title: 'Suppliers';
    aircraft_reg       @title: 'Registration';
};

annotate PlanningService.FLIGHT_FUEL_TICKETS with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Fuel Ticket',
            TypeNamePlural : 'Fuel Tickets',
            Title          : { Value: ticket_number },
            Description    : { Value: supplier_name }
        },
        LineItem: [
            { Value: ticket_number,      Label: 'Ticket',          ![@UI.Importance]: #High },
            { Value: quantity_metered,   Label: 'Metered',         ![@UI.Importance]: #High },
            { Value: quantity_kg,        Label: 'Mass (kg)',       ![@UI.Importance]: #High },
            // Resolves TRANSITIVELY through the order. Blank means unmatched,
            // and unknown is not the same as none.
            { Value: supplier_name,      Label: 'Supplier',        ![@UI.Importance]: #High },
            { Value: match_status,       Label: 'Match',           ![@UI.Importance]: #High },
            // uplift_sequence does not exist on FUEL_TICKETS. The timestamp is
            // what makes two tickets on one order read as one uplift split
            // across two bowsers rather than two unrelated events.
            { Value: delivery_timestamp, Label: 'Delivered At',    ![@UI.Importance]: #Medium }
        ]
    }
);

annotate PlanningService.FLIGHT_FUEL_TICKETS with {
    ticket_number      @title: 'Ticket';
    quantity_metered   @title: 'Metered';
    quantity_kg        @title: 'Mass (kg)';
    supplier_name      @title: 'Supplier';
    match_status       @title: 'Match';
    delivery_timestamp @title: 'Delivered At';
    density_value      @title: 'Density';
    aircraft_reg       @title: 'Registration';
};

annotate PlanningService.FlightDispatches with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Dispatch Plan',
            TypeNamePlural : 'Dispatch Plans',
            Title          : { Value: plan_group_id },
            Description    : { Value: plan_status }
        },
        LineItem: [
            { Value: plan_version,       Label: 'Version',        ![@UI.Importance]: #High },
            { Value: plan_status,        Label: 'Status',         ![@UI.Importance]: #High },
            { Value: block_fuel_kg,      Label: 'Block (kg)',     ![@UI.Importance]: #High },
            { Value: required_uplift_kg, Label: 'Uplift (kg)',    ![@UI.Importance]: #High },
            { Value: rob_departure_kg,   Label: 'ROB Dep (kg)',   ![@UI.Importance]: #Medium },
            { Value: alternate_airport,  Label: 'Alternate',      ![@UI.Importance]: #Medium },
            { Value: tail_number,        Label: 'Tail',           ![@UI.Importance]: #Medium },
            { Value: dispatch_source,    Label: 'Source',         ![@UI.Importance]: #Low },
            { Value: dispatch_timestamp, Label: 'Issued',         ![@UI.Importance]: #Low }
        ]
    }
);

annotate PlanningService.FlightDispatches with {
    plan_group_id       @title: 'Plan Family';
    plan_version        @title: 'Version';
    plan_status         @title: 'Status';
    block_fuel_kg       @title: 'Block Fuel (kg)';
    required_uplift_kg  @title: 'Required Uplift (kg)';
    rob_departure_kg    @title: 'ROB at Departure (kg)';
    alternate_airport   @title: 'Alternate';
    tail_number         @title: 'Tail';
    dispatch_source     @title: 'Source';
    dispatch_timestamp  @title: 'Issued';
};

annotate PlanningService.FuelOrders with @(
    UI: {
        // ====================================================================
        // THE ORDER'S FLIGHT, AND WHY THIS ONE FACET LIVES ON A DIFFERENT
        // SERVICE FROM ITS SIBLINGS.
        //
        // Both PlanningService and FuelOrderService carry `flight` on their
        // FuelOrders. Only one can render it: a to-one facet must name a
        // FieldGroup, and FuelOrderService.FlightSchedule has a LineItem and
        // NO FieldGroup, while PlanningService.FlightSchedule has sixteen.
        //
        // THAT IS NOT A DESIGN CHOICE BEING HONOURED. It is a historical
        // accident - two ends annotated years apart for unrelated reasons -
        // that now decides which screen can show the link. Someone will ask
        // why this facet is not beside the other two; the answer is not a
        // principle, and it is written here so nobody looks for one.
        // ====================================================================
        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'OrderFlight',
              Target: 'flight/@UI.FieldGroup#FlightIdentification', Label: 'Flight' }
        ],
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
            { Value: requested_date,   Label: 'Requested',     ![@UI.Importance]: #Medium },
            // D44 / 2. Carried over from #FuelOrderInfo, which read them
            // through `fuel_order` - one arbitrary order where a flight has
            // several. Here they belong to the order that owns them.
            { Value: priority,         Label: 'Priority',      ![@UI.Importance]: #Medium },
            { Value: notes,            Label: 'Notes',         ![@UI.Importance]: #Low }
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

// ============================================================================
// The aircraft register, reached from a flight.
//
// Package D exposed this entity on PlanningService, which opened the path and
// annotated nothing - so a navigation arriving here would have found a page
// with no header, no sections and no fields. Exposing a target is necessary
// and not sufficient, the same way declaring an association is.
//
// DELIBERATELY THINNER THAN MasterDataService's. That service MAINTAINS the
// register and shows the confirmation workflow; this one CONSUMES it, and a
// planner opening a tail from a flight wants the operating facts.
// ============================================================================
annotate PlanningService.AircraftRegistrations with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Aircraft',
            TypeNamePlural : 'Aircraft Register',
            Title          : { Value: registration },
            Description    : { Value: aircraft_type_code }
        },
        SelectionFields: [ registration, aircraft_type_code, record_status, operator_code ],
        LineItem: [
            { Value: registration,        Label: 'Registration',  ![@UI.Importance]: #High },
            { Value: aircraft_type_code,  Label: 'Type',          ![@UI.Importance]: #High },
            { Value: record_status,       Label: 'Record Status', ![@UI.Importance]: #High },
            { Value: operator_code,       Label: 'Operator',      ![@UI.Importance]: #Medium },
            { Value: apu_burn_rate_kg_hr, Label: 'APU Rate (kg/h)', ![@UI.Importance]: #Medium }
        ],
        HeaderFacets: [
            { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#RegStatus', Label: 'Status' }
        ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'RegIdentity',
              Target: '@UI.FieldGroup#RegIdentity', Label: 'Identity' },
            { $Type: 'UI.ReferenceFacet', ID: 'RegPerformance',
              Target: '@UI.FieldGroup#RegPerformance', Label: 'Performance' }
        ],
        FieldGroup #RegStatus: {
            Data: [
                // PROVISIONAL is not an error - a tail can be recorded before
                // its paperwork completes, and fuel is ordered against it.
                { Value: record_status, Label: 'Record Status' },
                { Value: operator_code, Label: 'Operator' }
            ]
        },
        FieldGroup #RegIdentity: {
            Data: [
                { Value: registration,       Label: 'Registration' },
                { Value: aircraft_type_code, Label: 'Type' },
                { Value: operator_code,      Label: 'Operator' },
                { Value: on_own_aoc,         Label: 'On Own AOC' }
            ]
        },
        FieldGroup #RegPerformance: {
            Data: [
                // The rate every APU figure in the seed derives from.
                { Value: apu_burn_rate_kg_hr,     Label: 'APU Burn Rate (kg/h)' },
                { Value: fuel_capacity_kg,        Label: 'Fuel Capacity (kg)' },
                { Value: dry_operating_weight_kg, Label: 'Dry Operating Weight (kg)' },
                { Value: performance_factor_pct,  Label: 'Performance Factor (%)' }
            ]
        }
    }
);

annotate PlanningService.AircraftRegistrations with {
    registration            @title: 'Registration';
    aircraft_type_code      @title: 'Type';
    record_status           @title: 'Record Status';
    operator_code           @title: 'Operator';
    on_own_aoc              @title: 'On Own AOC';
    apu_burn_rate_kg_hr     @title: 'APU Burn Rate (kg/h)';
    // Blank means the provenance is unrecorded, which is a question
    // rather than a default. See the schema comment at the field.
    apu_rate_source         @title: 'APU Rate Source';
    fuel_capacity_kg        @title: 'Fuel Capacity (kg)';
    dry_operating_weight_kg @title: 'Dry Operating Weight (kg)';
    performance_factor_pct  @title: 'Performance Factor (%)';
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
                $Type  : 'UI.ReferenceFacet',
                ID     : 'FlightDeliveries',
                Target : 'deliveries/@UI.LineItem',
                Label  : 'Deliveries'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'FlightTickets',
                Target : 'tickets/@UI.LineItem',
                Label  : 'Fuel Tickets'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'DispatchPlans',
                Target : 'dispatches/@UI.LineItem',
                Label  : 'Dispatch Plans'
            },
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'FuelOrderSection',
                Label  : 'Fuel Orders',
                Facets : [
                    // D44. A LIST, AND ONLY A LIST.
                    //
                    // #FuelOrderInfo sat beside this and read through
                    // `fuel_order` - a to-one over a one-to-many condition,
                    // showing one arbitrary order where PR1041 has two. Its
                    // two fields the list did not already carry, priority and
                    // notes, moved onto the list. Nothing was lost and the
                    // arbitrary row is gone.
                    { $Type: 'UI.ReferenceFacet', Target: 'orders/@UI.LineItem', Label: 'All Orders for this Flight' }
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

        // ====================================================================
        // BOTH FACTS, NOT ONE. WP-07B's convention is that the value AS
        // RECEIVED and the value AS RESOLVED are different facts, and the case
        // that matters most is when they disagree.
        //
        // Replacing the string with the association would hide that: an
        // unresolved registration would render as an empty field with nothing
        // saying a registration was received at all. A BLANK 'Aircraft' BESIDE
        // A POPULATED 'Registration' IS A VISIBLE STATE THAT MEANS SOMETHING -
        // the tail arrived on a feed and the register has never seen it. That
        // is ACCEPT_PROVISIONAL made legible rather than silent.
        //
        // The link goes on the ASSOCIATION. The string stays text.
        // ====================================================================
        FieldGroup #AircraftInfo: {
            Data: [
                { Value: aircraft_type, Label: 'Aircraft Type' },
                // As received. Always present, never a link.
                { Value: aircraft_reg, Label: 'Registration' },
                // As resolved, AND CLICKABLE.
                //
                // DataFieldWithNavigationPath, not DataField. A plain
                // `Value: tail_registration` emits UI.DataField and renders as
                // a THIRD TEXT COLUMN - it looks like the fix and navigates
                // nowhere. The record type is what makes the value a link, and
                // Target names the association it follows.
                //
                // In-app navigation, not @Common.SemanticObject: a semantic
                // object resolves through the launchpad's intent registry,
                // which is not available here, so it would render as a link
                // with nowhere to go.
                {
                    $Type  : 'UI.DataFieldWithNavigationPath',
                    Value  : tail_registration,
                    Label  : 'Aircraft',
                    Target : tail,
                    ![@UI.Importance]: #High
                }
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
    // The field stays and its title with it. It is a single denormalised
    // value on an entity that can have several orders - the same cardinality
    // problem in a different shape - and it is empty on every seeded flight,
    // because its only writer is the auto-creation path. Off the page until
    // it means something; not removed, because its naming is sound.
    fuel_order_number    @title: 'Fuel Order';
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

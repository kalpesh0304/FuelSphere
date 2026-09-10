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
        ],

        // ------------------------------------------------------------------
        // THE FUEL STATUS CARD on the Flight Fuel Overview.
        //
        // A QUALIFIER, not the plain LineItem, because a card must say LESS
        // than a table. The unqualified LineItem above is the delivery list
        // inside a flight; this is the verdict, and a verdict with seven
        // columns is a table with a title.
        //
        // WHAT IS DELIBERATELY ABSENT, so nobody reads the card as complete:
        // the mockup also shows "by meter" and "tolerance". By-meter is the
        // ticket total and is not on this view - it is derivable as
        // fob_delta_kg + recon_variance_kg, but a derived headline needs a
        // decision about where it is computed rather than an arithmetic
        // coincidence in an annotation. Tolerance resolves from
        // TOLERANCE_RULES through resolveEffective and is not a column
        // anywhere. Both belong to E2b.
        //
        // NOT_RECONCILED must never read as a pass. Unknown is not agreement,
        // which is why recon_status is on the card rather than a tick.
        // ------------------------------------------------------------------
        LineItem #FuelStatusCard: [
            { Value: recon_status,      Label: 'Reconciliation',   ![@UI.Importance]: #High },
            { Value: fob_delta_kg,      Label: 'By gauge (kg)',    ![@UI.Importance]: #High },
            { Value: recon_variance_kg, Label: 'Variance (kg)',    ![@UI.Importance]: #High },
            { Value: delivery_number,   Label: 'Delivery',         ![@UI.Importance]: #Medium },
            { Value: fob_source,        Label: 'Gauge source',     ![@UI.Importance]: #Medium }
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
            status,
            // A. THE SME ASKED FOR THE SUPPLIER AS A FILTER AND A COLUMN,
            // twice in one session. Both, not either.
            //
            // It filters on the STATION DEFAULT rather than the flight-level
            // designation because that is the one 13 of 22 flights have -
            // filtering on the flight axis would return one row and read as
            // broken. A flight with its own arrangement still matches its
            // station's filter, which is the behaviour a planner expects
            // from "show me World Fuel's flights".
            station_default.supplier.supplier_name
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

            // A. The supplier as a COLUMN, and the two the survey confirmed
            // exist. `terminal` is NOT here: the brief listed gate, stand and
            // terminal as present and only two of the three are - a field
            // that is not there is a question, not a blank column.
            {
                Value: station_default.supplier.supplier_name,
                Label: 'Supplier (station)',
                ![@UI.Importance]: #High
            },
            { Value: gate_number,  Label: 'Gate',  ![@UI.Importance]: #Medium },
            { Value: stand_number, Label: 'Stand', ![@UI.Importance]: #Medium },

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
            // ================================================================
            // A — THE THREE BLOCKS. Two of them, and the third short by three
            // fields that are not in the model.
            //
            // ALL RESOLVED THROUGH ASSOCIATIONS, NEVER COPIED. A supplier
            // changes a number and every flight shows the new one.
            //
            // AND BOTH SUPPLIER BLOCKS ALWAYS SHOW, even where a flight has
            // its own designation. If the station block were hidden when the
            // flight one exists, 21 flights would have two blocks and one
            // would have a single block, and THE PAGE WOULD CHANGE SHAPE
            // BETWEEN ROWS - which is worse than an empty section, because a
            // viewer cannot tell a missing block from an absent one.
            // ================================================================
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'DesignatedForThisFlight',
                // Named for what it is, not for its rung. "Primary" and
                // "fallback" are resolver words; a planner does not think in
                // rungs, and an empty block here MEANS SOMETHING - this
                // flight has no arrangement of its own.
                Label  : 'Designated for this flight',
                Target : 'designation/@UI.LineItem#FlightBlock'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'StationDefault',
                Label  : 'This station''s default',
                Target : 'station_default/@UI.LineItem#StationBlock'
            },
            // ================================================================
            // WHO TO RING, AND FOR WHAT. Two blocks, because the answer
            // differs by party: where the supplier does not perform its own
            // uplift, the UPLIFT contact sits with the AGENT while invoicing
            // and disputes stay with the SUPPLIER. One combined block would
            // put a planner on the phone to the wrong company at 05:00.
            //
            // Reached through the designation, which is what resolves WHICH
            // supplier and WHICH agent for this flight on this date.
            // ================================================================
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'FlightContacts',
                Label  : 'Who to ring',
                Target : 'contacts/@UI.LineItem#ContactStrip'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'AircraftBlock',
                Label  : 'Aircraft',
                Target : 'tail/@UI.FieldGroup#AircraftForFlight'
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

// ============================================================================
// A — THE SUPPLIER AND AGENT BLOCKS
//
// Two qualified LineItems on one entity, because the two blocks answer
// different questions and a planner reads them differently.
//
// #FlightBlock   "is there an arrangement for THIS flight?"
// #StationBlock  "and what does this station do otherwise?"
//
// Both carry the validity window. NEITHER ASSOCIATION FILTERS BY DATE - a
// date in the `on` condition narrows a row set without picking one, so a
// screen could show an expired designation beside a live one with nothing
// saying which. Showing valid_from and valid_to lets the reader see the
// window instead of trusting it.
// ============================================================================
annotate PlanningService.DesignatedSuppliers with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Designation',
            TypeNamePlural : 'Designations',
            Title          : { Value: supplier.supplier_name },
            Description    : { Value: designation_type }
        },

        LineItem #FlightBlock: [
            { Value: supplier.supplier_name,    Label: 'Supplier',        ![@UI.Importance]: #High },
            { Value: supplier_contract.contract_number, Label: 'Fuel contract', ![@UI.Importance]: #High },
            // TRUE means the supplier fuels its own product and the two agent
            // columns are EMPTY BY DESIGN - a different state from "not known
            // yet", and this column is what tells them apart.
            { Value: supplier_performs_uplift,  Label: 'Supplier fuels',  ![@UI.Importance]: #High },
            { Value: into_plane_agent.supplier_name, Label: 'Into-plane agent', ![@UI.Importance]: #High },
            { Value: into_plane_contract.contract_number, Label: 'Handling contract', ![@UI.Importance]: #Medium },
            { Value: valid_from,                Label: 'Valid from',      ![@UI.Importance]: #Medium },
            { Value: valid_to,                  Label: 'Valid to',        ![@UI.Importance]: #Medium }
        ],

        // The station block adds the station and drops nothing: a planner
        // looking at a default wants to see WHICH station it belongs to,
        // because the flight's origin is elsewhere on the page.
        LineItem #StationBlock: [
            { Value: station_code,              Label: 'Station',         ![@UI.Importance]: #High },
            { Value: supplier.supplier_name,    Label: 'Supplier',        ![@UI.Importance]: #High },
            { Value: supplier_contract.contract_number, Label: 'Fuel contract', ![@UI.Importance]: #High },
            { Value: supplier_performs_uplift,  Label: 'Supplier fuels',  ![@UI.Importance]: #High },
            { Value: into_plane_agent.supplier_name, Label: 'Into-plane agent', ![@UI.Importance]: #High },
            { Value: into_plane_contract.contract_number, Label: 'Handling contract', ![@UI.Importance]: #Medium },
            { Value: valid_from,                Label: 'Valid from',      ![@UI.Importance]: #Medium },
            { Value: valid_to,                  Label: 'Valid to',        ![@UI.Importance]: #Medium }
        ]
    }
);

annotate PlanningService.DesignatedSuppliers with {
    ID                       @UI.Hidden;
    flight_number            @title: 'Flight';
    station                  @title: 'Station';
    station_code             @title: 'Station';
    carrier_code             @title: 'Carrier';
    supplier                 @title: 'Supplier';
    supplier_contract        @title: 'Fuel Contract';
    supplier_performs_uplift @title: 'Supplier Performs Uplift';
    into_plane_agent         @title: 'Into-Plane Agent';
    into_plane_contract      @title: 'Handling Contract';
    designation_type         @title: 'Designation';
    valid_from               @title: 'Valid From';
    valid_to                 @title: 'Valid To';
    priority                 @title: 'Priority';
    is_active                @title: 'Active';
    notes                    @title: 'Notes' @UI.MultiLineText;
};

// ============================================================================
// A — THE AIRCRAFT BLOCK, AND IT SHIPS SHORT BY THREE FIELDS
//
// MLW, MZFW and engine_burn_rate_kgph ARE NOT IN THE MODEL. Not on the
// registration, not on the type. So they are MISSING here rather than
// declared and blank: a field that is not there is a question, and a blank
// one is the eighth cause of an empty section.
//
// MTOW is reached THROUGH the type. It lives on AIRCRAFT_MASTER and is
// populated 17/17; the registration overrides fuel capacity where tanks
// differ and does not carry a weight of its own.
// ============================================================================
annotate PlanningService.AircraftRegistrations with @(
    UI: {
        FieldGroup #AircraftForFlight: {
            Label: 'Aircraft',
            Data: [
                { Value: registration,             Label: 'Registration' },
                { Value: aircraft_type_code,       Label: 'Type' },
                { Value: aircraft_type.mtow_kg,    Label: 'MTOW (kg)' },
                { Value: dry_operating_weight_kg,  Label: 'DOW (kg)' },
                { Value: fuel_capacity_kg,         Label: 'Fuel capacity (kg)' },
                { Value: apu_burn_rate_kg_hr,      Label: 'APU burn (kg/h)' },
                { Value: apu_rate_source,          Label: 'APU rate source' },
                { Value: performance_factor_pct,   Label: 'Performance factor (%)' },
                { Value: record_status,            Label: 'Register status' }
            ]
        }
    }
);

// ============================================================================
// A — THE FILTER BAR'S LABEL.
//
// SelectionFields carries NO inline label. A LineItem entry can say
// `{ Value: x, Label: 'Y' }` and that renders; a filter field has only the
// PROPERTY'S label, so a property with none shows its technical name.
//
// That is why the flight list's supplier filter rendered as "supplier_name"
// while every LineItem column beside it read correctly - the columns carry
// inline labels and the filter cannot.
//
// PlanningService.Suppliers/supplier_name carried only Common.FieldControl,
// from @mandatory, and no Common.Label at all.
// ============================================================================
annotate PlanningService.Suppliers with {
    supplier_name @title: 'Supplier';
    supplier_code @title: 'Supplier Code';
    supplier_type @title: 'Supplier Type';
};

// ===========================================================================
// E2b — THE FLIGHT FUEL OVERVIEW'S REMAINING SEVEN CARDS
//
// EIGHT CARDS, NOT NINE. The mockup shows nine; card 9 (Invoicing) is
// deliberately absent because an airline planner's overview reaching the
// invoicing entity is a MODULE boundary rather than a convenience. The
// reason lives at the exposure site in planning-service.cds, where it reads
// as a decision; here it would read as a gap.
//
// EVERY CARD BELOW BINDS AN ENTITY THAT CARRIES THE GLOBAL FILTER'S NAMES.
// That was not true of four of them before this package: an OVP propagates
// its filter BY MATCHING PROPERTY NAMES, FlightSchedule's key is ID, and
// the filter bar therefore never emits flight_ID. An entity carrying only
// flight_ID overlaps the filter on nothing and its card shows the fleet.
// ===========================================================================

// ---- CARD 2 · DISPATCH PLAN ----------------------------------------------
// The stack that sums, and the required uplift. FLIGHT_DISPATCH holds a
// single dispatch_qty_kg with no term breakdown (trip/taxi/contingency/
// alternate/reserve/extra), so the card shows what exists rather than the
// six-term stack the design describes. Stating that here rather than
// rendering five blank columns.
annotate PlanningService.FlightDispatches with @(
    UI.LineItem #DispatchCard: [
        { Value: plan_version,       Label: 'Version' },
        { Value: plan_status,        Label: 'Status' },
        { Value: dispatch_qty_kg,    Label: 'Dispatch (kg)' },
        { Value: block_fuel_kg,      Label: 'Block (kg)' },
        { Value: required_uplift_kg, Label: 'Required uplift (kg)' },
        { Value: rob_departure_kg,   Label: 'ROB at departure (kg)' }
    ]
);

// ---- CARD 3 · AIRCRAFT ---------------------------------------------------
// MLW, MZFW and engine_burn_rate_kgph are NOWHERE IN THE MODEL - not on the
// tail, not on the type. They arrive with work package B and they arrive
// here, which is why this is a card rather than a header strip: a strip
// would have to become a card that day.
//
// mtow_kg and cruise_burn_kgph are on the TYPE, not the registration, so
// they are the same figure for every tail of that type. dow_kg and
// fuel_capacity_kg are per-tail.
annotate PlanningService.FlightAircraft with @(
    UI.LineItem #AircraftCard: [
        { Value: registration,        Label: 'Tail' },
        { Value: tail_type_code,      Label: 'Type' },
        { Value: mtow_kg,             Label: 'MTOW (kg)' },
        { Value: dow_kg,              Label: 'DOW (kg)' },
        { Value: fuel_capacity_kg,    Label: 'Fuel capacity (kg)' },
        { Value: apu_burn_rate_kg_hr, Label: 'APU burn (kg/h)' },
        { Value: cruise_burn_kgph,    Label: 'Cruise burn (kg/h)' }
    ]
);

// ---- CARD 4 · SUPPLIER AND INTO-PLANE AGENT ------------------------------
// BOTH AXES, AND `axis` IS THE FIRST COLUMN. The card's entire point,
// decided 1 September, is that the station default stays visible when a
// flight-level designation exists. Binding DesignatedSuppliers directly
// would have hidden it on twenty of twenty-two flights, because a station
// default's flight_number is null and the filter excludes it.
//
// Sorted so FLIGHT precedes STATION - alphabetical here, and that is an
// accident worth naming rather than relying on: it is right today and would
// break the day an axis is added. The sort is deliberate and the order is
// FLIGHT first because it is the one that governs.
annotate PlanningService.FlightDesignation with @(
    UI.LineItem #DesignationCard: [
        { Value: axis,             Label: 'Applies by' },
        { Value: supplier.supplier_name,         Label: 'Supplier' },
        { Value: into_plane_agent.supplier_name, Label: 'Into-plane agent' },
        { Value: station_code,     Label: 'Station' },
        { Value: designation_type, Label: 'Type' },
        { Value: priority,         Label: 'Priority' }
    ]
);

// ---- CARD 5 · FUEL ORDERS ------------------------------------------------
annotate PlanningService.FuelOrders with @(
    UI.LineItem #OrdersCard: [
        { Value: order_number,     Label: 'Order' },
        { Value: status,           Label: 'Status' },
        { Value: station_code,     Label: 'Station' },
        { Value: ordered_quantity, Label: 'Ordered' },
        { Value: unit_price,       Label: 'Unit price' },
        { Value: total_amount,     Label: 'Total' }
    ]
);

// ---- CARD 6 · FUEL TICKETS -----------------------------------------------
annotate PlanningService.FLIGHT_FUEL_TICKETS with @(
    UI.LineItem #TicketsCard: [
        { Value: ticket_number,      Label: 'Ticket' },
        { Value: supplier_name,      Label: 'Supplier' },
        { Value: quantity_metered,   Label: 'Metered' },
        { Value: uom_code,           Label: 'UoM' },
        { Value: quantity_kg,        Label: 'Mass (kg)' },
        { Value: match_status,       Label: 'Match' },
        { Value: delivery_timestamp, Label: 'Delivered' }
    ]
);

// ---- CARD 7 · DELIVERY ---------------------------------------------------
// The gauge pair, the refuel window, the supplier count. DISTINCT FROM
// CARD 1, which binds the narrow FLIGHT_FUEL_DELIVERIES view and answers
// "what is the reconciliation verdict". This answers "what physically
// happened at the aircraft", and needs fields that view does not carry.
annotate PlanningService.FuelDeliveries with @(
    UI.LineItem #DeliveryCard: [
        { Value: delivery_number,  Label: 'Delivery' },
        { Value: fob_before_kg,    Label: 'FOB before (kg)' },
        { Value: fob_after_kg,     Label: 'FOB after (kg)' },
        { Value: refuel_start_utc, Label: 'Refuel start' },
        { Value: refuel_end_utc,   Label: 'Refuel end' },
        { Value: supplier_count,   Label: 'Suppliers' },
        { Value: delivery_method,  Label: 'Method' }
    ]
);

// ---- CARD 8 · BURN -------------------------------------------------------
// The reversal. BurnService still OWNS this entity - handlers, the variance
// ladder, every write path - and the Planning projection is @readonly.
// Ownership and reachability are different questions.
//
// engine_burn_kg and apu_burn_kg are the WP-19/WP-34 split at closure, and
// D42 is open against applyBurnSplit: ground APU is subtracted from block
// burn, which never contained it. The figure is shown as stored; the defect
// is recorded, not papered over on the card.
annotate PlanningService.FuelBurns with @(
    UI.LineItem #BurnCard: [
        { Value: burn_date,       Label: 'Burn date' },
        { Value: planned_burn_kg, Label: 'Planned (kg)' },
        { Value: actual_burn_kg,  Label: 'Actual (kg)' },
        { Value: variance_kg,     Label: 'Variance (kg)' },
        { Value: variance_status, Label: 'Verdict' },
        { Value: engine_burn_kg,  Label: 'Engine (kg)' },
        { Value: apu_burn_kg,     Label: 'APU (kg)' }
    ]
);

// Titles on every field these cards bind, because a card column falls back
// to the technical name and ui02 EXIT-2c ratchets exactly this.
annotate PlanningService.FlightDesignation with {
    axis             @title: 'Applies By';
    station_code     @title: 'Station';
    carrier_code     @title: 'Carrier';
    designation_type @title: 'Designation Type';
    priority         @title: 'Priority';
    valid_from       @title: 'Valid From';
    valid_to         @title: 'Valid To';
    flight_number    @title: 'Flight Number';
    flight_date      @title: 'Flight Date';
}
annotate PlanningService.FlightAircraft with {
    registration        @title: 'Tail';
    tail_type_code      @title: 'Aircraft Type';
    mtow_kg             @title: 'MTOW (kg)';
    dow_kg              @title: 'Dry Operating Weight (kg)';
    fuel_capacity_kg    @title: 'Fuel Capacity (kg)';
    apu_burn_rate_kg_hr @title: 'APU Burn Rate (kg/h)';
    cruise_burn_kgph    @title: 'Cruise Burn (kg/h)';
    aircraft_model      @title: 'Aircraft Model';
    flight_number       @title: 'Flight Number';
    flight_date         @title: 'Flight Date';
}


// ===========================================================================
// C — THE CONTACT STRIP
//
// PRIMARY PER ROLE, WITH THE COUNT OF OTHERS. The strip exists so somebody
// can ring at 05:00: four roles, four numbers, one screen. Showing every
// contact stops it being scannable, and a planner reading eight rows to find
// the uplift number has lost the thing the strip was for.
//
// AND "+N more" IS THE WHOLE AFFORDANCE. A strip showing one contact with no
// sign of a second is the same silence as an Aircraft card that omits MLW -
// correct, and it teaches nothing. other_count says others EXIST without
// spending a row on them.
// ===========================================================================
annotate PlanningService.FlightContacts with @(
    UI: {
        // AGENT BEFORE SUPPLIER, THEN sort_order WITHIN EACH.
        //
        // On partyRank, not on the party string: 'AGENT' < 'SUPPLIER'
        // alphabetically and would work today by accident. And within a
        // party on sort_order, not role_name - DISPUTES comes first
        // alphabetically and is the one you ring last.
        PresentationVariant: {
            SortOrder: [
                { Property: partyRank,  Descending: false },
                { Property: sort_order, Descending: false }
            ],
            Visualizations: [ '@UI.LineItem#ContactStrip' ]
        },
        LineItem #ContactStrip: [
            // THE PARTY FIRST. Where the supplier does not perform its own
            // uplift, invoicing and disputes stay with the supplier while
            // the uplift number is the agent's - and a planner who cannot
            // see which is which rings the wrong company at 05:00.
            { Value: party,           Label: 'Party',    ![@UI.Importance]: #High },
            { Value: supplier_name,   Label: 'Company',  ![@UI.Importance]: #High },
            { Value: role_name,        Label: 'Role',    ![@UI.Importance]: #High },
            // "none recorded" arrives as a null primary_name on a row that
            // EXISTS. The row is the finding; the null is how it reads.
            { Value: primary_name,     Label: 'Contact', Criticality: contactCriticality,
              ![@UI.Importance]: #High },
            // THE THIRD STATE, SPELT OUT. A blank Contact now means two
            // opposite things and this is the column that separates them:
            // NOT_APPLICABLE is a fact about the split, NONE_RECORDED is a
            // gap in our records. role_note carries the one-clause reason.
            { Value: role_status,      Label: 'Status',  ![@UI.Importance]: #High },
            { Value: role_note,        Label: 'Why',     ![@UI.Importance]: #High },
            { Value: primary_phone,    Label: 'Phone',   ![@UI.Importance]: #High },
            { Value: primary_mobile,   Label: 'Mobile',  ![@UI.Importance]: #Medium },
            { Value: primary_hours,    Label: 'Hours',   ![@UI.Importance]: #High },
            { Value: primary_email,    Label: 'Email',   ![@UI.Importance]: #Medium },
            { Value: other_count,      Label: '+ more',  ![@UI.Importance]: #High },
            { Value: primary_position, Label: 'Position', ![@UI.Importance]: #Low }
        ]
    }
);

annotate PlanningService.FlightContacts with {
    party            @title: 'Party';
    role_status      @title: 'Status'
                     @Common.QuickInfo: 'PRESENT - a contact answers first for this role. NONE_RECORDED - the company has one and nobody collected it: A GAP. NOT_APPLICABLE - the company does not hold this role at all: A FACT. An agent that does not invoice has no invoicing contact BY DESIGN, and the same blank would otherwise read as a gap.';
    role_note        @title: 'Why';
    partyRank        @title: 'Party Order';
    axis             @title: 'Applies By';
    supplier_name    @title: 'Company';
    role_name        @title: 'Role';
    sort_order       @title: 'Order';
    primary_name     @title: 'Contact'
                     @Common.QuickInfo: 'The contact who answers first for this role. Blank means NONE RECORDED for this company — the row is here so the gap is visible, because a missing row is invisible.';
    primary_position @title: 'Position';
    primary_phone    @title: 'Phone';
    primary_mobile   @title: 'Mobile';
    primary_email    @title: 'Email';
    primary_hours    @title: 'Hours';
    contact_count    @title: 'Contacts';
    other_count      @title: '+ More'
                     @Common.QuickInfo: 'Contacts BEYOND the one shown. 0 means this is the only one — or that there are none at all, which the blank Contact tells you instead. The strip shows the primary so it stays scannable at 05:00; the others are on the supplier.';
}

annotate PlanningService.SupplierRoleContacts with {
    role_code        @title: 'Role Code';
    role_name        @title: 'Role';
    sort_order       @title: 'Order';
    supplier_name    @title: 'Supplier';
    supplier_code    @title: 'Supplier Code';
    primary_name     @title: 'Contact'
                     @Common.QuickInfo: 'The contact who answers first for this role. Blank means NONE RECORDED for this supplier — the row is here so the gap is visible, because a missing row is invisible.';
    primary_position @title: 'Position';
    primary_phone    @title: 'Phone';
    primary_mobile   @title: 'Mobile';
    primary_email    @title: 'Email';
    primary_hours    @title: 'Hours';
    primary_timezone @title: 'Timezone';
    contact_count    @title: 'Contacts';
    other_count      @title: '+ More'
                     @Common.QuickInfo: 'Contacts BEYOND the one shown. 0 means this is the only one — or that there are none at all, which the blank Contact tells you instead. The strip shows the primary so it stays scannable at 05:00; the others are on the supplier.';
}

annotate PlanningService.SupplierContacts with {
    contact_name @title: 'Name';
    position     @title: 'Position';
    role_code    @title: 'Role';
    phone        @title: 'Phone';
    mobile       @title: 'Mobile';
    email        @title: 'Email';
    hours        @title: 'Hours';
    timezone     @title: 'Timezone';
    is_primary   @title: 'Answers First';
    valid_from   @title: 'Valid From';
    valid_to     @title: 'Valid To';
}
annotate PlanningService.ContactRoles with {
    role_code   @title: 'Role Code';
    role_name   @title: 'Role';
    description @title: 'Description';
    sort_order  @title: 'Order';
}

// ===========================================================================
// AND THE E2b AIRCRAFT CARD SAYS WHAT THE FLIGHT SCHEDULE ALREADY SAYS
//
// The A block above states that MLW, MZFW and engine_burn_rate_kgph ARE NOT
// IN THE MODEL. The overview card about the SAME TAIL said nothing - seven
// columns and no indication that three expected fields do not exist. The
// same subject on two screens, one honest and one silent, and the reasoning
// sat in a code comment where no reader meets it.
//
// Folded in here rather than waiting for work package B, which is when this
// card GAINS three columns rather than a note.
// ===========================================================================
annotate PlanningService.FlightAircraft with {
    mtow_kg @Common.QuickInfo: 'Maximum take-off weight, from the aircraft TYPE rather than this registration — the same figure for every tail of the type. MLW, MZFW and engine burn rate are NOT IN THE MODEL AT ALL, on the tail or the type, and arrive with work package B. They are missing rather than blank: a field that is not there is a question.';
}

// ===========================================================================
// THE FOUR DRILL-DOWNS — ORDER, TICKET, DISPATCH, DELIVERY
//
// NO SCHEMA CHANGE AND NO PROJECTION WIDENING. The survey found the cause is
// not a thin projection:
//
//   FuelOrders             17 props, UI.Facets present but ONE facet
//   FlightDispatches       15 props, HeaderInfo and ZERO facets
//   FLIGHT_FUEL_TICKETS    19 props, HeaderInfo and ZERO facets
//   FLIGHT_FUEL_DELIVERIES 19 props, HeaderInfo and ZERO facets
//
// A HEADER WITH NO FACETS IS EXACTLY THE SYMPTOM REPORTED: the ticket page
// showed "WFS-YYZ-20260410-31 · World Fuel Services Canada" and nothing else,
// because HeaderInfo rendered and there was NOWHERE TO PUT THE BODY. Not a
// thin facet - no facet. FuelOrders was the inverse: one facet of flight
// fields and no HeaderInfo, which is why it showed flight number, date and
// airline code and nothing about the order.
//
// EVERY FIELD BELOW WAS MEASURED PRESENT IN THE EMITTED EDMX FIRST. A
// FieldGroup naming a field the projection lacks FAILS THE WHOLE READ rather
// than the column, and four new blocks against restricted projections is four
// chances at it. The order was: read the projection, then write the block -
// never the reverse, because the failure is silent one way and loud the other.
//
// WHAT THESE PAGES DO NOT CARRY, and it is a decision not an oversight:
// meter start and end, temperature, the verification block, the S/4
// references and the signature group live on FuelOrderService, which owns
// these entities and exposes 50-odd fields each. A reader arriving FROM A
// FLIGHT gets what the flight makes them ask about. Widening these
// projections to match the owner is a separate decision, sized in the survey.
// ===========================================================================

// ---- ORDER ---------------------------------------------------------------
annotate PlanningService.FuelOrders with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Fuel Order',
            TypeNamePlural : 'Fuel Orders',
            Title          : { Value: order_number },
            Description    : { Value: status }
        },
        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'OrderWhat',
              Target: '@UI.FieldGroup#OrderWhat',   Label: 'The order' },
            { $Type: 'UI.ReferenceFacet', ID: 'OrderQty',
              Target: '@UI.FieldGroup#OrderQty',    Label: 'Quantity and value' },
            { $Type: 'UI.ReferenceFacet', ID: 'OrderFlight',
              Target: '@UI.FieldGroup#OrderFlight', Label: 'The flight it is for' }
        ],
        FieldGroup#OrderWhat: {
            Data: [
                { Value: order_number,   Label: 'Order number' },
                { Value: status,         Label: 'Status' },
                { Value: station_code,   Label: 'Station' },
                { Value: requested_date, Label: 'Requested for' },
                { Value: priority,       Label: 'Priority' },
                { Value: notes,          Label: 'Notes' }
            ]
        },
        // The unit lives in the LABEL here rather than in @Measures.Unit,
        // because PlanningService.FuelOrders does not carry uom_code - it is
        // on the owning service and was not brought through when this
        // projection was widened for the overview card's filter. Recorded
        // rather than worked around: a label is honest, and inventing a
        // constant unit column would be a second place holding one fact.
        FieldGroup#OrderQty: {
            Data: [
                { Value: ordered_quantity, Label: 'Ordered quantity' },
                { Value: unit_price,       Label: 'Unit price' },
                { Value: total_amount,     Label: 'Total amount' },
                { Value: currency_code,    Label: 'Currency' }
            ]
        },
        FieldGroup#OrderFlight: {
            Data: [
                { Value: flight_number,       Label: 'Flight' },
                { Value: flight_date,         Label: 'Flight date' },
                { Value: origin_airport,      Label: 'From' },
                { Value: destination_airport, Label: 'To' },
                { Value: airline_code,        Label: 'Carrier' }
            ]
        }
    }
);

// ---- TICKET --------------------------------------------------------------
// THE QUANTITIES ARE THE POINT. The reported symptom was a header and "no
// quantities at all", and the metered figure with its unit beside the derived
// mass is the conversion this whole module demonstrates.
annotate PlanningService.FLIGHT_FUEL_TICKETS with @(
    UI: {
        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'TicketWhat',
              Target: '@UI.FieldGroup#TicketWhat',   Label: 'The ticket' },
            { $Type: 'UI.ReferenceFacet', ID: 'TicketQty',
              Target: '@UI.FieldGroup#TicketQty',    Label: 'What was uplifted' },
            { $Type: 'UI.ReferenceFacet', ID: 'TicketWhere',
              Target: '@UI.FieldGroup#TicketWhere',  Label: 'Aircraft and flight' }
        ],
        FieldGroup#TicketWhat: {
            Data: [
                { Value: ticket_number,      Label: 'Ticket number' },
                { Value: supplier_name,      Label: 'Supplier' },
                { Value: delivery_timestamp, Label: 'Delivered at' },
                { Value: match_status,       Label: 'Order match' },
                { Value: order.order_number, Label: 'Order' }
            ]
        },
        // METERED, ITS UNIT, THEN THE MASS. In that order deliberately: the
        // supplier metered a volume, the density converted it, and the mass
        // is what everything downstream compares against. uom_code is the
        // unit of quantity_metered ONLY - quantity_kg is kilograms by
        // definition, and pointing uom_code at it would render a mass as
        // litres on the 14 of 30 tickets metered in LTR.
        FieldGroup#TicketQty: {
            Data: [
                { Value: quantity_metered, Label: 'Metered quantity' },
                { Value: uom_code,         Label: 'Metered in' },
                { Value: density_value,    Label: 'Density' },
                { Value: quantity_kg,      Label: 'Mass (kg)' }
            ]
        },
        FieldGroup#TicketWhere: {
            Data: [
                { Value: aircraft_reg,      Label: 'Tail' },
                { Value: tail_registration, Label: 'Registration' },
                { Value: flight_number,     Label: 'Flight' },
                { Value: flight_date,       Label: 'Flight date' },
                { Value: origin_airport,    Label: 'Station' }
            ]
        }
    }
);

// ---- DISPATCH ------------------------------------------------------------
annotate PlanningService.FlightDispatches with @(
    UI: {
        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'DispatchPlan',
              Target: '@UI.FieldGroup#DispatchPlan', Label: 'The plan' },
            { $Type: 'UI.ReferenceFacet', ID: 'DispatchQty',
              Target: '@UI.FieldGroup#DispatchQty',  Label: 'The stack' },
            { $Type: 'UI.ReferenceFacet', ID: 'DispatchWhere',
              Target: '@UI.FieldGroup#DispatchWhere', Label: 'Aircraft and flight' }
        ],
        FieldGroup#DispatchPlan: {
            Data: [
                { Value: plan_version,       Label: 'Plan version' },
                { Value: plan_status,        Label: 'Plan status' },
                { Value: plan_group_id,      Label: 'Plan family' },
                { Value: dispatch_source,    Label: 'Source' },
                { Value: dispatch_timestamp, Label: 'Dispatched at' }
            ]
        },
        // FOUR TERMS, NOT SIX. FLIGHT_DISPATCH holds a single dispatch_qty_kg
        // with no trip/taxi/contingency/alternate/reserve/extra breakdown -
        // the six-term stack is DESIGNED and not built. Showing four real
        // figures is honest; five blank columns beside them would be the
        // eighth cause of an empty section.
        FieldGroup#DispatchQty: {
            Data: [
                { Value: dispatch_qty_kg,    Label: 'Dispatch quantity (kg)' },
                { Value: block_fuel_kg,      Label: 'Block fuel (kg)' },
                { Value: required_uplift_kg, Label: 'Required uplift (kg)' },
                { Value: rob_departure_kg,   Label: 'ROB at departure (kg)' }
            ]
        },
        FieldGroup#DispatchWhere: {
            Data: [
                { Value: tail_number,       Label: 'Tail' },
                { Value: alternate_airport, Label: 'Alternate' },
                { Value: flight_number,     Label: 'Flight' },
                { Value: flight_date,       Label: 'Flight date' }
            ]
        }
    }
);

// ---- DELIVERY ------------------------------------------------------------
annotate PlanningService.FLIGHT_FUEL_DELIVERIES with @(
    UI: {
        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'DeliveryWhat',
              Target: '@UI.FieldGroup#DeliveryWhat',  Label: 'The delivery' },
            { $Type: 'UI.ReferenceFacet', ID: 'DeliveryRecon',
              Target: '@UI.FieldGroup#DeliveryRecon', Label: 'Gauge and reconciliation' },
            { $Type: 'UI.ReferenceFacet', ID: 'DeliveryWhere',
              Target: '@UI.FieldGroup#DeliveryWhere', Label: 'Aircraft and flight' }
        ],
        FieldGroup#DeliveryWhat: {
            Data: [
                { Value: delivery_number,    Label: 'Delivery number' },
                { Value: delivery_date,      Label: 'Delivery date' },
                { Value: delivered_quantity, Label: 'Delivered quantity' },
                { Value: uom_code,           Label: 'Delivered in' },
                { Value: supplier_count,     Label: 'Suppliers' },
                { Value: order.order_number, Label: 'Order' }
            ]
        },
        // THE VERDICT, AND WHERE IT CAME FROM. fob_source says whether the
        // gauge figure was read or derived, and recon_status is meaningless
        // without it - WP-34 built that distinction and this is the first
        // page a planner can see it on.
        FieldGroup#DeliveryRecon: {
            Data: [
                { Value: fob_delta_kg,      Label: 'Gauge delta (kg)' },
                { Value: fob_source,        Label: 'Gauge source' },
                { Value: recon_variance_kg, Label: 'Reconciliation variance (kg)' },
                { Value: recon_status,      Label: 'Reconciliation status' }
            ]
        },
        FieldGroup#DeliveryWhere: {
            Data: [
                { Value: aircraft_reg,      Label: 'Tail' },
                { Value: tail_registration, Label: 'Registration' },
                { Value: flight_number,     Label: 'Flight' },
                { Value: flight_date,       Label: 'Flight date' },
                { Value: origin_airport,    Label: 'Station' }
            ]
        }
    }
);

// UNITS — AND THE RULE THAT DECIDES WHICH TREATMENT EACH FIELD GETS
//
// A UNIT COLUMN BELONGS TO ONE FIELD. @Measures.Unit points at the column
// holding the unit OF THAT VALUE, never at the nearest unit column on the
// row. Getting that wrong is worse than no units at all, because a unit
// annotation correct on half the data looks identical to one correct on all
// of it — and the whole reason for adding units is that a bare 2,884 and a
// bare 2,305.76 cannot be told apart.
//
//   quantity_metered   -> @Measures.Unit: uom_code    uom_code IS its unit
//   quantity_kg        -> LABEL "(kg)"                the NAME is the unit
//   ordered_quantity   -> @Measures.Unit: uom_code    and it is LTR on AC410
//   block_fuel_kg      -> LABEL                       no column exists
//
// MEASURED, NOT ASSUMED, on every pairing below:
//   FLIGHT_FUEL_TICKETS     uom_code = LTR on 14 of 30, KG on 16
//   FLIGHT_FUEL_DELIVERIES  uom_code = LTR on 10 of 26, KG on 16
//   FuelOrders              uom_code = LTR on  3 of 25 — ALL THREE AC410's
//
// So pointing uom_code at a _kg field would render a mass as litres on
// roughly half the rows, and a "(kg)" label on ordered_quantity would be
// wrong on exactly the order the demo opens. Both directions are live here.
// ===========================================================================

annotate PlanningService.FLIGHT_FUEL_TICKETS with {
    // uom_code is the unit of the METERED figure ONLY.
    quantity_metered @Measures.Unit: uom_code  @title: 'Metered Quantity';
    // NOT @Measures.Unit. Kilograms is in the name, and taking the metered
    // unit here renders 2,305.76 kg as "2,305.76 LTR" on every litre ticket.
    quantity_kg      @title: 'Mass (kg)';
    density_value    @title: 'Density (kg/L)';
    uom_code         @title: 'Metered In';
}

annotate PlanningService.FLIGHT_FUEL_DELIVERIES with {
    delivered_quantity @Measures.Unit: uom_code  @title: 'Delivered Quantity';
    uom_code           @title: 'Delivered In';
    fob_delta_kg       @title: 'Gauge Delta (kg)';
    recon_variance_kg  @title: 'Reconciliation Variance (kg)';
}

annotate PlanningService.FuelOrders with {
    // THE COLUMN, NOT A LABEL. 3 of 25 orders are in LTR and all three are
    // AC410's — FO-YYZ-20260410-001 is 2881.25 LTR on the demo flight.
    ordered_quantity @Measures.Unit: uom_code           @title: 'Ordered Quantity';
    uom_code         @title: 'Ordered In';
    unit_price       @Measures.ISOCurrency: currency_code @title: 'Unit Price';
    total_amount     @Measures.ISOCurrency: currency_code @title: 'Total Amount';
}

annotate PlanningService.FlightDispatches with {
    // NO UNIT COLUMN EXISTS ON THIS ENTITY and none should be added: a
    // constant 'KG' column on every row is a second place holding one fact.
    // The name carries it and the label says it.
    dispatch_qty_kg    @title: 'Dispatch Quantity (kg)';
    block_fuel_kg      @title: 'Block Fuel (kg)';
    required_uplift_kg @title: 'Required Uplift (kg)';
    rob_departure_kg   @title: 'ROB at Departure (kg)';
}

annotate PlanningService.FuelBurns with {
    planned_burn_kg @title: 'Planned Burn (kg)';
    actual_burn_kg  @title: 'Actual Burn (kg)';
    variance_kg     @title: 'Variance (kg)';
    engine_burn_kg  @title: 'Engine Burn (kg)';
    apu_burn_kg     @title: 'APU Burn (kg)';
}

annotate PlanningService.FuelDeliveries with {
    fob_before_kg @title: 'FOB Before (kg)';
    fob_after_kg  @title: 'FOB After (kg)';
}

annotate PlanningService.FlightAircraft with {
    mtow_kg             @title: 'MTOW (kg)';
    dow_kg              @title: 'Dry Operating Weight (kg)';
    fuel_capacity_kg    @title: 'Fuel Capacity (kg)';
    apu_burn_rate_kg_hr @title: 'APU Burn Rate (kg/h)';
    cruise_burn_kgph    @title: 'Cruise Burn (kg/h)';
}

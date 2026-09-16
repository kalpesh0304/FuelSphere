/**
 * FuelSphere - Delivery Service Fiori Annotations
 *
 * UI for the standalone Fuel Delivery create/edit app (DeliveryService,
 * /odata/v4/deliveries). Unlike TicketService.FuelTickets, order here is
 * OPTIONAL (decision B2 in db/schema.cds) - the user picks Aircraft/Tail
 * first, and Fuel Order is an optional F4 alongside it. Picking one
 * auto-fills flight/UOM via the before-PATCH hook in delivery-service.js.
 * delivery_number is generated the same way, on Create; it is never
 * user-entered.
 *
 * Facet/FieldGroup structure mirrors FuelOrderService.FuelDeliveries
 * (order-fiori-annotations.cds) field-for-field, so the embedded (inside a
 * Fuel Order) and standalone create screens are identical.
 */

using DeliveryService from './delivery-service';

// ============================================================================
// FuelOrders - reference data exposed only so the order F4 has something
// useful to show. Read-only; the real FuelOrders UI lives in
// FuelOrderService / the fuelorders app.
// ============================================================================
annotate DeliveryService.FuelOrders with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Fuel Order',
            TypeNamePlural : 'Fuel Orders',
            Title          : { Value: order_number },
            Description    : { Value: station_code }
        },
        SelectionFields: [ order_number, station_code, status ],
        LineItem: [
            { Value: order_number,  Label: 'Order Number' },
            { Value: station_code,  Label: 'Station' },
            { Value: flight_number, Label: 'Flight' },
            { Value: status,        Label: 'Status' }
        ]
    }
);

annotate DeliveryService.FuelOrders with {
    // Hidden so the F4 popup shows only the readable columns.
    ID            @UI.Hidden;
    order_number  @title: 'Order Number';
    station_code  @title: 'Station';
    flight_number @title: 'Flight';
    status        @title: 'Status';
};

// ============================================================================
// AircraftRegistrations - value-help target for aircraft_reg.
// ============================================================================
annotate DeliveryService.AircraftRegistrations with @(
    UI.LineItem: [
        { Value: registration,        Label: 'Registration' },
        { Value: aircraft_type_code,  Label: 'Type' }
    ]
);

annotate DeliveryService.AircraftRegistrations with {
    registration       @title: 'Registration';
    aircraft_type_code @title: 'Type';
};

// ============================================================================
// UnitsOfMeasure - value-help target for uom_code.
// ============================================================================
annotate DeliveryService.UnitsOfMeasure with @(
    UI.LineItem: [
        { Value: uom_code, Label: 'UoM' },
        { Value: uom_name, Label: 'Description' }
    ]
);

annotate DeliveryService.UnitsOfMeasure with {
    uom_code @title: 'UoM';
    uom_name @title: 'Description';
};

// ============================================================================
// FuelDeliveries - the create/edit screen itself.
// ============================================================================

// Tells the UI to re-fetch flight_number/aircraft_reg/uom_code once
// delivery-service.js's populateFromOrder writes them to the draft after an
// order is picked - entity-level with SourceProperties, not nested inside
// order's own Common block below (that silently drops it).
annotate DeliveryService.FuelDeliveries with @(
    // EVERY TargetProperties ENTRY IS A QUOTED STRING, and that is the whole
    // annotation working or silently doing nothing. TargetProperties is
    // Collection(Edm.String) in the vocabulary: a quoted entry compiles to
    // <String> and Fiori Elements re-reads it, an unquoted one compiles to
    // <Path> and is ignored. This block previously mixed the two, which is
    // why the flight and aircraft stayed blank after picking an order while
    // the values were being written to the draft correctly all along. The
    // one pre-existing SideEffects in this codebase that demonstrably worked
    // (FuelOrders #updTotAmt) quotes its entry; this now matches it.
    Common.SideEffects #OrderPicked: {
        SourceProperties : [order_ID],
        TargetProperties : ['flight_ID', 'flight/flight_number', 'flight/flight_date',
                            'flight_number', 'aircraft_reg', 'uom_code']
    },
    // The other way in: a flight picked directly names the aircraft, with
    // no order involved (populateFromOrderOrFlight in delivery-service.js).
    Common.SideEffects #FlightPicked: {
        SourceProperties : [flight_ID],
        TargetProperties : ['flight/flight_number', 'flight/flight_date',
                            'flight_number', 'aircraft_reg']
    }
);

annotate DeliveryService.FuelDeliveries with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Fuel Delivery',
            TypeNamePlural : 'Fuel Deliveries',
            Title          : { Value: delivery_number },
            Description    : { Value: status }
        },

        SelectionFields: [
            aircraft_reg,
            order_ID,
            status,
            recon_status,
            delivery_date
        ],

        LineItem: [
            { Value: delivery_number,    Label: 'Delivery Number', ![@UI.Importance]: #High },
            { Value: aircraft_reg,       Label: 'Aircraft Reg',    ![@UI.Importance]: #High },
            { Value: flight_number,      Label: 'Flight',          ![@UI.Importance]: #Medium },
            { Value: delivery_date,      Label: 'Date',            ![@UI.Importance]: #High },
            { Value: delivered_quantity, Label: 'Delivered',       ![@UI.Importance]: #High },
            { Value: uom_code,           Label: 'UoM',             ![@UI.Importance]: #Medium },
            {
                Value: status,
                Label: 'Status',
                Criticality: { $edmJson: { $If: [
                    { $Eq: [{ $Path: 'status' }, 'Disputed'] }, 1,
                    { $If: [ { $In: [{ $Path: 'status' }, ['Verified', 'Posted']] }, 3, 2 ] } ] } },
                ![@UI.Importance]: #High
            },
            { Value: recon_status,       Label: 'Reconciliation',  ![@UI.Importance]: #Medium }
        ],

        // Four facets, matching FuelOrderService.FuelDeliveries exactly.
        // Header, Variance, Signatures, S/4HANA References and the aircraft
        // register drill-down were all dropped from both screens together.
        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'AircraftOrder',       Target: '@UI.FieldGroup#AircraftOrder',       Label: 'Aircraft & Fuel Order' },
            { $Type: 'UI.ReferenceFacet', ID: 'DeliveryDetails',     Target: '@UI.FieldGroup#DeliveryDetails',     Label: 'Delivery Details' },
            { $Type: 'UI.ReferenceFacet', ID: 'QualityMeasurements', Target: '@UI.FieldGroup#QualityMeasurements', Label: 'Quality Measurements' },
            { $Type: 'UI.ReferenceFacet', ID: 'AircraftGauge',       Target: '@UI.FieldGroup#AircraftGauge',       Label: 'Aircraft Gauge (FQIS)' },
            { $Type: 'UI.ReferenceFacet', ID: 'Reconciliation',      Target: '@UI.FieldGroup#Reconciliation',      Label: 'FOB Reconciliation' }
        ],

        // PICK AN ORDER OR A FLIGHT; THE FLIGHT DATE AND THE AIRCRAFT FOLLOW.
        // The two pickers sit above the two fields they derive.
        //
        // flight_date and aircraft_reg are read THROUGH THE ASSOCIATION
        // (flight.flight_date), not as columns of their own, and that is what
        // makes them fill in on the CREATE screen at all: a create screen is
        // a draft row, and a calculated column on a draft reads null, while a
        // path through an association is fetched with $expand and resolves.
        // The earlier `flight_number` column was calculated, which is exactly
        // why the flight showed blank while an order was selected.
        FieldGroup #AircraftOrder: {
            Data: [
                { Value: order_ID },
                { Value: flight_ID },
                { Value: flight.flight_date, Label: 'Flight Date' },
                { Value: aircraft_reg, ![@UI.Importance]: #High }
            ]
        },

        // Same field set as FuelOrderService.FuelDeliveries' #DeliveryDetails
        // (order-fiori-annotations.cds) - identical create screen either way.
        FieldGroup #DeliveryDetails: {
            Data: [
                { Value: delivery_number },
                { Value: delivery_date },
                { Value: delivery_time },
                { Value: delivered_quantity },
                { Value: uom_code },
                { Value: delivery_method },
                { Value: vehicle_id },
                { Value: driver_name },
                { Value: status }
            ]
        },

        FieldGroup #QualityMeasurements: {
            Data: [
                { Value: temperature },
                { Value: density },
                { Value: temperature_corrected_qty }
            ]
        },

        FieldGroup #AircraftGauge: {
            Data: [
                { Value: fob_source },
                { Value: fob_at_arrival_kg },
                { Value: fob_before_kg },
                { Value: ground_burn_kg },
                { Value: fob_after_kg },
                { Value: fob_delta_kg },
                { Value: fob_rounding_kg }
            ]
        },

        FieldGroup #Reconciliation: {
            Data: [
                { Value: recon_status },
                { Value: recon_variance_kg },
                { Value: fob_source },
                { Value: fob_delta_kg },
                { Value: supplier_count }
            ]
        }
    }
);

annotate DeliveryService.FuelDeliveries with {
    // THE ID FIELD — server-generated on Create, never user-entered. Matches
    // TicketService.FuelTickets.internal_number's treatment exactly.
    delivery_number      @title: 'Fuel Delivery ID' @Core.Computed;

    // Same titles/units as FuelOrderService.FuelDeliveries (order-fiori-
    // annotations.cds) throughout this block - identical field-for-field.
    flight_number         @title: 'Flight' @Common.FieldControl: #ReadOnly;
    delivery_date         @title: 'Delivery Date' @mandatory;
    delivery_time         @title: 'Delivery Time' @mandatory;
    delivered_quantity    @title: 'Delivered Quantity' @mandatory @Measures.Unit: uom_code;
    uom_code              @title: 'Unit of Measure'
                           @Common.ValueList: {
                               CollectionPath: 'UnitsOfMeasure',
                               Parameters: [
                                   { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: uom_code, ValueListProperty: 'uom_code' }
                               ]
                           };
    delivery_method        @title: 'Delivery Method';
    vehicle_id             @title: 'Vehicle ID';
    driver_name            @title: 'Driver Name';
    temperature            @title: 'Temperature (C)';
    density                @title: 'Density (kg/L)';
    temperature_corrected_qty @title: 'Corrected Qty (kg)';
    fob_source              @title: 'FQIS Reading Source';
    fob_at_arrival_kg       @title: 'FOB at Arrival (kg)';
    fob_before_kg           @title: 'FOB Before Uplift (kg)';
    fob_after_kg            @title: 'FOB After Uplift (kg)';
    fob_delta_kg            @title: 'FQIS Uplift (kg)' @Common.FieldControl: #ReadOnly;
    ground_burn_kg          @title: 'Ground Burn (kg)' @Common.FieldControl: #ReadOnly;
    fob_rounding_kg         @title: 'Reading Rounding (kg)';
    recon_status            @title: 'Reconciliation Status' @Common.FieldControl: #ReadOnly;
    recon_variance_kg       @title: 'Reconciliation Variance (kg)' @Common.FieldControl: #ReadOnly;
    supplier_count          @title: 'Suppliers on this Refuelling' @Common.FieldControl: #ReadOnly;
    quantity_variance       @title: 'Variance (kg)' @Common.FieldControl: #ReadOnly;
    variance_percentage     @title: 'Variance (%)' @Common.FieldControl: #ReadOnly;
    variance_flag           @title: 'Variance Flag' @Common.FieldControl: #ReadOnly;
    variance_reason         @title: 'Variance Reason' @UI.MultiLineText;
    pilot_name              @title: 'Pilot Name';
    ground_crew_name        @title: 'Ground Crew Name';
    s4_gr_number            @title: 'GR Number' @Common.FieldControl: #ReadOnly;
    s4_gr_year              @title: 'GR Year' @Common.FieldControl: #ReadOnly;
    s4_gr_item              @title: 'GR Item' @Common.FieldControl: #ReadOnly;
    status                  @title: 'Status' @Common.FieldControl: #ReadOnly;

    // DISPLAY-ONLY, AND NOT AN INPUT. aircraft_reg is REQ-FL-010's join key
    // (tail + date + departure time); a registration typed by hand that
    // disagrees with the order or flight it sits beside is a join key
    // pointing at nothing. It is derived from whichever of the two was
    // picked (populateFromOrderOrFlight) and shown, never typed.
    //
    // Safe to mark read-only here where the same marking on `order` is not:
    // this value is written by a before-handler, which runs after CAP has
    // stripped read-only fields from the inbound payload, whereas order_ID
    // on the embedded screens is written by the framework itself from the
    // nav path and gets stripped with it.
    aircraft_reg @title: 'Aircraft Registration' @Common.FieldControl: #ReadOnly;

    // THE TWO PICKERS. Either one identifies the aircraft; neither is
    // required (B2), and picking an order fills the flight in as well.
    // Text + TextOnly so each shows its readable value, not a GUID.
    order @(
        Common: {
            Label: 'Fuel Order',
            Text: order.order_number,
            TextArrangement: #TextOnly,
            ValueList: {
                Label: 'Fuel Order',
                CollectionPath: 'FuelOrders',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: order_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'order_number' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'station_code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'flight_number' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'status' }
                ]
            }
        }
    );

    flight @(
        Common: {
            Label: 'Flight',
            Text: flight.flight_number,
            TextArrangement: #TextOnly,
            ValueList: {
                Label: 'Flight',
                CollectionPath: 'FlightSchedule',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: flight_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'flight_number' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'flight_date' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'origin_airport' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'destination_airport' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'aircraft_reg' }
                ]
            }
        }
    );
};

// ============================================================================
// FlightSchedule - value-help target for the flight F4.
// ============================================================================
annotate DeliveryService.FlightSchedule with @(
    UI.LineItem: [
        { Value: flight_number,       Label: 'Flight' },
        { Value: flight_date,         Label: 'Date' },
        { Value: origin_airport,      Label: 'From' },
        { Value: destination_airport, Label: 'To' },
        { Value: aircraft_reg,        Label: 'Aircraft Reg' }
    ]
);

annotate DeliveryService.FlightSchedule with {
    ID                   @UI.Hidden;
    flight_number        @title: 'Flight';
    flight_date          @title: 'Date';
    origin_airport       @title: 'From';
    destination_airport  @title: 'To';
    aircraft_reg         @title: 'Aircraft Reg';
};

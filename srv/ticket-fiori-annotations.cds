/**
 * FuelSphere - Ticket Service Fiori Annotations
 *
 * UI for the standalone Fuel Ticket create/edit app (TicketService,
 * /odata/v4/tickets). Neither a Fuel Order nor a Flight is required - decision
 * A1, an order-less ticket is legitimate - but picking either is offered.
 * Picking an order auto-fills the flight fields from it; picking a flight
 * directly auto-fills aircraft_reg instead (both via before-PATCH hooks in
 * ticket-service.js). internal_number is generated from whichever flight is
 * resolved either way, on Create; it is never user-entered.
 */

using TicketService from './ticket-service';

// ============================================================================
// FuelOrders - reference data exposed only so the order F4 has something
// useful to show (order number, station, flight, status). Read-only; the
// real FuelOrders UI lives in FuelOrderService / the fuelorders app.
// ============================================================================
annotate TicketService.FuelOrders with @(
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

annotate TicketService.FuelOrders with {
    // Hidden so the F4 popup shows only the readable columns - it would
    // otherwise add the raw GUID as a column via the ValueList's InOut
    // parameter below.
    ID            @UI.Hidden;
    order_number  @title: 'Order Number';
    station_code  @title: 'Station';
    flight_number @title: 'Flight';
    status        @title: 'Status';
};

// ============================================================================
// FlightSchedule - value-help target for flight_number, the alternative to
// picking an order.
// ============================================================================
annotate TicketService.FlightSchedule with @(
    UI.LineItem: [
        { Value: flight_number,       Label: 'Flight' },
        { Value: flight_date,         Label: 'Flight Date' },
        { Value: origin_airport,      Label: 'From' },
        { Value: destination_airport, Label: 'To' },
        { Value: aircraft_reg,        Label: 'Aircraft Reg' }
    ]
);

annotate TicketService.FlightSchedule with {
    ID                  @UI.Hidden;
    flight_number       @title: 'Flight';
    flight_date         @title: 'Flight Date';
    origin_airport       @title: 'From';
    destination_airport  @title: 'To';
    aircraft_reg         @title: 'Aircraft Reg';
};

// ============================================================================
// UnitsOfMeasure - value-help target for uom_code.
// ============================================================================
annotate TicketService.UnitsOfMeasure with @(
    UI.LineItem: [
        { Value: uom_code, Label: 'UoM' },
        { Value: uom_name, Label: 'Description' }
    ]
);

annotate TicketService.UnitsOfMeasure with {
    uom_code @title: 'UoM';
    uom_name @title: 'Description';
};

// ============================================================================
// FuelTickets - the create/edit screen itself.
// ============================================================================

// Without this, the server-derived flight_number/aircraft_reg/uom_code/
// supplier_ticket_ref (populateFromOrder in ticket-service.js) are correctly
// written to the draft, but the UI never re-fetches them after the PATCH
// that set order_ID - the exact symptom observed: fields staying blank
// after picking an order. This is what tells Fiori Elements to refresh
// them. Entity-level with a qualifier and SourceProperties - NOT nested
// inside order's own Common block above, which silently drops it (no
// SourceProperties there for SideEffects to key off).
annotate TicketService.FuelTickets with @(
    // Every entry quoted - see the note on DeliveryService.FuelDeliveries'
    // copy: an unquoted entry compiles to <Path> and is silently ignored,
    // which is why these fields stayed blank after picking an order.
    Common.SideEffects #OrderPicked: {
        SourceProperties : [order_ID],
        TargetProperties : ['flight_ID', 'flight/flight_number', 'flight/flight_date',
                            'flight_number', 'aircraft_reg', 'uom_code', 'supplier_ticket_ref']
    },
    // The alternative path: picking a flight directly, with no order,
    // auto-fills aircraft_reg (populateFromFlight in ticket-service.js).
    Common.SideEffects #FlightPicked: {
        SourceProperties : [flight_ID],
        TargetProperties : ['flight/flight_number', 'flight/flight_date',
                            'flight_number', 'aircraft_reg']
    },
    // The amount re-derives from the rate AND from either meter reading,
    // because the metered quantity is what it multiplies (see
    // srv/lib/ticket-measurement.js). Typing a meter reading and watching
    // the amount stay put would read as a stale price.
    Common.SideEffects #AmountInputs: {
        SourceProperties : [rate_per_litre, meter_start, meter_end, quantity],
        TargetProperties : ['quantity_metered', 'quantity_kg', 'total_amount']
    },
    // Switching the unit switches whether density is required, so the
    // control has to be re-read or the asterisk appears only after a reload.
    // The density inputs come with it because the mass depends on them.
    Common.SideEffects #UomChanged: {
        SourceProperties : [uom_code],
        TargetProperties : ['densityFieldControl', 'density_value', 'density_uom', 'quantity_kg']
    }
);

annotate TicketService.FuelTickets with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Fuel Ticket',
            TypeNamePlural : 'Fuel Tickets',
            Title          : { Value: ticket_number },
            Description    : { Value: status }
        },

        // WP-UI-01: a list with no filter bar makes an operator scroll.
        SelectionFields: [
            order_ID,
            flight_number,
            status,
            match_status,
            delivery_timestamp
        ],

        LineItem: [
            { Value: ticket_number,      Label: 'Ticket Number',  ![@UI.Importance]: #High },
            { Value: order.order_number, Label: 'Order',          ![@UI.Importance]: #High },
            { Value: flight_number,      Label: 'Flight',         ![@UI.Importance]: #High },
            { Value: aircraft_reg,       Label: 'Aircraft Reg',   ![@UI.Importance]: #Medium },
            { Value: quantity,           Label: 'Quantity',       ![@UI.Importance]: #High },
            { Value: uom_code,           Label: 'UoM',            ![@UI.Importance]: #Medium },
            {
                Value: status,
                Label: 'Status',
                Criticality: { $edmJson: { $If: [
                    { $Eq: [{ $Path: 'status' }, 'Rejected'] }, 1,
                    { $If: [ { $In: [{ $Path: 'status' }, ['Verified', 'Closed', 'Attached']] }, 3, 0 ] } ] } },
                ![@UI.Importance]: #High
            },
            { Value: match_status,       Label: 'Match Status',   ![@UI.Importance]: #Medium }
        ],

        HeaderFacets: [
            { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#TicketStatus', Label: 'Status' }
        ],

        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'OrderFlight',  Target: '@UI.FieldGroup#OrderFlight',  Label: 'Fuel Order & Flight' },
            { $Type: 'UI.ReferenceFacet', ID: 'TicketDetails', Target: '@UI.FieldGroup#TicketDetails', Label: 'Ticket Details' },
            { $Type: 'UI.ReferenceFacet', ID: 'Measurement',   Target: '@UI.FieldGroup#Measurement',   Label: 'Meter & Density' },
            { $Type: 'UI.ReferenceFacet', ID: 'Pricing',       Target: '@UI.FieldGroup#Pricing',       Label: 'Rate & Amount' },
            { $Type: 'UI.ReferenceFacet', ID: 'Verification',  Target: '@UI.FieldGroup#Verification',  Label: 'Verification' }
        ],

        FieldGroup #TicketStatus: {
            Data: [
                { Value: status },
                { Value: match_status }
            ]
        },

        // THE ORDER OR THE FLIGHT, PICKED FIRST — neither is required
        // (decision A1), but picking either is offered. Picking an order
        // auto-fills flight_number/aircraft_reg from it (populateFromOrder);
        // picking a flight directly auto-fills aircraft_reg instead
        // (populateFromFlight). aircraft_reg reads read-only because of it
        // either way.
        FieldGroup #OrderFlight: {
            Data: [
                { Value: order_ID },
                { Value: flight_ID,          ![@UI.Importance]: #High },
                // Read through the association, not as a column: this is a
                // create screen, and an association path resolves on a draft
                // row where a calculated column does not.
                { Value: flight.flight_date, Label: 'Flight Date' },
                { Value: aircraft_reg,       ![@UI.Importance]: #Medium }
            ]
        },

        // Same field set as FuelOrderService.FuelTickets' #TicketDetails
        // (order-fiori-annotations.cds) - identical create screen either way.
        FieldGroup #TicketDetails: {
            Data: [
                { Value: ticket_number },
                { Value: internal_number },
                { Value: quantity },
                { Value: uom_code },
                { Value: delivery_timestamp },
                { Value: supplier_ticket_ref },
                { Value: ticket_source },
                { Value: ticket_capture_source, ![@UI.Importance]: #Medium },
                { Value: status },
                { Value: match_status }
            ]
        },

        // Same field set as FuelOrderService.FuelTickets' #Measurement.
        FieldGroup #Measurement: {
            Data: [
                { Value: meter_start },
                { Value: meter_end },
                { Value: quantity_metered },
                { Value: quantity_flag },
                { Value: density_value },
                { Value: density_uom },
                { Value: density_basis },
                { Value: density_temp_c },
                { Value: quantity_kg },
                { Value: batch_coa_ref },
                { Value: vehicle_id },
                { Value: meter_serial }
            ]
        },

        // The rate is typed; the amount is derived from it and the metered
        // quantity. Same group on both ticket screens.
        FieldGroup #Pricing: {
            Data: [
                { Value: rate_per_litre },
                { Value: total_amount }
            ]
        },

        FieldGroup #Verification: {
            Data: [
                { Value: verified_by },
                { Value: verified_at }
            ]
        }
    }
);

annotate TicketService.FuelTickets with {
    // THE ID FIELD — server-generated on Create, never user-entered.
    // @Core.Computed is the standard OData V4 signal for "this field is
    // system-derived": Fiori elements renders it read-only in both the
    // create screen and afterwards, without needing a separate
    // FieldControl annotation the way the station-keyed order_number/
    // delivery_number fields use elsewhere in this codebase.
    internal_number     @title: 'Fuel Ticket ID' @Core.Computed;

    // Same titles/units as FuelOrderService.FuelTickets (order-fiori-
    // annotations.cds) throughout this block - identical field-for-field.
    ticket_number        @title: 'Ticket Number' @mandatory;
    // Derived now, not picked: the F4 moved onto the `flight` association
    // below so a pick names one flight ROW (and so carries its date), where
    // picking a flight NUMBER named a string that recurs every day it flies.
    flight_number         @title: 'Flight' @Common.FieldControl: #ReadOnly;
    aircraft_reg         @title: 'Aircraft Reg' @Common.FieldControl: #ReadOnly;
    quantity             @title: 'Claimed Quantity' @mandatory @Measures.Unit: uom_code;
    uom_code             @title: 'Unit of Measure'
                          @Common.ValueList: {
                              CollectionPath: 'UnitsOfMeasure',
                              Parameters: [
                                  { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: uom_code, ValueListProperty: 'uom_code' }
                              ]
                          };
    delivery_timestamp   @title: 'Delivery Time' @mandatory;
    meter_start          @title: 'Meter Start' @Measures.Unit: uom_code;
    meter_end            @title: 'Meter End' @Measures.Unit: uom_code;
    quantity_metered     @title: 'Metered Quantity' @Measures.Unit: uom_code @Common.FieldControl: #ReadOnly;
    quantity_flag        @title: 'Quantity Basis';
    rate_per_litre       @title: 'Rate (per litre)';
    // Derived, never typed - @Core.Computed renders it read-only on the
    // create screen and afterwards, the same treatment internal_number gets.
    total_amount         @title: 'Total Amount' @Core.Computed;
    quantity_kg          @title: 'Uplift by Meter (kg)' @Common.FieldControl: #ReadOnly;
    // MANDATORY ON A LITRE TICKET, optional on a mass one - the control is
    // computed per row (applyDensityFieldControl), because without a density
    // a litre figure never becomes the kilograms the ROB ledger, the
    // reconciliation and the invoice match all read.
    density_value        @title: 'Density' @Measures.Unit: density_uom
                         @Common.FieldControl: densityFieldControl;
    density_uom          @title: 'Density Unit'
                         @Common.FieldControl: densityFieldControl;
    density_basis        @title: 'Density Basis';
    density_temp_c       @title: 'Density Temperature (°C)';
    batch_coa_ref         @title: 'Batch Certificate';
    vehicle_id             @title: 'Vehicle';
    meter_serial           @title: 'Meter Serial';
    supplier_ticket_ref  @title: 'Supplier Reference';
    ticket_source          @title: 'Ticket Source';
    ticket_capture_source  @title: 'Capture Source';
    status                @title: 'Status' @Common.FieldControl: #ReadOnly;
    match_status          @title: 'Match Status' @Common.FieldControl: #ReadOnly;
    verified_by           @title: 'Verified By' @Common.FieldControl: #ReadOnly;
    verified_at           @title: 'Verified At' @Common.FieldControl: #ReadOnly;

    // THE F4 ITSELF. Text + TextOnly make the field display just the order
    // number once picked (TextOnly, not TextFirst - TextFirst shows
    // "order_number (GUID)", which is what was actually rendering).
    // ValueList is what puts the search-help icon on the field at all -
    // annotating order_ID alone (as an earlier draft of this file did)
    // gives neither. Label is set here too - dropped when this block was
    // first written, which is why the field rendered with no label at all.
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

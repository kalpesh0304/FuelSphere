/**
 * FuelSphere - Ticket Service Fiori Annotations
 *
 * UI for the standalone Fuel Ticket create/edit app (TicketService,
 * /odata/v4/tickets). A ticket here always belongs to a Fuel Order -
 * order is @mandatory in ticket-service.cds - and picking one auto-fills
 * the flight fields via the before-PATCH hook in ticket-service.js.
 * internal_number is generated the same way, on Create; it is never
 * user-entered.
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
    Common.SideEffects #OrderPicked: {
        SourceProperties : [order_ID],
        TargetProperties : [flight_number, aircraft_reg, uom_code, supplier_ticket_ref]
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
            { $Type: 'UI.ReferenceFacet', ID: 'Verification',  Target: '@UI.FieldGroup#Verification',  Label: 'Verification' }
        ],

        FieldGroup #TicketStatus: {
            Data: [
                { Value: status },
                { Value: match_status }
            ]
        },

        // THE ORDER, PICKED FIRST — everything else in this group is
        // auto-populated the moment it's selected (ticket-service.js's
        // populateFromOrder), and reads as read-only because of it.
        FieldGroup #OrderFlight: {
            Data: [
                { Value: order_ID },
                { Value: flight_number,  ![@UI.Importance]: #High },
                { Value: aircraft_reg,   ![@UI.Importance]: #Medium }
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
    flight_number        @title: 'Flight' @Common.FieldControl: #ReadOnly;
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
    quantity_kg          @title: 'Uplift by Meter (kg)' @Common.FieldControl: #ReadOnly;
    density_value        @title: 'Density' @Measures.Unit: density_uom;
    density_uom          @title: 'Density Unit';
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
};

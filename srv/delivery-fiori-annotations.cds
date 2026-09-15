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
    Common.SideEffects #OrderPicked: {
        SourceProperties : [order_ID],
        TargetProperties : [flight_number, aircraft_reg, uom_code]
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

        HeaderFacets: [
            { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#DeliveryStatus', Label: 'Status' }
        ],

        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'AircraftOrder',       Target: '@UI.FieldGroup#AircraftOrder',       Label: 'Aircraft & Fuel Order' },
            { $Type: 'UI.ReferenceFacet', ID: 'DeliveryDetails',     Target: '@UI.FieldGroup#DeliveryDetails',     Label: 'Delivery Details' },
            { $Type: 'UI.ReferenceFacet', ID: 'QualityMeasurements', Target: '@UI.FieldGroup#QualityMeasurements', Label: 'Quality Measurements' },
            { $Type: 'UI.ReferenceFacet', ID: 'AircraftGauge',       Target: '@UI.FieldGroup#AircraftGauge',       Label: 'Aircraft Gauge (FQIS)' },
            { $Type: 'UI.ReferenceFacet', ID: 'Reconciliation',      Target: '@UI.FieldGroup#Reconciliation',      Label: 'FOB Reconciliation' },
            { $Type: 'UI.ReferenceFacet', ID: 'Variance',            Target: '@UI.FieldGroup#Variance',            Label: 'Variance' },
            { $Type: 'UI.ReferenceFacet', ID: 'Signatures',          Target: '@UI.FieldGroup#Signatures',          Label: 'Signatures' },
            { $Type: 'UI.ReferenceFacet', ID: 'S4HANAReferences',    Target: '@UI.FieldGroup#S4HANAReferences',    Label: 'S/4HANA References' }
        ],

        FieldGroup #DeliveryStatus: {
            Data: [
                { Value: status },
                { Value: recon_status }
            ]
        },

        // THE AIRCRAFT, PICKED FIRST — decision B2. order is an optional F4
        // pick alongside it; everything else in this group auto-populates
        // the moment an order is selected (delivery-service.js's
        // populateFromOrder).
        FieldGroup #AircraftOrder: {
            Data: [
                { Value: aircraft_reg,  ![@UI.Importance]: #High },
                { Value: order_ID },
                { Value: flight_number, ![@UI.Importance]: #Medium }
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
        },

        FieldGroup #Variance: {
            Data: [
                { Value: quantity_variance },
                { Value: variance_percentage },
                { Value: variance_flag },
                { Value: variance_reason }
            ]
        },

        FieldGroup #Signatures: {
            Data: [
                { Value: pilot_name },
                { Value: ground_crew_name }
            ]
        },

        FieldGroup #S4HANAReferences: {
            Data: [
                { Value: s4_gr_number },
                { Value: s4_gr_year },
                { Value: s4_gr_item }
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

    // THE F4 ITSELF. Aircraft Registration - the primary identifying field
    // (decision B2), so unlike order below it stays editable even once
    // auto-populated from a picked order.
    aircraft_reg @title: 'Aircraft Registration' @mandatory
                 @Common.ValueList: {
                     Label: 'Aircraft Registration',
                     CollectionPath: 'AircraftRegistrations',
                     Parameters: [
                         { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: aircraft_reg, ValueListProperty: 'registration' },
                         { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'aircraft_type_code' }
                     ]
                 };

    // Optional F4 - Text + TextOnly so the field shows just the order
    // number once picked, not "order_number (GUID)".
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

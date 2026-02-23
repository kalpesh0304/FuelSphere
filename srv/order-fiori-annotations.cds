/**
 * FuelSphere - Fuel Order Service Fiori Annotations
 * Document: FDD-04 - Fuel Orders & Milestones Module
 *
 * UI Screens:
 * - FO-001: Fuel Order Overview (List Report)
 * - FO-002: Fuel Order Detail (Object Page)
 * - FO-003: Create Fuel Order
 * - FO-004: Fuel Order Edit
 *
 * Based on FIGMA specifications: fuelsphere-screen-interactions.md
 */

using FuelOrderService from './order-service';

// ============================================================================
// FUEL ORDERS - List Report (FO-001) and Object Page (FO-002)
// ============================================================================

annotate FuelOrderService.FuelOrders with @(
    // ----------------------------------------------------------------------------
    // List Report Configuration (FO-001)
    // ----------------------------------------------------------------------------
    UI: {
        // Header Info for Object Page
        HeaderInfo: {
            TypeName       : 'Fuel Order',
            TypeNamePlural : 'Fuel Orders',
            Title          : { Value: order_number },
            Description    : { Value: station_code },
            ImageUrl       : 'sap-icon://shipping-status'
        },

        // Selection Fields for Filter Bar
        SelectionFields: [
            station_code,
            supplier_ID,
            status,
            priority,
            requested_date,
            product_ID
        ],

        // Line Item columns for List Report table
        LineItem: [
            { Value: order_number, Label: 'Order Number', ![@UI.Importance]: #High },
            { Value: requested_date, Label: 'Order Date', ![@UI.Importance]: #High },
            { Value: station_code, Label: 'Station', ![@UI.Importance]: #High },
            { Value: supplier.supplier_name, Label: 'Supplier', ![@UI.Importance]: #High },
            { Value: product.product_name, Label: 'Fuel Type', ![@UI.Importance]: #Medium },
            { Value: ordered_quantity, Label: 'Quantity (kg)', ![@UI.Importance]: #High },
            {
                Value: status,
                Label: 'Status',
                Criticality: statusCriticality,
                ![@UI.Importance]: #High
            },
            { Value: total_amount, Label: 'Total Amount', ![@UI.Importance]: #Medium },
            { Value: currency_code, Label: 'Currency', ![@UI.Importance]: #Low },
            { Value: priority, Label: 'Priority', Criticality: priorityCriticality, ![@UI.Importance]: #Medium },
            { Value: s4_po_number, Label: 'PO Number', ![@UI.Importance]: #Low }
        ],

        // Presentation Variant for default sorting
        PresentationVariant: {
            SortOrder: [
                { Property: requested_date, Descending: true },
                { Property: order_number, Descending: true }
            ],
            Visualizations: [
                '@UI.LineItem'
            ]
        },

        // ----------------------------------------------------------------------------
        // Object Page Configuration (FO-002)
        // ----------------------------------------------------------------------------

        // Header Facets (Key facts displayed in header)
        HeaderFacets: [
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#OrderStatus',
                Label  : 'Status'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#OrderQuantity',
                Label  : 'Quantity'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#OrderAmount',
                Label  : 'Amount'
            }
        ],

        // Field Groups for Header
        FieldGroup#OrderStatus: {
            Label: 'Status',
            Data: [
                { Value: status, Criticality: statusCriticality },
                { Value: priority, Criticality: priorityCriticality }
            ]
        },

        FieldGroup#OrderQuantity: {
            Label: 'Quantity',
            Data: [
                { Value: ordered_quantity, Label: 'Ordered (kg)' },
                { Value: uom_code, Label: 'UoM' }
            ]
        },

        FieldGroup#OrderAmount: {
            Label: 'Amount',
            Data: [
                { Value: total_amount, Label: 'Total' },
                { Value: currency_code, Label: 'Currency' }
            ]
        },

        // Object Page Facets (Sections)
        Facets: [
            // Section 1: Order Details
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#OrderDetails',
                Label  : 'Order Details'
            },
            // Section 2: Station & Supplier
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#StationSupplier',
                Label  : 'Station & Supplier'
            },
            // Section 3: Quantity & Pricing
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#QuantityPricing',
                Label  : 'Quantity & Pricing'
            },
            // Section 4: Delivery Window
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#DeliveryWindow',
                Label  : 'Delivery Window'
            },
            // Section 5: S/4HANA References
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#S4References',
                Label  : 'S/4HANA References'
            },
            // Section 5: Fuel Deliveries (ePOD)
            {
                $Type  : 'UI.ReferenceFacet',
                Target : 'deliveries/@UI.LineItem',
                Label  : 'Deliveries (ePOD)'
            },
            // Section 6: Fuel Tickets
            {
                $Type  : 'UI.ReferenceFacet',
                Target : 'tickets/@UI.LineItem',
                Label  : 'Fuel Tickets'
            },
            // Section 7: Administrative
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#Administrative',
                Label  : 'Administrative'
            }
        ],

        // Field Group: Order Details
        FieldGroup#OrderDetails: {
            Label: 'Order Details',
            Data: [
                { Value: order_number, Label: 'Order Number' },
                { Value: requested_date, Label: 'Requested Date' },
                { Value: requested_time, Label: 'Requested Time' },
                { Value: flight_ID, Label: 'Flight' },
                { Value: priority, Label: 'Priority' },
                { Value: status, Label: 'Status' },
                { Value: notes, Label: 'Notes' }
            ]
        },

        // Field Group: Station & Supplier
        FieldGroup#StationSupplier: {
            Label: 'Station & Supplier',
            Data: [
                { Value: station_code, Label: 'Station Code' },
                { Value: airport.airport_name, Label: 'Airport' },
                { Value: supplier.supplier_name, Label: 'Supplier' },
                { Value: supplier.supplier_type, Label: 'Supplier Type' },
                { Value: supplier.supplier_rating, Label: 'Supplier Rating' },
                { Value: contract.contract_number, Label: 'Contract' },
                { Value: override_reason, Label: 'Override Reason' }
            ]
        },

        // Field Group: Quantity & Pricing
        FieldGroup#QuantityPricing: {
            Label: 'Quantity & Pricing',
            Data: [
                { Value: product.product_name, Label: 'Fuel Product' },
                { Value: product.specification, Label: 'Specification' },
                { Value: planned_quantity, Label: 'Planned Quantity (from Matrix)' },
                { Value: ordered_quantity, Label: 'Requested Quantity' },
                { Value: is_manual_override, Label: 'Manual Override' },
                { Value: uom_code, Label: 'Unit of Measure' },
                { Value: unit_price, Label: 'Unit Price' },
                { Value: total_amount, Label: 'Total Amount' },
                { Value: currency_code, Label: 'Currency' }
            ]
        },

        // Field Group: Delivery Window
        FieldGroup#DeliveryWindow: {
            Label: 'Delivery Window',
            Data: [
                { Value: delivery_window_start, Label: 'Window Start' },
                { Value: delivery_window_end, Label: 'Window End' }
            ]
        },

        // Field Group: S/4HANA References
        FieldGroup#S4References: {
            Label: 'S/4HANA References',
            Data: [
                { Value: s4_po_number, Label: 'Purchase Order' },
                { Value: s4_po_item, Label: 'PO Item' }
            ]
        },

        // Field Group: Administrative
        FieldGroup#Administrative: {
            Label: 'Administrative',
            Data: [
                { Value: created_at, Label: 'Created At' },
                { Value: created_by, Label: 'Created By' },
                { Value: modified_at, Label: 'Modified At' },
                { Value: modified_by, Label: 'Modified By' },
                { Value: cancelled_reason, Label: 'Cancellation Reason' },
                { Value: cancelled_by, Label: 'Cancelled By' },
                { Value: cancelled_at, Label: 'Cancelled At' }
            ]
        }
    }
);

// Virtual element for status criticality
annotate FuelOrderService.FuelOrders with {
    // Status criticality mapping
    // Draft = Neutral (0), Submitted = Information (1), Confirmed = Positive (3)
    // InProgress = Warning (2), Delivered = Positive (3), Cancelled = Negative (1)
    status @Common.Text: {
        $value: status,
        ![@UI.TextArrangement]: #TextOnly
    };
};

// Field-level annotations for FuelOrders
annotate FuelOrderService.FuelOrders with {
    ID              @UI.Hidden;
    order_number    @title: 'Order Number' @Common.FieldControl: #ReadOnly;
    station_code    @title: 'Station' @mandatory;
    requested_date  @title: 'Delivery Date' @mandatory;
    requested_time  @title: 'Delivery Time';
    ordered_quantity @title: 'Quantity (kg)' @mandatory @Measures.Unit: uom_code;
    unit_price      @title: 'Unit Price' @Measures.ISOCurrency: currency_code;
    total_amount    @title: 'Total Amount' @Measures.ISOCurrency: currency_code;
    currency_code   @title: 'Currency';
    uom_code        @title: 'UoM';
    priority        @title: 'Priority';
    status          @title: 'Status' @Common.FieldControl: #ReadOnly;
    notes           @title: 'Notes' @UI.MultiLineText;
    s4_po_number    @title: 'PO Number' @Common.FieldControl: #ReadOnly;
    s4_po_item      @title: 'PO Item' @Common.FieldControl: #ReadOnly;
    planned_quantity @title: 'Planned Quantity (kg)' @Common.FieldControl: #ReadOnly;
    is_manual_override @title: 'Manual Override' @Common.FieldControl: #ReadOnly;
    override_reason @title: 'Override Reason' @UI.MultiLineText;
    delivery_window_start @title: 'Window Start';
    delivery_window_end @title: 'Window End';
    cancelled_reason @title: 'Cancellation Reason' @UI.MultiLineText;
    cancelled_by    @title: 'Cancelled By' @Common.FieldControl: #ReadOnly;
    cancelled_at    @title: 'Cancelled At' @Common.FieldControl: #ReadOnly;
    created_at      @title: 'Created At' @Common.FieldControl: #ReadOnly;
    created_by      @title: 'Created By' @Common.FieldControl: #ReadOnly;
    modified_at     @title: 'Modified At' @Common.FieldControl: #ReadOnly;
    modified_by     @title: 'Modified By' @Common.FieldControl: #ReadOnly;
};

// Value Help for associations
annotate FuelOrderService.FuelOrders with {
    airport @(
        Common: {
            Text: airport.airport_name,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Airports',
                CollectionPath: 'Airports',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: airport_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'iata_code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'airport_name' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'city' }
                ]
            }
        }
    );

    supplier @(
        Common: {
            Text: supplier.supplier_name,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Suppliers',
                CollectionPath: 'Suppliers',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: supplier_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'supplier_code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'supplier_name' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'supplier_type' }
                ]
            }
        }
    );

    contract @(
        Common: {
            Text: contract.contract_number,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Contracts',
                CollectionPath: 'Contracts',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: contract_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'contract_number' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'contract_name' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'valid_from' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'valid_to' }
                ]
            }
        }
    );

    product @(
        Common: {
            Text: product.product_name,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Products',
                CollectionPath: 'Products',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: product_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'product_code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'product_name' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'product_type' }
                ]
            }
        }
    );

    flight @(
        Common: {
            Text: flight.flight_number,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Flights',
                CollectionPath: 'Flights',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: flight_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'flight_number' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'flight_date' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'origin_airport' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'destination_airport' }
                ]
            }
        }
    );
};

// ============================================================================
// FUEL DELIVERIES - Line Item in Order Detail and standalone List
// ============================================================================

annotate FuelOrderService.FuelDeliveries with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Delivery',
            TypeNamePlural : 'Deliveries',
            Title          : { Value: delivery_number },
            Description    : { Value: status }
        },

        // Line Item for embedded table in Order Object Page
        LineItem: [
            { Value: delivery_number, Label: 'Delivery Number', ![@UI.Importance]: #High },
            { Value: delivery_date, Label: 'Date', ![@UI.Importance]: #High },
            { Value: delivery_time, Label: 'Time', ![@UI.Importance]: #Medium },
            { Value: delivered_quantity, Label: 'Delivered (kg)', ![@UI.Importance]: #High },
            { Value: temperature, Label: 'Temp (C)', ![@UI.Importance]: #Low },
            { Value: density, Label: 'Density', ![@UI.Importance]: #Low },
            {
                Value: status,
                Label: 'Status',
                Criticality: statusCriticality,
                ![@UI.Importance]: #High
            },
            { Value: variance_flag, Label: 'Variance', Criticality: varianceCriticality, ![@UI.Importance]: #Medium },
            { Value: s4_gr_number, Label: 'GR Number', ![@UI.Importance]: #Low },
            { Value: pilot_name, Label: 'Pilot', ![@UI.Importance]: #Low },
            { Value: ground_crew_name, Label: 'Ground Crew', ![@UI.Importance]: #Low }
        ],

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#DeliveryDetails',
                Label  : 'Delivery Details'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#QualityMeasurements',
                Label  : 'Quality Measurements'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#Signatures',
                Label  : 'Signatures'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#S4HANAReferences',
                Label  : 'S/4HANA References'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#Variance',
                Label  : 'Variance'
            }
        ],

        FieldGroup#DeliveryDetails: {
            Label: 'Delivery Details',
            Data: [
                { Value: delivery_number, Label: 'Delivery Number' },
                { Value: delivery_date, Label: 'Delivery Date' },
                { Value: delivery_time, Label: 'Delivery Time' },
                { Value: delivered_quantity, Label: 'Delivered Quantity (kg)' },
                { Value: vehicle_id, Label: 'Vehicle ID' },
                { Value: driver_name, Label: 'Driver Name' },
                { Value: status, Label: 'Status' }
            ]
        },

        FieldGroup#QualityMeasurements: {
            Label: 'Quality Measurements',
            Data: [
                { Value: temperature, Label: 'Temperature (C)' },
                { Value: density, Label: 'Density (kg/L)' },
                { Value: temperature_corrected_qty, Label: 'Temperature Corrected Qty (kg)' }
            ]
        },

        FieldGroup#Signatures: {
            Label: 'Digital Signatures',
            Data: [
                { Value: pilot_name, Label: 'Pilot Name' },
                { Value: ground_crew_name, Label: 'Ground Crew Name' },
                { Value: signature_timestamp, Label: 'Signature Time' },
                { Value: signature_location, Label: 'Location' }
            ]
        },

        FieldGroup#S4HANAReferences: {
            Label: 'S/4HANA References',
            Data: [
                { Value: s4_gr_number, Label: 'Goods Receipt Number' },
                { Value: s4_gr_year, Label: 'GR Year' },
                { Value: s4_gr_item, Label: 'GR Item' }
            ]
        },

        FieldGroup#Variance: {
            Label: 'Quantity Variance',
            Data: [
                { Value: quantity_variance, Label: 'Variance (kg)' },
                { Value: variance_percentage, Label: 'Variance (%)' },
                { Value: variance_flag, Label: 'Variance Flag' },
                { Value: variance_reason, Label: 'Variance Reason' }
            ]
        }
    }
);

// Field-level annotations for FuelDeliveries
annotate FuelOrderService.FuelDeliveries with {
    ID                  @UI.Hidden;
    delivery_number     @title: 'Delivery Number' @Common.FieldControl: #ReadOnly;
    delivery_date       @title: 'Delivery Date' @mandatory;
    delivery_time       @title: 'Delivery Time' @mandatory;
    delivered_quantity  @title: 'Delivered Qty (kg)' @mandatory;
    temperature         @title: 'Temperature (C)';
    density             @title: 'Density (kg/L)';
    temperature_corrected_qty @title: 'Corrected Qty (kg)';
    vehicle_id          @title: 'Vehicle ID';
    driver_name         @title: 'Driver Name';
    pilot_name          @title: 'Pilot Name';
    ground_crew_name    @title: 'Ground Crew';
    signature_timestamp @title: 'Signature Time' @Common.FieldControl: #ReadOnly;
    signature_location  @title: 'Location';
    s4_gr_number        @title: 'GR Number' @Common.FieldControl: #ReadOnly;
    s4_gr_year          @title: 'GR Year' @Common.FieldControl: #ReadOnly;
    s4_gr_item          @title: 'GR Item' @Common.FieldControl: #ReadOnly;
    status              @title: 'Status';
    quantity_variance   @title: 'Variance (kg)' @Common.FieldControl: #ReadOnly;
    variance_percentage @title: 'Variance (%)' @Common.FieldControl: #ReadOnly;
    variance_flag       @title: 'Variance Flag' @Common.FieldControl: #ReadOnly;
    variance_reason     @title: 'Variance Reason' @UI.MultiLineText;
};

// ============================================================================
// FUEL TICKETS - Line Item in Order Detail
// ============================================================================

annotate FuelOrderService.FuelTickets with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Fuel Ticket',
            TypeNamePlural : 'Fuel Tickets',
            Title          : { Value: ticket_number },
            Description    : { Value: status }
        },

        LineItem: [
            { Value: ticket_number, Label: 'Ticket Number', ![@UI.Importance]: #High },
            { Value: internal_number, Label: 'Internal Number', ![@UI.Importance]: #Medium },
            { Value: aircraft_reg, Label: 'Aircraft Reg', ![@UI.Importance]: #High },
            { Value: flight_number, Label: 'Flight', ![@UI.Importance]: #High },
            { Value: quantity, Label: 'Quantity (kg)', ![@UI.Importance]: #High },
            { Value: delivery_timestamp, Label: 'Delivery Time', ![@UI.Importance]: #Medium },
            {
                Value: status,
                Label: 'Status',
                Criticality: statusCriticality,
                ![@UI.Importance]: #High
            },
            { Value: verified_by, Label: 'Verified By', ![@UI.Importance]: #Low },
            { Value: verified_at, Label: 'Verified At', ![@UI.Importance]: #Low }
        ],

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#TicketDetails',
                Label  : 'Ticket Details'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#Verification',
                Label  : 'Verification'
            }
        ],

        FieldGroup#TicketDetails: {
            Label: 'Ticket Details',
            Data: [
                { Value: ticket_number, Label: 'Ticket Number' },
                { Value: internal_number, Label: 'Internal Number' },
                { Value: aircraft_reg, Label: 'Aircraft Registration' },
                { Value: flight_number, Label: 'Flight Number' },
                { Value: quantity, Label: 'Quantity (kg)' },
                { Value: uom_code, Label: 'UoM' },
                { Value: delivery_timestamp, Label: 'Delivery Time' },
                { Value: supplier_ticket_ref, Label: 'Supplier Reference' },
                { Value: status, Label: 'Status' }
            ]
        },

        FieldGroup#Verification: {
            Label: 'Verification',
            Data: [
                { Value: verified_by, Label: 'Verified By' },
                { Value: verified_at, Label: 'Verified At' }
            ]
        }
    }
);

// Field-level annotations for FuelTickets
annotate FuelOrderService.FuelTickets with {
    ID                  @UI.Hidden;
    ticket_number       @title: 'Ticket Number' @mandatory;
    internal_number     @title: 'Internal Number' @Common.FieldControl: #ReadOnly;
    aircraft_reg        @title: 'Aircraft Reg';
    flight_number       @title: 'Flight';
    quantity            @title: 'Quantity (kg)' @mandatory;
    uom_code            @title: 'UoM';
    delivery_timestamp  @title: 'Delivery Time' @mandatory;
    supplier_ticket_ref @title: 'Supplier Reference';
    status              @title: 'Status';
    verified_by         @title: 'Verified By' @Common.FieldControl: #ReadOnly;
    verified_at         @title: 'Verified At' @Common.FieldControl: #ReadOnly;
};

// ============================================================================
// FLIGHTS - Read-only reference data
// ============================================================================

annotate FuelOrderService.Flights with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Flight',
            TypeNamePlural : 'Flights',
            Title          : { Value: flight_number },
            Description    : { Value: flight_date }
        },

        LineItem: [
            { Value: flight_number, Label: 'Flight Number' },
            { Value: flight_date, Label: 'Date' },
            { Value: aircraft_type, Label: 'Aircraft Type' },
            { Value: aircraft_reg, Label: 'Registration' },
            { Value: origin_airport, Label: 'Origin' },
            { Value: destination_airport, Label: 'Destination' },
            { Value: scheduled_departure, Label: 'Departure' },
            { Value: scheduled_arrival, Label: 'Arrival' },
            { Value: status, Label: 'Status' }
        ]
    }
);

annotate FuelOrderService.Flights with {
    ID                  @UI.Hidden;
    flight_number       @title: 'Flight Number';
    flight_date         @title: 'Date';
    aircraft_type       @title: 'Aircraft Type';
    aircraft_reg        @title: 'Registration';
    origin_airport      @title: 'Origin';
    destination_airport @title: 'Destination';
    scheduled_departure @title: 'Departure';
    scheduled_arrival   @title: 'Arrival';
    status              @title: 'Status';
};

// ============================================================================
// FUEL ORDER DASHBOARD - KPI & Analytical Annotations (FO-DASHBOARD)
// ============================================================================

// Aggregation support for dashboard analytics
annotate FuelOrderService.FuelOrders with @(
    Aggregation.ApplySupported: {
        Transformations: [ 'aggregate', 'groupby', 'filter' ],
        AggregatableProperties: [
            { Property: ordered_quantity },
            { Property: total_amount }
        ],
        GroupableProperties: [
            station_code,
            status,
            priority,
            supplier_ID,
            product_ID,
            requested_date
        ]
    }
);

// KPI DataPoint annotations for dashboard tiles
annotate FuelOrderService.FuelOrders with @(
    UI.DataPoint#TotalOrders: {
        Value: order_number,
        Title: 'Total Orders'
    },
    UI.DataPoint#OrderStatus: {
        Value: status,
        Title: 'Status',
        Criticality: statusCriticality
    },
    UI.DataPoint#OrderQuantity: {
        Value: ordered_quantity,
        Title: 'Ordered Quantity',
        Description: 'Total fuel ordered (kg)'
    },
    UI.DataPoint#OrderAmount: {
        Value: total_amount,
        Title: 'Order Amount',
        Description: 'Total order value'
    }
);

// ============================================================================
// SUPPLIER ALLOCATION TARGETS - Dashboard Donut Chart
// ============================================================================

annotate FuelOrderService.SupplierAllocationTargets with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Supplier Allocation',
            TypeNamePlural : 'Supplier Allocations',
            Title          : { Value: supplier.supplier_name },
            Description    : { Value: station_code }
        },
        LineItem: [
            { Value: supplier.supplier_name, Label: 'Supplier', ![@UI.Importance]: #High },
            { Value: station_code, Label: 'Station', ![@UI.Importance]: #Medium },
            { Value: period_year, Label: 'Year', ![@UI.Importance]: #Medium },
            { Value: target_percentage, Label: 'Target %', ![@UI.Importance]: #High },
            { Value: actual_percentage, Label: 'Actual %', ![@UI.Importance]: #High },
            { Value: variance_percentage, Label: 'Variance %', ![@UI.Importance]: #High },
            { Value: target_volume_kg, Label: 'Target Volume (kg)', ![@UI.Importance]: #Medium },
            { Value: actual_volume_kg, Label: 'Actual Volume (kg)', ![@UI.Importance]: #Medium }
        ]
    }
);

annotate FuelOrderService.SupplierAllocationTargets with {
    ID                  @UI.Hidden;
    target_percentage   @title: 'Target %';
    actual_percentage   @title: 'Actual %';
    variance_percentage @title: 'Variance %';
    target_volume_kg    @title: 'Target Volume (kg)';
    actual_volume_kg    @title: 'Actual Volume (kg)';
    period_year         @title: 'Year';
    period_month        @title: 'Month';
    station_code        @title: 'Station';
};

// ============================================================================
// ROUTE-AIRCRAFT MATRIX - Fuel Lookup for Create Form
// ============================================================================

annotate FuelOrderService.RouteAircraftMatrix with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Fuel Requirement',
            TypeNamePlural : 'Fuel Requirements',
            Title          : { Value: route.route_code },
            Description    : { Value: aircraft_type.aircraft_type_code }
        },
        LineItem: [
            { Value: route.route_code, Label: 'Route', ![@UI.Importance]: #High },
            { Value: aircraft_type.aircraft_type_code, Label: 'Aircraft Type', ![@UI.Importance]: #High },
            { Value: trip_fuel, Label: 'Trip Fuel (kg)', ![@UI.Importance]: #High },
            { Value: taxi_fuel, Label: 'Taxi Fuel (kg)', ![@UI.Importance]: #Medium },
            { Value: contingency_fuel, Label: 'Contingency (kg)', ![@UI.Importance]: #Medium },
            { Value: alternate_fuel, Label: 'Alternate (kg)', ![@UI.Importance]: #Low },
            { Value: reserve_fuel, Label: 'Reserve (kg)', ![@UI.Importance]: #Low },
            { Value: total_standard_fuel, Label: 'Total Standard Fuel (kg)', ![@UI.Importance]: #High }
        ]
    }
);

annotate FuelOrderService.RouteAircraftMatrix with {
    ID                  @UI.Hidden;
    trip_fuel           @title: 'Trip Fuel (kg)';
    taxi_fuel           @title: 'Taxi Fuel (kg)';
    contingency_fuel    @title: 'Contingency (kg)';
    alternate_fuel      @title: 'Alternate (kg)';
    reserve_fuel        @title: 'Reserve (kg)';
    extra_fuel          @title: 'Extra Fuel (kg)';
    total_standard_fuel @title: 'Total Standard Fuel (kg)';
    summer_factor       @title: 'Summer Factor';
    winter_factor       @title: 'Winter Factor';
};

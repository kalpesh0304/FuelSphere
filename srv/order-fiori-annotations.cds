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
                // The label no longer says kg. WP-11 made the unit a field,
                // and a header that hardcodes one is wrong the moment an
                // order is placed in litres.
                { Value: ordered_quantity, Label: 'Ordered' },
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
            // Section 4: S/4HANA References
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#S4References',
                Label  : 'S/4HANA References'
            },
            // UI-B-03. The dispatch plan this order was raised against. A
            // to-one association whose target is on the same service, so the
            // whole regulated stack is one click from the order.
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'OrderDispatchPlan',
                Target : 'dispatch_plan/@UI.FieldGroup#RegulatedStack',
                Label  : 'Dispatch Plan'
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
            // Section 7: Journey Progress
            {
                $Type: 'UI.ReferenceFacet',
                Target: '@UI.FieldGroup#JourneyProgress',
                Label: 'Journey Progress'
            },
            // Section 8: Cockpit Crew Review
            {
                $Type: 'UI.ReferenceFacet',
                Target: '@UI.FieldGroup#CrewReview',
                Label: 'Cockpit Crew Review'
            },
            // Section 9: Administrative
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
                { Value: notes, Label: 'Notes' },
                // WP-33
                { Value: parent_order_ID, Label: 'Amends / Increments Order' },
                { Value: order_relationship, Label: 'Order Relationship' }
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
                { Value: contract.contract_number, Label: 'Contract' }
            ]
        },

        // Field Group: Quantity & Pricing
        FieldGroup#QuantityPricing: {
            Label: 'Quantity & Pricing',
            Data: [
                { Value: product.product_name, Label: 'Fuel Product' },
                { Value: product.specification, Label: 'Specification' },
                { Value: ordered_quantity, Label: 'Ordered Quantity' },
                { Value: uom_code, Label: 'Unit of Measure' },
                // WP-11 / decision A2. Planning is in kilograms and the order
                // is in volume, so the order carries the mass it was
                // converted from, the density used, and which configuration
                // row supplied it. Shown together because the three only mean
                // anything as a set: they exist so the conversion can be
                // reproduced from the order alone.
                { Value: ordered_quantity_kg, Label: 'Planned Mass (kg)' },
                { Value: conversion_density, Label: 'Conversion Density' },
                { Value: conversion_source, Label: 'Density Source' },
                { Value: unit_price, Label: 'Unit Price' },
                { Value: total_amount, Label: 'Total Amount' },
                { Value: currency_code, Label: 'Currency' },
                // WP-33
                { Value: is_tankering, Label: 'Tankering' },
                { Value: tankering_sectors, Label: 'Tankering Sectors' }
            ]
        },

        // Field Group: S/4HANA & External References
        FieldGroup#S4References: {
            Label: 'S/4HANA & External References',
            Data: [
                { Value: s4_po_number, Label: 'Purchase Order' },
                { Value: s4_po_item, Label: 'PO Item' },
                { Value: dispatch_fuel_order_id, Label: 'Dispatch Order ID' }
            ]
        },

        // Field Group: Cockpit Crew Review
        FieldGroup#CrewReview: {
            Label: 'Cockpit Crew Review',
            Data: [
                { Value: crew_review_status, Label: 'Review Status' },
                { Value: crew_reviewed_by, Label: 'Reviewed By (Captain)' },
                { Value: crew_reviewed_at, Label: 'Reviewed At' },
                { Value: crew_adjusted_quantity, Label: 'Crew Adjusted Quantity (kg)' },
                { Value: crew_adjustment_reason, Label: 'Adjustment Reason' },
                { Value: crew_notes, Label: 'Crew Notes' }
            ]
        },

        // Field Group: Journey Progress
        FieldGroup#JourneyProgress: {
            Label: 'Fuel Order Journey',
            Data: [
                { Value: status, Label: 'Order Status' },
                { Value: dispatch_fuel_order_id, Label: 'Dispatch Reference' },
                { Value: crew_review_status, Label: 'Crew Review' },
                { Value: s4_po_number, Label: 'S/4 PO Number' },
                // WP-33
                { Value: communicated_at, Label: 'Communicated At' },
                { Value: communication_status, Label: 'Communication Status' },
                { Value: communication_reference, Label: 'Communication Reference' }
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
        },

        // Object page custom action buttons
        Identification  : [
            {
                $Type : 'UI.DataFieldForAction',
                Action : 'FuelOrderService.submit',
                Label : 'Submit',
                ![@UI.Importance] : #High,
                ![@UI.Criticality]: #Positive,
            },
            {
                $Type: 'UI.DataFieldForAction',
                Action: 'FuelOrderService.crewReview',
                Label: 'Crew Review',
                Criticality: 2
            }
        ],
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
    // WP-33
    communicated_at              @title: 'Communicated At';
    // WP-33. The @title goes on the ASSOCIATION: CAP propagates it to the
    // generated foreign key, which is the property that actually renders.
    // Without it parent_order_ID shows its technical name on screen.
    parent_order                 @title: 'Amends / Increments Order';
    communication_status         @title: 'Communication Status';
    communication_reference      @title: 'Communication Reference';
    order_relationship           @title: 'Order Relationship';
    is_tankering                 @title: 'Tankering';
    tankering_sectors            @title: 'Tankering Sectors';
    ID              @UI.Hidden;
    order_number    @title: 'Order Number' @Common.FieldControl: #ReadOnly;
    station_code    @title: 'Station' @mandatory;
    requested_date  @title: 'Delivery Date' @mandatory;
    requested_time  @title: 'Delivery Time';
    ordered_quantity @title: 'Quantity (kg)' @mandatory @Measures.Unit: uom_code;
    unit_price      @title: 'Unit Price' @Measures.ISOCurrency: currency_code ;
    total_amount    @title: 'Total Amount' @Measures.ISOCurrency: currency_code @Common.FieldControl: #ReadOnly;
    currency_code   @title: 'Currency';
    uom_code        @title: 'UoM';
    priority        @title: 'Priority';
    status          @title: 'Status' @Common.FieldControl: #ReadOnly;
    notes           @title: 'Notes' @UI.MultiLineText;
    s4_po_number    @title: 'PO Number' @Common.FieldControl: #ReadOnly;
    s4_po_item      @title: 'PO Item' @Common.FieldControl: #ReadOnly;
    dispatch_fuel_order_id @title: 'Dispatch Order ID' @Common.FieldControl: #ReadOnly;
    cancelled_reason @title: 'Cancellation Reason' @UI.MultiLineText;
    cancelled_by    @title: 'Cancelled By' @Common.FieldControl: #ReadOnly;
    cancelled_at    @title: 'Cancelled At' @Common.FieldControl: #ReadOnly;
    created_at      @title: 'Created At' @Common.FieldControl: #ReadOnly;
    created_by      @title: 'Created By' @Common.FieldControl: #ReadOnly;
    modified_at     @title: 'Modified At' @Common.FieldControl: #ReadOnly;
    modified_by     @title: 'Modified By' @Common.FieldControl: #ReadOnly;
};

// Field-level annotations for Crew Review fields
annotate FuelOrderService.FuelOrders with {
    crew_review_status     @title: 'Crew Review Status';
    crew_reviewed_by       @title: 'Reviewed By (Captain)';
    crew_reviewed_at       @title: 'Crew Review Time';
    crew_adjusted_quantity @title: 'Crew Adjusted Qty (kg)';
    crew_adjustment_reason @title: 'Adjustment Reason';
    crew_notes             @title: 'Crew Notes' @UI.MultiLineText;
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
                Label: 'Flight Schedule',
                CollectionPath: 'FlightSchedule',
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

    uom_code @(
        Common : { 
            Text : uom.uom_name,
            ValueList : {
                $Type : 'Common.ValueListType',
                CollectionPath : 'UnitsOfMeasure',
                Parameters : [
                    {
                        $Type : 'Common.ValueListParameterInOut',
                        LocalDataProperty : uom_code,
                        ValueListProperty : 'uom_code',
                    },
                    {
                        $Type : 'Common.ValueListParameterDisplayOnly',
                        ValueListProperty : 'uom_name',
                    }
                ],
            },
         },
    );

    currency_code @(
        Common : { 
            Text : currency.currency_name,
            TextArrangement : #TextFirst,
            ValueList : {
                $Type : 'Common.ValueListType',
                CollectionPath : 'Currencies',
                Parameters : [
                    {
                        $Type : 'Common.ValueListParameterInOut',
                        LocalDataProperty : currency_code,
                        ValueListProperty : 'currency_code',
                    },
                    {
                        $Type : 'Common.ValueListParameterDisplayOnly',
                        ValueListProperty : 'currency_name',
                    },
                    {
                        $Type : 'Common.ValueListParameterDisplayOnly',
                        ValueListProperty : 'symbol',
                    },
                ],
            },
         },
    );

    priority @(
        Common : { 
            ValueListWithFixedValues: true,
            Text : priority,
            TextArrangement : #TextOnly
         }
    );

    station_code @(
        Common: {
            ValueList : {
                $Type : 'Common.ValueListType',
                CollectionPath: 'StationLookup',
                Parameters: [
                    {
                        $Type : 'Common.ValueListParameterInOut',
                        LocalDataProperty : station_code,
                        ValueListProperty : 'station_code',
                    },
                     {
                        $Type             : 'Common.ValueListParameterOut',
                        LocalDataProperty : airport_ID,   // Auto-generated by CAP Association
                        ValueListProperty : 'airport_ID'
                    },
                    {
                        $Type             : 'Common.ValueListParameterOut',
                        LocalDataProperty : supplier_ID,  // Auto-generated by CAP Association
                        ValueListProperty : 'supplier_ID'
                    },
                    {
                        $Type             : 'Common.ValueListParameterOut',
                        LocalDataProperty : contract_ID,  // Auto-generated by CAP Association
                        ValueListProperty : 'contract_ID'
                    },
                    { 
                        $Type : 'Common.ValueListParameterOut',
                        LocalDataProperty : product_ID,
                        ValueListProperty : 'product_ID'
                    },
                    {
                        $Type : 'Common.ValueListParameterDisplayOnly',
                        ValueListProperty : 'airport_name',
                    },
                    {
                        $Type : 'Common.ValueListParameterDisplayOnly',
                        ValueListProperty : 'contract_number',
                    },
                    {
                        $Type : 'Common.ValueListParameterDisplayOnly',
                        ValueListProperty : 'supplier_name',
                    },
                    {
                        $Type : 'Common.ValueListParameterDisplayOnly',
                        ValueListProperty : 'product_name',
                    }
                ]
            },
        }
    );
};

annotate FuelOrderService.FuelOrders @(
    Common.SideEffects #StationChanged : {
        SourceProperties : [ station_code ],
        TargetEntities   : [ 
            airport, 
            supplier, 
            contract,
            product
        ]
    },

    Common.SideEffects #updTotAmt : {
        SourceProperties: [ ordered_quantity, unit_price],
        TargetProperties: [ 'total_amount' ]
    }
);

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

            // WP-17. recon_status and recon_variance_kg are adjacent
            // deliberately: a variance figure with no verdict beside it cannot
            // be judged, and a verdict with no figure cannot be checked.
            // fob_source belongs with them because it is what set the
            // threshold - the same variance is a pass on a crew reading and a
            // failure on an ACARS one.
            {
                Value: recon_status,
                Label: 'Reconciliation',
                Criticality: { $edmJson: { $If: [
                    { $Eq: [{ $Path: 'recon_status' }, 'RECONCILED'] }, 3,
                    { $If: [ { $Eq: [{ $Path: 'recon_status' }, 'VARIANCE'] }, 1, 2 ] } ] } },
                ![@UI.Importance]: #High
            },
            { Value: recon_variance_kg, Label: 'Recon Variance (kg)', ![@UI.Importance]: #High },
            { Value: fob_source, Label: 'FQIS Source', ![@UI.Importance]: #Medium },

            { Value: aircraft_reg, Label: 'Aircraft Reg', ![@UI.Importance]: #High },
            { Value: s4_gr_number, Label: 'GR Number', ![@UI.Importance]: #Low },
            { Value: pilot_name, Label: 'Pilot', ![@UI.Importance]: #Low },
            { Value: ground_crew_name, Label: 'Ground Crew', ![@UI.Importance]: #Low }
        ],

        // WP-UI-01: a list with no filter bar makes an operator scroll.
        SelectionFields: [
            delivery_date,
            aircraft_reg,
            status,
            recon_status,
            fob_source
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
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#AircraftGauge',
                Label  : 'Aircraft Gauge (FQIS)'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#Reconciliation',
                Label  : 'FOB Reconciliation'
            },
            // The order this delivery was made against. The navigation worked
            // and had no section. `tail` is NOT here - FuelOrderService has
            // no annotation block for AircraftRegistrations, so that facet
            // would render empty.
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'DeliveryOrder',
                Target : 'order/@UI.FieldGroup#OrderDetails',
                Label  : 'Fuel Order'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'DeliveryTail',
                Target : 'tail/@UI.FieldGroup#RegistrationKey',
                Label  : 'Aircraft'
            }
        ],

        FieldGroup#DeliveryDetails: {
            Label: 'Delivery Details',
            Data: [
                { Value: delivery_number, Label: 'Delivery Number' },
                { Value: delivery_date, Label: 'Delivery Date' },
                { Value: delivery_time, Label: 'Delivery Time' },
                { Value: aircraft_reg, Label: 'Aircraft Registration' },
                { Value: delivered_quantity, Label: 'Delivered Quantity' },
                { Value: uom_code, Label: 'Unit of Measure' },
                { Value: delivery_method, Label: 'Delivery Method' },
                { Value: vehicle_id, Label: 'Vehicle ID' },
                { Value: driver_name, Label: 'Driver Name' },
                { Value: status, Label: 'Status' },
                // WP-33
                { Value: refuel_start_utc, Label: 'Refuel Start (UTC)' },
                { Value: refuel_end_utc, Label: 'Refuel End (UTC)' },
                { Value: refuel_complete, Label: 'Refuel Complete' }
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

        // WP-12 / decision B5. The FQIS belongs to the aircraft, so it belongs
        // to the refuelling event: one pair per event however many bowsers
        // were used. Kilograms unconditionally - a gauge reports mass.
        FieldGroup#AircraftGauge: {
            Label: 'Aircraft Gauge (FQIS)',
            Data: [
                { Value: fob_source, Label: 'Reading Source' },
                // Two arrival readings, not one. Ground time sits between
                // them, so they are shown together or the difference between
                // them looks like an error rather than a measurement.
                { Value: fob_at_arrival_kg, Label: 'FOB at Arrival (kg)' },
                { Value: fob_before_kg, Label: 'FOB Before Uplift (kg)' },
                { Value: ground_burn_kg, Label: 'Ground Burn (kg)' },
                { Value: fob_after_kg, Label: 'FOB After Uplift (kg)' },
                { Value: fob_delta_kg, Label: 'FQIS Uplift (kg)' },
                { Value: fob_rounding_kg, Label: 'Reading Rounding (kg)' }
            ]
        },

        // WP-17 / decisions B5 and C-1.
        FieldGroup#Reconciliation: {
            Label: 'FOB Reconciliation',
            Data: [
                {
                    Value: recon_status,
                    Label: 'Reconciliation Status',
                    Criticality: { $edmJson: { $If: [
                        { $Eq: [{ $Path: 'recon_status' }, 'RECONCILED'] }, 3,
                        { $If: [ { $Eq: [{ $Path: 'recon_status' }, 'VARIANCE'] }, 1, 2 ] } ] } }
                },
                { Value: recon_variance_kg, Label: 'Variance (kg)' },
                // The source is in this group because it is what set the
                // threshold the variance was judged against.
                { Value: fob_source, Label: 'Threshold Source (FQIS)' },
                { Value: fob_delta_kg, Label: 'FQIS Uplift (kg)' },
                // Attribution requires exactly one. Two suppliers on one gauge
                // pair produce a figure belonging to neither.
                { Value: supplier_count, Label: 'Suppliers on this Refuelling' }
            ]
        },

        FieldGroup#Signatures: {
            Label: 'Digital Signatures',
            Data: [
                { Value: pilot_name, Label: 'Pilot Name' },
                { Value: ground_crew_name, Label: 'Ground Crew Name' },
                // WP-31 step 3. MOVED to the evidence layer. The facet still
                // shows when and where the signature was taken; it reads
                // captured_at and capture_location on the document instead of
                // two columns on the delivery. Same purpose, new path.
                { Value: signature_pilot_document.captured_at, Label: 'Signature Time' },
                { Value: signature_pilot_document.capture_location, Label: 'Location' },
                { Value: signature_pilot_document.image_uri, Label: 'Pilot Signature' },
                { Value: signature_crew_document.image_uri, Label: 'Ground Crew Signature' }
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
    // WP-33
    refuel_start_utc             @title: 'Refuel Start (UTC)';
    refuel_end_utc               @title: 'Refuel End (UTC)';
    refuel_complete              @title: 'Refuel Complete';
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
    // WP-31 step 3. The READERS moved to the documents; the labels on the old
    // fields STAY until step 4 removes the fields themselves.
    //
    // Dropping them early looked like a useful signal and was a regression:
    // the fields are still exposed through the projection, so an unlabelled
    // one renders its technical name to a user. WP-UI-02's harness caught it.
    // A field that is still visible still needs a label, whatever the plan
    // for it is.
    signature_pilot_document @title: 'Pilot Signature';
    signature_crew_document  @title: 'Ground Crew Signature';
    gauge_before_document    @title: 'Gauge Before';
    gauge_after_document     @title: 'Gauge After';
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
            // WP-11/WP-12: the claimed figure and the metered figure are
            // different numbers and both carry a unit. @Measures.Unit puts
            // uom_code against each rather than in a column of its own,
            // several positions away.
            { Value: quantity, Label: 'Claimed Quantity', ![@UI.Importance]: #High },
            { Value: quantity_metered, Label: 'Metered', ![@UI.Importance]: #High },
            { Value: quantity_kg, Label: 'Mass (kg)', ![@UI.Importance]: #High },
            { Value: delivery_timestamp, Label: 'Delivery Time', ![@UI.Importance]: #Medium },
            {
                Value: status,
                Label: 'Status',
                // WP-UI-01: was `Criticality: statusCriticality`, which names
                // an element FuelOrderService.FuelTickets does not have — the
                // virtual exists only on TicketService.FuelTickets. The
                // compiler accepted it and the column rendered with no
                // criticality at all. Expressed here instead, so it does not
                // depend on a virtual that is not there.
                Criticality: { $edmJson: { $If: [
                    { $Eq: [{ $Path: 'status' }, 'Rejected'] }, 1,
                    { $If: [ { $In: [{ $Path: 'status' }, ['Verified', 'Closed', 'Attached']] }, 3, 0 ] } ] } },
                ![@UI.Importance]: #High
            },
            // WP-10 / decision A1. UNMATCHED is not an error - it is a ticket
            // awaiting attachment, with an owner and an age - but it is the
            // state somebody has to act on, so it reads negative.
            {
                Value: match_status,
                Label: 'Match Status',
                Criticality: { $edmJson: { $If: [
                    { $Eq: [{ $Path: 'match_status' }, 'MATCHED'] }, 3,
                    { $If: [ { $Eq: [{ $Path: 'match_status' }, 'UNMATCHED'] }, 1, 2 ] } ] } },
                ![@UI.Importance]: #High
            },
            { Value: verified_by, Label: 'Verified By', ![@UI.Importance]: #Low },
            { Value: verified_at, Label: 'Verified At', ![@UI.Importance]: #Low }
        ],

        SelectionFields: [
            delivery_timestamp,
            aircraft_reg,
            status,
            match_status
        ],

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#TicketDetails',
                Label  : 'Ticket Details'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#Measurement',
                Label  : 'Meter and Density'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#Verification',
                Label  : 'Verification'
            },
            // A ticket's two ends. The delivery is where its mass is
            // reconciled against the gauge; the order is what it was raised
            // against - and where its SUPPLIER lives, since FUEL_TICKETS has
            // none of its own.
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'TicketDelivery',
                Target : 'delivery/@UI.FieldGroup#Reconciliation',
                Label  : 'Delivery Reconciliation'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'TicketOrder',
                Target : 'order/@UI.FieldGroup#OrderDetails',
                Label  : 'Fuel Order'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'TicketTail',
                Target : 'tail/@UI.FieldGroup#RegistrationKey',
                Label  : 'Aircraft'
            }
        ],

        FieldGroup#TicketDetails: {
            Label: 'Ticket Details',
            Data: [
                { Value: ticket_number, Label: 'Ticket Number' },
                { Value: internal_number, Label: 'Internal Number' },
                { Value: aircraft_reg, Label: 'Aircraft Registration' },
                { Value: flight_number, Label: 'Flight Number' },
                { Value: quantity, Label: 'Claimed Quantity' },
                { Value: uom_code, Label: 'Unit of Measure' },
                { Value: delivery_timestamp, Label: 'Delivery Time' },
                { Value: supplier_ticket_ref, Label: 'Supplier Reference' },
                { Value: ticket_source, Label: 'Ticket Source (IATA-04)' },
            // UI-B-03. Beside ticket_source, never replacing it - that field
            // is IATA-04's one-character code and belongs to an external
            // standard. This one says how the VALUES were obtained.
            { Value: ticket_capture_source, Label: 'Capture Source', ![@UI.Importance]: #Medium },
                { Value: status, Label: 'Status' },
                { Value: match_status, Label: 'Match Status' }
            ]
        },

        // WP-12 / decisions B5 and B6. Store as metered, derive canonical.
        // The as-metered figures come first because they are what the
        // supplier invoices and what a dispute is about; quantity_kg is
        // derived from them and sits after, not instead of them.
        FieldGroup#Measurement: {
            Label: 'Meter and Density',
            Data: [
                { Value: meter_start, Label: 'Meter Start' },
                { Value: meter_end, Label: 'Meter End' },
                { Value: quantity_metered, Label: 'Metered Quantity' },
                { Value: quantity_flag, Label: 'Gross or Net' },
                // Density is per uom_code, which is why density_uom sits
                // beside it: 0.8020 KGL and 802.0 KGM are the same fuel.
                { Value: density_value, Label: 'Density' },
                { Value: density_uom, Label: 'Density Unit' },
                { Value: density_basis, Label: 'Density Basis' },
                { Value: density_temp_c, Label: 'Density Temperature (C)' },
                { Value: quantity_kg, Label: 'Canonical Mass (kg)' },
                { Value: batch_coa_ref, Label: 'Certificate of Analysis' },
                // WP-33
                { Value: vehicle_id, Label: 'Vehicle' },
                { Value: meter_serial, Label: 'Meter Serial' }
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
// ============================================================================
// UI-B-03 / WP-31. SourceDocuments had fourteen labelled fields and no screen
// at all - the entity was reachable and rendered nothing but keys.
//
// ocr_raw is deliberately NOT in the LineItem. It is audit-only, never read
// downstream, and a column of raw OCR output invites somebody to read it as
// the value. It sits on the object page where its label says what it is.
// ============================================================================
annotate FuelOrderService.SourceDocuments with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Source Document',
            TypeNamePlural : 'Source Documents',
            Title          : { Value: document_type },
            Description    : { Value: image_uri }
        },
        SelectionFields: [ document_type, ocr_status, capture_method, capture_station ],
        LineItem: [
            { Value: document_type,   Label: 'Type',            ![@UI.Importance]: #High },
            { Value: ocr_status,      Label: 'OCR Status',      ![@UI.Importance]: #High },
            // A READ with no confirmer is a number nobody has looked at, and
            // must not render like a confirmed one. Both columns, side by side.
            { Value: ocr_confidence,  Label: 'Confidence',      ![@UI.Importance]: #High },
            { Value: confirmed_by,    Label: 'Confirmed By',    ![@UI.Importance]: #High },
            { Value: captured_by,     Label: 'Captured By',     ![@UI.Importance]: #Medium },
            { Value: captured_at,     Label: 'Captured At',     ![@UI.Importance]: #Medium },
            { Value: capture_station, Label: 'Station',         ![@UI.Importance]: #Medium },
            { Value: capture_method,  Label: 'Method',          ![@UI.Importance]: #Low }
        ],
        HeaderFacets: [
            { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#Capture',      Label: 'Capture' },
            { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#Confirmation', Label: 'Confirmation' }
        ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'Evidence',     Target: '@UI.FieldGroup#Evidence',     Label: 'The Image' },
            { $Type: 'UI.ReferenceFacet', ID: 'OcrResult',    Target: '@UI.FieldGroup#OcrResult',    Label: 'OCR Result' },
            { $Type: 'UI.ReferenceFacet', ID: 'CaptureWhere', Target: '@UI.FieldGroup#CaptureWhere', Label: 'Where and How' }
        ],
        FieldGroup #Capture: {
            Data: [ { Value: captured_by, Label: 'Captured By' }, { Value: captured_at, Label: 'Captured At' } ]
        },
        FieldGroup #Confirmation: {
            Data: [ { Value: confirmed_by, Label: 'Confirmed By' }, { Value: confirmed_at, Label: 'Confirmed At' } ]
        },
        FieldGroup #Evidence: {
            Data: [
                { Value: image_uri,  Label: 'Image URI' },
                // The hash is what proves WHICH image the row referred to. A
                // URI can be repointed; a hash cannot be talked out of.
                { Value: image_hash, Label: 'Image Hash' }
            ]
        },
        FieldGroup #OcrResult: {
            Data: [
                { Value: ocr_status,     Label: 'OCR Status' },
                { Value: ocr_confidence, Label: 'Confidence' },
                { Value: ocr_engine,     Label: 'Engine' },
                { Value: ocr_raw,        Label: 'Raw Output (audit only)' }
            ]
        },
        FieldGroup #CaptureWhere: {
            Data: [
                { Value: capture_method,   Label: 'Capture Method' },
                { Value: capture_station,  Label: 'Station' },
                { Value: capture_location, Label: 'GPS / Location' }
            ]
        }
    }
);

// WP-31. The evidence layer's own labels. Not covered by WP-UI-02's four
// entities, but an unpoliced instance of a defect is still the defect.
annotate FuelOrderService.SourceDocuments with {
    ID               @UI.Hidden;
    document_type    @title: 'Document Type';
    image_uri        @title: 'Image';
    image_hash       @title: 'Image Hash'       @Common.FieldControl: #ReadOnly;
    capture_method   @title: 'Capture Method';
    captured_by      @title: 'Captured By';
    captured_at      @title: 'Captured At';
    capture_station  @title: 'Station';
    capture_location @title: 'Capture Location';
    ocr_status       @title: 'OCR Status';
    ocr_confidence   @title: 'OCR Confidence';
    ocr_engine       @title: 'OCR Engine';
    ocr_raw          @title: 'Raw OCR Output'   @Common.FieldControl: #ReadOnly;
    confirmed_by     @title: 'Confirmed By';
    confirmed_at     @title: 'Confirmed At';
}

annotate FuelOrderService.FuelTickets with {
    // WP-33
    vehicle_id                   @title: 'Vehicle';
    meter_serial                 @title: 'Meter Serial';
    // WP-31. On the ASSOCIATION, because CAP propagates it to the generated
    // foreign key - ticket_document_ID takes its label from here. Labelling
    // the FK directly is what WP-33 got wrong.
    ticket_document              @title: 'Ticket Image';
    meter_document               @title: 'Meter Image';
    ticket_capture_source        @title: 'Capture Source';
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
// FLIGHT SCHEDULE - Read-only reference data
// ============================================================================

annotate FuelOrderService.FlightSchedule with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Flight Schedule',
            TypeNamePlural : 'Flight Schedule',
            Title          : { Value: flight_number },
            Description    : { Value: flight_date }
        },

        LineItem: [
            // UI-B-03. ENR452: immutable through a tail swap, which is what
            // makes it the join key rather than flight_number + date.
            { Value: flight_leg_id, Label: 'Flight Leg ID', ![@UI.Importance]: #Medium },
            { Value: flight_number, Label: 'Flight Number' },
            { Value: flight_date, Label: 'Date' },
            { Value: aircraft_type, Label: 'Aircraft Type' },
            { Value: aircraft_reg, Label: 'Registration' },
            { Value: origin_airport, Label: 'Origin' },
            { Value: destination_airport, Label: 'Destination' },
            { Value: scheduled_departure, Label: 'Departure' },
            { Value: scheduled_arrival, Label: 'Arrival' },
            { Value: status, Label: 'Status' }
        ],

        // ====================================================================
        // This entity had a list and NO OBJECT PAGE SECTIONS AT ALL - opening
        // a flight showed a header and nothing else.
        //
        // Both facets are LISTS. A flight can raise several orders and carry
        // several dispatch plans, and the versioning fields only mean anything
        // when the plans are seen together: v1 SUPERSEDED above v2 ACTIVE is
        // the story, and one row cannot tell it.
        // ====================================================================
        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'FlightOrders',
                Target : 'orders/@UI.LineItem',
                Label  : 'Fuel Orders'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'FlightDispatchPlans',
                Target : 'dispatches/@UI.LineItem',
                Label  : 'Dispatch Plans'
            }
        ]
    }
);

annotate FuelOrderService.FlightSchedule with {
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
};

// ============================================================================
// FLIGHT DISPATCHES - List Report + Object Page
// ============================================================================

annotate FuelOrderService.FlightDispatches with @(
    UI: {
        // --- Header Info ---
        HeaderInfo: {
            TypeName       : 'Flight Dispatch',
            TypeNamePlural : 'Flight Dispatches',
            Title          : { Value: dispatch_order_id },
            Description    : { Value: flight_number }
        },

        // --- Filter Bar ---
        SelectionFields: [
            flight_number,
            flight_date,
            dispatch_source,
            tail_number,
            plan_status,
            plan_version_source
        ],

        // --- List Report Table ---
        LineItem: [
            { Value: dispatch_order_id, Label: 'Dispatch Order ID', ![@UI.Importance]: #High },
            { Value: flight_number, Label: 'Flight', ![@UI.Importance]: #High },
            { Value: flight_date, Label: 'Flight Date', ![@UI.Importance]: #High },
            { Value: tail_number, Label: 'Tail Number', ![@UI.Importance]: #High },
            { Value: atd, Label: 'ATD', ![@UI.Importance]: #Medium },
            { Value: ata, Label: 'ATA', ![@UI.Importance]: #Low },
            { Value: dispatch_qty_kg, Label: 'Dispatch Qty (kg)', ![@UI.Importance]: #High },
            // UI-B-03: the two figures the whole plan resolves to, in the list
            // rather than one level down.
            { Value: block_fuel_kg, Label: 'Block Fuel (kg)', ![@UI.Importance]: #High },
            { Value: required_uplift_kg, Label: 'Required Uplift (kg)', ![@UI.Importance]: #High },
            { Value: rob_departure_kg, Label: 'ROB Departure (kg)', ![@UI.Importance]: #Medium },
            { Value: payload_kg, Label: 'Payload (kg)', ![@UI.Importance]: #Medium },
            { Value: dispatch_source, Label: 'Source', ![@UI.Importance]: #Medium },
            { Value: dispatch_timestamp, Label: 'Dispatch Time', ![@UI.Importance]: #Low },
            {
                $Type  : 'UI.DataFieldForAction',
                Action : 'FuelOrderService.importFlightDispatchExcel',
                Label  : 'Upload Dispatch Data',
                Inline : false
            }
        ],

        // --- Default Sort ---
        PresentationVariant: {
            SortOrder: [
                { Property: flight_date, Descending: true },
                { Property: flight_number, Descending: false }
            ],
            Visualizations: [
                '@UI.LineItem'
            ]
        },

        // --- Object Page Header Facets ---
        HeaderFacets: [
            { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#DispatchStatus', Label: 'Dispatch Info' },
            { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#DispatchQuantities', Label: 'Quantities' }
        ],

        FieldGroup #DispatchStatus: {
            Data: [
                { Value: dispatch_source, Label: 'Source' },
                { Value: dispatch_timestamp, Label: 'Dispatch Time' }
            ]
        },

        FieldGroup #DispatchQuantities: {
            Data: [
                { Value: dispatch_qty_kg, Label: 'Dispatch Qty (kg)' },
                { Value: rob_departure_kg, Label: 'ROB Departure (kg)' },
                { Value: payload_kg, Label: 'Payload (kg)' }
            ]
        },

        // --- Object Page Sections ---
        Facets: [
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'DispatchIdentification',
                Label  : 'Dispatch Identification',
                Facets : [
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#DispatchID', Label: 'Identification' }
                ]
            },
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'AircraftCrew',
                Label  : 'Aircraft & Crew',
                Facets : [
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#AircraftCrew', Label: 'Aircraft & Crew' }
                ]
            },
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'TimingSection',
                Label  : 'Timing',
                Facets : [
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#DispatchTiming', Label: 'Timing' }
                ]
            },
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'QuantitiesSection',
                Label  : 'Quantities',
                Facets : [
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#DispatchQty', Label: 'Quantities' }
                ]
            },
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'FlightDataSection',
                Label  : 'Flight Data',
                Facets : [
                    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#FlightData', Label: 'Flight Data' }
                ]
            },
            // ================================================================
            // UI-B-03. THE REGULATED STACK AND THE PLAN VERSION.
            //
            // Seventeen fields carried a @title and no placement, so this
            // screen was blank exactly where the fuel plan belongs. The stack
            // is the reason FLIGHT_DISPATCH exists.
            //
            // Order follows the regulation rather than the schema: trip,
            // contingency, alternate, final reserve, taxi, then the two
            // discretionary terms, then the total they sum to. A reader
            // checking the arithmetic reads down the column.
            // ================================================================
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'RegulatedStack',
                Target : '@UI.FieldGroup#RegulatedStack',
                Label  : 'Regulated Fuel Stack'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'PlanVersion',
                Target : '@UI.FieldGroup#PlanVersion',
                Label  : 'Plan Version'
            },
            // The order this plan belongs to. A to-one association on the same
            // service, which is what a ReferenceFacet needs.
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'DispatchOrder',
                Target : 'fuel_order/@UI.FieldGroup#OrderDetails',
                Label  : 'Fuel Order'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'DispatchAdmin',
                Target : '@UI.FieldGroup#DispatchAdmin',
                Label  : 'Administration'
            }
        ],

        FieldGroup #RegulatedStack: {
            Data: [
                { Value: trip_fuel_kg,        Label: 'Trip Fuel (kg)',        ![@UI.Importance]: #High },
                { Value: contingency_fuel_kg, Label: 'Contingency (kg)',      ![@UI.Importance]: #High },
                { Value: alternate_fuel_kg,   Label: 'Alternate (kg)',        ![@UI.Importance]: #High },
                { Value: final_reserve_kg,    Label: 'Final Reserve (kg)',    ![@UI.Importance]: #High },
                { Value: taxi_fuel_kg,        Label: 'Taxi (kg)',             ![@UI.Importance]: #Medium },
                { Value: additional_fuel_kg,  Label: 'Additional (kg)',       ![@UI.Importance]: #Medium },
                { Value: extra_fuel_kg,       Label: 'Extra (kg)',            ![@UI.Importance]: #Medium },
                { Value: block_fuel_kg,       Label: 'Block Fuel (kg)',       ![@UI.Importance]: #High },
                { Value: required_uplift_kg,  Label: 'Required Uplift (kg)',  ![@UI.Importance]: #High }
            ]
        },

        FieldGroup #PlanVersion: {
            Data: [
                { Value: plan_group_id,       Label: 'Plan Family',           ![@UI.Importance]: #High },
                { Value: plan_version,        Label: 'Version',               ![@UI.Importance]: #High },
                { Value: plan_status,         Label: 'Status',                ![@UI.Importance]: #High },
                // Load-bearing: where the version is ASSIGNED on receipt a gap
                // cannot be detected at all, so version_gap_flag = false is
                // ambiguous without it.
                { Value: plan_version_source, Label: 'Version Source',        ![@UI.Importance]: #High },
                { Value: version_gap_flag,    Label: 'Version Gap',           ![@UI.Importance]: #Medium },
                { Value: versions_skipped,    Label: 'Versions Skipped',      ![@UI.Importance]: #Medium }
            ]
        },

        // --- Field Groups ---
        FieldGroup #DispatchID: {
            Data: [
                { Value: dispatch_order_id, Label: 'Dispatch Order ID' },
                { Value: flight_number, Label: 'Flight Number' },
                { Value: flight_date, Label: 'Flight Date' },
                { Value: dispatch_source, Label: 'Source' },
                { Value: ofplan_reference, Label: 'OFP Reference' }
            ]
        },

        FieldGroup #AircraftCrew: {
            Data: [
                { Value: tail_number, Label: 'Tail Number' },
                { Value: captain_id, Label: 'Captain ID' },
                { Value: dispatcher_id, Label: 'Dispatcher ID' }
            ]
        },

        FieldGroup #DispatchTiming: {
            Data: [
                { Value: atd, Label: 'Actual Time of Departure' },
                { Value: ata, Label: 'Actual Time of Arrival' },
                { Value: dispatch_timestamp, Label: 'Dispatch Timestamp' }
            ]
        },

        FieldGroup #DispatchQty: {
            Data: [
                { Value: dispatch_qty_kg, Label: 'Dispatch Quantity (kg)' },
                { Value: rob_departure_kg, Label: 'ROB at Departure (kg)' },
                { Value: payload_kg, Label: 'Payload Weight (kg)' }
            ]
        },

        FieldGroup #FlightData: {
            Data: [
                { Value: flight_level, Label: 'Flight Level' },
                { Value: wind_component, Label: 'Wind Component (knots)' },
                { Value: alternate_airport, Label: 'Alternate Airport' },
                { Value: remarks, Label: 'Remarks' }
            ]
        },

        FieldGroup #DispatchAdmin: {
            Data: [
                { Value: created_at, Label: 'Created At' },
                { Value: created_by, Label: 'Created By' },
                { Value: modified_at, Label: 'Modified At' },
                { Value: modified_by, Label: 'Modified By' }
            ]
        }
    }
);

// Flight Dispatch field-level annotations
annotate FuelOrderService.FlightDispatches with {
    ID                   @UI.Hidden;
    dispatch_order_id        @title: 'Dispatch Order ID';
    flight_number        @title: 'Flight Number';
    flight_date          @title: 'Flight Date';
    tail_number          @title: 'Tail Number';
    captain_id           @title: 'Captain ID';
    dispatcher_id        @title: 'Dispatcher ID';
    atd                  @title: 'ATD (UTC)';
    ata                  @title: 'ATA (UTC)';
    dispatch_timestamp   @title: 'Dispatch Time';
    dispatch_qty_kg      @title: 'Dispatch Qty (kg)';
    rob_departure_kg     @title: 'ROB Departure (kg)';
    payload_kg           @title: 'Payload (kg)';
    flight_level         @title: 'Flight Level';
    wind_component       @title: 'Wind Component';
    alternate_airport    @title: 'Alternate Airport';
    dispatch_source      @title: 'Dispatch Source';
    ofplan_reference     @title: 'OFP Reference';
    remarks              @title: 'Remarks' @UI.MultiLineText;
    created_at           @title: 'Created At' @Common.FieldControl: #ReadOnly;
    created_by           @title: 'Created By' @Common.FieldControl: #ReadOnly;
    modified_at          @title: 'Modified At' @Common.FieldControl: #ReadOnly;
    modified_by          @title: 'Modified By' @Common.FieldControl: #ReadOnly;
};

// Import action annotations
annotate FuelOrderService with @(
    Common.SideEffects #DispatchImport: {
        TargetEntities: [FlightDispatches]
    }
);

annotate FuelOrderService.importFlightDispatchExcel with (
    fileContent @title: 'Excel File'
                @Core.MediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                @Core.ContentDisposition.Filename: fileName
                @Core.ContentDisposition.Type: 'inline',
    fileName    @title: 'File Name'
                @UI.Hidden: true
);

// ============================================================================
// WP-UI-02 — LABELS FOR THE PHASE 1 FIELDS
//
// Supersedes the WP-UI-01 field-level block. Two changes beyond wording:
//
//   1. @title is now the ONLY label annotation. WP-UI-01 set @title AND
//      @Common.Label on the same fields, and @Common.Label wins in the
//      emitted EDMX — so every @title on those fields was dead text. Reading
//      the source would have shown the intended label while the screen showed
//      the other one.
//
//   2. Three labels are deliberate and must not be shortened or generalised:
//        FUEL_TICKETS.quantity_kg          Uplift by Meter (kg)
//        FUEL_DELIVERIES.fob_delta_kg      Uplift by Gauge (kg)
//        FUEL_DELIVERIES.recon_variance_kg Meter vs Gauge Variance (kg)
//      Together they say what the reconciliation is: two measurements of one
//      uplift, each named for what measured it, and the difference between
//      them. "Canonical Mass" and "FQIS Uplift" named the mechanism; these
//      name the meaning.
//
// "Fuel on Board" is written out rather than abbreviated to FOB, which is
// unambiguous to a mixed audience where FOB is not.
//
// Appended as self-contained `annotate ... with { }` blocks. A CDS annotation
// binds to whatever declaration follows it, so inserting into an existing
// block is the operation that silently reassigns one.
// ============================================================================

annotate FuelOrderService.FuelOrders with {
    ordered_quantity     @Measures.Unit: uom_code;
    uom_code             @title: 'Unit of Measure';
    ordered_quantity_kg  @title: 'Ordered Quantity (kg)'   @Common.FieldControl: #ReadOnly;
    conversion_density   @title: 'Conversion Density (kg/L)' @Common.FieldControl: #ReadOnly;
    conversion_source    @title: 'Density Source'          @Common.FieldControl: #ReadOnly;

    // Associations and audit fields. Not on the package list, but every one
    // of these renders somewhere and the underscored ones render as-is.
    flight               @title: 'Flight';
    airport              @title: 'Airport';
    supplier             @title: 'Supplier';
    contract             @title: 'Contract';
    product              @title: 'Product';
    uom                  @title: 'Unit of Measure';
    currency             @title: 'Currency';
    deliveries           @title: 'Deliveries';
    tickets              @title: 'Tickets';
};

annotate FuelOrderService.FuelTickets with {
    quantity         @Measures.Unit: uom_code  @title: 'Claimed Quantity';
    quantity_metered @Measures.Unit: uom_code  @title: 'Metered Quantity'
                     @Common.FieldControl: #ReadOnly;
    meter_start      @Measures.Unit: uom_code  @title: 'Meter Start';
    meter_end        @Measures.Unit: uom_code  @title: 'Meter End';
    uom_code         @title: 'Unit of Measure';

    density_value    @Measures.Unit: density_uom  @title: 'Density';
    density_uom      @title: 'Density Unit';
    density_basis    @title: 'Density Basis';
    density_temp_c   @title: 'Density Temperature (°C)';
    quantity_flag    @title: 'Quantity Basis';

    // One of the three. The meter's answer to "how much fuel went on".
    quantity_kg      @title: 'Uplift by Meter (kg)' @Common.FieldControl: #ReadOnly;

    batch_coa_ref    @title: 'Batch Certificate';
    ticket_source    @title: 'Ticket Source';
    match_status     @title: 'Match Status' @Common.FieldControl: #ReadOnly;

    order            @title: 'Fuel Order';
    delivery         @title: 'Delivery';
    created_at       @title: 'Created At';
    created_by       @title: 'Created By';
    modified_at      @title: 'Changed At';
    modified_by      @title: 'Changed By';
};

annotate FuelOrderService.FuelDeliveries with {
    aircraft_reg        @title: 'Aircraft Registration';
    delivered_quantity  @Measures.Unit: uom_code;
    uom_code            @title: 'Unit of Measure';
    delivery_method     @title: 'Delivery Method';

    fob_at_arrival_kg   @title: 'Fuel on Board at Arrival (kg)';
    fob_before_kg       @title: 'Fuel on Board Before Refuelling (kg)';
    fob_after_kg        @title: 'Fuel on Board After Refuelling (kg)';

    // The second of the three. The aircraft's own answer to the same
    // question the meter answered, which is why the wording is parallel.
    fob_delta_kg        @title: 'Uplift by Gauge (kg)' @Common.FieldControl: #ReadOnly;

    ground_burn_kg      @title: 'Ground Burn (kg)' @Common.FieldControl: #ReadOnly;
    fob_source          @title: 'Gauge Reading Source';
    fob_rounding_kg     @title: 'Gauge Rounding (kg)';

    // The third. Names both sides, so the number needs no explanation.
    recon_variance_kg   @title: 'Meter vs Gauge Variance (kg)' @Common.FieldControl: #ReadOnly;

    recon_status        @title: 'Reconciliation Status' @Common.FieldControl: #ReadOnly;
    supplier_count      @title: 'Supplier Count' @Common.FieldControl: #ReadOnly;

    order               @title: 'Fuel Order';
    sales_order         @title: 'Sales Order';
    created_at          @title: 'Created At';
    created_by          @title: 'Created By';
    modified_at         @title: 'Changed At';
    modified_by         @title: 'Changed By';
};

// ----------------------------------------------------------------------------
// Internal carriers. Not labelled, hidden.
//
// These five virtuals exist only to feed a Criticality: reference. Their value
// is an integer colour code, so a user-facing label would be inventing a
// meaning they do not have — "Status Criticality" describes the mechanism, not
// anything an operator wants in a column. Hidden instead, following the house
// treatment of ID and of canSubmit, which is already @UI.Hidden.
//
// Hiding a field does not stop it being read as a Criticality source.
// ----------------------------------------------------------------------------

annotate FuelOrderService.FuelOrders with {
    statusCriticality   @UI.Hidden;
    priorityCriticality @UI.Hidden;
};

annotate FuelOrderService.FuelDeliveries with {
    statusCriticality   @UI.Hidden;
    varianceCriticality @UI.Hidden;
};

// ----------------------------------------------------------------------------
// WP-18 — labels for the plan versioning and stack fields.
//
// Beyond WP-18's stated scope, and included because omitting them regresses a
// criterion that is already merged: WP-UI-02 requires that no field in these
// entities renders its technical name, and its harness failed on
// dispatch_plan_ID the moment the association was added. The FLIGHT_DISPATCH
// fields follow for the same reason — they are user-facing on the Flight
// Dispatch list.
// ----------------------------------------------------------------------------

annotate FuelOrderService.FuelOrders with {
    dispatch_plan @title: 'Dispatch Plan';
};

annotate FuelOrderService.FlightDispatches with {
    // The regulated stack. Additional and extra are labelled so the
    // distinction DSP454 protects is visible on screen, not just in the model.
    trip_fuel_kg          @title: 'Trip Fuel (kg)';
    contingency_fuel_kg   @title: 'Contingency Fuel (kg)';
    alternate_fuel_kg     @title: 'Alternate Fuel (kg)';
    final_reserve_kg      @title: 'Final Reserve (kg)';
    additional_fuel_kg    @title: 'Additional Fuel (kg)';
    taxi_fuel_kg          @title: 'Taxi Fuel (kg)';
    extra_fuel_kg         @title: 'Extra Fuel, Commander (kg)';

    // Derived, so read-only.
    block_fuel_kg         @title: 'Block Fuel (kg)'      @Common.FieldControl: #ReadOnly;
    required_uplift_kg    @title: 'Required Uplift (kg)' @Common.FieldControl: #ReadOnly;

    // Versioning. Every one of these is set by the import, never typed.
    plan_group_id         @title: 'Plan Family'          @Common.FieldControl: #ReadOnly;
    plan_version          @title: 'Plan Version'         @Common.FieldControl: #ReadOnly;
    plan_version_source   @title: 'Version Source'       @Common.FieldControl: #ReadOnly;
    plan_status           @title: 'Plan Status'          @Common.FieldControl: #ReadOnly;
    superseded_by         @title: 'Superseded By'        @Common.FieldControl: #ReadOnly;
    version_gap_flag      @title: 'Version Gap'          @Common.FieldControl: #ReadOnly;
    versions_skipped      @title: 'Versions Skipped'     @Common.FieldControl: #ReadOnly;
};

annotate FuelOrderService.FlightSchedule with {
    flight_leg_id         @title: 'Flight Leg ID'        @Common.FieldControl: #ReadOnly;
};

// ----------------------------------------------------------------------------
// WP-07B — labels for the tail association.
//
// Beyond the stated scope for the same reason as WP-18's: WP-UI-02 requires
// that no field in these entities render its technical name, and its harness
// failed on tail_registration the moment the association was added. A merged
// criterion is a merged criterion.
// ----------------------------------------------------------------------------

annotate FuelOrderService.FuelTickets    with { tail @title: 'Aircraft (Register)'; };
annotate FuelOrderService.FuelDeliveries with { tail @title: 'Aircraft (Register)'; };
annotate FuelOrderService.FlightSchedule with { tail @title: 'Aircraft (Register)'; };
annotate FuelOrderService.FlightDispatches with { tail @title: 'Aircraft (Register)'; };

// ============================================================================
// FuelOrderService projects AIRCRAFT_REGISTRATIONS and annotated it not at
// all, so `tail` on a ticket and on a delivery resolved and had nowhere to
// land.
//
// #RegistrationKey carries the SAME NAME AND THE SAME FOUR FACTS as
// BurnService's block. Deliberate: a reader moving between services should
// not find the aircraft described differently in each. Identical where the
// reader does not differ.
// ============================================================================
annotate FuelOrderService.AircraftRegistrations with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Aircraft',
            TypeNamePlural : 'Aircraft Register',
            Title          : { Value: registration },
            Description    : { Value: aircraft_type_code }
        },
        FieldGroup #RegistrationKey: {
            Data: [
                { Value: registration,       Label: 'Registration' },
                { Value: aircraft_type_code, Label: 'Type' },
                // PROVISIONAL blocks order creation (MDM402) and does not
                // block ticket capture. Both pages that reach this block are
                // capture pages.
                { Value: record_status,      Label: 'Record Status' },
                { Value: operator_code,      Label: 'Operator' }
            ]
        }
    }
);

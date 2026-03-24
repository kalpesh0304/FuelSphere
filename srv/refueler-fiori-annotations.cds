/**
 * FuelSphere - Refueler/Supplier Service Fiori Annotations
 *
 * UI Screens:
 * - SO-001: Sales Order Overview (List Report)
 * - SO-002: Sales Order Detail (Object Page)
 */

using RefuelerService from './refueler-service';

// ============================================================================
// SALES ORDERS - List Report (SO-001) and Object Page (SO-002)
// ============================================================================

annotate RefuelerService.SalesOrders with @(
    // ----------------------------------------------------------------------------
    // List Report Configuration (SO-001)
    // ----------------------------------------------------------------------------
    UI: {
        // Header Info for Object Page
        HeaderInfo: {
            TypeName       : 'Sales Order',
            TypeNamePlural : 'Sales Orders',
            Title          : { Value: sales_order_number },
            Description    : { Value: customer_airline }
        },

        // Selection Fields for Filter Bar
        SelectionFields: [
            station_code,
            customer_airline_code,
            status,
            scheduled_date
        ],

        // Line Item columns for List Report table
        LineItem: [
            { Value: sales_order_number, Label: 'Sales Order #', ![@UI.Importance]: #High },
            { Value: customer_airline, Label: 'Customer Airline', ![@UI.Importance]: #High },
            { Value: flight_number, Label: 'Flight', ![@UI.Importance]: #High },
            { Value: flight_date, Label: 'Flight Date', ![@UI.Importance]: #Medium },
            { Value: station_code, Label: 'Station', ![@UI.Importance]: #High },
            { Value: estimated_quantity, Label: 'Estimated Qty (kg)', ![@UI.Importance]: #Medium },
            { Value: delivered_quantity, Label: 'Delivered Qty (kg)', ![@UI.Importance]: #High },
            {
                Value: status,
                Label: 'Status',
                Criticality: statusCriticality,
                ![@UI.Importance]: #High
            },
            { Value: scheduled_date, Label: 'Scheduled Date', ![@UI.Importance]: #Medium }
        ],

        // Presentation Variant for default sorting
        PresentationVariant: {
            SortOrder: [
                { Property: scheduled_date, Descending: true },
                { Property: sales_order_number, Descending: true }
            ],
            Visualizations: [
                '@UI.LineItem'
            ]
        },

        // ----------------------------------------------------------------------------
        // Object Page Configuration (SO-002)
        // ----------------------------------------------------------------------------

        // Header Facets (Key facts displayed in header)
        HeaderFacets: [
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#Status',
                Label  : 'Status'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#Quantities',
                Label  : 'Quantities'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#TotalAmount',
                Label  : 'Amount'
            }
        ],

        // Data Points for Header
        DataPoint#Status: {
            Value: status,
            Title: 'Status',
            Criticality: statusCriticality
        },

        DataPoint#Quantities: {
            Value: delivered_quantity,
            Title: 'Delivered Quantity (kg)'
        },

        DataPoint#TotalAmount: {
            Value: total_amount,
            Title: 'Total Amount'
        },

        // Object Page Facets (Sections)
        Facets: [
            // Section 1: Customer Information
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#CustomerInfo',
                Label  : 'Customer Information'
            },
            // Section 2: Fuel Quantities
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#Quantities',
                Label  : 'Fuel Quantities'
            },
            // Section 3: Delivery Planning
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#DeliveryPlanning',
                Label  : 'Delivery Planning'
            },
            // Section 4: Pricing
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#Pricing',
                Label  : 'Pricing & Revenue'
            },
            // Section 5: Invoice
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#Invoice',
                Label  : 'Invoice'
            },
            // Section 6: Delivery Records (Composition)
            {
                $Type  : 'UI.ReferenceFacet',
                Target : 'delivery_records/@UI.LineItem',
                Label  : 'Delivery Records'
            },
            // Section 7: Administration
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#Administration',
                Label  : 'Administration'
            }
        ],

        // Field Group: Customer Information
        FieldGroup#CustomerInfo: {
            Label: 'Customer Information',
            Data: [
                { Value: customer_airline, Label: 'Customer Airline' },
                { Value: customer_airline_code, Label: 'Airline Code' },
                { Value: customer_order_number, Label: 'Customer PO Number' },
                { Value: flight_number, Label: 'Flight Number' },
                { Value: flight_date, Label: 'Flight Date' }
            ]
        },

        // Field Group: Fuel Quantities
        FieldGroup#Quantities: {
            Label: 'Fuel Quantities',
            Data: [
                { Value: estimated_quantity, Label: 'Estimated Quantity (kg)' },
                { Value: requested_quantity, Label: 'Requested Quantity (kg)' },
                { Value: crew_confirmed_qty, Label: 'Crew Confirmed Qty (kg)' },
                { Value: delivered_quantity, Label: 'Delivered Quantity (kg)' }
            ]
        },

        // Field Group: Delivery Planning
        FieldGroup#DeliveryPlanning: {
            Label: 'Delivery Planning',
            Data: [
                { Value: scheduled_date, Label: 'Scheduled Date' },
                { Value: scheduled_time, Label: 'Scheduled Time' },
                { Value: vehicle_id, Label: 'Vehicle/Bowser ID' },
                { Value: driver_name, Label: 'Driver Name' }
            ]
        },

        // Field Group: Pricing
        FieldGroup#Pricing: {
            Label: 'Pricing & Revenue',
            Data: [
                { Value: unit_price, Label: 'Unit Price' },
                { Value: total_amount, Label: 'Total Amount' },
                { Value: currency_code, Label: 'Currency' }
            ]
        },

        // Field Group: Invoice
        FieldGroup#Invoice: {
            Label: 'Invoice',
            Data: [
                { Value: invoice_number, Label: 'Invoice Number' },
                { Value: invoice_date, Label: 'Invoice Date' },
                { Value: invoice_amount, Label: 'Invoice Amount' }
            ]
        },

        // Field Group: Administration
        FieldGroup#Administration: {
            Label: 'Administration',
            Data: [
                { Value: created_at, Label: 'Created At' },
                { Value: created_by, Label: 'Created By' },
                { Value: modified_at, Label: 'Modified At' },
                { Value: modified_by, Label: 'Modified By' }
            ]
        },

        // Object page action buttons
        Identification: [
            {
                $Type : 'UI.DataFieldForAction',
                Action : 'RefuelerService.confirmOrder',
                Label : 'Confirm Order',
                ![@UI.Importance] : #High
            },
            {
                $Type : 'UI.DataFieldForAction',
                Action : 'RefuelerService.scheduleDelivery',
                Label : 'Schedule Delivery',
                ![@UI.Importance] : #High
            },
            {
                $Type : 'UI.DataFieldForAction',
                Action : 'RefuelerService.recordDelivery',
                Label : 'Record Delivery',
                ![@UI.Importance] : #High
            },
            {
                $Type : 'UI.DataFieldForAction',
                Action : 'RefuelerService.createInvoice',
                Label : 'Create Invoice',
                ![@UI.Importance] : #High
            }
        ],
    }
);

// Status text arrangement
annotate RefuelerService.SalesOrders with {
    status @Common.Text: {
        $value: status,
        ![@UI.TextArrangement]: #TextOnly
    };
};

// Field-level annotations for SalesOrders
annotate RefuelerService.SalesOrders with {
    ID                    @UI.Hidden;
    sales_order_number    @title: 'Sales Order #'          @Common.FieldControl: #ReadOnly;
    customer_airline      @title: 'Customer Airline'       @mandatory;
    customer_airline_code @title: 'Airline Code';
    customer_order_number @title: 'Customer PO #';
    flight_number         @title: 'Flight';
    flight_date           @title: 'Flight Date';
    station_code          @title: 'Station'                @mandatory;
    estimated_quantity    @title: 'Estimated Qty (kg)';
    requested_quantity    @title: 'Requested Qty (kg)';
    crew_confirmed_qty    @title: 'Crew Confirmed Qty (kg)';
    delivered_quantity    @title: 'Delivered Qty (kg)'      @Common.FieldControl: #ReadOnly;
    unit_price            @title: 'Unit Price'             @Measures.ISOCurrency: currency_code;
    total_amount          @title: 'Total Amount'           @Measures.ISOCurrency: currency_code  @Common.FieldControl: #ReadOnly;
    currency_code         @title: 'Currency';
    scheduled_date        @title: 'Scheduled Date';
    scheduled_time        @title: 'Scheduled Time';
    vehicle_id            @title: 'Vehicle/Bowser ID';
    driver_name           @title: 'Driver Name';
    status                @title: 'Status'                 @Common.FieldControl: #ReadOnly;
    confirmed_at          @title: 'Confirmed At'           @Common.FieldControl: #ReadOnly;
    delivered_at          @title: 'Delivered At'            @Common.FieldControl: #ReadOnly;
    invoiced_at           @title: 'Invoiced At'            @Common.FieldControl: #ReadOnly;
    invoice_number        @title: 'Invoice #'              @Common.FieldControl: #ReadOnly;
    invoice_date          @title: 'Invoice Date'           @Common.FieldControl: #ReadOnly;
    invoice_amount        @title: 'Invoice Amount'         @Measures.ISOCurrency: currency_code  @Common.FieldControl: #ReadOnly;
    notes                 @title: 'Notes'                  @UI.MultiLineText;
    created_at            @title: 'Created At'             @Common.FieldControl: #ReadOnly;
    created_by            @title: 'Created By'             @Common.FieldControl: #ReadOnly;
    modified_at           @title: 'Modified At'            @Common.FieldControl: #ReadOnly;
    modified_by           @title: 'Modified By'            @Common.FieldControl: #ReadOnly;
};

// Value Help for associations
annotate RefuelerService.SalesOrders with {
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
};

// ============================================================================
// DELIVERY RECORDS - Embedded Line Item in Sales Order Object Page
// ============================================================================

annotate RefuelerService.DeliveryRecords with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Delivery Record',
            TypeNamePlural : 'Delivery Records',
            Title          : { Value: delivery_number },
            Description    : { Value: delivery_date }
        },

        LineItem: [
            { Value: delivery_number, Label: 'Delivery #', ![@UI.Importance]: #High },
            { Value: delivery_date, Label: 'Date', ![@UI.Importance]: #High },
            { Value: delivery_time, Label: 'Time', ![@UI.Importance]: #Medium },
            { Value: delivered_quantity, Label: 'Quantity (kg)', ![@UI.Importance]: #High },
            { Value: temperature, Label: 'Temp (C)', ![@UI.Importance]: #Medium },
            { Value: density, Label: 'Density (kg/L)', ![@UI.Importance]: #Medium },
            {
                Value: status,
                Label: 'Status',
                Criticality: statusCriticality,
                ![@UI.Importance]: #High
            },
            { Value: vehicle_id, Label: 'Vehicle ID', ![@UI.Importance]: #Low },
            { Value: driver_name, Label: 'Driver', ![@UI.Importance]: #Low },
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

        FieldGroup#Variance: {
            Label: 'Variance',
            Data: [
                { Value: quantity_variance, Label: 'Quantity Variance' },
                { Value: variance_percentage, Label: 'Variance %' },
                { Value: variance_flag, Label: 'Variance Flag' },
                { Value: variance_reason, Label: 'Variance Reason' }
            ]
        }
    }
);

// Field-level annotations for DeliveryRecords
annotate RefuelerService.DeliveryRecords with {
    ID                       @UI.Hidden;
    delivery_number          @title: 'Delivery #'                @Common.FieldControl: #ReadOnly;
    delivery_date            @title: 'Delivery Date';
    delivery_time            @title: 'Delivery Time';
    delivered_quantity       @title: 'Delivered Qty (kg)';
    temperature              @title: 'Temperature (C)';
    density                  @title: 'Density (kg/L)';
    temperature_corrected_qty @title: 'Temp Corrected Qty (kg)'  @Common.FieldControl: #ReadOnly;
    vehicle_id               @title: 'Vehicle ID';
    driver_name              @title: 'Driver Name';
    pilot_name               @title: 'Pilot Name';
    ground_crew_name         @title: 'Ground Crew Name';
    signature_timestamp      @title: 'Signature Time'            @Common.FieldControl: #ReadOnly;
    signature_location       @title: 'Location';
    status                   @title: 'Status'                    @Common.FieldControl: #ReadOnly;
    quantity_variance        @title: 'Quantity Variance'         @Common.FieldControl: #ReadOnly;
    variance_percentage      @title: 'Variance %'               @Common.FieldControl: #ReadOnly;
    variance_flag            @title: 'Variance Flag'             @Common.FieldControl: #ReadOnly;
    variance_reason          @title: 'Variance Reason'           @UI.MultiLineText;
};

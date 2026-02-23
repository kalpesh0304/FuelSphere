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

        // Selection Fields for Filter Bar (from FuelOrderOverview filter fields)
        SelectionFields: [
            station_code,
            supplier_ID,
            status,
            delivery_status,
            epod_status,
            priority,
            requested_date,
            product_ID
        ],

        // Line Item columns for List Report table (from FuelOrderOverview columns)
        LineItem: [
            { Value: order_number, Label: 'Fuel Order ID', ![@UI.Importance]: #High },
            { Value: flight.flight_number, Label: 'Flight', ![@UI.Importance]: #High },
            { Value: flight.aircraft_reg, Label: 'Tail', ![@UI.Importance]: #Medium },
            { Value: station_code, Label: 'Station', ![@UI.Importance]: #High },
            { Value: flight.aircraft_type, Label: 'Aircraft', ![@UI.Importance]: #Medium },
            { Value: requested_date, Label: 'Order Date', ![@UI.Importance]: #High },
            { Value: pilot_name, Label: 'Pilot', ![@UI.Importance]: #Medium },
            { Value: supplier.supplier_name, Label: 'Supplier', ![@UI.Importance]: #High },
            { Value: ordered_quantity, Label: 'Uplift Qty (kg)', ![@UI.Importance]: #High },
            {
                Value: delivery_status,
                Label: 'Delivery Status',
                Criticality: deliveryStatusCriticality,
                ![@UI.Importance]: #High
            },
            {
                Value: epod_status,
                Label: 'ePOD Status',
                Criticality: epodStatusCriticality,
                ![@UI.Importance]: #Medium
            },
            {
                $Type: 'UI.DataField',
                Value: completion_percent,
                Label: 'Completion',
                Criticality: completionCriticality,
                ![@UI.Importance]: #Medium
            },
            { Value: total_amount, Label: 'Total Amount', ![@UI.Importance]: #Low },
            { Value: priority, Label: 'Priority', Criticality: priorityCriticality, ![@UI.Importance]: #Low }
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

        // Object Page Facets - 8-section layout matching FuelOrderDetailView
        // Sections: Flight Info | Pilot Approval | Fuel Order | Pricing | Delivery | ePOD & PO/GR | Timeline | Documents
        Facets: [
            // Section 1: Flight & Aircraft Information
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'FlightInfoSection',
                Label  : 'Flight Info',
                Facets : [
                    {
                        $Type  : 'UI.ReferenceFacet',
                        Target : '@UI.FieldGroup#FlightDetails',
                        Label  : 'Flight Details'
                    },
                    {
                        $Type  : 'UI.ReferenceFacet',
                        Target : '@UI.FieldGroup#RouteInfo',
                        Label  : 'Route Information'
                    },
                    {
                        $Type  : 'UI.ReferenceFacet',
                        Target : '@UI.FieldGroup#AircraftInfo',
                        Label  : 'Aircraft Information'
                    }
                ]
            },
            // Section 2: Pilot Approval & Dispatch Calculation
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'PilotApprovalSection',
                Label  : 'Pilot Approval',
                Facets : [
                    {
                        $Type  : 'UI.ReferenceFacet',
                        Target : '@UI.FieldGroup#PilotInfo',
                        Label  : 'Pilot Information'
                    },
                    {
                        $Type  : 'UI.ReferenceFacet',
                        Target : '@UI.FieldGroup#PilotApproval',
                        Label  : 'Pilot Buffer & Final Approval'
                    }
                ]
            },
            // Section 3: Fuel Order Details
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'FuelOrderSection',
                Label  : 'Fuel Order',
                Facets : [
                    {
                        $Type  : 'UI.ReferenceFacet',
                        Target : '@UI.FieldGroup#OrderDetails',
                        Label  : 'Order Details'
                    },
                    {
                        $Type  : 'UI.ReferenceFacet',
                        Target : '@UI.FieldGroup#StationSupplier',
                        Label  : 'Station & Supplier'
                    },
                    {
                        $Type  : 'UI.ReferenceFacet',
                        Target : '@UI.FieldGroup#SupplierContact',
                        Label  : 'Supplier Contact'
                    },
                    {
                        $Type  : 'UI.ReferenceFacet',
                        Target : '@UI.FieldGroup#QuantityPricing',
                        Label  : 'Quantity & Pricing'
                    },
                    {
                        $Type  : 'UI.ReferenceFacet',
                        Target : '@UI.FieldGroup#DeliveryLocation',
                        Label  : 'Delivery Location'
                    }
                ]
            },
            // Section 4: Pricing (CPE + PO)
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'PricingSection',
                Label  : 'Pricing',
                Facets : [
                    {
                        $Type  : 'UI.ReferenceFacet',
                        Target : '@UI.FieldGroup#PricingDetails',
                        Label  : 'Pricing Details'
                    },
                    {
                        $Type  : 'UI.ReferenceFacet',
                        Target : '@UI.FieldGroup#S4References',
                        Label  : 'S/4HANA References'
                    },
                    {
                        $Type  : 'UI.ReferenceFacet',
                        Target : '@UI.FieldGroup#S4SyncStatus',
                        Label  : 'Sync Status'
                    }
                ]
            },
            // Section 5: Delivery
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'DeliverySection',
                Label  : 'Delivery',
                Facets : [
                    {
                        $Type  : 'UI.ReferenceFacet',
                        Target : '@UI.FieldGroup#DeliveryAssignment',
                        Label  : 'Delivery Summary'
                    },
                    {
                        $Type  : 'UI.ReferenceFacet',
                        Target : '@UI.FieldGroup#DispatchDetails',
                        Label  : 'Supplier Dispatch'
                    },
                    {
                        $Type  : 'UI.ReferenceFacet',
                        Target : 'deliveries/@UI.LineItem',
                        Label  : 'Delivery Trucks'
                    }
                ]
            },
            // Section 6: ePOD & PO/GR
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'EPodSection',
                Label  : 'ePOD & PO/GR',
                Facets : [
                    {
                        $Type  : 'UI.ReferenceFacet',
                        Target : '@UI.FieldGroup#EPodInfo',
                        Label  : 'Electronic Proof of Delivery'
                    },
                    {
                        $Type  : 'UI.ReferenceFacet',
                        Target : 'tickets/@UI.LineItem',
                        Label  : 'Fuel Tickets'
                    }
                ]
            },
            // Section 7: Timeline (Milestones)
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'TimelineSection',
                Target : 'milestones/@UI.LineItem',
                Label  : 'Timeline'
            },
            // Section 8: Documents & History
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'DocumentsSection',
                Label  : 'Documents',
                Facets : [
                    {
                        $Type  : 'UI.ReferenceFacet',
                        Target : '@UI.FieldGroup#Documents',
                        Label  : 'Documents & Attachments'
                    },
                    {
                        $Type  : 'UI.ReferenceFacet',
                        Target : '@UI.FieldGroup#ApprovalInfo',
                        Label  : 'Approval'
                    },
                    {
                        $Type  : 'UI.ReferenceFacet',
                        Target : '@UI.FieldGroup#Administrative',
                        Label  : 'Audit Log'
                    }
                ]
            }
        ],

        // ================================================================
        // Section 1: Flight & Aircraft Information (FuelOrderDetailView)
        // ================================================================

        // Field Group: Flight Details
        FieldGroup#FlightDetails: {
            Label: 'Flight Details',
            Data: [
                { Value: flight.flight_number, Label: 'Flight Number' },
                { Value: flight.aircraft_reg, Label: 'Tail Number' },
                { Value: flight.flight_date, Label: 'Departure Date' },
                { Value: flight.scheduled_departure, Label: 'Departure Time' }
            ]
        },

        // Field Group: Route Information
        FieldGroup#RouteInfo: {
            Label: 'Route Information',
            Data: [
                { Value: flight.origin_airport, Label: 'Origin' },
                { Value: flight.destination_airport, Label: 'Destination' },
                { Value: station_code, Label: 'Station Code' }
            ]
        },

        // Field Group: Aircraft Information
        FieldGroup#AircraftInfo: {
            Label: 'Aircraft Information',
            Data: [
                { Value: flight.aircraft_type, Label: 'Aircraft Type' },
                { Value: flight.aircraft_reg, Label: 'Registration' }
            ]
        },

        // ================================================================
        // Section 2: Pilot Approval (FuelOrderDetailView)
        // ================================================================

        // Field Group: Pilot Information
        FieldGroup#PilotInfo: {
            Label: 'Pilot Information',
            Data: [
                { Value: pilot_name, Label: 'Pilot Name' },
                { Value: pilot_id, Label: 'Pilot ID' },
                { Value: pilot_license, Label: 'License Number' },
                { Value: calculation_id, Label: 'Calculation ID' },
                { Value: calculation_timestamp, Label: 'Calculated At' }
            ]
        },

        // Field Group: Pilot Buffer & Final Approval
        FieldGroup#PilotApproval: {
            Label: 'Pilot Buffer & Final Approval',
            Data: [
                { Value: planned_quantity, Label: 'Minimum Required (kg)' },
                { Value: pilot_buffer, Label: 'Pilot Buffer (kg)' },
                { Value: pilot_buffer_reason, Label: 'Buffer Reason' },
                { Value: final_approved_quantity, Label: 'Final Approved (kg)' },
                { Value: rob_opening, Label: 'ROB Opening (kg)' },
                { Value: ordered_quantity, Label: 'Uplift Needed (kg)' }
            ]
        },

        // ================================================================
        // Section 3: Fuel Order Details
        // ================================================================

        // Field Group: Order Details
        FieldGroup#OrderDetails: {
            Label: 'Order Details',
            Data: [
                { Value: order_number, Label: 'Order ID' },
                { Value: requested_date, Label: 'Order Date' },
                { Value: requested_time, Label: 'Order Time' },
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

        // Field Group: Delivery Location (from FuelOrderDetailView)
        FieldGroup#DeliveryLocation: {
            Label: 'Delivery Location',
            Data: [
                { Value: airport.airport_name, Label: 'Airport' },
                { Value: delivery_stand, Label: 'Stand / Gate' },
                { Value: delivery_fuel_pit, Label: 'Fuel Pit' },
                { Value: delivery_window_start, Label: 'Window Start' },
                { Value: delivery_window_end, Label: 'Window End' }
            ]
        },

        // Field Group: Supplier Contact (from FuelRequestDetail UI)
        FieldGroup#SupplierContact: {
            Label: 'Supplier Contact',
            Data: [
                { Value: supplier.contact_email, Label: 'Email' },
                { Value: supplier.contact_phone, Label: 'Phone' },
                { Value: supplier.address, Label: 'Address' },
                { Value: supplier.city, Label: 'City' },
                { Value: supplier.country_code, Label: 'Country' }
            ]
        },

        // Field Group: S/4HANA References
        FieldGroup#S4References: {
            Label: 'S/4HANA References',
            Data: [
                { Value: s4_pr_number, Label: 'Purchase Requisition' },
                { Value: s4_po_number, Label: 'Purchase Order' },
                { Value: s4_po_item, Label: 'PO Item' },
                { Value: plant_code, Label: 'Plant Code' }
            ]
        },

        // Field Group: S/4 Sync Status (from FuelRequestDetail UI)
        FieldGroup#S4SyncStatus: {
            Label: 'Sync Status',
            Data: [
                { Value: s4_sync_status, Label: 'Sync Status' },
                { Value: s4_sync_timestamp, Label: 'Last Sync' }
            ]
        },

        // Field Group: Delivery Summary (from FuelOrderDetailView - Delivery section)
        FieldGroup#DeliveryAssignment: {
            Label: 'Delivery Summary',
            Data: [
                { Value: delivery_status, Label: 'Delivery Status' },
                { Value: truck_assigned, Label: 'Truck / Vehicle ID' },
                { Value: operator_name, Label: 'Operator / Driver' },
                { Value: ordered_quantity, Label: 'Ordered Quantity (kg)' },
                { Value: actual_quantity, Label: 'Delivered Quantity (kg)' },
                { Value: completion_percent, Label: 'Completion %' }
            ]
        },

        // Field Group: Supplier Dispatch Details (from FuelRequestDetailSAP UI)
        FieldGroup#DispatchDetails: {
            Label: 'Supplier Dispatch',
            Data: [
                { Value: dispatch_method, Label: 'Dispatch Method' },
                { Value: dispatch_transaction_id, Label: 'Transaction ID' },
                { Value: dispatch_acknowledgment_id, Label: 'Acknowledgment ID' },
                { Value: dispatch_timestamp, Label: 'Dispatched At' },
                { Value: dispatch_response_code, Label: 'Response Code' }
            ]
        },

        // Field Group: Pricing Details (from FuelRequestDetailSAP - Pricing tab)
        FieldGroup#PricingDetails: {
            Label: 'Pricing Details',
            Data: [
                { Value: unit_price, Label: 'Unit Price' },
                { Value: total_amount, Label: 'Total Amount' },
                { Value: currency_code, Label: 'Currency' },
                { Value: actual_quantity, Label: 'Delivered Quantity (kg)' },
                { Value: ordered_quantity, Label: 'Ordered Quantity (kg)' }
            ]
        },

        // ================================================================
        // Section 6: ePOD & PO/GR (FuelOrderDetailView)
        // ================================================================

        // Field Group: ePOD Information
        FieldGroup#EPodInfo: {
            Label: 'Electronic Proof of Delivery',
            Data: [
                { Value: epod_status, Label: 'ePOD Status' },
                { Value: actual_quantity, Label: 'Delivered Quantity (kg)' },
                { Value: s4_po_number, Label: 'PO Number (Auto-Created)' },
                { Value: s4_po_item, Label: 'PO Item' },
                { Value: s4_pr_number, Label: 'PR Number' },
                { Value: plant_code, Label: 'Plant Code' }
            ]
        },

        // ================================================================
        // Section 8: Documents & History
        // ================================================================

        // Field Group: Documents (placeholder for future document attachments)
        FieldGroup#Documents: {
            Label: 'Documents & Attachments',
            Data: [
                { Value: notes, Label: 'Order Notes' },
                { Value: override_reason, Label: 'Override Reason' }
            ]
        },

        // Field Group: Approval Info (from FuelRequestApprovalQueue / History tab)
        FieldGroup#ApprovalInfo: {
            Label: 'Approval',
            Data: [
                { Value: approved_by, Label: 'Approved By' },
                { Value: approved_at, Label: 'Approved At' },
                { Value: approval_comment, Label: 'Approval Comment' },
                { Value: rejected_reason, Label: 'Rejection Reason' }
            ]
        },

        // Field Group: Administrative / History
        FieldGroup#Administrative: {
            Label: 'History',
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
    actual_quantity @title: 'Actual Quantity (kg)' @Common.FieldControl: #ReadOnly;
    completion_percent @title: 'Completion %' @Common.FieldControl: #ReadOnly;
    s4_pr_number    @title: 'Purchase Requisition' @Common.FieldControl: #ReadOnly;
    plant_code      @title: 'Plant Code' @Common.FieldControl: #ReadOnly;
    s4_sync_status  @title: 'S/4 Sync Status' @Common.FieldControl: #ReadOnly;
    s4_sync_timestamp @title: 'Last S/4 Sync' @Common.FieldControl: #ReadOnly;
    dispatch_method @title: 'Dispatch Method' @Common.FieldControl: #ReadOnly;
    dispatch_transaction_id @title: 'Transaction ID' @Common.FieldControl: #ReadOnly;
    dispatch_acknowledgment_id @title: 'Acknowledgment ID' @Common.FieldControl: #ReadOnly;
    dispatch_timestamp @title: 'Dispatched At' @Common.FieldControl: #ReadOnly;
    dispatch_response_code @title: 'Response Code' @Common.FieldControl: #ReadOnly;
    truck_assigned  @title: 'Truck / Vehicle ID';
    operator_name   @title: 'Operator / Driver';
    approved_by     @title: 'Approved By' @Common.FieldControl: #ReadOnly;
    approved_at     @title: 'Approved At' @Common.FieldControl: #ReadOnly;
    approval_comment @title: 'Approval Comment' @UI.MultiLineText @Common.FieldControl: #ReadOnly;
    rejected_reason @title: 'Rejection Reason' @UI.MultiLineText @Common.FieldControl: #ReadOnly;
    pilot_name      @title: 'Pilot Name';
    pilot_id        @title: 'Pilot ID' @Common.FieldControl: #ReadOnly;
    pilot_license   @title: 'License Number' @Common.FieldControl: #ReadOnly;
    pilot_buffer    @title: 'Pilot Buffer (kg)' @Common.FieldControl: #ReadOnly;
    pilot_buffer_reason @title: 'Buffer Reason' @Common.FieldControl: #ReadOnly;
    final_approved_quantity @title: 'Final Approved (kg)' @Common.FieldControl: #ReadOnly;
    rob_opening     @title: 'ROB Opening (kg)' @Common.FieldControl: #ReadOnly;
    calculation_id  @title: 'Calculation ID' @Common.FieldControl: #ReadOnly;
    calculation_timestamp @title: 'Calculated At' @Common.FieldControl: #ReadOnly;
    delivery_status @title: 'Delivery Status';
    epod_status     @title: 'ePOD Status' @Common.FieldControl: #ReadOnly;
    delivery_stand  @title: 'Stand / Gate';
    delivery_fuel_pit @title: 'Fuel Pit';
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

// ============================================================================
// FUEL ORDER MILESTONES - Status Timeline (from FuelRequestDetail/SAP UI)
// ============================================================================

annotate FuelOrderService.FuelOrderMilestones with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Milestone',
            TypeNamePlural : 'Milestones',
            Title          : { Value: milestone_type },
            Description    : { Value: milestone_timestamp }
        },

        // LineItem for milestones table (timeline view)
        LineItem: [
            { Value: milestone_sequence, Label: 'Step', ![@UI.Importance]: #High },
            { Value: milestone_type, Label: 'Milestone', ![@UI.Importance]: #High },
            { Value: milestone_timestamp, Label: 'Date/Time', ![@UI.Importance]: #High },
            { Value: performed_by, Label: 'Performed By', ![@UI.Importance]: #Medium },
            { Value: is_system_generated, Label: 'System', ![@UI.Importance]: #Low },
            { Value: notes, Label: 'Notes', ![@UI.Importance]: #Medium },
            { Value: external_reference, Label: 'Reference', ![@UI.Importance]: #Low }
        ],

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#MilestoneDetails',
                Label  : 'Milestone Details'
            }
        ],

        FieldGroup#MilestoneDetails: {
            Label: 'Milestone Details',
            Data: [
                { Value: milestone_type, Label: 'Type' },
                { Value: milestone_sequence, Label: 'Sequence' },
                { Value: milestone_timestamp, Label: 'Timestamp' },
                { Value: performed_by, Label: 'Performed By' },
                { Value: is_system_generated, Label: 'System Generated' },
                { Value: notes, Label: 'Notes' },
                { Value: external_reference, Label: 'External Reference' }
            ]
        }
    }
);

annotate FuelOrderService.FuelOrderMilestones with {
    ID                  @UI.Hidden;
    milestone_type      @title: 'Milestone';
    milestone_sequence  @title: 'Step' @Common.FieldControl: #ReadOnly;
    milestone_timestamp @title: 'Date/Time' @Common.FieldControl: #ReadOnly;
    performed_by        @title: 'Performed By' @Common.FieldControl: #ReadOnly;
    is_system_generated @title: 'System Generated' @Common.FieldControl: #ReadOnly;
    notes               @title: 'Notes' @UI.MultiLineText;
    external_reference  @title: 'Reference' @Common.FieldControl: #ReadOnly;
};

// ============================================================================
// SUPPLIER - Field-level annotations for contact fields
// ============================================================================

annotate FuelOrderService.Suppliers with {
    contact_email   @title: 'Contact Email';
    contact_phone   @title: 'Contact Phone';
    address         @title: 'Address';
    city            @title: 'City';
};

/**
 * FuelSphere - Fuel Order Service (FDD-04)
 *
 * Manages the complete fuel ordering lifecycle:
 * - Fuel order creation and management
 * - ePOD (Electronic Proof of Delivery) processing
 * - Fuel ticket management
 * - S/4HANA PO/GR integration triggers
 *
 * Key Innovation: ePOD-triggered PO/GR creation
 * - Purchase Orders and Goods Receipts are created in S/4HANA
 *   only after dual digital signatures are captured on ePOD
 *
 * Service Path: /odata/v4/orders
 */

using { fuelsphere as db } from '../db/schema';

@path: '/odata/v4/orders'
service FuelOrderService {

    // ========================================================================
    // CORE ENTITIES - Fuel Orders
    // ========================================================================

    /**
     * FuelOrders - Main fuel order entity
     * Draft-enabled for save-as-draft functionality
     *
     * Access:
     * - Station Coordinator: Create/Edit for own stations
     * - Operations Manager: Full access
     * - Finance Controller: Read-only
     */
    @odata.draft.enabled
    entity FuelOrders as projection on db.FUEL_ORDERS {
        *,
        flight      : redirected to Flights,
        airport     : redirected to Airports,
        supplier    : redirected to Suppliers,
        contract    : redirected to Contracts,
        product     : redirected to Products,
        uom         : redirected to UnitsOfMeasure,
        deliveries  : redirected to FuelDeliveries,
        tickets     : redirected to FuelTickets
    } actions {
        /**
         * Submit order to supplier
         * Transitions: Draft → Submitted
         * Triggers supplier dispatch via SAP CPI
         */
        action submit() returns FuelOrders;

        /**
         * Confirm order received by supplier
         * Transitions: Submitted → Confirmed
         */
        action confirm() returns FuelOrders;

        /**
         * Mark order as in progress (delivery started)
         * Transitions: Confirmed → InProgress
         */
        action startDelivery() returns FuelOrders;

        /**
         * Cancel order
         * Transitions: Draft/Submitted/Confirmed → Cancelled
         * Requires reason for non-draft orders
         */
        action cancel(reason: String) returns FuelOrders;

        /**
         * Calculate pricing from CPE
         * Returns unit price based on contract, product, and date
         */
        function calculatePrice() returns PricingResult;
    };

    // ========================================================================
    // EPOD (Electronic Proof of Delivery)
    // ========================================================================

    /**
     * FuelDeliveries - ePOD records
     *
     * Key Feature: Dual digital signatures trigger PO/GR creation
     * - pilotSignature + groundCrewSignature → captureSignatures action
     * - This automatically creates PO and GR in S/4HANA
     */
    entity FuelDeliveries as projection on db.FUEL_DELIVERIES {
        *,
        order : redirected to FuelOrders
    } actions {
        /**
         * Capture dual digital signatures
         * Triggers S/4HANA PO and GR creation
         * Updates parent order status to Delivered
         */
        action captureSignatures(
            pilotName           : String,
            pilotSignature      : LargeBinary,
            groundCrewName      : String,
            groundCrewSignature : LargeBinary,
            signatureLocation   : String
        ) returns SignatureResult;

        /**
         * Verify delivery quantities
         * Calculates variance and sets flag if > 5%
         */
        action verifyQuantity() returns FuelDeliveries;

        /**
         * Dispute delivery
         * Transitions: Pending/Verified → Disputed
         */
        action dispute(reason: String) returns FuelDeliveries;
    };

    // ========================================================================
    // FUEL TICKETS
    // ========================================================================

    /**
     * FuelTickets - Individual fuel ticket records
     *
     * Multiple tickets may be associated with a single order/delivery
     */
    entity FuelTickets as projection on db.FUEL_TICKETS {
        *,
        order    : redirected to FuelOrders,
        delivery : redirected to FuelDeliveries
    } actions {
        /**
         * Attach ticket to delivery
         */
        action attachToDelivery(deliveryId: UUID) returns FuelTickets;

        /**
         * Verify ticket
         */
        action verify() returns FuelTickets;
    };

    // ========================================================================
    // FLIGHT SCHEDULE (Read from Master Data)
    // ========================================================================

    /**
     * Flights - Read-only access to flight schedule
     * Used for linking orders to specific flights
     */
    @readonly
    entity Flights as projection on db.FLIGHT_SCHEDULE {
        *,
        aircraft    : redirected to Aircraft,
        origin      : redirected to Airports,
        destination : redirected to Airports
    };

    // ========================================================================
    // REFERENCE DATA (Read-only from Master Data)
    // ========================================================================

    @readonly
    entity Airports as projection on db.MASTER_AIRPORTS {
        *,
        country : redirected to Countries,
        plant   : redirected to Plants
    };

    @readonly
    entity Suppliers as projection on db.MASTER_SUPPLIERS {
        *,
        country : redirected to Countries
    };

    @readonly
    entity Contracts as projection on db.MASTER_CONTRACTS {
        *,
        supplier : redirected to Suppliers,
        currency : redirected to Currencies
    };

    @readonly
    entity Products as projection on db.MASTER_PRODUCTS {
        *,
        uom : redirected to UnitsOfMeasure
    };

    @readonly
    entity Aircraft as projection on db.AIRCRAFT_MASTER {
        *,
        manufacturer : redirected to Manufacturers
    };

    @readonly
    entity Manufacturers as projection on db.MANUFACTURE;

    @readonly
    entity Countries as projection on db.T005_COUNTRY;

    @readonly
    entity Currencies as projection on db.CURRENCY_MASTER;

    @readonly
    entity Plants as projection on db.T001W_PLANT;

    @readonly
    entity UnitsOfMeasure as projection on db.UNIT_OF_MEASURE;

    // ========================================================================
    // SERVICE-LEVEL ACTIONS
    // ========================================================================

    /**
     * Generate next order number for a station
     * Format: FO-{STATION}-{YYYYMMDD}-{SEQ}
     */
    function generateOrderNumber(stationCode: String, orderDate: Date) returns String;

    /**
     * Generate next delivery number for a station
     * Format: EPD-{STATION}-{YYYYMMDD}-{SEQ}
     */
    function generateDeliveryNumber(stationCode: String, deliveryDate: Date) returns String;

    /**
     * Get orders by station with summary statistics
     */
    function getOrdersByStation(stationCode: String, fromDate: Date, toDate: Date) returns OrderSummary;

    /**
     * Get orders by supplier with summary statistics
     */
    function getOrdersBySupplier(supplierId: UUID, fromDate: Date, toDate: Date) returns OrderSummary;

    // ========================================================================
    // TYPE DEFINITIONS
    // ========================================================================

    type PricingResult {
        unitPrice       : Decimal(15,4);
        currency        : String(3);
        cpeIndex        : Decimal(10,4);
        effectiveDate   : Date;
        contractNumber  : String(20);
        priceType       : String(20);
    };

    type SignatureResult {
        success         : Boolean;
        deliveryNumber  : String(25);
        s4PONumber      : String(10);
        s4GRNumber      : String(10);
        orderStatus     : String(20);
        message         : String(500);
    };

    type OrderSummary {
        totalOrders     : Integer;
        totalQuantity   : Decimal(15,2);
        totalAmount     : Decimal(15,2);
        currency        : String(3);
        byStatus        : array of StatusCount;
        byPriority      : array of PriorityCount;
    };

    type StatusCount {
        status  : String(20);
        count   : Integer;
        amount  : Decimal(15,2);
    };

    type PriorityCount {
        priority : String(10);
        count    : Integer;
    };
}

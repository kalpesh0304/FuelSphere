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
        tickets     : redirected to FuelTickets,
        // Virtual elements for UI criticality coloring
        virtual statusCriticality   : Integer,
        virtual priorityCriticality : Integer
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
        order : redirected to FuelOrders,
        virtual statusCriticality   : Integer,
        virtual varianceCriticality : Integer
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

        /**
         * Calculate temperature-corrected quantity (FDD-05)
         * Corrects volume to 15°C reference temperature per ASTM D1250
         * Formula: Corrected = Measured × [1 - α × (T - 15)]
         * where α = 0.00099 for Jet A/A-1
         */
        action calculateTemperatureCorrection() returns TemperatureCorrectionResult;

        /**
         * Validate delivery data per FDD-05 rules
         * - VAL-EPD-001: Quantity > 0 and <= ordered + 5%
         * - VAL-EPD-003: Temperature between -40°C and +50°C
         * - VAL-EPD-004: Density between 0.775 and 0.840 kg/L
         */
        action validateDelivery() returns DeliveryValidationResult;
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

    /**
     * Temperature Correction Result (FDD-05)
     * Applies ASTM D1250 correction to 15°C reference
     */
    type TemperatureCorrectionResult {
        success                 : Boolean;
        deliveryNumber          : String(25);
        measuredQuantity        : Decimal(12,2);
        measuredTemperature     : Decimal(5,2);
        measuredDensity         : Decimal(8,4);
        correctionFactor        : Decimal(8,6);
        correctedQuantity       : Decimal(12,2);
        referenceTemperature    : Decimal(5,2);  // Always 15°C
        message                 : String(500);
    };

    /**
     * Delivery Validation Result (FDD-05)
     */
    type DeliveryValidationResult {
        isValid         : Boolean;
        deliveryNumber  : String(25);
        errors          : array of ValidationError;
        warnings        : array of ValidationError;
    };

    type ValidationError {
        code        : String(10);   // EPD4xx error codes
        field       : String(50);
        message     : String(500);
        severity    : String(10);   // ERROR / WARNING
    };

    // ========================================================================
    // ERROR CODES (FDD-05 Section 7.6.5)
    // ========================================================================
    // EPD401 - Delivered quantity exceeds tolerance (>5% variance)
    // EPD402 - Missing required signature before status change
    // EPD403 - Temperature out of range (-40°C to +50°C)
    // EPD404 - Density out of specification (0.775 - 0.840 kg/L)
    // EPD410 - Duplicate ticket number for supplier
    // EPD411 - Meter reading does not match ticket quantity
    // INT401 - S/4HANA PO creation failed
    // INT402 - S/4HANA GR posting failed
    // INT403 - Shell Skypad communication timeout
    // INT404 - Object Store PDF upload failed
}

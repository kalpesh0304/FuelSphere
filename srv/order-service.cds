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
        milestones  : redirected to FuelOrderMilestones,
        calculation : redirected to FuelCalculations,
        // Virtual elements for UI criticality coloring
        virtual null as statusCriticality   : Integer,
        virtual null as priorityCriticality : Integer,
        virtual null as completionCriticality : Integer,
        virtual null as deliveryStatusCriticality : Integer,
        virtual null as epodStatusCriticality : Integer
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
         * Approve order (operations manager approval)
         * Transitions: Confirmed → Approved
         */
        action approve() returns FuelOrders;

        /**
         * Dispatch order to supplier (via API or Email)
         * Transitions: Approved → Dispatched
         * Sends order to supplier system and records dispatch method
         */
        action dispatch(method: String, transactionId: String) returns FuelOrders;

        /**
         * Acknowledge order received by supplier
         * Transitions: Dispatched → Acknowledged
         */
        action acknowledge(acknowledgmentId: String) returns FuelOrders;

        /**
         * Mark order as in progress (delivery started)
         * Transitions: Acknowledged/Confirmed → InProgress
         */
        action startDelivery() returns FuelOrders;

        /**
         * Cancel order
         * Transitions: Draft/Submitted/Confirmed/Approved → Cancelled
         * Requires reason for non-draft orders
         */
        action cancel(reason: String) returns FuelOrders;

        /**
         * Reject order (from Approval Queue)
         * Transitions: Submitted → Draft (returned for rework)
         * Requires rejection reason
         */
        action reject(reason: String) returns FuelOrders;

        /**
         * Complete delivery (ePOD received - triggers PO/GR creation)
         * Transitions: InProgress → Completed
         * Automatically triggers S/4HANA PO and GR creation
         */
        action completeDelivery() returns FuelOrders;

        /**
         * Validate order after PO/GR creation
         * Transitions: PO_Created → Validated
         */
        action validate() returns FuelOrders;

        /**
         * Post validated order to S/4HANA Financial Accounting
         * Transitions: Validated → Posted
         */
        action postToS4HANA() returns FuelOrders;

        /**
         * Close order (final status)
         * Transitions: Posted → Closed
         */
        action closeOrder() returns FuelOrders;

        /**
         * Calculate pricing from CPE
         * Returns unit price based on contract, product, and date
         */
        function calculatePrice() returns PricingResult;

        /**
         * Get CPE pricing breakdown for this order
         * Returns base price, contract premium, airport fees, into-plane service fee
         */
        function getPricingBreakdown() returns PricingBreakdown;
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
        virtual null as statusCriticality   : Integer,
        virtual null as varianceCriticality : Integer
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
    // FUEL ORDER MILESTONES (Status Timeline)
    // ========================================================================

    /**
     * FuelOrderMilestones - Status timeline tracking
     *
     * Displays as a timeline/process flow in the detail object page.
     * Each milestone represents a key event in the order lifecycle.
     */
    entity FuelOrderMilestones as projection on db.FUEL_ORDER_MILESTONES {
        *,
        order : redirected to FuelOrders
    };

    // ========================================================================
    // FUEL CALCULATIONS (Flight Dispatch System - Fuel Log Screen)
    // ========================================================================

    /**
     * FuelCalculations - Automated fuel calculations from Flight Dispatch
     * Screen #2 in the Fuel Order lifecycle
     *
     * Read-write for operations; pilots view via Pilot Approval screen
     */
    entity FuelCalculations as projection on db.FUEL_CALCULATIONS {
        *,
        flight : redirected to Flights,
        virtual null as calculationStatusCriticality : Integer,
        virtual null as complianceStatusCriticality  : Integer
    } actions {
        /**
         * Recalculate fuel requirements
         * Re-triggers dispatch system calculation with latest data
         */
        action recalculate() returns FuelCalculations;

        /**
         * Send calculation to pilot for approval
         * Transitions to Pilot Approval screen (Screen #3)
         */
        action sendToPilot() returns FuelCalculations;
    };

    // ========================================================================
    // SUPPLIER ALLOCATION
    // ========================================================================

    /**
     * SupplierAllocationTargets - Target vs Actual allocation percentages
     * Used by the Fuel Order Dashboard donut chart and variance analysis
     */
    @readonly
    entity SupplierAllocationTargets as projection on db.SUPPLIER_ALLOCATION_TARGETS {
        *,
        supplier : redirected to Suppliers,
        airport  : redirected to Airports,
        contract : redirected to Contracts
    };

    // ========================================================================
    // ROUTE-AIRCRAFT FUEL MATRIX (for planned fuel lookup)
    // ========================================================================

    /**
     * RouteAircraftMatrix - Planned fuel by route + aircraft type
     * Used in Create Fuel Order to auto-populate planned_quantity
     */
    @readonly
    entity RouteAircraftMatrix as projection on db.ROUTE_AIRCRAFT_MATRIX {
        *,
        route    : redirected to Routes,
        aircraft_type : redirected to Aircraft
    };

    @readonly
    entity Routes as projection on db.ROUTE_MASTER;

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

    /**
     * Get dashboard KPIs for the Fuel Order Dashboard
     * Returns total, pending, in-progress, completed counts and supplier allocation data
     */
    function getDashboardKPIs(stationCode: String, fromDate: Date, toDate: Date) returns DashboardKPIs;

    /**
     * Get recommended suppliers for a station based on allocation targets
     * Returns suppliers ranked by allocation gap (most under-allocated first)
     */
    function getRecommendedSuppliers(stationCode: String) returns array of SupplierRecommendation;

    /**
     * Lookup planned fuel quantity from Route-Aircraft Matrix
     * Returns the total standard fuel for a given route and aircraft type
     */
    function lookupPlannedFuel(routeId: UUID, aircraftTypeId: UUID) returns PlannedFuelResult;

    /**
     * Get pending approval queue for the current approver
     * Returns orders in Submitted status with due-time and allocation variance data
     */
    function getApprovalQueue(stationCode: String) returns array of ApprovalQueueItem;

    /**
     * Bulk approve multiple fuel orders
     * All orders must be in Submitted status
     */
    action bulkApprove(orderIds: array of UUID, comment: String);

    /**
     * Bulk reject multiple fuel orders
     * All orders must be in Submitted status; reason is mandatory
     */
    action bulkReject(orderIds: array of UUID, reason: String);

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

    type DashboardKPIs {
        totalOrders     : Integer;
        pendingOrders   : Integer;
        inProgressOrders: Integer;
        completedOrders : Integer;
        totalTrend      : Decimal(5,2);   // % change vs prior period
        pendingTrend    : Decimal(5,2);
        inProgressTrend : Decimal(5,2);
        completedTrend  : Decimal(5,2);
        allocations     : array of AllocationSummary;
    };

    type AllocationSummary {
        supplierName    : String(100);
        targetPct       : Decimal(5,2);
        actualPct       : Decimal(5,2);
        variance        : Decimal(5,2);
    };

    /**
     * Approval Queue Item (from FuelRequestApprovalQueue UI)
     * Enriched order data for the approval queue list
     */
    type ApprovalQueueItem {
        orderId           : UUID;
        orderNumber       : String(25);
        flightNumber      : String(10);
        tailNumber        : String(10);
        stationCode       : String(3);
        stationName       : String(100);
        supplierCode      : String(20);
        supplierName      : String(100);
        quantityKG        : Decimal(12,2);
        estimatedAmount   : Decimal(15,2);
        currency          : String(3);
        scheduledDeparture : DateTime;
        dueInHours        : Integer;             // Calculated: hours until departure
        allocationVariance : Decimal(5,2);       // From SUPPLIER_ALLOCATION_TARGETS
        priority          : String(10);          // Urgent / High / Normal
    };

    type SupplierRecommendation {
        supplierId      : UUID;
        supplierName    : String(100);
        supplierCode    : String(20);
        supplierRating  : String(1);
        contractId      : UUID;
        contractNumber  : String(20);
        targetAllocation : Decimal(5,2);
        currentAllocation : Decimal(5,2);
        estimatedPrice  : Decimal(15,4);
        isRecommended   : Boolean;
        status          : String(20);      // available / unavailable
    };

    type PlannedFuelResult {
        tripFuel        : Decimal(12,2);
        taxiFuel        : Decimal(10,2);
        contingencyFuel : Decimal(10,2);
        alternateFuel   : Decimal(10,2);
        reserveFuel     : Decimal(10,2);
        extraFuel       : Decimal(10,2);
        totalStandardFuel : Decimal(12,2);
        routeCode       : String(20);
        aircraftType    : String(20);
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

    /**
     * CPE Pricing Breakdown (from FuelRequestDetailSAP)
     * Multi-component fuel pricing structure
     */
    type PricingBreakdown {
        basePrice           : Decimal(15,4);    // Platts-based price
        contractPremium     : Decimal(15,4);    // Contract premium/discount
        airportFees         : Decimal(15,4);    // Airport throughput fees
        intoPlaneServiceFee : Decimal(15,4);    // Into-plane service charge
        totalUnitPrice      : Decimal(15,4);    // Sum of all components
        currency            : String(3);        // ISO currency code
        contractNumber      : String(20);       // Associated contract
        effectiveDate       : Date;             // Price effective date
        currentCPE          : Decimal(15,4);    // Current CPE index value
        previousCPE         : Decimal(15,4);    // Prior period CPE value
        cpeVariance         : Decimal(5,2);     // CPE change percentage
    };

    // ========================================================================
    // OPERATIONAL EXCEPTION TYPES (for ExceptionManagement TSX)
    // ========================================================================

    /**
     * Station operational exception record
     * Used by: ExceptionManagement TSX - active exception queue
     */
    type OperationalException {
        exceptionId         : String(25);       // EXC-{STATION}-{YYYY}-{SEQ}
        exceptionType       : String(30);       // DELIVERY_DELAY, FUEL_SHORTAGE, QUALITY_ISSUE, DOCUMENTATION
        severity            : String(10);       // critical, high, medium, low
        status              : String(20);       // open, in-progress, resolved
        age                 : String(30);       // e.g., '45 minutes', '1 hour 15 min'
        title               : String(200);
        description         : String(1000);
        details             : LargeString;      // JSON key-value pairs for flexible display
        impact              : String(200);      // e.g., 'Flight delay risk'
        assignedTo          : String(255);
        reportedBy          : String(100);
        reportedAt          : DateTime;
        priorityScore       : Integer;          // 0-100 AI priority score
        slaRemaining        : String(30);       // e.g., '15 min'
        stationCode         : String(3);        // IATA airport code
    };

    /**
     * Exception workflow step
     * Used by: ExceptionManagement TSX - resolution workflow sidebar
     */
    type ExceptionWorkflowStep {
        step                : Integer;
        title               : String(100);
        status              : String(20);       // completed, current, pending
        completedBy         : String(100);
        completedAt         : String(20);       // Time string
    };

    /**
     * Exception comment for team collaboration
     * Used by: ExceptionManagement TSX - team collaboration panel
     */
    type ExceptionComment {
        commentId           : UUID;
        author              : String(100);
        authorInitials      : String(5);
        timestamp           : DateTime;
        text                : String(1000);
        likes               : Integer;
    };

    /**
     * Operational exception KPIs
     * Used by: ExceptionManagement TSX - summary cards
     */
    type OperationalExceptionKPIs {
        totalExceptions     : Integer;
        openCount           : Integer;
        resolvedCount       : Integer;
        requireAttention    : Integer;
        criticalCount       : Integer;
        avgResolutionMinutes : Integer;
        targetResolutionMin : Integer;
        resolutionTrend     : Decimal(5,2);     // % faster/slower vs prior period
        weeklyTotal         : Integer;
        weeklyTrend         : Integer;          // +/- vs last week
    };

    /**
     * Exception type distribution for analytics chart
     * Used by: ExceptionManagement TSX - "Exceptions by Type" chart
     */
    type OpsExceptionTypeDistribution {
        exceptionType       : String(30);       // Delivery Delay, Equipment Failure, Quality Issue, etc.
        count               : Integer;
    };

    /**
     * Resolution time trend data point
     * Used by: ExceptionManagement TSX - "Resolution Time Trend" chart
     */
    type ResolutionTimeTrendItem {
        date                : Date;
        resolutionMinutes   : Integer;
    };

    // ========================================================================
    // OPERATIONAL EXCEPTION FUNCTIONS
    // ========================================================================

    /**
     * Get operational exceptions for a station
     */
    function getOperationalExceptions(stationCode: String, status: String) returns array of OperationalException;

    /**
     * Get operational exception KPIs for a station
     */
    function getOperationalExceptionKPIs(stationCode: String) returns OperationalExceptionKPIs;

    /**
     * Get exception workflow steps
     */
    function getExceptionWorkflow(exceptionId: String) returns array of ExceptionWorkflowStep;

    /**
     * Get exception comments/collaboration
     */
    function getExceptionComments(exceptionId: String) returns array of ExceptionComment;

    /**
     * Get exception type distribution for analytics
     */
    function getOpsExceptionDistribution(stationCode: String, days: Integer) returns array of OpsExceptionTypeDistribution;

    /**
     * Get resolution time trend data
     */
    function getResolutionTimeTrend(stationCode: String, days: Integer) returns array of ResolutionTimeTrendItem;

    /**
     * Create a new operational exception
     */
    action createOperationalException(
        stationCode: String,
        exceptionType: String,
        severity: String,
        title: String,
        description: String
    ) returns OperationalException;

    /**
     * Update exception status
     */
    action updateExceptionStatus(exceptionId: String, status: String) returns OperationalException;

    /**
     * Escalate exception
     */
    action escalateException(exceptionId: String, escalateTo: String) returns OperationalException;

    /**
     * Add comment to exception
     */
    action addExceptionComment(exceptionId: String, text: String) returns ExceptionComment;

    // ========================================================================
    // FUEL LOG TYPES (for FuelLog / FuelLogMobile TSX)
    // ========================================================================

    /**
     * Fuel log entry combining flight schedule + fuel calculation data
     * Used by both desktop (FuelLog) and mobile (FuelLogMobile) views
     */
    type FuelLogEntry {
        calculationId           : String(25);       // e.g. "FD-00001"
        flightId                : UUID;
        flightNumber            : String(10);       // e.g. "BA109"
        flightDate              : Date;
        departureStation        : String(3);        // IATA departure code
        arrivalStation          : String(3);        // IATA arrival code
        stationName             : String(100);      // Full departure station name
        aircraftRegistration    : String(10);       // e.g. "G-XLEA"
        aircraftType            : String(50);       // e.g. "Boeing 777-300ER"
        robDeparture            : Decimal(12,2);    // Remaining on Board at departure (kg)
        minimumRequired         : Decimal(12,2);    // Minimum fuel required by dispatch (kg)
        totalRequired           : Decimal(12,2);    // Total fuel required (kg)
        upliftNeeded            : Decimal(12,2);    // Uplift needed = total - ROB (kg)
        calculationStatus       : String(10);       // SUCCESS, PENDING, FAILED, WARNING
        calculationDate         : DateTime;         // When calculation was performed
        performanceTime         : Decimal(5,2);     // Calculation time in seconds
        warningMessage          : String(500);      // Warning message if status = WARNING
        pilotName               : String(100);      // Assigned pilot name
        pilotId                 : String(20);       // Pilot ID
        robSource               : String(20);       // ACARS, EFB, MANUAL
        calculationSource       : String(50);       // e.g. "Flight Dispatch System"
    };

    /**
     * Fuel log KPIs for the KPI tiles
     */
    type FuelLogKPIs {
        totalFlights            : Integer;          // Total flights in period
        calculatedFlights       : Integer;          // Successfully calculated
        warningFlights          : Integer;          // Calculated with warnings
        pendingFlights          : Integer;          // Pending calculation
        failedFlights           : Integer;          // Failed calculation
        totalTrend              : Decimal(5,2);     // Total trend vs prior period
        calculatedTrend         : Decimal(5,2);     // Calculated trend
        pendingTrend            : Decimal(5,2);     // Pending trend
    };

    function getFuelLogKPIs(stationCode: String) returns FuelLogKPIs;
    function getFuelLogEntries(
        stationCodes            : String,
        statusFilter            : String,
        fromDate                : Date,
        toDate                  : Date,
        skip                    : Integer,
        top                     : Integer
    ) returns array of FuelLogEntry;

    action bulkSendForPilotApproval(calculationIds: array of String) returns Integer;
    action sendForPilotApproval(calculationId: String) returns FuelLogEntry;

    // ========================================================================
    // STATION OPERATIONS CONTROL CENTER TYPES (for StationOperationsControlCenter TSX)
    // ========================================================================

    /**
     * Hero KPIs for the Station Operations Control Center
     * Real-time summary of today's fuel operations at a station
     */
    type StationOpsHeroKPIs {
        flightsScheduled        : Integer;          // Total flights today
        requestsCreated         : Integer;          // Fuel requests created
        requestsCoveragePct     : Decimal(5,2);     // % flights with requests
        completedCount          : Integer;          // Fueling completed
        completedPct            : Decimal(5,2);     // % complete
        inProgressCount         : Integer;          // Active fueling operations
        pendingCount            : Integer;          // Awaiting start
        fuelUpliftedLiters      : Decimal(15,2);    // Total liters uplifted today
        fuelUpliftTrend         : String(20);       // e.g. "↑ vs yesterday"
    };

    /**
     * Live activity feed item for station operations
     * Real-time fueling activity updates
     */
    type StationActivityItem {
        activityId              : String(20);
        activityType            : String(15);       // completed, in-progress, alert, info
        time                    : String(10);       // HH:MM format
        timeAgo                 : String(30);       // e.g. "15 min ago"
        title                   : String(200);      // e.g. "Flight SQ001 - Fueling completed"
        details                 : String(200);      // e.g. "95,450L | TRK-101 | Gate D38"
        progress                : Integer;          // Fueling progress % (for in-progress)
        actionLabel             : String(20);       // e.g. "View ePOD", "Monitor"
    };

    /**
     * Flight fueling card for the operations timeline
     * Shows real-time fueling status per flight
     */
    type StationFlightCard {
        flightId                : UUID;
        flightNumber            : String(10);
        route                   : String(20);       // e.g. "SIN → JFK"
        gate                    : String(10);
        departure               : String(10);       // HH:MM
        status                  : String(15);       // completed, in-progress, delayed, scheduled
        fuelRequestedLiters     : Decimal(12,2);
        fuelDeliveredLiters     : Decimal(12,2);
        progressPct             : Integer;          // 0-100
        operatorTruck           : String(20);       // e.g. "TRK-103"
        issue                   : String(200);      // Issue description (for delayed)
    };

    /**
     * Station resource status card
     * Real-time availability of trucks, operators, fuel inventory
     */
    type StationResourceStatus {
        resourceType            : String(20);       // trucks, operators, fuel_inventory
        label                   : String(50);       // Display label
        available               : Integer;          // Available count
        total                   : Integer;          // Total count
        displayValue            : String(20);       // e.g. "5 / 7" or "245K L"
        statusText              : String(50);       // e.g. "2 in use, 5 ready"
        progressPct             : Integer;          // For fuel inventory
    };

    /**
     * Station alert for operations
     * Active warnings and issues at the station
     */
    type StationAlertItem {
        alertId                 : UUID;
        severity                : String(10);       // high, medium, info
        title                   : String(200);
        details                 : String(200);
        time                    : String(30);       // e.g. "Updated 5 min ago"
        actionLabel             : String(20);       // e.g. "View Details", "Schedule"
    };

    /**
     * Shift information for station operations banner
     * Shows current and next shift details
     */
    type StationShiftInfo {
        currentShiftName        : String(30);       // e.g. "Day Shift"
        currentShiftHours       : String(20);       // e.g. "06:00 - 14:00"
        currentCoordinator      : String(100);
        nextShiftName           : String(30);
        nextShiftHours          : String(20);
        nextCoordinator         : String(100);
        handoverMinutes         : Integer;          // Minutes until handover
    };

    /**
     * Get station operations hero KPIs for today
     */
    function getStationOpsHeroKPIs(stationCode: String) returns StationOpsHeroKPIs;

    /**
     * Get live activity feed for station
     */
    function getStationActivityFeed(stationCode: String, top: Integer) returns array of StationActivityItem;

    /**
     * Get flight fueling timeline for station
     */
    function getStationFlightTimeline(stationCode: String, timeRange: String) returns array of StationFlightCard;

    /**
     * Get station resource status
     */
    function getStationResourceStatus(stationCode: String) returns array of StationResourceStatus;

    /**
     * Get active station alerts
     */
    function getStationAlerts(stationCode: String) returns array of StationAlertItem;

    /**
     * Get current shift information
     */
    function getStationShiftInfo(stationCode: String) returns StationShiftInfo;

    /**
     * Prepare handover report for shift change
     */
    action prepareHandoverReport(stationCode: String) returns StationShiftInfo;

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

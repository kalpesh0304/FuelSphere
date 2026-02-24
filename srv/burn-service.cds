/**
 * FuelSphere - Burn Service (FDD-08)
 *
 * Fuel Burn & ROB Tracking Module:
 * - Real-time fuel consumption tracking from ACARS, EFB, Jefferson
 * - ROB (Remaining on Board) ledger per aircraft
 * - Planned vs. Actual variance analysis
 * - Exception management for variance investigation
 *
 * Core Formula: ROB_current = ROB_previous + Uplift - Burn + Adjustment
 *
 * Data Source Priority: ACARS > JEFFERSON > EFB > MANUAL
 *
 * Service Path: /odata/v4/burn
 */

using { fuelsphere as db } from '../db/schema';

@path: '/odata/v4/burn'
service BurnService {

    // ========================================================================
    // FUEL BURN RECORDS
    // ========================================================================

    /**
     * FuelBurns - Fuel Consumption Records
     * Draft-enabled for manual entry
     *
     * Access:
     * - Operations Manager: Full access (BurnDataView, BurnDataEdit)
     * - Fuel Planner: View only (BurnDataView)
     * - Flight Ops: Limited edit for flight-specific records
     */
    @odata.draft.enabled
    entity FuelBurns as projection on db.FUEL_BURNS {
        *,
        flight              : redirected to Flights,
        aircraft            : redirected to Aircraft,
        origin_airport      : redirected to Airports,
        destination_airport : redirected to Airports,
        // Virtual elements for UI criticality coloring
        virtual null as statusCriticality          : Integer,
        virtual null as varianceCriticality        : Integer,
        virtual null as reconciliationCriticality  : Integer
    } actions {
        /**
         * Confirm/validate burn record
         * Transitions: Pending → Validated
         * Triggers ROB ledger update
         */
        action confirm() returns FuelBurns;

        /**
         * Reject burn record
         * Used when data is invalid or duplicate
         */
        action reject(reason: String) returns FuelBurns;

        /**
         * Send to exception queue
         * Transitions: Validated/Posted → Exception
         * Creates a FUEL_BURN_EXCEPTIONS record
         */
        action sendToException(reason: String) returns FuelBurns;

        /**
         * Trigger S/4HANA posting
         * Transitions: Validated → Posted
         * Triggers consumption accounting event (FDD-10)
         */
        action triggerPosting() returns FuelBurns;

        /**
         * Recalculate variance
         * Updates variance based on current planned burn
         */
        action recalculateVariance() returns FuelBurns;

        /**
         * Mark for review
         * Flags record for Operations Manager review
         */
        action flagForReview(notes: String) returns FuelBurns;

        /**
         * Complete review
         * Marks review as complete with notes
         */
        action completeReview(notes: String) returns FuelBurns;

        /**
         * Post to Finance (legacy - use triggerPosting)
         * Triggers consumption accounting event (FDD-10)
         */
        action postToFinance() returns FuelBurns;
    };

    // ========================================================================
    // ROB LEDGER
    // ========================================================================

    /**
     * ROBLedger - Remaining on Board Fuel Ledger
     * Per-aircraft fuel inventory tracking
     *
     * Read access for most users, edit limited to Ops Manager
     */
    entity ROBLedger as projection on db.ROB_LEDGER {
        *,
        aircraft        : redirected to Aircraft,
        airport         : redirected to Airports,
        flight          : redirected to Flights,
        fuel_burn       : redirected to FuelBurns,
        fuel_delivery   : redirected to FuelDeliveries,
        supplier        : redirected to Suppliers,
        // Virtual elements for ROBLedger UI (debit/credit accounting view)
        virtual null as statusCriticality      : Integer,
        virtual null as continuityColor        : Integer,
        virtual null as debit_kg               : Decimal(12,2),
        virtual null as credit_kg              : Decimal(12,2),
        // Computed route from flight origin/destination (e.g., "MNL → CEB")
        virtual null as flightRoute            : String(20)
    } actions {
        /**
         * Approve adjustment (Ops Manager only)
         */
        action approveAdjustment() returns ROBLedger;

        /**
         * Reject adjustment
         */
        action rejectAdjustment(reason: String) returns ROBLedger;
    };

    // ========================================================================
    // EXCEPTION MANAGEMENT
    // ========================================================================

    /**
     * FuelBurnExceptions - Variance Exception Queue
     * Tracks variances requiring investigation
     */
    @odata.draft.enabled
    entity FuelBurnExceptions as projection on db.FUEL_BURN_EXCEPTIONS {
        *,
        fuel_burn   : redirected to FuelBurns,
        aircraft    : redirected to Aircraft
    } actions {
        /**
         * Assign for investigation
         */
        action assign(assignee: String) returns FuelBurnExceptions;

        /**
         * Start investigation
         */
        action startInvestigation() returns FuelBurnExceptions;

        /**
         * Resolve exception
         */
        action resolve(rootCause: String, correctiveAction: String) returns FuelBurnExceptions;

        /**
         * Close exception
         */
        action close() returns FuelBurnExceptions;

        /**
         * Link to maintenance
         */
        action linkMaintenance(maintenanceOrder: String) returns FuelBurnExceptions;
    };

    // ========================================================================
    // REFERENCE DATA (Read-only)
    // ========================================================================

    @readonly
    entity Flights as projection on db.FLIGHT_SCHEDULE {
        *,
        aircraft    : redirected to Aircraft,
        origin      : redirected to Airports,
        destination : redirected to Airports
    };

    @readonly
    entity Aircraft as projection on db.AIRCRAFT_MASTER {
        *,
        manufacturer : redirected to Manufacturers
    };

    @readonly
    entity Manufacturers as projection on db.MANUFACTURE;

    @readonly
    entity Airports as projection on db.MASTER_AIRPORTS {
        *,
        country : redirected to Countries
    };

    @readonly
    entity Countries as projection on db.T005_COUNTRY;

    @readonly
    entity FuelDeliveries as projection on db.FUEL_DELIVERIES {
        *,
        order : redirected to FuelOrders
    };

    @readonly
    entity FuelOrders as projection on db.FUEL_ORDERS {
        *,
        flight   : redirected to Flights,
        supplier : redirected to Suppliers,
        // Virtual elements for ROBSummaryView (combined uplift/ROB data)
        virtual null as robDeparture           : Decimal(12,2),
        virtual null as robArrival             : Decimal(12,2),
        virtual null as upliftQuantity         : Decimal(12,2),
        virtual null as varianceStatus         : String(20),
        virtual null as variancePercent        : Decimal(5,2),
        virtual null as capturedBy             : String(100),
        virtual null as capturedAt             : DateTime,
        virtual null as previousArrivalCapturedAt : DateTime,   // When previous arrival ROB was captured
        virtual null as dataSource             : String(20),    // ACARS, EFB, MANUAL (from related burn)
        virtual null as hasException           : Boolean,
        virtual null as isMyFlight             : Boolean,
        virtual null as statusCriticality      : Integer
    };

    @readonly
    entity Suppliers as projection on db.MASTER_SUPPLIERS;

    // ========================================================================
    // SERVICE-LEVEL ACTIONS
    // ========================================================================

    /**
     * Ingest ACARS fuel burn message
     * Called by SAP Integration Suite (CPI)
     */
    action ingestACARS(
        flightNumber: String,
        tailNumber: String,
        burnDate: Date,
        actualBurnKg: Decimal,
        messageType: String,
        timestamp: DateTime,
        messageId: String
    ) returns ACARSIngestResult;

    /**
     * Ingest EFB fuel reading
     * Called by EFB system integration
     */
    action ingestEFB(
        flightNumber: String,
        tailNumber: String,
        burnDate: Date,
        actualBurnKg: Decimal,
        blockOffTime: DateTime,
        blockOnTime: DateTime,
        submissionId: String
    ) returns EFBIngestResult;

    /**
     * Load planned burn from Jefferson
     * Batch load of planned fuel burn values
     */
    action loadJeffersonPlanned(entries: array of JeffersonEntry) returns JeffersonLoadResult;

    /**
     * Adjust ROB for aircraft
     * Manual ROB correction (requires Ops Manager approval)
     */
    action adjustROB(
        aircraftId: UUID,
        tailNumber: String,
        airportCode: String,
        adjustmentKg: Decimal,
        reason: String
    ) returns ROBAdjustmentResult;

    /**
     * Recalculate ROB for aircraft
     * Rebuild ROB ledger from a specific date
     */
    action recalculateROB(
        aircraftId: UUID,
        fromDate: Date
    ) returns ROBRecalculationResult;

    /**
     * Batch confirm fuel burns
     * Confirm multiple preliminary records
     */
    action batchConfirm(burnIds: array of UUID) returns BatchConfirmResult;

    // ========================================================================
    // SERVICE-LEVEL FUNCTIONS
    // ========================================================================

    /**
     * Get current ROB for aircraft
     */
    function getCurrentROB(tailNumber: String) returns CurrentROBResult;

    /**
     * Get ROB history for aircraft
     */
    function getROBHistory(
        tailNumber: String,
        fromDate: Date,
        toDate: Date
    ) returns array of ROBHistoryEntry;

    /**
     * Get fleet ROB summary
     */
    function getFleetROBSummary() returns array of FleetROBSummary;

    /**
     * Get burn variance dashboard KPIs
     * Provides all 4 KPI tiles: Total Flights, ACARS Success, Pending Exceptions, Posted to S/4
     */
    function getDashboardKPIs(fromDate: Date, toDate: Date) returns BurnDashboardKPIs;

    /**
     * Get recent burn activity feed for dashboard
     * Returns latest burn records with variance and status for the activity feed
     */
    function getRecentActivity(limit: Integer) returns array of RecentActivityItem;

    /**
     * Get burn variance trend data for line chart
     * Returns daily actual vs expected burn averages over a date range
     */
    function getBurnVarianceTrend(
        fromDate: Date,
        toDate: Date
    ) returns array of BurnVarianceTrendEntry;

    /**
     * Search flights for burn entry form selection dropdown
     * Returns recent flights with previous leg ROB and uplift data
     */
    function searchFlightsForBurnEntry(
        query: String,
        fromDate: Date,
        toDate: Date
    ) returns array of FlightForBurnEntry;

    /**
     * Get variance analysis by aircraft
     */
    function getVarianceByAircraft(
        fromDate: Date,
        toDate: Date,
        aircraftType: String
    ) returns array of AircraftVarianceAnalysis;

    /**
     * Get variance analysis by route
     */
    function getVarianceByRoute(
        fromDate: Date,
        toDate: Date
    ) returns array of RouteVarianceAnalysis;

    /**
     * Get exception queue
     */
    function getExceptionQueue() returns array of ExceptionQueueItem;

    /**
     * Get pending confirmations
     */
    function getPendingConfirmations() returns array of PendingConfirmation;

    /**
     * Search fuel burns
     */
    function searchFuelBurns(
        tailNumber: String,
        flightNumber: String,
        fromDate: Date,
        toDate: Date,
        dataSource: String,
        status: String,
        varianceStatus: String
    ) returns array of FuelBurnSearchResult;

    /**
     * Calculate estimated burn for route/aircraft
     * Based on historical data and Route-Aircraft Matrix
     */
    function estimateBurn(
        routeCode: String,
        aircraftType: String
    ) returns BurnEstimate;

    // ========================================================================
    // ROBSummaryView Functions (All Fuel Uplift and ROB Records)
    // ========================================================================

    /**
     * Get combined fuel uplift and ROB records for ROBSummaryView
     * Joins FUEL_ORDERS + FUEL_BURNS + FUEL_DELIVERIES data
     * Supports filter chips: Today, My Flights, Exceptions
     */
    function getROBSummaryRecords(
        fromDate: Date,
        toDate: Date,
        stationCode: String,
        status: String,
        myFlightsOnly: Boolean,
        exceptionsOnly: Boolean
    ) returns array of ROBSummaryRecord;

    // ========================================================================
    // ROBLedgerDetail Functions (FB_UI_005)
    // ========================================================================

    /**
     * Get ROB trend analysis chart data for a specific aircraft
     * Used by ROBLedgerDetail trend chart (7/14/30/90 day periods)
     */
    function getROBTrendAnalysis(
        tailNumber: String,
        periodDays: Integer
    ) returns array of ROBTrendDataPoint;

    /**
     * Get flight leg sequence for multi-leg visualization
     * Shows ROB continuity across consecutive flights for an aircraft
     * Continuity Formula: ROB Arrival (Leg N) = ROB Departure (Leg N+1)
     */
    function getFlightLegSequence(
        tailNumber: String,
        fromDate: Date,
        toDate: Date
    ) returns array of FlightLegEntry;

    // ========================================================================
    // ROBCapture Functions & Actions
    // ========================================================================

    /**
     * Get flights ready for ROB capture at a station
     * Returns flights with ACARS status, previous ROB, and tolerance data
     * Split-screen: Left panel (flight cards) + Right panel (capture form)
     */
    function getFlightsForROBCapture(
        stationCode: String,
        fromDate: Date,
        toDate: Date
    ) returns array of FlightForROBCapture;

    /**
     * Capture ROB reading for a flight
     * Supports 3 data source modes: ACARS (automated), EFB (pilot), MANUAL (fallback)
     * Validates: capacity check, continuity check, density range (0.775-0.840 kg/L)
     */
    action captureROB(
        flightId: UUID,
        robDepartureKg: Decimal,
        robDensity: Decimal,
        dataSource: String,
        dataSourceReason: String,
        comments: String
    ) returns ROBCaptureResult;

    // ========================================================================
    // TYPE DEFINITIONS
    // ========================================================================

    type ACARSIngestResult {
        success             : Boolean;
        burnId              : UUID;
        tailNumber          : String(10);
        flightNumber        : String(10);
        actualBurnKg        : Decimal(12,2);
        varianceKg          : Decimal(12,2);
        variancePct         : Decimal(5,2);
        varianceStatus      : String(20);
        status              : String(20);
        message             : String(500);
    };

    type EFBIngestResult {
        success             : Boolean;
        burnId              : UUID;
        tailNumber          : String(10);
        flightNumber        : String(10);
        actualBurnKg        : Decimal(12,2);
        flightDurationMins  : Integer;
        varianceKg          : Decimal(12,2);
        variancePct         : Decimal(5,2);
        status              : String(20);
        message             : String(500);
    };

    type JeffersonEntry {
        routeCode           : String(20);
        aircraftType        : String(10);
        plannedBurnKg       : Decimal(12,2);
        effectiveDate       : Date;
    };

    type JeffersonLoadResult {
        success             : Boolean;
        totalEntries        : Integer;
        loadedCount         : Integer;
        skippedCount        : Integer;
        errorCount          : Integer;
        errors              : array of LoadError;
        message             : String(500);
    };

    type LoadError {
        routeCode           : String(20);
        aircraftType        : String(10);
        errorCode           : String(10);
        message             : String(500);
    };

    type ROBAdjustmentResult {
        success             : Boolean;
        ledgerId            : UUID;
        tailNumber          : String(10);
        airportCode         : String(3);
        previousROBKg       : Decimal(12,2);
        adjustmentKg        : Decimal(12,2);
        newROBKg            : Decimal(12,2);
        requiresApproval    : Boolean;
        message             : String(500);
    };

    type ROBRecalculationResult {
        success             : Boolean;
        tailNumber          : String(10);
        fromDate            : Date;
        entriesRecalculated : Integer;
        finalROBKg          : Decimal(12,2);
        discrepanciesFound  : Integer;
        message             : String(500);
    };

    type BatchConfirmResult {
        success             : Boolean;
        totalRequested      : Integer;
        confirmedCount      : Integer;
        failedCount         : Integer;
        skippedCount        : Integer;
        failures            : array of ConfirmFailure;
        message             : String(500);
    };

    type ConfirmFailure {
        burnId              : UUID;
        tailNumber          : String(10);
        errorCode           : String(10);
        message             : String(500);
    };

    type CurrentROBResult {
        tailNumber          : String(10);
        aircraftType        : String(10);
        currentROBKg        : Decimal(12,2);
        maxCapacityKg       : Decimal(12,2);
        robPercentage       : Decimal(5,2);
        lastUpdateDate      : Date;
        lastUpdateTime      : Time;
        lastAirport         : String(3);
        lastEntryType       : String(20);
    };

    type ROBHistoryEntry {
        ledgerId            : UUID;
        recordDate          : Date;
        recordTime          : Time;
        airportCode         : String(3);
        entryType           : String(20);
        openingROBKg        : Decimal(12,2);
        upliftKg            : Decimal(12,2);
        burnKg              : Decimal(12,2);
        adjustmentKg        : Decimal(12,2);
        closingROBKg        : Decimal(12,2);
        flightNumber        : String(10);
    };

    type FleetROBSummary {
        tailNumber          : String(10);
        aircraftType        : String(10);
        currentROBKg        : Decimal(12,2);
        maxCapacityKg       : Decimal(12,2);
        robPercentage       : Decimal(5,2);
        lastAirport         : String(3);
        lastUpdateTime      : DateTime;
        status              : String(20);  // OK, LOW_FUEL, NEEDS_ATTENTION
    };

    type BurnDashboardKPIs {
        // Core metrics
        totalFlights        : Integer;
        totalBurnKg         : Decimal(15,2);
        avgBurnPerFlight    : Decimal(12,2);
        plannedBurnKg       : Decimal(15,2);
        totalVarianceKg     : Decimal(15,2);
        variancePct         : Decimal(5,2);
        normalCount         : Integer;
        warningCount        : Integer;
        exceptionCount      : Integer;
        criticalCount       : Integer;
        pendingConfirmation : Integer;
        openExceptions      : Integer;
        // KPI 1 - Total Flights Today (with trend)
        flightsTrend            : String(20);   // e.g., '+5%'
        flightsTrendDirection   : String(10);   // 'up' or 'down'
        // KPI 2 - ACARS Success Rate
        acarsSuccessRate        : Decimal(5,2); // e.g., 97.5
        acarsSuccessRateTrend   : String(20);   // e.g., '+0.8%'
        // KPI 3 - Exception Breakdown by severity
        exceptionsHighCount     : Integer;      // High severity (>10%)
        exceptionsMediumCount   : Integer;      // Medium severity (5-10%)
        exceptionsLowCount      : Integer;      // Low severity (missing data, etc.)
        exceptionsTrend         : String(20);   // e.g., '-3'
        // KPI 4 - Posted to S/4HANA
        postedToS4Count         : Integer;      // Number of records posted
        postingSuccessRate      : String(50);   // e.g., '100% posting success'
    };

    // Dashboard Activity Feed (FuelBurnROBDashboard)
    type RecentActivityItem {
        flightNumber        : String(10);
        route               : String(20);       // e.g., 'JFK→LHR'
        tailNumber          : String(10);
        burnKg              : Decimal(12,2);
        variancePct         : Decimal(5,2);
        varianceStatus      : String(20);       // success, warning, error
        status              : String(20);       // validated, exception
        timestamp           : DateTime;
    };

    // Burn Variance Trend Chart Data (FuelBurnROBDashboard)
    type BurnVarianceTrendEntry {
        trendDate           : Date;
        actualAvgBurn       : Decimal(12,2);    // Actual average burn (kg)
        expectedAvgBurn     : Decimal(12,2);    // Expected average burn (kg)
    };

    // Flight search result for BurnEntryForm flight selection dropdown
    type FlightForBurnEntry {
        flightNumber        : String(10);
        flightDate          : Date;
        tailNumber          : String(10);
        originCode          : String(3);
        originName          : String(100);
        destinationCode     : String(3);
        destinationName     : String(100);
        aircraftType        : String(50);
        maxCapacityKg       : Decimal(12,2);
        // Previous leg data for ROB continuity check
        previousFlightNumber : String(10);
        previousRobArrivalKg : Decimal(12,2);
        // Uplift data from fuel ticket/ePOD
        upliftQuantityKg    : Decimal(12,2);
        upliftDate          : Date;
        upliftSupplier      : String(100);
        upliftTicketId      : String(30);
        upliftEpdStatus     : String(20);
        // Dispatch calculation reference
        dispatchMinRequired : Decimal(12,2);
        dispatchPilotBuffer : Decimal(12,2);
        dispatchFinalApproved : Decimal(12,2);
        dispatchTripFuel    : Decimal(12,2);
        dispatchContingency : Decimal(12,2);
        dispatchAlternate   : Decimal(12,2);
        dispatchFinalReserve : Decimal(12,2);
        dispatchAdditional  : Decimal(12,2);
    };

    type AircraftVarianceAnalysis {
        tailNumber          : String(10);
        aircraftType        : String(10);
        flightCount         : Integer;
        totalPlannedKg      : Decimal(15,2);
        totalActualKg       : Decimal(15,2);
        totalVarianceKg     : Decimal(15,2);
        avgVariancePct      : Decimal(5,2);
        exceptionCount      : Integer;
        trend               : String(20);  // IMPROVING, STABLE, DEGRADING
    };

    type RouteVarianceAnalysis {
        routeCode           : String(20);
        originAirport       : String(3);
        destinationAirport  : String(3);
        flightCount         : Integer;
        avgPlannedKg        : Decimal(12,2);
        avgActualKg         : Decimal(12,2);
        avgVariancePct      : Decimal(5,2);
        stdDeviationKg      : Decimal(12,2);
    };

    type ExceptionQueueItem {
        exceptionId         : UUID;
        burnId              : UUID;
        tailNumber          : String(10);
        flightNumber        : String(10);
        exceptionDate       : Date;
        varianceKg          : Decimal(12,2);
        variancePct         : Decimal(5,2);
        varianceStatus      : String(20);
        status              : String(20);
        assignedTo          : String(100);
        daysOpen            : Integer;
    };

    type PendingConfirmation {
        burnId              : UUID;
        tailNumber          : String(10);
        flightNumber        : String(10);
        burnDate            : Date;
        actualBurnKg        : Decimal(12,2);
        dataSource          : String(20);
        variancePct         : Decimal(5,2);
        createdAt           : DateTime;
    };

    type FuelBurnSearchResult {
        burnId              : UUID;
        tailNumber          : String(10);
        flightNumber        : String(10);
        burnDate            : Date;
        originAirport       : String(3);
        destinationAirport  : String(3);
        plannedBurnKg       : Decimal(12,2);
        actualBurnKg        : Decimal(12,2);
        variancePct         : Decimal(5,2);
        varianceStatus      : String(20);
        dataSource          : String(20);
        status              : String(20);
    };

    type BurnEstimate {
        routeCode           : String(20);
        aircraftType        : String(10);
        estimatedBurnKg     : Decimal(12,2);
        confidenceLevel     : String(20);   // HIGH, MEDIUM, LOW
        basedOnFlights      : Integer;
        standardDeviation   : Decimal(12,2);
        minHistorical       : Decimal(12,2);
        maxHistorical       : Decimal(12,2);
    };

    // ========================================================================
    // ROBSummaryView Types
    // ========================================================================

    // Combined fuel uplift/ROB record for ROBSummaryView list report
    type ROBSummaryRecord {
        id                   : UUID;
        fuelOrderId          : String(25);      // FUEL_ORDERS.order_number
        flightNumber         : String(10);
        flightDate           : Date;
        departureStation     : String(3);       // Origin IATA code
        arrivalStation       : String(3);       // Destination IATA code
        stationName          : String(100);     // Airport full name
        scheduledDeparture   : Time;
        scheduledArrival     : Time;
        aircraftRegistration : String(10);      // Tail number
        aircraftType         : String(50);      // Aircraft model
        status               : String(20);      // validated/acknowledged/pending/exception/failed
        dataSource           : String(20);      // ACARS, EFB, MANUAL, etc.
        robDeparture         : Decimal(12,2);   // ROB at departure (kg)
        robArrival           : Decimal(12,2);   // ROB at arrival (kg)
        upliftQuantity       : Decimal(12,2);   // Fuel uplifted (kg)
        capturedBy           : String(100);     // Who captured the data
        capturedAt           : DateTime;        // When data was captured
        previousArrivalCapturedAt : DateTime;   // When previous arrival ROB was captured
        varianceStatus       : String(20);      // within-tolerance/warning/exceeded
        variancePercent      : Decimal(5,2);    // Variance percentage
        pilotName            : String(100);     // Captain name
        isMyFlight           : Boolean;         // True if current user's assigned flight
        hasException         : Boolean;         // True if exception exists
    };

    // ========================================================================
    // ROBLedgerDetail Types (FB_UI_005)
    // ========================================================================

    // ROB trend chart data point for ROBLedgerDetail
    type ROBTrendDataPoint {
        trendDate            : Date;
        robKg                : Decimal(12,2);   // ROB level at this point
        upliftKg             : Decimal(12,2);   // Uplift amount for chart line (ROBLedgerDetail trend)
        maxCapacityKg        : Decimal(12,2);   // Aircraft max fuel capacity
        robPercentage        : Decimal(5,2);    // ROB as % of capacity
        station              : String(3);       // Airport at this point
        entryType            : String(20);      // Entry type for context
    };

    // Flight leg entry for multi-leg sequence table in ROBLedgerDetail
    type FlightLegEntry {
        legNumber            : Integer;         // Sequence number
        flightNumber         : String(10);
        route                : String(20);      // e.g., 'MNL → CEB'
        flightDate           : Date;
        robDeparture         : Decimal(12,2);   // ROB at departure (kg)
        uplift               : Decimal(12,2);   // Fuel uplifted (kg)
        robArrival           : Decimal(12,2);   // ROB at arrival (kg)
        burn                 : Decimal(12,2);   // Fuel burned (kg)
        variancePercent      : Decimal(5,2);    // Variance %
        status               : String(20);      // Validated/Pending/Exception/Posted
        continuityCheck      : String(10);      // Pass/Warning/Fail
    };

    // ========================================================================
    // ROBCapture Types
    // ========================================================================

    // Flight data for ROB capture split-screen (left panel flight cards)
    type FlightForROBCapture {
        id                   : UUID;            // Flight schedule ID
        flightNumber         : String(10);
        departureStation     : String(3);
        arrivalStation       : String(3);
        stationName          : String(100);     // Full airport name
        scheduledDeparture   : Time;
        scheduledArrival     : Time;
        aircraftRegistration : String(10);      // Tail number
        aircraftType         : String(50);      // Aircraft model
        fuelCapacity         : Decimal(15,2);   // Max fuel capacity (kg)
        tailCostCenter       : String(20);      // Cost center for tail
        // ACARS connection status
        acarsStatus          : String(20);      // CONNECTED/PENDING/FAILED/UNAVAILABLE
        acarsLastUpdate      : DateTime;        // Last ACARS message time
        acarsMessageId       : String(50);      // Last ACARS message ID
        // Current ROB data (may be from ACARS, EFB, or empty for manual)
        robDeparture         : Decimal(12,2);   // Current ROB reading (kg)
        robDensity           : Decimal(8,4);    // Density at 15°C (kg/L)
        robVolume            : Decimal(12,2);   // Volume in liters
        dataSource           : String(20);      // ACARS/EFB/MANUAL
        validationStatus     : String(20);      // VALIDATED/PENDING/FAILED
        status               : String(20);      // confirmed/pending/failed/acars-pending
        // Previous flight ROB for continuity check
        previousFlightNumber : String(10);
        previousRobArrival   : Decimal(12,2);   // Previous leg ROB arrival (kg)
        previousArrivalTime  : DateTime;
        // Tolerance validation
        maxVariancePercent   : Decimal(5,2);    // Max allowed variance (default ±10%)
        currentVariancePercent : Decimal(5,2);  // Current variance from previous ROB
        withinTolerance      : Boolean;         // True if within tolerance
    };

    // Result from captureROB action
    type ROBCaptureResult {
        success              : Boolean;
        ledgerId             : UUID;            // Created ROB_LEDGER entry ID
        burnId               : UUID;            // Created/updated FUEL_BURNS entry ID
        flightNumber         : String(10);
        tailNumber           : String(10);
        robDepartureKg       : Decimal(12,2);
        robDensity           : Decimal(8,4);
        robVolumeLiters      : Decimal(12,2);
        validationStatus     : String(20);      // VALIDATED/PENDING/FAILED
        continuityCheck      : String(10);      // PASS/WARNING/FAIL
        message              : String(500);
    };

    // ========================================================================
    // ERROR CODES (FDD-08)
    // ========================================================================
    // FB401 - actualBurnKg must be greater than 0
    // FB402 - closingROBKg cannot be negative
    // FB403 - Duplicate burn record for flight/aircraft
    // FB404 - ACARS data format validation failed
    // FB405 - Variance exceeds maximum threshold (> 20%)
    // FB406 - ROB ledger gap detected (missing entries)
    // FB407 - Aircraft not found
    // FB408 - Flight not found
    // FB409 - Adjustment requires approval
    // FB410 - Jefferson load failed
    // FB411 - ROB density out of specification (0.775-0.840 kg/L)
    // FB412 - ROB continuity check failed
    // FB413 - ACARS data unavailable for station
}

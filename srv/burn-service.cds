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
        destination_airport : redirected to Airports
    } actions {
        /**
         * Confirm burn record
         * Transitions: Preliminary → Confirmed
         * Triggers ROB ledger update and Finance posting event
         */
        action confirm() returns FuelBurns;

        /**
         * Reject burn record
         * Used when data is invalid or duplicate
         */
        action reject(reason: String) returns FuelBurns;

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
         * Post to Finance
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
        fuel_delivery   : redirected to FuelDeliveries
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
    entity FuelOrders as projection on db.FUEL_ORDERS;

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
     */
    function getDashboardKPIs(fromDate: Date, toDate: Date) returns BurnDashboardKPIs;

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
}

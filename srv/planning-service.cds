/**
 * FuelSphere - Planning Service (FDD-02)
 *
 * Annual Planning & Forecasting Module:
 * - Fuel demand forecasting based on flight schedules
 * - Budget version management with scenario comparison
 * - SAP Analytics Cloud (SAC) writeback integration
 * - Route-Aircraft fuel consumption matrix management
 *
 * Key Capabilities:
 * - Flight schedule integration with SSIM format support
 * - Fuel demand calculation: Trip + Taxi + Contingency + Alternate + Reserve
 * - Price planning with CPE/Native Engine integration (FDD-03)
 * - Multi-scenario budget analysis
 *
 * Service Path: /odata/v4/planning
 */

using { fuelsphere as db } from '../db/schema';

@path: '/odata/v4/planning'
service PlanningService {

    // ========================================================================
    // CORE ENTITIES - Planning Versions
    // ========================================================================

    /**
     * PlanningVersions - Budget/Forecast Version Management
     * Draft-enabled for work-in-progress planning
     *
     * Access:
     * - Fuel Planner: Create/Edit own versions
     * - Finance Controller: Approve versions, trigger SAC writeback
     * - Operations Manager: Read-only access
     */
    @odata.draft.enabled
    entity PlanningVersions as projection on db.PLANNING_VERSION {
        *,
        lines           : redirected to PlanningLines,
        calculations    : redirected to DemandCalculations
    } actions {
        /**
         * Submit version for approval
         * Transitions: Draft → In Review
         * Requires all lines to have valid data
         */
        action submit() returns PlanningVersions;

        /**
         * Approve version
         * Transitions: In Review → Approved
         * Triggers SAC writeback preparation
         */
        action approve() returns PlanningVersions;

        /**
         * Lock version (make read-only)
         * Transitions: Approved → Locked
         * Triggers SAC writeback execution
         */
        action lock() returns PlanningVersions;

        /**
         * Reject version back to draft
         * Transitions: In Review → Draft
         */
        action reject(reason: String) returns PlanningVersions;

        /**
         * Copy version to create new scenario
         * Creates a new version with copied data
         */
        action copyToScenario(newVersionName: String, versionType: String) returns PlanningVersions;

        /**
         * Calculate all demand for this version
         * Uses flight schedule and Route-Aircraft Matrix
         */
        action calculateDemand() returns DemandCalculationSummary;

        /**
         * Apply price assumptions from Contracts/CPE
         * Updates all planning lines with current prices
         */
        action applyPricing() returns PricingApplicationResult;

        /**
         * Trigger SAC writeback
         * Sends approved budget data to SAP Analytics Cloud
         */
        action writebackToSAC() returns SACWritebackResult;
    };

    // ========================================================================
    // PLANNING LINES - Detailed Planning Data
    // ========================================================================

    /**
     * PlanningLines - Period/Station level planning data
     * Aggregated demand and cost projections
     */
    entity PlanningLines as projection on db.PLANNING_LINE {
        *,
        version     : redirected to PlanningVersions,
        airport     : redirected to Airports,
        currency    : redirected to Currencies
    };

    // ========================================================================
    // DEMAND CALCULATION
    // ========================================================================

    /**
     * DemandCalculations - Fuel demand results by flight/route
     */
    entity DemandCalculations as projection on db.DEMAND_CALCULATION {
        *,
        version         : redirected to PlanningVersions,
        flight_schedule : redirected to Flights,
        route           : redirected to Routes,
        aircraft_type   : redirected to Aircraft,
        matrix_used     : redirected to RouteAircraftMatrix
    };

    // ========================================================================
    // ROUTE-AIRCRAFT MATRIX
    // ========================================================================

    /**
     * RouteAircraftMatrix - Standard fuel consumption by route/aircraft
     * Managed by Fuel Planner
     *
     * Formula: Total = Trip + Taxi + Contingency + Alternate + Reserve + Extra
     */
    @odata.draft.enabled
    entity RouteAircraftMatrix as projection on db.ROUTE_AIRCRAFT_MATRIX {
        *,
        route           : redirected to Routes,
        aircraft_type   : redirected to Aircraft
    } actions {
        /**
         * Calculate total standard fuel
         * Sums all fuel components
         */
        action calculateTotal() returns RouteAircraftMatrix;

        /**
         * Copy matrix entry for new aircraft type
         */
        action copyForAircraft(targetAircraftType: String) returns RouteAircraftMatrix;

        /**
         * Apply seasonal adjustment
         */
        action applySeasonal(season: String) returns RouteAircraftMatrix;
    };

    // ========================================================================
    // PRICE ASSUMPTIONS
    // ========================================================================

    /**
     * PriceAssumptions - Price forecasts for planning
     */
    entity PriceAssumptions as projection on db.PRICE_ASSUMPTION {
        *,
        version         : redirected to PlanningVersions,
        airport         : redirected to Airports,
        product         : redirected to Products,
        currency        : redirected to Currencies,
        source_contract : redirected to Contracts,
        source_formula  : redirected to PricingFormulas,
        base_index      : redirected to MarketIndices
    } actions {
        /**
         * Derive price from Contracts/CPE module
         */
        action deriveFromCPE() returns PriceAssumptions;
    };

    // ========================================================================
    // SCENARIO COMPARISON
    // ========================================================================

    /**
     * ScenarioComparisons - Version comparison analysis
     */
    entity ScenarioComparisons as projection on db.SCENARIO_COMPARISON {
        *,
        base_version    : redirected to PlanningVersions,
        compare_version : redirected to PlanningVersions
    } actions {
        /**
         * Run comparison analysis
         * Calculates variances between versions
         */
        action runComparison() returns ScenarioComparisons;

        /**
         * Export comparison to Excel
         */
        action exportToExcel() returns ExportResult;
    };

    // ========================================================================
    // REFERENCE DATA (Read-only from Master Data)
    // ========================================================================

    @readonly
    entity Flights as projection on db.FLIGHT_SCHEDULE {
        *,
        aircraft    : redirected to Aircraft,
        origin      : redirected to Airports,
        destination : redirected to Airports
    };

    @readonly
    entity Airports as projection on db.MASTER_AIRPORTS {
        *,
        country : redirected to Countries,
        plant   : redirected to Plants
    };

    @readonly
    entity Routes as projection on db.ROUTE_MASTER {
        *,
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
    entity Products as projection on db.MASTER_PRODUCTS {
        *,
        uom : redirected to UnitsOfMeasure
    };

    @readonly
    entity Contracts as projection on db.MASTER_CONTRACTS {
        *,
        supplier : redirected to Suppliers,
        currency : redirected to Currencies
    };

    @readonly
    entity PricingFormulas as projection on db.PRICING_FORMULA;

    @readonly
    entity MarketIndices as projection on db.MARKET_INDEX;

    @readonly
    entity Suppliers as projection on db.MASTER_SUPPLIERS;

    @readonly
    entity Countries as projection on db.T005_COUNTRY;

    @readonly
    entity Currencies as projection on db.CURRENCY_MASTER;

    @readonly
    entity Plants as projection on db.T001W_PLANT;

    @readonly
    entity UnitsOfMeasure as projection on db.UNIT_OF_MEASURE;

    // ========================================================================
    // SERVICE-LEVEL FUNCTIONS
    // ========================================================================

    /**
     * Generate next version ID
     * Format: PV-{TYPE}-{FISCAL_YEAR}-{SEQ}
     */
    function generateVersionId(versionType: String, fiscalYear: String) returns String;

    /**
     * Get planning summary by fiscal year
     */
    function getPlanningOverview(fiscalYear: String) returns PlanningOverview;

    /**
     * Compare multiple scenarios
     * Returns variance analysis across versions
     */
    function compareScenarios(versionIds: array of UUID) returns MultiScenarioComparison;

    /**
     * Calculate demand for a single route/aircraft
     * Uses Route-Aircraft Matrix
     */
    function calculateRouteDemand(
        routeCode: String,
        aircraftType: String,
        flightCount: Integer,
        season: String
    ) returns RouteDemandResult;

    /**
     * Get price forecast for planning
     * Retrieves prices from Contracts/CPE module
     */
    function getPriceforecast(
        airportCode: String,
        productCode: String,
        fromDate: Date,
        toDate: Date
    ) returns array of PriceForecastResult;

    /**
     * Import SSIM flight schedule
     * Parses SSIM file and creates flight records
     */
    action importSSIMSchedule(
        fileContent: LargeBinary,
        fileName: String,
        effectiveFrom: Date,
        effectiveTo: Date
    ) returns SSIMImportResult;

    // ========================================================================
    // TYPE DEFINITIONS
    // ========================================================================

    type DemandCalculationSummary {
        success             : Boolean;
        versionId           : String(20);
        totalFlights        : Integer;
        totalRoutes         : Integer;
        totalDemandKg       : Decimal(18,2);
        calculationsCreated : Integer;
        calculationErrors   : Integer;
        message             : String(500);
    };

    type PricingApplicationResult {
        success             : Boolean;
        versionId           : String(20);
        linesUpdated        : Integer;
        totalCostProjected  : Decimal(18,2);
        currency            : String(3);
        priceSource         : String(20);
        message             : String(500);
    };

    type SACWritebackResult {
        success             : Boolean;
        versionId           : String(20);
        sacModelId          : String(100);
        recordsWritten      : Integer;
        writebackTimestamp  : Timestamp;
        status              : String(20);
        message             : String(500);
    };

    type PlanningOverview {
        fiscalYear          : String(4);
        totalVersions       : Integer;
        approvedVersions    : Integer;
        draftVersions       : Integer;
        totalPlannedVolume  : Decimal(18,2);
        totalPlannedCost    : Decimal(18,2);
        currency            : String(3);
        stationsCovered     : Integer;
        byVersionType       : array of VersionTypeSummary;
    };

    type VersionTypeSummary {
        versionType         : String(20);
        count               : Integer;
        totalVolume         : Decimal(18,2);
        totalCost           : Decimal(18,2);
    };

    type MultiScenarioComparison {
        success             : Boolean;
        versionsCompared    : Integer;
        baseVersionId       : String(20);
        variances           : array of ScenarioVariance;
        summary             : String(1000);
    };

    type ScenarioVariance {
        versionId           : String(20);
        versionName         : String(100);
        versionType         : String(20);
        totalVolume         : Decimal(18,2);
        totalCost           : Decimal(18,2);
        volumeVariance      : Decimal(18,2);
        volumeVariancePct   : Decimal(5,2);
        costVariance        : Decimal(18,2);
        costVariancePct     : Decimal(5,2);
    };

    type RouteDemandResult {
        success             : Boolean;
        routeCode           : String(20);
        aircraftType        : String(10);
        tripFuel            : Decimal(12,2);
        taxiFuel            : Decimal(10,2);
        contingencyFuel     : Decimal(10,2);
        alternateFuel       : Decimal(10,2);
        reserveFuel         : Decimal(10,2);
        totalPerFlight      : Decimal(12,2);
        flightCount         : Integer;
        seasonalFactor      : Decimal(5,4);
        totalDemand         : Decimal(15,2);
        uom                 : String(3);
    };

    type PriceForecastResult {
        period              : String(10);
        airportCode         : String(3);
        productCode         : String(20);
        unitPrice           : Decimal(15,4);
        currency            : String(3);
        priceSource         : String(20);
        baseIndexCode       : String(20);
        baseIndexValue      : Decimal(15,4);
        effectiveDate       : Date;
    };

    type SSIMImportResult {
        success             : Boolean;
        fileName            : String(255);
        recordsProcessed    : Integer;
        recordsImported     : Integer;
        recordsSkipped      : Integer;
        recordsFailed       : Integer;
        errors              : array of ImportError;
        message             : String(500);
    };

    type ImportError {
        lineNumber          : Integer;
        fieldName           : String(50);
        errorCode           : String(10);
        message             : String(500);
    };

    type ExportResult {
        success             : Boolean;
        fileName            : String(255);
        fileSize            : Integer;
        downloadUrl         : String(500);
        message             : String(500);
    };

    // ========================================================================
    // FLIGHT RECORDS MONITOR TYPES (for FlightRecordsMonitor TSX)
    // ========================================================================

    /**
     * KPI tiles for Flight Records Monitor
     * Shows record counts by validation status
     */
    type FlightRecordKPIs {
        totalRecords            : Integer;          // Total flight records in period
        validatedRecords        : Integer;          // Status = Validated
        pendingRecords          : Integer;          // Status = Pending
        errorRecords            : Integer;          // Status = Error
        todayReceived           : Integer;          // Records received today
        validatedPct            : Decimal(5,2);     // Validated percentage
    };

    /**
     * Flight record row for the monitor table
     * Represents an ingested flight record from OPS-ESB or manual upload
     */
    type FlightRecordItem {
        id                      : UUID;
        flightDate              : Date;             // Flight operating date
        carrierCode             : String(3);        // IATA carrier code (e.g. "EY")
        flightNumber            : String(10);       // Flight number (e.g. "EY101")
        flightSuffix            : String(2);        // Optional suffix
        departureAirport        : String(3);        // IATA departure airport
        arrivalAirport          : String(3);        // IATA arrival airport
        sobt                    : DateTime;         // Scheduled Off-Block Time (UTC)
        aircraftTypeIATA        : String(4);        // IATA aircraft type code (e.g. "773")
        tailNumber              : String(10);       // Aircraft registration
        validationStatus        : String(10);       // Validated, Pending, Error, New, Deleted
        dataSource              : String(10);       // OPS-ESB (auto), Manual
        replicationTimestamp    : DateTime;         // When record was received
    };

    /**
     * Upload result for manual flight record Excel upload
     * Returned after upload completes with batch tracking
     */
    type FlightRecordUploadResult {
        success                 : Boolean;
        batchId                 : String(25);       // e.g. "UPL-2025112800001"
        fileName                : String(255);
        totalRecords            : Integer;          // Total records in file
        successRecords          : Integer;          // Successfully imported
        warningRecords          : Integer;          // Imported with warnings
        errorRecords            : Integer;          // Failed validation (skipped)
        errors                  : array of ImportError;
        message                 : String(500);
    };

    /**
     * Pre-upload validation summary
     * Returned after file selection before upload confirmation
     */
    type FlightRecordValidationSummary {
        readyRecords            : Integer;          // Records ready to upload
        warnings                : Integer;          // Records with warnings
        errors                  : Integer;          // Records with errors
        errorDetails            : String(500);      // Summary of error details
    };

    function getFlightRecordKPIs(dateRange: String) returns FlightRecordKPIs;
    function getFlightRecords(
        dateRange               : String,
        carrierFilter           : String,
        flightNumberFilter      : String,
        statusFilter            : String,
        sourceFilter            : String,
        routeFilter             : String,
        skip                    : Integer,
        top                     : Integer
    ) returns array of FlightRecordItem;

    /**
     * Upload flight records from Excel file
     */
    action uploadFlightRecords(
        fileContent             : LargeBinary,
        fileName                : String,
        skipErrors              : Boolean
    ) returns FlightRecordUploadResult;

    /**
     * Validate uploaded file before committing
     * Returns pre-upload validation summary
     */
    action validateFlightRecordFile(
        fileContent             : LargeBinary,
        fileName                : String
    ) returns FlightRecordValidationSummary;

    /**
     * Export flight records to Excel
     */
    action exportFlightRecords(
        dateRange               : String,
        carrierFilter           : String,
        statusFilter            : String,
        sourceFilter            : String,
        format                  : String
    ) returns ExportResult;

    // ========================================================================
    // FLIGHT RECORD DETAIL TYPES (for FlightRecordDetails TSX)
    // ========================================================================

    /**
     * Full flight record detail for the Object Page view
     * Extends FlightRecordItem with route, schedule, aircraft, and capacity data
     */
    type FlightRecordDetail {
        // Flight Identifiers
        id                      : UUID;
        uniqueFlightId          : String(30);       // Unique flight identifier
        serviceType             : String(5);        // J=Scheduled, G=Charter, etc.
        carrierCode             : String(3);        // IATA carrier code
        flightNumber            : String(10);       // Flight number
        flightSuffix            : String(2);        // Optional suffix
        flightDate              : Date;             // Flight operating date
        // Route Details
        departureAirport        : String(3);        // IATA departure code
        departureName           : String(100);      // Full departure airport name
        arrivalAirport          : String(3);        // IATA arrival code
        arrivalName             : String(100);      // Full arrival airport name
        viaAirport              : String(3);        // Via/stopover airport code
        flightDistance           : Integer;          // Distance in nautical miles
        // Schedule & Times (UTC)
        sobt                    : DateTime;         // Scheduled Off-Block Time
        sibt                    : DateTime;         // Scheduled In-Block Time
        blockHours              : Decimal(5,2);     // Block time in hours
        // Aircraft
        aircraftTypeIATA        : String(4);        // IATA aircraft type (e.g. "773")
        aircraftTypeICAO        : String(4);        // ICAO aircraft type (e.g. "B773")
        tailNumber              : String(10);       // Aircraft registration
        totalSeats              : Integer;          // Total seat capacity
        // Status & Source
        validationStatus        : String(10);       // Validated, Pending, Error, New, Deleted
        dataSource              : String(10);       // OPS-ESB, Manual
        replicationTimestamp    : DateTime;         // When record was received
    };

    /**
     * Flight record validation error
     * Displayed in the Validation tab when status = Error
     */
    type FlightRecordValidationError {
        errorCode               : String(10);       // e.g. "FR004"
        errorMessage            : String(500);      // e.g. "Master data not found: Airport - BOM"
        fieldName               : String(50);       // Field that failed validation
        fieldValue              : String(100);      // Value that caused the error
        severity                : String(10);       // Error, Warning
    };

    /**
     * Flight record change log entry for audit trail
     * Displayed in the Change Log tab
     */
    type FlightRecordChangeLogEntry {
        timestamp               : DateTime;         // When the change occurred
        changedBy               : String(100);      // User or system that made change
        changeType              : String(20);       // Create, Update, Delete
        fieldChanged            : String(50);       // Field that was changed
        oldValue                : String(200);      // Previous value
        newValue                : String(200);      // New value
        changeSource            : String(20);       // OPS-ESB, Manual, Validation, System
    };

    function getFlightRecordDetail(recordId: UUID) returns FlightRecordDetail;
    function getFlightRecordValidationErrors(recordId: UUID) returns array of FlightRecordValidationError;
    function getFlightRecordChangeLog(recordId: UUID) returns array of FlightRecordChangeLogEntry;

    /**
     * Retry validation on a flight record
     */
    action retryFlightRecordValidation(recordId: UUID) returns FlightRecordDetail;

    /**
     * Delete a flight record
     */
    action deleteFlightRecord(recordId: UUID) returns Boolean;

    // ========================================================================
    // ERROR CODES (FDD-02)
    // ========================================================================
    // PLN401 - Version not found
    // PLN402 - Version status invalid for operation
    // PLN403 - Missing required flight schedule
    // PLN404 - Route-Aircraft Matrix not found
    // PLN405 - Price assumption missing for station/period
    // PLN410 - SSIM file parsing error
    // PLN411 - Invalid SSIM record format
    // PLN420 - SAC connection failed
    // PLN421 - SAC writeback failed
    // PLN422 - SAC model not configured
}

/**
 * FuelSphere - Cost Allocation Service (FDD-09)
 *
 * Flight-level fuel cost assignment and S/4HANA CO integration:
 * - Flight cost calculation with component breakdown
 * - Cost allocation to cost centers, profit centers, internal orders
 * - Period-end accrual processing
 * - Settlement to S/4HANA Controlling (CO)
 * - CO-PA profitability analysis characteristics
 *
 * Core Formula: Flight Cost = (Qty x Price) + Taxes + Into-Plane Fees + Surcharges
 *
 * Service Path: /odata/v4/allocation
 */

using { fuelsphere as db } from '../db/schema';

@path: '/odata/v4/allocation'
service CostAllocationService {

    // ========================================================================
    // FLIGHT COSTS
    // ========================================================================

    /**
     * FlightCosts - Flight-Level Cost Breakdown
     * Calculated from fuel deliveries and contract pricing
     *
     * Access:
     * - Finance Controller: Full access (CostAllocationAdmin)
     * - Cost Accountant: Edit access (CostAllocationEdit)
     * - Operations Manager: View access (CostAllocationView)
     */
    entity FlightCosts as projection on db.FLIGHT_COSTS {
        *,
        flight              : redirected to Flights,
        fuel_delivery       : redirected to FuelDeliveries,
        fuel_order          : redirected to FuelOrders,
        invoice             : redirected to Invoices,
        contract            : redirected to Contracts,
        pricing_formula     : redirected to PricingFormulas,
        currency            : redirected to Currencies,
        origin_airport      : redirected to Airports,
        destination_airport : redirected to Airports,
        route               : redirected to Routes
    } actions {
        /**
         * Recalculate flight cost
         * Updates cost components based on current pricing
         */
        action recalculate() returns FlightCosts;

        /**
         * Allocate this flight cost to CO
         */
        action allocate() returns AllocationResult;
    };

    // ========================================================================
    // COST ALLOCATIONS
    // ========================================================================

    /**
     * CostAllocations - Cost Allocation Records
     * Posted to S/4HANA CO
     */
    @odata.draft.enabled
    entity CostAllocations as projection on db.COST_ALLOCATIONS {
        *,
        flight              : redirected to Flights,
        flight_cost         : redirected to FlightCosts,
        invoice             : redirected to Invoices,
        fuel_delivery       : redirected to FuelDeliveries,
        currency            : redirected to Currencies,
        allocation_rule     : redirected to AllocationRules,
        original_allocation : redirected to CostAllocations
    } actions {
        /**
         * Post allocation to S/4HANA CO
         */
        action postToS4HANA() returns PostingResult;

        /**
         * Reverse posted allocation
         */
        action reverse(reason: String) returns CostAllocations;

        /**
         * Approve allocation
         */
        action approve() returns CostAllocations;

        /**
         * Reject allocation
         */
        action reject(reason: String) returns CostAllocations;
    };

    // ========================================================================
    // ALLOCATION RULES
    // ========================================================================

    /**
     * AllocationRules - Allocation Rule Configuration
     * Managed by Finance Controller
     */
    @odata.draft.enabled
    entity AllocationRules as projection on db.ALLOCATION_RULES actions {
        /**
         * Validate rule configuration
         */
        action validate() returns RuleValidationResult;

        /**
         * Copy rule to new company code
         */
        action copyRule(newRuleCode: String, targetCompanyCode: String) returns AllocationRules;

        /**
         * Test rule with sample data
         */
        action testRule(flightCostId: UUID) returns RuleTestResult;
    };

    // ========================================================================
    // ALLOCATION RUNS
    // ========================================================================

    /**
     * AllocationRuns - Batch Run Management
     */
    @odata.draft.enabled
    entity AllocationRuns as projection on db.ALLOCATION_RUNS actions {
        /**
         * Start allocation run
         */
        action start() returns AllocationRuns;

        /**
         * Cancel running allocation
         */
        action cancel() returns AllocationRuns;

        /**
         * Approve completed run
         */
        action approve() returns AllocationRuns;

        /**
         * Reject completed run
         */
        action reject(reason: String) returns AllocationRuns;

        /**
         * Post all allocations from run to S/4HANA
         */
        action postAllToS4HANA() returns BatchPostingResult;

        /**
         * Retry failed allocations
         */
        action retryFailed() returns AllocationRuns;
    };

    // ========================================================================
    // COST CENTER MAPPING
    // ========================================================================

    /**
     * CostCenterMappings - Station to Cost Center Mapping
     */
    @odata.draft.enabled
    entity CostCenterMappings as projection on db.COST_CENTER_MAPPING {
        *,
        airport : redirected to Airports
    } actions {
        /**
         * Sync cost center details from S/4HANA
         */
        action syncFromS4HANA() returns CostCenterMappings;
    };

    // ========================================================================
    // ACCRUAL MANAGEMENT
    // ========================================================================

    /**
     * AccrualEntries - Period-End Accruals
     */
    entity AccrualEntries as projection on db.ACCRUAL_ENTRIES {
        *,
        fuel_delivery       : redirected to FuelDeliveries,
        flight              : redirected to Flights,
        allocation          : redirected to CostAllocations,
        reversal_allocation : redirected to CostAllocations,
        invoice             : redirected to Invoices
    } actions {
        /**
         * Reverse accrual on invoice receipt
         */
        action reverseOnInvoice(invoiceId: UUID) returns AccrualEntries;
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
    entity Aircraft as projection on db.AIRCRAFT_MASTER;

    @readonly
    entity Airports as projection on db.MASTER_AIRPORTS;

    @readonly
    entity Routes as projection on db.ROUTE_MASTER;

    @readonly
    entity FuelDeliveries as projection on db.FUEL_DELIVERIES;

    @readonly
    entity FuelOrders as projection on db.FUEL_ORDERS;

    @readonly
    entity Invoices as projection on db.INVOICES;

    @readonly
    entity Contracts as projection on db.MASTER_CONTRACTS;

    @readonly
    entity PricingFormulas as projection on db.PRICING_FORMULA;

    @readonly
    entity Currencies as projection on db.CURRENCY_MASTER;

    // ========================================================================
    // SERVICE-LEVEL ACTIONS
    // ========================================================================

    /**
     * Calculate flight cost for a delivery
     */
    action calculateFlightCost(
        flightId: UUID,
        deliveryId: UUID
    ) returns FlightCostResult;

    /**
     * Execute allocation run for period
     */
    action executeAllocationRun(
        companyCode: String,
        period: String,
        allocationType: String
    ) returns AllocationRunResult;

    /**
     * Batch post allocations to S/4HANA
     */
    action batchPostToS4HANA(allocationIds: array of UUID) returns BatchPostingResult;

    /**
     * Create period-end accruals
     */
    action createAccruals(
        period: String,
        companyCode: String
    ) returns AccrualCreationResult;

    /**
     * Reverse accruals for period
     */
    action reverseAccruals(
        period: String,
        companyCode: String
    ) returns AccrualReversalResult;

    /**
     * Sync cost centers from S/4HANA
     */
    action syncCostCentersFromS4HANA(companyCode: String) returns SyncResult;

    /**
     * Create Statistical Internal Order in S/4HANA
     */
    action createInternalOrder(
        flightId: UUID,
        orderType: String
    ) returns InternalOrderResult;

    // ========================================================================
    // SERVICE-LEVEL FUNCTIONS
    // ========================================================================

    /**
     * Get allocation dashboard KPIs
     */
    function getDashboardKPIs(
        companyCode: String,
        period: String
    ) returns AllocationDashboardKPIs;

    /**
     * Get period allocation status
     */
    function getPeriodStatus(
        companyCode: String,
        period: String
    ) returns PeriodAllocationStatus;

    /**
     * Get unallocated flight costs
     */
    function getUnallocatedFlightCosts(
        companyCode: String,
        period: String
    ) returns array of UnallocatedFlightCost;

    /**
     * Get pending accruals
     */
    function getPendingAccruals(
        companyCode: String,
        period: String
    ) returns array of PendingAccrual;

    /**
     * Get allocation variance analysis
     */
    function getVarianceAnalysis(
        companyCode: String,
        period: String,
        groupBy: String
    ) returns array of VarianceAnalysisItem;

    /**
     * Get cost center allocation summary
     */
    function getCostCenterSummary(
        companyCode: String,
        period: String
    ) returns array of CostCenterSummary;

    /**
     * Get profit center allocation summary
     */
    function getProfitCenterSummary(
        companyCode: String,
        period: String
    ) returns array of ProfitCenterSummary;

    /**
     * Get route profitability
     */
    function getRouteProfitability(
        companyCode: String,
        fromPeriod: String,
        toPeriod: String
    ) returns array of RouteProfitability;

    /**
     * Get allocation history for flight
     */
    function getFlightAllocationHistory(flightId: UUID) returns array of CostAllocations;

    /**
     * Generate next run number
     */
    function generateRunNumber(companyCode: String, period: String) returns String;

    /**
     * Derive cost center for station
     */
    function deriveCostCenter(
        airportCode: String,
        companyCode: String,
        asOfDate: Date
    ) returns CostCenterDerivation;

    // ========================================================================
    // TYPE DEFINITIONS
    // ========================================================================

    type FlightCostResult {
        success             : Boolean;
        flightCostId        : UUID;
        flightNumber        : String(10);
        deliveryNumber      : String(25);
        fuelQuantityKg      : Decimal(12,2);
        unitPrice           : Decimal(15,4);
        baseFuelCost        : Decimal(15,2);
        taxAmount           : Decimal(15,2);
        intoPlaneFees       : Decimal(15,2);
        surchargeAmount     : Decimal(15,2);
        totalCost           : Decimal(15,2);
        currency            : String(3);
        message             : String(500);
    };

    type AllocationResult {
        success             : Boolean;
        allocationId        : UUID;
        flightCostId        : UUID;
        costCenter          : String(10);
        profitCenter        : String(10);
        allocatedAmount     : Decimal(15,2);
        currency            : String(3);
        status              : String(20);
        message             : String(500);
    };

    type AllocationRunResult {
        success             : Boolean;
        runId               : UUID;
        runNumber           : String(20);
        companyCode         : String(4);
        period              : String(7);
        status              : String(20);
        totalFlights        : Integer;
        totalAllocations    : Integer;
        totalAmount         : Decimal(18,2);
        currency            : String(3);
        failedCount         : Integer;
        message             : String(500);
    };

    type PostingResult {
        success             : Boolean;
        allocationId        : UUID;
        s4DocumentNumber    : String(10);
        s4FiscalYear        : String(4);
        postingDate         : Date;
        amount              : Decimal(15,2);
        currency            : String(3);
        errorMessage        : String(500);
    };

    type BatchPostingResult {
        success             : Boolean;
        totalRequested      : Integer;
        postedCount         : Integer;
        failedCount         : Integer;
        results             : array of PostingResult;
        message             : String(500);
    };

    type RuleValidationResult {
        isValid             : Boolean;
        ruleCode            : String(20);
        issues              : array of ValidationIssue;
    };

    type ValidationIssue {
        field               : String(50);
        severity            : String(10);
        message             : String(500);
    };

    type RuleTestResult {
        success             : Boolean;
        ruleCode            : String(20);
        flightCostId        : UUID;
        derivedCostCenter   : String(10);
        derivedProfitCenter : String(10);
        allocatedAmount     : Decimal(15,2);
        message             : String(500);
    };

    type AccrualCreationResult {
        success             : Boolean;
        period              : String(7);
        companyCode         : String(4);
        accrualsCreated     : Integer;
        totalAccrualAmount  : Decimal(18,2);
        currency            : String(3);
        message             : String(500);
    };

    type AccrualReversalResult {
        success             : Boolean;
        period              : String(7);
        companyCode         : String(4);
        accrualsReversed    : Integer;
        totalReversalAmount : Decimal(18,2);
        currency            : String(3);
        message             : String(500);
    };

    type SyncResult {
        success             : Boolean;
        companyCode         : String(4);
        recordsSynced       : Integer;
        recordsAdded        : Integer;
        recordsUpdated      : Integer;
        message             : String(500);
    };

    type InternalOrderResult {
        success             : Boolean;
        flightId            : UUID;
        internalOrder       : String(12);
        orderType           : String(4);
        description         : String(40);
        message             : String(500);
    };

    type AllocationDashboardKPIs {
        companyCode         : String(4);
        period              : String(7);
        totalFlightCosts    : Integer;
        allocatedCosts      : Integer;
        unallocatedCosts    : Integer;
        totalAllocatedAmount : Decimal(18,2);
        totalUnallocatedAmount : Decimal(18,2);
        pendingApproval     : Integer;
        postedToS4          : Integer;
        failedPostings      : Integer;
        openAccruals        : Integer;
        accrualAmount       : Decimal(18,2);
        currency            : String(3);
    };

    type PeriodAllocationStatus {
        period              : String(7);
        companyCode         : String(4);
        isOpen              : Boolean;
        allocationComplete  : Boolean;
        accrualComplete     : Boolean;
        postingComplete     : Boolean;
        lastRunDate         : DateTime;
        lastRunStatus       : String(20);
    };

    type UnallocatedFlightCost {
        flightCostId        : UUID;
        flightNumber        : String(10);
        costDate            : Date;
        totalCost           : Decimal(15,2);
        currency            : String(3);
        originAirport       : String(3);
        destinationAirport  : String(3);
        reason              : String(100);
    };

    type PendingAccrual {
        deliveryId          : UUID;
        deliveryNumber      : String(25);
        deliveryDate        : Date;
        estimatedAmount     : Decimal(15,2);
        currency            : String(3);
        daysOutstanding     : Integer;
    };

    type VarianceAnalysisItem {
        groupKey            : String(50);
        groupDescription    : String(100);
        plannedCost         : Decimal(18,2);
        actualCost          : Decimal(18,2);
        varianceAmount      : Decimal(18,2);
        variancePct         : Decimal(5,2);
        currency            : String(3);
    };

    type CostCenterSummary {
        costCenter          : String(10);
        costCenterName      : String(40);
        flightCount         : Integer;
        totalAmount         : Decimal(18,2);
        currency            : String(3);
    };

    type ProfitCenterSummary {
        profitCenter        : String(10);
        profitCenterName    : String(40);
        flightCount         : Integer;
        totalAmount         : Decimal(18,2);
        currency            : String(3);
    };

    type RouteProfitability {
        routeCode           : String(20);
        originAirport       : String(3);
        destinationAirport  : String(3);
        flightCount         : Integer;
        totalFuelCost       : Decimal(18,2);
        avgCostPerFlight    : Decimal(15,2);
        avgCostPerKg        : Decimal(15,4);
        currency            : String(3);
    };

    type CostCenterDerivation {
        success             : Boolean;
        airportCode         : String(3);
        companyCode         : String(4);
        costCenter          : String(10);
        costCenterName      : String(40);
        profitCenter        : String(10);
        profitCenterName    : String(40);
        mappingId           : UUID;
        message             : String(500);
    };

    // ========================================================================
    // ERROR CODES (FDD-09)
    // ========================================================================
    // CA401 - Flight not found for cost allocation
    // CA402 - Cost center mapping not found for station
    // CA403 - Invalid allocation rule configuration
    // CA404 - S/4HANA CO posting failed
    // CA405 - Posting period closed in S/4HANA
    // CA406 - Internal Order creation failed
    // CA407 - Accrual reversal not allowed (already reversed)
    // CA408 - Currency conversion error
    // CA409 - Duplicate allocation detected
    // CA410 - Settlement rule validation failed
}

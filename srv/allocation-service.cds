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
    // FUEL RECONCILIATION DASHBOARD TYPES (for FuelReconciliationDashboard TSX)
    // ========================================================================

    /**
     * Allocation run item for reconciliation dashboard table
     * Used by: FuelReconciliationDashboard allocation runs table
     */
    type AllocationRunItem {
        batchId             : String(25);       // ALO-{YYYYMMDD}-{SEQ}
        timestamp           : String(30);       // Display timestamp
        tail                : String(20);       // Aircraft tail number
        method              : String(20);       // Planned Quantity, Planned Value, Uplift-Based, Block-Time
        flights             : Integer;          // Number of flights in batch
        totalBurn           : Decimal(12,0);    // Total fuel burn (kg)
        variance            : Decimal(5,2);     // Variance % (positive = over, negative = under)
        status              : String(20);       // completed, pendingReview, highVariance, failed, reversed, inProgress
    };

    /**
     * Posting audit trail record
     * Used by: FuelReconciliationDashboard posting audit table
     */
    type PostingAuditItem {
        fiDocument          : String(10);       // S/4HANA FI document number
        batchId             : String(25);       // Allocation batch ID
        postingDate         : String(30);       // Display posting date
        tail                : String(20);       // Aircraft tail
        glAccount           : String(10);       // G/L account
        amount              : Decimal(15,2);    // Posted amount
        currency            : String(3);
        reversalStatus      : String(20);       // notReversed, reversed, pendingReversal, failed
        reversalDoc         : String(10);       // Reversal document number (if reversed)
    };

    /**
     * Variance trend data for area chart
     * Used by: FuelReconciliationDashboard variance trend chart
     */
    type AllocationVarianceTrendItem {
        date                : String(10);       // Display date label
        avgVariance         : Decimal(5,2);     // Average variance %
        maxVariance         : Decimal(5,2);     // Maximum variance %
        minVariance         : Decimal(5,2);     // Minimum variance %
    };

    /**
     * Allocation method breakdown for pie chart
     * Used by: FuelReconciliationDashboard method breakdown
     */
    type AllocationMethodBreakdownItem {
        method              : String(20);       // Planned Quantity, Planned Value, Uplift-Based, Block-Time
        runs                : Integer;          // Number of runs using this method
        percentage          : Decimal(5,2);     // Share of total %
    };

    /**
     * Variance distribution for summary
     * Used by: FuelReconciliationDashboard variance distribution
     */
    type AllocationVarianceDistributionItem {
        category            : String(30);       // Within (<0.1%), Moderate (0.1-1%), High (>1%)
        count               : Integer;
        percentage          : Decimal(5,2);
    };

    // ========================================================================
    // FUEL RECONCILIATION DASHBOARD FUNCTIONS
    // ========================================================================

    /**
     * Get allocation run items for dashboard table
     */
    function getAllocationRunItems(
        fromDate: Date,
        toDate: Date,
        statusFilter: String,
        methodFilter: String,
        tailFilter: String
    ) returns array of AllocationRunItem;

    /**
     * Get posting audit trail
     */
    function getPostingAuditTrail(fromDate: Date, toDate: Date) returns array of PostingAuditItem;

    /**
     * Get allocation variance trend for chart
     */
    function getAllocationVarianceTrend(days: Integer) returns array of AllocationVarianceTrendItem;

    /**
     * Get allocation method breakdown
     */
    function getAllocationMethodBreakdown(fromDate: Date, toDate: Date) returns array of AllocationMethodBreakdownItem;

    /**
     * Get allocation variance distribution
     */
    function getAllocationVarianceDistribution(fromDate: Date, toDate: Date) returns array of AllocationVarianceDistributionItem;

    // ========================================================================
    // ALLOCATION VS ACTUAL RECONCILIATION TYPES (for AllocationVsActualReconciliation TSX)
    // ========================================================================

    /**
     * KPIs for allocation vs actual reconciliation view
     * Used by: AllocationVsActualReconciliation summary cards
     */
    type AllocationReconciliationKPIs {
        totalFlightLegs     : Integer;          // Total flight legs in period
        allocatedLegs       : Integer;          // Legs with allocation posted
        actualLegs          : Integer;          // Legs with actual burn received
        legsVsLastWeekPct   : Decimal(5,2);     // % change vs last week
        matchRate           : Decimal(5,2);     // % of legs within tolerance (≤0.1%)
        matchRateTarget     : Decimal(5,2);     // Target match rate
        avgAbsVariance      : Decimal(5,2);     // Average absolute variance %
        avgAllocatedKg      : Decimal(12,2);    // Average allocated qty (kg)
        avgActualKg         : Decimal(12,2);    // Average actual qty (kg)
        highVarianceCases   : Integer;          // Cases with >1% variance
        pendingReview       : Integer;          // High variance pending review
        approvedVariances   : Integer;          // Approved high variance cases
    };

    /**
     * Flight leg reconciliation record comparing allocated vs actual
     * Used by: AllocationVsActualReconciliation flight leg table
     */
    type ReconciliationLegItem {
        flight              : String(10);       // Flight number
        leg                 : String(15);       // Route leg (e.g. JFK-LHR)
        tail                : String(20);       // Aircraft tail number
        date                : String(10);       // Display date
        method              : String(20);       // Planned Quantity, Planned Value, Uplift-Based, Block-Time
        allocated           : Decimal(12,2);    // Allocated quantity (kg)
        actual              : Decimal(12,2);    // Actual quantity (kg), null if pending
        variance            : Decimal(5,2);     // Variance percentage
        varianceKg          : Decimal(12,2);    // Variance in kg
        status              : String(20);       // reconciled, pendingActual, moderateVariance, highVariance, dataMissing, varianceApproved
    };

    /**
     * Financial posting reversal record
     * Used by: AllocationVsActualReconciliation reversal tracking table
     */
    type AllocationReversalItem {
        batchId             : String(25);       // Allocation batch ID
        flightLeg           : String(30);       // Flight/Leg display (e.g. AA1234/JFK-LHR)
        tail                : String(20);       // Aircraft tail
        allocationPosted    : String(30);       // Allocation posted timestamp
        fiDocAlloc          : String(10);       // FI document (allocation)
        amount              : Decimal(15,2);    // Posted amount
        actualReceived      : String(30);       // Actual received timestamp (null if not yet)
        reversalStatus      : String(20);       // reversed, pendingReversal, active, failed, approved
        fiDocRev            : String(10);       // FI document (reversal), null if not reversed
    };

    /**
     * Variance analysis by allocation method for bar chart
     * Used by: AllocationVsActualReconciliation variance by method chart
     */
    type VarianceByMethodItem {
        method              : String(20);       // Allocation method name
        avgVariance         : Decimal(5,2);     // Average variance %
        legCount            : Integer;          // Number of legs using this method
    };

    /**
     * Variance heatmap cell for route/method or tail/method matrix
     * Used by: AllocationVsActualReconciliation variance heatmap
     */
    type VarianceHeatmapItem {
        route               : String(15);       // Route code (or tail number if viewType=tail)
        method              : String(20);       // Allocation method
        variance            : Decimal(5,2);     // Variance % (null = N/A)
    };

    // ========================================================================
    // ALLOCATION VS ACTUAL RECONCILIATION FUNCTIONS & ACTIONS
    // ========================================================================

    /**
     * Get reconciliation KPIs for summary cards
     */
    function getReconciliationKPIs(fromDate: Date, toDate: Date) returns AllocationReconciliationKPIs;

    /**
     * Get flight leg reconciliation records
     */
    function getReconciliationLegs(
        fromDate: Date,
        toDate: Date,
        tailFilter: String,
        routeFilter: String,
        statusFilter: String,
        varianceFilter: String,
        methodFilter: String
    ) returns array of ReconciliationLegItem;

    /**
     * Get financial posting reversal records
     */
    function getAllocationReversals(fromDate: Date, toDate: Date) returns array of AllocationReversalItem;

    /**
     * Get variance analysis grouped by allocation method
     */
    function getVarianceByMethod(days: Integer) returns array of VarianceByMethodItem;

    /**
     * Get variance heatmap data (by route or tail)
     */
    function getVarianceHeatmap(fromDate: Date, toDate: Date, viewType: String) returns array of VarianceHeatmapItem;

    /**
     * Retry a failed reversal posting
     */
    action retryReversal(batchId: String) returns AllocationReversalItem;

    /**
     * Trigger reversal for a pending batch
     */
    action triggerReversal(batchId: String) returns AllocationReversalItem;

    // ========================================================================
    // ALLOCATION DETAIL REPORT TYPES (for AllocationDetailReport TSX)
    // ========================================================================

    /**
     * Batch summary header for allocation detail report
     * Used by: AllocationDetailReport batch summary card
     */
    type AllocationBatchSummary {
        batchId             : String(25);
        timestamp           : String(30);       // Display timestamp
        tail                : String(20);       // Aircraft tail
        method              : String(20);       // Allocation method
        totalFlights        : Integer;
        totalBurn           : Decimal(12,0);    // Total burn (kg)
        totalAllocated      : Decimal(15,2);    // Total allocated amount
        variance            : String(10);       // Display variance (e.g. +0.05%)
        status              : String(20);       // completed, pendingReview, failed
        executionTime       : String(10);       // e.g. 2.3s
    };

    /**
     * Sender cost center in allocation flow
     * Used by: AllocationDetailReport sender section
     */
    type SenderCostCenterItem {
        costCenter          : String(20);       // Cost center code
        costCenterName      : String(100);      // Cost center description
        tail                : String(20);       // Aircraft tail
        totalAllocated      : Decimal(15,2);    // Total allocated from this sender
        flightCount         : Integer;          // Number of flights
    };

    /**
     * Receiver flight with COPA characteristics
     * Used by: AllocationDetailReport flight-level burn table
     */
    type ReceiverFlightItem {
        flightNumber        : String(10);
        flightDate          : String(10);       // YYYY-MM-DD
        route               : String(20);       // e.g. SIN → HKG
        tail                : String(20);
        costCenter          : String(20);
        internalOrder       : String(30);       // Internal order number
        copaFlightNumber    : String(10);       // COPA characteristic: flight
        copaRoute           : String(20);       // COPA characteristic: route
        copaAircraftType    : String(10);       // COPA characteristic: aircraft type
        copaCostCenter      : String(20);       // COPA characteristic: cost center
        actualBurn          : Decimal(12,2);    // Actual burn (kg)
        allocatedAmount     : Decimal(15,2);    // Allocated cost
        blockTime           : Decimal(5,1);     // Block time (hours)
        departure           : String(5);        // HH:MM
        arrival             : String(5);        // HH:MM
    };

    /**
     * Sender-receiver allocation mapping line
     * Used by: AllocationDetailReport sender-receiver mapping table
     */
    type SenderReceiverAllocationItem {
        sender              : String(20);       // Sender cost center code
        senderName          : String(100);      // Sender cost center name
        receiver            : String(200);      // Receiver COPA characteristics string
        receiverName        : String(50);       // e.g. COPA Characteristics
        flightNumber        : String(10);
        route               : String(20);
        burnKg              : Decimal(12,2);    // Fuel burn (kg)
        allocatedAmount     : Decimal(15,2);    // Allocated cost
        percentage          : Decimal(5,2);     // Allocation share %
    };

    // ========================================================================
    // ALLOCATION DETAIL REPORT FUNCTIONS
    // ========================================================================

    /**
     * Get batch summary for allocation detail report
     */
    function getAllocationBatchSummary(batchId: String) returns AllocationBatchSummary;

    /**
     * Get sender cost centers for a batch
     */
    function getAllocationSenders(batchId: String) returns array of SenderCostCenterItem;

    /**
     * Get receiver flights with COPA characteristics
     */
    function getAllocationReceivers(batchId: String) returns array of ReceiverFlightItem;

    /**
     * Get sender-receiver allocation mapping
     */
    function getSenderReceiverMapping(batchId: String) returns array of SenderReceiverAllocationItem;

    // ========================================================================
    // COST ALLOCATION COPA TYPES (for CostAllocationCOPA TSX)
    // ========================================================================

    /**
     * Flight with cost allocation and CO-PA segment status
     * Used by: CostAllocationCOPA flight list table
     */
    type COPAFlightItem {
        flightId            : String(36);       // UUID
        flightNumber        : String(10);
        date                : String(10);       // YYYY-MM-DD
        route               : String(15);       // e.g. SIN-LHR
        origin              : String(3);        // IATA code
        destination         : String(3);        // IATA code
        aircraftType        : String(20);       // e.g. A350-900
        tailNumber          : String(20);
        fuelQuantity        : Decimal(12,0);    // Fuel quantity (liters)
        fuelCost            : Decimal(15,2);    // Fuel cost
        internalOrder       : String(30);       // Internal order (null if missing)
        internalOrderSource : String(10);       // Auto, Manual, Missing
        copaSegment         : String(20);       // CO-PA segment (null if missing)
        copaSegmentSource   : String(10);       // Auto, Manual, Missing
        status              : String(10);       // Valid, Missing, Review
    };

    /**
     * CO-PA profitability characteristic
     * Used by: CostAllocationCOPA segment assignment panel
     */
    type COPACharacteristicItem {
        name                : String(50);       // Characteristic name (Customer, Route, etc.)
        value               : String(100);      // Characteristic value
        source              : String(20);       // System, Flight Data, Order Data, Mapping
        status              : String(10);       // Valid, Error
    };

    /**
     * KPIs for CO-PA allocation summary
     * Used by: CostAllocationCOPA summary cards
     */
    type COPAAllocationKPIs {
        totalFlights        : Integer;
        allocatedFlights    : Integer;
        pendingFlights      : Integer;
        failedFlights       : Integer;
        allocatedPct        : Decimal(5,1);     // Allocated percentage
    };

    /**
     * GL entry line for posting preview
     * Used by: CostAllocationCOPA posting preview section
     */
    type PostingPreviewLine {
        drCr                : String(2);        // Dr or Cr
        glAccount           : String(50);       // GL account with description
        amount              : Decimal(15,2);
        costCenter          : String(50);       // Cost center with name (or dash)
        internalOrder       : String(30);       // Internal order (or dash)
        copaSegment         : String(50);       // CO-PA segment (or dash)
    };

    /**
     * Full posting preview for a flight
     * Used by: CostAllocationCOPA posting preview section
     */
    type PostingPreviewResult {
        documentType        : String(30);       // e.g. FI - Fuel Consumption
        postingDate         : Date;
        fiscalPeriod        : String(10);       // e.g. 10/2024
        companyCode         : String(4);
        currency            : String(3);
        documentTotal       : Decimal(15,2);
        lines               : array of PostingPreviewLine;
        copaSegmentDisplay  : String(50);       // Profitability segment
        operatingConcern    : String(10);       // e.g. FUEL
        routeProfitImpact   : Decimal(15,2);    // Negative = cost
    };

    // ========================================================================
    // COST ALLOCATION COPA FUNCTIONS & ACTIONS
    // ========================================================================

    /**
     * Get flights with CO-PA allocation status
     */
    function getCOPAFlights(
        fromDate: Date,
        toDate: Date,
        stationFilter: String,
        aircraftTypeFilter: String,
        statusFilter: String
    ) returns array of COPAFlightItem;

    /**
     * Get CO-PA characteristics for a flight
     */
    function getCOPACharacteristics(flightId: String) returns array of COPACharacteristicItem;

    /**
     * Get CO-PA allocation KPIs
     */
    function getCOPAAllocationKPIs(fromDate: Date, toDate: Date) returns COPAAllocationKPIs;

    /**
     * Get posting preview for a flight
     */
    function getPostingPreview(flightId: String) returns PostingPreviewResult;

    /**
     * Validate all flights for CO-PA allocation
     */
    action validateAllCOPAFlights(fromDate: Date, toDate: Date) returns COPAAllocationKPIs;

    /**
     * Allocate and post selected flights to S/4HANA CO-PA
     */
    action allocateAndPostCOPA(flightIds: array of String) returns BatchPostingResult;

    /**
     * Validate and save a single flight's allocation
     */
    action validateAndSaveCOPAFlight(
        flightId: String,
        internalOrder: String,
        costCenter: String,
        orderType: String
    ) returns COPAFlightItem;

    /**
     * Save draft allocation for a flight
     */
    action saveCOPADraft(
        flightId: String,
        internalOrder: String,
        costCenter: String,
        orderType: String
    ) returns COPAFlightItem;

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

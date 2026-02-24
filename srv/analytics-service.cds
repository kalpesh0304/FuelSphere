/**
 * FuelSphere - Reporting & Analytics Service (FDD-12)
 *
 * Enterprise-wide visibility into fuel operations:
 * - Executive dashboards with real-time KPI monitoring
 * - Embedded analytics using HANA Calculation Views
 * - SAP Analytics Cloud (SAC) integration for planning and BI
 * - Variance analysis for budget vs. actual comparisons
 * - Historical trend analysis and forecasting support
 * - Report generation and distribution
 *
 * Key KPIs:
 * - Invoice Processing Time (< 2 days)
 * - ePOD Digital Rate (100%)
 * - Integration Error Rate (< 5%)
 * - Budget Variance (± 5%)
 * - Fuel Burn Variance (± 3%)
 * - Three-Way Match Rate (> 85%)
 *
 * Service Path: /odata/v4/analytics
 */

using { fuelsphere as db } from '../db/schema';

@path: '/odata/v4/analytics'
service AnalyticsService {

    // ========================================================================
    // REPORT DEFINITIONS
    // ========================================================================

    /**
     * ReportDefinitions - Report Configuration and Templates
     * Managed by Business Analyst and System Administrator
     *
     * Access:
     * - Business Analyst: Edit report configurations (ReportDesign)
     * - Finance Controller: Execute reports (ReportView)
     * - All authorized users: View available reports
     */
    @odata.draft.enabled
    entity ReportDefinitions as projection on db.REPORT_DEFINITIONS actions {
        /**
         * Generate report with specified parameters
         */
        action generate(
            outputFormat: String,
            parameters: LargeString
        ) returns ReportGenerationResult;

        /**
         * Schedule report for recurring generation
         */
        action schedule(
            cronExpression: String,
            distributionList: String
        ) returns ReportDefinitions;

        /**
         * Clone report definition
         */
        action clone(newReportCode: String) returns ReportDefinitions;

        /**
         * Preview report with sample data
         */
        action preview(parameters: LargeString) returns ReportPreviewResult;
    };

    // ========================================================================
    // DASHBOARD CONFIGURATIONS
    // ========================================================================

    /**
     * DashboardConfigs - Dashboard Layout and Configuration
     * Managed by Business Analyst
     */
    @odata.draft.enabled
    entity DashboardConfigs as projection on db.DASHBOARD_CONFIGS actions {
        /**
         * Set as home page for persona
         */
        action setAsHomePage() returns DashboardConfigs;

        /**
         * Clone dashboard configuration
         */
        action clone(newDashboardCode: String) returns DashboardConfigs;

        /**
         * Export dashboard configuration
         */
        action exportConfig() returns DashboardExportResult;
    };

    // ========================================================================
    // KPI DEFINITIONS
    // ========================================================================

    /**
     * KPIDefinitions - KPI Configuration and Thresholds
     * Managed by Business Analyst with Finance Controller approval
     */
    @odata.draft.enabled
    entity KPIDefinitions as projection on db.KPI_DEFINITIONS actions {
        /**
         * Calculate current KPI value
         */
        action calculate(companyCode: String) returns KPICalculationResult;

        /**
         * Update thresholds
         */
        action updateThresholds(
            targetValue: Decimal,
            warningThreshold: Decimal,
            criticalThreshold: Decimal
        ) returns KPIDefinitions;

        /**
         * Test KPI calculation
         */
        action test(sampleData: LargeString) returns KPITestResult;
    };

    // ========================================================================
    // KPI VALUES (Historical)
    // ========================================================================

    /**
     * KPIValues - Calculated KPI Values History
     * Read-only historical data for trending
     */
    @readonly
    entity KPIValues as projection on db.KPI_VALUES {
        *,
        kpi_definition : redirected to KPIDefinitions
    };

    // ========================================================================
    // VARIANCE RECORDS
    // ========================================================================

    /**
     * VarianceRecords - Budget vs. Actual Variance Tracking
     * Core analytical entity for variance analysis
     */
    entity VarianceRecords as projection on db.VARIANCE_RECORDS actions {
        /**
         * Mark variance as analyzed
         */
        action analyze(
            rootCause: String,
            correctiveAction: String
        ) returns VarianceRecords;

        /**
         * Mark variance as reviewed
         */
        action review(reviewNotes: String) returns VarianceRecords;

        /**
         * Drill down to source transactions
         */
        action drillDown() returns VarianceDrillDownResult;
    };

    // ========================================================================
    // ANALYTICS SNAPSHOTS
    // ========================================================================

    /**
     * AnalyticsSnapshots - Point-in-Time Analytics Data
     * Historical snapshots for trend analysis
     */
    @readonly
    entity AnalyticsSnapshots as projection on db.ANALYTICS_SNAPSHOTS;

    // ========================================================================
    // SAC EXPORT LOGS
    // ========================================================================

    /**
     * SACExportLogs - SAP Analytics Cloud Export Tracking
     * Tracks data exports to SAC for planning writeback
     */
    entity SACExportLogs as projection on db.SAC_EXPORT_LOGS actions {
        /**
         * Approve SAC export (for budget writeback)
         */
        action approve(approvalNotes: String) returns SACExportLogs;

        /**
         * Reject SAC export
         */
        action reject(rejectionReason: String) returns SACExportLogs;

        /**
         * Retry failed export
         */
        action retry() returns SACExportLogs;
    };

    // ========================================================================
    // REPORT EXECUTIONS
    // ========================================================================

    /**
     * ReportExecutions - Report Generation History
     * Tracks all report generation requests
     */
    @readonly
    entity ReportExecutions as projection on db.REPORT_EXECUTIONS {
        *,
        report_definition : redirected to ReportDefinitions
    };

    // ========================================================================
    // CROSS-MODULE REFERENCE DATA (Read-only)
    // ========================================================================

    @readonly entity Airports as projection on db.MASTER_AIRPORTS;
    @readonly entity Suppliers as projection on db.MASTER_SUPPLIERS;
    @readonly entity Contracts as projection on db.MASTER_CONTRACTS;
    @readonly entity Invoices as projection on db.INVOICES;
    @readonly entity FuelDeliveries as projection on db.FUEL_DELIVERIES;
    @readonly entity FuelOrders as projection on db.FUEL_ORDERS;
    @readonly entity FlightCosts as projection on db.FLIGHT_COSTS;
    @readonly entity CostAllocations as projection on db.COST_ALLOCATIONS;
    @readonly entity FuelBurns as projection on db.FUEL_BURNS;

    // ========================================================================
    // SERVICE-LEVEL ACTIONS
    // ========================================================================

    /**
     * Calculate all KPIs for a company/period
     */
    action calculateAllKPIs(
        companyCode: String,
        period: String
    ) returns BatchKPIResult;

    /**
     * Calculate variance for period
     */
    action calculateVariance(
        period: String,
        companyCode: String,
        varianceType: String
    ) returns VarianceCalculationResult;

    /**
     * Export data to SAP Analytics Cloud
     */
    action exportToSAC(
        periodFrom: String,
        periodTo: String,
        companyCode: String,
        dataType: String,
        sacModelId: String
    ) returns SACExportResult;

    /**
     * Generate report
     */
    action generateReport(
        reportCode: String,
        outputFormat: String,
        parameters: LargeString
    ) returns ReportGenerationResult;

    /**
     * Refresh dashboard KPIs
     */
    action refreshDashboard(dashboardCode: String) returns DashboardRefreshResult;

    /**
     * Create analytics snapshot
     */
    action createSnapshot(
        snapshotType: String,
        companyCode: String,
        metricCategory: String
    ) returns SnapshotResult;

    /**
     * Archive old snapshots
     */
    action archiveSnapshots(olderThanDays: Integer) returns ArchiveResult;

    /**
     * Distribute report to recipients
     */
    action distributeReport(
        reportExecutionId: UUID,
        recipients: String
    ) returns DistributionResult;

    // ========================================================================
    // SERVICE-LEVEL FUNCTIONS
    // ========================================================================

    /**
     * Get dashboard summary with all KPIs
     */
    function getDashboardSummary(
        dashboardCode: String,
        companyCode: String
    ) returns DashboardSummary;

    /**
     * Get KPI trend data
     */
    function getKPITrend(
        kpiCode: String,
        companyCode: String,
        periodType: String,
        periods: Integer
    ) returns KPITrendData;

    /**
     * Get variance analysis summary
     */
    function getVarianceAnalysis(
        period: String,
        companyCode: String,
        groupBy: String
    ) returns array of VarianceAnalysisItem;

    /**
     * Get allocation vs actual reconciliation
     */
    function getAllocationReconciliation(
        period: String,
        companyCode: String
    ) returns AllocationReconciliation;

    /**
     * Get historical fuel analysis
     */
    function getHistoricalFuelAnalysis(
        fromPeriod: String,
        toPeriod: String,
        companyCode: String,
        groupBy: String
    ) returns array of FuelAnalysisItem;

    /**
     * Get available reports for user
     */
    function getAvailableReports(
        category: String
    ) returns array of AvailableReport;

    /**
     * Get dashboards for persona
     */
    function getDashboardsForPersona(
        persona: String
    ) returns array of AvailableDashboard;

    /**
     * Get KPI current values
     */
    function getCurrentKPIValues(
        kpiCodes: String,
        companyCode: String
    ) returns array of CurrentKPIValue;

    /**
     * Get station performance metrics
     */
    function getStationPerformance(
        stationCode: String,
        period: String
    ) returns StationPerformanceMetrics;

    /**
     * Get supplier performance metrics
     */
    function getSupplierPerformance(
        supplierId: UUID,
        fromPeriod: String,
        toPeriod: String
    ) returns SupplierPerformanceMetrics;

    /**
     * Get route profitability analysis
     */
    function getRouteProfitability(
        companyCode: String,
        fromPeriod: String,
        toPeriod: String
    ) returns array of RouteProfitabilityItem;

    /**
     * Get data quality summary for analytics
     */
    function getDataQualitySummary() returns AnalyticsDataQuality;

    // ========================================================================
    // TYPE DEFINITIONS
    // ========================================================================

    type ReportGenerationResult {
        success             : Boolean;
        reportCode          : String(30);
        executionId         : UUID;
        outputFormat        : String(10);
        fileName            : String(200);
        filePath            : String(500);
        fileSize            : Integer;
        rowCount            : Integer;
        durationMs          : Integer;
        message             : String(500);
    };

    type ReportPreviewResult {
        success             : Boolean;
        reportCode          : String(30);
        previewData         : LargeString;
        rowCount            : Integer;
        message             : String(500);
    };

    type DashboardExportResult {
        success             : Boolean;
        dashboardCode       : String(30);
        configJson          : LargeString;
        message             : String(500);
    };

    type KPICalculationResult {
        success             : Boolean;
        kpiCode             : String(30);
        kpiName             : String(100);
        currentValue        : Decimal(18,4);
        targetValue         : Decimal(18,4);
        variancePct         : Decimal(8,4);
        status              : String(15);
        calculatedAt        : DateTime;
        message             : String(500);
    };

    type KPITestResult {
        success             : Boolean;
        kpiCode             : String(30);
        testValue           : Decimal(18,4);
        expectedStatus      : String(15);
        calculationSteps    : LargeString;
        message             : String(500);
    };

    type VarianceDrillDownResult {
        success             : Boolean;
        varianceId          : UUID;
        allocations         : array of AllocationReference;
        invoices            : array of InvoiceReference;
        message             : String(500);
    };

    type AllocationReference {
        allocationId        : UUID;
        allocationDate      : Date;
        amount              : Decimal(15,2);
        costCenter          : String(10);
    };

    type InvoiceReference {
        invoiceId           : UUID;
        invoiceNumber       : String(35);
        invoiceDate         : Date;
        amount              : Decimal(15,2);
    };

    type BatchKPIResult {
        success             : Boolean;
        companyCode         : String(4);
        period              : String(7);
        kpisCalculated      : Integer;
        kpisSucceeded       : Integer;
        kpisFailed          : Integer;
        results             : array of KPICalculationResult;
        message             : String(500);
    };

    type VarianceCalculationResult {
        success             : Boolean;
        period              : String(7);
        companyCode         : String(4);
        varianceType        : String(20);
        recordsCreated      : Integer;
        totalBudget         : Decimal(18,2);
        totalActual         : Decimal(18,2);
        totalVariance       : Decimal(18,2);
        variancePct         : Decimal(8,4);
        criticalCount       : Integer;
        warningCount        : Integer;
        message             : String(500);
    };

    type SACExportResult {
        success             : Boolean;
        exportId            : String(50);
        sacModelId          : String(100);
        recordsExported     : Integer;
        recordsFailed       : Integer;
        totalAmount         : Decimal(18,2);
        durationSeconds     : Integer;
        requiresApproval    : Boolean;
        message             : String(500);
    };

    type DashboardRefreshResult {
        success             : Boolean;
        dashboardCode       : String(30);
        tilesRefreshed      : Integer;
        refreshTime         : DateTime;
        durationMs          : Integer;
        message             : String(500);
    };

    type SnapshotResult {
        success             : Boolean;
        snapshotId          : String(50);
        snapshotType        : String(20);
        snapshotDate        : Date;
        recordCount         : Integer;
        message             : String(500);
    };

    type ArchiveResult {
        success             : Boolean;
        archivedCount       : Integer;
        retentionDays       : Integer;
        message             : String(500);
    };

    type DistributionResult {
        success             : Boolean;
        reportExecutionId   : UUID;
        recipientCount      : Integer;
        distributedAt       : DateTime;
        message             : String(500);
    };

    type DashboardSummary {
        dashboardCode       : String(30);
        dashboardName       : String(100);
        companyCode         : String(4);
        lastRefreshed       : DateTime;
        tiles               : array of DashboardTile;
    };

    type DashboardTile {
        tileId              : String(30);
        title               : String(100);
        kpiCode             : String(30);
        value               : Decimal(18,4);
        targetValue         : Decimal(18,4);
        variancePct         : Decimal(8,4);
        status              : String(15);
        trendDirection      : String(10);
        sparklineData       : String(500);
    };

    type KPITrendData {
        kpiCode             : String(30);
        kpiName             : String(100);
        periodType          : String(10);
        dataPoints          : array of KPIDataPoint;
    };

    type KPIDataPoint {
        period              : String(10);
        value               : Decimal(18,4);
        target              : Decimal(18,4);
        status              : String(15);
    };

    type VarianceAnalysisItem {
        dimension           : String(50);
        dimensionValue      : String(100);
        budgetAmount        : Decimal(18,2);
        actualAmount        : Decimal(18,2);
        varianceAmount      : Decimal(18,2);
        variancePct         : Decimal(8,4);
        status              : String(15);
        recordCount         : Integer;
    };

    type AllocationReconciliation {
        period              : String(7);
        companyCode         : String(4);
        totalAllocated      : Decimal(18,2);
        totalActual         : Decimal(18,2);
        difference          : Decimal(18,2);
        differencePct       : Decimal(8,4);
        unallocatedCount    : Integer;
        overAllocatedCount  : Integer;
        currency            : String(3);
    };

    type FuelAnalysisItem {
        period              : String(7);
        dimension           : String(50);
        dimensionValue      : String(100);
        volumeKg            : Decimal(15,2);
        totalCost           : Decimal(18,2);
        avgPricePerKg       : Decimal(15,4);
        deliveryCount       : Integer;
        currency            : String(3);
    };

    type AvailableReport {
        reportCode          : String(30);
        reportName          : String(100);
        reportCategory      : String(50);
        reportType          : String(30);
        supportedFormats    : String(50);
        description         : String(500);
    };

    type AvailableDashboard {
        dashboardCode       : String(30);
        dashboardName       : String(100);
        description         : String(500);
        isHomePage          : Boolean;
        displayOrder        : Integer;
    };

    type CurrentKPIValue {
        kpiCode             : String(30);
        kpiName             : String(100);
        currentValue        : Decimal(18,4);
        targetValue         : Decimal(18,4);
        variancePct         : Decimal(8,4);
        status              : String(15);
        uom                 : String(20);
        trendDirection      : String(10);
        lastUpdated         : DateTime;
    };

    type StationPerformanceMetrics {
        stationCode         : String(3);
        stationName         : String(100);
        period              : String(7);
        totalVolume         : Decimal(15,2);
        totalCost           : Decimal(18,2);
        deliveryCount       : Integer;
        avgDeliveryTime     : Decimal(10,2);
        epodDigitalRate     : Decimal(5,2);
        variancePct         : Decimal(8,4);
        currency            : String(3);
    };

    type SupplierPerformanceMetrics {
        supplierId          : UUID;
        supplierName        : String(100);
        totalVolume         : Decimal(15,2);
        totalSpend          : Decimal(18,2);
        invoiceCount        : Integer;
        avgPricePerKg       : Decimal(15,4);
        onTimeDeliveryPct   : Decimal(5,2);
        qualityScore        : Decimal(5,2);
        matchRate           : Decimal(5,2);
        currency            : String(3);
    };

    type RouteProfitabilityItem {
        routeCode           : String(20);
        originAirport       : String(3);
        destinationAirport  : String(3);
        flightCount         : Integer;
        totalFuelCost       : Decimal(18,2);
        avgCostPerFlight    : Decimal(15,2);
        avgCostPerKg        : Decimal(15,4);
        varianceFromBudget  : Decimal(8,4);
        currency            : String(3);
    };

    type AnalyticsDataQuality {
        overallScore        : Decimal(5,2);
        lastCalculated      : DateTime;
        entities            : array of EntityDataQuality;
    };

    type EntityDataQuality {
        entityType          : String(50);
        completenessScore   : Decimal(5,2);
        accuracyScore       : Decimal(5,2);
        consistencyScore    : Decimal(5,2);
        issueCount          : Integer;
    };

    // ========================================================================
    // FINANCIAL RECONCILIATION TYPES (for FinancialReconciliationDashboard TSX)
    // ========================================================================

    /**
     * Financial reconciliation KPIs
     * Used by: FinancialReconciliationDashboard executive summary tiles
     */
    type FinancialReconciliationKPIs {
        mtdActual           : Decimal(18,2);    // Month-to-date actual fuel expense
        mtdBudget           : Decimal(18,2);    // Month-to-date budget
        variance            : Decimal(18,2);    // Variance amount
        variancePercent     : Decimal(5,2);     // Variance %
        ytdActual           : Decimal(18,2);    // Year-to-date actual
        ytdBudget           : Decimal(18,2);    // Year-to-date budget
        costPerFlightHour   : Decimal(15,2);    // Cost per flight hour
        costPerFlightHourTarget : Decimal(15,2); // Target cost per flight hour
        costPerFlightHourVariance : Decimal(5,2); // Variance % vs target
        costPerASK          : Decimal(8,5);     // Cost per Available Seat Kilometer
        costPerASKTarget    : Decimal(8,5);     // Target cost per ASK
        costPerASKVariance  : Decimal(5,2);     // ASK variance %
        currency            : String(3);
    };

    /**
     * Budget waterfall chart item
     * Used by: FinancialReconciliationDashboard waterfall chart
     */
    type BudgetWaterfallItem {
        category            : String(30);       // Budget, Price Variance, Volume Variance, Mix Variance, Actual
        value               : Decimal(18,2);    // Amount
        itemType            : String(15);       // budget, unfavorable, favorable, actual
        displayValue        : String(30);       // Formatted display value
        cumulative          : Decimal(18,2);    // Cumulative running total
    };

    /**
     * Top station by fuel cost
     * Used by: FinancialReconciliationDashboard station bar chart
     */
    type TopStationCostItem {
        stationCode         : String(3);        // IATA airport code
        stationName         : String(100);      // Airport name
        amount              : Decimal(18,2);    // Fuel cost
        flights             : Integer;          // Number of flights
        liters              : Decimal(15,0);    // Fuel volume in liters
        currency            : String(3);
    };

    /**
     * Top supplier by spend
     * Used by: FinancialReconciliationDashboard supplier donut chart
     */
    type TopSupplierSpendItem {
        supplierName        : String(100);
        amount              : Decimal(18,2);    // Total spend
        percentage          : Decimal(5,2);     // Share of total %
        invoices            : Integer;          // Invoice count
        currency            : String(3);
    };

    /**
     * Top route by fuel consumption
     * Used by: FinancialReconciliationDashboard route chart
     */
    type TopRouteFuelItem {
        route               : String(20);       // e.g. SIN-LHR
        liters              : Decimal(15,0);    // Fuel volume in liters
        costPerLiter        : Decimal(8,4);     // Cost per liter
        amount              : Decimal(18,2);    // Total cost
        currency            : String(3);
    };

    /**
     * Aircraft type fuel efficiency
     * Used by: FinancialReconciliationDashboard aircraft efficiency chart
     */
    type AircraftEfficiencyItem {
        aircraftType        : String(20);       // e.g. A350-900, B787-10
        fuelPerHour         : Decimal(10,0);    // Liters per flight hour
        costPerHour         : Decimal(15,2);    // Cost per flight hour
        isEfficient         : Boolean;          // Below target indicator
    };

    /**
     * Reconciliation exception item
     * Used by: FinancialReconciliationDashboard exception table
     */
    type ReconciliationExceptionItem {
        exceptionId         : String(50);
        exceptionType       : String(30);       // Unmatched Invoice, Outstanding ePOD, Accrual Pending, Price Discrepancy
        count               : Integer;          // Number of items
        amount              : Decimal(18,2);    // Financial impact
        currency            : String(3);
        aging               : String(20);       // e.g. "3-5 days"
        impact              : String(10);       // High, Medium, Low
        actionRequired      : String(200);      // Recommended action
        owner               : String(255);      // Responsible person/team
    };

    /**
     * Cost trend sparkline data
     * Used by: FinancialReconciliationDashboard KPI sparklines
     */
    type CostTrendItem {
        period              : String(10);       // Month label or day index
        value               : Decimal(18,2);    // Metric value
    };

    // ========================================================================
    // FINANCIAL RECONCILIATION FUNCTIONS
    // ========================================================================

    /**
     * Get financial reconciliation KPIs
     */
    function getFinancialReconciliationKPIs(period: String, companyCode: String) returns FinancialReconciliationKPIs;

    /**
     * Get budget vs actual waterfall data
     */
    function getBudgetWaterfall(period: String, companyCode: String) returns array of BudgetWaterfallItem;

    /**
     * Get top stations by fuel cost
     */
    function getTopStationsByCost(period: String, companyCode: String, limit: Integer) returns array of TopStationCostItem;

    /**
     * Get top suppliers by spend
     */
    function getTopSuppliersBySpend(period: String, companyCode: String, limit: Integer) returns array of TopSupplierSpendItem;

    /**
     * Get top routes by fuel consumption
     */
    function getTopRoutesByFuel(period: String, companyCode: String, limit: Integer) returns array of TopRouteFuelItem;

    /**
     * Get aircraft type fuel efficiency
     */
    function getAircraftEfficiency(period: String, companyCode: String) returns array of AircraftEfficiencyItem;

    /**
     * Get reconciliation exceptions
     */
    function getReconciliationExceptions(period: String, companyCode: String) returns array of ReconciliationExceptionItem;

    /**
     * Get cost trend sparkline data
     */
    function getCostTrend(metric: String, months: Integer) returns array of CostTrendItem;

    /**
     * Resolve all exceptions in a period
     */
    action resolveAllExceptions(period: String, companyCode: String) returns ReconciliationResolveResult;

    type ReconciliationResolveResult {
        success             : Boolean;
        resolvedCount       : Integer;
        remainingCount      : Integer;
        message             : String(500);
    };

    // ========================================================================
    // FUEL COST FORECAST TYPES (for FuelCostForecast TSX)
    // ========================================================================

    /**
     * KPIs for the fuel cost forecast model header
     * Includes forecasted cost, accuracy, price trend, and model confidence
     */
    type FuelCostForecastKPIs {
        forecastedCost          : Decimal(18,2);    // Total forecasted cost (next 12M)
        forecastedCostTrend     : Decimal(5,2);     // % vs budget
        forecastAccuracy        : Decimal(5,2);     // Model accuracy percentage (last 12M)
        forecastAccuracyTrend   : Decimal(5,2);     // % change vs last quarter
        priceTrendIndex         : Decimal(5,2);     // Price trend index value
        priceTrendLabel         : String(50);       // e.g. "Moderate Increase"
        modelConfidence         : Integer;          // Model confidence percentage (0-100)
        modelConfidenceLabel    : String(50);       // e.g. "High Confidence"
        currency                : String(3);
    };

    /**
     * Forecast data point for the time series chart
     * Covers both historical (actual) and forecasted data
     */
    type ForecastDataPoint {
        period                  : String(10);       // e.g. "Jan 24", "Feb 25"
        periodDate              : Date;             // Actual date
        cost                    : Decimal(18,2);    // Cost amount
        dataType                : String(10);       // actual, forecast
        lowerBound              : Decimal(18,2);    // Lower confidence interval
        upperBound              : Decimal(18,2);    // Upper confidence interval
        confidence              : Integer;          // Confidence percentage
        budget                  : Decimal(18,2);    // Budget target
    };

    /**
     * Cost driver for the forecast cost breakdown donut chart
     */
    type ForecastCostDriver {
        category                : String(50);       // CPE Pricing, Volume Change, FX Impact, Other
        amount                  : Decimal(18,2);    // Amount
        percentage              : Decimal(5,2);     // Percentage of total
    };

    /**
     * Variance analysis item (quarterly or monthly)
     */
    type ForecastBudgetVarianceItem {
        period                  : String(10);       // e.g. "Q1 '25"
        forecast                : Decimal(18,2);    // Forecasted amount
        budget                  : Decimal(18,2);    // Budget amount
        variance                : Decimal(5,2);     // Variance percentage
        status                  : String(15);       // moderate, high, onTarget
    };

    /**
     * Detailed forecast table row with confidence intervals
     */
    type ForecastTableRow {
        period                  : String(15);       // e.g. "Jan 2025"
        periodDate              : Date;
        forecast                : Decimal(18,2);    // Forecasted cost
        lowerBound              : Decimal(18,2);    // Lower bound (95% CI)
        upperBound              : Decimal(18,2);    // Upper bound (95% CI)
        budget                  : Decimal(18,2);    // Budget amount
        variance                : Decimal(5,2);     // Variance percentage
        status                  : String(20);       // onTarget, moderateVariance, highVariance
        confidence              : Integer;          // Confidence percentage
    };

    /**
     * Forecast accuracy metric (MAE, RMSE, MAPE, R-squared)
     */
    type ForecastAccuracyMetric {
        label                   : String(100);      // Metric name
        value                   : String(20);       // Formatted value (e.g. "$124K", "6.2%")
        progress                : Decimal(5,2);     // Progress bar value (0-100)
    };

    /**
     * Training data quality metric
     */
    type TrainingDataQualityMetric {
        label                   : String(100);      // Metric name
        value                   : String(50);       // Metric value
        detail                  : String(200);      // Additional detail text
        progress                : Decimal(5,2);     // Progress bar value (0-100)
    };

    /**
     * Model configuration key-value pair
     */
    type ModelConfigItem {
        label                   : String(100);      // Config name
        value                   : String(500);      // Config value
        badge                   : String(30);       // Optional badge (e.g. "Latest")
    };

    function getFuelCostForecastKPIs(timeRange: String) returns FuelCostForecastKPIs;
    function getForecastDataPoints(timeRange: String, confidenceLevel: Integer) returns array of ForecastDataPoint;
    function getForecastCostDrivers(period: String) returns array of ForecastCostDriver;
    function getForecastBudgetVariance(varianceView: String) returns array of ForecastBudgetVarianceItem;
    function getForecastTableData(timeRange: String) returns array of ForecastTableRow;
    function getForecastAccuracyMetrics() returns array of ForecastAccuracyMetric;
    function getTrainingDataQuality() returns array of TrainingDataQualityMetric;
    function getModelConfiguration() returns array of ModelConfigItem;

    action retrainForecastModel() returns ForecastModelResult;
    action exportForecastReport(timeRange: String, outputFormat: String) returns ReportGenerationResult;

    type ForecastModelResult {
        success                 : Boolean;
        modelVersion            : String(20);
        trainedAt               : DateTime;
        accuracy                : Decimal(5,2);
        message                 : String(500);
    };

    // ========================================================================
    // ERROR CODES (FDD-12)
    // ========================================================================
    // RA501 - Report definition not found
    // RA502 - Invalid report parameters
    // RA503 - Report generation failed
    // RA504 - KPI calculation error
    // RA505 - Variance calculation error
    // RA506 - SAC export failed
    // RA507 - SAC connection error
    // RA508 - Dashboard configuration invalid
    // RA509 - Snapshot creation failed
    // RA510 - Data quality below threshold
}

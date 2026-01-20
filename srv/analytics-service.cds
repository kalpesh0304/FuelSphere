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

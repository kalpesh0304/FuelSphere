/**
 * FuelSphere - Integration Monitoring Service (FDD-11)
 *
 * Comprehensive API monitoring and health check system:
 * - API request/response logging with correlation tracking
 * - System health monitoring (FuelSphere, S/4HANA, HANA DB)
 * - Error logging with INT4xx error codes
 * - Exception queue with retry management
 * - Performance metrics and SLA tracking
 * - Data synchronization status monitoring
 * - Alert definitions and notifications
 * - Data quality scoring
 *
 * Service Path: /odata/v4/integration
 */

using { fuelsphere as db } from '../db/schema';

@path: '/odata/v4/integration'
service IntegrationService {

    // ========================================================================
    // INTEGRATION MESSAGES
    // ========================================================================

    /**
     * IntegrationMessages - API Request/Response Logs
     * High-volume logging for all integration calls
     *
     * Access:
     * - Integration Administrator: Full access (IntegrationMonitor)
     * - System Administrator: Full access (AdminAccess)
     */
    @readonly
    entity IntegrationMessages as projection on db.INTEGRATION_MESSAGES actions {
        /**
         * Archive old messages beyond retention period
         */
        action archive() returns ArchiveResult;
    };

    // ========================================================================
    // SYSTEM HEALTH
    // ========================================================================

    /**
     * SystemHealthLogs - Component Health Check Results
     * Records status of all integrated systems
     */
    @readonly
    entity SystemHealthLogs as projection on db.SYSTEM_HEALTH_LOGS;

    // ========================================================================
    // ERROR LOGS
    // ========================================================================

    /**
     * ErrorLogs - Integration Error Details
     * Detailed error tracking with INT4xx codes
     */
    entity ErrorLogs as projection on db.ERROR_LOGS actions {
        /**
         * Mark error as resolved
         */
        action resolve(
            resolution_notes: String,
            root_cause: String
        ) returns ErrorLogs;
    };

    // ========================================================================
    // EXCEPTION ITEMS
    // ========================================================================

    /**
     * ExceptionItems - Failed Transaction Queue
     * Manages failed transactions for retry or manual intervention
     */
    @odata.draft.enabled
    entity ExceptionItems as projection on db.EXCEPTION_ITEMS actions {
        /**
         * Retry the failed transaction
         */
        action retry() returns RetryResult;

        /**
         * Retry with modified payload
         */
        action retryWithPayload(modifiedPayload: LargeString) returns RetryResult;

        /**
         * Assign exception to resolver
         */
        action assign(assignee: String) returns ExceptionItems;

        /**
         * Escalate to next level
         */
        action escalate(escalateTo: String, reason: String) returns ExceptionItems;

        /**
         * Mark as resolved
         */
        action resolve(
            resolution_type: String,
            resolution_notes: String
        ) returns ExceptionItems;

        /**
         * Cancel/skip the exception
         */
        action cancel(reason: String) returns ExceptionItems;

        /**
         * Reset retry counter
         */
        action resetRetries() returns ExceptionItems;
    };

    // ========================================================================
    // PERFORMANCE METRICS
    // ========================================================================

    /**
     * APIPerformanceMetrics - Response Time Statistics
     * Aggregated metrics for SLA monitoring
     */
    @readonly
    entity APIPerformanceMetrics as projection on db.API_PERFORMANCE_METRICS;

    // ========================================================================
    // DATA SYNCHRONIZATION
    // ========================================================================

    /**
     * DataSyncStatus - Master Data Sync Records
     * Tracks synchronization between FuelSphere and S/4HANA
     */
    entity DataSyncStatus as projection on db.DATA_SYNC_STATUS actions {
        /**
         * Restart failed sync from last checkpoint
         */
        action restart() returns DataSyncStatus;

        /**
         * Force full resync
         */
        action forceFullSync() returns DataSyncStatus;
    };

    // ========================================================================
    // INTEGRATION CONFIGURATION
    // ========================================================================

    /**
     * IntegrationConfigs - Configuration Settings
     * Managed by Integration Administrator
     */
    @odata.draft.enabled
    entity IntegrationConfigs as projection on db.INTEGRATION_CONFIGS actions {
        /**
         * Validate configuration value
         */
        action validate() returns ConfigValidationResult;

        /**
         * Reset to default value
         */
        action resetToDefault() returns IntegrationConfigs;

        /**
         * Copy config to another environment
         */
        action copyToEnvironment(targetEnv: String) returns IntegrationConfigs;
    };

    // ========================================================================
    // ALERT MANAGEMENT
    // ========================================================================

    /**
     * AlertDefinitions - Alert Rules
     * Defines monitoring thresholds and notification rules
     */
    @odata.draft.enabled
    entity AlertDefinitions as projection on db.ALERT_DEFINITIONS actions {
        /**
         * Test alert trigger
         */
        action test() returns AlertTestResult;

        /**
         * Enable alert
         */
        action enable() returns AlertDefinitions;

        /**
         * Disable alert
         */
        action disable() returns AlertDefinitions;

        /**
         * Reset trigger statistics
         */
        action resetStats() returns AlertDefinitions;
    };

    /**
     * AlertInstances - Triggered Alerts
     * Individual alert occurrences
     */
    entity AlertInstances as projection on db.ALERT_INSTANCES {
        *,
        alert_definition : redirected to AlertDefinitions
    } actions {
        /**
         * Acknowledge alert
         */
        action acknowledge() returns AlertInstances;

        /**
         * Resolve alert
         */
        action resolve(resolution_notes: String) returns AlertInstances;

        /**
         * Suppress alert (mark as false positive)
         */
        action suppress(reason: String) returns AlertInstances;

        /**
         * Escalate alert
         */
        action escalate() returns AlertInstances;
    };

    // ========================================================================
    // DATA QUALITY
    // ========================================================================

    /**
     * DataQualityMetrics - Data Quality Scores
     * Tracks completeness, accuracy, and consistency
     */
    @readonly
    entity DataQualityMetrics as projection on db.DATA_QUALITY_METRICS;

    // ========================================================================
    // SERVICE-LEVEL ACTIONS
    // ========================================================================

    /**
     * Run health check on all components
     */
    action runHealthCheck() returns HealthCheckResult;

    /**
     * Run health check on specific component
     */
    action runComponentHealthCheck(componentName: String) returns ComponentHealthResult;

    /**
     * Log an integration message (for external systems)
     */
    action logIntegrationMessage(
        correlationId: UUID,
        integrationName: String,
        direction: String,
        sourceSystem: String,
        targetSystem: String,
        status: String,
        httpStatusCode: Integer,
        durationMs: Integer,
        errorCode: String,
        errorMessage: String,
        businessObjectType: String,
        businessObjectId: UUID,
        businessObjectKey: String
    ) returns IntegrationMessages;

    /**
     * Create exception item for failed transaction
     */
    action createExceptionItem(
        correlationId: UUID,
        integrationName: String,
        sourceSystem: String,
        targetSystem: String,
        direction: String,
        businessObjectType: String,
        businessObjectId: UUID,
        errorCode: String,
        errorMessage: String,
        originalPayload: LargeString,
        priority: String
    ) returns ExceptionItems;

    /**
     * Trigger manual data sync
     */
    action triggerDataSync(
        entityType: String,
        direction: String,
        syncMode: String,
        companyCode: String
    ) returns DataSyncResult;

    /**
     * Calculate data quality metrics
     */
    action calculateDataQuality(
        entityType: String,
        companyCode: String
    ) returns DataQualityResult;

    /**
     * Archive old integration messages
     */
    action archiveOldMessages(
        olderThanDays: Integer
    ) returns ArchiveResult;

    /**
     * Process exception queue (batch retry)
     */
    action processExceptionQueue(
        integrationName: String,
        maxItems: Integer
    ) returns BatchRetryResult;

    /**
     * Aggregate performance metrics
     */
    action aggregatePerformanceMetrics(
        integrationName: String,
        periodType: String,
        metricDate: Date
    ) returns AggregationResult;

    // ========================================================================
    // SERVICE-LEVEL FUNCTIONS
    // ========================================================================

    /**
     * Get integration dashboard summary
     */
    function getDashboardSummary() returns IntegrationDashboard;

    /**
     * Get current health status of all components
     */
    function getCurrentHealthStatus() returns array of ComponentHealthResult;

    /**
     * Get exception queue statistics
     */
    function getExceptionQueueStats() returns ExceptionQueueStats;

    /**
     * Get SLA compliance report
     */
    function getSLAComplianceReport(
        integrationName: String,
        fromDate: Date,
        toDate: Date
    ) returns SLAComplianceReport;

    /**
     * Get error trend analysis
     */
    function getErrorTrend(
        integrationName: String,
        days: Integer
    ) returns array of ErrorTrendItem;

    /**
     * Get active alerts count by severity
     */
    function getActiveAlertsSummary() returns AlertsSummary;

    /**
     * Get data quality summary
     */
    function getDataQualitySummary(
        companyCode: String
    ) returns DataQualitySummary;

    /**
     * Get integration message history for correlation ID
     */
    function getMessageHistory(
        correlationId: UUID
    ) returns array of IntegrationMessages;

    /**
     * Get performance percentiles for integration
     */
    function getPerformancePercentiles(
        integrationName: String,
        fromDate: Date,
        toDate: Date
    ) returns PerformancePercentiles;

    /**
     * Search error logs
     */
    function searchErrors(
        errorCode: String,
        integrationName: String,
        fromDate: Date,
        toDate: Date,
        severity: String
    ) returns array of ErrorLogs;

    /**
     * Get sync status for entity type
     */
    function getSyncStatusForEntity(
        entityType: String
    ) returns LatestSyncStatus;

    // ========================================================================
    // TYPE DEFINITIONS
    // ========================================================================

    type HealthCheckResult {
        success             : Boolean;
        checkTime           : DateTime;
        totalComponents     : Integer;
        healthyCount        : Integer;
        degradedCount       : Integer;
        unhealthyCount      : Integer;
        components          : array of ComponentHealthResult;
    };

    type ComponentHealthResult {
        componentName       : String(50);
        componentType       : String(30);
        status              : String(15);
        responseTimeMs      : Integer;
        details             : String(500);
        lastCheckTime       : DateTime;
    };

    type RetryResult {
        success             : Boolean;
        exceptionId         : UUID;
        exceptionNumber     : String(25);
        retryCount          : Integer;
        status              : String(20);
        newCorrelationId    : UUID;
        errorMessage        : String(1000);
    };

    type ConfigValidationResult {
        isValid             : Boolean;
        configKey           : String(100);
        issues              : array of ValidationIssue;
    };

    type ValidationIssue {
        field               : String(50);
        severity            : String(10);
        message             : String(500);
    };

    type AlertTestResult {
        success             : Boolean;
        alertCode           : String(30);
        wouldTrigger        : Boolean;
        currentValue        : Decimal(15,4);
        thresholdValue      : Decimal(15,4);
        message             : String(500);
    };

    type DataSyncResult {
        success             : Boolean;
        syncId              : String(50);
        entityType          : String(50);
        direction           : String(10);
        recordsProcessed    : Integer;
        recordsCreated      : Integer;
        recordsUpdated      : Integer;
        recordsFailed       : Integer;
        durationSeconds     : Integer;
        message             : String(500);
    };

    type DataQualityResult {
        success             : Boolean;
        entityType          : String(50);
        totalRecords        : Integer;
        validRecords        : Integer;
        overallScore        : Decimal(5,2);
        completenessScore   : Decimal(5,2);
        accuracyScore       : Decimal(5,2);
        consistencyScore    : Decimal(5,2);
        message             : String(500);
    };

    type ArchiveResult {
        success             : Boolean;
        archivedCount       : Integer;
        retentionDays       : Integer;
        oldestArchived      : DateTime;
        message             : String(500);
    };

    type BatchRetryResult {
        success             : Boolean;
        totalProcessed      : Integer;
        successCount        : Integer;
        failedCount         : Integer;
        skippedCount        : Integer;
        results             : array of RetryResult;
    };

    type AggregationResult {
        success             : Boolean;
        integrationName     : String(50);
        periodType          : String(10);
        metricDate          : Date;
        totalCalls          : Integer;
        avgResponseTime     : Decimal(10,2);
        successRate         : Decimal(5,2);
        message             : String(500);
    };

    type IntegrationDashboard {
        lastUpdated         : DateTime;
        totalIntegrations   : Integer;
        healthyIntegrations : Integer;
        degradedIntegrations : Integer;
        unhealthyIntegrations : Integer;
        messagesLast24h     : Integer;
        errorsLast24h       : Integer;
        errorRate24h        : Decimal(5,2);
        openExceptions      : Integer;
        criticalExceptions  : Integer;
        activeAlerts        : Integer;
        criticalAlerts      : Integer;
        avgResponseTime24h  : Decimal(10,2);
        slaCompliancePct    : Decimal(5,2);
    };

    type ExceptionQueueStats {
        totalOpen           : Integer;
        pendingRetry        : Integer;
        inProgress          : Integer;
        exhaustedRetries    : Integer;
        byPriority          : array of PriorityCount;
        byIntegration       : array of IntegrationCount;
        oldestOpenDate      : DateTime;
        slaBreachedCount    : Integer;
    };

    type PriorityCount {
        priority            : String(10);
        count               : Integer;
    };

    type IntegrationCount {
        integrationName     : String(50);
        count               : Integer;
    };

    type SLAComplianceReport {
        integrationName     : String(50);
        fromDate            : Date;
        toDate              : Date;
        totalCalls          : Integer;
        withinSLA           : Integer;
        breachedSLA         : Integer;
        compliancePct       : Decimal(5,2);
        avgResponseTime     : Decimal(10,2);
        p95ResponseTime     : Integer;
        slaTargetMs         : Integer;
    };

    type ErrorTrendItem {
        date                : Date;
        errorCount          : Integer;
        errorRate           : Decimal(5,2);
        topErrorCode        : String(20);
        topErrorCount       : Integer;
    };

    type AlertsSummary {
        totalActive         : Integer;
        critical            : Integer;
        high                : Integer;
        medium              : Integer;
        low                 : Integer;
        acknowledgedCount   : Integer;
        avgResolutionMins   : Integer;
    };

    type DataQualitySummary {
        companyCode         : String(4);
        lastCalculated      : DateTime;
        overallScore        : Decimal(5,2);
        entities            : array of EntityQualityScore;
    };

    type EntityQualityScore {
        entityType          : String(50);
        score               : Decimal(5,2);
        trend               : String(10);
        issueCount          : Integer;
    };

    type PerformancePercentiles {
        integrationName     : String(50);
        fromDate            : Date;
        toDate              : Date;
        totalCalls          : Integer;
        avgResponseTime     : Decimal(10,2);
        minResponseTime     : Integer;
        maxResponseTime     : Integer;
        p50                 : Integer;
        p75                 : Integer;
        p90                 : Integer;
        p95                 : Integer;
        p99                 : Integer;
    };

    type LatestSyncStatus {
        entityType          : String(50);
        lastSyncTime        : DateTime;
        status              : String(20);
        recordsSynced       : Integer;
        recordsFailed       : Integer;
        nextScheduledSync   : DateTime;
    };

    // ========================================================================
    // API PERFORMANCE MONITOR TYPES (for APIPerformanceMonitor TSX)
    // ========================================================================

    /**
     * Integration card item for API performance monitor
     * Used by: APIPerformanceMonitor integration cards grid
     */
    type IntegrationCardItem {
        id                  : String(50);       // Unique integration ID
        name                : String(100);      // Display name (e.g. "Business Partner API")
        integrationType     : String(20);       // S4HANA, CPI, EXTERNAL, INTERNAL
        status              : String(15);       // active, degraded, down
        uptime              : Decimal(5,2);     // Uptime percentage (e.g. 99.8)
        avgLatency          : Decimal(8,2);     // Average latency in seconds
        lastCall            : String(50);       // Human-readable last call time (e.g. "2 mins ago")
        callsToday          : Integer;          // Total API calls today
    };

    // ========================================================================
    // API PERFORMANCE MONITOR FUNCTIONS
    // ========================================================================

    /**
     * Get all integration cards for API monitor
     */
    function getIntegrationCards(filterStatus: String, filterType: String) returns array of IntegrationCardItem;

    /**
     * Test all integration connections
     */
    action testAllConnections() returns HealthCheckResult;

    /**
     * Test a specific integration connection
     */
    action testConnection(integrationId: String) returns ComponentHealthResult;

    /**
     * Export health report for all integrations
     */
    function getHealthReport() returns array of IntegrationCardItem;

    // ========================================================================
    // INTEGRATION MONITOR DASHBOARD TYPES (for IntegrationDashboard TSX)
    // ========================================================================

    /**
     * Extended dashboard KPIs for the integration monitoring view
     * Includes overall health score, API metrics, and data quality
     */
    type IntegrationMonitorDashboardKPIs {
        overallHealth           : Decimal(5,2);     // Overall health score (0-100)
        apiSuccessRate          : Decimal(5,2);     // API success rate percentage
        avgResponseTime         : Decimal(10,2);    // Average response time in seconds
        activeIntegrations      : Integer;          // Currently active integrations
        totalIntegrations       : Integer;          // Total configured integrations
        failedJobsToday         : Integer;          // Failed jobs in last 24h
        pendingRetries          : Integer;          // Items pending retry
        dataQualityScore        : Decimal(5,2);     // Overall data quality score
    };

    /**
     * Performance trend data point (24h line chart)
     */
    type DashboardPerformanceTrendItem {
        hour                    : String(5);        // Time label (e.g. "08:00")
        successRate             : Decimal(5,2);     // Success rate at this hour
        latency                 : Decimal(10,2);    // Average latency in seconds
    };

    /**
     * Error distribution item for donut chart
     */
    type DashboardErrorDistributionItem {
        name                    : String(50);       // Severity/category name
        count                   : Integer;          // Number of errors
        color                   : String(20);       // Display color
    };

    /**
     * Data sync status item for bar chart
     */
    type DashboardDataSyncItem {
        name                    : String(100);      // Object/entity name
        syncPercent             : Decimal(5,2);     // Sync completion percentage
        status                  : String(20);       // success, warning, error
    };

    /**
     * Alert item for alert summary list
     */
    type IntegrationAlertItem {
        severity                : String(20);       // critical, high, medium, low
        message                 : String(500);      // Alert message text
        timestamp               : DateTime;         // When alert was triggered
    };

    function getIntegrationMonitorDashboardKPIs() returns IntegrationMonitorDashboardKPIs;
    function getDashboardPerformanceTrend() returns array of DashboardPerformanceTrendItem;
    function getDashboardErrorDistribution() returns array of DashboardErrorDistributionItem;
    function getDashboardDataSyncStatus() returns array of DashboardDataSyncItem;
    function getIntegrationAlerts() returns array of IntegrationAlertItem;

    // ========================================================================
    // INTEGRATION COCKPIT TYPES (for IntegrationCockpit TSX)
    // ========================================================================

    /**
     * KPI summary for a specific integration cockpit view
     * Shows API call volume, latency, success rate, and failures
     */
    type CockpitKPIs {
        apiCalls                : Integer;          // Total API calls in period
        avgLatency              : Decimal(10,2);    // Average latency in seconds
        successRate             : Decimal(5,2);     // Success rate percentage
        failedCalls             : Integer;          // Number of failed calls
    };

    /**
     * Performance data point for cockpit charts (2h intervals over 24h)
     */
    type CockpitPerformanceItem {
        time                    : String(5);        // Time label (e.g. "08:00")
        calls                   : Integer;          // Number of API calls
        latency                 : Decimal(10,2);    // Average latency in seconds
        errors                  : Integer;          // Number of errors
    };

    /**
     * API configuration detail for cockpit display
     */
    type APIConfigDetail {
        serviceName             : String(100);      // e.g. "Airport Plant Master Sync"
        endpoint                : String(500);      // e.g. "/API_PLANT_SRV/ZC_Plant"
        method                  : String(10);       // GET, POST, PUT, DELETE
        protocol                : String(20);       // OData V2, OData V4, REST, SOAP
        syncFrequency           : String(50);       // e.g. "Every 30 minutes"
        authentication          : String(50);       // e.g. "OAuth 2.0"
        timeout                 : Integer;          // Timeout in seconds
        retryPolicy             : String(100);      // e.g. "3 attempts, exponential backoff"
        status                  : String(20);       // Active, Inactive
    };

    /**
     * System health indicator for cockpit health panel
     */
    type SystemHealthIndicator {
        componentName           : String(100);      // e.g. "S/4HANA Connection"
        status                  : String(20);       // Healthy, Degraded, Down
    };

    function getCockpitKPIs(integrationId: String) returns CockpitKPIs;
    function getCockpitPerformanceData(integrationId: String) returns array of CockpitPerformanceItem;
    function getAPIConfigDetail(integrationId: String) returns APIConfigDetail;
    function getSystemHealthIndicators() returns array of SystemHealthIndicator;

    action editAPIConfiguration(integrationId: String, config: APIConfigDetail) returns APIConfigDetail;
    action triggerSyncNow(integrationId: String) returns DataSyncResult;

    // ========================================================================
    // INTEGRATION CONFIGURATION MANAGER TYPES (for IntegrationConfigurationManager TSX)
    // ========================================================================

    /**
     * Configuration status panel data (right sidebar)
     * Shows metadata, run statistics, and health metrics
     */
    type ConfigStatusPanel {
        lastModified            : DateTime;         // Last config modification time
        lastModifiedBy          : String(100);      // Who modified it
        lastTestTime            : DateTime;         // Last connection test time
        lastTestResult          : String(20);       // Success, Failed
        activeSince             : Date;             // When integration was activated
        totalRuns               : Integer;          // Total execution count
        successRate             : Decimal(5,2);     // Overall success rate
        avgResponseTimeMs       : Integer;          // Average response time in ms
        lastError               : String(500);      // Last error message or "None"
    };

    /**
     * Recent activity log entry for configuration panel
     */
    type ConfigActivityItem {
        time                    : String(50);       // Human-readable time (e.g. "10 mins ago")
        text                    : String(200);      // Activity description
        icon                    : String(20);       // success, warning, edit
    };

    /**
     * Result of testing the full integration flow end-to-end
     */
    type TestFullFlowResult {
        success                 : Boolean;
        steps                   : array of FlowStepResult;
        totalDurationMs         : Integer;
        message                 : String(500);
    };

    /**
     * Individual step result within a full flow test
     */
    type FlowStepResult {
        step                    : String(100);      // Step name
        status                  : String(20);       // Success, Failed, Skipped
        durationMs              : Integer;          // Step duration
        message                 : String(500);      // Step result message
    };

    function getConfigStatusPanel(integrationId: String) returns ConfigStatusPanel;
    function getConfigActivityLog(integrationId: String) returns array of ConfigActivityItem;

    action testFullFlow(integrationId: String) returns TestFullFlowResult;
    action cloneConfiguration(integrationId: String, newName: String) returns IntegrationConfigs;
    action saveConfiguration(integrationId: String, config: LargeString) returns IntegrationConfigs;

    // ========================================================================
    // MASTER DATA SYNC MONITOR TYPES (for MasterDataSyncMonitor TSX)
    // ========================================================================

    /**
     * Master data sync record for the sync monitor table
     * Represents a single synchronized object with quality metrics
     */
    type MasterDataSyncRecord {
        id                      : UUID;
        objectID                : String(20);       // e.g. "MAT000024"
        objectType              : String(30);       // Material, Supplier, Plant, Tax Code, CPE Formula, UoM
        description             : String(200);      // Object description
        source                  : String(30);       // e.g. "S/4HANA"
        status                  : String(20);       // success, warning, error, pending
        lastSync                : String(50);       // Human-readable last sync time
        qualityPercent          : Decimal(5,2);     // Data quality score 0-100
        apiEndpoint             : String(100);      // API endpoint used for sync
    };

    /**
     * Summary KPIs for the master data sync monitor
     */
    type MasterDataSyncSummary {
        totalRecords            : Integer;          // Total synced records
        syncSuccessRate         : Decimal(5,2);     // Overall sync success rate
        lastFullSync            : String(50);       // Human-readable time since last full sync
        failedRecords           : Integer;          // Count of failed records
        pendingValidation       : Integer;          // Count of pending validation records
    };

    /**
     * Object type with count for tab badges
     */
    type ObjectTypeCount {
        objectType              : String(30);       // Object type name
        count                   : Integer;          // Number of records
    };

    function getMasterDataSyncSummary() returns MasterDataSyncSummary;
    function getMasterDataSyncRecords(
        objectType              : String,
        syncStatus              : String,
        qualityMin              : Decimal,
        plant                   : String,
        supplier                : String,
        dateFrom                : Date,
        dateTo                  : Date,
        skip                    : Integer,
        top                     : Integer
    ) returns array of MasterDataSyncRecord;
    function getObjectTypeCounts() returns array of ObjectTypeCount;

    action retryFailedSyncRecords(objectType: String) returns BatchRetryResult;
    action scheduleSyncJob(entityType: String, frequency: String, startDateTime: DateTime) returns DataSyncResult;
    action exportSyncReport(objectType: String, syncStatus: String) returns ExportResult;

    type ExportResult {
        success                 : Boolean;
        fileUrl                 : String(500);
        recordCount             : Integer;
        message                 : String(500);
    };

    // ========================================================================
    // DATA QUALITY DASHBOARD TYPES (for DataQualityDashboard TSX)
    // ========================================================================

    /**
     * KPIs for the data quality dashboard hero section
     * Overall score with severity breakdown and resolution stats
     */
    type DataQualityDashboardKPIs {
        overallScore            : Decimal(5,2);     // Overall DQ score (0-100)
        trend                   : Decimal(5,2);     // Change vs last month (can be negative)
        totalRecords            : Integer;          // Total master data records
        totalIssues             : Integer;          // Total open DQ issues
        highSeverity            : Integer;          // High severity issue count
        mediumSeverity          : Integer;          // Medium severity issue count
        lowSeverity             : Integer;          // Low severity issue count
        resolvedToday           : Integer;          // Issues resolved today
    };

    /**
     * Quality score breakdown by object type (bar chart)
     */
    type QualityScoreByObjectItem {
        objectType              : String(30);       // e.g. "Supplier", "Material", "Plant"
        score                   : Decimal(5,2);     // Quality score percentage
        issues                  : Integer;          // Number of issues
        records                 : Integer;          // Total records of this type
    };

    /**
     * Issue count by issue type category
     */
    type IssuesByTypeItem {
        issueType               : String(30);       // MISSING_MANDATORY, INVALID_FORMAT, DUPLICATE_ENTRY, etc.
        count                   : Integer;          // Number of occurrences
        percentage              : Decimal(5,2);     // Percentage of total issues
    };

    /**
     * Individual data quality issue record for the issues table
     */
    type DataQualityIssueItem {
        id                      : UUID;
        issueType               : String(30);       // MISSING_MANDATORY, INVALID_FORMAT, etc.
        objectType              : String(30);       // SUPPLIER, MATERIAL, PLANT, TAX_CODE, CONTRACT
        objectID                : String(20);       // e.g. "SUP-0234"
        fieldName               : String(100);      // Field with the issue
        currentValue            : String(500);      // Current (bad) value
        expectedValue           : String(500);      // Expected correct value
        severity                : String(10);       // HIGH, MEDIUM, LOW
        detectedDate            : DateTime;         // When issue was detected
        status                  : String(15);       // OPEN, IN_PROGRESS, RESOLVED
        assignedTo              : String(100);      // Assigned resolver email
    };

    function getDataQualityDashboardKPIs() returns DataQualityDashboardKPIs;
    function getQualityScoreByObjectType() returns array of QualityScoreByObjectItem;
    function getIssuesByType() returns array of IssuesByTypeItem;
    function getDataQualityIssues(
        objectType              : String,
        issueType               : String,
        searchTerm              : String,
        severity                : String,
        status                  : String,
        skip                    : Integer,
        top                     : Integer
    ) returns array of DataQualityIssueItem;

    action runDQCheck() returns DataQualityResult;
    action exportDQReport(objectType: String, issueType: String) returns ExportResult;
    action fixDQIssue(issueId: UUID) returns DataQualityIssueItem;
    action assignDQIssue(issueId: UUID, assignee: String) returns DataQualityIssueItem;

    // ========================================================================
    // ERROR MANAGEMENT CONSOLE TYPES (for ErrorManagementConsole TSX)
    // ========================================================================

    /**
     * Error queue statistics for the summary dashboard tiles
     */
    type ErrorQueueStatistics {
        total                   : Integer;          // Total open errors
        critical                : Integer;          // Critical severity count
        high                    : Integer;          // High severity count
        medium                  : Integer;          // Medium severity count
        low                     : Integer;          // Low severity count
        autoResolved            : Integer;          // Auto-resolved count
    };

    /**
     * Error category with count for category filter tiles
     */
    type ErrorCategoryCount {
        categoryId              : String(30);       // API_TIMEOUT, VALIDATION, AUTH, BUSINESS_LOGIC, MASTER_DATA, SYSTEM
        name                    : String(50);       // Display name
        count                   : Integer;          // Number of errors in category
    };

    /**
     * Error queue item for the main error table
     * Comprehensive error record with SLA tracking
     */
    type ErrorQueueItem {
        id                      : UUID;
        errorID                 : String(30);       // e.g. "ERR-2025-11-04-001"
        integrationName         : String(100);      // e.g. "Business Partner API"
        severity                : String(10);       // CRITICAL, HIGH, MEDIUM, LOW
        category                : String(20);       // API_TIMEOUT, VALIDATION, AUTH, etc.
        errorMessage            : String(1000);     // Full error message
        occurrenceTime          : DateTime;         // When error occurred
        status                  : String(20);       // NEW, IN_PROGRESS, RETRY_SCHEDULED, RESOLVED, FAILED
        retryCount              : Integer;          // Number of retries attempted
        assignedTo              : String(100);      // Assigned user name
        slaDeadline             : DateTime;         // SLA deadline timestamp
        slaBreach               : Boolean;          // Whether SLA has been breached
    };

    /**
     * Error severity trend data point for 30-day line chart
     */
    type ErrorSeverityTrendItem {
        day                     : Integer;          // Day number (1-30)
        critical                : Integer;          // Critical errors on this day
        high                    : Integer;          // High errors on this day
        medium                  : Integer;          // Medium errors on this day
        low                     : Integer;          // Low errors on this day
    };

    function getErrorQueueStatistics() returns ErrorQueueStatistics;
    function getErrorCategoryCounts() returns array of ErrorCategoryCount;
    function getErrorQueueItems(
        severity                : String,
        category                : String,
        integrationName         : String,
        status                  : String,
        assignment              : String,
        dateRange               : String,
        searchTerm              : String,
        skip                    : Integer,
        top                     : Integer
    ) returns array of ErrorQueueItem;
    function getErrorSeverityTrend(days: Integer) returns array of ErrorSeverityTrendItem;

    action bulkRetryErrors(errorIds: array of UUID) returns BatchRetryResult;
    action bulkAssignErrors(errorIds: array of UUID, assignee: String) returns Integer;
    action bulkResolveErrors(errorIds: array of UUID, resolutionNotes: String) returns Integer;
    action bulkDeleteErrors(errorIds: array of UUID) returns Integer;
    action triggerAutoRemediation() returns BatchRetryResult;
    action exportErrorReport(severity: String, category: String, dateRange: String) returns ExportResult;

    // ========================================================================
    // ERROR LOG VIEWER TYPES (for ErrorLogViewer TSX)
    // ========================================================================

    /**
     * Integration error log entry for the error log timeline table
     * Airport-specific sync error with master data error codes (MD4xx)
     */
    type IntegrationErrorLogItem {
        id                      : UUID;
        timestamp               : DateTime;         // When error occurred
        airportIATA             : String(3);        // Airport IATA code
        airportName             : String(200);      // Airport full name
        errorCode               : String(10);       // e.g. MD401, MD404, MD422, MD503
        errorType               : String(10);       // Critical, Warning, Resolved
        message                 : String(200);      // Short error message
        details                 : String(500);      // Detailed error description
        status                  : String(15);       // Unresolved, In Progress, Resolved
    };

    /**
     * Summary counts for the error log viewer header cards
     */
    type IntegrationErrorLogSummary {
        criticalCount           : Integer;          // Number of critical errors
        warningCount            : Integer;          // Number of warnings
        resolvedCount           : Integer;          // Number of resolved errors
    };

    function getIntegrationErrorLogSummary() returns IntegrationErrorLogSummary;
    function getIntegrationErrorLogs(
        objectType              : String,
        errorCode               : String,
        status                  : String,
        skip                    : Integer,
        top                     : Integer
    ) returns array of IntegrationErrorLogItem;

    action retryErrorLog(errorLogId: UUID) returns IntegrationErrorLogItem;
    action exportErrorLog(objectType: String, errorCode: String, status: String) returns ExportResult;

    // ========================================================================
    // SYSTEM HEALTH MONITOR TYPES (for SystemHealthMonitor TSX)
    // ========================================================================

    /**
     * Overall system status banner for the health monitor hero section
     * Includes uptime, incident count, and maintenance schedule
     */
    type SystemStatusSummary {
        overall                 : String(20);       // OPERATIONAL, DEGRADED, OUTAGE
        activeIncidents         : Integer;          // Number of active incidents
        uptime                  : Decimal(5,2);     // Uptime percentage
        uptimeTrend             : String(10);       // up, down, stable
        maintenanceScheduled    : Boolean;          // Whether maintenance is scheduled
        maintenanceDate         : String(100);      // e.g. "Nov 10, 02:00-04:00 AM"
    };

    /**
     * Component health card for the 4x2 health grid
     * Real-time metrics per BTP landscape component
     */
    type ComponentHealthCard {
        id                      : String(50);       // Unique component ID
        name                    : String(100);      // e.g. "BTP Cloud Foundry", "HANA Cloud Database"
        status                  : String(10);       // HEALTHY, DEGRADED, CRITICAL
        uptime                  : Decimal(5,2);     // Uptime percentage
        responseTime            : Integer;          // Response time in milliseconds
        requestsPerMin          : Integer;          // Requests per minute
        errorRate               : Decimal(5,2);     // Error rate percentage
        cpuUsage                : Integer;          // CPU usage percentage (0-100)
        memoryUsage             : Integer;          // Memory usage percentage (0-100)
    };

    /**
     * System alert for the alerts panel
     * Includes severity, component, and acknowledgement status
     */
    type SystemHealthAlert {
        id                      : UUID;
        severity                : String(10);       // CRITICAL, HIGH, MEDIUM, LOW
        message                 : String(500);      // Alert message
        component               : String(100);      // Affected component name
        timestamp               : DateTime;         // When alert was triggered
        acknowledged            : Boolean;          // Whether alert has been acknowledged
    };

    /**
     * Performance data point for 24h area/line charts
     * Covers response time, request volume, errors, and CPU
     */
    type SystemPerformanceDataPoint {
        hour                    : String(5);        // Time label (e.g. "0:00")
        responseTime            : Integer;          // Average response time in ms
        requests                : Integer;          // Request count
        errors                  : Integer;          // Error count
        cpu                     : Integer;          // CPU usage percentage
    };

    /**
     * Resource utilization gauges (donut charts)
     */
    type ResourceUtilization {
        cpu                     : Integer;          // CPU usage percentage
        memory                  : Integer;          // Memory usage percentage
        disk                    : Integer;          // Disk usage percentage
        network                 : Integer;          // Network usage percentage
    };

    /**
     * SLA compliance metrics for the SLA panel
     */
    type SLAComplianceMetrics {
        availability            : Decimal(5,2);     // Availability SLA percentage
        performance             : Decimal(5,2);     // Performance SLA percentage
        responseTime            : Decimal(5,2);     // Response time SLA percentage
        overall                 : Decimal(5,2);     // Overall SLA compliance
    };

    function getSystemStatusSummary() returns SystemStatusSummary;
    function getComponentHealthCards() returns array of ComponentHealthCard;
    function getSystemHealthAlerts() returns array of SystemHealthAlert;
    function getSystemPerformanceData(hours: Integer) returns array of SystemPerformanceDataPoint;
    function getResourceUtilization() returns ResourceUtilization;
    function getSLAComplianceMetrics() returns SLAComplianceMetrics;

    action acknowledgeSystemAlert(alertId: UUID) returns SystemHealthAlert;
    action restartComponent(componentId: String) returns ComponentHealthResult;
    action refreshAllComponents() returns HealthCheckResult;
    action exportSystemHealthReport() returns ExportResult;

    // ========================================================================
    // ERROR CODES (FDD-11)
    // ========================================================================
    // INT401 - Connection timeout to external system
    // INT402 - Authentication failure
    // INT403 - Authorization denied
    // INT404 - Resource not found in target system
    // INT405 - Request validation failed
    // INT406 - Response parsing error
    // INT407 - Rate limit exceeded
    // INT408 - Circuit breaker open
    // INT409 - Data transformation error
    // INT410 - Duplicate transaction detected
}

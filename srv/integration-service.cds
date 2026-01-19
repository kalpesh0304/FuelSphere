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

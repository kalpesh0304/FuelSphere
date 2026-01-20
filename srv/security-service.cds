/**
 * FuelSphere - Security Management Service (FDD-13)
 *
 * Comprehensive security administration capabilities:
 * - User Management Dashboard for provisioning and lifecycle
 * - Role Assignment Management with SoD validation
 * - Access Review Campaigns for periodic certification
 * - Audit Log Viewer with advanced filtering and export
 * - Security Event Dashboard with real-time monitoring
 * - SoD Violation Management with exception workflows
 * - Security Incident Management for tracking and resolution
 * - Security Configuration Management for policy settings
 *
 * SOX Controls:
 * - SOX-SEC-001: User Access Provisioning
 * - SOX-SEC-002: Periodic Access Review
 * - SOX-SEC-003: Segregation of Duties
 * - SOX-SEC-004: Privileged Access Control
 * - SOX-SEC-005: Timely Access Removal
 * - SOX-SEC-006: Security Event Monitoring
 * - SOX-SEC-007: Audit Trail Integrity
 *
 * Service Path: /odata/v4/security
 */

using { fuelsphere as db } from '../db/schema';

@path: '/odata/v4/security'
service SecurityService {

    // ========================================================================
    // USER MANAGEMENT
    // ========================================================================

    /**
     * SecurityUsers - User Identity Management
     * Synchronized with SAP Identity Authentication Service
     *
     * Access:
     * - Security Administrator: Full access (UserManagement)
     * - User Administrator: User lifecycle only
     */
    @odata.draft.enabled
    entity SecurityUsers as projection on db.SECURITY_USERS {
        *,
        manager : redirected to SecurityUsers,
        role_assignments : redirected to RoleAssignments
    } actions {
        /**
         * Provision new user with initial role assignments
         */
        action provision(
            roleCollections: String,
            requestReason: String
        ) returns ProvisioningResult;

        /**
         * Deactivate user and remove all access
         */
        action deactivate(reason: String) returns SecurityUsers;

        /**
         * Reactivate previously deactivated user
         */
        action reactivate(reason: String) returns SecurityUsers;

        /**
         * Lock user account
         */
        action lock(
            reason: String,
            expiryHours: Integer
        ) returns SecurityUsers;

        /**
         * Unlock user account
         */
        action unlock() returns SecurityUsers;

        /**
         * Force password reset on next login
         */
        action forcePasswordReset() returns SecurityUsers;

        /**
         * Sync user from SAP IAS
         */
        action syncFromIAS() returns SecurityUsers;

        /**
         * Transfer user to new manager
         */
        action transferManager(newManagerId: UUID) returns SecurityUsers;
    };

    // ========================================================================
    // ROLE ASSIGNMENTS
    // ========================================================================

    /**
     * RoleAssignments - User to Role Mapping
     * Includes approval workflow and SoD validation
     * Note: Draft state inherited from parent SecurityUsers via composition
     */
    entity RoleAssignments as projection on db.ROLE_ASSIGNMENTS {
        *,
        user : redirected to SecurityUsers
    } actions {
        /**
         * Request role assignment (initiates approval workflow)
         */
        action request(
            requestReason: String
        ) returns RoleAssignments;

        /**
         * Approve role assignment
         */
        action approve(approvalNotes: String) returns RoleAssignments;

        /**
         * Reject role assignment
         */
        action reject(rejectionReason: String) returns RoleAssignments;

        /**
         * Revoke role assignment
         */
        action revoke(reason: String) returns RoleAssignments;

        /**
         * Extend validity of temporary assignment
         */
        action extend(newValidTo: Date) returns RoleAssignments;

        /**
         * Validate SoD before assignment
         */
        action validateSoD() returns SoDValidationResult;
    };

    // ========================================================================
    // ACCESS REVIEW CAMPAIGNS
    // ========================================================================

    /**
     * AccessReviewCampaigns - Access Review Campaign Management
     * For quarterly SOX compliance certifications
     */
    @odata.draft.enabled
    entity AccessReviewCampaigns as projection on db.ACCESS_REVIEW_CAMPAIGNS {
        *,
        review_items : redirected to AccessReviewItems
    } actions {
        /**
         * Start the campaign and generate review items
         */
        action start() returns AccessReviewCampaigns;

        /**
         * Send reminders to pending reviewers
         */
        action sendReminders() returns ReminderResult;

        /**
         * Escalate overdue items
         */
        action escalate() returns EscalationResult;

        /**
         * Complete campaign and generate evidence
         */
        action complete() returns CampaignCompletionResult;

        /**
         * Cancel campaign
         */
        action cancel(reason: String) returns AccessReviewCampaigns;

        /**
         * Generate SOX compliance evidence report
         */
        action generateEvidence() returns EvidenceResult;

        /**
         * Clone campaign for next period
         */
        action clone(
            newCampaignCode: String,
            newScheduledStart: Date,
            newScheduledEnd: Date
        ) returns AccessReviewCampaigns;
    };

    /**
     * AccessReviewItems - Individual Certification Items
     */
    entity AccessReviewItems as projection on db.ACCESS_REVIEW_ITEMS {
        *,
        campaign : redirected to AccessReviewCampaigns,
        user : redirected to SecurityUsers,
        role_assignment : redirected to RoleAssignments
    } actions {
        /**
         * Certify access (approve continued access)
         */
        action certify(
            reason: String,
            evidence: String
        ) returns AccessReviewItems;

        /**
         * Revoke access
         */
        action revokeAccess(reason: String) returns AccessReviewItems;

        /**
         * Escalate to another reviewer
         */
        action escalate(
            escalateTo: String,
            reason: String
        ) returns AccessReviewItems;

        /**
         * Delegate review to another user
         */
        action delegate(
            delegateTo: String,
            reason: String
        ) returns AccessReviewItems;
    };

    // ========================================================================
    // SOD MANAGEMENT
    // ========================================================================

    /**
     * SoDViolations - Segregation of Duties Violations
     */
    entity SoDViolations as projection on db.SOD_VIOLATIONS {
        *,
        user : redirected to SecurityUsers,
        role_1_assignment : redirected to RoleAssignments,
        role_2_assignment : redirected to RoleAssignments,
        exception : redirected to SoDExceptions
    } actions {
        /**
         * Request exception for this violation
         */
        action requestException(
            businessJustification: String,
            compensatingControls: String,
            validTo: Date
        ) returns SoDExceptions;

        /**
         * Mark as resolved (one role removed)
         */
        action markResolved(resolution: String) returns SoDViolations;

        /**
         * Accept risk (with CISO approval)
         */
        action acceptRisk(
            riskAcceptance: String
        ) returns SoDViolations;
    };

    /**
     * SoDExceptions - Exception Approvals
     */
    @odata.draft.enabled
    entity SoDExceptions as projection on db.SOD_EXCEPTIONS {
        *,
        violation : redirected to SoDViolations,
        user : redirected to SecurityUsers
    } actions {
        /**
         * First level approval (Manager/Business Owner)
         */
        action approveFirst(notes: String) returns SoDExceptions;

        /**
         * Second level approval (Security Officer/CISO)
         */
        action approveSecond(notes: String) returns SoDExceptions;

        /**
         * Reject exception request
         */
        action reject(reason: String) returns SoDExceptions;

        /**
         * Extend exception validity
         */
        action extend(
            newValidTo: Date,
            justification: String
        ) returns SoDExceptions;

        /**
         * Review and revalidate exception
         */
        action review(reviewNotes: String) returns SoDExceptions;
    };

    /**
     * SoDRules - Rule Definitions
     */
    @odata.draft.enabled
    entity SoDRules as projection on db.SOD_RULES actions {
        /**
         * Test rule against current assignments
         */
        action test() returns SoDRuleTestResult;

        /**
         * Run full scan for violations
         */
        action scan() returns SoDScanResult;
    };

    // ========================================================================
    // SECURITY INCIDENTS
    // ========================================================================

    /**
     * SecurityIncidents - Security Incident Management
     */
    @odata.draft.enabled
    entity SecurityIncidents as projection on db.SECURITY_INCIDENTS actions {
        /**
         * Triage incident and assign severity
         */
        action triage(
            severity: String,
            assignTo: String
        ) returns SecurityIncidents;

        /**
         * Mark incident as contained
         */
        action contain(containmentActions: String) returns SecurityIncidents;

        /**
         * Resolve incident
         */
        action resolve(
            rootCause: String,
            remediationActions: String
        ) returns SecurityIncidents;

        /**
         * Close incident
         */
        action close(lessonsLearned: String) returns SecurityIncidents;

        /**
         * Escalate incident
         */
        action escalate(
            escalateTo: String,
            reason: String
        ) returns SecurityIncidents;

        /**
         * Create incident from alert
         */
        action createFromAlert(alertId: UUID) returns SecurityIncidents;

        /**
         * Send external notification (data breach)
         */
        action sendNotification(
            notificationDetails: String
        ) returns SecurityIncidents;
    };

    // ========================================================================
    // SECURITY ALERTS
    // ========================================================================

    /**
     * SecurityAlerts - Security Monitoring Alerts
     */
    entity SecurityAlerts as projection on db.SECURITY_ALERTS actions {
        /**
         * Acknowledge alert
         */
        action acknowledge() returns SecurityAlerts;

        /**
         * Resolve alert
         */
        action resolve(resolutionNotes: String) returns SecurityAlerts;

        /**
         * Suppress alert (false positive)
         */
        action suppress(reason: String) returns SecurityAlerts;

        /**
         * Create incident from alert
         */
        action createIncident(
            incidentTitle: String,
            severity: String
        ) returns SecurityIncidents;

        /**
         * Escalate alert
         */
        action escalate(escalateTo: String) returns SecurityAlerts;
    };

    // ========================================================================
    // AUDIT LOGS
    // ========================================================================

    /**
     * SecurityAuditLogs - Comprehensive Audit Trail
     * Read-only for integrity
     */
    @readonly
    entity SecurityAuditLogs as projection on db.SECURITY_AUDIT_LOGS;

    // ========================================================================
    // SECURITY CONFIGURATION
    // ========================================================================

    /**
     * SecurityConfigurations - Policy Settings
     */
    @odata.draft.enabled
    entity SecurityConfigurations as projection on db.SECURITY_CONFIGURATIONS actions {
        /**
         * Update configuration value
         */
        action updateValue(
            newValue: String,
            changeReason: String,
            changeTicket: String
        ) returns SecurityConfigurations;

        /**
         * Reset to default value
         */
        action resetToDefault() returns SecurityConfigurations;
    };

    // ========================================================================
    // SERVICE-LEVEL ACTIONS
    // ========================================================================

    /**
     * Validate SoD for user and role combination
     */
    action validateSoD(
        userId: UUID,
        roleCollection: String
    ) returns SoDValidationResult;

    /**
     * Run full SoD scan for all users
     */
    action runSoDScan() returns SoDScanResult;

    /**
     * Export audit logs with filters
     */
    action exportAuditLogs(
        fromDate: DateTime,
        toDate: DateTime,
        eventCategory: String,
        userId: UUID,
        format: String
    ) returns AuditExportResult;

    /**
     * Generate user access report
     */
    action generateUserAccessReport(
        companyCode: String,
        includeInactive: Boolean
    ) returns ReportResult;

    /**
     * Generate privileged access report
     */
    action generatePrivilegedAccessReport(
        companyCode: String
    ) returns ReportResult;

    /**
     * Provision user from HR event
     */
    action provisionFromHR(
        employeeId: String,
        email: String,
        displayName: String,
        department: String,
        managerId: UUID
    ) returns ProvisioningResult;

    /**
     * Deprovision user (leaver process)
     */
    action deprovisionUser(
        userId: UUID,
        reason: String,
        effectiveDate: Date
    ) returns DeprovisioningResult;

    /**
     * Bulk role assignment
     */
    action bulkAssignRole(
        userIds: String,
        roleCollection: String,
        validFrom: Date,
        validTo: Date,
        requestReason: String
    ) returns BulkAssignmentResult;

    /**
     * Generate access review campaign
     */
    action generateAccessReviewItems(
        campaignId: UUID
    ) returns CampaignGenerationResult;

    /**
     * Create security alert from event
     */
    action createAlert(
        alertType: String,
        severity: String,
        relatedUserId: UUID,
        alertDetails: String
    ) returns SecurityAlerts;

    /**
     * Log security audit event
     */
    action logAuditEvent(
        eventCategory: String,
        eventType: String,
        objectType: String,
        objectId: String,
        action: String,
        oldValue: String,
        newValue: String,
        result: String
    ) returns SecurityAuditLogs;

    // ========================================================================
    // SERVICE-LEVEL FUNCTIONS
    // ========================================================================

    /**
     * Get security dashboard summary
     */
    function getSecurityDashboard() returns SecurityDashboard;

    /**
     * Get user access summary
     */
    function getUserAccessSummary(userId: UUID) returns UserAccessSummary;

    /**
     * Get pending approvals for current user
     */
    function getMyPendingApprovals() returns array of PendingApproval;

    /**
     * Get access review status
     */
    function getAccessReviewStatus(campaignId: UUID) returns CampaignStatus;

    /**
     * Get SoD violations summary
     */
    function getSoDViolationsSummary() returns SoDSummary;

    /**
     * Get active alerts summary
     */
    function getActiveAlertsSummary() returns AlertsSummary;

    /**
     * Get incident metrics
     */
    function getIncidentMetrics(
        fromDate: Date,
        toDate: Date
    ) returns IncidentMetrics;

    /**
     * Get login activity for user
     */
    function getLoginActivity(
        userId: UUID,
        days: Integer
    ) returns array of LoginActivity;

    /**
     * Get role conflicts for user
     */
    function getRoleConflicts(userId: UUID) returns array of RoleConflict;

    /**
     * Get expiring certifications
     */
    function getExpiringCertifications(
        daysAhead: Integer
    ) returns array of ExpiringAccess;

    /**
     * Get audit log statistics
     */
    function getAuditLogStatistics(
        fromDate: Date,
        toDate: Date
    ) returns AuditStatistics;

    /**
     * Search users
     */
    function searchUsers(
        searchTerm: String,
        status: String,
        department: String
    ) returns array of UserSearchResult;

    // ========================================================================
    // TYPE DEFINITIONS
    // ========================================================================

    type ProvisioningResult {
        success             : Boolean;
        userId              : UUID;
        userName            : String(100);
        email               : String(256);
        rolesAssigned       : Integer;
        sodViolationsFound  : Integer;
        message             : String(500);
    };

    type DeprovisioningResult {
        success             : Boolean;
        userId              : UUID;
        rolesRevoked        : Integer;
        sessionsTerminated  : Integer;
        auditLogId          : UUID;
        message             : String(500);
    };

    type SoDValidationResult {
        isValid             : Boolean;
        userId              : UUID;
        requestedRole       : String(100);
        conflictCount       : Integer;
        conflicts           : array of SoDConflict;
        message             : String(500);
    };

    type SoDConflict {
        ruleId              : String(50);
        ruleName            : String(200);
        conflictingRole     : String(100);
        riskLevel           : String(10);
        riskDescription     : String(500);
        exceptionAllowed    : Boolean;
    };

    type SoDScanResult {
        success             : Boolean;
        usersScanned        : Integer;
        violationsFound     : Integer;
        newViolations       : Integer;
        resolvedViolations  : Integer;
        scanDurationSec     : Integer;
        message             : String(500);
    };

    type SoDRuleTestResult {
        success             : Boolean;
        ruleId              : String(50);
        usersAffected       : Integer;
        violationsFound     : Integer;
        sampleViolations    : array of SampleViolation;
        message             : String(500);
    };

    type SampleViolation {
        userId              : UUID;
        userName            : String(100);
        role1               : String(100);
        role2               : String(100);
    };

    type ReminderResult {
        success             : Boolean;
        campaignId          : UUID;
        remindersSent       : Integer;
        failedCount         : Integer;
        message             : String(500);
    };

    type EscalationResult {
        success             : Boolean;
        campaignId          : UUID;
        itemsEscalated      : Integer;
        message             : String(500);
    };

    type CampaignCompletionResult {
        success             : Boolean;
        campaignId          : UUID;
        totalItems          : Integer;
        certifiedCount      : Integer;
        revokedCount        : Integer;
        completionPct       : Decimal(5,2);
        evidenceGenerated   : Boolean;
        evidencePath        : String(500);
        message             : String(500);
    };

    type CampaignGenerationResult {
        success             : Boolean;
        campaignId          : UUID;
        itemsGenerated      : Integer;
        usersInScope        : Integer;
        rolesInScope        : Integer;
        message             : String(500);
    };

    type EvidenceResult {
        success             : Boolean;
        campaignId          : UUID;
        evidenceFilePath    : String(500);
        generatedAt         : DateTime;
        message             : String(500);
    };

    type AuditExportResult {
        success             : Boolean;
        recordsExported     : Integer;
        filePath            : String(500);
        format              : String(10);
        fileSize            : Integer;
        message             : String(500);
    };

    type ReportResult {
        success             : Boolean;
        reportName          : String(100);
        filePath            : String(500);
        recordCount         : Integer;
        generatedAt         : DateTime;
        message             : String(500);
    };

    type BulkAssignmentResult {
        success             : Boolean;
        totalUsers          : Integer;
        successCount        : Integer;
        failedCount         : Integer;
        sodBlockedCount     : Integer;
        results             : array of AssignmentResult;
        message             : String(500);
    };

    type AssignmentResult {
        userId              : UUID;
        userName            : String(100);
        success             : Boolean;
        sodViolation        : Boolean;
        message             : String(500);
    };

    type SecurityDashboard {
        activeUsers         : Integer;
        pendingProvisioning : Integer;
        openAccessReviews   : Integer;
        sodViolations       : Integer;
        failedLogins24h     : Integer;
        openIncidents       : Integer;
        criticalAlerts      : Integer;
        expiringCerts30d    : Integer;
        lastUpdated         : DateTime;
    };

    type UserAccessSummary {
        userId              : UUID;
        userName            : String(100);
        email               : String(256);
        status              : String(15);
        roleCount           : Integer;
        roles               : array of RoleSummary;
        sodViolations       : Integer;
        lastLogin           : DateTime;
        pendingReviews      : Integer;
    };

    type RoleSummary {
        roleCollection      : String(100);
        validFrom           : Date;
        validTo             : Date;
        status              : String(20);
        hasSoDConflict      : Boolean;
    };

    type PendingApproval {
        approvalType        : String(30);
        requestId           : UUID;
        requestedBy         : String(100);
        requestedAt         : DateTime;
        subject             : String(200);
        priority            : String(10);
        dueDate             : Date;
    };

    type CampaignStatus {
        campaignId          : UUID;
        campaignCode        : String(30);
        status              : String(20);
        totalItems          : Integer;
        completedItems      : Integer;
        pendingItems        : Integer;
        overdueItems        : Integer;
        completionPct       : Decimal(5,2);
        daysRemaining       : Integer;
    };

    type SoDSummary {
        totalViolations     : Integer;
        newLast7Days        : Integer;
        pendingExceptions   : Integer;
        approvedExceptions  : Integer;
        byRiskLevel         : array of RiskLevelCount;
    };

    type RiskLevelCount {
        riskLevel           : String(10);
        count               : Integer;
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

    type IncidentMetrics {
        totalIncidents      : Integer;
        openIncidents       : Integer;
        avgMTTD             : Integer;
        avgMTTR             : Integer;
        bySeverity          : array of SeverityCount;
        byStatus            : array of StatusCount;
    };

    type SeverityCount {
        severity            : String(15);
        count               : Integer;
    };

    type StatusCount {
        status              : String(20);
        count               : Integer;
    };

    type LoginActivity {
        timestamp           : DateTime;
        ipAddress           : String(45);
        result              : String(10);
        userAgent           : String(500);
        location            : String(100);
    };

    type RoleConflict {
        role1               : String(100);
        role2               : String(100);
        ruleId              : String(50);
        riskLevel           : String(10);
        hasException        : Boolean;
        exceptionValidTo    : Date;
    };

    type ExpiringAccess {
        userId              : UUID;
        userName            : String(100);
        roleCollection      : String(100);
        validTo             : Date;
        daysRemaining       : Integer;
    };

    type AuditStatistics {
        totalEvents         : Integer;
        byCategory          : array of CategoryCount;
        byResult            : array of ResultCount;
        topUsers            : array of UserEventCount;
        failedLogins        : Integer;
        dataChanges         : Integer;
    };

    type CategoryCount {
        category            : String(20);
        count               : Integer;
    };

    type ResultCount {
        result              : String(10);
        count               : Integer;
    };

    type UserEventCount {
        userId              : UUID;
        userName            : String(100);
        eventCount          : Integer;
    };

    type UserSearchResult {
        userId              : UUID;
        userName            : String(100);
        displayName         : String(256);
        email               : String(256);
        department          : String(100);
        status              : String(15);
        roleCount           : Integer;
    };

    // ========================================================================
    // ERROR CODES (FDD-13)
    // ========================================================================
    // SEC601 - User not found
    // SEC602 - User already exists
    // SEC603 - Invalid user status transition
    // SEC604 - Role assignment not found
    // SEC605 - SoD violation detected - assignment blocked
    // SEC606 - Exception request pending
    // SEC607 - Approval workflow error
    // SEC608 - Access review campaign error
    // SEC609 - Audit log export failed
    // SEC610 - Security configuration invalid
    // SEC611 - Insufficient privileges
    // SEC612 - Dual approval required
}

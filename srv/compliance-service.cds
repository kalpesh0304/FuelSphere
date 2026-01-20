/**
 * FuelSphere - Compliance Service (FDD-07)
 *
 * Embargo & Compliance Module - Regulatory control center:
 * - Country embargo screening with automatic blocking
 * - Supplier sanction screening against OFAC, EU, UN lists
 * - Real-time compliance checks during transaction processing
 * - Exception workflow with dual approval (Compliance Officer + Legal)
 * - Tamper-evident audit logging for SOX compliance
 *
 * Integration Points:
 * - FDD-04 Fuel Orders: Pre-order compliance check
 * - FDD-05 ePOD: Delivery compliance validation
 * - FDD-06 Invoice: Supplier compliance verification
 *
 * Service Path: /odata/v4/compliance
 */

using { fuelsphere as db } from '../db/schema';

@path: '/odata/v4/compliance'
service ComplianceService {

    // ========================================================================
    // CORE SCREENING FUNCTION
    // Called by FDD-04, FDD-05, FDD-06 modules
    // ========================================================================

    /**
     * Screen a transaction for compliance
     * This is the primary entry point for all compliance checks
     *
     * @param sourceModule - Calling module (FDD-04, FDD-05, FDD-06)
     * @param sourceEntityType - Type of entity (FUEL_ORDER, FUEL_DELIVERY, INVOICE)
     * @param sourceEntityId - UUID of the source transaction
     * @param countryCode - Country to screen (optional)
     * @param supplierId - Supplier to screen (optional)
     * @param additionalValue - Additional value to screen (aircraft reg, etc.)
     *
     * @returns ComplianceScreenResult with decision (PASS, BLOCK, REVIEW)
     */
    action screen(
        sourceModule: String,
        sourceEntityType: String,
        sourceEntityId: UUID,
        countryCode: String,
        supplierId: UUID,
        additionalValue: String
    ) returns ComplianceScreenResult;

    /**
     * Batch screen multiple transactions
     * Used for bulk operations
     */
    action batchScreen(requests: array of ScreenRequest) returns BatchScreenResult;

    // ========================================================================
    // SANCTION LIST MANAGEMENT
    // ========================================================================

    /**
     * SanctionLists - Sanction List Definitions
     * Managed by Compliance Officer
     */
    @odata.draft.enabled
    entity SanctionLists as projection on db.SANCTION_LISTS {
        *,
        entities : redirected to SanctionedEntities
    } actions {
        /**
         * Import entities from external file
         * Accepts CSV or JSON format
         */
        action importEntities(
            fileContent: LargeBinary,
            fileFormat: String,
            replaceExisting: Boolean
        ) returns ImportResult;

        /**
         * Validate list integrity
         */
        action validateList() returns ListValidationResult;

        /**
         * Mark list as updated (after manual review)
         */
        action markUpdated(newVersion: String) returns SanctionLists;
    };

    /**
     * SanctionedEntities - Entities on Sanction Lists
     * Note: Draft state inherited from parent SanctionLists via composition
     */
    // @odata.draft.enabled
    entity SanctionedEntities as projection on db.SANCTIONED_ENTITIES {
        *,
        sanction_list : redirected to SanctionLists,
        country : redirected to Countries
    } actions {
        /**
         * Search for potential matches against this entity
         * Returns suppliers that may match this sanctioned entity
         */
        action findPotentialMatches() returns array of PotentialMatch;
    };

    // ========================================================================
    // COUNTRY EMBARGO MANAGEMENT
    // ========================================================================

    /**
     * Countries - Extended with embargo fields
     * Read from Master Data, embargo fields managed here
     */
    entity Countries as projection on db.T005_COUNTRY actions {
        /**
         * Set embargo status for a country
         */
        action setEmbargoStatus(
            isEmbargoed: Boolean,
            embargoReason: String,
            sanctionPrograms: String,
            effectiveDate: Date
        ) returns Countries;

        /**
         * Clear embargo status
         */
        action clearEmbargo(clearanceReason: String) returns Countries;
    };

    // ========================================================================
    // COMPLIANCE CHECKS - AUDIT TRAIL
    // ========================================================================

    /**
     * ComplianceChecks - Screening Transaction Log
     * Read-only - populated by screen() action
     */
    @readonly
    entity ComplianceChecks as projection on db.COMPLIANCE_CHECKS {
        *,
        screened_country    : redirected to Countries,
        screened_supplier   : redirected to Suppliers,
        matched_entity      : redirected to SanctionedEntities,
        matched_list        : redirected to SanctionLists
    };

    // ========================================================================
    // EXCEPTION MANAGEMENT
    // ========================================================================

    /**
     * ComplianceExceptions - Exception Requests and Approvals
     * Full workflow from request to approval/rejection
     */
    @odata.draft.enabled
    entity ComplianceExceptions as projection on db.COMPLIANCE_EXCEPTIONS {
        *,
        compliance_check    : redirected to ComplianceChecks,
        applies_to_country  : redirected to Countries,
        applies_to_supplier : redirected to Suppliers
    } actions {
        /**
         * Submit exception request for approval
         * Validates justification length (min 50 chars)
         */
        action submit() returns ComplianceExceptions;

        /**
         * First-level approval (Compliance Officer)
         */
        action approve(comments: String) returns ComplianceExceptions;

        /**
         * Second-level approval (Legal Counsel)
         * Required for sanctions-related exceptions
         */
        action legalApprove(comments: String) returns ComplianceExceptions;

        /**
         * Reject exception request
         */
        action reject(reason: String) returns ComplianceExceptions;

        /**
         * Renew expiring exception
         * Creates new exception based on existing one
         */
        action renew(newExpiryDate: Date, renewalJustification: String) returns ComplianceExceptions;

        /**
         * Revoke approved exception
         */
        action revoke(revocationReason: String) returns ComplianceExceptions;
    };

    // ========================================================================
    // AUDIT LOGS - TAMPER-EVIDENT
    // ========================================================================

    /**
     * ComplianceAuditLogs - Immutable Audit Trail
     * Read-only - SOX compliance requirement
     */
    @readonly
    entity ComplianceAuditLogs as projection on db.COMPLIANCE_AUDIT_LOGS;

    // ========================================================================
    // REFERENCE DATA (Read-only)
    // ========================================================================

    @readonly
    entity Suppliers as projection on db.MASTER_SUPPLIERS {
        *,
        country : redirected to Countries
    };

    // ========================================================================
    // DASHBOARD & MONITORING FUNCTIONS
    // ========================================================================

    /**
     * Get compliance dashboard KPIs
     */
    function getDashboardKPIs(fromDate: Date, toDate: Date) returns ComplianceDashboardKPIs;

    /**
     * Get pending exception requests queue
     */
    function getExceptionQueue() returns array of ExceptionQueueItem;

    /**
     * Get recent blocked transactions
     */
    function getBlockedTransactions(limit: Integer) returns array of BlockedTransaction;

    /**
     * Get embargoed countries list
     */
    function getEmbargoedCountries() returns array of EmbargoedCountry;

    /**
     * Check if a specific country is embargoed
     */
    function isCountryEmbargoed(countryCode: String) returns CountryEmbargoStatus;

    /**
     * Check if a supplier has any sanction matches
     */
    function checkSupplierCompliance(supplierId: UUID) returns SupplierComplianceStatus;

    /**
     * Get sanction list update status
     */
    function getSanctionListStatus() returns array of SanctionListStatus;

    /**
     * Search sanctioned entities by name (fuzzy match)
     */
    function searchSanctionedEntities(
        searchTerm: String,
        entityType: String,
        jurisdiction: String,
        limit: Integer
    ) returns array of SanctionedEntityMatch;

    /**
     * Generate compliance report
     */
    function generateComplianceReport(
        reportType: String,
        fromDate: Date,
        toDate: Date,
        jurisdiction: String
    ) returns ComplianceReport;

    /**
     * Verify audit log integrity
     * Checks hash chain for tampering
     */
    action verifyAuditLogIntegrity(fromDate: Date, toDate: Date) returns AuditIntegrityResult;

    /**
     * Generate exception number
     * Format: EXC-{YYYY}-{SEQ}
     */
    function generateExceptionNumber() returns String;

    // ========================================================================
    // TYPE DEFINITIONS
    // ========================================================================

    type ScreenRequest {
        sourceModule        : String(20);
        sourceEntityType    : String(50);
        sourceEntityId      : UUID;
        countryCode         : String(3);
        supplierId          : UUID;
        additionalValue     : String(200);
    };

    type ComplianceScreenResult {
        success             : Boolean;
        checkId             : UUID;
        result              : String(20);     // PASS, BLOCK, REVIEW
        countryScreened     : String(3);
        countryEmbargoed    : Boolean;
        supplierScreened    : String(100);
        supplierMatchFound  : Boolean;
        matchScore          : Decimal(5,2);
        matchedEntityName   : String(200);
        matchedListCode     : String(20);
        blockReason         : String(500);
        hasActiveException  : Boolean;
        exceptionId         : UUID;
        message             : String(500);
    };

    type BatchScreenResult {
        success             : Boolean;
        totalRequests       : Integer;
        passCount           : Integer;
        blockCount          : Integer;
        reviewCount         : Integer;
        results             : array of ComplianceScreenResult;
        message             : String(500);
    };

    type ImportResult {
        success             : Boolean;
        listCode            : String(20);
        totalRecords        : Integer;
        importedCount       : Integer;
        skippedCount        : Integer;
        errorCount          : Integer;
        errors              : array of ImportError;
        message             : String(500);
    };

    type ImportError {
        lineNumber          : Integer;
        entityName          : String(200);
        errorCode           : String(10);
        message             : String(500);
    };

    type ListValidationResult {
        success             : Boolean;
        listCode            : String(20);
        entityCount         : Integer;
        duplicateCount      : Integer;
        invalidCount        : Integer;
        issues              : array of ValidationIssue;
    };

    type ValidationIssue {
        entityId            : UUID;
        entityName          : String(200);
        issueType           : String(50);
        message             : String(500);
    };

    type PotentialMatch {
        supplierId          : UUID;
        supplierCode        : String(20);
        supplierName        : String(100);
        matchScore          : Decimal(5,2);
        matchReason         : String(500);
    };

    type ComplianceDashboardKPIs {
        totalChecksToday    : Integer;
        totalChecksWeek     : Integer;
        totalChecksMonth    : Integer;
        blockedToday        : Integer;
        blockedWeek         : Integer;
        blockedMonth        : Integer;
        pendingExceptions   : Integer;
        activeExceptions    : Integer;
        expiringExceptions  : Integer;  // Expiring in 30 days
        embargoedCountries  : Integer;
        sanctionListsActive : Integer;
        lastListUpdate      : DateTime;
        daysSinceListUpdate : Integer;
    };

    type ExceptionQueueItem {
        exceptionId         : UUID;
        exceptionNumber     : String(20);
        requestedBy         : String(100);
        requestDate         : DateTime;
        status              : String(20);
        exceptionType       : String(20);
        countryCode         : String(3);
        supplierName        : String(100);
        justificationPreview : String(200);
        requiresLegalApproval : Boolean;
        daysOpen            : Integer;
    };

    type BlockedTransaction {
        checkId             : UUID;
        checkTimestamp      : DateTime;
        sourceModule        : String(20);
        sourceEntityType    : String(50);
        countryCode         : String(3);
        countryName         : String(100);
        supplierName        : String(100);
        blockReason         : String(500);
        performedBy         : String(100);
    };

    type EmbargoedCountry {
        countryCode         : String(3);
        countryName         : String(100);
        embargoEffectiveDate : Date;
        embargoReason       : String(500);
        sanctionPrograms    : String(200);
        riskLevel           : String(10);
    };

    type CountryEmbargoStatus {
        countryCode         : String(3);
        countryName         : String(100);
        isEmbargoed         : Boolean;
        embargoEffectiveDate : Date;
        sanctionPrograms    : String(200);
        riskLevel           : String(10);
    };

    type SupplierComplianceStatus {
        supplierId          : UUID;
        supplierCode        : String(20);
        supplierName        : String(100);
        isCompliant         : Boolean;
        matchesFound        : Integer;
        highestMatchScore   : Decimal(5,2);
        matches             : array of SupplierSanctionMatch;
        lastCheckDate       : DateTime;
        hasActiveException  : Boolean;
    };

    type SupplierSanctionMatch {
        sanctionedEntityId  : UUID;
        entityName          : String(200);
        entityType          : String(20);
        listCode            : String(20);
        matchScore          : Decimal(5,2);
        listingDate         : Date;
    };

    type SanctionListStatus {
        listCode            : String(20);
        listName            : String(100);
        jurisdiction        : String(10);
        lastUpdate          : DateTime;
        version             : String(20);
        entityCount         : Integer;
        daysSinceUpdate     : Integer;
        isActive            : Boolean;
    };

    type SanctionedEntityMatch {
        entityId            : UUID;
        entityName          : String(200);
        entityType          : String(20);
        aliases             : String(1000);
        countryCode         : String(3);
        listCode            : String(20);
        listingDate         : Date;
        matchScore          : Decimal(5,2);
    };

    type ComplianceReport {
        reportType          : String(50);
        generatedAt         : DateTime;
        generatedBy         : String(100);
        fromDate            : Date;
        toDate              : Date;
        jurisdiction        : String(10);
        totalChecks         : Integer;
        passedChecks        : Integer;
        blockedChecks       : Integer;
        reviewChecks        : Integer;
        exceptionsGranted   : Integer;
        exceptionsRejected  : Integer;
        reportData          : LargeString;  // JSON detailed data
    };

    type AuditIntegrityResult {
        success             : Boolean;
        fromDate            : Date;
        toDate              : Date;
        totalRecords        : Integer;
        verifiedRecords     : Integer;
        failedRecords       : Integer;
        integrityStatus     : String(20);   // INTACT, TAMPERED, INCOMPLETE
        failedHashes        : array of FailedHashEntry;
        message             : String(500);
    };

    type FailedHashEntry {
        logId               : UUID;
        logSequence         : Integer;
        expectedHash        : String(64);
        actualHash          : String(64);
        logTimestamp        : DateTime;
    };

    // ========================================================================
    // ERROR CODES (FDD-07)
    // ========================================================================
    // CMP401 - Embargo effective date required
    // CMP402 - Duplicate sanction list code
    // CMP403 - Entity name cannot be empty
    // CMP404 - Justification too short (min 50 chars)
    // CMP405 - Invalid exception expiry date (must be <= 12 months)
    // CMP406 - Match score out of range (0-100)
    // CMP410 - Country is embargoed - transaction blocked
    // CMP411 - Supplier matches sanction list - review required
    // CMP412 - Compliance exception expired
    // CMP413 - Sanction list update failed
    // CMP420 - Audit log integrity verification failed
    // CMP421 - Hash chain broken - potential tampering detected
}

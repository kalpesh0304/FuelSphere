/**
 * FuelSphere - Invoice Verification Service (FDD-06)
 *
 * Financial control hub with three-way matching and approval workflows:
 * - Three-way matching: PO ↔ GR (ePOD) ↔ Invoice
 * - Configurable variance tolerance rules
 * - Dual approval workflow for exceptions
 * - Duplicate invoice detection and prevention
 * - S/4HANA FI posting upon approval
 * - GR/IR clearing and reconciliation
 *
 * SOX Controls: INV-001 to INV-008 implemented
 *
 * Service Path: /odata/v4/invoice
 */

using { fuelsphere as db } from '../db/schema';

@path: '/odata/v4/invoice'
service InvoiceService {

    // ========================================================================
    // CORE ENTITIES - Invoice Management
    // ========================================================================

    /**
     * Invoices - Supplier Invoice Header
     * Draft-enabled for work-in-progress entry
     *
     * Access:
     * - AP Clerk: Create/Edit draft invoices, execute matching
     * - Finance Controller: Verify, approve, post to S/4HANA
     * - Finance Manager: Override exceptions, configure tolerances
     *
     * SOX Control INV-001: Invoice creator cannot approve same invoice
     */
    @odata.draft.enabled
    entity Invoices as projection on db.INVOICES {
        *,
        supplier        : redirected to Suppliers,
        currency        : redirected to Currencies,
        duplicate_of    : redirected to Invoices,
        items           : redirected to InvoiceItems,
        matches         : redirected to InvoiceMatches,
        approvals       : redirected to InvoiceApprovals,

        // Virtual fields for UI criticality and computed values
        virtual null as statusCriticality   : Integer,  // SAP Criticality for status field
        virtual null as approvalCriticality : Integer,  // SAP Criticality for approval_status
        virtual null as matchingCriticality : Integer,  // SAP Criticality for match_status
        virtual null as daysUntilDue        : Integer   // Computed days until due_date
    } actions {
        /**
         * Check for duplicate invoice
         * Validates: supplier + invoice_number + invoice_date
         * SOX Control INV-004
         */
        action checkDuplicate() returns DuplicateCheckResult;

        /**
         * Execute three-way match for all line items
         * Matches against PO and GR (ePOD) data
         * SOX Control INV-003
         */
        action executeThreeWayMatch() returns ThreeWayMatchResult;

        /**
         * Submit invoice for approval
         * Transitions: Draft → Verified (if matched)
         * Routes to approval queue based on variance
         */
        action submit() returns Invoices;

        /**
         * Approve invoice (first level)
         * SOX Control INV-002: Dual approval for variances > threshold
         */
        action approve(comments: String) returns Invoices;

        /**
         * Final approve (second level for exceptions)
         * SOX Control INV-008: Approval value limits per role
         */
        action finalApprove(comments: String) returns Invoices;

        /**
         * Reject invoice
         * Returns to AP Clerk for correction
         */
        action reject(reason: String) returns Invoices;

        /**
         * Post to S/4HANA FI
         * Creates FI document upon final approval
         */
        action postToS4HANA() returns FIPostingResult;

        /**
         * Cancel/reverse invoice
         * Creates reversal document if already posted
         */
        action cancel(reason: String) returns Invoices;

        /**
         * Escalate to Finance Manager
         */
        action escalate(reason: String) returns Invoices;

        /**
         * Recalculate totals
         * Sums line items and updates header amounts
         */
        action recalculateTotals() returns Invoices;
    };

    /**
     * InvoiceItems - Invoice Line Items
     */
    entity InvoiceItems as projection on db.INVOICE_ITEMS {
        *,
        invoice     : redirected to Invoices,
        product     : redirected to Products,
        uom         : redirected to UnitsOfMeasure,
        delivery    : redirected to FuelDeliveries,
        fuel_order  : redirected to FuelOrders
    } actions {
        /**
         * Match single line item
         * Executes three-way match for this line only
         */
        action matchLine() returns LineMatchResult;

        /**
         * Link to delivery/ePOD
         */
        action linkToDelivery(deliveryId: UUID) returns InvoiceItems;
    };

    /**
     * InvoiceMatches - Three-Way Match Results
     * Read-only - populated by matching engine
     */
    @readonly
    entity InvoiceMatches as projection on db.INVOICE_MATCHES {
        *,
        invoice         : redirected to Invoices,
        invoice_item    : redirected to InvoiceItems,
        tolerance_rule  : redirected to ToleranceRules
    };

    /**
     * InvoiceApprovals - Approval Workflow History
     * Read-only audit trail
     * SOX Control INV-007
     */
    @readonly
    entity InvoiceApprovals as projection on db.INVOICE_APPROVALS {
        *,
        invoice : redirected to Invoices
    };

    // ========================================================================
    // TOLERANCE CONFIGURATION
    // ========================================================================

    /**
     * ToleranceRules - Variance Tolerance Configuration
     * Admin only - Finance Manager role
     *
     * SOX Controls INV-005, INV-006: Variance threshold alerts
     */
    @odata.draft.enabled
    entity ToleranceRules as projection on db.TOLERANCE_RULES actions {
        /**
         * Test tolerance rule against sample data
         */
        action testRule(
            invoiceQty: Decimal,
            grQty: Decimal,
            invoicePrice: Decimal,
            poPrice: Decimal
        ) returns ToleranceTestResult;

        /**
         * Copy rule for new scope
         */
        action copyRule(newRuleCode: String, companyCode: String) returns ToleranceRules;
    };

    // ========================================================================
    // GR/IR CLEARING
    // ========================================================================

    /**
     * GRIRClearing - Goods Receipt / Invoice Receipt Clearing
     */
    entity GRIRClearing as projection on db.GR_IR_CLEARING {
        *,
        invoice         : redirected to Invoices,
        invoice_item    : redirected to InvoiceItems,
        delivery        : redirected to FuelDeliveries
    } actions {
        /**
         * Execute clearing for this entry
         */
        action executeClear() returns GRIRClearing;

        /**
         * Reverse clearing entry
         */
        action reverseClear(reason: String) returns GRIRClearing;
    };

    // ========================================================================
    // REFERENCE DATA (Read-only from other modules)
    // ========================================================================

    @readonly
    entity Suppliers as projection on db.MASTER_SUPPLIERS {
        *,
        country : redirected to Countries
    };

    @readonly
    entity Products as projection on db.MASTER_PRODUCTS {
        *,
        uom : redirected to UnitsOfMeasure
    };

    @readonly
    entity FuelOrders as projection on db.FUEL_ORDERS {
        *,
        supplier    : redirected to Suppliers,
        contract    : redirected to Contracts,
        product     : redirected to Products,
        airport     : redirected to Airports
    };

    @readonly
    entity FuelDeliveries as projection on db.FUEL_DELIVERIES {
        *,
        order : redirected to FuelOrders
    };

    @readonly
    entity Contracts as projection on db.MASTER_CONTRACTS {
        *,
        supplier : redirected to Suppliers,
        currency : redirected to Currencies
    };

    @readonly
    entity Airports as projection on db.MASTER_AIRPORTS {
        *,
        country : redirected to Countries
    };

    @readonly
    entity Countries as projection on db.T005_COUNTRY;

    @readonly
    entity Currencies as projection on db.CURRENCY_MASTER;

    @readonly
    entity UnitsOfMeasure as projection on db.UNIT_OF_MEASURE;

    // ========================================================================
    // SERVICE-LEVEL FUNCTIONS
    // ========================================================================

    /**
     * Get invoice verification dashboard KPIs
     */
    function getDashboardKPIs(companyCode: String, fromDate: Date, toDate: Date) returns DashboardKPIs;

    /**
     * Get exception queue - invoices requiring attention
     */
    function getExceptionQueue(companyCode: String) returns array of ExceptionQueueItem;

    /**
     * Get approval queue for current user
     */
    function getApprovalQueue() returns array of ApprovalQueueItem;

    /**
     * Get GR/IR open items for reconciliation
     */
    function getOpenGRIRItems(companyCode: String) returns array of OpenGRIRItem;

    /**
     * Search invoices by multiple criteria
     */
    function searchInvoices(
        supplierCode: String,
        invoiceNumber: String,
        poNumber: String,
        fromDate: Date,
        toDate: Date,
        status: String,
        matchStatus: String
    ) returns array of InvoiceSearchResult;

    /**
     * Get tolerance rules for company/supplier/product
     */
    function getApplicableTolerances(
        companyCode: String,
        supplierCategory: String,
        productType: String
    ) returns array of ToleranceRules;

    /**
     * Calculate variance for given quantities/prices
     */
    function calculateVariance(
        invoiceQty: Decimal,
        grQty: Decimal,
        invoicePrice: Decimal,
        poPrice: Decimal
    ) returns VarianceCalculation;

    /**
     * Generate next invoice internal number
     * Format: INV-{SUPPLIER}-{YYYYMMDD}-{SEQ}
     */
    function generateInternalNumber(supplierCode: String) returns String;

    /**
     * Batch execute three-way match for multiple invoices
     */
    action batchThreeWayMatch(invoiceIds: array of UUID) returns BatchMatchResult;

    /**
     * Batch post approved invoices to S/4HANA
     */
    action batchPostToS4HANA(invoiceIds: array of UUID) returns BatchPostResult;

    /**
     * Execute GR/IR clearing run
     */
    action executeGRIRClearingRun(companyCode: String, clearingDate: Date) returns GRIRClearingRunResult;

    // ========================================================================
    // TYPE DEFINITIONS
    // ========================================================================

    type DuplicateCheckResult {
        isDuplicate         : Boolean;
        originalInvoiceId   : UUID;
        originalInvoiceNumber : String(20);
        originalInvoiceDate : Date;
        supplierCode        : String(20);
        message             : String(500);
    };

    type ThreeWayMatchResult {
        success             : Boolean;
        invoiceId           : UUID;
        invoiceNumber       : String(20);
        totalLines          : Integer;
        matchedLines        : Integer;
        exceptionLines      : Integer;
        overallMatchStatus  : String(20);
        totalPriceVariance  : Decimal(15,2);
        totalQtyVariance    : Decimal(12,2);
        requiresDualApproval : Boolean;
        lineResults         : array of LineMatchResult;
        message             : String(500);
    };

    type LineMatchResult {
        success             : Boolean;
        lineNumber          : Integer;
        poNumber            : String(10);
        poQuantity          : Decimal(12,3);
        poPrice             : Decimal(15,4);
        grNumber            : String(10);
        grQuantity          : Decimal(12,3);
        invoiceQuantity     : Decimal(12,3);
        invoicePrice        : Decimal(15,4);
        qtyVariance         : Decimal(12,3);
        qtyVariancePct      : Decimal(5,2);
        priceVariance       : Decimal(15,4);
        priceVariancePct    : Decimal(5,2);
        matchStatus         : String(20);
        withinTolerance     : Boolean;
        toleranceRuleApplied : String(20);
        message             : String(500);
    };

    type FIPostingResult {
        success             : Boolean;
        invoiceId           : UUID;
        invoiceNumber       : String(20);
        s4DocumentNumber    : String(10);
        s4FiscalYear        : String(4);
        s4CompanyCode       : String(4);
        postingDate         : Date;
        postedAmount        : Decimal(15,2);
        currency            : String(3);
        message             : String(500);
    };

    type ToleranceTestResult {
        qtyVariancePct      : Decimal(5,2);
        priceVariancePct    : Decimal(5,2);
        qtyWithinTolerance  : Boolean;
        priceWithinTolerance : Boolean;
        overallWithinTolerance : Boolean;
        wouldBlock          : Boolean;
        wouldRequireDualApproval : Boolean;
    };

    type DashboardKPIs {
        totalInvoices       : Integer;
        pendingVerification : Integer;
        pendingApproval     : Integer;
        exceptionsCount     : Integer;
        postedThisPeriod    : Integer;
        totalAmountPending  : Decimal(18,2);
        totalAmountPosted   : Decimal(18,2);
        currency            : String(3);
        avgProcessingDays   : Decimal(5,2);
        matchRate           : Decimal(5,2);
        // Extended KPIs for dashboard/cockpit TSX views
        receivedToday       : Integer;          // Invoices received today
        receivedTrend       : Decimal(5,2);     // % change from prior period
        autoMatchedCount    : Integer;          // Auto-matched invoices count
        autoMatchedRate     : Decimal(5,2);     // Auto-match success rate %
        postedRate          : Decimal(5,2);     // Posting success rate %
        exceptionRate       : Decimal(5,2);     // Exception rate %
        processingTrend     : Decimal(5,2);     // Processing time trend %
        financialHealthScore : Decimal(5,2);    // Overall financial health score (0-100)
        totalAmountReceived : Decimal(18,2);    // Total amount received this period
        totalAmountApproved : Decimal(18,2);    // Total amount approved this period
        rejectedCount       : Integer;          // Rejected invoices count
    };

    type ExceptionQueueItem {
        invoiceId           : UUID;
        invoiceNumber       : String(20);
        supplierName        : String(100);
        invoiceDate         : Date;
        grossAmount         : Decimal(15,2);
        currency            : String(3);
        exceptionType       : String(50);
        varianceAmount      : Decimal(15,2);
        variancePct         : Decimal(5,2);
        daysOpen            : Integer;
        priority            : String(10);
        // Extended fields for InvoiceExceptionManagement TSX
        exceptionId         : String(25);       // IEXC-{YYYY}-{SEQ}
        category            : String(30);       // Pricing, Quantity, Documentation, Tax, Contract, Supplier, Data Quality
        severity            : String(10);       // HIGH, MEDIUM, LOW
        description         : String(500);      // Exception description
        financialImpact     : Decimal(15,2);    // Financial impact amount
        status              : String(20);       // open, in_progress, resolved, escalated
        assignedTo          : String(255);      // Assigned resolver
        detectedAt          : DateTime;         // When exception was detected
    };

    type ApprovalQueueItem {
        invoiceId           : UUID;
        invoiceNumber       : String(20);
        supplierName        : String(100);
        invoiceDate         : Date;
        grossAmount         : Decimal(15,2);
        currency            : String(3);
        matchStatus         : String(20);
        requiresDualApproval : Boolean;
        firstApprover       : String(255);
        submittedDate       : DateTime;
        withinMyLimit       : Boolean;
        // Extended fields for InvoiceApprovalWorkflow TSX
        approvalLevel       : Integer;          // 1, 2, 3
        approverRole        : String(50);       // AP Manager, Finance Manager, CFO
        approverName        : String(255);      // Approver display name
        approvalLimit       : Decimal(15,2);    // Approver's value limit
        status              : String(20);       // pending, approved, rejected, escalated
        slaHours            : Integer;          // SLA target in hours
        hoursRemaining      : Integer;          // Computed hours until SLA breach
        priority            : String(10);       // high, normal, low
        matchScore          : Decimal(5,2);     // Match confidence score %
    };

    type OpenGRIRItem {
        deliveryId          : UUID;
        deliveryNumber      : String(25);
        orderNumber         : String(25);
        supplierName        : String(100);
        deliveryDate        : Date;
        grAmount            : Decimal(15,2);
        irAmount            : Decimal(15,2);
        openAmount          : Decimal(15,2);
        currency            : String(3);
        daysOpen            : Integer;
    };

    type InvoiceSearchResult {
        invoiceId           : UUID;
        invoiceNumber       : String(20);
        internalNumber      : String(25);
        supplierCode        : String(20);
        supplierName        : String(100);
        invoiceDate         : Date;
        grossAmount         : Decimal(15,2);
        currency            : String(3);
        status              : String(20);
        matchStatus         : String(20);
        approvalStatus      : String(20);
    };

    type VarianceCalculation {
        qtyVariance         : Decimal(12,3);
        qtyVariancePct      : Decimal(5,2);
        priceVariance       : Decimal(15,4);
        priceVariancePct    : Decimal(5,2);
        amountVariance      : Decimal(15,2);
    };

    type BatchMatchResult {
        success             : Boolean;
        totalProcessed      : Integer;
        successCount        : Integer;
        failureCount        : Integer;
        results             : array of ThreeWayMatchResult;
        message             : String(500);
    };

    type BatchPostResult {
        success             : Boolean;
        totalProcessed      : Integer;
        successCount        : Integer;
        failureCount        : Integer;
        results             : array of FIPostingResult;
        message             : String(500);
    };

    type GRIRClearingRunResult {
        success             : Boolean;
        companyCode         : String(4);
        clearingDate        : Date;
        itemsProcessed      : Integer;
        itemsCleared        : Integer;
        itemsFailed         : Integer;
        totalClearedAmount  : Decimal(18,2);
        currency            : String(3);
        message             : String(500);
    };

    // ========================================================================
    // DASHBOARD CHART/PANEL TYPES (for TSX dashboard views)
    // ========================================================================

    /**
     * Processing Funnel - tracks invoice flow through stages
     * Used by: InvoiceVerificationDashboard processing funnel chart
     */
    type ProcessingFunnelItem {
        stage               : String(30);       // Received, Validated, Matched, Approved, Posted
        count               : Integer;
        percentage          : Decimal(5,2);
    };

    /**
     * Variance Distribution - donut/pie chart data
     * Used by: InvoiceVerificationDashboard variance chart
     */
    type VarianceDistributionItem {
        category            : String(30);       // Within Tolerance, Price Variance, Qty Variance, Multiple
        count               : Integer;
        percentage          : Decimal(5,2);
        amount              : Decimal(18,2);
        currency            : String(3);
    };

    /**
     * Processing Time Trend - line chart data over time
     * Used by: InvoiceVerificationDashboard processing time trend
     */
    type ProcessingTimeTrendItem {
        date                : Date;
        avgDays             : Decimal(5,2);     // Average processing days
        volume              : Integer;          // Invoice count for the period
    };

    /**
     * Critical Alert - dashboard alert panel items
     * Used by: InvoiceVerificationDashboard critical alerts
     */
    type CriticalAlertItem {
        alertId             : String(50);
        severity            : String(20);       // critical, warning, info
        title               : String(200);
        description         : String(500);
        timestamp           : DateTime;
        invoiceId           : UUID;
        invoiceNumber       : String(20);
        actionRequired      : Boolean;
    };

    /**
     * Financial Summary - summary cards
     * Used by: InvoiceVerificationDashboard financial summary
     */
    type FinancialSummaryItem {
        category            : String(30);       // received, approved, posted, pending
        amount              : Decimal(18,2);
        currency            : String(3);
        count               : Integer;
        trend               : Decimal(5,2);     // % change from prior period
    };

    /**
     * Top Supplier Exception Rate - bar chart data
     * Used by: InvoiceVerificationDashboard top suppliers chart
     */
    type TopSupplierExceptionItem {
        supplierCode        : String(20);
        supplierName        : String(100);
        totalInvoices       : Integer;
        exceptionCount      : Integer;
        exceptionRate       : Decimal(5,2);
        totalVarianceAmount : Decimal(18,2);
        currency            : String(3);
    };

    /**
     * Activity Timeline - recent activity feed
     * Used by: InvoiceVerificationDashboard activity timeline
     */
    type ActivityTimelineItem {
        activityId          : String(50);
        activityType        : String(30);       // received, matched, approved, posted, exception, rejected
        title               : String(200);
        description         : String(500);
        timestamp           : DateTime;
        user                : String(255);
        invoiceId           : UUID;
        invoiceNumber       : String(20);
        amount              : Decimal(15,2);
        currency            : String(3);
    };

    /**
     * Daily Processing Volume - bar chart data
     * Used by: InvoiceVerificationCockpit daily volume chart
     */
    type DailyVolumeItem {
        date                : Date;
        received            : Integer;
        processed           : Integer;
        posted              : Integer;
    };

    /**
     * Invoice Status Distribution - donut chart data
     * Used by: InvoiceVerificationCockpit status distribution chart
     */
    type StatusDistributionItem {
        status              : String(20);
        count               : Integer;
        percentage          : Decimal(5,2);
    };

    // ========================================================================
    // DASHBOARD FUNCTIONS
    // ========================================================================

    /**
     * Get processing funnel data for dashboard
     */
    function getProcessingFunnel(companyCode: String, fromDate: Date, toDate: Date) returns array of ProcessingFunnelItem;

    /**
     * Get variance distribution for dashboard chart
     */
    function getVarianceDistribution(companyCode: String, fromDate: Date, toDate: Date) returns array of VarianceDistributionItem;

    /**
     * Get processing time trend for dashboard line chart
     */
    function getProcessingTimeTrend(companyCode: String, days: Integer) returns array of ProcessingTimeTrendItem;

    /**
     * Get critical alerts for dashboard panel
     */
    function getCriticalAlerts(companyCode: String) returns array of CriticalAlertItem;

    /**
     * Get financial summary for dashboard cards
     */
    function getFinancialSummary(companyCode: String, fromDate: Date, toDate: Date) returns array of FinancialSummaryItem;

    /**
     * Get top suppliers by exception rate for dashboard chart
     */
    function getTopSupplierExceptions(companyCode: String, limit: Integer) returns array of TopSupplierExceptionItem;

    /**
     * Get recent activity timeline for dashboard
     */
    function getActivityTimeline(companyCode: String, limit: Integer) returns array of ActivityTimelineItem;

    /**
     * Get daily processing volume for cockpit bar chart
     */
    function getDailyVolume(companyCode: String, days: Integer) returns array of DailyVolumeItem;

    /**
     * Get invoice status distribution for cockpit donut chart
     */
    function getStatusDistribution(companyCode: String) returns array of StatusDistributionItem;

    // ========================================================================
    // APPROVAL WORKFLOW TYPES (for InvoiceApprovalWorkflow TSX)
    // ========================================================================

    /**
     * Approval Workflow KPIs
     * Used by: InvoiceApprovalWorkflow KPI tiles
     */
    type ApprovalWorkflowKPIs {
        pendingCount        : Integer;          // Pending approval count
        criticalSLACount    : Integer;          // Approvals with SLA < 6 hours
        approvedToday       : Integer;          // Approved today count
        avgApprovalHours    : Decimal(5,2);     // Average approval time in hours
    };

    /**
     * Current approver's info and limits
     * Used by: InvoiceApprovalWorkflow "My Approval Limits" card
     */
    type ApproverInfo {
        userId              : String(255);
        displayName         : String(255);
        role                : String(50);       // AP Manager, Finance Manager, CFO
        level               : Integer;          // 1, 2, 3
        singleApprovalLimit : Decimal(15,2);    // Max single invoice limit
        monthlyLimit        : Decimal(18,2);    // Monthly cumulative limit
        monthlyUsed         : Decimal(18,2);    // Amount used this month
    };

    /**
     * Approval Matrix entry
     * Used by: InvoiceApprovalWorkflow "Approval Matrix" card
     */
    type ApprovalMatrixItem {
        level               : Integer;
        roleName            : String(50);
        lowerLimit          : Decimal(15,2);
        upperLimit          : Decimal(15,2);
        currency            : String(3);
    };

    // ========================================================================
    // EXCEPTION MANAGEMENT TYPES (for InvoiceExceptionManagement TSX)
    // ========================================================================

    /**
     * Exception Management KPIs
     * Used by: InvoiceExceptionManagement KPI tiles
     */
    type ExceptionManagementKPIs {
        openCount           : Integer;          // Open exceptions
        inProgressCount     : Integer;          // In-progress exceptions
        resolvedToday       : Integer;          // Resolved today
        totalFinancialImpact : Decimal(18,2);   // Total financial impact
        currency            : String(3);
        avgResolutionHours  : Decimal(5,2);     // Average resolution time
        resolutionRate      : Decimal(5,2);     // Resolution rate %
    };

    /**
     * Exception type distribution for pie chart
     * Used by: InvoiceExceptionManagement distribution chart
     */
    type ExceptionTypeDistributionItem {
        exceptionType       : String(50);       // Price Variance, Quantity Variance, Missing ePOD, etc.
        count               : Integer;
        percentage          : Decimal(5,2);
    };

    // ========================================================================
    // SMART QUEUE TYPES (for SmartInvoiceQueue TSX)
    // ========================================================================

    /**
     * Smart Queue KPIs
     * Used by: SmartInvoiceQueue dashboard cards
     */
    type SmartQueueKPIs {
        totalQueue          : Integer;          // Total invoices in queue
        totalValue          : Decimal(18,2);    // Total value in queue
        currency            : String(3);
        readyCount          : Integer;          // Ready to process
        waitingCount        : Integer;          // Waiting for data
        blockedCount        : Integer;          // Blocked/stuck
        autoMatchReady      : Integer;          // Auto-match ready count
        avgConfidence       : Decimal(5,2);     // Average match confidence %
        processingGoal      : Integer;          // Daily processing target
        processedToday      : Integer;          // Processed today
        remaining           : Integer;          // Remaining to process
        progressPercent     : Decimal(5,2);     // Progress toward goal %
    };

    /**
     * Queue invoice item with AI scoring
     * Used by: SmartInvoiceQueue table
     */
    type QueueInvoiceItem {
        invoiceId           : UUID;
        invoiceNumber       : String(20);
        supplierName        : String(100);
        grossAmount         : Decimal(15,2);
        currency            : String(3);
        dueDate             : Date;
        age                 : Integer;          // Days since received
        aiScore             : Integer;          // AI priority score (0-100)
        matchConfidence     : Decimal(5,2);     // Match confidence %
        queueStatus         : String(20);       // ready, auto_match, manual_review, blocked, approved
        exceptionCount      : Integer;          // Number of exceptions
        isAutoMatch         : Boolean;          // Eligible for auto-matching
    };

    /**
     * Processing velocity data for line chart
     * Used by: SmartInvoiceQueue velocity chart
     */
    type ProcessingVelocityItem {
        timeSlot            : String(10);       // e.g. "8 AM", "9 AM"
        actual              : Integer;          // Actual processed count
        target              : Integer;          // Target count
    };

    /**
     * Queue composition for pie chart
     * Used by: SmartInvoiceQueue composition chart
     */
    type QueueCompositionItem {
        category            : String(30);       // Auto-Match Ready, Manual Review, Exception Queue, Blocked
        count               : Integer;
        percentage          : Decimal(5,2);
    };

    /**
     * Queue health summary
     * Used by: SmartInvoiceQueue health indicator
     */
    type QueueHealthInfo {
        healthStatus        : String(20);       // Good, Warning, Critical
        overdueCount        : Integer;
        overduePercent      : Decimal(5,2);
        withinSLACount      : Integer;
        withinSLAPercent    : Decimal(5,2);
        avgAgeDays          : Decimal(5,2);
        backlogTrend        : String(20);       // Increasing, Decreasing, Stable
    };

    // ========================================================================
    // VALIDATION WIZARD TYPES (for InvoiceValidationWizard TSX)
    // ========================================================================

    /**
     * Validation wizard context/summary
     * Used by: InvoiceValidationWizard variance summary card
     */
    type ValidationWizardContext {
        invoiceId           : UUID;
        invoiceNumber       : String(20);
        supplierName        : String(100);
        grossAmount         : Decimal(15,2);
        currency            : String(3);
        totalLineItems      : Integer;
        matchedPerfectly    : Integer;
        withVariances       : Integer;
        blocked             : Integer;
        totalVariance       : Decimal(15,2);
        toleranceLevel      : Decimal(5,2);     // % tolerance threshold
        actualVariancePct   : Decimal(5,2);     // Actual variance %
        withinTolerance     : Boolean;
        requiresApproval    : Boolean;
        currentStep         : Integer;          // 1-5 wizard step
        stepTitle           : String(50);
    };

    /**
     * Wizard variance line item with three-way comparison
     * Used by: InvoiceValidationWizard variance detail cards
     */
    type WizardVarianceItem {
        lineItemNumber      : Integer;
        lineItemLabel       : String(20);       // e.g. "Item 2"
        flight              : String(50);       // e.g. "SQ001 | SIN → JFK"
        ticketNumber        : String(30);
        varianceType        : String(10);       // PRICE, QUANTITY
        severity            : String(10);       // HIGH, MEDIUM, LOW
        // Fuel Request (PO) data
        frId                : String(30);
        frQuantity          : Decimal(12,3);
        frUnitPrice         : Decimal(15,4);
        frAmount            : Decimal(15,2);
        // ePOD data
        epodId              : String(30);
        epodQuantity        : Decimal(12,3);
        epodDensity         : Decimal(8,4);
        epodStatus          : String(20);
        // Invoice data
        invQuantity         : Decimal(12,3);
        invUnitPrice        : Decimal(15,4);
        invAmount           : Decimal(15,2);
        // Computed variances
        qtyVariance         : Decimal(12,3);
        qtyVariancePct      : Decimal(5,2);
        priceVariance       : Decimal(15,4);
        priceVariancePct    : Decimal(5,2);
        amountVariance      : Decimal(15,2);
        amountVariancePct   : Decimal(5,2);
    };

    /**
     * AI root cause analysis for variance
     * Used by: InvoiceValidationWizard AI analysis panel (SAP Joule)
     */
    type AIRootCauseAnalysis {
        lineItemNumber      : Integer;
        possibleReasons     : array of AIReasonItem;
        historicalContext    : String(1000);
    };

    type AIReasonItem {
        reason              : String(500);
        confidence          : Decimal(5,2);     // 0-100%
    };

    /**
     * Variance resolution action
     * Used by: InvoiceValidationWizard resolution actions
     */
    type VarianceResolutionResult {
        success             : Boolean;
        lineItemNumber      : Integer;
        resolution          : String(30);       // accept, request-correction, escalate, reject
        requiresApproval    : Boolean;
        nextStep            : String(50);
        message             : String(500);
    };

    // ========================================================================
    // APPROVAL WORKFLOW FUNCTIONS
    // ========================================================================

    /**
     * Get approval workflow KPIs
     */
    function getApprovalWorkflowKPIs() returns ApprovalWorkflowKPIs;

    /**
     * Get current user's approver info and limits
     */
    function getApproverInfo() returns ApproverInfo;

    /**
     * Get approval matrix configuration
     */
    function getApprovalMatrix() returns array of ApprovalMatrixItem;

    // ========================================================================
    // EXCEPTION MANAGEMENT FUNCTIONS
    // ========================================================================

    /**
     * Get exception management KPIs
     */
    function getExceptionKPIs(companyCode: String) returns ExceptionManagementKPIs;

    /**
     * Get exception type distribution for chart
     */
    function getExceptionTypeDistribution(companyCode: String) returns array of ExceptionTypeDistributionItem;

    // ========================================================================
    // SMART QUEUE FUNCTIONS
    // ========================================================================

    /**
     * Get smart queue KPIs
     */
    function getSmartQueueKPIs(companyCode: String) returns SmartQueueKPIs;

    /**
     * Get AI-prioritized invoice queue
     */
    function getSmartQueue(companyCode: String, limit: Integer) returns array of QueueInvoiceItem;

    /**
     * Get today's processing velocity for chart
     */
    function getProcessingVelocity(companyCode: String) returns array of ProcessingVelocityItem;

    /**
     * Get queue composition for pie chart
     */
    function getQueueComposition(companyCode: String) returns array of QueueCompositionItem;

    /**
     * Get queue health summary
     */
    function getQueueHealth(companyCode: String) returns QueueHealthInfo;

    // ========================================================================
    // VALIDATION WIZARD FUNCTIONS
    // ========================================================================

    /**
     * Get validation wizard context for an invoice
     */
    function getValidationWizardContext(invoiceId: UUID) returns ValidationWizardContext;

    /**
     * Get variance items for wizard review step
     */
    function getWizardVarianceItems(invoiceId: UUID) returns array of WizardVarianceItem;

    /**
     * Get AI root cause analysis for a variance item
     */
    function getAIRootCauseAnalysis(invoiceId: UUID, lineItemNumber: Integer) returns AIRootCauseAnalysis;

    // ========================================================================
    // BATCH ACTIONS (Approval & Exception Workflows)
    // ========================================================================

    /**
     * Batch approve selected invoices
     * SOX Control INV-001: Creator cannot approve same invoice
     */
    action batchApprove(invoiceIds: array of UUID, comments: String) returns BatchActionResult;

    /**
     * Batch reject selected invoices
     */
    action batchReject(invoiceIds: array of UUID, reason: String) returns BatchActionResult;

    /**
     * Batch escalate selected invoices
     */
    action batchEscalate(invoiceIds: array of UUID, reason: String) returns BatchActionResult;

    /**
     * Batch resolve invoice exceptions
     */
    action batchResolveExceptions(exceptionIds: array of String, resolution: String) returns BatchActionResult;

    /**
     * Batch escalate invoice exceptions
     */
    action batchEscalateExceptions(exceptionIds: array of String, reason: String) returns BatchActionResult;

    /**
     * Assign exception to user
     */
    action assignException(exceptionId: String, userId: String) returns ExceptionQueueItem;

    /**
     * Resolve variance in validation wizard
     */
    action resolveVariance(invoiceId: UUID, lineItemNumber: Integer, resolution: String, justification: String) returns VarianceResolutionResult;

    type BatchActionResult {
        success             : Boolean;
        totalProcessed      : Integer;
        successCount        : Integer;
        failureCount        : Integer;
        message             : String(500);
    };

    // ========================================================================
    // AP ANALYTICS & PERFORMANCE TYPES (for APAnalyticsDashboard TSX)
    // ========================================================================

    /**
     * Overall AP performance score with breakdown
     * Used by: APAnalyticsDashboard hero section
     */
    type APPerformanceScore {
        overallScore        : Decimal(5,2);     // 0-100
        speedScore          : Decimal(5,2);
        accuracyScore       : Decimal(5,2);
        qualityScore        : Decimal(5,2);
        volumeScore         : Decimal(5,2);
        scoreTrend          : Decimal(5,2);     // +/- vs last period
        teamRank            : Integer;
        teamSize            : Integer;
        totalPoints         : Integer;
        processingPoints    : Integer;
        accuracyPoints      : Integer;
        qualityPoints       : Integer;
    };

    /**
     * Core AP performance KPIs
     * Used by: APAnalyticsDashboard metrics cards
     */
    type APPerformanceKPIs {
        invoicesProcessed   : Integer;
        processingTarget    : Integer;
        progressPercent     : Decimal(5,2);
        daysRemaining       : Integer;
        projectedTotal      : Integer;
        avgProcessingMinutes : Decimal(8,2);
        processingTarget_min : Decimal(8,2);
        personalBestMinutes : Decimal(8,2);
        teamAvgMinutes      : Decimal(8,2);
        speedVsTeamPct      : Decimal(5,2);     // % faster/slower than team
        accuracyRate        : Decimal(5,2);
        errorsThisMonth     : Integer;
        teamAvgAccuracy     : Decimal(5,2);
        errorFreeDays       : Integer;
        autoMatchRate       : Decimal(5,2);
        autoMatchCount      : Integer;
        timeSavedHours      : Decimal(8,2);
        teamAutoMatchRate   : Decimal(5,2);
        exceptionsHandled   : Integer;
        exceptionsResolved  : Integer;
        avgResolutionHours  : Decimal(5,2);
        resolutionTarget    : Decimal(5,2);
        totalValueProcessed : Decimal(18,2);
        currency            : String(3);
        avgValuePerInvoice  : Decimal(15,2);
        largestInvoice      : Decimal(15,2);
        teamTotalValue      : Decimal(18,2);
        valueSharePct       : Decimal(5,2);
    };

    /**
     * Team comparison row
     * Used by: APAnalyticsDashboard comparison table
     */
    type TeamComparisonItem {
        metric              : String(50);
        yourValue           : String(30);
        teamAvg             : String(30);
        teamLeader          : String(50);       // "value (name)"
        yourRank            : String(20);       // "#2 of 12"
    };

    /**
     * Leaderboard entry
     * Used by: APAnalyticsDashboard team leaderboard
     */
    type LeaderboardEntry {
        rank                : Integer;
        displayName         : String(100);
        totalPoints         : Integer;
        invoicesProcessed   : Integer;
        accuracyRate        : Decimal(5,2);
        isCurrentUser       : Boolean;
    };

    /**
     * Achievement/badge item
     * Used by: APAnalyticsDashboard achievements grid
     */
    type AchievementItem {
        achievementId       : String(20);
        title               : String(100);
        description         : String(200);
        status              : String(20);       // unlocked, in-progress, locked
        icon                : String(10);       // Emoji icon
        earnedDate          : String(30);       // Display date string
        rarity              : String(50);       // e.g., "Rare (5% have this)"
        progress            : Integer;          // 0-100 percentage
        total               : Integer;          // Target number
        current             : String(30);       // Display current progress
        gap                 : String(50);       // e.g., "3.5 min away"
        tip                 : String(200);      // Unlock tip
        eta                 : String(30);       // e.g., "2 weeks"
    };

    /**
     * AI-powered insight for AP clerk
     * Used by: APAnalyticsDashboard AI insights panel
     */
    type APInsightItem {
        icon                : String(10);       // Emoji
        title               : String(100);
        description         : String(500);
    };

    /**
     * Personal goal tracking
     * Used by: APAnalyticsDashboard goals section
     */
    type APGoalItem {
        goalId              : String(20);
        title               : String(100);
        status              : String(20);       // on_track, exceeding, at_risk, behind
        currentValue        : Decimal(15,2);
        targetValue         : Decimal(15,2);
        progressPercent     : Decimal(5,2);
        remaining           : String(50);       // "13" or "0.8%"
        daysLeft            : Integer;
        dailyNeeded         : String(50);       // e.g., "0.9 invoices/day"
    };

    /**
     * Performance trend data point
     * Used by: APAnalyticsDashboard charts (volume, accuracy, processing time)
     */
    type PerformanceTrendDataPoint {
        date                : Date;
        value               : Decimal(15,2);
        target              : Decimal(15,2);
    };

    // ========================================================================
    // AP ANALYTICS FUNCTIONS
    // ========================================================================

    /**
     * Get current user's overall performance score
     */
    function getAPPerformanceScore(period: String) returns APPerformanceScore;

    /**
     * Get current user's detailed performance KPIs
     */
    function getAPPerformanceKPIs(period: String) returns APPerformanceKPIs;

    /**
     * Get team comparison data
     */
    function getTeamComparison(period: String) returns array of TeamComparisonItem;

    /**
     * Get team leaderboard
     */
    function getLeaderboard(period: String, limit: Integer) returns array of LeaderboardEntry;

    /**
     * Get current user's achievements
     */
    function getAchievements() returns array of AchievementItem;

    /**
     * Get AI-powered performance insights
     */
    function getAPInsights() returns array of APInsightItem;

    /**
     * Get current user's goals
     */
    function getAPGoals(period: String) returns array of APGoalItem;

    /**
     * Get performance trend data for a metric
     */
    function getPerformanceTrend(metric: String, days: Integer) returns array of PerformanceTrendDataPoint;

    // ========================================================================
    // ERROR CODES (FDD-06)
    // ========================================================================
    // INV401 - PO not found for matching
    // INV402 - GR not found for matching
    // INV403 - Price variance exceeds tolerance
    // INV404 - Quantity variance exceeds tolerance
    // INV405 - Duplicate invoice detected
    // INV406 - S/4HANA FI posting failed
    // INV407 - Invalid tax code for jurisdiction
    // INV408 - Posting period closed
    // INV409 - Approval limit exceeded
    // INV410 - Currency conversion error
}

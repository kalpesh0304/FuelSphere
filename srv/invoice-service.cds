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
        approvals       : redirected to InvoiceApprovals
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

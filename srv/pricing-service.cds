/**
 * FuelSphere - Native Pricing Engine Service (FDD-10)
 *
 * Built-in fuel price calculation capabilities independent of SAP CPE:
 * - Flexible formula-based pricing architecture
 * - Multiple pricing strategies (INDEX_LINKED, FIXED, FLOATING, TIERED)
 * - Market index management (Platts MOPS, Argus FOB, Reuters)
 * - Hybrid mode for CPE validation and gradual migration
 * - Complete audit trail for SOX compliance
 *
 * Core Price Formula:
 * Final Price = Base Index + Premium + Into-Plane Fee + Transport + Handling + Taxes
 *
 * SOX Controls:
 * - FPE-001: Formula creator cannot approve own formula
 * - FPE-002: Index importer cannot execute price derivation
 * - FPE-003: Formula version audit trail
 * - FPE-004: Index value verification required
 * - FPE-005: Price derivation log - complete calculation audit
 * - FPE-006: Dual approval for high-value formulas
 * - FPE-007: Hybrid variance threshold alerts
 *
 * Service Path: /odata/v4/pricing
 */

using { fuelsphere as db } from '../db/schema';

@path: '/odata/v4/pricing'
service PricingService {

    // ========================================================================
    // PRICING CONFIGURATION
    // ========================================================================

    /**
     * PricingConfigurations - Engine Selection per Company
     * Configures which pricing engine to use (Native, SAP CPE, or Hybrid)
     *
     * Access:
     * - Pricing Administrator: Full access (PricingConfigManage)
     * - System Administrator: Full access (AdminAccess)
     */
    @odata.draft.enabled
    entity PricingConfigurations as projection on db.PRICING_CONFIGURATIONS {
        *,
        default_currency : redirected to Currencies,
        default_uom : redirected to UnitsOfMeasure
    } actions {
        /**
         * Test CPE connectivity
         */
        action testCPEConnection() returns ConnectionTestResult;

        /**
         * Switch to Native engine
         */
        action switchToNative() returns PricingConfigurations;

        /**
         * Switch to Hybrid mode
         */
        action enableHybridMode(varianceThreshold: Decimal) returns PricingConfigurations;

        /**
         * Trigger manual price derivation for all contracts
         */
        action triggerDerivation() returns DerivationTriggerResult;
    };

    // ========================================================================
    // PRICING FORMULAS
    // ========================================================================

    /**
     * PricingFormulas - Native Formula Definitions
     * Formula builder with multi-component support
     *
     * Access:
     * - Pricing Analyst: Create, Edit (FormulaRead, FormulaEdit)
     * - Pricing Administrator: Approve (FormulaApprove)
     */
    @odata.draft.enabled
    entity PricingFormulas as projection on db.PRICING_FORMULAS {
        *,
        currency : redirected to Currencies,
        uom : redirected to UnitsOfMeasure,
        components : redirected to FormulaComponents
    } actions {
        /**
         * Submit formula for approval
         */
        action submit() returns PricingFormulas;

        /**
         * Approve formula (FPE-001: Must be different user than creator)
         */
        action approve(approvalNotes: String) returns PricingFormulas;

        /**
         * Second approval for high-value formulas (FPE-006)
         */
        action approveSecond(approvalNotes: String) returns PricingFormulas;

        /**
         * Reject formula
         */
        action reject(rejectionReason: String) returns PricingFormulas;

        /**
         * Create new version of formula
         */
        action createVersion() returns PricingFormulas;

        /**
         * Clone formula
         */
        action clone(newFormulaId: String) returns PricingFormulas;

        /**
         * Validate formula components
         */
        action validate() returns FormulaValidationResult;

        /**
         * Test calculate price with formula
         */
        action testCalculate(
            effectiveDate: Date,
            indexOverrides: LargeString
        ) returns TestCalculationResult;

        /**
         * Archive formula
         */
        action archive() returns PricingFormulas;
    };

    /**
     * FormulaComponents - Formula Building Blocks
     */
    entity FormulaComponents as projection on db.FORMULA_COMPONENTS {
        *,
        formula : redirected to PricingFormulas,
        lookup_index : redirected to MarketIndices,
        component_currency : redirected to Currencies
    };

    // ========================================================================
    // MARKET INDICES
    // ========================================================================

    /**
     * MarketIndices - Index Definitions
     * Platts MOPS, Argus FOB, Reuters, Custom indices
     *
     * Access:
     * - Pricing Analyst: Manage indices (IndexManage)
     */
    @odata.draft.enabled
    entity MarketIndices as projection on db.MARKET_INDICES {
        *,
        currency : redirected to Currencies,
        uom : redirected to UnitsOfMeasure
    } actions {
        /**
         * Import index values from file
         */
        action importValues(
            sourceType: String,
            dateFrom: Date,
            dateTo: Date
        ) returns IndexImportResult;

        /**
         * Get latest value
         */
        action getLatestValue() returns IndexValueResult;

        /**
         * Get value for specific date
         */
        action getValueForDate(effectiveDate: Date) returns IndexValueResult;
    };

    /**
     * MarketIndexValues - Daily Index Values
     */
    entity MarketIndexValues as projection on db.MARKET_INDEX_VALUES {
        *,
        market_index : redirected to MarketIndices
    } actions {
        /**
         * Verify index value (FPE-004)
         */
        action verify(verificationNotes: String) returns MarketIndexValues;

        /**
         * Reject index value
         */
        action reject(rejectionReason: String) returns MarketIndexValues;

        /**
         * Correct index value
         */
        action correct(
            newValue: Decimal,
            correctionReason: String
        ) returns MarketIndexValues;
    };

    /**
     * IndexImportBatches - Import Tracking
     */
    entity IndexImportBatches as projection on db.INDEX_IMPORT_BATCHES {
        *,
        market_index : redirected to MarketIndices
    } actions {
        /**
         * Verify all values in batch
         */
        action verifyBatch() returns IndexImportBatches;

        /**
         * Reprocess failed records
         */
        action reprocessFailed() returns IndexImportBatches;
    };

    // ========================================================================
    // DERIVED PRICES
    // ========================================================================

    /**
     * DerivedPrices - Calculated Daily Prices
     */
    @readonly
    entity DerivedPrices as projection on db.DERIVED_PRICES {
        *,
        contract : redirected to Contracts,
        formula : redirected to PricingFormulas,
        currency : redirected to Currencies,
        uom : redirected to UnitsOfMeasure,
        base_index : redirected to MarketIndices
    };

    /**
     * PriceDerivationLogs - Calculation Audit Trail (FPE-005)
     */
    @readonly
    entity PriceDerivationLogs as projection on db.PRICE_DERIVATION_LOGS {
        *,
        derived_price : redirected to DerivedPrices
    };

    // ========================================================================
    // PRICE SIMULATIONS
    // ========================================================================

    /**
     * PriceSimulations - What-If Analysis
     */
    @odata.draft.enabled
    entity PriceSimulations as projection on db.PRICE_SIMULATIONS {
        *,
        contract : redirected to Contracts,
        formula : redirected to PricingFormulas
    } actions {
        /**
         * Execute simulation
         */
        action execute() returns SimulationResult;

        /**
         * Compare with current price
         */
        action compare() returns PriceComparisonResult;
    };

    // ========================================================================
    // REFERENCE DATA (Read-only)
    // ========================================================================

    @readonly entity Currencies as projection on db.CURRENCY_MASTER;
    @readonly entity UnitsOfMeasure as projection on db.UNIT_OF_MEASURE;
    @readonly entity Contracts as projection on db.MASTER_CONTRACTS;
    @readonly entity Suppliers as projection on db.MASTER_SUPPLIERS;

    // ========================================================================
    // SERVICE-LEVEL ACTIONS
    // ========================================================================

    /**
     * Derive price for a specific contract and date
     */
    action derivePrice(
        contractId: UUID,
        effectiveDate: Date,
        forceEngine: String
    ) returns PriceDerivationResult;

    /**
     * Derive prices for all active contracts
     */
    action deriveAllPrices(
        effectiveDate: Date,
        companyCode: String
    ) returns BatchDerivationResult;

    /**
     * Run price derivation batch job
     */
    action runDerivationBatch(
        companyCode: String,
        dateFrom: Date,
        dateTo: Date
    ) returns BatchDerivationResult;

    /**
     * Import market index values from file
     */
    action importIndexValues(
        indexCode: String,
        sourceType: String,
        fileContent: LargeString,
        dateFrom: Date,
        dateTo: Date
    ) returns IndexImportResult;

    /**
     * Verify pending index values
     */
    action verifyIndexValues(
        indexCode: String,
        dateFrom: Date,
        dateTo: Date
    ) returns VerificationResult;

    /**
     * Compare Native vs CPE prices
     */
    action comparePricingEngines(
        contractId: UUID,
        effectiveDate: Date
    ) returns EngineComparisonResult;

    /**
     * Run price simulation
     */
    action runSimulation(
        contractId: UUID,
        formulaId: UUID,
        effectiveDate: Date,
        indexOverrides: LargeString,
        componentOverrides: LargeString
    ) returns SimulationResult;

    /**
     * Get price history for contract
     */
    action getPriceHistory(
        contractId: UUID,
        dateFrom: Date,
        dateTo: Date
    ) returns array of PriceHistoryItem;

    /**
     * Export price derivation audit log
     */
    action exportDerivationLog(
        contractId: UUID,
        dateFrom: Date,
        dateTo: Date,
        format: String
    ) returns ExportResult;

    /**
     * Validate formula before saving
     */
    action validateFormula(
        formulaId: UUID
    ) returns FormulaValidationResult;

    /**
     * Get effective price for order
     */
    action getEffectivePrice(
        contractId: UUID,
        effectiveDate: Date,
        quantity: Decimal,
        uom: String
    ) returns EffectivePriceResult;

    // ========================================================================
    // SERVICE-LEVEL FUNCTIONS
    // ========================================================================

    /**
     * Get pricing dashboard summary
     */
    function getPricingDashboard(companyCode: String) returns PricingDashboard;

    /**
     * Get active formulas for contract
     */
    function getFormulasForContract(contractId: UUID) returns array of FormulaReference;

    /**
     * Get latest index values
     */
    function getLatestIndexValues() returns array of LatestIndexValue;

    /**
     * Get pending verifications
     */
    function getPendingVerifications() returns PendingVerificationsSummary;

    /**
     * Get hybrid variance report
     */
    function getHybridVarianceReport(
        companyCode: String,
        dateFrom: Date,
        dateTo: Date
    ) returns HybridVarianceReport;

    /**
     * Get formula usage statistics
     */
    function getFormulaUsage(formulaId: UUID) returns FormulaUsageStats;

    /**
     * Get index value trend
     */
    function getIndexTrend(
        indexCode: String,
        days: Integer
    ) returns IndexTrendData;

    /**
     * Search derived prices
     */
    function searchDerivedPrices(
        contractId: UUID,
        supplierId: UUID,
        dateFrom: Date,
        dateTo: Date,
        pricingEngine: String
    ) returns array of DerivedPrices;

    /**
     * Get price components breakdown
     */
    function getPriceBreakdown(
        derivedPriceId: UUID
    ) returns PriceBreakdown;

    /**
     * Check formula approval status
     */
    function getApprovalStatus(formulaId: UUID) returns ApprovalStatus;

    // ========================================================================
    // TYPE DEFINITIONS
    // ========================================================================

    type ConnectionTestResult {
        success             : Boolean;
        endpoint            : String(500);
        responseTimeMs      : Integer;
        cpeVersion          : String(50);
        message             : String(500);
    };

    type DerivationTriggerResult {
        success             : Boolean;
        companyCode         : String(4);
        contractsProcessed  : Integer;
        pricesDerived       : Integer;
        errors              : Integer;
        batchId             : String(50);
        message             : String(500);
    };

    type FormulaValidationResult {
        isValid             : Boolean;
        formulaId           : String(20);
        componentCount      : Integer;
        issues              : array of ValidationIssue;
        warnings            : array of ValidationIssue;
    };

    type ValidationIssue {
        componentSequence   : Integer;
        field               : String(50);
        severity            : String(10);
        message             : String(500);
    };

    type TestCalculationResult {
        success             : Boolean;
        formulaId           : String(20);
        effectiveDate       : Date;
        calculatedPrice     : Decimal(15,4);
        currency            : String(3);
        uom                 : String(3);
        breakdown           : LargeString;
        message             : String(500);
    };

    type IndexImportResult {
        success             : Boolean;
        batchId             : String(50);
        indexCode           : String(30);
        recordsTotal        : Integer;
        recordsImported     : Integer;
        recordsUpdated      : Integer;
        recordsSkipped      : Integer;
        recordsFailed       : Integer;
        errors              : array of ImportError;
        message             : String(500);
    };

    type ImportError {
        rowNumber           : Integer;
        effectiveDate       : Date;
        errorCode           : String(20);
        errorMessage        : String(500);
    };

    type IndexValueResult {
        success             : Boolean;
        indexCode           : String(30);
        effectiveDate       : Date;
        indexValue          : Decimal(15,4);
        previousValue       : Decimal(15,4);
        dailyChange         : Decimal(15,4);
        dailyChangePct      : Decimal(8,4);
        verificationStatus  : String(20);
        message             : String(500);
    };

    type VerificationResult {
        success             : Boolean;
        indexCode           : String(30);
        valuesVerified      : Integer;
        valuesRejected      : Integer;
        message             : String(500);
    };

    type PriceDerivationResult {
        success             : Boolean;
        derivedPriceId      : UUID;
        contractId          : UUID;
        effectiveDate       : Date;
        derivedPrice        : Decimal(15,4);
        currency            : String(3);
        uom                 : String(3);
        pricingEngine       : String(20);
        baseIndexValue      : Decimal(15,4);
        componentBreakdown  : LargeString;
        calculationTimeMs   : Integer;
        message             : String(500);
    };

    type BatchDerivationResult {
        success             : Boolean;
        batchId             : String(50);
        companyCode         : String(4);
        dateFrom            : Date;
        dateTo              : Date;
        contractsProcessed  : Integer;
        pricesDerived       : Integer;
        pricesUpdated       : Integer;
        errors              : Integer;
        warnings            : Integer;
        durationSeconds     : Integer;
        message             : String(500);
    };

    type EngineComparisonResult {
        success             : Boolean;
        contractId          : UUID;
        effectiveDate       : Date;
        nativePrice         : Decimal(15,4);
        cpePrice            : Decimal(15,4);
        variance            : Decimal(15,4);
        variancePct         : Decimal(8,4);
        varianceFlag        : String(15);
        nativeBreakdown     : LargeString;
        cpeBreakdown        : LargeString;
        message             : String(500);
    };

    type SimulationResult {
        success             : Boolean;
        simulationId        : String(30);
        contractId          : UUID;
        effectiveDate       : Date;
        simulatedPrice      : Decimal(15,4);
        currentPrice        : Decimal(15,4);
        priceDifference     : Decimal(15,4);
        differencePct       : Decimal(8,4);
        breakdown           : LargeString;
        message             : String(500);
    };

    type PriceComparisonResult {
        success             : Boolean;
        simulatedPrice      : Decimal(15,4);
        currentPrice        : Decimal(15,4);
        difference          : Decimal(15,4);
        differencePct       : Decimal(8,4);
        impactAssessment    : String(500);
    };

    type PriceHistoryItem {
        priceDate           : Date;
        derivedPrice        : Decimal(15,4);
        baseIndexValue      : Decimal(15,4);
        pricingEngine       : String(20);
        varianceFlag        : String(15);
    };

    type ExportResult {
        success             : Boolean;
        filePath            : String(500);
        format              : String(10);
        recordCount         : Integer;
        fileSize            : Integer;
        message             : String(500);
    };

    type EffectivePriceResult {
        success             : Boolean;
        contractId          : UUID;
        effectiveDate       : Date;
        unitPrice           : Decimal(15,4);
        totalPrice          : Decimal(15,4);
        quantity            : Decimal(15,2);
        currency            : String(3);
        uom                 : String(3);
        priceSource         : String(50);
        message             : String(500);
    };

    type PricingDashboard {
        companyCode         : String(4);
        lastUpdated         : DateTime;
        activeFormulas      : Integer;
        pendingApprovals    : Integer;
        activeIndices       : Integer;
        pendingVerifications : Integer;
        todayDerivations    : Integer;
        hybridVariances     : Integer;
        criticalVariances   : Integer;
        avgDerivationTimeMs : Integer;
    };

    type FormulaReference {
        formulaId           : String(20);
        formulaName         : String(100);
        formulaType         : String(20);
        status              : String(20);
        validFrom           : Date;
        validTo             : Date;
        componentCount      : Integer;
    };

    type LatestIndexValue {
        indexCode           : String(30);
        indexName           : String(100);
        provider            : String(20);
        latestDate          : Date;
        latestValue         : Decimal(15,4);
        dailyChangePct      : Decimal(8,4);
        currency            : String(3);
        verificationStatus  : String(20);
    };

    type PendingVerificationsSummary {
        totalPending        : Integer;
        byIndex             : array of IndexPendingCount;
        oldestPendingDate   : Date;
    };

    type IndexPendingCount {
        indexCode           : String(30);
        indexName           : String(100);
        pendingCount        : Integer;
    };

    type HybridVarianceReport {
        companyCode         : String(4);
        dateFrom            : Date;
        dateTo              : Date;
        totalComparisons    : Integer;
        matchCount          : Integer;
        minorVarianceCount  : Integer;
        significantCount    : Integer;
        criticalCount       : Integer;
        avgVariancePct      : Decimal(8,4);
        maxVariancePct      : Decimal(8,4);
        topVariances        : array of VarianceItem;
    };

    type VarianceItem {
        contractId          : UUID;
        contractNumber      : String(35);
        priceDate           : Date;
        nativePrice         : Decimal(15,4);
        cpePrice            : Decimal(15,4);
        variancePct         : Decimal(8,4);
    };

    type FormulaUsageStats {
        formulaId           : String(20);
        formulaName         : String(100);
        contractsUsing      : Integer;
        derivationsLast30d  : Integer;
        avgPriceDerived     : Decimal(15,4);
        lastUsedDate        : Date;
    };

    type IndexTrendData {
        indexCode           : String(30);
        indexName           : String(100);
        dataPoints          : array of IndexDataPoint;
        avgValue            : Decimal(15,4);
        minValue            : Decimal(15,4);
        maxValue            : Decimal(15,4);
        volatilityPct       : Decimal(8,4);
    };

    type IndexDataPoint {
        effectiveDate       : Date;
        indexValue          : Decimal(15,4);
        dailyChangePct      : Decimal(8,4);
    };

    type PriceBreakdown {
        derivedPriceId      : UUID;
        priceDate           : Date;
        finalPrice          : Decimal(15,4);
        baseIndex           : ComponentDetail;
        components          : array of ComponentDetail;
        subtotals           : SubtotalBreakdown;
    };

    type ComponentDetail {
        sequence            : Integer;
        name                : String(50);
        type                : String(30);
        calculationType     : String(20);
        inputValue          : Decimal(15,4);
        outputValue         : Decimal(15,4);
        percentageApplied   : Decimal(8,4);
    };

    type SubtotalBreakdown {
        baseAmount          : Decimal(15,4);
        premiums            : Decimal(15,4);
        fees                : Decimal(15,4);
        taxes               : Decimal(15,4);
        finalAmount         : Decimal(15,4);
    };

    type ApprovalStatus {
        formulaId           : String(20);
        status              : String(20);
        requiresApproval    : Boolean;
        requiresDualApproval : Boolean;
        createdBy           : String(100);
        firstApprover       : String(100);
        firstApprovedAt     : DateTime;
        secondApprover      : String(100);
        secondApprovedAt    : DateTime;
        pendingWith         : String(100);
    };

    // ========================================================================
    // ERROR CODES (FDD-10)
    // ========================================================================
    // FPE501 - Pricing configuration not found
    // FPE502 - Formula not found or not active
    // FPE503 - Index value not found for date
    // FPE504 - Formula validation failed
    // FPE505 - Price derivation failed
    // FPE506 - CPE connection failed (fallback triggered)
    // FPE507 - Approval workflow error (same user as creator)
    // FPE508 - Index verification required
    // FPE509 - Hybrid variance threshold exceeded
    // FPE510 - Simulation calculation failed
    // FPE511 - Index import failed
    // FPE512 - Dual approval required for high-value formula
}

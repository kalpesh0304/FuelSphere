/**
 * FuelSphere - Contracts & Pricing Service (FDD-03 v2.0)
 *
 * Implements the IPricingEngine Interface with dual engine support:
 * - Native Engine: FuelSphere built-in formula builder
 * - CPE Adapter: S/4HANA Commodity Pricing Engine integration
 *
 * Key Features:
 * - Polymorphism: Same interface, different implementations
 * - Runtime Selection: Engine configurable per company/tenant
 * - Fallback Support: Auto-fallback to Native if CPE unavailable
 * - Comparison Mode: Hybrid mode with variance tracking
 *
 * Authorization per PERSONA_AUTHORIZATION_MATRIX
 */

using { fuelsphere as db } from '../db/schema';

@path: '/odata/v4/contracts'
service ContractsService {

    // ========================================================================
    // CONTRACT MANAGEMENT
    // ========================================================================

    /**
     * Contracts - Purchase Contract Master
     * Access: contracts-manager (CRUD), finance-manager (View), fuel-planner (View)
     */
    entity Contracts as projection on db.MASTER_CONTRACTS {
        *,
        supplier : redirected to Suppliers,
        currency : redirected to Currencies,
        locations : redirected to ContractLocations,
        products : redirected to ContractProducts
    };

    /**
     * ContractLocations - Airport/Plant Assignments
     * Access: contracts-manager (CRUD), station-coordinator (View)
     */
    entity ContractLocations as projection on db.CONTRACT_LOCATIONS {
        *,
        contract : redirected to Contracts,
        airport : redirected to Airports
    };

    /**
     * ContractProducts - Product Assignments per Contract
     * Access: contracts-manager (CRUD), fuel-planner (View)
     */
    entity ContractProducts as projection on db.CONTRACT_PRODUCTS {
        *,
        contract : redirected to Contracts,
        product : redirected to Products
    };

    // ========================================================================
    // NATIVE ENGINE COMPONENTS
    // ========================================================================

    /**
     * PricingConfig - Engine Configuration per Company/Tenant
     * Access: integration-admin (CRUD), contracts-manager (View)
     */
    entity PricingConfig as projection on db.PRICING_CONFIG;

    /**
     * PricingFormulas - Native Engine Formula Definitions
     * Access: contracts-manager (CRUD), finance (View)
     */
    entity PricingFormulas as projection on db.PRICING_FORMULA {
        *,
        contract : redirected to Contracts,
        currency : redirected to Currencies,
        uom : redirected to UnitsOfMeasure,
        elements : redirected to FormulaElements
    };

    /**
     * FormulaElements - Formula Component Elements
     * Access: contracts-manager (CRUD), finance (View)
     */
    entity FormulaElements as projection on db.PRICING_FORMULA_ELEMENT {
        *,
        formula : redirected to PricingFormulas,
        market_index : redirected to MarketIndices
    };

    // ========================================================================
    // MARKET INDEX MANAGEMENT
    // ========================================================================

    /**
     * MarketIndices - Market Index Definitions (Platts, Argus, etc.)
     * Access: contracts-manager (CRUD), finance (View)
     */
    entity MarketIndices as projection on db.MARKET_INDEX {
        *,
        currency : redirected to Currencies,
        uom : redirected to UnitsOfMeasure,
        values : redirected to IndexValues
    };

    /**
     * IndexValues - Historical Market Index Values
     * Access: integration-admin (Create), all (View)
     */
    entity IndexValues as projection on db.INDEX_VALUE {
        *,
        marketIndex : redirected to MarketIndices
    };

    // ========================================================================
    // PRICE DERIVATION MONITOR
    // ========================================================================

    /**
     * DerivedPrices - Price Calculation Results (Audit Trail)
     * Access: finance-manager (View), contracts-manager (View)
     */
    @readonly
    entity DerivedPrices as projection on db.DERIVED_PRICE {
        *,
        contract : redirected to Contracts,
        formula : redirected to PricingFormulas,
        airport : redirected to Airports,
        product : redirected to Products
    };

    // ========================================================================
    // REFERENCE ENTITIES (from MasterDataService)
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
    // IPricingEngine INTERFACE - Actions
    // ========================================================================

    /**
     * calculatePrice - Core pricing calculation
     * Implements IPricingEngine.calculatePrice(contract, date): Price
     *
     * Automatically selects engine based on PRICING_CONFIG:
     * - NATIVE: Uses PricingFormula elements
     * - CPE: Calls S/4HANA ZAPI_CPEFORMULA_SRV
     * - HYBRID: Runs both, compares, returns Native with variance
     */
    action calculatePrice(
        contractId  : UUID,
        airportId   : UUID,
        productId   : UUID,
        quantity    : Decimal(15,2),
        priceDate   : Date
    ) returns PriceCalculationResult;

    /**
     * getFormula - Retrieve formula details
     * Implements IPricingEngine.getFormula(formulaId): Formula
     */
    function getFormula(formulaId : UUID) returns FormulaDetail;

    /**
     * validateFormula - Validate formula completeness
     * Implements IPricingEngine.validateFormula(formula): ValidationResult
     */
    action validateFormula(formulaId : UUID) returns FormulaValidationResult;

    // ========================================================================
    // PRICE SIMULATOR - What-if Analysis
    // ========================================================================

    /**
     * simulatePrice - Price simulation with custom parameters
     * Allows testing price scenarios without persisting
     */
    action simulatePrice(
        formulaId       : UUID,
        baseIndexValue  : Decimal(15,4),
        quantity        : Decimal(15,2),
        overrides       : array of ElementOverride
    ) returns PriceSimulationResult;

    // ========================================================================
    // MARKET INDEX IMPORT
    // ========================================================================

    /**
     * importMarketIndex - Import index values from external source
     */
    action importMarketIndex(
        indexCode : String,
        fromDate  : Date,
        toDate    : Date
    ) returns MarketIndexImportResult;

    // ========================================================================
    // S/4HANA INTEGRATION
    // ========================================================================

    /**
     * syncContractFromS4 - Sync contract from S/4HANA
     * Uses API_PURCHASECONTRACT_SRV
     */
    action syncContractFromS4(s4ContractNumber : String) returns SyncResult;

    /**
     * syncCPEFormula - Sync CPE formula from S/4HANA
     * Uses ZAPI_CPEFORMULA_SRV (15-30 min cache TTL)
     */
    action syncCPEFormula(contractId : UUID) returns SyncResult;

    // ========================================================================
    // UTILITY FUNCTIONS
    // ========================================================================

    /**
     * Get applicable contracts for a location and product
     */
    function getApplicableContracts(
        airportId : UUID,
        productId : UUID,
        priceDate : Date
    ) returns array of ContractSummary;

    /**
     * Get current pricing configuration
     */
    function getPricingConfig(companyCode : String) returns PricingConfigDetail;

    // ========================================================================
    // TYPE DEFINITIONS
    // ========================================================================

    /**
     * Price Calculation Result
     */
    type PriceCalculationResult {
        success             : Boolean;
        calculationId       : String(36);
        contractNumber      : String(20);
        formulaCode         : String(20);
        engineUsed          : String(20);       // NATIVE / CPE
        engineMode          : String(20);       // NATIVE / CPE / HYBRID

        // Price Breakdown
        basePrice           : Decimal(15,4);
        serviceFees         : array of PriceElementDetail;
        taxes               : array of PriceElementDetail;
        locationPremium     : Decimal(15,4);
        productPremium      : Decimal(15,4);
        totalServiceFees    : Decimal(15,4);
        totalTaxes          : Decimal(15,4);
        finalUnitPrice      : Decimal(15,4);
        totalAmount         : Decimal(15,2);
        currencyCode        : String(3);
        uomCode             : String(3);

        // Hybrid Mode Variance
        cpeUnitPrice        : Decimal(15,4);
        nativeUnitPrice     : Decimal(15,4);
        varianceAmount      : Decimal(15,4);
        variancePercentage  : Decimal(5,2);
        varianceFlag        : Boolean;

        // Metadata
        calculationDate     : Date;
        calculatedAt        : DateTime;
        errorMessage        : String(500);
    }

    /**
     * Price Element Detail (for breakdown)
     */
    type PriceElementDetail {
        sequence        : Integer;
        elementCode     : String(20);
        elementName     : String(100);
        category        : String(20);       // MARKET_INDEX / SERVICE_FEE / TAX
        elementType     : String(20);       // INDEX / FIXED / PERCENTAGE
        inputValue      : Decimal(15,4);    // Fixed value or percentage
        calculatedAmount: Decimal(15,4);    // Calculated contribution
        currencyCode    : String(3);
    }

    /**
     * Formula Detail
     */
    type FormulaDetail {
        formulaId       : UUID;
        formulaCode     : String(20);
        formulaName     : String(100);
        description     : String(500);
        currencyCode    : String(3);
        uomCode         : String(3);
        validFrom       : Date;
        validTo         : Date;
        elements        : array of FormulaElementDetail;
    }

    type FormulaElementDetail {
        sequence        : Integer;
        elementCode     : String(20);
        elementName     : String(100);
        category        : String(20);
        elementType     : String(20);
        marketIndexCode : String(20);
        fixedValue      : Decimal(15,4);
        percentageValue : Decimal(8,4);
        isTaxable       : Boolean;
    }

    /**
     * Formula Validation Result
     */
    type FormulaValidationResult {
        isValid         : Boolean;
        formulaCode     : String(20);
        validationDate  : DateTime;
        errors          : array of ValidationMessage;
        warnings        : array of ValidationMessage;
    }

    type ValidationMessage {
        code    : String(10);
        message : String(500);
        field   : String(100);
    }

    /**
     * Price Simulation Result
     */
    type PriceSimulationResult {
        success         : Boolean;
        formulaCode     : String(20);
        basePrice       : Decimal(15,4);
        finalUnitPrice  : Decimal(15,4);
        totalAmount     : Decimal(15,2);
        breakdown       : array of PriceElementDetail;
        currencyCode    : String(3);
        uomCode         : String(3);
        simulatedAt     : DateTime;
    }

    type ElementOverride {
        elementCode     : String(20);
        overrideValue   : Decimal(15,4);
    }

    /**
     * Market Index Import Result
     */
    type MarketIndexImportResult {
        success         : Boolean;
        indexCode       : String(20);
        recordsImported : Integer;
        fromDate        : Date;
        toDate          : Date;
        errors          : array of String;
        importTime      : DateTime;
    }

    /**
     * Sync Result
     */
    type SyncResult {
        success         : Boolean;
        recordsSynced   : Integer;
        errors          : array of String;
        syncTime        : DateTime;
    }

    /**
     * Contract Summary
     */
    type ContractSummary {
        contractId      : UUID;
        contractNumber  : String(20);
        contractName    : String(100);
        supplierName    : String(100);
        validFrom       : Date;
        validTo         : Date;
        priceType       : String(20);
        currencyCode    : String(3);
        priority        : Integer;
    }

    /**
     * Pricing Config Detail
     */
    type PricingConfigDetail {
        configCode          : String(20);
        companyCode         : String(10);
        engineMode          : String(20);
        fallbackEnabled     : Boolean;
        varianceThreshold   : Decimal(5,2);
        cpeCacheTtlMins     : Integer;
        validFrom           : Date;
        validTo             : Date;
    }

    // ========================================================================
    // CONTRACTS CPE DASHBOARD TYPES (for ContractsCPEDashboard TSX)
    // ========================================================================

    /**
     * KPIs for contracts & CPE dashboard
     * Used by: ContractsCPEDashboard KPI tiles
     */
    type ContractsDashboardKPIs {
        activeContracts         : Integer;          // Active contract count
        totalContractValue      : Decimal(15,2);    // Total portfolio value
        cpeFormulaCoverage      : Decimal(5,2);     // CPE formula coverage %
        priceSyncSuccess        : Decimal(5,2);     // Price sync success rate %
        priceSyncTrend          : Decimal(5,2);     // % change vs prior period
        expiringSoon            : Integer;          // Contracts expiring within 90 days
        lastPriceUpdateMins     : Integer;          // Minutes since last price update
        systemsOperational      : Boolean;          // All systems operational flag
    };

    /**
     * Contract share by supplier for donut chart
     * Used by: ContractsCPEDashboard contracts by supplier chart
     */
    type ContractsBySupplierItem {
        name                    : String(100);      // Supplier name
        value                   : Integer;          // Share % (0-100)
        count                   : Integer;          // Number of contracts
    };

    /**
     * Supplier exposure by contract value
     * Used by: ContractsCPEDashboard supplier exposure bar chart
     */
    type SupplierExposureItem {
        supplier                : String(100);      // Supplier name
        value                   : Decimal(15,2);    // Contract value (millions)
    };

    /**
     * Price variance trend point
     * Used by: ContractsCPEDashboard price variance trend line chart
     */
    type PriceVarianceTrendItem {
        day                     : String(10);       // Day label
        variance                : Decimal(5,2);     // Variance % (+/-)
    };

    /**
     * Expiring contract record
     * Used by: ContractsCPEDashboard + ContractManagerHomeDashboard expiring contracts table
     */
    type ExpiringContractItem {
        id                      : String(20);       // Contract ID
        supplier                : String(100);      // Supplier name
        expiryDate              : String(20);       // Display date
        daysRemaining           : Integer;          // Days until expiry
        severity                : String(10);       // high, medium, low
        action                  : String(10);       // Renew, Review, Extend
    };

    // ========================================================================
    // CONTRACTS CPE DASHBOARD FUNCTIONS
    // ========================================================================

    /**
     * Get contracts dashboard KPIs
     */
    function getContractsDashboardKPIs() returns ContractsDashboardKPIs;

    /**
     * Get contracts breakdown by supplier (donut chart)
     */
    function getContractsBySupplier() returns array of ContractsBySupplierItem;

    /**
     * Get supplier exposure by value (bar chart)
     */
    function getSupplierExposure() returns array of SupplierExposureItem;

    /**
     * Get price variance trend (line chart)
     */
    function getPriceVarianceTrend(days: Integer) returns array of PriceVarianceTrendItem;

    /**
     * Get contracts expiring soon
     */
    function getExpiringContracts(withinDays: Integer) returns array of ExpiringContractItem;

    /**
     * Renew an expiring contract
     */
    action renewContract(contractId: String) returns ContractSummary;

    // ========================================================================
    // CONTRACT MANAGER HOME DASHBOARD TYPES (for ContractManagerHomeDashboard TSX)
    // ========================================================================

    /**
     * Portfolio health scorecard
     * Used by: ContractManagerHomeDashboard portfolio health section
     */
    type PortfolioHealthKPIs {
        activeContracts         : Integer;
        supplierCount           : Integer;
        airportCount            : Integer;
        totalPortfolioValue     : Decimal(15,2);    // Total value
        portfolioValueChange    : Decimal(15,2);    // Change amount
        portfolioValueChangePct : Decimal(5,2);     // Change %
        avgValuePerContract     : Decimal(15,2);
        avgUtilization          : Decimal(5,2);     // Utilization %
        utilizationTarget       : String(10);       // e.g. 75-85%
        complianceScore         : Decimal(5,2);     // Compliance score %
        costSavingsYTD          : Decimal(15,2);    // Cost savings
        belowBudgetPct          : Decimal(5,2);     // % below budget
    };

    /**
     * Price variance alert for monitoring
     * Used by: ContractManagerHomeDashboard price variance section
     */
    type PriceVarianceAlertItem {
        supplier                : String(100);      // Supplier with station
        issue                   : String(100);      // Alert description
        details                 : String(100);      // Price details
        threshold               : String(100);      // Threshold info
        status                  : String(10);       // warning, error
    };

    /**
     * User task item
     * Used by: ContractManagerHomeDashboard my tasks section
     */
    type ContractTaskItem {
        title                   : String(200);      // Task description
        due                     : String(20);       // Due display (e.g. "2 days", "In progress")
        priority                : String(10);       // high, medium, low
        progress                : Integer;          // Progress % (null = no progress bar)
    };

    /**
     * Top supplier performance card
     * Used by: ContractManagerHomeDashboard supplier performance section
     */
    type TopSupplierItem {
        name                    : String(100);      // Supplier name
        score                   : Decimal(5,1);     // Performance score (0-100)
        trend                   : String(10);       // up, down, neutral
        trendValue              : Decimal(5,1);     // Trend delta
        delivery                : Decimal(5,1);     // Delivery rate %
        quality                 : Decimal(5,1);     // Quality rate %
        ytdSpend                : Decimal(15,2);    // YTD spend
        alert                   : Boolean;          // Review needed flag
    };

    /**
     * Team activity feed item
     * Used by: ContractManagerHomeDashboard team activity section
     */
    type TeamActivityItem {
        user                    : String(100);      // User name
        action                  : String(200);      // Action description
        time                    : String(20);       // Relative time (e.g. "2 hrs ago")
    };

    /**
     * Critical alerts summary
     * Used by: ContractManagerHomeDashboard alert banner
     */
    type CriticalAlertsSummary {
        expiringContracts       : Integer;          // Contracts expiring within 90 days
        priceVariances          : Integer;          // Price variances detected
        complianceIssues        : Integer;          // Compliance issues
    };

    // ========================================================================
    // CONTRACT MANAGER HOME DASHBOARD FUNCTIONS
    // ========================================================================

    /**
     * Get portfolio health scorecard
     */
    function getPortfolioHealthKPIs() returns PortfolioHealthKPIs;

    /**
     * Get price variance alerts
     */
    function getPriceVarianceAlerts() returns array of PriceVarianceAlertItem;

    /**
     * Get user's active tasks
     */
    function getContractTasks(userId: String) returns array of ContractTaskItem;

    /**
     * Get top supplier performance cards
     */
    function getTopSuppliers(limit: Integer) returns array of TopSupplierItem;

    /**
     * Get team activity feed
     */
    function getTeamActivity(limit: Integer) returns array of TeamActivityItem;

    /**
     * Get critical alerts summary
     */
    function getCriticalAlertsSummary() returns CriticalAlertsSummary;

    /**
     * Acknowledge a price variance alert
     */
    action acknowledgePriceVariance(supplier: String) returns PriceVarianceAlertItem;

    /**
     * Start contract renewal process
     */
    action startRenewalProcess(contractIds: array of String) returns String;
}

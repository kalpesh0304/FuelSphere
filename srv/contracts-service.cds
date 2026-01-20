/**
 * FuelSphere - Contracts & CPE Service (FDD-03)
 *
 * Manages fuel purchase contracts and CPE (Commodity Pricing Engine) formulas.
 * Provides price calculation capabilities based on contract terms.
 *
 * Authorization per PERSONA_AUTHORIZATION_MATRIX
 */

using { fuelsphere as db } from '../db/schema';

@path: '/odata/v4/contracts'
service ContractsService {

    // ========================================================================
    // CONTRACT ENTITIES
    // ========================================================================

    /**
     * Contracts - Purchase Contract Master
     * Access: contracts-manager (CRUD), finance-manager (View), fuel-planner (View)
     */
    entity Contracts as projection on db.MASTER_CONTRACTS {
        *,
        supplier : redirected to Suppliers,
        currency : redirected to Currencies,
        priceElements : redirected to PriceElements,
        locations : redirected to ContractLocations,
        products : redirected to ContractProducts
    };

    /**
     * PriceElements - CPE Formula Components
     * Access: contracts-manager (CRUD), finance (View)
     */
    entity PriceElements as projection on db.CONTRACT_PRICE_ELEMENTS {
        *,
        contract : redirected to Contracts,
        price_index : redirected to PriceIndices
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
    // PRICE INDEX ENTITIES
    // ========================================================================

    /**
     * PriceIndices - External Price Index Definitions
     * Access: contracts-manager (CRUD), finance (View)
     */
    entity PriceIndices as projection on db.PRICE_INDICES {
        *,
        currency : redirected to Currencies,
        uom : redirected to UnitsOfMeasure,
        values : redirected to PriceIndexValues
    };

    /**
     * PriceIndexValues - Historical Price Index Values
     * Access: integration-admin (Create), all (View)
     */
    entity PriceIndexValues as projection on db.PRICE_INDEX_VALUES {
        *,
        priceIndex : redirected to PriceIndices
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
    // ACTIONS
    // ========================================================================

    /**
     * Calculate fuel price based on contract CPE formula
     * Returns breakdown of all price elements
     */
    action calculatePrice(
        contractId  : UUID,
        locationId  : UUID,
        productId   : UUID,
        quantity    : Decimal(15,2),
        priceDate   : Date
    ) returns PriceCalculationResult;

    /**
     * Validate contract completeness
     * Checks for required price elements, locations, and products
     */
    action validateContract(contractId : UUID) returns ContractValidationResult;

    /**
     * Sync contract from S/4HANA
     */
    action syncFromS4(s4ContractNumber : String) returns SyncResult;

    /**
     * Import price index values from external source
     */
    action importPriceIndex(
        indexCode : String,
        fromDate  : Date,
        toDate    : Date
    ) returns PriceIndexImportResult;

    /**
     * Get applicable contracts for a location and product
     */
    function getApplicableContracts(
        airportId : UUID,
        productId : UUID,
        priceDate : Date
    ) returns array of ContractSummary;

    // ========================================================================
    // TYPE DEFINITIONS
    // ========================================================================

    type PriceCalculationResult {
        success             : Boolean;
        contractNumber      : String(20);
        basePrice           : Decimal(15,4);
        elements            : array of PriceElementDetail;
        locationPremium     : Decimal(15,4);
        productPremium      : Decimal(15,4);
        totalPrice          : Decimal(15,4);
        totalAmount         : Decimal(15,2);
        currencyCode        : String(3);
        uomCode             : String(3);
        calculationDate     : Date;
        errorMessage        : String(500);
    }

    type PriceElementDetail {
        sequence        : Integer;
        elementCode     : String(20);
        elementName     : String(100);
        elementType     : String(20);
        operation       : String(10);
        value           : Decimal(15,4);
        amount          : Decimal(15,4);
        currencyCode    : String(3);
    }

    type ContractValidationResult {
        isValid             : Boolean;
        contractNumber      : String(20);
        validationDate      : DateTime;
        errors              : array of ValidationError;
        warnings            : array of ValidationError;
    }

    type ValidationError {
        code    : String(10);
        message : String(500);
        field   : String(100);
    }

    type SyncResult {
        success         : Boolean;
        recordsSynced   : Integer;
        errors          : array of String;
        syncTime        : DateTime;
    }

    type PriceIndexImportResult {
        success         : Boolean;
        indexCode       : String(20);
        recordsImported : Integer;
        fromDate        : Date;
        toDate          : Date;
        errors          : array of String;
        importTime      : DateTime;
    }

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
}

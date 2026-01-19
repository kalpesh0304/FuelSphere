/**
 * FuelSphere - Database Schema
 *
 * Master Data Module (FDD-01) - 11 Validated Entities
 * Based on: FuelSphere_MasterData_HLD_v2.1
 *
 * Entity Groups:
 * - Reference Data (S/4HANA synced): T005_COUNTRY, CURRENCY_MASTER, UNIT_OF_MEASURE, T001W_PLANT
 * - FuelSphere Native: MANUFACTURE, AIRCRAFT_MASTER, MASTER_AIRPORTS, ROUTE_MASTER
 * - Bidirectional: MASTER_SUPPLIERS, MASTER_PRODUCTS, MASTER_CONTRACTS
 */

namespace fuelsphere;

using { cuid, managed } from '@sap/cds/common';

// ============================================================================
// COMMON ASPECTS
// ============================================================================

/**
 * Audit aspect for entities requiring full audit trail
 */
aspect AuditTrail {
    created_at  : DateTime @cds.on.insert: $now;
    created_by  : String(100) @cds.on.insert: $user;
    modified_at : DateTime @cds.on.insert: $now @cds.on.update: $now;
    modified_by : String(100) @cds.on.insert: $user @cds.on.update: $user;
}

/**
 * Active status aspect
 */
aspect ActiveStatus {
    is_active : Boolean default true;
}

// ============================================================================
// REFERENCE DATA - S/4HANA SYNCHRONIZED
// ============================================================================

/**
 * T005_COUNTRY - SAP Country Master
 * Source: S/4HANA API_COUNTRY_SRV + FuelSphere Compliance (FDD-07)
 * Sync: Daily
 *
 * Extended with embargo/sanction fields for FDD-07 Compliance Module
 */
entity T005_COUNTRY : ActiveStatus {
    key land1       : String(3);      // SAP Country key (PK)
        landx       : String(50);     // Country name
        landx50     : String(100);    // Full country name
        natio       : String(3);      // Nationality code
        landgr      : String(3);      // Country group/region
        currcode    : String(3);      // Currency code (FK to CURRENCY_MASTER)
        spras       : String(2);      // Language key

        // FDD-07 Embargo & Compliance Fields
        is_embargoed        : Boolean default false;  // Embargo/sanction flag
        embargo_effective_date : Date;                // Date embargo became effective
        embargo_reason      : String(500);            // Regulatory reference for embargo
        sanction_programs   : String(200);            // Applicable programs (OFAC, EU, UN)
        risk_level          : String(10);             // HIGH, MEDIUM, LOW
}

/**
 * CURRENCY_MASTER - Currency Definitions
 * Source: S/4HANA API_CURRENCY_EXCHANGE_RATES
 * Sync: Daily
 */
entity CURRENCY_MASTER : ActiveStatus {
    key currency_code   : String(3);      // Currency code (ISO 4217)
        currency_name   : String(50);     // Currency name
        decimal_places  : Integer;        // Number of decimal places
        symbol          : String(5);      // Currency symbol
}

/**
 * UNIT_OF_MEASURE - UoM Codes
 * Source: S/4HANA
 * Sync: Daily
 */
entity UNIT_OF_MEASURE : ActiveStatus {
    key uom_code        : String(3);      // UoM code (KG, LTR, GAL, etc.)
        uom_name        : String(50);     // UoM description
        uom_category    : String(20);     // Category (MASS, VOLUME, etc.)
        conversion_to_kg: Decimal(15,6);  // Conversion factor to kg (for volume)
}

/**
 * T001W_PLANT - SAP Plant Master
 * Source: S/4HANA ZAPI_PLANT_SRV (custom)
 * Sync: Daily
 */
entity T001W_PLANT : ActiveStatus {
    key werks       : String(4);      // Plant code (PK)
        name1       : String(50);     // Plant name
        stras       : String(100);    // Street address
        ort01       : String(50);     // City
        land1       : Association to T005_COUNTRY;  // FK to Country
        regio       : String(3);      // Region code
        pstlz       : String(10);     // Postal code
        spras       : String(2);      // Language key
}

// ============================================================================
// FUELSPHERE NATIVE ENTITIES
// ============================================================================

/**
 * MANUFACTURE - Aircraft Manufacturer Master
 * Source: FuelSphere native
 */
entity MANUFACTURE : ActiveStatus, AuditTrail {
    key manufacture_code : String(2);     // Manufacturer code (PK) - e.g., BA, AI
        manufacture_name : String(100);   // Full manufacturer name
}

/**
 * AIRCRAFT_MASTER - Aircraft Type Master
 * Source: FuelSphere native
 *
 * Fields aligned with HLD Section 3.2
 */
entity AIRCRAFT_MASTER : ActiveStatus, AuditTrail {
    key type_code           : String(10);     // Aircraft type code (PK)
        aircraft_model      : String(50);     // Full aircraft model name
        manufacturer        : Association to MANUFACTURE on manufacturer.manufacture_code = manufacturer_code;
        manufacturer_code   : String(2);      // FK to MANUFACTURE
        fuel_capacity_kg    : Decimal(15,2);  // Maximum fuel capacity in kg
        mtow_kg             : Decimal(15,2);  // Maximum takeoff weight in kg
        cruise_burn_kgph    : Decimal(10,2);  // Cruise fuel burn rate kg/hour
        fleet_size          : Integer;        // Number in fleet
        status              : String(20) default 'ACTIVE'; // ACTIVE/INACTIVE/MAINTENANCE
}

/**
 * MASTER_AIRPORTS - Airport Master
 * Source: FuelSphere native with S/4 plant mapping
 *
 * Fields aligned with HLD Section 3.2
 */
entity MASTER_AIRPORTS : cuid, ActiveStatus, AuditTrail {
        iata_code       : String(3) @mandatory;   // IATA airport code (Unique)
        icao_code       : String(4);              // ICAO airport code
        airport_name    : String(100) @mandatory; // Full airport name
        city            : String(50) @mandatory;  // City name
        country         : Association to T005_COUNTRY on country.land1 = country_code;
        country_code    : String(3) @mandatory;   // FK to T005_COUNTRY.land1
        timezone        : String(50);             // Airport timezone
        plant           : Association to T001W_PLANT on plant.werks = s4_plant_code;
        s4_plant_code   : String(4);              // FK to T001W_PLANT.werks
}

/**
 * ROUTE_MASTER - Route Definitions
 * Source: FuelSphere native
 *
 * Fields aligned with HLD Section 3.2
 * Note: fuel_required is Decimal (kg), NOT Boolean (DD-006)
 */
entity ROUTE_MASTER : ActiveStatus, AuditTrail {
    key route_code          : String(20);     // Route code Origin-Dest (PK)
        origin              : Association to MASTER_AIRPORTS on origin.iata_code = origin_airport;
        origin_airport      : String(3) @mandatory;   // FK to MASTER_AIRPORTS.iata_code
        destination         : Association to MASTER_AIRPORTS on destination.iata_code = destination_airport;
        destination_airport : String(3) @mandatory;   // FK to MASTER_AIRPORTS.iata_code
        distance_km         : Decimal(10,2) @mandatory; // Distance in kilometers
        avg_flight_time     : String(10);             // Average flight time (HH:MM)
        fuel_required       : Decimal(15,2);          // Standard fuel requirement in kg
        alternate_count     : Integer default 0;      // Number of alternate airports
        status              : String(20) default 'ACTIVE'; // ACTIVE/INACTIVE
}

// ============================================================================
// BIDIRECTIONAL ENTITIES - S/4HANA INTEGRATION
// ============================================================================

/**
 * MASTER_SUPPLIERS - Supplier/Vendor Master
 * Source: Bidirectional with S/4HANA API_BUSINESS_PARTNER
 * Sync: Real-time
 *
 * Fields aligned with HLD Section 3.2
 */
entity MASTER_SUPPLIERS : cuid, ActiveStatus, AuditTrail {
        supplier_code   : String(20) @mandatory;  // Supplier code
        supplier_name   : String(100) @mandatory; // Full supplier name
        supplier_type   : String(20) @mandatory;  // EXTERNAL / INTO_PLANE
        country         : Association to T005_COUNTRY on country.land1 = country_code;
        country_code    : String(3) @mandatory;   // FK to T005_COUNTRY.land1
        payment_terms   : String(20);             // Payment terms
        s4_vendor_no    : String(10);             // S/4HANA Vendor Number (LIFNR)
}

/**
 * MASTER_PRODUCTS - Fuel Product Master
 * Source: S/4HANA API_PRODUCT_SRV
 * Sync: Real-time
 *
 * Fields aligned with HLD Section 3.2
 */
entity MASTER_PRODUCTS : cuid, ActiveStatus, AuditTrail {
        product_code        : String(20) @mandatory;  // Product code
        product_name        : String(100) @mandatory; // Full product name
        product_type        : String(20) @mandatory;  // JET_FUEL / AVGAS / BIOFUEL
        specification       : String(50) @mandatory;  // ASTM/DEF STAN specification
        uom                 : Association to UNIT_OF_MEASURE on uom.uom_code = uom_code;
        uom_code            : String(3) @mandatory;   // FK to UNIT_OF_MEASURE.uom_code
        s4_material_number  : String(18);             // S/4HANA Material Number (MATNR)
}

/**
 * MASTER_CONTRACTS - Purchase Contract Master
 * Source: FuelSphere native with S/4HANA reference
 * Sync: Bidirectional Real-time
 *
 * Enhanced for FDD-03 Contracts & CPE Integration
 */
entity MASTER_CONTRACTS : cuid, ActiveStatus, AuditTrail {
        contract_number     : String(20) @mandatory;  // Contract number
        contract_name       : String(100) @mandatory; // Contract description
        supplier            : Association to MASTER_SUPPLIERS;
        valid_from          : Date @mandatory;        // Contract start date
        valid_to            : Date @mandatory;        // Contract end date
        contract_type       : String(20) @mandatory;  // SPOT / TERM / FRAMEWORK
        price_type          : String(20) @mandatory;  // CPE / FIXED / NATIVE (v2.0)
        currency            : Association to CURRENCY_MASTER on currency.currency_code = currency_code;
        currency_code       : String(3) @mandatory;   // FK to CURRENCY_MASTER.currency_code
        payment_terms       : String(20);             // Payment terms (NET30, etc.)
        incoterms           : String(10);             // Incoterms (DAP, FCA, etc.)
        min_volume_kg       : Decimal(15,2);          // Minimum annual volume
        max_volume_kg       : Decimal(15,2);          // Maximum annual volume
        s4_contract_number  : String(10);             // S/4HANA Contract (EBELN)
        // Compositions (v2.0 - pricing formulas linked separately)
        locations           : Composition of many CONTRACT_LOCATIONS on locations.contract = $self;
        products            : Composition of many CONTRACT_PRODUCTS on products.contract = $self;
}

// ============================================================================
// CONTRACTS & CPE INTEGRATION v2.0 (FDD-03)
// Dual Pricing Engine Architecture: CPE Adapter + Native Engine
// ============================================================================

/**
 * Pricing Engine Mode - Runtime selection per company/tenant
 */
type PricingEngineMode : String(20) enum {
    NATIVE      = 'NATIVE';      // FuelSphere Native Engine only
    CPE         = 'CPE';         // S/4HANA CPE Adapter only
    HYBRID      = 'HYBRID';      // Both engines with variance tracking
}

/**
 * Formula Element Category - Per FDD-03 v2.0 Price Calculation Formula
 */
type FormulaElementCategory : String(20) enum {
    MARKET_INDEX  = 'MARKET_INDEX';   // Base Index lookup (Platts, Argus)
    SERVICE_FEE   = 'SERVICE_FEE';    // Fixed/% fees (Premium, ITP, Transport, Handling)
    TAX           = 'TAX';            // Tax components (Excise, VAT, Other)
}

/**
 * Formula Element Type
 */
type FormulaElementType : String(20) enum {
    INDEX       = 'INDEX';       // Lookup from market index
    FIXED       = 'FIXED';       // Fixed amount per unit
    PERCENTAGE  = 'PERCENTAGE';  // Percentage of subtotal
}

/**
 * PRICING_CONFIG - Pricing Engine Configuration
 * Source: FuelSphere native
 *
 * Configures which pricing engine to use per company/tenant.
 * Supports runtime selection and automatic fallback.
 */
entity PRICING_CONFIG : cuid, ActiveStatus, AuditTrail {
        config_code         : String(20) @mandatory;      // Configuration identifier
        company_code        : String(10);                 // Company code (NULL = default)
        engine_mode         : PricingEngineMode default 'NATIVE'; // NATIVE / CPE / HYBRID
        fallback_enabled    : Boolean default true;       // Auto-fallback to Native if CPE unavailable
        variance_threshold  : Decimal(5,2) default 5.00;  // % threshold for hybrid comparison alerts
        cpe_cache_ttl_mins  : Integer default 30;         // CPE cache TTL in minutes (15-30 per FDD)
        cpe_endpoint_url    : String(500);                // S/4HANA CPE OData endpoint
        valid_from          : Date @mandatory;
        valid_to            : Date;
}

/**
 * PRICING_FORMULA - Native Engine Formula Definitions
 * Source: FuelSphere native
 *
 * Defines pricing formulas for the Native Engine.
 * Formula: Final Price = Base Index + Premium + Into-Plane + Transport + Handling + Excise + VAT + Other
 */
entity PRICING_FORMULA : cuid, ActiveStatus, AuditTrail {
        formula_code        : String(20) @mandatory;      // Formula identifier
        formula_name        : String(100) @mandatory;     // Display name
        description         : String(500);                // Formula description
        contract            : Association to MASTER_CONTRACTS;  // Optional link to contract
        currency            : Association to CURRENCY_MASTER on currency.currency_code = currency_code;
        currency_code       : String(3) @mandatory;       // Formula currency
        uom                 : Association to UNIT_OF_MEASURE on uom.uom_code = uom_code;
        uom_code            : String(3) @mandatory;       // Formula UoM (KG, LTR, GAL)
        valid_from          : Date @mandatory;
        valid_to            : Date;
        // Composition
        elements            : Composition of many PRICING_FORMULA_ELEMENT on elements.formula = $self;
}

/**
 * PRICING_FORMULA_ELEMENT - Formula Component Elements
 * Source: FuelSphere native
 *
 * Individual components of a pricing formula.
 * Categories per FDD-03 v2.0:
 * - MARKET_INDEX: BASE (Platts, Argus)
 * - SERVICE_FEE: Premium, Into-Plane, Transport, Handling
 * - TAX: Excise, VAT, Other
 */
entity PRICING_FORMULA_ELEMENT : cuid, ActiveStatus {
        formula             : Association to PRICING_FORMULA @mandatory;
        sequence            : Integer @mandatory;         // Calculation order (1-99)
        element_code        : String(20) @mandatory;      // BASE, PREMIUM, ITP, TRANSPORT, HANDLING, EXCISE, VAT, OTHER
        element_name        : String(100) @mandatory;     // Display name
        category            : FormulaElementCategory @mandatory; // MARKET_INDEX / SERVICE_FEE / TAX
        element_type        : FormulaElementType @mandatory;     // INDEX / FIXED / PERCENTAGE
        market_index        : Association to MARKET_INDEX;       // FK if type = INDEX
        fixed_value         : Decimal(15,4);              // Value if type = FIXED
        percentage_value    : Decimal(8,4);               // Value if type = PERCENTAGE
        currency_code       : String(3);                  // Element currency (may differ from formula)
        is_taxable          : Boolean default true;       // Include in tax base calculation
        valid_from          : Date;
        valid_to            : Date;
}

/**
 * MARKET_INDEX - Market Index Definitions
 * Source: External (Platts, Argus, CME, etc.)
 *
 * Defines market indices for price lookups.
 */
entity MARKET_INDEX : cuid, ActiveStatus, AuditTrail {
        index_code              : String(20) @mandatory;  // PLATTS_SG, MOPS_JET, ARGUS_EU, NYMEX_HO
        index_name              : String(100) @mandatory; // Full index name
        index_provider          : String(50) @mandatory;  // S&P Global Platts, Argus Media, CME Group
        index_region            : String(50) @mandatory;  // Singapore, Asia Pacific, Northwest Europe
        product_type            : String(20) @mandatory;  // JET_FUEL / AVGAS / BIOFUEL
        currency                : Association to CURRENCY_MASTER on currency.currency_code = currency_code;
        currency_code           : String(3) @mandatory;   // Index currency (USD)
        uom                     : Association to UNIT_OF_MEASURE on uom.uom_code = uom_code;
        uom_code                : String(3) @mandatory;   // Index UoM (BBL, MT, KG)
        publication_frequency   : String(20) @mandatory;  // DAILY / WEEKLY / MONTHLY
        publication_lag_days    : Integer default 0;      // Days after period end
        data_source_url         : String(500);            // External data API URL
        // Composition
        values                  : Composition of many INDEX_VALUE on values.marketIndex = $self;
}

/**
 * INDEX_VALUE - Historical Market Index Values
 * Source: External (Platts, Argus, etc.)
 *
 * Stores historical price values for market indices.
 */
entity INDEX_VALUE : cuid {
        marketIndex         : Association to MARKET_INDEX @mandatory;
        effective_date      : Date @mandatory;            // Price effective date
        price_value         : Decimal(15,4) @mandatory;   // Index price value
        price_low           : Decimal(15,4);              // Daily low
        price_high          : Decimal(15,4);              // Daily high
        source_reference    : String(100);                // Publication reference
        imported_at         : DateTime @cds.on.insert: $now;
        imported_by         : String(100);
}

/**
 * DERIVED_PRICE - Price Calculation Results (Audit Trail)
 * Source: FuelSphere native
 *
 * Stores calculated prices for audit and variance tracking.
 * Records results from both Native and CPE engines in HYBRID mode.
 */
entity DERIVED_PRICE : cuid {
        calculation_id      : String(36) @mandatory;      // Unique calculation reference
        contract            : Association to MASTER_CONTRACTS;
        formula             : Association to PRICING_FORMULA;
        airport             : Association to MASTER_AIRPORTS;
        product             : Association to MASTER_PRODUCTS;

        // Calculation Context
        calculation_date    : Date @mandatory;            // Price date used
        quantity            : Decimal(15,2) @mandatory;   // Quantity for calculation
        uom_code            : String(3) @mandatory;

        // Engine Used
        engine_mode         : PricingEngineMode @mandatory;
        engine_used         : String(20) @mandatory;      // NATIVE / CPE

        // Price Results
        base_price          : Decimal(15,4);              // Base index price
        total_service_fees  : Decimal(15,4);              // Sum of service fees
        total_taxes         : Decimal(15,4);              // Sum of taxes
        final_unit_price    : Decimal(15,4) @mandatory;   // Final price per unit
        total_amount        : Decimal(15,2) @mandatory;   // Total = unit_price * quantity
        currency_code       : String(3) @mandatory;

        // Hybrid Mode Variance (if applicable)
        cpe_unit_price      : Decimal(15,4);              // CPE calculated price
        native_unit_price   : Decimal(15,4);              // Native calculated price
        variance_amount     : Decimal(15,4);              // Absolute variance
        variance_percentage : Decimal(5,2);               // Variance %
        variance_flag       : Boolean default false;      // True if exceeds threshold

        // Element Breakdown (JSON)
        price_breakdown     : LargeString;                // JSON array of element details

        // Audit
        calculated_at       : DateTime @cds.on.insert: $now;
        calculated_by       : String(100);
        calculation_duration_ms : Integer;                // Performance tracking
}

/**
 * CONTRACT_LOCATIONS - Airport/Plant Assignments
 * Source: FuelSphere native
 *
 * Assigns contracts to specific airports/plants where they can be used.
 */
entity CONTRACT_LOCATIONS : cuid, ActiveStatus, AuditTrail {
        contract            : Association to MASTER_CONTRACTS @mandatory;
        airport             : Association to MASTER_AIRPORTS;
        plant_code          : String(4);                  // FK to T001W_PLANT.werks
        location_type       : String(20) default 'PRIMARY'; // PRIMARY / ALTERNATE
        location_premium    : Decimal(15,4);              // Location-specific premium per unit
        priority            : Integer default 1;          // Selection priority (1=highest)
        valid_from          : Date @mandatory;            // Location validity start
        valid_to            : Date;                       // Location validity end
}

/**
 * CONTRACT_PRODUCTS - Product Assignments per Contract
 * Source: FuelSphere native
 *
 * Defines which fuel products are covered under each contract.
 */
entity CONTRACT_PRODUCTS : cuid, ActiveStatus, AuditTrail {
        contract            : Association to MASTER_CONTRACTS @mandatory;
        product             : Association to MASTER_PRODUCTS @mandatory;
        product_premium     : Decimal(15,4);              // Product-specific premium per unit
        min_quantity        : Decimal(15,2);              // Minimum order quantity
        max_quantity        : Decimal(15,2);              // Maximum order quantity
        is_default          : Boolean default false;      // Default product for contract
}

// ============================================================================
// CONFIGURATION ENTITIES (DD-001, DD-002)
// ============================================================================

/**
 * CONFIG_PERSONAS - Persona Configuration (Seed Data)
 * Per DD-001: Personas are recommended seed data, customizable
 */
entity CONFIG_PERSONAS : cuid {
        persona_id      : String(30) @mandatory;  // e.g., 'fuel-planner'
        persona_name    : String(100) @mandatory; // Display name
        description     : String(500);            // Role description
        is_active       : Boolean default true;
}

/**
 * CONFIG_TILES - Application Tiles (Seed Data)
 * Per DD-001: Tile definitions for Fiori Launchpad
 */
entity CONFIG_TILES : cuid {
        tile_id         : String(50) @mandatory;  // e.g., 'planner-home'
        tile_name       : String(100) @mandatory; // Display name
        tile_group      : String(50);             // Grouping category
        target_url      : String(500);            // Navigation target
        icon            : String(100);            // SAP icon reference
        is_active       : Boolean default true;
}

/**
 * CONFIG_PERSONA_TILES - Persona-Tile Mapping (Customizable)
 * Per DD-001: Customizable mapping of tiles to personas
 */
entity CONFIG_PERSONA_TILES : cuid {
        persona         : Association to CONFIG_PERSONAS;
        tile            : Association to CONFIG_TILES;
        access_level    : String(10) default 'VIEW'; // VIEW / EDIT
        is_active       : Boolean default true;
}

/**
 * CONFIG_USER_PERSONAS - User-Persona Assignment
 * Per DD-001: Managed by customer administrators
 */
entity CONFIG_USER_PERSONAS : cuid, managed {
        user_id         : String(255) @mandatory; // User email/ID
        persona         : Association to CONFIG_PERSONAS;
        station         : String(3);              // Station restriction (for station-coordinator)
        region          : String(20);             // Region restriction (for ops-manager)
        is_active       : Boolean default true;
}

/**
 * CONFIG_APPROVAL_LIMITS - Approval Threshold Configuration
 * Per DD-002: Setup data, configurable at deployment
 */
entity CONFIG_APPROVAL_LIMITS : cuid {
        persona         : Association to CONFIG_PERSONAS;
        limit_type      : String(30) @mandatory;  // FUEL_ORDER_KG / FUEL_DAILY_KG / INVOICE_USD / INVOICE_MONTHLY_USD
        limit_value     : Decimal(15,2);          // Limit value (NULL = Unlimited)
        is_active       : Boolean default true;
}

// ============================================================================
// FLIGHT SCHEDULE (For Fuel Order Reference)
// ============================================================================

/**
 * FLIGHT_SCHEDULE - Flight Schedule Master
 * Source: External flight ops system or manual entry
 * Used for linking fuel orders to specific flights
 */
entity FLIGHT_SCHEDULE : cuid, AuditTrail {
        flight_number       : String(10) @mandatory;    // Flight number (e.g., PR101)
        flight_date         : Date @mandatory;          // Flight date
        aircraft            : Association to AIRCRAFT_MASTER on aircraft.type_code = aircraft_type;
        aircraft_type       : String(10);               // FK to AIRCRAFT_MASTER.type_code
        aircraft_reg        : String(10);               // Aircraft registration (e.g., RP-C1234)
        origin              : Association to MASTER_AIRPORTS on origin.iata_code = origin_airport;
        origin_airport      : String(3) @mandatory;     // Departure airport IATA
        destination         : Association to MASTER_AIRPORTS on destination.iata_code = destination_airport;
        destination_airport : String(3) @mandatory;     // Arrival airport IATA
        scheduled_departure : Time;                     // Scheduled departure time
        scheduled_arrival   : Time;                     // Scheduled arrival time
        status              : String(20) default 'SCHEDULED'; // SCHEDULED/DEPARTED/ARRIVED/CANCELLED
}

// ============================================================================
// FUEL ORDERS MODULE (FDD-04)
// ============================================================================

/**
 * Order Status Enumeration
 * Draft → Submitted → Confirmed → InProgress → Delivered → Cancelled
 */
type OrderStatus : String(20) enum {
    Draft       = 'Draft';
    Submitted   = 'Submitted';
    Confirmed   = 'Confirmed';
    InProgress  = 'InProgress';
    Delivered   = 'Delivered';
    Cancelled   = 'Cancelled';
}

/**
 * Order Priority Enumeration
 */
type OrderPriority : String(10) enum {
    Normal  = 'Normal';
    High    = 'High';
    Urgent  = 'Urgent';
}

/**
 * Delivery Status Enumeration
 */
type DeliveryStatus : String(20) enum {
    Pending   = 'Pending';
    Verified  = 'Verified';
    Posted    = 'Posted';
    Disputed  = 'Disputed';
}

/**
 * Ticket Status Enumeration
 */
type TicketStatus : String(20) enum {
    Open      = 'Open';
    Attached  = 'Attached';
    Verified  = 'Verified';
    Closed    = 'Closed';
}

/**
 * FUEL_ORDERS - Core Fuel Order Entity
 * Source: FuelSphere native
 * Volume: ~300,000/year
 *
 * Order Number Format: FO-{STATION}-{YYYYMMDD}-{SEQ}
 * Example: FO-MNL-20260117-001
 *
 * Innovative ePOD-triggered workflow:
 * - PO/GR created in S/4HANA only after ePOD digital signature capture
 */
entity FUEL_ORDERS : cuid, AuditTrail {
        order_number        : String(25) @mandatory;    // FO-{STATION}-{YYYYMMDD}-{SEQ}

        // Flight Reference (optional - may be created before flight assignment)
        flight              : Association to FLIGHT_SCHEDULE;

        // Station (Delivery Location)
        airport             : Association to MASTER_AIRPORTS;
        station_code        : String(3) @mandatory;     // IATA code for quick reference

        // Supplier & Contract
        supplier            : Association to MASTER_SUPPLIERS;
        contract            : Association to MASTER_CONTRACTS;

        // Product
        product             : Association to MASTER_PRODUCTS;
        uom                 : Association to UNIT_OF_MEASURE on uom.uom_code = uom_code;
        uom_code            : String(3) default 'KG';   // Default to KG

        // Quantity & Pricing
        ordered_quantity    : Decimal(12,2) @mandatory; // Ordered fuel quantity (kg)
        unit_price          : Decimal(15,4);            // Unit price from CPE
        total_amount        : Decimal(15,2);            // Total order amount
        currency_code       : String(3) default 'USD';  // ISO currency code

        // Timing
        requested_date      : Date @mandatory;          // Requested delivery date
        requested_time      : Time;                     // Requested delivery time

        // Priority & Status
        priority            : OrderPriority default 'Normal';
        status              : OrderStatus default 'Draft';

        // S/4HANA References (populated after ePOD)
        s4_po_number        : String(10);               // S/4HANA Purchase Order Number
        s4_po_item          : String(5);                // PO Line Item

        // Notes & Comments
        notes               : String(1000);             // Order notes/special instructions

        // Cancellation
        cancelled_reason    : String(500);              // Reason for cancellation
        cancelled_by        : String(100);              // User who cancelled
        cancelled_at        : DateTime;                 // Cancellation timestamp

        // Composition: One order can have multiple deliveries and tickets
        deliveries          : Composition of many FUEL_DELIVERIES on deliveries.order = $self;
        tickets             : Composition of many FUEL_TICKETS on tickets.order = $self;
}

/**
 * FUEL_DELIVERIES - ePOD (Electronic Proof of Delivery) Records
 * Source: FuelSphere native
 * Volume: ~300,000/year
 *
 * Delivery Number Format: EPD-{STATION}-{YYYYMMDD}-{SEQ}
 * Example: EPD-MNL-20260117-001
 *
 * Key Feature: Dual digital signatures (pilot + ground crew) trigger
 * automatic PO/GR creation in S/4HANA
 */
entity FUEL_DELIVERIES : cuid, AuditTrail {
        order               : Association to FUEL_ORDERS @mandatory;
        delivery_number     : String(25) @mandatory;    // EPD-{STATION}-{YYYYMMDD}-{SEQ}

        // Delivery Details
        delivery_date       : Date @mandatory;          // Actual delivery date
        delivery_time       : Time @mandatory;          // Actual delivery time
        delivered_quantity  : Decimal(12,2) @mandatory; // Actual delivered quantity (kg)

        // Quality Measurements (FDD-05 validation rules)
        @assert.range: [-40, 50]  // VAL-EPD-003: Must be between -40°C and +50°C
        temperature         : Decimal(5,2);             // Fuel temperature (°C)
        @assert.range: [0.775, 0.840]  // VAL-EPD-004: Jet fuel density range (kg/L)
        density             : Decimal(8,4);             // Measured density (kg/L)
        temperature_corrected_qty : Decimal(12,2);      // Temperature-corrected quantity (to 15°C ref)

        // Delivery Vehicle & Personnel
        vehicle_id          : String(20);               // Delivery vehicle ID
        driver_name         : String(100);              // Driver name

        // Digital Signatures (stored as base64 or reference to Object Store)
        pilot_signature     : LargeBinary;              // Pilot signature image
        pilot_name          : String(100);              // Pilot name
        ground_crew_signature : LargeBinary;            // Ground crew signature image
        ground_crew_name    : String(100);              // Ground crew name
        signature_timestamp : Timestamp;                // Signature capture time
        signature_location  : String(100);              // GPS coordinates or location

        // S/4HANA References (populated after signature)
        s4_gr_number        : String(10);               // S/4HANA Material Document Number
        s4_gr_year          : String(4);                // Material Document Year
        s4_gr_item          : String(4);                // Material Document Item

        // Status & Variance
        status              : DeliveryStatus default 'Pending';
        quantity_variance   : Decimal(12,2);            // Difference from ordered qty
        variance_percentage : Decimal(5,2);             // Variance as percentage
        variance_flag       : Boolean default false;    // True if variance > 5%
        variance_reason     : String(500);              // Explanation for variance
}

/**
 * FUEL_TICKETS - Individual Fuel Tickets
 * Source: FuelSphere native
 * Volume: ~350,000/year
 *
 * Ticket Number Format: FT-{STATION}-{YYYYMMDD}-{SEQ}
 * Example: FT-MNL-20260117-001
 *
 * Multiple tickets may be associated with a single order/delivery
 */
entity FUEL_TICKETS : cuid, AuditTrail {
        order               : Association to FUEL_ORDERS @mandatory;
        delivery            : Association to FUEL_DELIVERIES;  // Optional link to specific delivery

        ticket_number       : String(50) @mandatory;    // Physical ticket number from supplier
        internal_number     : String(25);               // FT-{STATION}-{YYYYMMDD}-{SEQ}

        // Flight Reference
        aircraft_reg        : String(10);               // Aircraft registration
        flight_number       : String(10);               // Flight number

        // Quantity
        quantity            : Decimal(15,2) @mandatory; // Quantity on ticket (kg)
        uom_code            : String(3) default 'KG';   // Unit of measure

        // Timing
        delivery_timestamp  : DateTime @mandatory;      // Delivery date/time from ticket

        // Supplier Reference
        supplier_ticket_ref : String(50);               // Supplier's ticket reference

        // Status
        status              : TicketStatus default 'Open';

        // Verification
        verified_by         : String(100);              // User who verified
        verified_at         : DateTime;                 // Verification timestamp
}

// ============================================================================
// AUDIT LOG (For Compliance - HLD Section 8)
// ============================================================================

/**
 * AUDIT_LOG - System Audit Trail
 * Retention: 7-10 years per PERSONA_AUTHORIZATION_MATRIX
 */
entity AUDIT_LOG : cuid {
        entity_name     : String(100) @mandatory; // Entity that was modified
        entity_key      : String(255) @mandatory; // Primary key value
        action          : String(20) @mandatory;  // CREATE / UPDATE / DELETE
        changed_by      : String(255);            // User who made change
        changed_at      : DateTime @cds.on.insert: $now;
        old_values      : LargeString;            // JSON of old values
        new_values      : LargeString;            // JSON of new values
        ip_address      : String(50);             // Client IP
        user_agent      : String(500);            // Browser/client info
}

// ============================================================================
// ANNUAL PLANNING & FORECASTING MODULE (FDD-02)
// Strategic planning backbone for demand forecasting and budget management
// ============================================================================

/**
 * Planning Version Type Enumeration
 */
type PlanningVersionType : String(20) enum {
    Budget      = 'BUDGET';
    Forecast    = 'FORECAST';
    Scenario    = 'SCENARIO';
}

/**
 * Planning Version Status Enumeration
 * Draft → In Review → Approved → Locked
 */
type PlanningVersionStatus : String(20) enum {
    Draft       = 'DRAFT';
    InReview    = 'IN_REVIEW';
    Approved    = 'APPROVED';
    Locked      = 'LOCKED';
}

/**
 * SAC Writeback Status Enumeration
 */
type SACWritebackStatus : String(20) enum {
    Pending     = 'PENDING';
    Success     = 'SUCCESS';
    Failed      = 'FAILED';
}

/**
 * Planning Period Granularity
 */
type PlanningPeriod : String(10) enum {
    Monthly     = 'MONTHLY';
    Quarterly   = 'QUARTERLY';
}

/**
 * Price Source Enumeration
 */
type PriceSource : String(20) enum {
    Derived     = 'DERIVED';    // From Contracts/CPE module
    Manual      = 'MANUAL';     // Manual entry
    Contract    = 'CONTRACT';   // From contract fixed price
}

/**
 * Demand Calculation Method Enumeration
 */
type DemandCalculationMethod : String(20) enum {
    Standard    = 'STANDARD';   // Route-Aircraft Matrix
    Historical  = 'HISTORICAL'; // Historical variance analysis
    Manual      = 'MANUAL';     // Manual override
}

/**
 * PLANNING_VERSION - Budget/Forecast Version Header
 * Source: FuelSphere native
 * Volume: ~50/year
 *
 * Version ID Format: PV-{TYPE}-{FISCAL_YEAR}-{SEQ}
 * Example: PV-BUDGET-2026-001
 *
 * Key Capability: SAP Analytics Cloud (SAC) writeback for financial planning
 */
entity PLANNING_VERSION : cuid, AuditTrail {
        version_id          : String(20) @mandatory;      // PV-{TYPE}-{YEAR}-{SEQ}
        version_name        : String(100) @mandatory;     // Display name
        version_type        : PlanningVersionType @mandatory; // BUDGET / FORECAST / SCENARIO
        fiscal_year         : String(4) @mandatory;       // Fiscal year (e.g., 2026)
        planning_period     : PlanningPeriod default 'MONTHLY'; // MONTHLY / QUARTERLY
        status              : PlanningVersionStatus default 'DRAFT';
        description         : String(500);                // Version description

        // Flight Schedule Reference (optional)
        based_on_schedule   : Association to FLIGHT_SCHEDULE;  // Source schedule for calculations

        // Approval Workflow
        approved_by         : String(255);                // Approver user ID
        approved_at         : Timestamp;                  // Approval timestamp

        // SAC Integration
        sac_writeback_status : SACWritebackStatus default 'PENDING';
        sac_model_id        : String(100);                // SAC model identifier
        sac_writeback_at    : Timestamp;                  // Last writeback timestamp

        // Compositions
        lines               : Composition of many PLANNING_LINE on lines.version = $self;
        calculations        : Composition of many DEMAND_CALCULATION on calculations.version = $self;
}

/**
 * PLANNING_LINE - Detailed Planning Data by Period and Station
 * Source: FuelSphere native
 * Volume: ~500,000/year
 *
 * Contains calculated fuel demand, price assumptions, and projected costs
 * by period (month/quarter) and station (airport).
 */
entity PLANNING_LINE : cuid {
        version             : Association to PLANNING_VERSION @mandatory;
        airport             : Association to MASTER_AIRPORTS @mandatory;
        period              : String(10) @mandatory;      // Period (e.g., 2026-01, 2026-Q1)

        // Planned Volume
        planned_volume      : Decimal(15,2) @mandatory;   // Planned fuel volume (kg)
        uom_code            : String(3) default 'KG';     // Unit of measure

        // Pricing
        planned_price       : Decimal(15,4) @mandatory;   // Price assumption per unit
        planned_cost        : Decimal(18,2) @mandatory;   // Calculated fuel cost
        currency            : Association to CURRENCY_MASTER on currency.currency_code = currency_code;
        currency_code       : String(3) @mandatory;       // Currency code
        price_source        : PriceSource default 'DERIVED'; // DERIVED / MANUAL / CONTRACT

        // Flight Statistics
        flight_count        : Integer default 0;          // Number of flights in period

        // Variance (vs. prior year)
        prior_year_volume   : Decimal(15,2);              // Prior year volume (kg)
        prior_year_cost     : Decimal(18,2);              // Prior year cost
        volume_variance_pct : Decimal(5,2);               // Volume variance %
        cost_variance_pct   : Decimal(5,2);               // Cost variance %

        // Notes
        notes               : String(500);                // Line-level notes
}

/**
 * ROUTE_AIRCRAFT_MATRIX - Standard Fuel Consumption by Route/Aircraft
 * Source: FuelSphere native
 * Volume: ~5,000 records
 *
 * Fuel Requirement Calculation Formula (per FDD-02):
 * Total Fuel Required = Trip Fuel + Taxi Fuel + Contingency + Alternate + Reserve + Extra
 *
 * Used for demand calculations based on flight schedules.
 */
entity ROUTE_AIRCRAFT_MATRIX : cuid, ActiveStatus, AuditTrail {
        route               : Association to ROUTE_MASTER @mandatory;
        aircraft_type       : Association to AIRCRAFT_MASTER @mandatory;

        // Fuel Components (all in kg)
        trip_fuel           : Decimal(12,2) @mandatory;   // Trip fuel requirement
        taxi_fuel           : Decimal(10,2) default 0;    // Taxi fuel (ground operations)
        contingency_fuel    : Decimal(10,2) default 0;    // Contingency (typically 5% of trip)
        alternate_fuel      : Decimal(10,2);              // Fuel to alternate airport
        reserve_fuel        : Decimal(10,2) default 0;    // Final reserve (30-45 min holding)
        extra_fuel          : Decimal(10,2) default 0;    // Extra/discretionary fuel

        // Calculated Total
        total_standard_fuel : Decimal(12,2) @mandatory;   // Total calculated fuel (kg)

        // Seasonal Adjustments
        summer_factor       : Decimal(5,4) default 1.0000; // Summer adjustment factor
        winter_factor       : Decimal(5,4) default 1.0000; // Winter adjustment factor

        // Validity Period
        effective_from      : Date @mandatory;            // Validity start date
        effective_to        : Date;                       // Validity end date (NULL = open-ended)

        // Source & Notes
        data_source         : String(50);                 // OPERATIONAL / MANUFACTURER / CALCULATED
        notes               : String(500);                // Notes on fuel requirements
}

/**
 * DEMAND_CALCULATION - Calculated Fuel Demand Results
 * Source: FuelSphere native
 * Volume: ~1,000,000/year
 *
 * Stores calculated fuel demand per flight/route based on
 * Route-Aircraft Matrix and flight schedule.
 */
entity DEMAND_CALCULATION : cuid {
        version             : Association to PLANNING_VERSION @mandatory;
        flight_schedule     : Association to FLIGHT_SCHEDULE;    // Source flight
        route               : Association to ROUTE_MASTER @mandatory;
        aircraft_type       : Association to AIRCRAFT_MASTER @mandatory;

        // Calculated Demand
        calculated_demand   : Decimal(15,2) @mandatory;   // Calculated fuel demand (kg)
        uom_code            : String(3) default 'KG';     // Unit of measure

        // Calculation Details
        calculation_method  : DemandCalculationMethod @mandatory; // STANDARD / HISTORICAL / MANUAL
        matrix_used         : Association to ROUTE_AIRCRAFT_MATRIX; // Matrix used for calculation
        seasonal_factor     : Decimal(5,4) default 1.0000; // Seasonal adjustment applied
        adjustment_factor   : Decimal(5,4) default 1.0000; // Manual adjustment factor

        // Historical Reference
        historical_avg      : Decimal(15,2);              // Historical average demand
        historical_variance : Decimal(5,2);               // Variance from historical

        // Timing
        calculation_date    : Date @mandatory;            // Date for which demand is calculated
        calculated_at       : Timestamp @cds.on.insert: $now; // Calculation timestamp

        // Notes
        notes               : String(500);                // Calculation notes
}

/**
 * PRICE_ASSUMPTION - Price Forecasts by Station/Period
 * Source: FuelSphere native
 * Volume: ~50,000/year
 *
 * Stores price assumptions for planning from Contracts/CPE module
 * or manual entry for scenario analysis.
 */
entity PRICE_ASSUMPTION : cuid, AuditTrail {
        version             : Association to PLANNING_VERSION @mandatory;
        airport             : Association to MASTER_AIRPORTS @mandatory;
        product             : Association to MASTER_PRODUCTS @mandatory;
        period              : String(10) @mandatory;      // Period (e.g., 2026-01)

        // Price Assumptions
        unit_price          : Decimal(15,4) @mandatory;   // Assumed unit price
        currency            : Association to CURRENCY_MASTER on currency.currency_code = currency_code;
        currency_code       : String(3) @mandatory;       // Currency code
        uom_code            : String(3) default 'KG';     // Unit of measure

        // Source
        price_source        : PriceSource @mandatory;     // DERIVED / MANUAL / CONTRACT
        source_contract     : Association to MASTER_CONTRACTS; // Source contract (if applicable)
        source_formula      : Association to PRICING_FORMULA;  // Source formula (if derived)

        // Index Reference (if derived)
        base_index          : Association to MARKET_INDEX;     // Base index used
        index_value         : Decimal(15,4);              // Index value used
        index_date          : Date;                       // Index effective date

        // Effective Period
        effective_from      : Date @mandatory;
        effective_to        : Date;

        // Notes
        notes               : String(500);                // Price assumption notes
}

/**
 * SCENARIO_COMPARISON - Version Comparison Analysis
 * Source: FuelSphere native
 * Volume: ~200/year
 *
 * Stores comparison results between planning versions
 * for scenario analysis and decision support.
 */
entity SCENARIO_COMPARISON : cuid, AuditTrail {
        comparison_name     : String(100) @mandatory;     // Comparison display name
        description         : String(500);                // Comparison description

        // Versions Being Compared
        base_version        : Association to PLANNING_VERSION @mandatory;    // Base/reference version
        compare_version     : Association to PLANNING_VERSION @mandatory;    // Version to compare

        // Summary Metrics
        total_volume_base   : Decimal(18,2);              // Total volume in base version
        total_volume_compare: Decimal(18,2);              // Total volume in compare version
        volume_variance     : Decimal(18,2);              // Volume difference
        volume_variance_pct : Decimal(5,2);               // Volume variance %

        total_cost_base     : Decimal(18,2);              // Total cost in base version
        total_cost_compare  : Decimal(18,2);              // Total cost in compare version
        cost_variance       : Decimal(18,2);              // Cost difference
        cost_variance_pct   : Decimal(5,2);               // Cost variance %

        currency_code       : String(3) @mandatory;       // Comparison currency

        // Analysis Results
        analysis_summary    : LargeString;                // JSON summary of analysis
        comparison_date     : Timestamp @cds.on.insert: $now; // Comparison timestamp
        compared_by         : String(255);                // User who ran comparison
}

// ============================================================================
// INVOICE VERIFICATION MODULE (FDD-06)
// Financial control hub with three-way matching and approval workflows
// ============================================================================

/**
 * Invoice Status Enumeration
 * Draft → Verified → Posted → Paid → Cancelled
 */
type InvoiceStatus : String(20) enum {
    Draft       = 'DRAFT';
    Verified    = 'VERIFIED';
    Posted      = 'POSTED';
    Paid        = 'PAID';
    Cancelled   = 'CANCELLED';
}

/**
 * Invoice Match Status Enumeration
 */
type InvoiceMatchStatus : String(20) enum {
    Unmatched       = 'UNMATCHED';
    Matched         = 'MATCHED';
    PartialMatch    = 'PARTIAL_MATCH';
    PriceVariance   = 'PRICE_VARIANCE';
    QuantityVariance = 'QTY_VARIANCE';
    Exception       = 'EXCEPTION';
}

/**
 * Invoice Approval Status Enumeration
 */
type InvoiceApprovalStatus : String(20) enum {
    Pending     = 'PENDING';
    Approved    = 'APPROVED';
    Rejected    = 'REJECTED';
    Escalated   = 'ESCALATED';
}

/**
 * Approval Action Type
 */
type ApprovalAction : String(20) enum {
    Submit      = 'SUBMIT';
    Approve     = 'APPROVE';
    Reject      = 'REJECT';
    Escalate    = 'ESCALATE';
    Return      = 'RETURN';
}

/**
 * Tolerance Type Enumeration
 */
type ToleranceType : String(20) enum {
    Price       = 'PRICE';
    Quantity    = 'QUANTITY';
    Amount      = 'AMOUNT';
    Date        = 'DATE';
}

/**
 * INVOICES - Supplier Invoice Header
 * Source: FuelSphere native + S/4HANA
 * Volume: ~50,000/year
 *
 * Invoice Number Format: INV-{SUPPLIER_CODE}-{YYYYMMDD}-{SEQ}
 * Example: INV-SHELL-20260117-001
 *
 * Key Features:
 * - Three-way matching: PO ↔ GR (ePOD) ↔ Invoice
 * - Configurable tolerance rules
 * - Dual approval workflow for exceptions
 * - S/4HANA FI posting on approval
 */
entity INVOICES : cuid, AuditTrail {
        invoice_number      : String(20) @mandatory;      // Supplier invoice number (unique per supplier)
        internal_number     : String(25);                 // INV-{SUPPLIER}-{DATE}-{SEQ}

        // Supplier
        supplier            : Association to MASTER_SUPPLIERS @mandatory;

        // Dates
        invoice_date        : Date @mandatory;            // Invoice date from supplier
        posting_date        : Date;                       // FI posting date
        due_date            : Date;                       // Payment due date
        baseline_date       : Date;                       // Baseline date for payment terms

        // Amounts
        currency            : Association to CURRENCY_MASTER on currency.currency_code = currency_code;
        currency_code       : String(3) @mandatory;       // Invoice currency
        net_amount          : Decimal(15,2) @mandatory;   // Net invoice amount
        tax_amount          : Decimal(15,2) default 0;    // Tax amount
        gross_amount        : Decimal(15,2) @mandatory;   // Gross amount (net + tax)

        // Payment Terms
        payment_terms       : String(20);                 // Payment terms (NET30, etc.)
        discount_percent    : Decimal(5,2);               // Early payment discount %
        discount_date       : Date;                       // Discount valid until

        // Three-Way Match Results
        match_status        : InvoiceMatchStatus default 'UNMATCHED';
        price_variance      : Decimal(15,2);              // Total price variance amount
        quantity_variance   : Decimal(12,2);              // Total quantity variance
        variance_percentage : Decimal(5,2);               // Overall variance %

        // Approval
        approval_status     : InvoiceApprovalStatus default 'PENDING';
        requires_dual_approval : Boolean default false;   // True if variance exceeds threshold
        first_approver      : String(255);                // First approver user ID
        first_approved_at   : Timestamp;                  // First approval timestamp
        final_approver      : String(255);                // Final approver user ID
        final_approved_at   : Timestamp;                  // Final approval timestamp

        // S/4HANA FI Reference
        s4_document_number  : String(10);                 // S/4HANA FI Document Number
        s4_fiscal_year      : String(4);                  // Fiscal year
        s4_company_code     : String(4);                  // Company code
        fi_posting_status   : String(20);                 // SUCCESS / FAILED / PENDING

        // Status & Notes
        status              : InvoiceStatus default 'DRAFT';
        notes               : String(1000);               // Invoice notes
        rejection_reason    : String(500);                // Reason if rejected

        // Duplicate Check
        is_duplicate        : Boolean default false;      // Duplicate flag
        duplicate_of        : Association to INVOICES;    // Link to original if duplicate

        // Compositions
        items               : Composition of many INVOICE_ITEMS on items.invoice = $self;
        matches             : Composition of many INVOICE_MATCHES on matches.invoice = $self;
        approvals           : Composition of many INVOICE_APPROVALS on approvals.invoice = $self;
}

/**
 * INVOICE_ITEMS - Invoice Line Items
 * Source: FuelSphere native
 * Volume: ~200,000/year
 *
 * Links to PO/GR for three-way matching
 */
entity INVOICE_ITEMS : cuid {
        invoice             : Association to INVOICES @mandatory;
        line_number         : Integer @mandatory;         // Line item number (10, 20, 30...)

        // Product
        product             : Association to MASTER_PRODUCTS;
        description         : String(255);                // Line item description

        // PO Reference
        po_number           : String(10);                 // Purchase Order reference
        po_item             : String(5);                  // PO line item number

        // Quantity
        quantity            : Decimal(12,3) @mandatory;   // Invoice quantity
        uom                 : Association to UNIT_OF_MEASURE on uom.uom_code = uom_code;
        uom_code            : String(3) @mandatory;       // Unit of measure

        // Pricing
        unit_price          : Decimal(15,4) @mandatory;   // Price per unit
        net_amount          : Decimal(15,2) @mandatory;   // Line net amount
        tax_code            : String(2);                  // Tax code
        tax_amount          : Decimal(15,2) default 0;    // Line tax amount

        // Delivery Reference (for three-way match)
        delivery            : Association to FUEL_DELIVERIES;  // Linked ePOD/GR
        fuel_order          : Association to FUEL_ORDERS;      // Linked fuel order

        // Cost Assignment
        cost_center         : String(10);                 // Cost center
        gl_account          : String(10);                 // G/L account

        // Match Status (per line)
        line_match_status   : InvoiceMatchStatus default 'UNMATCHED';
        price_variance_pct  : Decimal(5,2);               // Price variance %
        qty_variance_pct    : Decimal(5,2);               // Quantity variance %
}

/**
 * INVOICE_MATCHES - Three-Way Match Results
 * Source: FuelSphere native
 * Volume: ~200,000/year
 *
 * Stores detailed match results linking PO, GR (ePOD), and Invoice
 */
entity INVOICE_MATCHES : cuid {
        invoice             : Association to INVOICES @mandatory;
        invoice_item        : Association to INVOICE_ITEMS @mandatory;

        // PO Data (from S/4HANA)
        po_number           : String(10) @mandatory;      // Purchase Order number
        po_item             : String(5);                  // PO line item
        po_quantity         : Decimal(12,3);              // PO ordered quantity
        po_price            : Decimal(15,4);              // PO unit price
        po_amount           : Decimal(15,2);              // PO line amount

        // GR Data (from ePOD/S/4HANA)
        gr_number           : String(10);                 // Goods Receipt document number
        gr_year             : String(4);                  // GR fiscal year
        gr_item             : String(4);                  // GR line item
        gr_quantity         : Decimal(12,3);              // GR received quantity
        gr_date             : Date;                       // GR posting date

        // Invoice Data (snapshot)
        inv_quantity        : Decimal(12,3) @mandatory;   // Invoice quantity
        inv_price           : Decimal(15,4) @mandatory;   // Invoice unit price
        inv_amount          : Decimal(15,2) @mandatory;   // Invoice line amount

        // Variance Calculations
        quantity_variance   : Decimal(12,3);              // Qty difference (Invoice - GR)
        quantity_variance_pct : Decimal(5,2);             // Qty variance %
        price_variance      : Decimal(15,4);              // Price difference (Invoice - PO)
        price_variance_pct  : Decimal(5,2);               // Price variance %
        amount_variance     : Decimal(15,2);              // Amount difference

        // Match Result
        match_status        : InvoiceMatchStatus @mandatory;
        match_date          : DateTime @cds.on.insert: $now; // When match was performed
        matched_by          : String(255);                // User/system who matched

        // Tolerance Reference
        tolerance_rule      : Association to TOLERANCE_RULES; // Tolerance rule applied
        within_tolerance    : Boolean default false;      // True if variance within tolerance

        // Notes
        match_notes         : String(500);                // Match notes/comments
}

/**
 * INVOICE_APPROVALS - Approval Workflow History
 * Source: FuelSphere native
 * Volume: ~60,000/year
 *
 * Complete audit trail of all approval actions
 */
entity INVOICE_APPROVALS : cuid {
        invoice             : Association to INVOICES @mandatory;

        // Approval Action
        sequence            : Integer @mandatory;         // Approval sequence (1, 2, ...)
        action              : ApprovalAction @mandatory;  // SUBMIT, APPROVE, REJECT, ESCALATE
        action_date         : DateTime @cds.on.insert: $now; // Action timestamp
        action_by           : String(255) @mandatory;     // User who performed action

        // Decision Details
        comments            : String(1000);               // Approver comments
        rejection_reason    : String(500);                // Reason if rejected

        // Value at Time of Action
        invoice_amount      : Decimal(15,2);              // Invoice amount at action time
        variance_amount     : Decimal(15,2);              // Variance amount at action time

        // Approval Limits
        approver_limit      : Decimal(15,2);              // Approver's value limit
        within_limit        : Boolean;                    // True if within approver's limit

        // Escalation
        escalated_to        : String(255);                // User escalated to (if applicable)
        escalation_reason   : String(500);                // Reason for escalation
}

/**
 * TOLERANCE_RULES - Variance Tolerance Configuration
 * Source: FuelSphere native (configuration)
 * Volume: ~50 records
 *
 * Configurable thresholds for price, quantity, and amount variances
 * by company code, supplier category, or product type
 */
entity TOLERANCE_RULES : cuid, ActiveStatus, AuditTrail {
        rule_code           : String(20) @mandatory;      // Rule identifier
        rule_name           : String(100) @mandatory;     // Display name
        description         : String(500);                // Rule description

        // Scope
        company_code        : String(4);                  // Company code (NULL = all)
        supplier_category   : String(20);                 // Supplier category (NULL = all)
        product_type        : String(20);                 // Product type (NULL = all)

        // Tolerance Type & Values
        tolerance_type      : ToleranceType @mandatory;   // PRICE / QUANTITY / AMOUNT / DATE
        lower_limit         : Decimal(10,4);              // Lower tolerance (negative variance)
        upper_limit         : Decimal(10,4);              // Upper tolerance (positive variance)
        is_percentage       : Boolean default true;       // True = %, False = absolute value
        currency_code       : String(3);                  // Currency (if absolute amount)

        // Blocking Behavior
        block_on_exceed     : Boolean default true;       // Block invoice if exceeded
        require_dual_approval : Boolean default true;     // Require dual approval if exceeded

        // Priority
        priority            : Integer default 100;        // Rule priority (lower = higher priority)

        // Validity
        valid_from          : Date @mandatory;
        valid_to            : Date;
}

/**
 * GR_IR_CLEARING - Goods Receipt / Invoice Receipt Clearing
 * Source: FuelSphere native + S/4HANA
 * Volume: ~50,000/year
 *
 * Tracks GR/IR clearing entries for account reconciliation
 */
entity GR_IR_CLEARING : cuid, AuditTrail {
        // References
        invoice             : Association to INVOICES @mandatory;
        invoice_item        : Association to INVOICE_ITEMS;
        delivery            : Association to FUEL_DELIVERIES;

        // S/4HANA References
        gr_document         : String(10);                 // GR Material Document
        gr_year             : String(4);                  // GR Fiscal Year
        ir_document         : String(10);                 // Invoice Document
        ir_year             : String(4);                  // Invoice Fiscal Year
        clearing_document   : String(10);                 // Clearing Document
        clearing_year       : String(4);                  // Clearing Fiscal Year

        // Amounts
        gr_amount           : Decimal(15,2);              // GR posted amount
        ir_amount           : Decimal(15,2);              // IR posted amount
        clearing_amount     : Decimal(15,2);              // Cleared amount
        difference_amount   : Decimal(15,2);              // Uncleared difference
        currency_code       : String(3) @mandatory;       // Currency

        // G/L Account
        gr_ir_account       : String(10);                 // GR/IR clearing account

        // Status
        clearing_status     : String(20) @mandatory;      // OPEN / CLEARED / PARTIAL
        clearing_date       : Date;                       // Clearing date
        cleared_by          : String(255);                // User who cleared
}

// ============================================================================
// EMBARGO & COMPLIANCE MODULE (FDD-07)
// Regulatory control center for sanctions screening and compliance
// ============================================================================

/**
 * Entity Type Enumeration for Sanctions
 */
type SanctionedEntityType : String(20) enum {
    Individual      = 'INDIVIDUAL';
    Organization    = 'ORGANIZATION';
    Vessel          = 'VESSEL';
    Aircraft        = 'AIRCRAFT';
}

/**
 * Compliance Check Result Enumeration
 */
type ComplianceCheckResult : String(20) enum {
    Pass            = 'PASS';
    Block           = 'BLOCK';
    Review          = 'REVIEW';
}

/**
 * Compliance Check Type Enumeration
 */
type ComplianceCheckType : String(20) enum {
    Country         = 'COUNTRY';
    Supplier        = 'SUPPLIER';
    Combined        = 'COMBINED';
}

/**
 * Compliance Exception Status Enumeration
 */
type ComplianceExceptionStatus : String(20) enum {
    Pending         = 'PENDING';
    Approved        = 'APPROVED';
    Rejected        = 'REJECTED';
    Expired         = 'EXPIRED';
}

/**
 * Sanction Jurisdiction Enumeration
 */
type SanctionJurisdiction : String(10) enum {
    US              = 'US';       // OFAC
    EU              = 'EU';       // European Union
    UN              = 'UN';       // United Nations
    UK              = 'UK';       // UK OFSI
}

/**
 * SANCTION_LISTS - Sanction List Definitions
 * Source: FuelSphere native (manually imported)
 * Volume: ~10 records
 *
 * Defines available sanction lists with version control
 * Lists: OFAC SDN, OFAC Consolidated, EU CFT, UN SC, UK OFSI
 */
entity SANCTION_LISTS : cuid, ActiveStatus, AuditTrail {
        list_code           : String(20) @mandatory;      // OFAC_SDN, EU_CFT, UN_SC, UK_OFSI
        list_name           : String(100) @mandatory;     // Full sanction list name
        jurisdiction        : SanctionJurisdiction @mandatory; // US, EU, UN, UK
        description         : String(500);                // List description
        last_update         : DateTime @mandatory;        // Last list update timestamp
        version             : String(20) @mandatory;      // List version identifier
        source_url          : String(500);                // Official source URL
        update_frequency    : String(20);                 // DAILY, WEEKLY, MONTHLY
        entity_count        : Integer default 0;          // Number of entities in list

        // Compositions
        entities            : Composition of many SANCTIONED_ENTITIES on entities.sanction_list = $self;
}

/**
 * SANCTIONED_ENTITIES - Entities on Sanction Lists
 * Source: FuelSphere native (imported from authoritative sources)
 * Volume: ~5,000 records
 *
 * Individual persons, organizations, vessels, or aircraft on sanction lists
 */
entity SANCTIONED_ENTITIES : cuid, ActiveStatus {
        sanction_list       : Association to SANCTION_LISTS @mandatory;
        entity_name         : String(200) @mandatory;     // Primary entity name
        entity_type         : SanctionedEntityType @mandatory; // INDIVIDUAL, ORGANIZATION, VESSEL, AIRCRAFT
        aliases             : String(1000);               // Alternate names (semicolon-separated)
        country             : Association to T005_COUNTRY; // Associated country
        identifiers         : String(500);                // ID numbers (passport, tax ID, vessel IMO, etc.)
        listing_date        : Date @mandatory;            // Date added to sanction list
        delisting_date      : Date;                       // Date removed (if applicable)
        remarks             : String(2000);               // Additional details from sanction list
        program             : String(100);                // Specific sanction program
        source_reference    : String(100);                // Reference in source list
}

/**
 * COMPLIANCE_CHECKS - Compliance Screening Transactions
 * Source: FuelSphere native
 * Volume: ~500,000/year
 *
 * Records every compliance screening performed during transaction processing
 * Triggered by: Fuel Order creation (FDD-04), ePOD capture (FDD-05), Invoice entry (FDD-06)
 */
entity COMPLIANCE_CHECKS : cuid {
        check_timestamp     : DateTime @cds.on.insert: $now; // When check was performed
        source_module       : String(20) @mandatory;      // FDD-04, FDD-05, FDD-06
        source_entity_type  : String(50) @mandatory;      // FUEL_ORDER, FUEL_DELIVERY, INVOICE
        source_entity_id    : UUID @mandatory;            // Source transaction ID

        // Screening Subjects
        check_type          : ComplianceCheckType @mandatory; // COUNTRY, SUPPLIER, COMBINED
        screened_country    : Association to T005_COUNTRY;    // Country screened
        screened_supplier   : Association to MASTER_SUPPLIERS; // Supplier screened
        screened_value      : String(200);                // Additional screened value (aircraft reg, etc.)

        // Match Results
        match_found         : Boolean default false;      // True if potential match found
        match_score         : Decimal(5,2);               // Match confidence (0-100)
        matched_entity      : Association to SANCTIONED_ENTITIES; // Matched sanction entity (if any)
        matched_list        : Association to SANCTION_LISTS;      // Sanction list matched against

        // Decision
        result              : ComplianceCheckResult @mandatory; // PASS, BLOCK, REVIEW
        block_reason        : String(500);                // Reason for block (if applicable)
        auto_decision       : Boolean default true;       // True if system decided, false if manual

        // Audit
        performed_by        : String(100) @mandatory;     // User or 'SYSTEM'
        reviewed_by         : String(100);                // Reviewer (if manual review)
        reviewed_at         : DateTime;                   // Review timestamp

        // Hash for tamper-evidence
        check_hash          : String(64);                 // SHA-256 hash of check record
}

/**
 * COMPLIANCE_EXCEPTIONS - Approved Exceptions to Compliance Blocks
 * Source: FuelSphere native
 * Volume: ~1,000/year
 *
 * Time-limited exceptions granted for blocked transactions with business justification
 * Requires dual approval: Compliance Officer + Legal Counsel (for sanctions)
 */
entity COMPLIANCE_EXCEPTIONS : cuid, AuditTrail {
        exception_number    : String(20) @mandatory;      // EXC-{YYYY}-{SEQ}
        compliance_check    : Association to COMPLIANCE_CHECKS @mandatory; // Original blocking check

        // Request Details
        requested_by        : String(100) @mandatory;     // User requesting exception
        request_date        : DateTime @cds.on.insert: $now; // Request timestamp
        @assert.range: true
        justification       : String(2000) @mandatory;    // Business justification (min 50 chars per FDD)

        // Exception Scope
        exception_type      : String(20) @mandatory;      // COUNTRY, SUPPLIER, TRANSACTION
        applies_to_country  : Association to T005_COUNTRY;    // Country exception applies to
        applies_to_supplier : Association to MASTER_SUPPLIERS; // Supplier exception applies to
        single_use          : Boolean default false;      // True = one-time use only

        // Approval Workflow
        status              : ComplianceExceptionStatus default 'PENDING';

        // First-level: Compliance Officer
        approved_by         : String(100);                // Compliance Officer approver
        approved_at         : DateTime;                   // First approval timestamp
        approver_comments   : String(1000);               // Approver comments

        // Second-level: Legal Counsel (required for sanctions exceptions)
        legal_approval_required : Boolean default false;  // True if sanctions-related
        legal_approved_by   : String(100);                // Legal Counsel approver
        legal_approved_at   : DateTime;                   // Legal approval timestamp
        legal_comments      : String(1000);               // Legal comments

        // Rejection
        rejected_by         : String(100);                // User who rejected
        rejected_at         : DateTime;                   // Rejection timestamp
        rejection_reason    : String(500);                // Reason for rejection

        // Validity
        effective_from      : Date;                       // Exception start date
        expiry_date         : Date;                       // Exception expiry (max 12 months per FDD)
        conditions          : String(1000);               // Conditions attached to exception

        // Usage Tracking
        usage_count         : Integer default 0;          // Number of times exception used
        last_used_at        : DateTime;                   // Last usage timestamp
}

/**
 * COMPLIANCE_AUDIT_LOGS - Tamper-Evident Audit Trail
 * Source: FuelSphere native
 * Volume: ~2,000,000/year
 * Retention: 7 years
 *
 * Immutable audit log for all compliance-related actions
 * Uses cryptographic hash chain for tamper detection
 */
entity COMPLIANCE_AUDIT_LOGS : cuid {
        log_timestamp       : DateTime @cds.on.insert: $now; // Log entry timestamp
        log_sequence        : Integer @mandatory;         // Sequential log number (for hash chain)

        // Action Details
        action_type         : String(30) @mandatory;      // CHECK, EXCEPTION_REQUEST, APPROVAL, REJECTION, LIST_UPDATE
        action_description  : String(500) @mandatory;     // Human-readable description
        user_id             : String(100) @mandatory;     // User who performed action
        user_role           : String(50);                 // User's role at time of action

        // Related Entities
        related_check_id    : UUID;                       // Related compliance check
        related_exception_id : UUID;                      // Related exception
        related_list_id     : UUID;                       // Related sanction list

        // Data Snapshot
        old_values          : LargeString;                // JSON of values before change
        new_values          : LargeString;                // JSON of values after change

        // Tamper Evidence (SOX-CMP-003)
        previous_hash       : String(64);                 // Hash of previous log entry
        current_hash        : String(64) @mandatory;      // SHA-256 hash of this entry
        hash_verified       : Boolean;                    // True if hash chain intact

        // Client Info
        ip_address          : String(50);                 // Client IP address
        user_agent          : String(500);                // Browser/client info
}

// ============================================================================
// FUEL BURN & ROB TRACKING MODULE (FDD-08)
// Real-time fuel consumption tracking and ROB ledger management
// Formula: ROB_current = ROB_previous + Uplift - Burn + Adjustment
// ============================================================================

/**
 * Fuel Burn Data Source Enumeration
 * Priority: ACARS > JEFFERSON > EFB > MANUAL
 */
type FuelBurnDataSource : String(20) enum {
    ACARS       = 'ACARS';       // Aircraft Communications Addressing and Reporting System
    Jefferson   = 'JEFFERSON';   // Jefferson fuel calculation system
    EFB         = 'EFB';         // Electronic Flight Bag
    Manual      = 'MANUAL';      // Manual entry
}

/**
 * Fuel Burn Status Enumeration
 */
type FuelBurnStatus : String(20) enum {
    Preliminary = 'PRELIMINARY'; // Pending confirmation
    Confirmed   = 'CONFIRMED';   // Confirmed and accounted
    Adjusted    = 'ADJUSTED';    // Manually adjusted
    Rejected    = 'REJECTED';    // Rejected/invalid
}

/**
 * ROB Ledger Entry Type
 */
type ROBEntryType : String(20) enum {
    Flight      = 'FLIGHT';      // Post-flight ROB update
    Uplift      = 'UPLIFT';      // Fuel uplift from ePOD
    Adjustment  = 'ADJUSTMENT';  // Manual adjustment
    Initial     = 'INITIAL';     // Initial load/setup
    Transfer    = 'TRANSFER';    // Inter-tank transfer (if applicable)
}

/**
 * Variance Status based on thresholds
 * 0-5%: Normal, 5-10%: Warning, 10-20%: Exception, >20%: Critical
 */
type VarianceStatus : String(20) enum {
    Normal      = 'NORMAL';      // 0% to ±5%
    Warning     = 'WARNING';     // >5% to ±10%
    Exception   = 'EXCEPTION';   // >10% to ±20%
    Critical    = 'CRITICAL';    // >20%
}

/**
 * FUEL_BURNS - Fuel Burn Records
 * Source: ACARS, EFB, Jefferson, Manual
 * Volume: ~500,000/year
 *
 * Records fuel consumption for each flight
 * Integrates with external systems: ACARS, EFB, Jefferson
 */
entity FUEL_BURNS : cuid, AuditTrail {
        // Flight & Aircraft Reference
        flight              : Association to FLIGHT_SCHEDULE;  // Associated flight
        aircraft            : Association to AIRCRAFT_MASTER @mandatory;
        tail_number         : String(10) @mandatory;      // Aircraft registration (denormalized)

        // Burn Date/Time
        burn_date           : Date @mandatory;            // Burn record date
        burn_time           : Time;                       // Burn record time
        block_off_time      : DateTime;                   // Block-off (departure) time
        block_on_time       : DateTime;                   // Block-on (arrival) time
        flight_duration_mins : Integer;                   // Flight duration in minutes

        // Route Information
        origin_airport      : Association to MASTER_AIRPORTS;
        destination_airport : Association to MASTER_AIRPORTS;

        // Fuel Quantities (all in kg)
        planned_burn_kg     : Decimal(12,2);              // Planned fuel burn from Jefferson
        actual_burn_kg      : Decimal(12,2) @mandatory;   // Actual fuel burn
        taxi_out_kg         : Decimal(10,2);              // Taxi-out fuel
        taxi_in_kg          : Decimal(10,2);              // Taxi-in fuel
        trip_fuel_kg        : Decimal(12,2);              // Trip fuel (cruise)

        // Variance Calculation
        variance_kg         : Decimal(12,2);              // Variance = actual - planned
        variance_pct        : Decimal(5,2);               // Variance percentage
        variance_status     : VarianceStatus;             // NORMAL, WARNING, EXCEPTION, CRITICAL

        // Data Source & Status
        data_source         : FuelBurnDataSource @mandatory; // ACARS, JEFFERSON, EFB, MANUAL
        source_message_id   : String(50);                 // External message ID (ACARS/EFB)
        status              : FuelBurnStatus default 'PRELIMINARY';

        // Confirmation
        confirmed_by        : String(100);                // User who confirmed
        confirmed_at        : DateTime;                   // Confirmation timestamp

        // Exception Handling
        requires_review     : Boolean default false;      // True if variance exceeds threshold
        review_notes        : String(1000);               // Review/investigation notes
        reviewed_by         : String(100);                // Reviewer
        reviewed_at         : DateTime;                   // Review timestamp

        // Finance Integration (FDD-10)
        finance_posted      : Boolean default false;      // True if posted to Finance
        finance_post_date   : DateTime;                   // Finance posting timestamp
}

/**
 * ROB_LEDGER - Remaining on Board Fuel Ledger
 * Source: FuelSphere native
 * Volume: ~1,000,000/year
 *
 * Per-aircraft fuel inventory tracking
 * Formula: closingROBKg = openingROBKg + upliftKg - burnKg + adjustmentKg
 */
entity ROB_LEDGER : cuid, AuditTrail {
        // Aircraft Reference
        aircraft            : Association to AIRCRAFT_MASTER @mandatory;
        tail_number         : String(10) @mandatory;      // Aircraft registration (denormalized)

        // Record Timestamp
        record_date         : Date @mandatory;            // Record date
        record_time         : Time @mandatory;            // Record time
        sequence            : Integer @mandatory;         // Sequence within day for ordering

        // Location
        airport             : Association to MASTER_AIRPORTS @mandatory;
        airport_code        : String(3) @mandatory;       // IATA code (denormalized)

        // Associated Records
        flight              : Association to FLIGHT_SCHEDULE; // Associated flight (if applicable)
        fuel_burn           : Association to FUEL_BURNS;      // Associated burn record
        fuel_delivery       : Association to FUEL_DELIVERIES; // Associated ePOD/uplift

        // Entry Type
        entry_type          : ROBEntryType @mandatory;    // FLIGHT, UPLIFT, ADJUSTMENT, INITIAL

        // ROB Calculation Components (all in kg)
        opening_rob_kg      : Decimal(12,2) @mandatory;   // Opening ROB (previous closing)
        uplift_kg           : Decimal(12,2) default 0;    // Fuel added (from ePOD)
        burn_kg             : Decimal(12,2) default 0;    // Fuel consumed
        adjustment_kg       : Decimal(12,2) default 0;    // Manual adjustment (+/-)
        @assert.range: [0, null]  // Closing ROB cannot be negative (FB402)
        closing_rob_kg      : Decimal(12,2) @mandatory;   // Closing ROB (calculated)

        // Fuel Capacity Reference
        max_capacity_kg     : Decimal(12,2);              // Aircraft max fuel capacity

        // Validation
        rob_percentage      : Decimal(5,2);               // ROB as % of capacity

        // Adjustment Details (if entry_type = ADJUSTMENT)
        adjustment_reason   : String(500);                // Reason for manual adjustment
        adjustment_approved_by : String(100);             // Approver (Ops Manager)
        adjustment_approved_at : DateTime;                // Approval timestamp

        // Data Quality
        data_source         : String(20);                 // Source of ROB data
        is_estimated        : Boolean default false;      // True if ROB is estimated
}

/**
 * FUEL_BURN_EXCEPTIONS - Variance Exception Queue
 * Source: FuelSphere native
 * Volume: ~10,000/year
 *
 * Tracks fuel burn variances requiring investigation
 */
entity FUEL_BURN_EXCEPTIONS : cuid, AuditTrail {
        fuel_burn           : Association to FUEL_BURNS @mandatory;
        aircraft            : Association to AIRCRAFT_MASTER @mandatory;
        tail_number         : String(10) @mandatory;

        // Exception Details
        exception_date      : Date @mandatory;
        variance_kg         : Decimal(12,2) @mandatory;
        variance_pct        : Decimal(5,2) @mandatory;
        variance_status     : VarianceStatus @mandatory;

        // Investigation
        status              : String(20) default 'OPEN'; // OPEN, INVESTIGATING, RESOLVED, CLOSED
        assigned_to         : String(100);               // Investigator
        assigned_at         : DateTime;

        // Resolution
        root_cause          : String(500);               // Identified root cause
        corrective_action   : String(500);               // Action taken
        resolved_by         : String(100);               // User who resolved
        resolved_at         : DateTime;                  // Resolution timestamp

        // Linked Issues
        maintenance_related : Boolean default false;     // True if maintenance issue
        maintenance_order   : String(20);                // Linked maintenance order number
}

// ============================================================================
// COST ALLOCATION MODULE (FDD-09)
// Flight-level fuel cost assignment and S/4HANA CO integration
// Formula: Flight Cost = (Qty x Unit Price) + Taxes + Into-Plane Fees + Surcharges
// ============================================================================

/**
 * Allocation Type Enumeration
 */
type AllocationType : String(20) enum {
    Actual      = 'ACTUAL';      // Actual cost from verified invoice
    Accrual     = 'ACCRUAL';     // Estimated cost for period-end
    Reversal    = 'REVERSAL';    // Accrual reversal on invoice receipt
    Standard    = 'STANDARD';    // Standard cost for budgeting
}

/**
 * Allocation Status Enumeration
 */
type AllocationStatus : String(20) enum {
    Draft       = 'DRAFT';       // Not yet posted
    Pending     = 'PENDING';     // Awaiting approval
    Posted      = 'POSTED';      // Posted to S/4HANA CO
    Reversed    = 'REVERSED';    // Reversed posting
    Failed      = 'FAILED';      // Posting failed
}

/**
 * Allocation Basis Enumeration
 */
type AllocationBasis : String(20) enum {
    Quantity    = 'QUANTITY';    // Allocate based on fuel quantity
    Amount      = 'AMOUNT';      // Allocate based on cost amount
    Percentage  = 'PERCENTAGE';  // Fixed percentage allocation
}

/**
 * Settlement Receiver Type
 */
type SettlementReceiverType : String(20) enum {
    CostCenter  = 'COST_CENTER';
    ProfitCenter = 'PROFIT_CENTER';
    InternalOrder = 'INTERNAL_ORDER';
    WBS         = 'WBS';         // Work Breakdown Structure element
}

/**
 * Allocation Run Status
 */
type AllocationRunStatus : String(20) enum {
    Scheduled   = 'SCHEDULED';
    Running     = 'RUNNING';
    Completed   = 'COMPLETED';
    Failed      = 'FAILED';
    Cancelled   = 'CANCELLED';
}

/**
 * FLIGHT_COSTS - Flight-Level Cost Breakdown
 * Source: FuelSphere native
 * Volume: ~200,000/year
 *
 * Calculates total fuel cost per flight with component breakdown
 * Formula: Total = Base Fuel + Taxes + Into-Plane Fees + Surcharges
 */
entity FLIGHT_COSTS : cuid, AuditTrail {
        // Flight & Delivery Reference
        flight              : Association to FLIGHT_SCHEDULE @mandatory;
        fuel_delivery       : Association to FUEL_DELIVERIES @mandatory;
        fuel_order          : Association to FUEL_ORDERS;
        invoice             : Association to INVOICES;

        // Cost Date
        cost_date           : Date @mandatory;            // Cost calculation date

        // Fuel Quantity
        fuel_quantity_kg    : Decimal(12,2) @mandatory;   // Fuel quantity in kg
        uom_code            : String(3) default 'KG';     // Unit of measure

        // Pricing
        unit_price          : Decimal(15,4) @mandatory;   // Price per unit
        contract            : Association to MASTER_CONTRACTS; // Source contract
        pricing_formula     : Association to PRICING_FORMULA;  // Pricing formula used

        // Cost Components
        base_fuel_cost      : Decimal(15,2) @mandatory;   // Base fuel cost (qty x price)
        tax_amount          : Decimal(15,2) default 0;    // Tax component
        into_plane_fees     : Decimal(15,2) default 0;    // Into-plane handling fees
        surcharge_amount    : Decimal(15,2) default 0;    // Surcharges (fuel, security, etc.)
        total_cost          : Decimal(15,2) @mandatory;   // Total flight fuel cost

        // Currency
        currency            : Association to CURRENCY_MASTER on currency.currency_code = currency_code;
        currency_code       : String(3) @mandatory;

        // Route Information (for profitability)
        origin_airport      : Association to MASTER_AIRPORTS;
        destination_airport : Association to MASTER_AIRPORTS;
        route               : Association to ROUTE_MASTER;

        // Variance (vs. planned)
        planned_cost        : Decimal(15,2);              // Planned/budgeted cost
        variance_amount     : Decimal(15,2);              // Variance (actual - planned)
        variance_pct        : Decimal(5,2);               // Variance percentage

        // Status
        is_allocated        : Boolean default false;      // True if allocated to CO
        allocation_date     : Date;                       // When allocated
}

/**
 * COST_ALLOCATIONS - Cost Allocation Records
 * Source: FuelSphere native + S/4HANA CO
 * Volume: ~500,000/year
 *
 * Records cost assignments to cost objects (cost center, profit center, internal order)
 * Posted to S/4HANA CO via Journal Entry API
 */
entity COST_ALLOCATIONS : cuid, AuditTrail {
        // Source Records
        flight              : Association to FLIGHT_SCHEDULE;
        flight_cost         : Association to FLIGHT_COSTS;
        invoice             : Association to INVOICES;
        fuel_delivery       : Association to FUEL_DELIVERIES;

        // Allocation Details
        allocation_date     : Date @mandatory;            // Allocation posting date
        period              : String(7) @mandatory;       // Fiscal period (YYYY-MM)
        company_code        : String(4) @mandatory;       // SAP Company Code

        // Cost Objects (S/4HANA CO)
        cost_center         : String(10);                 // S/4HANA Cost Center
        internal_order      : String(12);                 // S/4HANA Internal Order (Statistical)
        profit_center       : String(10);                 // S/4HANA Profit Center
        wbs_element         : String(24);                 // WBS Element (if applicable)

        // G/L Account
        gl_account          : String(10) @mandatory;      // G/L Account for posting

        // Amounts
        allocated_amount    : Decimal(15,2) @mandatory;   // Allocated cost amount
        currency            : Association to CURRENCY_MASTER on currency.currency_code = currency_code;
        currency_code       : String(3) @mandatory;

        // Allocation Type & Status
        allocation_type     : AllocationType @mandatory;  // ACTUAL, ACCRUAL, REVERSAL
        status              : AllocationStatus default 'DRAFT';

        // Allocation Rule Applied
        allocation_rule     : Association to ALLOCATION_RULES;

        // S/4HANA Posting Reference
        s4_document_number  : String(10);                 // FI Document Number
        s4_fiscal_year      : String(4);                  // Fiscal Year
        s4_posting_date     : Date;                       // S/4HANA Posting Date
        posting_error       : String(500);                // Error message if failed

        // Accrual Reference (for reversals)
        original_allocation : Association to COST_ALLOCATIONS; // Original accrual being reversed

        // Approval
        requires_approval   : Boolean default false;
        approved_by         : String(100);
        approved_at         : DateTime;

        // CO-PA Characteristics (for profitability analysis)
        copa_segment        : String(20);                 // Market segment
        copa_route          : String(20);                 // Route code
        copa_aircraft_type  : String(10);                 // Aircraft type
}

/**
 * ALLOCATION_RULES - Allocation Rule Configuration
 * Source: FuelSphere native
 * Volume: ~100 records
 *
 * Configures how costs are allocated to cost objects
 */
entity ALLOCATION_RULES : cuid, ActiveStatus, AuditTrail {
        rule_code           : String(20) @mandatory;      // Rule identifier
        rule_name           : String(100) @mandatory;     // Rule display name
        description         : String(500);                // Rule description

        // Scope
        company_code        : String(4) @mandatory;       // Company code scope

        // Allocation Basis
        allocation_basis    : AllocationBasis @mandatory; // QUANTITY, AMOUNT, PERCENTAGE
        percentage_value    : Decimal(5,2);               // If basis = PERCENTAGE

        // Settlement Receiver
        settlement_receiver : SettlementReceiverType @mandatory; // COST_CENTER, PROFIT_CENTER, etc.
        default_cost_center : String(10);                 // Default cost center
        default_profit_center : String(10);               // Default profit center
        default_internal_order : String(12);              // Default internal order

        // G/L Account
        gl_account          : String(10) @mandatory;      // G/L Account for posting

        // Validity
        effective_from      : Date @mandatory;
        effective_to        : Date;

        // Priority
        priority            : Integer default 100;        // Rule priority (lower = higher)
}

/**
 * ALLOCATION_RUNS - Allocation Batch Run Logs
 * Source: FuelSphere native
 * Volume: ~500/year
 *
 * Tracks execution of period-end allocation runs
 */
entity ALLOCATION_RUNS : cuid, AuditTrail {
        run_number          : String(20) @mandatory;      // RUN-{PERIOD}-{SEQ}
        run_name            : String(100);                // Run description

        // Run Scope
        company_code        : String(4) @mandatory;       // Company code
        period              : String(7) @mandatory;       // Fiscal period (YYYY-MM)
        run_type            : AllocationType @mandatory;  // ACTUAL, ACCRUAL, REVERSAL

        // Timing
        scheduled_date      : DateTime;                   // Scheduled execution time
        started_at          : DateTime;                   // Actual start time
        completed_at        : DateTime;                   // Completion time
        duration_seconds    : Integer;                    // Run duration

        // Status
        status              : AllocationRunStatus default 'SCHEDULED';
        error_message       : String(1000);               // Error details if failed

        // Statistics
        total_flights       : Integer default 0;          // Flights processed
        total_allocations   : Integer default 0;          // Allocations created
        total_amount        : Decimal(18,2) default 0;    // Total amount allocated
        currency_code       : String(3);                  // Summary currency
        failed_count        : Integer default 0;          // Failed allocations
        skipped_count       : Integer default 0;          // Skipped (already allocated)

        // Approval Workflow
        requires_approval   : Boolean default true;       // Needs Finance Controller approval
        approved_by         : String(100);
        approved_at         : DateTime;
        rejected_by         : String(100);
        rejected_at         : DateTime;
        rejection_reason    : String(500);

        // Initiator
        initiated_by        : String(100) @mandatory;     // User who started run
}

/**
 * COST_CENTER_MAPPING - Station to Cost Center Mapping
 * Source: FuelSphere native + S/4HANA
 * Volume: ~500 records
 *
 * Maps airports/stations to S/4HANA cost centers for allocation
 */
entity COST_CENTER_MAPPING : cuid, ActiveStatus, AuditTrail {
        // Station
        airport             : Association to MASTER_AIRPORTS @mandatory;
        airport_code        : String(3) @mandatory;       // IATA code (denormalized)

        // Company Code
        company_code        : String(4) @mandatory;       // SAP Company Code

        // Cost Objects
        cost_center         : String(10) @mandatory;      // S/4HANA Cost Center
        cost_center_name    : String(40);                 // Cost center description
        profit_center       : String(10);                 // S/4HANA Profit Center
        profit_center_name  : String(40);                 // Profit center description

        // Validity
        effective_from      : Date @mandatory;
        effective_to        : Date;

        // Priority
        priority            : Integer default 100;        // For overlapping mappings
}

/**
 * ACCRUAL_ENTRIES - Period-End Accrual Records
 * Source: FuelSphere native
 * Volume: ~10,000/year
 *
 * Tracks accrual entries for uninvoiced deliveries at period-end
 */
entity ACCRUAL_ENTRIES : cuid, AuditTrail {
        accrual_number      : String(20) @mandatory;      // ACC-{PERIOD}-{SEQ}

        // Period
        period              : String(7) @mandatory;       // Fiscal period (YYYY-MM)
        company_code        : String(4) @mandatory;

        // Source
        fuel_delivery       : Association to FUEL_DELIVERIES @mandatory;
        flight              : Association to FLIGHT_SCHEDULE;

        // Accrual Amount
        accrual_amount      : Decimal(15,2) @mandatory;   // Estimated cost
        currency_code       : String(3) @mandatory;

        // Basis for Estimate
        estimation_basis    : String(20) @mandatory;      // CONTRACT_PRICE, AVERAGE, LAST_PRICE
        reference_price     : Decimal(15,4);              // Price used for estimation

        // Status
        status              : String(20) default 'OPEN';  // OPEN, REVERSED, INVOICED
        allocation          : Association to COST_ALLOCATIONS; // Accrual allocation
        reversal_allocation : Association to COST_ALLOCATIONS; // Reversal allocation

        // Invoice Link (when received)
        invoice             : Association to INVOICES;
        invoice_date        : Date;
        actual_amount       : Decimal(15,2);              // Actual invoice amount
        variance_amount     : Decimal(15,2);              // Accrual vs. actual variance
}

// ============================================================================
// FDD-11: INTEGRATION MONITORING
// ============================================================================

/**
 * Integration Monitoring Types
 */
type IntegrationDirection : String(10) enum { INBOUND; OUTBOUND; BIDIRECTIONAL }
type IntegrationStatus : String(20) enum { SUCCESS; FAILURE; PARTIAL; TIMEOUT; PENDING; RETRYING }
type MessageSeverity : String(10) enum { INFO; WARNING; ERROR; CRITICAL }
type HealthStatus : String(15) enum { HEALTHY; DEGRADED; UNHEALTHY; UNKNOWN }
type AlertSeverity : String(10) enum { LOW; MEDIUM; HIGH; CRITICAL }
type RetryStatus : String(15) enum { PENDING; IN_PROGRESS; SUCCESS; FAILED; EXHAUSTED; CANCELLED }
type SyncDirection : String(10) enum { S4_TO_FS; FS_TO_S4; BIDIRECTIONAL }

/**
 * INTEGRATION_MESSAGES - API Request/Response Logs
 * Source: FuelSphere native
 * Volume: ~5,000,000/year
 *
 * Logs all API calls for monitoring, troubleshooting, and audit
 * INT001 - General info, INT4xx - Errors
 */
entity INTEGRATION_MESSAGES : cuid {
        // Message Identification
        correlation_id      : UUID @mandatory;               // Unique transaction correlation
        message_id          : String(50);                    // External message ID
        sequence_number     : Integer default 1;             // For multi-step transactions

        // Timing
        timestamp           : DateTime @mandatory;           // Message timestamp
        request_time        : DateTime;                      // Request sent time
        response_time       : DateTime;                      // Response received time
        duration_ms         : Integer;                       // Processing duration (milliseconds)

        // Integration Details
        integration_name    : String(50) @mandatory;         // e.g., S4_JOURNAL_ENTRY, ACARS_INGEST
        direction           : IntegrationDirection @mandatory;
        endpoint_url        : String(500);                   // Target endpoint
        http_method         : String(10);                    // GET, POST, PUT, DELETE, PATCH

        // Source/Target
        source_system       : String(30) @mandatory;         // FUELSPHERE, S4HANA, ACARS, etc.
        target_system       : String(30) @mandatory;
        company_code        : String(4);                     // If company-specific

        // Request/Response
        request_headers     : LargeString;                   // Request headers (sanitized)
        request_payload     : LargeString;                   // Request body (truncated/masked)
        response_headers    : LargeString;                   // Response headers
        response_payload    : LargeString;                   // Response body (truncated)
        payload_size_bytes  : Integer;                       // Payload size

        // Status
        http_status_code    : Integer;                       // HTTP response code
        status              : IntegrationStatus @mandatory;
        error_code          : String(20);                    // INT4xx error codes
        error_message       : String(1000);                  // Error description

        // Business Reference
        business_object_type : String(50);                   // INVOICE, FUEL_ORDER, etc.
        business_object_id  : UUID;                          // Reference to business entity
        business_object_key : String(100);                   // Human-readable key

        // User Context
        user_id             : String(100);                   // Initiating user
        user_ip             : String(45);                    // Client IP address

        // Retry Information
        retry_count         : Integer default 0;             // Number of retry attempts
        is_retry            : Boolean default false;         // Is this a retry attempt
        original_message_id : UUID;                          // Original message if retry

        // Cleanup
        retention_days      : Integer default 90;            // Days to retain
        is_archived         : Boolean default false;
}

/**
 * SYSTEM_HEALTH_LOGS - Component Health Check Results
 * Source: FuelSphere native
 * Volume: ~500,000/year
 *
 * Records health check results for all integrated systems
 */
entity SYSTEM_HEALTH_LOGS : cuid {
        // Check Identification
        check_id            : String(50) @mandatory;         // Health check identifier
        check_name          : String(100) @mandatory;        // Human-readable name

        // Timing
        check_time          : DateTime @mandatory;           // When check was performed
        next_check_time     : DateTime;                      // Scheduled next check
        duration_ms         : Integer;                       // Check duration

        // Component Details
        component_name      : String(50) @mandatory;         // FUELSPHERE, S4HANA, HANA_DB, etc.
        component_type      : String(30) @mandatory;         // API, DATABASE, SERVICE, QUEUE
        environment         : String(20) @mandatory;         // DEV, QA, PROD

        // Status
        status              : HealthStatus @mandatory;
        previous_status     : HealthStatus;                  // For trend tracking
        status_changed      : Boolean default false;         // Did status change?

        // Metrics
        response_time_ms    : Integer;                       // Response time
        cpu_usage_pct       : Decimal(5,2);                  // CPU utilization
        memory_usage_pct    : Decimal(5,2);                  // Memory utilization
        disk_usage_pct      : Decimal(5,2);                  // Disk utilization
        active_connections  : Integer;                       // Active connections
        queue_depth         : Integer;                       // Message queue depth

        // Thresholds
        response_threshold_ms : Integer;                     // Threshold for degraded
        critical_threshold_ms : Integer;                     // Threshold for unhealthy

        // Details
        details             : LargeString;                   // Detailed check output
        error_message       : String(1000);                  // Error if unhealthy

        // Alert Triggered
        alert_triggered     : Boolean default false;
        alert_id            : UUID;                          // Reference to alert
}

/**
 * ERROR_LOGS - Integration Error Details
 * Source: FuelSphere native
 * Volume: ~100,000/year
 *
 * Detailed error logging for troubleshooting
 * Error codes: INT401-INT410 per FDD-11
 */
entity ERROR_LOGS : cuid {
        // Error Identification
        error_id            : String(50) @mandatory;         // Unique error identifier
        correlation_id      : UUID;                          // Link to integration message
        timestamp           : DateTime @mandatory;

        // Error Details
        error_code          : String(20) @mandatory;         // INT4xx code
        error_type          : String(50) @mandatory;         // CONNECTION, TIMEOUT, VALIDATION, etc.
        severity            : MessageSeverity @mandatory;
        error_message       : String(1000) @mandatory;       // Error description
        error_details       : LargeString;                   // Full error details/stack trace

        // Context
        integration_name    : String(50) @mandatory;
        source_system       : String(30) @mandatory;
        target_system       : String(30) @mandatory;
        component           : String(50);                    // Component where error occurred
        method_name         : String(100);                   // Method/function name
        line_number         : Integer;                       // Code line number

        // Business Context
        business_object_type : String(50);
        business_object_id  : UUID;
        business_object_key : String(100);
        company_code        : String(4);

        // User Context
        user_id             : String(100);
        session_id          : String(100);

        // Resolution
        is_resolved         : Boolean default false;
        resolved_by         : String(100);
        resolved_at         : DateTime;
        resolution_notes    : String(1000);
        root_cause          : String(500);

        // Related Items
        exception_item_id   : UUID;                          // Link to exception item if created
}

/**
 * EXCEPTION_ITEMS - Failed Transactions Pending Retry
 * Source: FuelSphere native
 * Volume: ~50,000/year
 *
 * Queue for failed transactions that need retry or manual intervention
 */
entity EXCEPTION_ITEMS : cuid, AuditTrail {
        // Exception Identification
        exception_number    : String(25) @mandatory;         // EXC-{DATE}-{SEQ}
        correlation_id      : UUID @mandatory;               // Link to original transaction
        original_message_id : UUID;                          // Original integration message

        // Source Transaction
        integration_name    : String(50) @mandatory;
        source_system       : String(30) @mandatory;
        target_system       : String(30) @mandatory;
        direction           : IntegrationDirection @mandatory;

        // Business Reference
        business_object_type : String(50) @mandatory;
        business_object_id  : UUID;
        business_object_key : String(100);
        company_code        : String(4);

        // Error Details
        error_code          : String(20) @mandatory;
        error_message       : String(1000) @mandatory;
        error_details       : LargeString;
        first_failure_time  : DateTime @mandatory;
        last_failure_time   : DateTime;

        // Payload
        original_payload    : LargeString;                   // Original request payload
        payload_hash        : String(64);                    // SHA-256 for integrity

        // Retry Management
        retry_status        : RetryStatus default 'PENDING';
        retry_count         : Integer default 0;
        max_retries         : Integer default 3;
        next_retry_time     : DateTime;                      // Exponential backoff
        retry_interval_mins : Integer default 15;            // Base retry interval
        last_retry_error    : String(1000);

        // Priority & SLA
        priority            : AlertSeverity default 'MEDIUM';
        sla_deadline        : DateTime;                      // Resolution deadline
        sla_breached        : Boolean default false;

        // Assignment
        assigned_to         : String(100);                   // Assigned resolver
        assigned_at         : DateTime;
        escalated_to        : String(100);                   // Escalation contact
        escalated_at        : DateTime;

        // Resolution
        status              : String(20) default 'OPEN';     // OPEN, IN_PROGRESS, RESOLVED, CANCELLED
        resolution_type     : String(30);                    // AUTO_RETRY, MANUAL_FIX, SKIPPED, DATA_CORRECTION
        resolution_notes    : LargeString;
        resolved_by         : String(100);
        resolved_at         : DateTime;

        // Notifications
        notification_sent   : Boolean default false;
        notification_count  : Integer default 0;
}

/**
 * API_PERFORMANCE_METRICS - Response Time Statistics
 * Source: FuelSphere native
 * Volume: ~10,000,000/year
 *
 * Aggregated API performance metrics for monitoring and SLA tracking
 */
entity API_PERFORMANCE_METRICS : cuid {
        // Metric Period
        metric_date         : Date @mandatory;
        metric_hour         : Integer;                       // 0-23, null for daily
        period_type         : String(10) @mandatory;         // HOURLY, DAILY, WEEKLY

        // Integration Details
        integration_name    : String(50) @mandatory;
        endpoint_url        : String(500);
        http_method         : String(10);
        source_system       : String(30) @mandatory;
        target_system       : String(30) @mandatory;

        // Call Statistics
        total_calls         : Integer @mandatory;            // Total API calls
        successful_calls    : Integer @mandatory;            // Successful calls
        failed_calls        : Integer @mandatory;            // Failed calls
        timeout_calls       : Integer default 0;             // Timeout calls
        success_rate_pct    : Decimal(5,2);                  // Success percentage

        // Response Time Statistics (milliseconds)
        avg_response_time   : Decimal(10,2);                 // Average response time
        min_response_time   : Integer;                       // Minimum response time
        max_response_time   : Integer;                       // Maximum response time
        p50_response_time   : Integer;                       // 50th percentile (median)
        p90_response_time   : Integer;                       // 90th percentile
        p95_response_time   : Integer;                       // 95th percentile
        p99_response_time   : Integer;                       // 99th percentile
        std_deviation       : Decimal(10,2);                 // Standard deviation

        // Throughput
        requests_per_second : Decimal(10,2);                 // Avg requests/second
        peak_requests_per_second : Decimal(10,2);            // Peak requests/second
        total_bytes_sent    : Integer64;                     // Total bytes sent
        total_bytes_received : Integer64;                    // Total bytes received

        // Error Breakdown
        error_4xx_count     : Integer default 0;             // Client errors
        error_5xx_count     : Integer default 0;             // Server errors
        retry_count         : Integer default 0;             // Retry attempts

        // SLA Tracking
        sla_target_ms       : Integer;                       // SLA target response time
        sla_compliance_pct  : Decimal(5,2);                  // % within SLA
        sla_breaches        : Integer default 0;             // Count of SLA breaches

        // Calculated At
        calculated_at       : DateTime @mandatory;
}

/**
 * DATA_SYNC_STATUS - Master Data Synchronization Records
 * Source: FuelSphere native
 * Volume: ~200,000/year
 *
 * Tracks synchronization of master data between FuelSphere and S/4HANA
 */
entity DATA_SYNC_STATUS : cuid, AuditTrail {
        // Sync Identification
        sync_id             : String(50) @mandatory;         // SYNC-{ENTITY}-{DATE}-{SEQ}
        sync_name           : String(100);                   // Sync job name

        // Timing
        sync_start_time     : DateTime @mandatory;
        sync_end_time       : DateTime;
        duration_seconds    : Integer;

        // Sync Details
        entity_type         : String(50) @mandatory;         // SUPPLIER, PRODUCT, AIRPORT, etc.
        direction           : SyncDirection @mandatory;
        company_code        : String(4);                     // If company-specific
        sync_mode           : String(20) @mandatory;         // FULL, DELTA, INCREMENTAL

        // Filter Criteria
        filter_criteria     : String(500);                   // Applied filters
        last_sync_timestamp : DateTime;                      // For delta sync

        // Statistics
        records_processed   : Integer default 0;
        records_created     : Integer default 0;
        records_updated     : Integer default 0;
        records_deleted     : Integer default 0;
        records_skipped     : Integer default 0;
        records_failed      : Integer default 0;

        // Status
        status              : IntegrationStatus @mandatory;
        error_count         : Integer default 0;
        warning_count       : Integer default 0;
        error_summary       : LargeString;                   // Summary of errors

        // Checkpoints
        last_processed_key  : String(100);                   // For restart capability
        checkpoint_data     : LargeString;                   // Checkpoint state JSON

        // Triggered By
        trigger_type        : String(20) @mandatory;         // SCHEDULED, MANUAL, EVENT
        triggered_by        : String(100);
        schedule_id         : String(50);                    // If scheduled job

        // Notifications
        notification_sent   : Boolean default false;
}

/**
 * INTEGRATION_CONFIGS - Integration Configuration Settings
 * Source: FuelSphere native
 * Volume: ~200 records
 *
 * Configuration parameters for all integrations
 */
entity INTEGRATION_CONFIGS : cuid, ActiveStatus, AuditTrail {
        // Configuration Identification
        config_key          : String(100) @mandatory;        // Unique config key
        config_name         : String(100) @mandatory;        // Display name
        config_group        : String(50) @mandatory;         // S4_INTEGRATION, ACARS, etc.

        // Value
        config_value        : String(1000) @mandatory;       // Configuration value
        config_type         : String(20) @mandatory;         // STRING, INTEGER, BOOLEAN, JSON
        default_value       : String(1000);                  // Default if not set
        is_encrypted        : Boolean default false;         // Is value encrypted?

        // Scope
        company_code        : String(4);                     // Company-specific, null=global
        environment         : String(20);                    // DEV, QA, PROD, null=all

        // Validation
        validation_regex    : String(500);                   // Regex for validation
        min_value           : Decimal(15,4);                 // Minimum numeric value
        max_value           : Decimal(15,4);                 // Maximum numeric value
        allowed_values      : String(1000);                  // Comma-separated list

        // Documentation
        description         : String(500);                   // Config description
        example_value       : String(500);                   // Example usage

        // Change Control
        requires_restart    : Boolean default false;         // Requires service restart?
        last_changed_reason : String(500);                   // Reason for last change
}

/**
 * ALERT_DEFINITIONS - Alert Rules and Notifications
 * Source: FuelSphere native
 * Volume: ~50 records
 *
 * Defines monitoring alerts and notification rules
 */
entity ALERT_DEFINITIONS : cuid, ActiveStatus, AuditTrail {
        // Alert Identification
        alert_code          : String(30) @mandatory;         // Unique alert code
        alert_name          : String(100) @mandatory;        // Alert display name
        description         : String(500);                   // Alert description

        // Scope
        integration_name    : String(50);                    // Specific integration, null=all
        component_name      : String(50);                    // Specific component
        company_code        : String(4);                     // Company-specific

        // Trigger Conditions
        metric_type         : String(50) @mandatory;         // ERROR_RATE, RESPONSE_TIME, etc.
        threshold_operator  : String(10) @mandatory;         // GT, LT, EQ, GTE, LTE
        threshold_value     : Decimal(15,4) @mandatory;      // Trigger threshold
        threshold_unit      : String(20);                    // MS, PERCENT, COUNT
        evaluation_window_mins : Integer default 5;          // Window for evaluation
        min_occurrences     : Integer default 1;             // Min occurrences to trigger

        // Severity & Priority
        severity            : AlertSeverity @mandatory;
        auto_resolve        : Boolean default true;          // Auto-resolve when condition clears

        // Notification
        notification_channels : String(200);                 // EMAIL, SMS, SLACK, etc.
        notification_recipients : String(1000);              // Recipient list
        notification_template : String(50);                  // Template name
        cooldown_mins       : Integer default 15;            // Min time between alerts
        escalation_mins     : Integer;                       // Time to escalate
        escalation_recipients : String(500);                 // Escalation contacts

        // Actions
        auto_action_enabled : Boolean default false;         // Auto remediation?
        auto_action_type    : String(50);                    // RESTART, RETRY, SKIP, etc.
        runbook_url         : String(500);                   // Link to runbook

        // Statistics
        last_triggered_at   : DateTime;
        trigger_count       : Integer default 0;
        false_positive_count : Integer default 0;
}

/**
 * ALERT_INSTANCES - Triggered Alert Records
 * Source: FuelSphere native
 * Volume: ~50,000/year
 *
 * Records individual alert occurrences
 */
entity ALERT_INSTANCES : cuid {
        // Alert Reference
        alert_definition    : Association to ALERT_DEFINITIONS @mandatory;
        alert_code          : String(30) @mandatory;         // Denormalized for queries

        // Timing
        triggered_at        : DateTime @mandatory;
        acknowledged_at     : DateTime;
        resolved_at         : DateTime;
        duration_mins       : Integer;                       // Time to resolution

        // Trigger Details
        trigger_value       : Decimal(15,4) @mandatory;      // Value that triggered
        threshold_value     : Decimal(15,4) @mandatory;      // Threshold at time
        metric_type         : String(50) @mandatory;

        // Context
        correlation_id      : UUID;                          // Related transaction
        integration_name    : String(50);
        component_name      : String(50);
        error_code          : String(20);
        details             : LargeString;                   // Alert details JSON

        // Status
        status              : String(20) default 'ACTIVE';   // ACTIVE, ACKNOWLEDGED, RESOLVED, SUPPRESSED
        severity            : AlertSeverity @mandatory;

        // Assignment
        acknowledged_by     : String(100);
        resolved_by         : String(100);
        resolution_notes    : String(1000);

        // Notifications
        notifications_sent  : Integer default 0;
        last_notification_at : DateTime;
        escalated           : Boolean default false;
        escalated_at        : DateTime;
}

/**
 * DATA_QUALITY_METRICS - Data Quality Scores
 * Source: FuelSphere native
 * Volume: ~500,000/year
 *
 * Tracks data quality metrics for integrated data
 */
entity DATA_QUALITY_METRICS : cuid {
        // Metric Period
        metric_date         : Date @mandatory;
        period_type         : String(10) @mandatory;         // DAILY, WEEKLY, MONTHLY

        // Entity Details
        entity_type         : String(50) @mandatory;         // SUPPLIER, INVOICE, etc.
        entity_source       : String(30) @mandatory;         // S4HANA, FUELSPHERE, ACARS
        company_code        : String(4);

        // Record Counts
        total_records       : Integer @mandatory;
        valid_records       : Integer @mandatory;
        invalid_records     : Integer @mandatory;
        duplicate_records   : Integer default 0;
        orphan_records      : Integer default 0;

        // Quality Scores (0-100)
        completeness_score  : Decimal(5,2);                  // Required fields populated
        accuracy_score      : Decimal(5,2);                  // Values within valid ranges
        consistency_score   : Decimal(5,2);                  // Cross-field consistency
        timeliness_score    : Decimal(5,2);                  // Data freshness
        uniqueness_score    : Decimal(5,2);                  // No duplicates
        overall_score       : Decimal(5,2);                  // Weighted average

        // Issue Breakdown
        missing_required    : Integer default 0;             // Missing required fields
        invalid_format      : Integer default 0;             // Format validation failures
        out_of_range        : Integer default 0;             // Value range violations
        referential_errors  : Integer default 0;             // FK violations
        business_rule_errors : Integer default 0;            // Business rule violations

        // Trend
        previous_score      : Decimal(5,2);                  // Previous period score
        score_change        : Decimal(5,2);                  // Change from previous

        // Details
        top_issues          : LargeString;                   // Top issues JSON
        sample_errors       : LargeString;                   // Sample error records

        // Calculated At
        calculated_at       : DateTime @mandatory;
}

// ============================================================================
// FDD-12: REPORTING & ANALYTICS
// ============================================================================

/**
 * Reporting & Analytics Types
 */
type ReportFormat : String(10) enum { PDF; EXCEL; CSV; HTML }
type ReportStatus : String(15) enum { DRAFT; ACTIVE; ARCHIVED; DEPRECATED }
type VarianceStatus : String(15) enum { OK; WARNING; CRITICAL }
type KPICategory : String(30) enum { FINANCIAL; OPERATIONAL; COMPLIANCE; PERFORMANCE; QUALITY }
type ChartType : String(20) enum { LINE; BAR; DONUT; AREA; COLUMN; WATERFALL; HEATMAP }
type DashboardLayout : String(20) enum { GRID; FLEX; TABS; CARDS }
type SnapshotType : String(20) enum { DAILY; WEEKLY; MONTHLY; QUARTERLY; YEARLY; ADHOC }
type ExportStatus : String(15) enum { PENDING; IN_PROGRESS; COMPLETED; FAILED }

/**
 * REPORT_DEFINITIONS - Report Configuration and Templates
 * Source: FuelSphere native
 * Volume: ~100 records
 *
 * Defines available reports, their parameters, and output formats
 */
entity REPORT_DEFINITIONS : cuid, ActiveStatus, AuditTrail {
        // Report Identification
        report_code         : String(30) @mandatory;         // Unique report code
        report_name         : String(100) @mandatory;        // Display name
        report_description  : String(500);                   // Report description
        report_category     : String(50) @mandatory;         // FINANCIAL, OPERATIONAL, etc.

        // Report Type
        report_type         : String(30) @mandatory;         // ANALYTICAL, LIST, SUMMARY, DETAIL
        floorplan_type      : String(30);                    // ALP, LR, OP, WORKLIST
        base_entity         : String(100);                   // Source entity/view name

        // Parameters
        parameters_config   : LargeString;                   // Parameter definitions JSON
        default_filters     : LargeString;                   // Default filter values JSON
        required_filters    : String(500);                   // Required filter fields

        // Output Configuration
        supported_formats   : String(50) default 'EXCEL,PDF'; // Comma-separated formats
        default_format      : ReportFormat default 'EXCEL';
        template_file       : String(200);                   // Template file path if applicable

        // Scheduling
        schedule_enabled    : Boolean default false;
        schedule_cron       : String(50);                    // Cron expression
        distribution_list   : String(1000);                  // Email recipients

        // Access Control
        required_scope      : String(50) @mandatory;         // Required authorization scope
        company_codes       : String(100);                   // Allowed company codes (null = all)

        // Metadata
        version             : String(10) default '1.0';
        last_generated_at   : DateTime;
        generation_count    : Integer default 0;

        // UI Configuration
        columns_config      : LargeString;                   // Column definitions JSON
        sort_config         : String(200);                   // Default sort configuration
        group_config        : String(200);                   // Grouping configuration
}

/**
 * DASHBOARD_CONFIGS - Dashboard Layout and Configuration
 * Source: FuelSphere native
 * Volume: ~50 records
 *
 * Defines dashboard layouts, tiles, and component arrangements
 */
entity DASHBOARD_CONFIGS : cuid, ActiveStatus, AuditTrail {
        // Dashboard Identification
        dashboard_code      : String(30) @mandatory;         // Unique dashboard code
        dashboard_name      : String(100) @mandatory;        // Display name
        dashboard_description : String(500);                 // Dashboard description

        // Layout
        layout_type         : DashboardLayout default 'GRID';
        column_count        : Integer default 4;             // Grid columns
        row_height          : Integer default 200;           // Default row height in pixels

        // Target Audience
        persona             : String(50) @mandatory;         // FINANCE_CONTROLLER, OPS_MANAGER, etc.
        required_scope      : String(50) @mandatory;         // Required authorization scope
        company_codes       : String(100);                   // Allowed company codes

        // Tiles Configuration (JSON array of tile definitions)
        tiles_config        : LargeString @mandatory;        // Tile definitions JSON
        /**
         * tiles_config JSON structure:
         * [{
         *   "tileId": "tile-001",
         *   "title": "Invoice Processing Time",
         *   "kpiCode": "KPI-INV-001",
         *   "position": {"row": 0, "col": 0},
         *   "size": {"width": 1, "height": 1},
         *   "chartType": "KPI",
         *   "drilldownTarget": "variance-analysis"
         * }]
         */

        // Filters
        global_filters      : LargeString;                   // Shared filters for all tiles
        filter_bar_visible  : Boolean default true;

        // Refresh
        auto_refresh        : Boolean default false;
        refresh_interval_sec : Integer default 300;          // Auto-refresh interval

        // Home Page
        is_home_page        : Boolean default false;         // Default landing page
        display_order       : Integer default 100;           // Menu order
}

/**
 * KPI_DEFINITIONS - KPI Configuration and Thresholds
 * Source: FuelSphere native
 * Volume: ~200 records
 *
 * Defines KPIs, calculation logic, and threshold values
 */
entity KPI_DEFINITIONS : cuid, ActiveStatus, AuditTrail {
        // KPI Identification
        kpi_code            : String(30) @mandatory;         // Unique KPI code
        kpi_name            : String(100) @mandatory;        // Display name
        kpi_description     : String(500);                   // KPI description
        kpi_category        : KPICategory @mandatory;        // Category classification

        // Calculation
        calculation_logic   : String(1000) @mandatory;       // Formula or calculation method
        source_entity       : String(100);                   // Source entity/view
        aggregation_type    : String(20);                    // SUM, AVG, COUNT, MIN, MAX
        time_dimension      : String(20) default 'DAILY';    // Aggregation period

        // Thresholds
        target_value        : Decimal(15,4);                 // Target/goal value
        warning_threshold   : Decimal(15,4);                 // Warning level
        critical_threshold  : Decimal(15,4);                 // Critical level
        threshold_direction : String(10) default 'HIGHER';   // HIGHER=better, LOWER=better

        // Display
        uom                 : String(20) @mandatory;         // Unit of measure (%, $, days, count)
        display_format      : String(50);                    // Number format pattern
        decimal_places      : Integer default 2;
        prefix              : String(10);                    // Currency symbol, etc.
        suffix              : String(10);                    // %, pts, etc.

        // Chart Configuration
        trend_chart_type    : ChartType default 'LINE';
        comparison_enabled  : Boolean default true;          // Show vs. prior period
        sparkline_enabled   : Boolean default true;          // Show mini trend

        // Scope
        company_codes       : String(100);                   // Applicable company codes
        applicable_modules  : String(200);                   // FDD modules using this KPI

        // Metadata
        owner_role          : String(50);                    // Responsible role
        review_frequency    : String(20);                    // DAILY, WEEKLY, MONTHLY
        last_reviewed_at    : DateTime;
        last_reviewed_by    : String(100);
}

/**
 * VARIANCE_RECORDS - Budget vs. Actual Variance Tracking
 * Source: FuelSphere native
 * Volume: ~500,000/year
 *
 * Records variance analysis between planned and actual values
 */
entity VARIANCE_RECORDS : cuid, AuditTrail {
        // Period & Scope
        period              : String(7) @mandatory;          // YYYY-MM format
        company_code        : String(4) @mandatory;          // SAP Company Code
        fiscal_year         : String(4) @mandatory;          // Fiscal year

        // Dimension (one of these is populated)
        cost_center         : String(10);                    // S/4HANA Cost Center
        profit_center       : String(10);                    // S/4HANA Profit Center
        station_code        : String(3);                     // Airport IATA code
        route_code          : String(20);                    // Route identifier
        supplier_id         : UUID;                          // Supplier reference

        // Variance Category
        variance_category   : String(30) @mandatory;         // FUEL_COST, VOLUME, PRICE, etc.
        variance_type       : String(20) @mandatory;         // BUDGET, FORECAST, PRIOR_YEAR

        // Amounts
        budget_amount       : Decimal(18,2) @mandatory;      // Planned/budgeted amount
        actual_amount       : Decimal(18,2) @mandatory;      // Actual amount
        variance_amount     : Decimal(18,2) @mandatory;      // Variance (Actual - Budget)
        variance_pct        : Decimal(8,4);                  // Variance percentage
        currency_code       : String(3) @mandatory;

        // Quantities (if applicable)
        budget_quantity     : Decimal(15,2);                 // Planned quantity
        actual_quantity     : Decimal(15,2);                 // Actual quantity
        quantity_variance   : Decimal(15,2);                 // Quantity variance
        quantity_uom        : String(3);                     // Unit of measure

        // Status & Thresholds
        status              : VarianceStatus @mandatory;     // OK, WARNING, CRITICAL
        threshold_breached  : Boolean default false;
        threshold_value     : Decimal(8,4);                  // Threshold that was applied

        // Analysis
        root_cause          : String(500);                   // Explanation for variance
        corrective_action   : String(500);                   // Planned action
        analyzed_by         : String(100);
        analyzed_at         : DateTime;

        // Drill-down References
        source_allocations  : String(1000);                  // Related allocation IDs (JSON)
        source_invoices     : String(1000);                  // Related invoice IDs (JSON)

        // Workflow
        requires_review     : Boolean default false;
        reviewed_by         : String(100);
        reviewed_at         : DateTime;
        review_notes        : String(500);
}

/**
 * ANALYTICS_SNAPSHOTS - Point-in-Time Analytics Data
 * Source: FuelSphere native
 * Volume: ~1,000,000/year
 *
 * Captures aggregated metrics at specific points in time for historical analysis
 */
entity ANALYTICS_SNAPSHOTS : cuid {
        // Snapshot Identification
        snapshot_id         : String(50) @mandatory;         // SNAP-{TYPE}-{DATE}-{SEQ}
        snapshot_type       : SnapshotType @mandatory;       // DAILY, WEEKLY, MONTHLY, etc.
        snapshot_date       : Date @mandatory;               // Snapshot date
        snapshot_time       : DateTime @mandatory;           // Exact capture time

        // Scope
        company_code        : String(4);                     // Company code (null = all)
        metric_category     : String(50) @mandatory;         // Category of metrics

        // Metric Data (JSON structure for flexible metrics)
        metrics_data        : LargeString @mandatory;        // Aggregated metrics JSON
        /**
         * metrics_data JSON structure:
         * {
         *   "total_fuel_cost": 1250000.00,
         *   "total_volume_kg": 5000000,
         *   "invoice_count": 450,
         *   "avg_price_per_kg": 0.85,
         *   "variance_pct": 2.5,
         *   ...
         * }
         */

        // Dimensions Included
        dimensions          : String(500);                   // Dimensions in snapshot

        // Source Data
        record_count        : Integer;                       // Number of source records
        data_from_date      : Date;                          // Data range start
        data_to_date        : Date;                          // Data range end

        // Quality
        is_complete         : Boolean default true;          // All data captured?
        missing_data_notes  : String(500);                   // Notes on missing data

        // Retention
        retention_days      : Integer default 365;           // Days to retain
        is_archived         : Boolean default false;
        archived_at         : DateTime;
}

/**
 * SAC_EXPORT_LOGS - SAP Analytics Cloud Export Tracking
 * Source: FuelSphere native
 * Volume: ~10,000/year
 *
 * Tracks data exports to SAP Analytics Cloud for planning writeback
 */
entity SAC_EXPORT_LOGS : cuid, AuditTrail {
        // Export Identification
        export_id           : String(50) @mandatory;         // EXP-SAC-{DATE}-{SEQ}
        export_name         : String(100);                   // Export description

        // Timing
        export_start_time   : DateTime @mandatory;
        export_end_time     : DateTime;
        duration_seconds    : Integer;

        // Scope
        period_from         : String(7) @mandatory;          // Start period (YYYY-MM)
        period_to           : String(7) @mandatory;          // End period (YYYY-MM)
        company_codes       : String(100);                   // Exported company codes
        data_type           : String(50) @mandatory;         // BUDGET, FORECAST, ACTUALS

        // SAC Target
        sac_model_id        : String(100) @mandatory;        // SAC Planning Model ID
        sac_version         : String(50);                    // SAC Version/Scenario
        sac_connection_name : String(100);                   // BTP Destination name

        // Statistics
        records_exported    : Integer default 0;
        records_created     : Integer default 0;
        records_updated     : Integer default 0;
        records_failed      : Integer default 0;
        total_amount        : Decimal(18,2);                 // Sum of exported amounts
        currency_code       : String(3);

        // Status
        status              : ExportStatus @mandatory;
        error_count         : Integer default 0;
        error_summary       : LargeString;                   // Error details

        // Approval (for budget writeback)
        requires_approval   : Boolean default true;
        approved_by         : String(100);
        approved_at         : DateTime;
        approval_notes      : String(500);

        // Triggered By
        trigger_type        : String(20) @mandatory;         // MANUAL, SCHEDULED, APPROVAL
        triggered_by        : String(100);
        schedule_id         : String(50);
}

/**
 * REPORT_EXECUTIONS - Report Generation History
 * Source: FuelSphere native
 * Volume: ~50,000/year
 *
 * Tracks report generation requests and outputs
 */
entity REPORT_EXECUTIONS : cuid {
        // Report Reference
        report_definition   : Association to REPORT_DEFINITIONS @mandatory;
        report_code         : String(30) @mandatory;         // Denormalized

        // Execution Details
        execution_time      : DateTime @mandatory;           // When executed
        duration_ms         : Integer;                       // Generation time
        output_format       : ReportFormat @mandatory;       // Output format used

        // Parameters Used
        parameters_used     : LargeString;                   // Filter parameters JSON
        period_from         : String(7);                     // Report period start
        period_to           : String(7);                     // Report period end
        company_code        : String(4);

        // Output
        output_file_name    : String(200);                   // Generated file name
        output_file_path    : String(500);                   // Storage path
        output_file_size    : Integer;                       // File size in bytes
        row_count           : Integer;                       // Rows in report

        // Status
        status              : ExportStatus @mandatory;
        error_message       : String(1000);                  // Error if failed

        // User
        requested_by        : String(100) @mandatory;
        request_source      : String(20);                    // UI, SCHEDULED, API

        // Distribution
        distributed_to      : String(1000);                  // Recipients (if emailed)
        distributed_at      : DateTime;
}

/**
 * KPI_VALUES - Calculated KPI Values History
 * Source: FuelSphere native
 * Volume: ~500,000/year
 *
 * Stores calculated KPI values for trending and historical analysis
 */
entity KPI_VALUES : cuid {
        // KPI Reference
        kpi_definition      : Association to KPI_DEFINITIONS @mandatory;
        kpi_code            : String(30) @mandatory;         // Denormalized

        // Period
        value_date          : Date @mandatory;               // Date of value
        period_type         : String(10) @mandatory;         // DAILY, WEEKLY, MONTHLY
        company_code        : String(4);                     // Scope (null = all)

        // Value
        kpi_value           : Decimal(18,4) @mandatory;      // Calculated value
        target_value        : Decimal(18,4);                 // Target at time of calc
        variance_from_target : Decimal(18,4);                // Difference from target
        variance_pct        : Decimal(8,4);                  // % variance from target

        // Comparison
        prior_period_value  : Decimal(18,4);                 // Previous period value
        prior_period_change : Decimal(18,4);                 // Change from prior
        prior_period_change_pct : Decimal(8,4);              // % change from prior
        yoy_value           : Decimal(18,4);                 // Same period last year
        yoy_change_pct      : Decimal(8,4);                  // YoY % change

        // Status
        status              : VarianceStatus;                // OK, WARNING, CRITICAL
        threshold_breached  : Boolean default false;

        // Source
        source_record_count : Integer;                       // Records used in calc
        calculation_time    : DateTime @mandatory;           // When calculated

        // Trend Data (mini sparkline)
        trend_data          : String(500);                   // Last N values JSON
}

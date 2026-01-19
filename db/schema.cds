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

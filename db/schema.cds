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
 * Source: S/4HANA API_COUNTRY_SRV
 * Sync: Daily
 */
entity T005_COUNTRY : ActiveStatus {
    key land1       : String(3);      // SAP Country key (PK)
        landx       : String(50);     // Country name
        landx50     : String(100);    // Full country name
        natio       : String(3);      // Nationality code
        landgr      : String(3);      // Country group/region
        currcode    : String(3);      // Currency code (FK to CURRENCY_MASTER)
        spras       : String(2);      // Language key
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

        // Quality Measurements
        temperature         : Decimal(5,2);             // Fuel temperature (°C)
        density             : Decimal(8,4);             // Measured density (kg/L)
        temperature_corrected_qty : Decimal(12,2);      // Temperature-corrected quantity

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

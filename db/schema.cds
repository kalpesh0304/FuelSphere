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
 * Fields aligned with HLD Section 3.2
 */
entity MASTER_CONTRACTS : cuid, ActiveStatus, AuditTrail {
        contract_number : String(20) @mandatory;  // Contract number
        contract_name   : String(100) @mandatory; // Contract description
        supplier        : Association to MASTER_SUPPLIERS;
        valid_from      : Date @mandatory;        // Contract start date
        valid_to        : Date @mandatory;        // Contract end date
        contract_type   : String(20) @mandatory;  // Contract type
        price_type      : String(20) @mandatory;  // CPE / FIXED / INDEX
        currency        : Association to CURRENCY_MASTER on currency.currency_code = currency_code;
        currency_code   : String(3) @mandatory;   // FK to CURRENCY_MASTER.currency_code
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

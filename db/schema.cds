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

using { cuid, managed, sap.common.CodeList } from '@sap/cds/common';

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
        natio       : String(15);      // Nationality name
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

        // WP-11: planning-side conversion factor ONLY.
        // SAP's MARM carries its own litre-to-kilogram factor and is
        // authoritative. Two independent sources for the same number produce a
        // phantom variance in stock reconciliation on top of the real density
        // variance. Use this for the plan-to-order estimate and for nothing
        // that has to agree with SAP.
        conversion_to_kg: Decimal(15,6);  // Planning estimate factor. NOT for settlement or reconciliation

        // WP-11: SAP T006 mapping. The unit travels on the PO, the GR and the
        // invoice. This list is a mixture — LTR is ISO, KG is internal, MT is
        // neither — so the mapping is added rather than the list renamed.
        // Send sap_uom_iso: internal codes are client-configurable and a
        // product shipping to several airlines cannot depend on one client's
        // naming. Verify against the target client's T006 before go-live.
        sap_uom         : String(3);      // T006 MSEHI, internal
        sap_uom_iso     : String(3);      // T006 ISOCODE
}

/**
 * T001W_PLANT - SAP Plant Master
 * Source: S/4HANA ZAPI_PLANT_SRV (custom)
 * Sync: Daily
 */
entity T001W_PLANT : ActiveStatus {
    key werks       : String(4);      // Plant code (PK)
        name1       : String(30);     // Plant name
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
 * STATUSES - Aircraft Oreration Status
 * Source: FuelSphere native
 */
entity AIRCRAFT_OPSTATUS : CodeList {
    key status_code : String(20) default 'ACTIVE';     // ACTIVE/INACTIVE/MAINTENANCE
}

/**
 * AIRCRAFT_MASTER - Aircraft TYPE Master
 * Source: FuelSphere native
 *
 * This is a TYPE master, not an aircraft register. It is keyed on type_code
 * and every field on it is type-level: model, manufacturer, capacity, MTOW,
 * cruise burn, fleet size. One row describes a fleet type such as A350, not
 * an individual aircraft.
 *
 * Individual aircraft live in AIRCRAFT_REGISTRATIONS, keyed on registration.
 * WP-07 / decision B1. Do not repurpose this entity or move fields out of it.
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
        status              : Association to AIRCRAFT_OPSTATUS;
}

/**
 * Aircraft record lifecycle (WP-07, decision A4)
 *
 * The principle is that capture is never blocked and external commitment is
 * gated. A tail seen for the first time on a ticket is recorded, because the
 * fuel is already in the tanks; what it cannot yet do is carry an order.
 */
type AircraftRecordStatus : String(20) enum {
    Provisional = 'PROVISIONAL';   // Auto-created. Ticket capture allowed, order creation blocked
    Confirmed   = 'CONFIRMED';     // Identity verified. Orders unblocked
    Complete    = 'COMPLETE';      // All physical characteristics present
}

/**
 * Cost object type (01-TARGET-SCHEMA §2A, REQ-SAP-002)
 * Provisioned, not consumed. No determination logic reads it yet.
 */
type CostObjectType : String(20) enum {
    CostCenter    = 'COST_CENTER';
    InternalOrder = 'INTERNAL_ORDER';
}

/**
 * AIRCRAFT_REGISTRATIONS - Aircraft Register (WP-07, decision B1)
 * Source: FuelSphere native
 *
 * One row per individual aircraft. Closes defect D11: before this entity the
 * only record of a tail was a free-text string on five transactional entities.
 *
 * Keyed on the registration itself rather than a UUID. It is the natural key,
 * it appears on every physical document, and a UUID would force a lookup on
 * every ingest.
 *
 * fuel_capacity_kg appears here AND on AIRCRAFT_MASTER deliberately. The type
 * value is the default; this one overrides it where a tail's tanks differ.
 * Resolution is registration first, type second.
 */
entity AIRCRAFT_REGISTRATIONS : ActiveStatus, AuditTrail {
    key registration        : String(10);      // Tail number, e.g. RP-C4108

        aircraft_type       : Association to AIRCRAFT_MASTER on aircraft_type.type_code = aircraft_type_code;
        aircraft_type_code  : String(10);      // FK, mirrors the pattern on FUEL_ORDERS

        // Per-tail physical characteristics
        dry_operating_weight_kg : Decimal(15,2);
        fuel_capacity_kg        : Decimal(15,2);   // Overrides the type value where tanks differ
        apu_burn_rate_kg_hr     : Decimal(8,2);    // Never metered; APU burn derives from this. Unused until WP-19
        performance_factor_pct  : Decimal(6,3);    // Actual over planned burn. Drifts per tail

        // Lifecycle - decision A4, provisional master data
        @assert.range: true   // WP-09 finding D25: a CDS enum is advisory without this
        record_status       : AircraftRecordStatus default 'PROVISIONAL';
        provisional_expiry  : Date;                // Time-boxed; escalation is WP-16
        confirmed_by        : String(100);
        confirmed_at        : DateTime;

        // Operational
        operator_code       : String(3);           // Operating carrier where leased
        on_own_aoc          : Boolean default true; // false = wet lease or ACMI

        // Cost object mapping - 01-TARGET-SCHEMA §2A. Provisioned, not consumed.
        @assert.range: true
        cost_object_type    : CostObjectType;      // Nullable. Unused by default
        cost_object_id      : String(20);          // Cost centre or internal order
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
        @mandatory
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
 * Flight Status Enumeration (WP-09, decision B7)
 *
 * Replaces free String(20). RETURNED is split: a ramp return is still on
 * stand and may be refuelled before a second departure attempt, whereas an
 * air return has burned fuel and landed. One value gave no way to tell which,
 * and the fuel handling differs.
 */
type FlightStatus : String(20) enum {
    Scheduled     = 'SCHEDULED';
    Departed      = 'DEPARTED';
    Arrived       = 'ARRIVED';
    Cancelled     = 'CANCELLED';
    Diverted      = 'DIVERTED';
    Delayed       = 'DELAYED';
    RampReturn    = 'RAMP_RETURN';   // Returned to stand before departure
    AirReturn     = 'AIR_RETURN';    // Returned to departure airport after takeoff
}

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
        // WP-07B / decisions B1 and A4. ADDITIVE — the string above keeps its
        // existing constraint and this is optional, always.
        //
        // Named `tail`, not `aircraft`. On four of these seven entities
        // `aircraft` is already an association to AIRCRAFT_MASTER — the TYPE
        // master, keyed on type_code — and @mandatory on three of them. The
        // same name would mean type in one place and tail in another.
        //
        // Both are retained deliberately. The string is the value AS RECEIVED
        // and survives a registration the register has never seen; replacing
        // it would make an unknown tail structurally impossible to record, and
        // then no parameter could permit one.
        tail                : Association to AIRCRAFT_REGISTRATIONS;

        // WP-18 / ENR452. The leg's identity, immutable.
        //
        // A tail swap changes the registration and nothing else: the leg is
        // the same leg. Without a stable identity the replacement dispatch
        // plan looks like a different flight rather than a revision of this
        // one, which is exactly what plan_group_id has to survive.
        //
        // Not flight_number + flight_date. ENR450 records that one flight
        // number can depart the same station twice on one date, so that pair
        // is not a key.
        flight_leg_id       : String(40);               // ENR452. Immutable through a tail swap
        origin              : Association to MASTER_AIRPORTS on origin.iata_code = origin_airport;
        origin_airport      : String(3) @mandatory;     // Departure airport IATA
        destination         : Association to MASTER_AIRPORTS on destination.iata_code = destination_airport;
        destination_airport : String(3) @mandatory;     // Arrival airport IATA
        scheduled_departure : Time;                     // Scheduled departure time (backward compat)
        scheduled_arrival   : Time;                     // Scheduled arrival time (backward compat)
        @assert.range: true   // WP-09: a CDS enum is advisory without this; CAP accepts any string
        status              : FlightStatus default 'SCHEDULED'; // WP-09: was free String(20)

        // Fuel Order linkage (auto-created as Draft on upload)
        //
        // RETAINED, AND IT IS A TO-ONE OVER A ONE-TO-MANY CONDITION. Several
        // handlers read fuel_order_ID, so it stays - but the ON condition can
        // match more than one row and CAP returns an arbitrary one. PR1041
        // already carries TWO orders in the seed, so this is measured rather
        // than theoretical. Use `orders` below for anything that must be
        // complete; treat this as "an order on this flight", never "the".
        fuel_order          : Association to FUEL_ORDERS on fuel_order.flight = $self;

        // ====================================================================
        // A FLIGHT MUST BE ABLE TO ENUMERATE ITS OWN RECORDS.
        //
        // Every link below existed in one direction only - the child pointed
        // at the flight and the flight could not name its children. That is a
        // modelling gap rather than a screen problem: "which orders were
        // raised for this leg" is a question about the domain, and it had no
        // answer that did not require querying the child table by hand.
        //
        // ASSOCIATION TO MANY, NOT COMPOSITION. These are independent records
        // with their own lifecycles - an order is raised, approved, delivered
        // and invoiced on its own track, and a composition would make deleting
        // a flight delete its orders. Managed associations with an ON
        // condition: no new column, no foreign key added anywhere, and the
        // child keeps owning the relationship.
        //
        // DELIVERIES AND TICKETS ARE DELIBERATELY ABSENT. Neither carries a
        // flight key at all - a delivery reaches its flight through its order
        // (decision B2: the delivery hangs off the aircraft, and orders
        // resolve transitively through the tickets) and a ticket through its
        // order or its delivery. The only direct route would be a join on
        // tail plus date, and MEASURED AGAINST THE SEED that over-matches on
        // five of thirteen tail-date pairs - every one of those flights would
        // list the other's fuel. A second route to the same row is a second
        // thing that can disagree.
        // ====================================================================
        orders              : Association to many FUEL_ORDERS
                                  on orders.flight = $self;
        dispatches          : Association to many FLIGHT_DISPATCH
                                  on dispatches.flight_schedule = $self;
        // DECLARED AND DELIBERATELY UNRENDERED. Two reasons, and the second
        // is checkable.
        //
        // A burn is after the fact: a planner plans, an analyst reads burns,
        // and the walkthrough already crosses to BurnService for those stops.
        //
        // And NO SERVICE exposes both FLIGHT_SCHEDULE and FUEL_BURNS
        // navigably - all five services that project FLIGHT_SCHEDULE emit
        // "No OData navigation property generated" for this element. Putting
        // burns on the flight page therefore means a FOURTH projection of an
        // entity BurnService owns and annotates, to serve a reader who is a
        // different person. Same shape as the four Package D left closed.
        burns               : Association to many FUEL_BURNS
                                  on burns.flight = $self;

        // Through the views above, which do the hop the compiler will not
        // allow an ON condition to do. Plain column comparison, foreign-key
        // join, read-only.
        deliveries          : Association to many FLIGHT_FUEL_DELIVERIES
                                  on deliveries.flight_ID = ID;
        tickets             : Association to many FLIGHT_FUEL_TICKETS
                                  on tickets.flight_ID = ID;
        fuel_order_number   : String(25);               // Denormalized for display

        // OPS-ESB ICD-inspired fields
        airline_code        : String(3);                // IATA airline designator (e.g., PR, EY)
        flight_suffix       : String(2);                // Operational suffix
        service_type        : String(1);                // IATA service type: J=sched pax, F=freight, C=charter, G=ferry

        departure_terminal  : String(10);               // Departure terminal
        arrival_terminal    : String(10);               // Arrival terminal
        gate_number         : String(10);               // Departure/arrival gate
        stand_number        : String(10);               // Aircraft stand/bay number

        // Operational timestamps (UTC)
        sobt                : DateTime;                 // Scheduled Off Block Time
        sibt                : DateTime;                 // Scheduled In Block Time
        eobt                : DateTime;                 // Estimated Off Block Time
        eibt                : DateTime;                 // Estimated In Block Time
        aobt                : DateTime;                 // Actual Off Block Time
        aibt                : DateTime;                 // Actual In Block Time
        atot                : DateTime;                 // Actual Take Off Time
        aldt                : DateTime;                 // Actual Landing Time

        // Block hours
        planned_block_mins  : Integer;                  // Planned block time in minutes
        actual_block_mins   : Integer;                  // Actual block time in minutes

        // Flight nature & linked flights
        flight_nature       : String(10);               // PAX, FRY (ferry), AMB, TRN
        linked_flight_number: String(10);               // Previous/next leg flight number
        linked_flight_date  : Date;                     // Linked flight date

        // Codeshare & delays
        codeshare_flights   : String(100);              // Comma-separated codeshare flight numbers
        delay_code          : String(10);               // IATA delay code
        delay_minutes       : Integer;                  // Delay duration in minutes
        cancellation_reason : String(200);              // Reason if status=CANCELLED

        // Payload (passengers + cargo) — input to fuel demand calculation
        booked_passengers   : Integer;                  // PAX booked (refreshed continuously from booking system)
        boarded_passengers  : Integer;                  // PAX boarded (final, from DCS at door-close ~30 min before departure)
        cargo_kg            : Decimal(10,2);            // Cargo load in kg
        captain_name        : String(100);              // Pilot in command (assigned closer to flight)

        // ====================================================================
        // WP-33 - the design-review fields. PURELY ADDITIVE, all optional.
        //
        // NULL IS NOT ZERO AND NOT "SAME AS PLANNED". No closure timestamp
        // means no split point - not a split at zero, and not the whole gap
        // charged to one flight. A null actual_destination does NOT mean the
        // flight went where it was planned to. Nothing here defaults.
        // ====================================================================

        // Fuel on board at each OOOI event (WP-19). WP-19 defines trip burn as
        // OFF minus ON and neither operand existed until now. The four pair
        // with aobt / atot / aldt / aibt above.
        fob_at_out_kg       : Decimal(10,2);            // FOB at OUT  (aobt)
        fob_at_off_kg       : Decimal(10,2);            // FOB at OFF  (atot)
        fob_at_on_kg        : Decimal(10,2);            // FOB at ON   (aldt)
        fob_at_in_kg        : Decimal(10,2);            // FOB at IN   (aibt)
        // Reuses the FobSource type already declared for FUEL_DELIVERIES.
        // Declared WITHOUT a default, unlike FUEL_DELIVERIES.fob_source which
        // carries default 'NONE' - here an absent reading must stay absent.
        fob_source          : FobSource;                // How the four were obtained

        // Ground-gap boundaries (decisions C-4 and F20). C-4 splits the ground
        // gap at flight closure; F20 is the second gap, between fob_after and
        // push-back. SEMANTICS OF flight_start_utc ARE OPEN - engineering
        // release, outbound crew signing the tech log, or AOBT are three
        // different instants. Do not consume this assuming an answer.
        flight_closure_utc  : Timestamp;                // C-4 split point
        closure_source      : ClosureSource;            // How closure was obtained
        // WP-31. The tech log photograph the closure time was read off.
        // The ONLY field this package adds to FLIGHT_SCHEDULE - the other
        // nine in this block landed with WP-33.
        closure_document    : Association to SOURCE_DOCUMENTS;
        flight_start_utc    : Timestamp;                // F20 boundary. SEMANTICS OPEN
        start_source        : ClosureSource;            // How start was obtained

        // Actual stations flown (WP-07B convention: the value as received and
        // the value as resolved are different facts, and a diversion airport
        // may not be in the register at all).
        //
        // NAMING FOLLOWS origin / origin_airport ABOVE. DO NOT "FIX" IT.
        //
        // Read in isolation the convention looks backwards: `actual_origin` is
        // an ASSOCIATION and `actual_origin_airport` is the String(3) IATA
        // code, which is the opposite of what either name suggests. WP-33
        // originally specified them the other way round, which reads better on
        // its own and was rejected for that reason.
        //
        // Two pairs running opposite ways on ONE entity is a trap: someone
        // reading `actual_origin` and expecting a string gets an association.
        // CONSISTENCY WITHIN THE ENTITY BEATS BEING RIGHT IN ISOLATION. If the
        // convention is ever changed, change origin / destination in the same
        // commit or not at all.
        //
        // SEMANTICS OF NULL ARE OPEN - it may mean "no deviation" or "the feed
        // did not say". Those are different facts and nothing should assume one.
        actual_origin              : Association to MASTER_AIRPORTS;   // As resolved
        actual_origin_airport      : String(3);         // As received (IATA). SEMANTICS OPEN
        actual_destination         : Association to MASTER_AIRPORTS;   // As resolved
        actual_destination_airport : String(3);         // As received (IATA). SEMANTICS OPEN

}

// ============================================================================
// FLIGHT CYCLE EVENTS (Operations App — D-0 tracking)
// ============================================================================

/**
 * Flight Cycle Event Types
 * Landing → Taxi In → Chocks On → Refueling → Chocks Off → Taxi Out → Takeoff → Airborne
 */
type FlightCycleEventType : String(20) enum {
    LANDING     = 'LANDING';
    TAXI_IN     = 'TAXI_IN';
    CHOCKS_ON   = 'CHOCKS_ON';
    REFUELING   = 'REFUELING';
    CHOCKS_OFF  = 'CHOCKS_OFF';
    TAXI_OUT    = 'TAXI_OUT';
    TAKEOFF     = 'TAKEOFF';
    AIRBORNE    = 'AIRBORNE';
}

/**
 * FLIGHT_CYCLE_EVENTS
 * Tracks real-time flight turnaround events for D-0 operations monitoring.
 * Each event represents a milestone in the ground handling cycle.
 */
entity FLIGHT_CYCLE_EVENTS : cuid, AuditTrail {
    flight              : Association to FLIGHT_SCHEDULE @mandatory;
    fuel_order          : Association to FUEL_ORDERS;      // Optional link to fuel order
    event_type          : FlightCycleEventType @mandatory;
    event_timestamp     : Timestamp @mandatory;            // When the event occurred
    recorded_by         : String(50);                      // User/system that recorded
    source_system       : String(30);                      // ACARS, AMS, Manual, etc.
    latitude            : Decimal(10,7);                   // GPS latitude
    longitude           : Decimal(10,7);                   // GPS longitude
    remarks             : String(500);                     // Free-text notes
    // WP-12: the five refuelling fields (uplift_kg, density_kg_l,
    // temperature_c, bowser_id, sequence_number) are removed. Three places
    // holding fuel quantities is one too many. Quantity, density and
    // temperature live on FUEL_TICKETS, where the meter is; the bowser is
    // the ticket's vehicle. This is a movement event log.
    //
    // Verified before removal: the sole reference anywhere was the wildcard
    // projection FuelOrderService.FlightCycleEvents. No handler, no
    // annotation, no UI and no seed CSV read these. Note that uplift_kg is
    // also a ROB_LEDGER field, which is where every other hit for that name
    // belongs.
}

// ============================================================================
// FUEL ORDERS MODULE (FDD-04)
// ============================================================================

/**
 * Order Status Enumeration
 * Draft → Submitted → Confirmed → InProgress → Delivered → Completed → Cancelled
 */
type OrderStatus : String(20) enum {
    Draft       = 'Draft';
    Submitted   = 'Submitted';
    Confirmed   = 'Confirmed';
    InProgress  = 'InProgress';
    Delivered   = 'Delivered';
    Completed   = 'Completed';
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
 * Ticket Match Status (WP-10, decision A1)
 *
 * Distinct from TicketStatus, which tracks the ticket's own workflow.
 * This tracks whether the fuel on it has been tied to an order.
 *
 * UNMATCHED is not an error state. It is a ticket awaiting attachment,
 * with an owner and an age.
 */
type TicketMatchStatus : String(20) enum {
    Unmatched      = 'UNMATCHED';       // No order. Capturable, chaseable, visible
    Matched        = 'MATCHED';         // Attached to an order
    MatchedNoPlan  = 'MATCHED_NO_PLAN'; // Order found, no fuel plan behind it
    NotExpected    = 'NOT_EXPECTED';    // Processing mode NONE, or no uplift was planned
}

/**
 * Density Unit of Measure (WP-12, decision B6)
 *
 * IATA VUOMBase. Two values, because two is what IATA transmits.
 *
 * NOT a row in UNIT_OF_MEASURE. That table holds *quantity* units and
 * carries attributes — conversion_to_kg, sap_uom, sap_uom_iso. A density
 * unit has none of those; it is a bare label saying what density_value is
 * per. A master table for two attribute-free values is over-engineering.
 *
 * @assert.range is not optional here. Per defect D25 a declared CDS enum
 * enforces nothing on its own — CAP validates only where the annotation is
 * present. Without it this type is a comment.
 */
@assert.range: true
type DensityUom : String(6) enum {
    KgPerLitre = 'KGL';   // kg per litre
    KgPerM3    = 'KGM';   // kg per cubic metre
}

/**
 * Source of the aircraft gauge (FQIS) reading (WP-12, decision B5; WP-34)
 *
 * The source governs how much the reading can be trusted, which is why it
 * is recorded alongside the number rather than assumed.
 *
 * ACARS_DERIVED is WP-34, closing defect D41 and the one unmet directive of
 * 01-TARGET-SCHEMA section 5. It records that the gauge figure was NOT read
 * off the aircraft but RECONSTRUCTED - fob_at_arrival plus the OUT reading,
 * adjusted for the APU burn in between (section 5, the uplift derivation).
 *
 * IT IS A SEPARATE MEMBER RATHER THAN A FLAG BESIDE 'ACARS' BECAUSE IT
 * CARRIES A DIFFERENT TOLERANCE. A derived reading inherits the error of its
 * derivation, and TOL-FOB-ACARS_DERIVED is looser than TOL-FOB-ACARS for that
 * reason. Recorded as 'ACARS' it would be held to the measured threshold and
 * would flag as a supplier discrepancy.
 *
 * @assert.range on this type predates WP-34. Adding a member WIDENS the
 * accepted set, so no existing writer or seed row is affected.
 */
@assert.range: true
type FobSource : String(20) enum {
    Acars         = 'ACARS';           // Downlinked. High confidence. MEASURED
    AcarsDerived  = 'ACARS_DERIVED';   // WP-34. IN/OUT adjusted for APU. DERIVED, not measured
    OcrConfirmed  = 'OCR_CONFIRMED';   // WP-31. Dial photographed, read, CONFIRMED. ACARS precision
    CrewReported  = 'CREW_REPORTED';   // Typically rounded to 100 kg
    PanelPreset   = 'PANEL_PRESET';    // What was requested, not what arrived
    None          = 'NONE';            // No reading
}

/**
 * Ground-handover source (WP-33, decisions C-4 and F20)
 *
 * Where a closure or start timestamp came from. NONE means no timestamp was
 * captured - it does NOT mean the gap is zero. A missing split point leaves
 * the ground gap unattributable, which is a different answer from attributing
 * all of it to one flight.
 */
@assert.range: true
type ClosureSource : String(20) enum {
    Ocr    = 'OCR';      // Read off a scanned handover document
    Manual = 'MANUAL';   // Keyed by a human
    None   = 'NONE';     // Not captured
}

/**
 * Order communication status (WP-33, decision C-3)
 *
 * C-3 branches on whether an order reached the supplier: an uncommunicated
 * order is amended in place, a communicated one takes an incremental order.
 * Without this the branch cannot be chosen at all.
 *
 * NOT_SENT and FAILED are not the same. FAILED means an attempt was made and
 * the outcome is unknown to us, which is the case that needs a human.
 */
@assert.range: true
type CommunicationStatus : String(20) enum {
    NotSent      = 'NOT_SENT';
    Sent         = 'SENT';
    Acknowledged = 'ACKNOWLEDGED';
    Failed       = 'FAILED';
}

/**
 * Order relationship (WP-33, decision C-3)
 *
 * How an order relates to its parent. AMENDMENT replaces the parent's figure;
 * INCREMENTAL adds to it. Summing across a chain without reading this would
 * double-count every amendment.
 */
@assert.range: true
type OrderRelationship : String(20) enum {
    Original    = 'ORIGINAL';
    Amendment   = 'AMENDMENT';
    Incremental = 'INCREMENTAL';
}

// ============================================================================
// THE EVIDENCE LAYER (WP-31, Document_Capture_Specification)
//
// Five points in the fuel lifecycle where a number is written on paper or
// shown on a dial and somebody has to get it into the system: the tech log,
// the cockpit gauge before and after, the supplier's fuel ticket, and the
// bowser meter. One mobile device photographs all five.
//
// THE IMAGE IS RETAINED WHETHER OCR SUCCEEDED OR NOT. It is not a
// convenience - it is the compliance record, so the number and its evidence
// arrive together and a disputed figure has a picture behind it eighteen
// months later. Deleting the image after a successful read destroys the
// evidence and keeps only the claim.
//
// @assert.range on each per D25. What the annotation does is stated in
// CLAUDE.md's trap row and is not restated here; note only that it does NOT
// reach a db.run write, which is how the WP-31 handlers write, so nothing
// here substitutes for a guard.
// ============================================================================

/**
 * What was photographed (WP-31, specification section 2)
 *
 * SIGNATURE_PILOT and SIGNATURE_CREW are here because the ePOD signatures
 * migrate INTO this model rather than staying beside it. Leaving them would
 * mean the signature is stored one way and the tech log photograph another,
 * for no reason but the order they were built in.
 */
@assert.range: true
type DocumentType : String(20) enum {
    TechLog         = 'TECH_LOG';           // Closure time, uplift as recorded, defects
    GaugeBefore     = 'GAUGE_BEFORE';       // FQIS before refuelling
    GaugeAfter      = 'GAUGE_AFTER';        // FQIS after refuelling
    FuelTicket      = 'FUEL_TICKET';        // The supplier's document
    BowserMeter     = 'BOWSER_METER';       // The supplier's instrument
    SignaturePilot  = 'SIGNATURE_PILOT';    // Migrated from FUEL_DELIVERIES
    SignatureCrew   = 'SIGNATURE_CREW';     // Migrated from FUEL_DELIVERIES
}

/**
 * How the image arrived (WP-31)
 */
@assert.range: true
type CaptureMethod : String(20) enum {
    MobileCamera = 'MOBILE_CAMERA';
    Upload       = 'UPLOAD';
    Email        = 'EMAIL';
}

/**
 * What the OCR engine managed (WP-31)
 *
 * NOT_ATTEMPTED is a first-class outcome, not a failure. A signature is not
 * read, it is held; and an image captured with no engine run is stored and
 * read by somebody later. FAILED likewise: capture is never blocked, which
 * is A1 applied to evidence - the fuel is already in the tanks and refusing
 * to record it because a photograph would not read puts money outside the
 * system.
 */
@assert.range: true
type OcrStatus : String(20) enum {
    NotAttempted = 'NOT_ATTEMPTED';   // Stored, no engine run. Somebody reads it later
    Read         = 'READ';            // The engine returned a value
    Partial      = 'PARTIAL';         // Some fields read, some not
    Failed       = 'FAILED';          // The engine could not read it. The IMAGE IS STILL STORED
}

/**
 * How an extracted value was obtained (WP-31, specification section 3)
 *
 * NOT a replacement for FUEL_TICKETS.ticket_source, which is IATA-04's
 * String(1) - M manual, E electronic - and belongs to an external standard.
 * Adding a third letter there for OCR would put a local value into a field
 * another party reads by the standard's rules. This sits beside it.
 */
@assert.range: true
type CaptureSource : String(20) enum {
    Ocr        = 'OCR';           // Photographed, read, and CONFIRMED by a person
    Manual     = 'MANUAL';        // Keyed
    Electronic = 'ELECTRONIC';    // The supplier sent a structured document
}

/**
 * SOURCE_DOCUMENTS - the evidence behind an extracted value (WP-31)
 *
 * THIS ENTITY HOLDS NO LINK BACK TO ITS SUBJECT. There is no flight, no
 * delivery and no ticket association here. A document is reached ONLY through
 * the field that cites it - closure_document, gauge_before_document,
 * signature_pilot_document and their siblings.
 *
 * An earlier draft declared both directions. THAT MODELS ONE RELATIONSHIP
 * TWICE, and two links can disagree with nothing saying which wins. The
 * reference lives on the parent field, beside the value it evidences, which
 * is also the only question anyone asks: where did THIS number come from,
 * never what did that image yield.
 *
 * THE COST IS RETRIEVAL. "Every image for this delivery" is a read of that
 * delivery's own four document fields rather than a filter here. At most four
 * per entity, so the cost is small and the ambiguity is gone.
 *
 * AND THE CONSEQUENCE TO WATCH: a document row exists briefly before the
 * parent field is set. WRITE BOTH IN ONE TRANSACTION, or an unreferenced
 * document is a photograph nobody can find.
 *
 * Do NOT build an OCR_EXTRACTIONS table. It would be correct and nobody
 * would ever query it.
 *
 * AuditTrail, not CAP's managed - 65 entities in this schema use the former
 * and 1 uses the latter, and they are different columns.
 */
entity SOURCE_DOCUMENTS : cuid, AuditTrail {
        @assert.range: true
        document_type    : DocumentType   @mandatory;

        // THE IMAGE LIVES IN THE OBJECT STORE, NOT IN THE ROW. LargeBinary
        // is what the ePOD signatures use today and it is fine at a few
        // kilobytes; a photographed tech log is 2 to 5 MB, and putting those
        // in HANA rows is a mistake nobody notices until the table is large.
        //
        // NO OBJECT STORE IS PROVISIONED. mta.yaml carries hana, xsuaa,
        // destination, application-logs and connectivity, and nothing else.
        // INT404 "object store upload failed" is a designed code with nothing
        // behind it. This is the contract; the bytes cannot move until the
        // service exists. See D19(b) for the same shape.
        image_uri        : String(500)    @mandatory;
        // So the record can prove WHICH image it referred to. A URI can be
        // repointed; a hash cannot be talked out of.
        image_hash       : String(64);

        @assert.range: true
        capture_method   : CaptureMethod  @mandatory;
        captured_by      : String(50)     @mandatory;
        captured_at      : Timestamp      @mandatory;
        capture_station  : String(3);

        @assert.range: true
        ocr_status       : OcrStatus      @mandatory;
        // Threshold-checked in a HANDLER, not by an annotation - the
        // threshold resolves from TOLERANCE_RULES and an annotation is a
        // compile-time literal that cannot read a store. That reason holds
        // whatever @assert.range does, which is why it is the one stated.
        ocr_confidence   : Decimal(5,2);
        ocr_engine       : String(50);
        // AUDIT ONLY. Never read by anything downstream. The CONFIRMED value
        // is what is used, and it lives on the parent field beside the
        // meaning, not here.
        ocr_raw          : LargeString;

        // What makes a figure defensible. ocr_status = READ with
        // confirmed_by null IS A NUMBER NOBODY HAS LOOKED AT, and it must
        // never render as a confirmed one.
        confirmed_by     : String(50);
        confirmed_at     : Timestamp;

        // From FUEL_DELIVERIES.signature_location, generalised: GPS is worth
        // having on every capture, not only on signatures.
        capture_location : String(100);
}


/**
 * FOB reconciliation status (WP-12, decision B5)
 *
 * NOT_RECONCILED must never read as a pass. A missing gauge reading is
 * unknown, not agreed — the two are opposite conclusions and collapsing
 * them turns an absent measurement into a clean bill of health.
 *
 * NOT_ATTRIBUTABLE exists because one FQIS pair across two suppliers
 * produces one variance figure that belongs to neither. Pro-rata
 * allocation by volume is arithmetically neat and evidentially
 * worthless — never use it to raise a dispute.
 *
 * The values land in WP-12. The control that sets them is WP-17.
 */
@assert.range: true
type ReconStatus : String(20) enum {
    Reconciled      = 'RECONCILED';
    Variance        = 'VARIANCE';
    NotReconciled   = 'NOT_RECONCILED';    // No gauge reading. NOT agreement
    NotAttributable = 'NOT_ATTRIBUTABLE';  // Multi-supplier: one gauge pair, two suppliers
}

/**
 * Cockpit Crew Review Status (Step 4 of 7-step journey)
 */
type CrewReviewStatus : String(20) enum {
    Pending   = 'PENDING';
    Confirmed = 'CONFIRMED';
    Adjusted  = 'ADJUSTED';
    Skipped   = 'SKIPPED';
}

/**
 * Sales Order Status (Supplier/Refueler Perspective)
 */
type SalesOrderStatus : String(20) enum {
    Received    = 'RECEIVED';
    Confirmed   = 'CONFIRMED';
    Scheduled   = 'SCHEDULED';
    InDelivery  = 'IN_DELIVERY';
    Delivered   = 'DELIVERED';
    Invoiced    = 'INVOICED';
    Closed      = 'CLOSED';
    Cancelled   = 'CANCELLED';
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
        // WP-11 / A2: order and delivery in litres, planning in kilograms.
        // LTR is a FALLBACK, not a rule — the unit is the supplier's choice
        // (AFSMA). Resolution order is supplier contract, then station, then
        // this default; contract and station configuration arrive with WP-13.
        uom_code            : String(3) default 'LTR';

        // WP-11: evidence for the plan-mass to order-volume conversion.
        // Without all three the order records a converted number nobody can
        // reproduce.
        conversion_density  : Decimal(8,4);   // kg/L used to convert plan mass to order volume
        conversion_source   : String(20);     // Which configuration row produced it
        ordered_quantity_kg : Decimal(12,2);  // The plan figure this order was converted from

        // Quantity & Pricing
        ordered_quantity    : Decimal(12,2) @mandatory; // Ordered fuel quantity (kg)
        unit_price          : Decimal(15,4);            // Unit price from CPE
        total_amount        : Decimal(15,2);            // Total order amount
        currency            : Association to CURRENCY_MASTER on currency.currency_code = currency_code;
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

        // Dispatch System Reference
        dispatch_fuel_order_id : String(20);            // Fuel Order ID from dispatch system (e.g. Legate TripRecord)

        // WP-18 section 9.5. FLIGHT_DISPATCH points at the order; the order
        // pointed at no plan, so there was no way to say which plan an order
        // was created against. Without this, versioning closes nothing.
        //
        // Consequence, per A7: an order whose plan has since been superseded
        // is stale BY CONSTRUCTION. No field comparison is needed - the
        // question is only whether this order's plan is still the active one.
        dispatch_plan       : Association to FLIGHT_DISPATCH;

        // Cockpit Crew Review (Step 4 of 7-step journey)
        crew_review_status      : CrewReviewStatus;              // Crew review outcome
        crew_reviewed_by        : String(100);                   // Captain name/ID
        crew_reviewed_at        : DateTime;                      // Review timestamp
        crew_adjusted_quantity  : Decimal(12,2);                 // Crew-adjusted fuel qty (if different)
        crew_adjustment_reason  : String(500);                   // Reason for adjustment
        crew_notes              : String(1000);                  // Crew operational notes

        // Notes & Comments
        notes               : String(1000);             // Order notes/special instructions

        // Cancellation
        cancelled_reason    : String(500);              // Reason for cancellation
        cancelled_by        : String(100);              // User who cancelled
        cancelled_at        : DateTime;                 // Cancellation timestamp

        // Composition: One order can have multiple deliveries and tickets
        deliveries          : Composition of many FUEL_DELIVERIES on deliveries.order = $self;
        tickets             : Composition of many FUEL_TICKETS on tickets.order = $self;

        // ====================================================================
        // WP-33 - the design-review fields. PURELY ADDITIVE, all optional.
        // ====================================================================

        // Communication (decision C-3). C-3 gates on whether an order reached
        // the supplier: uncommunicated is amended in place, communicated takes
        // an incremental order. Neither branch was selectable before this.
        communicated_at         : Timestamp;            // When it went to the supplier
        communication_status    : CommunicationStatus;  // No default - absent is not NOT_SENT
        communication_reference : String(50);           // Carrier's message reference

        // Order chaining (decision C-3). Self-association; the generated
        // foreign key is parent_order_ID because FUEL_ORDERS is cuid.
        parent_order            : Association to FUEL_ORDERS;
        order_relationship      : OrderRelationship;    // No default - see below

        // Tankering. is_tankering and refuel_complete are the only two of the
        // twenty-six that carry a default, and they carry it because WP-33
        // specifies it. An omitted insert therefore reads false, not null;
        // an explicit null is stored and read back as null.
        is_tankering            : Boolean default false;
        tankering_sectors       : Integer;              // Sectors the uplift covers

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
        // WP-10 / decision B2: the delivery hangs off the aircraft, not the
        // order. A refuelling with two suppliers has two orders and one
        // delivery, so a mandatory FK to one of them is wrong. Orders resolve
        // transitively through the tickets.
        order               : Association to FUEL_ORDERS;
        aircraft_reg        : String(10) @mandatory;    // Join key: tail + date + departure time (REQ-FL-010)
        // WP-07B / decisions B1 and A4. ADDITIVE — the string above keeps its
        // existing constraint and this is optional, always.
        //
        // Named `tail`, not `aircraft`. On four of these seven entities
        // `aircraft` is already an association to AIRCRAFT_MASTER — the TYPE
        // master, keyed on type_code — and @mandatory on three of them. The
        // same name would mean type in one place and tail in another.
        //
        // Both are retained deliberately. The string is the value AS RECEIVED
        // and survives a registration the register has never seen; replacing
        // it would make an unknown tail structurally impossible to record, and
        // then no parameter could permit one.
        tail                : Association to AIRCRAFT_REGISTRATIONS;
        sales_order         : Association to FUEL_SALES_ORDERS;  // Link to supplier's sales order
        delivery_number     : String(25) @mandatory;    // EPD-{STATION}-{YYYYMMDD}-{SEQ}

        // Delivery Details
        delivery_date       : Date @mandatory;          // Actual delivery date
        delivery_time       : Time @mandatory;          // Actual delivery time
        delivered_quantity  : Decimal(12,2) @mandatory; // Actual delivered quantity
        uom_code            : String(3) default 'LTR';  // WP-11: unit of the delivered quantity

        // Quality Measurements (FDD-05 validation rules)
        //
        // WP-13 / D30 — THE ANNOTATIONS ARE CONVERTED TO COMMENTS, NOT DELETED.
        //
        //     @assert.range: [-40, 50]     VAL-EPD-003, EPD403
        //     @assert.range: [0.775, 0.840] VAL-EPD-004, EPD404
        //
        // They ENFORCED. Measured before removal: on a draft-enabled entity
        // CAP defers input validation to draftActivate, and both rejected
        // there with the bound named. They are removed for one reason only —
        // AN ANNOTATION CANNOT READ A CONFIGURATION STORE, so leaving them
        // live would mean the store moves and the enforced bound does not.
        //
        // Enforced now by EPD403 and EPD404 in order-service.js, resolved
        // from TOLERANCE_RULES rows TOL-EPD-TEMP and TOL-EPD-DENSITY, at the
        // same values. Deleting outright would lose the documented intent;
        // leaving them live would keep something that looks like enforcement
        // and no longer is.
        temperature         : Decimal(5,2);             // Fuel temperature (°C). EPD403, resolved
        density             : Decimal(8,4);             // Measured density (kg/L). EPD404, resolved
        // WP-12 naming debt, accepted deliberately. The name implies a
        // density correction. It is not one - the computation is the
        // volumetric ASTM D1250 factor, Measured x [1 - 0.00099 x (T - 15)],
        // and density is not an input to it. Renaming an existing field is
        // prohibited by 05-CONVENTIONS.md section 6 and this one sits in
        // projections and seed data, so the name stays and the discrepancy
        // is recorded here instead. Thermal expansion acts on volume, so
        // the value is null wherever uom_code is a mass unit.
        temperature_corrected_qty : Decimal(12,2);      // Volumetric correction to 15C ref. NULL where uom_code is mass

        // Delivery Vehicle & Personnel
        vehicle_id          : String(20);               // Delivery vehicle ID
        driver_name         : String(100);              // Driver name

        // ====================================================================
        // WP-31 STEP 4 - THE FIRST FIELD REMOVAL THIS PROJECT HAS MADE.
        //
        // Four fields left here:
        //
        //     pilot_signature       -> SOURCE_DOCUMENTS.image_uri + image_hash
        //     ground_crew_signature -> SOURCE_DOCUMENTS.image_uri + image_hash
        //     signature_timestamp   -> SOURCE_DOCUMENTS.captured_at
        //     signature_location    -> SOURCE_DOCUMENTS.capture_location
        //
        // They were stored, not evidenced: two LargeBinary images with no
        // source, no confirmation and no hash. And the comment that stood
        // here read "stored as base64 or reference to Object Store" - an
        // undecided decision sitting in a comment, which is D28's class.
        //
        // The names STAY. pilot_name and ground_crew_name are the ePOD's
        // record of who was present, EPD402 gates on them, and they are not
        // evidence of an image.
        //
        // Removed only after step 3 proved zero readers remained. A removal
        // that fails loudly is recoverable; one that fails quietly is D32.
        // ====================================================================
        pilot_name          : String(100);              // Pilot name
        ground_crew_name    : String(100);              // Ground crew name

        // ====================================================================
        // WP-31 step 2 - the evidence layer reaches this entity.
        //
        // FOUR associations, not two. The gauge pair evidences the readings;
        // the signature pair is HOW THE MIGRATED SIGNATURES ARE REACHED AT
        // ALL. SOURCE_DOCUMENTS holds no link back to its subject, so a
        // document with no field citing it is a photograph nobody can find -
        // and step 4 removes the last thing pointing at these.
        //
        // The four fields above are still here and still hold their values.
        // They leave in step 4, and only once step 3 has proved zero readers
        // remain. A removal that fails loudly is recoverable; one that fails
        // quietly is D32.
        // ====================================================================
        gauge_before_document   : Association to SOURCE_DOCUMENTS;
        gauge_after_document    : Association to SOURCE_DOCUMENTS;
        signature_pilot_document : Association to SOURCE_DOCUMENTS;
        signature_crew_document  : Association to SOURCE_DOCUMENTS;

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

        // ------------------------------------------------------------------
        // Aircraft gauge pair - WP-12, decision B5
        //
        // The FQIS belongs to the AIRCRAFT, so it belongs to the refuelling
        // event: one pair per event, however many bowsers were used. The
        // meter belongs to the bowser and lives on FUEL_TICKETS.
        //
        // These are kilograms unconditionally. An FQIS reports mass; there
        // is no unit to resolve and so no uom_code on this block.
        // ------------------------------------------------------------------

        // Two arrival readings, not one - REQ-FL-003. They are DIFFERENT
        // measurements, and between them sits ground time: temperature
        // change, APU running, any defuel or transfer. An aircraft landing
        // at 10:00 and refuelling at 14:00 has four hours of drift.
        //
        // Where only one reading exists, populate fob_before_kg and leave
        // fob_at_arrival_kg null. Copying one into the other manufactures a
        // zero ground burn where the truth is unknown.
        fob_at_arrival_kg   : Decimal(12,2);            // ROB at chocks-on, end of the arriving leg
        fob_before_kg       : Decimal(12,2);            // Immediately before uplift. The reconciliation input
        fob_after_kg        : Decimal(12,2);            // Immediately after uplift

        // Derived. fob_before_kg is the reconciliation input, not the
        // arrival reading - using arrival would put ground-time drift into
        // the delivery variance, where it reads as a supplier discrepancy.
        fob_delta_kg        : Decimal(12,2);            // Derived: fob_after - fob_before
        // Mostly APU burn, which is never metered. Nothing consumes this
        // until WP-19, but without both readings recorded nobody can see
        // there is a difference to explain.
        ground_burn_kg      : Decimal(12,2);            // Derived: fob_at_arrival - fob_before

        fob_source          : FobSource default 'NONE';
        fob_rounding_kg     : Integer default 0;        // 100 where crew-reported. Sets the tolerance floor

        // Reconciliation. The fields land in WP-12; the control that
        // populates them is WP-17 (EPD461-EPD466).
        recon_variance_kg   : Decimal(12,2);            // EPD461: sum of ticket quantity_kg minus fob_delta_kg
        recon_status        : ReconStatus default 'NOT_RECONCILED';
        supplier_count      : Integer;                  // Derived. Attribution requires exactly 1
        delivery_method     : String(3);                // IATA-02: HYD hydrant, REF refueller

        // ====================================================================
        // WP-33 - the refuelling window (decision F2). fob_before_kg and
        // fob_after_kg above say WHAT the gauge read; nothing said WHEN.
        // F22 is the completion signal - IATA's message carries one, the
        // manual path has none.
        // ====================================================================
        refuel_start_utc    : Timestamp;                // F2. Window opens
        refuel_end_utc      : Timestamp;                // F2. Window closes
        refuel_complete     : Boolean default false;    // F22. Completion signal

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
        // WP-10 / decision A1: NOT mandatory. Fuel is routinely delivered with
        // no order in the system - a verbal post-freeze top-up, a diversion
        // uplift at an uncontracted station, fuel put on a reassigned tail.
        // The alternative to recording it is a fabricated order, which
        // corrupts order data permanently to satisfy a foreign key.
        order               : Association to FUEL_ORDERS;
        @assert.range: true
        match_status        : TicketMatchStatus default 'UNMATCHED';
        ticket_source       : String(1) default 'M';    // IATA-04: M manual, E electronic

        // ====================================================================
        // WP-31 - the evidence behind the ticket.
        //
        // TWO DOCUMENTS, AND THEY ARE DIFFERENT PHOTOGRAPHS: the paper ticket
        // and the bowser's meter face. Where one supplier prints the meter
        // reading on the ticket itself, ONE document may serve both fields -
        // do not force a second photograph to satisfy a model.
        //
        // ticket_capture_source sits BESIDE ticket_source and does not
        // replace it. ticket_source is IATA-04's one-character code and
        // belongs to an external standard; adding a third letter for OCR
        // would put a local value into a field another party reads by the
        // standard's rules.
        // ====================================================================
        ticket_document       : Association to SOURCE_DOCUMENTS;
        meter_document        : Association to SOURCE_DOCUMENTS;
        @assert.range: true
        ticket_capture_source : CaptureSource;          // How the values were obtained
        delivery            : Association to FUEL_DELIVERIES;  // Optional link to specific delivery

        ticket_number       : String(50) @mandatory;    // Physical ticket number from supplier
        internal_number     : String(25);               // FT-{STATION}-{YYYYMMDD}-{SEQ}

        // Flight Reference
        aircraft_reg        : String(10);               // Aircraft registration
        // WP-07B / decisions B1 and A4. ADDITIVE — the string above keeps its
        // existing constraint and this is optional, always.
        //
        // Named `tail`, not `aircraft`. On four of these seven entities
        // `aircraft` is already an association to AIRCRAFT_MASTER — the TYPE
        // master, keyed on type_code — and @mandatory on three of them. The
        // same name would mean type in one place and tail in another.
        //
        // Both are retained deliberately. The string is the value AS RECEIVED
        // and survives a registration the register has never seen; replacing
        // it would make an unknown tail structurally impossible to record, and
        // then no parameter could permit one.
        tail                : Association to AIRCRAFT_REGISTRATIONS;
        flight_number       : String(10);               // Flight number

        // ------------------------------------------------------------------
        // Quantity and measurement - WP-12, decisions B5 and B6
        //
        // Store as metered, derive canonical. The as-metered figure must
        // survive unaltered: it is what the supplier invoices and what a
        // dispute is about. quantity_kg is the derived figure reconciliation,
        // burn and valuation compare against.
        //
        // The field names deliberately carry NO unit. An earlier draft
        // specified quantity_litres and density_kg_per_l, which bake in an
        // assumption that does not hold - a gallon ticket has no litres
        // figure, and its density is per gallon. uom_code and density_uom
        // say what the numbers are in.
        // ------------------------------------------------------------------

        quantity            : Decimal(15,2) @mandatory; // The supplier's CLAIMED figure, in uom_code
        uom_code            : String(3) default 'LTR';  // WP-11: fallback default; the supplier's metering unit governs

        // The meter belongs to the BOWSER, so it belongs here, one per
        // vehicle. The aircraft gauge pair belongs to the refuelling event
        // and lives on FUEL_DELIVERIES.
        meter_start         : Decimal(15,2);            // In uom_code
        meter_end           : Decimal(15,2);            // In uom_code
        quantity_metered    : Decimal(15,2);            // Derived: meter_end - meter_start. In uom_code

        // Delivered density, per uom_code. Decision B6 makes this
        // authoritative for deriving mass - NOT the planning factor on
        // UNIT_OF_MEASURE, which is a forward estimate for converting a plan.
        density_value       : Decimal(8,4);
        density_uom         : DensityUom;               // IATA VUOMBase. KGL kg/litre, KGM kg/m3
        density_basis       : String(3) default 'MEA';  // IATA-01: MEA measured, STD standard
        density_temp_c      : Decimal(5,2);             // Temperature the density was measured at

        // IATA-12. Net is temperature-corrected, gross is not. Without this
        // no quantity in the system states which basis it is on.
        quantity_flag       : String(2) default 'GR';   // GR gross, NT net

        // Derived, and the whole point of deriving it: a gallon ticket and a
        // litre ticket on the same aircraft must be summable. The
        // reconciliation compares the sum of these against fob_delta_kg.
        quantity_kg         : Decimal(15,2);            // EPD453: quantity_metered x density_value, normalised to kg

        batch_coa_ref       : String(50);               // Certificate of analysis, for density disputes

        // Timing
        delivery_timestamp  : DateTime @mandatory;      // Delivery date/time from ticket

        // Supplier Reference
        supplier_ticket_ref : String(50);               // Supplier's ticket reference

        // Status
        status              : TicketStatus default 'Open';

        // Verification
        verified_by         : String(100);              // User who verified
        verified_at         : DateTime;                 // Verification timestamp

        // ====================================================================
        // WP-33 - equipment identity. meter_start and meter_end above are
        // readings; neither says which meter produced them.
        // ====================================================================
        vehicle_id          : String(20);               // Delivery vehicle
        meter_serial        : String(30);               // Meter that produced the readings

}

// ============================================================================
// WHAT A FLIGHT REACHES - two views, and why they are views
//
// A flight cannot hold `deliveries` or `tickets` as an association. The
// compiler refuses it:
//
//     Can follow managed association "FUEL_DELIVERIES:order" only to the
//     keys of its target, not to "flight"
//
// An association's ON condition may follow a MANAGED association only to its
// target's KEYS, and `flight` is not one. A derived to-one on the delivery
// (`on flight.ID = order.flight_ID`) is refused for the same reason, so it is
// a constraint rather than an awkwardness.
//
// A VIEW'S SELECT LIST HAS NO SUCH RESTRICTION. The hop happens here, and the
// association that reaches the view then compares two PLAIN COLUMNS -
// `deliveries.flight_ID = ID` - which is not following anything.
//
// THE JOIN IS ON A FOREIGN KEY, NOT A BUSINESS KEY. It resolves through
// order_ID. A join on tail plus date over-matches on five of thirteen pairs
// in this seed - every one of those flights would list the other's fuel.
//
// AND IT UNDER-MATCHES, DELIBERATELY. A delivery or ticket with no order has
// a null flight_ID and appears under no flight. WP-10 allows a ticket without
// an order on purpose, and S5 is a scenario built on it - fuel that arrived
// with no order is not attributable to a flight through one.
//
// READ-ONLY. A view over a draft-enabled entity cannot be written through.
// These exist to be looked at.
// ============================================================================

/**
 * FLIGHT_FUEL_DELIVERIES - deliveries, as a flight reaches them.
 */
entity FLIGHT_FUEL_DELIVERIES as select from FUEL_DELIVERIES {
    key ID,
        order,
        order.flight.ID       as flight_ID,
        delivery_number,
        delivery_date,
        delivered_quantity,
        uom_code,
        fob_delta_kg,
        fob_source,
        recon_variance_kg,
        recon_status,
        supplier_count,
        aircraft_reg,
        tail
};

/**
 * FLIGHT_FUEL_TICKETS - tickets, as a flight reaches them.
 *
 * `supplier_name` resolves TRANSITIVELY through the order, which is the only
 * place it lives - FUEL_TICKETS has no supplier of its own. That is what
 * makes an unmatched ticket's supplier genuinely unknown rather than blank.
 */
entity FLIGHT_FUEL_TICKETS as select from FUEL_TICKETS {
    key ID,
        order,
        order.flight.ID              as flight_ID,
        order.supplier.supplier_name as supplier_name : String(100),
        ticket_number,
        quantity_metered,
        uom_code,
        quantity_kg,
        density_value,
        match_status,
        delivery_timestamp,
        aircraft_reg,
        tail,
        delivery
};

// ============================================================================
// FUEL SALES ORDERS (Supplier/Refueler Perspective - Scenario B)
// ============================================================================

/**
 * FUEL_SALES_ORDERS - Supplier-side sales order entity
 * Represents the same fuel transaction from the refueler/supplier perspective.
 * Has its own lifecycle independent from the airline's FUEL_ORDERS.
 *
 * Sales Order Format: SO-{STATION}-{YYYYMMDD}-{SEQ}
 * Example: SO-YYZ-20260325-001
 */
entity FUEL_SALES_ORDERS : cuid, AuditTrail {
        // Sales Order Identity
        sales_order_number   : String(25) @mandatory;    // SO-{STATION}-{YYYYMMDD}-{SEQ}

        // Link to airline's purchase order (if exists)
        purchase_order       : Association to FUEL_ORDERS;
        customer_order_number: String(25);               // Airline's FO number

        // Customer (the airline buying fuel)
        customer_airline     : String(100) @mandatory;   // e.g., "Air Canada"
        customer_airline_code: String(3);                // IATA code (e.g., AC)

        // Flight Reference
        flight               : Association to FLIGHT_SCHEDULE;
        flight_number        : String(10);
        flight_date          : Date;

        // Station (Delivery Location)
        airport              : Association to MASTER_AIRPORTS;
        station_code         : String(3) @mandatory;

        // Supplier (self - the refueling company)
        supplier             : Association to MASTER_SUPPLIERS;
        contract             : Association to MASTER_CONTRACTS;

        // Product
        product              : Association to MASTER_PRODUCTS;
        uom_code             : String(3) default 'KG';

        // Quantities (progressive enrichment)
        estimated_quantity   : Decimal(12,2);             // Historical/estimated uplift
        requested_quantity   : Decimal(12,2);             // From airline PO (if received)
        crew_confirmed_qty   : Decimal(12,2);             // Cockpit crew confirmed
        delivered_quantity   : Decimal(12,2);             // Actual delivered

        // Pricing & Revenue
        unit_price           : Decimal(15,4);
        total_amount         : Decimal(15,2);
        currency_code        : String(3) default 'USD';

        // Delivery Planning
        scheduled_date       : Date;
        scheduled_time       : Time;
        vehicle_id           : String(20);               // Bowser/tanker ID
        driver_name          : String(100);

        // Status & Timing
        status               : SalesOrderStatus default 'RECEIVED';
        confirmed_at         : DateTime;
        delivered_at         : DateTime;
        invoiced_at          : DateTime;

        // Invoice Reference (supplier invoices the airline)
        invoice_number       : String(25);
        invoice_date         : Date;
        invoice_amount       : Decimal(15,2);

        // Notes
        notes                : String(1000);

        // Compositions
        delivery_records     : Composition of many FUEL_DELIVERIES
                               on delivery_records.sales_order = $self;
}

// ============================================================================
// FLIGHT DISPATCH (FDD-04 - Dispatch Data from External Systems)
// ============================================================================

/**
 * Dispatch plan status (WP-18, DSP452)
 *
 * Exactly one row per plan_group_id may be ACTIVE. A superseded version is
 * never updated in place - DSP453 - so the history of a plan family is the
 * set of its rows, and the current plan is the one ACTIVE row.
 *
 * @assert.range because a declared CDS enum enforces nothing without it (D25).
 */
@assert.range: true
type PlanStatus : String(20) enum {
    Active     = 'ACTIVE';
    Superseded = 'SUPERSEDED';
}

/**
 * Where plan_version came from (WP-18)
 *
 * Not in the specification, added under the standing rule that a derived
 * value records what produced it - the same reason conversion_source and
 * fob_source exist.
 *
 * It is load-bearing here. Section 9.2 states that a gap can only be DETECTED
 * where the version arrives on the feed; where it is assigned on receipt,
 * gaps are invisible. Without this field version_gap_flag = false is
 * ambiguous between "no gap" and "could not tell", and an unknown must never
 * read as a pass.
 */
@assert.range: true
type PlanVersionSource : String(10) enum {
    Feed     = 'FEED';       // The source supplied a version. Gaps are detectable
    Assigned = 'ASSIGNED';   // Assigned on receipt from arrival order. Gaps are invisible
}

/**
 * FLIGHT_DISPATCH - Dispatch data from external systems
 * Source: Legate TripRecord, Manual, SmartDoc
 * Volume: ~200,000/year
 *
 * Matched to FLIGHT_SCHEDULE by flight_number + flight_date
 * Updates FUEL_ORDERS.dispatch_fuel_order_id on upload
 */
entity FLIGHT_DISPATCH : cuid, AuditTrail {
        // Match Keys
        dispatch_order_id       : String(20) @mandatory;    // External dispatch system's Fuel Order ID (e.g. FO-2026-00101)
        flight_number           : String(10) @mandatory;    // Must match FLIGHT_SCHEDULE
        flight_date             : Date @mandatory;          // Must match FLIGHT_SCHEDULE

        // Associations
        flight_schedule         : Association to FLIGHT_SCHEDULE;
        fuel_order              : Association to FUEL_ORDERS;

        // Aircraft & Crew
        tail_number             : String(10);               // Aircraft registration at dispatch (e.g. A6-EGD)
        // WP-07B / decisions B1 and A4. ADDITIVE — the string above keeps its
        // existing constraint and this is optional, always.
        //
        // Named `tail`, not `aircraft`. On four of these seven entities
        // `aircraft` is already an association to AIRCRAFT_MASTER — the TYPE
        // master, keyed on type_code — and @mandatory on three of them. The
        // same name would mean type in one place and tail in another.
        //
        // Both are retained deliberately. The string is the value AS RECEIVED
        // and survives a registration the register has never seen; replacing
        // it would make an unknown tail structurally impossible to record, and
        // then no parameter could permit one.
        tail                : Association to AIRCRAFT_REGISTRATIONS;
        captain_id              : String(20);               // Captain employee or license ID (e.g. CAP-10234)
        dispatcher_id           : String(20);               // Dispatcher employee ID (e.g. DSP-00456)

        // Timing
        atd                     : DateTime;                 // Actual Time of Departure (UTC)
        ata                     : DateTime;                 // Actual Time of Arrival (UTC)
        atd_local               : DateTime;                 // Actual Time of Departure (station local time)
        ata_local               : DateTime;                 // Actual Time of Arrival (station local time)
        std_gst                 : DateTime;                 // Scheduled Time of Departure (GST reference clock)
        sta_gst                 : DateTime;                 // Scheduled Time of Arrival (GST reference clock)
        atd_gst                 : DateTime;                 // Actual Time of Departure (GST reference clock)
        ata_gst                 : DateTime;                 // Actual Time of Arrival (GST reference clock)
        dispatch_timestamp      : DateTime;                 // When dispatch was officially released (UTC)

        // Quantities
        dispatch_qty_kg         : Decimal(10,2);            // Dispatcher-confirmed uplift quantity (kg)

        // ------------------------------------------------------------------
        // The regulated fuel stack - WP-18, decision B3
        //
        // dispatch_qty_kg alone cannot support a fuel variance: it is one
        // number where regulation requires seven, and every variance analysis
        // needs to know which component moved.
        //
        // additional and extra are held SEPARATELY and must not be merged.
        // Additional is a planned requirement - EDTO, anticipated delay.
        // Extra is the commander's discretion. Merging them loses the
        // distinction between what the operation required and what the
        // commander chose, which is the only interesting question about them.
        // DSP454.
        // ------------------------------------------------------------------
        trip_fuel_kg            : Decimal(12,2);            // Takeoff to touchdown
        contingency_fuel_kg     : Decimal(12,2);
        alternate_fuel_kg       : Decimal(12,2);
        final_reserve_kg        : Decimal(12,2);
        additional_fuel_kg      : Decimal(12,2);            // EDTO, anticipated delay. PLANNED
        taxi_fuel_kg            : Decimal(12,2);
        extra_fuel_kg           : Decimal(12,2);            // Commander's discretion. NOT planned

        // DSP450. Derived from the seven components, never keyed.
        // dispatch_qty_kg is retained as the dispatcher-confirmed figure and
        // should equal it.
        block_fuel_kg           : Decimal(12,2);
        // DSP451. Block less the fuel already on board.
        required_uplift_kg      : Decimal(12,2);

        // ------------------------------------------------------------------
        // Plan versioning - WP-18, decision A7
        //
        // Three axes, none substituting for another:
        //   plan_group_id      the flight leg's plan family. Never changes
        //   plan_version       the plan revision. Changes on EVERY re-plan
        //   dispatch_order_id  the commercial commitment. Changes only when
        //                      the order was already confirmed to the supplier
        //
        // The fuel order ID is stable through a re-plan before confirmation
        // and new after it, so it marks a commercial boundary rather than a
        // plan revision and cannot be the family key.
        // ------------------------------------------------------------------

        // DSP452. Derived from the linked flight's flight_leg_id, so it
        // survives a tail swap.
        plan_group_id           : String(40);

        // NOT CONTIGUOUS. STG412: the feed transmits the current plan only,
        // so missing intermediate versions will never arrive. v1 then v4 is
        // normal, not an error - apply v4, flag the gap, do not hold.
        plan_version            : Integer;
        plan_version_source     : PlanVersionSource;        // FEED or ASSIGNED. See the type

        plan_status             : PlanStatus default 'ACTIVE';
        superseded_by           : Association to FLIGHT_DISPATCH;

        // DSP456. Stamped on the applied row and NEVER back-updated - they
        // record what was known when this version was applied, not what is
        // known now.
        version_gap_flag        : Boolean default false;
        versions_skipped        : Integer default 0;
        rob_departure_kg        : Decimal(10,2);            // Remaining On Board at chocks-off (kg)
        payload_kg              : Decimal(10,2);            // Actual payload weight (kg) - for Jeppesen burn calc
        payload_plan_kg         : Decimal(10,2);            // Planned payload from the flight plan, capped by MZFW
        arrival_rob_plan_kg     : Decimal(12,2);            // Planned/estimated ROB at arrival, used to project the next sector's fuel needs

        // Flight Data
        flight_level            : Integer;                  // Planned cruise flight level (e.g. 350)
        wind_component          : Decimal(5,1);             // Average wind component in knots (+headwind/-tailwind)
        alternate_airport       : String(3);                // IATA code of alternate airport

        // Source & References
        dispatch_source         : String(15);               // TRIPRECORD | MANUAL | SMARTDOC
        ofplan_reference        : String(30);               // Operational Flight Plan reference (e.g. OFP-EK001-20260316)
        remarks                 : String(200);              // Operational notes (e.g. Extra fuel for EDTO)
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
        version_id          : String(50) @mandatory;      // PV-{TYPE}-{YEAR}-{SEQ}
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
        source_formula      : Association to PRICING_FORMULAS; // Source formula (if derived) - WP-08

        // Index Reference (if derived)
        base_index          : Association to MARKET_INDICES;   // Base index used - WP-08
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
    Submitted   = 'SUBMITTED';   // WP-09: the documented flow's step between Draft and the three-way match
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
/**
 * WP-21A — Check severity.
 *
 * Three rungs, and the difference between them is WHAT A HUMAN CAN DO:
 *
 *   WARNING     recorded, visible on the invoice, does not gate
 *   SOFT_ERROR  gates, and an authorised user may bypass it with a reason
 *   HARD_ERROR  gates, and nobody may bypass it. It needs a corrected
 *               invoice from the vendor, or master data created or fixed
 *
 * @assert.range because D25: a CDS enum validates nothing without it.
 */
@assert.range: true
type CheckSeverity : String(20) enum {
    Warning     = 'WARNING';
    SoftError   = 'SOFT_ERROR';
    HardError   = 'HARD_ERROR';
}

/**
 * WP-21A — Exception lifecycle.
 *
 * BYPASSED is not CLEARED. A cleared exception stopped being true; a
 * bypassed one is still true and someone accepted it anyway. Collapsing
 * them would lose the only evidence that a judgement was made.
 */
@assert.range: true
type ExceptionStatus : String(20) enum {
    Open        = 'OPEN';
    Cleared     = 'CLEARED';      // Re-evaluated and no longer raised
    Bypassed    = 'BYPASSED';     // Still true. Accepted by an authorised user
}

/**
 * WP-21A — The posting gate.
 *
 * NOT_CHECKED is distinct from CLEAR for the reason PROVISIONAL is distinct
 * from a passed price check: "not evaluated" must never read as "evaluated
 * and fine". An invoice captured a moment ago is NOT_CHECKED, not CLEAR.
 */
@assert.range: true
type PostingGate : String(20) enum {
    NotChecked  = 'NOT_CHECKED';  // The registry has not run
    Gated       = 'GATED';        // At least one gating exception is open
    Clear       = 'CLEAR';        // The registry ran and nothing gating remains
}

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
@assert.range: true
type ToleranceType : String(20) enum {
    Price        = 'PRICE';
    Quantity     = 'QUANTITY';
    Amount       = 'AMOUNT';
    Date         = 'DATE';
    // WP-13 / D30. None of the three limits this package collects could be
    // represented as a tolerance rule, because the type had no member for
    // any of them. A rule table that cannot name the rule is not a store.
    Temperature  = 'TEMPERATURE';    // EPD403. An absolute band, not a variance
    Density      = 'DENSITY';        // EPD404. Likewise
    BurnVariance = 'BURN_VARIANCE';  // The ladder, written out three times
}

/**
 * INVOICES - Supplier Invoice Header
 * Source: FuelSphere native + S/4HANA
 * Volume: ~50,000/year
 *
 * Invoice Number Format: INV-{SUPPLIER_CODE}-{YYYYMMDD}-{SEQ}
 * Example: INV-WFS-20260117-001
 *
 * Key Features:
 * - Three-way matching: PO ↔ GR (ePOD) ↔ Invoice
 * - Configurable tolerance rules
 * - Dual approval workflow for exceptions
 * - S/4HANA FI posting on approval
 */
entity INVOICES : cuid, AuditTrail {
        invoice_number      : String(30) @mandatory;      // Supplier invoice number (unique per supplier)
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

        // WP-21A / INV454. DERIVED FROM LINES, never keyed from the supplier
        // document. @mandatory is relaxed because a header total is now an
        // output of capture rather than an input to it — an invoice whose
        // lines have not been read yet has no total, and refusing to capture
        // it would block capture, which principle 1 forbids.
        //
        // Three readers surveyed, all in invoice-fiori-annotations.cds and
        // all display-only, so null is already safe for every one of them.
        net_amount          : Decimal(15,2);              // DERIVED: sum of line net_amount
        tax_amount          : Decimal(15,2) default 0;    // DERIVED: sum of line tax_amount
        gross_amount        : Decimal(15,2);              // DERIVED: net + tax

        // WP-21A. WHAT THE SUPPLIER'S DOCUMENT CLAIMS, retained beside the
        // derived figure rather than overwriting it. The check compares the
        // two, so both have to survive — discarding the stated figure would
        // leave nothing to disagree with, and the disagreement is the finding.
        stated_net_amount   : Decimal(15,2);              // As printed on the supplier invoice
        stated_gross_amount : Decimal(15,2);
        stated_line_count   : Integer;                    // As printed. Compared to lines received

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

        // WP-21A. CAPTURE IS NEVER BLOCKED; POSTING IS GATED. The two are
        // different states and this is the one that says so. An invoice with
        // fifteen hard errors is CAPTURED and GATED, never refused — an
        // uncaptured invoice is a supplier claim nobody can see.
        posting_gate        : PostingGate default 'NOT_CHECKED';
        gate_evaluated_at   : DateTime;                   // When the registry last ran
        open_hard_count     : Integer default 0;          // Unbypassable gating exceptions open
        open_soft_count     : Integer default 0;          // Bypassable gating exceptions open
        warning_count       : Integer default 0;          // Recorded, never gating

        // Compositions
        items               : Composition of many INVOICE_ITEMS on items.invoice = $self;
        matches             : Composition of many INVOICE_MATCHES on matches.invoice = $self;
        approvals           : Composition of many INVOICE_APPROVALS on approvals.invoice = $self;
        exceptions          : Composition of many INVOICE_EXCEPTIONS on exceptions.invoice = $self;
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

        // WP-21A — THE KEY THE SUPPLIER ACTUALLY REFERENCES.
        //
        // delivery and fuel_order identify neither what was invoiced nor what
        // the supplier thinks they billed. ONE DELIVERY CARRIES SEVERAL
        // TICKETS, and a ticket may exist with no order at all (decision A1).
        // The supplier quotes the ticket number; they do not know our PO.
        //
        // ticket_number is what arrives on the document, as text, because the
        // supplier's string is evidence even when it resolves to nothing.
        // ticket is what it RESOLVED to, which is a different fact.
        ticket_number       : String(50);                      // As stated on the supplier document
        ticket              : Association to FUEL_TICKETS;     // What it resolved to, if anything

        // WP-21A. The PO and GR reached THROUGH the ticket, recorded so the
        // resolution is re-explainable without re-running it — and so the
        // stated po_number above can be compared against it. The applied-
        // evidence pattern, as in conversion_source and plan_version_source.
        resolved_po_number  : String(10);                      // From ticket -> order.s4_po_number
        resolved_gr_number  : String(10);                      // From ticket -> delivery.s4_gr_number
        resolution_source   : String(30);                      // TICKET_NUMBER, TICKET_ID, UNRESOLVED

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
 * INVOICE_CHECK_REGISTRY - WP-21A
 * Source: FuelSphere native (configuration)
 * Volume: ~40 records
 *
 * WHICH CHECKS RUN, AND HOW HARD THEY BITE. A registry, not a rules engine:
 * it holds only what the tolerance ladder cannot — the check's identity, its
 * severity where no ladder applies, and whether a human may bypass it.
 *
 * The check's LOGIC lives in code. What is configured is whether it runs, how
 * severe it is, and whether it can be waived. That is the line that makes
 * changing a severity a configuration change rather than a deployment.
 */
entity INVOICE_CHECK_REGISTRY : cuid, ActiveStatus, AuditTrail {
        check_code          : String(20) @mandatory;      // INV4xx, from 03-VALIDATION-RULES
        check_name          : String(100) @mandatory;     // Display name
        check_description   : String(500);                // What it tests, in one sentence
        check_group         : String(30) @mandatory;      // CAPTURE, RESOLUTION, QUANTITY, PRICE, DUPLICATE

        // Severity
        //
        // For a NON-NUMERIC check this IS the severity. For a check with a
        // tolerance ladder it is the fallback used only where no ladder row
        // resolves — the ladder decides when there is one, because a severity
        // that ignores the size of the variance is not a severity.
        default_severity    : CheckSeverity @mandatory;
        tolerance_rule_code : String(20);                 // Ladder to resolve, where the check is numeric

        // Bypass
        //
        // Independent of severity, because they answer different questions:
        // severity says whether it gates, this says whether a human may
        // accept it anyway. A HARD_ERROR is never bypassable and the
        // handler enforces that regardless of what this column says —
        // configuration may not make an unbypassable check bypassable.
        is_bypassable       : Boolean default false;
        bypass_scope        : String(30);                 // Scope a bypasser must hold. WP-27 layers SoD on this

        // WP-21A. A check DECLARED and not implemented is worse than one
        // absent, because absence is invisible and a declared no-op looks
        // like it passed. This makes the gap countable.
        is_implemented      : Boolean default true;
        not_implemented_reason : String(200);             // Why, and which package owns it

        // Effective dating, as every configuration table here carries
        valid_from          : Date;
        valid_to            : Date;
}

/**
 * INVOICE_EXCEPTIONS - WP-21A
 * Source: FuelSphere native
 * Volume: ~200,000/year
 *
 * ONE ROW PER CHECK THAT FIRED. Raised at capture, re-evaluated on demand,
 * cleared when it stops being true, bypassed when someone accepts it.
 *
 * Carries the APPLIED EVIDENCE: the observed value, the threshold it crossed
 * and the tolerance row that supplied that threshold — so the exception is
 * re-explainable without re-running the check, which is the same reason
 * PRICE_DERIVATION_LOGS stamps the quote id rather than the quote.
 */
entity INVOICE_EXCEPTIONS : cuid, AuditTrail {
        invoice             : Association to INVOICES @mandatory;
        // Null for a header-level check. An exception against the document
        // as a whole belongs to no line.
        invoice_item        : Association to INVOICE_ITEMS;
        line_number         : Integer;                    // Denormalised, for reading without a join

        // What fired
        check_code          : String(20) @mandatory;
        check_group         : String(30);
        severity            : CheckSeverity @mandatory;   // AS RESOLVED, which may differ from the default
        severity_source     : String(30);                 // REGISTRY_DEFAULT or TOLERANCE_LADDER
        message             : String(1000) @mandatory;    // What happened, in the terms of the data

        // The evidence
        observed_value      : Decimal(18,4);              // What the invoice said
        expected_value      : Decimal(18,4);              // What FuelSphere resolved
        variance_value      : Decimal(18,4);              // observed - expected
        variance_pct        : Decimal(10,4);              // Signed. The RUNG is on magnitude
        threshold_crossed   : Decimal(10,4);              // The rung's value, where a ladder resolved
        tolerance_rule      : Association to TOLERANCE_RULES;  // WHICH ROW supplied it

        // Lifecycle
        status              : ExceptionStatus default 'OPEN';
        is_gating           : Boolean default false;      // Derived from severity at raise time
        detected_at         : DateTime @mandatory;
        detected_by         : String(100);
        cleared_at          : DateTime;
        cleared_reason      : String(500);                // Why it stopped being true
}

/**
 * INVOICE_EXCEPTION_BYPASSES - WP-21A
 * Source: FuelSphere native
 * Volume: ~5,000/year
 *
 * WHO ACCEPTED A SOFT ERROR, WHEN, AND WHY.
 *
 * Its own entity rather than columns on the exception, for two reasons. A
 * bypass may be REVOKED and the exception returns to OPEN, which a column
 * set cannot express without losing the first decision. And INV-002 will add
 * a second signature (WP-27) — a separate row has somewhere to put it, and
 * second_approver is declared here unused so that layering it on is a
 * behaviour change rather than a schema change.
 *
 * INVOICE_APPROVALS could not host this: it is an invoice-level approval
 * workflow with no exception reference and no BYPASS action.
 */
entity INVOICE_EXCEPTION_BYPASSES : cuid, AuditTrail {
        exception           : Association to INVOICE_EXCEPTIONS @mandatory;
        invoice             : Association to INVOICES @mandatory;   // Denormalised, for the audit query
        invoice_item        : Association to INVOICE_ITEMS;
        check_code          : String(20) @mandatory;      // Denormalised: the registry row may change later

        // Who, when, why
        bypassed_by         : String(100) @mandatory;
        bypassed_at         : DateTime @mandatory;
        // A justification long enough to be one. COMPLIANCE_EXCEPTIONS sets
        // the precedent with a minimum length, and a reason nobody can read
        // is the same as no reason.
        bypass_reason       : String(1000) @mandatory;
        bypass_scope_held   : String(30);                 // The scope that authorised it

        // Revocation
        is_active           : Boolean default true;
        revoked_by          : String(100);
        revoked_at          : DateTime;
        revocation_reason   : String(500);

        // WP-27 / INV-002. Declared, never written here. Dual approval needs
        // SOD_RULES enforcement, which is seeded and unenforced.
        second_approver     : String(100);
        second_approved_at  : DateTime;
}

/**
 * TOLERANCE_RULES - Variance Tolerance Configuration
 * Source: FuelSphere native (configuration)
 * Volume: ~50 records
 *
 * Configurable thresholds for price, quantity, and amount variances
 * by company code, supplier category, or product type
 */
/**
 * ConfigValueType - WP-13
 *
 * Which typed column carries a PARAMETER row's value. CFG404 requires the
 * value columns to match the parameter, enforced by constraint rather than by
 * the screen — this is the discriminator that makes that checkable.
 */
@assert.range: true
type ConfigValueType : String(20) enum {
    Boolean = 'BOOLEAN';
    Text    = 'TEXT';
    Number  = 'NUMBER';
    Choice  = 'CHOICE';    // One of a stated set, held in allowed_values
}

/**
 * ConfigRowKind - WP-13
 *
 * ONE STORE, TWO KINDS OF ROW. TOLERANCE_RULES is already named Parameter
 * Configuration and its scope columns are already nullable, so a scalar with
 * no scope fits it. A second entity would put parameter configuration in two
 * places, which is what the no-second-store rule exists to prevent.
 *
 * The kind says which columns carry the answer:
 *
 *   PARAMETER  value_type + one of value_boolean / value_text / value_number,
 *              with allowed_values where the type is CHOICE.
 *              The ladder columns are null
 *   TOLERANCE  lower_limit / upper_limit, or the ladder
 *              warning_threshold / error_threshold / critical_threshold,
 *              plus floor_value. The value columns are null
 */
@assert.range: true
type ConfigRowKind : String(20) enum {
    Parameter = 'PARAMETER';
    Tolerance = 'TOLERANCE';
}

/**
 * TOLERANCE_RULES - Parameter and Tolerance Configuration
 * Source: FuelSphere native (configuration)
 * Volume: ~100 records
 *
 * THE ONE CONFIGURATION STORE. Its own header already called it Parameter
 * Configuration, and its scope columns were always nullable — so a scalar
 * parameter with no scope was always representable here.
 *
 * Resolution is the same for both kinds, deliberately — one rule, learned
 * once: SPECIFICITY, then PRIORITY, then DATE, as of the TRANSACTION date and
 * never the query date (CFG402), returning the row that resolved (CFG406).
 */
entity TOLERANCE_RULES : cuid, ActiveStatus, AuditTrail {
        // WP fix/hdi-seed-data. String(40), not String(20) and not String(30).
        // HANA enforces NVARCHAR length where SQLite ignores it, so four seeded
        // codes (21, 24, 24 and 27 chars) failed the HDI deploy while passing
        // every local test. Widened rather than shortened because the codes are
        // named in decisions C-1, B9 and C-2 and in 01-TARGET-SCHEMA 10.3, and
        // because rule_code is the parameter resolver's lookup key - shortening
        // moves every reader. 40, not the current maximum of 27: sizing a column
        // to today's longest value is how this defect arrives a second time.
        rule_code           : String(40) @mandatory;      // Rule identifier, or PARAMETER code
        rule_name           : String(100) @mandatory;     // Display name
        description         : String(500);                // Rule description

        // WP-13. Which kind of row this is, and therefore which columns
        // carry the answer. Defaults to TOLERANCE so every pre-existing row
        // keeps its meaning without being touched.
        row_kind            : ConfigRowKind default 'TOLERANCE';

        // ---- PARAMETER rows only. Null on a TOLERANCE row ----------------
        value_type          : ConfigValueType;
        value_boolean       : Boolean;
        value_text          : String(200);
        value_number        : Decimal(18,6);
        // For CHOICE: the values this parameter may take, comma separated.
        // Held so a resolution can REFUSE an unregistered value rather than
        // pass it through — D25 applied to configuration.
        allowed_values      : String(500);

        // Provenance. A parameter nobody can trace to a decision is a literal
        // with a longer name. is_wired exists because WP-13 registers four
        // parameters and wires one — a registered parameter that changes
        // nothing must SAY so, or the next reader edits it expecting an effect.
        decision_ref        : String(30);                 // C-1, B9, C-2, 10.3
        consuming_package   : String(30);
        is_wired            : Boolean default false;

        // Scope
        company_code        : String(4);                  // Company code (NULL = all)
        supplier_category   : String(20);                 // Supplier category (NULL = all)
        product_type        : String(20);                 // Product type (NULL = all)
        station_code        : String(3);                  // WP-13: station scope (NULL = all)

        // WP-21A. WHICH CONTROL these limits belong to. Without it a quantity
        // tolerance is a quantity tolerance for everything, and the invoice
        // check would silently pick up the FOB reconciliation's 0.5% — two
        // controls answering different questions off one row.
        applies_to          : String(30);                 // INVOICE_LINE, DELIVERY_FOB, ... (NULL = any)

        // Tolerance Type & Values
        // WP-13 — RELAXED. @mandatory was correct while every row was a
        // tolerance; a PARAMETER row has no tolerance type. Three readers
        // surveyed, all filters (invoice-checks.js:123, parameter-store.js:130
        // and :155), so a null simply fails to match rather than breaking one.
        tolerance_type      : ToleranceType;              // PRICE / QUANTITY / ... Null on a PARAMETER row
        lower_limit         : Decimal(10,4);              // Lower tolerance (negative variance)
        upper_limit         : Decimal(10,4);              // Upper tolerance (positive variance)
        is_percentage       : Boolean default true;       // True = %, False = absolute value
        currency_code       : String(3);                  // Currency (if absolute amount)

        // WP-21A — THE LADDER.
        //
        // lower_limit and upper_limit are a single line: inside or outside.
        // A severity ladder needs three, because "within tolerance" and
        // "beyond tolerance" are not the only two things a variance can be.
        //
        //   |value| <= warning              nothing raised
        //   warning  < |value| <= error     WARNING   recorded, does not gate
        //   error    < |value| <= critical  SOFT      gates, bypassable
        //   |value|  > critical             HARD      gates, not bypassable
        //
        // Absolute magnitude, so an under-invoice and an over-invoice of the
        // same size land on the same rung. Which DIRECTION it went is on the
        // exception; the rung is about size.
        //
        // Nullable, because a rule may ladder or may not. A rule with no
        // ladder falls back to lower_limit/upper_limit as a single line and
        // the registry's configured severity beyond it.
        warning_threshold   : Decimal(10,4);              // Below this, nothing is raised
        error_threshold     : Decimal(10,4);              // Above this, the SOFT rung
        critical_threshold  : Decimal(10,4);              // Above this, the HARD rung

        // WP-13. A PERCENTAGE ALONE CANNOT WORK on a small quantity, which is
        // the reason WP-17's FOB tolerances were a percentage AND a floor:
        // 100 kg of crew rounding is 0.9% of a narrowbody uplift and 25% of a
        // 400 kg top-up. The effective tolerance is the greater of the two.
        // Nullable — a rule with no floor is a pure percentage, as before.
        floor_value         : Decimal(15,4);              // Absolute floor, in the measure's own unit
        floor_uom           : String(3);                  // KG, LTR, ... for the floor only

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
        exception_number    : String(50) @mandatory;      // EXC-{YYYY}-{SEQ}
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
        // WP-07B / decisions B1 and A4. ADDITIVE — the string above keeps its
        // existing constraint and this is optional, always.
        //
        // Named `tail`, not `aircraft`. On four of these seven entities
        // `aircraft` is already an association to AIRCRAFT_MASTER — the TYPE
        // master, keyed on type_code — and @mandatory on three of them. The
        // same name would mean type in one place and tail in another.
        //
        // Both are retained deliberately. The string is the value AS RECEIVED
        // and survives a registration the register has never seen; replacing
        // it would make an unknown tail structurally impossible to record, and
        // then no parameter could permit one.
        tail                : Association to AIRCRAFT_REGISTRATIONS;

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

        // WP-19 / decision B4. The block burn split into what the engines
        // took and what the APU took.
        //
        // actual_burn_kg IS the block burn — the figure the specification
        // calls block_burn_kg. There is no field of that name and renaming is
        // prohibited, so the subtraction is expressed against this one.
        //
        // APU burn is NEVER metered. It is the only fuel figure in the system
        // that is derived rather than measured, and APU_USAGE.apu_source
        // records how, on every row.
        apu_burn_kg         : Decimal(12,2);              // Derived. Sum of the cycles apportioned here
        engine_burn_kg      : Decimal(12,2);              // Derived: actual_burn_kg - apu_burn_kg

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
        // WP-07B / decisions B1 and A4. ADDITIVE — the string above keeps its
        // existing constraint and this is optional, always.
        //
        // Named `tail`, not `aircraft`. On four of these seven entities
        // `aircraft` is already an association to AIRCRAFT_MASTER — the TYPE
        // master, keyed on type_code — and @mandatory on three of them. The
        // same name would mean type in one place and tail in another.
        //
        // Both are retained deliberately. The string is the value AS RECEIVED
        // and survives a registration the register has never seen; replacing
        // it would make an unknown tail structurally impossible to record, and
        // then no parameter could permit one.
        tail                : Association to AIRCRAFT_REGISTRATIONS;

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
        // WP-07B / decisions B1 and A4. ADDITIVE — the string above keeps its
        // existing constraint and this is optional, always.
        //
        // Named `tail`, not `aircraft`. On four of these seven entities
        // `aircraft` is already an association to AIRCRAFT_MASTER — the TYPE
        // master, keyed on type_code — and @mandatory on three of them. The
        // same name would mean type in one place and tail in another.
        //
        // Both are retained deliberately. The string is the value AS RECEIVED
        // and survives a registration the register has never seen; replacing
        // it would make an unknown tail structurally impossible to record, and
        // then no parameter could permit one.
        tail                : Association to AIRCRAFT_REGISTRATIONS;

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
// APU USAGE (WP-19, decisions B4 and B9)
// ============================================================================

/**
 * Which part of the operation an APU cycle belongs to.
 *
 * Apportionment is a COST question, not a fuel question — for the ledger the
 * fuel simply left the tanks. This is the primary allocation rule: post-arrival
 * and pre-departure genuinely belong to different flights, so the ordinary
 * turnaround needs no split at all.
 *
 * OVERNIGHT, PARKED and MAINTENANCE belong to NEITHER flight. Twelve hours
 * between two barely-related flights charged to either is misleading, and this
 * is where OVERNIGHT earns its place — the cost goes to the station or the
 * aircraft, not to a leg.
 */
@assert.range: true
type ApuUsagePhase : String(20) enum {
    PreDeparture = 'PRE_DEPARTURE';   // Boarding, loading, engine start — the DEPARTING flight
    InFlight     = 'IN_FLIGHT';       // That flight
    PostArrival  = 'POST_ARRIVAL';    // Disembarkation, offload — the ARRIVING flight
    Overnight    = 'OVERNIGHT';       // Neither flight
    Maintenance  = 'MAINTENANCE';     // Neither flight
    Parked       = 'PARKED';          // Neither flight
}

/**
 * Where an APU cycle came from.
 *
 * GROUND_TIME_EST is a DERIVATION at low confidence, not a manual entry and
 * not a measurement. APU availability is per FLEET rather than per airline —
 * the AMI is loaded per fleet and APU reports have no operational value to ops
 * control, so they are frequently not configured. Estimation is therefore a
 * first-class path, not a degraded one. See open point F4.
 */
@assert.range: true
type ApuSource : String(20) enum {
    Acars          = 'ACARS';            // Downlinked cycle times. Measured
    Manual         = 'MANUAL';           // Keyed by a person. Measured, less reliably
    GroundTimeEst  = 'GROUND_TIME_EST';  // DERIVED at low confidence. Not measured
}

/**
 * APU_USAGE - one row per CYCLE, not per phase and not per flight.
 *
 * A turnaround produces several cycles across two phases and two legs, so a
 * cycle is the only thing that can be counted. Timestamps are FULL, not bare
 * times: a bare time cannot represent a cycle that runs past midnight, and an
 * overnight cycle is the ordinary case for a parked aircraft.
 *
 * MOST APU BURN FALLS OUTSIDE BLOCK TIME — before off-blocks and after
 * on-blocks — so no gauge reading captures it. That is why the cycle times
 * matter rather than the block times.
 */
entity APU_USAGE : cuid, AuditTrail {
        // The tail. String as received plus the resolving association, per
        // WP-07B: an APU cycle can arrive for an aircraft the register has
        // never seen, and refusing it would lose the burn.
        tail_number         : String(10) @mandatory;
        tail                : Association to AIRCRAFT_REGISTRATIONS;

        // Optional. A cycle can exist with no flight attached — OVERNIGHT and
        // MAINTENANCE belong to no leg by definition.
        flight              : Association to FLIGHT_SCHEDULE;

        // FULL timestamps. NEVER bare times.
        apu_start_utc       : Timestamp @mandatory;
        apu_stop_utc        : Timestamp;                  // Null while the cycle is open

        usage_phase         : ApuUsagePhase @mandatory;
        apu_source          : ApuSource @mandatory;

        // An open cycle is FLAGGED, not computed. A running APU has burned
        // something, but how much is not yet knowable, and a figure derived
        // from a missing stop time would be a guess wearing a measurement's
        // clothes.
        is_open             : Boolean default false;

        // Derived. Minutes the APU actually RAN — never ground time.
        // (OUT - IN) x rate assumes the APU ran the whole turn: on a 310
        // minute turn with the APU running 38 minutes that is 568 kg against
        // an actual 70, so 498 kg of phantom burn.
        running_minutes     : Integer;
        apu_burn_kg         : Decimal(12,2);

        // Applied evidence — which rate produced the figure and where it came
        // from, so the derivation can be reproduced from the row alone.
        burn_rate_kg_hr     : Decimal(8,2);
        rate_source         : String(30);                 // AIRCRAFT_REGISTRATIONS, or absent

        // Which flight bears the cost, and on what basis. Resolution order is
        // the refuelling event where gauge readings exist, then the phase,
        // then time-proportional — recording which was used. The posting
        // itself is WP-23.
        allocated_flight    : Association to FLIGHT_SCHEDULE;
        allocation_basis    : String(24);                 // REFUELLING_EVENT | PHASE | TIME_PROPORTIONAL | NONE

        remarks             : String(500);
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
        pricing_formula     : Association to PRICING_FORMULAS; // Pricing formula used - WP-08

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
        default_cost_center : String(20);                 // Default cost center
        default_profit_center : String(20);               // Default profit center
        default_internal_order : String(20);              // Default internal order

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
        run_number          : String(50) @mandatory;      // RUN-{PERIOD}-{SEQ}
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
        cost_center         : String(20) @mandatory;      // S/4HANA Cost Center
        cost_center_name    : String(40);                 // Cost center description
        profit_center       : String(20);                 // S/4HANA Profit Center
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
        accrual_number      : String(50) @mandatory;      // ACC-{PERIOD}-{SEQ}

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
        // WP fix/hdi-seed-data. Decimal(10,4), not Decimal(10,2). All seven
        // seeded values carry four decimal places and every one of them rounds
        // to 0.00 at scale 2, so the column was meaningless whether HANA
        // rejected the load or silently rounded it. Widened to preserve what was
        // seeded rather than invent plausible figures. peak_requests_per_second
        // below is left at scale 2 deliberately - its seeded values all fit, and
        // widening a column whose data is correct is outside this fix.
        requests_per_second : Decimal(10,4);                 // Avg requests/second
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
type KPIVarianceStatus : String(15) enum { OK; WARNING; CRITICAL }
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

// ============================================================================
// FDD-13: SECURITY MANAGEMENT
// ============================================================================

/**
 * Security Management Types
 */
type UserStatus : String(15) enum { ACTIVE; INACTIVE; LOCKED; PENDING; SUSPENDED }
type EventCategory : String(20) enum { AUTHENTICATION; AUTHORIZATION; DATA_CHANGE; FINANCIAL; SECURITY; ADMIN }
type EventResult : String(10) enum { SUCCESS; FAILURE; PARTIAL }
type CampaignStatus : String(20) enum { DRAFT; SCHEDULED; IN_PROGRESS; COMPLETED; CANCELLED }
type ReviewDecision : String(15) enum { PENDING; CERTIFIED; REVOKED; ESCALATED }
type SoDStatus : String(15) enum { DETECTED; EXCEPTION_PENDING; EXCEPTION_APPROVED; RESOLVED; ACCEPTED }
type IncidentSeverity : String(15) enum { LOW; MEDIUM; HIGH; CRITICAL }
type IncidentStatus : String(20) enum { NEW; TRIAGED; IN_PROGRESS; CONTAINED; RESOLVED; CLOSED }
type AlertStatus : String(15) enum { ACTIVE; ACKNOWLEDGED; RESOLVED; SUPPRESSED }

/**
 * SECURITY_USERS - User Identity Management
 * Source: FuelSphere + SAP IAS sync
 * Volume: ~5,000 records
 *
 * User identity with attributes synchronized from SAP Identity Authentication Service
 */
entity SECURITY_USERS : cuid, AuditTrail {
        // Identity
        ias_user_id         : String(64);                    // SAP IAS user ID for federation
        email               : String(256) @mandatory;        // User email address
        user_name           : String(100) @mandatory;        // Login username
        display_name        : String(256) @mandatory;        // Full name for display
        first_name          : String(100);
        last_name           : String(100);

        // Organization
        department          : String(100);                   // Organizational department
        job_title           : String(100);                   // Job title
        cost_center         : String(10);                    // Cost center assignment
        company_code        : String(4);                     // Primary company code
        location            : String(100);                   // Work location
        manager             : Association to SECURITY_USERS; // Reporting manager

        // Contact
        phone               : String(30);
        mobile              : String(30);

        // Status
        status              : UserStatus default 'PENDING';
        status_reason       : String(500);                   // Reason for status change
        locked_reason       : String(200);                   // If locked, why
        lock_expiry         : DateTime;                      // Auto-unlock time

        // Authentication
        last_login_time     : DateTime;                      // Last successful login
        last_login_ip       : String(45);                    // Last login IP address
        failed_login_count  : Integer default 0;             // Consecutive failed logins
        last_failed_login   : DateTime;                      // Last failed attempt
        password_changed_at : DateTime;                      // Last password change
        mfa_enabled         : Boolean default false;         // MFA status

        // Lifecycle
        provisioned_date    : DateTime;                      // Date provisioned
        provisioned_by      : String(100);                   // Who provisioned
        deactivated_date    : DateTime;                      // Date deactivated
        deactivated_by      : String(100);                   // Who deactivated
        deactivation_reason : String(500);                   // Why deactivated

        // HR Integration
        employee_id         : String(20);                    // HR system employee ID
        employment_status   : String(20);                    // ACTIVE, TERMINATED, LOA
        employment_end_date : Date;                          // Expected end date
        is_active           : Boolean default true;          // Active flag for filtering

        // Composition
        role_assignments    : Composition of many ROLE_ASSIGNMENTS on role_assignments.user = $self;
}

/**
 * ROLE_ASSIGNMENTS - User to Role Mapping
 * Source: FuelSphere native
 * Volume: ~20,000 records
 *
 * User to role collection mapping with validity dates and approval tracking
 */
entity ROLE_ASSIGNMENTS : cuid, AuditTrail {
        // Assignment
        user                : Association to SECURITY_USERS @mandatory;
        role_collection     : String(100) @mandatory;        // XSUAA Role Collection name
        role_template       : String(100);                   // Role Template name
        role_description    : String(500);                   // Role description

        // Scope
        company_code        : String(4);                     // Company code scope (null = all)
        plant               : String(4);                     // Plant scope
        cost_center         : String(10);                    // Cost center scope

        // Validity
        valid_from          : Date @mandatory;
        valid_to            : Date;                          // Null = indefinite
        is_temporary        : Boolean default false;         // Temporary assignment

        // Status
        status              : String(20) default 'ACTIVE';   // ACTIVE, EXPIRED, REVOKED, PENDING
        status_changed_at   : DateTime;
        status_changed_by   : String(100);

        // Approval
        requires_approval   : Boolean default true;
        approval_status     : String(20) default 'PENDING';  // PENDING, APPROVED, REJECTED
        requested_by        : String(100) @mandatory;
        requested_at        : DateTime @mandatory;
        request_reason      : String(500);
        approved_by         : String(100);
        approved_at         : DateTime;
        rejection_reason    : String(500);

        // SoD Check
        sod_checked         : Boolean default false;
        sod_violations_found : Integer default 0;
        sod_exception_id    : UUID;                          // Reference to exception if approved
}

/**
 * ACCESS_REVIEW_CAMPAIGNS - Access Review Campaign Definition
 * Source: FuelSphere native
 * Volume: ~50/year
 *
 * Periodic access review campaign management for SOX compliance
 */
entity ACCESS_REVIEW_CAMPAIGNS : cuid, AuditTrail {
        // Campaign Identification
        campaign_code       : String(30) @mandatory;         // CAR-{YEAR}-Q{N}-{SEQ}
        campaign_name       : String(200) @mandatory;        // Campaign display name
        campaign_description : String(1000);                 // Campaign purpose

        // Schedule
        scheduled_start     : Date @mandatory;               // Campaign start date
        scheduled_end       : Date @mandatory;               // Certification deadline
        actual_start        : DateTime;                      // Actual start timestamp
        actual_end          : DateTime;                      // Actual completion timestamp

        // Scope
        scope_type          : String(30) @mandatory;         // ALL_USERS, DEPARTMENT, ROLE, CUSTOM
        scope_filter        : LargeString;                   // Filter criteria JSON
        scope_company_codes : String(100);                   // Company codes in scope
        include_inactive    : Boolean default false;         // Include inactive users

        // Status
        status              : CampaignStatus default 'DRAFT';
        status_changed_at   : DateTime;
        status_changed_by   : String(100);

        // Statistics
        total_items         : Integer default 0;             // Total review items
        certified_count     : Integer default 0;             // Items certified
        revoked_count       : Integer default 0;             // Items revoked
        pending_count       : Integer default 0;             // Items pending
        escalated_count     : Integer default 0;             // Items escalated
        completion_pct      : Decimal(5,2) default 0;        // Completion percentage

        // Escalation
        escalation_enabled  : Boolean default true;
        escalation_days     : Integer default 7;             // Days before escalation
        escalation_to       : String(100);                   // Escalation recipient
        reminder_sent_at    : DateTime;
        escalation_sent_at  : DateTime;

        // Compliance
        sox_relevant        : Boolean default true;          // SOX compliance campaign
        evidence_generated  : Boolean default false;
        evidence_file_path  : String(500);                   // Path to evidence report

        // Owner
        campaign_owner      : String(100) @mandatory;        // Campaign manager

        // Composition
        review_items        : Composition of many ACCESS_REVIEW_ITEMS on review_items.campaign = $self;
}

/**
 * ACCESS_REVIEW_ITEMS - Individual Access Certification Items
 * Source: FuelSphere native
 * Volume: ~10,000/year
 *
 * Individual access certification items within a campaign
 */
entity ACCESS_REVIEW_ITEMS : cuid, AuditTrail {
        // Campaign Reference
        campaign            : Association to ACCESS_REVIEW_CAMPAIGNS @mandatory;
        item_number         : Integer @mandatory;            // Item sequence number

        // Subject
        user                : Association to SECURITY_USERS @mandatory;
        role_assignment     : Association to ROLE_ASSIGNMENTS @mandatory;
        role_collection     : String(100) @mandatory;        // Denormalized

        // Reviewer
        assigned_reviewer   : String(100) @mandatory;        // Manager or role owner
        reviewer_type       : String(20);                    // MANAGER, ROLE_OWNER, DELEGATE

        // Review Status
        decision            : ReviewDecision default 'PENDING';
        decision_date       : DateTime;
        decision_by         : String(100);
        decision_reason     : String(500);
        decision_evidence   : String(500);                   // Supporting evidence

        // Action
        action_required     : Boolean default false;         // Requires follow-up action
        action_type         : String(30);                    // REVOKE, MODIFY, INVESTIGATE
        action_completed    : Boolean default false;
        action_completed_at : DateTime;
        action_completed_by : String(100);

        // Escalation
        is_escalated        : Boolean default false;
        escalated_to        : String(100);
        escalated_at        : DateTime;
        escalation_reason   : String(500);

        // Notifications
        initial_notification_sent : DateTime;
        reminder_sent_at    : DateTime;
        reminder_count      : Integer default 0;

        // Due
        due_date            : Date @mandatory;
        is_overdue          : Boolean default false;
}

/**
 * SOD_VIOLATIONS - Segregation of Duties Violations
 * Source: FuelSphere native
 * Volume: ~1,000/year
 *
 * Detected segregation of duties conflicts
 */
entity SOD_VIOLATIONS : cuid, AuditTrail {
        // Violation Identification
        violation_code      : String(30) @mandatory;         // SOD-{DATE}-{SEQ}
        detection_time      : DateTime @mandatory;           // When detected

        // Subject
        user                : Association to SECURITY_USERS @mandatory;

        // Conflicting Roles
        role_1              : String(100) @mandatory;        // First conflicting role
        role_1_scope        : String(200);                   // Scope details
        role_1_assignment   : Association to ROLE_ASSIGNMENTS;
        role_2              : String(100) @mandatory;        // Second conflicting role
        role_2_scope        : String(200);                   // Scope details
        role_2_assignment   : Association to ROLE_ASSIGNMENTS;

        // Rule Details
        sod_rule_id         : String(50) @mandatory;         // Reference to SoD rule
        sod_rule_name       : String(200);                   // Rule description
        risk_level          : String(10) @mandatory;         // LOW, MEDIUM, HIGH, CRITICAL
        risk_description    : String(500);                   // Business risk explanation

        // Status
        status              : SoDStatus default 'DETECTED';
        status_changed_at   : DateTime;
        status_changed_by   : String(100);

        // Detection Source
        detection_source    : String(30) @mandatory;         // ROLE_ASSIGNMENT, PERIODIC_SCAN, MANUAL
        trigger_action      : String(100);                   // What triggered detection

        // Exception Reference
        exception           : Association to SOD_EXCEPTIONS;
}

/**
 * SOD_EXCEPTIONS - Segregation of Duties Exception Approvals
 * Source: FuelSphere native
 * Volume: ~200/year
 *
 * Approved exceptions for SoD violations with validity and controls
 */
entity SOD_EXCEPTIONS : cuid, AuditTrail {
        // Exception Identification
        exception_code      : String(30) @mandatory;         // SODEX-{DATE}-{SEQ}

        // Violation Reference
        violation           : Association to SOD_VIOLATIONS @mandatory;
        user                : Association to SECURITY_USERS @mandatory;

        // Exception Details
        business_justification : LargeString @mandatory;     // Why exception needed
        compensating_controls : LargeString @mandatory;      // Mitigating controls
        risk_acceptance     : LargeString;                   // Accepted residual risk

        // Validity
        valid_from          : Date @mandatory;
        valid_to            : Date @mandatory;               // Max 1 year typically
        is_permanent        : Boolean default false;         // Requires CISO approval

        // Status
        status              : String(20) default 'PENDING';  // PENDING, APPROVED, REJECTED, EXPIRED
        status_changed_at   : DateTime;

        // Approval Workflow (Dual approval required)
        requested_by        : String(100) @mandatory;
        requested_at        : DateTime @mandatory;

        first_approver      : String(100);                   // Manager/Business Owner
        first_approval_date : DateTime;
        first_approval_notes : String(500);

        second_approver     : String(100);                   // Security Officer/CISO
        second_approval_date : DateTime;
        second_approval_notes : String(500);

        rejected_by         : String(100);
        rejection_date      : DateTime;
        rejection_reason    : String(500);

        // Review
        last_review_date    : Date;
        next_review_date    : Date;
        review_count        : Integer default 0;
}

/**
 * SECURITY_INCIDENTS - Security Incident Management
 * Source: FuelSphere native
 * Volume: ~500/year
 *
 * Security incident tracking from detection to resolution
 */
entity SECURITY_INCIDENTS : cuid, AuditTrail {
        // Incident Identification
        incident_code       : String(30) @mandatory;         // INC-{DATE}-{SEQ}
        incident_title      : String(200) @mandatory;        // Brief description
        incident_description : LargeString @mandatory;       // Detailed description

        // Classification
        severity            : IncidentSeverity @mandatory;
        incident_type       : String(50) @mandatory;         // UNAUTHORIZED_ACCESS, DATA_BREACH, etc.
        affected_systems    : String(500);                   // Comma-separated system names
        affected_data       : String(500);                   // Type of data affected

        // Status
        status              : IncidentStatus default 'NEW';
        status_changed_at   : DateTime;
        status_changed_by   : String(100);

        // Timeline
        detected_at         : DateTime @mandatory;           // When detected
        reported_at         : DateTime @mandatory;           // When reported
        triaged_at          : DateTime;                      // When triaged
        contained_at        : DateTime;                      // When contained
        resolved_at         : DateTime;                      // When resolved
        closed_at           : DateTime;                      // When closed

        // Metrics (MTTD, MTTR)
        time_to_detect_mins : Integer;                       // Detection time
        time_to_contain_mins : Integer;                      // Containment time
        time_to_resolve_mins : Integer;                      // Resolution time

        // Assignment
        assigned_to         : String(100);                   // Incident handler
        assigned_at         : DateTime;
        escalated_to        : String(100);                   // Escalation contact
        escalated_at        : DateTime;

        // Reporter
        reported_by         : String(100) @mandatory;
        reporter_email      : String(256);
        reporter_phone      : String(30);

        // Related Entities
        related_user_id     : UUID;                          // If user-related
        related_alert_id    : UUID;                          // Triggering alert

        // Investigation
        root_cause          : LargeString;                   // Root cause analysis
        impact_assessment   : LargeString;                   // Business impact
        affected_user_count : Integer default 0;             // Number of users affected
        affected_record_count : Integer default 0;           // Number of records affected

        // Response
        containment_actions : LargeString;                   // Containment steps taken
        remediation_actions : LargeString;                   // Remediation steps
        lessons_learned     : LargeString;                   // Lessons learned

        // Compliance
        requires_notification : Boolean default false;       // Requires external notification
        notification_sent   : Boolean default false;
        notification_date   : DateTime;
        notification_details : String(500);
}

/**
 * SECURITY_AUDIT_LOGS - Comprehensive Security Event Audit Trail
 * Source: FuelSphere native
 * Volume: ~5,000,000/year
 *
 * Immutable audit trail for all security-relevant events
 */
entity SECURITY_AUDIT_LOGS : cuid {
        // Event Identification
        event_id            : String(50) @mandatory;         // Unique event identifier
        event_timestamp     : DateTime @mandatory;           // Precise timestamp
        event_sequence      : Integer64;                     // Sequence for ordering

        // Classification
        event_category      : EventCategory @mandatory;
        event_type          : String(50) @mandatory;         // LOGIN, LOGOUT, ROLE_ASSIGN, etc.
        event_subtype       : String(50);                    // More specific classification

        // Actor
        user_id             : UUID;                          // User who performed action
        user_name           : String(100);                   // Username (denormalized)
        user_email          : String(256);                   // Email (denormalized)
        actor_type          : String(20);                    // USER, SYSTEM, INTEGRATION

        // Target
        object_type         : String(100) @mandatory;        // Type of object affected
        object_id           : String(256);                   // Identifier of object
        object_name         : String(200);                   // Human-readable name

        // Change Details
        action              : String(50) @mandatory;         // CREATE, UPDATE, DELETE, READ, EXECUTE
        old_value           : LargeString;                   // Previous value (JSON)
        new_value           : LargeString;                   // New value (JSON)
        changed_fields      : String(1000);                  // List of changed fields

        // Result
        result              : EventResult @mandatory;
        result_code         : String(20);                    // Specific result code
        error_message       : String(1000);                  // Error if failed

        // Context
        session_id          : String(100);                   // Session identifier
        correlation_id      : UUID;                          // Request correlation
        ip_address          : String(45) @mandatory;         // Client IP
        user_agent          : String(500);                   // Browser/client info
        geo_location        : String(100);                   // Approximate location

        // Source
        source_system       : String(50) @mandatory;         // FUELSPHERE, IAS, XSUAA
        source_component    : String(100);                   // Specific component
        api_endpoint        : String(500);                   // API endpoint called

        // Compliance
        sensitive_data      : Boolean default false;         // Involves sensitive data
        financial_impact    : Boolean default false;         // Has financial impact
        sox_relevant        : Boolean default false;         // SOX-relevant event

        // Retention
        retention_date      : Date @mandatory;               // Date after which can archive
        is_archived         : Boolean default false;
        archived_at         : DateTime;
}

/**
 * SECURITY_ALERTS - Security Monitoring Alerts
 * Source: FuelSphere native
 * Volume: ~10,000/year
 *
 * Security monitoring alerts with threshold-based triggers
 */
entity SECURITY_ALERTS : cuid {
        // Alert Identification
        alert_code          : String(30) @mandatory;         // ALRT-{DATE}-{SEQ}
        alert_name          : String(200) @mandatory;        // Alert display name

        // Classification
        alert_type          : String(50) @mandatory;         // FAILED_LOGIN, ANOMALY, etc.
        severity            : IncidentSeverity @mandatory;
        priority            : Integer default 50;            // 1-100 priority score

        // Trigger
        triggered_at        : DateTime @mandatory;
        trigger_rule        : String(100) @mandatory;        // Rule that triggered
        trigger_threshold   : String(100);                   // Threshold breached
        trigger_value       : Decimal(15,4);                 // Actual value

        // Status
        status              : AlertStatus default 'ACTIVE';
        status_changed_at   : DateTime;
        status_changed_by   : String(100);

        // Related Entity
        related_user_id     : UUID;                          // If user-related
        related_user_name   : String(100);
        related_ip_address  : String(45);                    // If IP-related
        related_event_id    : UUID;                          // Triggering event

        // Details
        alert_details       : LargeString;                   // Alert context JSON
        recommended_action  : String(500);                   // Suggested response

        // Response
        acknowledged_by     : String(100);
        acknowledged_at     : DateTime;
        resolution_notes    : String(1000);
        resolved_by         : String(100);
        resolved_at         : DateTime;

        // Escalation
        auto_escalate       : Boolean default false;
        escalation_time     : DateTime;                      // When to escalate
        escalated           : Boolean default false;
        escalated_to        : String(100);
        escalated_at        : DateTime;

        // Incident Created
        incident_created    : Boolean default false;
        incident_id         : UUID;                          // Reference to incident
}

/**
 * SECURITY_CONFIGURATIONS - Security Policy Settings
 * Source: FuelSphere native
 * Volume: ~100 records
 *
 * Security configuration parameters and policy settings
 */
entity SECURITY_CONFIGURATIONS : cuid, ActiveStatus, AuditTrail {
        // Configuration Identification
        config_key          : String(100) @mandatory;        // Unique config key
        config_name         : String(100) @mandatory;        // Display name
        config_group        : String(50) @mandatory;         // PASSWORD, SESSION, LOCKOUT, etc.
        config_description  : String(500);                   // Configuration description

        // Value
        config_value        : String(1000) @mandatory;       // Current value
        config_type         : String(20) @mandatory;         // STRING, INTEGER, BOOLEAN, JSON
        default_value       : String(1000);                  // Default value
        min_value           : Decimal(15,4);                 // Minimum if numeric
        max_value           : Decimal(15,4);                 // Maximum if numeric
        allowed_values      : String(1000);                  // Comma-separated if enum

        // Scope
        company_code        : String(4);                     // Company-specific (null = global)

        // Compliance
        sox_relevant        : Boolean default false;         // SOX-controlled setting
        requires_dual_approval : Boolean default false;      // Change requires dual approval

        // Change Control
        last_change_reason  : String(500);                   // Reason for last change
        last_change_ticket  : String(50);                    // Change ticket reference

        // Audit
        change_count        : Integer default 0;             // Number of times changed
}

/**
 * SOD_RULES - Segregation of Duties Rule Definitions
 * Source: FuelSphere native
 * Volume: ~100 records
 *
 * Defines SoD rules for automatic conflict detection
 */
entity SOD_RULES : cuid, ActiveStatus, AuditTrail {
        // Rule Identification
        rule_id             : String(50) @mandatory;         // SOD-RULE-{SEQ}
        rule_name           : String(200) @mandatory;        // Rule display name
        rule_description    : String(1000);                  // Rule explanation

        // Conflicting Roles
        role_1_pattern      : String(200) @mandatory;        // First role (pattern)
        role_2_pattern      : String(200) @mandatory;        // Second role (pattern)

        // Risk Assessment
        risk_level          : String(10) @mandatory;         // LOW, MEDIUM, HIGH, CRITICAL
        risk_category       : String(50);                    // FINANCIAL, OPERATIONAL, etc.
        risk_description    : String(500);                   // Business risk explanation
        potential_fraud_type : String(200);                  // Type of fraud this prevents

        // Scope
        company_codes       : String(100);                   // Applicable company codes

        // Exception Policy
        exception_allowed   : Boolean default true;          // Can exceptions be granted
        max_exception_days  : Integer default 365;           // Maximum exception validity
        requires_ciso_approval : Boolean default false;      // CISO approval required

        // Compliance
        sox_control_id      : String(30);                    // Related SOX control
        regulatory_reference : String(200);                  // External regulation
}

// ============================================================================
// FDD-10: NATIVE PRICING ENGINE
// ============================================================================

/**
 * Pricing Engine Types
 */
type PricingEngineType : String(20) enum { NATIVE; SAP_CPE; HYBRID }
type FormulaType : String(20) enum { INDEX_LINKED; FIXED; FLOATING; TIERED }
type FormulaStatus : String(20) enum { DRAFT; PENDING_APPROVAL; ACTIVE; EXPIRED; ARCHIVED }
type ComponentType : String(30) enum {
        BASE_INDEX;
        PREMIUM;
        PERCENTAGE;
        INTO_PLANE;
        TRANSPORT;
        HANDLING;
        EXCISE_DUTY;
        VAT;
        OTHER_TAX;
        CUSTOM
}
type CalculationType : String(20) enum { FIXED; PERCENTAGE; LOOKUP; FORMULA }
type ApplyToType : String(20) enum { BASE; CUMULATIVE; SUBTOTAL }
type IndexProvider : String(20) enum { PLATTS; ARGUS; REUTERS; CUSTOM }
type IndexFrequency : String(20) enum { DAILY; WEEKLY; MONTHLY }
type VarianceFlag : String(15) enum { MATCH; MINOR; SIGNIFICANT; CRITICAL }

/**
 * PRICING_CONFIGURATIONS - Engine Selection per Company
 * Source: FuelSphere native
 * Volume: ~10 records
 *
 * Configures pricing engine selection (Native, SAP CPE, or Hybrid)
 * per company code for flexible pricing strategy
 */
entity PRICING_CONFIGURATIONS : cuid, ActiveStatus, AuditTrail {
        // Company Scope
        company_code        : String(4) @mandatory;          // SAP Company Code

        // Engine Selection
        default_engine      : PricingEngineType default 'NATIVE';  // Primary engine
        cpe_endpoint        : String(500);                   // SAP CPE API endpoint URL
        cpe_destination     : String(100);                   // BTP Destination name

        // Fallback Configuration
        cpe_fallback_enabled : Boolean default true;         // Enable fallback to Native
        fallback_threshold_ms : Integer default 5000;        // CPE timeout before fallback

        // Hybrid Mode Settings
        hybrid_comparison_enabled : Boolean default false;   // Compare Native vs CPE
        variance_threshold_pct : Decimal(5,2) default 1.00;  // Variance alert threshold (%)
        log_all_derivations : Boolean default false;         // Log even matching prices

        // Automation
        auto_derivation_enabled : Boolean default true;      // Enable scheduled derivation
        derivation_schedule : String(50);                    // Cron expression
        derivation_time     : Time;                          // Daily derivation time
        price_validity_hours : Integer default 24;           // Price cache validity

        // Defaults
        default_currency    : Association to CURRENCY_MASTER; // Default pricing currency
        default_uom         : Association to UNIT_OF_MEASURE;       // Default UoM (KG, LTR)

        // Notifications
        notify_on_variance  : Boolean default true;
        notification_email  : String(500);                   // Alert recipients
}

/**
 * PRICING_FORMULAS - Native Formula Definitions
 * Source: FuelSphere native
 * Volume: ~200 records
 *
 * Pricing formula builder with multi-component support
 * Final Price = Base Index + Premium + Into-Plane + Transport + Handling + Taxes
 */
entity PRICING_FORMULAS : cuid, AuditTrail {
        // Formula Identification
        formula_id          : String(50) @mandatory;         // FRM-{SEQ}
        formula_name        : String(100) @mandatory;        // Formula display name
        formula_description : String(500);                   // Detailed description

        // Formula Type
        formula_type        : FormulaType @mandatory;        // INDEX_LINKED, FIXED, etc.
        base_index_type     : String(30);                    // Primary index type reference

        // Currency & UoM (explicit FK fields for CSV loading)
        currency_ID         : String(3) @mandatory;           // FK to CURRENCY_MASTER
        uom_ID              : String(3) @mandatory;           // FK to UNIT_OF_MEASURE
        currency            : Association to CURRENCY_MASTER on currency.currency_code = currency_ID;
        uom                 : Association to UNIT_OF_MEASURE on uom.uom_code = uom_ID;

        // Validity
        valid_from          : Date @mandatory;               // Validity start date
        valid_to            : Date;                          // Validity end date (null = indefinite)

        // Versioning
        version             : Integer default 1;             // Formula version number
        previous_version_id : UUID;                          // Reference to prior version

        // Status & Workflow
        status              : FormulaStatus default 'DRAFT';
        status_changed_at   : DateTime;
        status_changed_by   : String(100);

        // Approval Workflow (FPE-001, FPE-006)
        requires_approval   : Boolean default true;
        approval_threshold  : Decimal(15,2);                 // Dual approval if value > threshold
        requested_by        : String(100);
        requested_at        : DateTime;
        approved_by         : String(100);                   // Must be different from creator
        approved_at         : DateTime;
        rejection_reason    : String(500);

        // Second Approver (for high-value formulas)
        second_approver     : String(100);
        second_approved_at  : DateTime;

        // Scope
        company_code        : String(4);                     // Company-specific (null = all)
        supplier_id         : UUID;                          // Supplier-specific (null = all)

        // Composition
        components          : Composition of many FORMULA_COMPONENTS on components.formula = $self;
}

/**
 * FORMULA_COMPONENTS - Formula Building Blocks
 * Source: FuelSphere native
 * Volume: ~1,000 records
 *
 * Individual components that make up a pricing formula
 * Calculated in sequence order
 */
entity FORMULA_COMPONENTS : cuid, AuditTrail {
        // Parent Formula
        formula             : Association to PRICING_FORMULAS @mandatory;

        // Sequence & Identification
        sequence            : Integer @mandatory;            // Calculation order (1-99)
        component_name      : String(50) @mandatory;         // Display name
        component_description : String(200);                 // Description

        // Component Type
        component_type      : ComponentType @mandatory;      // BASE_INDEX, PREMIUM, etc.
        calculation_type    : CalculationType @mandatory;    // FIXED, PERCENTAGE, LOOKUP

        // Values
        fixed_value         : Decimal(15,4);                 // Fixed amount value
        percentage_value    : Decimal(8,4);                  // Percentage markup
        min_value           : Decimal(15,4);                 // Minimum cap
        max_value           : Decimal(15,4);                 // Maximum cap

        // Index Lookup
        lookup_index        : Association to MARKET_INDICES; // Market index reference
        index_offset_days   : Integer default 0;             // Days offset from price date

        // WP-20 / PRC411. Non-business days carry no assessment, and the
        // policy governs resolution — NEVER a silent zero. Named by the rule;
        // no field existed to hold it.
        //   PRIOR_PUBLISHED  take the most recent published quote before it
        //   FAIL             refuse to price rather than substitute
        missing_quote_policy : String(20) default 'PRIOR_PUBLISHED';
        use_average         : Boolean default false;         // Use rolling average
        average_days        : Integer default 5;             // Rolling average period

        // Calculation Scope
        apply_to            : ApplyToType default 'CUMULATIVE'; // BASE, CUMULATIVE, SUBTOTAL

        // Currency Override
        component_currency  : Association to CURRENCY_MASTER; // Override currency
        exchange_rate_type  : String(10);                    // Exchange rate type for conversion

        // Conditional Logic
        condition_field     : String(50);                    // Field for conditional application
        condition_operator  : String(10);                    // EQ, NE, GT, LT, GTE, LTE
        condition_value     : String(100);                   // Condition value

        // Status
        is_active           : Boolean default true;
}

/**
 * MARKET_INDICES - Index Definitions
 * Source: FuelSphere native
 * Volume: ~50 records
 *
 * Market index definitions (Platts MOPS, Argus FOB, Reuters, Custom)
 */
entity MARKET_INDICES : cuid, ActiveStatus, AuditTrail {
        // Index Identification
        index_code          : String(30) @mandatory;         // PLATTS-JETA1-SIN, ARGUS-FOB-SING
        index_name          : String(100) @mandatory;        // Index display name
        index_description   : String(500);                   // Detailed description

        // Provider
        provider            : IndexProvider @mandatory;      // PLATTS, ARGUS, REUTERS, CUSTOM
        provider_reference  : String(100);                   // Provider's index code

        // Index Type
        index_type          : String(30) @mandatory;         // PLATTS_MOPS, ARGUS_FOB_SING, etc.
        product_type        : String(30);                    // JET_A1, AVGAS, etc.
        region              : String(50);                    // SINGAPORE, ROTTERDAM, USGC

        // Currency & UoM (explicit FK fields for CSV loading)
        currency_ID         : String(3) @mandatory;           // FK to CURRENCY_MASTER
        uom_ID              : String(3) @mandatory;           // FK to UNIT_OF_MEASURE
        currency            : Association to CURRENCY_MASTER on currency.currency_code = currency_ID;
        uom                 : Association to UNIT_OF_MEASURE on uom.uom_code = uom_ID;

        // Publication
        frequency           : IndexFrequency default 'DAILY';
        publication_time    : Time;                          // Daily publication time
        timezone            : String(50) default 'UTC';      // Publication timezone
        publication_lag_days : Integer default 0;            // Days after trade date

        // Import Configuration
        import_enabled      : Boolean default true;
        import_source       : String(100);                   // File path or API endpoint
        import_format       : String(20);                    // CSV, EXCEL, API
        auto_import_enabled : Boolean default false;

        // Validation
        requires_verification : Boolean default true;        // FPE-004
        min_expected_value  : Decimal(15,4);                 // Minimum plausible value
        max_expected_value  : Decimal(15,4);                 // Maximum plausible value
        max_daily_change_pct : Decimal(5,2);                 // Max % change threshold
}

/**
 * MARKET_INDEX_VALUES - Daily Index Values
 * Source: Import (CSV/Excel/Manual)
 * Volume: ~365,000/year
 *
 * Daily market index values imported from external sources
 */
entity MARKET_INDEX_VALUES : cuid, AuditTrail {
        // Index Reference
        market_index        : Association to MARKET_INDICES @mandatory;

        // Date & Value
        effective_date      : Date @mandatory;               // Price effective date
        index_value         : Decimal(15,4) @mandatory;      // Index value
        previous_value      : Decimal(15,4);                 // Previous day value
        daily_change        : Decimal(15,4);                 // Change from previous
        daily_change_pct    : Decimal(8,4);                  // % change from previous

        // Additional Values (some indices publish multiple)
        high_value          : Decimal(15,4);                 // Daily high
        low_value           : Decimal(15,4);                 // Daily low
        average_value       : Decimal(15,4);                 // Daily average

        // Import Details
        import_source       : String(100);                   // File name or 'MANUAL'
        import_batch_id     : String(50);                    // Import batch reference
        imported_at         : DateTime @mandatory;
        imported_by         : String(100) @mandatory;

        // Verification (FPE-004)
        verification_status : String(20) default 'PENDING';  // PENDING, VERIFIED, REJECTED
        verified_by         : String(100);
        verified_at         : DateTime;
        verification_notes  : String(500);

        // Flags
        is_estimated        : Boolean default false;         // Estimated/interpolated value
        is_holiday          : Boolean default false;         // Market holiday
        is_corrected        : Boolean default false;         // Correction to prior value
        correction_reason   : String(500);

        // WP-20 restatement. A publication may revise a historical assessment,
        // and THE ORIGINAL VALUE IS RETAINED — so a restatement inserts a new
        // row rather than overwriting one.
        //
        // is_corrected alone cannot carry this: it records THAT a correction
        // happened, not which of two rows for one date is the one to price
        // on. previous_value is the previous DAY's value, a different thing
        // entirely. This mirrors the supersession pattern DERIVED_PRICES
        // already uses for exactly the same reason.
        is_current          : Boolean default true;
        restates            : Association to MARKET_INDEX_VALUES;
}

/**
 * Provisional or final (WP-20, 02-BEHAVIOUR section 8)
 *
 * PROVISIONAL IS NOT A DRAFT. A contract priced on a monthly average cannot
 * be priced at uplift, so the provisional price is a real price from a
 * contracted proxy and it settles:
 *
 *     at uplift     -> PROVISIONAL, from the contracted proxy
 *     period close  -> FINAL, from the published average
 *     difference    -> credit or debit note
 *
 * The distinction is load-bearing downstream: WP-21 suspends the invoice
 * price variance check while a price is provisional, because comparing a
 * proxy against a contract that has not resolved produces a variance every
 * time. WP-20 does not implement that suspension, but the price has to be
 * able to SAY which it is or WP-21 cannot.
 *
 * @assert.range per D25.
 */
@assert.range: true
type PriceBasis : String(20) enum {
    Provisional = 'PROVISIONAL';   // From the contracted proxy. A real price, and it settles
    Final       = 'FINAL';         // From the published average, at period close
}

/**
 * DERIVED_PRICES - Calculated Daily Prices
 * Source: FuelSphere native
 * Volume: ~180,000/year
 *
 * Calculated fuel prices for contracts based on formulas and indices
 */
entity DERIVED_PRICES : cuid, AuditTrail {
        // Contract Reference
        contract            : Association to MASTER_CONTRACTS @mandatory;
        contract_number     : String(35);                    // Denormalized for queries

        // Formula Reference (if Native)
        formula             : Association to PRICING_FORMULAS;
        formula_version     : Integer;                       // Version used for calculation

        // Price Details
        price_date          : Date @mandatory;               // Price effective date
        derived_price       : Decimal(15,4) @mandatory;      // Final calculated price
        currency            : Association to CURRENCY_MASTER @mandatory;
        uom                 : Association to UNIT_OF_MEASURE @mandatory;

        // Base Index
        base_index          : Association to MARKET_INDICES;
        base_index_value    : Decimal(15,4);                 // Base index value used
        base_index_date     : Date;                          // Index effective date

        // Pricing Engine
        pricing_engine      : String(20) @mandatory;         // NATIVE, SAP_CPE, NATIVE_FALLBACK

        // WP-20. Nothing on this entity could say whether a price was the
        // proxy taken at uplift or the settled figure at period close, and
        // is_current cannot: both are current, at different times, for the
        // same uplift.
        //
        // Named price_status because PRC408 names it that. The rule text is
        // the specification for a field that did not exist.
        price_status        : PriceBasis default 'FINAL';
        // The period a PROVISIONAL price will settle against. Null on a FINAL
        // price because it has already settled.
        settles_for_period  : String(7);                     // YYYY-MM

        // Hybrid Comparison
        cpe_price           : Decimal(15,4);                 // CPE price (hybrid mode)
        price_variance      : Decimal(15,4);                 // Native vs CPE variance
        variance_pct        : Decimal(8,4);                  // Variance percentage
        variance_flag       : VarianceFlag;                  // MATCH, MINOR, SIGNIFICANT, CRITICAL

        // Component Breakdown (JSON)
        component_breakdown : LargeString;                   // JSON with calculation details
        /**
         * component_breakdown JSON structure:
         * {
         *   "baseIndex": { "name": "PLATTS-JETA1-SIN", "value": 85.50, "date": "2026-01-20" },
         *   "components": [
         *     { "name": "Premium", "type": "FIXED", "value": 2.50 },
         *     { "name": "Into-Plane Fee", "type": "FIXED", "value": 8.00 },
         *     { "name": "Handling", "type": "PERCENTAGE", "pct": 1.5, "value": 1.44 }
         *   ],
         *   "subtotals": { "beforeTax": 97.44, "taxes": 5.00, "final": 102.44 }
         * }
         */

        // Calculation Metadata
        calculated_at       : DateTime @mandatory;
        calculation_duration_ms : Integer;                   // Processing time

        // Status
        is_current          : Boolean default true;          // Latest price for date
        superseded_by       : UUID;                          // Reference to newer calculation
        superseded_reason   : String(200);

        // Validity
        valid_from          : DateTime @mandatory;           // Price validity start
        valid_to            : DateTime;                      // Price validity end
}

/**
 * PRICE_DERIVATION_LOGS - Calculation Audit Trail
 * Source: FuelSphere native
 * Volume: ~1,000,000/year
 *
 * Complete audit trail for SOX compliance (FPE-005)
 */
entity PRICE_DERIVATION_LOGS : cuid {
        // Derivation Reference
        derived_price       : Association to DERIVED_PRICES;
        derivation_batch_id : String(50);                    // Batch run identifier

        // Timing
        log_timestamp       : DateTime @mandatory;
        sequence            : Integer @mandatory;            // Step sequence

        // Log Entry
        log_level           : String(10) @mandatory;         // INFO, DEBUG, WARNING, ERROR
        log_category        : String(30) @mandatory;         // CONFIG, INDEX, COMPONENT, RESULT
        log_message         : String(1000) @mandatory;       // Log message
        log_details         : LargeString;                   // Additional details (JSON)

        // Context
        contract_id         : UUID;
        formula_id          : UUID;
        component_id        : UUID;
        index_id            : UUID;

        // Values (for audit)
        input_value         : Decimal(15,4);                 // Input to calculation step
        output_value        : Decimal(15,4);                 // Output from calculation step
        calculation_expression : String(500);                // Formula expression used

        // Error Details (if any)
        error_code          : String(20);
        error_message       : String(1000);
        stack_trace         : LargeString;

        // User Context
        executed_by         : String(100);
        execution_context   : String(50);                    // BATCH, MANUAL, API, SIMULATION
}

/**
 * PRICE_SIMULATIONS - What-If Analysis
 * Source: FuelSphere native
 * Volume: ~10,000/year
 *
 * Price simulation and what-if analysis results
 */
entity PRICE_SIMULATIONS : cuid, AuditTrail {
        // Simulation Identification
        simulation_id       : String(30) @mandatory;         // SIM-{DATE}-{SEQ}
        simulation_name     : String(100) @mandatory;        // Simulation description

        // Scope
        contract            : Association to MASTER_CONTRACTS;
        formula             : Association to PRICING_FORMULAS;
        simulation_date     : Date @mandatory;               // Target price date

        // Index Overrides (JSON)
        index_overrides     : LargeString;                   // Override index values
        /**
         * index_overrides JSON structure:
         * [
         *   { "indexCode": "PLATTS-JETA1-SIN", "overrideValue": 90.00 },
         *   { "indexCode": "ARGUS-FOB-SING", "overrideValue": 88.50 }
         * ]
         */

        // Component Overrides (JSON)
        component_overrides : LargeString;                   // Override component values

        // Results
        simulated_price     : Decimal(15,4);                 // Calculated simulation price
        current_price       : Decimal(15,4);                 // Current actual price
        price_difference    : Decimal(15,4);                 // Difference
        difference_pct      : Decimal(8,4);                  // % difference

        // Breakdown
        simulation_breakdown : LargeString;                  // Full calculation breakdown (JSON)

        // Metadata
        simulated_at        : DateTime @mandatory;
        simulated_by        : String(100) @mandatory;
        simulation_notes    : String(1000);
}

/**
 * INDEX_IMPORT_BATCHES - Index Value Import Tracking
 * Source: FuelSphere native
 * Volume: ~5,000/year
 *
 * Tracks bulk imports of market index values
 */
entity INDEX_IMPORT_BATCHES : cuid, AuditTrail {
        // Batch Identification
        batch_id            : String(50) @mandatory;         // IMP-{DATE}-{SEQ}
        batch_name          : String(100);                   // Import description

        // Import Details
        import_start_time   : DateTime @mandatory;
        import_end_time     : DateTime;
        duration_seconds    : Integer;

        // Source
        source_type         : String(20) @mandatory;         // FILE, MANUAL, API
        source_file_name    : String(200);                   // Original file name
        source_file_path    : String(500);                   // Storage path

        // Scope
        market_index        : Association to MARKET_INDICES; // Single index (null = multiple)
        date_from           : Date @mandatory;               // Import date range start
        date_to             : Date @mandatory;               // Import date range end

        // Statistics
        records_total       : Integer default 0;             // Total records in source
        records_imported    : Integer default 0;             // Successfully imported
        records_updated     : Integer default 0;             // Updated existing
        records_skipped     : Integer default 0;             // Skipped (duplicates)
        records_failed      : Integer default 0;             // Failed to import

        // Status
        status              : String(20) default 'PENDING';  // PENDING, IN_PROGRESS, COMPLETED, FAILED
        error_summary       : LargeString;                   // Import errors summary

        // Verification
        requires_verification : Boolean default true;
        verified_by         : String(100);
        verified_at         : DateTime;
}

// ============================================================================
// NUMBER RANGES (WP-04 / D4)
// Atomic allocation for the FO / EPD / FT number formats.
//
// One counter row per prefix + station + date, e.g. 'FO-MNL-20260316'.
// A number is drawn with an atomic increment inside the request transaction,
// replacing the client-side max+1 read that produced duplicates under
// concurrent creation.
// ============================================================================

entity NUMBER_RANGES {
    key range_key   : String(40);       // {PREFIX}-{STATION}-{YYYYMMDD}
        last_number : Integer default 0; // Last number issued for that key
}

/**
 * FuelSphere - Planning Service (FDD-02)
 *
 * Annual Planning & Forecasting Module:
 * - Fuel demand forecasting based on flight schedules
 * - Budget version management with scenario comparison
 * - SAP Analytics Cloud (SAC) writeback integration
 * - Route-Aircraft fuel consumption matrix management
 *
 * Key Capabilities:
 * - Flight schedule integration with SSIM format support
 * - Fuel demand calculation: Trip + Taxi + Contingency + Alternate + Reserve
 * - Price planning with CPE/Native Engine integration (FDD-03)
 * - Multi-scenario budget analysis
 *
 * Service Path: /odata/v4/planning
 */

using { fuelsphere as db } from '../db/schema';
// DESIGNATED_SUPPLIERS lives in its own file, and schema.cds cannot see it -
// that file imports schema.cds, so the dependency runs one way only. Without
// this second `using`, `cds compile srv` reports "Artifact has not been found"
// while `cds serve` succeeds, because serve loads all of db/ and srv/ and
// compile does not. A model that boots and will not compile.
using { fuelsphere as ds } from '../db/designated-suppliers';
using { fuelsphere as sc } from '../db/supplier-contacts';
using { fuelsphere as perf } from '../db/aircraft-performance-fields';

@path: '/odata/v4/planning'
service PlanningService {

    // ========================================================================
    // CORE ENTITIES - Planning Versions
    // ========================================================================

    /**
     * PlanningVersions - Budget/Forecast Version Management
     * Draft-enabled for work-in-progress planning
     *
     * Access:
     * - Fuel Planner: Create/Edit own versions
     * - Finance Controller: Approve versions, trigger SAC writeback
     * - Operations Manager: Read-only access
     */
    @odata.draft.enabled
    entity PlanningVersions as projection on db.PLANNING_VERSION {
        *,
        lines           : redirected to PlanningLines,
        calculations    : redirected to DemandCalculations
    } actions {
        /**
         * Submit version for approval
         * Transitions: Draft → In Review
         * Requires all lines to have valid data
         */
        action submit() returns PlanningVersions;

        /**
         * Approve version
         * Transitions: In Review → Approved
         * Triggers SAC writeback preparation
         */
        action approve() returns PlanningVersions;

        /**
         * Lock version (make read-only)
         * Transitions: Approved → Locked
         * Triggers SAC writeback execution
         */
        action lock() returns PlanningVersions;

        /**
         * Reject version back to draft
         * Transitions: In Review → Draft
         */
        action reject(reason: String) returns PlanningVersions;

        /**
         * Copy version to create new scenario
         * Creates a new version with copied data
         */
        action copyToScenario(newVersionName: String, versionType: String) returns PlanningVersions;

        /**
         * Calculate all demand for this version
         * Uses flight schedule and Route-Aircraft Matrix
         */
        action calculateDemand() returns DemandCalculationSummary;

        /**
         * Apply price assumptions from Contracts/CPE
         * Updates all planning lines with current prices
         */
        action applyPricing() returns PricingApplicationResult;

        /**
         * Trigger SAC writeback
         * Sends approved budget data to SAP Analytics Cloud
         */
        action writebackToSAC() returns SACWritebackResult;
    };

    // ========================================================================
    // PLANNING LINES - Detailed Planning Data
    // ========================================================================

    /**
     * PlanningLines - Period/Station level planning data
     * Aggregated demand and cost projections
     */
    entity PlanningLines as projection on db.PLANNING_LINE {
        *,
        version     : redirected to PlanningVersions,
        airport     : redirected to Airports,
        currency    : redirected to Currencies
    };

    // ========================================================================
    // DEMAND CALCULATION
    // ========================================================================

    /**
     * DemandCalculations - Fuel demand results by flight/route
     */
    entity DemandCalculations as projection on db.DEMAND_CALCULATION {
        *,
        version         : redirected to PlanningVersions,
        flight_schedule : redirected to FlightSchedule,
        route           : redirected to Routes,
        aircraft_type   : redirected to Aircraft,
        matrix_used     : redirected to RouteAircraftMatrix
    };

    // ========================================================================
    // ROUTE-AIRCRAFT MATRIX
    // ========================================================================

    /**
     * RouteAircraftMatrix - Standard fuel consumption by route/aircraft
     * Managed by Fuel Planner
     *
     * Formula: Total = Trip + Taxi + Contingency + Alternate + Reserve + Extra
     */
    @odata.draft.enabled
    entity RouteAircraftMatrix as projection on db.ROUTE_AIRCRAFT_MATRIX {
        *,
        route           : redirected to Routes,
        aircraft_type   : redirected to Aircraft
    } actions {
        /**
         * Calculate total standard fuel
         * Sums all fuel components
         */
        action calculateTotal() returns RouteAircraftMatrix;

        /**
         * Copy matrix entry for new aircraft type
         */
        action copyForAircraft(targetAircraftType: String) returns RouteAircraftMatrix;

        /**
         * Apply seasonal adjustment
         */
        action applySeasonal(season: String) returns RouteAircraftMatrix;
    };

    // ========================================================================
    // PRICE ASSUMPTIONS
    // ========================================================================

    /**
     * PriceAssumptions - Price forecasts for planning
     */
    entity PriceAssumptions as projection on db.PRICE_ASSUMPTION {
        *,
        version         : redirected to PlanningVersions,
        airport         : redirected to Airports,
        product         : redirected to Products,
        currency        : redirected to Currencies,
        source_contract : redirected to Contracts,
        source_formula  : redirected to PricingFormulas,
        base_index      : redirected to MarketIndices
    } actions {
        /**
         * Derive price from Contracts/CPE module
         */
        action deriveFromCPE() returns PriceAssumptions;
    };

    // ========================================================================
    // SCENARIO COMPARISON
    // ========================================================================

    /**
     * ScenarioComparisons - Version comparison analysis
     */
    entity ScenarioComparisons as projection on db.SCENARIO_COMPARISON {
        *,
        base_version    : redirected to PlanningVersions,
        compare_version : redirected to PlanningVersions
    } actions {
        /**
         * Run comparison analysis
         * Calculates variances between versions
         */
        action runComparison() returns ScenarioComparisons;

        /**
         * Export comparison to Excel
         */
        action exportToExcel() returns ExportResult;
    };

    // ========================================================================
    // REFERENCE DATA (Read-only from Master Data)
    // ========================================================================

    /**
     * FlightSchedule - Flight schedule management
     * Primary entity for flight schedule data, Excel import, and planning integration
     */
    // D44. `fuel_order` is NOT exposed. It is a to-one over a one-to-many
    // condition on the database entity - `on fuel_order.flight = $self` can
    // match several rows and returns one arbitrarily - so a service that
    // offers it invites the next reader to treat an arbitrary order as the
    // order. `orders` is the complete set and is exposed in its place.
    //
    // The declaration stays in db/schema.cds, commented at the site.
    // THE CANONICAL PROJECTION OF FLIGHT_SCHEDULE ON THIS SERVICE.
    //
    // FlightAircraft also projects it, so CAP cannot pick a redirection
    // target for PlanningVersions:based_on_schedule on its own and refuses
    // to guess. Pinned HERE rather than there, which preserves where every
    // existing navigation already points - the alternative silently moves
    // them to a narrow card view.
    @cds.redirection.target
    entity FlightSchedule as projection on db.FLIGHT_SCHEDULE {
        *,
        aircraft    : redirected to Aircraft,
        origin      : redirected to Airports,
        destination : redirected to Airports
    } excluding { fuel_order };

    /**
     * FlightDispatches - the plan a flight was released against.
     *
     * PLANNING IS THE FLIGHT-CENTRIC SERVICE: it exposes, READ-ONLY, what a
     * FLIGHT REACHES - not what any service owns. That is a boundary rather
     * than the absence of one; it is simply not module ownership. The flight
     * object page is a planning artefact and a planner wants the plan.
     *
     * FuelOrderService keeps its own FlightDispatches and its own facet. A
     * fuel controller reaching a plan FROM AN ORDER is a different journey,
     * and neither annotation is a copy of the other - each is written against
     * what its own projection exposes.
     *
     * RESTRICTED ON PURPOSE. A flight's page wants the regulated stack and
     * the release, not fifty columns. The restriction is what keeps the
     * duplication small; it is only dangerous where the annotation lives on
     * the DATABASE entity and every projection must carry every field named.
     */
    @readonly
    entity FlightDispatches as projection on db.FLIGHT_DISPATCH {
        key ID,
        flight_number,
        flight_date,
        plan_group_id,
        plan_version,
        plan_status,
        tail_number,
        dispatch_qty_kg,
        block_fuel_kg,
        required_uplift_kg,
        rob_departure_kg,
        alternate_airport,
        dispatch_source,
        dispatch_timestamp,
        flight_schedule : redirected to FlightSchedule
    };

    /**
     * FuelOrders - Read-only reference to fuel orders linked to flight schedules
     */
    @readonly
    entity FuelOrders as projection on db.FUEL_ORDERS {
        key ID,
        order_number,
        flight : redirected to FlightSchedule,

        // THE GLOBAL FILTER'S NAMES, so the Fuel Orders card filters to the
        // flight the page is about.
        //
        // The projection carried `flight` (a navigation) and station_code and
        // NONE of the filter's field names. An OVP propagates by MATCHING
        // PROPERTY NAMES, so the overlap was zero and the card would have
        // shown all 25 orders on a page about one flight.
        //
        // I checked for a flight REFERENCE first and reported this entity
        // ready. That is a different question from whether it carries the
        // name the filter propagates BY - the same shape as asserting an
        // entity has rows rather than the rows the card will show.
        flight.flight_number       as flight_number,
        flight.flight_date         as flight_date,
        flight.origin_airport      as origin_airport,
        flight.destination_airport as destination_airport,
        flight.airline_code        as airline_code,

        // THE UNIT OF ordered_quantity, AND IT IS NOT ALWAYS KILOGRAMS.
        //
        // Carried because a label cannot do this job: 3 of 25 orders are in
        // LTR and 22 in KG, and ALL THREE LITRE ORDERS ARE AC410'S -
        // FO-YYZ-20260410-001 is 2881.25 LTR on the demo flight itself. A
        // "(kg)" label on this column would be wrong on exactly the row the
        // walkthrough opens.
        //
        // This is a projection widening, not a schema change: db/ is
        // untouched and the column already exists on FUEL_ORDERS.
        uom_code,

        status,
        station_code,
        ordered_quantity,
        unit_price,
        total_amount,
        currency_code,
        requested_date,
        priority,
        notes
    };

    @readonly
    entity Airports as projection on db.MASTER_AIRPORTS {
        *,
        country : redirected to Countries,
        plant   : redirected to Plants
    };

    @readonly
    entity Routes as projection on db.ROUTE_MASTER {
        *,
        origin      : redirected to Airports,
        destination : redirected to Airports
    };

    @readonly
    entity Aircraft as projection on db.AIRCRAFT_MASTER {
        *,
        manufacturer : redirected to Manufacturers
    };

    // ========================================================================
    // The aircraft REGISTER - the individual tail, not the type.
    //
    // WP-07B put `tail` on five entities across two services and neither
    // service exposed the target, so the association resolved to nothing a
    // user could open: a flight named its registration and offered no way to
    // reach it. Five of the ten off-service associations found in the survey
    // were this one link.
    //
    // @readonly deliberately. This service consumes the register; it does not
    // maintain it. MasterDataService owns the writes.
    // ========================================================================
    @readonly
    entity AircraftRegistrations as projection on db.AIRCRAFT_REGISTRATIONS {
        *,
        aircraft_type : redirected to Aircraft
    };

    // D43. FLIGHT_SCHEDULE.closure_document was projected here and its target
    // was not, so the flight said its closure time was read from a photograph
    // and offered no way to see the photograph. @readonly: the evidence is
    // captured through FuelOrderService, which owns the write path.
    @readonly
    entity SourceDocuments as projection on db.SOURCE_DOCUMENTS;

    /**
     * FlightFuelDeliveries - the reconciliation verdict, per flight.
     *
     * DECLARED RATHER THAN LEFT AUTO-EXPOSED. CAP already surfaced this view
     * here as an association target of FlightSchedule, under its database
     * name and without anyone naming it - D47's second kind, which "arrives
     * with the entity" rather than being decided.
     *
     * The Flight Fuel Overview's FUEL STATUS card binds to it, and an
     * annotation cannot be written against a name nobody declared. Declaring
     * it makes the exposure a decision with a line behind it, which is what
     * D47 asked for.
     *
     * DECLARED UNDER THE DATABASE NAME, DELIBERATELY. Naming it
     * FlightFuelDeliveries reads better and is a BREAKING RENAME: the
     * auto-exposed entity is already called FLIGHT_FUEL_DELIVERIES in the
     * emitted EDMX, two annotate blocks in planning-fiori-annotations.cds
     * already target that name, and FlightSchedule.deliveries already
     * navigates to it. The compiler warned about ONE of the two blocks - the
     * `annotate ... with { element }` form - and said nothing about the
     * `annotate ... with @( ... )` term block, which is the D50 asymmetry in
     * a third variant.
     *
     * @cds.autoexpose IS REDUNDANT HERE, AND THE ORIGINAL NOTE SAID
     * OTHERWISE. CORRECTED BY A PLANT, E2b.
     *
     * The mechanism is real: CAP marks a view it auto-exposed as
     * @cds.autoexposed, and the auth layer refuses a direct read of any such
     * entity - `@cds.autoexposed && !@cds.autoexpose` returns 405 "not
     * explicitly exposed as part of the service"
     * (libx/_runtime/common/generic/auth/utils.js). The entity is in the
     * metadata, has an EntitySet, carries annotations, and cannot be read.
     *
     * WHAT WAS WRONG WAS WHICH LINE FIXES IT. Removing @cds.autoexpose from
     * this block and re-reading gives 200, not 405 - measured. It is the
     * EXPLICIT `entity ... as projection on ...` DECLARATION that makes the
     * set addressable; once that exists the entity is no longer merely
     * auto-exposed, so the guard never applies. Both changes were made in
     * one commit and the annotation got the credit.
     *
     * The 405 is still reachable and still bites: CONTRACT_LOCATIONS,
     * CONTRACT_PRODUCTS and FORMULA_COMPONENTS return it on this service
     * today, because nothing declares them. e2b-eight-cards-harness EXIT-2
     * is planted against one of those rather than against this block, which
     * is the difference between a criterion that fires and one that reads
     * as though it would.
     *
     * KEPT rather than removed: it is harmless, it documents the intent, and
     * it is what makes the exposure survive a future refactor that drops the
     * explicit declaration.
     *
     * That sharpens D47's second kind: an auto-exposed view is not merely
     * "declared everywhere and navigable nowhere", it is ADDRESSABLE NOWHERE.
     * A Fiori facet reaching it through a navigation works; an OVP card
     * naming the entity set gets 405, and the card renders empty with no
     * error a viewer can see.
     *
     * @readonly because the view is derived; FuelOrderService owns the write.
     */
    // AND THE CANONICAL PROJECTION OF FUEL_DELIVERIES, for the same reason
    // and with the same preference: FLIGHT_FUEL_TICKETS:delivery already
    // resolves here, and pinning the new full FuelDeliveries instead would
    // move it. Reachability was the thing being added; where existing
    // navigations point was not up for change in this package.
    @readonly
    @cds.autoexpose
    @cds.redirection.target
    entity FLIGHT_FUEL_DELIVERIES as projection on db.FLIGHT_FUEL_DELIVERIES;

    /**
     * FlightFuelTickets - the metered leg, per flight.
     *
     * THE TWIN OF THE ABOVE, and unaddressable for the same reason: CAP
     * auto-exposed it as an association target of FlightSchedule, marked it
     * @cds.autoexposed, and its auth layer then returns 405 on any direct
     * read. The Flight Fuel Overview's FUEL TICKETS card names this entity
     * set, so without this it would render empty with no error a viewer can
     * see.
     *
     * Found by sweeping every entity set on every service for addressability
     * BEFORE the remaining cards were written, rather than after.
     */
    @readonly
    @cds.autoexpose
    entity FLIGHT_FUEL_TICKETS as projection on db.FLIGHT_FUEL_TICKETS;

    /**
     * FlightAircraft - the tail, filterable by the flight.
     *
     * The Aircraft card cannot bind to AircraftRegistrations: that entity
     * carries no flight reference of any kind, so the global filter overlaps
     * it on nothing and the card would render all 31 tails on a page about
     * one flight. A card that ignores the filter is a card about something
     * else.
     *
     * Nor a static strip - the identity strip already carries tail and type,
     * so a strip duplicates it. And this is the card that GAINS MLW, MZFW and
     * engine_burn_rate_kgph the day work package B lands: a header would have
     * to become a card that day, a card gains three columns.
     */
    /**
     * FlightDesignation - both axes, so the card is not empty on 20 flights.
     *
     * The Supplier and Into-Plane Agent card cannot bind DesignatedSuppliers:
     * filtered by flight_number it sees flight-scoped rows only, and just TWO
     * of twenty-two flights have one. The rest resolve to a station default,
     * whose flight_number is null. Measured before the card was written.
     */
    @readonly
    entity FlightDesignation as projection on ds.FLIGHT_DESIGNATION {
        *,
        supplier         : redirected to Suppliers,
        into_plane_agent : redirected to Suppliers
    };

    /**
     * SupplierRoleContacts — FOUR ROWS PER SUPPLIER, ALWAYS.
     *
     * The strip that lets somebody ring at 05:00. A role with no contact is
     * a ROW reading "none recorded", not an absence: a missing row is
     * invisible, and the SME asked for these twice.
     *
     * The primary only, with other_count beside it, because the strip exists
     * to be scanned - and a strip showing one contact with no sign of a
     * second is the same silence as an Aircraft card that omits MLW.
     */
    @readonly
    entity SupplierRoleContacts as projection on sc.SUPPLIER_ROLE_CONTACTS {
        *,
        // A ROLE WITH NO CONTACT IS ORANGE, NOT RED AND NOT GREY.
        //
        // Not red: BP UK having no disputes contact is a gap in our records,
        // not a fault of this flight. Not neutral either - grey would read
        // as "nothing to say here", and the whole reason the row exists is
        // that there IS something to say.
        case when primary_name is null then 2 else 3 end
            as contactCriticality : Integer
    };

    /**
     * FlightContacts — who to ring for THIS flight, by party and role.
     *
     * The facet cannot be `designation/supplier/role_contacts`: designation
     * is an Association to MANY, so that path needs a key at the first hop
     * and Fiori has none. Measured - GET FlightSchedule(<id>)/designation/
     * supplier returns 404. Every hop exists and nothing renders.
     */
    @readonly
    entity FlightContacts as projection on sc.FLIGHT_CONTACTS {
        *,
        // PRESENT green, NONE_RECORDED orange, NOT_APPLICABLE NEUTRAL.
        //
        // Not-applicable is grey for the reason it is grey everywhere else
        // today: it is a FACT rather than a gap, and orange would say
        // "chase this" about a company that correctly does not hold the
        // role. Green would be worse - it would say we have a contact.
        case role_status
            when 'PRESENT'        then 3
            when 'NONE_RECORDED'  then 2
            else                       0
        end as contactCriticality : Integer,
        // AGENT FIRST. Where the supplier does not perform its own uplift,
        // the agent is who a planner actually rings, and "time is of the
        // essence" was the reason given.
        case party when 'AGENT' then 1 else 2 end
            as partyRank : Integer
    };

    @readonly
    entity SupplierContacts as projection on sc.SUPPLIER_CONTACTS {
        *,
        supplier : redirected to Suppliers
    };

    @readonly
    entity ContactRoles as projection on sc.CONTACT_ROLES;

    @readonly
    entity FlightAircraft as projection on db.FLIGHT_AIRCRAFT {
        *,
        tail : redirected to AircraftRegistrations,

        // THE TAIL'S FIGURE WINS, AND THE TYPE'S IS THE FALLBACK.
        //
        // Work package B added mtow_kg to AIRCRAFT_REGISTRATIONS as an
        // OVERRIDE, so two places can now hold this fact. ONE coalesce is
        // what stops that being a defect: it decides which governs, in one
        // expression, so no reader has to know there are two. Null on the
        // registration means the type's figure applies — and a null cannot
        // disagree with anything, which is the whole reason the override is
        // nullable rather than copied down.
        //
        // Resolved HERE rather than in the FLIGHT_AIRCRAFT view because
        // schema.cds cannot see the file that adds these fields — that file
        // imports it. The dependency runs one way.
        coalesce(tail.mtow_kg, tail.aircraft_type.mtow_kg) as mtow_resolved_kg : Decimal(15,2),
        tail.mtow_kg                as mtow_tail_kg  : Decimal(15,2),
        tail.aircraft_type.mtow_kg  as mtow_type_kg  : Decimal(15,2),

        // NULL ON ALL 31 ROWS TODAY. Carried so the resolution exists the
        // day data arrives, and deliberately NOT put on the Aircraft card:
        // three permanently blank columns on an operational page is the
        // eighth cause of an empty section.
        tail.mlw_kg                 as mlw_kg        : Decimal(15,2),
        tail.mzfw_kg                as mzfw_kg       : Decimal(15,2),
        tail.engine_burn_rate_kgph  as engine_burn_rate_kgph : Decimal(10,2)
    };

    /**
     * FuelDeliveries and FuelBurns - EXPOSED, and the boundary is stated.
     *
     * PlanningService exposes, READ-ONLY, WHAT A FLIGHT REACHES. A flight
     * reaches its delivery and its burn, so both are here.
     *
     * FuelBurns REVERSES a decision recorded at db/schema.cds on the `burns`
     * association, and the reasons it gave are answered rather than ignored:
     *
     *   "a burn is after the fact, a different reader"  - ownership is not
     *   reachability. BurnService still owns FUEL_BURNS: the handlers, the
     *   variance ladder and every write path stay there. This is @readonly.
     *
     *   "no service exposes both navigably"             - that was a
     *   consequence of nobody having decided to, not an independent
     *   obstacle. The decision is now taken and written here.
     *
     *   "it would grant a different reader access"      - a projection grants
     *   nothing @restrict does not. The authorisation point settles it.
     *
     * FuelDeliveries has the same justification and no reversal to record:
     * it was simply never on this service.
     *
     * INVOICES IS DELIBERATELY NOT HERE. An airline planner's overview
     * reaching the invoicing entity is a MODULE boundary rather than a
     * convenience, and the invoicing story has its own screens. A planner
     * asking "has this been billed" is the coverage report, which starts
     * from the ticket rather than from the flight. THAT IS WHY THE PAGE HAS
     * EIGHT CARDS AND THE MOCKUP SHOWS NINE.
     */
    // BOTH CARRY THE GLOBAL FILTER'S NAMES, for the reason written on
    // FuelOrders above. Exposing an entity makes its card ADDRESSABLE;
    // carrying these names makes the card ABOUT THIS FLIGHT. They are
    // separate steps and only doing the first leaves a card that renders
    // all 26 deliveries on a page about one leg.
    //
    // FuelBurns already had origin_airport and destination_airport of its
    // own - two of the seven - which is exactly the partial overlap that
    // looks like it works until someone filters on a flight number.
    @readonly
    entity FuelDeliveries as projection on db.FUEL_DELIVERIES {
        *,
        order : redirected to FuelOrders,
        tail  : redirected to AircraftRegistrations,
        order.flight.flight_number       as flight_number,
        order.flight.flight_date         as flight_date,
        order.flight.origin_airport      as origin_airport,
        order.flight.destination_airport as destination_airport,
        order.flight.airline_code        as airline_code
    };

    @readonly
    entity FuelBurns as projection on db.FUEL_BURNS {
        *,
        flight : redirected to FlightSchedule,
        tail   : redirected to AircraftRegistrations,
        flight.flight_number       as flight_number,
        flight.flight_date         as flight_date,
        flight.airline_code        as airline_code
    };

    /**
     * DesignatedSuppliers — who fuels this flight, at this station, on this date.
     *
     * Exposed so FLIGHT_SCHEDULE.designation emits a navigation. Without the
     * target here CAP drops the association silently ("target is outside of
     * service") and the flight page's supplier block has nothing to bind to -
     * D47's first kind.
     */
    @readonly
    entity DesignatedSuppliers as projection on db.DESIGNATED_SUPPLIERS {
        *,
        station             : redirected to Airports,
        supplier            : redirected to Suppliers,
        supplier_contract   : redirected to Contracts,
        into_plane_agent    : redirected to Suppliers,
        into_plane_contract : redirected to Contracts
    };

    @readonly
    entity Manufacturers as projection on db.MANUFACTURE;

    @readonly
    entity Products as projection on db.MASTER_PRODUCTS {
        *,
        uom : redirected to UnitsOfMeasure
    };

    @readonly
    entity Contracts as projection on db.MASTER_CONTRACTS {
        *,
        supplier : redirected to Suppliers,
        currency : redirected to Currencies
    };

    @readonly
    entity PricingFormulas as projection on db.PRICING_FORMULAS;

    @readonly
    entity MarketIndices as projection on db.MARKET_INDICES;

    @readonly
    entity Suppliers as projection on db.MASTER_SUPPLIERS;

    @readonly
    entity Countries as projection on db.T005_COUNTRY;

    @readonly
    entity Currencies as projection on db.CURRENCY_MASTER;

    @readonly
    entity Plants as projection on db.T001W_PLANT;

    @readonly
    entity UnitsOfMeasure as projection on db.UNIT_OF_MEASURE;

    // ========================================================================
    // SERVICE-LEVEL FUNCTIONS
    // ========================================================================

    /**
     * Generate next version ID
     * Format: PV-{TYPE}-{FISCAL_YEAR}-{SEQ}
     */
    function generateVersionId(versionType: String, fiscalYear: String) returns String;

    /**
     * Get planning summary by fiscal year
     */
    function getPlanningOverview(fiscalYear: String) returns PlanningOverview;

    /**
     * Compare multiple scenarios
     * Returns variance analysis across versions
     */
    function compareScenarios(versionIds: array of UUID) returns MultiScenarioComparison;

    /**
     * Calculate demand for a single route/aircraft
     * Uses Route-Aircraft Matrix
     */
    function calculateRouteDemand(
        routeCode: String,
        aircraftType: String,
        flightCount: Integer,
        season: String
    ) returns RouteDemandResult;

    /**
     * Get price forecast for planning
     * Retrieves prices from Contracts/CPE module
     */
    function getPriceforecast(
        airportCode: String,
        productCode: String,
        fromDate: Date,
        toDate: Date
    ) returns array of PriceForecastResult;

    /**
     * Import flight schedule from Excel.
     * Auto-creates a Draft Fuel Order for each new flight schedule.
     *
     * Required columns: flight_number, flight_date, origin_airport, destination_airport
     * Optional columns: aircraft_type, aircraft_reg, departure_time, arrival_time,
     *                   airline_code, flight_suffix, service_type,
     *                   sobt, sibt, departure_terminal, arrival_terminal,
     *                   gate_number, stand_number, planned_block_mins,
     *                   flight_nature, linked_flight_number, codeshare_flights
     */
    action importFlightScheduleExcel(
        fileContent : LargeBinary,
        fileName    : String(255),
        // WP-07B. ACCEPT_PROVISIONAL or REJECT. Omitted, the constant default
        // applies; WP-13 replaces it with a resolved parameter.
        unknownTailPolicy : String(20)
    ) returns FlightExcelImportResult;

    /**
     * Enrich existing flight schedule records with tail numbers, aircraft types,
     * and operational data (Step 2 of 7-step journey: "Flight Enriched").
     *
     * Matches by flight_number + flight_date, then updates:
     *   aircraft_reg (tail number), aircraft_type, departure_terminal,
     *   arrival_terminal, gate_number, stand_number
     *
     * Required columns: flight_number, flight_date
     * Enrichment columns (at least one required): aircraft_reg, aircraft_type,
     *   departure_terminal, arrival_terminal, gate_number, stand_number
     */
    action enrichFlightScheduleExcel(
        fileContent : LargeBinary,
        fileName    : String(255)
    ) returns FlightEnrichmentResult;

    /**
     * Import SSIM flight schedule
     * Parses SSIM file and creates flight records
     */
    action importSSIMSchedule(
        fileContent: LargeBinary,
        fileName: String,
        effectiveFrom: Date,
        effectiveTo: Date
    ) returns SSIMImportResult;

    // ========================================================================
    // TYPE DEFINITIONS
    // ========================================================================

    type DemandCalculationSummary {
        success             : Boolean;
        versionId           : String(20);
        totalFlights        : Integer;
        totalRoutes         : Integer;
        totalDemandKg       : Decimal(18,2);
        calculationsCreated : Integer;
        calculationErrors   : Integer;
        message             : String(500);
    };

    type PricingApplicationResult {
        success             : Boolean;
        versionId           : String(20);
        linesUpdated        : Integer;
        totalCostProjected  : Decimal(18,2);
        currency            : String(3);
        priceSource         : String(20);
        message             : String(500);
    };

    type SACWritebackResult {
        success             : Boolean;
        versionId           : String(20);
        sacModelId          : String(100);
        recordsWritten      : Integer;
        writebackTimestamp  : Timestamp;
        status              : String(20);
        message             : String(500);
    };

    type PlanningOverview {
        fiscalYear          : String(4);
        totalVersions       : Integer;
        approvedVersions    : Integer;
        draftVersions       : Integer;
        totalPlannedVolume  : Decimal(18,2);
        totalPlannedCost    : Decimal(18,2);
        currency            : String(3);
        stationsCovered     : Integer;
        byVersionType       : array of VersionTypeSummary;
    };

    type VersionTypeSummary {
        versionType         : String(20);
        count               : Integer;
        totalVolume         : Decimal(18,2);
        totalCost           : Decimal(18,2);
    };

    type MultiScenarioComparison {
        success             : Boolean;
        versionsCompared    : Integer;
        baseVersionId       : String(20);
        variances           : array of ScenarioVariance;
        summary             : String(1000);
    };

    type ScenarioVariance {
        versionId           : String(20);
        versionName         : String(100);
        versionType         : String(20);
        totalVolume         : Decimal(18,2);
        totalCost           : Decimal(18,2);
        volumeVariance      : Decimal(18,2);
        volumeVariancePct   : Decimal(5,2);
        costVariance        : Decimal(18,2);
        costVariancePct     : Decimal(5,2);
    };

    type RouteDemandResult {
        success             : Boolean;
        routeCode           : String(20);
        aircraftType        : String(10);
        tripFuel            : Decimal(12,2);
        taxiFuel            : Decimal(10,2);
        contingencyFuel     : Decimal(10,2);
        alternateFuel       : Decimal(10,2);
        reserveFuel         : Decimal(10,2);
        totalPerFlight      : Decimal(12,2);
        flightCount         : Integer;
        seasonalFactor      : Decimal(5,4);
        totalDemand         : Decimal(15,2);
        uom                 : String(3);
    };

    type PriceForecastResult {
        period              : String(10);
        airportCode         : String(3);
        productCode         : String(20);
        unitPrice           : Decimal(15,4);
        currency            : String(3);
        priceSource         : String(20);
        baseIndexCode       : String(20);
        baseIndexValue      : Decimal(15,4);
        effectiveDate       : Date;
    };

    type SSIMImportResult {
        success             : Boolean;
        fileName            : String(255);
        recordsProcessed    : Integer;
        recordsImported     : Integer;
        recordsSkipped      : Integer;
        recordsFailed       : Integer;
        errors              : array of ImportError;
        message             : String(500);
    };

    type ImportError {
        lineNumber          : Integer;
        fieldName           : String(50);
        errorCode           : String(10);
        message             : String(500);
    };

    type ExportResult {
        success             : Boolean;
        fileName            : String(255);
        fileSize            : Integer;
        downloadUrl         : String(500);
        message             : String(500);
    };

    // ========================================================================
    // FLIGHT SCHEDULE IMPORT TYPES
    // ========================================================================

    type FlightExcelImportResult {
        success          : Boolean;
        fileName         : String(255);
        flightsProcessed : Integer;
        flightsCreated   : Integer;
        flightsUpdated   : Integer;
        flightsSkipped   : Integer;
        ordersCreated    : Integer;
        ordersFailed     : Integer;
        errors           : array of FlightImportError;
        message          : String(500);
    };

    type FlightImportError {
        row      : Integer;
        field    : String(50);
        message  : String(500);
        severity : String(10);  // ERROR / WARNING
    };

    type FlightEnrichmentResult {
        success           : Boolean;
        fileName          : String(255);
        flightsProcessed  : Integer;
        flightsEnriched   : Integer;
        flightsNotFound   : Integer;
        flightsSkipped    : Integer;
        errors            : array of FlightImportError;
        message           : String(500);
    };

    // ========================================================================
    // ERROR CODES (FDD-02)
    // ========================================================================
    // PLN401 - Version not found
    // PLN402 - Version status invalid for operation
    // PLN403 - Missing required flight schedule
    // PLN404 - Route-Aircraft Matrix not found
    // PLN405 - Price assumption missing for station/period
    // PLN410 - SSIM file parsing error
    // PLN411 - Invalid SSIM record format
    // PLN420 - SAC connection failed
    // PLN421 - SAC writeback failed
    // PLN422 - SAC model not configured
}

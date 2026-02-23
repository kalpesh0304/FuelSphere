/**
 * FuelSphere - Master Data Service (FDD-01)
 *
 * Exposes all 11 validated Master Data entities
 * Authorization per PERSONA_AUTHORIZATION_MATRIX
 */

using { fuelsphere as db } from '../db/schema';

@path: '/odata/v4/master'
service MasterDataService {

    // ========================================================================
    // REFERENCE DATA (S/4HANA Synchronized) - Read-only for most users
    // ========================================================================

    @readonly
    entity Countries as projection on db.T005_COUNTRY;

    @readonly
    entity Currencies as projection on db.CURRENCY_MASTER;

    @readonly
    entity UnitsOfMeasure as projection on db.UNIT_OF_MEASURE;

    @readonly
    entity Plants as projection on db.T001W_PLANT {
        *,
        land1 : redirected to Countries
    };

    // ========================================================================
    // FUELSPHERE NATIVE ENTITIES
    // ========================================================================

    /**
     * Manufacturers - Aircraft Manufacturer Master
     * Access: integration-admin (Edit), others (View)
     */
    @odata.draft.enabled
    entity Manufacturers as projection on db.MANUFACTURE {
        *,
        virtual null as activeCriticality : Integer
    };

    /**
     * Aircraft - Aircraft Type Master
     * Access: integration-admin (Edit), others (View)
     */
    @odata.draft.enabled
    entity Aircraft as projection on db.AIRCRAFT_MASTER {
        *,
        manufacturer : redirected to Manufacturers,
        registration_country : redirected to Countries,
        fleet : redirected to FleetRegistry,
        virtual null as activeCriticality : Integer
    };

    /**
     * FleetRegistry - Individual Aircraft Registrations
     * Managed as composition under Aircraft
     */
    entity FleetRegistry as projection on db.FLEET_REGISTRY {
        *,
        registration_country : redirected to Countries
    };

    /**
     * Airports - Airport Master
     * Access: integration-admin (Edit), ops-manager/fuel-planner (View)
     */
    @odata.draft.enabled
    entity Airports as projection on db.MASTER_AIRPORTS {
        *,
        country           : redirected to Countries,
        plant             : redirected to Plants,
        storage_locations : redirected to AirportStorageLocations,
        virtual null as activeCriticality : Integer
    };

    /**
     * AirportStorageLocations - Tanks/Hydrants per Airport
     * Composition child of Airports
     */
    entity AirportStorageLocations as projection on db.AIRPORT_STORAGE_LOCATIONS {
        *,
        airport : redirected to Airports,
        virtual null as activeCriticality : Integer
    };

    /**
     * Routes - Route Master
     * Access: fuel-planner (View), integration-admin (Edit)
     */
    @odata.draft.enabled
    entity Routes as projection on db.ROUTE_MASTER {
        *,
        origin          : redirected to Airports,
        destination     : redirected to Airports,
        aircraft_matrix : redirected to RouteAircraftMatrix,
        alternates      : redirected to RouteAlternates,
        virtual null as activeCriticality    : Integer,
        virtual null as aircraft_type_count  : Integer,  // Count of aircraft types on this route
        virtual null as fuel_req_count       : Integer,  // Count of fuel requirements defined
        virtual null as fuel_planning_status : String(10) // COMPLETE / PARTIAL / NONE
    };

    /**
     * RouteAircraftMatrix - Standard fuel consumption per route/aircraft
     * Composition child of Routes for Object Page inline table
     */
    entity RouteAircraftMatrix as projection on db.ROUTE_AIRCRAFT_MATRIX {
        *,
        route         : redirected to Routes,
        aircraft_type : redirected to Aircraft
    };

    /**
     * RouteAlternates - Alternate airports per route
     * Composition child of Routes for Object Page alternates section
     */
    entity RouteAlternates as projection on db.ROUTE_ALTERNATES {
        *,
        route   : redirected to Routes,
        airport : redirected to Airports
    };

    // ========================================================================
    // FLIGHT MASTER DATA
    // ========================================================================

    /**
     * FlightMasters - Flight Definitions with Validity Periods
     * Access: fuel-planner (Edit), ops-manager (View)
     */
    @odata.draft.enabled
    entity FlightMasters as projection on db.FLIGHT_MASTER {
        *,
        route       : redirected to Routes,
        aircraft    : redirected to Aircraft,
        origin      : redirected to Airports,
        destination : redirected to Airports,
        schedules   : redirected to FlightSchedules,
        virtual null as activeCriticality : Integer
    };

    /**
     * FlightSchedules - Per-date flight instances
     * Composition child of FlightMasters, also used by FuelOrderService
     */
    entity FlightSchedules as projection on db.FLIGHT_SCHEDULE {
        *,
        flight_master : redirected to FlightMasters,
        aircraft      : redirected to Aircraft,
        origin        : redirected to Airports,
        destination   : redirected to Airports
    };

    // ========================================================================
    // BIDIRECTIONAL ENTITIES (S/4HANA Integration)
    // ========================================================================

    /**
     * Suppliers - Supplier/Vendor Master
     * Access: contracts-manager (Edit), others (View)
     */
    @odata.draft.enabled
    entity Suppliers as projection on db.MASTER_SUPPLIERS {
        *,
        country : redirected to Countries,
        virtual null as activeCriticality : Integer
    };

    /**
     * Products - Fuel Product Master
     * Access: integration-admin (Edit), others (View)
     */
    @odata.draft.enabled
    entity Products as projection on db.MASTER_PRODUCTS {
        *,
        uom : redirected to UnitsOfMeasure,
        virtual null as activeCriticality : Integer
    };

    /**
     * Contracts - Purchase Contract Master
     * Access: contracts-manager (Full), finance (View)
     */
    @odata.draft.enabled
    entity Contracts as projection on db.MASTER_CONTRACTS {
        *,
        supplier : redirected to Suppliers,
        currency : redirected to Currencies,
        virtual null as activeCriticality : Integer
    };

    // ========================================================================
    // ACTIONS
    // ========================================================================

    /**
     * Sync master data from S/4HANA
     * Restricted to integration-admin
     */
    // @restrict in production - see PERSONA_AUTHORIZATION_MATRIX
    action syncFromS4HANA(entityType: String) returns SyncResult;

    type SyncResult {
        success     : Boolean;
        recordsSync : Integer;
        errors      : array of String;
        syncTime    : DateTime;
    }
}

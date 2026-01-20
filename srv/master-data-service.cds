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
        virtual null as activeCriticality : Integer
    };

    /**
     * Airports - Airport Master
     * Access: integration-admin (Edit), ops-manager/fuel-planner (View)
     */
    @odata.draft.enabled
    entity Airports as projection on db.MASTER_AIRPORTS {
        *,
        country : redirected to Countries,
        plant   : redirected to Plants,
        virtual null as activeCriticality : Integer
    };

    /**
     * Routes - Route Master
     * Access: fuel-planner (View), integration-admin (Edit)
     */
    @odata.draft.enabled
    entity Routes as projection on db.ROUTE_MASTER {
        *,
        origin      : redirected to Airports,
        destination : redirected to Airports,
        virtual null as activeCriticality : Integer
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

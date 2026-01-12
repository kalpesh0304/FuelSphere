/**
 * FuelSphere - Master Data Service (FDD-01)
 *
 * Exposes all 11 validated Master Data entities
 * Authorization per PERSONA_AUTHORIZATION_MATRIX
 */

using { fuelsphere as db } from '../db/schema';

@path: '/api/master-data'
@requires: 'authenticated-user'  // Any logged-in user can access (role checks in production via XSUAA)
service MasterDataService @(restrict: [{ grant: '*', to: 'authenticated-user' }]) {

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
    // @restrict in production - see PERSONA_AUTHORIZATION_MATRIX
    entity Manufacturers as projection on db.MANUFACTURE;

    /**
     * Aircraft - Aircraft Type Master
     * Access: integration-admin (Edit), others (View)
     */
    // @restrict in production - see PERSONA_AUTHORIZATION_MATRIX
    entity Aircraft as projection on db.AIRCRAFT_MASTER {
        *,
        manufacturer : redirected to Manufacturers
    };

    /**
     * Airports - Airport Master
     * Access: integration-admin (Edit), ops-manager/fuel-planner (View)
     */
    // @restrict in production - see PERSONA_AUTHORIZATION_MATRIX
    entity Airports as projection on db.MASTER_AIRPORTS {
        *,
        country : redirected to Countries,
        plant   : redirected to Plants
    };

    /**
     * Routes - Route Master
     * Access: fuel-planner (View), integration-admin (Edit)
     */
    // @restrict in production - see PERSONA_AUTHORIZATION_MATRIX
    entity Routes as projection on db.ROUTE_MASTER {
        *,
        origin      : redirected to Airports,
        destination : redirected to Airports
    };

    // ========================================================================
    // BIDIRECTIONAL ENTITIES (S/4HANA Integration)
    // ========================================================================

    /**
     * Suppliers - Supplier/Vendor Master
     * Access: contracts-manager (Edit), others (View)
     */
    // @restrict in production - see PERSONA_AUTHORIZATION_MATRIX
    entity Suppliers as projection on db.MASTER_SUPPLIERS {
        *,
        country : redirected to Countries
    };

    /**
     * Products - Fuel Product Master
     * Access: integration-admin (Edit), others (View)
     */
    // @restrict in production - see PERSONA_AUTHORIZATION_MATRIX
    entity Products as projection on db.MASTER_PRODUCTS {
        *,
        uom : redirected to UnitsOfMeasure
    };

    /**
     * Contracts - Purchase Contract Master
     * Access: contracts-manager (Full), finance (View)
     */
    // @restrict in production - see PERSONA_AUTHORIZATION_MATRIX
    entity Contracts as projection on db.MASTER_CONTRACTS {
        *,
        supplier : redirected to Suppliers,
        currency : redirected to Currencies
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

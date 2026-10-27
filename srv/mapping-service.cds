using { fuelsphere as db } from '../db/schema';
using { fuelsphere as map } from '../db/mapping-tables';
using from '../db/carrier-units';

/**
 * FuelSphere - S/4 mapping maintenance.
 *
 * Four master tables maintained by hand, read by the posting that turns a
 * fuel ticket into a purchase order, a goods receipt and an FI document.
 * Nothing here is derived from operations; every row is somebody's decision.
 *
 * DRAFT ENABLED, ALL FOUR. These are typed by people, a few fields at a time,
 * against value helps - the pattern every other maintenance screen in
 * FuelSphere uses. The validations in mapping-service.js fire on ACTIVATE, not
 * on every keystroke, so a half-filled draft is never rejected for being
 * half-filled.
 */
@path: '/odata/v4/mappings'
@impl: './mapping-service.js'
service MappingService {

    // =======================================================================
    // THE FOUR MAINTAINED TABLES
    // =======================================================================

    /**
     * Carrier codes and the company code each posts under.
     */
    @odata.draft.enabled
    entity Carriers as projection on map.CARRIER_MASTER;

    /**
     * Station to plant, per carrier, time dependent.
     *
     * The airport's name, city and country come through the association and
     * are shown read-only beside the code - the sheet calls them "auto picked
     * based on airport", and this is what that means in a model: not copied,
     * read.
     */
    @odata.draft.enabled
    entity StationPlantMappings as projection on map.STATION_PLANT_MAP {
        *,
        airport : redirected to Airports,
        carrier : redirected to Carriers,
        plant   : redirected to Plants
    };

    /**
     * Station to supplier, and the contract line to post it on.
     *
     * Several rows per station and carrier is normal - one per supplier.
     */
    @odata.draft.enabled
    entity StationSupplierMappings as projection on map.STATION_SUPPLIER_MAP {
        *,
        airport  : redirected to Airports,
        carrier  : redirected to Carriers,
        supplier : redirected to Suppliers,
        contract : redirected to Contracts,
        // REDIRECTED EXPLICITLY, like the four above. This service projects
        // MASTER_CONTRACTS twice (Contracts and SupplierContracts), so CAP
        // refuses to guess which one an association means - and an
        // unredirected association reaches an entity outside the service and
        // renders nothing at all.
        into_plane_agent    : redirected to Suppliers,
        into_plane_contract : redirected to Contracts
    };

    /**
     * A named flight fuelled by somebody other than the station's supplier.
     */
    @odata.draft.enabled
    entity FlightSupplierMappings as projection on map.FLIGHT_SUPPLIER_MAP {
        *,
        airport  : redirected to Airports,
        carrier  : redirected to Carriers,
        supplier : redirected to Suppliers,
        // Explicit, for the same reason as the station map above: two
        // projections of MASTER_CONTRACTS in this service means CAP will not
        // guess which one an association means.
        into_plane_agent    : redirected to Suppliers,
        into_plane_contract : redirected to Contracts
    };

    // =======================================================================
    // VALUE HELPS
    // =======================================================================
    //
    // Read-only, and deliberately plain: a value help that can be edited is a
    // second way to change master data.

    /**
     * EVERY airport, unfiltered. Asked for explicitly: mappings are master
     * data maintained before the schedule is loaded, so narrowing this to
     * airports that appear in FLIGHT_SCHEDULE would reject good rows.
     */
    @readonly
    entity Airports as projection on db.MASTER_AIRPORTS {
        key ID, iata_code, icao_code, airport_name, city, country_code, timezone, s4_plant_code
    };

    @readonly
    entity Plants as projection on db.T001W_PLANT { key werks, name1, ort01 };

    @readonly
    entity Suppliers as projection on db.MASTER_SUPPLIERS {
        key ID, supplier_code, supplier_name, supplier_type, s4_vendor_no, country_code
    };

    @readonly
    entity Contracts as projection on db.MASTER_CONTRACTS {
        key ID, contract_number, s4_contract_number, contract_type,
            supplier, currency_code, valid_from, valid_to
    };

    /**
     * WHO ALREADY HAS A CONTRACT AT A STATION, read from the contracts.
     *
     * The SUPPLIER field is filtered through this: only suppliers holding a
     * contract that covers the chosen station are offered. Across the current
     * data that narrows 21 suppliers to one or two per station.
     */
    @readonly
    entity ContractLines as projection on map.STATION_SUPPLIER_OPTIONS;

    /**
     * EVERY ACTIVE CONTRACT A SUPPLIER HOLDS - and this is the one that keeps
     * tomorrow's contract usable.
     *
     * The contract field is filtered by SUPPLIER, not by station. A contract
     * signed this morning has no CONTRACT_LOCATIONS rows yet, so a
     * station-filtered list would not show it and the mapping could not be
     * made at all - on tables the transactional apps are built on. Filtering
     * by supplier means a new contract is selectable the moment it exists.
     *
     * covers_station says whether that contract already lists the station, so
     * the person can see what they are choosing; it does not restrict the
     * list. The save-time check reads the same flag (CAR409).
     */
    @readonly
    entity SupplierContracts as projection on map.SUPPLIER_CONTRACT_OPTIONS;

    /**
     * WHO IS ALREADY MAPPED TO A STATION - what the flight app chooses from.
     *
     * The station-supplier mapping is the declaration; this is the reading of
     * it. A flight mapping names an exception to a station's arrangement, so
     * the only suppliers worth offering are the ones that station has.
     */
    @readonly
    entity StationSuppliers as projection on map.STATION_MAPPED_SUPPLIERS;

    // =======================================================================
    // WHAT THE POSTING ASKS
    // =======================================================================

    /**
     * Everything the S/4 documents need for one ticket, in one call.
     *
     * The backend call on ticket creation reads THIS rather than the four
     * tables, so the resolution order - flight mapping first, then the
     * station's - lives in one place and can be tested on its own. The S/4
     * field names are not known yet; this returns what the mappings hold, and
     * the caller maps it onto the API when the interface is published.
     *
     * Returns nulls rather than failing when a mapping is missing: the ticket
     * is already recorded by the time this is asked, and a missing mapping is
     * a thing to report, not a reason to lose the uplift.
     */
    function postingData(
        ticketID : UUID
    ) returns {
        ticket_number      : String(30);
        flight_number      : String(8);
        station_code       : String(3);
        posting_date       : Date;

        carrier_code       : String(3);
        carrier_name       : String(100);
        company_code       : String(4);

        plant_code         : String(4);
        plant_name         : String(30);

        supplier_ID        : UUID;
        supplier_name      : String(100);
        s4_vendor_no       : String(10);
        supplier_source    : String(10);   // FLIGHT | STATION | TICKET

        contract_number    : String(20);
        s4_contract_number : String(10);
        contract_line_item : String(5);

        quantity_kg        : Decimal(15,2);
        quantity           : Decimal(15,2);
        uom_code           : String(3);
        total_amount       : Decimal(15,2);
        currency_code      : String(3);

        // What is missing, in words, when something is. Empty means the
        // documents can be posted.
        gaps               : array of String;
    };
}

using { fuelsphere as db } from '../db/fifo-valuation';
using { fuelsphere as dfl } from '../db/defuel';

/**
 * FuelSphere - fuel stock valuation, FIFO beside moving average.
 *
 * READ-ONLY, AND DELIBERATELY SO. Every row is produced by the valuation
 * replay from movements that already exist; a row typed in here would be a
 * figure with no movement behind it, and the first question anybody asks of a
 * valuation is which movement produced it.
 *
 * ITS OWN SERVICE, NOT AN ADDITION TO BurnService. The FOB ledger is
 * demonstrated daily; a new entity in its service is a new line in its
 * metadata, a new annotation in its file and a new way for its deploy to fail.
 * Nothing in this file is reachable from that one.
 */
@path: '/odata/v4/valuation'
service ValuationService {

    /**
     * Every movement, as each method valued it. One row per movement per batch
     * touched - so a FIFO burn across three layers is three rows and the same
     * burn under MAP is one.
     */
    @readonly
    entity StockMovements as projection on db.FUEL_STOCK_MOVEMENT_LEDGER;

    /**
     * What is left on board. One row per open batch under FIFO; one row per
     * tail under MAP, because MAP has a single pool.
     */
    @readonly
    entity StockBalances as projection on db.FUEL_STOCK_BALANCE;

    /**
     * One burn, priced both ways. The two rows for a burn are the comparison
     * this whole service exists to show.
     */
    @readonly
    entity BurnValuations as projection on db.FUEL_BURN_HEADER;

    /**
     * The defuels that produced the DEFUEL rows above.
     *
     * READ-ONLY HERE, AND WRITEABLE IN THE DEFUELING APP. This is the same
     * document, shown beside the ledger rows it wrote so a reader asking
     * "where did that movement come from" does not have to leave the screen.
     * Recording and correcting a defuel stays in the app that owns it.
     *
     * IMPORTANT COLUMNS ONLY, per the 26 Oct instruction. The full document
     * has thirty-odd fields; this view carries what identifies the movement
     * and what it was worth.
     */
    @readonly
    entity Defuels as projection on dfl.DEFUEL {
        ID, defuel_id, defuel_type, source_mode, status,
        tail_number, carrier_code, flight_number, flight_date,
        station_code, defuel_date, defuel_time,
        location_code, quantity_kg, specific_gravity, fuel_value_usd,
        defuel_charges_usd, taxes_usd
    };
}

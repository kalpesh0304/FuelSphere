using { fuelsphere as db } from '../db/fifo-valuation';

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
}

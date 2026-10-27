namespace fuelsphere;

using { fuelsphere as db } from './schema';
using { cuid } from '@sap/cds/common';

/**
 * FuelSphere - FIFO and moving-average valuation, side by side.
 *
 * WHY THESE ARE NEW TABLES AND NOT A CHANGE TO ROB_LEDGER. The FOB ledger is
 * demonstrated daily and its arithmetic is settled; valuation is a second
 * question asked of the same movements, and asking it must not put the first
 * at risk. Nothing here has a foreign key into ROB_LEDGER. Both read the SAME
 * sources - FUEL_TICKETS, FUEL_BURNS, APU_USAGE - so the two can be set
 * against each other on identical facts, which is the only honest comparison.
 *
 * THE TWO METHODS DIFFER IN GRAIN, and that is the whole design:
 *
 *   FIFO  one movement becomes SEVERAL ledger rows, one per batch it draws
 *         from. A 1,100 kg burn against layers of 1,000 and 1,000 is two
 *         rows: 1,000 at the first price, 100 at the second.
 *
 *   MAP   one movement is one row, valued at the average prevailing when it
 *         happened.
 *
 * So FIFO has no single running balance to put on a movement - it has layers,
 * and they live in FUEL_STOCK_BALANCE. MAP has no batch - its layer is the
 * whole tank. Each method leaves the other's columns empty, and that emptiness
 * is meaningful rather than missing.
 *
 * BOTH CONSERVE. Across a tail, burn value plus closing inventory equals total
 * uplift value under either method. They disagree about WHEN cost is
 * recognised, never about how much there is. The worked example (23 Sep 2026,
 * N3023J): FIFO charges 17,700 and leaves 1,800; MAP charges 17,940 and leaves
 * 1,560; both total 19,500.
 */

/**
 * Which method produced a row. Every table carries it, because both methods
 * live in one table and a query that forgets to filter would add FIFO to MAP
 * and get a number that means nothing.
 */
type ValuationMethod : String(4) enum {
    Fifo = 'FIFO';
    Map  = 'MAP';
}

/**
 * What the movement was.
 *
 * THE THREE FROM THE SHEET PLUS THE FOUR IT DID NOT REACH. Uplift, block burn
 * and APU burn are the worked example; the rest exist because the FOB ledger
 * already records them and a valuation that cannot represent them would have
 * to refuse rows it will certainly meet.
 *
 * DEFUEL IS THE AWKWARD ONE and it is named rather than hidden. Fuel taken off
 * an aircraft under FIFO has to go somewhere, and the honest answer is a NEW
 * batch at the price it was carried out at - putting it back into the layer it
 * came from would require knowing which layer that was, which nothing records.
 */
type ValuationLineType : String(12) enum {
    Initial    = 'INITIAL';      // Opening stock, priced at its stated rate
    Uplift     = 'UPLIFT';       // Fuel in, from a ticket. Opens a batch under FIFO
    BlockBurn  = 'BLOCK_BURN';   // Fuel out, chocks to chocks
    ApuBurn    = 'APU_BURN';     // Fuel out, APU on stand. Additional to block burn
    Transfer   = 'TRANSFER';     // Between tails. Out of one, in to the other
    Adjustment = 'ADJUSTMENT';   // A correction to a recorded movement
    Defuel     = 'DEFUEL';       // Fuel off the aircraft. Opens a batch under FIFO
}

// ===========================================================================
// FUEL_STOCK_MOVEMENT_LEDGER - every movement, as each method values it
// ===========================================================================
//
// One row per movement PER BATCH TOUCHED. Under MAP that is one row per
// movement; under FIFO a burn spanning three layers is three rows, each
// naming the batch it consumed and the price that batch was bought at.
//
// qty_kg IS SIGNED: positive in, negative out. The sheet's burn rows carry
// negative quantities and negative values, and that convention is kept here so
// a sum down the column is the net movement rather than a figure that needs a
// case statement to read.
entity FUEL_STOCK_MOVEMENT_LEDGER : cuid, db.AuditTrail {
        valuation_method   : ValuationMethod @mandatory;

        // NOT MANDATORY ANY MORE, and the reason is a defuel. Fuel taken off
        // an aircraft and put into a storage location is still the airline's
        // fuel and still has to be valued, but it is on no tail while it sits
        // there. The inbound half of a defuel therefore carries a storage
        // location and no tail, exactly as the outbound half carries a tail
        // and no storage location. Every seeded row still names its tail.
        tail_number        : String(10);


        // ---- WHOSE FLEET THIS IS - added 7 Oct 2026 ---------------------
        //
        // STORED, NOT AN ASSOCIATION, and that is deliberate. These three
        // tables declare no association to anything - fifo-valuation-harness
        // EXIT-6 asserts it, because that isolation is what made it safe to
        // build this beside the FOB ledger. A carrier association would be
        // the first thread back into the rest of the schema.
        //
        // THE IATA CODE, NOT THE OPERATOR CODE ON THE TAIL MASTER.
        // AIRCRAFT_REGISTRATIONS.operator_code covers all 274 tails and mixes
        // the two standards - JBU for JetBlue, and AC and ACA both for Air
        // Canada. Every other FuelSphere screen filters on the IATA code
        // (CARRIER_MASTER.carrier_code, FLIGHT_SCHEDULE.airline_code), so a
        // column reading JBU here would not match a filter typed anywhere
        // else, and one airline would appear under two codes. The seeder
        // takes FLIGHT_SCHEDULE.airline_code per tail instead.
        //
        // PER TAIL, uniformly across its rows. A FIFO replay belongs to one
        // tail, so a tail whose movements carried two carrier codes would
        // have its layers filtered away from the burns that consumed them.
        carrier_code       : String(3);

        // THE BATCH THIS ROW DRAWS FROM OR CREATES. The uplift's own reference
        // under FIFO; NULL under MAP, which has no layers. On a FIFO burn row
        // it names the batch being consumed, never the burn - the burn is in
        // `reference` below.
        batch_ref          : String(40);

        flight_number      : String(10);
        flight_date        : Date;

        // OFF-BLOCK TIME, AND FIFO CANNOT BE BUILT WITHOUT IT. First-in-first-
        // out is an ordering rule, and a flight date alone cannot order two
        // uplifts on one day. This is what the replay sorts on, exactly as the
        // FOB ledger does.
        flight_aobt        : Timestamp;

        // Where it happened. The leg's ORIGIN - the airport that fuelled it -
        // the same rule the FOB ledger follows.
        station            : String(3);

        // WHERE THE FUEL IS NOW, when it is not on an aircraft. Set only on
        // the inbound half of a defuel - the row that puts fuel into a tank
        // on the ground - and null on every other row, including the outbound
        // half that took it off the wing.
        //
        // A STRING, NOT AN ASSOCIATION. fifo-valuation EXIT-6 asserts that
        // these tables declare no association into the rest of the schema,
        // because that isolation is what made the valuation safe to build
        // beside the FOB ledger. carrier_code and station are denormalised
        // for the same reason; this follows them.
        storage_location   : String(20);

        // WHAT CAUSED THE ROW: the ticket number on an uplift, the burn id on
        // a burn. Distinct from batch_ref, which says what the row was valued
        // against.
        reference          : String(40) @mandatory;
        line_type          : ValuationLineType @mandatory;

        // ---- QUANTITY IN BOTH UNITS ------------------------------------
        //
        // Kilograms are what the valuation runs on: a rate is per kg and mass
        // is conserved where volume is not. Litres are carried beside them
        // because tickets, meters and invoices are in litres, and a reader
        // checking this against a ticket should not have to convert.
        qty_kg             : Decimal(15,3);
        qty_l              : Decimal(15,2);
        specific_gravity   : Decimal(8,4);   // The density the litres were taken at

        rate_usd_per_kg    : Decimal(15,6);
        value_usd          : Decimal(15,2);

        // ---- MAP ONLY ---------------------------------------------------
        // The running balance after this row, and the average it implies.
        // Empty on a FIFO row: FIFO's balance is its open layers, which are in
        // FUEL_STOCK_BALANCE, and a single average would be the very figure
        // FIFO exists to avoid.
        balance_qty_kg     : Decimal(15,3);
        balance_value_usd  : Decimal(15,2);
        map_usd_per_kg     : Decimal(15,6);

        // Replay order within one tail, so two movements at one instant still
        // have a defined sequence.
        line_order         : Integer;
        sequence           : Integer;
}

// ===========================================================================
// FUEL_STOCK_BALANCE - what is still on board, and at what price
// ===========================================================================
//
// FIFO: one row per OPEN BATCH, carrying what is left of it. A batch fully
// consumed keeps its row with balance_qty_kg = 0, because "this batch is
// exhausted" is a fact somebody will look for, and a deleted row cannot say it.
//
// MAP: ONE row per tail, batch_ref null. There is one pool and one price.
entity FUEL_STOCK_BALANCE : cuid, db.AuditTrail {
        valuation_method   : ValuationMethod @mandatory;

        // OPTIONAL, for the same reason it is optional on the movement
        // ledger: a storage location holds a balance and is not a tail. One
        // of tail_number and storage_location is set on every row.
        tail_number        : String(10);
        batch_ref          : String(40);      // null under MAP

        // THE TANK ON THE GROUND that holds this balance, when no aircraft
        // does. The fuel keeps the batch it arrived on, so a storage balance
        // still names batch_ref and still carries that batch's rate - which
        // is what lets it be re-uplifted later at the price it was bought at
        // rather than at whatever the pool averages to that week.
        storage_location   : String(20);
        // ---- WHOSE FLEET THIS IS - added 7 Oct 2026 ---------------------
        //
        // STORED, NOT AN ASSOCIATION, and that is deliberate. These three
        // tables declare no association to anything - fifo-valuation-harness
        // EXIT-6 asserts it, because that isolation is what made it safe to
        // build this beside the FOB ledger. A carrier association would be
        // the first thread back into the rest of the schema.
        //
        // THE IATA CODE, NOT THE OPERATOR CODE ON THE TAIL MASTER.
        // AIRCRAFT_REGISTRATIONS.operator_code covers all 274 tails and mixes
        // the two standards - JBU for JetBlue, and AC and ACA both for Air
        // Canada. Every other FuelSphere screen filters on the IATA code
        // (CARRIER_MASTER.carrier_code, FLIGHT_SCHEDULE.airline_code), so a
        // column reading JBU here would not match a filter typed anywhere
        // else, and one airline would appear under two codes. The seeder
        // takes FLIGHT_SCHEDULE.airline_code per tail instead.
        //
        // PER TAIL, uniformly across its rows. A FIFO replay belongs to one
        // tail, so a tail whose movements carried two carrier codes would
        // have its layers filtered away from the burns that consumed them.
        carrier_code       : String(3);


        // WHAT OPENED THE LAYER - an uplift, the opening balance, a defuel.
        //
        // It is here so ONE FILTER BAR can serve all three screens: a List
        // Report with views over different entity sets applies its filters to
        // each of them, so a field missing from one entity is a field no
        // screen can offer. The five others it filters on were already common
        // to all three; this was the gap.
        //
        // NULL UNDER MAP, like batch_ref above: MAP's single row is the whole
        // pool, accumulated from every movement, and no one line type opened
        // it. A reader filtering for layers opened by uplifts is asking a
        // question MAP has no answer to, and an empty cell says exactly that.
        line_type          : ValuationLineType;

        // Where and when the batch was opened - so a layer can be traced to
        // the uplift that created it without joining back to the ledger.
        station            : String(3);
        flight_number      : String(10);
        flight_date        : Date;
        flight_aobt        : Timestamp;

        uplift_qty_kg      : Decimal(15,3);   // What went in
        uplift_qty_l       : Decimal(15,2);
        balance_qty_kg     : Decimal(15,3);   // What is left of it
        balance_qty_l      : Decimal(15,2);
        specific_gravity   : Decimal(8,4);

        rate_usd_per_kg    : Decimal(15,6);
        value_usd          : Decimal(15,2);   // balance_qty_kg x rate
}

// ===========================================================================
// FUEL_BURN_HEADER - one burn, as each method priced it
// ===========================================================================
//
// The roll-up of the ledger rows a burn produced: under FIFO the sum of the
// layers it ate through, under MAP the single row. Same burn, two prices, and
// setting them side by side is the point of the whole exercise.
//
// THE RATE IS DERIVED, NEVER ENTERED. Under FIFO it is value / quantity across
// the consumed layers, so it lands between the prices of the batches touched
// and belongs to no single one. Under MAP it is the average that prevailed.
entity FUEL_BURN_HEADER : cuid, db.AuditTrail {
        valuation_method   : ValuationMethod @mandatory;
        tail_number        : String(10) @mandatory;
        flight_number      : String(10);
        flight_date        : Date;
        flight_aobt        : Timestamp;
        station            : String(3);
        // ---- WHOSE FLEET THIS IS - added 7 Oct 2026 ---------------------
        //
        // STORED, NOT AN ASSOCIATION, and that is deliberate. These three
        // tables declare no association to anything - fifo-valuation-harness
        // EXIT-6 asserts it, because that isolation is what made it safe to
        // build this beside the FOB ledger. A carrier association would be
        // the first thread back into the rest of the schema.
        //
        // THE IATA CODE, NOT THE OPERATOR CODE ON THE TAIL MASTER.
        // AIRCRAFT_REGISTRATIONS.operator_code covers all 274 tails and mixes
        // the two standards - JBU for JetBlue, and AC and ACA both for Air
        // Canada. Every other FuelSphere screen filters on the IATA code
        // (CARRIER_MASTER.carrier_code, FLIGHT_SCHEDULE.airline_code), so a
        // column reading JBU here would not match a filter typed anywhere
        // else, and one airline would appear under two codes. The seeder
        // takes FLIGHT_SCHEDULE.airline_code per tail instead.
        //
        // PER TAIL, uniformly across its rows. A FIFO replay belongs to one
        // tail, so a tail whose movements carried two carrier codes would
        // have its layers filtered away from the burns that consumed them.
        carrier_code       : String(3);


        line_type          : ValuationLineType @mandatory;   // BLOCK_BURN or APU_BURN
        burn_ref           : String(40) @mandatory;          // The burn this prices

        burn_qty_kg        : Decimal(15,3);
        burn_qty_l         : Decimal(15,2);
        burn_rate_usd_per_kg : Decimal(15,6);
        burn_value_usd     : Decimal(15,2);

        // HOW MANY LAYERS IT TOOK. 1 under MAP always; under FIFO it is how
        // many batches the burn spanned, which is the quickest read of whether
        // a burn crossed a price change.
        layers_consumed    : Integer;

        // WHICH QUANTITY WAS VALUED, recorded on the row rather than assumed.
        //
        // FUEL_BURNS carries actual_burn_kg as REPORTED - by ACARS, by a
        // submission or by an Excel import - and nothing in the system derives
        // it from the flight's gauges. The Fuel Overview Report shows FOB out
        // less FOB in instead and falls back to the reported figure only where
        // a gauge is missing, so the two can differ on the same leg.
        //
        // This valuation follows the REPORTED figure, because it must consume
        // the same stock the movements recorded: layers built on one quantity
        // and drawn down by another drift apart with every flight.
        qty_basis          : String(20);   // REPORTED_BURN | GAUGE_DELTA | APU_CYCLES
}

/**
 * FuelSphere — DESIGNATED_SUPPLIERS (work package D)
 *
 * WHO FUELS THIS FLIGHT, AT THIS STATION, ON THIS DATE.
 *
 * In its own file rather than appended to schema.cds at 5,462 lines. CAP loads
 * every file under db/ and merges them, so this is a layout choice and not a
 * modelling one.
 *
 * ---------------------------------------------------------------------------
 * THE CASCADE, AND THE THIRD RUNG IS THE ONE THAT MATTERS
 *
 *   1  flight + date        the primary axis
 *   2  else station + date  the fallback
 *   3  else NOTHING         the order is created with an EMPTY supplier
 *
 * Rung 3 is not a refusal and it is not a fallback to "any contract at that
 * station". Picking one arbitrarily is the join that over-matches, and this
 * repository has been bitten by that shape three times — the tail+date order
 * join that matched five of thirteen pairs, the dispatch import's Map keyed on
 * flight_ID keeping whichever order came last, and the survey that answered
 * "three suppliers trade at YYZ" when the contracts say one.
 *
 * So an undesignated station RESOLVES TO NOTHING, a person fills the supplier
 * in, and the absence is visible rather than papered over. That is why the
 * resolver reports a miss instead of throwing: refusing is right for a tail
 * with no performance row and wrong for a station nobody has designated yet.
 *
 * ---------------------------------------------------------------------------
 * TWO CONTRACTS, BECAUSE THERE ARE TWO RELATIONSHIPS
 *
 * The fuel is bought under one agreement; putting it in the wing is bought
 * under another. The HLD's ZFUEL_ITP and ZFUEL_FEE are exactly this split.
 *
 * supplier_performs_uplift decides which applies:
 *
 *   TRUE   the supplier fuels its own product. The agent fields stay empty
 *          and the fee sits inside the fuel contract
 *   FALSE  an into-plane agent fuels it, under its own contract, and the
 *          uplift contact belongs to the agent while invoicing and disputes
 *          stay with the supplier
 *
 * ---------------------------------------------------------------------------
 * RESOLVED, NEVER COPIED. Nothing here is denormalised onto a flight or an
 * order. A supplier changes a number and every flight shows the new one; a
 * copy shows the old one forever and nothing says which is current.
 */
namespace fuelsphere;

using { cuid } from '@sap/cds/common';
using { fuelsphere as db } from './schema';

/**
 * PRIMARY is the designation. ALTERNATE and EMERGENCY exist so a station can
 * record its second and third call without either competing with the first —
 * the resolver returns PRIMARY unless asked otherwise.
 */
@assert.range: true
type DesignationType : String(20) enum {
    Primary     = 'PRIMARY';
    Alternate   = 'ALTERNATE';
    Emergency   = 'EMERGENCY';
}

entity DESIGNATED_SUPPLIERS : cuid, db.AuditTrail {

    // ---- WHAT IT IS DESIGNATED FOR -------------------------------------
    //
    // FLIGHT IS THE PRIMARY AXIS AND STATION IS THE FALLBACK, so both are
    // nullable and neither is a key. A row naming a flight_number and no
    // station designates that flight everywhere it operates; a row naming a
    // station and no flight_number is that station's default.
    //
    // flight_number, NOT a flight association: a flight number is not an
    // entity in this model. FLIGHT_SCHEDULE is per flight-DATE, so pointing
    // at it would tie a designation to one occurrence and make this
    // per-occurrence data rather than master data.
    flight_number       : String(8);

    // NAMING FOLLOWS FLIGHT_SCHEDULE's origin / origin_airport, which is the
    // established convention here: the CODE is the column and the association
    // is unmanaged over it. A managed association would make station_ID a
    // UUID, so every seed row would carry an airport's generated key instead
    // of 'YYZ' - unreadable in a CSV and unusable as a resolver scope field.
    station             : Association to db.MASTER_AIRPORTS on station.iata_code = station_code;
    station_code        : String(3);
    // F40: a group operating two carrier codes has two sets of books, so the
    // same flight number can resolve differently per carrier.
    //
    // SCOPING BY CARRIER IS UNEXERCISED BY DATA. The seed holds one carrier,
    // and seeding a second is not one row - it needs flights, tails, contracts
    // and a company code, and FuelSphere has no carrier entity to hang them
    // on. So this is a scope field that costs nothing and has never been
    // tested; the first multi-carrier tenant is its first test. Said here and
    // asserted in the harness, because an untested path that SAYS SO is a
    // different thing from one that looks tested.
    carrier_code        : String(3);

    // NO `product` COLUMN, AND IT WAS CONSIDERED.
    //
    // The 1 September brief lists product as an axis. There are three products
    // in the model, every order uses one, and nothing would read the column -
    // which is the state this repository has caught four times.
    //
    // And it would not be free. A null product would be indistinguishable from
    // "any product" and from "nobody filled it in" - the same ambiguity
    // supplier_performs_uplift exists below to resolve.
    //
    // Add it when SAF arrives. That is when a station genuinely designates one
    // supplier for Jet A-1 and another for a blend, and the axis becomes real.

    // ---- WHO ------------------------------------------------------------
    supplier            : Association to db.MASTER_SUPPLIERS @mandatory;
    supplier_contract   : Association to db.MASTER_CONTRACTS;

    // TRUE means the supplier puts its own fuel in the wing and the two
    // fields below stay empty. It is not a display flag — it decides whether
    // into_plane_agent is required at all.
    supplier_performs_uplift : Boolean default false;
    into_plane_agent    : Association to db.MASTER_SUPPLIERS;
    into_plane_contract : Association to db.MASTER_CONTRACTS;

    // ---- WHEN, AND WHICH ROW WINS ---------------------------------------
    //
    // Read by resolveEffective(), which is inScope() from parameter-store
    // pointed at this entity. Open-ended valid_to is the common case;
    // overlapping rows resolve by priority; specificity — a row naming both
    // flight and station over one naming only a station — is consulted first.
    designation_type    : DesignationType default 'PRIMARY';
    valid_from          : Date;
    valid_to            : Date;                       // null = open-ended
    priority            : Integer default 100;        // lower wins
    is_active           : Boolean default true;

    notes               : String(500);
}

// ============================================================================
// THE FLIGHT RESOLVES ITS DESIGNATION. IT DOES NOT COPY IT.
//
// A supplier changes a number and every flight shows the new one. A
// denormalised copy shows the old one forever and nothing says which is
// current - so this is an association, and FLIGHT_SCHEDULE gains no supplier
// column. d-designated-suppliers-harness EXIT-9 asserts that.
//
// IT LIVES HERE AND NOT IN schema.cds, and not by preference. schema.cds
// cannot see DESIGNATED_SUPPLIERS: this file imports schema.cds, so the
// dependency runs one way and the base file has no name for the new entity.
// `extend` from this side is the only direction that compiles.
//
// AND IT CARRIES THE FLIGHT AXIS ONLY. An `on` condition is a join, and a
// join cannot say "the flight row, ELSE the station row" - the cascade is
// query order, which is exactly why designation-resolver.js is JavaScript.
// So this resolves 1 of 22 seeded flights, and the other 21 fall to the
// station rung, which needs its own association or the resolver.
//
// The date is deliberately NOT in the condition either. Adding
// `valid_from <= flight_date` narrows a row set; it does not pick one, and a
// screen binding to several rows would show a designation that expired
// beside one that did not.
// ============================================================================
extend db.FLIGHT_SCHEDULE with {

    // "Designated for AC410" — an arrangement made for THIS flight.
    designation : Association to many DESIGNATED_SUPPLIERS
                  on  designation.flight_number = flight_number
                  and designation.station_code  = origin_airport;

    // "YYZ default" — what this station does for anything without one.
    //
    // A SECOND ASSOCIATION RATHER THAN A CASCADE, AND IT MAKES A BETTER
    // SCREEN THAN THE SPEC ASKED FOR. Someone will later see two blocks where
    // the design said one and assume it was a workaround for the join. It is
    // not.
    //
    // A station default means THIS FLIGHT HAS NO SPECIFIC ARRANGEMENT, and a
    // planner needs to know that. A cascade would have shown one supplier and
    // said nothing about which axis answered - the information would have
    // been resolved away.
    //
    // flight_number = null is what makes it the station's row and not another
    // flight's. Without it a designation for a DIFFERENT flight that names
    // this station would answer here, which is the over-matching join one
    // rung below where designation-resolver.js guards against it.
    station_default : Association to many DESIGNATED_SUPPLIERS
                      on  station_default.station_code   = origin_airport
                      and station_default.flight_number is null;
}


/**
 * FLIGHT_DESIGNATION - the designations that APPLY to a flight, both axes.
 *
 * WHY THE CARD CANNOT BIND DESIGNATED_SUPPLIERS DIRECTLY. A card filtered by
 * flight_number sees only flight-scoped rows, and MEASURED AGAINST THE SEED
 * only TWO OF TWENTY-TWO flights have one - AC410 and AC102. The other twenty
 * resolve to a station default, whose flight_number is null and which the
 * filter therefore excludes. The card would render empty on twenty flights
 * with nothing to say why: the eighth cause of an empty section.
 *
 * WHAT THIS ENUMERATES, AND WHAT IT DELIBERATELY DOES NOT DECIDE.
 *
 * It selects the designations whose SCOPE and DATE WINDOW admit this flight,
 * and carries `axis` so a reader can see which is the flight-level row and
 * which is the station default. That matches the decision already taken in
 * package D: where a flight-level designation exists, the station block still
 * shows, labelled rather than hidden.
 *
 * IT DOES NOT PICK A WINNER. Specificity-before-priority is the tie-break and
 * it lives in ONE place - srv/lib/designation-resolver.js, over
 * parameter-store's resolveEffective. Reimplementing that ordering in SQL
 * would be D44 exactly: a second independent implementation of one rule,
 * which nobody would notice disagreeing until it did.
 *
 * The date window IS reproduced here, and that is a filter rather than a
 * tie-break: a row outside its validity does not APPLY, so showing it would
 * be wrong on a card as well as in the resolver.
 */
entity FLIGHT_DESIGNATION as select from db.FLIGHT_SCHEDULE as f
    join DESIGNATED_SUPPLIERS as d
      on  d.station_code = f.origin_airport
      and ( d.flight_number = f.flight_number or d.flight_number is null )
      and ( d.valid_from is null or d.valid_from <= f.flight_date )
      and ( d.valid_to   is null or d.valid_to   >= f.flight_date )
{
    key f.ID              as flight_ID,
    key d.ID              as designation_ID,

        // The global filter's names.
        f.flight_number,
        f.flight_date,
        f.origin_airport,
        f.destination_airport,
        f.airline_code,

        // WHICH AXIS ANSWERED. The whole reason both rows are shown.
        case when d.flight_number is null then 'STATION' else 'FLIGHT' end
                          as axis : String(8),

        // AN EXPLICIT READING ORDER, NOT THE ALPHABET.
        //
        // 'FLIGHT' < 'STATION' is true and sorting on `axis` would work
        // today - by alphabetical accident, and silently wrong the day a
        // third axis is added. That is the recorded trap, and naming it in a
        // comment while relying on it anyway is not answering it.
        //
        // FLIGHT first because it is the axis that GOVERNS where both exist.
        case when d.flight_number is null then 2 else 1 end
                          as axis_rank : Integer,

        d.station_code,
        d.carrier_code,
        d.designation_type,
        d.priority,
        d.valid_from,
        d.valid_to,
        d.supplier,
        d.into_plane_agent,

        // CARRIED SO THE CONTACT STRIP CAN DERIVE, NOT STORE. Where the
        // supplier does not perform its own uplift, invoicing and disputes
        // stay with the SUPPLIER - so the agent's invoicing row is NOT
        // APPLICABLE rather than missing, and this flag is what says so.
        // A stored marker would be a second place holding one fact.
        d.supplier_performs_uplift
};

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

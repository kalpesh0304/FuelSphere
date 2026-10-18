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
// THE MAPS ARE NOW THE SOURCE of this file's flight view - see
// FLIGHT_DESIGNATION below, which stopped reading DESIGNATED_SUPPLIERS on
// 7 Oct 2026.
using { fuelsphere.STATION_SUPPLIER_MAP, fuelsphere.FLIGHT_SUPPLIER_MAP } from './mapping-tables';

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

// ===========================================================================
// DESIGNATION_FROM_MAPS - the flight page's two blocks, read off the maps
// ===========================================================================
//
// WHY THIS EXISTS, 7 Oct 2026. The flight page's supplier determination shows
// two blocks through FLIGHT_SCHEDULE.designation and .station_default, and
// both pointed at DESIGNATED_SUPPLIERS - the table superseded on 4 Oct. So the
// three into-plane cases, which are recorded on the MAPS, could not reach the
// screen that matters most: a planner edited a mapping and the flight page
// went on showing the old arrangement, with case 3 not expressible at all.
//
// THE COLUMN NAMES ARE THE LEGACY TABLE'S, deliberately and exactly. The two
// qualified line items in planning-fiori-annotations.cds (#FlightBlock and
// #StationBlock) bind these names, and a column renamed here is a blank
// column on the flight page. Three are ADDED - self_fuelled, into_plane_mode
// and into_plane_agent_name - all of them calculated on the maps.
//
// THE STATION ARM CARRIES flight_number AS NULL, which is what makes
// station_default's `flight_number is null` condition select it and keeps the
// two blocks apart. That is the legacy semantics, preserved.
//
// designation_type and priority are CONSTANTS here. The maps hold neither,
// because the tie-break they existed for lives in
// srv/lib/designation-resolver.js - these two are carried so the annotations
// that bind them still have something to read.
entity DESIGNATION_FROM_MAPS as

    // ---- the flight axis: an arrangement made for THIS flight ------------
    select from FLIGHT_SUPPLIER_MAP as m
        join db.MASTER_AIRPORTS as ap on ap.ID = m.airport.ID
    {
        key m.ID                   as ID,
            m.flight_number        as flight_number : String(8),
            ap.iata_code           as station_code : String(3),
            m.carrier.carrier_code as carrier_code : String(3),
            m.supplier,
            // The flight map holds no fuel contract of its own - a
            // flight-level row overrides WHO fuels, not what the fuel is
            // bought on, which stays the station's contract.
            null                   as supplier_contract_ID : UUID,
            // The flight map holds no contract, so no line item either. The
            // posting resolves both from the STATION row for that supplier -
            // a flight-level row overrides WHO fuels, not what it is bought
            // on. See srv/lib/s4-fuel-posting.js.
            null                   as contract_line_item : String(5),
            m.supplier_performs_uplift,
            m.into_plane_agent,
            m.into_plane_contract,
            'PRIMARY'              as designation_type : String(20),
            m.valid_from,
            m.valid_to,
            100                    as priority : Integer,
            m.is_active,
            m.notes,
            m.self_fuelled,
            m.into_plane_mode,
            m.into_plane_agent_name,
            m.created_at, m.created_by, m.modified_at, m.modified_by
    }

union all

    // ---- the station axis: what the station does otherwise ---------------
    //
    // is_default only. The station map holds several suppliers per station -
    // that is coverage - and the block answers "what does this station do",
    // which has one answer.
    select from STATION_SUPPLIER_MAP as m
        join db.MASTER_AIRPORTS as ap on ap.ID = m.airport.ID
    {
        key m.ID                   as ID,
            // NULL, so station_default selects this arm and designation does
            // not. Not an omission - it is the discriminator.
            null                   as flight_number : String(8),
            ap.iata_code           as station_code : String(3),
            m.carrier.carrier_code as carrier_code : String(3),
            m.supplier,
            m.contract.ID          as supplier_contract_ID : UUID,
            // CARRIED FOR THE POSTING. S/4 accepts a ContractItem beside the
            // contract, and the station map is where the line item is
            // maintained - functional named it explicitly as part of the
            // station-to-vendor mapping.
            m.contract_line_item,
            m.supplier_performs_uplift,
            m.into_plane_agent,
            m.into_plane_contract,
            'PRIMARY'              as designation_type : String(20),
            m.valid_from,
            m.valid_to,
            100                    as priority : Integer,
            m.is_active,
            m.notes,
            m.self_fuelled,
            m.into_plane_mode,
            m.into_plane_agent_name,
            m.created_at, m.created_by, m.modified_at, m.modified_by
    }
    where m.is_default = true;

extend db.FLIGHT_SCHEDULE with {

    // "Designated for AC410" — an arrangement made for THIS flight.
    // REPOINTED AT THE MAPS, 7 Oct 2026 - see DESIGNATION_FROM_MAPS above.
    //
    // AND THE CARRIER IS NOW IN THE CONDITION. It never was, on either
    // association: they matched on flight number and station alone, so a
    // station's default could answer for a DIFFERENT carrier's flight. The
    // same defect was found and fixed in FLIGHT_DESIGNATION on the same day,
    // where it was showing 14 Air Canada flights JetBlue's arrangement.
    designation : Association to many DESIGNATION_FROM_MAPS
                  on  designation.flight_number = flight_number
                  and designation.station_code  = origin_airport
                  and designation.carrier_code  = airline_code;

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
    station_default : Association to many DESIGNATION_FROM_MAPS
                      on  station_default.station_code   = origin_airport
                      and station_default.carrier_code   = airline_code
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
// ===========================================================================
// REPOINTED AT THE MAPS - 7 Oct 2026, and it had to be.
//
// This view read DESIGNATED_SUPPLIERS until today. That table was superseded
// by STATION_SUPPLIER_MAP and FLIGHT_SUPPLIER_MAP on 4 Oct, and the migration
// harness proved the maps reproduce it exactly, but this view was left
// pointing at the old table - stage two of the collapse, deferred.
//
// THE THREE INTO-PLANE CASES FORCED IT. They are recorded on the maps, so a
// view reading the legacy table would show a planner the OLD arrangement
// while the mapping app showed the new one: edit a mapping, see nothing
// change on the flight. Two tables holding one fact is what the collapse
// existed to end, and leaving this reader behind would have reinstated it.
//
// THE COLUMN LIST IS UNCHANGED, deliberately - supplier-contacts.cds and
// planning-service.cds read this view, and a column dropped here is a card
// gone blank somewhere else. Three are ADDED, all of them derived.
// ===========================================================================
entity FLIGHT_DESIGNATION as

    // ---- the flight arm: a named flight fuelled by somebody else ---------
    select from db.FLIGHT_SCHEDULE as f
        join FLIGHT_SUPPLIER_MAP as m
          on  ( m.is_active is null or m.is_active = true )
          and m.flight_number        =  f.flight_number
          and m.carrier.carrier_code =  f.airline_code
          and ( m.valid_from is null or m.valid_from <= f.flight_date )
          and ( m.valid_to   is null or m.valid_to   >= f.flight_date )
        // JOINED EXPLICITLY, never m.airport.iata_code in the ON clause: a
        // join condition may only name foreign keys, and the path form
        // compiles to a condition the database rejects. Same fix as
        // flight-designated-supplier.cds.
        join db.MASTER_AIRPORTS as ap
          on  ap.ID        =  m.airport.ID
          and ap.iata_code =  f.origin_airport
    {
        key f.ID              as flight_ID,
        key m.ID              as designation_ID,

            f.flight_number,
            f.flight_date,
            f.origin_airport,
            f.destination_airport,
            f.airline_code,

            // WHICH AXIS ANSWERED. The whole reason both rows are shown.
            'FLIGHT'          as axis : String(8),

            // AN EXPLICIT READING ORDER, NOT THE ALPHABET. FLIGHT first,
            // because it is the axis that GOVERNS where both exist. Carried
            // over from the previous definition, trap and all: sorting on
            // `axis` works today by alphabetical accident and breaks the day
            // a third axis is added.
            1                 as axis_rank : Integer,

            ap.iata_code      as station_code : String(3),
            m.carrier.carrier_code as carrier_code : String(3),

            // The maps carry neither column. A flight-level row IS the
            // primary arrangement, and the resolver's tie-break lives in
            // srv/lib/designation-resolver.js rather than in this priority -
            // these two are here because the readers expect them.
            'PRIMARY'         as designation_type : String(20),
            100               as priority : Integer,

            m.valid_from,
            m.valid_to,
            m.supplier,
            m.into_plane_agent,

            // CARRIED SO THE CONTACT STRIP CAN DERIVE, NOT STORE. Where the
            // supplier does not perform its own uplift, invoicing and
            // disputes stay with the SUPPLIER - so the agent's invoicing row
            // is NOT APPLICABLE rather than missing, and this flag says so.
            m.supplier_performs_uplift,

            // ---- the three cases, added 7 Oct 2026 ----------------------
            // Calculated on the maps, carried here so the flight screens read
            // the same answer the mapping app shows. See mapping-tables.cds.
            m.self_fuelled,
            m.into_plane_mode,
            m.into_plane_agent_name
    }

union all

    // ---- the station arm: the station's default arrangement --------------
    //
    // is_default, NOT every coverage row. The station map holds several
    // suppliers per station - that is coverage, and a card showing all of
    // them would answer "who MAY fuel here" where the reader asked "who
    // DOES". The same arm in flight-designated-supplier.cds reads the flag
    // the same way.
    select from db.FLIGHT_SCHEDULE as f
        join STATION_SUPPLIER_MAP as m
          on  ( m.is_active is null or m.is_active = true )
          and m.is_default           =  true
          and m.carrier.carrier_code =  f.airline_code
          and ( m.valid_from is null or m.valid_from <= f.flight_date )
          and ( m.valid_to   is null or m.valid_to   >= f.flight_date )
        join db.MASTER_AIRPORTS as ap
          on  ap.ID        =  m.airport.ID
          and ap.iata_code =  f.origin_airport
    {
        key f.ID              as flight_ID,
        key m.ID              as designation_ID,

            f.flight_number,
            f.flight_date,
            f.origin_airport,
            f.destination_airport,
            f.airline_code,

            'STATION'         as axis : String(8),
            2                 as axis_rank : Integer,

            ap.iata_code      as station_code : String(3),
            m.carrier.carrier_code as carrier_code : String(3),
            'PRIMARY'         as designation_type : String(20),
            100               as priority : Integer,

            m.valid_from,
            m.valid_to,
            m.supplier,
            m.into_plane_agent,
            m.supplier_performs_uplift,
            m.self_fuelled,
            m.into_plane_mode,
            m.into_plane_agent_name
    };

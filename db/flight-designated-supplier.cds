/**
 * FuelSphere — THE DESIGNATED SUPPLIER, AS ONE ROW PER FLIGHT (D56)
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS ACTUALLY WRONG, BECAUSE D56 RECORDED IT WRONG
 *
 * D56 said the column "returns 200 with the field present and null, ALWAYS".
 * MEASURED ON ALL 22 FLIGHTS: it returns a NAME on 14 and is blank on exactly
 * the 8 that have no designation at all. The blanks are correct.
 *
 * The defect is not emptiness. It is that `station_default` names the STATION
 * AXIS BY CONSTRUCTION — its `on` condition carries `flight_number is null` —
 * so a flight-level designation can never reach it. On AC102 the column shows
 * BP AVIATION UNITED KINGDOM while the designated supplier is AIR TOTAL
 * INTERNATIONAL. One flight in twenty-two, and it is the only flight in the
 * seed where the two axes disagree.
 *
 * THAT IS WORSE THAN BLANK AND QUIETER. A blank column tells a planner
 * nothing and they go and look. A column headed "Designated Supplier" showing
 * the station's default reads as the answer, and is wrong on precisely the
 * flight that has a specific arrangement — which is the only kind of flight
 * anybody made an arrangement FOR.
 *
 * The `$filter` has the same shape: it works (12 rows), and it filters on the
 * station axis, so filtering for Air Total MISSES AC102 and filtering for BP
 * INCLUDES it.
 *
 * ---------------------------------------------------------------------------
 * WHY A VIEW AND NOT A VIRTUAL ELEMENT
 *
 * A virtual element populated in an `after READ` that CALLS resolveDesignation()
 * would be guaranteed to agree, because it would BE the resolver. It cannot be
 * filtered or sorted on: `$filter` runs in the database before an after-READ
 * handler ever sees the row (D52). The SME asked for the supplier as a FILTER
 * AND a COLUMN, twice — so a virtual element answers half the request.
 *
 * Measured, rather than assumed: a to-ONE path filter serves
 * (`$filter=tail/registration eq 'C-FDMO'` returns 4 rows), so a to-one over
 * this view gives both halves.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS VIEW DECIDES, AND THE ONE THING IT REFUSES TO DECIDE
 *
 * It reproduces two things from designation-resolver.js:
 *
 *   THE SCOPE AND DATE WINDOW — a filter, not a tie-break. A row outside its
 *   validity does not APPLY, so showing it would be wrong here for the same
 *   reason it is wrong there.
 *
 *   THE AXIS — flight beats station. Two lines, and in the resolver it is not
 *   shared code either: it is expressed as QUERY ORDER, precisely because a
 *   join cannot say "this, ELSE that". Reproducing it is reproducing a
 *   sentence, not an engine.
 *
 * IT DOES NOT REPRODUCE SPECIFICITY-THEN-PRIORITY. That ordering lives in ONE
 * place — parameter-store's inScope(), reached through resolveEffective() —
 * and a second implementation in SQL is D44 exactly: two independent copies of
 * one rule, disagreeing one day, with nothing to notice.
 *
 * SO WHERE TWO ROWS COMPETE AT THE SAME AXIS, THIS VIEW EMITS NOTHING.
 *
 * It never picks among equals. That is the same principle as the resolver's
 * rung 3 — nothing is an ANSWER — applied one level up, and it buys an
 * invariant worth more than the row it gives up:
 *
 *     THE VIEW AGREES WITH resolveDesignation() OR IT SAYS NOTHING.
 *     IT NEVER SHOWS A DIFFERENT SUPPLIER.
 *
 * A blank that should have had a value is recoverable — someone asks why.
 * An arbitrary pick among two valid rows is not: it looks like an answer.
 * flight-designated-supplier-harness EXIT-3 asserts the invariant, and EXIT-4
 * plants the tie and asserts the view declines while the resolver still
 * answers.
 *
 * MEASURED ON THE SEED: 0 flights reach a same-axis tie, so the decline arm is
 * unexercised by data and is proved reachable by a plant rather than by a row.
 * Said here rather than left to read as coverage.
 */
namespace fuelsphere;

using { fuelsphere as db } from './schema';
using { fuelsphere.DESIGNATED_SUPPLIERS } from './designated-suppliers';

// ============================================================================
// The scope test, written once and used three times below. Kept literally
// identical across the join and both subqueries ON PURPOSE: if the three ever
// drift, "no other row competes" would be answered against a different row set
// from the one the join selected, and the view would decline for a row that
// was never a candidate — or worse, fail to decline for one that was.
// ============================================================================
entity FLIGHT_DESIGNATED_SUPPLIER as select from db.FLIGHT_SCHEDULE as f
    join DESIGNATED_SUPPLIERS as d
      on  d.designation_type = 'PRIMARY'
      and ( d.is_active    is null or d.is_active    =  true )
      and ( d.station_code is null or d.station_code =  f.origin_airport )
      and ( d.carrier_code is null or d.carrier_code =  f.airline_code )
      and ( d.flight_number is null or d.flight_number = f.flight_number )
      and ( d.valid_from   is null or d.valid_from   <= f.flight_date )
      and ( d.valid_to     is null or d.valid_to     >= f.flight_date )
{
    key f.ID            as flight_ID,
        d.ID            as designation_ID,

        // WHICH AXIS ANSWERED, carried beside the name rather than resolved
        // away. A planner reading "Air Total" needs to know whether that is
        // an arrangement for THIS FLIGHT or what the station does by default
        // — package D already took that decision for the two blocks and this
        // is the same decision for the column.
        case when d.flight_number is null then 'STATION' else 'FLIGHT' end
                        as axis : String(8),

        d.supplier.supplier_name     as supplier_name : String(100),
        d.supplier.supplier_code     as supplier_code : String(20),
        d.supplier,
        d.into_plane_agent.supplier_name as agent_name : String(100),
        d.supplier_performs_uplift,
        d.designation_type,
        d.priority,
        d.valid_from,
        d.valid_to
}
where
    // ---- THE AXIS: a station row is excluded where a flight row exists -----
    (   d.flight_number is not null
     or not exists (
            select 1 from DESIGNATED_SUPPLIERS as x
            where x.flight_number    =  f.flight_number
              and x.designation_type =  'PRIMARY'
              and ( x.is_active    is null or x.is_active    =  true )
              and ( x.station_code is null or x.station_code =  f.origin_airport )
              and ( x.carrier_code is null or x.carrier_code =  f.airline_code )
              and ( x.valid_from   is null or x.valid_from   <= f.flight_date )
              and ( x.valid_to     is null or x.valid_to     >= f.flight_date ) ) )

    // ---- THE DECLINE: never pick among equals -----------------------------
    // No OTHER in-scope row sits at the same axis. Where one does, this row is
    // suppressed, its twin is suppressed for the same reason, and the flight
    // gets no row at all. Specificity and priority would separate them and
    // that is the resolver's job, not this view's.
    and not exists (
            select 1 from DESIGNATED_SUPPLIERS as y
            where y.ID              <> d.ID
              and y.designation_type =  'PRIMARY'
              and ( y.is_active    is null or y.is_active    =  true )
              and ( y.station_code is null or y.station_code =  f.origin_airport )
              and ( y.carrier_code is null or y.carrier_code =  f.airline_code )
              and ( y.flight_number is null or y.flight_number = f.flight_number )
              and ( y.valid_from   is null or y.valid_from   <= f.flight_date )
              and ( y.valid_to     is null or y.valid_to     >= f.flight_date )
              and ( case when y.flight_number is null then 2 else 1 end )
                = ( case when d.flight_number is null then 2 else 1 end ) );


// ============================================================================
// THE TO-ONE THAT MAKES IT BINDABLE — and it is a to-one HONESTLY.
//
// D56's own note warns that "a to-one over station_code is D44 exactly", and
// it is right about the association it was describing: a to-one whose
// condition matches MANY rows is an arbitrary pick dressed as a fact, which is
// what D44 was.
//
// This one is different in the only way that matters: THE TARGET HAS AT MOST
// ONE ROW PER FLIGHT, and that is a property of the view rather than a hope
// about the data. The view declines wherever it cannot be sure, so the
// cardinality is guaranteed by construction and asserted by EXIT-2.
//
// IT LIVES HERE, NOT IN schema.cds, for the recorded one-way-dependency
// reason: this file imports schema.cds, so the base file has no name for
// FLIGHT_DESIGNATED_SUPPLIER and `extend` from this side is the only
// direction that compiles.
//
// AND station_default STAYS. It is not replaced and it is not wrong — it is
// "what this station does by default", which is a real question a planner
// asks, and the two blocks on the object page depend on it. What changes is
// that the COLUMN and the FILTER no longer bind to it, because the column is
// headed "Designated Supplier" and the station default is not that.
// ============================================================================
extend db.FLIGHT_SCHEDULE with {
    designated : Association to one FLIGHT_DESIGNATED_SUPPLIER
                 on designated.flight_ID = ID;
}

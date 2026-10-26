namespace fuelsphere;

using { fuelsphere as db } from './schema';
using { cuid } from '@sap/cds/common';

/**
 * FuelSphere — defuel.
 *
 * ===========================================================================
 * A DEFUEL REMOVES FUEL FROM AN AIRCRAFT AFTER IT WAS UPLIFTED, and the cost
 * of that fuel must not fall on the flight it came off. Four things follow,
 * and the BR is explicit that they are independent of each other: the
 * quantity leaves the tail at a value, the fuel sits somewhere physical, the
 * loss stays off the flight's fuel cost, and the commercial outcome with the
 * vendor is settled.
 *
 * THE FOURTH IS WHY THIS IS NOT A STOCK MOVEMENT. Fuel handed back is a
 * negotiation, and the amount recovered is usually less than the amount paid.
 * That difference is a real loss belonging to the defuel, not to the flight.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS NOT. It adds no handler and no annotation — WP-D2 is
 * schema only, and the behaviour arrives in WP-D3 onward. Every validation
 * named in a comment here is a DFL code that does not exist yet; §8 of
 * CLAUDE.md reserves the prefix and records that it carries nothing.
 * ---------------------------------------------------------------------------
 */

// ===========================================================================
// DEFUEL_REASON_CODE — configurable, because the reason drives the settlement
// ===========================================================================
//
// R1.3 asks for configurable rather than fixed, and R1.2 explains why it is
// mandatory rather than optional: an over-weight defuel is fuel the vendor
// delivered correctly and will usually credit, while a fuel-quality defuel
// may be the vendor's fault entirely or the airline's problem entirely. The
// reason is the first thing a controller looks at.
//
// SEEDED WITH THE SIX THE BR NAMES — MTOW, TECHNICAL, AIRCRAFT_CHANGE,
// FUEL_QUALITY, MAINTENANCE, OTHER — but as rows, so a seventh needs no
// deployment.
entity DEFUEL_REASON_CODE : db.AuditTrail {
    key code          : String(20);
        description   : String(100) @mandatory;

        // Whether this reason usually ends in a credit. NOT a rule, and
        // deliberately not one: it steers the screen's default and nothing
        // else. A fuel-quality defuel is sometimes credited in full and
        // sometimes not at all, and a system that decided that from the
        // reason would be wrong about half of them.
        credit_expected : Boolean default true;

        valid_from    : Date;
        valid_to      : Date;
        is_active     : Boolean default true;
        notes         : String(500);
}

// ===========================================================================
// STORAGE_LOCATION — somewhere for the fuel to be
// ===========================================================================
//
// R2.1 to R2.6. Two types, and the difference between them is commercial
// rather than physical: the same liquid in the same tank is `DEFUEL` if it
// is going back to the vendor and `TEMP` if it is waiting for another
// aircraft.
//
// R2.4 — UPLIFT OUT OF A `DEFUEL` LOCATION IS BLOCKED, a hard refusal and
// not a warning. Once fuel is destined for return it must not be quietly
// re-uplifted, because the return has already been priced and may already be
// accrued.
entity STORAGE_LOCATION : cuid, db.AuditTrail {
        code          : String(20) @mandatory;
        description   : String(100);

        // Per plant or station (R2.1). The airport is the station; the plant
        // code comes from STATION_PLANT_MAP, which already exists and already
        // resolves one to the other.
        airport       : Association to db.MASTER_AIRPORTS @mandatory;
        station_code  : String(3) @mandatory;      // denormalised, as the ledger does

        @assert.range
        location_type : DefuelLocationType @mandatory;

        // Capacity is advisory, not a guard. R2.6 refuses a NEGATIVE balance
        // because that means fuel went missing; an over-full tank is a
        // physical impossibility the system cannot detect and should not
        // pretend to.
        capacity_kg   : Decimal(15,2);

        valid_from    : Date;
        valid_to      : Date;
        is_active     : Boolean default true;
        notes         : String(500);
}

type DefuelLocationType : String(10) enum {
    Defuel = 'DEFUEL';   // awaiting return to the vendor, or disposal. Uplift out BLOCKED
    Temp   = 'TEMP';     // held for re-uplift to another tail. Uplift out permitted
}

// ===========================================================================
// DEFUEL — fuel off an aircraft and into a tank on the ground
// ===========================================================================
//
// REDESIGNED 26 Oct 2026, and this REPLACES the settlement model that stood
// here before. The earlier design parked a defuel, accrued an expected credit
// against it, then settled or wrote that credit off across several events.
// The instruction is to keep the demo simple and add that back later, so the
// credit machinery - DEFUEL_LEDGER_ENTRY, DEFUEL_SETTLEMENT, DEFUEL_ACCRUAL
// and their statuses - is gone rather than left dark. Dead schema reads as
// supported behaviour to the next person who opens the file.
//
// WHAT A DEFUEL IS NOW: one document that moves a quantity from a tail to a
// storage location, and posts BOTH HALVES of that move into the valuation
// ledger. Nothing is held, nothing is settled.
//
// THE TWO TYPES DIFFER IN INTENT, NOT IN MECHANICS. Answered 26 Oct: fuel
// destined for a supplier still lands in a storage location first, so both
// types post the same two rows. What separates them is where the fuel goes
// next, and STORAGE_LOCATION.location_type already carries exactly that
// distinction - DEFUEL for awaiting vendor return, TEMP for re-uplift.
// The type on the document says what was intended; the location says what is
// permitted. They are kept apart because a user can pick the wrong pair, and
// a mismatch is worth showing rather than silently reconciling.
type DefuelType : String(12) enum {
    ToStorage  = 'TO_STORAGE';    // held on the ground for re-uplift
    ToSupplier = 'TO_SUPPLIER';   // staged for return to the vendor
}

// WITH OR WITHOUT A FLIGHT, and the difference is which fields can be
// trusted. A flight-referenced defuel takes station, date, carrier and tail
// from FLIGHT_SCHEDULE, so those four cannot disagree with the schedule. A
// tail-only defuel has no schedule row to lean on, so the user states the
// station and names the flights either side of the event for context - which
// is all the pre and post flight numbers are for.
type DefuelSourceMode : String(16) enum {
    WithFlight    = 'WITH_FLIGHT';
    WithoutFlight = 'WITHOUT_FLIGHT';
}

// NO DRAFT MEMBER. CAP's own draft table is what holds a half-typed defuel,
// and a DRAFT status beside it would be a second answer to the same question
// - the d39 fixture harness exists because that exact duplication was built
// once already.
type DefuelStatus : String(10) enum {
    Posted   = 'POSTED';
    Reversed = 'REVERSED';
}

// KEPT, BECAUSE ROB_LEDGER CARRIES IT. The FOB ledger was extended with a
// valuation_basis column in an earlier work package and that extension is
// left alone - the demo runs on those tables, and dropping a column from them
// to tidy up this file would be the wrong trade.
type ValuationBasis : String(16) enum {
    SpecificUplift = 'SPECIFIC';   // D1a — the named uplift's price
    Fifo           = 'FIFO';       // D1b — the tail's layers, oldest first
    MovingAverage  = 'MAP';        // D1b — MAP as at the preceding ledger entry
    CarriedForward = 'CARRIED';    // R3.5 — the value it entered the location at
}

// ===========================================================================
// The two choices, as rows rather than as an enum alone
// ===========================================================================
//
// A CDS ENUM RENDERS AS A TEXT BOX. Fiori Elements builds a dropdown from a
// value list, and a value list needs rows to point at - so the two choices a
// user makes on this screen are seeded here. The columns stay enum-typed and
// @assert.range still enforces them; these tables exist to be PICKED FROM,
// not to be the source of truth.
//
// NAME, NOT CODE, IS WHAT THE USER READS. "Defuel to a storage location"
// says what TO_STORAGE means to somebody who has never seen the schema.
entity DEFUEL_TYPE_CODE : db.AuditTrail {
    key code : String(12);
        name : String(60) @mandatory;
        sort : Integer;
}

entity DEFUEL_MODE_CODE : db.AuditTrail {
    key code : String(16);
        name : String(60) @mandatory;
        sort : Integer;
}

entity DEFUEL : cuid, db.AuditTrail {

        // DFL-<station>-YYYYMM-NNNNNN, stamped when the document is created
        // and never after. The station is the one the fuel came off at, so
        // the number states where as well as when.
        //
        // NOT @mandatory ON INPUT. The system supplies it, and CAP input
        // validation runs BEFORE any before-handler, so a field the handler
        // fills cannot also be demanded of the caller. That ordering has
        // already produced one defect in this service.
        defuel_id        : String(30);

        @assert.range
        defuel_type      : DefuelType @mandatory;
        @assert.range
        source_mode      : DefuelSourceMode @mandatory;

        // ---- source: the aircraft -----------------------------------------
        tail             : Association to db.AIRCRAFT_REGISTRATIONS @mandatory;
        tail_number      : String(10);
        carrier          : Association to db.CARRIER_MASTER;
        carrier_code     : String(3);

        // Set only when source_mode is WITH_FLIGHT. Picking the flight fills
        // station, date, carrier and tail from the schedule.
        flight           : Association to db.FLIGHT_SCHEDULE;
        flight_number    : String(10);
        flight_date      : Date;

        // THE STATION THE FUEL CAME OFF AT. From the flight when there is
        // one, typed by the user when there is not. It feeds the defuel id,
        // which is why it is needed either way.
        station_code     : String(3);

        // BOTH ENDS OF THE LEG, filled from the schedule. Fuel comes off at
        // the departure stand before pushback or at the arrival stand after
        // a cancelled onward sector, and a reader of the document should be
        // able to see which leg it was without opening the schedule.
        origin_station      : String(3);
        destination_station : String(3);

        // Context on a tail-only defuel: what the aircraft last flew as, and
        // what it is due to fly as next. Neither is a link - the point is to
        // record what the user knew at the time.
        pre_flight_number  : String(10);
        post_flight_number : String(10);

        defuel_date      : Date @mandatory;
        defuel_time      : Time;

        ticket_number    : String(50);
        supplier         : Association to db.MASTER_SUPPLIERS;

        // ONE QUANTITY FOR THE WHOLE DOCUMENT, answered 26 Oct. The fuel that
        // leaves the wing is the fuel that reaches the tank; the destination
        // section shows this same figure rather than carrying its own. A
        // handling loss would need an account to absorb it, and FuelSphere
        // does not pick accounts.
        quantity_kg      : Decimal(15,3) @mandatory;
        quantity_l       : Decimal(15,2);

        // DERIVED AND DISPLAY-ONLY: the quantity-weighted average of the
        // specific gravity on the FIFO layers this defuel actually drew from.
        // Weighted, not a plain mean, because taking 900 kg from one layer
        // and 100 kg from another is not a 50/50 blend.
        specific_gravity : Decimal(8,4);

        // ---- destination: the tank on the ground --------------------------
        location         : Association to STORAGE_LOCATION @mandatory;
        location_code    : String(20);

        defuel_charges_usd : Decimal(15,2) default 0;
        taxes_usd          : Decimal(15,2) default 0;

        // What the posting worked out: the value of the fuel moved, at the
        // rates of the layers it came from. Charges and taxes are NOT part of
        // it - they are what the handling cost, not what the fuel is worth.
        fuel_value_usd   : Decimal(15,2);

        @assert.range
        status           : DefuelStatus default 'POSTED';

        notes            : String(1000);
}

// ===========================================================================
// DEFUEL_GL_ACCOUNT — configured, never determined
// ===========================================================================
//
// PER Q8, ANSWERED 23 Oct 2026: "Create a screen to configure G/L accounts
// and respective posting keys."
//
// THIS SUPERSEDES D9 AS WRITTEN, and the supersession is recorded rather than
// worked around. D9 says FuelSphere never determines a GL account and records
// only a posting key. What is built here is narrower than determining one:
// the business MAINTAINS the mapping and FuelSphere stores what it was told.
// No account number appears in db/ or srv/ source — which is the defect the
// rule was protecting against — but FuelSphere does now supply an account
// alongside the posting key, and that is a change of instruction from the
// design authority, not an interpretation.
//
// SEVEN ROLES WERE NAMED. The answer said "three G/L accounts" and then
// listed seven, so this is a configurable list keyed by role rather than
// seven columns: both readings work, and an eighth role needs no deployment.
entity DEFUEL_GL_ACCOUNT : cuid, db.AuditTrail {
        carrier       : Association to db.CARRIER_MASTER;
        company_code  : String(4);

        @assert.range
        account_role  : GlAccountRole @mandatory;

        // SAKNR as S/4 carries it — a string, because an account keeps its
        // leading zeros in some charts of accounts and loses them in none.
        gl_account    : String(10) @mandatory;
        posting_key   : String(4);

        description   : String(100);
        valid_from    : Date @mandatory;
        valid_to      : Date;
        is_active     : Boolean default true;
}

type GlAccountRole : String(24) enum {
    ExpectedCredit   = 'EXPECTED_CREDIT';    // Expected credit for returned / defuelled fuel
    WriteOffDefuel   = 'WRITE_OFF_DEFUEL';   // Fuel written off (defueling)
    // The five adjustment accounts, one per price component. A defuel
    // reverses an uplift's cost, and an uplift's cost has parts — which is
    // what the five separate accounts in Q8's answer mean.
    AdjBaseline      = 'ADJ_BASELINE';       // Fuel burn account (adj baseline cost)
    AdjServiceFee    = 'ADJ_SERVICE_FEE';    // Fuel burn account (adj fuel services fee)
    AdjAirportFee    = 'ADJ_AIRPORT_FEE';    // Fuel burn account (adj airport/royalty fee)
    AdjIntoPlane     = 'ADJ_INTO_PLANE';     // Fuel burn account (adj into plane)
    AdjTax           = 'ADJ_TAX';            // Fuel burn account (adj taxes)
}

// ===========================================================================
// THE TAIL LEDGER GAINS A DEFUEL, AND AN EVENT INSTANT
// ===========================================================================
//
// R4.6 — every movement appears on the TAIL's ledger and the LOCATION's
// ledger. The location ledger is above; this is the tail side.
//
// WHY AN EVENT INSTANT, per Q2 answered "based on time of uplift / defuel".
// ROB_LEDGER already holds a UTC instant — flight_aobt, populated on 3,788 of
// 3,815 rows and sorted on by the rebuild. But it is NAMED FOR A FLIGHT, and
// 27 rows already carry it empty. A defuel and a tail-only uplift have no
// off-block time; "when the movement happened" is a different question from
// "when the aircraft left the stand".
//
// Writing a defuel's time into flight_aobt would be the two-meanings defect
// this codebase has recorded several instances of. So a general instant is
// added beside it rather than overloading it.
extend db.ROB_LEDGER with {
        // The movement's own instant. For a flight-bound row this equals
        // flight_aobt; for a defuel or a tail-only uplift it is the only
        // thing that can position the row at all.
        event_utc     : Timestamp;
        event_local   : DateTime;
        event_zone    : String(50);

        defuel        : Association to DEFUEL;

        // R3.6 — the basis on every valued row, so a reader can tell a FIFO
        // figure from a MAP one.
        @assert.range
        valuation_basis : ValuationBasis;
}

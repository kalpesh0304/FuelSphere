namespace fuelsphere;

using { fuelsphere as db } from './schema';
using { cuid } from '@sap/cds/common';

/**
 * FuelSphere - the mapping tables the S/4 posting reads.
 *
 * A fuel ticket becomes a purchase order, a goods receipt and an FI document
 * in S/4. Those documents need four things FuelSphere has never had to name:
 * which COMPANY CODE the carrier posts under, which PLANT the station is in
 * for that carrier, which CONTRACT LINE the fuel is bought on, and - where a
 * single flight is fuelled by somebody other than its station's usual
 * supplier - who that is.
 *
 * WHY THESE ARE NOT DESIGNATED_SUPPLIERS, which already holds station and
 * flight level supplier rows:
 *
 *   DESIGNATED_SUPPLIERS answers "WHO SHOULD FUEL THIS FLIGHT". It resolves to
 *   ONE winner - flight beats station, then priority - and two active rows for
 *   the same flight at the same priority are a defect there.
 *
 *   STATION_SUPPLIER_MAP answers a different question: "THE TICKET SAYS WORLD
 *   FUEL - WHICH CONTRACT LINE DO I POST THAT AGAINST?". Several rows for one
 *   station and carrier are CORRECT here, one per supplier, because the ticket
 *   names the supplier and the map supplies the paperwork. Folding that into a
 *   table whose job is to pick a winner would make correct data look like
 *   unresolved conflicts.
 *
 *   FLIGHT_SUPPLIER_MAP does overlap the flight axis of DESIGNATED_SUPPLIERS,
 *   and that overlap is deliberate and known - see the note below.
 *
 * THE OVERLAP, AND WHAT GUARDS IT. Decided 30 September 2026: the flight
 * schedule screens keep reading DESIGNATED_SUPPLIERS and are not touched. So
 * "who fuels B102 at JFK" can be answered in two places. The guard is in
 * srv/mapping-service.js: saving a FLIGHT_SUPPLIER_MAP row that disagrees with
 * an active designation for the same flight, station and carrier reports it
 * (CAR405). It does not block - deviating is what a flight-level row is for -
 * but the disagreement is visible at the moment it is created rather than six
 * months later in an S/4 posting nobody can explain.
 *
 * Full reasoning, and what to do if these are ever merged:
 * docs/design/S4-Mapping-Tables.md
 */

// ===========================================================================
// CARRIER_MASTER - the airline codes this tenant operates under
// ===========================================================================
//
// FuelSphere has never had a carrier entity. DESIGNATED_SUPPLIERS carries a
// loose carrier_code String(3) and says so in its own comments; airline_code
// on FLIGHT_SCHEDULE is the same, unvalidated. This gives the code a home and,
// more to the point, the COMPANY CODE that the S/4 documents post under: a
// group operating B6 and B7 keeps two sets of books, and the purchase order
// has to name the right one.
//
// NATURAL KEY, not a UUID. The code IS the identity, it is what the flight
// schedule and the designation table already carry, and a seed file that says
// B6 rather than a generated GUID can be read by the people who maintain it.
// T001W_PLANT does the same with werks.
entity CARRIER_MASTER : db.ActiveStatus, db.AuditTrail {
    key carrier_code  : String(3);                  // IATA designator: B6, B7, AC
        carrier_name  : String(100);                // JetBlue Airways
        company_code  : String(4) @mandatory;       // SAP BUKRS: B600, B601
        notes         : String(500);

        // ---- TOLERANCE LIMITS, PER CARRIER ------------------------------
        //
        // Asked for 2 Oct 2026. Six controls, each with a percentage AND an
        // absolute, because neither alone is usable at both ends of the
        // range: 0.5% of a 60,000 kg uplift is 300 kg and nobody queries
        // that, while 0.5% of a 200 kg top-up is one kilogram and every row
        // breaches. The pair is read as "inside EITHER and it passes", so the
        // percentage governs the large movements and the absolute forgives
        // the small ones.
        //
        // WHY ON THE CARRIER rather than only in TOLERANCE_RULES. The rules
        // table is scoped by company code, supplier category, product type
        // and station - every axis except the airline. These are the
        // airline's own limits, agreed in its fuel contracts, and a group
        // operating two carriers needs two sets. TOLERANCE_RULES stays the
        // system-wide fallback for a carrier that sets none; nothing here
        // replaces it, and a null means "use the rule", not "zero".
        //
        // NULL IS NOT ZERO anywhere below. Zero would mean no variance at all
        // is acceptable, which no fuel operation can hold to.

        // What was delivered against what the gauges say.
        delivery_qty_tol_pct       : Decimal(5,2);   // %
        delivery_qty_tol_abs       : Decimal(15,3);  // kg

        // The invoice, line by line: quantity, the rate it was charged at,
        // and the money that line comes to.
        inv_line_qty_tol_pct       : Decimal(5,2);   // %
        inv_line_qty_tol_abs       : Decimal(15,3);  // kg
        inv_line_rate_tol_pct      : Decimal(5,2);   // %
        inv_line_rate_tol_abs      : Decimal(15,4);  // currency per unit
        inv_line_amount_tol_pct    : Decimal(5,2);   // %
        inv_line_amount_tol_abs    : Decimal(15,2);  // currency

        // And the invoice as a whole. A header can sit inside its limit while
        // lines within it offset each other, so these are a SEPARATE control
        // rather than a sum of the ones above.
        inv_header_qty_tol_pct     : Decimal(5,2);   // %
        inv_header_qty_tol_abs     : Decimal(15,3);  // kg
        inv_header_amount_tol_pct  : Decimal(5,2);   // %
        inv_header_amount_tol_abs  : Decimal(15,2);  // currency
}

// ===========================================================================
// STATION_PLANT_MAP - which plant a station is, for a carrier, on a date
// ===========================================================================
//
// MASTER_AIRPORTS.s4_plant_code already maps an airport to a plant, and that
// is not enough for this: it is ONE plant per airport for the whole system,
// with no carrier and no validity. The sheet needs JFK to be plant 1JFK for B6
// and 2JFK for B7, and to change on a date without losing what it was.
//
// The airport's name, city and country are NOT copied here. They are read
// through the association, so a renamed airport is renamed everywhere at once.
entity STATION_PLANT_MAP : cuid, db.ActiveStatus, db.AuditTrail {
        airport       : Association to db.MASTER_AIRPORTS @mandatory;
        carrier       : Association to CARRIER_MASTER @mandatory;
        plant         : Association to db.T001W_PLANT @mandatory;

        // Defaulted from the airport on create, then editable: a station can
        // keep local time for operational reporting while the airport master
        // carries the IANA zone.
        timezone      : String(50);

        valid_from    : Date @mandatory;
        valid_to      : Date;                       // null = open-ended

        // Why this mapping exists, where that is not obvious from the row.
        notes         : String(500);
}

// ===========================================================================
// STATION_SUPPLIER_MAP - the contract line to post a station's fuel on
// ===========================================================================
//
// Read on ticket creation as (station, carrier, THE TICKET'S SUPPLIER, date).
// Several suppliers at one station is the normal case, not a conflict - JFK
// under B6 is served by World Fuel on one contract and Shell on another, and
// which one applies is decided by the ticket, not by this table.
//
// NO SERIAL NUMBER. The sheet had one and it was doing nothing: the supplier
// already discriminates the rows, and a serial that does not decide anything
// is a column people have to fill in and then argue about. What the sheet was
// reaching for - "you cannot enter this twice" - is a rule rather than a
// field, and it lives in srv/mapping-service.js: the same station, carrier and
// supplier may not have two rows whose validity overlaps (CAR402). Once a row
// has expired, the same combination may be entered again.
//
// THE SAP NUMBERS ARE NOT STORED HERE. The supplier's vendor number lives on
// MASTER_SUPPLIERS.s4_vendor_no and the contract's on
// MASTER_CONTRACTS.s4_contract_number. Copying them would let this table
// disagree with the master the moment one is corrected. Only the LINE ITEM is
// here, because it belongs to this combination and to nothing else.
entity STATION_SUPPLIER_MAP : cuid, db.ActiveStatus, db.AuditTrail {
        airport            : Association to db.MASTER_AIRPORTS @mandatory;
        carrier            : Association to CARRIER_MASTER @mandatory;
        supplier           : Association to db.MASTER_SUPPLIERS @mandatory;

        // ---- COVERAGE AND DEFAULT ARE DIFFERENT FACTS -------------------
        //
        // Added 4 Oct 2026, when this table took over from
        // DESIGNATED_SUPPLIERS. Every row here says a supplier MAY fuel at
        // this station for this carrier - that is coverage, and several rows
        // per station is the normal case. Exactly one of them should also be
        // the one used when nothing more specific applies, and that is what
        // this says.
        //
        // WITHOUT IT THE TWO TABLES COULD NOT MERGE. A station map answers
        // "the ticket says World Fuel, which contract line?"; a designation
        // answered "who fuels this flight by default?". The second question
        // needs a winner and the first must not have one, so one flag carries
        // the difference and the resolution rule reads it: flight row, else
        // the station's default, else nothing and a person fills it in.
        //
        // NOT @mandatory, and nulls are not defaults. A station whose rows
        // all say false has coverage and no default - which is a real state,
        // and the honest answer there is an empty supplier for somebody to
        // fill in rather than an arbitrary pick.
        is_default         : Boolean default false;

        // ---- WHO PUTS IT IN THE WING ------------------------------------
        //
        // Carried over wholesale from DESIGNATED_SUPPLIERS, which was the one
        // thing the maps could not express. TRUE means the supplier fuels its
        // own product and the two fields below stay empty - a different state
        // from "not known yet", which is why the flag exists rather than
        // being inferred from an empty agent.
        supplier_performs_uplift : Boolean default false;
        into_plane_agent   : Association to db.MASTER_SUPPLIERS;
        into_plane_contract : Association to db.MASTER_CONTRACTS;

        // ---- CASE 3: THE AIRLINE'S OWN TANKS ----------------------------
        //
        // Added 7 Oct 2026. Some stations are fuelled by the airline itself -
        // its own storage, its own trucks, its own staff - and until now the
        // table could not say so. The nearest available row was "supplier
        // does not fuel, and no agent named", which is the state meaning NOT
        // YET DECIDED. Reading one as the other would have turned every
        // half-finished mapping into a self-fuelling station.
        //
        // The FUEL is still bought from a supplier: the airline buys into its
        // own tanks and puts it in its own wings. So `supplier` stays, and
        // only the into-plane side changes.
        self_fuelled       : Boolean default false;

        // ---- THE THREE CASES, AS ONE ANSWER -----------------------------
        //
        // CALCULATED ON READ, NOT STORED, so it cannot contradict the flags
        // it is read from. A fourth stored column would be a second truth
        // about the same fact, and the two would drift the first time one was
        // updated without the other.
        //
        //   SELF         the airline fuels from its own tanks
        //   SUPPLIER     the fuel supplier also puts it in the wing
        //   THIRD_PARTY  a separate into-plane agent does
        //   null         not yet decided - and that is a real state, not a
        //                default. An empty mapping must not read as an answer.
        //
        // SELF WINS over supplier_performs_uplift when both are set. The two
        // together are contradictory and the save-time check refuses them
        // (CAR410); this ordering decides what a row already in that state
        // reads as, rather than leaving it to the row order of a CASE.
        // `= true` IS LOAD-BEARING, not noise. SQLite accepts a boolean column
        // as a CASE condition; HANA does not - it wants a PREDICATE, and
        // `case when self_fuelled then` fails its view compiler with
        // "incorrect syntax near THEN". Caught only at deployment, because
        // every local harness runs on SQLite and passed. The rest of this
        // codebase already writes the comparison out (see
        // supplier_performs_uplift = false in db/supplier-contacts.cds).
        into_plane_mode    : String(12) = case
                                 when self_fuelled = true then 'SELF'
                                 when supplier_performs_uplift = true then 'SUPPLIER'
                                 when into_plane_agent.ID is not null then 'THIRD_PARTY'
                             end;

        // WHAT THE SCREENS SHOW, and the reason this field exists at all.
        //
        // Before it, case 1 displayed an EMPTY into-plane agent - correct in
        // the database, because the supplier needs no agent, and useless on
        // screen, where a blank reads as missing data. Every reader had to
        // know to look at `supplier_performs_uplift` and mentally substitute
        // the supplier's name. This does the substitution once, here.
        //
        // 'Self' is a LITERAL, not a supplier record. Creating a vendor row
        // for the airline itself would put it in every supplier value help
        // and make it selectable as a fuel supplier, which it is not.
        into_plane_agent_name : String(100) = case
                                    when self_fuelled = true then 'Self'
                                    when supplier_performs_uplift = true then supplier.supplier_name
                                    else into_plane_agent.supplier_name
                                end;

        // The contract the fuel is bought on, and the line within it. The
        // value help offers contract LINES that cover the chosen station, so
        // supplier, contract and line arrive together and cannot be mismatched.
        contract           : Association to db.MASTER_CONTRACTS @mandatory;
        contract_line_item : String(5) @mandatory;  // 10, 20, 30

        valid_from         : Date @mandatory;
        valid_to           : Date;                  // null = open-ended

        // Why this row exists, where that is not obvious from the row itself.
        // The designation migration uses it to flag an assumed contract line.
        notes              : String(500);
}

// ===========================================================================
// FLIGHT_SUPPLIER_MAP - a named flight fuelled by somebody else
// ===========================================================================
//
// The exception to the station map: B102 out of JFK is fuelled by 900017 where
// JFK's usual supplier is 900023. Keyed by flight number, station and carrier,
// because the same flight number operates from several stations and a group
// can fly it under two codes.
//
// flight_number is a STRING, not an association to FLIGHT_SCHEDULE, for the
// reason DESIGNATED_SUPPLIERS gives: FLIGHT_SCHEDULE is per flight-DATE, so
// pointing at it would tie this master data to one occurrence.
entity FLIGHT_SUPPLIER_MAP : cuid, db.ActiveStatus, db.AuditTrail {
        flight_number : String(8) @mandatory;
        airport       : Association to db.MASTER_AIRPORTS @mandatory;
        carrier       : Association to CARRIER_MASTER @mandatory;
        supplier      : Association to db.MASTER_SUPPLIERS @mandatory;

        // THE SAME THREE AS THE STATION MAP, because a flight-level row is a
        // COMPLETE override of the station's arrangement, not just a different
        // supplier. The migration proved it: of the 149 flight-level
        // designations, 148 carried supplier_performs_uplift and one named its
        // own into-plane agent at YYZ. Without these columns that is data the
        // migration would silently drop.
        supplier_performs_uplift : Boolean default false;
        into_plane_agent    : Association to db.MASTER_SUPPLIERS;
        into_plane_contract : Association to db.MASTER_CONTRACTS;

        // ---- CASE 3: THE AIRLINE'S OWN TANKS ----------------------------
        //
        // Added 7 Oct 2026. Some stations are fuelled by the airline itself -
        // its own storage, its own trucks, its own staff - and until now the
        // table could not say so. The nearest available row was "supplier
        // does not fuel, and no agent named", which is the state meaning NOT
        // YET DECIDED. Reading one as the other would have turned every
        // half-finished mapping into a self-fuelling station.
        //
        // The FUEL is still bought from a supplier: the airline buys into its
        // own tanks and puts it in its own wings. So `supplier` stays, and
        // only the into-plane side changes.
        self_fuelled       : Boolean default false;

        // ---- THE THREE CASES, AS ONE ANSWER -----------------------------
        //
        // CALCULATED ON READ, NOT STORED, so it cannot contradict the flags
        // it is read from. A fourth stored column would be a second truth
        // about the same fact, and the two would drift the first time one was
        // updated without the other.
        //
        //   SELF         the airline fuels from its own tanks
        //   SUPPLIER     the fuel supplier also puts it in the wing
        //   THIRD_PARTY  a separate into-plane agent does
        //   null         not yet decided - and that is a real state, not a
        //                default. An empty mapping must not read as an answer.
        //
        // SELF WINS over supplier_performs_uplift when both are set. The two
        // together are contradictory and the save-time check refuses them
        // (CAR410); this ordering decides what a row already in that state
        // reads as, rather than leaving it to the row order of a CASE.
        // `= true` IS LOAD-BEARING, not noise. SQLite accepts a boolean column
        // as a CASE condition; HANA does not - it wants a PREDICATE, and
        // `case when self_fuelled then` fails its view compiler with
        // "incorrect syntax near THEN". Caught only at deployment, because
        // every local harness runs on SQLite and passed. The rest of this
        // codebase already writes the comparison out (see
        // supplier_performs_uplift = false in db/supplier-contacts.cds).
        into_plane_mode    : String(12) = case
                                 when self_fuelled = true then 'SELF'
                                 when supplier_performs_uplift = true then 'SUPPLIER'
                                 when into_plane_agent.ID is not null then 'THIRD_PARTY'
                             end;

        // WHAT THE SCREENS SHOW, and the reason this field exists at all.
        //
        // Before it, case 1 displayed an EMPTY into-plane agent - correct in
        // the database, because the supplier needs no agent, and useless on
        // screen, where a blank reads as missing data. Every reader had to
        // know to look at `supplier_performs_uplift` and mentally substitute
        // the supplier's name. This does the substitution once, here.
        //
        // 'Self' is a LITERAL, not a supplier record. Creating a vendor row
        // for the airline itself would put it in every supplier value help
        // and make it selectable as a fuel supplier, which it is not.
        into_plane_agent_name : String(100) = case
                                    when self_fuelled = true then 'Self'
                                    when supplier_performs_uplift = true then supplier.supplier_name
                                    else into_plane_agent.supplier_name
                                end;

        valid_from    : Date @mandatory;
        valid_to      : Date;                       // null = open-ended

        // Why this mapping exists, where that is not obvious from the row.
        notes         : String(500);
}

// ===========================================================================
// STATION_SUPPLIER_OPTIONS - what may be entered, read from the contracts
// ===========================================================================
//
// The value help behind the supplier and contract fields, and the same list
// the save-time check reads. It is derived from CONTRACT_LOCATIONS, which is
// where a contract says which airports it covers - so the only suppliers
// offered at a station are the ones with a contract there, and the F4 can
// never drift from the master the posting will use.
//
// One row per contract-location, carrying the supplier and both S/4 numbers,
// so picking a line fills supplier, contract and line item at once.
entity STATION_SUPPLIER_OPTIONS as select from db.CONTRACT_LOCATIONS as l {
    key l.ID                        as option_ID        : UUID,

        l.airport.ID                as airport_ID       : UUID,
        l.airport.iata_code         as station_code     : String(3),
        l.airport.airport_name      as station_name     : String(100),

        l.contract.supplier.ID      as supplier_ID      : UUID,
        l.contract.supplier.supplier_name as supplier_name : String(100),
        l.contract.supplier.s4_vendor_no  as s4_vendor_no  : String(10),

        l.contract.ID               as contract_ID      : UUID,
        l.contract.contract_number  as contract_number  : String(20),
        l.contract.s4_contract_number as s4_contract_number : String(10),
        l.contract.contract_type    as contract_type    : String(20),

        // The location's own window, not the contract's: a contract can run
        // for three years and cover a station for one of them.
        l.valid_from                as valid_from       : Date,
        l.valid_to                  as valid_to         : Date,
        l.location_type             as location_type    : String(20),
        l.priority                  as priority         : Integer,
        l.is_active                 as is_active        : Boolean
};

// ===========================================================================
// SUPPLIER_CONTRACT_OPTIONS - every contract a supplier holds
// ===========================================================================
//
// THE ESCAPE HATCH FOR A CONTRACT SIGNED TOMORROW.
//
// STATION_SUPPLIER_OPTIONS above is derived from CONTRACT_LOCATIONS, so a
// contract only appears there once somebody has recorded which airports it
// covers. That is the right list for choosing a SUPPLIER at a station, and the
// wrong list for choosing the CONTRACT: a contract created this morning has no
// locations yet, and a station-filtered list would leave it unmappable - on a
// table the transactional apps are built on.
//
// So the contract field reads this instead: every active contract, filtered by
// the supplier already chosen. covers_station is carried as information rather
// than as a filter - it tells the person whether the contract lists that
// station, and the save-time check reports it (CAR409) without refusing.
entity SUPPLIER_CONTRACT_OPTIONS as select from db.MASTER_CONTRACTS as c {
    key c.ID                     as contract_ID      : UUID,

        c.supplier.ID            as supplier_ID      : UUID,
        c.supplier.supplier_name as supplier_name    : String(100),
        c.supplier.s4_vendor_no  as s4_vendor_no     : String(10),

        c.contract_number        as contract_number  : String(20),
        c.s4_contract_number     as s4_contract_number : String(10),
        c.contract_type          as contract_type    : String(20),
        c.currency_code          as currency_code    : String(3),
        c.valid_from             as valid_from       : Date,
        c.valid_to               as valid_to         : Date,
        c.is_active              as is_active        : Boolean,

        // How many airports this contract lists. Zero is legitimate and
        // common on the day a contract is signed.
        (select count(*) from db.CONTRACT_LOCATIONS as l where l.contract.ID = c.ID)
                                 as station_count    : Integer
};

// ===========================================================================
// STATION_MAPPED_SUPPLIERS - who is already mapped to a station
// ===========================================================================
//
// THE FLIGHT APP CHOOSES FROM WHAT THE STATION APP HAS DECLARED.
//
// The two apps have different jobs and therefore different lists. The station
// app is where somebody says "this supplier, on this contract, serves JFK" -
// so its supplier list is every supplier, because a station cannot be its own
// prerequisite. The flight app is the exception to that declaration, and there
// is nothing to make an exception to until the station has been mapped: so its
// supplier list is this view, the suppliers already mapped to the airport
// chosen on the row.
//
// It also carries the contract line, because that is what the posting will
// read for the flight once the supplier is settled - the flight mapping names
// a supplier and nothing else, by design.
entity STATION_MAPPED_SUPPLIERS as select from STATION_SUPPLIER_MAP as m {
    key m.ID                          as mapping_ID       : UUID,

        m.airport.ID                  as airport_ID       : UUID,
        m.airport.iata_code           as station_code     : String(3),
        m.carrier.carrier_code        as carrier_code     : String(3),

        m.supplier.ID                 as supplier_ID      : UUID,
        m.supplier.supplier_name      as supplier_name    : String(100),
        m.supplier.s4_vendor_no       as s4_vendor_no     : String(10),

        m.contract.contract_number    as contract_number  : String(20),
        m.contract.s4_contract_number as s4_contract_number : String(10),
        m.contract_line_item          as contract_line_item : String(5),

        m.valid_from                  as valid_from       : Date,
        m.valid_to                    as valid_to         : Date,
        m.is_active                   as is_active        : Boolean
};

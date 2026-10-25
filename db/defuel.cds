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
// DEFUEL — the event
// ===========================================================================
entity DEFUEL : cuid, db.AuditTrail {

        // ---- what happened ------------------------------------------------
        defuel_number : String(30);                 // allocated like a ticket number

        @assert.range
        movement_type : DefuelMovementType @mandatory;

        tail          : Association to db.AIRCRAFT_REGISTRATIONS @mandatory;
        tail_number   : String(10) @mandatory;      // denormalised, as ROB_LEDGER does

        // THE FLIGHT IS OPTIONAL AND THE TAIL IS NOT. R1.1 records a defuel
        // against a tail and the flight it came off — but a defuel on a
        // parked aircraft has no flight, which is exactly the case R3.7 was
        // written for. The tail always exists; the flight sometimes does.
        flight        : Association to db.FLIGHT_SCHEDULE;
        flight_number : String(10);

        // ---- WHO OWNS THE FUEL, per Q6 answered 23 Oct 2026 ---------------
        //
        // MANDATORY ON THE TRANSACTION, DEFAULTED FROM THE AIRCRAFT MASTER
        // AND EDITABLE. Asked for in those words, and it is the right shape:
        // valuation is scoped by carrier (D1), and a tail moving between
        // carriers or flown wet-leased has two defensible answers that only
        // the person recording the movement can choose between.
        //
        // IT IS NOT DERIVED AT READ TIME. A carrier resolved later from a
        // master that has since changed would re-value history. Captured
        // here, the row says who owned the fuel when it came off.
        carrier       : Association to db.CARRIER_MASTER @mandatory;
        carrier_code  : String(3) @mandatory;

        reason        : Association to DEFUEL_REASON_CODE @mandatory;

        // ---- WHEN, which is three columns and not one ---------------------
        //
        // R3.9 and R3.10, and Q2 answered "based on time of uplift / defuel"
        // — so the event's own instant positions it in the ledger, not a
        // fixed slot in a within-timestamp order.
        //
        // ALL THREE ARE KEPT because each does a different job. The local
        // time is what the ticket says and what the crew signed. The UTC is
        // what the ledger sorts on. The zone is what connects them — and
        // without it the conversion cannot be re-explained or re-run, which
        // is the same reason a resolved tolerance records which row supplied
        // it.
        //
        // A NAMED ZONE, NEVER AN OFFSET. An offset is wrong half the year
        // under daylight saving and permanently wherever a country changes
        // its rules; the zone resolves the rule in force on the event date.
        // MASTER_AIRPORTS.timezone carries IANA names on 96 of 96 stations,
        // so this needs no master-data work.
        // THE TWO THAT ARE ENTERED ARE MANDATORY; THE DERIVED ONE IS NOT.
        //
        // R3.7 makes the event time mandatory and it is — but what a person
        // enters is the local time and the station's zone, and the UTC is
        // what FuelSphere computes from them. Requiring it on input would
        // make the screen supply a figure it is the system's job to derive,
        // and — worse — the not-null assertion fires BEFORE the conversion
        // runs, so a local time that never existed would be refused as a
        // missing field rather than by DFL409. The refusal would be right by
        // accident and unreadable.
        //
        // It is never absent in practice: the handler computes it or refuses
        // the row, so nothing reaches the ledger without one.
        event_local   : DateTime @mandatory;        // as entered, at the station
        event_zone    : String(50) @mandatory;      // IANA, e.g. America/Vancouver
        event_utc     : Timestamp;                  // derived; what the ledger orders by

        // WHICH READING WAS TAKEN when clocks went back and a local time
        // occurred twice. Null on every ordinary row. R3's rule is that the
        // ambiguity is resolved explicitly rather than picked silently, and
        // a row that cannot say which reading it took has not resolved it.
        event_dst_fold : Boolean;

        // ---- how much ------------------------------------------------------
        quantity_kg   : Decimal(15,3) @mandatory;
        quantity_l    : Decimal(15,2);

        // THE DENSITY AND WHERE IT CAME FROM, never one without the other.
        // D1c sets the source by basis: the uplift's own for a referenced
        // defuel, the layer's for FIFO, the tail average for MAP.
        //
        // BLANK IS A LEGITIMATE VALUE AND 0.8 IS NOT. The BR is explicit —
        // a derived value with a missing input is blank, never zero and
        // never a constant in disguise. 0.8 presented as a measurement is a
        // figure nobody can defend to a vendor.
        density       : Decimal(8,4);
        @assert.range
        density_source : DensitySource;

        // ---- what it was worth ---------------------------------------------
        //
        // THE BASIS IS ON THE ROW (R3.6). With a carrier default, a carrier
        // override and a specific-identification override all in play, a
        // value without its basis cannot be reconciled to anything.
        @assert.range
        valuation_basis : ValuationBasis;

        // M1 only. R4.1 requires the user to pick the uplift; R3.3 then
        // values the defuel at that uplift's price, overriding the carrier's
        // method. R1.5's cumulative test binds here and nowhere else — the
        // BR confirms it binds M1 by construction, because M2 has no uplift
        // to net against.
        source_ticket : Association to db.FUEL_TICKETS;

        // R4.2 — M2 has no uplift, so the vendor is typed in (R1.8). Which
        // is also why R1.7 allows correcting it: a typed field is a field
        // that gets typed wrongly.
        vendor        : Association to db.MASTER_SUPPLIERS;

        // The value as it left the tail, before any fee. held_value below is
        // this plus a capitalised fee.
        fuel_value_usd : Decimal(15,2);

        // ---- the price components, per Q8 ----------------------------------
        //
        // A DEFUEL REVERSES AN UPLIFT'S COST, AND AN UPLIFT'S COST HAS PARTS.
        // Q8 named five adjustment accounts — baseline, service fee,
        // airport/royalty, into-plane and taxes — which only means anything
        // if the defuel carries the same breakdown. FLIGHT_COSTS already
        // splits base_fuel_cost, tax_amount, into_plane_fees and
        // surcharge_amount, so four of the five have a precedent here.
        //
        // AIRPORT/ROYALTY HAS NO EXISTING FIELD and is raised as a question
        // rather than assumed into surcharge_amount.
        component_base_usd        : Decimal(15,2) default 0;
        component_service_fee_usd : Decimal(15,2) default 0;
        component_airport_fee_usd : Decimal(15,2) default 0;
        component_into_plane_usd  : Decimal(15,2) default 0;
        component_tax_usd         : Decimal(15,2) default 0;

        // ---- where it went --------------------------------------------------
        location      : Association to STORAGE_LOCATION @mandatory;

        // ---- the fee (R6) ----------------------------------------------------
        //
        // R6.1 — the treatment is the USER'S CHOICE at the time of the
        // defuel, and that is why it is a field rather than a rule.
        // Defuelling into a temporary location for another aircraft is a
        // logistics cost of getting fuel where it is needed, so capitalising
        // is right; defuelling an over-weight flight is a cost of that
        // flight's disruption, so expensing is right. The same fee is both
        // depending on why it happened, so the system cannot derive it.
        defuel_fee_usd : Decimal(15,2) default 0;
        @assert.range
        fee_treatment  : FeeTreatment;

        // R6.5 — a capitalised fee is part of the held value and therefore
        // part of the shortfall. A shortfall on the fuel price alone would
        // understate the loss by the fee, and the fee is the part the
        // airline is least likely to recover.
        held_value_usd : Decimal(15,2);

        // ---- HOW MUCH OF IT IS SETTLED, as a running total ----------------
        //
        // R5.11 settles a parcel in PARTS — part credited and the rest
        // declined, or credited across two memos a month apart. So "is it
        // settled" is not a flag but an arithmetic question, and the open
        // remainder is held_value minus these.
        //
        // MAINTAINED BY THE SETTLEMENT ACTION, never typed. They are totals
        // of DEFUEL_SETTLEMENT rows, kept here because the list report has to
        // sort and filter on what is still open without expanding every
        // child on every row.
        settled_qty_kg    : Decimal(15,3) default 0;
        settled_value_usd : Decimal(15,2) default 0;
        credited_usd      : Decimal(15,2) default 0;   // what the vendor gave
        written_off_usd   : Decimal(15,2) default 0;   // what was not recovered

        // ---- status -----------------------------------------------------------
        // PARKED BY DEFAULT (R5.9). A recorded defuel with no agreed outcome
        // is a parked item — a real position on the books and the population
        // month end accrues. Mandatory with no default meant the row was
        // refused before the handler that sets it ever ran, which is the same
        // trap event_utc fell into.
        // SUPPLIED BY THE SYSTEM, SO NOT MANDATORY ON INPUT — the same trap
        // event_utc fell into, and worth stating once for both.
        //
        // CAP's `default` is a DATABASE default; input validation still
        // demands a @mandatory field in the payload, and it runs BEFORE any
        // custom before-handler. So a field the handler is responsible for
        // setting cannot also be mandatory on input: the row is refused
        // before the code that would have filled it ever runs.
        //
        // The value is still guaranteed. @assert.range refuses anything
        // outside the type, the database default supplies PARKED, and the
        // handler sets it explicitly on every path.
        @assert.range
        status        : DefuelStatus default 'PARKED';

        // ---- M5, which is one transaction (R4.4) -------------------------------
        //
        // R4.5 — both halves and the pass-through trace to ONE reference.
        // @assert.unique because nothing enforces it otherwise: the BR
        // measured zero unique constraints in db/, and a duplicate transfer
        // reference would raise nothing at all.
        transfer_reference : String(40);
        counterpart        : Association to DEFUEL;   // the M4 half of an M5

        // ---- reversal and correction (D6a, R1.6-R1.10) -------------------------
        //
        // R1.9 IS THE SUBTLE ONE. A reversal or a correction puts right the
        // RECORD of an event, not a new event — the defuelling happened when
        // it happened. Both therefore sit at the original defuel's position
        // in the chain. Stamped at the moment the error was noticed, every
        // balance between the two would be computed as though the fuel left
        // the tank later than it did: wrong in the middle, right at the end,
        // which is the hardest shape of error to see.
        //
        // So a reversal carries the ORIGINAL event_utc, not its own.
        reverses      : Association to DEFUEL;
        reversed_by   : Association to DEFUEL;
        corrects      : Association to DEFUEL;

        // R1.10 — a reversed defuel is kept and marked, never deleted, and
        // cannot be reversed again.
        is_reversed   : Boolean default false;

        notes         : String(1000);

        // ---- the children ------------------------------------------------------
        ledger_entries : Composition of many DEFUEL_LEDGER_ENTRY
                             on ledger_entries.defuel = $self;
        settlements    : Composition of many DEFUEL_SETTLEMENT
                             on settlements.defuel = $self;
        accruals       : Association to many DEFUEL_ACCRUAL
                             on accruals.defuel = $self;
}

type DefuelMovementType : String(2) enum {
    M1 = 'M1';   // against a known uplift      -> DEFUEL location, that uplift's price
    M2 = 'M2';   // no uplift reference         -> DEFUEL location, carrier's method
    M3 = 'M3';   // for re-use                  -> TEMP location
    M4 = 'M4';   // re-uplift from TEMP         -> receiving tail. Creates NO purchase
    M5 = 'M5';   // tail to tail                -> M3 then M4, one transaction
}

// NO 'DRAFT' MEMBER, and its absence is the decision.
//
// The entity is @odata.draft.enabled, so an in-progress defuel lives in the
// DRAFT TABLE — the framework already owns that state. A DRAFT value on the
// active row would be a second way of saying the same thing, and the two
// would disagree the moment somebody activated a row without the handler
// running. d39-status-fixture caught it: nothing in srv/ ever wrote DRAFT,
// which is exactly what a redundant state looks like from the outside.
type DefuelStatus : String(12) enum {
    Parked     = 'PARKED';       // recorded, nothing posted, outcome unknown (R5.9)
    Posted     = 'POSTED';       // settled in whole or in part (R5.11)
    Settled    = 'SETTLED';      // fully resolved to S1, S2 or S3
    WrittenOff = 'WRITTEN_OFF';
    Reversed   = 'REVERSED';
    Error      = 'ERROR';
}

type ValuationBasis : String(16) enum {
    SpecificUplift = 'SPECIFIC';   // D1a — the named uplift's price
    Fifo           = 'FIFO';       // D1b — the tail's layers, oldest first
    MovingAverage  = 'MAP';        // D1b — MAP as at the preceding ledger entry
    CarriedForward = 'CARRIED';    // R3.5 — the value it entered the location at
}

type DensitySource : String(20) enum {
    SourceUplift  = 'SOURCE_UPLIFT';   // the referenced uplift's own
    FifoLayer     = 'FIFO_LAYER';      // the consumed layer's specific gravity
    TailAverage   = 'TAIL_AVERAGE';    // the tail's average under MAP
    Captured      = 'CAPTURED';        // entered by the user at the defuel
    Unavailable   = 'UNAVAILABLE';     // and the figure is therefore BLANK, not 0.8
}

type FeeTreatment : String(12) enum {
    Capitalise = 'CAPITALISE';   // R6.2 — into the held value, raising unit cost
    Expense    = 'EXPENSE';      // R6.3 — to Write-off (Defueling), on the flight
}

// ===========================================================================
// DEFUEL_LEDGER_ENTRY — the location's own ledger
// ===========================================================================
//
// R2.3 IS THE PART THAT DOES NOT EXIST TODAY AND IS EASY TO UNDERESTIMATE.
// FuelSphere keeps balances and values against a TAIL. A location is a second
// kind of thing that holds fuel, and the BR asks for it to be tracked
// ALONGSIDE the tail — not by overloading the tail-keyed ledger with rows
// that have no tail. ROB_LEDGER.tail_number is @mandatory, so location rows
// could not go there without making it optional for every row.
//
// ONE ENTRY PER LAYER CONSUMED, per Q9 answered 23 Oct 2026. Under FIFO a
// single defuel can draw three layers at three prices, so the location
// receives one quantity carrying three values. A blended average would break
// exactly the traceability R3.5 exists to protect — the blend reconciles to
// no single invoice. One row per layer costs nothing but rows, and it makes
// R5.11's partial settlement natural: the vendor credits one entry at a time.
entity DEFUEL_LEDGER_ENTRY : cuid, db.AuditTrail {
        defuel        : Association to DEFUEL @mandatory;
        location      : Association to STORAGE_LOCATION @mandatory;

        @assert.range
        direction     : LedgerDirection @mandatory;

        // SIGNED, as ROB_LEDGER.qty_kg is: + in, - out. A single signed
        // column is what makes the running balance a running total.
        qty_kg        : Decimal(15,3) @mandatory;
        rate_usd_per_kg : Decimal(15,6);
        value_usd     : Decimal(15,2);

        // THE LAYER THIS ROW CAME FROM. Null under MAP, where a defuel has
        // one rate and the question does not arise. Under FIFO it is what
        // lets a credit be reconciled to the invoice that bought that fuel.
        batch_ref     : String(40);

        @assert.range
        valuation_basis : ValuationBasis;

        density       : Decimal(8,4);
        @assert.range
        density_source : DensitySource;

        // Running, per location. R2.6 refuses a negative balance, and that
        // refusal is the control — a quantity that leaves a tail and never
        // arrives, or leaves a location twice, shows up here.
        balance_qty_kg   : Decimal(15,3);
        balance_value_usd : Decimal(15,2);

        // Same three-part time as the event, because a location ledger is
        // replayed exactly as a tail ledger is.
        event_local   : DateTime;
        event_zone    : String(50);
        event_utc     : Timestamp @mandatory;
        sequence      : Integer;

        // How much of THIS entry has been settled. R5.11 settles a parcel in
        // parts, so an entry is exhausted rather than cleared.
        settled_qty_kg   : Decimal(15,3) default 0;
        settled_value_usd : Decimal(15,2) default 0;
}

// Inbound/Outbound rather than In/Out: `In` is a reserved word in CDS and
// compiles only as ![In], which would put an escape in every reference to it.
// The stored values stay IN and OUT.
type LedgerDirection : String(3) enum {
    Inbound  = 'IN';
    Outbound = 'OUT';
}

// ===========================================================================
// DEFUEL_SETTLEMENT — one settlement event, and there may be several
// ===========================================================================
//
// R5.11 CHANGES THE SHAPE AND MUST BE BUILT IN FROM THE START. An earlier
// draft treated a settlement as one outcome for one quantity. It is not: a
// vendor may credit part of a parcel and decline the rest, or settle across
// two credit memos a month apart. So a quantity in the location is settled by
// ONE OR MORE events until it is exhausted, and the location's balance falls
// as each lands rather than clearing in one step.
//
// Retro-fitting that onto a one-shot design is the expensive way to discover
// it, which is why this is an entity rather than three columns on DEFUEL.
entity DEFUEL_SETTLEMENT : cuid, db.AuditTrail {
        defuel        : Association to DEFUEL @mandatory;

        // Which location entry this settles. R5.11 operates per entry, which
        // is what Q9's one-row-per-layer makes natural.
        ledger_entry  : Association to DEFUEL_LEDGER_ENTRY;

        @assert.range
        outcome       : SettlementOutcome @mandatory;

        settled_qty_kg : Decimal(15,3) @mandatory;

        // R5.5 / D2 — an expected or actual credit MAY NOT EXCEED the held
        // value. A hard refusal with both figures quoted, because it is a
        // data-entry error every time and a credit above the held value would
        // turn a loss into a profit on a transaction where the airline lost
        // money.
        held_value_usd   : Decimal(15,2) @mandatory;
        expected_credit_usd : Decimal(15,2);
        actual_credit_usd   : Decimal(15,2);

        // R5.4 — a credit for less than the held value records the shortfall
        // as a loss. Never absorbed silently.
        write_off_usd : Decimal(15,2);

        // R9 — the variance against the tolerance, and WHICH ROW supplied it.
        // R9.5: any resolved tolerance must record which configuration row
        // produced it, or an exception cannot be defended later.
        variance_usd  : Decimal(15,2);
        tolerance_parameter_id : String(40);
        is_exception  : Boolean default false;

        // R5.12 / D11 — approval, switched on by a carrier parameter, with
        // an optional threshold per Q3. The authorisation framework itself
        // is not yet designed; these record the state it will drive.
        @assert.range
        approval_status : ApprovalStatus;
        submitted_by  : String(100);
        submitted_at  : Timestamp;
        approved_by   : String(100);
        approved_at   : Timestamp;

        credit_memo_reference : String(40);
        settled_at    : Timestamp;

        // D9 as superseded by Q8: the posting key, and the configured
        // account role. FuelSphere does not DERIVE an account — it records
        // which configured role applies and the accounting system or the
        // configuration supplies the number.
        posting_key   : String(4);
        notes         : String(500);
}

type SettlementOutcome : String(2) enum {
    S1 = 'S1';   // full credit, nothing written off
    S2 = 'S2';   // partial credit — THE NORMAL CASE (R5.3)
    S3 = 'S3';   // no credit, whole held value written off
}

type ApprovalStatus : String(12) enum {
    NotRequired = 'NOT_REQ';
    Submitted   = 'SUBMITTED';
    Approved    = 'APPROVED';
    Rejected    = 'REJECTED';
}

// ===========================================================================
// DEFUEL_ACCRUAL — month end, and only for what is PARKED
// ===========================================================================
//
// PER Q4, ANSWERED 23 Oct 2026, AND IT IS A SIMPLIFICATION OF THE BR. The
// question asked whether a part-settled parcel accrues in whole or in
// remainder. The answer was neither:
//
//     "Accrual is needed only if it is in parked state. In posted state the
//      expected credit account already takes care of the accrual."
//
// Which is right, and follows from the accounting. A parked defuel has no FI
// entry at all, so the period shows a reduction in fuel cost with nothing
// against it. Once posted, the entry lands — Expected Credit debited, Fuel
// written off debited, Fuel burn adjustment credited — and the Expected
// Credit account IS the receivable. Accruing on top would double it.
//
// So the population is PARKED defuels, not "everything unsettled".
entity DEFUEL_ACCRUAL : cuid, db.AuditTrail {
        defuel        : Association to DEFUEL @mandatory;

        period        : String(7) @mandatory;       // 2026-10
        fiscal_year   : String(4);

        accrued_value_usd : Decimal(15,2) @mandatory;

        @assert.range
        status        : AccrualStatus @mandatory;

        accrued_at    : Timestamp;
        // R8.4 — reverses at the START of the next period, not at its end.
        reversed_at   : Timestamp;
        reversal_period : String(7);

        posting_key   : String(4);
        notes         : String(500);
}

type AccrualStatus : String(10) enum {
    Accrued  = 'ACCRUED';
    Reversed = 'REVERSED';
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

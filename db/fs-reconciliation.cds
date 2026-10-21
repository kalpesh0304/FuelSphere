namespace fuelsphere;

using { fuelsphere as db } from './schema';
using { cuid } from '@sap/cds/common';

/**
 * FuelSphere - Financials to FuelSphere reconciliation, the master data.
 *
 * ---------------------------------------------------------------------------
 * THE QUESTION THIS ANSWERS. Finance closes a period and the fuel burn G/L
 * accounts carry a number. FuelSphere, reading the same month from the other
 * end - tickets, uplifts, burns - carries a different one. The month cannot
 * close until somebody can say WHY they differ, line by line, and today that
 * is a spreadsheet somebody rebuilds every month.
 *
 * NO LEDGER TABLE IS TOUCHED BY ANY OF THIS. ROB_LEDGER and
 * FUEL_STOCK_MOVEMENT_LEDGER are read and never written, and neither gains a
 * column: the reconciliation is computed at read time from what they already
 * hold - see srv/reconciliation-service.js. That is a deliberate constraint,
 * asked for in these words while a demo was scheduled against those tables,
 * and it is also the right design. A reconciliation that writes to the ledger
 * it reconciles cannot be trusted to disagree with it.
 *
 * ONE TABLE LIVES HERE, and it is master data rather than a result: which
 * G/L accounts a carrier's fuel lands in. Everything else is derived.
 * ---------------------------------------------------------------------------
 */

// ===========================================================================
// RECON_GL_ACCOUNTS - which G/L accounts hold a carrier's fuel
// ===========================================================================
//
// FROM THE SPECIFICATION, which shows it as a side table on the screen:
// carrier B6 against accounts 600780 and 600781. Two accounts for one
// carrier, which is the whole reason this is a table and not a column on
// CARRIER_MASTER: fuel into the wing and fuel burnt are different accounts,
// and some carriers split further by station or by fuel type.
//
// IT IS THE KEY TO THE DRILL-DOWN. "Drill down in any row shows the GL level
// recon" - a row of this table is a line of that drill-down, which is why
// the account carries a role rather than only a number. Without the role,
// the drill-down can list accounts but cannot say which of them SHOULD have
// received the uplift it is explaining.
//
// TIME-DEPENDENT, because a chart of accounts is. An account renumbered in
// April must not retrospectively re-explain January, and a reconciliation
// that silently used today's mapping for last year's figures would be wrong
// in the one direction nobody checks.
entity RECON_GL_ACCOUNTS : cuid, db.AuditTrail {
        carrier        : Association to db.CARRIER_MASTER @mandatory;

        // SAP BUKRS. Denormalised from CARRIER_MASTER deliberately: a carrier
        // can post to more than one company code, and when it does, which one
        // an account belongs to is a property of the account.
        company_code   : String(4);

        // SAKNR, as S/4 carries it - a string, not a number. 600780 keeps its
        // leading zeros in some charts of accounts and loses them in none.
        gl_account     : String(10) @mandatory;

        // WHAT THE ACCOUNT IS FOR. The reconciliation adds UPLIFT and
        // BLOCK_BURN and APU_BURN to different sides of the same comparison;
        // an account with no role is a number the screen can show and the
        // arithmetic cannot use.
        account_role   : String(16);   // UPLIFT | BLOCK_BURN | APU_BURN | ADJUSTMENT | STOCK | ACCRUAL

        description    : String(100);  // 'Fuel uplift - into plane'

        valid_from     : Date @mandatory;
        valid_to       : Date;         // null = open-ended

        is_active      : Boolean default true;

        notes          : String(500);
}


using { fuelsphere as val } from './fifo-valuation';

// ===========================================================================
// THE THREE AGGREGATES THE SCREEN IS BUILT FROM
// ===========================================================================
//
// EXPLICIT JOINS, AND NOT AN ASSOCIATION. The first version of this declared
// an unmanaged association on FUEL_STOCK_MOVEMENT_LEDGER to reach the ROB
// ledger, on the reasoning that unmanaged means no column and no DDL. That
// was wrong, and fifo-valuation-harness EXIT-6 said so in as many words:
//
//     "THE DEMO RUNS ON THE FOB LEDGER. This asserts the isolation that
//      makes the valuation safe to build beside it: no association, no
//      foreign key, nothing that compiles into a join."
//
// The isolation is a property of the VALUATION ENTITY, not of the generated
// SQL. An association on that entity is reachable from every query anyone
// writes against it ever after; a join inside a view over here reaches
// nothing but these three views. Same SQL, and the boundary stays where the
// project put it.
//
// THE JOIN IS reference -> ROB_LEDGER.ID. On an uplift row `reference` holds
// the ROB ledger row's ID; on other line types it holds something else and
// joins to nothing, which is correct - those lines have no ticket. It is a
// String(40) matched against a UUID, which is text against text in both
// databases.
//
// BY DAY, NOT BY PERIOD. No date arithmetic appears in any of them, because
// `month(x)` and `substring(x, 1, 7)` are not the same function in SQLite and
// HANA, and a view that compiles on one and fails on the other is found at
// deploy time, in the worst place. The handler buckets days into periods,
// which is free: it is already holding at most a few thousand rows.
//
// MAP ONLY. FUEL_STOCK_MOVEMENT_LEDGER holds both valuations, so a view that
// forgot this filter would double every figure on the screen - and would do
// it plausibly, which is worse.
//
// AND THEY ARE WHY THIS SCALES. Each is a GROUP BY that HANA executes in its
// column store and returns already summed; the handler never sees a movement
// row. At a million ledger rows the difference is between a few thousand
// summed rows crossing the wire and a million raw ones.

/**
 * Every valued movement, summed by carrier, day and kind.
 *
 * Where block burn, APU burn, adjustments and opening stock come from.
 */
@readonly
view RECON_MOVEMENT_BY_DAY as
    select from val.FUEL_STOCK_MOVEMENT_LEDGER as m {
        m.carrier_code as carrier_code,
        m.flight_date  as flight_date,
        m.line_type    as line_type,
        sum(m.value_usd) as value_usd  : Decimal(15,2),
        sum(m.qty_kg)    as qty_kg     : Decimal(15,3),
        count(*)         as line_count : Integer
    }
    where m.valuation_method = 'MAP'
    group by m.carrier_code, m.flight_date, m.line_type;

/**
 * Uplifts and defuels, summed by carrier, day and S/4 posting status.
 *
 * A NULL STATUS IS A REAL BUCKET, and the biggest one today: it means the
 * ticket has never been sent to S/4. Grouping it away - or reading it as an
 * error - would lose the distinction between "S/4 refused this" and "nobody
 * has tried", which are different problems with different owners. The joins
 * are LEFT for the same reason: an uplift with no ticket must still be
 * counted, in the null bucket, not dropped.
 */
@readonly
view RECON_UPLIFT_BY_DAY as
    select from val.FUEL_STOCK_MOVEMENT_LEDGER as m
        left join db.ROB_LEDGER   as r on r.ID = m.reference
        left join db.FUEL_TICKETS as t on t.ID = r.fuel_ticket.ID
    {
        m.carrier_code         as carrier_code,
        m.flight_date          as flight_date,
        t.s4_posting_status    as posting_status : String(1),
        sum(m.value_usd) as value_usd  : Decimal(15,2),
        sum(m.qty_kg)    as qty_kg     : Decimal(15,3),
        count(*)         as line_count : Integer
    }
    where m.valuation_method = 'MAP'
      and m.line_type in ('UPLIFT', 'DEFUEL')
    group by m.carrier_code, m.flight_date, t.s4_posting_status;

/**
 * Posted uplifts, summed by carrier, flight day and FI posting date.
 *
 * THE ONLY SOURCE FOR "POSTING TO SUBSEQUENT PERIOD". The handler compares
 * the flight day's period with the FI date's period, and the difference is
 * the shift.
 *
 * s4_fi_posting_date IS NULL ON EVERY ROW TODAY, because
 * ZFS_FUEL_POSTING_SRV does not return it - CR-2a in
 * docs/S4_Backend_Change_Requests.md. A posted uplift with no FI date is
 * counted and reported as unplaced rather than silently assumed to be in its
 * own period: assuming would make the column read zero and look answered,
 * when the honest answer is that nobody has told us yet.
 */
@readonly
view RECON_UPLIFT_FI_BY_DAY as
    select from val.FUEL_STOCK_MOVEMENT_LEDGER as m
        left join db.ROB_LEDGER   as r on r.ID = m.reference
        left join db.FUEL_TICKETS as t on t.ID = r.fuel_ticket.ID
    {
        m.carrier_code          as carrier_code,
        m.flight_date           as flight_date,
        t.s4_fi_posting_date    as fi_date : Date,
        sum(m.value_usd) as value_usd  : Decimal(15,2),
        count(*)         as line_count : Integer
    }
    where m.valuation_method = 'MAP'
      and m.line_type in ('UPLIFT', 'DEFUEL')
      and t.s4_posting_status = 'S'
    group by m.carrier_code, m.flight_date, t.s4_fi_posting_date;

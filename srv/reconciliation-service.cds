using { fuelsphere as db } from '../db/fs-reconciliation';
using { fuelsphere as core } from '../db/schema';

/**
 * ReconciliationService - Financials to FuelSphere, period by period.
 *
 * ===========================================================================
 * EVERY FIGURE ON THIS SERVICE IS COMPUTED AT READ TIME. There is no
 * reconciliation table, no snapshot and no overnight job, and that is the
 * central decision - see srv/reconciliation-service.js for how, and this
 * comment for why.
 *
 * A SNAPSHOT WOULD BE A FOURTH NUMBER. The point of the screen is to hold two
 * numbers against each other - what Finance booked, and what FuelSphere
 * recorded - and say why they differ. Storing the FuelSphere side turns it
 * into a number that was true when the job last ran, which is a third thing
 * to reconcile. The one complaint nobody can answer is "the reconciliation
 * disagrees with the ledger it reconciles".
 *
 * IT COSTS LESS THAN IT LOOKS. The aggregation is pushed to the database as
 * GROUP BY - the rows never come up to Node - and what comes back is at most
 * one row per carrier per period, so a dozen. At a million ledger rows this
 * is a handful of grouped scans, not a million rows over the wire.
 *
 * NO LEDGER IS WRITTEN, AND NO LEDGER GAINS A COLUMN. ROB_LEDGER and
 * FUEL_STOCK_MOVEMENT_LEDGER are read-only to this service.
 * ===========================================================================
 */
@path: '/odata/v4/reconciliation'
service ReconciliationService {

    /**
     * FinanceReconciliation - one row per carrier per period.
     *
     * NOT A PROJECTION OF ANYTHING. Declared element by element because it is
     * assembled from four sources - the valued movement ledger, the fuel
     * tickets' S/4 posting status, the G/L account mapping, and the carrier
     * master - and no one of them is the entity's home.
     *
     * READ-ONLY ABSOLUTELY. A reconciliation somebody can type into is not a
     * reconciliation. Every figure here is derived, and the way to change one
     * is to fix what it was derived from.
     */
    @readonly
    @cds.persistence.skip
    entity FinanceReconciliation {

            // 'B6|2026-09', or 'B6|YTD-2026' in year-to-date mode. Synthetic
            // and stable: the object page is reached by it, so it must be the
            // same string on every read of the same row.
        key ID                       : String(40);

            carrier_code             : String(3);
            carrier_name             : String(100);
            company_code             : String(4);

            fiscal_year              : String(4);

            // '2026-09' - sortable, and the same shape in both modes so one
            // column header serves both.
            period                   : String(10);
            period_label             : String(20);   // 'Sep 2026' / 'YTD 2026'

            // MONTHLY or YTD. A REAL ELEMENT, not a screen setting, because
            // the specification puts it in the filter bar - "option YTD and
            // Period wise" - and a filter bar can only filter on elements.
            period_mode              : String(8);

            // ---- the two numbers the screen exists to compare -------------
            //
            // NET UPLIFT (FINANCE BOOKS): the balance of the carrier's fuel
            // G/L accounts for the period.
            //
            // SEEDED FROM THE FUELSPHERE FIGURE TODAY, on instruction: the
            // G/L OData service does not exist yet, and the agreed interim is
            // that this column mirrors the FuelSphere one until it does. It
            // therefore reads as a PERFECT reconciliation, which is exactly
            // what it is not - finance_source below is what stops a reader
            // mistaking the placeholder for agreement, and the screen shows
            // it as a column rather than hiding it in a tooltip.
            net_uplift_finance       : Decimal(15,2);

            // Where that number came from: SEEDED_FROM_FS until the G/L
            // service is connected, S4_GL after. One glance tells a reader
            // whether the variance beside it means anything.
            finance_source           : String(16);

            // NET UPLIFT (FUELSPHERE), figure (a) in the specification: every
            // uplift and defuel in the period, whatever its posting status.
            // This is what FuelSphere believes went into the wing.
            net_uplift_fs            : Decimal(15,2);

            // What Finance SHOULD be carrying if S/4 has everything we sent:
            // the uplifts that posted successfully. Where this and
            // net_uplift_finance differ, the gap is in S/4 or in the G/L
            // mapping; where this and net_uplift_fs differ, the gap is ours.
            net_uplift_expected      : Decimal(15,2);

            // JV PENDING POSTING: uplift value sitting in error or not yet
            // posted. This is the accrual Finance has to book manually at
            // close, and the reason the screen is wanted before close rather
            // than after it.
            jv_pending_posting       : Decimal(15,2);

            // POSTING TO SUBSEQUENT PERIOD, signed. An uplift flown in
            // January whose FI document posted in February appears as +value
            // on January and -value on February, so the two periods net to
            // zero across the year and each one says how much of its own
            // figure landed somewhere else. The worked example on the
            // specification is exactly this: 2,000 on Jan-26 and -2,000 on
            // Feb-26, because Jan was already closed on 10 February.
            posted_subsequent_period : Decimal(15,2);

            // POSTED, BUT WE CANNOT SAY INTO WHICH PERIOD.
            //
            // THE HONEST COMPANION TO THE COLUMN ABOVE. "Posted in next
            // period" reads zero today, and a zero there has two completely
            // different meanings: nothing shifted, or S/4 never told us when
            // anything posted. Without this pair the screen cannot tell them
            // apart, and the reader would take the first - which is the
            // comfortable reading and currently the wrong one.
            //
            // It empties itself the day CR-2a lands.
            unplaced_posting_value   : Decimal(15,2);
            unplaced_posting_count   : Integer;

            // ---- what the fuel was used for -------------------------------
            opening_stock_value      : Decimal(15,2);
            block_burn               : Decimal(15,2);   // (b)
            apu_burn                 : Decimal(15,2);   // (c)

            // (d) - adjustments, transfers, defuels and jettison. The
            // specification calls this "Other Fuel Allocations (manual burn
            // adjustments, Jettision etc)".
            other_allocations        : Decimal(15,2);

            total_allocated          : Decimal(15,2);   // b + c + d
            remaining_stock          : Decimal(15,2);   // closing stock AS RECORDED

            // UNALLOCATED BURN - the number the whole screen is built around.
            //
            //   opening + net uplift - block - APU - other - closing
            //
            // THE SPECIFICATION WRITES IT AS a - b - c - d, which is the same
            // identity with the stock terms left out because its worked
            // example opens and closes at zero. They cannot be left out here:
            // a carrier holding 1.5m USD of fuel at period start would show
            // the whole of it as unallocated burn.
            //
            // IT IS ZERO WHEN THE LEDGER IS INTERNALLY CONSISTENT, and that
            // is the point. It goes non-zero when recorded stock and recorded
            // movements disagree - fuel that left the tanks with nothing
            // saying where it went.
            unallocated_burn         : Decimal(15,2);

            // net_uplift_finance - net_uplift_fs. Meaningless while
            // finance_source is SEEDED_FROM_FS, which is why they travel
            // together.
            finance_variance         : Decimal(15,2);

            currency_code            : String(3);

            // ---- counts, so a figure can be challenged --------------------
            uplift_count             : Integer;
            posted_count             : Integer;
            pending_count            : Integer;

            // Red when fuel is unaccounted for, amber when the gap is small
            // enough to be rounding. Computed in the handler against a
            // tolerance relative to the period's own turnover, rather than a
            // flat number that would be noise at one carrier and blindness at
            // another.
            unallocatedCriticality   : Integer;
            varianceCriticality      : Integer;

            // ---- the drill-down -------------------------------------------
            //
            // "Drill down in any row shows the GL level recon (Will share
            // details subsequently)." The G/L-level specification has not
            // arrived, so the drill-down is built from what IS knowable: the
            // accounts this carrier's fuel should land in, and the individual
            // uplifts making up the figure. Both are filled by the handler on
            // a by-key read only - a list of twelve rows does not pay for
            // twelve thousand uplift lines.
            gl_accounts              : Association to many ReconciliationGlLine
                                           on gl_accounts.recon_ID = ID;
            uplift_lines             : Association to many ReconciliationUpliftLine
                                           on uplift_lines.recon_ID = ID;
    }

    /**
     * One G/L account that should have received this period's fuel.
     *
     * THE EXPECTED SIDE ONLY, today. FuelSphere knows what it posted and to
     * which account role; it does not yet know what Finance actually booked,
     * because that is the G/L service nobody has built. booked_value is
     * therefore null rather than zero - a null reads as "not known", and a
     * zero would read as "nothing was booked", which is a different and
     * unfounded claim.
     */
    @readonly
    @cds.persistence.skip
    entity ReconciliationGlLine {
        key ID             : String(60);
            recon_ID       : String(40);
            gl_account     : String(10);
            account_role   : String(16);
            description    : String(100);
            company_code   : String(4);
            expected_value : Decimal(15,2);
            booked_value   : Decimal(15,2);   // null until the G/L service exists
            variance       : Decimal(15,2);
            currency_code  : String(3);
    }

    /**
     * One uplift behind the period figure, with what S/4 did to it.
     *
     * THIS IS THE DRILL-DOWN THAT ANSWERS THE QUESTION PEOPLE ACTUALLY ASK.
     * "JV pending posting is 19.8 million" is not actionable; "these 1,757
     * tickets have never been sent to S/4" is. It is capped - see the
     * handler - because a period can hold tens of thousands of uplifts and a
     * drill-down nobody can load is a drill-down nobody uses.
     */
    @readonly
    @cds.persistence.skip
    entity ReconciliationUpliftLine {
        key ID                 : String(60);
            recon_ID           : String(40);
            ticket_number      : String(50);
            internal_number    : String(30);
            tail_number        : String(10);
            station            : String(3);
            flight_number      : String(10);
            flight_date        : Date;
            qty_kg             : Decimal(15,3);
            qty_cm             : Decimal(15,3);   // the same mass in the carrier's mass unit
            mass_uom_code      : String(3);       // that unit (LB for B6)
            value_usd          : Decimal(15,2);
            posting_status     : String(16);   // POSTED | ERROR | NOT_SENT
            s4_po_number       : String(10);
            s4_message         : String(220);
            fi_period          : String(10);   // the period the FI document landed in
            is_period_shifted  : Boolean;
            statusCriticality  : Integer;
            currency_code      : String(3);
    }

    /**
     * The G/L account mapping, maintained rather than derived.
     *
     * THE ONLY WRITEABLE THING ON THIS SERVICE, and it is master data: which
     * accounts a carrier's fuel lands in. Everything else here is computed
     * from the ledgers, and computed figures are not editable.
     */
    entity ReconGlAccounts as projection on db.RECON_GL_ACCOUNTS {
        *,
        // THE FOREIGN KEY, NAMED. Without this the only way to put the
        // carrier in a column is carrier_carrier_code, which exists in the
        // generated OData and not in the CDS model - so every annotation on
        // it compiles with a warning and is one rename away from silently
        // annotating nothing.
        carrier.carrier_code as carrier_code : String(3)
    };

    @readonly
    entity Carriers as projection on core.CARRIER_MASTER;
}

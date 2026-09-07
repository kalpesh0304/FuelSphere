/**
 * FuelSphere — UNBILLED TICKETS
 *
 * DELIVERED FUEL WITH NO INVOICE LINE, so a later period cannot double-pay
 * it. 02-BEHAVIOUR's "Unbilled exposure", and INV453 in 03-VALIDATION-RULES.
 *
 * =========================================================================
 * INV453 WAS NEVER BUILT — NOT DROPPED. MEASURED, NOT ASSUMED.
 * =========================================================================
 *
 * `git log --all -S'INV453'` returns ONE commit, and it is the one that
 * added 03-VALIDATION-RULES.md itself. The code has never carried it, and
 * INVOICE_CHECK_REGISTRY has never held a row for it - not even a row with
 * is_implemented = false, which is the mechanism that entity has for
 * recording exactly this. So the registry says 22 rules and the
 * specification names 23, and nothing anywhere records the difference.
 *
 * The instrument was proved first: the same search finds INV469 in the
 * WP-21A seed commit.
 *
 * IT IS NOT BUILT HERE EITHER. A check is not a card: INV453 belongs in the
 * registry and in runChecks, where it would raise a WARNING against an
 * invoice at period close. This screen READS the exposure; the check would
 * RAISE it. Recorded so the gap is a decision rather than an oversight.
 *
 * =========================================================================
 * THE THREE STATES, AND WHY UNBILLABLE IS ITS OWN
 * =========================================================================
 *
 *   BILLED      an invoice line references this ticket                14
 *   UNBILLED    no invoice line, but the ticket has an order          12
 *   UNBILLABLE  no invoice line AND NO ORDER                           4
 *
 * The third is not a refinement of the second. An UNBILLED ticket is money
 * a supplier has not yet asked for; an UNBILLABLE one is fuel that reached
 * an aircraft with nothing in FuelSphere authorising it, and no PO for any
 * invoice to ever match. Collapsing them puts the worst rows in the set
 * among the merely late ones.
 *
 * WP-10 deliberately allows a ticket without an order, so UNBILLABLE is a
 * legitimate state rather than a data error - and it is the state this
 * screen exists to surface.
 *
 * =========================================================================
 * WHY `case when exists` AND NOT A JOIN
 * =========================================================================
 *
 * A left join to INVOICE_ITEMS DUPLICATES a ticket billed on two lines, and
 * two tickets in the seed are: WFS-YYZ-20260410-11 and WFS-YYZ-2026041408,
 * one of them the deliberately seeded INV455 double-billing. A join would
 * report 32 rows for 30 tickets and count the duplicate twice in any
 * coverage figure. Measured before choosing.
 *
 * The association is on ticket_ID, and that is COMPLETE: the only invoice
 * line carrying a ticket_number without a ticket_ID names
 * WFS-YYZ-NOSUCH-9999, which is the INV462 "ticket not found" scenario and
 * matches no ticket by design.
 */
namespace fuelsphere;

using { fuelsphere as db } from './schema';

// The reverse of the link INVOICE_ITEMS already carries. Declared here
// rather than in schema.cds because schema.cds cannot see a file that
// imports it - the dependency runs one way.
extend db.FUEL_TICKETS with {
    invoice_lines : Association to many db.INVOICE_ITEMS
                    on invoice_lines.ticket = $self;
};

entity UNBILLED_TICKETS as select from db.FUEL_TICKETS as t {
    key t.ID,

        t.ticket_number,
        t.internal_number,
        t.supplier_ticket_ref,

        // THE STATE. Three values, mutually exclusive, exhaustive.
        case
            when exists t.invoice_lines then 'BILLED'
            when not exists t.order     then 'UNBILLABLE'
            else                             'UNBILLED'
        end as billing_state : String(12),

        // A READING ORDER, NOT THE ALPHABET. 'BILLED' < 'UNBILLABLE' <
        // 'UNBILLED' is alphabetically true and puts the settled rows first
        // and the worst rows in the middle - right by accident and wrong the
        // day a state is added. UNBILLABLE first because nobody can bill it
        // at all; UNBILLED second because somebody still might.
        case
            when not exists t.order and not exists t.invoice_lines then 1
            when not exists t.invoice_lines                        then 2
            else                                                        3
        end as state_rank : Integer,

        // AGEING. Days since the fuel went on the aircraft.
        //
        // ONE CLOCK, AND THE SECOND ONE IS ABSENT. 02-BEHAVIOUR §"Claim
        // windows are deadlines, not ageing" specifies a written claim
        // within 15 days and quality defects within 30, after which the
        // right is WAIVED - and a claim window sorts by TIME REMAINING
        // while ageing sorts oldest-first. They are different clocks and
        // both belong on this screen.
        //
        // NOTHING MODELS A CLAIM WINDOW. Swept form-agnostically across
        // db/ and srv/: no claim_window, claim_deadline, claim_type,
        // notification_deadline or any window-shaped field, and no contract
        // entity to hang one on. The three "claim"/"waive" hits are
        // comments about exception bypass.
        //
        // So this ships with ageing alone and the absence stated, rather
        // than an ageing report quietly presented as covering deadlines -
        // which is the failure mode: the oldest row sits at the top while
        // the one expiring today falls through.
        // SORTING IS ON THE TIMESTAMP, NOT ON A COMPUTED AGE, AND THAT IS
        // NOT A COMPROMISE: ascending delivery_timestamp IS oldest-first,
        // identically, with no function call.
        //
        // `days_between(t.delivery_timestamp, $now)` COMPILED CLEAN AND DID
        // NOT SERVE - "no such function: days_between" on SQLite, which is
        // a HANA function @cap-js/sqlite does not implement. `julianday`
        // works on SQLite and would break on HANA, so it is worse: it would
        // pass every check here and fail on the production profile.
        //
        // The displayed number is a VIRTUAL element filled in an after-READ
        // handler. D52's trade-off, taken deliberately: a virtual element
        // CANNOT be $filtered or $orderby'd, because those run in the
        // database before the handler sees the row. That is acceptable here
        // ONLY because the sort is on delivery_timestamp and gives the same
        // order. Anyone adding an age filter must move this into the view.
        t.delivery_timestamp,
        virtual null as age_days : Integer,

        // KILOGRAMS LEAD. Money follows mass, not count: sixteen unbilled
        // tickets could be sixteen small top-ups or one widebody uplift,
        // and the mass is the exposure regardless of how many pieces of
        // paper it arrived on. The count is the WORK; the mass is the MONEY.
        t.quantity_kg,
        t.uom_code,
        t.quantity_metered,

        // AN ESTIMATE, AND IT IS MARKED AS ONE.
        //
        // The order's unit price is what FuelSphere expects to be charged,
        // not what a supplier has charged - nothing has been invoiced, so
        // there is no actual. Presenting it unmarked would put a number in
        // a money column that no document supports.
        //
        // NULL WHERE NOTHING RESOLVES, NEVER ZERO. An UNBILLABLE ticket has
        // no order, so no supplier and no contract, so no price - the same
        // "no price resolves" the mockup carries. And SUP-MNL-12004 has no
        // quantity either, so it cannot be estimated by mass OR by value:
        // the one row in the set that is unquantified in both directions.
        t.order.unit_price                     as est_unit_price : Decimal(15,4),
        t.quantity_kg * t.order.unit_price     as est_value      : Decimal(15,2),
        t.order.currency_code                  as est_currency   : String(3),
        case
            when not exists t.order        then 'NO_ORDER'
            when t.order.unit_price is null then 'NO_PRICE'
            when t.quantity_kg is null      then 'NO_QUANTITY'
            else                                 'ORDER_PRICE'
        end as est_basis : String(12),
        t.flight_number,
        t.aircraft_reg,
        t.match_status,

        // THE STATION, AND THE THREE THAT CANNOT REACH ONE.
        //
        // FUEL_TICKETS carries no station of its own; it resolves through
        // the order. Three tickets have no order - the UNBILLABLE ones -
        // so a station filter cannot cover the rows this screen is FOR.
        //
        // NOT SOLVED BY DENORMALISING A STATION ONTO THE TICKET. That is
        // the same shape as "no order means no supplier means no price":
        // the station is genuinely unknown, and inventing one would assert
        // a fact nobody has.
        //
        // So they are made VISIBLE as UNKNOWN rather than excluded. An
        // unmatched uplift with no station is still a finding - somebody
        // put fuel in an aircraft somewhere and nobody knows where - and
        // excluding it from a station-filtered view hides the worst row in
        // the set.
        coalesce(t.order.station_code, 'UNKNOWN') as station_code : String(10),

        t.order,
        t.delivery,
        t.tail
};

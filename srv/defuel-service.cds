using { fuelsphere as db } from '../db/defuel';
using { fuelsphere as core } from '../db/schema';

/**
 * DefuelService — recording a defuel, and settling it.
 *
 * ===========================================================================
 * SEPARATE FROM DefuelConfigService, and the split is by AUDIENCE rather than
 * by subject. Locations, reason codes and the G/L mapping are maintained
 * before any defuel happens, by operations and finance; this is what a
 * station user and a controller do day to day. A tile that could edit the G/L
 * mapping from the defuel screen would be a finance control reachable from an
 * operations queue.
 *
 * MAP CARRIERS ONLY, DELIBERATELY AND VISIBLY. The valuation method is set
 * per carrier and defaults to FIFO (BR D1), but FIFO layers in this system
 * are produced by an offline replay rather than maintained live — see
 * docs/design/defuel-discovery.md §0.5. A defuel on a FIFO carrier therefore
 * has a value nobody can currently produce, and it is REFUSED with DFL407
 * rather than quietly valued as a moving average. A wrong value that looks
 * right is worse than a refusal that explains itself.
 * ===========================================================================
 */
@path: '/odata/v4/defuel'
service DefuelService {

    /**
     * The defuel itself.
     *
     * DRAFT-ENABLED, because this is a capture screen with ten fields that
     * depend on each other — the uplift governs the price, the movement type
     * governs whether an uplift is needed at all, and a half-entered defuel
     * must not reach the ledger. Draft is also what puts Create on the list.
     */
    @odata.draft.enabled
    entity Defuels as projection on db.DEFUEL {
        *,
        tail          : redirected to Tails,
        flight        : redirected to Flights,
        carrier       : redirected to Carriers,
        reason        : redirected to ReasonCodes,
        location      : redirected to Locations,
        source_ticket : redirected to SourceTickets,
        vendor        : redirected to Vendors,
        ledger_entries : redirected to DefuelLedgerEntries,
        settlements    : redirected to DefuelSettlements,

        // DISPLAY VALUES, NOT FOREIGN KEYS. A generated foreign key exists in
        // the OData metadata and NOT in the CDS model, so annotating one
        // compiles with a warning and is one rename away from annotating
        // nothing. Aliasing it to its own name is worse — it collides with
        // the generated element and fails to compile at all.
        //
        // So these carry what a reader wants to SEE. The carrier is already
        // a real stored field on DEFUEL and needs no alias; the reason's
        // code is its generated key, so the description is aliased instead.
        reason.description as reason_text   : String(100),
        location.code      as location_code : String(20),
        vendor.supplier_name as vendor_name : String(100),

        // ---- what a reader needs without opening the row ------------------
        //
        // DERIVED ON READ, not stored. A stored flag is a second truth that
        // drifts the moment a settlement lands; these follow the data.
        //
        // Every branch is a PREDICATE, which HANA requires: a bare column as
        // a CASE condition compiles on SQLite and fails the HANA view builder
        // with "incorrect syntax near THEN" — already paid for twice here.
        case
            when status = 'PARKED'      then 2
            when status = 'SETTLED'     then 3
            when status = 'WRITTEN_OFF' then 1
            when status = 'REVERSED'    then 0
            when status = 'ERROR'       then 1
            else                             0
        end as statusCriticality : Integer,

        // The unsettled remainder. R5.11 settles a parcel in parts, so "what
        // is still open" is the held value less what settlement has taken —
        // not a flag, and not the held value itself.
        case
            when is_reversed = true then 0
            else coalesce(held_value_usd, 0) - coalesce(settled_value_usd, 0)
        end as open_value_usd : Decimal(15,2)
    } actions {

        /**
         * Record it and leave the commercial outcome open (R10.3, R5.9).
         *
         * A parked item has left the tail and sits in the location at a known
         * value with the outcome unknown. It is a real position on the books,
         * which is why it is the thing month end accrues (D7a, and your Q4
         * answer: only parked items accrue, because once posted the Expected
         * Credit account carries the receivable).
         */
        action park() returns Defuels;

        /**
         * Settle some or all of it (R5.11, D5a).
         *
         * ONE DEFUEL, MANY SETTLEMENTS. A vendor may credit part of a parcel
         * and decline the rest, or settle across two credit memos a month
         * apart — so the location's balance falls as each lands rather than
         * clearing in one step.
         *
         * credit_usd ABOVE THE OPEN VALUE IS REFUSED (DFL404, R5.5/D2): it
         * would turn a loss into a profit on a transaction where the airline
         * lost money, and it is a data-entry error every time.
         */
        action settle(
            @title: 'Quantity to settle (kg)' quantity_kg : Decimal(15,3),
            @title: 'Credit agreed with the vendor' credit_usd : Decimal(15,2),
            @title: 'Credit memo reference' credit_memo : String(40),
            @title: 'Note' note : String(500)
        ) returns Defuels;

        /**
         * Write off what is left (R10.7, R5.8).
         *
         * Reachable at any point, because the alternative is a stale balance:
         * vendors decline, negotiations lapse, fuel sits too long to be worth
         * taking back. The write-off is the honest end of those stories.
         */
        action writeOff(
            @title: 'Reason' reason : String(500)
        ) returns Defuels;

        /**
         * Reverse it (D6a, R1.6).
         *
         * REFUSED ONCE ANY SETTLEMENT EXISTS (DFL405), per the answer of
         * 23 Oct. Reversing a defuel whose credit is already agreed would
         * change a commercial document without the vendor knowing; the
         * settlement is cancelled first.
         *
         * The reversal KEEPS THE ORIGINAL EVENT TIME (R1.9). It puts right
         * the record of an event rather than recording a new one, so it sits
         * at the original position in the chain and only the quantity moves.
         * Stamped at the moment the error was noticed, every balance between
         * the two would compute as though the fuel left the tank later than
         * it did — wrong in the middle, right at the end.
         */
        action reverse(
            @title: 'Reason' reason : String(500)
        ) returns Defuels;
    };

    /**
     * The location ledger behind one defuel.
     *
     * READ-ONLY ABSOLUTELY. Every row is written by a movement; a row typed
     * here would be fuel in a tank that nothing put there.
     */
    @readonly
    entity DefuelLedgerEntries as projection on db.DEFUEL_LEDGER_ENTRY;

    /**
     * The settlement events behind one defuel. Read-only for the same reason
     * — a settlement is produced by the action, never typed.
     */
    @readonly
    entity DefuelSettlements as projection on db.DEFUEL_SETTLEMENT;

    // ---- value helps -------------------------------------------------------
    //
    // ALL READ-ONLY. A defuel screen that could edit the aircraft register
    // would be a master-data screen wearing an operations tile.
    @readonly entity Tails         as projection on core.AIRCRAFT_REGISTRATIONS;
    @readonly entity Flights       as projection on core.FLIGHT_SCHEDULE;
    @readonly entity Carriers      as projection on core.CARRIER_MASTER;
    @readonly entity Vendors       as projection on core.MASTER_SUPPLIERS;
    @readonly entity ReasonCodes   as projection on db.DEFUEL_REASON_CODE;
    @readonly entity Locations     as projection on db.STORAGE_LOCATION;

    /**
     * The uplifts a defuel can be taken against (M1, R4.1).
     *
     * Carries the quantity already defuelled, because R1.5 is a CUMULATIVE
     * test: two defuels of 2,000 against a 3,000 uplift must fail on the
     * second, and the message must say what was already taken. Checking each
     * defuel against the uplift in isolation would let the uplift be handed
     * back twice.
     */
    @readonly
    entity SourceTickets as projection on core.FUEL_TICKETS {
        ID, ticket_number, internal_number, aircraft_reg, flight_number,
        quantity, uom_code, delivery_timestamp
    };
}

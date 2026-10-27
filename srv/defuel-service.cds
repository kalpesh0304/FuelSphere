using { fuelsphere as db } from '../db/defuel';
using { fuelsphere as core } from '../db/schema';

/**
 * DefuelService — fuel off an aircraft and into a tank on the ground.
 *
 * ===========================================================================
 * SEPARATE FROM DefuelConfigService, and the split is by AUDIENCE rather than
 * by subject. Locations, reason codes and the G/L mapping are maintained
 * before any defuel happens, by operations and finance; this is what a
 * station user does day to day. A tile that could edit the G/L mapping from
 * the defuel screen would be a finance control reachable from an operations
 * queue.
 *
 * REDESIGNED 26 Oct 2026, AND THIS REVERSES A STANDING DECISION. The service
 * that stood here REFUSED a defuel on a FIFO carrier with DFL407, on the
 * grounds that FIFO layers were produced by an offline replay and so a FIFO
 * defuel had a value nobody could produce. The instruction now is that a
 * defuel draws from the tail's FIFO layers at those layers' own rates, and
 * that it is valued under BOTH methods exactly as every uplift and burn in
 * this ledger already is. So the layers are maintained live from here on, and
 * DFL407 is gone rather than left to fire on the normal path.
 *
 * WHAT A POSTING WRITES: two rows per method per layer touched. Out of the
 * tail at the layer's rate, in to the storage location at the same rate,
 * carrying the same batch. The fuel keeps the price it was bought at, which
 * is what lets it be re-uplifted later at that price rather than at whatever
 * the pool averages to that week.
 * ===========================================================================
 */
@path: '/odata/v4/defuel'
service DefuelService {

    /**
     * The defuel itself.
     *
     * DRAFT-ENABLED, because this is a capture screen whose fields depend on
     * one another — the source mode governs whether a flight is needed, the
     * flight fills four more fields, and a half-entered defuel must not reach
     * the valuation ledger. Draft is also what puts Create on the list: an
     * entity that is merely not @readonly gets no Create button, which this
     * project has already learned the slow way.
     */
    @odata.draft.enabled
    entity Defuels as projection on db.DEFUEL {
        *,
        tail      : redirected to Tails,
        flight    : redirected to Flights,
        carrier   : redirected to Carriers,
        supplier  : redirected to Vendors,
        location  : redirected to Locations,

        // Flattened for the list and the filter bar. A generated foreign key
        // cannot carry a @title, so a column that needs a label needs a real
        // element behind it — the filter bar printed a raw "reason_code" on
        // the configuration app for exactly this reason.
        location.description as location_name   : String(100),

        // THE TOTAL A STATION USER IS ASKED ABOUT. Charges and taxes are
        // what the handling cost; they are deliberately NOT folded into
        // fuel_value_usd, which is what the fuel itself is worth.
        (coalesce(defuel_charges_usd, 0) + coalesce(taxes_usd, 0))
            as total_charges_usd : Decimal(15,2)
    } actions {

        /**
         * Reverse a posted defuel.
         *
         * KEPT FROM THE OLD DESIGN because a mis-keyed defuel is the one
         * thing a station user cannot fix by editing: the ledger rows are
         * already written. Everything else from the settlement model is
         * gone.
         */
        action reverse(reason : String(500) @title: 'Reason') returns Defuels;

        /**
         * Post a defuel to the supplier.
         *
         * ONE FIGURE IS TYPED, and only one. The original value of the fuel
         * is what the layers it came from were bought at - FuelSphere already
         * knows it, and offering it for editing would invite somebody to make
         * the ledger and the claim disagree. The write-off is the difference
         * and is likewise calculated.
         *
         * WHAT THE EXPECTED CREDIT IS: what the vendor has agreed to return
         * for fuel they took back. It is a negotiation, not a calculation,
         * which is why it is the one thing a human states.
         *
         * ONLY FOR A DEFUEL TO A SUPPLIER. Fuel sitting in a storage tank is
         * still the airline's; there is nobody to claim from.
         */
        action postToSupplier(
            expected_credit_usd : Decimal(15,2) @title: 'Expected Credit (USD)' @mandatory
        ) returns Defuels;
    };

    // ---- the pickers --------------------------------------------------
    //
    // ALL READ-ONLY. A defuel screen that could edit the aircraft register
    // would be a master-data screen wearing an operations tile.
    // THE TWO CHOICES, as rows for the dropdowns to read. Fixed-value lists:
    // two rows each, so Fiori Elements renders a select rather than a dialog.
    @readonly entity DefuelTypes as projection on db.DEFUEL_TYPE_CODE;
    @readonly entity DefuelModes as projection on db.DEFUEL_MODE_CODE;

    @readonly entity Tails       as projection on core.AIRCRAFT_REGISTRATIONS;
    @readonly entity Carriers    as projection on core.CARRIER_MASTER;
    @readonly entity Vendors     as projection on core.MASTER_SUPPLIERS;
    @readonly entity ReasonCodes as projection on db.DEFUEL_REASON_CODE;

    /**
     * Storage locations, for the destination F4.
     *
     * Carries location_type so the picker can show whether a tank is a
     * DEFUEL tank (awaiting vendor return, no uplift out) or a TEMP one
     * (held for re-uplift). The user chooses the destination knowing which
     * it is, rather than discovering it when an uplift is refused later.
     */
    @readonly entity Locations as projection on db.STORAGE_LOCATION {
        ID, code, description, station_code, location_type,
        capacity_kg, is_active
    };

    /**
     * The flights a defuel can be referenced to.
     *
     * SELECTING ONE FILLS FOUR FIELDS — station, date, carrier and tail —
     * so those four cannot disagree with the schedule. Both airports are
     * carried because the fuel may come off at either end of the leg.
     */
    /**
     * The tails a defuel can be recorded against.
     *
     * FROM THE SCHEDULE, NOT THE REGISTER, as asked on 26 Oct. The register
     * carries every airframe the airline has ever held; the schedule carries
     * the ones flying this window, which is what a station user is choosing
     * between. Distinct, because a tail flies many legs.
     */
    // GROUP BY, NOT DISTINCT: this compiler rejects `select distinct from`,
    // and grouping gives the same one-row-per-tail with a usable key.
    @readonly entity FlightTails as
        select from core.FLIGHT_SCHEDULE {
            key aircraft_reg as registration : String(10),
                max(airline_code) as carrier_code : String(3)
        }
        where aircraft_reg is not null
        group by aircraft_reg;

    @readonly entity Flights as projection on core.FLIGHT_SCHEDULE {
        ID, flight_number, flight_date, airline_code,
        aircraft_reg,
        origin_airport, destination_airport,
        scheduled_departure, scheduled_arrival, status
    };

    /**
     * What the tail is currently holding, by batch.
     *
     * READ-ONLY AND FOR THE SCREEN'S BENEFIT: it is what the quantity is
     * checked against, and what the weighted specific gravity is computed
     * from. A user about to defuel 3,000 kg should be able to see that the
     * tail holds 2,500 before the validation says so.
     */
    @readonly entity TailStock as projection on core.FUEL_STOCK_BALANCE {
        ID, valuation_method, tail_number, batch_ref, storage_location,
        carrier_code, line_type, station, flight_number, flight_date,
        balance_qty_kg, specific_gravity, rate_usd_per_kg, value_usd
    };
}

/**
 * FuelSphere - infer the burn between two uplifts and post it to the ROB ledger.
 *
 * THE BURN IS NEVER MEASURED, IT IS THE GAP BETWEEN TWO READINGS. Nothing on a
 * fuel ticket says how much fuel a flight consumed. What the tickets DO say is
 * how much was on board when refuelling finished at the departure station, and
 * how much was on board when refuelling began at the next one. The difference
 * is what the aircraft burned getting there:
 *
 *     burn = fuel on board after the previous uplift
 *          - fuel on board before this one
 *
 * So the burn for a leg becomes knowable only when the NEXT ticket for the same
 * tail is captured. That is why this posts on ticket creation and back-dates
 * the row onto the PREVIOUS flight - the fuel was consumed on that leg, not on
 * the one whose ticket triggered the posting. Sorted by flight date with
 * FLIGHT ordered after UPLIFT (see LINE_ORDER), the burn lands directly beneath
 * the uplift it followed, which is how the ledger is read.
 *
 * VALUATION FOLLOWS THE SIGNED-OFF RULE and deliberately mirrors
 * rob-recalculate.js line for line: a burn consumes at the PREVAILING moving
 * average price and therefore does not move it. Only an uplift moves the MAP.
 * If the two disagreed, pressing Re-Calculate would silently rewrite balances
 * that were already correct.
 *
 * WHERE THE "FUEL ON BOARD BEFORE" FIGURE COMES FROM, in order:
 *
 *   1. the linked delivery's fob_before_kg - the aircraft's own gauge, in
 *      kilograms, which is what schema.cds means by the gauge pair
 *   2. the ticket's meter_start, converted to kilograms
 *
 * Reading (2) as a fuel-on-board figure is a reinterpretation of that column,
 * which schema.cds documents as the BOWSER totaliser. It is here because the
 * capture screens show Meter Start / Meter End and an operator working
 * ticket-first has nowhere else to put the gauge. Where a delivery exists its
 * gauge wins, because that column means fuel on board and nothing else.
 *
 * IT DOES NOT POST WHERE IT CANNOT BE HONEST - same rule as rob-uplift.js. No
 * previous position, no reading, or a difference that is not a consumption and
 * there is no row. A burn of zero is not a burn, and a NEGATIVE one is fuel
 * that appeared from nowhere: that is a data problem to be seen, not to be
 * written into a balance as if it were a movement.
 */

const cds = require('@sap/cds');
const { SELECT, INSERT } = cds.ql;
const { LINE_ORDER } = require('./rob-recalculate');

const LEDGER     = 'fuelsphere.ROB_LEDGER';
const DELIVERIES = 'fuelsphere.FUEL_DELIVERIES';

const num   = (v) => (v === null || v === undefined ? null : Number(v));
const money = (v) => Number(Number(v).toFixed(2));
const kg    = (v) => Number(Number(v).toFixed(2));

/**
 * Kilograms per unit of the ticket's own uom_code.
 *
 * Taken as the ratio the TICKET ITSELF was converted at, not re-derived from
 * density and uom. ticket-measurement.js already resolved gallons, cubic
 * metres, KGL against KGM and the rest; re-deriving here would be a second
 * implementation of that arithmetic, free to disagree with the first. Where the
 * ticket is already in a mass unit the ratio is 1 and the reading passes
 * through untouched.
 */
function massFactor(ticket) {
    const mass = num(ticket.quantity_kg);
    if (!mass || mass <= 0) return null;
    const metered = num(ticket.quantity_metered) || num(ticket.quantity);
    if (!metered || metered <= 0) return null;
    return mass / metered;
}

/**
 * Fuel on board immediately before this ticket's uplift, in kilograms.
 * @returns {Promise<{value: number|null, basis: string}>}
 */
async function fuelOnBoardBefore(ticket) {
    if (ticket.delivery_ID) {
        const d = await cds.db.run(SELECT.one.from(DELIVERIES)
            .columns('fob_before_kg').where({ ID: ticket.delivery_ID }));
        const gauge = d ? num(d.fob_before_kg) : null;
        if (gauge !== null && gauge >= 0) return { value: kg(gauge), basis: 'gauge' };
    }

    const start = num(ticket.meter_start);
    if (start === null || start < 0) return { value: null, basis: 'none' };

    const factor = massFactor(ticket);
    if (factor === null) return { value: null, basis: 'none' };
    return { value: kg(start * factor), basis: 'meter' };
}

/**
 * Post the burn that preceded this ticket's uplift, if one can be established.
 *
 * Called from postTicketUplift BEFORE the uplift row is written, so the uplift
 * reads the burn as its opening balance rather than the stale position from
 * the previous flight.
 *
 * @param {object} ticket  the activated ticket row
 * @param {string} tail    tail number, already resolved by the caller
 * @returns {Promise<{ID: string|null, reason: string|null, qty: number|null}>}
 */
async function postPrecedingBurn(ticket, tail) {
    // The tail's current position. This is "fuel on board after the previous
    // uplift" - the ledger already holds it in kilograms, so it needs no
    // conversion and no second reading of the previous ticket.
    const prev = await cds.db.run(SELECT.one.from(LEDGER)
        .columns('ID', 'closing_rob_kg', 'balance_value_usd', 'map_usd_per_kg',
                 'record_date', 'record_time', 'sequence', 'flight_ID', 'sector',
                 'fuel_order_ID', 'max_capacity_kg', 'aircraft_type_code',
                 'tail_registration')
        .where({ tail_number: tail })
        .orderBy('record_date desc', 'record_time desc', 'sequence desc'));

    // Nothing to consume. The first uplift for a tail has no leg before it.
    if (!prev) return { ID: null, reason: null, qty: null };

    // Two tickets against the same leg - a second supplier, a top-up, a
    // correction. No flight happened between them, so no fuel was burned.
    if (prev.flight_ID && ticket.flight_ID && prev.flight_ID === ticket.flight_ID) {
        return { ID: null, reason: null, qty: null };
    }

    const { value: fobBefore, basis } = await fuelOnBoardBefore(ticket);
    if (fobBefore === null) {
        return { ID: null, reason:
            'the burn for the previous leg is unknown - enter Meter Start (fuel on board before uplift) on the ticket', qty: null };
    }

    const opening = num(prev.closing_rob_kg) || 0;
    const burnKg = kg(opening - fobBefore);

    // Defensive only: postTicketUplift's own idempotency check returns before
    // this is ever reached a second time for the same ticket, and both inserts
    // share one transaction so a half-written pair cannot survive. Keyed on the
    // POSITION rather than on a ticket because the row deliberately carries no
    // ticket link (see fuel_ticket_ID below) - one burn per tail, per date, per
    // opening balance, which a re-post reproduces identically.
    const existing = await cds.db.run(SELECT.one.from(LEDGER).columns('ID').where({
        tail_number: tail, entry_type: 'FLIGHT',
        record_date: prev.record_date, opening_rob_kg: opening
    }));
    if (existing) return { ID: null, reason: null, qty: null };

    // Not a consumption. Either the readings agree, or the aircraft is holding
    // MORE fuel than the ledger says it should - which is a discrepancy to
    // investigate, not a negative burn to post.
    if (burnKg <= 0) {
        return { ID: null, reason: burnKg < 0
            ? `fuel on board before this uplift (${fobBefore} kg) is higher than the ledger balance (${opening} kg) - no burn posted`
            : null, qty: null };
    }

    // Consumed at the prevailing MAP, which is therefore carried forward
    // unchanged. A burn before any priced uplift consumes at zero.
    const atMap = num(prev.map_usd_per_kg);
    const rate = atMap === null ? 0 : atMap;
    const value = money(burnKg * rate);
    const openingValue = num(prev.balance_value_usd) || 0;
    const balanceValue = money(openingValue - value);

    // The previous leg's date and sector: that is the flight that burned it.
    const recordDate = prev.record_date;
    const recordTime = prev.record_time;

    // Must sort AFTER the uplift it follows. Same date and time as that row,
    // so the tie breaks on sequence - hence the next sequence for the day
    // rather than a fixed increment on prev, which would collide where the
    // tail already has later rows against the same date.
    const lastOfDay = await cds.db.run(SELECT.one.from(LEDGER)
        .columns('sequence')
        .where({ tail_number: tail, record_date: recordDate })
        .orderBy('sequence desc'));
    const sequence = lastOfDay ? (lastOfDay.sequence || 0) + 1 : 1;

    const maxCapacity = num(prev.max_capacity_kg);
    const robPct = (maxCapacity && maxCapacity > 0)
        ? Number(((fobBefore / maxCapacity) * 100).toFixed(2)) : null;

    const ID = cds.utils.uuid();
    await cds.db.run(INSERT.into(LEDGER).entries({
        ID,
        aircraft_type_code: prev.aircraft_type_code || null,
        tail_number: tail,
        tail_registration: prev.tail_registration || ticket.tail_registration || null,
        record_date: recordDate,
        record_time: recordTime,
        sequence,
        line_order: LINE_ORDER.FLIGHT,
        // The leg that burned it, not the leg whose ticket revealed it.
        flight_ID: prev.flight_ID || null,
        sector: prev.sector || null,
        // NO TICKET, DELIBERATELY. The ticket that revealed this burn belongs
        // to the NEXT leg, so putting it here would print that ticket beside
        // this row's flight - two different legs on one line, which reads as a
        // defect rather than as provenance. A burn is not bought on a ticket;
        // is_estimated below is what says the figure was derived.
        fuel_ticket_ID: null,
        // No order buys a burn. Left null deliberately rather than inheriting
        // the previous row's, which would attribute consumption to a purchase.
        fuel_order_ID: null,
        entry_type: 'FLIGHT',
        opening_rob_kg: opening,
        uplift_kg: 0,
        // Unsigned for the quantity reconciliation that already reads this
        // column and for movementOf() in rob-recalculate; signed in qty_kg for
        // the valued ledger the screen shows.
        burn_kg: burnKg,
        adjustment_kg: 0,
        closing_rob_kg: fobBefore,
        qty_kg: -burnKg,
        rate_usd_per_kg: rate,
        value_usd: -value,
        balance_value_usd: balanceValue,
        // Unchanged. Only an uplift moves the moving average price.
        map_usd_per_kg: atMap,
        max_capacity_kg: maxCapacity,
        rob_percentage: robPct,
        data_source: basis === 'gauge' ? 'FQIS' : 'TICKET',
        // A derived figure, not a measured one: nobody read a burn off an
        // instrument. is_estimated is exactly the column that says so.
        is_estimated: true
    }));
    return { ID, reason: null, qty: burnKg };
}

module.exports = { postPrecedingBurn };

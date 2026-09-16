/**
 * FuelSphere - post a fuel ticket into the ROB ledger as an UPLIFT row.
 *
 * ONE IMPLEMENTATION, TWO CALLERS, for the same reason ticket-measurement.js
 * has one: a ticket is captured either through TicketService or inline in a
 * Fuel Order's draft, and a ledger that gains a row on one path and not the
 * other is worse than one that gains none - the balance would be right for
 * some tails and quietly wrong for others.
 *
 * WHAT A ROW CARRIES, and where each figure comes from:
 *
 *   sector             the flight's origin - destination, as flown
 *   qty_kg             the ticket's MASS, not its metered volume (see below)
 *   rate_usd_per_kg    value / mass, so rate x qty reconstructs value exactly
 *   value_usd          the ticket's total_amount (rate per litre x metered)
 *   closing_rob_kg     previous balance + qty_kg
 *   balance_value_usd  previous value   + value_usd
 *   map_usd_per_kg     balance_value_usd / closing_rob_kg
 *
 * MASS, NOT VOLUME, AND THE CONVERSION IS THE POINT. A ticket's rate is per
 * LITRE and its metered quantity is in the ticket's own uom_code; the ledger
 * is kilograms, because a burn row is kilograms and a balance that adds
 * litres to kilograms is not a balance. So the row takes quantity_kg and
 * back-solves the rate from the value rather than copying rate_per_litre
 * into a column labelled per kg. Where the ticket is already in a mass unit
 * the two are the same number and nothing is lost.
 *
 * IT DOES NOT POST WHERE IT CANNOT BE HONEST. No mass, no value, or no tail
 * and there is no row - a ledger entry with a null quantity moves the
 * balance by nothing and reads as a movement that happened. The ticket
 * still lands; A1 says capture is never blocked, and that includes never
 * being blocked by this.
 */

const cds = require('@sap/cds');
const { SELECT, INSERT } = cds.ql;
const { toLitres } = require('./fuel-uom');

const LEDGER = 'fuelsphere.ROB_LEDGER';

const num = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * SKIPPING IS REPORTED, NOT SWALLOWED. The commonest skip is a litre ticket
 * with no density: there is no honest mass for it, so there is no ledger
 * row - and an operator who was told nothing would reasonably read that as
 * the feature being broken. The reason travels back so the caller can say it.
 *
 * @param {object} ticket  the activated ticket row
 * @returns {Promise<{ID: string|null, reason: string|null}>}
 */
async function postTicketUplift(ticket) {
    if (!ticket || !ticket.ID) return { ID: null, reason: null };

    const tail = ticket.tail_registration || ticket.aircraft_reg;
    const qty = num(ticket.quantity_kg);
    const value = num(ticket.total_amount);

    if (!tail) return { ID: null, reason: 'the ticket names no aircraft' };
    if (!qty || qty <= 0) {
        return { ID: null, reason:
            'the ticket has no mass in kilograms - a volume ticket needs a density before it can be valued in a kilogram ledger' };
    }
    if (value === null) {
        return { ID: null, reason: 'the ticket has no amount - enter a rate per litre' };
    }

    // Idempotent: a ticket posts once. Re-activating a corrected ticket must
    // not add a second uplift of the same fuel. Silent by design - this is
    // the expected path on every re-save, not something to report.
    const existing = await cds.db.run(SELECT.one.from(LEDGER)
        .columns('ID').where({ fuel_ticket_ID: ticket.ID }));
    if (existing) return { ID: null, reason: null };

    // The previous row for this tail IS the opening balance. Ordered the way
    // the ledger is read - date, then time, then the within-day sequence.
    // aircraft_type_code, not aircraft_ID: ROB_LEDGER.aircraft points at
    // AIRCRAFT_MASTER, which is keyed on type_code, so that is what the
    // managed foreign key is called. (burn-service.js writes `aircraft_ID`
    // into this table and has always had it silently dropped.)
    const last = await cds.db.run(SELECT.one.from(LEDGER)
        .columns('closing_rob_kg', 'balance_value_usd', 'sequence', 'record_date',
                 'max_capacity_kg', 'aircraft_type_code')
        .where({ tail_number: tail })
        .orderBy('record_date desc', 'record_time desc', 'sequence desc'));

    const openingQty   = last ? (num(last.closing_rob_kg) || 0) : 0;
    const openingValue = last ? (num(last.balance_value_usd) || 0) : 0;

    const balanceQty   = Number((openingQty + qty).toFixed(2));
    const balanceValue = Number((openingValue + value).toFixed(2));
    // Guarded rather than assumed: a balance of zero would divide to
    // Infinity, and an Infinity in a price column is worse than a null.
    const map = balanceQty > 0 ? Number((balanceValue / balanceQty).toFixed(4)) : null;
    const rate = Number((value / qty).toFixed(4));

    // The flight names the date and the sector. A ticket with no flight
    // still posts - the fuel is on the aircraft either way - it just has
    // neither to show.
    let flightDate = null, sector = null, flightId = ticket.flight_ID || null;
    if (flightId) {
        const flight = await cds.db.run(SELECT.one.from('fuelsphere.FLIGHT_SCHEDULE')
            .columns('flight_date', 'origin_airport', 'destination_airport')
            .where({ ID: flightId }));
        if (flight) {
            flightDate = flight.flight_date;
            if (flight.origin_airport && flight.destination_airport) {
                sector = `${flight.origin_airport} - ${flight.destination_airport}`;
            }
        }
    }

    const stamp = ticket.delivery_timestamp ? new Date(ticket.delivery_timestamp) : new Date();
    const recordDate = flightDate || stamp.toISOString().slice(0, 10);
    const recordTime = stamp.toISOString().slice(11, 19);

    // The sequence restarts per tail per DAY - same convention the existing
    // ledger writers use. Read against THIS row's date, not the latest row's:
    // the date here is the FLIGHT's, which for a ticket captured late is not
    // today and may already have rows against it. Sequencing off the latest
    // row would then hand out 1 a second time for that day.
    const sameDayRows = await cds.db.run(SELECT.one.from(LEDGER)
        .columns('sequence')
        .where({ tail_number: tail, record_date: recordDate })
        .orderBy('sequence desc'));
    const sequence = sameDayRows ? (sameDayRows.sequence || 0) + 1 : 1;

    const maxCapacity = last ? num(last.max_capacity_kg) : null;
    const robPct = (maxCapacity && maxCapacity > 0)
        ? Number(((balanceQty / maxCapacity) * 100).toFixed(2)) : null;

    const ID = cds.utils.uuid();
    await cds.db.run(INSERT.into(LEDGER).entries({
        ID,
        aircraft_type_code: last ? last.aircraft_type_code : null,
        tail_number: tail,
        tail_registration: ticket.tail_registration || null,
        record_date: recordDate,
        record_time: recordTime,
        sequence,
        flight_ID: flightId,
        fuel_ticket_ID: ticket.ID,
        // Null where the ticket had no order - A1 permits an order-less
        // ticket, and the uplift still belongs in the ledger.
        fuel_order_ID: ticket.order_ID || null,
        entry_type: 'UPLIFT',
        sector,
        // The metered figure as delivered. Null on a mass ticket rather
        // than back-converted through a density this row does not hold.
        volume_l: toLitres(ticket.quantity_metered ?? ticket.quantity, ticket.uom_code),
        // The unsigned columns the burn reconciliation reads, beside the
        // signed one the valued ledger reads.
        opening_rob_kg: openingQty,
        uplift_kg: qty,
        burn_kg: 0,
        adjustment_kg: 0,
        closing_rob_kg: balanceQty,
        qty_kg: qty,
        rate_usd_per_kg: rate,
        value_usd: value,
        balance_value_usd: balanceValue,
        map_usd_per_kg: map,
        max_capacity_kg: maxCapacity,
        rob_percentage: robPct,
        data_source: 'TICKET',
        is_estimated: false
    }));
    return { ID, reason: null };
}

module.exports = { postTicketUplift };

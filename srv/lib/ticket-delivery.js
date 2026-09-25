/**
 * FuelSphere - the delivery a fuel ticket belongs to.
 *
 * A DELIVERY IS THE EVENT; A TICKET IS ONE SUPPLIER'S PAPER FOR IT. The first
 * ticket captured for a flight has nothing to attach to, so capturing it used
 * to leave the delivery side of the reconciliation empty until somebody
 * created one by hand. It now raises its own, copying what the two records
 * share: when it happened, the order and flight it was for, the density and
 * temperature the fuel was measured at, and the vehicle that delivered it.
 *
 * THE AIRCRAFT GAUGE READINGS ARE LEFT BLANK, deliberately. A ticket says what
 * the bowser delivered; only the crew can say what the aircraft's gauge read
 * before and after. Copying a ticket figure into a gauge column would invent
 * an instrument reading, and the whole reconciliation exists to compare the
 * two independently. That is also why the new delivery is PENDING - see
 * delivery-service.js, where entering the readings confirms it.
 *
 * ON A LATER TICKET the operator chooses: an existing delivery of the same
 * flight, or a new one. Two suppliers on one uplift are one delivery with two
 * tickets; a second bowser on a later turnaround is a second delivery. Nothing
 * in the data can tell those apart, so the person captures which it was, and
 * the checkbox WINS over the dropdown - it is the more specific instruction.
 */

const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE } = cds.ql;
const {
    allocateDeliveryNumber, allocateDeliveryNumberByFlight, allocateDeliveryNumberByTail
} = require('./number-range');

const TICKETS    = 'fuelsphere.FUEL_TICKETS';
const DELIVERIES = 'fuelsphere.FUEL_DELIVERIES';
const ORDERS     = 'fuelsphere.FUEL_ORDERS';
const FLIGHTS    = 'fuelsphere.FLIGHT_SCHEDULE';

const TICKET_COLUMNS = [
    'ID', 'ticket_number', 'order_ID', 'flight_ID', 'flight_number', 'aircraft_reg',
    'tail_registration', 'delivery_ID', 'create_new_delivery', 'delivery_timestamp',
    'quantity', 'quantity_metered', 'quantity_kg', 'uom_code', 'density_value',
    'density_temp_c', 'vehicle_id'
];

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** A delivery number in whichever series the ticket can support. */
async function deliveryNumberFor(row, flightNumber) {
    try {
        if (flightNumber) return await allocateDeliveryNumberByFlight(flightNumber, row.delivery_date);
        if (row.station_code) return await allocateDeliveryNumber(row.station_code, row.delivery_date);
        if (row.aircraft_reg) return await allocateDeliveryNumberByTail(row.aircraft_reg, row.delivery_date);
    } catch (e) {
        return null;   // the caller decides; capture is never blocked by a number
    }
    return null;
}

/**
 * Make sure this ticket has a delivery, creating one where the rules above
 * say it should.
 *
 * @param {object} ticket  the activated ticket row (partial is fine - it is re-read)
 * @returns {Promise<{deliveryID: string|null, created: boolean, reason: string|null}>}
 */
async function ensureDeliveryForTicket(ticket) {
    if (!ticket || !ticket.ID) return { deliveryID: null, created: false, reason: null };

    const t = await cds.db.run(SELECT.one.from(TICKETS)
        .columns(...TICKET_COLUMNS).where({ ID: ticket.ID })) || ticket;

    const wantsNew = t.create_new_delivery === true;

    // Already attached and no request for another: nothing to do.
    if (t.delivery_ID && !wantsNew) return { deliveryID: t.delivery_ID, created: false, reason: null };

    // The flight this ticket is for - its own, else its order's.
    let flightId = t.flight_ID || null;
    let order = null;
    if (t.order_ID) {
        order = await cds.db.run(SELECT.one.from(ORDERS)
            .columns('ID', 'flight_ID', 'station_code', 'supplier_ID', 'airport_ID')
            .where({ ID: t.order_ID }));
        if (!flightId && order) flightId = order.flight_ID || null;
    }

    // Deliveries this flight already has. Without a flight there is nothing to
    // group by, so the ticket stands alone and raises its own.
    const siblings = flightId ? await cds.db.run(SELECT.from(DELIVERIES)
        .columns('ID').where({ flight_ID: flightId })) : [];

    if (!wantsNew && siblings.length) {
        // Later ticket, no choice made. Left unattached rather than guessed:
        // which delivery this ticket belongs to is a fact about the turnaround
        // that only the person capturing it knows.
        return { deliveryID: null, created: false, reason:
            `this flight already has ${siblings.length} deliver${siblings.length === 1 ? 'y' : 'ies'} - `
          + 'pick one on the ticket, or tick Create new delivery' };
    }

    const stamp = t.delivery_timestamp ? new Date(t.delivery_timestamp) : new Date();
    const iso = stamp.toISOString();
    const flight = flightId ? await cds.db.run(SELECT.one.from(FLIGHTS)
        .columns('flight_number', 'aircraft_reg', 'tail_registration')
        .where({ ID: flightId })) : null;

    // A DELIVERY MUST NAME THE AIRCRAFT. aircraft_reg is mandatory on
    // FUEL_DELIVERIES and is the join key the reconciliation runs on; a
    // delivery without one is a row nothing can match. A ticket that names no
    // aircraft therefore raises no delivery, and says why.
    const registration = t.aircraft_reg || (flight && flight.aircraft_reg) || null;
    if (!registration) {
        return { deliveryID: null, created: false, reason:
            'the ticket names no aircraft, and a delivery must name one' };
    }

    const row = {
        ID: cds.utils.uuid(),
        order_ID: t.order_ID || null,
        flight_ID: flightId,
        aircraft_reg: registration,
        tail_registration: t.tail_registration || (flight && flight.tail_registration) || null,
        delivery_date: iso.slice(0, 10),
        delivery_time: iso.slice(11, 19),
        // What this ticket delivered, in the ticket's own unit. A second
        // ticket on the same delivery adds to it through the reconciliation,
        // not by being copied here.
        delivered_quantity: num(t.quantity_metered) ?? num(t.quantity) ?? 0,
        uom_code: t.uom_code || 'LTR',
        density: num(t.density_value),
        temperature: num(t.density_temp_c),
        vehicle_id: t.vehicle_id || null,
        // PENDING until the gauge readings arrive. fob_* are left null on
        // purpose - see the note at the top of this file.
        status: 'Pending',
        fob_source: 'NONE'
    };
    row.station_code = order ? order.station_code : null;
    const number = await deliveryNumberFor(row, (flight && flight.flight_number) || t.flight_number);
    delete row.station_code;
    if (number) row.delivery_number = number;

    await cds.db.run(INSERT.into(DELIVERIES).entries(row));
    await cds.db.run(UPDATE(TICKETS).set({ delivery_ID: row.ID }).where({ ID: t.ID }));

    return { deliveryID: row.ID, created: true, reason: null, delivery_number: row.delivery_number || null };
}

module.exports = { ensureDeliveryForTicket };

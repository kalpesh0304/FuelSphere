/**
 * FuelSphere - Number Range Allocation (WP-04 / D4, D17)
 *
 * Replaces the client-side `max + 1` read used across order, delivery and
 * ticket numbering. That pattern read the current highest number and added
 * one, so two concurrent creations at the same station on the same day read
 * the same maximum and produced the same number.
 *
 * Allocation here is an atomic increment against a counter row in
 * NUMBER_RANGES, keyed by prefix + station + date. The UPDATE takes a row
 * lock, so concurrent transactions serialise on it and each caller receives a
 * distinct number.
 *
 * The increment runs on the ambient request transaction, so a number is
 * rolled back with the request that failed to use it, rather than leaking.
 *
 * Formats are unchanged apart from the sequence width, which widens from
 * three digits to four — three capped a station at 999 per day:
 *
 *   Order     FO-{station}-{YYYYMMDD}-{NNNN}
 *   Delivery  EPD-{station}-{YYYYMMDD}-{NNNN}
 *   Ticket    FT-{station}-{YYYYMMDD}-{NNNN}
 *
 * Flight-keyed variants, for the standalone Ticket/Delivery create apps
 * (fuelTickets, fuelDeliveries), which number by the flight they capture
 * fuel for rather than the station - a different traceability question, not
 * a replacement. Order numbering is untouched; it stays station-keyed.
 * Same allocator, same NUMBER_RANGES table, only the range_key dimension
 * differs:
 *
 *   Ticket    FT-{flight}-{YYYYMMDD}-{NNNN}
 *   Delivery  EPD-{flight}-{YYYYMMDD}-{NNNN}
 */

const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE } = cds.ql;

const NUMBER_RANGES = 'fuelsphere.NUMBER_RANGES';

/** Sequence width. Three digits capped a station at 999 orders per day. */
const SEQUENCE_WIDTH = 4;

/** Prefixes for the three retained formats. */
const PREFIX = {
    ORDER    : 'FO',
    DELIVERY : 'EPD',
    TICKET   : 'FT'
};

/**
 * Error raised when a station code is missing.
 *
 * D17: generation previously substituted 'XXX', producing a valid-looking
 * number with no traceable station. A number containing XXX is a silent data
 * quality hole that cannot be found afterwards, so this fails instead.
 *
 * EPD450 — taken from the existing EPD4xx prefix already in use in
 * order-service.js, at x450 per the convention that new codes within an
 * existing prefix start there so they cannot collide with EPD411.
 */
const MISSING_STATION_CODE = 'EPD450';

// Same failure class regardless of which dimension is missing - a numbering
// key the allocator cannot substitute for. One code, message text picks the
// dimension name, rather than minting a second EPD4xx code for what is the
// same situation one axis over.
function missingDimensionMessage(prefix, dimensionLabel) {
    return `EPD450: ${dimensionLabel} is required to generate a ${prefix} number. ` +
           `The record cannot be numbered without a traceable ${dimensionLabel.toLowerCase()}.`;
}

/** YYYYMMDD for a Date, an ISO date string, or today when omitted. */
function dateKey(date) {
    const iso = date
        ? (typeof date === 'string' ? date : date.toISOString().slice(0, 10))
        : new Date().toISOString().slice(0, 10);
    return iso.slice(0, 10).replace(/-/g, '');
}

/**
 * Draw the next sequence for a range key.
 *
 * The UPDATE is the atomic step. Where the row does not yet exist the INSERT
 * may lose a race to a concurrent caller, in which case the UPDATE path is
 * retried — by then the row exists.
 */
async function nextSequence(rangeKey) {
    const bump = () => UPDATE(NUMBER_RANGES)
        .set({ last_number: { '+=': 1 } })
        .where({ range_key: rangeKey });

    const read = async () => {
        const row = await SELECT.one.from(NUMBER_RANGES)
            .columns('last_number')
            .where({ range_key: rangeKey });
        return row && row.last_number;
    };

    if (await bump()) return read();

    try {
        await INSERT.into(NUMBER_RANGES).entries({ range_key: rangeKey, last_number: 1 });
        return 1;
    } catch {
        // A concurrent caller created the row first. Increment it instead.
        await bump();
        return read();
    }
}

/**
 * Allocate the next number for a prefix, a dimension value (station or
 * flight number) and a date.
 *
 * Throws when the dimension value is missing. Callers inside a handler
 * should catch and convert to req.error, so the caller sees EPD450 rather
 * than a generic failure.
 *
 * @param {string} dimensionLabel  Only affects the error message - defaults
 *        to 'Station' so every existing station-keyed call site is
 *        unchanged. Pass 'Flight' for the flight-keyed variants below.
 * @returns {Promise<string>} e.g. 'FO-MNL-20260316-0001'
 */
async function allocate(prefix, dimensionValue, date, dimensionLabel = 'Station') {
    const val = typeof dimensionValue === 'string' ? dimensionValue.trim().toUpperCase() : '';
    if (!val) {
        const err = new Error(missingDimensionMessage(prefix, dimensionLabel));
        err.code = MISSING_STATION_CODE;
        throw err;
    }

    const dateStr = dateKey(date);
    const rangeKey = `${prefix}-${val}-${dateStr}`;
    const seq = await nextSequence(rangeKey);

    return `${prefix}-${val}-${dateStr}-${String(seq).padStart(SEQUENCE_WIDTH, '0')}`;
}

const allocateOrderNumber    = (stationCode, date) => allocate(PREFIX.ORDER, stationCode, date);
const allocateDeliveryNumber = (stationCode, date) => allocate(PREFIX.DELIVERY, stationCode, date);
const allocateTicketNumber   = (stationCode, date) => allocate(PREFIX.TICKET, stationCode, date);

// Flight-keyed variants for the standalone Ticket/Delivery create apps.
const allocateTicketNumberByFlight   = (flightNumber, date) => allocate(PREFIX.TICKET, flightNumber, date, 'Flight');
const allocateDeliveryNumberByFlight = (flightNumber, date) => allocate(PREFIX.DELIVERY, flightNumber, date, 'Flight');

/**
 * Convert an allocation failure into a request error.
 * Returns true when the error was handled, so the caller can stop.
 */
function reportAllocationError(req, err) {
    if (err && err.code === MISSING_STATION_CODE) {
        req.error(400, err.message);
        return true;
    }
    return false;
}

module.exports = {
    PREFIX,
    SEQUENCE_WIDTH,
    MISSING_STATION_CODE,
    allocate,
    allocateOrderNumber,
    allocateDeliveryNumber,
    allocateTicketNumber,
    allocateTicketNumberByFlight,
    allocateDeliveryNumberByFlight,
    reportAllocationError
};

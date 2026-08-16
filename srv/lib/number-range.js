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

function missingStationMessage(prefix) {
    return `EPD450: Station code is required to generate a ${prefix} number. ` +
           `The record cannot be numbered without a traceable station.`;
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
 * Allocate the next number for a prefix, station and date.
 *
 * Throws when the station code is missing. Callers inside a handler should
 * catch and convert to req.error, so the caller sees EPD450 rather than a
 * generic failure.
 *
 * @returns {Promise<string>} e.g. 'FO-MNL-20260316-0001'
 */
async function allocate(prefix, stationCode, date) {
    const stn = typeof stationCode === 'string' ? stationCode.trim().toUpperCase() : '';
    if (!stn) {
        const err = new Error(missingStationMessage(prefix));
        err.code = MISSING_STATION_CODE;
        throw err;
    }

    const dateStr = dateKey(date);
    const rangeKey = `${prefix}-${stn}-${dateStr}`;
    const seq = await nextSequence(rangeKey);

    return `${prefix}-${stn}-${dateStr}-${String(seq).padStart(SEQUENCE_WIDTH, '0')}`;
}

const allocateOrderNumber    = (stationCode, date) => allocate(PREFIX.ORDER, stationCode, date);
const allocateDeliveryNumber = (stationCode, date) => allocate(PREFIX.DELIVERY, stationCode, date);
const allocateTicketNumber   = (stationCode, date) => allocate(PREFIX.TICKET, stationCode, date);

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
    reportAllocationError
};

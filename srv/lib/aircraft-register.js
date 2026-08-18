/**
 * FuelSphere - Aircraft register gate (WP-07 / B1, A4)
 *
 * Decision A4, stated in 01-TARGET-SCHEMA §2: capture is never blocked,
 * external commitment is gated.
 *
 *   Flight record applies   PROVISIONAL yes   CONFIRMED yes
 *   Ticket capture          PROVISIONAL yes   CONFIRMED yes
 *   ROB ledger entry        PROVISIONAL yes   CONFIRMED yes
 *   Order creation          PROVISIONAL NO    CONFIRMED yes
 *   Purchase order, posting PROVISIONAL NO    CONFIRMED yes
 *
 * Only the order-creation row is enforced here. Purchase order and posting
 * do not exist yet; ticket and ROB paths are deliberately left untouched.
 *
 * Rule MDM402 / VR60 in 03-VALIDATION-RULES.md:
 *   "Order creation and order send are blocked while the tail is
 *    PROVISIONAL; ticket capture is not."
 */

const cds = require('@sap/cds');
const { SELECT } = cds.ql;

const REGISTRATIONS = 'fuelsphere.AIRCRAFT_REGISTRATIONS';
const PROVISIONAL_BLOCKED = 'MDM402';

/**
 * Registration for a flight, or null where the flight carries none.
 * Accepts a flight row or a flight ID.
 */
async function registrationForFlight(flightOrId) {
    if (!flightOrId) return null;
    if (typeof flightOrId === 'object') return flightOrId.aircraft_reg || null;
    const { FLIGHT_SCHEDULE } = cds.entities('fuelsphere');
    const flight = await SELECT.one.from(FLIGHT_SCHEDULE)
        .columns('aircraft_reg')
        .where({ ID: flightOrId });
    return (flight && flight.aircraft_reg) || null;
}

/**
 * Throw when the registration is known to the register and PROVISIONAL.
 *
 * A registration absent from the register is NOT blocked here. Auto-
 * provisioning on first sight is rule MDM401 and belongs to WP-16; blocking
 * an unknown tail today would implement half of it early. Reported instead.
 */
async function assertOrderable(registration) {
    if (!registration) return;                       // no tail to check
    const reg = await SELECT.one.from(REGISTRATIONS)
        .columns('registration', 'record_status')
        .where({ registration });
    if (!reg) return;                                // unknown - see MDM401 / WP-16
    if (reg.record_status === 'PROVISIONAL') {
        const err = new Error(
            `${PROVISIONAL_BLOCKED}: Order creation is blocked while aircraft ${registration} is PROVISIONAL. ` +
            `The registration must be confirmed before an order commits the airline to a supplier. ` +
            `Ticket capture and ROB entry are unaffected.`
        );
        err.code = PROVISIONAL_BLOCKED;
        throw err;
    }
}

/** Gate an order creation for the flight the order is attached to. */
async function assertOrderableForFlight(flightOrId) {
    return assertOrderable(await registrationForFlight(flightOrId));
}

/**
 * Convert a gate failure into a request error.
 * Returns true when handled, so the caller can stop.
 */
function reportRegisterError(req, err) {
    if (err && err.code === PROVISIONAL_BLOCKED) {
        req.error(409, err.message);
        return true;
    }
    return false;
}

module.exports = {
    PROVISIONAL_BLOCKED,
    registrationForFlight,
    assertOrderable,
    assertOrderableForFlight,
    reportRegisterError
};

/**
 * FuelSphere - Tail resolution (WP-07B, decisions B1, A4, A1)
 *
 * Every entity that records a registration keeps TWO representations:
 *
 *     tail_number / aircraft_reg   the value as received. Always lands
 *     tail                         the register row. Resolves, or does not
 *
 * That is what makes the policy possible. If the string were replaced by the
 * association, an unknown tail would be structurally impossible to record and
 * no parameter could permit one.
 */

const cds = require('@sap/cds');
const { SELECT } = cds.ql;

const REGISTER = 'fuelsphere.AIRCRAFT_REGISTRATIONS';

// ===========================================================================
// UNKNOWN_TAIL_POLICY - a stated placeholder with a migration path
//
// No parameter framework exists: HOLD_PAYMENT_ON_DISCREPANCY,
// FLIGHT_COST_OBJECT_MODEL and BURN_POSTING_TRIGGER are all named in the
// design and none of them is stored anywhere. WP-13 is the package that
// builds parameter resolution and applied evidence, and this value moves into
// it UNCHANGED - the same treatment WP-17 gave the FOB tolerances.
//
// Named and documented rather than inlined at the check. A buried literal is
// what D16 was, and WP-05 removed it.
// ===========================================================================

const POLICY = {
    ACCEPT_PROVISIONAL: 'ACCEPT_PROVISIONAL',
    REJECT: 'REJECT'
};

/** The default. An unresolved tail is recorded, not refused. */
const UNKNOWN_TAIL_POLICY = POLICY.ACCEPT_PROVISIONAL;

/** Where the value came from, recorded on every decision. */
const POLICY_SOURCE = 'WP07B_CONSTANT';

const UNKNOWN_TAIL_REJECTED = 'MDM403';

/**
 * Which feeds a REJECT policy may block.
 *
 * Decision A1 is a decision, not a default. Fuel is already in the tanks when
 * a ticket is written and refusing to record it puts money outside the
 * system - which is the failure A1 exists to prevent. Burn is the same: it
 * already happened.
 *
 * Without this split an airline sets REJECT for good reasons on the schedule
 * feed and silently loses fuel tickets.
 */
const BLOCKABLE = {
    FLIGHT_SCHEDULE: true,
    FLIGHT_DISPATCH: true,
    FUEL_TICKETS: false,        // A1
    FUEL_BURNS: false,          // already happened
    FUEL_BURN_EXCEPTIONS: false,
    ROB_LEDGER: false,
    FUEL_DELIVERIES: false      // the fuel is on the aircraft
};

function isBlockable(feed) {
    return BLOCKABLE[feed] === true;
}

/**
 * Resolve a registration against the register.
 * Returns the row, or null where the register has never seen it.
 */
async function resolveTail(registration, tx) {
    if (!registration) return null;
    const db = tx || cds.db;
    return await db.run(SELECT.one.from(REGISTER)
        .columns('registration', 'record_status', 'aircraft_type_code')
        .where({ registration: String(registration).trim().toUpperCase() })) || null;
}

/**
 * Decide what happens to one record whose registration did not resolve.
 *
 * @returns {{ accept, tail_registration, reason }}
 *
 * accept=false is only ever returned for a blockable feed under REJECT. On
 * every other combination the record lands with the association null and the
 * string carrying the registration.
 */
function applyPolicy(registration, resolved, feed, policy = UNKNOWN_TAIL_POLICY) {
    if (resolved) {
        return { accept: true, tail_registration: resolved.registration, reason: null };
    }
    if (!registration) {
        // Nothing to resolve. Not an unknown tail - an absent one.
        return { accept: true, tail_registration: null, reason: null };
    }
    if (policy === POLICY.REJECT && isBlockable(feed)) {
        return {
            accept: false,
            tail_registration: null,
            reason: `${UNKNOWN_TAIL_REJECTED}: registration ${registration} is not in the aircraft register `
                  + `and UNKNOWN_TAIL_POLICY is ${POLICY.REJECT} (${POLICY_SOURCE}).`
        };
    }
    // ACCEPT_PROVISIONAL, or a feed that is never blockable.
    //
    // WP-16 auto-provisioning is consumed where it exists and not built here.
    // Until it lands the association stays null and the string carries the
    // registration - which is exactly the case the string exists for.
    return { accept: true, tail_registration: null, reason: null };
}

/**
 * Resolve and stamp in one step, for a handler holding one record.
 *
 * Mutates `data`, setting tail_registration where it resolves. Returns the
 * decision so the caller can refuse a blockable feed.
 */
async function resolveOnto(data, stringField, feed, policy, tx) {
    const registration = data[stringField];
    const resolved = await resolveTail(registration, tx);
    const decision = applyPolicy(registration, resolved, feed, policy);
    if (decision.accept) data.tail_registration = decision.tail_registration;
    return decision;
}

module.exports = {
    POLICY, UNKNOWN_TAIL_POLICY, POLICY_SOURCE, UNKNOWN_TAIL_REJECTED,
    BLOCKABLE, isBlockable,
    resolveTail, applyPolicy, resolveOnto
};

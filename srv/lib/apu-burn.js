/**
 * FuelSphere - APU burn derivation (WP-19, decisions B4 and B9)
 *
 * APU burn is NEVER metered. It is the only fuel figure in the system that is
 * derived rather than measured, and every row records how.
 *
 *     apu_burn_kg = running_minutes / 60 x apu_burn_rate_kg_hr
 *
 * RUNNING MINUTES, NEVER GROUND TIME. (OUT - IN) x rate assumes the APU ran
 * the whole turn. On a 310 minute turn with the APU running 38 minutes that is
 * 568 kg against an actual 70 — 498 kg of fuel that never burned.
 *
 * Most APU burn falls OUTSIDE block time, before off-blocks and after
 * on-blocks, so no gauge reading captures it. That is why the cycle times are
 * the input and the block times are not.
 */

const cds = require('@sap/cds');
const { SELECT } = cds.ql;

const RATE_SOURCE_REGISTER = 'AIRCRAFT_REGISTRATIONS';

const PHASE = {
    PRE_DEPARTURE: 'PRE_DEPARTURE',
    IN_FLIGHT: 'IN_FLIGHT',
    POST_ARRIVAL: 'POST_ARRIVAL',
    OVERNIGHT: 'OVERNIGHT',
    MAINTENANCE: 'MAINTENANCE',
    PARKED: 'PARKED'
};

const SOURCE = { ACARS: 'ACARS', MANUAL: 'MANUAL', GROUND_TIME_EST: 'GROUND_TIME_EST' };

/** Phases that belong to no flight. Their cost goes to the station or the tail. */
const NO_FLIGHT_PHASES = [PHASE.OVERNIGHT, PHASE.MAINTENANCE, PHASE.PARKED];

const BASIS = {
    REFUELLING_EVENT: 'REFUELLING_EVENT',
    PHASE: 'PHASE',
    TIME_PROPORTIONAL: 'TIME_PROPORTIONAL',
    NONE: 'NONE'
};

// Looked up in 03-VALIDATION-RULES.md, not assigned. The first draft of this
// module used APU401 and APU402, both of which already mean something else:
// APU401 is the derivation formula itself and APU402 is avoidable minutes.
//
//   APU401  the formula this module implements — minutes/60 x rate, no meter
//   APU403  where event data is absent, minutes are estimated from ground time
//           and the source recorded as GROUND_TIME_EST
//   APU404  one row per cycle, not per phase
//   APU405  running minutes derived from full UTC timestamps
//   APU406  a cycle with no stop is flagged open; minutes and burn are never
//           computed for it
//   APU407  a stop earlier than its start is rejected
//   APU412  GROUND_TIME_EST is the EXPECTED path where reporting is absent,
//           and is not a data quality exception
const APU_STOP_BEFORE_START = 'APU407';
const APU_CYCLE_OPEN = 'APU406';

const ms = (v) => (v ? new Date(v).getTime() : null);

/**
 * Running minutes between two FULL timestamps.
 *
 * Full timestamps, so a cycle crossing midnight is arithmetic rather than a
 * special case — 23:40 to 00:20 is forty minutes, not minus 1,400.
 *
 * @returns {{minutes}|{error}}  minutes, or an error where it cannot be known
 */
function runningMinutes(startUtc, stopUtc) {
    const a = ms(startUtc), b = ms(stopUtc);
    if (a === null || Number.isNaN(a)) return { error: `${APU_CYCLE_OPEN}: apu_start_utc is required.` };
    if (b === null || Number.isNaN(b)) return { open: true };
    if (b < a) {
        return { error: `${APU_STOP_BEFORE_START}: apu_stop_utc ${stopUtc} is before apu_start_utc ${startUtc}.` };
    }
    return { minutes: Math.round((b - a) / 60000) };
}

/** The per-tail rate, from the register. Added by WP-07 and consumed here first. */
async function rateForTail(registration, tx) {
    if (!registration) return null;
    const db = tx || cds.db;
    const row = await db.run(SELECT.one.from('fuelsphere.AIRCRAFT_REGISTRATIONS')
        .columns('registration', 'apu_burn_rate_kg_hr')
        .where({ registration: String(registration).trim().toUpperCase() }));
    if (!row || row.apu_burn_rate_kg_hr === null || row.apu_burn_rate_kg_hr === undefined) return null;
    const rate = Number(row.apu_burn_rate_kg_hr);
    return rate > 0 ? { rate, source: RATE_SOURCE_REGISTER, registration: row.registration } : null;
}

/**
 * Derive one cycle.
 *
 * Returns the fields to stamp on the row. An open cycle comes back flagged
 * with a null burn — not zero. Zero would say the APU burned nothing, which
 * is the opposite of what an open cycle means.
 */
function deriveCycle(cycle, resolvedRate) {
    const timing = runningMinutes(cycle.apu_start_utc, cycle.apu_stop_utc);

    if (timing.error) return { error: timing.error };

    if (timing.open) {
        return {
            is_open: true,
            running_minutes: null,
            apu_burn_kg: null,          // Unknown, not nil
            burn_rate_kg_hr: resolvedRate ? resolvedRate.rate : null,
            rate_source: resolvedRate ? resolvedRate.source : null,
            // APU406 also calls for capping and escalation. No cap value is
            // stated anywhere in the design, so the cycle is flagged and left
            // uncomputed rather than capped at an invented number.
            note: `${APU_CYCLE_OPEN}: cycle has no stop time; burn is not computed.`
        };
    }

    if (!resolvedRate) {
        // The rate is the other required input. A derived value with a
        // missing input is null, never zero.
        return {
            is_open: false,
            running_minutes: timing.minutes,
            apu_burn_kg: null,
            burn_rate_kg_hr: null,
            rate_source: null,
            note: `No apu_burn_rate_kg_hr for this tail; burn is not computed.`
        };
    }

    return {
        is_open: false,
        running_minutes: timing.minutes,
        apu_burn_kg: Number((timing.minutes / 60 * resolvedRate.rate).toFixed(2)),
        burn_rate_kg_hr: resolvedRate.rate,
        rate_source: resolvedRate.source,
        note: null
    };
}

/**
 * Which flight bears the cost, and on what basis.
 *
 * Resolution order from the design notes: split at the refuelling event where
 * gauge readings exist, then by phase, then time-proportional — recording
 * which was used. Only the phase rule is decidable from the cycle alone; the
 * refuelling split needs both gauge gaps and only the arriving one is
 * measurable today (open point F20).
 *
 * A tail swap is handled by saying nothing: arriving and departing aircraft
 * differ, so there is no turn and no continuity to assume.
 */
function allocate(cycle) {
    const phase = cycle.usage_phase;
    if (NO_FLIGHT_PHASES.includes(phase)) {
        // Belongs to NEITHER flight. Charging either is misleading.
        return { allocated_flight_ID: null, allocation_basis: BASIS.NONE };
    }
    if (cycle.flight_ID) {
        return { allocated_flight_ID: cycle.flight_ID, allocation_basis: BASIS.PHASE };
    }
    return { allocated_flight_ID: null, allocation_basis: BASIS.NONE };
}

/** engine_burn_kg = block burn − APU burn. Null where either is unknown. */
function splitBlockBurn(blockBurnKg, apuBurnKg) {
    const block = (blockBurnKg === null || blockBurnKg === undefined) ? null : Number(blockBurnKg);
    const apu = (apuBurnKg === null || apuBurnKg === undefined) ? null : Number(apuBurnKg);
    if (block === null) return { apu_burn_kg: apu, engine_burn_kg: null };
    if (apu === null) return { apu_burn_kg: null, engine_burn_kg: null };
    return { apu_burn_kg: apu, engine_burn_kg: Number((block - apu).toFixed(2)) };
}

module.exports = {
    PHASE, SOURCE, BASIS, NO_FLIGHT_PHASES,
    RATE_SOURCE_REGISTER, APU_STOP_BEFORE_START, APU_CYCLE_OPEN,
    runningMinutes, rateForTail, deriveCycle, allocate, splitBlockBurn
};

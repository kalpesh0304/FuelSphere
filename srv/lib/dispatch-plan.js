/**
 * FuelSphere - Dispatch plan versioning and the regulated stack
 * WP-18, decisions A7 and B3.
 *
 * Three axes, none substituting for another:
 *
 *   plan_group_id      the flight leg's plan family        never changes
 *   plan_version       the plan revision                   every re-plan
 *   dispatch_order_id  the commercial commitment           on confirmation
 *
 * The fuel order ID is stable through a re-plan made before the order is
 * confirmed to the supplier and new after it. It therefore marks a commercial
 * boundary rather than a plan revision, and cannot be the family key.
 */

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// ===========================================================================
// The regulated fuel stack - B3, DSP450 and DSP451
// ===========================================================================

/** The seven components, in the order regulation states them. */
const STACK_COMPONENTS = [
    'trip_fuel_kg', 'contingency_fuel_kg', 'alternate_fuel_kg', 'final_reserve_kg',
    'additional_fuel_kg', 'taxi_fuel_kg', 'extra_fuel_kg'
];

/**
 * DSP450 - block_fuel_kg is the sum of the seven components, derived and
 * never keyed. DSP451 - required_uplift_kg is block less the fuel already
 * on board.
 *
 * Returns null for block where NO component is supplied: a plan that
 * transmitted no stack has an unknown block, not a zero one. A partial stack
 * does sum, because a component genuinely absent from a plan is zero — an
 * aircraft with no alternate carries no alternate fuel.
 */
function deriveStack(row, fuelOnBoardKg) {
    const present = STACK_COMPONENTS.map(c => num(row[c])).filter(v => v !== null);
    if (!present.length) return { block_fuel_kg: null, required_uplift_kg: null };

    const block = Number(present.reduce((a, v) => a + v, 0).toFixed(2));
    const onBoard = num(fuelOnBoardKg);

    return {
        block_fuel_kg: block,
        // Null rather than block itself where the on-board figure is unknown.
        // Returning block would silently claim the aircraft arrived empty.
        required_uplift_kg: onBoard === null ? null : Number((block - onBoard).toFixed(2))
    };
}

// ===========================================================================
// Versioning - A7, DSP452, DSP453, DSP456, STG412
// ===========================================================================

const PLAN_ACTIVE = 'ACTIVE';
const PLAN_SUPERSEDED = 'SUPERSEDED';
const SOURCE_FEED = 'FEED';
const SOURCE_ASSIGNED = 'ASSIGNED';

/**
 * The plan family key. Derived from the leg, so it survives a tail swap.
 *
 * Falls back to a deterministic composite where the schedule carries no leg
 * id, so plan_group_id is never null and two plans for one leg still land in
 * one family. ENR450 warns that flight number plus date is not a key, so the
 * fallback is weaker than a real leg id and is marked as such by the caller.
 */
function resolvePlanGroup(flightLegId, flightNumber, flightDate) {
    if (flightLegId) return String(flightLegId);
    return `LEG:${flightNumber}|${flightDate}`;
}

/**
 * Decide this arrival's version, and whether versions were skipped.
 *
 * @param incomingVersion  from the feed, or null where the feed has none
 * @param activeVersion    the version of the current ACTIVE row, or null
 *
 * STG412: the feed transmits the CURRENT PLAN ONLY. A missing intermediate
 * version will never arrive, so a gap is a fact to record, not a reason to
 * wait. Apply the arriving version, flag the gap, do not hold.
 */
function classifyVersion(incomingVersion, activeVersion) {
    const incoming = num(incomingVersion);
    const active = num(activeVersion);

    if (incoming === null) {
        // Assigned on receipt from arrival order. Strictly weaker: with no
        // version on the feed there is nothing to compare, so a gap cannot be
        // detected at all — not "no gap found", but "could not look".
        // version_gap_flag stays false and plan_version_source records why.
        return {
            plan_version: (active === null ? 1 : active + 1),
            plan_version_source: SOURCE_ASSIGNED,
            version_gap_flag: false,
            versions_skipped: 0
        };
    }

    // Skipped = the count of versions between the two that never arrived.
    // v1 then v4 skips v2 and v3, so two. Never negative: an out-of-order or
    // repeated arrival is not a negative gap.
    const skipped = (active === null) ? 0 : Math.max(0, incoming - active - 1);

    return {
        plan_version: incoming,
        plan_version_source: SOURCE_FEED,
        version_gap_flag: skipped > 0,
        versions_skipped: skipped
    };
}

/**
 * Is this arrival a revision of the active plan, or a genuine re-send?
 *
 * DSP453 and defect D27. The import treated a matching key as a DUPLICATE and
 * skipped it, so a revised quantity never landed and the only trace was a
 * warning in an import log. A matching key is a REVISION.
 *
 * A re-send is still detectable, but only on the narrower test that the feed
 * supplied the same version for the same family. Where the version is
 * assigned on receipt there is no way to tell a re-upload from a revision,
 * and every arrival counts as a new version.
 */
function isResend(incomingVersion, activeVersion) {
    const incoming = num(incomingVersion), active = num(activeVersion);
    return incoming !== null && active !== null && incoming === active;
}

module.exports = {
    STACK_COMPONENTS,
    PLAN_ACTIVE, PLAN_SUPERSEDED, SOURCE_FEED, SOURCE_ASSIGNED,
    deriveStack, resolvePlanGroup, classifyVersion, isResend
};

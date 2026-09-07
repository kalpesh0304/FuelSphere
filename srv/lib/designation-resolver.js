/**
 * FuelSphere — who fuels this flight (work package D)
 *
 * THE FIRST REAL CONSUMER OF resolveEffective(). Everything about validity,
 * priority, specificity and open-ended windows is E's, unchanged and not
 * reimplemented here. What lives here is the ONE thing E cannot know: the
 * cascade, and what each rung means.
 *
 *   1  flight + date        the primary axis
 *   2  else station + date  the fallback
 *   3  else NOTHING         and nothing is an ANSWER, not a failure
 *
 * RUNG 3 IS THE POINT. An undesignated station returns null, the order is
 * created with an empty supplier, and a person fills it in. Two things it
 * must never do: refuse (capture is never blocked - the same principle
 * validateForPosting is built on), or fall back to any contract at that
 * station. The second is the join that over-matches, and it has produced a
 * wrong answer in this repository three times.
 *
 * WHY THE TWO RUNGS ARE SEPARATE QUERIES rather than one call with both scope
 * fields. resolveEffective ranks by SPECIFICITY, so a row naming flight and
 * station would already outrank one naming only a station - but a row naming
 * ONLY A FLIGHT and a row naming ONLY A STATION have equal specificity, and
 * the tie would fall to priority. Flight must beat station whatever the
 * priorities say, so the axis is expressed as query order rather than as a
 * number somebody can misconfigure.
 */
const { resolveEffective } = require('./parameter-store');

const E = 'fuelsphere.DESIGNATED_SUPPLIERS';

/** How the designation was reached. Recorded, never inferred later. */
const AXIS = { FLIGHT: 'FLIGHT', STATION: 'STATION', NONE: 'NONE' };

/**
 * Resolve the designation for a flight at a station on a date.
 *
 * Always returns an object; `resolved` is the only thing to branch on.
 *
 *   { resolved: true,  axis, row, evidence }
 *   { resolved: false, axis: 'NONE', row: null, reason, evidence }
 *
 * @param flightNumber  the flight NUMBER, not a schedule row. Optional - a
 *                  station-only caller omits it.
 *                  NO EXAMPLE VALUE HERE ON PURPOSE: a flight number is
 *                  indistinguishable from an error code by shape, and
 *                  code-gate.js matches /\b[A-Z]{2,4}\d{3}\b/ across every
 *                  handler file, so a real one written here fails the gate
 *                  as an undocumented error code. It did, twice - the second
 *                  time inside the comment explaining the first.
 * @param stationCode   IATA, e.g. 'YYZ'
 * @param asOfDate      THE FLIGHT DATE, never today
 * @param carrierCode   F40 - a group with two carrier codes has two answers
 * @param designationType  PRIMARY unless a caller is asking for the second call
 */
async function resolveDesignation({ flightNumber, stationCode, asOfDate,
                                    carrierCode = null,
                                    designationType = 'PRIMARY', tx = null }) {
    const base = { designation_type: designationType };
    const scopeFields = ['carrier_code'];

    // ---- RUNG 1: THE FLIGHT ------------------------------------------
    // A flight row may name a station too (this flight, at this station) or
    // leave it null (this flight, anywhere). resolveEffective ranks the
    // more specific one first, which is exactly right at this rung.
    if (flightNumber) {
        const r = await resolveEffective({
            entity: E, tx, asOfDate,
            where: { ...base, flight_number: flightNumber },
            scope: { carrier_code: carrierCode, station_code: stationCode },
            scopeFields: ['carrier_code', 'station_code']
        });
        if (r.resolved) return { ...r, axis: AXIS.FLIGHT };
    }

    // ---- RUNG 2: THE STATION -----------------------------------------
    // flight_number: null is REQUIRED and is not a tidiness filter. Without
    // it, a designation for a DIFFERENT flight that happens to name this
    // station would answer this question - the over-matching join arriving
    // one rung down from where it was guarded against.
    if (stationCode) {
        const r = await resolveEffective({
            entity: E, tx, asOfDate,
            where: { ...base, flight_number: null },
            scope: { carrier_code: carrierCode, station_code: stationCode },
            scopeFields: ['carrier_code', 'station_code']
        });
        if (r.resolved) return { ...r, axis: AXIS.STATION };
    }

    // ---- RUNG 3: nothing, and that is an answer ---------------------------
    return {
        resolved: false, axis: AXIS.NONE, row: null,
        reason: `No designation for ${flightNumber || '(no flight)'} at `
              + `${stationCode || '(no station)'} as at ${asOfDate}. `
              + `The order is created with an empty supplier.`,
        evidence: { source: E, as_of: asOfDate, candidates: 0 }
    };
}

/**
 * What an order should be created with. Flattens the designation into the
 * fields FUEL_ORDERS actually has, and says which axis produced them.
 *
 * Returns nulls rather than throwing when nothing resolves — capture is never
 * blocked.
 */
function orderDefaultsFrom(result) {
    if (!result.resolved) {
        return { supplier_ID: null, contract_ID: null,
                 into_plane_agent_ID: null, into_plane_contract_ID: null,
                 designation_axis: AXIS.NONE };
    }
    const d = result.row;
    // supplier_performs_uplift TRUE means the supplier fuels its own product,
    // so the agent fields stay EMPTY — a different state from "not known yet",
    // and the axis beside them is what tells the two apart.
    const performs = d.supplier_performs_uplift === true;
    return {
        supplier_ID: d.supplier_ID ?? null,
        contract_ID: d.supplier_contract_ID ?? null,
        into_plane_agent_ID: performs ? null : (d.into_plane_agent_ID ?? null),
        into_plane_contract_ID: performs ? null : (d.into_plane_contract_ID ?? null),
        designation_axis: result.axis
    };
}

module.exports = { resolveDesignation, orderDefaultsFrom, AXIS };

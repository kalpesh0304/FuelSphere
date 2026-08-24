/**
 * FuelSphere - deriving the gauge uplift where the readings do not exist
 * (WP-34, defect D41, 01-TARGET-SCHEMA section 5)
 *
 * fob_before_kg and fob_after_kg are what the FOB reconciliation compares
 * against the tickets. NEITHER IS A STANDARD ACARS REPORT. The OOOI set
 * carries fuel at OUT, OFF, ON and IN, and refuelling is not an OOOI event.
 * A refuelling-panel downlink can be configured per fleet but has no
 * operational value to ops control and is billed per message, so frequently
 * it is not.
 *
 * IN and OUT serve as proxies, adjusted for the APU burn between them:
 *
 *     uplift by gauge  =  fob_OUT  -  fob_IN  +  ground APU burn
 *
 * The sign is PLUS. APU burn REDUCED the fuel between the two readings, so
 * recovering the uplift means adding it back.
 *
 *     fob_IN              2,400
 *       APU burns            70  ->  2,330
 *       uplift            2,600  ->  4,930
 *       APU burns            30  ->  4,900   fob_OUT
 *
 *     4,900 - 2,400 + 100  =  2,600
 *
 * NOT CIRCULAR: APU burn derives from cycle minutes and the per-tail rate
 * (WP-19, srv/lib/apu-burn.js), not from any fuel reading.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE REFUSES TO DO, AND WHY THAT IS THE POINT
 *
 * Section 5's precision ladder has a row marked NOT OFFERED:
 *
 *     IN/OUT with no APU adjustment  |  CONTAMINATED  |  Not offered
 *
 * It is the dangerous one. It produces a real-looking number with hundreds of
 * kilograms of APU burn inside it and nothing distinguishes it from a genuine
 * variance. So where the APU burn for the turn is absent or unknown, this
 * module REFUSES to derive rather than deriving without the adjustment.
 *
 * Absence of a cycle is not evidence the APU stayed off. The two are
 * indistinguishable from here, and one of them is a 500 kg error.
 * ---------------------------------------------------------------------------
 */

const cds = require('@sap/cds');
const { SELECT, UPDATE } = cds.ql;
const { PHASE } = require('./apu-burn');

const FS = 'fuelsphere.FLIGHT_SCHEDULE';
const FD = 'fuelsphere.FUEL_DELIVERIES';
const FO = 'fuelsphere.FUEL_ORDERS';
const AU = 'fuelsphere.APU_USAGE';

/** The value this module writes. A delivery marked with it was RECONSTRUCTED. */
const DERIVED_SOURCE = 'ACARS_DERIVED';

/**
 * Sources that mean a reading was measured off the aircraft. A delivery
 * already carrying one of these is never overwritten by a derivation - a
 * measurement beats a reconstruction every time.
 */
const MEASURED_SOURCES = ['ACARS', 'CREW_REPORTED', 'PANEL_PRESET'];

/**
 * The APU phases that fall inside a turnaround: after the arriving leg came
 * on blocks, before the departing leg went off them.
 *
 * OVERNIGHT, PARKED and MAINTENANCE are deliberately excluded - WP-19
 * allocates them to NEITHER flight, and twelve hours of parked APU inside a
 * turnaround uplift would be pure invention. IN_FLIGHT is excluded because it
 * is not ground burn.
 */
const TURNAROUND_PHASES = [PHASE.POST_ARRIVAL, PHASE.PRE_DEPARTURE];

// Codes assigned from section 8 of CLAUDE.md and 03-VALIDATION-RULES.md.
// EPD401-411 and EPD450-475 are in use; these continue the block.
const EPD_NO_FLIGHT      = 'EPD476';  // the departing leg cannot be resolved
const EPD_READING_ABSENT = 'EPD477';  // an operand of the derivation is absent
const EPD_NO_APU         = 'EPD478';  // no APU cycle covers the turn - NOT OFFERED
const EPD_APU_UNKNOWN    = 'EPD479';  // a cycle is open or carries no burn
const EPD_MEASURED       = 'EPD480';  // a measured reading already exists

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * The pure computation, separated from the database so the arithmetic can be
 * exercised without constructing a turnaround to observe it - the same split
 * WP-17 uses for reconcile().
 *
 * @param {object} o  fobInKg, fobOutKg, apuBurnKg
 * @returns {{fob_delta_kg, ground_burn_kg, evidence}}
 */
function deriveUplift({ fobInKg, fobOutKg, apuBurnKg }) {
    const fobIn = num(fobInKg);
    const fobOut = num(fobOutKg);
    const apu = num(apuBurnKg);

    if (fobIn === null || fobOut === null) {
        return { error: `${EPD_READING_ABSENT}: the derivation needs both an arrival reading `
            + `and an OUT reading. fob_at_arrival_kg=${fobIn === null ? 'null' : fobIn}, `
            + `fob_at_out_kg=${fobOut === null ? 'null' : fobOut}.` };
    }
    // Not a null check dressed as a guard: section 5's NOT OFFERED row. An
    // unadjusted IN/OUT figure is contaminated, not approximate.
    if (apu === null) {
        return { error: `${EPD_NO_APU}: no APU adjustment is available for this turn. `
            + `An unadjusted OUT minus IN carries the ground APU burn inside it and is `
            + `indistinguishable from a supplier discrepancy. Not offered.` };
    }

    const delta = Number((fobOut - fobIn + apu).toFixed(2));
    return {
        fob_delta_kg: delta,
        // Section 5: on the derived path ground_burn_kg is an INPUT to the
        // calculation rather than an output of it. Same field, opposite
        // direction, and the delivery records which by carrying ACARS_DERIVED.
        ground_burn_kg: Number(apu.toFixed(2)),
        evidence: `fob_at_out ${fobOut} - fob_at_arrival ${fobIn} + APU ${apu} = ${delta} kg `
            + `(derived, ${DERIVED_SOURCE})`
    };
}

/**
 * Total ground APU burn across a turnaround.
 *
 * Summed by TAIL AND TIME WINDOW rather than by WP-19's flight allocation,
 * because the turnaround spans two legs: POST_ARRIVAL belongs to the arriving
 * flight and PRE_DEPARTURE to the departing one. Section 5 is explicit that
 * the split does not matter here - total ground APU is sufficient, and the
 * split matters only for cost allocation. Two purposes, two requirements.
 *
 * @returns {{apuBurnKg, cycles}|{error}}
 */
async function groundApuBurn(tailNumber, fromUtc, toUtc, db) {
    const cycles = await db.run(SELECT.from(AU)
        .columns('ID', 'apu_burn_kg', 'is_open', 'usage_phase', 'apu_start_utc')
        // BETWEEN, not an object carrying two comparison keys. `{ '>=': a,
        // '<=': b }` compiles and runs and applies ONE of the two bounds, so
        // the window degrades to "any cycle before departure" and sweeps in
        // every earlier turn for that tail. Measured here: it returned four
        // cycles for a two-cycle turn and 201.25 kg of APU where 105 burned.
        //
        // A 96 kg over-adjustment is the phantom-burn error this module was
        // written to prevent, arriving through the query rather than through
        // the arithmetic. It looked like a working filter.
        .where({
            tail_number: tailNumber,
            usage_phase: { in: TURNAROUND_PHASES },
            apu_start_utc: { between: fromUtc, and: toUtc }
        }));

    if (!cycles.length) {
        return { error: `${EPD_NO_APU}: no APU cycle recorded for ${tailNumber} between `
            + `${fromUtc} and ${toUtc}. An absent cycle is not evidence the APU stayed off, `
            + `and an unadjusted OUT minus IN is not offered.` };
    }

    // Unknown is not zero. One open cycle makes the total unknown, not short -
    // the same rule WP-19 applies in applyBurnSplit.
    const unknown = cycles.filter(c => c.is_open || num(c.apu_burn_kg) === null);
    if (unknown.length) {
        return { error: `${EPD_APU_UNKNOWN}: ${unknown.length} of ${cycles.length} APU cycles `
            + `in this turn are open or carry no burn figure. The total is unknown, not zero.` };
    }

    const total = cycles.reduce((s, c) => s + Number(c.apu_burn_kg), 0);
    return { apuBurnKg: Number(total.toFixed(2)), cycles: cycles.length };
}

/**
 * Resolve the two legs of the turnaround for a delivery.
 *
 * The DEPARTING leg comes through the order. The ARRIVING leg is the latest
 * flight for the same tail that came on blocks at or before this one went off
 * blocks.
 *
 * linked_flight_number is NOT used. Its own schema comment reads
 * "Previous/next leg flight number" - it does not say which, and a derivation
 * that guessed the direction would silently take the wrong turnaround.
 */
async function resolveTurnaround(delivery, db) {
    if (!delivery.order_ID) {
        return { error: `${EPD_NO_FLIGHT}: the delivery carries no order, so the departing `
            + `leg cannot be resolved. Orders resolve transitively through the tickets `
            + `(decision B2) and this derivation needs the leg itself.` };
    }
    const order = await db.run(SELECT.one.from(FO).columns('ID', 'flight_ID')
        .where({ ID: delivery.order_ID }));
    if (!order || !order.flight_ID) {
        return { error: `${EPD_NO_FLIGHT}: order ${delivery.order_ID} carries no flight.` };
    }

    const departing = await db.run(SELECT.one.from(FS)
        .columns('ID', 'flight_number', 'flight_date', 'aircraft_reg', 'aobt', 'fob_at_out_kg')
        .where({ ID: order.flight_ID }));
    if (!departing) {
        return { error: `${EPD_NO_FLIGHT}: flight ${order.flight_ID} not found.` };
    }
    if (!departing.aobt) {
        return { error: `${EPD_READING_ABSENT}: flight ${departing.flight_number} has no aobt, `
            + `so the turnaround has no closing boundary.` };
    }

    const arriving = await db.run(SELECT.one.from(FS)
        .columns('ID', 'flight_number', 'flight_date', 'aibt')
        .where({ aircraft_reg: departing.aircraft_reg, aibt: { '<=': departing.aobt } })
        .orderBy({ aibt: 'desc' }));
    if (!arriving || !arriving.aibt) {
        return { error: `${EPD_READING_ABSENT}: no arriving leg found for `
            + `${departing.aircraft_reg} on or before ${departing.aobt}, so the turnaround `
            + `has no opening boundary.` };
    }

    return { departing, arriving };
}

/**
 * Read a delivery, derive its gauge uplift, and store the result.
 *
 * WHAT IT WRITES AND WHAT IT DELIBERATELY DOES NOT:
 *
 *   fob_delta_kg    the derived uplift
 *   ground_burn_kg  the APU adjustment, recorded as the INPUT it is here
 *   fob_source      ACARS_DERIVED
 *
 *   fob_before_kg and fob_after_kg are LEFT NULL. They were never read. The
 *   schema warns against copying one reading into another because it
 *   manufactures a figure where the truth is unknown; splitting a derived
 *   delta into a fabricated pair is the same error with more arithmetic.
 */
async function deriveDeliveryUplift(deliveryId, srv) {
    const db = srv || cds.db;

    const delivery = await db.run(SELECT.one.from(FD)
        .columns('ID', 'order_ID', 'aircraft_reg', 'fob_source',
                 'fob_at_arrival_kg', 'fob_before_kg', 'fob_after_kg')
        .where({ ID: deliveryId }));
    if (!delivery) return { error: `${EPD_NO_FLIGHT}: delivery ${deliveryId} not found.` };

    // A measurement is never overwritten by a reconstruction.
    if (MEASURED_SOURCES.includes(delivery.fob_source)
        && num(delivery.fob_before_kg) !== null && num(delivery.fob_after_kg) !== null) {
        return { error: `${EPD_MEASURED}: this delivery already carries a measured gauge pair `
            + `(${delivery.fob_source}). A derivation never replaces a reading.` };
    }

    const legs = await resolveTurnaround(delivery, db);
    if (legs.error) return legs;
    const { departing, arriving } = legs;

    const apu = await groundApuBurn(departing.aircraft_reg, arriving.aibt, departing.aobt, db);
    if (apu.error) return apu;

    const derived = deriveUplift({
        fobInKg: delivery.fob_at_arrival_kg,
        fobOutKg: departing.fob_at_out_kg,
        apuBurnKg: apu.apuBurnKg
    });
    if (derived.error) return derived;

    await db.run(UPDATE(FD).set({
        fob_delta_kg: derived.fob_delta_kg,
        ground_burn_kg: derived.ground_burn_kg,
        fob_source: DERIVED_SOURCE
    }).where({ ID: deliveryId }));

    return {
        deliveryId,
        fobSource: DERIVED_SOURCE,
        // APU401's rule, applied here: every figure is derived and a consumer
        // must be able to tell that without inference.
        derived: true,
        fobDeltaKg: derived.fob_delta_kg,
        groundBurnKg: derived.ground_burn_kg,
        arrivingFlight: `${arriving.flight_number} ${arriving.flight_date}`,
        departingFlight: `${departing.flight_number} ${departing.flight_date}`,
        apuCycles: apu.cycles,
        evidence: derived.evidence
    };
}

module.exports = {
    DERIVED_SOURCE, MEASURED_SOURCES, TURNAROUND_PHASES,
    EPD_NO_FLIGHT, EPD_READING_ABSENT, EPD_NO_APU, EPD_APU_UNKNOWN, EPD_MEASURED,
    deriveUplift, groundApuBurn, resolveTurnaround, deriveDeliveryUplift
};

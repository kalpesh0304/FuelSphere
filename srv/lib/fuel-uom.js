/**
 * FuelSphere - Fuel unit conversion (WP-11 / decision A2)
 *
 * A2: planning in kilograms, order and delivery in litres. Density is the
 * conversion between them.
 *
 * ── The factor this module uses, and the one it must not ──────────────────
 *
 * The plan-to-order conversion resolves from UNIT_OF_MEASURE.conversion_to_kg
 * on the target volume unit, and the row that produced it is recorded on the
 * order. That is a GENERIC PLANNING FACTOR, correct for turning a plan mass
 * into an order volume, which is a forward estimate.
 *
 * It is NOT a delivered density. Decision B6 makes the density measured on the
 * ticket authoritative for deriving ticket mass. Two densities, two jobs; do
 * not reach for this one at the delivery end.
 *
 * It must also never be used for anything that has to agree with SAP. SAP's
 * material master MARM carries its own litre-to-kilogram factor and is
 * authoritative. If the two differ, the gap surfaces as a phantom variance in
 * stock reconciliation, layered on top of the genuine density variance.
 * Settlement, valuation and reconciliation all use SAP's factor, not this one.
 *
 * When WP-13 lands, resolution moves into the parameter framework and
 * conversion_source records the parameter row instead of the UoM row. The
 * field exists now so that migration is a value change, not a schema change.
 */

const cds = require('@sap/cds');
const { SELECT } = cds.ql;

const UOM = 'fuelsphere.UNIT_OF_MEASURE';

/**
 * Fallback volume unit. NOT a rule — the unit is the supplier's choice under
 * AFSMA, and resolution is supplier contract, then station, then this. The
 * first two arrive with WP-13.
 */
const DEFAULT_VOLUME_UOM = 'LTR';
const DEFAULT_VOLUME_UOM_SOURCE = 'WP11_CONSTANT';

/**
 * WP-13 — the default volume unit, resolved from TOLERANCE_RULES.
 *
 * It is a FALLBACK, not a rule: 01-TARGET-SCHEMA §5 puts the resolution order
 * at supplier contract, then station, then this. Moving it into the store is
 * what makes the first two expressible later — a scoped row per station is a
 * row, where a constant would have needed code.
 *
 * The constant is retained as the last resort with its own source label.
 */
async function resolveDefaultVolumeUom(scope = {}, asOfDate = null, tx = null) {
    const { resolveParameter } = require('./parameter-store');
    const r = await resolveParameter('DEFAULT_VOLUME_UOM', scope, asOfDate, tx);
    return r.resolved
        ? { uom: r.value, source: `TOLERANCE_RULES:${r.evidence.parameter_id}`, evidence: r.evidence }
        : { uom: DEFAULT_VOLUME_UOM, source: DEFAULT_VOLUME_UOM_SOURCE, fallbackReason: r.reason };
}

/** Where a resolved factor came from, recorded on the order. */
const SOURCE_UOM_MASTER = 'UOM_MASTER';

/**
 * Resolve the planning conversion factor for a volume unit.
 * @returns {Promise<{density:number, source:string, uom:string}|null>}
 */
async function resolvePlanningDensity(uomCode = DEFAULT_VOLUME_UOM) {
    const row = await SELECT.one.from(UOM)
        .columns('uom_code', 'uom_category', 'conversion_to_kg')
        .where({ uom_code: uomCode });

    if (!row || row.conversion_to_kg === null || row.conversion_to_kg === undefined) return null;
    const density = Number(row.conversion_to_kg);
    if (!(density > 0)) return null;

    return { density, source: SOURCE_UOM_MASTER, uom: row.uom_code };
}

/**
 * Convert a plan mass in kilograms into an order volume.
 *
 * Returns the volume together with the evidence needed to reproduce it, or
 * null when no factor resolves — in which case the caller leaves the quantity
 * alone rather than inventing one. A derived value with a missing input is
 * null, never zero.
 */
async function planMassToOrderVolume(massKg, uomCode = DEFAULT_VOLUME_UOM) {
    const mass = Number(massKg);
    if (!(mass > 0)) return null;

    const resolved = await resolvePlanningDensity(uomCode);
    if (!resolved) return null;

    return {
        quantity: Number((mass / resolved.density).toFixed(2)),
        uom_code: resolved.uom,
        conversion_density: resolved.density,
        conversion_source: resolved.source,
        ordered_quantity_kg: Number(mass.toFixed(2))
    };
}

/** The fields an order carries to make the conversion reproducible. */
function conversionFields(c) {
    return c && {
        ordered_quantity: c.quantity,
        uom_code: c.uom_code,
        conversion_density: c.conversion_density,
        conversion_source: c.conversion_source,
        ordered_quantity_kg: c.ordered_quantity_kg
    };
}

// ===========================================================================
// WP-12 — delivered measurement. Decisions B5 and B6.
//
// Everything below converts a MEASURED figure. It is a different job from
// the planning conversion above and uses a different input: the density on
// the ticket, measured at delivery, which decision B6 makes authoritative.
// Do not reach for resolvePlanningDensity here.
// ===========================================================================

/**
 * Density units, IATA VUOMBase. The value is kg per one of these.
 * Kept in step with type DensityUom in db/schema.cds.
 */
const DENSITY_UOM_LITRES_PER_UNIT = {
    KGL: 1,        // kg per litre
    KGM: 1000      // kg per cubic metre = kg per 1000 litres
};

/**
 * Litres per one unit of a metered volume unit.
 *
 * LTR only, and deliberately so. A gallon-to-litre factor exists nowhere in
 * master data: UNIT_OF_MEASURE.conversion_to_kg on GAL is kilograms per
 * gallon at an assumed density, not a volume ratio. Dividing it by the LTR
 * factor does recover 3.7854 litres per gallon, but only while both rows
 * were computed at the same nominal density — an unstated coupling that
 * breaks silently the day somebody edits one row and not the other.
 *
 * So gallons derive no mass here and say why, rather than carrying a number
 * whose correctness depends on an assumption nobody recorded. Same reasoning
 * as the blank SAP gallon codes in WP-11. Tracked as open point F19.
 */
const LITRES_PER_VOLUME_UNIT = {
    LTR: 1
};

/** Volume units this module can turn into mass. */
function isConvertibleVolumeUom(uomCode) {
    return Object.prototype.hasOwnProperty.call(LITRES_PER_VOLUME_UNIT, uomCode);
}

/**
 * Is this a mass unit?
 *
 * Read from UNIT_OF_MEASURE.uom_category rather than a list in code, so a
 * new unit is a data change. Returns null where the unit does not resolve —
 * unknown is not "no".
 */
async function isMassUom(uomCode) {
    if (!uomCode) return null;
    const row = await SELECT.one.from(UOM).columns('uom_code', 'uom_category').where({ uom_code: uomCode });
    if (!row || !row.uom_category) return null;
    return row.uom_category === 'MASS';
}

/**
 * Derive a ticket's canonical mass in kilograms.
 *
 * This is EPD453 — quantity_kg from quantity_metered and density_value —
 * and it is the reason quantity_kg exists: a gallon ticket and a litre
 * ticket on the same aircraft have to be summable against one gauge delta.
 *
 * Returns { quantity_kg, basis } on success, or { quantity_kg: null, reason }
 * where an input is missing or the units do not resolve. Never returns zero
 * for a missing input — a derived value with a missing input is null.
 */
async function deriveTicketMassKg({ quantity_metered, uom_code, density_value, density_uom }) {
    const metered = Number(quantity_metered);
    if (!(metered > 0)) return { quantity_kg: null, reason: 'no metered quantity' };
    if (!uom_code) return { quantity_kg: null, reason: 'no uom_code on the ticket' };

    const row = await SELECT.one.from(UOM)
        .columns('uom_code', 'uom_category', 'conversion_to_kg')
        .where({ uom_code });
    if (!row) return { quantity_kg: null, reason: `unit ${uom_code} is not in UNIT_OF_MEASURE` };

    // A mass ticket needs no density. Its own master factor takes it to
    // kilograms — KG by 1, MT by 1000.
    if (row.uom_category === 'MASS') {
        const factor = Number(row.conversion_to_kg);
        if (!(factor > 0)) return { quantity_kg: null, reason: `no conversion factor on unit ${uom_code}` };
        return {
            quantity_kg: Number((metered * factor).toFixed(2)),
            basis: `mass unit ${uom_code} x ${factor} kg`
        };
    }

    // A volume ticket needs the density measured at delivery.
    const density = Number(density_value);
    if (!(density > 0)) return { quantity_kg: null, reason: 'no density_value on the ticket' };
    if (!density_uom) return { quantity_kg: null, reason: 'no density_uom, so density_value has no meaning' };

    const litresPerDensityUnit = DENSITY_UOM_LITRES_PER_UNIT[density_uom];
    if (!litresPerDensityUnit) return { quantity_kg: null, reason: `density unit ${density_uom} is not recognised` };

    if (!isConvertibleVolumeUom(uom_code)) {
        return { quantity_kg: null, reason: `no litre factor for ${uom_code} — see open point F19` };
    }
    const litres = metered * LITRES_PER_VOLUME_UNIT[uom_code];

    return {
        quantity_kg: Number((litres * density / litresPerDensityUnit).toFixed(2)),
        basis: `${litres} L x ${density} ${density_uom}`
    };
}

/**
 * Aircraft gauge arithmetic — decision B5.
 *
 * Both figures are kilograms unconditionally; an FQIS reports mass, so
 * there is no unit to resolve.
 *
 * ground_burn_kg is derived ONLY where both arrival and before readings
 * exist as separate measurements. Where one is missing it stays null. It
 * must never be computed by copying one reading into the other, which
 * manufactures a zero ground burn where the truth is unknown — and a zero
 * reads as "no APU burn", which is a claim, not an absence.
 */
function deriveGaugeFigures({ fob_at_arrival_kg, fob_before_kg, fob_after_kg }) {
    const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
    const arrival = num(fob_at_arrival_kg);
    const before = num(fob_before_kg);
    const after = num(fob_after_kg);

    return {
        fob_delta_kg: (before !== null && after !== null)
            ? Number((after - before).toFixed(2)) : null,
        ground_burn_kg: (arrival !== null && before !== null)
            ? Number((arrival - before).toFixed(2)) : null
    };
}

module.exports = {
    DEFAULT_VOLUME_UOM,
    DEFAULT_VOLUME_UOM_SOURCE,
    resolveDefaultVolumeUom,
    SOURCE_UOM_MASTER,
    resolvePlanningDensity,
    planMassToOrderVolume,
    conversionFields,
    isMassUom,
    deriveTicketMassKg,
    deriveGaugeFigures
};

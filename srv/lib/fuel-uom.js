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

module.exports = {
    DEFAULT_VOLUME_UOM,
    SOURCE_UOM_MASTER,
    resolvePlanningDensity,
    planMassToOrderVolume,
    conversionFields
};

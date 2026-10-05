const cds = require('@sap/cds');
const { SELECT } = cds.ql;

/**
 * FuelSphere - carbon emission from burnt and uplifted fuel.
 *
 * ONE FACTOR, ONE PLACE. Kilograms of CO2 per kilogram of fuel, read from the
 * parameter store rather than written into the code: it is a published figure
 * that changes with the fuel and with whoever is auditing it, and a number
 * compiled into a handler is a number nobody can correct.
 *
 * THE PARAMETER IS SCOPED BY FUEL TYPE, which is what was asked for. The row
 * for JET_FUEL carries 3.16 - the Jet A-1 figure - and a row with no
 * product_type is the fallback for records that do not name their fuel, which
 * is most of them: a burn is a mass of kerosene out of a tank and nothing in
 * FUEL_BURNS says which kerosene. Add AVGAS when somebody uplifts any.
 *
 * WHERE IT IS USED:
 *   Fuel Overview Report  (FOB out - FOB in) x factor, per leg
 *   Fuel ticket           uplift kg x factor, projected
 *
 * The ticket figure is the one headed for SAP Green Ledger. It is PROJECTED,
 * not measured: the fuel is in the wing, not yet burnt, and the leg it is
 * burnt on may be a different leg entirely.
 */

const RULE_CODE = 'PARAM-CO2-FACTOR';
const PARAMETERS = 'fuelsphere.TOLERANCE_RULES';

const num = (v) => (v === null || v === undefined ? null : Number(v));
const round3 = (v) => (v === null ? null : Number(Number(v).toFixed(3)));

/**
 * The factor for a fuel type, or the unscoped one.
 *
 * Returns null where neither exists. A null factor means no emission figure
 * anywhere it is used - which is the honest outcome of a missing parameter,
 * and visibly different from an emission of zero.
 */
async function co2Factor(productType) {
    const rows = await cds.db.run(SELECT.from(PARAMETERS)
        .columns('value_number', 'product_type', 'is_active')
        .where({ rule_code: RULE_CODE }));

    const active = rows.filter(r => r.is_active !== false && num(r.value_number) !== null);
    if (!active.length) return null;

    const scoped = productType && active.find(r => r.product_type === productType);
    const global = active.find(r => !r.product_type);
    const row = scoped || global || active[0];
    return num(row.value_number);
}

/**
 * The fuel burnt on a leg, by the formula asked for: FOB out minus FOB in.
 *
 * NOT actual_burn_kg, even though it usually equals it. The brief named the
 * two gauge readings, and they are what an auditor can check against the
 * aircraft; actual_burn_kg can also arrive from ACARS, be corrected by hand,
 * or be an estimate. Where the pair is missing the recorded burn is used and
 * the row says which basis it is on.
 */
function burnKgFor(row) {
    // fqis_out_kg / fqis_in_kg are what burn-summary.js puts on the row from
    // the flight's gauges; the other two names are the flight's own columns,
    // for callers that hand over a flight rather than a burn.
    const out = num(row.fqis_out_kg ?? row.fob_out_kg ?? row.fob_at_out_kg);
    const inn = num(row.fqis_in_kg ?? row.fob_in_kg ?? row.fob_at_in_kg);
    if (out !== null && inn !== null) return { kg: out - inn, basis: 'FOB out - FOB in' };

    const recorded = num(row.actual_burn_kg);
    if (recorded !== null) return { kg: recorded, basis: 'recorded burn' };
    return { kg: null, basis: null };
}

/** Emission for a set of burn rows, in place. */
async function applyBurnEmissions(rows) {
    const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
    if (!list.length) return;

    const factor = await co2Factor(null);
    for (const r of list) {
        const { kg, basis } = burnKgFor(r);
        r.co2_factor_v = factor;
        r.carbon_emission_kg = (factor !== null && kg !== null) ? round3(kg * factor) : null;
        r.carbon_basis_v = (factor !== null && kg !== null) ? basis : null;
    }
}

/** Projected emission for a set of ticket rows, in place. */
async function applyTicketEmissions(rows) {
    const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
    if (!list.length) return;

    const factor = await co2Factor(null);
    for (const r of list) {
        const kg = num(r.quantity_kg);
        r.co2_factor_v = factor;
        r.carbon_projected_kg = (factor !== null && kg !== null) ? round3(kg * factor) : null;
    }
}

module.exports = { co2Factor, burnKgFor, applyBurnEmissions, applyTicketEmissions, RULE_CODE };

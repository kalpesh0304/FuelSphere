/**
 * FuelSphere - FOB reconciliation (WP-17, decisions B2, B5, C-1)
 *
 * The control the delivery design exists for: two independent measurements of
 * one physical event, compared.
 *
 *     metered mass = SUM( ticket.quantity_kg )     the bowser meters, per bowser
 *     FQIS mass    = fob_after_kg - fob_before_kg  the aircraft gauge, per event
 *     variance     = metered - FQIS                EPD461
 *
 * Computed at DELIVERY level, always. A widebody uplift with two bowsers has
 * one FQIS pair spanning both tickets, so the comparison can sit on neither
 * ticket. Parallel bowsers make this structural rather than incidental.
 */

const cds = require('@sap/cds');
const { SELECT, UPDATE } = cds.ql;

// ===========================================================================
// TOLERANCE - a stated placeholder with a migration path
//
// No tolerance framework exists yet. TOLERANCE_RULES is seeded and read by
// nothing; WP-13 is the package that reads it. These values move into
// TOLERANCE_RULES UNCHANGED at WP-13, the same way section 5 says the density
// bounds and the temperature range will move.
//
// They are named and documented rather than inlined at the comparison. A
// buried literal is what D16 was, and WP-05 removed it.
//
// Why the source matters: without ACARS, fuel on board is crew-reported and
// typically rounded to 100 kg. That is 0.9% of a narrowbody uplift and 25% of
// a small top-up, so an ACARS delivery and a crew-reported one cannot be held
// to the same threshold. The crew floor is that 100 kg rounding doubled - the
// error can fall either way on each of two readings.
//
// A percentage alone cannot work, which is what the floors are for: 0.5% of a
// 400 kg top-up is 2 kg, well inside the noise of any gauge.
// ===========================================================================

const TOLERANCE_BY_FOB_SOURCE = {
    ACARS:         { percent: 0.5, floorKg: 50,  note: 'downlinked, high confidence' },
    CREW_REPORTED: { percent: 1.5, floorKg: 200, note: '100 kg rounding, doubled' },
    // What was requested, not what arrived. Held to the crew threshold because
    // its error is at least as large, never smaller.
    PANEL_PRESET:  { percent: 1.5, floorKg: 200, note: 'treated as CREW_REPORTED' }
    // NONE is deliberately absent. There is no reading, so there is no
    // comparison to hold to a threshold - see resolveTolerance.
};

/** Where these came from, recorded on every result so a status is traceable. */
const TOLERANCE_SOURCE = 'WP17_CONSTANT';

const STATUS = {
    RECONCILED:      'RECONCILED',
    VARIANCE:        'VARIANCE',
    NOT_RECONCILED:  'NOT_RECONCILED',
    NOT_ATTRIBUTABLE: 'NOT_ATTRIBUTABLE'
};

/**
 * Resolve the tolerance for a gauge source.
 * Returns null where no comparison can be made at all.
 */
/**
 * WP-13 — the same tolerance, resolved from TOLERANCE_RULES.
 *
 * The constants below are retained as the last resort and keep their own
 * source label, so a fallback is never mistaken for configuration. CFG401
 * requires a global row to exist, so reaching the constant means the row was
 * deleted.
 *
 * The rule code carries fob_source because TOLERANCE_RULES has no scope
 * column for it — company, supplier category and product type are the three,
 * and a gauge source is none of them. TOL-FOB-ACARS and its two siblings.
 */
async function resolveToleranceFromStore(fobSource, scope = {}, asOfDate = null, tx = null) {
    if (!fobSource || fobSource === 'NONE') return null;
    const { resolveToleranceRule } = require('./parameter-store');
    const t = await resolveToleranceRule({ ruleCode: `TOL-FOB-${fobSource}` }, scope, asOfDate, tx);
    if (!t.resolved) {
        const c = resolveTolerance(fobSource);
        return c ? { ...c, source: TOLERANCE_SOURCE, fallbackReason: t.reason } : null;
    }
    return {
        percent: Math.abs(Number(t.rule.upper_limit)),
        floorKg: t.rule.floor_value === null ? null : Math.abs(Number(t.rule.floor_value)),
        note: t.rule.description,
        source: `TOLERANCE_RULES:${t.evidence.rule_code}`,
        evidence: t.evidence
    };
}

function resolveTolerance(fobSource) {
    const rule = TOLERANCE_BY_FOB_SOURCE[fobSource];
    if (!rule) return null;
    return { ...rule, source: TOLERANCE_SOURCE };
}

/**
 * The tolerance in kilograms for a given metered mass.
 * The greater of the percentage and the absolute floor - EPD462.
 */
function toleranceKg(rule, meteredKg) {
    const pct = Math.abs(Number(meteredKg)) * rule.percent / 100;
    return Number(Math.max(pct, rule.floorKg).toFixed(2));
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * The pure computation. Separated from the database so the rules can be
 * exercised directly, without constructing a delivery to observe them.
 *
 * @param {object}   delivery  fob_source, fob_before_kg, fob_after_kg
 * @param {object[]} tickets   quantity_kg, and the supplier each resolves to
 * @returns {{recon_variance_kg, recon_status, supplier_count, evidence}}
 */
/**
 * WP-13 — `rule` is now a PARAMETER, not a lookup.
 *
 * This is a calculation and it stays synchronous and pure. Making it async so
 * it could resolve its own tolerance would push a database read into a
 * function whose whole value is that it has none — and it broke three cases
 * in WP-17's harness that call it directly, which is what caught it.
 *
 * Resolution happens at the EDGE, in reconcileDelivery and in the handler,
 * and the resolved rule is handed in. Omit it and the constant answers, with
 * its own source label so a fallback is never read as configuration.
 */
function reconcile(delivery, tickets, rule) {
    const suppliers = new Set();
    let unresolvedSupplier = 0;
    let unknownMass = 0;
    let meteredKg = 0;

    for (const t of tickets) {
        const kg = num(t.quantity_kg);
        // A ticket whose mass could not be derived leaves the metered total
        // UNKNOWN, not short. Summing the rest would understate the metered
        // side and manufacture a negative variance out of a missing density.
        if (kg === null) unknownMass++; else meteredKg += kg;

        if (t.supplier_ID) suppliers.add(t.supplier_ID); else unresolvedSupplier++;
    }

    const supplier_count = suppliers.size;
    const base = { supplier_count };

    // ---- Rule 1: unknown is not agreement -------------------------------
    //
    // NOT_RECONCILED must never read as a pass. No gauge reading, an
    // incomplete gauge pair, no ticket at all, or a ticket whose mass could
    // not be derived - in every one of those the comparison was not made, and
    // saying so is the only honest answer. No variance is computed, because a
    // variance figure would imply one was.
    if (!rule) rule = resolveTolerance(delivery.fob_source);
    const before = num(delivery.fob_before_kg);
    const after = num(delivery.fob_after_kg);

    if (!rule) {
        return { ...base, recon_variance_kg: null, recon_status: STATUS.NOT_RECONCILED,
            evidence: `fob_source ${delivery.fob_source || '(none)'} carries no reading` };
    }
    if (before === null || after === null) {
        return { ...base, recon_variance_kg: null, recon_status: STATUS.NOT_RECONCILED,
            evidence: 'gauge pair incomplete' };
    }
    if (!tickets.length) {
        return { ...base, recon_variance_kg: null, recon_status: STATUS.NOT_RECONCILED,
            evidence: 'no tickets on this delivery' };
    }
    if (unknownMass) {
        return { ...base, recon_variance_kg: null, recon_status: STATUS.NOT_RECONCILED,
            evidence: `${unknownMass} of ${tickets.length} tickets have no derivable mass` };
    }

    // ---- The comparison -------------------------------------------------
    const fqisKg = Number((after - before).toFixed(2));
    const variance = Number((meteredKg - fqisKg).toFixed(2));
    const tol = toleranceKg(rule, meteredKg);

    // ---- Rule 2: one gauge pair, two suppliers, one figure belonging to
    // neither. The variance is COMPUTED AND RECORDED - it is real, and it is
    // the input to bowser bias analysis later - but it is never attributed,
    // and it is never the basis of a dispute. Pro-rata allocation by volume
    // is arithmetically neat and evidentially worthless.
    //
    // A ticket with no resolvable supplier is the same problem wearing a
    // different hat: the supplier set is UNKNOWN, not a singleton, so a
    // single known supplier alongside an unmatched ticket is still not
    // attributable.
    if (supplier_count !== 1 || unresolvedSupplier) {
        return {
            ...base,
            recon_variance_kg: variance,
            recon_status: STATUS.NOT_ATTRIBUTABLE,
            evidence: unresolvedSupplier
                ? `${supplier_count} known supplier(s) and ${unresolvedSupplier} ticket(s) resolving to none`
                : `${supplier_count} suppliers on one gauge pair`
        };
    }

    // ---- Rule 3: the threshold came from the source ---------------------
    const within = Math.abs(variance) <= tol;
    return {
        ...base,
        recon_variance_kg: variance,
        recon_status: within ? STATUS.RECONCILED : STATUS.VARIANCE,
        evidence: `metered ${meteredKg} - FQIS ${fqisKg} = ${variance}; `
            + `tolerance ${tol} kg (${rule.percent}% or ${rule.floorKg} kg floor, ${delivery.fob_source}, ${rule.source})`
    };
}

/**
 * Read a delivery and its tickets, reconcile, and store the result.
 *
 * The supplier is resolved TRANSITIVELY - ticket to order to supplier. There
 * is no supplier on the ticket and no direct FK from delivery to order,
 * because a refuelling with two suppliers has two orders and one delivery
 * while a re-planned uplift has one order and two deliveries. A direct FK
 * breaks one of those.
 */
async function reconcileDelivery(deliveryId, srv) {
    const db = srv || cds.db;
    const D = 'fuelsphere.FUEL_DELIVERIES';

    const delivery = await db.run(SELECT.one.from(D)
        .columns('ID', 'fob_source', 'fob_before_kg', 'fob_after_kg')
        .where({ ID: deliveryId }));
    if (!delivery) return null;

    const tickets = await db.run(SELECT.from('fuelsphere.FUEL_TICKETS')
        .columns('ID', 'quantity_kg', 'order_ID')
        .where({ delivery_ID: deliveryId }));

    // Resolve each ticket's supplier through its order.
    const orderIds = [...new Set(tickets.map(t => t.order_ID).filter(Boolean))];
    const orders = orderIds.length
        ? await db.run(SELECT.from('fuelsphere.FUEL_ORDERS')
            .columns('ID', 'supplier_ID').where({ ID: { in: orderIds } }))
        : [];
    const supplierByOrder = Object.fromEntries(orders.map(o => [o.ID, o.supplier_ID]));

    const enriched = tickets.map(t => ({
        ...t,
        supplier_ID: t.order_ID ? (supplierByOrder[t.order_ID] || null) : null
    }));

    const storeRule = await resolveToleranceFromStore(
        delivery.fob_source, {}, delivery.delivery_date);
    const result = reconcile(delivery, enriched, storeRule);

    await db.run(UPDATE(D).set({
        recon_variance_kg: result.recon_variance_kg,
        recon_status: result.recon_status,
        supplier_count: result.supplier_count
    }).where({ ID: deliveryId }));

    return result;
}

module.exports = {
    resolveToleranceFromStore,
    TOLERANCE_BY_FOB_SOURCE,
    TOLERANCE_SOURCE,
    STATUS,
    resolveTolerance,
    toleranceKg,
    reconcile,
    reconcileDelivery
};

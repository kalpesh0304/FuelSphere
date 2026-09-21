/**
 * FuelSphere - the flight-level fuel variance.
 *
 * WHAT THE AIRCRAFT ENDED UP HOLDING, AGAINST WHAT WE WERE BILLED FOR:
 *
 *     variance = SUM( delivery.delivered_quantity )  for the flight
 *              - SUM( ticket.quantity_kg )           for the flight
 *
 * Positive means more fuel reached the aircraft than the tickets account for.
 * Negative means less - the commercially interesting direction, because that
 * is fuel invoiced and not received.
 *
 * WHY IT IS SCOPED TO THE FLIGHT and not to the delivery. fob-reconciliation.js
 * already compares one delivery's gauge pair against the tickets written to
 * THAT delivery, and that control is intact. But a leg fuelled through two
 * deliveries cannot reconcile there at all: neither delivery can see the
 * other's tickets, so each reports a variance the size of the other's uplift.
 * The flight is the level at which the fuel and the paperwork are both
 * complete.
 *
 * IT IS THE OPPOSITE SIGN TO EPD461, ON PURPOSE. That control reads metered
 * minus gauge and asks whether the supplier billed more than the aircraft
 * received. This reads delivered minus metered. Same two measurements, two
 * different questions, and a single signed number cannot answer both.
 *
 * KILOGRAMS ON BOTH SIDES. delivered_quantity is forced to KG at capture;
 * the ticket side uses quantity_kg, which is the metered quantity normalised
 * through its density (EPD453). The raw metered figure is in the ticket's own
 * unit - usually litres - and subtracting it from kilograms would produce a
 * number with no meaning that still looks like a variance.
 *
 * THE TOLERANCE IS THE EXISTING ONE, resolved through the same store and the
 * same greater-of-percentage-or-floor rule. Where a flight's deliveries were
 * gauged by different means, the LOOSEST band applies - the PANEL_PRESET
 * precedent in fob-reconciliation.js, where a mixed population is held to the
 * threshold whose error is at least as large, never smaller. Holding a
 * crew-reported reading to the ACARS band would manufacture exceptions.
 */

const cds = require('@sap/cds');
const { SELECT, UPDATE } = cds.ql;
const {
    resolveToleranceFromStore, resolveTolerance, toleranceKg, STATUS
} = require('./fob-reconciliation');

const D = 'fuelsphere.FUEL_DELIVERIES';
const T = 'fuelsphere.FUEL_TICKETS';

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const kg  = (v) => (v === null ? null : Number(Number(v).toFixed(2)));

/** Sum that stays null when nothing contributed, rather than reading as zero. */
function total(rows, pick) {
    let sum = null;
    for (const r of rows) {
        const v = pick(r);
        if (v === null || v === undefined) continue;
        sum = (sum === null ? 0 : sum) + Number(v);
    }
    return sum;
}

/**
 * Order the gauge sources by how much error they admit, loosest last.
 * Mirrors TOLERANCE_BY_FOB_SOURCE without duplicating its numbers: the rule
 * itself is still resolved from the store, this only decides WHICH source to
 * resolve when a flight's deliveries disagree.
 */
function loosestSource(sources) {
    const RANK = { ACARS: 1, ACARS_DERIVED: 2, PANEL_PRESET: 2, CREW_REPORTED: 2 };
    let best = null, bestRank = -1;
    for (const s of sources) {
        if (!s || s === 'NONE') continue;
        const r = RANK[s] === undefined ? 3 : RANK[s];
        if (r > bestRank) { bestRank = r; best = s; }
    }
    return best;
}

/**
 * The pure comparison, separated from the database so the rules can be
 * exercised without constructing a flight to observe them.
 *
 * @param {object[]} deliveries  delivered_quantity, fob_source
 * @param {object[]} tickets     quantity_kg
 * @param {object|null} rule     resolved tolerance, or null for the fallback
 */
function compareFlight(deliveries, tickets, rule) {
    const deliveredKg = total(deliveries, d => num(d.delivered_quantity));
    const meteredKg   = total(tickets,    t => num(t.quantity_kg));

    const evidence = {
        deliveries: deliveries.length,
        tickets: tickets.length,
        // Tickets present but unmassed - a litre ticket with no density. It
        // contributes nothing to the sum, so the variance would silently
        // report that fuel as missing.
        unmassedTickets: tickets.filter(t => num(t.quantity_kg) === null).length,
        toleranceSource: rule ? rule.source : null
    };

    // NOT_RECONCILED is not agreement. With no gauge reading, or no ticket to
    // compare it against, there is no comparison - and a variance of zero
    // would read as "checked, and they matched".
    if (deliveredKg === null || meteredKg === null) {
        return {
            flight_variance_kg: null,
            flight_variance_status: STATUS.NOT_RECONCILED,
            flight_metered_kg: kg(meteredKg),
            flight_delivered_kg: kg(deliveredKg),
            flight_tolerance_kg: null,
            evidence
        };
    }

    const variance = kg(deliveredKg - meteredKg);
    const band = rule ? toleranceKg(rule, meteredKg) : null;

    // An unmassed ticket makes the metered side incomplete, so the comparison
    // cannot be called either way - the figure is reported, the verdict is not.
    const status = evidence.unmassedTickets > 0
        ? STATUS.NOT_RECONCILED
        : (band === null
            ? STATUS.NOT_RECONCILED
            : (Math.abs(variance) <= band ? STATUS.RECONCILED : STATUS.VARIANCE));

    return {
        flight_variance_kg: variance,
        flight_variance_status: status,
        flight_metered_kg: kg(meteredKg),
        flight_delivered_kg: kg(deliveredKg),
        flight_tolerance_kg: band,
        evidence
    };
}

/**
 * Recompute the flight variance and write it to every delivery on the flight.
 *
 * WRITTEN TO ALL OF THEM, not just the one that triggered it: the figure is a
 * property of the leg, and a second delivery showing a stale variance beside
 * a fresh one is worse than showing none.
 *
 * @param {string} flightId
 * @returns {Promise<object|null>} the result, or null where nothing applied
 */
async function reconcileFlight(flightId, srv) {
    const db = srv || cds.db;
    if (!flightId) return null;

    const deliveries = await db.run(SELECT.from(D)
        .columns('ID', 'delivered_quantity', 'fob_source', 'delivery_date')
        .where({ flight_ID: flightId }));
    if (!deliveries.length) return null;

    const tickets = await db.run(SELECT.from(T)
        .columns('ID', 'quantity_kg').where({ flight_ID: flightId }));

    const source = loosestSource(deliveries.map(d => d.fob_source));
    const asOf = deliveries.map(d => d.delivery_date).filter(Boolean).sort()[0] || null;
    const rule = source
        ? (await resolveToleranceFromStore(source, {}, asOf) || resolveTolerance(source))
        : null;

    const result = compareFlight(deliveries, tickets, rule);

    await db.run(UPDATE(D).set({
        flight_variance_kg: result.flight_variance_kg,
        flight_variance_status: result.flight_variance_status,
        flight_metered_kg: result.flight_metered_kg,
        flight_delivered_kg: result.flight_delivered_kg,
        flight_tolerance_kg: result.flight_tolerance_kg
    }).where({ flight_ID: flightId }));

    return result;
}

/**
 * Recompute for whichever flight a delivery belongs to.
 *
 * A DELIVERY WITH NO FLIGHT STILL GETS AN ANSWER, computed against its own
 * tickets. Decision A1 permits a delivery with no flight reference, and a
 * blank variance column on those rows would read as the feature being broken
 * rather than as the scope genuinely not existing. The figure means the same
 * thing either way - delivered less metered - it is only gathered from a
 * narrower set.
 */
async function reconcileFlightForDelivery(deliveryId, srv) {
    const db = srv || cds.db;
    if (!deliveryId) return null;

    const delivery = await db.run(SELECT.one.from(D)
        .columns('ID', 'flight_ID', 'delivered_quantity', 'fob_source', 'delivery_date')
        .where({ ID: deliveryId }));
    if (!delivery) return null;
    if (delivery.flight_ID) return reconcileFlight(delivery.flight_ID, db);

    const tickets = await db.run(SELECT.from(T)
        .columns('ID', 'quantity_kg').where({ delivery_ID: deliveryId }));
    const rule = delivery.fob_source
        ? (await resolveToleranceFromStore(delivery.fob_source, {}, delivery.delivery_date)
            || resolveTolerance(delivery.fob_source))
        : null;

    const result = compareFlight([delivery], tickets, rule);
    await db.run(UPDATE(D).set({
        flight_variance_kg: result.flight_variance_kg,
        flight_variance_status: result.flight_variance_status,
        flight_metered_kg: result.flight_metered_kg,
        flight_delivered_kg: result.flight_delivered_kg,
        flight_tolerance_kg: result.flight_tolerance_kg
    }).where({ ID: deliveryId }));

    return result;
}

module.exports = { compareFlight, reconcileFlight, reconcileFlightForDelivery, loosestSource };

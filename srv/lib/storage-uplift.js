const cds = require('@sap/cds');

/**
 * An uplift drawn from a storage location — the mirror of a defuel.
 *
 * ===========================================================================
 * WHAT A DEFUEL DID, THIS UNDOES. A defuel took fuel off a tail and put it in
 * a tank: a pair of rows per batch, out of the aircraft and into the storage
 * location, each half carrying the same batch and the same rate. This takes
 * it back out of the tank and puts it on a tail, and it has to carry the SAME
 * batch and the SAME rate - because the fuel was never re-purchased.
 *
 * THAT IS THE WHOLE POINT OF STORING A BATCH. Fuel bought at 1.6394 and held
 * for a week is still fuel bought at 1.6394. Valuing it at today's price on
 * the way out would invent a gain or a loss that no transaction produced.
 *
 * OLDEST FIRST, out of the tank. FIFO applies inside a storage location just
 * as it does on a wing: the parcel that went in first comes out first.
 *
 * NO MONEY MOVES. There is no invoice, no vendor and no purchase - the
 * airline already owns this fuel. A ticket drawn from a tank therefore has no
 * rate of its own; the layers decide what it was worth.
 * ===========================================================================
 */

const MOVEMENTS = 'fuelsphere.FUEL_STOCK_MOVEMENT_LEDGER';
const BALANCES  = 'fuelsphere.FUEL_STOCK_BALANCE';

// An uplift sorts BEFORE the burns of the same instant: fuel is on board
// before it is consumed. The seeded replay uses 1 for UPLIFT.
const UPLIFT_LINE_ORDER = 1;

const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Move a balance, creating the row where the tail has not held this batch.
 *
 * VALUE FOLLOWS QUANTITY AT THE ROW'S OWN RATE, so a balance never drifts
 * from the quantity it states.
 */
async function addBalance(db, { method, tail, location, batch, deltaKg, like }) {
    const where = {
        valuation_method: method,
        tail_number: tail || null,
        storage_location: location || null,
        batch_ref: batch || null
    };
    const existing = await db.run(SELECT.one.from(BALANCES).where(where));
    const rate = Number((existing || like || {}).rate_usd_per_kg || 0);
    const now = new Date().toISOString();

    if (existing) {
        const q = r3(Number(existing.balance_qty_kg || 0) + deltaKg);
        const sg = existing.specific_gravity ?? (like || {}).specific_gravity ?? null;
        await db.run(UPDATE(BALANCES).set({
            balance_qty_kg: q,
            balance_qty_l: sg ? r2(q / Number(sg)) : null,
            value_usd: r2(q * rate),
            modified_at: now, modified_by: 'TICKET_SERVICE'
        }).where({ ID: existing.ID }));
        return;
    }

    const q = r3(deltaKg);
    const sg = (like || {}).specific_gravity ?? null;
    await db.run(INSERT.into(BALANCES).entries([{
        ID: cds.utils.uuid(),
        valuation_method: method,
        tail_number: tail || null,
        storage_location: location || null,
        batch_ref: batch || null,
        carrier_code: (like || {}).carrier_code || null,
        line_type: 'UPLIFT',
        station: (like || {}).station || null,
        balance_qty_kg: q,
        balance_qty_l: sg ? r2(q / Number(sg)) : null,
        specific_gravity: sg,
        rate_usd_per_kg: rate,
        value_usd: r2(q * rate),
        created_at: now, created_by: 'TICKET_SERVICE',
        modified_at: now, modified_by: 'TICKET_SERVICE'
    }]));
}

/**
 * Post an uplift that came out of a tank.
 *
 * Returns { ok, error } rather than raising, so the caller decides how to
 * surface it - the ticket service owns its own error vocabulary.
 */
async function postStorageUplift(db, ticket) {
    const code = ticket.storage_location_code;
    const tail = ticket.aircraft_reg;
    const qtyKg = r3(ticket.quantity_kg);

    if (!code) return { error: 'TKT441: no storage location was given for an uplift drawn from one.' };
    if (!tail) return { error: 'TKT442: an uplift needs a tail before it can be put on one.' };
    if (!(qtyKg > 0)) return { error: 'TKT443: the quantity uplifted must be greater than zero.' };

    const loc = await db.run(SELECT.one.from('fuelsphere.STORAGE_LOCATION')
        .columns('code', 'location_type', 'is_active').where({ code }));
    if (!loc) return { error: `TKT441: storage location ${code} does not exist.` };
    if (loc.is_active === false) return { error: `TKT441: ${code} is not active.` };

    // FUEL STAGED FOR A VENDOR DOES NOT GO BACK ON A WING. The configuration
    // already draws this line - DEFUEL means awaiting return or disposal,
    // TEMP means held for re-uplift - and it is enforced here rather than
    // left to whoever is reading the tank name.
    if (loc.location_type === 'DEFUEL') {
        return { error: `TKT444: ${code} is a DEFUEL location. Fuel in it is destined for `
            + 'return to the vendor or disposal, and cannot be uplifted back onto an '
            + 'aircraft. A TEMP location is the one that holds fuel for re-uplift.' };
    }

    // ---- what the tank is holding, oldest first ----------------------
    const layers = await db.run(SELECT.from(BALANCES)
        .where({ valuation_method: 'FIFO', storage_location: code,
                 balance_qty_kg: { '>': 0 } })
        .orderBy('flight_aobt', 'flight_date', 'batch_ref'));

    if (!layers.length) {
        return { error: `TKT445: ${code} holds no valued stock, so there is nothing to uplift from it.` };
    }
    const onHand = r3(layers.reduce((s, l) => s + Number(l.balance_qty_kg || 0), 0));
    if (onHand < qtyKg) {
        // REFUSED, NOT DRAWN NEGATIVE. A tank cannot give out fuel it does
        // not hold, and a clamped balance hides fuel that went missing.
        return { error: `TKT445: ${code} holds ${onHand} kg and this uplift takes ${qtyKg} kg.` };
    }

    const taken = [];
    let left = qtyKg;
    for (const l of layers) {
        if (left <= 0) break;
        const t = r3(Math.min(left, Number(l.balance_qty_kg)));
        if (t <= 0) continue;
        taken.push({ layer: l, qty: t, rate: Number(l.rate_usd_per_kg || 0) });
        left = r3(left - t);
    }

    const now = new Date().toISOString();
    const base = {
        carrier_code: ticket.carrier_code || null,
        flight_number: ticket.flight_number || null,
        flight_date: ticket.flight_date || null,
        flight_aobt: ticket.delivery_timestamp || null,
        station: ticket.station_code || null,
        reference: ticket.ticket_number,
        line_type: 'UPLIFT',
        line_order: UPLIFT_LINE_ORDER,
        created_at: now, created_by: 'TICKET_SERVICE',
        modified_at: now, modified_by: 'TICKET_SERVICE'
    };

    // THE SEQUENCE CONTINUES THE TAIL'S RUN rather than restarting, so the
    // row sorts where it belongs among that tail's history.
    const last = await db.run(SELECT.one.from(MOVEMENTS).columns('sequence')
        .where({ tail_number: tail }).orderBy({ sequence: 'desc' }));
    let seq = Number((last || {}).sequence) || 0;

    const rows = [];
    for (const t of taken) {
        const sg = t.layer.specific_gravity ?? null;
        const litres = sg ? r2(t.qty / Number(sg)) : null;
        const value = r2(t.qty * t.rate);

        // OUT OF THE TANK: location set, no tail.
        rows.push({ ...base, ID: cds.utils.uuid(), valuation_method: 'FIFO',
            tail_number: null, storage_location: code, batch_ref: t.layer.batch_ref,
            specific_gravity: sg, qty_kg: -t.qty, qty_l: litres == null ? null : -litres,
            rate_usd_per_kg: t.rate, value_usd: -value, sequence: ++seq });

        // ON TO THE TAIL: tail set, no location, SAME batch and SAME rate.
        rows.push({ ...base, ID: cds.utils.uuid(), valuation_method: 'FIFO',
            tail_number: tail, storage_location: null, batch_ref: t.layer.batch_ref,
            specific_gravity: sg, qty_kg: t.qty, qty_l: litres,
            rate_usd_per_kg: t.rate, value_usd: value, sequence: ++seq });

        await addBalance(db, { method: 'FIFO', location: code, batch: t.layer.batch_ref,
            deltaKg: -t.qty, like: t.layer });
        await addBalance(db, { method: 'FIFO', tail, batch: t.layer.batch_ref,
            deltaKg: t.qty, like: t.layer });
    }

    // ---- MAP, at the rate the tank is carrying -----------------------
    const pool = await db.run(SELECT.one.from(BALANCES).where({
        valuation_method: 'MAP', storage_location: code }));
    if (pool) {
        const rate = Number(pool.rate_usd_per_kg || 0);
        const sg = pool.specific_gravity ?? null;
        const litres = sg ? r2(qtyKg / Number(sg)) : null;
        const value = r2(qtyKg * rate);

        rows.push({ ...base, ID: cds.utils.uuid(), valuation_method: 'MAP',
            tail_number: null, storage_location: code, batch_ref: null,
            specific_gravity: sg, qty_kg: -qtyKg, qty_l: litres == null ? null : -litres,
            rate_usd_per_kg: rate, value_usd: -value, map_usd_per_kg: rate, sequence: ++seq });

        rows.push({ ...base, ID: cds.utils.uuid(), valuation_method: 'MAP',
            tail_number: tail, storage_location: null, batch_ref: null,
            specific_gravity: sg, qty_kg: qtyKg, qty_l: litres,
            rate_usd_per_kg: rate, value_usd: value, map_usd_per_kg: rate, sequence: ++seq });

        await addBalance(db, { method: 'MAP', location: code, deltaKg: -qtyKg, like: pool });
        await addBalance(db, { method: 'MAP', tail, deltaKg: qtyKg, like: pool });
    }

    if (rows.length) await db.run(INSERT.into(MOVEMENTS).entries(rows));
    return { ok: true, drawn: taken.length, value: r2(taken.reduce((s, t) => s + t.qty * t.rate, 0)) };
}

module.exports = { postStorageUplift };

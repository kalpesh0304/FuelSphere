/**
 * FuelSphere - replay a tail's movements into the stock valuation, FIFO beside
 * moving average.
 *
 * ONE IMPLEMENTATION, TWO CALLERS, since 27 Oct 2026. The seed tool
 * (tools/seed-fifo-valuation.js) replays every tail from ROB_LEDGER to write
 * the seeded FUEL_STOCK_* tables; the defuel service (srv/defuel-service.js)
 * replays ONE tail after a defuel or a reversal. Both call this file, so the
 * seeded valuation and the posted one cannot be computed two ways.
 *
 * WHY A DEFUEL NEEDS A REPLAY. A defuel taken off before departure sits
 * between the uplift it draws on and the burn of the flight it came off. That
 * burn, and every movement after it, would have drawn different layers with
 * that fuel gone - so the defuel cannot be subtracted from the end-of-history
 * balances, which is what the service did before. It is placed in the ledger
 * at its own instant and the tail is replayed from the start.
 *
 * ROB_LEDGER IS THE MOVEMENT SOURCE, as the seed tool has said since 18 Oct
 * 2026: FIFO is computed over the ledger's own movements, and MAP is COPIED
 * from the ledger, never recomputed. A defuel is a DEFUEL row on that ledger
 * (srv/defuel-service.js writes it), linked to its document by defuel_ID.
 *
 * Pure: data in, rows out. Nothing here reads or writes a database or a file.
 */
const crypto = require('crypto');

const NS = '6f4e2a10-3c5b-4d7e-9a81-2b3c4d5e6f70';
function uuid5(name) {
    const ns = Buffer.from(NS.replace(/-/g, ''), 'hex');
    const h = crypto.createHash('sha1').update(Buffer.concat([ns, Buffer.from(name)])).digest();
    h[6] = (h[6] & 0x0f) | 0x50;
    h[8] = (h[8] & 0x3f) | 0x80;
    const x = h.subarray(0, 16).toString('hex');
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const num = (v) => {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};
const kg = (n) => (n === null ? null : Number(n.toFixed(3)));
const money = (n) => (n === null ? null : Number(n.toFixed(2)));
const rate = (n) => (n === null ? null : Number(n.toFixed(6)));
const litres = (k, sg) => (k === null || !sg ? null : Number((k / sg).toFixed(2)));

// Uplift before burn, block burn before APU burn - the APU runs on stand after
// the leg, so its fuel leaves after the block burn's. DEFUEL is 5, the value
// the defuel service has always written.
const LINE_ORDER = { INITIAL: 0, UPLIFT: 1, BLOCK_BURN: 2, APU_BURN: 3, ADJUSTMENT: 4, DEFUEL: 5 };

// ---- SEQUENCE IS AUTHORITATIVE, NOT record_time --------------------------
//
// The ledger's closing balances reconcile only in (date, sequence) order - see
// the measurement in tools/seed-fifo-valuation.js. A DEFUEL row is given its
// own sequence when it is posted, so the rank below only breaks a true tie.
const LEDGER_ENTRY_RANK = { INITIAL: 0, UPLIFT: 1, BURN: 2, DEFUEL: 2, APU_BURN: 3, TRANSFER: 4, ADJUSTMENT: 5 };
const ledgerOrder = (a, b) =>
    String(a.record_date || '').localeCompare(String(b.record_date || ''))
    || (num(a.sequence) || 0) - (num(b.sequence) || 0)
    || (LEDGER_ENTRY_RANK[a.entry_type] ?? 9) - (LEDGER_ENTRY_RANK[b.entry_type] ?? 9);

// ROB_LEDGER entry types in the valuation's vocabulary.
const LEDGER_LINE_TYPE = {
    INITIAL: 'INITIAL',
    UPLIFT: 'UPLIFT',
    BURN: 'BLOCK_BURN',
    APU_BURN: 'APU_BURN',
    TRANSFER: 'TRANSFER',
    ADJUSTMENT: 'ADJUSTMENT',
    DEFUEL: 'DEFUEL'
};

/**
 * The context a replay needs that is not on the ledger rows themselves.
 *
 *   flightById        Map(flight ID -> FLIGHT_SCHEDULE row)
 *   ticketNumberById  Map(ticket ID -> ticket number), to NAME a batch
 *   carrierOf         (tail) -> IATA carrier code
 *   defuelById        Map(DEFUEL ID -> DEFUEL row)
 *   stamp, by         audit columns on every row written
 */
function makeContext({ flightById, ticketNumberById, carrierOf, defuelById, stamp, by }) {
    const openingSeen = new Map();
    // ---- what a batch is CALLED ----------------------------------------
    //
    // THE TICKET NUMBER, NOT THE LEDGER ROW ID: the parcel of fuel is known
    // outside this system by its ticket. An opening balance has no ticket and
    // is named for the tail.
    const batchNameOf = (r, lineType, tail) => {
        if (lineType === 'UPLIFT') {
            return ticketNumberById.get(r.fuel_ticket_ID) || r.ID || '';
        }
        if (lineType === 'INITIAL') {
            const base = `OPENING-${tail}`;
            const n = (openingSeen.get(base) || 0) + 1;
            openingSeen.set(base, n);
            return n === 1 ? base : `${base}-${n}`;
        }
        return null;
    };
    return {
        flightById: flightById || new Map(),
        ticketNumberById: ticketNumberById || new Map(),
        carrierOf: carrierOf || (() => null),
        defuelById: defuelById || new Map(),
        stamp, by, batchNameOf,
        counts: { unpricedLedger: 0, unvaluedAdjustments: 0, defuelsWithoutDocument: 0 }
    };
}

/** One tail's ledger rows as valuation movements, in ledger order. */
function movementsOf(tail, rows, ctx) {
    const list = [];
    for (const r of rows.slice().sort(ledgerOrder)) {
        const lineType = LEDGER_LINE_TYPE[r.entry_type];
        if (!lineType) continue;

        // ---- A DEFUEL TAKES ITS QUANTITY FROM ITS DOCUMENT ----------------
        //
        // The ledger row positions the movement; the DEFUEL document says
        // what came off, where it went and whether it was reversed. A
        // reversed defuel's ledger row is zeroed (the fuel never came off,
        // as far as ROB is concerned), and the valuation shows the posting
        // and its mirror, as the service always has.
        if (lineType === 'DEFUEL') {
            const doc = r.defuel_ID ? ctx.defuelById.get(r.defuel_ID) : null;
            if (!doc) { ctx.counts.defuelsWithoutDocument += 1; continue; }
            const q = num(doc.quantity_kg) || 0;
            list.push({
                line_type: 'DEFUEL',
                reference: doc.defuel_id,
                defuel: doc,
                reversed: doc.status === 'REVERSED',
                storage_location: doc.location_code || null,
                carrier_code: doc.carrier_code || null,
                batch_ref: null,
                qty_kg: kg(-q),
                specific_gravity: num(doc.specific_gravity) || num(r.wt_avg_specific_gravity),
                rate_usd_per_kg: num(r.map_usd_per_kg),
                value_usd: null,
                flight_number: doc.flight_number || null,
                flight_date: doc.flight_date || null,
                // THE DEFUEL'S OWN INSTANT, in the column the replay sorts on.
                flight_aobt: doc.defuel_date ? `${doc.defuel_date}T${doc.defuel_time || '00:00:00'}Z` : null,
                station: doc.station_code || null,
                qty_basis: 'ROB_LEDGER',
                ledger_balance_qty: num(r.closing_rob_kg),
                ledger_balance_value: num(r.balance_value_usd),
                ledger_map: num(r.map_usd_per_kg)
            });
            continue;
        }

        // SIGNED, AS THE LEDGER KEEPS IT: + uplift, - burn. The ledger is
        // mixed vintage and qty_kg is not always there; the quantity is taken
        // from whichever column the row actually uses.
        let qty = num(r.qty_kg);
        if (qty === null && r.entry_type === 'INITIAL') {
            qty = num(r.closing_rob_kg);
        }
        if (qty === null && r.entry_type === 'ADJUSTMENT') {
            const delta = num(r.adjustment_kg);
            const open = num(r.opening_rob_kg), close = num(r.closing_rob_kg);
            qty = delta !== null ? delta
                : (open !== null && close !== null ? kg(close - open) : null);
        }
        const rateRow = num(r.rate_usd_per_kg);

        if (lineType === 'ADJUSTMENT' && (qty === null || rateRow === null)) ctx.counts.unvaluedAdjustments += 1;
        if (qty !== null && qty !== 0 && rateRow === null) ctx.counts.unpricedLedger += 1;

        list.push({
            line_type: lineType,
            reference: r.ID,
            batch_ref: ctx.batchNameOf(r, lineType, tail),
            qty_kg: qty === null ? null : kg(qty),
            specific_gravity: num(r.specific_gravity) || num(r.wt_avg_specific_gravity),
            rate_usd_per_kg: rateRow,
            value_usd: num(r.value_usd),
            // AN OPENING BALANCE NEVER CARRIES A FLIGHT: it is a starting
            // position, not a leg that was flown.
            flight_number: lineType === 'INITIAL' ? null
                : (ctx.flightById.get(r.flight_ID) || {}).flight_number || null,
            flight_date: r.record_date || null,
            flight_aobt: r.record_date ? `${r.record_date}T${r.record_time || '00:00:00'}Z` : null,
            station: r.airport_code || null,
            qty_basis: 'ROB_LEDGER',
            ledger_balance_qty: num(r.closing_rob_kg),
            ledger_balance_value: num(r.balance_value_usd),
            ledger_map: num(r.map_usd_per_kg)
        });
    }
    return list;
}

// ---- shapes ---------------------------------------------------------------
function row(ctx, method, tail, mv, over) {
    const sg = over.specific_gravity ?? mv.specific_gravity ?? null;
    const q = over.qty_kg ?? null;
    const ref = over.reference ?? mv.reference;
    return {
        ID: uuid5(`MOV:${method}:${tail}:${ref}:${over.batch_ref || '-'}:${over.seq}:${q}`),
        valuation_method: method, tail_number: tail,
        carrier_code: over.carrier_code ?? (ctx.carrierOf(tail) || null),
        batch_ref: over.batch_ref || null,
        flight_number: over.flight_number !== undefined ? over.flight_number : (mv.flight_number || null),
        flight_date: over.flight_date !== undefined ? over.flight_date : (mv.flight_date || null),
        flight_aobt: mv.flight_aobt || null, station: mv.station || null,
        // A storage location is written only by a defuel: the inbound half
        // of the move, and the tank's own rows.
        storage_location: over.storage_location || null,
        reference: ref, line_type: mv.line_type,
        qty_kg: q, qty_l: litres(q, sg), specific_gravity: sg ?? null,
        rate_usd_per_kg: over.rate_usd_per_kg ?? null, value_usd: over.value_usd ?? null,
        balance_qty_kg: over.balance_qty_kg ?? null, balance_value_usd: over.balance_value_usd ?? null,
        map_usd_per_kg: over.map_usd_per_kg ?? null,
        line_order: LINE_ORDER[mv.line_type], sequence: over.seq,
        created_at: ctx.stamp, created_by: ctx.by, modified_at: ctx.stamp, modified_by: ctx.by
    };
}
function balance(ctx, method, tail, L, left, value, mapRate) {
    return {
        // THE LAYER NUMBER IS IN THE KEY: batch_ref alone is not unique
        // within a tail. A tank's balance is keyed on the tank instead.
        ID: L.storage_location
            ? uuid5(`BAL:${method}:LOC:${L.storage_location}:${L.batch_ref || '-'}`)
            : uuid5(`BAL:${method}:${tail}:${L.batch_ref || '-'}:${L.layer_no ?? 0}`),
        valuation_method: method, tail_number: tail,
        carrier_code: L.carrier_code ?? (ctx.carrierOf(tail) || null),
        batch_ref: L.batch_ref || null,
        storage_location: L.storage_location || null,
        line_type: L.line_type || null,
        station: L.station || null, flight_number: L.flight_number || null,
        flight_date: L.flight_date || null, flight_aobt: L.flight_aobt || null,
        uplift_qty_kg: L.qty_kg ?? null, uplift_qty_l: litres(L.qty_kg ?? null, L.specific_gravity),
        balance_qty_kg: kg(left), balance_qty_l: litres(kg(left), L.specific_gravity),
        specific_gravity: L.specific_gravity ?? null,
        rate_usd_per_kg: mapRate ?? L.rate_usd_per_kg ?? null, value_usd: money(value),
        created_at: ctx.stamp, created_by: ctx.by, modified_at: ctx.stamp, modified_by: ctx.by
    };
}
function header(ctx, method, tail, mv, qty, value, used) {
    return {
        ID: uuid5(`HDR:${method}:${tail}:${mv.reference}`),
        valuation_method: method, tail_number: tail, carrier_code: ctx.carrierOf(tail) || null,
        flight_number: mv.flight_number || null, flight_date: mv.flight_date || null,
        flight_aobt: mv.flight_aobt || null, station: mv.station || null,
        line_type: mv.line_type, burn_ref: mv.reference,
        burn_qty_kg: kg(qty), burn_qty_l: litres(kg(qty), mv.specific_gravity),
        burn_rate_usd_per_kg: qty > 0 ? rate(value / qty) : null,
        burn_value_usd: money(value), layers_consumed: used,
        qty_basis: mv.qty_basis || 'REPORTED_BURN',
        created_at: ctx.stamp, created_by: ctx.by, modified_at: ctx.stamp, modified_by: ctx.by
    };
}

/**
 * FIFO layers as they stood after the first `upTo` movements - what a defuel
 * at that point can draw on. Same consumption rule as the replay below.
 */
function layersAsOf(list, upTo) {
    const layers = [];
    for (const mv of list.slice(0, upTo)) {
        if (mv.line_type === 'UPLIFT' || mv.line_type === 'INITIAL') {
            layers.push({ ...mv, left: Math.abs(mv.qty_kg || 0) });
            continue;
        }
        if (mv.line_type === 'DEFUEL' && mv.reversed) continue;
        let need = Math.abs(mv.qty_kg || 0);
        for (const L of layers) {
            if (need <= 0) break;
            if (L.left <= 0) continue;
            const take = Math.min(L.left, need);
            L.left = kg(L.left - take);
            need = kg(need - take);
        }
    }
    return layers;
}

/**
 * Replay one tail. Returns the tail's movement rows, its balances and its
 * burn headers. Storage balances are NOT here: a tank takes fuel from many
 * tails, so they are summed from the movement rows by storageBalances().
 */
function replayTail(tail, list, ctx) {
    const movements = [], balances = [], burnHeaders = [];
    let shortfalls = 0, shortfallKg = 0;

    // ---- FIFO -----------------------------------------------------------
    const layers = [];
    let seq = 0;
    for (const mv of list) {
        seq += 1;
        if (mv.line_type === 'UPLIFT' || mv.line_type === 'INITIAL') {
            layers.push({ ...mv, left: Math.abs(mv.qty_kg || 0), layer_no: layers.length + 1 });
            movements.push(row(ctx, 'FIFO', tail, mv, {
                batch_ref: mv.batch_ref,
                qty_kg: mv.qty_kg,
                rate_usd_per_kg: mv.rate_usd_per_kg,
                value_usd: mv.value_usd,
                seq
            }));
            continue;
        }

        // ---- A DEFUEL MOVES FUEL, IT DOES NOT CONSUME IT -----------------
        //
        // One pair per layer touched: out of the tail, in to the tank, at the
        // layer's own rate. FUEL IN A TANK IS ON NO FLIGHT, so the inbound
        // half drops the flight. A reversed defuel is followed by its mirror,
        // and the layers it took are given back.
        if (mv.line_type === 'DEFUEL') {
            let need = Math.abs(mv.qty_kg || 0);
            const took = [];
            for (const L of layers) {
                if (need <= 0) break;
                if (L.left <= 0) continue;
                const take = kg(Math.min(L.left, need));
                if (take <= 0) continue;
                L.left = kg(L.left - take);
                need = kg(need - take);
                took.push({ L, take });
            }
            if (need > 0.001) { shortfalls += 1; shortfallKg += need; }
            const pair = (sign, reference) => {
                for (const { L, take } of took) {
                    const value = money(take * (L.rate_usd_per_kg || 0));
                    movements.push(row(ctx, 'FIFO', tail, mv, {
                        reference, batch_ref: L.batch_ref, specific_gravity: L.specific_gravity,
                        qty_kg: kg(-sign * take), rate_usd_per_kg: L.rate_usd_per_kg,
                        value_usd: money(-sign * value), seq
                    }));
                    movements.push(row(ctx, 'FIFO', null, mv, {
                        reference, batch_ref: L.batch_ref, specific_gravity: L.specific_gravity,
                        storage_location: mv.storage_location, carrier_code: mv.carrier_code,
                        flight_number: null, flight_date: null,
                        qty_kg: kg(sign * take), rate_usd_per_kg: L.rate_usd_per_kg,
                        value_usd: money(sign * value), seq
                    }));
                }
            };
            pair(1, mv.reference);
            if (mv.reversed) {
                pair(-1, `${mv.reference}-REV`);
                for (const { L, take } of took) L.left = kg(L.left + take);
            }
            continue;
        }

        // A BURN EATS THE OLDEST LAYER FIRST, one row per layer it touches.
        let need = Math.abs(mv.qty_kg || 0), taken = 0, value = 0, used = 0;
        for (const L of layers) {
            if (need <= 0) break;
            if (L.left <= 0) continue;
            const take = Math.min(L.left, need);
            L.left = kg(L.left - take);
            need = kg(need - take);
            taken += take; value += take * (L.rate_usd_per_kg || 0); used += 1;
            movements.push(row(ctx, 'FIFO', tail, mv, {
                batch_ref: L.batch_ref,
                qty_kg: kg(-take),
                specific_gravity: L.specific_gravity,
                rate_usd_per_kg: L.rate_usd_per_kg,
                value_usd: money(-take * (L.rate_usd_per_kg || 0)),
                seq
            }));
        }
        if (need > 0.001) { shortfalls += 1; shortfallKg += need; }
        // A BURN WITH NO LAYER TO DRAW ON STILL HAPPENED, and FIFO says so
        // with a zero row, exactly as MAP does.
        if (used === 0) {
            movements.push(row(ctx, 'FIFO', tail, mv, {
                batch_ref: null,
                qty_kg: kg(0),
                rate_usd_per_kg: 0,
                value_usd: money(0),
                seq
            }));
        }
        burnHeaders.push(header(ctx, 'FIFO', tail, mv, taken, value, used));
    }
    for (const L of layers) {
        balances.push(balance(ctx, 'FIFO', tail, L, L.left, L.left * (L.rate_usd_per_kg || 0)));
    }

    // ---- MAP --------------------------------------------------------------
    //
    // COPIED FROM THE LEDGER, NOT RECOMPUTED. A defuel leaves at the average
    // the tail was carrying at that moment - the ledger's own MAP on its row -
    // and arrives in the tank at the same rate.
    let lastQty = null, lastValue = null, lastMap = null;
    seq = 0;
    for (const mv of list) {
        seq += 1;
        const isIn = mv.line_type === 'UPLIFT' || mv.line_type === 'INITIAL';
        if (mv.ledger_balance_qty !== null && mv.ledger_balance_qty !== undefined) {
            lastQty = mv.ledger_balance_qty;
            lastValue = mv.ledger_balance_value;
            lastMap = mv.ledger_map;
        }
        if (mv.line_type === 'DEFUEL') {
            const q = Math.abs(mv.qty_kg || 0);
            const r = mv.ledger_map || 0;
            const value = money(q * r);
            const pair = (sign, reference) => {
                movements.push(row(ctx, 'MAP', tail, mv, {
                    reference, qty_kg: kg(-sign * q), rate_usd_per_kg: r, value_usd: money(-sign * value),
                    balance_qty_kg: mv.ledger_balance_qty, balance_value_usd: mv.ledger_balance_value,
                    map_usd_per_kg: r, seq
                }));
                movements.push(row(ctx, 'MAP', null, mv, {
                    reference, storage_location: mv.storage_location, carrier_code: mv.carrier_code,
                    flight_number: null, flight_date: null,
                    qty_kg: kg(sign * q), rate_usd_per_kg: r, value_usd: money(sign * value),
                    map_usd_per_kg: r, seq
                }));
            };
            pair(1, mv.reference);
            if (mv.reversed) pair(-1, `${mv.reference}-REV`);
            continue;
        }
        movements.push(row(ctx, 'MAP', tail, mv, {
            qty_kg: mv.qty_kg,
            rate_usd_per_kg: mv.rate_usd_per_kg,
            value_usd: mv.value_usd,
            balance_qty_kg: mv.ledger_balance_qty,
            balance_value_usd: mv.ledger_balance_value,
            map_usd_per_kg: mv.ledger_map,
            seq
        }));
        // A BURN'S COST UNDER MAP IS WHAT THE LEDGER CHARGED IT.
        if (!isIn && mv.qty_kg !== null && mv.qty_kg < 0) {
            const takenKg = Math.abs(mv.qty_kg);
            const chargedValue = Math.abs(num(mv.value_usd) ?? (takenKg * (mv.rate_usd_per_kg || 0)));
            burnHeaders.push(header(ctx, 'MAP', tail, mv, takenKg, chargedValue, 1));
        }
    }
    balances.push(balance(ctx, 'MAP', tail, { station: null, flight_number: null, flight_date: null, flight_aobt: null, specific_gravity: null, qty_kg: null }, lastQty ?? 0, lastValue ?? 0, lastMap ?? 0));

    return { movements, balances, burnHeaders, shortfalls, shortfallKg };
}

/**
 * What each tank holds, summed from the movement rows that carry it. FIFO
 * keeps each batch apart at its own rate; MAP pools the tank at one rate.
 * Nothing yet takes fuel OUT of a tank, so every row into one is a receipt
 * (or the reversal of one).
 */
function storageBalances(movementRows, ctx) {
    const fifo = new Map(), map = new Map();
    for (const m of movementRows) {
        if (!m.storage_location) continue;
        const q = Number(m.qty_kg) || 0, v = Number(m.value_usd) || 0;
        if (m.valuation_method === 'FIFO') {
            const k = `${m.storage_location}|${m.batch_ref}`;
            const e = fifo.get(k) || { storage_location: m.storage_location, batch_ref: m.batch_ref,
                carrier_code: m.carrier_code, station: m.station, specific_gravity: num(m.specific_gravity),
                rate_usd_per_kg: num(m.rate_usd_per_kg), line_type: 'DEFUEL', qty_kg: 0, left: 0 };
            if (q > 0 && !String(m.reference).endsWith('-REV')) e.qty_kg = kg(e.qty_kg + q);
            e.left = kg(e.left + q);
            fifo.set(k, e);
        } else {
            const k = m.storage_location;
            const e = map.get(k) || { storage_location: k, batch_ref: null, carrier_code: m.carrier_code,
                station: m.station, specific_gravity: null, line_type: 'DEFUEL', qty_kg: 0, left: 0, value: 0 };
            if (q > 0 && !String(m.reference).endsWith('-REV')) e.qty_kg = kg(e.qty_kg + q);
            e.left = kg(e.left + q);
            e.value = money(e.value + v);
            map.set(k, e);
        }
    }
    const out = [];
    for (const e of fifo.values()) out.push(balance(ctx, 'FIFO', null, e, e.left, e.left * (e.rate_usd_per_kg || 0)));
    for (const e of map.values()) {
        out.push(balance(ctx, 'MAP', null, e, e.left, e.value, e.left > 0 ? rate(e.value / e.left) : 0));
    }
    return out;
}

module.exports = {
    uuid5, num, kg, money, rate, litres,
    LINE_ORDER, LEDGER_ENTRY_RANK, ledgerOrder,
    makeContext, movementsOf, layersAsOf, replayTail, storageBalances
};

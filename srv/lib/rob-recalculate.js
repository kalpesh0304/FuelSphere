/**
 * FuelSphere - replay a tail's ROB ledger and restate its valued columns.
 *
 * WHY THE BUTTON EXISTS. A ticket captured days after the uplift posts to the
 * end of the ledger, but the fuel went on board on the flight date. Every row
 * after that point then carries a balance and a moving average price computed
 * without it. This re-sorts the tail's movements into flight-date order and
 * replays them from the start, rewriting balance quantity, balance value and
 * MAP on each row.
 *
 * QUANTITY IS ORDER-INDEPENDENT AND VALUE IS NOT, which is the entire reason
 * a replay is needed rather than a patch. Kilograms in and out net to the same
 * closing figure however they are sequenced; money does not, because a burn
 * consumes at whatever average price prevailed at that moment. Insert an
 * uplift earlier and every later burn cost something different.
 *
 * THE RULES, as signed off:
 *
 *   opening     seed the balance; MAP = value / qty
 *   uplift      qty += n; value += n x rate;        MAP RECALCULATED
 *   burn        qty -= n; value -= n x current MAP; MAP UNCHANGED
 *   adjustment  treated as a burn - they are burn corrections
 *
 * WHERE THE RATE COMES FROM, in order: the linked ticket's own amount and
 * mass, then the order's unit price as a demo fallback, then zero. Zero is
 * the signed-off answer for an uplift nobody priced - the fuel moved, the
 * money is simply not known yet - and it is corrected by entering the rate on
 * the ticket and recalculating again, not by inventing a figure here.
 */

const cds = require('@sap/cds');
const { SELECT, UPDATE } = cds.ql;

const LEDGER  = 'fuelsphere.ROB_LEDGER';
const TICKETS = 'fuelsphere.FUEL_TICKETS';
const ORDERS  = 'fuelsphere.FUEL_ORDERS';

/** Movement order within one flight date. */
const LINE_ORDER = { INITIAL: 0, UPLIFT: 1, FLIGHT: 2, TRANSFER: 2, ADJUSTMENT: 3 };
const lineOrderOf = (entryType) => (LINE_ORDER[entryType] !== undefined ? LINE_ORDER[entryType] : 3);

const num = (v) => (v === null || v === undefined ? null : Number(v));
const money = (v) => Number(Number(v).toFixed(2));
const rate4 = (v) => Number(Number(v).toFixed(4));

/**
 * The price per kilogram for an uplift row.
 *
 * Reads the TICKET rather than the ledger row's stored rate, deliberately:
 * correcting a ticket's rate and recalculating is the signed-off way to fix a
 * mispriced uplift, so the ticket is the source of truth and the ledger row is
 * the derived copy.
 */
async function upliftRate(row, tx) {
    const qty = num(row.uplift_kg) || num(row.qty_kg);
    if (!qty || qty <= 0) return { rate: 0, basis: 'no quantity' };

    if (row.fuel_ticket_ID) {
        const t = await tx.run(SELECT.one.from(TICKETS)
            .columns('total_amount', 'quantity_kg', 'rate_per_litre', 'order_ID')
            .where({ ID: row.fuel_ticket_ID }));
        if (t) {
            // Value divided by MASS, never rate_per_litre copied across: the
            // ticket's rate is per litre and this column is per kilogram.
            const value = num(t.total_amount), mass = num(t.quantity_kg);
            if (value !== null && mass && mass > 0) {
                return { rate: rate4(value / mass), basis: 'ticket' };
            }
            // Demo fallback: the order's unit price stands in for a contract
            // price so a seeded ledger reads as a complete calculation.
            const orderId = t.order_ID || row.fuel_order_ID;
            if (orderId) {
                const o = await tx.run(SELECT.one.from(ORDERS)
                    .columns('unit_price').where({ ID: orderId }));
                if (o && num(o.unit_price)) return { rate: rate4(num(o.unit_price)), basis: 'order price' };
            }
        }
    }

    if (row.fuel_order_ID) {
        const o = await tx.run(SELECT.one.from(ORDERS)
            .columns('unit_price').where({ ID: row.fuel_order_ID }));
        if (o && num(o.unit_price)) return { rate: rate4(num(o.unit_price)), basis: 'order price' };
    }

    // Signed off: an unpriced uplift is worth nothing until someone prices it.
    return { rate: 0, basis: 'unpriced' };
}

/** The signed movement in kilograms, and which rule values it. */
function movementOf(row) {
    const uplift = num(row.uplift_kg) || 0;
    const burn = num(row.burn_kg) || 0;
    const adj = num(row.adjustment_kg) || 0;

    if (row.entry_type === 'INITIAL') return { kind: 'opening', qty: num(row.closing_rob_kg) || 0 };
    if (uplift > 0) return { kind: 'uplift', qty: uplift };
    // Adjustments are burn corrections and are valued like burns. An
    // adjustment recorded as a positive number still REDUCES the balance -
    // that is how the existing rows read: opening 1950, adjustment 52.5,
    // closing 1897.5.
    if (burn > 0) return { kind: 'burn', qty: burn };
    if (adj) return { kind: 'burn', qty: Math.abs(adj) };
    return { kind: 'none', qty: 0 };
}

/**
 * The rate to value an opening balance at.
 *
 * THE OPENING BALANCE HAS NO PRICE OF ITS OWN, and that is the honest state
 * of it: the fuel was already on board when the ledger began, and whatever it
 * cost was never recorded. Left at zero it drags the average price down for
 * as long as that fuel is on board - measured on the sample ledger, a MAP of
 * 0.7704 where the fuel actually cost 1.1345.
 *
 * So it is valued at the FIRST PRICED UPLIFT for the same tail: the nearest
 * thing to a contract price this data holds, transparent, and the same answer
 * every time it runs. It is an assumption, not a measurement - which is why
 * the caller is told how many rows were valued this way, and why a real
 * opening valuation entered per tail would replace it.
 */
async function openingRate(tailNumber, tx) {
    const rows = await tx.run(SELECT.from(LEDGER)
        .columns('ID', 'entry_type', 'uplift_kg', 'qty_kg', 'fuel_ticket_ID', 'fuel_order_ID', 'record_date')
        .where({ tail_number: tailNumber, entry_type: 'UPLIFT' })
        .orderBy('record_date'));
    for (const r of rows) {
        const { rate, basis } = await upliftRate(r, tx);
        if (basis !== 'unpriced' && rate > 0) return rate;
    }
    return 0;
}

/**
 * Replay one tail.
 *
 * @returns {Promise<{tail: string, rows: number, flagged: number,
 *                    closingQty: number, closingValue: number, map: number|null,
 *                    unpriced: number, openingAssumed: boolean}>}
 */
async function recalculateTail(tailNumber, userId, tx = cds.db) {
    const rows = await tx.run(SELECT.from(LEDGER)
        .where({ tail_number: tailNumber })
        .orderBy('record_date', 'record_time', 'sequence'));
    if (!rows.length) {
        return { tail: tailNumber, rows: 0, flagged: 0, closingQty: 0, closingValue: 0, map: null, unpriced: 0 };
    }

    // Flight date first, then uplift before burn before adjustment. Sorted
    // here rather than in SQL because line_order is being (re)assigned now -
    // older rows predate the column.
    rows.forEach(r => { r._order = lineOrderOf(r.entry_type); });
    rows.sort((a, b) =>
        String(a.record_date).localeCompare(String(b.record_date)) ||
        a._order - b._order ||
        String(a.record_time || '').localeCompare(String(b.record_time || '')) ||
        (a.sequence || 0) - (b.sequence || 0));

    const stamp = new Date().toISOString();
    const openRate = await openingRate(tailNumber, tx);
    let balQty = 0, balValue = 0, map = null, flagged = 0, unpriced = 0, openingAssumed = false;

    for (const row of rows) {
        const move = movementOf(row);
        let qtySigned = 0, rowRate = null, rowValue = null;

        if (move.kind === 'opening') {
            // Valued at the tail's first priced uplift - see openingRate.
            balQty = move.qty;
            rowRate = openRate;
            rowValue = money(move.qty * openRate);
            balValue = rowValue;
            map = balQty > 0 ? rate4(balValue / balQty) : null;
            qtySigned = move.qty;
            if (openRate > 0 && move.qty > 0) openingAssumed = true;
        } else if (move.kind === 'uplift') {
            const { rate, basis } = await upliftRate(row, tx);
            if (basis === 'unpriced') unpriced += 1;
            rowRate = rate;
            rowValue = money(move.qty * rate);
            balQty = Number((balQty + move.qty).toFixed(2));
            balValue = money(balValue + rowValue);
            map = balQty > 0 ? rate4(balValue / balQty) : map;
            qtySigned = move.qty;
        } else if (move.kind === 'burn') {
            // Consumed at the prevailing MAP, which is why a burn never moves
            // it. A burn before any priced uplift consumes at zero.
            const atMap = map === null ? 0 : map;
            rowRate = atMap;
            rowValue = money(move.qty * atMap);
            balQty = Number((balQty - move.qty).toFixed(2));
            balValue = money(balValue - rowValue);
            qtySigned = -move.qty;
        } else {
            qtySigned = 0; rowRate = null; rowValue = null;
        }

        // A balance at or below zero has no average price to speak of. Hold
        // the last good one and mark the row rather than dividing into it.
        let rowFlagged = false;
        if (balQty <= 0) {
            rowFlagged = true;
            flagged += 1;
            if (balQty < 0) balValue = money(Math.max(balValue, 0));
        } else if (move.kind !== 'burn') {
            map = rate4(balValue / balQty);
        }

        await tx.run(UPDATE(LEDGER).where({ ID: row.ID }).set({
            line_order: row._order,
            qty_kg: qtySigned,
            rate_usd_per_kg: rowRate,
            value_usd: rowValue,
            closing_rob_kg: balQty,
            balance_value_usd: balValue,
            map_usd_per_kg: map,
            recalc_flagged: rowFlagged,
            recalculated_by: userId || null,
            recalculated_at: stamp
        }));
    }

    return {
        tail: tailNumber, rows: rows.length, flagged, unpriced, openingAssumed,
        closingQty: balQty, closingValue: balValue, map
    };
}

module.exports = { recalculateTail, lineOrderOf, LINE_ORDER };

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

/**
 * Movement order within one flight date.
 *
 * APU_BURN SITS AFTER BURN, by instruction: the block burn is what the leg
 * consumed between the chocks, and the ground APU burn happens on stand after
 * it. Both deduct; neither moves the moving average price.
 */
const LINE_ORDER = { INITIAL: 0, UPLIFT: 1, BURN: 2, TRANSFER: 2, DEFUEL: 2, APU_BURN: 3, ADJUSTMENT: 4 };
const lineOrderOf = (entryType) => (LINE_ORDER[entryType] !== undefined ? LINE_ORDER[entryType] : 3);

const num = (v) => (v === null || v === undefined ? null : Number(v));
const money = (v) => Number(Number(v).toFixed(2));
const rate4 = (v) => Number(Number(v).toFixed(4));
const sg4 = (v) => (v === null ? null : Number(Number(v).toFixed(4)));

/**
 * The density of the tank after an uplift: TOTAL MASS OVER TOTAL VOLUME.
 *
 * Chosen 2 Oct 2026 over averaging the two densities by mass. The two differ
 * by about 0.06% on a 0.78/0.82 blend - roughly 8 litres per 10 tonnes - and
 * always in the same direction, so the error compounds across uplifts. This
 * one is what physically comes out of the bowser: mass stays mass, volume
 * stays volume, density is the ratio.
 *
 *   blend = (m_before + m_uplift) / (m_before/sg_before + m_uplift/sg_uplift)
 *
 * With nothing in the tank, or no density on record for what is already
 * there, the uplift's own density IS the blend - there is nothing to blend it
 * with, and inventing one would be worse than carrying the measured figure.
 */
function blendGravity(massBefore, sgBefore, massUplift, sgUplift) {
    const mb = num(massBefore) || 0;
    const mu = num(massUplift) || 0;
    const sb = num(sgBefore);
    const su = num(sgUplift);

    if (!su || su <= 0) return sb;                  // nothing measured: carry on
    if (mb <= 0 || !sb || sb <= 0) return sg4(su);  // empty tank, or no prior density
    if (mu <= 0) return sg4(sb);

    const volume = (mb / sb) + (mu / su);
    return volume > 0 ? sg4((mb + mu) / volume) : sg4(sb);
}

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
    // AN APU LINE IS A BURN. Named explicitly rather than left to the burn_kg
    // test below, so a zero-quantity APU row still reads as a burn of nothing
    // instead of as 'none' - the line exists because the APU ran, and a row
    // that classifies as nothing would be valued as nothing and sorted wrong.
    if (row.entry_type === 'APU_BURN') return { kind: 'burn', qty: burn };
    // A DEFUEL TAKES FUEL OFF AT THE PREVAILING AVERAGE, like a burn, and
    // never moves it. Its quantity is a negative adjustment_kg (written by
    // srv/defuel-service.js), so the burn service's opening + uplift - burn +
    // adjustment also deducts it; a reversed defuel is zeroed and moves nothing.
    if (row.entry_type === 'DEFUEL') return adj ? { kind: 'burn', qty: Math.abs(adj) } : { kind: 'none', qty: 0 };
    // Adjustments are burn corrections and are valued like burns. An
    // adjustment recorded as a positive number still REDUCES the balance -
    // that is how the existing rows read: opening 1950, adjustment 52.5,
    // closing 1897.5.
    if (burn > 0) return { kind: 'burn', qty: burn };
    if (adj) return { kind: 'burn', qty: Math.abs(adj) };
    return { kind: 'none', qty: 0 };
}

/**
 * THE UPLIFT'S OWN DENSITY, from the ticket that recorded it.
 *
 * density_value on a fuel ticket is always kg per litre - the unit is not the
 * operator's to choose (ticket-measurement.js stamps KGL). A ticket with no
 * density, which happens on a mass ticket, falls back to the mass over the
 * metered volume where both are there: that IS the density, measured rather
 * than assumed, and it is how the ledger's litre columns were derived before
 * this column existed.
 */
async function upliftGravity(row, tx) {
    if (!row.fuel_ticket_ID) return null;

    const t = await tx.run(SELECT.one.from(TICKETS)
        .columns('density_value', 'quantity_kg', 'quantity_metered', 'quantity', 'uom_code')
        .where({ ID: row.fuel_ticket_ID }));
    if (!t) return null;

    const stated = num(t.density_value);
    if (stated && stated > 0.5 && stated < 1.2) return sg4(stated);

    const kg = num(t.quantity_kg);
    const litres = num(row.volume_l);
    if (kg && litres && litres > 0) {
        const derived = kg / litres;
        if (derived > 0.5 && derived < 1.2) return sg4(derived);
    }
    return null;
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

    // FLIGHT DATE, THEN THE ORDER THE DAY HAPPENED IN.
    //
    // sequence is what carries that order: both the posting handlers and the
    // seed generator hand it out in the order events occur, so it survives a
    // day with four legs on it. Sorting by line_order first - uplift before
    // burn before adjustment - reads correctly only when a tail flies ONCE a
    // day: on a four-leg day it groups all four uplifts ahead of all four
    // burns, and the running balance then swings between figures the aircraft
    // never held. line_order still breaks a tie where two rows share a
    // sequence, which is how a same-instant uplift and burn stay in order.
    rows.forEach(r => { r._order = lineOrderOf(r.entry_type); });
    // THE OFF-BLOCK TIME FIRST where the rows carry one: it is the only field
    // that states when the leg actually happened. The per-day sequence is the
    // fallback for rows that predate it, and line_order breaks a tie.
    rows.sort((a, b) =>
        String(a.record_date).localeCompare(String(b.record_date)) ||
        String(a.flight_aobt || '').localeCompare(String(b.flight_aobt || '')) ||
        (a.sequence || 0) - (b.sequence || 0) ||
        a._order - b._order ||
        String(a.record_time || '').localeCompare(String(b.record_time || '')));

    const stamp = new Date().toISOString();
    const openRate = await openingRate(tailNumber, tx);
    let balQty = 0, balValue = 0, map = null, flagged = 0, unpriced = 0, openingAssumed = false;

    // THE DENSITY OF WHAT IS IN THE TANK, carried across the whole replay. It
    // changes only on an uplift - burning fuel does not change the density of
    // what is left - so a burn line simply repeats the blend it was burnt at,
    // which is what converts it to litres.
    let wtAvgSg = null;

    // The arrival gauge of each flight, for the unallocated column. Read once
    // per tail rather than per row: a tail flying four legs a day over three
    // days is 12 reads that would otherwise be 12 round trips.
    const flightIds = [...new Set(rows.map(r => r.flight_ID).filter(Boolean))];
    const flights = flightIds.length
        ? await tx.run(SELECT.from('fuelsphere.FLIGHT_SCHEDULE')
            .columns('ID', 'fob_at_in_kg').where({ ID: { in: flightIds } }))
        : [];
    const arrivalFob = new Map(flights.map(f => [f.ID, num(f.fob_at_in_kg)]));

    for (const row of rows) {
        const move = movementOf(row);
        let qtySigned = 0, rowRate = null, rowValue = null, rowSg = null;

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
            // THE UPLIFT'S OWN DENSITY, from the ticket that recorded it, and
            // the blend it produces. Both are written to the row below.
            rowSg = await upliftGravity(row, tx);
            wtAvgSg = blendGravity(balQty, wtAvgSg, move.qty, rowSg);

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
            //
            // Quantity and value are both SIGNED NEGATIVE, the rate is not:
            // the ledger reads "-2,295 kg at 1.1345 = -2,603.68", which is the
            // form the signed-off specimen uses. A FLIGHT row recorded from
            // FUEL_BURNS carries the same
            // signs at posting time, so a replay restates a burn row rather
            // than inverting it.
            const atMap = map === null ? 0 : map;
            rowRate = atMap;
            rowValue = money(-move.qty * atMap);
            balQty = Number((balQty - move.qty).toFixed(2));
            balValue = money(balValue + rowValue);
            qtySigned = -move.qty;
        } else {
            qtySigned = 0; rowRate = null; rowValue = null;
        }

        // WHAT THE LEDGER CANNOT ACCOUNT FOR. On a BLOCK burn line only: the
        // balance this replay has arrived at, minus what the aircraft's own
        // gauge said on arrival. Ground APU burn that nobody recorded, meter
        // tolerance and rounding all show up here, and a figure far below zero
        // means fuel left the tanks without a line to say so.
        //
        // Not computed on the APU line: that line comes after, and comparing a
        // post-APU balance with an arrival reading taken before the APU ran
        // would report the APU burn itself as unaccounted for.
        let unallocated = null;
        if (row.entry_type === 'BURN' && row.flight_ID) {
            const fobIn = arrivalFob.get(row.flight_ID);
            if (fobIn !== null && fobIn !== undefined) {
                unallocated = money(balQty - fobIn);
            }
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
            specific_gravity: rowSg,
            wt_avg_specific_gravity: wtAvgSg,
            unallocated_fuel_kg: unallocated,
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

module.exports = { recalculateTail, lineOrderOf, LINE_ORDER, blendGravity };

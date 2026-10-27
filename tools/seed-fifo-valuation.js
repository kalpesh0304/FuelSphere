#!/usr/bin/env node
/**
 * FuelSphere - value the JetBlue movements twice, FIFO and moving average.
 *
 * ONE REPLAY PER TAIL, TWO VALUATIONS. The movements are identical - the same
 * tickets, the same burns, the same APU cycles, in the same order - and only
 * the pricing differs. That is what makes the comparison worth anything: if
 * the two methods ran over different movements, a difference in cost would
 * tell you nothing about the methods.
 *
 * THE ORDER IS THE ALGORITHM. FIFO consumes the oldest layer first, so the
 * sequence movements are replayed in IS the answer. Sorted by off-block time,
 * then by line order within an instant: uplift before burn (fuel is on board
 * before it is consumed), block burn before APU burn (the APU runs on stand,
 * after the leg). A flight date alone cannot order two uplifts on one day,
 * which is why flight_aobt is carried on every row.
 *
 * WHAT IS VALUED, and it is a decision rather than an accident:
 *
 *   uplift     the ticket's quantity_kg at the ticket's own price
 *              (total_amount / quantity_kg, so rate x qty rebuilds the value)
 *   block burn FUEL_BURNS.actual_burn_kg - the REPORTED figure
 *   APU burn   the sum of APU_USAGE.apu_burn_kg allocated to the flight
 *
 * actual_burn_kg AND NOT THE GAUGE DELTA. The Fuel Overview Report shows
 * FOB out less FOB in and falls back to actual_burn_kg only where a reading is
 * missing, so the two differ on legs where ACARS and the gauges disagree.
 * A valuation must draw down the same stock the movements built: layers filled
 * by one quantity and emptied by another drift apart with every flight. Every
 * burn row records which basis it used.
 *
 * A BURN LARGER THAN THE STOCK ON HAND is possible in seeded data, and it is
 * not papered over: FIFO consumes what layers exist and the shortfall is
 * reported, never valued at an invented price.
 *
 * Run:  node tools/seed-fifo-valuation.js [--write]
 * Without --write it reports what it would produce and changes nothing.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT = path.resolve(__dirname, '..');
const DATA = path.join(PROJECT, 'db', 'data');
const WRITE = process.argv.includes('--write');

const STAMP = '2026-10-06T00:00:00Z';
const BY = 'SEED_FIFO_VALUATION';

// ---- csv ------------------------------------------------------------------
const read = (name) => {
    const text = fs.readFileSync(path.join(DATA, `fuelsphere-${name}.csv`), 'utf8').replace(/^﻿/, '');
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const cols = lines[0].split(';');
    return lines.slice(1).map(l => {
        const f = l.split(';');
        return Object.fromEntries(cols.map((c, i) => [c, (f[i] ?? '').trim()]));
    });
};
const write = (name, cols, rows) => {
    const esc = (v) => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const out = [cols.join(';')];
    for (const r of rows) out.push(cols.map(c => esc(r[c])).join(';'));
    fs.writeFileSync(path.join(DATA, `fuelsphere-${name}.csv`), out.join('\r\n') + '\r\n', 'utf8');
    console.log(`  wrote ${rows.length} rows to fuelsphere-${name}.csv`);
};

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
// the leg, so its fuel leaves after the block burn's.
const LINE_ORDER = { INITIAL: 0, UPLIFT: 1, BLOCK_BURN: 2, APU_BURN: 3, ADJUSTMENT: 4 };

(function main() {
    const tickets = read('FUEL_TICKETS');
    const burns = read('FUEL_BURNS');
    const apu = read('APU_USAGE');
    const flights = read('FLIGHT_SCHEDULE');
    // READ, NEVER WRITTEN. The FOB ledger is the only record of what was on
    // board before the window opens, and a valuation that starts every tail at
    // zero reports a third of its burns as drawing on stock that was not there.
    const ledger = read('ROB_LEDGER');

    const flightById = new Map(flights.map(f => [f.ID, f]));

    // ---- what a batch is CALLED ------------------------------------------
    //
    // THE TICKET NUMBER, NOT THE LEDGER ROW ID. A batch is the parcel of fuel
    // an uplift put on the aircraft, and the thing that identifies that
    // parcel to everyone outside this system is the ticket: BPUK-LHR-
    // 2026032501, not f30eb23b-77c1-5b2f-b7f2-b7bebe69f062.
    //
    // A UUID HERE IS A DEFECT, not a cosmetic one. The batch is shown on the
    // stock valuation screen, it is what a defuel carries into a storage
    // tank, and it is how somebody reconciles a layer back to the delivery it
    // came from. None of that works with a generated key.
    //
    // 1,757 of the 1,763 uplift rows carry a ticket. The handful that do not
    // keep the row id, because a batch must be unique and there is nothing
    // else to call them.
    const ticketNumberById = new Map(tickets.map(t => [t.ID, t.ticket_number || t.internal_number]));
    const openingSeen = new Map();
    const batchNameOf = (r, lineType, tail) => {
        if (lineType === 'UPLIFT') {
            return ticketNumberById.get(r.fuel_ticket_ID) || r.ID || '';
        }
        if (lineType === 'INITIAL') {
            // AN OPENING BALANCE HAS NO TICKET - it is what was already on
            // board when the window opened. It is named for the tail, and
            // numbered only if a tail somehow opens twice.
            const base = `OPENING-${tail}`;
            const n = (openingSeen.get(base) || 0) + 1;
            openingSeen.set(base, n);
            return n === 1 ? base : `${base}-${n}`;
        }
        return null;
    };

    // ---- whose fleet each tail belongs to --------------------------------
    //
    // FROM THE FLIGHTS, NOT FROM THE TAIL MASTER.
    // AIRCRAFT_REGISTRATIONS.operator_code covers every tail and mixes two
    // standards - JBU for JetBlue, AC and ACA both for Air Canada - so a
    // column filled from it would not match a carrier filter typed on any
    // other FuelSphere screen, and one airline would appear under two codes.
    // FLIGHT_SCHEDULE.airline_code is the IATA code the rest of the suite
    // uses.
    //
    // ONE CODE PER TAIL, by majority of its flights. A tail flown under two
    // codes in one window is a wet lease; splitting its rows between them
    // would filter a tail's layers away from the burns that consumed them,
    // so the whole replay takes the code it flew under most.
    const carrierVotes = new Map();
    for (const f of flights) {
        if (!f.tail_registration || !f.airline_code) continue;
        if (!carrierVotes.has(f.tail_registration)) carrierVotes.set(f.tail_registration, new Map());
        const v = carrierVotes.get(f.tail_registration);
        v.set(f.airline_code, (v.get(f.airline_code) || 0) + 1);
    }
    const carrierByTail = new Map();
    let splitTails = 0;
    for (const [tail, votes] of carrierVotes) {
        const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        if (ranked.length > 1) splitTails += 1;
        carrierByTail.set(tail, ranked[0][0]);
    }

    // ---- the tails that never flew in this window ------------------------
    //
    // Four of the 274 have no flight in FLIGHT_SCHEDULE at all - their
    // movements come from tickets and the FOB ledger - so the vote above
    // leaves them blank, and a blank carrier is a row no carrier filter can
    // find.
    //
    // THE MAPPING IS LEARNED FROM THE DATA, NOT WRITTEN DOWN HERE. The tail
    // master records an operator code in a mix of standards (JBU, ACA, PAL)
    // and the carrier master holds only IATA codes, so there is no table to
    // join. But every operator code that DOES appear on a flown tail pairs
    // unambiguously with one airline code - JBU with B6 across 1,762
    // flights, ACA with AC across 18, PAL with PR across 2 - so the pairing
    // is evidence sitting in the data rather than a guess:
    //
    //   operator_code -> airline_code, taken only where every flight of
    //   every tail with that operator agrees.
    //
    // All four unresolved tails carry PAL, which the flown PAL tails
    // (RP-C8801, RP-C8802) pair with PR. An AMBIGUOUS operator - two airline
    // codes on its flown tails - is left alone rather than resolved by
    // majority: inventing a carrier for a row is worse than a blank that
    // says so.
    const register = read('AIRCRAFT_REGISTRATIONS');
    const operatorOfTail = new Map(register
        .filter(r => r.registration && r.operator_code)
        .map(r => [r.registration, r.operator_code]));

    const operatorVotes = new Map();
    for (const [tail, code] of carrierByTail) {
        const op = operatorOfTail.get(tail);
        if (!op) continue;
        if (!operatorVotes.has(op)) operatorVotes.set(op, new Set());
        operatorVotes.get(op).add(code);
    }
    const operatorToIata = new Map();
    for (const [op, codes] of operatorVotes) {
        if (codes.size === 1) operatorToIata.set(op, [...codes][0]);
    }

    let viaOperator = 0;
    for (const [tail, op] of operatorOfTail) {
        if (carrierByTail.has(tail)) continue;
        const code = operatorToIata.get(op);
        if (code) { carrierByTail.set(tail, code); viaOperator += 1; }
    }

    const carrierOf = (tail) => carrierByTail.get(tail) || '';
    const aobtOf = (f) => {
        if (!f) return null;
        if (f.aobt) return f.aobt;
        return f.scheduled_departure ? `${f.flight_date}T${f.scheduled_departure}Z` : null;
    };

    // ---- APU kilograms, per flight the cost falls on --------------------
    const apuByFlight = new Map();
    for (const a of apu) {
        const key = a.allocated_flight_ID || a.flight_ID;
        if (!key) continue;
        apuByFlight.set(key, (apuByFlight.get(key) || 0) + (num(a.apu_burn_kg) || 0));
    }

    // ---- every movement, as one list per tail ---------------------------
    //
    // THE LEDGER IS THE MOVEMENT SOURCE, SINCE 18 Oct 2026. This read tickets,
    // FUEL_BURNS and APU_USAGE directly and derived its own movements, which
    // made it a SECOND implementation of a question ROB_LEDGER already
    // answers - and the two disagreed. Measured before the change: the MAP
    // rate matched on 242 of 265 tails, but closing stock value matched on
    // only 48, and the fleet totals were 1,494,458 USD on the ledger against
    // 1,481,027 USD here, 13,431 apart.
    //
    // Two causes, both fixed by reading the ledger:
    //
    //   DIFFERENT MOVEMENTS. The ledger holds what was POSTED to it,
    //   including ADJUSTMENT rows this seeder never read at all. C-FDMO had
    //   8 movements on the ledger and 10 here, and the closing quantities
    //   differed by 1,236 kg.
    //
    //   AN INVENTED OPENING PRICE. This carried opening stock at the tail's
    //   first uplift rate "because ROB_LEDGER leaves rate and value empty on
    //   INITIAL rows". It does not: 263 of 273 carry a rate. The assumption
    //   was unnecessary and wrong.
    //
    // MAP IS NOT RECOMPUTED HERE ANY MORE - it is COPIED from the ledger,
    // which computes it incrementally when a movement posts (srv/lib/
    // rob-uplift.js) and replays a tail on correction (rob-recalculate.js).
    // That is the only way two screens can be guaranteed to show one number.
    // FIFO is still computed here, because it needs batch layers and the
    // ledger has nowhere to keep them - but now over the SAME movements.
    const byTail = new Map();
    const push = (tail, mv) => {
        if (!tail) return;
        if (!byTail.has(tail)) byTail.set(tail, []);
        byTail.get(tail).push(mv);
    };

    // ---- SEQUENCE IS AUTHORITATIVE, NOT record_time --------------------
    //
    // MEASURED ON THE LEDGER ITSELF, not assumed. On N645JB:
    //
    //   seq 1  00:00:00  INITIAL   closing 3981.34
    //   seq 2  23:18:34  UPLIFT    closing 8746.20
    //   seq 3  22:50:00  BURN      closing 2750.94
    //   seq 4  22:50:00  APU_BURN  closing 2670.27
    //
    // The uplift's timestamp is LATER than the burn's, and the closing
    // balance chain 3981 -> 8746 -> 2751 -> 2670 reconciles only in SEQUENCE
    // order. Whatever wrote closing_rob_kg walked the sequence.
    //
    // Sorting by time first therefore puts a burn ahead of the uplift that
    // fuels it, and FIFO meets an empty tank: 472 burns overdrew by 849,489
    // kg, against 8 before this seeder changed source.
    //
    // NOTE FOR WHOEVER READS THIS NEXT: srv/lib/rob-recalculate.js orders by
    // (date, time, sequence) and srv/lib/rob-litres.js by (date, line_order,
    // time, sequence). Neither matches the sequence the data was written in,
    // and the fleet's closing stock value reads 1,992,615 / 1,494,458 /
    // 1,481,022 USD depending on which of the three you pick. That is a
    // ledger defect, not a valuation one, and it is NOT fixed here - fixing
    // it changes what the FOB ledger and Fuel Overview Report display.
    const LEDGER_ENTRY_RANK = { INITIAL: 0, UPLIFT: 1, BURN: 2, APU_BURN: 3, TRANSFER: 4, ADJUSTMENT: 5 };
    const ledgerOrder = (a, b) =>
        String(a.record_date || '').localeCompare(String(b.record_date || ''))
        || (num(a.sequence) || 0) - (num(b.sequence) || 0)
        // Only where two rows share a sequence: an uplift lands before the
        // burn that draws on it.
        || (LEDGER_ENTRY_RANK[a.entry_type] ?? 9) - (LEDGER_ENTRY_RANK[b.entry_type] ?? 9);

    // ROB_LEDGER entry types in this file's vocabulary.
    const LEDGER_LINE_TYPE = {
        INITIAL: 'INITIAL',
        UPLIFT: 'UPLIFT',
        BURN: 'BLOCK_BURN',
        APU_BURN: 'APU_BURN',
        TRANSFER: 'TRANSFER',
        ADJUSTMENT: 'ADJUSTMENT'
    };

    let unpricedLedger = 0, unvaluedAdjustments = 0;
    const ledgerByTail = new Map();
    for (const r of ledger) {
        if (!r.tail_number) continue;
        if (!ledgerByTail.has(r.tail_number)) ledgerByTail.set(r.tail_number, []);
        ledgerByTail.get(r.tail_number).push(r);
    }

    for (const [tail, rows] of ledgerByTail) {
        for (const r of rows.slice().sort(ledgerOrder)) {
            const lineType = LEDGER_LINE_TYPE[r.entry_type];
            if (!lineType) continue;

            // SIGNED, AS THE LEDGER KEEPS IT: + uplift, - burn. qty_kg is the
            // ledger's own signed movement column, so no sign is inferred.
            //
            // BUT THE LEDGER IS MIXED VINTAGE and qty_kg is not always there.
            // Measured: of 273 INITIAL rows only 266 carry it, and the older
            // ones leave it empty with the opening quantity in closing_rob_kg
            // (opening_rob_kg being 0). Reading qty_kg alone gave those tails
            // no opening layer at all, and FIFO then overdrew on 472 burns
            // for 849,489 kg - against 8 burns before this seeder changed
            // source. An ADJUSTMENT keeps its delta in a third place again.
            //
            // So the quantity is taken from whichever column the row actually
            // uses, in order of how directly it states the movement.
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
            const rate = num(r.rate_usd_per_kg);

            // AN ADJUSTMENT MOVES QUANTITY AND CARRIES NO VALUE - on all 7 of
            // them, in the ledger as well as here. It is passed through so
            // FIFO sees the movement rather than silently diverging from the
            // ledger's quantity, and counted so the gap is visible.
            if (lineType === 'ADJUSTMENT' && (qty === null || rate === null)) unvaluedAdjustments += 1;
            if (qty !== null && qty !== 0 && rate === null) unpricedLedger += 1;

            push(tail, {
                line_type: lineType,
                reference: r.ID,
                batch_ref: batchNameOf(r, lineType, tail),
                qty_kg: qty === null ? null : kg(qty),
                specific_gravity: num(r.specific_gravity) || num(r.wt_avg_specific_gravity),
                rate_usd_per_kg: rate,
                value_usd: num(r.value_usd),
                // WHICH LEG THIS MOVEMENT BELONGS TO, resolved rather than
                // left empty. ROB_LEDGER already names the flight on 5,306 of
                // its 5,580 rows and FLIGHT_SCHEDULE.flight_number holds the
                // IATA designator every other FuelSphere screen prints, so the
                // column was never missing a source - only a lookup. The map
                // is the one built above for the carrier vote.
                //
                // AN OPENING BALANCE NEVER CARRIES ONE, whatever the ledger
                // says. An INITIAL row states what was already on board when
                // the window opened - it is a starting position, not a leg
                // that was flown - so a flight number against it would read as
                // a claim that the fuel arrived on that flight.
                //
                // THIS OVERRIDES THE SOURCE ON 3 ROWS, deliberately. 270 of
                // the 273 INITIAL ledger rows carry no flight_ID anyway; the
                // remaining 3 do, and that link is suppressed here rather than
                // shown, so the column means one thing on every row.
                flight_number: lineType === 'INITIAL' ? null
                    : (flightById.get(r.flight_ID) || {}).flight_number || null,
                flight_date: r.record_date || null,
                flight_aobt: r.record_date ? `${r.record_date}T${r.record_time || '00:00:00'}Z` : null,
                station: r.airport_code || null,
                qty_basis: 'ROB_LEDGER',
                // What the ledger already decided, carried so the MAP rows
                // below are a copy rather than a second calculation.
                ledger_balance_qty: num(r.closing_rob_kg),
                ledger_balance_value: num(r.balance_value_usd),
                ledger_map: num(r.map_usd_per_kg)
            });
        }
    }

    // ---- replay ---------------------------------------------------------
    const movements = [], balances = [], burnHeaders = [];
    let shortfalls = 0, shortfallKg = 0;

    for (const [tail, list] of [...byTail.entries()].sort()) {
        // ALREADY IN LEDGER ORDER - pushed that way above, and re-sorting on
        // flight_aobt would undo it: the ledger orders by date, time and
        // sequence, which is the order the day actually happened in. A
        // re-sort here put all of a four-leg day's uplifts ahead of all its
        // burns, and the running balance then swung through figures the
        // aircraft never held (the trap rob-recalculate.js records).

        // ---- FIFO -------------------------------------------------------
        const layers = [];              // { ref, qty, left, rate, sg, ... }
        let seq = 0;
        for (const mv of list) {
            seq += 1;
            if (mv.line_type === 'UPLIFT' || mv.line_type === 'INITIAL') {
                // ABS, BECAUSE THE LEDGER'S qty_kg IS SIGNED. It reads +
                // on an uplift and - on a burn; a layer holds a magnitude.
                layers.push({ ...mv, left: Math.abs(mv.qty_kg || 0), layer_no: layers.length + 1 });
                movements.push(row('FIFO', tail, mv, {
                    batch_ref: mv.batch_ref,
                    qty_kg: mv.qty_kg,
                    rate_usd_per_kg: mv.rate_usd_per_kg,
                    value_usd: mv.value_usd,
                    seq
                }));
                continue;
            }
            // A BURN EATS THE OLDEST LAYER FIRST, and one row is written per
            // layer it touches - that explosion is what FIFO is.
            // ABS FOR THE SAME REASON. A burn arrives as a NEGATIVE qty_kg
            // from the ledger, and `need <= 0` broke the consumption loop on
            // its first test - every burn consumed nothing, FIFO charged 0
            // USD across the fleet and left the entire 21.4m in open layers.
            let need = Math.abs(mv.qty_kg || 0), taken = 0, value = 0, used = 0;
            for (const L of layers) {
                if (need <= 0) break;
                if (L.left <= 0) continue;
                const take = Math.min(L.left, need);
                L.left = kg(L.left - take);
                need = kg(need - take);
                taken += take; value += take * (L.rate_usd_per_kg || 0); used += 1;
                movements.push(row('FIFO', tail, mv, {
                    batch_ref: L.batch_ref,
                    qty_kg: kg(-take),
                    specific_gravity: L.specific_gravity,
                    rate_usd_per_kg: L.rate_usd_per_kg,
                    value_usd: money(-take * (L.rate_usd_per_kg || 0)),
                    seq
                }));
            }
            if (need > 0.001) { shortfalls += 1; shortfallKg += need; }
            // A BURN WITH NO LAYER TO DRAW ON STILL HAPPENED, and FIFO must
            // say so. The loop above writes one row per layer consumed, so a
            // burn against empty stock wrote NOTHING - the movement appeared
            // under MAP, which caps at zero and still writes its row, and
            // vanished under FIFO. Eight burns were invisible on one view and
            // present on the other, which reads as a bug in whichever view the
            // reader happens to trust.
            //
            // The mirror row carries zero quantity and zero value, exactly as
            // MAP's does, so neither method claims fuel it could not price.
            // layers_consumed = 0 on the header is the readable signal.
            if (used === 0) {
                movements.push(row('FIFO', tail, mv, {
                    batch_ref: null,
                    qty_kg: kg(0),
                    rate_usd_per_kg: 0,
                    value_usd: money(0),
                    seq
                }));
            }
            burnHeaders.push(header('FIFO', tail, mv, taken, value, used));
        }
        for (const L of layers) {
            balances.push(balance('FIFO', tail, L, L.left, L.left * (L.rate_usd_per_kg || 0)));
        }

        // ---- MAP --------------------------------------------------------
        //
        // COPIED FROM THE LEDGER, NOT RECOMPUTED. ROB_LEDGER computes the
        // moving average when a movement posts and stores it on the row; the
        // FOB ledger and the Fuel Overview Report both display it. Working it
        // out again here would be a second implementation of one rule, which
        // is exactly what produced a 13,431 USD disagreement on closing stock
        // before 18 Oct 2026.
        //
        // So every MAP figure below is the ledger's own: the rate it charged,
        // the running balance it carried, the average it held afterwards.
        // s4-style arithmetic is not repeated - it is read.
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
            movements.push(row('MAP', tail, mv, {
                qty_kg: mv.qty_kg,
                rate_usd_per_kg: mv.rate_usd_per_kg,
                value_usd: mv.value_usd,
                balance_qty_kg: mv.ledger_balance_qty,
                balance_value_usd: mv.ledger_balance_value,
                map_usd_per_kg: mv.ledger_map,
                seq
            }));
            // A BURN'S COST UNDER MAP IS WHAT THE LEDGER CHARGED IT. On the
            // ledger a burn's rate_usd_per_kg IS the MAP it was consumed at,
            // so the burn header takes that rather than deriving one.
            if (!isIn && mv.qty_kg !== null && mv.qty_kg < 0) {
                const takenKg = Math.abs(mv.qty_kg);
                const chargedValue = Math.abs(num(mv.value_usd) ?? (takenKg * (mv.rate_usd_per_kg || 0)));
                burnHeaders.push(header('MAP', tail, mv, takenKg, chargedValue, 1));
            }
        }
        balances.push(balance('MAP', tail, { station: null, flight_number: null, flight_date: null, flight_aobt: null, specific_gravity: null, qty_kg: null }, lastQty ?? 0, lastValue ?? 0, lastMap ?? 0));
    }

    // ---- shapes ---------------------------------------------------------
    function row(method, tail, mv, over) {
        const sg = over.specific_gravity ?? mv.specific_gravity ?? null;
        const q = over.qty_kg ?? null;
        return {
            ID: uuid5(`MOV:${method}:${tail}:${mv.reference}:${over.batch_ref || '-'}:${over.seq}:${q}`),
            valuation_method: method, tail_number: tail,
            carrier_code: carrierOf(tail),
            batch_ref: over.batch_ref || '',
            flight_number: mv.flight_number || '', flight_date: mv.flight_date || '',
            flight_aobt: mv.flight_aobt || '', station: mv.station || '',
            // EMPTY ON EVERY SEEDED ROW, and it should be. A storage location
            // is only ever written by a defuel posted through DefuelService;
            // nothing in the historical replay put fuel into a tank on the
            // ground. The column exists here so the seeded rows and the
            // posted ones have the same shape.
            storage_location: mv.storage_location || '',
            reference: mv.reference, line_type: mv.line_type,
            qty_kg: q, qty_l: litres(q, sg), specific_gravity: sg ?? '',
            rate_usd_per_kg: over.rate_usd_per_kg ?? '', value_usd: over.value_usd ?? '',
            balance_qty_kg: over.balance_qty_kg ?? '', balance_value_usd: over.balance_value_usd ?? '',
            map_usd_per_kg: over.map_usd_per_kg ?? '',
            line_order: LINE_ORDER[mv.line_type], sequence: over.seq,
            created_at: STAMP, created_by: BY, modified_at: STAMP, modified_by: BY
        };
    }
    function balance(method, tail, L, left, value, mapRate) {
        return {
            // THE LAYER NUMBER IS IN THE KEY, not decoration. batch_ref alone
            // is not unique within a tail - two layers sharing one reference
            // produced two rows with one ID, and the deploy failed on the
            // primary key rather than on the arithmetic. The number is the
            // layer's position in replay order, so it is stable across runs.
            ID: uuid5(`BAL:${method}:${tail}:${L.batch_ref || '-'}:${L.layer_no ?? 0}`),
            valuation_method: method, tail_number: tail, carrier_code: carrierOf(tail),
            batch_ref: L.batch_ref || '',
            storage_location: L.storage_location || '',
            // Empty under MAP, whose pool no single movement opened.
            line_type: L.line_type || '',
            station: L.station || '', flight_number: L.flight_number || '',
            flight_date: L.flight_date || '', flight_aobt: L.flight_aobt || '',
            uplift_qty_kg: L.qty_kg ?? '', uplift_qty_l: litres(L.qty_kg ?? null, L.specific_gravity),
            balance_qty_kg: kg(left), balance_qty_l: litres(kg(left), L.specific_gravity),
            specific_gravity: L.specific_gravity ?? '',
            rate_usd_per_kg: mapRate ?? L.rate_usd_per_kg ?? '', value_usd: money(value),
            created_at: STAMP, created_by: BY, modified_at: STAMP, modified_by: BY
        };
    }
    function header(method, tail, mv, qty, value, used) {
        return {
            ID: uuid5(`HDR:${method}:${tail}:${mv.reference}`),
            valuation_method: method, tail_number: tail, carrier_code: carrierOf(tail),
            flight_number: mv.flight_number || '', flight_date: mv.flight_date || '',
            flight_aobt: mv.flight_aobt || '', station: mv.station || '',
            line_type: mv.line_type, burn_ref: mv.reference,
            burn_qty_kg: kg(qty), burn_qty_l: litres(kg(qty), mv.specific_gravity),
            burn_rate_usd_per_kg: qty > 0 ? rate(value / qty) : '',
            burn_value_usd: money(value), layers_consumed: used,
            qty_basis: mv.qty_basis || 'REPORTED_BURN',
            created_at: STAMP, created_by: BY, modified_at: STAMP, modified_by: BY
        };
    }

    // ---- report ---------------------------------------------------------
    const by = (rows, m) => rows.filter(r => r.valuation_method === m).length;
    console.log(`${byTail.size} tails replayed from ROB_LEDGER (${ledger.length} ledger rows)`);
    const noCarrier = [...byTail.keys()].filter(t => !carrierOf(t));
    console.log(`  carrier code resolved for ${[...byTail.keys()].length - noCarrier.length} of `
              + `${[...byTail.keys()].length} tail(s)`
              + (splitTails ? `; ${splitTails} tail(s) flew under more than one code and take the majority` : '')
              + (viaOperator ? `; ${viaOperator} resolved through the operator code `
                             + `(${[...operatorToIata].map(([o, c]) => o + '->' + c).join(', ')})` : '')
              + (noCarrier.length ? `; BLANK on ${noCarrier.length}: ${noCarrier.slice(0, 5).join(', ')}` : ''));
    console.log(`  ${unpricedLedger} ledger movement(s) move quantity with no rate - carried at zero, never invented`);
    console.log(`  ${unvaluedAdjustments} ADJUSTMENT row(s) carry neither quantity nor value, on the ledger as here`);
    console.log(`movements   ${movements.length}  (FIFO ${by(movements, 'FIFO')}, MAP ${by(movements, 'MAP')})`);
    console.log(`balances    ${balances.length}  (FIFO ${by(balances, 'FIFO')}, MAP ${by(balances, 'MAP')})`);
    console.log(`burn rows   ${burnHeaders.length}  (FIFO ${by(burnHeaders, 'FIFO')}, MAP ${by(burnHeaders, 'MAP')})`);
    if (shortfalls) {
        console.log(`\n${shortfalls} burn(s) exceeded the stock on hand by ${shortfallKg.toFixed(0)} kg in total.`);
        console.log('  Valued at what the layers held; the shortfall is NOT priced at an invented rate.');
    }

    const sum = (rows, m, c) => rows.filter(r => r.valuation_method === m)
        .reduce((t, r) => t + (Number(r[c]) || 0), 0);
    const fifoBurn = -sum(burnHeaders, 'FIFO', 'burn_value_usd');
    const mapBurn = -sum(burnHeaders, 'MAP', 'burn_value_usd');
    console.log(`\nburn value charged: FIFO ${Math.abs(fifoBurn).toFixed(0)} USD, `
              + `MAP ${Math.abs(mapBurn).toFixed(0)} USD, `
              + `difference ${Math.abs(Math.abs(fifoBurn) - Math.abs(mapBurn)).toFixed(0)} USD`);
    console.log(`closing inventory:  FIFO ${sum(balances, 'FIFO', 'value_usd').toFixed(0)} USD, `
              + `MAP ${sum(balances, 'MAP', 'value_usd').toFixed(0)} USD`);

    if (!WRITE) { console.log('\nDRY RUN - nothing written. Re-run with --write.'); return; }

    console.log('');
    write('FUEL_STOCK_MOVEMENT_LEDGER', Object.keys(movements[0]), movements);
    write('FUEL_STOCK_BALANCE', Object.keys(balances[0]), balances);
    write('FUEL_BURN_HEADER', Object.keys(burnHeaders[0]), burnHeaders);
})();

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
    const byTail = new Map();
    const push = (tail, mv) => {
        if (!tail) return;
        if (!byTail.has(tail)) byTail.set(tail, []);
        byTail.get(tail).push(mv);
    };

    // ---- what was already on board ---------------------------------------
    //
    // THE OPENING QUANTITY IS RECORDED AND ITS PRICE IS NOT. ROB_LEDGER's
    // INITIAL rows carry closing_rob_kg and leave rate and value empty, so
    // FIFO has a layer with no price to value it at.
    //
    // It is carried at the TAIL'S FIRST UPLIFT RATE, and that is an
    // ASSUMPTION, marked as one: the batch is called OPENING so no reader
    // mistakes it for a ticket, and a tail that never uplifts carries its
    // opening stock at zero rather than at a price invented for it. The
    // alternative - leaving the stock out - was worse: it made 923 burns
    // look like they drew on fuel that did not exist.
    let openingTails = 0, openingUnpriced = 0;
    const firstRateByTail = new Map();
    for (const t of tickets) {
        const mass = num(t.quantity_kg), amount = num(t.total_amount);
        const tail = t.tail_registration;
        if (!tail || firstRateByTail.has(tail) || mass === null || mass <= 0 || amount === null) continue;
        firstRateByTail.set(tail, rate(amount / mass));
    }
    //
    // ONE OPENING LAYER PER TAIL, AND THREE TAILS FORCE THE RULE. C-FDMO,
    // C-FDMP and C-GDMS each carry TWO INITIAL rows in ROB_LEDGER, twenty
    // minutes apart at the same station - one from an older seed vintage with
    // no line_order, one current. Taking both gave the tail two opening
    // layers, double-counting stock that was only ever there once, and
    // collided their balance rows on a shared batch_ref.
    //
    // The LAST in replay order wins, which is the ledger's own semantic: an
    // INITIAL row sets the balance, so a later one supersedes an earlier one
    // rather than adding to it. Here it also happens to pick the current-
    // vintage row, but the rule is the reason, not the coincidence.
    const initialByTail = new Map();
    const ledgerKey = (r) => [r.record_date || '', r.record_time || '',
        String(r.line_order ?? '').padStart(6, '0'), String(r.sequence ?? '').padStart(6, '0')].join('|');
    for (const r of ledger) {
        if (r.entry_type !== 'INITIAL') continue;
        const qty = num(r.closing_rob_kg);
        if (qty === null || qty <= 0 || !r.tail_number) continue;
        const prev = initialByTail.get(r.tail_number);
        if (!prev || ledgerKey(r) >= ledgerKey(prev)) initialByTail.set(r.tail_number, r);
    }
    let openingSuperseded = 0;
    for (const r of ledger) {
        if (r.entry_type !== 'INITIAL' || !r.tail_number) continue;
        const qty0 = num(r.closing_rob_kg);
        if (qty0 === null || qty0 <= 0) continue;
        if (initialByTail.get(r.tail_number) !== r) openingSuperseded += 1;
    }
    for (const r of initialByTail.values()) {
        const qty = num(r.closing_rob_kg);
        const tail = r.tail_number;
        const assumed = firstRateByTail.get(tail);
        if (assumed === undefined) openingUnpriced += 1;
        openingTails += 1;
        push(tail, {
            line_type: 'INITIAL',
            reference: 'OPENING',
            batch_ref: 'OPENING',
            qty_kg: kg(qty),
            specific_gravity: num(r.wt_avg_specific_gravity),
            rate_usd_per_kg: assumed ?? 0,
            value_usd: money(qty * (assumed ?? 0)),
            flight_number: null,
            flight_date: r.record_date || null,
            flight_aobt: r.record_date ? `${r.record_date}T${r.record_time || '00:00:00'}Z` : null,
            station: r.airport_code || null
        });
    }

    let noPrice = 0, noMass = 0;
    for (const t of tickets) {
        const mass = num(t.quantity_kg);
        if (mass === null || mass <= 0) { noMass++; continue; }
        const amount = num(t.total_amount);
        if (amount === null) noPrice++;
        const f = flightById.get(t.flight_ID);
        const sg = num(t.density_value);
        push(t.tail_registration, {
            line_type: 'UPLIFT',
            reference: t.ticket_number || t.ID,
            batch_ref: t.ticket_number || t.ID,
            qty_kg: kg(mass),
            specific_gravity: sg,
            // THE PRICE THE TICKET PAID, back-solved per kilogram so that
            // rate x qty rebuilds the ticket's own value exactly. A ticket
            // with no amount is carried at zero rather than refused - the
            // fuel moved, and the money is simply not known yet.
            rate_usd_per_kg: amount === null ? 0 : rate(amount / mass),
            value_usd: amount === null ? 0 : money(amount),
            flight_number: t.flight_number || (f ? f.flight_number : null),
            flight_date: f ? f.flight_date : null,
            flight_aobt: aobtOf(f),
            station: f ? f.origin_airport : null
        });
    }

    for (const b of burns) {
        const mass = num(b.actual_burn_kg);
        const f = flightById.get(b.flight_ID);
        if (mass !== null && mass > 0) {
            push(b.tail_registration || b.tail_number, {
                line_type: 'BLOCK_BURN',
                reference: b.ID,
                qty_kg: kg(mass),
                flight_number: b.flight_number || (f ? f.flight_number : null),
                flight_date: f ? f.flight_date : b.burn_date,
                flight_aobt: aobtOf(f),
                station: f ? f.origin_airport : null,
                qty_basis: 'REPORTED_BURN'
            });
        }
        const apuKg = b.flight_ID ? apuByFlight.get(b.flight_ID) : null;
        if (apuKg) {
            push(b.tail_registration || b.tail_number, {
                line_type: 'APU_BURN',
                reference: `${b.ID}:APU`,
                qty_kg: kg(apuKg),
                flight_number: b.flight_number || (f ? f.flight_number : null),
                flight_date: f ? f.flight_date : b.burn_date,
                flight_aobt: aobtOf(f),
                station: f ? f.origin_airport : null,
                qty_basis: 'APU_CYCLES'
            });
        }
    }

    // ---- replay ---------------------------------------------------------
    const movements = [], balances = [], burnHeaders = [];
    let shortfalls = 0, shortfallKg = 0;

    for (const [tail, list] of [...byTail.entries()].sort()) {
        list.sort((a, b) =>
            String(a.flight_aobt || '').localeCompare(String(b.flight_aobt || ''))
            || (LINE_ORDER[a.line_type] - LINE_ORDER[b.line_type])
            || String(a.reference).localeCompare(String(b.reference)));

        // ---- FIFO -------------------------------------------------------
        const layers = [];              // { ref, qty, left, rate, sg, ... }
        let seq = 0;
        for (const mv of list) {
            seq += 1;
            if (mv.line_type === 'UPLIFT' || mv.line_type === 'INITIAL') {
                layers.push({ ...mv, left: mv.qty_kg, layer_no: layers.length + 1 });
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
            let need = mv.qty_kg, taken = 0, value = 0, used = 0;
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
        let qty = 0, val = 0, map = 0;
        seq = 0;
        for (const mv of list) {
            seq += 1;
            if (mv.line_type === 'UPLIFT' || mv.line_type === 'INITIAL') {
                qty = kg(qty + mv.qty_kg); val = money(val + (mv.value_usd || 0));
                map = qty > 0 ? rate(val / qty) : map;
                movements.push(row('MAP', tail, mv, {
                    qty_kg: mv.qty_kg,
                    rate_usd_per_kg: mv.rate_usd_per_kg,
                    value_usd: mv.value_usd,
                    balance_qty_kg: qty, balance_value_usd: val, map_usd_per_kg: map,
                    seq
                }));
                continue;
            }
            // A BURN LEAVES THE AVERAGE ALONE - it takes fuel out at the price
            // the stock already stood at, which is the whole of the method.
            const take = Math.min(mv.qty_kg, Math.max(qty, 0));
            const value = money(take * map);
            qty = kg(qty - take); val = money(val - value);
            movements.push(row('MAP', tail, mv, {
                qty_kg: kg(-take),
                rate_usd_per_kg: map,
                value_usd: money(-value),
                balance_qty_kg: qty, balance_value_usd: val, map_usd_per_kg: map,
                seq
            }));
            burnHeaders.push(header('MAP', tail, mv, take, value, 1));
        }
        balances.push(balance('MAP', tail, { station: null, flight_number: null, flight_date: null, flight_aobt: null, specific_gravity: null, qty_kg: null }, qty, val, map));
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
    console.log(`${byTail.size} tails replayed`);
    console.log(`  opening stock carried on ${openingTails} tail(s) at the tail's first uplift rate `
              + `(${openingUnpriced} had no uplift and carry it at zero)`);
    console.log(`  ${openingSuperseded} earlier INITIAL ledger row(s) superseded by a later one on the same tail`);
    const noCarrier = [...byTail.keys()].filter(t => !carrierOf(t));
    console.log(`  carrier code resolved for ${[...byTail.keys()].length - noCarrier.length} of `
              + `${[...byTail.keys()].length} tail(s)`
              + (splitTails ? `; ${splitTails} tail(s) flew under more than one code and take the majority` : '')
              + (viaOperator ? `; ${viaOperator} resolved through the operator code `
                             + `(${[...operatorToIata].map(([o, c]) => o + '->' + c).join(', ')})` : '')
              + (noCarrier.length ? `; BLANK on ${noCarrier.length}: ${noCarrier.slice(0, 5).join(', ')}` : ''));
    console.log(`  tickets skipped, no mass: ${noMass}; carried at zero rate, no amount: ${noPrice}`);
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

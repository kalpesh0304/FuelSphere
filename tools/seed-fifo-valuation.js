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

// THE REPLAY ITSELF LIVES IN srv/lib/stock-replay.js since 27 Oct 2026, so
// this seed and the defuel service compute one valuation, not two.
const {
    num, makeContext, movementsOf, replayTail, storageBalances
} = require('../srv/lib/stock-replay');


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
    // THE LEDGER IS THE MOVEMENT SOURCE, SINCE 18 Oct 2026, and the replay is
    // srv/lib/stock-replay.js. A DEFUEL row on the ledger is valued from its
    // document, which is why the DEFUEL table is read too.
    const defuels = fs.existsSync(path.join(DATA, 'fuelsphere-DEFUEL.csv')) ? read('DEFUEL') : [];
    const ctx = makeContext({
        flightById, ticketNumberById, carrierOf,
        defuelById: new Map(defuels.map(d => [d.ID, d])),
        stamp: STAMP, by: BY
    });

    const ledgerByTail = new Map();
    for (const r of ledger) {
        if (!r.tail_number) continue;
        if (!ledgerByTail.has(r.tail_number)) ledgerByTail.set(r.tail_number, []);
        ledgerByTail.get(r.tail_number).push(r);
    }
    const byTail = new Map();
    for (const [tail, rows] of ledgerByTail) {
        const list = movementsOf(tail, rows, ctx);
        if (list.length) byTail.set(tail, list);
    }
    const { unpricedLedger, unvaluedAdjustments } = ctx.counts;

    // ---- replay ---------------------------------------------------------
    const movements = [], balances = [], burnHeaders = [];
    let shortfalls = 0, shortfallKg = 0;
    for (const [tail, list] of [...byTail.entries()].sort()) {
        const r = replayTail(tail, list, ctx);
        movements.push(...r.movements);
        balances.push(...r.balances);
        burnHeaders.push(...r.burnHeaders);
        shortfalls += r.shortfalls; shortfallKg += r.shortfallKg;
    }
    // WHAT EACH TANK HOLDS, from the defuels that put fuel into it.
    balances.push(...storageBalances(movements, ctx));

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

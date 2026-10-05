#!/usr/bin/env node
/**
 * FuelSphere - seed APU_USAGE for the JetBlue days, without emptying a tank.
 *
 * THE CONSTRAINT IS THE WHOLE PROBLEM. Ground APU burn is ADDITIONAL to the
 * block burn: it happens on stand, outside the block period, so it never
 * appears in a FOB delta. Writing it into the ledger therefore takes fuel OUT
 * that nothing put back, and a tail that was already running close to empty
 * goes negative - which was ruled out explicitly.
 *
 * So the figures are not invented first and checked afterwards. For every
 * tail, the headroom is computed FIRST:
 *
 *     headroom = initial stock + every uplift - every block burn
 *
 * and the APU cycles for that tail are scaled to fit inside a fraction of it.
 * A tail with no headroom gets no APU rows at all, which is the honest
 * outcome: we would be asserting fuel burnt that the tail never had.
 *
 * ONE CYCLE PER TURNAROUND, pre-departure, which is the phase that actually
 * consumes fuel on stand before a leg. Overnight cycles are not invented -
 * nobody recorded them, and a seeded overnight cycle would be a fact nobody
 * can check.
 *
 * Run:  node tools/seed-apu-usage.js [--write]
 * Without --write it reports what it would do and changes nothing.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA = path.join(__dirname, '..', 'db', 'data');
const file = (name) => path.join(DATA, `fuelsphere-${name}.csv`);

// How much of a tail's headroom the APU may consume, in total. A fifth leaves
// the ledger comfortably positive even where a tail lands nearly dry.
const HEADROOM_SHARE = 0.20;

// A turnaround's APU run, before scaling. 25 to 55 minutes is a normal stand
// time with the APU running for air conditioning and electrical power.
const MIN_MINUTES = 25;
const MAX_MINUTES = 55;

const read = (name) => {
    const text = fs.readFileSync(file(name), 'utf8').replace(/^﻿/, '');
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const header = lines[0].split(';');
    return lines.slice(1).map(line => {
        const cells = line.split(';');
        const row = {};
        header.forEach((h, i) => { row[h] = cells[i] !== undefined ? cells[i] : ''; });
        return row;
    });
};

const num = (v) => (v === '' || v === undefined || v === null ? null : Number(v));
const uuid5 = (seed) => {
    const h = crypto.createHash('sha1').update('fuelsphere/apu/' + seed).digest('hex');
    return [h.slice(0, 8), h.slice(8, 12), '5' + h.slice(13, 16),
            ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + h.slice(18, 20),
            h.slice(20, 32)].join('-');
};

/** A deterministic 0..1 from a string, so a re-run produces the same seed. */
function rand(seed) {
    const h = crypto.createHash('sha1').update(String(seed)).digest();
    return ((h[0] << 8) + h[1]) / 65535;
}

function main() {
    const write = process.argv.includes('--write');

    const flights = read('FLIGHT_SCHEDULE');
    const ledger = read('ROB_LEDGER');
    const regs = read('AIRCRAFT_REGISTRATIONS');

    const rateOf = new Map(regs.map(r => [r.registration, num(r.apu_burn_rate_kg_hr)]));

    // ---- the headroom, per tail ------------------------------------------
    //
    // Read from the ledger rather than recomputed: it already holds the
    // opening stock, every uplift and every block burn, in the order they
    // happened, and it is what the APU lines will be added to.
    const byTail = new Map();
    for (const l of ledger) {
        const tail = l.tail_number;
        if (!tail) continue;
        if (!byTail.has(tail)) byTail.set(tail, { uplift: 0, burn: 0, initial: 0 });
        const t = byTail.get(tail);
        if (l.entry_type === 'INITIAL') t.initial += num(l.closing_rob_kg) || 0;
        if (l.entry_type === 'UPLIFT') t.uplift += num(l.uplift_kg) || 0;
        if (l.entry_type === 'BURN') t.burn += num(l.burn_kg) || 0;
    }

    // ---- the legs that can carry a cycle ---------------------------------
    const legs = flights
        .filter(f => f.aircraft_reg && f.flight_date && f.aobt)
        .sort((a, b) => String(a.aobt).localeCompare(String(b.aobt)));

    const legsByTail = new Map();
    for (const f of legs) {
        if (!legsByTail.has(f.aircraft_reg)) legsByTail.set(f.aircraft_reg, []);
        legsByTail.get(f.aircraft_reg).push(f);
    }

    const rows = [];
    const report = [];

    for (const [tail, tailLegs] of legsByTail) {
        const t = byTail.get(tail);
        if (!t) continue;

        const headroom = t.initial + t.uplift - t.burn;
        const budget = headroom * HEADROOM_SHARE;

        if (!(budget > 0)) {
            report.push(`${tail.padEnd(8)} headroom ${headroom.toFixed(0).padStart(8)} kg  -> no APU rows`);
            continue;
        }

        const rate = rateOf.get(tail) || 110;

        // What the cycles would burn unscaled, then the factor that fits them
        // into the budget. Never scaled UP: the minutes are meant to look like
        // a turnaround, not to spend the budget.
        const planned = tailLegs.map((f, i) => {
            const r = rand(`${tail}/${f.ID}/${i}`);
            return MIN_MINUTES + r * (MAX_MINUTES - MIN_MINUTES);
        });
        const unscaledKg = planned.reduce((s, m) => s + (m / 60) * rate, 0);
        const factor = unscaledKg > budget ? budget / unscaledKg : 1;

        let burnt = 0;
        tailLegs.forEach((f, i) => {
            const minutes = Math.round(planned[i] * factor);
            if (minutes < 5) return;                       // not worth a row

            const kg = Number(((minutes / 60) * rate).toFixed(2));
            burnt += kg;

            // The cycle ends at off-blocks and starts `minutes` before it:
            // this is the stand time immediately before the leg departs.
            const stop = new Date(f.aobt);
            const start = new Date(stop.getTime() - minutes * 60000);

            rows.push({
                ID: uuid5(`${tail}/${f.ID}`),
                tail_number: tail,
                tail_registration: tail,
                flight_ID: f.ID,
                apu_start_utc: start.toISOString().replace('.000', ''),
                apu_stop_utc: stop.toISOString().replace('.000', ''),
                usage_phase: 'PRE_DEPARTURE',
                apu_source: 'GROUND_TIME_EST',
                is_open: 'false',
                running_minutes: String(minutes),
                apu_burn_kg: kg.toFixed(2),
                burn_rate_kg_hr: Number(rate).toFixed(2),
                rate_source: 'AIRCRAFT_REGISTRATIONS',
                allocated_flight_ID: f.ID,
                allocation_basis: 'PHASE',
                remarks: 'Seeded ground APU, scaled to stay within the tail stock',
                created_at: '2026-10-02T00:00:00Z',
                created_by: 'seed-apu-usage',
                modified_at: '2026-10-02T00:00:00Z',
                modified_by: 'seed-apu-usage'
            });
        });

        report.push(`${tail.padEnd(8)} headroom ${headroom.toFixed(0).padStart(8)} kg  `
            + `budget ${budget.toFixed(0).padStart(7)}  APU ${burnt.toFixed(0).padStart(6)} kg  `
            + `over ${tailLegs.length} legs`);
    }

    console.log(report.slice(0, 12).join('\n'));
    if (report.length > 12) console.log(`... and ${report.length - 12} more tails`);
    console.log(`\nAPU cycles: ${rows.length}`);
    const total = rows.reduce((s, r) => s + Number(r.apu_burn_kg), 0);
    console.log(`APU fuel  : ${total.toFixed(0)} kg`);

    if (!write) { console.log('\nDry run. Pass --write to update the CSV.'); return; }

    // Existing rows are kept: they are somebody's measured cycles and this
    // tool has no business removing them.
    const existing = read('APU_USAGE');
    const header = Object.keys(rows[0] || existing[0] || {});
    const fresh = rows.filter(r => !existing.some(e => e.ID === r.ID));
    const all = existing.concat(fresh);

    const out = [header.join(';')]
        .concat(all.map(r => header.map(h => (r[h] !== undefined ? r[h] : '')).join(';')))
        .join('\n') + '\n';
    fs.writeFileSync(file('APU_USAGE'), out, 'utf8');
    console.log(`\nWritten: ${existing.length} kept, ${fresh.length} added`);
}

main();

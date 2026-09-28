/**
 * FuelSphere - build FUEL_BURNS and ROB_LEDGER rows for seeded flights.
 *
 * WHY THIS EXISTS. The JetBlue workbook seeds flights, plans, orders,
 * deliveries, tickets and invoices - but not burns and not the ROB ledger,
 * because neither is a document anybody sends us. A burn is what the aircraft
 * did, and a ledger row is what FuelSphere POSTS when a ticket is captured
 * through the app. Rows loaded straight into the database never pass through
 * that posting, so both screens stayed empty however much data arrived.
 *
 * WHAT IT DERIVES, AND FROM WHAT:
 *
 *   burn (kg)        FOB at OUT less FOB at IN - the fuel that left the tanks
 *                    between chocks-off and chocks-on. Both figures are on the
 *                    flight; neither is invented here.
 *   planned burn     the active dispatch plan's trip fuel, where there is one
 *   ledger UPLIFT    one per ticket: the mass it delivered, valued at the
 *                    ticket's own amount
 *   ledger FLIGHT    one per burn, consumed at the prevailing moving average
 *                    price, which it therefore does not move
 *   ledger INITIAL   one per tail, for the fuel already on board before the
 *                    first leg we hold. Valued at the first uplift's rate -
 *                    the honest alternative would be to value it at zero,
 *                    which would understate every balance after it.
 *
 * The valuation mirrors srv/lib/rob-recalculate.js line for line, so pressing
 * Re-Calculate on any tail reproduces what this wrote rather than restating it.
 *
 * Run:  node tools/seed-burns-and-ledger.js
 * It rewrites the two CSVs from scratch for flights it can derive, and keeps
 * every row it did not generate.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA = path.join(__dirname, '..', 'db', 'data');
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);

// --- tiny CSV helpers ------------------------------------------------------
function readCsv(entity) {
    const file = path.join(DATA, `fuelsphere-${entity}.csv`);
    const raw = fs.readFileSync(file, 'utf8');
    const eol = raw.includes(CR + LF) ? CR + LF : LF;
    const lines = raw.replace(/\r?\n$/, '').split(/\r?\n/);
    const header = lines[0].split(';');
    const rows = lines.slice(1).filter(Boolean)
        .map(l => Object.fromEntries(l.split(';').map((v, i) => [header[i], v])));
    return { file, eol, header, rows };
}

function writeCsv(csv, header, rows) {
    const out = [header.join(';')];
    for (const r of rows) out.push(header.map(c => (r[c] === undefined || r[c] === null ? '' : String(r[c]))).join(';'));
    fs.writeFileSync(csv.file, out.join(csv.eol) + csv.eol);
}

/** A stable id, so running this twice produces the same rows, not new ones. */
function uuid5(seed) {
    const b = crypto.createHash('sha1').update('fuelsphere:' + seed).digest();
    b[6] = (b[6] & 0x0f) | 0x50;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = b.subarray(0, 16).toString('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const kg = (v) => (v === null ? null : Number(v.toFixed(2)));
const money = (v) => (v === null ? null : Number(v.toFixed(2)));
const rate = (v) => (v === null ? null : Number(v.toFixed(4)));

const STAMP = '2026-09-28T00:00:00Z';
const BY = 'SEED_BURNS_LEDGER';

// --- the data we build from ------------------------------------------------
const flightsCsv = readCsv('FLIGHT_SCHEDULE');
const dispatchCsv = readCsv('FLIGHT_DISPATCH');
const ticketsCsv = readCsv('FUEL_TICKETS');
const deliveriesCsv = readCsv('FUEL_DELIVERIES');
const burnsCsv = readCsv('FUEL_BURNS');
const ledgerCsv = readCsv('ROB_LEDGER');
const regsCsv = readCsv('AIRCRAFT_REGISTRATIONS');

const capacityByTail = new Map(regsCsv.rows.map(r => [r.registration, num(r.fuel_capacity_kg)]));
const planByFlight = new Map();
for (const p of dispatchCsv.rows) {
    if (p.plan_status !== 'ACTIVE') continue;
    planByFlight.set(p.flight_schedule_ID, p);
}
const ticketsByFlight = new Map();
for (const t of ticketsCsv.rows) {
    if (!t.flight_ID) continue;
    if (!ticketsByFlight.has(t.flight_ID)) ticketsByFlight.set(t.flight_ID, []);
    ticketsByFlight.get(t.flight_ID).push(t);
}

// Flights we can derive a burn for: both gauge readings and a tail.
const flights = flightsCsv.rows
    .filter(f => f.tail_registration && num(f.fob_at_out_kg) !== null && num(f.fob_at_in_kg) !== null)
    .sort((a, b) => (a.flight_date + (a.scheduled_departure || '')).localeCompare(b.flight_date + (b.scheduled_departure || '')));

// ===========================================================================
// 1. THE BURNS
// ===========================================================================
const generatedBurns = [];
for (const f of flights) {
    const out = num(f.fob_at_out_kg), inn = num(f.fob_at_in_kg);
    const actual = kg(out - inn);
    if (actual === null || actual <= 0) continue;   // not a burn; leave it alone

    const plan = planByFlight.get(f.ID);
    const planned = plan ? num(plan.trip_fuel_kg) : null;
    const varianceKg = planned === null ? null : kg(actual - planned);
    const variancePct = planned ? Number(((actual - planned) / planned * 100).toFixed(2)) : null;

    generatedBurns.push({
        ID: uuid5('FUEL_BURNS:' + f.ID),
        flight_ID: f.ID,
        aircraft_type_code: f.aircraft_type || '',
        tail_number: f.tail_registration,
        tail_registration: f.tail_registration,
        burn_date: f.flight_date,
        burn_time: f.scheduled_departure || '',
        block_off_time: f.aobt || '',
        block_on_time: f.aibt || '',
        flight_duration_mins: f.actual_block_mins || f.planned_block_mins || '',
        planned_burn_kg: planned === null ? '' : planned,
        actual_burn_kg: actual,
        trip_fuel_kg: planned === null ? '' : planned,
        // APU hours are not in the seed, so the split is unknown. Left blank
        // rather than apportioned: engine burn is block less APU, and guessing
        // the APU share would put an invented figure in both columns.
        apu_burn_kg: '',
        engine_burn_kg: '',
        variance_kg: varianceKg === null ? '' : varianceKg,
        variance_pct: variancePct === null ? '' : variancePct,
        variance_status: variancePct === null ? '' : (Math.abs(variancePct) > 5 ? 'EXCEEDED' : 'NORMAL'),
        data_source: 'ACARS',
        status: 'CONFIRMED',
        requires_review: 'false',
        finance_posted: 'false',
        created_at: STAMP, created_by: BY, modified_at: STAMP, modified_by: BY
    });
}

// ===========================================================================
// 2. THE LEDGER
// ===========================================================================
//
// Per tail, in the order the aircraft flew: an opening balance, then for each
// leg the uplift that went on and the burn that came off.
const LINE_ORDER = { INITIAL: 0, UPLIFT: 1, FLIGHT: 2 };
const byTail = new Map();
for (const f of flights) {
    if (!byTail.has(f.tail_registration)) byTail.set(f.tail_registration, []);
    byTail.get(f.tail_registration).push(f);
}

const generatedLedger = [];
for (const [tail, legs] of byTail) {
    const capacity = capacityByTail.get(tail) ?? null;
    let balanceQty = null, balanceValue = null, map = null;
    const sequenceByDate = new Map();
    const nextSequence = (date) => {
        const n = (sequenceByDate.get(date) || 0) + 1;
        sequenceByDate.set(date, n);
        return n;
    };
    const pct = (q) => (capacity && capacity > 0 ? Number(((q / capacity) * 100).toFixed(2)) : '');

    for (const f of legs) {
        const tickets = ticketsByFlight.get(f.ID) || [];
        const upliftKg = kg(tickets.reduce((a, t) => a + (num(t.quantity_kg) || 0), 0));
        const upliftValue = money(tickets.reduce((a, t) => a + (num(t.total_amount) || 0), 0));
        const out = num(f.fob_at_out_kg), inn = num(f.fob_at_in_kg);
        const sector = f.origin_airport && f.destination_airport ? `${f.origin_airport} - ${f.destination_airport}` : '';

        // The opening balance for this tail: what was on board before the
        // first uplift we hold. Valued at that uplift's rate - see the note at
        // the top of this file.
        if (balanceQty === null) {
            const opening = kg(Math.max((out || 0) - (upliftKg || 0), 0));
            const openingRate = upliftKg ? rate(upliftValue / upliftKg) : 0;
            const openingValue = money(opening * (openingRate || 0));
            generatedLedger.push({
                ID: uuid5('ROB_LEDGER:INITIAL:' + tail + ':' + f.ID),
                aircraft_type_code: f.aircraft_type || '', tail_number: tail, tail_registration: tail,
                record_date: f.flight_date, record_time: '00:00:00', sequence: nextSequence(f.flight_date),
                line_order: LINE_ORDER.INITIAL, entry_type: 'INITIAL',
                flight_ID: '', sector: '',
                opening_rob_kg: 0, uplift_kg: 0, burn_kg: 0, adjustment_kg: 0,
                closing_rob_kg: opening, qty_kg: opening,
                rate_usd_per_kg: openingRate || '', value_usd: openingValue,
                balance_value_usd: openingValue, map_usd_per_kg: openingRate || '',
                max_capacity_kg: capacity ?? '', rob_percentage: pct(opening),
                data_source: 'ACARS', is_estimated: 'true',
                created_at: STAMP, created_by: BY, modified_at: STAMP, modified_by: BY
            });
            balanceQty = opening; balanceValue = openingValue; map = openingRate || 0;
        }

        // --- the uplift ---------------------------------------------------
        if (upliftKg) {
            const opening = balanceQty;
            const closing = kg(opening + upliftKg);
            balanceValue = money((balanceValue || 0) + (upliftValue || 0));
            balanceQty = closing;
            map = closing > 0 ? rate(balanceValue / closing) : map;
            const t = tickets[0];
            generatedLedger.push({
                ID: uuid5('ROB_LEDGER:UPLIFT:' + f.ID),
                aircraft_type_code: f.aircraft_type || '', tail_number: tail, tail_registration: tail,
                record_date: f.flight_date, record_time: (t && t.delivery_timestamp ? String(t.delivery_timestamp).slice(11, 19) : '00:00:00'),
                sequence: nextSequence(f.flight_date), line_order: LINE_ORDER.UPLIFT, entry_type: 'UPLIFT',
                flight_ID: f.ID, sector,
                fuel_ticket_ID: t ? t.ID : '', fuel_order_ID: t ? (t.order_ID || '') : '',
                fuel_delivery_ID: t ? (t.delivery_ID || '') : '',
                opening_rob_kg: opening, uplift_kg: upliftKg, burn_kg: 0, adjustment_kg: 0,
                closing_rob_kg: closing, qty_kg: upliftKg,
                volume_l: tickets.reduce((a, x) => a + (x.uom_code === 'LTR' ? (num(x.quantity_metered) ?? num(x.quantity) ?? 0) : 0), 0) || '',
                rate_usd_per_kg: upliftKg ? rate(upliftValue / upliftKg) : '',
                value_usd: upliftValue, balance_value_usd: balanceValue, map_usd_per_kg: map,
                max_capacity_kg: capacity ?? '', rob_percentage: pct(closing),
                data_source: 'EPOD', is_estimated: 'false',
                created_at: STAMP, created_by: BY, modified_at: STAMP, modified_by: BY
            });
        }

        // --- the burn -------------------------------------------------------
        const burnKg = kg((out || 0) - (inn || 0));
        if (burnKg > 0) {
            const opening = balanceQty;
            const closing = kg(opening - burnKg);
            // Consumed at the prevailing price, which is therefore unchanged -
            // only an uplift moves the moving average.
            const value = money(burnKg * (map || 0));
            balanceValue = money((balanceValue || 0) - value);
            balanceQty = closing;
            generatedLedger.push({
                ID: uuid5('ROB_LEDGER:FLIGHT:' + f.ID),
                aircraft_type_code: f.aircraft_type || '', tail_number: tail, tail_registration: tail,
                record_date: f.flight_date, record_time: f.scheduled_departure || '00:00:00',
                sequence: nextSequence(f.flight_date), line_order: LINE_ORDER.FLIGHT, entry_type: 'FLIGHT',
                flight_ID: f.ID, sector,
                fuel_burn_ID: uuid5('FUEL_BURNS:' + f.ID),
                opening_rob_kg: opening, uplift_kg: 0, burn_kg: burnKg, adjustment_kg: 0,
                closing_rob_kg: closing, qty_kg: -burnKg,
                rate_usd_per_kg: map || '', value_usd: value === null ? '' : -value,
                balance_value_usd: balanceValue, map_usd_per_kg: map || '',
                max_capacity_kg: capacity ?? '', rob_percentage: pct(closing),
                data_source: 'ACARS', is_estimated: 'true',
                created_at: STAMP, created_by: BY, modified_at: STAMP, modified_by: BY
            });
        }
    }
}

// ===========================================================================
// 3. WRITE, KEEPING WHAT WAS ALREADY THERE
// ===========================================================================
const burnHeader = [...new Set([...burnsCsv.header, ...Object.keys(generatedBurns[0] || {})])];
const ledgerHeader = [...new Set([...ledgerCsv.header, ...Object.keys(generatedLedger[0] || {})])];

// Rows this script wrote before are replaced, not duplicated.
const mineBurn = new Set(generatedBurns.map(r => r.ID));
const mineLedger = new Set(generatedLedger.map(r => r.ID));
const keptBurns = burnsCsv.rows.filter(r => !mineBurn.has(r.ID));
const keptLedger = ledgerCsv.rows.filter(r => !mineLedger.has(r.ID));

writeCsv(burnsCsv, burnHeader, [...keptBurns, ...generatedBurns]);
writeCsv(ledgerCsv, ledgerHeader, [...keptLedger, ...generatedLedger]);

console.log(`FUEL_BURNS  kept ${keptBurns.length}, generated ${generatedBurns.length}, total ${keptBurns.length + generatedBurns.length}`);
console.log(`ROB_LEDGER  kept ${keptLedger.length}, generated ${generatedLedger.length}, total ${keptLedger.length + generatedLedger.length}`);
console.log(`tails with a ledger: ${byTail.size}`);

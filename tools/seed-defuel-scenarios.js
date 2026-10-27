#!/usr/bin/env node
/**
 * FuelSphere - seed the defuel demo scenarios (11, 12, 13) by POSTING them.
 *
 * THROUGH THE SERVICE, NOT AS CSV ROWS. A defuel writes a DEFUEL document, a
 * DEFUEL row on the tail's ROB_LEDGER, a recalculated ROB chain and a replayed
 * stock valuation. A hand-written seed would be a claim about what the
 * service would do; this boots the model in memory, records each defuel the
 * way the Defueling app does (a draft, then activate) and exports what the
 * service wrote.
 *
 * WHAT IS EXPORTED, and from where:
 *
 *   DEFUEL       the documents, as the service stored them
 *   ROB_LEDGER   every row of the tails a defuel touched, updated in place by
 *                ID, and the new DEFUEL rows appended
 *   FUEL_STOCK_* and FUEL_BURN_HEADER are NOT exported from here. They are
 *                regenerated afterwards by tools/seed-fifo-valuation.js from
 *                the exported ledger, and this tool checks that the service's
 *                own restatement agrees with that replay, tail by tail.
 *
 * THE SPECS are tools/scenario-seed/defuel-scenarios.json, taken from the two
 * scenario workbooks' PROPOSED_DEFUEL_TICKETS sheets. Scenario 12 is JetBlue
 * only: expected credits are USD-only in the credit memo R1 (its gap 1).
 *
 * EVERY DEFUEL IS PRE-DEPARTURE: timed 30 seconds after the uplift it draws
 * on, before that flight's burn, on the uplift's own ledger date. That is the
 * case the ledger posting exists for (fuel tankered for the next leg, then a
 * late load takes the aircraft over MTOW), and every scenario reason fits it.
 *
 * Run:  node tools/seed-defuel-scenarios.js [--write]
 * Without --write it posts in memory, reports, and changes nothing.
 */
process.env.CDS_ENV = 'development';

const fs = require('fs');
const path = require('path');
const PROJECT = path.resolve(__dirname, '..');
const cds = require(path.join(PROJECT, 'node_modules', '@sap', 'cds'));
const WRITE = process.argv.includes('--write');
const DATA = path.join(PROJECT, 'db', 'data');
const SPECS = require('./scenario-seed/defuel-scenarios.json');

const LITRES_PER = { LTR: 1, USG: 3.785411784, GAL: 3.785411784 };
const AUDIT = ['created_at', 'created_by', 'modified_at', 'modified_by'];

// ---- csv ------------------------------------------------------------------
const field = (v) => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString();
    const s = String(v);
    return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
function splitRow(line) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) {
            if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
            else if (ch === '"') q = false;
            else cur += ch;
        } else if (ch === '"') q = true;
        else if (ch === ';') { out.push(cur); cur = ''; }
        else cur += ch;
    }
    out.push(cur);
    return out;
}
/** Rows replaced in place by ID, new ones appended; columns, order and line endings kept. */
function upsertCsv(entity, rows) {
    const file = path.join(DATA, `fuelsphere-${entity}.csv`);
    const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const lines = raw.split(/\r?\n/).filter((l) => l.trim());
    const cols = lines[0].split(';');
    // A COLUMN THE ROWS CARRY AND THE FILE LACKS IS ADDED, or it is silently
    // dropped: ROB_LEDGER's seed predates defuel_ID, so the DEFUEL rows landed
    // without the link to their document and the replay never saw them.
    // ONLY A STORED COLUMN: a calculated element (the carrier-unit figures)
    // or a virtual one is read back from the database and has no column.
    const el = cds.db.model.definitions[`fuelsphere.${entity}`].elements;
    // AND NOT THE RECALCULATION'S OWN STAMP: recalculated_at is "now" on
    // every run, which is noise in a seed and would rewrite every line.
    const stamp = new Set(['recalculated_by', 'recalculated_at', 'recalc_flagged']);
    const stored = (k) => el[k] && !el[k].isAssociation && !el[k].virtual && !el[k].value && !stamp.has(k);
    const added = [...new Set(rows.flatMap((r) => Object.keys(r)
        .filter((k) => !cols.includes(k) && stored(k) && r[k] !== null && r[k] !== undefined)))];
    cols.push(...added);
    lines[0] = cols.join(';');
    const byId = new Map(rows.map((r) => [r.ID, r]));
    const out = [lines[0]];
    let replaced = 0;
    for (const line of lines.slice(1)) {
        const f = splitRow(line);
        const r = byId.get(f[cols.indexOf('ID')]);
        if (r) { out.push(cols.map((c) => field(r[c])).join(';')); byId.delete(r.ID); replaced++; }
        else out.push(added.length ? line + ';'.repeat(added.length) : line);
    }
    for (const r of byId.values()) out.push(cols.map((c) => field(r[c])).join(';'));
    fs.writeFileSync(file, out.join(eol) + eol, 'utf8');
    console.log(`  ${entity}: ${replaced} row(s) updated, ${byId.size} added`
              + (added.length ? `; column(s) added: ${added.join(', ')}` : ''));
}
function writeCsv(entity, cols, rows) {
    const file = path.join(DATA, `fuelsphere-${entity}.csv`);
    const out = [cols.join(';'), ...rows.map((r) => cols.map((c) => field(r[c])).join(';'))];
    fs.writeFileSync(file, out.join('\r\n') + '\r\n', 'utf8');
    console.log(`  ${entity}: ${rows.length} row(s) written`);
}

const plus30s = (t) => {
    const [h, m, s] = String(t).split(':').map(Number);
    const x = Math.min(h * 3600 + m * 60 + s + 30, 86399);
    return [Math.floor(x / 3600), Math.floor((x % 3600) / 60), x % 60].map((v) => String(v).padStart(2, '0')).join(':');
};

(async () => {
    cds.env.requires.db = { kind: 'sqlite', credentials: { url: ':memory:' } };
    const model = await cds.load('*');
    await cds.deploy(model).to('sqlite::memory:');
    const srv = await cds.serve('DefuelService').from(model);
    const { SELECT } = cds.ql;
    const db = cds.db;
    // A NAMED SEED USER, so created_by says where the rows came from.
    const user = Object.assign(new cds.User.Privileged(), { id: 'SEED_DEFUEL_SCENARIOS' });
    const { Defuels } = srv.entities;
    const LEDGER = 'fuelsphere.ROB_LEDGER';
    const stockLib = require(path.join(PROJECT, 'srv', 'lib', 'stock-replay'));

    const robBefore = new Map((await db.run(SELECT.from(LEDGER))).map((r) => [r.ID, r]));
    const tails = new Set();
    const posted = [];
    let failed = 0;

    // ---- ONE TAIL'S HEADROOM, SHARED -------------------------------------
    //
    // Two defuels on one tail (N804JB carries 11B and 12B) both lower the same
    // later balances. Capping them one at a time gives the whole headroom to
    // the first and leaves the second nothing, so where a tail's proposals do
    // not fit together they are scaled down together, to leave the 500 kg
    // reserve at the tail's lowest point after the first of them.
    const scale = new Map();
    for (const tail of new Set(SPECS.map((s) => s.tail))) {
        const mine = SPECS.filter((s) => s.tail === tail);
        if (mine.length < 2) continue;
        const ups = await db.run(SELECT.from(LEDGER).where({ fuel_ticket_ID: { in: mine.map((s) => s.uplift_ticket_ID) } }));
        const first = ups.sort((a, b) => String(a.record_date).localeCompare(String(b.record_date)) || a.sequence - b.sequence)[0];
        const rows = await db.run(SELECT.from(LEDGER).where({ tail_number: tail }));
        const low = Math.min(...rows.filter((r) => String(r.record_date) > String(first.record_date)
            || (String(r.record_date) === String(first.record_date) && Number(r.sequence) > Number(first.sequence)))
            .map((r) => Number(r.closing_rob_kg)));
        const sg = Number(first.wt_avg_specific_gravity) || Number(first.specific_gravity) || 0.8;
        const want = mine.reduce((t, s) => t + s.litres * sg, 0);
        if (want > low - 500) scale.set(tail, (low - 500) / want);
    }

    for (const s of SPECS) {
        const label = `S${s.scenario}${s.ref} ${s.carrier} ${s.defuel_ticket}`;
        const up = await db.run(SELECT.one.from(LEDGER).where({ fuel_ticket_ID: s.uplift_ticket_ID }));
        if (!up) { console.log(`  SKIP ${label}: no uplift row for ${s.uplift_ticket}`); failed++; continue; }
        const ticket = await db.run(SELECT.one.from('fuelsphere.FUEL_TICKETS')
            .columns('order_ID', 'flight_ID').where({ ID: s.uplift_ticket_ID }));
        const order = ticket && ticket.order_ID && await db.run(SELECT.one.from('fuelsphere.FUEL_ORDERS')
            .columns('supplier_ID').where({ ID: ticket.order_ID }));
        const carrier = await db.run(SELECT.one.from('fuelsphere.CARRIER_MASTER')
            .columns('reporting_volume_uom').where({ carrier_code: s.carrier }));
        const uom = (carrier && carrier.reporting_volume_uom) || 'LTR';
        const station = up.airport_code;

        // ---- AS MUCH AS THE TAIL CAN SPARE -------------------------------
        //
        // A pre-departure defuel lowers every later balance on the tail, and
        // the service refuses one that would take any of them below zero
        // (DFL432). The proposed litres were written before the ledger
        // posting existed; where a later balance cannot carry them, the
        // defuel is cut to leave a 500 kg reserve at the tail's lowest point,
        // and the note says so.
        const tailRows = await db.run(SELECT.from(LEDGER).where({ tail_number: s.tail }));
        const laterRows = tailRows.filter((r) => String(r.record_date) > String(up.record_date)
            || (String(r.record_date) === String(up.record_date) && Number(r.sequence) > Number(up.sequence)));
        const low = Math.min(...laterRows.map((r) => Number(r.closing_rob_kg)));
        const sg = Number(up.wt_avg_specific_gravity) || Number(up.specific_gravity) || 0.8;
        let litres = scale.has(s.tail) ? Math.floor(s.litres * scale.get(s.tail) / 10) * 10 : s.litres;
        let cut = litres < s.litres
            ? ` Reduced from ${s.litres} L to ${litres} L: this tail's defuels share what it can spare.` : '';
        if (Number.isFinite(low) && low - litres * sg < 500) {
            litres = Math.floor(((low - 500) / sg) / 10) * 10;
            cut = ` Reduced from ${s.litres} L to ${litres} L: the tail later falls to ${low} kg.`;
        }
        if (!(litres > 0)) { console.log(`  SKIP ${label}: the tail cannot spare any fuel`); failed++; continue; }
        const data = {
            // DETERMINISTIC, so a re-run on the same base writes the same seed.
            ID: stockLib.uuid5(`DEFUEL:${s.defuel_ticket}`),
            defuel_type: s.type,
            source_mode: up.flight_ID ? 'WITH_FLIGHT' : 'WITHOUT_FLIGHT',
            flight_ID: up.flight_ID || null,
            tail_registration: s.tail,
            station_code: station,
            location_code: `${station}-${s.type === 'TO_STORAGE' ? 'TEMP' : 'DEFUEL'}`,
            defuel_date: up.record_date,
            defuel_time: plus30s(up.record_time || '00:00:00'),
            // IN THE CARRIER'S VOLUME UNIT, which is what the screen takes:
            // US gallons for JetBlue, litres for TAP.
            quantity_vol: Number((litres / (LITRES_PER[uom] || 1)).toFixed(2)),
            ticket_number: s.defuel_ticket,
            supplier_ID: s.type === 'TO_SUPPLIER' && order ? order.supplier_ID : null,
            defuel_charges_usd: s.charge_rate_per_litre ? Number((litres * s.charge_rate_per_litre).toFixed(2)) : 0,
            notes: `SCENARIO ${s.scenario}${s.ref} - ${s.story} Pre-departure: after uplift ${s.uplift_ticket}, before the flight's burn.${cut}`
        };
        try {
            const draft = await srv.tx({ user }, (tx) => tx.new(Defuels.drafts, data));
            const d = await srv.tx({ user }, (tx) => tx.save(Defuels.drafts, { ID: draft.ID }));
            let doc = d;
            if (s.scenario === 12) {
                // THE CREDIT THE VENDOR AGREED: the litres credited over the
                // litres defuelled, of what the fuel was worth. 12C credits
                // 300 L less - contaminated, disposed, written off.
                const credit = Number((Number(d.fuel_value_usd) * s.credited_litres / s.litres).toFixed(2));   // the scenario's share, on the litres actually defuelled
                doc = await srv.tx({ user }, (tx) => tx.send({
                    event: 'postToSupplier', entity: 'Defuels',
                    params: [{ ID: d.ID, IsActiveEntity: true }], data: { expected_credit_usd: credit }
                }));
            }
            tails.add(s.tail);
            posted.push({ label, doc });
            console.log(`  ${label}: ${doc.defuel_id} ${doc.quantity_l} L / ${doc.quantity_kg} kg at ${data.defuel_date} ${data.defuel_time}, `
                      + `${doc.status}, value ${doc.fuel_value_usd}` + (doc.expected_credit_usd != null ? `, credit ${doc.expected_credit_usd}` : ''));
        } catch (e) {
            failed++;
            console.log(`  FAIL ${label}: ${e.message}`);
        }
    }
    console.log(`\n${posted.length} posted, ${failed} failed`);

    // ---- CHECK 1: nothing BEFORE a defuel moved -------------------------
    //
    // The recalculation rewrites a tail's whole chain. Rows before the first
    // defuel must come out exactly as seeded, or the seed and the recalculation
    // disagree about history the defuel never touched.
    const robAfter = await db.run(SELECT.from(LEDGER).where({ tail_number: { in: [...tails] } }));
    const firstDefuel = new Map();
    for (const r of robAfter) {
        if (r.entry_type !== 'DEFUEL') continue;
        const k = `${r.record_date}|${String(r.sequence).padStart(4, '0')}`;
        if (!firstDefuel.has(r.tail_number) || k < firstDefuel.get(r.tail_number)) firstDefuel.set(r.tail_number, k);
    }
    const watch = ['closing_rob_kg', 'balance_value_usd', 'map_usd_per_kg', 'qty_kg'];
    let movedBefore = 0;
    for (const r of robAfter) {
        const b = robBefore.get(r.ID);
        if (!b) continue;
        const k = `${r.record_date}|${String(b.sequence).padStart(4, '0')}`;
        if (k >= firstDefuel.get(r.tail_number)) continue;
        if (watch.some((c) => Math.abs((Number(b[c]) || 0) - (Number(r[c]) || 0)) > 0.005)) movedBefore++;
    }
    console.log(`check 1: ${movedBefore} ledger row(s) before a defuel changed under recalculation`);

    // ---- CHECK 2: the service's restatement equals the tool's replay ----
    const stock = require(path.join(PROJECT, 'srv', 'lib', 'stock-replay'));
    const defuels = await db.run(SELECT.from('fuelsphere.DEFUEL'));
    const tickets = await db.run(SELECT.from('fuelsphere.FUEL_TICKETS').columns('ID', 'ticket_number', 'internal_number'));
    const flights = await db.run(SELECT.from('fuelsphere.FLIGHT_SCHEDULE').columns('ID', 'flight_number'));
    let mismatched = 0;
    for (const tail of tails) {
        const held = await db.run(SELECT.from('fuelsphere.FUEL_STOCK_MOVEMENT_LEDGER').where({ tail_number: tail }));
        const ctx = stock.makeContext({
            flightById: new Map(flights.map((f) => [f.ID, f])),
            ticketNumberById: new Map(tickets.map((t) => [t.ID, t.ticket_number || t.internal_number])),
            carrierOf: () => (held.find((m) => m.carrier_code) || {}).carrier_code || null,
            defuelById: new Map(defuels.map((x) => [x.ID, x])), stamp: 'x', by: 'x'
        });
        const rows = robAfter.filter((r) => r.tail_number === tail);
        const want = stock.replayTail(tail, stock.movementsOf(tail, rows, ctx), ctx).movements
            .filter((m) => m.tail_number === tail);   // the tank-side halves carry no tail
        const key = (m) => [m.ID, m.batch_ref, Number(m.qty_kg).toFixed(3), Number(m.value_usd || 0).toFixed(2)].join('|');
        const a = new Set(held.map(key)), b = new Set(want.map(key));
        if (a.size !== b.size || [...a].some((k) => !b.has(k))) { mismatched++; console.log(`  ${tail}: service and replay differ`); }
    }
    console.log(`check 2: ${tails.size - mismatched} of ${tails.size} tail(s) - the service's stock rows equal the replay's`);

    if (!WRITE) { console.log('\nDRY RUN - nothing written. Re-run with --write.'); return process.exit(failed ? 1 : 0); }
    if (failed || movedBefore || mismatched) { console.log('\nNOT WRITTEN: fix the above first.'); return process.exit(1); }

    console.log('');
    const docCols = Object.keys(defuels[0]).filter((c) => !c.startsWith('DraftAdministrativeData'));
    writeCsv('DEFUEL', docCols, defuels);
    upsertCsv('ROB_LEDGER', robAfter);
    console.log('\nNow regenerate the valuation:  node tools/seed-fifo-valuation.js --write');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

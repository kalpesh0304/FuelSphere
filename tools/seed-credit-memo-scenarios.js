#!/usr/bin/env node
/**
 * FuelSphere - seed scenario 12's credit notes (JetBlue) THROUGH CreditMemoService.
 *
 * Scenario 12 returns fuel to the supplier. tools/seed-defuel-scenarios.js
 * posts each defuel to the supplier, which agrees the expected credit
 * (status POSTING_PENDING). The supplier's credit note is the other half:
 * one memo per defuel, an EXPECTED_CREDIT line for the agreed amount.
 *
 * SEEDED AS DRAFT. The credit note has arrived and been keyed; posting it is
 * the demo step - Post clears the expected credit, and the Expected Credits
 * list empties. Each memo is simulated here and must be postable, so the demo
 * step cannot fail on the seed.
 *
 * WHAT IS EXPORTED: CREDIT_MEMOS, CREDIT_MEMO_LINES and NUMBER_RANGES, as the
 * service wrote them (document numbers come from the shared allocator).
 * Anything else the service wrote is reported, so a new side effect is seen.
 *
 * Run after tools/seed-defuel-scenarios.js --write:
 *   node tools/seed-credit-memo-scenarios.js [--write]
 * Without --write it creates the memos in memory, reports, and changes nothing.
 */
process.env.CDS_ENV = 'development';

const fs = require('fs');
const path = require('path');
const PROJECT = path.resolve(__dirname, '..');
const cds = require(path.join(PROJECT, 'node_modules', '@sap', 'cds'));
const WRITE = process.argv.includes('--write');
const DATA = path.join(PROJECT, 'db', 'data');
// The credit note is numbered after its defuel, as the scenario workbook does:
// DF-CGA-SFO-26092512A -> CN-CGA-SFO-260925A (the date, without the scenario number).
const SPECS = require('./scenario-seed/defuel-scenarios.json').filter((s) => s.scenario === 12)
    .map((s) => ({ ...s, credit_note: s.defuel_ticket.replace(/^DF-(.+)-(\d{6})12([A-Z])$/, 'CN-$1-$2$3') }));
const { uuid5 } = require(path.join(PROJECT, 'srv', 'lib', 'stock-replay'));

const field = (v) => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString();
    const s = String(v);
    return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const keyOf = (line) => line.split(';')[0].replace(/^"|"$/g, '');

/** Rows replaced by their first (key) column, new ones appended; columns and line endings kept. */
function upsertCsv(entity, rows) {
    const file = path.join(DATA, `fuelsphere-${entity}.csv`);
    const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const lines = raw.split(/\r?\n/).filter((l) => l.trim());
    const cols = lines[0].split(';');
    const missing = [...new Set(rows.flatMap((r) => Object.keys(r)))]
        .filter((k) => !cols.includes(k) && rows.some((r) => r[k] !== null && r[k] !== undefined && r[k] !== ''));
    if (missing.length) throw new Error(`${entity}: the rows carry ${missing.join(', ')}, which the seed file has no column for`);
    const byKey = new Map(rows.map((r) => [String(r[cols[0]]), r]));
    const out = [lines[0]];
    let replaced = 0;
    for (const line of lines.slice(1)) {
        const r = byKey.get(keyOf(line));
        if (r) { out.push(cols.map((c) => field(r[c])).join(';')); byKey.delete(String(r[cols[0]])); replaced++; }
        else out.push(line);
    }
    for (const r of byKey.values()) out.push(cols.map((c) => field(r[c])).join(';'));
    fs.writeFileSync(file, out.join(eol) + eol, 'utf8');
    console.log(`  ${entity}: ${replaced} row(s) updated, ${byKey.size} added`);
}

// CN-CGA-SFO-260925A -> 2026-09-25: the credit note is dated as its number says.
const cnDate = (cn) => { const m = /-(\d{2})(\d{2})(\d{2})[A-Z]?$/.exec(cn); return `20${m[1]}-${m[2]}-${m[3]}`; };

(async () => {
    cds.env.requires.db = { kind: 'sqlite', credentials: { url: ':memory:' } };
    const model = await cds.load('*');
    await cds.deploy(model).to('sqlite::memory:');
    const srv = await cds.serve('CreditMemoService').from(model);
    const { SELECT } = cds.ql;
    const db = cds.db;
    const user = Object.assign(new cds.User.Privileged(), { id: 'SEED_CREDIT_MEMO_SCENARIOS' });
    const { CreditMemos } = srv.entities;

    const watched = Object.keys(model.definitions).filter((n) => n.startsWith('fuelsphere.')
        && model.definitions[n].kind === 'entity' && !model.definitions[n].query);
    const count = async () => Object.fromEntries(await Promise.all(watched.map(async (n) =>
        [n, (await db.run(SELECT.one.from(n).columns('count(1) as n'))).n])));
    const before = await count();

    const memos = [];
    let failed = 0;
    for (const s of SPECS) {
        const d = await db.run(SELECT.one.from('fuelsphere.DEFUEL').where({ ticket_number: s.defuel_ticket }));
        if (!d) { console.log(`  SKIP 12${s.ref}: defuel ${s.defuel_ticket} is not seeded`); failed++; continue; }
        if (d.status !== 'POSTING_PENDING') { console.log(`  SKIP 12${s.ref}: ${s.defuel_ticket} is ${d.status}`); failed++; continue; }
        const credit = Number(d.expected_credit_usd);
        const id = uuid5(`CREDIT_MEMO:${s.credit_note}`);
        const date = cnDate(s.credit_note);
        const written = Number(d.write_off_usd) > 0
            ? ` ${Number(d.write_off_usd).toFixed(2)} of fuel worth ${Number(d.fuel_value_usd).toFixed(2)} was disposed of and written off at the defuel, so it is not on the note.` : '';
        try {
            await srv.tx({ user }, (tx) => tx.run(INSERT.into(CreditMemos).entries({
                ID: id, memo_type: 'CREDIT_MEMO', supplier_ID: d.supplier_ID, supplier_cm_number: s.credit_note,
                document_date: date, posting_date: date, company_code: 'B600', station_code: d.station_code,
                currency_code: 'USD', stated_gross_amount: credit, tax_amount: 0, reason_code: 'DEFUEL_RETURN',
                reason_text: `SCENARIO 12${s.ref} - ${d.supplier_name} credit note for defuel ${s.defuel_ticket} `
                    + `(${Number(d.quantity_l).toFixed(0)} L off ${d.tail_number}).${written}`,
                lines: [{ ID: uuid5(`CREDIT_MEMO_LINE:${s.credit_note}:10`), line_number: 10,
                    reference_type: 'EXPECTED_CREDIT', defuel_ID: d.ID, amount: credit,
                    text: `Fuel returned on ${s.defuel_ticket}` }]
            })));
            const sim = await srv.tx({ user }, (tx) => tx.send({ event: 'simulate', entity: 'CreditMemoService.CreditMemos', params: [{ ID: id }] }));
            const errors = (sim.messages || []).filter((m) => m.severity === 'ERROR');
            const m = await db.run(SELECT.one.from('fuelsphere.CREDIT_MEMOS').where({ ID: id }));
            console.log(`  12${s.ref} ${m.document_number} ${s.credit_note} ${credit.toFixed(2)} USD on ${s.defuel_ticket}: `
                + `${m.status}, balance ${m.balance}, ${sim.canPost ? 'postable' : 'NOT POSTABLE'}`
                + (errors.length ? ` - ${errors.map((e) => e.code + ' ' + e.message).join('; ')}` : ''));
            if (!sim.canPost) failed++;
            memos.push(id);
        } catch (e) {
            console.log(`  FAIL 12${s.ref}: ${e.message}`); failed++;
        }
    }

    const after = await count();
    const changed = watched.filter((n) => after[n] !== before[n]).map((n) => `${n.slice(11)} +${after[n] - before[n]}`);
    console.log(`  rows written: ${changed.join(', ') || 'none'}`);
    const exported = ['CREDIT_MEMOS', 'CREDIT_MEMO_LINES', 'NUMBER_RANGES'];
    const stray = changed.filter((c) => !exported.includes(c.split(' ')[0]) && !c.startsWith('CREDIT_MEMO_LOG'));
    if (stray.length) { console.log(`  UNEXPECTED side effect, not exported: ${stray.join(', ')}`); failed++; }

    if (failed) { console.log(`\n${failed} problem(s) - nothing written.`); process.exit(1); }
    if (!WRITE) { console.log('\nDry run. Re-run with --write to export.'); process.exit(0); }

    const strip = (r) => { const o = { ...r }; for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object' && !(o[k] instanceof Date)) delete o[k]; return o; };
    upsertCsv('CREDIT_MEMOS', (await db.run(SELECT.from('fuelsphere.CREDIT_MEMOS').where({ ID: { in: memos } }))).map(strip));
    upsertCsv('CREDIT_MEMO_LINES', (await db.run(SELECT.from('fuelsphere.CREDIT_MEMO_LINES').where({ memo_ID: { in: memos } }))).map(strip));
    upsertCsv('NUMBER_RANGES', await db.run(SELECT.from('fuelsphere.NUMBER_RANGES').where({ range_key: { like: 'CM-%' } })));
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

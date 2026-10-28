/**
 * Defuel demo seed - the fifteen scenario defuels are where the ledger says.
 *
 * THE SEED IS OUTPUT, so these criteria hold it to the code that produced it
 * and to the scenarios it was written for, never to itself:
 *
 *   EXIT-1  every seeded defuel has ONE DEFUEL row on ROB_LEDGER, after the
 *           uplift it draws on and before the next movement of that day,
 *           carrying the defuel's own quantity
 *   EXIT-2  the seeded stock valuation IS the replay of the seeded ledger -
 *           an edit to either without regenerating the other fails here
 *   EXIT-3  scenario 12's credits are the scenario's: 12A and 12B credited in
 *           full, 12C for 1,768 of 2,068 L, the difference written off
 *   EXIT-4  each scenario 12 defuel has its supplier's credit note seeded as a
 *           DRAFT memo, one EXPECTED_CREDIT line for exactly the agreed credit,
 *           and CreditMemoService simulates it postable - so Post in the demo
 *           cannot fail on the seed
 *
 * Regenerate with tools/seed-defuel-scenarios.js, then
 * tools/seed-fifo-valuation.js, then tools/seed-credit-memo-scenarios.js
 * (docs/test-data/scenarios/README.md).
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const test = cds.test(PROJECT);
const out = (s) => process.stdout.write('      ' + s + '\n');
const SPECS = require(`${PROJECT}/tools/scenario-seed/defuel-scenarios.json`);
const stock = require(`${PROJECT}/srv/lib/stock-replay`);
const n = (v) => Number(v || 0) || 0;

describe('Defuel demo seed', () => {
    let db, defuels, ledger;
    before(async () => {
        db = await cds.connect.to('db');
        defuels = await db.run(SELECT.from('fuelsphere.DEFUEL'));
        ledger = await db.run(SELECT.from('fuelsphere.ROB_LEDGER'));
    });

    it('EXIT-1  every defuel sits on its tail\'s ledger between its uplift and the next movement', () => {
        assert.strictEqual(defuels.length, SPECS.length,
            `${defuels.length} defuels seeded, ${SPECS.length} specified`);
        for (const s of SPECS) {
            const d = defuels.find((x) => x.ticket_number === s.defuel_ticket);
            assert.ok(d, `${s.defuel_ticket} is not seeded`);
            const rows = ledger.filter((r) => r.defuel_ID === d.ID);
            assert.strictEqual(rows.length, 1, `${s.defuel_ticket}: ${rows.length} ledger rows, not one`);
            const r = rows[0];
            assert.strictEqual(r.entry_type, 'DEFUEL');
            assert.ok(Math.abs(n(r.adjustment_kg) + n(d.quantity_kg)) <= 0.005,
                `${s.defuel_ticket}: the ledger takes ${r.adjustment_kg} kg for a ${d.quantity_kg} kg defuel`);
            const up = ledger.find((x) => x.fuel_ticket_ID === s.uplift_ticket_ID);
            assert.ok(up && up.tail_number === r.tail_number && up.record_date === r.record_date,
                `${s.defuel_ticket}: not on the day and tail of uplift ${s.uplift_ticket}`);
            assert.strictEqual(n(r.sequence), n(up.sequence) + 1,
                `${s.defuel_ticket}: not immediately after uplift ${s.uplift_ticket}`);
            const nextRow = ledger.find((x) => x.tail_number === r.tail_number
                && x.record_date === r.record_date && n(x.sequence) === n(r.sequence) + 1);
            assert.ok(!nextRow || ['BURN', 'APU_BURN', 'UPLIFT'].includes(nextRow.entry_type),
                `${s.defuel_ticket}: followed by ${nextRow && nextRow.entry_type}`);
        }
        out(`${SPECS.length} defuels, each one ledger row, each straight after its uplift`);
    });

    it('EXIT-2  the seeded valuation is the replay of the seeded ledger', async () => {
        const tails = [...new Set(defuels.map((d) => d.tail_number))];
        const tickets = await db.run(SELECT.from('fuelsphere.FUEL_TICKETS').columns('ID', 'ticket_number', 'internal_number'));
        const flights = await db.run(SELECT.from('fuelsphere.FLIGHT_SCHEDULE').columns('ID', 'flight_number'));
        let rowsCompared = 0;
        for (const tail of tails) {
            const held = await db.run(SELECT.from('fuelsphere.FUEL_STOCK_MOVEMENT_LEDGER').where({ tail_number: tail }));
            const ctx = stock.makeContext({
                flightById: new Map(flights.map((f) => [f.ID, f])),
                ticketNumberById: new Map(tickets.map((t) => [t.ID, t.ticket_number || t.internal_number])),
                carrierOf: () => (held.find((m) => m.carrier_code) || {}).carrier_code || null,
                defuelById: new Map(defuels.map((x) => [x.ID, x])), stamp: 'x', by: 'x'
            });
            const want = stock.replayTail(tail, stock.movementsOf(tail, ledger.filter((r) => r.tail_number === tail), ctx), ctx)
                .movements.filter((m) => m.tail_number === tail);
            const key = (m) => [m.ID, m.batch_ref || '', n(m.qty_kg).toFixed(3), n(m.value_usd).toFixed(2)].join('|');
            const a = held.map(key).sort(), b = want.map(key).sort();
            assert.deepStrictEqual(a, b, `${tail}: the seeded stock rows are not the replay of its ledger`);
            assert.ok(want.some((m) => m.line_type === 'DEFUEL'),
                `${tail}: the replay produced no defuel rows - the ledger lost its link to the document`);
            rowsCompared += a.length;
        }
        out(`${tails.length} tails, ${rowsCompared} stock rows, all equal to the replay`);
    });

    it('EXIT-3  scenario 12 credits what the scenario says, and writes off the rest', () => {
        const s12 = SPECS.filter((s) => s.scenario === 12);
        assert.ok(s12.length === 3, 'instrument: scenario 12 is three JetBlue defuels');
        for (const s of s12) {
            const d = defuels.find((x) => x.ticket_number === s.defuel_ticket);
            assert.strictEqual(d.status, 'POSTING_PENDING', `${s.defuel_ticket} is ${d.status}`);
            const share = s.ref === 'C' ? 1768 / 2068 : 1;   // the scenario's own figures
            assert.ok(Math.abs(n(d.expected_credit_usd) - n(d.fuel_value_usd) * share) <= 0.01,
                `${s.defuel_ticket}: credit ${d.expected_credit_usd} on fuel worth ${d.fuel_value_usd}`);
            assert.ok(Math.abs(n(d.write_off_usd) - (n(d.fuel_value_usd) - n(d.expected_credit_usd))) <= 0.01,
                `${s.defuel_ticket}: write-off ${d.write_off_usd} is not value less credit`);
            out(`${s.defuel_ticket}: worth ${d.fuel_value_usd}, credit ${d.expected_credit_usd}, write-off ${d.write_off_usd}`);
        }
    });

    it('EXIT-4  scenario 12 credit notes are seeded as DRAFT memos that simulate postable', async () => {
        const s12 = SPECS.filter((s) => s.scenario === 12);
        for (const s of s12) {
            const d = defuels.find((x) => x.ticket_number === s.defuel_ticket);
            const lines = await db.run(SELECT.from('fuelsphere.CREDIT_MEMO_LINES').where({ defuel_ID: d.ID }));
            assert.strictEqual(lines.length, 1, `${s.defuel_ticket}: ${lines.length} credit memo lines, not one`);
            const l = lines[0];
            assert.strictEqual(l.reference_type, 'EXPECTED_CREDIT');
            assert.ok(Math.abs(n(l.amount) - n(d.expected_credit_usd)) <= 0.005,
                `${s.defuel_ticket}: the note credits ${l.amount}, the agreed credit is ${d.expected_credit_usd}`);
            const m = await db.run(SELECT.one.from('fuelsphere.CREDIT_MEMOS').where({ ID: l.memo_ID }));
            assert.strictEqual(m.status, 'DRAFT', `${m.document_number} is ${m.status}: posting it is the demo step`);
            assert.strictEqual(m.supplier_ID, d.supplier_ID, `${m.document_number} is not from the defuel's supplier`);
            assert.strictEqual(m.s4_document_number, null);
            const { data: sim } = await test.get(`/odata/v4/credit-memo/CreditMemos(${m.ID})/CreditMemoService.simulate()`);
            assert.strictEqual(sim.canPost, true, `${m.document_number}: ${JSON.stringify(sim.messages)}`);
            out(`${m.document_number} ${m.supplier_cm_number}: ${l.amount} USD, DRAFT, postable`);
        }
    });
});

/**
 * WP-03 verification harness (outside the repo — no repo file added).
 * Drives the real HTTP endpoints through cds.test.
 *
 * EXIT-1  uplift then burn  -> closing = opening + uplift - burn + adjustment
 * EXIT-2  negative closing  -> no ledger row, FB402 carrying the computed value
 * EXIT-3  event after break -> still recorded
 * EXIT-5  recalculateROB rebuilds a deliberately corrupted chain
 *
 * EXIT-4 (@assert.range unchanged) is a source assertion, checked by git diff,
 * not here.
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = process.env.WP03_DB || ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');

const test = cds.test(PROJECT);
const TAIL = 'RP-C9999';
const DATE = '2026-03-01';
const uuid = () => cds.utils.uuid();

const out = (s) => process.stdout.write(`      ${s}\n`);

async function db() { return cds.connect.to('db'); }

async function ledger(tail = TAIL) {
    return (await db()).run(
        SELECT.from('fuelsphere.ROB_LEDGER').where({ tail_number: tail })
            .orderBy('record_date asc', 'record_time asc', 'sequence asc')
    );
}

async function wipe() {
    const d = await db();
    await d.run(DELETE.from('fuelsphere.ROB_LEDGER').where({ tail_number: TAIL }));
    await d.run(DELETE.from('fuelsphere.FUEL_BURNS').where({ tail_number: TAIL }));
}

/** Seed one ledger row directly, bypassing the service. */
async function seedLedger({ seq, type, opening, uplift = 0, burn = 0, adj = 0, closing, time }) {
    await (await db()).run(INSERT.into('fuelsphere.ROB_LEDGER').entries({
        ID: uuid(), tail_number: TAIL, record_date: DATE, record_time: time,
        sequence: seq, airport_code: 'MNL', entry_type: type,
        opening_rob_kg: opening, uplift_kg: uplift, burn_kg: burn, adjustment_kg: adj,
        closing_rob_kg: closing, max_capacity_kg: 20000,
        rob_percentage: Number(((closing / 20000) * 100).toFixed(2)),
        data_source: 'MANUAL', is_estimated: false
    }));
}

/** Seed a PRELIMINARY burn and return its id. */
async function seedBurn(actualBurnKg, time = '12:00:00') {
    const id = uuid();
    await (await db()).run(INSERT.into('fuelsphere.FUEL_BURNS').entries({
        ID: id, tail_number: TAIL, burn_date: DATE, burn_time: time,
        actual_burn_kg: actualBurnKg, data_source: 'ACARS', status: 'PRELIMINARY'
    }));
    return id;
}

async function confirmBurn(id) {
    try {
        const res = await test.POST(`/odata/v4/burn/FuelBurns(ID=${id},IsActiveEntity=true)/BurnService.confirm`, {});
        return { status: res.status, body: res.data, error: null };
    } catch (e) {
        return { status: e.response?.status ?? 'ERR', body: null, error: e.response?.data?.error ?? e.message };
    }
}

async function recalc(aircraftId, fromDate) {
    try {
        const res = await test.POST('/odata/v4/burn/recalculateROB', { aircraftId, fromDate });
        return { status: res.status, body: res.data, error: null };
    } catch (e) {
        return { status: e.response?.status ?? 'ERR', body: null, error: e.response?.data?.error ?? e.message };
    }
}

describe('WP-03 — ROB formula (D3) and re-derivation (D15)', function () {

    beforeEach(wipe);

    it('EXIT-1 — uplift then burn chains to opening + uplift - burn + adjustment', async () => {
        // INITIAL 5000, then an UPLIFT of 8000 -> 13000, then a burn of 4200.
        await seedLedger({ seq: 1, type: 'INITIAL', opening: 0, closing: 5000, time: '06:00:00' });
        await seedLedger({ seq: 2, type: 'UPLIFT', opening: 5000, uplift: 8000, closing: 13000, time: '08:00:00' });

        const burnId = await seedBurn(4200);
        const res = await confirmBurn(burnId);

        const rows = await ledger();
        const flight = rows.find(r => r.entry_type === 'FLIGHT');
        out(`EXIT-1 http=${res.status} rows=${rows.length} opening=${flight?.opening_rob_kg} ` +
            `uplift=${flight?.uplift_kg} burn=${flight?.burn_kg} adj=${flight?.adjustment_kg} closing=${flight?.closing_rob_kg}`);

        assert.strictEqual(res.status, 200, 'confirm should succeed');
        assert.ok(flight, 'a FLIGHT ledger row should exist');
        // opening carries the uplift through the chain: 13000 + 0 - 4200 + 0
        assert.strictEqual(Number(flight.opening_rob_kg), 13000);
        assert.strictEqual(Number(flight.closing_rob_kg), 8800);
        assert.strictEqual(
            Number(flight.closing_rob_kg),
            Number(flight.opening_rob_kg) + Number(flight.uplift_kg)
                - Number(flight.burn_kg) + Number(flight.adjustment_kg),
            'closing must equal opening + uplift - burn + adjustment'
        );
    });

    it('EXIT-1b — the adjustment term participates in the chain', async () => {
        // The FLIGHT path always has adjustment 0, so the fourth term is only
        // exercised through an ADJUSTMENT entry rebuilt by recalculateROB.
        // 5000 -> +8000 = 13000 -> -250 adjustment = 12750 -> -4200 = 8550
        await seedLedger({ seq: 1, type: 'INITIAL', opening: 0, closing: 5000, time: '06:00:00' });
        await seedLedger({ seq: 2, type: 'UPLIFT', opening: 0, uplift: 8000, closing: 0, time: '08:00:00' });
        await seedLedger({ seq: 3, type: 'ADJUSTMENT', opening: 0, adj: -250, closing: 0, time: '09:00:00' });
        await seedLedger({ seq: 4, type: 'FLIGHT', opening: 0, burn: 4200, closing: 0, time: '10:00:00' });

        const res = await recalc(TAIL, DATE);
        const rows = await ledger();
        out(`EXIT-1b chain: ${rows.map(r => `${r.opening_rob_kg}->${r.closing_rob_kg}`).join('  ')}`);

        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(rows.map(r => Number(r.closing_rob_kg)), [5000, 13000, 12750, 8550],
            'the -250 adjustment must be applied, not ignored');
    });

    it('EXIT-2 — negative closing writes no row and raises FB402 with the computed value', async () => {
        await seedLedger({ seq: 1, type: 'INITIAL', opening: 0, closing: 3000, time: '06:00:00' });
        const before = (await ledger()).length;

        const burnId = await seedBurn(3340);           // 3000 - 3340 = -340
        const res = await confirmBurn(burnId);
        const after = await ledger();

        const msg = typeof res.error === 'object' ? res.error?.message : String(res.error);
        out(`EXIT-2 http=${res.status} rowsBefore=${before} rowsAfter=${after.length}`);
        out(`EXIT-2 message: ${msg}`);

        assert.strictEqual(after.length, before, 'no ledger row may be written');
        assert.ok(!after.some(r => r.entry_type === 'FLIGHT'), 'no FLIGHT row may exist');
        assert.ok(/FB402/.test(msg), 'error must carry FB402');
        assert.ok(/-340/.test(msg), 'error must carry the computed negative value (-340)');
        // The clamp is gone: nothing was written as 0 either.
        assert.ok(!after.some(r => Number(r.closing_rob_kg) === 0 && r.entry_type === 'FLIGHT'),
            'must not clamp to zero');
    });

    it('EXIT-3 — a later fuel event for the same tail is still recorded after the break', async () => {
        await seedLedger({ seq: 1, type: 'INITIAL', opening: 0, closing: 3000, time: '06:00:00' });

        const breaking = await seedBurn(3340, '12:00:00');
        const broke = await confirmBurn(breaking);
        assert.notStrictEqual(broke.status, 200, 'the breaking event must fail');

        // A later, smaller burn for the same tail must still be recordable.
        const later = await seedBurn(500, '15:00:00');
        const res = await confirmBurn(later);
        const rows = await ledger();
        const flight = rows.find(r => r.entry_type === 'FLIGHT');

        out(`EXIT-3 laterHttp=${res.status} rows=${rows.length} closing=${flight?.closing_rob_kg}`);
        assert.strictEqual(res.status, 200, 'a later event must still be recorded');
        assert.ok(flight, 'the later event must produce a ledger row');
        assert.strictEqual(Number(flight.closing_rob_kg), 2500, '3000 - 500');
    });

    it('EXIT-5 — recalculateROB rebuilds a deliberately corrupted chain', async () => {
        // Correct chain: 5000 -> +8000 = 13000 -> -4200 = 8800 -> -3000 = 5800
        // Corrupt the middle openings/closings as out-of-order ingest would.
        await seedLedger({ seq: 1, type: 'INITIAL', opening: 0, closing: 5000, time: '06:00:00' });
        await seedLedger({ seq: 2, type: 'UPLIFT', opening: 999, uplift: 8000, closing: 111, time: '08:00:00' });
        await seedLedger({ seq: 3, type: 'FLIGHT', opening: 222, burn: 4200, closing: 333, time: '10:00:00' });
        await seedLedger({ seq: 4, type: 'FLIGHT', opening: 444, burn: 3000, closing: 555, time: '12:00:00' });

        const res = await recalc(TAIL, DATE);
        const rows = await ledger();
        out(`EXIT-5 http=${res.status} recalculated=${res.body?.entriesRecalculated} ` +
            `corrected=${res.body?.discrepanciesFound} final=${res.body?.finalROBKg}`);
        out(`EXIT-5 chain: ${rows.map(r => `${r.opening_rob_kg}->${r.closing_rob_kg}`).join('  ')}`);

        assert.strictEqual(res.status, 200, 'recalculateROB should succeed');
        const closings = rows.map(r => Number(r.closing_rob_kg));
        assert.deepStrictEqual(closings, [5000, 13000, 8800, 5800], 'chain must be rebuilt to correct values');
        const openings = rows.map(r => Number(r.opening_rob_kg));
        assert.deepStrictEqual(openings, [0, 5000, 13000, 8800], 'openings must chain from prior closings');
        assert.strictEqual(Number(res.body.finalROBKg), 5800);
        assert.strictEqual(res.body.discrepanciesFound, 3, 'three rows were corrupted');

        // Physical events must not be rewritten.
        assert.deepStrictEqual(rows.map(r => Number(r.uplift_kg)), [0, 8000, 0, 0]);
        assert.deepStrictEqual(rows.map(r => Number(r.burn_kg)), [0, 0, 4200, 3000]);
    });

    it('EXIT-5b — recalculateROB stops at a genuinely negative chain and reports FB402', async () => {
        await seedLedger({ seq: 1, type: 'INITIAL', opening: 0, closing: 1000, time: '06:00:00' });
        await seedLedger({ seq: 2, type: 'FLIGHT', opening: 1000, burn: 1500, closing: 0, time: '08:00:00' });

        const res = await recalc(TAIL, DATE);
        const msg = typeof res.error === 'object' ? res.error?.message : String(res.error);
        out(`EXIT-5b http=${res.status} message: ${msg}`);
        assert.notStrictEqual(res.status, 200);
        assert.ok(/FB402/.test(msg));
        assert.ok(/-500/.test(msg), 'must carry the computed negative value');
    });
});

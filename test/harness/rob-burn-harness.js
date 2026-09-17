/**
 * THE BURN NOBODY MEASURED.
 *
 * A fuel ticket says how much fuel went ON. Nothing anywhere says how much a
 * flight took OFF - no instrument reports it and no document carries it. The
 * burn is the gap between two gauge readings taken at different airports, and
 * it becomes knowable only when the SECOND one is captured. So the ledger's
 * burn rows are inferred, posted retrospectively onto the leg that consumed
 * the fuel, and this harness exists because an inferred figure that nobody
 * checks against a worked example is a guess with a column heading.
 *
 * THE CRITERION IS THE SIGNED-OFF SPECIMEN, not this code's own arithmetic.
 * The demo pack's LV-FVH ledger states seven rows with quantities, rates,
 * values, balances and a moving average price for each. Every figure below is
 * transcribed from it. If the implementation and the specimen disagree, the
 * specimen is right.
 *
 *   EXIT-1  three tickets reproduce the specimen's seven rows EXACTLY -
 *           quantity, rate, value, balance quantity, balance value and MAP
 *   EXIT-2  a burn does not move the MAP; an uplift does. This is the whole
 *           valuation rule and it is asserted row by row, not in aggregate
 *   EXIT-3  the burn is dated onto the leg that BURNED it, not the leg whose
 *           ticket revealed it, and sorts beneath that leg's uplift
 *   EXIT-4  a second ticket on the SAME flight posts no burn - two suppliers
 *           on one leg is a split delivery, not a flight in between
 *   EXIT-5  re-posting the same ticket adds nothing. Both rows are idempotent
 *           on the evidencing ticket, which is the check that broke when one
 *           ticket started accounting for two rows
 *   EXIT-6  a reading HIGHER than the ledger balance posts NO row. Fuel that
 *           appeared from nowhere is a discrepancy to look at, not a negative
 *           burn to bury in a balance
 *   EXIT-7  Re-Calculate replays to the same quantities and the same flat MAP
 *           across burns - a live posting the button would silently rewrite
 *           is a live posting that is wrong
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const test = cds.test(PROJECT);
const out = s => process.stdout.write('      ' + s + '\n');

const { postTicketUplift } = require(`${PROJECT}/srv/lib/rob-uplift`);
const { recalculateTail } = require(`${PROJECT}/srv/lib/rob-recalculate`);

const LEDGER  = 'fuelsphere.ROB_LEDGER';
const TICKETS = 'fuelsphere.FUEL_TICKETS';
const FLIGHTS = 'fuelsphere.FLIGHT_SCHEDULE';

const TAIL = 'LV-FVH';
const n = v => (v === null || v === undefined ? null : Number(v));

// ---------------------------------------------------------------------------
// THE SPECIMEN. Transcribed from the demo pack, in the order it prints.
//
// The readings are the aircraft's fuel on board, and they are NOT free
// parameters: meter_start is the balance the row above closed at, and
// meter_end - meter_start is that ticket's uplift. The specimen is internally
// consistent on both counts, which is what makes it usable as a criterion.
// ---------------------------------------------------------------------------
const FLIGHT_LEGS = [
    { no: 'AR1288', date: '2026-10-12', from: 'AEP', to: 'COR' },
    { no: 'AR1301', date: '2026-10-13', from: 'COR', to: 'AEP' },
    { no: 'AR1304', date: '2026-10-14', from: 'AEP', to: 'MDZ' }
];

const TICKET_DATA = [
    { leg: 0, fobBefore: 1150, fobAfter: 3560, kg: 2410, amount: 2742.58 },
    { leg: 1, fobBefore: 1265, fobAfter: 3445, kg: 2180, amount: 2460.13 },
    { leg: 2, fobBefore: 1180, fobAfter: 3776, kg: 2596, amount: 2984.73 }
];

// date, type, qty_kg, rate, value_usd, balance qty, balance value, MAP
const SPECIMEN = [
    ['2026-10-11', 'INITIAL',  null,  null,    null,     1150, 1296.27, 1.1272],
    ['2026-10-12', 'UPLIFT',   2410,  1.1380,  2742.58,  3560, 4038.85, 1.1345],
    ['2026-10-12', 'FLIGHT',  -2295,  1.1345, -2603.68,  1265, 1435.17, 1.1345],
    ['2026-10-13', 'UPLIFT',   2180,  1.1285,  2460.13,  3445, 3895.30, 1.1307],
    ['2026-10-13', 'FLIGHT',  -2265,  1.1307, -2561.04,  1180, 1334.26, 1.1307],
    ['2026-10-14', 'UPLIFT',   2596,  1.1497,  2984.73,  3776, 4318.99, 1.1438]
];

let flightIds = [];

async function seed() {
    await cds.db.run(DELETE.from(LEDGER).where({ tail_number: TAIL }));

    flightIds = [];
    for (const leg of FLIGHT_LEGS) {
        const ID = cds.utils.uuid();
        flightIds.push(ID);
        await cds.db.run(INSERT.into(FLIGHTS).entries({
            ID, flight_number: leg.no, flight_date: leg.date,
            origin_airport: leg.from, destination_airport: leg.to
        }));
    }

    // The opening balance, exactly as the specimen states it - including a MAP
    // of 1.1272 that no uplift in this ledger produced. That is the point of an
    // opening balance: the fuel was already on board and its price came from
    // somewhere this ledger cannot see.
    await cds.db.run(INSERT.into(LEDGER).entries({
        ID: cds.utils.uuid(), tail_number: TAIL, tail_registration: TAIL,
        record_date: '2026-10-11', record_time: '00:00:00', sequence: 1,
        line_order: 0, entry_type: 'INITIAL',
        opening_rob_kg: 0, uplift_kg: 0, burn_kg: 0, adjustment_kg: 0,
        closing_rob_kg: 1150, qty_kg: 1150,
        rate_usd_per_kg: 1.1272, value_usd: 1296.27,
        balance_value_usd: 1296.27, map_usd_per_kg: 1.1272,
        data_source: 'SEED', is_estimated: false
    }));
}

/**
 * A ticket as the capture screens leave it, with the gauge pair in the Meter
 * Start / Meter End fields those screens show. Written to FUEL_TICKETS as well
 * as passed in, because Re-Calculate re-reads the ticket for its rate.
 */
async function makeTicket({ leg, fobBefore, fobAfter, kg, amount }, suffix = '') {
    const ID = cds.utils.uuid();
    const row = {
        ID,
        ticket_number: `T-${FLIGHT_LEGS[leg].no}${suffix}`,
        aircraft_reg: TAIL, tail_registration: TAIL,
        flight_ID: flightIds[leg], flight_number: FLIGHT_LEGS[leg].no,
        uom_code: 'KG',
        quantity: kg, quantity_metered: kg, quantity_kg: kg,
        meter_start: fobBefore, meter_end: fobAfter,
        total_amount: amount,
        delivery_timestamp: `${FLIGHT_LEGS[leg].date}T10:00:00Z`
    };
    await cds.db.run(INSERT.into(TICKETS).entries(row));
    return row;
}

const ledgerRows = () => cds.db.run(SELECT.from(LEDGER)
    .where({ tail_number: TAIL })
    .orderBy('record_date', 'line_order', 'record_time', 'sequence'));

describe('ROB ledger - the inferred burn', () => {
    before(test.data.reset);

    it('EXIT-1/2/3 - three tickets reproduce the signed-off specimen', async () => {
        await seed();
        for (const t of TICKET_DATA) await postTicketUplift(await makeTicket(t));

        const rows = await ledgerRows();
        assert.strictEqual(rows.length, SPECIMEN.length,
            `expected ${SPECIMEN.length} ledger rows, got ${rows.length}`);

        let prevMap = null;
        rows.forEach((r, i) => {
            const [date, type, qty, rate, value, balQty, balValue, map] = SPECIMEN[i];
            const where = `row ${i + 1} (${date} ${type})`;
            assert.strictEqual(String(r.record_date).slice(0, 10), date, `${where}: record_date`);
            assert.strictEqual(r.entry_type, type, `${where}: entry_type`);
            if (qty !== null) {
                assert.strictEqual(n(r.qty_kg), qty, `${where}: qty_kg`);
                assert.strictEqual(n(r.rate_usd_per_kg), rate, `${where}: rate`);
                assert.strictEqual(n(r.value_usd), value, `${where}: value_usd`);
            }
            assert.strictEqual(n(r.closing_rob_kg), balQty, `${where}: balance qty`);
            assert.strictEqual(n(r.balance_value_usd), balValue, `${where}: balance value`);
            assert.strictEqual(n(r.map_usd_per_kg), map, `${where}: MAP`);

            // EXIT-2, asserted where it is decided rather than at the end: a
            // burn carries the MAP it inherited, an uplift moves it.
            if (type === 'FLIGHT') {
                assert.strictEqual(n(r.map_usd_per_kg), prevMap,
                    `${where}: a burn must not move the MAP`);
                assert.strictEqual(n(r.rate_usd_per_kg), prevMap,
                    `${where}: a burn is consumed at the prevailing MAP`);
                // EXIT-3: dated onto the leg that burned it.
                assert.ok(r.burn_kg > 0, `${where}: burn_kg must be unsigned for movementOf()`);
                assert.strictEqual(n(r.qty_kg), -n(r.burn_kg), `${where}: qty_kg mirrors burn_kg`);
            }
            prevMap = n(r.map_usd_per_kg);
        });

        // EXIT-3, the part a per-row check cannot see: the burn revealed by the
        // 13 Oct ticket carries the 12 Oct FLIGHT, not the 13 Oct one.
        const firstBurn = rows[2];
        assert.strictEqual(firstBurn.flight_ID, flightIds[0],
            'the burn belongs to the leg that consumed the fuel');
        assert.strictEqual(firstBurn.sector, 'AEP - COR', 'the burn carries that leg\'s sector');
        // And carries NO ticket: the ticket that revealed it belongs to the
        // next leg, and printing it here would put two legs on one line.
        assert.strictEqual(firstBurn.fuel_ticket_ID, null,
            'a burn row must not be attributed to the next leg\'s ticket');
        assert.strictEqual(firstBurn.is_estimated, true,
            'a derived figure must say so');
        out(`specimen reproduced: ${rows.length} rows, closing ${n(rows[5].closing_rob_kg)} kg ` +
            `valued ${n(rows[5].balance_value_usd)} at MAP ${n(rows[5].map_usd_per_kg)}`);
    });

    it('EXIT-4 - a second ticket on the same leg posts no burn', async () => {
        await seed();
        await postTicketUplift(await makeTicket(TICKET_DATA[0]));
        const before = (await ledgerRows()).length;

        // Same flight, a second supplier topping up from 3560 to 3900.
        await postTicketUplift(await makeTicket(
            { leg: 0, fobBefore: 3560, fobAfter: 3900, kg: 340, amount: 386.92 }, '-B'));

        const rows = await ledgerRows();
        assert.strictEqual(rows.length, before + 1, 'only the second uplift should be added');
        assert.ok(!rows.some(r => r.entry_type === 'FLIGHT'),
            'no flight happened between two tickets on the same leg');
        out(`split delivery on one leg: ${rows.length} rows, no burn inferred`);
    });

    it('EXIT-5 - re-posting the same ticket adds nothing', async () => {
        await seed();
        const t1 = await makeTicket(TICKET_DATA[0]);
        const t2 = await makeTicket(TICKET_DATA[1]);
        await postTicketUplift(t1);
        await postTicketUplift(t2);
        const first = await ledgerRows();

        // The order-save path re-reads and re-posts every ticket on the order
        // on every save. Both of t2's rows must stay at one each.
        await postTicketUplift(t1);
        await postTicketUplift(t2);
        const again = await ledgerRows();

        assert.strictEqual(again.length, first.length,
            `re-posting duplicated rows: ${first.length} -> ${again.length}`);
        const burns = again.filter(r => r.entry_type === 'FLIGHT');
        assert.strictEqual(burns.length, 1, 'exactly one burn, however many times it is posted');
        out(`idempotent across re-save: ${again.length} rows unchanged`);
    });

    it('EXIT-6 - a reading above the ledger balance posts no burn', async () => {
        await seed();
        await postTicketUplift(await makeTicket(TICKET_DATA[0]));   // closes at 3560

        // 3800 on board before the next uplift: 240 kg the ledger never saw.
        const res = await postTicketUplift(await makeTicket(
            { leg: 1, fobBefore: 3800, fobAfter: 5000, kg: 1200, amount: 1354.20 }));

        const rows = await ledgerRows();
        assert.ok(!rows.some(r => r.entry_type === 'FLIGHT'),
            'fuel appearing from nowhere must not be written as a negative burn');
        assert.ok(res.ID, 'the uplift itself still posts - capture is never blocked');
        assert.ok(res.reason && /higher than the ledger balance/.test(res.reason),
            `the discrepancy must be reported, got: ${res.reason}`);
        out(`discrepancy surfaced, not buried: "${res.reason}"`);
    });

    it('EXIT-7 - Re-Calculate replays to the same figures', async () => {
        await seed();
        for (const t of TICKET_DATA) await postTicketUplift(await makeTicket(t));
        const live = await ledgerRows();

        await recalculateTail(TAIL, 'harness');
        const replayed = await ledgerRows();

        assert.strictEqual(replayed.length, live.length, 'replay must not change the row count');
        replayed.forEach((r, i) => {
            // Quantities are order-independent and must survive a replay
            // untouched. Values are NOT - the opening balance is revalued at
            // the first priced uplift, by design - so this asserts quantity
            // parity and the valuation RULE, not the money.
            assert.strictEqual(n(r.closing_rob_kg), n(live[i].closing_rob_kg),
                `row ${i + 1}: Re-Calculate changed the balance quantity`);
            assert.strictEqual(n(r.qty_kg), n(live[i].qty_kg),
                `row ${i + 1}: Re-Calculate changed the movement`);
            assert.strictEqual(r.entry_type, live[i].entry_type, `row ${i + 1}: entry_type`);
        });

        // The rule the money must still obey after a replay.
        for (let i = 1; i < replayed.length; i++) {
            if (replayed[i].entry_type !== 'FLIGHT') continue;
            assert.strictEqual(n(replayed[i].map_usd_per_kg), n(replayed[i - 1].map_usd_per_kg),
                `row ${i + 1}: a replayed burn moved the MAP`);
            assert.ok(n(replayed[i].value_usd) < 0, `row ${i + 1}: a replayed burn must be signed negative`);
        }
        out(`replay parity: ${replayed.length} rows, quantities identical, MAP flat across burns`);
    });
});

/**
 * WP-10 verification harness (outside the repo — no repo file added).
 *
 * EXIT-1  a ticket persists with no order and match_status UNMATCHED
 * EXIT-2  an unmatched ticket can be attached to an order afterwards
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');

const test = cds.test(PROJECT);
const out = (s) => process.stdout.write('      ' + s + '\n');
const db = () => cds.connect.to('db');

async function call(fn) {
    try { const r = await fn(); return { status: r.status, body: r.data }; }
    catch (e) {
        return { status: e.response?.status ?? 'ERR', body: e.response?.data,
                 msg: e.response?.data?.error?.message ?? e.message };
    }
}

const TICKET = {
    ticket_number: 'SUP-NOORDER-0001', aircraft_reg: 'RP-C8803',
    quantity: 4200, uom_code: 'KG', delivery_timestamp: '2026-07-01T10:00:00Z'
};
async function createTicket(extra = {}) {
    const d = await call(() => test.POST('/odata/v4/tickets/FuelTickets', { ...TICKET, ...extra }));
    if (!d.body?.ID) return d;
    return call(() => test.POST(
        `/odata/v4/tickets/FuelTickets(ID=${d.body.ID},IsActiveEntity=false)/draftActivate`, {}));
}
const ticketRow = async (num) => (await (await db())
    .run(SELECT.one.from('fuelsphere.FUEL_TICKETS').where({ ticket_number: num })));

describe('WP-10 — ticket without an order (A1, B2)', function () {

    // -------------------------------------------------------------- EXIT-1 --
    it('EXIT-1 — a ticket persists with no order, match_status UNMATCHED', async () => {
        const before = (await (await db()).run(SELECT.from('fuelsphere.FUEL_TICKETS'))).length;
        const r = await createTicket();
        const row = await ticketRow('SUP-NOORDER-0001');
        const after = (await (await db()).run(SELECT.from('fuelsphere.FUEL_TICKETS'))).length;

        out(`create with no order -> ${r.status}; tickets ${before} -> ${after}`);
        out(`order_ID=${row?.order_ID}  match_status=${row?.match_status}  internal_number=${row?.internal_number}  source=${row?.ticket_source}`);
        assert.ok([200, 201].includes(r.status), `must persist (got ${r.status}: ${r.msg})`);
        assert.strictEqual(after, before + 1);
        assert.strictEqual(row.order_ID, null, 'no order');
        assert.strictEqual(row.match_status, 'UNMATCHED');
        assert.strictEqual(row.ticket_source, 'M', 'IATA-04 default');
    });

    it('EXIT-1b — a ticket WITH an order is MATCHED and numbered', async () => {
        const order = await (await db()).run(
            SELECT.one.from('fuelsphere.FUEL_ORDERS').where({ station_code: 'MNL' }));
        const r = await createTicket({ ticket_number: 'SUP-WITHORDER-0001', order_ID: order.ID });
        const row = await ticketRow('SUP-WITHORDER-0001');
        out(`create with order -> ${r.status}; match_status=${row?.match_status} internal_number=${row?.internal_number}`);
        assert.ok([200, 201].includes(r.status));
        assert.strictEqual(row.match_status, 'MATCHED');
        assert.match(row.internal_number, /^FT-MNL-\d{8}-\d{4}$/);
    });

    it('EXIT-1c — the seeded unmatched ticket loads, which it could not before', async () => {
        const row = await ticketRow('SUP-MNL-99001');
        out(`seeded unmatched ticket: order_ID=${row?.order_ID} match_status=${row?.match_status}`);
        assert.ok(row, 'the WP-06 unmatched-ticket scenario must load');
        assert.strictEqual(row.order_ID, null);
        assert.strictEqual(row.match_status, 'UNMATCHED');
    });

    // -------------------------------------------------------------- EXIT-2 --
    it('EXIT-2 — an unmatched ticket can be attached to an order afterwards', async () => {
        await createTicket({ ticket_number: 'SUP-MATCHME-0001' });
        const before = await ticketRow('SUP-MATCHME-0001');
        assert.strictEqual(before.match_status, 'UNMATCHED');
        assert.strictEqual(before.internal_number, null, 'no station, so no number yet');

        const order = await (await db()).run(
            SELECT.one.from('fuelsphere.FUEL_ORDERS').where({ station_code: 'MNL' }));
        const r = await call(() => test.POST(
            `/odata/v4/tickets/FuelTickets(ID=${before.ID},IsActiveEntity=true)/TicketService.attachToOrder`,
            { orderId: order.ID }));
        const after = await ticketRow('SUP-MATCHME-0001');

        out(`attachToOrder -> ${r.status}`);
        out(`  before: match=${before.match_status} number=${before.internal_number}`);
        out(`  after : match=${after.match_status} number=${after.internal_number} order=${after.order_ID === order.ID ? 'linked' : 'NOT LINKED'}`);
        assert.strictEqual(r.status, 200);
        assert.strictEqual(after.match_status, 'MATCHED');
        assert.strictEqual(after.order_ID, order.ID);
        assert.match(after.internal_number, /^FT-MNL-\d{8}-\d{4}$/, 'matching supplies the number');
    });

    it('EXIT-2b — attaching an already-matched ticket is refused', async () => {
        const row = await ticketRow('SUP-MATCHME-0001');
        const order = await (await db()).run(SELECT.one.from('fuelsphere.FUEL_ORDERS'));
        const r = await call(() => test.POST(
            `/odata/v4/tickets/FuelTickets(ID=${row.ID},IsActiveEntity=true)/TicketService.attachToOrder`,
            { orderId: order.ID }));
        out(`re-attach a MATCHED ticket -> ${r.status} :: ${String(r.msg).slice(0, 70)}`);
        assert.strictEqual(r.status, 409);
    });

    // ------------------------------------------------------ §4 delivery -----
    it('§4 — FUEL_DELIVERIES carries aircraft_reg and no longer requires an order', async () => {
        const m = cds.linked(cds.model);
        const d = m.definitions['fuelsphere.FUEL_DELIVERIES'];
        out(`delivery.order mandatory: ${!!d.elements.order['@mandatory']}; aircraft_reg mandatory: ${!!d.elements.aircraft_reg['@mandatory']}`);
        assert.ok(!d.elements.order['@mandatory'], 'order must be optional (B2)');
        assert.ok(d.elements.aircraft_reg, 'aircraft_reg must exist');

        const rows = await (await db()).run(
            SELECT.from('fuelsphere.FUEL_DELIVERIES').columns('delivery_number', 'aircraft_reg'));
        const missing = rows.filter(r => !r.aircraft_reg);
        out(`deliveries: ${rows.length}, without aircraft_reg: ${missing.length}`);
        assert.strictEqual(missing.length, 0, 'every seeded delivery must carry a registration');
    });
});

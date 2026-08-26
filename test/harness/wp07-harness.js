/**
 * WP-07 verification harness (outside the repo — no repo file added).
 *
 * EXIT-1  AIRCRAFT_REGISTRATIONS exists and holds the seeded registrations
 * EXIT-2  an order cannot be created against a PROVISIONAL registration
 * EXIT-3  a ticket CAN be captured against a PROVISIONAL registration
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');

const test = cds.test(PROJECT);
const out = (s) => process.stdout.write('      ' + s + '\n');

async function call(fn) {
    try { const r = await fn(); return { status: r.status, body: r.data }; }
    catch (e) {
        return { status: e.response?.status ?? 'ERR', body: e.response?.data,
                 msg: e.response?.data?.error?.message ?? e.message };
    }
}
const db = () => cds.connect.to('db');

/** A flight on a given tail, inserted directly so no order is auto-created. */
async function flightOn(reg, n) {
    const id = cds.utils.uuid();
    await (await db()).run(INSERT.into('fuelsphere.FLIGHT_SCHEDULE').entries({
        ID: id, flight_number: `PR70${n}`, flight_date: '2026-06-01',
        aircraft_reg: reg, origin_airport: 'MNL', destination_airport: 'CEB',
        status: 'SCHEDULED'
    }));
    return id;
}

const MANDATORY = { ordered_quantity: 5000, requested_date: '2026-06-01', unit_price: 0.85, station_code: 'MNL' };
async function createOrder(flightId) {
    const d = await call(() => test.POST('/odata/v4/orders/FuelOrders', { ...MANDATORY, flight_ID: flightId }));
    if (!d.body || !d.body.ID) return d;
    return call(() => test.POST(
        `/odata/v4/orders/FuelOrders(ID=${d.body.ID},IsActiveEntity=false)/draftActivate`, {}));
}

describe('WP-07 — aircraft register (B1, A4, D11)', function () {

    // -------------------------------------------------------------- EXIT-1 --
    it('EXIT-1 — the register holds every registration found in the data', async () => {
        const reg = await (await db()).run(SELECT.from('fuelsphere.AIRCRAFT_REGISTRATIONS'));
        const inRegister = new Set(reg.map(r => r.registration));

        // THE INVARIANT IS ON THE ASSOCIATION, NOT ON THE STRING.
        //
        // This criterion used to collect aircraft_reg / tail_number - the
        // value AS RECEIVED - and require every one to be in the register.
        // That is the OPPOSITE of what WP-07B built: ACCEPT_PROVISIONAL
        // exists so an unknown tail CAN be recorded, with the string carrying
        // it and the association null. WP-07's criterion and WP-07B's policy
        // contradicted each other and coexisted for two packages, because no
        // seed row exercised the policy until one was written.
        //
        // What must NEVER happen is a DANGLING association - tail_registration
        // pointing at a registration the register does not hold, which the
        // resolver never writes and no FK constraint prevents. That is
        // asserted. An unresolved STRING is reported, never failed: it is the
        // policy's own output.
        const referenced = new Set();     // resolved associations
        const asReceived = new Set();     // strings, resolved or not
        for (const [ent, col] of [
            ['FLIGHT_SCHEDULE', 'aircraft_reg'], ['FUEL_TICKETS', 'aircraft_reg'],
            ['FLIGHT_DISPATCH', 'tail_number'], ['FUEL_BURNS', 'tail_number'],
            ['ROB_LEDGER', 'tail_number']
        ]) {
            const rows = await (await db()).run(
                SELECT.from('fuelsphere.' + ent).columns(col, 'tail_registration'));
            rows.forEach(r => {
                if (r[col]) asReceived.add(r[col]);
                if (r.tail_registration) referenced.add(r.tail_registration);
            });
        }
        const missing = [...referenced].filter(r => !inRegister.has(r));
        const unresolved = [...asReceived].filter(r => !inRegister.has(r));
        out(`register rows: ${reg.length}; associations referenced: ${referenced.size}; dangling: ${missing.length}`);
        out(`strings as received: ${asReceived.size}; unresolved (ACCEPT_PROVISIONAL): ${unresolved.length}`
            + (unresolved.length ? ` — ${unresolved.join(', ')}` : ''));
        out(`statuses: ${reg.filter(r=>r.record_status==='CONFIRMED').length} CONFIRMED, ${reg.filter(r=>r.record_status==='PROVISIONAL').length} PROVISIONAL`);
        // Was `assert.strictEqual(reg.length, 11)`. A hardcoded row count is
        // not what this criterion is about and it fails on every legitimate
        // addition to the register — it broke the moment WP-DEMO-01 seeded
        // three more tails. The criterion is that nothing referenced is
        // absent; the bound below only stops an empty register passing.
        assert.ok(reg.length >= 11, `register shrank to ${reg.length}`);
        assert.ok(referenced.size > 0, 'instrument check: transactional data must reference some tail');
        assert.ok(asReceived.size >= referenced.size,
            'instrument check: every resolved association must also have carried a string');
        assert.deepStrictEqual(missing, [],
            'every tail_registration must exist in the register - a dangling association is a state the resolver cannot produce');
    });

    it('EXIT-1b — registration is the key, and the enum is enforced', async () => {
        const m = cds.linked(cds.model);
        const d = m.definitions['fuelsphere.AIRCRAFT_REGISTRATIONS'];
        out(`key: ${Object.keys(d.keys).join(', ')}`);
        assert.deepStrictEqual(Object.keys(d.keys), ['registration'], 'keyed on registration, not a UUID');

        const bad = await call(() => test.POST('/odata/v4/master/AircraftRegistrations',
            { registration: 'RP-C7777', record_status: 'NOT_A_STATUS' }));
        out(`record_status='NOT_A_STATUS' -> ${bad.status}`);
        assert.strictEqual(bad.status, 400, 'AircraftRecordStatus must be enforced');
    });

    // -------------------------------------------------------------- EXIT-2 --
    it('EXIT-2 — an order cannot be created against a PROVISIONAL registration', async () => {
        const before = (await (await db()).run(SELECT.from('fuelsphere.FUEL_ORDERS'))).length;
        const fid = await flightOn('RP-C8888', 1);          // PROVISIONAL
        const r = await createOrder(fid);
        const after = (await (await db()).run(SELECT.from('fuelsphere.FUEL_ORDERS'))).length;
        out(`order on PROVISIONAL RP-C8888 -> ${r.status} :: ${String(r.msg).slice(0, 120)}`);
        out(`order count ${before} -> ${after}`);
        assert.strictEqual(r.status, 409, 'must be refused');
        assert.match(String(r.msg), /MDM402/, 'must carry the assigned rule code');
        assert.strictEqual(after, before, 'no order may be written');
    });

    it('EXIT-2b — an order CAN be created against a CONFIRMED registration', async () => {
        const fid = await flightOn('RP-C8801', 2);          // CONFIRMED
        const r = await createOrder(fid);
        out(`order on CONFIRMED RP-C8801 -> ${r.status}, status ${r.body?.status}`);
        assert.ok([200, 201].includes(r.status), `a confirmed tail must not be blocked (got ${r.status})`);
        assert.strictEqual(r.body.status, 'Draft');
    });

    it('EXIT-2c — createOrderFromFlight is gated too, not just before CREATE', async () => {
        const fid = await flightOn('RP-C8805', 3);          // PROVISIONAL
        const r = await call(() => test.POST('/odata/v4/orders/createOrderFromFlight',
            { flightId: fid, orderedQuantity: 5000, unitPrice: 0.85 }));
        out(`createOrderFromFlight on PROVISIONAL -> ${r.status} :: ${String(r.msg).slice(0, 90)}`);
        assert.strictEqual(r.status, 409);
        assert.match(String(r.msg), /MDM402/);
    });

    it('EXIT-2d — the planning auto-create path is gated (flight still applies)', async () => {
        const svc = await cds.connect.to('PlanningService');
        const before = (await (await db()).run(SELECT.from('fuelsphere.FUEL_ORDERS'))).length;
        // Creating a flight through the service triggers _createDraftOrder.
        const r = await call(() => test.POST('/odata/v4/planning/FlightSchedule', {
            ID: cds.utils.uuid(), flight_number: 'PR7099', flight_date: '2026-06-02',
            aircraft_reg: 'RP-C8888', origin_airport: 'MNL', destination_airport: 'CEB',
            status: 'SCHEDULED'
        }));
        const after = (await (await db()).run(SELECT.from('fuelsphere.FUEL_ORDERS'))).length;
        out(`flight created on PROVISIONAL tail -> ${r.status}; orders ${before} -> ${after}`);
        assert.strictEqual(r.status, 201, 'the flight record must still apply (A4)');
        assert.strictEqual(after, before, 'but no order may be raised');
    });

    // -------------------------------------------------------------- EXIT-3 --
    it('EXIT-3 — a ticket CAN be captured against a PROVISIONAL registration', async () => {
        const before = (await (await db()).run(SELECT.from('fuelsphere.FUEL_TICKETS'))).length;
        // internal_number supplied so the number allocator is not the thing under test.
        // FUEL_TICKETS.order is @mandatory today (WP-10 relaxes it), so the
        // ticket hangs off an existing order. The point under test is that the
        // PROVISIONAL registration on the ticket does not block capture.
        const anyOrder = await (await db()).run(SELECT.one.from('fuelsphere.FUEL_ORDERS'));
        const d = await call(() => test.POST('/odata/v4/tickets/FuelTickets', {
            ticket_number: 'SUP-PROV-0001', internal_number: 'FT-MNL-20260601-0001',
            order_ID: anyOrder.ID, aircraft_reg: 'RP-C8803', quantity: 4200,
            uom_code: 'KG', delivery_timestamp: '2026-06-01T10:00:00Z'
        }));
        const act = d.body?.ID ? await call(() => test.POST(
            `/odata/v4/tickets/FuelTickets(ID=${d.body.ID},IsActiveEntity=false)/draftActivate`, {})) : d;
        const after = (await (await db()).run(SELECT.from('fuelsphere.FUEL_TICKETS'))).length;
        out(`ticket on PROVISIONAL RP-C8803 -> draft ${d.status}, activate ${act.status}; tickets ${before} -> ${after}`);
        assert.notStrictEqual(act.status, 409, 'ticket capture must NOT be gated');
        assert.strictEqual(after, before + 1, 'the ticket must be recorded');
    });

    it('EXIT-3b — a ROB ledger entry is likewise not gated', async () => {
        // The WP-06 broken-chain tail is PROVISIONAL; its ledger row loaded.
        const rows = await (await db()).run(
            SELECT.from('fuelsphere.ROB_LEDGER').where({ tail_number: 'RP-C8888' }));
        out(`ROB rows for PROVISIONAL RP-C8888: ${rows.length}`);
        assert.ok(rows.length > 0, 'ROB entry must not be blocked by PROVISIONAL status');
    });
});

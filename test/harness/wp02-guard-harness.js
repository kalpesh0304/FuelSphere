/**
 * WP-02 / D13 verification harness (outside the repo — no repo file added).
 *
 * EXIT-3 — an order in Draft cannot be moved to Delivered by captureSignatures.
 *
 * This runs under the project's own configured dev auth (kind 'dummy',
 * privileged user), deliberately, so authorization does not stand in front of
 * the handler and the status guard itself is what is being measured.
 *
 * That separation is necessary: under real auth, captureSignatures is refused
 * 403 before the handler runs — on main as well as on this branch — because
 * FuelDeliveries carries @restrict with no entry granting the action name.
 * That is a pre-existing condition reported in the PR, not a product of this
 * change, and it would otherwise mask the guard under test.
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');

const test = cds.test(PROJECT);
const out = (s) => process.stdout.write(`      ${s}\n`);

async function call(fn) {
    try { const r = await fn(); return { status: r.status, body: r.data }; }
    catch (e) {
        return {
            status: e.response?.status ?? 'ERR',
            msg: e.response?.data?.error?.message ?? e.message
        };
    }
}

async function seed(orderStatus) {
    const db = await cds.connect.to('db');
    const orderId = cds.utils.uuid();
    const deliveryId = cds.utils.uuid();
    const n = Math.floor(Math.random() * 9000 + 1000);
    await db.run(INSERT.into('fuelsphere.FUEL_ORDERS').entries({
        ID: orderId, order_number: `FO-MNL-20260316-${n}`, station_code: 'MNL',
        status: orderStatus, ordered_quantity: 5000, unit_price: 0.85
    }));
    await db.run(INSERT.into('fuelsphere.FUEL_DELIVERIES').entries({
        ID: deliveryId, delivery_number: `EPD-MNL-20260316-${n}`, order_ID: orderId,
        status: 'Pending', delivered_quantity: 5000
    }));
    return { orderId, deliveryId };
}

const capture = (deliveryId) => call(() => test.POST(
    `/odata/v4/orders/FuelDeliveries(ID=${deliveryId},IsActiveEntity=true)/FuelOrderService.captureSignatures`,
    { pilotName: 'A Pilot', groundCrewName: 'B Crew', pilotSignature: 'x', groundCrewSignature: 'y' }));

async function statusOf(id) {
    const db = await cds.connect.to('db');
    return (await db.run(SELECT.one.from('fuelsphere.FUEL_ORDERS').where({ ID: id })))?.status;
}

describe('WP-02 / D13 — captureSignatures status guard', function () {

    it('EXIT-3 — an order in Draft cannot be moved to Delivered', async () => {
        const { orderId, deliveryId } = await seed('Draft');
        const r = await capture(deliveryId);
        const after = await statusOf(orderId);
        out(`Draft      -> ${r.status} :: ${r.msg}`);
        out(`            order status after = ${after}`);
        assert.strictEqual(r.status, 409, 'must be refused');
        assert.strictEqual(after, 'Draft', 'the order must not have moved');
    });

    it('EXIT-3b — every other non-InProgress status is refused too', async () => {
        for (const s of ['Submitted', 'Confirmed', 'Delivered', 'Completed', 'Cancelled', 'Created']) {
            const { orderId, deliveryId } = await seed(s);
            const r = await capture(deliveryId);
            const after = await statusOf(orderId);
            out(`${s.padEnd(10)} -> ${r.status}; order status after = ${after}`);
            assert.strictEqual(r.status, 409, `${s} must be refused`);
            assert.strictEqual(after, s, `${s} must not have moved`);
        }
    });

    it('EXIT-3c — InProgress still reaches Delivered, so the guard is not too tight', async () => {
        const { orderId, deliveryId } = await seed('InProgress');
        const r = await capture(deliveryId);
        const after = await statusOf(orderId);
        out(`InProgress -> ${r.status}; order status after = ${after}`);
        assert.strictEqual(r.status, 200, 'the legitimate transition must still work');
        assert.strictEqual(after, 'Delivered');
    });

    it('EXIT-3d — a refused call writes nothing to the delivery either', async () => {
        const { deliveryId } = await seed('Draft');
        await capture(deliveryId);
        const db = await cds.connect.to('db');
        const d = await db.run(SELECT.one.from('fuelsphere.FUEL_DELIVERIES').where({ ID: deliveryId }));
        out(`delivery after refusal: status=${d.status} pilot=${d.pilot_name} gr=${d.s4_gr_number}`);
        assert.strictEqual(d.status, 'Pending', 'delivery status must be untouched');
        assert.ok(!d.pilot_name, 'no signature may be written');
        assert.ok(!d.s4_gr_number, 'no GR number may be written');
    });
});

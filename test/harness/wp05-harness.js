/**
 * WP-05 verification harness (outside the repo — no repo file added).
 *
 * EXIT-1  a quantity of 120,000 is accepted (and total_amount is computed)
 * EXIT-2  neighbouring validations still fire
 *
 * The guard sat in the before(['PATCH','UPDATE']) handler, so the exercise is a
 * PATCH on a draft. FuelOrders is @odata.draft.enabled.
 *
 * Run against main to see the guard reject 120,000, and against the branch to
 * see it accepted. Same file, no edits between runs.
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');

const test = cds.test(PROJECT);
const out = (s) => process.stdout.write(`      ${s}\n`);

/** Create a draft order and return its ID. */
async function newDraft() {
    const created = await test.POST('/odata/v4/orders/FuelOrders', {
        station_code: 'MNL', unit_price: 0.85
    });
    return created.data.ID;
}

async function patchDraft(id, data) {
    try {
        const res = await test.PATCH(`/odata/v4/orders/FuelOrders(ID=${id},IsActiveEntity=false)`, data);
        return { status: res.status, body: res.data, error: null };
    } catch (e) {
        return {
            status: e.response?.status ?? 'ERR',
            body: null,
            error: e.response?.data?.error?.message ?? e.message
        };
    }
}

describe('WP-05 — remove the hardcoded large-order guard (D16)', function () {

    it('EXIT-1 — a quantity of 120,000 is accepted and total_amount is computed', async () => {
        const id = await newDraft();
        const res = await patchDraft(id, { ordered_quantity: 120000 });
        out(`EXIT-1 http=${res.status} qty=${res.body?.ordered_quantity} total=${res.body?.total_amount} err=${res.error ?? '-'}`);

        assert.strictEqual(res.status, 200, `120,000 must be accepted (got ${res.status}: ${res.error})`);
        assert.strictEqual(Number(res.body.ordered_quantity), 120000);
        // 120000 * 0.85 — the guard used to return early and skip this.
        assert.strictEqual(Number(res.body.total_amount), 102000);
    });

    it('EXIT-1b — 100,200 kg, the trans-Pacific A350 case from the defect', async () => {
        const id = await newDraft();
        const res = await patchDraft(id, { ordered_quantity: 100200 });
        out(`EXIT-1b http=${res.status} qty=${res.body?.ordered_quantity} total=${res.body?.total_amount}`);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(Number(res.body.ordered_quantity), 100200);
    });

    it('EXIT-1c — the old boundary is no longer special', async () => {
        for (const q of [99999, 100000, 100001]) {
            const id = await newDraft();
            const res = await patchDraft(id, { ordered_quantity: q });
            out(`EXIT-1c qty=${q} http=${res.status} total=${res.body?.total_amount}`);
            assert.strictEqual(res.status, 200, `${q} must be accepted`);
        }
    });

    it('EXIT-2a — total_amount is still computed for ordinary quantities', async () => {
        const id = await newDraft();
        const res = await patchDraft(id, { ordered_quantity: 5000 });
        out(`EXIT-2a http=${res.status} total=${res.body?.total_amount}`);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(Number(res.body.total_amount), 4250); // 5000 * 0.85
    });

    it('EXIT-2b — the submit-path quantity validation still fires', async () => {
        // Guard at order-service.js:121 — must be untouched by this change.
        // Seed an active order directly so the submit action can be reached
        // without going through draft activation.
        const db = await cds.connect.to('db');
        const id = cds.utils.uuid();
        await db.run(INSERT.into('fuelsphere.FUEL_ORDERS').entries({
            ID: id, order_number: 'FO-MNL-20260316-901', station_code: 'MNL',
            status: 'Created', ordered_quantity: 0, unit_price: 0.85
        }));

        let status, msg;
        try {
            const res = await test.POST(
                `/odata/v4/orders/FuelOrders(ID=${id},IsActiveEntity=true)/FuelOrderService.submit`, {});
            status = res.status; msg = JSON.stringify(res.data);
        } catch (e) {
            status = e.response?.status ?? 'ERR';
            msg = e.response?.data?.error?.message ?? e.message;
        }
        out(`EXIT-2b submit with qty=0 -> http=${status} msg=${msg}`);
        assert.notStrictEqual(status, 200, 'submitting a zero-quantity order must still be rejected');
        assert.ok(/valid quantity/i.test(String(msg)), 'the quantity validation must still be the reason');
    });

    it('EXIT-2c — a valid order still submits, so 2b is not passing by accident', async () => {
        const db = await cds.connect.to('db');
        const id = cds.utils.uuid();
        await db.run(INSERT.into('fuelsphere.FUEL_ORDERS').entries({
            ID: id, order_number: 'FO-MNL-20260316-902', station_code: 'MNL',
            status: 'Created', ordered_quantity: 120000, unit_price: 0.85
        }));

        let status, msg;
        try {
            const res = await test.POST(
                `/odata/v4/orders/FuelOrders(ID=${id},IsActiveEntity=true)/FuelOrderService.submit`, {});
            status = res.status; msg = res.data?.status;
        } catch (e) {
            status = e.response?.status ?? 'ERR';
            msg = e.response?.data?.error?.message ?? e.message;
        }
        out(`EXIT-2c submit a 120,000 order -> http=${status} status=${msg}`);
        assert.strictEqual(status, 200, 'a 120,000 order must submit');
        assert.strictEqual(msg, 'Submitted');
    });
});

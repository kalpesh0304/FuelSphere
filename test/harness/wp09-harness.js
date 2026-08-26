/**
 * WP-09 verification harness (outside the repo — no repo file added).
 *
 * EXIT-1  FLIGHT_SCHEDULE.status rejects a value outside the enum
 * EXIT-2  creating an order writes 'Draft'; no path writes 'Created'
 * EXIT-3  an order can reach 'Completed', guarded like its siblings
 * EXIT-4  an invoice with status SUBMITTED loads and validates
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

const MANDATORY = { ordered_quantity: 5000, requested_date: '2026-05-01', unit_price: 0.85, station_code: 'MNL' };
async function newOrder(extra = {}) {
    const d = await call(() => test.POST('/odata/v4/orders/FuelOrders', { ...MANDATORY, ...extra }));
    const id = d.body.ID;
    const a = await call(() => test.POST(`/odata/v4/orders/FuelOrders(ID=${id},IsActiveEntity=false)/draftActivate`, {}));
    return { id, activated: a };
}
const act = (id, name, body = {}) => call(() => test.POST(
    `/odata/v4/orders/FuelOrders(ID=${id},IsActiveEntity=true)/FuelOrderService.${name}`, body));
const statusOf = async (id) => (await (await cds.connect.to('db'))
    .run(SELECT.one.from('fuelsphere.FUEL_ORDERS').where({ ID: id })))?.status;

describe('WP-09 — status enums', function () {

    // -------------------------------------------------------------- EXIT-1 --
    it('EXIT-1 — FLIGHT_SCHEDULE.status rejects a value outside the enum', async () => {
        const db = await cds.connect.to('db');
        const base = {
            flight_number: 'PR9001', flight_date: '2026-05-01',
            origin_airport: 'MNL', destination_airport: 'CEB'
        };
        // A member of the new enum is accepted.
        const ok = await call(() => test.POST('/odata/v4/planning/FlightSchedule',
            { ...base, ID: cds.utils.uuid(), status: 'RAMP_RETURN' }));
        out(`status='RAMP_RETURN' (new member) -> ${ok.status}`);

        // A value outside the enum is refused.
        const bad = await call(() => test.POST('/odata/v4/planning/FlightSchedule',
            { ...base, ID: cds.utils.uuid(), status: 'RETURNED' }));
        out(`status='RETURNED'    (retired)    -> ${bad.status} :: ${String(bad.msg).slice(0, 90)}`);

        assert.strictEqual(bad.status, 400, 'a value outside the enum must be refused');
        assert.notStrictEqual(ok.status, 400, 'a member of the enum must be accepted');
    });

    it('EXIT-1b — every seeded flight status is a member', async () => {
        const db = await cds.connect.to('db');
        const rows = await db.run(SELECT.from('fuelsphere.FLIGHT_SCHEDULE').columns('status'));
        const seen = [...new Set(rows.map(r => r.status).filter(Boolean))];
        const allowed = ['SCHEDULED','DEPARTED','ARRIVED','CANCELLED','DIVERTED','DELAYED','RAMP_RETURN','AIR_RETURN'];
        out(`seeded flight statuses: ${seen.join(', ')}`);
        for (const v of seen) assert.ok(allowed.includes(v), `${v} is not a member`);
    });

    // -------------------------------------------------------------- EXIT-2 --
    it("EXIT-2 — creating an order writes 'Draft'", async () => {
        const { id, activated } = await newOrder();
        const st = await statusOf(id);
        out(`create -> http ${activated.status}, status = ${st}`);
        assert.strictEqual(st, 'Draft', "creation must write 'Draft'");
    });

    it("EXIT-2b — a newly created order can be submitted (was broken by 'Created')", async () => {
        const { id } = await newOrder();
        const r = await act(id, 'submit');
        out(`submit a freshly created order -> ${r.status}, status = ${await statusOf(id)}`);
        assert.strictEqual(r.status, 200, 'submit must accept a newly created order');
        assert.strictEqual(await statusOf(id), 'Submitted');
    });

    it("EXIT-2c — no source path writes 'Created'", async () => {
        const { execSync } = require('node:child_process');
        const hits = execSync(
            `grep -rhoE "'Created'" ${PROJECT}/srv --include='*.js' --include='*.cds' | wc -l`
        ).toString().trim();
        out(`'Created' string literals in srv/: ${hits}`);
        assert.strictEqual(hits, '0');
    });

    // -------------------------------------------------------------- EXIT-3 --
    it('EXIT-3 — an order reaches Completed only from Delivered', async () => {
        const db = await cds.connect.to('db');
        // Guarded: refused from every non-Delivered status.
        for (const s of ['Draft', 'Submitted', 'Confirmed', 'InProgress', 'Completed', 'Cancelled']) {
            const { id } = await newOrder();
            await db.run(UPDATE('fuelsphere.FUEL_ORDERS').set({ status: s }).where({ ID: id }));
            const r = await act(id, 'complete');
            out(`complete from ${s.padEnd(11)} -> ${r.status}; status now ${await statusOf(id)}`);
            assert.strictEqual(r.status, 409, `${s} must be refused`);
            assert.strictEqual(await statusOf(id), s, `${s} must not have moved`);
        }
        // Permitted from Delivered.
        const { id } = await newOrder();
        await db.run(UPDATE('fuelsphere.FUEL_ORDERS').set({ status: 'Delivered' }).where({ ID: id }));
        const ok = await act(id, 'complete');
        out(`complete from Delivered   -> ${ok.status}; status now ${await statusOf(id)}`);
        assert.strictEqual(ok.status, 200, 'Delivered must be allowed to complete');
        assert.strictEqual(await statusOf(id), 'Completed');
    });

    // -------------------------------------------------------------- EXIT-4 --
    it('EXIT-4 — an invoice with status SUBMITTED loads and validates', async () => {
        const db = await cds.connect.to('db');
        const rows = await db.run(SELECT.from('fuelsphere.INVOICES').columns('invoice_number', 'status'));
        const submitted = rows.filter(r => r.status === 'SUBMITTED');
        out(`invoices loaded: ${rows.length}; with SUBMITTED: ${submitted.length}`);
        assert.ok(submitted.length > 0, 'the seeded SUBMITTED invoice must load');

        // And it round-trips through the service, i.e. the enum accepts it.
        const r = await call(() => test.GET(`/odata/v4/invoice/Invoices?$filter=status eq 'SUBMITTED'`));
        out(`OData read filtered on SUBMITTED -> ${r.status}, rows ${r.body?.value?.length ?? 'n/a'}`);
        assert.strictEqual(r.status, 200, 'the service must accept SUBMITTED as a valid enum value');
    });
});

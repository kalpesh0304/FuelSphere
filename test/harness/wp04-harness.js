/**
 * WP-04 verification harness (outside the repo — no repo file added).
 *
 * EXIT-1  100 concurrent orders at one station -> 100 distinct numbers
 * EXIT-2  a missing station code raises an error rather than producing XXX
 * EXIT-3  an update carrying a stale token is rejected
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = process.env.WP04_DB || ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');

const test = cds.test(PROJECT);
const out = (s) => process.stdout.write(`      ${s}\n`);

async function call(fn) {
    try { const r = await fn(); return { status: r.status, body: r.data, headers: r.headers }; }
    catch (e) {
        return {
            status: e.response?.status ?? 'ERR',
            body: e.response?.data,
            msg: e.response?.data?.error?.message ?? e.message
        };
    }
}

// FuelOrders is @odata.draft.enabled, so POST creates a draft and the
// number is allocated when the draft is activated (CREATE on the active
// entity). Activation is therefore the concurrency point under test.
// ordered_quantity and requested_date are @mandatory on FUEL_ORDERS and are
// validated at draft activation. They are supplied on every draft so that the
// only reason an activation can fail is the one under test.
const MANDATORY = { ordered_quantity: 5000, requested_date: '2026-03-16', unit_price: 0.85 };

async function createDraft(data) {
    const r = await call(() => test.POST('/odata/v4/orders/FuelOrders', { ...MANDATORY, ...data }));
    return r.body && r.body.ID;
}
const activate = (id) => call(() => test.POST(
    `/odata/v4/orders/FuelOrders(ID=${id},IsActiveEntity=false)/draftActivate`, {}));

async function createOrder(data) {
    const id = await createDraft(data);
    return activate(id);
}

// The generators are declared as functions, so they are GET, not POST.
const fn = (path) => call(() => test.GET(path));
const genOrderNo    = (q) => fn(`/odata/v4/orders/generateOrderNumber(${q})`);
const genDeliveryNo = (q) => fn(`/odata/v4/orders/generateDeliveryNumber(${q})`);
const genTicketNo   = (q) => fn(`/odata/v4/tickets/generateTicketNumber(${q})`);

describe('WP-04 — atomic numbering (D4, D17) and concurrency tokens (D5)', function () {

    // ------------------------------------------------------------- EXIT-1 ---

    it('EXIT-1 — 100 concurrent orders at one station produce 100 distinct numbers', async () => {
        const ids = [];
        for (let i = 0; i < 100; i++) ids.push(await createDraft({ station_code: 'MNL', unit_price: 0.85 }));
        // Activate all 100 at once — this is where numbers are allocated.
        const results = await Promise.all(ids.map(activate));

        const ok = results.filter(r => r.status === 200 || r.status === 201);
        const numbers = ok.map(r => r.body.order_number);
        const distinct = new Set(numbers);

        out(`created=${ok.length}/100  distinct numbers=${distinct.size}`);
        out(`sample: ${numbers.slice(0, 3).join('  ')} ... ${numbers.slice(-2).join('  ')}`);

        assert.strictEqual(ok.length, 100, 'all 100 creations must succeed');
        assert.strictEqual(distinct.size, 100, `expected 100 distinct numbers, got ${distinct.size}`);
        // Format retained, sequence widened to four digits.
        for (const n of numbers) {
            assert.match(n, /^FO-MNL-\d{8}-\d{4}$/, `unexpected number format: ${n}`);
        }
        // The allocated set is contiguous 0001..0100, i.e. nothing was skipped.
        const seqs = numbers.map(n => Number(n.split('-').pop())).sort((a, b) => a - b);
        assert.deepStrictEqual(seqs, Array.from({ length: 100 }, (_, i) => i + 1));
    });

    it('EXIT-1b — a second station on the same day keeps its own sequence', async () => {
        const r1 = await createOrder({ station_code: 'CEB', unit_price: 0.85 });
        const r2 = await createOrder({ station_code: 'CEB', unit_price: 0.85 });
        out(`CEB: ${r1.body.order_number}  ${r2.body.order_number}`);
        assert.match(r1.body.order_number, /^FO-CEB-\d{8}-0001$/);
        assert.match(r2.body.order_number, /^FO-CEB-\d{8}-0002$/);
    });

    it('EXIT-1c — the sequence is four digits, so a station is no longer capped at 999', async () => {
        const n = (await createOrder({ station_code: 'LHR', unit_price: 0.85 })).body.order_number;
        const seq = n.split('-').pop();
        out(`width check: ${n} -> sequence part "${seq}" (${seq.length} digits)`);
        assert.strictEqual(seq.length, 4);
    });

    // ------------------------------------------------------------- EXIT-2 ---

    it('EXIT-2 — a missing station code raises an error rather than producing XXX', async () => {
        const before = (await call(() => test.GET('/odata/v4/orders/FuelOrders?$count=true&$top=0'))).body['@odata.count'];
        const r = await createOrder({ unit_price: 0.85 });          // no station_code
        const after = (await call(() => test.GET('/odata/v4/orders/FuelOrders?$count=true&$top=0'))).body['@odata.count'];

        out(`create without station -> ${r.status} :: ${JSON.stringify(r.body?.error?.details ?? r.msg).slice(0, 220)}`);
        out(`order count ${before} -> ${after}`);
        assert.strictEqual(r.status, 400, 'must be refused');
        // station_code is @mandatory on FUEL_ORDERS, so for a null station CAP's
        // own mandatory check fires first. Either way the record is refused and
        // no XXX number is minted, which is what D17 requires. The allocator's
        // own EPD450 guard is proven below, where the value passes @mandatory.
        assert.strictEqual(after, before, 'no order may be created');
    });

    it('EXIT-2b — no XXX number exists anywhere after the attempt', async () => {
        const db = await cds.connect.to('db');
        for (const [entity, col] of [
            ['fuelsphere.FUEL_ORDERS', 'order_number'],
            ['fuelsphere.FUEL_DELIVERIES', 'delivery_number'],
            ['fuelsphere.FUEL_TICKETS', 'internal_number']
        ]) {
            const rows = await db.run(SELECT.from(entity).columns(col));
            const xxx = rows.filter(r => String(r[col] || '').includes('XXX'));
            out(`${entity}: ${rows.length} rows, ${xxx.length} containing XXX`);
            assert.strictEqual(xxx.length, 0, `${entity} must contain no XXX number`);
        }
    });

    it('EXIT-2c — the generator functions refuse a missing station too', async () => {
        for (const [name, gen] of [
            ['generateOrderNumber', genOrderNo],
            ['generateDeliveryNumber', genDeliveryNo],
            ['generateTicketNumber', genTicketNo]
        ]) {
            const r = await gen('');
            out(`${name.padEnd(24)} without station -> ${r.status} :: ${r.msg}`);
            assert.strictEqual(r.status, 400, `${name} must refuse`);
            assert.match(String(r.msg), /EPD450/);
        }
    });

    it('EXIT-2d — the shared allocator itself refuses an untraceable station', async () => {
        // Unit-level check of the single allocator every path now uses, for the
        // inputs that previously became 'XXX': null, undefined, empty, blank.
        const nr = require(`${PROJECT}/srv/lib/number-range`);
        for (const bad of [null, undefined, '', '   ']) {
            let code = null;
            try { await nr.allocateTicketNumber(bad); }
            catch (e) { code = e.code; }
            out(`allocateTicketNumber(${JSON.stringify(bad)}) -> ${code}`);
            assert.strictEqual(code, 'EPD450', `${JSON.stringify(bad)} must raise EPD450`);
        }
    });

    // ------------------------------------------------------------- EXIT-3 ---
    // NOT DELIVERED. @odata.etag on modified_at was implemented and withdrawn.
    // The measurement that justified withdrawing it lives in wp04-etag-probe.js:
    // a DateTime carrier rejects every conditional request 412, including a
    // freshly issued token, while an Integer carrier is accepted.
});

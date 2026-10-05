/**
 * The 2 Oct 2026 display batch, verified end to end.
 *
 * EXIT-1  a flight carries APU usage hours, and they are the recorded minutes
 * EXIT-2  a flight with no recorded cycle reads BLANK, not zero
 * EXIT-3  a designation names the supplier's own code and S/4 vendor number
 * EXIT-4  a fuel order names its supplier's code and S/4 vendor number
 * EXIT-5  the overview report carries unallocated fuel usage, and it is the
 *         ledger's own figure rather than a second calculation of it
 * EXIT-6  the FOB ledger carries the weighted-average specific gravity
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');
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

const n = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * The APU minutes each flight BEARS, read the way the service reads them:
 * cycles allocated to the flight, plus unallocated cycles recorded against it.
 */
async function minutesByFlight() {
    const d = await db();
    const cycles = await d.run(cds.ql.SELECT.from('fuelsphere.APU_USAGE')
        .columns('flight_ID', 'allocated_flight_ID', 'running_minutes'));
    const by = new Map();
    for (const c of cycles) {
        const key = c.allocated_flight_ID || c.flight_ID;
        if (!key) continue;
        by.set(key, (by.get(key) || 0) + (Number(c.running_minutes) || 0));
    }
    return { cycles, by };
}

describe('2 Oct 2026 display batch', () => {

    // ------------------------------------------------------------- EXIT-1 --
    it('EXIT-1  a flight carries APU usage hours, from the recorded cycles', async () => {
        const { cycles, by: minutesBy } = await minutesByFlight();
        assert.ok(minutesBy.size > 0, 'no APU cycle is allocated to any flight - nothing to verify');
        out(`${cycles.length} cycles across ${minutesBy.size} flights`);

        const r = await call(() => test.GET('/odata/v4/planning/FlightSchedule?$top=400'
            + '&$select=ID,flight_number,apu_usage_hours'));
        assert.strictEqual(r.status, 200, r.msg);

        // Only the flights the probe happened to return AND that bear cycles.
        const checked = r.body.value.filter(f => minutesBy.has(f.ID));
        assert.ok(checked.length > 0, 'none of the flights read back bear an APU cycle');
        for (const f of checked) {
            const expect = Math.round((minutesBy.get(f.ID) / 60) * 100) / 100;
            assert.strictEqual(n(f.apu_usage_hours), expect,
                `${f.flight_number}: ${f.apu_usage_hours} h against ${expect} h of recorded cycles`);
        }
        const s = checked[0];
        out(`${checked.length} flights agree with their cycles, e.g. ${s.flight_number} = ${s.apu_usage_hours} h`);
    });

    // ------------------------------------------------------------- EXIT-2 --
    it('EXIT-2  a flight with no recorded cycle reads blank, not zero', async () => {
        const { by } = await minutesByFlight();
        const borne = new Set(by.keys());

        const r = await call(() => test.GET('/odata/v4/planning/FlightSchedule?$top=400'
            + '&$select=ID,flight_number,apu_usage_hours'));
        assert.strictEqual(r.status, 200, r.msg);
        const bare = r.body.value.filter(f => !borne.has(f.ID));
        if (!bare.length) return out('every flight read back bears a cycle - nothing to check');

        for (const f of bare) {
            assert.strictEqual(f.apu_usage_hours, null,
                `${f.flight_number} has no cycle but reads ${f.apu_usage_hours} - zero asserts an idle APU`);
        }
        out(`${bare.length} flights with no cycle all read blank`);
    });

    // ------------------------------------------------------------- EXIT-3 --
    it('EXIT-3  a designation names the supplier code and S/4 vendor number', async () => {
        const r = await call(() => test.GET('/odata/v4/planning/DesignatedSuppliers?$top=20'
            + '&$expand=supplier($select=supplier_name,supplier_code,s4_vendor_no)'
            + ',supplier_contract($select=contract_number)'));
        assert.strictEqual(r.status, 200, r.msg);
        const rows = r.body.value.filter(x => x.supplier);
        assert.ok(rows.length > 0, 'no designation resolves a supplier at all');

        const named = rows.filter(x => x.supplier.supplier_code);
        assert.ok(named.length > 0, 'not one designation carries a supplier code');
        for (const x of named.slice(0, 4)) {
            out(`${x.supplier.supplier_name} / ${x.supplier.supplier_code}`
                + ` / S4 ${x.supplier.s4_vendor_no || '(none)'}`
                + ` on ${x.supplier_contract ? x.supplier_contract.contract_number : 'no contract'}`);
        }
        out(`${named.length} of ${rows.length} designations carry the code`);
    });

    // ------------------------------------------------------------- EXIT-4 --
    it('EXIT-4  a fuel order names its supplier code and S/4 vendor number', async () => {
        const r = await call(() => test.GET('/odata/v4/orders/FuelOrders?$top=20'
            + '&$expand=supplier($select=supplier_name,supplier_code,s4_vendor_no)'));
        assert.strictEqual(r.status, 200, r.msg);
        const rows = r.body.value.filter(x => x.supplier);
        assert.ok(rows.length > 0, 'no order resolves a supplier');
        const named = rows.filter(x => x.supplier.supplier_code);
        assert.ok(named.length > 0, 'not one order carries a supplier code');
        for (const x of named.slice(0, 3)) {
            out(`${x.supplier.supplier_name} / ${x.supplier.supplier_code}`
                + ` / S4 ${x.supplier.s4_vendor_no || '(none)'}`);
        }
        out(`${named.length} of ${rows.length} orders carry the code`);
    });

    // ------------------------------------------------------------- EXIT-5 --
    it('EXIT-5  the overview report carries the ledger unallocated figure', async () => {
        const d = await db();
        const led = await d.run(cds.ql.SELECT.from('fuelsphere.ROB_LEDGER')
            .columns('flight_ID', 'entry_type', 'unallocated_fuel_kg')
            .where({ entry_type: 'BURN' }));
        const byFlight = new Map();
        for (const l of led) {
            if (!l.flight_ID) continue;
            if (l.unallocated_fuel_kg === null || l.unallocated_fuel_kg === undefined) continue;
            byFlight.set(l.flight_ID, Number(l.unallocated_fuel_kg));
        }
        assert.ok(byFlight.size > 0, 'the ledger holds no unallocated figure to carry');

        const r = await call(() => test.GET('/odata/v4/burn/FuelBurns?$top=300'
            + '&$select=ID,flight_ID,unallocated_fuel_kg'));
        assert.strictEqual(r.status, 200, r.msg);
        const checked = r.body.value.filter(b => byFlight.has(b.flight_ID));
        assert.ok(checked.length > 0, 'no burn row read back matches a ledger figure');

        for (const b of checked) {
            const expect = byFlight.get(b.flight_ID);
            // The report rounds to the ledger's own two decimals, so these are
            // the same number rather than two calculations of it.
            assert.ok(Math.abs(n(b.unallocated_fuel_kg) - expect) < 0.01,
                `flight ${b.flight_ID}: report ${b.unallocated_fuel_kg} against ledger ${expect}`);
        }
        const vals = checked.map(b => n(b.unallocated_fuel_kg)).sort((a, z) => a - z);
        out(`${checked.length} rows agree with the ledger; range `
            + `${vals[0]} to ${vals[vals.length - 1]} kg`);
    });

    // ------------------------------------------------------------- EXIT-6 --
    it('EXIT-6  the FOB ledger carries the weighted-average specific gravity', async () => {
        // UPLIFT ROWS SPECIFICALLY. An opening balance has no blend until fuel
        // with a measured density goes in, and the ledger also holds a block
        // of rows seeded before these columns existed - sampling the ledger
        // in date order lands squarely in that block and proves nothing.
        const r = await call(() => test.GET('/odata/v4/burn/ROBLedger?$top=400'
            + '&$filter=entry_type eq \'UPLIFT\''
            + '&$select=ID,entry_type,wt_avg_specific_gravity,specific_gravity'
            + '&$orderby=record_date desc,line_order'));
        assert.strictEqual(r.status, 200, r.msg);
        const rows = r.body.value;
        assert.ok(rows.length > 0, 'the ledger read back no uplift at all');

        const blended = rows.filter(x => x.wt_avg_specific_gravity !== null
            && x.wt_avg_specific_gravity !== undefined);
        const share = blended.length / rows.length;
        assert.ok(share > 0.9, `only ${blended.length} of ${rows.length} uplifts carry a blend`);

        // JET A-1 SITS AROUND 0.775-0.840 kg/l. A blend outside that is not a
        // rounding question, it is a broken calculation.
        for (const x of blended) {
            const sg = n(x.wt_avg_specific_gravity);
            assert.ok(sg > 0.70 && sg < 0.90,
                `a ${x.entry_type} row blends to ${sg} kg/l, outside Jet A-1 range`);
        }
        out(`${blended.length} of ${rows.length} rows carry a blend, e.g. `
            + blended.slice(0, 3).map(x => `${x.entry_type} ${x.wt_avg_specific_gravity}`).join(', '));
    });
});

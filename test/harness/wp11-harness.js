/**
 * WP-11 verification harness (outside the repo — no repo file added).
 *
 * EXIT-1  an order created from a plan in kilograms carries the equivalent
 *         litres AND the density used
 * EXIT-2  no hardcoded 'KG' default remains on order or delivery creation
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const { execSync } = require('node:child_process');

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

async function flightOn(reg, n) {
    const id = cds.utils.uuid();
    await (await db()).run(INSERT.into('fuelsphere.FLIGHT_SCHEDULE').entries({
        ID: id, flight_number: `PR80${n}`, flight_date: '2026-08-01',
        aircraft_reg: reg, origin_airport: 'MNL', destination_airport: 'CEB',
        status: 'SCHEDULED'
    }));
    return id;
}

describe('WP-11 — litres (A2)', function () {

    // -------------------------------------------------------------- EXIT-1 --
    it('EXIT-1 — an order from a plan in kg carries litres and the density used', async () => {
        const fid = await flightOn('RP-C8801', 1);      // CONFIRMED tail
        const r = await call(() => test.POST('/odata/v4/orders/createOrderFromFlight',
            { flightId: fid, orderedQuantityKg: 9600, unitPrice: 0.85 }));

        const o = await (await db()).run(SELECT.one.from('fuelsphere.FUEL_ORDERS')
            .where({ ID: r.body?.ID ?? '' }));
        out(`createOrderFromFlight(orderedQuantityKg=9600) -> ${r.status}`);
        out(`  ordered_quantity=${o?.ordered_quantity} ${o?.uom_code}` +
            `  density=${o?.conversion_density}  source=${o?.conversion_source}` +
            `  from_kg=${o?.ordered_quantity_kg}`);

        assert.strictEqual(r.status, 200, `must succeed (${r.msg})`);
        assert.strictEqual(o.uom_code, 'LTR', 'the order is in litres');
        assert.strictEqual(Number(o.ordered_quantity), 12000, '9600 kg / 0.8 = 12000 L');
        assert.strictEqual(Number(o.conversion_density), 0.8, 'the density used is recorded');
        assert.strictEqual(o.conversion_source, 'UOM_MASTER', 'and which row produced it');
        assert.strictEqual(Number(o.ordered_quantity_kg), 9600, 'and the source mass');
    });

    it('EXIT-1b — the conversion is reproducible from the evidence alone', async () => {
        const o = await (await db()).run(SELECT.one.from('fuelsphere.FUEL_ORDERS')
            .where({ conversion_source: 'UOM_MASTER' }));
        const recomputed = Number((Number(o.ordered_quantity_kg) / Number(o.conversion_density)).toFixed(2));
        out(`stored ${o.ordered_quantity} ${o.uom_code}; recomputed ${recomputed} from kg/density`);
        assert.strictEqual(recomputed, Number(o.ordered_quantity));
    });

    it('EXIT-1c — the factor resolves from the UoM master row, not a constant', async () => {
        const { resolvePlanningDensity } = require(`${PROJECT}/srv/lib/fuel-uom`);
        const row = await (await db()).run(SELECT.one.from('fuelsphere.UNIT_OF_MEASURE')
            .where({ uom_code: 'LTR' }));
        const resolved = await resolvePlanningDensity('LTR');
        out(`UNIT_OF_MEASURE['LTR'].conversion_to_kg=${row.conversion_to_kg} -> resolved ${resolved.density} from ${resolved.source}`);
        assert.strictEqual(resolved.density, Number(row.conversion_to_kg));
    });

    it('EXIT-1d — no mass supplied means no invented conversion', async () => {
        const fid = await flightOn('RP-C8801', 2);
        const r = await call(() => test.POST('/odata/v4/orders/createOrderFromFlight',
            { flightId: fid, orderedQuantity: 5000, unitPrice: 0.85 }));
        const o = await (await db()).run(SELECT.one.from('fuelsphere.FUEL_ORDERS')
            .where({ ID: r.body?.ID ?? '' }));
        out(`no orderedQuantityKg -> quantity=${o?.ordered_quantity} ${o?.uom_code} density=${o?.conversion_density}`);
        assert.strictEqual(Number(o.ordered_quantity), 5000, 'the supplied quantity stands');
        assert.strictEqual(o.conversion_density, null, 'no density is invented');
        assert.strictEqual(o.ordered_quantity_kg, null, 'a derived value with a missing input is null');
    });

    // -------------------------------------------------------------- EXIT-2 --
    it("EXIT-2 — no hardcoded 'KG' default remains on order or delivery creation", async () => {
        const hits = execSync(
            `grep -rn "uom_code: 'KG'" ${PROJECT}/srv --include='*.js' | wc -l`).toString().trim();
        out(`hardcoded uom_code: 'KG' in srv/: ${hits}`);
        assert.strictEqual(hits, '0');
    });

    it('EXIT-2b — a new order and a new ticket default to LTR', async () => {
        const m = cds.linked(cds.model);
        for (const [ent, f] of [['FUEL_ORDERS','uom_code'], ['FUEL_TICKETS','uom_code'], ['FUEL_DELIVERIES','uom_code']]) {
            const d = m.definitions['fuelsphere.' + ent].elements[f];
            out(`${ent}.${f} default = ${d.default?.val}`);
            assert.strictEqual(d.default?.val, 'LTR');
        }
    });

    // ------------------------------------------------------------ migration --
    it('migration — seeded rows keep their numbers and are labelled KG', async () => {
        // Asserted against the CSVs, not the live table: the live table also
        // holds rows this harness just created, which correctly carry LTR.
        //
        // Scoped to the rows WP-11 migrated. WP-12 adds LTR scenario rows,
        // and they are correct - the criterion is that the pre-existing rows
        // keep their numbers and are labelled for the unit they were always
        // in, not that the seed can never contain another unit.
        const fs = require('node:fs');
        for (const ent of ['FUEL_ORDERS', 'FUEL_TICKETS', 'FUEL_DELIVERIES']) {
            const lines = fs.readFileSync(`${PROJECT}/db/data/fuelsphere-${ent}.csv`, 'utf8').trim().split('\n');
            const h = lines[0].split(';');
            const iu = h.indexOf('uom_code');
            const ic = h.indexOf('created_by');
            // Third rewrite of this filter, so it stops enumerating.
            //   v1 excluded 'WP12_SEED'          -> broke on WP-17
            //   v2 excluded /WP(1[1-9]|[2-9]\d)_SEED/ -> broke on WPDEMO01_SEED
            // The rows this criterion is about are the ones that existed when
            // WP-11 ran: everything seeded before it, plus WP06_SEED. Any
            // other WP-prefixed creator is a later package by definition, so
            // match that shape rather than listing the packages.
            const later = /^WP(?!06_SEED$)/;
            const pre = lines.slice(1).map(r => r.split(';')).filter(f => !later.test(f[ic]));
            const vals = pre.map(f => f[iu]);
            const distinct = [...new Set(vals)];
            const added = lines.length - 1 - pre.length;
            out(`${ent}: ${vals.length} pre-WP-12 seed rows, uom_code = ${distinct.join(',')} (+${added} from later packages)`);
            assert.ok(vals.length > 0, 'instrument check: the pre-WP-12 rows must still be there');
            assert.deepStrictEqual(distinct, ['KG'], 'every migrated seed row stays labelled KG');
        }
    });

    it('SAP mapping — ISO codes present for the units §5 states', async () => {
        const rows = await (await db()).run(SELECT.from('fuelsphere.UNIT_OF_MEASURE')
            .columns('uom_code', 'sap_uom', 'sap_uom_iso'));
        rows.forEach(r => out(`  ${r.uom_code.padEnd(4)} sap_uom=${(r.sap_uom||'(none)').padEnd(6)} iso=${r.sap_uom_iso||'(none)'}`));
        const byCode = Object.fromEntries(rows.map(r => [r.uom_code, r]));
        assert.strictEqual(byCode.KG.sap_uom_iso, 'KGM');
        assert.strictEqual(byCode.LTR.sap_uom_iso, 'LTR');
        assert.strictEqual(byCode.MT.sap_uom_iso, 'TNE');
    });
});

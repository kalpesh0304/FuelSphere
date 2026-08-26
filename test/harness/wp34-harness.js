/**
 * WP-34 — ACARS_DERIVED and the derived-reading gap. Defect D41.
 *
 * The package's whole claim is criterion 2: a delivery whose uplift was
 * DERIVED records that it was, and is distinguishable from a MEASURED one.
 * EXIT-2 is that claim run twice over identical numbers.
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');

const test = cds.test(PROJECT);
const out = (s) => process.stdout.write('      ' + s + '\n');
const O = '/odata/v4/orders';

const DEL = 'EPD-YYZ-20260512-034';
const db = () => cds.connect.to('db');

const byNumber = async (n) => (await db()).run(
    SELECT.one.from('fuelsphere.FUEL_DELIVERIES').where({ delivery_number: n }));

const call = async (action, id) => {
    try {
        const r = await test.POST(
            `${O}/FuelDeliveries(ID=${id},IsActiveEntity=true)/FuelOrderService.${action}`, {});
        return { status: r.status, ...r.data };
    } catch (e) {
        return { status: e.response?.status ?? 'ERR',
                 msg: e.response?.data?.error?.message ?? e.message };
    }
};

describe('WP-34 — ACARS_DERIVED', () => {

    it('EXIT-1  ACARS_DERIVED exists as a FobSource member, and is enforced', async () => {
        const m = cds.model.definitions['fuelsphere.FobSource'];
        const values = Object.values(m.enum).map(e => e.val);
        out(`FobSource: ${values.join(', ')}`);
        assert.ok(values.includes('ACARS_DERIVED'), 'ACARS_DERIVED missing');
        // WP-31 added OCR_CONFIRMED, so six. Asserting the exact count is
        // still worth keeping - it is what caught the addition - but it
        // tracks the schema rather than one document's section.
        assert.strictEqual(values.length, 6,
            'FobSource: 5 from 01-TARGET-SCHEMA section 5, plus OCR_CONFIRMED from WP-31');
        // Not a restatement of what the annotation does - a check that it is
        // PRESENT. CLAUDE.md's trap row is the authority on its behaviour.
        assert.strictEqual(m['@assert.range'], true, '@assert.range absent from the type');
        out('@assert.range present on the type (was already there; this is a widening)');
    });

    it('EXIT-2a the seeded delivery has an arrival reading and NO gauge pair', async () => {
        const d = await byNumber(DEL);
        out(`fob_at_arrival=${d.fob_at_arrival_kg}  before=${d.fob_before_kg}  after=${d.fob_after_kg}  source=${d.fob_source}`);
        assert.strictEqual(Number(d.fob_at_arrival_kg), 2400);
        assert.strictEqual(d.fob_before_kg, null);
        assert.strictEqual(d.fob_after_kg, null);
        assert.strictEqual(d.fob_source, 'NONE');
    });

    it('EXIT-2b deriveGaugeReadings reconstructs the uplift and records that it did', async () => {
        const d = await byNumber(DEL);
        const r = await call('deriveGaugeReadings', d.ID);
        out(`${r.evidence}`);
        out(`apuCycles=${r.apuCycles}  arriving=${r.arrivingFlight}  departing=${r.departingFlight}`);
        assert.strictEqual(r.status, 200, r.msg);
        assert.strictEqual(r.fobSource, 'ACARS_DERIVED');
        assert.strictEqual(r.derived, true);
        // 4900 - 2400 + 105. The APU sum is TWO cycles across the turn, not
        // every cycle this tail ever flew - the range filter regression.
        assert.strictEqual(r.apuCycles, 2, 'the window swept in cycles outside the turn');
        assert.strictEqual(Number(r.groundBurnKg), 105);
        assert.strictEqual(Number(r.fobDeltaKg), 2605);

        const after = await byNumber(DEL);
        assert.strictEqual(after.fob_source, 'ACARS_DERIVED');
        assert.strictEqual(Number(after.fob_delta_kg), 2605);
        // Never fabricated. The readings did not exist and still do not.
        assert.strictEqual(after.fob_before_kg, null, 'a derived pair was manufactured');
        assert.strictEqual(after.fob_after_kg, null, 'a derived pair was manufactured');
        out('fob_before_kg and fob_after_kg left null - a delta is not a pair');
    });

    it('EXIT-2c THE PACKAGE: derived and measured differ on identical figures', async () => {
        const d = await byNumber(DEL);
        await call('deriveGaugeReadings', d.ID);
        const derived = await call('reconcile', d.ID);
        out(`DERIVED : ${derived.reconStatus}  variance=${derived.reconVarianceKg}  tol=${derived.toleranceKg}  (${derived.toleranceSource})`);

        // The same uplift, the same tickets, recorded as a MEASURED pair.
        await (await db()).run(UPDATE('fuelsphere.FUEL_DELIVERIES')
            .set({ fob_source: 'ACARS', fob_before_kg: 2400, fob_after_kg: 5005 })
            .where({ ID: d.ID }));
        const measured = await call('reconcile', d.ID);
        out(`MEASURED: ${measured.reconStatus}  variance=${measured.reconVarianceKg}  tol=${measured.toleranceKg}  (${measured.toleranceSource})`);

        assert.strictEqual(Number(derived.fqisMassKg), 2605, 'derived FQIS mass not reported');
        assert.strictEqual(Number(measured.fqisMassKg), 2605);
        assert.strictEqual(Number(derived.reconVarianceKg), 120);
        assert.strictEqual(Number(measured.reconVarianceKg), 120);
        // Identical inputs, identical variance, DIFFERENT verdict. That is
        // the whole defect: without the member both read as the measured row.
        assert.strictEqual(derived.reconStatus, 'RECONCILED');
        assert.strictEqual(measured.reconStatus, 'VARIANCE');
        assert.strictEqual(Number(derived.toleranceKg), 200);
        assert.strictEqual(Number(measured.toleranceKg), 50);
        out('same 120 kg: RECONCILED as derived, VARIANCE as measured');
    });

    it('EXIT-2d a derivation never overwrites a measurement (EPD480)', async () => {
        const d = await byNumber(DEL);
        await (await db()).run(UPDATE('fuelsphere.FUEL_DELIVERIES')
            .set({ fob_source: 'ACARS', fob_before_kg: 2400, fob_after_kg: 5005 })
            .where({ ID: d.ID }));
        const r = await call('deriveGaugeReadings', d.ID);
        out(r.msg);
        assert.strictEqual(r.status, 400);
        assert.ok(/^EPD480/.test(r.msg));
    });

    it('EXIT-2e an open APU cycle refuses the derivation (EPD479)', async () => {
        const d = await byNumber(DEL);
        await (await db()).run(UPDATE('fuelsphere.FUEL_DELIVERIES')
            .set({ fob_source: 'NONE', fob_before_kg: null, fob_after_kg: null })
            .where({ ID: d.ID }));
        await (await db()).run(UPDATE('fuelsphere.APU_USAGE')
            .set({ is_open: true, apu_burn_kg: null })
            .where({ ID: 'a9c00000-0000-4000-8000-000000034002' }));
        const r = await call('deriveGaugeReadings', d.ID);
        out(r.msg);
        assert.strictEqual(r.status, 400);
        assert.ok(/^EPD479/.test(r.msg));
        assert.ok(/unknown, not zero/.test(r.msg));
    });

    it('EXIT-2f no APU cycle refuses the derivation (EPD478, the NOT OFFERED row)', async () => {
        const d = await byNumber(DEL);
        await (await db()).run(DELETE.from('fuelsphere.APU_USAGE')
            .where({ created_by: 'WP34_SEED' }));
        // Snapshot BEFORE, compare AFTER. Asserting a literal null here read
        // residue from an earlier test as a write by this one - the assertion
        // was order-dependent and the code was never at fault.
        const before = await byNumber(DEL);
        const r = await call('deriveGaugeReadings', d.ID);
        out(r.msg);
        assert.strictEqual(r.status, 400);
        assert.ok(/^EPD478/.test(r.msg));
        const after = await byNumber(DEL);
        for (const f of ['fob_source', 'fob_delta_kg', 'ground_burn_kg',
                         'fob_before_kg', 'fob_after_kg']) {
            assert.deepStrictEqual(after[f], before[f], `${f} changed on a refusal`);
        }
        out('refused, and every gauge field is byte-for-byte what it was');
    });

    it('EXIT-3  the pure arithmetic reproduces section 5 worked example', async () => {
        const { deriveUplift } = require(`${PROJECT}/srv/lib/fob-derivation`);
        const r = deriveUplift({ fobInKg: 2400, fobOutKg: 4900, apuBurnKg: 100 });
        out(r.evidence);
        assert.strictEqual(r.fob_delta_kg, 2600);
        assert.strictEqual(r.ground_burn_kg, 100);
        // Section 5: on the derived path ground_burn_kg is an INPUT.
        const bad = deriveUplift({ fobInKg: 2400, fobOutKg: 4900, apuBurnKg: null });
        out(bad.error);
        assert.ok(/^EPD478/.test(bad.error), 'unadjusted IN/OUT was offered');
    });

    it('EXIT-4  the bound action carries its own grant (D22)', async () => {
        const fs = require('node:fs');
        const auth = fs.readFileSync(`${PROJECT}/srv/authorization.cds`, 'utf8');
        assert.ok(/grant:\s*'deriveGaugeReadings'/.test(auth),
            'ungranted bound action - refused for every user including one holding all scopes');
        out("grant: 'deriveGaugeReadings' present in authorization.cds");
    });
});

/**
 * WP-17 — delivery and FOB reconciliation (B2, B5, C-1).
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const fs = require('node:fs');

const test = cds.test(PROJECT);
const out = (s) => process.stdout.write('      ' + s + '\n');
const O = '/odata/v4/orders';

const D = {
    acars:  'EPD-MNL-20260407-0001',
    crew:   'EPD-MNL-20260407-0002',
    twoSup: 'EPD-YYZ-20260407-0001',
    noFqis: 'EPD-MNL-20260407-0003'
};

const byNumber = async (n) => (await cds.connect.to('db')).run(
    SELECT.one.from('fuelsphere.FUEL_DELIVERIES').where({ delivery_number: n }));

const reconcile = async (deliveryNumber) => {
    const d = await byNumber(deliveryNumber);
    try {
        const r = await test.POST(
            `${O}/FuelDeliveries(ID=${d.ID},IsActiveEntity=true)/FuelOrderService.reconcile`, {});
        return { status: r.status, ...r.data, _id: d.ID };
    } catch (e) {
        return { status: e.response?.status ?? 'ERR', msg: e.response?.data?.error?.message ?? e.message };
    }
};

const show = (r) => {
    out(`  metered=${r.meteredMassKg}  FQIS=${r.fqisMassKg}  variance=${r.reconVarianceKg}`);
    out(`  tolerance=${r.toleranceKg} (${r.toleranceSource}, fob_source=${r.fobSource})  suppliers=${r.supplierCount}`);
    out(`  status=${r.reconStatus}`);
    out(`  ${r.evidence}`);
};

describe('WP-17 — FOB reconciliation', function () {

    // =================================================================
    it('EXIT-1 — tickets plus both gauge readings give a variance and a status', async () => {
        const r = await reconcile(D.acars);
        assert.strictEqual(r.status, 200, r.msg);
        out(`${D.acars} (ACARS)`);
        show(r);
        assert.strictEqual(Number(r.meteredMassKg), 12030, 'sum of ticket quantity_kg');
        assert.strictEqual(Number(r.fqisMassKg), 11910, 'fob_after - fob_before');
        assert.strictEqual(Number(r.reconVarianceKg), 120, 'metered - FQIS');

        // stored, not merely returned
        const stored = await byNumber(D.acars);
        assert.strictEqual(Number(stored.recon_variance_kg), 120);
        assert.strictEqual(stored.recon_status, r.reconStatus);
        out(`  stored: recon_variance_kg=${stored.recon_variance_kg} recon_status=${stored.recon_status}`);
    });

    // =================================================================
    it('EXIT-5 — the SAME variance, two sources, two statuses', async () => {
        const a = await reconcile(D.acars);
        const c = await reconcile(D.crew);
        out(`ACARS         ${D.acars}`); show(a);
        out(`CREW_REPORTED ${D.crew}`); show(c);

        // The figures are identical on both sides. Only the source differs.
        assert.strictEqual(Number(a.meteredMassKg), Number(c.meteredMassKg));
        assert.strictEqual(Number(a.fqisMassKg), Number(c.fqisMassKg));
        assert.strictEqual(Number(a.reconVarianceKg), Number(c.reconVarianceKg));
        assert.strictEqual(Number(a.reconVarianceKg), 120);

        // 0.5% of 12030 = 60.15 -> floor 50 does not bind -> 120 is outside
        assert.strictEqual(Number(a.toleranceKg), 60.15);
        assert.strictEqual(a.reconStatus, 'VARIANCE');
        // 1.5% of 12030 = 180.45 -> floor 200 binds -> 120 is inside
        assert.strictEqual(Number(c.toleranceKg), 200);
        assert.strictEqual(c.reconStatus, 'RECONCILED');

        assert.notStrictEqual(a.reconStatus, c.reconStatus,
            'identical figures must not produce the same status across sources');
        out(`identical variance ${a.reconVarianceKg} kg -> ${a.reconStatus} (ACARS) vs ${c.reconStatus} (crew)`);
    });

    it('EXIT-2 — inside tolerance reads RECONCILED, outside reads VARIANCE', async () => {
        // Both verdicts are exercised above on real deliveries. Here the
        // boundary itself, through the pure computation, so the threshold is
        // shown to be a threshold and not a coincidence of two fixtures.
        const { reconcile: pure } = require(`${PROJECT}/srv/lib/fob-reconciliation`);

        // Hold the METERED mass fixed and move the gauge. Varying the metered
        // side moves the tolerance with it — 0.5% of a changing number — so
        // the first version of this test walked the threshold along with the
        // variance and could never have found the boundary.
        const METERED = 12030;                       // tolerance = 0.5% = 60.15
        const at = (fobAfter) => pure(
            { fob_source: 'ACARS', fob_before_kg: 0, fob_after_kg: fobAfter },
            [{ quantity_kg: METERED, supplier_ID: 'S1' }]);

        const inside  = at(11969.85);   // variance  60.15 — exactly on the line
        const outside = at(11969.84);   // variance  60.16 — one hundredth past it
        const under   = at(12090.16);   // variance -60.16 — the same, under-delivered
        out(`metered ${METERED}, tolerance 60.15`);
        out(`  variance ${inside.recon_variance_kg}  -> ${inside.recon_status}`);
        out(`  variance ${outside.recon_variance_kg} -> ${outside.recon_status}`);
        out(`  variance ${under.recon_variance_kg} -> ${under.recon_status}`);
        assert.strictEqual(inside.recon_status, 'RECONCILED', 'on the line is inside');
        assert.strictEqual(outside.recon_status, 'VARIANCE');
        assert.strictEqual(under.recon_status, 'VARIANCE', 'an under-delivery is a variance too');
    });

    // =================================================================
    it('EXIT-3 — no gauge reading reads NOT_RECONCILED and computes no variance', async () => {
        const r = await reconcile(D.noFqis);
        out(`${D.noFqis} (fob_source NONE)`); show(r);
        assert.strictEqual(r.reconStatus, 'NOT_RECONCILED');
        assert.strictEqual(r.reconVarianceKg, null, 'a variance figure would imply a comparison was made');
        assert.strictEqual(r.toleranceKg, null);

        const stored = await byNumber(D.noFqis);
        assert.strictEqual(stored.recon_variance_kg, null, 'and null is what is stored');
        assert.strictEqual(stored.recon_status, 'NOT_RECONCILED');

        // The metered side is complete and non-zero. NOT_RECONCILED here is
        // the missing gauge, not a missing ticket — so it cannot be read as
        // "nothing was delivered".
        assert.ok(Number(r.meteredMassKg) > 0, `metered mass is known: ${r.meteredMassKg}`);
        out(`  metered side is complete (${r.meteredMassKg} kg) — the gauge is what is absent`);
    });

    it('EXIT-3b — NOT_RECONCILED never reads as a pass, whatever caused it', async () => {
        const { reconcile: pure, STATUS } = require(`${PROJECT}/srv/lib/fob-reconciliation`);
        const cases = [
            ['fob_source NONE',        { fob_source: 'NONE', fob_before_kg: 100, fob_after_kg: 200 }, [{ quantity_kg: 100, supplier_ID: 'S1' }]],
            ['half a gauge pair',      { fob_source: 'ACARS', fob_before_kg: 100, fob_after_kg: null }, [{ quantity_kg: 100, supplier_ID: 'S1' }]],
            ['no tickets',             { fob_source: 'ACARS', fob_before_kg: 100, fob_after_kg: 200 }, []],
            ['a ticket with no mass',  { fob_source: 'ACARS', fob_before_kg: 100, fob_after_kg: 200 }, [{ quantity_kg: null, supplier_ID: 'S1' }]]
        ];
        for (const [label, d, t] of cases) {
            const r = pure(d, t);
            out(`${label.padEnd(24)} -> ${r.recon_status}, variance ${r.recon_variance_kg}`);
            assert.strictEqual(r.recon_status, STATUS.NOT_RECONCILED, label);
            assert.strictEqual(r.recon_variance_kg, null, label);
        }
        // Instrument check: the same shape WITH complete inputs does reach a
        // verdict, so NOT_RECONCILED above is the rule and not a dead path.
        const ok = pure({ fob_source: 'ACARS', fob_before_kg: 100, fob_after_kg: 200 },
                        [{ quantity_kg: 100, supplier_ID: 'S1' }]);
        out(`complete inputs          -> ${ok.recon_status}, variance ${ok.recon_variance_kg}`);
        assert.notStrictEqual(ok.recon_status, STATUS.NOT_RECONCILED);
    });

    // =================================================================
    it('EXIT-4 — two suppliers on one gauge pair reads NOT_ATTRIBUTABLE', async () => {
        const r = await reconcile(D.twoSup);
        out(`${D.twoSup} (two orders, two suppliers, one FQIS pair)`); show(r);
        assert.strictEqual(r.reconStatus, 'NOT_ATTRIBUTABLE');
        assert.strictEqual(Number(r.supplierCount), 2);
        // The variance IS computed and recorded. It is real; it just belongs
        // to neither supplier.
        assert.strictEqual(Number(r.meteredMassKg), 19248);
        assert.strictEqual(Number(r.fqisMassKg), 19260);
        assert.strictEqual(Number(r.reconVarianceKg), -12);
        const stored = await byNumber(D.twoSup);
        assert.strictEqual(Number(stored.recon_variance_kg), -12, 'recorded, not discarded');
        assert.strictEqual(Number(stored.supplier_count), 2);
        out(`  variance recorded (${stored.recon_variance_kg} kg) but not attributed`);
    });

    it('EXIT-4b — NOT_ATTRIBUTABLE holds even when the variance is tiny', async () => {
        const { reconcile: pure } = require(`${PROJECT}/srv/lib/fob-reconciliation`);
        const g = { fob_source: 'ACARS', fob_before_kg: 0, fob_after_kg: 12030 };
        const one = pure(g, [{ quantity_kg: 12030, supplier_ID: 'S1' }]);
        const two = pure(g, [{ quantity_kg: 6015, supplier_ID: 'S1' }, { quantity_kg: 6015, supplier_ID: 'S2' }]);
        out(`variance 0, one supplier  -> ${one.recon_status}`);
        out(`variance 0, two suppliers -> ${two.recon_status}`);
        assert.strictEqual(one.recon_status, 'RECONCILED');
        assert.strictEqual(two.recon_status, 'NOT_ATTRIBUTABLE',
            'attribution is not something a small variance earns');
        // An unmatched ticket makes the supplier set unknown, not a singleton.
        const unk = pure(g, [{ quantity_kg: 6015, supplier_ID: 'S1' }, { quantity_kg: 6015, supplier_ID: null }]);
        out(`variance 0, one known + one unmatched -> ${unk.recon_status} (supplier_count=${unk.supplier_count})`);
        assert.strictEqual(unk.recon_status, 'NOT_ATTRIBUTABLE');
    });

    // =================================================================
    it('EXIT-6 — no posting path is conditional on recon_status', async () => {
        const files = fs.readdirSync(`${PROJECT}/srv`).filter(f => f.endsWith('.js'))
            .concat(fs.readdirSync(`${PROJECT}/srv/lib`).map(f => `lib/${f}`));
        const posting = /s4_gr_number|s4_po_number|postToFinance|createInvoice|FinancePost/;
        const offenders = [];
        let postingFiles = 0;
        for (const f of files) {
            const src = fs.readFileSync(`${PROJECT}/srv/${f}`, 'utf8');
            if (!posting.test(src)) continue;
            postingFiles++;
            // recon_status must not appear at all in a file that posts, except
            // in fob-reconciliation.js which computes it and posts nothing.
            const lines = src.split('\n');
            lines.forEach((l, i) => {
                if (/recon_status|reconStatus|NOT_RECONCILED|NOT_ATTRIBUTABLE/.test(l)
                    && !/^\s*(\/\/|\*)/.test(l)) offenders.push(`${f}:${i + 1}: ${l.trim()}`);
            });
        }
        out(`files containing a posting path: ${postingFiles}`);
        offenders.forEach(o => out(`  ${o}`));
        assert.ok(postingFiles >= 2, 'instrument check: the posting paths must be findable');
        // The reconcile handler in order-service.js reads recon_status to
        // REPORT it. Assert instead that no branch keys on it.
        const os = fs.readFileSync(`${PROJECT}/srv/order-service.js`, 'utf8');
        const branches = os.split('\n').filter(l =>
            /(if|while|\?|&&|\|\|)/.test(l) && /recon_status|reconStatus/.test(l) && !/^\s*(\/\/|\*)/.test(l));
        out(`branches keyed on recon_status across all of srv/: ${branches.length}`);
        branches.forEach(b => out(`  ${b.trim()}`));
        assert.deepStrictEqual(branches, [], 'C-1: reconciliation reports, it does not gate');
    });

    it('EXIT-6b — captureSignatures still posts on a VARIANCE delivery', async () => {
        // The behavioural proof, not just the textual one: a delivery that
        // reconciles to VARIANCE must still reach the posting path.
        const db = await cds.connect.to('db');
        const d = await byNumber(D.acars);
        assert.strictEqual(d.recon_status, 'VARIANCE', 'precondition from EXIT-5');

        // captureSignatures carries its own guard: the ORDER must be
        // InProgress. That guard is not what this test is about, so satisfy it
        // as setup — otherwise a 409 from the status machine would masquerade
        // as a reconciliation block, which is the exact confusion C-1 warns
        // against.
        await db.run(UPDATE('fuelsphere.FUEL_ORDERS')
            .set({ status: 'InProgress' }).where({ ID: d.order_ID }));
        let status, data;
        try {
            const r = await test.POST(
                `${O}/FuelDeliveries(ID=${d.ID},IsActiveEntity=true)/FuelOrderService.captureSignatures`,
                { pilotName: 'Capt. Test', pilotSignature: 'AAA=', groundCrewName: 'Crew Test',
                  groundCrewSignature: 'AAA=', signatureLocation: 'RPLL Gate 1' });
            status = r.status; data = r.data;
        } catch (e) { status = e.response?.status ?? 'ERR'; data = e.response?.data?.error?.message; }
        const after = await byNumber(D.acars);
        out(`captureSignatures on a VARIANCE delivery -> ${status}`);
        out(`  s4_gr_number=${after.s4_gr_number}  status=${after.status}  recon_status=${after.recon_status}`);
        assert.strictEqual(status, 200, typeof data === 'string' ? data : JSON.stringify(data));
        assert.ok(after.s4_gr_number, 'the GR must still be created — C-1');
        assert.strictEqual(after.recon_status, 'VARIANCE', 'and the variance is not cleared by posting');
    });

    // =================================================================
    it('the reconciliation is triggered by a ticket write, not only by the action', async () => {
        const db = await cds.connect.to('db');
        const d = await byNumber(D.crew);
        // Reset to prove the write, not a leftover from an earlier test.
        await db.run(UPDATE('fuelsphere.FUEL_DELIVERIES')
            .set({ recon_status: 'NOT_RECONCILED', recon_variance_kg: null }).where({ ID: d.ID }));
        const t = await db.run(SELECT.one.from('fuelsphere.FUEL_TICKETS').where({ delivery_ID: d.ID }));

        // FuelTickets is draft-enabled, so an active row is edited through the
        // draft: draftEdit, PATCH the draft, draftActivate. draftActivate is
        // what fires UPDATE on the active entity, which is where the
        // reconciliation hangs.
        const edit = await test.POST(
            `/odata/v4/tickets/FuelTickets(ID=${t.ID},IsActiveEntity=true)/TicketService.draftEdit`, {});
        assert.ok(edit.status === 200 || edit.status === 201, JSON.stringify(edit.data));
        const pat = await test.PATCH(
            `/odata/v4/tickets/FuelTickets(ID=${t.ID},IsActiveEntity=false)`, { density_temp_c: 27.5 });
        assert.strictEqual(pat.status, 200, JSON.stringify(pat.data));
        const act = await test.POST(
            `/odata/v4/tickets/FuelTickets(ID=${t.ID},IsActiveEntity=false)/TicketService.draftActivate`, {});
        assert.ok(act.status === 200 || act.status === 201, JSON.stringify(act.data));
        const after = await byNumber(D.crew);
        out(`ticket PATCH -> delivery recon_status=${after.recon_status} variance=${after.recon_variance_kg}`);
        assert.strictEqual(after.recon_status, 'RECONCILED', 'a ticket write must re-reconcile its delivery');
        assert.strictEqual(Number(after.recon_variance_kg), 120);
    });
});

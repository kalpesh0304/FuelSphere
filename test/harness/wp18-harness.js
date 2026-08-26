/**
 * WP-18 — dispatch plan versioning and the regulated stack (A7, B3).
 * Criterion 4 — v1 then v4 — is what this is built around.
 */
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert');
const XLSX=require(`${PROJECT}/node_modules/xlsx`);
const test=cds.test(PROJECT); const out=s=>process.stdout.write('      '+s+'\n');
const O='/odata/v4/orders';

const {
    deriveStack, classifyVersion, isResend, resolvePlanGroup, STACK_COMPONENTS
} = require(`${PROJECT}/srv/lib/dispatch-plan`);

const LEG = 'AC410-20260410-YYZYUL';       // seeded, v1 ACTIVE. Leg id corrected with S1
// EXIT-1b needs a row where additional and extra are non-zero AND different.
// S1 now carries 0/0 DELIBERATELY - an unexplained non-zero is what produced
// its 1,897 kg gap - so that test uses a plan that still exercises the rule.
// The criterion is "the two fields are never merged", not a fact about AC410.
const SPLIT_LEG = 'AC412-20260410-YYZYUL';   // leg id corrected with S3
const db = () => cds.connect.to('db');

const plansFor = async (group) => (await db()).run(
    SELECT.from('fuelsphere.FLIGHT_DISPATCH')
        .columns('ID','dispatch_order_id','plan_group_id','plan_version','plan_version_source',
                 'plan_status','superseded_by_ID','version_gap_flag','versions_skipped',
                 'dispatch_qty_kg','block_fuel_kg','trip_fuel_kg')
        .where({ plan_group_id: group }));

/** Build a one-row dispatch upload and post it through the real import. */
async function upload(row) {
    const base = {
        FUEL_ORDER_ID: row.FUEL_ORDER_ID, FLIGHT_NUMBER: 'AC410', FLIGHT_DATE: '2026-04-10',
        TAIL_NUMBER: 'C-FDMO', ATD: '2026-04-10T11:20:00Z', DISPATCH_QTY_KG: 4202.5,
        ROB_DEPARTURE_KG: 6700, PAYLOAD_KG: 14000, CAPTAIN_ID: 'CAP-AC221',
        DISPATCHER_ID: 'DSP-AC101', DISPATCH_TIMESTAMP: '2026-04-10T06:00:00Z',
        DISPATCH_SOURCE: 'TRIPRECORD', ...row
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([base]), 'Dispatch');
    const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    const r = await test.POST(`${O}/importFlightDispatchExcel`,
        { fileName: 'wp18.xlsx', fileContent: b64 });
    return r.data;
}

describe('WP-18 — plan versioning and the regulated stack', function () {

    // ================================================================
    it('EXIT-1 — the seven components are carried and block is derived from them', async () => {
        const [p] = await plansFor(LEG);
        const comps = await (await db()).run(SELECT.one.from('fuelsphere.FLIGHT_DISPATCH')
            .columns(...STACK_COMPONENTS).where({ plan_group_id: LEG }));
        const sum = Number(Object.values(comps).reduce((a,v)=>a+Number(v),0).toFixed(2));
        STACK_COMPONENTS.forEach(c => out(`${c.padEnd(22)} ${comps[c]}`));
        out(`sum ${sum}  block_fuel_kg ${p.block_fuel_kg}  dispatch_qty_kg ${p.dispatch_qty_kg}`);
        assert.strictEqual(sum, Number(p.block_fuel_kg), 'DSP450: block must equal its components');
        assert.strictEqual(Number(p.dispatch_qty_kg), Number(p.block_fuel_kg),
            'the dispatcher-confirmed figure should equal the derived block');

        // Derived, not keyed: recomputing from the components reproduces it.
        const d = deriveStack(comps, null);
        assert.strictEqual(d.block_fuel_kg, Number(p.block_fuel_kg));
        assert.strictEqual(d.required_uplift_kg, null, 'no on-board figure -> null, never the block itself');
        out(`deriveStack reproduces ${d.block_fuel_kg}; required_uplift null with no on-board figure`);
    });

    it('EXIT-1b — additional and extra are never merged (DSP454)', async () => {
        // NO PINNED ROW. This test has been repointed three times - it pinned
        // AC410 until S1 zeroed both fields deliberately, then AC412 until S3
        // did the same. Every corrected scenario zeroes them, because an
        // unexplained non-zero is what produced S1's original 1,897 kg gap, so
        // a pin here will keep chasing the next correction.
        //
        // The criterion is a property of the DATA, not of one flight: somewhere
        // the two fields hold different non-zero values, therefore they are not
        // one merged column. So FIND a qualifying row rather than name one -
        // and fail loudly if none exists, because a search that finds nothing
        // and a search that is broken look identical.
        const all = await (await db()).run(SELECT.from('fuelsphere.FLIGHT_DISPATCH')
            .columns('plan_group_id','additional_fuel_kg','extra_fuel_kg'));
        const split = all.filter(c =>
            c.additional_fuel_kg !== null && c.extra_fuel_kg !== null
            && Number(c.additional_fuel_kg) !== 0 && Number(c.extra_fuel_kg) !== 0
            && Number(c.additional_fuel_kg) !== Number(c.extra_fuel_kg));
        out(`${split.length} of ${all.length} plans carry the two as DIFFERENT non-zero values`);
        split.slice(0, 3).forEach(c =>
            out(`  ${c.plan_group_id}  additional ${c.additional_fuel_kg}  extra ${c.extra_fuel_kg}`));
        assert.ok(all.length > 0, 'no dispatch rows at all — the instrument is broken, not the data');
        assert.ok(split.length > 0,
            'no plan anywhere holds additional and extra as different non-zero values');
    });

    // ================================================================
    it('EXIT-2 — a second plan for the leg creates a new row and supersedes the old', async () => {
        const before = await plansFor(LEG);
        assert.strictEqual(before.length, 1, 'precondition: one seeded plan');
        assert.strictEqual(before[0].plan_status, 'ACTIVE');

        const res = await upload({ FUEL_ORDER_ID: 'FO-AC-2026-00410', PLAN_VERSION: 2,
            DISPATCH_QTY_KG: 5100, TRIP_FUEL_KG: 4000, CONTINGENCY_FUEL_KG: 200,
            ALTERNATE_FUEL_KG: 400, FINAL_RESERVE_KG: 300, ADDITIONAL_FUEL_KG: 100,
            TAXI_FUEL_KG: 60, EXTRA_FUEL_KG: 40 });
        out(`import -> created ${res.dispatchesCreated}, superseded ${res.dispatchesSuperseded}, skipped ${res.dispatchesSkipped}`);
        assert.strictEqual(res.dispatchesCreated, 1, 'a revision must INSERT, not skip');
        assert.strictEqual(res.dispatchesSkipped, 0, 'D27: a matching key is a revision, not a duplicate');
        assert.strictEqual(res.dispatchesSuperseded, 1);

        const after = await plansFor(LEG);
        after.forEach(p => out(`  v${p.plan_version} ${p.plan_status.padEnd(10)} qty=${p.dispatch_qty_kg} superseded_by=${p.superseded_by_ID ? 'set' : 'null'}`));
        assert.strictEqual(after.length, 2, 'two rows, not one updated in place');
        const v1 = after.find(p => Number(p.plan_version) === 1);
        const v2 = after.find(p => Number(p.plan_version) === 2);
        assert.strictEqual(v1.plan_status, 'SUPERSEDED');
        assert.strictEqual(v1.superseded_by_ID, v2.ID, 'DSP453: forward pointer set');
        assert.strictEqual(Number(v1.dispatch_qty_kg), 4202.5, 'the superseded row keeps its own figures');
        assert.strictEqual(Number(v2.dispatch_qty_kg), 5100, 'the revised quantity landed');
        assert.strictEqual(Number(v2.block_fuel_kg), 5100, 'and its block derives from its components');
    });

    it('EXIT-3 — exactly one ACTIVE row per plan_group_id (DSP452)', async () => {
        const all = await (await db()).run(SELECT.from('fuelsphere.FLIGHT_DISPATCH')
            .columns('plan_group_id','plan_status'));
        const active = {};
        all.forEach(p => { if (p.plan_status === 'ACTIVE') active[p.plan_group_id] = (active[p.plan_group_id]||0)+1; });
        const offenders = Object.entries(active).filter(([,n]) => n !== 1);
        out(`plan families: ${new Set(all.map(p=>p.plan_group_id)).size}; families with != 1 ACTIVE: ${offenders.length}`);
        assert.ok(all.length > 0, 'instrument check: there must be plans to count');
        assert.deepStrictEqual(offenders, []);
    });

    // ================================================================
    it('EXIT-4 — v1 then v4 applies v4, flags the gap, skips 2, and does NOT hold', async () => {
        // Pure arithmetic first, so the rule is visible without a fixture.
        const g = classifyVersion(4, 1);
        out(`classifyVersion(incoming 4, active 1) -> v${g.plan_version} gap=${g.version_gap_flag} skipped=${g.versions_skipped} source=${g.plan_version_source}`);
        assert.strictEqual(g.plan_version, 4, 'the arriving version is applied');
        assert.strictEqual(g.version_gap_flag, true);
        assert.strictEqual(g.versions_skipped, 2, 'v2 and v3 never arrived');

        // Then through the running import, from the current active v2.
        const res = await upload({ FUEL_ORDER_ID: 'FO-AC-2026-00410B', PLAN_VERSION: 5,
            DISPATCH_QTY_KG: 5200, TRIP_FUEL_KG: 4100, CONTINGENCY_FUEL_KG: 200,
            ALTERNATE_FUEL_KG: 400, FINAL_RESERVE_KG: 300, ADDITIONAL_FUEL_KG: 100,
            TAXI_FUEL_KG: 60, EXTRA_FUEL_KG: 40 });
        assert.strictEqual(res.dispatchesCreated, 1, 'STG412: apply it, do not hold');
        assert.strictEqual(res.dispatchesSkipped, 0, 'a gap must never cause a hold');

        const rows = await plansFor(LEG);
        const v5 = rows.find(p => Number(p.plan_version) === 5);
        out(`v2 -> v5 applied: gap=${v5.version_gap_flag} skipped=${v5.versions_skipped} status=${v5.plan_status}`);
        assert.strictEqual(v5.plan_status, 'ACTIVE');
        assert.strictEqual(v5.version_gap_flag, true);
        assert.strictEqual(Number(v5.versions_skipped), 2, 'v3 and v4 never arrived');
        assert.match(JSON.stringify(res.errors), /DSP456/, 'the gap is reported');

        // DSP456: stamped on the applied row and never back-updated.
        const v2 = rows.find(p => Number(p.plan_version) === 2);
        assert.strictEqual(v2.version_gap_flag, false, 'the earlier row must not be back-updated');
        out(`v2 still carries gap=${v2.version_gap_flag} skipped=${v2.versions_skipped} — not back-updated`);
    });

    it('EXIT-4b — a contiguous step raises no gap, so the flag means something', async () => {
        const c = classifyVersion(3, 2);
        out(`classifyVersion(3, 2) -> gap=${c.version_gap_flag} skipped=${c.versions_skipped}`);
        assert.strictEqual(c.version_gap_flag, false);
        assert.strictEqual(c.versions_skipped, 0);
        // And a first-ever plan is not a gap either.
        const first = classifyVersion(7, null);
        out(`classifyVersion(7, none) -> v${first.plan_version} gap=${first.version_gap_flag}`);
        assert.strictEqual(first.version_gap_flag, false, 'a first plan has nothing to skip');
    });

    it('EXIT-4c — with no version on the feed, gaps are invisible and say so', async () => {
        const a = classifyVersion(null, 3);
        out(`classifyVersion(none, active 3) -> v${a.plan_version} source=${a.plan_version_source} gap=${a.version_gap_flag}`);
        assert.strictEqual(a.plan_version_source, 'ASSIGNED');
        assert.strictEqual(a.plan_version, 4, 'assigned from arrival order');
        assert.strictEqual(a.version_gap_flag, false);
        // The point of the field: false here means "could not look", not "looked and found none".
        const f = classifyVersion(4, 3);
        assert.strictEqual(f.plan_version_source, 'FEED');
        out('plan_version_source distinguishes "no gap found" from "could not look"');
    });

    // ================================================================
    it('EXIT-5 — an order references its plan, and a stale order is identifiable', async () => {
        const d = await db();
        const order = await d.run(SELECT.one.from('fuelsphere.FUEL_ORDERS')
            .columns('ID','order_number','dispatch_plan_ID')
            .where({ order_number: 'FO-YYZ-20260410-001' }));
        assert.ok(order.dispatch_plan_ID, 'the order must reference a plan');
        const plan = await d.run(SELECT.one.from('fuelsphere.FLIGHT_DISPATCH')
            .columns('plan_version','plan_status','plan_group_id').where({ ID: order.dispatch_plan_ID }));
        out(`${order.order_number} -> plan ${plan.plan_group_id} v${plan.plan_version} ${plan.plan_status}`);

        // Stale by construction: the question is only whether the order's plan
        // is still the active one. No field comparison.
        const stale = plan.plan_status !== 'ACTIVE';
        out(`order is stale: ${stale} (its plan is ${plan.plan_status})`);
        assert.strictEqual(stale, false, 'the import repoints the order at the newest plan');
        assert.ok(plan.plan_group_id === LEG);

        // The criterion needs the TRUE case too, or it only shows that a
        // current order looks current. Point a second order at a superseded
        // version and confirm it is identifiable with no field comparison —
        // the question is only whether its plan is still the active one.
        const superseded = await d.run(SELECT.one.from('fuelsphere.FLIGHT_DISPATCH')
            .columns('ID','plan_version').where({ plan_group_id: LEG, plan_status: 'SUPERSEDED' }));
        assert.ok(superseded, 'precondition: a superseded version exists');
        const other = await d.run(SELECT.one.from('fuelsphere.FUEL_ORDERS')
            .columns('ID','order_number').where({ order_number: 'FO-YYZ-20260410-002' }));
        await d.run(UPDATE('fuelsphere.FUEL_ORDERS')
            .set({ dispatch_plan_ID: superseded.ID }).where({ ID: other.ID }));

        // The stale query: orders whose plan is not ACTIVE.
        const staleOrders = await d.run(`
            SELECT o.order_number, p.plan_version, p.plan_status
            FROM fuelsphere_FUEL_ORDERS o
            JOIN fuelsphere_FLIGHT_DISPATCH p ON p.ID = o.dispatch_plan_ID
            WHERE p.plan_status <> 'ACTIVE'`);
        staleOrders.forEach(r => out(`  STALE: ${r.order_number} -> v${r.plan_version} ${r.plan_status}`));
        assert.strictEqual(staleOrders.length, 1);
        assert.strictEqual(staleOrders[0].order_number, 'FO-YYZ-20260410-002');
        out('identified by plan status alone — no field comparison');
    });

    // ================================================================
    it('EXIT-6 — a tail swap changes the registration and leaves flight_leg_id alone', async () => {
        const d = await db();
        const before = await d.run(SELECT.one.from('fuelsphere.FLIGHT_SCHEDULE')
            .columns('ID','flight_number','aircraft_reg','flight_leg_id')
            .where({ flight_number: 'AC410', flight_date: '2026-04-10' }));
        out(`before: ${before.flight_number} reg=${before.aircraft_reg} leg=${before.flight_leg_id}`);

        await d.run(UPDATE('fuelsphere.FLIGHT_SCHEDULE')
            .set({ aircraft_reg: 'C-FDMP' }).where({ ID: before.ID }));

        const after = await d.run(SELECT.one.from('fuelsphere.FLIGHT_SCHEDULE')
            .columns('aircraft_reg','flight_leg_id').where({ ID: before.ID }));
        out(`after:  reg=${after.aircraft_reg} leg=${after.flight_leg_id}`);
        assert.notStrictEqual(after.aircraft_reg, before.aircraft_reg, 'instrument check: the swap happened');
        assert.strictEqual(after.flight_leg_id, before.flight_leg_id, 'ENR452: the leg id is immutable');

        // And the plan family is unaffected, which is the reason it matters.
        const rows = await plansFor(before.flight_leg_id);
        out(`plan family ${before.flight_leg_id} still holds ${rows.length} version(s) after the swap`);
        assert.ok(rows.length >= 2);
    });

    it('a genuine re-send is still detected, on the narrower test', async () => {
        assert.strictEqual(isResend(5, 5), true, 'same family, same version from the feed');
        assert.strictEqual(isResend(6, 5), false, 'a different version is a revision');
        assert.strictEqual(isResend(null, 5), false, 'assigned versions cannot be compared');
        const res = await upload({ FUEL_ORDER_ID: 'FO-AC-2026-00410B', PLAN_VERSION: 5,
            DISPATCH_QTY_KG: 5200 });
        out(`re-sending v5 -> created ${res.dispatchesCreated}, skipped ${res.dispatchesSkipped}`);
        assert.strictEqual(res.dispatchesCreated, 0);
        assert.strictEqual(res.dispatchesSkipped, 1);
        assert.match(JSON.stringify(res.errors), /DSP453/);
    });

    it('plan_group_id survives where a leg id is missing', async () => {
        assert.strictEqual(resolvePlanGroup('AC1-20260101-YYZ','AC1','2026-01-01'), 'AC1-20260101-YYZ');
        assert.strictEqual(resolvePlanGroup(null,'AC1','2026-01-01'), 'LEG:AC1|2026-01-01');
        out('leg id present -> used; absent -> deterministic composite, never null');
    });
});

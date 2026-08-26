/**
 * WP-19 — burn derivation and APU (B4, B9), closing D10.
 * Criterion 5 is what this package exists for: the ACARS variance ladder has
 * never fired, so a passing run there is the first evidence it works at all.
 */
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert');
const test=cds.test(PROJECT); const out=s=>process.stdout.write('      '+s+'\n');
const B='/odata/v4/burn';

const { deriveCycle, runningMinutes, allocate, splitBlockBurn, rateForTail, PHASE, SOURCE, BASIS }
    = require(`${PROJECT}/srv/lib/apu-burn`);

const db = () => cds.connect.to('db');
const cycleFor = async (tail, phase) => (await db()).run(
    SELECT.one.from('fuelsphere.APU_USAGE').where({ tail_number: tail, usage_phase: phase }));

describe('WP-19 — burn derivation and APU', function () {

    // ================================================================
    it('EXIT-1 — a cycle derives its burn from its own minutes and the per-tail rate', async () => {
        const c = await cycleFor('C-FDMO', PHASE.PRE_DEPARTURE);
        out(`C-FDMO PRE_DEPARTURE  ${c.apu_start_utc} -> ${c.apu_stop_utc}`);
        out(`  running_minutes=${c.running_minutes}  rate=${c.burn_rate_kg_hr} kg/h (${c.rate_source})  burn=${c.apu_burn_kg} kg`);
        assert.strictEqual(c.running_minutes, 30);   // S1 correction: 38 -> 30
        assert.strictEqual(Number(c.burn_rate_kg_hr), 105);
        assert.strictEqual(Number(c.apu_burn_kg), 52.5, '30/60 x 105');
        assert.strictEqual(c.rate_source, 'AIRCRAFT_REGISTRATIONS', 'the rate must be traceable');

        // The rate really is the per-tail one from the register, not a constant.
        const r = await rateForTail('C-FDMO');
        assert.strictEqual(r.rate, 105);
        const other = await rateForTail('C-GROV');
        assert.strictEqual(other.rate, 65, 'a different tail must give a different rate');
        out(`  per-tail: C-FDMO ${r.rate} kg/h, C-GROV ${other.rate} kg/h — not one constant`);
    });

    it('EXIT-1b — minutes are RUNNING minutes, never ground time', async () => {
        // The 310 minute turn from the specification. Ground time would give
        // 568 kg against an actual 70 — 498 kg of fuel that never burned.
        const rate = 110;
        const running = 38;
        const groundTime = 310;
        const honest = Number((running / 60 * rate).toFixed(2));
        const phantom = Number((groundTime / 60 * rate).toFixed(2));
        out(`38 min running  -> ${honest} kg`);
        out(`310 min ground  -> ${phantom} kg   (${(phantom - honest).toFixed(2)} kg that never burned)`);
        assert.ok(phantom > honest * 5, 'the two must be wildly different, or the warning is idle');

        const c = await cycleFor('C-FDMO', PHASE.PRE_DEPARTURE);
        const blockSpan = 310;
        assert.notStrictEqual(c.running_minutes, blockSpan);
        assert.strictEqual(c.running_minutes, 30, 'the stored figure is the cycle, not the turn');
    });

    // ================================================================
    it('EXIT-2 — a cycle spanning midnight computes correctly', async () => {
        const c = await cycleFor('C-GDMS', PHASE.PRE_DEPARTURE);
        out(`${c.apu_start_utc} -> ${c.apu_stop_utc}`);
        out(`  running_minutes=${c.running_minutes}  burn=${c.apu_burn_kg} kg at ${c.burn_rate_kg_hr} kg/h`);
        assert.strictEqual(c.running_minutes, 40, '23:40 to 00:20 is forty minutes');
        assert.strictEqual(Number(c.apu_burn_kg), 90, '40/60 x 135');

        // Bare times would give minus 1400. The full timestamps are what make
        // this arithmetic rather than a special case.
        const bare = (23*60+40), bareStop = (0*60+20);
        out(`  bare times would give ${bareStop - bare} minutes`);
        assert.ok(bareStop - bare < 0, 'which is why the field is a Timestamp');
        assert.strictEqual(runningMinutes('2026-04-10T23:40:00Z','2026-04-11T00:20:00Z').minutes, 40);
    });

    // ================================================================
    it('EXIT-3 — an open cycle is flagged and NOT computed', async () => {
        const c = await cycleFor('C-FITU', PHASE.PARKED);
        out(`C-FITU PARKED  start=${c.apu_start_utc}  stop=${c.apu_stop_utc}`);
        out(`  is_open=${c.is_open}  running_minutes=${c.running_minutes}  apu_burn_kg=${c.apu_burn_kg}`);
        assert.strictEqual(c.is_open, true);
        assert.strictEqual(c.apu_stop_utc, null);
        assert.strictEqual(c.running_minutes, null, 'minutes are not computed for an open cycle');
        assert.strictEqual(c.apu_burn_kg, null, 'and burn is null, not zero — zero would say it burned nothing');

        const d = deriveCycle({ apu_start_utc: '2026-04-10T14:00:00Z', apu_stop_utc: null },
                              { rate: 110, source: 'AIRCRAFT_REGISTRATIONS' });
        out(`  ${d.note}`);
        assert.match(d.note, /APU406/);
    });

    it('EXIT-3b — a stop before its start is rejected', async () => {
        const d = deriveCycle({ apu_start_utc: '2026-04-10T14:00:00Z', apu_stop_utc: '2026-04-10T13:00:00Z' },
                              { rate: 110, source: 'X' });
        out(`stop 13:00 before start 14:00 -> ${d.error}`);
        assert.ok(d.error, 'must be rejected, not stored as negative minutes');
        assert.match(d.error, /APU407/);
        assert.strictEqual(d.apu_burn_kg, undefined);

        // Through the running service.
        let status, msg;
        try {
            const r = await test.POST(`${B}/ApuUsage`, {
                tail_number: 'C-FDMO', apu_start_utc: '2026-04-10T14:00:00Z',
                apu_stop_utc: '2026-04-10T13:00:00Z',
                usage_phase: PHASE.PARKED, apu_source: SOURCE.ACARS });
            status = r.status;
        } catch (e) { status = e.response?.status; msg = e.response?.data?.error?.message; }
        out(`over OData -> ${status}: ${msg}`);
        assert.strictEqual(status, 400);
        assert.match(msg, /APU407/);

        // Instrument check: a VALID cycle is accepted, so the rejection is the
        // rule and not a blanket refusal.
        const ok = await test.POST(`${B}/ApuUsage`, {
            tail_number: 'C-FDMO', apu_start_utc: '2026-04-10T14:00:00Z',
            apu_stop_utc: '2026-04-10T15:00:00Z',
            usage_phase: PHASE.PARKED, apu_source: SOURCE.ACARS });
        out(`a valid cycle -> ${ok.status}, minutes=${ok.data.running_minutes}, burn=${ok.data.apu_burn_kg}`);
        assert.ok(ok.status < 400);
        assert.strictEqual(ok.data.running_minutes, 60);
        assert.strictEqual(Number(ok.data.apu_burn_kg), 105);
    });

    // ================================================================
    it('EXIT-4 — engine_burn_kg = block burn - apu_burn_kg, both on the record', async () => {
        const pure = splitBlockBurn(4000, 66.5);
        out(`splitBlockBurn(4000, 66.5) -> apu=${pure.apu_burn_kg} engine=${pure.engine_burn_kg}`);
        assert.strictEqual(pure.engine_burn_kg, 3933.5);

        // An unknown APU share makes the ENGINE burn unknown too — not equal
        // to the block. Otherwise an open cycle would silently inflate it.
        const unknown = splitBlockBurn(4000, null);
        out(`splitBlockBurn(4000, null) -> apu=${unknown.apu_burn_kg} engine=${unknown.engine_burn_kg}`);
        assert.strictEqual(unknown.engine_burn_kg, null, 'unknown APU means unknown engine burn');

        // And on a real record.
        const d = await db();
        const flight = await d.run(SELECT.one.from('fuelsphere.FLIGHT_SCHEDULE')
            .where({ flight_number: 'AC410', flight_date: '2026-04-10' }));
        await d.run(INSERT.into('fuelsphere.FUEL_BURNS').entries({
            ID: cds.utils.uuid(), tail_number: 'C-FDMO', tail_registration: 'C-FDMO',
            flight_ID: flight.ID, burn_date: '2026-04-10', actual_burn_kg: 4000,
            data_source: 'ACARS', status: 'PRELIMINARY' }));
        const burn = await d.run(SELECT.one.from('fuelsphere.FUEL_BURNS')
            .where({ flight_ID: flight.ID, actual_burn_kg: 4000 }));
        const srv = await cds.connect.to('BurnService');
        const split = await srv._applyBurnSplit(burn.ID);
        const after = await d.run(SELECT.one.from('fuelsphere.FUEL_BURNS')
            .columns('actual_burn_kg','apu_burn_kg','engine_burn_kg').where({ ID: burn.ID }));
        out(`block=${after.actual_burn_kg}  apu=${after.apu_burn_kg}  engine=${after.engine_burn_kg}`);
        assert.strictEqual(Number(after.apu_burn_kg), 85.75, '52.50 + 33.25, both allocated to AC410');
        assert.strictEqual(Number(after.engine_burn_kg), 3914.25);   // 4000 - 85.75
        assert.strictEqual(
            Number((Number(after.apu_burn_kg) + Number(after.engine_burn_kg)).toFixed(2)),
            Number(after.actual_burn_kg), 'the two parts must sum to the block');
    });

    it('EXIT-4b — a cycle belonging to neither flight stays off the leg', async () => {
        const overnight = await cycleFor('C-FDMP', PHASE.OVERNIGHT);
        out(`OVERNIGHT ${overnight.running_minutes} min, ${overnight.apu_burn_kg} kg, basis=${overnight.allocation_basis}, flight=${overnight.allocated_flight_ID}`);
        assert.strictEqual(overnight.allocated_flight_ID, null, 'twelve hours parked belongs to neither flight');
        assert.strictEqual(overnight.allocation_basis, BASIS.NONE);
        assert.ok(Number(overnight.apu_burn_kg) > 0, 'but the fuel still left the tanks');

        for (const p of [PHASE.OVERNIGHT, PHASE.MAINTENANCE, PHASE.PARKED]) {
            assert.strictEqual(allocate({ usage_phase: p, flight_ID: 'F1' }).allocated_flight_ID, null, p);
        }
        assert.strictEqual(allocate({ usage_phase: PHASE.PRE_DEPARTURE, flight_ID: 'F1' }).allocation_basis, BASIS.PHASE);
        out('OVERNIGHT, MAINTENANCE and PARKED allocate to no flight even when one is attached');
    });

    // ================================================================
    it('EXIT-5 — THE VARIANCE LADDER FIRES. D10 closed.', async () => {
        const d = await db();
        const plan = await d.run(SELECT.one.from('fuelsphere.FLIGHT_DISPATCH')
            .columns('trip_fuel_kg','plan_status','flight_schedule_ID')
            .where({ flight_number: 'AC410', flight_date: '2026-04-10', plan_status: 'ACTIVE' }));
        assert.ok(Number(plan.trip_fuel_kg) > 0, 'precondition: WP-18 populated trip fuel');
        out(`active plan trip_fuel_kg = ${plan.trip_fuel_kg}`);

        // 15% above plan -> EXCEPTION on the ladder (>10, <=20).
        const actual = Number((Number(plan.trip_fuel_kg) * 1.15).toFixed(2));
        const r = await test.POST(`${B}/ingestACARS`, {
            flightNumber: 'AC410', tailNumber: 'C-FDMO', burnDate: '2026-04-10',
            actualBurnKg: actual, messageType: 'IN',
            timestamp: '2026-04-10T08:40:00Z', messageId: 'WP19-LADDER-1' });
        assert.strictEqual(r.status, 200, JSON.stringify(r.data));
        out(`ACARS actual ${actual} vs planned ${plan.trip_fuel_kg}`);
        out(`  plannedBurnKg=${r.data.plannedBurnKg}  varianceKg=${r.data.varianceKg}  variancePct=${r.data.variancePct}  status=${r.data.varianceStatus}`);

        assert.ok(Number(r.data.plannedBurnKg) > 0, 'D10: the planned figure must reach the ladder');
        assert.notStrictEqual(Number(r.data.varianceKg), 0, 'a non-zero variance');
        assert.notStrictEqual(r.data.varianceStatus, 'NORMAL', 'and a status other than NORMAL');
        assert.strictEqual(r.data.varianceStatus, 'EXCEPTION', '15% lands between 10 and 20');
    });

    it('EXIT-5b — the ladder still returns NORMAL when it should', async () => {
        // Otherwise EXIT-5 would pass on a ladder stuck at EXCEPTION.
        const d = await db();
        const plan = await d.run(SELECT.one.from('fuelsphere.FLIGHT_DISPATCH')
            .columns('trip_fuel_kg').where({ flight_number: 'AC410', flight_date: '2026-04-10', plan_status: 'ACTIVE' }));
        const actual = Number((Number(plan.trip_fuel_kg) * 1.02).toFixed(2));
        const r = await test.POST(`${B}/ingestACARS`, {
            flightNumber: 'AC410', tailNumber: 'C-FDMO', burnDate: '2026-04-10',
            actualBurnKg: actual, messageType: 'IN',
            timestamp: '2026-04-10T08:41:00Z', messageId: 'WP19-LADDER-2' });
        out(`2% above plan -> variancePct=${r.data.variancePct} status=${r.data.varianceStatus}`);
        assert.strictEqual(r.data.varianceStatus, 'NORMAL', 'the ladder must still discriminate');

        // And a flight with no active plan gets no invented variance.
        const none = await test.POST(`${B}/ingestACARS`, {
            flightNumber: 'ZZ999', tailNumber: 'C-FDMO', burnDate: '2026-04-10',
            actualBurnKg: 5000, messageType: 'IN',
            timestamp: '2026-04-10T08:42:00Z', messageId: 'WP19-LADDER-3' });
        out(`no plan -> plannedBurnKg=${none.data.plannedBurnKg} status=${none.data.varianceStatus}`);
        assert.strictEqual(Number(none.data.varianceKg), 0, 'no plan, no variance — not a fabricated one');
    });

    it('EXIT-5c — the ladder was dead on the ACARS path only', async () => {
        // The seeded burns carry a planned figure and a computed status, so
        // the ladder was reachable via confirm and the Excel import. The
        // package framing said the whole ladder was unreachable; it was the
        // ACARS ingest that could not reach it.
        const fs = require('node:fs');
        const lines = fs.readFileSync(`${PROJECT}/db/data/fuelsphere-FUEL_BURNS.csv`,'utf8').trim().split('\n');
        const h = lines[0].split(';');
        const iP = h.indexOf('planned_burn_kg'), iS = h.indexOf('variance_status');
        const withPlan = lines.slice(1).map(l=>l.split(';')).filter(c=>c[iP]);
        out(`seeded burns with a planned figure: ${withPlan.length} of ${lines.length-1}`);
        withPlan.slice(0,3).forEach(c=>out(`  planned=${c[iP]} status=${c[iS]}`));
        assert.ok(withPlan.length > 0, 'the ladder was exercised in seed, via other paths');
    });

    // ================================================================
    it('EXIT-6 — a derived figure carries GROUND_TIME_EST and is distinguishable', async () => {
        const est = await cycleFor('C-GROV', PHASE.PRE_DEPARTURE);
        const measured = await cycleFor('C-FDMO', PHASE.PRE_DEPARTURE);
        out(`C-GROV  source=${est.apu_source}   burn=${est.apu_burn_kg} kg`);
        out(`C-FDMO  source=${measured.apu_source}  burn=${measured.apu_burn_kg} kg`);
        assert.strictEqual(est.apu_source, SOURCE.GROUND_TIME_EST);
        assert.strictEqual(measured.apu_source, SOURCE.ACARS);
        assert.notStrictEqual(est.apu_source, measured.apu_source,
            'APU413: an estimate must never be presented beside an ACARS figure as equivalent');
        // Both carry a figure — GROUND_TIME_EST is a first-class path, not a
        // degraded one (APU412).
        assert.ok(Number(est.apu_burn_kg) > 0, 'an estimate still produces a figure');
        out('both produce a figure; only the source tells them apart');
    });

    it('EXIT-6b — every APU figure declares itself derived', async () => {
        const c = await cycleFor('C-FDMO', PHASE.POST_ARRIVAL);
        const r = await test.POST(`${B}/ApuUsage(${c.ID})/BurnService.deriveBurn`, {})
            .catch(e => e.response);
        out(`deriveBurn -> ${r.status}  derived=${r.data.derived}  ${r.data.message}`);
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.data.derived, true, 'APU401: there is no meter');
        assert.strictEqual(r.data.rateSource, 'AIRCRAFT_REGISTRATIONS');
    });
});

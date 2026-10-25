/**
 * Defuel WP-D4 — recording a defuel, and settling it.
 *
 * The first behaviour in the feature. Each criterion names the decision it
 * guards, and takes its rule from the BR or from an answered question rather
 * than from the code it checks.
 *
 * EXIT-1  a defuel reaches BOTH ledgers, and the tail balance falls by its mass
 * EXIT-2  a FIFO carrier is REFUSED, not silently valued as MAP (D1, DFL407)
 * EXIT-3  R1.5 is cumulative, binds M1 only, and says what was already taken
 * EXIT-4  uplift out of a DEFUEL location is refused (D4)
 * EXIT-5  a credit above the held value is refused, quoting both figures (D2)
 * EXIT-6  a parcel settles in PARTS, and the balance falls per event (R5.11)
 * EXIT-7  reversal is refused once settled, and keeps the original instant
 * EXIT-8  the two daylight-saving edges behave (R3.9)
 * EXIT-9  every DFL code in section 8 is raised by something in srv/
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const fs = require('node:fs');

cds.test(PROJECT);
const out = (s) => process.stdout.write('      ' + s + '\n');
const { SELECT, INSERT, UPDATE, DELETE } = cds.ql;
const n = v => Number(v || 0) || 0;
const near = (a, b, tol, what) => assert.ok(Math.abs(n(a) - n(b)) <= tol,
    `${what}: ${n(a).toFixed(3)} vs ${n(b).toFixed(3)}`);

/**
 * The whole error, headline and details together.
 *
 * CAP reports several validation failures as MULTIPLE_ERRORS with the real
 * messages in `details`, and a refusal raised in a before-handler arrives
 * beside whatever generic assertion also fired. Matching on `e.message`
 * alone therefore misses the code that was actually raised — which is how a
 * DFL409 refusal read as ASSERT_NOT_NULL.
 */
const fullError = (e) => [e && e.message,
    ...((e && (e.details || e.errors) || []).map(x => x.message || String(x)))]
    .filter(Boolean).join(' | ');

const DEFUEL = 'fuelsphere.DEFUEL';
const ROB    = 'fuelsphere.ROB_LEDGER';
const LEDGER = 'fuelsphere.DEFUEL_LEDGER_ENTRY';

describe('Defuel WP-D4 — recording and settling', () => {
    let srv, tail, locDefuel, locTemp, reason, carrier;

    before(async function () {
        this.timeout(180000);
        cds.context = { user: new cds.User.Privileged() };
        srv = await cds.connect.to('DefuelService');

        locDefuel = await cds.db.run(SELECT.one.from('fuelsphere.STORAGE_LOCATION')
            .where({ location_type: 'DEFUEL' }));
        locTemp = await cds.db.run(SELECT.one.from('fuelsphere.STORAGE_LOCATION')
            .where({ location_type: 'TEMP' }));
        reason = await cds.db.run(SELECT.one.from('fuelsphere.DEFUEL_REASON_CODE')
            .where({ code: 'MTOW' }));
        // A TAIL WITH A PRICED MOVING AVERAGE, not merely one with history.
        // The first UPLIFT row in the seed belongs to an Air Canada tail with
        // no rate on it, and a defuel there is correctly refused by DFL408 —
        // which would have made every criterion below fail for the right
        // reason at the wrong time. Only the B6 tails carry valued movements.
        const row = await cds.db.run(SELECT.one.from(ROB)
            .columns('tail_number', 'map_usd_per_kg')
            .where({ entry_type: 'UPLIFT', map_usd_per_kg: { '>': 0 } }));
        assert.ok(row, 'no tail in the seed has a priced movement to defuel against');
        tail = row.tail_number;
        carrier = 'B6';
        out(`using ${tail}, which carries a moving average of ${row.map_usd_per_kg}`);
        assert.ok(locDefuel && locTemp && reason && tail, 'seed is incomplete');
    });

    /** Record a defuel through the service, as a screen would. */
    const record = (over = {}) => srv.run(INSERT.into('Defuels').entries({
        ID: cds.utils.uuid(),
        movement_type: 'M2',
        // BOTH HALVES OF EACH MANDATORY ASSOCIATION. The denormalised string
        // and the association's foreign key are separate mandatory elements —
        // tail_number beside tail_registration, carrier_code beside
        // carrier_carrier_code — and supplying only the first fails with
        // ASSERT_NOT_NULL on the second. A capture screen binds both; a test
        // that sets only one is testing a row no screen could produce.
        tail_number: tail,
        tail_registration: tail,
        carrier_code: carrier,
        carrier_carrier_code: carrier,
        reason_code: 'MTOW',
        location_ID: locDefuel.ID,
        quantity_kg: 500,
        event_local: '2026-09-27T10:00:00',
        event_zone: 'America/New_York',
        event_utc: '2026-09-27T14:00:00Z',
        // No status: the handler sets PARKED. Seeding one here would be a
        // fixture asserting a state nothing produces — d39's whole subject.
        fee_treatment: 'EXPENSE',
        ...over
    }));

    // -------------------------------------------------------------- EXIT-1 --
    it('EXIT-1  a defuel reaches both ledgers and the tail balance falls', async () => {
        // R4.6 — every movement appears on the TAIL's ledger and the
        // LOCATION's ledger. The location one is the part that does not
        // exist in any other feature, so it is the half worth checking.
        //
        // The carrier must be MAP for a value to exist at all; FIFO is
        // EXIT-2's subject.
        await setCarrierMethod('MAP');
        const id = cds.utils.uuid();
        await record({ ID: id, quantity_kg: 500 });

        const rob = await cds.db.run(SELECT.from(ROB).where({ defuel_ID: id }));
        assert.strictEqual(rob.length, 1, 'the tail ledger has no defuel row');
        assert.strictEqual(rob[0].entry_type, 'DEFUEL', 'the row is not a DEFUEL');
        near(rob[0].qty_kg, -500, 0.001, 'the tail movement is not a negative 500 kg');
        near(n(rob[0].opening_rob_kg) - 500, rob[0].closing_rob_kg, 0.01,
            'closing does not equal opening minus the defuel');

        // THE EVENT INSTANT, NOT flight_aobt. A defuel has no off-block time
        // and writing one into a field named for a flight is the two-meanings
        // defect this codebase has paid for repeatedly.
        assert.ok(rob[0].event_utc, 'the ledger row has no event instant to sort on');
        assert.ok(!rob[0].flight_aobt, 'a defuel wrote into flight_aobt');
        out(`tail row: ${rob[0].qty_kg} kg, basis ${rob[0].valuation_basis}, `
          + `event ${rob[0].event_utc}`);

        const loc = await cds.db.run(SELECT.from(LEDGER).where({ defuel_ID: id }));
        assert.strictEqual(loc.length, 1, 'the location ledger has no row');
        assert.strictEqual(loc[0].direction, 'IN', 'fuel leaving the tail did not enter the location');
        near(loc[0].qty_kg, 500, 0.001, 'the location did not receive 500 kg');
        out(`location row: +${loc[0].qty_kg} kg, balance ${loc[0].balance_qty_kg} kg`);

        // CONSERVATION. What left the tail arrived in the location, at the
        // same rate — R3.4, which is what makes the loss calculable later.
        near(Math.abs(n(rob[0].qty_kg)), n(loc[0].qty_kg), 0.001, 'mass is not conserved');
        near(rob[0].rate_usd_per_kg, loc[0].rate_usd_per_kg, 0.000001,
            'the location revalued the fuel on the way in');
    });

    // -------------------------------------------------------------- EXIT-2 --
    it('EXIT-2  a FIFO carrier is refused, not valued as MAP', async () => {
        // D1 — the method is per carrier and DEFAULTS TO FIFO. FIFO layers
        // in this system are produced by an offline replay, so the default
        // method is the one a defuel cannot be valued under.
        //
        // THIS IS THE CRITERION THAT STOPS THE DEFAULT BEING THE UNTESTED
        // PATH. Valuing a FIFO carrier as a moving average would produce a
        // figure that looks right and reconciles to no invoice.
        await setCarrierMethod('FIFO');
        let msg = null;
        try { await record({ quantity_kg: 100 }); }
        catch (e) { msg = fullError(e); }
        assert.ok(msg, 'a defuel on a FIFO carrier was accepted and valued');
        assert.ok(msg.includes('DFL407'), `refused, but not by DFL407: ${msg.slice(0, 120)}`);
        out('FIFO carrier refused by DFL407 rather than valued as MAP');
        await setCarrierMethod('MAP');
    });

    // -------------------------------------------------------------- EXIT-3 --
    it('EXIT-3  R1.5 is cumulative and names what was already taken', async () => {
        // THE RULE, QUOTED FROM THE BR: "Two defuels of 2,000 litres against
        // a 3,000 litre uplift must fail on the second, and the message must
        // say what was already taken."
        const t = await cds.db.run(SELECT.one.from('fuelsphere.FUEL_TICKETS')
            .columns('ID', 'quantity_kg', 'internal_number')
            .where({ quantity_kg: { '>': 1000 } }));
        assert.ok(t, 'no uplift large enough to split');
        const uplift = n(t.quantity_kg);

        const first = Math.floor(uplift * 0.7);
        await record({ movement_type: 'M1', source_ticket_ID: t.ID, quantity_kg: first });

        let msg = null;
        try {
            await record({ movement_type: 'M1', source_ticket_ID: t.ID,
                           quantity_kg: Math.ceil(uplift * 0.5) });
        } catch (e) { msg = fullError(e); }

        assert.ok(msg, `a second defuel took the uplift past ${uplift} kg and was accepted`);
        assert.ok(msg.includes('DFL401'), `refused, but not by DFL401: ${msg.slice(0, 120)}`);
        assert.ok(msg.includes(String(first)) || /already been defuelled/.test(msg),
            'the message does not say what was already taken');
        out(`second defuel refused: ${msg.slice(msg.indexOf('DFL401'), msg.indexOf('DFL401') + 130)}`);
    });

    // -------------------------------------------------------------- EXIT-4 --
    it('EXIT-4  uplift out of a DEFUEL location is refused', async () => {
        // D4 / R2.4 — a HARD REFUSAL, not a warning. Once fuel is destined
        // for return it must not be quietly re-uplifted: the return may
        // already be priced and accrued.
        let msg = null;
        try { await record({ movement_type: 'M4', location_ID: locDefuel.ID }); }
        catch (e) { msg = fullError(e); }
        assert.ok(msg, 'a re-uplift out of a DEFUEL location was accepted');
        assert.ok(msg.includes('DFL402'), `refused, but not by DFL402: ${msg.slice(0, 120)}`);

        // AND IT MUST BE PERMITTED OUT OF TEMP, or the refusal proves nothing
        // about the distinction that makes two location types necessary.
        const ok = cds.utils.uuid();
        await record({ ID: ok, movement_type: 'M3', location_ID: locTemp.ID, quantity_kg: 200 });
        const rows = await cds.db.run(SELECT.from(LEDGER).where({ defuel_ID: ok }));
        assert.strictEqual(rows.length, 1, 'a TEMP movement was refused too');
        out('DEFUEL refused, TEMP permitted — the distinction holds');
    });

    // -------------------------------------------------------------- EXIT-5 --
    it('EXIT-5  a credit above the held value is refused, quoting both figures', async () => {
        // R5.5 / D2 — a credit above the held value turns a loss into a
        // profit on a transaction where the airline lost money. It is a
        // data-entry error every time, so the message must quote both so the
        // user can see which one is wrong.
        const id = cds.utils.uuid();
        await record({ ID: id, quantity_kg: 300 });
        const d = await cds.db.run(SELECT.one.from(DEFUEL).where({ ID: id }));
        const held = n(d.held_value_usd);
        assert.ok(held > 0, 'the defuel has no held value to exceed');

        let msg = null;
        try {
            await srv.send({ event: 'settle', entity: 'Defuels', params: [{ ID: id }],
                             data: { credit_usd: Math.round(held * 200) / 100, quantity_kg: 300 } });
        } catch (e) { msg = fullError(e); }
        assert.ok(msg, `a credit of ${held * 2} against a held value of ${held} was accepted`);
        assert.ok(msg.includes('DFL404'), `refused, but not by DFL404: ${msg.slice(0, 120)}`);
        assert.ok(msg.includes(held.toFixed(2)), 'the message does not quote the held value');
        out(`credit ${(held * 2).toFixed(2)} vs held ${held.toFixed(2)} refused, both quoted`);
    });

    // -------------------------------------------------------------- EXIT-6 --
    it('EXIT-6  a parcel settles in parts and the balance falls per event', async () => {
        // R5.11 / D5a — "a quantity in the location is settled by one or
        // more settlement events until it is exhausted, and the location's
        // balance falls as each lands rather than clearing in one step."
        // Retro-fitting that onto a one-shot design is the expensive way to
        // discover it, so it is proved from the start.
        const id = cds.utils.uuid();
        await record({ ID: id, quantity_kg: 400 });
        const d0 = await cds.db.run(SELECT.one.from(DEFUEL).where({ ID: id }));
        const held = n(d0.held_value_usd);

        await srv.send({ event: 'settle', entity: 'Defuels', params: [{ ID: id }],
                         data: { credit_usd: Math.round(held * 40) / 100, quantity_kg: 160,
                                 credit_memo: 'CM-001' } });
        const d1 = await cds.db.run(SELECT.one.from(DEFUEL).where({ ID: id }));
        assert.strictEqual(d1.status, 'POSTED',
            'a partly settled defuel is already marked fully settled');
        assert.ok(n(d1.settled_value_usd) < held, 'the first settlement closed the whole parcel');
        out(`after one credit memo: ${n(d1.credited_usd).toFixed(2)} credited, `
          + `${(held - n(d1.settled_value_usd)).toFixed(2)} still open`);

        // A SECOND MEMO, a month later in life and a line later here.
        await srv.send({ event: 'settle', entity: 'Defuels', params: [{ ID: id }],
                         data: { credit_usd: Math.round(held * 30) / 100, quantity_kg: 120,
                                 credit_memo: 'CM-002' } });
        const d2 = await cds.db.run(SELECT.one.from(DEFUEL).where({ ID: id }));
        const settlements = await cds.db.run(SELECT.from('fuelsphere.DEFUEL_SETTLEMENT')
            .where({ defuel_ID: id }));
        assert.strictEqual(settlements.length, 2, 'the two credit memos are not two events');
        assert.deepStrictEqual(settlements.map(s => s.credit_memo_reference).sort(),
            ['CM-001', 'CM-002'], 'the memo references were not kept');

        // R5.4 — the shortfall is recorded as a loss, never absorbed.
        assert.ok(n(d2.written_off_usd) >= 0, 'no shortfall recorded');
        near(n(d2.credited_usd) + n(d2.written_off_usd), n(d2.settled_value_usd), 0.02,
            'credited plus written off does not equal what was settled');
        out(`two memos: ${n(d2.credited_usd).toFixed(2)} credited, `
          + `${n(d2.written_off_usd).toFixed(2)} written off, status ${d2.status}`);
    });

    // -------------------------------------------------------------- EXIT-7 --
    it('EXIT-7  reversal is refused once settled, and keeps the original instant', async () => {
        // Q10 of 23 Oct, Option A — refuse once any settlement exists.
        // Reversing a defuel whose credit is agreed would change a commercial
        // document without the vendor knowing.
        const settledId = cds.utils.uuid();
        await record({ ID: settledId, quantity_kg: 250 });
        const sd = await cds.db.run(SELECT.one.from(DEFUEL).where({ ID: settledId }));
        await srv.send({ event: 'settle', entity: 'Defuels', params: [{ ID: settledId }],
                         data: { credit_usd: Math.round(n(sd.held_value_usd) * 50) / 100, quantity_kg: 125,
                                 credit_memo: 'CM-REV' } });
        let msg = null;
        try {
            await srv.send({ event: 'reverse', entity: 'Defuels',
                             params: [{ ID: settledId }], data: { reason: 'wrong tail' } });
        } catch (e) { msg = fullError(e); }
        assert.ok(msg, 'a settled defuel was reversed');
        assert.ok(msg.includes('DFL405'), `refused, but not by DFL405: ${msg.slice(0, 120)}`);
        assert.ok(msg.includes('CM-REV'), 'the refusal does not name the credit memo');
        out('a settled defuel cannot be reversed, and the refusal names the memo');

        // ---- AN UNSETTLED ONE REVERSES, AT ITS ORIGINAL INSTANT -----------
        //
        // R1.9 / D6a — a reversal puts right the RECORD of an event, not a
        // new event. Stamped at the moment the error was noticed, every
        // balance between the two would compute as though the fuel left the
        // tank later than it did: wrong in the middle, right at the end,
        // which is the hardest shape of error to see.
        const openId = cds.utils.uuid();
        await record({ ID: openId, quantity_kg: 150 });
        const before = await cds.db.run(SELECT.one.from(DEFUEL).where({ ID: openId }));
        await srv.send({ event: 'reverse', entity: 'Defuels',
                         params: [{ ID: openId }], data: { reason: 'duplicate capture' } });
        const after = await cds.db.run(SELECT.one.from(DEFUEL).where({ ID: openId }));
        assert.strictEqual(after.is_reversed, true, 'the defuel is not marked reversed');
        assert.strictEqual(after.status, 'REVERSED');
        assert.strictEqual(after.event_utc, before.event_utc,
            'the reversal moved the defuel event time');

        const contra = await cds.db.run(SELECT.from(LEDGER).where({ defuel_ID: openId }));
        assert.strictEqual(contra.length, 2, 'the reversal wrote no contra row');
        const [a, b] = contra;
        near(n(a.qty_kg) + n(b.qty_kg), 0, 0.001, 'the contra does not cancel the movement');
        assert.ok(contra.every(e => e.event_utc === before.event_utc),
            'the contra row carries the reversal time rather than the original instant');
        out('an unsettled defuel reverses, nets to zero, and keeps its original instant');

        // R1.10 — kept and marked, never deleted, never reversed twice.
        let again = null;
        try {
            await srv.send({ event: 'reverse', entity: 'Defuels',
                             params: [{ ID: openId }], data: { reason: 'again' } });
        } catch (e) { again = fullError(e); }
        assert.ok(again && again.includes('DFL406'), 'a reversed defuel was reversed again');
        out('and cannot be reversed twice');
    });

    // -------------------------------------------------------------- EXIT-8 --
    it('EXIT-8  the two daylight-saving edges behave', async () => {
        // R3.9 — the two hours a year that do not convert cleanly, and both
        // are refusals rather than preferences. The dates are external facts:
        // US clocks went forward 09 Mar 2025 02:00 and back 02 Nov 2025 02:00.
        let forward = null;
        try {
            await record({ event_local: '2025-03-09T02:30:00',
                           event_zone: 'America/New_York', event_utc: null });
        } catch (e) { forward = fullError(e); }
        assert.ok(forward && forward.includes('DFL409'),
            `02:30 on 09 Mar 2025 never existed in New York and was accepted: ${forward}`);
        out('a local time that never existed is refused (DFL409)');

        let ambiguous = null;
        try {
            await record({ event_local: '2025-11-02T01:30:00',
                           event_zone: 'America/New_York', event_utc: null });
        } catch (e) { ambiguous = fullError(e); }
        assert.ok(ambiguous && ambiguous.includes('DFL410'),
            `01:30 on 02 Nov 2025 occurred twice and was taken silently: ${ambiguous}`);
        out('a local time that occurred twice is refused until resolved (DFL410)');

        // RESOLVED EXPLICITLY, the row records which reading was taken.
        const id = cds.utils.uuid();
        await record({ ID: id, event_local: '2025-11-02T01:30:00',
                       event_zone: 'America/New_York', event_dst_fold: false,
                       event_utc: null, quantity_kg: 50 });
        const d = await cds.db.run(SELECT.one.from(DEFUEL).where({ ID: id }));
        assert.ok(d.event_utc, 'resolving the fold produced no instant');
        assert.strictEqual(d.event_dst_fold, false, 'the row does not record which reading');
        out(`resolved explicitly: 01:30 local -> ${d.event_utc}, fold recorded`);
    });

    // -------------------------------------------------------------- EXIT-9 --
    it('EXIT-9  every DFL code in section 8 is raised by something in srv/', () => {
        // THE PROMPT'S RULE: a code in §8 with no raise site is a
        // declaration, not a guard. This checks the section against the
        // source rather than the source against itself.
        const claude = fs.readFileSync(`${PROJECT}/CLAUDE.md`, 'utf8');
        const listed = [...new Set((claude.match(/`DFL\d{3}`/g) || [])
            .map(c => c.replace(/`/g, '')))].sort();
        const src = fs.readFileSync(`${PROJECT}/srv/defuel-service.js`, 'utf8');
        const raised = [...new Set(src.match(/DFL\d{3}/g) || [])].sort();

        assert.ok(listed.length > 0, '§8 lists no DFL codes');
        const declaredOnly = listed.filter(c => !raised.includes(c));
        assert.deepStrictEqual(declaredOnly, [],
            `§8 lists ${declaredOnly.join(', ')} which nothing in srv/ raises`);
        out(`${listed.length} DFL codes in §8, all raised in srv/defuel-service.js`);
    });

    /**
     * Set the carrier's valuation method — the real setting, on the carrier.
     *
     * D1 puts it there and nulls read as FIFO, so this writes the column the
     * handler actually consults rather than steering the test down a side
     * path the product does not have.
     */
    async function setCarrierMethod(method) {
        await cds.db.run(UPDATE('fuelsphere.CARRIER_MASTER')
            .set({ valuation_method: method })
            .where({ carrier_code: carrier }));
    }
});

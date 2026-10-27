/**
 * Defuel — posting a movement into the valuation ledger.
 *
 * REPLACES defuel-wp-d4-harness, which tested the settlement model that the
 * 26 Oct redesign removed. Each criterion names the decision it guards.
 *
 * EXIT-1  a defuel draws the OLDEST layer first, and writes a pair per layer
 * EXIT-2  stock is MOVED, not created: the two halves cancel in value
 * EXIT-3  the tank holds the batch at the batch's own rate, not an average
 * EXIT-4  MAP is valued too, at the running rate, with no batch
 * EXIT-5  DFL-<station>-YYYYMM-NNNNNN, and it increments per station per month
 * EXIT-6  a defuel larger than the tail is carrying is REFUSED (DFL426)
 * EXIT-7  reversing a defuel puts the stock back where it came from
 * EXIT-8  every DFL code in CLAUDE.md section 8 is raised by something in srv/
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const fs = require('node:fs');

const test = cds.test(PROJECT);
const out = (s) => process.stdout.write('      ' + s + '\n');
const { SELECT } = cds.ql;

const n = (v) => Number(v || 0) || 0;
const r3 = (v) => Math.round(n(v) * 1000) / 1000;
const P = '/odata/v4/defuel/Defuels';

// AFTER THE TAIL'S LAST LAYER. A defuel can only draw from fuel already on
// board, so a date before the uplifts leaves nothing to take - correct
// behaviour, and useless as a fixture.
const DEFUEL_DATE = '2026-12-31';

const MOVEMENTS = 'fuelsphere.FUEL_STOCK_MOVEMENT_LEDGER';
const BALANCES  = 'fuelsphere.FUEL_STOCK_BALANCE';

/**
 * The whole error, headline and details together.
 *
 * CAP reports several validation failures as MULTIPLE_ERRORS with the real
 * messages in `details`. Matching on the headline alone misses the code that
 * was actually raised - which is how a DFL409 refusal once read as
 * ASSERT_NOT_NULL in this very feature.
 */
const fullError = (r) => {
    const e = (r && r.data && r.data.error) || {};
    return [e.message, ...((e.details || []).map((x) => x.message || String(x)))]
        .filter(Boolean).join(' | ');
};

// LITRES FOR A WANTED MASS. The screen takes litres and the ledger values
// kilograms, so a criterion that wants to straddle a layer boundary has to
// say so in litres - at the same weighted gravity the service converts with.
const uomOf = async (tailNumber) => {
    const f = await cds.db.run(SELECT.one.from('fuelsphere.FLIGHT_SCHEDULE')
        .columns('airline_code').where({ aircraft_reg: tailNumber, airline_code: { '!=': null } }));
    if (!f) return 'LTR';
    const c = await cds.db.run(SELECT.one.from('fuelsphere.CARRIER_MASTER')
        .columns('reporting_volume_uom').where({ carrier_code: f.airline_code }));
    return (c && c.reporting_volume_uom) || 'LTR';
};
const PER = { LTR: 1, L: 1, GAL: 3.785411784, USG: 3.785411784, IMP: 4.54609 };

// VOLUME FOR A WANTED MASS, IN THE CARRIER'S OWN UNIT. The screen sends
// gallons for B6 and litres for everyone else, so a criterion that wants to
// straddle a layer boundary has to say so in whatever unit this tail's
// airline reads - otherwise it asks for 3.79 times the fuel it meant.
const volumeFor = async (tailNumber, wantKg) => {
    const litres = await litresFor(tailNumber, wantKg);
    const uom = await uomOf(tailNumber);
    return Math.round((litres / (PER[uom] || 1)) * 100) / 100;
};

const litresFor = async (tailNumber, wantKg) => {
    const ls = await layersOf(tailNumber);
    const top = ls.reduce((a, l) => a + n(l.balance_qty_kg) * n(l.specific_gravity), 0);
    const qty = ls.reduce((a, l) => a + (l.specific_gravity ? n(l.balance_qty_kg) : 0), 0);
    const g = qty > 0 ? top / qty : 0.8;
    return Math.round((wantKg / g) * 100) / 100;
};

const layersOf = (tailNumber) => cds.db.run(SELECT.from(BALANCES)
    .where({ valuation_method: 'FIFO', tail_number: tailNumber,
             storage_location: null, balance_qty_kg: { '>': 0 } })
    .orderBy('flight_aobt', 'flight_date', 'batch_ref'));

describe('Defuel — posting into the valuation ledger', () => {
    let tail, location, startLayers;

    before(async function () {
        this.timeout(180000);
        cds.context = { user: new cds.User.Privileged() };

        // A TAIL WITH AT LEAST TWO LAYERS, so "oldest first" is observable.
        // A tail with one layer would pass EXIT-1 without exercising it.
        const candidates = await cds.db.run(SELECT.from(BALANCES)
            .columns('tail_number', 'batch_ref', 'balance_qty_kg', 'rate_usd_per_kg')
            .where({ valuation_method: 'FIFO', storage_location: null,
                     balance_qty_kg: { '>': 0 } }));
        const byTail = new Map();
        for (const b of candidates) {
            if (!byTail.has(b.tail_number)) byTail.set(b.tail_number, []);
            byTail.get(b.tail_number).push(b);
        }
        for (const [t, rows] of byTail) {
            if (rows.length >= 2 && rows.every((r) => n(r.rate_usd_per_kg) > 0)) { tail = t; break; }
        }
        assert.ok(tail, 'no tail in the seed carries two priced FIFO layers');

        location = await cds.db.run(SELECT.one.from('fuelsphere.STORAGE_LOCATION')
            .where({ is_active: true }));
        assert.ok(location, 'no active storage location is seeded');

        startLayers = await layersOf(tail);
        out(`${tail}: ${startLayers.length} layers, ${r3(startLayers.reduce((s, l) => s + n(l.balance_qty_kg), 0))} kg on hand`);
    });

    // Create a defuel through the draft flow the app itself uses.
    async function createDefuel(over = {}) {
        const draft = await test.POST(P, {
            defuel_type: 'TO_STORAGE',
            source_mode: 'WITHOUT_FLIGHT',
            // AIRCRAFT_REGISTRATIONS is keyed by the registration, so the
            // association's foreign key is tail_registration - there is no
            // generated ID to pass here.
            tail_registration: tail,
            station_code: 'JFK',
            // THE CODE, NOT THE KEY, because that is what the screen sends.
            // The picker binds to location_code so the user sees a tank name
            // instead of a GUID, and the service resolves the key behind it.
            // A harness that posted the key would exercise a path no user
            // takes and miss the resolution entirely.
            location_code: location.code,
            defuel_date: DEFUEL_DATE,
            defuel_time: '14:30:00',
            quantity_vol: 100,
            ...over
        });
        if (draft.status >= 400) return draft;
        const id = draft.data.ID;
        if (draft.data.IsActiveEntity === false) {
            return await test.POST(`${P}(ID=${id},IsActiveEntity=false)/DefuelService.draftActivate`, {})
                .catch((e) => e.response || e);
        }
        return draft;
    }

    const rowsFor = (ref) => cds.db.run(SELECT.from(MOVEMENTS).where({ reference: ref }));

    // ---------------------------------------------------------- EXIT-1 --
    it('EXIT-1  a defuel draws the oldest layer first, one pair of rows per layer', async function () {
        this.timeout(120000);
        const first = (await layersOf(tail))[0];
        // STRADDLE THE FIRST LAYER DELIBERATELY: take all of it and a little
        // of the next, so the draw has to cross a boundary. Expressed in
        // LITRES, because that is what the screen sends - a kilogram figure
        // passed as litres converts to less mass than intended and quietly
        // stops crossing the boundary this criterion exists to test.
        const qty = await volumeFor(tail, n(first.balance_qty_kg) + 50);

        const res = await createDefuel({ quantity_vol: qty });
        assert.ok(res.status < 400, `posting failed: ${fullError(res)}`);
        const ref = res.data.defuel_id;
        assert.ok(ref, 'no defuel_id was stamped');

        const fifo = (await rowsFor(ref)).filter((r) => r.valuation_method === 'FIFO');
        const outRows = fifo.filter((r) => n(r.qty_kg) < 0);
        const inRows  = fifo.filter((r) => n(r.qty_kg) > 0);

        assert.strictEqual(outRows.length, inRows.length,
            'the halves do not pair up - fuel left the wing and did not arrive');
        assert.ok(outRows.length >= 2,
            `a draw of ${qty} kg across a layer boundary produced ${outRows.length} outbound `
          + 'rows - it did not cross into the second layer');

        // OLDEST FIRST. The first layer must be fully drained before the
        // second is touched at all.
        const drained = outRows.find((r) => r.batch_ref === first.batch_ref);
        assert.ok(drained, `the oldest layer ${first.batch_ref} was not touched first`);
        assert.strictEqual(r3(-n(drained.qty_kg)), r3(n(first.balance_qty_kg)),
            'the oldest layer was not drained before the next was drawn on');

        assert.ok(outRows.every((r) => r.tail_number === tail && !r.storage_location),
            'an outbound row names a storage location, or has lost its tail');
        assert.ok(inRows.every((r) => !r.tail_number && r.storage_location === location.code),
            'an inbound row still names a tail, or did not reach the tank');
        out(`${outRows.length} layers drawn, oldest drained first, ${inRows.length} rows into ${location.code}`);
    });

    // ---------------------------------------------------------- EXIT-2 --
    it('EXIT-2  stock is moved, not created: the halves cancel', async function () {
        this.timeout(120000);
        const before = r3((await layersOf(tail)).reduce((s, l) => s + n(l.balance_qty_kg), 0));
        const res = await createDefuel({ quantity_vol: 50 });
        assert.ok(res.status < 400, `posting failed: ${fullError(res)}`);
        const ref = res.data.defuel_id;
        // THE MASS IS DERIVED NOW. Litres are what was entered; kilograms are
        // litres times the gravity of the fuel on the wing, so the harness
        // reads back what the service worked out instead of assuming 50.
        const movedKg = r3(res.data.quantity_kg);
        assert.ok(movedKg > 0, 'no mass was derived from the litres entered');

        const fifo = (await rowsFor(ref)).filter((r) => r.valuation_method === 'FIFO');
        const netQty = r3(fifo.reduce((s, r) => s + n(r.qty_kg), 0));
        const netVal = Math.round(fifo.reduce((s, r) => s + n(r.value_usd), 0) * 100) / 100;

        assert.strictEqual(netQty, 0,
            `a defuel changed total stock by ${netQty} kg - it should only move it`);
        assert.strictEqual(netVal, 0,
            `a defuel changed total value by ${netVal} USD - it should only move it`);

        // And the tail itself is lighter by exactly what was taken.
        const after = r3((await layersOf(tail)).reduce((s, l) => s + n(l.balance_qty_kg), 0));
        assert.strictEqual(r3(before - after), movedKg,
            `the tail fell by ${r3(before - after)} kg, not the ${movedKg} kg defuelled`);
        out(`net 0 kg and 0.00 USD across the pair; tail down exactly ${movedKg} kg `
          + `(50 L at the tail gravity)`);
    });

    // ---------------------------------------------------------- EXIT-3 --
    it('EXIT-3  the tank holds the batch at the batch rate, not a blend', async function () {
        this.timeout(120000);
        const res = await createDefuel({ quantity_vol: 25 });
        assert.ok(res.status < 400, `posting failed: ${fullError(res)}`);
        const inRows = (await rowsFor(res.data.defuel_id))
            .filter((r) => r.valuation_method === 'FIFO' && n(r.qty_kg) > 0);

        for (const r of inRows) {
            assert.ok(r.batch_ref, 'fuel reached the tank with no batch - it lost its identity');
            const layer = await cds.db.run(SELECT.one.from(BALANCES).where({
                valuation_method: 'FIFO', tail_number: tail, batch_ref: r.batch_ref,
                storage_location: null }));
            assert.strictEqual(n(r.rate_usd_per_kg), n(layer.rate_usd_per_kg),
                `the tank priced batch ${r.batch_ref} at ${r.rate_usd_per_kg}, not the `
              + `${layer.rate_usd_per_kg} it was bought at`);

            const held = await cds.db.run(SELECT.one.from(BALANCES).where({
                valuation_method: 'FIFO', storage_location: location.code,
                batch_ref: r.batch_ref, tail_number: null }));
            assert.ok(held, `${location.code} shows no balance for batch ${r.batch_ref}`);
            assert.strictEqual(n(held.rate_usd_per_kg), n(layer.rate_usd_per_kg),
                'the stored balance is not at the batch rate');
        }
        out(`${inRows.length} batch(es) in ${location.code}, each at its own purchase rate`);
    });

    // ---------------------------------------------------------- EXIT-4 --
    it('EXIT-4  MAP is valued too, at the running rate and with no batch', async function () {
        this.timeout(120000);
        const pool = await cds.db.run(SELECT.one.from(BALANCES).where({
            valuation_method: 'MAP', tail_number: tail, storage_location: null }));
        if (!pool) return this.skip();   // a seed gap, not a behaviour to assert

        const rate = n(pool.rate_usd_per_kg);
        const res = await createDefuel({ quantity_vol: 30 });
        assert.ok(res.status < 400, `posting failed: ${fullError(res)}`);

        const map = (await rowsFor(res.data.defuel_id)).filter((r) => r.valuation_method === 'MAP');
        assert.strictEqual(map.length, 2,
            `MAP produced ${map.length} rows, not the pair every other movement writes. `
          + 'Valuing only the FIFO half leaves MAP stock overstated by every defuel.');
        assert.ok(map.every((r) => !r.batch_ref),
            'a MAP row names a batch - the pool has one price, not layers');
        assert.ok(map.every((r) => n(r.rate_usd_per_kg) === rate),
            `a MAP row is not at the running rate ${rate}`);
        assert.strictEqual(r3(map.reduce((s, r) => s + n(r.qty_kg), 0)), 0,
            'the MAP pair does not cancel');
        out(`MAP pair written at the running rate ${rate}, no batch on either row`);
    });

    // ---------------------------------------------------------- EXIT-5 --
    it('EXIT-5  the number is DFL-<station>-YYYYMM-NNNNNN and increments', async function () {
        this.timeout(120000);
        const a = await createDefuel({ quantity_vol: 10, station_code: 'BOS' });
        const b = await createDefuel({ quantity_vol: 10, station_code: 'BOS' });
        assert.ok(a.status < 400 && b.status < 400, 'posting failed');

        // DERIVED FROM THE FIXTURE DATE, not hard-coded: the month is part of
        // the number, so a criterion that pins it breaks whenever the fixture
        // moves - and says the format is wrong when only the date changed.
        const ym = DEFUEL_DATE.slice(0, 4) + DEFUEL_DATE.slice(5, 7);
        const re = new RegExp("^DFL-BOS-" + ym + "-([0-9]{6})$");
        assert.ok(re.test(a.data.defuel_id), `first number is ${a.data.defuel_id}`);
        assert.ok(re.test(b.data.defuel_id), `second number is ${b.data.defuel_id}`);
        assert.strictEqual(
            Number(b.data.defuel_id.match(re)[1]) - Number(a.data.defuel_id.match(re)[1]), 1,
            'the sequence did not advance by one');

        // PER STATION: a different station restarts its own run rather than
        // continuing a shared one.
        const c = await createDefuel({ quantity_vol: 10, station_code: 'LAX' });
        assert.ok(new RegExp(`^DFL-LAX-${ym}-000001$`).test(c.data.defuel_id),
            `a new station started at ${c.data.defuel_id}, not 000001`);
        out(`${a.data.defuel_id} -> ${b.data.defuel_id}, and LAX restarts at ${c.data.defuel_id}`);
    });

    // ---------------------------------------------------------- EXIT-6 --
    it('EXIT-6  a defuel larger than the tail is carrying is refused', async function () {
        this.timeout(120000);
        const onHand = r3((await layersOf(tail)).reduce((s, l) => s + n(l.balance_qty_kg), 0));
        // TWO DECIMALS: quantity_l is Decimal(15,2), and a third is refused by
        // the type before the rule under test is ever reached.
        const res = await createDefuel({ quantity_vol: await volumeFor(tail, onHand + 1000) });

        assert.ok(res.status >= 400, 'a defuel drew more fuel than the aircraft was carrying');
        const msg = fullError(res);
        assert.ok(/DFL426/.test(msg), `refused, but not with DFL426: ${msg}`);
        // THE MESSAGE QUOTES BOTH FIGURES, because "too much" without them
        // sends the user back to the screen to work out by how much.
        assert.ok(msg.includes(String(onHand)), `the refusal does not say what is on board: ${msg}`);
        out(`refused with DFL426, quoting ${onHand} kg on hand`);
    });

    // ---------------------------------------------------------- EXIT-7 --
    it('EXIT-7  reversing puts the stock back where it came from', async function () {
        this.timeout(120000);
        const before = r3((await layersOf(tail)).reduce((s, l) => s + n(l.balance_qty_kg), 0));
        const res = await createDefuel({ quantity_vol: 40 });
        assert.ok(res.status < 400, `posting failed: ${fullError(res)}`);
        const id = res.data.ID;

        const movedKg = r3(res.data.quantity_kg);
        const during = r3((await layersOf(tail)).reduce((s, l) => s + n(l.balance_qty_kg), 0));
        assert.strictEqual(r3(before - during), movedKg,
            `the defuel did not take the derived ${movedKg} kg off`);

        const rev = await test.POST(`${P}(ID=${id},IsActiveEntity=true)/DefuelService.reverse`,
            { reason: 'keyed against the wrong tail' });
        assert.ok(rev.status < 400, `reverse failed: ${fullError(rev)}`);

        const after = r3((await layersOf(tail)).reduce((s, l) => s + n(l.balance_qty_kg), 0));
        assert.strictEqual(after, before,
            `the tail holds ${after} kg after the reversal, not the ${before} it started with`);

        const d = await cds.db.run(SELECT.one.from('fuelsphere.DEFUEL').where({ ID: id }));
        assert.strictEqual(d.status, 'REVERSED', 'the defuel is not marked reversed');
        // KEPT AND MARKED, never deleted: the reversal is part of the record.
        assert.ok(/wrong tail/.test(d.notes || ''), 'the reason was not recorded');
        out(`${movedKg} kg off and back again; defuel marked REVERSED with its reason`);
    });

    // ---------------------------------------------------------- EXIT-9 --
    it('EXIT-9  a defuel is PARKED, and only a supplier one can be posted', async function () {
        this.timeout(120000);
        const res = await createDefuel({ quantity_vol: 20 });
        assert.ok(res.status < 400, `posting failed: ${fullError(res)}`);
        assert.strictEqual(res.data.status, 'PARKED',
            'a new defuel is not PARKED - the fuel has moved but the money has not');

        // A DEFUEL INTO A TANK HAS NO VENDOR TO CLAIM FROM.
        const bad = await test.POST(
            `${P}(ID=${res.data.ID},IsActiveEntity=true)/DefuelService.postToSupplier`,
            { expected_credit_usd: 1 }).catch((e) => e.response || e);
        assert.ok(bad.status >= 400, 'a defuel to storage was posted to a supplier');
        assert.ok(/DFL429/.test(fullError(bad)), `refused, but not with DFL429: ${fullError(bad)}`);
        out(`new defuel is PARKED; posting a storage defuel refused with DFL429`);
    });

    // --------------------------------------------------------- EXIT-10 --
    it('EXIT-10  the credit is typed, the write-off is the difference', async function () {
        this.timeout(120000);
        const res = await createDefuel({ quantity_vol: 30, defuel_type: 'TO_SUPPLIER' });
        assert.ok(res.status < 400, `posting failed: ${fullError(res)}`);
        const id = res.data.ID;
        const original = n(res.data.fuel_value_usd);
        assert.ok(original > 0, 'the defuel has no original value to claim against');

        // A CREDIT ABOVE THE ORIGINAL VALUE WOULD BOOK A PROFIT on fuel
        // handed back, which is a keying error every time.
        const over = await test.POST(`${P}(ID=${id},IsActiveEntity=true)/DefuelService.postToSupplier`,
            { expected_credit_usd: Math.round((original + 100) * 100) / 100 })
            .catch((e) => e.response || e);
        assert.ok(over.status >= 400 && /DFL431/.test(fullError(over)),
            `a credit above the fuel value was accepted: ${fullError(over)}`);

        const credit = Math.round((original * 0.6) * 100) / 100;
        const ok = await test.POST(`${P}(ID=${id},IsActiveEntity=true)/DefuelService.postToSupplier`,
            { expected_credit_usd: credit }).catch((e) => e.response || e);
        assert.ok(ok.status < 400, `posting the credit failed: ${fullError(ok)}`);

        const d = await cds.db.run(SELECT.one.from('fuelsphere.DEFUEL').where({ ID: id }));
        assert.strictEqual(d.status, 'POSTING_PENDING',
            `status is ${d.status} - it must wait on S/4 rather than claim to be posted`);
        assert.strictEqual(Math.round(n(d.write_off_usd) * 100) / 100,
            Math.round((original - credit) * 100) / 100,
            'the write-off is not the original value less the credit');

        // POSTED IS NOT SET BY THIS SYSTEM. Nothing here knows what S/4 did.
        assert.notStrictEqual(d.status, 'POSTED',
            'FuelSphere marked a document POSTED without S/4 having said so');

        // And it cannot be posted twice.
        const again = await test.POST(`${P}(ID=${id},IsActiveEntity=true)/DefuelService.postToSupplier`,
            { expected_credit_usd: credit }).catch((e) => e.response || e);
        assert.ok(again.status >= 400 && /DFL430/.test(fullError(again)),
            `a defuel was posted twice: ${fullError(again)}`);
        out(`original ${original.toFixed(2)}, credit ${credit.toFixed(2)}, `
          + `write-off ${n(d.write_off_usd).toFixed(2)}, status POSTING_PENDING`);
    });

    // --------------------------------------------------------- EXIT-11 --
    it('EXIT-11  a defuel cannot draw from fuel that was not yet on board', async function () {
        this.timeout(120000);
        // THE BUG THIS GUARDS, found on the live system: the balance table is
        // the END STATE of the replay, so "open layers" included batches
        // opened days AFTER the defuel. A defuel on 24 Sep drew from an
        // uplift on 26 Sep - fuel that was not on the aircraft, at a price
        // nobody had paid yet.
        //
        // DATED BEFORE EVERY LAYER, so the bound always bites. An earlier
        // version of this criterion dated the defuel just before the NEWEST
        // layer and skipped whenever fewer than two remained - and by this
        // point the criteria above have drained one, so it never ran at all.
        // A guard that skips guards nothing.
        const earliest = (await cds.db.run(SELECT.one.from(BALANCES)
            .columns('flight_aobt')
            .where({ valuation_method: 'FIFO', tail_number: tail,
                     storage_location: null, flight_aobt: { '!=': null } })
            .orderBy('flight_aobt'))) || {};
        assert.ok(earliest.flight_aobt, 'instrument: no dated layer to reason about');

        const before = new Date(Date.parse(String(earliest.flight_aobt)) - 86400000);
        const res = await createDefuel({
            quantity_vol: 1,
            defuel_date: before.toISOString().slice(0, 10),
            defuel_time: '00:00:01'
        });

        assert.ok(res.status >= 400,
            'a defuel dated before every uplift was accepted - it drew fuel that was not '
          + 'yet on the aircraft');
        const msg = fullError(res);
        assert.ok(/DFL425/.test(msg), `refused, but not with DFL425: ${msg}`);
        // AND THE MESSAGE MUST BE ABOUT DATES, not density. Reporting "no
        // specific gravity" here sent a reader hunting through master data
        // for a problem that is about when the fuel arrived.
        assert.ok(!/DFL428/.test(msg),
            `refused for the wrong reason - DFL428 blames the gravity: ${msg}`);
        out(`a defuel dated before the first uplift is refused with DFL425`);
    });

    // --------------------------------------------------------- EXIT-12 --
    it('EXIT-12  a defuel BEFORE DEPARTURE draws the fuel on board then, and the ledger restates', async function () {
        this.timeout(180000);
        // THE CASE THIS EXISTS FOR (27 Oct 2026): fuel tankered for the next
        // leg comes off before departure because a late load takes the
        // aircraft over MTOW. Before, every such defuel was refused - the
        // draw read the END of the history, where the next burn had already
        // used the fuel.
        //
        // THE EXPECTATIONS ARE READ FROM THE SEEDED LEDGER, not computed by
        // the code under test: N4048J opens at 3,754.07 kg, takes uplift
        // SHL-BOS-696789 at 01:45:57 on 23 Sep and burns at 02:20. A defuel
        // at 02:00 sits between them, draws FIFO from the opening layer, and
        // every balance after it falls by exactly what came off.
        const TAIL = 'N4048J', DAY = '2026-09-23';
        const LEDGER = 'fuelsphere.ROB_LEDGER';
        const rows0 = await cds.db.run(SELECT.from(LEDGER).where({ tail_number: TAIL }));
        const day0 = rows0.filter((r) => String(r.record_date) === DAY);
        const uplift = day0.find((r) => r.entry_type === 'UPLIFT');
        const burn = day0.find((r) => r.entry_type === 'BURN');
        assert.ok(uplift && burn && String(uplift.record_time) < '02:00:00' && String(burn.record_time) > '02:00:00',
            'instrument: the seeded uplift and burn no longer bracket 02:00 on 23 Sep');
        const lastOf = (rows) => rows.slice().sort((a, b) =>
            String(a.record_date).localeCompare(String(b.record_date)) || n(a.sequence) - n(b.sequence)).pop();
        const endBefore = n(lastOf(rows0).closing_rob_kg);
        const burnBefore = n(burn.closing_rob_kg);
        const fifoBefore = r3((await layersOf(TAIL)).reduce((s, l) => s + n(l.balance_qty_kg), 0));
        const opening = await cds.db.run(SELECT.one.from(BALANCES)
            .where({ valuation_method: 'FIFO', tail_number: TAIL, batch_ref: `OPENING-${TAIL}` }));

        // 300 USG - B6 reads in US gallons - is about 910 kg. The seed's own
        // scenario 11A defuel already took 1,835 kg of the 3,754 kg opening
        // layer at 01:46, so about 1,919 kg of it is left at 02:00: FIFO must
        // take all of this one from there.
        const res = await createDefuel({
            tail_registration: TAIL, station_code: 'BOS', location_code: 'BOS-DEFUEL',
            defuel_type: 'TO_SUPPLIER', defuel_date: DAY, defuel_time: '02:00:00', quantity_vol: 300
        });
        assert.ok(res.status < 400, `the pre-departure defuel was refused: ${fullError(res)}`);
        const q = r3(res.data.quantity_kg), ref = res.data.defuel_id;
        out(`${TAIL} ${DAY} 02:00: ${q} kg off, between the 01:45 uplift and the 02:20 burn`);

        // ---- the tail's ledger knows ----------------------------------
        const rows1 = await cds.db.run(SELECT.from(LEDGER).where({ tail_number: TAIL }));
        const dfl = rows1.find((r) => r.defuel_ID === res.data.ID);
        assert.ok(dfl && dfl.entry_type === 'DEFUEL', 'no DEFUEL row reached ROB_LEDGER');
        const burn1 = rows1.find((r) => r.ID === burn.ID), up1 = rows1.find((r) => r.ID === uplift.ID);
        assert.ok(n(up1.sequence) < n(dfl.sequence) && n(dfl.sequence) < n(burn1.sequence),
            'the defuel is not between the uplift and the burn');
        // ROB_LEDGER KEEPS KILOGRAMS TO TWO PLACES and the valuation to three,
        // so the ledger moves by the quantity rounded to 0.01 kg.
        const near = (a, b) => Math.abs(a - b) <= 0.005;
        assert.ok(near(burnBefore - n(burn1.closing_rob_kg), q),
            `the burn after the defuel still closes as though the fuel were on board `
          + `(${burnBefore} -> ${burn1.closing_rob_kg}, defuel ${q})`);
        assert.ok(near(endBefore - n(lastOf(rows1).closing_rob_kg), q),
            'the tail ends the history still carrying the defuelled fuel');

        // ---- the valuation knows --------------------------------------
        const outRows = (await cds.db.run(SELECT.from(MOVEMENTS).where({ reference: ref })))
            .filter((m) => m.valuation_method === 'FIFO' && n(m.qty_kg) < 0);
        assert.deepStrictEqual([...new Set(outRows.map((m) => m.batch_ref))], [`OPENING-${TAIL}`],
            'FIFO did not take the defuel from the oldest layer on board at 02:00');
        assert.strictEqual(n(outRows[0].rate_usd_per_kg), n(opening.rate_usd_per_kg),
            'the defuel is not valued at the opening layer\'s own rate');
        // THE DOCUMENT AND ITS LEDGER ROWS AGREE ON WHAT THE FUEL WAS WORTH.
        // They come by two routes - the draw prices the document, the replay
        // writes the rows - so a draw that read the wrong layers (the end of
        // the history, as it did) prices the document at another batch's rate.
        const rowsValue = Math.round(-outRows.reduce((s, m) => s + n(m.value_usd), 0) * 100) / 100;
        assert.strictEqual(n(res.data.fuel_value_usd), rowsValue,
            `the defuel is worth ${res.data.fuel_value_usd} on its document and ${rowsValue} on its ledger rows`);
        const fifoAfter = r3((await layersOf(TAIL)).reduce((s, l) => s + n(l.balance_qty_kg), 0));
        assert.strictEqual(r3(fifoBefore - fifoAfter), q,
            'the tail\'s FIFO stock did not fall by what came off');

        // ---- and a reversal undoes all of it --------------------------
        const rev = await test.POST(`${P}(ID=${res.data.ID},IsActiveEntity=true)/DefuelService.reverse`,
            { reason: 'EXIT-12' });
        assert.ok(rev.status < 400, `reverse failed: ${fullError(rev)}`);
        const rows2 = await cds.db.run(SELECT.from(LEDGER).where({ tail_number: TAIL }));
        assert.strictEqual(r3(lastOf(rows2).closing_rob_kg), r3(endBefore), 'ROB did not come back');
        assert.strictEqual(r3((await layersOf(TAIL)).reduce((s, l) => s + n(l.balance_qty_kg), 0)), fifoBefore,
            'FIFO stock did not come back');
        out(`ROB end ${endBefore} -> ${r3(endBefore - q)} -> ${r3(lastOf(rows2).closing_rob_kg)}; FIFO likewise`);
    });

    // --------------------------------------------------------- EXIT-13 --
    it('EXIT-13  a back-dated defuel cannot take fuel the aircraft went on to use', async function () {
        this.timeout(120000);
        // On board at 02:00 is far more than this defuel; what it may NOT do
        // is leave a LATER balance below zero. The threshold is the lowest
        // closing balance the seeded ledger carries after 02:00 on 23 Sep.
        const TAIL = 'N4048J', DAY = '2026-09-23';
        const rows = await cds.db.run(SELECT.from('fuelsphere.ROB_LEDGER').where({ tail_number: TAIL }));
        const after = rows.filter((r) => String(r.record_date) > DAY
            || (String(r.record_date) === DAY && String(r.record_time) > '02:00:00'));
        const low = Math.min(...after.map((r) => n(r.closing_rob_kg)));
        assert.ok(low > 0 && low < 10000, `instrument: the later low is ${low} kg`);
        // 1.25 x the later low, in US gallons at about 0.8 kg/L.
        const vol = Math.round((low * 1.25 / 0.8) / 3.785411784);
        const res = await createDefuel({
            tail_registration: TAIL, station_code: 'BOS', location_code: 'BOS-DEFUEL',
            defuel_type: 'TO_SUPPLIER', defuel_date: DAY, defuel_time: '02:00:00', quantity_vol: vol
        });
        assert.ok(res.status >= 400, `a defuel larger than the later low (${low} kg) was accepted`);
        const msg = fullError(res);
        assert.ok(/DFL432/.test(msg), `refused, but not with DFL432: ${msg}`);
        out(`${vol} USG at 02:00 refused with DFL432 - the tail later falls to ${low} kg`);
    });

    // ---------------------------------------------------------- EXIT-8 --
    it('EXIT-8  every DFL code in section 8 is raised by something in srv/', () => {
        const md = fs.readFileSync(`${PROJECT}/CLAUDE.md`, 'utf8');
        const section = md.slice(md.indexOf('### Defuel —'));
        const listed = [...new Set(
            (section.slice(0, section.indexOf('### ', 10)).match(/`(DFL\d{3})`/g) || [])
                .map((m) => m.replace(/`/g, '')))];
        assert.ok(listed.length > 0, 'no DFL codes are listed at all');

        // COMMENTS ARE STRIPPED BEFORE SCANNING, and that is the point of
        // the check rather than a convenience. A retired code gets explained
        // in a comment - "this REVERSES DFL407" - and a scan that counted
        // that as a raise site would report a code as live because somebody
        // documented removing it. Only what can execute counts.
        //
        // Block comments, then whole-line // comments. A trailing // is left
        // alone deliberately: stripping it would mangle a URL or a string.
        const srv = fs.readdirSync(`${PROJECT}/srv`)
            .filter((f) => f.endsWith('.js'))
            .map((f) => fs.readFileSync(`${PROJECT}/srv/${f}`, 'utf8'))
            .join('\n')
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/^[ \t]*\/\/.*$/gm, ' ');

        const orphans = listed.filter((c) => !srv.includes(c));
        assert.deepStrictEqual(orphans, [],
            `section 8 lists ${orphans.join(', ')} which nothing in srv/ raises`);

        // AND THE OTHER WAY: a code that fires but is not registered is an
        // error message nobody can look up.
        const raised = [...new Set((srv.match(/DFL\d{3}/g) || []))];
        const unlisted = raised.filter((c) => !listed.includes(c));
        assert.deepStrictEqual(unlisted, [],
            `srv/ raises ${unlisted.join(', ')} which section 8 does not list`);
        out(`${listed.length} codes listed, all raised, none unregistered`);
    });
});

/**
 * An uplift drawn from a storage location — the mirror of a defuel.
 *
 * EXIT-1  the tank falls and the tail rises by the same mass
 * EXIT-2  the fuel keeps its BATCH and its RATE: it was never re-purchased
 * EXIT-3  a DEFUEL tank is refused — that fuel is staged for the vendor
 * EXIT-4  a tank cannot give out more than it holds
 * EXIT-5  every TKT code in CLAUDE.md is raised by something in srv/
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
const { SELECT, INSERT } = cds.ql;

const n = (v) => Number(v || 0) || 0;
const r3 = (v) => Math.round(n(v) * 1000) / 1000;
const BALANCES = 'fuelsphere.FUEL_STOCK_BALANCE';
const MOVEMENTS = 'fuelsphere.FUEL_STOCK_MOVEMENT_LEDGER';

const { postStorageUplift } = require(`${PROJECT}/srv/lib/storage-uplift.js`);

const heldIn = async (code) => r3((await cds.db.run(SELECT.from(BALANCES)
    .where({ valuation_method: 'FIFO', storage_location: code, balance_qty_kg: { '>': 0 } })))
    .reduce((s, l) => s + n(l.balance_qty_kg), 0));

const heldOn = async (tail) => r3((await cds.db.run(SELECT.from(BALANCES)
    .where({ valuation_method: 'FIFO', tail_number: tail, storage_location: null,
             balance_qty_kg: { '>': 0 } })))
    .reduce((s, l) => s + n(l.balance_qty_kg), 0));

describe('Uplift from a storage location', () => {
    let tempCode, defuelCode, tail, seeded = false;

    before(async function () {
        this.timeout(180000);
        cds.context = { user: new cds.User.Privileged() };

        const temp = await cds.db.run(SELECT.one.from('fuelsphere.STORAGE_LOCATION')
            .where({ location_type: 'TEMP', is_active: true }));
        const dfl = await cds.db.run(SELECT.one.from('fuelsphere.STORAGE_LOCATION')
            .where({ location_type: 'DEFUEL', is_active: true }));
        assert.ok(temp && dfl, 'the seed carries no TEMP and DEFUEL pair to test with');
        tempCode = temp.code; defuelCode = dfl.code;

        const anyTail = await cds.db.run(SELECT.one.from(BALANCES)
            .where({ valuation_method: 'FIFO', storage_location: null,
                     tail_number: { '!=': null }, balance_qty_kg: { '>': 0 } }));
        tail = anyTail.tail_number;

        // PUT FUEL IN THE TANK FIRST. A storage uplift needs stock to draw,
        // and the seeded tanks may hold none - the point of this harness is
        // the arithmetic on the way out, not whether a defuel ran earlier.
        if ((await heldIn(tempCode)) <= 0) {
            const now = new Date().toISOString();
            await cds.db.run(INSERT.into(BALANCES).entries([{
                ID: cds.utils.uuid(), valuation_method: 'FIFO',
                tail_number: null, storage_location: tempCode,
                batch_ref: 'HARNESS-BATCH-1', carrier_code: 'B6', line_type: 'DEFUEL',
                balance_qty_kg: 500, specific_gravity: 0.8, rate_usd_per_kg: 1.5,
                value_usd: 750, created_at: now, created_by: 'HARNESS',
                modified_at: now, modified_by: 'HARNESS'
            }]));
            seeded = true;
        }
        out(`${tempCode} holds ${await heldIn(tempCode)} kg; uplifting onto ${tail}`);
    });

    const ticket = (over = {}) => ({
        ticket_number: 'HARNESS-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
        uplift_source: 'STORAGE',
        storage_location_code: tempCode,
        aircraft_reg: tail,
        quantity_kg: 100,
        carrier_code: 'B6',
        delivery_timestamp: '2026-12-31T12:00:00Z',
        ...over
    });

    // ---------------------------------------------------------- EXIT-1 --
    it('EXIT-1  the tank falls and the tail rises by the same mass', async function () {
        this.timeout(120000);
        const tankBefore = await heldIn(tempCode);
        const tailBefore = await heldOn(tail);

        const t = ticket({ quantity_kg: 100 });
        const res = await postStorageUplift(cds.db, t);
        assert.ok(res && res.ok, `posting failed: ${res && res.error}`);

        const tankAfter = await heldIn(tempCode);
        const tailAfter = await heldOn(tail);

        assert.strictEqual(r3(tankBefore - tankAfter), 100,
            `the tank fell by ${r3(tankBefore - tankAfter)} kg, not the 100 uplifted`);
        assert.strictEqual(r3(tailAfter - tailBefore), 100,
            `the tail rose by ${r3(tailAfter - tailBefore)} kg, not the 100 uplifted`);

        // STOCK MOVED, IT WAS NOT CREATED: the pair cancels.
        const rows = (await cds.db.run(SELECT.from(MOVEMENTS)
            .where({ reference: t.ticket_number, valuation_method: 'FIFO' })));
        assert.strictEqual(r3(rows.reduce((s, r) => s + n(r.qty_kg), 0)), 0,
            'the uplift changed total stock rather than moving it');
        out(`tank -100, tail +100, ${rows.length} rows netting to zero`);
    });

    // ---------------------------------------------------------- EXIT-2 --
    it('EXIT-2  the fuel keeps its batch and its rate', async function () {
        this.timeout(120000);
        const before = await cds.db.run(SELECT.from(BALANCES)
            .where({ valuation_method: 'FIFO', storage_location: tempCode,
                     balance_qty_kg: { '>': 0 } })
            .orderBy('flight_aobt', 'flight_date', 'batch_ref'));
        const oldest = before[0];

        const t = ticket({ quantity_kg: 25 });
        const res = await postStorageUplift(cds.db, t);
        assert.ok(res && res.ok, `posting failed: ${res && res.error}`);

        const inRows = (await cds.db.run(SELECT.from(MOVEMENTS)
            .where({ reference: t.ticket_number, valuation_method: 'FIFO' })))
            .filter((r) => n(r.qty_kg) > 0);

        for (const r of inRows) {
            assert.ok(r.batch_ref, 'fuel reached the wing with no batch - it lost its identity');
            // THE WHOLE POINT OF STORING A BATCH: fuel bought at one price and
            // held for a week is still fuel bought at that price. Valuing it
            // at today's rate on the way out invents a gain nobody earned.
            const layer = before.find((l) => l.batch_ref === r.batch_ref);
            assert.ok(layer, `batch ${r.batch_ref} was not in the tank beforehand`);
            assert.strictEqual(n(r.rate_usd_per_kg), n(layer.rate_usd_per_kg),
                `uplifted batch ${r.batch_ref} at ${r.rate_usd_per_kg}, not the `
              + `${layer.rate_usd_per_kg} it entered the tank at`);
        }
        assert.strictEqual(inRows[0].batch_ref, oldest.batch_ref,
            'the oldest parcel in the tank was not the one taken first');
        out(`${inRows.length} batch(es) onto the wing, each at the rate it was bought at`);
    });

    // ---------------------------------------------------------- EXIT-3 --
    it('EXIT-3  a DEFUEL tank is refused', async function () {
        this.timeout(120000);
        const res = await postStorageUplift(cds.db, ticket({ storage_location_code: defuelCode }));
        assert.ok(res && res.error, `${defuelCode} was uplifted from - its fuel is staged for return`);
        assert.ok(/TKT444/.test(res.error), `refused, but not with TKT444: ${res.error}`);
        out(`${defuelCode} refused with TKT444`);
    });

    // ---------------------------------------------------------- EXIT-4 --
    it('EXIT-4  a tank cannot give out more than it holds', async function () {
        this.timeout(120000);
        const held = await heldIn(tempCode);
        const res = await postStorageUplift(cds.db, ticket({ quantity_kg: r3(held + 1000) }));
        assert.ok(res && res.error, 'a tank gave out fuel it did not hold');
        assert.ok(/TKT445/.test(res.error), `refused, but not with TKT445: ${res.error}`);
        assert.ok(res.error.includes(String(held)),
            `the refusal does not say what the tank holds: ${res.error}`);
        out(`refused with TKT445, quoting ${held} kg on hand`);
    });

    // ---------------------------------------------------------- EXIT-5 --
    it('EXIT-5  every TKT code in CLAUDE.md is raised by something in srv/', () => {
        const md = fs.readFileSync(`${PROJECT}/CLAUDE.md`, 'utf8');
        const start = md.indexOf('### Fuel ticket — `TKT4xx`');
        assert.ok(start > 0, 'the TKT prefix is not registered in section 8');
        const section = md.slice(start, md.indexOf('### ', start + 10));
        const listed = [...new Set((section.match(/`(TKT\d{3})`/g) || []).map((m) => m.replace(/`/g, '')))];
        assert.ok(listed.length > 0, 'no TKT codes are listed');

        // COMMENTS STRIPPED: a code explained in prose is not a code that fires.
        const srv = []
            .concat(fs.readdirSync(`${PROJECT}/srv`).filter((f) => f.endsWith('.js'))
                .map((f) => `${PROJECT}/srv/${f}`))
            .concat(fs.readdirSync(`${PROJECT}/srv/lib`).filter((f) => f.endsWith('.js'))
                .map((f) => `${PROJECT}/srv/lib/${f}`))
            .map((f) => fs.readFileSync(f, 'utf8')).join('\n')
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/^[ \t]*\/\/.*$/gm, ' ');

        const orphans = listed.filter((c) => !srv.includes(c));
        assert.deepStrictEqual(orphans, [],
            `section 8 lists ${orphans.join(', ')} which nothing in srv/ raises`);
        const raised = [...new Set(srv.match(/TKT\d{3}/g) || [])];
        const unlisted = raised.filter((c) => !listed.includes(c));
        assert.deepStrictEqual(unlisted, [],
            `srv/ raises ${unlisted.join(', ')} which section 8 does not list`);
        out(`${listed.length} TKT codes listed, all raised, none unregistered`);
    });
});

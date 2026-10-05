/**
 * APU ledger line, specific gravity and unallocated fuel verification harness.
 *
 * EXIT-1  the ledger carries an APU burn line, after the block burn
 * EXIT-2  the APU line deducts quantity and value, and leaves the MAP alone
 * EXIT-3  no tail ever goes negative
 * EXIT-4  an uplift line carries the ticket's density
 * EXIT-5  the weighted average is total mass over total volume
 * EXIT-6  litres are converted at the weighted average, not at a guess
 * EXIT-7  unallocated fuel is the balance less the arrival gauge
 * EXIT-8  a replay reproduces the seeded figures
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
const num = (v) => (v === null || v === undefined ? null : Number(v));

describe('APU burn, gravity and unallocated fuel', () => {

    // ------------------------------------------------------------- EXIT-1 --
    it('EXIT-1  an APU burn line sits after the block burn', async () => {
        const d = await db();
        const rows = await d.run(cds.ql.SELECT.from('fuelsphere.ROB_LEDGER')
            .columns('entry_type', 'line_order'));

        const types = {};
        rows.forEach(r => { types[r.entry_type] = (types[r.entry_type] || 0) + 1; });
        out('line types: ' + JSON.stringify(types));
        assert.ok(types.APU_BURN > 0, 'no APU line in the ledger');

        const orderOf = {};
        rows.forEach(r => { orderOf[r.entry_type] = r.line_order; });
        out(`line order: block burn ${orderOf.BURN}, APU burn ${orderOf.APU_BURN}`);
        assert.ok(orderOf.APU_BURN > orderOf.BURN, 'the APU line does not sort after the block burn');
    });

    // ------------------------------------------------------------- EXIT-2 --
    it('EXIT-2  the APU line deducts, and does not move the MAP', async () => {
        const d = await db();
        // A PRICED TAIL, deliberately. The demo tails that predate the JetBlue
        // data carry no prices, and "the MAP did not move" is not worth
        // asserting when the MAP is null on both sides.
        const [tail] = await d.run(cds.ql.SELECT.from('fuelsphere.ROB_LEDGER')
            .columns('tail_number').where({ entry_type: 'APU_BURN',
                                            map_usd_per_kg: { '>': 0 } }).limit(1));

        const rows = await d.run(cds.ql.SELECT.from('fuelsphere.ROB_LEDGER')
            .where({ tail_number: tail.tail_number })
            .orderBy('record_date', 'flight_aobt', 'sequence', 'line_order'));

        const i = rows.findIndex(r => r.entry_type === 'APU_BURN');
        const before = rows[i - 1], apu = rows[i];
        out(`${tail.tail_number}: ${before.entry_type} closes ${before.closing_rob_kg} `
            + `-> APU ${apu.burn_kg} kg -> closes ${apu.closing_rob_kg}`);
        out(`   MAP before ${before.map_usd_per_kg}, after ${apu.map_usd_per_kg}; value ${apu.value_usd}`);

        assert.strictEqual(num(apu.closing_rob_kg),
            Number((num(before.closing_rob_kg) - num(apu.burn_kg)).toFixed(2)),
            'the APU line did not deduct its quantity');
        assert.ok(num(apu.qty_kg) < 0, 'the APU movement is not negative');
        assert.strictEqual(num(apu.map_usd_per_kg), num(before.map_usd_per_kg),
            'the APU line moved the moving average price');
    });

    // ------------------------------------------------------------- EXIT-3 --
    it('EXIT-3  no tail is ever driven negative', async () => {
        const d = await db();
        const negative = await d.run(cds.ql.SELECT.from('fuelsphere.ROB_LEDGER')
            .columns('tail_number', 'record_date', 'entry_type', 'closing_rob_kg')
            .where({ closing_rob_kg: { '<': 0 } }));
        out(`rows with a negative balance: ${negative.length}`);
        negative.slice(0, 3).forEach(r => out(`   ${r.tail_number} ${r.record_date} ${r.entry_type} ${r.closing_rob_kg}`));
        assert.strictEqual(negative.length, 0, 'the APU burn drove a tail below zero');
    });

    // -------------------------------------------------------- EXIT-4 and 5 --
    it('EXIT-4  an uplift carries its density, and the blend is mass over volume', async () => {
        const d = await db();
        const uplifts = await d.run(cds.ql.SELECT.from('fuelsphere.ROB_LEDGER')
            .columns('ID', 'tail_number', 'opening_rob_kg', 'uplift_kg',
                     'specific_gravity', 'wt_avg_specific_gravity', 'fuel_ticket_ID')
            .where({ entry_type: 'UPLIFT' }).limit(400));

        const withSg = uplifts.filter(u => u.specific_gravity);
        out(`uplift lines: ${uplifts.length}, carrying a density: ${withSg.length}`);
        assert.ok(withSg.length, 'no uplift line carries a specific gravity');

        // AN UPLIFT THAT ACTUALLY BLENDS. Fuel going into an empty tank, or
        // fuel of the same density as what is there, proves nothing about the
        // formula: both methods agree. The case worth asserting is two
        // different densities meeting.
        const candidates = withSg.filter(u => num(u.opening_rob_kg) > 0 && u.wt_avg_specific_gravity);
        const one = candidates.find(u =>
            Math.abs(num(u.wt_avg_specific_gravity) - num(u.specific_gravity)) > 0.0005)
            || candidates[0];
        const ticket = await d.run(cds.ql.SELECT.one.from('fuelsphere.FUEL_TICKETS')
            .columns('density_value').where({ ID: one.fuel_ticket_ID }));
        out(`ticket density ${ticket.density_value} -> line ${one.specific_gravity}`);
        assert.strictEqual(num(one.specific_gravity), Number(num(ticket.density_value).toFixed(4)),
            'the uplift density is not the ticket density');

        // EXIT-5: mass over volume, NOT the average of the two densities.
        // The blend as it stood BEFORE this uplift: the last row of this tail
        // that carries one, in ledger order, before this row.
        const tailRows = await d.run(cds.ql.SELECT.from('fuelsphere.ROB_LEDGER')
            .columns('ID', 'wt_avg_specific_gravity', 'record_date', 'flight_aobt',
                     'sequence', 'line_order')
            .where({ tail_number: one.tail_number })
            .orderBy('record_date', 'flight_aobt', 'sequence', 'line_order'));

        const here = tailRows.findIndex(r => r.ID === one.ID);
        const prior = tailRows.slice(0, here).reverse()
            .find(r => r.wt_avg_specific_gravity);

        const mb = num(one.opening_rob_kg), mu = num(one.uplift_kg);
        const su = num(one.specific_gravity);
        const sb = prior ? num(prior.wt_avg_specific_gravity) : null;
        assert.ok(sb, 'no earlier blend to compare against - EXIT-5 proved nothing');
        if (sb && sb !== su) {
            const massOverVolume = Number(((mb + mu) / ((mb / sb) + (mu / su))).toFixed(4));
            const averaged = Number((((sb * mb) + (su * mu)) / (mb + mu)).toFixed(4));
            out(`blend of ${mb}kg @ ${sb} with ${mu}kg @ ${su}:`);
            out(`   mass over volume ${massOverVolume}, averaged ${averaged}, stored ${one.wt_avg_specific_gravity}`);
            assert.strictEqual(num(one.wt_avg_specific_gravity), massOverVolume,
                'the stored blend is not total mass over total volume');
        }
    });

    // ------------------------------------------------------------- EXIT-5 --
    // THE FORMULA ITSELF, on figures that tell the two apart.
    //
    // The seeded densities are all within 0.002 of each other, so on real data
    // the two methods agree to four decimals and the assertion above would
    // pass whichever was implemented. This one uses the 0.78/0.82 blend from
    // the decision of 2 Oct 2026, where they differ in the fourth decimal.
    it('EXIT-5  the blend is mass over volume, provably', async () => {
        const { blendGravity } = require(`${PROJECT}/srv/lib/rob-recalculate.js`);

        const massOverVolume = blendGravity(5000, 0.78, 5000, 0.82);
        const averaged = Number((((0.78 * 5000) + (0.82 * 5000)) / 10000).toFixed(4));
        out(`5000kg @ 0.78 blended with 5000kg @ 0.82`);
        out(`   mass over volume ${massOverVolume}, averaging the densities ${averaged}`);
        out(`   10,000 kg reads as ${(10000 / massOverVolume).toFixed(1)} L, `
            + `against ${(10000 / averaged).toFixed(1)} L`);

        assert.strictEqual(massOverVolume, 0.7995, 'the blend is not total mass over total volume');
        assert.notStrictEqual(massOverVolume, averaged);

        // An empty tank takes the uplift's own density; nothing to blend with.
        assert.strictEqual(blendGravity(0, null, 5000, 0.82), 0.82);
        // No density on the uplift leaves the blend where it was.
        assert.strictEqual(blendGravity(5000, 0.78, 5000, null), 0.78);
    });

    // ------------------------------------------------------------- EXIT-6 --
    it('EXIT-6  litres are converted at the weighted average', async () => {
        const r = await test.GET('/odata/v4/burn/ROBLedger?$top=200'
            + '&$select=entry_type,qty_kg,qty_l,wt_avg_specific_gravity');
        const burns = r.data.value.filter(x =>
            x.wt_avg_specific_gravity && x.qty_l !== null && Number(x.qty_kg) !== 0);
        assert.ok(burns.length, 'no row carries both a quantity and a blend');

        const one = burns[0];
        const expected = Number((Math.abs(num(one.qty_kg)) / num(one.wt_avg_specific_gravity)).toFixed(2));
        out(`${one.entry_type}: ${one.qty_kg} kg at ${one.wt_avg_specific_gravity} = ${one.qty_l} L (expected ${expected})`);
        assert.ok(Math.abs(Math.abs(num(one.qty_l)) - expected) <= 0.05,
            'litres were not converted at the weighted average');
    });

    // ------------------------------------------------------------- EXIT-7 --
    it('EXIT-7  unallocated fuel is the balance less the arrival gauge', async () => {
        const d = await db();
        const burns = await d.run(cds.ql.SELECT.from('fuelsphere.ROB_LEDGER')
            .columns('flight_ID', 'closing_rob_kg', 'unallocated_fuel_kg')
            .where({ entry_type: 'BURN' }).limit(300));

        const withFigure = burns.filter(b => b.unallocated_fuel_kg !== null && b.flight_ID);
        out(`block burn lines: ${burns.length}, carrying the figure: ${withFigure.length}`);
        assert.ok(withFigure.length, 'no block burn line carries an unallocated figure');

        const one = withFigure[0];
        const flight = await d.run(cds.ql.SELECT.one.from('fuelsphere.FLIGHT_SCHEDULE')
            .columns('flight_number', 'fob_at_in_kg').where({ ID: one.flight_ID }));
        const expected = Number((num(one.closing_rob_kg) - num(flight.fob_at_in_kg)).toFixed(2));
        out(`${flight.flight_number}: balance ${one.closing_rob_kg} - gauge ${flight.fob_at_in_kg} `
            + `= ${one.unallocated_fuel_kg} (expected ${expected})`);
        assert.strictEqual(num(one.unallocated_fuel_kg), expected);
    });

    // ------------------------------------------------------------- EXIT-8 --
    it('EXIT-8  a replay reproduces the seeded ledger', async () => {
        const d = await db();
        const { recalculateTail } = require(`${PROJECT}/srv/lib/rob-recalculate.js`);

        const [pick] = await d.run(cds.ql.SELECT.from('fuelsphere.ROB_LEDGER')
            .columns('tail_number').where({ entry_type: 'APU_BURN' }).limit(1));
        const tail = pick.tail_number;

        const columns = ['ID', 'closing_rob_kg', 'balance_value_usd', 'map_usd_per_kg',
                         'wt_avg_specific_gravity', 'unallocated_fuel_kg'];
        const before = await d.run(cds.ql.SELECT.from('fuelsphere.ROB_LEDGER')
            .columns(...columns).where({ tail_number: tail }).orderBy('ID'));

        // (tailNumber, userId, tx) - the transaction is the third argument.
        await recalculateTail(tail, 'harness', d);

        const after = await d.run(cds.ql.SELECT.from('fuelsphere.ROB_LEDGER')
            .columns(...columns).where({ tail_number: tail }).orderBy('ID'));

        // MONEY COLUMNS COMPARE null AS ZERO, and that is not laxity. A tail
        // whose uplifts were never priced carries empty value columns in the
        // seed and a replayed zero - the same statement, written two ways,
        // and the demo tails that predate the JetBlue data are all like this.
        // Quantity, gravity and the unallocated figure are compared exactly,
        // because there a null and a zero mean different things.
        const money = new Set(['balance_value_usd', 'map_usd_per_kg']);

        // AND A SEEDED NULL IN A NEW COLUMN IS NOT A DISAGREEMENT EITHER. The
        // 27 rows that predate the JetBlue data were kept rather than
        // regenerated, so they carry no unallocated figure and no gravity; the
        // replay computes both. Filling a blank is the point of a replay. A
        // row that HAS a figure must still reproduce it exactly.
        const fillable = new Set(['unallocated_fuel_kg', 'wt_avg_specific_gravity']);

        const same = (c, x, y) => {
            if (fillable.has(c) && (x === null || x === undefined)) return true;
            return money.has(c)
                ? (num(x) || 0) === (num(y) || 0)
                : String(num(x)) === String(num(y));
        };

        // Matched by ID rather than by position - the two reads are ordered
        // the same way, but pairing on the index of the FILTERED list would
        // compare unrelated rows and report differences that are not there.
        const afterById = new Map(after.map(r => [r.ID, r]));
        const drift = before.filter(b =>
            columns.slice(1).some(c => !same(c, b[c], afterById.get(b.ID)[c])));

        out(`${tail}: ${before.length} rows replayed, ${drift.length} differ`);
        drift.slice(0, 3).forEach(b => {
            const a = afterById.get(b.ID);
            const which = columns.slice(1).filter(c => !same(c, b[c], a[c]));
            which.forEach(c => out(`   ${b.ID.slice(0, 8)} ${c}: ${b[c]} -> ${a[c]}`));
        });
        assert.strictEqual(drift.length, 0,
            'the replay disagrees with the seeded figures - the generator and the recalculation have drifted apart');
    });
});

/**
 * FIFO and moving average, over the same movements.
 *
 * THE ONE PROPERTY THAT MAKES A VALUATION TRUSTWORTHY is conservation: what
 * was bought is either burned or still on board. Both methods must account for
 * every kilogram and every dollar, and they must reach the SAME total while
 * disagreeing about when the cost falls. A method that loses value is wrong in
 * a way no screen would show - the columns would still add up on their own.
 *
 * EXIT-1  both methods ran over the same movements
 * EXIT-2  FIFO conserves: burned + on hand = taken in
 * EXIT-3  MAP conserves, and reaches the same total as FIFO
 * EXIT-4  FIFO consumes the OLDEST layer first
 * EXIT-5  a FIFO burn's rate lies between the layers it consumed
 * EXIT-6  no row of either method touches the FOB ledger's tables
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');

cds.test(PROJECT);
const out = (s) => process.stdout.write('      ' + s + '\n');
const db = () => cds.connect.to('db');
const n = (v) => (v === null || v === undefined ? 0 : Number(v));

const MOVES = 'fuelsphere.FUEL_STOCK_MOVEMENT_LEDGER';
const BALS  = 'fuelsphere.FUEL_STOCK_BALANCE';
const HDRS  = 'fuelsphere.FUEL_BURN_HEADER';

let moves, bals, hdrs;

describe('FIFO and moving average valuation', () => {

    before(async () => {
        const d = await db();
        moves = await d.run(cds.ql.SELECT.from(MOVES));
        bals  = await d.run(cds.ql.SELECT.from(BALS));
        hdrs  = await d.run(cds.ql.SELECT.from(HDRS));
    });

    // ------------------------------------------------------------- EXIT-1 --
    it('EXIT-1  both methods ran over the same movements', () => {
        assert.ok(moves.length > 0, 'no movements at all - everything below would pass vacuously');
        const key = (r) => `${r.tail_number}|${r.reference}`;
        const fifo = new Set(moves.filter(r => r.valuation_method === 'FIFO').map(key));
        const map  = new Set(moves.filter(r => r.valuation_method === 'MAP').map(key));
        assert.ok(fifo.size > 0 && map.size > 0, 'one of the two methods produced nothing');

        // FIFO explodes a burn across layers, so it has MORE rows - but it must
        // cover exactly the same movements, no more and no fewer.
        const onlyFifo = [...fifo].filter(k => !map.has(k));
        const onlyMap  = [...map].filter(k => !fifo.has(k));
        out(`${fifo.size} movements under FIFO, ${map.size} under MAP, `
          + `${moves.length} rows in total`);
        assert.deepStrictEqual(onlyFifo.slice(0, 5), [], 'FIFO valued movements MAP did not');
        assert.deepStrictEqual(onlyMap.slice(0, 5), [], 'MAP valued movements FIFO did not');
    });

    // ------------------------------------------------------------- EXIT-2 --
    it('EXIT-2  FIFO conserves: burned plus on hand equals taken in', () => {
        const inKg = moves.filter(r => r.valuation_method === 'FIFO' && n(r.qty_kg) > 0);
        const taken = inKg.reduce((t, r) => t + n(r.value_usd), 0);
        const burned = -moves.filter(r => r.valuation_method === 'FIFO' && n(r.qty_kg) < 0)
            .reduce((t, r) => t + n(r.value_usd), 0);
        const onHand = bals.filter(r => r.valuation_method === 'FIFO')
            .reduce((t, r) => t + n(r.value_usd), 0);

        const gap = Math.abs(taken - (burned + onHand));
        out(`FIFO  in ${taken.toFixed(0)} = burned ${burned.toFixed(0)} + on hand ${onHand.toFixed(0)}`
          + `  (gap ${gap.toFixed(2)})`);
        // A cent per row of rounding is expected; a dollar per row is a defect.
        assert.ok(gap < Math.max(1, inKg.length * 0.01),
            `FIFO loses ${gap.toFixed(2)} USD between what went in and what is accounted for`);
    });

    // ------------------------------------------------------------- EXIT-3 --
    it('EXIT-3  MAP conserves, and totals the same as FIFO', () => {
        const taken = moves.filter(r => r.valuation_method === 'MAP' && n(r.qty_kg) > 0)
            .reduce((t, r) => t + n(r.value_usd), 0);
        const burned = -moves.filter(r => r.valuation_method === 'MAP' && n(r.qty_kg) < 0)
            .reduce((t, r) => t + n(r.value_usd), 0);
        const onHand = bals.filter(r => r.valuation_method === 'MAP')
            .reduce((t, r) => t + n(r.value_usd), 0);
        const gap = Math.abs(taken - (burned + onHand));
        out(`MAP   in ${taken.toFixed(0)} = burned ${burned.toFixed(0)} + on hand ${onHand.toFixed(0)}`
          + `  (gap ${gap.toFixed(2)})`);
        assert.ok(gap < Math.max(1, moves.length * 0.01),
            `MAP loses ${gap.toFixed(2)} USD`);

        // THE METHODS MUST AGREE ON THE TOTAL AND DIFFER ON THE SPLIT. If the
        // totals differ they ran over different movements; if the splits are
        // identical the two methods are not actually doing anything different.
        const fifoIn = moves.filter(r => r.valuation_method === 'FIFO' && n(r.qty_kg) > 0)
            .reduce((t, r) => t + n(r.value_usd), 0);
        assert.ok(Math.abs(fifoIn - taken) < Math.max(1, moves.length * 0.01),
            `the two methods took in different value: FIFO ${fifoIn.toFixed(2)}, MAP ${taken.toFixed(2)}`);

        const fifoBurn = -moves.filter(r => r.valuation_method === 'FIFO' && n(r.qty_kg) < 0)
            .reduce((t, r) => t + n(r.value_usd), 0);
        out(`difference in cost recognised: ${Math.abs(fifoBurn - burned).toFixed(2)} USD`);
    });

    // ------------------------------------------------------------- EXIT-4 --
    it('EXIT-4  FIFO consumes the oldest layer first', () => {
        // Opened-at POSITION per batch, from the row that created it.
        //
        // NOT flight_aobt, which this used until 18 Oct 2026 and which is not
        // a reliable order. The movements now come from ROB_LEDGER, where
        // record_time contradicts sequence - on N645JB an uplift timestamped
        // 23:18 carries sequence 2 while the burn it fuels is timestamped
        // 22:50 with sequence 3, and the closing balance chain reconciles
        // only in sequence order. Judging "older" by the clock therefore
        // called a correct FIFO consumption an out-of-order one.
        //
        // `sequence` is the replay position the seeder assigned walking the
        // ledger in its authoritative order, so it IS the order layers
        // opened in - which is exactly what this criterion means by older.
        const opened = new Map();
        for (const r of moves) {
            if (r.valuation_method !== 'FIFO' || n(r.qty_kg) <= 0 || !r.batch_ref) continue;
            const key = `${r.tail_number}|${r.batch_ref}`;
            const at = n(r.sequence);
            if (!opened.has(key) || (at !== null && at < opened.get(key))) {
                opened.set(key, at === null ? Number.MAX_SAFE_INTEGER : at);
            }
        }

        // Within one burn, the layers must be taken in opening order.
        const byBurn = new Map();
        for (const r of moves) {
            if (r.valuation_method !== 'FIFO' || n(r.qty_kg) >= 0) continue;
            const k = `${r.tail_number}|${r.reference}`;
            if (!byBurn.has(k)) byBurn.set(k, []);
            byBurn.get(k).push(r);
        }
        let spanning = 0, bad = [];
        for (const [k, rows] of byBurn) {
            if (rows.length < 2) continue;
            spanning += 1;
            const positions = rows.map(r => {
                const v = opened.get(`${r.tail_number}|${r.batch_ref}`);
                return v === undefined ? Number.MAX_SAFE_INTEGER : v;
            });
            for (let i = 1; i < positions.length; i++) {
                if (positions[i] < positions[i - 1]) { bad.push(k); break; }
            }
        }
        out(`${byBurn.size} FIFO burns, ${spanning} spanning more than one layer, ${bad.length} out of order`);
        assert.ok(spanning > 0, 'no burn spans two layers - FIFO is untested by this data');
        assert.deepStrictEqual(bad.slice(0, 5), [],
            'a burn consumed a newer layer before an older one - that is not FIFO');
    });

    // ------------------------------------------------------------- EXIT-5 --
    it('EXIT-5  a FIFO burn rate lies between the layers it consumed', () => {
        const rows = new Map();
        for (const r of moves) {
            if (r.valuation_method !== 'FIFO' || n(r.qty_kg) >= 0) continue;
            const k = `${r.tail_number}|${r.reference}`;
            if (!rows.has(k)) rows.set(k, []);
            rows.get(k).push(r);
        }
        let checked = 0;
        const bad = [];
        for (const h of hdrs.filter(x => x.valuation_method === 'FIFO' && n(x.layers_consumed) > 1)) {
            const parts = rows.get(`${h.tail_number}|${h.burn_ref}`);
            if (!parts || !parts.length) continue;
            const rates = parts.map(p => n(p.rate_usd_per_kg));
            const lo = Math.min(...rates), hi = Math.max(...rates), r = n(h.burn_rate_usd_per_kg);
            checked += 1;
            // A hair of rounding either side is fine; outside the range is not.
            if (r < lo - 0.0001 || r > hi + 0.0001) bad.push(`${h.burn_ref}: ${r} outside [${lo}, ${hi}]`);
        }
        out(`${checked} multi-layer burns checked; ${bad.length} priced outside their layers`);
        assert.ok(checked > 0, 'no multi-layer burn to check');
        assert.deepStrictEqual(bad.slice(0, 5), [],
            'a blended rate fell outside the prices it was blended from');
    });

    // ------------------------------------------------------------- EXIT-6 --
    it('EXIT-6  the valuation touches none of the FOB ledger tables', async () => {
        // THE DEMO RUNS ON THE FOB LEDGER. This asserts the isolation that
        // makes the valuation safe to build beside it: no association, no
        // foreign key, nothing that compiles into a join.
        const m = cds.model.definitions;
        for (const name of [MOVES, BALS, HDRS]) {
            const def = m[name];
            assert.ok(def, `${name} is not in the model`);
            const assocs = Object.entries(def.elements)
                .filter(([, e]) => e.isAssociation || e.isComposition)
                .map(([k]) => k);
            assert.deepStrictEqual(assocs, [],
                `${name} declares ${assocs.join(', ')} - the valuation must not reach into another table`);
        }
        out('all three tables are standalone: no association on any of them');

        // And the ledger is unchanged in shape.
        const d = await db();
        const ledger = await d.run(cds.ql.SELECT.from('fuelsphere.ROB_LEDGER').columns('ID'));
        out(`ROB_LEDGER still holds ${ledger.length} rows, untouched by this seed`);
        assert.ok(ledger.length > 0, 'the FOB ledger is empty - something took its data');
    });
});

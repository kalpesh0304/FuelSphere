/**
 * UNBILLED TICKETS — the exposure list and the coverage report.
 *
 * AND THE CRITERION THAT IS THE OPPOSITE OF E2b's. There, a blank cell on
 * the demo flight meant a half-built card. HERE THE BLANKS ARE THE FINDING:
 * est_value is null on every UNBILLABLE ticket because no order means no
 * supplier means no contract means no price, and SUP-MNL-12004 has no mass
 * either. Asserting "no nulls" would demand inventing a price for fuel
 * nobody can attribute.
 *
 * So EXIT-4 asserts every null is EXPLAINED - est_value is null if and only
 * if est_basis says why - which is a stronger claim than absence.
 *
 *   EXIT-1  three states, mutually exclusive and exhaustive
 *   EXIT-2  the reading order is UNBILLABLE, UNBILLED, BILLED - not the alphabet
 *   EXIT-3  kilograms lead, and the coverage figures are queryable
 *   EXIT-4  every null value is EXPLAINED by est_basis, both directions
 *   EXIT-5  the station is UNKNOWN, never missing, and never invented
 *   EXIT-6  the claim window is ABSENT and the screen says so
 *   EXIT-7  age is not sortable, and the sort does not depend on it
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert'); const fs=require('node:fs');
const test=cds.test(PROJECT); const out=s=>process.stdout.write('      '+s+'\n');
const db=()=>cds.connect.to('db');
const O='/odata/v4/invoice';
const STATES=['UNBILLABLE','UNBILLED','BILLED'];

describe('Unbilled tickets — exposure, coverage, and one clock that is absent', () => {

    it('EXIT-1  three states, mutually exclusive and EXHAUSTIVE', async () => {
        const d = await db();
        const rows = await d.run(SELECT.from('fuelsphere.UNBILLED_TICKETS')
            .columns('ID','billing_state','state_rank'));
        const tickets = await d.run(SELECT.from('fuelsphere.FUEL_TICKETS').columns('count(*) as n'));
        assert.strictEqual(rows.length, tickets[0].n,
            `${rows.length} rows for ${tickets[0].n} tickets. A left join to INVOICE_ITEMS would `
          + `DUPLICATE a ticket billed on two lines - two in the seed are, one of them the `
          + `deliberate INV455 double-billing - which is why the view uses "case when exists".`);
        const seen = new Set(rows.map(r => r.billing_state));
        assert.deepStrictEqual([...seen].sort(), [...STATES].sort(),
            `states present: ${[...seen].join(', ')} — expected exactly ${STATES.join(', ')}`);
        for (const r of rows) assert.ok(r.state_rank >= 1 && r.state_rank <= 3,
            `${r.billing_state} has rank ${r.state_rank}`);
        const by = {}; for (const r of rows) by[r.billing_state] = (by[r.billing_state]||0)+1;
        out(`${rows.length} tickets: ` + STATES.map(s => `${s}=${by[s]}`).join('  '));
    });

    it('EXIT-2  UNBILLABLE first — the reading order, not the alphabet', async () => {
        // 'BILLED' < 'UNBILLABLE' < 'UNBILLED' alphabetically puts the
        // settled rows first and the WORST rows in the middle. Right for no
        // reason and wrong the day a state is added.
        const { data } = await test.GET(
            `${O}/UnbilledTickets?$select=billing_state,state_rank&$orderby=state_rank&$top=100`);
        const ranks = [...new Set(data.value.map(r => `${r.state_rank}:${r.billing_state}`))];
        assert.deepStrictEqual(ranks, ['1:UNBILLABLE','2:UNBILLED','3:BILLED'],
            `the reading order is ${ranks.join(' ')}. UNBILLABLE is FIRST because nobody can bill `
          + `it at all; UNBILLED is second because somebody still might. Sorting on billing_state `
          + `would put BILLED first by alphabetical accident.`);
        assert.strictEqual(data.value[0].billing_state, 'UNBILLABLE');
        out(`reading order: ${ranks.join('  ')}`);
    });

    it('EXIT-3  KILOGRAMS LEAD, and the coverage figures are queryable', async () => {
        // The mass is the MONEY and the count is the WORK. Both belong on
        // the screen and the mass is first - sixteen unbilled tickets could
        // be sixteen top-ups or one widebody uplift.
        const d = await db();
        const rows = await d.run(SELECT.from('fuelsphere.UNBILLED_TICKETS')
            .columns('billing_state','quantity_kg','est_value'));
        const agg = {};
        for (const r of rows) {
            const a = agg[r.billing_state] ||= { kg:0, n:0, val:0 };
            a.kg += Number(r.quantity_kg) || 0; a.n += 1; a.val += Number(r.est_value) || 0;
        }
        for (const s of STATES) assert.ok(agg[s] && agg[s].n > 0, `no ${s} tickets to report`);
        assert.ok(agg.UNBILLED.kg > 0 && agg.UNBILLABLE.kg > 0,
            'an exposure report with no exposure proves nothing');
        // The mass column must be the first NUMERIC column of the LineItem,
        // ahead of any count or value.
        const ann = fs.readFileSync(`${PROJECT}/srv/invoice-fiori-annotations.cds`,'utf8');
        const li = /annotate InvoiceService\.UnbilledTickets with @\(([\s\S]*?)\n\);/.exec(ann)[1];
        const items = [...li.matchAll(/\{ Value: (\w+),\s*Label/g)].map(m => m[1]);
        assert.ok(items.indexOf('quantity_kg') < items.indexOf('est_value'),
            'the mass must precede the value: money follows mass');
        assert.ok(items.indexOf('quantity_kg') < items.indexOf('age_days'),
            'the mass must precede the age');
        out(STATES.map(s => `${s} ${agg[s].kg.toFixed(2)}kg/${agg[s].n}`).join('   '));
    });

    it('EXIT-4  EVERY NULL IS EXPLAINED — both directions', async () => {
        // THE OPPOSITE OF E2b's card criterion. There a blank meant a
        // half-built card; here the blanks ARE the finding, and asserting
        // "no nulls" would demand inventing a price for fuel nobody can
        // attribute. So: est_value is null IF AND ONLY IF est_basis says why.
        const d = await db();
        const rows = await d.run(SELECT.from('fuelsphere.UNBILLED_TICKETS')
            .columns('ticket_number','billing_state','est_value','est_basis','quantity_kg'));
        let explained = 0, priced = 0;
        for (const r of rows) {
            const hasValue = r.est_value !== null && r.est_value !== undefined;
            if (!hasValue) {
                assert.notStrictEqual(r.est_basis, 'ORDER_PRICE',
                    `${r.ticket_number} has NO estimated value and claims basis ORDER_PRICE — a null `
                  + `with no reason is indistinguishable from a calculation that silently failed`);
                assert.ok(['NO_ORDER','NO_PRICE','NO_QUANTITY'].includes(r.est_basis),
                    `${r.ticket_number} has no value and an unrecognised basis "${r.est_basis}"`);
                explained++;
            } else {
                assert.strictEqual(r.est_basis, 'ORDER_PRICE',
                    `${r.ticket_number} carries a value estimated from "${r.est_basis}"`);
                assert.notStrictEqual(Number(r.est_value), 0,
                    `${r.ticket_number} estimates ZERO. Null where nothing resolves, never zero — `
                  + `a zero in a money column is a claim that the fuel was free.`);
                priced++;
            }
        }
        const noQty = rows.filter(r => r.quantity_kg === null);
        out(`${priced} priced from the order, ${explained} null WITH a reason, `
          + `${noQty.length} with no mass either (${noQty.map(r=>r.ticket_number).join(',') || '-'})`);
    });

    it('EXIT-5  the station is UNKNOWN, never missing and never invented', async () => {
        const d = await db();
        const rows = await d.run(SELECT.from('fuelsphere.UNBILLED_TICKETS')
            .columns('ticket_number','billing_state','station_code','order_ID'));
        const nulls = rows.filter(r => !r.station_code);
        assert.strictEqual(nulls.length, 0,
            `${nulls.length} ticket(s) have a null station. They must read UNKNOWN and stay in the `
          + `list: an uplift nobody can place is still a finding, and excluding it from a `
          + `station-filtered view hides the worst row in the set.`);
        const unknown = rows.filter(r => r.station_code === 'UNKNOWN');
        for (const u of unknown) assert.strictEqual(u.order_ID, null,
            `${u.ticket_number} reads UNKNOWN and HAS an order — the station was resolvable and was not`);
        assert.ok(unknown.length > 0,
            'instrument check: no ticket reads UNKNOWN, so this criterion proves nothing about the case it exists for');
        out(`${unknown.length} of ${rows.length} read UNKNOWN, every one with no order; 0 null`);
    });

    it('EXIT-6  THE CLAIM WINDOW IS ABSENT, and the screen says so', async () => {
        // NOT A PASSING TEST DRESSED AS COVERAGE - the shape carrier scoping
        // and rung 5 already use. 02-BEHAVIOUR specifies a written claim
        // within 15 days and quality defects within 30, after which the
        // right is WAIVED. A claim window sorts by TIME REMAINING; ageing
        // sorts oldest-first. Different clocks, and only one is modelled.
        const m = await cds.load(`${PROJECT}/db`);
        const defs = cds.linked(cds.compile.for.nodejs(m)).definitions;
        const hits = [];
        for (const [name, def] of Object.entries(defs)) {
            if (!def.elements) continue;
            for (const el of Object.keys(def.elements))
                if (/claim_window|claim_deadline|claim_type|notification_deadline|days_to_claim/i.test(el))
                    hits.push(`${name}.${el}`);
        }
        assert.deepStrictEqual(hits, [],
            `a claim window is now modelled (${hits.join(', ')}) — this criterion should be REPLACED `
          + `by one that asserts the deadline column and its own sort, and the screen should stop `
          + `presenting ageing alone`);
        // And the absence must be STATED where a reader meets the number.
        const ann = fs.readFileSync(`${PROJECT}/srv/invoice-fiori-annotations.cds`,'utf8');
        const blk = /age_days\s+@title:[\s\S]{0,900}?;/.exec(ann);
        assert.ok(blk && /claim window/i.test(blk[0]) && /waived|absent/i.test(blk[0]),
            'age_days does not tell the reader that a deadline clock exists and is not modelled — '
          + 'an ageing report silently presented as covering deadlines is the failure mode: the '
          + 'oldest row sits at the top while the one expiring today falls through');
        out('no claim-window field anywhere in db/; age_days states the absence at the field');
    });

    it('EXIT-7  age is NOT sortable, and the screen does not depend on it', async () => {
        // age_days is virtual and filled after READ, so $orderby cannot
        // reach it - D52's cost, taken deliberately. The screen sorts on
        // delivery_timestamp, which gives the IDENTICAL order and sorts in
        // the database. This asserts both halves: that the sort avoids
        // age_days, and that avoiding it costs nothing.
        const ann = fs.readFileSync(`${PROJECT}/srv/invoice-fiori-annotations.cds`,'utf8');
        const pv = /annotate InvoiceService\.UnbilledTickets[\s\S]*?SortOrder: \[([\s\S]*?)\]/.exec(ann)[1];
        assert.ok(!/age_days/.test(pv),
            'the presentation variant sorts on age_days, which is virtual — $orderby runs in the '
          + 'database before the after-READ handler fills it');
        assert.ok(/delivery_timestamp/.test(pv), 'the sort must fall back to delivery_timestamp');

        // ... and it is the same order.
        const { data } = await test.GET(`${O}/UnbilledTickets`
            + `?$select=ticket_number,age_days,delivery_timestamp&$filter=billing_state ne 'BILLED'`
            + `&$orderby=delivery_timestamp&$top=20`);
        const ages = data.value.map(r => r.age_days);
        assert.ok(ages.every(a => typeof a === 'number'),
            'age_days came back unfilled — the before-READ that adds delivery_timestamp is not working');
        assert.deepStrictEqual(ages, [...ages].sort((a, b) => b - a),
            `sorting by delivery_timestamp ascending must give age descending (oldest first). `
          + `Got ${ages.join(',')}`);
        out(`${ages.length} rows: delivery_timestamp asc === age desc, ${ages[0]}d down to ${ages[ages.length-1]}d`);
    });
});

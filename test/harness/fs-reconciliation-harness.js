/**
 * Financials to FuelSphere reconciliation.
 *
 * WHAT THIS SCREEN CLAIMS, AND THEREFORE WHAT HAS TO BE TRUE. It puts a
 * number in front of Finance and invites them to close a period on it. Every
 * criterion below is one way that number could be wrong while still looking
 * reasonable, which is the only kind of wrong that survives to production.
 *
 * EXIT-1  the identity holds: opening + uplift - allocations - closing = unallocated
 * EXIT-2  the aggregates read MAP only, and agree with the raw ledger
 * EXIT-3  posting status splits the uplift and loses none of it
 * EXIT-4  closing stock is READ, not derived - or unallocated burn is a lie
 * EXIT-5  YTD is the sum of its months, and stock is not summed
 * EXIT-6  the finance column is marked as seeded, and claims no green tick
 * EXIT-7  a period shift nets to zero across the two periods it touches
 * EXIT-8  the filter bar's three filters reach the query, not just the rows
 * EXIT-9  no ledger table is written, and none gained a column
 * EXIT-10 the drill-down resolves a row to its own uplifts
 * EXIT-11 the OData surface answers the shapes Fiori Elements actually sends
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const fs = require('node:fs');

// THE FULL SERVER, not just a deployed model. FinanceReconciliation is
// computed entirely in a handler, so connecting to the database proves
// nothing about it - the service has to be running for there to be anything
// to assert against.
const test = cds.test(PROJECT);

const out = (s) => process.stdout.write('      ' + s + '\n');
const n = v => Number(v || 0) || 0;
const near = (a, b, tol, what) => assert.ok(Math.abs(n(a) - n(b)) <= tol,
    `${what}: ${n(a).toFixed(2)} vs ${n(b).toFixed(2)} (tolerance ${tol})`);

describe('Financials to FuelSphere reconciliation', () => {
    let srv;

    before(async function () {
        this.timeout(180000);
        cds.context = { user: new cds.User.Privileged() };
        srv = await cds.connect.to('ReconciliationService');
    });

    const read = (opts = {}) => srv.read('FinanceReconciliation')
        .where(opts.where || {});

    // -------------------------------------------------------------- EXIT-1 --
    it('EXIT-1  the identity holds on every row', async () => {
        const rows = await read();
        assert.ok(rows.length > 0, 'the reconciliation produced no rows at all');

        for (const r of rows) {
            const lhs = n(r.opening_stock_value) + n(r.net_uplift_fs)
                      - n(r.block_burn) - n(r.apu_burn) - n(r.other_allocations)
                      - n(r.remaining_stock);
            near(lhs, r.unallocated_burn, 0.02,
                `${r.ID}: unallocated_burn does not equal the identity it is defined by`);

            near(n(r.block_burn) + n(r.apu_burn) + n(r.other_allocations),
                 r.total_allocated, 0.02, `${r.ID}: total_allocated`);
        }
        out(`${rows.length} row(s), identity holds on each`);

        const b6 = rows.find(r => r.ID === 'B6|2026-09');
        assert.ok(b6, 'the seeded B6 September period is missing from the reconciliation');
        out(`B6 Sep 2026: uplift ${n(b6.net_uplift_fs).toFixed(0)}, `
          + `block ${n(b6.block_burn).toFixed(0)}, APU ${n(b6.apu_burn).toFixed(0)}, `
          + `open ${n(b6.opening_stock_value).toFixed(0)}, close ${n(b6.remaining_stock).toFixed(0)}, `
          + `unallocated ${n(b6.unallocated_burn).toFixed(2)}`);
    });

    // -------------------------------------------------------------- EXIT-2 --
    it('EXIT-2  the aggregates read MAP only and agree with the raw ledger', async () => {
        const { SELECT } = cds.ql;
        const LEDGER = 'fuelsphere.FUEL_STOCK_MOVEMENT_LEDGER';

        // BOTH VALUATIONS LIVE IN ONE TABLE. A view that forgot the filter
        // would double every figure, and would do it plausibly.
        const both = await cds.db.run(SELECT.from(LEDGER)
            .columns('valuation_method', { func: 'count', args: [{ val: 1 }], as: 'n' })
            .groupBy('valuation_method'));
        assert.ok(both.length > 1, 'instrument: only one valuation seeded, this cannot detect doubling');

        const rawMap = await cds.db.run(SELECT.from(LEDGER)
            .columns({ func: 'sum', args: [{ ref: ['value_usd'] }], as: 'v' })
            .where({ valuation_method: 'MAP', line_type: 'UPLIFT' }));
        const viaView = await cds.db.run(SELECT.from('fuelsphere.RECON_UPLIFT_BY_DAY')
            .columns({ func: 'sum', args: [{ ref: ['value_usd'] }], as: 'v' }));

        // The view also carries DEFUEL, so it is >= the uplift-only figure.
        const defuel = await cds.db.run(SELECT.from(LEDGER)
            .columns({ func: 'sum', args: [{ ref: ['value_usd'] }], as: 'v' })
            .where({ valuation_method: 'MAP', line_type: 'DEFUEL' }));
        near(viaView[0].v, n(rawMap[0].v) + n(defuel[0].v), 0.02,
            'RECON_UPLIFT_BY_DAY does not agree with the ledger it aggregates');
        out(`MAP uplift+defuel ${n(viaView[0].v).toFixed(0)} matches the raw ledger`);

        // AND THE JOIN MUST NOT MULTIPLY ROWS. A to-one association that is
        // not actually to-one turns a sum into a larger sum silently.
        const rawCount = await cds.db.run(SELECT.from(LEDGER)
            .columns({ func: 'count', args: [{ val: 1 }], as: 'n' })
            .where({ valuation_method: 'MAP', line_type: { in: ['UPLIFT', 'DEFUEL'] } }));
        const viewCount = await cds.db.run(SELECT.from('fuelsphere.RECON_UPLIFT_BY_DAY')
            .columns({ func: 'sum', args: [{ ref: ['line_count'] }], as: 'n' }));
        assert.strictEqual(Number(viewCount[0].n), Number(rawCount[0].n),
            'the ticket join multiplied uplift rows - every money figure on the screen is inflated');
        out(`${rawCount[0].n} uplift lines, not multiplied by the two-hop ticket join`);
    });

    // -------------------------------------------------------------- EXIT-3 --
    it('EXIT-3  posting status splits the uplift and loses none of it', async () => {
        for (const r of await read()) {
            near(n(r.net_uplift_expected) + n(r.jv_pending_posting), r.net_uplift_fs, 0.02,
                `${r.ID}: posted + pending does not add back to the FuelSphere uplift`);
            assert.strictEqual(n(r.posted_count) + n(r.pending_count), n(r.uplift_count),
                `${r.ID}: the uplift counts do not add up`);
        }

        // NEVER SENT IS PENDING, NOT POSTED. Every seeded ticket is unposted,
        // so the whole uplift must sit in JV pending - a screen that reported
        // it as posted would tell Finance the books are complete.
        const b6 = (await read()).find(r => r.ID === 'B6|2026-09');
        assert.strictEqual(n(b6.net_uplift_expected), 0,
            'uplifts that were never sent to S/4 are being reported as posted');
        near(b6.jv_pending_posting, b6.net_uplift_fs, 0.02,
            'unposted uplift is not showing as JV pending');
        out(`all ${b6.pending_count} B6 uplifts correctly sit in JV pending, none claimed as posted`);
    });

    // -------------------------------------------------------------- EXIT-4 --
    it('EXIT-4  closing stock is READ from the ledger, not derived from movements', async () => {
        // THIS IS THE CRITERION THE WHOLE SCREEN RESTS ON. If closing stock
        // were computed as opening plus movements, unallocated burn would be
        // zero by construction on every row, for ever, including on a ledger
        // that had lost a tonne of fuel.
        const src = fs.readFileSync(`${PROJECT}/srv/reconciliation-service.js`, 'utf8');
        assert.ok(/balance_value_usd/.test(src),
            'the handler never reads balance_value_usd - closing stock is being derived');

        // Plant a discrepancy and watch it surface. A ledger whose recorded
        // balance disagrees with its own movements MUST report the gap.
        const { SELECT, UPDATE } = cds.ql;
        const LEDGER = 'fuelsphere.FUEL_STOCK_MOVEMENT_LEDGER';
        const before = (await read({ where: { ID: 'B6|2026-09' } }))[0];
        near(before.unallocated_burn, 0, 2.0,
            'the seeded ledger does not reconcile - EXIT-4 cannot distinguish a real gap');

        const last = await cds.db.run(SELECT.one.from(LEDGER)
            .columns('ID', 'tail_number', 'sequence', 'balance_value_usd')
            .where({ valuation_method: 'MAP', carrier_code: 'B6' })
            .orderBy({ ref: ['sequence'], sort: 'desc' }));
        assert.ok(last, 'no B6 MAP movement to plant against');

        const original = n(last.balance_value_usd);
        await cds.db.run(UPDATE(LEDGER, last.ID).with({ balance_value_usd: original - 10000 }));
        try {
            const after = (await read({ where: { ID: 'B6|2026-09' } }))[0];
            near(n(after.unallocated_burn) - n(before.unallocated_burn), 10000, 1.0,
                'recorded stock was reduced by 10,000 and unallocated burn did not move');
            assert.strictEqual(after.unallocatedCriticality, 1,
                'a 10,000 USD hole in the ledger is not flagged red');
            out('a planted 10,000 USD stock discrepancy surfaces as unallocated burn, flagged red');
        } finally {
            await cds.db.run(UPDATE(LEDGER, last.ID).with({ balance_value_usd: original }));
        }
    });

    // -------------------------------------------------------------- EXIT-5 --
    it('EXIT-5  YTD is the sum of its months, and stock is not summed', async () => {
        const monthly = await srv.read('FinanceReconciliation')
            .where({ carrier_code: 'B6', fiscal_year: '2026' });
        const ytd = await srv.read('FinanceReconciliation')
            .where({ carrier_code: 'B6', fiscal_year: '2026', period_mode: 'YTD' });

        assert.strictEqual(ytd.length, 1, `YTD returned ${ytd.length} rows for one carrier-year`);
        const y = ytd[0];
        assert.strictEqual(y.ID, 'B6|YTD-2026');

        const sum = f => monthly.reduce((t, r) => t + n(r[f]), 0);
        for (const f of ['net_uplift_fs', 'block_burn', 'apu_burn', 'other_allocations',
                         'jv_pending_posting', 'posted_subsequent_period', 'uplift_count']) {
            near(y[f], sum(f), 0.05, `YTD ${f} is not the sum of its months`);
        }

        // THE STOCK TERMS MUST NOT BE SUMMED. Twelve closing balances added
        // together would report a carrier's fuel twelve times over.
        const closings = monthly.map(r => n(r.remaining_stock));
        const lastMonth = monthly.sort((a, z) => a.period.localeCompare(z.period)).at(-1);
        near(y.remaining_stock, lastMonth.remaining_stock, 0.02,
            'YTD closing stock is not the last month\'s closing - it looks summed');
        if (closings.length > 1) {
            assert.ok(Math.abs(n(y.remaining_stock) - closings.reduce((a, b) => a + b, 0)) > 0.02,
                'YTD closing stock equals the SUM of monthly closings - the stock is being double counted');
        }

        // And the identity still has to hold on the YTD row.
        near(n(y.opening_stock_value) + n(y.net_uplift_fs) - n(y.block_burn)
             - n(y.apu_burn) - n(y.other_allocations) - n(y.remaining_stock),
             y.unallocated_burn, 0.05, 'the YTD row breaks the identity');
        out(`YTD 2026 sums ${monthly.length} month(s); stock taken from the last, not summed`);
    });

    // -------------------------------------------------------------- EXIT-6 --
    it('EXIT-6  the finance column is marked seeded and claims no green tick', async () => {
        // THE INSTRUCTION WAS TO SEED IT: "just seed same data as net uplift
        // from Fuelsphere column once the odata srv is avilable we will
        // integrate". A column copied from its neighbour reconciles perfectly
        // and means nothing, so the screen must never present that as
        // agreement.
        for (const r of await read()) {
            assert.strictEqual(r.finance_source, 'SEEDED_FROM_FS',
                `${r.ID}: finance_source does not disclose that the figure is a placeholder`);
            assert.strictEqual(r.varianceCriticality, 0,
                `${r.ID}: a placeholder variance is being rendered as a reconciled result`);
        }

        // And the disclosure has to be ON THE SCREEN, not only in the model.
        const ann = fs.readFileSync(`${PROJECT}/srv/reconciliation-fiori-annotations.cds`, 'utf8');
        assert.ok(/finance_source/.test(ann),
            'finance_source appears nowhere in the annotations - a reader cannot tell the '
          + 'finance column is a placeholder');
        out('finance figure disclosed as SEEDED_FROM_FS, variance stays neutral');
    });

    // -------------------------------------------------------------- EXIT-7 --
    it('EXIT-7  a period shift nets to zero across the periods it touches', async () => {
        const { SELECT, UPDATE } = cds.ql;
        const LEDGER = 'fuelsphere.FUEL_STOCK_MOVEMENT_LEDGER';
        const ROB = 'fuelsphere.ROB_LEDGER';
        const TICKETS = 'fuelsphere.FUEL_TICKETS';

        // The specification's own worked example: a September uplift whose FI
        // document posts in October shows +value on September and -value on
        // October, because September was closed by the time it posted.
        const mv = await cds.db.run(SELECT.one.from(LEDGER)
            .columns('reference', 'value_usd', 'flight_date')
            .where({ valuation_method: 'MAP', carrier_code: 'B6', line_type: 'UPLIFT' }));
        assert.ok(mv, 'no B6 uplift to shift');
        const rob = await cds.db.run(SELECT.one.from(ROB)
            .columns('fuel_ticket_ID').where({ ID: mv.reference }));
        assert.ok(rob && rob.fuel_ticket_ID, 'the uplift does not reach a ticket');

        await cds.db.run(UPDATE(TICKETS, rob.fuel_ticket_ID).with({
            s4_posting_status: 'S', s4_fi_posting_date: '2026-10-15'
        }));
        try {
            const rows = await srv.read('FinanceReconciliation').where({ carrier_code: 'B6' });
            const sep = rows.find(r => r.period === '2026-09');
            const oct = rows.find(r => r.period === '2026-10');
            assert.ok(oct, 'the October period the FI document landed in was not created at all');
            near(sep.posted_subsequent_period, n(mv.value_usd), 0.02,
                'September does not report the uplift that posted into October');
            near(oct.posted_subsequent_period, -n(mv.value_usd), 0.02,
                'October does not report the value that arrived from September');
            near(n(sep.posted_subsequent_period) + n(oct.posted_subsequent_period), 0, 0.02,
                'the shift does not net to zero across the two periods');
            out(`a ${n(mv.value_usd).toFixed(0)} USD uplift posting into the next period `
              + 'nets to zero across Sep and Oct');
        } finally {
            await cds.db.run(UPDATE(TICKETS, rob.fuel_ticket_ID).with({
                s4_posting_status: null, s4_fi_posting_date: null
            }));
        }
    });

    // -------------------------------------------------------------- EXIT-8 --
    it('EXIT-8  the filter bar\'s filters reach the query, not just the rows', async () => {
        // A FILTER THE HANDLER IGNORES STILL LOOKS RIGHT. FinanceReconciliation
        // has no table, so CAP cannot push $filter down for it; if the handler
        // did not read the filter itself, it would build every carrier and
        // every year on every keystroke and filter the result. That is correct
        // and unusable, and the difference is invisible on seed data.
        const src = fs.readFileSync(`${PROJECT}/srv/reconciliation-service.js`, 'utf8');
        for (const f of ['carrier_code', 'fiscal_year', 'period_mode']) {
            assert.ok(new RegExp(`filters\\.${f}`).test(src),
                `the handler never consults the ${f} filter - it is filtering after the fact`);
        }

        const one = await srv.read('FinanceReconciliation').where({ carrier_code: 'B6' });
        assert.ok(one.length > 0 && one.every(r => r.carrier_code === 'B6'),
            'the carrier filter did not take effect');

        // AND THE BY-KEY READ MUST NOT BUILD THE WORLD. The object page reads
        // one row; unpacking its key is what keeps that one query.
        const byKey = await srv.read('FinanceReconciliation', { ID: 'B6|2026-09' });
        assert.ok(byKey && byKey.ID === 'B6|2026-09', 'the object page cannot read its own row');
        assert.ok(/keyOf/.test(src), 'the handler does not unpack the key of a by-key read');
        out('carrier, year and mode are read by the handler; the by-key read unpacks its key');
    });

    // -------------------------------------------------------------- EXIT-9 --
    it('EXIT-9  no ledger table is written, and none gained a column', async () => {
        // SAID IN THESE WORDS, with a demo scheduled against those tables:
        // "I don't want to touch the existing FOB ledger related tables".
        // It is also the right design - a reconciliation that writes to the
        // ledger it reconciles cannot be trusted to disagree with it.
        const src = fs.readFileSync(`${PROJECT}/srv/reconciliation-service.js`, 'utf8');
        for (const verb of ['INSERT', 'UPDATE', 'DELETE', 'UPSERT']) {
            assert.ok(!new RegExp(`\\b${verb}\\s*(\\.|\\()`).test(src),
                `the reconciliation handler issues a ${verb} - it must only read`);
        }

        // The ROB ledger's own definition must be untouched by this feature:
        // the one addition is an UNMANAGED association on the valuation
        // ledger, which generates no column and no DDL.
        const model = fs.readFileSync(`${PROJECT}/db/fs-reconciliation.cds`, 'utf8');
        assert.ok(!/extend\s+(db|val)\./.test(model),
            'the reconciliation extends a ledger entity');

        // NOR MAY THE VALUATION LEDGER GAIN ONE. This is the boundary
        // fifo-valuation-harness EXIT-6 guards - "the demo runs on the FOB
        // ledger" - and the first version of this feature broke it by putting
        // an unmanaged association on FUEL_STOCK_MOVEMENT_LEDGER. Unmanaged
        // means no column, which is why it looked harmless; what it is NOT is
        // invisible, because an association on an entity is reachable from
        // every query anyone writes against that entity ever after.
        //
        // The join now lives inside the three views, which reach nothing else.
        const mv = cds.model.definitions['fuelsphere.FUEL_STOCK_MOVEMENT_LEDGER'];
        const assocs = Object.entries(mv.elements)
            .filter(([, e]) => e.type === 'cds.Association' || e.type === 'cds.Composition')
            .map(([k]) => k);
        assert.deepStrictEqual(assocs, [],
            `the valuation ledger declares ${assocs.join(', ')} - the isolation the demo `
          + 'depends on is gone');
        assert.ok(/left join db\.ROB_LEDGER/.test(model),
            'the views do not join the ROB ledger explicitly');

        // ASSERTED AGAINST THE LOADED MODEL, not a `cds compile` subprocess.
        // The subprocess took longer than mocha's timeout under load, which
        // made this criterion fail for being slow rather than for being
        // false - the worst way for a check to go red, because the next
        // person raises the timeout instead of reading what it says.
        const rob = cds.model.definitions['fuelsphere.ROB_LEDGER'];
        assert.ok(rob, 'ROB_LEDGER is not in the model at all');
        const added = Object.keys(rob.elements).filter(e => /^(rob_entry|recon)/i.test(e));
        assert.deepStrictEqual(added, [],
            `the ROB ledger gained ${added.join(', ')} from the reconciliation`);

        out('read-only handler; neither ledger changed; the join lives in the views');
    });

    // ------------------------------------------------------------- EXIT-10 --
    it('EXIT-10  the drill-down resolves a row to its own uplifts', async () => {
        // "Drill down in any row shows the GL level recon." The G/L-level
        // specification has not arrived; what IS knowable is the accounts the
        // fuel should land in and the uplifts making up the figure.
        const lines = await srv.read('ReconciliationUpliftLine')
            .where({ recon_ID: 'B6|2026-09' });
        assert.ok(lines.length > 0, 'the drill-down returned no uplift lines');
        assert.ok(lines.every(l => l.recon_ID === 'B6|2026-09'),
            'the drill-down leaked lines from another period');
        assert.ok(lines.every(l => String(l.flight_date).startsWith('2026-09')),
            'an uplift from outside the period reached the drill-down');
        assert.ok(lines.every(l => l.posting_status === 'NOT_SENT'),
            'a drill-down line claims a posting status no ticket has');
        out(`${lines.length} uplift line(s) behind B6 Sep 2026, all NOT_SENT`);

        const gl = await srv.read('ReconciliationGlLine').where({ recon_ID: 'B6|2026-09' });
        assert.ok(gl.length === 2, `expected the two seeded B6 accounts, got ${gl.length}`);
        assert.deepStrictEqual(gl.map(g => g.gl_account).sort(), ['600780', '600781'],
            'the G/L drill-down does not show the accounts the consultant gave');
        assert.ok(gl.every(g => g.booked_value === null),
            'booked_value is not null - the screen is claiming to know what Finance posted');
        out(`G/L drill-down shows ${gl.map(g => g.gl_account).join(', ')}, booked side null until the G/L service exists`);

        // AN EMPTY FILTER MUST RETURN NOTHING, not everything. A drill-down
        // that answers an unscoped request would compute every period.
        assert.strictEqual((await srv.read('ReconciliationUpliftLine')).length, 0,
            'the drill-down answered a request with no row to drill into');
    });

    // ------------------------------------------------------------- EXIT-11 --
    it('EXIT-11  the OData surface answers the shapes Fiori Elements sends', async () => {
        // THE HANDLER READS ITS OWN FILTERS, so the CQN it is handed is not an
        // implementation detail - it is the interface. Every criterion above
        // this one goes through the JavaScript API, which builds a tidier
        // query than a browser does. This one goes over HTTP, in the shapes a
        // List Report actually emits.
        const P = '/odata/v4/reconciliation';
        const get = async (url) => (await test.GET(`${P}/${url}`)).data;

        // ---- the first request a List Report makes -----------------------
        const first = await get('FinanceReconciliation?$count=true&$top=30'
            + '&$orderby=carrier_code asc,period asc');
        assert.ok(Array.isArray(first.value) && first.value.length,
            'the List Report\'s opening request returned no rows');
        assert.strictEqual(typeof first['@odata.count'], 'number',
            '$count was requested and not answered - the table shows no row count and cannot page');
        assert.strictEqual(first['@odata.count'], first.value.length,
            'the count disagrees with the page returned');
        out(`opening request: ${first.value.length} row(s), $count answered`);

        // ---- a filter bar entry ------------------------------------------
        const filtered = await get(`FinanceReconciliation?$count=true`
            + `&$filter=(carrier_code eq 'B6') and (fiscal_year eq '2026')`);
        assert.ok(filtered.value.length, 'the carrier and year filter returned nothing');
        assert.ok(filtered.value.every(r => r.carrier_code === 'B6'),
            'the parenthesised filter Fiori Elements emits was not honoured');

        // ---- THE MULTI-SELECT SHAPE, which is an OR of equalities --------
        // A scanner that assigns rather than unions keeps only the last value
        // here, so the table shows one carrier while the filter chip says two.
        const multi = await get('FinanceReconciliation'
            + `?$filter=(carrier_code eq 'B6' or carrier_code eq 'AC')`);
        const seen = [...new Set(multi.value.map(r => r.carrier_code))].sort();
        assert.deepStrictEqual(seen, ['AC', 'B6'],
            `a two-carrier filter returned only ${seen.join(', ')} - the OR was collapsed`);
        out(`multi-select filter returns both carriers: ${seen.join(', ')}`);

        // ---- the YTD toggle ----------------------------------------------
        const ytd = await get(`FinanceReconciliation?$filter=period_mode eq 'YTD'`);
        assert.ok(ytd.value.length && ytd.value.every(r => r.period_mode === 'YTD'),
            'the YTD option in the filter bar does not reach the handler');
        assert.ok(ytd.value.every(r => r.ID.includes('|YTD-')),
            'a YTD request returned monthly rows');

        // ---- the object page ---------------------------------------------
        const one = await get(`FinanceReconciliation('B6%7C2026-09')`);
        assert.strictEqual(one.ID, 'B6|2026-09',
            'the object page request did not return a single entity');
        assert.ok(!Array.isArray(one.value),
            'a by-key read answered with a collection - the object page renders empty');

        // ---- and its two tables ------------------------------------------
        const expanded = await get(`FinanceReconciliation('B6%7C2026-09')`
            + '?$expand=gl_accounts');
        assert.ok(Array.isArray(expanded.gl_accounts) && expanded.gl_accounts.length === 2,
            '$expand on the G/L drill-down returned nothing - the object page table is empty');

        const lines = await get('ReconciliationUpliftLine'
            + `?$filter=recon_ID eq 'B6%7C2026-09'&$top=5&$count=true`);
        assert.ok(lines.value.length === 5 && lines['@odata.count'] > 5,
            'the uplift table does not page - $top and $count disagree');
        out(`object page reads one entity; G/L expand gives 2; uplift table pages `
          + `(${lines['@odata.count']} line(s))`);
    });
});

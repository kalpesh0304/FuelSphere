/**
 * FuelSphere -> S/4HANA fuel ticket posting.
 *
 * CONVERTED FROM THE PACKAGE'S JEST FILE, which could never have run here.
 * It arrived as test/s4-fuel-posting-mapper.test.js using test() and expect();
 * this project has no jest dependency, and `npm test` is test/run-harnesses.sh,
 * which globs test/harness/*harness*.js and runs mocha. The file was in neither
 * the right directory nor the right dialect, so it would have been collected by
 * nothing and reported nothing - the same silent pass that ovp-manifest-harness
 * once produced, which is why run-harnesses.sh now checks for it explicitly.
 *
 * All eleven of its assertions are kept, with its real S2A values (contract
 * 7000000033, plant 3COK, JETA1), and the integration criteria added after.
 *
 * EXIT-1  the mapper builds the payload S/4's Gateway will accept
 * EXIT-2  LTR maps to L, and empty non-nullable properties are OMITTED
 * EXIT-3  validation refuses what S/4 would reject anyway
 * EXIT-4  the response maps onto the ticket, including the "d" wrapper
 * EXIT-5  a partial posting is readable: empty NUMC to null, code prefixed
 * EXIT-6  the model carries every column the handler writes
 * EXIT-7  the two triggers are wired - ticket save, and the invoice action
 * EXIT-8  PO and GR resolution prefers the ticket and still falls back
 * EXIT-9  the deployed posting mode is PINNED, valid, and honoured
 * EXIT-10 every attempt is recorded, the failures most of all
 * EXIT-11 a repost keeps the earlier attempt, and the ticket shows the latest
 * EXIT-12 the payload is built from the MAPPING TABLES, not the order
 * EXIT-13 the material is a fuel the tail is approved for, on that date
 * EXIT-14 the attempt stores what we SENT, not only what came back
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const fs = require('node:fs');

const M = require(`${PROJECT}/srv/lib/s4-fuel-posting-mapper`);
const out = (s) => process.stdout.write('      ' + s + '\n');

// Values taken from real S2A test postings.
const ticket = {
    ID: '7a1c5f2e-0000-4000-8000-000000000001',
    internal_number: 'FT-COK-20261005-001',
    ticket_number: 'SUP-778899',
    quantity: 40,
    uom_code: 'KG',
    delivery_timestamp: '2026-10-05T14:35:00Z',
    order: {
        contract: { s4_contract_number: '7000000033' },
        supplier: { s4_vendor_no: '10015' },
        airport: { s4_plant_code: '3COK' },
        product: { s4_material_number: 'JETA1' }
    },
    delivery: { density: 0.8 }
};

describe('S/4HANA fuel ticket posting', () => {

    // MOST OF THIS HARNESS NEEDS NO DATABASE - the mapper is pure, and that
    // is why it runs in seconds. EXIT-10 and EXIT-11 do: they assert what the
    // handler WRITES, which cannot be checked without somewhere to write it.
    // Deployed once here rather than per test.
    before(async function () {
        this.timeout(120000);
        if (!cds.db) await cds.deploy(await cds.load('*'));
        cds.context = { user: new cds.User.Privileged() };
    });

    // ------------------------------------------------------------- EXIT-1 --
    it('EXIT-1  the mapper builds the payload the Gateway will accept', () => {
        assert.deepStrictEqual(M.buildPostingRequest(ticket), {
            TicketNumber: 'FT-COK-20261005-001',
            Quantity: '40.000',
            Uom: 'KG',
            Density: '0.8000',
            Contract: '7000000033',
            Supplier: '10015',
            Plant: '3COK',
            Material: 'JETA1',
            PostingDate: `/Date(${Date.UTC(2026, 9, 5)})/`
        });
        out('decimals as strings, date as /Date(ms)/, external values for the conversion exits');

        assert.strictEqual(M.buildPostingRequest({ ...ticket, internal_number: null }).TicketNumber,
            ticket.ID, 'the idempotency key must fall back to the ticket ID');
    });

    // ------------------------------------------------------------- EXIT-2 --
    it('EXIT-2  LTR maps to L, and empty properties are omitted not nulled', () => {
        // EVERY GATEWAY PROPERTY IS NON-NULLABLE. Sending null is a 400, so
        // absence has to be absence.
        const payload = M.buildPostingRequest({
            ...ticket, uom_code: 'LTR', delivery: null,
            order: { contract: { s4_contract_number: '7000000033' } }
        });
        assert.strictEqual(payload.Uom, 'L');
        assert.ok(!('Density' in payload), 'Density was sent with no density to send');
        assert.ok(!('Supplier' in payload), 'Supplier was sent with no supplier to send');
        assert.ok(!Object.values(payload).includes(null), 'a null reached the payload');
        out(`LTR -> L; ${Object.keys(payload).length} properties sent, none null`);
    });

    // ------------------------------------------------------------- EXIT-3 --
    it('EXIT-3  validation refuses what S/4 would reject anyway', () => {
        assert.deepStrictEqual(M.validateRequest(M.buildPostingRequest(ticket)), [],
            'a complete contract-based request was refused');
        assert.strictEqual(
            M.validateRequest({ TicketNumber: 'FT-1', Quantity: '1.000', Plant: '3COK' }).length, 1,
            'plant without material is not enough to determine a contract');
        assert.ok(M.validateRequest({ TicketNumber: 'FT-1', Quantity: '0.000', Contract: '7000000033' })
            .includes('Quantity must be greater than zero'));
        out('three shapes checked: complete, plant-without-material, zero quantity');
    });

    // ------------------------------------------------------------- EXIT-4 --
    it('EXIT-4  the response maps onto the ticket, "d" wrapper and all', () => {
        const fields = M.mapPostingResult({ d: {
            Status: 'S', Message: 'Fuel ticket posted', Contract: '7000000033',
            PoNumber: '4500000598', PoItem: '00010', PoQuantity: '1.000', PoUnit: 'L',
            GrNumber: '5000000052', GrYear: '2026', InvNumber: '5105600103', InvYear: '2026',
            InvAmount: '3.670', Currency: 'AED'
        } });
        for (const [k, v] of Object.entries({
            s4_posting_status: 'S', s4_po_number: '4500000598', s4_po_item: '00010',
            s4_po_quantity: 1, s4_gr_number: '5000000052', s4_gr_year: '2026',
            s4_invoice_number: '5105600103', s4_invoice_amount: 3.67, s4_invoice_currency: 'AED'
        })) assert.strictEqual(fields[k], v, `${k} mapped to ${fields[k]}, expected ${v}`);

        // A COMPLETE POSTING KEEPS ITS MESSAGE UNPREFIXED. Nothing is missing,
        // so there is no step to name.
        assert.strictEqual(M.withErrorCode(fields).s4_posting_message, 'Fuel ticket posted');
        out('all thirteen fields mapped; a complete posting carries no error code');
    });

    // ------------------------------------------------------------- EXIT-5 --
    it('EXIT-5  a partial posting is readable rather than merely stored', () => {
        const fields = M.withErrorCode(M.mapPostingResult({
            Status: 'P',
            Message: 'Invoice posting failed for PO 4500000598: Maintain tolerance limits for tolerance key PP (CoCode 3000)',
            PoNumber: '4500000598', PoItem: '00010', GrNumber: '5000000052', GrYear: '2026',
            InvNumber: '', InvYear: '0000', InvAmount: '0.000', PoQuantity: '1.000'
        }));
        assert.strictEqual(fields.s4_posting_status, 'P');
        // EMPTY NUMC COMES BACK AS ZEROS. '0000' is not a year.
        assert.strictEqual(fields.s4_invoice_number, null);
        assert.strictEqual(fields.s4_invoice_year, null);
        assert.strictEqual(fields.s4_invoice_amount, null);
        assert.ok(fields.s4_posting_message.startsWith('INV406: Invoice posting failed'),
            `the message does not name the missing step: ${fields.s4_posting_message}`);
        assert.ok(fields.s4_posting_message.length <= 220, 'BAPI_MSG is 220 characters');

        assert.strictEqual(M.errorCodeFor({ s4_po_number: '4500000599' }), 'INT402', 'no GR is INT402');
        assert.strictEqual(M.errorCodeFor({}), 'INT401', 'nothing posted is INT401');

        // THE SPLIT THIS INTEGRATION TURNS ON. A ticket with a PO and a GR has
        // done what ticket capture is responsible for; the invoice belongs to
        // the Invoices app, so P is not a failure to warn about on save.
        assert.strictEqual(M.upliftPosted(fields), true,
            'a ticket with a PO and a GR must count as posted for the uplift');
        assert.strictEqual(M.upliftPosted({ s4_po_number: '45' }), false, 'no GR is not posted');
        out('P with PO+GR reads as uplift-posted, invoice still outstanding, INV406 named');
    });

    // ------------------------------------------------------------- EXIT-6 --
    it('EXIT-6  the model carries every column the handler writes', async () => {
        // THE PACKAGE DID NOT SHIP db/s4-fuel-posting.cds. Without this
        // criterion the handler would write columns the model does not have,
        // which fails at runtime on the one path nobody tests twice - saving a
        // ticket. Measured against the compiled model, not the file.
        const model = await cds.load('*');
        const ticketEntity = model.definitions['fuelsphere.FUEL_TICKETS'];
        assert.ok(ticketEntity, 'FUEL_TICKETS is not in the model');

        const written = Object.keys(M.mapPostingResult({ Status: 'S' })).concat(['s4_posted_at']);
        const missing = written.filter(c => !ticketEntity.elements[c]);
        out(`${written.length} column(s) written by the handler, ${missing.length} missing from the model`);
        assert.deepStrictEqual(missing, [],
            'the handler writes a column FUEL_TICKETS does not have');

        // And none of them may be mandatory or defaulted: "never attempted"
        // has to stay distinguishable from "attempted and returned nothing".
        const defaulted = written.filter(c => {
            const e = ticketEntity.elements[c];
            return e && (e.default !== undefined || e.notNull === true);
        });
        assert.deepStrictEqual(defaulted, [],
            'a posting column has a default, so an unposted ticket looks posted');
    });

    // ------------------------------------------------------------- EXIT-7 --
    it('EXIT-7  both triggers are wired, and to the right services', () => {
        // THE WIRING IS THE INTEGRATION. The mapper can be perfect and nothing
        // will post if register() was never called - and the deep-save path is
        // the one that matters most, because the order draft is where tickets
        // are normally captured and it does NOT fire CREATE on FuelTickets.
        const ticketSrv = fs.readFileSync(`${PROJECT}/srv/ticket-service.js`, 'utf8');
        assert.ok(/require\('\.\/lib\/s4-fuel-posting'\)\.register\(this\)/.test(ticketSrv),
            'TicketService never registers the posting handlers');

        const orderSrv = fs.readFileSync(`${PROJECT}/srv/order-service.js`, 'utf8');
        assert.ok(/s4Posting\.postTicketToS4/.test(orderSrv),
            'the order deep-save path does not post its tickets - a deep save fires no CREATE on FuelTickets');

        const invoiceSrv = fs.readFileSync(`${PROJECT}/srv/invoice-service.js`, 'utf8');
        assert.ok(/s4Posting\.postInvoiceTicketsToS4/.test(invoiceSrv),
            'postToS4HANA does not drive the S/4 invoice step');
        assert.ok(!/Simulated posting - no document was created/.test(invoiceSrv),
            'the invoice posting is still the simulation');

        // The retry action has to exist for a partial posting to be resumable.
        const action = fs.readFileSync(`${PROJECT}/srv/s4-fuel-posting.cds`, 'utf8');
        assert.ok(/action postToS4\(\)/.test(action), 'the retry action is not declared');
        out('ticket save, order deep save and the invoice action are all wired');
    });

    // ------------------------------------------------------------- EXIT-8 --
    it('EXIT-8  PO and GR resolution prefers the ticket and still falls back', () => {
        // 2,494 SEEDED LINES RESOLVE THROUGH THE SIMULATION. Preferring the
        // ticket without a fallback would fail INV464 and INV466 on every one
        // of them and take INV474's order-and-GR key with them.
        const src = fs.readFileSync(`${PROJECT}/srv/lib/invoice-checks.js`, 'utf8');
        assert.ok(/ticket\.s4_po_number \|\| out\.order\.s4_po_number/.test(src),
            'PO resolution does not prefer the ticket, or lost its fallback');
        assert.ok(/ticket\.s4_gr_number\s*\n?\s*\|\|\s*\(out\.delivery && out\.delivery\.s4_gr_number\)/.test(src),
            'GR resolution does not prefer the ticket, or lost its fallback');
        assert.ok(/po_source/.test(src) && /gr_source/.test(src),
            'the resolution does not record WHICH source answered');
        out('ticket first, order and delivery still accepted, and the source recorded');
    });

    // ------------------------------------------------------------- EXIT-9 --
    it('EXIT-9  the deployed posting mode is PINNED, valid, and honoured', () => {
        // THIS CRITERION CHANGED ON 19 Oct 2026, and the reason is recorded
        // here rather than lost in a diff.
        //
        // It used to assert the mode was NOT live, because the seed's master
        // data matched nothing in S2A - no COK airport, contracts
        // 4600000001.. against S2A's 7000000033 - so live meant every ticket
        // save made a real call and wrote an error onto the ticket.
        //
        // THAT PREMISE IS GONE. The S2A master data is now maintained through
        // the mapping apps, a real purchase order has been created against
        // contract 7000000033 at plant 3COK, and live was asked for
        // explicitly. A criterion that still refused `live` would be
        // asserting a fact that stopped being true, and the next person would
        // delete it rather than read it.
        //
        // WHAT IS STILL WORTH GUARDING is the thing that actually bit:
        // the value must be PINNED in mta.yaml. `cf set-env` survives a
        // restage and does NOT survive an MTA deploy, so a mode set only on
        // the command line is silently reverted by the next deploy - and a
        // posting that quietly goes back to mock looks exactly like a posting
        // that worked.
        const mta = fs.readFileSync(`${PROJECT}/mta.yaml`, 'utf8');
        const m = /FS_S4_POSTING_MODE:\s*(\w+)/.exec(mta);
        assert.ok(m, 'the deployed service does not pin FS_S4_POSTING_MODE at all - '
            + 'the next deploy will fall back to the code default, which is live');
        assert.ok(['live', 'mock', 'off'].includes(m[1]),
            `FS_S4_POSTING_MODE is pinned to "${m[1]}", which is not one of live, mock or off - `
          + 'an unrecognised value falls through to the default');

        // LIVE IS A DECISION, SO IT HAS TO READ AS ONE. A pin to live with no
        // note beside it is indistinguishable from a leftover, and the cost
        // of getting it wrong is real documents in S2A.
        if (m[1] === 'live') {
            const block = mta.slice(Math.max(0, m.index - 2000), m.index);
            assert.ok(/LIVE SINCE/.test(block),
                'the mode is pinned to live with nothing saying it was meant to be - '
              + 'every ticket save now creates a real PO and GR in S2A');
        }
        out(`deployed mode is pinned to ${m[1]}`);

        // And the switch has to be honoured, not just configured.
        const src = fs.readFileSync(`${PROJECT}/srv/lib/s4-fuel-posting.js`, 'utf8');
        assert.ok(/mode\(\) === 'off'/.test(src), 'off mode is not checked before posting');
        assert.ok(/mode\(\) === 'mock'/.test(src), 'mock mode never short-circuits the call');
    });

    // ------------------------------------------------------------ EXIT-10 --
    it('EXIT-10  every attempt is recorded, the failures most of all', async () => {
        // A FAILED ATTEMPT IS THE ROW THE ERROR LOG EXISTS FOR. The business
        // asked for a log "similar to the SAP application log", reachable
        // from a tile, saying why a posting failed - so an attempt that
        // created nothing must still leave a row, with its message.
        process.env.FS_S4_POSTING_MODE = 'mock';
        const s4 = require(`${PROJECT}/srv/lib/s4-fuel-posting`);
        const { SELECT } = cds.ql;

        // A ticket with no order cannot resolve a contract: validateRequest
        // refuses it before S/4 is called, which is the commonest failure.
        const bad = await cds.db.run(SELECT.one.from('fuelsphere.FUEL_TICKETS')
            .columns('ID').where({ order_ID: null }));
        assert.ok(bad, 'no un-ordered ticket to fail with');
        await s4.postTicketToS4(bad.ID);

        const attempts = await cds.db.run(SELECT.from('fuelsphere.S4_POSTING_ATTEMPTS')
            .where({ ticket_ID: bad.ID }));
        assert.strictEqual(attempts.length, 1, 'a failed posting left no history row');
        const a = attempts[0];
        assert.strictEqual(a.outcome, 'POERR',
            `a posting that created no PO recorded outcome ${a.outcome}, expected POERR`);
        assert.ok(!a.po_number && !a.gr_number, 'a failed attempt claims documents it did not create');

        const msgs = await cds.db.run(SELECT.from('fuelsphere.S4_POSTING_MESSAGES')
            .where({ attempt_ID: a.ID }));
        assert.ok(msgs.length >= 1, 'the failure recorded no message - the log would be empty');
        assert.strictEqual(msgs[0].step, 'PO', `the message blames step ${msgs[0].step}, expected PO`);
        out(`failed posting -> attempt ${a.attempt_no} ${a.outcome}, ${msgs.length} message(s), step ${msgs[0].step}`);
    });

    // ------------------------------------------------------------ EXIT-11 --
    it('EXIT-11  a repost keeps the earlier attempt, and the ticket shows the latest', async () => {
        // THE REQUIREMENT IN ONE SENTENCE: "keep track of all postings
        // (multiple posting and reversals) related to a ticket amendment".
        // Columns hold one posting; this asserts the history holds them all
        // WITHOUT the ticket's own columns changing meaning, because five
        // screens read those.
        process.env.FS_S4_POSTING_MODE = 'mock';
        const s4 = require(`${PROJECT}/srv/lib/s4-fuel-posting`);
        const { SELECT, UPDATE } = cds.ql;

        const t = await cds.db.run(SELECT.one.from('fuelsphere.FUEL_TICKETS')
            .columns('ID').where({ order_ID: { '!=': null } }));
        await s4.postTicketToS4(t.ID);
        const first = await cds.db.run(SELECT.one.from('fuelsphere.FUEL_TICKETS')
            .columns('s4_po_number').where({ ID: t.ID }));

        // Stand in for "reversed in S/4, post again": the status is cleared
        // so the handler does not short-circuit on an already-complete ticket.
        await cds.db.run(UPDATE('fuelsphere.FUEL_TICKETS')
            .set({ s4_posting_status: null }).where({ ID: t.ID }));
        await s4.postTicketToS4(t.ID);

        const attempts = await cds.db.run(SELECT.from('fuelsphere.S4_POSTING_ATTEMPTS')
            .where({ ticket_ID: t.ID }));
        assert.ok(attempts.length >= 2, `only ${attempts.length} attempt(s) recorded; the repost overwrote history`);

        const nos = attempts.map(a => Number(a.attempt_no)).sort((x, y) => x - y);
        assert.deepStrictEqual(nos, nos.map((_, i) => i + 1),
            `attempt numbers are ${nos.join(',')} - they must run 1, 2, 3 in the order attempted`);

        const pos = attempts.map(a => a.po_number).filter(Boolean);
        assert.strictEqual(new Set(pos).size, pos.length,
            'two attempts recorded the same PO - a repost must create new documents, not copy the old');

        const latest = await cds.db.run(SELECT.one.from('fuelsphere.FUEL_TICKETS')
            .columns('s4_po_number').where({ ID: t.ID }));
        const newest = attempts.sort((x, y) => y.attempt_no - x.attempt_no)[0];
        assert.strictEqual(latest.s4_po_number, newest.po_number,
            'the ticket does not show the latest attempt - the screens would read a superseded posting');
        assert.notStrictEqual(latest.s4_po_number, first.s4_po_number,
            'the repost did not move the ticket on');
        out(`${attempts.length} attempts kept; ticket shows attempt ${newest.attempt_no} (PO ${newest.po_number})`);
    });

    // ------------------------------------------------------------ EXIT-12 --
    it('EXIT-12  the payload is built from the mapping tables, not the order', async () => {
        // ASKED FOR DIRECTLY: "send the details from FuelSphere mapping
        // tables while posting PO, GR and FI document". The order records
        // what was bought; the maps record what S/4 accepts at that station,
        // for that carrier, on that date - and they are what the mapping apps
        // maintain. This asserts the payload follows the maps.
        const s4 = require(`${PROJECT}/srv/lib/s4-fuel-posting`);
        const { SELECT } = cds.ql;

        const t = await cds.db.run(SELECT.one.from('fuelsphere.FUEL_TICKETS')
            .columns('ID').where({ flight_ID: { '!=': null }, order_ID: { '!=': null } }));
        assert.ok(t, 'no ticket with both a flight and an order to resolve from');

        const full = await cds.db.run(SELECT.one.from('fuelsphere.FUEL_TICKETS', t.ID, x => {
            x('*'),
            x.order(o => {
                o.order_number,
                o.contract(c => { c.s4_contract_number }),
                o.supplier(sp => { sp.s4_vendor_no }),
                o.airport(a => { a.s4_plant_code, a.iata_code }),
                o.product(pr => { pr.s4_material_number })
            }),
            x.flight(f => { f.origin_airport, f.airline_code, f.flight_date }),
            x.delivery(d => { d.density })
        }));

        const r = await s4.resolvePostingMasterData(full);
        out('resolved from ' + JSON.stringify(r.sources));

        // THE SUPPLIER COMES THROUGH THE DESIGNATION, which is the same path
        // the flight screens use. A second resolution here would be the
        // defect this codebase has paid for twice.
        assert.ok(String(r.sources.supplier || '').startsWith('DESIGNATION_'),
            `supplier resolved from ${r.sources.supplier}, expected the designation`);

        // THE CONTRACT AND ITS LINE ITEM COME FROM THE STATION MAP.
        assert.strictEqual(r.sources.contract, 'STATION_SUPPLIER_MAP',
            `contract resolved from ${r.sources.contract}, expected the station-supplier map`);
        assert.ok(r.contractItem, 'no contract line item resolved - the station map carries one');

        // THE MATERIAL COMES FROM THE FUELS THE TAIL IS APPROVED FOR.
        //
        // This asserted TAIL_FUEL_TYPE - the single column on the tail master
        // - until 19 Oct 2026, when functional replaced that instruction with
        // "multiple fuel type mapped to each tail ... time dependent data".
        // The column is dead and AIRCRAFT_FUEL_TYPES answers instead; EXIT-13
        // below is what proves the rules. Here it is enough that the material
        // came from the approved list and not from the order.
        assert.ok(String(r.sources.material || '').startsWith('TAIL_APPROVED'),
            `material resolved from ${r.sources.material}, expected the tail's approved fuels`);

        // AND THE PAYLOAD CARRIES WHAT WAS RESOLVED, including ContractItem -
        // which S/4 has always accepted and this integration never sent.
        const payload = M.buildPostingRequest(full, r);
        assert.strictEqual(payload.Contract, r.contract);
        assert.strictEqual(payload.ContractItem, r.contractItem);
        assert.strictEqual(payload.Material, r.material);
        assert.strictEqual(payload.Supplier, r.supplier);

        // The order's own product must NOT be what goes to S/4 where the
        // tail says otherwise - that is the whole point of the change.
        const fromOrderOnly = M.buildPostingRequest(full);
        if (fromOrderOnly.Material && fromOrderOnly.Material !== r.material) {
            out(`material: maps say ${r.material}, the order said ${fromOrderOnly.Material}`);
        }
        assert.ok(!('ContractItem' in fromOrderOnly),
            'the order-only payload carries a contract line item, so this criterion proves nothing');

        // FALLING BACK IS ALLOWED AND MUST BE VISIBLE. An unmaintained map
        // must not stop a posting; it must say which source answered.
        assert.ok(Object.keys(r.sources).length >= 3,
            `only ${Object.keys(r.sources).length} source(s) recorded - a failed posting could not be explained`);
    });

    // ------------------------------------------------------------ EXIT-13 --
    it('EXIT-13  the material is a fuel the tail is approved for, on that date', async () => {
        // FUNCTIONAL, 19 Oct 2026: "Option to have multiple fuel type mapped
        // to each tail. Uplift can happen only for fuels types that are
        // allowed to be used for a tail. This needs to be time dependent
        // data." A single column on the tail master cannot express any of
        // that, which is why AIRCRAFT_FUEL_TYPES exists.
        const s4 = require(`${PROJECT}/srv/lib/s4-fuel-posting`);
        const { SELECT, INSERT, DELETE } = cds.ql;

        const approved = await cds.db.run(SELECT.from('fuelsphere.AIRCRAFT_FUEL_TYPES')
            .columns('registration', 'fuel_type', 'is_default'));
        assert.ok(approved.length > 0,
            'no approved fuel types seeded - the posting would fall back to the order on every ticket');

        // ONE DEFAULT PER TAIL. Two defaults means the posting chooses, and a
        // posting that chooses a material can be wrong without saying so.
        const byTail = new Map();
        for (const r of approved) {
            if (r.is_default !== true) continue;
            byTail.set(r.registration, (byTail.get(r.registration) || 0) + 1);
        }
        const multi = [...byTail.entries()].filter(([, n]) => n > 1);
        assert.deepStrictEqual(multi.slice(0, 5), [],
            'a tail has more than one default fuel type - the posting cannot choose');
        out(`${approved.length} approved fuel type(s) over ${byTail.size} tail(s), one default each`);

        // ---- it resolves, and says which rule answered -------------------
        const t = await cds.db.run(SELECT.one.from('fuelsphere.FUEL_TICKETS')
            .columns('ID').where({ flight_ID: { '!=': null }, order_ID: { '!=': null } }));
        const read = async (id) => cds.db.run(SELECT.one.from('fuelsphere.FUEL_TICKETS', id, x => {
            x('*'),
            x.order(o => {
                o.order_number,
                o.contract(c => { c.s4_contract_number }),
                o.supplier(sp => { sp.s4_vendor_no }),
                o.airport(a => { a.s4_plant_code, a.iata_code }),
                o.product(pr => { pr.s4_material_number })
            }),
            x.flight(f => { f.origin_airport, f.airline_code, f.flight_date }),
            x.delivery(d => { d.density })
        }));

        const r = await s4.resolvePostingMasterData(await read(t.ID));
        assert.ok(String(r.sources.material || '').startsWith('TAIL_APPROVED'),
            `material resolved from ${r.sources.material}; it must come from the approved list, `
          + 'not the dead column on the tail master and not the order');
        assert.ok(r.material, 'no material resolved at all');
        out(`material ${r.material} via ${r.sources.material}`);

        // ---- THE DEAD COLUMN MUST NOT BE READ ----------------------------
        // AIRCRAFT_REGISTRATIONS.fuel_type was yesterday's answer and is
        // superseded. If anything still read it, changing the approved list
        // would leave the posting unmoved - the silent drift this codebase
        // has paid for three times.
        //
        // THE CHECK READS CODE, NOT PROSE. Its first form was a text search
        // for AIRCRAFT_REGISTRATIONS near fuel_type, which matched the
        // COMMENT in the handler explaining that the column is dead - so
        // documenting the decision broke the test that guards it. A check
        // that punishes an explanation will have the explanation deleted.
        const src = require('node:fs').readFileSync(`${PROJECT}/srv/lib/s4-fuel-posting.js`, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments
            .replace(/^\s*\/\/.*$/gm, '');          // line comments
        assert.ok(!/AIRCRAFT_REGISTRATIONS/.test(src),
            'the posting still reads AIRCRAFT_REGISTRATIONS - the dead fuel_type column '
          + 'is being used as a second source of truth beside AIRCRAFT_FUEL_TYPES');

        // ---- TIME DEPENDENCE IS REAL, not decoration ---------------------
        // An approval that expired before the uplift must not answer for it.
        const reg = approved[0].registration;
        const planted = {
            ID: '00000000-0000-4000-8000-0000000fuel1'.replace('fuel1', 'bbbb1'),
            registration: reg, fuel_type: 'EXPIRED1',
            valid_from: '2000-01-01', valid_to: '2000-12-31',
            is_default: true, is_active: true
        };
        await cds.db.run(INSERT.into('fuelsphere.AIRCRAFT_FUEL_TYPES').entries(planted));
        try {
            const again = await s4.resolvePostingMasterData(await read(t.ID));
            assert.notStrictEqual(again.material, 'EXPIRED1',
                'an approval that lapsed in 2000 answered for a 2026 uplift - the window is ignored');
            out('an expired approval does not answer: still ' + again.material);
        } finally {
            await cds.db.run(DELETE.from('fuelsphere.AIRCRAFT_FUEL_TYPES').where({ ID: planted.ID }));
        }
    });

    // ------------------------------------------------------------ EXIT-14 --
    it('EXIT-14  the attempt stores what we SENT, not only what came back', async () => {
        // ASKED FOR ON 19 Oct 2026: "how can i see what exactly the payload is
        // getting passed to s4 system for PO and GR creation". The answer was
        // `cf logs`, which is a poor one - CF keeps hours, the question gets
        // asked days later, and it needs a login the person asking may not
        // have.
        //
        // AND THE RESPONSE ALONE CANNOT ANSWER IT. S/4 saying "contract
        // 7000000033 item 10 has no open quantity" is half an argument;
        // whether we should have sent that contract is the other half, and
        // that is unanswerable without the request beside it.
        const s4 = require(`${PROJECT}/srv/lib/s4-fuel-posting`);
        const { SELECT } = cds.ql;

        const t = await cds.db.run(SELECT.one.from('fuelsphere.FUEL_TICKETS')
            .columns('ID', 'internal_number')
            .where({ flight_ID: { '!=': null }, order_ID: { '!=': null } }));
        assert.ok(t, 'no ticket to post');

        await s4.postTicketToS4(t.ID);

        const attempt = await cds.db.run(SELECT.one.from('fuelsphere.S4_POSTING_ATTEMPTS')
            .columns('attempt_no', 'outcome', 'request_payload')
            .where({ ticket_ID: t.ID })
            .orderBy({ ref: ['attempt_no'], sort: 'desc' }));
        assert.ok(attempt, 'the posting recorded no attempt at all');
        assert.ok(attempt.request_payload,
            'the attempt stored no request payload - the only record of what we sent is '
          + 'a Cloud Foundry log line that rotates within hours');

        // IT MUST BE READABLE, and it must be the real thing.
        let payload;
        assert.doesNotThrow(() => { payload = JSON.parse(attempt.request_payload); },
            'the stored payload is not valid JSON');
        assert.ok(payload.TicketNumber, 'the stored payload has no ticket number');

        // THE RESOLUTION SOURCES TRAVEL WITH IT. "Contract 7000000033" does
        // not say which mapping table produced it, and that is the first
        // question asked when the contract turns out to be wrong.
        assert.ok(payload._resolvedFrom && typeof payload._resolvedFrom === 'object',
            'the payload does not record WHICH mapping table answered for each field');
        out(`attempt ${attempt.attempt_no} stored ${Object.keys(payload).length} payload field(s), `
          + `resolved from ${JSON.stringify(payload._resolvedFrom)}`);

        // ---- AND IT MUST REACH THE SCREEN -------------------------------
        // A payload stored where no screen shows it is a payload that still
        // needs a CF login to read, which was the whole complaint.
        const ann = fs.readFileSync(`${PROJECT}/srv/s4-posting-log-annotations.cds`, 'utf8');
        assert.ok(/request_payload/.test(ann),
            'the posting log does not show the payload - it is stored and invisible');
        assert.ok(/UI\.MultiLineText/.test(ann),
            'the payload is rendered as a single-line field, which shows the first forty '
          + 'characters of a twenty-line document');

        // NO SECRET MAY PASS THROUGH HERE. The payload is master data every
        // reader of this table can already see on the ticket; a credential
        // would be a new disclosure.
        const text = attempt.request_payload.toLowerCase();
        for (const word of ['password', 'secret', 'authorization', 'clientsecret', 'certificate']) {
            assert.ok(!text.includes(word),
                `the stored payload contains "${word}" - storing it would disclose a credential`);
        }
        out('payload is visible on the posting log, as a block, and carries no credential');
    });
});

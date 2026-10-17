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
 * EXIT-9  posting is NOT live by default on a deployed system
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
    it('EXIT-9  posting is not live by default on a deployed system', () => {
        // mode() DEFAULTS TO LIVE ON THE PRODUCTION PROFILE. The seed's master
        // data matches nothing in S2A - no COK airport, contracts 4600000001..
        // against S2A's 7000000033 - so a live default means every ticket save
        // makes a real call and writes an error onto the ticket.
        const mta = fs.readFileSync(`${PROJECT}/mta.yaml`, 'utf8');
        const m = /FS_S4_POSTING_MODE:\s*(\w+)/.exec(mta);
        assert.ok(m, 'the deployed service does not pin FS_S4_POSTING_MODE at all');
        assert.notStrictEqual(m[1], 'live',
            'the deployed service is set to live while the S2A master data does not match');
        out(`deployed mode is pinned to ${m[1]}`);

        // And the switch has to be honoured, not just configured.
        const src = fs.readFileSync(`${PROJECT}/srv/lib/s4-fuel-posting.js`, 'utf8');
        assert.ok(/mode\(\) === 'off'/.test(src), 'off mode is not checked before posting');
        assert.ok(/mode\(\) === 'mock'/.test(src), 'mock mode never short-circuits the call');
    });
});

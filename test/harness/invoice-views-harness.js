/**
 * THE INVOICE VIEWS, AND THE CLICK THAT OPENED THE WRONG THING.
 *
 * The ticket number on an invoice line is a door into the Fuel Tickets app.
 * It opened onto "Sorry, we can't find this page", and the launchpad URL said
 * exactly why: ID=f1c00001-...-0001, which is the INVOICE LINE's own id. Fiori
 * passes the whole row as parameters, the row's ID won over the mapping, and
 * the tickets app dutifully tried to open FuelTickets(ID=<an invoice line>).
 *
 * WHAT THIS CAN AND CANNOT PROVE. Cross-app navigation resolves through the
 * launchpad, which no harness can drive. So this proves the contract on BOTH
 * sides of the launchpad instead: that the annotation the page receives sends
 * the TICKET's id under the name ID, and that the tickets service opens
 * exactly that ticket at exactly that key - while the old id still 404s. If
 * both halves hold, the launchpad has nothing left to get wrong except its own
 * routing, which the other apps in this project already exercise.
 *
 *   EXIT-1  the EDMX carries the mapping: line ID suppressed, ticket_ID -> ID
 *   EXIT-2  applied to a REAL line row, the parameters name the ticket
 *   EXIT-3  the ticket opens at that key; the line's key still 404s
 *   EXIT-4  ticket_number is a filter field on the tickets app
 *   EXIT-5  the line view resolves the flight and both quantities in kg
 *   EXIT-6  the three variances ADD UP on a priced line
 *   EXIT-7  the header view is the sum of its lines
 *   EXIT-8  every view column is PRESENT on the draft as well as the active
 *   EXIT-9  a narrow $select still populates the row
 *   EXIT-10 posting and payment simulate, and refuse what they must
 *   EXIT-11 the matcher persists what the ticket said
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const test = cds.test(PROJECT);
const out = s => process.stdout.write('      ' + s + '\n');

const INV = '/odata/v4/invoice';
const TKT = '/odata/v4/tickets';
const n = v => (v === null || v === undefined ? null : Number(v));

// The exact row from the reported failure.
const INVOICE_ID = 'f1c00000-0000-4000-8000-000000000001';
const LINE_ID    = 'f1c00001-0000-4000-8000-000000000001';
const TICKET_ID  = 'b8c9d0e1-8888-4000-8000-0000000d0004';
const TICKET_NO  = 'WFS-YYZ-20260410-31';
const GATED_ID   = '21a00004-0000-4000-8000-000000000001';

const call = async f => {
    try { const r = await f(); return { status: r.status, data: r.data }; }
    catch (e) { return { status: e.response?.status || e.status, msg: e.response?.data?.error?.message || e.message }; }
};

/**
 * Fiori's documented SemanticObjectMapping, applied to one row: every LOCAL
 * property is emitted under its mapped name, dropped where mapped to an empty
 * string, and passed through under its own name otherwise. Driven from the
 * annotation in the model, never from a copy in this file - so this asserts
 * what the page actually receives.
 */
function navParams(row, mapping) {
    const rename = new Map();
    for (const m of mapping) {
        const local = typeof m.LocalProperty === 'object' ? m.LocalProperty['='] : m.LocalProperty;
        rename.set(local, m.SemanticObjectProperty);
    }
    const params = {};
    for (const [k, v] of Object.entries(row)) {
        if (!rename.has(k)) { if (!(k in params)) params[k] = v; continue; }
        const target = rename.get(k);
        if (target === '') continue;            // suppressed
        params[target] = v;                      // renamed - wins over a passthrough
    }
    return params;
}

describe('Invoice views - header, lines, and the ticket link', () => {
    before(test.data.reset);

    // ------------------------------------------------------------ navigation
    it('EXIT-1 - the EDMX suppresses the line ID and sends the ticket ID', async () => {
        const edmx = cds.compile.to.edmx(cds.model, { service: 'InvoiceService' });
        const i = edmx.indexOf('Target="InvoiceService.InvoiceItems/ticket_number"');
        assert.ok(i >= 0, 'no annotations target InvoiceItems/ticket_number');
        const block = edmx.slice(i, edmx.indexOf('</Annotations>', i));

        assert.match(block, /Term="Common.SemanticObject" String="fueltickets"/,
            'the semantic object must be fueltickets - the intent the tickets app registers');
        assert.match(block, /PropertyPath="ID"\/>\s*<PropertyValue Property="SemanticObjectProperty" String=""/,
            "the line's own ID must be SUPPRESSED - it is what produced the 404");
        assert.match(block, /PropertyPath="ticket_ID"\/>\s*<PropertyValue Property="SemanticObjectProperty" String="ID"/,
            'ticket_ID must travel under the name ID');
        out('EDMX: fueltickets; line ID -> "" (suppressed); ticket_ID -> ID; ticket_number passed');
    });

    it('EXIT-2 - applied to the reported row, the parameters name the TICKET', async () => {
        const mapping = cds.model.definitions['InvoiceService.InvoiceItems']
            .elements.ticket_number['@Common.SemanticObjectMapping'];
        assert.ok(Array.isArray(mapping) && mapping.length, 'no mapping in the model');

        // The row exactly as the table fetched it - its own ID included.
        const r = await test.GET(`${INV}/InvoiceItems(ID=${LINE_ID},IsActiveEntity=true)`);
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.data.ticket_ID, TICKET_ID, 'precondition: the line resolved to that ticket');

        const p = navParams(r.data, mapping);
        assert.strictEqual(p.ID, TICKET_ID,
            `the link would send ID=${p.ID} - it must be the ticket, ${TICKET_ID}`);
        assert.notStrictEqual(p.ID, LINE_ID,
            'the link still sends the invoice LINE id - this is exactly the reported 404');
        assert.strictEqual(p.ticket_number, TICKET_NO, 'ticket_number must travel too');
        out(`reported row -> ID=${p.ID} (the ticket), not ${LINE_ID} (the line)`);
    });

    it('EXIT-3 - the ticket opens at that key, and the line key still 404s', async () => {
        const ok = await call(() => test.GET(`${TKT}/FuelTickets(ID=${TICKET_ID},IsActiveEntity=true)`));
        assert.strictEqual(ok.status, 200, `the tickets app cannot open the ticket: ${ok.msg}`);
        assert.strictEqual(ok.data.ticket_number, TICKET_NO, 'it opened a different ticket');

        const bad = await call(() => test.GET(`${TKT}/FuelTickets(ID=${LINE_ID},IsActiveEntity=true)`));
        assert.strictEqual(bad.status, 404,
            'instrument check: the line key must 404 in the tickets app, or this test proves nothing');
        out(`FuelTickets(ID=ticket) -> 200 ${ok.data.ticket_number}; FuelTickets(ID=line) -> 404, as reported`);
    });

    it('EXIT-4 - ticket_number is a filter field, and filters to one ticket', async () => {
        const sel = cds.model.definitions['TicketService.FuelTickets']['@UI.SelectionFields'] || [];
        const names = sel.map(s => (typeof s === 'object' ? s['='] : s));
        assert.ok(names.includes('ticket_number'),
            `ticket_number must be a SelectionField or a startup parameter is ignored; got ${names.join(', ')}`);

        const r = await test.GET(`${TKT}/FuelTickets?$filter=ticket_number eq '${TICKET_NO}' and IsActiveEntity eq true`);
        assert.strictEqual(r.data.value.length, 1, 'the filter must land on exactly one ticket');
        out(`filter ticket_number='${TICKET_NO}' -> exactly 1 row`);
    });

    // ------------------------------------------------------------ line view
    it('EXIT-5 - the line resolves its flight and both quantities in kg', async () => {
        const r = (await test.GET(`${INV}/InvoiceItems(ID=${LINE_ID},IsActiveEntity=true)`)).data;

        // The ticket says AC412 on 2026-04-10; seed tickets carry no flight
        // association, so this proves the number-and-date route resolves.
        assert.strictEqual(r.flight_number_v, 'AC412', `flight number: ${r.flight_number_v}`);
        assert.strictEqual(String(r.flight_date_v).slice(0, 10), '2026-04-10', `flight date: ${r.flight_date_v}`);
        assert.ok(r.dep_airport && r.arr_airport, 'sector must resolve with the flight');

        // Both sides in kilograms, the invoice converted at the TICKET's density.
        assert.strictEqual(n(r.ticket_quantity_kg), 2305.76, 'ticket mass from the ticket');
        const expectInvKg = Number((2881.25 * (2305.76 / 2884)).toFixed(2));
        assert.strictEqual(n(r.inv_qty_kg), expectInvKg,
            `invoice kg at the ticket density: expected ${expectInvKg}, got ${r.inv_qty_kg}`);
        assert.strictEqual(n(r.qty_variance_kg), Number((expectInvKg - 2305.76).toFixed(2)),
            'qty variance is invoice kg less ticket kg');

        // THE SEED TICKET WAS NEVER PRICED - no total_amount in the seed. So
        // the money side is blank, and the verdict must NOT read Within: only
        // quantity was assessable, and a pass on half the evidence is no pass.
        assert.strictEqual(r.ticket_amount, null, 'an unpriced ticket has no amount');
        assert.strictEqual(r.total_variance, null, 'no ticket amount, no money variance');
        assert.notStrictEqual(r.tolerance_status, 'WITHIN',
            'price was never assessed, so the line must not read Within tolerance');
        out(`line: ${r.flight_number_v} ${String(r.flight_date_v).slice(0, 10)} ${r.dep_airport}-${r.arr_airport}; `
            + `invoice ${r.inv_qty_kg} kg vs ticket ${r.ticket_quantity_kg} kg = ${r.qty_variance_kg} kg; `
            + `unpriced ticket -> money blank, verdict ${r.tolerance_v || 'not assessed'}`);
    });

    it('EXIT-6 - on a priced line the three variances add up exactly', async () => {
        // Price the reported ticket so the money side has something to say.
        await cds.db.run(UPDATE('fuelsphere.FUEL_TICKETS')
            .set({ total_amount: 2000.00 }).where({ ID: TICKET_ID }));
        const r = (await test.GET(`${INV}/InvoiceItems(ID=${LINE_ID},IsActiveEntity=true)`)).data;

        const tktRate = n(r.ticket_rate);
        assert.ok(tktRate > 0, 'the ticket rate must derive from amount over mass');
        assert.strictEqual(n(r.total_variance), Number((2045.69 - 2000).toFixed(2)),
            'total variance is invoice amount less ticket amount');

        // price + qty x ticket rate = total, to the cent.
        const recomposed = n(r.price_variance) + n(r.qty_variance_kg) * tktRate;
        assert.ok(Math.abs(recomposed - n(r.total_variance)) < 0.05,
            `variances do not add up: price ${r.price_variance} + qty ${r.qty_variance_kg} x ${tktRate} `
            + `= ${recomposed.toFixed(2)}, total ${r.total_variance}`);
        assert.ok(['WITHIN', 'EXCEEDED'].includes(r.tolerance_status),
            'with both sides priced, the line must now reach a verdict');
        out(`total ${r.total_variance} = price ${r.price_variance} + qty ${r.qty_variance_kg} kg x ${tktRate}; `
            + `verdict ${r.tolerance_v}`);
    });

    // ------------------------------------------------------------ header view
    it('EXIT-7 - every header is the sum of its lines', async () => {
        const r = await test.GET(`${INV}/Invoices?$filter=IsActiveEntity eq true`);
        assert.ok(r.data.value.length > 0, 'no invoices');
        let checked = 0;
        for (const h of r.data.value) {
            assert.strictEqual(h.reconciled_lines + h.unreconciled_lines, h.total_lines,
                `${h.invoice_number}: reconciled + unreconciled must equal total lines`);
            if (h.total_inv_amount !== null && h.total_tkt_amount !== null) {
                assert.ok(Math.abs(n(h.variance_value) - (n(h.total_inv_amount) - n(h.total_tkt_amount))) < 0.01,
                    `${h.invoice_number}: variance must be invoice total less ticket total`);
                checked += 1;
            }
            assert.ok(['In process', 'Posted', 'Paid', 'Cancelled'].includes(h.invoice_status_v),
                `${h.invoice_number}: status must read as the spec groups it, got ${h.invoice_status_v}`);
        }
        const h = r.data.value.find(x => x.ID === INVOICE_ID);
        assert.strictEqual(h.flight_number_v, 'AC412', 'a single-flight invoice shows its flight');
        out(`${r.data.value.length} headers: line counts reconcile on all; variance additive on ${checked}; `
            + `${h.invoice_number} -> flight ${h.flight_number_v}`);
    });

    it('EXIT-8 - every view column is present on the draft as well as the active', async () => {
        const HDR = ['flight_number_v', 'invoice_status_v', 'total_lines', 'reconciled_lines',
                     'total_inv_amount', 'total_tkt_amount', 'variance_value', 'tolerance_v'];
        const LN  = ['flight_number_v', 'inv_qty_kg', 'total_variance', 'qty_variance_kg',
                     'price_variance', 'tolerance_v', 'vendor_invoice_number'];

        await test.POST(`${INV}/Invoices(ID=${GATED_ID},IsActiveEntity=true)/InvoiceService.draftEdit`, {});
        const d = (await test.GET(`${INV}/Invoices(ID=${GATED_ID},IsActiveEntity=false)`)).data;
        const missH = HDR.filter(k => !(k in d));
        assert.strictEqual(missH.length, 0, `ABSENT from the draft header (infinite spinner): ${missH.join(', ')}`);

        const dl = (await test.GET(`${INV}/Invoices(ID=${GATED_ID},IsActiveEntity=false)/items`)).data.value;
        assert.ok(dl.length > 0, 'the draft must carry its lines');
        const missL = LN.filter(k => !(k in dl[0]));
        assert.strictEqual(missL.length, 0, `ABSENT from the draft line: ${missL.join(', ')}`);

        await test.POST(`${INV}/Invoices(ID=${GATED_ID},IsActiveEntity=false)/InvoiceService.draftDiscard`, {})
            .catch(() => {});
        out(`draft header carries all ${HDR.length}; draft line carries all ${LN.length}`);
    });

    it('EXIT-9 - a narrow $select still populates the line', async () => {
        const sel = 'ID,line_number,flight_number_v,inv_qty_kg,ticket_quantity_kg,qty_variance_kg';
        const r = await test.GET(`${INV}/InvoiceItems?$select=${sel}&$filter=ID eq ${LINE_ID}`);
        const row = r.data.value[0];
        assert.strictEqual(row.flight_number_v, 'AC412',
            'flight blank under $select - the derivation read ticket_ID off a payload that lacked it');
        assert.ok(row.inv_qty_kg !== null && row.qty_variance_kg !== null, 'quantities blank under $select');
        out(`$select of ${sel.split(',').length} columns, no ticket_ID: flight ${row.flight_number_v}, `
            + `qty variance ${row.qty_variance_kg} kg`);
    });

    // ------------------------------------------------------------ posting
    it('EXIT-10 - posting and payment simulate, and refuse what they must', async () => {
        const A = `${INV}/Invoices(ID=${INVOICE_ID},IsActiveEntity=true)`;

        // Payment before posting is refused.
        const early = await call(() => test.POST(`${A}/InvoiceService.recordPayment`, {}));
        assert.strictEqual(early.status, 409, 'an unposted invoice must not be payable');

        // A gated invoice cannot post, simulated or not.
        const gated = await call(() => test.POST(
            `${INV}/Invoices(ID=${GATED_ID},IsActiveEntity=true)/InvoiceService.postToS4HANA`, {}));
        assert.strictEqual(gated.status, 409, 'a GATED invoice must be refused');
        assert.match(gated.msg || '', /posting gate/i, 'the refusal must say why');

        // The clear one posts.
        const post = await call(() => test.POST(`${A}/InvoiceService.postToS4HANA`, {}));
        assert.strictEqual(post.status, 200, `posting failed: ${post.msg}`);
        let h = (await test.GET(A)).data;
        assert.strictEqual(h.status, 'POSTED');
        assert.strictEqual(h.invoice_status_v, 'Posted', 'the display must read Posted, not jump to Paid');
        assert.match(h.s4_document_number || '', /^51\d{8}$/, 'simulated FI document');
        assert.match(h.sap_invoice_number || '', /^5105\d{6}$/, 'simulated SAP invoice number');
        assert.ok(h.posting_date && h.received_date, 'posting and received dates stamped');
        assert.strictEqual(h.payment_date, null, 'posting must NOT fabricate a payment');

        // Twice is refused.
        const again = await call(() => test.POST(`${A}/InvoiceService.postToS4HANA`, {}));
        assert.strictEqual(again.status, 409, 'posting twice must be refused');

        // Then it pays.
        const pay = await call(() => test.POST(`${A}/InvoiceService.recordPayment`, {}));
        assert.strictEqual(pay.status, 200, `payment failed: ${pay.msg}`);
        h = (await test.GET(A)).data;
        assert.strictEqual(h.status, 'PAID');
        assert.strictEqual(h.invoice_status_v, 'Paid');
        assert.match(h.s4_payment_document || '', /^15\d{8}$/, 'simulated clearing document');
        assert.ok(h.payment_date, 'payment date stamped');
        out(`gated refused; posted ${h.s4_document_number} / SAP ${h.sap_invoice_number}; `
            + `twice refused; paid ${h.s4_payment_document} on ${h.payment_date}`);
    });

    // ------------------------------------------------------------ matcher
    it('EXIT-11 - the matcher persists what the ticket said, and the flight', async () => {
        const V = 'f1c00000-0000-4000-8000-000000000002';
        await test.POST(`${INV}/Invoices(ID=${V},IsActiveEntity=true)/InvoiceService.validateForPosting`, {})
            .catch(() => {});
        const lines = await cds.db.run(SELECT.from('fuelsphere.INVOICE_ITEMS')
            .columns('ID', 'ticket_ID', 'ticket_quantity_kg', 'flight_ID').where({ invoice_ID: V }));
        const resolved = lines.filter(l => l.ticket_ID);
        assert.ok(resolved.length > 0, 'precondition: at least one line resolves to a ticket');
        for (const l of resolved) {
            assert.ok(l.ticket_quantity_kg !== null,
                'a resolved line must STORE the ticket mass - WP-35 exit criterion');
            assert.ok(l.flight_ID, 'a resolved line must STORE its flight');
        }
        out(`${resolved.length} resolved line(s): ticket mass and flight now stored by the matcher`);
    });
});

/**
 * FuelSphere -> S/4HANA fuel ticket posting (PO -> GR -> supplier invoice).
 *
 * Calls SAP S2A OData V2 ZFS_FUEL_POSTING_SRV (POST /FuelPostingSet) through the BTP
 * destination configured in cds.requires.ZFS_FUEL_POSTING_SRV and stores the returned
 * document numbers on FUEL_TICKETS (fields from db/s4-fuel-posting.cds).
 *
 * S/4 is idempotent per TicketNumber: posting the same ticket again returns the
 * documents already created, or resumes at the step that failed (PO / GR / invoice).
 * So a retry is always safe - also after a timeout where the outcome is unknown.
 *
 * ===========================================================================
 * TWO TRIGGERS, ONE ENDPOINT - decision of 13 Oct 2026.
 *
 *   TICKET SAVE      the physical uplift happened, so the PO and the GR follow
 *                    it. Driven by after('CREATE') below.
 *   INVOICE POSTING  the supplier's document arrived and was verified, so the
 *                    invoice follows THAT. Driven by
 *                    InvoiceService.postToS4HANA, which calls postTicketToS4
 *                    once per ticket on the invoice.
 *
 * THE SPLIT IS OURS, NOT S/4'S, and that is a limitation worth stating plainly.
 * FuelPostingSet runs PO -> GR -> invoice in one call and takes no parameter
 * saying where to stop. Today the invoice step fails anyway - company code
 * 3000 has no tolerance key PP - so ticket save returns P with a PO and a GR,
 * which is exactly the intended behaviour by accident rather than by design.
 * The moment OMR6 is maintained, ticket save WILL also post the invoice.
 *
 * If the separation has to hold after that, S/4 needs a step flag on
 * FuelPostingSet; until then the second trigger is a resume, not a gate.
 * ===========================================================================
 *
 * Usage (in a service implementation, e.g. srv/ticket-service.js init()):
 *     require('./lib/s4-fuel-posting').register(this);
 *
 * Mode (env FS_S4_POSTING_MODE): live | mock | off
 *   default: live for profiles production/hybrid, otherwise mock (no S/4 call)
 */
'use strict';

const cds = require('@sap/cds');
const { SELECT, UPDATE } = cds.ql;
const M = require('./s4-fuel-posting-mapper');

const LOG = cds.log('s4-posting');
const REMOTE_SERVICE = 'ZFS_FUEL_POSTING_SRV';
const ENTITY_SET_PATH = '/FuelPostingSet';

function mode() {
    const explicit = process.env.FS_S4_POSTING_MODE;
    if (explicit) return explicit.toLowerCase();
    const profiles = cds.env.profiles || [];
    return profiles.includes('production') || profiles.includes('hybrid') ? 'live' : 'mock';
}

function keyOf(params) {
    const p = params && params[0];
    return p && typeof p === 'object' ? p.ID : p;
}

/** Ticket with everything the S/4 request needs (runs in the caller's transaction) */
async function readTicket(ID) {
    const { FUEL_TICKETS } = cds.entities('fuelsphere');
    return SELECT.one.from(FUEL_TICKETS, ID, t => {
        t('*'),
        t.order(o => {
            o.order_number,
            o.contract(c => { c.s4_contract_number }),
            o.supplier(s => { s.s4_vendor_no }),
            o.airport(a => { a.s4_plant_code }),
            o.product(p => { p.s4_material_number })
        }),
        t.delivery(d => { d.density })
    });
}

/** Local development without S/4: clearly fake numbers (prefix 99) */
function mockResponse(payload) {
    const seq = String(Date.now()).slice(-6);
    return {
        TicketNumber: payload.TicketNumber,
        Status: M.STATUS.COMPLETE,
        Message: 'MOCK posting - S/4HANA was not called',
        Contract: payload.Contract || '7000000033',
        PoNumber: `4599${seq}`,
        PoItem: '00010',
        PoQuantity: payload.Quantity,
        PoUnit: payload.Uom,
        GrNumber: `5099${seq}`,
        GrYear: String(new Date().getFullYear()),
        InvNumber: `5199${seq}`,
        InvYear: String(new Date().getFullYear()),
        // '0.00' WOULD BECOME NULL. toNumberOrNull maps zero to null, so the
        // package's mock never populated the amount and a mock run could not
        // exercise the column at all. A nominal figure keeps the mock honest
        // about its shape without pretending to be a real price.
        InvAmount: payload.Quantity ? String((Number(payload.Quantity) * 3.67).toFixed(2)) : '1.00',
        Currency: 'AED'
    };
}

async function callS4(payload) {
    if (mode() === 'mock') return mockResponse(payload);
    const s4 = await cds.connect.to(REMOTE_SERVICE);
    return s4.send({
        method: 'POST',
        path: ENTITY_SET_PATH,
        data: payload,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' }
    });
}

/**
 * Post one ticket to S/4 and persist the result on FUEL_TICKETS.
 * Never throws for S/4 problems - the outcome is in s4_posting_status / s4_posting_message.
 * @returns {Promise<object>} the s4_* fields written to the ticket
 */
async function postTicketToS4(ID) {
    const { FUEL_TICKETS } = cds.entities('fuelsphere');
    const ticket = await readTicket(ID);
    if (!ticket) throw new Error(`Fuel ticket ${ID} not found`);

    if (ticket.s4_posting_status === M.STATUS.COMPLETE) {
        LOG.info(`Ticket ${ticket.internal_number} already posted (PO ${ticket.s4_po_number})`);
        return {};
    }

    const payload = M.buildPostingRequest(ticket);
    const problems = M.validateRequest(payload);
    let fields;

    if (problems.length) {
        fields = { s4_posting_status: M.STATUS.ERROR, s4_posting_message: problems.join('; ') };
    } else {
        try {
            LOG.info(`Posting ticket ${payload.TicketNumber} to S/4`, payload);
            fields = M.mapPostingResult(await callS4(payload));
        } catch (err) {
            // HTTP 400 = S/4 rejected the ticket, nothing posted. Anything else (timeout,
            // 5xx, destination) = outcome unknown -> keep earlier numbers/status, retry later.
            const status = M.httpStatusOf(err);
            LOG.error(`S/4 posting of ticket ${payload.TicketNumber} failed (HTTP ${status})`, err.message);
            fields = {
                s4_posting_status: status === 400 || !ticket.s4_posting_status
                    ? M.STATUS.ERROR : ticket.s4_posting_status,
                s4_posting_message: M.extractErrorMessage(err)
            };
        }
    }

    fields = M.withErrorCode({ ...pickS4(ticket), ...fields });
    fields.s4_posted_at = new Date().toISOString();
    await UPDATE(FUEL_TICKETS, ID).with(fields);
    return fields;
}

function pickS4(ticket) {
    return Object.fromEntries(Object.entries(ticket).filter(([k]) => k.startsWith('s4_')));
}

/**
 * Post the invoice step for every ticket on one FuelSphere invoice.
 *
 * ADDED 13 Oct 2026, for InvoiceService.postToS4HANA.
 *
 * ONE S/4 INVOICE PER TICKET, where a FuelSphere invoice spans many. S/4 keys
 * FuelPostingSet on the ticket, so an 80-line invoice is up to 80 calls and
 * up to 80 S/4 invoice documents. There is no single S/4 invoice number for a
 * FuelSphere invoice, which is why the numbers live on the tickets and the
 * invoice shows them per line.
 *
 * DISTINCT TICKETS, NOT LINES. A ticket billed for fuel AND for into-plane
 * service carries two lines on two invoices (7 Oct 2026), and within one
 * invoice the same ticket can appear more than once. Posting per line would
 * call S/4 twice for one ticket - harmless, because it is idempotent, but it
 * would double the wait and report a count nobody could reconcile.
 *
 * @returns {Promise<object>} { attempted, posted, failed, results: [...] }
 */
async function postInvoiceTicketsToS4(invoiceID) {
    const lines = await cds.db.run(SELECT.from('fuelsphere.INVOICE_ITEMS')
        .columns('ticket_ID', 'line_number')
        .where({ invoice_ID: invoiceID }));

    const ticketIds = [...new Set(lines.map(l => l.ticket_ID).filter(Boolean))];
    const results = [];
    let posted = 0, failed = 0;

    for (const ticketID of ticketIds) {
        try {
            const fields = await postTicketToS4(ticketID);
            const ok = Boolean(fields.s4_invoice_number);
            if (ok) posted += 1; else failed += 1;
            results.push({
                ticketID,
                s4_invoice_number: fields.s4_invoice_number || null,
                s4_invoice_year: fields.s4_invoice_year || null,
                s4_invoice_amount: fields.s4_invoice_amount ?? null,
                s4_posting_status: fields.s4_posting_status || null,
                s4_posting_message: fields.s4_posting_message || null
            });
        } catch (err) {
            failed += 1;
            LOG.error(`Invoice-step posting of ticket ${ticketID} failed`, err);
            results.push({ ticketID, s4_invoice_number: null, s4_posting_message: err.message });
        }
    }

    // LINES WITHOUT A TICKET ARE REPORTED, NOT SKIPPED SILENTLY. A line that
    // resolved to nothing is INV450's finding, and an invoice posted while
    // some of it reached no ticket must say so rather than claim a clean run.
    const unresolved = lines.filter(l => !l.ticket_ID).length;

    return { attempted: ticketIds.length, posted, failed, unresolved, results };
}

/**
 * Wire posting into a service that exposes FUEL_TICKETS:
 *  - auto-post after a new ticket is saved (draft activation = CREATE on the active entity)
 *  - bound action postToS4 for manual retry (declared in srv/s4-fuel-posting.cds)
 */
function register(srv, entityName = 'FuelTickets') {
    const entity = srv.entities[entityName];
    if (!entity) throw new Error(`[s4-posting] ${srv.name} has no entity ${entityName}`);

    srv.after('CREATE', entity, async (result, req) => {
        if (mode() === 'off') return;
        const ID = (result && result.ID) || (req.data && req.data.ID);
        if (!ID) return;
        try {
            const fields = await postTicketToS4(ID);
            Object.assign(result, fields); // save response already carries the S/4 numbers
            // WARN ON THE UPLIFT, NOT ON THE INVOICE. The package warned
            // whenever the status was not S, which includes every ticket
            // waiting for an invoice nobody has captured - a warning on every
            // single save. PO and GR are what ticket capture is responsible
            // for; the invoice is the Invoices app's job.
            if (Object.keys(fields).length && !M.upliftPosted(fields)) {
                req.warn(`Ticket saved, S/4HANA PO/GR posting incomplete: ${fields.s4_posting_message}`);
            }
        } catch (err) {
            LOG.error(`Auto-posting of ticket ${ID} failed`, err);
            req.warn(`Ticket saved, S/4HANA posting failed: ${err.message}`);
        }
    });

    srv.on('postToS4', entity, async (req) => {
        const ID = keyOf(req.params);
        if (mode() === 'off') return req.error(409, 'S/4HANA posting is switched off (FS_S4_POSTING_MODE=off)');
        await postTicketToS4(ID);
        return SELECT.one.from(entity, ID);
    });

    LOG.info(`S/4 fuel posting registered on ${srv.name}.${entityName} (mode: ${mode()})`);
}

module.exports = { register, postTicketToS4, postInvoiceTicketsToS4, mode };

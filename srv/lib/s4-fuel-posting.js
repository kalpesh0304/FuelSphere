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
const { SELECT, UPDATE, INSERT } = cds.ql;
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
            // iata_code as well as the plant: the mapping resolution keys on
            // the station, and the order's airport is where it comes from
            // when the ticket has no flight.
            o.airport(a => { a.s4_plant_code, a.iata_code }),
            o.product(p => { p.s4_material_number })
        }),
        // THE STATION, CARRIER AND DATE THE MAPS ARE KEYED ON. Without the
        // flight, resolvePostingMasterData falls back to the order's airport
        // and cannot scope by carrier at all.
        t.flight(f => { f.origin_airport, f.airline_code, f.flight_date }),
        t.delivery(d => { d.density })
    });
}

/**
 * The master data S/4 needs, resolved from the FuelSphere MAPPING TABLES.
 *
 * ASKED FOR DIRECTLY, 18 Oct 2026: "send the details from FuelSphere mapping
 * tables while posting PO, GR and FI document".
 *
 * WHY THIS IS NOT A DETAIL. The payload used to take plant, supplier,
 * contract and material off the ORDER. The order records what was bought;
 * the maps record what S/4 is configured to accept at that station for that
 * carrier, on that date, and they are what the mapping apps maintain. With
 * the order as the source, correcting a plant meant editing orders; with the
 * maps it means editing the map, which is the screen built for it.
 *
 * THE CHAIN, AND WHY EACH LINK IS WHERE IT IS:
 *
 *   plant      STATION_PLANT_MAP (airport, carrier, date). One station is
 *              one plant for one carrier at a time - CAR403 enforces it.
 *
 *   supplier   the designation: the flight-level override if there is one,
 *              otherwise the station default. Through resolveDesignation, so
 *              the posting and the flight screens answer "who fuels this"
 *              the same way. A second implementation here would be the
 *              defect this codebase has already paid for twice.
 *
 *   contract   the STATION row FOR THAT SUPPLIER, never the flight row. A
 *   + item     flight-level override changes WHO fuels, not what the fuel is
 *              bought on, so the flight map carries no contract at all.
 *
 *   material   the tail's fuel_type. Functional: "add a Field Fuel Type in
 *              Tail Master... This is from where the Material Type is to be
 *              picked up for PO and GR creation."
 *
 * EVERY LINK FALLS BACK TO THE ORDER. A map that has not been maintained
 * must not stop a ticket posting - it should post with what the order knows
 * and let the S/4 message say what was wrong. Which source answered is
 * returned in `sources`, so a failed posting can be explained without
 * re-running the resolution.
 */
async function resolvePostingMasterData(ticket, tx = cds.db) {
    const { resolveDesignation } = require('./designation-resolver');
    const order = ticket.order || {};
    const out = {
        plant: null, supplier: null, contract: null, contractItem: null,
        material: null, sources: {}
    };

    const station = ticket.station_code
        || (ticket.flight && ticket.flight.origin_airport)
        || (order.airport && order.airport.iata_code) || null;
    const carrier = ticket.carrier_code
        || (ticket.flight && ticket.flight.airline_code) || null;
    const asOf = (ticket.delivery_timestamp && String(ticket.delivery_timestamp).slice(0, 10))
        || (ticket.flight && ticket.flight.flight_date) || null;

    const airportIdFor = async (code) => {
        if (!code) return null;
        const rows = await tx.run(SELECT.from('fuelsphere.MASTER_AIRPORTS')
            .columns('ID', 'iata_code').where({ iata_code: code }));
        return rows.length ? rows[0].ID : null;
    };
    const live = (r, on) => r.is_active !== false
        && (!r.valid_from || String(r.valid_from) <= on)
        && (!r.valid_to || String(r.valid_to) >= on);

    const airportId = await airportIdFor(station);

    // ---- plant ----------------------------------------------------------
    if (airportId && asOf) {
        const rows = await tx.run(SELECT.from('fuelsphere.STATION_PLANT_MAP')
            .columns('plant_werks', 'airport_ID', 'carrier_carrier_code',
                     'valid_from', 'valid_to', 'is_active'));
        const hit = rows.find(r => r.airport_ID === airportId
            && (!carrier || r.carrier_carrier_code === carrier) && live(r, asOf));
        if (hit && hit.plant_werks) {
            out.plant = hit.plant_werks;
            out.sources.plant = 'STATION_PLANT_MAP';
        }
    }
    if (!out.plant && order.airport && order.airport.s4_plant_code) {
        out.plant = order.airport.s4_plant_code;
        out.sources.plant = 'ORDER_AIRPORT';
    }

    // ---- supplier, then its contract at that station ---------------------
    let supplierId = null;
    if (station && asOf) {
        const d = await resolveDesignation({
            flightNumber: ticket.flight_number || null,
            stationCode: station, asOfDate: asOf, carrierCode: carrier, tx
        });
        if (d.resolved && d.row) {
            supplierId = d.row.supplier_ID || null;
            out.sources.supplier = 'DESIGNATION_' + d.axis;
        }
    }

    // THE CONTRACT COMES FROM THE STATION ROW FOR THAT SUPPLIER. On a
    // flight-level override the designation carries no contract, so this is
    // the only place it can come from.
    if (supplierId && airportId && asOf) {
        const maps = await tx.run(SELECT.from('fuelsphere.STATION_SUPPLIER_MAP')
            .columns('supplier_ID', 'airport_ID', 'carrier_carrier_code', 'contract_ID',
                     'contract_line_item', 'valid_from', 'valid_to', 'is_active'));
        const hit = maps.find(r => r.supplier_ID === supplierId && r.airport_ID === airportId
            && (!carrier || r.carrier_carrier_code === carrier) && live(r, asOf));
        if (hit) {
            out.contractItem = hit.contract_line_item || null;
            if (hit.contract_ID) {
                const c = await tx.run(SELECT.one.from('fuelsphere.MASTER_CONTRACTS')
                    .columns('s4_contract_number').where({ ID: hit.contract_ID }));
                if (c && c.s4_contract_number) {
                    out.contract = c.s4_contract_number;
                    out.sources.contract = 'STATION_SUPPLIER_MAP';
                }
            }
        }
    }

    if (supplierId) {
        const sup = await tx.run(SELECT.one.from('fuelsphere.MASTER_SUPPLIERS')
            .columns('s4_vendor_no').where({ ID: supplierId }));
        if (sup && sup.s4_vendor_no) out.supplier = sup.s4_vendor_no;
    }
    if (!out.supplier && order.supplier && order.supplier.s4_vendor_no) {
        out.supplier = order.supplier.s4_vendor_no;
        out.sources.supplier = 'ORDER_SUPPLIER';
    }
    if (!out.contract && order.contract && order.contract.s4_contract_number) {
        out.contract = order.contract.s4_contract_number;
        out.sources.contract = 'ORDER_CONTRACT';
    }

    // ---- material, from the tail's fuel type -----------------------------
    const tailReg = ticket.tail_registration || ticket.aircraft_reg || null;
    if (tailReg) {
        const reg = await tx.run(SELECT.one.from('fuelsphere.AIRCRAFT_REGISTRATIONS')
            .columns('fuel_type').where({ registration: tailReg }));
        if (reg && reg.fuel_type) {
            out.material = reg.fuel_type;
            out.sources.material = 'TAIL_FUEL_TYPE';
        }
    }
    if (!out.material && order.product && order.product.s4_material_number) {
        out.material = order.product.s4_material_number;
        out.sources.material = 'ORDER_PRODUCT';
    }

    return out;
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

    // FROM THE MAPS, NOT THE ORDER. Resolved before the payload is built so
    // a posting carries what the mapping apps maintain for that station,
    // carrier and date - see resolvePostingMasterData above.
    const resolved = await resolvePostingMasterData(ticket);
    LOG.info(`Ticket ${ticket.internal_number || ID} master data resolved from `
           + JSON.stringify(resolved.sources));

    const payload = M.buildPostingRequest(ticket, resolved);
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

    // THE HISTORY IS WRITTEN AFTER THE TICKET, DELIBERATELY. The ticket's
    // s4_* columns are what every screen reads and must land first; the
    // history is the record beside them. Written for the invoice step too,
    // which is why the kind is derived rather than hard-coded.
    await recordAttempt(ticket, fields, fields.s4_invoice_number && !fields.s4_po_number
        ? 'INVOICE' : 'UPLIFT');

    return fields;
}

function pickS4(ticket) {
    return Object.fromEntries(Object.entries(ticket).filter(([k]) => k.startsWith('s4_')));
}

/**
 * Record one attempt in S4_POSTING_ATTEMPTS, with its messages.
 *
 * EVERY ATTEMPT, INCLUDING THE ONES THAT CREATED NOTHING. A failed attempt is
 * the most useful row in the table - it is the one somebody opens the error
 * log to understand - so this is called on the success path and the failure
 * path alike.
 *
 * IT NEVER THROWS INTO THE CALLER. The history is a record of what happened,
 * not a precondition for it: a ticket that posted to S/4 must not be reported
 * as failed because writing its history row failed. The write is logged and
 * swallowed.
 *
 * ONE FLAT MESSAGE TODAY, A TABLE TOMORROW. ZFS_FUEL_POSTING_SRV returns a
 * single message string; CR-2d asks for the BAPI message table. Until then
 * the string lands in msg_text with the rest null, which is why
 * S4_POSTING_MESSAGES is shaped for the structured form from the start.
 */
async function recordAttempt(ticket, fields, kind, messages) {
    try {
        const prior = await cds.db.run(SELECT.from('fuelsphere.S4_POSTING_ATTEMPTS')
            .columns('attempt_no').where({ ticket_ID: ticket.ID }));
        const attemptNo = prior.reduce((m, r) => Math.max(m, Number(r.attempt_no) || 0), 0) + 1;

        const outcome = kind === 'UPLIFT'
            ? M.upliftOutcome(fields)
            : (fields.s4_posting_status || M.STATUS.ERROR);

        const attemptID = cds.utils.uuid();
        await cds.db.run(INSERT.into('fuelsphere.S4_POSTING_ATTEMPTS').entries({
            ID: attemptID,
            ticket_ID: ticket.ID,
            attempt_no: attemptNo,
            attempted_at: fields.s4_posted_at || new Date().toISOString(),
            posting_kind: kind,
            outcome,
            message: fields.s4_posting_message || null,
            contract_number: fields.s4_contract_number || null,
            po_number: fields.s4_po_number || null,
            po_item: fields.s4_po_item || null,
            po_quantity: fields.s4_po_quantity ?? null,
            po_unit: fields.s4_po_unit || null,
            gr_number: fields.s4_gr_number || null,
            gr_year: fields.s4_gr_year || null,
            // Null until CR-2 returns them. The columns exist so the handler
            // has somewhere to put them the day it does.
            fi_doc_number: fields.s4_fi_doc_number || null,
            fi_fiscal_year: fields.s4_fi_fiscal_year || null,
            company_code: fields.s4_company_code || null,
            invoice_number: fields.s4_invoice_number || null,
            invoice_year: fields.s4_invoice_year || null,
            created_at: new Date().toISOString(),
            created_by: 'S4_POSTING'
        }));

        const rows = (messages && messages.length ? messages : [{
            msg_type: outcome === M.STATUS.COMPLETE ? 'S' : 'E',
            msg_text: fields.s4_posting_message || null,
            step: !fields.s4_po_number ? 'PO' : (!fields.s4_gr_number ? 'GR' : 'FI')
        }]).filter(r => r.msg_text);

        if (rows.length) {
            await cds.db.run(INSERT.into('fuelsphere.S4_POSTING_MESSAGES').entries(
                rows.map((r, i) => ({
                    ID: cds.utils.uuid(),
                    attempt_ID: attemptID,
                    sequence: (i + 1) * 10,
                    msg_type: r.msg_type || 'E',
                    msg_id: r.msg_id || null,
                    msg_number: r.msg_number || null,
                    msg_text: r.msg_text || null,
                    msg_v1: r.msg_v1 || null, msg_v2: r.msg_v2 || null,
                    msg_v3: r.msg_v3 || null, msg_v4: r.msg_v4 || null,
                    step: r.step || null
                }))));
        }
        return attemptNo;
    } catch (err) {
        LOG.error(`Could not record the posting attempt for ticket ${ticket.ID}`, err);
        return null;
    }
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

module.exports = { register, postTicketToS4, postInvoiceTicketsToS4, recordAttempt,
                   resolvePostingMasterData, mode };

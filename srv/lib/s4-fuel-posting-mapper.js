/**
 * FuelSphere -> S/4HANA fuel ticket posting: pure mapping functions (no CAP dependency).
 *
 * Contract: SAP S2A OData V2 service ZFS_FUEL_POSTING_SRV, entity set FuelPostingSet
 * (ABAP: ZCL_ZFS_FUEL_POSTING_DPC_EXT -> FM ZFS_FUEL_TICKET_POST -> ZCL_FS_FUEL_POSTING).
 *
 * Gateway specifics handled here:
 *  - all properties are non-nullable  -> empty values are omitted, never sent as null
 *  - Edm.Decimal is sent as string     -> "1250.000"
 *  - Edm.DateTime uses V2 JSON format   -> "/Date(1759622400000)/"
 *  - conversion exits are bound (ALPHA, CUNIT, MATN1) -> send external values
 *    (e.g. "10015", "L", "JETA1"), S/4 converts to internal format
 *  - empty NUMC fields come back as zeros ("00000", "0000") -> mapped to null
 *
 * TAKEN FROM THE HANDOVER PACKAGE UNCHANGED except where marked. It arrived
 * with unit tests and no CAP dependency, which is the half of the package
 * that could be trusted on sight.
 */
'use strict';

/** FuelSphere UNIT_OF_MEASURE codes -> SAP commercial (external) unit */
const UOM_TO_SAP = { KG: 'KG', LTR: 'L', L: 'L', GAL: 'GAL', USG: 'GAL' };

/**
 * ZFS_S_FUEL_POSTING-STATUS, plus the two the business asked for by name.
 *
 * S, P and E are what the service returns today. PO_ERROR and GR_ERROR are
 * FuelSphere's own: the requirement is that an uplift records "Success if PO
 * and GR creation is successful; if any error is encountered while creating
 * PO or GR, status should be PO Error or GR Error respectively", and S/4
 * cannot currently tell those two apart (CR-2c in
 * docs/S4_Backend_Change_Requests.md asks it to).
 *
 * DERIVED HERE UNTIL THE SERVICE SENDS THEM, by looking at which document is
 * missing - which is sound because the steps are strictly ordered: no PO
 * means the PO failed, a PO with no GR means the GR did.
 */
const STATUS = Object.freeze({
    COMPLETE: 'S',
    PARTIAL:  'P',
    ERROR:    'E',
    PO_ERROR: 'POERR',
    GR_ERROR: 'GRERR'
});

/** FuelSphere error codes (CLAUDE.md) per failed step */
const ERROR_CODES = Object.freeze({ PO: 'INT401', GR: 'INT402', INVOICE: 'INV406' });

const MESSAGE_MAX = 220; // ZFS_S_FUEL_POSTING-MESSAGE (BAPI_MSG)

function isBlank(value) {
    return value === undefined || value === null || value === '';
}

function blankIfZero(value) {
    if (isBlank(value)) return null;
    return /^0+$/.test(String(value)) ? null : String(value);
}

function toEdmDecimal(value, decimals) {
    if (isBlank(value)) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(decimals) : undefined;
}

/** Date part (UTC) of a timestamp as OData V2 Edm.DateTime */
function toEdmDateTime(value) {
    if (isBlank(value)) return undefined;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return undefined;
    return `/Date(${Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())})/`;
}

function toNumberOrNull(value) {
    if (isBlank(value)) return null;
    const n = Number(value);
    return Number.isFinite(n) && n !== 0 ? n : null;
}

function truncate(text, max = MESSAGE_MAX) {
    if (isBlank(text)) return null;
    const s = String(text);
    return s.length > max ? s.slice(0, max) : s;
}

/**
 * Build the POST body for FuelPostingSet from a FUEL_TICKETS row read with:
 *   order { contract { s4_contract_number }, supplier { s4_vendor_no },
 *           airport { s4_plant_code }, product { s4_material_number } },
 *   delivery { density }
 */
function buildPostingRequest(ticket, resolved) {
    const order = ticket.order || {};
    const uom = String(ticket.uom_code || 'KG').toUpperCase();
    // RESOLVED FROM THE MAPPING TABLES where the caller supplied it, the
    // order otherwise. The second argument is optional so the pure unit
    // criteria can still build a payload from a ticket alone.
    const r = resolved || {};

    const payload = {
        // internal_number (FT-{STN}-{YYYYMMDD}-{SEQ}) is unique; the supplier's
        // ticket_number is not unique across suppliers. S/4 is idempotent on this key.
        TicketNumber: ticket.internal_number || ticket.ID,
        Quantity: toEdmDecimal(ticket.quantity, 3),
        Uom: UOM_TO_SAP[uom] || uom,
        // Needed when the ticket is in KG and the contract in L (JETA1 in S2A is L only)
        Density: toEdmDecimal(ticket.delivery && ticket.delivery.density, 4),
        Contract: r.contract || (order.contract && order.contract.s4_contract_number),
        // THE CONTRACT LINE ITEM, sent for the first time on 18 Oct 2026.
        // S/4 has always accepted it; the station-to-vendor mapping is where
        // it is maintained, and functional named it as part of that mapping.
        ContractItem: r.contractItem || undefined,
        Supplier: r.supplier || (order.supplier && order.supplier.s4_vendor_no),
        Plant: r.plant || (order.airport && order.airport.s4_plant_code),
        Material: r.material || (order.product && order.product.s4_material_number),
        PostingDate: toEdmDateTime(ticket.delivery_timestamp)
    };

    for (const key of Object.keys(payload)) {
        if (isBlank(payload[key])) delete payload[key];
    }
    return payload;
}

/** Client-side checks before calling S/4 - returns a list of problems (empty = ok) */
function validateRequest(payload) {
    const problems = [];
    if (isBlank(payload.TicketNumber)) problems.push('Ticket has no internal number');
    if (!(Number(payload.Quantity) > 0)) problems.push('Quantity must be greater than zero');
    if (isBlank(payload.Contract) && (isBlank(payload.Plant) || isBlank(payload.Material))) {
        problems.push('Order needs an S/4 contract number, or airport S/4 plant + product S/4 material');
    }
    return problems;
}

/** Map the FuelPostingSet response entity to FUEL_TICKETS s4_* fields */
function mapPostingResult(response) {
    const r = (response && response.d) || response || {};
    return {
        s4_posting_status: r.Status || STATUS.ERROR,
        s4_posting_message: truncate(r.Message),
        s4_contract_number: blankIfZero(r.Contract),
        s4_po_number: blankIfZero(r.PoNumber),
        s4_po_item: blankIfZero(r.PoItem),
        s4_po_quantity: toNumberOrNull(r.PoQuantity),
        s4_po_unit: r.PoUnit || null,
        s4_gr_number: blankIfZero(r.GrNumber),
        s4_gr_year: blankIfZero(r.GrYear),
        s4_invoice_number: blankIfZero(r.InvNumber),
        s4_invoice_year: blankIfZero(r.InvYear),
        s4_invoice_amount: toNumberOrNull(r.InvAmount),
        s4_invoice_currency: r.Currency || null
    };
}

/** FuelSphere error code for the first step that is still missing */
function errorCodeFor(fields) {
    if (!fields.s4_po_number) return ERROR_CODES.PO;
    if (!fields.s4_gr_number) return ERROR_CODES.GR;
    if (!fields.s4_invoice_number) return ERROR_CODES.INVOICE;
    return null;
}

/** Prefix a non-complete posting message with its FuelSphere error code */
function withErrorCode(fields) {
    if (fields.s4_posting_status === STATUS.COMPLETE) return fields;
    const code = errorCodeFor(fields);
    const message = fields.s4_posting_message || 'S/4HANA posting incomplete';
    return {
        ...fields,
        s4_posting_message: truncate(code && !message.startsWith(code) ? `${code}: ${message}` : message)
    };
}

/**
 * ADDED 13 Oct 2026, not in the handover package.
 *
 * PO AND GR ARE ENOUGH TO CALL TICKET POSTING DONE. The package treated a
 * ticket as finished only at Status=S, which includes the supplier invoice -
 * and the invoice is now posted from the Invoices app, on the supplier's
 * document, not on ticket save. So a ticket sitting at P with a PO and a GR
 * is not an incomplete ticket; it is a ticket waiting for an invoice that
 * nobody has captured yet, and warning about it on every save would train
 * people to ignore the warning.
 *
 * It does NOT redefine s4_posting_status, which stays exactly what S/4 said.
 */
function upliftPosted(fields) {
    return Boolean(fields && fields.s4_po_number && fields.s4_gr_number);
}

/**
 * Which step failed, as the business wants it recorded.
 *
 * ONLY FOR AN UPLIFT POSTING. The invoice step is driven separately and its
 * absence is not a failure of the uplift - that distinction is the whole
 * point of upliftPosted() above.
 *
 * It does NOT overwrite what S/4 said: a response that already carries a
 * step-specific status keeps it. This fills the gap, it does not replace the
 * source.
 */
function upliftOutcome(fields) {
    if (!fields) return STATUS.ERROR;
    if (fields.s4_posting_status === STATUS.PO_ERROR
        || fields.s4_posting_status === STATUS.GR_ERROR) return fields.s4_posting_status;
    if (upliftPosted(fields)) return STATUS.COMPLETE;
    if (!fields.s4_po_number) return STATUS.PO_ERROR;
    return STATUS.GR_ERROR;
}

function safeJson(text) {
    try { return JSON.parse(text); } catch { return null; }
}

/** HTTP status of an error thrown by a CAP remote service call (if any) */
function httpStatusOf(err) {
    const response = err && err.reason && err.reason.response;
    return (response && response.status) || (err && (err.statusCode || err.status)) || null;
}

/** Readable message from a CAP remote service error (Gateway error JSON or network error) */
function extractErrorMessage(err) {
    const response = (err && err.reason && err.reason.response) || (err && err.response) || {};
    let body = response.data !== undefined ? response.data : response.body;
    if (typeof body === 'string') body = safeJson(body) || { error: { message: body } };
    const gwMessage = body && body.error && body.error.message;
    const message = (gwMessage && (gwMessage.value || gwMessage)) || (err && err.message);
    return truncate(message || 'Unknown error calling S/4HANA');
}

module.exports = {
    STATUS,
    ERROR_CODES,
    UOM_TO_SAP,
    buildPostingRequest,
    validateRequest,
    mapPostingResult,
    withErrorCode,
    errorCodeFor,
    extractErrorMessage,
    httpStatusOf,
    upliftPosted,
    upliftOutcome,
    toEdmDecimal,
    toEdmDateTime
};

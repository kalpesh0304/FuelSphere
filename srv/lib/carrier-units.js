/**
 * FuelSphere - which carrier a fuel record belongs to, and its units.
 *
 * ONE HOOK ON THE DATABASE, NOT ONE PER WRITER. Every handler in this project
 * writes with db.run(INSERT...) or a bulk entries([...]), and a service-level
 * before('CREATE') sees none of those (CLAUDE.md section 12). A database-level
 * handler sees all of them - drafts activating, Excel imports, the ROB ledger
 * posting, the seed tools that boot the model - so carrier_code cannot be
 * forgotten by the next writer somebody adds.
 *
 * REGISTERED ON '*' AND FILTERED ON THE TARGET, deliberately. Measured on CAP
 * 8.9.9 in an isolated model: db.before(['CREATE', ...], 'entity') never fired
 * for a bare db.run INSERT, while db.before('*') with a target check fired for
 * single and bulk inserts alike.
 *
 * THE CARRIER IS RESOLVED, IN ORDER, FROM: a value the writer supplied; the
 * row's flight (airline_code); its order, ticket or delivery (each already
 * carrying a carrier_code); and last, the tail's own flights. A tail's
 * operator_code is NOT used - it holds ICAO and IATA codes side by side (JBU
 * beside AC), and CARRIER_MASTER is keyed on IATA.
 *
 * NOTHING HERE CONVERTS A QUANTITY. The converted figures are calculated
 * elements (db/carrier-units.cds), computed in SQL on read.
 */
const cds = require('@sap/cds');
const { SELECT } = cds.ql;

const FLIGHTS = 'fuelsphere.FLIGHT_SCHEDULE';

// entity: the columns that can name a carrier, tried in this order.
const SOURCES = {
    'fuelsphere.FUEL_ORDERS':     [['flight_ID', FLIGHTS]],
    'fuelsphere.FUEL_DELIVERIES': [['flight_ID', FLIGHTS], ['order_ID', 'fuelsphere.FUEL_ORDERS']],
    'fuelsphere.FUEL_TICKETS':    [['flight_ID', FLIGHTS], ['order_ID', 'fuelsphere.FUEL_ORDERS'],
                                   ['delivery_ID', 'fuelsphere.FUEL_DELIVERIES']],
    'fuelsphere.INVOICE_ITEMS':   [['flight_ID', FLIGHTS], ['ticket_ID', 'fuelsphere.FUEL_TICKETS'],
                                   ['fuel_order_ID', 'fuelsphere.FUEL_ORDERS'],
                                   ['delivery_ID', 'fuelsphere.FUEL_DELIVERIES']],
    'fuelsphere.FUEL_BURNS':      [['flight_ID', FLIGHTS]],
    'fuelsphere.ROB_LEDGER':      [['flight_ID', FLIGHTS], ['fuel_ticket_ID', 'fuelsphere.FUEL_TICKETS'],
                                   ['fuel_order_ID', 'fuelsphere.FUEL_ORDERS']],
    'fuelsphere.FLIGHT_DISPATCH': [['flight_schedule_ID', FLIGHTS]],
    'fuelsphere.APU_USAGE':       [['flight_ID', FLIGHTS]]
};
// The tail column each entity names, for the last-resort lookup.
const TAIL = {
    'fuelsphere.FUEL_DELIVERIES': 'aircraft_reg', 'fuelsphere.FUEL_TICKETS': 'aircraft_reg',
    'fuelsphere.FUEL_BURNS': 'tail_number', 'fuelsphere.ROB_LEDGER': 'tail_number',
    'fuelsphere.FLIGHT_DISPATCH': 'tail_number', 'fuelsphere.APU_USAGE': 'tail_number'
};
const WRITES = new Set(['CREATE', 'UPSERT', 'UPDATE']);

async function carrierOf(db, entity, row, cache) {
    for (const [col, target] of SOURCES[entity]) {
        const id = row[col];
        if (!id) continue;
        const key = `${target}|${id}`;
        if (!cache.has(key)) {
            const hit = await db.run(SELECT.one.from(target)
                .columns(target === FLIGHTS ? 'airline_code as c' : 'carrier_code as c').where({ ID: id }));
            cache.set(key, hit ? hit.c : null);
        }
        if (cache.get(key)) return cache.get(key);
    }
    const tail = TAIL[entity] && row[TAIL[entity]];
    if (tail) {
        const key = `tail|${tail}`;
        if (!cache.has(key)) {
            const hit = await db.run(SELECT.one.from(FLIGHTS).columns('airline_code as c')
                .where({ aircraft_reg: tail, airline_code: { '!=': null } }));
            cache.set(key, hit ? hit.c : null);
        }
        return cache.get(key);
    }
    return null;
}

/**
 * The database entity behind a write target.
 *
 * A DRAFT ACTIVATION DOES NOT WRITE TO fuelsphere.FUEL_ORDERS. Measured: it
 * inserts into FuelOrderService.FuelOrders, and a draft edit into
 * FuelOrderService.FuelOrders.drafts - service entities - so a hook keyed on
 * the database name saw handler inserts and missed every order saved through
 * a screen. Walk drafts to actives and projections to their source until a
 * database entity this module knows is reached.
 */
function baseOf(def) {
    for (let d = def, i = 0; d && i < 8; i++) {
        if (SOURCES[d.name]) return d.name;
        if (d.actives && d.actives !== d) { d = d.actives; continue; }
        const from = (d.query && d.query.SELECT && d.query.SELECT.from) || (d.projection && d.projection.from);
        const ref = from && from.ref && from.ref[0];
        if (!ref) return null;
        d = cds.model && cds.model.definitions[typeof ref === 'string' ? ref : ref.id];
    }
    return null;
}

function registerCarrierHook(db) {
    db.before('*', async (req) => {
        if (!WRITES.has(req.event) || !req.data || !req.target) return;
        const entity = baseOf(req.target);
        // A projection that does not expose carrier_code cannot be given one.
        if (!entity || !(req.target.elements && req.target.elements.carrier_code)) return;
        const rows = Array.isArray(req.data) ? req.data : [req.data];
        const cache = new Map();
        for (const row of rows) {
            if (!row || row.carrier_code) continue;
            // An UPDATE that names no carrier source changes nothing about the
            // carrier, and resolving one would overwrite a value set on purpose.
            if (req.event === 'UPDATE' && !SOURCES[entity].some(([c]) => c in row)) continue;
            const code = await carrierOf(db, entity, row, cache);
            if (code) row.carrier_code = code;
        }
    });
}

/** The carrier's currency and units, or null where the carrier is not mapped. */
async function carrierSettings(code, tx) {
    if (!code) return null;
    const db = tx || cds.db;
    return db.run(SELECT.one.from('fuelsphere.CARRIER_MASTER')
        .columns('carrier_code', 'reporting_currency', 'reporting_volume_uom', 'reporting_mass_uom')
        .where({ carrier_code: code }));
}

/** The carrier's currency for a flight, or null. */
async function currencyForFlight(flightId, tx) {
    if (!flightId) return null;
    const db = tx || cds.db;
    const f = await db.run(SELECT.one.from(FLIGHTS).columns('airline_code').where({ ID: flightId }));
    const c = f && await carrierSettings(f.airline_code, db);
    return (c && c.reporting_currency) || null;
}

/** A contract's currency and unit, or nulls. */
async function contractTerms(contractId, tx) {
    if (!contractId) return { currency_code: null, uom_code: null };
    const db = tx || cds.db;
    const c = await db.run(SELECT.one.from('fuelsphere.MASTER_CONTRACTS')
        .columns('currency_code', 'uom_code').where({ ID: contractId }));
    return { currency_code: (c && c.currency_code) || null, uom_code: (c && c.uom_code) || null };
}

/**
 * Convert VIRTUAL figures on read rows into the carrier's units.
 *
 * For the figures a handler computes after READ (Fuel Burns' summary, for
 * one), which a calculated element cannot reach. Stored figures are converted
 * by the calculated elements in db/carrier-units.cds; this is only for the
 * rest. The carrier comes from the row, else from `entity` re-read by ID - an
 * after-READ handler sees only the columns the client selected.
 *
 *   spec.mass   [[from_kg, to_cm], ...]     kg -> carrier mass unit
 *   spec.volume [[from_l, to_cv], ...]      litres -> carrier volume unit
 *   spec.rate   [[from_per_kg, to_per_cm]]  per kg -> per carrier mass unit
 */
async function applyCarrierUnits(data, entity, spec) {
    const rows = (Array.isArray(data) ? data : [data]).filter(Boolean);
    if (!rows.length) return;
    const ids = rows.filter(r => !r.carrier_code && r.ID).map(r => r.ID);
    const codeById = new Map();
    if (ids.length) {
        for (const r of await cds.db.run(SELECT.from(entity).columns('ID', 'carrier_code').where({ ID: { in: ids } }))) {
            codeById.set(r.ID, r.carrier_code);
        }
    }
    const codes = [...new Set(rows.map(r => r.carrier_code || codeById.get(r.ID)).filter(Boolean))];
    if (!codes.length) return;
    const carriers = await cds.db.run(SELECT.from('fuelsphere.CARRIER_MASTER')
        .columns('carrier_code', 'reporting_volume_uom', 'reporting_mass_uom').where({ carrier_code: { in: codes } }));
    const uoms = new Map((await cds.db.run(SELECT.from('fuelsphere.UNIT_OF_MEASURE')
        .columns('uom_code', 'conversion_to_kg', 'conversion_to_ltr'))).map(u => [u.uom_code, u]));
    const f = new Map(carriers.map(c => [c.carrier_code, {
        kg: Number((uoms.get(c.reporting_mass_uom) || {}).conversion_to_kg) || null,
        l: Number((uoms.get(c.reporting_volume_uom) || {}).conversion_to_ltr) || null }]));
    const n = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
    for (const r of rows) {
        const k = f.get(r.carrier_code || codeById.get(r.ID));
        if (!k) continue;
        for (const [a, b] of spec.mass || [])   { const v = n(r[a]); r[b] = v === null || !k.kg ? null : Number((v / k.kg).toFixed(2)); }
        for (const [a, b] of spec.volume || []) { const v = n(r[a]); r[b] = v === null || !k.l ? null : Number((v / k.l).toFixed(2)); }
        for (const [a, b] of spec.rate || [])   { const v = n(r[a]); r[b] = v === null || !k.kg ? null : Number((v * k.kg).toFixed(4)); }
    }
}

module.exports = { registerCarrierHook, carrierSettings, currencyForFlight, contractTerms, applyCarrierUnits, SOURCES };

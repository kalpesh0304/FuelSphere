#!/usr/bin/env node
/**
 * FuelSphere - the three into-plane arrangements, seeded for JetBlue.
 *
 * WHO PUTS THE FUEL IN THE WING is a different question from who sold it, and
 * until 7 Oct 2026 the maps could express only two of its three answers. This
 * seeds all three over JetBlue's 24-26 September operation, and bills the one
 * that costs money twice.
 *
 *   CASE 1  SUPPLIER     the fuel supplier also fuels the aircraft.
 *                        One invoice. Already the state of 85 of 86 map rows,
 *                        so this seeds nothing - it leaves them alone, and the
 *                        only change is that the screens now SHOW the
 *                        supplier's name instead of an empty agent field.
 *
 *   CASE 2  THIRD_PARTY  an agent takes the fuel from the supplier and puts
 *                        it in the wing. TWO INVOICES for one ticket: the
 *                        supplier bills the fuel, the agent bills the uplift.
 *                        Seeded at JFK, BOS and FLL - JetBlue's three busiest
 *                        stations in the window, so the case is visible on
 *                        718 of the 1,660 tickets rather than on a corner.
 *
 *   CASE 3  SELF         the airline fuels from its own tanks. ONE invoice,
 *                        from the supplier, for the fuel - there is no agent
 *                        to bill the service, which is the point. Seeded at
 *                        MCO and SJU.
 *
 * WHY THE FUEL INVOICES ARE NOT TOUCHED. 1,655 of the 1,660 tickets in the
 * window already carry a fuel line. Case 2 does not change what the supplier
 * bills - it ADDS what the agent bills - so this seeder only ever appends the
 * into-plane side. Re-running it replaces its own rows and no others.
 *
 * THE HANDLING RATE IS AN ASSUMPTION AND IS MARKED AS ONE. Into-plane fees
 * are commercially confidential and none are recorded in this system, so the
 * rates below are plausible industry figures (1.2 to 1.65 US cents per litre,
 * varying by station) rather than anything JetBlue has agreed. Every invoice
 * this seeder writes says so in its notes, so nobody mistakes them for
 * negotiated terms.
 *
 * Run:  node tools/seed-into-plane.js [--write]
 * Without --write it reports what it would produce and changes nothing.
 */

process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT = path.resolve(__dirname, '..');
const DATA = path.join(PROJECT, 'db', 'data');
const WRITE = process.argv.includes('--write');

const cds = require(path.join(PROJECT, 'node_modules', '@sap', 'cds'));
const { SELECT } = cds.ql;

const STAMP = '2026-10-07T00:00:00Z';
const BY = 'SEED_INTO_PLANE';
const WINDOW = { from: '2026-09-24', to: '2026-09-26' };

// ---- csv ------------------------------------------------------------------
const csvPath = (name) => path.join(DATA, `fuelsphere-${name}.csv`);

function readCsv(name) {
    const text = fs.readFileSync(csvPath(name), 'utf8').replace(/^﻿/, '');
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const cols = splitRow(lines[0]);
    return { cols, rows: lines.slice(1).map(l => {
        const f = splitRow(l);
        return Object.fromEntries(cols.map((c, i) => [c, f[i] ?? '']));
    }) };
}

// A NOTES FIELD CONTAINS SEMICOLONS AND QUOTED COMMAS. The invoice seed
// already carries one note with doubled quotes inside it, so a naive split
// shifts every column after it - the class of bug that put values in the
// wrong columns of STATION_PLANT_MAP once already.
function splitRow(line) {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) {
            if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
            else if (c === '"') q = false;
            else cur += c;
        } else if (c === '"') q = true;
        else if (c === ';') { out.push(cur); cur = ''; }
        else cur += c;
    }
    out.push(cur);
    return out;
}

const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

function writeCsv(name, cols, rows) {
    const out = [cols.map(esc).join(';')];
    for (const r of rows) out.push(cols.map(c => esc(r[c])).join(';'));
    fs.writeFileSync(csvPath(name), out.join('\r\n') + '\r\n', 'utf8');
    console.log(`  wrote ${rows.length} rows to fuelsphere-${name}.csv`);
}

const NS = '8c1d7e35-9b2a-4f60-8d13-5a7e9c0b4d21';
function uuid5(name) {
    const ns = Buffer.from(NS.replace(/-/g, ''), 'hex');
    const h = crypto.createHash('sha1').update(Buffer.concat([ns, Buffer.from(name)])).digest();
    h[6] = (h[6] & 0x0f) | 0x50;
    h[8] = (h[8] & 0x3f) | 0x80;
    const x = h.subarray(0, 16).toString('hex');
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const money = (n) => Number(n.toFixed(2));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// ===========================================================================
// THE ARRANGEMENTS
// ===========================================================================
//
// THE AGENTS ARE REAL COMPANIES AT REAL STATIONS. Allied Aviation holds the
// fuelling concession at JFK; Swissport and Menzies both fuel widely in the
// US. Using plausible names rather than AGENT_1 costs nothing and makes a
// demo screen read like an operation.
const AGENTS = [
    { code: 'ALLIED01', name: 'Allied Aviation Services', s4: '1000101', country: 'US' },
    { code: 'SWISSP01', name: 'Swissport Fuelling USA',   s4: '1000102', country: 'US' },
    { code: 'MENZUS01', name: 'Menzies Aviation USA',     s4: '1000103', country: 'US' }
];

// station -> agent, and the handling rate in USD per litre. ASSUMED - see the
// header. Varying it by station is deliberate: a single rate everywhere would
// let a bug that ignores the station pass unnoticed.
const CASE2 = {
    JFK: { agent: 'ALLIED01', rate: 0.0165 },
    BOS: { agent: 'SWISSP01', rate: 0.0140 },
    FLL: { agent: 'MENZUS01', rate: 0.0120 }
};

// The airline's own tanks. No agent, no second invoice.
const CASE3 = ['MCO', 'SJU'];

const CARRIER = 'B6';

(async () => {
    const model = await cds.load('*');
    await cds.deploy(model);

    // ---- what the window actually contains -----------------------------
    const flights = await cds.db.run(SELECT.from('fuelsphere.FLIGHT_SCHEDULE')
        .columns('ID', 'flight_number', 'flight_date', 'origin_airport', 'destination_airport', 'airline_code')
        .where({ flight_date: { between: WINDOW.from, and: WINDOW.to } }));
    const flightById = new Map(flights.map(f => [f.ID, f]));

    const tickets = (await cds.db.run(SELECT.from('fuelsphere.FUEL_TICKETS')
        .columns('ID', 'ticket_number', 'flight_ID', 'order_ID', 'quantity', 'uom_code',
                 'quantity_kg', 'rate_per_litre', 'total_amount', 'currency_code', 'delivery_timestamp')))
        .filter(t => {
            const f = flightById.get(t.flight_ID);
            return f && f.airline_code === CARRIER;
        });

    const airports = await cds.db.run(SELECT.from('fuelsphere.MASTER_AIRPORTS').columns('ID', 'iata_code'));
    const airportByCode = new Map(airports.map(a => [a.iata_code, a.ID]));

    // ---- the PO and GR a line resolves to --------------------------------
    //
    // STORED EVIDENCE MUST EQUAL WHAT THE RESOLVER COMPUTES. The lines this
    // seeder writes carried resolution_source = TICKET_ID with
    // resolved_po_number and resolved_gr_number left empty, which is a half-
    // filled claim: the line says it resolved and then names nothing it
    // resolved to. srv/lib/invoice-checks.js walks ticket -> order ->
    // s4_po_number and ticket -> delivery -> s4_gr_number, so the same walk
    // happens here. Caught by fim-reconcile EXIT-2, which compares the seeded
    // resolution against the computed one field for field.
    //
    // AN INTO-PLANE LINE RESOLVES TO THE FUEL ORDER'S PO, and that is worth
    // being explicit about rather than leaving as an accident of the walk.
    // The agent's handling charge is not bought on the fuel purchase order -
    // in S/4 it would be its own service entry - but the resolver has only
    // one chain and reaches the fuel PO through the ticket. Storing what it
    // computes keeps the seed honest; whether an into-plane line SHOULD match
    // against a fuel PO is a question for the invoice design, not for this
    // seeder to answer by writing something different.
    const ticketRows = await cds.db.run(SELECT.from('fuelsphere.FUEL_TICKETS')
        .columns('ID', 'order_ID', 'delivery_ID'));
    const ticketById = new Map(ticketRows.map(t => [t.ID, t]));
    const orderRows = await cds.db.run(SELECT.from('fuelsphere.FUEL_ORDERS')
        .columns('ID', 's4_po_number'));
    const poByOrder = new Map(orderRows.map(o => [o.ID, o.s4_po_number]));
    const deliveryRows = await cds.db.run(SELECT.from('fuelsphere.FUEL_DELIVERIES')
        .columns('ID', 'order_ID', 's4_gr_number'));
    const grByDelivery = new Map(deliveryRows.map(d => [d.ID, d.s4_gr_number]));
    const deliveryByOrder = new Map();
    for (const d of deliveryRows) if (!deliveryByOrder.has(d.order_ID)) deliveryByOrder.set(d.order_ID, d);

    const resolveFor = (ticketID) => {
        const t = ticketById.get(ticketID);
        if (!t) return { po: '', gr: '' };
        const po = (t.order_ID && poByOrder.get(t.order_ID)) || '';
        let gr = (t.delivery_ID && grByDelivery.get(t.delivery_ID)) || '';
        if (!gr && t.order_ID) {
            const d = deliveryByOrder.get(t.order_ID);
            gr = (d && d.s4_gr_number) || '';
        }
        return { po: po || '', gr: gr || '' };
    };

    console.log(`${flights.length} flight(s) in ${WINDOW.from}..${WINDOW.to}, `
              + `${tickets.length} ${CARRIER} ticket(s) against them`);

    // =======================================================================
    // 1. THE AGENTS, as suppliers of type INTO_PLANE
    // =======================================================================
    const sup = readCsv('MASTER_SUPPLIERS');
    const supRows = sup.rows.filter(r => !AGENTS.some(a => a.code === r.supplier_code));
    const agentId = {};
    for (const a of AGENTS) {
        const id = uuid5(`SUPPLIER:${a.code}`);
        agentId[a.code] = id;
        supRows.push({
            ID: id, supplier_code: a.code, supplier_name: a.name,
            // THE TYPE THE COLUMN WAS ALWAYS FOR. supplier_type has carried
            // 'EXTERNAL / INTO_PLANE' in its comment since the schema was
            // written and every one of the 21 rows said EXTERNAL - the second
            // value had never been used.
            supplier_type: 'INTO_PLANE',
            country_code: a.country, iata_code: '', icao_code: '', parent_supplier_ID: '',
            payment_terms: 'NT30', s4_vendor_no: a.s4, is_active: 'true',
            created_at: STAMP, created_by: BY, modified_at: STAMP, modified_by: BY
        });
    }

    // =======================================================================
    // 2. A HANDLING CONTRACT PER AGENT
    // =======================================================================
    //
    // The mapping carries into_plane_contract, and leaving it empty would
    // make case 2 look half-entered. SERVICE rather than fuel: these buy an
    // act, not a commodity.
    const con = readCsv('MASTER_CONTRACTS');
    const conRows = con.rows.filter(r => !String(r.contract_number || '').startsWith('B6-ITP-'));
    const contractId = {};
    for (const a of AGENTS) {
        const number = `B6-ITP-${a.code.slice(0, 6)}-2026`;
        const id = uuid5(`CONTRACT:${number}`);
        contractId[a.code] = id;
        const row = {};
        for (const c of con.cols) row[c] = '';
        Object.assign(row, {
            ID: id, contract_number: number,
            contract_name: `${a.name} - into-plane handling 2026`,
            supplier_ID: agentId[a.code],
            valid_from: '2026-01-01', valid_to: '2026-12-31',
            contract_type: 'TERM', price_type: 'FIXED', currency_code: 'USD',
            payment_terms: 'NT30', s4_contract_number: '',
            is_active: 'true',
            created_at: STAMP, created_by: BY, modified_at: STAMP, modified_by: BY
        });
        conRows.push(row);
    }

    // =======================================================================
    // 3. THE STATION MAP - cases 2 and 3 onto JetBlue's rows
    // =======================================================================
    const stn = readCsv('STATION_SUPPLIER_MAP');
    if (!stn.cols.includes('self_fuelled')) stn.cols.push('self_fuelled');
    const codeOfAirport = new Map(airports.map(a => [a.ID, a.iata_code]));

    let c2stations = 0, c3stations = 0, untouched = 0;
    for (const r of stn.rows) {
        if (r.self_fuelled === undefined || r.self_fuelled === '') r.self_fuelled = 'false';
        if (r.carrier_carrier_code !== CARRIER) { untouched++; continue; }
        const code = codeOfAirport.get(r.airport_ID);

        if (CASE2[code]) {
            // CASE 2. The supplier stops performing the uplift and an agent
            // is named. Both must change together: leaving the flag set would
            // make into_plane_mode read SUPPLIER and hide the agent, which is
            // exactly what CAR411 refuses on a screen.
            r.supplier_performs_uplift = 'false';
            r.self_fuelled = 'false';
            r.into_plane_agent_ID = agentId[CASE2[code].agent];
            r.into_plane_contract_ID = contractId[CASE2[code].agent];
            r.notes = `Into-plane by ${AGENTS.find(a => a.code === CASE2[code].agent).name} `
                    + `at ${code}; fuel on the supplier contract. Seeded 7 Oct 2026.`;
            r.modified_at = STAMP; r.modified_by = BY;
            c2stations++;
        } else if (CASE3.includes(code)) {
            // CASE 3. The fuel still has a supplier - the airline buys into
            // its own storage - so supplier_ID is left exactly as it was.
            r.supplier_performs_uplift = 'false';
            r.self_fuelled = 'true';
            r.into_plane_agent_ID = '';
            r.into_plane_contract_ID = '';
            r.notes = `${CARRIER} fuels from its own storage at ${code}; fuel bought from the `
                    + `mapped supplier into those tanks. Seeded 7 Oct 2026.`;
            r.modified_at = STAMP; r.modified_by = BY;
            c3stations++;
        } else {
            untouched++;
        }
    }

    // =======================================================================
    // 4. THE FLIGHT MAP - the same three cases on the flight axis
    // =======================================================================
    //
    // WHY ANY AT ALL. The flight axis OVERRIDES the station's arrangement, and
    // a reader has to be able to see that happen - a station mapped to case 1
    // whose named flight is case 2. Without a row here the flight arm of
    // FLIGHT_DESIGNATION is never exercised by the new columns.
    const flt = readCsv('FLIGHT_SUPPLIER_MAP');
    if (!flt.cols.includes('self_fuelled')) flt.cols.push('self_fuelled');
    for (const r of flt.rows) {
        if (r.self_fuelled === undefined || r.self_fuelled === '') r.self_fuelled = 'false';
    }
    const fltRows = flt.rows.filter(r => String(r.notes || '').indexOf('Seeded 7 Oct 2026') === -1);

    // A FLIGHT THAT ALREADY HAS A ROW MUST NOT GET A SECOND ONE.
    //
    // This cost a regression. FLIGHT_DESIGNATED_SUPPLIER declines to pick
    // among equals: two live flight rows for one flight, station and carrier
    // resolve to NOTHING, by design, so `designated` stays a to-one. The
    // seeder added a row for B61224 out of LAX where one already existed, and
    // the flight stopped resolving to any supplier at all - caught by
    // designation-migration EXIT-2, which compares every flight's resolved
    // supplier against what the legacy designations gave.
    const taken = new Set(fltRows.map(r => `${r.flight_number}|${r.airport_ID}`));

    // Pick flights that EXIST in the window, at stations NOT already case 2 or
    // 3, so the override is visible against a case-1 station.
    const plain = flights.filter(f => f.airline_code === CARRIER
        && !CASE2[f.origin_airport] && !CASE3.includes(f.origin_airport)
        && airportByCode.has(f.origin_airport)
        && !taken.has(`${f.flight_number}|${airportByCode.get(f.origin_airport)}`));
    const seen = new Set();
    const picks = [];
    for (const f of plain) {
        const key = `${f.flight_number}|${f.origin_airport}`;
        if (seen.has(key)) continue;
        seen.add(key);
        picks.push(f);
        if (picks.length === 4) break;
    }

    const stationSupplierAt = new Map();
    for (const r of stn.rows) {
        if (r.carrier_carrier_code !== CARRIER || r.is_default !== 'true') continue;
        stationSupplierAt.set(codeOfAirport.get(r.airport_ID), r.supplier_ID);
    }

    let fltAdded = 0;
    picks.forEach((f, i) => {
        const supplierID = stationSupplierAt.get(f.origin_airport);
        if (!supplierID) return;
        const thirdParty = i < 2;                     // two of each case
        const a = AGENTS[i % AGENTS.length];
        const row = {};
        for (const c of flt.cols) row[c] = '';
        Object.assign(row, {
            ID: uuid5(`FLIGHTMAP:${f.flight_number}:${f.origin_airport}`),
            is_active: 'true',
            created_at: STAMP, created_by: BY, modified_at: STAMP, modified_by: BY,
            flight_number: f.flight_number,
            airport_ID: airportByCode.get(f.origin_airport),
            carrier_carrier_code: CARRIER,
            supplier_ID: supplierID,
            supplier_performs_uplift: 'false',
            into_plane_agent_ID: thirdParty ? agentId[a.code] : '',
            into_plane_contract_ID: thirdParty ? contractId[a.code] : '',
            self_fuelled: thirdParty ? 'false' : 'true',
            valid_from: '2026-01-01', valid_to: '',
            notes: thirdParty
                ? `${f.flight_number} out of ${f.origin_airport} is fuelled by ${a.name}, `
                + `overriding the station arrangement. Seeded 7 Oct 2026.`
                : `${f.flight_number} out of ${f.origin_airport} is fuelled by ${CARRIER} from its `
                + `own tanks, overriding the station arrangement. Seeded 7 Oct 2026.`
        });
        fltRows.push(row);
        fltAdded++;
    });

    // =======================================================================
    // 5. THE SECOND INVOICE - what the agent bills, for case 2 only
    // =======================================================================
    const inv = readCsv('INVOICES');
    const itm = readCsv('INVOICE_ITEMS');
    if (!itm.cols.includes('charge_type')) itm.cols.push('charge_type');

    // Re-runnable: drop what this seeder wrote before, keep everything else.
    const invRows = inv.rows.filter(r => r.created_by !== BY);
    const mineIds = new Set(inv.rows.filter(r => r.created_by === BY).map(r => r.ID));
    const itmRows = itm.rows.filter(r => !mineIds.has(r.invoice_ID));
    for (const r of itmRows) if (!r.charge_type) r.charge_type = 'FUEL';

    // Group the case-2 tickets by agent and by DAY: an into-plane agent bills
    // a station's uplifts periodically, not one invoice per aircraft.
    const groups = new Map();
    let case2Tickets = 0, skippedNoQty = 0;
    for (const t of tickets) {
        const f = flightById.get(t.flight_ID);
        const cfg = CASE2[f.origin_airport];
        if (!cfg) continue;
        const litres = num(t.quantity);
        if (!litres || litres <= 0) { skippedNoQty++; continue; }
        case2Tickets++;
        const key = `${cfg.agent}|${f.origin_airport}|${f.flight_date}`;
        if (!groups.has(key)) groups.set(key, { agent: cfg.agent, station: f.origin_airport,
                                               date: f.flight_date, rate: cfg.rate, items: [] });
        groups.get(key).items.push({ t, f, litres });
    }

    let invAdded = 0, lineAdded = 0, totalFee = 0;
    for (const [key, g] of [...groups.entries()].sort()) {
        const agent = AGENTS.find(a => a.code === g.agent);
        const invoiceNumber = `ITP-${g.agent.slice(0, 6)}-${g.station}-${g.date.replace(/-/g, '')}`;
        const invoiceID = uuid5(`INVOICE:${key}`);

        let net = 0;
        const lines = g.items
            .sort((a, b) => String(a.t.ticket_number).localeCompare(String(b.t.ticket_number)))
            .map((it, i) => {
                const fee = money(it.litres * g.rate);
                net += fee;
                const row = {};
                for (const c of itm.cols) row[c] = '';
                Object.assign(row, {
                    ID: uuid5(`ITEM:${key}:${it.t.ID}`),
                    invoice_ID: invoiceID,
                    // (i+1)*10 - the supplier's own numbering convention,
                    // 10/20/30, as INVOICE_ITEMS.line_number documents. The
                    // fuel line on the OTHER invoice is numbered in its own
                    // sequence, which is why the ticket page has to show the
                    // line item beside the invoice number: the pair is the
                    // address, neither half alone.
                    line_number: (i + 1) * 10,
                    description: `Into-plane handling ${g.station} ${it.f.flight_number} `
                               + `ticket ${it.t.ticket_number}`,
                    quantity: it.litres.toFixed(3),
                    uom_code: it.t.uom_code || 'L',
                    unit_price: g.rate.toFixed(4),
                    net_amount: fee.toFixed(2),
                    tax_amount: '0.00',
                    ticket_number: it.t.ticket_number,
                    ticket_ID: it.t.ID,
                    flight_ID: it.f.ID,
                    resolved_po_number: resolveFor(it.t.ID).po,
                    resolved_gr_number: resolveFor(it.t.ID).gr,
                    resolution_source: 'TICKET_ID',
                    line_match_status: 'UNMATCHED',
                    review_status: 'NONE',
                    // THE COLUMN THIS WHOLE EXERCISE TURNS ON. Without it
                    // INV455 reads these lines as a second billing of a
                    // ticket already billed for fuel, and blocks payment.
                    charge_type: 'INTO_PLANE'
                });
                return row;
            });

        const row = {};
        for (const c of inv.cols) row[c] = '';
        Object.assign(row, {
            ID: invoiceID,
            invoice_number: invoiceNumber,
            internal_number: `INV-ITP-${CARRIER}-${g.date.replace(/-/g, '')}-${String(++invAdded).padStart(3, '0')}`,
            supplier_ID: agentId[g.agent],
            invoice_date: g.date, posting_date: '', due_date: '', baseline_date: g.date,
            currency_code: 'USD',
            net_amount: money(net).toFixed(2), tax_amount: '0.00', gross_amount: money(net).toFixed(2),
            stated_net_amount: money(net).toFixed(2),
            stated_gross_amount: money(net).toFixed(2),
            stated_line_count: lines.length,
            payment_terms: 'NET30',
            match_status: 'UNMATCHED', approval_status: 'PENDING',
            requires_dual_approval: 'false',
            // SUBMITTED, NOT POSTED. These have not been through the checks,
            // and marking them POSTED would claim an approval nobody gave.
            //
            // NOT 'RECEIVED', which is what this said until 13 Oct 2026 and
            // is not a value InvoiceStatus has - the enum runs DRAFT,
            // SUBMITTED, VERIFIED, POSTED, PAID, CANCELLED. invoice_status_v
            // groups those four ways for the screen and an unknown value
            // falls through as itself, so nine invoices read "RECEIVED" in a
            // column that is meant to read "In process". Caught by
            // invoice-views EXIT-7, which checks exactly that grouping.
            status: 'SUBMITTED',
            is_duplicate: 'false',
            received_date: g.date,
            notes: `Into-plane handling billed by ${agent.name} at ${g.station} on ${g.date}. `
                 + `${lines.length} uplift(s) at an ASSUMED ${g.rate} USD/litre - no into-plane `
                 + `rate is recorded in FuelSphere, so this figure is illustrative and not a `
                 + `negotiated term. The fuel for the same tickets is billed separately by the `
                 + `fuel supplier; both reference the same ticket numbers, which is the case-2 `
                 + `arrangement and not a duplicate (INV455 is keyed on ticket AND charge).`,
            created_at: STAMP, created_by: BY, modified_at: STAMP, modified_by: BY
        });
        invRows.push(row);
        itmRows.push(...lines);
        lineAdded += lines.length;
        totalFee += net;
    }

    // =======================================================================
    // REPORT
    // =======================================================================
    console.log('');
    console.log('CASE 1  supplier fuels      ' + `${untouched} station map row(s) left exactly as they were`);
    console.log('CASE 2  third-party agent   ' + `${c2stations} station row(s) at ${Object.keys(CASE2).join(', ')}`);
    console.log('CASE 3  airline self-fuels  ' + `${c3stations} station row(s) at ${CASE3.join(', ')}`);
    console.log(`FLIGHT AXIS                 ${fltAdded} flight map row(s) overriding their station`);
    console.log('');
    console.log(`agents added as INTO_PLANE suppliers: ${AGENTS.length}`);
    console.log(`handling contracts added:             ${AGENTS.length}`);
    console.log(`case-2 tickets in the window:         ${case2Tickets}`
              + (skippedNoQty ? ` (${skippedNoQty} skipped, no quantity)` : ''));
    console.log(`into-plane invoices written:          ${invAdded}`);
    console.log(`into-plane lines written:             ${lineAdded}`);
    console.log(`into-plane fees billed:               ${money(totalFee).toFixed(2)} USD`);
    console.log('');
    console.log(`existing fuel lines re-stamped FUEL:  ${itmRows.filter(r => r.charge_type === 'FUEL').length}`);

    if (!WRITE) {
        console.log('\nDRY RUN - nothing written. Re-run with --write.');
        process.exit(0);
    }

    console.log('');
    writeCsv('MASTER_SUPPLIERS', sup.cols, supRows);
    writeCsv('MASTER_CONTRACTS', con.cols, conRows);
    writeCsv('STATION_SUPPLIER_MAP', stn.cols, stn.rows);
    writeCsv('FLIGHT_SUPPLIER_MAP', flt.cols, fltRows);
    writeCsv('INVOICES', inv.cols, invRows);
    writeCsv('INVOICE_ITEMS', itm.cols, itmRows);
    process.exit(0);
})().catch(e => { console.error('FATAL', e.stack || e.message); process.exit(1); });

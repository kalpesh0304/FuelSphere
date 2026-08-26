/**
 * WP-12 — delivery measurement. Exit criteria 1 to 5.
 * Exit criterion 6 (compile, deploy, service boot) is wp12-boot.js.
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const fs = require('node:fs');

const test = cds.test(PROJECT);
const out = (s) => process.stdout.write('      ' + s + '\n');
const T = '/odata/v4/tickets';
const O = '/odata/v4/orders';

const post = async (url, body) => {
    try { const r = await test.POST(url, body); return { status: r.status, data: r.data, headers: r.headers }; }
    catch (e) { return { status: e.response?.status ?? 'ERR', data: e.response?.data, headers: e.response?.headers, msg: e.response?.data?.error?.message ?? e.message }; }
};
const patch = async (url, body) => {
    try { const r = await test.PATCH(url, body); return { status: r.status, data: r.data }; }
    catch (e) { return { status: e.response?.status ?? 'ERR', data: e.response?.data, msg: e.response?.data?.error?.message ?? e.message }; }
};
// draftActivate returns 201 Created, not 200. Keying the assertion on 200
// would have failed every passing case.
const ok2xx = (s) => s === 200 || s === 201;

// Create an active (non-draft) ticket: POST creates a draft, draftActivate
// fires CREATE on the active entity where the derivation lives.
async function createTicket(payload) {
    const d = await post(`${T}/FuelTickets`, payload);
    if (d.status >= 400) return d;
    const a = await post(`${T}/FuelTickets(ID=${d.data.ID},IsActiveEntity=false)/TicketService.draftActivate`, {});
    return a;
}

describe('WP-12 — delivery measurement (B2, B5, B6)', function () {

    // ==================================================================
    it('EXIT-1 — a ticket records meter readings and derives quantity_kg', async () => {
        const r = await createTicket({
            ticket_number: 'WP12-H-001',
            quantity: 15000, uom_code: 'LTR',
            meter_start: 100000, meter_end: 115000,
            density_value: 0.8020, density_uom: 'KGL',
            delivery_timestamp: '2026-04-06T06:00:00Z'
        });
        assert.ok(ok2xx(r.status), JSON.stringify(r.data));
        out(`meter 100000 -> 115000 LTR at 0.8020 KGL`);
        out(`  quantity_metered=${r.data.quantity_metered}  quantity_kg=${r.data.quantity_kg}`);
        assert.strictEqual(Number(r.data.quantity_metered), 15000);
        assert.strictEqual(Number(r.data.quantity_kg), 12030);
        // The as-metered figure survives unaltered - it is what the supplier
        // invoices and what a dispute is about.
        assert.strictEqual(Number(r.data.quantity), 15000, 'the claimed quantity must not be overwritten');
        assert.strictEqual(Number(r.data.meter_start), 100000);
        assert.strictEqual(Number(r.data.meter_end), 115000);
    });

    it('EXIT-1b — KGM derives the same mass as KGL, which is why it is derived', async () => {
        const r = await createTicket({
            ticket_number: 'WP12-H-002',
            quantity: 15000, uom_code: 'LTR',
            meter_start: 0, meter_end: 15000,
            density_value: 802.0, density_uom: 'KGM',
            delivery_timestamp: '2026-04-06T06:10:00Z'
        });
        assert.ok(ok2xx(r.status), JSON.stringify(r.data));
        out(`same 15000 LTR at 802.0 KGM -> quantity_kg=${r.data.quantity_kg}`);
        assert.strictEqual(Number(r.data.quantity_kg), 12030,
            'a kg/m3 ticket and a kg/L ticket for the same fuel must be summable');
    });

    it('EXIT-1c — a missing density yields null, never zero', async () => {
        const r = await createTicket({
            ticket_number: 'WP12-H-003',
            quantity: 3000, uom_code: 'LTR',
            meter_start: 0, meter_end: 3000,
            delivery_timestamp: '2026-04-06T06:20:00Z'
        });
        assert.ok(ok2xx(r.status), JSON.stringify(r.data));
        out(`3000 LTR, no density -> quantity_metered=${r.data.quantity_metered} quantity_kg=${r.data.quantity_kg}`);
        assert.strictEqual(Number(r.data.quantity_metered), 3000, 'the metered figure still lands');
        assert.strictEqual(r.data.quantity_kg, null, 'unknown mass is null, not 0');
    });

    it('EXIT-1d — EPD411 warns where the meter delta and the claim disagree', async () => {
        const r = await createTicket({
            ticket_number: 'WP12-H-004',
            quantity: 5000, uom_code: 'LTR',
            meter_start: 21000, meter_end: 25600,   // 4600, not 5000
            density_value: 0.7995, density_uom: 'KGL',
            delivery_timestamp: '2026-04-06T06:30:00Z'
        });
        assert.ok(ok2xx(r.status), 'the ticket is captured, not refused - decision A1');
        // req.warn surfaces in the sap-messages header, not the body. Reading
        // only the body would have reported "no EPD411" for a rule that fired.
        const msg = (r.headers && r.headers['sap-messages']) || JSON.stringify(r.data['@odata.messages'] || '');
        out(`claimed 5000, metered 4600 -> ${r.status}, quantity_kg=${r.data.quantity_kg}`);
        out(`  sap-messages: ${msg}`);
        assert.match(String(msg), /EPD411/, 'must carry EPD411');
        assert.strictEqual(Number(r.data.quantity_metered), 4600, 'the metered figure governs the derivation');
        assert.strictEqual(Number(r.data.quantity_kg), 3677.7);
    });

    // ==================================================================
    it('EXIT-2 — a delivery holds both readings distinct, ground_burn derived', async () => {
        const db = await cds.connect.to('db');
        const d = await db.run(SELECT.one.from('fuelsphere.FUEL_DELIVERIES')
            .where({ delivery_number: 'EPD-CEB-20260405-0001' }));
        out(`arrival=${d.fob_at_arrival_kg} before=${d.fob_before_kg} after=${d.fob_after_kg}`);
        out(`  fob_delta=${d.fob_delta_kg}  ground_burn=${d.ground_burn_kg}  source=${d.fob_source}`);
        assert.notStrictEqual(Number(d.fob_at_arrival_kg), Number(d.fob_before_kg),
            'the two readings must be distinct measurements, not one copied');
        assert.strictEqual(Number(d.fob_delta_kg), 19200);
        assert.strictEqual(Number(d.ground_burn_kg), 850);
    });

    it('EXIT-2b — the derivation is the handler, not the seed', async () => {
        // FUEL_DELIVERIES is a draft composition child of FUEL_ORDERS, so the
        // only way in is through the order root - CAP refuses a direct write
        // with DRAFT_MODIFICATION_ONLY_VIA_ROOT even at the service API. This
        // is the real application path. Only the three readings are supplied;
        // neither derived field is, so whatever comes out was computed by
        // before CREATE and not read from a CSV.
        const o = await post(`${O}/FuelOrders`, {
            station_code: 'CEB', requested_date: '2026-04-06',
            ordered_quantity: 12000, uom_code: 'LTR'
        });
        assert.ok(ok2xx(o.status), o.msg || JSON.stringify(o.data));

        const nested = await post(`${O}/FuelOrders(ID=${o.data.ID},IsActiveEntity=false)/deliveries`, {
            aircraft_reg: 'RP-C8803', delivery_number: 'EPD-WP12-H-0001',
            delivery_date: '2026-04-06', delivery_time: '08:00:00',
            delivered_quantity: 12000, uom_code: 'LTR',
            fob_at_arrival_kg: 18300, fob_before_kg: 17600, fob_after_kg: 27200,
            fob_source: 'ACARS'
        });
        assert.ok(ok2xx(nested.status), nested.msg || JSON.stringify(nested.data));
        const act = await post(`${O}/FuelOrders(ID=${o.data.ID},IsActiveEntity=false)/FuelOrderService.draftActivate`, {});
        assert.ok(ok2xx(act.status), act.msg || JSON.stringify(act.data));

        const db = await cds.connect.to('db');
        // Keyed on the row's own ID. The delivery number is allocated by a
        // before-CREATE handler, so the number sent in is not the number
        // stored - looking it up by that would have reported "not created"
        // for a row that exists.
        const d = await db.run(SELECT.one.from('fuelsphere.FUEL_DELIVERIES')
            .where({ ID: nested.data.ID }));
        assert.ok(d, 'the delivery must have been created');
        out(`created via the order root: arrival=18300 before=17600 after=27200, no derived fields supplied`);
        out(`  fob_delta=${d.fob_delta_kg}  ground_burn=${d.ground_burn_kg}`);
        assert.strictEqual(Number(d.fob_delta_kg), 9600, '27200 - 17600');
        assert.strictEqual(Number(d.ground_burn_kg), 700, '18300 - 17600');
    });

    it('EXIT-2c — one reading only leaves fob_at_arrival and ground_burn null', async () => {
        const db = await cds.connect.to('db');
        const d = await db.run(SELECT.one.from('fuelsphere.FUEL_DELIVERIES')
            .where({ delivery_number: 'EPD-MNL-20260405-0001' }));
        out(`arrival=${d.fob_at_arrival_kg}  before=${d.fob_before_kg}  ground_burn=${d.ground_burn_kg}`);
        assert.strictEqual(d.fob_at_arrival_kg, null, 'must NOT be copied from fob_before');
        assert.strictEqual(d.ground_burn_kg, null, 'a zero here would claim no APU burned');
        assert.strictEqual(Number(d.fob_before_kg), 8400, 'the reading that exists is on fob_before');
        assert.strictEqual(Number(d.fob_delta_kg), 4800, 'the delta still derives from before/after');

        // And through the handler, not only from the seed: one reading in,
        // ground_burn_kg still null out.
        const o = await post(`${O}/FuelOrders`, {
            station_code: 'MNL', requested_date: '2026-04-06',
            ordered_quantity: 6000, uom_code: 'LTR'
        });
        assert.ok(ok2xx(o.status), o.msg);
        const nested = await post(`${O}/FuelOrders(ID=${o.data.ID},IsActiveEntity=false)/deliveries`, {
            aircraft_reg: 'RP-C8801', delivery_date: '2026-04-06', delivery_time: '19:40:00',
            delivered_quantity: 6000, uom_code: 'LTR',
            fob_before_kg: 8400, fob_after_kg: 13200, fob_source: 'CREW_REPORTED'
        });
        assert.ok(ok2xx(nested.status), nested.msg);
        const act = await post(`${O}/FuelOrders(ID=${o.data.ID},IsActiveEntity=false)/FuelOrderService.draftActivate`, {});
        assert.ok(ok2xx(act.status), act.msg);
        const h = await db.run(SELECT.one.from('fuelsphere.FUEL_DELIVERIES').where({ ID: nested.data.ID }));
        out(`via handler, no arrival reading: fob_delta=${h.fob_delta_kg} ground_burn=${h.ground_burn_kg}`);
        assert.strictEqual(Number(h.fob_delta_kg), 4800, 'the delta still derives');
        assert.strictEqual(h.ground_burn_kg, null, 'no arrival reading means no ground burn — not zero');
    });

    // ==================================================================
    it('EXIT-3 — temperature_corrected_qty is null where uom_code is a mass unit', async () => {
        const db = await cds.connect.to('db');
        // Positive control first: prove the action computes on a volume row,
        // so a null on the mass row is the gate and not a broken action.
        const vol = await db.run(SELECT.one.from('fuelsphere.FUEL_DELIVERIES')
            .where({ delivery_number: 'EPD-CEB-20260405-0001' }));
        const rv = await post(`${O}/FuelDeliveries(ID=${vol.ID},IsActiveEntity=true)/FuelOrderService.calculateTemperatureCorrection`, {});
        out(`LTR delivery -> success=${rv.data.success} corrected=${rv.data.correctedQuantity} factor=${rv.data.correctionFactor}`);
        assert.strictEqual(rv.status, 200, rv.msg);
        assert.strictEqual(rv.data.success, true, 'instrument check: a volume delivery must still compute');
        assert.ok(Number(rv.data.correctedQuantity) > 0);

        const mass = await db.run(SELECT.one.from('fuelsphere.FUEL_DELIVERIES')
            .where({ delivery_number: 'EPD-YYZ-20260325-001' }));
        assert.strictEqual(mass.uom_code, 'KG');
        const rm = await post(`${O}/FuelDeliveries(ID=${mass.ID},IsActiveEntity=true)/FuelOrderService.calculateTemperatureCorrection`, {});
        out(`KG delivery  -> success=${rm.data.success} corrected=${rm.data.correctedQuantity}`);
        out(`  ${rm.data.message}`);
        assert.strictEqual(rm.status, 200, rm.msg);
        assert.strictEqual(rm.data.correctedQuantity, null, 'must be null');
        assert.notStrictEqual(Number(rm.data.correctedQuantity), Number(mass.delivered_quantity),
            'must NOT return the input unchanged - that claims a correction happened');

        const stored = await db.run(SELECT.one.from('fuelsphere.FUEL_DELIVERIES').where({ ID: mass.ID }));
        assert.strictEqual(stored.temperature_corrected_qty, null, 'and null is what is stored');
        out(`  stored temperature_corrected_qty = ${stored.temperature_corrected_qty}`);
    });

    // ==================================================================
    it('EXIT-4 — DensityUom rejects a value outside the enum', async () => {
        // Instrument check: a good value is accepted, so a rejection below is
        // the assertion firing and not a blanket refusal.
        const ok = await createTicket({
            ticket_number: 'WP12-H-005', quantity: 100, uom_code: 'LTR',
            density_value: 0.8, density_uom: 'KGL',
            delivery_timestamp: '2026-04-06T07:00:00Z'
        });
        assert.ok(ok2xx(ok.status), 'KGL must be accepted');
        out(`density_uom='KGL' -> ${ok.status}`);

        const bad = await createTicket({
            ticket_number: 'WP12-H-006', quantity: 100, uom_code: 'LTR',
            density_value: 0.8, density_uom: 'KGX',
            delivery_timestamp: '2026-04-06T07:10:00Z'
        });
        out(`density_uom='KGX' -> ${bad.status}`);
        out(`  ${bad.msg || JSON.stringify(bad.data)}`);
        assert.ok(bad.status >= 400, `an out-of-enum density unit must be refused, got ${bad.status}`);
    });

    it('EXIT-4b — FobSource and ReconStatus are annotated too', async () => {
        const m = cds.model.definitions;
        for (const t of ['DensityUom', 'FobSource', 'ReconStatus']) {
            const d = m[`fuelsphere.${t}`];
            assert.ok(d, `type fuelsphere.${t} missing`);
            assert.ok(d['@assert.range'], `${t} declares an enum without @assert.range — D25`);
            out(`fuelsphere.${t}: @assert.range present, ${Object.keys(d.enum).length} members`);
        }
    });

    // ==================================================================
    it('EXIT-5 — FLIGHT_CYCLE_EVENTS carries no fuel quantity fields', async () => {
        const gone = ['uplift_kg', 'density_kg_l', 'temperature_c', 'bowser_id', 'sequence_number'];
        const e = cds.model.definitions['fuelsphere.FLIGHT_CYCLE_EVENTS'];
        assert.ok(e.elements['event_type'], 'instrument check: the entity is visible');
        assert.deepStrictEqual(gone.filter(f => e.elements[f]), []);
        out(`FLIGHT_CYCLE_EVENTS: event_type visible, 0 of 5 fuel fields present`);
        assert.ok(cds.model.definitions['fuelsphere.ROB_LEDGER'].elements['uplift_kg'],
            'ROB_LEDGER.uplift_kg is a different field and must survive');
        out(`ROB_LEDGER.uplift_kg untouched`);
    });

    it('EXIT-5b — the four delivered_quantity sites are unchanged', async () => {
        const sites = [
            ['db/schema.cds', /delivered_quantity\s*:\s*Decimal\(12,2\)\s*@mandatory/],
            ['srv/order-fiori-annotations.cds', /delivered_quantity\s+@title:.*@mandatory/],
            ['srv/refueler-service.js', /delivered_quantity:\s*deliveredQuantity/]
        ];
        for (const [f, re] of sites) {
            const src = fs.readFileSync(`${PROJECT}/${f}`, 'utf8');
            assert.match(src, re, `${f} changed`);
        }
        const ref = fs.readFileSync(`${PROJECT}/srv/refueler-service.js`, 'utf8');
        const writers = (ref.match(/delivered_quantity:\s*deliveredQuantity/g) || []).length;
        const readers = (fs.readFileSync(`${PROJECT}/srv/order-service.js`, 'utf8')
            .match(/delivery\.delivered_quantity/g) || []).length;
        out(`@mandatory: 2 sites intact  ·  refueler writers: ${writers}  ·  order-service readers: ${readers}`);
        assert.strictEqual(writers, 2, 'both direct writers must remain — derivation is WP-17');
        assert.ok(readers >= 5, 'the EPD401 readers must remain');
    });

    it('EXIT-5c — seeded gallon tickets derive no mass, and say why (F19)', async () => {
        const { deriveTicketMassKg } = require(`${PROJECT}/srv/lib/fuel-uom`);
        const g = await deriveTicketMassKg({
            quantity_metered: 1000, uom_code: 'GAL', density_value: 0.802, density_uom: 'KGL'
        });
        out(`GAL ticket -> quantity_kg=${g.quantity_kg}  reason: ${g.reason}`);
        assert.strictEqual(g.quantity_kg, null, 'no invented gallon factor');
        assert.match(g.reason, /F19/);
    });
});

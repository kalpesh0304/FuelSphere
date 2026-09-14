/**
 * CAPTURING A SUPPLIER'S TICKET FROM THE ORDER IN FRONT OF YOU.
 *
 * FuelOrderService OFFERS the action; TicketService PERFORMS it. One INSERT,
 * which is D44's point - and the insert goes THROUGH the service, which is
 * the whole substance of this package.
 *
 * FROM THE ORDER ONLY. A ticket raised from a flight would have to choose
 * among the flight's orders, and a to-one over a condition matching many is
 * D44 exactly. From the order there is nothing to choose.
 *
 * NO GATE - DECISION A1. The fuel is in the tanks before a ticket exists, so
 * capture is never refused. The only refusal reachable is EPD411 on a meter
 * span that runs BACKWARDS, which is an impossible reading rather than a
 * business rule. A ticket with no order is legitimate and seeded.
 *
 * WHERE THE ASSERTIONS COME FROM, because a criterion derived from the same
 * source as the code is a restatement wearing a test's clothes (section 13):
 *   EXIT-1  the SEED - every derivation is checked against a figure computed
 *           in the criterion from its own literal inputs, not read back from
 *           whatever the handler happened to write
 *   EXIT-2  a COUNT of rows before and after, which the handler cannot fake
 *   EXIT-3  the DOCUMENTED rule (A1), against a refusal the handler does make
 *   EXIT-4  `deriveTicketMassKg` called DIRECTLY, so the density finding is a
 *           property of the library rather than of this action
 *
 *   EXIT-1  the derivations fire, and each figure is computed here
 *   EXIT-2  ONE row, not two - the insert dispatches through the service
 *   EXIT-3  A1: no gate, and the one refusal that exists is a bad reading
 *   EXIT-4  a VOLUME ticket without density_uom yields a NULL mass
 *   EXIT-5  the button is on the projection the deployed app opens
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const test = cds.test(PROJECT);
const out = s => process.stdout.write('      ' + s + '\n');
const { SELECT } = cds.ql;
const O = '/odata/v4/orders';

const call = async f => {
    try { const r = await f(); return { status: r.status, data: r.data }; }
    catch (e) {
        return { status: e.response?.status || e.status || 0,
                 msg: e.response?.data?.error?.message || e.message };
    }
};
const capture = (orderId, body) => call(() => test.POST(
    `${O}/FuelOrders(ID=${orderId},IsActiveEntity=true)/FuelOrderService.createFuelTicket`, body));

const count = async () => (await cds.db.run(SELECT.from('fuelsphere.FUEL_TICKETS').columns('ID'))).length;

describe('Capture a fuel ticket from the order', function () {
    this.timeout(120000);

    let orderWithFlight;

    before(async () => {
        const orders = await cds.db.run(SELECT.from('fuelsphere.FUEL_ORDERS')
            .columns('ID', 'order_number', 'station_code', 'flight_ID'));
        orderWithFlight = orders.find(o => o.flight_ID && o.station_code);
        assert.ok(orderWithFlight,
            'no order has both a flight and a station - EXIT-1 could not check the tail or the number');
    });

    // -------------------------------------------------------------- EXIT-1 --
    // EVERY DERIVED FIGURE IS COMPUTED HERE FROM THE LITERAL INPUTS, not read
    // back and compared to itself. The mass especially: 2884 L at 0.8 kg/L is
    // 2307.20, and that arithmetic is in this file rather than borrowed from
    // the library the handler calls.
    it('EXIT-1  the before-CREATE derivations all fire', async () => {
        const START = 10000, END = 12884, DENS = 0.8;
        const expectMetered = END - START;                  // 2884
        const expectKg = Number((expectMetered * DENS).toFixed(2)); // 2307.20

        const r = await capture(orderWithFlight.ID, {
            ticketNumber: 'HARNESS-CAP-001', quantity: expectMetered,
            deliveryTimestamp: '2026-09-14T10:45:00Z',
            meterStart: START, meterEnd: END,
            densityValue: DENS, densityUom: 'KGL', densityTempC: 15, uomCode: 'LTR'
        });
        assert.strictEqual(r.status, 200, `capture failed: ${r.msg}`);
        const t = r.data;
        out(`metered ${t.quantity_metered} (computed ${expectMetered})`);
        out(`mass    ${t.quantity_kg} (computed ${expectKg} = ${expectMetered} L x ${DENS})`);
        out(`number  ${t.internal_number}   match ${t.match_status}   tail ${t.aircraft_reg}`);

        assert.strictEqual(Number(t.quantity_metered), expectMetered,
            'quantity_metered was not derived - the insert is bypassing deriveMeasurement');
        assert.strictEqual(Number(t.quantity_kg), expectKg,
            'quantity_kg was not derived - the insert is bypassing deriveTicketMassKg');
        assert.ok(t.internal_number,
            'no internal_number - the insert is bypassing the numbering hook');
        assert.strictEqual(t.match_status, 'MATCHED',
            'match_status is not MATCHED on a ticket that HAS an order');
        assert.ok(t.aircraft_reg,
            'no registration - the order has a flight, so the tail should have come from it');
    });

    // -------------------------------------------------------------- EXIT-2 --
    // A COUNT THE HANDLER CANNOT FAKE. D44 is two implementations of one rule;
    // a second INSERT here would be that shape, and the returned payload would
    // look identical either way.
    it('EXIT-2  exactly ONE row is written', async () => {
        const before = await count();
        const r = await capture(orderWithFlight.ID, {
            ticketNumber: 'HARNESS-CAP-002', quantity: 500,
            deliveryTimestamp: '2026-09-14T11:00:00Z',
            meterStart: 0, meterEnd: 500, uomCode: 'KG'
        });
        const after = await count();
        out(`tickets ${before} -> ${after}  delta ${after - before}  (${r.status})`);
        assert.strictEqual(r.status, 200, `capture failed: ${r.msg}`);
        assert.strictEqual(after - before, 1,
            'the action did not write exactly one ticket - a second INSERT is D44 reintroduced');
    });

    // -------------------------------------------------------------- EXIT-3 --
    // A1 IS A DOCUMENTED DECISION AND THIS ASSERTS IT AGAINST THE DOCUMENT,
    // not against the handler: capture is NEVER blocked, and the one refusal
    // that exists is a meter span running backwards - an impossible reading,
    // not a business gate. Both halves, because "it accepted something" alone
    // would pass on a handler that accepts everything including nonsense.
    it('EXIT-3  no gate, and the only refusal is an impossible reading', async () => {
        const thin = await capture(orderWithFlight.ID, {
            ticketNumber: 'HARNESS-CAP-003', quantity: 250,
            deliveryTimestamp: '2026-09-14T11:15:00Z'
        });
        out(`no meters, no density -> ${thin.status} ${thin.msg || ''}`);
        assert.strictEqual(thin.status, 200,
            'a ticket with only the printed figures was refused - A1 says capture is never blocked');

        const back = await capture(orderWithFlight.ID, {
            ticketNumber: 'HARNESS-CAP-004', quantity: 100,
            deliveryTimestamp: '2026-09-14T11:30:00Z', meterStart: 500, meterEnd: 100
        });
        out(`meter 500 -> 100 -> ${back.status} ${String(back.msg || '').slice(0, 70)}`);
        assert.ok(back.status >= 400 && back.status < 500,
            'a meter span running backwards was accepted');
        assert.ok(/EPD411/.test(String(back.msg)),
            `the refusal does not name EPD411: ${back.msg}`);
    });

    // -------------------------------------------------------------- EXIT-4 --
    // THE DENSITY FINDING, ASSERTED AGAINST THE LIBRARY rather than against
    // this action - so it stays true if the action is rewritten, and states a
    // property of the derivation itself.
    //
    // The brief listed seven typed fields and density_uom was not among them.
    // uom_code DEFAULTS TO LTR, so the default ticket is a volume ticket, and
    // a volume ticket without a density unit gets a NULL mass. 14 of 30 seeded
    // tickets are LTR. Typing density_value alone would have produced a null
    // mass on every litre ticket.
    it('EXIT-4  a volume ticket without density_uom yields a NULL mass', async () => {
        const { deriveTicketMassKg } = require(`${PROJECT}/srv/lib/fuel-uom.js`);
        const withUom = await deriveTicketMassKg(
            { quantity_metered: 1000, uom_code: 'LTR', density_value: 0.8, density_uom: 'KGL' });
        const without = await deriveTicketMassKg(
            { quantity_metered: 1000, uom_code: 'LTR', density_value: 0.8 });
        const mass = await deriveTicketMassKg(
            { quantity_metered: 1000, uom_code: 'KG' });
        out(`LTR with density_uom -> ${withUom.quantity_kg}`);
        out(`LTR without          -> ${without.quantity_kg}  (${without.reason})`);
        out(`KG  with no density  -> ${mass.quantity_kg}  <- a mass unit needs none`);

        assert.ok(withUom.quantity_kg > 0, 'the control failed: a complete volume ticket has no mass');
        assert.strictEqual(without.quantity_kg, null,
            'a volume ticket without density_uom produced a mass - the finding has changed');
        assert.ok(/density_uom/.test(String(without.reason)),
            'the derivation declined without saying density_uom is why');
        assert.ok(mass.quantity_kg > 0,
            'a MASS ticket was refused a mass - it needs no density and this would make the '
          + 'density inputs wrongly mandatory');
    });

    // -------------------------------------------------------------- EXIT-5 --
    // THE BUTTON IS ON THE PROJECTION THE DEPLOYED APP OPENS. `fuelorders`
    // binds /odata/v4/orders/ and opens FuelOrders.
    //
    // AND THIS CANNOT ASSERT THAT IT RENDERS. Nothing here can: rendering
    // needs the UI5 runtime and ui5.sap.com is 403 in this container, so
    // $fiori-preview's 200 is a route resolving with no pixels behind it. This
    // asserts placement and says plainly that placement is not rendering -
    // the gap is named rather than implied covered.
    it('EXIT-5  the action is annotated on the projection the deployed app opens', async () => {
        const md = String((await call(() => test.GET(`${O}/$metadata`))).data);
        assert.ok(/<Action Name="createFuelTicket" IsBound="true">/.test(md),
            'createFuelTicket is not bound');
        const bind = (md.match(
            /<Action Name="createFuelTicket"[\s\S]{0,200}?Parameter Name="in" Type="([^"]+)"/) || [])[1];
        out(`binding parameter: ${bind}`);
        assert.strictEqual(bind, 'FuelOrderService.FuelOrders',
            'the action is not bound to the entity the fuelorders app opens');

        const i = md.indexOf('<Annotations Target="FuelOrderService.FuelOrders">');
        assert.ok(i > 0, 'no annotation block on FuelOrders');
        const blk = md.slice(i, md.indexOf('</Annotations>', i));
        const acts = [...blk.matchAll(/Property="Action"\s+String="([^"]+)"/g)].map(m => m[1]);
        out(`actions annotated on FuelOrders: ${acts.join(', ')}`);
        assert.ok(acts.includes('FuelOrderService.createFuelTicket'),
            'the action is declared and NOT annotated - invisible on every screen');
        out('placement asserted; RENDERING IS NOT ASSERTED AND CANNOT BE HERE');
    });
});

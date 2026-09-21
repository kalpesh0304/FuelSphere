/**
 * THE FLIGHT-LEVEL FUEL VARIANCE.
 *
 *     variance = SUM( delivered_quantity )  for the flight
 *              - SUM( ticket.quantity_kg )  for the flight
 *
 * Positive: more fuel reached the aircraft than the tickets account for.
 * Negative: fuel invoiced and not received - the commercially interesting way
 * round, and the reason the sign has to survive every path that writes it.
 *
 * TWO CONTROLS NOW READ THE SAME TWO MEASUREMENTS, and they disagree on
 * purpose. EPD461 (fob-reconciliation.js) reads metered minus gauge and asks
 * whether the supplier billed more than arrived. This reads delivered minus
 * metered. A single signed number cannot answer both questions, so the most
 * valuable thing this harness does is prove the older control did not quietly
 * change sign when the newer one was added.
 *
 *   EXIT-1  the arithmetic and the SIGN, both directions. A surplus reads +
 *           and a shortfall reads -, and neither is an absolute value
 *   EXIT-2  it is the FLIGHT, not the delivery. Two deliveries on one leg
 *           reconcile together and would BOTH show a false variance if scoped
 *           per delivery - this is the case EPD461 structurally cannot answer
 *   EXIT-3  the tolerance decides the status, at the existing greater-of-
 *           percentage-or-floor rule, and the band is reported with it
 *   EXIT-4  EPD461 IS UNCHANGED - same sign, same value, in the same scenario
 *   EXIT-5  it is written on CREATE, through the service, with no second save
 *   EXIT-6  a leg with no ticket, or no gauge, reads NOT_RECONCILED and a
 *           BLANK variance. Zero would mean "checked, and they matched"
 *   EXIT-7  an unmassed ticket suspends the verdict. A litre ticket with no
 *           density contributes nothing to the metered side, so reporting
 *           RECONCILED would call fuel missing that was simply never weighed
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const test = cds.test(PROJECT);
const out = s => process.stdout.write('      ' + s + '\n');

const { compareFlight, reconcileFlight } = require(`${PROJECT}/srv/lib/flight-variance`);
const { reconcile, resolveTolerance, toleranceKg } = require(`${PROJECT}/srv/lib/fob-reconciliation`);

const D = 'fuelsphere.FUEL_DELIVERIES';
const T = 'fuelsphere.FUEL_TICKETS';
const n = v => (v === null || v === undefined ? null : Number(v));

const TAIL = 'LV-TEST';
const FLIGHT_NO = 'AR9001', FLIGHT_DATE = '2026-11-02';
let flightId;

async function seedFlight() {
    for (const e of [D, T]) await cds.db.run(DELETE.from(e).where({ aircraft_reg: TAIL }));
    await cds.db.run(DELETE.from('fuelsphere.FLIGHT_SCHEDULE').where({ flight_number: FLIGHT_NO }));

    flightId = cds.utils.uuid();
    await cds.db.run(INSERT.into('fuelsphere.FLIGHT_SCHEDULE').entries({
        ID: flightId, flight_number: FLIGHT_NO, flight_date: FLIGHT_DATE,
        origin_airport: 'AEP', destination_airport: 'COR'
    }));
    return flightId;
}

/** @param {number|null} delivered  kg on the gauge side */
async function addDelivery(delivered, { fob_source = 'ACARS', flight = true } = {}) {
    const ID = cds.utils.uuid();
    await cds.db.run(INSERT.into(D).entries({
        ID, delivery_number: `D-${ID.slice(0, 8)}`, aircraft_reg: TAIL,
        flight_ID: flight ? flightId : null,
        delivery_date: FLIGHT_DATE, delivered_quantity: delivered,
        uom_code: 'KG', fob_source,
        fob_before_kg: 1000, fob_after_kg: delivered === null ? null : 1000 + delivered,
        fob_delta_kg: delivered
    }));
    return ID;
}

/** @param {number|null} massKg  null models a litre ticket with no density */
async function addTicket(massKg, deliveryId = null) {
    const ID = cds.utils.uuid();
    await cds.db.run(INSERT.into(T).entries({
        ID, ticket_number: `T-${ID.slice(0, 8)}`, aircraft_reg: TAIL,
        flight_ID: flightId, delivery_ID: deliveryId,
        quantity: massKg === null ? 1000 : massKg, uom_code: 'KG',
        quantity_metered: massKg === null ? 1000 : massKg, quantity_kg: massKg
    }));
    return ID;
}

const readDelivery = (id) => cds.db.run(SELECT.one.from(D)
    .columns('flight_variance_kg', 'flight_variance_status', 'flight_metered_kg',
             'flight_delivered_kg', 'flight_tolerance_kg', 'recon_variance_kg')
    .where({ ID: id }));

describe('Fuel Deliveries - the flight-level variance', () => {
    before(test.data.reset);

    it('EXIT-1 - the arithmetic and the sign, both directions', async () => {
        // Surplus: 5,000 kg on board against 4,900 kg ticketed.
        await seedFlight();
        const d1 = await addDelivery(5000);
        await addTicket(4900);
        await reconcileFlight(flightId);
        let r = await readDelivery(d1);
        assert.strictEqual(n(r.flight_variance_kg), 100,
            'a surplus must read POSITIVE, not as an absolute value');
        assert.strictEqual(n(r.flight_delivered_kg), 5000);
        assert.strictEqual(n(r.flight_metered_kg), 4900);

        // Shortfall: the same figures the other way round.
        await seedFlight();
        const d2 = await addDelivery(4900);
        await addTicket(5000);
        await reconcileFlight(flightId);
        r = await readDelivery(d2);
        assert.strictEqual(n(r.flight_variance_kg), -100,
            'a shortfall must read NEGATIVE - fuel billed and not received');
        out('surplus +100 kg, shortfall -100 kg: the sign survives both directions');
    });

    it('EXIT-2 - scoped to the flight, not the delivery', async () => {
        // ONE leg, TWO deliveries, and the tickets split across them. Per
        // delivery each looks 2,000 kg out; on the flight they agree exactly.
        await seedFlight();
        const d1 = await addDelivery(3000);
        const d2 = await addDelivery(2000);
        await addTicket(3000, d1);
        await addTicket(2000, d2);
        await reconcileFlight(flightId);

        for (const [label, id] of [['first', d1], ['second', d2]]) {
            const r = await readDelivery(id);
            assert.strictEqual(n(r.flight_variance_kg), 0,
                `${label} delivery: a split refuelling must reconcile on the flight`);
            assert.strictEqual(n(r.flight_delivered_kg), 5000, `${label}: delivered total`);
            assert.strictEqual(n(r.flight_metered_kg), 5000, `${label}: metered total`);
            assert.strictEqual(r.flight_variance_status, 'RECONCILED', `${label}: status`);
        }
        out('one leg, two deliveries: 5,000 kg against 5,000 kg, variance 0 on BOTH rows');
    });

    it('EXIT-3 - the tolerance decides the status and is reported with it', async () => {
        // ACARS: 0.5% or a 50 kg floor, whichever is greater. On 20,000 kg
        // that is 100 kg, so 80 kg is inside and 150 kg is not.
        const rule = resolveTolerance('ACARS');
        const band = toleranceKg(rule, 20000);
        assert.strictEqual(band, 100, 'instrument check: the band under test is not 100 kg');

        await seedFlight();
        const inside = await addDelivery(20080);
        await addTicket(20000);
        await reconcileFlight(flightId);
        let r = await readDelivery(inside);
        assert.strictEqual(r.flight_variance_status, 'RECONCILED', '80 kg is inside a 100 kg band');
        assert.strictEqual(n(r.flight_tolerance_kg), 100, 'the band must be reported, not just applied');

        await seedFlight();
        const outside = await addDelivery(20150);
        await addTicket(20000);
        await reconcileFlight(flightId);
        r = await readDelivery(outside);
        assert.strictEqual(r.flight_variance_status, 'VARIANCE', '150 kg is outside a 100 kg band');
        assert.strictEqual(n(r.flight_variance_kg), 150);

        // The floor, not the percentage, on a small uplift: 0.5% of 400 kg is
        // 2 kg, well inside any gauge's noise, so 50 kg governs.
        assert.strictEqual(toleranceKg(rule, 400), 50, 'the floor must win on a small uplift');
        out(`ACARS band on 20,000 kg = ${band} kg: 80 reconciled, 150 variance; floor governs below 10,000 kg`);
    });

    it('EXIT-4 - EPD461 is unchanged by any of this', async () => {
        // The older control, computed directly, in the shape it has always
        // had: metered MINUS gauge. If adding the flight variance had flipped
        // or rescoped it, this is what would say so.
        const delivery = { fob_source: 'ACARS', fob_before_kg: 1000, fob_after_kg: 5900 };
        const tickets = [{ quantity_kg: 5000, supplier_ID: 'S1' }];
        const res = reconcile(delivery, tickets, resolveTolerance('ACARS'));

        assert.strictEqual(n(res.recon_variance_kg), 100,
            'EPD461 reads metered minus gauge: 5,000 - 4,900 = +100');

        // And the two controls face opposite ways on the same facts.
        const mine = compareFlight(
            [{ delivered_quantity: 4900, fob_source: 'ACARS' }],
            [{ quantity_kg: 5000 }],
            resolveTolerance('ACARS'));
        assert.strictEqual(n(mine.flight_variance_kg), -100,
            'the flight variance reads delivered minus metered: the opposite sign');
        assert.strictEqual(n(res.recon_variance_kg), -n(mine.flight_variance_kg),
            'the two controls must be exact negations on identical facts');
        out(`same facts: EPD461 ${n(res.recon_variance_kg)}, flight variance ${n(mine.flight_variance_kg)} - opposed, both intact`);
    });

    it('EXIT-5 - written on CREATE through the service, with no second save', async () => {
        await seedFlight();
        await addTicket(2500);

        // THE ACTUAL DRAFT FLOW, because the entity is draft-enabled and a
        // plain POST is not what the app does. The UI creates a draft, edits
        // it, and activates - and a handler registered on the wrong event
        // would pass a direct insert while leaving every real creation blank.
        const P = '/odata/v4/deliveries/FuelDeliveries';
        const draft = await test.POST(P, {
            delivery_number: 'D-CREATE-1', aircraft_reg: TAIL, flight_ID: flightId,
            delivery_date: FLIGHT_DATE, delivery_time: '10:00:00',
            delivered_quantity: 2400, uom_code: 'KG', fob_source: 'ACARS',
            fob_before_kg: 1000, fob_after_kg: 3400
        });
        assert.ok(draft.status === 201 || draft.status === 200, `draft create failed: ${draft.status}`);
        const id = draft.data.ID;

        if (draft.data.IsActiveEntity === false) {
            const act = await test.POST(
                `${P}(ID=${id},IsActiveEntity=false)/DeliveryService.draftActivate`, {});
            assert.ok(act.status === 200 || act.status === 201, `activate failed: ${act.status}`);
        }

        const r = await readDelivery(id);
        assert.strictEqual(n(r.flight_variance_kg), -100,
            'the variance must exist the moment the delivery does');
        assert.strictEqual(r.flight_variance_status, 'VARIANCE',
            '100 kg against a 2,500 kg uplift is outside the 50 kg floor');
        out(`created via OData: variance ${n(r.flight_variance_kg)} kg, ${r.flight_variance_status}, no second save`);
    });

    it('EXIT-6 - no ticket or no gauge reads blank, not zero', async () => {
        await seedFlight();
        const noTickets = await addDelivery(3000);
        await reconcileFlight(flightId);
        let r = await readDelivery(noTickets);
        assert.strictEqual(r.flight_variance_kg, null,
            'no ticket to compare against: blank, not a variance of 3,000');
        assert.strictEqual(r.flight_variance_status, 'NOT_RECONCILED');

        await seedFlight();
        const noGauge = await addDelivery(null);
        await addTicket(3000);
        await reconcileFlight(flightId);
        r = await readDelivery(noGauge);
        assert.strictEqual(r.flight_variance_kg, null,
            'no gauge reading: blank. Zero would read as agreement');
        assert.strictEqual(r.flight_variance_status, 'NOT_RECONCILED');
        out('no ticket and no gauge: both blank and NOT_RECONCILED, no invented zeros');
    });

    it('EXIT-7 - an unmassed ticket suspends the verdict', async () => {
        await seedFlight();
        const d = await addDelivery(5000);
        await addTicket(5000);
        await addTicket(null);      // litres captured, no density: no mass
        await reconcileFlight(flightId);

        const r = await readDelivery(d);
        // The figure is still reported - it is what the known tickets say.
        assert.strictEqual(n(r.flight_metered_kg), 5000, 'the known mass is still summed');
        assert.strictEqual(r.flight_variance_status, 'NOT_RECONCILED',
            'with a ticket carrying no mass the comparison is incomplete, so there is no verdict');
        out('one ticket with no density: figure reported, verdict withheld rather than guessed');
    });
});

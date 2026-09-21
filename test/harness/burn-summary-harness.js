/**
 * THE FLIGHT-WISE SUMMARY - ONE ROW ASSEMBLED FROM SIX ENTITIES.
 *
 * Report 2 of 6 prints one row per leg, and almost nothing on it lives on
 * FUEL_BURNS. The flight date and the gauge pair are on FLIGHT_SCHEDULE, the
 * dispatched uplift on FLIGHT_DISPATCH, the ticket figures on FUEL_TICKETS,
 * the measured mass on FUEL_DELIVERIES, the APU minutes on APU_USAGE, the
 * APU rate on AIRCRAFT_REGISTRATIONS, and the price the consumption half is
 * valued at on ROB_LEDGER. Six sources, six ways to be quietly wrong.
 *
 * THE FIELD DERIVATION TABLE IS THE CRITERION, and several of its mappings
 * are not the obvious one - Dispatch is required_uplift_kg not block fuel,
 * gravity is volume-weighted not the first ticket's, actual delta is the
 * DELIVERY gauge not the ticket mass, the APU rate is the TAIL's not the
 * cycle's. Each of those is a place where the obvious choice still yields a
 * plausible number, which is exactly why they are asserted individually.
 *
 *   EXIT-1  AR1304 reproduces the specimen row, every column, at the sources
 *           the derivation table names
 *   EXIT-2  the row ADDS UP: block less APU is engine, in mass and in money,
 *           and the three values are the three masses at one price
 *   EXIT-3  expected and actual delta come from DIFFERENT sources and stay
 *           different numbers - ticket against gauge
 *   EXIT-4  the virtuals are PRESENT over OData, active entity and draft
 *   EXIT-5  A NARROW $select STILL POPULATES THE ROW. This is the defect that
 *           shipped: Fiori selects only the displayed columns, flight_ID is
 *           not one of them, and the whole report silently went blank
 *   EXIT-6  nothing captured reads BLANK, not zero
 *   EXIT-7  two tickets sum, and gravity blends BY VOLUME - a small top-up
 *           must not pull the blend as hard as a large uplift
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const test = cds.test(PROJECT);
const out = s => process.stdout.write('      ' + s + '\n');

const { applyFlightSummary } = require(`${PROJECT}/srv/lib/burn-summary`);

const B = '/odata/v4/burn';
const n = v => (v === null || v === undefined ? null : Number(v));

// ---------------------------------------------------------------------------
// THE SPECIMEN ROW. AR1304, 14 Oct 2026, AEP - MDZ, LV-FVH.
// ---------------------------------------------------------------------------
const SPEC = {
    flight: 'AR1304', date: '2026-10-14', sector: 'AEP - MDZ', tail: 'LV-FVH',
    dispatch_kg: 2600, fqis_out_kg: 3776, fqis_in_kg: 1402,
    uplift_l: 3262, specific_gravity: 0.8, expected_delta_kg: 2609.6,
    actual_delta_kg: 2596, uplift_value_usd: 2984.73,
    block_burn_kg: 2374, block_burn_value_usd: 2715.38,
    apu_hours: 0.8, apu_rate_kg_hr: 110, apu_burn_sum_kg: 88, apu_burn_value_usd: 100.65,
    engine_burn_split_kg: 2286, engine_burn_value_usd: 2614.73,
    map_usd_per_kg: 1.1438, arrival_rob_kg: 1402
};

// The gauge pair behind actual delta: 3,776 - 1,180 = 2,596.
const FOB_BEFORE = 1180, FOB_AFTER = 3776;

let flightId, burnId;

async function seed({ tickets = 1, captured = true } = {}) {
    // Cleared first, and this is not housekeeping. Every case seeds the SAME
    // tail, and the MAP lookup walks that tail's whole ledger - a row left by
    // the previous case reads as a price that legitimately prevails.
    for (const e of ['fuelsphere.ROB_LEDGER', 'fuelsphere.APU_USAGE', 'fuelsphere.FUEL_BURNS']) {
        await cds.db.run(DELETE.from(e).where({ tail_number: SPEC.tail }));
    }
    await cds.db.run(DELETE.from('fuelsphere.FUEL_TICKETS').where({ aircraft_reg: SPEC.tail }));
    await cds.db.run(DELETE.from('fuelsphere.FUEL_DELIVERIES').where({ aircraft_reg: SPEC.tail }));
    await cds.db.run(DELETE.from('fuelsphere.FLIGHT_DISPATCH').where({ flight_number: SPEC.flight }));
    await cds.db.run(DELETE.from('fuelsphere.FLIGHT_SCHEDULE').where({ flight_number: SPEC.flight }));
    await cds.db.run(DELETE.from('fuelsphere.AIRCRAFT_REGISTRATIONS').where({ registration: SPEC.tail }));

    flightId = cds.utils.uuid();
    burnId = cds.utils.uuid();

    await cds.db.run(INSERT.into('fuelsphere.AIRCRAFT_REGISTRATIONS').entries({
        registration: SPEC.tail,
        apu_burn_rate_kg_hr: captured ? SPEC.apu_rate_kg_hr : null
    }));

    await cds.db.run(INSERT.into('fuelsphere.FLIGHT_SCHEDULE').entries({
        ID: flightId, flight_number: SPEC.flight, flight_date: SPEC.date,
        origin_airport: 'AEP', destination_airport: 'MDZ',
        fob_at_out_kg: captured ? SPEC.fqis_out_kg : null,
        fob_at_in_kg:  captured ? SPEC.fqis_in_kg  : null
    }));

    if (captured) {
        // Dispatch kg is required_uplift_kg. block_fuel_kg is seeded at a
        // DIFFERENT value on purpose - if the derivation reads the wrong
        // column, EXIT-1 sees 3,100 where it expects 2,600.
        await cds.db.run(INSERT.into('fuelsphere.FLIGHT_DISPATCH').entries({
            ID: cds.utils.uuid(), dispatch_order_id: 'FO-AR1304',
            flight_number: SPEC.flight, flight_date: SPEC.date,
            flight_schedule_ID: flightId,
            required_uplift_kg: SPEC.dispatch_kg, block_fuel_kg: 3100
        }));

        // The gauge. Actual delta comes from HERE, never from the tickets.
        const deliveryId = cds.utils.uuid();
        await cds.db.run(INSERT.into('fuelsphere.FUEL_DELIVERIES').entries({
            ID: deliveryId, delivery_number: 'D-AR1304', aircraft_reg: SPEC.tail,
            flight_ID: flightId, fob_before_kg: FOB_BEFORE, fob_after_kg: FOB_AFTER,
            fob_delta_kg: FOB_AFTER - FOB_BEFORE
        }));

        // One ticket, or a split across two suppliers at DIFFERENT densities
        // so the volume weighting has something to get wrong.
        const parts = tickets === 2
            ? [{ l: 2000, sg: 0.79, amt: 1830.11 }, { l: 1262, sg: 0.8158, amt: 1154.62 }]
            : [{ l: SPEC.uplift_l, sg: SPEC.specific_gravity, amt: SPEC.uplift_value_usd }];
        for (const [i, p] of parts.entries()) {
            await cds.db.run(INSERT.into('fuelsphere.FUEL_TICKETS').entries({
                ID: cds.utils.uuid(), ticket_number: `T-AR1304-${i}`,
                flight_ID: flightId, delivery_ID: deliveryId, aircraft_reg: SPEC.tail,
                uom_code: 'LTR', quantity: p.l, quantity_metered: p.l,
                density_value: p.sg, total_amount: p.amt
            }));
        }

        await cds.db.run(INSERT.into('fuelsphere.APU_USAGE').entries({
            ID: cds.utils.uuid(), tail_number: SPEC.tail,
            apu_start_utc: `${SPEC.date}T09:00:00Z`, apu_stop_utc: `${SPEC.date}T09:48:00Z`,
            usage_phase: 'TURNAROUND', apu_source: 'CALCULATED',
            running_minutes: 48, burn_rate_kg_hr: 999,   // deliberately wrong: the
            apu_burn_kg: SPEC.apu_burn_sum_kg,           // rate must come from the TAIL
            allocated_flight_ID: flightId
        }));

        await cds.db.run(INSERT.into('fuelsphere.ROB_LEDGER').entries({
            ID: cds.utils.uuid(), tail_number: SPEC.tail, record_date: SPEC.date,
            record_time: '10:00:00', sequence: 1, line_order: 1, entry_type: 'UPLIFT',
            opening_rob_kg: FOB_BEFORE, uplift_kg: SPEC.actual_delta_kg, burn_kg: 0,
            adjustment_kg: 0, closing_rob_kg: SPEC.fqis_out_kg,
            map_usd_per_kg: SPEC.map_usd_per_kg, balance_value_usd: 4318.99,
            data_source: 'TICKET', is_estimated: false
        }));
    }

    await cds.db.run(INSERT.into('fuelsphere.FUEL_BURNS').entries({
        ID: burnId, tail_number: SPEC.tail, flight_ID: flightId,
        burn_date: '2026-10-15',          // deliberately NOT the flight date
        actual_burn_kg: SPEC.block_burn_kg,
        // Stored 0.00 while the cycles carry 88 - exactly the live data's
        // shape, so reading the wrong column shows up as a zero.
        apu_burn_kg: 0, engine_burn_kg: 0,
        data_source: 'ACARS', status: 'PRELIMINARY'
    }));
}

/** Run the derivation the way the after-READ handler does. */
async function summarise() {
    const row = await cds.db.run(SELECT.one.from('fuelsphere.FUEL_BURNS').where({ ID: burnId }));
    await applyFlightSummary(row);
    return row;
}

describe('Fuel Burns - the Flight-Wise Summary columns', () => {
    before(test.data.reset);

    it('EXIT-1 - AR1304 reproduces the specimen row from the named sources', async () => {
        await seed();
        const r = await summarise();

        // Flight date from the SCHEDULE, not the burn record's own date.
        assert.strictEqual(String(r.flight_date_v).slice(0, 10), SPEC.date,
            'flight date must come from FLIGHT_SCHEDULE, not burn_date');
        assert.strictEqual(r.sector, SPEC.sector, 'sector');
        for (const key of ['dispatch_kg', 'fqis_out_kg', 'fqis_in_kg', 'uplift_l',
                           'specific_gravity', 'expected_delta_kg', 'actual_delta_kg',
                           'uplift_value_usd', 'block_burn_kg', 'block_burn_value_usd',
                           'apu_hours', 'apu_rate_kg_hr', 'apu_burn_sum_kg',
                           'apu_burn_value_usd', 'engine_burn_split_kg',
                           'engine_burn_value_usd', 'map_usd_per_kg', 'arrival_rob_kg']) {
            assert.strictEqual(n(r[key]), SPEC[key], `${key}: expected ${SPEC[key]}, got ${r[key]}`);
        }
        out(`AR1304: dispatch ${n(r.dispatch_kg)} (required_uplift, not block fuel), ` +
            `APU rate ${n(r.apu_rate_kg_hr)} from the tail, APU ${n(r.apu_burn_sum_kg)} kg from the cycles`);
    });

    it('EXIT-2 - the row adds up, in mass and in money', async () => {
        await seed();
        const r = await summarise();

        assert.strictEqual(n(r.block_burn_kg) - n(r.apu_burn_sum_kg), n(r.engine_burn_split_kg),
            'block - APU must equal engine, in kilograms');
        assert.ok(Math.abs(n(r.block_burn_value_usd) - n(r.apu_burn_value_usd) - n(r.engine_burn_value_usd)) < 0.01,
            'block - APU must equal engine, in dollars');
        for (const [kgKey, usdKey] of [['block_burn_kg', 'block_burn_value_usd'],
                                       ['apu_burn_sum_kg', 'apu_burn_value_usd'],
                                       ['engine_burn_split_kg', 'engine_burn_value_usd']]) {
            const implied = n(r[usdKey]) / n(r[kgKey]);
            assert.ok(Math.abs(implied - n(r.map_usd_per_kg)) < 0.0005,
                `${usdKey} is not ${kgKey} at the MAP (implied ${implied.toFixed(4)})`);
        }
        assert.strictEqual(n(r.block_burn_kg), n(r.fqis_out_kg) - n(r.fqis_in_kg),
            'block burn is FQIS out - FQIS in');
        out(`adds up: ${n(r.block_burn_kg)} - ${n(r.apu_burn_sum_kg)} = ${n(r.engine_burn_split_kg)} kg, ` +
            `${n(r.block_burn_value_usd)} - ${n(r.apu_burn_value_usd)} = ${n(r.engine_burn_value_usd)} USD`);
    });

    it('EXIT-3 - expected is the ticket, actual is the gauge, and they differ', async () => {
        await seed();
        const r = await summarise();

        assert.notStrictEqual(n(r.expected_delta_kg), n(r.actual_delta_kg),
            'the two delta columns collapsed - both were taken from the same source');
        assert.strictEqual(n(r.expected_delta_kg),
            Number((n(r.uplift_l) * n(r.specific_gravity)).toFixed(2)),
            'expected delta is litres x the ticket gravity');
        assert.strictEqual(n(r.actual_delta_kg), FOB_AFTER - FOB_BEFORE,
            'actual delta is the DELIVERY gauge pair, not any ticket figure');
        out(`ticket says ${n(r.expected_delta_kg)} kg, gauge saw ${n(r.actual_delta_kg)} kg ` +
            `- a ${(n(r.expected_delta_kg) - n(r.actual_delta_kg)).toFixed(1)} kg discrepancy, visible`);
    });

    it('EXIT-4 - the virtuals reach OData on the active entity and the draft', async () => {
        await seed();
        const COLS = ['flight_date_v', 'sector', 'dispatch_kg', 'fqis_out_kg', 'fqis_in_kg',
                      'uplift_l', 'specific_gravity', 'expected_delta_kg', 'actual_delta_kg',
                      'uplift_value_usd', 'block_burn_kg', 'block_burn_value_usd', 'apu_hours',
                      'apu_rate_kg_hr', 'apu_burn_sum_kg', 'apu_burn_value_usd',
                      'engine_burn_split_kg', 'engine_burn_value_usd', 'map_usd_per_kg',
                      'arrival_rob_kg'];

        const active = await test.GET(`${B}/FuelBurns(ID=${burnId},IsActiveEntity=true)`);
        assert.strictEqual(active.status, 200);
        const missing = COLS.filter(c => !(c in active.data));
        assert.strictEqual(missing.length, 0,
            `ABSENT from the active payload (Fiori cannot drill into these): ${missing.join(', ')}`);

        await test.POST(`${B}/FuelBurns(ID=${burnId},IsActiveEntity=true)/BurnService.draftEdit`, {});
        const draft = await test.GET(`${B}/FuelBurns(ID=${burnId},IsActiveEntity=false)`);
        assert.strictEqual(draft.status, 200);
        const missingDraft = COLS.filter(c => !(c in draft.data));
        assert.strictEqual(missingDraft.length, 0,
            `ABSENT from the DRAFT payload: ${missingDraft.join(', ')}`);
        assert.strictEqual(n(draft.data.block_burn_kg), SPEC.block_burn_kg,
            'the draft must carry the same derived figure, not a null');
        out(`all ${COLS.length} columns present over OData, active and draft`);
    });

    it('EXIT-5 - a narrow $select still populates the row', async () => {
        await seed();

        // EXACTLY what the list report asks for: the displayed columns and
        // nothing else. flight_ID is absent, and the first version of this
        // derivation read it straight off the payload - so every flight-keyed
        // lookup missed and the whole report rendered blank in production.
        const sel = ['ID', 'tail_number', 'flight_date_v', 'sector', 'dispatch_kg',
                     'fqis_out_kg', 'fqis_in_kg', 'block_burn_kg', 'block_burn_value_usd',
                     'apu_burn_sum_kg', 'engine_burn_split_kg', 'map_usd_per_kg'].join(',');
        const res = await test.GET(`${B}/FuelBurns?$select=${sel}&$filter=ID eq ${burnId}`);
        assert.strictEqual(res.status, 200);
        const r = res.data.value[0];
        assert.ok(r, 'the row must come back');

        assert.strictEqual(String(r.flight_date_v).slice(0, 10), SPEC.date,
            'flight date fell back to burn_date - the flight lookup missed under $select');
        assert.strictEqual(r.sector, SPEC.sector, 'sector blank under $select');
        assert.strictEqual(n(r.fqis_out_kg), SPEC.fqis_out_kg, 'FQIS blank under $select');
        assert.strictEqual(n(r.block_burn_kg), SPEC.block_burn_kg, 'block burn blank under $select');
        assert.strictEqual(n(r.block_burn_value_usd), SPEC.block_burn_value_usd,
            'block burn value blank under $select');
        out(`narrow $select (${sel.split(',').length} columns, no flight_ID): row fully populated`);
    });

    it('EXIT-6 - nothing captured reads blank, not zero', async () => {
        await seed({ captured: false });
        const r = await summarise();

        for (const key of ['dispatch_kg', 'fqis_out_kg', 'fqis_in_kg', 'uplift_l',
                           'specific_gravity', 'expected_delta_kg', 'actual_delta_kg',
                           'uplift_value_usd', 'apu_hours', 'apu_rate_kg_hr',
                           'apu_burn_sum_kg', 'map_usd_per_kg', 'arrival_rob_kg']) {
            assert.strictEqual(r[key], null, `${key} must be blank, got ${r[key]}`);
        }
        assert.strictEqual(n(r.block_burn_kg), SPEC.block_burn_kg,
            'block burn falls back to actual_burn_kg when the gauges are missing');
        assert.strictEqual(r.block_burn_value_usd, null, 'with no MAP there is no value');
        out('uncaptured leg: blanks throughout, block burn from actual_burn_kg, no invented zeros');
    });

    it('EXIT-7 - two tickets sum, and gravity blends by volume', async () => {
        await seed({ tickets: 2 });
        const r = await summarise();

        assert.strictEqual(n(r.uplift_l), SPEC.uplift_l, 'litres must sum across the split');
        assert.strictEqual(n(r.uplift_value_usd), SPEC.uplift_value_usd, 'value must sum');

        // (2000 x 0.79 + 1262 x 0.8158) / 3262 = 0.7999..., NOT the 0.8029
        // a plain average of the two densities would give.
        const weighted = (2000 * 0.79 + 1262 * 0.8158) / 3262;
        assert.strictEqual(n(r.specific_gravity), Number(weighted.toFixed(4)),
            'gravity must be volume-weighted, not averaged and not the first ticket');
        const plainAverage = Number(((0.79 + 0.8158) / 2).toFixed(4));
        assert.notStrictEqual(n(r.specific_gravity), plainAverage,
            'instrument check: the weighting is indistinguishable from a plain average here');
        out(`split delivery: 2 tickets -> ${n(r.uplift_l)} L at blended SG ${n(r.specific_gravity)} ` +
            `(a plain average would say ${plainAverage})`);
    });
});

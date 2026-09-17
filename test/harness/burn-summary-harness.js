/**
 * THE FLIGHT-WISE SUMMARY - ONE ROW ASSEMBLED FROM FIVE ENTITIES.
 *
 * Report 2 of 6 prints one row per leg with twenty-three columns, and not one
 * of the interesting ones lives on FUEL_BURNS. The flight date and the gauge
 * pair are on FLIGHT_SCHEDULE, the dispatched block fuel on FLIGHT_DISPATCH,
 * the uplift on FUEL_TICKETS, the APU minutes on APU_USAGE, and the price the
 * whole consumption half is valued at on ROB_LEDGER. A report assembled from
 * five sources has five ways to be quietly wrong, which is what this is for.
 *
 * THE CRITERION IS THE SPECIMEN, not this code's own arithmetic. Every figure
 * below is transcribed from the AR1304 row of the demo pack. Where the
 * implementation and the specimen disagree, the specimen is right.
 *
 *   EXIT-1  AR1304 reproduces the specimen row EXACTLY, all twenty columns
 *   EXIT-2  the row ADDS UP: block less APU is engine, in mass and in money,
 *           and the three values are the three masses at one price
 *   EXIT-3  expected and actual delta are DIFFERENT numbers and both survive.
 *           Deriving gravity from mass/litres would make them identical and
 *           delete the discrepancy the report exists to show
 *   EXIT-4  the virtual properties are PRESENT over OData on the active entity
 *           AND on the draft. Absent on either is the infinite-spinner bug:
 *           Fiori cannot drill into a property the payload does not carry
 *   EXIT-5  a leg with nothing captured reads BLANK, not zero. Zero says
 *           "measured, and it was nothing"
 *   EXIT-6  two tickets on one leg SUM - the report is one row per flight, not
 *           one row per ticket
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
    apu_hours: 0.8, apu_rate_kg_hr: 110, apu_burn_kg: 88, apu_burn_value_usd: 100.65,
    engine_burn_split_kg: 2286, engine_burn_value_usd: 2614.73,
    map_usd_per_kg: 1.1438, arrival_rob_kg: 1402
};

let flightId, burnId;

async function seed({ tickets = 1, captured = true } = {}) {
    // Cleared first, and this is not housekeeping. Every case below seeds the
    // SAME tail, and the MAP lookup walks that tail's whole ledger - so a row
    // left behind by the previous case is read by the next one as a price that
    // legitimately prevails. EXIT-5 found exactly that: a leg with nothing
    // captured still reported a MAP, because an earlier test had left one.
    for (const e of ['fuelsphere.ROB_LEDGER', 'fuelsphere.APU_USAGE', 'fuelsphere.FUEL_BURNS']) {
        await cds.db.run(DELETE.from(e).where({ tail_number: SPEC.tail }));
    }
    await cds.db.run(DELETE.from('fuelsphere.FUEL_TICKETS').where({ aircraft_reg: SPEC.tail }));
    await cds.db.run(DELETE.from('fuelsphere.FLIGHT_DISPATCH').where({ flight_number: SPEC.flight }));
    await cds.db.run(DELETE.from('fuelsphere.FLIGHT_SCHEDULE').where({ flight_number: SPEC.flight }));

    flightId = cds.utils.uuid();
    burnId = cds.utils.uuid();

    await cds.db.run(INSERT.into('fuelsphere.FLIGHT_SCHEDULE').entries({
        ID: flightId, flight_number: SPEC.flight, flight_date: SPEC.date,
        origin_airport: 'AEP', destination_airport: 'MDZ',
        fob_at_out_kg: captured ? SPEC.fqis_out_kg : null,
        fob_at_in_kg:  captured ? SPEC.fqis_in_kg  : null
    }));

    if (captured) {
        await cds.db.run(INSERT.into('fuelsphere.FLIGHT_DISPATCH').entries({
            ID: cds.utils.uuid(), dispatch_order_id: 'FO-AR1304',
            flight_number: SPEC.flight, flight_date: SPEC.date,
            flight_schedule_ID: flightId, block_fuel_kg: SPEC.dispatch_kg
        }));

        // One ticket, or the same uplift split across two suppliers - the
        // report prints one row per FLIGHT either way.
        const parts = tickets === 2
            ? [{ l: 2000, kg: 1592, amt: 1830.11 }, { l: 1262, kg: 1004, amt: 1154.62 }]
            : [{ l: SPEC.uplift_l, kg: SPEC.actual_delta_kg, amt: SPEC.uplift_value_usd }];
        for (const [i, p] of parts.entries()) {
            await cds.db.run(INSERT.into('fuelsphere.FUEL_TICKETS').entries({
                ID: cds.utils.uuid(), ticket_number: `T-AR1304-${i}`,
                flight_ID: flightId, aircraft_reg: SPEC.tail,
                uom_code: 'LTR', quantity: p.l, quantity_metered: p.l,
                quantity_kg: p.kg, density_value: SPEC.specific_gravity,
                total_amount: p.amt
            }));
        }

        await cds.db.run(INSERT.into('fuelsphere.APU_USAGE').entries({
            ID: cds.utils.uuid(), tail_number: SPEC.tail,
            apu_start_utc: `${SPEC.date}T09:00:00Z`, apu_stop_utc: `${SPEC.date}T09:48:00Z`,
            usage_phase: 'TURNAROUND', apu_source: 'CALCULATED',
            running_minutes: 48, burn_rate_kg_hr: SPEC.apu_rate_kg_hr,
            apu_burn_kg: SPEC.apu_burn_kg, allocated_flight_ID: flightId
        }));

        await cds.db.run(INSERT.into('fuelsphere.ROB_LEDGER').entries({
            ID: cds.utils.uuid(), tail_number: SPEC.tail, record_date: SPEC.date,
            record_time: '10:00:00', sequence: 1, line_order: 1, entry_type: 'UPLIFT',
            opening_rob_kg: 1180, uplift_kg: SPEC.actual_delta_kg, burn_kg: 0,
            adjustment_kg: 0, closing_rob_kg: SPEC.fqis_out_kg,
            map_usd_per_kg: SPEC.map_usd_per_kg, balance_value_usd: 4318.99,
            data_source: 'TICKET', is_estimated: false
        }));
    }

    await cds.db.run(INSERT.into('fuelsphere.FUEL_BURNS').entries({
        ID: burnId, tail_number: SPEC.tail, flight_ID: flightId,
        burn_date: SPEC.date, actual_burn_kg: SPEC.block_burn_kg,
        apu_burn_kg: captured ? SPEC.apu_burn_kg : null,
        engine_burn_kg: captured ? SPEC.engine_burn_split_kg : null,
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

    it('EXIT-1 - AR1304 reproduces the specimen row', async () => {
        await seed();
        const r = await summarise();

        assert.strictEqual(String(r.flight_date_v).slice(0, 10), SPEC.date, 'flight date');
        assert.strictEqual(r.sector, SPEC.sector, 'sector');
        for (const key of ['dispatch_kg', 'fqis_out_kg', 'fqis_in_kg', 'uplift_l',
                           'specific_gravity', 'expected_delta_kg', 'actual_delta_kg',
                           'uplift_value_usd', 'block_burn_kg', 'block_burn_value_usd',
                           'apu_hours', 'apu_rate_kg_hr', 'apu_burn_value_usd',
                           'engine_burn_split_kg', 'engine_burn_value_usd',
                           'map_usd_per_kg', 'arrival_rob_kg']) {
            assert.strictEqual(n(r[key]), SPEC[key], `${key}: expected ${SPEC[key]}, got ${r[key]}`);
        }
        out(`AR1304: block ${n(r.block_burn_kg)} kg = ${n(r.block_burn_value_usd)} USD ` +
            `at MAP ${n(r.map_usd_per_kg)}; engine ${n(r.engine_burn_split_kg)}, APU ${n(r.apu_burn_kg)}`);
    });

    it('EXIT-2 - the row adds up, in mass and in money', async () => {
        await seed();
        const r = await summarise();

        assert.strictEqual(n(r.block_burn_kg) - n(r.apu_burn_kg), n(r.engine_burn_split_kg),
            'block - APU must equal engine, in kilograms');
        assert.ok(Math.abs(n(r.block_burn_value_usd) - n(r.apu_burn_value_usd) - n(r.engine_burn_value_usd)) < 0.01,
            'block - APU must equal engine, in dollars');
        // Every movement priced at the one MAP.
        for (const [kgKey, usdKey] of [['block_burn_kg', 'block_burn_value_usd'],
                                       ['apu_burn_kg', 'apu_burn_value_usd'],
                                       ['engine_burn_split_kg', 'engine_burn_value_usd']]) {
            const implied = n(r[usdKey]) / n(r[kgKey]);
            assert.ok(Math.abs(implied - n(r.map_usd_per_kg)) < 0.0005,
                `${usdKey} is not ${kgKey} at the MAP (implied ${implied.toFixed(4)})`);
        }
        // And the block burn is the gauge pair, not a copy of actual_burn_kg.
        assert.strictEqual(n(r.block_burn_kg), n(r.fqis_out_kg) - n(r.fqis_in_kg),
            'block burn is FQIS out - FQIS in');
        out(`adds up: ${n(r.block_burn_kg)} - ${n(r.apu_burn_kg)} = ${n(r.engine_burn_split_kg)} kg, ` +
            `${n(r.block_burn_value_usd)} - ${n(r.apu_burn_value_usd)} = ${n(r.engine_burn_value_usd)} USD`);
    });

    it('EXIT-3 - expected and actual delta stay different numbers', async () => {
        await seed();
        const r = await summarise();

        assert.notStrictEqual(n(r.expected_delta_kg), n(r.actual_delta_kg),
            'the two delta columns collapsed to one number - gravity was derived, not read');
        // Rounded on both sides: 3262 x 0.8 is 2609.6000000000004 in binary
        // floating point, and the stored column is Decimal(12,2).
        assert.strictEqual(n(r.expected_delta_kg),
            Number((n(r.uplift_l) * n(r.specific_gravity)).toFixed(2)),
            'expected delta is litres x the TICKET gravity');
        out(`expected ${n(r.expected_delta_kg)} kg vs actual ${n(r.actual_delta_kg)} kg ` +
            `- a ${(n(r.expected_delta_kg) - n(r.actual_delta_kg)).toFixed(1)} kg discrepancy, visible`);
    });

    it('EXIT-4 - the virtuals reach OData on the active entity and the draft', async () => {
        await seed();
        const COLS = ['flight_date_v', 'sector', 'dispatch_kg', 'fqis_out_kg', 'fqis_in_kg',
                      'uplift_l', 'specific_gravity', 'expected_delta_kg', 'actual_delta_kg',
                      'uplift_value_usd', 'block_burn_kg', 'block_burn_value_usd', 'apu_hours',
                      'apu_rate_kg_hr', 'apu_burn_value_usd', 'engine_burn_split_kg',
                      'engine_burn_value_usd', 'map_usd_per_kg', 'arrival_rob_kg'];

        const active = await test.GET(`${B}/FuelBurns(ID=${burnId},IsActiveEntity=true)`);
        assert.strictEqual(active.status, 200);
        const missing = COLS.filter(c => !(c in active.data));
        assert.strictEqual(missing.length, 0,
            `ABSENT from the active payload (Fiori cannot drill into these): ${missing.join(', ')}`);
        assert.strictEqual(n(active.data.block_burn_kg), SPEC.block_burn_kg, 'value survives OData');

        // The draft. This is the registration that was missed on three other
        // services this release and produced a page that span forever.
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

    it('EXIT-5 - nothing captured reads blank, not zero', async () => {
        await seed({ captured: false });
        const r = await summarise();

        for (const key of ['dispatch_kg', 'fqis_out_kg', 'fqis_in_kg', 'uplift_l',
                           'specific_gravity', 'expected_delta_kg', 'actual_delta_kg',
                           'uplift_value_usd', 'apu_hours', 'apu_rate_kg_hr',
                           'map_usd_per_kg', 'arrival_rob_kg']) {
            assert.strictEqual(r[key], null, `${key} must be blank, got ${r[key]}`);
        }
        // Block burn still falls back to the stored figure - that one IS known.
        assert.strictEqual(n(r.block_burn_kg), SPEC.block_burn_kg,
            'block burn falls back to actual_burn_kg when the gauges are missing');
        assert.strictEqual(r.block_burn_value_usd, null, 'with no MAP there is no value');
        out('uncaptured leg: blanks throughout, block burn from actual_burn_kg, no invented zeros');
    });

    it('EXIT-6 - two tickets on one leg sum into one row', async () => {
        await seed({ tickets: 2 });
        const r = await summarise();

        assert.strictEqual(n(r.uplift_l), SPEC.uplift_l, 'litres must sum across the split');
        assert.strictEqual(n(r.actual_delta_kg), SPEC.actual_delta_kg, 'mass must sum');
        assert.strictEqual(n(r.uplift_value_usd), SPEC.uplift_value_usd, 'value must sum');
        assert.strictEqual(n(r.specific_gravity), SPEC.specific_gravity,
            'gravity is a property of the fuel, not a sum');
        out(`split delivery: 2 tickets -> ${n(r.uplift_l)} L, ${n(r.actual_delta_kg)} kg, ` +
            `${n(r.uplift_value_usd)} USD in one row`);
    });
});

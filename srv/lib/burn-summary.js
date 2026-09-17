/**
 * FuelSphere - the Flight-Wise Summary columns on the Fuel Burns list.
 *
 * ONE ROW PER FLIGHT, ASSEMBLED FROM FIVE ENTITIES. The report prints as two
 * tables only because it does not fit the page; it is one row per leg, and
 * every column on it comes from somewhere else:
 *
 *   FLIGHT_SCHEDULE   flight date, sector, the FQIS pair (OUT and IN)
 *   FLIGHT_DISPATCH   the dispatched block fuel
 *   FUEL_TICKETS      uplift litres, specific gravity, mass, value
 *   APU_USAGE         running minutes and the rate they were costed at
 *   ROB_LEDGER        the moving average price the consumption is valued at
 *
 * THE ARITHMETIC, as the specimen and the dispatcher's worksheet both state it:
 *
 *   block burn      = FQIS out - FQIS in          3,776 - 1,402 = 2,374
 *   APU burn        = APU hours x rate kg/h       0.80 x 110     =    88
 *   engine burn     = block burn - APU burn       2,374 - 88     = 2,286
 *   expected delta  = uplift litres x gravity     3,262 x 0.800  = 2,610
 *   actual delta    = the ticket's measured mass                 = 2,596
 *   <movement> value = <movement> kg x MAP        2,374 x 1.1438 = 2,715.38
 *
 * EXPECTED AND ACTUAL DELTA ARE BOTH KEPT, and the gap between them is the
 * reason the report exists. Expected is what the uplift SHOULD have massed at
 * the ticket's gravity; actual is what the aircraft's gauges say arrived, and
 * only the actual figure enters the fuel ledger. Collapsing them to one column
 * would delete the discrepancy the reader is looking for.
 *
 * ENGINE BURN IS DERIVED HERE, NOT READ FROM FUEL_BURNS.engine_burn_kg. The
 * stored column is actual_burn_kg - apu_burn_kg; this one is the FQIS delta
 * less the same APU figure. They agree whenever actual_burn_kg agrees with the
 * gauges, and where they do not, the row on screen still adds up - block less
 * APU is exactly engine, every time, which is the property a reader checks
 * first. The stored column keeps its own meaning on the object page.
 *
 * BATCHED, NOT PER ROW. Five queries for a page of any size: a list report asks
 * for thirty rows at a time and a per-row lookup would be a hundred and fifty
 * round trips to paint one screen.
 */

const cds = require('@sap/cds');
const { SELECT } = cds.ql;
const { toLitres } = require('./fuel-uom');

const FLIGHTS   = 'fuelsphere.FLIGHT_SCHEDULE';
const DISPATCH  = 'fuelsphere.FLIGHT_DISPATCH';
const TICKETS   = 'fuelsphere.FUEL_TICKETS';
const APU       = 'fuelsphere.APU_USAGE';
const LEDGER    = 'fuelsphere.ROB_LEDGER';

const num   = (v) => (v === null || v === undefined ? null : Number(v));
const money = (v) => (v === null ? null : Number(Number(v).toFixed(2)));
const mass  = (v) => (v === null ? null : Number(Number(v).toFixed(2)));
const rate4 = (v) => (v === null ? null : Number(Number(v).toFixed(4)));

/** Sum that stays null when nothing contributed, rather than collapsing to 0. */
function total(rows, pick) {
    let sum = null;
    for (const r of rows) {
        const v = pick(r);
        if (v === null || v === undefined) continue;
        sum = (sum === null ? 0 : sum) + Number(v);
    }
    return sum;
}

/** Group an array into a Map keyed by one field, dropping rows with no key. */
function groupBy(rows, key) {
    const m = new Map();
    for (const r of rows) {
        const k = r[key];
        if (!k) continue;
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(r);
    }
    return m;
}

/**
 * Fill the Flight-Wise Summary columns on a page of Fuel Burn rows.
 *
 * Mutates in place, which is what an after-READ handler needs. Rows whose
 * sources are missing keep nulls: a blank cell says "not captured", and a zero
 * would say "measured, and it was nothing".
 *
 * @param {object|object[]} data  the rows the handler was given
 */
async function applyFlightSummary(data) {
    const rows = Array.isArray(data) ? data : [data];
    if (!rows.length) return;

    const flightIds = [...new Set(rows.map(r => r && r.flight_ID).filter(Boolean))];
    const tails     = [...new Set(rows.map(r => r && r.tail_number).filter(Boolean))];

    // ---- the five source reads ------------------------------------------
    const flights = flightIds.length ? await cds.db.run(SELECT.from(FLIGHTS)
        .columns('ID', 'flight_number', 'flight_date', 'origin_airport',
                 'destination_airport', 'fob_at_out_kg', 'fob_at_in_kg')
        .where({ ID: { in: flightIds } })) : [];
    const flightById = new Map(flights.map(f => [f.ID, f]));

    const dispatches = flightIds.length ? await cds.db.run(SELECT.from(DISPATCH)
        .columns('flight_schedule_ID', 'block_fuel_kg', 'dispatch_qty_kg')
        .where({ flight_schedule_ID: { in: flightIds } })) : [];
    const dispatchByFlight = groupBy(dispatches, 'flight_schedule_ID');

    const tickets = flightIds.length ? await cds.db.run(SELECT.from(TICKETS)
        .columns('flight_ID', 'quantity', 'quantity_metered', 'quantity_kg',
                 'uom_code', 'density_value', 'total_amount')
        .where({ flight_ID: { in: flightIds } })) : [];
    const ticketsByFlight = groupBy(tickets, 'flight_ID');

    // Keyed on the ALLOCATED flight - the cycle's own flight_ID may be absent
    // (an overnight cycle carries none) and allocation is what decides which
    // leg bears the cost.
    const apuCycles = flightIds.length ? await cds.db.run(SELECT.from(APU)
        .columns('allocated_flight_ID', 'running_minutes', 'burn_rate_kg_hr')
        .where({ allocated_flight_ID: { in: flightIds } })) : [];
    const apuByFlight = groupBy(apuCycles, 'allocated_flight_ID');

    // The whole ledger for the tails on this page, so the MAP lookup below is
    // a scan of an array rather than a query per row.
    const ledger = tails.length ? await cds.db.run(SELECT.from(LEDGER)
        .columns('tail_number', 'record_date', 'line_order', 'record_time',
                 'sequence', 'map_usd_per_kg')
        .where({ tail_number: { in: tails } })
        .orderBy('record_date', 'line_order', 'record_time', 'sequence')) : [];
    const ledgerByTail = groupBy(ledger, 'tail_number');

    /** The MAP prevailing on a tail at the end of a given flight date. */
    const mapAt = (tail, onDate) => {
        const hist = ledgerByTail.get(tail);
        if (!hist || !onDate) return null;
        let found = null;
        for (const r of hist) {
            if (String(r.record_date).slice(0, 10) > String(onDate).slice(0, 10)) break;
            if (r.map_usd_per_kg !== null && r.map_usd_per_kg !== undefined) found = num(r.map_usd_per_kg);
        }
        return found;
    };

    // ---- assemble ---------------------------------------------------------
    for (const row of rows) {
        if (!row) continue;
        const f = row.flight_ID ? flightById.get(row.flight_ID) : null;

        // Flight date and sector. Taken from the SCHEDULE where there is one,
        // because that is the operational record; the burn's own burn_date is
        // when the record was written and can differ for a late capture.
        row.flight_date_v = f ? f.flight_date : (row.burn_date || null);
        row.sector = f && f.origin_airport && f.destination_airport
            ? `${f.origin_airport} - ${f.destination_airport}` : null;

        // FQIS. The gauge at chocks-off and chocks-on: everything in the
        // consumption half of the report is the gap between these two.
        const fqisOut = f ? num(f.fob_at_out_kg) : null;
        const fqisIn  = f ? num(f.fob_at_in_kg)  : null;
        row.fqis_out_kg = fqisOut;
        row.fqis_in_kg  = fqisIn;
        // The same number as FQIS in, named for what the reader wants from it.
        row.arrival_rob_kg = fqisIn;

        // Dispatched block fuel. block_fuel_kg is the figure derived from the
        // seven regulated components; dispatch_qty_kg is the dispatcher's
        // confirmed number and stands in where the stack was never captured.
        const disp = dispatchByFlight.get(row.flight_ID) || [];
        row.dispatch_kg = mass(total(disp, d => num(d.block_fuel_kg)))
            ?? mass(total(disp, d => num(d.dispatch_qty_kg)));

        // The uplift, from the tickets against this leg. Summed: a leg can be
        // fuelled by two suppliers and the report prints one row per flight.
        const tks = ticketsByFlight.get(row.flight_ID) || [];
        const litres = total(tks, t => toLitres(t.quantity_metered ?? t.quantity, t.uom_code));
        row.uplift_l = mass(litres);
        row.actual_delta_kg = mass(total(tks, t => num(t.quantity_kg)));
        row.uplift_value_usd = money(total(tks, t => num(t.total_amount)));

        // The TICKET's gravity, not mass divided by litres. Dividing would
        // define expected delta as equal to actual delta and the comparison
        // the two columns exist for would read zero on every row.
        const gravity = tks.map(t => num(t.density_value)).find(v => v !== null && v !== undefined);
        row.specific_gravity = gravity === undefined ? null : rate4(gravity);
        row.expected_delta_kg = (litres !== null && row.specific_gravity !== null)
            ? mass(litres * row.specific_gravity) : null;

        // Consumption. FQIS-derived where both readings exist; actual_burn_kg
        // is the fallback and is documented as being the block burn.
        const block = (fqisOut !== null && fqisIn !== null)
            ? mass(fqisOut - fqisIn) : num(row.actual_burn_kg);
        row.block_burn_kg = block;

        const apuKg = num(row.apu_burn_kg);
        const cycles = apuByFlight.get(row.flight_ID) || [];
        const minutes = total(cycles, c => num(c.running_minutes));
        row.apu_hours = minutes === null ? null : Number((minutes / 60).toFixed(2));
        const cycleRate = cycles.map(c => num(c.burn_rate_kg_hr)).find(v => v !== null && v !== undefined);
        row.apu_rate_kg_hr = cycleRate === undefined ? null : mass(cycleRate);

        // Guaranteed to add up on screen - see the header note.
        row.engine_burn_split_kg = (block !== null && apuKg !== null)
            ? mass(block - apuKg) : (block !== null ? block : null);

        // Valuation. Every movement on the row is costed at the one price the
        // tail's stock stood at, so the three values sum the way the masses do.
        const map = mapAt(row.tail_number, row.flight_date_v);
        row.map_usd_per_kg = map;
        const at = (kgv) => (map === null || kgv === null ? null : money(kgv * map));
        row.block_burn_value_usd  = at(block);
        row.apu_burn_value_usd    = at(apuKg);
        row.engine_burn_value_usd = at(row.engine_burn_split_kg);
    }
}

module.exports = { applyFlightSummary };

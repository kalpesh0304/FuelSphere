/**
 * FuelSphere - the Flight-Wise Summary columns on the Fuel Burns list.
 *
 * ONE ROW PER FLIGHT, ASSEMBLED FROM SIX ENTITIES. The report prints as two
 * tables only because it does not fit the page; it is one row per leg, and
 * almost nothing on it lives on FUEL_BURNS.
 *
 * THE FIELD DERIVATION TABLE IS THE SPECIFICATION. Each mapping below cites
 * it, because several are NOT the obvious choice and the obvious choice is
 * wrong in a way that still produces a plausible number:
 *
 *   Dispatch kg     FLIGHT_DISPATCH.required_uplift_kg - NOT block_fuel_kg.
 *                   Block fuel is what the aircraft must depart with; the
 *                   report wants what dispatch asked to be PUT ON.
 *   Sp. gravity     VOLUME-WEIGHTED across the tickets, not the first one's
 *                   density. Two suppliers at different densities give a
 *                   blend, and the first ticket's figure is just one of them.
 *   Actual delta    FUEL_DELIVERIES fob_after - fob_before. THE GAUGE, not
 *                   the ticket. Expected delta is what the ticket says and
 *                   actual is what the aircraft saw - taking both from the
 *                   tickets would make them equal by construction and delete
 *                   the discrepancy the pair exists to show.
 *   APU rate        AIRCRAFT_REGISTRATIONS.apu_burn_rate_kg_hr - the tail's
 *                   rate, not the rate stamped on a cycle.
 *   APU burn kg     SUM OF THE APU_USAGE CYCLES, not FUEL_BURNS.apu_burn_kg.
 *                   The stored column is meant to be that sum, and in the
 *                   current data it is 0.00 while the cycles are populated.
 *
 * HELD - PENDING SHAILESH. The five APU and engine figures are NOT signed
 * off. The report subtracts APU from block burn, but block burn is gauge-out
 * less gauge-in and holds only what burned inside that window; APU fuel
 * burned before pushback is not in it, so subtracting understates the engine
 * burn. They are computed here so the screen is populated and the question
 * can be argued against real numbers - they are not settled.
 *
 * WHY THE BASE COLUMNS ARE RE-READ, and this is the whole reason the first
 * version showed a page of blanks: an after-READ handler receives only the
 * columns the CLIENT selected. Fiori issues $select for the LineItem columns
 * and nothing else, so flight_ID - which no column displays - arrived
 * undefined, every flight-keyed lookup missed, and the report silently fell
 * back to burn_date and nulls. A derivation must never depend on a column
 * happening to be in someone's $select.
 *
 * BATCHED, NOT PER ROW. A fixed number of queries for a page of any size.
 */

const cds = require('@sap/cds');
const { SELECT } = cds.ql;
const { toLitres } = require('./fuel-uom');

const BURNS      = 'fuelsphere.FUEL_BURNS';
const FLIGHTS    = 'fuelsphere.FLIGHT_SCHEDULE';
const DISPATCH   = 'fuelsphere.FLIGHT_DISPATCH';
const TICKETS    = 'fuelsphere.FUEL_TICKETS';
const DELIVERIES = 'fuelsphere.FUEL_DELIVERIES';
const APU        = 'fuelsphere.APU_USAGE';
const LEDGER     = 'fuelsphere.ROB_LEDGER';
const REGS       = 'fuelsphere.AIRCRAFT_REGISTRATIONS';

/** The base columns the derivation needs, whatever the client asked for. */
const BASE = ['flight_ID', 'tail_number', 'burn_date', 'actual_burn_kg'];

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
    const all = Array.isArray(data) ? data : [data];
    const rows = all.filter(r => r && r.ID);
    if (!rows.length) return;

    // ---- resolve the base columns, whatever the client selected ----------
    // Kept OUT of the rows themselves: writing flight_ID onto a payload that
    // did not ask for it would return a property the client never requested.
    const resolved = new Map(rows.map(r => [r.ID, Object.fromEntries(BASE.map(k => [k, r[k]]))]));
    const gaps = rows.filter(r => BASE.some(k => r[k] === undefined));
    if (gaps.length) {
        const stored = await cds.db.run(SELECT.from(BURNS)
            .columns('ID', ...BASE)
            .where({ ID: { in: gaps.map(r => r.ID) } }));
        for (const s of stored) {
            const into = resolved.get(s.ID);
            // Only the gaps: a draft carries edits the active row has not seen.
            if (into) for (const k of BASE) if (into[k] === undefined) into[k] = s[k];
        }
    }
    const of = (row) => resolved.get(row.ID) || {};

    const flightIds = [...new Set(rows.map(r => of(r).flight_ID).filter(Boolean))];
    const tails     = [...new Set(rows.map(r => of(r).tail_number).filter(Boolean))];

    // ---- the source reads -------------------------------------------------
    const flights = flightIds.length ? await cds.db.run(SELECT.from(FLIGHTS)
        .columns('ID', 'flight_number', 'flight_date', 'origin_airport',
                 'destination_airport', 'fob_at_out_kg', 'fob_at_in_kg')
        .where({ ID: { in: flightIds } })) : [];
    const flightById = new Map(flights.map(f => [f.ID, f]));

    // THE ACTIVE PLAN, NOT EVERY PLAN. A flight can carry several - 684 of
    // 2,457 rows are SUPERSEDED - and the previous read took them all, so a
    // revised flight had its dispatch quantity counted once per revision.
    // plan_status is what separates the plan in force from its history.
    const dispatches = flightIds.length ? await cds.db.run(SELECT.from(DISPATCH)
        .columns('flight_schedule_ID', 'required_uplift_kg', 'plan_status',
                 'trip_fuel_kg', 'taxi_fuel_kg')
        .where({ flight_schedule_ID: { in: flightIds } })) : [];
    const activePlans = dispatches.filter(d => d.plan_status === 'ACTIVE');
    const dispatchByFlight = groupBy(activePlans, 'flight_schedule_ID');

    // TICKETS REACH A FLIGHT TWO WAYS, and the second is not redundant. The
    // association is the intended link, but it was added late and the tickets
    // already in the system carry only a flight_number string - so on existing
    // data the association route finds nothing at all. The fallback matches on
    // flight_number + flight_date, which is the SAME key FLIGHT_DISPATCH is
    // documented as matching FLIGHT_SCHEDULE on, so it is the system's own
    // convention rather than a new one invented here.
    //
    // The date is part of the key deliberately: a flight number alone repeats
    // every day, and matching on it would attach Tuesday's uplift to Monday's
    // leg. A ticket captured on a different date than the flight simply does
    // not match, and its columns stay blank - which is the honest outcome.
    const TKT_COLS = ['flight_ID', 'flight_number', 'delivery_ID', 'quantity',
                      'quantity_metered', 'uom_code', 'density_value',
                      'total_amount', 'delivery_timestamp'];
    const byFlightId = flightIds.length ? await cds.db.run(SELECT.from(TICKETS)
        .columns(...TKT_COLS).where({ flight_ID: { in: flightIds } })) : [];

    const numbers = [...new Set(flights.map(f => f.flight_number).filter(Boolean))];
    const byNumber = numbers.length ? await cds.db.run(SELECT.from(TICKETS)
        .columns(...TKT_COLS)
        .where({ flight_number: { in: numbers }, flight_ID: null })) : [];

    const ticketsByFlight = groupBy(byFlightId, 'flight_ID');
    for (const t of byNumber) {
        const day = t.delivery_timestamp ? String(t.delivery_timestamp).slice(0, 10) : null;
        for (const f of flights) {
            if (f.flight_number !== t.flight_number) continue;
            if (day && day !== String(f.flight_date).slice(0, 10)) continue;
            if (!ticketsByFlight.has(f.ID)) ticketsByFlight.set(f.ID, []);
            ticketsByFlight.get(f.ID).push(t);
        }
    }
    const tickets = [...byFlightId, ...byNumber];

    // The gauge readings. Reached two ways because a delivery can carry the
    // flight directly OR be linked only through the tickets written against
    // it - seed data predates the delivery's flight association, so the
    // ticket route is the one that resolves on existing records.
    // Two queries rather than one OR: CDS QL has no object form for a
    // disjunction, and a raw expression here would be the only untyped
    // fragment in the file for no gain at this size.
    const DEL_COLS = ['ID', 'flight_ID', 'fob_before_kg', 'fob_after_kg', 'fob_delta_kg'];
    const deliveryIds = [...new Set(tickets.map(t => t.delivery_ID).filter(Boolean))];
    const byFlight = flightIds.length ? await cds.db.run(SELECT.from(DELIVERIES)
        .columns(...DEL_COLS).where({ flight_ID: { in: flightIds } })) : [];
    const byId = deliveryIds.length ? await cds.db.run(SELECT.from(DELIVERIES)
        .columns(...DEL_COLS).where({ ID: { in: deliveryIds } })) : [];
    const deliveries = [...new Map([...byFlight, ...byId].map(d => [d.ID, d])).values()];
    const deliveryById = new Map(deliveries.map(d => [d.ID, d]));
    const deliveriesByFlight = groupBy(deliveries, 'flight_ID');

    // Keyed on the ALLOCATED flight - a cycle's own flight_ID may be absent
    // (an overnight cycle carries none) and allocation decides which leg pays.
    const apuCycles = flightIds.length ? await cds.db.run(SELECT.from(APU)
        .columns('allocated_flight_ID', 'running_minutes', 'apu_burn_kg')
        .where({ allocated_flight_ID: { in: flightIds } })) : [];
    const apuByFlight = groupBy(apuCycles, 'allocated_flight_ID');

    // The tail's APU rate, per the derivation table - a property of the
    // aircraft, not of any one cycle.
    const regs = tails.length ? await cds.db.run(SELECT.from(REGS)
        .columns('registration', 'apu_burn_rate_kg_hr')
        .where({ registration: { in: tails } })) : [];
    const rateByTail = new Map(regs.map(r => [r.registration, num(r.apu_burn_rate_kg_hr)]));

    const ledger = tails.length ? await cds.db.run(SELECT.from(LEDGER)
        .columns('tail_number', 'record_date', 'line_order', 'record_time',
                 'sequence', 'map_usd_per_kg', 'flight_ID', 'entry_type',
                 'unallocated_fuel_kg')
        .where({ tail_number: { in: tails } })
        .orderBy('record_date', 'line_order', 'record_time', 'sequence')) : [];
    const ledgerByTail = groupBy(ledger, 'tail_number');

    // THE LEDGER'S OWN FIGURE, per flight. Taken from the block-burn line,
    // which is where rob-recalculate.js writes it: that line is the point in
    // the replay where the running balance can first be set against the
    // arrival gauge. Reading it rather than recomputing it is what keeps this
    // report and the FOB ledger from showing two different numbers.
    const unallocByFlight = new Map();
    for (const r of ledger) {
        if (!r.flight_ID || r.entry_type !== 'BURN') continue;
        if (r.unallocated_fuel_kg === null || r.unallocated_fuel_kg === undefined) continue;
        unallocByFlight.set(r.flight_ID, num(r.unallocated_fuel_kg));
    }

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
        const base = of(row);
        const f = base.flight_ID ? flightById.get(base.flight_ID) : null;

        // Flight date and sector come from the SCHEDULE. burn_date is when the
        // record was written and drifts from the flight on a late capture.
        row.flight_date_v = f ? f.flight_date : (base.burn_date || null);
        row.sector = f && f.origin_airport && f.destination_airport
            ? `${f.origin_airport} - ${f.destination_airport}` : null;
        row.departure_airport_v = f ? f.origin_airport || null : null;
        row.arrival_airport_v   = f ? f.destination_airport || null : null;

        const fqisOut = f ? num(f.fob_at_out_kg) : null;
        const fqisIn  = f ? num(f.fob_at_in_kg)  : null;
        row.fqis_out_kg = fqisOut;
        row.fqis_in_kg  = fqisIn;
        row.arrival_rob_kg = fqisIn;   // the same number, named for its use

        const unalloc = base.flight_ID ? unallocByFlight.get(base.flight_ID) : undefined;
        row.unallocated_fuel_kg = (unalloc === undefined) ? null : mass(unalloc);

        const disp = dispatchByFlight.get(base.flight_ID) || [];
        row.dispatch_kg = mass(total(disp, d => num(d.required_uplift_kg)));

        // ---- PLANNED BLOCK BURN: trip fuel plus taxi fuel ----------------
        //
        // What the operational flight plan allowed for chocks-to-chocks. Taxi
        // is INSIDE the block and outside the trip, so a planned figure that
        // omits it is not comparable with a block burn measured from the
        // gauges - which is the whole point of the comparison below.
        //
        // NULL, NOT ZERO, where no active plan exists. Zero would assert the
        // flight was planned to burn nothing.
        const trip = total(disp, d => num(d.trip_fuel_kg));
        const taxi = total(disp, d => num(d.taxi_fuel_kg));
        const plannedBlock = (trip === null && taxi === null)
            ? null : mass((trip || 0) + (taxi || 0));
        row.planned_block_burn_kg = plannedBlock;

        // ---- the uplift, from the tickets against this leg ----------------
        const tks = ticketsByFlight.get(base.flight_ID) || [];
        const perTicket = tks.map(t => ({
            l: toLitres(t.quantity_metered ?? t.quantity, t.uom_code),
            sg: num(t.density_value),
            amt: num(t.total_amount)
        }));
        const litres = total(perTicket, t => t.l);
        row.uplift_l = mass(litres);
        row.uplift_value_usd = money(total(perTicket, t => t.amt));

        // Volume-weighted: sum(L x SG) / sum(L), over the tickets that carry
        // both. A simple average would let a 50-litre top-up pull the blend as
        // hard as a 3,000-litre uplift.
        const weighable = perTicket.filter(t => t.l !== null && t.sg !== null);
        const weightedL = total(weighable, t => t.l);
        row.specific_gravity = (weightedL && weightedL > 0)
            ? rate4(total(weighable, t => t.l * t.sg) / weightedL) : null;

        row.expected_delta_kg = (litres !== null && row.specific_gravity !== null)
            ? mass(litres * row.specific_gravity) : null;

        // ---- what the gauge saw -------------------------------------------
        const direct = deliveriesByFlight.get(base.flight_ID) || [];
        const viaTickets = [...new Set(tks.map(t => t.delivery_ID).filter(Boolean))]
            .map(id => deliveryById.get(id)).filter(Boolean);
        const dels = [...new Map([...direct, ...viaTickets].map(d => [d.ID, d])).values()];
        row.actual_delta_kg = mass(total(dels, d => {
            const delta = num(d.fob_delta_kg);
            if (delta !== null) return delta;
            const a = num(d.fob_after_kg), b = num(d.fob_before_kg);
            return (a !== null && b !== null) ? a - b : null;
        }));

        // ---- consumption ---------------------------------------------------
        // FQIS-derived where both readings exist; actual_burn_kg is the
        // documented fallback and is itself the block burn.
        const block = (fqisOut !== null && fqisIn !== null)
            ? mass(fqisOut - fqisIn) : num(base.actual_burn_kg);
        row.block_burn_kg = block;

        const cycles = apuByFlight.get(base.flight_ID) || [];
        const minutes = total(cycles, c => num(c.running_minutes));
        row.apu_hours = minutes === null ? null : Number((minutes / 60).toFixed(2));
        row.apu_rate_kg_hr = mass(rateByTail.has(base.tail_number)
            ? rateByTail.get(base.tail_number) : null);
        const apuKg = mass(total(cycles, c => num(c.apu_burn_kg)));
        row.apu_burn_sum_kg = apuKg;

        // ---- THE VARIANCE, AGAINST THE PLAN --------------------------------
        //
        // Actual block burn less planned block burn: positive means the leg
        // burned MORE than the plan allowed. Both sides are block figures, so
        // the subtraction compares like with like - the reason the planned
        // side had to gain taxi fuel.
        //
        // THE 5% BAND IS THE ONE ALREADY IN USE, read off the seeded rows
        // rather than invented: every NORMAL row sits at or under 5.00% and
        // every EXCEEDED row above it. Recomputing the status from the new
        // basis keeps the word and the number telling the same story.
        if (plannedBlock !== null && plannedBlock !== 0 && block !== null) {
            row.block_burn_variance_kg = mass(block - plannedBlock);
            const pct = ((block - plannedBlock) / plannedBlock) * 100;
            row.block_burn_variance_pct = Number(pct.toFixed(2));
            row.block_burn_variance_status = Math.abs(pct) <= 5 ? 'NORMAL' : 'EXCEEDED';
        } else {
            row.block_burn_variance_kg = null;
            row.block_burn_variance_pct = null;
            row.block_burn_variance_status = null;
        }

        // BLOCK PLUS APU, the fuel this leg and its turnaround consumed. The
        // APU burn is additional to the block burn, not inside it (confirmed
        // 2 Oct 2026), so these add rather than overlap.
        row.total_burn_kg = (block !== null || apuKg !== null)
            ? mass((block || 0) + (apuKg || 0)) : null;

        // HELD - see the header. Block less APU may understate the engine burn.
        row.engine_burn_split_kg = (block !== null && apuKg !== null)
            ? mass(block - apuKg) : (block !== null ? block : null);

        // ---- valuation ------------------------------------------------------
        // Every movement at the one price the tail's stock stood at, so the
        // three values sum exactly the way the three masses do.
        const map = mapAt(base.tail_number, row.flight_date_v);
        row.map_usd_per_kg = map;
        const at = (kgv) => (map === null || kgv === null ? null : money(kgv * map));
        row.block_burn_value_usd  = at(block);
        row.apu_burn_value_usd    = at(apuKg);
        row.engine_burn_value_usd = at(row.engine_burn_split_kg);
        // Valued at the same price as its two parts, so the total is exactly
        // their sum rather than a separately rounded figure.
        row.total_burn_value_usd  = at(row.total_burn_kg);
    }
}

module.exports = { applyFlightSummary };

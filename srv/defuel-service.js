const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE } = cds.ql;

const LOG = cds.log('defuel');

const ROB        = 'fuelsphere.ROB_LEDGER';
const TICKETS    = 'fuelsphere.FUEL_TICKETS';
const TAILS      = 'fuelsphere.AIRCRAFT_REGISTRATIONS';
const AIRPORTS   = 'fuelsphere.MASTER_AIRPORTS';
const LOCATIONS  = 'fuelsphere.STORAGE_LOCATION';
const LEDGER     = 'fuelsphere.DEFUEL_LEDGER_ENTRY';
const SETTLEMENT = 'fuelsphere.DEFUEL_SETTLEMENT';
const DEFUEL     = 'fuelsphere.DEFUEL';

const num = v => (v === null || v === undefined || v === '') ? 0 : (Number(v) || 0);
const r2 = v => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const r3 = v => Math.round((num(v) + Number.EPSILON) * 1000) / 1000;

// Movements that take fuel OFF a tail. M4 puts it back on.
const OUTBOUND = new Set(['M1', 'M2', 'M3', 'M5']);

/**
 * Convert a local wall-clock time at a station to UTC, using the station's
 * named zone.
 *
 * A NAMED ZONE, NEVER A STORED OFFSET (BR R3.9). An offset is wrong for half
 * the year wherever daylight saving applies and permanently wherever a
 * country changes its rules; the zone resolves the rule in force ON THE EVENT
 * DATE, which is what a ledger replayed across a year requires.
 *
 * THE TWO HOURS A YEAR THAT DO NOT CONVERT CLEANLY are the reason this
 * returns a verdict rather than a value:
 *
 *   - clocks forward: a local time that NEVER EXISTED. Refused (DFL409),
 *     not quietly shifted — shifting invents a moment the ticket cannot have
 *     been written at.
 *   - clocks back: a local time that occurred TWICE. Resolved explicitly by
 *     the caller (DFL410 until it is), and the row records which reading was
 *     taken. An ambiguous sort still returns rows in SOME order, so silence
 *     here is a wrong answer rather than a missing one.
 */
function localToUtc(localIso, zone, fold) {
    const m = String(localIso).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (!m) return { error: 'unreadable' };
    const [, Y, Mo, D, H, Mi] = m.map(Number);

    // Offset of a given UTC instant at that zone, in minutes.
    const offsetAt = (utcMs) => {
        const d = new Date(utcMs);
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: zone, hour12: false,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).formatToParts(d).reduce((a, p) => (a[p.type] = p.value, a), {});
        const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day,
                               +parts.hour % 24, +parts.minute, +parts.second);
        return (asUtc - utcMs) / 60000;
    };

    const wall = Date.UTC(Y, Mo - 1, D, H, Mi);

    // CANDIDATES FROM BOTH SIDES OF THE TRANSITION, which is the whole
    // trick. Taking the offset AT the wall time and iterating from there
    // converges on one answer and reports every ambiguous hour as
    // unambiguous — 01:30 on the day the clocks go back resolved silently to
    // the first reading, which is precisely the failure R3.9 exists to stop.
    //
    // A day either side straddles any transition, so the two offsets are the
    // two that can apply. An hour that round-trips under both occurred
    // twice; one that round-trips under neither never occurred at all.
    const DAY = 86400000;
    const offsets = [...new Set([offsetAt(wall - DAY), offsetAt(wall + DAY)])];
    const candidates = [...new Set(offsets.map(o => wall - o * 60000))];

    const valid = candidates.filter(t => {
        const back = new Intl.DateTimeFormat('en-US', {
            timeZone: zone, hour12: false, hour: '2-digit', minute: '2-digit'
        }).formatToParts(new Date(t)).reduce((a, p) => (a[p.type] = p.value, a), {});
        return (+back.hour % 24) === H && +back.minute === Mi;
    });

    if (valid.length === 0) return { error: 'nonexistent' };          // clocks forward
    if (valid.length > 1) {
        if (fold === undefined || fold === null) return { error: 'ambiguous' };
        return { utc: new Date(fold ? Math.max(...valid) : Math.min(...valid)) };
    }
    return { utc: new Date(valid[0]) };
}

/** The tail's ledger state immediately before an instant. */
async function ledgerBefore(tx, tailNumber, utcIso) {
    const rows = await tx.run(SELECT.from(ROB)
        .columns('closing_rob_kg', 'balance_value_usd', 'map_usd_per_kg',
                 'record_date', 'record_time', 'sequence', 'event_utc')
        .where({ tail_number: tailNumber })
        .orderBy({ ref: ['record_date'], sort: 'desc' },
                 { ref: ['record_time'], sort: 'desc' },
                 { ref: ['sequence'], sort: 'desc' }));
    // The rows are ordered by the display key; pick the latest whose event
    // instant precedes ours where one exists, else the latest overall.
    const dated = rows.filter(r => r.event_utc && new Date(r.event_utc) <= new Date(utcIso));
    return dated[0] || rows[0] || null;
}

/**
 * Resolve the valuation of a defuel.
 *
 * D1a — A DEFUEL NAMING AN UPLIFT TAKES THAT UPLIFT'S PRICE, overriding the
 * carrier's method. Handing fuel back to a vendor is handing back THAT fuel
 * at THAT price: the credit is negotiated against the invoice the airline
 * actually paid, and an averaged value cannot be reconciled to it.
 *
 * D1b — WITH NO UPLIFT NAMED, the carrier's method decides. On MAP that is
 * the moving average AS AT THE PRECEDING LEDGER ENTRY, which this system
 * maintains live. On FIFO it is the tail's layers, which this system does not
 * maintain live (discovery §0.5) — so a FIFO carrier is REFUSED rather than
 * valued as something else.
 */
async function resolveValuation(tx, defuel) {
    const method = await carrierMethod(tx, defuel.carrier_code);

    if (defuel.source_ticket_ID) {
        const t = await tx.run(SELECT.one.from(TICKETS)
            .columns('ID', 'quantity', 'uom_code', 'unit_price', 'total_amount',
                     'quantity_kg', 'density_value')
            .where({ ID: defuel.source_ticket_ID }));
        if (t) {
            const kg = num(t.quantity_kg) || null;
            const rate = kg && num(t.total_amount) ? num(t.total_amount) / kg
                       : (num(t.unit_price) || null);
            return {
                basis: 'SPECIFIC',
                rate,
                density: num(t.density_value) || null,
                density_source: 'SOURCE_UPLIFT',
                method
            };
        }
    }

    if (method === 'MAP') {
        const prev = await ledgerBefore(tx, defuel.tail_number, defuel.event_utc);
        return {
            basis: 'MAP',
            rate: prev ? num(prev.map_usd_per_kg) || null : null,
            density: null,
            density_source: 'TAIL_AVERAGE',
            method
        };
    }

    return { basis: null, rate: null, density: null, density_source: 'UNAVAILABLE', method };
}

/** The carrier's configured valuation method; FIFO where none is set (D1). */
async function carrierMethod(tx, carrierCode) {
    if (!carrierCode) return 'FIFO';
    const row = await tx.run(SELECT.one.from('fuelsphere.CARRIER_MASTER')
        .columns('carrier_code', 'valuation_method')
        .where({ carrier_code: carrierCode }));
    // NULL MEANS FIFO, per D1: "where none is set the default is FIFO". The
    // column records a DEPARTURE from the default rather than the default
    // itself, so an unconfigured carrier is a FIFO carrier and is refused by
    // DFL407 until somebody decides otherwise. Defaulting the other way would
    // make every carrier work and leave the default path untested.
    return (row && row.valuation_method) || 'FIFO';
}

module.exports = cds.service.impl(async function () {
    const { Defuels } = this.entities;

    // =======================================================================
    // CAPTURE — defaults and refusals, on the draft and the active alike
    // =======================================================================
    this.before(['CREATE', 'UPDATE'], [Defuels, Defuels.drafts], async (req) => {
        const d = req.data;
        const tx = cds.tx(req);

        // ---- the carrier, defaulted from the tail and editable ------------
        //
        // Q6, answered 23 Oct: "Make this a field (mandatory) in the Uplift /
        // defuel at Tail level transaction (default value from the aircraft
        // master, but can be changed)." Captured rather than derived at read
        // time: a carrier resolved later from a master that has since changed
        // would re-value history.
        if (d.tail_registration && !d.carrier_code) {
            const tail = await tx.run(SELECT.one.from(TAILS)
                .columns('registration', 'operator_code')
                .where({ registration: d.tail_registration }));
            if (tail) d.tail_number = d.tail_number || tail.registration;
        }

        // ---- the event instant (R3.9/R3.10, and Q2's "based on time") -----
        if (d.event_local && d.event_zone) {
            const out = localToUtc(d.event_local, d.event_zone, d.event_dst_fold);
            if (out.error === 'nonexistent') {
                return req.error(400, `DFL409: ${d.event_local} does not exist at ${d.event_zone} `
                    + '— the clocks went forward over that hour. Enter the time as it was '
                    + 'actually read at the station.', 'event_local');
            }
            if (out.error === 'ambiguous') {
                return req.error(400, `DFL410: ${d.event_local} occurred twice at ${d.event_zone} `
                    + '— the clocks went back over that hour. Say which reading was taken '
                    + '(before or after the change) so the ledger can sort it.', 'event_local');
            }
            if (out.utc) d.event_utc = out.utc.toISOString();
        }

        // ---- M1 is cumulative against its uplift (R1.5) --------------------
        //
        // A CUMULATIVE TEST, NOT A SINGLE-DEFUEL ONE. Two defuels of 2,000
        // against a 3,000 uplift must fail on the second, and the message
        // must say what was already taken — checking each in isolation would
        // let the uplift be handed back twice.
        //
        // IT BINDS M1 ONLY, by construction rather than by choice: M2 has no
        // uplift to net against, which the BR confirms explicitly.
        if (d.source_ticket_ID && num(d.quantity_kg) > 0) {
            const t = await tx.run(SELECT.one.from(TICKETS)
                .columns('ID', 'quantity_kg', 'ticket_number', 'internal_number')
                .where({ ID: d.source_ticket_ID }));
            if (t) {
                const earlier = await tx.run(SELECT.from(DEFUEL)
                    .columns('ID', 'quantity_kg')
                    .where({ source_ticket_ID: d.source_ticket_ID, is_reversed: false }));
                const already = earlier
                    .filter(e => e.ID !== (d.ID || req.params?.[0]?.ID))
                    .reduce((s, e) => s + num(e.quantity_kg), 0);
                const uplift = num(t.quantity_kg);
                if (uplift > 0 && already + num(d.quantity_kg) > uplift + 0.001) {
                    return req.error(400,
                        `DFL401: uplift ${t.internal_number || t.ticket_number} delivered `
                      + `${r3(uplift)} kg and ${r3(already)} kg has already been defuelled `
                      + `against it, so ${r3(uplift - already)} kg remains. `
                      + `This defuel is ${r3(d.quantity_kg)} kg.`, 'quantity_kg');
                }
            }
        }

        // ---- uplift out of a DEFUEL location is blocked (D4, R2.4) --------
        //
        // A HARD REFUSAL, NOT A WARNING. Once fuel is destined for return it
        // must not be quietly re-uplifted: the return has already been priced
        // and may already be accrued.
        if (d.movement_type === 'M4' && d.location_ID) {
            const loc = await tx.run(SELECT.one.from(LOCATIONS)
                .columns('code', 'location_type').where({ ID: d.location_ID }));
            if (loc && loc.location_type === 'DEFUEL') {
                return req.error(400,
                    `DFL402: ${loc.code} is a DEFUEL location and fuel in it is destined for `
                  + 'return to the vendor, which may already be priced and accrued. '
                  + 'Re-uplift is only permitted out of a TEMP location.', 'location_ID');
            }
        }
    });

    // =======================================================================
    // ACTIVATION — the movement reaches both ledgers (R4.6)
    // =======================================================================
    this.after('CREATE', Defuels, async (result, req) => {
        try {
            await postMovement(cds.tx(req), result, req);
        } catch (err) {
            LOG.error(`Defuel ${result.ID} did not post`, err);
            req.warn(`Defuel saved, but the ledger movement failed: ${err.message}`);
        }
    });

    /**
     * Write the tail ledger row and the location ledger row.
     *
     * ON THE AMBIENT TRANSACTION, never a new one. cds.tx(req, …) silently
     * discards writes while returning 200, and cds.tx() without req deadlocks
     * on a single-connection database — CAP already wraps the request, so the
     * two rows land or fail together by doing nothing special.
     */
    async function postMovement(tx, d, req) {
        if (!d || !d.quantity_kg) return;

        const val = await resolveValuation(tx, d);

        // D1/D1b — a FIFO carrier has no value this system can produce.
        // REFUSED, not approximated: see the service header.
        if (!val.basis) {
            await tx.run(UPDATE(DEFUEL, d.ID).with({ status: 'ERROR' }));
            return req.error(422,
                `DFL407: carrier ${d.carrier_code} values fuel FIFO, and FIFO layers are not `
              + 'maintained live in FuelSphere — they are produced by an offline replay. '
              + 'A defuel on this carrier has no value that can be produced now. '
              + 'Set the carrier to MAP, or name the uplift this fuel came from.');
        }
        if (!val.rate) {
            await tx.run(UPDATE(DEFUEL, d.ID).with({ status: 'ERROR' }));
            return req.error(422,
                `DFL408: no rate could be resolved for ${d.tail_number} at ${d.event_utc}. `
              + 'The tail has no priced movement before this one, so there is nothing to '
              + 'value the fuel at. Name the uplift it came from.');
        }

        const qty = r3(d.quantity_kg);
        const value = r2(qty * val.rate);
        const outbound = OUTBOUND.has(d.movement_type);

        // ---- the tail's side ------------------------------------------------
        const prev = await ledgerBefore(tx, d.tail_number, d.event_utc);
        const opening = prev ? num(prev.closing_rob_kg) : 0;
        const closing = outbound ? opening - qty : opening + qty;

        // R5.6/R2.6 — never a negative balance. A reversal or defuel that
        // would take a tail below zero means the quantity is wrong, the fuel
        // is already burned, or this was never the right ticket. Any of the
        // three is worth stopping for, and a clamped balance hides all three.
        if (closing < -0.001) {
            await tx.run(UPDATE(DEFUEL, d.ID).with({ status: 'ERROR' }));
            return req.error(400,
                `DFL403: ${d.tail_number} holds ${r3(opening)} kg before this movement and `
              + `this defuel is ${qty} kg, which would leave ${r3(closing)} kg. `
              + 'A tail cannot hold negative fuel.');
        }

        const prevValue = prev ? num(prev.balance_value_usd) : 0;
        const closingValue = r2(outbound ? prevValue - value : prevValue + value);

        const utc = new Date(d.event_utc);
        const recordDate = utc.toISOString().slice(0, 10);
        const recordTime = (d.event_local || utc.toISOString()).slice(11, 19) || '00:00:00';

        const airport = await tx.run(SELECT.one.from(LOCATIONS)
            .columns('station_code', 'airport_ID', 'code', 'location_type')
            .where({ ID: d.location_ID }));

        const seq = await nextSequence(tx, d.tail_number, recordDate);

        await tx.run(INSERT.into(ROB).entries({
            ID: cds.utils.uuid(),
            tail_number: d.tail_number,
            tail_registration: d.tail_number,
            record_date: recordDate,
            record_time: recordTime,
            sequence: seq,
            airport_ID: airport ? airport.airport_ID : null,
            airport_code: airport ? airport.station_code : null,
            entry_type: 'DEFUEL',
            opening_rob_kg: r3(opening),
            closing_rob_kg: r3(closing),
            qty_kg: outbound ? -qty : qty,
            rate_usd_per_kg: val.rate,
            value_usd: outbound ? -value : value,
            balance_value_usd: closingValue,
            map_usd_per_kg: closing > 0 ? r2(closingValue / closing) : 0,
            // THE EVENT INSTANT, not flight_aobt. A defuel has no off-block
            // time, and writing one into a field named for a flight is the
            // two-meanings defect this codebase has paid for repeatedly.
            event_utc: d.event_utc,
            event_local: d.event_local,
            event_zone: d.event_zone,
            valuation_basis: val.basis,
            defuel_ID: d.ID,
            // Q2's answer: the event's own time positions it, so the defuel
            // takes the slot immediately after an uplift at the same instant.
            line_order: 2,
            data_source: 'DEFUEL',
            created_at: new Date().toISOString(),
            created_by: req.user?.id || 'DEFUEL'
        }));

        // ---- the location's side (R2.3, R4.6) -------------------------------
        //
        // ONE ENTRY PER LAYER CONSUMED (Q9, Option B). Under MAP a defuel has
        // a single rate so this is one row; under FIFO it would be one per
        // batch, which is what keeps a credit reconcilable to the invoice
        // that bought that fuel.
        const locPrev = await tx.run(SELECT.one.from(LEDGER)
            .columns('balance_qty_kg', 'balance_value_usd', 'sequence')
            .where({ location_ID: d.location_ID })
            .orderBy({ ref: ['event_utc'], sort: 'desc' }, { ref: ['sequence'], sort: 'desc' }));
        const locOpenQty = locPrev ? num(locPrev.balance_qty_kg) : 0;
        const locOpenVal = locPrev ? num(locPrev.balance_value_usd) : 0;
        const inbound = outbound;     // fuel leaving the TAIL enters the LOCATION
        const locQty = r3(inbound ? qty : -qty);
        const locClose = r3(locOpenQty + locQty);

        if (locClose < -0.001) {
            await tx.run(UPDATE(DEFUEL, d.ID).with({ status: 'ERROR' }));
            return req.error(400,
                `DFL403: ${airport ? airport.code : 'the location'} holds ${r3(locOpenQty)} kg `
              + `and this movement takes ${qty} kg, leaving ${locClose} kg. `
              + 'A location balance that goes negative means fuel left a tail and never '
              + 'arrived, or left here twice.');
        }

        await tx.run(INSERT.into(LEDGER).entries({
            ID: cds.utils.uuid(),
            defuel_ID: d.ID,
            location_ID: d.location_ID,
            direction: inbound ? 'IN' : 'OUT',
            qty_kg: locQty,
            rate_usd_per_kg: val.rate,
            value_usd: r2(locQty * val.rate),
            valuation_basis: val.basis,
            density: val.density,
            density_source: val.density_source,
            balance_qty_kg: locClose,
            balance_value_usd: r2(locOpenVal + locQty * val.rate),
            event_utc: d.event_utc,
            event_local: d.event_local,
            event_zone: d.event_zone,
            sequence: (locPrev ? num(locPrev.sequence) : 0) + 1,
            created_at: new Date().toISOString(),
            created_by: req.user?.id || 'DEFUEL'
        }));

        // ---- the held value (R6.5) ------------------------------------------
        //
        // A CAPITALISED FEE IS PART OF IT, and therefore part of the shortfall
        // when the vendor credits only the fuel. A shortfall computed on the
        // fuel price alone understates the loss by the fee — and the fee is
        // the part the airline is least likely to recover.
        const fee = d.fee_treatment === 'CAPITALISE' ? num(d.defuel_fee_usd) : 0;
        await tx.run(UPDATE(DEFUEL, d.ID).with({
            fuel_value_usd: value,
            held_value_usd: r2(value + fee),
            valuation_basis: val.basis,
            density: val.density,
            density_source: val.density_source,
            // Q1, Option C: five components, and airport/royalty stays zero
            // until a source for it exists. A zero that is visibly zero is
            // defensible; a figure split out by guesswork is not.
            component_base_usd: value,
            component_airport_fee_usd: 0,
            // PARKED ON ARRIVAL (R5.9). A recorded defuel with no agreed
            // outcome is a parked item — a real position on the books, and
            // the population month end accrues.
            status: d.status || 'PARKED'
        }));

        LOG.info(`Defuel ${d.ID}: ${qty} kg off ${d.tail_number} at ${val.rate} `
               + `(${val.basis}) into ${airport ? airport.code : '?'}`);
    }

    /** Next sequence for a tail on a date — unique within the tail (R3.12). */
    async function nextSequence(tx, tailNumber, recordDate) {
        const rows = await tx.run(SELECT.from(ROB).columns('sequence')
            .where({ tail_number: tailNumber, record_date: recordDate }));
        return rows.reduce((m, r) => Math.max(m, num(r.sequence)), 0) + 1;
    }

    // =======================================================================
    // ACTIONS
    // =======================================================================

    this.on('park', Defuels, async (req) => {
        const ID = keyOf(req);
        await cds.tx(req).run(UPDATE(DEFUEL, ID).with({ status: 'PARKED' }));
        return SELECT.one.from(Defuels, ID);
    });

    this.on('settle', Defuels, async (req) => {
        const ID = keyOf(req);
        const tx = cds.tx(req);
        const d = await tx.run(SELECT.one.from(DEFUEL).where({ ID }));
        if (!d) return req.error(404, 'DFL501: the defuel no longer exists');
        if (d.is_reversed) return req.error(400,
            'DFL406: this defuel has been reversed and cannot be settled.');

        const held = num(d.held_value_usd);
        const totalQty = num(d.quantity_kg);
        const alreadyValue = num(d.settled_value_usd);
        const alreadyQty = num(d.settled_qty_kg);
        const credit = r2(req.data.credit_usd);

        // A SETTLEMENT SETTLES A QUANTITY, and the shortfall belongs to THAT
        // quantity rather than to the whole parcel.
        //
        // The first version wrote off the entire remainder on every
        // settlement, so a 40% credit on a quarter of the fuel closed the
        // parcel outright — and R5.11 exists precisely because a vendor may
        // credit part now and the rest a month later. Settling part must
        // leave the rest open.
        const qty = r3(req.data.quantity_kg || (totalQty - alreadyQty));
        const remainingQty = r3(totalQty - alreadyQty);
        if (qty > remainingQty + 0.001) {
            return req.error(400,
                `DFL412: ${r3(remainingQty)} kg of this defuel is still open and this `
              + `settlement is for ${qty} kg.`);
        }
        // The held value attributable to the quantity being settled.
        const open = totalQty > 0 ? r2(held * (qty / totalQty)) : r2(held - alreadyValue);

        // R5.5 / D2 — a hard refusal quoting BOTH figures, because it is a
        // data-entry error every time and the user needs to see which one is
        // wrong. A credit above the held value turns a loss into a profit on
        // a transaction where the airline lost money.
        if (credit > open + 0.005) {
            return req.error(400,
                `DFL404: the credit of ${credit.toFixed(2)} exceeds the open held value of `
              + `${open.toFixed(2)} on this defuel. A credit cannot exceed what the fuel `
              + 'cost; FuelSphere would be recording a profit on a loss.');
        }

        const writeOff = r2(Math.max(0, open - credit));
        // R5.3 — S2 is the NORMAL case. Full credit and no credit are the two
        // ends of the range, and a design treating full credit as normal
        // would be wrong on most transactions.
        const outcome = credit <= 0 ? 'S3' : (writeOff <= 0.005 ? 'S1' : 'S2');

        await tx.run(INSERT.into(SETTLEMENT).entries({
            ID: cds.utils.uuid(),
            defuel_ID: ID,
            outcome,
            settled_qty_kg: qty,
            held_value_usd: open,
            expected_credit_usd: credit,
            actual_credit_usd: credit,
            write_off_usd: writeOff,
            credit_memo_reference: req.data.credit_memo || null,
            settled_at: new Date().toISOString(),
            approval_status: 'NOT_REQ',
            notes: req.data.note || null,
            created_at: new Date().toISOString(),
            created_by: req.user?.id || 'DEFUEL'
        }));

        const settledValue = r2(alreadyValue + credit + writeOff);
        const settledQty = r3(alreadyQty + qty);
        await tx.run(UPDATE(DEFUEL, ID).with({
            settled_qty_kg: settledQty,
            settled_value_usd: settledValue,
            credited_usd: r2(num(d.credited_usd) + credit),
            written_off_usd: r2(num(d.written_off_usd) + writeOff),
            // SETTLED WHEN THE QUANTITY IS EXHAUSTED, not when the value
            // happens to add up. R5.11's parcel is a quantity, and a credit
            // that covers the whole value of half the fuel leaves half the
            // fuel unsettled.
            status: settledQty >= totalQty - 0.001 ? 'SETTLED' : 'POSTED'
        }));
        return SELECT.one.from(Defuels, ID);
    });

    this.on('writeOff', Defuels, async (req) => {
        const ID = keyOf(req);
        const tx = cds.tx(req);
        const d = await tx.run(SELECT.one.from(DEFUEL).where({ ID }));
        if (!d) return req.error(404, 'DFL501: the defuel no longer exists');
        if (d.is_reversed) return req.error(400,
            'DFL406: this defuel has been reversed and cannot be written off.');

        const open = r2(num(d.held_value_usd) - num(d.settled_value_usd));
        if (open <= 0.005) return req.error(400,
            'DFL411: there is nothing left to write off on this defuel.');

        await tx.run(INSERT.into(SETTLEMENT).entries({
            ID: cds.utils.uuid(), defuel_ID: ID,
            outcome: 'S3',
            settled_qty_kg: r3(num(d.quantity_kg) - num(d.settled_qty_kg)),
            held_value_usd: open, expected_credit_usd: 0, actual_credit_usd: 0,
            write_off_usd: open,
            settled_at: new Date().toISOString(), approval_status: 'NOT_REQ',
            notes: req.data.reason || null,
            created_at: new Date().toISOString(), created_by: req.user?.id || 'DEFUEL'
        }));
        await tx.run(UPDATE(DEFUEL, ID).with({
            settled_value_usd: r2(num(d.settled_value_usd) + open),
            written_off_usd: r2(num(d.written_off_usd) + open),
            settled_qty_kg: num(d.quantity_kg),
            status: 'WRITTEN_OFF'
        }));
        return SELECT.one.from(Defuels, ID);
    });

    this.on('reverse', Defuels, async (req) => {
        const ID = keyOf(req);
        const tx = cds.tx(req);
        const d = await tx.run(SELECT.one.from(DEFUEL).where({ ID }));
        if (!d) return req.error(404, 'DFL501: the defuel no longer exists');

        // R1.10 — a reversed defuel is kept and marked, never deleted, and
        // cannot be reversed again. A reversal is not a transaction to undo.
        if (d.is_reversed) return req.error(400,
            'DFL406: this defuel has already been reversed. If the reversal itself was '
          + 'wrong, record the defuel again as a new entry.');

        // Q10, Option A — REFUSED ONCE ANY SETTLEMENT EXISTS. Reversing a
        // defuel whose credit is already agreed would change a commercial
        // document without the vendor knowing; cancel the settlement first.
        const settled = await tx.run(SELECT.from(SETTLEMENT)
            .columns('ID', 'credit_memo_reference').where({ defuel_ID: ID }));
        if (settled.length) {
            const memo = settled.map(s => s.credit_memo_reference).filter(Boolean)[0];
            return req.error(400,
                `DFL405: this defuel has ${settled.length} settlement(s)`
              + (memo ? ` including credit memo ${memo}` : '')
              + '. Reversing it would change a commercial outcome already agreed with the '
              + 'vendor. Cancel the settlement first.');
        }

        // R1.9 / D6a — THE REVERSAL KEEPS THE ORIGINAL EVENT TIME. It puts
        // right the record of an event rather than recording a new one, so it
        // sits at the original position and only the quantity moves. Stamped
        // now, every balance between the two would compute as though the fuel
        // left the tank later than it did.
        await tx.run(UPDATE(DEFUEL, ID).with({
            is_reversed: true,
            status: 'REVERSED',
            notes: [d.notes, `Reversed: ${req.data.reason || 'no reason given'}`]
                .filter(Boolean).join('\n')
        }));

        // The contra rows, at the ORIGINAL instant.
        const entries = await tx.run(SELECT.from(LEDGER).where({ defuel_ID: ID }));
        for (const e of entries) {
            await tx.run(INSERT.into(LEDGER).entries({
                ID: cds.utils.uuid(), defuel_ID: ID, location_ID: e.location_ID,
                direction: e.direction === 'IN' ? 'OUT' : 'IN',
                qty_kg: -num(e.qty_kg),
                rate_usd_per_kg: e.rate_usd_per_kg,
                value_usd: -num(e.value_usd),
                valuation_basis: e.valuation_basis,
                density: e.density, density_source: e.density_source,
                balance_qty_kg: r3(num(e.balance_qty_kg) - num(e.qty_kg)),
                balance_value_usd: r2(num(e.balance_value_usd) - num(e.value_usd)),
                event_utc: e.event_utc, event_local: e.event_local, event_zone: e.event_zone,
                sequence: num(e.sequence) + 1,
                created_at: new Date().toISOString(), created_by: req.user?.id || 'DEFUEL'
            }));
        }
        LOG.info(`Defuel ${ID} reversed at its original instant ${d.event_utc}`);
        return SELECT.one.from(Defuels, ID);
    });

    function keyOf(req) {
        return (req.params && req.params[0] && (req.params[0].ID || req.params[0]))
            || req.data.ID;
    }
});

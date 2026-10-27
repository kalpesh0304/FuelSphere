const cds = require('@sap/cds');

/**
 * DefuelService — fuel off an aircraft and into a tank on the ground.
 *
 * ===========================================================================
 * THIS REPLACES THE SETTLEMENT MODEL. The service that stood here parked a
 * defuel, accrued an expected credit against it, then settled or wrote that
 * credit off across several events. It is gone by instruction, to keep the
 * demo simple; it comes back later.
 *
 * AND IT REVERSES DFL407. The old service REFUSED a defuel on a FIFO carrier,
 * because FIFO layers were produced by an offline replay and so a FIFO defuel
 * had a value nobody could produce. A defuel now DRAWS from those layers and
 * writes the result back, so from here on the layers are maintained live.
 *
 * WHAT A POSTING WRITES, per method, per layer touched:
 *
 *   out   tail set, storage_location null, qty negative, at the layer's rate
 *   in    tail null, storage_location set, qty positive, at the same rate
 *
 * THE FUEL KEEPS ITS BATCH AND ITS PRICE. Both halves name the same batch_ref
 * and the same rate, which is what lets the fuel be re-uplifted later at what
 * it was bought for rather than at whatever the pool averages to that week.
 * It is also why the two halves cancel in value: a defuel MOVES stock, it
 * does not create or destroy it.
 *
 * BOTH METHODS, ALWAYS. Answered 26 Oct: a defuel is double-valued exactly as
 * every uplift and burn in this ledger already is — batch by batch under
 * FIFO, once at the running rate under MAP. Writing only the FIFO half would
 * leave MAP stock overstated by every defuel ever recorded.
 * ===========================================================================
 */

const MOVEMENTS = 'fuelsphere.FUEL_STOCK_MOVEMENT_LEDGER';
const BALANCES  = 'fuelsphere.FUEL_STOCK_BALANCE';
const HEADERS   = 'fuelsphere.FUEL_BURN_HEADER';
const LEDGER    = 'fuelsphere.ROB_LEDGER';
const DEFUELS   = 'fuelsphere.DEFUEL';

// ===========================================================================
// A DEFUEL IS A MOVEMENT ON THE TAIL'S OWN LEDGER, since 27 Oct 2026.
// ===========================================================================
//
// IT WAS WRITTEN ONLY TO THE VALUATION, and drew on the END STATE of the
// replay. Two things followed. ROB_LEDGER - the FOB balance the burn and ROB
// screens show - never learned that fuel had come off, so a defuelled tail
// read as still carrying it. And a defuel taken off BEFORE DEPARTURE (fuel
// tankered for the next leg, then a late cargo or passenger increase takes
// the aircraft over MTOW) could never draw the fuel just uplifted: by the end
// of the history the next burn had already consumed that layer.
//
// SO A DEFUEL IS NOW POSTED THE WAY THE LEDGER WORKS:
//
//   1. a DEFUEL row on ROB_LEDGER at the defuel's own instant - after the
//      uplift it draws on, before the burn of the flight it came off -
//      carrying -quantity in adjustment_kg and the document in defuel_ID;
//   2. the tail's ROB chain recalculated (srv/lib/rob-recalculate.js), so
//      every later balance and moving average knows the fuel is gone;
//   3. the tail's stock valuation REPLAYED from that ledger
//      (srv/lib/stock-replay.js, the same code that seeds it), so every later
//      burn draws the layers it would really have drawn.
//
// The draw itself is made from the layers AS OF the defuel's position, not
// from the end state - which is what makes a pre-departure defuel possible.
const { recalculateTail } = require('./lib/rob-recalculate');
const stock = require('./lib/stock-replay');

// ===========================================================================
// Volume units
// ===========================================================================
//
// ONE TABLE, ONE PLACE. A conversion factor copied into two files is a
// conversion factor that disagrees with itself the first time somebody
// corrects one of them.
//
// 3.785411784 IS EXACT - it is the definition of the US gallon, not an
// approximation - so it is written in full rather than rounded to 3.785.
const LITRES_PER = {
    LTR: 1,
    L:   1,
    GAL: 3.785411784,   // US gallon
    USG: 3.785411784,   // US gallon, aviation spelling. The same unit.
    IMP: 4.54609        // Imperial gallon, should it ever be configured
};
const toLitres = (v, uom) => Number(v || 0) * (LITRES_PER[String(uom || 'LTR').toUpperCase()] || 1);
const fromLitres = (l, uom) => Number(l || 0) / (LITRES_PER[String(uom || 'LTR').toUpperCase()] || 1);

const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

module.exports = cds.service.impl(async function () {

    const { Defuels } = this.entities;

    // =======================================================================
    // FILL THE DERIVED FIELDS WHILE THE USER IS STILL TYPING
    // =======================================================================
    //
    // ON THE DRAFT, NOT ONLY ON SAVE. Deriving solely in the SAVE handler is
    // correct and useless: the user picks a flight, sees nothing happen, and
    // only finds the station and carrier filled in after the record exists.
    // A field that will be computed should be computed when its input
    // changes.
    //
    // THE SAVE HANDLER STILL DERIVES EVERYTHING ITSELF. This one is a
    // convenience for the screen; it is not the guarantee. A draft can be
    // patched by anything, and the posting must not depend on the UI having
    // been polite.
    this.before('UPDATE', Defuels.drafts, async (req) => {
        const d = req.data;
        const db = cds.transaction(req);

        if (d.flight_number !== undefined || d.flight_ID !== undefined) {
            // THE PICKER WRITES THE NUMBER; the key follows it. Binding the
            // field to flight_number is what stops the screen showing a GUID,
            // so the number is what arrives and the row is found by it.
            const where = d.flight_ID ? { ID: d.flight_ID }
                : (d.flight_number ? { flight_number: d.flight_number } : null);
            const f = where && await db.run(SELECT.one.from('fuelsphere.FLIGHT_SCHEDULE')
                .columns('ID', 'flight_number', 'flight_date', 'airline_code',
                         'origin_airport', 'destination_airport', 'aircraft_reg')
                .where(where).orderBy({ flight_date: 'desc' }));
            if (f) {
                d.flight_ID           = f.ID;
                d.flight_number       = f.flight_number;
                d.flight_date         = f.flight_date;
                d.carrier_code        = f.airline_code;
                d.origin_station      = f.origin_airport;
                d.destination_station = f.destination_airport;
                d.station_code        = d.station_code || f.origin_airport;
                // THE SCHEDULE KNOWS THE TAIL, so the user should not have to
                // type it - and a tail that disagreed with the schedule would
                // be two records of one leg.
                if (f.aircraft_reg) {
                    d.tail_registration = f.aircraft_reg;
                    d.tail_number       = f.aircraft_reg;
                }
            }
        }

        if (d.tail_registration !== undefined && d.tail_registration) {
            d.tail_number = d.tail_registration;
        }

        // ---- the station the two context flights imply -------------------
        //
        // A PRE-FLIGHT IS THE DEPARTURE THE AIRCRAFT IS BEING PREPARED FOR,
        // so the defuel happens at that leg's ORIGIN - fuel comes off on
        // stand before pushback, typically for weight.
        //
        // A POST-FLIGHT IS THE ARRIVAL IT JUST MADE, so the defuel happens at
        // that leg's DESTINATION - the aircraft is already down.
        //
        // The two cannot both be right about where the aircraft is, so the
        // pre-flight wins when both are given: it is the nearer event to a
        // defuel being recorded now.
        const legStation = async (number, date, which) => {
            if (!number) return null;
            const where = { flight_number: number };
            if (date) where.flight_date = date;
            const f = await db.run(SELECT.one.from('fuelsphere.FLIGHT_SCHEDULE')
                .columns('origin_airport', 'destination_airport', 'flight_date')
                .where(where).orderBy({ flight_date: 'desc' }));
            return f ? (which === 'origin' ? f.origin_airport : f.destination_airport) : null;
        };

        if (d.pre_flight_number !== undefined || d.pre_flight_date !== undefined
            || d.post_flight_number !== undefined || d.post_flight_date !== undefined) {
            const fromPre  = await legStation(d.pre_flight_number,  d.pre_flight_date,  'origin');
            const fromPost = await legStation(d.post_flight_number, d.post_flight_date, 'destination');
            const implied = fromPre || fromPost;
            // DEFAULTED, NOT FORCED. A user who typed a station meant it -
            // a diversion puts the aircraft somewhere the schedule does not
            // know about, and overwriting that would be the system arguing
            // with the person who was there.
            if (implied && !d.station_code) d.station_code = implied;
        }

        if (d.location_code !== undefined || d.location_ID !== undefined) {
            const where = d.location_ID ? { ID: d.location_ID }
                : (d.location_code ? { code: d.location_code } : null);
            const l = where && await db.run(SELECT.one.from('fuelsphere.STORAGE_LOCATION')
                .columns('ID', 'code').where(where));
            if (l) { d.location_ID = l.ID; d.location_code = l.code; }
        }

        if (d.supplier_name !== undefined || d.supplier_ID !== undefined) {
            const where = d.supplier_ID ? { ID: d.supplier_ID }
                : (d.supplier_name ? { supplier_name: d.supplier_name } : null);
            const v = where && await db.run(SELECT.one.from('fuelsphere.MASTER_SUPPLIERS')
                .columns('ID', 'supplier_name').where(where));
            if (v) { d.supplier_ID = v.ID; d.supplier_name = v.supplier_name; }
        }
    });

    // =======================================================================
    // DERIVE, VALIDATE, POST — all on draft activation
    // =======================================================================
    //
    // ONE HANDLER, because the three are not separable: the quantity cannot
    // be checked until the tail is known, and the tail comes from the flight.
    //
    // ON SAVE, NOT ON CREATE. SAVE is the draft activation — the moment the
    // user commits — and it is the only point at which posting to the
    // valuation ledger is correct. Posting on CREATE would write ledger rows
    // for every half-typed draft.
    this.before('SAVE', Defuels, async (req) => {
        const d = req.data;
        const db = cds.transaction(req);

        // ---- source ----------------------------------------------------
        if (d.source_mode === 'WITH_FLIGHT') {
            if (!d.flight_ID) {
                return req.error(400, 'DFL420: a flight must be selected when the defuel is '
                    + 'recorded against one. Switch to "without flight" to record a defuel '
                    + 'the aircraft took outside a scheduled leg.', 'flight_ID');
            }
            const f = await db.run(SELECT.one.from('fuelsphere.FLIGHT_SCHEDULE')
                .columns('ID', 'flight_number', 'flight_date', 'airline_code',
                         'origin_airport', 'destination_airport')
                .where({ ID: d.flight_ID }));
            if (!f) return req.error(400, 'DFL420: that flight no longer exists.', 'flight_ID');
            d.flight_ID = f.ID;

            // THE SCHEDULE WINS on all four. A flight-referenced defuel that
            // disagreed with the schedule would be two records of one leg.
            d.flight_number       = f.flight_number;
            d.flight_date         = f.flight_date;
            d.carrier_code        = f.airline_code || d.carrier_code;
            d.origin_station      = f.origin_airport;
            d.destination_station = f.destination_airport;
            // The ORIGIN — the airport that fuelled the leg — unless the user
            // already named a station, which is how fuel coming off at the
            // arrival end after a diversion gets recorded where it happened.
            d.station_code  = d.station_code || f.origin_airport;
        } else {
            // A tail-only defuel has no schedule row to lean on, so the
            // station is the user's to state — and it is not optional,
            // because the defuel number is built from it.
            if (!d.station_code) {
                return req.error(400, 'DFL421: a station is required on a defuel recorded '
                    + 'without a flight — the defuel number is built from it.', 'station_code');
            }
            // CLEARED, NOT LEFT BEHIND. A user who picks a flight, fills the
            // form, then switches to a tail-only defuel would otherwise save
            // a document carrying a flight it is no longer recorded against.
            d.flight_ID = null; d.flight_number = null; d.flight_date = null;
            d.origin_station = null; d.destination_station = null;
        }

        // THE FOREIGN KEY IS THE REGISTRATION ITSELF. AIRCRAFT_REGISTRATIONS
        // is keyed by `registration`, not by a generated ID, so the
        // association compiles to tail_registration and the tail number
        // needs no lookup to read - only one to confirm it exists.
        const tail = await db.run(SELECT.one.from('fuelsphere.AIRCRAFT_REGISTRATIONS')
            .columns('registration').where({ registration: d.tail_registration }));
        if (!tail) {
            return req.error(400, 'DFL422: that aircraft is not in the register.',
                'tail_registration');
        }
        d.tail_number = tail.registration;

        // THE CARRIER, EVEN WITHOUT A FLIGHT. It decides which unit the
        // quantity was typed in, so a tail-only defuel cannot be left without
        // one. The schedule knows who flies this tail; the majority answer is
        // taken, the same rule the valuation seeder uses for a wet-leased
        // airframe that flew under two codes.
        if (!d.carrier_code) {
            const flown = await db.run(SELECT.from('fuelsphere.FLIGHT_SCHEDULE')
                .columns('airline_code')
                .where({ aircraft_reg: d.tail_number, airline_code: { '!=': null } }));
            const votes = new Map();
            for (const f of flown) votes.set(f.airline_code, (votes.get(f.airline_code) || 0) + 1);
            const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
            if (ranked.length) d.carrier_code = ranked[0][0];
        }

        // BY KEY IF THERE IS ONE, BY CODE OTHERWISE. The picker binds to the
        // readable code so the user never sees a GUID, which means the code
        // can be the only thing that arrived.
        const loc = await db.run(SELECT.one.from('fuelsphere.STORAGE_LOCATION')
            .columns('ID', 'code', 'is_active')
            .where(d.location_ID ? { ID: d.location_ID } : { code: d.location_code || '' }));
        if (loc) d.location_ID = loc.ID;
        if (!loc) return req.error(400, 'DFL423: that storage location no longer exists.', 'location_ID');
        if (loc.is_active === false) {
            return req.error(400, `DFL423: ${loc.code} is not active and cannot receive fuel. `
                + 'Pick another tank, or reactivate it in Defuel Configuration.', 'location_ID');
        }
        d.location_code = loc.code;

        // THE DEFUELLING AGENT'S NAME IS STORED, not read through the
        // association, so the picker can show a name instead of a GUID. It
        // is resolved here as well so a document saved by anything other
        // than the screen still carries it.
        if (d.supplier_ID || d.supplier_name) {
            const v = await db.run(SELECT.one.from('fuelsphere.MASTER_SUPPLIERS')
                .columns('ID', 'supplier_name')
                .where(d.supplier_ID ? { ID: d.supplier_ID }
                                     : { supplier_name: d.supplier_name }));
            if (v) { d.supplier_ID = v.ID; d.supplier_name = v.supplier_name; }
        }

        // WHAT UNIT DID THE USER JUST TYPE IN? The carrier decides, and the
        // carrier is known by now - from the flight, or from the tail. A
        // carrier with nothing configured reads in litres, which is what the
        // database stores, so an unconfigured airline is merely unconverted
        // rather than wrong.
        const carrier = d.carrier_code && await db.run(
            SELECT.one.from('fuelsphere.CARRIER_MASTER')
                .columns('reporting_volume_uom')
                .where({ carrier_code: d.carrier_code }));
        d.volume_uom = (carrier && carrier.reporting_volume_uom) || 'LTR';

        const entered = Number(d.quantity_vol) || 0;
        if (!(entered > 0)) {
            return req.error(400, 'DFL424: the quantity defuelled must be greater than zero.',
                'quantity_vol');
        }
        const litres = Math.round(toLitres(entered, d.volume_uom) * 100) / 100;
        d.quantity_l = litres;

        // ---- draw the FIFO layers ---------------------------------------
        //
        // OLDEST FIRST, which is the whole of FIFO. The order IS the answer,
        // so it is stated explicitly rather than left to the database.
        // ---- the layers that EXISTED WHEN THE FUEL CAME OFF ---------------
        //
        // NOT MERELY THE LAYERS THAT ARE OPEN NOW. The balance table is the
        // end state of the replay, so "open" includes batches opened days
        // AFTER this defuel. Without the time bound a defuel on the 24th
        // drew from an uplift on the 26th - fuel that was not on the
        // aircraft, bought at a price nobody had paid yet.
        //
        // NULL AOBT IS AN OPENING BALANCE and predates everything, so it
        // qualifies whatever the defuel's instant.
        // ---- the layers that EXISTED WHEN THE FUEL CAME OFF -------------
        //
        // AS OF THE DEFUEL'S PLACE IN THE TAIL'S LEDGER, not the balance
        // table. The balance table is the end of the history, so it both
        // offered batches opened days AFTER the defuel and hid fuel that a
        // later burn had used - which is what made a pre-departure defuel
        // impossible. The ledger is replayed up to the defuel instead.
        const pos = await ledgerPosition(db, d.tail_number, d.defuel_date, d.defuel_time);
        const ctx = await replayContext(db, d.tail_number, pos.before);
        const layers = stock.layersAsOf(stock.movementsOf(d.tail_number, pos.before, ctx), Infinity)
            .filter((l) => l.left > 0);

        if (layers.length === 0) {
            return req.error(400, `DFL425: ${d.tail_number} held no valued stock on `
                + `${d.defuel_date}, so there is nothing to draw a defuel from. Fuel uplifted `
                + 'after that date cannot be taken off before it was loaded.', 'quantity_vol');
        }

        // ---- litres to kilograms ----------------------------------------
        //
        // THE TAIL'S WEIGHTED GRAVITY ACROSS ALL ITS OPEN LAYERS.
        const gTop = layers.reduce((a, l) => a + l.left * Number(l.specific_gravity || 0), 0);
        const gQty = layers.reduce((a, l) => a + (l.specific_gravity ? l.left : 0), 0);
        const tailGravity = gQty > 0 ? gTop / gQty : null;
        if (!tailGravity) {
            return req.error(400, `DFL428: no specific gravity is recorded against the fuel `
                + `on ${d.tail_number}, so ${litres} L cannot be converted to a mass. The `
                + 'ledger values kilograms, not litres.', 'quantity_l');
        }
        const qty = r3(litres * tailGravity);

        const onHand = r3(layers.reduce((s, l) => s + l.left, 0));
        if (onHand < qty) {
            return req.error(400, `DFL426: ${d.tail_number} holds ${onHand} kg and this defuel `
                + `takes ${qty} kg. A defuel cannot draw more than the aircraft is carrying.`,
                'quantity_kg');
        }

        // ---- and the fuel was not needed LATER ------------------------
        //
        // DFL432. A defuel placed before movements already on the ledger
        // lowers every balance after it. If one of those would go below zero
        // the aircraft could not have flown what it flew with that fuel gone:
        // refused, never drawn negative, for the reason DFL426 is.
        const low = pos.after.reduce((m, r) => {
            const c = Number(r.closing_rob_kg);
            return Number.isFinite(c) && (m === null || c < Number(m.closing_rob_kg)) ? r : m;
        }, null);
        if (low && Number(low.closing_rob_kg) - qty < 0) {
            return req.error(400, `DFL432: taking ${qty} kg off ${d.tail_number} on ${d.defuel_date} `
                + `would leave it ${r3(qty - Number(low.closing_rob_kg))} kg short at its `
                + `${low.entry_type} on ${low.record_date}: the ledger carries ${r3(low.closing_rob_kg)} kg `
                + 'there. A defuel cannot take fuel the aircraft went on to use.', 'quantity_vol');
        }

        // OLDEST FIRST, which is the whole of FIFO - the same rule the replay
        // applies when it restates the tail below.
        const taken = [];
        let left = qty;
        for (const l of layers) {
            if (left <= 0) break;
            const t = r3(Math.min(left, l.left));
            if (t <= 0) continue;
            taken.push({ qty: t, rate: Number(l.rate_usd_per_kg || 0), sg: l.specific_gravity });
            left = r3(left - t);
        }

        const fuelValue = r2(taken.reduce((s, t) => s + t.qty * t.rate, 0));
        const sgTop = taken.reduce((s, t) => s + t.qty * Number(t.sg || 0), 0);
        const sgQty = taken.reduce((s, t) => s + (t.sg ? t.qty : 0), 0);

        d.fuel_value_usd   = fuelValue;
        d.specific_gravity = sgQty > 0 ? Math.round((sgTop / sgQty) * 10000) / 10000
                                       : Math.round(tailGravity * 10000) / 10000;
        d.quantity_kg      = qty;
        d.status           = d.status || 'PARKED';
        d.defuel_id        = d.defuel_id || await nextDefuelId(db, d.station_code, d.defuel_date);

        await postToLedger(db, d, qty, pos);
    });

    // =======================================================================
    // REVERSE — the one correction a station user cannot make by editing
    // =======================================================================
    // =======================================================================
    // POST TO SUPPLIER — agree the credit, and book the rest as a loss
    // =======================================================================
    //
    // THE FUEL HAS ALREADY MOVED. This does not touch the valuation ledger:
    // the stock left the wing when the defuel was recorded. What happens here
    // is the MONEY - what the vendor will return, and what the airline is
    // eating.
    //
    // IT DOES NOT SET POSTED. Nothing in FuelSphere knows whether S/4 has
    // accepted the document, and a status this system can set on its own
    // would be a claim about another system. It waits at POSTING_PENDING.
    this.on('postToSupplier', Defuels, async (req) => {
        const db = cds.transaction(req);
        const key = req.params[req.params.length - 1];
        const d = await db.run(SELECT.one.from(DEFUELS).where({ ID: key.ID || key }));
        if (!d) return req.error(404, 'DFL520: that defuel no longer exists.');

        if (d.defuel_type !== 'TO_SUPPLIER') {
            return req.error(400, 'DFL429: this defuel put fuel into a storage location, so '
                + 'there is no vendor to claim a credit from. Fuel on the ground is still the '
                + 'airline’s until it is returned or re-uplifted.');
        }
        if (d.status === 'REVERSED') {
            return req.error(400, 'DFL427: this defuel has been reversed and cannot be posted.');
        }
        if (d.status !== 'PARKED') {
            return req.error(400, `DFL430: this defuel is already ${d.status} and cannot be `
                + 'posted again. Reverse it if the credit was agreed wrongly.');
        }

        const original = r2(d.fuel_value_usd);
        const credit   = r2(req.data.expected_credit_usd);
        if (!(credit >= 0)) {
            return req.error(400, 'DFL431: the expected credit cannot be negative.',
                'expected_credit_usd');
        }
        if (credit > original) {
            // REFUSED, because the write-off would be negative - the airline
            // would be booking a PROFIT on fuel it handed back. That is a
            // keying error every time.
            return req.error(400, `DFL431: the expected credit of ${credit.toFixed(2)} exceeds `
                + `the ${original.toFixed(2)} this fuel was worth. The credit cannot be more `
                + 'than the fuel was bought for.', 'expected_credit_usd');
        }

        await db.run(UPDATE(DEFUELS).set({
            expected_credit_usd: credit,
            write_off_usd:       r2(original - credit),
            status:              'POSTING_PENDING',
            modified_at:         new Date().toISOString(),
            modified_by:         'DEFUEL_SERVICE'
        }).where({ ID: d.ID }));

        return await db.run(SELECT.one.from(DEFUELS).where({ ID: d.ID }));
    });

    this.on('reverse', Defuels, async (req) => {
        const db = cds.transaction(req);
        const key = req.params[req.params.length - 1];
        const d = await db.run(SELECT.one.from(DEFUELS).where({ ID: key.ID || key }));
        if (!d) return req.error(404, 'DFL520: that defuel no longer exists.');
        if (d.status === 'REVERSED') {
            return req.error(400, 'DFL427: this defuel has already been reversed.');
        }

        // THE FUEL NEVER CAME OFF, as far as the tail's ledger is concerned:
        // a reversal corrects a mis-keyed entry. The ledger row is kept and
        // zeroed, with the reason, and the chain recalculated. The valuation
        // replay then shows the posting AND its mirror (reference -REV), and
        // gives the layers back - the reversal stays part of the record.
        const now = new Date().toISOString();
        const reason = req.data.reason || 'no reason given';
        const rob = await db.run(SELECT.one.from(LEDGER).where({ defuel_ID: d.ID }));
        if (rob) {
            await db.run(UPDATE(LEDGER).set({
                adjustment_kg: 0, qty_kg: 0,
                adjustment_reason: `${rob.adjustment_reason || ''} REVERSED ${now}: ${reason}`.trim(),
                modified_at: now, modified_by: 'DEFUEL_SERVICE'
            }).where({ ID: rob.ID }));
        }

        await db.run(UPDATE(DEFUELS).set({
            status: 'REVERSED',
            notes: [d.notes, `Reversed ${now}: ${reason}`]
                .filter(Boolean).join('\n')
        }).where({ ID: d.ID }));

        await recalculateTail(d.tail_number, 'DEFUEL_SERVICE', db);
        await restateStock(db, d.tail_number);

        return await db.run(SELECT.one.from(DEFUELS).where({ ID: d.ID }));
    });
});

// ===========================================================================
// DFL-<station>-YYYYMM-NNNNNN
// ===========================================================================
//
// THE SEQUENCE RESETS PER STATION PER MONTH, which is what the format asks
// for: the prefix already says which station and which month, so a number
// that ran on globally would carry that information twice and agree with
// itself only by luck.
//
// MAX + 1, NOT COUNT + 1. A deleted defuel leaves a gap, and counting rows
// would hand its number to the next one.
async function nextDefuelId(db, station, date) {
    const d = date ? new Date(date) : new Date();
    const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const prefix = `DFL-${String(station || 'XXX').toUpperCase()}-${ym}-`;
    const rows = await db.run(SELECT.from(DEFUELS).columns('defuel_id')
        .where({ defuel_id: { like: `${prefix}%` } }));
    let max = 0;
    for (const r of rows) {
        const n = parseInt(String(r.defuel_id).slice(prefix.length), 10);
        if (Number.isFinite(n) && n > max) max = n;
    }
    return `${prefix}${String(max + 1).padStart(6, '0')}`;
}

// ===========================================================================
// Where a defuel sits in the tail's ledger
// ===========================================================================
//
// AFTER THE LATEST ROW TIMED AT OR BEFORE THE DEFUEL, on the defuel's date.
// Sequence is per day on ROB_LEDGER and is the order the replay walks, so the
// defuel takes the next number and every later row that day moves up by one.
//
// BY THE CLOCK, NOT BY WALKING THE SEQUENCE. A day's times do not always rise
// with its sequence: a burn recorded on its departure date can carry 00:15
// after a 23:49 uplift, and some seeded rows are simply out of order. Walking
// the sequence and stopping at the first later time would put a defuel taken
// at 23:59 after the 00:15 burn it came before.
async function ledgerPosition(db, tail, date, time) {
    const all = await db.run(SELECT.from(LEDGER).where({ tail_number: tail }));
    const at = String(time || '23:59:59');
    const day = all.filter((r) => String(r.record_date) === String(date))
        .sort((a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0));
    let pred = null;
    for (const r of day) {
        const t = String(r.record_time || '00:00:00');
        if (t > at) continue;
        if (!pred || t >= String(pred.record_time || '00:00:00')) pred = r;
    }
    const sequence = pred ? (Number(pred.sequence) || 0) + 1 : 1;
    const next = day.find((r) => (Number(r.sequence) || 0) >= sequence) || null;
    const before = all.filter((r) => String(r.record_date) < String(date)
        || (String(r.record_date) === String(date) && (Number(r.sequence) || 0) < sequence));
    const after = all.filter((r) => !before.includes(r));
    return { sequence, pred, next, before, after };
}

/** What the replay needs beyond the ledger rows: batch names, flights, defuels, carrier. */
async function replayContext(db, tail, rows, extraDefuels = []) {
    const ticketIds = [...new Set(rows.map((r) => r.fuel_ticket_ID).filter(Boolean))];
    const flightIds = [...new Set(rows.map((r) => r.flight_ID).filter(Boolean))];
    const tickets = ticketIds.length ? await db.run(SELECT.from('fuelsphere.FUEL_TICKETS')
        .columns('ID', 'ticket_number', 'internal_number').where({ ID: { in: ticketIds } })) : [];
    const flights = flightIds.length ? await db.run(SELECT.from('fuelsphere.FLIGHT_SCHEDULE')
        .columns('ID', 'flight_number').where({ ID: { in: flightIds } })) : [];
    const defuels = await db.run(SELECT.from(DEFUELS).where({ tail_number: tail }));
    for (const x of extraDefuels) {
        const i = defuels.findIndex((y) => y.ID === x.ID);
        if (i >= 0) defuels[i] = x; else defuels.push(x);
    }
    // THE CARRIER THE TAIL'S VALUATION ALREADY CARRIES, so a restated tail
    // keeps the code the seed gave it; the ledger's own as the fallback.
    const held = await db.run(SELECT.one.from(MOVEMENTS).columns('carrier_code')
        .where({ tail_number: tail, carrier_code: { '!=': null } }));
    const code = (held && held.carrier_code) || (rows.find((r) => r.carrier_code) || {}).carrier_code || null;
    const stamp = new Date().toISOString();
    return stock.makeContext({
        flightById: new Map(flights.map((f) => [f.ID, f])),
        ticketNumberById: new Map(tickets.map((t) => [t.ID, t.ticket_number || t.internal_number])),
        carrierOf: () => code,
        defuelById: new Map(defuels.map((x) => [x.ID, x])),
        stamp, by: 'DEFUEL_SERVICE'
    });
}

// ===========================================================================
// The posting itself
// ===========================================================================
async function postToLedger(db, d, qty, pos) {
    const now = new Date().toISOString();

    // Make room: every later row that day moves up one.
    const later = await db.run(SELECT.from(LEDGER).columns('ID', 'sequence')
        .where({ tail_number: d.tail_number, record_date: d.defuel_date, sequence: { '>=': pos.sequence } }));
    for (const r of later) {
        await db.run(UPDATE(LEDGER).set({ sequence: (Number(r.sequence) || 0) + 1 }).where({ ID: r.ID }));
    }

    const opening = pos.pred ? Number(pos.pred.closing_rob_kg) || 0 : 0;
    // THE NEIGHBOUR'S OFF-BLOCK TIME, so the recalculation - which sorts on
    // flight_aobt before sequence - keeps the defuel beside the movements it
    // sits between rather than moving it to another leg of the day.
    const aobt = (pos.pred && pos.pred.flight_aobt) || (pos.next && pos.next.flight_aobt)
        || `${d.defuel_date}T${d.defuel_time || '00:00:00'}Z`;

    await db.run(INSERT.into(LEDGER).entries([{
        ID: cds.utils.uuid(),
        tail_number: d.tail_number,
        tail_registration: d.tail_number,
        carrier_code: d.carrier_code || null,
        record_date: d.defuel_date,
        record_time: d.defuel_time || '00:00:00',
        sequence: pos.sequence,
        airport_code: d.station_code || null,
        flight_ID: d.flight_ID || null,
        entry_type: 'DEFUEL',
        opening_rob_kg: opening,
        uplift_kg: 0,
        burn_kg: 0,
        adjustment_kg: -qty,
        closing_rob_kg: r2(opening - qty),
        adjustment_reason: `Defuel ${d.defuel_id} to ${d.location_code}`,
        data_source: 'DEFUEL',
        line_order: 2,
        flight_aobt: aobt,
        event_utc: `${d.defuel_date}T${d.defuel_time || '00:00:00'}Z`,
        defuel_ID: d.ID,
        created_at: now, created_by: 'DEFUEL_SERVICE',
        modified_at: now, modified_by: 'DEFUEL_SERVICE'
    }]));

    await recalculateTail(d.tail_number, 'DEFUEL_SERVICE', db);
    await restateStock(db, d.tail_number, [d]);
}

// ===========================================================================
// Replay the tail's valuation and write it back
// ===========================================================================
//
// THE WHOLE TAIL, NOT A PATCH. A defuel changes what every later burn drew, so
// the tail's movements, balances and burn headers are replaced by the replay,
// and the tanks it put fuel into are re-summed from every row that reached
// them. The rows come out of the same code that seeds them, with the same
// deterministic keys.
async function restateStock(db, tail, extraDefuels = []) {
    const rows = await db.run(SELECT.from(LEDGER).where({ tail_number: tail }));
    const ctx = await replayContext(db, tail, rows, extraDefuels);
    const r = stock.replayTail(tail, stock.movementsOf(tail, rows, ctx), ctx);

    const docs = [...ctx.defuelById.values()];
    const refs = docs.flatMap((x) => [x.defuel_id, `${x.defuel_id}-REV`]).filter(Boolean);
    const locations = [...new Set(docs.map((x) => x.location_code).filter(Boolean))];

    await db.run(DELETE.from(MOVEMENTS).where({ tail_number: tail }));
    if (refs.length) {
        await db.run(DELETE.from(MOVEMENTS).where({ tail_number: null, reference: { in: refs } }));
    }
    await db.run(DELETE.from(BALANCES).where({ tail_number: tail }));
    await db.run(DELETE.from(HEADERS).where({ tail_number: tail }));
    if (r.movements.length) await db.run(INSERT.into(MOVEMENTS).entries(r.movements));
    if (r.balances.length) await db.run(INSERT.into(BALANCES).entries(r.balances));
    if (r.burnHeaders.length) await db.run(INSERT.into(HEADERS).entries(r.burnHeaders));

    if (locations.length) {
        const inTanks = await db.run(SELECT.from(MOVEMENTS).where({ storage_location: { in: locations } }));
        await db.run(DELETE.from(BALANCES).where({ storage_location: { in: locations } }));
        const tanks = stock.storageBalances(inTanks, ctx);
        if (tanks.length) await db.run(INSERT.into(BALANCES).entries(tanks));
    }
}

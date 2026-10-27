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
const DEFUELS   = 'fuelsphere.DEFUEL';

// A defuel sorts AFTER the burns of the same instant: fuel is burned by the
// leg that was flown before what is left is taken off on stand.
const DEFUEL_LINE_ORDER = 5;

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
        const asOf = d.defuel_date
            ? `${d.defuel_date}T${d.defuel_time || '23:59:59'}Z` : null;
        const layers = (await db.run(SELECT.from(BALANCES)
            .where({ valuation_method: 'FIFO', tail_number: d.tail_number,
                     storage_location: null, balance_qty_kg: { '>': 0 } })
            .orderBy('flight_aobt', 'flight_date', 'batch_ref')))
            .filter((l) => !asOf || !l.flight_aobt
                        || String(l.flight_aobt).slice(0, 19) <= String(asOf).slice(0, 19));

        if (layers.length === 0) {
            return req.error(400, `DFL425: ${d.tail_number} held no valued stock on `
                + `${d.defuel_date}, so there is nothing to draw a defuel from. Fuel uplifted `
                + 'after that date cannot be taken off before it was loaded.', 'quantity_vol');
        }

        // ---- litres to kilograms ----------------------------------------
        //
        // THE TAIL'S WEIGHTED GRAVITY ACROSS ALL ITS OPEN LAYERS, and across
        // all of them deliberately. There is a circularity here: the mass
        // decides which layers are drawn, and the layers decide the gravity.
        // Using every open layer breaks it - the conversion no longer depends
        // on how much is taken, so it cannot chase its own tail.
        //
        // The figure reported on the document afterwards is the weighted
        // gravity of the layers ACTUALLY drawn, which is the honest answer to
        // "what was the density of the fuel that came off".
        const gTop = layers.reduce((a, l) =>
            a + Number(l.balance_qty_kg) * Number(l.specific_gravity || 0), 0);
        const gQty = layers.reduce((a, l) =>
            a + (l.specific_gravity ? Number(l.balance_qty_kg) : 0), 0);
        const tailGravity = gQty > 0 ? gTop / gQty : null;
        if (!tailGravity) {
            return req.error(400, `DFL428: no specific gravity is recorded against the fuel `
                + `on ${d.tail_number}, so ${litres} L cannot be converted to a mass. The `
                + 'ledger values kilograms, not litres.', 'quantity_l');
        }
        const qty = r3(litres * tailGravity);


        const onHand = r3(layers.reduce((s, l) => s + Number(l.balance_qty_kg || 0), 0));
        if (onHand < qty) {
            // REFUSED, NOT DRAWN NEGATIVE. A defuel larger than the stock on
            // hand would have to value fuel at a price no layer ever paid.
            return req.error(400, `DFL426: ${d.tail_number} holds ${onHand} kg and this defuel `
                + `takes ${qty} kg. A defuel cannot draw more than the aircraft is carrying.`,
                'quantity_kg');
        }

        const taken = [];
        let left = qty;
        for (const l of layers) {
            if (left <= 0) break;
            const t = r3(Math.min(left, Number(l.balance_qty_kg)));
            if (t <= 0) continue;
            taken.push({ layer: l, qty: t, rate: Number(l.rate_usd_per_kg || 0) });
            left = r3(left - t);
        }

        // ---- what the document reports ----------------------------------
        const fuelValue = r2(taken.reduce((s, t) => s + t.qty * t.rate, 0));
        // WEIGHTED, not a plain mean: 900 kg drawn from one layer and 100 kg
        // from another is not a 50/50 blend. Layers with no gravity recorded
        // are left out of both sides rather than counted as zero.
        const sgTop = taken.reduce((s, t) => s + t.qty * Number(t.layer.specific_gravity || 0), 0);
        const sgQty = taken.reduce((s, t) => s + (t.layer.specific_gravity ? t.qty : 0), 0);

        d.fuel_value_usd   = fuelValue;
        d.specific_gravity = sgQty > 0 ? Math.round((sgTop / sgQty) * 10000) / 10000
                                       : Math.round(tailGravity * 10000) / 10000;
        // KILOGRAMS ARE THE DERIVED FIGURE NOW. Litres are what was typed.
        d.quantity_kg      = qty;
        // PARKED, NOT POSTED. The fuel has moved; the money has not.
        d.status           = d.status || 'PARKED';
        d.defuel_id        = d.defuel_id || await nextDefuelId(db, d.station_code, d.defuel_date);

        await postToLedger(db, d, taken, qty);
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

        // THE MIRROR OF WHAT WAS POSTED, read back from the ledger rather
        // than recomputed. Recomputing would draw on today's layers, which
        // are not the layers the original defuel actually took from.
        const rows = await db.run(SELECT.from(MOVEMENTS).where({ reference: d.defuel_id }));
        const now = new Date().toISOString();
        const mirrored = rows.map((m, i) => ({
            ...m,
            ID: cds.utils.uuid(),
            reference: `${d.defuel_id}-REV`,
            qty_kg: -Number(m.qty_kg || 0),
            qty_l: m.qty_l == null ? null : -Number(m.qty_l),
            value_usd: m.value_usd == null ? null : -Number(m.value_usd),
            sequence: (Number(m.sequence) || 0) + 1000 + i,
            created_at: now, created_by: 'DEFUEL_SERVICE',
            modified_at: now, modified_by: 'DEFUEL_SERVICE'
        }));
        if (mirrored.length) await db.run(INSERT.into(MOVEMENTS).entries(mirrored));

        // Put the stock back where it came from.
        for (const m of rows) {
            const q = Number(m.qty_kg || 0);
            if (m.storage_location) {
                await addBalance(db, m.valuation_method, null, m.storage_location, m.batch_ref, -q, m);
            } else {
                await addBalance(db, m.valuation_method, m.tail_number, null, m.batch_ref, -q, m);
            }
        }

        await db.run(UPDATE(DEFUELS).set({
            status: 'REVERSED',
            notes: [d.notes, `Reversed ${now}: ${req.data.reason || 'no reason given'}`]
                .filter(Boolean).join('\n')
        }).where({ ID: d.ID }));

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
// The posting itself
// ===========================================================================
async function postToLedger(db, d, taken, qty) {
    const now = new Date().toISOString();
    const base = {
        carrier_code:  d.carrier_code || null,
        flight_number: d.flight_number || null,
        flight_date:   d.flight_date || null,
        // THE DEFUEL'S OWN INSTANT, in the column the replay sorts on. A
        // defuel that carried no time would sort against the burns of its
        // day by whatever the database felt like.
        flight_aobt:   d.defuel_date ? `${d.defuel_date}T${d.defuel_time || '00:00:00'}Z` : null,
        station:       d.station_code || null,
        reference:     d.defuel_id,
        line_type:     'DEFUEL',
        line_order:    DEFUEL_LINE_ORDER,
        created_at: now, created_by: 'DEFUEL_SERVICE',
        modified_at: now, modified_by: 'DEFUEL_SERVICE'
    };
    const rows = [];

    // THE SEQUENCE CONTINUES THE TAIL'S RUN, it does not restart at 1.
    // sequence is this tail's position in replay order - the seeded rows run
    // 15, 20, 21, 23 - so a defuel numbering its own rows 1..6 sorts to the
    // TOP of the tail whenever anyone orders by it, which is exactly the
    // "cannot view the entries in sequence" that was reported.
    const last = await db.run(SELECT.one.from(MOVEMENTS)
        .columns('sequence').where({ tail_number: d.tail_number })
        .orderBy({ sequence: 'desc' }));
    let seq = Number((last || {}).sequence) || 0;

    // ---- FIFO: one pair per layer touched ----------------------------
    for (const t of taken) {
        const sg = t.layer.specific_gravity ?? null;
        const litres = sg ? r2(t.qty / Number(sg)) : null;
        const value = r2(t.qty * t.rate);

        rows.push({ ...base, ID: cds.utils.uuid(), valuation_method: 'FIFO',
            tail_number: d.tail_number, storage_location: null,
            batch_ref: t.layer.batch_ref, specific_gravity: sg,
            qty_kg: -t.qty, qty_l: litres == null ? null : -litres,
            rate_usd_per_kg: t.rate, value_usd: -value, sequence: ++seq });

        // FUEL IN A TANK IS ON NO FLIGHT. The inbound half carries the tank
        // and drops the flight entirely - a storage row showing B6979 reads
        // as though the tank flew somewhere.
        rows.push({ ...base, ID: cds.utils.uuid(), valuation_method: 'FIFO',
            tail_number: null, storage_location: d.location_code,
            flight_number: null, flight_date: null,
            batch_ref: t.layer.batch_ref, specific_gravity: sg,
            qty_kg: t.qty, qty_l: litres, rate_usd_per_kg: t.rate,
            value_usd: value, sequence: ++seq });

        await addBalance(db, 'FIFO', d.tail_number, null, t.layer.batch_ref, -t.qty, t.layer);
        await addBalance(db, 'FIFO', null, d.location_code, t.layer.batch_ref, t.qty, t.layer);
    }

    // ---- MAP: one pair, at the running rate --------------------------
    //
    // THE POOL HAS ONE PRICE, so a defuel takes the rate the tail is already
    // carrying rather than any batch's. A tail with no MAP row still posts
    // under FIFO: a missing MAP pool is a gap in the seeded data, not a
    // reason to refuse an operational entry.
    const pool = await db.run(SELECT.one.from(BALANCES).where({
        valuation_method: 'MAP', tail_number: d.tail_number, storage_location: null }));
    if (pool) {
        const rate = Number(pool.rate_usd_per_kg || 0);
        const sg = pool.specific_gravity ?? d.specific_gravity ?? null;
        const litres = sg ? r2(qty / Number(sg)) : null;
        const value = r2(qty * rate);

        rows.push({ ...base, ID: cds.utils.uuid(), valuation_method: 'MAP',
            tail_number: d.tail_number, storage_location: null, batch_ref: null,
            specific_gravity: sg, qty_kg: -qty, qty_l: litres == null ? null : -litres,
            rate_usd_per_kg: rate, value_usd: -value, map_usd_per_kg: rate, sequence: ++seq });

        rows.push({ ...base, ID: cds.utils.uuid(), valuation_method: 'MAP',
            tail_number: null, storage_location: d.location_code, batch_ref: null,
            flight_number: null, flight_date: null,
            specific_gravity: sg, qty_kg: qty, qty_l: litres,
            rate_usd_per_kg: rate, value_usd: value, map_usd_per_kg: rate, sequence: ++seq });

        await addBalance(db, 'MAP', d.tail_number, null, null, -qty, pool);
        await addBalance(db, 'MAP', null, d.location_code, null, qty, pool);
    }

    if (rows.length) await db.run(INSERT.into(MOVEMENTS).entries(rows));
}

// ===========================================================================
// Move a balance, creating the row if this tank has not held this batch yet
// ===========================================================================
//
// VALUE FOLLOWS QUANTITY AT THE ROW'S OWN RATE, so a balance can never drift
// from the quantity it states. Adding and subtracting value independently
// would let rounding accumulate across a tank's whole history.
async function addBalance(db, method, tail, location, batch, deltaKg, like) {
    const where = {
        valuation_method: method,
        tail_number: tail || null,
        storage_location: location || null,
        batch_ref: batch || null
    };
    const existing = await db.run(SELECT.one.from(BALANCES).where(where));
    const rate = Number((existing || like || {}).rate_usd_per_kg || 0);
    const now = new Date().toISOString();

    if (existing) {
        const q = r3(Number(existing.balance_qty_kg || 0) + deltaKg);
        const sg = existing.specific_gravity ?? (like || {}).specific_gravity ?? null;
        await db.run(UPDATE(BALANCES).set({
            balance_qty_kg: q,
            balance_qty_l: sg ? r2(q / Number(sg)) : null,
            value_usd: r2(q * rate),
            modified_at: now, modified_by: 'DEFUEL_SERVICE'
        }).where({ ID: existing.ID }));
        return;
    }

    // A TANK THAT HAS NOT HELD THIS BATCH BEFORE. It opens carrying the
    // batch's own rate and gravity, because that is the fuel that arrived.
    const q = r3(deltaKg);
    const sg = (like || {}).specific_gravity ?? null;
    await db.run(INSERT.into(BALANCES).entries([{
        ID: cds.utils.uuid(),
        valuation_method: method,
        tail_number: tail || null,
        storage_location: location || null,
        batch_ref: batch || null,
        carrier_code: (like || {}).carrier_code || null,
        line_type: 'DEFUEL',
        station: (like || {}).station || null,
        balance_qty_kg: q,
        balance_qty_l: sg ? r2(q / Number(sg)) : null,
        specific_gravity: sg,
        rate_usd_per_kg: rate,
        value_usd: r2(q * rate),
        created_at: now, created_by: 'DEFUEL_SERVICE',
        modified_at: now, modified_by: 'DEFUEL_SERVICE'
    }]));
}

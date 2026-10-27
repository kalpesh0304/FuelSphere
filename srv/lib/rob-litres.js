/**
 * FuelSphere - the ROB ledger in litres, beside its kilograms.
 *
 * The ledger is kept in kilograms and stays that way: balances, valuation and
 * the MAP are all mass-based. The litre figures are a READ-TIME view of the
 * same rows, so they can never drift from the kilograms they are converted
 * from.
 *
 * THE DENSITY, per row, in order:
 *   1. the row's own uplift: qty_kg / volume_l, the ticket's actual density
 *   2. the same tail's latest earlier uplift - the fuel in the tanks
 *   3. 0.8 kg/L, the Jet A-1 standard density, where the tail has no
 *      uplift with a volume yet
 */
const cds = require('@sap/cds');
const { SELECT } = cds.ql;

const LEDGER = 'fuelsphere.ROB_LEDGER';
const STANDARD_DENSITY_KGL = 0.8;

const num = (v) => (v === null || v === undefined ? null : Number(v));
const litres = (kg, d) => (kg === null ? null : Number((kg / d).toFixed(2)));
const perLitre = (perKg, d) => (perKg === null ? null : Number((perKg * d).toFixed(4)));

const BASE = ['ID', 'tail_number', 'record_date', 'record_time', 'sequence', 'line_order',
              'entry_type', 'volume_l', 'qty_kg', 'opening_rob_kg', 'uplift_kg', 'burn_kg',
              'adjustment_kg', 'closing_rob_kg', 'max_capacity_kg', 'rate_usd_per_kg', 'map_usd_per_kg',
              // THE STORED BLEND, which is now what every litre figure is
              // converted at. See the note on densityFor below.
              'specific_gravity', 'wt_avg_specific_gravity', 'carrier_code'];

/** The uplift's own density, or null where it has no volume. */
function upliftDensity(r) {
    const v = num(r.volume_l), kg = num(r.qty_kg);
    if (r.entry_type !== 'UPLIFT' || !v || v <= 0 || !kg || kg <= 0) return null;
    const d = kg / v;
    return d > 0.5 && d < 1.2 ? d : null;   // outside that it is a unit mix-up, not a fuel
}

const order = (a, b) =>
    String(a.record_date).localeCompare(String(b.record_date))
    || (num(a.line_order) || 0) - (num(b.line_order) || 0)
    || String(a.record_time || '').localeCompare(String(b.record_time || ''))
    || (num(a.sequence) || 0) - (num(b.sequence) || 0);

/** The stored code, in the words the ledger shows. */
const LINE_TYPE_TEXT = {
    INITIAL: 'Opening',
    UPLIFT: 'Uplift',
    BURN: 'Block burn',
    APU_BURN: 'APU burn',
    TRANSFER: 'Transfer',
    ADJUSTMENT: 'Adjustment',
    DEFUEL: 'Defuel'
};

async function applyLedgerLitres(data) {
    const rows = (Array.isArray(data) ? data : [data]).filter(r => r && r.ID);
    if (!rows.length) return;

    // Whole tails, in ledger order, so a burn can take the density of the
    // uplift before it. Re-read: the client's $select may carry none of it.
    const own = await cds.db.run(SELECT.from(LEDGER).columns('ID', 'tail_number')
        .where({ ID: { in: rows.map(r => r.ID) } }));
    const tails = [...new Set(own.map(r => r.tail_number).filter(Boolean))];
    const all = tails.length ? await cds.db.run(SELECT.from(LEDGER).columns(...BASE)
        .where({ tail_number: { in: tails } })) : [];

    // THE WEIGHTED AVERAGE THE LEDGER ALREADY HOLDS comes first, from 2 Oct
    // 2026. It is computed once, on recalculation, as total mass over total
    // volume, so every litre figure on the screen is converted at the density
    // of what was actually in the tank rather than at the density of the last
    // uplift - which is what this file inferred before the column existed.
    //
    // The inference is kept as the fallback, for rows written before the
    // column was added and for a tail whose ledger has never been recalculated.
    const computed = new Map();
    for (const tail of tails) {
        let density = null;
        for (const r of all.filter(x => x.tail_number === tail).sort(order)) {
            const stored = num(r.wt_avg_specific_gravity);
            density = (stored && stored > 0.5 && stored < 1.2)
                ? stored
                : (upliftDensity(r) || density);
            computed.set(r.ID, { r, d: density || STANDARD_DENSITY_KGL });
        }
    }

    // THE STORED CODE, FROM THE RE-READ AND NOT FROM THE PAYLOAD.
    //
    // An after-READ handler only sees the columns the client $select'd, and
    // the ledger table shows line_type_v WITHOUT entry_type beside it - so
    // Fiori never asks for entry_type and `row.entry_type` is undefined. The
    // lookup then missed on every row and the Line type column went blank
    // across the whole table. Reported 5 Oct 2026, noticed after APU_BURN
    // arrived because that is when the column was added.
    //
    // `all` is already re-read for the whole tail and BASE carries
    // entry_type, so the code is in hand and costs no extra query.
    const typeById = new Map(all.map(r => [r.ID, r.entry_type]));

    // Litres per one unit of each carrier's volume unit.
    const codes = [...new Set(all.map(r => r.carrier_code).filter(Boolean))];
    const ratioOf = new Map();
    if (codes.length) {
        const cs = await cds.db.run(SELECT.from('fuelsphere.CARRIER_MASTER')
            .columns('carrier_code', 'reporting_volume_uom').where({ carrier_code: { in: codes } }));
        const us = await cds.db.run(SELECT.from('fuelsphere.UNIT_OF_MEASURE').columns('uom_code', 'conversion_to_ltr'));
        const lt = new Map(us.map(u => [u.uom_code, num(u.conversion_to_ltr)]));
        for (const c of cs) ratioOf.set(c.carrier_code, lt.get(c.reporting_volume_uom) || null);
    }

    for (const row of rows) {
        const entryType = typeById.has(row.ID) ? typeById.get(row.ID) : row.entry_type;
        row.line_type_v = LINE_TYPE_TEXT[entryType] || entryType || null;
        const c = computed.get(row.ID);
        if (!c) continue;
        const { r, d } = c;
        row.density_kgl        = Number(d.toFixed(4));
        row.qty_l              = litres(num(r.qty_kg), d);
        row.opening_rob_l      = litres(num(r.opening_rob_kg), d);
        row.uplift_l           = litres(num(r.uplift_kg), d);
        row.burn_l             = litres(num(r.burn_kg), d);
        row.adjustment_l       = litres(num(r.adjustment_kg), d);
        row.closing_rob_l      = litres(num(r.closing_rob_kg), d);
        row.max_capacity_l     = litres(num(r.max_capacity_kg), d);
        row.rate_usd_per_l     = perLitre(num(r.rate_usd_per_kg), d);
        row.map_usd_per_l      = perLitre(num(r.map_usd_per_kg), d);

        // THE SAME FIGURES IN THE CARRIER'S VOLUME UNIT - litres divided by
        // that unit's litre ratio, rates multiplied by it. Null where the
        // carrier is not mapped: a figure in an unknown unit is not litres.
        const k = ratioOf.get(r.carrier_code);
        const cv = (l) => (l === null || !k ? null : Number((l / k).toFixed(2)));
        row.qty_cv          = cv(row.qty_l);
        row.opening_rob_cv  = cv(row.opening_rob_l);
        row.uplift_cv       = cv(row.uplift_l);
        row.burn_cv         = cv(row.burn_l);
        row.adjustment_cv   = cv(row.adjustment_l);
        row.closing_rob_cv  = cv(row.closing_rob_l);
        row.max_capacity_cv = cv(row.max_capacity_l);
        row.rate_per_cv     = row.rate_usd_per_l === null || !k ? null : Number((row.rate_usd_per_l * k).toFixed(4));
        row.map_per_cv      = row.map_usd_per_l === null || !k ? null : Number((row.map_usd_per_l * k).toFixed(4));
    }
}

module.exports = { applyLedgerLitres, STANDARD_DENSITY_KGL };

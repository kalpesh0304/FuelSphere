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
              'adjustment_kg', 'closing_rob_kg', 'max_capacity_kg', 'rate_usd_per_kg', 'map_usd_per_kg'];

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

    const computed = new Map();
    for (const tail of tails) {
        let density = null;
        for (const r of all.filter(x => x.tail_number === tail).sort(order)) {
            density = upliftDensity(r) || density;
            computed.set(r.ID, { r, d: density || STANDARD_DENSITY_KGL });
        }
    }

    for (const row of rows) {
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
    }
}

module.exports = { applyLedgerLitres, STANDARD_DENSITY_KGL };

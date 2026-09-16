/**
 * FuelSphere - Fuel ticket measurement derivation.
 *
 * ONE IMPLEMENTATION, TWO CALLERS. A ticket can be captured through
 * TicketService (its own draft root) or added inline to a Fuel Order's draft
 * through FuelOrderService, and the derived figures must be the same figures
 * either way. Measured before this was extracted: FuelOrderService derived
 * NONE of them, so a ticket added from inside an order landed with a null
 * quantity_metered, a null quantity_kg and no amount, while the identical
 * ticket captured through the ticket app had all three. D44 is two
 * implementations of one rule disagreeing; this was the shape one step
 * worse - one implementation and one silent gap.
 *
 * PURE, AND THAT IS WHY IT RETURNS PROBLEMS RATHER THAN RAISING THEM. The
 * two services report to a request differently (one warns on its own draft,
 * the other inside the parent order's save), so the decision of what to do
 * with EPD411 belongs to the caller.
 */

const { deriveTicketMassKg } = require('./fuel-uom');

/**
 * @param {object} at  reader for the ticket's fields, merging the request's
 *                     own data over whatever is already stored - the caller
 *                     owns that merge because only it knows which row to read.
 * @returns {{values: object, error: string|null, warning: string|null}}
 */
async function deriveTicketMeasurement(at) {
    const values = {};
    let error = null, warning = null;

    // quantity_metered = meter_end - meter_start, where both are present. An
    // explicitly supplied quantity_metered is left alone; some suppliers
    // transmit a total without the two readings.
    const start = at('meter_start'), end = at('meter_end');
    if (start !== null && start !== undefined && end !== null && end !== undefined) {
        const metered = Number((Number(end) - Number(start)).toFixed(2));
        if (metered < 0) {
            return { values, warning: null,
                     error: `EPD411: Meter end ${end} is below meter start ${start}.` };
        }
        values.quantity_metered = metered;
    }

    const meteredNow = values.quantity_metered !== undefined
        ? values.quantity_metered : at('quantity_metered');

    // EPD411 - the meter reading does not match the ticket quantity. A
    // WARNING, not a rejection. Decision A1: fuel is recorded even when the
    // paperwork is imperfect; refusing the ticket would put the uplift
    // outside the system, which is the failure this area exists to prevent.
    const metered = Number(meteredNow);
    const claimed = Number(at('quantity'));
    if (metered > 0 && claimed > 0 && Math.abs(metered - claimed) > 0.01) {
        warning = `EPD411: Metered quantity ${metered} does not match ticket quantity ${claimed}.`;
    }

    // quantity_kg - EPD453. Null where an input is missing; a derived value
    // with a missing input is null, never zero.
    const mass = await deriveTicketMassKg({
        quantity_metered: meteredNow,
        uom_code: at('uom_code'),
        density_value: at('density_value'),
        density_uom: at('density_uom')
    });
    values.quantity_kg = mass.quantity_kg;

    // total_amount = rate x the quantity actually delivered. The METERED
    // figure governs where there is one - that is what the bowser delivered;
    // the claimed quantity is what the supplier wrote down, and EPD411 above
    // already says so where they disagree. Null, never zero, where an input
    // is missing: a zero would claim the fuel was free.
    const rate = at('rate_per_litre');
    const billable = (meteredNow !== null && meteredNow !== undefined) ? meteredNow : at('quantity');
    values.total_amount =
        (rate !== null && rate !== undefined && billable !== null && billable !== undefined)
            ? Number((Number(rate) * Number(billable)).toFixed(2))
            : null;

    return { values, error, warning };
}

/** Build the `at` reader: this request's data first, then the stored row. */
function fieldReader(data, stored = {}) {
    return (field) => (data[field] !== undefined ? data[field] : stored[field]);
}

// Common.FieldControlType. 7 puts the asterisk on the field and makes the
// UI refuse to save without it; 3 leaves it optional.
const MANDATORY = 7, OPTIONAL = 3;

/**
 * Mark density mandatory on the rows whose quantity is in a VOLUME unit.
 *
 * A litre figure cannot become kilograms without a density, and kilograms
 * are what the ROB ledger, the reconciliation and the invoice match all
 * read - so a litre ticket with no density is a ticket that never reaches
 * any of them. Making it mandatory ON THE SCREEN is the fix; the CAPTURE
 * PATHS STAY OPEN, because decision A1 is that fuel already in the tanks is
 * recorded even when the paperwork is imperfect, and an OCR or bulk import
 * that refused a ticket for a missing density would put the uplift outside
 * the system entirely. The screen has a person in front of it who can
 * answer; an import does not.
 *
 * ONE QUERY FOR THE WHOLE REQUEST, not one per row: a list report reads
 * hundreds of tickets and isMassUom is a database lookup.
 */
async function applyDensityFieldControl(rows, isMassUom) {
    const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
    if (!list.length) return;

    const codes = [...new Set(list.map(r => r.uom_code).filter(Boolean))];
    const mass = {};
    for (const code of codes) mass[code] = await isMassUom(code);

    for (const row of list) {
        // Unknown unit (or none yet) reads as optional rather than
        // mandatory: demanding a density for a unit nobody has classified
        // would block a screen on a data problem the operator cannot fix.
        row.densityFieldControl = (row.uom_code && mass[row.uom_code] === false)
            ? MANDATORY : OPTIONAL;
    }
}

module.exports = { deriveTicketMeasurement, fieldReader, applyDensityFieldControl };

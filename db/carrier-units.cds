namespace fuelsphere;

using { fuelsphere as db } from './schema';
using { fuelsphere.CARRIER_MASTER } from './mapping-tables';

/**
 * FuelSphere - the currency and units a carrier keeps its fuel records in.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CARRIER. A JetBlue planner reads gallons and pounds and a TAP one
 * litres and kilograms, and both read money in their company code's currency.
 * Until now every screen assumed USD, litres and kilograms - the
 * reconciliation handler wrote currency_code 'USD' on every row, and about
 * fifty ledger and valuation labels said "USD" in the label text. A TAP
 * ledger in euros therefore read as dollars.
 *
 * THE CURRENCY IS THE COMPANY CODE'S, AND NOTHING IS CONVERTED. A carrier buys
 * in the currency its ledger is kept in; the *_usd value columns hold the
 * ticket's own amount, so they are right once the label shows the carrier's
 * currency rather than the literal "USD". The columns keep their names:
 * renaming them would touch every projection and seed file that carries them.
 *
 * QUANTITIES STAY AS CAPTURED. A ticket and an invoice are in the CONTRACT's
 * unit because the vendor issues them; that figure is never overwritten. The
 * carrier's figure is DERIVED beside it, in columns of its own.
 * ---------------------------------------------------------------------------
 */

// ===========================================================================
// UNIT_OF_MEASURE - a volume ratio of its own (closes F19)
// ===========================================================================
//
// conversion_to_kg ON A GALLON IS NOT A VOLUME RATIO. It is kilograms per
// gallon at an assumed density (3.028329), and srv/lib/fuel-uom.js refuses to
// turn it into litres for exactly that reason (open point F19). Dividing it by
// the litre row's 0.8 does recover 3.785 - but only while both rows were set
// at the same density, an unstated coupling that breaks the day one is edited.
//
// So the volume ratio is a master-data fact in its own column, exact by
// definition: 1 US gallon = 3.785411784 litres. Null on a mass unit - a mass
// has no litre ratio without a density, and a density is measured, not stored
// here.
extend db.UNIT_OF_MEASURE with {
    conversion_to_ltr : Decimal(15,9);   // litres per one unit; VOLUME units only
}

// ===========================================================================
// CARRIER_MASTER - the company code's currency, volume unit and mass unit
// ===========================================================================
//
// CODES, NOT MANAGED ASSOCIATIONS, so the columns are named what they are
// (currency_code, not currency_currency_code) and a seed file reads plainly.
// The unmanaged associations beside them give the screens a value help and a
// navigation without adding a column.
extend CARRIER_MASTER with {
    currency_code    : String(3);    // ISO 4217 - the company code's currency
    volume_uom_code  : String(3);    // UNIT_OF_MEASURE, category VOLUME
    mass_uom_code    : String(3);    // UNIT_OF_MEASURE, category MASS

    currency   : Association to db.CURRENCY_MASTER on currency.currency_code = currency_code;
    volume_uom : Association to db.UNIT_OF_MEASURE on volume_uom.uom_code = volume_uom_code;
    mass_uom   : Association to db.UNIT_OF_MEASURE on mass_uom.uom_code = mass_uom_code;
}

// ===========================================================================
// MASTER_CONTRACTS - the unit the vendor prices, tickets and invoices in
// ===========================================================================
//
// Every contract in the seed prices per litre today, so LTR is both the
// default and the backfill. A contract in gallons is now expressible, and a
// ticket captured against it defaults to gallons.
extend db.MASTER_CONTRACTS with {
    uom_code : String(3) default 'LTR';
}

namespace fuelsphere;

using { fuelsphere as db } from './schema';
using { fuelsphere.CARRIER_MASTER } from './mapping-tables';
using { fuelsphere as exc } from './exception-reports';
using { fuelsphere as ub } from './unbilled-tickets';

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

// ===========================================================================
// THE CARRIER ON EVERY FUEL RECORD, AND ITS FIGURES IN THE CARRIER'S UNITS
// ===========================================================================
//
// carrier_code IS STORED, not resolved on read. A record must keep the
// carrier it was written for, and several rows have no flight to resolve one
// through (a maintenance uplift, a tail-only ticket, a ledger opening). It is
// filled at write by one database-level hook (srv/lib/carrier-units.js), so
// every writer - handlers, imports, bulk inserts - is covered without each
// remembering to.
//
// THE CONVERTED FIGURES ARE CALCULATED ON READ, and the captured ones are
// never overwritten. <name>_cm is a mass in the carrier's mass unit, <name>_cv
// a volume in its volume unit; both are computed in SQL, so they filter and
// sort (D52 - a virtual element cannot). A row with no carrier, or no density
// where one is needed, reads NULL, never zero.
//
// A FIELD IN THE ROW'S OWN UNIT (ordered_quantity, delivered_quantity,
// quantity) converts by that unit's litre ratio; a gauge-derived delivery in
// KG needs the row's density to become a volume. FLIGHT_SCHEDULE already
// carries airline_code, so it gains only the association.
//
// THE VALUATION ENTITIES ARE NOT EXTENDED HERE. fifo-valuation-harness EXIT-6
// asserts they carry no association at all; their carrier figures are added on
// the ValuationService projections instead.

extend db.FUEL_ORDERS with {
    carrier_code : String(3);   // filled at write by srv/lib/carrier-units.js
    carrier : Association to CARRIER_MASTER on carrier.carrier_code = carrier_code;
    // The carrier's units as scalars on this row, so @Measures can point at a
    // field of the same entity rather than a path whose target a service
    // may not expose (D47).
    carrier_currency   : String(3) = carrier.currency_code;
    carrier_volume_uom : String(3) = carrier.volume_uom_code;
    carrier_mass_uom   : String(3) = carrier.mass_uom_code;
    quantity_uom : Association to db.UNIT_OF_MEASURE on quantity_uom.uom_code = uom_code;
    ordered_quantity_cm : Decimal(15,2) = cast(ordered_quantity_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    planned_quantity_cm : Decimal(15,2) = cast(planned_quantity_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    ordered_quantity_cv : Decimal(15,2) = case when quantity_uom.conversion_to_ltr is not null then cast(ordered_quantity * quantity_uom.conversion_to_ltr / carrier.volume_uom.conversion_to_ltr as Decimal(15,2)) when quantity_uom.uom_category = 'MASS' and conversion_density > 0 then cast(ordered_quantity * quantity_uom.conversion_to_kg / conversion_density / carrier.volume_uom.conversion_to_ltr as Decimal(15,2)) end;
    crew_adjusted_quantity_cv : Decimal(15,2) = case when quantity_uom.conversion_to_ltr is not null then cast(crew_adjusted_quantity * quantity_uom.conversion_to_ltr / carrier.volume_uom.conversion_to_ltr as Decimal(15,2)) when quantity_uom.uom_category = 'MASS' and conversion_density > 0 then cast(crew_adjusted_quantity * quantity_uom.conversion_to_kg / conversion_density / carrier.volume_uom.conversion_to_ltr as Decimal(15,2)) end;
}

extend db.FUEL_DELIVERIES with {
    carrier_code : String(3);   // filled at write by srv/lib/carrier-units.js
    carrier : Association to CARRIER_MASTER on carrier.carrier_code = carrier_code;
    // The carrier's units as scalars on this row, so @Measures can point at a
    // field of the same entity rather than a path whose target a service
    // may not expose (D47).
    carrier_currency   : String(3) = carrier.currency_code;
    carrier_volume_uom : String(3) = carrier.volume_uom_code;
    carrier_mass_uom   : String(3) = carrier.mass_uom_code;
    quantity_uom : Association to db.UNIT_OF_MEASURE on quantity_uom.uom_code = uom_code;
    fob_at_arrival_cm : Decimal(15,2) = cast(fob_at_arrival_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    fob_before_cm : Decimal(15,2) = cast(fob_before_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    fob_after_cm : Decimal(15,2) = cast(fob_after_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    fob_delta_cm : Decimal(15,2) = cast(fob_delta_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    ground_burn_cm : Decimal(15,2) = cast(ground_burn_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    recon_variance_cm : Decimal(15,2) = cast(recon_variance_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    flight_variance_cm : Decimal(15,2) = cast(flight_variance_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    flight_metered_cm : Decimal(15,2) = cast(flight_metered_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    flight_delivered_cm : Decimal(15,2) = cast(flight_delivered_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    flight_tolerance_cm : Decimal(15,2) = cast(flight_tolerance_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    delivered_quantity_cv : Decimal(15,2) = case when quantity_uom.conversion_to_ltr is not null then cast(delivered_quantity * quantity_uom.conversion_to_ltr / carrier.volume_uom.conversion_to_ltr as Decimal(15,2)) when quantity_uom.uom_category = 'MASS' and density > 0 then cast(delivered_quantity * quantity_uom.conversion_to_kg / density / carrier.volume_uom.conversion_to_ltr as Decimal(15,2)) end;
    temperature_corrected_qty_cv : Decimal(15,2) = case when quantity_uom.conversion_to_ltr is not null then cast(temperature_corrected_qty * quantity_uom.conversion_to_ltr / carrier.volume_uom.conversion_to_ltr as Decimal(15,2)) when quantity_uom.uom_category = 'MASS' and density > 0 then cast(temperature_corrected_qty * quantity_uom.conversion_to_kg / density / carrier.volume_uom.conversion_to_ltr as Decimal(15,2)) end;
    quantity_variance_cv : Decimal(15,2) = case when quantity_uom.conversion_to_ltr is not null then cast(quantity_variance * quantity_uom.conversion_to_ltr / carrier.volume_uom.conversion_to_ltr as Decimal(15,2)) when quantity_uom.uom_category = 'MASS' and density > 0 then cast(quantity_variance * quantity_uom.conversion_to_kg / density / carrier.volume_uom.conversion_to_ltr as Decimal(15,2)) end;
}

extend db.FUEL_TICKETS with {
    carrier_code : String(3);   // filled at write by srv/lib/carrier-units.js
    carrier : Association to CARRIER_MASTER on carrier.carrier_code = carrier_code;
    // The carrier's units as scalars on this row, so @Measures can point at a
    // field of the same entity rather than a path whose target a service
    // may not expose (D47).
    carrier_currency   : String(3) = carrier.currency_code;
    carrier_volume_uom : String(3) = carrier.volume_uom_code;
    carrier_mass_uom   : String(3) = carrier.mass_uom_code;
    quantity_uom : Association to db.UNIT_OF_MEASURE on quantity_uom.uom_code = uom_code;
    quantity_cm : Decimal(15,2) = cast(quantity_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    quantity_cv : Decimal(15,2) = case when quantity_uom.conversion_to_ltr is not null then cast(quantity * quantity_uom.conversion_to_ltr / carrier.volume_uom.conversion_to_ltr as Decimal(15,2)) when quantity_uom.uom_category = 'MASS' and density_value > 0 then cast(quantity * quantity_uom.conversion_to_kg / density_value / carrier.volume_uom.conversion_to_ltr as Decimal(15,2)) end;
    quantity_metered_cv : Decimal(15,2) = case when quantity_uom.conversion_to_ltr is not null then cast(quantity_metered * quantity_uom.conversion_to_ltr / carrier.volume_uom.conversion_to_ltr as Decimal(15,2)) when quantity_uom.uom_category = 'MASS' and density_value > 0 then cast(quantity_metered * quantity_uom.conversion_to_kg / density_value / carrier.volume_uom.conversion_to_ltr as Decimal(15,2)) end;
}

extend db.INVOICE_ITEMS with {
    carrier_code : String(3);   // filled at write by srv/lib/carrier-units.js
    carrier : Association to CARRIER_MASTER on carrier.carrier_code = carrier_code;
    // The carrier's units as scalars on this row, so @Measures can point at a
    // field of the same entity rather than a path whose target a service
    // may not expose (D47).
    carrier_currency   : String(3) = carrier.currency_code;
    carrier_volume_uom : String(3) = carrier.volume_uom_code;
    carrier_mass_uom   : String(3) = carrier.mass_uom_code;
    quantity_uom : Association to db.UNIT_OF_MEASURE on quantity_uom.uom_code = uom_code;
    ticket_quantity_cm : Decimal(15,2) = cast(ticket_quantity_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    quantity_cv : Decimal(15,2) = case when quantity_uom.conversion_to_ltr is not null then cast(quantity * quantity_uom.conversion_to_ltr / carrier.volume_uom.conversion_to_ltr as Decimal(15,2)) end;
}

extend db.FUEL_BURNS with {
    carrier_code : String(3);   // filled at write by srv/lib/carrier-units.js
    carrier : Association to CARRIER_MASTER on carrier.carrier_code = carrier_code;
    // The carrier's units as scalars on this row, so @Measures can point at a
    // field of the same entity rather than a path whose target a service
    // may not expose (D47).
    carrier_currency   : String(3) = carrier.currency_code;
    carrier_volume_uom : String(3) = carrier.volume_uom_code;
    carrier_mass_uom   : String(3) = carrier.mass_uom_code;
    planned_burn_cm : Decimal(15,2) = cast(planned_burn_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    actual_burn_cm : Decimal(15,2) = cast(actual_burn_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    taxi_out_cm : Decimal(15,2) = cast(taxi_out_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    taxi_in_cm : Decimal(15,2) = cast(taxi_in_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    trip_fuel_cm : Decimal(15,2) = cast(trip_fuel_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    apu_burn_cm : Decimal(15,2) = cast(apu_burn_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    engine_burn_cm : Decimal(15,2) = cast(engine_burn_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    variance_cm : Decimal(15,2) = cast(variance_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
}

extend db.ROB_LEDGER with {
    carrier_code : String(3);   // filled at write by srv/lib/carrier-units.js
    carrier : Association to CARRIER_MASTER on carrier.carrier_code = carrier_code;
    // The carrier's units as scalars on this row, so @Measures can point at a
    // field of the same entity rather than a path whose target a service
    // may not expose (D47).
    carrier_currency   : String(3) = carrier.currency_code;
    carrier_volume_uom : String(3) = carrier.volume_uom_code;
    carrier_mass_uom   : String(3) = carrier.mass_uom_code;
    opening_rob_cm : Decimal(15,2) = cast(opening_rob_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    uplift_cm : Decimal(15,2) = cast(uplift_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    burn_cm : Decimal(15,2) = cast(burn_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    adjustment_cm : Decimal(15,2) = cast(adjustment_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    closing_rob_cm : Decimal(15,2) = cast(closing_rob_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    max_capacity_cm : Decimal(15,2) = cast(max_capacity_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    qty_cm : Decimal(15,2) = cast(qty_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    unallocated_fuel_cm : Decimal(15,2) = cast(unallocated_fuel_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    volume_cv : Decimal(15,2) = cast(volume_l / carrier.volume_uom.conversion_to_ltr as Decimal(15,2));
    rate_per_cm : Decimal(15,4) = cast(rate_usd_per_kg * carrier.mass_uom.conversion_to_kg as Decimal(15,4));
    map_per_cm : Decimal(15,4) = cast(map_usd_per_kg * carrier.mass_uom.conversion_to_kg as Decimal(15,4));
}

extend db.FLIGHT_DISPATCH with {
    carrier_code : String(3);   // filled at write by srv/lib/carrier-units.js
    carrier : Association to CARRIER_MASTER on carrier.carrier_code = carrier_code;
    // The carrier's units as scalars on this row, so @Measures can point at a
    // field of the same entity rather than a path whose target a service
    // may not expose (D47).
    carrier_currency   : String(3) = carrier.currency_code;
    carrier_volume_uom : String(3) = carrier.volume_uom_code;
    carrier_mass_uom   : String(3) = carrier.mass_uom_code;
    dispatch_qty_cm : Decimal(15,2) = cast(dispatch_qty_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    trip_fuel_cm : Decimal(15,2) = cast(trip_fuel_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    contingency_fuel_cm : Decimal(15,2) = cast(contingency_fuel_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    alternate_fuel_cm : Decimal(15,2) = cast(alternate_fuel_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    final_reserve_cm : Decimal(15,2) = cast(final_reserve_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    additional_fuel_cm : Decimal(15,2) = cast(additional_fuel_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    taxi_fuel_cm : Decimal(15,2) = cast(taxi_fuel_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    extra_fuel_cm : Decimal(15,2) = cast(extra_fuel_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    block_fuel_cm : Decimal(15,2) = cast(block_fuel_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    required_uplift_cm : Decimal(15,2) = cast(required_uplift_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    rob_departure_cm : Decimal(15,2) = cast(rob_departure_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    payload_cm : Decimal(15,2) = cast(payload_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    payload_plan_cm : Decimal(15,2) = cast(payload_plan_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    arrival_rob_plan_cm : Decimal(15,2) = cast(arrival_rob_plan_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
}

extend db.FLIGHT_SCHEDULE with {
    carrier : Association to CARRIER_MASTER on carrier.carrier_code = airline_code;
    // The carrier's units as scalars on this row, so @Measures can point at a
    // field of the same entity rather than a path whose target a service
    // may not expose (D47).
    carrier_currency   : String(3) = carrier.currency_code;
    carrier_volume_uom : String(3) = carrier.volume_uom_code;
    carrier_mass_uom   : String(3) = carrier.mass_uom_code;
    cargo_cm : Decimal(15,2) = cast(cargo_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    fob_at_out_cm : Decimal(15,2) = cast(fob_at_out_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    fob_at_off_cm : Decimal(15,2) = cast(fob_at_off_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    fob_at_on_cm : Decimal(15,2) = cast(fob_at_on_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    fob_at_in_cm : Decimal(15,2) = cast(fob_at_in_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
}

extend db.APU_USAGE with {
    carrier_code : String(3);   // filled at write by srv/lib/carrier-units.js
    carrier : Association to CARRIER_MASTER on carrier.carrier_code = carrier_code;
    // The carrier's units as scalars on this row, so @Measures can point at a
    // field of the same entity rather than a path whose target a service
    // may not expose (D47).
    carrier_currency   : String(3) = carrier.currency_code;
    carrier_volume_uom : String(3) = carrier.volume_uom_code;
    carrier_mass_uom   : String(3) = carrier.mass_uom_code;
    apu_burn_cm : Decimal(15,2) = cast(apu_burn_kg / carrier.mass_uom.conversion_to_kg as Decimal(15,2));
    burn_rate_cm_hr : Decimal(15,4) = cast(burn_rate_kg_hr * carrier.mass_uom.conversion_to_kg as Decimal(15,4));
}

// ===========================================================================
// VIEWS THAT LIST THEIR COLUMNS, given the carrier's figures too
// ===========================================================================
//
// A view that selects explicit columns never sees an element added to its
// source, so the converted figures stop at these four. Each is given exactly
// the twins of the fields it already shows, and nothing it does not.

extend exc.EXC_DELIVERIES_AWAITING_READINGS with columns {
    carrier_currency,
    carrier_volume_uom,
    carrier_mass_uom,
    fob_before_cm,
    fob_after_cm
}

extend db.FLIGHT_FUEL_DELIVERIES with columns {
    carrier_currency,
    carrier_volume_uom,
    carrier_mass_uom,
    fob_at_arrival_cm,
    fob_before_cm,
    fob_after_cm,
    fob_delta_cm,
    ground_burn_cm,
    recon_variance_cm,
    delivered_quantity_cv
}

extend db.FLIGHT_FUEL_TICKETS with columns {
    carrier_currency,
    carrier_volume_uom,
    carrier_mass_uom,
    quantity_cm,
    quantity_metered_cv
}

extend ub.UNBILLED_TICKETS with columns {
    carrier_currency,
    carrier_volume_uom,
    carrier_mass_uom,
    quantity_cm,
    quantity_metered_cv
}

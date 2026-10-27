using from '../db/carrier-units';

/**
 * FuelSphere - the carrier's figures on the projections that list columns.
 *
 * Same reason as the views at the end of db/carrier-units.cds: an explicit
 * column list never picks up an element added to its source. Each projection
 * gains the converted twin of every quantity it already shows, plus the
 * carrier's units for the @Measures annotations in
 * srv/carrier-units-annotations.cds.
 */

extend InvoiceService.FuelTickets with columns {
    carrier_currency,
    carrier_volume_uom,
    carrier_mass_uom,
    quantity_cm,
    quantity_metered_cv
}

extend PlanningService.FlightDispatches with columns {
    carrier_currency,
    carrier_volume_uom,
    carrier_mass_uom,
    dispatch_qty_cm,
    trip_fuel_cm,
    contingency_fuel_cm,
    alternate_fuel_cm,
    final_reserve_cm,
    additional_fuel_cm,
    taxi_fuel_cm,
    extra_fuel_cm,
    block_fuel_cm,
    required_uplift_cm,
    rob_departure_cm
}

extend PlanningService.FuelOrders with columns {
    carrier_currency,
    carrier_volume_uom,
    carrier_mass_uom,
    ordered_quantity_cv
}

extend TicketService.TicketInvoiceLines with columns {
    carrier_currency,
    carrier_volume_uom,
    carrier_mass_uom,
    quantity_cv
}

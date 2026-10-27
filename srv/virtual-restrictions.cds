/**
 * FuelSphere - every computed property, withheld from filter and sort.
 *
 * A VIRTUAL ELEMENT HAS NO DATABASE COLUMN. $filter and $orderby are both
 * pushed down to the database, so either one naming a virtual produces
 * "Virtual elements are not allowed in expressions" and the request comes
 * back 500. The property reads perfectly well - it is computed in an
 * after-READ handler - it simply cannot sit in a WHERE or an ORDER BY.
 *
 * WHY THE WHOLE SURFACE AT ONCE, 2 Oct 2026. The brief asked for a filter in
 * every column-header menu, and the manifest sweep that delivered it set
 * personalization { column, sort, filter } on every list report in the
 * landscape. That menu offers sort and filter on every column it can see,
 * computed ones included. The hazard is not new - its REACHABILITY is. It
 * went from a hand-built URL to two clicks, so the declaration that was
 * being made one entity at a time as somebody hit it (ROBLedger, FuelTickets,
 * FlightSchedule) now has to cover the rest before a user finds them.
 *
 * NOTHING THAT WORKS TODAY IS WITHDRAWN: no virtual appears in any
 * UI.SelectionFields anywhere in the model, verified before this was
 * written, so no filter bar loses a field. What changes is that the
 * column-header menu stops offering an operation that would fail.
 *
 * GENERATED AND REGENERABLE, which is the only honest way to hold ~150
 * properties in step with the handlers that compute them.
 * REGENERATING: DELETE THIS FILE FIRST. The generator skips any entity that
 * already declares the term, which on a re-run means every entity in here -
 * it would then write a file covering nothing and every column-header filter
 * would silently become a 500 again. The sweep harness catches that, but only
 * if it is run.
 *
 * test/harness/virtual-filter-sweep-harness.js fails when a virtual is added
 * without being listed here, so the next one is caught at the harness rather
 * than by a person with a filter dialog open.
 */

using BurnService from './burn-service';
using DeliveryService from './delivery-service';
using ExceptionService from './exception-service';
using FuelOrderService from './order-service';
using InvoiceService from './invoice-service';
using MasterDataService from './master-data-service';
using RefuelerService from './refueler-service';

// ==========================================================================
// BurnService
// ==========================================================================

annotate BurnService.FuelBurns with @(
    Capabilities.FilterRestrictions.NonFilterableProperties: [
        actual_delta_kg, apu_burn_sum_kg, apu_burn_value_usd, apu_hours,
        apu_rate_kg_hr, arrival_airport_v, arrival_rob_kg, block_burn_kg,
        block_burn_value_usd, block_burn_variance_kg,
        block_burn_variance_pct, block_burn_variance_status, carbon_basis_v,
        carbon_emission_kg, co2_factor_v, departure_airport_v, dispatch_kg,
        engine_burn_split_kg, engine_burn_value_usd, expected_delta_kg,
        flight_date_v, fqis_in_kg, fqis_out_kg, map_usd_per_kg,
        planned_block_burn_kg, sector, specific_gravity, total_burn_kg,
        total_burn_value_usd, unallocated_fuel_kg, uplift_l,
        uplift_value_usd,
        // ADDED 27 Oct 2026: the same figures in the carrier's units
        // (srv/lib/carrier-units.js applyCarrierUnits), filled on read.
        dispatch_cm, fqis_out_cm, fqis_in_cm, expected_delta_cm,
        actual_delta_cm, block_burn_cm, apu_burn_sum_cm, total_burn_cm,
        engine_burn_split_cm, arrival_rob_cm, unallocated_fuel_cm,
        planned_block_burn_cm, block_burn_variance_cm, uplift_cv, map_per_cm,
        apu_rate_cm_hr
    ],
    Capabilities.SortRestrictions.NonSortableProperties: [
        actual_delta_kg, apu_burn_sum_kg, apu_burn_value_usd, apu_hours,
        apu_rate_kg_hr, arrival_airport_v, arrival_rob_kg, block_burn_kg,
        block_burn_value_usd, block_burn_variance_kg,
        block_burn_variance_pct, block_burn_variance_status, carbon_basis_v,
        carbon_emission_kg, co2_factor_v, departure_airport_v, dispatch_kg,
        engine_burn_split_kg, engine_burn_value_usd, expected_delta_kg,
        flight_date_v, fqis_in_kg, fqis_out_kg, map_usd_per_kg,
        planned_block_burn_kg, sector, specific_gravity, total_burn_kg,
        total_burn_value_usd, unallocated_fuel_kg, uplift_l,
        uplift_value_usd,
        // ADDED 27 Oct 2026: the same figures in the carrier's units
        // (srv/lib/carrier-units.js applyCarrierUnits), filled on read.
        dispatch_cm, fqis_out_cm, fqis_in_cm, expected_delta_cm,
        actual_delta_cm, block_burn_cm, apu_burn_sum_cm, total_burn_cm,
        engine_burn_split_cm, arrival_rob_cm, unallocated_fuel_cm,
        planned_block_burn_cm, block_burn_variance_cm, uplift_cv, map_per_cm,
        apu_rate_cm_hr
    ]
);

// ==========================================================================
// DeliveryService
// ==========================================================================

annotate DeliveryService.FuelDeliveries with @(
    Capabilities.FilterRestrictions.NonFilterableProperties: [
        statusCriticality, varianceCriticality
    ],
    Capabilities.SortRestrictions.NonSortableProperties: [
        statusCriticality, varianceCriticality
    ]
);

// ==========================================================================
// ExceptionService
// ==========================================================================

annotate ExceptionService.DeliveriesAwaitingReadings with @(
    Capabilities.FilterRestrictions.NonFilterableProperties: [
        days_open, missing_what, sector
    ],
    Capabilities.SortRestrictions.NonSortableProperties: [
        days_open, missing_what, sector
    ]
);

annotate ExceptionService.DeliveryVariances with @(
    Capabilities.FilterRestrictions.NonFilterableProperties: [
        sector
    ],
    Capabilities.SortRestrictions.NonSortableProperties: [
        sector
    ]
);

annotate ExceptionService.FlightCompleteness with @(
    Capabilities.FilterRestrictions.NonFilterableProperties: [
        sector
    ],
    Capabilities.SortRestrictions.NonSortableProperties: [
        sector
    ]
);

annotate ExceptionService.UninvoicedTickets with @(
    Capabilities.FilterRestrictions.NonFilterableProperties: [
        days_open, sector
    ],
    Capabilities.SortRestrictions.NonSortableProperties: [
        days_open, sector
    ]
);

// ==========================================================================
// FuelOrderService
// ==========================================================================

annotate FuelOrderService.FuelDeliveries with @(
    Capabilities.FilterRestrictions.NonFilterableProperties: [
        statusCriticality, varianceCriticality
    ],
    Capabilities.SortRestrictions.NonSortableProperties: [
        statusCriticality, varianceCriticality
    ]
);

annotate FuelOrderService.FuelOrders with @(
    Capabilities.FilterRestrictions.NonFilterableProperties: [
        canSubmit, priorityCriticality, statusCriticality
    ],
    Capabilities.SortRestrictions.NonSortableProperties: [
        canSubmit, priorityCriticality, statusCriticality
    ]
);

annotate FuelOrderService.FuelTickets with @(
    Capabilities.FilterRestrictions.NonFilterableProperties: [
        densityFieldControl
    ],
    Capabilities.SortRestrictions.NonSortableProperties: [
        densityFieldControl
    ]
);

// ==========================================================================
// InvoiceService
// ==========================================================================

annotate InvoiceService.IdrRuleStatus with @(
    Capabilities.FilterRestrictions.NonFilterableProperties: [
        check_name_v
    ],
    Capabilities.SortRestrictions.NonSortableProperties: [
        check_name_v
    ]
);

annotate InvoiceService.InvoiceItems with @(
    Capabilities.FilterRestrictions.NonFilterableProperties: [
        arr_airport, currency_v, dep_airport, flight_date_v,
        flight_number_v, flight_status_v, inv_qty_ltr, inv_rate_ltr,
        invoice_status_v, payment_date_v, posting_date_v, price_variance,
        qty_variance_ltr, received_date_v, s4_document_number_v,
        s4_payment_document_v, sap_invoice_number_v, ticket_qty_ltr,
        ticket_rate_ltr, tolerance_breach, tolerance_v, total_variance,
        vendor_invoice_number
    ],
    Capabilities.SortRestrictions.NonSortableProperties: [
        arr_airport, currency_v, dep_airport, flight_date_v,
        flight_number_v, flight_status_v, inv_qty_ltr, inv_rate_ltr,
        invoice_status_v, payment_date_v, posting_date_v, price_variance,
        qty_variance_ltr, received_date_v, s4_document_number_v,
        s4_payment_document_v, sap_invoice_number_v, ticket_qty_ltr,
        ticket_rate_ltr, tolerance_breach, tolerance_v, total_variance,
        vendor_invoice_number
    ]
);

annotate InvoiceService.Invoices with @(
    Capabilities.FilterRestrictions.NonFilterableProperties: [
        arr_airport, dep_airport, derived_gross, derived_net, derived_tax,
        entered_gross_v, entered_net_v, entered_tax_v, flight_date_v,
        flight_number_v, flight_status_v, gross_difference,
        invoice_status_v, net_difference, qty_variance_ltr, received_date_v,
        reconciled_lines, tolerance_v, total_inv_amount, total_inv_qty_ltr,
        total_lines, total_tkt_amount, total_tkt_qty_ltr,
        unreconciled_lines, variance_value, wavg_inv_rate, wavg_tkt_rate
    ],
    Capabilities.SortRestrictions.NonSortableProperties: [
        arr_airport, dep_airport, derived_gross, derived_net, derived_tax,
        entered_gross_v, entered_net_v, entered_tax_v, flight_date_v,
        flight_number_v, flight_status_v, gross_difference,
        invoice_status_v, net_difference, qty_variance_ltr, received_date_v,
        reconciled_lines, tolerance_v, total_inv_amount, total_inv_qty_ltr,
        total_lines, total_tkt_amount, total_tkt_qty_ltr,
        unreconciled_lines, variance_value, wavg_inv_rate, wavg_tkt_rate
    ]
);

annotate InvoiceService.UnbilledTickets with @(
    Capabilities.FilterRestrictions.NonFilterableProperties: [
        age_days
    ],
    Capabilities.SortRestrictions.NonSortableProperties: [
        age_days
    ]
);

// ADDED 27 Oct 2026 with the defuel merge: age_days is filled after READ
// (srv/invoice-service.js), the same pattern as UnbilledTickets above.
annotate InvoiceService.ExpectedCredits with @(
    Capabilities.FilterRestrictions.NonFilterableProperties: [
        age_days
    ],
    Capabilities.SortRestrictions.NonSortableProperties: [
        age_days
    ]
);

// ==========================================================================
// MasterDataService
// ==========================================================================

annotate MasterDataService.Aircraft with @(
    Capabilities.FilterRestrictions.NonFilterableProperties: [
        activeCriticality
    ],
    Capabilities.SortRestrictions.NonSortableProperties: [
        activeCriticality
    ]
);

annotate MasterDataService.AircraftRegistrations with @(
    Capabilities.FilterRestrictions.NonFilterableProperties: [
        activeCriticality
    ],
    Capabilities.SortRestrictions.NonSortableProperties: [
        activeCriticality
    ]
);

annotate MasterDataService.Airports with @(
    Capabilities.FilterRestrictions.NonFilterableProperties: [
        activeCriticality
    ],
    Capabilities.SortRestrictions.NonSortableProperties: [
        activeCriticality
    ]
);

annotate MasterDataService.Contracts with @(
    Capabilities.FilterRestrictions.NonFilterableProperties: [
        activeCriticality
    ],
    Capabilities.SortRestrictions.NonSortableProperties: [
        activeCriticality
    ]
);

annotate MasterDataService.Manufacturers with @(
    Capabilities.FilterRestrictions.NonFilterableProperties: [
        activeCriticality
    ],
    Capabilities.SortRestrictions.NonSortableProperties: [
        activeCriticality
    ]
);

annotate MasterDataService.Products with @(
    Capabilities.FilterRestrictions.NonFilterableProperties: [
        activeCriticality
    ],
    Capabilities.SortRestrictions.NonSortableProperties: [
        activeCriticality
    ]
);

annotate MasterDataService.Routes with @(
    Capabilities.FilterRestrictions.NonFilterableProperties: [
        activeCriticality
    ],
    Capabilities.SortRestrictions.NonSortableProperties: [
        activeCriticality
    ]
);

annotate MasterDataService.Suppliers with @(
    Capabilities.FilterRestrictions.NonFilterableProperties: [
        activeCriticality
    ],
    Capabilities.SortRestrictions.NonSortableProperties: [
        activeCriticality
    ]
);

// ==========================================================================
// RefuelerService
// ==========================================================================

annotate RefuelerService.DeliveryRecords with @(
    Capabilities.FilterRestrictions.NonFilterableProperties: [
        statusCriticality
    ],
    Capabilities.SortRestrictions.NonSortableProperties: [
        statusCriticality
    ]
);

annotate RefuelerService.SalesOrders with @(
    Capabilities.FilterRestrictions.NonFilterableProperties: [
        statusCriticality
    ],
    Capabilities.SortRestrictions.NonSortableProperties: [
        statusCriticality
    ]
);

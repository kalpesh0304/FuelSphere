/**
 * FuelSphere - Delivery Service
 *
 * Standalone service for independent Fuel Delivery (ePOD) management.
 * Allows creating/managing deliveries outside the FuelOrders draft flow -
 * the TicketService equivalent for ePOD records.
 *
 * Service Path: /odata/v4/deliveries
 */

using { fuelsphere as db } from '../db/schema';

@path: '/odata/v4/deliveries'
service DeliveryService {

    // ========================================================================
    // FUEL DELIVERIES - Independent Management
    // ========================================================================

    /**
     * FuelDeliveries - Standalone Fuel Delivery Entity
     * Draft-enabled for independent delivery management
     *
     * order stays OPTIONAL here, unlike TicketService.FuelTickets.order -
     * decision B2 in db/schema.cds: a delivery hangs off the AIRCRAFT, not a
     * single order, because one refuelling event can involve two suppliers
     * (two orders) but only one delivery. The multi-order case is captured
     * through the tickets attached to this delivery (each ticket carries its
     * own order), never through a field here.
     *
     * The user selects Aircraft/Tail first (aircraft_reg is @mandatory on
     * the base entity). Order is an optional F4 pick alongside it - if
     * chosen, flight/UOM auto-populate from it via the same SideEffects
     * pattern TicketService uses, and delivery_number is generated from the
     * resolved flight rather than the tail. If left blank, delivery_number
     * falls back to tail-based numbering (delivery-service.js).
     */
    @odata.draft.enabled
    entity FuelDeliveries as projection on db.FUEL_DELIVERIES {
        *,
        order  : redirected to FuelOrders,
        flight : redirected to FlightSchedule,
        // Coalesced - see the note on FuelOrderService.FuelDeliveries.
        coalesce(flight.flight_number, order.flight.flight_number) as flight_number : String(10),
        tail   : redirected to AircraftRegistrations,
        virtual null as statusCriticality   : Integer,
        virtual null as varianceCriticality : Integer
    } actions {
        /**
         * Verify delivery quantities
         * Calculates variance and sets flag if > 5%
         */
        action verifyQuantity() returns FuelDeliveries;

        /**
         * Dispute delivery
         * Transitions: Pending/Verified → Disputed
         */
        action dispute(reason: String) returns FuelDeliveries;
    };

    // ========================================================================
    // REFERENCE DATA (Read-only)
    // ========================================================================

    @readonly
    entity FuelOrders as projection on db.FUEL_ORDERS {
        *,
        airport  : redirected to Airports,
        supplier : redirected to Suppliers,
        // FUEL_ORDERS carries only the flight ASSOCIATION, never a flight
        // number of its own. The order F4 has been asking for this column
        // since it was written and rendering it empty - D50 could not see it
        // because a stale service count aborted the sweep before it ran.
        flight.flight_number as flight_number
    };

    @readonly
    entity Airports as projection on db.MASTER_AIRPORTS;

    @readonly
    entity Suppliers as projection on db.MASTER_SUPPLIERS;

    // Value-help target for the flight F4 - the alternative to picking an
    // order, and the other way to identify the aircraft.
    @readonly
    entity FlightSchedule as projection on db.FLIGHT_SCHEDULE;

    // Nav target for `tail`; aircraft_reg itself is derived, not picked.
    @readonly
    entity AircraftRegistrations as projection on db.AIRCRAFT_REGISTRATIONS;

    // Value-help target for uom_code's F4.
    @readonly
    entity UnitsOfMeasure as projection on db.UNIT_OF_MEASURE;

    // ========================================================================
    // SERVICE-LEVEL FUNCTIONS
    // ========================================================================

    /**
     * Generate next delivery number for a station
     * Format: EPD-{STATION}-{YYYYMMDD}-{SEQ}
     */
    function generateDeliveryNumber(stationCode: String, deliveryDate: Date) returns String;

    /**
     * Get deliveries by order
     */
    function getDeliveriesByOrder(orderId: UUID) returns array of FuelDeliveries;
}

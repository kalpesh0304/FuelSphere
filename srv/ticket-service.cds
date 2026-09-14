/**
 * FuelSphere - Ticket Service
 *
 * Standalone service for independent Fuel Ticket management
 * Allows creating/managing tickets outside the FuelOrders draft flow
 *
 * Service Path: /odata/v4/tickets
 */

using { fuelsphere as db } from '../db/schema';

@path: '/odata/v4/tickets'
service TicketService {

    // ========================================================================
    // FUEL TICKETS - Independent Management
    // ========================================================================

    /**
     * FuelTickets - Standalone Fuel Ticket Entity
     * Draft-enabled for independent ticket management
     */
    @odata.draft.enabled
    entity FuelTickets as projection on db.FUEL_TICKETS {
        *,
        order    : redirected to FuelOrders,
        delivery : redirected to FuelDeliveries,
        virtual null as statusCriticality : Integer
    } actions {
        /**
         * Attach ticket to delivery
         */
        action attachToDelivery(deliveryId: UUID) returns FuelTickets;

        /**
         * Attach an unmatched ticket to an order - the matching workbench.
         * Allocates the internal number if the ticket was captured without one.
         */
        action attachToOrder(orderId: UUID) returns FuelTickets;

        /**
         * Verify ticket
         */
        action verify() returns FuelTickets;

        /**
         * Reject ticket
         */
        action reject(reason: String) returns FuelTickets;
    };

    // ========================================================================
    // REFERENCE DATA (Read-only)
    // ========================================================================

    @readonly
    entity FuelOrders as projection on db.FUEL_ORDERS {
        *,
        airport  : redirected to Airports,
        supplier : redirected to Suppliers
    };

    @readonly
    entity FuelDeliveries as projection on db.FUEL_DELIVERIES {
        *,
        order : redirected to FuelOrders
    };

    @readonly
    entity Airports as projection on db.MASTER_AIRPORTS;

    @readonly
    entity Suppliers as projection on db.MASTER_SUPPLIERS;

    // ========================================================================
    // SERVICE-LEVEL FUNCTIONS
    // ========================================================================

    /**
     * Generate next ticket number for a station
     * Format: FT-{STATION}-{YYYYMMDD}-{SEQ}
     */
    function generateTicketNumber(stationCode: String, ticketDate: Date) returns String;

    /**
     * Get tickets by order
     */
    function getTicketsByOrder(orderId: UUID) returns array of FuelTickets;

    /**
     * Get unattached tickets (not linked to any delivery)
     */
    function getUnattachedTickets(stationCode: String) returns array of FuelTickets;

    /**
     * Capture a supplier's fuel ticket against an order.
     *
     * THE ONE WRITER. FuelOrderService.FuelOrders offers a bound form of this
     * so a clerk can raise a ticket from the order they are looking at; that
     * handler delegates here and writes nothing itself. D44 is two independent
     * implementations of one rule disagreeing one day with nothing to notice.
     *
     * NO GATE - DECISION A1. The fuel is already in the tanks when a ticket is
     * written, so capture is never blocked. That is the opposite of order
     * creation, which refuses on MDM402 for a provisional registration. A
     * ticket with no order at all is legitimate and seeded (5 of 30), so this
     * is the DEMO path rather than the only one, and `getUnattachedTickets`
     * already serves the other.
     *
     * SEVEN TYPED, AND density_uom IS THE EIGHTH BECAUSE THE MASS DERIVATION
     * CANNOT RUN WITHOUT IT. `deriveTicketMassKg` returns null with the reason
     * "no density_uom, so density_value has no meaning" on any VOLUME ticket -
     * and uom_code defaults to LTR, so the default ticket is a volume ticket.
     * 14 of 30 seeded tickets are LTR and 17 carry no density_uom at all.
     * Typing density_value without it would have produced a null mass on every
     * litre ticket, which is the inert-rule shape again: a requirement written
     * in one unit against a screen that types another.
     *
     * A MASS ticket needs no density - the unit's own factor carries it - so
     * the density inputs are optional rather than mandatory, and the
     * derivation says why it declined rather than guessing.
     *
     * NOT TAKEN, AND MEASURED RATHER THAN ASSUMED:
     *   density_basis  no contract carries one. MASTER_CONTRACTS,
     *                  CONTRACT_PRODUCTS and MASTER_PRODUCTS have NO density
     *                  or temperature field at all, and nothing in srv/ writes
     *                  this. It has an entity default of 'MEA' (29 of 30
     *                  seeded; one OBS), so it is an optional override here,
     *                  not a resolved value and not a mandatory input.
     *
     * DERIVED BY THE EXISTING before-CREATE HOOKS, not by this action:
     *   quantity_metered  meter_end - meter_start        deriveMeasurement
     *   quantity_kg       metered x density              deriveTicketMassKg
     *   tail              from the registration          resolveTicketTail
     *   internal_number   from the order's station       allocateTicketNumber
     *   match_status      MATCHED, because there is an order
     */
    action captureTicketForOrder(
        // FROM THE CALLER'S CONTEXT
        orderId            : UUID @mandatory,

        // TYPED - only a person reading the supplier's paperwork knows these
        ticketNumber       : String(50) @mandatory,
        quantity           : Decimal(12,2) @mandatory,
        deliveryTimestamp  : DateTime @mandatory,
        meterStart         : Decimal(12,2),
        meterEnd           : Decimal(12,2),
        densityValue       : Decimal(8,4),
        densityUom         : String(10),
        densityTempC       : Decimal(5,2),

        // OPTIONAL OVERRIDES - both carry an entity default
        uomCode            : String(3),
        densityBasis       : String(10),

        vehicleId          : String(50),
        meterSerial        : String(50),
        supplierTicketRef  : String(50)
    ) returns FuelTickets;
}

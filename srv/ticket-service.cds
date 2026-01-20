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
}

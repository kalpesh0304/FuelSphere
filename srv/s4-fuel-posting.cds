/**
 * Manual (re)post of a fuel ticket to S/4HANA - PO -> GR -> supplier invoice.
 * Automatic posting happens on ticket save; this action is for retries
 * (e.g. after S/4 configuration was fixed or the connection was down).
 * Implementation: srv/lib/s4-fuel-posting.js (register()).
 */
using { TicketService } from './ticket-service';

extend TicketService.FuelTickets with actions {
    action postToS4() returns TicketService.FuelTickets;
};

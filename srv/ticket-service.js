/**
 * FuelSphere - Ticket Service Handler
 * Standalone service for independent Fuel Ticket management
 * Allows creating/managing tickets outside the FuelOrders draft flow
 */

const cds = require('@sap/cds');
const { SELECT, UPDATE } = cds.ql;
const { allocateTicketNumber, reportAllocationError } = require('./lib/number-range');

const _id = (params) => {
    const p = params[0];
    return typeof p === 'object' ? p.ID : p;
};

module.exports = class TicketService extends cds.ApplicationService {
    async init() {
        const { FuelTickets, FuelDeliveries } = this.entities;

        // ====================================================================
        // VIRTUAL ELEMENTS
        // ====================================================================

        this.after(['READ'], FuelTickets, (data) => {
            const items = Array.isArray(data) ? data : [data];
            items.forEach(item => {
                if (!item) return;
                switch (item.status) {
                    case 'Open':     item.statusCriticality = 0; break;
                    case 'Pending':  item.statusCriticality = 2; break;
                    case 'Attached': item.statusCriticality = 3; break;
                    case 'Verified': item.statusCriticality = 3; break;
                    case 'Closed':   item.statusCriticality = 3; break;
                    case 'Rejected': item.statusCriticality = 1; break;
                    default:         item.statusCriticality = 0;
                }
            });
        });

        // ====================================================================
        // TICKET NUMBER GENERATION
        // ====================================================================

        this.before('CREATE', FuelTickets, async (req) => {
            // WP-10 / A1: a ticket without an order is UNMATCHED, not invalid.
            //
            // The check is against UNMATCHED rather than undefined because
            // FuelTickets is draft-enabled: the CDS default populates the draft
            // row, so by activation the field already reads 'UNMATCHED' and is
            // never undefined. An explicitly set value other than the default
            // is left alone.
            if (req.data.order_ID && (!req.data.match_status || req.data.match_status === 'UNMATCHED')) {
                req.data.match_status = 'MATCHED';
            } else if (!req.data.order_ID && !req.data.match_status) {
                req.data.match_status = 'UNMATCHED';
            }

            // Auto-generate internal number if not provided
            if (req.data.internal_number) return;

            // The station is derived from the parent order. The 'XXX' fallback
            // is gone: a ticket that cannot be traced to a station is not
            // numbered (D17).
            let stationCode = null;
            if (req.data.order_ID) {
                const { FuelOrders } = this.entities;
                const order = await SELECT.one.from(FuelOrders)
                    .columns('station_code')
                    .where({ ID: req.data.order_ID });
                stationCode = order && order.station_code;
            }

            // WP-10: with no order there is no station, so there is no number
            // to allocate. internal_number is optional and stays null until the
            // ticket is matched — attachToOrder allocates it then. Refusing the
            // ticket here would put the fuel outside the system, which is the
            // whole point of A1.
            if (!stationCode) return;

            try {
                req.data.internal_number = await allocateTicketNumber(stationCode);
            } catch (e) {
                if (reportAllocationError(req, e)) return;
                throw e;
            }
        });

        // ====================================================================
        // TICKET ACTIONS
        // ====================================================================

        // Attach ticket to a delivery
        this.on('attachToDelivery', FuelTickets, async (req) => {
            const ticket = await SELECT.one.from(FuelTickets).where({ ID: _id(req.params) });
            if (!ticket) return req.error(404, 'Ticket not found');

            const deliveryId = req.data.deliveryId;
            if (!deliveryId) return req.error(400, 'Delivery ID is required.');

            const delivery = await SELECT.one.from(FuelDeliveries).where({ ID: deliveryId });
            if (!delivery) return req.error(404, 'Delivery not found');

            await UPDATE(FuelTickets).where({ ID: ticket.ID }).set({
                delivery_ID: deliveryId,
                status: 'Attached',
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });

            req.info(200, `Ticket ${ticket.ticket_number} attached to delivery ${delivery.delivery_number}.`);
            return SELECT.one.from(FuelTickets).where({ ID: ticket.ID });
        });

        // Attach an unmatched ticket to an order - the matching workbench (WP-10)
        this.on('attachToOrder', FuelTickets, async (req) => {
            const ticket = await SELECT.one.from(FuelTickets).where({ ID: _id(req.params) });
            if (!ticket) return req.error(404, 'Ticket not found');
            if (ticket.match_status === 'MATCHED') {
                return req.error(409, `Ticket ${ticket.ticket_number} is already matched to an order.`);
            }

            const { orderId } = req.data;
            if (!orderId) return req.error(400, 'Order ID is required.');

            const { FuelOrders } = this.entities;
            const order = await SELECT.one.from(FuelOrders)
                .columns('ID', 'order_number', 'station_code')
                .where({ ID: orderId });
            if (!order) return req.error(404, 'Order not found');

            const changes = {
                order_ID: order.ID,
                match_status: 'MATCHED',
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            };

            // A ticket captured without an order has no internal number,
            // because the number needs a station. Matching supplies one.
            if (!ticket.internal_number) {
                try {
                    changes.internal_number = await allocateTicketNumber(order.station_code);
                } catch (e) {
                    if (reportAllocationError(req, e)) return;
                    throw e;
                }
            }

            await UPDATE(FuelTickets).where({ ID: ticket.ID }).set(changes);
            req.info(200, `Ticket ${ticket.ticket_number} matched to order ${order.order_number}.`);
            return SELECT.one.from(FuelTickets).where({ ID: ticket.ID });
        });

        // Verify ticket
        this.on('verify', FuelTickets, async (req) => {
            const ticket = await SELECT.one.from(FuelTickets).where({ ID: _id(req.params) });
            if (!ticket) return req.error(404, 'Ticket not found');

            if (ticket.status !== 'Attached' && ticket.status !== 'Open') {
                return req.error(409, `Cannot verify ticket in status "${ticket.status}". Must be "Open" or "Attached".`);
            }

            await UPDATE(FuelTickets).where({ ID: ticket.ID }).set({
                status: 'Verified',
                verified_by: req.user.id,
                verified_at: new Date().toISOString(),
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });

            req.info(200, `Ticket ${ticket.ticket_number} verified successfully.`);
            return SELECT.one.from(FuelTickets).where({ ID: ticket.ID });
        });

        // Reject ticket
        this.on('reject', FuelTickets, async (req) => {
            const ticket = await SELECT.one.from(FuelTickets).where({ ID: _id(req.params) });
            if (!ticket) return req.error(404, 'Ticket not found');

            if (!req.data.reason) return req.error(400, 'Rejection reason is required.');

            if (ticket.status === 'Closed' || ticket.status === 'Rejected') {
                return req.error(409, `Cannot reject ticket in status "${ticket.status}".`);
            }

            await UPDATE(FuelTickets).where({ ID: ticket.ID }).set({
                status: 'Rejected',
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });

            req.info(200, `Ticket ${ticket.ticket_number} rejected. Reason: ${req.data.reason}`);
            return SELECT.one.from(FuelTickets).where({ ID: ticket.ID });
        });

        // ====================================================================
        // SERVICE-LEVEL FUNCTIONS
        // ====================================================================

        this.on('generateTicketNumber', async (req) => {
            const { stationCode, ticketDate } = req.data;
            try {
                return await allocateTicketNumber(stationCode, ticketDate);
            } catch (e) {
                if (reportAllocationError(req, e)) return;
                throw e;
            }
        });

        this.on('getTicketsByOrder', async (req) => {
            const { orderId } = req.data;
            if (!orderId) return req.error(400, 'Order ID is required.');
            return SELECT.from(FuelTickets).where({ order_ID: orderId });
        });

        this.on('getUnattachedTickets', async (req) => {
            const { stationCode } = req.data;
            // Get tickets that have no delivery linked
            const query = SELECT.from(FuelTickets).where({ delivery_ID: null, status: 'Open' });
            return query;
        });

        await super.init();
    }
};

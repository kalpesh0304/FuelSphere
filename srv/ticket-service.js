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
            // Auto-generate internal number if not provided
            if (req.data.internal_number) return;

            // The station is derived from the parent order. Previously the
            // fallback was 'XXX' — and the pre-order default was the constant
            // expression `req.data.aircraft_reg ? 'XXX' : 'XXX'`, which yielded
            // 'XXX' either way. Both are gone: a ticket that cannot be traced
            // to a station is not numbered, it is rejected (D17).
            let stationCode = null;
            if (req.data.order_ID) {
                const { FuelOrders } = this.entities;
                const order = await SELECT.one.from(FuelOrders)
                    .columns('station_code')
                    .where({ ID: req.data.order_ID });
                stationCode = order && order.station_code;
            }

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

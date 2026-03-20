/**
 * FuelSphere - Ticket Service Handler
 * Standalone service for independent Fuel Ticket management
 * Allows creating/managing tickets outside the FuelOrders draft flow
 */

const cds = require('@sap/cds');
const { SELECT, UPDATE } = cds.ql;

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
            if (!req.data.internal_number) {
                const stationCode = req.data.aircraft_reg ? 'XXX' : 'XXX'; // Derive from context
                const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

                // Try to derive station from the order
                if (req.data.order_ID) {
                    const { FuelOrders } = this.entities;
                    const order = await SELECT.one.from(FuelOrders).columns('station_code').where({ ID: req.data.order_ID });
                    if (order) {
                        const stn = order.station_code || 'XXX';
                        const pattern = `FT-${stn}-${today}-%`;
                        const last = await SELECT.one.from(FuelTickets)
                            .columns('internal_number')
                            .where({ internal_number: { like: pattern } })
                            .orderBy('internal_number desc');
                        let seq = 1;
                        if (last) {
                            seq = parseInt(last.internal_number.split('-').pop()) + 1;
                        }
                        req.data.internal_number = `FT-${stn}-${today}-${String(seq).padStart(3, '0')}`;
                    }
                }
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
            const dateStr = (ticketDate || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
            const stn = stationCode || 'XXX';
            const pattern = `FT-${stn}-${dateStr}-%`;
            const last = await SELECT.one.from(FuelTickets)
                .columns('internal_number')
                .where({ internal_number: { like: pattern } })
                .orderBy('internal_number desc');
            let seq = 1;
            if (last) {
                seq = parseInt(last.internal_number.split('-').pop()) + 1;
            }
            return `FT-${stn}-${dateStr}-${String(seq).padStart(3, '0')}`;
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

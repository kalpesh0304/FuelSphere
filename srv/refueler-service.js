/**
 * FuelSphere - Refueler/Supplier Service Handler
 * Handles the fuel sales order lifecycle from the supplier perspective:
 * - Order confirmation, delivery scheduling, delivery recording
 * - Invoice creation, cancellation
 * - Status criticality for UI coloring
 */

const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE } = cds.ql;

// Helper to extract entity ID from bound action params (handles draft-enabled entities)
const _id = (params) => {
    const p = params[0];
    return typeof p === 'object' ? p.ID : p;
};

module.exports = class RefuelerService extends cds.ApplicationService {
    async init() {
        const { FUEL_SALES_ORDERS, FUEL_DELIVERIES } = cds.entities('fuelsphere');

        // ====================================================================
        // VIRTUAL ELEMENTS - Status Criticality
        // ====================================================================

        this.after(['READ'], 'SalesOrders', (data) => {
            const items = Array.isArray(data) ? data : [data];
            items.forEach(item => {
                if (!item) return;
                switch (item.status) {
                    case 'RECEIVED':    item.statusCriticality = 2; break; // Warning
                    case 'CONFIRMED':   item.statusCriticality = 3; break; // Positive
                    case 'SCHEDULED':   item.statusCriticality = 3; break; // Positive
                    case 'IN_DELIVERY': item.statusCriticality = 2; break; // Warning
                    case 'DELIVERED':   item.statusCriticality = 3; break; // Positive
                    case 'INVOICED':    item.statusCriticality = 3; break; // Positive
                    case 'CLOSED':      item.statusCriticality = 0; break; // Neutral
                    case 'CANCELLED':   item.statusCriticality = 1; break; // Negative
                    default:            item.statusCriticality = 0;
                }
            });
        });

        this.after(['READ'], 'DeliveryRecords', (data) => {
            const items = Array.isArray(data) ? data : [data];
            items.forEach(item => {
                if (!item) return;
                switch (item.status) {
                    case 'Pending':  item.statusCriticality = 2; break; // Warning
                    case 'Verified': item.statusCriticality = 3; break; // Positive
                    case 'Posted':   item.statusCriticality = 3; break; // Positive
                    case 'Disputed': item.statusCriticality = 1; break; // Negative
                    default:         item.statusCriticality = 0;
                }
            });
        });

        // ====================================================================
        // CONFIRM ORDER: RECEIVED -> CONFIRMED
        // ====================================================================

        this.on('confirmOrder', 'SalesOrders', async (req) => {
            const order = await SELECT.one.from(FUEL_SALES_ORDERS).where({ ID: _id(req.params) });
            if (!order) return req.error(404, 'Sales order not found.');
            if (order.status !== 'RECEIVED') {
                return req.error(409, `Cannot confirm order in status "${order.status}". Order must be in "RECEIVED" status.`);
            }

            await UPDATE(FUEL_SALES_ORDERS).where({ ID: order.ID }).set({
                status: 'CONFIRMED',
                confirmed_at: new Date().toISOString(),
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });

            req.info(200, `Sales order ${order.sales_order_number} confirmed successfully.`);
            return SELECT.one.from(FUEL_SALES_ORDERS).where({ ID: order.ID });
        });

        // ====================================================================
        // SCHEDULE DELIVERY: CONFIRMED -> SCHEDULED
        // ====================================================================

        this.on('scheduleDelivery', 'SalesOrders', async (req) => {
            const { scheduledDate, scheduledTime, vehicleId, driverName } = req.data;
            const order = await SELECT.one.from(FUEL_SALES_ORDERS).where({ ID: _id(req.params) });
            if (!order) return req.error(404, 'Sales order not found.');
            if (order.status !== 'CONFIRMED') {
                return req.error(409, `Cannot schedule delivery for order in status "${order.status}". Order must be in "CONFIRMED" status.`);
            }
            if (!scheduledDate) {
                return req.error(400, 'Scheduled date is required.');
            }

            await UPDATE(FUEL_SALES_ORDERS).where({ ID: order.ID }).set({
                status: 'SCHEDULED',
                scheduled_date: scheduledDate,
                scheduled_time: scheduledTime || null,
                vehicle_id: vehicleId || null,
                driver_name: driverName || null,
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });

            req.info(200, `Delivery scheduled for sales order ${order.sales_order_number}.`);
            return SELECT.one.from(FUEL_SALES_ORDERS).where({ ID: order.ID });
        });

        // ====================================================================
        // RECORD DELIVERY: SCHEDULED/IN_DELIVERY -> DELIVERED
        // Creates a FUEL_DELIVERIES record and updates the sales order
        // ====================================================================

        this.on('recordDelivery', 'SalesOrders', async (req) => {
            const { deliveredQuantity, temperature, density, driverName, vehicleId } = req.data;
            const order = await SELECT.one.from(FUEL_SALES_ORDERS).where({ ID: _id(req.params) });
            if (!order) return req.error(404, 'Sales order not found.');
            if (order.status !== 'SCHEDULED' && order.status !== 'IN_DELIVERY') {
                return req.error(409, `Cannot record delivery for order in status "${order.status}". Order must be in "SCHEDULED" or "IN_DELIVERY" status.`);
            }
            if (!deliveredQuantity || deliveredQuantity <= 0) {
                return req.error(400, 'Delivered quantity must be greater than zero.');
            }

            // Calculate total amount based on unit price
            const totalAmount = order.unit_price
                ? Number((deliveredQuantity * order.unit_price).toFixed(2))
                : order.total_amount;

            // Generate delivery number
            const stn = order.station_code || 'XXX';
            const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const pattern = `EPD-${stn}-${today}-%`;
            const lastDelivery = await SELECT.one.from(FUEL_DELIVERIES)
                .columns('delivery_number')
                .where({ delivery_number: { like: pattern } })
                .orderBy('delivery_number desc');
            let nextSeq = 1;
            if (lastDelivery) {
                nextSeq = parseInt(lastDelivery.delivery_number.split('-').pop()) + 1;
            }
            const deliveryNumber = `EPD-${stn}-${today}-${String(nextSeq).padStart(3, '0')}`;

            // Create delivery record
            await INSERT.into(FUEL_DELIVERIES).entries({
                sales_order_ID: order.ID,
                delivery_number: deliveryNumber,
                delivery_date: new Date().toISOString().slice(0, 10),
                delivery_time: new Date().toISOString().slice(11, 19),
                delivered_quantity: deliveredQuantity,
                temperature: temperature || null,
                density: density || null,
                vehicle_id: vehicleId || order.vehicle_id,
                driver_name: driverName || order.driver_name,
                status: 'Pending'
            });

            // Update sales order
            await UPDATE(FUEL_SALES_ORDERS).where({ ID: order.ID }).set({
                status: 'DELIVERED',
                delivered_quantity: deliveredQuantity,
                delivered_at: new Date().toISOString(),
                total_amount: totalAmount,
                vehicle_id: vehicleId || order.vehicle_id,
                driver_name: driverName || order.driver_name,
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });

            req.info(200, `Delivery ${deliveryNumber} recorded for sales order ${order.sales_order_number}.`);
            return SELECT.one.from(FUEL_SALES_ORDERS).where({ ID: order.ID });
        });

        // ====================================================================
        // CREATE INVOICE: DELIVERED -> INVOICED
        // ====================================================================

        this.on('createInvoice', 'SalesOrders', async (req) => {
            const { invoiceNumber, invoiceDate } = req.data;
            const order = await SELECT.one.from(FUEL_SALES_ORDERS).where({ ID: _id(req.params) });
            if (!order) return req.error(404, 'Sales order not found.');
            if (order.status !== 'DELIVERED') {
                return req.error(409, `Cannot create invoice for order in status "${order.status}". Order must be in "DELIVERED" status.`);
            }
            if (!invoiceNumber) {
                return req.error(400, 'Invoice number is required.');
            }

            const invoiceAmount = order.total_amount || (order.delivered_quantity * (order.unit_price || 0));

            await UPDATE(FUEL_SALES_ORDERS).where({ ID: order.ID }).set({
                status: 'INVOICED',
                invoice_number: invoiceNumber,
                invoice_date: invoiceDate || new Date().toISOString().slice(0, 10),
                invoice_amount: Number(invoiceAmount.toFixed(2)),
                invoiced_at: new Date().toISOString(),
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });

            req.info(200, `Invoice ${invoiceNumber} created for sales order ${order.sales_order_number}.`);
            return SELECT.one.from(FUEL_SALES_ORDERS).where({ ID: order.ID });
        });

        // ====================================================================
        // CANCEL: any active status -> CANCELLED
        // ====================================================================

        this.on('cancel', 'SalesOrders', async (req) => {
            const { reason } = req.data;
            const order = await SELECT.one.from(FUEL_SALES_ORDERS).where({ ID: _id(req.params) });
            if (!order) return req.error(404, 'Sales order not found.');

            const nonCancellable = ['INVOICED', 'CLOSED', 'CANCELLED'];
            if (nonCancellable.includes(order.status)) {
                return req.error(409, `Cannot cancel order in status "${order.status}".`);
            }
            if (!reason) {
                return req.error(400, 'Cancellation reason is required.');
            }

            await UPDATE(FUEL_SALES_ORDERS).where({ ID: order.ID }).set({
                status: 'CANCELLED',
                notes: reason ? `Cancelled: ${reason}` : 'Cancelled',
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });

            req.info(200, `Sales order ${order.sales_order_number} cancelled.`);
            return SELECT.one.from(FUEL_SALES_ORDERS).where({ ID: order.ID });
        });

        await super.init();
    }
};

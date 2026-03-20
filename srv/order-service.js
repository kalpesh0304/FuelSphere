/**
 * FuelSphere - Fuel Order Service Handler
 * Handles the complete fuel ordering lifecycle:
 * - Order creation, submission, confirmation, delivery, cancellation
 * - ePOD (Electronic Proof of Delivery) with signature capture
 * - S/4HANA PO/GR simulation
 * - Temperature correction (ASTM D1250)
 */

const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE } = cds.ql;

// Helper to extract entity ID from bound action params (handles draft-enabled entities)
const _id = (params) => {
    const p = params[0];
    return typeof p === 'object' ? p.ID : p;
};

module.exports = class FuelOrderService extends cds.ApplicationService {
    async init() {
        const { FuelOrders, FuelDeliveries, FuelTickets, Flights } = this.entities;

        // ====================================================================
        // VIRTUAL ELEMENTS
        // ====================================================================

        this.after(['READ'], FuelOrders, (data) => {
            const items = Array.isArray(data) ? data : [data];
            items.forEach(item => {
                if (!item) return;
                switch (item.status) {
                    case 'Draft':     item.statusCriticality = 0; break;
                    case 'Created':   item.statusCriticality = 0; break;
                    case 'Submitted': item.statusCriticality = 2; break;
                    case 'Confirmed': item.statusCriticality = 3; break;
                    case 'InProgress':item.statusCriticality = 2; break;
                    case 'Delivered': item.statusCriticality = 3; break;
                    case 'Cancelled': item.statusCriticality = 1; break;
                    default:          item.statusCriticality = 0;
                }
                switch (item.priority) {
                    case 'Normal': item.priorityCriticality = 0; break;
                    case 'High':   item.priorityCriticality = 2; break;
                    case 'Urgent': item.priorityCriticality = 1; break;
                    default:       item.priorityCriticality = 0;
                }
            });
        });

        this.after(['READ'], FuelDeliveries, (data) => {
            const items = Array.isArray(data) ? data : [data];
            items.forEach(item => {
                if (!item) return;
                switch (item.status) {
                    case 'Pending':  item.statusCriticality = 2; break;
                    case 'Verified': item.statusCriticality = 3; break;
                    case 'Posted':   item.statusCriticality = 3; break;
                    case 'Disputed': item.statusCriticality = 1; break;
                    default:         item.statusCriticality = 0;
                }
                // Variance criticality
                const pct = Math.abs(item.variance_percentage || 0);
                if (pct > 5)      item.varianceCriticality = 1; // Red
                else if (pct > 2) item.varianceCriticality = 2; // Yellow
                else              item.varianceCriticality = 3; // Green
            });
        });

        // ====================================================================
        // ORDER CREATION - Total amount calc & order number generation
        // ====================================================================

        this.before(['PATCH', 'UPDATE'], [FuelOrders, FuelOrders.drafts], async (req) => {
            const { ordered_quantity, unit_price } = req.data;
            if (ordered_quantity !== undefined || unit_price !== undefined) {
                const current = await SELECT.one.from(req.subject);
                const quan = ordered_quantity ?? current.ordered_quantity ?? 0;
                const unit = unit_price ?? current.unit_price ?? 0;
                if (quan > 100000) {
                    req.error(400, 'Large order detected. Please verify quantity.');
                    return;
                }
                req.data.total_amount = Number((quan * unit).toFixed(2));
            }
        });

        this.before('CREATE', FuelOrders, async (req) => {
            const { station_code } = req.data;
            const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const stn = station_code || 'XXX';
            const pattern = `FO-${stn}-${today}-%`;
            const lastOrder = await SELECT.one.from(FuelOrders)
                .columns('order_number')
                .where({ order_number: { like: pattern } })
                .orderBy('order_number desc');
            let nextSeq = 1;
            if (lastOrder) {
                nextSeq = parseInt(lastOrder.order_number.split('-').pop()) + 1;
            }
            req.data.order_number = `FO-${stn}-${today}-${String(nextSeq).padStart(3, '0')}`;
            req.data.status = 'Created';
        });

        // canSubmit virtual element
        this.after(['READ', 'EDIT'], FuelOrders, (data) => {
            const items = Array.isArray(data) ? data : [data];
            items.forEach(item => {
                if (item) {
                    item.canSubmit = item.status === 'Created';
                }
            });
        });

        // ====================================================================
        // ORDER LIFECYCLE ACTIONS
        // ====================================================================

        // Submit: Created → Submitted
        this.on('submit', FuelOrders, async (req) => {
            const order = await SELECT.one.from(FuelOrders).where({ ID: _id(req.params) });
            if (!order) return req.error(404, 'Order not found');
            if (order.status !== 'Created') {
                return req.error(409, `Cannot submit order in status "${order.status}". Order must be in "Created" status.`);
            }
            if (!order.ordered_quantity || order.ordered_quantity <= 0) {
                return req.error(400, 'Order must have a valid quantity before submission.');
            }
            await UPDATE(FuelOrders).where({ ID: order.ID }).set({
                status: 'Submitted',
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });
            req.info(200, `Order ${order.order_number} submitted to supplier successfully.`);
            return SELECT.one.from(FuelOrders).where({ ID: order.ID });
        });

        // Confirm: Submitted → Confirmed
        this.on('confirm', FuelOrders, async (req) => {
            const order = await SELECT.one.from(FuelOrders).where({ ID: _id(req.params) });
            if (!order) return req.error(404, 'Order not found');
            if (order.status !== 'Submitted') {
                return req.error(409, `Cannot confirm order in status "${order.status}". Order must be in "Submitted" status.`);
            }
            await UPDATE(FuelOrders).where({ ID: order.ID }).set({
                status: 'Confirmed',
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });
            req.info(200, `Order ${order.order_number} confirmed by supplier.`);
            return SELECT.one.from(FuelOrders).where({ ID: order.ID });
        });

        // Start Delivery: Confirmed → InProgress
        this.on('startDelivery', FuelOrders, async (req) => {
            const order = await SELECT.one.from(FuelOrders).where({ ID: _id(req.params) });
            if (!order) return req.error(404, 'Order not found');
            if (order.status !== 'Confirmed') {
                return req.error(409, `Cannot start delivery for order in status "${order.status}". Order must be in "Confirmed" status.`);
            }
            await UPDATE(FuelOrders).where({ ID: order.ID }).set({
                status: 'InProgress',
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });
            req.info(200, `Delivery started for order ${order.order_number}.`);
            return SELECT.one.from(FuelOrders).where({ ID: order.ID });
        });

        // Cancel: Draft/Created/Submitted/Confirmed → Cancelled
        this.on('cancel', FuelOrders, async (req) => {
            const order = await SELECT.one.from(FuelOrders).where({ ID: _id(req.params) });
            if (!order) return req.error(404, 'Order not found');
            const cancellable = ['Draft', 'Created', 'Submitted', 'Confirmed'];
            if (!cancellable.includes(order.status)) {
                return req.error(409, `Cannot cancel order in status "${order.status}".`);
            }
            const reason = req.data.reason;
            if (order.status !== 'Draft' && !reason) {
                return req.error(400, 'Cancellation reason is required for non-draft orders.');
            }
            await UPDATE(FuelOrders).where({ ID: order.ID }).set({
                status: 'Cancelled',
                cancelled_reason: reason || 'Cancelled by user',
                cancelled_by: req.user.id,
                cancelled_at: new Date().toISOString(),
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });
            req.info(200, `Order ${order.order_number} cancelled.`);
            return SELECT.one.from(FuelOrders).where({ ID: order.ID });
        });

        // ====================================================================
        // CREATE ORDER FROM FLIGHT (Service-level action)
        // ====================================================================

        this.on('createOrderFromFlight', async (req) => {
            const { flightId, supplierId, contractId, productId, orderedQuantity, unitPrice, currencyCode, priority, notes } = req.data;

            // Look up the flight
            const flight = await SELECT.one.from(Flights).where({ ID: flightId });
            if (!flight) return req.error(404, 'Flight not found');

            const stationCode = flight.origin_airport;
            const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const pattern = `FO-${stationCode}-${today}-%`;
            const lastOrder = await SELECT.one.from(FuelOrders)
                .columns('order_number')
                .where({ order_number: { like: pattern } })
                .orderBy('order_number desc');
            let nextSeq = 1;
            if (lastOrder) {
                nextSeq = parseInt(lastOrder.order_number.split('-').pop()) + 1;
            }
            const orderNumber = `FO-${stationCode}-${today}-${String(nextSeq).padStart(3, '0')}`;

            const totalAmount = orderedQuantity && unitPrice ? Number((orderedQuantity * unitPrice).toFixed(2)) : 0;

            // Find airport ID by IATA code
            const { MASTER_AIRPORTS } = cds.entities('fuelsphere');
            const airport = await SELECT.one.from(MASTER_AIRPORTS).where({ iata_code: stationCode });

            const orderId = cds.utils.uuid();
            await INSERT.into(FuelOrders).entries({
                ID: orderId,
                order_number: orderNumber,
                flight_ID: flightId,
                airport_ID: airport ? airport.ID : null,
                station_code: stationCode,
                supplier_ID: supplierId,
                contract_ID: contractId,
                product_ID: productId,
                uom_code: 'KG',
                ordered_quantity: orderedQuantity,
                unit_price: unitPrice,
                total_amount: totalAmount,
                currency_code: currencyCode || 'USD',
                requested_date: flight.flight_date,
                priority: priority || 'Normal',
                status: 'Created',
                notes: notes || `Fuel order for flight ${flight.flight_number} ${flight.origin_airport}-${flight.destination_airport}`
            });

            req.info(200, `Order ${orderNumber} created from flight ${flight.flight_number} (${flight.origin_airport}→${flight.destination_airport}).`);
            return SELECT.one.from(FuelOrders).where({ ID: orderId });
        });

        // ====================================================================
        // EPOD ACTIONS
        // ====================================================================

        // Capture Signatures → Simulates S/4HANA PO/GR creation
        this.on('captureSignatures', FuelDeliveries, async (req) => {
            const delivery = await SELECT.one.from(FuelDeliveries).where({ ID: _id(req.params) });
            if (!delivery) return req.error(404, 'Delivery not found');

            if (delivery.status === 'Posted') {
                return req.error(409, 'Signatures already captured and PO/GR already created.');
            }

            const { pilotName, pilotSignature, groundCrewName, groundCrewSignature, signatureLocation } = req.data;

            if (!pilotName || !groundCrewName) {
                return req.error(400, 'EPD402: Both pilot name and ground crew name are required.');
            }

            // Look up the parent order to get order details
            const order = await SELECT.one.from(FuelOrders).where({ ID: delivery.order_ID });
            if (!order) return req.error(404, 'Parent order not found');

            // Simulate S/4HANA PO and GR number generation
            const poSeq = Math.floor(4500001000 + Math.random() * 9000);
            const grSeq = Math.floor(5000001000 + Math.random() * 9000);
            const s4PONumber = String(poSeq);
            const s4GRNumber = String(grSeq);
            const now = new Date().toISOString();

            // Calculate variance
            const varianceQty = delivery.delivered_quantity - order.ordered_quantity;
            const variancePct = order.ordered_quantity > 0
                ? Number(((varianceQty / order.ordered_quantity) * 100).toFixed(2))
                : 0;
            const varianceFlag = Math.abs(variancePct) > 5;

            // Update delivery with signatures and S/4 references
            await UPDATE(FuelDeliveries).where({ ID: delivery.ID }).set({
                pilot_name: pilotName,
                pilot_signature: pilotSignature,
                ground_crew_name: groundCrewName,
                ground_crew_signature: groundCrewSignature,
                signature_timestamp: now,
                signature_location: signatureLocation,
                s4_gr_number: s4GRNumber,
                s4_gr_year: new Date().getFullYear().toString(),
                s4_gr_item: '0001',
                status: 'Posted',
                quantity_variance: varianceQty,
                variance_percentage: variancePct,
                variance_flag: varianceFlag,
                modified_at: now,
                modified_by: req.user.id
            });

            // Update parent order with PO number and status → Delivered
            await UPDATE(FuelOrders).where({ ID: order.ID }).set({
                s4_po_number: s4PONumber,
                s4_po_item: '00010',
                status: 'Delivered',
                modified_at: now,
                modified_by: 'SYSTEM'
            });

            const message = varianceFlag
                ? `EPD401: Warning - Delivery variance ${variancePct}% exceeds 5% tolerance. PO ${s4PONumber} / GR ${s4GRNumber} created.`
                : `Signatures captured. S/4HANA PO ${s4PONumber} and GR ${s4GRNumber} created successfully.`;

            req.info(200, message);

            return {
                success: true,
                deliveryNumber: delivery.delivery_number,
                s4PONumber: s4PONumber,
                s4GRNumber: s4GRNumber,
                orderStatus: 'Delivered',
                message: message
            };
        });

        // Verify Quantity
        this.on('verifyQuantity', FuelDeliveries, async (req) => {
            const delivery = await SELECT.one.from(FuelDeliveries).where({ ID: _id(req.params) });
            if (!delivery) return req.error(404, 'Delivery not found');

            const order = await SELECT.one.from(FuelOrders).where({ ID: delivery.order_ID });
            if (!order) return req.error(404, 'Parent order not found');

            const varianceQty = delivery.delivered_quantity - order.ordered_quantity;
            const variancePct = order.ordered_quantity > 0
                ? Number(((varianceQty / order.ordered_quantity) * 100).toFixed(2))
                : 0;
            const varianceFlag = Math.abs(variancePct) > 5;

            await UPDATE(FuelDeliveries).where({ ID: delivery.ID }).set({
                quantity_variance: varianceQty,
                variance_percentage: variancePct,
                variance_flag: varianceFlag,
                status: varianceFlag ? delivery.status : 'Verified',
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });

            if (varianceFlag) {
                req.warn(200, `EPD401: Quantity variance ${variancePct}% exceeds 5% tolerance. Ordered: ${order.ordered_quantity} kg, Delivered: ${delivery.delivered_quantity} kg.`);
            } else {
                req.info(200, `Quantity verified. Variance: ${variancePct}% (${varianceQty >= 0 ? '+' : ''}${varianceQty} kg).`);
            }
            return SELECT.one.from(FuelDeliveries).where({ ID: delivery.ID });
        });

        // Dispute delivery
        this.on('dispute', FuelDeliveries, async (req) => {
            const delivery = await SELECT.one.from(FuelDeliveries).where({ ID: _id(req.params) });
            if (!delivery) return req.error(404, 'Delivery not found');
            if (!req.data.reason) return req.error(400, 'Dispute reason is required.');

            await UPDATE(FuelDeliveries).where({ ID: delivery.ID }).set({
                status: 'Disputed',
                variance_reason: req.data.reason,
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });
            req.info(200, `Delivery ${delivery.delivery_number} marked as disputed.`);
            return SELECT.one.from(FuelDeliveries).where({ ID: delivery.ID });
        });

        // Calculate Temperature Correction (ASTM D1250)
        this.on('calculateTemperatureCorrection', FuelDeliveries, async (req) => {
            const delivery = await SELECT.one.from(FuelDeliveries).where({ ID: _id(req.params) });
            if (!delivery) return req.error(404, 'Delivery not found');

            const temp = delivery.temperature;
            const density = delivery.density;
            const measuredQty = delivery.delivered_quantity;

            if (temp === null || temp === undefined) return req.error(400, 'EPD403: Temperature not recorded on this delivery.');
            if (density === null || density === undefined) return req.error(400, 'EPD404: Density not recorded on this delivery.');

            // ASTM D1250: Corrected = Measured × [1 - α × (T - 15)]
            // α = 0.00099 for Jet A/A-1
            const alpha = 0.00099;
            const refTemp = 15.0;
            const correctionFactor = Number((1 - alpha * (temp - refTemp)).toFixed(6));
            const correctedQty = Number((measuredQty * correctionFactor).toFixed(2));

            await UPDATE(FuelDeliveries).where({ ID: delivery.ID }).set({
                temperature_corrected_qty: correctedQty,
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });

            return {
                success: true,
                deliveryNumber: delivery.delivery_number,
                measuredQuantity: measuredQty,
                measuredTemperature: temp,
                measuredDensity: density,
                correctionFactor: correctionFactor,
                correctedQuantity: correctedQty,
                referenceTemperature: refTemp,
                message: `Temperature corrected from ${measuredQty} kg to ${correctedQty} kg (factor: ${correctionFactor}, ΔT: ${(temp - refTemp).toFixed(1)}°C)`
            };
        });

        // Validate Delivery (FDD-05 rules)
        this.on('validateDelivery', FuelDeliveries, async (req) => {
            const delivery = await SELECT.one.from(FuelDeliveries).where({ ID: _id(req.params) });
            if (!delivery) return req.error(404, 'Delivery not found');

            const order = await SELECT.one.from(FuelOrders).where({ ID: delivery.order_ID });
            const errors = [];
            const warnings = [];

            // VAL-EPD-001: Quantity check
            if (delivery.delivered_quantity <= 0) {
                errors.push({ code: 'EPD401', field: 'delivered_quantity', message: 'Delivered quantity must be greater than 0.', severity: 'ERROR' });
            }
            if (order && delivery.delivered_quantity > order.ordered_quantity * 1.05) {
                errors.push({ code: 'EPD401', field: 'delivered_quantity', message: `Delivered quantity ${delivery.delivered_quantity} kg exceeds ordered ${order.ordered_quantity} kg by more than 5%.`, severity: 'ERROR' });
            }

            // VAL-EPD-003: Temperature range
            if (delivery.temperature !== null && delivery.temperature !== undefined) {
                if (delivery.temperature < -40 || delivery.temperature > 50) {
                    errors.push({ code: 'EPD403', field: 'temperature', message: `Temperature ${delivery.temperature}°C is out of range (-40°C to +50°C).`, severity: 'ERROR' });
                }
            } else {
                warnings.push({ code: 'EPD403', field: 'temperature', message: 'Temperature not recorded.', severity: 'WARNING' });
            }

            // VAL-EPD-004: Density range
            if (delivery.density !== null && delivery.density !== undefined) {
                if (delivery.density < 0.775 || delivery.density > 0.840) {
                    errors.push({ code: 'EPD404', field: 'density', message: `Density ${delivery.density} kg/L is out of specification (0.775 - 0.840 kg/L).`, severity: 'ERROR' });
                }
            } else {
                warnings.push({ code: 'EPD404', field: 'density', message: 'Density not recorded.', severity: 'WARNING' });
            }

            return {
                isValid: errors.length === 0,
                deliveryNumber: delivery.delivery_number,
                errors: errors,
                warnings: warnings
            };
        });

        // ====================================================================
        // FUEL TICKET ACTIONS (within FuelOrderService context)
        // ====================================================================

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

        this.on('verify', FuelTickets, async (req) => {
            const ticket = await SELECT.one.from(FuelTickets).where({ ID: _id(req.params) });
            if (!ticket) return req.error(404, 'Ticket not found');

            if (ticket.status !== 'Attached' && ticket.status !== 'Open') {
                return req.error(409, `Cannot verify ticket in status "${ticket.status}".`);
            }

            await UPDATE(FuelTickets).where({ ID: ticket.ID }).set({
                status: 'Verified',
                verified_by: req.user.id,
                verified_at: new Date().toISOString(),
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });
            req.info(200, `Ticket ${ticket.ticket_number} verified.`);
            return SELECT.one.from(FuelTickets).where({ ID: ticket.ID });
        });

        // ====================================================================
        // SERVICE-LEVEL FUNCTIONS
        // ====================================================================

        this.on('generateOrderNumber', async (req) => {
            const { stationCode, orderDate } = req.data;
            const dateStr = (orderDate || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
            const stn = stationCode || 'XXX';
            const pattern = `FO-${stn}-${dateStr}-%`;
            const lastOrder = await SELECT.one.from(FuelOrders)
                .columns('order_number')
                .where({ order_number: { like: pattern } })
                .orderBy('order_number desc');
            let nextSeq = 1;
            if (lastOrder) {
                nextSeq = parseInt(lastOrder.order_number.split('-').pop()) + 1;
            }
            return `FO-${stn}-${dateStr}-${String(nextSeq).padStart(3, '0')}`;
        });

        this.on('generateDeliveryNumber', async (req) => {
            const { stationCode, deliveryDate } = req.data;
            const dateStr = (deliveryDate || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
            const stn = stationCode || 'XXX';
            const pattern = `EPD-${stn}-${dateStr}-%`;
            const lastDelivery = await SELECT.one.from(FuelDeliveries)
                .columns('delivery_number')
                .where({ delivery_number: { like: pattern } })
                .orderBy('delivery_number desc');
            let nextSeq = 1;
            if (lastDelivery) {
                nextSeq = parseInt(lastDelivery.delivery_number.split('-').pop()) + 1;
            }
            return `EPD-${stn}-${dateStr}-${String(nextSeq).padStart(3, '0')}`;
        });

        await super.init();
    }
};

/**
 * FuelSphere - Delivery Service Handler
 * Standalone service for independent Fuel Delivery (ePOD) management
 * Allows creating/managing deliveries outside the FuelOrders draft flow
 */

const cds = require('@sap/cds');
const { SELECT, UPDATE } = cds.ql;
const {
    allocateDeliveryNumber,
    allocateDeliveryNumberByFlight,
    allocateDeliveryNumberByTail,
    reportAllocationError
} = require('./lib/number-range');
const { deriveGaugeFigures } = require('./lib/fuel-uom');
const { resolveTail } = require('./lib/tail-resolver');

const _id = (params) => {
    const p = params[0];
    return typeof p === 'object' ? p.ID : p;
};

module.exports = class DeliveryService extends cds.ApplicationService {
    async init() {
        const { FuelDeliveries } = this.entities;

        // ====================================================================
        // VIRTUAL ELEMENTS
        // ====================================================================

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
                const pct = Math.abs(item.variance_percentage || 0);
                if (pct > 5)      item.varianceCriticality = 1;
                else if (pct > 2) item.varianceCriticality = 2;
                else              item.varianceCriticality = 3;
            });
        });

        // ====================================================================
        // AIRCRAFT GAUGE PAIR — mirrors order-service.js's deriveGauge
        // exactly. Own-row derivation, same reasoning: registered on the
        // draft too, since FuelDeliveries is the draft ROOT here (unlike the
        // embedded FuelOrderService copy, which is a draft composition
        // child and needs the draft registration for a different reason -
        // see the comment there).
        // ====================================================================
        const deriveGauge = async (req) => {
            const d = req.data;
            let stored = {};
            if (req.event !== 'CREATE') {
                const id = d.ID || _id(req.params);
                if (id) {
                    stored = await SELECT.one.from(req.target)
                        .columns('fob_at_arrival_kg', 'fob_before_kg', 'fob_after_kg')
                        .where({ ID: id }) || {};
                }
            }
            const at = (f) => (d[f] !== undefined ? d[f] : stored[f]);

            const derived = deriveGaugeFigures({
                fob_at_arrival_kg: at('fob_at_arrival_kg'),
                fob_before_kg: at('fob_before_kg'),
                fob_after_kg: at('fob_after_kg')
            });
            d.fob_delta_kg = derived.fob_delta_kg;
            d.ground_burn_kg = derived.ground_burn_kg;
        };
        this.before(['CREATE', 'UPDATE', 'PATCH'], [FuelDeliveries, FuelDeliveries.drafts], deriveGauge);

        // ====================================================================
        // ORDER- AND FLIGHT-DRIVEN AUTO-POPULATION — live, during draft
        // editing. TWO WAYS IN, ONE OUTCOME: the aircraft.
        //
        //   pick an ORDER   -> flight comes from order.flight, aircraft_reg
        //                      and uom_code follow from there
        //   pick a FLIGHT   -> aircraft_reg follows from it, order stays
        //                      empty (B2: a delivery need not have one)
        //
        // aircraft_reg is never typed by hand on these screens - it is
        // display-only there, because a registration that disagrees with the
        // flight it was picked from is a join key pointing at nothing
        // (REQ-FL-010).
        //
        // Registered BEFORE resolveDeliveryTail below, so an aircraft_reg
        // that arrives here still gets its tail_registration resolved in the
        // same request - registering it the other way round would leave a
        // freshly auto-populated aircraft_reg with no resolved tail until
        // the user touched the field directly.
        // ====================================================================
        const readStored = async (req, ...columns) => {
            const id = req.data.ID || _id(req.params);
            if (!id) return null;
            return SELECT.one.from(FuelDeliveries.drafts).columns(...columns).where({ ID: id });
        };

        const applyFlight = async (req, flightId) => {
            if (!flightId) return;
            const flight = await cds.db.run(SELECT.one
                .from('fuelsphere.FLIGHT_SCHEDULE')
                .columns('aircraft_reg')
                .where({ ID: flightId }));
            if (flight) req.data.aircraft_reg = flight.aircraft_reg;
        };

        // THE ORDER WINS WHERE BOTH ARE PRESENT, and that is not arbitrary:
        // the order names the flight it was raised for, so a flight picked
        // separately is the weaker claim about the same uplift.
        const populateFromOrderOrFlight = async (req) => {
            const orderTouched  = req.data.order_ID !== undefined;
            const flightTouched = req.data.flight_ID !== undefined;
            if (!orderTouched && !flightTouched) return;

            let orderId = req.data.order_ID;
            if (orderId === undefined) {
                const stored = await readStored(req, 'order_ID');
                orderId = stored && stored.order_ID;
            }

            if (orderId) {
                const { FuelOrders } = this.entities;
                const order = await SELECT.one.from(FuelOrders)
                    .columns('flight_ID', 'uom_code')
                    .where({ ID: orderId });
                if (!order) return;
                // The order's flight becomes the delivery's own, so an
                // order-less delivery and an ordered one answer "which
                // flight?" from the same field.
                if (order.flight_ID) {
                    req.data.flight_ID = order.flight_ID;
                    await applyFlight(req, order.flight_ID);
                }
                if (req.data.uom_code === undefined && order.uom_code) req.data.uom_code = order.uom_code;
                return;
            }

            // No order - the flight was picked directly, or the order was
            // just cleared. Either way the flight on the row is what names
            // the aircraft now.
            let flightId = req.data.flight_ID;
            if (flightId === undefined) {
                const stored = await readStored(req, 'flight_ID');
                flightId = stored && stored.flight_ID;
            }
            if (flightId) await applyFlight(req, flightId);
            else if (flightTouched) req.data.aircraft_reg = null; // flight cleared
        };
        this.before(['CREATE', 'UPDATE', 'PATCH'], [FuelDeliveries, FuelDeliveries.drafts], populateFromOrderOrFlight);

        // WP-07B. Never blockable - the fuel is on the aircraft whether the
        // tail resolves or not. Reads its own row, so the draft path is
        // registered too. Mirrors order-service.js's resolveDeliveryTail.
        const resolveDeliveryTail = async (req) => {
            const reg = req.data.aircraft_reg;
            if (reg === undefined) return;
            const row = await resolveTail(reg);
            req.data.tail_registration = row ? row.registration : null;
        };
        this.before(['CREATE', 'UPDATE', 'PATCH'], [FuelDeliveries, FuelDeliveries.drafts], resolveDeliveryTail);

        // ====================================================================
        // DELIVERY NUMBER GENERATION
        //
        // Flight-based wherever a flight resolves - from the delivery's own
        // flight first, since populateFromOrderOrFlight has already copied
        // the order's onto it, and from the order only as a fallback for a
        // row written by some other caller. Tail-based where neither does:
        // FUEL_DELIVERIES carries no station field to fall back to, but
        // aircraft_reg is @mandatory, so it is the one dimension guaranteed
        // present.
        // ====================================================================
        this.before('CREATE', FuelDeliveries, async (req) => {
            if (req.data.delivery_number) return;

            let flightNumber = null;
            if (req.data.flight_ID) {
                const flight = await cds.db.run(SELECT.one
                    .from('fuelsphere.FLIGHT_SCHEDULE')
                    .columns('flight_number')
                    .where({ ID: req.data.flight_ID }));
                flightNumber = flight && flight.flight_number;
            }
            if (!flightNumber && req.data.order_ID) {
                const { FuelOrders } = this.entities;
                const order = await SELECT.one.from(FuelOrders)
                    .columns('flight_ID')
                    .where({ ID: req.data.order_ID });
                if (order && order.flight_ID) {
                    const flight = await cds.db.run(SELECT.one
                        .from('fuelsphere.FLIGHT_SCHEDULE')
                        .columns('flight_number')
                        .where({ ID: order.flight_ID }));
                    flightNumber = flight && flight.flight_number;
                }
            }

            // D46: an order with no flight still names a station, which is
            // what the original EPD-{STATION} format used. The tail is the
            // last resort, for a delivery raised against no order at all.
            let stationCode = null;
            if (!flightNumber && req.data.order_ID) {
                const { FuelOrders } = this.entities;
                const order = await SELECT.one.from(FuelOrders)
                    .columns('station_code').where({ ID: req.data.order_ID });
                stationCode = order && order.station_code;
            }

            try {
                if (flightNumber) {
                    req.data.delivery_number = await allocateDeliveryNumberByFlight(flightNumber, req.data.delivery_date);
                } else if (stationCode) {
                    req.data.delivery_number = await allocateDeliveryNumber(stationCode, req.data.delivery_date);
                } else if (req.data.aircraft_reg) {
                    req.data.delivery_number = await allocateDeliveryNumberByTail(req.data.aircraft_reg, req.data.delivery_date);
                }
            } catch (e) {
                if (reportAllocationError(req, e)) return;
                throw e;
            }
        });

        // ====================================================================
        // DELIVERY ACTIONS — same two simple status-transition actions
        // TicketService exposes for tickets. The heavier S/4-integration
        // actions (captureSignatures, reconcile, calculateTemperatureCorrection,
        // deriveGaugeReadings, validateDelivery) stay embedded-only in
        // FuelOrderService.FuelDeliveries - they depend on infrastructure
        // (signature documents, the tickets attached so far) that a delivery
        // freshly created through this standalone screen does not yet have.
        // ====================================================================

        this.on('verifyQuantity', FuelDeliveries, async (req) => {
            const delivery = await SELECT.one.from(FuelDeliveries).where({ ID: _id(req.params) });
            if (!delivery) return req.error(404, 'Delivery not found');
            if (!delivery.order_ID) {
                return req.error(400, 'This delivery has no linked Fuel Order to verify quantity against.');
            }

            const { FuelOrders } = this.entities;
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

        // ====================================================================
        // SERVICE-LEVEL FUNCTIONS
        // ====================================================================

        this.on('generateDeliveryNumber', async (req) => {
            const { stationCode, deliveryDate } = req.data;
            try {
                return await allocateDeliveryNumber(stationCode, deliveryDate);
            } catch (e) {
                if (reportAllocationError(req, e)) return;
                throw e;
            }
        });

        this.on('getDeliveriesByOrder', async (req) => {
            const { orderId } = req.data;
            if (!orderId) return req.error(400, 'Order ID is required.');
            return SELECT.from(FuelDeliveries).where({ order_ID: orderId });
        });

        await super.init();
    }
};

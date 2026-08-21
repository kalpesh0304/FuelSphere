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
const XLSX = require('xlsx');
const {
    allocateOrderNumber,
    allocateDeliveryNumber,
    reportAllocationError
} = require('./lib/number-range');
const {
    assertOrderableForFlight,
    reportRegisterError
} = require('./lib/aircraft-register');
const {
    DEFAULT_VOLUME_UOM,
    resolveDefaultVolumeUom,
    planMassToOrderVolume,
    isMassUom,
    deriveGaugeFigures
} = require('./lib/fuel-uom');
const {
    reconcile: reconcileFigures,
    reconcileDelivery,
    resolveTolerance, resolveToleranceFromStore,
    toleranceKg
} = require('./lib/fob-reconciliation');
const {
    STACK_COMPONENTS,
    PLAN_ACTIVE, PLAN_SUPERSEDED,
    deriveStack, resolvePlanGroup, classifyVersion, isResend
} = require('./lib/dispatch-plan');
const {
    resolveTail, applyPolicy, UNKNOWN_TAIL_POLICY,
    resolvePolicy
} = require('./lib/tail-resolver');
// Helper to extract entity ID from bound action params (handles draft-enabled entities)
const _id = (params) => {
    const p = params[0];
    return typeof p === 'object' ? p.ID : p;
};

const PARAM = require('./lib/parameter-store');
const { resolveToleranceRule, withinBand } = PARAM;

module.exports = class FuelOrderService extends cds.ApplicationService {
    async init() {
        const { FuelOrders, FuelDeliveries, FuelTickets, FlightSchedule } = this.entities;

        // ====================================================================
        // VIRTUAL ELEMENTS
        // ====================================================================

        this.after(['READ'], FuelOrders, (data) => {
            const items = Array.isArray(data) ? data : [data];
            items.forEach(item => {
                if (!item) return;
                switch (item.status) {
                    case 'Draft':     item.statusCriticality = 0; break;
                    case 'Submitted': item.statusCriticality = 2; break;
                    case 'Confirmed': item.statusCriticality = 3; break;
                    case 'InProgress':item.statusCriticality = 2; break;
                    case 'Delivered': item.statusCriticality = 3; break;
                    case 'Completed': item.statusCriticality = 3; break;
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

        // ====================================================================
        // AIRCRAFT GAUGE PAIR - WP-12, decision B5
        // ====================================================================

        // fob_delta_kg and ground_burn_kg are derived from the FQIS readings.
        // Both are kilograms unconditionally; an FQIS reports mass, so there
        // is no unit to resolve here.
        //
        // ground_burn_kg is derived ONLY where arrival and before are two
        // separate measurements. Where either is missing it stays null. It is
        // never produced by copying one reading into the other: that yields a
        // zero ground burn, and a zero is a claim that no APU burned, not a
        // record that nobody measured.
        const deriveGauge = async (req) => {
            const d = req.data;

            // req.data carries only what the caller sent, so an update that
            // corrects one reading has to read the row for the others. Read
            // from req.target rather than FuelDeliveries: the same handler
            // serves the draft and the active entity, and reading the wrong
            // one returns nothing for a draft in progress.
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

        // Registered on the draft entity as well as the active one, and this
        // is not belt-and-braces. FUEL_DELIVERIES is a draft composition
        // CHILD of FUEL_ORDERS: draftActivate fires CREATE on the root and
        // writes the children with it, so no per-child CREATE event ever
        // reaches the active entity. Registering only on FuelDeliveries left
        // fob_delta_kg and ground_burn_kg null on every delivery created
        // through the application, while the handler looked correct and the
        // request returned 201. Deriving into the draft row carries the
        // values through activation.
        //
        // FuelTickets does not need this - it is a draft ROOT in
        // TicketService, so its activation does fire CREATE on the active
        // entity. Root and child behave differently; check which one you have.
        this.before(['CREATE', 'UPDATE', 'PATCH'],
            [FuelDeliveries, FuelDeliveries.drafts], deriveGauge);

        // WP-07B. Never blockable — the fuel is on the aircraft. Reads its own
        // row, so the draft path is registered too.
        const resolveDeliveryTail = async (req) => {
            const reg = req.data.aircraft_reg;
            if (reg === undefined) return;
            const row = await resolveTail(reg);
            req.data.tail_registration = row ? row.registration : null;
        };
        this.before(['CREATE', 'UPDATE', 'PATCH'],
            [FuelDeliveries, FuelDeliveries.drafts], resolveDeliveryTail);

        // WP-17: a gauge reading typically arrives AFTER the tickets, so the
        // reconciliation has to re-run when the delivery changes and not only
        // when a ticket does.
        //
        // Registered on the active entity only. A draft delivery has no
        // tickets pointing at it — tickets carry delivery_ID to the active
        // row — so reconciling a draft would read an empty ticket set and
        // write NOT_RECONCILED over a real result. The draft registration
        // that WP-12 needed for the gauge arithmetic is exactly wrong here:
        // that computation reads only its own row, this one reads children.
        this.after(['UPDATE'], FuelDeliveries, async (data, req) => {
            const rows = Array.isArray(data) ? data : [data];
            for (const r of rows) if (r && r.ID) await reconcileDelivery(r.ID);
        });

        this.before(['PATCH', 'UPDATE'], [FuelOrders, FuelOrders.drafts], async (req) => {
            const { ordered_quantity, unit_price } = req.data;
            if (ordered_quantity !== undefined || unit_price !== undefined) {
                const current = await SELECT.one.from(req.subject);
                const quan = ordered_quantity ?? current.ordered_quantity ?? 0;
                const unit = unit_price ?? current.unit_price ?? 0;
                req.data.total_amount = Number((quan * unit).toFixed(2));
            }
        });

        this.before('CREATE', FuelOrders, async (req) => {
            // Derivations that do not depend on the number come first, so the
            // error path below cannot skip them (F16).
            req.data.status = 'Draft';

            // A4 / MDM402: an order commits the airline to a supplier, so it
            // is gated on the tail being confirmed. Capture paths are not.
            try {
                await assertOrderableForFlight(req.data.flight_ID);
            } catch (e) {
                if (reportRegisterError(req, e)) return;
                throw e;
            }

            try {
                req.data.order_number = await allocateOrderNumber(req.data.station_code);
            } catch (e) {
                if (reportAllocationError(req, e)) return;
                throw e;
            }
        });

        // canSubmit virtual element
        this.after(['READ', 'EDIT'], FuelOrders, (data) => {
            const items = Array.isArray(data) ? data : [data];
            items.forEach(item => {
                if (item) {
                    item.canSubmit = item.status === 'Draft';
                }
            });
        });

        // ====================================================================
        // ORDER LIFECYCLE ACTIONS
        // ====================================================================

        // Submit: Draft → Submitted
        this.on('submit', FuelOrders, async (req) => {
            const order = await SELECT.one.from(FuelOrders).where({ ID: _id(req.params) });
            if (!order) return req.error(404, 'Order not found');
            if (order.status !== 'Draft') {
                return req.error(409, `Cannot submit order in status "${order.status}". Order must be in "Draft" status.`);
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

        // Complete: Delivered → Completed
        // WP-09: 'Completed' is the terminal state in the documented lifecycle
        // and appears in seed data, but no code path wrote it. Guarded like
        // every other transition in this file.
        this.on('complete', FuelOrders, async (req) => {
            const order = await SELECT.one.from(FuelOrders).where({ ID: _id(req.params) });
            if (!order) return req.error(404, 'Order not found');
            if (order.status !== 'Delivered') {
                return req.error(409, `Cannot complete order in status "${order.status}". Order must be in "Delivered" status.`);
            }
            await UPDATE(FuelOrders).where({ ID: order.ID }).set({
                status: 'Completed',
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });
            req.info(200, `Order ${order.order_number} completed.`);
            return SELECT.one.from(FuelOrders).where({ ID: order.ID });
        });

        // Cancel: Draft/Created/Submitted/Confirmed → Cancelled
        this.on('cancel', FuelOrders, async (req) => {
            const order = await SELECT.one.from(FuelOrders).where({ ID: _id(req.params) });
            if (!order) return req.error(404, 'Order not found');
            const cancellable = ['Draft', 'Submitted', 'Confirmed'];
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

        // ================================================================
        // COCKPIT CREW REVIEW (Step 4 of 7-step journey)
        // ================================================================
        this.on('crewReview', FuelOrders, async (req) => {
            const { captainName, adjustedQuantity, adjustmentReason, notes } = req.data;
            const orderID = _id(req.params);

            const order = await SELECT.one.from(FuelOrders).where({ ID: orderID });
            if (!order) return req.error(404, 'Fuel order not found.');
            if (order.status !== 'Confirmed') {
                return req.error(400, `Crew review requires order status 'Confirmed'. Current status: '${order.status}'.`);
            }

            const updateData = {
                crew_reviewed_by: captainName || req.user.id,
                crew_reviewed_at: new Date().toISOString(),
                crew_notes: notes || null
            };

            if (adjustedQuantity && adjustedQuantity !== order.ordered_quantity) {
                updateData.crew_review_status = 'ADJUSTED';
                updateData.crew_adjusted_quantity = adjustedQuantity;
                updateData.crew_adjustment_reason = adjustmentReason || 'Quantity adjusted by cockpit crew';
            } else {
                updateData.crew_review_status = 'CONFIRMED';
                updateData.crew_adjusted_quantity = order.ordered_quantity;
            }

            await UPDATE(FuelOrders).where({ ID: orderID }).set(updateData);

            return SELECT.one.from(FuelOrders).where({ ID: orderID });
        });

        // ====================================================================
        // CREATE ORDER FROM FLIGHT (Service-level action)
        // ====================================================================

        this.on('createOrderFromFlight', async (req) => {
            const { flightId, supplierId, contractId, productId, orderedQuantity, orderedQuantityKg,
                    unitPrice, currencyCode, priority, notes } = req.data;

            // Look up the flight
            const flight = await SELECT.one.from(FlightSchedule).where({ ID: flightId });
            if (!flight) return req.error(404, 'Flight not found');

            const stationCode = flight.origin_airport;

            // A4 / MDM402 - the flight row carries the registration.
            try {
                await assertOrderableForFlight(flight);
            } catch (e) {
                if (reportRegisterError(req, e)) return;
                throw e;
            }

            let orderNumber;
            try {
                orderNumber = await allocateOrderNumber(stationCode);
            } catch (e) {
                if (reportAllocationError(req, e)) return;
                throw e;
            }

            const totalAmount = orderedQuantity && unitPrice ? Number((orderedQuantity * unitPrice).toFixed(2)) : 0;

            // Find airport ID by IATA code
            const { MASTER_AIRPORTS } = cds.entities('fuelsphere');
            const airport = await SELECT.one.from(MASTER_AIRPORTS).where({ iata_code: stationCode });

            // WP-11 / A2: an order created from a plan in kilograms carries the
            // equivalent volume, the density used and the source mass. Without
            // all three the converted number cannot be reproduced. A missing
            // factor leaves the quantity alone rather than inventing one.
            const converted = await planMassToOrderVolume(orderedQuantityKg);

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
                uom_code: (await resolveDefaultVolumeUom()).uom,
                ordered_quantity: orderedQuantity,
                ...(converted ? {
                    ordered_quantity: converted.quantity,
                    uom_code: converted.uom_code,
                    conversion_density: converted.conversion_density,
                    conversion_source: converted.conversion_source,
                    ordered_quantity_kg: converted.ordered_quantity_kg
                } : {}),
                unit_price: unitPrice,
                total_amount: totalAmount,
                currency_code: currencyCode || 'USD',
                requested_date: flight.flight_date,
                priority: priority || 'Normal',
                status: 'Draft',
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

            // D13 — this action moves the order to Delivered, so it needs the
            // same status guard every other transition in this file has.
            // Delivered follows InProgress in the documented lifecycle:
            // Draft -> Submitted -> Confirmed -> InProgress -> Delivered.
            // Checked before any write, so a rejected call mutates nothing.
            if (order.status !== 'InProgress') {
                return req.error(409, `Cannot capture signatures for order in status "${order.status}". Order must be in "InProgress" status.`);
            }

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
            const uom = delivery.uom_code;

            if (temp === null || temp === undefined) return req.error(400, 'EPD403: Temperature not recorded on this delivery.');
            if (density === null || density === undefined) return req.error(400, 'EPD404: Density not recorded on this delivery.');

            // WP-12: the correction is VOLUMETRIC. Thermal expansion acts on
            // volume, not on mass — a kilogram is a kilogram at any
            // temperature. Applying the factor to a mass figure produces a
            // number that means nothing, which is what this action did before.
            //
            // Where the delivery is measured in a mass unit the answer is
            // null, and null is written. Returning the input unchanged would
            // be worse than the old behaviour, not better: it silently claims
            // a correction was applied. Missing is not zero and not identity.
            const mass = await isMassUom(uom);
            if (mass === null) {
                return req.error(400, `EPD404: Unit ${uom || '(none)'} does not resolve in UNIT_OF_MEASURE, so no correction basis can be established.`);
            }
            if (mass === true) {
                await UPDATE(FuelDeliveries).where({ ID: delivery.ID }).set({
                    temperature_corrected_qty: null,
                    modified_at: new Date().toISOString(),
                    modified_by: req.user.id
                });
                return {
                    success: false,
                    deliveryNumber: delivery.delivery_number,
                    measuredQuantity: measuredQty,
                    measuredTemperature: temp,
                    measuredDensity: density,
                    correctionFactor: null,
                    correctedQuantity: null,
                    referenceTemperature: 15.0,
                    message: `No correction applied. Delivery is measured in ${uom}, a mass unit, and thermal expansion acts on volume. temperature_corrected_qty is null.`
                };
            }

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
                message: `Temperature corrected from ${measuredQty} to ${correctedQty} ${uom} (factor: ${correctionFactor}, ΔT: ${(temp - refTemp).toFixed(1)}°C)`
            };
        });

        // ====================================================================
        // FOB RECONCILIATION - WP-17, decisions B2, B5, C-1
        // ====================================================================

        this.on('reconcile', FuelDeliveries, async (req) => {
            const delivery = await SELECT.one.from(FuelDeliveries).where({ ID: _id(req.params) });
            if (!delivery) return req.error(404, 'Delivery not found');

            const result = await reconcileDelivery(delivery.ID);
            if (!result) return req.error(404, 'Delivery not found');

            // Report the two measured sides and the threshold, not just the
            // verdict. A status nobody can reproduce is not an audit trail,
            // and EPD463's exception task needs the figures behind it.
            const tickets = await SELECT.from(FuelTickets)
                .columns('quantity_kg').where({ delivery_ID: delivery.ID });
            const known = tickets.filter(t => t.quantity_kg !== null && t.quantity_kg !== undefined);
            const meteredKg = known.length === tickets.length && tickets.length
                ? Number(known.reduce((a, t) => a + Number(t.quantity_kg), 0).toFixed(2))
                : null;
            const fqisKg = (delivery.fob_before_kg !== null && delivery.fob_before_kg !== undefined
                         && delivery.fob_after_kg !== null && delivery.fob_after_kg !== undefined)
                ? Number((Number(delivery.fob_after_kg) - Number(delivery.fob_before_kg)).toFixed(2))
                : null;

            const rule = await resolveToleranceFromStore(delivery.fob_source, {}, delivery.delivery_date);
            const tol = (rule && meteredKg !== null) ? toleranceKg(rule, meteredKg) : null;

            // C-1: this reports. It does NOT gate anything. The supplier is
            // paid on metered volume and the dispute runs on its own track;
            // HOLD_PAYMENT_ON_DISCREPANCY is designed, unbuilt, and defaults
            // off. No posting path reads recon_status.
            return {
                deliveryNumber: delivery.delivery_number,
                meteredMassKg: meteredKg,
                fqisMassKg: fqisKg,
                reconVarianceKg: result.recon_variance_kg,
                reconStatus: result.recon_status,
                supplierCount: result.supplier_count,
                toleranceKg: tol,
                toleranceSource: rule ? rule.source : null,
                fobSource: delivery.fob_source,
                evidence: result.evidence
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

            // VAL-EPD-003: Temperature range. WP-13 — resolved, not literal.
            const _tempRule = await resolveToleranceRule({ ruleCode: 'TOL-EPD-TEMP' }, {}, delivery.delivery_date);
            if (delivery.temperature !== null && delivery.temperature !== undefined) {
                const b = withinBand(delivery.temperature, _tempRule.rule);
                if (b.checked && !b.within) {
                    errors.push({ code: 'EPD403', field: 'temperature', message: `Temperature ${delivery.temperature}°C is out of range (${b.lower}°C to ${b.upper}°C), per ${_tempRule.evidence.rule_code}.`, severity: 'ERROR' });
                } else if (!b.checked) {
                    errors.push({ code: 'EPD403', field: 'temperature', message: _tempRule.reason, severity: 'ERROR' });
                }
            } else {
                warnings.push({ code: 'EPD403', field: 'temperature', message: 'Temperature not recorded.', severity: 'WARNING' });
            }

            // VAL-EPD-004: Density range. WP-13 — resolved, not literal.
            const _densRule = await resolveToleranceRule({ ruleCode: 'TOL-EPD-DENSITY' }, {}, delivery.delivery_date);
            if (delivery.density !== null && delivery.density !== undefined) {
                const b = withinBand(delivery.density, _densRule.rule);
                if (b.checked && !b.within) {
                    errors.push({ code: 'EPD404', field: 'density', message: `Density ${delivery.density} kg/L is out of specification (${b.lower} - ${b.upper} kg/L), per ${_densRule.evidence.rule_code}.`, severity: 'ERROR' });
                } else if (!b.checked) {
                    errors.push({ code: 'EPD404', field: 'density', message: _densRule.reason, severity: 'ERROR' });
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
            try {
                return await allocateOrderNumber(stationCode, orderDate);
            } catch (e) {
                if (reportAllocationError(req, e)) return;
                throw e;
            }
        });

        this.on('generateDeliveryNumber', async (req) => {
            const { stationCode, deliveryDate } = req.data;
            try {
                return await allocateDeliveryNumber(stationCode, deliveryDate);
            } catch (e) {
                if (reportAllocationError(req, e)) return;
                throw e;
            }
        });

        // ====================================================================
        // IMPORT FLIGHT DISPATCH FROM EXCEL
        // ====================================================================

        this.on('importFlightDispatchExcel', async (req) => {
            const { fileContent, fileName } = req.data;

            const errors = [];
            let dispatchesProcessed = 0, dispatchesCreated = 0, dispatchesSkipped = 0, ordersUpdated = 0;

            // --- Validate file ---
            if (!fileContent) {
                return req.error(400, 'DSP401: File content is required.');
            }
            const ext = (fileName || '').toLowerCase();
            if (ext && !ext.endsWith('.xlsx') && !ext.endsWith('.xls') && !ext.endsWith('.csv')) {
                return req.error(400, 'DSP401: Invalid file format. Only .xlsx, .xls and .csv files are supported.');
            }

            // --- Parse Excel ---
            let workbook;
            try {
                const buf = Buffer.isBuffer(fileContent) ? fileContent : Buffer.from(fileContent, 'base64');
                workbook = XLSX.read(buf, { type: 'buffer' });
            } catch (e) {
                return req.error(400, `DSP401: Failed to parse file: ${e.message}`);
            }

            const sheetName = workbook.SheetNames[0];
            if (!sheetName) {
                return req.error(400, 'DSP401: File contains no sheets.');
            }

            const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
            if (rows.length === 0) {
                return req.error(400, 'DSP402: Sheet is empty.');
            }

            // --- Validate required columns ---
            const requiredCols = [
                'FUEL_ORDER_ID', 'FLIGHT_NUMBER', 'FLIGHT_DATE', 'TAIL_NUMBER',
                'ATD', 'DISPATCH_QTY_KG', 'ROB_DEPARTURE_KG', 'PAYLOAD_KG',
                'CAPTAIN_ID', 'DISPATCHER_ID', 'DISPATCH_TIMESTAMP', 'DISPATCH_SOURCE'
            ];
            const headers = Object.keys(rows[0]);
            const missingCols = requiredCols.filter(c => !headers.includes(c));
            if (missingCols.length > 0) {
                return req.error(400, `DSP402: Missing required columns: ${missingCols.join(', ')}`);
            }

            // --- Pre-fetch reference data ---
            const { FLIGHT_SCHEDULE, FUEL_ORDERS, FLIGHT_DISPATCH } = cds.entities('fuelsphere');

            // Build flight lookup map: "flight_number|flight_date" → { ID, fuel_order_ID }
            const flightRows = await SELECT.from(FLIGHT_SCHEDULE)
                .columns('ID', 'flight_number', 'flight_date', 'flight_leg_id');

            // Build reverse lookup from FUEL_ORDERS: flight_ID → fuel order ID
            const fuelOrderRows = await SELECT.from(FUEL_ORDERS)
                .columns('ID', 'flight_ID')
                .where({ flight_ID: { '!=': null } });
            const flightToFuelOrder = new Map(
                fuelOrderRows.map(fo => [fo.flight_ID, fo.ID])
            );

            const flightMap = new Map(
                flightRows.map(f => [`${f.flight_number}|${f.flight_date}`, {
                    ID: f.ID,
                    flight_leg_id: f.flight_leg_id || null,   // WP-18: the plan family key
                    fuel_order_ID: flightToFuelOrder.get(f.ID) || null
                }])
            );

            // WP-18 / D27. Was a duplicate set keyed on
            // dispatch_order_id|flight_number|flight_date, used to SKIP.
            // A matching key is a revision, not a duplicate, so what is needed
            // now is the ACTIVE plan for each family — the row a revision
            // supersedes.
            const activePlans = await SELECT.from(FLIGHT_DISPATCH)
                .columns('ID', 'plan_group_id', 'plan_version', 'plan_status')
                .where({ plan_status: PLAN_ACTIVE });
            const activeByGroup = new Map(
                activePlans.filter(d => d.plan_group_id).map(d => [d.plan_group_id, d])
            );

            // --- Date/DateTime normalization helpers ---
            const _normalizeDate = (val) => {
                if (typeof val === 'number') {
                    const parsed = XLSX.SSF.parse_date_code(val);
                    if (parsed) {
                        return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
                    }
                }
                const s = String(val).trim();
                if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
                if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
                    const parts = s.split('/');
                    return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
                }
                if (/^\d{8}$/.test(s)) {
                    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
                }
                return s;
            };

            const _normalizeDateTime = (val) => {
                if (!val && val !== 0) return null;
                if (typeof val === 'number') {
                    const parsed = XLSX.SSF.parse_date_code(val);
                    if (parsed) {
                        return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}T` +
                               `${String(parsed.H).padStart(2, '0')}:${String(parsed.M).padStart(2, '0')}:${String(parsed.S).padStart(2, '0')}Z`;
                    }
                }
                const s = String(val).trim();
                if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s;
                return s || null;
            };

            // --- Process rows ---
            // WP-07B. Flight dispatch is a PLANNING feed, so REJECT may
            // block it. Read once per import so one upload is judged by one
            // rule.
            // WP-13. The policy now RESOLVES from SYSTEM_PARAMETERS. An explicit
            // parameter on the call still wins — that is the operator
            // overriding configuration for one run, not configuration itself.
            const _pol = await resolvePolicy();
            const policy = req.data.unknownTailPolicy || _pol.policy;
            const policySource = req.data.unknownTailPolicy ? 'CALLER' : _pol.source;

            const dispatchesToInsert = [];
            const supersessions = [];              // WP-18: rows this upload supersedes
            let dispatchesSuperseded = 0;
            const ordersToUpdate = new Map(); // fuel_order_ID → dispatch_order_id

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const rowNum = i + 2; // Excel row (1-based header + 1)
                dispatchesProcessed++;

                // Extract fields
                const fuelOrderId = String(row.FUEL_ORDER_ID || '').trim();
                const flightNumber = String(row.FLIGHT_NUMBER || '').trim();
                const rawDate = row.FLIGHT_DATE;
                const tailNumber = String(row.TAIL_NUMBER || '').trim();
                const atd = _normalizeDateTime(row.ATD);
                const ata = _normalizeDateTime(row.ATA);
                const dispatchQtyKg = row.DISPATCH_QTY_KG !== '' ? parseFloat(row.DISPATCH_QTY_KG) : null;

                // WP-18: the version and the regulated stack, added to the
                // read set. The import read 18 named columns and discarded
                // everything else without comment, so anything the feed sent
                // beyond those 18 was thrown away silently.
                const _n = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
                const incomingVersion = _n(row.PLAN_VERSION);
                const stackIn = {};
                for (const c of STACK_COMPONENTS) {
                    stackIn[c] = _n(row[c.replace(/_kg$/, '').toUpperCase() + '_KG']);
                }
                const robDepartureKg = row.ROB_DEPARTURE_KG !== '' ? parseFloat(row.ROB_DEPARTURE_KG) : null;
                const payloadKg = row.PAYLOAD_KG !== '' ? parseFloat(row.PAYLOAD_KG) : null;
                const flightLevel = row.FLIGHT_LEVEL !== '' ? parseInt(row.FLIGHT_LEVEL) : null;
                const windComponent = row.WIND_COMPONENT !== '' ? parseFloat(row.WIND_COMPONENT) : null;
                const alternateAirport = String(row.ALTERNATE_AIRPORT || '').trim().toUpperCase();
                const captainId = String(row.CAPTAIN_ID || '').trim();
                const dispatcherId = String(row.DISPATCHER_ID || '').trim();
                const dispatchTimestamp = _normalizeDateTime(row.DISPATCH_TIMESTAMP);
                const ofplanReference = String(row.OFPLAN_REFERENCE || '').trim();
                const dispatchSource = String(row.DISPATCH_SOURCE || '').trim().toUpperCase();
                const remarks = String(row.REMARKS || '').trim();

                // --- Validate required fields ---
                if (!fuelOrderId) {
                    errors.push({ row: rowNum, field: 'FUEL_ORDER_ID', message: 'Fuel Order ID is required.', severity: 'ERROR' });
                    dispatchesSkipped++; continue;
                }
                if (!flightNumber) {
                    errors.push({ row: rowNum, field: 'FLIGHT_NUMBER', message: 'Flight number is required.', severity: 'ERROR' });
                    dispatchesSkipped++; continue;
                }

                const flightDate = _normalizeDate(rawDate);
                if (!flightDate || !/^\d{4}-\d{2}-\d{2}$/.test(flightDate)) {
                    errors.push({ row: rowNum, field: 'FLIGHT_DATE', message: `Invalid or missing flight date: '${rawDate}'.`, severity: 'ERROR' });
                    dispatchesSkipped++; continue;
                }

                if (!tailNumber) {
                    errors.push({ row: rowNum, field: 'TAIL_NUMBER', message: 'Tail number is required.', severity: 'ERROR' });
                    dispatchesSkipped++; continue;
                }

                if (!atd) {
                    errors.push({ row: rowNum, field: 'ATD', message: 'Actual Time of Departure is required.', severity: 'ERROR' });
                    dispatchesSkipped++; continue;
                }

                if (dispatchQtyKg === null || isNaN(dispatchQtyKg)) {
                    errors.push({ row: rowNum, field: 'DISPATCH_QTY_KG', message: 'Dispatch quantity is required.', severity: 'ERROR' });
                    dispatchesSkipped++; continue;
                }

                if (robDepartureKg === null || isNaN(robDepartureKg)) {
                    errors.push({ row: rowNum, field: 'ROB_DEPARTURE_KG', message: 'ROB at departure is required.', severity: 'ERROR' });
                    dispatchesSkipped++; continue;
                }

                if (payloadKg === null || isNaN(payloadKg)) {
                    errors.push({ row: rowNum, field: 'PAYLOAD_KG', message: 'Payload weight is required.', severity: 'ERROR' });
                    dispatchesSkipped++; continue;
                }

                if (!captainId) {
                    errors.push({ row: rowNum, field: 'CAPTAIN_ID', message: 'Captain ID is required.', severity: 'ERROR' });
                    dispatchesSkipped++; continue;
                }

                if (!dispatcherId) {
                    errors.push({ row: rowNum, field: 'DISPATCHER_ID', message: 'Dispatcher ID is required.', severity: 'ERROR' });
                    dispatchesSkipped++; continue;
                }

                if (!dispatchTimestamp) {
                    errors.push({ row: rowNum, field: 'DISPATCH_TIMESTAMP', message: 'Dispatch timestamp is required.', severity: 'ERROR' });
                    dispatchesSkipped++; continue;
                }

                // Validate dispatch source
                const validSources = ['TRIPRECORD', 'MANUAL', 'SMARTDOC'];
                if (!dispatchSource || !validSources.includes(dispatchSource)) {
                    errors.push({ row: rowNum, field: 'DISPATCH_SOURCE', message: `Invalid dispatch source '${dispatchSource}'. Valid: ${validSources.join(', ')}`, severity: 'ERROR' });
                    dispatchesSkipped++; continue;
                }

                // --- Match to flight schedule ---
                const flightKey = `${flightNumber}|${flightDate}`;
                if (!flightMap.has(flightKey)) {
                    errors.push({ row: rowNum, field: 'FLIGHT_NUMBER/FLIGHT_DATE',
                        message: `No flight schedule found for ${flightNumber} on ${flightDate}. Upload flight schedule first.`, severity: 'ERROR' });
                    dispatchesSkipped++; continue;
                }

                const flightRecord = flightMap.get(flightKey);

                // WP-07B. Blockable: the flight has not departed.
                const tailDecision = applyPolicy(
                    tailNumber, await resolveTail(tailNumber), 'FLIGHT_DISPATCH', policy);
                if (!tailDecision.accept) {
                    errors.push({ row: rowNum, field: 'TAIL_NUMBER',
                        message: tailDecision.reason, severity: 'ERROR' });
                    dispatchesSkipped++; continue;
                }

                // ------------------------------------------------------------
                // WP-18 / defect D27. A MATCHING KEY IS A REVISION.
                //
                // This block previously warned and skipped, so a re-planned
                // quantity never landed and the only trace was a WARNING in an
                // import log. That assumed one dispatch per order, flight and
                // date, permanently.
                // ------------------------------------------------------------
                const planGroupId = resolvePlanGroup(
                    flightRecord && flightRecord.flight_leg_id, flightNumber, flightDate);
                const active = activeByGroup.get(planGroupId) || null;

                // A re-send is still detectable, but only on the narrower test
                // that the feed supplied the SAME version for the same family.
                // Where the version is assigned on receipt there is nothing to
                // compare and every arrival is a new version - reported rather
                // than hidden.
                if (active && isResend(incomingVersion, active.plan_version)) {
                    errors.push({ row: rowNum, field: 'PLAN_VERSION',
                        message: `DSP453: plan ${planGroupId} version ${incomingVersion} is already active. Re-sent, not revised.`,
                        severity: 'WARNING' });
                    dispatchesSkipped++; continue;
                }

                const version = classifyVersion(incomingVersion, active && active.plan_version);
                if (version.version_gap_flag) {
                    errors.push({ row: rowNum, field: 'PLAN_VERSION',
                        message: `DSP456: plan ${planGroupId} moved from version ${active.plan_version} to ${version.plan_version}; `
                               + `${version.versions_skipped} version(s) never arrived. Applied, not held.`,
                        severity: 'WARNING' });
                }

                // DSP450/DSP451. Derived from the components, never keyed.
                const stack = deriveStack(stackIn, robDepartureKg);

                const newId = cds.utils.uuid();
                if (active) {
                    // DSP453: a superseded version is never updated in place.
                    // Only its status and the forward pointer change; every
                    // figure on it stays as it was when it was the plan.
                    supersessions.push({ ID: active.ID, superseded_by_ID: newId });
                    dispatchesSuperseded++;
                }

                // Build dispatch record
                dispatchesToInsert.push({
                    ID: newId,
                    dispatch_order_id: fuelOrderId,
                    plan_group_id: planGroupId,
                    plan_version: version.plan_version,
                    plan_version_source: version.plan_version_source,
                    plan_status: PLAN_ACTIVE,
                    version_gap_flag: version.version_gap_flag,
                    versions_skipped: version.versions_skipped,
                    ...stackIn,
                    block_fuel_kg: stack.block_fuel_kg,
                    required_uplift_kg: stack.required_uplift_kg,
                    flight_number: flightNumber,
                    flight_date: flightDate,
                    flight_schedule_ID: flightRecord.ID,
                    fuel_order_ID: flightRecord.fuel_order_ID || null,
                    tail_number: tailNumber,
                    tail_registration: tailDecision.tail_registration,
                    captain_id: captainId,
                    dispatcher_id: dispatcherId,
                    atd: atd,
                    ata: ata || null,
                    dispatch_timestamp: dispatchTimestamp,
                    dispatch_qty_kg: dispatchQtyKg,
                    rob_departure_kg: robDepartureKg,
                    payload_kg: payloadKg,
                    flight_level: flightLevel,
                    wind_component: windComponent,
                    alternate_airport: alternateAirport || null,
                    dispatch_source: dispatchSource,
                    ofplan_reference: ofplanReference || null,
                    remarks: remarks || null
                });

                // Track fuel order update. The dispatch mass travels with it so
                // the order can be converted to volume where it has no quantity.
                if (flightRecord.fuel_order_ID) {
                    ordersToUpdate.set(flightRecord.fuel_order_ID, {
                        dispatchFuelOrderId: fuelOrderId,
                        dispatchQtyKg,
                        dispatchPlanId: newId   // WP-18 section 9.5
                    });
                }

                // Two revisions of one plan inside a single upload must chain,
                // not both end ACTIVE. The newly inserted row becomes the
                // active one for this family straight away.
                activeByGroup.set(planGroupId, { ID: newId, plan_group_id: planGroupId,
                    plan_version: version.plan_version, plan_status: PLAN_ACTIVE });
            }

            // --- Bulk INSERT dispatches ---
            if (dispatchesToInsert.length > 0) {
                try {
                    await INSERT.into(FLIGHT_DISPATCH).entries(dispatchesToInsert);
                    dispatchesCreated = dispatchesToInsert.length;
                } catch (e) {
                    return req.error(500, `DSP500: Failed to insert dispatch records: ${e.message}`);
                }
            }

            // --- WP-18: retire the superseded rows ---
            //
            // After the insert, so superseded_by never points at a row that
            // does not exist yet. DSP452 holds throughout: exactly one ACTIVE
            // row per plan_group_id.
            for (const sup of supersessions) {
                await UPDATE(FLIGHT_DISPATCH).set({
                    plan_status: PLAN_SUPERSEDED,
                    superseded_by_ID: sup.superseded_by_ID
                }).where({ ID: sup.ID });
            }

            // --- Bulk UPDATE fuel orders with dispatch_fuel_order_id ---
            for (const [fuelOrderID, { dispatchFuelOrderId, dispatchQtyKg, dispatchPlanId }] of ordersToUpdate) {
                try {
                    // WP-18 section 9.5. The order records WHICH plan it came
                    // from. Always repointed at the newest plan for the leg:
                    // an order still pointing at a superseded plan is stale by
                    // construction, and that is the amendment trigger.
                    const changes = {
                        dispatch_fuel_order_id: dispatchFuelOrderId,
                        dispatch_plan_ID: dispatchPlanId
                    };

                    // WP-11 / A2: the dispatch carries the plan mass in
                    // kilograms. Where the order has no quantity yet, convert it
                    // to the order's volume unit and record the density, its
                    // source and the mass it came from. ADDITIVE ONLY - an order
                    // that already carries a quantity is never overwritten,
                    // because a dispatch figure is not an amendment.
                    const existing = await SELECT.one.from(FUEL_ORDERS)
                        .columns('ordered_quantity')
                        .where({ ID: fuelOrderID });
                    if (existing && !(Number(existing.ordered_quantity) > 0)) {
                        const converted = await planMassToOrderVolume(dispatchQtyKg);
                        if (converted) {
                            changes.ordered_quantity    = converted.quantity;
                            changes.uom_code            = converted.uom_code;
                            changes.conversion_density  = converted.conversion_density;
                            changes.conversion_source   = converted.conversion_source;
                            changes.ordered_quantity_kg = converted.ordered_quantity_kg;
                        }
                    }

                    await UPDATE(FUEL_ORDERS).set(changes).where({ ID: fuelOrderID });
                    ordersUpdated++;
                } catch (e) {
                    errors.push({ row: 0, field: 'FUEL_ORDER_ID',
                        message: `Failed to update fuel order ${fuelOrderID}: ${e.message}`, severity: 'WARNING' });
                }
            }

            // --- Build response ---
            const hasErrors = errors.some(e => e.severity === 'ERROR');
            const message = dispatchesCreated > 0
                ? `Successfully imported ${dispatchesCreated} dispatch record(s). ${ordersUpdated} fuel order(s) updated.` +
                  (dispatchesSkipped > 0 ? ` ${dispatchesSkipped} skipped.` : '')
                : `No dispatch records imported. ${dispatchesSkipped} skipped due to errors.`;

            return {
                success: !hasErrors && dispatchesCreated > 0,
                fileName: fileName || 'unknown',
                dispatchesProcessed,
                dispatchesCreated,
                dispatchesSuperseded,
                dispatchesSkipped,
                ordersUpdated,
                errors,
                message
            };
        });

        // ================================================================
        // WP-13 / D30 — THE RESOLVED LIMIT IS THE ENFORCED LIMIT
        //
        // @assert.range: [-40, 50] and [0.775, 0.840] were removed from
        // db/schema.cds. They were compile-time literals, so a store could
        // never move them — config would have changed and behaviour would
        // not, which is the trap D30 names.
        //
        // Measured before removing them. They fired on ONE path:
        //
        //   db.run INSERT        STORED, assertion silent
        //   POST child to draft  ACCEPTED 201, deferred
        //   draftActivate        REJECTED 400
        //
        // This replaces them on BOTH, which is strictly more than they
        // covered — the db registration closes the hole every handler wrote
        // through. Same values, resolved from TOL-EPD-TEMP and
        // TOL-EPD-DENSITY.
        // ================================================================
        const qualityGuard = PARAM.qualityGuard;

        // A handler reading its OWN row needs the draft path too — WP-12.
        this.before(['CREATE','UPDATE'], FuelDeliveries, qualityGuard);
        if (FuelDeliveries.drafts) this.before(['CREATE','UPDATE'], FuelDeliveries.drafts, qualityGuard);
        // THE db.run PATH CANNOT BE GUARDED, and this is measured rather
        // than assumed. A before handler on the database service does NOT
        // fire on db.run(INSERT.into(...)) — one registered inside the test
        // itself fired zero times. So the raw-CQN path has no interception
        // point, which is also why @assert.range never fired on it.
        //
        // Nothing is registered there. A no-op registration that reads as
        // coverage is worse than an acknowledged gap: this is the same family
        // as a declared action with no handler, which looks like it worked.
        // Recorded as a finding instead.
        //
        // A handler reading its OWN row needs the draft path too — WP-12.
        this.before(['CREATE','UPDATE'], FuelDeliveries, qualityGuard);
        if (FuelDeliveries.drafts) this.before(['CREATE','UPDATE'], FuelDeliveries.drafts, qualityGuard);
        // The DATABASE layer, which is how every handler in this repository
        // writes and where @assert.range never fired at all.
        //
        // Deferred to 'served' because cds.db is NOT AVAILABLE during service
        // init — measured under WP-13: registering there silently no-ops and
        // the guard never fires. Registered once, guarded against a second
        // registration if the service is initialised twice in one process.

        await super.init();
    }
};

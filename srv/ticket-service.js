/**
 * FuelSphere - Ticket Service Handler
 * Standalone service for independent Fuel Ticket management
 * Allows creating/managing tickets outside the FuelOrders draft flow
 */

const cds = require('@sap/cds');
const { SELECT, UPDATE } = cds.ql;
const { allocateTicketNumber, allocateTicketNumberByFlight, reportAllocationError } = require('./lib/number-range');
const { deriveTicketMeasurement, fieldReader, applyDensityFieldControl } = require('./lib/ticket-measurement');
const { isMassUom } = require('./lib/fuel-uom');
const { postTicketUplift } = require('./lib/rob-uplift');
const { reconcileDelivery } = require('./lib/fob-reconciliation');
const { resolveTail } = require('./lib/tail-resolver');

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

        // Density is mandatory where the quantity is in litres - see
        // applyDensityFieldControl. Registered on the draft too: the create
        // screen is a draft, and that is where the asterisk has to appear.
        this.after(['READ'], [FuelTickets, FuelTickets.drafts], async (data) => {
            await applyDensityFieldControl(data, isMassUom);
        });

        // Drafts too. statusCriticality is a `virtual null as ...` element:
        // no column holds it, so a read that skips this handler returns the
        // property ABSENT rather than null, and a UI that binds it cannot
        // resolve it - the list binding never completes and the page hangs
        // on a busy indicator. That is exactly what FuelOrderService's copy
        // of this handler did to the Fuel Order page until it was registered
        // on the drafts.
        //
        // It has never bitten HERE only because this app's LineItem computes
        // criticality with an inline $edmJson expression instead of binding
        // the virtual element, so it is never requested. That is a reason it
        // is dormant, not a reason it is safe: binding the element anywhere
        // on a draft screen would hang this app the same way.
        this.after(['READ'], [FuelTickets, FuelTickets.drafts], (data) => {
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

        // WP-12 / B5, B6: derive the metered quantity and the canonical mass.
        //
        // Store as metered, derive canonical. The as-metered figure is what
        // the supplier invoices and what a dispute is about, so it is never
        // overwritten — only quantity_metered and quantity_kg are derived.
        //
        // Runs on CREATE and UPDATE alike: a meter reading corrected after
        // capture must re-derive, or quantity_kg silently keeps the old mass.
        const deriveMeasurement = async (req) => {
            const d = req.data;

            // On anything but CREATE req.data carries only what changed, so
            // the derivation has to read the stored row for the inputs the
            // caller did not send. Without this, correcting a meter reading
            // alone would null quantity_kg because density arrived undefined.
            //
            // Read from req.target, not from FuelTickets: the same handler
            // serves the draft and the active entity, and reading the wrong
            // one returns nothing for a draft in progress. Same reasoning as
            // deriveGauge in order-service.js.
            let stored = {};
            if (req.event !== 'CREATE') {
                const id = req.data.ID || _id(req.params);
                if (id) {
                    stored = await SELECT.one.from(req.target)
                        .columns('quantity', 'uom_code', 'quantity_metered',
                                 'density_value', 'density_uom', 'meter_start', 'meter_end',
                                 'rate_per_litre')
                        .where({ ID: id }) || {};
                }
            }
            const { values, error, warning } =
                await deriveTicketMeasurement(fieldReader(d, stored));
            if (error) return req.error(400, error);
            if (warning) req.warn(200, warning);
            Object.assign(d, values);
        };

        // Registered on the draft too, so the metered quantity, the mass and
        // the amount fill in AS THE OPERATOR TYPES the meter readings and the
        // rate, rather than only once the ticket is activated. EPD411 lands
        // on the draft with them, which is where a meter span running
        // backwards is worth catching.
        this.before(['CREATE', 'UPDATE', 'PATCH'], [FuelTickets, FuelTickets.drafts], deriveMeasurement);

        // WP-07B. A ticket is NEVER blockable, whatever UNKNOWN_TAIL_POLICY
        // says. Fuel is already in the tanks when a ticket is written, and
        // refusing to record it puts money outside the system — decision A1.
        // So the tail resolves or it does not, and the ticket lands either
        // way with aircraft_reg carrying the registration.
        //
        // Registered on the draft entity too: this reads its OWN row, and a
        // draft-enabled entity writes the draft first. The opposite of the
        // reconciliation hook, which reads children and must wait.
        const resolveTicketTail = async (req) => {
            const reg = req.data.aircraft_reg;
            if (reg === undefined) return;
            const row = await resolveTail(reg);
            req.data.tail_registration = row ? row.registration : null;
        };
        this.before(['CREATE', 'UPDATE'], [FuelTickets, FuelTickets.drafts], resolveTicketTail);

        // WP-17: the metered side of the reconciliation is the sum of the
        // tickets, so any change to a ticket's mass, its delivery or its order
        // changes the delivery's variance. Re-derive rather than let the
        // stored figure drift — a stale variance is worse than none, because
        // it reads as a measurement.
        //
        // Registered after the write, not before: the computation reads the
        // delivery's tickets, so it needs this one to have landed.
        this.after(['CREATE', 'UPDATE'], FuelTickets, async (data, req) => {
            const rows = Array.isArray(data) ? data : [data];
            const ids = new Set();
            for (const r of rows) {
                if (r && r.delivery_ID) ids.add(r.delivery_ID);
            }
            if (req.data && req.data.delivery_ID) ids.add(req.data.delivery_ID);
            for (const id of ids) await reconcileDelivery(id);
        });

        // The uplift reaches the ROB ledger. After the write, not before:
        // this reads the ticket's own derived mass and amount, and both are
        // set by the before-handlers above. Registered on CREATE only - a
        // correction to an existing ticket must not post the same fuel
        // twice, and postTicketUplift refuses a second row for a ticket it
        // has already posted anyway.
        this.after('CREATE', FuelTickets, async (data, req) => {
            for (const row of (Array.isArray(data) ? data : [data])) {
                if (!row) continue;
                const { reason } = await postTicketUplift(row);
                if (reason) req.info(200, `ROB ledger not updated: ${reason}.`);
            }
        });

        // ====================================================================
        // ORDER-DRIVEN AUTO-POPULATION — live, during draft editing.
        //
        // Fires on every PATCH to the draft (not just at final activation),
        // so the create screen visibly fills in flight_number and
        // aircraft_reg as soon as the user picks a Fuel Order via F4 - not
        // only after they hit the final Create/Save button.
        //
        // Registered on the draft only. Once activated the fields are
        // already set from here; re-deriving on every subsequent edit of an
        // ACTIVE ticket would silently overwrite a value someone corrected
        // by hand after the fact for an unrelated reason.
        // ====================================================================
        const populateFromOrder = async (req) => {
            // Resolve the order this ticket is linked to from THIS request
            // if it is being set right now; otherwise from whatever the
            // draft row already has stored. Covers both "order_ID is the
            // field that just changed" and "some OTHER field changed on a
            // draft that already has an order" - a value-help selection
            // that does not land in req.data the way a typed value does
            // would otherwise silently skip population entirely.
            let orderId = req.data.order_ID;
            if (orderId === undefined) {
                const id = req.data.ID || _id(req.params);
                if (!id) return;
                const stored = await SELECT.one.from(FuelTickets.drafts)
                    .columns('order_ID')
                    .where({ ID: id });
                orderId = stored && stored.order_ID;
            }
            if (!orderId) return; // cleared, or genuinely no order yet

            const { FuelOrders } = this.entities;
            const order = await SELECT.one.from(FuelOrders)
                .columns('flight_ID', 'uom_code', 'supplier_ID')
                .where({ ID: orderId });
            if (!order) return;

            if (order.flight_ID) {
                // The order's flight becomes the ticket's own, so flight_date
                // reaches the screen through one association rather than a
                // second column kept in step by hand.
                req.data.flight_ID = order.flight_ID;
                const flight = await cds.db.run(SELECT.one
                    .from('fuelsphere.FLIGHT_SCHEDULE')
                    .columns('flight_number', 'aircraft_reg')
                    .where({ ID: order.flight_ID }));
                if (flight) {
                    req.data.flight_number = flight.flight_number;
                    if (req.data.aircraft_reg === undefined) req.data.aircraft_reg = flight.aircraft_reg;
                }
            }
            if (req.data.uom_code === undefined && order.uom_code) req.data.uom_code = order.uom_code;

            // Defaulted from the order's own supplier, so the field starts
            // with something traceable rather than blank - the ticket's
            // OWN reference (what the supplier printed on their paperwork)
            // still overwrites it the moment the user types one.
            if (req.data.supplier_ticket_ref === undefined && order.supplier_ID) {
                const supplier = await SELECT.one.from('fuelsphere.MASTER_SUPPLIERS')
                    .columns('supplier_code')
                    .where({ ID: order.supplier_ID });
                if (supplier && supplier.supplier_code) req.data.supplier_ticket_ref = supplier.supplier_code;
            }
        };
        // Registered on both the draft and the active entity, CREATE/UPDATE/
        // PATCH alike - matches order-service.js's proven pattern for this
        // shape of hook exactly (resolveDeliveryTail et al).
        this.before(['CREATE', 'UPDATE', 'PATCH'], [FuelTickets, FuelTickets.drafts], populateFromOrder);

        // ====================================================================
        // FLIGHT-DRIVEN AUTO-POPULATION — the alternative to picking an
        // order. Only acts where there is no order on the row: once one is
        // picked, populateFromOrder above owns flight_number/aircraft_reg
        // and this backs off, the same way it backs off any field the
        // caller already set.
        // ====================================================================
        const populateFromFlight = async (req) => {
            if (req.data.flight_ID === undefined) return;

            let orderId = req.data.order_ID;
            if (orderId === undefined) {
                const id = req.data.ID || _id(req.params);
                if (id) {
                    const stored = await SELECT.one.from(FuelTickets.drafts)
                        .columns('order_ID')
                        .where({ ID: id });
                    orderId = stored && stored.order_ID;
                }
            }
            if (orderId) return; // an order is set - that hook owns these fields

            if (!req.data.flight_ID) {           // flight cleared
                req.data.flight_number = null;
                req.data.aircraft_reg = null;
                return;
            }

            const flight = await cds.db.run(SELECT.one
                .from('fuelsphere.FLIGHT_SCHEDULE')
                .columns('flight_number', 'aircraft_reg')
                .where({ ID: req.data.flight_ID }));
            if (!flight) return;
            req.data.flight_number = flight.flight_number;
            req.data.aircraft_reg = flight.aircraft_reg;
        };
        this.before(['CREATE', 'UPDATE', 'PATCH'], [FuelTickets, FuelTickets.drafts], populateFromFlight);

        this.before('CREATE', FuelTickets, async (req) => {
            // NOT gated on order or flight - decision A1: fuel is routinely
            // delivered with no order in the system at all (a verbal
            // post-freeze top-up, an uncontracted station), and this app
            // must accept that ticket same as any other capture path does.
            // Picking an order or a flight is offered, not required; either
            // one is enough to number by, but neither is enough to refuse
            // the ticket for lacking.
            req.data.match_status = req.data.order_ID ? 'MATCHED' : 'UNMATCHED';

            // Auto-generate internal number if not provided
            if (req.data.internal_number) return;

            const { FuelOrders } = this.entities;

            // Resolved independently of populateFromOrder above, so
            // numbering does not depend on the draft-PATCH hook having run
            // for this exact field on this exact request.
            let flightNumber = req.data.flight_number || null;
            if (!flightNumber && req.data.order_ID) {
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

            if (flightNumber) {
                try {
                    req.data.internal_number = await allocateTicketNumberByFlight(flightNumber, req.data.delivery_timestamp);
                } catch (e) {
                    if (reportAllocationError(req, e)) return;
                    throw e;
                }
                return;
            }

            // No flight traceable - either the order exists but carries none
            // (D46), or there is no order at all. Numbered by station where
            // an order at least gives one; left unnumbered (as before this
            // app existed) where there is truly nothing to number from,
            // rather than refusing the ticket outright (decision A1).
            if (!req.data.order_ID) return;
            const order = await SELECT.one.from(FuelOrders)
                .columns('station_code')
                .where({ ID: req.data.order_ID });
            if (!order || !order.station_code) return;
            try {
                req.data.internal_number = await allocateTicketNumber(order.station_code);
            } catch (e) {
                if (reportAllocationError(req, e)) return;
                throw e;
            }
        });

        // ====================================================================
        // TICKET ACTIONS
        // ====================================================================

        // ====================================================================
        // CAPTURE A TICKET AGAINST AN ORDER — THE ONE WRITER.
        //
        // FuelOrderService.FuelOrders offers a bound form of this so a clerk
        // can raise a ticket from the order in front of them; that handler
        // delegates here and writes nothing. D44 is two independent
        // implementations of one rule disagreeing one day with nothing to
        // notice.
        //
        // THE INSERT GOES THROUGH THIS SERVICE'S OWN ENTITY so the before-
        // CREATE hooks above run: deriveMeasurement for quantity_metered and
        // quantity_kg, resolveTicketTail for the registration, and the
        // numbering hook for match_status and internal_number. Writing to the
        // database directly would bypass all four and leave a ticket with a
        // null mass and no number.
        //
        // NO GATE. Decision A1: the fuel is in the tanks before a ticket
        // exists, so capture is never refused. The only refusal reachable
        // from here is EPD411 on a meter span that runs backwards, which is
        // an impossible reading rather than a business rule.
        // ====================================================================
        this.on('captureTicketForOrder', async (req) => {
            const d = req.data;
            if (!d.orderId) return req.error(400, 'No order given.');

            // FUEL_ORDERS CARRIES NO REGISTRATION. It has `flight` and nothing
            // else naming a tail - no aircraft_reg, no tail - which is D46 seen
            // from this side: the order's registration is the FLIGHT's, and an
            // order without a flight has none. Selecting `aircraft_reg` here
            // failed loudly, which is the one mercy: a SELECT is checked
            // against the model where an INSERT's keys are not.
            const { FuelOrders } = this.entities;
            const order = await SELECT.one.from(FuelOrders)
                .columns('ID', 'station_code', 'uom_code', 'flight_ID')
                .where({ ID: d.orderId });
            if (!order) return req.error(404, `Order ${d.orderId} not found.`);

            const ID = cds.utils.uuid();
            const row = {
                ID,
                order_ID: order.ID,
                ticket_number: d.ticketNumber,
                quantity: d.quantity,
                delivery_timestamp: d.deliveryTimestamp,
                meter_start: d.meterStart ?? null,
                meter_end: d.meterEnd ?? null,
                density_value: d.densityValue ?? null,
                density_uom: d.densityUom ?? null,
                density_temp_c: d.densityTempC ?? null,
                vehicle_id: d.vehicleId ?? null,
                meter_serial: d.meterSerial ?? null,
                supplier_ticket_ref: d.supplierTicketRef ?? null
            };
            // BOTH CARRY AN ENTITY DEFAULT, so only send them when the caller
            // named one. Sending undefined would not override the default, but
            // sending null WOULD - and a null uom_code makes the mass
            // derivation decline with "no uom_code on the ticket".
            if (d.uomCode) row.uom_code = d.uomCode;
            if (d.densityBasis) row.density_basis = d.densityBasis;

            // THE REGISTRATION COMES FROM THE ORDER'S FLIGHT, and only where
            // there is one. `resolveTicketTail` does NOT look a tail up - it
            // reads `req.data.aircraft_reg` and returns early when it is
            // undefined - so supplying this string is what makes the tail
            // resolve. Eleven of twenty-five orders have no flight (D46), and
            // those tickets land with a null tail, which A1 permits.
            if (order.flight_ID) {
                const flight = await cds.db.run(SELECT.one
                    .from('fuelsphere.FLIGHT_SCHEDULE')
                    .columns('aircraft_reg', 'flight_number')
                    .where({ ID: order.flight_ID }));
                if (flight) {
                    if (flight.aircraft_reg) row.aircraft_reg = flight.aircraft_reg;
                    if (flight.flight_number) row.flight_number = flight.flight_number;
                }
            }

            // THROUGH THE SERVICE, NOT THROUGH THE DATABASE — and the
            // difference is every derivation this action depends on.
            //
            // `INSERT.into(FuelTickets)` inside a handler dispatches to the
            // DATABASE on the ambient transaction. It lands a row and fires
            // NONE of this service's before-CREATE hooks: measured, the ticket
            // arrived with a null quantity_metered, a null quantity_kg, a null
            // internal_number, match_status left at UNMATCHED despite having an
            // order, and a meter span running BACKWARDS accepted with 200
            // where EPD411 should have refused it.
            //
            // `this.run(...)` dispatches through the service, so the four hooks
            // run and the ambient request's user comes with it. A bare
            // srv.run() from outside a request is 401 — the @restrict is
            // evaluated, and there is no user to evaluate it against.
            await this.run(INSERT.into(FuelTickets).entries(row));
            return await SELECT.one.from(FuelTickets).where({ ID });
        });

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

            // WP-17: the delivery gains a ticket, and may have lost one.
            await reconcileDelivery(deliveryId);
            if (ticket.delivery_ID && ticket.delivery_ID !== deliveryId) {
                await reconcileDelivery(ticket.delivery_ID);
            }

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

            // WP-17: matching supplies the ticket's supplier, so a delivery
            // that read NOT_ATTRIBUTABLE for an unresolved ticket may now
            // attribute — or may turn out to have two suppliers after all.
            if (ticket.delivery_ID) await reconcileDelivery(ticket.delivery_ID);

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

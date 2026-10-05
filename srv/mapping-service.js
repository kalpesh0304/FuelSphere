const cds = require('@sap/cds');
const { SELECT } = cds.ql;

/**
 * FuelSphere - S/4 mapping maintenance, and what the posting reads.
 *
 * TWO JOBS IN ONE FILE:
 *
 *   1. Keeping the four mapping tables honest as they are typed. Every rule
 *      here exists because a wrong row does not fail loudly - it posts a
 *      purchase order against the wrong contract, and the argument happens
 *      weeks later with the supplier.
 *
 *   2. Answering postingData(ticketID) - everything the S/4 documents need
 *      for one ticket, resolved in one place.
 *
 * ERROR CODES use the CAR4xx prefix, reserved in docs/design/05-CONVENTIONS.md
 * for carrier arrangement resolution and unused until now.
 */

// ---------------------------------------------------------------------------
// DATES AND OVERLAP
// ---------------------------------------------------------------------------

const day = (v) => (v ? String(v).slice(0, 10) : null);

/**
 * Do two validity windows share a day?
 *
 * An open end - valid_to null - runs forever, which is the common case here:
 * most mappings are entered once and never closed. Written out rather than
 * done with dates, because a null on either side is the whole question.
 */
function overlaps(fromA, toA, fromB, toB) {
    const a1 = day(fromA), a2 = day(toA);
    const b1 = day(fromB), b2 = day(toB);
    if (!a1 || !b1) return false;                  // an unfinished draft cannot clash
    if (a2 && a2 < b1) return false;               // A closes before B opens
    if (b2 && b2 < a1) return false;               // B closes before A opens
    return true;
}

/** The day a mapping is read for - a ticket's delivery date, or today. */
const asOf = (stamp) => day(stamp) || new Date().toISOString().slice(0, 10);

function inWindow(row, date) {
    const from = day(row.valid_from), to = day(row.valid_to);
    return (!from || from <= date) && (!to || to >= date);
}

module.exports = cds.service.impl(async function () {

    const { Carriers, StationPlantMappings, StationSupplierMappings,
            FlightSupplierMappings } = this.entities;

    const PLANT_MAP    = 'fuelsphere.STATION_PLANT_MAP';
    const SUPPLIER_MAP = 'fuelsphere.STATION_SUPPLIER_MAP';
    const FLIGHT_MAP   = 'fuelsphere.FLIGHT_SUPPLIER_MAP';

    // =======================================================================
    // 1. CARRIERS
    // =======================================================================

    this.before('SAVE', Carriers, (req) => {
        const row = req.data;
        if (row.carrier_code) req.data.carrier_code = String(row.carrier_code).toUpperCase().trim();
        if (row.company_code) req.data.company_code = String(row.company_code).toUpperCase().trim();
    });

    // =======================================================================
    // 2. STATION TO PLANT
    // =======================================================================

    this.before('SAVE', StationPlantMappings, async (req) => {
        const row = req.data;
        await checkWindow(req, row);

        // The timezone the airport already knows, unless somebody typed one.
        if (!row.timezone && row.airport_ID) {
            const airport = await SELECT.one.from('fuelsphere.MASTER_AIRPORTS')
                .columns('timezone').where({ ID: row.airport_ID });
            if (airport && airport.timezone) req.data.timezone = airport.timezone;
        }

        // CAR403. One station is one plant for one carrier at a time. Two
        // overlapping rows would make the purchase order's plant a coin toss.
        await refuseOverlap(req, {
            table: PLANT_MAP,
            where: { airport_ID: row.airport_ID, carrier_carrier_code: row.carrier_carrier_code },
            code: 'CAR403',
            what: 'a plant mapping for this station and carrier'
        });
    });

    // =======================================================================
    // 3. STATION TO SUPPLIER AND CONTRACT LINE
    // =======================================================================

    this.before('SAVE', StationSupplierMappings, async (req) => {
        const row = req.data;
        await checkWindow(req, row);

        // CAR402. THE RULE THAT REPLACED THE SERIAL NUMBER. A station and
        // carrier may name as many suppliers as it likes - that is the point
        // of the table - but the same supplier twice, with overlapping dates,
        // is two answers to one question. An EXPIRED row does not block: that
        // is how a contract line is re-entered after it lapses.
        await refuseOverlap(req, {
            table: SUPPLIER_MAP,
            where: {
                airport_ID: row.airport_ID,
                carrier_carrier_code: row.carrier_carrier_code,
                supplier_ID: row.supplier_ID
            },
            code: 'CAR402',
            what: 'a mapping for this station, carrier and supplier'
        });

        // CAR401. THE CONTRACT MUST BELONG TO THE SUPPLIER.
        //
        // This is the check that is always right, whatever else is true: fuel
        // bought from World Fuel cannot post against Shell's contract. It is
        // hard, and it traps nobody - the pairing is wrong in every state of
        // the master data.
        //
        // What it deliberately does NOT check is whether the contract already
        // lists this station. A contract signed this morning has no locations
        // recorded yet, and refusing the mapping until somebody fills them in
        // would block the tables the transactional apps are built on. That is
        // CAR409 below: reported, not refused.
        if (row.contract_ID && row.supplier_ID) {
            const contract = await SELECT.one.from('fuelsphere.MASTER_CONTRACTS')
                .columns('ID', 'supplier_ID', 'contract_number', 'is_active', 'valid_to')
                .where({ ID: row.contract_ID });

            if (contract && contract.supplier_ID !== row.supplier_ID) {
                const owner = await supplierName(contract.supplier_ID);
                req.error(400, `CAR401: Contract ${contract.contract_number} belongs to ${owner}, `
                    + 'not to the supplier chosen here.', 'contract_ID');
            } else if (contract && contract.is_active === false) {
                req.error(400, `CAR401: Contract ${contract.contract_number} is not active.`, 'contract_ID');
            }
        }

        // CAR409. The contract does not list this station yet.
        //
        // Legitimate on a new contract, and worth saying out loud: the station
        // coverage on the contract is what the pricing and reporting read, so
        // a mapping that runs ahead of it will look inconsistent until
        // somebody catches up.
        if (row.contract_ID && row.airport_ID) {
            const covers = await SELECT.one.from('fuelsphere.CONTRACT_LOCATIONS')
                .columns('ID').where({ contract_ID: row.contract_ID, airport_ID: row.airport_ID });

            if (!covers) {
                const airport = await SELECT.one.from('fuelsphere.MASTER_AIRPORTS')
                    .columns('iata_code').where({ ID: row.airport_ID });
                req.info(200, `CAR409: this contract does not list ${airport ? airport.iata_code : 'this station'} `
                    + 'among its locations. The mapping is saved and will post; add the station to the '
                    + 'contract so pricing and reporting agree with it.');
            }
        }

        await warnMissingVendorNumber(req, row.supplier_ID);
    });

    // =======================================================================
    // 4. FLIGHT TO SUPPLIER
    // =======================================================================

    this.before('SAVE', FlightSupplierMappings, async (req) => {
        const row = req.data;
        await checkWindow(req, row);
        if (row.flight_number) req.data.flight_number = String(row.flight_number).toUpperCase().trim();

        // CAR404. One flight out of one station under one carrier has one
        // supplier at a time.
        await refuseOverlap(req, {
            table: FLIGHT_MAP,
            where: {
                flight_number: req.data.flight_number,
                airport_ID: row.airport_ID,
                carrier_carrier_code: row.carrier_carrier_code
            },
            code: 'CAR404',
            what: 'a mapping for this flight, station and carrier'
        });

        await warnMissingVendorNumber(req, row.supplier_ID);

        // CAR410. THE STATION MUST ALREADY HAVE THIS SUPPLIER.
        //
        // A flight mapping is an exception to a station's arrangement, and
        // the arrangement is what carries the contract and the line item - a
        // flight row names a supplier and nothing else. Name one the station
        // has not been mapped to and the posting has no contract line to use,
        // so this is refused rather than reported: the mapping would be
        // unusable at exactly the moment it mattered.
        if (row.airport_ID && row.supplier_ID && row.carrier_carrier_code) {
            const mapped = await SELECT.from(SUPPLIER_MAP)
                .columns('ID', 'valid_from', 'valid_to')
                .where({ airport_ID: row.airport_ID, supplier_ID: row.supplier_ID,
                         carrier_carrier_code: row.carrier_carrier_code, is_active: true });

            const usable = mapped.some(m => overlaps(row.valid_from, row.valid_to,
                                                     m.valid_from, m.valid_to));
            if (!usable) {
                const [who, airport] = await Promise.all([
                    supplierName(row.supplier_ID),
                    SELECT.one.from('fuelsphere.MASTER_AIRPORTS').columns('iata_code')
                        .where({ ID: row.airport_ID })
                ]);
                const where = airport ? airport.iata_code : 'that station';
                req.error(400, mapped.length
                    ? `CAR410: ${who} is mapped at ${where} but not for these dates. `
                      + 'Extend the station mapping, or change the dates here.'
                    : `CAR410: ${who} is not mapped at ${where} for ${row.carrier_carrier_code}. `
                      + 'Add the station-supplier mapping first - it carries the contract and '
                      + 'line item this flight will post on.', 'supplier_ID');
            }
        }

        // CAR405. THE GUARD OVER THE KNOWN OVERLAP.
        //
        // DESIGNATED_SUPPLIERS still answers "who fuels this flight" for the
        // Flight Schedule screens, and it was left alone on purpose. So this
        // row can disagree with it. Disagreeing is legitimate - a flight-level
        // mapping exists precisely to deviate - but it must be VISIBLE at the
        // moment somebody creates it, not discovered in an S/4 posting.
        if (row.airport_ID && row.supplier_ID && req.data.flight_number) {
            const airport = await SELECT.one.from('fuelsphere.MASTER_AIRPORTS')
                .columns('iata_code').where({ ID: row.airport_ID });

            if (airport) {
                const designated = await SELECT.one.from('fuelsphere.DESIGNATED_SUPPLIERS')
                    .columns('supplier_ID')
                    .where({
                        flight_number: req.data.flight_number,
                        station_code: airport.iata_code,
                        is_active: true
                    });

                if (designated && designated.supplier_ID !== row.supplier_ID) {
                    const [ours, theirs] = await Promise.all([
                        supplierName(row.supplier_ID), supplierName(designated.supplier_ID)
                    ]);
                    req.info(200, `CAR405: the flight schedule designates ${theirs} for this flight `
                        + `at ${airport.iata_code}; this mapping posts to ${ours}. `
                        + 'Both are kept - check that is intended.');
                }
            }
        }
    });

    // =======================================================================
    // SHARED CHECKS
    // =======================================================================

    /** CAR406. A window that closes before it opens. */
    async function checkWindow(req, row) {
        const from = day(row.valid_from), to = day(row.valid_to);
        if (from && to && to < from) {
            req.error(400, `CAR406: Valid to (${to}) is before valid from (${from}).`, 'valid_to');
        }
    }

    /**
     * The overlap rule, shared by all three mapping tables.
     *
     * Only ACTIVE rows block. Deactivating a row is how somebody withdraws it
     * without losing the history, and a withdrawn row that still blocked would
     * make deactivation pointless.
     */
    async function refuseOverlap(req, { table, where, code, what }) {
        if (Object.values(where).some(v => v === undefined || v === null)) return;

        const existing = await SELECT.from(table)
            .columns('ID', 'valid_from', 'valid_to')
            .where({ ...where, is_active: true });

        const clash = existing.find(other =>
            other.ID !== req.data.ID && overlaps(req.data.valid_from, req.data.valid_to,
                                                 other.valid_from, other.valid_to));
        if (clash) {
            req.error(400, `${code}: ${what} already exists for these dates `
                + `(${day(clash.valid_from)} to ${day(clash.valid_to) || 'open'}). `
                + 'Close that one first, or choose dates that do not overlap.', 'valid_from');
        }
    }

    /** CAR407. No vendor number means nothing can be posted against it. */
    async function warnMissingVendorNumber(req, supplierID) {
        if (!supplierID) return;
        const supplier = await SELECT.one.from('fuelsphere.MASTER_SUPPLIERS')
            .columns('supplier_name', 's4_vendor_no').where({ ID: supplierID });
        if (supplier && !supplier.s4_vendor_no) {
            req.info(200, `CAR407: ${supplier.supplier_name} has no S/4 vendor number on the supplier `
                + 'master, so a posting against this mapping will have nobody to pay.');
        }
    }

    async function supplierName(id) {
        if (!id) return 'nobody';
        const row = await SELECT.one.from('fuelsphere.MASTER_SUPPLIERS')
            .columns('supplier_name').where({ ID: id });
        return row ? row.supplier_name : 'an unknown supplier';
    }

    // =======================================================================
    // WHAT THE POSTING ASKS
    // =======================================================================

    /**
     * postingData - one ticket, everything the S/4 documents need.
     *
     * RESOLUTION ORDER, and it is the whole point of putting this here rather
     * than in the caller:
     *
     *   supplier   the ORDER's supplier if the ticket has an order - that is
     *              the supplier the operator actually bought from, and your
     *              rule is that the ticket picks the row. Failing that, the
     *              flight mapping, then the station's - but only when the
     *              station maps exactly one supplier for that carrier, because
     *              several with nothing to choose between them is a gap, not a
     *              decision this code should make.
     *   contract   the station mapping for that supplier, which is where the
     *              contract line item lives.
     *   plant      the station mapping for the carrier.
     *   company    the carrier master.
     *
     * NOTHING THROWS. The uplift is already recorded by the time anybody asks
     * this; a missing mapping is reported in `gaps` and the caller decides
     * whether to post or to raise an exception.
     */
    this.on('postingData', async (req) => {
        const gaps = [];
        const ticket = await SELECT.one.from('fuelsphere.FUEL_TICKETS')
            .where({ ID: req.data.ticketID });

        if (!ticket) return req.error(404, `CAR408: No fuel ticket with ID ${req.data.ticketID}.`);

        const order = ticket.order_ID
            ? await SELECT.one.from('fuelsphere.FUEL_ORDERS')
                .columns('supplier_ID', 'contract_ID', 'station_code').where({ ID: ticket.order_ID })
            : null;

        const flight = ticket.flight_ID
            ? await SELECT.one.from('fuelsphere.FLIGHT_SCHEDULE')
                .columns('flight_number', 'flight_date', 'origin_airport', 'airline_code')
                .where({ ID: ticket.flight_ID })
            : null;

        const date = asOf(ticket.delivery_timestamp);
        const stationCode = (flight && flight.origin_airport) || (order && order.station_code) || null;
        const carrierCode = flight && flight.airline_code;
        const flightNumber = (flight && flight.flight_number) || ticket.flight_number || null;

        if (!stationCode) gaps.push('The ticket names neither a flight nor an order, so it has no station.');
        if (!carrierCode) gaps.push('The ticket has no flight, so the carrier is unknown.');

        const airport = stationCode
            ? await SELECT.one.from('fuelsphere.MASTER_AIRPORTS')
                .columns('ID', 'iata_code').where({ iata_code: stationCode })
            : null;

        // ---- the carrier, and the books it posts under --------------------
        const carrier = carrierCode
            ? await SELECT.one.from('fuelsphere.CARRIER_MASTER').where({ carrier_code: carrierCode })
            : null;
        if (carrierCode && !carrier) gaps.push(`Carrier ${carrierCode} is not in the carrier master.`);
        if (carrier && !carrier.company_code) gaps.push(`Carrier ${carrierCode} has no company code.`);

        // ---- the plant ----------------------------------------------------
        let plant = null;
        if (airport && carrier) {
            const rows = await SELECT.from(PLANT_MAP)
                .where({ airport_ID: airport.ID, carrier_carrier_code: carrier.carrier_code, is_active: true });
            const hit = rows.find(r => inWindow(r, date));
            if (hit) {
                plant = await SELECT.one.from('fuelsphere.T001W_PLANT')
                    .columns('werks', 'name1').where({ werks: hit.plant_werks });
            } else {
                gaps.push(`No plant is mapped for ${stationCode} under ${carrierCode} on ${date}.`);
            }
        }

        // ---- the supplier -------------------------------------------------
        let supplierID = order && order.supplier_ID;
        let source = supplierID ? 'TICKET' : null;

        if (!supplierID && airport && carrier && flightNumber) {
            const rows = await SELECT.from(FLIGHT_MAP)
                .where({ flight_number: flightNumber, airport_ID: airport.ID,
                         carrier_carrier_code: carrier.carrier_code, is_active: true });
            const hit = rows.find(r => inWindow(r, date));
            if (hit) { supplierID = hit.supplier_ID; source = 'FLIGHT'; }
        }

        if (!supplierID && airport && carrier) {
            const rows = (await SELECT.from(SUPPLIER_MAP)
                .where({ airport_ID: airport.ID, carrier_carrier_code: carrier.carrier_code, is_active: true }))
                .filter(r => inWindow(r, date));
            if (rows.length === 1) { supplierID = rows[0].supplier_ID; source = 'STATION'; }
            else if (rows.length > 1) {
                gaps.push(`${stationCode} maps ${rows.length} suppliers under ${carrierCode} and the `
                    + 'ticket names none, so the contract line cannot be chosen.');
            }
        }
        if (!supplierID) gaps.push('No supplier could be resolved for this ticket.');

        const supplier = supplierID
            ? await SELECT.one.from('fuelsphere.MASTER_SUPPLIERS')
                .columns('ID', 'supplier_name', 's4_vendor_no').where({ ID: supplierID })
            : null;
        if (supplier && !supplier.s4_vendor_no) {
            gaps.push(`${supplier.supplier_name} has no S/4 vendor number.`);
        }

        // ---- the contract line --------------------------------------------
        let mapping = null;
        if (airport && carrier && supplierID) {
            const rows = await SELECT.from(SUPPLIER_MAP)
                .where({ airport_ID: airport.ID, carrier_carrier_code: carrier.carrier_code,
                         supplier_ID: supplierID, is_active: true });
            mapping = rows.find(r => inWindow(r, date)) || null;
            if (!mapping) {
                gaps.push(`No contract line is mapped for ${supplier ? supplier.supplier_name : 'that supplier'} `
                    + `at ${stationCode} under ${carrierCode} on ${date}.`);
            }
        }

        const contract = mapping && mapping.contract_ID
            ? await SELECT.one.from('fuelsphere.MASTER_CONTRACTS')
                .columns('contract_number', 's4_contract_number').where({ ID: mapping.contract_ID })
            : null;
        if (contract && !contract.s4_contract_number) {
            gaps.push(`Contract ${contract.contract_number} has no S/4 contract number.`);
        }

        return {
            ticket_number: ticket.ticket_number,
            flight_number: flightNumber,
            station_code: stationCode,
            posting_date: date,

            carrier_code: carrierCode || null,
            carrier_name: carrier ? carrier.carrier_name : null,
            company_code: carrier ? carrier.company_code : null,

            plant_code: plant ? plant.werks : null,
            plant_name: plant ? plant.name1 : null,

            supplier_ID: supplierID || null,
            supplier_name: supplier ? supplier.supplier_name : null,
            s4_vendor_no: supplier ? supplier.s4_vendor_no : null,
            supplier_source: source,

            contract_number: contract ? contract.contract_number : null,
            s4_contract_number: contract ? contract.s4_contract_number : null,
            contract_line_item: mapping ? mapping.contract_line_item : null,

            quantity_kg: ticket.quantity_kg,
            quantity: ticket.quantity,
            uom_code: ticket.uom_code,
            total_amount: ticket.total_amount,
            currency_code: ticket.currency_code,

            gaps
        };
    });
});

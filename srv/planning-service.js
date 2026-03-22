/**
 * FuelSphere - Planning Service Handler
 * Handles flight schedule management and Excel import.
 * Auto-creates Draft Fuel Orders for each new flight schedule.
 */

const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE } = cds.ql;
const XLSX = require('xlsx');

module.exports = class PlanningService extends cds.ApplicationService {
    async init() {
        const { FlightSchedule } = this.entities;

        // ====================================================================
        // AUTO-CREATE DRAFT FUEL ORDER ON FLIGHT SCHEDULE CREATION
        // ====================================================================

        this.after('CREATE', FlightSchedule, async (data, req) => {
            if (!data || data.fuel_order_ID) return; // Already linked
            try {
                await this._createDraftOrder(data);
            } catch (e) {
                console.error(`Failed to auto-create fuel order for flight ${data.flight_number}: ${e.message}`);
            }
        });

        // ====================================================================
        // IMPORT FLIGHT SCHEDULE FROM EXCEL
        // ====================================================================

        this.on('importFlightScheduleExcel', async (req) => {
            const { fileContent, fileName } = req.data;

            const errors = [];
            let flightsProcessed = 0, flightsCreated = 0, flightsUpdated = 0, flightsSkipped = 0;
            let ordersCreated = 0, ordersFailed = 0;

            // Validate file
            if (!fileContent) {
                return req.error(400, 'IMP401: File content is required.');
            }
            const ext = (fileName || '').toLowerCase();
            if (ext && !ext.endsWith('.xlsx') && !ext.endsWith('.xls')) {
                return req.error(400, 'IMP401: Invalid file format. Only .xlsx and .xls files are supported.');
            }

            // Parse Excel
            let workbook;
            try {
                const buf = Buffer.isBuffer(fileContent) ? fileContent : Buffer.from(fileContent, 'base64');
                workbook = XLSX.read(buf, { type: 'buffer' });
            } catch (e) {
                return req.error(400, `IMP401: Failed to parse Excel file: ${e.message}`);
            }

            const sheetName = workbook.SheetNames[0];
            if (!sheetName) {
                return req.error(400, 'IMP401: Excel file contains no sheets.');
            }

            const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
            if (rows.length === 0) {
                return req.error(400, 'IMP402: Excel sheet is empty.');
            }

            // Validate required columns (flight schedule only)
            const requiredCols = ['flight_number', 'flight_date', 'origin_airport', 'destination_airport'];
            const headers = Object.keys(rows[0]);
            const missingCols = requiredCols.filter(c => !headers.includes(c));
            if (missingCols.length > 0) {
                return req.error(400, `IMP402: Missing required columns: ${missingCols.join(', ')}`);
            }

            // Pre-fetch reference data for validation
            const { MASTER_AIRPORTS, AIRCRAFT_MASTER, FLIGHT_SCHEDULE, FUEL_ORDERS } = cds.entities('fuelsphere');

            const airportRows = await SELECT.from(MASTER_AIRPORTS).columns('ID', 'iata_code');
            const airportMap = new Map(airportRows.map(a => [a.iata_code, a.ID]));

            const aircraftRows = await SELECT.from(AIRCRAFT_MASTER).columns('type_code');
            const aircraftSet = new Set(aircraftRows.map(a => a.type_code));

            // Existing flights for duplicate detection
            const existingFlights = await SELECT.from(FLIGHT_SCHEDULE).columns('ID', 'flight_number', 'flight_date');
            const existingFlightMap = new Map(existingFlights.map(f => [`${f.flight_number}|${f.flight_date}`, f.ID]));

            // Track order number sequences per station-date
            const seqCounters = {};
            const _getNextOrderNumber = async (stationCode, dateStr) => {
                const key = `${stationCode}-${dateStr}`;
                if (!(key in seqCounters)) {
                    const pattern = `FO-${stationCode}-${dateStr}-%`;
                    const lastOrder = await SELECT.one.from(FUEL_ORDERS)
                        .columns('order_number')
                        .where({ order_number: { like: pattern } })
                        .orderBy('order_number desc');
                    seqCounters[key] = lastOrder ? parseInt(lastOrder.order_number.split('-').pop()) : 0;
                }
                seqCounters[key]++;
                return `FO-${stationCode}-${dateStr}-${String(seqCounters[key]).padStart(3, '0')}`;
            };

            // Helper: normalize Excel date
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

            // Helper: normalize Excel datetime
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

            // Process rows
            const flightsToInsert = [];
            const flightsToUpdate = [];
            const ordersToInsert = [];
            const batchFlightKeys = new Set();
            // Track flight→order mapping for linking
            const flightOrderMap = new Map();

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const rowNum = i + 2;
                flightsProcessed++;

                // --- Extract flight fields ---
                const flightNumber = String(row.flight_number || '').trim();
                const rawDate = row.flight_date;
                const originAirport = String(row.origin_airport || '').trim().toUpperCase();
                const destAirport = String(row.destination_airport || '').trim().toUpperCase();
                const aircraftType = String(row.aircraft_type || '').trim();
                const aircraftReg = String(row.aircraft_reg || '').trim();
                const depTime = String(row.departure_time || '').trim();
                const arrTime = String(row.arrival_time || '').trim();

                // --- Extract ICD-inspired optional fields ---
                const airlineCode = String(row.airline_code || '').trim().toUpperCase();
                const flightSuffix = String(row.flight_suffix || '').trim();
                const serviceType = String(row.service_type || '').trim().toUpperCase();
                const departureTerminal = String(row.departure_terminal || '').trim();
                const arrivalTerminal = String(row.arrival_terminal || '').trim();
                const gateNumber = String(row.gate_number || '').trim();
                const standNumber = String(row.stand_number || '').trim();
                const sobt = _normalizeDateTime(row.sobt);
                const sibt = _normalizeDateTime(row.sibt);
                const plannedBlockMins = row.planned_block_mins ? parseInt(row.planned_block_mins) : null;
                const flightNature = String(row.flight_nature || '').trim().toUpperCase();
                const linkedFlightNumber = String(row.linked_flight_number || '').trim();
                const linkedFlightDate = row.linked_flight_date ? _normalizeDate(row.linked_flight_date) : null;
                const codeshareFlights = String(row.codeshare_flights || '').trim();

                // --- Validate required flight fields ---
                if (!flightNumber) {
                    errors.push({ row: rowNum, field: 'flight_number', message: 'Flight number is required.', severity: 'ERROR' });
                    flightsSkipped++;
                    continue;
                }

                const flightDate = _normalizeDate(rawDate);
                if (!flightDate || !/^\d{4}-\d{2}-\d{2}$/.test(flightDate)) {
                    errors.push({ row: rowNum, field: 'flight_date', message: `Invalid or missing flight date: '${rawDate}'.`, severity: 'ERROR' });
                    flightsSkipped++;
                    continue;
                }

                if (!airportMap.has(originAirport)) {
                    errors.push({ row: rowNum, field: 'origin_airport', message: `IMP403: Airport '${originAirport}' not found in master data.`, severity: 'ERROR' });
                    flightsSkipped++;
                    continue;
                }
                if (!airportMap.has(destAirport)) {
                    errors.push({ row: rowNum, field: 'destination_airport', message: `IMP403: Airport '${destAirport}' not found in master data.`, severity: 'ERROR' });
                    flightsSkipped++;
                    continue;
                }

                if (aircraftType && !aircraftSet.has(aircraftType)) {
                    errors.push({ row: rowNum, field: 'aircraft_type', message: `IMP404: Aircraft type '${aircraftType}' not found in master data.`, severity: 'WARNING' });
                }

                const validServiceTypes = ['J', 'F', 'C', 'G', 'M', 'P'];
                if (serviceType && !validServiceTypes.includes(serviceType)) {
                    errors.push({ row: rowNum, field: 'service_type', message: `Invalid service type '${serviceType}'. Valid: J, F, C, G, M, P.`, severity: 'WARNING' });
                }

                // --- Handle flight schedule (upsert) ---
                const flightKey = `${flightNumber}|${flightDate}`;
                let flightId;

                if (existingFlightMap.has(flightKey)) {
                    flightId = existingFlightMap.get(flightKey);
                    flightsToUpdate.push({
                        ID: flightId,
                        aircraft_type: aircraftType || undefined,
                        aircraft_reg: aircraftReg || undefined,
                        origin_airport: originAirport,
                        destination_airport: destAirport,
                        scheduled_departure: depTime || undefined,
                        scheduled_arrival: arrTime || undefined,
                        airline_code: airlineCode || undefined,
                        flight_suffix: flightSuffix || undefined,
                        service_type: serviceType || undefined,
                        departure_terminal: departureTerminal || undefined,
                        arrival_terminal: arrivalTerminal || undefined,
                        gate_number: gateNumber || undefined,
                        stand_number: standNumber || undefined,
                        sobt: sobt || undefined,
                        sibt: sibt || undefined,
                        planned_block_mins: plannedBlockMins !== null ? plannedBlockMins : undefined,
                        flight_nature: flightNature || undefined,
                        linked_flight_number: linkedFlightNumber || undefined,
                        linked_flight_date: linkedFlightDate || undefined,
                        codeshare_flights: codeshareFlights || undefined
                    });
                    flightsUpdated++;
                } else if (batchFlightKeys.has(flightKey)) {
                    const existing = flightsToInsert.find(f => f.flight_number === flightNumber && f.flight_date === flightDate);
                    flightId = existing.ID;
                    flightsSkipped++;
                } else {
                    // New flight — create it + auto-create Draft order
                    flightId = cds.utils.uuid();
                    const airportID = airportMap.get(originAirport);
                    const dateStr = flightDate.replace(/-/g, '');
                    const orderNumber = await _getNextOrderNumber(originAirport, dateStr);
                    const orderId = cds.utils.uuid();

                    flightsToInsert.push({
                        ID: flightId,
                        flight_number: flightNumber,
                        flight_date: flightDate,
                        aircraft_type: aircraftType || null,
                        aircraft_reg: aircraftReg || null,
                        origin_airport: originAirport,
                        destination_airport: destAirport,
                        scheduled_departure: depTime || null,
                        scheduled_arrival: arrTime || null,
                        status: 'SCHEDULED',
                        airline_code: airlineCode || null,
                        flight_suffix: flightSuffix || null,
                        service_type: serviceType || null,
                        departure_terminal: departureTerminal || null,
                        arrival_terminal: arrivalTerminal || null,
                        gate_number: gateNumber || null,
                        stand_number: standNumber || null,
                        sobt: sobt || null,
                        sibt: sibt || null,
                        planned_block_mins: plannedBlockMins,
                        flight_nature: flightNature || null,
                        linked_flight_number: linkedFlightNumber || null,
                        linked_flight_date: linkedFlightDate || null,
                        codeshare_flights: codeshareFlights || null,
                        fuel_order_ID: orderId,
                        fuel_order_number: orderNumber
                    });

                    // Auto-create Draft Fuel Order
                    ordersToInsert.push({
                        ID: orderId,
                        order_number: orderNumber,
                        flight_ID: flightId,
                        airport_ID: airportID,
                        station_code: originAirport,
                        uom_code: 'KG',
                        ordered_quantity: 0,
                        requested_date: flightDate,
                        priority: 'Normal',
                        status: 'Draft',
                        notes: `Draft order for flight ${flightNumber} ${originAirport}-${destAirport}`
                    });

                    existingFlightMap.set(flightKey, flightId);
                    batchFlightKeys.add(flightKey);
                    flightOrderMap.set(flightId, orderId);
                    flightsCreated++;
                    ordersCreated++;
                }
            }

            // Bulk insert fuel orders first (flight schedule references them)
            if (ordersToInsert.length > 0) {
                try {
                    await INSERT.into(FUEL_ORDERS).entries(ordersToInsert);
                } catch (e) {
                    return req.error(500, `Failed to create fuel orders: ${e.message}`);
                }
            }

            // Bulk insert flight schedules
            if (flightsToInsert.length > 0) {
                try {
                    await INSERT.into(FLIGHT_SCHEDULE).entries(flightsToInsert);
                } catch (e) {
                    return req.error(500, `Failed to insert flight schedules: ${e.message}`);
                }
            }

            // Bulk update existing flights
            for (const upd of flightsToUpdate) {
                const { ID, ...fields } = upd;
                const setFields = {};
                for (const [k, v] of Object.entries(fields)) {
                    if (v !== undefined) setFields[k] = v;
                }
                if (Object.keys(setFields).length > 0) {
                    await UPDATE(FLIGHT_SCHEDULE).where({ ID }).set(setFields);
                }
            }

            const success = flightsSkipped === 0;
            const msg = `Processed ${flightsProcessed} rows. ` +
                `Flights: ${flightsCreated} created, ${flightsUpdated} updated` +
                (flightsSkipped > 0 ? `, ${flightsSkipped} skipped` : '') + '. ' +
                `Draft Orders: ${ordersCreated} created.` +
                (errors.length > 0 ? ` ${errors.filter(e => e.severity === 'ERROR').length} errors.` : '');

            req.info(200, msg);

            return {
                success,
                fileName: fileName || '',
                flightsProcessed,
                flightsCreated,
                flightsUpdated,
                flightsSkipped,
                ordersCreated,
                ordersFailed,
                errors,
                message: msg
            };
        });

        await super.init();
    }

    /**
     * Create a Draft Fuel Order for a flight schedule record.
     */
    async _createDraftOrder(flight) {
        const { FUEL_ORDERS, MASTER_AIRPORTS, FLIGHT_SCHEDULE } = cds.entities('fuelsphere');

        const stationCode = flight.origin_airport;
        const dateStr = (flight.flight_date || new Date().toISOString().slice(0, 10)).replace(/-/g, '');

        // Generate next order number
        const pattern = `FO-${stationCode}-${dateStr}-%`;
        const lastOrder = await SELECT.one.from(FUEL_ORDERS)
            .columns('order_number')
            .where({ order_number: { like: pattern } })
            .orderBy('order_number desc');
        let nextSeq = lastOrder ? parseInt(lastOrder.order_number.split('-').pop()) + 1 : 1;
        const orderNumber = `FO-${stationCode}-${dateStr}-${String(nextSeq).padStart(3, '0')}`;

        const airport = await SELECT.one.from(MASTER_AIRPORTS).where({ iata_code: stationCode });

        const orderId = cds.utils.uuid();
        await INSERT.into(FUEL_ORDERS).entries({
            ID: orderId,
            order_number: orderNumber,
            flight_ID: flight.ID,
            airport_ID: airport ? airport.ID : null,
            station_code: stationCode,
            uom_code: 'KG',
            ordered_quantity: 0,
            requested_date: flight.flight_date,
            priority: 'Normal',
            status: 'Draft',
            notes: `Draft order for flight ${flight.flight_number} ${flight.origin_airport}-${flight.destination_airport}`
        });

        // Link back to flight schedule
        await UPDATE(FLIGHT_SCHEDULE)
            .where({ ID: flight.ID })
            .set({ fuel_order_ID: orderId, fuel_order_number: orderNumber });
    }
};

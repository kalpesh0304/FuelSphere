/**
 * FuelSphere - Planning Service Handler
 * Handles flight schedule import from Excel and planning operations.
 */

const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE } = cds.ql;
const XLSX = require('xlsx');

module.exports = class PlanningService extends cds.ApplicationService {
    async init() {
        const { FlightSchedule } = this.entities;

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

            // Validate required columns (flight + order dimensions)
            const requiredCols = [
                'flight_number', 'flight_date', 'origin_airport', 'destination_airport',
                'supplier_code', 'product_code', 'ordered_quantity', 'unit_price'
            ];
            const headers = Object.keys(rows[0]);
            const missingCols = requiredCols.filter(c => !headers.includes(c));
            if (missingCols.length > 0) {
                return req.error(400, `IMP402: Missing required columns: ${missingCols.join(', ')}`);
            }

            // Pre-fetch reference data for validation and ID lookup
            const { MASTER_AIRPORTS, AIRCRAFT_MASTER, FLIGHT_SCHEDULE, MASTER_SUPPLIERS, MASTER_PRODUCTS, MASTER_CONTRACTS, FUEL_ORDERS } = cds.entities('fuelsphere');

            const airportRows = await SELECT.from(MASTER_AIRPORTS).columns('ID', 'iata_code');
            const airportMap = new Map(airportRows.map(a => [a.iata_code, a.ID]));

            const aircraftRows = await SELECT.from(AIRCRAFT_MASTER).columns('ID', 'type_code');
            const aircraftSet = new Set(aircraftRows.map(a => a.type_code));

            const supplierRows = await SELECT.from(MASTER_SUPPLIERS).columns('ID', 'supplier_code');
            const supplierMap = new Map(supplierRows.map(s => [s.supplier_code, s.ID]));

            const productRows = await SELECT.from(MASTER_PRODUCTS).columns('ID', 'product_code');
            const productMap = new Map(productRows.map(p => [p.product_code, p.ID]));

            const contractRows = await SELECT.from(MASTER_CONTRACTS).columns('ID', 'contract_number');
            const contractMap = new Map(contractRows.map(c => [c.contract_number, c.ID]));

            // Existing flights for duplicate detection
            const existingFlights = await SELECT.from(FLIGHT_SCHEDULE).columns('ID', 'flight_number', 'flight_date');
            const existingFlightMap = new Map(existingFlights.map(f => [`${f.flight_number}|${f.flight_date}`, f.ID]));

            // Track order number sequences per station-date (in-memory to avoid collisions in bulk)
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

            // Helper: normalize Excel date (may be serial number or string)
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

            // Helper: normalize Excel datetime (serial number or ISO string)
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

            // Process rows - collect flights and orders
            const flightsToInsert = [];
            const flightsToUpdate = [];
            const ordersToInsert = [];
            const batchFlightKeys = new Set();

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const rowNum = i + 2; // Excel row number (header=1)
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

                // --- Extract order fields ---
                const supplierCode = String(row.supplier_code || '').trim();
                const contractNumber = String(row.contract_number || '').trim();
                const productCode = String(row.product_code || '').trim();
                const orderedQty = parseFloat(row.ordered_quantity);
                const unitPrice = parseFloat(row.unit_price);
                const currencyCode = String(row.currency_code || 'USD').trim().toUpperCase();
                const priority = String(row.priority || 'Normal').trim();
                const notes = String(row.notes || '').trim();

                // --- Validate required flight fields ---
                if (!flightNumber) {
                    errors.push({ row: rowNum, field: 'flight_number', message: 'Flight number is required.', severity: 'ERROR' });
                    ordersFailed++;
                    continue;
                }

                const flightDate = _normalizeDate(rawDate);
                if (!flightDate || !/^\d{4}-\d{2}-\d{2}$/.test(flightDate)) {
                    errors.push({ row: rowNum, field: 'flight_date', message: `Invalid or missing flight date: '${rawDate}'.`, severity: 'ERROR' });
                    ordersFailed++;
                    continue;
                }

                // Validate airports
                if (!airportMap.has(originAirport)) {
                    errors.push({ row: rowNum, field: 'origin_airport', message: `IMP403: Airport '${originAirport}' not found in master data.`, severity: 'ERROR' });
                    ordersFailed++;
                    continue;
                }
                if (!airportMap.has(destAirport)) {
                    errors.push({ row: rowNum, field: 'destination_airport', message: `IMP403: Airport '${destAirport}' not found in master data.`, severity: 'ERROR' });
                    ordersFailed++;
                    continue;
                }

                // Validate aircraft type (optional)
                if (aircraftType && !aircraftSet.has(aircraftType)) {
                    errors.push({ row: rowNum, field: 'aircraft_type', message: `IMP404: Aircraft type '${aircraftType}' not found in master data.`, severity: 'ERROR' });
                    ordersFailed++;
                    continue;
                }

                // Validate service type (optional, WARNING only)
                const validServiceTypes = ['J', 'F', 'C', 'G', 'M', 'P'];
                if (serviceType && !validServiceTypes.includes(serviceType)) {
                    errors.push({ row: rowNum, field: 'service_type', message: `Invalid service type '${serviceType}'. Valid: J, F, C, G, M, P.`, severity: 'WARNING' });
                }

                // --- Validate required order fields ---
                const supplierID = supplierMap.get(supplierCode);
                if (!supplierID) {
                    errors.push({ row: rowNum, field: 'supplier_code', message: `IMP406: Supplier '${supplierCode}' not found in master data.`, severity: 'ERROR' });
                    ordersFailed++;
                    continue;
                }

                const productID = productMap.get(productCode);
                if (!productID) {
                    errors.push({ row: rowNum, field: 'product_code', message: `IMP407: Product '${productCode}' not found in master data.`, severity: 'ERROR' });
                    ordersFailed++;
                    continue;
                }

                // Contract is optional
                let contractID = null;
                if (contractNumber) {
                    contractID = contractMap.get(contractNumber);
                    if (!contractID) {
                        errors.push({ row: rowNum, field: 'contract_number', message: `IMP408: Contract '${contractNumber}' not found in master data.`, severity: 'ERROR' });
                        ordersFailed++;
                        continue;
                    }
                }

                if (isNaN(orderedQty) || orderedQty <= 0) {
                    errors.push({ row: rowNum, field: 'ordered_quantity', message: 'Ordered quantity must be a positive number.', severity: 'ERROR' });
                    ordersFailed++;
                    continue;
                }

                if (isNaN(unitPrice) || unitPrice < 0) {
                    errors.push({ row: rowNum, field: 'unit_price', message: 'Unit price must be a non-negative number.', severity: 'ERROR' });
                    ordersFailed++;
                    continue;
                }

                // --- Handle flight schedule (upsert) ---
                const flightKey = `${flightNumber}|${flightDate}`;
                let flightId;

                if (existingFlightMap.has(flightKey)) {
                    // Flight exists — update it
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
                    // Already being created in this batch — reuse the ID
                    const existing = flightsToInsert.find(f => f.flight_number === flightNumber && f.flight_date === flightDate);
                    flightId = existing.ID;
                } else {
                    // New flight — create it
                    flightId = cds.utils.uuid();
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
                        codeshare_flights: codeshareFlights || null
                    });
                    existingFlightMap.set(flightKey, flightId);
                    batchFlightKeys.add(flightKey);
                    flightsCreated++;
                }

                // --- Create fuel order ---
                const dateStr = flightDate.replace(/-/g, '');
                const orderNumber = await _getNextOrderNumber(originAirport, dateStr);
                const totalAmount = Number((orderedQty * unitPrice).toFixed(2));
                const airportID = airportMap.get(originAirport);

                ordersToInsert.push({
                    ID: cds.utils.uuid(),
                    order_number: orderNumber,
                    flight_ID: flightId,
                    airport_ID: airportID,
                    station_code: originAirport,
                    supplier_ID: supplierID,
                    contract_ID: contractID,
                    product_ID: productID,
                    uom_code: 'KG',
                    ordered_quantity: orderedQty,
                    unit_price: unitPrice,
                    total_amount: totalAmount,
                    currency_code: currencyCode || 'USD',
                    requested_date: flightDate,
                    priority: ['Normal', 'High', 'Urgent'].includes(priority) ? priority : 'Normal',
                    status: 'Created',
                    notes: notes || `Fuel order for flight ${flightNumber} ${originAirport}-${destAirport} (Excel import)`
                });
                ordersCreated++;
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

            // Bulk insert fuel orders
            if (ordersToInsert.length > 0) {
                try {
                    await INSERT.into(FUEL_ORDERS).entries(ordersToInsert);
                } catch (e) {
                    return req.error(500, `Failed to insert fuel orders: ${e.message}`);
                }
            }

            const success = ordersFailed === 0;
            const msg = `Processed ${flightsProcessed} rows. ` +
                `Flights: ${flightsCreated} created, ${flightsUpdated} updated. ` +
                `Orders: ${ordersCreated} created.` +
                (ordersFailed > 0 ? ` ${ordersFailed} failed.` : '');

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
};

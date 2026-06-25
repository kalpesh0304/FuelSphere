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
            console.log(`[FlightScheduleImport] Starting import. File: ${fileName}, Content length: ${fileContent ? (typeof fileContent === 'string' ? fileContent.length : 'Buffer') : 'null'}`);

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

            // Pre-fetch suppliers, contracts, products for order field resolution
            const { MASTER_SUPPLIERS, MASTER_CONTRACTS, MASTER_PRODUCTS } = cds.entities('fuelsphere');
            const supplierRows = await SELECT.from(MASTER_SUPPLIERS).columns('ID', 'supplier_code');
            const supplierMap = new Map(supplierRows.map(s => [s.supplier_code, s.ID]));
            const contractRows = await SELECT.from(MASTER_CONTRACTS).columns('ID', 'contract_number');
            const contractMap = new Map(contractRows.map(c => [c.contract_number, c.ID]));
            const productRows = await SELECT.from(MASTER_PRODUCTS).columns('ID', 'product_code');
            const productMap = new Map(productRows.map(p => [p.product_code, p.ID]));

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

            // Helper: normalize Excel time (decimal fraction → HH:MM:SS)
            const _normalizeTime = (val) => {
                if (!val && val !== 0) return null;
                if (typeof val === 'number' && val >= 0 && val < 1) {
                    // Excel time fraction: 0.333333 = 08:00:00
                    const totalSeconds = Math.round(val * 86400);
                    const h = Math.floor(totalSeconds / 3600);
                    const m = Math.floor((totalSeconds % 3600) / 60);
                    const s = totalSeconds % 60;
                    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
                }
                const s = String(val).trim();
                // Already HH:MM or HH:MM:SS format
                if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s;
                return s || null;
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
                const depTime = _normalizeTime(row.departure_time);
                const arrTime = _normalizeTime(row.arrival_time);

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

                // --- Extract optional order fields from Excel ---
                const supplierCode = String(row.supplier_code || '').trim();
                const contractNumber = String(row.contract_number || '').trim();
                const productCode = String(row.product_code || '').trim();
                const orderedQuantity = row.ordered_quantity ? parseFloat(row.ordered_quantity) : 0;
                const unitPrice = row.unit_price ? parseFloat(row.unit_price) : null;
                const currencyCode = String(row.currency_code || '').trim().toUpperCase();

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
                        fuel_order_number: orderNumber
                    });

                    // Auto-create Draft Fuel Order with optional Excel fields
                    const orderEntry = {
                        ID: orderId,
                        order_number: orderNumber,
                        flight_ID: flightId,
                        airport_ID: airportID,
                        station_code: originAirport,
                        uom_code: 'KG',
                        ordered_quantity: orderedQuantity || 0,
                        requested_date: flightDate,
                        priority: 'Normal',
                        status: 'Draft',
                        notes: `Draft order for flight ${flightNumber} ${originAirport}-${destAirport}`
                    };
                    if (supplierCode && supplierMap.has(supplierCode)) orderEntry.supplier_ID = supplierMap.get(supplierCode);
                    if (contractNumber && contractMap.has(contractNumber)) orderEntry.contract_ID = contractMap.get(contractNumber);
                    if (productCode && productMap.has(productCode)) orderEntry.product_ID = productMap.get(productCode);
                    if (unitPrice !== null) orderEntry.unit_price = unitPrice;
                    if (currencyCode) orderEntry.currency_code = currencyCode;
                    if (orderedQuantity && unitPrice) orderEntry.total_amount = orderedQuantity * unitPrice;
                    ordersToInsert.push(orderEntry);

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

            // Log import summary and errors for debugging
            console.log(`[FlightScheduleImport] ${msg}`);
            if (errors.length > 0) {
                console.log(`[FlightScheduleImport] Validation errors:`);
                errors.forEach(e => console.log(`  Row ${e.row}: [${e.severity}] ${e.field} - ${e.message}`));
            }

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

        // ====================================================================
        // ENRICH FLIGHT SCHEDULE FROM EXCEL
        // ====================================================================

        this.on('enrichFlightScheduleExcel', async (req) => {
            const { fileContent, fileName } = req.data;

            const errors = [];
            let flightsProcessed = 0, flightsEnriched = 0, flightsNotFound = 0, flightsSkipped = 0;

            if (!fileContent) {
                return req.error(400, 'ENR401: File content is required.');
            }

            const ext = (fileName || '').toLowerCase();
            if (ext && !ext.endsWith('.xlsx') && !ext.endsWith('.xls') && !ext.endsWith('.csv')) {
                return req.error(400, 'ENR401: Invalid file format. Only .xlsx, .xls and .csv files are supported.');
            }

            let workbook;
            try {
                const buf = Buffer.isBuffer(fileContent) ? fileContent : Buffer.from(fileContent, 'base64');
                workbook = XLSX.read(buf, { type: 'buffer' });
            } catch (e) {
                return req.error(400, `ENR401: Failed to parse file: ${e.message}`);
            }

            const sheetName = workbook.SheetNames[0];
            if (!sheetName) return req.error(400, 'ENR401: File contains no sheets.');

            const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
            if (rows.length === 0) return req.error(400, 'ENR402: Sheet is empty.');

            // Validate required columns
            const headers = Object.keys(rows[0]).map(h => h.toLowerCase().trim());
            const hasFlightNumber = headers.includes('flight_number');
            const hasFlightDate = headers.includes('flight_date');
            if (!hasFlightNumber || !hasFlightDate) {
                const missing = [];
                if (!hasFlightNumber) missing.push('flight_number');
                if (!hasFlightDate) missing.push('flight_date');
                return req.error(400, `ENR402: Missing required columns: ${missing.join(', ')}`);
            }

            // Check at least one enrichment column exists
            const enrichCols = ['aircraft_reg', 'aircraft_type', 'departure_terminal', 'arrival_terminal', 'gate_number', 'stand_number'];
            const hasEnrichCol = enrichCols.some(c => headers.includes(c));
            if (!hasEnrichCol) {
                return req.error(400, `ENR402: No enrichment columns found. At least one of: ${enrichCols.join(', ')}`);
            }

            const { FLIGHT_SCHEDULE } = cds.entities('fuelsphere');

            // Normalize header keys
            const normalizeKey = (key) => key.toLowerCase().trim().replace(/\s+/g, '_');

            // Date normalization helper
            const _normalizeDate = (val) => {
                if (typeof val === 'number') {
                    const parsed = XLSX.SSF.parse_date_code(val);
                    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
                }
                const s = String(val).trim();
                if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
                if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
                    const parts = s.split('/');
                    return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
                }
                if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
                return s;
            };

            for (let i = 0; i < rows.length; i++) {
                const row = {};
                // Normalize all keys
                for (const [k, v] of Object.entries(rows[i])) {
                    row[normalizeKey(k)] = v;
                }

                const rowNum = i + 2;
                flightsProcessed++;

                const flightNumber = String(row.flight_number || '').trim();
                const rawDate = row.flight_date;

                if (!flightNumber) {
                    errors.push({ row: rowNum, field: 'flight_number', message: 'Flight number is required.', severity: 'ERROR' });
                    flightsSkipped++; continue;
                }

                const flightDate = _normalizeDate(rawDate);
                if (!flightDate || !/^\d{4}-\d{2}-\d{2}$/.test(flightDate)) {
                    errors.push({ row: rowNum, field: 'flight_date', message: `Invalid date: '${rawDate}'.`, severity: 'ERROR' });
                    flightsSkipped++; continue;
                }

                // Find matching flight
                const existing = await SELECT.one.from(FLIGHT_SCHEDULE)
                    .where({ flight_number: flightNumber, flight_date: flightDate });

                if (!existing) {
                    errors.push({ row: rowNum, field: 'flight_number',
                        message: `No flight found for ${flightNumber} on ${flightDate}. Upload schedule first.`, severity: 'WARNING' });
                    flightsNotFound++; continue;
                }

                // Build update set from enrichment columns
                const updateSet = {};
                if (row.aircraft_reg && String(row.aircraft_reg).trim()) {
                    updateSet.aircraft_reg = String(row.aircraft_reg).trim().toUpperCase();
                }
                if (row.aircraft_type && String(row.aircraft_type).trim()) {
                    updateSet.aircraft_type = String(row.aircraft_type).trim().toUpperCase();
                }
                if (row.departure_terminal && String(row.departure_terminal).trim()) {
                    updateSet.departure_terminal = String(row.departure_terminal).trim();
                }
                if (row.arrival_terminal && String(row.arrival_terminal).trim()) {
                    updateSet.arrival_terminal = String(row.arrival_terminal).trim();
                }
                if (row.gate_number && String(row.gate_number).trim()) {
                    updateSet.gate_number = String(row.gate_number).trim();
                }
                if (row.stand_number && String(row.stand_number).trim()) {
                    updateSet.stand_number = String(row.stand_number).trim();
                }

                if (Object.keys(updateSet).length === 0) {
                    errors.push({ row: rowNum, field: '-', message: 'No enrichment data provided.', severity: 'WARNING' });
                    flightsSkipped++; continue;
                }

                try {
                    await UPDATE(FLIGHT_SCHEDULE).set(updateSet).where({ ID: existing.ID });
                    flightsEnriched++;
                } catch (e) {
                    errors.push({ row: rowNum, field: '-', message: `Update failed: ${e.message}`, severity: 'ERROR' });
                    flightsSkipped++;
                }
            }

            const hasErrors = errors.some(e => e.severity === 'ERROR');
            const msg = flightsEnriched > 0
                ? `Enriched ${flightsEnriched} flight(s).` +
                  (flightsNotFound > 0 ? ` ${flightsNotFound} not found.` : '') +
                  (flightsSkipped > 0 ? ` ${flightsSkipped} skipped.` : '')
                : `No flights enriched. ${flightsNotFound} not found, ${flightsSkipped} skipped.`;

            return {
                success: !hasErrors && flightsEnriched > 0,
                fileName: fileName || '',
                flightsProcessed,
                flightsEnriched,
                flightsNotFound,
                flightsSkipped,
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

        // Link back to flight schedule (fuel_order_number denormalized for display)
        await UPDATE(FLIGHT_SCHEDULE)
            .where({ ID: flight.ID })
            .set({ fuel_order_number: orderNumber });
    }
};

/**
 * FuelSphere - Burn Service Handler (FDD-08)
 * Fuel Burn & ROB Tracking:
 * - Burn record confirmation workflow
 * - ROB (Remaining on Board) ledger management
 * - ACARS/EFB data ingestion
 * - Variance analysis and exception management
 *
 * Core Formula: ROB_current = ROB_previous + Uplift - Burn + Adjustment
 */

const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE } = cds.ql;
const XLSX = require('xlsx');

const _id = (params) => {
    const p = params[0];
    return typeof p === 'object' ? p.ID : p;
};

module.exports = class BurnService extends cds.ApplicationService {
    async init() {
        const { FuelBurns, ROBLedger, FuelBurnExceptions } = this.entities;

        // ====================================================================
        // FUEL BURN ACTIONS
        // ====================================================================

        // Confirm: PRELIMINARY → CONFIRMED
        this.on('confirm', FuelBurns, async (req) => {
            const burn = await SELECT.one.from(FuelBurns).where({ ID: _id(req.params) });
            if (!burn) return req.error(404, 'Burn record not found');
            if (burn.status !== 'PRELIMINARY') {
                return req.error(409, `Cannot confirm burn in status "${burn.status}". Must be PRELIMINARY.`);
            }

            const now = new Date().toISOString();
            await UPDATE(FuelBurns).where({ ID: burn.ID }).set({
                status: 'CONFIRMED',
                confirmed_by: req.user.id,
                confirmed_at: now,
                requires_review: false,
                modified_at: now,
                modified_by: req.user.id
            });

            // Create ROB ledger entry for this burn (FLIGHT entry)
            await this._createROBEntryForBurn(burn, req.user.id);

            req.info(200, `Burn record for ${burn.tail_number} flight confirmed. ROB ledger updated.`);
            return SELECT.one.from(FuelBurns).where({ ID: burn.ID });
        });

        // Reject burn record
        this.on('reject', FuelBurns, async (req) => {
            const burn = await SELECT.one.from(FuelBurns).where({ ID: _id(req.params) });
            if (!burn) return req.error(404, 'Burn record not found');
            if (burn.status === 'REJECTED') return req.error(409, 'Already rejected.');

            const reason = req.data.reason;
            if (!reason) return req.error(400, 'Rejection reason is required.');

            await UPDATE(FuelBurns).where({ ID: burn.ID }).set({
                status: 'REJECTED',
                review_notes: reason,
                reviewed_by: req.user.id,
                reviewed_at: new Date().toISOString(),
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });
            req.info(200, `Burn record for ${burn.tail_number} rejected.`);
            return SELECT.one.from(FuelBurns).where({ ID: burn.ID });
        });

        // Recalculate Variance
        this.on('recalculateVariance', FuelBurns, async (req) => {
            const burn = await SELECT.one.from(FuelBurns).where({ ID: _id(req.params) });
            if (!burn) return req.error(404, 'Burn record not found');

            if (!burn.planned_burn_kg || burn.planned_burn_kg === 0) {
                return req.error(400, 'No planned burn available for variance calculation.');
            }

            const varianceKg = burn.actual_burn_kg - burn.planned_burn_kg;
            const variancePct = Number(((varianceKg / burn.planned_burn_kg) * 100).toFixed(2));
            const absPct = Math.abs(variancePct);

            let varianceStatus;
            if (absPct <= 5)       varianceStatus = 'NORMAL';
            else if (absPct <= 10) varianceStatus = 'WARNING';
            else if (absPct <= 20) varianceStatus = 'EXCEPTION';
            else                   varianceStatus = 'CRITICAL';

            const requiresReview = varianceStatus === 'EXCEPTION' || varianceStatus === 'CRITICAL';

            await UPDATE(FuelBurns).where({ ID: burn.ID }).set({
                variance_kg: varianceKg,
                variance_pct: variancePct,
                variance_status: varianceStatus,
                requires_review: requiresReview,
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });

            if (requiresReview) {
                req.warn(200, `Variance ${variancePct}% (${varianceStatus}). Record flagged for review.`);
            } else {
                req.info(200, `Variance recalculated: ${variancePct}% (${varianceStatus}).`);
            }
            return SELECT.one.from(FuelBurns).where({ ID: burn.ID });
        });

        // Flag for review
        this.on('flagForReview', FuelBurns, async (req) => {
            const burn = await SELECT.one.from(FuelBurns).where({ ID: _id(req.params) });
            if (!burn) return req.error(404, 'Burn record not found');

            await UPDATE(FuelBurns).where({ ID: burn.ID }).set({
                requires_review: true,
                review_notes: req.data.notes || 'Flagged for review',
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });
            req.info(200, `Burn record for ${burn.tail_number} flagged for review.`);
            return SELECT.one.from(FuelBurns).where({ ID: burn.ID });
        });

        // Complete review
        this.on('completeReview', FuelBurns, async (req) => {
            const burn = await SELECT.one.from(FuelBurns).where({ ID: _id(req.params) });
            if (!burn) return req.error(404, 'Burn record not found');
            if (!burn.requires_review) return req.error(409, 'Record is not flagged for review.');

            await UPDATE(FuelBurns).where({ ID: burn.ID }).set({
                requires_review: false,
                review_notes: req.data.notes || burn.review_notes,
                reviewed_by: req.user.id,
                reviewed_at: new Date().toISOString(),
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });
            req.info(200, `Review completed for ${burn.tail_number}.`);
            return SELECT.one.from(FuelBurns).where({ ID: burn.ID });
        });

        // Post to Finance
        this.on('postToFinance', FuelBurns, async (req) => {
            const burn = await SELECT.one.from(FuelBurns).where({ ID: _id(req.params) });
            if (!burn) return req.error(404, 'Burn record not found');
            if (burn.status !== 'CONFIRMED') {
                return req.error(409, 'Only confirmed burn records can be posted to finance.');
            }
            if (burn.finance_posted) return req.error(409, 'Already posted to finance.');

            await UPDATE(FuelBurns).where({ ID: burn.ID }).set({
                finance_posted: true,
                finance_post_date: new Date().toISOString(),
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });
            req.info(200, `Burn record for ${burn.tail_number} posted to finance (consumption accounting).`);
            return SELECT.one.from(FuelBurns).where({ ID: burn.ID });
        });

        // ====================================================================
        // ROB LEDGER ACTIONS
        // ====================================================================

        this.on('approveAdjustment', ROBLedger, async (req) => {
            const entry = await SELECT.one.from(ROBLedger).where({ ID: _id(req.params) });
            if (!entry) return req.error(404, 'ROB entry not found');
            if (entry.entry_type !== 'ADJUSTMENT') return req.error(409, 'Only adjustment entries can be approved.');

            await UPDATE(ROBLedger).where({ ID: entry.ID }).set({
                adjustment_approved_by: req.user.id,
                adjustment_approved_at: new Date().toISOString(),
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });
            req.info(200, `ROB adjustment for ${entry.tail_number} approved.`);
            return SELECT.one.from(ROBLedger).where({ ID: entry.ID });
        });

        this.on('rejectAdjustment', ROBLedger, async (req) => {
            const entry = await SELECT.one.from(ROBLedger).where({ ID: _id(req.params) });
            if (!entry) return req.error(404, 'ROB entry not found');
            if (entry.entry_type !== 'ADJUSTMENT') return req.error(409, 'Only adjustment entries can be rejected.');

            const reason = req.data.reason;
            if (!reason) return req.error(400, 'Rejection reason is required.');

            // Reverse the adjustment by recalculating closing ROB
            const reversedClosing = entry.opening_rob_kg; // Undo the adjustment
            await UPDATE(ROBLedger).where({ ID: entry.ID }).set({
                adjustment_kg: 0,
                closing_rob_kg: reversedClosing,
                adjustment_reason: `REJECTED: ${reason}. Original: ${entry.adjustment_reason}`,
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });
            req.info(200, `ROB adjustment for ${entry.tail_number} rejected and reversed.`);
            return SELECT.one.from(ROBLedger).where({ ID: entry.ID });
        });

        // ====================================================================
        // EXCEPTION MANAGEMENT ACTIONS
        // ====================================================================

        this.on('assign', FuelBurnExceptions, async (req) => {
            const exc = await SELECT.one.from(FuelBurnExceptions).where({ ID: _id(req.params) });
            if (!exc) return req.error(404, 'Exception not found');
            await UPDATE(FuelBurnExceptions).where({ ID: exc.ID }).set({
                assigned_to: req.data.assignee,
                status: 'ASSIGNED',
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });
            req.info(200, `Exception assigned to ${req.data.assignee}.`);
            return SELECT.one.from(FuelBurnExceptions).where({ ID: exc.ID });
        });

        this.on('startInvestigation', FuelBurnExceptions, async (req) => {
            const exc = await SELECT.one.from(FuelBurnExceptions).where({ ID: _id(req.params) });
            if (!exc) return req.error(404, 'Exception not found');
            await UPDATE(FuelBurnExceptions).where({ ID: exc.ID }).set({
                status: 'INVESTIGATING',
                investigation_started_at: new Date().toISOString(),
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });
            req.info(200, `Investigation started for ${exc.tail_number} exception.`);
            return SELECT.one.from(FuelBurnExceptions).where({ ID: exc.ID });
        });

        this.on('resolve', FuelBurnExceptions, async (req) => {
            const exc = await SELECT.one.from(FuelBurnExceptions).where({ ID: _id(req.params) });
            if (!exc) return req.error(404, 'Exception not found');
            await UPDATE(FuelBurnExceptions).where({ ID: exc.ID }).set({
                status: 'RESOLVED',
                root_cause: req.data.rootCause,
                corrective_action: req.data.correctiveAction,
                resolved_at: new Date().toISOString(),
                resolved_by: req.user.id,
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });
            req.info(200, `Exception resolved. Root cause: ${req.data.rootCause}`);
            return SELECT.one.from(FuelBurnExceptions).where({ ID: exc.ID });
        });

        this.on('close', FuelBurnExceptions, async (req) => {
            const exc = await SELECT.one.from(FuelBurnExceptions).where({ ID: _id(req.params) });
            if (!exc) return req.error(404, 'Exception not found');
            if (exc.status !== 'RESOLVED') return req.error(409, 'Exception must be resolved before closing.');
            await UPDATE(FuelBurnExceptions).where({ ID: exc.ID }).set({
                status: 'CLOSED',
                closed_at: new Date().toISOString(),
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });
            req.info(200, `Exception closed for ${exc.tail_number}.`);
            return SELECT.one.from(FuelBurnExceptions).where({ ID: exc.ID });
        });

        this.on('linkMaintenance', FuelBurnExceptions, async (req) => {
            const exc = await SELECT.one.from(FuelBurnExceptions).where({ ID: _id(req.params) });
            if (!exc) return req.error(404, 'Exception not found');
            await UPDATE(FuelBurnExceptions).where({ ID: exc.ID }).set({
                maintenance_order: req.data.maintenanceOrder,
                modified_at: new Date().toISOString(),
                modified_by: req.user.id
            });
            req.info(200, `Maintenance order ${req.data.maintenanceOrder} linked to exception.`);
            return SELECT.one.from(FuelBurnExceptions).where({ ID: exc.ID });
        });

        // ====================================================================
        // SERVICE-LEVEL ACTIONS: ACARS / EFB Ingest
        // ====================================================================

        this.on('ingestACARS', async (req) => {
            const { flightNumber, tailNumber, burnDate, actualBurnKg, messageType, timestamp, messageId } = req.data;

            if (!tailNumber || !actualBurnKg) {
                return req.error(400, 'FB401: tailNumber and actualBurnKg are required.');
            }
            if (actualBurnKg <= 0) {
                return req.error(400, 'FB401: actualBurnKg must be greater than 0.');
            }

            // Check for duplicate
            if (messageId) {
                const existing = await SELECT.one.from(FuelBurns).where({ source_message_id: messageId });
                if (existing) {
                    return req.error(409, `FB403: Duplicate ACARS message ${messageId} already ingested.`);
                }
            }

            // Lookup aircraft
            const { AIRCRAFT_MASTER } = cds.entities('fuelsphere');
            const aircraft = await SELECT.one.from(AIRCRAFT_MASTER).where({ type_code: { like: '%' } }); // Simplified

            // Lookup planned burn for variance
            let plannedBurnKg = 0;
            let varianceKg = 0;
            let variancePct = 0;
            let varianceStatus = 'NORMAL';

            // Try to match a flight
            const { FLIGHT_SCHEDULE } = cds.entities('fuelsphere');
            const flight = flightNumber
                ? await SELECT.one.from(FLIGHT_SCHEDULE).where({ flight_number: flightNumber, flight_date: burnDate })
                : null;

            // Calculate variance if planned data exists
            if (plannedBurnKg > 0) {
                varianceKg = actualBurnKg - plannedBurnKg;
                variancePct = Number(((varianceKg / plannedBurnKg) * 100).toFixed(2));
                const absPct = Math.abs(variancePct);
                if (absPct <= 5)       varianceStatus = 'NORMAL';
                else if (absPct <= 10) varianceStatus = 'WARNING';
                else if (absPct <= 20) varianceStatus = 'EXCEPTION';
                else                   varianceStatus = 'CRITICAL';
            }

            const requiresReview = varianceStatus === 'EXCEPTION' || varianceStatus === 'CRITICAL';
            const burnId = cds.utils.uuid();

            await INSERT.into(FuelBurns).entries({
                ID: burnId,
                flight_ID: flight ? flight.ID : null,
                tail_number: tailNumber,
                burn_date: burnDate,
                actual_burn_kg: actualBurnKg,
                planned_burn_kg: plannedBurnKg || null,
                variance_kg: varianceKg,
                variance_pct: variancePct,
                variance_status: varianceStatus,
                data_source: 'ACARS',
                source_message_id: messageId,
                status: 'PRELIMINARY',
                requires_review: requiresReview,
                review_notes: requiresReview ? `High variance detected from ACARS data` : null
            });

            // Auto-create exception if variance is high
            if (requiresReview) {
                await INSERT.into(FuelBurnExceptions).entries({
                    ID: cds.utils.uuid(),
                    fuel_burn_ID: burnId,
                    tail_number: tailNumber,
                    exception_date: burnDate,
                    variance_kg: varianceKg,
                    variance_pct: variancePct,
                    variance_status: varianceStatus,
                    status: 'OPEN'
                });
            }

            return {
                success: true,
                burnId: burnId,
                tailNumber: tailNumber,
                flightNumber: flightNumber,
                actualBurnKg: actualBurnKg,
                varianceKg: varianceKg,
                variancePct: variancePct,
                varianceStatus: varianceStatus,
                status: 'PRELIMINARY',
                message: `ACARS burn data ingested for ${tailNumber}. Status: ${varianceStatus}.`
            };
        });

        this.on('ingestEFB', async (req) => {
            const { flightNumber, tailNumber, burnDate, actualBurnKg, blockOffTime, blockOnTime, submissionId } = req.data;

            if (!tailNumber || !actualBurnKg) {
                return req.error(400, 'FB401: tailNumber and actualBurnKg are required.');
            }

            // Check for duplicate
            if (submissionId) {
                const existing = await SELECT.one.from(FuelBurns).where({ source_message_id: submissionId });
                if (existing) {
                    return req.error(409, `FB403: Duplicate EFB submission ${submissionId}.`);
                }
            }

            // Calculate flight duration
            let durationMins = null;
            if (blockOffTime && blockOnTime) {
                const offMs = new Date(blockOffTime).getTime();
                const onMs = new Date(blockOnTime).getTime();
                durationMins = Math.round((onMs - offMs) / 60000);
            }

            const burnId = cds.utils.uuid();
            await INSERT.into(FuelBurns).entries({
                ID: burnId,
                tail_number: tailNumber,
                burn_date: burnDate,
                actual_burn_kg: actualBurnKg,
                block_off_time: blockOffTime,
                block_on_time: blockOnTime,
                flight_duration_mins: durationMins,
                data_source: 'EFB',
                source_message_id: submissionId,
                status: 'PRELIMINARY'
            });

            return {
                success: true,
                burnId: burnId,
                tailNumber: tailNumber,
                flightNumber: flightNumber,
                actualBurnKg: actualBurnKg,
                flightDurationMins: durationMins,
                varianceKg: 0,
                variancePct: 0,
                status: 'PRELIMINARY',
                message: `EFB burn data ingested for ${tailNumber}. Duration: ${durationMins || 'N/A'} minutes.`
            };
        });

        // ====================================================================
        // ROB ADJUSTMENT
        // ====================================================================

        this.on('adjustROB', async (req) => {
            const { aircraftId, tailNumber, airportCode, adjustmentKg, reason } = req.data;

            if (!tailNumber || !adjustmentKg) return req.error(400, 'tailNumber and adjustmentKg are required.');
            if (!reason) return req.error(400, 'FB409: Adjustment reason is required.');

            // Get current ROB (latest entry for this aircraft)
            const lastEntry = await SELECT.one.from(ROBLedger)
                .where({ tail_number: tailNumber })
                .orderBy('record_date desc', 'record_time desc', 'sequence desc');

            const openingROB = lastEntry ? lastEntry.closing_rob_kg : 0;
            const closingROB = openingROB + adjustmentKg;

            if (closingROB < 0) {
                return req.error(400, 'FB402: Closing ROB cannot be negative.');
            }

            // Get max capacity from aircraft
            const { AIRCRAFT_MASTER } = cds.entities('fuelsphere');
            const aircraft = aircraftId
                ? await SELECT.one.from(AIRCRAFT_MASTER).where({ ID: aircraftId })
                : null;
            const maxCapacity = aircraft ? aircraft.fuel_capacity_kg : (lastEntry ? lastEntry.max_capacity_kg : 0);
            const robPct = maxCapacity > 0 ? Number(((closingROB / maxCapacity) * 100).toFixed(2)) : 0;

            // Find airport
            const { MASTER_AIRPORTS } = cds.entities('fuelsphere');
            const airport = airportCode
                ? await SELECT.one.from(MASTER_AIRPORTS).where({ iata_code: airportCode })
                : null;

            const now = new Date();
            const nextSeq = lastEntry ? lastEntry.sequence + 1 : 1;
            const ledgerId = cds.utils.uuid();

            await INSERT.into(ROBLedger).entries({
                ID: ledgerId,
                aircraft_ID: aircraftId,
                tail_number: tailNumber,
                record_date: now.toISOString().slice(0, 10),
                record_time: now.toISOString().slice(11, 19),
                sequence: nextSeq,
                airport_ID: airport ? airport.ID : null,
                airport_code: airportCode,
                entry_type: 'ADJUSTMENT',
                opening_rob_kg: openingROB,
                uplift_kg: 0,
                burn_kg: 0,
                adjustment_kg: adjustmentKg,
                closing_rob_kg: closingROB,
                max_capacity_kg: maxCapacity,
                rob_percentage: robPct,
                adjustment_reason: reason,
                data_source: 'MANUAL',
                is_estimated: false
            });

            return {
                success: true,
                ledgerId: ledgerId,
                tailNumber: tailNumber,
                airportCode: airportCode,
                previousROBKg: openingROB,
                adjustmentKg: adjustmentKg,
                newROBKg: closingROB,
                requiresApproval: true,
                message: `ROB adjusted by ${adjustmentKg >= 0 ? '+' : ''}${adjustmentKg} kg for ${tailNumber}. New ROB: ${closingROB} kg (${robPct}%). Requires approval.`
            };
        });

        // ====================================================================
        // SERVICE-LEVEL FUNCTIONS
        // ====================================================================

        this.on('getCurrentROB', async (req) => {
            const { tailNumber } = req.data;
            if (!tailNumber) return req.error(400, 'Tail number is required.');

            const entry = await SELECT.one.from(ROBLedger)
                .where({ tail_number: tailNumber })
                .orderBy('record_date desc', 'record_time desc', 'sequence desc');

            if (!entry) return req.error(404, `No ROB data found for ${tailNumber}.`);

            return {
                tailNumber: entry.tail_number,
                aircraftType: '',
                currentROBKg: entry.closing_rob_kg,
                maxCapacityKg: entry.max_capacity_kg,
                robPercentage: entry.rob_percentage,
                lastUpdateDate: entry.record_date,
                lastUpdateTime: entry.record_time,
                lastAirport: entry.airport_code,
                lastEntryType: entry.entry_type
            };
        });

        this.on('getROBHistory', async (req) => {
            const { tailNumber, fromDate, toDate } = req.data;
            if (!tailNumber) return req.error(400, 'Tail number is required.');

            let query = SELECT.from(ROBLedger)
                .where({ tail_number: tailNumber })
                .orderBy('record_date asc', 'record_time asc', 'sequence asc');

            const entries = await query;
            return entries
                .filter(e => {
                    if (fromDate && e.record_date < fromDate) return false;
                    if (toDate && e.record_date > toDate) return false;
                    return true;
                })
                .map(e => ({
                    ledgerId: e.ID,
                    recordDate: e.record_date,
                    recordTime: e.record_time,
                    airportCode: e.airport_code,
                    entryType: e.entry_type,
                    openingROBKg: e.opening_rob_kg,
                    upliftKg: e.uplift_kg,
                    burnKg: e.burn_kg,
                    adjustmentKg: e.adjustment_kg,
                    closingROBKg: e.closing_rob_kg,
                    flightNumber: ''
                }));
        });

        this.on('getDashboardKPIs', async (req) => {
            const burns = await SELECT.from(FuelBurns);
            const total = burns.length;
            const totalBurn = burns.reduce((s, b) => s + (b.actual_burn_kg || 0), 0);
            const totalPlanned = burns.reduce((s, b) => s + (b.planned_burn_kg || 0), 0);
            const totalVariance = totalBurn - totalPlanned;

            return {
                totalFlights: total,
                totalBurnKg: totalBurn,
                avgBurnPerFlight: total > 0 ? Number((totalBurn / total).toFixed(2)) : 0,
                plannedBurnKg: totalPlanned,
                totalVarianceKg: totalVariance,
                variancePct: totalPlanned > 0 ? Number(((totalVariance / totalPlanned) * 100).toFixed(2)) : 0,
                normalCount: burns.filter(b => b.variance_status === 'NORMAL').length,
                warningCount: burns.filter(b => b.variance_status === 'WARNING').length,
                exceptionCount: burns.filter(b => b.variance_status === 'EXCEPTION').length,
                criticalCount: burns.filter(b => b.variance_status === 'CRITICAL').length,
                pendingConfirmation: burns.filter(b => b.status === 'PRELIMINARY').length,
                openExceptions: 0
            };
        });

        this.on('getPendingConfirmations', async (req) => {
            const burns = await SELECT.from(FuelBurns).where({ status: 'PRELIMINARY' });
            return burns.map(b => ({
                burnId: b.ID,
                tailNumber: b.tail_number,
                flightNumber: '',
                burnDate: b.burn_date,
                actualBurnKg: b.actual_burn_kg,
                dataSource: b.data_source,
                variancePct: b.variance_pct || 0,
                createdAt: b.created_at
            }));
        });

        this.on('getFleetROBSummary', async (req) => {
            // Get latest ROB entry per aircraft
            const allEntries = await SELECT.from(ROBLedger).orderBy('record_date desc', 'record_time desc', 'sequence desc');
            const seen = new Set();
            const latest = [];
            for (const e of allEntries) {
                if (!seen.has(e.tail_number)) {
                    seen.add(e.tail_number);
                    const robPct = e.rob_percentage || 0;
                    latest.push({
                        tailNumber: e.tail_number,
                        aircraftType: '',
                        currentROBKg: e.closing_rob_kg,
                        maxCapacityKg: e.max_capacity_kg,
                        robPercentage: robPct,
                        lastAirport: e.airport_code,
                        lastUpdateTime: `${e.record_date}T${e.record_time}`,
                        status: robPct < 20 ? 'LOW_FUEL' : robPct < 30 ? 'NEEDS_ATTENTION' : 'OK'
                    });
                }
            }
            return latest;
        });

        // ====================================================================
        // IMPORT FUEL BURN FROM EXCEL
        // ====================================================================

        this.on('importFuelBurnExcel', async (req) => {
            const { fileContent, fileName } = req.data;
            const errors = [];
            let burnsProcessed = 0, burnsCreated = 0, burnsSkipped = 0;

            // Validate & parse
            if (!fileContent) return req.error(400, 'FB401: File content is required.');
            const ext = (fileName || '').toLowerCase();
            if (ext && !ext.endsWith('.xlsx') && !ext.endsWith('.xls') && !ext.endsWith('.csv'))
                return req.error(400, 'FB401: Invalid file format. Only .xlsx, .xls and .csv files are supported.');

            let workbook;
            try {
                const buf = Buffer.isBuffer(fileContent) ? fileContent : Buffer.from(fileContent, 'base64');
                workbook = XLSX.read(buf, { type: 'buffer' });
            } catch (e) {
                return req.error(400, `FB401: Failed to parse file: ${e.message}`);
            }

            const sheetName = workbook.SheetNames[0];
            if (!sheetName) return req.error(400, 'FB401: File contains no sheets.');
            const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
            if (rows.length === 0) return req.error(400, 'FB402: Sheet is empty.');

            // Validate required columns
            const requiredCols = ['Flight Number', 'Aircraft Tail', 'Departure Airport\n(IATA)',
                'Arrival Airport\n(IATA)', 'Burn Date\n(YYYY-MM-DD)', 'Actual Burn (Kg)', 'Data Source'];
            // Also try simpler column names
            const headers = Object.keys(rows[0]);
            const _col = (name) => {
                const found = headers.find(h => h.replace(/\n/g, ' ').trim().toLowerCase().startsWith(name.toLowerCase()));
                return found || null;
            };
            const colFlightNumber = _col('Flight Number');
            const colAircraftTail = _col('Aircraft Tail');
            const colDepAirport = _col('Departure Airport');
            const colArrAirport = _col('Arrival Airport');
            const colBurnDate = _col('Burn Date');
            const colBlockOff = _col('Block-Off Time') || _col('Block Off Time');
            const colBlockOn = _col('Block-On Time') || _col('Block On Time');
            const colActualBurn = _col('Actual Burn');
            const colDataSource = _col('Data Source');
            const colPlannedBurn = _col('Planned Burn');
            const colRemarks = _col('Remarks');

            const missing = [];
            if (!colFlightNumber) missing.push('Flight Number');
            if (!colAircraftTail) missing.push('Aircraft Tail');
            if (!colDepAirport) missing.push('Departure Airport');
            if (!colArrAirport) missing.push('Arrival Airport');
            if (!colBurnDate) missing.push('Burn Date');
            if (!colActualBurn) missing.push('Actual Burn (Kg)');
            if (!colDataSource) missing.push('Data Source');
            if (missing.length > 0)
                return req.error(400, `FB402: Missing required columns: ${missing.join(', ')}`);

            // Pre-fetch reference data
            const { FLIGHT_SCHEDULE, AIRCRAFT_MASTER, MASTER_AIRPORTS, FUEL_BURNS } = cds.entities('fuelsphere');

            const aircraftRows = await SELECT.from(AIRCRAFT_MASTER).columns('ID', 'type_code');
            const airportRows = await SELECT.from(MASTER_AIRPORTS).columns('ID', 'iata_code');
            const airportMap = new Map(airportRows.map(a => [a.iata_code, a.ID]));
            const flightRows = await SELECT.from(FLIGHT_SCHEDULE).columns('ID', 'flight_number', 'flight_date', 'aircraft_type');
            const flightMap = new Map(flightRows.map(f => [`${f.flight_number}|${f.flight_date}`, f]));
            const existingBurns = await SELECT.from(FUEL_BURNS).columns('tail_number', 'burn_date');
            const existingBurnSet = new Set(existingBurns.map(b => `${b.tail_number}|${b.burn_date}`));

            // Date helpers
            const _normalizeDate = (val) => {
                if (typeof val === 'number') {
                    const p = XLSX.SSF.parse_date_code(val);
                    if (p) return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
                }
                const s = String(val).trim();
                if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
                if (/^\d{8}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
                return s;
            };

            // Process rows
            const burnsToInsert = [];
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const rowNum = i + 2;
                burnsProcessed++;

                const flightNumber = String(row[colFlightNumber] || '').trim();
                const tailNumber = String(row[colAircraftTail] || '').trim();
                const depAirport = String(row[colDepAirport] || '').trim().toUpperCase();
                const arrAirport = String(row[colArrAirport] || '').trim().toUpperCase();
                const burnDate = _normalizeDate(row[colBurnDate]);
                const blockOff = colBlockOff ? String(row[colBlockOff] || '').trim() : '';
                const blockOn = colBlockOn ? String(row[colBlockOn] || '').trim() : '';
                const actualBurn = parseFloat(row[colActualBurn]);
                const dataSource = String(row[colDataSource] || '').trim().toUpperCase();
                const plannedBurn = colPlannedBurn && row[colPlannedBurn] !== '' ? parseFloat(row[colPlannedBurn]) : null;
                const remarks = colRemarks ? String(row[colRemarks] || '').trim() : '';

                // Skip empty rows
                if (!flightNumber && !tailNumber) { burnsSkipped++; continue; }

                // Validate required
                if (!flightNumber) { errors.push({ row: rowNum, field: 'Flight Number', message: 'Flight number is required.', severity: 'ERROR' }); burnsSkipped++; continue; }
                if (!tailNumber) { errors.push({ row: rowNum, field: 'Aircraft Tail', message: 'Aircraft tail is required.', severity: 'ERROR' }); burnsSkipped++; continue; }
                if (!burnDate || !/^\d{4}-\d{2}-\d{2}$/.test(burnDate)) { errors.push({ row: rowNum, field: 'Burn Date', message: `Invalid burn date: '${row[colBurnDate]}'.`, severity: 'ERROR' }); burnsSkipped++; continue; }
                if (isNaN(actualBurn) || actualBurn <= 0) { errors.push({ row: rowNum, field: 'Actual Burn (Kg)', message: 'FB401: Actual burn must be > 0.', severity: 'ERROR' }); burnsSkipped++; continue; }

                const validSources = ['ACARS', 'EFB', 'MANUAL', 'JEFFERSON'];
                if (!validSources.includes(dataSource)) { errors.push({ row: rowNum, field: 'Data Source', message: `Invalid data source '${dataSource}'. Valid: ${validSources.join(', ')}`, severity: 'ERROR' }); burnsSkipped++; continue; }

                // Validate airports
                if (!airportMap.has(depAirport)) { errors.push({ row: rowNum, field: 'Departure Airport', message: `Airport '${depAirport}' not found.`, severity: 'ERROR' }); burnsSkipped++; continue; }
                if (!airportMap.has(arrAirport)) { errors.push({ row: rowNum, field: 'Arrival Airport', message: `Airport '${arrAirport}' not found.`, severity: 'ERROR' }); burnsSkipped++; continue; }

                // Duplicate detection
                const dupKey = `${tailNumber}|${burnDate}`;
                if (existingBurnSet.has(dupKey)) {
                    errors.push({ row: rowNum, field: 'Flight Number', message: `FB403: Duplicate burn for ${tailNumber} on ${burnDate}.`, severity: 'WARNING' });
                    burnsSkipped++; continue;
                }

                // Calculate variance
                let varianceKg = null, variancePct = null, varianceStatus = 'NORMAL';
                let requiresReview = false;
                if (plannedBurn && plannedBurn > 0) {
                    varianceKg = actualBurn - plannedBurn;
                    variancePct = parseFloat(((varianceKg / plannedBurn) * 100).toFixed(2));
                    const absPct = Math.abs(variancePct);
                    if (absPct > 20) { varianceStatus = 'CRITICAL'; requiresReview = true; }
                    else if (absPct > 10) { varianceStatus = 'EXCEPTION'; requiresReview = true; }
                    else if (absPct > 5) { varianceStatus = 'WARNING'; }
                    else { varianceStatus = 'NORMAL'; }
                }

                // Calculate flight duration from block times
                let flightDurationMins = null;
                let blockOffTime = null, blockOnTime = null;
                if (blockOff && blockOn) {
                    const offMatch = blockOff.match(/^(\d{1,2}):(\d{2})$/);
                    const onMatch = blockOn.match(/^(\d{1,2}):(\d{2})$/);
                    if (offMatch && onMatch) {
                        blockOffTime = `${burnDate}T${offMatch[1].padStart(2,'0')}:${offMatch[2]}:00Z`;
                        blockOnTime = `${burnDate}T${onMatch[1].padStart(2,'0')}:${onMatch[2]}:00Z`;
                        let offMins = parseInt(offMatch[1]) * 60 + parseInt(offMatch[2]);
                        let onMins = parseInt(onMatch[1]) * 60 + parseInt(onMatch[2]);
                        if (onMins < offMins) onMins += 1440; // next day
                        flightDurationMins = onMins - offMins;
                    }
                }

                // Lookup flight
                const flightKey = `${flightNumber}|${burnDate}`;
                const flightRecord = flightMap.get(flightKey);

                burnsToInsert.push({
                    ID: cds.utils.uuid(),
                    flight_ID: flightRecord ? flightRecord.ID : null,
                    aircraft_type_code: flightRecord ? flightRecord.aircraft_type : null,
                    tail_number: tailNumber,
                    origin_airport_iata_code: depAirport,
                    destination_airport_iata_code: arrAirport,
                    burn_date: burnDate,
                    block_off_time: blockOffTime,
                    block_on_time: blockOnTime,
                    flight_duration_mins: flightDurationMins,
                    actual_burn_kg: actualBurn,
                    planned_burn_kg: plannedBurn,
                    variance_kg: varianceKg,
                    variance_pct: variancePct,
                    variance_status: varianceStatus,
                    data_source: dataSource,
                    status: 'PRELIMINARY',
                    requires_review: requiresReview,
                    review_notes: remarks || null
                });

                existingBurnSet.add(dupKey);
            }

            // Bulk INSERT
            if (burnsToInsert.length > 0) {
                try {
                    await INSERT.into(FUEL_BURNS).entries(burnsToInsert);
                    burnsCreated = burnsToInsert.length;
                } catch (e) {
                    return req.error(500, `FB500: Failed to insert burn records: ${e.message}`);
                }
            }

            const hasErrors = errors.some(e => e.severity === 'ERROR');
            return {
                success: !hasErrors && burnsCreated > 0,
                fileName: fileName || 'unknown',
                burnsProcessed, burnsCreated, burnsSkipped, errors,
                message: burnsCreated > 0
                    ? `Imported ${burnsCreated} burn record(s).${burnsSkipped > 0 ? ` ${burnsSkipped} skipped.` : ''}`
                    : `No records imported. ${burnsSkipped} skipped.`
            };
        });

        // ====================================================================
        // IMPORT ROB INITIAL LOAD FROM EXCEL
        // ====================================================================

        this.on('importROBInitialExcel', async (req) => {
            const { fileContent, fileName } = req.data;
            const errors = [];
            let entriesProcessed = 0, entriesCreated = 0, entriesSkipped = 0;

            if (!fileContent) return req.error(400, 'FB401: File content is required.');

            let workbook;
            try {
                const buf = Buffer.isBuffer(fileContent) ? fileContent : Buffer.from(fileContent, 'base64');
                workbook = XLSX.read(buf, { type: 'buffer' });
            } catch (e) {
                return req.error(400, `FB401: Failed to parse file: ${e.message}`);
            }

            const sheetName = workbook.SheetNames[0];
            if (!sheetName) return req.error(400, 'FB401: File contains no sheets.');
            const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
            if (rows.length === 0) return req.error(400, 'FB402: Sheet is empty.');

            const headers = Object.keys(rows[0]);
            const _col = (name) => headers.find(h => h.replace(/\n/g, ' ').trim().toLowerCase().startsWith(name.toLowerCase())) || null;

            const colTail = _col('Aircraft Tail');
            const colType = _col('Aircraft Type');
            const colDate = _col('Record Date');
            const colTime = _col('Record Time');
            const colAirport = _col('Airport');
            const colFlight = _col('Flight Number');
            const colOpenROB = _col('Opening ROB');
            const colUplift = _col('Uplift');
            const colBurn = _col('Burn');
            const colAdj = _col('Adjustment');
            const colMaxCap = _col('Max Capacity');
            const colNotes = _col('Notes');

            const missing = [];
            if (!colTail) missing.push('Aircraft Tail');
            if (!colDate) missing.push('Record Date');
            if (!colTime) missing.push('Record Time');
            if (!colAirport) missing.push('Airport');
            if (!colOpenROB) missing.push('Opening ROB (Kg)');
            if (!colMaxCap) missing.push('Max Capacity (Kg)');
            if (missing.length > 0)
                return req.error(400, `FB402: Missing required columns: ${missing.join(', ')}`);

            const { AIRCRAFT_MASTER, MASTER_AIRPORTS, ROB_LEDGER, FLIGHT_SCHEDULE } = cds.entities('fuelsphere');
            const airportRows = await SELECT.from(MASTER_AIRPORTS).columns('ID', 'iata_code');
            const airportMap = new Map(airportRows.map(a => [a.iata_code, a.ID]));
            const aircraftRows = await SELECT.from(AIRCRAFT_MASTER).columns('ID', 'type_code');
            const aircraftMap = new Map(aircraftRows.map(a => [a.type_code, a.ID]));

            // Track sequence per aircraft+date
            const seqCounters = {};

            const _normalizeDate = (val) => {
                if (typeof val === 'number') {
                    const p = XLSX.SSF.parse_date_code(val);
                    if (p) return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
                }
                const s = String(val).trim();
                if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
                if (/^\d{8}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
                return s;
            };

            const entriesToInsert = [];
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const rowNum = i + 2;
                entriesProcessed++;

                const tailNumber = String(row[colTail] || '').trim();
                const aircraftType = colType ? String(row[colType] || '').trim() : '';
                const recordDate = _normalizeDate(row[colDate]);
                const recordTime = String(row[colTime] || '').trim();
                const airportCode = String(row[colAirport] || '').trim().toUpperCase();
                const flightNumber = colFlight ? String(row[colFlight] || '').trim() : '';
                const openingROB = parseFloat(row[colOpenROB]);
                const uplift = row[colUplift] !== '' ? parseFloat(row[colUplift]) : 0;
                const burn = row[colBurn] !== '' ? parseFloat(row[colBurn]) : 0;
                const adj = row[colAdj] !== '' ? parseFloat(row[colAdj]) : 0;
                const maxCapacity = parseFloat(row[colMaxCap]);
                const notes = colNotes ? String(row[colNotes] || '').trim() : '';

                if (!tailNumber) { entriesSkipped++; continue; }

                if (!recordDate || !/^\d{4}-\d{2}-\d{2}$/.test(recordDate)) {
                    errors.push({ row: rowNum, field: 'Record Date', message: `Invalid date: '${row[colDate]}'.`, severity: 'ERROR' }); entriesSkipped++; continue;
                }
                if (!recordTime) {
                    errors.push({ row: rowNum, field: 'Record Time', message: 'Record time is required.', severity: 'ERROR' }); entriesSkipped++; continue;
                }
                if (!airportMap.has(airportCode)) {
                    errors.push({ row: rowNum, field: 'Airport', message: `Airport '${airportCode}' not found.`, severity: 'ERROR' }); entriesSkipped++; continue;
                }
                if (isNaN(openingROB)) {
                    errors.push({ row: rowNum, field: 'Opening ROB', message: 'Opening ROB is required.', severity: 'ERROR' }); entriesSkipped++; continue;
                }
                if (isNaN(maxCapacity) || maxCapacity <= 0) {
                    errors.push({ row: rowNum, field: 'Max Capacity', message: 'Max capacity is required and must be > 0.', severity: 'ERROR' }); entriesSkipped++; continue;
                }

                // Calculate closing ROB
                const closingROB = openingROB + uplift - burn + adj;
                if (closingROB < 0) {
                    errors.push({ row: rowNum, field: 'Closing ROB', message: `FB402: Closing ROB would be negative (${closingROB.toFixed(2)} kg).`, severity: 'ERROR' }); entriesSkipped++; continue;
                }

                const robPct = parseFloat(((closingROB / maxCapacity) * 100).toFixed(2));

                // Determine entry type
                let entryType = 'INITIAL';
                if (burn > 0) entryType = 'FLIGHT';
                else if (uplift > 0) entryType = 'UPLIFT';
                else if (adj !== 0) entryType = 'ADJUSTMENT';

                // Auto-increment sequence
                const seqKey = `${tailNumber}|${recordDate}`;
                seqCounters[seqKey] = (seqCounters[seqKey] || 0) + 1;

                // Normalize time (HH:MM → HH:MM:SS)
                let normalizedTime = recordTime;
                if (/^\d{1,2}:\d{2}$/.test(recordTime)) {
                    normalizedTime = recordTime.padStart(5, '0') + ':00';
                }

                entriesToInsert.push({
                    ID: cds.utils.uuid(),
                    aircraft_ID: aircraftMap.get(aircraftType) || null,
                    tail_number: tailNumber,
                    record_date: recordDate,
                    record_time: normalizedTime,
                    sequence: seqCounters[seqKey],
                    airport_ID: airportMap.get(airportCode),
                    airport_code: airportCode,
                    entry_type: entryType,
                    opening_rob_kg: openingROB,
                    uplift_kg: uplift,
                    burn_kg: burn,
                    adjustment_kg: adj,
                    closing_rob_kg: closingROB,
                    max_capacity_kg: maxCapacity,
                    rob_percentage: robPct,
                    adjustment_reason: notes || null,
                    data_source: 'MANUAL',
                    is_estimated: false
                });
            }

            if (entriesToInsert.length > 0) {
                try {
                    await INSERT.into(ROB_LEDGER).entries(entriesToInsert);
                    entriesCreated = entriesToInsert.length;
                } catch (e) {
                    return req.error(500, `FB500: Failed to insert ROB entries: ${e.message}`);
                }
            }

            const hasErrors = errors.some(e => e.severity === 'ERROR');
            return {
                success: !hasErrors && entriesCreated > 0,
                fileName: fileName || 'unknown',
                entriesProcessed, entriesCreated, entriesSkipped, errors,
                message: entriesCreated > 0
                    ? `Imported ${entriesCreated} ROB entry/entries.${entriesSkipped > 0 ? ` ${entriesSkipped} skipped.` : ''}`
                    : `No entries imported. ${entriesSkipped} skipped.`
            };
        });

        // ====================================================================
        // IMPORT PLANNED BURN DATA FROM EXCEL
        // ====================================================================

        this.on('importPlannedBurnExcel', async (req) => {
            const { fileContent, fileName } = req.data;
            const errors = [];
            let plansProcessed = 0, plansCreated = 0, plansUpdated = 0, plansSkipped = 0;

            if (!fileContent) return req.error(400, 'FB401: File content is required.');

            let workbook;
            try {
                const buf = Buffer.isBuffer(fileContent) ? fileContent : Buffer.from(fileContent, 'base64');
                workbook = XLSX.read(buf, { type: 'buffer' });
            } catch (e) {
                return req.error(400, `FB401: Failed to parse file: ${e.message}`);
            }

            const sheetName = workbook.SheetNames[0];
            if (!sheetName) return req.error(400, 'FB401: File contains no sheets.');
            const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
            if (rows.length === 0) return req.error(400, 'FB402: Sheet is empty.');

            const headers = Object.keys(rows[0]);
            const _col = (name) => headers.find(h => h.replace(/\n/g, ' ').trim().toLowerCase().startsWith(name.toLowerCase())) || null;

            const colFlight = _col('Flight Number');
            const colAcType = _col('Aircraft Type');
            const colDep = _col('Departure Airport');
            const colArr = _col('Arrival Airport');
            const colPlanned = _col('Planned Burn');
            const colTaxi = _col('Taxi Fuel');
            const colSource = _col('Source');
            const colFrom = _col('Valid From');
            const colTo = _col('Valid To');
            const colNotes = _col('Notes');

            const missing = [];
            if (!colFlight) missing.push('Flight Number');
            if (!colAcType) missing.push('Aircraft Type');
            if (!colDep) missing.push('Departure Airport');
            if (!colArr) missing.push('Arrival Airport');
            if (!colPlanned) missing.push('Planned Burn (Kg)');
            if (!colSource) missing.push('Source');
            if (!colFrom) missing.push('Valid From');
            if (!colTo) missing.push('Valid To');
            if (missing.length > 0)
                return req.error(400, `FB402: Missing required columns: ${missing.join(', ')}`);

            const { AIRCRAFT_MASTER, MASTER_AIRPORTS, FUEL_BURNS } = cds.entities('fuelsphere');
            const aircraftRows = await SELECT.from(AIRCRAFT_MASTER).columns('type_code');
            const aircraftSet = new Set(aircraftRows.map(a => a.type_code));
            const airportRows = await SELECT.from(MASTER_AIRPORTS).columns('iata_code');
            const airportSet = new Set(airportRows.map(a => a.iata_code));

            const _normalizeDate = (val) => {
                if (typeof val === 'number') {
                    const p = XLSX.SSF.parse_date_code(val);
                    if (p) return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
                }
                const s = String(val).trim();
                if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
                if (/^\d{8}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
                return s;
            };

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const rowNum = i + 2;
                plansProcessed++;

                const flightNumber = String(row[colFlight] || '').trim();
                const aircraftType = String(row[colAcType] || '').trim();
                const depAirport = String(row[colDep] || '').trim().toUpperCase();
                const arrAirport = String(row[colArr] || '').trim().toUpperCase();
                const plannedBurn = parseFloat(row[colPlanned]);
                const taxiFuel = colTaxi && row[colTaxi] !== '' ? parseFloat(row[colTaxi]) : 0;
                const source = String(row[colSource] || '').trim();
                const validFrom = _normalizeDate(row[colFrom]);
                const validTo = _normalizeDate(row[colTo]);

                if (!flightNumber) { plansSkipped++; continue; }
                if (isNaN(plannedBurn) || plannedBurn <= 0) { errors.push({ row: rowNum, field: 'Planned Burn (Kg)', message: 'Planned burn must be > 0.', severity: 'ERROR' }); plansSkipped++; continue; }
                if (aircraftType && !aircraftSet.has(aircraftType)) { errors.push({ row: rowNum, field: 'Aircraft Type', message: `Aircraft type '${aircraftType}' not found.`, severity: 'WARNING' }); }
                if (!airportSet.has(depAirport)) { errors.push({ row: rowNum, field: 'Departure Airport', message: `Airport '${depAirport}' not found.`, severity: 'ERROR' }); plansSkipped++; continue; }
                if (!airportSet.has(arrAirport)) { errors.push({ row: rowNum, field: 'Arrival Airport', message: `Airport '${arrAirport}' not found.`, severity: 'ERROR' }); plansSkipped++; continue; }

                const totalPlanned = plannedBurn + taxiFuel;

                // Try to find existing burn records for this flight within date range to update
                const existingBurns = await SELECT.from(FUEL_BURNS)
                    .where({ origin_airport_iata_code: depAirport, destination_airport_iata_code: arrAirport,
                             burn_date: { '>=': validFrom, '<=': validTo }, planned_burn_kg: null });

                if (existingBurns.length > 0) {
                    for (const burn of existingBurns) {
                        await UPDATE(FUEL_BURNS).set({
                            planned_burn_kg: totalPlanned,
                            taxi_out_kg: taxiFuel,
                            variance_kg: burn.actual_burn_kg ? burn.actual_burn_kg - totalPlanned : null,
                            variance_pct: burn.actual_burn_kg && totalPlanned > 0
                                ? parseFloat((((burn.actual_burn_kg - totalPlanned) / totalPlanned) * 100).toFixed(2))
                                : null
                        }).where({ ID: burn.ID });
                        plansUpdated++;
                    }
                } else {
                    // Create a skeleton record with just planned data
                    await INSERT.into(FUEL_BURNS).entries({
                        ID: cds.utils.uuid(),
                        origin_airport_iata_code: depAirport,
                        destination_airport_iata_code: arrAirport,
                        burn_date: validFrom,
                        planned_burn_kg: totalPlanned,
                        taxi_out_kg: taxiFuel,
                        data_source: source.toUpperCase() || 'JEFFERSON',
                        status: 'PRELIMINARY',
                        aircraft_type_code: aircraftType || null
                    });
                    plansCreated++;
                }
            }

            const hasErrors = errors.some(e => e.severity === 'ERROR');
            return {
                success: !hasErrors && (plansCreated > 0 || plansUpdated > 0),
                fileName: fileName || 'unknown',
                plansProcessed, plansCreated, plansUpdated, plansSkipped, errors,
                message: `Processed ${plansProcessed} planned burn entries. Created: ${plansCreated}, Updated: ${plansUpdated}, Skipped: ${plansSkipped}.`
            };
        });

        await super.init();
    }

    /**
     * Create a FLIGHT entry in ROB ledger when a burn is confirmed
     */
    async _createROBEntryForBurn(burn, userId) {
        const { ROBLedger } = this.entities;
        const { MASTER_AIRPORTS } = cds.entities('fuelsphere');

        // Get the last ROB entry for this aircraft
        const lastEntry = await SELECT.one.from(ROBLedger)
            .where({ tail_number: burn.tail_number })
            .orderBy('record_date desc', 'record_time desc', 'sequence desc');

        const openingROB = lastEntry ? lastEntry.closing_rob_kg : 0;
        const closingROB = Math.max(0, openingROB - burn.actual_burn_kg);
        const maxCapacity = lastEntry ? lastEntry.max_capacity_kg : 0;
        const robPct = maxCapacity > 0 ? Number(((closingROB / maxCapacity) * 100).toFixed(2)) : 0;
        const nextSeq = lastEntry && lastEntry.record_date === burn.burn_date ? lastEntry.sequence + 1 : 1;

        // Destination airport
        const destAirport = burn.destination_airport_ID
            ? await SELECT.one.from(MASTER_AIRPORTS).where({ ID: burn.destination_airport_ID })
            : null;

        await INSERT.into(ROBLedger).entries({
            ID: cds.utils.uuid(),
            tail_number: burn.tail_number,
            record_date: burn.burn_date,
            record_time: burn.burn_time || '00:00:00',
            sequence: nextSeq,
            airport_ID: burn.destination_airport_ID,
            airport_code: destAirport ? destAirport.iata_code : '',
            flight_ID: burn.flight_ID,
            fuel_burn_ID: burn.ID,
            entry_type: 'FLIGHT',
            opening_rob_kg: openingROB,
            uplift_kg: 0,
            burn_kg: burn.actual_burn_kg,
            adjustment_kg: 0,
            closing_rob_kg: closingROB,
            max_capacity_kg: maxCapacity,
            rob_percentage: robPct,
            data_source: burn.data_source,
            is_estimated: false
        });
    }
};

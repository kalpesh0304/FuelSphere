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

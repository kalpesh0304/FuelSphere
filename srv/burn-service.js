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
const { resolveTail } = require('./lib/tail-resolver');
const {
    PHASE, SOURCE, BASIS,
    rateForTail, deriveCycle, allocate, splitBlockBurn
} = require('./lib/apu-burn');
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
            const rob = await this._createROBEntryForBurn(burn, req.user.id);

            // B8: a negative closing balance means the chain does not balance —
            // an event is missing or out of sequence. No ledger row was written.
            // The error carries the computed value, which is the finding itself.
            if (!rob.written) {
                return req.error(400,
                    `FB402: Closing ROB would be negative (${rob.computedClosing} kg) for ${rob.tailNumber}. ` +
                    `opening ${rob.opening} + uplift ${rob.uplift} - burn ${rob.burn} + adjustment ${rob.adjustment} ` +
                    `= ${rob.computedClosing}. The fuel ledger chain does not balance by ` +
                    `${Math.abs(rob.computedClosing)} kg; an event is missing or out of sequence. ` +
                    `No ledger row written. Use recalculateROB once the missing event is added.`);
            }

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
        // ====================================================================
        // APU USAGE - WP-19, decisions B4 and B9
        // ====================================================================

        const { ApuUsage } = this.entities;

        // Derive on write, so a cycle is never stored with stale figures.
        // Reads its OWN row, so the draft path is registered too — the WP-12
        // rule. Rejection here is APU407 and is correct: a stop before its
        // start is not a low-confidence reading, it is impossible.
        const deriveApuOnWrite = async (req) => {
            const d = req.data;
            let stored = {};
            if (req.event !== 'CREATE') {
                const id = d.ID || (req.params && req.params[0] &&
                    (typeof req.params[0] === 'object' ? req.params[0].ID : req.params[0]));
                if (id) stored = await SELECT.one.from(req.target).where({ ID: id }) || {};
            }
            const at = (f) => (d[f] !== undefined ? d[f] : stored[f]);

            const cycle = {
                tail_number: at('tail_number'),
                apu_start_utc: at('apu_start_utc'),
                apu_stop_utc: at('apu_stop_utc'),
                usage_phase: at('usage_phase'),
                flight_ID: at('flight_ID')
            };
            if (!cycle.apu_start_utc) return;

            const rate = await rateForTail(cycle.tail_number);
            const derived = deriveCycle(cycle, rate);
            if (derived.error) return req.error(400, derived.error);

            d.is_open = derived.is_open;
            d.running_minutes = derived.running_minutes;
            d.apu_burn_kg = derived.apu_burn_kg;
            d.burn_rate_kg_hr = derived.burn_rate_kg_hr;
            d.rate_source = derived.rate_source;

            const alloc = allocate(cycle);
            d.allocated_flight_ID = alloc.allocated_flight_ID;
            d.allocation_basis = alloc.allocation_basis;
        };
        // Registered on the active entity ONLY — ApuUsage is not
        // draft-enabled, so ApuUsage.drafts does not exist and passing it
        // registers a handler against undefined. cds compile returns 0 on
        // that; the service boot is what catches it.
        //
        // The WP-12 rule is about which path a handler needs when a draft
        // path EXISTS. Check that it does before reaching for it.
        this.before(['CREATE', 'UPDATE', 'PATCH'], ApuUsage, deriveApuOnWrite);

        this.on('deriveBurn', ApuUsage, async (req) => {
            const id = typeof req.params[0] === 'object' ? req.params[0].ID : req.params[0];
            const cycle = await SELECT.one.from(ApuUsage).where({ ID: id });
            if (!cycle) return req.error(404, 'APU cycle not found');

            const rate = await rateForTail(cycle.tail_number);
            const derived = deriveCycle(cycle, rate);
            if (derived.error) return req.error(400, derived.error);
            const alloc = allocate(cycle);

            await UPDATE(ApuUsage).where({ ID: id }).set({
                is_open: derived.is_open,
                running_minutes: derived.running_minutes,
                apu_burn_kg: derived.apu_burn_kg,
                burn_rate_kg_hr: derived.burn_rate_kg_hr,
                rate_source: derived.rate_source,
                allocated_flight_ID: alloc.allocated_flight_ID,
                allocation_basis: alloc.allocation_basis
            });

            return {
                cycleId: id,
                tailNumber: cycle.tail_number,
                usagePhase: cycle.usage_phase,
                apuSource: cycle.apu_source,
                isOpen: derived.is_open,
                runningMinutes: derived.running_minutes,
                burnRateKgHr: derived.burn_rate_kg_hr,
                rateSource: derived.rate_source,
                apuBurnKg: derived.apu_burn_kg,
                allocatedFlight: alloc.allocated_flight_ID,
                allocationBasis: alloc.allocation_basis,
                // APU401: there is no meter. Every figure here is derived, and
                // a consumer must be able to tell that without inference.
                derived: true,
                message: derived.note
                    || `${derived.running_minutes} min at ${derived.burn_rate_kg_hr} kg/h = ${derived.apu_burn_kg} kg `
                     + `(derived, ${cycle.apu_source}).`
            };
        });

        // WP-19: split the block burn once the APU share is known.
        //
        // actual_burn_kg IS the block burn. engine_burn_kg is what is left
        // after the APU took its share, and it is null wherever the APU
        // figure is — an unknown APU burn makes the engine burn unknown too,
        // not equal to the block.
        const applyBurnSplit = async (burnId, tx) => {
            const db = tx || cds.db;
            const burn = await db.run(SELECT.one.from('fuelsphere.FUEL_BURNS')
                .columns('ID', 'actual_burn_kg', 'tail_number', 'flight_ID').where({ ID: burnId }));
            if (!burn) return null;

            // Only cycles allocated to this burn's flight. A cycle allocated
            // to neither flight — OVERNIGHT, PARKED, MAINTENANCE — belongs to
            // the station or the tail and must not land on a leg.
            const cycles = burn.flight_ID
                ? await db.run(SELECT.from('fuelsphere.APU_USAGE')
                    .columns('apu_burn_kg', 'is_open')
                    .where({ allocated_flight_ID: burn.flight_ID }))
                : [];

            let apu = null;
            if (cycles.length) {
                const unknown = cycles.filter(c => c.apu_burn_kg === null || c.apu_burn_kg === undefined);
                // One open cycle makes the total unknown, not short. Summing
                // the rest would understate the APU share and overstate the
                // engine burn by exactly the missing amount.
                apu = unknown.length ? null
                    : Number(cycles.reduce((a, c) => a + Number(c.apu_burn_kg), 0).toFixed(2));
            }

            const split = splitBlockBurn(burn.actual_burn_kg, apu);
            await db.run(UPDATE('fuelsphere.FUEL_BURNS').set({
                apu_burn_kg: split.apu_burn_kg,
                engine_burn_kg: split.engine_burn_kg
            }).where({ ID: burnId }));
            return split;
        };
        this._applyBurnSplit = applyBurnSplit;

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

            let plannedBurnKg = 0;
            let varianceKg = 0;
            let variancePct = 0;
            let varianceStatus = 'NORMAL';

            // Try to match a flight
            const { FLIGHT_SCHEDULE } = cds.entities('fuelsphere');
            const flight = flightNumber
                ? await SELECT.one.from(FLIGHT_SCHEDULE).where({ flight_number: flightNumber, flight_date: burnDate })
                : null;

            // ----------------------------------------------------------------
            // WP-19 / defect D10. plannedBurnKg was declared 0 and never
            // assigned, so the `> 0` guard below could not fire and every
            // ACARS ingest stored NORMAL with a zero variance. The ladder
            // itself is correct — its input was missing.
            //
            // WP-18 supplied it. trip_fuel_kg is the trip component of the
            // regulated stack: takeoff to touchdown, which is what a burn
            // figure is compared against. Block fuel would include taxi and
            // reserves that were never burned.
            //
            // The ACTIVE plan only. A superseded version is what was planned
            // before the re-plan, and comparing actuals against a withdrawn
            // plan produces a variance against a decision nobody took.
            // ----------------------------------------------------------------
            if (flight) {
                const { FLIGHT_DISPATCH } = cds.entities('fuelsphere');
                const plan = await SELECT.one.from(FLIGHT_DISPATCH)
                    .columns('trip_fuel_kg', 'plan_version', 'plan_group_id')
                    .where({ flight_schedule_ID: flight.ID, plan_status: 'ACTIVE' });
                if (plan && Number(plan.trip_fuel_kg) > 0) {
                    plannedBurnKg = Number(plan.trip_fuel_kg);
                }
            }

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
                // WP-07B. Never blockable — the burn already happened (A1).
                tail_registration: (await resolveTail(tailNumber) || {}).registration || null,
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
                    // WP-07B. Never blockable — the burn already happened (A1).
                    tail_registration: (await resolveTail(tailNumber) || {}).registration || null,
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
                // WP-19 / D10. Surfaced so a caller can see WHICH planned
                // figure the variance was measured against. A status with no
                // basis beside it cannot be checked — the same reason
                // recon_status sits next to its tolerance.
                plannedBurnKg: plannedBurnKg || null,
                varianceKg: varianceKg,
                variancePct: variancePct,
                varianceStatus: varianceStatus,
                status: 'PRELIMINARY',
                message: plannedBurnKg > 0
                    ? `ACARS burn ${actualBurnKg} kg against planned ${plannedBurnKg} kg for ${tailNumber}. `
                    + `Variance ${variancePct}%. Status: ${varianceStatus}.`
                    : `ACARS burn data ingested for ${tailNumber}. No active plan, so no variance. Status: ${varianceStatus}.`
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
                // WP-07B. Never blockable — the burn already happened (A1).
                tail_registration: (await resolveTail(tailNumber) || {}).registration || null,
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
                // WP-07B. Never blockable — the burn already happened (A1).
                tail_registration: (await resolveTail(tailNumber) || {}).registration || null,
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

        // D15 — rebuild the ROB chain in sequence after out-of-order ingest.
        //
        // Each entry keeps its own uplift, burn and adjustment; only the opening
        // and closing balances are re-derived, so the recorded physical events
        // are never rewritten. Entries are chained in
        // (record_date, record_time, sequence) order, seeded from the closing
        // balance of the last entry before fromDate.
        //
        // WP-07B section 10.6. WP-03 resolved aircraftId against tail_number
        // and then aircraft_type_code, and left the signature alone because
        // there was nothing better to point at. There is now: `registration`
        // addresses the register directly, and the ledger chain is per tail.
        //
        // aircraftId is still accepted, so no existing caller breaks.
        this.on('recalculateROB', async (req) => {
            const { registration, aircraftId, fromDate } = req.data;
            const key = registration || aircraftId;
            if (!key) return req.error(400, 'FB401: registration is required.');

            // Resolve through the register first. A tail that is IN the
            // register addresses its chain by association; one that is not
            // still resolves by string, because the ledger records the tail as
            // received and a chain must remain rebuildable for an aircraft
            // nobody has registered yet.
            const known = await resolveTail(key);
            let entries = known
                ? await SELECT.from(ROBLedger)
                    .where({ tail_registration: known.registration })
                    .orderBy('record_date asc', 'record_time asc', 'sequence asc')
                : [];
            let addressedBy = known && entries.length ? 'association' : null;

            if (entries.length === 0) {
                entries = await SELECT.from(ROBLedger)
                    .where({ tail_number: String(key).trim().toUpperCase() })
                    .orderBy('record_date asc', 'record_time asc', 'sequence asc');
                if (entries.length) addressedBy = 'tail_number';
            }
            if (entries.length === 0) {
                entries = await SELECT.from(ROBLedger)
                    .where({ aircraft_type_code: key })
                    .orderBy('record_date asc', 'record_time asc', 'sequence asc');
                if (entries.length) addressedBy = 'aircraft_type_code';
            }
            if (entries.length === 0) {
                return req.error(404, `FB401: No ROB ledger entries found for '${key}'.`);
            }
            req.addressedBy = addressedBy;

            const tailNumber = entries[0].tail_number;
            const inScope = fromDate ? entries.filter(e => e.record_date >= fromDate) : entries;
            if (inScope.length === 0) {
                return req.error(404, `FB401: No ROB ledger entries for ${tailNumber} on or after ${fromDate}.`);
            }

            // Seed from the last entry before the window; the first entry in the
            // ledger keeps its own opening balance as the origin of the chain.
            const priorEntries = entries.filter(e => !inScope.some(s => s.ID === e.ID));
            const prior = priorEntries.length ? priorEntries[priorEntries.length - 1] : null;
            let runningOpening = prior ? Number(prior.closing_rob_kg) : Number(inScope[0].opening_rob_kg);

            let discrepanciesFound = 0;
            let entriesRecalculated = 0;

            for (const e of inScope) {
                const uplift     = Number(e.uplift_kg) || 0;
                const burn       = Number(e.burn_kg) || 0;
                const adjustment = Number(e.adjustment_kg) || 0;

                // An INITIAL entry seeds the chain. Its closing balance is
                // recorded fuel state, not a derived value — deriving it from
                // its (zero) components would wipe the starting balance. Keep
                // it as recorded and chain onward from it.
                const isSeed = e.entry_type === 'INITIAL';
                if (isSeed) runningOpening = Number(e.opening_rob_kg) || 0;

                const closing = isSeed
                    ? Number(e.closing_rob_kg)
                    : Number((runningOpening + uplift - burn + adjustment).toFixed(2));

                // B8 applies to the rebuild too: a negative balance is not
                // written. Stop at the break, leaving later entries untouched.
                if (closing < 0) {
                    return req.error(400,
                        `FB402: Rebuild stopped at ${e.record_date} ${e.record_time} seq ${e.sequence} for ${tailNumber}. ` +
                        `opening ${runningOpening} + uplift ${uplift} - burn ${burn} + adjustment ${adjustment} = ${closing}. ` +
                        `The chain does not balance by ${Math.abs(closing)} kg; an event is missing or out of sequence. ` +
                        `${entriesRecalculated} entries were rebuilt before the break.`);
                }

                const openingChanged = Number(e.opening_rob_kg) !== runningOpening;
                const closingChanged = Number(e.closing_rob_kg) !== closing;

                if (openingChanged || closingChanged) {
                    discrepanciesFound++;
                    const maxCapacity = Number(e.max_capacity_kg) || 0;
                    await UPDATE(ROBLedger).where({ ID: e.ID }).set({
                        opening_rob_kg: runningOpening,
                        closing_rob_kg: closing,
                        rob_percentage: maxCapacity > 0
                            ? Number(((closing / maxCapacity) * 100).toFixed(2))
                            : 0,
                        modified_at: new Date().toISOString(),
                        modified_by: req.user.id
                    });
                }

                entriesRecalculated++;
                runningOpening = closing;
            }

            return {
                success: true,
                tailNumber,
                fromDate: fromDate || inScope[0].record_date,
                entriesRecalculated,
                finalROBKg: runningOpening,
                discrepanciesFound,
                // WP-07B: how the tail was addressed, so a caller can tell a
                // register hit from a string fallback.
                addressedBy: req.addressedBy,
                message: `Rebuilt ${entriesRecalculated} ROB entries for ${tailNumber} ` +
                         `(addressed by ${req.addressedBy}). ` +
                         `${discrepanciesFound} corrected. Final ROB ${runningOpening} kg.`
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
                    // WP-07B. Never blockable — the burn already happened (A1).
                    tail_registration: (await resolveTail(tailNumber) || {}).registration || null,
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
                    // WP-07B. Never blockable — the burn already happened (A1).
                    tail_registration: (await resolveTail(tailNumber) || {}).registration || null,
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
     *
     * Formula (db/schema.cds:1985, CLAUDE.md section 10):
     *   closing_rob_kg = opening_rob_kg + uplift_kg - burn_kg + adjustment_kg
     *
     * Decision B8 — a negative closing balance is neither clamped nor written.
     * The clamp this replaced destroyed the signal that an event is missing or
     * mis-sequenced. On a negative result no row is written, and the caller
     * raises FB402 carrying the computed value. @assert.range on
     * closing_rob_kg is deliberately left intact; the error is the finding.
     *
     * Returns { written: true, ... } when the row was inserted, or
     * { written: false, code: 'FB402', ... } carrying the chain-break payload.
     */
    async _createROBEntryForBurn(burn, userId) {
        const { ROBLedger } = this.entities;
        const { MASTER_AIRPORTS } = cds.entities('fuelsphere');

        // Get the last ROB entry for this aircraft
        const lastEntry = await SELECT.one.from(ROBLedger)
            .where({ tail_number: burn.tail_number })
            .orderBy('record_date desc', 'record_time desc', 'sequence desc');

        // A FLIGHT entry records consumption only. Uplift and adjustment arrive
        // as their own ledger entries and reach this one through the opening
        // balance, so both terms are zero here — but they are carried in the
        // expression explicitly so it matches the documented formula.
        const openingROB   = lastEntry ? Number(lastEntry.closing_rob_kg) : 0;
        const upliftKg     = 0;
        const burnKg       = Number(burn.actual_burn_kg) || 0;
        const adjustmentKg = 0;
        const closingROB   = Number((openingROB + upliftKg - burnKg + adjustmentKg).toFixed(2));

        const maxCapacity = lastEntry ? lastEntry.max_capacity_kg : 0;
        const robPct = maxCapacity > 0 ? Number(((closingROB / maxCapacity) * 100).toFixed(2)) : 0;
        const nextSeq = lastEntry && lastEntry.record_date === burn.burn_date ? lastEntry.sequence + 1 : 1;

        // B8: withhold the row and report the break rather than clamping it away.
        if (closingROB < 0) {
            return {
                written         : false,
                code            : 'FB402',
                tailNumber      : burn.tail_number,
                sequence        : nextSeq,
                opening         : openingROB,
                uplift          : upliftKg,
                burn            : burnKg,
                adjustment      : adjustmentKg,
                computedClosing : closingROB,
                fuelBurnID      : burn.ID,
                // Delivery behind the opening balance, where the chain carries one.
                fuelDeliveryID  : lastEntry ? (lastEntry.fuel_delivery_ID || null) : null,
                flightID        : burn.flight_ID || null
            };
        }

        // Destination airport
        const destAirport = burn.destination_airport_ID
            ? await SELECT.one.from(MASTER_AIRPORTS).where({ ID: burn.destination_airport_ID })
            : null;

        await INSERT.into(ROBLedger).entries({
            ID: cds.utils.uuid(),
            tail_number: burn.tail_number,
            // WP-07B. Never blockable — the burn already happened (A1).
            tail_registration: (await resolveTail(burn.tail_number) || {}).registration || null,
            record_date: burn.burn_date,
            record_time: burn.burn_time || '00:00:00',
            sequence: nextSeq,
            airport_ID: burn.destination_airport_ID,
            airport_code: destAirport ? destAirport.iata_code : '',
            flight_ID: burn.flight_ID,
            fuel_burn_ID: burn.ID,
            entry_type: 'FLIGHT',
            opening_rob_kg: openingROB,
            uplift_kg: upliftKg,
            burn_kg: burnKg,
            adjustment_kg: adjustmentKg,
            closing_rob_kg: closingROB,
            max_capacity_kg: maxCapacity,
            rob_percentage: robPct,
            data_source: burn.data_source,
            is_estimated: false
        });

        return { written: true, sequence: nextSeq, closing: closingROB };
    }
};

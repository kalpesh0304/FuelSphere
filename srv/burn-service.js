/**
 * FuelSphere - Burn Service Handler (FDD-08)
 * Populates virtual elements for FuelBurns, ROBLedger, and FuelOrders (ROBSummaryView)
 *
 * SAP Criticality Scale:
 *   0 = Neutral (grey)
 *   1 = Negative/Critical (red)
 *   2 = Warning (orange/yellow)
 *   3 = Positive/Success (green)
 */

const cds = require('@sap/cds');

module.exports = class BurnService extends cds.ApplicationService {
    async init() {
        const { FuelBurns, ROBLedger, FuelOrders } = this.entities;

        // ====================================================================
        // FuelBurns - Virtual Fields
        // ====================================================================
        this.after(['READ'], FuelBurns, (data) => {
            const items = Array.isArray(data) ? data : [data];
            items.forEach(item => {
                if (!item) return;

                // statusCriticality - maps FuelBurnStatus to UI criticality
                switch (item.status) {
                    case 'PENDING':
                        item.statusCriticality = 2; // Warning
                        break;
                    case 'PROCESSING':
                        item.statusCriticality = 2; // Warning
                        break;
                    case 'VALIDATED':
                        item.statusCriticality = 3; // Positive
                        break;
                    case 'EXCEPTION':
                        item.statusCriticality = 1; // Negative
                        break;
                    case 'POSTED':
                        item.statusCriticality = 3; // Positive
                        break;
                    case 'ADJUSTED':
                        item.statusCriticality = 2; // Warning
                        break;
                    case 'REJECTED':
                        item.statusCriticality = 1; // Negative
                        break;
                    default:
                        item.statusCriticality = 0;
                }

                // varianceCriticality - maps VarianceStatus to criticality
                switch (item.variance_status) {
                    case 'NORMAL':
                        item.varianceCriticality = 3; // Positive
                        break;
                    case 'WARNING':
                        item.varianceCriticality = 2; // Warning
                        break;
                    case 'EXCEPTION':
                        item.varianceCriticality = 1; // Negative
                        break;
                    case 'CRITICAL':
                        item.varianceCriticality = 1; // Negative
                        break;
                    default:
                        item.varianceCriticality = 0;
                }

                // reconciliationCriticality - maps ReconciliationApprovalStatus
                switch (item.reconciliation_status) {
                    case 'AUTO_APPROVED':
                        item.reconciliationCriticality = 3; // Positive
                        break;
                    case 'SUPERVISOR_APPROVAL':
                        item.reconciliationCriticality = 2; // Warning
                        break;
                    case 'FINANCE_APPROVAL':
                        item.reconciliationCriticality = 1; // Negative
                        break;
                    default:
                        item.reconciliationCriticality = 0;
                }
            });
        });

        // ====================================================================
        // ROBLedger - Virtual Fields
        // ====================================================================
        this.after(['READ'], ROBLedger, (data) => {
            const items = Array.isArray(data) ? data : [data];
            items.forEach(item => {
                if (!item) return;

                // statusCriticality - maps ROBLedgerStatus
                switch (item.status) {
                    case 'VALIDATED':
                        item.statusCriticality = 3; // Positive
                        break;
                    case 'INFO':
                        item.statusCriticality = 0; // Neutral
                        break;
                    case 'REVIEW':
                        item.statusCriticality = 2; // Warning
                        break;
                    case 'ERROR':
                        item.statusCriticality = 1; // Negative
                        break;
                    case 'PROCESSING':
                        item.statusCriticality = 2; // Warning
                        break;
                    case 'DRAFT':
                        item.statusCriticality = 0; // Neutral
                        break;
                    default:
                        item.statusCriticality = 0;
                }

                // continuityColor - maps ContinuityCheckStatus
                switch (item.continuity_check) {
                    case 'PASS':
                        item.continuityColor = 3; // Positive (green)
                        break;
                    case 'WARNING':
                        item.continuityColor = 2; // Warning (orange)
                        break;
                    case 'FAIL':
                        item.continuityColor = 1; // Negative (red)
                        break;
                    default:
                        item.continuityColor = 0;
                }

                // debit_kg / credit_kg - accounting view based on entry_type
                // Debits increase fuel on board (uplifts, adjustments +)
                // Credits decrease fuel on board (burns, adjustments -)
                item.debit_kg = 0;
                item.credit_kg = 0;

                switch (item.entry_type) {
                    case 'UPLIFT':
                        item.debit_kg = item.uplift_kg || 0;
                        break;
                    case 'FLIGHT':
                    case 'DEPARTURE':
                    case 'ARRIVAL':
                        item.credit_kg = item.burn_kg || 0;
                        break;
                    case 'ADJUSTMENT':
                        if (item.adjustment_kg > 0) {
                            item.debit_kg = item.adjustment_kg;
                        } else if (item.adjustment_kg < 0) {
                            item.credit_kg = Math.abs(item.adjustment_kg);
                        }
                        break;
                    case 'OPENING_BALANCE':
                    case 'INITIAL':
                        item.debit_kg = item.opening_rob_kg || 0;
                        break;
                    case 'CLOSING_BALANCE':
                        // Closing balance is informational, no debit/credit
                        break;
                    default:
                        break;
                }

                // flightRoute - will be populated by expanded flight data if available
                // When flight is expanded, compute from origin/destination
                // Otherwise falls back to reference_number
                item.flightRoute = null;
            });
        });

        // Populate flightRoute from expanded flight associations
        this.after(['READ'], ROBLedger, async (data, req) => {
            const items = Array.isArray(data) ? data : [data];
            // Only compute flightRoute if flight data is expanded or we have flight IDs
            const itemsWithFlight = items.filter(item => item && item.flight_ID);
            if (itemsWithFlight.length === 0) return;

            try {
                const flightIds = [...new Set(itemsWithFlight.map(i => i.flight_ID))];
                const { Flights } = this.entities;
                const flights = await SELECT.from(Flights)
                    .columns('ID', 'origin_ID', 'destination_ID')
                    .where({ ID: { in: flightIds } });

                if (flights.length === 0) return;

                // Get airport codes for origin/destination
                const airportIds = [...new Set(flights.flatMap(f => [f.origin_ID, f.destination_ID].filter(Boolean)))];
                if (airportIds.length === 0) return;

                const { Airports } = this.entities;
                const airports = await SELECT.from(Airports)
                    .columns('ID', 'iata_code')
                    .where({ ID: { in: airportIds } });

                const airportMap = new Map(airports.map(a => [a.ID, a.iata_code]));
                const flightRouteMap = new Map();
                for (const f of flights) {
                    const origin = airportMap.get(f.origin_ID) || '???';
                    const dest = airportMap.get(f.destination_ID) || '???';
                    flightRouteMap.set(f.ID, `${origin} → ${dest}`);
                }

                for (const item of itemsWithFlight) {
                    item.flightRoute = flightRouteMap.get(item.flight_ID) || null;
                }
            } catch (e) {
                // Silently skip route computation on error; virtual field remains null
            }
        });

        // ====================================================================
        // FuelOrders (ROBSummaryView) - Virtual Fields
        // ====================================================================
        this.after(['READ'], FuelOrders, async (data, req) => {
            const items = Array.isArray(data) ? data : [data];
            const user = req.user?.id;

            // Collect order IDs that need burn data lookup
            const orderIds = items.filter(i => i && i.ID).map(i => i.ID);

            // Batch-load related FUEL_BURNS for these orders' flights
            let burnsByFlight = new Map();
            if (orderIds.length > 0) {
                try {
                    const flightIds = [...new Set(items.filter(i => i.flight_ID).map(i => i.flight_ID))];
                    if (flightIds.length > 0) {
                        const burns = await SELECT.from('fuelsphere.FUEL_BURNS')
                            .columns(
                                'flight_ID', 'rob_departure_kg', 'rob_arrival_kg',
                                'uplift_kg', 'variance_pct', 'variance_status',
                                'data_source', 'submitted_by', 'submitted_at',
                                'status'
                            )
                            .where({ flight_ID: { in: flightIds } });

                        for (const burn of burns) {
                            burnsByFlight.set(burn.flight_ID, burn);
                        }
                    }
                } catch (e) {
                    // Continue with defaults if burn lookup fails
                }
            }

            // Check for exceptions in batch
            let exceptionsSet = new Set();
            if (orderIds.length > 0) {
                try {
                    const flightIds = [...new Set(items.filter(i => i.flight_ID).map(i => i.flight_ID))];
                    if (flightIds.length > 0) {
                        const exceptions = await SELECT.from('fuelsphere.FUEL_BURN_EXCEPTIONS')
                            .columns('fuel_burn.flight_ID as flight_ID')
                            .where({
                                'fuel_burn.flight_ID': { in: flightIds },
                                status: { '!=': 'CLOSED' }
                            });

                        for (const exc of exceptions) {
                            if (exc.flight_ID) exceptionsSet.add(exc.flight_ID);
                        }
                    }
                } catch (e) {
                    // Continue without exception data
                }
            }

            for (const item of items) {
                if (!item) continue;

                const burn = burnsByFlight.get(item.flight_ID);

                // robDeparture / robArrival / upliftQuantity from burn data
                item.robDeparture = burn?.rob_departure_kg || null;
                item.robArrival = burn?.rob_arrival_kg || null;
                item.upliftQuantity = burn?.uplift_kg || item.ordered_quantity || null;

                // varianceStatus / variancePercent
                if (burn?.variance_status) {
                    const statusMap = {
                        'NORMAL': 'within-tolerance',
                        'WARNING': 'warning',
                        'EXCEPTION': 'exceeded',
                        'CRITICAL': 'exceeded'
                    };
                    item.varianceStatus = statusMap[burn.variance_status] || null;
                    item.variancePercent = burn.variance_pct || null;
                } else {
                    item.varianceStatus = null;
                    item.variancePercent = null;
                }

                // capturedBy / capturedAt - from burn submission or order approval
                item.capturedBy = burn?.submitted_by || item.approved_by || null;
                item.capturedAt = burn?.submitted_at || item.approved_at || null;

                // previousArrivalCapturedAt - timestamp of the previous arrival ROB capture
                // Computed from previous burn record for the same aircraft
                item.previousArrivalCapturedAt = null;

                // dataSource - from related fuel burn record (ACARS, EFB, MANUAL)
                item.dataSource = burn?.data_source || null;

                // hasException - true if open exceptions exist for this flight's burn
                item.hasException = exceptionsSet.has(item.flight_ID);

                // isMyFlight - true if current user is the pilot or submitter
                item.isMyFlight = false;
                if (user) {
                    item.isMyFlight = (
                        item.pilot_id === user ||
                        item.pilot_name === user ||
                        burn?.submitted_by === user
                    );
                }

                // statusCriticality - maps OrderStatus for the burn context
                switch (item.status) {
                    case 'Draft':
                        item.statusCriticality = 0;
                        break;
                    case 'Submitted':
                    case 'InProgress':
                    case 'Dispatched':
                        item.statusCriticality = 2;
                        break;
                    case 'Confirmed':
                    case 'Approved':
                    case 'Acknowledged':
                    case 'Delivered':
                    case 'Completed':
                    case 'PO_Created':
                        item.statusCriticality = 3;
                        break;
                    case 'Cancelled':
                    case 'Rejected':
                    case 'Failed':
                        item.statusCriticality = 1;
                        break;
                    default:
                        item.statusCriticality = 0;
                }
            }
        });

        // ====================================================================
        // FuelBurnExceptions - Virtual Fields
        // ====================================================================
        const { FuelBurnExceptions } = this.entities;

        this.after(['READ'], FuelBurnExceptions, async (data) => {
            const items = Array.isArray(data) ? data : [data];
            const now = Date.now();

            // Collect burn IDs for route lookup
            const burnIds = items
                .filter(item => item && item.fuel_burn_ID)
                .map(item => item.fuel_burn_ID);

            let burnMap = {};
            if (burnIds.length > 0) {
                const { FUEL_BURNS } = cds.entities('fuelsphere');
                const burns = await SELECT.from(FUEL_BURNS)
                    .columns('ID', 'flight_number', 'origin_airport_ID', 'destination_airport_ID')
                    .where({ ID: { in: burnIds } });
                for (const b of burns) {
                    burnMap[b.ID] = b;
                }
            }

            // SLA hours by severity
            const slaHoursBySeverity = {
                HIGH: 24,
                MEDIUM: 48,
                LOW: 72
            };

            items.forEach(item => {
                if (!item) return;

                // priorityCriticality - maps severity to SAP criticality
                switch (item.severity) {
                    case 'HIGH':
                        item.priorityCriticality = 1; // Negative/red
                        break;
                    case 'MEDIUM':
                        item.priorityCriticality = 2; // Warning/amber
                        break;
                    case 'LOW':
                        item.priorityCriticality = 3; // Positive/green
                        break;
                    default:
                        item.priorityCriticality = 0;
                }

                // statusCriticality
                const status = (item.status || '').toUpperCase();
                switch (status) {
                    case 'NEW':
                    case 'OPEN':
                        item.statusCriticality = 2; // Warning
                        break;
                    case 'INVESTIGATING':
                    case 'PENDING_INFO':
                    case 'IN_REVIEW':
                        item.statusCriticality = 2; // Warning
                        break;
                    case 'RESOLVED':
                    case 'CLOSED':
                        item.statusCriticality = 3; // Positive
                        break;
                    case 'ESCALATED':
                        item.statusCriticality = 1; // Negative
                        break;
                    default:
                        item.statusCriticality = 0;
                }

                // Route and flight from burn record
                const burn = burnMap[item.fuel_burn_ID];
                if (burn) {
                    item.flightNumber = burn.flight_number || null;
                    item.originAirport = burn.origin_airport_ID || null;
                    item.destinationAirport = burn.destination_airport_ID || null;
                }

                // ageHours - computed from created_at
                item.ageHours = null;
                item.slaStatus = 'Normal';
                item.slaRemaining = null;
                item.overdue = false;

                if (item.created_at) {
                    const createdMs = new Date(item.created_at).getTime();
                    const ageMs = now - createdMs;
                    item.ageHours = Math.round((ageMs / (1000 * 60 * 60)) * 100) / 100;

                    // SLA computation
                    const slaHours = slaHoursBySeverity[item.severity] || 48;
                    const remainingHours = slaHours - item.ageHours;
                    if (remainingHours <= 0) {
                        item.slaStatus = 'Overdue';
                        item.overdue = true;
                        item.slaRemaining = `${Math.abs(Math.round(remainingHours))}h overdue`;
                    } else if (remainingHours <= slaHours * 0.25) {
                        item.slaStatus = 'Approaching';
                        item.slaRemaining = `${Math.round(remainingHours)}h`;
                    } else {
                        item.slaStatus = 'Normal';
                        item.slaRemaining = `${Math.round(remainingHours)}h`;
                    }
                }
            });
        });

        await super.init();
    }
};

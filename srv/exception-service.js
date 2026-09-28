/**
 * FuelSphere - Exception Reports service.
 *
 * Two jobs, and nothing else:
 *   1. fill the derived columns on every row the four reports return
 *   2. answer summary(), which is the four charts on the overview page
 *
 * The rules live in srv/lib/exception-reports.js so they can be read as plain
 * JavaScript; this file is the wiring.
 */

const cds = require('@sap/cds');
const { SELECT } = cds.ql;
const R = require('./lib/exception-reports');

module.exports = class ExceptionService extends cds.ApplicationService {
    async init() {
        const { UninvoicedTickets, DeliveriesAwaitingReadings,
                DeliveryVariances, FlightCompleteness } = this.entities;

        const asArray = (data) => (Array.isArray(data) ? data : [data]).filter(Boolean);

        /**
         * Put back the columns the derivation needs and the client did not ask
         * for. A table showing Sector selects "sector" and nothing else, so the
         * station and destination it is built from arrive undefined and the
         * sector comes back blank. Re-reading by ID is the same fix the Fuel
         * Burns and invoice views use, for the same reason.
         */
        const withBaseColumns = async (entity, rows, columns) => {
            const gaps = rows.filter(r => r && r.ID && columns.some(c => r[c] === undefined));
            if (!gaps.length) return rows;
            const stored = await SELECT.from(entity)
                .columns('ID', ...columns)
                .where({ ID: { in: gaps.map(r => r.ID) } });
            const byId = new Map(stored.map(s => [s.ID, s]));
            for (const r of gaps) {
                const s = byId.get(r.ID);
                if (s) for (const c of columns) if (r[c] === undefined) r[c] = s[c];
            }
            return rows;
        };

        // ------------------------------------------------------------------
        // 1. The derived columns, filled on every read.
        // ------------------------------------------------------------------
        this.after('READ', UninvoicedTickets, async (data) => {
            const rows = asArray(data);
            await withBaseColumns(UninvoicedTickets, rows, ['station', 'destination', 'delivered_at']);
            R.fillUninvoiced(rows, R.today());
        });
        this.after('READ', DeliveriesAwaitingReadings, async (data) => {
            const rows = asArray(data);
            await withBaseColumns(DeliveriesAwaitingReadings, rows,
                ['station', 'destination', 'delivery_date', 'fob_before_kg', 'fob_after_kg']);
            R.fillAwaitingReadings(rows, R.today());
        });
        this.after('READ', DeliveryVariances, async (data) => {
            const rows = asArray(data);
            await withBaseColumns(DeliveryVariances, rows,
                ['station', 'destination', 'expected_kg', 'actual_kg']);
            R.fillVariances(rows);
        });
        this.after('READ', FlightCompleteness, async (data) => {
            const rows = asArray(data);
            await withBaseColumns(FlightCompleteness, rows,
                ['station', 'destination', 'fob_out_kg', 'fob_in_kg',
                 'has_dispatch', 'has_uplift', 'has_apu']);
            R.fillCompleteness(rows);
        });

        // ------------------------------------------------------------------
        // 2. summary() - the four charts.
        //
        // The page asks once and draws four charts, so the figures are always
        // from the same read of the same data. Filtering happens here rather
        // than in four $apply queries because the rules that decide a row
        // (the variance band, completeness) are in JavaScript, not in SQL.
        // ------------------------------------------------------------------
        this.on('summary', async (req) => {
            const { flightNumber, station, supplier } = req.data;

            // No dates from the page means the month we are in, which is what
            // the overview opens on.
            const period = (req.data.dateFrom && req.data.dateTo)
                ? { from: String(req.data.dateFrom).slice(0, 10), to: String(req.data.dateTo).slice(0, 10) }
                : R.monthRange(R.today());

            // One where-clause, built once, applied to all four reports - that
            // is what makes the four charts answer the same question.
            const where = { flight_date: { between: period.from, and: period.to } };
            if (flightNumber) where.flight_number = flightNumber;
            if (station) where.station = station;
            if (supplier) where.supplier_name = supplier;

            const read = async (entity) => {
                const rows = await SELECT.from(entity).where(where);
                return rows;
            };

            const asOf = R.today();
            const [tickets, readings, variances, legs] = await Promise.all([
                read(UninvoicedTickets), read(DeliveriesAwaitingReadings),
                read(DeliveryVariances), read(FlightCompleteness)
            ]);
            R.fillUninvoiced(tickets, asOf);
            R.fillAwaitingReadings(readings, asOf);
            R.fillVariances(variances);
            R.fillCompleteness(legs);

            // --- chart 1: the accrual, by supplier -------------------------
            const bySupplier = new Map();
            let exposure = 0;
            for (const t of tickets) {
                const name = t.supplier_name || 'No order (unbillable)';
                const value = Number(t.value_amount || 0);
                exposure += value;
                const s = bySupplier.get(name) || { label: name, value: 0, count: 0 };
                s.value += value; s.count += 1;
                bySupplier.set(name, s);
            }

            // --- chart 2: how long readings have been missing --------------
            const buckets = [
                { label: '0-3 days', test: (d) => d <= 3 },
                { label: '4-7 days', test: (d) => d > 3 && d <= 7 },
                { label: '8-14 days', test: (d) => d > 7 && d <= 14 },
                { label: 'Over 14 days', test: (d) => d > 14 }
            ].map(b => ({ label: b.label, value: 0, count: 0, test: b.test }));
            for (const d of readings) {
                const age = d.days_open === null || d.days_open === undefined ? 0 : d.days_open;
                const b = buckets.find(x => x.test(age));
                if (b) { b.count += 1; b.value += 1; }
            }

            // --- chart 3: variances outside the band, by station -----------
            const outside = variances.filter(v => v.verdict === 'Outside tolerance');
            const byStation = new Map();
            for (const v of outside) {
                const name = v.station || 'Unknown';
                const s = byStation.get(name) || { label: name, value: 0, count: 0 };
                s.count += 1; s.value += 1;
                byStation.set(name, s);
            }

            // --- chart 4: complete against incomplete ----------------------
            const complete = legs.filter(l => l.completeness_status === 'Complete').length;
            const incomplete = legs.length - complete;
            const coverage = legs.length ? Math.round((complete / legs.length) * 100) : 0;

            const money = (v) => Number(v.toFixed(2));
            return {
                asOf, periodFrom: period.from, periodTo: period.to,
                cards: [
                    {
                        cardKey: 'uninvoiced', title: 'Un-invoiced tickets',
                        total: tickets.length,
                        headline: `${tickets.length} tickets, ${money(exposure).toLocaleString('en-US')} exposure`,
                        slices: [...bySupplier.values()]
                            .sort((a, b) => b.value - a.value)
                            .map(s => ({ label: s.label, value: money(s.value), count: s.count }))
                    },
                    {
                        cardKey: 'readings', title: 'Deliveries without gauge readings',
                        total: readings.length,
                        headline: `${readings.length} deliveries awaiting readings`,
                        slices: buckets.map(b => ({ label: b.label, value: b.count, count: b.count }))
                    },
                    {
                        cardKey: 'variances', title: 'Delivery variances outside tolerance',
                        total: outside.length,
                        headline: `${outside.length} of ${variances.length} outside ${R.VARIANCE_BAND_PCT}%`,
                        slices: [...byStation.values()]
                            .sort((a, b) => b.count - a.count)
                            .map(s => ({ label: s.label, value: s.count, count: s.count }))
                    },
                    {
                        cardKey: 'completeness', title: 'Flight data completeness',
                        total: legs.length,
                        headline: `${coverage}% of ${legs.length} legs complete`,
                        slices: [
                            { label: 'Complete', value: complete, count: complete },
                            { label: 'Incomplete', value: incomplete, count: incomplete }
                        ]
                    }
                ]
            };
        });

        await super.init();
    }
};

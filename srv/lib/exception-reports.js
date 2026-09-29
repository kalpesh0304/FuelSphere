/**
 * FuelSphere - the arithmetic behind the four exception reports.
 *
 * The views in db/exception-reports.cds do the joining and the filtering. This
 * file does the two things SQL does badly across both SQLite and HANA: date
 * arithmetic, and small rules that read better as sentences than as CASE
 * expressions. Everything here is plain JavaScript on plain objects, so it can
 * be read top to bottom without knowing CAP.
 *
 * ONE PLACE FOR EACH RULE:
 *   VARIANCE_BAND_PCT   the +/-0.50% the variance report judges against
 *   daysOpen()          how long something has been waiting
 *   sectorOf()          "AEP - MDZ", the way every screen writes a sector
 */

// The flat band the delivery variance report uses, by decision. THE RULE ITSELF
// LIVES IN THE VIEW (db/exception-reports.cds) so that it can be filtered on -
// $filter runs in the database, and a verdict computed here could not be. This
// constant is the same number, for the sentence the summary puts on the chart.
const VARIANCE_BAND_PCT = 0.5;

/** Whole days between two dates, never negative. */
function daysBetween(fromDate, toDate) {
    if (!fromDate || !toDate) return null;
    const a = new Date(String(fromDate).slice(0, 10) + 'T00:00:00Z');
    const b = new Date(String(toDate).slice(0, 10) + 'T00:00:00Z');
    if (isNaN(a) || isNaN(b)) return null;
    const days = Math.floor((b - a) / 86400000);
    return days < 0 ? 0 : days;
}

/** How long this row has been open, counted to the as-of date. */
function daysOpen(fromDate, asOf) {
    return daysBetween(fromDate, asOf);
}

/** "AEP - MDZ". Blank where either end is unknown - half a sector is not one. */
function sectorOf(from, to) {
    return from && to ? `${from} - ${to}` : null;
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const round2 = (v) => (v === null ? null : Number(v.toFixed(2)));

/** Today, as a plain ISO date. The reports are "as at" this. */
function today() {
    return new Date().toISOString().slice(0, 10);
}

/** First and last day of the month a date falls in. */
function monthRange(isoDate) {
    const d = new Date(String(isoDate).slice(0, 10) + 'T00:00:00Z');
    const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

// ---------------------------------------------------------------------------
// The per-row derivations, one function per report. Each takes the rows the
// database returned and fills the columns the view declared virtual.
// ---------------------------------------------------------------------------

function fillUninvoiced(rows, asOf) {
    for (const r of rows) {
        r.sector = sectorOf(r.station, r.destination);
        // Counted from when the fuel went on, which is when the exposure began.
        r.days_open = daysOpen(r.delivered_at, asOf);
    }
}

function fillAwaitingReadings(rows, asOf) {
    for (const r of rows) {
        r.sector = sectorOf(r.station, r.destination);
        r.days_open = daysOpen(r.delivery_date, asOf);

        const before = r.fob_before_kg === null || r.fob_before_kg === undefined;
        const after = r.fob_after_kg === null || r.fob_after_kg === undefined;
        r.missing_what = before && after ? 'Both readings'
            : before ? 'Reading before uplift'
            : 'Reading after uplift';
    }
}

function fillVariances(rows) {
    // The variance, the percentage and the verdict are computed in the view so
    // the table can filter on them. Only the sector is left to do here.
    for (const r of rows) {
        r.sector = sectorOf(r.station, r.destination);
        // Rounded here rather than in the view: subtracting two decimals in SQL
        // leaves the odd -6.63999999999999, which reads as precision nobody
        // measured to.
        if (r.variance_kg !== null && r.variance_kg !== undefined) {
            r.variance_kg = round2(Number(r.variance_kg));
        }
        if (r.variance_pct !== null && r.variance_pct !== undefined) {
            r.variance_pct = round2(Number(r.variance_pct));
        }
    }
}

// The FOB flags and the status itself are columns of the view now, computed
// in SQL so a chart slice can filter on them. Only the sector is left here:
// it is a label, nothing filters on it.
function fillCompleteness(rows) {
    for (const r of rows) {
        r.sector = sectorOf(r.station, r.destination);
    }
}

module.exports = {
    VARIANCE_BAND_PCT,
    daysBetween, daysOpen, sectorOf, today, monthRange,
    fillUninvoiced, fillAwaitingReadings, fillVariances, fillCompleteness
};

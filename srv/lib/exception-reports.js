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

// The flat band the delivery variance report uses, by decision. The configured
// FOB tolerance rules (0.5% ACARS, 1.5% crew-reported) are not used here: the
// report states ONE number, and this is it.
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
    for (const r of rows) {
        r.sector = sectorOf(r.station, r.destination);

        const expected = num(r.expected_kg);
        const actual = num(r.actual_kg);
        if (expected === null || actual === null) {
            // Nothing to compare. Left null rather than zeroed: a zero variance
            // is a measurement, and this is the absence of one.
            r.variance_kg = null;
            r.variance_pct = null;
            r.verdict = 'Not comparable';
            continue;
        }
        r.variance_kg = round2(actual - expected);
        r.variance_pct = expected ? round2(((actual - expected) / expected) * 100) : null;
        r.verdict = r.variance_pct === null ? 'Not comparable'
            : Math.abs(r.variance_pct) > VARIANCE_BAND_PCT ? 'Outside tolerance'
            : 'Within tolerance';
    }
}

function fillCompleteness(rows) {
    for (const r of rows) {
        r.sector = sectorOf(r.station, r.destination);
        r.has_fob_out = r.fob_out_kg !== null && r.fob_out_kg !== undefined;
        r.has_fob_in = r.fob_in_kg !== null && r.fob_in_kg !== undefined;

        const all = r.has_dispatch && r.has_uplift && r.has_fob_out && r.has_fob_in && r.has_apu;
        r.completeness_status = all ? 'Complete' : 'Incomplete';
    }
}

module.exports = {
    VARIANCE_BAND_PCT,
    daysBetween, daysOpen, sectorOf, today, monthRange,
    fillUninvoiced, fillAwaitingReadings, fillVariances, fillCompleteness
};

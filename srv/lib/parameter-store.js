/**
 * FuelSphere - Configuration resolution (WP-13)
 *
 * ONE STORE, TWO KINDS OF ROW. TOLERANCE_RULES was already named Parameter
 * Configuration and its scope columns were already nullable, so a scalar with
 * no scope always fitted it. A second entity would have put parameter
 * configuration in two places.
 *
 *   row_kind = PARAMETER   scalar. value_type plus one typed value column.
 *                          "Which of these is it." D28's four live here
 *   row_kind = TOLERANCE   a ladder and a floor. "How far is too far"
 *
 * Both resolve the same way, deliberately — one rule, learned once:
 *
 *   SPECIFICITY, then PRIORITY, then DATE
 *   AS OF THE TRANSACTION DATE, NEVER THE QUERY DATE  (CFG402)
 *   AND THE ROW THAT RESOLVED IS RETURNED             (CFG406)
 *
 * NOT A CACHE. Every call reads. A value resolved once and held for the
 * process lifetime defeats effective dating, which is the whole point of the
 * valid_from/valid_to columns.
 */

const cds = require('@sap/cds');
const { SELECT } = cds.ql;

const today = () => new Date().toISOString().slice(0, 10);
const d = (v) => (v === null || v === undefined ? null : String(v).slice(0, 10));

// A resolution that finds nothing is a CONFIGURATION DEFECT, not a value.
// CFG401 requires a global row to always exist, so nothing resolving means
// somebody deleted it — and returning a hardcoded fallback here would hide
// exactly that. The code says so.
const ERR = { NO_PARAMETER: 'CFG450', NO_TOLERANCE: 'CFG451', BAD_VALUE: 'CFG452' };

/** Rows whose scope does not CONTRADICT the request, most specific first. */
function inScope(rows, scope, asOf, fields) {
    return rows
        .filter(r => r.is_active !== false)
        .filter(r => !r.valid_from || d(r.valid_from) <= asOf)
        .filter(r => !r.valid_to   || d(r.valid_to)   >= asOf)
        // A scope column set on the row must match. Unset means "any", which
        // is what makes a row the global default.
        .filter(r => fields.every(f => !r[f] || r[f] === scope[f]))
        .sort((a, b) =>
            // Specificity first: how many scope columns the row actually names.
            fields.filter(f => b[f]).length - fields.filter(f => a[f]).length ||
            (a.priority || 999) - (b.priority || 999));
}

// ===========================================================================
// 1. SCALAR PARAMETERS
// ===========================================================================

/**
 * Resolve one scalar parameter.
 *
 * Returns the typed value and the evidence — which row, at which specificity,
 * in which window. The evidence is not decoration: WP-11, WP-17 and WP-07B
 * each recorded a source beside their constant before this store existed, and
 * replacing that with a bare lookup would lose the only thing that survives a
 * challenge eighteen months later.
 */
async function resolveParameter(code, scope = {}, asOfDate = null, tx = null) {
    const db = tx || cds.db;
    const asOf = d(asOfDate) || today();
    const rows = await db.run(SELECT.from('fuelsphere.TOLERANCE_RULES')
        .where({ rule_code: code, row_kind: 'PARAMETER' }));

    const eligible = inScope(rows, scope, asOf, ['company_code', 'station_code']);
    if (!eligible.length) {
        return { value: null, resolved: false,
            reason: `${ERR.NO_PARAMETER}: no PARAMETER row for ${code} in scope at ${asOf}. `
                  + `A global row must always exist (CFG401), so this is a configuration defect, `
                  + `not an absent value.` };
    }
    const row = eligible[0];
    let value;
    switch (row.value_type) {
        case 'BOOLEAN': value = row.value_boolean === true || row.value_boolean === 'true'; break;
        case 'NUMBER':  value = row.value_number === null ? null : Number(row.value_number); break;
        default:        value = row.value_text; break;   // TEXT and CHOICE
    }

    // A CHOICE outside its own allowed set is a bad row, not a new option.
    // The D25 lesson applied to configuration: declaring the set is not
    // enforcing it unless something checks.
    if (row.value_type === 'CHOICE' && row.allowed_values) {
        const allowed = row.allowed_values.split(',').map(x => x.trim());
        if (!allowed.includes(value)) {
            return { value: null, resolved: false,
                reason: `${ERR.BAD_VALUE}: ${code} resolved to '${value}', which is not one of `
                      + `${allowed.join(', ')}.` };
        }
    }

    return {
        value, resolved: true,
        evidence: {
            source: 'TOLERANCE_RULES',
            row_kind: 'PARAMETER',
            parameter_id: row.ID,
            parameter_code: row.rule_code,
            value_type: row.value_type,
            scope_company_code: row.company_code || null,
            scope_station_code: row.station_code || null,
            specificity: ['company_code', 'station_code'].filter(f => row[f]).length,
            priority: row.priority,
            valid_from: d(row.valid_from),
            valid_to: d(row.valid_to),
            as_of: asOf,
            decision_ref: row.decision_ref,
            is_wired: row.is_wired === true || row.is_wired === 'true',
            candidates: eligible.length
        }
    };
}

// ===========================================================================
// 2. TOLERANCE RULES
// ===========================================================================

/**
 * Resolve one tolerance rule, by its code or by what it applies to.
 *
 * applies_to is what stops one control picking up another's threshold — the
 * FOB reconciliation's 0.5% and the invoice line's 5% are both QUANTITY.
 */
async function resolveToleranceRule({ ruleCode, appliesTo, toleranceType },
                                    scope = {}, asOfDate = null, tx = null) {
    const db = tx || cds.db;
    const asOf = d(asOfDate) || today();
    // row_kind excluded explicitly: a PARAMETER row shares the code space and
    // must never answer a tolerance question.
    const where = ruleCode
        ? { rule_code: ruleCode, row_kind: 'TOLERANCE' }
        : { tolerance_type: toleranceType, row_kind: 'TOLERANCE' };
    const rows = await db.run(SELECT.from('fuelsphere.TOLERANCE_RULES').where(where));

    let candidates = rows;
    if (!ruleCode && appliesTo) candidates = rows.filter(r => !r.applies_to || r.applies_to === appliesTo);

    const eligible = inScope(candidates, scope, asOf,
        ['company_code', 'supplier_category', 'product_type']);
    if (!eligible.length) {
        return { rule: null, resolved: false,
            reason: `${ERR.NO_TOLERANCE}: no TOLERANCE_RULES row for `
                  + `${ruleCode || `${toleranceType}/${appliesTo}`} in scope at ${asOf}.` };
    }
    // An explicit applies_to beats a row that matches everything, before
    // priority is consulted — the same rule WP-20 used for formula scope.
    eligible.sort((a, b) => (b.applies_to ? 1 : 0) - (a.applies_to ? 1 : 0));
    const rule = eligible[0];

    return {
        rule, resolved: true,
        evidence: {
            source: 'TOLERANCE_RULES',
            rule_id: rule.ID,
            rule_code: rule.rule_code,
            applies_to: rule.applies_to || null,
            tolerance_type: rule.tolerance_type,
            scope_company_code: rule.company_code || null,
            priority: rule.priority,
            valid_from: d(rule.valid_from),
            valid_to: d(rule.valid_to),
            as_of: asOf,
            candidates: eligible.length
        }
    };
}

/**
 * The absolute band form — EPD403 and EPD404. lower_limit and upper_limit are
 * the value itself, not a variance, so is_percentage is false.
 */
function withinBand(value, rule) {
    if (value === null || value === undefined || !rule) return { checked: false };
    const lo = rule.lower_limit === null ? null : Number(rule.lower_limit);
    const hi = rule.upper_limit === null ? null : Number(rule.upper_limit);
    const v = Number(value);
    const below = lo !== null && v < lo;
    const above = hi !== null && v > hi;
    return { checked: true, within: !below && !above, below, above, lower: lo, upper: hi };
}

/**
 * The effective tolerance in absolute units — a percentage AND a floor, taking
 * the greater. WP-17's shape, moved unchanged: 100 kg of crew rounding is
 * 0.9% of a narrowbody uplift and 25% of a 400 kg top-up.
 */
function effectiveTolerance(rule, magnitude) {
    if (!rule) return null;
    const pct = rule.upper_limit === null ? null : Math.abs(Number(rule.upper_limit));
    const floor = rule.floor_value === null || rule.floor_value === undefined
        ? null : Math.abs(Number(rule.floor_value));
    if (rule.is_percentage === false) return floor;
    const fromPct = pct === null ? null : Math.abs(Number(magnitude)) * pct / 100;
    if (fromPct === null) return floor;
    if (floor === null) return Number(fromPct.toFixed(4));
    return Number(Math.max(fromPct, floor).toFixed(4));
}

// ===========================================================================
// 3. THE BURN VARIANCE LADDER — ONE PLACE
//
// It was written out three times in burn-service.js, in two forms: twice
// ascending with <=, once descending with >. Both produce the same answer,
// which is exactly why three copies survived — nothing ever disagreed.
// Moving "the" constant would have moved one of three.
// ===========================================================================
const BURN_STATUS = { NORMAL: 'NORMAL', WARNING: 'WARNING', EXCEPTION: 'EXCEPTION', CRITICAL: 'CRITICAL' };

function burnVarianceStatus(absPct, rule) {
    const w = rule && rule.warning_threshold  !== null ? Number(rule.warning_threshold)  : null;
    const e = rule && rule.error_threshold    !== null ? Number(rule.error_threshold)    : null;
    const c = rule && rule.critical_threshold !== null ? Number(rule.critical_threshold) : null;
    if (w === null || e === null || c === null) {
        return { status: null, reason: `${ERR.NO_TOLERANCE}: the burn variance ladder is not fully configured.` };
    }
    const v = Math.abs(Number(absPct));
    const status = v <= w ? BURN_STATUS.NORMAL
                 : v <= e ? BURN_STATUS.WARNING
                 : v <= c ? BURN_STATUS.EXCEPTION
                 : BURN_STATUS.CRITICAL;
    return {
        status,
        requiresReview: status === BURN_STATUS.EXCEPTION || status === BURN_STATUS.CRITICAL,
        thresholds: { warning: w, error: e, critical: c }
    };
}

/**
 * WP-13 / D30 — the delivery quality guard.
 *
 * ONE function, registered on three places: the service entity, its draft
 * path, and the database layer. It replaces the two @assert.range annotations
 * removed from db/schema.cds, and covers more than they did — they never
 * fired on a db.run write, which is how every handler in this repository
 * writes.
 *
 * Lives here rather than in order-service.js because srv/server.js registers
 * the database layer, and two copies of a guard is how D30 happened.
 */
const QUALITY_CHECKS = [
    ['temperature', 'EPD403', 'TOL-EPD-TEMP',    '\u00b0C'],
    ['density',     'EPD404', 'TOL-EPD-DENSITY', ' kg/L']
];

async function qualityGuard(req) {
    const data = req.data || {};
    if (data.temperature === undefined && data.density === undefined) return;
    const asOf = data.delivery_date || null;
    for (const [field, code, ruleCode, unit] of QUALITY_CHECKS) {
        const v = data[field];
        if (v === null || v === undefined) continue;
        const t = await resolveToleranceRule({ ruleCode }, {}, asOf);
        if (!t.resolved) return req.reject(500, t.reason);
        const b = withinBand(v, t.rule);
        if (b.checked && !b.within) {
            return req.reject(400, `${code}: ${field} ${v}${unit} is outside `
                + `${b.lower} to ${b.upper}, resolved from ${t.evidence.rule_code} `
                + `as at ${t.evidence.as_of}.`);
        }
    }
}

module.exports = {
    ERR, BURN_STATUS, QUALITY_CHECKS, qualityGuard,
    resolveParameter, resolveToleranceRule,
    withinBand, effectiveTolerance, burnVarianceStatus,
    inScope
};

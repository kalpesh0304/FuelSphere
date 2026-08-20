/**
 * FuelSphere - Native pricing derivation (WP-20, decision A10)
 *
 * 02-BEHAVIOUR section 8. The engine calculates the BASIC FUEL PRICE only:
 * index, differential, and into-plane where the fuel supplier also performs
 * into-plane. Tax and duty AMOUNTS are SAP's — FuelSphere determines the code.
 *
 * COMPONENTS STAY SEPARATE. Never folded into a unit rate. That is what makes
 * a variance actionable: "the differential is 0.019 above contract while the
 * index matches" is a supplier conversation; "0.019 over" is not.
 */

const cds = require('@sap/cds');
const { SELECT } = cds.ql;

const r4 = (v) => Number(Number(v).toFixed(4));
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// ===========================================================================
// Tax component types
//
// The engine does not price these. They are carried through to the breakdown
// with their declared values so the formula is not silently truncated, and
// excluded from derived_price so FuelSphere is not calculating a tax amount.
// ===========================================================================
const TAX_COMPONENT_TYPES = ['EXCISE_DUTY', 'VAT', 'OTHER_TAX'];
const isTax = (t) => TAX_COMPONENT_TYPES.includes(t);

const APPLY = { BASE: 'BASE', CUMULATIVE: 'CUMULATIVE', SUBTOTAL: 'SUBTOTAL' };
const CALC  = { FIXED: 'FIXED', PERCENTAGE: 'PERCENTAGE', LOOKUP: 'LOOKUP', FORMULA: 'FORMULA' };

// Looked up in 03-VALIDATION-RULES.md, not assigned. Most of what this module
// enforces already has a code:
//
//   PRC403  the native engine calculates the basic fuel price only; tax and
//           duty AMOUNTS are calculated by SAP
//   PRC404  components are stored individually, never folded into a unit price
//   PRC406  index in contract UoM converts to price UoM using a density basis
//   PRC407  every quote used and the scheme version are stamped, so a price is
//           re-explainable WITHOUT recomputation
//   PRC408  price_status PROVISIONAL suppresses the invoice price variance check
//   PRC410  a restated quotation retains the original and triggers repricing
//   PRC411  non-business days carry no assessment; missing_quote_policy
//           governs resolution, NEVER a silent zero
//
// Two failures have no rule, and both are about WHICH formula rather than what
// it computes, so they take new codes. New codes in an existing prefix start
// at x450.
//
//   PRC450  no ACTIVE formula in validity is in scope for the contract
//   PRC451  more than one ACTIVE formula resolves at the same scope tier —
//           PRC401 says the source is resolved per contract, and two answers
//           is not one
const ERR = {
    NO_FORMULA:        'PRC450',   // new
    AMBIGUOUS_FORMULA: 'PRC451',   // new
    NO_QUOTE:          'PRC411',
    UOM_MISMATCH:      'PRC406',
    TAX_EXCLUDED:      'PRC403'
};

// ===========================================================================
// 1. Formula resolution
//
// PRICING_FORMULAS HAS NO CONTRACT ASSOCIATION. WP-08 dropped
// PricingFormulas.contract deliberately, and the instruction for this package
// is not to restore it. So resolution runs off the two scoping fields the
// entity does carry — supplier_id and company_code — narrowed by the
// contract's own supplier.
//
// PRC401 requires the source to be resolved PER CONTRACT. Scoping by supplier
// and company code is per contract only while the scope discriminates: two
// ACTIVE formulas at the same tier for the same supplier are two answers to a
// question that has one, and that is an error rather than a pick.
// ===========================================================================

// Most specific first. A formula naming both the supplier and the company
// code beats one naming only the supplier, which beats a company-wide
// default, which beats an unscoped one.
const SCOPE_TIERS = [
    { tier: 1, name: 'SUPPLIER+COMPANY', match: (f, c, co) => !!f.supplier_id && f.supplier_id === c.supplier_ID && !!f.company_code && f.company_code === co },
    { tier: 2, name: 'SUPPLIER',         match: (f, c)     => !!f.supplier_id && f.supplier_id === c.supplier_ID && !f.company_code },
    { tier: 3, name: 'COMPANY',          match: (f, c, co) => !f.supplier_id && !!f.company_code && f.company_code === co },
    { tier: 4, name: 'UNSCOPED',         match: (f)        => !f.supplier_id && !f.company_code }
];

/**
 * Resolve the formula for a contract at a transaction date.
 *
 * ACTIVE only, and effective-dated. A DRAFT formula is not a formula anybody
 * agreed to, and an expired one priced a period that has closed.
 *
 * Returns the row plus the evidence of WHICH row resolved and WHY — the
 * applied-evidence pattern already used by conversion_source, fob_source,
 * rate_source and plan_version_source.
 *
 * @param contract  the MASTER_CONTRACTS row, not an id — the supplier is the
 *                  only thing that discriminates, so the row is required
 */
async function resolveFormula(contract, transactionDate, companyCode, tx) {
    const db = tx || cds.db;
    if (!contract) return { formula: null, reason: `${ERR.NO_FORMULA}: no contract supplied.` };

    const rows = await db.run(SELECT.from('fuelsphere.PRICING_FORMULAS')
        .where({ status: 'ACTIVE' }));

    // Effective dating first. A formula out of its validity window is not a
    // candidate at any tier.
    const effective = rows.filter(f =>
        (!f.valid_from || f.valid_from <= transactionDate) &&
        (!f.valid_to   || f.valid_to   >= transactionDate));

    for (const t of SCOPE_TIERS) {
        const atTier = effective.filter(f => t.match(f, contract, companyCode));
        if (!atTier.length) continue;

        // Within one formula_id, the highest version supersedes. ACROSS
        // formula_ids there is no ordering — two different formulas at the
        // same scope is an ambiguity, not a ranking.
        const byId = new Map();
        for (const f of atTier) {
            const cur = byId.get(f.formula_id);
            if (!cur || (f.version || 0) > (cur.version || 0)) byId.set(f.formula_id, f);
        }
        if (byId.size > 1) {
            return { formula: null, reason:
                `${ERR.AMBIGUOUS_FORMULA}: ${byId.size} ACTIVE formulas resolve at scope ${t.name} `
              + `for contract ${contract.contract_number} at ${transactionDate} `
              + `(${[...byId.keys()].join(', ')}). A price has one formula.` };
        }
        const formula = [...byId.values()][0];
        return {
            formula,
            evidence: {
                formula_id: formula.formula_id,
                formula_version: formula.version,
                resolved_by: 'PRICING_FORMULAS',
                scope_tier: t.tier,
                scope_name: t.name,
                scope_supplier_id: formula.supplier_id || null,
                scope_company_code: formula.company_code || null,
                valid_from: formula.valid_from,
                valid_to: formula.valid_to,
                effective_candidates: effective.length,
                candidates_at_tier: atTier.length
            }
        };
    }

    return { formula: null, reason:
        `${ERR.NO_FORMULA}: no ACTIVE formula in validity at ${transactionDate} matches contract `
      + `${contract.contract_number} (supplier ${contract.supplier_ID}, company ${companyCode || 'unstated'}) `
      + `at any scope tier. ${effective.length} formula(s) were effective but none in scope.` };
}

// ===========================================================================
// 2. Index resolution — the offset, the average and the missing quote
// ===========================================================================

/**
 * The published curve for an index, up to and including a date.
 *
 * Only CURRENT rows are eligible: a restated value supersedes the original,
 * and the original is retained rather than overwritten (PRC410).
 *
 * A market holiday row is EXCLUDED. The row exists to record that the market
 * was closed — absence is not a gap, and a closed market published no
 * assessment to price on.
 */
async function publishedCurve(indexId, priceDate, tx) {
    const db = tx || cds.db;
    const quotes = await db.run(SELECT.from('fuelsphere.MARKET_INDEX_VALUES')
        .where({ market_index_ID: indexId }));

    return quotes
        .filter(q => q.is_current !== false)
        .filter(q => !q.is_holiday)
        .filter(q => String(q.effective_date) <= String(priceDate))
        .sort((a, b) => (String(a.effective_date) < String(b.effective_date) ? 1 : -1));   // newest first
}

/**
 * Establish the reference day, honouring the missing-quote policy.
 *
 * PRC411: a non-business day carries no assessment, and the policy governs
 * resolution — NEVER a silent zero, and never a silent substitution either.
 * Where the price date itself did not publish, PRIOR_PUBLISHED takes the most
 * recent quote before it and SAYS SO; FAIL refuses to price.
 */
function referenceDay(curve, priceDate, policy) {
    if (!curve.length) {
        return { error: `${ERR.NO_QUOTE}: no published quote on or before ${priceDate}.` };
    }
    // The curve is newest-first and bounded at priceDate, so an exact quote for
    // the price date can only be at position 0.
    const exact = String(curve[0].effective_date) === String(priceDate);
    if (exact) return { substituted: false, policy: policy || 'PRIOR_PUBLISHED' };

    if ((policy || 'PRIOR_PUBLISHED') === 'FAIL') {
        return { error: `${ERR.NO_QUOTE}: ${priceDate} carries no assessment and missing_quote_policy is FAIL; `
                      + `the most recent published quote is ${curve[0].effective_date} and substitution is refused.` };
    }
    return { substituted: true, policy: 'PRIOR_PUBLISHED',
             substituted_from: priceDate, substituted_to: curve[0].effective_date };
}

/**
 * Pick the quote for a price date, honouring the component's offset.
 *
 * IATA-19 gives the offset form: N+0 is the reference day, N-1 the previous
 * published day, N-2 the one before. THE OFFSET COUNTS PUBLISHED DAYS, not
 * calendar days — a market that did not publish did not publish, and counting
 * back over a weekend by subtracting days lands on nothing.
 */
async function resolveIndexValue(indexId, priceDate, offsetDays, policy, tx) {
    const curve = await publishedCurve(indexId, priceDate, tx);
    const ref = referenceDay(curve, priceDate, policy);
    if (ref.error) return { value: null, reason: ref.error, policy: policy || 'PRIOR_PUBLISHED' };

    const back = Math.abs(Number(offsetDays) || 0);
    if (back >= curve.length) {
        return { value: null, policy: ref.policy,
                 reason: `${ERR.NO_QUOTE}: offset N-${back} reaches past the earliest published quote `
                       + `(${curve.length} published day(s) available on or before ${priceDate}).` };
    }
    const picked = curve[back];
    return {
        value: r4(picked.index_value),
        effective_date: picked.effective_date,
        quote_id: picked.ID,
        offset_applied: back,
        published_days_considered: curve.length,
        is_estimated: !!picked.is_estimated,
        substituted: !!ref.substituted,
        substituted_from: ref.substituted_from || null,
        policy: ref.policy
    };
}

/**
 * Average a published assessment over a period.
 *
 * average_days counts PUBLISHED days, for the same reason the offset does. A
 * five-day average over a week containing a holiday averages the five days
 * that published, not four days and a gap treated as zero.
 *
 * IATA-34 (calendar versus trading day averaging, 18 values) is G2 backlog.
 * PRICING_FORMULAS and FORMULA_COMPONENTS can express only a count of
 * published days, and that is what this implements.
 */
async function averageIndexValue(indexId, priceDate, offsetDays, averageDays, policy, tx) {
    const curve = await publishedCurve(indexId, priceDate, tx);
    const ref = referenceDay(curve, priceDate, policy);
    if (ref.error) return { value: null, reason: ref.error, policy: policy || 'PRIOR_PUBLISHED' };

    const back = Math.abs(Number(offsetDays) || 0);
    const requested = Math.max(1, Number(averageDays) || 1);
    const window = curve.slice(back, back + requested);
    if (!window.length) {
        return { value: null, policy: ref.policy,
                 reason: `${ERR.NO_QUOTE}: no published quotes in the averaging window at offset N-${back}.` };
    }

    const sum = window.reduce((a, q) => a + Number(q.index_value), 0);
    return {
        value: r4(sum / window.length),
        effective_date: window[0].effective_date,
        quote_id: window[0].ID,
        quotes_used: window.map(q => ({ date: q.effective_date, value: r4(q.index_value), id: q.ID })),
        requested_days: requested,
        actual_days: window.length,
        offset_applied: back,
        published_days_considered: curve.length,
        substituted: !!ref.substituted,
        substituted_from: ref.substituted_from || null,
        policy: ref.policy,
        // An average short of the days it asked for is not the average that
        // was contracted. It is reported, never silently accepted.
        short: window.length < requested
    };
}

// ===========================================================================
// 3. Component application, IN SEQUENCE
// ===========================================================================

/** Does a conditional component fire for this context? */
function conditionHolds(component, context) {
    const f = component.condition_field;
    if (!f) return { fires: true, evaluated: false };

    const actual = context ? context[f] : undefined;
    const expected = component.condition_value;
    const op = (component.condition_operator || 'EQ').toUpperCase();

    // An unknown field is NOT a silent pass. A condition that cannot be
    // evaluated has not been met.
    if (actual === undefined || actual === null) {
        return { fires: false, evaluated: true, why: `condition field '${f}' absent from context` };
    }

    const a = isNaN(Number(actual)) ? String(actual) : Number(actual);
    const b = isNaN(Number(expected)) ? String(expected) : Number(expected);
    const cmp = {
        EQ: a === b, NE: a !== b,
        GT: a > b, LT: a < b, GTE: a >= b, LTE: a <= b
    }[op];
    if (cmp === undefined) return { fires: false, evaluated: true, why: `unknown operator '${op}'` };
    return { fires: cmp, evaluated: true, why: `${f} ${op} ${expected} (actual ${actual})` };
}

/** Apply a cap and a floor. Both, and in that order, so a bad pair is visible. */
function bound(value, component) {
    const min = num(component.min_value), max = num(component.max_value);
    let v = value, capped = null;
    if (max !== null && v > max) { v = max; capped = `capped at max_value ${max}`; }
    if (min !== null && v < min) { v = min; capped = `raised to min_value ${min}`; }
    return { value: r4(v), bounded: capped };
}

/**
 * Resolve the index figure for one component, honouring offset, averaging and
 * the missing-quote policy.
 *
 * The policy lives on the COMPONENT, not the index — two contracts may take
 * the same assessment and treat a closed market differently, and one of them
 * refusing to price is a contractual position rather than a data problem.
 */
async function componentIndexValue(component, priceDate, tx) {
    if (!component.lookup_index_ID) {
        return { value: null, reason: `${ERR.NO_QUOTE}: component '${component.component_name}' is a `
                                    + `${component.calculation_type} lookup with no lookup_index.` };
    }
    const policy = component.missing_quote_policy || 'PRIOR_PUBLISHED';

    return component.use_average
        ? averageIndexValue(component.lookup_index_ID, priceDate,
                            component.index_offset_days, component.average_days, policy, tx)
        : resolveIndexValue(component.lookup_index_ID, priceDate,
                            component.index_offset_days, policy, tx);
}

/**
 * Apply the components in sequence and produce the breakdown.
 *
 * PRC404: each component's own contribution stays visible. The running total
 * is a convenience for the next component, NOT the answer — the answer is the
 * list, and the total is derivable from it.
 *
 * PRC403: tax-typed components are carried through with their declared values
 * and EXCLUDED from the basic fuel price. FuelSphere determines the tax code;
 * SAP calculates the amount. Dropping them silently would truncate the
 * formula; including them would have FuelSphere pricing tax.
 */
async function applyComponents(components, priceDate, context, tx) {
    const ordered = [...components]
        .filter(c => c.is_active !== false)
        .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

    const applied = [];
    const logs = [];
    // ApplyToType says what a component applies TO, not what it becomes.
    //
    //   BASE        the base amount — the first component's value, normally
    //               the index. Established once and NOT overwritten by a
    //               later component that happens to be scoped to it.
    //   CUMULATIVE  the running total so far, tax components included
    //   SUBTOTAL    the basic fuel price so far, tax components excluded
    let base = null;       // the BASE amount, set once by the first component
    let running = 0;       // the cumulative subtotal
    let basic = 0;         // basic fuel price — excludes tax-typed components

    for (const c of ordered) {
        const step = {
            sequence: c.sequence,
            name: c.component_name,
            component_type: c.component_type,
            calculation_type: c.calculation_type,
            apply_to: c.apply_to,
            currency: c.component_currency_ID || null,
            fired: true,
            value: null,
            basis: null,
            note: null
        };

        // Conditional components fire, or do not, per their own condition.
        const cond = conditionHolds(c, context);
        if (!cond.fires) {
            step.fired = false;
            step.value = 0;
            step.note = `condition not met: ${cond.why}`;
            applied.push(step);
            logs.push({ sequence: c.sequence, level: 'INFO', category: 'COMPONENT', message:
                `Component '${c.component_name}' skipped — ${cond.why}`,
                component_id: c.ID, input_value: null, output_value: null });
            continue;
        }
        if (cond.evaluated) step.note = `condition met: ${cond.why}`;

        // What this component is a percentage OF, where it is one.
        const applyBase = c.apply_to === APPLY.BASE      ? (base === null ? 0 : base)
                        : c.apply_to === APPLY.SUBTOTAL  ? basic
                        : running;
        let raw = 0;

        if (c.calculation_type === CALC.LOOKUP) {
            const idx = await componentIndexValue(c, priceDate, tx);
            if (idx.value === null) {
                return { error: idx.reason, applied, logs, failedAt: c.component_name };
            }
            raw = idx.value;
            step.index = {
                index_id: c.lookup_index_ID,
                value: idx.value,
                effective_date: idx.effective_date || null,
                quote_id: idx.quote_id || null,
                offset_applied: idx.offset_applied,
                averaged: !!c.use_average,
                // PRC407. The quote ids are what makes the price
                // re-explainable WITHOUT recomputation — eighteen months on,
                // the assessments may have been restated and recomputing
                // would give a different answer.
                quotes_used: idx.quotes_used || (idx.quote_id ? [{ date: idx.effective_date, value: idx.value, id: idx.quote_id }] : []),
                requested_days: idx.requested_days || 1,
                actual_days: idx.actual_days || 1,
                published_days_considered: idx.published_days_considered,
                // PRC411. A substitution is stated, never silent.
                missing_quote_policy: idx.policy,
                substituted: !!idx.substituted,
                substituted_from: idx.substituted_from || null,
                short_of_requested: !!idx.short
            };
            step.basis = c.use_average
                ? `average of ${idx.actual_days} published day(s) at offset N-${idx.offset_applied}, ending ${idx.effective_date}`
                : `published quote ${idx.effective_date} at offset N-${idx.offset_applied}`;
            if (idx.substituted) {
                step.note = [step.note, `${ERR.NO_QUOTE}: ${idx.substituted_from} carries no assessment; `
                                      + `missing_quote_policy ${idx.policy} substituted ${idx.effective_date}`]
                    .filter(Boolean).join('; ');
                logs.push({ sequence: c.sequence, level: 'WARNING', category: 'INDEX',
                    message: `${ERR.NO_QUOTE}: no assessment on ${idx.substituted_from} for component `
                           + `'${c.component_name}'; policy ${idx.policy} resolved to ${idx.effective_date} = ${idx.value}.`,
                    component_id: c.ID, index_id: c.lookup_index_ID, output_value: idx.value });
            }
            if (idx.short) {
                logs.push({ sequence: c.sequence, level: 'WARNING', category: 'INDEX',
                    message: `Averaging window for '${c.component_name}' asked for ${idx.requested_days} published `
                           + `day(s) and found ${idx.actual_days}. The average is over ${idx.actual_days}.`,
                    component_id: c.ID, index_id: c.lookup_index_ID, output_value: idx.value });
            }
        } else if (c.calculation_type === CALC.PERCENTAGE) {
            raw = applyBase * (Number(c.percentage_value) || 0) / 100;
            step.basis = `${c.percentage_value}% of ${r4(applyBase)} (${c.apply_to})`;
        } else {
            raw = Number(c.fixed_value) || 0;
            step.basis = `fixed ${raw}`;
        }

        const bounded = bound(raw, c);
        step.value = bounded.value;
        if (bounded.bounded) step.note = [step.note, bounded.bounded].filter(Boolean).join('; ');

        applied.push(step);
        logs.push({ sequence: c.sequence, level: 'INFO',
            category: c.calculation_type === CALC.LOOKUP ? 'INDEX' : 'COMPONENT',
            message: `Component '${c.component_name}' (${c.component_type}/${c.calculation_type}) = ${step.value}`
                   + (bounded.bounded ? ` [${bounded.bounded}]` : ''),
            component_id: c.ID, index_id: c.lookup_index_ID || null,
            input_value: r4(applyBase), output_value: step.value,
            calculation_expression: step.basis });

        // The base is the FIRST component's value, whatever its own scope.
        // Letting a later BASE-scoped component overwrite it would make a
        // percentage-of-index component redefine the index.
        if (base === null) base = step.value;
        running = r4(running + step.value);

        if (isTax(c.component_type)) {
            step.excluded_from_price = true;
            step.note = [step.note, `${ERR.TAX_EXCLUDED}: tax amount is SAP's, not priced here`]
                .filter(Boolean).join('; ');
            logs.push({ sequence: c.sequence, level: 'WARNING', category: 'COMPONENT',
                message: `${ERR.TAX_EXCLUDED}: '${c.component_name}' is ${c.component_type}; `
                       + `carried in the breakdown at ${step.value} and excluded from the basic fuel price.`,
                component_id: c.ID, output_value: step.value });
        } else {
            basic = r4(basic + step.value);
        }
    }

    return {
        applied,
        logs,
        basicFuelPrice: r4(basic),
        baseAmount: base === null ? null : r4(base),
        cumulativeIncludingTaxComponents: r4(running),
        taxComponents: applied.filter(a => a.excluded_from_price)
    };
}

module.exports = {
    TAX_COMPONENT_TYPES, isTax, APPLY, CALC, ERR,
    r4, num,
    SCOPE_TIERS,
    resolveFormula, publishedCurve, referenceDay,
    resolveIndexValue, averageIndexValue, componentIndexValue,
    conditionHolds, bound, applyComponents
};

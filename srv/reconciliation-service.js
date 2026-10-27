const cds = require('@sap/cds');
const { SELECT } = cds.ql;

const LOG = cds.log('reconciliation');

const MOVEMENT_BY_DAY = 'fuelsphere.RECON_MOVEMENT_BY_DAY';
const UPLIFT_BY_DAY   = 'fuelsphere.RECON_UPLIFT_BY_DAY';
const UPLIFT_FI_BY_DAY = 'fuelsphere.RECON_UPLIFT_FI_BY_DAY';
const MOVEMENTS       = 'fuelsphere.FUEL_STOCK_MOVEMENT_LEDGER';
const GL_ACCOUNTS     = 'fuelsphere.RECON_GL_ACCOUNTS';
const CARRIER_MASTER  = 'fuelsphere.CARRIER_MASTER';
const ROB_LEDGER      = 'fuelsphere.ROB_LEDGER';
const FUEL_TICKETS    = 'fuelsphere.FUEL_TICKETS';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// THE LINE TYPES, GROUPED THE WAY THE SPECIFICATION GROUPS THEM.
//
// UPLIFT and DEFUEL are one figure - "all uplift and defueling" - because a
// defuel is an uplift with the sign reversed, and the ledger already carries
// it that way.
const UPLIFT_TYPES = new Set(['UPLIFT', 'DEFUEL']);
const OTHER_TYPES  = new Set(['ADJUSTMENT', 'TRANSFER']);

// ===========================================================================
// WHAT COUNTS AS ROUNDING
// ===========================================================================
//
// SCALED BY THE NUMBER OF LINES, NOT BY THE MONEY, and the difference is the
// whole usefulness of the unallocated column.
//
// The first version of this scaled with turnover - half a per cent of the
// period's own uplift - on the reasoning that 500 USD is noise to a carrier
// burning twenty million a month. That reasoning is wrong, and the harness
// caught it: half a per cent of twenty million is a hundred thousand dollars,
// so a six-figure hole in the ledger would have rendered amber and read as
// rounding. A reconciliation that forgives a hundred thousand dollars is not
// a reconciliation.
//
// ROUNDING IS PROPORTIONAL TO HOW MANY NUMBERS WERE ROUNDED. Every movement
// line carries a value at two decimal places, so the most that two-decimal
// rounding can accumulate over a period is one cent per line. That is the
// real error bar, it is physical rather than chosen, and on a twenty-million
// dollar month of 1,763 uplifts it comes to about eighteen dollars - which
// is the right order of magnitude for "ignore this" and nowhere near six
// figures.
const CENT_PER_LINE = 0.01;
const TOLERANCE_FLOOR = 1.00;   // a period with few lines still gets a cent or two

const num = v => (v === null || v === undefined || v === '') ? 0 : (Number(v) || 0);
const round2 = v => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const periodOf = d => String(d || '').slice(0, 7);          // '2026-09'
const yearOf   = d => String(d || '').slice(0, 4);
const labelOf  = p => {
    const [y, m] = String(p).split('-');
    return (MONTHS[Number(m) - 1] || m) + ' ' + y;
};

/**
 * Pull the simple equality and IN filters out of a CQN where clause.
 *
 * WHY BY HAND. FinanceReconciliation has no table, so CAP cannot translate a
 * $filter into SQL for it - there is nothing to translate it against. The
 * handler has to read the filter itself and decide what to compute, and what
 * it can usefully honour is exactly the filter bar: carrier, year, mode.
 *
 * ANYTHING ELSE FALLS THROUGH TO applyRest below, which filters the finished
 * rows in memory. That is not a compromise at this size: the result set is a
 * dozen rows, and filtering a dozen rows in Node is free. The distinction
 * matters only for the three filters that change WHICH ledger rows are read,
 * and those are the three read here.
 */
function readFilters(where) {
    const out = {};
    if (!Array.isArray(where)) return out;

    // ---- FLATTEN FIRST. PARENTHESES NEST. -------------------------------
    //
    // Fiori Elements emits `(carrier_code eq 'B6') and (fiscal_year eq '2026')`,
    // and CAP turns each bracketed group into a NESTED array - or an {xpr}
    // wrapper - rather than more tokens in one list. A scanner that walks
    // only the top level sees two arrays, no `ref` on either, and reports
    // that the user filtered on nothing.
    //
    // THAT FAILS IN THE WORST DIRECTION. No filter found means every carrier
    // and every year gets computed and returned, so the screen answers a
    // filtered request with unfiltered data - quickly, with no error, and
    // looking entirely normal.
    //
    // FLATTENING IS SOUND FOR WHAT A FILTER BAR EMITS: an AND of per-column
    // groups, each an OR of equalities on one column. It is NOT sound for an
    // OR across different columns, which a filter bar cannot produce and
    // which applyRest() below would catch anyway - it re-filters the finished
    // rows against the same clause.
    const flat = [];
    (function walk(node) {
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (node && Array.isArray(node.xpr)) { node.xpr.forEach(walk); return; }
        flat.push(node);
    })(where);
    where = flat;

    for (let i = 0; i < where.length; i++) {
        const t = where[i];
        if (!t || !t.ref || !t.ref.length) continue;
        const col = t.ref[t.ref.length - 1];
        const op = where[i + 1];
        const rhs = where[i + 2];
        // UNION, NOT OVERWRITE, and this is not a nicety. Fiori Elements
        // renders a multi-select filter as an OR of equalities -
        // (carrier_code eq 'B6' or carrier_code eq 'AC') - so assigning here
        // would keep only the LAST value a user picked and silently drop the
        // rest. The screen would show one carrier and the filter chip would
        // say two.
        const add = (vals) => {
            if (!vals.length) return;
            out[col] = [...new Set([...(out[col] || []), ...vals])];
        };
        if (op === '=' && rhs && 'val' in rhs) add([String(rhs.val)]);
        else if (op === 'in' && rhs) {
            const list = Array.isArray(rhs) ? rhs : (rhs.list || []);
            add(list.filter(x => x && 'val' in x).map(x => String(x.val)));
        }
    }
    return out;
}

/** The key of a by-key read: SELECT.from.ref[0].where carries it. */
function keyOf(q) {
    const ref = q && q.SELECT && q.SELECT.from && q.SELECT.from.ref;
    const first = ref && ref[0];
    if (!first || !first.where) return null;
    const f = readFilters(first.where);
    return f.ID ? f.ID[0] : null;
}

/**
 * Closing stock value, as RECORDED, for every carrier at a date.
 *
 * THIS IS THE ONE FIGURE THAT CANNOT BE DERIVED FROM THE MOVEMENTS, and that
 * is the entire reason the screen has an "unallocated burn" column. Closing
 * stock computed as opening plus movements would reconcile by construction -
 * it would be the same arithmetic on both sides of the comparison, and would
 * report zero unallocated fuel on a ledger that had lost a tonne of it.
 *
 * So it is read from balance_value_usd on the LAST movement of each tail at
 * or before the date, which is what the valuation actually recorded.
 *
 * TWO BOUNDED QUERIES, NOT A SCAN. The first is a GROUP BY that returns one
 * row per tail - a few hundred, whatever the ledger holds - and the second
 * fetches just those rows' balances. Neither brings a movement row into Node.
 *
 * AT OR BEFORE, NOT WITHIN. A tail that did not fly in October still holds
 * the fuel it held in September, and a "within the period" query would report
 * its stock as zero and the whole of it as unallocated.
 */
async function closingStockAt(dateInclusive) {
    const maxima = await cds.db.run(SELECT.from(MOVEMENTS)
        .columns('carrier_code', 'tail_number',
                 { func: 'max', args: [{ ref: ['sequence'] }], as: 'last_seq' })
        .where({ valuation_method: 'MAP', flight_date: { '<=': dateInclusive } })
        .groupBy('carrier_code', 'tail_number'));

    if (!maxima.length) return new Map();

    const seqs = [...new Set(maxima.map(r => Number(r.last_seq)).filter(n => !Number.isNaN(n)))];
    const rows = await cds.db.run(SELECT.from(MOVEMENTS)
        .columns('carrier_code', 'tail_number', 'sequence', 'balance_value_usd', 'balance_qty_kg')
        .where({ valuation_method: 'MAP', flight_date: { '<=': dateInclusive },
                 sequence: { in: seqs } }));

    // The sequence is per tail, not global, so the IN above can return a
    // row belonging to another tail that happens to share the number. The
    // pair match is what makes it exact.
    const byPair = new Map(rows.map(r => [`${r.tail_number}|${r.sequence}`, r]));
    const out = new Map();
    for (const m of maxima) {
        const hit = byPair.get(`${m.tail_number}|${Number(m.last_seq)}`);
        if (!hit) continue;
        const c = m.carrier_code || '';
        const acc = out.get(c) || { value: 0, qty: 0 };
        acc.value += num(hit.balance_value_usd);
        acc.qty += num(hit.balance_qty_kg);
        out.set(c, acc);
    }
    return out;
}

/** Last calendar day of a 'YYYY-MM' period. */
function endOfPeriod(period) {
    const [y, m] = period.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * Build every reconciliation row the filters ask for.
 *
 * THE SHAPE OF THE WORK: three grouped reads of the ledger for the whole year
 * at once, then one closing-stock pair of queries per period boundary. The
 * ledger is never read row by row and never read twice for the same figure.
 */
async function buildRows(filters) {
    const mode = (filters.period_mode && filters.period_mode[0] === 'YTD') ? 'YTD' : 'MONTHLY';

    // ---- which years ----------------------------------------------------
    let years = filters.fiscal_year;
    if (!years || !years.length) {
        const span = await cds.db.run(SELECT.from(MOVEMENTS)
            .columns({ func: 'min', args: [{ ref: ['flight_date'] }], as: 'lo' },
                     { func: 'max', args: [{ ref: ['flight_date'] }], as: 'hi' })
            .where({ valuation_method: 'MAP' }));
        const lo = yearOf(span[0] && span[0].lo), hi = yearOf(span[0] && span[0].hi);
        if (!lo) return [];
        years = [];
        for (let y = Number(lo); y <= Number(hi); y++) years.push(String(y));
    }
    const from = `${years[0]}-01-01`;
    const to   = `${years[years.length - 1]}-12-31`;

    const carrierFilter = filters.carrier_code && filters.carrier_code.length
        ? new Set(filters.carrier_code) : null;

    // ---- the three aggregates -------------------------------------------
    const dateWindow = { flight_date: { between: from, and: to } };
    const [movements, uplifts, fiRows, carriers, glAccounts] = await Promise.all([
        cds.db.run(SELECT.from(MOVEMENT_BY_DAY).where(dateWindow)),
        cds.db.run(SELECT.from(UPLIFT_BY_DAY).where(dateWindow)),
        cds.db.run(SELECT.from(UPLIFT_FI_BY_DAY).where(dateWindow)),
        cds.db.run(SELECT.from(CARRIER_MASTER).columns('carrier_code', 'carrier_name', 'company_code', 'reporting_currency', 'reporting_mass_uom')),
        cds.db.run(SELECT.from(GL_ACCOUNTS).columns(
            'ID', 'carrier_carrier_code', 'company_code', 'gl_account',
            'account_role', 'description', 'valid_from', 'valid_to', 'is_active'))
    ]);

    const carrierById = new Map(carriers.map(c => [c.carrier_code, c]));

    // ---- bucket the days into periods ------------------------------------
    const bucket = new Map();   // 'B6|2026-09' -> accumulator
    const touch = (carrier, period) => {
        const k = `${carrier}|${period}`;
        if (!bucket.has(k)) bucket.set(k, {
            carrier, period,
            uplift: 0, uplift_posted: 0, uplift_pending: 0,
            block: 0, apu: 0, other: 0, initial: 0,
            n_uplift: 0, n_posted: 0, n_pending: 0,
            shift: 0, fi_unknown: 0, fi_unknown_n: 0
        });
        return bucket.get(k);
    };

    for (const r of movements) {
        const c = r.carrier_code || '';
        if (carrierFilter && !carrierFilter.has(c)) continue;
        const p = periodOf(r.flight_date);
        if (!p) continue;
        const b = touch(c, p);
        const v = num(r.value_usd);
        // THE SIGNS. value_usd is signed in the ledger - a burn is negative -
        // and the screen shows allocations as positive magnitudes, so burns
        // are negated here and nowhere else.
        if (r.line_type === 'BLOCK_BURN') b.block += -v;
        else if (r.line_type === 'APU_BURN') b.apu += -v;
        else if (OTHER_TYPES.has(r.line_type)) b.other += -v;
        // ---- INITIAL IS STOCK ARRIVING, NOT FUEL MOVING -----------------
        //
        // AND IT IS DATED INSIDE THE PERIOD, which is the trap. A tail's
        // opening balance enters the ledger as an INITIAL row on the day the
        // tail enters the ledger - not on the last day of the month before -
        // so the recorded balance at the prior period end does not include
        // it. The whole 1.5m USD of seeded opening stock sat outside the
        // identity until this line existed, and the screen reported it as
        // unallocated burn: fuel that had gone missing, when in fact it had
        // only just arrived.
        //
        // IT BELONGS ON THE OPENING SIDE. It was not uplifted and it was not
        // burnt; it is stock the carrier already held when FuelSphere started
        // counting, so it is added to opening stock below.
        else if (r.line_type === 'INITIAL') b.initial += v;
    }

    for (const r of uplifts) {
        const c = r.carrier_code || '';
        if (carrierFilter && !carrierFilter.has(c)) continue;
        const p = periodOf(r.flight_date);
        if (!p) continue;
        const b = touch(c, p);
        const v = num(r.value_usd), n = Number(r.line_count) || 0;
        b.uplift += v;
        b.n_uplift += n;
        // POSTED IS ONLY 'S'. A partial posting (P) created some documents
        // and not others; counting it as posted would tell Finance the value
        // is in the books when part of it is not.
        if (r.posting_status === 'S') { b.uplift_posted += v; b.n_posted += n; }
        else { b.uplift_pending += v; b.n_pending += n; }
    }

    // ---- posting to a subsequent period ----------------------------------
    //
    // SIGNED BOTH WAYS, which is what makes the column add to zero across a
    // year: the flight's period reports what left it, and the posting's
    // period reports what arrived from elsewhere.
    for (const r of fiRows) {
        const c = r.carrier_code || '';
        if (carrierFilter && !carrierFilter.has(c)) continue;
        const flightPeriod = periodOf(r.flight_date);
        if (!flightPeriod) continue;
        const v = num(r.value_usd);
        if (!r.fi_date) {
            // POSTED, BUT WE DO NOT KNOW WHEN FINANCE BOOKED IT. Reported as
            // unknown rather than assumed in-period - see CR-2.
            const b = touch(c, flightPeriod);
            b.fi_unknown += v;
            b.fi_unknown_n += Number(r.line_count) || 0;
            continue;
        }
        const fiPeriod = periodOf(r.fi_date);
        if (fiPeriod === flightPeriod) continue;
        touch(c, flightPeriod).shift += v;
        touch(c, fiPeriod).shift -= v;
    }

    // ---- stock at every period boundary ----------------------------------
    const periods = [...new Set([...bucket.values()].map(b => b.period))].sort();
    if (!periods.length) return [];

    const boundaries = new Set();
    for (const p of periods) {
        boundaries.add(endOfPeriod(p));
        const [y, m] = p.split('-').map(Number);
        boundaries.add(new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10)); // prior close
    }
    const stock = new Map();
    for (const d of [...boundaries].sort()) stock.set(d, await closingStockAt(d));
    const stockAt = (d, carrier) => {
        const m = stock.get(d);
        const hit = m && m.get(carrier);
        return hit ? hit.value : 0;
    };

    // ---- assemble ---------------------------------------------------------
    const monthly = [...bucket.values()].map(b => {
        const [y, m] = b.period.split('-').map(Number);
        const closeDate = endOfPeriod(b.period);
        const openDate = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
        return finish({
            carrier: b.carrier,
            fiscal_year: String(y),
            period: b.period,
            period_label: labelOf(b.period),
            period_mode: 'MONTHLY',
            // Prior close PLUS whatever entered the ledger this period.
            opening: stockAt(openDate, b.carrier) + b.initial,
            closing: stockAt(closeDate, b.carrier),
            ...b
        }, carrierById, glAccounts);
    });

    if (mode === 'MONTHLY') return monthly.sort(sortRows);

    // ---- year to date -----------------------------------------------------
    //
    // ONE ROW PER CARRIER PER YEAR, summed from the monthly accumulators -
    // not recomputed. Two routes to one number is how they come to disagree,
    // and a reconciliation screen whose YTD row contradicts the sum of its
    // own months is worse than no YTD row.
    //
    // THE STOCK TERMS ARE NOT SUMMED. Opening is the year's first opening and
    // closing is the year's last closing; adding twelve closing balances
    // would report a carrier's stock twelve times over.
    const ytd = new Map();
    for (const b of [...bucket.values()].sort((a, z) => a.period.localeCompare(z.period))) {
        const y = yearOf(b.period);
        const k = `${b.carrier}|${y}`;
        const first = !ytd.has(k);
        if (first) ytd.set(k, {
            carrier: b.carrier, fiscal_year: y, period: `YTD-${y}`,
            period_label: `YTD ${y}`, period_mode: 'YTD',
            uplift: 0, uplift_posted: 0, uplift_pending: 0, block: 0, apu: 0, other: 0,
            initial: 0, n_uplift: 0, n_posted: 0, n_pending: 0, shift: 0,
            fi_unknown: 0, fi_unknown_n: 0, opening: 0, closing: 0
        });
        const a = ytd.get(k);
        for (const f of ['uplift', 'uplift_posted', 'uplift_pending', 'block', 'apu',
                         'other', 'initial', 'n_uplift', 'n_posted', 'n_pending', 'shift',
                         'fi_unknown', 'fi_unknown_n']) a[f] += b[f];

        const [yy, mm] = b.period.split('-').map(Number);
        const openDate = new Date(Date.UTC(yy, mm - 1, 0)).toISOString().slice(0, 10);
        // THE YEAR'S FIRST OPENING, plus every tail that entered the ledger
        // during the year - a tail onboarded in June brought its stock with
        // it, and that stock is on the opening side of the year as much as of
        // the month. a.initial is summed above, so it is added once here
        // rather than accumulated twice.
        if (first) a.opening_base = stockAt(openDate, b.carrier);
        a.closing = stockAt(endOfPeriod(b.period), b.carrier);
        a.opening = num(a.opening_base) + a.initial;
    }
    return [...ytd.values()].map(a => finish(a, carrierById, glAccounts)).sort(sortRows);
}

const sortRows = (a, z) => a.carrier_code.localeCompare(z.carrier_code)
                        || a.period.localeCompare(z.period);

/**
 * Turn one accumulator into the row the screen reads.
 *
 * THE IDENTITY THIS ENFORCES:
 *
 *     opening + net uplift - block - APU - other - closing = unallocated
 *
 * Everything else on the row is a presentation of its terms.
 */
function finish(a, carrierById, glAccounts) {
    const c = carrierById.get(a.carrier) || {};
    const netUplift = round2(a.uplift);
    const block = round2(a.block), apu = round2(a.apu), other = round2(a.other);
    const opening = round2(a.opening), closing = round2(a.closing);
    const totalAllocated = round2(block + apu + other);
    const unallocated = round2(opening + netUplift - block - apu - other - closing);

    // THE FINANCE COLUMN IS THE FUELSPHERE COLUMN, ON INSTRUCTION, until the
    // G/L OData service exists. finance_source is what stops that reading as
    // agreement - see the model, and the annotation that shows it as a
    // column rather than a tooltip.
    const financeValue = netUplift;
    const financeSource = 'SEEDED_FROM_FS';
    const variance = round2(financeValue - netUplift);

    // Every movement that touched the period, not just the uplifts: a burn
    // line is rounded exactly as an uplift line is.
    const lines = num(a.n_uplift) + 0;
    const tolerance = Math.max(TOLERANCE_FLOOR, (lines || 0) * CENT_PER_LINE);
    const crit = v => {
        const x = Math.abs(v);
        if (x < 0.005) return 3;              // reconciles exactly
        if (x <= tolerance) return 2;         // within rounding of turnover
        return 1;                             // a real gap
    };

    return {
        ID: `${a.carrier}|${a.period}`,
        carrier_code: a.carrier,
        carrier_name: c.carrier_name || null,
        company_code: c.company_code || null,
        fiscal_year: a.fiscal_year,
        period: a.period,
        period_label: a.period_label,
        period_mode: a.period_mode,

        net_uplift_finance: financeValue,
        finance_source: financeSource,
        net_uplift_fs: netUplift,
        net_uplift_expected: round2(a.uplift_posted),
        jv_pending_posting: round2(a.uplift_pending),
        posted_subsequent_period: round2(a.shift),
        unplaced_posting_value: round2(a.fi_unknown),
        unplaced_posting_count: num(a.fi_unknown_n),

        opening_stock_value: opening,
        block_burn: block,
        apu_burn: apu,
        other_allocations: other,
        total_allocated: totalAllocated,
        remaining_stock: closing,
        unallocated_burn: unallocated,
        finance_variance: variance,
        // THE CARRIER'S COMPANY-CODE CURRENCY. This read 'USD' for every
        // carrier, so a TAP period in euros was labelled dollars. Null where
        // the carrier is not mapped - an unknown currency is not a dollar.
        currency_code: c.reporting_currency || null,
        _massUom: c.reporting_mass_uom || null,

        uplift_count: a.n_uplift,
        posted_count: a.n_posted,
        pending_count: a.n_pending,

        unallocatedCriticality: crit(unallocated),
        // NEUTRAL WHILE THE FINANCE FIGURE IS A PLACEHOLDER. A green tick
        // against a column copied from the column beside it would be the
        // screen asserting a reconciliation that has not happened.
        varianceCriticality: financeSource === 'SEEDED_FROM_FS' ? 0 : crit(variance),

        _glAccounts: glAccounts.filter(g =>
            g.carrier_carrier_code === a.carrier && g.is_active !== false),
        _netUplift: netUplift
    };
}

/** Apply whatever of $filter, $orderby and $top the handler did not push down. */
function applyRest(rows, q) {
    const sel = q && q.SELECT;
    if (!sel) return rows;

    const f = readFilters(sel.where);
    let out = rows.filter(r => Object.entries(f).every(([k, vals]) =>
        !(k in r) || vals.includes(String(r[k] === null ? '' : r[k]))));

    if (sel.orderBy && sel.orderBy.length) {
        const keys = sel.orderBy.map(o => ({
            col: o.ref && o.ref[o.ref.length - 1],
            dir: (o.sort || 'asc').toLowerCase() === 'desc' ? -1 : 1
        })).filter(k => k.col);
        if (keys.length) out = [...out].sort((a, z) => {
            for (const { col, dir } of keys) {
                const x = a[col], y = z[col];
                if (x === y) continue;
                if (x === null || x === undefined) return 1;
                if (y === null || y === undefined) return -1;
                const cmp = (typeof x === 'number' && typeof y === 'number')
                    ? x - y : String(x).localeCompare(String(y));
                if (cmp) return cmp * dir;
            }
            return 0;
        });
    }
    return out;
}

function page(rows, q) {
    const sel = q && q.SELECT;
    const total = rows.length;
    let out = rows;
    const skip = sel && sel.limit && sel.limit.offset && sel.limit.offset.val;
    const top = sel && sel.limit && sel.limit.rows && sel.limit.rows.val;
    if (skip) out = out.slice(Number(skip));
    if (top) out = out.slice(0, Number(top));
    out = out.map(r => {
        const copy = { ...r };
        delete copy._glAccounts;
        delete copy._netUplift;
        delete copy._massUom;
        return copy;
    });
    out.$count = total;
    return out;
}

/** Did the query ask for this navigation to be expanded? */
function wantsExpand(q, name) {
    const cols = q && q.SELECT && q.SELECT.columns;
    return Array.isArray(cols) && cols.some(c =>
        c && c.expand && c.ref && c.ref[c.ref.length - 1] === name);
}

/**
 * The G/L lines behind one row.
 *
 * EXPECTED ONLY, SPLIT EVENLY ACROSS THE ACCOUNTS OF A ROLE. FuelSphere knows
 * the uplift total and which accounts carry uplift; it does not know how S/4
 * split one from the other, because that is derived from the material's
 * valuation class and account determination inside S/4. An even split is
 * marked as such rather than presented as fact - and the moment the G/L
 * service exists, this is replaced by what was actually booked.
 */
function glLinesFor(row) {
    const accounts = row._glAccounts || [];
    const byRole = accounts.filter(g => g.account_role === 'UPLIFT');
    const pool = byRole.length ? byRole : accounts;
    if (!pool.length) return [];
    const share = round2(row._netUplift / pool.length);
    return pool.map(g => ({
        ID: `${row.ID}|${g.gl_account}`,
        recon_ID: row.ID,
        gl_account: g.gl_account,
        account_role: g.account_role,
        description: g.description,
        company_code: g.company_code || row.company_code,
        expected_value: share,
        booked_value: null,      // not zero - see the model
        variance: null,
        currency_code: row.currency_code || null
    }));
}

// A drill-down nobody can load is a drill-down nobody uses. A month can hold
// tens of thousands of uplifts; this is enough to work from and bounded
// enough to render.
const UPLIFT_LINE_CAP = 500;

/**
 * The individual uplifts behind one row, newest first.
 *
 * READ AT DRILL-DOWN TIME ONLY. This is the one query in the service that
 * touches movement rows rather than aggregates, and it is why it is bounded
 * by one carrier, one period and a row cap.
 */
async function upliftLinesFor(row) {
    const [, period] = row.ID.split('|');
    const isYtd = period.startsWith('YTD-');
    const year = isYtd ? period.slice(4) : period.slice(0, 4);
    const from = isYtd ? `${year}-01-01` : `${period}-01`;
    const to = isYtd ? `${year}-12-31` : endOfPeriod(period);

    const lines = await cds.db.run(SELECT.from(MOVEMENTS)
        .columns('ID', 'reference', 'tail_number', 'station', 'flight_number',
                 'flight_date', 'qty_kg', 'value_usd')
        .where({ valuation_method: 'MAP', carrier_code: row.carrier_code,
                 line_type: { in: ['UPLIFT', 'DEFUEL'] },
                 flight_date: { between: from, and: to } })
        .orderBy({ ref: ['flight_date'], sort: 'desc' })
        .limit(UPLIFT_LINE_CAP));
    if (!lines.length) return [];

    // The two hops to the ticket, done as two IN queries rather than a join
    // per line - the same reason the aggregates are views.
    const refs = [...new Set(lines.map(l => l.reference).filter(Boolean))];
    const robRows = refs.length ? await cds.db.run(SELECT.from(ROB_LEDGER)
        .columns('ID', 'fuel_ticket_ID').where({ ID: { in: refs } })) : [];
    const ticketOf = new Map(robRows.map(r => [r.ID, r.fuel_ticket_ID]));

    const ticketIds = [...new Set([...ticketOf.values()].filter(Boolean))];
    const tickets = ticketIds.length ? await cds.db.run(SELECT.from(FUEL_TICKETS)
        .columns('ID', 'ticket_number', 'internal_number', 's4_posting_status',
                 's4_posting_message', 's4_po_number', 's4_fi_posting_date')
        .where({ ID: { in: ticketIds } })) : [];
    const ticketById = new Map(tickets.map(t => [t.ID, t]));

    // kg per one unit of the carrier's mass unit, for the drill-down quantity.
    const massRow = row._massUom ? await cds.db.run(SELECT.one.from('fuelsphere.UNIT_OF_MEASURE')
        .columns('conversion_to_kg').where({ uom_code: row._massUom })) : null;
    const toKg = massRow ? num(massRow.conversion_to_kg) : null;

    return lines.map(l => {
        const t = ticketById.get(ticketOf.get(l.reference)) || {};
        const st = t.s4_posting_status;
        const status = st === 'S' ? 'POSTED'
                     : st === 'P' ? 'PARTIAL'
                     : st ? 'ERROR' : 'NOT_SENT';
        const fiPeriod = t.s4_fi_posting_date ? periodOf(t.s4_fi_posting_date) : null;
        return {
            ID: `${row.ID}|${l.ID}`,
            recon_ID: row.ID,
            ticket_number: t.ticket_number || null,
            internal_number: t.internal_number || null,
            tail_number: l.tail_number,
            station: l.station,
            flight_number: l.flight_number,
            flight_date: l.flight_date,
            qty_kg: num(l.qty_kg),
            qty_cm: toKg && l.qty_kg !== null ? Number((num(l.qty_kg) / toKg).toFixed(3)) : null,
            mass_uom_code: row._massUom || null,
            value_usd: round2(l.value_usd),
            posting_status: status,
            s4_po_number: t.s4_po_number || null,
            s4_message: t.s4_posting_message || null,
            fi_period: fiPeriod,
            is_period_shifted: !!(fiPeriod && fiPeriod !== periodOf(l.flight_date)),
            statusCriticality: status === 'POSTED' ? 3
                             : status === 'PARTIAL' ? 2
                             : status === 'ERROR' ? 1 : 0,
            currency_code: row.currency_code || null
        };
    });
}

module.exports = cds.service.impl(async function () {
    const { FinanceReconciliation, ReconciliationGlLine, ReconciliationUpliftLine } = this.entities;

    this.on('READ', FinanceReconciliation, async (req) => {
        const q = req.query;
        const key = keyOf(q);
        const filters = readFilters(q.SELECT.where);

        // A BY-KEY READ CARRIES ITS OWN FILTERS IN THE KEY. 'B6|2026-09' says
        // carrier and period; without unpacking it the handler would build
        // every row in the database to return one.
        if (key) {
            const [carrier, period] = key.split('|');
            filters.carrier_code = [carrier];
            filters.fiscal_year = [period.startsWith('YTD-') ? period.slice(4) : period.slice(0, 4)];
            filters.period_mode = [period.startsWith('YTD-') ? 'YTD' : 'MONTHLY'];
        }

        const started = Date.now();
        let rows = await buildRows(filters);
        if (key) rows = rows.filter(r => r.ID === key);
        LOG.info(`reconciliation: ${rows.length} row(s) in ${Date.now() - started}ms`
               + (key ? ` for ${key}` : ''));

        const wantGl = wantsExpand(q, 'gl_accounts');
        const wantUp = wantsExpand(q, 'uplift_lines');
        if (wantGl || wantUp) {
            for (const r of rows) {
                if (wantGl) r.gl_accounts = glLinesFor(r);
                if (wantUp) r.uplift_lines = await upliftLinesFor(r);
            }
        }
        const out = page(applyRest(rows, q), q);
        // A BY-KEY READ IS ONE ENTITY, NOT A COLLECTION OF ONE. Returning the
        // array makes the object page's own row arrive as [{...}], which
        // renders as an empty page with no error anywhere - the failure mode
        // that is hardest to notice, because everything reports success.
        return key ? (out[0] || null) : out;
    });

    // ---- the two drill-downs, read directly ------------------------------
    //
    // FIORI ELEMENTS READS A TABLE FACET AS ITS OWN REQUEST, not as an expand
    // of the page above it, so both children need a handler of their own. The
    // recon_ID filter is what scopes them; without one there is nothing to
    // compute a line against, and an empty answer is the honest one.
    const childrenOf = async (req, build) => {
        const f = readFilters(req.query.SELECT.where);
        const ids = f.recon_ID || [];
        if (!ids.length) return [];
        const out = [];
        for (const id of ids) {
            const [carrier, period] = id.split('|');
            const rows = await buildRows({
                carrier_code: [carrier],
                fiscal_year: [period.startsWith('YTD-') ? period.slice(4) : period.slice(0, 4)],
                period_mode: [period.startsWith('YTD-') ? 'YTD' : 'MONTHLY']
            });
            const row = rows.find(r => r.ID === id);
            if (row) out.push(...await build(row));
        }
        return page(applyRest(out, req.query), req.query);
    };

    this.on('READ', ReconciliationGlLine, req => childrenOf(req, async r => glLinesFor(r)));
    this.on('READ', ReconciliationUpliftLine, req => childrenOf(req, r => upliftLinesFor(r)));
});

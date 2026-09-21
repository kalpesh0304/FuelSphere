/**
 * FuelSphere - Invoice pre-posting validation (WP-21A)
 *
 * InvoiceService declared 27 actions and implemented none. This implements the
 * VALIDATION AND EXCEPTION PATH ONLY — run the registered checks, raise
 * exceptions, gate posting, bypass a soft error, derive the header totals.
 *
 * THE DIVISION OF LABOUR. FuelSphere does not match; SAP does, at MIRO, and
 * its verdict is definitive. What FuelSphere does is make the MIRO call
 * succeed first time, because MIRO is the wrong place to discover that a fuel
 * ticket resolves to nothing — the ticket, the delivery and the price
 * components do not live there.
 *
 * TWO PRINCIPLES RUN THROUGH EVERY HANDLER HERE.
 *
 * CAPTURE IS NEVER BLOCKED. An invoice with fifteen hard errors is captured,
 * with fifteen exceptions against it. POSTING is gated, not capture. An
 * uncaptured invoice is a supplier claim nobody can see.
 *
 * A REJECTION IS A SUCCESSFUL REQUEST. Measured under WP-20: req.error rolls
 * the transaction back, and both documented escapes deadlock. So a run that
 * finds fifteen errors returns 200 with the outcome in the payload. Failing
 * the request would discard the very exceptions it was asked to record.
 */

const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE, DELETE } = cds.ql;
const C = require('./lib/invoice-checks');
const { applyHeaderSummary, applyLineSummary } = require('./lib/invoice-summary');

const _id = (params) => {
    const p = params[params.length - 1];
    return typeof p === 'object' ? p.ID : p;
};
const today = () => new Date().toISOString().slice(0, 10);

module.exports = class InvoiceService extends cds.ApplicationService {
    async init() {

        const { Invoices, InvoiceExceptions, InvoiceItems } = this.entities;

        // ================================================================
        // WP-36 / WP-37 - THE HEADER AND LINE ITEM VIEWS.
        //
        // On the DRAFT as well as the active entity, and that is not
        // optional. Invoices is draft-enabled and InvoiceItems is its
        // composition child, so both have a .drafts twin. A virtual whose
        // handler runs on only one of the pair comes back ABSENT from the
        // other - not null, absent - and Fiori then fails to drill into a
        // property it was told to render, leaving the page spinning with no
        // error the user can see. That exact bug hit three services earlier
        // in this project.
        // ================================================================
        this.after(['READ'], [Invoices, Invoices.drafts], async (data) => {
            await applyHeaderSummary(data);
        });
        this.after(['READ'], [InvoiceItems, InvoiceItems.drafts], async (data) => {
            await applyLineSummary(data);
        });

        // ================================================================
        // THE VALIDATION RUN
        // ================================================================

        /**
         * Persist a run's outcome and compute the gate.
         *
         * Open exceptions for this invoice are replaced, not accumulated: a
         * re-run is a fresh opinion on the current data. A BYPASSED exception
         * SURVIVES — somebody made a judgement about it, and re-running the
         * check must not quietly erase that. If the check no longer fires the
         * bypass becomes irrelevant, but the record of it does not.
         */
        const persist = async (invoice, result, user) => {
            const prior = await SELECT.from('fuelsphere.INVOICE_EXCEPTIONS')
                .where({ invoice_ID: invoice.ID });
            const bypassed = prior.filter(p => p.status === 'BYPASSED');
            const bypassedCodes = new Set(bypassed.map(p => `${p.check_code}|${p.invoice_item_ID || ''}`));

            // Everything not bypassed is cleared out and re-raised.
            const toDelete = prior.filter(p => p.status !== 'BYPASSED').map(p => p.ID);
            if (toDelete.length) {
                await DELETE.from('fuelsphere.INVOICE_EXCEPTIONS').where({ ID: { in: toDelete } });
            }

            const now = new Date().toISOString();
            const rows = [];
            for (const e of result.exceptions) {
                const key = `${e.check_code}|${e.invoice_item_ID || ''}`;
                if (bypassedCodes.has(key)) continue;   // still bypassed, not re-raised
                rows.push({
                    ID: cds.utils.uuid(),
                    invoice_ID: invoice.ID,
                    invoice_item_ID: e.invoice_item_ID,
                    line_number: e.line_number,
                    check_code: e.check_code,
                    check_group: e.check_group,
                    severity: e.severity,
                    severity_source: e.severity_source,
                    message: e.message,
                    observed_value: e.observed_value,
                    expected_value: e.expected_value,
                    variance_value: e.variance_value,
                    variance_pct: e.variance_pct,
                    threshold_crossed: e.threshold_crossed,
                    tolerance_rule_ID: e.tolerance_rule_ID,
                    status: 'OPEN',
                    is_gating: e.is_gating,
                    detected_at: now,
                    detected_by: user
                });
            }
            if (rows.length) await INSERT.into('fuelsphere.INVOICE_EXCEPTIONS').entries(rows);

            // ============================================================
            // THE RULE STATUSES — one row per applicable rule, INCLUDING
            // the ones that produced nothing.
            //
            // Replaced wholesale on every run, unlike the exceptions above,
            // and for the opposite reason. An exception survives because a
            // BYPASS is a judgement somebody made about it. A verdict is
            // the OUTCOME OF THIS RUN and has nothing to preserve: keeping
            // a stale one would say a rule was evaluated at a time it was
            // not, which is the claim this table exists to make honest.
            //
            // The bypass is reflected onto the verdict rather than kept in
            // it: a clerk scanning twenty-two rows should not have to join
            // to learn that one of the reds was released.
            // ============================================================
            await DELETE.from('fuelsphere.IDR_RULE_STATUS').where({ invoice_ID: invoice.ID });

            const regRows = await SELECT.from('fuelsphere.INVOICE_CHECK_REGISTRY')
                .columns('ID', 'check_code');
            const regByCode = new Map(regRows.map(r => [r.check_code, r.ID]));

            // A FAILED verdict points AT its exception rather than restating
            // it. Bypassed exceptions were never re-raised above, so their
            // key is looked up among the survivors.
            const excByKey = new Map();
            for (const r of rows) excByKey.set(`${r.check_code}|${r.invoice_item_ID || ''}`, r);
            const bypassByKey = new Map();
            for (const b of bypassed) bypassByKey.set(`${b.check_code}|${b.invoice_item_ID || ''}`, b);

            const statusRows = (result.verdicts || []).map(v => {
                const k = `${v.check_code}|${v.invoice_item_ID || ''}`;
                const byp = bypassByKey.get(k);
                const exc = excByKey.get(k) || byp || null;
                return {
                    ID: cds.utils.uuid(),
                    invoice_ID: invoice.ID,
                    rule_ID: regByCode.get(v.check_code) || null,
                    check_code: v.check_code,
                    check_group: v.check_group,
                    invoice_item_ID: v.invoice_item_ID,
                    line_number: v.line_number,
                    // A rule whose exception is bypassed is BYPASSED, not
                    // FAILED. It is still true and someone accepted it -
                    // the same distinction ExceptionStatus makes in words.
                    status: byp ? 'BYPASSED' : v.status,
                    severity: (exc && exc.severity) || v.severity || null,
                    severity_source: (exc && exc.severity_source) || v.severity_source || null,
                    na_reason: v.na_reason,
                    exception_ID: exc ? exc.ID : null,
                    message: byp ? byp.message : v.message,
                    evaluated_at: now,
                    evaluated_by: user,
                    bypassed_by: byp ? byp.modified_by || byp.created_by : null,
                    bypassed_at: byp ? byp.modified_at : null,
                    bypass_reason: byp ? byp.cleared_reason : null
                };
            });
            if (statusRows.length) {
                await INSERT.into('fuelsphere.IDR_RULE_STATUS').entries(statusRows);
            }

            const count = (st) => statusRows.filter(r => r.status === st).length;
            const counters = {
                rules_evaluated:      statusRows.length,
                rules_passed:         count('PASSED'),
                rules_failed:         count('FAILED'),
                rules_bypassed:       count('BYPASSED'),
                rules_not_applicable: count('NOT_APPLICABLE')
            };

            // The gate counts what is OPEN. A bypassed exception is still
            // true and still recorded — it simply no longer gates, which is
            // the whole point of a bypass.
            const open = rows;
            const hard = open.filter(r => r.severity === C.SEV.HARD).length;
            const soft = open.filter(r => r.severity === C.SEV.SOFT).length;
            const warn = open.filter(r => r.severity === C.SEV.WARNING).length;
            const gate = (hard + soft) > 0 ? 'GATED' : 'CLEAR';

            await UPDATE('fuelsphere.INVOICES').set({
                // INV454: derived from lines, never keyed from the document.
                net_amount: result.derived.net_amount,
                tax_amount: result.derived.tax_amount,
                gross_amount: result.derived.gross_amount,
                posting_gate: gate,
                gate_evaluated_at: now,
                open_hard_count: hard,
                open_soft_count: soft,
                warning_count: warn,

                // THE FIVE, AND THEY COUNT A DIFFERENT THING FROM THE THREE
                // ABOVE. Those count OPEN EXCEPTIONS; these count RULES
                // EVALUATED. rules_passed and rules_not_applicable have no
                // counterpart in the three, because a rule that passed and a
                // rule that never ran both leave no exception behind - which
                // is the whole reason IDR_RULE_STATUS exists.
                ...counters
            }).where({ ID: invoice.ID });

            return { rows, hard, soft, warn, gate, bypassedKept: bypassed.length,
                     statusRows, counters };
        };

        /** Write back what the resolution produced, so it is re-explainable. */
        const persistResolution = async (result) => {
            for (const [itemId, res] of result.resolutions) {
                const t = res.ticket || null;

                // WP-35 - WHAT THE TICKET SAID, captured at match time.
                //
                // Held on the line rather than read through the association
                // on every view, so the figure a variance was computed FROM
                // survives a later correction to the ticket. Written as null
                // when the line no longer resolves, so a re-run that loses its
                // match clears the old figures instead of keeping stale ones
                // beside a ticket it no longer points at.
                const tktKg  = t && t.quantity_kg  != null ? Number(t.quantity_kg)  : null;
                const tktAmt = t && t.total_amount != null ? Number(t.total_amount) : null;
                const tktRate = (tktKg && tktAmt != null)
                    ? Number((tktAmt / tktKg).toFixed(4)) : null;

                // The flight goes on the LINE - decision Q1. The ticket's own
                // association where it has one; otherwise its flight number on
                // its delivery date, the key FLIGHT_DISPATCH already matches
                // on. Number alone would attach a recurring flight to the
                // wrong day, so an ambiguous match writes nothing.
                let flightId = t ? (t.flight_ID || null) : null;
                if (t && !flightId && t.flight_number) {
                    const day = t.delivery_timestamp ? String(t.delivery_timestamp).slice(0, 10) : null;
                    const where = day ? { flight_number: t.flight_number, flight_date: day }
                                      : { flight_number: t.flight_number };
                    const hits = await SELECT.from('fuelsphere.FLIGHT_SCHEDULE')
                        .columns('ID').where(where);
                    if (hits.length === 1) flightId = hits[0].ID;
                }

                await UPDATE('fuelsphere.INVOICE_ITEMS').set({
                    ticket_ID: (t && t.ID) || null,
                    resolved_po_number: res.resolved_po_number,
                    resolved_gr_number: res.resolved_gr_number,
                    resolution_source: res.resolution_source,
                    ticket_quantity_kg: tktKg,
                    ticket_amount: tktAmt,
                    ticket_rate: tktRate,
                    flight_ID: flightId
                }).where({ ID: itemId });
            }
        };

        const toPayload = (e, ruleCodes) => ({
            checkCode: e.check_code,
            checkGroup: e.check_group,
            severity: e.severity,
            severitySource: e.severity_source,
            isGating: e.is_gating,
            isBypassable: e._bypassable === true,
            lineNumber: e.line_number,
            message: e.message,
            observedValue: e.observed_value,
            expectedValue: e.expected_value,
            variancePct: e.variance_pct,
            thresholdCrossed: e.threshold_crossed,
            toleranceRuleCode: e.tolerance_rule_ID ? (ruleCodes.get(e.tolerance_rule_ID) || null) : null,
            rung: e._rung
        });

        const runValidation = async (req) => {
            const invoiceId = _id(req.params);
            const invoice = await SELECT.one.from('fuelsphere.INVOICES').where({ ID: invoiceId });
            if (!invoice) return req.error(404, `Invoice ${invoiceId} not found.`);

            const items = await SELECT.from('fuelsphere.INVOICE_ITEMS')
                .where({ invoice_ID: invoiceId }).orderBy('line_number');

            const supplier = invoice.supplier_ID
                ? await SELECT.one.from('fuelsphere.MASTER_SUPPLIERS').where({ ID: invoice.supplier_ID })
                : null;

            const result = await C.runChecks(invoice, items, {
                today: today(),
                companyCode: invoice.s4_company_code || null,
                supplierCategory: (supplier && supplier.supplier_type) || null,
                productType: null
            });

            await persistResolution(result);
            const p = await persist(invoice, result, req.user.id);

            const ruleRows = await SELECT.from('fuelsphere.TOLERANCE_RULES').columns('ID', 'rule_code');
            const ruleCodes = new Map(ruleRows.map(r => [r.ID, r.rule_code]));

            const unresolved = [...result.resolutions.values()].filter(r => r.failure).length;
            const raised = result.exceptions.filter(e =>
                !p.rows.length || p.rows.some(r => r.check_code === e.check_code
                    && (r.invoice_item_ID || '') === (e.invoice_item_ID || '')));

            return {
                success: true,          // THE RUN succeeded. The invoice may still be gated
                invoiceId,
                invoiceNumber: invoice.invoice_number,
                postingGate: p.gate,
                canPost: p.gate === 'CLEAR',
                checksRegistered: result.registrySize,
                checksSkipped: result.skipped.length,
                rulesEvaluated:     p.counters.rules_evaluated,
                rulesPassed:        p.counters.rules_passed,
                rulesFailed:        p.counters.rules_failed,
                rulesBypassed:      p.counters.rules_bypassed,
                rulesNotApplicable: p.counters.rules_not_applicable,
                exceptionsRaised: p.rows.length,
                hardErrors: p.hard,
                softErrors: p.soft,
                warnings: p.warn,
                derivedNetAmount: result.derived.net_amount,
                derivedGrossAmount: result.derived.gross_amount,
                derivedLineCount: result.derived.line_count,
                statedNetAmount: invoice.stated_net_amount,
                linesResolved: items.length - unresolved,
                linesUnresolved: unresolved,
                exceptions: raised.map(e => toPayload(e, ruleCodes)),
                message: p.gate === 'CLEAR'
                    ? `${invoice.invoice_number} captured and CLEAR. `
                    + `${result.registrySize} check(s) registered, ${p.warn} warning(s), nothing gating.`
                    : `${invoice.invoice_number} CAPTURED and GATED: ${p.hard} hard, ${p.soft} soft, `
                    + `${p.warn} warning(s) across ${items.length} line(s). `
                    + `The invoice is recorded in full; only POSTING is held.`
                    + (p.bypassedKept ? ` ${p.bypassedKept} bypassed exception(s) retained.` : '')
            };
        };

        // ================================================================
        // UNBILLED TICKETS — the age, and why it is computed here
        // ================================================================
        //
        // days_between() COMPILED CLEAN IN THE VIEW AND DID NOT SERVE: it is
        // a HANA function SQLite does not implement, so every read of the
        // entity returned 500. julianday() serves on SQLite and would fail on
        // HANA - worse, because it passes here and breaks in production.
        //
        // So the number is filled after READ. THE COST, STATED: a virtual
        // element cannot be $filtered or sorted on, because both run in the
        // database before this handler sees a row. The screen sorts on
        // delivery_timestamp instead, which is the SAME ORDER - oldest first
        // - and needs no function. Anyone adding an age filter has to move
        // this into the view, and that means finding a portable expression
        // rather than moving the handler.
        // AND THE SOURCE COLUMN HAS TO BE FETCHED, OR THE HANDLER COMPUTES
        // NOTHING. Measured: $select=age_days without delivery_timestamp
        // returned rows with no age at all - the after-READ handler had
        // nothing to subtract from and silently skipped every row. A virtual
        // element depends on a real one, and a client that does not ask for
        // the real one gets a blank column with no error.
        this.before('READ', 'UnbilledTickets', (req) => {
            const cols = req.query.SELECT && req.query.SELECT.columns;
            if (!cols) return;                                  // SELECT * already has it
            const has = (n) => cols.some(c => c.ref && c.ref[c.ref.length - 1] === n);
            if (has('age_days') && !has('delivery_timestamp')) cols.push({ ref: ['delivery_timestamp'] });
        });

        this.after('READ', 'UnbilledTickets', (rows) => {
            const now = Date.now();
            for (const r of (Array.isArray(rows) ? rows : [rows])) {
                if (!r || !r.delivery_timestamp) continue;
                r.age_days = Math.floor((now - new Date(r.delivery_timestamp).getTime()) / 86400000);
            }
        });

        this.on('validateForPosting', Invoices, runValidation);

        // executeThreeWayMatch is the DECLARED name and renaming a declared
        // action is forbidden (rules of engagement). It runs the same
        // pre-posting checks and says plainly in its result that FuelSphere
        // has not matched anything — SAP does that at MIRO.
        this.on('executeThreeWayMatch', Invoices, async (req) => {
            const out = await runValidation(req);
            if (!out || !out.success) return out;
            return { ...out, message:
                `PRE-POSTING VALIDATION ONLY — FuelSphere does not perform the three-way match; `
              + `SAP does, at MIRO. ${out.message}` };
        });

        // ================================================================
        // DUPLICATES — their own pass, on purpose
        // ================================================================
        this.on('checkDuplicate', Invoices, async (req) => {
            const invoiceId = _id(req.params);
            const invoice = await SELECT.one.from('fuelsphere.INVOICES').where({ ID: invoiceId });
            if (!invoice) return req.error(404, `Invoice ${invoiceId} not found.`);
            const items = await SELECT.from('fuelsphere.INVOICE_ITEMS')
                .where({ invoice_ID: invoiceId }).orderBy('line_number');

            const registry = await C.loadRegistry(String(invoice.invoice_date || today()));
            const resolutions = new Map();
            for (const it of items) resolutions.set(it.ID, await C.resolveLine(it));

            const dups = await C.detectDuplicates(invoice, items, resolutions, registry);
            const original = dups.find(d => d.check_code === C.C.DUP_INVOICE_NUMBER);

            return {
                isDuplicate: dups.length > 0,
                originalInvoiceId: null,
                originalInvoiceNumber: original ? invoice.invoice_number : null,
                originalInvoiceDate: original ? invoice.invoice_date : null,
                supplierCode: null,
                message: dups.length
                    ? `${dups.length} duplicate finding(s) across three keys: `
                    + dups.map(d => `${d.check_code} ${d.message}`).join(' | ')
                    : `No duplicate on any of the three keys — invoice number and vendor, `
                    + `ticket number, or order and GR combination.`
            };
        });

        // ================================================================
        // HEADER TOTALS — INV454
        // ================================================================
        // ================================================================
        // POSTING AND PAYMENT - SIMULATED.
        //
        // Both were declared and never implemented, so neither did anything.
        // They are simulated here until the real S/4 integration (WP-29)
        // replaces them, and every message says so: a simulated document
        // number that reads as a real one is the kind of thing that ends up
        // quoted to a supplier.
        //
        // Numbers are derived from the invoice ID, not a counter. That makes
        // them stable - the same invoice always simulates to the same
        // document - and posting twice is refused below anyway.
        // ================================================================
        const simNo = (prefix, id, width) => {
            const h = require('crypto').createHash('sha1').update(String(id)).digest('hex');
            const digits = String(parseInt(h.slice(0, 12), 16)).slice(-width).padStart(width, '0');
            return prefix + digits;
        };

        this.on('postToS4HANA', Invoices, async (req) => {
            const invoiceId = _id(req.params);
            const inv = await SELECT.one.from('fuelsphere.INVOICES')
                .columns('ID', 'invoice_number', 'status', 'posting_gate', 'gross_amount',
                         'currency_code', 's4_company_code', 'received_date', 'created_at')
                .where({ ID: invoiceId });
            if (!inv) return req.error(404, 'Invoice not found.');
            if (inv.status === 'POSTED' || inv.status === 'PAID') {
                return req.error(409, `Invoice ${inv.invoice_number} is already `
                    + `${inv.status.toLowerCase()} and cannot be posted again.`);
            }
            if (inv.status === 'CANCELLED') {
                return req.error(409, `Invoice ${inv.invoice_number} is cancelled.`);
            }
            // THE GATE IS THE CONTROL. An invoice with an open gating exception
            // must not reach the ledger, simulated or not - a demo that posts
            // through a gate teaches the audience that the gate is decoration.
            if (inv.posting_gate !== 'CLEAR') {
                return req.error(409, `Invoice ${inv.invoice_number} cannot be posted: the `
                    + `posting gate is ${inv.posting_gate}. Run the checks and clear every `
                    + `gating exception first.`);
            }

            const today = new Date().toISOString().slice(0, 10);
            const year = today.slice(0, 4);
            const docNo = simNo('51', inv.ID, 8);
            const sapInvoiceNo = simNo('5105', inv.ID + ':inv', 6);
            const companyCode = inv.s4_company_code || '1000';
            await UPDATE('fuelsphere.INVOICES').set({
                status: 'POSTED',
                fi_posting_status: 'SUCCESS',
                s4_document_number: docNo,
                s4_fiscal_year: year,
                s4_company_code: companyCode,
                sap_invoice_number: sapInvoiceNo,
                posting_date: today,
                // Stamped only if nothing supplied one: when the record
                // reached FuelSphere is the truthful fallback, not today.
                received_date: inv.received_date
                    || (inv.created_at ? String(inv.created_at).slice(0, 10) : today)
            }).where({ ID: invoiceId });

            req.info(200, `Posted to S/4HANA (SIMULATED): FI document ${docNo}, `
                + `SAP invoice ${sapInvoiceNo}, posting date ${today}.`);
            return {
                success: true, invoiceId, invoiceNumber: inv.invoice_number,
                s4DocumentNumber: docNo, s4FiscalYear: year, s4CompanyCode: companyCode,
                postingDate: today, postedAmount: inv.gross_amount,
                currency: inv.currency_code,
                message: 'Simulated posting - no document was created in S/4HANA.'
            };
        });

        this.on('recordPayment', Invoices, async (req) => {
            const invoiceId = _id(req.params);
            const inv = await SELECT.one.from('fuelsphere.INVOICES')
                .columns('ID', 'invoice_number', 'status').where({ ID: invoiceId });
            if (!inv) return req.error(404, 'Invoice not found.');
            // Payment follows posting. Paying an unposted invoice would put a
            // clearing document against an FI document that does not exist.
            if (inv.status !== 'POSTED') {
                return req.error(409, `Only a posted invoice can be paid. `
                    + `Invoice ${inv.invoice_number} is ${inv.status}.`);
            }
            const today = new Date().toISOString().slice(0, 10);
            const payDoc = simNo('15', inv.ID + ':pay', 8);
            await UPDATE('fuelsphere.INVOICES').set({
                status: 'PAID', s4_payment_document: payDoc, payment_date: today
            }).where({ ID: invoiceId });
            req.info(200, `Payment recorded (SIMULATED): clearing document ${payDoc}, `
                + `payment date ${today}.`);
            return SELECT.one.from(Invoices).where({ ID: invoiceId });
        });

        this.on('recalculateTotals', Invoices, async (req) => {
            const invoiceId = _id(req.params);
            const items = await SELECT.from('fuelsphere.INVOICE_ITEMS').where({ invoice_ID: invoiceId });
            const d = C.deriveTotals(items);
            await UPDATE('fuelsphere.INVOICES').set({
                net_amount: d.net_amount, tax_amount: d.tax_amount, gross_amount: d.gross_amount
            }).where({ ID: invoiceId });
            req.info(200, `Totals derived from ${d.line_count} line(s): net ${d.net_amount}, `
                        + `tax ${d.tax_amount}, gross ${d.gross_amount} (INV454).`);
            return SELECT.one.from(Invoices).where({ ID: invoiceId });
        });

        // ================================================================
        // BYPASS — single-person, recorded, and refused on a HARD error
        // ================================================================

        /** Recount the gate after an exception changes status. */
        const regate = async (invoiceId) => {
            const open = await SELECT.from('fuelsphere.INVOICE_EXCEPTIONS')
                .where({ invoice_ID: invoiceId, status: 'OPEN' });
            const hard = open.filter(r => r.severity === C.SEV.HARD).length;
            const soft = open.filter(r => r.severity === C.SEV.SOFT).length;
            const warn = open.filter(r => r.severity === C.SEV.WARNING).length;
            const gate = (hard + soft) > 0 ? 'GATED' : 'CLEAR';
            await UPDATE('fuelsphere.INVOICES').set({
                posting_gate: gate, open_hard_count: hard, open_soft_count: soft, warning_count: warn
            }).where({ ID: invoiceId });
            return { gate, hard, soft, warn };
        };

        this.on('bypass', InvoiceExceptions, async (req) => {
            const excId = _id(req.params);
            const exc = await SELECT.one.from('fuelsphere.INVOICE_EXCEPTIONS').where({ ID: excId });
            if (!exc) return req.error(404, 'Exception not found.');

            const reason = (req.data.reason || '').trim();

            // A HARD ERROR IS NEVER BYPASSABLE, whatever the registry says.
            // Configuration may narrow what can be waived; it may not widen
            // it. This is the one place where code overrides the registry, and
            // it does so in the safe direction only.
            if (exc.severity === C.SEV.HARD) {
                return {
                    success: false, exceptionId: excId, checkCode: exc.check_code,
                    severity: exc.severity, bypassed: false, bypassId: null,
                    postingGate: (await regate(exc.invoice_ID)).gate,
                    message: `${exc.check_code} is a HARD_ERROR and cannot be bypassed. `
                           + `It needs a corrected invoice from the vendor, or master data corrected. `
                           + `Nothing was recorded.`
                };
            }
            if (exc.severity === C.SEV.WARNING) {
                return {
                    success: false, exceptionId: excId, checkCode: exc.check_code,
                    severity: exc.severity, bypassed: false, bypassId: null,
                    postingGate: (await regate(exc.invoice_ID)).gate,
                    message: `${exc.check_code} is a WARNING and does not gate posting. `
                           + `There is nothing to bypass.`
                };
            }
            if (exc.status === 'BYPASSED') {
                return {
                    success: false, exceptionId: excId, checkCode: exc.check_code,
                    severity: exc.severity, bypassed: true, bypassId: null,
                    postingGate: (await regate(exc.invoice_ID)).gate,
                    message: `${exc.check_code} is already bypassed.`
                };
            }
            // A reason nobody can read is the same as no reason.
            if (reason.length < 10) {
                return {
                    success: false, exceptionId: excId, checkCode: exc.check_code,
                    severity: exc.severity, bypassed: false, bypassId: null,
                    postingGate: (await regate(exc.invoice_ID)).gate,
                    message: `A bypass requires a reason of at least 10 characters. `
                           + `Received ${reason.length}. Nothing was recorded.`
                };
            }

            const reg = await SELECT.one.from('fuelsphere.INVOICE_CHECK_REGISTRY')
                .where({ check_code: exc.check_code });
            if (reg && reg.is_bypassable === false) {
                return {
                    success: false, exceptionId: excId, checkCode: exc.check_code,
                    severity: exc.severity, bypassed: false, bypassId: null,
                    postingGate: (await regate(exc.invoice_ID)).gate,
                    message: `${exc.check_code} is registered as not bypassable.`
                };
            }

            const bypassId = cds.utils.uuid();
            const now = new Date().toISOString();
            await INSERT.into('fuelsphere.INVOICE_EXCEPTION_BYPASSES').entries({
                ID: bypassId,
                exception_ID: excId,
                invoice_ID: exc.invoice_ID,
                invoice_item_ID: exc.invoice_item_ID,
                check_code: exc.check_code,
                bypassed_by: req.user.id,
                bypassed_at: now,
                bypass_reason: reason,
                bypass_scope_held: (reg && reg.bypass_scope) || null,
                is_active: true
                // second_approver stays null. INV-002 is WP-27.
            });
            await UPDATE('fuelsphere.INVOICE_EXCEPTIONS')
                .set({ status: 'BYPASSED' }).where({ ID: excId });

            const g = await regate(exc.invoice_ID);
            return {
                success: true, exceptionId: excId, checkCode: exc.check_code,
                severity: exc.severity, bypassed: true, bypassId,
                postingGate: g.gate,
                message: `${exc.check_code} bypassed by ${req.user.id} at ${now}: "${reason}". `
                       + `The exception is retained as BYPASSED, not cleared — it is still true. `
                       + `Gate is now ${g.gate} (${g.hard} hard, ${g.soft} soft open).`
            };
        });

        this.on('revokeBypass', InvoiceExceptions, async (req) => {
            const excId = _id(req.params);
            const exc = await SELECT.one.from('fuelsphere.INVOICE_EXCEPTIONS').where({ ID: excId });
            if (!exc) return req.error(404, 'Exception not found.');
            if (exc.status !== 'BYPASSED') {
                return { success: false, exceptionId: excId, checkCode: exc.check_code,
                    severity: exc.severity, bypassed: false, bypassId: null,
                    postingGate: (await regate(exc.invoice_ID)).gate,
                    message: `${exc.check_code} is ${exc.status}, not BYPASSED.` };
            }
            const now = new Date().toISOString();
            await UPDATE('fuelsphere.INVOICE_EXCEPTION_BYPASSES').set({
                is_active: false, revoked_by: req.user.id, revoked_at: now,
                revocation_reason: req.data.reason || null
            }).where({ exception_ID: excId, is_active: true });
            await UPDATE('fuelsphere.INVOICE_EXCEPTIONS')
                .set({ status: 'OPEN' }).where({ ID: excId });

            const g = await regate(exc.invoice_ID);
            return { success: true, exceptionId: excId, checkCode: exc.check_code,
                severity: exc.severity, bypassed: false, bypassId: null, postingGate: g.gate,
                message: `Bypass on ${exc.check_code} revoked by ${req.user.id}. `
                       + `The exception is OPEN again and the gate is ${g.gate}.` };
        });

        await super.init();
    }
};

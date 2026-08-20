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

const _id = (params) => {
    const p = params[params.length - 1];
    return typeof p === 'object' ? p.ID : p;
};
const today = () => new Date().toISOString().slice(0, 10);

module.exports = class InvoiceService extends cds.ApplicationService {
    async init() {

        const { Invoices, InvoiceExceptions } = this.entities;

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
                warning_count: warn
            }).where({ ID: invoice.ID });

            return { rows, hard, soft, warn, gate, bypassedKept: bypassed.length };
        };

        /** Write back what the resolution produced, so it is re-explainable. */
        const persistResolution = async (result) => {
            for (const [itemId, res] of result.resolutions) {
                await UPDATE('fuelsphere.INVOICE_ITEMS').set({
                    ticket_ID: (res.ticket && res.ticket.ID) || null,
                    resolved_po_number: res.resolved_po_number,
                    resolved_gr_number: res.resolved_gr_number,
                    resolution_source: res.resolution_source
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

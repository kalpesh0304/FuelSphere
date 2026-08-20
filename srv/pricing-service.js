/**
 * FuelSphere - Pricing Service Handler (WP-20, decision A10)
 *
 * PricingService declared 44 actions and implemented none. This implements
 * THE DERIVATION PATH ONLY — resolve a formula, apply components in sequence,
 * average an index, write the log, and reprice on a restatement.
 *
 * EVERY OTHER ACTION REMAINS A DECLARED NO-OP. CAP returns a default no-op for
 * an unimplemented action, so calling one looks like it worked. The full list
 * is in the WP-20 pull request; an unlisted no-op is worse than an
 * unimplemented one.
 */

const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE } = cds.ql;
const {
    ERR, r4,
    resolveFormula, applyComponents
} = require('./lib/pricing-engine');

const _id = (params) => {
    const p = params[0];
    return typeof p === 'object' ? p.ID : p;
};

// PRICING_CONFIGURATIONS.default_engine is PricingEngineType — NATIVE,
// SAP_CPE, HYBRID. MASTER_CONTRACTS.price_type is free text carrying CPE,
// FIXED or NATIVE. They are different vocabularies for the same decision, and
// section 8 names a third (PricingEngineMode, NATIVE/CPE/HYBRID) that nothing
// uses. Normalising here rather than in the data, because renaming an enum
// value would break the seed.
const NATIVE_ENGINES = ['NATIVE', 'FIXED'];
const CPE_ENGINES    = ['CPE', 'SAP_CPE', 'HYBRID'];

module.exports = class PricingService extends cds.ApplicationService {
    async init() {

        /**
         * Write the derivation log.
         *
         * PRC407: every quote used and the formula version are stamped, so a
         * price is RE-EXPLAINABLE WITHOUT RECOMPUTATION. Eighteen months later
         * the indices may have been restated and the formula superseded;
         * recomputing would give a different answer, which is exactly why the
         * log is not a convenience.
         *
         * This is control FPE-005.
         */
        const writeLog = async (derivedPriceId, batchId, entries, context) => {
            if (!entries.length) return 0;
            const stamp = new Date().toISOString();
            const rows = entries.map((e, i) => ({
                ID: cds.utils.uuid(),
                derived_price_ID: derivedPriceId,
                derivation_batch_id: batchId,
                log_timestamp: stamp,
                sequence: i + 1,
                log_level: e.level || 'INFO',
                log_category: e.category || 'COMPONENT',
                log_message: e.message,
                log_details: e.details ? JSON.stringify(e.details) : null,
                contract_id: context.contractId || null,
                formula_id: context.formulaUuid || null,
                component_id: e.component_id || null,
                index_id: e.index_id || null,
                input_value: e.input_value !== undefined ? e.input_value : null,
                output_value: e.output_value !== undefined ? e.output_value : null,
                calculation_expression: e.calculation_expression || null,
                error_code: e.error_code || null,
                error_message: e.error_message || null,
                executed_by: context.user || 'SYSTEM',
                execution_context: context.executionContext || 'MANUAL'
            }));
            await INSERT.into('fuelsphere.PRICE_DERIVATION_LOGS').entries(rows);
            return rows.length;
        };

        /**
         * Engine selection is PER CONTRACT (PRC401), never per airline.
         *
         * MASTER_CONTRACTS carries price_type and no company code;
         * PRICING_CONFIGURATIONS carries default_engine and is keyed BY
         * company code. Nothing joins the two, so the company code is supplied
         * by the caller and the contract wins where it states a position.
         *
         * CPE is resolvable and unimplemented. PRC402 puts the availability
         * check at CONFIGURATION time, not here — so this does not refuse a
         * CPE contract at pricing time. It falls back where the configuration
         * enables fallback and says which engine actually ran.
         */
        const resolveEngine = async (contract, companyCode, forceEngine) => {
            const config = companyCode
                ? await SELECT.one.from('fuelsphere.PRICING_CONFIGURATIONS')
                    .where({ company_code: companyCode, is_active: true })
                : null;

            const requested = (forceEngine
                || (contract && contract.price_type)
                || (config && config.default_engine)
                || 'NATIVE').toUpperCase();

            const source = forceEngine ? 'CALLER'
                : (contract && contract.price_type) ? 'MASTER_CONTRACTS.price_type'
                : (config && config.default_engine) ? 'PRICING_CONFIGURATIONS.default_engine'
                : 'DEFAULT';

            if (NATIVE_ENGINES.includes(requested)) {
                return { engine: 'NATIVE', requested, source, config,
                         note: `Engine ${requested} resolved from ${source}; the native engine ran.` };
            }
            if (!CPE_ENGINES.includes(requested)) {
                return { error: `Unknown pricing engine '${requested}' from ${source}.` };
            }
            // CPE or HYBRID requested, and CPE is not built.
            const fallback = !config || config.cpe_fallback_enabled !== false;
            if (!fallback) {
                return { error: `${requested} is required by ${source} and SAP CPE is not implemented; `
                              + `cpe_fallback_enabled is false for company ${companyCode}, so no price is derived. `
                              + `Availability is a configuration-time question (PRC402).` };
            }
            return { engine: 'NATIVE_FALLBACK', requested, source, config,
                     note: `${requested} resolved from ${source}. SAP CPE is not implemented in WP-20; `
                         + `cpe_fallback_enabled permits the native engine, so the price is NATIVE_FALLBACK. `
                         + `Availability is a configuration-time question (PRC402).` };
        };

        // ================================================================
        // THE DERIVATION PATH
        // ================================================================
        const derive = async (req, input) => {
            const started = Date.now();
            const { contractId, effectiveDate, forceEngine, companyCode } = input;
            const priceStatus = (input.priceStatus || 'FINAL').toUpperCase();
            const settlesForPeriod = input.settlesForPeriod || null;

            if (!contractId)   return { fail: [400, 'contractId is required.'] };
            if (!effectiveDate) return { fail: [400, 'effectiveDate is required.'] };
            if (!['PROVISIONAL', 'FINAL'].includes(priceStatus)) {
                return { fail: [400, `priceStatus must be PROVISIONAL or FINAL, not '${priceStatus}'.`] };
            }
            // PRC409: the provisional-to-final difference settles by credit or
            // debit note against a period. A provisional price that cannot say
            // which period it settles for cannot be settled.
            if (priceStatus === 'PROVISIONAL' && !settlesForPeriod) {
                return { fail: [400, `${'PRC409'}: a PROVISIONAL price must state settlesForPeriod (YYYY-MM); `
                                   + `the provisional-to-final difference settles against a period.`] };
            }

            const batchId = `DRV-${effectiveDate}-${started}`;
            const logs = [];

            const contract = await SELECT.one.from('fuelsphere.MASTER_CONTRACTS').where({ ID: contractId });
            if (!contract) return { fail: [404, `Contract ${contractId} not found.`] };

            // ---- 1. Formula resolution --------------------------------
            const { formula, evidence, reason } = await resolveFormula(contract, effectiveDate, companyCode);
            if (!formula) return { fail: [404, reason] };

            logs.push({ category: 'CONFIG', level: 'INFO',
                message: `Formula ${evidence.formula_id} v${evidence.formula_version} resolved at scope `
                       + `${evidence.scope_name} (tier ${evidence.scope_tier}) for ${effectiveDate}, `
                       + `valid ${evidence.valid_from} to ${evidence.valid_to || 'open'}. `
                       + `${evidence.effective_candidates} formula(s) effective, ${evidence.candidates_at_tier} in scope.`,
                calculation_expression: `resolved_by=${evidence.resolved_by} scope=${evidence.scope_name}`,
                details: evidence });

            // ---- engine, per contract ---------------------------------
            const eng = await resolveEngine(contract, companyCode, forceEngine);
            if (eng.error) return { fail: [501, eng.error] };
            logs.push({ category: 'CONFIG', level: eng.engine === 'NATIVE' ? 'INFO' : 'WARNING',
                message: eng.note, calculation_expression: `engine=${eng.engine} requested=${eng.requested} source=${eng.source}` });

            // ---- 2. Components, in sequence ---------------------------
            const components = await SELECT.from('fuelsphere.FORMULA_COMPONENTS')
                .where({ formula_ID: formula.ID });
            if (!components.length) {
                return { fail: [404, `${ERR.NO_FORMULA}: formula ${formula.formula_id} has no components.`] };
            }

            const context = {
                ...input,
                priceStatus,
                settlesForPeriod,
                contract_number: contract.contract_number,
                contract_type: contract.contract_type,
                supplier_ID: contract.supplier_ID,
                companyCode: companyCode || formula.company_code || null
            };

            const result = await applyComponents(components, effectiveDate, context);
            if (result.error) {
                // A REFUSED DERIVATION IS NOT LOGGED, and it is not for want
                // of trying. req.error rolls the request transaction back and
                // takes the log rows with it. Both documented escapes were
                // measured in this handler under WP-20 and neither is usable:
                //
                //   cds.tx() without req   an independent root transaction.
                //                          DEADLOCKS — the request transaction
                //                          holds the only connection and will
                //                          not release it until the request
                //                          ends, which is waiting on this.
                //   req.on('failed')       runs while the transaction is still
                //                          settling. Same deadlock.
                //
                // Neither returns; the process does not exit. This needs a
                // second connection or an outbox, which is WP-15's staging
                // concern rather than WP-20's. Recorded as a finding.
                //
                // The reason is not lost — it is in the error the caller gets,
                // with its code. What is lost is the durable record.
                return { fail: [422, result.error] };
            }
            logs.push(...result.logs);

            // ---- PRC406: the index UoM and the price UoM ---------------
            const baseStep = result.applied.find(a => a.index);
            if (baseStep) {
                const idx = await SELECT.one.from('fuelsphere.MARKET_INDICES')
                    .columns('index_code', 'uom_ID', 'currency_ID')
                    .where({ ID: baseStep.index.index_id });
                if (idx && idx.uom_ID !== formula.uom_ID) {
                    // Not converted here. PRC406 wants the density basis stated
                    // ON THE SCHEME, and no scheme entity exists — inventing a
                    // factor would put an unstated assumption into a price.
                    logs.push({ category: 'INDEX', level: 'WARNING',
                        message: `${ERR.UOM_MISMATCH}: index ${idx.index_code} is assessed per ${idx.uom_ID} `
                               + `and the formula prices per ${formula.uom_ID}. No conversion applied — `
                               + `PRC406 requires the density basis from the scheme and no scheme entity exists.`,
                        error_code: ERR.UOM_MISMATCH, index_id: baseStep.index.index_id });
                }
            }

            // ---- 3. The price ------------------------------------------
            //
            // PRC403: derived_price is the BASIC FUEL PRICE. Tax-typed
            // components are carried in the breakdown at their declared values
            // and excluded from it.
            const price = result.basicFuelPrice;
            const quotesUsed = result.applied
                .filter(a => a.index).reduce((n, a) => n + (a.index.quotes_used || []).length, 0);

            const breakdown = {
                formula: { id: evidence.formula_id, version: evidence.formula_version,
                           uom: formula.uom_ID, currency: formula.currency_ID },
                resolvedFrom: evidence,
                engine: { ran: eng.engine, requested: eng.requested, source: eng.source },
                priceStatus,
                settlesForPeriod,
                // PRC404. The list IS the answer; the total is derivable from
                // it. A component folded into a unit rate is a variance nobody
                // can act on.
                components: result.applied,
                subtotals: {
                    basicFuelPrice: price,
                    cumulativeIncludingTaxComponents: result.cumulativeIncludingTaxComponents,
                    taxComponentsCarriedNotPriced: result.taxComponents.map(t => ({
                        name: t.name, type: t.component_type, value: t.value }))
                },
                note: `${ERR.TAX_EXCLUDED}: tax and duty amounts are calculated by SAP from the tax code; `
                    + `this is the basic fuel price.`
            };

            const derivedId = cds.utils.uuid();
            const now = new Date().toISOString();

            // A price for this contract, date and status may already exist. It
            // is SUPERSEDED rather than overwritten — the same reason a
            // restated index keeps its original. It was the right price on the
            // information available, and that record has value.
            const prior = await SELECT.from('fuelsphere.DERIVED_PRICES')
                .where({ contract_ID: contractId, price_date: effectiveDate,
                         price_status: priceStatus, is_current: true });
            for (const p of prior) {
                await UPDATE('fuelsphere.DERIVED_PRICES').set({
                    is_current: false, superseded_by: derivedId,
                    superseded_reason: input.supersededReason || 'Re-derived',
                    valid_to: now
                }).where({ ID: p.ID });
            }

            await INSERT.into('fuelsphere.DERIVED_PRICES').entries({
                ID: derivedId,
                contract_ID: contractId,
                contract_number: contract.contract_number,
                formula_ID: formula.ID,
                formula_version: formula.version,
                price_date: effectiveDate,
                derived_price: price,
                currency_currency_code: formula.currency_ID,
                uom_uom_code: formula.uom_ID,
                base_index_ID: baseStep ? baseStep.index.index_id : null,
                base_index_value: baseStep ? baseStep.index.value : null,
                base_index_date: baseStep ? baseStep.index.effective_date : null,
                pricing_engine: eng.engine,
                price_status: priceStatus,
                settles_for_period: settlesForPeriod,
                component_breakdown: JSON.stringify(breakdown, null, 2),
                calculated_at: now,
                calculation_duration_ms: Date.now() - started,
                is_current: true,
                valid_from: now
            });

            logs.push({ category: 'RESULT', level: 'INFO',
                message: `${priceStatus} basic fuel price ${price} ${formula.currency_ID}/${formula.uom_ID} `
                       + `from ${result.applied.filter(a => a.fired && !a.excluded_from_price).length} priced component(s), `
                       + `${result.taxComponents.length} tax component(s) carried not priced, `
                       + `${quotesUsed} index quote(s).`,
                output_value: price,
                calculation_expression: result.applied.filter(a => a.fired && !a.excluded_from_price)
                    .map(a => `${a.name}=${a.value}`).join(' + ') + ` = ${price}`,
                details: { supersedes: prior.map(p => p.ID) } });

            const logCount = await writeLog(derivedId, batchId, logs, {
                contractId, formulaUuid: formula.ID, user: req.user.id,
                executionContext: input.executionContext || 'MANUAL' });

            return {
                success: true,
                derivedPriceId: derivedId,
                contractId,
                effectiveDate,
                derivedPrice: price,
                currency: formula.currency_ID,
                uom: formula.uom_ID,
                pricingEngine: eng.engine,
                baseIndexValue: baseStep ? baseStep.index.value : null,
                componentBreakdown: JSON.stringify(breakdown),
                calculationTimeMs: Date.now() - started,
                priceStatus,
                settlesForPeriod,
                formulaId: evidence.formula_id,
                formulaVersion: evidence.formula_version,
                scopeResolvedBy: evidence.scope_name,
                basicFuelPrice: price,
                taxComponentCount: result.taxComponents.length,
                quotesUsed,
                logEntries: logCount,
                message: `${evidence.formula_id} v${evidence.formula_version} (scope ${evidence.scope_name}): `
                       + `${result.applied.filter(a => a.fired && !a.excluded_from_price).length} component(s) applied, `
                       + `${result.taxComponents.length} tax component(s) carried not priced. `
                       + `${priceStatus} basic fuel price ${price} ${formula.currency_ID}/${formula.uom_ID} `
                       + `on ${eng.engine}.`
            };
        };

        this.on('derivePrice', async (req) => {
            const out = await derive(req, req.data);
            if (out.fail) return req.error(out.fail[0], out.fail[1]);
            return out;
        });

        // ================================================================
        // RESTATEMENT - PRC410
        // ================================================================

        const { MarketIndexValues } = this.entities;

        this.on('correct', MarketIndexValues, async (req) => {
            const original = await SELECT.one.from('fuelsphere.MARKET_INDEX_VALUES')
                .where({ ID: _id(req.params) });
            if (!original) return req.error(404, 'Index value not found.');
            if (original.is_current === false) {
                return req.error(409, `${'PRC410'}: this value has already been restated. `
                                    + `Correct the current value for ${original.effective_date}, not a superseded one.`);
            }

            const { newValue, correctionReason } = req.data;
            if (newValue === undefined || newValue === null) return req.error(400, 'newValue is required.');
            if (!correctionReason) return req.error(400, 'correctionReason is required.');

            // THE ORIGINAL VALUE IS RETAINED. A restatement inserts a new row
            // and stands the old one down; it never overwrites. What was
            // published on the day is a fact about the day.
            const restatedId = cds.utils.uuid();
            const now = new Date().toISOString();
            await INSERT.into('fuelsphere.MARKET_INDEX_VALUES').entries({
                ID: restatedId,
                market_index_ID: original.market_index_ID,
                effective_date: original.effective_date,
                index_value: r4(newValue),
                previous_value: original.previous_value,
                high_value: original.high_value,
                low_value: original.low_value,
                import_source: 'RESTATEMENT',
                import_batch_id: original.import_batch_id,
                imported_at: now,
                imported_by: req.user.id,
                verification_status: 'PENDING',
                is_holiday: original.is_holiday,
                is_corrected: true,
                correction_reason: correctionReason,
                is_current: true,
                restates_ID: original.ID
            });
            await UPDATE('fuelsphere.MARKET_INDEX_VALUES')
                .set({ is_current: false }).where({ ID: original.ID });

            // Anything priced ON THAT DATE reprices — which is not the same as
            // anything priced on that date's quote. A price taken at N-1, or
            // averaged over five days, used the restated assessment without
            // ever naming it as the base index date. Those reprice too, and
            // the only record of which quotes a price used is the breakdown.
            const candidates = await SELECT.from('fuelsphere.DERIVED_PRICES')
                .columns('ID', 'contract_ID', 'contract_number', 'price_date', 'price_status',
                         'settles_for_period', 'formula_ID', 'component_breakdown')
                .where({ is_current: true });

            const affected = candidates.filter(p => {
                // The quote id, not the date. A date can repeat across indices;
                // the row that was read cannot.
                if (p.component_breakdown) return p.component_breakdown.includes(original.ID);
                // A price with no breakdown predates the engine, so which
                // quotes it read is not recorded. base_index_ID and
                // base_index_date are all there is, and they name only the
                // BASE quote — an averaged or offset legacy price cannot be
                // found at all. Better than skipping it silently, and stated
                // as such rather than presented as complete.
                return p.base_index_ID === original.market_index_ID
                    && String(p.base_index_date) === String(original.effective_date);
            });
            const withoutEvidence = affected.filter(p => !p.component_breakdown).length;

            const repriced = [];
            const failed = [];
            for (const p of affected) {
                const formula = await SELECT.one.from('fuelsphere.PRICING_FORMULAS')
                    .columns('company_code').where({ ID: p.formula_ID });
                const out = await derive(req, {
                    contractId: p.contract_ID,
                    effectiveDate: p.price_date,
                    companyCode: formula && formula.company_code,
                    priceStatus: p.price_status,
                    settlesForPeriod: p.settles_for_period,
                    supersededReason: `Repriced: ${original.effective_date} restated `
                                    + `${original.index_value} to ${r4(newValue)}`,
                    executionContext: 'BATCH'
                });
                if (out.fail) failed.push(`${p.contract_number || p.contract_ID}@${p.price_date}: ${out.fail[1]}`);
                else repriced.push({ from: p.ID, to: out.derivedPriceId, price: out.derivedPrice });
            }

            req.info(200,
                `${'PRC410'}: ${original.effective_date} restated from ${original.index_value} to ${r4(newValue)}. `
              + `The original row is retained and stood down. `
              + `${affected.length} current price(s) used that quote; ${repriced.length} repriced`
              + (withoutEvidence ? `. ${withoutEvidence} of them carried no component_breakdown, so only the `
                                 + `BASE quote could be matched — an averaged or offset price with no breakdown `
                                 + `cannot be found at all` : '')
              + (failed.length ? `, ${failed.length} could not: ${failed.join('; ')}` : '') + '.');

            return SELECT.one.from(MarketIndexValues).where({ ID: restatedId });
        });

        await super.init();
    }
};

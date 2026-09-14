/**
 * THE COST BREAKDOWN FOR AC410 AND AC412 — one contract, one day, one price.
 *
 * F25: PRICING_FORMULAS scopes by company_code and supplier_id and carries no
 * contract column, and the six seeded formulas name six DIFFERENT suppliers,
 * none of them WFS001. So AC-WFS-2025-001 resolved NO FORMULA and the two
 * flights had no price. FRM-007 closes that at tier 1.
 *
 * THE INDEX VALUES ARE SAMPLE DATA AND THE SEED SAYS SO. No published
 * assessment was obtainable - every price source this container can reach is
 * denied by egress policy - so the ten USGC rows are authored with a realistic
 * level and shape, marked `import_source: SAMPLE-USGC-JETA1`,
 * `verification_status: UNVERIFIED`, `is_estimated: true`, and a
 * verification_note saying plainly what they are. EXIT-5 guards that marking,
 * because a seeded row that reads as a market assessment is the one thing this
 * repository's whole instrument discipline exists to prevent.
 *
 * WHERE THESE CRITERIA GET THEIR NUMBERS, which is section 13's question. NOT
 * from the engine. EXIT-2 re-reads the ten values from the SEED CSV and
 * computes the five-day mean itself, then asserts the engine agrees. The
 * authored artefact against the computation - the `fim-reconcile` EXIT-2 shape
 * - so the two can disagree and say so.
 *
 * AND THE DERIVED ROW IS NOT SEEDED, DELIBERATELY. component_breakdown is
 * 3,391 characters containing a semicolon, A NEWLINE and 294 double quotes,
 * which is three ways to shift a column in a semicolon-delimited CSV. But the
 * mechanics are the third reason. The first is that seeding it would AUTHOR a
 * computation, which is what D54 exists to prevent; the second is that an
 * authored copy drifts silently the day a component changes. The inputs are
 * seeded and one derivePrice call produces the row.
 *
 *   EXIT-1  FRM-007 resolves for this contract at tier 1, ALONE
 *   EXIT-2  the index is an average of FIVE DIFFERENT published days, and the
 *           mean recomputed from the seed CSV matches the engine
 *   EXIT-3  the price is the sum of its four components - structural, read
 *           back out of the breakdown the engine emitted
 *   EXIT-4  zero tax components (PRC403), and the engine label is the TRUE
 *           one: NATIVE_FALLBACK, because the contract asks for CPE
 *   EXIT-5  the sample rows are MARKED as sample and claim no real provider
 *   EXIT-6  D54 stays honest: the other six DERIVED_PRICES rows still carry
 *           no breakdown, and this criterion fails if somebody authors one
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const fs = require('node:fs');
const test = cds.test(PROJECT);
const out = s => process.stdout.write('      ' + s + '\n');

const CONTRACT = 'd4e5f6a7-4444-4000-8000-00000000A001';   // AC-WFS-2025-001
const USGC     = '550e8400-e29b-41d4-a716-446655446004';
const DATE     = '2026-04-10';
let res, bd;

// the seed, read as the AUTHORED artefact - independent of anything the
// engine does with it
const seedValues = () => {
    const csv = fs.readFileSync(`${PROJECT}/db/data/fuelsphere-MARKET_INDEX_VALUES.csv`, 'utf8')
        .trim().split('\n');
    const head = csv[0].split(';');
    return csv.slice(1).map(l => Object.fromEntries(l.split(';').map((v, i) => [head[i], v])))
        .filter(r => r.market_index_ID === USGC);
};

describe('The WFS cost breakdown — AC410 and AC412', function () {
    this.timeout(120000);

    before(async () => {
        const r = await test.post('/odata/v4/pricing/derivePrice',
            { contractId: CONTRACT, effectiveDate: DATE, companyCode: '1000' });
        res = r.data;
        bd = JSON.parse(res.componentBreakdown);
    });

    it('EXIT-1: FRM-007 resolves at tier 1, alone', () => {
        out(`${res.formulaId} v${res.formulaVersion}, scope ${res.scopeResolvedBy}`);
        out(`${bd.resolvedFrom.effective_candidates} formulas effective, ${bd.resolvedFrom.candidates_at_tier} in scope`);
        assert.strictEqual(res.formulaId, 'FRM-007');
        assert.strictEqual(bd.resolvedFrom.scope_tier, 1);
        assert.strictEqual(bd.resolvedFrom.candidates_at_tier, 1,
            'two formulas at one scope is an ambiguity, not a ranking — the engine would refuse');
    });

    it('EXIT-2: five DIFFERENT days, and the seed CSV agrees with the engine', () => {
        const idx = bd.components.find(c => c.component_type === 'BASE_INDEX').index;
        const used = idx.quotes_used;
        out(`quotes used: ${used.map(q => `${q.date}=${q.value}`).join(', ')}`);
        assert.strictEqual(used.length, 5, 'a five-day quotation period needs five quotes');
        assert.strictEqual(new Set(used.map(q => q.value)).size, 5,
            'A FLAT SERIES MAKES THE ENGINE LOOK LIKE MULTIPLICATION. The average over a quotation '
          + 'period only means something if the days differ.');

        // recompute from the AUTHORED seed, not from the engine's own answer
        const seed = seedValues().filter(r => used.some(q => q.date === r.effective_date));
        assert.strictEqual(seed.length, 5, 'the five quotes must exist in the seed CSV');
        const mean = seed.reduce((s, r) => s + Number(r.index_value), 0) / 5;
        out(`seed mean ${mean.toFixed(4)}  vs  engine ${idx.value}`);
        assert.strictEqual(Number(idx.value.toFixed(4)), Number(mean.toFixed(4)));
        assert.strictEqual(Number(res.baseIndexValue.toFixed(4)), Number(mean.toFixed(4)));
    });

    it('EXIT-3: the price is the sum of its components', () => {
        const parts = bd.components.filter(c => c.fired).map(c => c.value);
        const sum = Number(parts.reduce((a, b) => a + b, 0).toFixed(4));
        out(`${parts.join(' + ')} = ${sum} ${res.currency}/${res.uom}`);
        assert.strictEqual(bd.components.length, 4, 'index, differential, into-plane, throughput');
        assert.strictEqual(sum, Number(res.derivedPrice.toFixed(4)));
        assert.strictEqual(sum, Number(bd.subtotals.basicFuelPrice.toFixed(4)));
    });

    it('EXIT-4: no tax priced (PRC403), and the engine label is the true one', () => {
        out(`tax components carried not priced: ${res.taxComponentCount}`);
        out(`engine ran ${bd.engine.ran}, requested ${bd.engine.requested} from ${bd.engine.source}`);
        assert.strictEqual(res.taxComponentCount, 0);
        assert.deepStrictEqual(bd.subtotals.taxComponentsCarriedNotPriced, []);
        assert.strictEqual(bd.engine.ran, 'NATIVE_FALLBACK',
            'the contract asks for CPE and CPE is not built. A demo showing NATIVE_FALLBACK with the '
          + 'reason is stronger than one showing NATIVE that is not true.');
        assert.strictEqual(bd.engine.requested, 'CPE');
    });

    it('EXIT-5: the sample index rows are MARKED as sample', () => {
        const rows = seedValues();
        out(`${rows.length} USGC rows in the seed`);
        assert.ok(rows.length >= 10);
        for (const r of rows) {
            assert.strictEqual(r.is_estimated, 'true',
                `${r.effective_date} is authored sample data and must not claim to be an assessment`);
            assert.notStrictEqual(r.verification_status, 'VERIFIED',
                `${r.effective_date} claims VERIFIED and nothing verified it`);
            for (const provider of ['PLATTS', 'ARGUS', 'OPIS', 'EIA']) {
                assert.ok(!r.import_source.toUpperCase().includes(provider),
                    `${r.effective_date} names ${provider} as its source. No published assessment was `
                  + `used; naming one is a fabricated provenance claim in the provenance column.`);
            }
            assert.ok(/SAMPLE/i.test(r.verification_notes) || /SAMPLE/i.test(r.import_source),
                `${r.effective_date} does not say it is sample data`);
        }
        out('every row: is_estimated true, UNVERIFIED, no real provider named, note says SAMPLE');
    });

    it('EXIT-6: D54 stays honest — no OTHER derived price has an authored breakdown', async () => {
        const rows = await SELECT.from('fuelsphere.DERIVED_PRICES')
            .columns('contract_number', 'price_date', 'component_breakdown');
        const others = rows.filter(r => r.contract_number !== 'AC-WFS-2025-001');
        const authored = others.filter(r => r.component_breakdown);
        out(`${others.length} other derived prices, ${authored.length} with a breakdown`);
        assert.deepStrictEqual(authored.map(r => `${r.contract_number} ${r.price_date}`), [],
            'D54: component_breakdown is null on the other six because nothing has computed one. '
          + 'Authoring one to make a counter look better is exactly what these counters exist to '
          + 'prevent. If a derivation now covers them, close D54 rather than filling the column.');
    });
});

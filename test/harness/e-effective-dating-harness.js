/**
 * E — THE EFFECTIVE-DATING RESOLVER.
 *
 * The design brief said "nothing in FuelSphere resolves by date today", and
 * CLAUDE.md said the same. BOTH ARE WRONG. srv/lib/parameter-store.js has
 * resolved by date, priority AND specificity since WP-13, its inScope() is
 * already generic over the scope columns, it is already exported, and five
 * modules already consume the store.
 *
 * So E is not a build. resolveEffective() points the SAME filter at an entity
 * the caller names, and adds the one thing genuinely missing: a miss reported
 * as a fact rather than as a defect.
 *
 * Every criterion below is a behaviour the brief specified. Three are proved
 * against SEEDED rows that already exercise them, which is the stronger form -
 * the data was not arranged to make the test pass.
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert');
const test=cds.test(PROJECT); const out=s=>process.stdout.write('      '+s+'\n');
const { resolveEffective, inScope } = require(`${PROJECT}/srv/lib/parameter-store`);
const db=()=>cds.connect.to('db');
const T='fuelsphere.TOLERANCE_RULES';

describe('E — one effective-dating resolver, over any entity', () => {

  it('EXIT-1  it resolves over an entity NAMED BY THE CALLER, not a hardcoded one', async () => {
    const r = await resolveEffective({
        entity: T, where: { rule_code: 'TOL-INV-QTY', row_kind: 'TOLERANCE' },
        scopeFields: ['company_code','station_code'], asOfDate: '2026-04-15' });
    assert.strictEqual(r.resolved, true, 'the seeded ladder rule must resolve');
    assert.strictEqual(r.row.rule_code, 'TOL-INV-QTY');
    assert.strictEqual(r.evidence.source, T, 'the evidence must name the entity it read');
    // The point of the criterion: the entity is an ARGUMENT. Prove it by
    // resolving over a different one with no code change.
    const other = await resolveEffective({
        entity: 'fuelsphere.INVOICE_CHECK_REGISTRY',
        where: { check_code: 'INV451' }, scopeFields: [], asOfDate: '2026-04-15' });
    assert.strictEqual(other.resolved, true, 'a second entity must resolve through the same call');
    assert.strictEqual(other.row.check_code, 'INV451');
    out(`resolved ${r.row.rule_code} from ${T.split('.')[1]} and `
      + `${other.row.check_code} from INVOICE_CHECK_REGISTRY, same function`);
  });

  it('EXIT-2  AS AT THE TRANSACTION DATE, and a closed window really closes', async () => {
    // FLIGHT_COST_OBJECT_MODEL is seeded as two rows: one ending 2026-06-30,
    // one opening 2026-07-01. Nobody arranged this for the test.
    const q = async (asOf) => resolveEffective({
        entity: T, where: { rule_code: 'FLIGHT_COST_OBJECT_MODEL', row_kind: 'PARAMETER' },
        scopeFields: ['company_code','station_code'], asOfDate: asOf });

    const before = await q('2026-03-01'), after = await q('2026-08-01');
    assert.strictEqual(before.resolved, true); assert.strictEqual(after.resolved, true);
    assert.notStrictEqual(before.row.ID, after.row.ID,
      'the two dates must reach DIFFERENT rows, or the window is not being read');
    assert.strictEqual(before.evidence.valid_to, '2026-06-30');
    assert.strictEqual(after.evidence.valid_to, null, 'the current row is open-ended');

    // The boundary is INCLUSIVE on both ends.
    assert.strictEqual((await q('2026-06-30')).row.ID, before.row.ID, 'valid_to is inclusive');
    assert.strictEqual((await q('2026-07-01')).row.ID, after.row.ID,  'valid_from is inclusive');
    out(`2026-03-01 -> window to ${before.evidence.valid_to}; `
      + `2026-08-01 -> open-ended; boundary inclusive at both ends`);
  });

  it('EXIT-3  open-ended valid_to is the COMMON case, not an edge case', async () => {
    const rows = await (await db()).run(SELECT.from(T));
    const open = rows.filter(r => !r.valid_to);
    assert.ok(open.length > rows.length / 2,
      `only ${open.length} of ${rows.length} rows are open-ended - the premise has changed`);
    const r = await resolveEffective({
        entity: T, where: { rule_code: 'TOL-INV-QTY' },
        scopeFields: ['company_code','station_code'], asOfDate: '2099-12-31' });
    assert.strictEqual(r.resolved, true, 'an open-ended row must still resolve far in the future');
    out(`${open.length}/${rows.length} rows open-ended; one resolves at 2099-12-31`);
  });

  it('EXIT-4  SPECIFICITY beats a global default, and the global still answers everyone else', async () => {
    // UNKNOWN_TAIL_POLICY is seeded twice: a global row, and one scoped to
    // company 2000. Seeded, not planted.
    const q = async (scope) => resolveEffective({
        entity: T, where: { rule_code: 'UNKNOWN_TAIL_POLICY', row_kind: 'PARAMETER' },
        scope, scopeFields: ['company_code','station_code'], asOfDate: '2026-04-15' });

    const scoped = await q({ company_code: '2000' });
    const global_ = await q({ company_code: '1000' });
    assert.strictEqual(scoped.resolved, true); assert.strictEqual(global_.resolved, true);
    assert.strictEqual(scoped.row.company_code, '2000', 'company 2000 must get its own row');
    assert.strictEqual(scoped.evidence.specificity, 1);
    assert.strictEqual(global_.row.company_code, null, 'company 1000 must fall to the global row');
    assert.strictEqual(global_.evidence.specificity, 0);
    out(`company 2000 -> its own row (specificity 1, priority ${scoped.row.priority}); `
      + `company 1000 -> global (specificity 0, priority ${global_.row.priority})`);

    // THE SEEDED PAIR CANNOT PROVE THE ORDER, AND SAYING IT DID WOULD BE THE
    // ERROR THIS SUITE KEEPS CATCHING.
    //
    // The scoped row is priority 50 and the global is 100. Lower wins, so
    // specificity and priority AGREE here - the scoped row would come first
    // either way, and the test would pass with the sort in either order.
    //
    // So the order is proved by a plant where they DISAGREE: a scoped row
    // with a WORSE priority number than the global. If specificity is
    // consulted first, it still wins.
    const D = await db();
    await D.run(INSERT.into(T).entries([{
        ID: 'eee00000-0000-4000-8000-000000000101', rule_code: 'E_ORDER',
        row_kind: 'PARAMETER', value_type: 'TEXT', value_text: 'global-better-priority',
        priority: 1, valid_from: '2026-01-01', is_active: true
    }, {
        ID: 'eee00000-0000-4000-8000-000000000102', rule_code: 'E_ORDER',
        row_kind: 'PARAMETER', value_type: 'TEXT', value_text: 'scoped-worse-priority',
        company_code: '2000', priority: 900, valid_from: '2026-01-01', is_active: true
    }]));
    const both = await D.run(SELECT.from(T).where({ rule_code: 'E_ORDER' }));
    assert.strictEqual(both.length, 2, 'plant did not fire - the ordering pair was not inserted');

    const ordered = await resolveEffective({ entity: T, where: { rule_code: 'E_ORDER' },
        scope: { company_code: '2000' },
        scopeFields: ['company_code','station_code'], asOfDate: '2026-04-15' });
    assert.strictEqual(ordered.row.value_text, 'scoped-worse-priority',
      'SPECIFICITY MUST BE CONSULTED BEFORE PRIORITY - the scoped row lost on priority 900 vs 1 '
    + 'and must still win');
    out(`  order proved: scoped@priority 900 beats global@priority 1 on specificity`);
    await D.run(DELETE.from(T).where({ rule_code: 'E_ORDER' }));
  });

  it('EXIT-5  OVERLAPPING validity at EQUAL specificity is resolved by priority', async () => {
    // The seed has no such pair, so this one is PLANTED - and the plant is
    // asserted to have taken before anything is concluded from it.
    const D = await db();
    const mk = (id, pri) => ({ ID: id, rule_code: 'E_PROBE', row_kind: 'PARAMETER',
        value_type: 'TEXT', value_text: `p${pri}`, priority: pri,
        valid_from: '2026-01-01', valid_to: null, is_active: true });
    await D.run(INSERT.into(T).entries([
        mk('eee00000-0000-4000-8000-000000000001', 90),
        mk('eee00000-0000-4000-8000-000000000002', 10)]));
    const planted = await D.run(SELECT.from(T).where({ rule_code: 'E_PROBE' }));
    assert.strictEqual(planted.length, 2, 'plant did not fire - two overlapping rows were not inserted');

    const r = await resolveEffective({ entity: T, where: { rule_code: 'E_PROBE' },
        scopeFields: ['company_code','station_code'], asOfDate: '2026-04-15' });
    assert.strictEqual(r.resolved, true);
    assert.strictEqual(r.row.value_text, 'p10', 'the LOWER priority number must win');
    assert.strictEqual(r.evidence.candidates, 2, 'both rows must have been in contention');
    out(`two overlapping rows, priority 10 and 90 -> ${r.row.value_text} won, `
      + `${r.evidence.candidates} candidates`);
    await D.run(DELETE.from(T).where({ rule_code: 'E_PROBE' }));
  });

  it('EXIT-6  A MISS IS A NORMAL OUTCOME — it returns, it does not throw', async () => {
    // The behaviour the brief singled out, and the only thing resolveParameter
    // could not do: an undesignated station has no row and never should.
    const r = await resolveEffective({ entity: T,
        where: { rule_code: 'NO_SUCH_RULE_AT_ALL' },
        scopeFields: ['company_code','station_code'], asOfDate: '2026-04-15' });
    assert.strictEqual(r.resolved, false);
    assert.strictEqual(r.row, null, 'a miss returns null, never an invented fallback');
    assert.ok(r.reason && !/CFG4\d\d/.test(r.reason),
      'the reason must NOT carry a configuration-defect code - absence is the callers to judge');
    assert.strictEqual(r.evidence.candidates, 0);
    assert.strictEqual(r.evidence.as_of, '2026-04-15', 'even a miss records the date it asked at');

    // A scope that matches nothing is also a miss, not an error.
    const s = await resolveEffective({ entity: T,
        where: { rule_code: 'TOL-AMT-HIGH' }, scope: { company_code: '9999' },
        scopeFields: ['company_code','station_code'], asOfDate: '2026-04-15' });
    assert.strictEqual(s.resolved, false, 'a company-scoped row must not answer another company');
    out(`unknown code -> resolved:false, ${r.evidence.candidates} candidates, no throw; `
      + `wrong company -> resolved:false`);
  });

  it('EXIT-7  it is the SAME rule as the store already used — inScope, not a copy', async () => {
    // If this were a second implementation it could drift. It is not: the
    // generic resolver and resolveToleranceRule reach the same row.
    const { resolveToleranceRule } = require(`${PROJECT}/srv/lib/parameter-store`);
    const viaStore   = await resolveToleranceRule({ ruleCode: 'TOL-INV-QTY' }, {}, '2026-04-15');
    const viaGeneric = await resolveEffective({ entity: T,
        where: { rule_code: 'TOL-INV-QTY', row_kind: 'TOLERANCE' },
        scopeFields: ['company_code','supplier_category','product_type'], asOfDate: '2026-04-15' });
    assert.strictEqual(viaStore.resolved, true); assert.strictEqual(viaGeneric.resolved, true);
    assert.strictEqual(viaStore.rule.ID, viaGeneric.row.ID,
      'the two paths must reach the SAME row, or there are two rules in the repository');
    assert.ok(typeof inScope === 'function', 'inScope must remain exported - it is the shared rule');
    out(`both paths -> ${viaGeneric.row.rule_code}, same row id`);
  });
});

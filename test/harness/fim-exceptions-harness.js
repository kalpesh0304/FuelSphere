/**
 * FIM — the seeded exceptions ARE the computed exceptions.
 *
 * INVOICE_EXCEPTIONS is seeded so the worklist has content on arrival. A
 * seeded row is authored, and `detected_by = VALIDATE_FOR_POSTING` is a CLAIM
 * THE ROW MAKES ABOUT ITSELF - this repository has caught five flags that
 * disagreed with their source, and one written knowingly would be the worst.
 *
 * THIS HARNESS TURNS THE CLAIM INTO A CHECK. It re-runs validateForPosting
 * against the seed and asserts the computed set equals the seeded set ROW FOR
 * ROW - not count for count, because twenty and twenty can differ in which
 * twenty. With this test the seed is a CACHED COMPUTATION; without it, it is
 * an assertion nobody verified.
 *
 * And staleness cannot be marked away: correct an invoice line and a seeded
 * exception still asserts the old thing. Only re-running catches that.
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert');
const test=cds.test(PROJECT); const out=s=>process.stdout.write('      '+s+'\n');
const db=()=>cds.connect.to('db');
const O='/odata/v4/invoice';

/** The identity of an exception, independent of its row id and timestamps. */
const key = (e) => [e.invoice_ID, e.check_code, e.line_number ?? '', e.severity,
                    e.severity_source, e.message].join('|');

async function computed() {
    const invs = await (await db()).run(SELECT.from('fuelsphere.INVOICES').columns('ID'));
    // A re-run DELETES non-bypassed priors and re-raises, so what is in the
    // table afterwards is the computed set rather than the seed plus it.
    for (const i of invs) {
        await test.POST(`${O}/Invoices(ID=${i.ID},IsActiveEntity=true)/InvoiceService.validateForPosting`, {});
    }
    return (await db()).run(SELECT.from('fuelsphere.INVOICE_EXCEPTIONS'));
}

describe('FIM — the seed equals the computation', () => {

  let seeded;
  before(async () => {
    seeded = await (await db()).run(SELECT.from('fuelsphere.INVOICE_EXCEPTIONS'));
  });

  it('EXIT-1  the seed is present, and every row says who produced it', () => {
    assert.ok(seeded.length > 0, 'instrument check: nothing seeded, so nothing is being compared');
    const authored = seeded.filter(r => r.detected_by !== 'VALIDATE_FOR_POSTING');
    assert.deepStrictEqual(authored.map(r => r.check_code), [],
      'every seeded exception must name the handler that produced it');
    out(`${seeded.length} seeded, all detected_by=VALIDATE_FOR_POSTING`);
  });

  it('EXIT-2  ROW FOR ROW, and the difference is NAMED', async () => {
    const comp = await computed();
    const S = new Map(seeded.map(r => [key(r), r]));
    const C = new Map(comp.map(r => [key(r), r]));
    const onlySeeded   = [...S.keys()].filter(k => !C.has(k));
    const onlyComputed = [...C.keys()].filter(k => !S.has(k));
    const say = (k) => { const [, code, line] = k.split('|'); return `${code} line ${line || '(header)'}`; };
    for (const k of onlySeeded)   out(`  SEEDED but not computed : ${say(k)}`);
    for (const k of onlyComputed) out(`  COMPUTED but not seeded : ${say(k)}`);
    assert.deepStrictEqual(onlySeeded.map(say), [],
      'the seed asserts an exception the code no longer raises - it is STALE');
    assert.deepStrictEqual(onlyComputed.map(say), [],
      'the code raises an exception the seed does not carry - the seed is BEHIND');
    assert.strictEqual(comp.length, seeded.length);
    out(`${comp.length} computed, ${seeded.length} seeded, 0 differences`);
  });

  it('EXIT-3  the gate on each invoice agrees with its exceptions', async () => {
    const invs = await (await db()).run(SELECT.from('fuelsphere.INVOICES')
      .columns('ID','invoice_number','posting_gate','open_hard_count','open_soft_count','warning_count'));
    const ex = await (await db()).run(SELECT.from('fuelsphere.INVOICE_EXCEPTIONS'));
    for (const i of invs) {
      const mine = ex.filter(e => e.invoice_ID === i.ID);
      const hard = mine.filter(e => e.severity === 'HARD_ERROR').length;
      const soft = mine.filter(e => e.severity === 'SOFT_ERROR').length;
      assert.strictEqual(i.open_hard_count, hard, `${i.invoice_number}: hard count`);
      assert.strictEqual(i.open_soft_count, soft, `${i.invoice_number}: soft count`);
      // "checked and clean" versus "never checked" lives HERE rather than in
      // the exception table, which holds failures only.
      assert.strictEqual(i.posting_gate, (hard + soft) > 0 ? 'GATED' : 'CLEAR',
        `${i.invoice_number}: gate must follow the gating severities`);
    }
    const clear = invs.filter(i => i.posting_gate === 'CLEAR').map(i => i.invoice_number);
    out(`${invs.length} invoices; CLEAR: ${clear.join(', ') || 'none'}`);
  });

  it('EXIT-4  the tolerance ladder is visible, and distinguishable from the registry', () => {
    const laddered = seeded.filter(r => r.severity_source === 'TOLERANCE_LADDER');
    assert.ok(laddered.length >= 2, 'the ladder must have produced more than one severity');
    const sevs = new Set(laddered.map(r => r.severity));
    assert.ok(sevs.size >= 2,
      'one check at several rungs is the demonstration; one rung proves nothing');
    for (const r of laddered) assert.ok(r.threshold_crossed !== null,
      'a laddered severity must name the threshold it crossed');
    out(`${laddered.length} from the ladder across ${sevs.size} severities; `
      + `${seeded.length - laddered.length} from the registry default`);
  });
});

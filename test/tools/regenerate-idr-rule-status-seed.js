/**
 * REGENERATE db/data/fuelsphere-IDR_RULE_STATUS.csv AND THE FIVE COUNTERS.
 *
 *     npx cds deploy --to sqlite:db.sqlite     <- FIRST. NOT OPTIONAL.
 *     node test/tools/regenerate-idr-rule-status-seed.js
 *
 * RUN IT AGAINST A CLEAN DEPLOY, ALWAYS. The first generation of this seed
 * was thrown away because it ran against a database where
 * validateForPosting had already fired over HTTP: INVOICE_EXCEPTIONS then
 * carried RUNTIME uuids rather than the seeded e0c00000- ones, so every
 * exception_ID written here would have dangled the moment anyone deployed
 * afresh - a reference resolving to nothing, arriving in data rather than
 * in an annotation path.
 *
 * The output is checked by idr-rule-status-harness EXIT-3, which compares
 * THIS CSV against what a run computes, so a seed regenerated from a dirty
 * database fails there rather than reaching a screen.
 *
 * The counters go to /tmp/counters.json for fuelsphere-INVOICES.csv; that
 * half is applied by hand and is checked by EXIT-1.
 *
 * It was committed by accident under test/.probe in the seeding commit.
 * Kept rather than deleted, because a re-seed is a real operation and the
 * clean-deploy requirement above is the whole reason to have it written
 * down instead of reinvented.
 */
const cds = require('@sap/cds');
const fs = require('fs');
(async () => {
  await cds.connect.to('db');
  const C = require('/home/user/FuelSphere/srv/lib/invoice-checks.js');
  const reg = await SELECT.from('fuelsphere.INVOICE_CHECK_REGISTRY').columns('ID','check_code');
  const regByCode = new Map(reg.map(r => [r.check_code, r.ID]));
  const NOW = '2026-09-01T09:00:00Z';
  const BY  = 'ap.clerk@airline.com';

  const cols = ['ID','invoice_ID','rule_ID','check_code','check_group','invoice_item_ID','line_number',
                'status','severity','severity_source','na_reason','exception_ID','message',
                'evaluated_at','evaluated_by','bypassed_by','bypassed_at','bypass_reason'];
  const lines = [cols.join(';')];
  const counters = [];
  let seq = 0;
  const uuid = () => { seq++; return `1d500000-0000-4000-8000-${String(seq).padStart(12,'0')}`; };
  const esc = v => (v === null || v === undefined) ? ''
      : String(v).replace(/;/g, ',').replace(/[\r\n]+/g, ' ');

  for (const inv of await SELECT.from('fuelsphere.INVOICES').orderBy('invoice_number')) {
    const items = await SELECT.from('fuelsphere.INVOICE_ITEMS').where({ invoice_ID: inv.ID }).orderBy('line_number');
    const r = await C.runChecks(inv, items, { today: '2026-09-01' });
    const exc = await SELECT.from('fuelsphere.INVOICE_EXCEPTIONS').where({ invoice_ID: inv.ID });
    const excByKey = new Map(exc.map(e => [`${e.check_code}|${e.invoice_item_ID || ''}`, e]));
    const c = { PASSED:0, FAILED:0, BYPASSED:0, NOT_APPLICABLE:0 };
    for (const v of r.verdicts) {
      const e = excByKey.get(`${v.check_code}|${v.invoice_item_ID || ''}`);
      const status = (e && e.status === 'BYPASSED') ? 'BYPASSED' : v.status;
      c[status]++;
      lines.push([uuid(), inv.ID, regByCode.get(v.check_code) || '', v.check_code, v.check_group,
        v.invoice_item_ID || '', v.line_number === null ? '' : v.line_number, status,
        (e && e.severity) || v.severity || '', (e && e.severity_source) || v.severity_source || '',
        v.na_reason || '', e ? e.ID : '', v.message || '', NOW, BY, '', '', ''].map(esc).join(';'));
    }
    counters.push({ ID: inv.ID, n: inv.invoice_number, total: r.verdicts.length, ...c });
  }
  fs.writeFileSync('/home/user/FuelSphere/db/data/fuelsphere-IDR_RULE_STATUS.csv', lines.join('\n') + '\n');
  console.log(`${lines.length - 1} rule-status rows written`);
  fs.writeFileSync('/tmp/counters.json', JSON.stringify(counters, null, 1));
  for (const c of counters) console.log(`  ${c.n.padEnd(24)} ${String(c.total).padStart(3)} = ${c.PASSED} P + ${c.FAILED} F + ${c.BYPASSED} B + ${c.NOT_APPLICABLE} NA`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

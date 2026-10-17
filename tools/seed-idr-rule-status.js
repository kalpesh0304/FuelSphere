#!/usr/bin/env node
/**
 * FuelSphere - seed IDR_RULE_STATUS by RUNNING THE CHECKS, not by writing them.
 *
 * THE SEED WAS A SAMPLE. 435 verdict rows covering 13 invoices of 95 and 21
 * lines of 1,776 - enough to demonstrate the screen, not enough to use it. An
 * invoice with no verdicts shows five counters reading zero, which is
 * indistinguishable from an invoice that passed everything, and that is the
 * exact confusion IDR_RULE_STATUS exists to prevent.
 *
 * WHY THIS DRIVES THE SERVICE INSTEAD OF WRITING CSV ROWS. A hand-written
 * verdict is an assertion about what the code WOULD decide, and the moment a
 * threshold moves it becomes a lie no test can see - idr-rule-status EXIT-3
 * exists because that had already happened. So this calls validateForPosting
 * on every invoice, exactly as the screen's button does, and exports what the
 * run produced. The seed cannot disagree with the computation because it IS
 * the computation's output.
 *
 * THE TEN CHECKS THE BRIEF NAMES (2 Oct 2026) were already registered and
 * already implemented - six line checks (INV450, INV451, INV452, INV469,
 * INV455, INV467) and four header checks (INV454, INV473, INV460, INV461).
 * Nothing here implements a check. What was missing was the VERDICTS, on 82
 * of the 95 invoices.
 *
 * IN PROCESS, NOT OVER HTTP. cds.test boots a server whose port is only
 * published to mocha, and a direct cds.connect.to('db') alongside it can land
 * on a different in-memory SQLite connection - the tables appeared and
 * vanished between two calls while this was being written. Deploying the
 * model to one database and serving the invoice service from the same model
 * leaves exactly one database in the process, which is the property that
 * makes the export trustworthy.
 *
 * NOT_APPLICABLE IS A RESULT AND IS KEPT. A quantity variance cannot be
 * evaluated on a line whose ticket never resolved; recording that as "not
 * checked" is the difference between a screen that reports an absence and one
 * that reports a pass. Dropping those rows would make the counters sum to
 * less than the registry and lose the distinction entirely.
 *
 * Run:  node tools/seed-idr-rule-status.js [--write]
 * Without --write it reports what it would produce and changes nothing.
 */

process.env.CDS_ENV = 'development';

const fs = require('fs');
const path = require('path');

const PROJECT = path.resolve(__dirname, '..');
const cds = require(path.join(PROJECT, 'node_modules', '@sap', 'cds'));

const WRITE = process.argv.includes('--write');
const OUT = path.join(PROJECT, 'db', 'data', 'fuelsphere-IDR_RULE_STATUS.csv');

const NAMED = ['INV450', 'INV451', 'INV452', 'INV469', 'INV455', 'INV467',
               'INV454', 'INV473', 'INV460', 'INV461'];

/**
 * The CSV's own column order, read from the file being replaced rather than
 * restated here - a seeder that invents its own order writes a file the
 * deployer imports into the wrong columns.
 */
function headerOf(file) {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/)[0].replace(/^﻿/, '').split(';');
}

/** A CSV field. Semicolon-delimited, so a value containing one must be quoted. */
function field(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString();
    const s = String(v);
    return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

(async () => {
    cds.env.requires.db = { kind: 'sqlite', credentials: { url: ':memory:' } };

    // The RAW loaded model to both calls. Passing a model already compiled
    // for Node to cds.deploy makes it compile a second time, and the second
    // pass fails on the draft elements CAP itself generated.
    const model = await cds.load('*');
    await cds.deploy(model).to('sqlite::memory:');
    const srv = await cds.serve('InvoiceService').from(model);
    const { SELECT } = cds.ql;

    const invoices = await cds.db.run(SELECT.from('fuelsphere.INVOICES')
        .columns('ID', 'invoice_number').orderBy('invoice_number'));
    const before = await cds.db.run(SELECT.from('fuelsphere.IDR_RULE_STATUS').columns('ID'));
    console.log(`${invoices.length} invoice(s); ${before.length} verdict row(s) seeded today`);

    let ok = 0;
    const failures = [];
    for (const inv of invoices) {
        try {
            await srv.send({
                event: 'validateForPosting',
                entity: 'Invoices',
                params: [{ ID: inv.ID, IsActiveEntity: true }]
            });
            ok++;
            if (ok % 20 === 0) console.log(`  ...${ok} validated`);
        } catch (e) {
            failures.push(`${inv.invoice_number}: ${e.message}`);
        }
    }
    console.log(`${ok} validated, ${failures.length} failed`);
    for (const f of failures.slice(0, 10)) console.log('  FAIL ' + f);

    const cols = headerOf(OUT);
    const rows = await cds.db.run(SELECT.from('fuelsphere.IDR_RULE_STATUS'));
    console.log(`\n${rows.length} verdict row(s) after the run`);

    const by = (k) => rows.reduce((m, r) => (m[r[k] || '-'] = (m[r[k] || '-'] || 0) + 1, m), {});
    console.log('by status:', by('status'));
    const perCheck = by('check_code');
    console.log('the ten the brief names:');
    for (const c of NAMED) console.log(`  ${c}  ${perCheck[c] || 0}`);
    const covered = new Set(rows.map(r => r.invoice_ID));
    console.log(`invoices covered: ${covered.size} of ${invoices.length}`);

    // ====================================================================
    // THE RUN PRODUCES THREE THINGS, AND SEEDING ONE OF THEM IS WORSE THAN
    // SEEDING NONE.
    //
    // A verdict row says a rule passed. The COUNTERS on the invoice say how
    // many did, and the EXCEPTIONS carry the evidence behind the ones that
    // did not. Export only the verdicts and the screen reads 30,762 results
    // against counters that are still null - which is precisely the
    // disagreement idr-rule-status EXIT-1 exists to catch, and it caught it.
    //
    // The counters also decide the header's new "Validation checks" verdict:
    // it reads posting_gate first, so an invoice whose gate is still null
    // reports "Not checked" however many rules have in fact run against it.
    // ====================================================================
    const EXC = path.join(PROJECT, 'db', 'data', 'fuelsphere-INVOICE_EXCEPTIONS.csv');
    const INV = path.join(PROJECT, 'db', 'data', 'fuelsphere-INVOICES.csv');

    // The columns the run writes back onto the invoice. Everything else in
    // that file is left exactly as it was - this updates a seed, it does not
    // regenerate one.
    const COUNTERS = ['posting_gate', 'gate_evaluated_at', 'open_hard_count',
                      'open_soft_count', 'warning_count', 'rules_evaluated',
                      'rules_passed', 'rules_failed', 'rules_bypassed',
                      'rules_not_applicable'];

    const exceptions = await cds.db.run(SELECT.from('fuelsphere.INVOICE_EXCEPTIONS'));
    const heads = await cds.db.run(SELECT.from('fuelsphere.INVOICES')
        .columns('ID', ...COUNTERS));
    const headById = new Map(heads.map(h => [h.ID, h]));

    const gated = heads.filter(h => h.posting_gate === 'GATED').length;
    console.log(`\n${exceptions.length} exception(s) raised; `
              + `${gated} invoice(s) gated of ${heads.length}`);

    if (!WRITE) {
        console.log('\nDRY RUN - nothing written. Re-run with --write.');
        return process.exit(0);
    }

    // WHO THE SEED SAYS DID THIS. At runtime both columns record the user who
    // pressed the button; headless there is no user, and a seed that says
    // "anonymous" on 30,762 rows is noise. The committed seed already had the
    // convention and it is kept: an exception names the HANDLER that raised it
    // (which is what fim-exceptions EXIT-1 reads, to prove no exception was
    // hand-authored), and a verdict names the AP clerk the scenario is written
    // around. Neither changes what the running system records.
    const SEED_HANDLER = 'VALIDATE_FOR_POSTING';
    const SEED_USER = 'ap.clerk@airline.com';

    const writeCsv = (file, columns, data, overrides) => {
        const lines = [columns.join(';')];
        for (const r of data) {
            lines.push(columns.map(c => field(c in overrides ? overrides[c] : r[c])).join(';'));
        }
        fs.writeFileSync(file, lines.join('\r\n') + '\r\n', 'utf8');
        console.log(`wrote ${data.length} rows to ${path.relative(PROJECT, file)}`);
    };

    writeCsv(OUT, cols, rows, { evaluated_by: SEED_USER });
    writeCsv(EXC, headerOf(EXC), exceptions, { detected_by: SEED_HANDLER });

    // The invoice file is UPDATED IN PLACE, row by row, so that only the ten
    // counter columns change and every other seeded value survives.
    //
    // THE READ HAS TO BE QUOTE-AWARE - fixed 13 Oct 2026.
    //
    // This rewrote rows by INDEX after `line.split(';')`. field() above
    // already quotes a value containing a semicolon, so a quoted notes field
    // splits into two and every column after `notes` (index 38) is read one
    // place to the left - which is where the counters live, at 44 to 50.
    //
    // Nine into-plane invoices came out with rules_not_applicable empty and
    // its value sitting in rules_bypassed, and the tool still said "updated
    // the counters on 104 of 104". Caught by idr-rule-status EXIT-1, whose
    // whole point is that the five counters must sum to the number evaluated.
    //
    // The WRITE side was always correct: field() is reused below, so a value
    // that needs quoting keeps its quotes on the way back out.
    const splitRow = (line) => {
        const fields = [];
        let cur = '';
        let quoted = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (quoted) {
                if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
                else if (ch === '"') quoted = false;
                else cur += ch;
            } else if (ch === '"') quoted = true;
            else if (ch === ';') { fields.push(cur); cur = ''; }
            else cur += ch;
        }
        fields.push(cur);
        return fields;
    };

    const invCols = headerOf(INV);
    const invText = fs.readFileSync(INV, 'utf8').replace(/^﻿/, '').split(/\r?\n/);
    const idAt = invCols.indexOf('ID');
    const out = [invCols.join(';')];
    let touched = 0;
    let misaligned = 0;
    for (const line of invText.slice(1)) {
        if (!line.trim()) continue;
        const f = splitRow(line);
        // A ROW WHOSE SHAPE WE STILL MISREAD IS COUNTED, NOT WRITTEN BLIND.
        // Rewriting by index into a row of the wrong length is precisely how
        // this corrupted nine invoices without saying a word.
        if (f.length !== invCols.length) misaligned += 1;
        const h = headById.get(f[idAt]);
        if (h) {
            for (const c of COUNTERS) {
                const at = invCols.indexOf(c);
                if (at >= 0) f[at] = h[c];
            }
            touched++;
        }
        out.push(f.map(field).join(';'));
    }
    fs.writeFileSync(INV, out.join('\r\n') + '\r\n', 'utf8');
    console.log(`updated the counters on ${touched} of ${invText.length - 2} invoice rows`);
    if (misaligned) {
        console.log(`  WARNING: ${misaligned} row(s) did not have ${invCols.length} fields even after `
                  + 'a quote-aware parse; their counters may be in the wrong columns.');
    }
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

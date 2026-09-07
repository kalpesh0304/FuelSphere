/**
 * D50 — EVERY ANNOTATION ON EVERY SERVICE POINTS AT SOMETHING THAT EXISTS.
 *
 * A dangling path INSIDE AN ANNOTATION RECORD emits no compiler warning. CAP
 * writes it into the EDMX verbatim - Path="statusCriticality" - and Fiori
 * resolves it to undefined and renders nothing. A dangling `annotate … element`
 * DOES warn, because that is the checked form. One form is checked, the other
 * is not, and the unchecked one looks finished.
 *
 * Three status columns on InvoiceService rendered grey for months on exactly
 * that mechanism, and the file's ONE compiler warning was about something else.
 *
 * WHY A SWEEP RATHER THAN A CHECKLIST. The thirteen findings were not one kind
 * of mistake:
 *
 *   nine   criticality elements referenced and never declared
 *   one    a plain wrong field name - formula_code for formula_id
 *   two    a two-hop path whose middle association was never exposed
 *   one    a facet target whose forward composition was never modelled
 *
 * Only the first was foreseeable. Nobody would have gone looking for
 * formula_code, and the compiler had nothing to say about any of them.
 *
 * THIS RUNS AGAINST THE EMITTED EDMX, not the source. What the compiler emits
 * is what Fiori reads, and the two are not the same document.
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
const cds    = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const out    = s => process.stdout.write('      ' + s + '\n');
// Same shape as every other harness here. This one needs no HTTP at all - it
// reads the compiled EDMX and nothing else - but cds.test() is what supplies
// describe/it and a loaded model, and one process per harness is the rule.
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
cds.test(PROJECT);

const PATH    = /(?<!Annotation)(?<!NavigationProperty)Path="([^"]+)"/;
const ANNPATH = /AnnotationPath="([^"]+)"/;
const all = (re, s) => [...s.matchAll(new RegExp(re.source, 'g'))].map(m => m[1]);

function parse(x) {
    const props = {}, navs = {}, navtype = {}, navmany = {};
    const add = (n, body) => {
        props[n] = new Set(all(/<Property Name="(\w+)"/, body));
        navs[n]  = new Set(all(/<NavigationProperty Name="(\w+)"/, body));
        navtype[n] = {};
        // CARDINALITY IS KEPT NOW, NOT DISCARDED. It was always in the EDMX -
        // a to-many emits Type="Collection(...)" - and this function stripped
        // it to get the target. EXIT-5 needs it, and it needed nothing new
        // from the compiler.
        navmany[n] = new Set();
        for (const m of body.matchAll(/<NavigationProperty Name="(\w+)" Type="([^"]+)"/g)) {
            if (m[2].startsWith('Collection(')) navmany[n].add(m[1]);
            navtype[n][m[1]] = m[2].replace('Collection(', '').replace(')', '').split('.').pop();
        }
    };
    for (const m of x.matchAll(/<EntityType Name="(\w+)"[^>]*>([\s\S]*?)<\/EntityType>/g)) add(m[1], m[2]);
    for (const m of x.matchAll(/<ComplexType Name="(\w+)"[^>]*>([\s\S]*?)<\/ComplexType>/g)) add(m[1], m[2]);
    return { props, navs, navtype, navmany };
}

/** Walk every emitted binding on one service. */
function walk(x, svc) {
    const { props, navs, navtype } = parse(x);
    const resolve = (ent, path) => {
        const parts = path.split('/'); let cur = ent;
        for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            if (i === parts.length - 1) return props[cur]?.has(p) || navs[cur]?.has(p) || false;
            if (navtype[cur]?.[p]) cur = navtype[cur][p]; else return false;
        }
        return false;
    };
    const badPaths = [], badFacets = []; let paths = 0, facets = 0;
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`<Annotations Target="${esc(svc)}\\.([\\w./]+)">([\\s\\S]*?)</Annotations>`, 'g');
    for (const m of x.matchAll(re)) {
        const target = m[1], body = m[2], ent = target.split('/')[0];
        if (!props[ent]) continue;                       // action/function/type target
        for (const p of all(PATH, body)) {
            paths++;
            if (!resolve(ent, p)) badPaths.push(`${svc}.${target} -> ${p}`);
        }
        for (const ap of all(ANNPATH, body)) {
            facets++;
            const i = ap.lastIndexOf('/');
            const nav  = i < 0 ? '' : ap.slice(0, i);
            const term = (i < 0 ? ap : ap.slice(i + 1)).replace(/^@/, '');
            let t = ent, ok = true;
            for (const hop of nav.split('/').filter(Boolean)) {
                if (navtype[t]?.[hop]) t = navtype[t][hop]; else { ok = false; break; }
            }
            if (ok) {
                const blk = x.match(new RegExp(
                    `<Annotations Target="${esc(svc)}\\.${esc(t)}">([\\s\\S]*?)</Annotations>`));
                const [base, qual] = term.split('#');
                const want = `Term="${base}"` + (qual ? ` Qualifier="${qual}"` : '');
                ok = !!blk && blk[1].includes(want);
            }
            if (!ok) badFacets.push(`${svc}.${target} -> ${ap}`);
        }
    }
    return { paths, facets, badPaths, badFacets };
}

describe('D50 — no annotation on any service points at nothing', () => {

  let edmx;   // { serviceName: xml }
  before(() => {
    edmx = {};
    for (const [xml, meta] of cds.compile.to.edmx(cds.model, { service: 'all', version: 'v4' }))
      edmx[meta.file.replace(/\.xml$/, '')] = xml;
  });

  it('EXIT-1  the reader is proved in BOTH directions before it is used', () => {
    // KNOWN-PRESENT.
    assert.deepStrictEqual(all(PATH, '<PropertyValue Property="Value" Path="invoice_number"/>'),
      ['invoice_number'], 'the plain value form is not matched');
    // KNOWN-ABSENT, and this is the one that matters. `Path="` is a SUBSTRING
    // of `AnnotationPath="`; a reader that does not exclude it reports every
    // correct facet as a broken value binding. That over-match cost a package.
    assert.deepStrictEqual(all(PATH, '<PropertyValue Property="Target" AnnotationPath="items/@UI.LineItem"/>'),
      [], 'OVER-MATCHED AnnotationPath as a value path');
    assert.deepStrictEqual(all(PATH, '<PropertyValue Property="Target" NavigationPropertyPath="items"/>'),
      [], 'OVER-MATCHED NavigationPropertyPath as a value path');
    assert.deepStrictEqual(all(ANNPATH, '<PropertyValue Property="Target" AnnotationPath="items/@UI.LineItem"/>'),
      ['items/@UI.LineItem'], 'the facet-target form is not matched');
    out('matches the plain form; refuses AnnotationPath and NavigationPropertyPath');
  });

  it('EXIT-2  and it BITES — a planted path and a planted facet are both reported', () => {
    const src = edmx['InvoiceService'];
    assert.ok(src, 'instrument check: InvoiceService did not compile, so nothing is being planted into');

    const p1 = src.replace('Path="invoice_number"', 'Path="no_such_column"');
    assert.notStrictEqual(p1, src, 'plant did not fire: the value path was never substituted');
    assert.ok(walk(p1, 'InvoiceService').badPaths.length > 0, 'a dangling value path went unreported');

    const p2 = src.replace(/AnnotationPath="([^"/]+)\/@/, 'AnnotationPath="no_such_nav/@');
    assert.notStrictEqual(p2, src, 'plant did not fire: the facet target was never substituted');
    assert.ok(walk(p2, 'InvoiceService').badFacets.length > 0, 'a dangling facet target went unreported');

    const p3 = src.replace(/AnnotationPath="([^"/]+)\/@UI\.(\w+)/, 'AnnotationPath="$1/@UI.NoSuchTerm');
    assert.ok(walk(p3, 'InvoiceService').badFacets.length > 0, 'a facet naming an absent TERM went unreported');
    out('three plants, three reports: absent property, absent navigation, absent term');
  });

  it('EXIT-3  ALL FIFTEEN SERVICES, zero dangling', () => {
    const names = Object.keys(edmx).sort();
    assert.strictEqual(names.length, 15, `expected 15 services, compiled ${names.length}`);

    let TP = 0, TF = 0; const bad = [];
    const rows = [];
    for (const svc of names) {
      const r = walk(edmx[svc], svc);
      TP += r.paths; TF += r.facets;
      bad.push(...r.badPaths, ...r.badFacets);
      if (r.paths || r.facets)
        rows.push(`${svc.padEnd(22)} ${String(r.paths).padStart(5)} paths  ${String(r.facets).padStart(4)} facets`);
    }
    for (const r of rows) out(r);
    for (const b of bad) out('  DANGLING  ' + b);
    assert.deepStrictEqual(bad, [], 'an annotation points at something that does not exist');

    // INSTRUMENT CHECK. A sweep that walks nothing passes vacuously, and the
    // eight services with no annotations at all make that easy to miss.
    assert.ok(TP > 1000, `only ${TP} value paths walked - the sweep is not reaching the annotations`);
    assert.ok(TF > 150,  `only ${TF} facet targets walked - the sweep is not reaching the facets`);
    out(`TOTAL ${TP} value paths and ${TF} facet targets across ${names.length} services, 0 dangling`);
  });

  it('EXIT-4  the four repaired sites still resolve, named individually', () => {
    const must = [
      ['PricingService',  'PricingFormulas', 'statusCriticality'],
      ['PricingService',  'MarketIndices',   'activeCriticality'],
      ['PricingService',  'PricingFormulas', 'formula_id'],
      ['InvoiceService',  'Invoices',        'gateCriticality'],
    ];
    for (const [svc, ent, prop] of must) {
      const { props } = parse(edmx[svc]);
      assert.ok(props[ent]?.has(prop), `${svc}.${ent}.${prop} is gone - a repair was reverted`);
    }
    // The two that are NAVIGATIONS rather than properties.
    const pr = parse(edmx['PricingService']);
    assert.ok(pr.navs['MarketIndices']?.has('values'),
      'MARKET_INDICES.values is gone - the Historical Values facet is empty again');
    const rf = parse(edmx['RefuelerService']);
    assert.ok(rf.navtype['DeliveryRecords']?.['signature_pilot_document'],
      'SourceDocuments is unexposed on RefuelerService - the signature fields are blank again');
    out('4 properties and 2 navigations, all present');
  });

  it('EXIT-5  A NINTH CAUSE — a path whose middle hop is a TO-MANY', async () => {
    // THE FIRST CAUSE WHERE THE ANNOTATION IS CORRECT AND THE SHAPE IS WRONG.
    //
    // The other eight are about what a path NAMES. This one is about what a
    // path can TRAVERSE: `designation/supplier/supplier_name` names three
    // real things and cannot bind, because FLIGHT_SCHEDULE.designation is an
    // Association to MANY and Fiori has no key for the first hop.
    //
    //     GET FlightSchedule(<id>)/designation/supplier   ->  404
    //
    // EXIT-3 would have passed it: every hop resolves to a real term on a
    // real entity. The sweep checked what a path names and never what it
    // could walk.
    //
    // IT COSTS NOTHING TO CHECK. Cardinality was always in the EDMX - a
    // to-many emits Type="Collection(...)" - and parse() was stripping it to
    // get the target type. The instrument had the evidence and discarded it.
    //
    // A TO-MANY AS THE LAST HOP IS CORRECT and must not be flagged: a facet
    // target like `contacts/@UI.LineItem` is exactly that, and it is how
    // every table on an object page is bound. Only a to-many with further
    // hops after it is unbindable.
    let checked = 0; const bad = [];
    for (const [svc, x] of Object.entries(edmx)) {
      const { navtype, navmany } = parse(x);
      for (const m of x.matchAll(/<Annotations Target="[^."]+\.(\w+)[^"]*">([\s\S]*?)<\/Annotations>/g)) {
        const ent = m[1];
        for (const path of all(PATH, m[2])) {
          const parts = path.split('/');
          if (parts.length < 3) { checked++; continue; }   // no middle hop to be wrong
          let cur = ent;
          for (let i = 0; i < parts.length - 1; i++) {
            if (navmany[cur]?.has(parts[i]) && i < parts.length - 2)
              bad.push(`${svc}.${ent} -> ${path}  (to-many at "${parts[i]}")`);
            cur = navtype[cur]?.[parts[i]];
            if (!cur) break;
          }
          checked++;
        }
      }
    }
    // PROVE THE READER BEFORE TRUSTING THE COUNT, in both directions - the
    // rule EXIT-1 sets for this file, applied to the new check.
    const pl = parse(edmx['PlanningService']);
    assert.ok(pl.navmany['FlightSchedule']?.has('designation'),
      'instrument check: FlightSchedule.designation is not seen as a to-many, so this criterion is blind');
    assert.ok(!pl.navmany['FlightSchedule']?.has('tail'),
      'instrument check: FlightSchedule.tail is reported as a to-many and is not - the reader over-reports');

    // ONE KNOWN, RECORDED RATHER THAN ASSERTED AWAY, AND IT IS NOT MINE TO
    // FIX. Package A put the designated supplier in FlightSchedule's
    // SelectionFields and LineItem because the SME asked for it twice - as a
    // filter AND as a list column. station_default is an Association to
    // MANY, so it has never shown a name:
    //
    //     $select=station_default/supplier/supplier_name
    //       -> 200, "station_default_supplier_supplier_name": null, always
    //     $select=tail/registration
    //       -> 200, "tail_registration": "RP-C8801"
    //
    // The repair is a DECISION, not a patch. A to-one over station_code is
    // D44 exactly - a to-one over a condition matching many - and copying
    // the name onto the flight is what D's "resolved, never copied" rule
    // forbids and d-designated-suppliers EXIT-9 asserts against. So it is
    // ratcheted: this one entry is accepted, and any NEW occurrence fails.
    const KNOWN = new Set([
      'PlanningService.FlightSchedule -> station_default/supplier/supplier_name  (to-many at "station_default")',
    ]);
    const fresh = bad.filter(b => !KNOWN.has(b));
    assert.deepStrictEqual(fresh, [],
      `${fresh.length} NEW path(s) traverse a to-many mid-way and CANNOT BIND. Every hop is real and `
    + `the annotation reads correctly - Fiori has no key for the collection hop, and the field comes `
    + `back present and null:\n  ` + fresh.slice(0, 6).join('\n  '));
    // The ratchet must not rust: a KNOWN entry that has been repaired has to
    // come off, or the list becomes a record of decisions nobody took.
    const stale = [...KNOWN].filter(k => !bad.includes(k));
    assert.deepStrictEqual(stale, [],
      `a known unbindable path now binds - take it out of KNOWN: ${stale.join(', ')}`);
    out(`${checked} paths across ${Object.keys(edmx).length} services, ${bad.length} traversing a `
      + `to-many mid-way (${KNOWN.size} known, 0 new)`);
  });
});

/**
 * THE SERVICE SURFACE THIS REPOSITORY DECLARES.
 *
 * RE-HOMED FROM e2b-eight-cards-harness, WHICH WAS RETIRED WITH THE OVP APP.
 *
 * THE CONSUMER IS EXTERNAL AND THAT IS NOT WHY THESE ARE GUARDED. flight-
 * overview left this repository and is deployed and version-controlled
 * separately, so the harness that read its manifest was correctly removed -
 * the manifest is not here to read.
 *
 * But two of its criteria tested THIS REPOSITORY'S DECLARATIONS, and those
 * did not leave with it:
 *
 *   the D47 405   the `entity … as projection on …` lines that make a set
 *                 addressable are in srv/planning-service.cds
 *   the filter    the views carrying the global filter's property names are
 *                 in db/
 *
 * Someone will later ask why a harness here checks addressability for a page
 * that is not here. THE ANSWER IS THAT THE SURFACE IS OURS AND THE PAGE IS
 * NOT. "An app elsewhere depends on this" is a weaker reason to guard
 * something than "this repository declares it" - the first stops being true
 * when the app changes hands, and the second does not.
 *
 *   EXIT-1  every entity set is ADDRESSABLE except a recorded few — D47
 *   EXIT-2  every flight-scoped set carries the GLOBAL FILTER'S NAMES
 *   EXIT-3  no field group is defined and left unreferenced, beyond two recorded
 *   EXIT-4  no ORPHANED group duplicates a REFERENCED one — the actual-routing
 *           pathology, swept across all fifteen services
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert');
const test=cds.test(PROJECT); const out=s=>process.stdout.write('      '+s+'\n');
const P='/odata/v4/planning';

// The OVP propagates its filter BY MATCHING PROPERTY NAMES against the global
// filter entity. FlightSchedule's key is ID, so the bar NEVER emits flight_ID
// - an entity carrying only flight_ID overlaps the filter on nothing and its
// card shows the whole fleet on a page about one flight.
const FILTER_NAMES = ['flight_number','flight_date','origin_airport',
                      'destination_airport','aircraft_type','airline_code','status'];

describe('The service surface this repository declares', () => {

  let md, sets, props, typeOf;
  before(async () => {
    md = (await test.GET(`${P}/$metadata`)).data;
    sets = [...md.matchAll(/<EntitySet Name="(\w+)"/g)].map(m=>m[1]);
    props = {};
    for (const m of md.matchAll(/<EntityType Name="(\w+)"[^>]*>([\s\S]*?)<\/EntityType>/g))
      props[m[1]] = new Set([...m[2].matchAll(/<Property Name="(\w+)"/g)].map(q=>q[1]));
    typeOf = {};
    for (const m of md.matchAll(/<EntitySet Name="(\w+)" EntityType="[\w.]*?\.(\w+)"/g))
      typeOf[m[1]] = m[2];
  });
  const propsOf = (s) => props[typeOf[s]] || new Set();

  it('EXIT-1  every entity set is ADDRESSABLE except a recorded few — D47', async () => {
    // An auto-exposed view is navigable and NOT addressable: the auth layer
    // returns 405 to anything naming the set (@cds.autoexposed without
    // @cds.autoexpose), and the page renders empty with NO ERROR A VIEWER CAN
    // SEE. It only surfaces when something addresses the set.
    //
    // The four below are D47, recorded and deliberate:
    //   three are auto-exposed and undeclared, and making one addressable is a
    //   decision about what this service exposes - not a tidy-up
    //   AIRCRAFT_OPSTATUS_texts is a CAP LOCALISATION CHILD and is CORRECTLY
    //   REFUSED. D47 says in terms: do not "fix" it.
    const KNOWN_405 = new Set(['CONTRACT_LOCATIONS','CONTRACT_PRODUCTS',
                               'FORMULA_COMPONENTS','AIRCRAFT_OPSTATUS_texts']);
    const refused = [];
    for (const s of sets) {
      let code = 200;
      try { await test.GET(`${P}/${s}?$top=1`); }
      catch (e) { code = e.response ? e.response.status : 0; }
      if (code !== 200) refused.push(`${s}:${code}`);
    }
    const fresh = refused.filter(r => !KNOWN_405.has(r.split(':')[0]));
    assert.deepStrictEqual(fresh, [],
      `${fresh.length} entity set(s) are no longer addressable: ${fresh.join(', ')}. A 405 means the `
    + `explicit projection was removed and CAP is only auto-exposing it - anything naming the set gets `
    + `refused and renders empty with no error a viewer can see.`);

    // THE STALE HALF, WHICH IS WHAT KEEPS THE LIST HONEST. A repair must make
    // this fail, or an accepted entry quietly becomes permission.
    const stale = [...KNOWN_405].filter(k => !refused.some(r => r.split(':')[0] === k));
    assert.deepStrictEqual(stale, [],
      `${stale.join(', ')} is now addressable and still on the accepted list. Take it off - `
    + `an accepted list nobody re-derives becomes a record of decisions nobody took.`);
    out(`${sets.length} entity sets: ${sets.length - refused.length} addressable, `
      + `${refused.length} refused and all four recorded (D47)`);
  });

  it('EXIT-2  every flight-scoped set carries the GLOBAL FILTER\'S NAMES', async () => {
    // THE flight_ID MISTAKE, ASSERTED. Four entities once carried a flight
    // reference and none of the names the filter propagates BY, and they were
    // reported ready - "has a flight reference" is a DIFFERENT QUESTION from
    // "filters", and answering the first is how that happened.
    //
    // FlightDesignatedSupplier is the one exception and it is NOT a defect:
    // it is reached through a to-ONE from FlightSchedule (`designated`) and is
    // never addressed by a filter bar, so it needs no names of its own. It is
    // recorded rather than exempted silently, and if something ever DOES
    // address it directly this is where to look.
    const NAVIGATION_ONLY = new Set(['FlightDesignatedSupplier']);
    const scoped = sets.filter(s => {
      const p = propsOf(s);
      return p.has('flight_number') || p.has('flight_ID');
    });
    assert.ok(scoped.length >= 10,
      `only ${scoped.length} flight-scoped sets found - the reader is blind and its silence means nothing`);

    const report = [];
    for (const s of scoped) {
      const held = FILTER_NAMES.filter(f => propsOf(s).has(f));
      if (NAVIGATION_ONLY.has(s)) {
        assert.strictEqual(held.length, 0,
          `${s} now carries ${held.join('/')} and is on the navigation-only list. If it gained the `
        + `filter names deliberately, take it off the list; if not, something widened it by accident.`);
        report.push(`${s}:nav-only`);
        continue;
      }
      assert.ok(held.includes('flight_number'),
        `${s} carries ${held.join('/') || 'NONE'} of the global filter's names but not flight_number. `
      + `The OVP propagates BY MATCHING PROPERTY NAMES, so this set would ignore the filter and show `
      + `the whole fleet on a page about one flight. Carrying flight_ID is not enough: `
      + `FlightSchedule's key is ID, so the filter bar never emits flight_ID.`);
      report.push(`${s}:${held.length}/${FILTER_NAMES.length}`);
    }
    out(`${scoped.length} flight-scoped sets — ` + report.join('  '));
  });

  it('EXIT-3  no field group is defined and left UNREFERENCED, beyond two recorded', async () => {
    // A group nobody references is invisible: an unreferenced annotation is
    // not an error, emits no warning, and renders nothing.
    //
    // REFERENCES ARE SERVICE-WIDE, NOT BLOCK-LOCAL, and getting that wrong is
    // how the first pass of this sweep reported EIGHT orphans when there are
    // TWO. A facet can name a group on another entity through an association -
    // FlightSchedule reaches `tail/@UI.FieldGroup#AircraftForFlight`. Scoped
    // to each entity's own block, six referenced groups read as orphans.
    const KNOWN_ORPHAN = new Set([
      'BurnService.FlightSchedule#BurnFlightRoute',
      'BurnService.FuelDeliveries#BurnDeliveryUplift'
    ]);
    const { orphans } = sweepGroups();
    const fresh = orphans.filter(o => !KNOWN_ORPHAN.has(o));
    assert.deepStrictEqual(fresh, [],
      `${fresh.length} field group(s) are defined and no facet reaches them:\n  ${fresh.join('\n  ')}\n`
    + `An unreferenced annotation emits no warning and renders nothing, so it is invisible to every `
    + `other instrument here.`);
    const stale = [...KNOWN_ORPHAN].filter(k => !orphans.includes(k));
    assert.deepStrictEqual(stale, [],
      `${stale.join(', ')} is now referenced and still on the accepted list - take it off.`);
    out(`${orphans.length} orphaned field groups across all services, both recorded`);
  });

  it('EXIT-4  no ORPHANED group DUPLICATES a REFERENCED one — the actual-routing pathology', () => {
    // THE TENTH CAUSE OF A SECTION THAT READS WRONG. FLIGHT_SCHEDULE carried
    // #ActualStations (readable, orphaned) beside #ActualRouting (on the page,
    // binding a GUID). BOTH RESOLVED, so no dangling sweep said anything, and
    // the data was null everywhere so neither rendered - there was no symptom
    // at all.
    //
    // The class is a duplicated annotation where the copies differ in QUALITY
    // rather than in VALIDITY, and every instrument here checks validity. A
    // sweep that walks every path walks both and approves both.
    //
    // MEASURED ONCE ACROSS ALL FIFTEEN SERVICES: 25 pairs share most of their
    // leaves and NOT ONE involves an orphan - that is the ordinary Fiori
    // summary-plus-detail pattern, both groups rendered. So actual routing was
    // the ONLY instance of the full pathology, and this criterion exists to
    // keep it that way rather than to work through a backlog.
    const { pathological, dupPairs } = sweepGroups();
    assert.deepStrictEqual(pathological, [],
      `${pathological.length} orphaned field group(s) duplicate a REFERENCED group on the same `
    + `entity:\n  ${pathological.join('\n  ')}\n`
    + `One of the two is on the page and the other is not, both resolve, and nothing says which was `
    + `chosen. Ask WHICH GROUP THE FACET ACTUALLY NAMES - no other instrument here asks it.`);
    assert.ok(dupPairs > 0,
      'instrument check: no overlapping group pair was found at all, so this criterion read nothing '
    + 'and would pass however broken the sweep is');
    out(`${dupPairs} overlapping group pairs across all services, 0 involving an orphan`);
  });
});

// ---------------------------------------------------------------------------
function sweepGroups() {
  const m = cds.model;
  const services = Object.values(m.definitions).filter(d => d.kind === 'service').map(d => d.name);
  const orphans = [], pathological = []; let dupPairs = 0;

  for (const svc of services) {
    let edmx; try { edmx = cds.compile.to.edmx(m, { service: svc, version: 'v4' }); } catch { continue; }
    const referenced = new Set(
      [...edmx.matchAll(/AnnotationPath="[^"]*@UI\.FieldGroup#(\w+)"/g)].map(x => x[1]));
    for (const blk of edmx.matchAll(/<Annotations Target="([\w.]+)">([\s\S]*?)<\/Annotations>/g)) {
      const [, target, body] = blk;
      if (target.includes('/')) continue;
      const groups = [...body.matchAll(/<Annotation Term="UI.FieldGroup" Qualifier="(\w+)">/g)].map(x => x[1]);
      if (!groups.length) continue;
      const leaves = {};
      for (const g of groups) {
        const mm = new RegExp(`<Annotation Term="UI.FieldGroup" Qualifier="${g}">[\\s\\S]*?</Annotation>`).exec(body);
        leaves[g] = new Set(mm ? [...mm[0].matchAll(/Path="([^"]*)"/g)].map(x => x[1].split('/').pop()) : []);
      }
      for (const g of groups) if (!referenced.has(g)) orphans.push(`${target}#${g}`);
      for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
        const a = leaves[groups[i]], b = leaves[groups[j]];
        const shared = [...a].filter(x => b.has(x));
        const small = Math.min(a.size, b.size);
        if (small >= 2 && shared.length >= Math.ceil(small * 0.6)) {
          dupPairs++;
          const oi = !referenced.has(groups[i]), oj = !referenced.has(groups[j]);
          // ONE orphaned and one referenced is the pathology. BOTH orphaned is
          // dead weight, not a wrong screen; NEITHER orphaned is the ordinary
          // summary-plus-detail pattern.
          if (oi !== oj) pathological.push(
            `${target}  #${groups[i]}${oi ? '(orphan)' : ''} vs #${groups[j]}${oj ? '(orphan)' : ''}`
          + `  share ${shared.length}/${small}`);
        }
      }
    }
  }
  return { orphans, pathological, dupPairs };
}

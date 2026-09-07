/**
 * E2b — THE FLIGHT FUEL OVERVIEW'S EIGHT CARDS.
 *
 * EIGHT, NOT NINE. The mockup shows nine; card 9 (Invoicing) is deliberately
 * absent because an airline planner's overview reaching the invoicing entity
 * is a MODULE boundary rather than a convenience. EXIT-1 asserts the count so
 * someone counting the mockup finds an answer rather than a discrepancy.
 *
 * WHAT EACH CRITERION IS FOR, AND HOW IT FAILS - asked while writing it.
 *
 *   EXIT-1  eight cards, and card 9 is absent BY DECISION
 *           fails if a ninth is added without the boundary being revisited
 *   EXIT-2  every card's entity is ADDRESSABLE (200, not 405)
 *           fails on the D47 auto-exposed trap, which renders a card empty
 *           with no error a viewer can see
 *   EXIT-3  every card's entity carries a GLOBAL FILTER NAME
 *           fails on the flight_ID mistake: an entity with a flight
 *           reference but not the name the filter propagates BY shows the
 *           whole fleet on a page about one flight
 *   EXIT-4  every card's annotation RESOLVES IN THE EDMX
 *           fails on a dangling path - D50, which rendered silently for
 *           months
 *   EXIT-5  ON THE DEMO FLIGHT, every card shows rows with no blank cell
 *           fails if the demo would show a half-built card. NOT asserted
 *           fleet-wide, and EXIT-6 is why
 *   EXIT-6  the partial flights are RECORDED, not asserted away
 *           fails if the set of complete flights changes without anyone
 *           noticing - in either direction
 *   EXIT-7  no card sorts on an alphabetical accident
 *           fails if a sort key is a string whose order is coincidence
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert');
const fs=require('node:fs');
const test=cds.test(PROJECT); const out=s=>process.stdout.write('      '+s+'\n');
const O='/odata/v4/planning';

const manifest = () => JSON.parse(
    fs.readFileSync(`${PROJECT}/app/flight-overview/webapp/manifest.json`,'utf8'));
const cards = () => manifest()['sap.ovp'].cards;

// The names FlightSchedule's SelectionFields emit. flight_ID is NOT among
// them - FlightSchedule's key is ID - which is the whole EXIT-3 point.
const FILTER_NAMES = ['flight_number','flight_date','origin_airport',
                      'destination_airport','aircraft_type','airline_code','status'];

// MEASURED, NOT CHOSEN. Every flight in the seed was swept; these three are
// the ones where all eight cards render rows with no blank cell.
const COMPLETE_FLIGHTS = ['AC410','AC412','AC856'];
const DEMO_FLIGHT = 'AC410';

let edmx;
const linePaths = (ent, qual) => {
    const blk = new RegExp(`<Annotations Target="PlanningService\\.${ent}">([\\s\\S]*?)</Annotations>`).exec(edmx);
    assert.ok(blk, `no annotation block for ${ent} in the EDMX`);
    const li = new RegExp(`Term="UI.LineItem" Qualifier="${qual}">([\\s\\S]*?)</Annotation>`).exec(blk[1]);
    assert.ok(li, `${ent} carries no UI.LineItem#${qual} in the EDMX`);
    return [...li[1].matchAll(/<PropertyValue Property="Value" Path="([^"]+)"/g)].map(m => m[1]);
};
const cardQuery = (s, flight, top = 5) => {
    const paths = linePaths(s.entitySet, s.annotationPath.split('#')[1]);
    const sel = paths.filter(p => !p.includes('/'));
    const exp = [...new Set(paths.filter(p => p.includes('/')).map(p => p.split('/')[0]))];
    return { paths, url: `${O}/${s.entitySet}?$select=${sel.join(',')}`
        + (exp.length ? `&$expand=${exp.join(',')}` : '')
        + (flight ? `&$filter=${encodeURIComponent(`flight_number eq '${flight}'`)}` : '')
        + `&$orderby=${s.sortBy} ${s.sortOrder === 'descending' ? 'desc' : 'asc'}&$top=${top}` };
};
const dig = (r, p) => p.split('/').reduce((v, k) => (v && typeof v === 'object') ? v[k] : undefined, r);

describe('E2b — the eight cards of the Flight Fuel Overview', () => {

    before(async () => { edmx = (await test.GET(`${O}/$metadata`)).data; });

    it('EXIT-1  EIGHT cards, and the ninth is absent by decision', () => {
        const c = cards();
        assert.strictEqual(Object.keys(c).length, 8,
            `${Object.keys(c).length} cards. THE MOCKUP SHOWS NINE AND THIS PAGE HAS EIGHT.\n`
          + '  Card 9 (Invoicing) is deliberately absent: an airline planner\'s overview\n'
          + '  reaching the invoicing entity is a MODULE boundary rather than a convenience,\n'
          + '  and the invoicing story has its own screens. A planner asking "has this been\n'
          + '  billed" is the coverage report, which starts from the ticket, not the flight.\n'
          + '  The reason is written at the exposure site in planning-service.cds, where it\n'
          + '  reads as a decision. Adding a ninth means revisiting that boundary.');
        const sets = Object.values(c).map(x => x.settings.entitySet);
        assert.ok(!sets.some(s => /Invoice/i.test(s)),
            `a card now binds an invoicing entity: ${sets.filter(s => /Invoice/i.test(s))}`);
        out(`${sets.length} cards: ${sets.join(', ')}`);
    });

    it('EXIT-2  every card entity is ADDRESSABLE — 200, not the D47 405', async () => {
        for (const [n, c] of Object.entries(cards())) {
            const r = await test.GET(`${O}/${c.settings.entitySet}?$top=1`).catch(e => e);
            const code = r.response ? r.response.status : (r.status || 200);
            assert.strictEqual(code, 200,
                `${n} -> ${c.settings.entitySet} returns ${code}. A 405 means CAP auto-exposed it `
              + `and the auth layer refuses a direct read (@cds.autoexposed without @cds.autoexpose) `
              + `- the card renders empty with no error a viewer can see.`);
        }
        out(`all ${Object.keys(cards()).length} card entity sets return 200`);
    });

    it('EXIT-3  every card entity carries a GLOBAL FILTER NAME — not just a flight reference', async () => {
        // THE flight_ID MISTAKE, ASSERTED. Four entities carried a flight
        // reference and none of the names the filter propagates BY. "Has a
        // flight reference" is a different question from "filters", and
        // answering the first is how four cards were reported ready.
        const report = [];
        for (const [n, c] of Object.entries(cards())) {
            const ent = c.settings.entitySet;
            const held = [];
            for (const f of FILTER_NAMES) {
                try { await test.GET(`${O}/${ent}?$select=${f}&$top=1`); held.push(f); } catch { /* absent */ }
            }
            assert.ok(held.length > 0,
                `${n} -> ${ent} carries NONE of the global filter's names (${FILTER_NAMES.join(', ')}). `
              + `The OVP propagates by matching property names, so this card would ignore the filter `
              + `and show the whole fleet on a page about one flight. Carrying flight_ID is not enough: `
              + `FlightSchedule's key is ID, so the filter bar never emits flight_ID.`);
            assert.ok(held.includes('flight_number'),
                `${n} -> ${ent} carries ${held.join('/')} but not flight_number, which is the field the `
              + `page is actually filtered by`);
            report.push(`${ent}:${held.length}/${FILTER_NAMES.length}`);
        }
        out(report.join('  '));
    });

    it('EXIT-4  every card annotation RESOLVES IN THE EDMX', async () => {
        let total = 0;
        for (const [n, c] of Object.entries(cards())) {
            const s = c.settings;
            const paths = linePaths(s.entitySet, s.annotationPath.split('#')[1]);
            assert.ok(paths.length >= 4, `${n} binds only ${paths.length} field(s)`);
            // Every path must be queryable - a dangling one is D50, which
            // renders as a blank column and warns about nothing.
            const { url } = cardQuery(s, null, 1);
            await test.GET(url);
            total += paths.length;
        }
        out(`${total} bound paths across ${Object.keys(cards()).length} cards, every one queryable`);
    });

    it('EXIT-5  ON THE DEMO FLIGHT every card shows rows, with no blank cell', async () => {
        // THE RULE THAT COST A CARD: assert the data THE CARD WILL SHOW -
        // its own sortBy, its own order, its own row count - not that the
        // entity has rows somewhere.
        const lines = [];
        for (const [n, c] of Object.entries(cards())) {
            const s = c.settings;
            const { paths, url } = cardQuery(s, DEMO_FLIGHT, 5);
            const { data } = await test.GET(url);
            assert.ok(data.value.length > 0,
                `${n} -> ${s.entitySet} returns NO ROWS for ${DEMO_FLIGHT}. The card renders empty `
              + `on the demo flight.`);
            for (const [i, r] of data.value.entries())
                for (const p of paths)
                    assert.ok(dig(r, p) !== null && dig(r, p) !== undefined,
                        `${n}: visible row ${i + 1} has no ${p} — the card shows a blank cell on the `
                      + `demo flight`);
            lines.push(`${n.replace(/^card\d+_/, '')}=${data.value.length}`);
        }
        out(`${DEMO_FLIGHT}: ${lines.join('  ')} — no blank cell in any visible row`);
    });

    it('EXIT-6  THE PARTIAL FLIGHTS ARE RECORDED, not asserted away', async () => {
        // NOT A UNIVERSAL. Most flights render some card empty or with a
        // blank cell, and that is the DATA being honest: AC401 was never
        // fuelled in the seed, so no delivery, ticket or burn exists; the
        // flights departing stations with no designation show none, which is
        // the 1 September decision that the vendor does not default.
        //
        // Asserting "no blanks on every flight" would fail on truthful data
        // and would push someone to invent rows to make it pass - the thing
        // these criteria exist to prevent. So the COMPLETE SET is ratcheted
        // instead, and it fails in BOTH directions: a flight silently losing
        // its data, or one gaining it without anyone noticing.
        const flights = [...new Set((await test.GET(
            `${O}/FlightSchedule?$select=flight_number&$top=100`)).data.value.map(f => f.flight_number))];
        const complete = [];
        for (const f of flights) {
            let ok = true;
            for (const c of Object.values(cards())) {
                const { paths, url } = cardQuery(c.settings, f, 5);
                const { data } = await test.GET(url);
                if (!data.value.length || data.value.some(r => paths.some(p =>
                        dig(r, p) === null || dig(r, p) === undefined))) { ok = false; break; }
            }
            if (ok) complete.push(f);
        }
        assert.deepStrictEqual(complete.sort(), [...COMPLETE_FLIGHTS].sort(),
            `the set of flights where all eight cards are complete has changed.\n`
          + `  recorded: ${COMPLETE_FLIGHTS.join(', ')}\n`
          + `  measured: ${complete.join(', ')}\n`
          + `  If a flight was LOST, a card has stopped rendering. If one was GAINED, the seed grew\n`
          + `  and the list should be updated deliberately rather than by a passing test.`);
        assert.ok(complete.includes(DEMO_FLIGHT),
            `${DEMO_FLIGHT} is the demo flight and is no longer complete`);
        out(`${flights.length} flights swept; all eight cards complete on ${complete.join(', ')} `
          + `— the rest are partial because the seed is, not because a card is broken`);
    });

    it('EXIT-7  no card sorts on an alphabetical accident', () => {
        // `FLIGHT` < `STATION` is true and sorting the designation card on
        // `axis` would work TODAY - by coincidence, and silently wrong the
        // day a third axis is added. Same family as recon_status desc putting
        // VARIANCE first, and as criticality-as-a-sort-key. A reading order
        // is a decision and needs its own element.
        const BANNED = { FlightDesignation: 'axis' };
        for (const [n, c] of Object.entries(cards())) {
            const s = c.settings;
            const banned = BANNED[s.entitySet];
            assert.notStrictEqual(s.sortBy, banned,
                `${n} sorts on "${banned}", whose order is an ALPHABETICAL ACCIDENT. Use the explicit `
              + `rank element (axis_rank) - FLIGHT first because it is the axis that governs.`);
        }
        assert.strictEqual(cards().card03_designation.settings.sortBy, 'axis_rank',
            'the designation card must sort on axis_rank, not on the axis string');
        out(`sorts: ${Object.values(cards()).map(c => c.settings.sortBy).join(', ')}`);
    });
});

/**
 * THE FOUR DRILL-DOWNS — order, ticket, dispatch, delivery from a flight.
 *
 * WHAT THE DEFECT WAS, so the criteria assert the right thing: not a thin
 * projection. Three of the four carried a UI.HeaderInfo and ZERO UI.Facets,
 * so the page rendered a title and had NOWHERE TO PUT A BODY. The fields
 * were exposed the whole time.
 *
 *   EXIT-1  every drill target has FACETS, not just a header
 *   EXIT-2  every field group's every field EXISTS — the trap that fails
 *           the whole read rather than the column
 *   EXIT-3  the facets EXECUTE against live data on a flight-linked row
 *   EXIT-4  the ticket page carries the conversion: metered, its unit, mass
 *   EXIT-5  no _kg field takes its unit from a sibling uom_code
 *   EXIT-6  the flight facets are empty on rows with NO FLIGHT — D46,
 *           asserted as data rather than mistaken for a broken binding
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert');
const test=cds.test(PROJECT); const out=s=>process.stdout.write('      '+s+'\n');
const O='/odata/v4/planning';
const TARGETS=['FuelOrders','FLIGHT_FUEL_TICKETS','FlightDispatches','FLIGHT_FUEL_DELIVERIES'];
const DEMO='AC410';

let edmx;
const block = e => {
    const m = new RegExp(`<Annotations Target="PlanningService\\.${e}">([\\s\\S]*?)</Annotations>`).exec(edmx);
    assert.ok(m, `${e} carries no annotations at all`);
    return m[1];
};
const facetTargets = e => {
    const f = /Term="UI\.Facets"([\s\S]*?)\n        <\/Annotation>/.exec(block(e));
    return f ? [...f[1].matchAll(/Property="Target" AnnotationPath="@([\w.#]+)"/g)].map(m => m[1]) : [];
};
const groupPaths = (e, qual) => {
    const g = new RegExp(`Term="UI.FieldGroup" Qualifier="${qual}">([\\s\\S]*?)\\n        </Annotation>`).exec(block(e));
    assert.ok(g, `${e} facet points at @UI.FieldGroup#${qual} and the EDMX has no such group`);
    return [...g[1].matchAll(/<PropertyValue Property="Value" Path="([^"]+)"/g)].map(m => m[1]);
};
const dig = (r, p) => p.split('/').reduce((v, k) => (v && typeof v === 'object') ? v[k] : undefined, r);
const query = (ent, paths, filter) => {
    const sel = paths.filter(p => !p.includes('/'));
    const exp = [...new Set(paths.filter(p => p.includes('/')).map(p => p.split('/')[0]))];
    return `${O}/${ent}?$select=${sel.join(',')}`
         + (exp.length ? `&$expand=${exp.join(',')}` : '')
         + (filter ? `&$filter=${encodeURIComponent(filter)}` : '') + '&$top=1';
};

describe('The four drill-downs from a flight', () => {

    before(async () => { edmx = (await test.GET(`${O}/$metadata`)).data; });

    it('EXIT-1  every drill target has FACETS, not just a header', () => {
        // A HEADER WITH NO FACETS IS THE DEFECT. It renders the title and
        // has nowhere to put the body - which reads as "the page is empty"
        // and is diagnosed as a thin projection, which it was not.
        const report = [];
        for (const e of TARGETS) {
            const f = facetTargets(e);
            assert.ok(f.length >= 2,
                `${e} has ${f.length} facet(s). A UI.HeaderInfo with no UI.Facets renders a title `
              + `and an empty body - the exact symptom reported on the ticket, dispatch and delivery `
              + `pages. The fields are exposed; there was nowhere to put them.`);
            report.push(`${e}=${f.length}`);
        }
        out(report.join('  '));
    });

    it('EXIT-2  EVERY field of EVERY group exists — the whole-read trap', async () => {
        // A FieldGroup naming a field the projection lacks fails the WHOLE
        // READ rather than the column. Four new blocks against restricted
        // projections is four chances at it, and the failure is silent in
        // one direction and loud in the other.
        let groups = 0, fields = 0;
        for (const e of TARGETS)
            for (const t of facetTargets(e)) {
                const qual = t.split('#')[1];
                const paths = groupPaths(e, qual);
                assert.ok(paths.length >= 3, `${e}#${qual} binds only ${paths.length} field(s)`);
                await test.GET(query(e, paths, null));   // throws if any path is unknown
                groups++; fields += paths.length;
            }
        out(`${groups} field groups, ${fields} fields, every one queryable`);
    });

    it('EXIT-3  the facets EXECUTE on a flight-linked row', async () => {
        // Not "the annotation resolves". The rows a reader arriving from a
        // flight will actually see.
        const lines = [];
        for (const e of TARGETS) {
            let filled = 0, total = 0;
            for (const t of facetTargets(e)) {
                const paths = groupPaths(e, t.split('#')[1]);
                const { data } = await test.GET(query(e, paths, `flight_number eq '${DEMO}'`));
                assert.ok(data.value.length,
                    `${e} returns no row for ${DEMO} — the drill-down from the demo flight lands on nothing`);
                for (const p of paths) { total++; if (dig(data.value[0], p) != null) filled++; }
            }
            assert.ok(filled / total > 0.6,
                `${e}: only ${filled} of ${total} fields populate on ${DEMO} — the page would read mostly blank`);
            lines.push(`${e} ${filled}/${total}`);
        }
        out(lines.join('  '));
    });

    it('EXIT-4  THE TICKET CARRIES THE CONVERSION — metered, its unit, the mass', async () => {
        // The reported symptom was a header and "no quantities at all", and
        // the metered volume beside the derived mass is the argument the
        // whole module makes.
        const paths = groupPaths('FLIGHT_FUEL_TICKETS', 'TicketQty');
        for (const f of ['quantity_metered', 'uom_code', 'quantity_kg'])
            assert.ok(paths.includes(f),
                `the ticket quantity group does not show ${f}. Metered, its unit and the mass are `
              + `what makes 2884 LTR and 2305.76 kg legible as one uplift rather than two numbers.`);
        assert.ok(paths.indexOf('quantity_metered') < paths.indexOf('quantity_kg'),
            'the metered figure must precede the mass: the supplier measured a volume and density converted it');
        const { data } = await test.GET(query('FLIGHT_FUEL_TICKETS', paths, `flight_number eq '${DEMO}'`));
        const r = data.value[0];
        assert.ok(r.quantity_metered && r.uom_code && r.quantity_kg,
            `on ${DEMO} the ticket shows metered=${r.quantity_metered} uom=${r.uom_code} kg=${r.quantity_kg} `
          + `— all three must be present or the conversion is not visible`);
        out(`${DEMO}: metered=${r.quantity_metered} ${r.uom_code}  density=${r.density_value}  mass=${r.quantity_kg} kg`);
    });

    it('EXIT-5  NO _kg FIELD TAKES ITS UNIT FROM A SIBLING uom_code', async () => {
        // THE TRAP THAT WOULD MAKE THIS WORSE, NOT BETTER. uom_code is the
        // unit of the METERED figure only. Pointing @Measures.Unit at a _kg
        // field renders a mass AS LITRES - and it is not theoretical:
        // uom_code is LTR on 14 of 30 tickets and KG on 16, so the same
        // annotation would be right on half the rows and wrong on the rest,
        // with nothing on screen to tell them apart.
        const wrong = [];
        for (const e of TARGETS) {
            const b = block(e);
            for (const m of b.matchAll(/<Annotations Target="PlanningService\.\w+\/(\w+)">/g)) { void m; }
            for (const m of edmx.matchAll(
                new RegExp(`<Annotations Target="PlanningService\\.${e}/(\\w+)">([\\s\\S]*?)</Annotations>`, 'g'))) {
                const [, field, body] = m;
                const u = /Term="Measures\.Unit" Path="([^"]+)"/.exec(body);
                if (u && /_kg$|_kgph$|_kg_hr$/.test(field) && /uom/.test(u[1]))
                    wrong.push(`${e}.${field} <- @Measures.Unit: ${u[1]}`);
            }
        }
        assert.deepStrictEqual(wrong, [],
            `${wrong.length} mass field(s) take a unit from a metered-quantity column, which renders `
          + `kilograms as litres on every row metered in LTR:\n  ` + wrong.join('\n  '));
        // And prove the reader is not blind: the pairing it guards DOES exist.
        const { data } = await test.GET(
            `${O}/FLIGHT_FUEL_TICKETS?$select=uom_code,quantity_kg&$filter=uom_code eq 'LTR'&$top=1`
                .replace(/ /g, '%20'));
        assert.ok(data.value.length,
            'instrument check: no ticket is metered in LTR, so this criterion guards nothing today');
        out(`0 mass fields take a metered unit; ${data.value.length ? 'LTR tickets exist, so the trap is live' : ''}`);
    });

    it('EXIT-6  the flight facets are empty where there is NO FLIGHT — D46, not a broken binding', async () => {
        // Measured, so a null flight_number on a drill-down page is read as
        // the data it is rather than chased as an annotation defect. D46:
        // assertOrderable reads the flight's registration, so an order with
        // no flight is never gated, and the seed carries that state.
        const counts = {};
        for (const e of ['FuelOrders', 'FLIGHT_FUEL_TICKETS', 'FLIGHT_FUEL_DELIVERIES']) {
            const all = await test.GET(`${O}/${e}?$count=true&$top=0`);
            const nul = await test.GET(`${O}/${e}?$filter=flight_number eq null&$count=true&$top=0`.replace(/ /g,'%20'));
            counts[e] = [nul.data['@odata.count'], all.data['@odata.count']];
            assert.ok(nul.data['@odata.count'] > 0,
                `${e} now has a flight on every row — D46's state is gone from the seed and this `
              + `criterion should be replaced by one that tests the gate rather than recording the gap`);
        }
        out(Object.entries(counts).map(([k, [n, t]]) => `${k} ${n}/${t} no flight`).join('  '));
    });
});

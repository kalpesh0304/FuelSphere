/**
 * UNITS — and the rule is the criterion.
 *
 * A UNIT COLUMN BELONGS TO ONE FIELD. @Measures.Unit points at the column
 * holding the unit OF THAT VALUE, never at the nearest unit column on the
 * row. A unit annotation correct on half the data is WORSE than none: the
 * wrong half looks identical to the right half, and the whole reason for
 * adding units is that a bare 2,884 and a bare 2,305.76 cannot be told apart.
 *
 *   EXIT-1  no mass field takes a metered unit — the trap, across ALL services
 *   EXIT-2  no price takes a UNIT — a price is a currency with a denominator
 *   EXIT-3  every @Measures target EXISTS on the same entity
 *   EXIT-4  the pairings that ARE annotated render correctly on live rows
 *   EXIT-5  the demo flight shows kilograms and litres distinguishably
 *   EXIT-6  the entities the rule CANNOT serve are recorded, not guessed at
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert'); const fs=require('node:fs');
const test=cds.test(PROJECT); const out=s=>process.stdout.write('      '+s+'\n');
const SVCS=['planning','orders','invoice','burn','tickets','pricing','refueler'];
const MASS=/_kg$|_kgph$|_kg_hr$/;
const PRICE=/price|amount|value|cost/i;

const measures = async () => {
    const found=[];
    for (const s of SVCS) {
        let x; try { x=(await test.GET(`/odata/v4/${s}/$metadata`)).data; } catch { continue; }
        const props={};
        for (const m of x.matchAll(/<EntityType Name="(\w+)"[^>]*>([\s\S]*?)<\/EntityType>/g))
            props[m[1]]=new Set([...m[2].matchAll(/<Property Name="(\w+)"/g)].map(q=>q[1]));
        for (const m of x.matchAll(/<Annotations Target="\w+Service\.(\w+)\/(\w+)">([\s\S]*?)<\/Annotations>/g)) {
            const [,ent,field,body]=m;
            const u=/Term="Measures\.(Unit|ISOCurrency)" Path="([^"]+)"/.exec(body);
            if (u) found.push({ svc:s, ent, field, term:u[1], target:u[2], props:props[ent] });
        }
    }
    return found;
};

describe('Units on quantities and amounts', () => {

    it('EXIT-1  NO MASS FIELD TAKES A METERED UNIT — across every service', async () => {
        // uom_code is the unit of the METERED figure only. On a _kg field it
        // renders a mass as litres, and it is live rather than theoretical.
        const all = await measures();
        const wrong = all.filter(m => MASS.test(m.field) && /uom/i.test(m.target));
        assert.deepStrictEqual(wrong.map(w=>`${w.svc}.${w.ent}.${w.field} <- ${w.target}`), [],
            `a mass field takes its unit from a metered-quantity column. On every row metered in `
          + `LTR that renders kilograms AS LITRES, and the wrong rows look exactly like the right ones.`);
        // PROVE THE READER IS NOT BLIND, in both directions.
        assert.ok(all.some(m => /quantity_metered|delivered_quantity|ordered_quantity/.test(m.field)
                             && /uom/i.test(m.target)),
            'instrument check: no correct uom pairing was seen at all, so this criterion reads nothing');
        assert.ok(all.length > 10, `instrument check: only ${all.length} measure annotations found`);
        out(`${all.length} measure annotations across ${SVCS.length} services; 0 mass fields take a metered unit`);
    });

    it('EXIT-2  NO PRICE TAKES A UNIT — a price is a currency with a denominator', async () => {
        // derived_price is 94.395 USD PER KG. uom_uom_code is the
        // DENOMINATOR, not the unit of the value, so @Measures.Unit there
        // renders a price as a mass. Third instance of the same trap.
        const all = await measures();
        // DENSITY IS EXCLUDED, AND IT IS NOT AN EXCEPTION TO THE RULE —
        // it is the rule working. density_uom IS the unit of density_value,
        // verified on data. My first pass flagged it because the PRICE regex
        // matches the word "value", which is the same one-form-search error
        // in reverse: a pattern that matches MORE than it means. Caught by
        // running the criterion, not by reading it.
        const DENSITY = /^density_value$/;
        const wrong = all.filter(m => m.term === 'Unit' && PRICE.test(m.field)
                                   && !/quantity|qty/i.test(m.field) && !DENSITY.test(m.field));
        assert.ok(all.some(m => DENSITY.test(m.field) && /density_uom/.test(m.target)),
            'instrument check: density_value no longer pairs with density_uom, so the exclusion above '
          + 'is excluding nothing and this criterion has quietly narrowed');
        assert.deepStrictEqual(wrong.map(w=>`${w.svc}.${w.ent}.${w.field} <- @Measures.Unit: ${w.target}`), [],
            `a price or amount carries @Measures.Unit. A price of 94.395 USD per KG rendered with `
          + `@Measures.Unit: uom_uom_code reads "94.395 KG" — a price shown as a mass.`);
        const cur = all.filter(m => m.term === 'ISOCurrency');
        assert.ok(cur.length >= 5, `only ${cur.length} amounts carry a currency`);
        out(`${cur.length} amounts carry @Measures.ISOCurrency; 0 carry @Measures.Unit`);
    });

    it('EXIT-3  every @Measures target EXISTS on the SAME entity', async () => {
        // @Measures.ISOCurrency must point at a property of the same entity.
        // A dangling target is D50's class arriving in a measure annotation,
        // and it renders as a value with no unit — indistinguishable from
        // never having annotated it.
        const all = await measures();
        const dangling = all.filter(m => m.props && !m.props.has(m.target));
        assert.deepStrictEqual(dangling.map(d=>`${d.svc}.${d.ent}.${d.field} -> ${d.target}`), [],
            `a measure annotation points at a column the entity does not have. It renders as a bare `
          + `number with no error — indistinguishable from no annotation at all.`);
        out(`${all.length} targets, all present on their own entity`);
    });

    it('EXIT-4  the annotated pairings render correctly on LIVE rows', async () => {
        const checks = [
            ['planning','FLIGHT_FUEL_TICKETS','quantity_metered','uom_code'],
            ['planning','FLIGHT_FUEL_DELIVERIES','delivered_quantity','uom_code'],
            ['planning','FuelOrders','ordered_quantity','uom_code'],
            ['invoice','UnbilledTickets','est_value','est_currency'],
        ];
        const lines=[];
        for (const [svc,ent,val,unit] of checks) {
            // FILTER ON THE VALUE, NOT THE UNIT. Filtering on the unit found
            // rows where uom_code is set and the value is null: 16 of 30
            // tickets carry uom_code='KG' and NO quantity_metered, because
            // nothing was metered and quantity_kg is authoritative there.
            // The annotation is right; the first filter asked the wrong
            // question and reported the data as a defect.
            const { data } = await test.GET(
                `/odata/v4/${svc}/${ent}?$select=${val},${unit}&$filter=${val} ne null&$top=1`.replace(/ /g,'%20'));
            assert.ok(data.value.length, `${ent}: no row carries ${val}, so the pairing is untested`);
            const r=data.value[0];
            assert.ok(r[val] != null && r[unit] != null,
                `${ent}.${val}=${r[val]} ${unit}=${r[unit]} — both must be present or the unit renders alone`);
            lines.push(`${ent}.${val}=${r[val]} ${r[unit]}`);
        }
        out(lines.join('   '));
    });

    it('EXIT-5  THE DEMO FLIGHT SHOWS KILOGRAMS AND LITRES DISTINGUISHABLY', async () => {
        // THE WHOLE POINT. Two adjacent cards carried 2,881.25 and 2,884.00
        // with nothing saying one was litres, and the conversion between
        // them is what the page demonstrates.
        const o = await test.GET(
            "/odata/v4/planning/FuelOrders?$select=ordered_quantity,uom_code&$filter=flight_number eq 'AC410'&$top=1".replace(/ /g,'%20'));
        const t = await test.GET(
            "/odata/v4/planning/FLIGHT_FUEL_TICKETS?$select=quantity_metered,uom_code,quantity_kg&$filter=flight_number eq 'AC410'&$top=1".replace(/ /g,'%20'));
        const O=o.data.value[0], T=t.data.value[0];
        assert.ok(O && T, 'AC410 has no order or no ticket — the demo pairing is gone from the seed');
        assert.strictEqual(O.uom_code, 'LTR',
            `AC410's order is ${O.uom_code}, not LTR. It was LTR, and it is WHY ordered_quantity carries `
          + `a unit column rather than a "(kg)" label — the label would be wrong on the demo flight itself.`);
        assert.strictEqual(T.uom_code, 'LTR', `AC410's ticket is metered in ${T.uom_code}`);
        assert.ok(T.quantity_kg && Number(T.quantity_kg) !== Number(T.quantity_metered),
            'the metered figure and the mass are the same number — the conversion is invisible');
        out(`AC410: ordered ${O.ordered_quantity} ${O.uom_code} · metered ${T.quantity_metered} ${T.uom_code} `
          + `-> ${T.quantity_kg} kg  (three figures, three units, none guessable from the number)`);
    });

    it('EXIT-6  the entities the rule CANNOT serve are RECORDED, not guessed at', async () => {
        // INVOICE_MATCHES carries no unit column and its names do not say.
        // A label there would be a guess, and a guess is what makes 2,884
        // and 2,305.76 indistinguishable in the first place.
        const all = await measures();
        const guessed = all.filter(m => m.ent === 'InvoiceMatches');
        assert.deepStrictEqual(guessed.map(g=>g.field), [],
            `InvoiceMatches now carries a measure annotation. It has NO unit column and its names do `
          + `not say — an invoice quantity there may be litres or kilograms depending on the document. `
          + `If a decision was taken about where the unit comes from, this criterion should record it.`);
        const src = fs.readFileSync(`${PROJECT}/srv/invoice-fiori-annotations.cds`,'utf8');
        assert.ok(/INVOICE_MATCHES has neither/.test(src),
            'the reason InvoiceMatches is unannotated is not written at the site — an absence with no '
          + 'note reads as an oversight rather than a decision');
        assert.ok(/currency is the INVOICE's/.test(src),
            'the reason InvoiceItems amounts are unannotated is not written at the site');
        out('InvoiceMatches and InvoiceItems amounts unannotated, with the reason at the site');
    });
});

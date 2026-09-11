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
        const props={}, navs={};
        for (const m of x.matchAll(/<EntityType Name="(\w+)"[^>]*>([\s\S]*?)<\/EntityType>/g)) {
            props[m[1]]=new Set([...m[2].matchAll(/<Property Name="(\w+)"/g)].map(q=>q[1]));
            // CARDINALITY IS IN THE TYPE AND IS EASY TO THROW AWAY. D56 was
            // missed for weeks because a parser stripped Collection(...) to
            // get the target type. Keep both.
            navs[m[1]]=new Map([...m[2].matchAll(/<NavigationProperty Name="(\w+)" Type="([^"]+)"/g)]
                .map(q=>[q[1], { target: q[2].replace(/^Collection\((.*)\)$/,'$1').split('.').pop(),
                                 many: /^Collection\(/.test(q[2]) }]));
        }
        for (const m of x.matchAll(/<Annotations Target="\w+Service\.(\w+)\/(\w+)">([\s\S]*?)<\/Annotations>/g)) {
            const [,ent,field,body]=m;
            const u=/Term="Measures\.(Unit|ISOCurrency)" Path="([^"]+)"/.exec(body);
            if (u) found.push({ svc:s, ent, field, term:u[1], target:u[2],
                                props:props[ent], allProps:props, allNavs:navs });
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

    it('EXIT-3  every @Measures target RESOLVES — same entity, or a to-ONE path', async () => {
        // THIS CRITERION SAID "must point at a property of the SAME ENTITY",
        // AND THAT WAS FALSE — the same false belief as the annotation comment
        // beside InvoiceItems, written from it.
        //
        // SO IT COULD NOT CATCH THE MISTAKE; IT ENFORCED IT. A criterion built
        // on the same premise as the code it guards does not test that premise,
        // it promotes it to a rule - and the rule then blocks the repair. That
        // is what happened here: annotating the invoice amounts through
        // invoice/currency_code failed this criterion, correctly by its own
        // wording and wrongly in fact.
        //
        // MEASURED: `@Measures.ISOCurrency: invoice.currency_code` emits
        // Path="invoice/currency_code" and resolves to USD on every row.
        //
        // THE REAL RULE IS STRICTLY STRONGER, and D56 is where it comes from:
        // the target must RESOLVE. Every intermediate hop must be a navigation
        // that EXISTS and is TO-ONE, and the final segment must be a property
        // of the entity the path reaches. A to-MANY hop names three real
        // things and returns null forever, because Fiori has no key for the
        // collection - which is D56 exactly, in a measure annotation.
        const all = await measures();
        const bad = [];
        for (const m of all) {
            const segs = m.target.split('/');
            let ent = m.ent, ok = true, why = '';
            for (const seg of segs.slice(0, -1)) {
                const nav = m.allNavs[ent] && m.allNavs[ent].get(seg);
                if (!nav)      { ok=false; why=`no navigation "${seg}" on ${ent}`; break; }
                if (nav.many)  { ok=false; why=`"${seg}" is a TO-MANY (D56: null forever)`; break; }
                ent = nav.target;
            }
            if (ok) {
                const leaf = segs[segs.length-1];
                if (!m.allProps[ent] || !m.allProps[ent].has(leaf)) {
                    ok=false; why=`${ent} has no property "${leaf}"`;
                }
            }
            if (!ok) bad.push(`${m.svc}.${m.ent}.${m.field} -> ${m.target}  (${why})`);
        }
        assert.deepStrictEqual(bad, [],
            `a measure annotation points somewhere that does not resolve. It renders as a bare number `
          + `with no error - indistinguishable from no annotation at all:\n  ` + bad.join('\n  '));

        // PROVE THE WALKER IN BOTH DIRECTIONS, on this run's own data.
        const paths = all.filter(m => m.target.includes('/'));
        assert.ok(paths.length > 0,
            'instrument check: no PATH target was seen at all, so the hop-walking half of this '
          + 'criterion read nothing and would pass however broken it was');
        assert.ok(all.some(m => !m.target.includes('/')),
            'instrument check: no same-entity target was seen either');
        out(`${all.length} targets all resolve — ${all.length-paths.length} on their own entity, `
          + `${paths.length} through a to-one path`);
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

    it('EXIT-6  THE UNIT OF A QUANTITY IS AMBIGUOUS; THE CURRENCY OF AN AMOUNT IS NOT', async () => {
        // THIS CRITERION BANNED **ANY** MEASURE ANNOTATION ON InvoiceMatches,
        // FOR A REASON THAT ONLY HOLDS FOR QUANTITIES — and it would have
        // blocked a correct fix. Same class as d-designated-suppliers EXIT-9
        // matching an association by name: a rule asserted at the wrong
        // granularity, which reads as strictness and behaves as a veto.
        //
        // po_quantity, gr_quantity and inv_quantity genuinely cannot be
        // served: no unit column, and an invoice quantity there may be litres
        // or kilograms depending on the document. A label would be a guess.
        //
        // The AMOUNTS beside them were never ambiguous. They are in the
        // invoice's currency, one to-ONE hop away, and the note claiming
        // ISOCurrency "must point at a property of the same entity" was
        // FALSE — it emits Path="invoice/currency_code" and resolves.
        const all = await measures();

        // (a) NO Measures.Unit anywhere on InvoiceMatches. This is the half
        //     that is a real decision, and it stands.
        const unitAnn = all.filter(m => m.ent === 'InvoiceMatches' && m.term === 'Unit');
        assert.deepStrictEqual(unitAnn.map(g => g.field), [],
            `InvoiceMatches carries a Measures.Unit. Its quantities have NO unit column and their `
          + `names do not say — litres or kilograms depending on the document. If a decision was `
          + `taken about where the unit comes from, record it here rather than pointing at the `
          + `nearest column.`);

        // (b) AND THE AMOUNTS MUST BE ANNOTATED, not merely permitted. A
        //     criterion that only forbids leaves the correct state and the
        //     lazy state indistinguishable.
        const ccy = all.filter(m => m.ent === 'InvoiceMatches' && m.term === 'ISOCurrency');
        for (const f of ['po_amount','inv_amount','amount_variance','po_price','inv_price','price_variance'])
            assert.ok(ccy.some(c => c.field === f),
                `InvoiceMatches.${f} carries no currency. It is money, in the invoice's currency, and `
              + `an amount with no currency beside it is the same failure as a quantity with no unit.`);

        // (c) EVERY ONE OF THEM GOES THROUGH THE HEADER, and the hop is to-ONE.
        //     A path through a to-many is D56: three real names, null forever.
        for (const c of ccy)
            assert.strictEqual(c.target, 'invoice/currency_code',
                `InvoiceMatches.${c.field} takes its currency from "${c.target}". It must come from `
              + `the invoice header - anything else is a second place holding one fact.`);

        // (d) AND IT MUST RESOLVE AGAINST DATA. An emitted path is not a value:
        //     that is the whole $fiori-preview lesson.
        const { data } = await test.GET('/odata/v4/invoice/InvoiceMatches?$top=5'
            + '&$select=po_amount&$expand=invoice($select=currency_code)');
        assert.ok(data.value.length, 'no invoice matches to check the path against');
        const unresolved = data.value.filter(r => !r.invoice || !r.invoice.currency_code);
        assert.strictEqual(unresolved.length, 0,
            `${unresolved.length} match(es) cannot reach a currency through the header, so the `
          + `annotation binds nothing and every amount renders bare.`);

        const src = fs.readFileSync(`${PROJECT}/srv/invoice-fiori-annotations.cds`,'utf8');
        assert.ok(/THE CURRENCY OF AN AMOUNT IS NOT\n\/\/ AMBIGUOUS; THE UNIT OF A QUANTITY IS\./.test(src)
               || /CURRENCY OF AN AMOUNT IS NOT/.test(src),
            'the reason the quantities stay unannotated while the amounts moved is not written at the '
          + 'site — an absence with no note reads as an oversight rather than a decision');
        out(`InvoiceMatches: ${unitAnn.length} Measures.Unit (correct: quantities are ambiguous), `
          + `${ccy.length} ISOCurrency all via invoice/currency_code, resolving on `
          + `${data.value.length}/${data.value.length} rows`);
    });
});

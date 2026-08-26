/**
 * WP-UI-01 — Phase 1 fields surfaced in the annotations.
 *
 * Boots the service. cds compile returning 0 is not sufficient: WP-07's
 * annotation rebinding compiled cleanly and broke the model, and this package
 * is entirely annotations, so that is the highest risk here.
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');

const test = cds.test(PROJECT);
const out = (s) => process.stdout.write('      ' + s + '\n');

const ENTITIES = {
    'FuelOrderService.FuelOrders': ['uom_code', 'conversion_density', 'conversion_source', 'ordered_quantity_kg'],
    'FuelOrderService.FuelTickets': ['match_status', 'ticket_source', 'meter_start', 'meter_end',
        'quantity_metered', 'uom_code', 'density_value', 'density_uom', 'density_basis',
        'density_temp_c', 'quantity_flag', 'quantity_kg', 'batch_coa_ref'],
    'FuelOrderService.FuelDeliveries': ['aircraft_reg', 'uom_code', 'fob_at_arrival_kg', 'fob_before_kg',
        'fob_after_kg', 'fob_delta_kg', 'ground_burn_kg', 'fob_source', 'fob_rounding_kg',
        'recon_variance_kg', 'recon_status', 'supplier_count', 'delivery_method'],
    'MasterDataService.AircraftRegistrations': ['registration', 'aircraft_type_code', 'record_status',
        'dry_operating_weight_kg', 'fuel_capacity_kg', 'apu_burn_rate_kg_hr',
        'performance_factor_pct', 'provisional_expiry', 'on_own_aoc']
};

const refs = (v, acc = []) => {
    if (v === null || v === undefined) return acc;
    if (Array.isArray(v)) { v.forEach(x => refs(x, acc)); return acc; }
    if (typeof v === 'object') {
        if (v['=']) acc.push(String(v['=']));
        for (const [k, x] of Object.entries(v)) if (k !== '$Type') refs(x, acc);
    }
    return acc;
};

// CDS flattens FieldGroup#Name into @UI.FieldGroup#Name.Label and
// @UI.FieldGroup#Name.Data. A filter on /^@UI\.FieldGroup/ therefore yields
// key.Label and key.Data, never the group name — which is why the first
// version of this check reported every facet as pointing at a group that
// does not exist.
const groupNames = (d) => new Set(Object.keys(d)
    .filter(k => /^@UI\.FieldGroup#/.test(k))
    .map(k => k.replace(/\.(Label|Data)$/, '')));

const shownFields = (d) => {
    const s = new Set(refs(d['@UI.LineItem']));
    for (const [k, v] of Object.entries(d)) if (/^@UI\.FieldGroup#.*\.Data$/.test(k)) refs(v).forEach(p => s.add(p));
    return s;
};

describe('WP-UI-01 — Phase 1 fields in the annotations', function () {

    it('EXIT-5 — the service boots and serves', async () => {
        const r = await test.GET('/odata/v4/orders/$metadata');
        assert.strictEqual(r.status, 200);
        const m = await test.GET('/odata/v4/master/$metadata');
        assert.strictEqual(m.status, 200);
        out('GET /odata/v4/orders/$metadata  -> 200');
        out('GET /odata/v4/master/$metadata  -> 200');
        // The exact thing WP-07's rebinding destroyed.
        assert.ok(cds.model.definitions['TicketService.FuelTickets.drafts'], 'draft enablement lost');
        out('draft enablement intact on TicketService.FuelTickets');
        // AircraftRegistrations is NOT draft-enabled, unlike its sibling
        // master-data entities. Asserted as it is, not as I first assumed:
        // an expectation invented by the test is not a finding about the code.
        assert.ok(!cds.model.definitions['MasterDataService.AircraftRegistrations.drafts'],
            'AircraftRegistrations has become draft-enabled — that is a service change, not an annotation');
        out('MasterDataService.AircraftRegistrations: not draft-enabled (unchanged, and reported)');
    });

    it('EXIT-1 — every requested field appears in a LineItem or FieldGroup', async () => {
        const missing = [];
        for (const [entity, fields] of Object.entries(ENTITIES)) {
            const d = cds.model.definitions[entity];
            assert.ok(d, `${entity} missing`);
            const shown = shownFields(d);
            // Instrument check: the extractor must see SOMETHING, or every
            // field would report as present-nowhere and this test would fail
            // for the wrong reason — or, with the assertion inverted, pass.
            assert.ok(shown.size > 0, `${entity}: extractor found no fields at all`);
            const gaps = fields.filter(f => !shown.has(f));
            out(`${entity.padEnd(40)} ${fields.length - gaps.length}/${fields.length} shown (of ${shown.size} total)`);
            gaps.forEach(g => missing.push(`${entity}.${g}`));
        }
        assert.deepStrictEqual(missing, [], 'these requested fields appear nowhere');
    });

    it('EXIT-2 — each of the four entities has an object page', async () => {
        for (const entity of Object.keys(ENTITIES)) {
            const d = cds.model.definitions[entity];
            const facets = d['@UI.Facets'] || [];
            const groups = groupNames(d);
            out(`${entity.padEnd(40)} Facets: ${facets.length}  FieldGroups: ${groups.size}`);
            assert.ok(facets.length > 0, `${entity} has no UI.Facets — no object page`);
            // Every facet must point at a field group that exists, or the
            // object page renders an empty section.
            // A target may be LOCAL ('@UI.FieldGroup#X') or reached through an
            // association ('assoc/@UI.FieldGroup#X'). The earlier version only
            // knew the local form, so a path target read as dangling even
            // where the group existed on the other end. Follow the path.
            const resolves = (t) => {
                t = String(t);
                if (/LineItem|Facets|Chart/.test(t)) return true;
                const i = t.indexOf('/');
                if (i < 0) return groups.has(t);
                const nav = d.elements[t.slice(0, i)];
                if (!nav || !nav.target) return false;
                const tgt = cds.model.definitions[nav.target];
                return !!tgt && groupNames(tgt).has(t.slice(i + 1));
            };
            const dangling = facets.map(f => f.Target).filter(Boolean).filter(t => !resolves(t));
            dangling.forEach(t => out(`  DANGLING FACET -> ${t}`));
            assert.deepStrictEqual(dangling, [], `${entity}: facets pointing at nothing`);
        }
    });

    it('EXIT-3 — a filter bar exists on each list', async () => {
        for (const entity of Object.keys(ENTITIES)) {
            const sf = cds.model.definitions[entity]['@UI.SelectionFields'] || [];
            const names = sf.map(x => (x && x['=']) ? x['='] : String(x));
            out(`${entity.padEnd(40)} SelectionFields: [${names.join(', ')}]`);
            assert.ok(names.length > 0, `${entity} has no UI.SelectionFields — no filter bar`);
            // Each named field must exist, or the filter bar drops it silently.
            const d = cds.model.definitions[entity];
            names.forEach(n => assert.ok(d.elements[n], `${entity}: filter names ${n}, which is not an element`));
        }
    });

    it('EXIT-4 — recon_status and match_status render with criticality', async () => {
        const check = (entity, field) => {
            const d = cds.model.definitions[entity];
            const all = [d['@UI.LineItem'] || [],
                         ...Object.entries(d).filter(([k]) => /^@UI\.FieldGroup/.test(k)).map(([, v]) => v.Data || [])];
            const recs = all.flat().filter(r => r && r.Value && r.Value['='] === field);
            assert.ok(recs.length, `${entity}: ${field} appears in no record`);
            const withCrit = recs.filter(r => r.Criticality !== undefined);
            out(`${entity}.${field}: ${recs.length} record(s), ${withCrit.length} carrying Criticality`);
            assert.ok(withCrit.length, `${entity}: ${field} has no Criticality anywhere`);
            return withCrit;
        };
        check('FuelOrderService.FuelDeliveries', 'recon_status');
        check('FuelOrderService.FuelTickets', 'match_status');
        check('MasterDataService.AircraftRegistrations', 'record_status');
    });

    it('EXIT-4b — the criticality reaches the metadata as a real expression', async () => {
        // A Criticality the compiler swallowed would leave the model looking
        // annotated and the screen rendering plain. Check the emitted EDMX.
        const r = await test.GET('/odata/v4/orders/$metadata');
        const edmx = r.data;
        for (const [status, positive] of [['recon_status', 'RECONCILED'], ['match_status', 'MATCHED']]) {
            const i = edmx.indexOf(`<Path>${status}</Path>`);
            assert.ok(i > 0, `${status} appears in no dynamic expression in the metadata`);
            const window = edmx.slice(i - 400, i + 900);
            assert.match(window, /<If>/, `${status}: no If expression`);
            assert.match(window, new RegExp(positive), `${status}: the positive value is not in the expression`);
            out(`${status}: dynamic Criticality present in $metadata (If / ${positive})`);
        }
        // Instrument check: a status with no criticality must NOT match.
        assert.ok(!edmx.includes('<Path>nonexistent_status</Path>'), 'instrument sanity');
    });

    it('every quantity names its unit, and derived fields are read-only', async () => {
        const units = [
            ['FuelOrderService.FuelOrders', 'ordered_quantity', 'uom_code'],
            ['FuelOrderService.FuelTickets', 'quantity', 'uom_code'],
            ['FuelOrderService.FuelTickets', 'quantity_metered', 'uom_code'],
            ['FuelOrderService.FuelTickets', 'density_value', 'density_uom'],
            ['FuelOrderService.FuelDeliveries', 'delivered_quantity', 'uom_code']
        ];
        for (const [e, field, unit] of units) {
            const el = cds.model.definitions[e].elements[field];
            const got = el['@Measures.Unit'];
            const name = got && (got['='] || got);
            out(`${e.split('.')[1]}.${field.padEnd(18)} @Measures.Unit -> ${name}`);
            assert.strictEqual(String(name), unit, `${e}.${field} unit`);
        }
        const derived = [
            ['FuelOrderService.FuelTickets', 'quantity_kg'],
            ['FuelOrderService.FuelDeliveries', 'fob_delta_kg'],
            ['FuelOrderService.FuelDeliveries', 'ground_burn_kg'],
            ['FuelOrderService.FuelDeliveries', 'recon_variance_kg'],
            ['FuelOrderService.FuelDeliveries', 'recon_status'],
            ['FuelOrderService.FuelDeliveries', 'supplier_count'],
            ['FuelOrderService.FuelOrders', 'ordered_quantity_kg'],
            ['FuelOrderService.FuelOrders', 'conversion_density'],
            ['FuelOrderService.FuelOrders', 'conversion_source']
        ];
        // @Common.FieldControl: #ReadOnly compiles to { '#': 'ReadOnly' },
        // not to the string '#ReadOnly'. Comparing the stringified object
        // reported 0 of 9 marked when all nine were.
        const isRO = (e, f) => (cds.model.definitions[e].elements[f]['@Common.FieldControl'] || {})['#'] === 'ReadOnly';
        const notRO = derived.filter(([e, f]) => !isRO(e, f));
        out(`derived fields marked read-only: ${derived.length - notRO.length}/${derived.length}`);
        assert.deepStrictEqual(notRO.map(x => x.join('.')), []);
        // Instrument check: an ENTERED field must not be read-only, or the
        // assertion above would pass by marking everything.
        out(`fob_before_kg (entered) read-only? ${isRO('FuelOrderService.FuelDeliveries', 'fob_before_kg')}`);
        assert.ok(!isRO('FuelOrderService.FuelDeliveries', 'fob_before_kg'),
            'an entered field must stay editable, or read-only means nothing');
    });

    it('a variance never appears without its verdict beside it', async () => {
        const li = cds.model.definitions['FuelOrderService.FuelDeliveries']['@UI.LineItem'];
        const names = li.map(r => (r.Value && r.Value['=']) || null);
        const iVar = names.indexOf('recon_variance_kg');
        const iSt  = names.indexOf('recon_status');
        const iSrc = names.indexOf('fob_source');
        out(`LineItem order: ... ${names.slice(Math.min(iSt, iVar) - 1, iSrc + 1).join(' | ')} ...`);
        assert.ok(iVar >= 0 && iSt >= 0, 'both must be on the list');
        assert.strictEqual(Math.abs(iVar - iSt), 1, 'status and variance must be adjacent columns');
        assert.strictEqual(Math.abs(iSrc - iVar), 1, 'the source that set the threshold sits with them');

        const g = cds.model.definitions['FuelOrderService.FuelDeliveries']['@UI.FieldGroup#Reconciliation.Data'];
        assert.ok(g, 'FieldGroup#Reconciliation missing');
        const gn = g.map(r => (r.Value && r.Value['=']) || null);
        out(`FieldGroup#Reconciliation: ${gn.join(', ')}`);
        assert.ok(gn.includes('recon_status') && gn.includes('recon_variance_kg') && gn.includes('fob_source'),
            'the object page group must carry the verdict, the figure and the threshold source');
    });
});

/**
 * WP-UI-02 — labels.
 *
 * Criterion 2 is verified from $metadata, not from the source. That
 * distinction is load-bearing here: WP-UI-01 set @title and @Common.Label on
 * the same fields, @Common.Label wins in the EDMX, and the source therefore
 * showed one label while the screen showed another.
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');

const test = cds.test(PROJECT);
const out = (s) => process.stdout.write('      ' + s + '\n');

const WANTED = {
    'FuelOrderService.FuelOrders': {
        uom_code: 'Unit of Measure',
        conversion_density: 'Conversion Density (kg/L)',
        conversion_source: 'Density Source',
        ordered_quantity_kg: 'Ordered Quantity (kg)'
    },
    'FuelOrderService.FuelTickets': {
        match_status: 'Match Status', ticket_source: 'Ticket Source',
        meter_start: 'Meter Start', meter_end: 'Meter End',
        quantity_metered: 'Metered Quantity', uom_code: 'Unit of Measure',
        density_value: 'Density', density_uom: 'Density Unit',
        density_basis: 'Density Basis', density_temp_c: 'Density Temperature (°C)',
        quantity_flag: 'Quantity Basis', quantity_kg: 'Uplift by Meter (kg)',
        batch_coa_ref: 'Batch Certificate'
    },
    'FuelOrderService.FuelDeliveries': {
        aircraft_reg: 'Aircraft Registration', uom_code: 'Unit of Measure',
        fob_at_arrival_kg: 'Fuel on Board at Arrival (kg)',
        fob_before_kg: 'Fuel on Board Before Refuelling (kg)',
        fob_after_kg: 'Fuel on Board After Refuelling (kg)',
        fob_delta_kg: 'Uplift by Gauge (kg)', ground_burn_kg: 'Ground Burn (kg)',
        fob_source: 'Gauge Reading Source', fob_rounding_kg: 'Gauge Rounding (kg)',
        recon_variance_kg: 'Meter vs Gauge Variance (kg)',
        recon_status: 'Reconciliation Status', supplier_count: 'Supplier Count',
        delivery_method: 'Delivery Method'
    },
    'MasterDataService.AircraftRegistrations': {
        registration: 'Registration', aircraft_type_code: 'Aircraft Type',
        record_status: 'Record Status',
        dry_operating_weight_kg: 'Dry Operating Weight (kg)',
        fuel_capacity_kg: 'Fuel Capacity (kg)',
        apu_burn_rate_kg_hr: 'APU Burn Rate (kg/h)',
        performance_factor_pct: 'Performance Factor (%)',
        provisional_expiry: 'Provisional Expiry', on_own_aoc: 'On Own AOC',
        cost_object_type: 'Cost Object Type', cost_object_id: 'Cost Object'
    }
};

const SERVICE_OF = { FuelOrderService: '/odata/v4/orders', MasterDataService: '/odata/v4/master' };
const PLUMBING = /^(ID|IsActiveEntity|HasActiveEntity|HasDraftEntity|DraftAdministrativeData|SiblingEntity)$/;

let EDMX = {};

// The EDMX label for one property, or null. This is what the screen uses.
const edmxLabel = (svc, entity, field) => {
    const s = EDMX[svc];
    const i = s.indexOf(`Target="${entity}/${field}"`);
    if (i < 0) return null;
    const block = s.slice(i, s.indexOf('</Annotations>', i));
    const m = block.match(/Term="Common\.Label"\s+String="([^"]*)"/);
    return m ? m[1].replace(/&#xA;/g, ' ').replace(/&amp;/g, '&') : null;
};

describe('WP-UI-02 — labels', function () {

    before(async () => {
        for (const [svc, path] of Object.entries(SERVICE_OF)) {
            const r = await test.GET(`${path}/$metadata`);
            assert.strictEqual(r.status, 200, `${svc} metadata`);
            EDMX[svc] = r.data;
        }
        out(`fetched $metadata: orders ${EDMX.FuelOrderService.length} bytes, master ${EDMX.MasterDataService.length} bytes`);
    });

    it('EXIT-1 — every listed field carries the stated label, in $metadata', async () => {
        const wrong = [];
        for (const [entity, fields] of Object.entries(WANTED)) {
            const svc = entity.split('.')[0];
            for (const [f, want] of Object.entries(fields)) {
                const got = edmxLabel(svc, entity, f);
                if (got !== want) wrong.push(`${entity}.${f}: expected "${want}", metadata says ${got === null ? '(no label)' : `"${got}"`}`);
            }
            out(`${entity.padEnd(40)} ${Object.keys(fields).length} labels checked`);
        }
        wrong.forEach(w => out(`  ${w}`));
        assert.deepStrictEqual(wrong, [], 'labels that do not reach the metadata as specified');
    });

    it('EXIT-1b — the three deliberate labels are exact', async () => {
        const three = [
            ['FuelOrderService', 'FuelOrderService.FuelTickets', 'quantity_kg', 'Uplift by Meter (kg)'],
            ['FuelOrderService', 'FuelOrderService.FuelDeliveries', 'fob_delta_kg', 'Uplift by Gauge (kg)'],
            ['FuelOrderService', 'FuelOrderService.FuelDeliveries', 'recon_variance_kg', 'Meter vs Gauge Variance (kg)']
        ];
        for (const [svc, entity, f, want] of three) {
            const got = edmxLabel(svc, entity, f);
            out(`${f.padEnd(20)} -> "${got}"`);
            assert.strictEqual(got, want, `${f} must not be shortened or generalised`);
        }
        // Each names its measuring instrument, which is the whole point.
        assert.match(edmxLabel('FuelOrderService', 'FuelOrderService.FuelTickets', 'quantity_kg'), /Meter/);
        assert.match(edmxLabel('FuelOrderService', 'FuelOrderService.FuelDeliveries', 'fob_delta_kg'), /Gauge/);
        out('both uplift labels name what measured them; the variance names both');
    });

    it('EXIT-1c — "Fuel on Board" is written out, never abbreviated to FOB', async () => {
        for (const f of ['fob_at_arrival_kg', 'fob_before_kg', 'fob_after_kg']) {
            const got = edmxLabel('FuelOrderService', 'FuelOrderService.FuelDeliveries', f);
            out(`${f.padEnd(20)} -> "${got}"`);
            assert.match(got, /^Fuel on Board/, `${f} must spell it out`);
            assert.ok(!/\bFOB\b/.test(got), `${f} still abbreviates`);
        }
    });

    it('EXIT-2 — no field in the four entities renders with an underscore', async () => {
        // Enumerated from the EDMX EntityType, not from cds.model.elements.
        // The two surfaces differ: a CDS association `sales_order` becomes an
        // OData property `sales_order_ID`, and labelling the association does
        // not label the property. The model-based version of this check
        // reported sales_order as labelled while the metadata had no label on
        // the thing that actually renders.
        const props = (svc, entity) => {
            const s = EDMX[svc];
            const i = s.indexOf(`<EntityType Name="${entity.split('.')[1]}"`);
            const blk = s.slice(i, s.indexOf('</EntityType>', i));
            return [...blk.matchAll(/<Property Name="([^"]+)"/g)].map(m => m[1]);
        };
        const isHidden = (svc, entity, f) => {
            const s = EDMX[svc];
            const i = s.indexOf(`Target="${entity}/${f}"`);
            if (i < 0) return false;
            return /Term="UI\.Hidden"/.test(s.slice(i, s.indexOf('</Annotations>', i)));
        };

        const bare = [];
        for (const entity of Object.keys(WANTED)) {
            const svc = entity.split('.')[0];
            const all = props(svc, entity);
            let visible = 0, hidden = 0;
            for (const f of all) {
                if (PLUMBING.test(f)) continue;
                if (isHidden(svc, entity, f)) { hidden++; continue; }
                visible++;
                if (edmxLabel(svc, entity, f) === null && f.includes('_')) bare.push(`${entity}.${f}`);
            }
            out(`${entity.padEnd(40)} ${all.length} OData properties, ${visible} visible, ${hidden} hidden`);
        }
        bare.forEach(b => out(`  UNDERSCORE ON SCREEN: ${b}`));
        assert.deepStrictEqual(bare, [], 'these would render their technical name');
    });

    it('EXIT-2b — the instrument can see a missing label', async () => {
        // An absence check that cannot observe a presence proves nothing.
        assert.ok(edmxLabel('FuelOrderService', 'FuelOrderService.FuelDeliveries', 'fob_delta_kg'),
            'instrument blind: cannot read a label that is present');
        assert.strictEqual(edmxLabel('FuelOrderService', 'FuelOrderService.FuelDeliveries', 'no_such_field'), null,
            'instrument blind: reports a label for a field that does not exist');
        out('reads a present label; returns null for an absent one');
    });

    it('no field carries two competing label annotations', async () => {
        // The defect this package fixes. @Common.Label wins over @title, so a
        // field with both shows one thing in the source and another on screen.
        const conflicts = [];
        for (const entity of Object.keys(WANTED)) {
            for (const [n, e] of Object.entries(cds.model.definitions[entity].elements)) {
                const t = e['@title'], c = e['@Common.Label'];
                if (t && c && t !== c) conflicts.push(`${entity}.${n}: @title "${t}" vs @Common.Label "${c}"`);
            }
        }
        conflicts.forEach(c => out(`  ${c}`));
        out(`fields carrying conflicting @title and @Common.Label: ${conflicts.length}`);
        assert.deepStrictEqual(conflicts, []);
    });
});

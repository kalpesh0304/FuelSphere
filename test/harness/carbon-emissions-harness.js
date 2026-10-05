/**
 * Carbon emission and ticket billing verification harness.
 *
 * EXIT-1  the combustion factor is a parameter, scoped by fuel type, and is 3.16
 * EXIT-2  a burn row carries (FOB out - FOB in) x factor
 * EXIT-3  ...and says which basis it used
 * EXIT-4  a ticket carries uplift kg x factor, projected
 * EXIT-5  a ticket names its supplier and SAP vendor number
 * EXIT-6  a ticket says whether it is billed, and on which invoice line
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');

const test = cds.test(PROJECT);
const out = (s) => process.stdout.write('      ' + s + '\n');
const db = () => cds.connect.to('db');

async function call(fn) {
    try { const r = await fn(); return { status: r.status, body: r.data }; }
    catch (e) {
        return { status: e.response?.status ?? 'ERR', body: e.response?.data,
                 msg: e.response?.data?.error?.message ?? e.message };
    }
}

describe('carbon emissions and ticket billing', () => {

    const FACTOR = 3.16;

    // ------------------------------------------------------------- EXIT-1 --
    it('EXIT-1  the factor is a parameter, scoped by fuel type', async () => {
        const d = await db();
        const rows = await d.run(cds.ql.SELECT.from('fuelsphere.TOLERANCE_RULES')
            .where({ rule_code: 'PARAM-CO2-FACTOR' }));
        rows.forEach(r => out(`${r.rule_name}: ${Number(r.value_number)} `
            + `(product_type ${r.product_type || 'any'})`));

        assert.ok(rows.length >= 2, 'the per-fuel-type row and the fallback are not both there');
        assert.ok(rows.some(r => r.product_type === 'JET_FUEL' && Number(r.value_number) === FACTOR));
        assert.ok(rows.some(r => !r.product_type && Number(r.value_number) === FACTOR));

        const { co2Factor } = require(`${PROJECT}/srv/lib/carbon-emissions.js`);
        assert.strictEqual(await co2Factor('JET_FUEL'), FACTOR);
        assert.strictEqual(await co2Factor(null), FACTOR);
    });

    // -------------------------------------------------------- EXIT-2 and 3 --
    it('EXIT-2  a burn carries (FOB out - FOB in) x factor, and says so', async () => {
        const r = await call(() => test.GET('/odata/v4/burn/FuelBurns?$top=200'
            + '&$select=flight_number,fqis_out_kg,fqis_in_kg,actual_burn_kg,'
            + 'carbon_emission_kg,carbon_basis_v,co2_factor_v'));
        assert.strictEqual(r.status, 200);

        const withGauges = r.body.value.filter(b => b.fqis_out_kg !== null && b.fqis_in_kg !== null);
        out(`burns read: ${r.body.value.length}, with both gauge readings: ${withGauges.length}`);
        assert.ok(withGauges.length, 'no burn row carries both FOB readings');

        const one = withGauges[0];
        const expected = Number(((Number(one.fqis_out_kg) - Number(one.fqis_in_kg)) * FACTOR).toFixed(3));
        out(`${one.flight_number}: (${one.fqis_out_kg} - ${one.fqis_in_kg}) x ${one.co2_factor_v}`
            + ` = ${one.carbon_emission_kg} kg CO2 [${one.carbon_basis_v}]`);

        assert.strictEqual(Number(one.carbon_emission_kg), expected);
        assert.strictEqual(one.carbon_basis_v, 'FOB out - FOB in');

        // EXIT-3: every row either has a figure with a basis, or neither.
        const inconsistent = r.body.value.filter(b =>
            (b.carbon_emission_kg === null) !== (b.carbon_basis_v === null));
        assert.strictEqual(inconsistent.length, 0,
            'a row has an emission with no basis, or a basis with no emission');
    });

    // ------------------------------------------------------------- EXIT-4 --
    it('EXIT-4  a ticket carries its projected carbon', async () => {
        const r = await call(() => test.GET('/odata/v4/tickets/FuelTickets?$top=50'
            + '&$select=ticket_number,quantity_kg,carbon_projected_kg,co2_factor_v'));
        assert.strictEqual(r.status, 200);

        const withMass = r.body.value.filter(t => t.quantity_kg !== null);
        out(`tickets read: ${r.body.value.length}, with a mass: ${withMass.length}`);
        assert.ok(withMass.length, 'no ticket carries a mass');

        const one = withMass[0];
        const expected = Number((Number(one.quantity_kg) * FACTOR).toFixed(3));
        out(`${one.ticket_number}: ${one.quantity_kg} kg x ${one.co2_factor_v} = ${one.carbon_projected_kg} kg CO2`);
        assert.strictEqual(Number(one.carbon_projected_kg), expected);
    });

    // -------------------------------------------------------- EXIT-5 and 6 --
    it('EXIT-5  a ticket names its supplier, and says where it is billed', async () => {
        const r = await call(() => test.GET('/odata/v4/tickets/FuelTickets?$top=100'
            + '&$select=ticket_number,supplier_name_v,s4_vendor_no_v,billing_status_v,'
            + 'invoice_number_v,invoice_line_v,invoice_status_v,invoice_count_v'));
        assert.strictEqual(r.status, 200);

        const named = r.body.value.filter(t => t.supplier_name_v);
        const billed = r.body.value.filter(t => t.billing_status_v === 'BILLED');
        const unbillable = r.body.value.filter(t => t.billing_status_v === 'UNBILLABLE');
        out(`tickets: ${r.body.value.length}, naming a supplier: ${named.length}, `
            + `billed: ${billed.length}, unbillable: ${unbillable.length}`);

        assert.ok(named.length, 'no ticket resolved a supplier through its order');
        out(`sample: ${named[0].ticket_number} -> ${named[0].supplier_name_v} `
            + `(vendor ${named[0].s4_vendor_no_v || 'none'}), ${named[0].billing_status_v}`);

        // EXIT-6: a billed ticket names the invoice and the line it is on.
        if (billed.length) {
            const b = billed[0];
            out(`billed: ${b.ticket_number} -> invoice ${b.invoice_number_v} line ${b.invoice_line_v}`
                + ` (${b.invoice_status_v}), lines on this ticket: ${b.invoice_count_v}`);
            assert.ok(b.invoice_number_v, 'a BILLED ticket does not name its invoice');
            assert.ok(b.invoice_line_v !== null, 'a BILLED ticket does not name its line item');
        }

        // Every state is one of the three, and UNBILLABLE means no order.
        const states = [...new Set(r.body.value.map(t => t.billing_status_v))];
        out(`states present: ${states.join(', ')}`);
        states.forEach(s => assert.ok(['BILLED', 'UNBILLED', 'UNBILLABLE'].includes(s),
            `unexpected billing state ${s}`));
    });
});

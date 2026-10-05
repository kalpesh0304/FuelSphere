/**
 * EVERY VIRTUAL ON EVERY SERVICE, declared non-filterable.
 *
 * WHY THIS HARNESS EXISTS, written the day it was needed. On 2 Oct 2026 the
 * brief asked for a filter in every table's column-header menu, and the sweep
 * that delivered it turned `personalization: { filter: true }` on for every
 * list report in the landscape. That setting is what puts Filter in the MDC
 * column header menu - for EVERY column, including the ones computed in an
 * after-READ handler with no database column behind them.
 *
 * $filter IS PUSHED TO THE DATABASE. A virtual element has nothing there, so
 * the statement names a column that does not exist and the request comes back
 * 500. Before the sweep a user had to construct that URL by hand; after it,
 * the menu offers it. The hazard did not change, its reachability did.
 *
 * ticket-fiori-annotations.cds had the answer already - declare the virtuals
 * in Capabilities.FilterRestrictions.NonFilterableProperties and Fiori stops
 * offering them. This harness applies that rule to the whole surface rather
 * than one entity, so the next virtual anybody adds fails here instead of
 * failing for a person with a filter dialog open.
 *
 * EXIT-1  the reader finds the declarations it is built to read
 * EXIT-2  no service entity exposes an undeclared virtual
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');

cds.test(PROJECT);
const out = (s) => process.stdout.write('      ' + s + '\n');

// CAP'S OWN DRAFT COLUMNS. They carry `virtual` in the model but CAP resolves
// them itself and filtering on them is routine - every draft list sends
// IsActiveEntity eq true. Only a service's OWN virtuals reject a filter.
const DRAFT = new Set(['IsActiveEntity', 'HasActiveEntity', 'HasDraftEntity',
    'DraftAdministrativeData', 'DraftAdministrativeData_DraftUUID', 'SiblingEntity']);

/** The names declared non-filterable on an entity, however the term is spelled. */
function declared(def) {
    const direct = def['@Capabilities.FilterRestrictions.NonFilterableProperties'];
    const nested = def['@Capabilities.FilterRestrictions'];
    const list = direct || (nested && nested.NonFilterableProperties) || [];
    // Each entry compiles to { '=': 'name' } (a property path) or a bare string.
    return list.map(x => (x && typeof x === 'object' ? (x['='] || x.$Path || '') : String(x)));
}

/** The virtuals a client could put in a $filter: the entity's own, not CAP's. */
function ownVirtuals(def) {
    return Object.entries(def.elements || {})
        .filter(([k, e]) => e.virtual && !DRAFT.has(k))
        .map(([k]) => k);
}

function serviceEntities() {
    const rows = [];
    for (const [name, def] of Object.entries(cds.model.definitions)) {
        if (def.kind !== 'entity') continue;
        // Service entities only, and not the generated draft siblings.
        const svc = name.split('.')[0];
        const parent = cds.model.definitions[svc];
        if (!parent || parent.kind !== 'service') continue;
        if (name.endsWith('.drafts') || name.includes('.DraftAdministrativeData')) continue;
        rows.push({ name, def });
    }
    return rows;
}

describe('virtuals and the filters the column header now offers', () => {

    // ------------------------------------------------------------- EXIT-1 --
    // PROVE THE READER BEFORE TRUSTING EITHER HALF. A reader that silently
    // returns [] for every entity would report a clean sweep over a landscape
    // that is entirely unprotected, which is the worst possible outcome here.
    it('EXIT-1  the reader finds the declarations it is built to read', () => {
        const known = cds.model.definitions['TicketService.FuelTickets'];
        assert.ok(known, 'TicketService.FuelTickets is not in the model');

        const nf = declared(known);
        out(`TicketService.FuelTickets declares ${nf.length}: ${nf.join(', ') || '(none)'}`);
        // ticket-fiori-annotations.cds has declared these two since WP-UI.
        for (const v of ['statusCriticality', 'densityFieldControl']) {
            assert.ok(nf.includes(v),
                `the reader cannot see ${v}, which the source declares - the reader is broken, `
              + 'not the annotation');
        }

        const virt = ownVirtuals(known);
        assert.ok(virt.includes('statusCriticality'),
            'the virtual reader cannot see a known virtual');
        assert.ok(!virt.includes('IsActiveEntity'),
            'the virtual reader is counting CAP draft columns, which filter fine');
        out(`...and carries ${virt.length} own virtuals`);
    });

    // ------------------------------------------------------------- EXIT-2 --
    it('EXIT-2  no service entity exposes an undeclared virtual', () => {
        const gaps = [];
        let scanned = 0, withVirtuals = 0;

        for (const { name, def } of serviceEntities()) {
            scanned++;
            const virt = ownVirtuals(def);
            if (!virt.length) continue;
            withVirtuals++;
            const nf = declared(def);
            const uncovered = virt.filter(v => !nf.includes(v));
            if (uncovered.length) gaps.push(`${name}: ${uncovered.join(', ')}`);
        }

        out(`${scanned} service entities, ${withVirtuals} carry virtuals`);
        for (const g of gaps) out('  GAP ' + g);

        assert.deepStrictEqual(gaps, [],
            `${gaps.length} entities would let the column-header filter build a $filter on a `
          + 'column that does not exist in the database:\n  ' + gaps.join('\n  '));
    });
});

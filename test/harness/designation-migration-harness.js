/**
 * The maps answer what the designations answered.
 *
 * THE ONLY QUESTION THAT MATTERS about moving FLIGHT_DESIGNATED_SUPPLIER off
 * DESIGNATED_SUPPLIERS and onto the two maps (4 Oct 2026): does every flight
 * still resolve to the SAME supplier? Everything else - row counts, column
 * names, which table the rows live in - is bookkeeping. If one flight now
 * names a different company, the migration is wrong and no amount of passing
 * structure tests would say so.
 *
 * So this computes the OLD answer independently, from DESIGNATED_SUPPLIERS
 * itself, with the precedence the old view used - flight beats station,
 * decline on a same-axis tie - and sets it against what the view returns now.
 * The old table is still in the model precisely so this comparison can be
 * made; it is the last thing that needs it.
 *
 * EXIT-1  both sides have something to say
 * EXIT-2  every flight resolves to the same supplier, or to nothing on both
 * EXIT-3  the view is still at most one row per flight
 * EXIT-4  the posting coordinates the designations never had are now present
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');

cds.test(PROJECT);
const out = (s) => process.stdout.write('      ' + s + '\n');
const db = () => cds.connect.to('db');

/** The old view's rule, computed from DESIGNATED_SUPPLIERS alone. */
function oldAnswer(flight, designations) {
    const inScope = designations.filter(d =>
        (d.is_active === null || d.is_active === undefined || d.is_active)
        && d.designation_type === 'PRIMARY'
        && (!d.station_code || d.station_code === flight.origin_airport)
        && (!d.carrier_code || d.carrier_code === flight.airline_code)
        && (!d.flight_number || d.flight_number === flight.flight_number)
        && (!d.valid_from || String(d.valid_from) <= String(flight.flight_date))
        && (!d.valid_to || String(d.valid_to) >= String(flight.flight_date)));

    const atFlight = inScope.filter(d => d.flight_number);
    const atStation = inScope.filter(d => !d.flight_number);
    const arm = atFlight.length ? atFlight : atStation;
    // THE DECLINE: never pick among equals.
    return arm.length === 1 ? arm[0] : null;
}

describe('the maps answer what the designations answered', () => {

    let flights, designations, resolved, suppliers;

    before(async () => {
        const d = await db();
        flights = await d.run(cds.ql.SELECT.from('fuelsphere.FLIGHT_SCHEDULE')
            .columns('ID', 'flight_number', 'flight_date', 'origin_airport', 'airline_code'));
        designations = await d.run(cds.ql.SELECT.from('fuelsphere.DESIGNATED_SUPPLIERS'));
        resolved = await d.run(cds.ql.SELECT.from('fuelsphere.FLIGHT_DESIGNATED_SUPPLIER'));
        suppliers = new Map((await d.run(cds.ql.SELECT.from('fuelsphere.MASTER_SUPPLIERS')
            .columns('ID', 'supplier_name'))).map(s => [s.ID, s.supplier_name]));
    });

    // ------------------------------------------------------------- EXIT-1 --
    it('EXIT-1  both sides have something to say', () => {
        assert.ok(flights.length > 0, 'no flights');
        assert.ok(designations.length > 0,
            'DESIGNATED_SUPPLIERS is empty - the comparison would pass vacuously');
        assert.ok(resolved.length > 0, 'the resolved view returned nothing at all');
        const named = resolved.filter(r => r.supplier_name).length;
        assert.ok(named > 0, 'the view resolves no supplier on any flight');
        out(`${flights.length} flights, ${designations.length} designations, `
          + `${resolved.length} resolved row(s), ${named} naming a supplier`);
    });

    // ------------------------------------------------------------- EXIT-2 --
    it('EXIT-2  every flight resolves to the same supplier as before', () => {
        const now = new Map(resolved.map(r => [r.flight_ID, r]));
        const differ = [];
        let agreed = 0, bothNone = 0;

        // ONLY THE CARRIERS THE LEGACY TABLE KNOWS. The migration moved B6
        // and AC designations into the maps; TAP (TP) was seeded on 27 Oct
        // 2026 straight into STATION_SUPPLIER_MAP and never had a legacy row,
        // so "was (none)" on a TP flight is not a migration difference - there
        // was nothing to migrate. A designation with no carrier scopes every
        // carrier, and then every flight stays in.
        const legacy = new Set(designations.map(d => d.carrier_code || '*'));
        const migrated = flights.filter(f => legacy.has('*') || legacy.has(f.airline_code));
        out(`${migrated.length} of ${flights.length} flight(s) belong to a carrier with legacy designations `
          + `(${[...legacy].sort().join(', ')})`);
        assert.ok(migrated.length > 0, 'no flight of a migrated carrier - the comparison would be vacuous');
        for (const f of migrated) {
            const before = oldAnswer(f, designations);
            const after = now.get(f.ID);
            const nameBefore = before ? (suppliers.get(before.supplier_ID) || null) : null;
            const nameAfter = after ? (after.supplier_name || null) : null;

            if (!nameBefore && !nameAfter) { bothNone++; continue; }
            if (nameBefore === nameAfter) { agreed++; continue; }
            differ.push(`${f.flight_number} ${f.flight_date} ${f.origin_airport}: `
                + `was ${nameBefore || '(none)'}, now ${nameAfter || '(none)'}`);
        }

        out(`${agreed} flight(s) resolve to the same supplier; ${bothNone} resolve to `
          + `nothing on both sides; ${differ.length} differ`);
        for (const d of differ.slice(0, 8)) out('  DIFF ' + d);
        assert.deepStrictEqual(differ, [],
            `${differ.length} flight(s) resolve differently after the migration`);
    });

    // ------------------------------------------------------------- EXIT-3 --
    it('EXIT-3  the view is still at most one row per flight', () => {
        const seen = new Map();
        for (const r of resolved) seen.set(r.flight_ID, (seen.get(r.flight_ID) || 0) + 1);
        const many = [...seen.entries()].filter(([, n]) => n > 1);
        out(`${seen.size} flight(s) carry a row; ${many.length} carry more than one`);
        assert.deepStrictEqual(many.map(([id]) => id), [],
            'a flight resolves to more than one row - `designated` is declared to-one, '
          + 'so this makes it an arbitrary pick dressed as a fact');
    });

    // ------------------------------------------------------------- EXIT-4 --
    it('EXIT-4  the posting coordinates are now reachable', async () => {
        const d = await db();
        const station = await d.run(cds.ql.SELECT.from('fuelsphere.STATION_SUPPLIER_MAP'));
        assert.ok(station.length > 0, 'no station rows at all');

        const noLine = station.filter(r => !r.contract_line_item);
        assert.deepStrictEqual(noLine, [],
            'a station row carries no contract line - the posting cannot be built from it');

        const defaults = station.filter(r => r.is_default).length;
        const coverage = station.length - defaults;
        out(`${station.length} station row(s): ${defaults} default, ${coverage} coverage-only`);

        // WHAT THE DESIGNATIONS NEVER HELD. This is the reason the maps won
        // rather than the other way round, so it is asserted rather than
        // assumed.
        const withContract = station.filter(r => r.contract_ID).length;
        assert.ok(withContract > 0, 'not one station row names a contract');
        out(`${withContract} of them name a contract, which no designation ever did`);
    });
});

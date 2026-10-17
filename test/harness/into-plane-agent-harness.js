/**
 * Who puts the fuel in the wing - the three arrangements, end to end.
 *
 * THE RULE THIS HARNESS EXISTS TO PIN DOWN is INV455. "A ticket is payable
 * once" was keyed on the ticket alone, and that is correct for two of the
 * three arrangements and WRONG for the third: where a third-party into-plane
 * agent fuels the aircraft, the supplier bills the fuel and the agent bills
 * the uplift, so one ticket carries two legitimate lines. Keyed on the ticket
 * alone the second was a HARD_ERROR and the arrangement was unpayable.
 *
 * So EXIT-6 asserts the rule in BOTH directions. A narrowed duplicate key that
 * stops catching real duplicates would pass every other criterion here.
 *
 * EXIT-1  all three cases exist in the data, on both maps
 * EXIT-2  the agent name answers all three, and is never blank once decided
 * EXIT-3  the case fields filter AND sort - they are calculated, not virtual
 * EXIT-4  the flight screens carry them, and no row crosses carriers
 * EXIT-5  a case-2 ticket carries two lines: two charges, two vendors
 * EXIT-6  INV455 passes the legitimate pair and still catches a real duplicate
 * EXIT-7  cases 1 and 3 are billed ONCE - no agent line where no agent fuels
 * EXIT-8  CAR411 refuses the contradictory combinations
 * EXIT-9  the ticket's headline invoice is the FUEL one, not the handling one
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');

const { POST, PATCH, DELETE } = cds.test(PROJECT);
const out = (s) => process.stdout.write('      ' + s + '\n');
const { SELECT } = cds.ql;

const STATION = 'fuelsphere.STATION_SUPPLIER_MAP';
const FLIGHTMAP = 'fuelsphere.FLIGHT_SUPPLIER_MAP';

let mapping, stations, flightMaps, suppliers, items, invoices;

describe('into-plane agent - the three arrangements', () => {

    before(async () => {
        mapping = await cds.connect.to('MappingService');
        stations   = await cds.db.run(SELECT.from(STATION));
        flightMaps = await cds.db.run(SELECT.from(FLIGHTMAP));
        suppliers  = await cds.db.run(SELECT.from('fuelsphere.MASTER_SUPPLIERS'));
        items      = await cds.db.run(SELECT.from('fuelsphere.INVOICE_ITEMS'));
        invoices   = await cds.db.run(SELECT.from('fuelsphere.INVOICES'));
    });

    // ------------------------------------------------------------- EXIT-1 --
    it('EXIT-1  all three cases exist in the data, on both maps', async () => {
        const count = async (entity) => {
            const rows = await mapping.run(SELECT.from(entity)
                .columns('into_plane_mode'));
            const c = {};
            for (const r of rows) c[r.into_plane_mode || 'UNDECIDED'] = (c[r.into_plane_mode || 'UNDECIDED'] || 0) + 1;
            return c;
        };
        const st = await count(mapping.entities.StationSupplierMappings);
        const fl = await count(mapping.entities.FlightSupplierMappings);
        out('station map: ' + JSON.stringify(st));
        out('flight map : ' + JSON.stringify(fl));

        // THE WHOLE POINT OF THE CHANGE. Before today SELF could not be
        // expressed at all, and a count of zero here means the arrangement is
        // still unrepresentable whatever the schema says.
        for (const [name, c] of [['station', st], ['flight', fl]]) {
            for (const mode of ['SUPPLIER', 'THIRD_PARTY', 'SELF']) {
                assert.ok((c[mode] || 0) > 0,
                    `the ${name} map has no ${mode} row - that case is untested by this data`);
            }
        }
    });

    // ------------------------------------------------------------- EXIT-2 --
    it('EXIT-2  the agent name answers all three, and is never blank once decided', async () => {
        const supplierName = new Map(suppliers.map(s => [s.ID, s.supplier_name]));
        let case1 = 0, case2 = 0, case3 = 0;
        const wrong = [];

        for (const entity of [mapping.entities.StationSupplierMappings,
                              mapping.entities.FlightSupplierMappings]) {
            const rows = await mapping.run(SELECT.from(entity).columns(
                'ID', 'supplier_ID', 'into_plane_agent_ID', 'supplier_performs_uplift',
                'self_fuelled', 'into_plane_mode', 'into_plane_agent_name'));
            for (const r of rows) {
                const shown = r.into_plane_agent_name;
                if (r.into_plane_mode === 'SELF') {
                    case3++;
                    // A LITERAL, not a supplier record - creating a vendor row
                    // for the airline would put it in every supplier F4.
                    if (shown !== 'Self') wrong.push(`SELF row shows "${shown}", expected "Self"`);
                } else if (r.into_plane_mode === 'SUPPLIER') {
                    case1++;
                    // THE FIX THAT PROMPTED ALL THIS: this used to be blank.
                    const want = supplierName.get(r.supplier_ID);
                    if (shown !== want) wrong.push(`SUPPLIER row shows "${shown}", expected the supplier "${want}"`);
                } else if (r.into_plane_mode === 'THIRD_PARTY') {
                    case2++;
                    const want = supplierName.get(r.into_plane_agent_ID);
                    if (shown !== want) wrong.push(`THIRD_PARTY row shows "${shown}", expected the agent "${want}"`);
                } else {
                    // Undecided is a real state and MUST stay blank - a name
                    // here would be an answer nobody gave.
                    if (shown) wrong.push(`undecided row shows "${shown}", expected blank`);
                }
            }
        }
        out(`case 1 (supplier) ${case1}, case 2 (agent) ${case2}, case 3 (self) ${case3}`);
        assert.deepStrictEqual(wrong.slice(0, 5), [], 'the resolved name disagrees with the case');
        assert.ok(case1 > 0 && case2 > 0 && case3 > 0, 'a case went unexercised');
    });

    // ------------------------------------------------------------- EXIT-3 --
    it('EXIT-3  the case fields filter AND sort', async () => {
        // THE LESSON THIS PROJECT PAID FOR TWICE. A `virtual null` column
        // renders fine and 500s the moment the filter bar or a column header
        // touches it, because $filter and $orderby push to the database. These
        // are CALCULATED elements, which expand into the SQL - this proves it
        // rather than assuming it.
        const bad = [];
        for (const entity of [mapping.entities.StationSupplierMappings,
                              mapping.entities.FlightSupplierMappings]) {
            for (const mode of ['SUPPLIER', 'THIRD_PARTY', 'SELF']) {
                try { await mapping.run(SELECT.from(entity).where({ into_plane_mode: mode })); }
                catch (e) { bad.push(`filter mode=${mode}: ${e.message}`); }
            }
            try { await mapping.run(SELECT.from(entity)
                .where({ into_plane_agent_name: { like: '%Allied%' } })); }
            catch (e) { bad.push(`filter agent_name: ${e.message}`); }
            for (const col of ['into_plane_mode', 'into_plane_agent_name', 'self_fuelled']) {
                try { await mapping.run(SELECT.from(entity).orderBy(col).limit(1)); }
                catch (e) { bad.push(`sort ${col}: ${e.message}`); }
            }
        }
        out(`${2 * (3 + 1 + 3)} filter/sort operations attempted, ${bad.length} failed`);
        assert.deepStrictEqual(bad, [], 'a case field cannot be filtered or sorted on');
    });

    // ------------------------------------------------------------- EXIT-4 --
    it('EXIT-4  the flight screens carry them, and no row crosses carriers', async () => {
        const rows = await cds.db.run(SELECT.from('fuelsphere.FLIGHT_DESIGNATION'));
        assert.ok(rows.length > 0, 'the flight designation view is empty');

        const missing = ['into_plane_mode', 'into_plane_agent_name', 'self_fuelled']
            .filter(c => !(c in rows[0]));
        assert.deepStrictEqual(missing, [],
            'the flight card cannot show a column the view does not carry');

        // THE BUG FOUND WHILE REPOINTING THIS VIEW. It joined on station and
        // date and never compared carrier, so an Air Canada flight out of YVR
        // was shown JetBlue's arrangement - 14 rows of it. The resolver view
        // had the carrier condition all along, so the card could contradict
        // the resolver on the same flight.
        const cross = rows.filter(r => r.carrier_code && r.carrier_code !== r.airline_code);
        out(`${rows.length} designation row(s), ${cross.length} crossing carriers`);
        assert.strictEqual(cross.length, 0,
            'a flight is being shown another carrier\'s fuelling arrangement');

        const modes = {};
        for (const r of rows) modes[r.into_plane_mode || 'UNDECIDED'] = (modes[r.into_plane_mode || 'UNDECIDED'] || 0) + 1;
        out('by arrangement: ' + JSON.stringify(modes));
        for (const mode of ['SUPPLIER', 'THIRD_PARTY', 'SELF']) {
            assert.ok((modes[mode] || 0) > 0, `no flight resolves to ${mode}`);
        }
    });

    // ------------------------------------------------------------- EXIT-5 --
    it('EXIT-5  a case-2 ticket carries two lines: two charges, two vendors', async () => {
        const vendorOf = new Map(invoices.map(i => [i.ID, i.supplier_ID]));
        const supplierName = new Map(suppliers.map(s => [s.ID, s.supplier_name]));

        const byTicket = new Map();
        for (const it of items) {
            if (!it.ticket_ID) continue;
            if (!byTicket.has(it.ticket_ID)) byTicket.set(it.ticket_ID, []);
            byTicket.get(it.ticket_ID).push(it);
        }

        const pairs = [...byTicket.entries()].filter(([, ls]) =>
            ls.some(l => (l.charge_type || 'FUEL') === 'FUEL') &&
            ls.some(l => l.charge_type === 'INTO_PLANE'));
        out(`${pairs.length} ticket(s) billed for both fuel and into-plane service`);
        assert.ok(pairs.length > 0, 'no ticket carries the case-2 pair - case 2 is unexercised');

        const bad = [];
        for (const [tid, ls] of pairs) {
            const fuel = ls.find(l => (l.charge_type || 'FUEL') === 'FUEL');
            const itp  = ls.find(l => l.charge_type === 'INTO_PLANE');
            // TWO DIFFERENT INVOICES, which is what the user asked for.
            if (fuel.invoice_ID === itp.invoice_ID)
                bad.push(`${tid}: both charges on one invoice`);
            // TWO DIFFERENT VENDORS - the whole arrangement.
            if (vendorOf.get(fuel.invoice_ID) === vendorOf.get(itp.invoice_ID))
                bad.push(`${tid}: both invoices from the same vendor`);
            // EACH WITH ITS OWN LINE ITEM NUMBER, which is why the ticket page
            // shows the line beside the number: neither half addresses a line.
            if (fuel.line_number === undefined || itp.line_number === undefined)
                bad.push(`${tid}: a line has no line number`);
        }
        assert.deepStrictEqual(bad.slice(0, 5), [], 'a case-2 pair is malformed');

        const [tid, ls] = pairs[0];
        for (const l of ls.sort((a, b) => String(a.charge_type).localeCompare(String(b.charge_type)))) {
            out(`  ${(l.charge_type || 'FUEL').padEnd(10)} invoice line ${String(l.line_number).padEnd(4)}`
              + ` billed by ${supplierName.get(vendorOf.get(l.invoice_ID))}`);
        }

        // AND THE TICKET PAGE CAN REACH BOTH. The scalars name only the
        // first, which is why the table was added.
        const ticket = await cds.connect.to('TicketService');
        const lines = await ticket.run(SELECT.from(ticket.entities.TicketInvoiceLines)
            .where({ ticket_ID: tid }));
        out(`the ticket page reads ${lines.length} line(s) for that ticket`);
        assert.strictEqual(lines.length, ls.length,
            'the object page table does not show every line that billed the ticket');
        assert.ok(lines.every(l => l.vendor_name),
            'a line reaches the page without the vendor that billed it');
    });

    // ------------------------------------------------------------- EXIT-6 --
    it('EXIT-6  INV455 passes the legitimate pair and still catches a real duplicate', async () => {
        const checks = require(`${PROJECT}/srv/lib/invoice-checks.js`);
        const registry = await checks.loadRegistry('2026-09-25', cds.db);

        const vendorOf = new Map(invoices.map(i => [i.ID, i.supplier_ID]));
        const byTicket = new Map();
        for (const it of items) {
            if (!it.ticket_ID) continue;
            if (!byTicket.has(it.ticket_ID)) byTicket.set(it.ticket_ID, []);
            byTicket.get(it.ticket_ID).push(it);
        }
        const pair = [...byTicket.entries()].find(([, ls]) =>
            ls.some(l => (l.charge_type || 'FUEL') === 'FUEL') &&
            ls.some(l => l.charge_type === 'INTO_PLANE'));
        assert.ok(pair, 'no case-2 pair to test the rule against');

        const itp = pair[1].find(l => l.charge_type === 'INTO_PLANE');
        const invoice = invoices.find(i => i.ID === itp.invoice_ID);

        // ---- direction 1: the legitimate pair must NOT be reported --------
        const resolutions = new Map();
        const dups = await checks.detectDuplicates(invoice, [itp], resolutions, registry, cds.db, null);
        const onTicket = dups.filter(d => d.check_code === 'INV455' || d.code === 'INV455');
        out(`legitimate fuel + into-plane pair: ${onTicket.length} INV455 finding(s)`);
        assert.strictEqual(onTicket.length, 0,
            'INV455 still calls a third-party into-plane line a duplicate - case 2 is unpayable');

        // ---- direction 2: a REAL duplicate must still be reported ---------
        //
        // The narrowing must not have cost the rule its teeth. A second
        // INTO_PLANE line for the same ticket is a genuine double-billing of
        // the same charge, and is constructed here rather than seeded - the
        // seed must stay clean.
        const planted = { ...itp, ID: '00000000-0000-4000-8000-00000000dup1', line_number: 9990 };
        await cds.db.run(cds.ql.INSERT.into('fuelsphere.INVOICE_ITEMS').entries(planted));
        try {
            const again = await checks.detectDuplicates(invoice, [itp], resolutions, registry, cds.db, null);
            const caught = again.filter(d => d.check_code === 'INV455' || d.code === 'INV455');
            out(`same ticket billed for into-plane TWICE: ${caught.length} INV455 finding(s)`);
            assert.ok(caught.length > 0,
                'the narrowed key no longer catches a real duplicate - INV455 has lost its teeth');
        } finally {
            await cds.db.run(cds.ql.DELETE.from('fuelsphere.INVOICE_ITEMS').where({ ID: planted.ID }));
        }

        // ---- and two FUEL lines are still a duplicate --------------------
        const fuel = pair[1].find(l => (l.charge_type || 'FUEL') === 'FUEL');
        const planted2 = { ...fuel, ID: '00000000-0000-4000-8000-00000000dup2', line_number: 9991 };
        await cds.db.run(cds.ql.INSERT.into('fuelsphere.INVOICE_ITEMS').entries(planted2));
        try {
            const fuelInvoice = invoices.find(i => i.ID === fuel.invoice_ID);
            const r3 = await checks.detectDuplicates(fuelInvoice, [fuel], resolutions, registry, cds.db, null);
            const caught = r3.filter(d => d.check_code === 'INV455' || d.code === 'INV455');
            out(`same ticket billed for FUEL twice: ${caught.length} INV455 finding(s)`);
            assert.ok(caught.length > 0, 'two fuel lines on one ticket went unreported');
        } finally {
            await cds.db.run(cds.ql.DELETE.from('fuelsphere.INVOICE_ITEMS').where({ ID: planted2.ID }));
        }
    });

    // ------------------------------------------------------------- EXIT-7 --
    it('EXIT-7  cases 1 and 3 are billed once - no agent line where no agent fuels', async () => {
        // WHERE THE SUPPLIER OR THE AIRLINE FUELS, THERE IS NOBODY TO BILL
        // the service. An into-plane line against such a station would be a
        // charge with no arrangement behind it.
        const airports = await cds.db.run(SELECT.from('fuelsphere.MASTER_AIRPORTS').columns('ID', 'iata_code'));
        const codeOf = new Map(airports.map(a => [a.ID, a.iata_code]));
        const thirdPartyStations = new Set(stations
            .filter(r => r.into_plane_agent_ID && !r.supplier_performs_uplift && !r.self_fuelled)
            .map(r => codeOf.get(r.airport_ID)));
        const thirdPartyFlights = new Set(flightMaps
            .filter(r => r.into_plane_agent_ID).map(r => r.flight_number));
        out(`third-party stations: ${[...thirdPartyStations].sort().join(', ')}`);

        const flights = new Map((await cds.db.run(SELECT.from('fuelsphere.FLIGHT_SCHEDULE')
            .columns('ID', 'flight_number', 'origin_airport'))).map(f => [f.ID, f]));

        const offenders = [];
        for (const it of items.filter(i => i.charge_type === 'INTO_PLANE' && i.flight_ID)) {
            const f = flights.get(it.flight_ID);
            if (!f) continue;
            if (!thirdPartyStations.has(f.origin_airport) && !thirdPartyFlights.has(f.flight_number)) {
                offenders.push(`${f.flight_number} at ${f.origin_airport}`);
            }
        }
        out(`${items.filter(i => i.charge_type === 'INTO_PLANE').length} into-plane line(s), `
          + `${offenders.length} at a station with no third-party arrangement`);
        assert.deepStrictEqual([...new Set(offenders)].slice(0, 5), [],
            'an into-plane service is billed where nobody was contracted to perform it');
    });

    // ------------------------------------------------------------- EXIT-8 --
    it('EXIT-8  CAR411 refuses the contradictory combinations', async () => {
        // DRIVEN THE WAY A SCREEN DRIVES IT: open an existing valid row for
        // edit, patch in the contradiction, activate. Building a NEW row would
        // trip the mandatory fields and the overlap rule first, and a test
        // that passes because some OTHER check refused is not a test of this
        // one - it would go green the day that other check changed.
        //
        // Each of these three states resolves to SOMETHING through the CASE in
        // db/mapping-tables.cds, which is exactly why save has to refuse it: a
        // row that quietly picks one of two contradictory answers is worse
        // than one that will not save.
        const base = stations.find(r => r.carrier_carrier_code === 'B6'
            && r.supplier_performs_uplift && !r.self_fuelled);
        assert.ok(base, 'no clean case-1 row to build the test on');
        const key = `(ID=${base.ID},IsActiveEntity=false)`;
        const set = '/odata/v4/mappings/StationSupplierMappings';

        const combos = [
            { what: 'supplier fuels AND self-fuelled',
              patch: { supplier_performs_uplift: true, self_fuelled: true } },
            { what: 'an agent named while the supplier fuels',
              patch: { supplier_performs_uplift: true, into_plane_agent_ID: base.supplier_ID } },
            { what: 'an agent named while self-fuelling',
              patch: { supplier_performs_uplift: false, self_fuelled: true,
                       into_plane_agent_ID: base.supplier_ID } }
        ];

        const notRefused = [];
        for (const c of combos) {
            // discard any draft left by a previous iteration
            try { await DELETE(`${set}${key}`); } catch (e) { void e; }
            await POST(`${set}(ID=${base.ID},IsActiveEntity=true)/MappingService.draftEdit`,
                       { PreserveChanges: false });
            await PATCH(`${set}${key}`, c.patch);
            let message = null;
            try {
                await POST(`${set}${key}/MappingService.draftActivate`, {});
            } catch (e) {
                message = String((e.response && e.response.data
                    && JSON.stringify(e.response.data)) || e.message || '');
            }
            if (message === null) notRefused.push(`${c.what}: ACCEPTED`);
            else if (!message.includes('CAR411'))
                notRefused.push(`${c.what}: refused by something else - ${message.slice(0, 120)}`);
            else out(`refused: ${c.what}`);
            try { await DELETE(`${set}${key}`); } catch (e) { void e; }
        }
        out(`${combos.length} contradictory combination(s) attempted, ${notRefused.length} not refused by CAR411`);
        assert.deepStrictEqual(notRefused, [],
            'a contradictory into-plane arrangement was accepted');

        // AND THE VALID CASES STILL SAVE. A check that refuses everything
        // passes the assertion above and breaks the app.
        try { await DELETE(`${set}${key}`); } catch (e) { void e; }
        await POST(`${set}(ID=${base.ID},IsActiveEntity=true)/MappingService.draftEdit`,
                   { PreserveChanges: false });
        await PATCH(`${set}${key}`, { supplier_performs_uplift: false, self_fuelled: true,
                                      into_plane_agent_ID: null });
        const ok = await POST(`${set}${key}/MappingService.draftActivate`, {});
        assert.strictEqual(ok.status, 200, 'a legitimate case-3 row was refused');
        out('a legitimate case-3 row still saves');
    });

    // ------------------------------------------------------------- EXIT-9 --
    it('EXIT-9  the ticket headline invoice is the fuel one, not the handling one', async () => {
        // A REGRESSION CAUGHT BY MEASURING RATHER THAN READING. The scalars
        // on the ticket feed the LIST column "Invoice number" and the deep
        // link that opens that invoice. srv/lib/ticket-billing.js took the
        // lowest line number, and the agent's lines start at 10 while the
        // fuel lines run to 80 - so the moment into-plane invoices existed,
        // the headline flipped to the handling invoice on 716 tickets and the
        // link pointed at the wrong document.
        //
        // A ticket is first of all a record of fuel delivered. The fuel
        // invoice is the one a reader means.
        const ticket = await cds.connect.to('TicketService');
        const vendorOf = new Map(invoices.map(i => [i.ID, i.supplier_ID]));
        const supplierName = new Map(suppliers.map(s => [s.ID, s.supplier_name]));

        const byTicket = new Map();
        for (const it of items) {
            if (!it.ticket_ID) continue;
            if (!byTicket.has(it.ticket_ID)) byTicket.set(it.ticket_ID, []);
            byTicket.get(it.ticket_ID).push(it);
        }
        const pairs = [...byTicket.entries()].filter(([, ls]) =>
            ls.some(l => (l.charge_type || 'FUEL') === 'FUEL') &&
            ls.some(l => l.charge_type === 'INTO_PLANE'));
        assert.ok(pairs.length > 0, 'no case-2 pair to check the headline against');

        // THREE, NOT TWENTY-FIVE. The rule is per-ticket and identical on
        // every one of the 716, so a larger sample buys no coverage - and it
        // cost the criterion its life: each read runs applyTicketBilling,
        // which walks all 2,494 invoice lines, and 25 of them timed out at
        // the suite's limit. A criterion that only passes at a hand-raised
        // timeout is one that goes red in CI and gets ignored.
        const sample = pairs.slice(0, 3);
        const wrong = [];
        // PRIVILEGED, because FuelTickets is role-restricted and this
        // criterion is about the DERIVATION, not about who may read it. The
        // roles themselves are asserted by wp02/wp02b/wp02c.
        const tx = ticket.tx({ user: new cds.User.Privileged() });

        // ONE BATCHED READ, NOT 25 SINGLE ONES. applyTicketBilling re-reads
        // every invoice line on each call, so 25 separate reads walked 2,494
        // lines 25 times and timed out at the suite's 60s - it passed only
        // because the first manual run used a 240s timeout, which is the kind
        // of green that disappears in CI.
        //
        // Batching is also the better test: the LIST report reads many
        // tickets at once, and that is the path the headline column is
        // actually rendered from.
        const enriched = new Map((await tx.run(SELECT.from(ticket.entities.FuelTickets)
            .where({ ID: { in: sample.map(([tid]) => tid) } }))).map(r => [r.ID, r]));
        assert.strictEqual(enriched.size, sample.length,
            'the batched read did not return every ticket asked for');

        for (const [tid, ls] of sample) {
            const t = enriched.get(tid);
            const fuel = ls.find(l => (l.charge_type || 'FUEL') === 'FUEL');
            const fuelInvoice = invoices.find(i => i.ID === fuel.invoice_ID);
            if (t.invoice_number_v !== fuelInvoice.invoice_number)
                wrong.push(`${t.ticket_number}: headline ${t.invoice_number_v}, `
                         + `expected the fuel invoice ${fuelInvoice.invoice_number}`);
            if (t.invoice_line_v !== fuel.line_number)
                wrong.push(`${t.ticket_number}: headline line ${t.invoice_line_v}, expected ${fuel.line_number}`);
            // AND THE HEADLINE MUST AGREE WITH ITSELF: supplier_name_v comes
            // from the ORDER, so a headline naming the agent's invoice beside
            // the supplier's name is two facts contradicting each other on one
            // card.
            if (t.supplier_name_v && supplierName.get(vendorOf.get(fuel.invoice_ID)) !== t.supplier_name_v)
                wrong.push(`${t.ticket_number}: headline invoice billed by `
                         + `${supplierName.get(vendorOf.get(fuel.invoice_ID))} but the card says ${t.supplier_name_v}`);
            // The count still counts everything.
            if (t.invoice_count_v !== ls.length)
                wrong.push(`${t.ticket_number}: count ${t.invoice_count_v}, expected ${ls.length}`);
        }
        out(`${sample.length} case-2 ticket(s) checked, ${wrong.length} with the wrong headline`);
        assert.deepStrictEqual(wrong.slice(0, 5), [],
            'the ticket headline names the handling invoice instead of the fuel invoice');
    });
});

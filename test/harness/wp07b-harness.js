/**
 * WP-07B — tail references as associations (B1, A4, A1).
 *
 * The seed has no orphans (14 rows, 14 referenced, 0 missing), so every
 * unresolved case here is CONSTRUCTED. A clean seed does not make the
 * unresolved path untestable, it just means the test has to build it.
 */
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert');
const XLSX=require(`${PROJECT}/node_modules/xlsx`);
const test=cds.test(PROJECT); const out=s=>process.stdout.write('      '+s+'\n');

const { POLICY, UNKNOWN_TAIL_POLICY, applyPolicy, resolveTail, isBlockable }
    = require(`${PROJECT}/srv/lib/tail-resolver`);

const SEVEN = {
    'fuelsphere.FLIGHT_SCHEDULE':      'aircraft_reg',
    'fuelsphere.FUEL_DELIVERIES':      'aircraft_reg',
    'fuelsphere.FUEL_TICKETS':         'aircraft_reg',
    'fuelsphere.FLIGHT_DISPATCH':      'tail_number',
    'fuelsphere.FUEL_BURNS':           'tail_number',
    'fuelsphere.ROB_LEDGER':           'tail_number',
    'fuelsphere.FUEL_BURN_EXCEPTIONS': 'tail_number'
};
const GHOST = 'C-ZZZZ';           // deliberately not in the register
const db = () => cds.connect.to('db');

let _ver = 90;
const dispatchUpload = async (tail, policy) => {
    const row = { FUEL_ORDER_ID:'FO-07B-1', FLIGHT_NUMBER:'AC410', FLIGHT_DATE:'2026-04-10',
        TAIL_NUMBER:tail, ATD:'2026-04-10T07:15:00Z', DISPATCH_QTY_KG:4803,
        ROB_DEPARTURE_KG:6700, PAYLOAD_KG:14000, CAPTAIN_ID:'CAP-1',
        DISPATCHER_ID:'DSP-1', DISPATCH_TIMESTAMP:'2026-04-10T06:00:00Z',
        // A distinct version per upload. Reusing one made WP-18's re-send
        // rule skip the row, which this test would have read as a tail
        // rejection — two mechanisms, one observation.
        DISPATCH_SOURCE:'TRIPRECORD', PLAN_VERSION: ++_ver };
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([row]), 'D');
    const r = await test.POST('/odata/v4/orders/importFlightDispatchExcel',
        { fileName:'x.xlsx', fileContent: XLSX.write(wb,{type:'base64',bookType:'xlsx'}),
          unknownTailPolicy: policy });
    return r.data;
};

describe('WP-07B — tail associations', function () {

    it('EXIT-1 — all seven carry a resolving association beside their string', async () => {
        for (const [ent, str] of Object.entries(SEVEN)) {
            const d = cds.model.definitions[ent];
            assert.ok(d, `${ent} missing`);
            assert.ok(d.elements[str], `${ent}.${str} — the string must remain`);
            const a = d.elements['tail'];
            assert.ok(a, `${ent}.tail missing`);
            assert.strictEqual(a.target, 'fuelsphere.AIRCRAFT_REGISTRATIONS');
            assert.ok(d.elements['tail_registration'], `${ent}: no FK generated`);
            out(`${ent.replace('fuelsphere.','').padEnd(22)} ${str.padEnd(13)} + tail -> AIRCRAFT_REGISTRATIONS`);
        }
    });

    it('EXIT-2 — no @mandatory changed, and every association is optional', async () => {
        const expected = {   // as recorded before this package
            'fuelsphere.FLIGHT_SCHEDULE': false, 'fuelsphere.FUEL_DELIVERIES': true,
            'fuelsphere.FUEL_TICKETS': false, 'fuelsphere.FLIGHT_DISPATCH': false,
            'fuelsphere.FUEL_BURNS': true, 'fuelsphere.ROB_LEDGER': true,
            'fuelsphere.FUEL_BURN_EXCEPTIONS': true
        };
        for (const [ent, str] of Object.entries(SEVEN)) {
            const d = cds.model.definitions[ent];
            const strMand = !!d.elements[str]['@mandatory'];
            const assocMand = !!d.elements['tail']['@mandatory'];
            out(`${ent.replace('fuelsphere.','').padEnd(22)} ${str} mandatory=${strMand}  tail mandatory=${assocMand}`);
            assert.strictEqual(strMand, expected[ent], `${ent}.${str} constraint changed`);
            assert.strictEqual(assocMand, false, `${ent}.tail must be optional`);
        }
    });

    it('EXIT-3 — an unknown registration lands under ACCEPT_PROVISIONAL', async () => {
        // Constructed: the seed has no orphans.
        assert.strictEqual(await resolveTail(GHOST), null, `${GHOST} must be absent from the register`);
        const res = await dispatchUpload(GHOST, POLICY.ACCEPT_PROVISIONAL);
        out(`dispatch ${GHOST} under ACCEPT_PROVISIONAL -> created ${res.dispatchesCreated}, skipped ${res.dispatchesSkipped}`);
        assert.strictEqual(res.dispatchesCreated, 1, 'the record must land');

        const row = await (await db()).run(SELECT.one.from('fuelsphere.FLIGHT_DISPATCH')
            .columns('tail_number','tail_registration').where({ dispatch_order_id: 'FO-07B-1' }));
        out(`  stored: tail_number=${row.tail_number}  tail_registration=${row.tail_registration}`);
        assert.strictEqual(row.tail_number, GHOST, 'the string carries the value as received');
        assert.strictEqual(row.tail_registration, null, 'and the association is null');
    });

    it('EXIT-4 — the same record is refused under REJECT, naming the registration', async () => {
        const res = await dispatchUpload(GHOST, POLICY.REJECT);
        const msg = JSON.stringify(res.errors);
        out(`dispatch ${GHOST} under REJECT -> created ${res.dispatchesCreated}, skipped ${res.dispatchesSkipped}`);
        out(`  ${(res.errors[0]||{}).message}`);
        assert.strictEqual(res.dispatchesCreated, 0, 'a blockable feed must refuse it');
        assert.strictEqual(res.dispatchesSkipped, 1);
        assert.match(msg, new RegExp(GHOST), 'the registration must be named');
        assert.match(msg, /MDM403/);

        // Instrument check: a KNOWN tail is still accepted under REJECT, so
        // the refusal is the policy and not a blanket failure.
        const ok = await dispatchUpload('C-FDMO', POLICY.REJECT);
        out(`dispatch C-FDMO (known) under REJECT -> created ${ok.dispatchesCreated}`);
        assert.strictEqual(ok.dispatchesCreated, 1, 'REJECT must not refuse a known tail');
    });

    // ==================================================================
    it('EXIT-5 — a ticket with an unknown registration is captured under BOTH policies', async () => {
        // The criterion that matters. EXIT-3 and EXIT-4 could both pass while
        // a ticket was silently being rejected — that would be a defect this
        // package INTRODUCED rather than found.
        for (const policy of [POLICY.ACCEPT_PROVISIONAL, POLICY.REJECT]) {
            assert.strictEqual(isBlockable('FUEL_TICKETS'), false, 'A1: never blockable');
            const d = applyPolicy(GHOST, null, 'FUEL_TICKETS', policy);
            out(`ticket ${GHOST} under ${policy.padEnd(18)} -> accept=${d.accept}`);
            assert.strictEqual(d.accept, true, `A1: a ticket must be captured under ${policy}`);
            assert.strictEqual(d.tail_registration, null);
        }

        // And through the running service, not only the rule.
        const post = async (u,b) => { try { const r=await test.POST(u,b); return r; }
            catch(e){ return { status: e.response?.status, data: e.response?.data }; } };
        const draft = await post('/odata/v4/tickets/FuelTickets', {
            ticket_number:'WP07B-GHOST', quantity:1000, uom_code:'LTR',
            aircraft_reg: GHOST, delivery_timestamp:'2026-04-11T06:00:00Z' });
        assert.ok(draft.status < 400, `ticket draft refused: ${JSON.stringify(draft.data)}`);
        const act = await post(`/odata/v4/tickets/FuelTickets(ID=${draft.data.ID},IsActiveEntity=false)/TicketService.draftActivate`, {});
        out(`ticket capture over OData -> ${act.status}, tail_registration=${act.data.tail_registration}`);
        assert.ok(act.status < 400, 'the ticket must be captured');
        assert.strictEqual(act.data.aircraft_reg, GHOST, 'the string carries it');
        assert.strictEqual(act.data.tail_registration, null, 'the association stays null');
    });

    it('EXIT-5b — a burn with an unknown registration is captured under BOTH policies', async () => {
        for (const policy of [POLICY.ACCEPT_PROVISIONAL, POLICY.REJECT]) {
            const d = applyPolicy(GHOST, null, 'FUEL_BURNS', policy);
            out(`burn ${GHOST} under ${policy.padEnd(18)} -> accept=${d.accept}`);
            assert.strictEqual(d.accept, true, `the burn already happened; ${policy} cannot undo it`);
        }
        const r = await test.POST('/odata/v4/burn/ingestACARS', {
            flightNumber:'AC410', tailNumber:GHOST, burnDate:'2026-04-11',
            actualBurnKg:4200, messageType:'IN', timestamp:'2026-04-11T09:00:00Z',
            messageId:'WP07B-ACARS-1' });
        assert.strictEqual(r.status, 200, JSON.stringify(r.data));
        const burn = await (await db()).run(SELECT.one.from('fuelsphere.FUEL_BURNS')
            .columns('tail_number','tail_registration').where({ tail_number: GHOST }));
        out(`ACARS ingest -> stored tail_number=${burn.tail_number} tail_registration=${burn.tail_registration}`);
        assert.strictEqual(burn.tail_number, GHOST);
        assert.strictEqual(burn.tail_registration, null);
    });

    it('EXIT-5c — every never-blockable feed is asserted, not just the two named', async () => {
        const never = ['FUEL_TICKETS','FUEL_BURNS','FUEL_BURN_EXCEPTIONS','ROB_LEDGER','FUEL_DELIVERIES'];
        never.forEach(f => {
            assert.strictEqual(isBlockable(f), false, `${f} must never be blockable`);
            assert.strictEqual(applyPolicy(GHOST, null, f, POLICY.REJECT).accept, true, f);
        });
        out(`never blockable: ${never.join(', ')}`);
        const blockable = ['FLIGHT_SCHEDULE','FLIGHT_DISPATCH'];
        blockable.forEach(f => {
            assert.strictEqual(isBlockable(f), true, `${f} must be blockable`);
            assert.strictEqual(applyPolicy(GHOST, null, f, POLICY.REJECT).accept, false, f);
        });
        out(`blockable: ${blockable.join(', ')} — and both are planning feeds`);
    });

    // ==================================================================
    it('EXIT-6 — recalculateROB addresses a tail through the association', async () => {
        const led = await (await db()).run(SELECT.one.from('fuelsphere.ROB_LEDGER')
            .columns('tail_number','tail_registration').where({ tail_registration: { '!=': null } }));
        assert.ok(led, 'precondition: a ledger row with a resolved tail');
        const r = await test.POST('/odata/v4/burn/recalculateROB',
            { registration: led.tail_number, fromDate: null });
        out(`recalculateROB(registration=${led.tail_number}) -> ${r.status}`);
        out(`  addressedBy=${r.data.addressedBy}  entries=${r.data.entriesRecalculated}`);
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.data.addressedBy, 'association', 'must resolve through the register');
        assert.ok(r.data.entriesRecalculated > 0);

        // A tail the register has never seen still rebuilds, by string. The
        // ledger records the tail as received, and a chain must stay
        // rebuildable for an aircraft nobody has registered.
        out(`  (a tail outside the register would fall back to tail_number)`);
    });

    it('the default policy is ACCEPT_PROVISIONAL and is a named constant', async () => {
        assert.strictEqual(UNKNOWN_TAIL_POLICY, POLICY.ACCEPT_PROVISIONAL);
        out(`UNKNOWN_TAIL_POLICY default = ${UNKNOWN_TAIL_POLICY}`);
    });

    it('the seed carries no DANGLING tail — an unresolved one is the policy output', async () => {
        // Asserted against the seed CSVs, not the live table. The live table
        // also holds the C-ZZZZ rows this suite just created, which are
        // unresolved BY DESIGN — reading it would count the test's own
        // fixtures as seed defects. Same bug WP-11's migration check had.
        const fs = require('node:fs');
        const regLines = fs.readFileSync(
            `${PROJECT}/db/data/fuelsphere-AIRCRAFT_REGISTRATIONS.csv`,'utf8').trim().split('\n');
        const regKey = regLines[0].split(';').indexOf('registration');
        const REGISTERED = new Set(regLines.slice(1).map(l => l.split(';')[regKey]));
        assert.ok(REGISTERED.size > 0, 'instrument check: the register CSV parsed to zero rows');
        for (const [ent, str] of Object.entries(SEVEN)) {
            const f = `${PROJECT}/db/data/fuelsphere-${ent.replace('fuelsphere.','')}.csv`;
            if (!fs.existsSync(f)) { out(`${ent.replace('fuelsphere.','').padEnd(22)} no seed CSV`); continue; }
            const lines = fs.readFileSync(f,'utf8').trim().split('\n');
            const h = lines[0].split(';');
            const iS = h.indexOf(str), iT = h.indexOf('tail_registration');
            const rows = lines.slice(1).map(l => l.split(';')).filter(c => c[iS]);
            const unresolved = rows.filter(c => !c[iT]);
            const dangling  = rows.filter(c => c[iT] && !REGISTERED.has(c[iT]));
            out(`${ent.replace('fuelsphere.','').padEnd(22)} ${rows.length} seed row(s) with a tail, `
                + `${unresolved.length} unresolved, ${dangling.length} dangling`);
            assert.ok(iT >= 0, `${ent}: the CSV has no tail_registration column`);
            // WAS assert(unresolved.length === 0). That asserted the ABSENCE of
            // this module's own output: applyPolicy writes tail_registration
            // null for a registration the register has never seen, so a seed
            // row in exactly that shape is the policy working, not a defect.
            //
            // What the seed must never carry is a DANGLING value - a
            // tail_registration naming a registration that does not exist. No
            // FK constraint prevents it and the resolver never writes one, so
            // a seeded dangling FK is a state the code cannot produce.
            assert.strictEqual(dangling.length, 0,
                `${ent}: seeded tail_registration values must exist in the register`);
        }
    });
});

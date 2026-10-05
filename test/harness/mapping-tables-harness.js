/**
 * S/4 mapping tables verification harness.
 *
 * EXIT-1  the four tables exist and the service exposes them
 * EXIT-2  CAR402 - the same station, carrier and supplier may not overlap
 * EXIT-3  ...and an EXPIRED row does not block the same combination
 * EXIT-4  a DIFFERENT supplier at the same station is allowed (no serial number)
 * EXIT-5  CAR401 - a contract belonging to another supplier is refused
 * EXIT-6  CAR403 - two plants for one station and carrier overlap
 * EXIT-7  the flight app offers only suppliers the station is mapped to
 * EXIT-8  postingData resolves carrier, plant, supplier and contract line
 * EXIT-9  a contract created today, with no station coverage, can be mapped
 * EXIT-10 ...and mapped to a flight, because the station now has it
 * EXIT-11 CAR410 - a flight cannot name a supplier the station lacks
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

const MAP = '/odata/v4/mappings';

async function call(fn) {
    try { const r = await fn(); return { status: r.status, body: r.data }; }
    catch (e) {
        return { status: e.response?.status ?? 'ERR', body: e.response?.data,
                 msg: e.response?.data?.error?.message ?? e.message };
    }
}

/** Create a draft, patch it, activate it - the path the app takes. */
async function save(entity, data) {
    const draft = await call(() => test.POST(`${MAP}/${entity}`, data));
    if (!draft.body?.ID && !draft.body?.carrier_code) return draft;
    const key = draft.body.ID
        ? `ID=${draft.body.ID},IsActiveEntity=false`
        : `carrier_code='${draft.body.carrier_code}',IsActiveEntity=false`;
    return call(() => test.POST(`${MAP}/${entity}(${key})/draftActivate`, {}));
}

describe('S/4 mapping tables', () => {

    let JFK, BOS, worldFuel, shell, petron, wfContract, plant;

    before(async () => {
        const d = await db();
        [JFK] = await d.run(cds.ql.SELECT.from('fuelsphere.MASTER_AIRPORTS').where({ iata_code: 'JFK' }));
        [BOS] = await d.run(cds.ql.SELECT.from('fuelsphere.MASTER_AIRPORTS').where({ iata_code: 'BOS' }));

        const suppliers = await d.run(cds.ql.SELECT.from('fuelsphere.MASTER_SUPPLIERS'));
        worldFuel = suppliers.find(s => s.supplier_name === 'World Fuel Services Inc');
        shell = suppliers.find(s => s.supplier_name === 'Shell Aviation LLC');
        petron = suppliers.find(s => s.supplier_name === 'Petron Aviation Philippines');

        // A contract of World Fuel's that covers JFK - the value help reads
        // exactly this relationship.
        const options = await d.run(cds.ql.SELECT.from('fuelsphere.STATION_SUPPLIER_OPTIONS')
            .where({ station_code: 'JFK' }));
        wfContract = options.find(o => o.supplier_ID === worldFuel.ID);

        [plant] = await d.run(cds.ql.SELECT.from('fuelsphere.T001W_PLANT'));
        out(`JFK offers ${options.length} contract lines; World Fuel has ${wfContract ? 'one' : 'none'}`);

        // ---- A KNOWN STATE FOR THE RULE CRITERIA ------------------------
        //
        // These criteria test the RULES - that an overlap is refused, that an
        // expired row does not block a new one, that two suppliers at one
        // station are fine. Every one of them creates a row and reads the
        // status code, so they need to know what is already there.
        //
        // On 4 Oct 2026 the designation migration seeded 86 station and 149
        // flight rows, and four of these criteria began failing: the first
        // insert of JFK/B6/World Fuel now collided with a migrated row, and
        // CAR402 refused it - CORRECTLY. The rule was right and the fixture
        // was stale.
        //
        // So the migrated rows are cleared before the rules are exercised.
        // Only the migrated ones: created_by names them, so anything a person
        // or another criterion put there is left alone, and the seed itself
        // is verified by designation-migration-harness rather than here.
        const migrated = { created_by: 'MIGRATION_DESIGNATIONS' };
        await d.run(cds.ql.DELETE.from('fuelsphere.STATION_SUPPLIER_MAP').where(migrated));
        await d.run(cds.ql.DELETE.from('fuelsphere.FLIGHT_SUPPLIER_MAP').where(migrated));
        out('migrated map rows cleared, so the rule criteria start from a known state');
    });

    // ------------------------------------------------------------- EXIT-1 --
    it('EXIT-1  the service exposes the four tables and the carrier seed', async () => {
        const carriers = await call(() => test.GET(`${MAP}/Carriers`));
        assert.strictEqual(carriers.status, 200);
        out(`carriers seeded: ${carriers.body.value.map(c => `${c.carrier_code}/${c.company_code}`).join(', ')}`);
        assert.ok(carriers.body.value.some(c => c.carrier_code === 'B6' && c.company_code === 'B600'));

        for (const e of ['StationPlantMappings', 'StationSupplierMappings', 'FlightSupplierMappings']) {
            const r = await call(() => test.GET(`${MAP}/${e}`));
            assert.strictEqual(r.status, 200, `${e} is not readable`);
        }
    });

    // ------------------------------------------------------------- EXIT-2 --
    it('EXIT-2  the same station, carrier and supplier may not overlap (CAR402)', async () => {
        const first = await save('StationSupplierMappings', {
            airport_ID: JFK.ID, carrier_carrier_code: 'B6', supplier_ID: worldFuel.ID,
            contract_ID: wfContract.contract_ID, contract_line_item: '10',
            valid_from: '2026-01-01', valid_to: '2026-12-31'
        });
        out(`first row: ${first.status}`);
        assert.strictEqual(first.status, 201);

        const clash = await save('StationSupplierMappings', {
            airport_ID: JFK.ID, carrier_carrier_code: 'B6', supplier_ID: worldFuel.ID,
            contract_ID: wfContract.contract_ID, contract_line_item: '20',
            valid_from: '2026-06-01', valid_to: '2027-05-31'
        });
        out(`overlapping row: ${clash.status} - ${clash.msg}`);
        assert.notStrictEqual(clash.status, 201, 'an overlapping mapping was accepted');
        assert.match(String(clash.msg), /CAR402/);
    });

    // ------------------------------------------------------------- EXIT-3 --
    it('EXIT-3  an expired row does not block the same combination', async () => {
        const later = await save('StationSupplierMappings', {
            airport_ID: JFK.ID, carrier_carrier_code: 'B6', supplier_ID: worldFuel.ID,
            contract_ID: wfContract.contract_ID, contract_line_item: '30',
            valid_from: '2027-01-01', valid_to: null
        });
        out(`row starting after the first expires: ${later.status} ${later.msg || ''}`);
        assert.strictEqual(later.status, 201, 'a non-overlapping row was refused');
    });

    // ------------------------------------------------------------- EXIT-4 --
    it('EXIT-4  a different supplier at the same station is allowed', async () => {
        const d = await db();
        const options = await d.run(cds.ql.SELECT.from('fuelsphere.STATION_SUPPLIER_OPTIONS')
            .where({ station_code: 'JFK' }));
        const shellLine = options.find(o => o.supplier_ID === shell.ID);

        const second = await save('StationSupplierMappings', {
            airport_ID: JFK.ID, carrier_carrier_code: 'B6', supplier_ID: shell.ID,
            contract_ID: shellLine.contract_ID, contract_line_item: '10',
            valid_from: '2026-01-01', valid_to: '2026-12-31'
        });
        out(`second supplier at JFK, same dates: ${second.status} ${second.msg || ''}`);
        assert.strictEqual(second.status, 201,
            'two suppliers at one station were refused - the serial number rule came back');
    });

    // ------------------------------------------------------------- EXIT-5 --
    it('EXIT-5  a contract belonging to another supplier is refused (CAR401)', async () => {
        const wrong = await save('StationSupplierMappings', {
            airport_ID: JFK.ID, carrier_carrier_code: 'B6', supplier_ID: petron.ID,
            contract_ID: wfContract.contract_ID, contract_line_item: '10',
            valid_from: '2026-01-01', valid_to: '2026-12-31'
        });
        out(`another supplier's contract: ${wrong.status} - ${wrong.msg}`);
        assert.notStrictEqual(wrong.status, 201);
        assert.match(String(wrong.msg), /CAR401/);
    });

    // ------------------------------------------------------------- EXIT-6 --
    it('EXIT-6  two plants for one station and carrier overlap (CAR403)', async () => {
        const first = await save('StationPlantMappings', {
            airport_ID: BOS.ID, carrier_carrier_code: 'B6', plant_werks: plant.werks,
            valid_from: '2026-01-01', valid_to: null
        });
        out(`first plant mapping: ${first.status} ${first.msg || ''}`);
        assert.strictEqual(first.status, 201);

        const clash = await save('StationPlantMappings', {
            airport_ID: BOS.ID, carrier_carrier_code: 'B6', plant_werks: plant.werks,
            valid_from: '2026-07-01', valid_to: null
        });
        out(`second, overlapping: ${clash.status} - ${clash.msg}`);
        assert.match(String(clash.msg), /CAR403/);
    });

    // ------------------------------------------------------------- EXIT-7 --
    it('EXIT-7  the flight app offers only suppliers the station is mapped to', async () => {
        const all = await call(() => test.GET(`${MAP}/Suppliers`));
        const atJFK = await call(() => test.GET(
            `${MAP}/StationSuppliers?$filter=airport_ID eq ${JFK.ID}&$select=supplier_name,contract_line_item`));

        const names = [...new Set(atJFK.body.value.map(r => r.supplier_name))];
        out(`suppliers in the master: ${all.body.value.length}; mapped at JFK: ${names.length} (${names.join(', ')})`);
        assert.ok(names.length > 0, 'the station mappings made in EXIT-2 and EXIT-4 are not visible');
        assert.ok(names.length < all.body.value.length,
            'the flight list is not narrower than the full supplier master');
    });

    // ------------------------------------------------------------- EXIT-8 --
    it('EXIT-8  postingData resolves carrier, plant, supplier and contract line', async () => {
        const d = await db();

        // A ticket on a B6 flight out of JFK, with an order naming World Fuel.
        const [flight] = await d.run(cds.ql.SELECT.from('fuelsphere.FLIGHT_SCHEDULE')
            .where({ origin_airport: 'JFK', airline_code: 'B6' }).limit(1));
        const [order] = await d.run(cds.ql.SELECT.from('fuelsphere.FUEL_ORDERS')
            .where({ supplier_ID: worldFuel.ID }).limit(1));
        const [ticket] = await d.run(cds.ql.SELECT.from('fuelsphere.FUEL_TICKETS').limit(1));

        await d.run(cds.ql.UPDATE('fuelsphere.FUEL_TICKETS').where({ ID: ticket.ID })
            .set({ flight_ID: flight.ID, order_ID: order.ID, delivery_timestamp: '2026-06-15T10:00:00Z' }));

        // JFK needs a plant mapping for the answer to be complete.
        await save('StationPlantMappings', {
            airport_ID: JFK.ID, carrier_carrier_code: 'B6', plant_werks: plant.werks,
            valid_from: '2026-01-01', valid_to: null
        });

        const r = await call(() => test.GET(`${MAP}/postingData(ticketID=${ticket.ID})`));
        out('posting data: ' + JSON.stringify({
            carrier: r.body.carrier_code, company: r.body.company_code,
            plant: r.body.plant_code, supplier: r.body.supplier_name,
            source: r.body.supplier_source, contract: r.body.s4_contract_number,
            line: r.body.contract_line_item, gaps: r.body.gaps
        }));

        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.carrier_code, 'B6');
        assert.strictEqual(r.body.company_code, 'B600');
        assert.strictEqual(r.body.plant_code, plant.werks);
        assert.strictEqual(r.body.supplier_source, 'TICKET');
        assert.strictEqual(r.body.contract_line_item, '10',
            'the contract line from the station mapping did not come through');
    });

    // ------------------------------------------------------------- EXIT-9 --
    // THE CASE THAT DECIDED CAR401's SHAPE. A contract signed today has no
    // CONTRACT_LOCATIONS rows. It must still be mappable, or the tables the
    // transactional apps read cannot be maintained on the day a deal is done.
    it('EXIT-9  a contract with no station coverage can still be mapped', async () => {
        const d = await db();
        const fresh = cds.utils.uuid();
        await d.run(cds.ql.INSERT.into('fuelsphere.MASTER_CONTRACTS').entries({
            ID: fresh, contract_number: 'NEW-TODAY-001', supplier_ID: shell.ID,
            contract_type: 'TERM', currency_code: 'USD',
            valid_from: '2026-01-01', valid_to: '2027-12-31', is_active: true
        }));

        const locations = await d.run(cds.ql.SELECT.from('fuelsphere.CONTRACT_LOCATIONS')
            .where({ contract_ID: fresh }));
        out(`new contract has ${locations.length} stations listed`);

        // It is offered by the contract value help, because that help is
        // filtered by SUPPLIER rather than by station.
        const offered = await call(() => test.GET(
            `${MAP}/SupplierContracts?$filter=supplier_ID eq ${shell.ID}&$select=contract_number,station_count`));
        const names = offered.body.value.map(c => `${c.contract_number}(${c.station_count})`);
        out(`contracts offered for Shell: ${names.join(', ')}`);
        assert.ok(names.some(n => n.startsWith('NEW-TODAY-001')),
            'a contract created today is not offered by the value help');

        const saved = await save('StationSupplierMappings', {
            airport_ID: BOS.ID, carrier_carrier_code: 'B6', supplier_ID: shell.ID,
            contract_ID: fresh, contract_line_item: '10',
            valid_from: '2026-01-01', valid_to: null
        });
        out(`mapping it to BOS: ${saved.status} ${saved.msg || ''}`);
        assert.strictEqual(saved.status, 201,
            'a contract with no station coverage was refused - CAR401 is too strict again');
    });

    // ------------------------------------------------------------ EXIT-10 --
    // Shell was mapped to BOS in EXIT-9, so the flight mapping can name it.
    it('EXIT-10 a flight can name a supplier the station is mapped to', async () => {
        const saved = await save('FlightSupplierMappings', {
            flight_number: 'B6999', airport_ID: BOS.ID, carrier_carrier_code: 'B6',
            supplier_ID: shell.ID, valid_from: '2026-01-01', valid_to: null
        });
        out(`flight mapping onto a mapped station: ${saved.status} ${saved.msg || ''}`);
        assert.strictEqual(saved.status, 201);
    });

    // ------------------------------------------------------------ EXIT-11 --
    // THE ORDER THE TWO APPS ARE USED IN, enforced. The flight mapping names
    // a supplier and nothing else; the contract line it will post on lives on
    // the station mapping, so there has to be one.
    it('EXIT-11 a flight cannot name a supplier the station lacks (CAR410)', async () => {
        const refused = await save('FlightSupplierMappings', {
            flight_number: 'B6998', airport_ID: BOS.ID, carrier_carrier_code: 'B6',
            supplier_ID: petron.ID, valid_from: '2026-01-01', valid_to: null
        });
        out(`unmapped supplier at BOS: ${refused.status} - ${refused.msg}`);
        assert.notStrictEqual(refused.status, 201);
        assert.match(String(refused.msg), /CAR410/);
    });
});

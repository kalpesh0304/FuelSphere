/**
 * D44 — the readers, in three buckets.
 *
 * D44 named ONE declaration. The defect had TWO independent implementations:
 * the association, and a Map in the dispatch import that reproduced it in
 * JavaScript. Neither fix touches the other, which is why EXIT-4 and EXIT-5
 * exercise the import rather than the model.
 */
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert');
const XLSX=require(`${PROJECT}/node_modules/xlsx`);
const test=cds.test(PROJECT); const out=s=>process.stdout.write('      '+s+'\n');
const O='/odata/v4/orders';
const db=()=>cds.connect.to('db');

async function upload(row) {
    const base = {
        FUEL_ORDER_ID: 'TR-D44-1', FLIGHT_NUMBER: 'AC410', FLIGHT_DATE: '2026-04-10',
        TAIL_NUMBER: 'C-FDMO', ATD: '2026-04-10T11:20:00Z', DISPATCH_QTY_KG: 4202.5,
        ROB_DEPARTURE_KG: 6700, PAYLOAD_KG: 14000, CAPTAIN_ID: 'CAP-AC221',
        DISPATCHER_ID: 'DSP-AC101', DISPATCH_TIMESTAMP: '2026-04-10T06:00:00Z',
        DISPATCH_SOURCE: 'TRIPRECORD', PLAN_VERSION: 2, ...row
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([base]), 'Dispatch');
    const r = await test.POST(`${O}/importFlightDispatchExcel`,
        { fileName: 'd44.xlsx', fileContent: XLSX.write(wb,{type:'base64',bookType:'xlsx'}) });
    return r.data;
}

describe('D44 — the readers', () => {

  it('EXIT-1  neither FlightSchedule service exposes fuel_order; both expose orders', () => {
    for (const svc of ['PlanningService', 'FuelOrderService']) {
      const e = cds.model.definitions[`${svc}.FlightSchedule`].elements;
      assert.ok(!e.fuel_order, `${svc} still exposes fuel_order - the invitation is still open`);
      assert.ok(e.orders, `${svc} must expose orders in its place`);
      assert.ok(e.orders.is2many, `${svc}.orders must be the COMPLETE set, not another to-one`);
    }
    // The declaration stays on the database entity - handlers and history
    // both refer to it, and D44 records it as retained.
    assert.ok(cds.model.definitions['fuelsphere.FLIGHT_SCHEDULE'].elements.fuel_order,
      'the db declaration must remain, commented at the site');
    out('PlanningService and FuelOrderService: fuel_order excluded, orders exposed to-many');
  });

  it('EXIT-2  the condition is live, and orders returns ALL of them', async () => {
    const flights = await (await db()).run(SELECT.from('fuelsphere.FLIGHT_SCHEDULE').columns('ID','flight_number'));
    const counts = [];
    for (const f of flights) {
      const n = await (await db()).run(SELECT.from('fuelsphere.FUEL_ORDERS').where({ flight_ID: f.ID }));
      if (n.length > 1) counts.push([f.flight_number, f.ID, n.length]);
    }
    assert.ok(counts.length >= 1, 'instrument check: no flight has several orders, so nothing is being tested');
    const [num, id, n] = counts[0];
    // PlanningService.FlightSchedule is not draft-enabled - no IsActiveEntity key.
    const r = await test.GET(`/odata/v4/planning/FlightSchedule(${id})`
      + '?$expand=' + encodeURIComponent('orders($select=order_number)'));
    assert.strictEqual(r.data.orders.length, n, 'orders must return every order on the flight');
    out(`${num} carries ${n} orders; orders returns ${r.data.orders.length}: `
      + r.data.orders.map(o=>o.order_number).join(', '));
  });

  it('EXIT-3  nothing reads through fuel_order, and nothing was lost', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(`${PROJECT}/srv/planning-fiori-annotations.cds`,'utf8');
    // Form-agnostic: any `fuel_order.<field>` path expression, in any record.
    const paths = src.match(/\bfuel_order\.[A-Za-z_]+/g) || [];
    assert.deepStrictEqual(paths, [], `annotations still read through fuel_order: ${paths.join(', ')}`);
    // The two fields the orders list did not already carry.
    const li = cds.model.definitions['PlanningService.FuelOrders']['@UI.LineItem'];
    const values = li.map(d => d.Value && d.Value['='] || d.Value);
    for (const f of ['priority','notes','status','station_code','ordered_quantity']) {
      assert.ok(values.includes(f), `${f} was on #FuelOrderInfo and must survive on the orders list`);
    }
    out(`orders LineItem carries ${values.length} columns including priority and notes`);
  });

  it('EXIT-4  DSP458 — an ambiguous number+date is REFUSED, not resolved', async () => {
    // PR1041 is two flight rows on one date. The old Map kept whichever came
    // last and the import proceeded against a coin toss.
    const rows = await (await db()).run(SELECT.from('fuelsphere.FLIGHT_SCHEDULE')
      .columns('ID').where({ flight_number: 'PR1041', flight_date: '2026-04-01' }));
    assert.ok(rows.length > 1, 'instrument check: PR1041 must be ambiguous for this to test anything');
    const before = (await (await db()).run(SELECT.from('fuelsphere.FLIGHT_DISPATCH'))).length;
    const d = await upload({ FLIGHT_NUMBER: 'PR1041', FLIGHT_DATE: '2026-04-01', TAIL_NUMBER: 'RP-C8801' });
    const after = (await (await db()).run(SELECT.from('fuelsphere.FLIGHT_DISPATCH'))).length;
    const err = (d.errors || []).find(e => /DSP458/.test(e.message || ''));
    assert.ok(err, `expected DSP458, got ${JSON.stringify(d.errors || d)}`);
    assert.strictEqual(after, before, 'nothing may be written for a flight that cannot be identified');
    out(`${err.severity}: ${err.message.slice(0,120)}`);
  });

  it('EXIT-5  the plan links the order that FULFILS it, or no order at all', async () => {
    // AC410 is unambiguous and its active plan has an order pointing at it
    // only if a previous import made one. On this seed none does, so the
    // correct outcome is NO LINK - a plan with no order is a real state.
    const d = await upload({ FLIGHT_NUMBER: 'AC410', FLIGHT_DATE: '2026-04-10' });
    assert.ok(!(d.errors||[]).some(e=>e.severity==='ERROR'), JSON.stringify(d.errors));
    const plans = await (await db()).run(SELECT.from('fuelsphere.FLIGHT_DISPATCH')
      .columns('ID','plan_version','plan_status','fuel_order_ID')
      .where({ plan_group_id: 'AC410-20260410-YYZYUL' }));
    const active = plans.find(p => p.plan_status === 'ACTIVE');
    assert.ok(active, 'the import must have produced an active plan');
    const orders = await (await db()).run(SELECT.from('fuelsphere.FUEL_ORDERS')
      .columns('ID').where({ dispatch_plan_ID: { '!=': null } }));
    const claimed = new Set(orders.map(o=>o.ID));
    assert.ok(active.fuel_order_ID === null || claimed.has(active.fuel_order_ID),
      'a linked order must be one that claims a plan - never an arbitrary order on the flight');
    out(`active v${active.plan_version} fuel_order_ID=${active.fuel_order_ID} `
      + `(orders claiming a plan: ${claimed.size})`);
  });

  it('EXIT-6  the auto-create path still fires with the dead guard gone', async () => {
    const before = (await (await db()).run(SELECT.from('fuelsphere.FUEL_ORDERS'))).length;
    const r = await test.POST('/odata/v4/planning/FlightSchedule', {
      flight_number: 'AC777', flight_date: '2026-04-20', aircraft_reg: 'C-FDMO',
      tail_registration: 'C-FDMO', origin_airport: 'YYZ', destination_airport: 'YUL',
      status: 'SCHEDULED'
    });
    assert.strictEqual(r.status, 201);
    const after = (await (await db()).run(SELECT.from('fuelsphere.FUEL_ORDERS'))).length;
    assert.strictEqual(after, before + 1, 'the removed guard must not have removed the behaviour');
    out(`flight created -> orders ${before} -> ${after}`);
  });
});

/**
 * MANUAL ORDER CREATION — FROM THE FLIGHT, NOT FROM THE ORDER LIST.
 *
 *   EXIT-1  the action is BOUND, so the flight is context and not an input
 *   EXIT-2  ONE implementation reached two ways — the bound form delegates
 *   EXIT-3  the three variance states, and the third has NO field
 *   EXIT-4  THE RULE FIRES THROUGH THE BOUND FORM — mass is DERIVED
 *   EXIT-5  the two conditionals: parent_order and tankering_sectors
 *   EXIT-6  dispatch_plan_ID is SET, which it never was before
 *   EXIT-7  the button is on the DISPATCH section, and the new order lands
 *           in the flight's orders[] with nothing further done
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert');
const test=cds.test(PROJECT); const out=s=>process.stdout.write('      '+s+'\n');
const O='/odata/v4/orders';
const msg=e=>{const d=e.response&&e.response.data&&e.response.data.error;return d?d.message:e.message;};

describe('Manual order creation', () => {

  let withPlan, noPlan, sup, contract, edmx;
  before(async () => {
    const { SELECT } = cds.ql;
    const plans = await cds.db.run(SELECT.from('fuelsphere.FLIGHT_DISPATCH')
      .columns('ID','flight_schedule_ID','flight_number','required_uplift_kg'));
    withPlan = plans.find(p => p.required_uplift_kg != null);
    noPlan   = plans.find(p => p.required_uplift_kg == null);
    assert.ok(withPlan && noPlan,
      'the seed no longer holds BOTH a plan with a required uplift and one without, so the three '
    + 'states cannot all be exercised');
    sup = (await cds.db.run(SELECT.from('fuelsphere.MASTER_SUPPLIERS').columns('ID')))[0];
    contract = (await cds.db.run(SELECT.from('fuelsphere.MASTER_CONTRACTS').columns('ID')))[0];
    edmx = cds.compile.to.edmx(cds.model, { service:'FuelOrderService', version:'v4' });
  });

  const bound = (flightId, data) => test.POST(
    `${O}/FlightSchedule(${flightId})/FuelOrderService.createFuelOrder`,
    Object.assign({ supplierId: sup.ID, unitPrice: 0.85, currencyCode: 'USD' }, data));

  it('EXIT-1  the action is BOUND — the flight is context, not an input', () => {
    // The unbound form takes a flightId, which on a screen means typing or
    // picking the flight. The page already knows the number, the date and the
    // station, and any of the three can be got wrong.
    const m = /<Action Name="createFuelOrder"[^>]*IsBound="true"[\s\S]*?<\/Action>/.exec(edmx);
    assert.ok(m, 'createFuelOrder is not a BOUND action');
    assert.ok(/Name="in" Type="FuelOrderService.FlightSchedule"/.test(m[0]),
      'createFuelOrder is bound to something other than FlightSchedule');
    const params = [...m[0].matchAll(/<Parameter Name="(\w+)"/g)].map(x=>x[1]);
    assert.ok(!params.includes('flightId'),
      'the bound action still takes a flightId. The flight is the binding context; accepting it as '
    + 'a parameter lets a caller name a DIFFERENT flight from the one on screen.');
    for (const p of ['orderedQuantity','orderType','quantityVarianceReason','parentOrderId','tankeringSectors'])
      assert.ok(params.includes(p), `the bound action does not take ${p}`);
    out(`bound to FlightSchedule, ${params.length} parameters, no flightId among them`);
  });

  it('EXIT-2  ONE implementation, reached two ways', async () => {
    // Two implementations of one rule is D44, and a create path is exactly
    // where a second copy drifts: the gate, the number allocation, the plan
    // derivation and the three variance states would all need repeating.
    const src = require('node:fs').readFileSync(`${PROJECT}/srv/order-service.js`,'utf8');
    const inserts = (src.match(/INSERT\.into\(FuelOrders\)/g) || []).length;
    assert.strictEqual(inserts, 1,
      `${inserts} separate INSERTs into FuelOrders. The bound form must DELEGATE to the unbound one, `
    + `not repeat its body - that is D44's shape in a create path.`);
    out('one INSERT into FuelOrders in the whole service; the bound form delegates');
  });

  it('EXIT-3  the three variance states, and the third has NO field', async () => {
    const f = withPlan.flight_schedule_ID, planned = Number(withPlan.required_uplift_kg);
    // STATE 1 - differs, no reason -> refused
    await assert.rejects(() => bound(f, { orderedQuantity: 9999 }),
      e => /A reason is required/.test(msg(e)),
      'an order differing from its plan was accepted with no reason — that is the variance nobody sees');
    // STATE 1 - with a reason -> allowed, both fields land
    const { data: ok } = await bound(f, { orderedQuantity: 9999,
      quantityVarianceReason: 'Bowser capacity rounds up' });
    assert.strictEqual(Number(ok.planned_quantity_kg), planned,
      'the plan figure was not COPIED onto the order, so the reason explains a comparison the order '
    + 'cannot show');
    assert.ok(ok.quantity_variance_reason, 'the reason was not stored');
    // STATE 3 - no plan figure, a reason offered -> refused
    await assert.rejects(() => bound(noPlan.flight_schedule_ID,
      { orderedQuantity: 2000, quantityVarianceReason: 'invented' }),
      e => /nothing to differ from/.test(msg(e)),
      'a reason was accepted where the plan carries no figure — that invents a comparison');
    // STATE 3 - no reason -> allowed, planned null
    const { data: none } = await bound(noPlan.flight_schedule_ID, { orderedQuantity: 2000 });
    assert.strictEqual(none.planned_quantity_kg, null,
      'an order against a planless flight carries a plan figure from somewhere');
    assert.strictEqual(none.quantity_variance_reason, null);
    out(`differs->refused, differs+reason->${ok.order_number} (planned ${ok.planned_quantity_kg}), `
      + `planless+reason->refused, planless->${none.order_number} (planned null)`);
  });

  it('EXIT-4  THE RULE FIRES THROUGH THE BOUND FORM — mass is DERIVED', async () => {
    // MEASURED, AND IT DID NOT AT FIRST. The bound action carries no
    // orderedQuantityKg, because a person types a VOLUME. With no mass to
    // compare, `differs` was false on every order and NO REASON WAS EVER
    // REQUIRED - the guard was inert on the only path a screen would take.
    //
    // A guard whose trigger cannot occur has never been tested, and reading
    // it would not have said so. Deriving the mass from the typed volume and
    // the resolved density is the stated rule: quantity x density.
    const m = /<Action Name="createFuelOrder"[^>]*>[\s\S]*?<\/Action>/.exec(edmx);
    assert.strictEqual(/<Parameter Name="orderedQuantityKg"/.test(m[0]), false,
      'the bound action now takes a mass. If that is deliberate, this criterion should assert the '
    + 'derivation is still used where it is omitted.');
    const f = withPlan.flight_schedule_ID;
    let fired = false;
    try { await bound(f, { orderedQuantity: 99999 }); }
    catch (e) { fired = /A reason is required/.test(msg(e)); }
    assert.ok(fired,
      'a volume-only order did not trigger the variance rule. The mass is not being derived, so the '
    + 'rule is inert on the path a screen actually takes.');
    // AND THE COMPUTED MASS IS NOT RECORDED. This first wrote it, with the
    // density, and broke WP-11 EXIT-1d — "a derived value with a missing
    // input is null", which is a standing rule and not just that harness's
    // opinion. Recording conversion_density on an order where nobody supplied
    // a mass claims a conversion that did not happen.
    //
    // A COMPARISON IS NOT A STORED FACT. The check needs a number; the row
    // does not. The error message quotes the figure it compared, so the
    // refusal is still auditable without the order asserting a conversion.
    const { data } = await bound(f, { orderedQuantity: 99999, quantityVarianceReason: 'x' });
    assert.strictEqual(data.ordered_quantity_kg, null,
      'the comparison mass was WRITTEN onto the order. No mass was supplied, so a recorded '
    + 'ordered_quantity_kg claims a conversion nobody made - WP-11 EXIT-1d.');
    assert.strictEqual(data.conversion_density, null,
      'a density was recorded for a conversion that did not happen');
    assert.strictEqual(Number(data.ordered_quantity), 99999, 'the typed volume must stand');
    out(`volume-only order: the rule fired on a computed mass, and neither the mass nor the `
      + `density was recorded (quantity stands at ${data.ordered_quantity})`);
  });

  it('EXIT-5  the two conditionals', async () => {
    const f = noPlan.flight_schedule_ID;
    const cases = [
      [{ orderedQuantity: 100, orderType: 'AMENDMENT' }, /must name the order it amends/, 'AMENDMENT with no parent'],
      [{ orderedQuantity: 100, orderType: 'ORIGINAL', parentOrderId: cds.utils.uuid() }, /cannot name a parent/, 'ORIGINAL with a parent'],
      [{ orderedQuantity: 100, orderType: 'ORIGINAL', tankeringSectors: 2 }, /applies only to a TANKERING/, 'sectors on a non-tankering order'],
      [{ orderedQuantity: 100, orderType: 'URGENT' }, /is not one of/, 'an order type outside the four']
    ];
    for (const [data, re, label] of cases)
      await assert.rejects(() => bound(f, data), e => re.test(msg(e)), `${label} was accepted`);
    const { data } = await bound(f, { orderedQuantity: 100, orderType: 'TANKERING', tankeringSectors: 2 });
    assert.strictEqual(data.order_type, 'TANKERING');
    assert.strictEqual(data.tankering_sectors, 2);
    assert.strictEqual(data.is_tankering, true,
      'order_type TANKERING did not set is_tankering, so the two now disagree');
    out(`4 refusals as expected; TANKERING sets order_type, sectors and is_tankering together`);
  });

  it('EXIT-6  dispatch_plan_ID is SET, which it never was before', async () => {
    // It came back null on ALL 25 seeded orders and on every order this
    // action made before today. A creation path that sets it is what makes
    // the link real rather than modelled.
    const { data } = await bound(withPlan.flight_schedule_ID,
      { orderedQuantity: 9999, quantityVarianceReason: 'r' });
    assert.strictEqual(data.dispatch_plan_ID, withPlan.ID,
      'the new order does not name the flight\'s ACTIVE plan');
    out(`order names plan ${String(withPlan.ID).slice(0,8)} (${withPlan.flight_number})`);
  });

  it('EXIT-7  the button is on the DISPATCH section, and the order lands in orders[]', async () => {
    const blk = /<Annotations Target="FuelOrderService\.FlightSchedule">([\s\S]*?)<\/Annotations>/.exec(edmx)[1];
    const m = /<PropertyValue Property="ID" String="FlightDispatchPlans"\/>[\s\S]{0,900}/.exec(blk);
    assert.ok(m, 'the Dispatch Plans facet is gone');
    assert.ok(/@UI\.FieldGroup#RaiseOrder/.test(m[0]),
      'the create action is not in the Dispatch Plans section. On the order list a person types the '
    + 'flight, the date and the station - all of which the flight page already knows.');
    // FORM-AGNOSTIC. This first read `Action="FuelOrderService.createFuelOrder"`
    // and failed on correct code: the EDMX emits an action reference as
    // `<PropertyValue Property="Action" String="..."/>`, not as an attribute.
    // The one-form search, in the check rather than in the code.
    const named = [...blk.matchAll(/Property="Action" String="([^"]+)"/g)].map(x => x[1]);
    assert.ok(named.includes('FuelOrderService.createFuelOrder'),
      `no DataFieldForAction names createFuelOrder (found: ${named.join(', ') || 'none'})`);

    // AND IT APPEARS WITHOUT ANYTHING FURTHER. A to-many that shows nothing
    // after a create is the failure this would produce.
    const f = noPlan.flight_schedule_ID;
    const before = (await test.GET(`${O}/FlightSchedule(${f})?$expand=orders($select=order_number)`)).data.orders.length;
    const { data: made } = await bound(f, { orderedQuantity: 500 });
    const after = (await test.GET(`${O}/FlightSchedule(${f})?$expand=orders($select=order_number)`)).data.orders;
    assert.strictEqual(after.length, before + 1,
      `the flight's orders went from ${before} to ${after.length}; a new order did not appear`);
    assert.ok(after.some(o => o.order_number === made.order_number),
      'the new order is not among the flight\'s orders');
    out(`button on the Dispatch Plans section; orders[] ${before} -> ${after.length}, `
      + `including ${made.order_number}`);
  });
});

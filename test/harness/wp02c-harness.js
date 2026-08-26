/**
 * WP-02C — the eighteen bound actions with no @requires (D26).
 *
 * MUST run under kind: 'mocked'. Under dummy auth every call passes and the
 * suite proves nothing, which is the blindness this package exists to fix.
 * The auth block is replaced WHOLE — kind and users together — because
 * overriding kind alone discards the twelve test users.
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert');
const USERS=require(`${PROJECT}/.cdsrc.json`)['[development]'].auth.users;
process.env.CDS_ENV='development';
process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
process.env.CDS_REQUIRES_AUTH=JSON.stringify({ kind:'mocked', users:USERS });
const test=cds.test(PROJECT);
const out=s=>process.stdout.write('      '+s+'\n');

const PATHS={ BurnService:'/odata/v4/burn', FuelOrderService:'/odata/v4/orders',
              TicketService:'/odata/v4/tickets' };

// entity -> [service, db table, the eighteen, a user holding the mirrored
// UPDATE scope, a user lacking it]. Every "lacking" user is analyst, who
// holds ReportView and therefore appears in the READ grant of all six — so a
// refusal is attributable to the missing ACTION grant, not to being locked
// out of the entity.
const SET=[
 ['BurnService','FuelBurns','fuelsphere.FUEL_BURNS',
   ['confirm','reject','recalculateVariance','flagForReview','completeReview','postToFinance'],
   'ops','analyst'],
 ['BurnService','ROBLedger','fuelsphere.ROB_LEDGER',
   ['approveAdjustment','rejectAdjustment'],'ops','analyst'],
 ['BurnService','FuelBurnExceptions','fuelsphere.FUEL_BURN_EXCEPTIONS',
   ['assign','startInvestigation','resolve','close','linkMaintenance'],'ops','analyst'],
 ['FuelOrderService','FuelOrders','fuelsphere.FUEL_ORDERS',
   ['complete','crewReview'],'crew','analyst'],
 ['FuelOrderService','FuelDeliveries','fuelsphere.FUEL_DELIVERIES',
   ['calculateTemperatureCorrection','validateDelivery'],'delivery','analyst'],
 ['TicketService','FuelTickets','fuelsphere.FUEL_TICKETS',
   ['attachToOrder'],'delivery','analyst'],
];

const IDS={};
const isFunction=(svc,entity,action)=>{
  const d=cds.model.definitions[`${svc}.${entity}`];
  return !!(d&&d.actions&&d.actions[action]&&d.actions[action].kind==='function');
};
const call=async(user,url,fn)=>{
  const auth={auth:{username:user,password:''}};
  try { return (fn ? await test.GET(url,auth) : await test.POST(url,{},auth)).status; }
  catch(e){ return e.response?.status ?? 'ERR'; }
};

describe('WP-02C — the eighteen bound actions (D26)', function () {

  before(async () => {
    const db=await cds.connect.to('db');
    for (const [,entity,table] of SET) {
      let row=await db.run(SELECT.one.from(table));
      if (!row) {   // FUEL_BURN_EXCEPTIONS is seeded empty
        const id=cds.utils.uuid();
        await db.run(INSERT.into(table).entries({ ID:id, tail_number:'C-FITU',
          exception_type:'VARIANCE', status:'OPEN', detected_at:new Date().toISOString() }));
        row=await db.run(SELECT.one.from(table).where({ID:id}));
      }
      IDS[entity]=row.ID;
    }
  });

  it('running under mocked auth, and auth is actually enforced', async () => {
    assert.strictEqual(cds.env.requires.auth.kind,'mocked','dummy auth passes everything vacuously');
    assert.ok(Object.keys(cds.env.requires.auth.users||{}).length>=12,'the users map must survive the override');
    const anon=await (async()=>{ try{ return (await test.POST(
      `${PATHS.BurnService}/FuelBurns(ID=${IDS.FuelBurns},IsActiveEntity=true)/BurnService.confirm`,{})).status; }
      catch(e){ return e.response?.status??'ERR'; } })();
    out(`auth kind=mocked, users=${Object.keys(cds.env.requires.auth.users).length}, unauthenticated confirm -> ${anon}`);
    assert.ok(anon===401||anon===403,`auth must be enforced, got ${anon}`);
  });

  it('all eighteen: the holder is not refused, the non-holder is', async () => {
    let checked=0, refusedForHolder=[], allowedForNonHolder=[];
    for (const [svc,entity,,actions,holder,lacker] of SET) {
      for (const a of actions) {
        const fn=isFunction(svc,entity,a);
        const url=`${PATHS[svc]}/${entity}(ID=${IDS[entity]},IsActiveEntity=true)/${svc}.${a}`;
        const h=await call(holder,url,fn);
        const l=await call(lacker,url,fn);
        checked++;
        // A 405 is a wrong-verb answer and says nothing about authorisation.
        assert.notStrictEqual(h,405,`${entity}.${a}: wrong verb for the holder`);
        assert.notStrictEqual(l,405,`${entity}.${a}: wrong verb for the non-holder`);
        if (h===403) refusedForHolder.push(`${entity}.${a}`);
        if (l!==403) allowedForNonHolder.push(`${entity}.${a} -> ${l}`);
        out(`${(entity+'.'+a).padEnd(46)} ${holder.padEnd(9)}${String(h).padEnd(6)} ${lacker.padEnd(8)}${l}`);
      }
    }
    out(`${checked} action(s) checked`);
    assert.strictEqual(checked,18,'the set must be all eighteen');
    assert.deepStrictEqual(refusedForHolder,[],'a holder of the mirrored scope must not be refused');
    assert.deepStrictEqual(allowedForNonHolder,[],'a non-holder must be refused with 403');
  });

  it('no scope was added or widened', async () => {
    const fs=require('fs');
    const scopes=t=>new Set([...t.matchAll(/to:\s*\[([^\]]*)\]/g)]
      .flatMap(m=>[...m[1].matchAll(/'([^']+)'/g)].map(x=>x[1])));
    const after=scopes(fs.readFileSync(`${PROJECT}/srv/authorization.cds`,'utf8'));
    const before=scopes(fs.readFileSync('/tmp/auth.before','utf8'));
    out(`scopes before ${before.size}, after ${after.size}, added ${[...after].filter(x=>!before.has(x)).length}`);
    assert.deepStrictEqual([...after].filter(x=>!before.has(x)),[],'a scope was added');
  });
});

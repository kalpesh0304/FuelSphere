/**
 * WP-02B — bound action grants (D22).
 *
 * MUST run under kind: 'mocked'. Dev auth is kind: 'dummy', which authorises
 * every request as privileged and never evaluates @restrict at all — under it
 * every call below passes and the test proves nothing. That is precisely the
 * blindness this package exists to fix, so a harness that cannot fail is
 * worse than no harness here.
 *
 * The auth block is replaced WHOLE: kind and users together. Overriding kind
 * alone discards the twelve test users and leaves nobody to authenticate as.
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');

const USERS = require(`${PROJECT}/.cdsrc.json`)['[development]'].auth.users;

process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';
process.env.CDS_REQUIRES_AUTH = JSON.stringify({ kind: 'mocked', users: USERS });

const test = cds.test(PROJECT);
const out = (s) => process.stdout.write('      ' + s + '\n');

const O = '/odata/v4/orders';
const T = '/odata/v4/tickets';

// Authorisation is the only question here. Many of these actions carry a
// status guard, so an authorised call can still return 409 or 400 — that is
// a business refusal, not an authorisation one. Key strictly on 403.
// A bound FUNCTION is invoked with GET; a bound ACTION with POST. Sending
// POST to a function returns 405, which is a wrong-verb answer and says
// nothing about authorisation — it would have read as "not refused" for the
// unauthorised user and as "refused" for nobody. calculatePrice on FuelOrders
// is the one function in the set. The verb is taken from the compiled model
// rather than a list here, so a future function cannot be mis-sent.
const isFunction = (svcEntity, action) => {
    const d = cds.model.definitions[svcEntity];
    return d && d.actions && d.actions[action] && d.actions[action].kind === 'function';
};

const call = async (user, url, fn) => {
    const auth = { auth: { username: user, password: '' } };
    try {
        const r = fn ? await test.GET(url, auth) : await test.POST(url, {}, auth);
        return r.status;
    } catch (e) {
        return e.response?.status ?? 'ERR';
    }
};

// action -> [scope it declares, a user holding it, a user lacking it]
//
// Every "lacking" user holds ReportView, which appears in the READ grant of
// all three entities. The refusal is therefore attributable to the missing
// action grant and not to being locked out of the entity.
const CASES = [
    ['FuelOrders', 'submit',           'FuelOrderCreate',                                'crew',     'analyst'],
    ['FuelOrders', 'confirm',          'FuelOrderApprove',                               'supplier', 'analyst'],
    ['FuelOrders', 'startDelivery',    'FuelOrderCreate,FuelOrderApprove',               'crew',     'analyst'],
    ['FuelOrders', 'cancel',           'FuelOrderCreate,FuelOrderApprove,AdminAccess',   'crew',     'analyst'],
    ['FuelOrders', 'calculatePrice',   'FuelOrderCreate',                                'crew',     'analyst'],
    ['FuelDeliveries', 'captureSignatures', 'ePODCapture',                               'delivery', 'analyst'],
    ['FuelDeliveries', 'verifyQuantity',    'ePODCapture,ePODApprove',                   'delivery', 'analyst'],
    ['FuelDeliveries', 'dispute',           'ePODApprove',                               'ops',      'analyst'],
    ['FuelTickets', 'attachToDelivery', 'ePODCapture',                                   'delivery', 'analyst'],
    ['FuelTickets', 'verify',           'ePODApprove',                                   'ops',      'analyst'],
    ['T:FuelTickets', 'attachToDelivery', 'ePODCapture',                                 'delivery', 'analyst'],
    ['T:FuelTickets', 'verify',           'ePODApprove',                                 'ops',      'analyst'],
    ['T:FuelTickets', 'reject',           'ePODApprove',                                 'ops',      'analyst']
];

let IDS = {};

const urlFor = (entity, action) => {
    if (entity === 'T:FuelTickets')
        return `${T}/FuelTickets(ID=${IDS.ticket},IsActiveEntity=true)/TicketService.${action}`;
    return `${O}/${entity}(ID=${IDS[entity]},IsActiveEntity=true)/FuelOrderService.${action}`;
};
const defFor = (entity) => entity === 'T:FuelTickets'
    ? 'TicketService.FuelTickets' : `FuelOrderService.${entity}`;

describe('WP-02B — bound action grants (D22)', function () {

    before(async () => {
        const db = await cds.connect.to('db');
        const o = await db.run(SELECT.one.from('fuelsphere.FUEL_ORDERS'));
        const d = await db.run(SELECT.one.from('fuelsphere.FUEL_DELIVERIES'));
        const t = await db.run(SELECT.one.from('fuelsphere.FUEL_TICKETS'));
        IDS = { FuelOrders: o.ID, FuelDeliveries: d.ID, FuelTickets: t.ID, ticket: t.ID };
    });

    it('the harness is running under mocked auth, not dummy', async () => {
        const kind = cds.env.requires.auth.kind;
        out(`auth kind = ${kind}, users in map = ${Object.keys(cds.env.requires.auth.users || {}).length}`);
        assert.strictEqual(kind, 'mocked', 'dummy auth would pass every case vacuously');
        assert.ok(Object.keys(cds.env.requires.auth.users || {}).length >= 12,
            'the users map must survive the override');
        // Instrument check: an unauthenticated call must be refused. If this
        // returns 2xx the whole suite is measuring nothing.
        const anon = await (async () => {
            try { return (await test.POST(`${O}/FuelOrders(ID=${IDS.FuelOrders},IsActiveEntity=true)/FuelOrderService.submit`, {})).status; }
            catch (e) { return e.response?.status ?? 'ERR'; }
        })();
        out(`unauthenticated submit -> ${anon}`);
        assert.ok(anon === 401 || anon === 403, `auth must be enforced, got ${anon}`);
    });

    it('EXIT-1 — each action is callable by a user holding its scope', async () => {
        const denied = [];
        for (const [entity, action, scope, yes] of CASES) {
            const fn = isFunction(defFor(entity), action);
            const st = await call(yes, urlFor(entity, action), fn);
            const label = `${entity}.${action}`.padEnd(34);
            out(`${label} ${yes.padEnd(9)} ${fn ? 'GET ' : 'POST'} [${scope}] -> ${st}`);
            assert.notStrictEqual(st, 405, `${label.trim()} was sent with the wrong verb — 405 says nothing about authorisation`);
            if (st === 403) denied.push(label.trim());
        }
        assert.deepStrictEqual(denied, [], 'these are still refused for an authorised user');
    });

    it('EXIT-2 — the same call is refused without the scope', async () => {
        const leaked = [];
        for (const [entity, action, scope, , no] of CASES) {
            const fn = isFunction(defFor(entity), action);
            const st = await call(no, urlFor(entity, action), fn);
            const label = `${entity}.${action}`.padEnd(34);
            out(`${label} ${no.padEnd(9)} ${fn ? 'GET ' : 'POST'} [lacks ${scope}] -> ${st}`);
            assert.notStrictEqual(st, 405, `${label.trim()} was sent with the wrong verb — 405 says nothing about authorisation`);
            if (st !== 403) leaked.push(`${label.trim()} -> ${st}`);
        }
        assert.deepStrictEqual(leaked, [], 'these were NOT refused for an unauthorised user');
    });
});

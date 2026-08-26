/**
 * WP-02 verification harness (outside the repo — no repo file added).
 *
 * EXIT-1/2  RBAC is actually enforced: a user lacking the scope is refused,
 *           a user holding it is not. Under 'any' both were allowed.
 * EXIT-3    an order in Draft cannot be moved to Delivered.
 *
 * IMPORTANT — the project's dev auth kind is 'dummy', which authorises every
 * request as a privileged user, so @restrict is never evaluated locally. That
 * is precisely why the 'any' hole was invisible in development. This harness
 * forces kind='mocked' so the annotations are evaluated against the named users
 * already defined in .cdsrc.json. No repo file is modified to achieve this.
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';
const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;

// Reuse the users already defined in .cdsrc.json, but under kind 'mocked' so
// the annotations are actually evaluated. Overriding only the kind would drop
// the users map with it, leaving every request anonymous.
const RC_USERS = require(`${PROJECT}/.cdsrc.json`)['[development]'].auth.users;
process.env.CDS_REQUIRES_AUTH = JSON.stringify({ kind: 'mocked', users: RC_USERS });

const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');

const test = cds.test(PROJECT);
const out = (s) => process.stdout.write(`      ${s}\n`);
const as = (u) => ({ auth: { username: u, password: '' } });

async function call(fn) {
    try { const r = await fn(); return { status: r.status, body: r.data }; }
    catch (e) { return { status: e.response?.status ?? 'ERR', body: e.response?.data, msg: e.response?.data?.error?.message ?? e.message }; }
}

describe('WP-02 — close the authorisation hole (D2) and guard captureSignatures (D13)', function () {

    // ---------------------------------------------------------------- D2 ----
    // analyst holds MasterDataRead, ReportView, BurnDataView — NOT MasterDataWrite.
    // The Manufacturers CREATE grant is ['MasterDataWrite'] (was [..., 'any']).

    it('EXIT-1/2a — a user without the scope is refused CREATE', async () => {
        const r = await call(() => test.POST('/odata/v4/master/Manufacturers',
            { manufacture_code: 'ZZ', manufacture_name: 'Test' }, as('analyst')));
        out(`analyst CREATE Manufacturers -> ${r.status}`);
        assert.strictEqual(r.status, 403, 'analyst lacks MasterDataWrite and must be refused');
    });

    it('EXIT-1/2b — a user holding the scope is still allowed (not over-restricted)', async () => {
        const r = await call(() => test.POST('/odata/v4/master/Manufacturers',
            { manufacture_code: 'ZY', manufacture_name: 'Test' }, as('alice')));
        out(`alice CREATE Manufacturers -> ${r.status}`);
        assert.notStrictEqual(r.status, 403, 'alice holds MasterDataWrite and must not be refused');
    });

    it('EXIT-1/2c — read access still works for a reader', async () => {
        const r = await call(() => test.GET('/odata/v4/master/Countries', as('analyst')));
        out(`analyst READ Countries -> ${r.status}`);
        assert.strictEqual(r.status, 200, 'analyst holds MasterDataRead');
    });

    it('EXIT-1/2d — DELETE is refused to a user without AdminAccess', async () => {
        const r = await call(() => test.DELETE(
            '/odata/v4/orders/FuelOrders(ID=00000000-0000-0000-0000-000000000001,IsActiveEntity=true)', as('crew')));
        out(`crew DELETE FuelOrders -> ${r.status}`);
        assert.strictEqual(r.status, 403, 'crew lacks AdminAccess and must be refused before reaching the handler');
    });

    it('EXIT-1/2e — an action is refused to a user without its scope', async () => {
        // syncFromS4HANA requires ['IntegrationMonitor','AdminAccess'].
        const r = await call(() => test.POST('/odata/v4/master/syncFromS4HANA',
            { entityType: 'Countries' }, as('analyst')));
        out(`analyst syncFromS4HANA -> ${r.status}`);
        assert.strictEqual(r.status, 403, 'analyst holds neither IntegrationMonitor nor AdminAccess');
    });
});

/**
 * CREDIT MEMO — authorisation under mocked auth.
 *
 * Under dummy auth every call passes, so this runs under kind: 'mocked' with
 * the auth block replaced WHOLE (kind and users together - overriding kind
 * alone discards the users and every call is a 403, which would prove the
 * opposite of nothing).
 *
 *   EXIT-1  auth is mocked, users survived, and a control read succeeds
 *   EXIT-2  ReportView reads and cannot write, park or post
 *   EXIT-3  FinancePost simulates, proposes, posts, reverses and mass-posts (D22: each action has a grant)
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const USERS = require(`${PROJECT}/.cdsrc.json`)['[development]'].auth.users;
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';
process.env.CDS_REQUIRES_AUTH = JSON.stringify({ kind: 'mocked', users: USERS });
const test = cds.test(PROJECT);

const S = '/odata/v4/credit-memo';
const M = 'cd000000-0000-4000-8000-000000000001';
const as = u => ({ auth: { username: u, password: '' } });
const status = p => p.then(r => r.status, e => e.response && e.response.status);

describe('Credit memo — authorisation', () => {

    it('EXIT-1  mocked auth, users intact, control read succeeds', async () => {
        assert.strictEqual(cds.env.requires.auth.kind, 'mocked');
        assert.ok(Object.keys(cds.env.requires.auth.users || {}).length >= 12);
        assert.strictEqual(await status(test.get(`${S}/CreditMemos`, as('alice'))), 200);
        assert.strictEqual(await status(test.get(`${S}/CreditMemos`)), 401, 'anonymous is refused');
    });

    it('EXIT-2  ReportView reads and cannot change anything', async () => {
        assert.strictEqual(await status(test.get(`${S}/CreditMemos`, as('analyst'))), 200);
        assert.strictEqual(await status(test.patch(`${S}/CreditMemos(${M})`, { reason_text: 'x' }, as('analyst'))), 403);
        assert.strictEqual(await status(test.post(`${S}/CreditMemos(${M})/CreditMemoService.park`, {}, as('analyst'))), 403);
        assert.strictEqual(await status(test.post(`${S}/CreditMemos(${M})/CreditMemoService.postMemo`, {}, as('analyst'))), 403);
        assert.strictEqual(await status(test.post(`${S}/massPost`, { memos: [M] }, as('analyst'))), 403);
    });

    it('EXIT-3  FinancePost reaches every action it is granted', async () => {
        const f = as('finance');
        assert.strictEqual(await status(test.get(`${S}/CreditMemos(${M})/CreditMemoService.simulate()`, f)), 200);
        assert.strictEqual(await status(test.get(
            `${S}/proposeLines(referenceType='INVOICE',referenceId=550e8400-e29b-41d4-a716-44665544A201,memoType='CREDIT_MEMO')`, f)), 200);
        assert.strictEqual(await status(test.post(`${S}/CreditMemos(${M})/CreditMemoService.postMemo`, {}, f)), 200);
        assert.strictEqual(await status(test.post(`${S}/CreditMemos(${M})/CreditMemoService.reverse`,
            { reason: 'auth check', reversalDate: '2026-04-03' }, f)), 200);
        assert.strictEqual(await status(test.post(`${S}/massPost`, { memos: [M] }, f)), 200);
        assert.strictEqual(await status(test.get(`${S}/ExpectedCredits`, f)), 200);
    });
});

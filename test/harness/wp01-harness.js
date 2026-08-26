/**
 * WP-01 verification harness (lives outside the repo — no repo file is added).
 *
 * Drives the real HTTP action endpoint through cds.test, so the request /
 * transaction lifecycle is exactly the production one.
 *
 * Scenarios per full-replace feed:
 *   HAPPY   — valid source rows            → table replaced, sync reports success
 *   MIDFAIL — INSERT fails after DELETE    → EXIT-1: table must be intact
 *   ZERO    — source returns zero rows     → EXIT-2: abort before any DELETE
 *
 * MIDFAIL is induced at the database layer: the first INSERT issued after the
 * DELETE is rejected, simulating an infrastructure failure (dropped connection,
 * DB restart) at exactly the window D1 describes. The injection sits below the
 * handler, so the handler's own code path is untouched. It is applied at the db
 * layer rather than via duplicate keys because MASTER_SUPPLIERS is `cuid` — its
 * primary key is a generated UUID, so duplicate business keys raise no error.
 *
 * Every check throws on failure, so mocha's pass/fail is the actual verdict.
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
// WP01_DB lets the same harness run against an in-memory DB or a file-backed
// one. A second connection to ':memory:' would see a separate empty database,
// which could masquerade as a transaction fault — the file-backed run rules
// that artifact out.
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = process.env.WP01_DB || ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
// Harness lives outside the project, so resolve CAP from the project's own tree.
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');

const FEEDS = [
    { entityType: 'Countries', dbEntity: 'fuelsphere.T005_COUNTRY',     keySrcField: 'Country',         extra: { CountryName: 'X' } },
    { entityType: 'Plants',    dbEntity: 'fuelsphere.T001W_PLANT',      keySrcField: 'Plant',           extra: { PlantName: 'X' } },
    { entityType: 'Suppliers', dbEntity: 'fuelsphere.MASTER_SUPPLIERS', keySrcField: 'BusinessPartner', extra: { BusinessPartnerFullName: 'X' } },
];

let NEXT_RESPONSE = [];
let DELETE_OBSERVED = false;
// When true, the next INSERT reaching the database throws, simulating an
// infrastructure failure occurring after the DELETE has been issued.
let FAIL_NEXT_INSERT = false;

const test = cds.test(PROJECT);

function stubS4() {
    const orig = cds.connect.to.bind(cds.connect);
    cds.connect.to = async function (name, ...rest) {
        if (name === 'odata_api') {
            return { send: async () => ({ d: { results: NEXT_RESPONSE } }) };
        }
        return orig(name, ...rest);
    };
}

function instrumentDb(db) {
    const origRun = db.run.bind(db);
    db.run = function (query, ...rest) {
        let isInsert = false;
        try {
            if (query?.DELETE ?? query?.cqn?.DELETE) DELETE_OBSERVED = true;
            isInsert = Boolean(query?.INSERT ?? query?.cqn?.INSERT);
        } catch { /* observation only */ }
        if (isInsert && FAIL_NEXT_INSERT) {
            FAIL_NEXT_INSERT = false;
            return Promise.reject(
                new Error('simulated infrastructure failure between DELETE and INSERT')
            );
        }
        return origRun(query, ...rest);
    };
}

async function rowsIn(dbEntity) {
    const db = await cds.connect.to('db');
    const r = await db.run(SELECT.one.from(dbEntity).columns('count(*) as cnt'));
    return r?.cnt ?? 0;
}

async function callSync(entityType) {
    try {
        const res = await test.POST('/odata/v4/master/syncFromS4HANA', { entityType });
        return { httpStatus: res.status, body: res.data };
    } catch (e) {
        return { httpStatus: e.response?.status ?? 'ERR', body: e.response?.data ?? String(e.message) };
    }
}

function srcRows(feed, n, { duplicateKey = false } = {}) {
    const rows = [];
    for (let i = 0; i < n; i++) {
        const key = duplicateKey && i === n - 1 ? 'K0' : `K${i}`;
        rows.push({ [feed.keySrcField]: key, ...feed.extra });
    }
    return rows;
}

function log(feed, scenario, before, after, res) {
    process.stdout.write(
        `      [${feed.entityType}/${scenario}] rows before=${before} after=${after} ` +
        `deleteRan=${DELETE_OBSERVED} http=${res.httpStatus} success=${res.body?.success}\n`
    );
}

describe('WP-01 — master sync transaction and empty-source guard', function () {
    this.timeout(120000);

    before(async () => {
        stubS4();
        instrumentDb(await cds.connect.to("db"));
    });

    for (const feed of FEEDS) {
        describe(feed.entityType, () => {

            it('HAPPY — valid source replaces the table', async () => {
                NEXT_RESPONSE = srcRows(feed, 4);
                DELETE_OBSERVED = false;
                const before = await rowsIn(feed.dbEntity);
                const res = await callSync(feed.entityType);
                const after = await rowsIn(feed.dbEntity);
                log(feed, 'HAPPY', before, after, res);
                assert.strictEqual(res.body?.success, true, 'sync should report success');
                assert.strictEqual(after, 4, 'table should hold exactly the 4 source rows');
                // Instrument sanity: a successful full replace MUST issue a DELETE.
                // If this fails, the DELETE observer is blind and every
                // "no DELETE reached the database" result below is worthless.
                assert.strictEqual(DELETE_OBSERVED, true, 'INSTRUMENT BLIND: no DELETE observed on the happy path');
            });

            it('MIDFAIL — INSERT fails after DELETE; table must be intact (EXIT-1)', async () => {
                const db = await cds.connect.to('db');
                await db.run(DELETE.from(feed.dbEntity));
                NEXT_RESPONSE = srcRows(feed, 5);
                await callSync(feed.entityType);
                const before = await rowsIn(feed.dbEntity);
                assert.strictEqual(before, 5, 'baseline should be 5 rows before the failing sync');

                NEXT_RESPONSE = srcRows(feed, 4);
                DELETE_OBSERVED = false;
                FAIL_NEXT_INSERT = true; // fail the INSERT that follows the DELETE
                const res = await callSync(feed.entityType);
                const after = await rowsIn(feed.dbEntity);
                log(feed, 'MIDFAIL', before, after, res);
                // The scenario is only meaningful if the DELETE actually reached
                // the database and the INSERT actually failed afterwards.
                assert.strictEqual(DELETE_OBSERVED, true,
                    'SCENARIO VACUOUS: no DELETE reached the database, so nothing was at risk');
                assert.strictEqual(FAIL_NEXT_INSERT, false,
                    'SCENARIO VACUOUS: the injected INSERT failure was never triggered');
                assert.strictEqual(
                    after, before,
                    `EXIT-1 VIOLATED: table went from ${before} to ${after} rows after a mid-sync failure`
                );
            });

            it('ZERO — zero-row source aborts before any DELETE (EXIT-2)', async () => {
                const before = await rowsIn(feed.dbEntity);
                assert.ok(before > 0, 'need a non-empty table to prove the guard');
                NEXT_RESPONSE = [];
                DELETE_OBSERVED = false;
                const res = await callSync(feed.entityType);
                const after = await rowsIn(feed.dbEntity);
                log(feed, 'ZERO', before, after, res);
                assert.strictEqual(DELETE_OBSERVED, false, 'EXIT-2 VIOLATED: a DELETE reached the database');
                assert.strictEqual(after, before, 'EXIT-2 VIOLATED: rows changed');
                assert.strictEqual(res.body?.success, false, 'sync should report failure');
            });
        });
    }
});

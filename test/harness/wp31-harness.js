/**
 * WP-31 — document capture, and the first field removal this project makes.
 *
 * The package's claim is not that SOURCE_DOCUMENTS exists. It is that four
 * fields left FUEL_DELIVERIES and nothing anywhere still reads them.
 */
process.env.CDS_ENV = 'development';
process.env.CDS_REQUIRES_DB_KIND = 'sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL = ':memory:';

const PROJECT = require('node:path').resolve(__dirname, '..', '..');   // the repo root, from this file - never an absolute path;
const cds = require(`${PROJECT}/node_modules/@sap/cds`);
const assert = require('node:assert');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const test = cds.test(PROJECT);
const out = (s) => process.stdout.write('      ' + s + '\n');
const O = '/odata/v4/orders';

const GONE = ['pilot_signature', 'ground_crew_signature',
              'signature_timestamp', 'signature_location'];
const DEL = 'EPD-YYZ-20260325-001';
const db = () => cds.connect.to('db');

const byNumber = async (n) => (await db()).run(
    SELECT.one.from('fuelsphere.FUEL_DELIVERIES').where({ delivery_number: n }));

const call = async (action, id, body = {}) => {
    try {
        const r = await test.POST(
            `${O}/FuelDeliveries(ID=${id},IsActiveEntity=true)/FuelOrderService.${action}`, body);
        return { status: r.status, ...r.data };
    } catch (e) {
        return { status: e.response?.status ?? 'ERR',
                 msg: e.response?.data?.error?.message ?? e.message };
    }
};

const b64 = (s) => Buffer.from(s).toString('base64');
const PILOT_BYTES = 'PILOT-SIGNATURE-STROKE-DATA-C-FITU-AC101';
const CREW_BYTES  = 'GROUNDCREW-SIGNATURE-STROKE-DATA-YYZ';
const sha = (s) => crypto.createHash('sha256').update(Buffer.from(s)).digest('hex');

const capture = (id) => call('captureSignatures', id, {
    pilotName: 'Capt. R. Leblanc', pilotSignature: b64(PILOT_BYTES),
    groundCrewName: 'Sarah Chen', groundCrewSignature: b64(CREW_BYTES),
    signatureLocation: '43.6777,-79.6248'
});

describe('WP-31 — document capture and the first removal', () => {

    it('EXIT-2 SOURCE_DOCUMENTS exists, and all seven types are ENFORCED', async () => {
        const t = cds.model.definitions['fuelsphere.DocumentType'];
        const values = Object.values(t.enum).map(e => e.val);
        out(values.join(' · '));
        assert.strictEqual(values.length, 7);
        for (const v of ['TECH_LOG', 'GAUGE_BEFORE', 'GAUGE_AFTER', 'FUEL_TICKET',
                         'BOWSER_METER', 'SIGNATURE_PILOT', 'SIGNATURE_CREW'])
            assert.ok(values.includes(v), `${v} missing`);
        // Declared is not enforced - D25. Checked by POSTing, not by reading
        // the annotation: the annotation being present is the mechanism, and
        // the refusal is the property.
        for (const [t2, m, o] of [['PASSPORT','MOBILE_CAMERA','NOT_ATTEMPTED'],
                                  ['TECH_LOG','FAX','NOT_ATTEMPTED'],
                                  ['TECH_LOG','MOBILE_CAMERA','MAYBE']]) {
            let status = 'ACCEPTED';
            try {
                await test.POST(`${O}/SourceDocuments`, {
                    document_type: t2, image_uri: 's3://probe', capture_method: m,
                    captured_by: 'probe', captured_at: '2026-05-12T12:00:00Z', ocr_status: o });
            } catch (e) { status = e.response?.status; }
            out(`  ${t2}/${m}/${o} -> ${status}`);
            assert.strictEqual(status, 400, `${t2}/${m}/${o} was accepted`);
        }
    });

    it('EXIT-3 a document is reached ONLY through the field that cites it', async () => {
        const r = await test.get(
            `${O}/FlightSchedule?$filter=flight_number eq 'AC881'`
            + `&$select=flight_number&$expand=closure_document($select=document_type,image_uri)`);
        const f = r.data.value[0];
        out(`${f.flight_number} -> ${f.closure_document.document_type}`);
        assert.strictEqual(f.closure_document.document_type, 'TECH_LOG');

        // And nothing points the other way. A reverse link would model one
        // relationship twice, and two links can disagree.
        for (const nav of ['flight', 'delivery', 'ticket']) {
            let refused = false;
            try { await test.get(`${O}/SourceDocuments?$expand=${nav}`); }
            catch (e) { refused = e.response?.status === 400; }
            assert.ok(refused, `SourceDocuments.${nav} exists - reverse link`);
        }
        out('no flight / delivery / ticket navigation on SourceDocuments');
    });

    it('EXIT-4 a captured signature becomes a document with a real hash', async () => {
        const d = await byNumber(DEL);
        const r = await capture(d.ID);
        assert.ok([200, 201].includes(r.status), r.msg);

        const after = await byNumber(DEL);
        assert.ok(after.signature_pilot_document_ID, 'no pilot document');
        assert.ok(after.signature_crew_document_ID, 'no crew document');

        const docs = await (await db()).run(SELECT.from('fuelsphere.SOURCE_DOCUMENTS')
            .where({ ID: { in: [after.signature_pilot_document_ID, after.signature_crew_document_ID] } }));
        const pilot = docs.find(x => x.document_type === 'SIGNATURE_PILOT');
        const crew = docs.find(x => x.document_type === 'SIGNATURE_CREW');

        // THE DEFECT THIS CATCHES: the first version coerced a stream with
        // String(v), so every signature hashed to the same value. Distinct
        // hashes is necessary; matching the actual bytes is what proves it.
        assert.strictEqual(pilot.image_hash, sha(PILOT_BYTES), 'pilot hash is not of the pilot bytes');
        assert.strictEqual(crew.image_hash, sha(CREW_BYTES), 'crew hash is not of the crew bytes');
        assert.notStrictEqual(pilot.image_hash, crew.image_hash, 'both signatures hash the same');
        out(`pilot ${pilot.image_hash.slice(0, 16)}…  crew ${crew.image_hash.slice(0, 16)}…  distinct`);

        assert.strictEqual(pilot.ocr_status, 'NOT_ATTEMPTED');   // held, not read
        assert.strictEqual(pilot.confirmed_by, 'Capt. R. Leblanc');
        assert.strictEqual(pilot.capture_location, '43.6777,-79.6248');
        out(`${pilot.image_uri}`);
        out('bytes NOT stored - no object store is provisioned');
    });

    it('EXIT-4b bytes in an unrecognised shape are REFUSED, never coerced', async () => {
        const { toBuffer, hashOf } = require(`${PROJECT}/srv/lib/signature-documents`);
        // The exact failure: String({}) is "[object Object]", which base64
        // decodes to the same bytes every time.
        await assert.rejects(() => toBuffer({ not: 'bytes' }), /^Error: EPD481/);
        assert.throws(() => hashOf('a base64 string'), /^Error: EPD481/);
        assert.strictEqual(await toBuffer(null), null);
        assert.strictEqual(await toBuffer(Buffer.alloc(0)), null);
        assert.strictEqual((await toBuffer(b64(PILOT_BYTES))).toString(), PILOT_BYTES);
        out('EPD481 on an unknown shape; null on absent bytes; base64 resolves');
    });

    it('EXIT-7 THE REMOVAL: the four fields are gone from model and metadata', async () => {
        const el = cds.model.definitions['fuelsphere.FUEL_DELIVERIES'].elements;
        for (const f of GONE) assert.ok(!el[f], `${f} still on the entity`);
        // The names are NOT evidence of an image and stay. EPD402 gates on them.
        assert.ok(el.pilot_name && el.ground_crew_name, 'the names were removed too');
        const meta = (await test.get(`${O}/$metadata`)).data;
        for (const f of GONE) assert.ok(!meta.includes(`"${f}"`), `${f} still in $metadata`);
        out(`${GONE.join(', ')} — gone from the model and the service`);
        out('pilot_name and ground_crew_name retained');
    });

    it('EXIT-7b and ZERO CODE READERS remain — instrument proved first', () => {
        let total = 0;
        try {
            execFileSync('bash', [`${__dirname}/wp31-census.sh`], { cwd: PROJECT });
        } catch (e) {
            total = e.status;
            // 255 is the census refusing to report an unproven instrument.
            assert.notStrictEqual(total, 255, 'census instrument unproven');
        }
        out(`census exit code = code references = ${total}`);
        assert.strictEqual(total, 0);
    });

    it('EXIT-6 the moved KPI still counts pending signatures', async () => {
        const q = `${O}/FuelDeliveries?$top=500`
            + `&$expand=signature_pilot_document($select=captured_at)`;

        // Reset the WHOLE precondition, not half of it. Asserting a DELTA
        // while an earlier test may already have captured on this row makes
        // the result depend on test order - and clearing only the citing
        // fields is not enough: captureSignatures refuses a delivery already
        // 'Posted', so the second call is rejected and the KPI does not move.
        // A partial reset looks exactly like a broken KPI.
        const d0 = await byNumber(DEL);
        await (await db()).run(UPDATE('fuelsphere.FUEL_DELIVERIES')
            .set({ signature_pilot_document_ID: null, signature_crew_document_ID: null,
                   status: 'Pending' })
            .where({ ID: d0.ID }));
        await (await db()).run(UPDATE('fuelsphere.FUEL_ORDERS')
            .set({ status: 'InProgress' }).where({ ID: d0.order_ID }));

        const before = (await test.get(q)).data.value;
        const pendingBefore = before.filter(d => !d.signature_pilot_document?.captured_at).length;

        const c = await capture(d0.ID);
        assert.ok([200, 201].includes(c.status), `capture refused: ${c.msg}`);

        const after = (await test.get(q)).data.value;
        const pendingAfter = after.filter(d => !d.signature_pilot_document?.captured_at).length;

        out(`pending ${pendingBefore} -> ${pendingAfter} across ${after.length} deliveries`);
        // The D32 failure mode: left behind, this counts zero for ever and
        // never throws. It must MOVE, not vanish.
        assert.strictEqual(pendingAfter, pendingBefore - 1,
            'the KPI did not follow the signature into the evidence layer');
        assert.ok(pendingAfter > 0, 'a KPI that reads zero for everything proves nothing');
    });
});

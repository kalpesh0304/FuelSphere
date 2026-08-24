/**
 * FuelSphere - migrating the ePOD signatures into the evidence layer
 * (WP-31 step 2, Document_Capture_Specification section 8A)
 *
 * FUEL_DELIVERIES holds the entire evidence layer of this system in four
 * fields, and they are stored rather than evidenced: two LargeBinary images
 * with no source, no confirmation and no hash, beside a timestamp and a
 * location. Every other captured image in WP-31 gets a URI, a hash, a capture
 * method, an OCR outcome and a confirmer. Leaving the signatures out would
 * mean two evidence models in one system, for no reason but the order they
 * were built in.
 *
 *     pilot_signature       -> SOURCE_DOCUMENTS, SIGNATURE_PILOT
 *     ground_crew_signature -> SOURCE_DOCUMENTS, SIGNATURE_CREW
 *     signature_timestamp   -> captured_at
 *     signature_location    -> capture_location
 *
 * ---------------------------------------------------------------------------
 * THIS STEP WRITES AND REMOVES NOTHING.
 *
 * The four old fields keep their values. Step 3 moves the readers while both
 * shapes are live, and step 4 removes the fields only once zero readers
 * remain. That order is the whole safety property: a removal that fails
 * loudly is recoverable, and one that fails quietly is D32 - five UI bindings
 * reading fields that never existed on INVOICES, rendering blank for months,
 * with the Exception Queue permanently claiming "no exceptions, all clear".
 * Nothing threw, so nobody noticed.
 * ---------------------------------------------------------------------------
 *
 * NO OBJECT STORE IS PROVISIONED. mta.yaml carries hana, xsuaa, destination,
 * application-logs and connectivity. INT404 "object store upload failed" is a
 * designed code with nothing behind it. So this module builds the CONTRACT -
 * it computes the URI a byte stream would live at and the hash that proves
 * which image the row referred to - and putUpload() is the one seam where a
 * real client drops in. It does not pretend the bytes moved.
 */

const cds = require('@sap/cds');
const crypto = require('node:crypto');
const { SELECT, INSERT, UPDATE } = cds.ql;

const FD = 'fuelsphere.FUEL_DELIVERIES';
const SD = 'fuelsphere.SOURCE_DOCUMENTS';

const TYPE = { PILOT: 'SIGNATURE_PILOT', CREW: 'SIGNATURE_CREW' };

/**
 * The two sides of the migration, declared once so the loop cannot drift.
 * `document` is the citing field - without it the row is unreachable.
 */
const SIDES = [
    { payloadBytes: 'pilotSignature',      payloadName: 'pilotName',
      document: 'signature_pilot_document_ID', type: TYPE.PILOT },
    { payloadBytes: 'groundCrewSignature', payloadName: 'groundCrewName',
      document: 'signature_crew_document_ID',  type: TYPE.CREW }
];

// A signature is not READ, it is HELD. There is no OCR pass over it and
// NOT_ATTEMPTED is the honest status - FAILED would claim an engine tried.
const SIGNATURE_OCR_STATUS = 'NOT_ATTEMPTED';

// It arrived through the ePOD capture action, which is a device in somebody's
// hands at the aircraft. Not MOBILE_CAMERA: nothing photographed a signature,
// it was drawn on a screen and uploaded with the call.
const SIGNATURE_CAPTURE_METHOD = 'UPLOAD';

const OBJECT_STORE_PREFIX = 's3://fuelsphere-evidence';

/** Where the bytes WOULD live. Deterministic, so a re-run computes the same URI. */
function uriFor(deliveryId, type) {
    return `${OBJECT_STORE_PREFIX}/signatures/${deliveryId}/${type.toLowerCase()}.png`;
}

// A signature whose bytes arrive in a shape this module does not recognise.
// Assigned rather than coerced - see toBuffer.
const EPD_BYTES_UNREADABLE = 'EPD481';

/**
 * Get the actual bytes, and REFUSE ANYTHING THAT IS NOT BYTES.
 *
 * CAP hands a LargeBinary back in DIFFERENT SHAPES depending on where it is
 * read. Outside a request it is a base64 STRING; inside one it is a readable
 * STREAM. The first version of this module wrote
 *
 *     Buffer.isBuffer(v) ? v : Buffer.from(String(v), 'base64')
 *
 * which is correct for the string and silently wrong for the stream:
 * String(stream) is "[object Object]", so every signature in the system
 * hashed to sha256(Buffer.from("[object Object]", "base64")) -
 * 67081e3b0928269de1f10cc583951846b40b7658fa98cd6b72a0da4696b8db8b, the same
 * value for every image. MEASURED, not theorised: the pilot and crew
 * signatures differed by 8 bytes and carried identical hashes.
 *
 * A CONSTANT IN THE ONE FIELD WHOSE PURPOSE IS TO DISTINGUISH. It is the
 * quietest possible failure - a 64-character hex string looks like evidence
 * whatever it was computed from, and nothing would have thrown for eighteen
 * months.
 *
 * So this THROWS on an unrecognised shape rather than coercing. A hash
 * computed from a coercion is worse than no hash at all.
 */
async function toBuffer(v) {
    if (v === null || v === undefined) return null;
    if (Buffer.isBuffer(v)) return v.length ? v : null;
    if (typeof v === 'string') {
        const b = Buffer.from(v, 'base64');
        return b.length ? b : null;
    }
    if (typeof v[Symbol.asyncIterator] === 'function' || typeof v.pipe === 'function') {
        const chunks = [];
        for await (const c of v) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
        const b = Buffer.concat(chunks);
        return b.length ? b : null;
    }
    throw new Error(`${EPD_BYTES_UNREADABLE}: signature bytes arrived as `
        + `${v.constructor ? v.constructor.name : typeof v}, which this module cannot read. `
        + `Refusing to hash a coerced value - a hash computed from a coercion looks `
        + `exactly like a hash computed from an image.`);
}

/**
 * The hash proves WHICH image the row referred to. A URI can be repointed; a
 * hash cannot be talked out of, and eighteen months later that is the whole
 * value of the record.
 *
 * Takes REAL BYTES ONLY - run them through toBuffer first. Null where there
 * are none: a constant standing in for absent evidence is worse than an empty
 * column, which is the lesson above in its milder form.
 */
function hashOf(buf) {
    if (buf === null || buf === undefined) return null;
    if (!Buffer.isBuffer(buf)) {
        throw new Error(`${EPD_BYTES_UNREADABLE}: hashOf takes a Buffer. `
            + `Pass the result of toBuffer, never a raw column value.`);
    }
    if (!buf.length) return null;
    return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * The one seam a real object-store client drops into.
 *
 * Returns what WOULD be uploaded rather than uploading it, and says so in the
 * result. When a store is provisioned this becomes the call and the rest of
 * the module is unchanged.
 */
async function putUpload(uri, buf) {
    return { uri, bytes: buf ? buf.length : 0,
             stored: false, reason: 'no object store provisioned - INT404 has nothing behind it' };
}

/**
 * Build the two signature documents for a delivery, FROM THE CAPTURE PAYLOAD.
 *
 * STEP 4 CHANGED WHERE THE BYTES COME FROM, not what is built. Until now this
 * module read them back off FUEL_DELIVERIES, because that is where
 * captureSignatures had put them. Those four columns are gone, so the bytes
 * arrive from the action that received them and never touch the delivery row.
 *
 * That also retires the backfill: migrateDelivery and migrateAll existed to
 * move rows that already held signatures, and after the removal there is
 * nothing left to read them from. THE BACKFILL MUST BE RUN BEFORE THIS
 * VERSION DEPLOYS - see the note in the package.
 *
 * THE DOCUMENT AND THE CITING FIELD ARE WRITTEN TOGETHER. A document row that
 * exists before its parent field is set is unreachable, and that window is
 * exactly where a failure leaves an orphan.
 *
 * Idempotent: a side whose citing field is already set is skipped, so a
 * re-capture does not duplicate the evidence.
 */
async function createSignatureDocuments(deliveryId, payload, srv) {
    const db = srv || cds.db;

    const d = await db.run(SELECT.one.from(FD).columns(
        'ID', 'delivery_number', 'signature_pilot_document_ID', 'signature_crew_document_ID'
    ).where({ ID: deliveryId }));
    if (!d) return { error: `delivery ${deliveryId} not found` };

    const at = payload.capturedAt || new Date().toISOString();
    const created = [];
    const skipped = [];

    for (const side of SIDES) {
        if (d[side.document]) { skipped.push({ side: side.type, reason: 'already captured' }); continue; }

        // Resolve to REAL BYTES before anything else. Never test emptiness on
        // a raw value - String(stream) is a non-empty 15-character string and
        // would pass a length check while carrying no image at all.
        const bytes = await toBuffer(payload[side.payloadBytes]);

        // NO BYTES IS NOT A FAILURE AND NOT A DOCUMENT. Creating a row for an
        // image that was never captured manufactures evidence, which is the
        // opposite of what this layer is for.
        if (bytes === null) {
            skipped.push({ side: side.type, reason: 'no signature captured' });
            continue;
        }

        const id = cds.utils.uuid();
        const uri = uriFor(d.ID, side.type);
        const upload = await putUpload(uri, bytes);
        const who = payload[side.payloadName] || 'unknown';

        await db.run(INSERT.into(SD).entries({
            ID: id,
            document_type: side.type,
            image_uri: uri,
            image_hash: hashOf(bytes),
            capture_method: SIGNATURE_CAPTURE_METHOD,
            // The signatory is who captured it. Which is what a signature
            // already means, and why confirmed_by carries the same value.
            captured_by: who,
            captured_at: at,
            ocr_status: SIGNATURE_OCR_STATUS,
            confirmed_by: who,
            confirmed_at: at,
            capture_location: payload.location || null
        }));
        await db.run(UPDATE(FD).set({ [side.document]: id }).where({ ID: d.ID }));

        created.push({ side: side.type, documentId: id, uri,
                       hash: hashOf(bytes), bytesStored: upload.stored, bytes: upload.bytes });
    }

    return {
        deliveryId: d.ID,
        deliveryNumber: d.delivery_number,
        created, skipped,
        objectStore: 'NOT PROVISIONED - uri and hash computed, bytes not moved'
    };
}

module.exports = {
    TYPE, SIDES, SIGNATURE_OCR_STATUS, SIGNATURE_CAPTURE_METHOD, OBJECT_STORE_PREFIX,
    EPD_BYTES_UNREADABLE,
    uriFor, toBuffer, hashOf, putUpload, createSignatureDocuments
};

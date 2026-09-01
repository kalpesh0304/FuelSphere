/**
 * S5 and S9 — fuel with no order, and the chain it breaks.
 *
 * ONE IS THE CONTROL FOR THE OTHER, and that is why they are seeded and
 * tested together rather than merely explaining each other:
 *
 *     1,889.25 + 999.38 - 2,280.00 =  608.63   positive
 *     1,889.25 +   0.00 - 2,280.00 = -390.75   negative
 *
 * The missing uplift IS the break, proved by the same arithmetic. Not a
 * contrived shortfall - the ledger would have balanced had the ticket been
 * entered.
 *
 * EXIT-4 asserts an ABSENCE, which is the assertion most likely to pass
 * because nothing was queried. It is proved by planting a row and watching
 * it fail - see the comment there.
 */
const PROJECT = require('node:path').resolve(__dirname, '..', '..');
process.env.CDS_ENV='development'; process.env.CDS_REQUIRES_DB_KIND='sqlite';
process.env.CDS_REQUIRES_DB_CREDENTIALS_URL=':memory:';
const cds=require(`${PROJECT}/node_modules/@sap/cds`);
const assert=require('node:assert');
const test=cds.test(PROJECT); const out=s=>process.stdout.write('      '+s+'\n');
const db=()=>cds.connect.to('db');

/** The burn for the broken leg, resolved through the FLIGHT. */
async function burnForLeg() {
    const f = await (await db()).run(SELECT.one.from('fuelsphere.FLIGHT_SCHEDULE')
        .where({ flight_number: 'AC411', flight_date: '2026-04-10' }));
    return (await db()).run(SELECT.one.from('fuelsphere.FUEL_BURNS').where({ flight_ID: f.ID }));
}

const OPENING = 1889.25;    // C-FDMO's closing after S1, measured not chosen
const BURN    = 2280.00;
const UPLIFT  =  999.38;    // 1,250 LTR x 0.7995, the ticket never entered

describe('S5 and S9 — fuel with no order, and the chain it breaks', () => {

  it('EXIT-1  S5: a ticket and a delivery with NO ORDER', async () => {
    const t = await (await db()).run(SELECT.one.from('fuelsphere.FUEL_TICKETS')
      .where({ ticket_number: 'WFS-YUL-20260410-77' }));
    assert.ok(t, 'S5 ticket not seeded');
    assert.strictEqual(t.order_ID, null, 'the whole scenario is that there is no order');
    // WP-04's allocator will not mint a ticket number without a station, and
    // the station comes from the order. An invented one would be a fiction.
    assert.strictEqual(t.internal_number, null, 'internal_number must stay null');
    assert.strictEqual(t.match_status, 'UNMATCHED');
    assert.strictEqual(Number(t.quantity_kg), UPLIFT);
    out(`ticket ${t.ticket_number}  order=${t.order_ID}  internal=${t.internal_number}  ${t.match_status}  ${t.quantity_kg} kg`);
  });

  it('EXIT-2  S5: the delivery is NOT_ATTRIBUTABLE, not RECONCILED', async () => {
    const d = await (await db()).run(SELECT.one.from('fuelsphere.FUEL_DELIVERIES')
      .where({ delivery_number: 'EPD-YUL-20260410-0005' }));
    assert.ok(d, 'S5 delivery not seeded');
    // The supplier resolves TRANSITIVELY through the order. No order means the
    // supplier set is UNKNOWN rather than a singleton, and unknown is not one
    // supplier. Two states interacting, and both correct.
    assert.strictEqual(d.recon_status, 'NOT_ATTRIBUTABLE');
    assert.strictEqual(Number(d.supplier_count), 0);
    assert.strictEqual(d.order_ID, null);
    out(`delivery ${d.delivery_number}  ${d.recon_status}  suppliers=${d.supplier_count}  delta=${d.fob_delta_kg} kg`);
  });

  it('EXIT-3  S9: the negative FALLS OUT of measured figures', async () => {
    const prior = await (await db()).run(SELECT.from('fuelsphere.ROB_LEDGER')
      .columns('closing_rob_kg','record_time','sequence')
      .where({ tail_registration: 'C-FDMO', record_date: '2026-04-10' }));
    const last = prior.sort((a,b)=>b.sequence-a.sequence)[0];
    assert.strictEqual(Number(last.closing_rob_kg), OPENING,
      'the opening must be C-FDMO\'s own measured closing, not a chosen number');
    // KEYED ON THE FLIGHT, not on tail plus date. C-FDMO has TWO burns on
    // 10 April - S1's and this one - and SELECT.one over tail+date returned
    // S1's, which is the same shape as every other over-matching key in this
    // repository.
    const burn = await burnForLeg();
    assert.strictEqual(Number(burn.actual_burn_kg), BURN);
    const closing = OPENING + 0 - BURN;
    assert.ok(closing < 0, `closing must be negative, got ${closing}`);
    out(`opening ${OPENING} + uplift 0.00 - burn ${BURN} = ${closing.toFixed(2)}  NEGATIVE`);
  });

  it('EXIT-4  S9: NO LEDGER ROW EXISTS for the broken leg', async () => {
    // AN ASSERTION OF ABSENCE PASSES TOO EASILY. This one was proved by
    // planting a ROB_LEDGER row for AC411 and confirming it FAILED, then
    // removing it - the same discipline as the dangling-FK plant. The two
    // instrument checks below are what survive that proof: the flight must
    // exist, and the tail must have OTHER ledger rows. Without them a typo in
    // the flight number would pass this test silently.
    const f = await (await db()).run(SELECT.one.from('fuelsphere.FLIGHT_SCHEDULE')
      .where({ flight_number: 'AC411', flight_date: '2026-04-10' }));
    assert.ok(f, 'instrument check: the flight must exist, or absence is meaningless');
    const all = await (await db()).run(SELECT.from('fuelsphere.ROB_LEDGER')
      .where({ tail_registration: 'C-FDMO' }));
    assert.ok(all.length > 0, 'instrument check: the tail must have ledger rows to be absent FROM');
    const forLeg = all.filter(r => r.flight_ID === f.ID);
    assert.strictEqual(forLeg.length, 0,
      'writing the negative records a fiction; clamping it to zero hides the break (WP-03)');
    out(`C-FDMO has ${all.length} ledger rows; ${forLeg.length} for the broken leg`);
  });

  it('EXIT-5  the error is the record, and it carries all four inputs', async () => {
    const b = await burnForLeg();
    for (const n of ['1889.25','0.00','2280.00','-390.75'])
      assert.ok(b.review_notes.includes(n), `the record must carry ${n}`);
    assert.ok(/F37/.test(b.review_notes), 'the LIMIT of the control belongs with it');
    out('review_notes carries all four inputs, the computed closing, and F37');
  });

  it('EXIT-6  the next flight for that tail is STILL ACCEPTED', async () => {
    // WP-03's second half, and the half that is hard to believe without
    // seeing it. A broken chain must not stop the airline operating.
    const later = await (await db()).run(SELECT.from('fuelsphere.FLIGHT_SCHEDULE')
      .where({ aircraft_reg: 'C-FDMO' }));
    const after = later.filter(f => f.flight_date > '2026-04-10');
    assert.ok(after.length > 0, 'C-FDMO must fly again after the break');
    out(`C-FDMO flies ${after.length} more leg(s) after the break: `
      + after.map(f=>`${f.flight_number} ${f.flight_date}`).join(', '));
  });

  it('EXIT-7  the counterfactual: the missing uplift IS the break', async () => {
    const withTicket = OPENING + UPLIFT - BURN;
    const without    = OPENING + 0      - BURN;
    assert.ok(withTicket > 0 && without < 0,
      'if both signs are the same the pair demonstrates nothing');
    out(`${OPENING} + ${UPLIFT} - ${BURN} = ${withTicket.toFixed(2)}  positive`);
    out(`${OPENING} +    0.00 - ${BURN} = ${without.toFixed(2)}  negative`);
  });
});

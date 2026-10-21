# S/4 backend change requests — fuel ticket posting

**For:** the ABAP / S/4 developer who owns `ZFS_FUEL_POSTING_SRV`
**From:** the FuelSphere (CAP) side
**Date:** 18 October 2026
**Status:** CAP side built and running in mock mode. Everything below is a change needed on the S/4 side before live posting can work as the business has specified it.

---

## 0. Where we are

`ZFS_FUEL_POSTING_SRV` / `FuelPostingSet` is implemented and tested in S2A: PO and GR post. FuelSphere calls it with one POST per fuel ticket and stores what comes back on the ticket.

The functional answers of October 2026 changed the target design in ways the current service cannot express. The requests below are ordered by how much they block us — **CR-1 to CR-3 are blocking**, the rest are new scope.

Each item says what the service does today, what is now required, and why, so you can judge the cleanest ABAP solution rather than implement a prescription.

---

## CR-1 — Stop after GR. The invoice is no longer part of this call. **(blocking)**

**Today:** one POST runs PO → GR → supplier invoice, with no parameter saying where to stop.

**Required:** at fuel ticket save, post **PO and GR only**. The supplier invoice is posted later, from the FuelSphere Invoicing app, against the supplier's own document (see CR-5).

**Why this is urgent rather than cosmetic:** right now the invoice step fails anyway, because company code 3000 has no tolerance key `PP`, so a ticket save happens to return PO + GR and nothing else. That is the correct behaviour by accident. **The moment `PP` is maintained in OMR6, every ticket save will also post a supplier invoice** — before anyone has seen the supplier's document. There is no flag on our side that can prevent it.

**Suggested shape** (your call):

- a request property `Steps` with values `POGR` (default for ticket posting) and `ALL`, or
- a boolean `SkipInvoice`, or
- a second entity set, e.g. `FuelUpliftPostingSet`, that only ever does PO + GR.

**Please also confirm:** the functional answer states that the GR creates an **FI document** as well, so a ticket posting produces three documents — PO, GR, FI. The service does not return the FI document number today. See CR-2.

---

## CR-2 — Return more of what was created, and distinguish which step failed **(blocking)**

**Today** the response carries: `Status`, `Message`, `Contract`, `PoNumber`, `PoItem`, `PoQuantity`, `PoUnit`, `GrNumber`, `GrYear`, `InvNumber`, `InvYear`, `InvAmount`, `Currency`.

### 2a. The FI document

The business requires the **FI document number and fiscal year** recorded against every uplift. The GR creates it; the service does not return it.

**Add:** `FiDocNumber`, `FiFiscalYear`, **and `FiPostingDate`**.

`FiPostingDate` (BUDAT) was added to this request on 19 October 2026 and is
now the item we most need from 2a. The reconciliation screen Finance asked for
has a column — *Posting to subsequent period* — defined as "posting period of
the FI document is &lt;&gt; the flight period". Without the posting date we
cannot place a document in a period at all, and that column reads zero for
every row.

**It is not the date we called you.** FuelSphere already records when it sent
the request. The two differ exactly when it matters: a 30 September uplift
posted on 2 October, or a backdated posting into a period that has since been
closed. That difference is the whole content of the column.

If BUDAT is not readily available on the response, the **fiscal period and
year** the document posted into (`FiPostingPeriod` + `FiFiscalYear`) would
serve just as well — the screen works in periods, not days.

### 2b. Company code

Required against every uplift, and FuelSphere derives it from its own carrier master. We would rather store **what S/4 actually posted to** than what we think it should be.

**Add:** `CompanyCode`.

### 2c. Status must say which step failed

**Today:** `S` complete, `P` partial, `E` error. That does not tell PO failure from GR failure, and the business has asked for exactly that distinction.

**Required statuses, or an equivalent you prefer:**

| value | meaning |
|---|---|
| `S` | PO and GR both posted |
| `POERR` | PO creation failed, nothing posted |
| `GRERR` | PO posted, GR failed |

If you would rather keep `Status` as is and add a separate `FailedStep` property, that works for us equally well — we only need the two cases distinguishable without parsing the message text.

### 2d. Error detail, structured

The business wants an error log in FuelSphere "similar to the SAP application log", reachable from a tile, showing the reason and how to resolve it. A single 220-character `Message` cannot carry that.

**Add a child entity or a returned table**, one row per BAPI message, with the standard fields:

`MsgType` (E/W/I/S), `MsgId`, `MsgNumber`, `MsgText`, `MsgV1`–`MsgV4`, and ideally the step it came from (PO / GR / FI).

We will store these and render them; we are not asking S/4 to keep the log.

---

## CR-3 — Repost after reversal must create new documents **(blocking, needs a decision)**

**Today:** the service is idempotent on `TicketNumber`. Posting the same ticket twice returns the documents already created, or resumes at the failed step. That is exactly right for a retry.

**The new requirement breaks that assumption.** The functional answer for ticket amendments is: reverse in S/4, then post a corrected document. FuelSphere must keep a history of *all* postings and reversals for a ticket.

So after a reversal, FuelSphere will call again **with the same `TicketNumber`** and must get **new** documents, not the reversed ones handed back.

**Question for you:** how should the service tell "retry the failed posting" from "post again, the previous one was reversed"?

Options we can see:

- a `PostingAttempt` / `Version` integer in the request, part of the log key in `ZFS_TKT_POST`;
- the service detects that the existing documents are reversed and starts a new attempt by itself;
- a separate `Repost` flag.

We have no preference — we need to know which, because it changes what FuelSphere sends.

**Related:** when a reversal is performed, we need the **reversal document numbers** back (reversal MM document, reversal FI document) so the ticket's posting history is complete. If reversal is done manually in S/4 rather than through OData, say so and we will capture the numbers by hand — but then please confirm the manual steps (MR8 / MBST / VF11 equivalents) so the process document matches.

---

## CR-4 — Separate chain for a third-party into-plane agent *(new scope)*

**Context.** FuelSphere now records three fuelling arrangements per station:

1. the fuel supplier performs the uplift — into-plane cost is bundled into the fuel price (no change needed);
2. a **third-party into-plane agent** performs it — the agent bills the handling service separately;
3. the airline fuels from its own tanks (CR-6).

For case 2 the functional answer is: a **separate PO, SES, GR and FI document**, against a **service contract**, billed to the into-plane agent. The fuel chain stays with the fuel supplier.

**What we need to know:**

- Does `FuelPostingSet` take this on with an extra set of properties (into-plane vendor, service contract, service contract line item), or is a **second entity set** cleaner — e.g. `IntoPlanePostingSet`?
- What does the request need from us? Our best guess: ticket number, into-plane agent vendor, service contract + line item, plant, quantity, service value, posting date.
- The response needs: service PO number + item, **SES number**, GR number + year, FI document number + year, plus the same status and message structure as CR-2.

**One point to settle before you build.** The functional answer says the service contract is "created per ticket". We read that as *a service PO per ticket against a standing service contract*, because a contract per ticket would mean thousands of contracts. **Please confirm which is meant** — it changes the request considerably.

---

## CR-5 — Supplier invoice through the standard MIRO service, per document *(new scope)*

**Today:** FuelSphere's invoice action calls `FuelPostingSet` once per ticket, which would create one S/4 supplier invoice per ticket. An 80-line FuelSphere invoice would create up to 80 S/4 documents.

**Required:** the invoice is posted from the FuelSphere Invoicing app, **one S/4 supplier invoice per supplier document**, covering one or more tickets, using the **standard S/4 OData service for MIRO**.

**What we need from you:**

1. **Which service, and is it activated in S2A?** We assume `API_SUPPLIERINVOICE_PROCESS_SRV`. Please confirm the exact service and path, and that the technical user of destination `S2A` is authorised for it.
2. **Can one invoice reference several POs / GRs?** Our invoices routinely span many tickets and therefore many purchase orders.
3. **`XBLNR` takes the supplier's own invoice number** (functional answer to Q8). Please confirm the field and that 16 characters is the limit we must truncate to.
4. **We need back:** MM invoice number, **invoice line item**, fiscal year, and the FI document number. All three were named as required.

If the standard service cannot reference multiple POs in one document, tell us early — that single fact decides whether the business gets one S/4 invoice per supplier document or is forced back to one per ticket.

---

## CR-6 — Goods issue for self-fuelled stations *(new scope)*

Where the airline fuels from its own storage, the functional answer is a **goods issue to consumption**, with the **source storage location** recorded on the uplift and the S/4 GI number stored against it.

**What we need:**

- A posting entry point — a new entity set, or an uplift-type parameter on the existing one.
- Request: ticket number, plant, **storage location**, material, quantity, UoM, posting date, and whatever cost assignment S/4 requires (cost centre or order — please tell us which, we do not currently send one).
- Response: **GI material document number and year**, plus status and messages as CR-2.

Please confirm the movement type you intend (we assume 201 or 261) so our process documentation matches what posts.

---

## CR-7 — Currency: who converts *(needs a decision)*

The uplift price comes from the CPE module and should match the contract currency. Where it does not, the business wants an error — except for the demo, where conversion via the SAP exchange rate table is acceptable to let integration testing proceed.

**Question:** should the conversion happen in ABAP (reading `TCURR`), or should FuelSphere convert before sending?

Our preference is **ABAP**, because the rate table lives there and we would otherwise be duplicating a rate source. If you agree, please tell us the **rate type** and which **date** to apply (posting date or ticket delivery date), and we will send the original currency and amount unchanged.

---

## CR-8 — Closed posting period *(small, needs confirmation)*

The functional answer: post to the **current open period with a warning** when the ticket's date falls in a closed period.

**Please confirm** the service does this itself and returns the warning in the message table (CR-2d), rather than failing. We would rather not have FuelSphere pre-check the period — that would be a second implementation of SAP's own calendar.

---

## CR-9 — Fields we send that need confirming

| field | today | note |
|---|---|---|
| `TaxCode` | optional, defaults to `V0` | FuelSphere will send it from a tax-code mapping table (carrier, station, tax code). Please confirm a sent value is honoured and overrides the default. |
| `StgeLoc` | optional, defaults to `0005` | Needed properly for CR-6. Confirm the default is still right for fuel receipts. |
| `Density` | optional | Required for a KG ticket against a litre contract. The business wants an **error** when it is missing, not a default. Please confirm the service raises one rather than assuming a density. |
| `Material` | from the order's product | Changing: FuelSphere will derive it from a new **Fuel Type** field on the tail master. The payload field does not change. |

---

## CR-10 — Batch / asynchronous posting *(informational, may need nothing)*

Posting will move to an **end-of-day background job** rather than running inside the user's save. That means bursts of calls rather than a steady trickle.

**Please tell us:**

- any limit on calls per minute or concurrent sessions we should respect;
- whether `$batch` is supported on this service, and whether you would prefer we use it;
- whether a single long-running call for many tickets would be preferable to many small ones.

No ABAP change may be needed here — we just do not want to discover a throughput limit in production.

---

## Summary

| # | Change | Blocking? |
|---|---|---|
| CR-1 | Stop after GR; invoice leaves this call | **Yes** |
| CR-2 | Return FI document, company code, per-step status, structured messages | **Yes** |
| CR-3 | Repost-after-reversal semantics; reversal document numbers | **Yes** |
| CR-4 | Into-plane agent: service PO + SES + GR + FI | New scope |
| CR-5 | Supplier invoice via standard MIRO OData, per document | New scope |
| CR-6 | Goods issue for self-fuelled stations | New scope |
| CR-7 | Currency conversion — ABAP or FuelSphere | Decision |
| CR-8 | Closed period → post to open period with warning | Confirm |
| CR-9 | Tax code, storage location, density, material | Confirm |
| CR-10 | Batch / throughput for the nightly job | Informational |

**The three blocking items are independent of each other** and can be delivered in any order. CR-1 is the most urgent, because the current behaviour becomes wrong the day OMR6 is maintained.

Questions on any of this: come back to the FuelSphere side rather than assuming — several of these were specified by the functional consultant and we would rather re-ask than guess.

# Supplier Credit Memo — Review and Service Contract

**Spec:** FS-SPEC-CM-001 v0.1 (27 Oct 2026) · **Built:** 27 Oct 2026 · **Scope:** BTP level, no S/4 call

| Artefact | Path |
|---|---|
| Schema | `db/credit-memo.cds` |
| Service | `srv/credit-memo-service.cds` → `/odata/v4/credit-memo` |
| Handlers | `srv/credit-memo-service.js` |
| Authorisation | `srv/authorization.cds` (CreditMemoService block) |
| Seed | `CREDIT_MEMO_REASONS`, `CREDIT_MEMOS`, `CREDIT_MEMO_LINES`, `NUMBER_RANGES`, two rows in `TOLERANCE_RULES` |
| Criteria | `test/harness/credit-memo-harness.js` (9), `test/harness/credit-memo-auth-harness.js` (3) |
| **Depends on** | **`origin/claude/defuel-redesign`** (Jagdeep Singh, unmerged), merged into this branch. Expected credits are its `DEFUEL` rows. **Merge that branch first** |

---

## 1. Review of the spec

The spec is sound and maps cleanly onto MIRO. Measured against this repository and the defuel branch it depends on, the points below need a decision or change what R1 can do.

### Where the spec's references live

| Spec term | Stored in | Vendor | Number shown |
|---|---|---|---|
| **Expected Credit** | **`DEFUEL`** with `defuel_type = TO_SUPPLIER`, after `postToSupplier` states `expected_credit_usd` and moves it to `POSTING_PENDING` (`db/defuel.cds`, defuel branch) | `DEFUEL.supplier` | `defuel_id` / `ticket_number` |
| **Defuel Ticket** | `DEFUEL.ticket_number` — the same row as the expected credit, so it is **not a separate reference type** | `DEFUEL.supplier` | `ticket_number` |
| **Fuel (uplift) Ticket** | `FUEL_TICKETS.ticket_number` | the ticket's **order** — `FUEL_ORDERS.supplier`. The ticket carries no vendor of its own | `ticket_number` |
| **Supplier Invoice line** | `INVOICE_ITEMS`, invoice `POSTED`/`PAID` | `INVOICES.supplier` | `invoice_number/line` |

**Vendor check (`CRD404`)** on every line: the vendor on the defuel, the uplift ticket's order or the invoice must be the credit memo's vendor. The message names both, e.g. *"vendor on uplift ticket WFS-YYZ-2026032401 is WFS001 World Fuel Services Canada; the credit memo is from PETAV01 Petron Aviation Philippines"*. A reference with no vendor at all (an uplift ticket with no order, a defuel with no supplier) is refused for the same code. **The invoice line is the strongest reference** — it is priced, posted and PO-linked — and is what the seeded demo memo uses.

**The credit memo never writes to `DEFUEL`.** How far a defuel has been credited is held in `DEFUEL_CREDIT_CLEARING`, one row per defuel, rewritten from posted credit memo lines. Its `shortfall_written_off` is **not** `DEFUEL.write_off_usd`: the defuel's write-off is the fuel's value less the *agreed* credit; the clearing's is the agreed credit less what the supplier *actually* credited.

**The S/4 entry the expected credit should trigger** is on hold with the integration, as on the defuel side — `DEFUEL.status` stays `POSTING_PENDING` and this service leaves it there.

### Gaps and assumptions

| # | Spec says | Repository | R1 does | Needs |
|---|---|---|---|---|
| 1 | Expected credit in the memo currency | `expected_credit_usd` — **USD only** | Memo must be USD to credit a defuel (`CRD405`) | Currency on `DEFUEL` if non-USD vendors credit defuels |
| 2 | Credit a defuel's expected credit | A `PARKED` defuel has no agreed credit | Refused, `CRD406` *"no expected credit has been agreed"* | — |
| 3 | Fuel Ticket proposes billed qty / price / amount | Ticket `total_amount` is **often null** | No amount → `CRD414`, never treated as zero | Prefer the invoice line |
| 4 | §6 cumulative credit > referenced value is an error; §7 tolerance clears the difference | Overlap when a supplier credits slightly **more** than expected | Overage within tolerance accepted on an expected credit, as negative variance; strict elsewhere | Confirm |
| 5 | "Calculate tax" | FuelSphere calculates no tax amount — SAP does from the tax code | Tax is **entered** | Re-add with S/4 |
| 6 | Posting date in **open period** | No period master at BTP | **Not checked** | S/4 or a period table |
| 7 | Qty in **L** | Invoice lines are in **KG** on the posted seed invoice; defuels store litres | Line UoM follows its reference | Confirm |
| 8 | Status `POSTING_ATTEMPTED`, `PAID` | No S/4 call, no clearing feed | In the enum; **no R1 path writes either** | S/4 integration |
| 9 | Reverse like **MR8M** | MR8M creates a reversal document | Reversal held **on the memo** | Whether a separate reversal document is wanted |
| 10 | Original invoice F4 on **posted** invoices | **1 of 104** seeded invoices is `POSTED` | Only `POSTED`/`PAID` referenceable | Demo data is thin, not the rule wrong |

### Open points from the spec

| # | Question | R1 answer |
|---|---|---|
| 1 | Credit memo without a reference | **Not in R1** — every line needs a reference (`CRD401`). Adding a `NONE` type later is additive |
| 2 | Withholding tax by country | **Not in R1.** S/4 determines it |
| 3 | Four-eyes on Post | **Configuration**: parameter `CM_POST_FOUR_EYES` in `TOLERANCE_RULES`, **seeded OFF** until decided. When ON, the creator cannot post (`CRD412`) |

### Two further assumptions, stated so they can be overruled

- **Duplicate check ignores `REVERSED` memos.** Re-entering a memo after reversing it is the normal correction path.
- **Tolerance** is `TOL-CM-DEFUEL`: 2% of the expected amount with a 25.00 floor, the greater applying. The figures are placeholders, resolved through the parameter store so a company code can override them.

---

## 2. Design

### Draft-enabled — the decision this section used to leave open (29 Oct 2026)

This section previously argued the service should stay non-draft, and closed by saying that enabling draft was "one annotation plus `.drafts` handlers" and **the main decision for the UI team**. The app is Fiori Elements V4, and `@odata.draft.enabled` is what puts Create and Edit on an FE list: without it the app can only read what a seeder wrote. The decision is taken — `CreditMemos` is draft-enabled.

**The two "drafts" are different things, and the screen says so:**

| | what it is | who sees it |
|---|---|---|
| the OData draft | an edit in progress, not saved | only the user editing |
| status `DRAFT` | saved and real, not yet parked or posted | everyone |

**What follows from it:**

- **`document_number` is issued on `SAVE`, not on create.** The number is keyed by the vendor and the document date, and at create neither is known — issuing one then would burn a number on every Create somebody cancels. It is therefore **not** `@mandatory`: CAP input validation runs before every handler, so a mandatory document number is a memo that can never be saved.
- **A re-save keeps the number it already has.** Only the first activation sets `DRAFT` and allocates.
- **Derivation happens twice.** On the draft, so the user sees a reference's PO, tail, cost object, quantity and amount the moment they pick it; and again on the stored rows after activation, because a draft can be patched by anything and a posting must not depend on the screen having been polite.
- **`EDIT` carries the same guard as `UPDATE`.** `CRD411` now refuses to *open* a `POSTED` memo for editing rather than refusing the save after the user has retyped it. `UI.UpdateHidden` and `UI.DeleteHidden` hide both buttons outside `DRAFT`/`PARKED`.
- **Saving is permissive; posting is not.** A memo with no lines saves (`DRAFT` is exactly for a half-entered document) and `CRD416` still blocks posting. The only thing refused at save is a memo with no vendor, because the number cannot be built without one.
- **A partial amount proposes no quantity.** Picking a reference and typing nothing credits the whole of it, quantity included. Typing a *part* of its value leaves the quantity blank for the user to state — the reference's full quantity beside part of its value is a claim nobody made, and two partial credits on one reference would breach `CRD403` while their amounts were still inside its value.

**What a line credits is now pickable.** Until this change none of the three reference types had a value help, so a screen that could not name a reference could not enter a memo. Each picker is bound to the **readable** number (`defuel_number`, `ref_ticket_number`, `ref_invoice_number` + `ref_line_number`) and carries the key out beside it, because a value list on a generated foreign key is discarded by the compiler and the user is shown a GUID. A number typed rather than picked arrives without the key and the service resolves it. One picker is visible at a time, by `reference_type`.

**Three enums became code lists** — `CREDIT_MEMO_TYPE_CODE`, `CREDIT_MEMO_REF_TYPE_CODE`, `CREDIT_PRICE_COMPONENT_CODE` — because an enum reaches OData as a plain string and Fiori gives a string a text box. The enums remain the contract the service validates against; the tables are the list the screen offers.

### Nothing is decremented

What is still creditable on a reference is **derived from posted lines each time it is asked**. Expected-credit status and amounts are a cache rewritten from posted lines on every post and reversal. Reversal is a status change followed by the same refresh, so there is no compensating write to forget.

### What is deliberately absent

- **No GL account.** S/4 account determination owns it (spec §8).
- **No fabricated S/4 number.** `s4_document_number` stays `null` until a real posting returns one. The FuelSphere number is `document_number`, `CM-{supplier}-{YYYYMMDD}-{NNNN}`, from the shared atomic allocator.

### Status

```
DRAFT ──park──► PARKED ──postMemo──► POSTED ──reverse──► REVERSED
  └──────────postMemo──────────────────┘   │
                                            └─(S/4 clearing, later)─► PAID
POSTING_ATTEMPTED ──reprocess──► POSTED      (S/4 failure path, later)
```

Edit and delete are allowed only in `DRAFT` and `PARKED` — enforced on `EDIT`, `UPDATE` and `DELETE`, and hidden on the screen by `UI.UpdateHidden` / `UI.DeleteHidden`.

### Expected credit clearing (spec §7)

On every post or reversal touching a defuel, with `open = expected_credit_usd − credited` from posted lines, `DEFUEL_CREDIT_CLEARING` is rewritten:

| Condition | `credit_status` | Booked to |
|---|---|---|
| nothing credited | `OPEN` | — |
| `|open| ≤ tolerance` | `CLEARED` | `variance_amount` — Defuel Credit Variance |
| a posted line has `final_clearing = true` | `WRITTEN_OFF` | `shortfall_written_off` + worklist `CRD420` |
| otherwise | `PARTIALLY_CLEARED` | worklist `CRD413` — **posting continues** |

---

## 3. Service contract — `/odata/v4/credit-memo`

OData V4. All writes need a CSRF token through the approuter; the UI5 V4 model fetches it.

### Entity sets

| Entity set | Purpose | Writable |
|---|---|---|
| `CreditMemos` | Header. Expand `lines`, `attachments`, `log`, `exceptions` | Create; update and delete while `DRAFT`/`PARKED` |
| `CreditMemoLines` | Lines. `open_amount` (virtual) is what is still creditable on the reference | Create, update, delete while the memo is editable |
| `Attachments` | Supplier PDF. Media stream on `content` | Yes |
| `Log` | Document log — every state change and message | Read only |
| `Exceptions` | Worklist. Action `resolve(note)` | Resolve only |
| `ExpectedCredits` | Defuels to a supplier with an agreed credit (`POSTING_PENDING`/`POSTED`), joined to their clearing. Shows `defuel_id`, `ticket_number`, vendor, `expected_amount`, `credit_status`, `open_amount` (filterable). **Owned by the defuel app** | Read only |
| `Reasons` | Reason codes, a code list | Read only |
| `Suppliers` · `Currencies` · `PostedInvoices` · `InvoiceLines` · `FuelTickets` · `Flights` | Value helps | Read only |

### `CreditMemos` fields

| Field | In | Notes |
|---|---|---|
| `ID` | out | UUID key |
| `document_number` | out | Allocated on create |
| `memo_type` | **in*** | `CREDIT_MEMO` (qty + value) · `SUBSEQUENT_CREDIT` (value only — forces `value_only` on lines) |
| `status` | out | See section 2 |
| `supplier_ID` | **in*** | Value help `Suppliers` |
| `supplier_cm_number` | **in*** | The supplier's own number |
| `original_invoice_ID` | in | Value help `PostedInvoices` |
| `document_date` · `posting_date` | **in*** | |
| `company_code` · `station_code` | in | `company_code` scopes tolerance and four-eyes |
| `currency_code` | **in*** | Value help `Currencies` |
| `stated_gross_amount` | **in*** | As printed |
| `tax_amount` | in | Entered |
| `lines_amount` · `balance` | out | `balance = stated − (lines + tax)`. Post requires 0 |
| `balanceCriticality` | out | 3 green when 0, 1 red otherwise — the balance light |
| `statusCriticality` | out | For the status column |
| `reason_code` | **in*** | Value help `Reasons` |
| `reason_text` | in | |
| `posted_at` · `posted_by` · `reversal_date` · `reversal_reason` · `reversed_at` · `reversed_by` | out | |
| `s4_document_number` · `s4_fiscal_year` | out | Null in R1 |

### `CreditMemoLines` fields

| Field | In | Notes |
|---|---|---|
| `memo_ID` | **in*** | When posting a line on its own |
| `reference_type` | **in*** | `EXPECTED_CREDIT` · `FUEL_TICKET` · `INVOICE_LINE` |
| `defuel_ID` / `ticket_ID` / `invoice_item_ID` | **in*** | The one matching `reference_type`: `EXPECTED_CREDIT` → `defuel_ID` (value help `ExpectedCredits`), `FUEL_TICKET` → `ticket_ID` (uplift ticket, value help `FuelTickets`), `INVOICE_LINE` → `invoice_item_ID` |
| `amount` | **in*** | Positive |
| `quantity` · `uom_code` | in | Ignored when `value_only`. UoM defaults from the reference |
| `value_only` | in | |
| `price_component` | in | `BASE` · `DIFFERENTIAL` · `INTO_PLANE` · `FEES` |
| `tax_code` | in | Defaults from the reference |
| `text` | in | |
| `final_clearing` | in | Expected credit only — "Close & write off" |
| `line_number` | out | Auto-assigned in steps of 10 |
| `reference_display` · `po_number` · `po_item` · `flight_ID` · `aircraft_reg` · `station_code` · `cost_center` | out | Derived from the reference on every save |
| `open_amount` | out | Virtual: reference value minus posted credits |

### Actions and functions

| Call | HTTP | Returns |
|---|---|---|
| Simulate | `GET  CreditMemos(<ID>)/CreditMemoService.simulate()` | `CheckResult` |
| Park | `POST CreditMemos(<ID>)/CreditMemoService.park` `{}` | `CheckResult` |
| Post | `POST CreditMemos(<ID>)/CreditMemoService.postMemo` `{}` | `CheckResult`; errors come back as an OData error with one detail per message |
| Reverse | `POST CreditMemos(<ID>)/CreditMemoService.reverse` `{"reason":"…","reversalDate":"2026-04-21"}` | `CheckResult` |
| Reprocess | `POST CreditMemos(<ID>)/CreditMemoService.reprocess` `{}` | `CheckResult` |
| Mass post | `POST massPost` `{"memos":["<ID>",…]}` | `[{ID, ok, status, message}]` — one failure stops none of the others |
| Propose lines | `GET proposeLines(referenceType='INVOICE',referenceId=<ID>,memoType='CREDIT_MEMO')` | Proposed lines with `amount` = `open_amount` |
| Resolve exception | `POST Exceptions(<ID>)/CreditMemoService.resolve` `{"note":"…"}` | The exception |

`CheckResult` = `{ status, balance, canPost, messages: [{ severity, code, message, line }] }`.

`proposeLines` takes `referenceType` of `INVOICE` (an invoice ID — proposes all its lines as `INVOICE_LINE`), `INVOICE_LINE`, `FUEL_TICKET` or `EXPECTED_CREDIT` (a defuel ID). It is how "Create Credit Memo" from another screen pre-fills: navigate with the reference type and ID, call `proposeLines`, let the user tick, then `POST` the memo with the ticked lines.

### Typical calls

```http
POST /odata/v4/credit-memo/CreditMemos
{ "memo_type": "CREDIT_MEMO", "supplier_ID": "…", "supplier_cm_number": "WFS-CN-2026-0042",
  "document_date": "2026-04-02", "posting_date": "2026-04-02", "currency_code": "USD",
  "stated_gross_amount": 19.04, "tax_amount": 2.04, "reason_code": "QTY_SHORT",
  "lines": [ { "reference_type": "INVOICE_LINE", "invoice_item_ID": "…", "quantity": 20, "amount": 17.00 } ] }

POST /odata/v4/credit-memo/Attachments            { "memo_ID": "…", "file_name": "cn.pdf", "mime_type": "application/pdf" }
PUT  /odata/v4/credit-memo/Attachments(<ID>)/content   <binary>

GET  /odata/v4/credit-memo/Exceptions?$filter=status eq 'OPEN'&$expand=memo
```

### Messages — `CRD4xx` business rule, `CRD5xx` technical

| Code | Severity | When |
|---|---|---|
| CRD401 | Error | Mandatory field or reference missing, or not found |
| CRD402 | Error | Cumulative credit exceeds the referenced value, net of earlier posted credits |
| CRD403 | Error | Cumulative quantity exceeds the referenced quantity (not value-only) |
| CRD404 | Error | Vendor on the defuel, uplift ticket (via its order) or invoice is not the credit memo's vendor — names both; or the reference records no vendor |
| CRD405 | Error | Currency mismatch |
| CRD406 | Error | Reference in an invalid status — invoice not posted; defuel not to a supplier, still `PARKED` (no agreed credit), or already cleared |
| CRD407 | Error | Duplicate: supplier + credit memo number + date + amount |
| CRD408 | Warning | Credit memo number reused with a different date or amount |
| CRD409 | Warning | Ticket not yet invoiced |
| CRD410 | Error | Balance is not zero |
| CRD411 | Error | Status does not allow the operation |
| CRD412 | Error | Four-eyes: the creator cannot post |
| CRD413 | Worklist | Expected credit short beyond tolerance; also INFO when cleared with a variance |
| CRD414 | Error | Reference carries no amount — never treated as zero |
| CRD416 | Error | Memo has no lines |
| CRD418 | Error | Reversal date before posting date |
| CRD419 | Error | Line amount not positive |
| CRD420 | Worklist | Expected credit closed and written off |
| CRD501 | Warning | Tolerance or four-eyes parameter not configured |

### Roles

| Scope | Can |
|---|---|
| `InvoiceVerify` | Create, edit, delete, park, simulate, propose |
| `FinancePost` | Simulate, park, post, reverse, reprocess, mass post; resolve exceptions |
| `InvoiceApprove` | Read; resolve exceptions |
| `ReportView` | Read |
| `AdminAccess` | Everything |

Test users: `alice` (all), `finance` (InvoiceVerify + FinancePost), `analyst` (read only).

---

## 4. Minimal UI — suggested

| Screen | Content |
|---|---|
| **List** | Filters: supplier, CM number, document number, status, document date. Columns: document number, supplier, CM number, date, gross, balance light, status. Mass action **Post** |
| **Object** | Header with balance light and status. Sections: Lines, Attachments, Log, Exceptions. Buttons: **Save**, **Park**, **Simulate**, **Post**, **Reverse** (dialog: reason, date) |
| **Add lines** | Dialog: reference type + value help → `proposeLines` → tick → add |
| **Worklist** | `Exceptions` with status `OPEN`, action **Resolve** |

No annotation file is shipped for this service. Annotations in this repository reach every app that binds to it through `$metadata`, so they are best written against the screens once the UI team has chosen freestyle or Fiori Elements.

---

## 5. Deferred to S/4 integration

- The posting call. It goes in `postCore()` at the marked line: success → `s4_document_number`; failure → `POSTING_ATTEMPTED` plus a log entry, and `reprocess` re-sends.
- PO-referenced lines credit the PO item; expected-credit lines clear the receivable the defuel raised. That receivable's own S/4 entry is on hold on the defuel side (`POSTING_PENDING`). Variance and shortfall post to Write-off (Defueling) — the defuel branch's `DEFUEL_GL_ACCOUNT` already carries `EXPECTED_CREDIT` and `WRITE_OFF_DEFUEL` roles, which is where the accounts should come from.
- Tax calculation, withholding tax, open-period check, `PAID` from clearing.
- D19 applies: the destination the code would use is not the one `mta.yaml` provisions.

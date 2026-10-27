# Supplier Credit Memo — Review and Service Contract

**Spec:** FS-SPEC-CM-001 v0.1 (27 Oct 2026) · **Built:** 27 Oct 2026 · **Scope:** BTP level, no S/4 call

| Artefact | Path |
|---|---|
| Schema | `db/credit-memo.cds` |
| Service | `srv/credit-memo-service.cds` → `/odata/v4/credit-memo` |
| Handlers | `srv/credit-memo-service.js` |
| Authorisation | `srv/authorization.cds` (CreditMemoService block) |
| Seed | `CREDIT_MEMO_REASONS`, `EXPECTED_CREDITS`, `CREDIT_MEMOS`, `CREDIT_MEMO_LINES`, `NUMBER_RANGES`, two rows in `TOLERANCE_RULES` |
| Criteria | `test/harness/credit-memo-harness.js` (7), `test/harness/credit-memo-auth-harness.js` (3) |

---

## 1. Review of the spec

The spec is sound and maps cleanly onto MIRO. Measured against this repository, eleven points need a decision or change what R1 can do. **Points 1 to 4 are gaps in the repository, not in the spec.**

| # | Spec says | What the repository has | What R1 does | Needs |
|---|---|---|---|---|
| 1 | Reference an **Expected Credit**, clear it (§4, §7) | **No such entity exists.** Nothing models a receivable from a supplier | `EXPECTED_CREDITS` added. Clearing state is derived from posted lines | Who **raises** an expected credit. R1: entered through the service or seeded. Automatic creation from a defuel needs point 2 |
| 2 | Reference a **Defuel Ticket** (§4) | Nothing on `FUEL_TICKETS` marks a defuel — `00-DECISIONS` **F26** | `DEFUEL_TICKET` **not offered**. A defuel is credited through its expected credit | F26 resolved: an event type on the ticket |
| 3 | Data model `FuelEvent(UPLIFT/DEFUEL)` (§12) | No such entity. `FUEL_TICKETS` is the equivalent | Lines reference `FUEL_TICKETS` | — |
| 4 | Fuel Ticket proposes billed qty / price / amount | A ticket has **no supplier** (it comes through its order) and `total_amount` is **often null** | Ticket with no order → `CRD404`; ticket with no amount → `CRD414`. Never treated as zero | Crediting through the **invoice line** is the reliable path. Consider dropping ticket references until tickets carry amounts |
| 5 | §6 cumulative credit > referenced value is an error; §7 tolerance clears the difference | The two overlap when a supplier credits **slightly more** than expected | On an expected credit, overage **within tolerance** is accepted and lands as negative variance; beyond it, `CRD402`. Invoice and ticket references are strict | Confirm |
| 6 | "Calculate tax" | FuelSphere calculates no tax amount — SAP does from the tax code (`02-BEHAVIOUR` §8) | Tax is **entered**. No calculate option | Re-add with S/4 |
| 7 | Posting date in **open period** | No posting-period master at BTP | **Not checked** | S/4 or a period table |
| 8 | Qty in **L** | Invoice lines are in **KG** on the seeded posted invoice | Line UoM follows its reference | Confirm the unit is the reference's, not always litres |
| 9 | Status `POSTING_ATTEMPTED`, `PAID` | No S/4 call, no clearing feed | In the enum; **no R1 path writes either**. `reprocess` exists and accepts only `POSTING_ATTEMPTED` | S/4 integration |
| 10 | Reverse like **MR8M** | MR8M creates a reversal document | Reversal is held **on the memo** (date, reason, user) and status `REVERSED` | Whether a separate reversal document is wanted at BTP level |
| 11 | Original invoice F4 on **posted** invoices | **1 of 104** seeded invoices is `POSTED` (77 `VERIFIED`) | Only `POSTED`/`PAID` are referenceable (`CRD406`) | Demo data is thin, not the rule wrong |

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

### Why the service is non-draft

A credit memo already has working states — `DRAFT` and `PARKED` — with rules. An OData draft on top would be a second "not yet real" state with different rules, and every handler would need a `.drafts` twin. The service edits active entities directly while the memo is `DRAFT` or `PARKED`, and refuses with `CRD411` after that.

**Consequence for the UI.** A freestyle UI5 app on the OData V4 model works directly. If the app is built with **Fiori Elements V4** and needs its standard create/edit flow, check that the UI5 version you target supports non-draft editing well enough. If not, enabling draft is one annotation plus `.drafts` handlers. **This is the main decision for the UI team.**

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

Edit and delete are allowed only in `DRAFT` and `PARKED`.

### Expected credit clearing (spec §7)

On every post or reversal touching an expected credit, with `open = expected − credited` from posted lines:

| Condition | Status | Booked to |
|---|---|---|
| nothing credited | `OPEN` | — |
| `|open| ≤ tolerance` | `CLEARED` | `variance_amount` — Defuel Credit Variance |
| a posted line has `final_clearing = true` | `WRITTEN_OFF` | `written_off_amount` + worklist `CRD420` |
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
| `ExpectedCredits` | Receivables awaiting a credit. `open_amount` is calculated and filterable | Create, update |
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
| `expected_credit_ID` / `ticket_ID` / `invoice_item_ID` | **in*** | The one matching `reference_type` |
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

`proposeLines` takes `referenceType` of `INVOICE` (an invoice ID — proposes all its lines as `INVOICE_LINE`), `INVOICE_LINE`, `FUEL_TICKET` or `EXPECTED_CREDIT`. It is how "Create Credit Memo" from another screen pre-fills: navigate with the reference type and ID, call `proposeLines`, let the user tick, then `POST` the memo with the ticked lines.

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
| CRD404 | Error | Supplier mismatch, or no supplier attributable (ticket without an order) |
| CRD405 | Error | Currency mismatch |
| CRD406 | Error | Reference in an invalid status |
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
| `InvoiceVerify` | Create, edit, delete, park, simulate, propose; maintain expected credits |
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
- PO-referenced lines credit the PO item; expected-credit lines clear the receivable; variance and write-off post to the Write-off (Defueling) account by S/4 account determination.
- Tax calculation, withholding tax, open-period check, `PAID` from clearing.
- D19 applies: the destination the code would use is not the one `mta.yaml` provisions.

# IDR — header and line item schema

**FuelSphere · the incoming document that becomes one MIRO posting**
26 August 2026

---

## 0. What the IDR is, and why it is the object

**An IDR is the post-OCR document.** On arrival it carries an incoming document reference and nothing else that identifies it uniquely.

```
IDR arrives          header + lines, one reference
       ↓
validation           N configurable rules, each with a status ON THIS IDR
       ↓
three-way match      PO · GR · invoice
       ↓
ONE MIRO POSTING     when both gates are satisfied
```

**One IDR, one posting.** That is the constraint the whole model hangs from.

### Why the IDR number and not the supplier's

**A supplier invoice number is not unique across suppliers**, and two suppliers legitimately issue `INV-001`. It is also **not unique in time** — a supplier may reuse a series annually.

**So the supplier's number is a FIELD, and the IDR number is the identity.** That inversion is the correction to what exists today.

> And it matters for a second reason: **a document can arrive before anyone knows which supplier sent it.** OCR may read the number and not the vendor. The IDR must exist before it can be attributed.

---

## 1. `IDR_HEADER` — what MIRO needs, and what FuelSphere adds

### Identity

| | | |
|---|---|---|
| `idr_number` | `String(20)` | **The key.** Internally generated, unique, immutable |
| `idr_status` | `IdrStatus` | See §3 |
| `document_type` | `DocumentType` | `ZFUEL_ITP` · `BLK` · `FEE` · `TAX` · `CM` · `PPD` |
| `supplier_invoice_number` | `String(35)` | **As received.** Not unique, not a key |
| `supplier` | Association | **Nullable** — may be unresolved on arrival |
| `supplier_name_as_received` | `String(100)` | What OCR read, before resolution |

**`supplier` nullable beside `supplier_name_as_received` is the WP-07B pattern:** the value as received and the value as resolved are different facts, and **the case that matters is when they disagree.**

### The MIRO posting fields

**These map to what SAP needs and nothing else belongs here.**

| | SAP | |
|---|---|---|
| `invoice_date` | `BLDAT` | The supplier's document date |
| `posting_date` | `BUDAT` | **Set at posting, not at arrival** |
| `reference` | `XBLNR` | The supplier's number, carried through |
| `company_code` | `BUKRS` | **See F40** |
| `document_type_sap` | `BLART` | `RE` for an invoice, `RC` for a credit |
| `currency` | `WAERS` | |
| `gross_amount` | | |
| `net_amount` | | |
| `tax_amount` | | |
| `tax_code` | `MWSKZ` | Header-level, where it applies |
| `payment_terms` | `ZTERM` | |
| `baseline_date` | `ZFBDT` | Payment due calculation |
| `header_text` | `BKTXT` | |
| `unplanned_delivery_cost` | | Where the supplier bills one |

### The posting result

| | |
|---|---|
| `miro_document_number` | `String(10)` — populated on success |
| `miro_fiscal_year` | `String(4)` |
| `posted_at` · `posted_by` | |
| `posting_error_code` · `posting_error_text` | **On failure. The attempt is a record** |

> **Nothing posts to S/4 today** — D19's environment half is open, so these are structurally present and empty. **That is a known gap, not a design one.**

### Arrival and provenance

| | |
|---|---|
| `source_channel` | `EDI` · `XML` · `PORTAL` · `EMAIL` · `MANUAL` |
| `received_at` · `received_by` | |
| `source_document` | Association to `SOURCE_DOCUMENTS` — **WP-31's** |
| `ocr_confidence` | `Decimal(5,2)`, header-level |
| `ocr_status` | `READ` · `PARTIAL` · `FAILED` · `NOT_ATTEMPTED` |
| `confirmed_by` · `confirmed_at` | **The confirmed value is what is used, never the raw read** |

### The two gates

**Posting requires both. They are separate conditions and must be separately visible.**

| | |
|---|---|
| `validation_status` | `NOT_RUN` · `PASSED` · `BLOCKED` · `ACCEPTED_WITH_BYPASS` |
| `validation_run_at` | |
| `rules_evaluated` · `rules_passed` · `rules_failed` · `rules_bypassed` · `rules_not_applicable` | **Five counts, and they must sum** |
| `match_status` | `NOT_MATCHED` · `MATCHED` · `PARTIAL` · `AMBIGUOUS` |
| `match_run_at` | |
| `is_postable` | Derived: `validation ≠ BLOCKED` **AND** `match = MATCHED` |

**`ACCEPTED_WITH_BYPASS` is not `PASSED`.** A bypassed soft error permits posting and **the record must say a person released it**, not that nothing was wrong.

### Fuel context, and the carrier

| | |
|---|---|
| `station_code` | Where the fuel was uplifted |
| `contract` | Association — **resolves the pricing** |
| `carrier_code` | **F40.** Every determination below resolves by company code |
| `tenant_id` | |

> **F40 lands here.** `company_code` drives the posting, the tax registration, the DOA limit and the role assignment — **and a group operating two carrier codes has two sets of books.** The IDR must know which.

---

## 2. `IDR_LINE_ITEM`

### Identity and sequence

| | |
|---|---|
| `idr` | Association to `IDR_HEADER` |
| `line_number` | `Integer` — as printed on the document |
| `line_type` | `FUEL` · `FEE` · `TAX` · `ADJUSTMENT` · `CREDIT` |

**`line_type` matters for tolerance:** the HLD sets **fee tolerance at 0%** — fees are fixed and any difference is investigated. **A fuel line and a fee line cannot share a threshold.**

### The fuel ticket — as received and as resolved

| | |
|---|---|
| **`ticket_number_as_received`** | `String(50)` — **what the supplier printed** |
| **`ticket`** | Association to `FUEL_TICKETS` — **nullable** |
| `ticket_match_pass` | Which of the cascade's passes resolved it |
| `ticket_match_confidence` | `Decimal(5,2)` |

**Two fields, deliberately.** A ticket number that resolves to nothing is a real state — it is what an into-plane statement looks like before matching, and `INV450` fires on it today across four invoices.

> **This is the leg nothing else in the landscape can supply.** From here the line reaches the delivery, the flight and the tail — and the density that converted the mass.

### The SAP references

| | SAP | |
|---|---|---|
| `po_number` | `EBELN` | **What MIRO matches on** |
| `po_item` | `EBELP` | |
| `gr_document` | `MBLNR` | Goods receipt |
| `gr_year` · `gr_item` | | |
| `material` | `MATNR` | Fuel grade |
| `plant` | `WERKS` | |

### Commercial

| | |
|---|---|
| `invoiced_quantity` · `uom_code` | **As billed.** Usually litres |
| `unit_price` · `price_unit` | Per litre, per 100 litres |
| `line_net_amount` · `line_tax_amount` · `line_gross_amount` | |
| `tax_code` | `MWSKZ` — line-level where it differs |
| `currency` | Where a line differs from the header |

### The conversion, and it must be persisted

| | |
|---|---|
| `density_value` · `density_basis` | `MEA` · `KGL` · standard |
| `temperature` | `Decimal(5,2)` °C |
| `quantity_kg` | Derived, **and stored** |

**A mass nobody can reproduce is a mass nobody can defend.** The density that converted it belongs on the same row.

### The comparison — what FIM adds over AP

| | |
|---|---|
| `expected_quantity` | From the goods receipt |
| `expected_unit_price` | **From `DERIVED_PRICES`, not from the PO** |
| `derived_price` | Association — carries `component_breakdown` |
| `quantity_variance` · `quantity_variance_pct` | |
| `price_variance` · `price_variance_pct` | |
| `value_variance` | |
| `variance_category` | The HLD's eight, of which **five are configurable here** |

> **`expected_unit_price` from the derived price rather than the PO is the whole distinction.** `INV452` compares against `order.unit_price` today — **the AP question.** A line can agree perfectly with a PO whose price was itself wrong.

### Line-level state

| | |
|---|---|
| `line_status` | `OPEN` · `MATCHED` · `BLOCKED` · `ACCEPTED` · `POSTED` |
| `exception_count` | |
| `highest_severity` | **The count means nothing without it** |

---

## 3. `IdrStatus` — the twelve

```
RECEIVED        arrived, nothing done
EXTRACTED       OCR complete, unconfirmed
CONFIRMED       a person accepted the read
INDEXED         header and lines complete
VALIDATED       rules run, no blockers
MATCHED         three-way complete
APPROVED        DOA satisfied
POSTED          MIRO document exists          ← terminal
```

**Four terminal states:**

```
POSTED          success
REJECTED        returned to supplier          ← terminal
CANCELLED       withdrawn before posting      ← terminal
DUPLICATE       already processed             ← terminal
```

---

## 4. `IDR_RULE_STATUS` — the correction to today's build

**One row per IDR per applicable rule.** This is what I got wrong.

```cds
entity IDR_RULE_STATUS {
  key ID              : UUID;
      idr             : Association to IDR_HEADER;
      rule            : Association to INVOICE_CHECK_REGISTRY;
      line_number     : Integer;          // null for a header rule
      status          : RuleStatus;
      severity        : Severity;
      severity_source : SeveritySource;   // TOLERANCE_LADDER | REGISTRY_DEFAULT
      expected_value  : String(50);
      actual_value    : String(50);
      variance        : Decimal(15,4);
      message         : String(500);
      evaluated_at    : Timestamp;
      bypassed_by     : String(50);
      bypassed_at     : Timestamp;
      bypass_reason   : String(500);      // MANDATORY on bypass
}
```

| `RuleStatus` | |
|---|---|
| `PASSED` | Ran and cleared |
| `FAILED` | Raised, open |
| `BYPASSED` | Raised, released by a person **with a reason** |
| `NOT_APPLICABLE` | **Did not apply to this document** |

### Why a join could not do this

**I told CC to join the registry to the exceptions and show `PASSED` by absence.** That is a rendering trick and it fails three ways:

```
it cannot distinguish PASSED from NOT_APPLICABLE
it cannot say WHEN a rule passed
and it cannot survive the registry changing
```

**A rule added tomorrow would appear as PASSED on every historical document**, because absence is not evidence.

---

## 5. What this changes about what exists

| | |
|---|---|
| `INVOICES` | Becomes `IDR_HEADER`, or gains the IDR fields. **`INVOICE_EXCEPTIONS`'s 25 rows survive as `FAILED` statuses** |
| `INVOICE_ITEMS` | Gains `ticket_number_as_received`, `expected_unit_price` from the derived price, and the variance fields |
| `INVOICE_EXCEPTIONS` | **Becomes the failure detail of `IDR_RULE_STATUS`**, or is absorbed into it |
| `INVOICE_MATCHES` | **Retiring it may have been wrong.** If the match outcome gates posting, it needs a home |

> **The last one is a reversal.** I told CC to retire it because nothing wrote it. **If posting is gated on the match, something must.**

---

## 6. Three things to decide

**Is `INVOICES` renamed, or does `IDR_HEADER` sit above it?** A rename is cleaner and touches every reader. **A new entity beside it is two objects for one document** — which is the thing we refused yesterday.

**Does `INVOICE_EXCEPTIONS` survive?** Its 25 rows are computed and harness-verified. **Absorbing them into `IDR_RULE_STATUS` as `FAILED` preserves the work; a parallel table repeats it.**

**And what populates `NOT_APPLICABLE`?** A rule that does not apply must be *known* not to apply — which means the run writes a row per applicable rule and records why the others were skipped. **`checksSkipped = 0` on every run today**, so nothing currently produces this state.

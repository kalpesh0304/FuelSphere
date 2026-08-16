# DATA_PROFILE.md — What Actually Appears in the Data

> **Extract source:** the only data available is the **seed CSV set** in `db/data/` (79 files, semicolon-delimited). There is **no production extract**. These are hand-authored demo/seed rows (≤ 26 rows per table), so *growth rate is not obtainable* and distributions reflect demo intent, not production reality. Where a distribution is still diagnostic (undocumented status values, unused enum members), it is reported. **Production-looking identifiers are anonymised** (VENDOR_A…, TAIL_01…) with structure preserved.

## 1. Row counts (all 79 seed files)

| Table | Rows | Table | Rows | Table | Rows |
|---|---|---|---|---|---|
| MASTER_AIRPORTS | 23 | ROUTE_MASTER | 26 | ROUTE_AIRCRAFT_MATRIX | 17 |
| CONFIG_PERSONA_TILES | 16 | AIRCRAFT_MASTER | 13 | FLIGHT_SCHEDULE | 12 |
| CONTRACT_LOCATIONS | 12 | CURRENCY_MASTER | 12 | T005_COUNTRY | 12 |
| FORMULA_COMPONENTS | 11 | PRICING_FORMULA_ELEMENT | 11 | MASTER_CONTRACTS | 10 |
| MASTER_SUPPLIERS | 10 | SECURITY_USERS | 10 | T001W_PLANT | 10 |
| KPI_VALUES | 9 | ROB_LEDGER | 9 | CONTRACT_PRODUCTS | 8 |
| FUEL_SALES_ORDERS | 8 | KPI_DEFINITIONS | 8 | SYSTEM_HEALTH_LOGS | 8 |
| DATA_QUALITY_METRICS | 8 | INTEGRATION_CONFIGS | 8 | FUEL_ORDERS | 7 |
| FLIGHT_DISPATCH | 7 | API_PERFORMANCE_METRICS | 7 | INDEX_VALUE | 6 |
| DEMAND_CALCULATION | 6 | INTEGRATION_MESSAGES | 6 | MARKET_INDEX_VALUES | 6 |
| PLANNING_LINE | 6 | REPORT_DEFINITIONS | 6 | REPORT_EXECUTIONS | 6 |
| SANCTIONED_ENTITIES | 6 | VARIANCE_RECORDS | 6 | ANALYTICS_SNAPSHOTS | 6 |
| Airports(alt) | 6 | (many at 2–5) | … | **ERROR_LOGS** | **0** |
| **EXCEPTION_ITEMS** | **0** | FUEL_DELIVERIES | 3 | FUEL_TICKETS | 2 |
| INVOICES | 3 | INVOICE_ITEMS | 3 | INVOICE_MATCHES | 2 |
| FUEL_BURNS | 4 | | | | |

(Full list in `db/data/`; every transactional table is at demo scale.)

## 2. Status distributions — including values that never occur, and undocumented values

| Table.field | Observed distribution | Enum members NEVER seen | ⚠ Value NOT in documented enum |
|---|---|---|---|
| `FUEL_ORDERS.status` | Draft 1, Confirmed 3, InProgress 1, Delivered 1, **Completed 1** | Submitted, Cancelled | **`Completed` is in the enum but code never writes it (§FUNCTIONAL); data uses `Draft` while runtime writes `Created`** — conflict |
| `INVOICES.status` | DRAFT 1, **SUBMITTED 1**, POSTED 1 | VERIFIED, PAID, CANCELLED | **`SUBMITTED` is NOT in `InvoiceStatus` enum** (DRAFT/VERIFIED/POSTED/PAID/CANCELLED) |
| `FUEL_SALES_ORDERS.status` | RECEIVED 2, CONFIRMED 2, SCHEDULED 1, DELIVERED 1, INVOICED 1, CLOSED 1 | **IN_DELIVERY, CANCELLED** (never assigned by code either) | — |
| `crew_review_status` (orders) | CONFIRMED 4, ADJUSTED 1, NULL 2 | PENDING, SKIPPED | — |
| `FLIGHT_SCHEDULE.status` | SCHEDULED 9, ARRIVED 2, DEPARTED 1 | (field is free `String(20)`, comment lists SCHEDULED/DEPARTED/ARRIVED/CANCELLED/DIVERTED/DELAYED/RETURNED — **not an enforced enum**) | none — but no enum enforcement |
| `FUEL_BURNS.variance_status` | NORMAL 4 | WARNING, EXCEPTION, CRITICAL | — |
| `ROB_LEDGER.entry_type` | INITIAL 2, UPLIFT 3, FLIGHT 4 | **ADJUSTMENT, TRANSFER** | — |
| `FUEL_DELIVERIES.status` | Posted 2, Pending 1 | Verified, Disputed | — |
| `COMPLIANCE_CHECKS.result` | PASS 3, BLOCK 1, REVIEW 1 | — | — |
| `SECURITY_USERS.employment_status` | ACTIVE 9, TERMINATED 1 | — | `TERMINATED` — no matching enum (`UserStatus`=ACTIVE/INACTIVE/LOCKED/PENDING) |
| `PLANNING_VERSION.status` | DRAFT 3, APPROVED 1 | IN_REVIEW, LOCKED | — |
| `PLANNING_VERSION.sac_writeback_status` | PENDING 3, SUCCESS 1 | FAILED | — |
| `INVOICE_MATCHES.match_status` | MATCHED 1, PARTIAL 1, NULL 1 | UNMATCHED, PRICE_VARIANCE, QTY_VARIANCE, EXCEPTION | — |

## 3. Nullable FK / percent-null (key transactional tables)

Seed data is **complete** on required FKs, so the null-FK exposure is a *code* risk (unvalidated inserts), not visible in seed:

| Table.field | % null | Note |
|---|---|---|
| `FUEL_ORDERS.{flight,supplier,contract,product,airport}_ID` | 0% | All seeded; but code does not validate these (SCHEMA §7) |
| `FUEL_ORDERS.s4_po_number` / `s4_po_item` | 71% | Only 2/7 posted (expected — set at ePOD) |
| `FUEL_ORDERS.cancelled_*` | 100% | No cancelled orders in seed |
| `FUEL_TICKETS.order_ID` | 0% (2/2) | `@mandatory` upheld — **no ticket without an order** |
| `FUEL_DELIVERIES.order_ID` | 0% | `@mandatory` upheld |
| `FUEL_SALES_ORDERS.purchase_order_ID` | 25% (2/8) | Sales orders can exist without a linked airline PO |
| `INVOICE_MATCHES.match_status`, `INVOICE_APPROVALS.approval_status` | ~33% NULL | Partial match/approval data |
| `INVOICES.fi_posting_status` | 66% NULL | Only 1/3 posted |

## 4. Records in terminal error states

- `ERROR_LOGS`: **0 rows.** `EXCEPTION_ITEMS`: **0 rows.** ⇒ **No error/exception records exist**, so there is nothing in a terminal error state and nothing to reprocess. (Consistent with FUNCTIONAL.md: no integration/invoice/exception logic is implemented to produce them.)
- `COMPLIANCE_EXCEPTIONS`: 2 rows; `SECURITY_INCIDENTS`: 4 (statuses CLOSED 2, RESOLVED 1, IN_PROGRESS 1) — no long-stuck records at this scale.

## 5. Duplicate rates on intended-unique fields

At seed scale, expected demo repetition (e.g. `AIRCRAFT_MASTER.aircraft_model` "Boeing 777-300ER" ×2 for B77W/B777 type codes). Key unique fields (`order_number`, `invoice_number`, `ID`, `iata_code`) show **no duplicates**. `INVOICES.invoice_number` is documented "unique per supplier" (`db/schema.cds:1385`) but there is **no unique constraint and no `checkDuplicate` implementation** — so duplicates are *possible*, just not present in the 3-row seed.

## 6. Most common validation failures by volume

**Not obtainable** — no validation-failure log exists (`ERROR_LOGS`/`EXCEPTION_ITEMS` empty; no runtime data). Cannot rank the five most common failures. Skipped per brief.

## 7. Records that violate a documented rule (highest-value findings)

| Violation | Evidence | Confidence |
|---|---|---|
| `INVOICES.status = 'SUBMITTED'` not in `InvoiceStatus` enum | INVOICES.csv; enum `db/schema.cds:1319` | High |
| `FUEL_ORDERS.status = 'Completed'` present in data but **no code path sets it** (runtime writes `'Created'`, not in enum) | FUEL_ORDERS.csv; `order-service.js:101` | High |
| Seed `FUEL_ORDERS.status = 'Draft'` contradicts runtime create value `'Created'` | FUEL_ORDERS.csv vs `order-service.js:101` | High |
| `SECURITY_USERS.employment_status = 'TERMINATED'` — no enum defines it | SECURITY_USERS.csv | Medium |
| `crew_review_status` NULL on 2/7 orders while `Confirmed` — allowed (nullable), but no default applied | FUEL_ORDERS.csv | Low |

## 8. Anonymisation key (applied consistently across deliverables)

| Token | Real value class | Example source |
|---|---|---|
| VENDOR_A…E | supplier codes/names (fuel majors) | `MASTER_SUPPLIERS.supplier_code` PETAV01/BP001/PETRON01/TOTAL001/SINOP001 |
| TAIL_01, TAIL_02 | aircraft registrations | `FUEL_BURNS.tail_number` C-FITU, C-GROV |
| STATION_xx | IATA codes | kept where structurally needed (MNL/CEB/YYZ appear in config) |
| PRICE_n | index/derived prices | `INDEX_VALUE.price_value`, `DERIVED_PRICES` |

(Structure, cardinality and distribution are preserved; only the identifying literals are masked.)

## Unanswered / needs access

| Item | Why | Access needed |
|---|---|---|
| Daily/monthly growth | Seed only; no time series | Production extract with timestamps |
| Top-5 validation failures | No failure log populated | Runtime logs from a live system |
| Real duplicate rates | 2–3 row seeds can't reveal | Production `INVOICES`/`FUEL_TICKETS` |
| Long-stuck error records | `ERROR_LOGS`/`EXCEPTION_ITEMS` empty | Production data |

# FINDINGS.md — Analysis

> Cross-cutting analysis for the merge decision. Every finding cites its source. A **CONFIDENCE** column is given where certainty is less than full. Items that may be deliberate delivery-time decisions are flagged **QUESTION**, not asserted as defects.

## A. Implementation contradicts its own documentation

| # | Finding | Doc says | Code does | Evidence | Conf. |
|---|---|---|---|---|---|
| A1 | Order create status | Enum + `.cds` docs + CLAUDE.md: `Draft → … → Completed` | Writes `'Created'` (not in enum) on create; never writes `'Completed'` | `order-service.js:101,273` vs `db/schema.cds:649` | High |
| A2 | Whole services unimplemented | CLAUDE.md lists Invoice, Pricing, Compliance, Allocation, Analytics, Security, Integration, Contracts as functional modules (FDD-06/07/09/10/11/12/13) | **No JS handlers** — declarations only | `srv/` has no `*-service.js` for these | High |
| A3 | Three-way match / posting | FDD-06 SOX controls INV-001..008; CLAUDE.md "Three-Way Match" | `executeThreeWayMatch`, `postToS4HANA`, `checkDuplicate` declared, **no logic** | `invoice-service.cds:52,59,90` | High |
| A4 | SoD enforcement | CLAUDE.md SOX INV-001 "creator cannot approve"; FPE-001 pricing | **No `created_by != approver` check anywhere**; SoD tables unused | grep `srv/*.js` = 0 | High |
| A5 | RBAC | CLAUDE.md 9 roles, scope-based access | Every `@restrict` grant includes pseudo-role **`'any'`** (93×) ⇒ effectively open; 13 roles not 9 | `srv/authorization.cds`; `xs-security.json` | High |
| A6 | S/4 destinations | CLAUDE.md `S4HC_TECHNICAL` / `S4HC_USER`, SAP_COM_* scenarios | Only destination `S2A`; no comm scenarios | `s4-sync-config.js`, `package.json` | High |
| A7 | Demand formula | CLAUDE.md `Trip+Taxi+Contingency+Alternate+Reserve+Extra` | Not implemented; comments themselves disagree (5 vs 6 terms) | `planning-service.cds:12` vs `:134` | High |
| A8 | Master sync frequency | CLAUDE.md/config "Daily" for Plants; "Real-time" suppliers | **On-demand button only; no scheduler exists** | `master-data-service.js`; grep cron=0 | High |
| A9 | ROB formula | `ROB = prev + Uplift − Burn + Adj` (3 headers) | Confirm-path clamps `max(0, prev − burn)`, drops uplift/adj | `burn-service.js:1145` | High |
| A10 | ePOD in UI | ePOD capture is a core flow | Fulfillment app "Capture Signature" button **not wired** to `captureSignatures` | `app/fulfillment/webapp/app.js` (0 writes) | High |
| A11 | Duplicate pricing model | One pricing engine (FDD-10) | **Two parallel entity families** (singular vs plural) used by different services | SCHEMA §4.4 | High |

## B. Data contradicts the implementation

| # | Finding | Evidence | Conf. |
|---|---|---|---|
| B1 | `INVOICES.status='SUBMITTED'` — value not in `InvoiceStatus` enum | INVOICES.csv; `db/schema.cds:1319` | High |
| B2 | `FUEL_ORDERS` seed uses `'Draft'`/`'Completed'` but runtime writes `'Created'` and never `'Completed'` | FUEL_ORDERS.csv vs `order-service.js:101` | High |
| B3 | `SECURITY_USERS.employment_status='TERMINATED'` — no enum defines it | SECURITY_USERS.csv | Medium |
| B4 | ACARS ingest can never populate variance (planned=0 dead code), yet variance-status ladder implies it should | `burn-service.js:304,316` | High |
| B5 | `ROB_LEDGER` never contains `ADJUSTMENT`/`TRANSFER` entries; `FUEL_SALES_ORDERS` never `IN_DELIVERY`/`CANCELLED` — matches code that never writes them | DATA_PROFILE §2 | Medium |

## C. Tables / fields / apps that appear unused

| Item | Evidence | Conf. |
|---|---|---|
| Entire singular pricing family (`PRICING_FORMULA*`, `MARKET_INDEX`, `INDEX_VALUE`, `DERIVED_PRICE`) — only read-projected by Planning, no writer | SCHEMA §4.4 | Medium |
| `CONFIG_APPROVAL_LIMITS`, `CONFIG_TILES/PERSONAS/PERSONA_TILES` — not read by any handler or the freestyle apps | grep; UI_INVENTORY §3 | Medium |
| `TOLERANCE_RULES`, `SOD_RULES`, `ALLOCATION_RULES`, `INTEGRATION_CONFIGS` — populated but no consuming code | CONFIG §1 | High |
| `SAC_EXPORT_LOGS`, `ERROR_LOGS`, `EXCEPTION_ITEMS` — never written (last two empty) | FUNCTIONAL §2/§8 | High |
| Enum members never used in code or data: OrderStatus `Completed`(code)/`Submitted`(data), SalesOrder `IN_DELIVERY`/`CLOSED`(assign), ROBEntryType `TRANSFER`, FuelBurnStatus `ADJUSTED` | multiple | Medium |
| 9 of 15 services have no UI and no JS | FUNCTIONAL §0 | High |

## D. Fields whose name implies one meaning, content/behaviour another

| Field | Name implies | Actually | Evidence | Conf. |
|---|---|---|---|---|
| `FUEL_DELIVERIES.temperature_corrected_qty` | volume corrected via density | Temperature-only factor; **density never used** | `order-service.js:423-439` | High |
| `FUEL_ORDERS.status` values | enum `OrderStatus` | Runtime uses non-enum `'Created'` | `order-service.js:101` | High |
| `s4_po_number` / `s4_gr_number` | real S/4 document numbers | **Random simulated numbers** | `order-service.js:305-306` | High |
| `planned_burn_kg` (ACARS path) | planned fuel for variance | Hardcoded `0`, never populated | `burn-service.js:304` | High |
| `variance_threshold` in `PRICING_CONFIG` / tolerance tables | active threshold | Not read by any engine (unimplemented) | CONFIG §1 | High |
| `*.company_code` / `*.cost_center` (strings everywhere) | FK to org master | No org master entity exists; free text | schema-wide | Medium |
| `finance_posted` (burn) | posted to finance system | Boolean flag only; no external post | `burn-service.js:150+` | High |

## E. Possible deliberate simplifications — flagged as QUESTIONS (may be decisions, not omissions)

| # | Observation | QUESTION for the merge team |
|---|---|---|
| E1 | No staging layer on any inbound feed (direct DELETE+INSERT / direct INSERT) | Was direct-write an accepted MVP decision, or is a staging/quarantine layer required? |
| E2 | Reconciliation tolerances hardcoded (5/10/20, ±5%) despite `TOLERANCE_RULES` table existing | Intentional hardcode for demo, or should the table drive them? |
| E3 | No versioning behaviour for planning/pricing though version columns exist | Deferred feature, or descoped? |
| E4 | S/4 posting simulated (random PO/GR); invoice/allocation posting unimplemented | Placeholder pending integration, or out of scope for this build? |
| E5 | `'any'` on every auth grant | Deliberate open-access for demo, or an accidental security hole to close before merge? |
| E6 | Master-sync transaction wrapper commented out | Temporary debugging state, or intended? (data-loss risk on mid-sync failure) |
| E7 | Two pricing entity families coexist | Which is canonical? One must be retired in the merge. |

## F. Concurrency handling

- **None.** No `@odata.etag`, no version token, no optimistic locking anywhere (grep across `srv/*.cds`, `db/schema.cds` = 0). Evidence: FUNCTIONAL §11; agent-verified.
- The only update-stamping is `AuditTrail.modified_at/by` (`db/schema.cds:27-28`) — informational, not a conflict token.
- Status guards (`if (burn.status !== 'PRELIMINARY')` etc.) are **read-then-write with no lock** → lost-update / TOCTOU exposure.
- Number generators (`max+1`) are **non-atomic** → duplicate order/ticket numbers possible under concurrency.
- Only concurrency control present: CAP **draft locking** on `@odata.draft.enabled` entities (planning, pricing, integration) — serialises edit *sessions* only, not active-instance updates.
- **CONFIDENCE: High.**

---

## G. Specific questions — explicit answers (YES / NO / PARTIAL + evidence)

| # | Question | Answer | Evidence | Conf. |
|---|---|---|---|---|
| 1 | Fuel plan versions stored as separate rows, or updated in place? | **PARTIAL** — model supports separate rows (`PLANNING_VERSION.version_id`), but **no code creates a revision** (`copyToScenario` unimplemented) | `db/schema.cds:1100`; `planning-service.cds:74` (no JS) | High |
| 2 | Does a ticket record which plan version it executed against? | **NO** — `FUEL_TICKETS` has no plan/version FK; only free-text `flight_number`/`aircraft_reg` | `db/schema.cds:848-857` | High |
| 3 | Is delivered quantity summed from tickets, or stored on the order? | **NO (summed)** — stored on `FUEL_DELIVERIES.delivered_quantity`; ticket qty never aggregated | `order-service.js:312,370` | High |
| 4 | Can a ticket exist with no order and no flight leg? | **PARTIAL** — order is `@mandatory` (cannot); flight leg is optional free text (can) | `db/schema.cds:849,856-857` | High |
| 5 | Are reconciliation tolerances configurable, or hardcoded? | **Hardcoded** (enforced ones: 5/10/20, ±5%). Config tables exist but are unused | `burn-service.js:89-91`; CONFIG §1 | High |
| 6 | Do inbound feeds have a staging layer, or write directly? | **NO staging — direct write** to target tables, every feed | `burn-service.js:329`; `master-data-service.js:192-200` | High |
| 7 | Are defuel and jettison supported as event types? | **NO** — no enum value/field/code (only unused `TRANSFER` inter-tank) | grep = 0; `db/schema.cds:1903` | High |
| 8 | Is fuel expensed on uplift, or held as inventory? | **Expensed / CO-settled** (allocation design), not inventory — and allocation is unimplemented | `allocation-service.cds:4-11` (no JS) | High |
| 9 | Is inventory valuated by tail (split valuation)? | **NO** — no inventory/valuation/split-valuation logic exists | grep = 0 (NOT FOUND) | High |
| 10 | Are codeshare, wet lease, or charter handled at all? | **NO** — NOT FOUND in schema or code | grep = 0 | Medium |
| 11 | Can processing continue when aircraft/vendor/station master is missing? | **YES** — order-from-flight inserts supplier/contract/product unvalidated; airport lookup soft (sets null, proceeds) | `order-service.js:253-265` | High |
| 12 | Is there any concept of a provisional/incomplete master record? | **NO** — only `is_active` boolean; no draft/quality/provisional status on masters | schema | Medium |
| 13 | How are multiple tickets against one order handled? | Supported via `Composition of many`; **no aggregation, no cap, no dup check** | `db/schema.cds:782`; `ticket-service.js` | High |
| 14 | Is density conversion done, and against which density? | **NO** — temperature correction only (`α=0.00099`, ref 15°C); density required but **unused**; no reference density | `order-service.js:423-439` | High |
| 15 | Are metered quantity and aircraft gauge reading both captured? | **NO** — only `delivered_quantity` (+ temp-corrected); no meter/gauge field pair | `db/schema.cds:804,811` | High |
| 16 | Is there three-way matching of order, ticket and invoice? | **NO** — `executeThreeWayMatch` declared only; no invoice JS | `invoice-service.cds:59` | High |
| 17 | How are duplicate invoice lines detected? | **Not detected** — `checkDuplicate` declared only; `duplicate_of` field never populated; no unique constraint | `invoice-service.cds:52` | High |
| 18 | Is posting to finance automatic or manual? | **Manual (action-triggered) and unimplemented** — `postToS4HANA` stub; burn `finance_posted` is a flag only | `invoice-service.cds:90`; `burn-service.js:150+` | High |
| 19 | Are posting errors retained and reprocessable? | **NO** — `ERROR_LOGS`/`EXCEPTION_ITEMS` empty and never written; no reprocess logic | DATA_PROFILE §4; FUNCTIONAL §8 | High |
| 20 | Is pricing formula-based, and where does the formula live? | **YES (formula-based)** — decomposed into ordered child component rows (`PRICING_FORMULA_ELEMENT` / `FORMULA_COMPONENTS`), **not** a stored expression string; only unused audit field `PRICE_DERIVATION_LOGS.calculation_expression` holds a string. Derivation code unimplemented | `db/schema.cds:332,4056,4282` | High |

---

## Unanswered / needs access

| Item | Why | Access needed |
|---|---|---|
| Whether the FuelSphere-UI repo implements the "missing" flows (approvals, pricing, allocation UIs) | That repo is not in this session | FuelSphere-UI repository |
| Whether unimplemented services are stubbed on purpose vs cut under pressure (E1–E7) | Requires intent, not code | Product owner / delivery team |
| Runtime auth behaviour with real XSUAA (does `'any'` truly open everything in this tenant) | Only static CDS reviewed | Deployed BTP instance |
| Real reconciliation/error volumes | No production extract | Production DB |

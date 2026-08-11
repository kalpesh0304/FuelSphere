# FUNCTIONAL.md — Behaviour As Built

> Documents what the system **actually does**, per implemented handler code. **Absence is a finding** and is stated explicitly. Only 6 of 15 services have JS logic; the other 9 are **declarations only** (CAP generic CRUD/draft + unimplemented custom actions).

## 0. Service implementation map

| Service | `.cds` | JS handler | Custom logic status |
|---|---|---|---|
| MasterDataService | `master-data-service.cds` | `master-data-service.js` (227 ln) | S/4 sync implemented |
| FuelOrderService | `order-service.cds` | `order-service.js` (867 ln) | Implemented |
| TicketService | `ticket-service.cds` | `ticket-service.js` (173 ln) | Implemented |
| RefuelerService | `refueler-service.cds` | `refueler-service.js` (235 ln) | Implemented |
| BurnService | `burn-service.cds` | `burn-service.js` (1177 ln) | Implemented |
| PlanningService | `planning-service.cds` | `planning-service.js` (610 ln) | **Excel import only**; version/demand/SAC actions unimplemented |
| InvoiceService | `invoice-service.cds` | **none** | **Declared only** — 3-way match, posting, duplicate check all stubs |
| PricingService | `pricing-service.cds` | **none** | **Declared only** — derivation, formulas, index import all stubs |
| CostAllocationService | `allocation-service.cds` | **none** | **Declared only** |
| ComplianceService | `compliance-service.cds` | **none** | **Declared only** |
| ContractsService | `contracts-service.cds` | **none** | **Declared only** |
| IntegrationService | `integration-service.cds` | **none** | **Declared only** |
| AnalyticsService | `analytics-service.cds` | **none** | **Declared only** |
| SecurityService | `security-service.cds` | **none** | **Declared only** |
| AdminService | `admin-service.cds` | **none** | **Declared only** |

Evidence: `srv/` contains JS only for burn, master-data, order, planning, refueler, ticket, server. Calling an unimplemented custom action returns CAP's default handler (no-op/echo), **not** the documented behaviour.

---

## 1. Inbound interfaces

| Interface | Source | Format | Push/Pull | Staging? | Dup detection | Error handling | Reprocess | Evidence |
|---|---|---|---|---|---|---|---|---|
| **S/4 master sync** (Countries, Plants, Suppliers) | S/4HANA OData via destination `S2A` | OData v2 | **Pull** (GET, on-demand button) | **No — DELETE+INSERT direct** | n/a (full replace) | Aborts before delete if 0 rows returned; **tx commented out** → partial-load risk | Re-run button | `master-data-service.js:106,117,192-200`; `s4-sync-config.js` |
| **ACARS burn ingest** (`ingestACARS`) | External (action payload) | JSON action args | Push (action call) | **No — direct INSERT** to `FUEL_BURNS` | Yes — by `source_message_id` → FB403 | FB401 on missing/≤0 | No | `burn-service.js:281,292-296,329` |
| **EFB burn ingest** (`ingestEFB`) | External (action payload) | JSON action args | Push | **No — direct INSERT** | Yes — by `source_message_id` → FB403 | FB401 | No | `burn-service.js:374,382-386,398` |
| **Fuel-burn Excel** (`importFuelBurnExcel`) | Uploaded `.xlsx` | Base64 xlsx | Push (upload) | **No — bulk INSERT direct** | Yes — in-memory `Set` on `tail_number\|burn_date` → FB403, row skipped | Per-row `errors[]`; FB500 on insert fail | Re-upload | `burn-service.js:622,737-741,804` |
| **ROB-initial Excel** (`importROBInitialExcel`) | Uploaded xlsx | Base64 xlsx | Push | Direct INSERT to `ROB_LEDGER` | — | FB402 if closing ROB < 0 | Re-upload | `burn-service.js:930` |
| **Flight-schedule Excel** (`importFlightScheduleExcel`, `enrichFlightScheduleExcel`) | Uploaded xlsx/csv | Base64 | Push | Direct INSERT to `FLIGHT_SCHEDULE` (+ auto Draft order) | IMP-code validations | IMP401-404 / ENR401-402 per-row | Re-upload | `planning-service.js:32,411` |
| **Flight-dispatch Excel** (`importFlightDispatchExcel`) | Uploaded xlsx | Base64 | Push | Direct INSERT to `FLIGHT_DISPATCH` | Duplicate detection on flight match | DSP401/402/500 | Re-upload | `order-service.js:573,765,829` |
| **Jefferson planned** (`loadJeffersonPlanned`) | External | array arg | — | — | — | — | **NOT IMPLEMENTED** (declared `burn-service.cds:226`) | — |

**Ordering guarantees:** none. Ingests are independent action calls; ROB is append-forward by `record_date/time/sequence` sort, so out-of-order ingest produces incorrect `opening_rob` chaining (no re-derivation exists).

**Key defect — ACARS variance is dead code:** `plannedBurnKg` is hardcoded `0` (`burn-service.js:304`) and never populated; the flight lookup doesn't read a planned value, so `if (plannedBurnKg > 0)` at `:316` never runs. **Every ACARS ingest stores `varianceStatus='NORMAL'`, variance 0, and never auto-raises an exception** despite exception-creation code existing at `:347-358`.

**Staging layer: NONE anywhere.** Every inbound feed writes directly to its target table. No quarantine/staging entity exists.

---

## 2. Outbound interfaces

**Largely NOT IMPLEMENTED.**

| Intended outbound | Status | Evidence |
|---|---|---|
| S/4 PO creation (order) | **Simulated** — random number `4500001000 + rand*9000`, no call | `order-service.js:305` |
| S/4 GR posting (order/ePOD) | **Simulated** — random `5000001000 + rand*9000` | `order-service.js:306` |
| Invoice FI posting (`postToS4HANA`) | **Declared only, no JS** | `invoice-service.cds:90` |
| Allocation CO settlement (`postToS4HANA`, `batchPostToS4HANA`) | **Declared only, no JS** | `allocation-service.cds:81,267` |
| Burn finance posting (`postToFinance`) | Sets `finance_posted=true` flag; **no external call** | `burn-service.js:150+` |
| SAC writeback (`writebackToSAC`) | **Declared only, no JS**; `SAC_EXPORT_LOGS` never written | `planning-service.cds:92` |
| Master data FS→S4 (bidirectional) | **NOT FOUND** — sync is inbound pull only | `master-data-service.js` |

`IntegrationDirection` enum includes `OUTBOUND`/`BIDIRECTIONAL` but no outbound handler exists. There is **no real outbound integration** in the build — all "posting" is either a boolean flag or a simulated number.

---

## 3. Fuel plan handling

**Versioned in the data model, not in behaviour.** `PLANNING_VERSION` supports separate rows (`version_id`, type BUDGET/FORECAST/SCENARIO, status DRAFT→IN_REVIEW→APPROVED→LOCKED). **However** none of the version lifecycle actions (`submit/approve/lock/reject/copyToScenario/calculateDemand/applyPricing/writebackToSAC`) are implemented in `planning-service.js` (all declared `planning-service.cds:48-92`, no JS). The entity is `@odata.draft.enabled`, so only CAP generic draft create/edit/activate works.

- **Revision processing:** No working copy-vs-overwrite. `copyToScenario` and `generateVersionId` are unimplemented. A revision cannot currently be produced through the intended action.
- **Demand calculation:** The formula `Trip + Taxi + Contingency + Alternate + Reserve + Extra` exists **only as comments** (`planning-service.cds:12` shows 5 terms; `:134` shows 6 with Extra — the comments disagree). **No arithmetic summing these exists in JS.**
- **What IS implemented:** Excel import of flight schedules, which auto-creates a **Draft** fuel order per flight (`planning-service.js:19-26, 573`).

---

## 4. Order lifecycle (airline side — `FUEL_ORDERS`)

**Statuses actually written** (note `'Created'` is NOT in the `OrderStatus` enum): `'Created'` → `'Submitted'` → `'Confirmed'` → `'InProgress'` → `'Delivered'`. `'Cancelled'` from any of Draft/Created/Submitted/Confirmed. **`'Completed'` is never set.**

| From | To | Trigger (action) | Guard | Evidence |
|---|---|---|---|---|
| (new) | `'Created'` | `before CREATE` | forces status | `order-service.js:101` |
| `'Created'` | `'Submitted'` | `submit()` | must be `'Created'`, `ordered_quantity>0` | `:119-135` |
| `'Submitted'` | `'Confirmed'` | `confirm()` | must be `'Submitted'` | `:138-151` |
| `'Confirmed'` | `'InProgress'` | `startDelivery()` | must be `'Confirmed'` | `:154-167` |
| any | `'Delivered'` | `captureSignatures()` (on delivery) | **no status guard on order** | `:338-344` |
| Draft/Created/Submitted/Confirmed | `'Cancelled'` | `cancel(reason)` | reason required unless Draft | `:170-191` |
| `'Confirmed'` | (no status change) | `crewReview()` — sets `crew_review_status` | must be `'Confirmed'` | `:196-224` |

**Delivery statuses** (`DeliveryStatus`: Pending/Verified/Posted/Disputed): `captureSignatures` sets delivery `'Posted'`; `verifyQuantity` sets `'Verified'` only if variance ≤5%.

**Supplier-side sales order** (`FUEL_SALES_ORDERS`, RefuelerService): RECEIVED→CONFIRMED→SCHEDULED→DELIVERED→INVOICED, + CANCELLED. `'IN_DELIVERY'` and `'CLOSED'` are enum members but **never assigned** by any handler (`refueler-service.js`).

**Limitations/defects:** lifecycle not strictly enforced (order can jump to Delivered from any state); `calculatePrice`, `getOrdersByStation`, `getOrdersBySupplier` declared but unimplemented; number generators are non-atomic max+1 (race-prone).

---

## 5. Ticket capture (`FUEL_TICKETS`)

- **Channels:** manual CREATE only (TicketService `@odata.draft.enabled`, and via FuelOrderService). **No Excel/bulk import for tickets.**
- **Validation on create:** only auto-numbering (`internal_number` = `FT-{station}-{YYYYMMDD}-{seq}`, `ticket-service.js:43-68`). **No** duplicate-ticket check, **no** meter-reading check. Documented codes `EPD410` (duplicate ticket) / `EPD411` (meter mismatch) are **comments only** (`order-service.cds:481-482`), unimplemented. Mandatory fields enforced declaratively: `ticket_number`, `quantity`, `delivery_timestamp`.
- **Can a ticket exist with no order / no flight leg?** **PARTIAL.** `order` association is `@mandatory` (`db/schema.cds:849`) → **cannot** exist without an order. Flight linkage is free-text `aircraft_reg`/`flight_number` (no `FLIGHT_SCHEDULE` FK) → a ticket needs **no** flight leg.
- **Multiple tickets/order:** supported (`FUEL_ORDERS.tickets : Composition of many`). No per-order cap, **no aggregation**.
- **Delivered qty:** **stored on the delivery (`delivered_quantity`), NOT summed from tickets.** Ticket `quantity` is never aggregated into delivery/order (`order-service.js:312,370`).

---

## 6. ePOD / delivery

- **Signatures:** `captureSignatures` requires `pilotName` + `groundCrewName` (else `EPD402`); signature **images** are stored but not required. Blocks re-capture if delivery already `'Posted'` (409). Generates simulated S/4 PO/GR, sets delivery `'Posted'` + order `'Delivered'` (`order-service.js:286-360`).
- **Quantity verification:** `varianceQty = delivered − ordered`; `variancePct = varianceQty/ordered*100`; flag if `|pct| > 5` (`:370-374`). `validateDelivery`: qty must be `>0` and `≤ ordered*1.05` (`:457-460`, code `EPD401`).
- **Temperature correction (`calculateTemperatureCorrection`):** `Corrected = Measured × [1 − 0.00099 × (T − 15)]` (`:423-426`). Requires `temperature` (EPD403) and `density` (EPD404), **but density is never used in the formula** — no mass↔volume/density conversion is performed. Density is only echoed back.
- **Metered qty AND gauge reading?** **NO.** Only `delivered_quantity` (+ derived `temperature_corrected_qty`). No meter-vs-gauge field pair exists.

---

## 7. Reconciliation (burn variance, ROB)

- **Burn variance:** `variancePct = (actual − planned)/planned*100`; status ladder **5/10/20**: ≤5 NORMAL, ≤10 WARNING, ≤20 EXCEPTION, else CRITICAL (`burn-service.js:84-92`). `requiresReview` when EXCEPTION or CRITICAL (i.e. **>10%**). Same ladder duplicated in `ingestACARS` (`:320-323`) and `importFuelBurnExcel` (`:750-752`, `>` form).
- **Tolerances:** **hardcoded** (5/10/20 literals), not configurable, not from any table. See CONFIG.md.
- **ROB reconciliation:** `ROB_current = ROB_previous + Uplift − Burn + Adjustment` documented (`burn-service.js:9`) and matched **only** in `importROBInitialExcel` (`:930`). On burn `confirm`, `_createROBEntryForBurn` uses `Math.max(0, opening − actual_burn)` (`:1145`) — **silently clamps negative ROB to 0** instead of raising FB402, and omits uplift/adjustment terms. `adjustROB` uses `opening + adjustment` (`:441`). **`recalculateROB` is declared but unimplemented** — the ledger is never rebuilt.
- **What is compared:** actual burn (ACARS/EFB/Excel) vs planned burn (`planned_burn_kg`). But planned is **never populated for ACARS** (dead code, §1), so ACARS reconciliation is effectively inert.
- **CRITICAL burns are stored, not blocked** — `FB405` ("variance exceeds max >20%") is declared (`burn-service.cds:651`) but never raised.

---

## 8. Invoice processing

**Not implemented.** `invoice-service.js` does not exist. Everything below is **declared-only**:

- Statuses (`InvoiceStatus`): DRAFT, VERIFIED, POSTED, PAID, CANCELLED. Match statuses (`InvoiceMatchStatus`): UNMATCHED, MATCHED, PARTIAL_MATCH, PRICE_VARIANCE, QTY_VARIANCE, EXCEPTION.
- **Three-way match (`executeThreeWayMatch`)** — declared, no logic (`invoice-service.cds:59`).
- **Duplicate detection (`checkDuplicate`)** — declared, no logic; intended key `supplier+invoice_number+invoice_date` is a comment (`:49-52`). Schema has `duplicate_of` self-association but nothing populates it.
- **Matching logic:** none. `ToleranceRules` entity projects `TOLERANCE_RULES` (table-driven **by design**), but no evaluation code exists.
- **Approval:** `submit/approve/finalApprove/reject/escalate` declared, no JS. Dual approval (INV-002) **not enforced**.
- **Posting (`postToS4HANA`)** — action-triggered (manual), returns `FIPostingResult`; **stub, no JS**. Not automatic.
- **Posting errors retained/reprocessable?** No — `getExceptionQueue`/`batchPostToS4HANA` return types exist but nothing is implemented and no `ERROR_LOGS`/`EXCEPTION_ITEMS` persistence is wired (both CSVs are **empty**, 0 rows).

---

## 9. SAP integration

| Aspect | As built |
|---|---|
| Objects/services consumed | `A_CountryText`+`A_Country` (API_COUNTRY_SRV), `A_Plant` (API_PLANT_SRV), `A_BusinessPartner` filter cat '2' (API_BUSINESS_PARTNER) — `s4-sync-config.js:31,64,90` |
| Commented-out (inactive) | `A_Supplier`, `A_Currency`, `A_UnitOfMeasure` (`s4-sync-config.js:117-158`) |
| Destination | **`S2A`** (BTP destination, via CAP `odata_api`, odata-v2, `forwardAuthToken`). CLAUDE.md's `S4HC_TECHNICAL`/`S4HC_USER` **NOT FOUND** |
| Document flow / movement types / account determination | **NOT FOUND** — no PO/GR/FI document creation, no movement types, no account determination anywhere |
| Fuel expensed or inventory? | **Expensed / CO-settled**, not inventory. Allocation module (declared-only) settles cost to cost/profit centers; **no goods movement, no material valuation, no split valuation** (`allocation-service.cds:4-11`) |
| Inventory valuated by tail? | **NO** (NOT FOUND) |
| Comm scenarios (SAP_COM_*) | Documented in CLAUDE.md; **NOT FOUND** in code |

---

## 10. Master data

| Master | Custom/Standard | Maintenance | Missing-record behaviour |
|---|---|---|---|
| T005_COUNTRY, T001W_PLANT, CURRENCY_MASTER, UNIT_OF_MEASURE | Standard-SAP-shaped (S/4 sourced) | S/4 sync (Countries/Plants active; Currency/UoM commented out) → **full replace** | Missing → sync guard aborts before wiping table |
| MASTER_SUPPLIERS, MASTER_PRODUCTS, MASTER_CONTRACTS | Bidirectional-intended, native | Suppliers via BP sync (active); products/contracts manual CRUD | **Not validated at order create** — order proceeds with dangling IDs |
| MANUFACTURE, AIRCRAFT_MASTER, MASTER_AIRPORTS, ROUTE_MASTER, FLIGHT_SCHEDULE | Native | Manual CRUD + Excel (flight schedule) | Airport lookup is **soft** — order-from-flight sets `airport_ID=null` and proceeds if not found (`order-service.js:253-261`) |

**Can processing continue when a master record is missing?** **YES** — orders/tickets/dispatch imports proceed with unvalidated or null master references (see §Order, FK enforcement in SCHEMA.md §7). **No concept of a provisional/incomplete master record** exists (no draft/quality status on masters beyond `is_active`).

---

## 11. Authorisation

- **Enforcement point:** CDS `@requires`/`@restrict` in `srv/authorization.cds` (69 grant lines).
- **Objects/roles:** 17 scopes, 13 role-templates (xs-security.json). Attributes `CompanyCode/Plant/CostCenter` declared.
- **Critical defect:** **every grant includes the pseudo-role `'any'`** (93 occurrences across 69 grants). In CAP `any` matches all users, so the RBAC restrictions are **effectively disabled** — any authenticated user can perform any operation.
- **Row-level security:** **none** — zero `where:` clauses; `CompanyCode/Plant/CostCenter` attributes are never used to filter rows.
- **Segregation of duties:** **not enforced** — no `created_by != approver` check anywhere in JS. Documented SOX controls INV-001/002 (invoice) and FPE-001/002/006 (pricing) are **not implemented** (and pricing/invoice have no JS at all).
- **UI routes:** app-router serves UI static content with `authenticationType: "none"` (`app/xs-app.json`); only `/odata/v4/*` is `xsuaa`.

---

## Unanswered / needs access

| Item | Why | Access needed |
|---|---|---|
| Runtime behaviour of unimplemented actions on a deployed system | Only static code reviewed | Deployed BTP instance |
| Whether S/4 destinations are configured in a real subaccount | Config references `S2A` only | BTP destination service |
| Actual reprocessing of failed integrations | `EXCEPTION_ITEMS`/`ERROR_LOGS` empty; no impl | Production data |
| Whether draft-locking suffices as concurrency control in practice | No ETag; draft only | Live concurrency test |

# CLAUDE.md

**FuelSphere — Claude Development Guide**

> **Verified against the repository on 16 August 2026.** Every claim in sections 3, 5, 6 and 7 was checked against source. Where a figure appears without a source reference, treat it as unverified.

---

## 0. How to read this file

The version before this described a **target state in the present tense**. Much of what it specified is a sound design the code has not reached. Read as current state, it caused an independent review to conclude the document was inaccurate — the fault was tense, not content.

Every section is marked:

| Marker | Meaning |
|---|---|
| **BUILT** | Implemented and working. Trust it |
| **DESIGNED** | Specified here, not implemented. Do not assume it works |
| **DIVERGENT** | Implemented, but the code does not match this specification. The code is wrong |

If source contradicts an unmarked statement, trust the source and raise it.

---

## 1. Governing documents

Authoritative. Read before starting work.

| File | Governs |
|---|---|
| `docs/design/00-DECISIONS.md` | Resolved merge decisions. **Non-negotiable.** An unfilled decision means stop and ask |
| `docs/design/01-TARGET-SCHEMA.md` | Target schema, entity by entity, in this repository's names |
| `docs/design/02-BEHAVIOUR.md` | Behaviour per module, mapped to this repository's services |
| `docs/design/03-VALIDATION-RULES.md` | 195 validation rules, each with an error code |
| `docs/design/04-WORK-PACKAGES.md` | Bounded work packages with entry and exit criteria |
| `docs/design/05-CONVENTIONS.md` | Naming, patterns, what not to touch |
| `docs/design/FuelSphere_Design_Workbook.xlsx` | Scenarios, validation rules, screens, IATA standards map |

**All three specification documents are now written.** They replaced placeholders on 17 August 2026. `01-TARGET-SCHEMA.md` covers WP-07 to WP-12 plus cost object determination; entities not listed are unchanged in Phase 1.

### Records, not specifications

| File | Note |
|---|---|
| `docs/data/SME_Requirements_Register.md` | How 52 SME requirements were dispositioned. **NOT a specification.** Accepted items are already specified in 01, 02 and 03. Do not implement from it |
| `docs/as-built-baseline/` | Independent documentation of the code as it stood before Phase 0 |

`docs/design/` also holds seven documents predating the merge reconciliation — `DESIGN_DECISIONS.md`, `MASTER_DATA_HLD.md`, `OVERALL_HLD.md`, `PERSONA_AUTHORIZATION_MATRIX.md`, `PROJECT_TRACKER.md`, `RACI.md`, `SESSION_CONTEXT.md`. **These are historical.** Where one conflicts with the authoritative set above, the authoritative set wins. `DESIGN_DECISIONS.md` in particular is superseded by `00-DECISIONS.md`.

**Work only within a declared work package.**

---

## 2. Implementation state — read before anything else

### Services with handlers — BUILT

> **Every line count on this page is a measurement dated 24 August 2026.** Ten were stale before that date — `burn-service.js` had grown from 1,177 to 1,554 and `schema.cds` from 4,381 to 5,462. **A figure that differs from this page has three possible causes, not two:** the page is stale, the page is right, or **both the page and your copy are stale and the code has moved past them.** Only measuring separates them.

| Service | File | Lines | What works |
|---|---|---|---|
| Burn | `burn-service.js` | 1554 | ACARS and EFB ingest, Excel import, variance ladder, ROB entries, confirm, reject, `adjustROB`. 24 `.on` handlers |
| Order | `order-service.js` | 1288 | Order lifecycle with status guards, ePOD capture, temperature correction, delivery validation. 16 `.on`, 2 `.before`, 3 `.after` |
| Planning | `planning-service.js` | 649 | Excel import of flight schedule and dispatch, auto-creation of draft orders. 2 `.on`, 1 `.after` |
| Refueler | `refueler-service.js` | 249 | Supplier-side sales order lifecycle. 5 `.on`, 2 `.after` |
| Master data | `master-data-service.js` | 228 | On-demand S/4 sync — countries, plants, suppliers. 4 `.on`, 3 `.before`, 7 `.after` |
| Ticket | `ticket-service.js` | 340 | Ticket creation with auto-numbering. 6 `.on` |

3,289 lines of handler code. **57 `.on` handlers against 382 declared actions and functions.**

### Services declared with no implementation — DESIGNED

Invoice · Pricing · Allocation · Compliance · Contracts · Analytics · Security · Integration · Admin

Entities exist and are seeded. OData actions are declared. **Calling one returns CAP's default no-op, not an error.**

### Simulated, inert or absent

| Item | Reality |
|---|---|
| S/4 posting | `s4_po_number` and `s4_gr_number` are **randomly generated**. Nothing is posted |
| ACARS variance | `planned_burn_kg` hardcoded `0` **on the ACARS path only**, so the `> 0` guard never fires there and every ACARS ingest stores `NORMAL` with zero variance. **The ladder is not otherwise dead** — `confirm`, `recalculateVariance` and both Excel imports all compute it, and four of five seeded burns carry a planned figure with a computed status. Measured under WP-19; earlier wording called the whole ladder unreachable, which the code does not support |
| Density | Demanded by the API (`EPD404`) then **not used**. Correction is temperature-only |
| Three-way match | Declared. No logic |
| Duplicate detection | Declared. No logic. No unique constraint on invoice number |
| SOX controls | Documented in section 9. **None enforced** |
| RBAC | **0 occurrences of `'any'` — CLOSED by WP-02.** 108 `to:` grants, and **0 `where:` clauses**, which is D14 and open |
| Row-level security | **Zero `where:` clauses.** `CompanyCode`, `Plant`, `CostCenter` attributes declared and unused |
| Scheduler | None. `derivation_schedule` and "daily sync" have no consumer |
| Config tables | `TOLERANCE_RULES` (5 rows), `SOD_RULES` (7 rows), `ALLOCATION_RULES`, `INTEGRATION_CONFIGS` — populated, read by nothing |
| Effective dating | `valid_from`, `valid_to`, `priority` columns exist. **No code resolves by date or priority** |
| Aircraft register | **Does not exist.** `AIRCRAFT_MASTER` has key `type_code` — a *type* master. Individual aircraft are free-text strings |
| Error logs | `ERROR_LOGS` and `EXCEPTION_ITEMS` have **0 rows** and are never written |
| Concurrency | No ETags. Number generation is non-atomic `max + 1` |
| Build output | No `gen/`, no `mta_archives/`. **`node_modules/` IS present — CAP 8.9.9 is installed** (corrected 21 August). The service can be booted and measured rather than reasoned about, which is how the `$fiori-preview` claims above were settled |

---

## 3. Architecture — VERIFIED

SAP CAP on Node.js, OData v4 (`.cdsrc.json` → `odata.version: v4`), `@sap/approuter` ^16 (declared in `app/package.json`, deployed as `mta.yaml` module `fuelsphere-approuter`, type `approuter.nodejs`), HANA Cloud and XSUAA on the production profile.

Not ABAP — the equivalents are CDS entities in `db/schema.cds` under namespace `fuelsphere` (`db/schema.cds:13`).

```
db/
  schema.cds          97 entities, 68 types, 2 aspects, 5462 lines
  data/               78 seed CSVs, all semicolon-delimited.
                      76 named fuelsphere-<UPPER_SNAKE>.csv;
                      3 named in PascalCase — fuelsphere-Airports.csv,
                      fuelsphere-FuelTypes.csv, fuelsphere-Suppliers.csv
srv/
  *-service.cds       15 service definition files, 15 service blocks,
                      185 exposed definitions (182 as projection on,
                      2 entity ... as select from, 1 view ... as select from),
                      382 action/function declarations
  *-service.js        6 implementations, 3289 lines total
  server.js           23 lines
  authorization.cds   108 to: grants, 0 occurrences of 'any', 0 where: clauses
  external/s4-sync.cds  service S2A, 2 entities
  config/             s4-sync-config.js, 159 lines
  *-fiori-annotations.cds   7 files, 0 entity definitions
  fiori-annotations.cds     0 entity definitions
app/
  admin/ operations/ planning/ fulfillment/ invoicing/
                      each webapp/ contains exactly app.js, index.html, style.css.
                      No manifest.json, no Component.js anywhere under app/
  package.json        approuter package
  xs-app.json         approuter routes
docs/
  design/             the merge design set plus seven historical documents
  original/ figma/ data/ test-data/ sit-test-data/
```

**No view is defined in `db/`.** Zero `as select from` and zero `view` declarations there. Three view-shaped definitions exist in `srv/`: `order-service.cds:239` (`entity CrewReviewQueue as select from`), `order-service.cds:300` (`view StationLookup as select from`), `refueler-service.cds:93` (`entity UpliftHistory as select from`).

**A 16th service exists** — `S2A` in `srv/external/s4-sync.cds`, with 2 entities. It is not a `*-service.cds` file and is excluded from the counts above.

**No secondary indexes are declared anywhere.** No `@sql.append`, no `technical configuration`, no `index` declaration, no `.hdbindex` or `.hdbtable` files, no `@assert.unique`.

> **Open:** whether deployed HANA artefacts include SQL views. CAP normally materialises service-level projections as views, but no `gen/` exists in this workspace to confirm what this project emits.

---

## 4. The UI — BUILT, being replaced

Five hand-coded freestyle apps under `app/*/webapp/`. Each contains exactly `app.js`, `index.html` and `style.css`. **No `manifest.json` and no `Component.js` anywhere under `app/`** — these are not UI5 or Fiori Elements applications.

Four of five are read-only. Only Planning writes: a `PATCH` on flight schedule and two Excel imports. **Of 382 declared actions, **two imports and two PATCH targets** (corrected 21 August by the UI survey; there is no third import in any of the five apps) are invoked by the shipped UI.**

Eight annotation files define zero entities. **CORRECTED 21 August by measurement — the previous claim here was wrong in both halves.**

**Annotation coverage is far wider than `UI.LineItem`:** **29 entities carry `UI.Facets`, 31 carry `UI.HeaderInfo`, 26 carry `UI.SelectionFields`.** The original claim came from a grep for `UI\.Facets`, which **misses the grouped `@(UI: { Facets: … })` form this repository uses in twenty-plus places.** A second pass against the CSN gave false zeros again, because the CSN flattens `HeaderInfo` to `@UI.HeaderInfo.TypeName`. **Prove any annotation instrument against a known-present and a known-absent term before trusting it.**

**And the preview is not development-only here.** `cds.features.fiori_preview: true` sits **unconditionally** in the `cds` block, and `@sap/cds-fiori` is a runtime dependency of `@sap/cds`, so it **survives the `npm install --production` that `mta.yaml` runs.** Every entity gets a List Report **and** at least one Object Page — `FuelOrders` generates eleven, one per navigation property. The count tracks navigations, not annotations; the annotations decide what is *on* the pages, not whether they exist.

Being rebuilt on Fiori Elements as a separate track. **Do not invest in the freestyle apps.**

---

## 5. Local development — VERIFIED

```bash
cds watch --port 4004
npm run dev          # rebuilds first
npm run build        # production build
```

### Test users — `.cdsrc.json`

**Thirteen entries — the twelve named below plus a `*` fallback.** Nothing depends on the fallback. Roles are **scope names**, not persona names.

| User | Roles | station | region |
|---|---|---|---|
| alice | 16 roles: AdminAccess, FuelOrderCreate, FuelOrderApprove, ePODCapture, ePODApprove, InvoiceVerify, InvoiceApprove, FinancePost, MasterDataAdmin, MasterDataRead, MasterDataWrite, ContractManage, PlanningAccess, ReportView, IntegrationMonitor, BurnDataEdit | `*` | `*` |
| kalpesh | identical to alice | `*` | `*` |
| planner | FuelPlanner, MasterDataRead, FuelOrderCreate, PlanningAccess, ReportView | `*` | `*` |
| dispatch | DispatchTeam, MasterDataRead, FuelOrderCreate, PlanningAccess, BurnDataView | YYZ, YVR, LHR | NAM, EUR |
| cockpit | CockpitCrew, MasterDataRead, FuelOrderCreate, BurnDataView | `*` | `*` |
| ops | OperationsManager, StationCoordinator, MasterDataRead, BurnDataView, BurnDataEdit, FuelOrderApprove, ePODApprove, ReportView | MNL, CEB, YYZ, YVR | APAC, NAM |
| supplier | SupplierPlanner, MasterDataRead, FuelOrderApprove, ReportView | YYZ, YVR, LHR, CDG | NAM, EUR |
| delivery | FulfillmentCrew, MasterDataRead, ePODCapture, FuelOrderCreate | YYZ, YVR | NAM |
| refueler | FuelOrderApprove, ePODCapture, MasterDataRead | YYZ, YVR, LHR, CDG | NAM, EUR |
| crew | FuelOrderCreate, MasterDataRead | `*` | `*` |
| finance | FinanceController, MasterDataRead, InvoiceVerify, InvoiceApprove, FinancePost, ReportView | — | — |
| analyst | MasterDataRead, ReportView, BurnDataView | — | — |

**Station and region attributes are declared and NOT enforced.** There are zero `where:` clauses. Testing with `ops` or `dispatch` will not reveal row-level security problems.

### Testing URLs

```
http://localhost:4004                                   service index
http://localhost:4004/odata/v4/orders/$metadata         metadata
http://localhost:4004/odata/v4/orders/FuelOrders        entity data
http://localhost:4004/$fiori-preview/FuelOrderService/FuelOrders
```

---

## 6. Build and deploy — VERIFIED

```bash
npm install
npm run build
mbt build
cf login -a https://api.cf.<region>.hana.ondemand.com
cf deploy mta_archives/fuelsphere_1.0.0.mtar
```

### Node version

**Node 22.x is required.** `package.json` `engines.node` is `"22.x"`, `.nvmrc` contains `22`, and `app/package.json` also declares `"22.x"`. `@sap/cds` is `^8`.

```bash
node --version
nvm use 22
npm rebuild        # after switching
```

### BTP services provisioned in `mta.yaml`

| Service | Plan | Purpose |
|---|---|---|
| SAP HANA Cloud | hdi-shared | Database |
| XSUAA | application | Authentication |
| Destination | lite | S/4 connectivity |
| Application Logging | lite | Logs |
| **Connectivity** | lite | `fuelsphere-connectivity` |

---

## 7. S/4HANA integration — DIVERGENT

### Destinations — a live defect

| Declared in `mta.yaml` | Referenced by code |
|---|---|
| `S4HC_TECHNICAL` — OAuth2ClientCredentials | Nothing |
| `S4HC_USER` — OAuth2SAMLBearerAssertion | Nothing |
| — | **`S2A`** — required by `package.json` lines 49, 60, 79; used by `master-data-service.js:103-112` |

**Defect D19: the destination the code uses is not provisioned, and neither provisioned destination is used.** Master data sync will fail on a fresh deployment. Not covered by any current work package.

`package.json` `cds.requires` also defines `odata_api` as **`kind: odata-v2`** against `S2A`, in both default and production profiles — an OData v2 outbound channel alongside the v4 service layer.

### Communication scenarios — DESIGNED

SAP_COM_0008 Business Partner · 0009 Product Master · 0028 Journal Entry · 0053 Purchase Contract · 0164 Purchase Order · 0367 Goods Receipt. **None configured.**

---

## 8. Error codes

Two sets — implemented and designed. **Both are valid.** New validations take a code from the appropriate prefix.

### Implemented — BUILT

| Prefix | Domain |
|---|---|
| `FB4xx` / `FB5xx` | Fuel burn and ROB |
| `EPD4xx` | ePOD, delivery, quantity verification |
| `IMP4xx` | Flight schedule import |
| `ENR4xx` | Flight schedule enrichment |
| `DSP4xx` / `DSP5xx` | Flight dispatch import |

### ePOD and delivery — `EPD4xx`

| Code | Description | State |
|---|---|---|
| EPD401 | Delivered quantity exceeds tolerance, above 5% variance | BUILT |
| EPD402 | Missing required signature before status change | BUILT |
| EPD403 | Temperature out of range, −40 to +50 °C | BUILT |
| EPD404 | Density out of specification, 0.775 to 0.840 kg/L | BUILT — density then unused |
| EPD410 | Duplicate ticket number for supplier | DESIGNED |
| EPD411 | Meter reading does not match ticket quantity | DESIGNED — **no meter field exists** |

### Integration — `INT4xx` — DESIGNED
INT401 S/4 PO creation failed · INT402 S/4 GR posting failed · INT403 supplier communication timeout · INT404 object store upload failed

### Invoice — `INV4xx` — DESIGNED
INV401 PO not found · INV402 GR not found · INV403 price variance exceeds tolerance · INV404 quantity variance exceeds tolerance · INV405 duplicate invoice · INV406 FI posting failed · INV407 invalid tax code for jurisdiction · INV408 posting period closed · INV409 approval limit exceeded · INV410 currency conversion error

### Planning — `PLN4xx` — DESIGNED
PLN401 version not found · PLN402 version status invalid · PLN403 missing flight schedule · PLN404 route-aircraft matrix not found · PLN405 price assumption missing · PLN410 SSIM parsing error · PLN411 invalid SSIM record · PLN420 SAC connection failed · PLN421 SAC writeback failed · PLN422 SAC model not configured

**Convention:** `4xx` business rule violation, `5xx` technical failure. New domains take a new prefix, documented here.

---

## 9. SOX controls — DESIGNED, none enforced

### Invoice verification

| Control | Description |
|---|---|
| INV-001 | Invoice creator cannot approve the same invoice |
| INV-002 | Dual approval for variances above threshold |
| INV-003 | Three-way match — PO, GR, invoice |
| INV-004 | Duplicate invoice detection |
| INV-005 | Quantity variance threshold alerts |
| INV-006 | Price variance threshold alerts |
| INV-007 | Approval workflow audit trail |
| INV-008 | Approval value limits per role |

### Pricing engine

| Control | Description |
|---|---|
| FPE-001 | Formula creator cannot approve own formula |
| FPE-002 | Index importer cannot execute price derivation |
| FPE-003 | Formula version audit trail |
| FPE-004 | Index value verification required |
| FPE-005 | Price derivation log — complete calculation audit |
| FPE-006 | Dual approval for high-value formulas |
| FPE-007 | Hybrid variance threshold alerts |

`SOD_RULES` holds 7 seeded rows. **No check exists in any handler.**

---

## 10. Key business processes

### Fuel order lifecycle — DIVERGENT

```
Draft → Submitted → Confirmed → InProgress → Delivered → Completed
                                     |
                        Signatures captured (ePOD)
                                     |
                          S/4 PO and GR created
```

**This is the correct target.** The code diverges:

- Writes `'Created'` on creation, which is not in `OrderStatus`. Should write `'Draft'`
- Never writes `'Completed'`. The path is unimplemented
- `captureSignatures` sets `Delivered` **with no status guard**, so an order can jump there from any state

Seed data uses `Draft` and `Completed`, correctly following this specification. **The code is wrong, not the data.**

### Invoice verification flow — DESIGNED

```
Draft → Submitted → Three-Way Match → Verified → Approved → Posted
                          |
                   Exception Queue → Finance Manager Review
```

`InvoiceStatus` is missing the `Submitted` member this flow requires. Seed data contains `SUBMITTED`, correctly following the specification. **Add the enum member.**

### ROB calculation — DIVERGENT, with a complication

`db/schema.cds:1985` states the formula:

```
closingROBKg = openingROBKg + upliftKg - burnKg + adjustmentKg
```

`ROB_LEDGER` carries all four components as separate fields, plus associations to `FUEL_BURNS`, `FUEL_DELIVERIES` and `FLIGHT_SCHEDULE` (`db/schema.cds:2001-2004`). **The model is correct.**

`burn-service.js:1145` computes `max(0, previous - burn)` — dropping uplift and adjustment, and clamping negatives.

**Complication:** `db/schema.cds:2014` carries `@assert.range: [0, null]` on `closing_rob_kg`. The clamp may exist to satisfy that assertion. Removing the clamp without addressing the assertion will move the failure from silently-wrong-data to a rejected insert.

### Fuel demand calculation — DESIGNED

```
Total Fuel = Trip + Taxi + Contingency + Alternate + Reserve + Extra
```

Not implemented. `FLIGHT_DISPATCH` holds a single `dispatch_qty_kg` with no breakdown. Comments in `planning-service.cds` state five terms at line 12 and six at line 134.

---

## 11. Known defects

Full list with evidence in `docs/design/00-DECISIONS.md`. Blocking set:

| # | Defect |
|---|---|
| ~~D1~~ | ~~Master sync transaction wrapper commented out~~ — **NOT A DEFECT.** Measured under WP-01 on 16 Aug 2026. CAP wraps every inbound request in a managed transaction; bare `DELETE`/`INSERT` dispatch onto it and `req.error(500)` rolls back. Delete and insert are already atomic on the request path. **Restoring the wrapper breaks the sync** — see trap below. Residual risk only if `_syncFromS4` is called outside a request context |
| ~~D2~~ | **CLOSED by WP-02.** `'any'` now occurs **0 times**; 108 `to:` grants. The row described a fixed defect as live until 24 August |
| D3 | ROB formula drops uplift, clamps negatives |
| ~~D4~~ | **CLOSED** under WP-04. Shared allocator with an atomic counter, nine sites across five services |
| D5 | No optimistic locking; status guards read-then-write |
| D11 | No aircraft register |
| D13 | `captureSignatures` has no order status guard |
| D14 | No row-level security — zero `where:` clauses |
| D15 | ROB ledger cannot be rebuilt; `recalculateROB` unimplemented |
| ~~D16~~ | **CLOSED.** WP-05 removed it; confirmed by the WP-13 pre-survey that no `100000` guard remains in any handler |
| **D19** | **NARROWED by the WP-21A closure survey. Two problems, not one.** **(a) Naming — decided.** `package.json` names `S2A` for `odata_api`, and `master-data-service.js:105` connects to it; `mta.yaml` provisions `S4HC_TECHNICAL` and `S4HC_USER`, neither referenced anywhere. **Point the code at `S4HC_TECHNICAL`** — background lookups with no user in the loop. Not the reverse: `S2A` is opaque, and renaming a destination to it would erase the technical-versus-principal-propagation distinction the two were created to express. One string. **(b) Environment — open.** **Neither provisioned destination declares a `URL`.** Both are `Type: HTTP`, `ProxyType: Internet`, with an authentication method and a description and nothing to point at. No S/4 tenant exists behind either, and no code change resolves it. **Caveat on (a):** a technical user for everything is right while FuelSphere holds its own authorisation model. If row-level security ever resolves against what a user may see **in S/4** rather than against FuelSphere's own attributes, `S4HC_USER` earns its place — and that is a decision, not a destination swap. Note before WP-14 |
| **D25** | **79 enum-typed elements in the schema. Zero are enforced.** Declaring a CDS enum does **not** validate input — CAP only checks where `@assert.range` is present. Before annotation, a POST with `status='RETURNED'` against a newly declared enum returned **201**. This is the mechanism behind the whole enum-violation class WP-06 corrected: `SUBMITTED` could sit in seed data against an enum lacking the member because nothing ever checked. WP-09 enforced one field; the other 78 have a wide blast radius across writers and seed data. See WP-09B |
| **D24** | **Three seed CSVs are dead, not misnamed.** `fuelsphere-Airports.csv`, `fuelsphere-FuelTypes.csv`, `fuelsphere-Suppliers.csv`. No matching entity exists under any name; headers are camelCase (`iataCode`, `specificEnergy`) from a different design; CAP has never loaded them. Live equivalents are `MASTER_AIRPORTS` and `MASTER_SUPPLIERS`; `FUEL_TYPES` has no counterpart at all. **Delete, do not rename** |
| **D30** | **Two thresholds are enforced twice, and config alone will not move them.** Temperature and density limits exist as literals in the handler **and** as `@assert.range` on `db/schema.cds`. Move the literal into configuration and **the annotation still enforces the old value**. **CORRECTED 24 August — an earlier restatement of this row claimed `@assert.range` is INERT on numeric bounds. THAT WAS FALSE and it was mine**: it contradicted a measurement already reported to me, in which `delay_minutes` with `[0, 100]` on a non-draft entity rejected 5000 with *"Value 5000 is not in specified range"*. Re-measured on CAP 8.9.9 in an isolated model: **numeric ranges enforce, and CAP names the range in the error.** **Three caveats, not inertness:** it fires on a non-draft write; on a **draft-enabled** entity it defers to `draftActivate`; and it **never** fires on `db.run`, which is how every handler here writes. Separately, the burn variance ladder is written out **three times in two forms** in `burn-service.js`, and `ToleranceType` has no member for temperature, density or burn variance | |
| **D32** | **The shipped UI reads five fields that do not exist.** Invoicing reads `invoice_status` (the field is `status`), `supplier_name` (it is an association) and `total_amount` (the entity has `net_amount`, `tax_amount`, `gross_amount`). Consequence: **the Exception Queue always reads "No exceptions — all clear" whatever the data says**, Posted is always 0, and Pending always equals the total. Operations reads `b.aircraft_type` and `b.origin_airport_code` where OData emits `aircraft_type_code` and `origin_airport_ID`, so **two Aircraft columns are permanently `--`**. Admin's invoice KPI reads `invoice_status` and therefore counts every invoice, always. Found by the UI survey | 
| **D33** | **There is no error surface in any of the five applications.** The `odata()` helper — written five times, identically — catches every failure and **returns `[]`**. A 401, a 500, a CSRF rejection and a genuinely empty table all render as "No records found". **Nothing anywhere tells a user that a call failed** | 
| **D39** | **WP-05's exit criteria no longer hold on `main`.** `wp05-harness` runs 4 passing, 2 failing — `EXIT-2b` and `EXIT-2c` — and it fails **identically on unmodified `main` at `d250a2f`**, so it is not caused by any recent branch. **A merged package's criteria stopped holding and nothing caught it.** The regression suite runs each package's harness when that package is built and afterwards only when someone re-runs it; nothing re-runs an old harness on a schedule. **Needs diagnosis: which later package broke it, and whether the criterion or the behaviour is now wrong.** Found by WP-HDI's regression run | 
| **D37** | **This repository cannot have produced the deployed launchpad. Settled from git history, 22 August.** **(a) Exactly one `manifest.json` has ever existed** — `app/airports/webapp/manifest.json`, five blob versions of one path, enumerated across **all 64 refs** rather than current heads. Never 58, never 5. **(b) The ability to deploy an HTML5 app existed on `main` for 37 minutes and 29 seconds** — `html5-apps-repo` added to `mta.yaml` at `2026-01-29 11:18:22`, removed at `11:55:51` the same morning, verified on the blobs. Re-added the next day on `claude/fix-fuelsphere-deployment-zl1cb`, **never merged**, frozen since 6 February. **(c) No `gen/`, no `mta_archives/`** — nothing here has ever been built. **What history cannot say:** who built `comfuelspherefuelorders` or from where. A deployment leaves no trace in git — someone could have cloned this repo, generated apps against `$metadata` and deployed from a different working copy. **The BTP HTML5 Application Repository, the launchpad site config and the CF audit log would each answer it** | 
| **D38** | **Five services' annotation files were written and then lost.** The 23—24 February burst is 24 commits whose messages read *"Sync … with Figma transfer package"*. **Five of the services annotated then have annotation files that no longer exist on `main`.** Separate from the `app/airports` deletion and not explained by it. Recoverable from history; whether the work is wanted is a question, but it should not be lost by accident twice | 
| **D35** | **`main`'s `mta.yaml` cannot deploy an HTML5 application.** It has approuter, srv, db-deployer and four managed services, and **no `html5-apps-repo` host or runtime module and no `ui-deployer`.** That is why no Fiori app is committed anywhere — there is nothing to deploy one with. **Working modules exist on the stale branch `origin/claude/fix-fuelsphere-deployment-zl1cb`.** This is the actual constraint on the UI work, not the screens | 
| **D36** | **A working Fiori Elements app was deleted by accident.** `app/airports` — `sap.app.id` `fuelsphere.airports`, appTitle "Airport Master Data", a **genuine List Report and Object Page** with a `semanticObject: Airport` / `action: manage` inbound. Added 29 January 2026, removed from `main` on 19 February in commit `a4e6256`, titled *"chnages in mta.yaml, package.json file for deployment"*. **Collateral damage during deployment configuration.** Recoverable from three `claude/*` branches. **This is the proven pattern the UI work needs** — it does not have to be invented | 
| **D34** | **`isPRFlight()` silently excludes Philippine Airlines flights.** Operations and Planning both drop any flight whose `airline_code` is `PR` or whose number starts `PR` — from **every table and every KPI**. A hardcoded exclusion of the reference client's own carrier, in the two apps that carry the planning story | 
| **D31** | **`FUEL_DELIVERIES.delivered_quantity` is unguarded and looks guarded.** No `@assert.range`, no write guard. Its only check is `EPD401` at `order-service.js:701`, inside `validateDelivery` — **a read-only report that records and returns and blocks nothing.** So a negative delivered quantity is accepted today. Distinct from D30: an inert assertion is fixed by removing or replacing it; **this needs a guard written.** WP-17 deferred making the field derived, which moots it — until then it is open | 
| **D22** | **Eleven bound actions are denied under real authorisation, for every user including one holding all scopes.** CAP checks a bound action against the entity's `@restrict` for a grant naming that action. `FuelDeliveries` and its peers grant only READ/CREATE/UPDATE/DELETE, so the action is refused before its own `@requires` is consulted. Pre-existing and unchanged by WP-02. **Masked locally by dummy auth; would surface on XSUAA.** Fix is mechanical — a `{ grant: '<action>', to: [...] }` entry per action mirroring its existing `@requires`, granting nothing new. See WP-02B |
| **D23** | **FOUR implemented services have no authorisation of any kind, and the count grows with every service that ships handlers.** `authorization.cds` covers 4 of 15 services. **`InvoiceService` (401 lines), `PlanningService` (649), `PricingService` (457) and `RefuelerService` (249)** have no annotation block, not even a service-level `@requires`. **Measured against the code, not against a document** — `authorization.cds` covers MasterData, FuelOrder, Ticket and Burn, and those four are exactly what is left. `PricingService` joined at WP-20, `InvoiceService` at WP-21A. **This row has been re-counted three times and any stale copy of it is an undercount** — including the line counts above, which are a measurement with a date on them. The count has grown once already and will grow again with every service that gains handlers. `PlanningAccess` is defined as a scope and appears in no grant for that reason, which is a missing grant on working code rather than an unimplemented module |
| **D21** | **`aircraft_ID` written to `ROB_LEDGER` where no such element exists** — `burn-service.js:479` and `:1071`. The association flattens to `aircraft_type_code`, so `adjustROB` and the Excel ROB import silently never set the aircraft reference |
| **D20** | **A malformed S/4 response is reported to the caller as "0 records."** `master-data-service.js:130-135` — where the response matches none of the three expected shapes, the `throw` is commented out and the raw body logged. `s4Data` stays `[]`, so the zero-row guard fires. **Data-safe**, but a payload the code cannot parse is indistinguishable from an empty source. A schema change at the S/4 end would be chased as a data problem |

---

## 12. Traps

| Trap | Detail |
|---|---|
| ~~Two pricing families~~ | **RESOLVED** under WP-08, PR #35. The singular family is deleted; 95 projection names across 15 services, zero collisions |
| **Enum casing is inconsistent by design** | `OrderStatus` uses `Draft`; `CrewReviewStatus` uses `PENDING`. **Do not normalise** — it breaks seed data and external callers |
| **Seed data follows the spec, code does not** | Where seed data, this file and the code disagree, the code is usually the outlier. Check here before "fixing" data |
| **Declared is not implemented** | 382 declared actions, 57 `.on` handlers. CAP returns a default no-op for an action with no handler — **it looks like it worked** |
| **Check whether an entity is draft-enabled before reaching for `.drafts`** | The WP-12 rule says a handler reading its own row needs the draft path. It says nothing about entities that **have no draft path**. WP-19 registered on `ApuUsage.drafts`, which is `undefined` because the entity is not draft-enabled — **compiled clean, failed at boot.** The rule is about which path to use *where one exists* |
| **A delimiter inside free text shifts every column after it** | WP-19 put a semicolon in a `remarks` value of a semicolon-delimited CSV. The row gained a column, and **CAP reported it as "Invalid time value"** — sending the author after a timestamp that was never wrong. **When a CSV error names a field, check the column count before believing it** |
| **A UUID key must be valid hex** | WP-19 seeded IDs beginning `apu00000`. `p` and `u` are not hex digits, so the key could not parse and every bound-action call returned 404 |
| **`cds.tx(req, …)` inside a request handler silently discards writes** | CAP already wraps every inbound request in a managed transaction. Passing `req` opens a nested one and the writes never land, **while the action still returns HTTP 200 with success: true**. Measured under WP-01 on all three master data feeds. **`cds.tx()` WITHOUT `req` does not work either — measured under WP-20.** It **deadlocks** inside a live request on a single-connection database, and `req.on('failed')` does not fire. **So there is no mechanism for writing a record that survives a failed request.** A refused operation cannot be logged; the reason lives only in the error returned to the caller |
| **Check CAP's defaults before adding a safety net** | D1 was recorded as a data-loss defect because a transaction wrapper was commented out. It was commented out because it was redundant. Verify what the framework already provides before treating an absence as a gap |
| **`MASTER_SUPPLIERS` is `cuid`** | Its primary key is a generated UUID, so a duplicate `supplier_code` raises no constraint violation. Any test relying on a PK collision there will pass vacuously |
| **Local development does not exercise authorisation at all** | Dev auth is `kind: 'dummy'`, which authorises every request as privileged. `@restrict` is never evaluated. The twelve test users in section 5 have no effect locally. To test authorisation you must override to `kind: 'mocked'` **and** supply the users map in the same override — replacing the auth block alone discards the users. This is why 93 `'any'` entries survived unnoticed |
| **A DateTime field cannot carry an ETag** | `@odata.etag` on `modified_at` rejects every conditional request with 412, including a token CAP itself just issued. Measured under WP-04 and isolated: an Integer carrier returns 200, and `created_at`, which is never auto-updated, still returns 412. The annotation and `@cds.on.update` are not the cause |
| **`@odata.etag` is not additive** | It makes `If-Match` **mandatory** on every modifying call for that entity. Every unconditional update becomes 428, breaking `draftActivate` and any existing client. Adding it is a breaking change, not an enhancement |
| **A search that matches one form is silently partial** | Three occurrences, three dresses. WP-04 grepped `ConcurrencyMode` where OData v4 emits `Core.OptimisticConcurrency`. WP-08 grepped `^\[error` where the compiler emits `[ERROR]`. WP-09 grepped `status: '…'` and missed `req.data.status = '…'` — the **primary writer**, in assignment form rather than object-literal form. **A verification that can produce a false pass is worse than none.** Key on exit codes; where a search is unavoidable, make it form-agnostic and prove the instrument against a known-present string |
| **A CDS annotation binds to the next declaration** | Inserting an entity between an annotation and its target silently reassigns it. WP-07 broke `Aircraft`'s draft enablement this way, and **`cds compile` returned 0** — only a service boot caught it. A clean compile is necessary, not sufficient |
| **Harnesses must run one per process** | A batch run of all 24 reports **88 failures**. They are `cds.test()` instances colliding in one process, **not regressions** — each harness passes clean when run alone. **Anyone running the suite as a batch will conclude the build is broken.** One process per harness is the only run that means anything |
| **`before CREATE` is not a guard on the entity** | Direct `INSERT` bypasses it. WP-07 found four order-creation paths, three writing directly; WP-04 found nine number-generation sites. Survey the writers |
| **`@assert.range` enforces BOTH numeric and enum — with three caveats** | Measured on CAP 8.9.9 in an isolated model. **It fires on a non-draft write** and names the range in the error. **On a draft-enabled entity it defers to `draftActivate`**, so a POST that returns 201 has not been validated yet. **And it never fires on `db.run`**, which is how every handler in this repository writes — so no annotation constrains an internal write. **An earlier version of this row claimed numeric bounds were inert. That was false**, and believing it would have meant writing handler guards that already exist in the annotation |
| **Declaring a CDS enum does not enforce it** | CAP validates only where `@assert.range` is present. Without it an enum is documentation — any string is accepted. 79 enum-typed elements exist and 0 are enforced. **A change that declares an enum and stops there looks done and is not** |
| **The two pricing families were not versions of one design** | Of `DERIVED_PRICE`'s 26 fields, 20 had no counterpart on `DERIVED_PRICES`. Four read paths were dropped in WP-08 because none exists. `MARKET_INDICES` has no forward composition to its values — the relationship is modelled only from the child |
| **A defect's stated scope may understate it** | WP-02 found `authorization.cds` covers 4 of 15 services. WP-04 found nine number-generation sites across five services where the defect named three. Survey before fixing — a partial fix on a distributed defect looks complete and is not |
| **Bound actions need their own grant** | A grant of READ/CREATE/UPDATE/DELETE on an entity does not permit its bound actions. CAP looks for a grant naming the action; without one the call is refused before the action's own `@requires` is read. See D22 |
| **Assertions may explain bad code** | `@assert.range: [0, null]` on `closing_rob_kg` may be why the ROB clamp exists. Check for a constraint before removing a defensive line |
| **Seed data now covers the priority cases** | WP-06 added 20 scenario rows across 8 files: tail swap, defuel, broken ledger chain, duplicate invoice line, over-delivery, unmatched ticket, cancelled flight with fuel delivered, multi-ticket order. **26 of the design workbook's 157 scenarios are seedable**; 131 need entities that do not exist here |
| **Check the field type before calling a value an enum violation** | `SECURITY_USERS.employment_status` was reported as holding a value outside `UserStatus`. It is `String(20)`, not enum-typed, and `UserStatus` belongs to a different column. A sweep of all 380 enum-typed values found 15 genuine defects that nobody had listed — `PARTIAL` for `PARTIAL_MATCH` and `OK` for `NORMAL` |
| **Three CSVs break the naming pattern** | `fuelsphere-Airports.csv`, `fuelsphere-FuelTypes.csv`, `fuelsphere-Suppliers.csv` are PascalCase where the other 76 are UPPER_SNAKE |
| **Hardcoded thresholds implement documented rules** | −40/+50 °C and 0.775/0.840 kg/L are `EPD403` and `EPD404`. Not arbitrary magic numbers. Move the values to `TOLERANCE_RULES` without changing them |
| **Historical documents sit beside authoritative ones** | Seven pre-merge documents share `docs/design/`. See section 1 |
| **Node 22 only** | `engines.node` is `"22.x"`. Run `npm rebuild` after switching versions |

---

## 13. Rules of engagement

**Do not:**

- Rewrite an implemented handler. Extend it, and correct it only where it diverges from this document
- Change an entity or field name — embedded in 185 projections and 78 seed files
- Normalise enum casing across modules
- Combine work packages in one branch
- Invent a decision. If `00-DECISIONS.md` is silent, stop and ask
- Assume a DESIGNED item works
- Add `where:` clauses outside WP-14

**Always:**

- Commit schema changes separately from behaviour changes
- Assign an error code from section 8 to every new validation
- Add a seed scenario exercising any behavioural change
- Treat a derived value with a missing input as `null`, never `0`
- Record which configuration row produced a resolved value
- Check for a schema assertion before removing a defensive guard

**Stop and raise when:**

- A decision is unfilled or ambiguous
- Source contradicts the design documents or this file
- You find a defect not on the list
- Exit criteria cannot be met as written
- The change would touch an implemented handler beyond its stated scope

---

## 14. File naming

| Type | Convention | Example |
|---|---|---|
| CDS files | kebab-case.cds | `order-service.cds` |
| CSV data | namespace-ENTITY_NAME.csv | `fuelsphere-MASTER_AIRPORTS.csv` |
| JS handlers | entity-name.js | `order-service.js` |
| Entities | UPPER_SNAKE_CASE | `FUEL_DELIVERIES` |
| Fields | lower_snake_case | `delivered_quantity` |
| Enum types | PascalCase | `OrderStatus` |

---

## 15. Common issues

### Fiori preview not loading

1. `curl http://localhost:4004`
2. Use VS Code Simple Browser, not an external browser in Codespaces
3. Clear cache
4. `pkill -f "cds watch" && cds watch`

### CSV loading

- Column headers must match CDS property names exactly
- Semicolon-delimited
- No trailing commas or whitespace
- Dates as `YYYY-MM-DD`
- UUID fields must hold a valid UUID or be empty

---

## 16. Domain notes

- **ROB** — remaining on board. Running fuel balance on a tail, chained across the rotation
- **ePOD** — electronic proof of delivery. Signature capture at the aircraft
- **Uplift** — fuel delivered to the aircraft
- **Block fuel** — total planned fuel gate to gate. **Trip fuel** is takeoff to touchdown
- **OOOI** — out, off, on, in. Present on `FLIGHT_SCHEDULE` as `aobt`, `atot`, `aldt`, `aibt`
- **Into-plane agent** — the party physically delivering fuel, often a different legal entity from the supplier
- **APU** — auxiliary power unit. Burns fuel on the ground, never metered. **No APU field exists in the model**
- Fuel is **planned in mass** (kg) and **delivered and invoiced in volume** (litres). Density is the conversion, and it is currently not performed

---

## 17. Related projects

**Confirmed again by WP-UI-01, 18 August 2026: none of the four apps named in the launchpad exists here.** Manage Fuel Orders, Manage Fuel Tickets, Manage Flight Dispatch and Flight Schedule are `UI.HeaderInfo.TypeNamePlural` values on four entities — labels, not applications. The five apps under `app/` are Admin, Operations, Planning, Fulfillment and Invoicing, all freestyle, and **none reads an annotation.**

**Annotations in this repository reach `$fiori-preview` and `$metadata` only.** They change no pixel in any deployed app here. Where the four named apps are served from is an open question on the demo path.

**FuelSphere-UI does not exist in this repository.** No directory, no git submodule (`.gitmodules` absent), no path matching `*fuelsphere-ui*`. `app/package.json` is named `fuelsphere-approuter`, which is the approuter, not a UI project.

**ANSWERED 21 August by the UI survey.** Operations, Planning and Fulfillment each hardcode an absolute URL to a UI5 application named **`comfuelspherefuelorders`**, deployed to an **eu10 launchpad** at a subaccount-, tenant- and version-specific address. Every fuel order number in those three apps links to it, `target="_blank"`, **carrying no key** — so it opens that app's home page rather than the order clicked. At least one of the four launchpad-named apps is therefore deployed outside this codebase, and three apps here already depend on it by absolute URL.

**RESOLVED 22 August — the four apps are in four separate public repositories.**

| Repo | `sap.app.id` | Binds to | Pages |
|---|---|---|---|
| `kalpesh0304/fuelorders` | `com.fuelsphere.fuelorders` | `/odata/v4/orders/` | ListReport + 3 ObjectPages |
| `kalpesh0304/fuelTickets` | `com.fuelsphere.orders.fueltickets` | `/odata/v4/orders/` | ListReport + ObjectPage |
| `kalpesh0304/flightDispatch` | `com.fuelsphere.order.flightdispatch` | `/odata/v4/orders/` | ListReport + ObjectPage |
| `kalpesh0304/flightSchedule` | `com.fuelsphere.planning.flightschedule` | **`/odata/v4/planning/`** | ListReport + ObjectPage |

One "Initial version" commit each, Jagdeep Singh, 6 August 2026, all four within fifteen minutes. Real `crossNavigation` inbounds, UI5 1.144—1.146.

**THE DECISIVE FINDING: every app's `annotations/annotation.xml` is an EMPTY STUB.** Seventeen lines of namespace reference and `<Schema Namespace="local"></Schema>` with **zero annotation targets**. The apps define no UI of their own — **every column, filter and facet comes from `srv/*-fiori-annotations.cds` through `$metadata`.**

**Annotation changes made in this repository reach the deployed screens directly.** No app change and no extension for any ordinary UI change. **That makes UI-B-03's twenty-two unplaced fields the UI work itself**, not a preliminary to it.

**And `flightSchedule` binds to `PlanningService`** — the rich set, 12 columns, 7 filters, 7 facets. The thin `FuelOrderService.FlightSchedule` is not what is deployed.

**SETTLED 22 August by git history — see D37.** One `manifest.json` has ever existed in this repository, and the ability to deploy an HTML5 app survived on `main` for 37 minutes. **Whatever produced the 58 tiles, it was not this repository.** Treat the launchpad as a separate artefact until someone establishes where it was built from. Do not assume UI work lives outside this repository.

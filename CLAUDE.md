# FuelSphere — Claude Development Guide

**SAP CAP / CDS fuel management solution for airlines.**

---

## 0. How to read this file

The previous version described a **target state** in the present tense. Much of what it specified is a sound design the code has not yet reached. Read as current state, it caused an independent review to conclude the document was inaccurate — the real problem was tense, not content.

Every section is therefore marked:

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
| `docs/design/04-WORK-PACKAGES.md` | Bounded work packages with entry and exit criteria |
| `docs/design/05-CONVENTIONS.md` | Naming, patterns, what not to touch |
| `docs/as-built-baseline/` | Independent documentation of the code as it stands |

`01-TARGET-SCHEMA.md`, `02-BEHAVIOUR.md` and `03-VALIDATION-RULES.md` are not yet written. Stop and ask before schema or behaviour work.

**Work only within a declared work package.**

---

## 2. Implementation state — read before anything else

### Services with handlers — BUILT

| Service | File | Lines | What works |
|---|---|---|---|
| Burn | `burn-service.js` | ~1177 | ACARS and EFB ingest, Excel import, variance ladder, ROB entries, confirm, reject, `adjustROB` |
| Order | `order-service.js` | ~867 | Order lifecycle with status guards, ePOD capture, temperature correction, delivery validation |
| Planning | `planning-service.js` | ~610 | Excel import of flight schedule and dispatch, auto-creation of draft orders |
| Refueler | `refueler-service.js` | ~235 | Supplier-side sales order lifecycle |
| Master data | `master-data-service.js` | ~227 | On-demand S/4 sync — countries, plants, suppliers |
| Ticket | `ticket-service.js` | ~173 | Ticket creation with auto-numbering |

### Services declared with no implementation — DESIGNED

Invoice · Pricing · Allocation · Compliance · Contracts · Analytics · Security · Integration · Admin

Entities exist and are seeded. OData actions are declared. **Calling one returns CAP's default no-op, not an error.** Roughly 250 actions are declared; a handful have handlers.

### Simulated, inert or absent

| Item | Reality |
|---|---|
| S/4 posting | `s4_po_number` and `s4_gr_number` are **randomly generated**. Nothing is posted |
| ACARS variance | `planned_burn_kg` hardcoded `0`, so the `> 0` guard never fires. Every ACARS ingest stores `NORMAL` with zero variance |
| Density | Demanded by the API (`EPD404`) then **not used**. Correction is temperature-only |
| Three-way match | Declared. No logic |
| Duplicate detection | Declared. No logic. No unique constraint on invoice number |
| SOX controls | Documented in section 9. **None enforced** |
| RBAC | Every grant includes pseudo-role `'any'`, 93 occurrences. Effectively open |
| Row-level security | Zero `where:` clauses. Attributes declared, unused |
| Scheduler | None. `derivation_schedule` and "daily sync" have no consumer |
| Config tables | `TOLERANCE_RULES`, `SOD_RULES`, `ALLOCATION_RULES`, `INTEGRATION_CONFIGS` populated and read by nothing |
| Effective dating | `valid_from`, `valid_to`, `priority` columns exist. No code resolves by date or priority |
| Aircraft register | **Does not exist.** `AIRCRAFT_MASTER` has key `type_code` — a *type* master. Individual aircraft are free-text strings |
| Error logs | `ERROR_LOGS` and `EXCEPTION_ITEMS` empty, never written |
| Concurrency | No ETags. Number generation is non-atomic `max + 1` |

---

## 3. Architecture

SAP CAP on Node.js, OData v4, `@sap/approuter`, HANA Cloud, XSUAA. Not ABAP — the equivalents are CDS entities in `db/schema.cds` under namespace `fuelsphere`.

```
db/
  schema.cds          97 entities, ~4400 lines
  data/               79 seed CSVs, semicolon-delimited,
                      named fuelsphere-<ENTITY>.csv
srv/
  *-service.cds       15 service definitions, ~185 projections
  *-service.js        6 implementations
  authorization.cds   @restrict grants
  config/             s4-sync-config.js
app/
  admin/ operations/ planning/ fulfillment/ invoicing/
  xs-app.json         approuter routes
docs/
  design/             governing documents
  as-built-baseline/  independent documentation of current code
```

**No database views exist.** What earlier documentation called CDS views are OData service projections.

**No secondary indexes are declared anywhere.**

---

## 4. The UI — BUILT, being replaced

Five hand-coded freestyle HTML and JavaScript apps under `app/*/webapp/`. **Not UI5, not Fiori Elements** — no `manifest.json`, no component, no semantic objects.

Four of five are read-only. Only Planning writes: a `PATCH` on flight schedule and two Excel imports. **Of roughly 250 declared OData actions, three imports and one PATCH are invoked.**

`$fiori-preview` generates list reports for around 40 entities, but annotations contain only `UI.LineItem` — no facets, header info or selection fields. Development flag, not routed.

Being rebuilt on Fiori Elements as a separate track. **Do not invest in the freestyle apps.**

---

## 5. Local development — BUILT

```bash
# Standard start (port 4004)
cds watch --port 4004

# Or npm script (rebuilds first)
npm run dev

# Production build
npm run build
```

### Test users (`.cdsrc.json`)

| User | Password | Roles | Attributes |
|---|---|---|---|
| alice | any | FullAdmin | station=*, region=* |
| kalpesh | any | FullAdmin | station=*, region=* |
| planner | any | FuelPlanner | — |
| ops | any | OperationsManager, StationCoordinator | station=MNL,CEB · region=APAC |
| finance | any | FinanceManager, FinanceController | — |
| analyst | any | Analyst | — |
| * | any | authenticated-user | — |

**Note:** the `ops` user's station and region attributes are declared but **not enforced** — there are no `where:` clauses. Testing with `ops` will not reveal row-level security problems.

### Testing URLs

```
http://localhost:4004                                   service index
http://localhost:4004/odata/v4/orders/$metadata         metadata
http://localhost:4004/odata/v4/orders/FuelOrders        entity data
http://localhost:4004/$fiori-preview/FuelOrderService/FuelOrders
```

---

## 6. Build and deploy — BUILT

```bash
npm install
npm run build
mbt build

cf login -a https://api.cf.<region>.hana.ondemand.com
cf deploy mta_archives/fuelsphere_1.0.0.mtar
```

### BTP services required

| Service | Plan | Resource | Purpose |
|---|---|---|---|
| SAP HANA Cloud | hdi-shared | fuelsphere-db | Database |
| XSUAA | application | fuelsphere-auth | Authentication |
| Destination | lite | fuelsphere-destination | S/4 connectivity |
| Application Logging | lite | fuelsphere-logging | Logs |

---

## 7. S/4HANA integration

### Destinations — DIVERGENT

| Documented | Reality |
|---|---|
| `S4HC_TECHNICAL` — OAuth2ClientCredentials, batch jobs | **Only `S2A` exists** |
| `S4HC_USER` — OAuth2SAMLBearerAssertion, user context | Not configured |

The two-destination split is a sound target design. It is not what is deployed.

### Communication scenarios — DESIGNED

| Scenario | Purpose |
|---|---|
| SAP_COM_0008 | Business Partner |
| SAP_COM_0009 | Product Master |
| SAP_COM_0028 | Journal Entry |
| SAP_COM_0053 | Purchase Contract |
| SAP_COM_0164 | Purchase Order |
| SAP_COM_0367 | Goods Receipt |

None configured. Master sync uses `S2A` directly.

---

## 8. Error codes

Two sets — designed and implemented. **Both are valid.** New validations take a code from the appropriate prefix.

### Implemented prefixes — BUILT

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

`SOD_RULES` is seeded with matching entries. **No check exists in any handler.**

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
                   Exception Queue
                          |
                Finance Manager Review
```

`InvoiceStatus` is missing the `Submitted` member this flow requires. Seed data contains `SUBMITTED`, correctly following the specification. **Add the enum member.**

### ROB calculation — DIVERGENT

```
ROB_current = ROB_previous + Uplift − Burn + Adjustment
```

**This is correct.** `burn-service.js:1145` computes `max(0, previous − burn)` — dropping uplift and adjustment, and clamping negatives. The running balance is wrong after every delivery.

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
| D1 | Master sync transaction wrapper commented out — data loss on mid-sync failure |
| D2 | `'any'` on 93 authorisation grants |
| D3 | ROB formula drops uplift, clamps negatives |
| D4 | Non-atomic `max + 1` number generation |
| D5 | No optimistic locking; status guards read-then-write |
| D11 | No aircraft register |
| D13 | `captureSignatures` has no order status guard |
| D14 | No row-level security |
| D15 | ROB ledger cannot be rebuilt; `recalculateROB` unimplemented |
| D16 | Hardcoded 100,000 kg order guard blocks legitimate widebody orders |

---

## 12. Traps

| Trap | Detail |
|---|---|
| **Two pricing families** | Singular (`PRICING_FORMULA`, `MARKET_INDEX`, `DERIVED_PRICE`, `PRICING_CONFIG`) and plural (`PRICING_FORMULAS`, `MARKET_INDICES`, `DERIVED_PRICES`, `PRICING_CONFIGURATIONS`). **Two services project the same name over different base tables.** Confirm which you are in before editing |
| **Enum casing is inconsistent by design** | `OrderStatus` uses `Draft`; `CrewReviewStatus` uses `PENDING`. **Do not normalise** — it breaks seed data and external callers |
| **Seed data follows the spec, code does not** | Where seed, this document and the code disagree, the code is usually the outlier. Check here before "fixing" data |
| **Declared is not implemented** | See section 2. An action with no handler fails silently |
| **Seed data is inadequate for testing** | 2 tickets, 3 deliveries, 4 burns, 7 orders. Being replaced from the design workbook's 151 scenarios |
| **`'XXX'` station fallback** | Number generation substitutes `XXX` when the station is missing, producing a valid-looking number with no traceable station |
| **Hardcoded thresholds implement documented rules** | −40/+50 °C and 0.775/0.840 kg/L are `EPD403` and `EPD404`. The rules are right; the values belong in `TOLERANCE_RULES` |

---

## 13. Rules of engagement

**Do not:**

- Rewrite an implemented handler. Extend it
- Change an entity or field name — embedded in ~185 projections and 79 seed files
- Normalise enum casing across modules
- Combine work packages in one branch
- Invent a decision. If `00-DECISIONS.md` is silent, stop and ask
- Assume a DESIGNED item works

**Always:**

- Commit schema changes separately from behaviour changes
- Assign an error code from section 8 to every new validation
- Add a seed scenario exercising any behavioural change
- Treat a derived value with a missing input as `null`, never `0`
- Record which configuration row produced a resolved value

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

### Node version

CAP supports Node 18, 20, 22. **Not Node 24.**

```bash
node --version
nvm use 20
npm rebuild        # after switching
```

### Fiori preview not loading

1. `curl http://localhost:4004`
2. Use VS Code Simple Browser, not an external browser in Codespaces
3. Clear cache
4. `pkill -f "cds watch" && cds watch`

### CSV loading

- Column headers must match CDS property names exactly
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

- **FuelSphere-UI** — Fiori applications, referenced as a separate repository. **Unverified.** An `app/` directory exists in this repository containing five freestyle apps, contradicting the "backend only" description. Confirm whether the separate repository exists before assuming UI work lives elsewhere

# 00-DECISIONS.md

**FuelSphere — merge decisions**
Status: **DECIDED** — Groups A, B, C and D closed. Groups G and F await confirmation. Items marked *Decided in design* were settled during the design work, before the as-built baseline was reviewed. They are carried forward unless the build gives cause to revisit — where it does, that is stated.

---

## How to use this file

Claude Code reads this as authoritative. Until the `Decision` column is filled, it is not.

For each item: read the two positions, accept or override the recommendation, and write the outcome in the `Decision` column. Where you override, add one line of reason — Claude Code will otherwise re-raise the question.

Items are grouped by what they block. **Group A must be closed before any code is written.**

---

## Group A — blocking: close before any code

### A1. May a fuel ticket exist without an order?

| | Position |
|---|---|
| Build | `FUEL_TICKETS.order` is `@mandatory`. Structurally impossible |
| Design | Must be possible. Stated as a mandatory implementation criterion |

**Recommendation: DESIGN.** Fuel is routinely delivered without an order in the system — verbal post-freeze top-ups, diversion uplifts at uncontracted stations, fuel delivered to a tail after the flight was reassigned. Under the build's constraint each is either unrecorded or given a fabricated order. Unrecorded fuel is money outside the system; a fabricated order corrupts order data permanently to satisfy a foreign key.

**Change required:** relax `FUEL_TICKETS.order` to optional; add `match_status`.

**Decision: DESIGN — decided in design.** Stated as mandatory implementation criterion MC-12. **Confirm you hold this knowing the build asserts the opposite structurally** (`@mandatory`), which makes it a schema change rather than a behaviour change.

---

### A2. Order and delivery unit of measure

| | Position |
|---|---|
| Build | `uom_code` defaults to `KG` on orders and tickets |
| Design | Purchase orders in litres, per the decision taken during design |

**Recommendation: DESIGN — litres.** Suppliers meter and invoice in volume. Ordering in mass then converting at invoice introduces a density assumption into the commercial document.

**Note:** planning remains in kilograms — the fuel plan is a mass calculation. The conversion sits between plan and order, using the resolved conversion density.

**Decision: LITRES — decided in design.** Your words: "Fuel and service PO are in liters." Planning stays in kilograms; the conversion sits between plan and order using specific gravity.

---

### A3. Over-delivery beyond tolerance

| | Position |
|---|---|
| Build | `validateDelivery` rejects quantity above `ordered × 1.05` |
| Design | Capture, flag `OVER_DELIVERED`, route to exception queue. Never block |

**Recommendation: DESIGN.** The fuel is already in the tanks. Refusing to record it is the same failure as refusing an unmatched ticket.

**Decision: DESIGN — decided in design.** Discrepancy is evaluated at order level and recorded, not blocked. The build blocks at `ordered × 1.05`, so this is a code change.

---

### A4. Behaviour when master data is missing

| | Position |
|---|---|
| Build | Proceeds silently. Airport lookup sets null; supplier, contract and product inserted unvalidated |
| Design | Proceeds, but the record is provisional and external commitment is gated |

**Recommendation: DESIGN.** Both continue rather than block, which is the right instinct. The difference is that the build continues invisibly, and a silent null in a fuel order becomes a real purchase order against the wrong party.

**Decision: DESIGN — decided in design.** Provisional lifecycle with gating at external commitment, covering both provisional tails and provisional suppliers at new stations.

---

### A5. Is a staging layer required on inbound feeds? *(build question E1)*

**Recommendation: YES, required.** Without it a malformed inbound record has two options — rejected silently, or corrupts the target. Neither is recoverable. Staging also answers a question the target cannot: did the feed arrive at all.

**Decision: YES — decided in design.** Staging with supersession, reversal detection, stale handling and divergence reporting was designed and accepted.

---

### A6. Should tolerance tables drive behaviour? *(build question E2)*

**Recommendation: YES.** `TOLERANCE_RULES` already exists, is seeded, and carries `valid_from`, `valid_to` and `priority`. The hardcoded literals (5/10/20, ±5%, 1.05) migrate into it. A tolerance retuned in March must not silently re-evaluate January's exceptions.

**Decision: YES — decided in design.** The parameter framework with scope resolution, effective dating and applied evidence was designed and accepted.

---

### A7. Is plan versioning in scope? *(build question E3)*

**Recommendation: YES, required.** A ticket must bind to the plan version it executed against, or variance analysis compares an uplift to a plan it never saw. `PLANNING_VERSION` already models it; `generateVersionId` and `copyToScenario` are unimplemented.

**Decision: YES — decided in design.** Plan versions are separate rows; tickets bind to the version executed against. Version gaps are flagged and applied, never held — your words: "flag a version gap but not hold it."

---

### A8. Is `'any'` on authorisation grants deliberate? *(build question E5)*

**Recommendation: NOT deliberate — close it.** The pseudo-role appears 93 times across 69 grants, which disables RBAC entirely. Combined with unauthenticated UI routes, the OData surface is effectively open. This is not a design question.

**Decision: CLOSE IT — not a design question.** 93 occurrences across 69 grants disables RBAC entirely. Combined with unauthenticated UI routes the OData surface is open. WP-02.

---

### A9. Master sync transaction wrapper *(build question E6)*

**Recommendation: RESTORE it.** The wrapper is commented out around a DELETE-then-INSERT full replace. A mid-sync failure loses the table. There is no compensating control.

**Decision: RESTORE.** Commented out around a DELETE-then-INSERT full replace. A mid-sync failure loses the table, with no compensating control. WP-01.

---

### A10. Which pricing family is canonical? *(build question E7)*

**Recommendation: KEEP THE PLURAL FAMILY.** `PRICING_FORMULAS`, `FORMULA_COMPONENTS`, `MARKET_INDICES`, `MARKET_INDEX_VALUES`, `DERIVED_PRICES`. Retire the singular family — it has no writer and is only read-projected by Planning.

**Also retire `PRICING_CONFIG` (singular)** in favour of `PRICING_CONFIGURATIONS`. The duplication extends to configuration, not just formulas.

**Decision: KEEP THE PLURAL FAMILY.** `PRICING_FORMULAS`, `FORMULA_COMPONENTS`, `MARKET_INDICES`, `MARKET_INDEX_VALUES`, `DERIVED_PRICES`, `PRICING_CONFIGURATIONS`. Retire the singular family and `PRICING_CONFIG` — no writer, only read-projected by Planning. WP-08.

---

## Group B — structural: close before schema work

### B1. Introduce an aircraft register

`AIRCRAFT_MASTER` has primary key `type_code` — it is a type master. Every individual aircraft is a free-text string.

**Recommendation: YES.** Add a registration entity beneath it. Without it there is no per-tail performance factor, no APU burn rate, no tank capacity per tail, and the ROB chain keys on an unvalidated string. A large part of the intended behaviour sits on top of this.

Rename or re-document `AIRCRAFT_MASTER` as the type master; do not repurpose it.

**Decision: YES — decided in design.** The design carries a full aircraft register with three-stage lifecycle. The build finding is that none exists, so this is new construction rather than a change of position.

---

### B2. Order, delivery and ticket — three entities or two?

**Decision: THREE ENTITIES. Existing name `FUEL_DELIVERIES` retained.**

#### Why three

There are **two independent measurements**, taken by different instruments at different granularity:

| Measurement | Instrument | Granularity |
|---|---|---|
| Volume | Bowser meter | **Per bowser** |
| Mass | Aircraft FQIS | **Per refuelling** |

A widebody uplift with two bowsers has one FQIS pair spanning both tickets. It cannot sit on either ticket, and it cannot sit on the order because a later top-up is a separate refuelling with its own pair.

Parallel bowsers make this structural rather than merely convenient — two trucks pumping simultaneously into one manifold produce no per-bowser mass figure and never can.

`FUEL_DELIVERIES` is therefore **the refuelling event**: the thing the FQIS pair belongs to.

> The name is retained despite describing the supplier's action rather than the aircraft's, because renaming would touch 79 seed files, roughly 185 projections and the `EPD-` number range. Section 6 of `05-CONVENTIONS.md` prohibits entity renaming. Read `FUEL_DELIVERIES` as *refuelling event*.

#### Structure

```
FUEL_DELIVERIES                    registration + time window
     │                             FQIS pair, refuelling window
     └─* FUEL_TICKETS              meter, litres, density — one per bowser
              │
              └─ order (FK, nullable)
```

**The delivery hangs off the aircraft, not the order.** It keys on registration plus time window.

**Orders link transitively, through the ticket.** No direct FK in either direction, because the relationship is many-to-many both ways:

| Case | Shape |
|---|---|
| Two suppliers fuelling one aircraft together | Two orders, **one** delivery, two tickets |
| Initial uplift then a top-up after re-plan | **One** order, two deliveries |

A direct FK would break one of those.

Resolution is a distinct select over the ticket table in either direction. A denormalised order reference may be held on the delivery for screens, **derived and read-only, never authoritative**.

#### Creation

**Created by the first ticket for that tail**, not by a status change.

The build creates it at `startDelivery`, which is a status transition rather than a physical event. The row then exists before any fuel moves and orphans if fuelling never happens.

```
ticket arrives
  → open delivery for this registration within the window?
      yes → attach
      no  → create, attach
```

FQIS readings enrich the delivery whenever they arrive, which is typically after the ticket.

#### Authority

| Value | Source |
|---|---|
| Volume delivered | **Sum of ticket litres.** The only volume measurement that exists |
| Mass billed | Sum of ticket litres × delivered density |
| Mass received | FQIS delta on the delivery |
| Order fulfilment | Sum of tickets against ordered quantity |
| Delivery reconciliation | Mass billed against mass received |

`delivered_quantity` on `FUEL_DELIVERIES` becomes **derived, not keyed** — consistent with the rule that totals sum from their children. The build stores it and never aggregates ticket quantity; that inverts.

#### Units

| Layer | Unit |
|---|---|
| Fuel plan | Kilograms |
| Order | **Litres**, converted from the plan using conversion density |
| Delivery and ticket | **Litres**, as metered |
| Burn and ROB | Kilograms |

Everything is currently in kilograms, including the ticket — which records a calculation as if it were a measurement. Density is captured and unused, and temperature correction is applied to a mass figure, which is physically meaningless since thermal expansion acts on volume.

#### Multi-supplier deliveries

One FQIS pair, two suppliers, one variance figure. **Variance is not attributable.**

| Rule | |
|---|---|
| Variance computed | At delivery level, always |
| Attribution to a supplier | Requires `supplier_count = 1` |
| Multi-supplier variance | Recorded, never disputed |
| Bowser and supplier bias analysis | **Excludes** multi-supplier deliveries |

Pro-rata allocation by volume is arithmetically neat and evidentially worthless. Do not use it to raise a dispute.

#### Validation that must not be written

**Do not require ticket B to start after ticket A ends.** Parallel bowsers are legitimate on widebodies. Enforcing sequence fails every two-bowser turn.

#### A third location for fuel quantities

`FLIGHT_CYCLE_EVENTS` carries `uplift_kg`, `density_kg_l`, `temperature_c`, `bowser_id` and `sequence_number` against a `REFUELING` event type. Three places holding fuel quantities is one too many.

**Strip fuel fields from `FLIGHT_CYCLE_EVENTS`**, leaving it a movement event log.

#### Open within this decision

| # | Question | Status |
|---|---|---|
| — | Where the ePOD signature belongs — per ticket or per delivery | **Parked as F3.** Signatures remain on `FUEL_DELIVERIES` until confirmed |
| — | How long a delivery stays open before a new ticket opens a fresh one | **Parked as F2.** Two hours as a starting parameter |

### B3. Extend `FLIGHT_DISPATCH` to the regulated fuel stack

Currently a single `dispatch_qty_kg`. No trip, contingency, alternate, reserve, taxi or extra. No version.

**Recommendation: YES.** The stack is a regulatory requirement and the basis of every fuel variance. Without it the plan cannot be compared to anything meaningful.

**Decision: YES — decided in design.** Seven components: trip, contingency, alternate, final reserve, additional, taxi, extra. Additional and extra held separately.

---

### B4. Fuel accounting model

**Decision: INVENTORY BY TAIL — decided in design, and confirmed.** Stations map to SAP plants, tails are valuation types under split valuation, goods issue to expense per leg.

**An earlier recommendation in this document argued for expense-on-uplift in the first release. That recommendation is withdrawn.** It was wrong on two counts.

#### Why expense-on-uplift fails

It does not merely make tankering benefit invisible — it **corrupts route-level cost**.

A321, MNL–SIN–MNL. Fuel $0.65/L at MNL, $0.80/L at SIN. Each sector burns 10,500 L. Tankering: 21,000 L uplifted at MNL, 1,000 L at SIN.

| Method | MNL–SIN charged | SIN–MNL charged |
|---|---|---|
| Expense on uplift | $13,650 | $800 |
| Inventory by tail | $6,825 | $6,962 |

Same flights, same fuel burned. Expense-on-uplift charges the outbound sector seventeen times the inbound.

Every route profitability figure and every cost-per-sector efficiency metric derived from it is wrong. The tankering decision becomes unmeasurable, because the saving is smeared across two routes and possibly two periods.

Under inventory, the moving average price on the tail carries the cheap fuel forward. The inbound sector is charged $6,962 rather than the $8,400 that SIN fuel would have cost — **$1,438 of saving, visible, on the leg that benefited.**

Tankering is routine fuel efficiency practice, not an edge case.

#### The burn data risk, reframed

The original concern was that incomplete burn capture produces inventory differences at period close. It does. But:

| Model | Effect of incomplete burn |
|---|---|
| Inventory by tail | No goods issue posts, stock overstates physical fuel on board, and the difference surfaces at close as a number finance must explain |
| Expense on uplift | Nothing surfaces. The books balance while route costs are wrong |

A visible, chaseable difference is better than an invisible, misleading figure — and the difference **is** the burn capture gap, expressed where it will actually get attention.

**This is a process maturity issue at the airline, not a reason to weaken the design.** Surfacing it is the correct behaviour.

`TAIL_STOCK_RECON` already provides the control: the difference decomposes into timing versus unexplained, measured at each tail's last on-blocks before period end.

#### Product position

Fuel is roughly 30% of an airline's operating cost. Expensing actual burn per leg is the basis of every fuel efficiency and route profitability conversation. A product that cannot do it does not compete.

`FUEL_ACCOUNTING_MODEL` remains a parameter, but:

- **`INVENTORY_BY_TAIL` is the default and the recommended model**
- **`EXPENSE_ON_UPLIFT` is a transitional mode** for carriers with no usable burn feed, positioned as a migration step rather than an equivalent option

**Decision: INVENTORY_BY_TAIL, default. Confirmed.**

### B5. Add meter and aircraft gauge capture

Only `delivered_quantity` exists. No meter-versus-gauge pair, so no delivery reconciliation is possible.

**Recommendation: YES.** This is the basis of the FOB reconciliation control.

**Decision: YES — decided in design.** Both measurement systems captured; the gap between them is the FOB reconciliation control.

---

### B6. Density as a load-bearing field

`calculateTemperatureCorrection` requires density (`EPD404`) and then ignores it. No mass-volume conversion is performed anywhere.

**Recommendation: YES — make it load-bearing.** With orders in litres and planning in kilograms, density is the conversion. Move the hardcoded 0.775–0.840 bounds into configuration.

**Decision: YES — decided in design.** Orders are placed in litres converted from kilograms using specific gravity, so density is the conversion. Delivered density is authoritative.

---

### B8. Negative closing balance on the fuel ledger

`db/schema.cds:2014` carries `@assert.range: [0, null]` on `closing_rob_kg` — a database constraint forbidding a negative closing balance. The `max(0, ...)` clamp at `burn-service.js:1145` may exist to satisfy it.

The tension: a correctly computed balance **can** go negative, and that is precisely the signal that an event is missing or mis-sequenced. But the assertion rejects the insert, so the record never lands and the problem stays invisible.

**Decision: keep the assertion. Raise an error instead of writing the row.**

```
computed closing = opening + uplift − burn + adjustment

  ≥ 0   → write the ledger row, chain intact
  < 0   → no ledger row written
          raise FB402 carrying the computed negative value
          record the chain as broken from this point
```

**Why not the alternatives.** Removing the assertion would let incorrect data persist and weaken a statement that is physically true — a fuel balance cannot be negative. Clamping to zero and flagging separately leaves a wrong number in the ledger while the exception sits elsewhere.

The error **is** the finding. `FB402` carrying `computed = −340 kg` states exactly what happened: the chain does not balance by 340 kg, so an event is missing or out of sequence.

**Exception payload:** tail, sequence, opening, uplift, burn, adjustment, computed closing, and references to the source burn and delivery events.

**Where it lands — AMENDED 16 Aug 2026 after WP-03 measurement.** The original text named `FUEL_BURN_EXCEPTIONS`, with `ERROR_LOGS` as an alternative. **Neither fits.**

`FUEL_BURN_EXCEPTIONS` carries burn-variance semantics — actual minus planned burn. Six of the nine required fields have nowhere to go, and `aircraft` and `variance_pct` are `@mandatory`. Writing a ledger imbalance into `variance_kg` would inject a wrong number into a different investigation queue.

`ERROR_LOGS` and `EXCEPTION_ITEMS` are integration-monitoring shaped, with `integration_name`, `source_system` and `target_system` all `@mandatory`. A ledger chain break is neither an integration message nor a retryable transfer.

**A second obstacle.** Raising `FB402` fails the request, and CAP rolls the request transaction back. An exception row written in the same handler rolls back with it. Persisting the record while still failing the request requires an independent root transaction — `cds.tx()` **without** `req`, which is distinct from the `cds.tx(req, …)` nesting trap measured under WP-01.

**Interim position.** The chain break is visible in the `FB402` response, which carries the computed negative value and all four inputs, and in the absence of a ledger row. There is no durable queue. That is accepted for now.

**The durable record is deferred to open point F14.** It needs a purpose-built entity and a transaction design, settled together.

#### Subsequent entries are not blocked

**Decision: subsequent fuel events for that tail continue to be recorded.**

A broken chain must not stop the airline operating. The next entry restarts from the reported fuel on board, and the gap is recorded rather than propagated.

`recalculateROB` becomes the repair tool: add the missing event, rebuild the chain, and the exception clears.

> **Open point F11 — chain recovery mechanics.** How the restart is represented is not yet designed. Options include an explicit `ADJUSTMENT` entry closing the gap, an entry typed `CHAIN_RESTART`, or an opening balance flagged as unverified. Each has consequences for ledger closure reporting and for whether the gap is later reconcilable. Deferred; WP-03 raises the exception and permits continuation without deciding the representation.

**Decision: keep the assertion, raise FB402, allow subsequent entries. Confirmed.**

---

### B7. Enforce flight status as an enum

Currently free `String(20)` with a comment listing values.

**Recommendation: YES.** Adopt the comment's values, with one change: split `RETURNED` into ramp return and air return. Only one of them can take fuel, and the distinction drives the whole return-handling path.

**Decision: YES — decided in design.** Including the split of RETURNED into ramp return and air return.

---

## Group C — scope: close before planning

### C1. Activate the modelled-but-unbuilt modules

Nine services are declarations only. Their data models exist and are seeded.

| Module | Recommendation |
|---|---|
| Invoice | **In scope.** Core to the fuel lifecycle |
| Pricing | **In scope.** Core |
| Allocation and accruals | **In scope.** `ACCRUAL_ENTRIES` is well modelled and closes a design gap |
| Contracts | **In scope.** Volume commitment data already present |
| Compliance and sanctions | **Decide.** Genuine regulatory obligation, absent from the design, and a real scope addition |
| Analytics | **Later.** Dashboard needs the data layer first |
| Security and SoD | **Partially.** Close the `'any'` hole and add row-level security now; access review campaigns later |
| Integration | **Later.** Depends on real outbound integration existing |
| Admin | **Later** |
| Planning and demand | **Decide.** Closes design gap G1, but is a module in its own right |

**Decision:**

| Module | Verdict |
|---|---|
| Invoice, Pricing, Allocation and accruals, Contracts | **In scope.** Core to the fuel lifecycle |
| Security — close `'any'`, add row-level security | **In scope now.** Access review campaigns later |
| Compliance and sanctions | **Backlog.** Real obligation, but a module in its own right and not on the critical path |
| Planning and demand | **Backlog.** Closes gap G1 and the physical exposure output, but is its own module |
| Analytics, Integration, Admin | **Backlog.** All depend on the data layer being real first |

---

### C2. Keep the supplier-facing capability?

`RefuelerService` is implemented (235 lines) with a working sales order lifecycle, plus `FUEL_SALES_ORDERS`. Absent from the design entirely.

**Recommendation: KEEP, but confirm the intent.** This implies a supplier or into-plane agent portal. If that is the product direction it is valuable; if it was exploratory it is maintenance burden on an unused path.

**Decision: KEEP, do not extend.** `RefuelerService` is implemented and works. Leave it in place, add nothing, revisit when the product direction on a supplier portal is settled. Parked as F10.

---

### C3. Row-level security by company code, plant and cost centre

Attributes are declared in the security model and never used. Zero `where:` clauses.

**Recommendation: YES, implement.** For a product serving multiple airlines, and for company code separation within one airline, this matters more than the `'any'` grants.

**Decision: YES.** For a product serving multiple airlines, and for company code separation within one airline, this matters more than the `'any'` grants. WP-14.

---

### C4. UI technology

Five freestyle apps, four read-only, three of roughly 250 actions wired. Fiori Elements annotations are `UI.LineItem` only — scaffolding, not implementation.

**Recommendation: FIORI ELEMENTS for the bulk, freestyle for four named exceptions** — plan version comparison, AI analysis workbench, cascade reprocess, ledger chain view.

The design's universal requirements — variants, personalisation, export, growing, empty states, message handling — are free in Fiori Elements and expensive by hand across 88 screens.

There is no sunk cost either way. This is a clean choice.

**Decision: FIORI ELEMENTS for the bulk; freestyle for four named exceptions** — plan version comparison, AI analysis workbench, cascade reprocess, ledger chain view. No sunk cost either way: the freestyle apps are read-only demonstrations and the Fiori annotations are `UI.LineItem` scaffolding only. Runs as a parallel track from Phase 1. WP-30.

---

### C5. Concurrency control

No ETags, no version tokens. Status guards are read-then-write. Number generation is non-atomic `max + 1`.

**Recommendation: YES, add.** `@odata.etag` on transactional entities; replace `max + 1` with a database sequence or CAP number range.

**Decision: YES.** `@odata.etag` on transactional entities; replace `max + 1` with a database sequence or CAP number range. WP-04.

---

## Group D — conventions: adopt the build's, unless there is reason not to

These need confirming rather than deciding. All recommend the build.

| # | Item | Recommendation |
|---|---|---|
| D1 | **Error code taxonomy** — `FB4xx`, `EPD4xx`, `IMP4xx`, `ENR4xx`, `DSP4xx` | **Adopt and extend.** The design has 187 validation rules and no identifiers. This is the build closing a design weakness |
| D2 | **Number range formats** — `FO-{station}-{YYYYMMDD}-{NNN}`, `EPD-…`, `FT-…` | **Adopt.** Fix generation per C5. Widen the sequence beyond three digits |
| D3 | **Order lifecycle state machine** — Created → Submitted → Confirmed → InProgress → Delivered | **Adopt**, with two fixes: rename `Created` to match the enum, and add the missing status guard on `captureSignatures` |
| D4 | **Tolerance rule flags** — `block_on_exceed`, `require_dual_approval` on the rule | **Adopt.** Cleaner than the design's approach of handling these separately |
| D5 | **Effective dating and priority columns** | **Adopt.** Already present; add the resolution logic and the applied-evidence record |
| D6 | **Entity naming** — `UPPER_SNAKE_CASE` in the `fuelsphere` namespace | **Adopt.** New entities follow the same convention |
| D7 | **Crew review workflow** on the order | **Adopt.** Better shape than the design's treatment of commander's fuel as a plan field |
| D8 | **Ingest idempotency** by `source_message_id` | **Adopt**, alongside staging supersession. Complementary controls |
| D9 | **Empty-response sync guard** | **Adopt and generalise** to every full-replace feed |
| D10 | **Seed data** — replace the 79 CSVs with the design workbook's 151 scenarios | **Adopt.** The current seed cannot validate anything: 2 tickets, 3 deliveries, 4 burns, both error tables empty |

**Decision on Group D as a whole: ADOPT ALL TEN.** Every one closes a weakness in the design or preserves working behaviour in the build.

---

## Group G — IATA standards disposition

Seventy-five mappings are catalogued in the `IATA_STANDARDS_MAP` sheet. This is the scope decision on which to act.

**Sources**

| Document | Where obtained |
|---|---|
| Fuel Data Standards — Tender/Bid, Operational (AIDX), Transaction, Invoice, Code Directory v3.2.3, Environmental Standard v3.3.0 | `https://www.iata.org/en/programs/ops-infra/fuel/data-standards/` — free on form; `fdsg@iata.org` |
| Aviation Fuel Supply Model Agreement, edition 5.1, July 2023 | `https://www.iata.org/contentassets/ebdba50e57194019930d72722413edd4/afsma-ed-5.1-july-2023f.pdf` |
| IATA Fuel programme index | `https://www.iata.org/en/programs/ops-infra/fuel/` |
| AIDX implementation guide and fuel addendum | Per download; URL not independently verified |

### G1 — Adopt now

Code values only. No structural change, no new entities. These make interfaces map cleanly and cost almost nothing.

| # | Item | Standard element | Values |
|---|---|---|---|
| IATA-01 | Density basis | `DensityType` | MEA, STD |
| IATA-02 | Delivery method | `FuelingType` | HYD, REF |
| IATA-03 | Fuel operation | `FuelOperationBase` | DF, F |
| IATA-04 | Ticket source | `TicketSource` | M, E |
| IATA-05 | Price status | `TicketStatus` | P, F |
| IATA-06 | Tolerance basis | `TolerenceLevelType` | P, Q |
| IATA-07 | Tax applicability by flight nature | `VATApplicability` | NA, DOM, INT, ANY |
| IATA-08 | Into-plane service level | `ServiceLevel` | IT1, IT2, IT3, IT4 |
| IATA-09 | Fuel grade | `ProductCode` | JETA1, JETA, JAA, JP4, JP5, JP8, TS1, A1BIO, SAF, NON, OTH |
| IATA-10 | Fuel specification | `ProductQualityStandard` | ASTM D1655, ASTM D7566, DefStan 91-091, EI/JIG 1530, EI 1533 |
| IATA-11 | Condition operators | `LogicalOperator` | EQ, LE, LT, GE, GT, NE, IN |
| IATA-12 | **Quantity basis — new field** | `QuantityFlag` | GR, NT. Net is temperature-corrected; gross is not. One field, and without it no quantity states its basis |
| IATA-13 | Quantity type | `QuantityType` | DL, IN |
| IATA-14 | Quantity units | `PUOMBase` | BBL, CAN, M3, DR, EA, HL, HR, KG, KL, LT, MT, PCT, LB, USG |
| IATA-15 | Temperature unit | `TUOM` | C, F |
| IATA-16 | Party roles | `SupplierOROwnerCode`, `IntoPlaneCode`, `BuyerCode`, `ReceiverCode` | Four distinct parties on one transaction |
| IATA-17 | Index provider and assessment | `IndexProvider`, `IndexCode` | 5 providers, 233 assessment codes. Ready-made master data |
| IATA-18 | Tax taxonomy | `TaxTypeBase`, `TaxCategoryBase` | 29 tax types; L, H, S, Z |
| IATA-19 | Averaging offset | `AveragingOffset` | N+0, N-1, N-2, N+1 |
| IATA-20 | Order state | `FuelOrderStateType` | preliminary, final |
| IATA-21 | Rate type | `SubItemPricingUnitRateType` | UR, FF, P |

**Decision on G1: _______________**

### G2 — Backlog, needs design work

Material, but none is on the critical path and none can be designed today.

| # | Item | Why it matters | Where it lands |
|---|---|---|---|
| IATA-30 | `FuelOrderMode: uplift, onboard` | An order may state the quantity to uplift or the quantity to be on board at departure. Onboard is self-correcting when arrival fuel differs | Order design |
| IATA-31 | Invoice four levels — Invoice, SubInvoice, Line, SubItem | SubInvoice groups by ticket, which is the level three-way matching needs | Invoice design |
| IATA-32 | `CurrencyConversion` with mechanism and factors | Direction plus multiplication factors for low-value currencies, at five levels including tax | Multi-currency work |
| IATA-33 | Pricing, invoice and delivery UOM each with a factor | All three may differ; a rate per hectolitre on a litre delivery is representable two ways | Pricing |
| IATA-34 | `AveragingMethod`, 18 values, calendar versus trading day | Trading days exclude non-publication days. The design has five rules | Pricing |
| IATA-35 | `TicketType` O/R/C/D with `PreviousTicketNumber`, `PreviousITPDate` | Ticket amendment lifecycle. The design has none. **Note:** the schema documents three values — Original, Reissue, Cancel — but enumerates four. The meaning of D is not stated | Ticket design |
| IATA-36 | `TankMeasurements` per `AircraftTankID` | Per-tank distribution is real at service level IT3 | Delivery design |
| IATA-37 | `ActivityType: Nofuelling` | Makes no-uplift-expected an explicit transmitted value rather than inferred from a zero | Completeness |
| IATA-38 | `FlowInterruption` / `FlowRestart` | Interrupted fuelling transmitted as data, not inferred from ticket gaps | Delivery design |
| IATA-39 | `VehiclesOrderedQty`, `TruckOnStandby` | Multi-vehicle fuelling known at order time. Bears on the event window rule, F2 | Delivery design |
| IATA-40 | `DisputeLevel` Header / LineItem / LineItemDetail | Three dispute levels; the design assumes line only | Dispute lifecycle |
| IATA-41 | SAF certification, feedstock, `EnvironmentalDocType` POS/POC/PTD/BOL | SAF compliance needs documents and certification, not a blend percentage | Emissions |
| IATA-42 | `MessageStatus` RC/PR/RD/ER, `Acknowledgement`, **`StatusCode` 1–10 (was IATA-69)** | The design has staging status but sends nothing back to the sender. StatusCode is the receipt acknowledgement code; the schema documents it as open-ended and refers to a table not reproduced in the XSD | Interfaces |
| IATA-43 | Transmission header and summary control totals | Validates the whole document, not only its records | Interfaces |
| IATA-44 | `PaymentTermsDateBasis` ID/FD/LD/MD | Terms measured from invoice date, first day, last day or month end | Contract master |
| IATA-45 | SAF invoicing — two supplier methods | Separate product line, or one line with a description. A consuming system must handle both | Invoice |

**Decision on G2: AGREED.** Backlog. None on the critical path. IATA-30, 31 and 32 are candidates for early promotion once Phase 0 is complete, because each is cheaper to build than to retrofit.

### G3 — Not important, with reason

| # | Item | Reason |
|---|---|---|
| IATA-60 | `BMTransaction`, bulk movement, 26 codes | Only relevant with airline-operated storage, which is not in scope |
| IATA-61 | `AirportCode`, 9,963 values | Station master comes from the airline's own network, not a shipped enumeration |
| IATA-62 | `ReceiverCode`, 2,637 values | Airline codes come from the carrier master |
| IATA-63 | `Context` document types | Internal naming only; no interface benefit |
| IATA-64 | `OffAirportLocation` | Single placeholder value for an out-of-scope case |
| IATA-65 | `FuelingEventsType` | Single value `XXX`; a placeholder in the standard itself |
| IATA-66 | `TenderType`, `VolumeOfferType`, `RestrictionScope` | Tender execution is out of scope by decision |
| IATA-67 | `FrequencyBase` | Contract frequency; arrives with the contract master, not before |
| IATA-68 | `FinancialSource`, 49 values | FX rate source; arrives with multi-currency, IATA-32 |

**Decision on G3: AGREED.** Not pursued. IATA-69 reclassified into G2 under IATA-42, since it is part of the acknowledgement mechanism rather than a standalone code list.

---

## Group F — parked for later review

Raised and deliberately deferred. Not blocking.

| # | Item | Context | Revisit when |
|---|---|---|---|
| F1 | **Flight number on the supplier ticket feed** | Where a supplier transmits a flight number on the ticket, it can disagree with the flight resolved through the order — after a tail swap, or on a transcription error. Comparing the two would catch fuel delivered against the wrong order, which is otherwise invisible until invoice matching. Not needed now: the refuelling event is created from a ticket already matched to an order, so the flight resolves down that path with nothing to compare against | An electronic supplier ticket feed carrying a flight number is introduced |
| F2 | **Refuelling event window duration** | How long an event stays open before a new ticket opens a fresh one. Too short and a slow two-bowser uplift splits, breaking the FQIS pairing. Too long and a genuine top-up merges into the original. Suggested starting point two hours, as a parameter | Real turnaround data is available to calibrate against |
| F3 | **Where the ePOD signature belongs** | Per ticket where each fueller signs their own, or per delivery where the crew signs one consolidated document at the end. **Partial evidence for per ticket:** IATA service level guidance places the receipt with the fuelling operative — "provide fuel delivery receipt to representative for signature prior to aircraft departure" is listed as a duty of the person operating the fuel vehicle, implying one receipt per vehicle. Not conclusive for multi-bowser turns | Confirmed with the airline, or resolved from the IATA Transaction standard — see F9 |
| F9 | **Obtain the IATA Fuel Data Standards** | Four free XML standards covering the exact lifecycle: Tender/Bid, Operational (preliminary through revised and final order, concluding with a Fuel Summary), Transaction (electronic fuel transaction settlement), Invoice. **The Transaction standard is the industry schema for the fuel ticket** and would settle F3, the delivery-versus-ticket structure and the field set from the industry's own definition rather than inference. Broad supplier adoption including Shell Aviation, Air bp, ENOC, Q8, Neste, Singapore Petroleum; airline adoption including Lufthansa, British Airways, Emirates, Singapore Airlines, Cathay Pacific, Qatar. Note the Operational standard's shape — preliminary, revised, final, summary — is order versioning independently arrived at | **Now.** Free download at iata.org/en/programs/ops-infra/fuel/data-standards, contact fdsg@iata.org |
| F4 | **FQIS source and confidence on the event** | Without ACARS, fuel on board is crew-reported and typically rounded to 100 kg, which is 0.9% of a narrowbody uplift and 25% of a small top-up. Reconciliation tolerance should resolve partly from the source, and missing readings must read as NOT_RECONCILED rather than PASS | ACARS coverage per fleet is known, and it is confirmed whether crew record fuel on board at refuelling at all |
| F5 | **Into-plane pricing models** | Per litre at station level today. Volume-banded, per turn, aircraft-size and out-of-hours models are not supported | Contract terms across stations are known |
| F6 | **Dispatch plan version gap rate** | Push-on-change with latest-only emission is confirmed. Gaps still occur under push. Whether a gap is a defect to chase or normal attrition determines how versions_skipped is interpreted | Observed gap rates are available |
| F7 | **Aircraft type structure for a product** | Four code schemes plus a separate configuration table, or a flatter shape with alias resolution alone. Current design favours correctness of parameter resolution over setup simplicity | Two or three implementations have been observed |
| **F16** | **Validation guards should flag, not early-return** | WP-05 measurement: the removed 100,000 kg guard used `req.error` followed by `return`, and the return also skipped the `total_amount` calculation further down the handler. An over-threshold order ended up with **neither a quantity nor a total** — the guard silently suppressed a derived value as a side effect of blocking the write, with no indication why. When WP-13 introduces configurable thresholds, prefer flagging the record and continuing so derived values still populate. Applies to any guard that sits above a derivation in the same handler | WP-13, tolerance configuration. Review other early-return guards for the same pattern |
| **F13** | **Master data sync safety outside a request context** | WP-01 measurement established that CAP's ambient request transaction makes the full-replace sync atomic **on the request path**. `_syncFromS4` has no equivalent protection if called with no ambient transaction. No scheduler exists today, but `CLAUDE.md` and `PRICING_CONFIGURATIONS.derivation_schedule` both imply one is intended. At that point the original D1 risk becomes real, and whoever adds the scheduler will not know. Note that F12 (upsert) would remove the exposure entirely by eliminating the delete-then-insert window | **Before any scheduler or background job is added.** Whichever work package introduces one must handle this, or it reintroduces D1 |
| **F12** | **Master data sync — replace full delete-and-insert with upsert. HIGH PRIORITY** | **Note from WP-01 measurement:** `s4-sync-config.js:117-130` holds a commented-out `SuppliersVendor` feed targeting the same table as `Suppliers`, with an in-file warning that full replace deletes all supplier records first. Under full-replace semantics two feeds against one table cannot coexist — the second wipes the first. Upsert removes that constraint, so enabling `SuppliersVendor` is gated on this item. The S/4 master data sync deletes the entire table and reinserts. WP-01 restores the transaction wrapper, which removes the data-loss risk, but the pattern remains wrong. Upsert is better on every dimension: the table is never empty, a failure affects one row rather than all, audit history survives, and what changed is visible. **The blocking question is not technical.** When S/4 stops sending a supplier, what happens to the fuel tickets and orders that already reference it? Three options — mark inactive and continue resolving on existing transactions; mark inactive and block new use; or delete and orphan the references. Each also needs a stable business key per entity to match on, and a delete indicator field, which is a schema change | **Before any further master data work.** Raise as a Phase 1 work package. Requires a product decision on the inactive-record question, not only a code change |
| F11 | **Fuel ledger chain recovery** | When a computed closing balance goes negative, the row is not written and FB402 is raised, but subsequent entries continue. How the restart is represented is undesigned — an explicit ADJUSTMENT closing the gap, a CHAIN_RESTART entry type, or an opening balance flagged unverified. Affects ledger closure reporting and whether the gap remains reconcilable later | Ledger closure is designed, WP-17 |
| F10 | **Supplier-facing portal direction** | `RefuelerService` is implemented with a working sales order lifecycle, plus `FUEL_SALES_ORDERS`. Whether this is product direction or exploratory determines if it is maintained or retired | Product direction on a supplier or into-plane portal is settled |
| F8 | **Mandatory criteria renumbering** | The MC series carries suffixed codes — MC-01a, MC-06a, MC-09a, MC-09b — from later additions. Reads as a drafting artefact | Before the specification goes to anyone external |

### Correction arising from research: what an ePOD signature means

IATA's Aviation Fuel Supply Model Agreement states plainly:

> In no event is a waiver of the right to claim made or implied by a signature or any other statement on the Delivery Note.

**The signature is proof that delivery occurred. It is not acceptance of quantity.** Earlier framing in this document described the signature as the point of agreement between the parties. That is wrong.

Two consequences:

**A signed ticket may still be disputed.** Nothing in the design should treat signature as closing a quantity question, or suppress a reconciliation exception because an ePOD exists.

**Claim windows are contractual deadlines, not backlog ageing.** The model agreement requires short delivery to be notified at the time of delivery, followed by a written claim within **15 days**; quality defects within **30 days**. After that the right to claim is waived.

Neither design treats these as deadlines. A ticket with an unresolved quantity variance approaching day 15 is not an ageing exception — it is a right about to expire. Recommend:

- `claim_deadline_date` derived on the ticket from the delivery date and the contract's notification window
- Dispute ageing measured against that deadline, not against an arbitrary threshold
- Escalation before expiry, not after
- The window itself resolved from the contract, since it is negotiable and the model agreement is only a starting point

**This is a design gap on both sides**, not a merge decision. It should become a work package.

---

## Group E — prerequisites not requiring a decision

Do these regardless.

| # | Item |
|---|---|
| E1 | **Correct `CLAUDE.md`.** It is inaccurate in at least eight places and Claude Code reads it as standing context every session. An uncorrected file means every session starts from a false premise |
| E2 | Verify the `SCHEMA.md` §5 versus §3 contradiction on `ROB_LEDGER` associations to `FUEL_BURNS` and `FUEL_DELIVERIES` |
| E3 | Confirm whether a separate `FuelSphere-UI` repository exists and what it contains |

---

## Defects — no decision needed, only sequencing

| # | Defect | Blocking |
|---|---|---|
| **D21** | **`aircraft_ID` written to `ROB_LEDGER` on two paths where no such element exists.** `burn-service.js:479` (`adjustROB`) and `:1071` (Excel ROB import). The association flattens to `aircraft_type_code`, so the aircraft reference is silently never set on rows created by those paths. Found during WP-03, outside its scope | |
| D20 | A malformed S/4 response is reported as "0 records" rather than as a parse failure. Data-safe; the zero-row guard fires and no delete occurs. But an unrecognised payload is indistinguishable from an empty source, so a schema change at the S/4 end would be diagnosed as a data problem. Found during WP-01 measurement, outside its scope. Small — carry it with F12 or F13 | |
| ~~D1~~ | **WITHDRAWN.** Measured under WP-01, 16 Aug 2026. CAP's ambient request transaction already makes delete and insert atomic; the commented-out wrapper was redundant, and restoring it silently discards writes while returning success. Nine of nine scenarios pass on unmodified code, verified on both in-memory and file-backed sqlite. Residual risk moved to open point F13 | — |
| D2 | `'any'` on 93 authorisation grants | **Yes** |
| D3 | ROB formula drops uplift and clamps negatives | **Yes** |
| D4 | Non-atomic `max + 1` number generation | **Yes** |
| D5 | No optimistic locking | **Yes** |
| D6 | Duplicate pricing entity families and config tables | |
| D7 | Order status enum drift across enum, code and seed | |
| D8 | `temperature_corrected_qty` implies density correction | |
| D9 | Simulated S/4 document numbers | |
| D10 | `planned_burn_kg` hardcoded to zero — ACARS reconciliation inert | |
| D11 | No aircraft register | **Yes** |
| D12 | Density required then ignored | |
| D13 | `captureSignatures` has no order status guard | **Yes** |
| D14 | No row-level security | **Yes** |
| D15 | ROB ledger cannot be rebuilt | **Yes** |
| D16 | 100,000 kg order guard blocks legitimate widebody orders | **Yes** |
| D17 | `'XXX'` fallback station code in number generation | |
| D18 | Flight status is unenforced free text | |

---

## Sign-off

| Role | Name | Date |
|---|---|---|
| Solution architect | Ajesh | 2026-08-16 |
| Product owner | Deferred to Phase 1 | — |
| Delivery lead | Deferred to Phase 1 | — |

**Phase 0 authorised.** Groups A, B, C, D, G2 and G3 are closed. WP-01 to WP-06 are defect fixes requiring no product or delivery decision.

Product owner and delivery lead sign-off is required before Phase 1 begins.

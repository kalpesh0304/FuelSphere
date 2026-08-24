# 00-DECISIONS.md

**FuelSphere — merge decisions**
Status: **All groups closed** — A, B, C, D, G1, G2, G3. Phase 0 complete — six work packages run, seven defects closed, one withdrawn. See `Phase0_Closure_Record.md`. Items marked *Decided in design* were settled during the design work, before the as-built baseline was reviewed. They are carried forward unless the build gives cause to revisit — where it does, that is stated.

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

**EXTENDED 18 August 2026.** The mechanism, restated in full:

```
Plan v1   tail C-FDMO   superseded
Plan v2   tail C-FDMO   superseded    ← re-plan
Plan v3   tail C-FDMP   ACTIVE        ← tail swap
              │
              └─► order created from v3, carries C-FDMP
```

**Each plan supersedes the last. The fuel order is created against the latest.**

**A tail swap produces a new dispatch plan carrying the new tail.** So the registration on the order is not a copy taken from the schedule and watched for drift — it is inherited from the plan the order was made against. An order whose plan has since been superseded therefore has a stale tail **by construction**, and that is the amendment trigger. No separate comparison is needed: the question is simply whether this order's plan is still the active one.

**Four things are missing, not one:**

| | State |
|---|---|
| Version on `FLIGHT_DISPATCH` | Absent |
| Supersession or active flag | Absent. The entity carries neither `ActiveStatus` nor any equivalent |
| **Order → plan reference** | **Absent.** `FUEL_ORDERS` links to `FLIGHT_SCHEDULE`, not to a plan. `FLIGHT_DISPATCH` points at the order; the order does not point back |
| Ticket → version binding | Absent |

**The third is the one that matters most.** Adding versions alone would not close A7 — with no reference on the order, there is no way to say which plan it came from, whichever plans exist.

> **Question for WP-18.** `dispatch_order_id` is mandatory and holds the external system's fuel order ID. **Is it stable across revisions?** If the dispatch system reuses it on a re-plan, it identifies the plan *family* and needs a version alongside it. If it issues a new one per revision, it **is** the version key and no separate field is needed. That answer determines the shape of the fix.

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

**Decision: KEEP THE PLURAL FAMILY.** `PRICING_FORMULAS`, `FORMULA_COMPONENTS`, `MARKET_INDICES`, `MARKET_INDEX_VALUES`, `DERIVED_PRICES`, `PRICING_CONFIGURATIONS`. Retire the singular family and `PRICING_CONFIG`. **DELIVERED under WP-08, PR #35.**

**Correction — this decision contained a factual error.** It stated the singular family was "only read-projected by Planning". WP-08's survey found it was read-projected by **three** services and referenced by associations on **two retained entities**:

```
PRICE_ASSUMPTION.source_formula  → PRICING_FORMULA
PRICE_ASSUMPTION.base_index      → MARKET_INDEX
FLIGHT_COSTS.pricing_formula     → PRICING_FORMULA
```

Deleting on the original description would have broken the build. It also named one projection collision where there were **three** — `PricingFormulas`, `MarketIndices`, `DerivedPrices`.

**The two families are not versions of one design.** Of `DERIVED_PRICE`'s 26 fields, **20 have no same-named counterpart** on `DERIVED_PRICES`. Four read paths were dropped rather than guessed at, because no counterpart exists:

| Dropped | Note |
|---|---|
| `PricingFormulas.contract` | No counterpart |
| `MarketIndices.values` | **`MARKET_INDICES` has no forward composition to its values.** The relationship is modelled only from the child |
| `DerivedPrices.airport` | No counterpart |
| `DerivedPrices.product` | No counterpart |

Three were renames: `elements` → `components`, `market_index` → `lookup_index`, `marketIndex` → `market_index`.

**For WP-20:** those four paths are gone by design, not by oversight of the merge. Do not attempt to restore them.

`FormulaElementCategory` is now an orphan type — its only consumer was the deleted `PRICING_FORMULA_ELEMENT.category`. Left in place; the plural family's `component_type` may want it.

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

**The delivery hangs off the aircraft, not the order.** It keys on **registration + date + departure time** — REQ-FL-010, accepted 17 August 2026.

> ACARS transmits fuel data for a **tail**, not a flight number, so FuelSphere must resolve the join itself. Tail plus date is insufficient: a narrowbody flies four to six sectors a day, and departure time is what separates them.

This replaces the earlier wording, "registration plus time window", which named no anchor. The key states what a reading attaches *to*; the window becomes a tolerance either side of it.

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

**A second obstacle.** Raising `FB402` fails the request, and CAP rolls the request transaction back. An exception row written in the same handler rolls back with it.

**CORRECTED 18 August 2026.** This entry previously said the record could be persisted in an independent root transaction — `cds.tx()` without `req`. **WP-20 measured it: that deadlocks** inside a live request on a single-connection database, and `req.on('failed')` does not fire either. **There is no mechanism for writing a record that survives a failed request.** See F14 for what follows.

**Interim position.** The chain break is visible in the `FB402` response, which carries the computed negative value and all four inputs, and in the absence of a ledger row. There is no durable queue. That is accepted for now.

**The durable record is deferred to open point F14.** It needs a purpose-built entity and a transaction design, settled together.

#### Subsequent entries are not blocked

**Decision: subsequent fuel events for that tail continue to be recorded.**

A broken chain must not stop the airline operating. The next entry restarts from the reported fuel on board, and the gap is recorded rather than propagated.

`recalculateROB` becomes the repair tool: add the missing event, rebuild the chain, and the exception clears.

> **Open point F11 — chain recovery mechanics.** How the restart is represented is not yet designed. Options include an explicit `ADJUSTMENT` entry closing the gap, an entry typed `CHAIN_RESTART`, or an opening balance flagged as unverified. Each has consequences for ledger closure reporting and for whether the gap is later reconcilable. Deferred; WP-03 raises the exception and permits continuation without deciding the representation.

**Decision: keep the assertion, raise FB402, allow subsequent entries. Confirmed.**

---

### B9. Cost object determination model — REQ-SAP-002

**Decision: the burn posting cost object is either a cost centre or a PM order**, selected by `FLIGHT_COST_OBJECT_MODEL` per company code.

| Value | Determination |
|---|---|
| `PM_ORDER` | **Lookup** — flight to PM order, from the trip record or an equivalent standard SAP table |
| `COST_CENTER` | **Derivation** — event category, station, service type, carrier code |

**Event category is a determination dimension.** Engine burn and APU burn on the same leg may resolve to different cost centres. The design's rule that *cost object resolves per event, not per leg* is load-bearing here.

**`PM_ORDER` is a lookup, not a rule.** FuelSphere reads the flight-to-PM-order relationship; it does not derive or maintain it.

> **Dependency:** the trip record is REQ-INT-002 Path A, deferred pending OI-006. `PM_ORDER` mode cannot be built until SAP provides the structure, or an equivalent standard table is identified.

**Burn corrections carry the object of the flight being corrected**, not of the period in which the correction was made. Holds under both models.

**Aircraft to cost object: provisioned, not consumed.** `AIRCRAFT_REGISTRATIONS` gains a nullable `cost_object_type` and `cost_object_id`. No current flow requires it — burn posts to the flight object, not the tail. Provisioned so it is not retrofitted; **no determination logic until a use case exists.**

**Airport maps to plant only.** The cost centre and profit centre mappings are **not adopted**. Station-level cost resolves through `FS_COST_OBJECT_RULE`, where station is a determination dimension. The design has no profit centre concept and does not gain one.

**Effect on the design.** `FS_COST_OBJECT_RULE` survives with a narrower role. Under `PM_ORDER` the object is looked up, bypassing the rule table. Under `COST_CENTER` the derivation is four dimensions rather than the ten scope levels designed. The wider hierarchy remains for non-burn objects.

**Decision: confirmed.**

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

**Decision on numbering: YES — DELIVERED under WP-04.** A shared allocator draws from a `NUMBER_RANGES` counter with an atomic increment inside the request transaction, replacing nine `max + 1` sites across five services. Sequence widened to four digits. D4 and D17 closed.

**Decision on optimistic locking: AMENDED 16 Aug 2026. The stated approach does not work.**

WP-04 implemented `@odata.etag`, measured it, and withdrew it. Two problems, both measured:

**The carrier.** `@odata.etag` on `modified_at` rejects **every** conditional request with 412, including a token CAP itself issued moments earlier. Diagnosed by isolation: an Integer carrier returns 200; `created_at`, which is never auto-updated, still returns 412. **A DateTime field is unusable as an ETag carrier in this stack** — the annotation and `@cds.on.update` are both fine.

**The coupling.** CAP ties `@odata.etag` to *requiring* `If-Match` on every modifying call. Every unconditional update becomes 428, which breaks `draftActivate` and the Planning app's PATCH. This is not additive — it is a breaking change for every existing client.

**D5 remains open.** Two decisions sit behind a real fix, neither taken:

| # | Question | Options |
|---|---|---|
| 1 | Which carrier | A dedicated integer version field, which needs increment behaviour written for each of the five entities — CAP has no built-in for this |
| 2 | Is a missing token fatal | Accept the CAP coupling and require `If-Match` everywhere, with clients sending `If-Match: *` where they do not care — a small change touching every client. Or implement the check in handlers instead, comparing a version on write, which avoids the coupling but only protects paths that implement it |

Recommendation on (2): accept the coupling. `If-Match: *` is trivial for a client to send, and handler-level checking protects nothing that a developer forgets to add. But it is a client migration, and that is a delivery decision rather than a design one.

**Decision: numbering delivered; optimistic locking deferred pending the two questions above.**

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

**Decision on G1: ADOPT ALL 21.**

Where the design already has an equivalent field, the industry code values replace the design's own. No new entities, no structural change, one new field.

**IATA-12 is the exception** — `QuantityFlag: GR | NT` is a new field, not a value substitution. Net is temperature-corrected, gross is not. Without it no quantity in the system states which basis it is on.

**IATA-17 and IATA-18 are master data, not enumerations** — 233 Platts and Argus assessment codes, and 29 fuel tax types. Both are currently designed as customer-configured free text. Load the standard lists.

**Cost of adopting now is near zero. Cost of adopting later is a data migration**, since changing an enum after rows exist means converting them.

**Where it lands:** each value takes effect in the work package that builds or touches the field. There is no separate adoption package — the target schema document carries the values, and packages pick them up as they go.

**REFINED 17 August 2026, after WP-11.** The rule above holds where a field is being created or has no established value set. **Where the repository already holds a populated code list with referential integrity, that list governs internally.**

WP-11 surfaced this: `01-TARGET-SCHEMA.md` §5 specified `'LT'` from IATA-14's `PUOMBase`, but `UNIT_OF_MEASURE` uses `LTR`, and `uom_code` is a foreign key. Adopting `LT` literally would have left a dangling association from the first record on three entities.

**IATA codes are mapped at the interface, not imposed on existing master data.** `LTR ↔ LT` when sending or receiving an IATA Transaction message. Renaming master data for cosmetic alignment is a migration for no benefit, and leaving two codes for one unit is worse than one code that differs from the standard.

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
| F2 | **Refuelling event window — three calibration questions** | **(a) Duration.** How long an event stays open before a new ticket opens a fresh one. Too short and a slow two-bowser uplift splits, breaking the FQIS pairing. Too long and a genuine top-up merges into the original. Two hours as a starting parameter. **(b) Tolerance either side of departure time.** REQ-FL-010 settles the anchor — registration + date + departure time — but not how far before or after a reading is still accepted. A delivery starting 13:10 for a 15:00 departure is clearly that flight's; at 11:45 following an 11:00 arrival it is ambiguous. **(c) Scheduled or actual departure time.** Actual is more accurate; scheduled is available earlier. A schedule slip from 15:00 to 17:30 moves the join, and a reading taken at 15:20 changes meaning. **(d) There is no completion signal at all.** The window closes on a **timeout**, which is not the same as knowing the refuelling finished. So the window is the *only* discriminator between two bowsers on one uplift and a genuine second refuelling after a re-plan — and it must serve both. **The IATA Transaction Standard and the AIDX Fuel Summary both carry an explicit completion indicator; the manual capture path has no equivalent.** Where an electronic feed exists the supplier states it; where it does not, nothing does. Consider whether departure — off-blocks — should close any open delivery regardless of the window, since no fuel can be added after it | Real turnaround data is available to calibrate against |
| F3 | **Where the ePOD signature belongs** | Per ticket where each fueller signs their own, or per delivery where the crew signs one consolidated document at the end. **Partial evidence for per ticket:** IATA service level guidance places the receipt with the fuelling operative — "provide fuel delivery receipt to representative for signature prior to aircraft departure" is listed as a duty of the person operating the fuel vehicle, implying one receipt per vehicle. Not conclusive for multi-bowser turns | Confirmed with the airline, or resolved from the IATA Transaction standard — see F9 |
| F9 | **Obtain the IATA Fuel Data Standards** | Four free XML standards covering the exact lifecycle: Tender/Bid, Operational (preliminary through revised and final order, concluding with a Fuel Summary), Transaction (electronic fuel transaction settlement), Invoice. **The Transaction standard is the industry schema for the fuel ticket** and would settle F3, the delivery-versus-ticket structure and the field set from the industry's own definition rather than inference. Broad supplier adoption including Shell Aviation, Air bp, ENOC, Q8, Neste, Singapore Petroleum; airline adoption including Lufthansa, British Airways, Emirates, Singapore Airlines, Cathay Pacific, Qatar. Note the Operational standard's shape — preliminary, revised, final, summary — is order versioning independently arrived at | **Now.** Free download at iata.org/en/programs/ops-infra/fuel/data-standards, contact fdsg@iata.org |
| F4 | **FQIS source and confidence on the event** | Without ACARS, fuel on board is crew-reported and typically rounded to 100 kg, which is 0.9% of a narrowbody uplift and 25% of a small top-up. Reconciliation tolerance should resolve partly from the source, and missing readings must read as NOT_RECONCILED rather than PASS | ACARS coverage per fleet is known, and it is confirmed whether crew record fuel on board at refuelling at all |
| F5 | **Into-plane pricing models** | Per litre at station level today. Volume-banded, per turn, aircraft-size and out-of-hours models are not supported | Contract terms across stations are known |
| F6 | **Dispatch plan version gap rate** | Push-on-change with latest-only emission is confirmed. Gaps still occur under push. Whether a gap is a defect to chase or normal attrition determines how versions_skipped is interpreted | Observed gap rates are available |
| F7 | **Aircraft type structure for a product** | Four code schemes plus a separate configuration table, or a flatter shape with alias resolution alone. Current design favours correctness of parameter resolution over setup simplicity | Two or three implementations have been observed |
| **F21** | **Should an order quantity be rounded to whole litres?** | WP-DEMO-01: `4803 ÷ 0.8 = 6003.75` exactly. Seeding a rounded 6,004 would break WP-11's reproducibility criterion, since the conversion no longer reproduces from the stored density. **Nothing rounds to a whole unit today.** If orders should be placed in whole litres — and a supplier receiving a request for 6,003.75 L is at least odd — the rule belongs **in the conversion**, not in the seed, and rounding **up** is the safe direction so an order never under-requests. Not a formatting question: it changes `ordered_quantity`, and therefore what the three-way match compares | WP-13, with the conversion moving into the parameter framework |
| **C-4** | **DECIDED — the ground gap splits at FLIGHT CLOSURE, not at the refuelling event** | SME session, 21 August. **Flight closure is when the inbound captain signs off and hands the aircraft to engineering.** Everything burned from chocks-on to closure is charged to the **arriving** flight; everything from closure to next chocks-off to the **departing** flight. **This supersedes the split-at-refuelling rule in WP-19's design notes** — that was inferred from which fuel was in the tank; this is an operational boundary with a real timestamp and a transfer of responsibility behind it. **The timestamp comes from the TECH LOG**, so it needs a field and a capture path — OCR of a photographed tech log, or manual entry. **And evaporation joins APU as a cause of ground-gap loss**; both are bookable against one of the two flights using closure as the split point | 
| **C-5** | **CORRECTED — the tolerance difference is ROUNDING, not sensor accuracy** | SME session, 21 August. The design says a crew-reported reading gets a wider tolerance than an ACARS one, and the reasoning given was measurement precision. **That is wrong: the load cell drives both the ACARS downlink and the cockpit dial, so the inherent error is identical.** The difference is that **a crew figure is rounded to 100 kg when it is recorded**, and two rounded readings can differ by 100 before anything is wrong. **The conclusion stands and the reason changes** — which matters, because the reason is what an SME will challenge. **Also decided: do not promote the ACARS-versus-crew split in the demo.** Keep it a configurable back-end parameter | 
| **C-6** | **Invoice matching is SAP Document AI's, not FuelSphere's** | SME session, 21 August. **SAP Document AI reads the invoice and performs the three-way match.** FuelSphere does not re-implement it. **FuelSphere's extension is rendering the result in a fuel-management context** — per aircraft, per flight, with historical uplift context and a query interface for *"why am I paying so much for this flight?"*. **This is the third position on invoice matching in two days** and it is the right one: pre-validation in FuelSphere, matching in the platform, fuel context in the UI. **Bears on WP-21A and WP-21B** — 21A's check registry stands as pre-posting validation; 21B's MIRO handoff is reframed around Document AI | 
| **F37** | **A wrong reading propagates forward and must be caught before the next departure** | SME session, 21 August, raised before any slide. **A figure entered wrong — 200 where 300 was meant — carries into every subsequent opening and closing balance on that tail.** Retrospectively finding which event caused the drift is *extremely* difficult. **The requirement is near-real-time detection: before the next flight departs.** The ROB ledger's `FB402` catches a negative balance, which is the extreme case; **this asks for detection of a plausible-but-wrong figure**, which is a different control — and probably a comparison against the expected burn for that tail and sector rather than against zero | |
| **F38** | **Every reading needs a source flag, and there may be three sources** | SME session, 21 August. Record on **every** gauge and meter reading whether it came from **ACARS, manual entry, or an OCR scan** — that flag is what selects the tolerance. **And a third source exists:** engine-manufacturer IoT telemetry, such as Rolls-Royce continuous fuel-flow monitoring at 100-metre intervals, which is more accurate than ACARS. **Avianca ran all three — ACARS, IoT and manual — and required all three cross-validated.** Architect to receive and flag the source of each reading, which also enables anomaly detection later | |
| **F36** | **The `flightSchedule` app may not bind** | Its ListReport targets `contextPath: /FlightSchedule`, but **its bundled metadata snapshot has `Flights` and no `FlightSchedule` entity at all** — and zero UI annotations targeting `FlightSchedule`, checked on both the alias and full-namespace spellings. The other three snapshots carry 8—11 `UI.LineItem` blocks each. **Two readings, indistinguishable from the files:** the snapshot is a stale local mock and harmless at runtime because the app binds live; **or** the app was generated against an older `PlanningService` where the projection was called `Flights`, in which case it will not bind. **Confirm with the developer before the demo** — `FlightSchedule` carries the richest annotations in the repository. Note also that all four snapshots date from 6 August and therefore **predate WP-UI-01 and WP-UI-02**, so any local preview will not show that work | Before the demo |
| **F35** | **`FuelOrderService.FlightSchedule` was left thin deliberately** | Both `FlightSchedule` annotations were written in **the same commit** — `612ccf66`, 23 March 2026, +4,839 lines. `PlanningService` received 12 columns, 7 filters and 7 facets; `FuelOrderService` received 9 columns and nothing else. **Same afternoon, same author, two files, one commit.** So the thin one is a choice, not drift, and `planning-fiori-annotations.cds` is **byte-identical to that day's version** — untouched for five months. **Before copying the rich annotations across, establish why they were not.** The likely answer is that the two services serve different users, and the planning view is the one a planner needs | With the UI work |
| **F33** | **The launchpad exists only in BTP, with no version history** | **58 tiles across 9 tabs** are live on the dev launchpad. **No launchpad configuration is in the repository** — no `CommonDataModel.json`, no `fioriSandboxConfig.json`, no `.flpSandbox`, no portal or site module in `mta.yaml`. So the structure a user actually navigates has **no diff, no review trail and no way to reproduce it** — and it is the artefact the client will see. Tile-level defects are already visible in it: *Finanace Controller*, *CO-PA Assigment*, *Reconcillation*, *Reporting's*; a Reporting tab holding only integration and monitoring tiles; and apparent duplicates in Master Data (Aircraft Master / Manage Aircrafts, Airport Master Data / Manage Airports, Route Master / Manage Routes) | Before any client demo |
| **F34** | **Two competing navigation models** | `docs/design/PERSONA_AUTHORIZATION_MATRIX.md` groups by **persona**, eight of them. The live launchpad groups by **function**, nine tabs. **Only "Master Data" is common to both.** Proposed resolution, and it is the standard Fiori pattern: **keep function-driven groups as the site structure and express personas as role collections controlling visibility** — which avoids duplicating a tile across every persona that uses it. Two further questions ride on it: whether *Diligent Solution* is a product tab or an internal one, and whether the Master Data duplicates are dashboard-plus-list of one object or genuinely two apps | With the technical review |
| **F32** | **`$fiori-preview` survives a production build, exposing every entity** | `cds.features.fiori_preview: true` is set **unconditionally**, and `@sap/cds-fiori` is a runtime dependency of `@sap/cds`, so the flag is not removed by `npm install --production`. **Every exposed entity therefore has a List Report and at least one Object Page in a deployed system** — 226 screens, of which the service index links six. **This is not a data breach:** the OData routes are `xsuaa` and `@restrict` enforces server-side, so a user sees only what they are entitled to. But it is an **unintended surface**: every entity in the model is browsable by anyone who can guess a URL, including entities no application was meant to expose. **Two questions for the technical review.** Is the flag deliberate? And if the preview is to carry the demo — which this makes possible — does it stay on afterwards? Take with F30 and F31 | The technical review, with F30 and F31 |
| **F30** | **The five UI routes serve unauthenticated** | `app/xs-app.json` sets `authenticationType: "none"` on all five UI routes, so **the pages, their JavaScript and their stylesheets are served to anyone**, and the XSUAA redirect fires only on the first data call. **No data is exposed** — the OData route is `xsuaa` and `@restrict` enforces server-side — but an unauthenticated visitor receives the application shell and can read every line of client code, including the hardcoded external launchpad URL and the field names of every entity. **Independent of which UI technology is chosen.** Change to `xsuaa` and confirm nothing breaks; the only likely casualty is a bookmark that expects to load before login | Before any deployed demo, with F29 |
| **F31** | **Three classes of client-side risk that Fiori Elements removes and freestyle does not** | Recorded while evaluating the UI route. **(a) CSRF** — SAPUI5's OData model fetches and rotates the token automatically; the freestyle apps send none, which is F29. **(b) XSS** — UI5 binds and escapes by default; **the five apps concatenate into `innerHTML` everywhere**, in every table and every cell. The data is ours today, and the first supplier free-text remark reaching a table is a stored XSS path. **(c) Action visibility** — annotations can bind a button to a scope, so it is absent for a user who lacks it; freestyle either renders it and lets the 403 happen, or hardcodes a check that drifts from the server's. **None of this is authorisation.** `@restrict` on the service is what enforces, and it is identical either way — WP-02B and WP-02C did that work and neither touched a screen. **Fiori Elements removes three classes of mistake; it secures nothing on its own** | **NEEDS TECHNICAL REVIEW.** Not a design decision to take here — the UI technology choice belongs with the technical team, who own the deployment, the approuter and whatever exists outside this repository. **Take F30 to the same review**, since it is independent of the choice and needs doing either way |
| **F29** | **The four UI write paths send no CSRF token** | `xs-app.json` sets `csrfProtection: true` on the `/odata/v4/` route, so the approuter requires an `x-csrf-token` header on every non-`GET`. **No token fetch and no such header exists anywhere in the five apps.** Planning's two PATCHes and two POSTs send `Content-Type` and nothing else. They work locally because `cds watch` has no approuter in the loop. **Through a deployed approuter they should be rejected** — and with D33 in place the rejection would render as an empty table. The absent header is measured; the 403 is inferred and unexecuted. Separately, all five UI routes carry `authenticationType: "none"`, so the pages load unauthenticated and the XSUAA redirect fires on the first data call rather than on page load | Before any deployed demo |
| **F28** | **FIFO burn consumption contradicts moving average price** | Raised 21 August. **MAP per tail has no layers** — one tail, one average, updated on each receipt. There is nothing to consume in order. **FIFO needs layers**: each uplift retained as a distinct quantity at a distinct price. Decision B4 chose split valuation by tail, which is MAP, so the two cannot both hold as designed. **Two routes if FIFO is wanted:** batch management per NEW-02, where each delivery becomes a batch and batch determination on goods issue supplies the order — but fuel commingles, so any determination rule is a fiction; or a valuation-layer model alongside MAP, which means maintaining two costing views of the same stock. **Worth establishing what FIFO is for first.** If the aim is that cheap fuel loaded at one station stays cheap when it burns on the outbound sector, **MAP per tail already achieves that** — averaged rather than layered, and B4's whole argument was that a cross-tail average is what destroys the signal | With NEW-01 and NEW-02, where the valuation model is decided |
| **F27** | **Three of WP-02C's eighteen grants are wrong at the floor, in both directions** | D26 set each entity's `UPDATE` scope as the floor, deliberately, so no action was left denied. Three want revisiting. **Too loose:** `postToFinance` requires `BurnDataEdit` and should almost certainly require `FinancePost` — the same argument D26 already makes about `postToS4HANA`. **Too tight, and more interesting:** `validateDelivery` and `calculateTemperatureCorrection` are both **read-only**, and `validateDelivery` records findings and returns them without writing anything. **Requiring write scope to read a diagnosis means a user who cannot edit a delivery cannot see why it is invalid** — reading the diagnosis should be easier than fixing it, not harder. The floor is right for shipping and wrong as a resting place | The production authorisation review, with D23 |
| **F26** | **A defuel line cannot be distinguished from a data error** | `INV456` carves out defuel from the negative-quantity check — a defuel is legitimately negative. **Nothing on `INVOICE_ITEMS` marks a line as defuel**, so WP-21A raises on every negative quantity and says why. The carve-out is written and unapplicable. IATA-03 gives the values `DF` and `F`, adopted under G1, and `FUEL_TICKETS` gained `event_type` — **the line needs the same, or a resolution through its ticket.** Until then a legitimate defuel invoice raises a HARD error bypassed every time, which trains people to bypass | With the defuel handling, or WP-21B |
| **F25** | **No contract-to-formula link, and no company code on a contract** | `MASTER_CONTRACTS` carries neither. Formula scope resolves off `supplier_id` and `company_code`, so WP-20 takes `companyCode` as a **caller-supplied parameter** — nothing on the contract can produce it. That makes the link between a contract and the formula that prices it implicit, resolved by scope match rather than declared. **Sibling to D28:** something the design assumes exists and does not. Bears on WP-26, where the same entity gains its AFSMA structure | WP-26, or sooner if pricing is relied on |
| **F23** | **A missing index quote cannot be recorded as missing** | `MARKET_INDEX_VALUES.value` is `@mandatory`, so an absent quote can only be inferred from a **gap in the dates**. A quote the market never published and a quote nobody loaded are indistinguishable. **This is the "missing is not zero" principle made unrepresentable by the schema.** It matters commercially: an averaging period short a day because the market was closed is normal; short a day because an import failed is a finding, and today nothing tells them apart. Found by WP-20, which implemented the missing-quote policy as arithmetic over the dates present rather than as a stored absence. **Options:** relax `@mandatory` and add a `quote_status`; or add an explicit NO_QUOTE row type. The first is a relax, so survey the readers | With the index import work, WP-20's remaining actions |
| **F24** | **Restatement supersession has no field and orders by timestamp** | WP-20 supersedes a restated derivation by `status` plus `derivedAt` ordering, because `DERIVED_PRICES` carries no `superseded_by` and no version. **Two derivations in the same millisecond are ambiguous**, and the correct one is then a matter of insertion order. `FLIGHT_DISPATCH` gained exactly this under WP-18 — `plan_status` with `superseded_by` — and the same shape applies here. Flagged by WP-20 rather than worked around | Before restatement is relied on in anger |
| **F22** | **`APU406` requires a cap and none is defined** | The rule asks that an open APU cycle — one with no stop time — be **capped and escalated**. **No cap value exists anywhere in the design.** WP-19 flagged the cycle and left it uncomputed rather than cap at an invented figure, which is right: an APU running unbounded is a data problem, and a fabricated ceiling would turn it into a plausible-looking cost. **A cap needs a basis** — the longest credible continuous run, or a per-fleet figure. Until then an open cycle contributes nothing and is visible as an exception | With WP-13, where the value would live |
| **F19** | **`GAL` and `USG` carry no SAP unit codes** | `UNIT_OF_MEASURE` gained `sap_uom` and `sap_uom_iso` under WP-11, populated for the three units `01-TARGET-SCHEMA.md` §5 names — `KG`, `LTR`, `MT`. The two gallon rows were left **blank rather than guessed**, since a wrong code in master data that later reconciles against SAP is worse than an empty one. Correct call, but a gap with a trigger: **the first US station cannot post a GR or an invoice without them.** Needs the target client's T006, not inference — internal codes are client-configurable. Note the repository distinguishes `GAL` from `USG`, so both need resolving, and imperial versus US gallon is itself a question | Before any station metering in gallons goes live. **WP-12 note:** mass derivation deliberately returns null for gallon tickets rather than recovering the ratio from the master rows. The `GAL`/`LTR` `conversion_to_kg` values do yield 3.7854 L/gal, but only while both rows share a nominal density — an unstated coupling that would break silently the moment either is corrected |
| **F17** | **Six status columns remain free text after WP-09** | `AIRCRAFT_OPSTATUS.status_code`, `ALERT_INSTANCES.status`, `INDEX_IMPORT_BATCHES.status`, `ROUTE_MASTER.status`, `SECURITY_USERS.employment_status`, `INVOICES.fi_posting_status`. Found by the WP-09 survey. Deliberately excluded: each belongs to a module that is not built, so enum-ing it means guessing the value set before the behaviour exists. **`SECURITY_USERS.employment_status` is a special case** — it is deliberately free text with its own comment `// ACTIVE, TERMINATED, LOA`, and it is not the `UserStatus` column. WP-06 established this. Do not "fix" it | Each with the package that builds its module |
| **F16** | **Validation guards should flag, not early-return** | WP-05 measurement: the removed 100,000 kg guard used `req.error` followed by `return`, and the return also skipped the `total_amount` calculation further down the handler. An over-threshold order ended up with **neither a quantity nor a total** — the guard silently suppressed a derived value as a side effect of blocking the write, with no indication why. When WP-13 introduces configurable thresholds, prefer flagging the record and continuing so derived values still populate. Applies to any guard that sits above a derivation in the same handler | WP-13, tolerance configuration. Review other early-return guards for the same pattern |
| **F20** | **Ground burn does not reach the fuel ledger** | Between `IN` of the arriving leg and `OUT` of the departing one, fuel leaves the tanks — almost entirely APU, plus temperature change and any defuel or transfer. `ROB_LEDGER` chains `arrival fuel → fob_before_refuel → uplift` with **nothing representing that gap**, so it is silently absorbed into whichever adjacent figure closes the chain. WP-12 added `ground_burn_kg` on `FUEL_DELIVERIES`, which makes the **pre-refuel** portion visible; the **post-refuel** portion, `fob_after → fob_out`, is not captured at all. Neither is written as a ledger event | Phase 1 ledger work, **with F14 and F15** |
| **F15** | **No ePOD delivery reaches the fuel ledger** | `UPLIFT` entries are created only by the Excel ROB import (`burn-service.js:940`). Nothing creates a ledger entry from a `FUEL_DELIVERIES` ePOD event. The ROB formula is now correct, but one of the two physical event types never enters the chain, so the ledger cannot detect an uncaptured uplift — which is its primary purpose. Found during WP-03 | Phase 1. Functional, not cosmetic — the ledger control does not work without it |
| **F14** | **Durable sink for fuel ledger chain-break exceptions** | WP-03 established that no existing entity fits. `FUEL_BURN_EXCEPTIONS` carries burn-variance semantics; `ERROR_LOGS` and `EXCEPTION_ITEMS` are integration-shaped with mandatory `integration_name`, `source_system`, `target_system`. A purpose-built entity is needed, carrying tail, sequence, the four formula inputs, computed closing, and references to the source burn and delivery. **CORRECTED 18 Aug 2026: the mechanism this entry assumed does not exist.** WP-20 measured `cds.tx()` without `req` — it **deadlocks** inside a live request on a single-connection database, and `req.on('failed')` does not fire. **Nothing can be written that survives a failed request.** Three options remain, none free: **(a)** do not fail the request — write the exception and return success with the break in the payload, so the caller reads the payload rather than the status code; **(b)** write from outside the request, via a job or an emitted message, which adds machinery; **(c)** accept the error as the record — `FB402` already carries the computed value and all four inputs, and that is the position today. **(a) is the smallest change and the most honest**: a chain break is a finding, not a failure of the caller's request | Phase 1, with F15 and F20 |
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

### Closed under Phase 0

| # | Defect | Closed by |
|---|---|---|
| ~~D2~~ | `'any'` on 93 authorisation grants across 69 grants | WP-02, PR #32 |
| ~~D3~~ | ROB formula dropped uplift and clamped negatives | WP-03, PR #30 |
| ~~D4~~ | Non-atomic `max + 1` number generation | WP-04, PR #33. Nine sites across five services, not the three named |
| ~~D13~~ | `captureSignatures` had no order status guard | WP-02, PR #32 |
| ~~D15~~ | `recalculateROB` unimplemented; ledger could not be rebuilt | WP-03, PR #30 |
| ~~D16~~ | 100,000 order guard blocked legitimate widebody orders | WP-05, PR #31 |
| ~~D17~~ | `'XXX'` fallback station code in number generation | WP-04, PR #33 |

### Withdrawn

| # | Defect | Why |
|---|---|---|
| ~~D1~~ | Master sync transaction wrapper commented out | **Not a defect.** Measured under WP-01, 16 Aug 2026. CAP's ambient request transaction already makes delete and insert atomic; the wrapper was redundant, and restoring it silently discards writes while returning HTTP 200 with success. Nine of nine scenarios pass on unmodified code, on both in-memory and file-backed sqlite. Residual risk moved to F13 |

### Open

| # | Defect | Blocking |
|---|---|---|
| **D22** | **Eleven bound actions denied under real authorisation, for every user including one holding all scopes.** CAP matches a bound action against the entity's `@restrict` for a grant naming that action; entity-level CRUD does not imply it. Pre-existing, unchanged by WP-02. **Masked locally by dummy auth.** Would surface on first XSUAA deployment. Fix is mechanical — see WP-02B | **Yes — deployment** |
| **D19** | **NARROWED, and half decided.** **Naming:** point the code at `S4HC_TECHNICAL` rather than rename a destination to `S2A` — the descriptive names carry the auth distinction and `S2A` does not. Background lookups, no user in the loop. **Environment:** neither provisioned destination declares a `URL`, and no S/4 tenant exists behind either. That is not a code problem. **Blocks WP-21B entirely** — vendor exists, vendor blocked, tax registration, exchange rate and posting period all have nothing to ask |
| **D23** | **Two implemented services have no authorisation of any kind.** `authorization.cds` covers 4 of 15 services. `PlanningService` (610 lines) and `RefuelerService` (235 lines) have no annotation block, not even a service-level `@requires` | **Yes** |
| D5 | No optimistic locking. See C5 — the stated `@odata.etag` approach was measured and withdrawn; two questions remain open behind a real fix | **Yes** |
| D11 | No aircraft register. `AIRCRAFT_MASTER` is keyed by `type_code` | **Yes** |
| D14 | No row-level security. Zero `where:` clauses | **Yes** |
| D6 | Duplicate pricing entity families and config tables. Decision A10 taken; retirement is WP-08 | |
| D7 | Order status enum drift. **Narrowed by WP-06:** the seed data is correct, every value is in `OrderStatus`. The disagreement is code-side — `before CREATE` writes `'Created'` | |
| D8 | `temperature_corrected_qty` implies density correction | |
| D9 | Simulated S/4 document numbers | |
| D10 | `planned_burn_kg` hardcoded to zero — ACARS reconciliation inert | |
| D12 | Density required then ignored | |
| D18 | Flight status is unenforced free text. Decision B7 taken | |
| **D21** | `aircraft_ID` written to `ROB_LEDGER` on two paths where no such element exists — `burn-service.js:479` and `:1071`. The association flattens to `aircraft_type_code`, so the reference is silently never set. Found during WP-03 | |
| **D29** | **`applied_multiplier` carries two unrelated meanings, and component sequence is not unique.** On `PRICE_DERIVATION_LOGS`, `applied_multiplier` holds a genuine multiplier on one row and a **threshold marker** on another — 1.0 against 5000. Separately, one seeded formula has three components sharing `sequence = 3`, so **sequence alone cannot order them deterministically**; WP-20 ordered by `(sequence, componentType, ID)` and reported it rather than assuming. If sequence is meant to be unique per formula it needs a constraint; if it is not, the tiebreak belongs in the design rather than in one module. Both found by WP-20 and left alone | |
| **D28** | **Four parameters are decided and none exists.** `HOLD_PAYMENT_ON_DISCREPANCY` (C-1), `FLIGHT_COST_OBJECT_MODEL` (B9), `BURN_POSTING_TRIGGER` (C-2) and `UNKNOWN_TAIL_POLICY` (`01-TARGET-SCHEMA` §10.3) are all named in taken decisions. **None is stored anywhere** — the only occurrences in the codebase are comments naming WP-13 as their destination. Found by the WP-07B survey. **This enlarges WP-13:** its scope has been "migrate the hardcoded tolerances", but there is no parameter store to migrate them into, and four parameters have been decided into existence without one. WP-13 must build the store, register these four, and provide the resolution — not merely move literals | |
| **D27** | **A re-planned dispatch is silently discarded.** `order-service.js:847-851` builds a composite dedup key of fuel order ID, flight number and flight date and on a match warns and skips — not update-in-place, not a second row. Where the dispatch system reuses the fuel order ID on a re-plan, **the revised quantity never lands**, and the only trace is a `WARNING` in an import log. Separately, the import reads 18 named columns and **discards everything else without comment**, so a version column already in the feed is being thrown away. Found by the WP-18 pre-survey. Closed by WP-18, which replaces "duplicate" with "revision" | |
| **D26** | **Eighteen bound actions carry no `@requires` at all.** WP-02B surveyed 31 bound actions on restricted entities and found **zero had a grant** — including every one that already declared an `@requires`. Thirteen were mechanical and are fixed. The remaining eighteen declare no scope, so there is nothing to mirror: choosing one for a previously unauthorised action is a security decision, not a mechanical fix. **Two are ours** — `complete` from WP-09 and `attachToOrder` from WP-10, both added without an `@requires` while authorisation work was in progress. **Decision: mirror each entity's `UPDATE` grant as a floor** — an action that modifies an entity should require at least what modifying it directly requires, which widens nothing. **A floor, not a correct answer for all eighteen:** `postToS4HANA` should need `FinancePost`, not `UPDATE` on an invoice. Review the high-privilege actions before production. See WP-02C |
| **D25** | **79 enum-typed elements in the schema. Zero were enforced.** Declaring a CDS enum does **not** validate input — CAP checks only where `@assert.range` is present. WP-09 measured it: before annotation, a POST with `status='RETURNED'` against a newly declared enum returned **201**. This is the mechanism behind the entire enum-violation class WP-06 corrected — `SUBMITTED` could sit in seed data against an enum lacking the member because nothing ever checked. WP-09 enforced one field, WP-12 one more. **The remaining 78 are WP-09B**, whose work is the blast radius across writers and seed data, not the annotation |
| **D24** | **Three seed CSVs are dead, not misnamed.** `fuelsphere-Airports.csv`, `fuelsphere-FuelTypes.csv`, `fuelsphere-Suppliers.csv`. No matching entity exists under any name; headers are camelCase from a different design; CAP has never loaded them. **Delete, do not rename.** Small and standalone | |
| D20 | A malformed S/4 response is reported as "0 records" rather than as a parse failure. Data-safe, but an unrecognised payload is indistinguishable from an empty source. Carry with F12 or F13 | |

### Found by sweep, corrected under WP-06

Fifteen enum violations that appeared on no defect list: `PARTIAL` where the enum says `PARTIAL_MATCH` (3 cells), `OK` where it says `NORMAL` (12 cells). Two of the three violations that *were* listed did not exist — `SECURITY_USERS.employment_status` is not enum-typed, and `FUEL_ORDERS.status` data already conformed.

---

## Sign-off

| Role | Name | Date |
|---|---|---|
| Solution architect | Ajesh | 2026-08-16 |
| Product owner | Deferred to Phase 1 | — |
| Delivery lead | Deferred to Phase 1 | — |

**Phase 0 authorised and complete.** Groups A, B, C, D, G2 and G3 closed. WP-01 to WP-06 run: five merged, one closed as already-satisfied. Seven defects closed, one withdrawn, six new ones found.

**Product owner and delivery lead sign-off is required before Phase 1 begins.** Phase 0 was defect fixes on your signature alone; Phase 1 changes the schema.

**Still open before Phase 1 can start:**

| # | Item |
|---|---|
| 1 | `01-TARGET-SCHEMA.md`, `02-BEHAVIOUR.md`, `03-VALIDATION-RULES.md` — all three are placeholders |
| 2 | Product owner and delivery lead sign-off above |

**Worth a small standalone pass at any time:** WP-02B (eleven bound action grants, deployment-blocking) and D24 (delete three dead CSVs). Both mechanical.

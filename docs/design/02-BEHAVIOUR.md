# 02-BEHAVIOUR.md

**FuelSphere — behaviour specification**
Written against the build as at 16 August 2026, after Phase 0.

---

## How to read this

This document says **how each module must behave**, mapped onto the build's own services. It does not repeat the schema, which is `01-TARGET-SCHEMA.md`, or the validation rules, which are `03-VALIDATION-RULES.md`.

| Marker | Meaning |
|---|---|
| **BUILT** | Working today. Extend, do not rewrite |
| **PARTIAL** | Some of it works. The gap is stated |
| **ABSENT** | Nothing exists. The package that builds it is named |

**Where this document and source disagree, stop and ask.**

---

## 1. Six principles that apply everywhere

These are not module behaviour. They are the rules every module follows, and most defects found in Phase 0 were a breach of one.

### Capture is never blocked; external commitment is gated

A physical event that has already happened is always recorded. Fuel in the tanks, a burn that occurred, a delivery made — all captured, whatever is missing.

What is gated is the point at which a mistake becomes irreversible: a purchase order raised, a goods movement posted, an invoice approved.

Decisions A1, A3 and A4 all say this. Phase 0's WP-05 removed a guard that blocked a legitimate widebody order; the same instinct produced the `@mandatory` order on a ticket, which A1 relaxes.

### Derived values are never keyed

A total is the sum of its children, computed on read or on write of a child. Never stored and never independently editable.

`FUEL_DELIVERIES.delivered_quantity` is currently keyed and must become derived. `FUEL_ORDERS` fulfilment sums its tickets. Ledger closing balance is `opening + uplift − burn + adjustment`, never a stored figure that could disagree with its own inputs.

### Missing is not zero

A derived value with a missing input is `null`. `planned_burn_kg` hardcoded to `0` is why the entire ACARS variance ladder is unreachable — the guard tests `> 0` and never fires. A zero says "measured, and it was nothing". A null says "not measured".

### Configuration resolves at transaction date

Never at query date. A tolerance retuned in March must not re-evaluate January's exceptions. Where a resolved value drives a status, record which configuration row produced it.

### An error must say what happened

`FB402` carrying `computed = −340 kg` with all four inputs is a finding. "Validation failed" is not. Where a malformed payload is reported as "0 records" — defect D20 — the caller chases a data problem that does not exist.

### Survey before changing

Phase 0 found the defect in more places than stated, three times: nine number-generation sites where three were named, four of fifteen services covered by authorisation, fifteen enum violations on no list. **A partial fix on a distributed defect looks complete and is not.**

---

## 2. Order lifecycle — `order-service.js` · BUILT

867 lines. 16 `.on`, 2 `.before`, 3 `.after` handlers.

### The state machine — keep it, fix three things

```
Draft → Submitted → Confirmed → InProgress → Delivered → Completed
                                     │
                        captureSignatures (ePOD)
                                     │
                          S/4 PO and GR created
```

Guarded at every transition, which is correct and unusual. Three defects:

| Defect | Fix | Package |
|---|---|---|
| Writes `'Created'` on create — not in `OrderStatus` | Write `'Draft'` | WP-09 |
| Never writes `'Completed'` | Implement the transition | WP-09 |
| `captureSignatures` sets `Delivered` with no guard | ~~Fixed~~ | WP-02, done |

**Do not add `'Created'` to the enum.** The enum is right; the code is the outlier. Seed data already uses `Draft` and `Completed` correctly.

### Order creation

**From a fuel plan.** Ordered quantity derives from the plan's required uplift, converted from mass to volume using the resolved conversion density. Both the density used and the source mass figure are recorded — decision A2 and `01-TARGET-SCHEMA` §5. Without both, the order carries a converted number nobody can reproduce.

**From a flight, with master data missing.** Currently proceeds silently: the airport lookup sets null and continues, and supplier, contract and product are inserted unvalidated. **Decision A4: proceed, but visibly.** The record is provisional, the unresolved reference is named, and order transmission and posting are gated until it resolves. A silent null becomes a real purchase order against the wrong party.

### Amendment

A confirmed order cannot be increased. An increase is a **new incremental order**, not an amendment — the supplier has already committed to the original quantity and a second commitment is a second order.

Reductions before the freeze point amend in place. After the freeze point, changes are handled outside the feed.

**Materiality:** an amendment below the configured threshold does not generate supplier traffic. The threshold is configuration, not a literal.

### Crew review — BUILT, keep

`crew_review_status`, `crew_adjusted_quantity`, `crew_adjustment_reason` with a `CrewReviewStatus` enum. This is the commander's fuel acceptance, and it is a better shape than the design's treatment of discretionary fuel as a plan field. Group D item 7: **adopt.**

---

## 3. Delivery and ticket — `order-service.js`, `ticket-service.js` · PARTIAL

### The three-entity model — decision B2

```
FUEL_ORDERS ──*── FUEL_DELIVERIES ──*── FUEL_TICKETS
                  (refuelling event)     (one per bowser)
                        │                      │
                  keys on tail + window        └─ order (nullable)
```

**Two independent measurements at different granularity.** The bowser meter measures volume, per bowser. The aircraft FQIS measures mass, per refuelling. A widebody uplift with two bowsers has one FQIS pair spanning both tickets — it can sit on neither.

Parallel bowsers make this structural: two trucks pumping simultaneously into one manifold produce no per-bowser mass figure and never can.

> Read `FUEL_DELIVERIES` as **refuelling event**. The name is retained because renaming would touch 79 seed files and 185 projections.

### Creation — CHANGE

Currently a delivery is created at `startDelivery`, which is a **status transition, not a physical event**. The row exists before any fuel moves and orphans if fuelling never happens.

**Target: created by the first ticket for that tail.**

```
ticket arrives
  → open delivery for this registration within the window?
       yes → attach
       no  → create, attach
```

FQIS readings enrich the delivery whenever they arrive, which is typically after the ticket.

**The window duration is undesigned** — open point F2, two hours as a starting parameter. Too short and a slow two-bowser uplift splits, breaking the FQIS pairing. Too long and a genuine top-up merges into the original.

### Orders link transitively

**No direct FK between delivery and order.** The relationship is many-to-many both ways:

| Case | Shape |
|---|---|
| Two suppliers fuelling one aircraft | Two orders, **one** delivery, two tickets |
| Initial uplift then a top-up after re-plan | **One** order, two deliveries |

A direct FK breaks one of those. Resolve through the ticket table in either direction. A denormalised order reference may sit on the delivery for screens — **derived, read-only, never authoritative**.

**An unmatched ticket carries no internal number until it is matched.** WP-04's allocator will not mint a ticket number without a station, because a number containing no traceable station is defect D17. The station comes from the order. So where no order exists, `internal_number` stays null and `attachToOrder` allocates it at matching.

Both rules survive intact. Refusing the ticket for want of a station would put fuel outside the system, which is what A1 exists to prevent; minting a number with a placeholder station would reintroduce D17.

**A ticket may arrive with no order** — decision A1. The delivery can hold tickets that resolve to nothing yet. Attaching one to an order later changes which orders the delivery touches without touching the delivery. That is correct: the physical event does not change because the paperwork was sorted out afterwards.

### Reconciliation

```
metered mass = Σ (ticket litres × ticket density)
FQIS mass    = fob_after_kg − fob_before_kg
variance     = metered − FQIS
```

Computed **at delivery level, always**. Attribution to a supplier requires `supplier_count = 1`.

**Multi-supplier deliveries: variance is recorded, never disputed.** One FQIS pair across two suppliers produces one figure belonging to neither. Pro-rata allocation by volume is arithmetically neat and evidentially worthless.

**`supplier_count` resolves transitively.** `FUEL_TICKETS` carries only a free-text `supplier_ticket_ref`; the supplier lives on the order. B2 forces this anyway — a direct delivery-to-order FK breaks either the two-supplier case or the two-delivery case.

**An unresolvable supplier makes the set unknown, not a singleton.** One known supplier alongside an unmatched ticket is `NOT_ATTRIBUTABLE`, not attributable-to-the-one-we-know. Same reasoning as `NOT_RECONCILED`: unknown is not agreement.

**Attribution is not something a small variance earns.** A two-supplier delivery varying by 12 kg on 19 tonnes still does not attribute. The obstacle is that the figure belongs to neither party, and a small figure belongs to neither just as completely as a large one.

Bowser and supplier bias analysis **excludes** multi-supplier deliveries, or the noise swamps the signal.

### Tolerance resolves partly from the FQIS source

Without ACARS, fuel on board is crew-reported and typically rounded to 100 kg — 0.9% of a narrowbody uplift, 25% of a small top-up. An ACARS delivery and a crew-reported one cannot be held to the same threshold.

**A missing gauge reading is `NOT_RECONCILED`, never a pass.** Unknown is not agreement.

### Validation that must NOT be written

**Do not require ticket B to start after ticket A ends.** Parallel bowsers are legitimate. Enforcing sequence fails every two-bowser widebody turn.

### Signature — BUILT, placement unresolved

`pilot_signature` and `ground_crew_signature` sit on `FUEL_DELIVERIES`. Whether they belong per ticket or per delivery is open point F3.

**A signature is proof that delivery occurred. It is not acceptance of quantity.** IATA's model agreement is explicit: no waiver of the right to claim is made or implied by a signature on the delivery note.

Consequence: **a signed ticket may still be disputed**, and no reconciliation exception is ever suppressed because an ePOD exists.

---

## 4. Fuel burn and the ledger — `burn-service.js` · PARTIAL

1,177 lines. The largest implemented service.

### Ingest — BUILT

ACARS and EFB ingest, Excel imports, a variance ladder, ROB entries, confirm and reject, `adjustROB`. Duplicate detection by `source_message_id` raising `FB403`, with an in-memory set on `tail_number` + `burn_date` for Excel.

**Group D item 8: keep the idempotency**, alongside staging supersession when WP-15 arrives. They are complementary controls, not alternatives.

### The variance ladder is unreachable — ABSENT in effect

`planned_burn_kg` is hardcoded to `0` on the ACARS path, so `if (plannedBurnKg > 0)` never fires. **Every ACARS ingest stores `NORMAL` with zero variance**, and the exception code below is dead.

Defect D10. Fixing it means populating the planned figure from the active plan version — which needs `FLIGHT_DISPATCH` to carry a fuel stack, WP-18.

**The ladder is correct. Its input is missing.** Do not rewrite the ladder.

### The ledger — BUILT under WP-03

```
closing_rob_kg = opening_rob_kg + uplift_kg − burn_kg + adjustment_kg
```

`ROB_LEDGER` carries all four components plus associations to `FUEL_BURNS`, `FUEL_DELIVERIES` and `FLIGHT_SCHEDULE`.

**A negative computed balance writes no row.** `FB402` carries the value and all four inputs; `@assert.range: [0, null]` stays. Decision B8.

**Subsequent events for that tail continue to be recorded.** A broken chain must not stop the airline operating.

`recalculateROB` rebuilds a corrupted chain in `(record_date, record_time, sequence)` order. Recorded `uplift_kg`, `burn_kg` and `adjustment_kg` are **never rewritten** — only opening and closing are re-derived, so physical events survive a rebuild.

### Two gaps that compound — F14 and F15

**Nothing creates a ledger entry from an ePOD delivery.** `UPLIFT` entries come only from the Excel import. So the ledger's primary purpose — detecting an uncaptured uplift — depends on someone remembering to feed it.

**A chain break leaves no durable record.** `FB402` is visible in the response and in the missing row, but no queue holds it. Neither `FUEL_BURN_EXCEPTIONS` nor `ERROR_LOGS` fits, and raising the error rolls back anything written in the same handler.

**These compound.** A missing uplift is the most likely cause of a negative balance — and the alarm has nowhere to land. **The detector has a blind input and no output.** Take both in one package.

---

## 5. Inbound feeds and staging — ABSENT · WP-15

Every feed writes directly to its target today. 26 validation rules and roughly 26 scenarios wait on this.

### Why staging

Without it, a malformed record has two options: rejected silently, or corrupts the target. Neither is recoverable.

Staging also answers a question the target cannot: **did the feed arrive at all?**

### Required behaviour

**Identity before content.** Resolve which business record an inbound row refers to before validating its fields. A row that fails content validation is still attributable.

**Supersession.** Three failing arrivals for one business key produce **one** actionable item, not three. The latest supersedes; the earlier ones are retained as history.

**Change type against the latest staging record**, not the target. Comparing to the applied value makes a reversal look like a no-change — the record matches what was applied, but differs from what was last received.

**Staleness wins over change type.** A record older than what is already applied is stale, and that determination precedes any change-type evaluation.

**Correction in staging, never in the target.** A user corrects the staged row and reprocesses. Correcting the target means the next feed overwrites the fix.

**A source change timestamp is mandatory** — MC-01. Without it, out-of-order arrivals corrupt data with no detection possible. This is not negotiable and not workaroundable.

### The empty-response guard generalises

The master data sync already aborts before deleting when the source returns zero rows. **Every full-replace feed needs the same guard.** Group D item 9.

---

## 6. Master data — `master-data-service.js` · PARTIAL

227 lines. On-demand S/4 sync for countries, plants and suppliers.

### Full replace works, but the pattern is wrong

Delete then insert, atomic on the request path — CAP's ambient transaction, measured under WP-01.

**Open point F12, high priority: replace with upsert.** The table is never empty, a failure affects one row not all, audit history survives, and what changed is visible.

**The blocking question is not technical.** When S/4 stops sending a supplier, what happens to the tickets and orders that reference it? Mark inactive and continue resolving, mark inactive and block new use, or delete and orphan. That is a product decision.

Note that `s4-sync-config.js` holds a commented-out `SuppliersVendor` feed targeting the same table as `Suppliers`. Under full-replace semantics two feeds against one table cannot coexist — the second wipes the first. **Enabling it is gated on F12.**

### Provisional records — ABSENT · WP-16

Auto-provisioning exists in effect: an unknown reference proceeds. What is missing is the **lifecycle**.

| Status | Ticket capture | Order creation | Posting |
|---|---|---|---|
| PROVISIONAL | Yes | **No** | No |
| CONFIRMED | Yes | Yes | Yes |

**Provisional status is time-boxed.** An indefinitely provisional record is a permanent hole in validation, so it escalates.

### Aircraft — WP-07

`AIRCRAFT_MASTER` is a type master keyed on `type_code`. There is no aircraft register; every individual aircraft is a free-text string.

Behaviour once `AIRCRAFT_REGISTRATIONS` exists: an unknown registration **auto-provisions** so the flight record applies and fuel can be recorded. Order creation is blocked until confirmed. Two confirmations are needed before an order — the aircraft itself, and the leg's tail assignment.

---

## 7. Configuration resolution — ABSENT · WP-13

The columns exist and the logic does not. `TOLERANCE_RULES`, `ALLOCATION_RULES`, `COST_CENTER_MAPPING`, `PRICING_CONFIGURATIONS` and the pricing formulas all carry `valid_from`, `valid_to` and `priority`. **No handler selects by date or orders by priority.**

Meanwhile the enforced values are hardcoded literals: burn variance 5/10/20, delivery variance ±5%, temperature −40/+50, density 0.775/0.840.

### Required behaviour

**Resolve by specificity, then date.** Highest `priority` whose scope matches and whose date window contains the transaction date. A global rule must always exist so resolution never fails.

**Resolve at transaction date, never query date.** A tolerance changed in March does not re-evaluate January.

**Record what applied.** Configuration says what *should* apply; an applied-value record says what *did*, and which row produced it. Only the second survives a challenge eighteen months later.

**Honour the rule's own flags.** `TOLERANCE_RULES` carries `block_on_exceed` and `require_dual_approval`. Group D item 4: these belong on the rule, not in scattered handler logic.

### Migration

The hardcoded values move into configuration **unchanged**. −40/+50 and 0.775/0.840 implement documented rules `EPD403` and `EPD404`. They are not arbitrary.

### A guard should flag, not early-return

Open point F16. WP-05 found a guard using `req.error` then `return`, where the return also skipped a `total_amount` calculation further down. The rejected record ended up with no quantity **and** no total, with nothing indicating the second was a side effect.

**Check what sits below a guard before adding one.**

---

## 8. Pricing — declaration only · WP-20

`PricingService` has no handlers. `PRICING_FORMULAS`, `FORMULA_COMPONENTS`, `MARKET_INDICES`, `MARKET_INDEX_VALUES`, `DERIVED_PRICES` all exist and are seeded.

### Scope

**The engine calculates the basic fuel price only:** index, differential, and into-plane charges where the fuel supplier also performs into-plane. Tax and duty **amounts** are calculated by SAP from a tax code. FuelSphere determines the code.

### Engine selection is per contract

`PRICING_CONFIGURATIONS.engine_mode` already carries `NATIVE`, `CPE`, `HYBRID` with `fallback_enabled` and `cpe_endpoint_url`, effective-dated at company code level.

Mixed deployments are normal — major contracts on CPE, ad hoc stations on native or posted. **A contract may not specify CPE where CPE is unavailable**, and that is caught at configuration time, not when an invoice is being matched.

### Provisional and final

A contract priced on a monthly average cannot be priced at uplift.

```
At uplift    → provisional price from the contracted proxy
Period close → final price from the published average
Difference   → credit or debit note
```

Three consequences: the invoice price variance check is **suppressed** while provisional; provisional-to-final exposure is a **distinct accrual**; and tankering benefit measured on provisional prices is not final until the price is.

### Restatements reprice

Publications revise historical assessments. The original value is retained and anything priced on that date reprices.

### Components stay separate

Differential, into-plane, throughput and levies are held individually, never folded into a unit price. That is what makes a variance actionable — *"the differential is 0.019 above contract while the index matches"* rather than an unexplained total.

`FORMULA_COMPONENTS` already supports caps, floors, conditional components and per-component currency. **Do not simplify it.**

---

## 9. Invoice — declaration only · WP-21

`InvoiceService` has no handlers. `executeThreeWayMatch`, `postToS4HANA` and `checkDuplicate` are declared and empty.

### Three-way match

Order, delivery and invoice line. **Duplicate detection is separate from the match** — a duplicate line is a *valid* line in the wrong place, so it passes every quantity and price check.

**Price variance decomposed by component.** "0.019 above contract" is unusable; "the differential is above while the index matches" is a supplier conversation.

### Header totals derive from lines

Never accepted as stated.

### Unbilled exposure

Delivered fuel with no invoice line is reported, so a later period cannot double-pay it.

### Claim windows are deadlines, not ageing

Industry model terms: short delivery notified **at the time of delivery**, written claim within **15 days**. Quality defects within **30 days**. After that the right is waived.

| | Ordinary exception | Claim window |
|---|---|---|
| The clock measures | How long we neglected it | How long the right survives |
| Sort order | Oldest first | **Least time remaining first** |
| Escalation | After a threshold | **Before the deadline** |
| Closing without action | Acceptable | Write-off requiring authorisation |

**Two clocks.** Notification at delivery and the written claim are separate obligations. A variance found after departure with no notification given may already be impaired, however fast the written claim follows.

Windows resolve from the contract by claim type. The model agreement default applies only where none is configured.

---

## 10. Posting — ABSENT · WP-23

S/4 posting is simulated: `s4_po_number` and `s4_gr_number` are random. 17 validation rules wait on this.

### Division of responsibility

**SAP derives the GL account** through standard OBYC determination. FuelSphere supplies the **movement type** and the **cost object**.

```
1. FuelSphere  movement type, resolved by event category and scope
2. FuelSphere  cost object, resolved by scope
3. FuelSphere  BAPI_GOODSMVT_CREATE
4. SAP         T156X derives the account modification
5. SAP         OBYC GBB + modification + valuation class → GL account
```

**`GL_ACCOUNT` is never populated on the interface.** Supplying it bypasses the customer's own configuration.

### Separate movement types split the GL

One material with one valuation class cannot post to two accounts unless the movement type differs. Engine burn and APU burn therefore use distinct custom movement types.

Every movement type carries a **reversal counterpart** — burn data improves, and revision reverses and reposts rather than adjusting in place.

### Cost object resolves per event, not per leg

Engine and APU burn on the same leg may resolve differently. A GLOBAL rule must always exist; posting never fails for want of a cost object.

**Determination is stamped at posting and never re-resolved.** A later configuration change cannot alter how an already-posted event was assigned.

---

## 11. Completeness and reconciliation — ABSENT · WP-22

### Absence is not a gap

Three legitimate reasons for a leg to have no ticket: the aircraft arrived with sufficient fuel, the leg is not fuel-processed, or the flight was cancelled before fuelling.

**Expectation is derived, not assumed:**

| Condition | Expectation |
|---|---|
| Processing mode NONE | NOT_EXPECTED — excluded entirely |
| No plan received | INDETERMINATE — neither gap nor legitimate absence |
| Required uplift ≤ 0 | NOT_EXPECTED — arrived with enough fuel |
| Required uplift > 0 | EXPECTED — a ticket should exist |

Without this, every short sector and tankered rotation reads as a missing ticket and the queue becomes noise.

**Capture and posting are separate dimensions.** A delivered uplift with no goods receipt is captured but not posted — a different problem with a different owner.

### Stock reconciliation uses a cutoff event, not a time

At any clock instant aircraft are airborne, consuming fuel with no gauge reading. A timestamp cutoff guarantees a difference on every airborne tail, every month, structurally.

**Each tail reconciles at its last on-blocks before period end.** Different clock time per tail, same accounting period, fuel static. A tail airborne through the whole window is excluded with a reason.

### Decompose before assigning a status

```
explained  = unposted_burn + unposted_apu − unposted_uplift
unexplained = (sap_stock − reported_fob) − explained
```

**UNEXPLAINED takes precedence over TIMING_ONLY.** A material timing difference is still reported even when nothing is unexplained, because it is the accrual basis. A status reading RECONCILED while 9,000 kg sits unposted defeats the control.

**Tolerance scales with quantity on board.** A fixed absolute tolerance fails every widebody.

---

## 12. Carrier arrangements — ABSENT · WP-24

13 validation rules wait on this. Nothing exists in schema or code.

### Two independent variables

**Who buys the fuel** determines whether an order, ticket and supplier invoice exist. **Who bears the cost** determines allocation and recharge direction. They need not align.

| Buys | Bears | Result |
|---|---|---|
| Us | Us | Full processing |
| Us | Counterparty | Full processing plus outbound recharge |
| Counterparty | Us | No order or ticket; cost arrives as a counterparty invoice |
| Counterparty | Counterparty | No fuel processing at all |

A lessee with strong station contracts may buy fuel where the lessor bears the cost. An ACMI-plus-fuel arrangement needs no fuel processing.

### Resolution

By scope, most specific first, with **registration outranking flight number** — a lease governs the aircraft, so lease terms apply whatever number it operates.

**A missing arrangement is an exception, never a default.** Defaulting to full processing raises fuel orders for partner-operated flights.

---

## 13. Authorisation — `authorization.cds` · PARTIAL

### Fixed under WP-02

93 occurrences of `'any'` removed across 69 grants. Every grant now names real scopes.

### Still open

**D22 — eleven bound actions are denied under real authorisation**, for every user including one holding all scopes. CAP matches a bound action against the entity's `@restrict` for a grant naming that action; entity-level CRUD does not imply it. WP-02B.

**D23 — `authorization.cds` covers 4 of 15 services.** `PlanningService` (610 lines) and `RefuelerService` (235 lines) are implemented with no authorisation of any kind, not even a service-level `@requires`.

**D14 — zero `where:` clauses.** `CompanyCode`, `Plant` and `CostCenter` attributes are declared and never used to filter. WP-14.

### Local development proves nothing about authorisation

Dev auth is `kind: 'dummy'` — every request is privileged and `@restrict` is never evaluated. **This is why 93 `'any'` entries survived unnoticed.** Testing authorisation requires overriding to `mocked` **and** supplying the users map in the same override, or the existing users are discarded.

---

## 14. What is deliberately not specified here

| Item | Where |
|---|---|
| Chain restart after a ledger break | F11 |
| Durable sink for chain-break exceptions | F14 |
| ePOD delivery creating a ledger entry | F15 |
| Signature placement — ticket or delivery | F3 |
| Refuelling event window duration | F2 |
| Master data upsert and the inactive-record question | F12 |
| Optimistic locking carrier | C5, D5 |
| Order mode — uplift or on-board | IATA-30 |
| Invoice four-level structure | IATA-31 |
| Currency conversion mechanism and factors | IATA-32 |

**Do not invent any of these.** Each is deferred deliberately, with reasoning in `00-DECISIONS.md`.

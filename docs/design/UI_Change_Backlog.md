# UI Change Backlog

**FuelSphere · accumulated UI changes, to be implemented together**
Opened 18 August 2026

---

## How this works

Items are added as they are found, and implemented as one package rather than one at a time. Annotation changes are cheap individually and expensive to review repeatedly.

**This is a backlog, not a specification.** Nothing here is authorised until it becomes a work package.

| Status | Meaning |
|---|---|
| **OPEN** | Recorded, not yet built |
| **IN PACKAGE** | Assigned to a named work package |
| **DONE** | Merged, with the PR noted |

---

## Resolved — what the launchpad investigation settled

**22 August.** Three questions that shaped every item below are now answered.

**The four deployed apps are in four separate public repositories** — `kalpesh0304/fuelorders`, `fuelTickets`, `flightDispatch`, `flightSchedule`. One "Initial version" commit each, 6 August, all within fifteen minutes.

**Every app's `annotations/annotation.xml` is an EMPTY STUB.** Zero targets. **Every column, filter and facet comes from `srv/*-fiori-annotations.cds` through `$metadata`** — so annotation changes made in FuelSphere reach the deployed screens directly, with no app change and no extension.

> **That makes UI-B-03 the UI work itself, not a preliminary to it.**

**And `flightSchedule` binds to `PlanningService`**, the rich set — 12 columns, 7 filters, 7 facets. The thin `FuelOrderService.FlightSchedule` is not what is deployed. **But see F36:** its bundled metadata names `Flights` where the service says `FlightSchedule`, and whether it binds is unconfirmed.

---

## Open

### UI-B-04 — Invoice Worklist is bound to three fields that do not exist

**Status: OPEN. Blocker for the demo — it is step 9 of the flow.**

Defect **D32**. The Invoicing app reads `invoice_status`, `supplier_name` and `total_amount`. The entity has `status`, a `supplier` **association**, and `net_amount` / `tax_amount` / `gross_amount`.

| On screen | |
|---|---|
| Supplier and Amount columns | `--` on every row |
| Every status badge | empty string |
| "Posted" | always 0 |
| "Pending" | always equals the total |
| **The Exception Queue** | **always reads "No exceptions — all clear"** |

**Roughly two hours.** Rebind three fields and make the queue read the real exceptions.

### UI-B-05 — Invoicing is three screens, not one

**Status: OPEN.** Moved from Deferred to Core on the SME session, 21 August: *this is where the money goes out and where the biggest industry pain sits.*

| Screen | |
|---|---|
| **Invoice Worklist** | Exists, broken — UI-B-04 |
| **Invoice Exceptions** | New. The registry WP-21A built, and nothing surfaces it |
| **Payment Status** | New. **Unposted, unpaid, and running late against a claim window** |

**Claim windows sort by TIME REMAINING, not by age.** The one that expires first escalates, whatever its age.

### UI-B-06 — Two worklist variants

**Status: OPEN.** Neither is a new application — both are a filter and a column set on an entity that already renders.

**Reconciliation Worklist.** `FUEL_DELIVERIES` filtered to `VARIANCE`, `NOT_RECONCILED`, `NOT_ATTRIBUTABLE`. **Not `RECONCILED`** — a worklist showing everything is a report. The variance never appears without the tolerance beside it.

**Payment Status.** As above.

### UI-B-07 — Fuel Planner Dashboard

**Status: OPEN. Designed** — see `docs/Dashboard_Design.md`.

**Four tiles, no chart.** Cut from eight: two of the original tiles cannot be built at all, and the rest were totals rather than tasks.

| Tile | Counts |
|---|---|
| Deliveries needing review | `recon_status = VARIANCE` |
| Unreconciled | `NOT_RECONCILED` — **never reads as good** |
| Unmatched tickets | `match_status = UNMATCHED` — blue, not red |
| Invoices with open exceptions | gating posting |

Every tile drills through carrying its filter. **Every count comes from seeded data** — a tile whose number cannot be produced does not appear.


### UI-B-01 · Standard search fields on every entity

**Status: OPEN**

Add `UI.SelectionFields` for these three on every entity that carries them:

| Field | Note |
|---|---|
| **Aircraft registration** | `aircraft_reg` on flight schedule, ticket and delivery; `tail_number` on dispatch, burn, ROB ledger and burn exceptions; `registration` on the aircraft register. **Seven different field names for the same thing** — see WP-07B |
| **Flight number** | `flight_number` on schedule and dispatch. Reached through an association elsewhere |
| **Flight date** | `flight_date` on schedule and dispatch. Other entities carry their own date — uplift date, burn date, record date |

**Why it matters.** A user investigating a discrepancy starts from one of three things: a tail, a flight, or a date. Every screen should accept all three.

**Two complications to resolve when this is built:**

**The field name differs by entity.** Seven names for the registration. The filter bar can present one label — *Aircraft Registration* — over whichever field the entity carries, so the user sees one search regardless.

**Some entities reach these only by association.** A fuel ticket has no flight number of its own; it reaches one through order → dispatch → schedule. Filtering across an association is possible but not free, and it may be better to expose the flight number as a denormalised read-only field on the ticket than to filter three hops away.

**Depends on:** nothing. Can be built now. But **WP-07B** would collapse the seven registration fields into one association, which would simplify this considerably — worth checking the sequence before starting.

---

### UI-B-02 · Aircraft registration on the fuel order

**Status: OPEN. Needs a decision before it is built — see below.**

`FUEL_ORDERS` does not show the aircraft registration. **The fuel order is the instruction sent to the supplier**, and the fueller needs to know which aircraft — a stand number and a flight number are not enough, because aircraft get swapped and stands get reassigned. The registration is what is painted on the fuselage.

Both standards require it. **AIDX Fuel Order** carries aircraft registration; **AFSMA** requires it on the Delivery Note, which is what the ticket becomes.

> Note this is the **fuel order**, not the SAP PO. Decision C-3 makes the PO internal and never shared. The fuel order is a different document and it does go to the supplier.

#### The decision — navigate or denormalise

The order links to the flight schedule, which carries `aircraft_reg`. So the value is reachable. The question is what happens when the tail changes **after** the order is placed.

| | Effect |
|---|---|
| **Navigate** — read from the schedule | Always current. But the order document the supplier holds says nothing, and the supplier is never told |
| **Denormalise** — copy onto the order | The order is a snapshot of what was sent. It goes stale on a tail swap — **which is correct** |

**RESOLVED 18 August 2026 — neither, quite.** The registration comes from the **dispatch plan**, not from the schedule.

Decision A7 as extended: each plan supersedes the last, the order is created against the latest, and **a tail swap produces a new plan carrying the new tail.** So the order inherits its registration from the plan it was made against.

That removes the drift problem rather than choosing a side of it. An order whose plan has since been superseded has a stale tail **by construction**, and the amendment trigger is simply *is this order's plan still the active one?* — no field comparison required.

**WP-18 has landed** — `plan_status`, `superseded_by` and `FUEL_ORDERS.dispatch_plan` all exist. This is now a placement question rather than a design one, and `dispatch_plan` is one of UI-B-03's twenty-two unplaced fields. Formerly depends on WP-18, which must add three things before this can be built: a version on `FLIGHT_DISPATCH`, a supersession flag, and — the one most easily missed — **a reference from the order to the plan.** `FUEL_ORDERS` links to `FLIGHT_SCHEDULE` and to no plan at all.

**Not annotation-only, and not part of UI-B-01.** Blocked on WP-18.

---

### UI-B-03 — Twenty-two fields carry a label and no placement

**Status: OPEN. This is the largest item and it is the input to the next UI package.**

Surveyed against the PR #45 boundary. Every one of the twenty-two has a `@title`; **one appears on a screen.**

| Entity | Added | Placed |
|---|---|---|
| `FLIGHT_SCHEDULE` | 2 | **0** |
| `FLIGHT_DISPATCH` | 17 | **1** |
| `FUEL_ORDERS` | 1 | **0** |
| `FUEL_DELIVERIES` | 1 | **0** |
| `FUEL_TICKETS` | 1 | **0** |

**WP-18 — the regulated stack and versioning, 17 on `FLIGHT_DISPATCH`.** `trip_fuel_kg` is the only placed field of the twenty-two. Unplaced: `contingency_fuel_kg`, `alternate_fuel_kg`, `final_reserve_kg`, `additional_fuel_kg`, `taxi_fuel_kg`, `extra_fuel_kg`, `block_fuel_kg`, `required_uplift_kg`, `plan_group_id`, `plan_version`, `plan_version_source`, `plan_status`, `superseded_by`, `version_gap_flag`, `versions_skipped`, `tail`.

**WP-18 — `FUEL_ORDERS.dispatch_plan`.** The order-to-plan link, which is what makes an order stale when its plan is superseded. **Not visible**, so the staleness cannot be seen.

**WP-07B — four `tail` associations plus `FLIGHT_SCHEDULE.flight_leg_id`.**

### And the scope is wider than five entities

WP-13, WP-19, WP-20 and WP-21A added nothing to those five. Their fields went to `APU_USAGE`, `DERIVED_PRICES`, `PRICE_DERIVATION_LOGS`, the `INVOICE_*` entities, `TOLERANCE_RULES` and `AIRCRAFT_REGISTRATIONS` — **most of which have no annotation file at all.** Four packages of work with no surface.

---

## In package

*None.*

---

## Done

### UI-01 · Surface the Phase 1 fields
Fields added by WP-07, WP-10, WP-11, WP-12 and WP-17 appeared in no annotation. **PR #43.**

### UI-02 · Meaningful column titles
41 labels, zero underscored fields. Found that `@Common.Label` beats `@title`, so WP-UI-01's dual annotations had made every `@title` dead text. **PR #45.**

---

## Notes carried from earlier packages

**Annotations in this repository reach `$fiori-preview` and `$metadata` only.** **CONFIRMED AGAIN, and more strongly, on 21 August:** three of the four launchpad names — *Manage Fuel Orders*, *Manage Fuel Tickets*, *Manage Flight Dispatch* — appear **nowhere in this repository at all**, not even as `TypeNamePlural`. Only *Flight Schedule* exists as one. The actual values are `Fuel Orders`, `Fuel Tickets`, `Flight Dispatches`; **the "Manage" prefix matches nothing.** Nothing under `app/` has gained a `manifest.json` or `Component.js`. **Those tiles are served from somewhere that is not this repository, and that is now certain rather than suspected.** The five apps under `app/` are freestyle and read no annotations. Where the named apps are served from is still open.

**One label annotation per field.** `@title` only. A field carrying both `@title` and `@Common.Label` has a dead `@title`.

**Verify from `$metadata`, never from the source.** The CDS model and the emitted metadata are different surfaces — `cds.model.elements` holds `sales_order` where OData emits `sales_order_ID`.

**A CDS annotation binds to whatever declaration follows it.** Inserting a block between an annotation and its target silently reassigns it, and `cds compile` returns 0. Run the definition-count tripwire on any annotation package.

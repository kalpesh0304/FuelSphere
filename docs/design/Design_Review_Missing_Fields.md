# Design Review — Missing Fields Across the Chain

**FuelSphere · schedule, dispatch, order, ticket, delivery**
24 August 2026

---

## 0. How to read this, and a warning about it

I have asserted schema facts wrongly three times in the last day — the annotation coverage, the behaviour of `@assert.range` on numerics, and three fields I invented outright. **Two of the three were caught by someone checking rather than by me.**

So every item below carries a confidence marker, and **§8 is a survey prompt.** Verify before building.

| | |
|---|---|
| **ESTABLISHED** | Confirmed by a survey, a measurement, or a merged package |
| **INFERRED** | Follows from a recorded decision, and the field has not been sighted |
| **QUESTION** | A gap in the design, not only in the schema |

---

## 0A. DECISIONS — 24 August

| | | |
|---|---|---|
| `FLIGHT_SCHEDULE` | diversion / actual destination | **REJECTED** |
| `FLIGHT_SCHEDULE` | tech log reference | **ACCEPTED** — WP-31 |
| `FLIGHT_DISPATCH` | alternate airport | **REJECTED** |
| `FLIGHT_DISPATCH` | planned payload / ZFW | **REJECTED** |
| `FLIGHT_DISPATCH` | release time and validity | **NOT ADDRESSED** — see below |
| `FUEL_ORDERS` | communication to supplier | **ACCEPTED** |
| `FUEL_ORDERS` | amendment lineage | **ACCEPTED** |
| `FUEL_ORDERS` | tankering | **ACCEPTED** |
| `FUEL_TICKETS` | vehicle and meter identity | **ACCEPTED** |
| `FUEL_TICKETS` | next sector destination | **REJECTED** |
| `FUEL_DELIVERIES` | refuelling window | **ACCEPTED** |

### Why the alternates were rejected, and it is the right boundary

**A diversion alternate depends on where the diversion happens.** One flight may have several, resolved in flight against fuel remaining and weather — so it is a 1:N table, and it belongs to the **flight dispatch system**, not here.

FuelSphere consumes `alternate_fuel_kg` because it is part of the regulated stack that determines the uplift. **It does not need the reasoning that produced it**, and modelling that reasoning would import a planning function this system does not own.

Same argument retires the diversion fields and the planned payload: **the dispatch system knows what it assumed; FuelSphere receives the number.**

### Two candidates were not addressed

**`FUEL_DELIVERIES` — the refuelling window. ACCEPTED 24 August.** **Three recorded open points turn on it:** F2 the refuelling window itself, F20 the second ground gap, F22 the missing completion signal. Without `refuel_start_utc` and `refuel_end_utc`, none of the three can be closed and the gap between `fob_after` and push-back stays uncaptured.

**`FLIGHT_DISPATCH` — release time and validity.** Lower stakes. If it follows the alternates into the dispatch system's territory that is a consistent answer, but **a plan with no validity can be used stale** and nothing would say so.

---

## 1. Summary

**Ten fields are already specified and unbuilt.** Those are WP-19B.

**Beyond them, eleven candidate gaps** — and four are consequences of decisions already taken, which puts them in the same class as D28's four parameters: *decided, with no field behind it.*

| Entity | Specified, unbuilt | Candidate |
|---|---|---|
| `FLIGHT_SCHEDULE` | 10 | 2 |
| `FLIGHT_DISPATCH` | — | 3 |
| `FUEL_ORDERS` | — | 3 |
| `FUEL_TICKETS` | — | 2 |
| `FUEL_DELIVERIES` | — | 1 |

---

## 2. `FLIGHT_SCHEDULE`

### Already specified — WP-19B

**ESTABLISHED.** The entity carries `aobt`, `atot`, `aldt` and `aibt` as timestamps and **no fuel figure at any of them**, and nothing anywhere carries a closure or start timestamp.

```
fob_at_out_kg  ·  fob_at_off_kg  ·  fob_at_on_kg  ·  fob_at_in_kg  ·  fob_source
flight_closure_utc  ·  closure_source  ·  flight_start_utc  ·  start_source
```

### Candidate 1 · Diversion — **QUESTION**

**A flight that lands somewhere other than its destination has nowhere to say so.**

`destination` and `destination_airport` are the *planned* arrival. If `AC 412` diverts from YUL to YOW:

| | |
|---|---|
| The burn is different | Longer, and against a plan computed for a different sector |
| **The uplift is at a different station** | A different contract, a different supplier, possibly no contract at all |
| The alternate fuel was consumed | Which is what it existed for, and nothing records that it was |

**This is not an edge case.** Diversion is why `alternate_fuel_kg` is on the dispatch plan at all, and the design has no way to record that the alternate was used.

Candidate fields: `actual_destination`, `diversion_reason`, `diversion_at`.

> **Ask before building.** Does the ops feed carry a diversion indicator, and does the airline want the diverted sector as a new flight record or as an amendment to this one? **They are different data models**, and the answer determines the shape.

### Candidate 2 · Tech log reference — **INFERRED**

WP-31's `closure_document`. Listed there; noted here so the entity's picture is complete.

---

## 3. `FLIGHT_DISPATCH`

### Candidate 1 · Which alternate — **INFERRED**

**`alternate_fuel_kg` exists. The alternate airport does not.**

A figure with no destination attached cannot be checked, cannot be explained to a regulator, and cannot be compared when the plan is revised. `2,200 kg` means nothing without `LGW` beside it.

Candidate: `alternate_airport`, and possibly `second_alternate_airport` — long-haul plans routinely carry two.

**Low cost, and it makes an existing figure defensible.**

### Candidate 2 · Planned payload — **QUESTION**

**The plan assumed a weight. Nothing records what it assumed.**

WP-19's burn variance compares actual against `trip_fuel_kg`. When a leg burns 3% above plan, **the largest single cause is that it carried more than the plan assumed** — and without `planned_zfw_kg` the variance is computed and unattributable.

`booked_passengers`, `boarded_passengers` and `cargo_kg` are on the schedule and record the **actual**. The plan's assumption is absent.

> **This is F37's cousin.** A variance that cannot be explained trains people to ignore variances.

### Candidate 3 · Who released it, and when — **QUESTION**

`managed` gives `createdBy` and `createdAt` — **when the row was written, not when the plan was released.** For a plan that arrives on a feed those are the same moment; for one entered by hand they are not.

More importantly: **a plan has a validity.** A dispatch calculation issued four hours before departure and used eight hours later is stale, and nothing says so.

Candidate: `released_at`, `released_by`, `valid_until`.

---

## 4. `FUEL_ORDERS`

### Candidate 1 · Communication to the supplier — **ESTABLISHED as a gap**

**Decision C-3 gates on whether the order has been communicated:**

```
plan revised BEFORE communication   →  amend in place
plan revised AFTER  communication   →  NEW incremental order
```

**Nothing records that an order was communicated.** No `communicated_at`, no `communication_status`, no transmission of any kind — REQ-INT-003 says FuelSphere publishes a protocol and the customer conforms, and nothing implements it.

So **the gate has no field**, and C-3 cannot be implemented as written.

Candidate: `communicated_at`, `communication_status`, `communication_reference`.

> **Same shape as D28's four parameters.** A decision taken, and no field behind it. This one is worse, because the decision has two branches and neither can be chosen.

### Candidate 2 · Amendment lineage — **INFERRED**

C-3's second branch creates an **incremental order**. Nothing links it to the original.

Without `parent_order`, a station with two orders for one flight cannot tell an incremental from a duplicate — **and that is precisely the distinction the invoice duplicate check depends on.**

Candidate: `parent_order`, `order_relationship` (`ORIGINAL` · `AMENDMENT` · `INCREMENTAL`).

### Candidate 3 · Tankering — **QUESTION**

**Tankering is an accepted operation** and the SME confirmed the ticket captures the next sector's destination.

The dispatch plan carries `extra_fuel_kg`, but nothing says the extra is *for tankering* rather than for weather, a known delay, or crew request. **The reason matters commercially** — tankered fuel is a deliberate arbitrage whose benefit is measured, and other extra fuel is a cost.

And WP-20 recorded that **tankering benefit measured on a provisional price can reverse** when the price finalises. That measurement needs to know which uplifts were tankering.

Candidate: `is_tankering`, `tankering_sectors`, or a reason code on `extra_fuel_kg`.

---

## 5. `FUEL_TICKETS`

### Candidate 1 · Vehicle identity — **INFERRED**

**Scenario 2 has two bowsers.** Today they are distinguishable only because their meter ranges differ — `200,000` and `400,000`.

**That is a coincidence of the seed, not a model.** Two vehicles from the same supplier with overlapping meter ranges would be indistinguishable, and the same vehicle appearing twice on one delivery could not be detected.

Candidate: `vehicle_id`, `meter_serial`.

**The document specification already lists `meter_serial` as an OCR-extracted value from the bowser meter image** — so WP-31 assumes a home for it that does not exist.

### Candidate 2 · Next sector — **INFERRED**

The SME's tankering note: *the ticket captures the next sector destination.*

Candidate: `next_sector_destination`, or a resolution through the tankering fields on the order.

---

## 6. `FUEL_DELIVERIES`

### Candidate 1 · Refuelling window — **ESTABLISHED as a gap**

**Open point F2, and it has four sub-questions including one that blocks the rest: no completion signal exists on the manual path.**

`fob_before_kg` and `fob_after_kg` say what the gauge read. **Nothing says when refuelling started or finished.**

Consequences already recorded:

| | |
|---|---|
| **The second ground gap** | **F20.** `fob_after` to `fob_at_OUT` is uncaptured. Between them the APU may run and the aircraft may sit for an hour |
| **The completion signal** | **F22.** IATA's message carries one; the manual path has none, so nothing knows a delivery is finished rather than in progress |

Candidate: `refuel_start_utc`, `refuel_end_utc`, `refuel_complete`.

> **The ground gap is split at flight closure by C-4. The second gap is a different problem** — it sits after refuelling and before push-back, and closure does not divide it.

---

## 7. What I looked for and did not find a gap in

Stated so the review can be judged on what it excluded as well as what it found.

| | |
|---|---|
| **Density and its provenance** | WP-11 built `density_value`, `density_basis`, `conversion_density`, `conversion_source`. Complete |
| **Unit of measure** | WP-11's `uom_code` plus the SAP mapping. Complete |
| **Reconciliation evidence** | WP-17 records the tolerance and which row produced it. Complete |
| **Plan versioning** | WP-18 is thorough — `plan_group_id`, version, source, status, supersession, gap detection |
| **Ticket without order** | WP-10, and the number-allocation timing is right |
| **Tail resolution** | WP-07B keeps the string beside the association. Correct |

---

## 8. Verify before building

```
Read-only. Do not change anything.

I have compiled a list of candidate missing fields and I need it
checked against the schema rather than believed. I have asserted
schema facts wrongly three times recently, so please correct me
rather than agree with me.

For each of FLIGHT_SCHEDULE, FLIGHT_DISPATCH, FUEL_ORDERS,
FUEL_TICKETS and FUEL_DELIVERIES, list EVERY element with its type,
whether it is @mandatory, and whether it is an association. I would
rather have the full list than a targeted search — a targeted search
is how I convinced myself of things that were not there.

Then, specifically, does any field exist for:

  FLIGHT_SCHEDULE   an ACTUAL destination distinct from the planned
                    one; a diversion indicator or reason
  FLIGHT_DISPATCH   the alternate AIRPORT, not just alternate fuel;
                    a planned zero-fuel weight or payload
                    assumption; a plan release time or validity
  FUEL_ORDERS       anything recording that the order was
                    COMMUNICATED to the supplier; a parent or
                    predecessor order; anything marking an uplift as
                    tankering
  FUEL_TICKETS      a vehicle or bowser identifier; a meter serial;
                    a next-sector destination
  FUEL_DELIVERIES   a refuelling start or end time; any completion
                    indicator

Where something exists under a name I have not guessed, say so.

And report which of these, if any, are referenced by a DECISION or an
OPEN POINT in docs/design/00-DECISIONS.md but have no field. That
class — decided with nothing behind it — is what D28 found for
parameters, and I suspect it recurs here.

Do not propose a plan. Do not start a package.
```

---

## 9. If the survey confirms them

**Three would form a package worth doing before the others**, because each is a taken decision that cannot currently be implemented:

| | Decision | What is missing |
|---|---|---|
| **Order communication** | **C-3** | The gate between amend and incremental |
| **Alternate airport** | Regulatory | A figure with no destination attached |
| **Refuelling window** | **F2, F20, F22** | The second ground gap, and the completion signal |

The rest — diversion, planned payload, tankering, vehicle identity — are **design questions before they are schema questions**, and each needs an answer from the SME before a field can be shaped.

> **Do not build a field whose semantics are undecided.** WP-19B's `flight_start_utc` is being added with its meaning explicitly open, and that is the exception rather than the pattern — it is added because the ground gap needs *somewhere* to put a timestamp, not because anyone knows which timestamp.

# 04-WORK-PACKAGES.md

**FuelSphere — merge work packages**

One package per branch. Never combine. Do not start a package whose entry criteria are unmet.

---

## Rules

- Every package states **entry criteria**, **scope**, **out of scope**, and **exit criteria**
- Exit criteria are verifiable — a test that runs, a query that returns nothing, a grep that finds zero hits
- Schema changes commit separately from behaviour changes
- If scope needs to grow, stop and raise it. Do not extend a package mid-flight

---

## Phase 0 — safety and correctness

No decisions required. Start here.

### WP-01 · Restore the master sync transaction

**Entry:** none
**Scope:** Uncomment and repair the transaction wrapper around the DELETE-then-INSERT full replace in `master-data-service.js:187-201`. Generalise the existing empty-response guard so every full-replace feed aborts before deleting when the source returns zero rows.
**Out of scope:** Changing the sync to incremental. Adding a scheduler.
**Exit:**
- A simulated mid-sync failure leaves the target table intact
- Zero-row source response aborts before any delete, on every full-replace feed
- Defect D1 closed

---

### WP-02 · Close the authorisation hole

**Entry:** Decision A8
**Scope:** Remove the pseudo-role `'any'` from all 93 occurrences across 69 grants in `srv/authorization.cds`. Map each grant to a real role from `xs-security.json`. Add the missing status guard on `captureSignatures` so the order cannot reach `Delivered` from an arbitrary state.
**Out of scope:** Row-level security (WP-14). SoD enforcement. Access review.
**Exit:**
- `grep "'any'" srv/authorization.cds` returns zero
- Every grant names at least one real role
- An order in `Draft` cannot be moved to `Delivered`
- Defects D2 and D13 closed

---

### WP-03 · Fix the ROB formula and add re-derivation

**Entry:** none
**Scope:** Correct `_createROBEntryForBurn` (`burn-service.js:1145`) to `opening + uplift − burn + adjustment` rather than `max(0, opening − burn)`. Raise `FB402` on a negative closing balance instead of clamping. Implement `recalculateROB` so the ledger can be rebuilt in sequence after out-of-order ingest.
**Out of scope:** Ledger closure status. Stock reconciliation. Defuel and jettison event types.
**Exit:**
- An uplift followed by a burn produces a closing balance matching the documented formula
- A negative closing balance raises `FB402`
- `recalculateROB` rebuilds a deliberately corrupted chain to the correct values
- Defects D3 and D15 closed

---

### WP-04 · Atomic number generation and concurrency tokens

**Entry:** Decision C5
**Scope:** Replace client-side `max + 1` generation with a database sequence or CAP number range for order, delivery and ticket numbers. Widen the sequence to four digits. Remove the `'XXX'` station fallback and fail with a code instead. Add `@odata.etag` to transactional entities.
**Out of scope:** Sales order, planning version and SAC export numbering — those are not generated at all today and belong with their own modules.
**Exit:**
- Concurrent creation of 100 orders at one station produces 100 distinct numbers
- A missing station code raises an error rather than producing `XXX`
- A stale-token update is rejected
- Defects D4, D5 and D17 closed

---

### WP-05 · Remove the large-order block

**Entry:** none
**Scope:** Remove or raise the hardcoded 100,000 kg guard at `order-service.js:79`.
**Out of scope:** Migrating other hardcoded values — that is WP-13.
**Exit:**
- An order of 120,000 litres is accepted
- Defect D16 closed

**Note:** this guard rejects legitimate widebody long-haul orders today. An A350 on a typical trans-Pacific sector exceeds it.

---

### WP-09B · Enforce the remaining enum-typed elements

**Entry:** WP-09 merged
**Scope:** 79 enum-typed elements exist in `db/schema.cds` and **none is enforced**. Declaring a CDS enum does not validate input; CAP checks only where `@assert.range` is present. WP-09 enforced `FLIGHT_SCHEDULE.status` alone. Add enforcement to the remaining 78, following the house form established in WP-09.
**Out of scope:** Adding, removing or renaming enum members. Converting further free-text columns to enums — that is open point F17.
**Exit:**
- Every enum-typed element rejects a value outside its enum
- `cds deploy` succeeds with the existing seed set, or every seed value that now fails is reported with whether the data or the enum is wrong
- Defect D25 closed

> **Wide blast radius.** Every writer of an enum-typed field, and every seed value, becomes subject to a constraint that has never been applied. Expect failures — they are the point. WP-06 found 15 seed violations by sweep; enforcement will find any that a sweep missed, plus any the code produces at runtime. **Survey writers before annotating**, and stage the work by module rather than annotating all 78 at once.

---

### WP-02C · Grant the eighteen unauthorised bound actions

**Entry:** WP-02B merged
**Scope:** Eighteen bound actions on restricted entities declare no `@requires` and have no grant. **Add a grant mirroring each entity's existing `UPDATE` scope**, per decision D26. Two are ours — `complete` and `attachToOrder`.
**Out of scope:** Adding scopes to `xs-security.json`. Assigning a narrower or higher scope than `UPDATE` — that is the production review, not this package.
**Exit:**
- Each of the eighteen is callable by a user holding the entity's `UPDATE` scope, and refused without it
- Scope set unchanged before and after
- Harness proved able to fail against the pre-change file **and** under dummy auth
- Defect D26 closed at the floor level

> **`UPDATE` is a floor.** Several of the eighteen warrant a higher scope — `postToS4HANA` should need `FinancePost`. **Flag them in the PR for a production review**; do not assign them here.

---

### WP-02B · Grant bound actions their own authorisation entries

**Entry:** WP-02 merged
**Scope:** Add a `{ grant: '<action>', to: [...] }` entry for each of the eleven bound actions on restricted entities in `srv/authorization.cds`. Each mirrors the scope already declared on that action's own `@requires`, so nothing new is granted. Discovered under WP-02: CAP refuses a bound action unless a grant names it, and entity-level CRUD grants do not imply it. Currently every one of the eleven is denied under real authorisation, including for a user holding all scopes.
**Out of scope:** Adding scopes to `xs-security.json`. Changing any action's `@requires`. Row-level security. Annotating the eleven unannotated services — that is D23.
**Exit:**
- Each of the eleven bound actions is callable under `mocked` auth by a user holding the scope on its `@requires`
- The same call is refused for a user without that scope
- No scope was added or widened
- Defect D22 closed

**Test note:** must run under `kind: 'mocked'` with the users map supplied in the same override. Under dummy auth every call passes and the test proves nothing.

---

### WP-06 · Replace the seed data

**Entry:** Decision D10 (Group D)
**Scope:** Generate seed CSVs from the design workbook's 151 scenarios in the build's entity and field names. Cover tail swaps, defuel, jettison, broken ledger chains, provisional pricing, duplicate invoice lines, over-delivery, unmatched tickets. Correct the existing enum violations — `INVOICES.status = 'SUBMITTED'`, `SECURITY_USERS.employment_status = 'TERMINATED'`, `FUEL_ORDERS.status` inconsistencies.
**Out of scope:** Schema changes. Scenarios requiring fields that do not yet exist — defer those to the package that adds the field.
**Exit:**
- Every seeded status value appears in its enum
- Deployment succeeds with the new set
- Each subsequent package can point to a scenario that exercises it

---

## Phase 1 — structural foundations

### WP-07 · Aircraft register

**Entry:** Decision B1. WP-09 merged — this package edits `db/schema.cds`, which WP-09 also changed.
**Specification:** `01-TARGET-SCHEMA.md` §2 and §2A. **Where this entry and §2 differ, §2 governs.**

**Scope**
1. Add `AIRCRAFT_REGISTRATIONS`, keyed on `registration`, with the per-tail fields and `AircraftRecordStatus` per §2.
2. Add §2A's optional `cost_object_type` and `cost_object_id`. **Provisioned, not consumed** — no determination logic against them.
3. Keep `AIRCRAFT_MASTER` unchanged, re-documenting its header comment as the aircraft **type** master.
4. Gate order creation on `PROVISIONAL` status per decision A4. **Ticket capture and ROB entry stay unblocked.**
5. Seed the registrations already present in the data.

**Out of scope**
- **Replacing `tail_number` and `aircraft_reg` strings with associations. That is WP-07B.** An earlier version of this entry made it exit criterion 1; `01-TARGET-SCHEMA.md` §2 excludes it by name, and §2 governs.
- Provisional lifecycle behaviour beyond the order-creation gate — WP-16.
- APU usage. `apu_burn_rate_kg_hr` is added so the register is complete; nothing consumes it until WP-19.
- Fixing `recalculateROB(aircraftId: UUID)`, whose signature cannot address a tail. Note it here; the fix belongs with WP-07B.

**Exit**
- `AIRCRAFT_REGISTRATIONS` exists and holds the registrations found in seed data
- An order cannot be created against a `PROVISIONAL` registration
- A ticket **can** be captured against a `PROVISIONAL` registration
- `cds compile` and `cds deploy` clean, verified by exit code

---

### WP-07B · Migrate tail references from string to association

**Entry:** WP-07 merged
**Specification:** none yet written. **This package needs a specification before it starts** — `01-TARGET-SCHEMA.md` §2 defers it without describing the target.

**The problem.** Six entities reference an aircraft by free-text string. Surveyed under WP-07:

| Entity | Field | Mandatory | Seed rows |
|---|---|---|---|
| `FLIGHT_SCHEDULE` | `aircraft_reg` | | 14 |
| `FUEL_TICKETS` | `aircraft_reg` | | 5 |
| `FLIGHT_DISPATCH` | `tail_number` | | 7 |
| `FUEL_BURNS` | `tail_number` | **Yes** | 5 |
| `ROB_LEDGER` | `tail_number` | **Yes** | 12 |
| `FUEL_BURN_EXCEPTIONS` | `tail_number` | **Yes** | 0 |
| `FUEL_DELIVERIES` | `aircraft_reg` | **Yes** | added by WP-10 |

**Seven entities.** Four were named originally; the WP-07 survey found `FUEL_TICKETS` and `FUEL_BURN_EXCEPTIONS`; **WP-10 added a seventh, `FUEL_DELIVERIES.aircraft_reg`** — a new `@mandatory` field on an entity that previously carried no aircraft reference at all.

Note the count grew *after* the survey. A survey is accurate at the moment it runs; a package landing in between changes the answer. **Re-survey before WP-07B starts.**

Eleven distinct registrations across 43 seed rows: `C-FITU`, `C-GFAH`, `C-GHPQ`, `C-GHPX`, `C-GROV`, `RP-C8801` to `RP-C8805`, `RP-C8888`.

**Why it is separate.** Three of the six fields are `@mandatory`, so this is not additive — it changes required columns on `FUEL_BURNS` and `ROB_LEDGER`, which WP-03 fixed and WP-06 seeded. And every register row must exist before any reference can resolve, which WP-07 provides.

**Also in scope here:** `recalculateROB(aircraftId: UUID)` cannot address a tail. Correct the signature once registrations are associable.

**Before starting, decide:** whether the string fields are replaced, or retained alongside the association as a denormalised copy. Retaining them is safer for inbound feeds that carry a registration before the register has a matching row — which is the provisional case A4 is built for.

---

### WP-08 · Retire the duplicate pricing family

**Entry:** Decision A10
**Scope:** Delete `PRICING_FORMULA`, `PRICING_FORMULA_ELEMENT`, `MARKET_INDEX`, `INDEX_VALUE`, `DERIVED_PRICE`, `PRICING_CONFIG`. Repoint the Planning service projection to the plural family. Resolve the projection name collision where two services expose `PricingFormulas` over different base tables.
**Out of scope:** Implementing pricing derivation — WP-20.
**Exit:**
- The singular entities are absent from `db/schema.cds`
- No two services project the same name over different base tables
- Defect D6 closed

---

### WP-09 · Fix status enums

**Entry:** none
**Scope:** Align `OrderStatus` across enum, code and seed — the code writes `'Created'`, which is not in the enum, and never writes `'Completed'`, which appears in seed data. Convert `FLIGHT_SCHEDULE.status` from free text to an enum, splitting `RETURNED` into ramp return and air return.
**Out of scope:** Adding new order statuses. Changing the lifecycle.
**Exit:**
- Every status value written by code exists in its enum
- Every status value in seed data exists in its enum
- Defects D7 and D18 closed

---

### WP-10 · Ticket without order

**Entry:** Decision A1
**Scope:** Relax `FUEL_TICKETS.order` to optional. Add `match_status`. Add a matching workbench action to attach an unmatched ticket to an order or a flight leg.
**Out of scope:** Automatic matching logic — WP-16.
**Exit:**
- A ticket persists with no order and `match_status` set to unmatched
- An unmatched ticket can be attached to an order afterwards

---

### WP-11 · Order and delivery in litres

**Entry:** Decision A2
**Scope:** Change the default unit of measure on orders and deliveries to litres. Add conversion from the plan's mass figure using the resolved conversion density. Migrate seed data.
**Out of scope:** Density configuration — WP-13. Pricing — WP-20.
**Exit:**
- An order created from a plan in kilograms carries the equivalent litres and the density used
- No hardcoded `'KG'` default remains on order or delivery creation

---

### WP-12 · Delivery measurement fields

**Entry:** Decisions B2, B5, B6
**Specification:** `01-TARGET-SCHEMA.md` §6. **Where this entry and §6 differ, §6 governs.**
**Scope:** Meter readings on **`FUEL_TICKETS`** — the meter belongs to the bowser. Gauge pair on **`FUEL_DELIVERIES`** — the FQIS belongs to the aircraft. Make density load-bearing. Gate `calculateTemperatureCorrection` on unit type. Strip the five fuel fields from `FLIGHT_CYCLE_EVENTS`.
**Out of scope:** Reconciliation status and tolerance evaluation — WP-17. `delivered_quantity` derivation — WP-17. **Renaming `temperature_corrected_qty`** — prohibited by `05-CONVENTIONS.md` §6; §6 of the target schema resolves it by gating on unit and recording the naming debt. Gallon mass derivation — open point F19.
**Exit:**
- Mass derives from `quantity_metered` and `density_value`, where the unit's conversion is established
- `temperature_corrected_qty` returns null where `uom_code` is a mass unit
- `FLIGHT_CYCLE_EVENTS` carries no fuel quantity fields
- Defects D8 and D12 closed

> **Two corrections applied 17 August 2026.** An earlier version of this entry placed the meter readings on `FUEL_DELIVERIES` and required `temperature_corrected_qty` to be renamed. Both were wrong: the meter is per bowser and so belongs on the ticket, and renaming an existing field is prohibited. §6 governed in both cases.

---

## Phase 2 — configuration and staging

### WP-33 · The design-review fields — **SUPERSEDES WP-19B AND WP-32**

**Raised 24 August, prioritised the same day.** WP-19B and WP-32 below are retained for their reasoning; **WP-33 is what runs.**

**Twenty-five fields across four entities. Purely additive — nothing is removed, nothing is relaxed.**

| Entity | Fields | |
|---|---|---|
| `FLIGHT_SCHEDULE` | 13 | fuel at the four OOOI points, closure, start, actual stations |
| `FUEL_ORDERS` | 7 | communication, lineage, tankering |
| `FUEL_TICKETS` | 2 | vehicle and meter identity |
| `FUEL_DELIVERIES` | 3 | the refuelling window |

**Six recorded items cannot be implemented without them:**

| | |
|---|---|
| **C-3** | Gates on whether an order was communicated. **No field records it**, so neither branch can be chosen |
| **C-4** | Splits the ground gap at flight closure. **Nothing holds the timestamp** |
| **F2** | The refuelling window. `fob_before` and `fob_after` say what; **nothing says when** |
| **F20** | The second ground gap, between `fob_after` and push-back |
| **F22** | The completion signal. IATA carries one; the manual path has none |
| **WP-19** | Defines trip burn as `OFF − ON`. **Neither operand exists** |

**Half a day.** No handler, no logic, no migration.

**AND IT PLACES THEM.** Two field groups on `PlanningService.FlightSchedule`, per the amendment — otherwise UI-B-03 grows from twenty-two unplaced fields to forty-eight, by exactly the habit that produced it.

**WP-31 runs separately and afterwards.** It is the first removal the project makes and must not ride along with additive work.

---

### WP-19B · The missing flight fuel fields

**FOUND, NOT PLANNED. Raised 24 August.** Same class as WP-02C and WP-07B — work the original analysis did not see, discovered while reviewing a screen.

**`FLIGHT_SCHEDULE` carries `aobt`, `atot`, `aldt` and `aibt` as timestamps and NO fuel figure at any of them.** Nor does anything, anywhere, carry a flight closure or flight start timestamp.

```cds
fob_at_out_kg      : Decimal(10,2);
fob_at_off_kg      : Decimal(10,2);
fob_at_on_kg       : Decimal(10,2);
fob_at_in_kg       : Decimal(10,2);
fob_source         : FobSource;

flight_closure_utc : Timestamp;
closure_source     : ClosureSource;   // OCR | MANUAL | NONE
flight_start_utc   : Timestamp;
start_source       : ClosureSource;

actual_origin              : Association to MASTER_AIRPORTS;
actual_origin_airport      : String(3);
actual_destination         : Association to MASTER_AIRPORTS;
actual_destination_airport : String(3);
// CORRECTED 24 Aug: matches the existing origin / origin_airport pair,
// where the ASSOCIATION carries the short name. Counter-intuitive, and
// consistency within the entity beats being right in isolation.
```

**THIRTEEN fields.** The last four added 24 August. (An earlier draft said fourteen and listed thirteen — the miscount was mine, caught by WP-33 counting rather than trusting.)

### Actual stations — and why this is not the diversion modelling that was rejected

`origin` and `destination` are the **planned** sector. A flight that lands at `YOW` instead of `YUL` has nowhere to say so.

**FuelSphere needs both, for reasons that are its own:**

| | |
|---|---|
| **The uplift station** | Determines the **contract**, the supplier and the price. An uplift at the diversion airport may have no contract at all |
| **The burn** | Computed against a plan for a different sector, so the variance is meaningless unless the actual sector is known |
| **The return leg** | Departs from the diversion airport, so **actual origin can differ from planned too** |

> **This is narrower than the diversion candidate that was rejected, and that is the point.** That one asked FuelSphere to model which alternates were available — 1:N, resolved in flight, and properly the dispatch system's. This records **where the aircraft actually was**: one value each, and the uplift happened at exactly one station.

**Both the string and the association**, per the WP-07B convention: the value as received and the value as resolved are different facts, and a diversion airport may not be in the register at all.

**OPEN: what does null mean?** Either *no deviation, actual equals planned*, or *the feed did not say*. **They are different**, and the answer decides whether the fields are always populated or only on deviation. **Add the fields; do not default them**, and do not copy the planned value in.

**Two things that are specified today and cannot be computed:**

| | |
|---|---|
| **Trip burn** | WP-19 defines it as `OFF − ON`. **Neither operand exists.** The times are there; the fuel is not |
| **The ground-gap split** | Decision **C-4** names flight closure as the split point. **Nothing holds it**, so the rule is undeliverable |

> **Same shape as D28's four parameters** — a decision taken, and no field behind it.

**Schema only. No logic, no handler.**

**Out of scope:** where the values come from — that is WP-31. This package gives them somewhere to land.

**Open:** what *flight start* means. Engineering releasing the aircraft, the outbound crew signing the tech log, or `AOBT`? **They are not the same**, and the ground gap needs the first — `AOBT` is after refuelling and would put the departing flight's APU burn nowhere. **Add the field; leave the semantics for the SME.**

---

### WP-32 · Order communication, lineage and tankering

**FOUND, NOT PLANNED. Accepted 24 August** from the five-entity design review. **Schema only.**

Nine fields across two entities. Each supports a decision that is taken and currently unimplementable.

```cds
// FUEL_ORDERS
communicated_at         : Timestamp;
communication_status    : CommunicationStatus;  // NOT_SENT | SENT |
                                                // ACKNOWLEDGED | FAILED
communication_reference : String(50);

parent_order            : Association to FUEL_ORDERS;
order_relationship      : OrderRelationship;    // ORIGINAL | AMENDMENT |
                                                // INCREMENTAL
is_tankering            : Boolean default false;
tankering_sectors       : Integer;

// FUEL_TICKETS
vehicle_id              : String(20);
meter_serial            : String(30);
```

**WHY EACH IS NEEDED**

| | |
|---|---|
| **Communication** | **Decision C-3 gates on it:** a plan revised *before* communication amends in place; *after*, it creates an incremental order. **Nothing records that an order was communicated**, so neither branch can be chosen. Same class as D28's four parameters, and worse — the decision has two branches and no field to choose between them |
| **Lineage** | C-3's second branch creates an incremental order with nothing linking it to the original. Without `parent_order`, **a station with two orders for one flight cannot tell an incremental from a duplicate** — which is exactly the distinction the invoice duplicate check depends on |
| **Tankering** | `extra_fuel_kg` exists and does not say the extra is *for* tankering rather than weather or a known delay. **The reason is commercial:** tankered fuel is a deliberate arbitrage whose benefit is measured, and WP-20 recorded that a benefit measured on a provisional price **can reverse**. That measurement must know which uplifts were tankering |
| **Vehicle identity** | Scenario 2 has two bowsers, distinguishable today **only because their meter ranges happen to differ**. That is a coincidence of the seed, not a model. And **WP-31's document specification already lists `meter_serial` as an OCR-extracted value**, assuming a home that does not exist |

**All nine optional.** No existing constraint changes.

**Out of scope:** implementing C-3's amend-versus-incremental behaviour, and any supplier transmission. This package gives both somewhere to stand.

**Rejected in the same review**, and the boundary is right: diversion fields, the alternate airport, and the planned payload. **A diversion alternate depends on where the diversion happens** — one flight may have several, resolved in flight against fuel remaining and weather. That is a 1:N table belonging to the flight dispatch system. **FuelSphere consumes `alternate_fuel_kg` because it determines the uplift; it does not need the reasoning that produced it.**

**ALSO IN SCOPE — the refuelling window, accepted 24 August.**

```cds
// FUEL_DELIVERIES
refuel_start_utc  : Timestamp;
refuel_end_utc    : Timestamp;
refuel_complete   : Boolean default false;
```

**Three open points turn on these and none can close without them:**

| | |
|---|---|
| **F2** | The refuelling window itself. `fob_before_kg` and `fob_after_kg` say what the gauge read; **nothing says when refuelling started or finished** |
| **F20** | The second ground gap. Between `fob_after` and push-back the APU may run and the aircraft may sit for an hour, and **that fuel is uncaptured.** C-4 splits the FIRST gap at flight closure; **closure does not divide this one** |
| **F22** | No completion signal exists on the manual path. IATA's message carries one, so **nothing knows a delivery is finished rather than in progress** |

**`refuel_complete` is the signal**, and it must be set by something — an explicit action, or the arrival of the ticket. **Deciding which is behaviour and belongs with F22**, not here. This package gives it a field.

**Twelve fields now, across three entities.** Still schema only.

---

### WP-31 · Document capture and OCR

**NEW CAPABILITY. Specified in `docs/Document_Capture_Specification.md`.**

One mobile device, five capture points: **tech log, gauge before, gauge after, fuel ticket, bowser meter.** Photograph, OCR, confirm on screen.

| | |
|---|---|
| `SOURCE_DOCUMENTS` | New entity. Three nullable associations — flight, delivery, ticket — **exactly one populated** |
| Source flags | On every extracted value, and **the flag selects the tolerance** |
| `OCR_CONFIRMED` | New `FobSource` value at 0.5% / 50 kg, **the same as ACARS** |
| Confirmation handler | The confirmed value is stored; `ocr_raw` is audit only |
| Confidence threshold | From `TOLERANCE_RULES`, **handler-enforced** — `@assert.range` is inert on numerics, per D30 |

**Why OCR earns ACARS's tolerance:** decision **C-5**. The same load cell drives the downlink and the dial, so the instrument error is identical. **What differs is the recording** — a crew figure is written to the nearest 100 kg; an OCR read of the dial is to the kilogram.

**Depends on WP-19B**, which gives `closure_document` a timestamp to sit beside.

**SURVEY DONE, 24 August. NOTHING EXISTS TO EXTEND.** The entire evidence layer is **two `LargeBinary` fields on `FUEL_DELIVERIES`** — `pilot_signature` and `ground_crew_signature`. No image URI anywhere; all seven `_uri` hits in the schema are endpoints or links.

**So both signature fields MIGRATE INTO `SOURCE_DOCUMENTS`** as `SIGNATURE_PILOT` and `SIGNATURE_CREW`. **One evidence model, not two** — otherwise the ePOD signature is stored one way and the tech log photograph another, for no reason but the order they were built in.

**Two problems in what exists, both inherited:** `LargeBinary` puts the image **in the row**, and the comment beside it reads *"stored as base64 or reference to Object Store"* — **nobody decided.** Fine for a signature; **a photographed tech log is 2 to 5 MB.** And the signatures carry no source, no confirmation and no hash: **stored, not evidenced.**

**The migration is real work.** `LargeBinary` to `image_uri` is not a rename — the bytes move to the object store. `signature_timestamp` becomes `captured_at`, `signature_location` becomes a new `capture_location` on `SOURCE_DOCUMENTS`, and **`ocr_status` is `NOT_ATTEMPTED` because a signature is not read, it is held.**

**THIS IS THE FIRST REMOVAL THE PROJECT WILL MAKE.** Every merged package has been additive. **Decided 24 August: migrate anyway** — one evidence model is worth it, and leaving the signatures creates a legacy corner every later package must know about.

**FOUR STEPS, AND THE OLD FIELDS SURVIVE UNTIL THE LAST.** Do not remove and add in one commit.

| | |
|---|---|
| **1** | Build `SOURCE_DOCUMENTS`. Touch `FUEL_DELIVERIES` not at all |
| **2** | Migrate the data. Bytes to the object store; **the old fields still hold their values** |
| **3** | **Move every reader** — handlers, projections, annotations, harnesses, seed CSVs. Nothing breaks, because the old fields are still there |
| **4** | Remove the four fields. **Only after step 3 proves zero readers remain** |

**Step 3 is the package. The rest is mechanical.**

> **A removal that fails loudly is recoverable. One that fails quietly is D32** — three UI bindings reading fields that never existed on `INVOICES`, rendering blank, and the Exception Queue permanently claiming *"No exceptions, all clear"* whatever the data said. **Nothing threw, so nobody noticed.**

**Out of scope:** the OCR engine itself. That is a service the mobile app calls; FuelSphere records what it returned and who confirmed it.

---

### WP-13 · Parameter resolution and applied evidence

> **SCOPE ENLARGED 18 August 2026 — defect D28.** The scope below reads as "migrate the hardcoded values into configuration". **There is no configuration to migrate them into.**
>
> Four parameters are named in taken decisions and **none exists anywhere**:
>
> | Parameter | Decided in |
> |---|---|
> | `HOLD_PAYMENT_ON_DISCREPANCY` | C-1 |
> | `FLIGHT_COST_OBJECT_MODEL` | B9 |
> | `BURN_POSTING_TRIGGER` | C-2 |
> | `UNKNOWN_TAIL_POLICY` | `01-TARGET-SCHEMA` §10.3 |
>
> The only occurrences in the codebase are comments naming WP-13 as their destination. Found by the WP-07B survey.
>
> **WP-13 must build the store, register these four, and provide the resolution — before migrating any literal.** `TOLERANCE_RULES`, `ALLOCATION_RULES` and `PRICING_CONFIGURATIONS` are seeded but they are **rule tables**, not a general parameter store. `TOLERANCE_RULES` is keyed on parameter code **and scope**, with typed value columns per `CFG404`. **`UNKNOWN_TAIL_POLICY` is a single enum with no scope key; `HOLD_PAYMENT_ON_DISCREPANCY` is a boolean switch.** Fitting them in would mean widening rule tables to hold things that are not rules. **The store is genuinely new work.**

**FIVE constant blocks already sit where WP-13 will collect them**, each named and pointing at it:

| Constant | Where |
|---|---|
| `TOLERANCE_BY_FOB_SOURCE` / `TOLERANCE_SOURCE` | `fob-reconciliation.js`, WP-17 |
| `UNKNOWN_TAIL_POLICY` / `POLICY_SOURCE` | `tail-resolver.js`, WP-07B |
| `DEFAULT_VOLUME_UOM` | WP-11 |
| **Burn variance ladder** | `burn-service.js` — **written out three times, in two different forms** |
| **`EPD403` / `EPD404` limits** | Temperature and density — **and doubled with `@assert.range` on the schema.** See D30 |

Each already records **which source produced the value** — the applied-evidence pattern, in place before the store exists.

**Entry:** Decision A6
**Scope:** Implement date-effective, priority-ordered resolution against the existing `valid_from`, `valid_to` and `priority` columns. Add an applied-value record capturing which configuration row produced each resolved value. Migrate the hardcoded literals — burn variance 5/10/20, delivery variance ±5%, `1.05`, density bounds 0.775 to 0.840, temperature range −40 to 50 — into `TOLERANCE_RULES` and related tables. Honour `block_on_exceed` and `require_dual_approval`.
**Out of scope:** SoD rules. Allocation rules.
**Exit:**
- No tolerance literal remains in `srv/*.js`
- Resolution as of a past date returns the row in force then, not the current row
- Every tolerance-driven status has a corresponding applied record

---

### WP-14 · Row-level security

**Entry:** Decision C3
**Scope:** Add `where:` clauses using the declared `CompanyCode`, `Plant` and `CostCenter` attributes.
**Out of scope:** SoD enforcement. Access review campaigns.
**Exit:**
- A user scoped to one company code cannot read another's orders, tickets or invoices
- Defect D14 closed

---

### WP-15 · Inbound staging layer

**Entry:** Decision A5
**Scope:** Add staging entities for the flight schedule and dispatch feeds. Implement identity resolution before content validation, supersession with one actionable error per business key, change type evaluation against the latest staging record, staleness by source timestamp, correction in staging with reprocessing. Retain the existing `source_message_id` idempotency alongside.
**Out of scope:** Snapshot divergence detection. Ticket feed staging.
**Exit:**
- A malformed record does not reach the target table
- Three failing arrivals for one key produce one worklist item
- A record matching the applied value but differing from the latest staging record is treated as a reversal, not a no-change
- A corrected record reprocesses without editing the target

---

### WP-16 · Provisional master data and gating

**Entry:** Decisions A4, B1
**Scope:** Add lifecycle status to aircraft and supplier master records beyond `is_active`. Gate order creation and posting on unconfirmed records while allowing ticket capture. Add a confirmation action. Time-box provisional status.
**Out of scope:** Carrier arrangements.
**Exit:**
- An unknown registration provisions rather than blocking the flight record
- Order creation is blocked against a provisional tail; ticket capture is not
- Provisional records beyond the window escalate

---

## Phase 3 — behaviour

Each is a package. Entry criteria as stated; all also require Phase 0 complete.

| # | Package | Entry | Core exit criterion |
|---|---|---|---|
| WP-17 | Delivery and FOB reconciliation | WP-12, WP-13 | Metered mass against gauge delta produces a status against a resolved tolerance, with the applied record |
| WP-18 | Fuel plan versioning and the regulated stack | B3, A7 | A revision creates a new version; a ticket binds to the version it executed against |
| WP-19 | Burn derivation and APU | WP-07, WP-18 | Burn derives from four gauge points; APU burn derives from cycle minutes and rate; ACARS variance no longer inert. **See the design notes below** |
| WP-20 | Pricing derivation | WP-08, WP-13 | A formula resolves an index, applies components in sequence, and records every quote used |
| WP-21 | Invoice matching and posting | WP-20 | Three-way match produces a status; duplicates detected independently; posting errors retained and reprocessable |
| WP-22 | Completeness and stock reconciliation | WP-17, WP-19 | Absence distinguished from legitimate non-expectation; tail stock reconciles at the last on-blocks before period end |
| WP-23 | Posting determination | WP-21 | Movement type and cost object resolve per event; the GL account is never supplied on the interface |
| WP-24 | Carrier arrangements | WP-16 | Fuel processing scope resolves per leg; a missing arrangement raises an exception rather than defaulting |

---

### WP-19 design notes — APU apportionment between arriving and departing flights

Recorded 17 August 2026 during the SME requirements review.

**The ledger does not apportion.** APU burn leaves the tail's tanks regardless of who is charged. For `ROB_LEDGER` it is an event on the tail between two flights. Apportionment is a **cost allocation** question, not a fuel question.

**Primary rule — allocate by phase.** `APU_USAGE.usage_phase` already carries this:

| Phase | Bears the cost |
|---|---|
| `PRE_DEPARTURE` | Departing flight — boarding, loading, engine start |
| `IN_FLIGHT` | That flight |
| `POST_ARRIVAL` | Arriving flight — disembarkation, offload |
| `OVERNIGHT`, parked, maintenance | **Neither flight.** Station or aircraft cost object |

Post-arrival and pre-departure genuinely belong to different flights. No split is required for the ordinary case.

**Better rule where gauge readings exist — split at the refuelling event.**

```
fob_at_arrival_kg
      │  ← APU burns OLD fuel, from the previous uplift
fob_before_kg
      │  ← uplift
fob_after_kg
      │  ← APU burns NEW fuel, just purchased
fob at off-blocks
```

Two **measurable** gaps, not apportioned ones. `ground_burn_kg` on `FUEL_DELIVERIES` is the first of them. Where the readings exist the split is a measurement rather than a convention, which is materially more defensible.

**The hard case — one cycle spanning the whole turn.** APU starts at on-blocks and stops after the next departure's engine start. One cycle, two flights, no phase boundary.

| Basis | Verdict |
|---|---|
| Time-proportional, split at the midpoint | Arbitrary |
| **Split at the refuelling event** | **Preferred.** Uses the physical divide, consistent with the measured case |
| Whole cycle to the departing flight | Simple, and wrong on a long turn |

**Resolution order:** split at the refuelling event where fuel readings exist → fall back to phase → fall back to time-proportional, recording the basis used.

**The second gap is not captured.** `ground_burn_kg` measures `fob_at_arrival → fob_before_refuel` — the pre-refuel portion, burning fuel from the previous uplift. The post-refuel portion, `fob_after → fob_out` of the departing leg, burns newly purchased fuel and **nothing derives it.** Both are needed for the split-at-refuelling rule to work in full; today only the arriving side is measurable. See open point F20.

> **SUPERSEDED 21 August by decision C-4.** The resolution order above — split at the refuelling event, then by phase, then time-proportional — is replaced. **The split point is FLIGHT CLOSURE**, when the inbound captain signs off and hands the aircraft to engineering. Everything from chocks-on to closure is the **arriving** flight's; everything from closure to next chocks-off is the **departing** flight's.
>
> That is an operational boundary with a timestamp and a transfer of responsibility behind it, where the refuelling event was inferred from which fuel sat in the tank. **The timestamp comes from the TECH LOG** and needs a field and a capture path — OCR of a photographed tech log, or manual entry. **Evaporation joins APU as a cause of the loss**, and both book against one of the two flights on the same split.
>
> The phase and time-proportional fallbacks remain useful **only where no closure timestamp exists**.

**Two edge cases:**

- **Tail swap.** Arriving and departing aircraft differ, so there is no turn. Post-arrival belongs to one tail, pre-departure to another. Any logic assuming a continuous turn gets this wrong
- **Long ground stop.** Twelve hours between two barely-related flights. Charging either is misleading — this is where `OVERNIGHT` earns its place, allocating to the station or the aircraft rather than a flight

**Two gaps in the current design, both to be closed here:** there is no allocation rule for a cycle spanning the boundary, and nothing states that overnight running belongs to neither flight.

---

## Phase 4 — activation and UI

| # | Package | Entry |
|---|---|---|
| WP-25 | Activate allocation and accruals | C1 |
| WP-26 | Activate contracts and volume commitment | C1 |
| WP-27 | Activate compliance and sanctions | C1 |
| WP-28 | Activate planning and demand | C1 |
| WP-29 | Real outbound S/4 integration, replacing simulated document numbers | WP-23 |
| WP-30 | UI rebuild on Fiori Elements | C4 — runs as a parallel track from Phase 1 |

---

## Dependency summary

```
Phase 0  WP-01 … WP-06        no dependencies, run in parallel
   │
Phase 1  WP-07 … WP-12        structural, mostly parallel
   │
Phase 2  WP-13 … WP-16        configuration and staging
   │
Phase 3  WP-17 … WP-24        behaviour, sequenced by the table above
   │
Phase 4  WP-25 … WP-30        activation

WP-30 (UI) runs parallel from Phase 1 — nothing carries forward from the
existing apps, so it does not block or depend on the backend sequence.
```

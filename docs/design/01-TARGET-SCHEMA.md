# 01-TARGET-SCHEMA.md

**FuelSphere — target schema for Phase 1**
Written against `db/schema.cds` as at 16 August 2026: 97 entities, 68 types, 2 aspects, 4,381 lines.

---

## How to read this

This document specifies **what changes and what it becomes**, entity by entity, in **this repository's own names**. Every field name below was read from `db/schema.cds`. Where a field does not exist, that is stated rather than assumed.

It covers **Phase 1 only** — work packages WP-07 to WP-12. Entities not listed are unchanged in this phase.

| Marker | Meaning |
|---|---|
| **ADD** | New field or entity |
| **CHANGE** | Existing field, altered |
| **RELAX** | Constraint removed |
| **KEEP** | Named to prevent it being changed by mistake |

**Where this document and source disagree, stop and ask.** Do not reconcile silently.

---

## 1. Conventions that apply throughout

### Naming

Entities `UPPER_SNAKE_CASE`, fields `lower_snake_case`, enum types `PascalCase`, in the `fuelsphere` namespace. **Do not rename an existing entity or field** — 185 projections and 79 seed files reference them.

### Enum casing is inconsistent and stays that way

`OrderStatus` uses `Draft`. `CrewReviewStatus` uses `PENDING`. `InvoiceStatus` uses `DRAFT`. Match the module you are in. Normalising breaks seed data and external callers.

### IATA code values — decision G1

Where a field below carries a code list, the values are the industry ones. They take effect **in the package that builds or touches the field**; there is no separate adoption package.

| Field concept | Values | Source |
|---|---|---|
| Density basis | `MEA`, `STD` | IATA-01 |
| Delivery method | `HYD`, `REF` | IATA-02 |
| Fuel operation | `DF`, `F` | IATA-03 |
| Ticket source | `M`, `E` | IATA-04 |
| Quantity basis | `GR`, `NT` | IATA-12 — **new field** |
| Quantity type | `DL`, `IN` | IATA-13 |
| Quantity units | `LT`, `KG`, `USG`, `MT`, `BBL`, `HL`, `LB`, `M3`, `KL`, `EA`, `PCT`, `CAN`, `DR`, `HR` | IATA-14 |
| Temperature unit | `C`, `F` | IATA-15 |

### Assertions

Existing assertions stay unless this document says otherwise. Two are load-bearing:

- `FUEL_DELIVERIES.temperature` — `@assert.range: [-40, 50]`, error `EPD403`
- `FUEL_DELIVERIES.density` — `@assert.range: [0.775, 0.840]`, error `EPD404`

These are not arbitrary magic numbers. **Move the values to configuration under WP-13 without changing them.**

`ROB_LEDGER.closing_rob_kg` carries `@assert.range: [0, null]`. **Decision B8: it stays.** A negative balance raises `FB402` and writes no row.

---

## 2. WP-07 · Aircraft register

### The problem

`AIRCRAFT_MASTER` is keyed on `type_code : String(10)`. Its fields — `aircraft_model`, `manufacturer_code`, `fuel_capacity_kg`, `mtow_kg`, `cruise_burn_kgph`, `fleet_size` — are all **type-level**.

**It is a type master. There is no aircraft register.** Every individual aircraft is a free-text string: `aircraft_reg` on flight schedule and ticket, `tail_number` on burn, ROB ledger and dispatch.

### `AIRCRAFT_MASTER` — KEEP, re-document only

Do not repurpose, do not rename, do not move fields out of it. It is correct as a type master. Update its header comment to say so.

The `aircraft` associations on `FUEL_BURNS` and `ROB_LEDGER` currently resolve to a **type**, not a tail. Leave them; they become type references once the registration entity exists.

### `AIRCRAFT_REGISTRATIONS` — ADD

New entity. Key on the registration itself, not a UUID — it is the natural key, it appears on every physical document, and a UUID would force a lookup on every ingest.

```cds
entity AIRCRAFT_REGISTRATIONS : ActiveStatus, AuditTrail {
    key registration        : String(10);      // Tail number, e.g. RP-C4108
        aircraft_type       : Association to AIRCRAFT_MASTER;
        aircraft_type_code  : String(10);      // FK, mirrors the pattern on FUEL_ORDERS

        // Per-tail physical characteristics
        dry_operating_weight_kg : Decimal(15,2);
        fuel_capacity_kg        : Decimal(15,2);   // May differ from type where tanks differ
        apu_burn_rate_kg_hr     : Decimal(8,2);    // Never metered; APU burn is derived from this
        performance_factor_pct  : Decimal(6,3);    // Actual over planned burn. Drifts per tail

        // Lifecycle — decision A4, provisional master data
        record_status       : AircraftRecordStatus default 'PROVISIONAL';
        provisional_expiry  : Date;                // Time-boxed; escalates on expiry
        confirmed_by        : String(100);
        confirmed_at        : DateTime;

        // Operational
        operator_code       : String(3);           // Operating carrier where leased
        on_own_aoc          : Boolean default true; // false = wet lease or ACMI
}

type AircraftRecordStatus : String(20) enum {
    Provisional = 'PROVISIONAL';   // Auto-created. Ticket capture allowed, order creation blocked
    Confirmed   = 'CONFIRMED';     // Identity verified. Orders unblocked
    Complete    = 'COMPLETE';      // All physical characteristics present
}
```

**`fuel_capacity_kg` appears on both entities deliberately.** The type value is the default; the registration value overrides it where a tail's tanks differ. Resolution is registration first, type second.

### Gating — decision A4

| Action | PROVISIONAL | CONFIRMED |
|---|---|---|
| Flight record applies | Yes | Yes |
| **Ticket capture** | **Yes** — fuel is already in the tanks | Yes |
| ROB ledger entry | Yes | Yes |
| **Order creation** | **No** | Yes |
| Purchase order, posting | No | Yes |

The principle: **capture is never blocked; external commitment is gated.**

### What is NOT in WP-07

- Replacing `tail_number` and `aircraft_reg` strings with associations across the transactional entities. That is a separate migration with data implications
- APU usage entities. `apu_burn_rate_kg_hr` is added here so the register is complete, but nothing consumes it yet
- Fixing `recalculateROB(aircraftId: UUID)`, whose signature cannot address a tail. Note it against this package; the fix belongs with the migration above

---

## 2A. Cost object determination — REQ-SAP-002

Decided 17 August 2026. Affects WP-23 rather than Phase 1, but the schema provision is made here so it is not retrofitted.

### The burn posting cost object is either a cost centre or a PM order

Selected by `FLIGHT_COST_OBJECT_MODEL`, global per company code.

| Value | Determination |
|---|---|
| `PM_ORDER` | **Lookup.** Flight to PM order, from the trip record or an equivalent standard SAP table |
| `COST_CENTER` | **Derivation.** From event category, station, service type and carrier code |

### `COST_CENTER` — four dimensions

```
event_category   ENGINE_BURN | APU_BURN | ...
+ station
+ service_type   J, C, or other
+ carrier_code
→ cost centre
```

**Event category is a determination dimension, not a filter.** Engine burn and APU burn on the same leg may resolve to different cost centres. The design's rule that *cost object resolves per event, not per leg* is load-bearing here.

`FS_COST_OBJECT_RULE` carries this. The four dimensions are the determination for burn; the wider scope hierarchy remains available for non-burn objects — station overhead, aircraft basis, recharge.

### `PM_ORDER` — a lookup, not a rule

The flight-to-PM-order relationship is held in the trip record or an equivalent standard SAP table. FuelSphere reads it; it does not derive it and does not maintain it.

> **Dependency.** The trip record is REQ-INT-002 Path A, deferred pending OI-006 — SAP has not provided the structure or a test feed. **`PM_ORDER` mode cannot be built until that arrives**, or until an equivalent standard table is identified.

### Burn corrections carry the same object as the burn

A correction posts to the object of the flight being corrected, **not** to the period in which the correction was made. Reversal and repost both resolve to the original flight's object. Holds under both models.

### `AIRCRAFT_REGISTRATIONS` — ADD an optional cost object mapping

```cds
cost_object_type : CostObjectType;   // Nullable. Unused by default
cost_object_id   : String(20);       // Cost centre or internal order

type CostObjectType : String(20) enum {
    CostCenter    = 'COST_CENTER';
    InternalOrder = 'INTERNAL_ORDER';
}
```

**Provisioned, not consumed.** REQ-SAP-002 maps aircraft to cost centre in the SAP model company framework, but no current FuelSphere flow requires it — burn posts to the flight object, not the tail.

Likely uses if needed: non-revenue movements with no flight object, maintenance ferry, or an airline accumulating tail-level cost separately. **Do not build determination logic against it until a use case exists.**

Where populated and a rule references it, `FS_COST_OBJECT_RULE.object_source = FROM_AIRCRAFT` reads it. That path already exists.

### Airport maps to plant only

REQ-SAP-002's third mapping is airport = plant + cost centre + profit centre.

**Decision: plant only.** The cost centre and profit centre mappings are **not adopted**. Station-level cost resolves through `FS_COST_OBJECT_RULE`, where station is one of the four determination dimensions — so station cost is addressable without the station being a cost object in its own right.

The design has no profit centre concept and does not gain one.

---

## 3. WP-09 · Status enums

### `FLIGHT_SCHEDULE.status` — CHANGE

Currently `String(20) default 'SCHEDULED'` with a trailing comment listing values. Not enforced.

**Decision B7:** enforce as an enum, and **split `RETURNED`**.

```cds
type FlightStatus : String(20) enum {
    Scheduled     = 'SCHEDULED';
    Departed      = 'DEPARTED';
    Arrived       = 'ARRIVED';
    Cancelled     = 'CANCELLED';
    Diverted      = 'DIVERTED';
    Delayed       = 'DELAYED';
    RampReturn    = 'RAMP_RETURN';   // Returned to stand before departure
    AirReturn     = 'AIR_RETURN';    // Returned to departure airport after takeoff
}
```

**Why the split matters.** A ramp return can still take fuel — the aircraft is on stand and may be refuelled before a second departure attempt. An air return has burned fuel and landed. Treating them as one value makes the fuel handling wrong for one of them, and the existing single `RETURNED` gives no way to tell which.

**Existing data:** seed uses `SCHEDULED`, `ARRIVED`, `DEPARTED` only. No `RETURNED` row exists, so no migration is needed.

### `OrderStatus` — KEEP the enum, fix the code

The enum is correct: `Draft`, `Submitted`, `Confirmed`, `InProgress`, `Delivered`, `Completed`, `Cancelled`.

**Defect D7, narrowed by WP-06:** the seed data is correct — every value conforms. The code writes `'Created'` on create, which is in no enum, and never writes `'Completed'`.

| Change | Where |
|---|---|
| Write `'Draft'` on create, not `'Created'` | `order-service.js`, `before CREATE` |
| Implement the transition to `'Completed'` | Order lifecycle |

**Do not add `'Created'` to the enum.** The enum is right and the code is the outlier.

### `InvoiceStatus` — ADD one member

Currently `DRAFT`, `VERIFIED`, `POSTED`, `PAID`, `CANCELLED`.

The documented invoice flow — `CLAUDE.md` section 10 — has a **Submitted** step between Draft and Three-Way Match. Seed data holds `SUBMITTED`, correctly following the specification.

**ADD `Submitted = 'SUBMITTED'` between Draft and Verified.** The data is right; the enum is short a member.

---

## 4. WP-10 · Ticket without an order

### `FUEL_TICKETS.order` — RELAX

Currently `Association to FUEL_ORDERS @mandatory`.

**Decision A1: remove `@mandatory`.**

Fuel is routinely delivered without an order in the system — a verbal post-freeze top-up, a diversion uplift at an uncontracted station, fuel delivered to a tail after the flight was reassigned. Under the current constraint each is either unrecorded or given a fabricated order. Unrecorded fuel is money outside the system; a fabricated order corrupts order data permanently to satisfy a foreign key.

### `FUEL_TICKETS.match_status` — ADD

```cds
match_status : TicketMatchStatus default 'UNMATCHED';

type TicketMatchStatus : String(20) enum {
    Unmatched      = 'UNMATCHED';       // No order. Capturable, chaseable, visible
    Matched        = 'MATCHED';         // Attached to an order
    MatchedNoPlan  = 'MATCHED_NO_PLAN'; // Order found, no fuel plan behind it
    NotExpected    = 'NOT_EXPECTED';    // Processing mode NONE, or no uplift was planned
}
```

`UNMATCHED` is not an error state. It is a ticket awaiting attachment, with an owner and an age.

### `FUEL_TICKETS.ticket_source` — ADD

```cds
ticket_source : String(1) default 'M';   // IATA-04: M manual, E electronic
```

Records how the ticket entered the system. A manually keyed ticket and a supplier feed carry different confidence and belong in different exception queues.

### `FUEL_DELIVERIES.order` — RELAX

Currently `Association to FUEL_ORDERS @mandatory`.

**Decision B2: the delivery hangs off the aircraft, not the order.** A refuelling with two suppliers has two orders and one delivery; a direct mandatory FK to one of them is wrong.

### `FUEL_DELIVERIES.aircraft_reg` — ADD

```cds
aircraft_reg : String(10) @mandatory;   // Registration. Join key: tail + date + departure time
```

**The entity currently has no aircraft field at all** — it reaches the aircraft only through the order. Under B2 that inverts: the delivery keys on **registration + date + departure time**, and orders resolve transitively through the tickets.

**Why departure time is part of the key — REQ-FL-010.** ACARS transmits for a tail, not a flight number, so the join must be resolved here. A narrowbody flies four to six sectors a day; tail plus date alone cannot separate them. The tolerance either side of departure time, and whether the join uses scheduled or actual departure, are open point F2.

> **Read `FUEL_DELIVERIES` as *refuelling event*.** The name is retained because renaming would touch 79 seed files, 185 projections and the `EPD-` number range. Section 6 of `05-CONVENTIONS.md` prohibits entity renaming.

---

## 5. WP-11 · Litres

**Decision A2:** planning in kilograms, order and delivery in litres. Density is the conversion.

| Entity | Field | Now | Target |
|---|---|---|---|
| `FUEL_ORDERS` | `uom_code` | `default 'KG'` | **`default 'LT'`** |
| `FUEL_TICKETS` | `uom_code` | `default 'KG'` | **`default 'LT'`** |
| `FUEL_DELIVERIES` | — | no `uom_code` | **ADD `uom_code : String(3) default 'LT'`** |

### `FUEL_ORDERS` — ADD the conversion evidence

```cds
conversion_density   : Decimal(8,4);   // kg/L used to convert plan mass to order volume
ordered_quantity_kg  : Decimal(12,2);  // The plan figure this order was converted from
```

Without both, the order records a converted number with no way to reproduce it. `ordered_quantity` stays as the litre figure and remains the commercial quantity.

### Migration

Seed data is currently in kilograms. Under WP-11 either convert the values at a stated density and say so in the PR, or leave them and set `uom_code` per row to `'KG'` so nothing is silently misread. **Do not change the unit label without changing the number.**

---

## 6. WP-12 · Delivery measurement

### The problem

`FUEL_DELIVERIES` holds a single `delivered_quantity`. There is **no meter reading and no aircraft gauge pair**, so no delivery reconciliation is possible. `density` is captured and never used; `temperature_corrected_qty` applies a volumetric correction to a mass figure, which is physically meaningless — thermal expansion acts on volume.

### `FUEL_TICKETS` — ADD meter readings

The meter belongs to the **bowser**, so it belongs on the ticket, one per vehicle.

```cds
meter_start          : Decimal(15,2);   // Litres
meter_end            : Decimal(15,2);   // Litres
quantity_litres      : Decimal(15,2);   // = meter_end - meter_start. Derived, not keyed
density_kg_per_l     : Decimal(8,4);    // As delivered
density_basis        : String(3) default 'MEA';  // IATA-01: MEA measured, STD standard
density_temp_c       : Decimal(5,2);
quantity_flag        : String(2) default 'GR';   // IATA-12: GR gross, NT net
quantity_kg          : Decimal(15,2);   // = quantity_litres × density_kg_per_l. Derived
batch_coa_ref        : String(50);      // Certificate of analysis, for density disputes
```

**`quantity_flag` is the field IATA-12 adds.** Net is temperature-corrected, gross is not. Without it no quantity in the system states which basis it is on.

`quantity` — the existing field — stays as the supplier's **claimed** figure. `quantity_kg` is the derived one.

### `FUEL_DELIVERIES` — ADD the gauge pair

The FQIS belongs to the **aircraft**, so it belongs on the refuelling event, one pair per event regardless of how many bowsers were used.

```cds
fob_at_arrival_kg    : Decimal(12,2);   // ROB at chocks-on, end of the arriving leg
fob_before_kg        : Decimal(12,2);   // Fuel on board immediately before refuelling
fob_after_kg         : Decimal(12,2);   // Fuel on board after
fob_delta_kg         : Decimal(12,2);   // Derived: fob_after − fob_before
ground_burn_kg       : Decimal(12,2);   // Derived: fob_at_arrival − fob_before
fob_source           : FobSource default 'NONE';
fob_rounding_kg      : Integer default 0;   // 100 where crew-reported. Sets the tolerance floor

recon_variance_kg    : Decimal(12,2);   // Sum of ticket mass minus fob_delta_kg
recon_status         : ReconStatus default 'NOT_RECONCILED';
supplier_count       : Integer;         // Derived. Attribution requires 1
delivery_method      : String(3);       // IATA-02: HYD hydrant, REF refueller

type FobSource : String(20) enum {
    Acars         = 'ACARS';           // High confidence
    CrewReported  = 'CREW_REPORTED';   // Typically rounded to 100 kg
    PanelPreset   = 'PANEL_PRESET';    // What was requested, not what arrived
    None          = 'NONE';
}

type ReconStatus : String(20) enum {
    Reconciled     = 'RECONCILED';
    Variance       = 'VARIANCE';
    NotReconciled  = 'NOT_RECONCILED';   // No gauge reading. NOT the same as agreement
    NotAttributable = 'NOT_ATTRIBUTABLE'; // Multi-supplier: one gauge pair, two suppliers
}
```

**`NOT_RECONCILED` must never read as a pass.** A missing gauge reading is unknown, not agreed.

### Two arrival readings, not one — REQ-FL-003

`fob_at_arrival_kg` and `fob_before_kg` are **different measurements**:

| Field | When | Typical source |
|---|---|---|
| `fob_at_arrival_kg` | Chocks-on, end of the arriving leg | ACARS |
| `fob_before_kg` | Immediately before uplift begins | ACARS or crew |

Between them sits ground time — temperature change, APU running, any defuel or transfer. An aircraft landing at 10:00 and refuelling at 14:00 has four hours of drift.

**`fob_before_kg` is the correct input to the reconciliation.** Using the arrival reading would put ground-time drift into the delivery variance, where it reads as a supplier discrepancy.

**`ground_burn_kg` makes the gap visible.** It is mostly APU burn, which is never metered. Nothing consumes it until WP-19, but without both readings recorded nobody can see there is a difference to explain.

Where only one reading is available, populate `fob_before_kg` and leave `fob_at_arrival_kg` null. **Do not copy one into the other** — that manufactures a zero ground burn where the truth is unknown.

**`NOT_ATTRIBUTABLE`** exists because one FQIS pair across two suppliers produces one variance figure that belongs to neither. Pro-rata allocation by volume is arithmetically neat and evidentially worthless — never use it to raise a dispute.

### `delivered_quantity` — CHANGE to derived

Currently keyed. **Decision B2: it becomes the sum of its tickets.** Consistent with the rule that totals sum from their children.

### `temperature_corrected_qty` — rename and fix

The name implies a density correction that does not happen. Either use the density it demands, or rename to state what it computes. **Report which you did.**

### Validation that must NOT be written

**Do not require ticket B to start after ticket A ends.** Parallel bowsers are legitimate on widebodies — two trucks pumping simultaneously into one manifold. Enforcing sequence fails every two-bowser turn.

### `FLIGHT_CYCLE_EVENTS` — REMOVE fuel fields

It carries `uplift_kg`, `density_kg_l`, `temperature_c`, `bowser_id` and `sequence_number` against a `REFUELING` event type. **Three places holding fuel quantities is one too many.** Strip them; leave it a movement event log.

Check for readers first. If any exist, report rather than delete.

---

## 7. Deferred — named so they are not invented

| Item | Where it goes |
|---|---|
| Chain restart representation after a ledger break | F11 |
| Durable sink for ledger chain-break exceptions | F14 |
| ePOD delivery creating a ledger entry | F15 |
| Where the ePOD signature belongs — ticket or delivery | F3. Signatures stay on `FUEL_DELIVERIES` |
| How long a delivery stays open before a new ticket opens a fresh one | F2. Two hours as a starting parameter |
| Master data upsert instead of full replace | F12 |
| Optimistic locking carrier | C5, D5 — `@odata.etag` on a DateTime does not work |
| Staging entities | WP-15 |
| `FLIGHT_DISPATCH` regulated fuel stack | WP-18. Decision B3 taken |
| Carrier arrangements | WP-24 |
| APU usage | WP-19 |

**Do not invent any of these.** Each is deferred deliberately, with the reasoning recorded in `00-DECISIONS.md`.

---

## 8. Survey before you change

Two Phase 0 packages found the defect in more places than stated: nine number-generation sites where three were named, four of fifteen services covered by authorisation, and a sweep that found fifteen enum violations none of which were on any list.

**Before changing any field named here, report every reference to it** — schema, projections, handlers, annotation files, seed CSVs. A partial change on a distributed field looks complete and is not.

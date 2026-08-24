# 01-TARGET-SCHEMA.md

**FuelSphere — target schema for Phase 1**
Written against `db/schema.cds` as at 16 August 2026: 97 entities, 68 types, 2 aspects, 4,381 lines.

---

> ## STATUS — AS BUILT, 24 August 2026
>
> **Every one of the 67 fields this document specifies now exists in `db/schema.cds`.** Every ADD added, every REMOVE removed, every CHANGE made — measured against the schema, not against the packages' descriptions of themselves.
>
> **Sections 2 to 10 are a RECORD.** They describe WP-07, 2A, WP-09, WP-10, WP-11, WP-12, WP-18 and WP-07B, and nothing in them needs maintaining. **Their remaining value is the reasoning** — why `LTR` not `LT`, why the conversion factor is planning-only, why `delivered_quantity` is derived. That does not go stale.
>
> **ONE DIRECTIVE IS UNMET: `ACARS_DERIVED`.** Section 5 extends `FobSource` to five members and the schema has four. **Defect D41.**
>
> **Six later packages have no home here** — WP-13, WP-19, WP-20, WP-21A, WP-33 and the HDI seed fixes. That is what makes the document look behind rather than complete. **It is not a target any more; do not extend it.**

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

**CORRECTED 24 August — this instruction is no longer safe to follow.** It read *"existing assertions stay unless this document says otherwise"*, and named temperature and density as load-bearing. **WP-13 removed both** — `db/schema.cds:1041–1042` keeps them as comments, the fields are bare `Decimal`, and the limits resolve from `TOLERANCE_RULES` through `qualityGuard`. **Preserving them would reintroduce the double enforcement WP-13 existed to remove** (closed defect D30). Of the three named below, only `ROB_LEDGER.closing_rob_kg` is still true.

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

### The unit code is `LTR`, not `LT`

**Corrected 17 August 2026.** An earlier version of this section specified `'LT'`, taken from the IATA `PUOMBase` list under decision G1. **`LT` does not exist in this repository.**

```
UNIT_OF_MEASURE keys:  KG, LTR, GAL, USG, MT
uom_code is a FOREIGN KEY:
    uom : Association to UNIT_OF_MEASURE on uom.uom_code = uom_code;
```

Defaulting to `LT` would leave a dangling association from the first record, on three entities at once. **Use `LTR`. Do not add an `LT` row** — two litre codes is worse than one that differs from IATA.

> **This refines decision G1.** Industry code values replace the design's own where a field is being created or has no established value set. **Where the repository already holds a populated code list with referential integrity, that list governs internally**, and IATA codes are mapped at the interface — `LTR ↔ LT` when sending or receiving an IATA Transaction message. Renaming master data for cosmetic alignment is a migration for no benefit.

### SAP unit codes — send ISO

FuelSphere posts a PO, a GR and an invoice to SAP. **The unit travels on all three**, and SAP holds two representations in T006:

| | Internal `MSEHI` | ISO `ISOCODE` |
|---|---|---|
| Kilogram | `KG` | `KGM` |
| Litre | `L` | `LTR` |
| Metric tonne | `TO` | `TNE` |

The repository's `UNIT_OF_MEASURE` list is a mixture — `LTR` is ISO, `KG` is internal, `MT` is neither. Some codes would resolve against T006 and some would not.

**ADD the mapping rather than renaming the list:**

```cds
sap_uom     : String(3);   // T006 MSEHI, internal
sap_uom_iso : String(3);   // T006 ISOCODE
```

**Send `sap_uom_iso` on the PO, the GR and the invoice.** BAPIs accept both — `ENTRY_UOM` and `ENTRY_UOM_ISO` — and ISO is stable across clients where internal codes can be renamed per installation. A product shipping to several airlines must not depend on one client's naming.

> **Verify against the target client's T006 before go-live.** Internal unit codes are client-configurable and the mapping above is the standard set, not a guarantee.

### The conversion factor is planning-only

`UNIT_OF_MEASURE.conversion_to_kg` and SAP's material master **MARM** are two independent sources for the same number. If they differ:

```
FuelSphere    12,000 L × 0.800        = 9,600 kg
SAP           12,000 L × MARM factor  = something else
```

The difference appears as a **phantom variance** in stock reconciliation, superimposed on the genuine density variance NEW-01 addresses. Two variances, one real and one an artefact.

**SAP's MARM is authoritative.** The GR posts in litres and SAP converts regardless, so FuelSphere's factor must never be used for anything that has to agree with SAP.

**Use `conversion_to_kg` for planning-side estimates only** — converting a plan mass into an order volume, which is a forward estimate. Never for settlement, valuation or reconciliation.

### The three entities in scope

| Entity | Field | Now | Target |
|---|---|---|---|
| `FUEL_ORDERS` | `uom_code` | `default 'KG'` | **`default 'LTR'`** |
| `FUEL_TICKETS` | `uom_code` | `default 'KG'` | **`default 'LTR'`** |
| `FUEL_DELIVERIES` | — | no `uom_code` | **ADD `uom_code : String(3) default 'LTR'`** |

> **`LTR` is a fallback default, not a rule.** Litres are not universal. AFSMA states the Delivery Note carries quantity *"in kilograms, litres or gallons, in accordance with Seller's normal practices"* — **the unit is the supplier's choice.** A US into-plane agent meters in gallons and will issue a gallon ticket whatever FuelSphere prefers. IATA's `PUOMBase` carries fourteen units; `UNIT_OF_MEASURE` already holds `KG`, `LTR`, `GAL`, `USG`, `MT`, and distinguishes `GAL` from `USG`.
>
> **Resolution order: supplier contract, then station, then `LTR`.** The contract knows the supplier's practice; the station knows local convention. The global default applies only where neither is configured.
>
> Contract-level and station-level unit configuration arrives with WP-13 and the contract master. Until then the fallback stands, which is correct for a litre-metering reference client and wrong for the second customer with a US station.

### Three units, three different jobs

| Layer | Unit | Set by |
|---|---|---|
| Ticket | As metered | **The supplier** |
| Invoice | As priced | **The contract** |
| Internal, valuation | Kilograms | The airline |

**All three can differ on one transaction.** A supplier meters in gallons, prices per litre, and the airline values in kilograms. IATA's invoice standard carries `PricingUOM` and `InvoiceUOM` as separate fields with separate factors precisely because they diverge — that is gap IATA-33.

**The unit is an attribute of the transaction, not a property of the system.** Store what was metered in the unit it was metered in; derive the comparable figure.

**Seven `uom_code default 'KG'` declarations exist. Four stay in kilograms deliberately:**

| Entity | Why it stays |
|---|---|
| `PLANNING_LINE` | Planning. A2 keeps planning in kilograms |
| `DEMAND_CALCULATION` | Planning |
| `FUEL_SALES_ORDERS` | Supplier side, not the airline's procurement |
| `PRICE_ASSUMPTION`, `FLIGHT_COSTS` | Pricing. WP-20 |

### `FUEL_ORDERS` — ADD the conversion evidence

```cds
conversion_density   : Decimal(8,4);   // kg/L used to convert plan mass to order volume
conversion_source    : String(20);     // Which configuration row produced it
ordered_quantity_kg  : Decimal(12,2);  // The plan figure this order was converted from
```

Without all three, the order records a converted number nobody can reproduce. `ordered_quantity` stays the litre figure and remains the commercial quantity.

### The density source — and one it must not be

`UNIT_OF_MEASURE.conversion_to_kg` already carries a factor: `LTR` holds `0.800000`. **Resolve the plan-to-order conversion from that row and record which row produced it**, rather than hardcoding a constant. That satisfies the applied-value principle properly instead of approximating it.

> **Boundary.** `0.800000` is a **generic planning factor, not a delivered density.** It is correct for converting a plan mass into an order volume, which is a forward estimate. It must **never** be used to derive ticket mass — decision B6 makes the delivered density on the ticket authoritative there. Two densities, two jobs. State the distinction in the code.

When WP-13 lands, the resolution moves into the parameter framework and `conversion_source` records the parameter row instead. The field is added now so that migration is a value change rather than a schema change.

### The conversion path does not exist yet

Nothing converts a plan mass into an order quantity today. The dispatch import writes `dispatch_qty_kg` and links the order, but never sets `ordered_quantity`.

Build a shared converter, with an optional mass input on `createOrderFromFlight`. **Fill order quantity from `dispatch_qty_kg` only where the order has none — additive, never overwriting.**

### Migration — leave the numbers, label them

Seed data is in kilograms. **Set `uom_code = 'KG'` explicitly per existing row.** Do not convert the quantities.

`unit_price` is per kilogram. Converting quantity without converting price would silently corrupt `total_amount`, and pricing is WP-20. Relabelling without recomputing is forbidden; converting quantity without price is the same error one layer down.

New records take the litre default. Nothing existing is silently reread.

## 6. WP-12 · Delivery measurement

### The problem

`FUEL_DELIVERIES` holds a single `delivered_quantity`. There is **no meter reading and no aircraft gauge pair**, so no delivery reconciliation is possible. `density` is captured and never used; `temperature_corrected_qty` applies a volumetric correction to a mass figure, which is physically meaningless — thermal expansion acts on volume.

### `FUEL_TICKETS` — ADD meter readings

The meter belongs to the **bowser**, so it belongs on the ticket, one per vehicle.

```cds
meter_start        : Decimal(15,2);   // In uom_code
meter_end          : Decimal(15,2);   // In uom_code
quantity_metered   : Decimal(15,2);   // = meter_end − meter_start. Derived, not keyed
uom_code           : String(3);       // FK to UNIT_OF_MEASURE. The supplier's unit
density_value      : Decimal(8,4);    // As delivered, per uom_code
density_uom        : String(6);       // IATA VUOMBase: KGL kg/litre, KGM kg/m³
density_basis      : String(3) default 'MEA';  // IATA-01: MEA measured, STD standard
density_temp_c     : Decimal(5,2);
quantity_flag      : String(2) default 'GR';   // IATA-12: GR gross, NT net
quantity_kg        : Decimal(15,2);   // Derived. The canonical comparable figure
batch_coa_ref      : String(50);      // Certificate of analysis, for density disputes
```

> **These names deliberately carry no unit.** An earlier draft specified `quantity_litres` and `density_kg_per_l`, which bake in an assumption that does not hold — a gallon ticket has no litres figure, and its density is per gallon.
>
> **Store as metered, derive canonical.** The as-metered figure must survive unaltered because it is what the supplier invoices and what a dispute is about. `quantity_kg` is what reconciliation, burn and valuation compare against.
>
> `05-CONVENTIONS.md` forbids renaming a field once it exists. These do not exist yet, so they are named correctly from the start.

**`quantity_flag` is the field IATA-12 adds.** Net is temperature-corrected, gross is not. Without it no quantity in the system states which basis it is on.

`quantity` — the existing field — stays as the supplier's **claimed** figure in `uom_code`. `quantity_kg` is the derived canonical one.

**The reconciliation compares `Σ quantity_kg` against `fob_delta_kg`.** Both in kilograms, whatever the supplier metered in. That is the whole reason the canonical figure is derived — a gallon ticket and a litre ticket on the same aircraft must be summable.

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

recon_variance_kg    : Decimal(12,2);   // Σ ticket quantity_kg − fob_delta_kg
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

### Deriving the gauge uplift where the direct readings do not exist

**Added 18 August 2026.** `fob_before_kg` and `fob_after_kg` are the readings the reconciliation needs. **Neither is a standard ACARS report** — the OOOI set carries fuel at `OUT`, `OFF`, `ON` and `IN`, and refuelling is not an OOOI event. A refuelling-panel downlink can be configured per fleet, but it has no operational value to ops control and is billed per message, so it frequently is not.

**`IN` and `OUT` serve as proxies, adjusted for ground APU burn:**

```
uplift by gauge  =  fob_OUT  −  fob_IN  +  ( APU cycle minutes / 60 × apu_burn_rate_kg_hr )
```

The sign is **plus**. APU burn reduced the fuel between the two readings, so recovering the uplift means adding it back.

```
fob_IN              2,400
  APU burns            70  →  2,330
  uplift            2,600  →  4,930
  APU burns            30  →  4,900   fob_OUT

4,900 − 2,400 + 100  =  2,600   ✓
```

**This is not circular.** APU burn derives from cycle minutes and the per-tail rate, not from any fuel reading.

**The split does not matter here.** Whether the APU ran before or after the uplift is irrelevant to how much fuel went in — total ground APU is sufficient. The split matters only for **cost allocation**, deciding which flight bears it. Two purposes, two requirements.

> **It must be APU CYCLE MINUTES, never ground time.** `(OUT − IN) × rate` assumes the APU ran the whole turn. It usually did not — ground power covers most of it. On a 310-minute turn with the APU running 38 minutes, ground time gives 568 kg against an actual 70 kg. **498 kg of phantom uplift**, far beyond any tolerance, flagging every long turn as a discrepancy.

### Precision ladder

The tolerance follows the precision of the input, as elsewhere. A derived reading carries the error of its derivation.

| Source | Precision | Suggested parameters |
|---|---|---|
| Direct before and after, ACARS | To the kilogram | 0.5% \| 50 kg |
| `IN`/`OUT` adjusted, APU cycles timestamped | Good | 1.0% \| 100 kg |
| `IN`/`OUT` adjusted, APU minutes apportioned | Weaker | 1.5% \| 200 kg |
| Crew-reported before and after | Rounded to 100 kg | 1.5% \| 200 kg |
| **`IN`/`OUT` with no APU adjustment** | **Contaminated** | **Not offered** |
| Nothing | — | `NOT_RECONCILED` |

**The unadjusted row is the dangerous one and must not be available.** It produces a real-looking number with hundreds of kilograms of APU burn inside it, and nothing distinguishes it from a genuine variance.

### `fob_source` — EXTEND

The enum must record not only where the reading came from but **whether it was derived**:

```cds
type FobSource : String(20) enum {
    Acars           = 'ACARS';            // direct before and after
    AcarsDerived    = 'ACARS_DERIVED';    // IN/OUT adjusted for APU
    CrewReported    = 'CREW_REPORTED';
    PanelPreset     = 'PANEL_PRESET';
    None            = 'NONE';
}
```

**A delivery must be able to state which readings produced its variance.** Without it, a contaminated figure and a clean one are indistinguishable.

### `ground_burn_kg` inverts on the derived path

WP-12 built it as **measured** — `fob_at_arrival − fob_before_refuel`. On the derived path it becomes an **input** to the calculation rather than an output of it. Same field, opposite direction. **The delivery must record which.**

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

### `delivered_quantity` — derived, but **not in WP-12**

Decision B2 makes it the sum of its tickets, consistent with the rule that totals sum from their children.

**Deferred to WP-17.** Three reasons:

| | |
|---|---|
| `@mandatory` in two places | `schema.cds:771` and `order-fiori-annotations.cds:670`. Making it derived is a **relax**, and relaxing a constraint is not additive — the readers need surveying first |
| Two writers set it directly | `refueler-service.js:148` and `:159` |
| Five readers consume it for `EPD401` | In `order-service.js` |

WP-17 is delivery and FOB reconciliation — **where the derived value is actually consumed.** Changing it there, alongside the reconciliation that depends on it, is safer than changing it here and leaving it unused for two packages.

**WP-12 records the four sites and leaves them.**

### `temperature_corrected_qty` — keep the name, gate on unit

**Resolved 17 August 2026.** An earlier draft offered a choice including renaming. Renaming is prohibited by `05-CONVENTIONS.md` §6, and the field appears in projections and seed data.

The correction is **volumetric** — `Measured × [1 − 0.00099 × (T − 15)]`. Thermal expansion acts on volume, not mass. It is meaningful only where `uom_code` is a volume unit.

```
uom_code is a volume unit  →  compute the correction
uom_code is a mass unit    →  return null
```

**Return `null`, never the input unchanged.** Returning the input silently claims a correction was applied. Missing is not zero.

> **Naming debt, accepted.** The field name implies a density correction that does not happen. It is retained because renaming an existing field is prohibited. **State the discrepancy in the field comment** so the next reader is not misled.

### `density_uom` — a CDS enum, not a master table

```cds
type DensityUom : String(6) enum {
    KgPerLitre = 'KGL';
    KgPerM3    = 'KGM';
}
```

**With `@assert.range`**, per defect D25 — a declared enum enforces nothing without it.

Not a row in `UNIT_OF_MEASURE`. That table holds **quantity** units and carries attributes: `conversion_to_kg`, `sap_uom`, `sap_uom_iso`. Density units are a different kind of thing with no attributes, and a master table for two attribute-free values is over-engineering.

Values are IATA `VUOMBase`. Add members if a supplier transmits one.

### Error codes — `EPD`, and look them up

**No new prefix.** `03-VALIDATION-RULES.md` places the FOB reconciliation rules in the `EPD` block, and **`EPD411` — "meter reading does not match ticket quantity" — is designed, unimplemented, and exactly this rule.**

Consult `03-VALIDATION-RULES.md` for the assigned code before writing one, as WP-07 did with `MDM402`. New codes in an existing prefix start at `x450`.

### Validation that must NOT be written

**Do not require ticket B to start after ticket A ends.** Parallel bowsers are legitimate on widebodies — two trucks pumping simultaneously into one manifold. Enforcing sequence fails every two-bowser turn.

### `FLIGHT_CYCLE_EVENTS` — REMOVE fuel fields

It carries `uplift_kg`, `density_kg_l`, `temperature_c`, `bowser_id` and `sequence_number` against a `REFUELING` event type. **Three places holding fuel quantities is one too many.** Strip them; leave it a movement event log.

Check for readers first. If any exist, report rather than delete.

---

## 9. WP-18 · Dispatch plan versioning and the regulated stack

Written 18 August 2026. Decisions A7 and B3 apply. The validation rules already prescribe most of this — `DSP450` to `DSP456`, `STG412`, `ENR452` — and none of the fields they name exists.

### 9.1 The regulated fuel stack — B3

`FLIGHT_DISPATCH` carries a single `dispatch_qty_kg`. The stack is a regulatory requirement and the basis of every fuel variance.

```cds
trip_fuel_kg          : Decimal(12,2);
contingency_fuel_kg   : Decimal(12,2);
alternate_fuel_kg     : Decimal(12,2);
final_reserve_kg      : Decimal(12,2);
additional_fuel_kg    : Decimal(12,2);   // EDTO, anticipated delay
taxi_fuel_kg          : Decimal(12,2);
extra_fuel_kg         : Decimal(12,2);   // commander's discretion
block_fuel_kg         : Decimal(12,2);   // DSP450. Derived from the components
required_uplift_kg    : Decimal(12,2);   // DSP451. Block less fuel already on board
```

**`additional` and `extra` are held separately.** Additional is a planned requirement; extra is discretionary. Merging them loses the distinction between what the operation required and what the commander chose.

**`block_fuel_kg` is derived, never keyed** — the sum of its components. `dispatch_qty_kg` is retained as the dispatcher-confirmed figure and should equal it.

**This unblocks the burn variance ladder.** `planned_burn_kg` is hardcoded to `0` today, so the `> 0` guard never fires and every ACARS ingest stores `NORMAL` with zero variance — defect D10. Trip fuel is the figure it needs.

### 9.2 Versioning — family, version, status

```cds
plan_group_id     : String(40);          // DSP452. The family — all versions of one plan
plan_version      : Integer;             // Non-contiguous. See below
plan_status       : PlanStatus;          // DSP452. Exactly one ACTIVE per group
superseded_by     : Association to FLIGHT_DISPATCH;
version_gap_flag  : Boolean default false;   // DSP456
versions_skipped  : Integer default 0;       // DSP456
plan_version_source : PlanVersionSource;     // FEED or ASSIGNED. See 9.3

type PlanStatus : String(20) enum {
    Active     = 'ACTIVE';
    Superseded = 'SUPERSEDED';
}

type PlanVersionSource : String(10) enum {
    Feed     = 'FEED';       // the source supplied the version — gaps are detectable
    Assigned = 'ASSIGNED';   // assigned on receipt — gaps are INVISIBLE
}
```

**A superseded version is never updated in place** — `DSP453`. A revision inserts a new row.

**`version_gap_flag` and `versions_skipped` are stamped on the applied row and never back-updated** — `DSP456`. They record what was known at the time of application.

> **Version numbers are NOT contiguous.** `STG412`: the feed transmits the current plan only, so missing intermediate versions **will never arrive**. Receiving v1 then v4 is normal, not an error. **Apply v4, flag the gap, do not hold.** Decision A7 in your own words: *"flag a version gap but not hold it."* Any logic assuming a dense sequence is wrong — and a gap can only be **detected** if the version arrives on the feed. Where it is assigned on receipt instead, gaps are invisible.

### 9.3 Two axes — the plan revision and the commercial commitment

> **On naming.** The field is `dispatch_order_id` in `db/schema.cds`, but the Excel column is `FUEL_ORDER_ID` and the field's own comment reads *"External dispatch system's Fuel Order ID"*. **It is the fuel order ID** — the technical name is ours and it is misleading. Renaming is prohibited by `05-CONVENTIONS.md` §6, so the `@title` carries *"Fuel Order ID"* and users never see the technical name. **This document uses "fuel order ID" throughout; `dispatch_order_id` appears only where the field itself is meant.**

**Answered 18 August 2026.** The **fuel order ID** changes **only when the order has already been communicated to the supplier and confirmed.**

```
plan revised BEFORE the order is confirmed   →  same fuel order ID
                                                the plan simply updates

plan revised AFTER  the order is confirmed   →  NEW fuel order ID
                                                a new commercial commitment
```

**So it cannot be the family key.** It is stable through some revisions and not others, and what it marks is a commercial boundary rather than a plan revision.

| | Tracks | Changes on |
|---|---|---|
| `plan_version` | The plan revision | **Every** re-plan |
| **Fuel order ID** — `dispatch_order_id` | The commercial commitment | **Confirmation, then a new commitment** |
| `plan_group_id` | The flight leg's plan family | Never — derived from `flight_leg_id` |

**Three axes, none substituting for another.**

> **This is the same rule seen from the other side.** A confirmed order cannot be increased; an increase is a new incremental order. A new fuel order ID after confirmation **is** that rule expressed in the feed. So a flight may legitimately carry two orders — the original and an incremental one — each against a different plan version.

**`plan_group_id` derives from `flight_leg_id`**, which `ENR452` makes immutable and which survives a tail swap.

**`plan_version` should come from the feed. It does not — measured under WP-18.**

`docs/data/flight_dispatch_upload.csv` carries **exactly the 18 columns the import already read.** No version, no revision, no sequence. `ofplan_reference` carries no revision suffix, and the dispatch specification has no version-like field either.

**The import was not discarding a version. There was none.** `PLAN_VERSION` and the seven stack columns are now in the read set regardless, so the mechanism works the moment the source supplies them.

### `plan_version_source` — added by WP-18, and required

```cds
plan_version_source : PlanVersionSource;   // FEED | ASSIGNED
```

Where the version is **assigned on receipt** rather than supplied, versions are contiguous by construction — so `version_gap_flag` **can never fire.**

**Without this field, `version_gap_flag = false` cannot be told apart from "could not look."** An unknown must never read as a pass. Same principle as `NOT_RECONCILED`, and the same convention as `conversion_source` and `fob_source`.

> **Consequence, today.** With the current feed, `plan_version_source = ASSIGNED` and **gap detection does not work.** Versioning, supersession and the order-to-plan link all function; only the gap flag is inert. It becomes live the moment the source supplies a version, with no further change.
>
> **This is worth raising with the dispatch system owner.** `STG412` says intermediate versions never arrive, so without a source version there is no way to know one was missed — and the design's answer to a version gap, *flag and apply*, has nothing to flag.

### 9.4 `flight_leg_id` — immutable through a tail swap

```cds
flight_leg_id : String(40);   // ENR452. Immutable
```

`ENR452`: a tail swap changes `actual_registration` only — **`flight_leg_id` is immutable.**

That matters here because a tail swap produces a **new dispatch plan** carrying the new tail. Without a stable leg identity, the new plan looks like a different flight rather than a revision of the same one.

### 9.5 `FUEL_ORDERS` — the order must reference the plan

**The gap most easily missed.** `FUEL_ORDERS` links to `FLIGHT_SCHEDULE` and to no plan at all; `FLIGHT_DISPATCH` points at the order, and the order does not point back.

```cds
dispatch_plan : Association to FLIGHT_DISPATCH;
```

**Without it, adding versions closes nothing.** There is no way to say which plan an order was created against, whichever plans exist.

**Consequence, per decision A7 as extended:** an order whose plan has since been superseded is **stale by construction**. That is the amendment trigger, and it needs no field comparison — the question is simply whether this order's plan is still the active one.

### 9.6 Defect D27 — a re-plan is discarded today

`order-service.js:847-851` builds a composite dedup key and **skips** on a match:

```
warn, dispatchesSkipped++, continue
```

Not update-in-place, not a second row. So a re-plan reusing the id for the same flight and date is **silently discarded and the revised quantity never lands** — the only trace is a `WARNING` in an import log.

The author assumed one dispatch per order, flight and date, permanently. **WP-18 replaces that assumption**: a matching key is a revision, not a duplicate.

**Separately, the import reads 18 named columns and discards everything else without comment.** If the feed already carries a version column, it is being thrown away. Report what the source actually sends before designing around its absence.

---

## 10. WP-07B · Tail references as associations

Written 18 August 2026. Decisions B1 and A4 apply.

### 10.1 Seven entities, three of them the burn side

| Entity | Field | |
|---|---|---|
| `FLIGHT_SCHEDULE` | `aircraft_reg` | optional |
| `FUEL_DELIVERIES` | `aircraft_reg` | `@mandatory` |
| `FUEL_TICKETS` | `aircraft_reg` | optional |
| `FLIGHT_DISPATCH` | `tail_number` | optional |
| **`FUEL_BURNS`** | `tail_number` | `@mandatory` |
| **`ROB_LEDGER`** | `tail_number` | `@mandatory` |
| **`FUEL_BURN_EXCEPTIONS`** | `tail_number` | `@mandatory` |

**The bottom three are why this runs before WP-19.** Burn derivation reads gauge points on `FUEL_BURNS`, chains through `ROB_LEDGER` and raises `FUEL_BURN_EXCEPTIONS` — every entity it touches is one of these. Built against strings, they migrate afterwards with live derivation logic on top.

### 10.2 Retain both. This is additive, not a tightening

```cds
tail_number : String(10) @mandatory;                    // UNCHANGED
tail        : Association to AIRCRAFT_REGISTRATIONS;    // NEW, optional
                                                        // FK: tail_registration
```

> **CORRECTED 18 August 2026.** An earlier draft named the association `aircraft`. **That name is already taken on four of the seven**, as an association to `AIRCRAFT_MASTER` — the **type** master, keyed on `type_code`, and `@mandatory` on three of them.
>
> It would not merely have collided. It would have meant **aircraft type in three places and this tail in four others, under one name** — which compiles, and is worse than a name that does not.
>
> **`tail` is the association; `tail_registration` is the generated foreign key.** Verify against the compiler before relying on either.

**The string keeps its existing constraint.** Where it is `@mandatory` today it stays `@mandatory`; the association is added alongside and is always optional.

**So no writer starts failing**, and there is nothing to survey on the tightening side. Replacing the string would have made an unknown tail structurally impossible to record — and then no parameter could permit one.

> **Retaining both is what makes the parameter possible.** The string always lands. The association resolves or does not. The policy decides whether an unresolved record is accepted.

The string is not a duplicate to be tidied away later. It is the value as received, and it survives a registration the register has never seen.

### 10.3 `UNKNOWN_TAIL_POLICY` — the parameter

Global, per company code, effective-dated. Follows `HOLD_PAYMENT_ON_DISCREPANCY`, `FLIGHT_COST_OBJECT_MODEL` and `BURN_POSTING_TRIGGER`.

| Value | Behaviour |
|---|---|
| `ACCEPT_PROVISIONAL` | The record lands. The tail is auto-provisioned where WP-16 exists, otherwise the association is left null and the string carries it |
| `REJECT` | The record is refused, with the unresolved registration named in the error |

**Where the policy is `ACCEPT_PROVISIONAL` and WP-16 has landed**, an unknown registration creates a `PROVISIONAL` register row and the association resolves immediately — the gating from WP-07 then applies, so ticket capture proceeds and order creation does not. Until WP-16, the association stays null.

### 10.4 Ticket capture is never blockable

**`REJECT` applies to the planning feeds only.**

| Feed | Blockable |
|---|---|
| Flight schedule | Yes — the flight has not happened |
| Flight dispatch | Yes |
| **Fuel ticket** | **No** |
| **Fuel burn** | **No** |

**Decision A1 is a decision, not a default.** Fuel is already in the tanks when a ticket is written; refusing to record it puts money outside the system, which is what A1 exists to prevent. The same reasoning covers burn — it already happened.

Otherwise an airline sets `REJECT` for good reasons on the schedule feed and silently loses fuel tickets.

> **Confirm this before building.** The instruction was that the policy be parameter-driven; whether it extends to ticket capture was not stated. This document takes the position that it must not, on A1. **If that is wrong, A1 is what changes — not this section.**

### 10.5 The seed has no orphans

WP-07's harness asserts every registration referenced by transactional data exists in the register: **14 rows, 14 referenced, 0 missing.** So the migration resolves cleanly today and there is no unmatched case to design around in the seed.

**The parameter exists for production**, where a leased tail can appear on a feed before anyone has told the fuel system about it.

### 10.6 Also in scope — `recalculateROB`

```cds
action recalculateROB(aircraftId: UUID, fromDate: Date)
```

**The declared parameter cannot address a tail.** WP-03 resolved it against `tail_number` first, then `aircraft_type_code`, and left the signature alone because there was nothing better to point at. There is now.

### 10.7 Out of scope

- **Removing the string fields.** They are the value as received and they stay
- **Auto-provisioning** — MDM401, WP-16. This package consumes it if present
- **Changing any `@mandatory`** — the association is optional everywhere
- Row-level security by tail — WP-14

---

## 7. Deferred — named so they are not invented

| Item | Where it goes |
|---|---|
| Chain restart representation after a ledger break | F11 |
| Durable sink for ledger chain-break exceptions | F14 |
| ePOD delivery creating a ledger entry | F15 |
| ~~Where the ePOD signature belongs~~ | **REVERSED 24 August.** `Document_Capture_Specification.md` §8A migrates **both signature fields into `SOURCE_DOCUMENTS`**, and four fields leave `FUEL_DELIVERIES`. That is WP-31's entire premise |
| How long a delivery stays open before a new ticket opens a fresh one | F2. Two hours as a starting parameter |
| Master data upsert instead of full replace | F12 |
| Optimistic locking carrier | C5, D5 — `@odata.etag` on a DateTime does not work |
| Staging entities | WP-15 |
| ~~`FLIGHT_DISPATCH` regulated fuel stack~~ | **BUILT.** WP-18 — all six fields present, plus plan versioning |
| Carrier arrangements | WP-24 |
| ~~APU usage~~ | **BUILT.** WP-19 — `APU_USAGE` exists |

**Do not invent any of these.** Each is deferred deliberately, with the reasoning recorded in `00-DECISIONS.md`.

> **CORRECTED 24 August.** Four rows above were stale: three had been built and one decision reversed. **A do-not-invent list containing things that already exist is worse than no list** — it sends someone looking for a gap that is not there, and in the signature case it contradicts a specification merged the same day.

---

## 8. Survey before you change

Two Phase 0 packages found the defect in more places than stated: nine number-generation sites where three were named, four of fifteen services covered by authorisation, and a sweep that found fifteen enum violations none of which were on any list.

**Before changing any field named here, report every reference to it** — schema, projections, handlers, annotation files, seed CSVs. A partial change on a distributed field looks complete and is not.

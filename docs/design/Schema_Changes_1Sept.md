# Schema changes from the 1 September session

**FuelSphere · what the demo requirements need from the model**
Nothing below is built

---

## 0. The shape of it

**Six new entities, four extended, and one resolver.**

**The resolver is the largest item and it is not an entity.** Four of the six new entities are date-ranged, and **nothing in FuelSphere resolves by date today** — `valid_from`, `valid_to` and `priority` exist on several entities and no code reads them.

---

## 1 · `AIRCRAFT_REGISTRATIONS` — the tail master

### What exists

```
registration · aircraft_type_code · record_status · on_own_aoc
apu_burn_rate_kg_hr · dry_operating_weight_kg · performance_factor_pct
```

### What is missing

**`engine_burn_rate_kgph` does not exist anywhere.** Not on the tail, not on the type. Burn is computed as `fob_OUT − fob_IN`, so nothing has ever needed a rate.

**And MTOW, MLW and MZFW are on the TYPE**, not the tail — so two aircraft of one type cannot differ, and they do.

### `AIRCRAFT_PERFORMANCE` — NEW, dated per tail

```cds
entity AIRCRAFT_PERFORMANCE {
  key ID                     : UUID;
      tail                   : Association to AIRCRAFT_REGISTRATIONS;
      engine_burn_rate_kgph  : Decimal(8,2);    // NEW to the model
      apu_burn_rate_kg_hr    : Decimal(6,2);    // moves here, dated
      mtow_kg · mlw_kg · mzfw_kg · dow_kg       // move from the type
      fuel_capacity_kg       : Decimal(10,2);
      performance_factor_pct : Decimal(6,3);
      valid_from · valid_to  : Timestamp;
      source                 : String(20);      // REGISTER · PROPOSED · MEASURED
}
```

**Why dated:** engine burn drifts with age and airlines re-baseline; MTOW changes on a weight variant; DOW moves on a cabin reconfiguration.

> **The consequence is the harder half.** A ground burn computed for March must use March's rate. **Recomputing it today with a revised rate silently changes history**, and S1's 52.50 kg derives from a rate of 105 — the extract's zero-mismatch check would catch a divergence, which is the right outcome.

### `AIRCRAFT_TANKS` — NEW, master data only

```cds
entity AIRCRAFT_TANKS {
  key ID          : UUID;
      tail        : Association to AIRCRAFT_REGISTRATIONS;
      tank_code   : String(10);      // LH_WING · RH_WING · CENTRE · AUX
      tank_name   : String(40);
      capacity_kg : Decimal(10,2);
      sequence    : Integer;
}
```

**Nothing consumes it.** No tank field on the uplift, no validation, no configuration. **The provision exists so the capability can be shown.**

---

## 2 · `FLIGHT_SCHEDULE` — the schedule

### What it already has

`aircraft_reg` beside `tail`, `linked_flight_number`, `linked_flight_date`, `codeshare_flights`, gate, stand, terminal, the four OOOI times, the four `fob_at_*_kg`, `flight_closure_utc`.

**More than expected.** The gate and stand Shailesh asked for are present.

### What is missing — and it is display, not schema

**The linked flight's origin and destination are not resolved.** `linked_flight_number` and `linked_flight_date` exist; **nothing joins them back to a schedule row** to get its route.

**Either a to-one association on those two fields, or a view.** Note the association would need an `on` condition over two plain columns — which is permitted, unlike a hop through a managed association.

### What is genuinely new

**Nothing on the entity itself.** The supplier, the agent, the contacts and the aircraft figures **all resolve through associations** — which is the requirement rather than a convenience.

> **The rule that governs all of it:** resolved, never copied. A supplier changes a number and every flight shows the new one. **A denormalised copy shows the old one forever and nothing says which is current.**

---

## 3 · `FLIGHT_FUELLING_PROFILE` — NEW, and the session's largest item

**Whether this flight is fuelled by us, at this station, in this period.**

```cds
entity FLIGHT_FUELLING_PROFILE {
  key ID                : UUID;
      flight_number     : String(8);
      station           : Association to MASTER_AIRPORTS;
      carrier_code      : String(3);
      fuelling_required : Boolean;                 // THE FLAG — decides
      arrangement_type  : ArrangementType;         // explains
      primary_codeshare_flight_number : String(8);
      valid_from · valid_to : Timestamp;
}
```

| `ArrangementType` | |
|---|---|
| `OWN` | Our metal, our fuel |
| `CODESHARE` | Somebody else operates it. **No fuelling activity at all** |
| `WET_LEASE` · `DAMP_LEASE` · `DRY_LEASE` | Fuelling depends on the agreement |

**The flag decides. The attribute explains.** A wet-leased flight and a codeshare both read `false` **for visibly different reasons.**

### Why at flight level and not tail

> *"You are serving the flight. The aircraft is just holding the fuel."*

**A tail swap onto a leased aircraft does not change who fuels**, because the lease is drawn against named flights rather than being open-ended.

### The pattern it copies

**SIA's airport profile** — flight → profile → services, each routine/non-routine and mandatory/optional. **Fuel is one service among about a thousand**, and roughly a hundred apply to an average flight.

---

## 4 · `DESIGNATED_SUPPLIERS` — NEW

```cds
entity DESIGNATED_SUPPLIERS {
  key ID                      : UUID;
      flight_number           : String(8);         // PRIMARY axis
      station                 : Association to MASTER_AIRPORTS;  // fallback
      carrier_code            : String(3);
      product                 : Association to MASTER_PRODUCTS;
      supplier                : Association to MASTER_SUPPLIERS;
      supplier_contract       : Association to MASTER_CONTRACTS;
      supplier_performs_uplift: Boolean;
      into_plane_agent        : Association to MASTER_SUPPLIERS;
      into_plane_contract     : Association to MASTER_CONTRACTS;
      designation_type        : DesignationType;   // PRIMARY · ALTERNATE · EMERGENCY
      valid_from · valid_to   : Timestamp;
      priority                : Integer;
}
```

### The cascade

```
1  flight + date       →  defaults
2  else station + date →  defaults
3  else NOTHING        →  the order is created with an empty supplier
```

**Not a refusal, and not a fallback to any contract at that station** — picking one arbitrarily is the join that over-matches, in a new place.

### Two contracts because there are two relationships

**The fuel is bought under one agreement; putting it in the wing is bought under another.** The HLD's `ZFUEL_ITP` and `ZFUEL_FEE` are exactly this split.

**`supplier_performs_uplift = TRUE`** → the agent fields are blank and the fee sits in the fuel contract.

---

## 5 · `MASTER_SUPPLIERS` and `SUPPLIER_CONTACTS`

### Extend `MASTER_SUPPLIERS`

```
iata_code · icao_code
supplier_type      INTO_PLANE · TRADER · REFINER · AGENT
parent_supplier    agents billing through a supplier
```

**An into-plane agent is not a separate entity.** S/4 models it as partner role `WL` with the supplier remaining `LF` — **one entity, `supplier_type = AGENT`, `parent_supplier` set.**

### `SUPPLIER_CONTACTS` — NEW

```cds
entity SUPPLIER_CONTACTS {
  key ID           : UUID;
      supplier     : Association to MASTER_SUPPLIERS;
      contact_role : ContactRole;   // INVOICING · UPLIFT · DISPUTES · OPERATIONS
      name · position · phone · mobile · email
      hours · timezone
      is_primary   : Boolean;
      valid_from · valid_to : Timestamp;
}
```

**Role is a value, not a column set.** A supplier with two disputes contacts is normal, and a column set cannot hold the second.

---

## 6 · The resolver — one, not four

**Four consumers, and none of them exists:**

```
tail → carrier assignment      F40
contract → carrier             F40
flight or station → supplier   DESIGNATED_SUPPLIERS
tail → performance             AIRCRAFT_PERFORMANCE
flight → fuelling required     FLIGHT_FUELLING_PROFILE
```

**Five, in fact.** Every one asks *as at which date*, and **nothing currently does.**

### What it must handle

**Overlapping validity** — two rows valid on one date, resolved by `priority`.

**Open-ended `valid_to`** — the common case.

**And a miss.** A resolver that returns nothing is a normal outcome here — an undesignated station, a tail with no performance row — and **the caller decides what that means.** Refusing is wrong for the supplier and right for the performance.

---

## 7 · Not changed, and worth saying

**`FUEL_TICKETS`** — no change. Tank-wise uplift is **master data only** and nothing on the ticket references it.

**`FUEL_ORDERS`** — no schema change. The supplier and agent **default from the designation** at creation, into fields that already exist.

**`FLIGHT_DISPATCH`** — no change. The plan carries quantities; **the supplier is resolved at order creation, not at plan time.**

---

## 8 · What to measure before building any of it

```
does FLIGHT_SCHEDULE hold anything resembling a fuelling flag today
what does MASTER_SUPPLIERS actually carry — is there any contact field
do MTOW / MLW / MZFW exist on AIRCRAFT_MASTER, and are they populated
is fuel_capacity_kg on the tail or the type
does anything anywhere read valid_from or valid_to
and how many of the six new entities are fields on something existing
```

**The last question decides the size.** Several of these may be columns rather than tables, and **a new entity where a field would do is two objects for one fact.**

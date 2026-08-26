# Demo Test Data — All Ten Scenarios

**FuelSphere · seed specification**
24 August 2026

---

## 1. How to read this

Every figure is **computed, not chosen.** If a status differs from the one stated, either the seed is wrong or the code is — and the arithmetic says which.

**S1 to S4 are already seeded.** They are restated here for the chain, unchanged. **S5 to S10 are new.**

### Tolerance, for reference

Hardcoded at WP-17, moved into `TOLERANCE_RULES` at WP-13. **Whichever limb is larger wins.**

| `fob_source` | Percentage | Floor |
|---|---|---|
| `ACARS` | 0.5% | 50 kg |
| `ACARS_DERIVED` | 1.0% | 100 kg |
| `CREW_REPORTED`, `PANEL_PRESET` | 1.5% | 200 kg |
| `NONE` | — | `NOT_RECONCILED`, no comparison |

---

## 2. Master data — everything ties to this

One airline, Canadian, one week.

### Aircraft register

| Registration | Type | DOW kg | Capacity kg | APU kg/h | Status | Used by |
|---|---|---|---|---|---|---|
| `C-FDMO` | A320-200 | 42,600 | 19,150 | 110 | `CONFIRMED` | S1, S5, S9 |
| `C-FDMP` | A320-200 | 42,600 | 19,150 | 110 | `CONFIRMED` | S3, S7 |
| `C-FDMQ` | A320-200 | 42,750 | 19,150 | 110 | `CONFIRMED` | S4, S10 |
| `C-GDMS` | A350-900 | 142,400 | 110,500 | 260 | `CONFIRMED` | S2, S8 |
| **`C-GXLW`** | **A321-200** | 48,500 | 23,700 | 120 | **`PROVISIONAL`** | **S6** |

> **`C-GXLW` is the whole point of S6.** A leased tail, entered as provisional. **Ticket capture must succeed; order creation must be refused.** Decision A4.
>
> `apu_burn_rate_kg_hr` on every row — S10 consumes it and nothing else has.

### Airports

| | | |
|---|---|---|
| `YYZ` | Toronto Pearson | Plant 1000 |
| `YUL` | Montréal-Trudeau | Plant 1000 |
| `YVR` | Vancouver | Plant 1000 |
| `LHR` | London Heathrow | Plant 2000 |

### Suppliers and contracts

| Supplier | Station | Contract | Used by |
|---|---|---|---|
| World Fuel Services | `YYZ` | `AC-WFS-2025-001` | S1, S3, S4, S5, S6, S9, S10, S8 (A) |
| **Shell Aviation** | **`YYZ`** | **`AC-SHELL-2025-001`** | **S8 (B)** |
| Menzies Aviation | `YVR` | `AC-MENZ-2025-001` | S7 |
| BP Aviation | `LHR` | `AC-BPUK-2025-001` | S2 |

> **Two suppliers at YYZ is what makes S8 possible**, and a second contract is required — the two-supplier case is a contract fact, not a data accident.
>
> **Every contract needs `CONTRACT_LOCATIONS` and `CONTRACT_PRODUCTS` rows.** WP-DEMO-02 found four contracts with neither, which made the station value help blind to Canadian stations. Do not repeat it.

---

## 3. Already seeded — S1 to S4

| | Sector | Metered | Gauge | Variance | Tolerance | Status |
|---|---|---|---|---|---|---|
| **S1** | A320 YYZ–YUL | 2,601.6 | 2,601 | 0.6 | 50.00 · floor | `RECONCILED` |
| **S2** | A350 YYZ–LHR | 37,675.0 | 37,580 | 95.0 | 188.38 · pct | `RECONCILED` |
| **S3** | A320 YYZ–YUL | 2,601.6 | 2,450 | 151.6 | 50.00 · floor | **`VARIANCE`** |
| **S4** | A320 YYZ–YUL | 2,318.6 | 2,319 | −0.5 | 50.00 · floor | `RECONCILED` + `EPD401` |

**S2's 95 kg variance is larger than S3's entire 50 kg tolerance, and S2 passes.** That contrast is the single best thing in the seed — 95 on 37 tonnes is noise, 152 on 2.6 tonnes is a finding.

**S4 is S3's mirror:** the measurements agree to half a kilogram and the supplier brought 350 L less than ordered — **−10.77%, `EPD401`.** No measurement check could have caught it.

---

## 4. S5 · Fuel with no order

**A verbal top-up after a delay.** No order exists, and the fuel is already in the tanks.

`C-FDMO` · `YYZ` · 26 March

```
meter start        106,008
meter end          106,758
quantity_metered       750 LTR
density_value       0.7995
quantity_kg         599.62

fob_before_kg        4,900
fob_after_kg         5,500
fob_delta_kg           600

variance             −0.38
tolerance            50.00      the floor governs
```

### What must be true

**`order` is NULL.** `match_status = UNMATCHED`.

**`internal_number` is NULL.** WP-04's allocator will not mint a ticket number without a station, and the station comes from the order. **Do not invent one.**

> **And the delivery reads `NOT_ATTRIBUTABLE`, not `RECONCILED`.**
>
> The supplier resolves transitively through the order. No order means the supplier set is **unknown**, not a singleton — and unknown is not a single supplier. WP-17 established this: *one known supplier alongside an unmatched ticket is still not attributable.*
>
> **Two states interacting, and both correct.** This is the scenario that proves the rule rather than restating it.

### The second half

**Then attach it to an order.** `attachToOrder` allocates the internal number at that moment, the supplier resolves, and the delivery reconciles.

**Seed the order it will attach to** — an existing YYZ order with capacity for 750 L — so the action can actually be demonstrated.

---

## 5. S6 · An unknown aircraft

**A leased tail nobody has told the fuel system about.** `C-GXLW`, A321, `PROVISIONAL`.

`YYZ` · 26 March

```
meter start        200,000
meter end          204,200
quantity_metered     4,200 LTR
density_value       0.7995
quantity_kg        3,357.90

fob_before_kg        1,800
fob_after_kg         5,158
fob_delta_kg         3,358

variance             −0.10
tolerance            50.00
                RECONCILED
```

### What must be true

**The flight record applies.** The ticket is **captured**. The delivery **reconciles normally**.

**Order creation is REFUSED — `MDM402`.**

> *Capture is never blocked; external commitment is gated.* The gate is on the order, not on the fuel — because the fuel has already moved and refusing to record it puts money outside the system.

**Seed an attempted order that was refused**, or leave the demonstration to a live action. The second is better: pressing *Create Order* and watching it refuse is worth more than a row saying it was refused.

---

## 6. S7 · No gauge reading

**A station with no ACARS and no crew entry.** The meter is all there is.

`C-FDMP` · `YYZ`–`YVR` · 27 March

```
meter start        110,000
meter end          115,600
quantity_metered     5,600 LTR
density_value       0.7995
quantity_kg        4,477.20

fob_before_kg         NULL
fob_after_kg          NULL
fob_delta_kg          NULL
fob_source            NONE

recon_variance_kg     NULL      NOT computed
recon_status          NOT_RECONCILED
```

### What must be true

**`recon_variance_kg` is NULL, not zero.** Zero says *measured and it was nothing*; NULL says *not measured*.

**`NOT_RECONCILED` must not render as a pass.** Amber, never green, never grey.

> **This is the design's clearest principle and the screen is where it either holds or is quietly lost.** Unknown is not agreement.

**Do not copy `fob_at_arrival_kg` into `fob_before_kg`** to make it look complete. That manufactures a zero ground burn where the truth is unknown.

---

## 7. S8 · Two suppliers, one gauge pair

**A widebody fuelled by two suppliers.** One aircraft, one FQIS reading, two commercial relationships.

`C-GDMS` · `YYZ`–`LHR` · 28 March

**Ticket A — World Fuel Services**

```
meter          300,000 → 322,000
volume          22,000 LTR
density         0.7982
mass         17,560.40 kg
```

**Ticket B — Shell Aviation**

```
meter          400,000 → 401,800
volume           1,800 LTR
density         0.7982
mass          1,436.76 kg
```

```
metered, summed   18,997.16 kg
fob_before             8,000
fob_after             26,985
fob_delta_kg          18,985

variance               12.16      0.06%
tolerance              94.99      well within

supplier_count             2
recon_status    NOT_ATTRIBUTABLE
```

### What must be true

**The variance is computed and recorded. It is not attributed.**

> **A variance of 12 kg on 19 tonnes is 0.06% and comfortably inside any tolerance — and it still will not attribute.**
>
> The obstacle is not size. The figure belongs to neither supplier, and **a small figure belongs to neither just as completely as a large one.** Attribution is not something a small variance earns.

**Pro-rata allocation by volume is arithmetically neat and evidentially worthless.** Do not implement it, and do not seed a row that implies it.

**`supplier_count = 2`** — and it resolves transitively through the tickets to their orders. Two orders, two suppliers, two contracts.

---

## 8. S9 · The broken chain

**A burn arrives before its uplift.** The paper ticket is still in transit from an outstation.

`C-FDMO` · `YYZ`–`YUL` · 26 March, the leg after S5

```
opening_rob_kg          900
uplift_kg                 0      the ticket has not arrived
burn_kg               2,650
adjustment_kg             0
                    ───────
computed closing     −1,750      NEGATIVE
```

### What must be true

**No ledger row is written.** WP-03 established this — a negative closing balance means an event is missing, and writing the row would record a fiction.

**`FB402` is raised carrying all four inputs and the computed closing.** The error is the record.

**The next flight for that tail is still recorded.** A broken chain must not stop the airline operating.

> **What this proves:** the ledger is a detector, not a report. It found a missing event without being told one was missing.
>
> **What it does not prove, and say so if asked:** a *plausible* wrong figure produces a perfectly valid ledger that is quietly wrong from then on. That is **F37**, and the control for it does not exist.

---

## 9. S10 · The ground gap

**A four-hour turn.** Fuel leaves the tanks with no engine running, and the split point is operational.

`C-FDMQ` · arrives `YUL` from `YYZ`, departs `YUL` for `YYZ` · 29 March

### The timeline

```
IN              10:00     fob_in_kg   2,900
FLIGHT CLOSURE  11:20     from the TECH LOG
refuelling      14:00
OUT             15:10     fob_out_kg  5,150
```

### APU cycles — one row per cycle

| Start | Stop | Minutes | Phase |
|---|---|---|---|
| `10:05` | `11:35` | 90 | `POST_ARRIVAL` |
| `14:30` | `15:05` | 35 | `PRE_DEPARTURE` |

**Rate 110 kg/h**, from `C-FDMQ`'s register row.

### The split — decision C-4

**Flight closure is when the inbound captain signs off and hands the aircraft to engineering.** Everything before it belongs to the arriving flight.

```
cycle 1   10:05 → 11:20    75 min    137.5 kg    ARRIVING
          11:20 → 11:35    15 min     27.5 kg    DEPARTING
cycle 2   14:30 → 15:05    35 min     64.2 kg    DEPARTING
                                     ────────
          arriving flight            137.5 kg
          departing flight            91.7 kg
          total ground APU           229.2 kg
```

**Cycle 1 spans the closure**, so it splits. That is the case that makes the timestamp necessary — a phase rule alone would put all 165 kg on one side.

### And the uplift derives

Refuelling is not an OOOI event, so `fob_before` and `fob_after` are not transmitted. `IN` and `OUT` are.

```
uplift = fob_OUT − fob_IN + APU ground burn
       =  5,150   −  2,900  +      229.2
       =  2,479.2 kg

metered   3,100 LTR × 0.7995 = 2,478.45 kg

variance    −0.75
tolerance  100.00      ACARS_DERIVED
       RECONCILED
```

### What must be true

**`fob_source = ACARS_DERIVED`**, not `ACARS`. The reading was derived and the record must say so — otherwise a derived figure and a measured one are indistinguishable.

**Without the adjustment:** `5,150 − 2,900 = 2,250`, variance **228.45 kg**, `VARIANCE`. **The APU burn is the entire variance**, and the delivery would flag for no reason.

**Show both.** That contrast is why the adjustment exists.

---

## 10. What ties to what

Nothing may dangle. Every reference resolves.

| | |
|---|---|
| Every ticket | → a delivery. **Except none — a ticket always has one** |
| Every ticket | → an order, **except S5 before attachment** |
| Every delivery | → a tail in the register |
| Every order | → a contract → a supplier → a station |
| Every contract | → `CONTRACT_LOCATIONS` **and** `CONTRACT_PRODUCTS` rows |
| Every flight | → a dispatch plan, **except S5's top-up** |
| Every dispatch plan | → the seven stack components summing to `block_fuel_kg` |
| Every APU cycle | → a tail whose register row has `apu_burn_rate_kg_hr` |

**S6 is the deliberate exception:** `C-GXLW` is in the register as `PROVISIONAL`, and no order exists for it because order creation was refused.

---

## 11. Verification

Each figure is determined. A harness should assert:

| # | |
|---|---|
| 1 | S5's ticket has no order, no internal number, and `match_status = UNMATCHED` |
| 2 | **S5's delivery is `NOT_ATTRIBUTABLE`**, because the supplier set is unknown rather than singular |
| 3 | S5's ticket, once attached, receives an internal number and the delivery reconciles |
| 4 | S6's ticket is captured against a `PROVISIONAL` tail |
| 5 | **S6's order creation is refused with `MDM402`** |
| 6 | S7's `recon_variance_kg` is **NULL, not 0**, and status is `NOT_RECONCILED` |
| 7 | S8 computes a variance of 12.16 and does **not** attribute it |
| 8 | S8's `supplier_count = 2`, resolved through the tickets |
| 9 | S9 writes **no ledger row** and raises `FB402` with all four inputs |
| 10 | S9's next flight for `C-FDMO` **is** recorded |
| 11 | S10's cycle 1 splits 137.5 / 27.5 at the closure timestamp |
| 12 | S10's derived uplift is 2,479.2 and the delivery reconciles |
| 13 | **S10 without the APU adjustment produces a 228.45 kg variance** |
| 14 | Every reference in section 10 resolves. Zero orphans |

**Assertion 13 is the one worth building the harness around.** It proves the adjustment is doing work rather than agreeing by coincidence.

**Assertion 2 is the one most likely to be got wrong** — it looks like a defect until you know why.

---

## 12. Two things not to do

**Do not fix a scenario to make it pass.** S5's `NOT_ATTRIBUTABLE`, S7's NULL variance and S8's refusal to attribute are all **correct outcomes that look like failures.** Each is a state the design chose deliberately.

**Do not seed a figure that cannot be reproduced from its inputs.** Every mass here is a volume times a density; every variance is one measurement minus another. A number that does not recompute is a number nobody can defend.

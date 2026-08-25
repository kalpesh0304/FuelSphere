# Scenario 1 — Seed Data Correction

**FuelSphere · `AC410` · 10 April 2026 · `C-FDMO` · YYZ→YUL**
25 August 2026

---

## 1. What this is

The seeded S1 was surveyed against the code on 24 August. **Four arithmetic checks pass exactly. Eight things do not survive scrutiny**, and four tables that the scenario needs are empty.

This specifies every value. **Nothing here is chosen to make a total work** — each figure derives from the one before it, and section 9 is the chain.

> **S1 is identified by `demo01-harness.js:21`** — delivery `EPD-YYZ-20260410-0001`, tail `C-FDMO`, flight `AC410`. Not by inference.

---

## 2. What was wrong

| | Seeded | Problem |
|---|---|---|
| **Regulated stack** | Sums to 4,803.00 | **Every component an exact multiple of 1% of block.** Constructed, not planned |
| **Contingency** | 240.15 | 5% of **block**. Regulation is 5% of **trip** — this is 6.54% of trip |
| **Final reserve** | 288.18 | **Seven minutes** of holding. Thirty is the requirement |
| **Trip fuel** | 3,674.29 | Implies **3,674 kg/h airborne**. An A320 cruises near 2,400 |
| **Departure fuel** | 6,700 against a block of 4,803 | **1,897 kg unexplained.** `extra_fuel_kg` records 48 |
| **`required_uplift_kg`** | empty | And `block − fob` does not equal the uplift |
| **Ground burn** | 250 kg | **143 minutes of APU** on a turn, with no cycle row to justify it |
| **Timestamps** | `07:15:00Z` | A **local** time wearing a `Z`. Reads as 03:15 in Toronto |
| **Contract currency** | USD | Order totals in CAD. **No FX rate on either row** |

**What was right and stays:** the metered-to-mass conversion, the gauge pair, the variance, and `RECONCILED`. That chain was exact end to end and it is what S1 exists to show.

---

## 3. Four tables the scenario needs and does not have

| | |
|---|---|
| **`APU_USAGE`** | **Zero rows.** WP-19 built the entity and the derivation module; nothing feeds it. So `ground_burn_kg` cannot be computed and 250 kg is a typed number |
| **`FUEL_BURNS`** | No row for `AC410`. The block and trip figures have nowhere to live |
| **`ROB_LEDGER`** | No chain for `C-FDMO`. The balance that ties the whole scenario together is absent |
| **`SOURCE_DOCUMENTS`** | New from WP-31. No document for the ticket, the meter, the gauge readings or the tech log |

**And twenty-five fields from WP-33 are empty**, including the four `fob_at_*_kg`, `flight_closure_utc`, and the actual stations.

---

## 4. `FLIGHT_SCHEDULE`

```
flight_number            AC410
flight_date              2026-04-10
airline_code             AC
aircraft_reg             C-FDMO
origin / destination     YYZ / YUL
status                   ARRIVED
flight_leg_id            AC410-20260410-YYZYUL

sobt                     2026-04-10T11:15:00Z      was 07:15:00Z
sibt                     2026-04-10T12:35:00Z      was 08:35:00Z
scheduled_departure      07:15:00                  local, unchanged
scheduled_arrival        08:35:00                  local, unchanged
planned_block_mins       80

aobt                     2026-04-10T11:20:00Z      WAS EMPTY
atot                     2026-04-10T11:35:00Z      WAS EMPTY
aldt                     2026-04-10T12:25:00Z      WAS EMPTY
aibt                     2026-04-10T12:33:00Z      WAS EMPTY
actual_block_mins        73                        WAS EMPTY

fob_at_out_kg            4202.50                   WP-33, empty
fob_at_off_kg            4052.50                   WP-33, empty
fob_at_on_kg             2002.50                   WP-33, empty
fob_at_in_kg             1922.50                   WP-33, empty
fob_source               ACARS

flight_closure_utc       2026-04-10T12:52:00Z      WP-33, empty
closure_source           OCR
flight_start_utc         null                      semantics undecided
start_source             NONE

actual_origin            null                      no deviation
actual_destination       null                      no deviation

booked / boarded         150 / 147
cargo_kg                 1850                      was 0
captain_name             M. Tremblay
```

**YYZ and YUL are both UTC−4 on 10 April.** Every `Z` value above is four hours ahead of its local counterpart, which is the correction.

> **`cargo_kg = 0` on a scheduled passenger service is not credible**, and it matters: payload is the largest single cause of burn variance, and a zero makes a real variance unattributable.

---

## 5. `FLIGHT_DISPATCH`

```
trip_fuel_kg             2050.00      was 3674.29
contingency_fuel_kg       102.50      was  240.15   — 5% OF TRIP
alternate_fuel_kg         700.00      was  384.24   — YOW
final_reserve_kg         1150.00      was  288.18   — 30 minutes
taxi_fuel_kg              200.00      was   72.05
additional_fuel_kg          0.00      was   96.06
extra_fuel_kg               0.00      was   48.03
                         ────────
block_fuel_kg            4202.50      was 4803.00

required_uplift_kg       2305.00      WAS EMPTY
alternate_airport        YOW
rob_departure_kg         4202.50      was 6700.00
dispatch_timestamp       2026-04-10T11:00:00Z
plan_version / status    1 / ACTIVE
```

**Each component is now what it claims to be.** Contingency is 5.00% of trip. Final reserve is thirty minutes at an A320 holding burn. Nothing is a percentage of block.

**`additional` and `extra` are zero** because this scenario has no reason for either — no known delay, no tankering. **A non-zero value with no reason behind it is what produced the original 1,897 kg gap.**

---

## 6. `APU_USAGE` — two new rows

**Without these, `ground_burn_kg` is a typed number.**

```
row 1   apu_start_utc   2026-04-10T09:50:00Z
        apu_stop_utc    2026-04-10T10:20:00Z
        usage_phase     PRE_DEPARTURE
        apu_source      ACARS
        tail            C-FDMO
        →  30 min × 105 kg/h ÷ 60  =  52.50 kg

row 2   apu_start_utc   2026-04-10T12:33:00Z
        apu_stop_utc    2026-04-10T12:52:00Z
        usage_phase     POST_ARRIVAL
        apu_source      ACARS
        tail            C-FDMO
        →  19 min × 105 kg/h ÷ 60  =  33.25 kg
```

**The rate is `apu_burn_rate_kg_hr = 105` on `C-FDMO`'s register row** — WP-07 added it and this is its first consumer.

### Why 30 minutes and not 11h40

The aircraft stands at YYZ for **eleven hours and forty minutes.** The APU runs thirty of them; the rest is ground power.

> `(OUT − prev closure) × rate` would give **1,225 kg** against an actual 52.50 — **a 1,172 kg phantom burn on one turn.** That is the error the module exists to prevent, and it is why the entity holds cycles rather than a duration.

**Cycle 2 ends at flight closure**, which is what makes the ground burn divisible — decision C-4.

---

## 7. `FUEL_ORDERS`, `FUEL_TICKETS`, `FUEL_DELIVERIES`

### Order

```
order_number             FO-YYZ-20260410-001
ordered_quantity         2881.25 LTR        was 6003.75
conversion_density       0.8000 kg/L        UOM_MASTER
ordered_quantity_kg      2305.00            was 4803.00
unit_price               0.7100 CAD/L
total_amount             2045.69 CAD        was 4262.66
status                   Delivered
communicated_at          2026-04-09T18:30:00Z    WP-33, empty
communication_status     ACKNOWLEDGED
order_relationship       ORIGINAL
is_tankering             false
```

`2,881.25 × 0.8000 = 2,305.00` and `2,881.25 × 0.7100 = 2,045.69`.

### Ticket

```
ticket_number            WFS-YYZ-20260410-11
meter_start / end        100000.00 / 102884.00     was → 106008.00
quantity_metered         2884.00 LTR               was 6008.00
density_value            0.7995 kg/L  KGL  MEA
temperature              11.50 °C
quantity_kg              2305.76                   was 4803.40
vehicle_id               BW-YYZ-101                WP-33, empty
meter_serial             MTR-101-8842              WP-33, empty
match_status             MATCHED
```

`2,884.00 × 0.7995 = 2,305.758` → **2,305.76**

### Delivery

```
delivery_number          EPD-YYZ-20260410-0001
refuel_start_utc         2026-04-10T10:20:00Z      WP-33, empty
refuel_end_utc           2026-04-10T10:45:00Z      WP-33, empty
refuel_complete          true
delivered_quantity       2884.00 LTR

fob_at_arrival_kg        1950.00                   was 2150.00
fob_before_kg            1897.50                   was 1900.00
fob_after_kg             4202.50                   was 6700.00
fob_delta_kg             2305.00                   was 4800.00
ground_burn_kg             52.50                   was  250.00
fob_source               ACARS

recon_variance_kg           0.76                   was 3.40
recon_tolerance_kg         50.00                   the floor
recon_status             RECONCILED
supplier_count           1
```

**Twenty-five minutes for 2,884 litres is 115 L/min** — a normal single-bowser rate.

---

## 8. `FUEL_BURNS` and `ROB_LEDGER` — new rows

### Burn

```
flight                   AC410 / 2026-04-10
tail                     C-FDMO
block_burn_kg            2280.00      = 4202.50 − 1922.50
trip_burn_kg             2050.00      = 4052.50 − 2002.50
taxi_burn_kg              230.00      = 150 out + 80 in
apu_burn_in_block_kg       17.50      = 10 min × 105 ÷ 60
engine_burn_kg           2262.50      = block − APU
planned_burn_kg          2050.00      from trip_fuel_kg
variance_kg                 0.00
variance_status          NORMAL
data_source              ACARS
```

**`block − trip = taxi`.** 2,280 − 2,050 = 230, and 150 + 80 = 230.

### Ledger — five rows, one chain

```
seq  event               kg          closing
 1   opening             1950.00     1950.00
 2   ground burn YYZ      −52.50     1897.50
 3   uplift            +2305.00     4202.50
 4   block burn        −2280.00     1922.50
 5   ground burn YUL      −33.25     1889.25
```

**Rows 3 and 4 must agree with `fob_after_kg` and `fob_at_in_kg`.** They do, and that is the check: the ledger is not a parallel record, it is the same numbers arriving from a different direction.

---

## 9. Everything ties

```
regulated stack                     sums to  4,202.50
block − fob_before                          2,305.00  = required uplift
required uplift ÷ 0.8000                    2,881.25  = ordered litres
metered 2,884.00 × 0.7995                   2,305.76  = uplift by meter
fob_after − fob_before                      2,305.00  = uplift by gauge
variance                                        0.76  ≤ 50.00 floor
block burn − trip burn                        230.00  = taxi both ends
block burn − APU in block                   2,262.50  = engine burn
APU cycles 30 + 19 min × 105 ÷ 60      52.50 + 33.25  = ground burn
ledger row 5 closing                        1,889.25
```

**Every line derives from a line above it.** A figure that does not recompute is a figure nobody can defend.

---

## 10. Master data — two corrections

**`MASTER_CONTRACTS.AC-WFS-2025-001` — currency `USD` → `CAD`.** A Canadian supplier at a Canadian station billing a Canadian carrier. The order totals in CAD and no FX rate exists on either row, so the mismatch is not a conversion — it is an error.

**`MASTER_AIRPORTS` — confirm `YYZ`, `YUL` and `YOW` carry a timezone.** The correction in section 4 depends on UTC−4 on 10 April; if the rows do not hold `America/Toronto` and `America/Montreal`, nothing can compute local time from UTC and the two will drift apart again.

---

## 11. What is deliberately not corrected

| | |
|---|---|
| **The two densities** | The order converts at `0.8000` from `UOM_MASTER`; the ticket measures `0.7995` at 11.5 °C. **Both are right for their own basis**, and the difference is what the variance reports |
| **`SOURCE_DOCUMENTS`** | WP-31 built the entity. Seeding documents for the ticket, meter, gauge readings and tech log is a demo-data task of its own, and `closure_source = OCR` above will be unsupported until it is done |
| **`flight_start_utc`** | Left null. Its semantics are undecided — engineering release, the outbound crew signing, or `AOBT` — and WP-33 recorded that deliberately |

---

## 12. Verify after seeding

| # | |
|---|---|
| 1 | The stack sums to `block_fuel_kg`, and `contingency` is **5.00% of trip**, not of block |
| 2 | `block − fob_before = required_uplift_kg = 2,305.00` |
| 3 | `ordered_quantity × conversion_density = ordered_quantity_kg` |
| 4 | `quantity_metered × density_value = quantity_kg` |
| 5 | `fob_after − fob_before = fob_delta_kg` |
| 6 | `ground_burn_kg` **derives from the `APU_USAGE` rows**, not from a literal |
| 7 | `block_burn − trip_burn = taxi_burn` |
| 8 | The ledger's five rows chain, and rows 3 and 5 match the delivery and the flight |
| 9 | **Every `Z` timestamp is four hours ahead of its local counterpart** |
| 10 | `recon_status` is `RECONCILED` and the variance is 0.76 |

**Check 6 is the one that matters.** The others confirm arithmetic that was already right in shape. **Six confirms that a derived figure derives** — and it is the check the original seed would have failed, because nothing existed to derive from.

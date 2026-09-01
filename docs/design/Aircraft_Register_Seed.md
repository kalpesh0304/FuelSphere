# Aircraft Register — seed from the August 2026 schedule

**FuelSphere · 21 registrations, 6 types, 4 carriers**
26 August 2026

---

## 0. Where this comes from

`AirCanada_FlightSchedule_Aug2026.xlsx` — **1,825 legs, 15 rotation tails, 6 reserves**, with a full type reference and a station-to-carrier map. Synthetic, deterministic, seed `20260825`, and it asserts its own invariants: rotation continuity, ground separation, OOOI sequencing, **zero violations at generation.**

**Every figure below is taken from that workbook**, except three APU rates which are not in it and are marked as proposals.

---

## 1. Four things this data does that the current seed does not

**It carries four operating carriers.** `AC` mainline, `RV` Rouge, `QK` Jazz, `PB` PAL — with a `resolved_arrangement_id` per leg, `CAR-01` to `CAR-04`.

> **That is F40 arriving as data.** The open point asks whether carrier is a dimension; this schedule answers yes and already models the arrangement. **`FLIGHT_OPERATIONS` has a column FuelSphere has no field for.**

**It separates planned from actual registration**, with `tail_change_flag` — so a tail substitution is a fact rather than an overwrite.

**It flags provisional tails.** `provisional_tail_flag = Y` on **eight legs**, and five registrations are named as *deliberately absent from the aircraft register.*

**And it enforces rotation continuity.** Leg N+1 departs where leg N arrived. **Nothing in the current seed does that**, which is why S9's broken chain had to be constructed rather than found.

---

## 2. The type reference — from the workbook, complete

| Type | DOW kg | Seats | MZFW | MLW | MTOW | Burn kg/h | Reserve kg | Turn min |
|---|---|---|---|---|---|---|---|---|
| `A223` | 38,000 | 137 | 57,600 | 58,740 | 67,585 | 2,100 | 2,200 | 45 |
| `B38M` | 45,500 | 169 | 65,952 | 69,308 | 82,600 | 2,450 | 2,200 | 45 |
| `A321` | 49,000 | 199 | 75,600 | 79,200 | 89,000 | 2,650 | 2,400 | 50 |
| `A333` | 130,000 | 292 | 175,000 | 187,000 | 233,000 | 5,600 | 6,500 | 90 |
| `DH8D` | 17,900 | 78 | 28,009 | 28,009 | 29,257 | 800 | 900 | 30 |
| `CRJ9` | 21,845 | 76 | 34,065 | 34,065 | 38,330 | 1,400 | 900 | 30 |

**These are ICAO type designators.** `A223` is the A220-300 and `A333` the A330-300 — the current register uses the marketing names `A220` and `A330` for the same aircraft.

---

## 3. Fuel capacity and APU rate — the two the workbook does not give

### Capacity is a published type constant

```
A223   17,700 kg      B38M   20,826 kg      A321   23,700 kg
A333   87,000 kg      DH8D    5,318 kg      CRJ9    8,822 kg
```

**`A321` at 23,700 matches `C-GLTA` in the register**, which is the one cross-check available.

> **Do not derive capacity from `MTOW − MZFW`.** That is the fuel weight at maximum structural payload, not tank capacity, and it gives 9,985 kg for an A223 — wrong by a factor of nearly two.

### APU rate — three from the register, three proposed

| Type | kg/h | Source |
|---|---|---|
| `A223` | **65** | Register — `C-GROV` |
| `A321` | **110** | Register — `C-GLTA` |
| `A333` | **95** | Register — `C-GFAH` |
| `B38M` | **100** | **PROPOSED** |
| `DH8D` | **50** | **PROPOSED** |
| `CRJ9` | **55** | **PROPOSED** |

**The three proposals need a decision, not a derivation.** The register's existing rates do not scale with size — an A220 at 65, an A320 at 105, an A330 at 95 — so **there is no rule to extrapolate from.** They are whatever was seeded.

> **This matters more than it looks.** Every ground burn in every scenario derives from a per-tail rate, and the previous specification specified rates the register does not hold. **A proposed figure is better than a wrong one only if it is marked.**

---

## 4. The twenty-one registrations

### Rotation — fifteen

| Tail | Type | Carrier | Base | Legs |
|---|---|---|---|---|
| `C-GROV` | A223 | AC | YYZ | 187 |
| `C-FITU` | A223 | AC | YUL | 186 |
| `C-FJJZ` | CRJ9 | **QK** | YYC | 186 |
| `C-GGOF` | DH8D | **QK** | YVR | 186 |
| `C-GHPQ` | DH8D | **PB** | YHZ | 186 |
| `C-GNBN` | A223 | AC | YYZ | 126 |
| `C-FSJH` | B38M | AC | YYZ | 126 |
| `C-FSNQ` | B38M | AC | YVR | 124 |
| `C-GFAH` | A223 | AC | YWG | 124 |
| `C-GGNY` | DH8D | **QK** | YYZ | 124 |
| `C-GHKR` | A333 | AC | YYZ | 64 |
| `C-GJWO` | A321 | AC | YYZ | 62 |
| `C-GITY` | A321 | AC | YUL | 54 |
| `C-GHPX` | A321 | **RV** | YYZ | 47 |
| `C-GJVX` | A223 | AC | YUL | 43 |

**Each tail flies for exactly one carrier**, so the assignment is unambiguous — which makes this the cleanest possible first case for F40.

### Reserve — six

```
C-GJXE  A223  AC  YYZ        C-FSDB  B38M  AC  YVR
C-GJZR  CRJ9  QK  YYC        C-GJWD  A223  AC  YUL
C-GKQA  DH8D  PB  YHZ        C-GKQB  A223  AC  YWG
```

**Substitution only, no daily rotation.** `record_status = CONFIRMED` — a reserve is a known aircraft that is not scheduled, which is different from provisional.

---

## 5. Five registrations that must NOT be seeded

```
C-GXQZ    C-FXTM    C-GKRW    C-FVBN    C-GTLP
```

**And three of them fly.**

| | Legs | Substituting for |
|---|---|---|
| `C-GXQZ` | 2, on 2 Aug | `C-GHKR` |
| `C-FXTM` | 4, on 13 Aug | `C-FSJH` |
| `C-GKRW` | 2, on 13 Aug | `C-GHKR` |
| `C-FVBN` | none | — |
| `C-GTLP` | none | — |

> **This is the unresolved-tail case, eight times over and generated deliberately.** A registration arrives on the ops feed, the register has never seen it, and `tail_registration` resolves to null while `aircraft_reg` holds the mark.

**And two of the five never fly**, which is the other half: a mark that exists in nobody's data at all.

**Seeding any of the five would delete the test the workbook built.**

---

## 6. The conflict with the current register

**Four registrations exist in both, as different aircraft.**

| Mark | Current seed | Workbook |
|---|---|---|
| `C-FITU` | **B777** | **A223** |
| `C-GFAH` | **A330** | **A223** |
| `C-GHPQ` | **B787** | **DH8D** |
| `C-GHPX` | **B787** | **A321** |
| `C-GROV` | A220 | A223 — **the same aircraft, two names** |

**Same mark, different type, different performance, different APU rate.** A scenario built on `C-FITU` as a B777 and a flight schedule flying it as an A220 cannot both be right.

### Three ways, and it is a decision

**Replace the register from the workbook.** Coherent, and it **breaks every seeded scenario** — S1, S2, S3, S5, S6 and S9 all name tails the workbook does not have.

**Keep both, renaming the four conflicts.** The workbook's marks change, the scenarios survive, and the schedule stops matching the file it came from.

**Add only what does not conflict.** Eleven rotation tails and six reserves land; the four are left as they are, and the schedule cannot be loaded for those tails.

> **The first is right if this schedule replaces the demo data. The third is right if it supplements it.** That is a scope question rather than a data one, and it should be answered before anything is written.

---

## 7. What to seed, per registration

```
registration            the mark
aircraft_type_code      A223 · B38M · A321 · A333 · DH8D · CRJ9
dow_kg                  from the type table
fuel_capacity_kg        from section 3
apu_burn_rate_kg_hr     from section 3 — and mark the three proposals
performance_factor      100.0 baseline; vary per tail if the demo needs it
record_status           CONFIRMED
home_base               from section 4
on_own_aoc              see below
```

**`on_own_aoc` has zero readers**, so whatever it holds changes nothing. **Set it `true` and do not build a story on it** — `record_status` is what has code behind it, and the carrier question belongs to F40 rather than to a boolean.

---

## 8. What this unlocks, and what it exposes

**Unlocks:** rotation continuity, so a ledger chain can be built from real sequencing rather than constructed. **1,825 legs across 31 days**, with tail substitutions, diversions, cancellations and eight provisional-tail cases already in it.

**Exposes:** FuelSphere has **no field for `resolved_arrangement_id`**, no carrier entity, and no tail-to-carrier assignment. **The schedule carries a fact the model cannot hold.**

> That is F40, and this workbook turns it from a design question into a loading problem. **The 1,825 legs cannot be loaded faithfully until there is somewhere to put the carrier.**

**And one finding the workbook states about itself:** a diversion continuation flies the same number on the same date, so it **collides on the documented business unique key** unless `route_sequence` joins the key. The generator worked around it by taking the next `leg_sequence`, **which overloads a field that already means something else.** Its own note says: *worth a decision before this data is loaded.*

# Demo Scenarios — the specification, rebuilt from the seed

**FuelSphere · supersedes the 24 August version entirely**
26 August 2026

---

## 0. Why this exists, and what changed about it

**The previous version was wrong in at least six places**, and every figure in it was computed before S1, S2 and S3 came down to realistic sectors. It said S4 was already seeded; it named a supplier that does not exist; it specified APU rates the register does not hold; and it carried a rounding error.

**All of them have one cause.** I computed figures for a deck, then quoted them back as though they were what the system held. **Three times, on three scenarios.**

### So this version is built the other way round

| Where a scenario is **seeded** | The figures come from the database. **They are a record** |
| Where a scenario is **not** | **No figures.** Only the shape, the constraints, and what must be true |

**Derive, do not transcribe.** `C-GLTA`'s performance was derived from the register and was right; every figure I supplied for the same scenario was wrong. **That is measured rather than asserted.**

---

## 1. Two rules that govern every number

### Rounding is `ROUND_HALF_UP`, two decimals

**Python's `round()` and `Decimal`'s default are banker's rounding**, and the seed uses `ROUND_HALF_UP` throughout.

```
750 × 0.7995 = 599.6250    HALF_UP 599.63    banker's 599.62
```

**Of eight volumes tested, only that one differs** — so it is one wrong figure with a systematic cause. **Any figure recomputed with a default-rounding tool drifts silently on exactly these boundary cases.**

### The APU rate comes from the register, per tail

**Not per type, and not from this document.** Measured 26 August:

| Type | Registration | kg/h |
|---|---|---|
| A320 | `C-FDMO`, `C-FDMP` | **105** |
| A320 | `RP-C8805`, `RP-C8888` | **70** |
| A321 | `C-GLTA` | **110** |
| A350 | `C-GDMS` | **135** |
| A350 | `RP-C8801`, `RP-C8802` | 105 |
| A220 | `C-GROV` | 65 |
| A330 | `C-GFAH` | 95 |
| B777 | `C-FITU` | 110 |
| B787 | `C-GHPQ`, `C-GHPX` | 92 |

> **The A320s are not uniform** — 105 on the Canadian tails, 70 on the Philippine ones. **Any figure quoting "the A320 rate" is already ambiguous**, and the previous version did exactly that.

**`RP-C8803` and `RP-C8804` carry no rate at all**, along with no type and no performance data. **Nothing needing a rate can use them.**

---

## 2. What is seeded — a record, not a specification

| | Flight | Date | Tail | Sector | Demonstrates |
|---|---|---|---|---|---|
| **S1** | `AC410` | 10 Apr | `C-FDMO` A320 | YYZ→YUL | The clean uplift. **Floor governs** |
| **S2** | `AC856` | 10 Apr | `C-GDMS` A350 | YYZ→LHR | Two bowsers, one gauge pair. **Percentage governs** |
| **S3** | `AC412` | 10 Apr | `C-FDMP` A320 | YYZ→YUL | The variance. Same meter as S1, gauge differs |
| **S5** | at YUL | 10 Apr | `C-FDMO` | — | Fuel with no order. `UNMATCHED` · `NOT_ATTRIBUTABLE` |
| **S6** | `AC418` | 10 Apr | `C-GLTA` A321 | YYZ→YVR | Plan allowed, **order refused.** `MDM402` |
| **S9** | `AC411` | 10 Apr | `C-FDMO` | YUL→YYZ | The broken chain. **No ledger row**, `FB402` |
| **unresolved tail** | `AC414` | 10 Apr | `C-GXLW` A321 | YYZ→YUL | A registration the register **has never seen** |

**`SCENARIO-FIGURES.md` is the authority for every number.** It regenerates, and it prints the derivation beside each figure.

### The pair that carries the argument

```
S3   120.76 on  2,305.76   floor 50.00      VARIANCE
S2    75.23 on 42,025.23   0.5% = 210.13    RECONCILED
```

**The same 120.76 on S2 is 0.29% and would pass.** One number, two verdicts, identical rule.

### And the pair that proves itself

```
S9 with S5's uplift    1,889.25 + 999.38 − 2,280.00 =   608.63   positive
S9 as seeded           1,889.25 +   0.00 − 2,280.00 = −390.75   NEGATIVE
```

**The missing uplift IS the break**, proved by the same arithmetic. **Neither scenario demonstrates it alone.**

---

## 3. What remains — four scenarios, and no figures

**Each states what must be demonstrated and what constrains it. Derive the rest from the register and the sector.**

---

### S4 · The under-delivery

**The mirror of S3.** The measurements agree; the supplier brought less than was ordered.

| | |
|---|---|
| **Demonstrates** | A commercial finding **no measurement check could catch** |
| **Error** | `EPD401` — delivered below tolerance against ordered |
| **Must be true** | Meter and gauge agree well inside the floor. **`recon_status = RECONCILED`**, and the fulfilment check fires anyway |

**The tail is unresolved.** The previous version said `C-FDMQ`; **that registration does not exist and has no flights.** Pick from the register — `C-GROV` is a Canadian A220 with a rate and no scenarios on it.

**The departure consequence is the sharpest half.** An under-delivery means the aircraft leaves **below its planned block fuel.** Compute the shortfall and surface it — that is what the check protects, and it is not a commercial abstraction.

---

### S7 · No gauge reading

**A station with no ACARS and no crew entry.** The meter is all there is.

| | |
|---|---|
| **Demonstrates** | **Unknown is not agreement** |
| **Must be true** | `fob_before_kg` and `fob_after_kg` **null**. `fob_source = NONE` |
| | **`recon_variance_kg` NULL, not zero.** Zero says *measured, and it was nothing* |
| | `recon_status = NOT_RECONCILED`, **and it must not render as a pass** |

> **Do not copy `fob_at_arrival_kg` into `fob_before_kg`** to make the row look complete. That manufactures a zero ground burn where the truth is unknown.

**Any tail with a contract at the station. No new master data.**

---

### S8 · Two suppliers, one gauge pair

**One aircraft, one FQIS reading, two commercial relationships.**

| | |
|---|---|
| **Demonstrates** | **A variance can be real, small, and belong to nobody** |
| **Must be true** | Two tickets, one delivery, one gauge pair. `supplier_count = 2` |
| | The variance is **computed and recorded**, and `recon_status = NOT_ATTRIBUTABLE` |
| | **Well inside tolerance, and it still will not attribute** |

**Pro-rata allocation by volume is arithmetically neat and evidentially worthless.** Do not implement it, and do not seed a row implying it.

#### The master data question is open

**The previous version named Shell Aviation and `AC-SHELL-2025-001`. Neither exists.**

**Ten suppliers are seeded and only World Fuel Services is used at YYZ.** So one of three, and it is a decision rather than a lookup:

```
a second supplier's contract added at YYZ
the scenario moved to a station that already has two
a new supplier and contract seeded
```

**Survey which suppliers hold contracts where, and propose.** A second contract at one station is a small addition; a second supplier is larger — **and the case may already exist somewhere.**

---

### S10 · The ground gap

**A turn where fuel leaves the tanks with no engine running.**

| | |
|---|---|
| **Demonstrates** | The split at **flight closure**, and a derived uplift |
| **Blocked by** | **D42.** `applyBurnSplit` resolves by phase; the split must be at closure |
| **Must be true** | A cycle **spanning** closure contributes only its overlap |
| | `fob_source = ACARS_DERIVED` — the record says **derived** |
| | **Without the APU adjustment the delivery flags for no reason.** Show both |

#### And it may already exist

**`C-FDMO` turns at YUL on 10 April** — `AC410` arrives 12:33 and closes 12:52, and `AC411` departs after. **That is a ground gap with a closure timestamp already in the data.**

> **Check before seeding.** The convention says look for the case before creating it, and it has been right twice. **If the turn already carries what S10 needs, the work is annotation rather than data** — though S9's broken chain sits on `AC411`, so overlaying may confuse both.

**The previous version's 137.5 / 91.7 / 229.2 is the 110 kg/h column**, and **no Canadian A320 holds that rate.** Every S10 figure derives from the rate of whichever tail it lands on.

---

## 4. What the previous version got wrong

Stated so it is not repeated, and because most of it was mine.

| | |
|---|---|
| **"S1 to S4 are already seeded"** | **S4 was not**, and `C-FDMQ` does not exist. **False when written** |
| **APU rates 110 / 260** | The register holds **105 / 135**. Every S10 figure derived from a rate that is not there |
| **`750 × 0.7995 = 599.62`** | Banker's rounding. **`599.63`** |
| **Shell Aviation, `AC-SHELL-2025-001`** | Neither exists |
| **`C-GXLW` in the register as `PROVISIONAL`** | It is deliberately **not** in the register — the unresolved-tail case needs a mark nothing has seen. **S6 is `C-GLTA`** |
| **S5 and S9 at 26 March** | Both are **10 April**, so the walkthrough reaches them |
| **`PR501`** | **Retired.** Two *order refused* scenarios left a viewer asking which was the point |

---

## 5. Verification

| # | |
|---|---|
| 1 | Every mass recomputes as volume × density, **`ROUND_HALF_UP`, two decimals** |
| 2 | Every gauge uplift recomputes as `fob_after − fob_before` |
| 3 | The regulated stack **sums to** `block_fuel_kg`, and contingency is **5% of TRIP** |
| 4 | `block − fob_before = required_uplift_kg` |
| 5 | **Every APU burn derives from `APU_USAGE` cycles at that tail's register rate** |
| 6 | S7's variance is **NULL, not 0** |
| 7 | S8's `supplier_count = 2`, and the variance is **not attributed** |
| 8 | S10's cycle spanning closure contributes **only its overlap** |
| 9 | Every figure in `SCENARIO-FIGURES.md` reproduces. **Zero mismatches** |

**Check 5 is the one the previous version would have failed.** It specified rates the register does not hold, so nothing could have derived from them.

---

## 6. One instruction for whoever builds these

**Do not take a figure from this document where a scenario is unseeded.** There are none, deliberately.

**Derive from the register, the sector and section 1**, then report what you derived before building the rest.

**That is what worked for `C-GLTA`, and what failed three times before it.**

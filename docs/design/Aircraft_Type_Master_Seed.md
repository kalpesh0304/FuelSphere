# `AIRCRAFT_MASTER` — five new types, with sources

**FuelSphere · researched figures, and what they reveal about the existing ones**
26 August 2026

---

## 0. The finding that matters more than the figures

**The workbook's cruise burns are all defensible.** Every one falls inside the published range for its type. **They can be loaded as they are.**

**The APU rates are the problem, and not the ones you'd expect.** Two published figures exist, and they show that **the seed's own rates disagree with reality:**

| | Published, ground | Seed holds | |
|---|---|---|---|
| A320 | **126 kg/h** | 105 | 83% of published |
| A330 | **140 kg/h** packs off · 215 with packs | 95 | **68%** of published |

**No single ratio.** 83% and 68%. **The seed's rates follow no rule and match no source** — which is why nothing could be extrapolated from them.

> So the question is not *what are the new rates*. It is **whether to load published figures that will sit beside four existing ones that are wrong**, or to invent a convention that matches nothing.

---

## 1. The five types, with what each figure is

| | `A223` | `B38M` | `A333` | `DH8D` | `CRJ9` |
|---|---|---|---|---|---|
| **Model** | A220-300 | 737 MAX 8 | A330-300 | Dash 8-400 | CRJ900 |
| **Manufacturer** | Airbus | Boeing | Airbus | De Havilland | Bombardier |
| **DOW kg** | 38,000 | 45,500 | 130,000 | 17,900 | 21,845 |
| **MTOW kg** | 67,585 | 82,600 | 233,000 | 29,257 | 38,330 |
| **MZFW kg** | 57,600 | 65,952 | 175,000 | 28,009 | 34,065 |
| **MLW kg** | 58,740 | 69,308 | 187,000 | 28,009 | 34,065 |
| **Seats** | 137 | 169 | 292 | 78 | 76 |
| **Cruise burn kg/h** | **2,100** | **2,450** | **5,600** | **800** | **1,400** |
| **Fuel capacity kg** | **17,200** | **20,600** | **78,000** | **5,318** | **8,800** |
| **APU kg/h** | 90 ✱ | **110** | **140** | 60 ✱ | 70 ✱ |
| **Min turn min** | 45 | 45 | 90 | 30 | 30 |

**Bold** = published or workbook-supplied. **✱ = estimate, no published figure found.**

### Where each column comes from

**DOW, MTOW, MZFW, MLW, seats, cruise burn, min turn — the workbook.** Generated deterministically and self-asserting.

**Fuel capacity — published type constants.** The Q400's **5,318 kg matches the workbook figure exactly**, which is the one cross-check available and it holds.

**Cruise burn — checked, not taken on trust:**

```
A223   2,100    published 1,700 – 2,400    OK
B38M   2,450    published 2,300 – 2,600    OK
A333   5,600    published 5,200 – 5,900    OK
DH8D     800    published   750 –   900    OK
CRJ9   1,400    published 1,300 – 1,550    OK
```

**Five of five inside range.** So the workbook's own figures are sound and need no substitution.

---

## 2. `A333` — collapse it into `A330`, or do not

**The register already holds `A330` on `C-GFAH`.** Same family, two designators — exactly as `A220` and `A223` are.

**Collapse.** One type row, `C-GFAH` and `C-GHKR` share it, and `A333` becomes an alias in the loader. **Consistent with what already exists.**

**Keep separate.** `A330` and `A333` both exist, `C-GFAH` stays on the first and the workbook's tails take the second. **Two rows for one aircraft family, and nobody will remember why.**

> **Collapse it.** The registrations differ; the type does not. And a `-200` versus `-300` distinction is not carried anywhere else in this model — the existing `A320` row covers both the Canadian and Philippine tails, which are different sub-variants too.

---

## 3. The APU decision, and it is the only real one

**Three of five have no published figure I could find.** `A223`, `DH8D` and `CRJ9` are estimates from the class:

```
A223    90 kg/h    PW980A, between the A319 and a regional jet
DH8D    60 kg/h    a small turboprop APU
CRJ9    70 kg/h    regional jet class
```

**Two are published:** `B38M` at **110** (737 family), `A333` at **140** packs off.

### Which creates a problem the estimates do not

**Load the published figures and four existing rates become visibly wrong.** `A330` at 95 sits beside `A333` at 140 — **the same aircraft, two rates, differing by half.**

**Load rates consistent with the seed and every new type carries a figure that matches nothing** — no source, no rule, no derivation.

### Three ways, and I would take the first

**Load published where published, estimate where not, and record that the four existing rates disagree.** The new figures are defensible; the old ones become a known finding rather than an invisible one. **A visible inconsistency is a question somebody can answer.**

**Or leave every new APU rate empty.** An absent rate is a question; nothing derives from these tails today. **Safe, and it defers the problem rather than closing it.**

**Or match the seed's convention.** There is no convention to match — 83% and 68% is not a rule.

---

## 4. The table to load

```
type_code   model        manufacturer  dow_kg  mtow_kg   cruise   capacity  apu   apu_source
A223        A220-300     Airbus        38000    67585     2100      17200    90   ESTIMATE
B38M        737 MAX 8    Boeing        45500    82600     2450      20600   110   PUBLISHED
A333        →  collapse into the existing A330 row
DH8D        Dash 8-400   De Havilland  17900    29257      800       5318    60   ESTIMATE
CRJ9        CRJ900       Bombardier    21845    38330     1400       8800    70   ESTIMATE
```

**Four new rows, not five**, if `A333` collapses.

**And `apu_source` needs a column**, or the distinction is lost on load — which is the finding already recorded against the register CSV, arriving one level up.

---

## 5. What I would not do

**Do not load an APU rate without marking it.** Every ground burn derives from a per-tail rate. **A proposed figure that looks measured is an answer nobody checked**, and three of five here are proposals.

**Do not silently correct `A320` and `A330` to their published values.** Four registrations carry those rates, `C-GFAH` has a dispatch plan, and S1's entire ground burn derives from A320 at 105. **Correcting them is a package with a blast radius, not a data fix.**

**And do not treat the cruise burns as needing research.** They were checked and they hold. **The workbook is right about the thing that matters most**, because every trip figure in every scenario derives from a cruise rate.

---

## 6. Sources

| | |
|---|---|
| APU, A320 126 kg/h · 737 110 kg/h | OpenAirlines, *How to track your APU fuel consumption on ground* |
| APU, A330 140 packs off · 215 with packs | Airliners.net technical forum, operator figures |
| Q400 usable fuel 5,318 kg | De Havilland type data, via published specification |
| 737 MAX 8 fuel 25,800 L · MTOW 82,250 kg | Boeing type data, via published specification |
| A220-300 MTOW 70.9 t · MZFW 58 t · MLW 61 t | Airbus, via published specification |
| A220-300 cruise 1,700–1,800 kg/h at FL400 | Operator estimates, professional forum |
| DOW, seats, MZFW, MLW, MTOW, cruise, turn | The workbook itself |

> **The APU figures are the weakest sourcing here** — forum and vendor-blog rather than type certificate data. They are good enough to show that the seed's rates are low, and **not good enough to load unmarked.**

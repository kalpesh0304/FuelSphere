# Defuel — Phase 0 discovery (revision 2)

**Status:** report only. No schema, no handler, no annotation, no seed row written.

**Revised 23 Oct 2026** against `Defuel — Business Requirements` (D1–D13, O9–O16) and
`CC Prompt — Defuel Functionality`. Measured against `main` at `80227a1`.

**Not supplied:** `FuelSphere_UI_Design_Standard.md` is not attached and not in the
repository. The reference to its §2 is dropped from the app work package, as instructed.

---

## 0. Stop and raise — the prompt's central premise is measurably wrong

Prompt §3.1 and §3.1a, and the BR section *"The layers exist — outside this repository"*,
both rest on one claim. **It is false, and I can prove it in four lines.**

### 0.1 What the prompt claims

> §3.1: *"`FIFO`, `stock_layer`, `unit_cost`, `BLOCK_BURN`, `APU_BURN`, `line_type`,
> `stock_movement`, `stock_balance`, `burn_valuation`, `valuation_method` and a fuel
> `batch` all return **zero occurrences** across `db/`, `srv/` and `app/`."*

> §3.1a: *"**`Fuel Stock Valuation` is a running application** … **So do not build FIFO.
> Do not design a layer model.** … It exists and the burn side already runs on it … your
> job is to establish the integration — BR **O9** and **O10**."*

### 0.2 What is measurably there

`db/fifo-valuation.cds` exists in this repository and defines the whole model.

Swept token by token across `db/`, `srv/` and `app/`. **Six of the eleven are present;
five are genuinely zero.**

| Prompt's token | Files | Where |
|---|---|---|
| `FIFO` | **4** | `db/fifo-valuation.cds`, `srv/valuation-service.cds`, `srv/valuation-fiori-annotations.cds`, `srv/authorization.cds` |
| `APU_BURN` | **8** | incl. `db/fifo-valuation.cds:64` |
| `line_type` | **7** | `db/fifo-valuation.cds:60` et seq. |
| `BLOCK_BURN` | **4** | `db/fifo-valuation.cds:63` |
| `valuation_method` | **4** | `db/fifo-valuation.cds:42` — `ValuationMethod : FIFO \| MAP` |
| `batch_ref` | **2** | the movement ledger and the balance table |
| `stock_layer` | 0 | — |
| `unit_cost` | 0 | — |
| `stock_movement` | 0 | — |
| `stock_balance` | 0 | — |
| `burn_valuation` | 0 | — |

**The five zeros are a naming artefact, not an absence.** This repository names entities in
UPPER_SNAKE, so the concepts exist as `FUEL_STOCK_MOVEMENT_LEDGER` (`:82`),
`FUEL_STOCK_BALANCE` (`:171`) and `FUEL_BURN_HEADER` (`:240`) — a lowercase
`stock_movement` grep finds none of them. `stock_layer` and `unit_cost` describe
`FUEL_STOCK_BALANCE` and `rate_usd_per_kg` under different names.

**So the token sweep alone does not settle it, in either direction — and that is worth
saying plainly, because a sweep is how the opposite conclusion was reached.** What settles
it is §0.3: the service path, the deployed app's manifest, and the enum members, all quoted
directly.

### 0.3 The tile is served by this repository

The three tabs observed on screen — *Stock Movements, Stock Balances, **Burn Valuations***
— are the three entities on `ValuationService`, in that order:

> `srv/valuation-service.cds:16` — `@path: '/odata/v4/valuation'`
> `:25` `entity StockMovements as projection on db.FUEL_STOCK_MOVEMENT_LEDGER;`
> `:32` `entity StockBalances as projection on db.FUEL_STOCK_BALANCE;`
> `:39` `entity BurnValuations as projection on db.FUEL_BURN_HEADER;`

And the deployed app calls exactly that path:

> `../fuelvaluation/webapp/manifest.json:27` — `"uri": "/odata/v4/valuation/"`
> views keyed `movements`, `balances`, `burns`; `contextPath: "/StockMovements"`

**`Fuel Stock Valuation` is not a separate backend. It is this CAP service, and the app
is the sibling `fuelvaluation` folder in this estate.**

### 0.4 What this does to O9 and O10

**O9 — which direction does the integration run?** There is no integration. The valuation
tables are local CDS entities in `db/`, written and read in this process. The question
"does FuelSphere push or does the service read our ledger" has no referent. **O9 is
answered by measurement, not by a decision, and nobody needs to be asked.**

**O10 — what line type does a defuel take?** Already modelled:

> `db/fifo-valuation.cds:67` — `Defuel = 'DEFUEL';  // Fuel off the aircraft. Opens a batch under FIFO`
> `:65` — `Transfer = 'TRANSFER';  // Between tails. Out of one, in to the other`

**Both line types the BR asks for already exist in the enum.** The screen shows only four
because only four occur in the seeded data, not because the vocabulary is limited to four.
What remains of O10 is confirming `DEFUEL` and `TRANSFER` carry the intended semantics —
a one-line confirmation, not a cross-team negotiation.

### 0.5 And the correction that cuts the other way

This is the half that makes the feature **larger**, not smaller, and it is the most
consequential sentence in this report.

> BR: *"every uplift creates a layer and every burn consumes layers oldest-first — and
> that is **running today** in the `Fuel Stock Valuation` service … **Most of that work is
> not defuel, and most of it is already done.**"*

**It is not running. Nothing maintains those layers.**

- The only writer of `FUEL_STOCK_MOVEMENT_LEDGER` or `FUEL_STOCK_BALANCE` anywhere is
  **`tools/seed-fifo-valuation.js`**, an offline script run by hand.
- `srv/` contains exactly **one** reference to either table, and it is a read:
  `srv/reconciliation-service.js:9`.
- No uplift handler, no burn handler and no adjustment handler writes a layer.

So the screen showing *"one block burn appearing as two `BLOCK_BURN` rows against two
different batches"* is **correct FIFO arithmetic computed once, offline, over seeded
history**. It is a faithful snapshot of what FIFO would look like. It is not a maintained
ledger, and it will not move when the next uplift lands.

**R3.2a requires that layers be maintained continuously by every movement** — and the BR
rules out compute-on-demand explicitly on that basis. That requirement is therefore
**not mostly done**. It is the programme, and almost none of it is defuel:

| Work | Status |
|---|---|
| Layer model | **Exists** (`FUEL_STOCK_BALANCE`) |
| FIFO consumption arithmetic | **Exists**, in a tool |
| Uplift maintains layers live | **Does not exist** |
| Burn consumes layers live | **Does not exist** |
| Adjustment maintains layers live | **Does not exist** |
| Defuel line type | **Exists in the enum**, no path |

### 0.6 Why I stopped rather than building

Prompt §6: *stop and raise when source contradicts the BR or this prompt*, and
*do not infer the contract from the screen*.

Building to §3.1a as written would mean **constructing an integration to a remote service
that does not exist**, against a contract nobody can supply, for layers that are not being
maintained. That is a substantial amount of work aimed at nothing.

**The sequence you actually want is different**, and §4.4 of the prompt already names it:
*"whether defuel can be built and demonstrated on a MAP carrier while the FIFO integration
is agreed."* My answer to that is **yes, and more cheaply than you think** — see §3.

---

## 1. §3 re-measurement, revision 2

Revision 1 of this report measured §3 of the previous prompt. The new prompt repeats most
of it unchanged, so those findings stand:

| Claim | Verdict |
|---|---|
| `db/schema.cds` line references | **Stale by +76** (`ROB_LEDGER` is `:3728`, not `:3652`); content correct |
| `ROBEntryType` five members | **Six** — `APU_BURN` omitted from the list (`:3586–3604`). No `DEFUEL`: correct |
| *"79 enum-typed elements, 0 enforced"* | **47 `@assert.range` in `db/`.** The warning stands; the figure does not |
| *"zero `@assert.unique` in `db/`"* | **One**, `db/supplier-contacts.cds` |
| No scheduler | **Confirmed** |
| No storage-location concept | **Confirmed** — zero occurrences |
| `0.8` density fallback | **Confirmed** — `srv/lib/rob-litres.js:19` |
| `parameter-store` resolves date, priority, specificity | **Confirmed, and it returns the evidence row** (`:107–108`) — exactly R9.5 |
| WP-23 posting determination | **Planned, not built** (`04-WORK-PACKAGES.md:555`). `posting_key`: zero occurrences |
| `mta.yaml` deploys no HTML5 app | **Confirmed** (D35 holds) |

**Newly wrong in this revision:**

| Claim | Verdict |
|---|---|
| §3.1/§3.1a — FIFO is elsewhere | **False** (§0) |
| §3.3 — *"Nothing posts to S/4"* | **False since 21 Oct.** `mta.yaml:75` `FS_S4_POSTING_MODE: live`; a real PO exists in S2A; every attempt records its exact request payload in `S4_POSTING_ATTEMPTS` |
| §3.6 — *"seven `ROB_LEDGER` queries"* | **2 references, 6 orderings.** Hazard real, count wrong |
| §3.8 — *"five services project `FLIGHT_SCHEDULE`"* | **Eight.** `PlanningService` is among them, so the instruction stands |

**§3.6 and §3.6a confirmed exactly as written**, and they are the sharpest thing in the
prompt:

- display queries order `record_date, record_time, sequence` and **never consult
  `flight_aobt`** — `burn-service.js:811,818,824,916`
- the rebuild sorts differently — `rob-recalculate.js:163`
- `recalculateROB` counts what it rewrote and returns it as corrected —
  `burn-service.js:844,877,900,906`

**§3.6b confirmed:** `MASTER_AIRPORTS.timezone` exists and no master-data work is needed.

---

## 2. What O9 to O16 now need from you

| # | Status after measurement |
| --- | --- |
| **O9** | **Answered by evidence** (§0.4). No integration exists or is needed. Please confirm you accept the measurement |
| **O10** | **Largely answered** (§0.4). `DEFUEL` and `TRANSFER` already in `ValuationLineType`. Confirm semantics |
| **O11** | **Still yours.** Is the carrier's method effective-dated? Nothing exists either way |
| **O12** | **Still yours.** `parameter-store.js:282–283` names *"tail → carrier assignment"* in a comment only. The scoping axis exists; the assignment rule does not |
| **O13** | **Still yours, and now harder** — see §4 |
| **O14** | **Still yours.** Approval: switch or value band |
| **O15** | **Still yours.** Partial settlement and the accrual remainder |
| **O16** | **Scoping.** My estimate is in §5 |

**Only O11 to O16 remain, and none of them blocks the first three work packages.**

---

## 3. Yes — defuel can be built and demonstrated now

**On a MAP carrier, with no FIFO work at all**, and this is the sequence I recommend.

`ROB_LEDGER` is live, maintained and carries `map_usd_per_kg` per row. **D1b's "MAP as at
the preceding ledger entry" is readable today** without touching the valuation tables. So:

- **M1** (referenced defuel, uplift's own price) — needs no valuation basis at all. The
  price comes from the named uplift (D1a). **Buildable now.**
- **M2 on a MAP carrier** — reads the preceding row's `map_usd_per_kg`. **Buildable now.**
- **M3/M4/M5, locations, settlement, fees, reversal, accrual, reports** — all independent
  of valuation basis. **Buildable now.**
- **M2 on a FIFO carrier** — blocked, and only this one is.

That is R1, R2, R4, R5, R6, R7, R8, R9 and R10 buildable, with one branch of R3 deferred
behind a decision that is no longer a cross-team question.

**The basis column (R3.6) is what makes the sequence safe.** Every valued row records which
basis produced it from the first commit, so rows written under MAP stay interpretable when
FIFO arrives. Without that column this sequencing would be storing up exactly the defect
R3.6 exists to prevent.

---

## 4. O13 is now a two-system question, and the systems disagree today

The BR says the ledger's within-timestamp order is *"0 opening, 1 uplift, 2 burn,
3 adjustment"* — four values. **Measured, it is five:**

> `db/schema.cds:3847` — `// 0 opening, 1 uplift, 2 block burn, 3 APU burn, 4 adjustment`

And `FUEL_STOCK_MOVEMENT_LEDGER` carries its **own** `line_order` (`db/fifo-valuation.cds`),
so there are already two orderings that must agree and nothing asserts they do.

**Three things need to be true and none is today:**

1. A defuel has a slot in `ROB_LEDGER.line_order`
2. It has the **same relative slot** in the valuation ledger's `line_order`
3. Something asserts the two agree

**I will not choose the position.** But note the decision is sharper than the BR states:
under FIFO it selects which batch is consumed, and since the valuation ledger is currently
rebuilt offline from `ROB_LEDGER`, a disagreement would be invisible until a reconciliation
ran.

---

## 5. O16 — what the other two month-end options would cost

Answered as a scoping question, not folded into the accrual.

| Option | Cost | Why |
|---|---|---|
| **Accrue unposted credits/write-offs** | **In scope.** ~1 WP | Population is the `DEFUEL` location contents (R8.7); no scheduler needed (D7a) |
| **Defer unconsumed fuel** | **~1.5–2 WP, and it is not defuel** | Needs a period-end fuel-on-board position for *every* tail, a deferral entity, and reversal. Touches tails never defuelled |
| **Physical inventory adjustment to S/4** | **~2–3 WP, plus S/4 interface work** | Needs a counted-vs-recorded comparison per tail, an adjustment document, and a **new S/4 posting interface**. Posting is live now (§1), so this is buildable — but it is a second feature |

**Recommendation for your decision:** build the application with option one, and declare
the other two **visible and inactive**. They share a screen and a calendar, not a subject.

---

## 6. Revised work packages

One per branch, `claude/defuel-<wp>`, never `main`. Schema separate from behaviour;
annotations separate again.

| WP | Scope | Entry | Exit criteria |
|---|---|---|---|
| **WP-D1** | `DFL` prefix into `CLAUDE.md` §8 (**`DFL` is free**; 16 prefixes / 176 codes measured, not 18/192); `DEFUEL` into `ROBEntryType`; `@assert.range` on every defuel enum | — | Enums enforced, not merely declared; `d39-status-fixture` passes |
| **WP-D2** | Defuel schema: event, locations, settlement, expected credit, reversal, **basis column**, **local/zone/UTC triple** (R3.9–R3.10), defuel `line_order` slot | WP-D1, **O13** | Compiles to HANA; `@assert.unique` on `transfer_reference` and on `(tail, sequence)`; no GL account anywhere |
| **WP-D3** | Location ledger and events — R2.3, R2.6, R4.6 | WP-D2 | Location balance never negative; reconciles to its own movements |
| **WP-D4** | M3, M4, M5 | WP-D3 | R4.4 atomicity proved by **forcing a failure in the second half**; uplift out of `DEFUEL` refused with `DFL4xx` |
| **WP-D5** | M1, and **M2 on a MAP carrier**; park | WP-D4 | R1.5 cumulative, **M1 only** (BR confirms it binds M1 by construction); basis recorded on every row |
| **WP-D6** | Settlement S1–S3, **partial settlement (D5a)**, approval gate (D11), tolerance | WP-D5, **O14** | Credit > held value refused quoting both; tolerance cites its `parameter-store` row; both approval states proved |
| **WP-D7** | Reversal and correction (D6a, R1.9) | WP-D5 | Original date/time kept, not the correction's; reversed defuel marked, not deleted; cannot re-reverse |
| **WP-D8** | Month-end accrual + the R8.6 control report | WP-D6, **O15** | No unsettled item at close without an accrual; both legs accrued and both reverse |
| **WP-D9** | **FIFO layer maintenance — uplift, burn, adjustment, defuel** | **O11**, and a decision to proceed | Layers maintained by every movement, not by a tool; the two `line_order`s agree |
| **WP-D10** | Defueling app — R10.1–R10.11 | WP-D6 | Annotations emit; `contextPath` resolves; **rendering unverified**. *UI Design Standard not supplied* |
| **WP-D11** | ROB ledger + report changes — R10.13 | WP-D5 | `recalculateROB` rewrites nothing it did not compute |
| **WP-D12** | Write-off (Defueling) on the flight view — R7, R10.14, **on `PlanningService`** | WP-D6 | Binding **executed against live data** |
| **WP-D13** | Open expected credits aged — R10.15; exception worklist — R10.16; approvals — R10.17 | WP-D6 | Ageing bands; variance both directions |

**WP-D9 is the change from revision 1.** It is no longer "integrate with a remote service";
it is "make the local layer tables live". It is also the largest package and **mostly not
defuel**, which is worth seeing on its own line rather than buried in an integration.

---

## 7. Proposed edit to `00-DECISIONS.md` — for your approval, not made

> **B4 — Fuel valuation basis.** ~~Moving average per tail.~~ **Mechanism superseded
> 23 Oct 2026** by Defuel BR D1/R3.2. B4's *conclusion* stands unchanged — inventory by
> tail, stations as plants, goods issue to expense per leg, tankering benefit visible on
> the leg that earned it. **What changes is the costing basis**, from one moving average
> to a method configured per carrier code, defaulting to FIFO. The MNL–SIN tankering
> example remains valid; under FIFO the saving appears on the consuming leg through layer
> consumption rather than through a carried-forward average.
>
> **F28 — closed 23 Oct 2026** against D1/R3.2. F28 observed that B4's MAP has no layers
> while FIFO needs them, and that both could not hold as designed. That is resolved: the
> basis is configurable per carrier and **both are maintained**. F28's closing question —
> *"worth establishing what FIFO is for first"* — is answered by R3.2a: FIFO is the basis
> for every fuel movement on a FIFO carrier, not for defuels alone.

---

## 8. Defects for `CLAUDE.md` §11 — proposed, not written

Next free number is **D61** (highest existing is D60).

- **D61** — `db/fifo-valuation.cds` defines a complete FIFO/MAP valuation model
  (`FUEL_STOCK_MOVEMENT_LEDGER`, `FUEL_STOCK_BALANCE`, `FUEL_BURN_HEADER`) written **only**
  by `tools/seed-fifo-valuation.js`. No `srv/` handler maintains it; `srv/` holds one read
  (`reconciliation-service.js:9`). *Observed:* a valuation ledger that looks live and is a
  snapshot. *Wrongly concluded elsewhere:* that FIFO runs today, and separately that FIFO
  does not exist in this repository at all. **Both conclusions were drawn from the same
  true observation — that the screen shows correct FIFO layer consumption.**
- **D62** — two `line_order` vocabularies exist (`ROB_LEDGER` and
  `FUEL_STOCK_MOVEMENT_LEDGER`) with nothing asserting they agree, while the second is
  rebuilt offline from the first.
- **D63** — `ValuationLineType` carries `DEFUEL` and `TRANSFER`; `ROBEntryType` carries
  neither. The two ledgers disagree on whether a defuel is expressible.
- **D64** — `ROB_LEDGER.line_order` has five positions
  (`0 opening, 1 uplift, 2 block burn, 3 APU burn, 4 adjustment`), not the four recorded in
  the BR, and no defuel slot, while display queries and the rebuild sort on different keys.

---

## 9. Blocking questions, in full

Eleven questions. **Two block the first line of code; four more block named work packages;
five are scope or governance.** Each states what I need, why it blocks, the options and
their consequences, and a recommendation where I have one.

Seven are BR open points (**O11–O16**) restated with what measurement has already settled.
**Four are new** — not in the BR's open list, and they block work that is otherwise ready:
**Q1, Q8, Q9, Q10**.

---

### BLOCKING NOW — nothing can start until these are answered

#### Q1 · Confirm the valuation service is this repository *(new — not an O-point)*

**What I need:** a yes, or a pointer to a second service if you believe one exists.

**Why it blocks:** it decides whether WP-D9 is *"call another team's API"* or *"make our own
tables live"*. Those are different packages with different owners, and the prompt instructs
me to build the first. The evidence for the second is §0.3 — the deployed app's manifest
points at `/odata/v4/valuation/`, which is `srv/valuation-service.cds:16` in this
repository, exposing the three tabs observed on screen.

**If I am wrong**, send me the other service's `$metadata` or its repo and I will
re-measure. **Nothing else in this list changes** if I am wrong — Q2 onward stand either
way.

---

#### Q2 · O13 — where does a defuel sit in the within-timestamp order?

**What I need:** a position in `ROB_LEDGER.line_order`, and confirmation that the valuation
ledger uses the same relative position.

**Why it blocks:** it is a column default in WP-D2 and cannot be changed later without
rewriting history. The BR records four positions; **measured there are five**
(`db/schema.cds:3847`):

```
0 opening · 1 uplift · 2 block burn · 3 APU burn · 4 adjustment
```

**The options, on the ordinary hub case** — fuel comes off minutes after it went on, both
recorded at the same time:

| Option | Consequence |
|---|---|
| **Defuel at 2**, after uplift, before both burns | The defuel removes fuel **including** the uplift just recorded. Under FIFO it consumes the **new** layer first |
| **Defuel at 5**, after adjustment | The defuel sees the balance after everything else that day. Under FIFO it consumes **older** layers, the uplift having been partly burned first |
| **Defuel between the burns** | No business meaning I can construct. Listed to be dismissed |

**This is not a tie-break detail.** Under FIFO it selects which batch is consumed, which
selects the price, which selects the credit the vendor is asked for. Two orders do not give
a slightly different value — they give a different one, and nothing on the row says so.

**Recommendation:** **2**, directly after uplift. A defuel is physically the reversal of the
uplift that preceded it, and at a hub it usually returns precisely that fuel. It also makes
M1 and M2 agree on the ordinary case instead of diverging.

**Second half:** `FUEL_STOCK_MOVEMENT_LEDGER` carries **its own** `line_order` and nothing
asserts the two agree (defect **D62**). Whatever you choose must hold in both, and WP-D2
should add the assertion.

---

### BLOCKING A NAMED PACKAGE — the start is not held up

#### Q3 · O14 — is the write-off approval a switch or a value band? *(blocks WP-D6)*

**What I need:** switch, or switch plus threshold; and if a threshold, who owns the figure.

**Why it blocks:** D11 says *"switched on by a carrier-level parameter"*, which says
**whether**, not **how much**. One switch sends a $40 write-off through the same two-person
approval as a $40,000 one, and an approval queue full of trivia is one nobody reads.

| Option | Consequence |
|---|---|
| **Switch only** | Simplest, faithful to D11 as written. Approvers drown in small items |
| **Switch + threshold** | A second `parameter-store` row. Needs an owner per carrier and a currency |
| **Threshold only** | Zero means always, infinity means never — one mechanism. Reads less obviously than D11 |

**Recommendation:** switch plus optional threshold, both through `parameter-store` so they
are effective-dated and auditable, threshold absent meaning "all". Satisfies D11 exactly and
makes the band available without a second decision later.

---

#### Q4 · O15 — does a part-settled parcel accrue in whole or in remainder? *(blocks WP-D8)*

**What I need:** whole, remainder, or nothing.

**Why it blocks:** it is the population query of the accrual run. D5a allows a parcel
credited in parts; D7 accrues what is unsettled; a parcel half-credited at close is
**partly** both.

| Option | Consequence |
|---|---|
| **Remainder only** | Accrues what is genuinely outstanding. Matches R8.7's *"what is sitting in the `DEFUEL` location"*, since the balance has already fallen by the settled part |
| **Whole parcel** | Overstates the position by the part already credited |
| **Nothing once partly settled** | Understates it, and R8.6 would be satisfiable with an unaccrued position outstanding |

**Recommendation:** **remainder** — because R8.7 already defines the population as the
location's contents and R5.7 clears the balance per settlement event. On that reading the
answer falls out of two decisions you have already made, and I would rather you confirm it
than have me assume it.

---

#### Q5 · O11 — is the carrier's valuation method effective-dated? *(blocks WP-D9)*

**What I need:** fixed, effective-dated, or switching forbidden while a tail holds stock.

**Why it blocks:** it decides whether the method is a column on the carrier or a
`parameter-store` row, and whether a conversion run is needed.

**What goes wrong unanswered:** a carrier switched MAP → FIFO mid-year leaves tails holding
fuel that was never layered. There is nothing for FIFO to consume, so the first movement
after the switch has no basis at all.

| Option | Consequence |
|---|---|
| **Effective-dated**, each row recording which applied | Most faithful to R3.6. Needs opening layers at the switch date |
| **Fixed per carrier**, change forbidden while stock is held | Cheapest. A carrier must empty every tail to change basis |
| **Conversion run** builds opening layers from the MAP balance | One layer at the average price. Makes the switch a dated event |

**Recommendation:** effective-dated **with** a conversion run. The second without the first
cannot say which basis produced a row written before the switch.

---

#### Q6 · O12 — where does a tail's carrier come from? *(blocks WP-D9)*

**What I need:** the assignment rule, and what happens to a wet-leased or transferring tail.

**Why it blocks:** valuation is scoped by carrier (D1) and the lookup has no source.
`parameter-store.js:282–283` names *"tail → carrier assignment"* **in a comment only** — the
scoping axis exists, the rule does not. `AIRCRAFT_REGISTRATIONS.operator_code`
(`db/schema.cds:289`) holds an **ICAO** operator code and `CARRIER_MASTER` is keyed on
**IATA**, so the two do not join today.

| Option | Consequence |
|---|---|
| **From the flight** | Right for flight-bound movements; a defuel or tail-only uplift has no flight |
| **From the tail master**, effective-dated | Survives tail-only movements. Needs the ICAO↔IATA mapping that does not exist |
| **Captured on the movement** | Always available. Another field somebody can get wrong |

**Recommendation:** tail master, effective-dated, with the flight as a cross-check where
there is one — but the ICAO↔IATA gap is real work and should be its own package.

---

### SCOPE AND GOVERNANCE

#### Q7 · O16 — are the other two month-end options in scope?

Estimated in §5: *defer unconsumed fuel* ~1.5–2 WP; *physical inventory adjustment* ~2–3 WP
plus S/4 interface work. **Neither is defuel.**

**Recommendation:** build the application with the accrual option; declare the other two
visible and inactive. One sentence either way, and it moves the size of the application
considerably.

---

#### Q8 · May defuel define `posting_key` ahead of WP-23? *(new — blocks WP-D2)*

**What I need:** yes, wait, or define it narrowly.

**Why it blocks:** D9 requires FuelSphere to record a posting key. **There is no such
concept** — `posting_key` has zero occurrences, and WP-23 is a planned row
(`04-WORK-PACKAGES.md:555`), not an implementation. So D9 cannot be implemented as written
by any feature, including this one.

**Recommendation:** define it on the defuel entities now, narrowly, and let WP-23 generalise
it. That means a cross-cutting concept is first implemented inside one feature — scope you
should accept deliberately rather than discover.

---

#### Q9 · Does a storage location hold layers? *(new — blocks WP-D2 and WP-D3)*

**What I need:** one value per location, or layers within a location.

**Why it blocks:** it is the shape of `DEFUEL_LEDGER_ENTRY` — WP-D2's schema and WP-D3's
whole subject.

**The problem:** R3.5 values fuel entering a location *at the value it left the tail at*.
Under FIFO a single defuel may consume **three layers at three prices**, so the location
receives one quantity carrying three values.

| Option | Consequence |
|---|---|
| **Location holds layers**, mirroring the tail | Exact. R3.5 and R3.6 hold literally. A second layer structure to maintain |
| **One blended value** per defuel | Simple. **Breaks R3.5's traceability** — a blend reconciles to no single invoice, which is what R3.5 exists for |
| **One location entry per layer consumed** | Exact, and no new structure — just more rows. Settlement then operates per entry |

**Recommendation:** the third. It satisfies R3.5 without inventing a second layer model, and
it makes R5.11's partial settlement natural — a parcel is settled entry by entry.

**This does not arise on a MAP carrier**, where a defuel has one rate. It blocks the FIFO
branch, not the MAP-first sequence in §3.

---

#### Q10 · What happens when a settled defuel is reversed? *(new — blocks WP-D7)*

**What I need:** the rule for each of three states.

**Why it blocks:** D6a says a defuel may be reversed; R1.10 says a reversed defuel cannot be
reversed again. **Neither says anything about one already settled**, and prompt §4.7 asks me
to specify exactly that.

| State at reversal | Question |
|---|---|
| **Parked, nothing posted** | Clean — reverse the movement, clear the location, no commercial effect. *I assume this needs no decision* |
| **Partly settled** (D5a) | Refuse, reverse only the unsettled remainder, or reverse the credit too? |
| **Fully settled**, credit agreed and posted | Refuse outright, or must the credit be reversed with the vendor first? |

**Recommendation:** **refuse once any settlement event exists**, requiring the settlement to
be reversed first. A reversal that silently unwinds an agreed vendor credit is a commercial
document changing without the vendor knowing. But this is a commercial rule, not a technical
one, and it is yours.

**Related and also unanswered:** under FIFO a reversal must **put consumed layers back**,
which is only coherent if no later movement has since consumed them. Worth deciding with Q5
and Q9.

---

#### Q11 · Approve the `00-DECISIONS.md` edit

Written out in §7, striking B4's mechanism and closing F28. **I have not made it**, per
prompt §6.

---

### Summary

| # | Question | Blocks | Type |
|---|---|---|---|
| **Q1** | Valuation service is this repo | **Everything** | **New** |
| **Q2** | O13 — defuel's `line_order` slot | **WP-D2 — the first schema commit** | BR |
| Q3 | O14 — approval switch or band | WP-D6 | BR |
| Q4 | O15 — accrual whole or remainder | WP-D8 | BR |
| Q5 | O11 — method effective-dated | WP-D9 | BR |
| Q6 | O12 — tail → carrier rule | WP-D9 | BR |
| Q7 | O16 — month-end scope | WP-D8 sizing | BR |
| Q8 | `posting_key` ahead of WP-23 | WP-D2 | **New** |
| Q9 | Does a location hold layers | WP-D2/D3, FIFO branch only | **New** |
| Q10 | Reversing a settled defuel | WP-D7 | **New** |
| Q11 | `00-DECISIONS.md` edit | Governance | — |

**Answer Q1, Q2 and Q8 and I can start**, and run through to WP-D8 on a MAP carrier without
any of the rest. Q5, Q6 and Q9 are the FIFO branch and can be answered while that is built.
Q10 is needed before WP-D7, Q3 before WP-D6, Q4 and Q7 before WP-D8.

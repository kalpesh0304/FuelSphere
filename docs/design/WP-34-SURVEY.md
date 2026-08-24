# WP-34 — survey · `ACARS_DERIVED` and the derived-reading gap

**Defect D41.** Measured against the code on 24 August 2026, on `main` at `3168c13`.

The package brief said the survey decides the scope. It did — in one respect it
changed the package, and in two it closed questions that were open when the
package was written.

---

## 1. Every writer of `fob_source`, on both entities

**There is no writer.** `grep -rn "fob_source *[:=]" srv/ --include=*.js` returns
nothing. Not one handler on any of the six implemented services sets the field.

| Path | Writes `fob_source`? |
|---|---|
| OData payload, `FUEL_DELIVERIES` | Yes — the only live write path |
| OData payload, `FLIGHT_SCHEDULE` | Yes in principle; nothing has ever used it |
| Seed CSV, `FUEL_DELIVERIES` | 24 rows — 17 `NONE`, 5 `ACARS`, 2 `CREW_REPORTED` |
| Seed CSV, `FLIGHT_SCHEDULE` | **No fob columns existed in the file at all** |
| Any JavaScript handler | **None** |

WP-34 adds the first programmatic writer in the codebase.

## 2. Every reader, and whether any branches on the value

One consumer, and it branches hard.

| Site | What it does with the value |
|---|---|
| `srv/lib/fob-reconciliation.js:79` | Builds the rule code `TOL-FOB-${fobSource}` |
| `srv/lib/fob-reconciliation.js:92` | Indexes `TOLERANCE_BY_FOB_SOURCE[fobSource]` |
| `srv/lib/fob-reconciliation.js:156` | `NONE` and any unknown value resolve to no rule → `NOT_RECONCILED` |
| `srv/order-service.js:670, :686` | Resolves the tolerance and reports it |
| Five call sites in `order-service.js` and `ticket-service.js` | Trigger the above |

`FLIGHT_SCHEDULE.fob_source` has **no reader whatsoever** — four references in
`planning-fiori-annotations.cds` and nothing else.

The branch is the reason the member has to exist. An unknown string does not
fail loudly; it resolves to no rule and the delivery reports `NOT_RECONCILED`
with the evidence *"carries no reading"*, which of a derived delivery is false.

## 3. §551 and §493 — and whether WP-19 built against a value that does not exist

**No. WP-19 built one term of §493 and none of §551.** D41's phrasing —
*"WP-19 built the derivation"* — is half right, and the half that is wrong
changed this package.

| Specified | Built by WP-19 | Evidence |
|---|---|---|
| §493 `+ APU cycle minutes / 60 × rate` | **Yes** | `srv/lib/apu-burn.js`, `deriveCycle`, `rateForTail`, `allocate`, `splitBlockBurn`; wired through `deriveBurn` and `applyBurnSplit` |
| §493 `fob_OUT − fob_IN` | **No** | `fob_at_out_kg`, `fob_at_in_kg`, `fob_at_off_kg`, `fob_at_on_kg` are read by `planning-fiori-annotations.cds` **and by no JavaScript** |
| §551 `ground_burn_kg` measured | **No** | `db/schema.cds:1121` — *"Nothing consumes this until WP-19."* WP-19 came and went; nothing consumes it |
| §551 inversion on the derived path | **No** | There is no measured computation to invert |

**Consequence for the package.** A missing enum member was not mismarking a
running path — nothing was running. Criterion 1 could not have produced
criterion 2 on its own: a member that nothing writes is the same as no member,
which is what the brief said, and here nothing *could* write it. So WP-34 builds
the derivation as well as the member.

## 4. Does `ground_burn_kg` actually invert?

**No — specified and unbuilt.** It is a schema comment. WP-34 gives it its first
consumer, and on the derived path it is written as the **input** §551 describes:
the APU adjustment, recorded so the arithmetic can be reproduced from the row.

## 5. The default asymmetry — deliberate, and not WP-33's

`FUEL_DELIVERIES.fob_source default 'NONE'` landed in **`0188dc6`, WP-12's schema
commit** — three weeks before WP-33. WP-33 inherited the type, declined the
default, and recorded why at the site (`db/schema.cds:601`):

> *"Declared WITHOUT a default, unlike `FUEL_DELIVERIES.fob_source` which carries
> default `'NONE'` — here an absent reading must stay absent."*

under a block header reading *"Nothing here defaults."*

**Deliberate. It stays.** Both tokens encode *unknown*; `'NONE'` is load-bearing
on the delivery precisely because `resolveTolerance` returns null for it, which
is what produces `NOT_RECONCILED` rather than a false pass. Adding a default on
`FLIGHT_SCHEDULE` would write a value where nothing was observed, and there is
no reader to benefit.

## 6. The `@assert.range` blast radius

**The question is already answered in the code: `FobSource` carries
`@assert.range: true` at `db/schema.cds:778`.** It was added under D25, by the
packages that swept the enums. The annotation's behaviour is not restated here —
`CLAUDE.md`'s trap row is the authority.

So there is no radius to weigh. Adding a member to an already-annotated enum is
a **widening** of an enforced set:

| | |
|---|---|
| Entities constrained | 2, unchanged |
| Projections | 13, across 8 services, unchanged |
| Seed rows invalidated | **0** — a widening cannot invalidate a value that already passed |
| Writers newly constrained | **0** |
| New value enforced on OData writes | From the moment it lands |

The decision the brief reserved was taken by an earlier package. Recorded, not
re-opened.

## 7. One member, two rungs — open, and not resolved here

§538's precision ladder offers **two** derived precisions:

| Source | Suggested |
|---|---|
| `IN`/`OUT` adjusted, APU cycles timestamped | 1.0% / 100 kg |
| `IN`/`OUT` adjusted, APU minutes apportioned | 1.5% / 200 kg |

§552 extends the enum by **one** member. The discriminator already exists
elsewhere — `ApuSource.GROUND_TIME_EST` is the apportioned path, and
`TOLERANCE_RULES` has no scope column for a gauge source, which is why the
existing rows carry it in the rule code.

WP-34 takes the **weaker** rung for the single member, on the `PANEL_PRESET`
precedent already in `fob-reconciliation.js`: held to the looser threshold
because the error is at least as large, never smaller. The tighter rung would
manufacture discrepancies on the apportioned path.

**Whether the ladder needs a second member is a decision, not a defect.** Flagged.

## 8. A correction to the brief's out-of-scope note

The brief excluded tolerance work on the grounds that *"`TOLERANCE_RULES` carries
an empty `tolerance_value` on all three FOB rows."*

There is **no `tolerance_value` column**. The three FOB rows are fully populated
and wired — `is_wired=true`, `upper_limit` 0.5 / 1.5 / 1.5, `floor_value`
50 / 200 / 200. What is empty is `value_number`, which belongs to the generic
`row_kind` and is empty on every `TOLERANCE` row by design.

This matters because it moves `TOL-FOB-ACARS_DERIVED` from *excluded tolerance
change* to *required for the member not to lie*. Without the row the derived
delivery resolves no rule and reports `NOT_RECONCILED` — *"carries no reading"* —
of a delivery that carries a derived one.

## 9. Two defects found while wiring, both mine, both fixed in the branch

| | |
|---|---|
| **A two-key comparison object applies one bound** | The turnaround window was `{ '>=': from, '<=': to }`. It compiles, it runs, and it filters on **one** of the two. The window degraded to *any cycle before departure* and swept in every earlier turn for that tail: **four cycles for a two-cycle turn, 201.25 kg of APU where 105 burned.** A 96 kg over-adjustment — the phantom-burn error this module exists to prevent, arriving through the query rather than the arithmetic, and looking like a working filter. Now `between … and …` |
| **A column consumed without being selected** | `reconcileDelivery` read `delivery.delivery_date` to resolve the tolerance as of the delivery, and selected four columns not including it. **Every tolerance resolution since WP-13 ran with `asOfDate` undefined.** Pre-existing, in the file WP-34 touches, fixed here |

## 10. Two the regression caught, also mine

Recorded because both were caught by harnesses from other packages, which is the
argument for running all of them:

- `wp09-harness` — I seeded `status='COMPLETED'` on two `FLIGHT_SCHEDULE` rows.
  `FlightStatus` has no such member. Corrected to `ARRIVED`.
- `wp13-harness` — its extraction gate failed on five undocumented `EPD4xx`
  codes. Documented in `03-VALIDATION-RULES.md`; gate back to zero.

## 11. What this package did not touch

- WP-31 and every signature field
- The ground-gap split logic — C-4's rule, WP-19's design notes
- Any existing tolerance value
- `CLAUDE.md` — maintained by direct commits on `main`, not by package
  branches. **D41's row is ready to be struck and this branch has not struck it**

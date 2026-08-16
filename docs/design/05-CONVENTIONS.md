# 05-CONVENTIONS.md

**FuelSphere — engineering conventions for the merge**
Read this before touching any file.

---

## 1. What this codebase is

SAP CAP / CDS on Node.js. **Not ABAP.** There are no Z-tables, data elements or domains. The equivalents are CDS entities in `db/schema.cds` under the `fuelsphere` namespace, CDS types and enums, and OData projections in the service `.cds` files.

- 97 entities in a single `db/schema.cds`, roughly 4,400 lines
- 15 services, 6 with JavaScript handlers, 9 declarations only
- ~185 OData projections; **no database views**
- **No secondary indexes declared anywhere**
- Seed data in `db/data/` as semicolon-delimited CSV, named `fuelsphere-<ENTITY>.csv`

---

## 2. Naming

| Artefact | Convention | Example |
|---|---|---|
| Entity | `UPPER_SNAKE_CASE` | `FUEL_DELIVERIES` |
| Field | `lower_snake_case` | `delivered_quantity` |
| Association field | Entity name lowered, singular | `order`, `supplier`, `aircraft` |
| Enum type | `PascalCase` | `OrderStatus` |
| Enum member | Varies by module — **match the surrounding module, do not normalise** | `Draft` in `OrderStatus`; `PENDING` in `CrewReviewStatus` |
| Projection | Fiori-friendly plural | `db.FUEL_ORDERS` → `FuelOrders` |
| Service file | `<domain>-service.cds` / `.js` | `order-service.js` |

**Enum casing is inconsistent across the codebase and that is not a defect to fix.** `OrderStatus` uses `Draft`; `CrewReviewStatus` uses `PENDING`. Normalising them would break seed data and any external caller. Match the module you are in.

---

## 3. Error codes

Two sets exist and **both are authoritative**: codes implemented in handlers, and codes specified in `CLAUDE.md` for modules not yet built. Do not invent a parallel scheme.

### Implemented — in use today

| Prefix | Domain | Documented in CLAUDE.md |
|---|---|---|
| `FB4xx` / `FB5xx` | Fuel burn and ROB | No — needs writing up |
| `EPD4xx` | ePOD, delivery, quantity verification | Yes |
| `IMP4xx` | Flight schedule import | No — needs writing up |
| `ENR4xx` | Flight schedule enrichment | No — needs writing up |
| `DSP4xx` / `DSP5xx` | Flight dispatch import | No — needs writing up |

### Specified, not yet implemented

When you build these modules, **use the documented codes.** They are already mapped to real rules.

| Prefix | Domain | Codes |
|---|---|---|
| `INT4xx` | S/4 integration | INT401–404 |
| `INV4xx` | Invoice verification | INV401–410 |
| `PLN4xx` | Planning and SAC | PLN401–405, 410–411, 420–422 |

Full descriptions in `CLAUDE.md` section 8.

### New modules

Modules with no existing prefix take a new one, documented in `CLAUDE.md` section 8 in the same commit:

| Prefix | Domain |
|---|---|
| `STG4xx` | Inbound staging |
| `APU4xx` | APU usage and avoidability |
| `LDG4xx` | Fuel ledger closure |
| `CMP4xx` | Completeness and expectation |
| `PRC4xx` | Pricing determination |
| `CAR4xx` | Carrier arrangement resolution |
| `POS4xx` | Posting determination |

### Numbering

- `4xx` — business rule violation
- `5xx` — technical failure
- **Existing codes keep their numbers.** Do not renumber
- **New codes within an existing prefix start at `x450`**, so a new ePOD rule cannot collide with `EPD411`
- New prefixes start at `x401`

Every validation rule in `03-VALIDATION-RULES.md` carries a code. A rule without one is not implemented.

## 4. Number ranges

| Number | Format |
|---|---|
| Order | `FO-{station}-{YYYYMMDD}-{NNN}` |
| Delivery | `EPD-{station}-{YYYYMMDD}-{NNN}` |
| Ticket internal | `FT-{station}-{YYYYMMDD}-{NNN}` |

**Two changes required:**

1. Generation is currently client-side `max + 1` with no locking. Replace with a database sequence or CAP number range. Race-prone as it stands.
2. Sequence width of three digits caps a station at 999 per day. Widen to four.

**Never** substitute `'XXX'` for a missing station code. Fail with a code instead — a number containing `XXX` is a silent data quality hole that cannot be found afterwards.

---

## 5. Patterns to follow

### Derived values are never keyed

Totals sum from their components. A stored scalar is overwritten or dropped when a second child arrives. This applies to delivered quantity, order fulfilment, invoice totals and ledger balances.

### Missing is not zero

A derived value with a missing input is `null`, not `0`. `planned_burn_kg` hardcoded to zero is what made the entire ACARS variance path unreachable — the ladder tested `> 0` and never fired.

### Physical events are always recorded

A ticket with no order, an uplift at an uncontracted station, a delivery exceeding tolerance — all captured, flagged, and routed to an exception queue. Never rejected. Refusing to record fuel that is already in the tanks puts it outside the system.

### Configuration resolves at transaction date

Never at query date. A tolerance changed in March must not re-evaluate January's exceptions. Where a resolved value drives a status, record which configuration row produced it.

### Verify the framework before adding a safety net

D1 was recorded as a data-loss defect because a transaction wrapper was found commented out. Measurement showed it was commented out because CAP already provides the transaction. Restoring it would have broken the sync silently.

An absent guard is not evidence of a missing guarantee. Check what the framework does before treating a gap as a defect — and before removing a guard, check whether a schema assertion or framework behaviour explains it.

### Every status has an owner and an exit

A status that no code path sets, or that nothing moves out of, is a defect. `Completed` is in `OrderStatus`, appears in seed data, and no code writes it.

---

## 6. What not to touch — and where the exceptions are

| Area | Rule |
|---|---|
| Implemented service handlers — order, burn, ticket, refueler, master data, planning | **Do not rewrite. Extend, and correct where they diverge from the documented design.** See below |
| The order lifecycle state machine | Keep the shape. Fix the three divergences below |
| Entity and field naming | Do not change. Embedded in ~185 projections and 79 seed files |
| Service decomposition into 15 services | Keep. Reflects real module boundaries |
| `AuditTrail` and `ActiveStatus` aspects | Keep. Applied consistently |
| Enum casing within a module | Keep. See section 2 |

### The handler rule is not "leave the code alone"

Roughly 3,300 lines of handler code are the only working behaviour in the system, so wholesale rewriting is prohibited. But some of that code contradicts its own documented design, and **a bug is not a convention to preserve.**

Where the code diverges from `CLAUDE.md`, the code is wrong. Correct it within a declared work package:

| Divergence | Correct behaviour |
|---|---|
| Order creation writes `'Created'`, not in `OrderStatus` | Write `'Draft'`, per the documented lifecycle |
| `'Completed'` is never written; the path is unimplemented | Implement the transition to `Completed` |
| `captureSignatures` sets `Delivered` with no status guard | Add the guard. Every other transition has one |
| ROB is computed as `max(0, previous − burn)` | `previous + uplift − burn + adjustment`, per the documented formula |
| `planned_burn_kg` hardcoded to `0` on the ACARS path | Populate from the plan, so the variance ladder is reachable |
| Density demanded by `EPD404` then unused | Use it, or stop demanding it |

**The test:** if `CLAUDE.md` documents behaviour and the code does something else, the code is the outlier — the seed data usually agrees with the documentation. Do not "fix" the data to match the code.

## 7. Known traps

| Trap | Detail |
|---|---|
| **Never pass `req` to `cds.tx` inside a request handler** | CAP already wraps every inbound request in a managed transaction. `await cds.tx(req, …)` inside a handler nests onto it and the writes **never land**, while the action returns HTTP 200 with a success payload. Measured under WP-01 across all three master data feeds. Bare `await DELETE.from(...)` and `await INSERT.into(...)` are already atomic on the request path; `req.error(500, …)` rolls them back. **`cds.tx()` without `req` is different** — it opens an independent root transaction, which is the correct pattern where a record must survive a failed request, such as an audit or exception row. That case was not measured under WP-01; verify before relying on it |
| **`CLAUDE.md` describes a target state** | Sections are marked BUILT, DESIGNED or DIVERGENT. An unmarked statement is not a guarantee. Verify against source |
| **Seed data follows the specification; code does not** | Where seed data, `CLAUDE.md` and the code disagree, the code is usually the outlier. `FUEL_ORDERS.status` and `INVOICES.status = 'SUBMITTED'` were both reported as data violations. They are not — the enum is missing a member and the code writes a value that exists nowhere |
| **Two pricing families** | Singular (`PRICING_FORMULA`, `MARKET_INDEX`, `DERIVED_PRICE`, `PRICING_CONFIG`) and plural (`PRICING_FORMULAS`, `MARKET_INDICES`, `DERIVED_PRICES`, `PRICING_CONFIGURATIONS`). **Two services project the same name over different base tables.** Confirm which family you are in before editing |
| **Declared is not implemented** | Roughly 250 OData actions are declared; a handful have handlers. CAP returns a default no-op for an action with no handler — **it looks like it worked** |
| **Hardcoded thresholds implement documented rules** | −40/+50 °C and 0.775/0.840 kg/L are `EPD403` and `EPD404`. These are not arbitrary magic numbers. The rules are correct; only the values are in the wrong place. Move them to `TOLERANCE_RULES` without changing them |
| **SOX controls are specified and unenforced** | INV-001 to 008 and FPE-001 to 007 are documented, and `SOD_RULES` is seeded to match. No check exists in any handler. Do not assume any control is active |
| **Test user attributes are not enforced** | The `ops` user carries `station=MNL,CEB` and `region=APAC`, but there are no `where:` clauses. Testing with `ops` will not reveal row-level security problems |
| **Config tables are populated and unread** | `TOLERANCE_RULES`, `SOD_RULES`, `ALLOCATION_RULES`, `INTEGRATION_CONFIGS` all have data and no consumer. Enforced values are hardcoded literals in JavaScript |
| **Effective dating exists without resolution** | `valid_from`, `valid_to` and `priority` columns are present on several config tables. No code selects by date or orders by priority |
| **Comments contradict each other** | The demand formula appears with five terms at `planning-service.cds:12` and six at `:134`. `CLAUDE.md` states six, which is correct |
| **Node 24 is not supported** | CAP supports Node 18, 20 and 22. Run `npm rebuild` after switching versions |

## 8. Testing

Seed CSVs are the only test corpus and they are inadequate — 2 fuel tickets, 3 deliveries, 4 burns, and both error tables empty.

They are being replaced by data generated from the design workbook's 151 scenarios, which cover tail swaps, defuel, jettison, broken ledger chains, provisional pricing, duplicate invoice lines, over-delivery and unmatched tickets.

**Every behavioural change must have a scenario in the seed set that exercises it.** A change with no scenario is not complete.

When correcting seed data, check `CLAUDE.md` first. Several values reported as enum violations are the data correctly following the documented design while the enum or the code lags behind.

---

## 9. Git

| Convention | Rule |
|---|---|
| Branch per work package | `wp/<package-id>-<short-name>` |
| One package per branch | Never combine packages |
| Commit message | Reference the package and the decision or defect id |
| Schema changes | Separate commit from behaviour changes, always |
| Do not merge | Until the package's exit criteria in `04-WORK-PACKAGES.md` are met |

---

## 10. When to stop and ask

Stop and raise it rather than deciding:

- A decision in `00-DECISIONS.md` is unfilled or ambiguous
- The change would alter an entity name or an existing field's meaning
- The change would touch an implemented handler beyond its stated scope
- Source contradicts `00-DECISIONS.md`, `01-TARGET-SCHEMA.md` or this file
- A defect is found that is not in the defect list
- The work package's exit criteria cannot be met as written

An unrecorded decision made mid-implementation is how the two pricing families happened.

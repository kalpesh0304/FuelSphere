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

### A guard that early-returns can suppress a derivation

WP-05 found a validation guard using `req.error` then `return`, where the return also skipped a `total_amount` calculation later in the same handler. The rejected record ended up with no quantity and no total, and nothing indicated the second was a side effect of the first.

Before adding or moving a guard, check what sits below it in the handler. Where a derivation follows, prefer flagging the record and continuing over an early return.

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
| **Before trusting a pass, establish the check could have failed** | Five packages produced a check that would have passed for the wrong reason. WP-01: a duplicate primary key raised nothing, because `MASTER_SUPPLIERS` is `cuid` — the "failure" was a successful replace. WP-04, WP-08, WP-09: three searches matching the wrong term, case or syntactic form. WP-11: a migration assertion counted rows the harness itself had created. **Each was caught by a second observation, not by the check.** Assert that the operation under test actually occurred — WP-01 asserted a DELETE was observed, WP-06 asserted the seed supplied the setup. **Assert against the immutable source, never against state the test has modified** |
| **A search that matches one form is silently partial** | Three occurrences. WP-04: `ConcurrencyMode` where OData v4 emits `Core.OptimisticConcurrency`. WP-08: `^\[error` where the compiler emits `[ERROR]`. WP-09: `status: '…'` which missed `req.data.status = '…'` — the primary writer, in assignment form. **A verification that can produce a false pass is worse than none.** Key on exit codes; make searches form-agnostic; prove the instrument against a known-present string |
| **Declaring a CDS enum does not enforce it** | CAP validates only where `@assert.range` is present. Without it, an enum is documentation and any string is accepted. 79 enum-typed elements exist; 0 are enforced. **A change that declares an enum and stops there looks done and is not** |
| **Draft enablement is inherited by composition children** | A composition child of a draft-enabled entity is draft-enabled too, without saying so anywhere. WP-21A found `InvoiceExceptions` needs `IsActiveEntity` in its key because `Invoices` is draft-enabled. **Third distinct way draft enablement has bitten:** WP-12 a CREATE that never fired on a child, WP-19 a `.drafts` path on an entity that has none, and now inheritance nobody declared. **Before touching any entity, establish whether it is draft-enabled — including by inheritance** |
| **The value as received and the value as resolved are different facts** | Keep both. WP-07B kept `tail_number` beside the `tail` association; WP-21A kept `ticket_number` beside `ticket`. **The string is evidence even when it resolves to nothing** — and when resolution fails, it is the only evidence there is. Collapsing them loses exactly the case that matters |
| **Where a draft handler registers depends on what it reads** | Two packages, opposite answers. **WP-12** registered a derivation on `FUEL_DELIVERIES`, a draft child: `draftActivate` fires CREATE on the root and writes children with it, so no per-child CREATE reaches the active entity — the POST returned 201, the handler read correctly, and it never ran. **WP-17** registered on the **active entity only**, deliberately: a draft delivery has no tickets pointing at it, so reconciling one would read an empty child set and overwrite a real result. **Root-versus-child is only half the distinction.** A handler reading its **own row** needs the draft path; one reading its **children** must wait for activation, because the children are not there yet |
| **A label is not a placement** | `@title` names a field; it does not put it on a screen. WP-UI-02 established that no field should render its technical name, and every package since honoured it — **producing twenty-two new fields of which twenty-one have a label nobody will ever see.** The convention was followed exactly and the result was invisible work. **A field added to a screen-bearing entity needs a `UI.LineItem` or `UI.FieldGroup` entry as well as a `@title`, or a stated reason why not** |
| **A read-only report is not a guard** | `EPD401` on `delivered_quantity` sits inside `validateDelivery`, which records findings and returns them. Nothing blocks. **A check that reports is not a check that prevents**, and from the outside they are indistinguishable — both produce an error code against the record. Establish whether a check gates or merely observes before treating a field as protected |
| **A check that skips what it cannot parse reports clean on less than it claims** | WP-HDI's seed validator **silently skipped 251 columns it could not resolve** — it had not modelled the `AuditTrail` and `ActiveStatus` aspects or association-FK flattening — so those cells were **never type-checked at all** and a clean result would have been partly hollow. Distinct from the instrument traps above: not the wrong tool, and not a check that cannot fail, but **a check that quietly narrows its own scope and reports success on the remainder.** The issue set turned out unchanged at 46, so nothing was hiding — **but that was luck, not method.** **Count what a check SKIPPED, not only what it failed, and drive the skipped count to zero before trusting the result** |
| **Three instruments in two days, each wrong by seeing less than it claimed** | A validator that **skipped** 251 unresolvable columns and reported clean. A DDL checker that missed HANA reserved words because they are quoted. An EDMX compiled from one `.cds` without its annotation files, which made a labelled field look unlabelled. **None gave a wrong answer about what it looked at; each looked at less than the question required.** Count what an instrument SKIPPED, not only what it failed |
| **A verified write can still land nowhere that matters** | The write succeeded, the verification succeeded, and both happened outside the repository. **A grep confirming your own edit proves the edit exists, not that it exists where it will be read.** Use `git -C <repo> grep`, or `git status` after writing. Three times in two days: WP-19B, WP-31, WP-32 and WP-33 recorded and absent; D32–D39 and F23–F38 the same |
| **Prove an annotation enforces by RUNNING it, and never restate what it does** | **Do not paraphrase `@assert.range`'s behaviour. `CLAUDE.md`'s trap row is canonical — cite it, do not summarise it.** The claim has a shape that compresses badly: **a positive with three exceptions.** Under compression the positive drops out first, because it is the unsurprising half and the exceptions feel like the part worth carrying — so each rewrite lands on *“does not reliably enforce”*, one step from *“does not enforce numerics”*. **One true statement became five false wordings, and the fifth was produced by the correction that removed the fourth**: restating is the operation that loses it. **The check with no paraphrase surface:** a standalone CAP model in `/tmp`, one non-draft entity, a numeric field with a range and an enum field, four POSTs in and out of bounds. **Two minutes, and it settles what no wording can** |
| **Test the case you care about, not a neighbouring one that happens to pass** | WP-09 and WP-12 both proved **the enum case**, and generalised to numerics without testing it. Neither proved less than its criterion claimed — the criterion was sound and **the generalisation from it was not tested.** A passing test licenses the case it ran and no other. **This row was displaced once by a rewrite** — its substance survived as a clause inside another row, which is where a convention goes to be unfindable |
| **`LargeBinary` is a different shape inside a request and outside one** | Outside, CAP hands back a base64 **string**; inside, a **stream**. `Buffer.from(String(v), 'base64')` is correct for the first and **silently wrong** for the second — `String(stream)` is `"[object Object]"`, so WP-31 gave **every signature in the system the identical `image_hash`**: a constant in the one field whose whole purpose is to distinguish, inside the layer built to prevent exactly that. **Confirmed against `sha256(Buffer.from("[object Object]", "base64"))` rather than inferred.** **Throw on any shape you do not recognise; never coerce** — a coercion that succeeds is indistinguishable from a conversion that worked |
| **A field that is still visible still needs a label, whatever the plan for it is** | WP-31 removed the old fields' labels in step 3, reasoning that an unlabelled field is a useful signal nothing should read it. **The fields stay exposed until step 4**, so that regressed WP-UI-02 **for the entire window between the steps** — and its harness caught it. **A staged removal has a middle**, and the middle is production if it ships. **This is not about labels.** Staging exists precisely so both shapes are live at once, which means **every intermediate commit is a shape a user can meet** — and reasoning about it as scaffolding is the error |
| **A harness that pins another scenario's data inherits that scenario's corrections** | WP-DEMO-01, WP-18 and WP-19 all pinned S1's rows as their own fixtures, and correcting S1 broke six tests across three merged packages **with no signal until something moved.** The pin is invisible until it fails, and **it fails in the package that changed the data rather than the one that depends on it.** **Two distinct repairs, and telling them apart is the whole skill:** where the criterion still holds and only the number moved, **update the pin.** Where the correction removed the property the test was checking — `wp18 EXIT-1b` asserts additional and extra are never merged, and S1 now zeroes both deliberately — **repoint the fixture, never relax the criterion.** **A test that stops checking its property still passes.** **AND WHEN THE FIXTURE KEEPS MOVING, THE FIXTURE WAS THE WRONG IDEA:** `wp18 EXIT-1b` was repointed three times — AC410, then AC412, then S3 — because each corrected scenario deliberately zeroes `additional` and `extra` for the same reason. A fourth was coming. **The criterion is a property of the DATA, so the test now searches for a qualifying row and fails loudly if none exists.** Seven baseline plans qualify and none is a demo scenario. **A pin that chases every correction is a test coupled to a fixture rather than to its property** |
| **A `UI.LineItem` naming a field the projection lacks breaks the whole read** | Not the column — **the request.** Package C wrote a `LineItem` citing `ordered_quantity_kg` on `PlanningService.FuelOrders`, a **restricted projection** that does not expose it, and the expand returned an error rather than a blank cell. **A missing column degrades; a missing property breaks.** Check what a restricted projection actually exposes before naming a field in an annotation against it |
| **A business key is not a join key, and the seed can prove it** | `FUEL_DELIVERIES` carries no flight key at all — `order_ID`, `aircraft_reg`, `delivery_date`. Reaching a flight goes through the order, which is **decision B2, deliberately.** The tempting shortcut is a tail-plus-date join, and **measured against the seed it over-matches on 5 of 13 tail-date pairs**: five tails already fly two sectors on one date, and each flight would list the other's fuel. **Measure the collision rate before building a join on a business key** — the shortcut looks correct on any row you happen to inspect |
| **A provenance flag and its evidence can each exist without the other, and both are wrong** | Package D found an inversion: **`AC410` claimed `closure_source = OCR` with no document**, and **`AC881` held the tech-log document with no `closure_source`.** One asserts a reading nothing supports; the other holds a photograph nothing cites. **Neither is visible from the row it is on** — each looks complete alone. **The flag should derive from the document's own state, not be typed beside it:** a confirmed read gives `OCR`, an unread document gives nothing, and no document with a value keyed by hand gives `MANUAL`. **A source flag that can disagree with its source is not provenance.** **AND THE FAILURE GOES ONE LEVEL FURTHER OUT:** `AC881`'s document is a confirmed read whose `ocr_raw` asserts a closure at 1130Z against an `aobt` of 1140Z — **a closure ten minutes before pushback, on a leg with no recorded arrival.** So the flag can disagree with its source, and **the source can disagree with the record citing it.** Same failure, equally invisible from any single row, and it survived because the text was written as demonstration prose and never checked against the schedule it described |
| **A qualified name splits at the FIRST dot, not the last** | Package D's off-service survey reported fourteen gaps and four were artifacts: it split `PlanningService.AIRCRAFT_OPSTATUS.texts` at the last dot, bucketing CAP's **generated `.texts` entities** under the wrong service. **Any instrument parsing `Service.Entity` must expect generated suffixes** — `.texts`, `.drafts`, and the localisation entities CAP creates without being asked. **Count the artifacts before reporting the gaps** |
| **A modelled association that nothing populates renders an empty section** | `FUEL_ORDERS.dispatch_plan` exists, its target is on the same service, and it was **null on all 25 orders** while `FLIGHT_DISPATCH` pointed the other way on every row. A `ReferenceFacet` on it would have shown **an empty section on every order in the system, with nothing saying why.** **Before building a facet, read the data through it** — a declaration proves the path resolves, not that anything travels it |
| **A CAP range filter with two bounds in one object applies ONE of them** | WP-34 wrote a turnaround window as `{ '>=': from, '<=': to }`. **It compiles, it runs, and it applies a single bound** — sweeping in every earlier turn for that tail and returning **201.25 kg of APU where 105 burned.** A 96 kg over-adjustment: **precisely the phantom-burn error the module exists to prevent, arriving through the query rather than the arithmetic and wearing the face of a working filter.** Use two clauses, and **assert the row count** — a filter that returns too much looks exactly like a filter that works |
| **Sweep by meaning, not by string** | Four instrument failures in three days shared one shape: a search that matched a **phrasing** rather than a **claim**. `inert` missed *"will not enforce it"*. A row-level diff missed a retraction and its contradiction seventeen lines apart. **The method that cannot miss a wording is to enumerate every mention of the subject and judge each** — 58 mentions across 12 files, read rather than matched. **And it must distinguish a live claim from the same words quoted inside its own retraction**, which a string search never can |
| **Extract, do not claim** | "I added it" and "it is there" are different sentences, and for sixteen error codes they were different for two packages. **Run an extraction as a gate**: read what the handlers emit, compare against what the taxonomy carries, and fail on any difference. The same applies to any document that mirrors code — a claim that it is current is worth less than a check that reads both. WP-21A's closure produced this one; it found nineteen undocumented codes where I had asserted zero |
| **A reserved code is reserved even in a comment** | `FB410` was taken by a `// FB410 - Jefferson load failed` line in a `.cds` file, not by anything in the taxonomy. The x450 rule exists so a new code never lands in a block somebody reserved that way. **Check occupancy across the taxonomy, the handlers AND the comment blocks before assigning** — and when a code is considered and rejected, record it where the next person will look for it |
| **Assert the match count before writing** | A scripted edit that matches nothing writes nothing and reports success. WP-18 hit this: a `try {` sat between a loop signature and the body being matched, so the replace found 0 — and a blind edit would have **shipped a half-wired import that still compiled.** The same class silently lost three entries from `00-DECISIONS.md` for several packages. **Count the matches, fail loudly on zero, and verify the result is present after writing** |
| **Some field names are wrong and stay wrong** | `FLIGHT_DISPATCH.dispatch_order_id` holds what the source calls `FUEL_ORDER_ID`, and its own comment says so. The technical name is misleading and **renaming is still prohibited** — it sits in projections, annotations and seed data. **Correct the label, not the field.** `@title` carries the right term so no user sees the wrong one, and design documents use the business term with the technical name noted once |
| **Enumerating exclusions is a filter with a delayed fuse** | WP-11's migration filter broke three times — it excluded `WP12_SEED`, then `WP17_SEED`, then `WPDEMO01_SEED`, each by name. **Every legitimate addition detonated it.** A filter that lists what to skip fails on the next thing added; one that matches the *shape* does not. Write the rule, not the roll call |
| **Seed a value at the precision the handler produces** | WP-DEMO-01 was specified at 1 dp against a `Decimal(15,2)` field. The seed would have agreed with the specification and disagreed with the handler **the first time a row was re-saved** — surfacing later as a phantom variance with no apparent cause. Derive seed figures from the same computation the code performs, at the same scale |
| **A check that reads live state goes wrong later, not when written** | The most persistent failure in this project. Recorded as a convention after WP-11 — *assert against the immutable source, never against state the test has modified* — and violated **twice afterwards** by the same author who helped write it. WP-DEMO-01 counted rows the suite had created as seeded; WP-07B counted a fixture the suite had just inserted as a seed defect. **It recurs because the check is correct when written and becomes wrong when the suite grows** — it looks right up until something starts writing to what it measures. Reading a trap does not prevent it. **When a check reads a table, ask what else in the suite writes to that table, and read the CSV instead** |
| **Prove the instrument, do not consult the list** | Reading a trap does not prevent it. WP-12 hit the `SECURITY_USERS` trap that was in this list **and had been read in the same session**. WP-02B then hit two fresh instances: scoring a 405 wrong-verb answer as "not refused", and counting action names as scopes because `{ grant: 'submit' }` puts an operation in quotes. **What worked was not consulting the list — it was running the instrument against a known-present case and a known-absent case and requiring it to distinguish them.** WP-02B's harness was proved able to fail three ways: against the pre-change file, under dummy auth, and unauthenticated. **This table is a source of examples, not a checklist that protects you** |
| **On a draft-enabled entity, guarding on `undefined` is dead code** | The CDS `default` populates the draft row, so the field is never `undefined` by the time the active instance is created. A `before CREATE` derivation guarding on it **never fires, and fails silently**. WP-10 found this: a ticket was correctly numbered while staying `UNMATCHED`, and only the pair of observations identified it. Guard on the actual value, not on its absence |
| **Relaxing a constraint is not additive** | Removing `@mandatory` makes a field nullable for readers that may never have handled null. WP-10 checked all three readers of `FUEL_DELIVERIES.order` before relaxing it — all were already null-safe. **Had one been unguarded, relaxing the constraint would have converted it into a crash.** Survey the readers before relaxing, exactly as you survey the writers before changing |
| **`@Common.Label` beats `@title` — setting both makes one dead** | WP-UI-01 set both on the same fields; `@Common.Label` wins in the EDMX, so every `@title` was inert. WP-UI-02's new labels would have been **silently overridden by WP-UI-01's own older wording**, and reading the annotation file would have shown success — both annotations present, the new one visible in source. **Use one label annotation per field.** Where a field carries both, the `@title` is decoration |
| **The CDS model and `$metadata` are different surfaces** | `cds.model.elements` holds `sales_order`; OData emits `sales_order_ID`. WP-UI-02 flagged a label as missing by looking up a name that has no annotation block at all — the label propagates to the FK property fine. Two instrument bugs in one package, both this shape. **Reading the convenient surface answers a different question.** Where the question is "what does the client see", fetch `$metadata` |
| **An annotation naming a non-existent element compiles clean** | WP-UI-01 found `Criticality: statusCriticality` on `FuelOrderService.FuelTickets` naming an element that entity does not have. **The compiler accepted it and the column rendered plain** — no error, no warning, just a silently inert annotation. `AircraftRegistrations.activeCriticality` is declared and never populated, the same shape one layer along. **Verify an annotation's targets exist; compilation does not** |
| **A test can assert what you assumed rather than what is there** | WP-UI-01 asserted that `AircraftRegistrations` had draft enablement to lose. It never had any — the expectation was invented, not read from the model. Distinct from the instrument traps above: those were the wrong tool, this was the wrong expectation. **Read the current state before writing the assertion about it**, particularly when the assertion is that something was preserved |
| **A CDS annotation binds to whatever declaration follows it** | Inserting an entity between an annotation and its target **silently reassigns the annotation**. WP-07 placed a projection between `@odata.draft.enabled` and `entity Aircraft`; `Aircraft` lost draft enablement and **`cds compile` returned 0**. Only booting the service caught it. Never insert into a file without checking what precedes the insertion point |
| **A clean compile is necessary, not sufficient** | The exit-code rule from WP-08 holds, with a rider: exit 0 from `cds compile` does not mean the model is correct. Annotation rebinding, and anything else resolved at runtime, passes compilation. **Boot the service as part of verification** |
| **Direct INSERT bypasses `before CREATE`** | Twice now, a handler-level change covered only one of several paths. WP-04 found nine number-generation sites across five services; WP-07 found four order-creation paths, three of them writing directly. **A guard in `before CREATE` is not a guard on the entity.** Survey the writers, not the handler |
| **Two governing documents can disagree** | WP-07's entry made the string-to-association migration its first exit criterion; `01-TARGET-SCHEMA.md` §2 excluded it by name. The rule is the same as for source: **stop and ask.** Where they conflict, the more specific and more recently written document governs, but say so explicitly rather than choosing silently — and amend the loser so the conflict does not recur |
| **A defect can live in a pair, not a file** | WP-09 found `PlanningService` writing `'Draft'` while `submit` required `'Created'` — every order auto-created from a flight schedule was permanently unsubmittable. Neither file was wrong on its own. **Read the writer and the reader together** |
| **Authorisation is not exercised locally** | Dev auth is `kind: 'dummy'` — every request is privileged and `@restrict` is never evaluated. A change to authorisation that passes locally has proven nothing. Override to `kind: 'mocked'`, supplying the users map in the same override, or the existing users are discarded and everything returns 403 |
| **A DateTime field cannot carry an ETag** | `@odata.etag` on a DateTime rejects every conditional request with 412, including a token CAP just issued. An Integer carrier works. Measured under WP-04 |
| **`@odata.etag` makes `If-Match` mandatory** | Not additive. Every unconditional update becomes 428. Adding it breaks `draftActivate` and every existing client |
| **Survey before fixing a distributed defect** | **Four packages, four times the stated scope was wrong.** WP-02: authorisation covered 4 of 15 services. WP-04: nine number-generation sites where three were named. WP-06: two of three named enum violations did not exist, and a sweep found fifteen that did. WP-08: three projection collisions where one was named, plus three associations on **retained** entities pointing into the family being deleted — which would have broken the build. WP-09: a named item that was not there at all — `RETURNED` exists only in a code comment, not in schema, code or data. **Treat the stated scope as a starting point, never a boundary — and never as confirmation that what it names exists** |
| **A grant on an entity does not cover its bound actions** | CAP matches a bound action against the entity's `@restrict` looking for a grant naming that action. READ/CREATE/UPDATE/DELETE do not imply it. Eleven bound actions are currently denied under real auth for this reason — D22 |
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

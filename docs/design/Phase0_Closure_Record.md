# Phase 0 — Closure Record

**FuelSphere merge, safety and correctness phase**
16 August 2026

---

## 1. Outcome

Six work packages. Five merged, one closed as already-satisfied.

| WP | Package | Result |
|---|---|---|
| 01 | Master sync transaction | **Closed, no code.** Premise disproved by measurement |
| 03 | ROB formula and re-derivation | Merged. PR #30 |
| 05 | Large-order guard | Merged. PR #31 |
| 02 | Authorisation hole | Merged. PR #32 |
| 04 | Numbering and concurrency | Merged. PR #33 — numbering delivered, ETag withdrawn |
| 06 | Seed data | Merged. PR #34 |

### Defects closed

| # | Defect |
|---|---|
| D2 | 93 `'any'` grants — RBAC effectively disabled |
| D3 | ROB formula dropped uplift and clamped negatives |
| D4 | Non-atomic `max + 1` numbering |
| D13 | `captureSignatures` reached Delivered from any state |
| D15 | `recalculateROB` unimplemented |
| D16 | 100,000 guard blocked legitimate widebody orders |
| D17 | `'XXX'` station fallback |

### Defects withdrawn

**D1 — master sync transaction wrapper.** Measurement showed CAP's ambient request transaction already makes delete and insert atomic. The commented-out wrapper was redundant, and restoring it silently discards writes while returning HTTP 200 with a success payload. Nine of nine scenarios passed on unmodified code.

### Defects still open

D5 optimistic locking · D11 no aircraft register · D14 no row-level security · D19 `S2A` destination unprovisioned · D20 malformed S/4 response reported as zero records · D21 `aircraft_ID` written to a non-existent element · D22 eleven bound actions denied under real auth · D23 two implemented services with no authorisation · D24 three dead seed CSVs

---

## 2. What the phase actually found

Every package but one found the defect list understated the problem.

| Package | Stated | Found |
|---|---|---|
| WP-01 | Data-loss risk from a missing transaction | No defect. The framework already provided it |
| WP-02 | Fix `authorization.cds` | `authorization.cds` covers **4 of 15 services**. Two implemented services have no authorisation of any kind |
| WP-04 | Three number-generation sites | **Nine sites across five services.** Fixing only the named three would have left cross-service duplicates possible |
| WP-06 | Three enum violations | Two were not violations. A sweep of all 380 enum-typed values found **15 genuine defects nobody had listed** |

**The pattern: named defects were frequently wrong or incomplete; unnamed ones were real.** The as-built documentation was accurate about what it observed and unreliable about what it inferred.

This matters for Phase 1, where the packages are larger and a partial fix on a distributed defect will look complete.

---

## 3. Three findings that would have surfaced on deployment

**D22 — eleven bound actions denied under real authorisation.** CAP matches a bound action against the entity's `@restrict` looking for a grant naming that action. Entity-level CRUD grants do not imply it. Every one of the eleven is currently refused, including for a user holding every scope. **Masked locally because dev auth is `kind: 'dummy'`, which authorises everything as privileged and never evaluates `@restrict`** — one defect concealing another. Now WP-02B.

**D19 — the `S2A` destination is used by code and provisioned nowhere.** `mta.yaml` declares `S4HC_TECHNICAL` and `S4HC_USER`; neither is referenced by code. Master data sync fails on a fresh deployment.

**A DateTime field cannot carry an ETag in this stack.** `@odata.etag` on `modified_at` rejects every conditional request with 412, including a token CAP itself issued moments earlier. Isolated by testing an Integer carrier, which works, and `created_at`, which is never auto-updated and still fails. Separately, `@odata.etag` makes `If-Match` **mandatory** — a breaking change for every existing client, not an enhancement.

---

## 4. Test coverage — the number for Phase 1 planning

**26 of the design workbook's 157 scenarios are seedable against the current schema.** The remaining 131 need entities that do not exist, verified against the compiled model.

| Blocked by | Scenarios unblocked |
|---|---|
| **Staging** | **26** |
| Posting determination | 16 |
| Carrier arrangement | 15 |
| APU | 13 |
| Pricing | 12 |

**Staging unblocks more test coverage than any other single package.** That was not visible before WP-06 and is worth weighing in the Phase 1 sequence, which currently places staging at WP-15.

---

## 5. Method notes worth carrying forward

**Every package built a harness driving real HTTP endpoints through `cds.test`, held outside the repository.** No test file was added to the repo. Several harnesses caught errors that reading would not have:

- WP-01's first failure injection was invalid — `MASTER_SUPPLIERS` is `cuid`, so a duplicate business key raises nothing and the "failure" was a successful replace
- WP-03's first `recalculateROB` wiped `INITIAL` seed balances by recomputing them from zero components
- WP-03's first adjustment test proved nothing, because at that balance the clamp gave the same answer
- WP-04's ETag investigation isolated the carrier by substitution rather than inferring from the symptom

**Two packages guarded against passing vacuously** — asserting that the operation under test actually occurred, not merely that nothing broke. WP-01 asserted a DELETE was observed on the happy path, so a blind observer could not make the abort cases pass. WP-06 asserted the seed supplied the setup, so the FB402 test could not pass by building its own fixture.

**Caveat carried by three packages:** all measurement ran on sqlite. CAP's transaction management is driver-independent, but no HANA instance was available. Row-locking behaviour under a true concurrent race is unconfirmed.

---

## 6. Open points raised during the phase

| # | Item | Trigger |
|---|---|---|
| F11 | Fuel ledger chain recovery — how a restart after a break is represented | Ledger closure design |
| F12 | Master data sync — upsert instead of full replace. **High priority** | Before further master data work |
| F13 | Master data sync safety outside a request context | Before any scheduler is added |
| F14 | Durable sink for ledger chain-break exceptions | Phase 1, with F15 |
| F15 | No ePOD delivery reaches the fuel ledger | Phase 1, with F14 |
| F16 | Validation guards should flag, not early-return | WP-13 |

**F14 and F15 compound.** An uplift that never reaches the chain produces exactly the negative balance the corrected formula is designed to surface — and there is nowhere for the alarm to land. The detector has a blind input and no output. They belong in one package.

---

## 7. What Phase 1 needs before it can start

`01-TARGET-SCHEMA.md`, `02-BEHAVIOUR.md` and `03-VALIDATION-RULES.md` are placeholders. Every package from WP-07 onward depends on them.

Phase 0 worked without them because each package was *"this line is wrong, here is the correct formula"*. Phase 1 begins with the aircraft register, which requires an agreed entity shape — and without one, the shape gets designed in the schema before anyone reviews it.

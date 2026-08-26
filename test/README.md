# The regression harnesses

One harness per work package. Each asserts that package's exit criteria against
a booted service and real data, and each is named for the package it belongs to.

```bash
npm test                          # all of them
./test/run-harnesses.sh wp18 d44  # only the ones whose names match
```

`npm test` pointed at `jest` for the life of the project, and jest was never
installed — so the project's own test command had never run. It runs these now.

---

## Read this before running them any other way

**One process per harness. This is not a preference.**

Every harness calls `cds.test()`, which boots a server and binds a port. Run as
a single `mocha test/harness/` invocation they collide, and the suite reports
around **88 failures that are interference, not regressions** — each one passes
clean when run alone.

**Anyone running these as one batch will conclude the build is broken.** That is
the single most likely way to misread this directory, which is why the runner
exists and why this paragraph is near the top.

`run-harnesses.sh` exits with the **number of harnesses that failed** (and `127`
where a filter matched nothing — that must be distinguishable from one failure), so a
caller can key on the exit code rather than parse the output.

---

## The suite is currently RED, and deliberately so

```
wp05-harness   EXIT-2b, EXIT-2c   FAILING
```

That is **D39**, recorded in `CLAUDE.md`. WP-05's exit criteria stopped holding
at some point after it merged, and the failure reproduces identically on
unmodified `main` — it is not caused by any branch in flight.

**Do not skip these, mark them pending, or delete them to get green.** A failing
test naming an open defect is worth more than a defect row nobody reads; D39 is
remembered precisely because the suite reports it on every run. A green suite
that hides a known defect is the thing most of `05-CONVENTIONS.md` warns about.

Everything else passes. If a second harness goes red, that is a regression and
it is new.

---

## What these are for

They are not unit tests. Each one demonstrates a package's claim end to end —
booting the service, exercising the real handler or import, and asserting
against seeded data. What they have caught, none of which a unit test would
have:

- **pinned fixtures** — three harnesses asserting S1's figures, which moved the
  moment S1 was corrected
- **an inverted invariant** — `wp07` and `wp07b` asserting that
  `ACCEPT_PROVISIONAL` had never fired, which is the *absence* of a designed
  behaviour, undetected for two packages
- **dead UI bindings** — annotation targets naming field groups that do not exist
- **an arbitrary `Map`** — a flight lookup resolving by insertion order

## Conventions they follow

- **Assert the relationship, never today's answer.** A test that pins the
  current number moves every time the number is corrected; one that asserts the
  property does not. `wp18 EXIT-1b` searches for a qualifying row rather than
  naming a flight, and `demo01` derives its tolerance rather than hardcoding it.
- **Prove the instrument before trusting it.** A search that finds nothing and a
  search that is broken look identical. `wp31-census.sh` proves itself against a
  known-present field, a known-absent one, and a planted comment pair, and
  refuses to report if any of the three fails.
- **Key on exit codes, not on greps**, wherever a command can provide one.
- **Both halves, where the claim is causal.** `s6 EXIT-3` shows an order refused
  on a provisional tail; `EXIT-6` shows the same call succeeding on a confirmed
  one. The first alone proves only that *something* refused.

## Files

| | |
|---|---|
| `harness/*-harness.js` | one per package |
| `harness/code-gate.js` | every error code emitted by `srv/` is documented in `03-VALIDATION-RULES.md`. Invoked by `wp13` |
| `harness/wp31-census.sh` | counts code references to removed fields, excluding comments. Invoked by `wp31` |
| `run-harnesses.sh` | the runner |
| `.logs/` | per-harness output, gitignored |

Harnesses derive the repository root from their own location. They ran outside
the repository for the project's first weeks and carried absolute paths; if you
add one, do not reintroduce those.

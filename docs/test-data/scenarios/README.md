# Demo scenario seed — JetBlue (B6) and TAP (TP)

Two workbooks, one per airline, covering the 17 demo scenarios with three references each.
**Loaded into `db/data`** on 27 Oct 2026; see Load below.

| Workbook | What it is |
|---|---|
| `JetBlue_B6_Scenario_Seed_2026-09-24_to_26.xlsx` | A **diff** over the JetBlue seed already in `db/data`: `ADD_<ENTITY>` sheets, an `UPDATES` sheet (entity, ID, column, current → new), and `PROPOSED_*` sheets |
| `TAP_TP_Scenario_Seed_2026-10-20_to_22.xlsx` | **Every TP row**: the uploaded schedule and dispatch, plus carrier, suppliers, contracts, station maps, orders, deliveries, tickets, fuel and into-plane invoices, and the scenario rows |

Start with each workbook's `Scenario_Index`, then `Findings`.

## Regenerate

```bash
node tools/scenario-seed/model-columns.js /tmp/cols.json
FS_COLS_JSON=/tmp/cols.json python3 tools/scenario-seed/build.py <TAP upload .xlsx> docs/test-data/scenarios
```

The build fails on any column that is not a CDS element, an empty mandatory field, an illegal enum value,
a dangling foreign key, an ID or number that collides with `db/data` or within the workbook, or an invoice
header that does not equal its lines.

## Load — done 27 Oct 2026, in this order

```bash
python3 tools/backfill-carrier-units.py            # carrier currency/units, contract units, carrier_code on existing rows
python3 tools/scenario-seed/apply.py docs/test-data/scenarios/JetBlue_B6_Scenario_Seed_2026-09-24_to_26.xlsx db/data db/data
python3 tools/scenario-seed/apply.py docs/test-data/scenarios/TAP_TP_Scenario_Seed_2026-10-20_to_22.xlsx db/data db/data
python3 tools/backfill-carrier-units.py            # idempotent; fills nothing the workbooks already carry
```

JetBlue first. `PROPOSED_*` sheets are never loaded: they need the schema in `Proposed_Schema`.

**The ledger tools are NOT re-run for JetBlue, deliberately.** JetBlue's ROB ledger, burns and
valuation were built before its scenarios existed, so they carry each uplift exactly once.
Rebuilding them from the scenario-edited tickets would post the scenario-15 duplicates (N4064J
16,826 kg -> 33,653 kg) and drop the uplifts scenarios 8 and 14 detach (N3162J to -380 kg).
TAP's ledger rows ship in its workbook, derived the same way: from the TAP data before the scenarios.

**`tools/seed-idr-rule-status.js` IS run, after both workbooks.** It validates every invoice
**in arrival order where a duplicate came later** (`tools/lib/arrival-order.js`): each scenario-16
original is validated with its later duplicate out of the database, as it was when it arrived, so it
stays CLEAR and the duplicate is GATED. A plain run would gate both, because INV473 and INV455 are
symmetric (Finding F6). The tool writes the verdicts, the exceptions, the invoice counters, and the
resolution of every line the seed had not yet resolved.

```bash
node tools/seed-idr-rule-status.js --write
```

**Nothing in the seed is posted to S/4.** The PO/GR step and the invoice step call S/4 for real, so
a seeded document number would claim a posting that never happened. The scenario-16 originals are
`VERIFIED`, gate `CLEAR`, approved: **posting pending**. The scenario-7 tickets were captured after the
close and carry no posting fields; posting them is part of the demo.

## Measured, not assumed

Both workbooks were merged into a scratch copy of the project, the service booted on it, and
`validateForPosting` / `derivePrice` / the reconciliation were run against every scenario invoice.
The `Expected system result` column is what that run returned, including two defects it exposed
(Findings F1 and F12).

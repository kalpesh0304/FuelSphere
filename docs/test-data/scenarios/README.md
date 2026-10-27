# Demo scenario seed — JetBlue (B6) and TAP (TP)

Two workbooks, one per airline, covering the 17 demo scenarios with three references each.
**Not loaded.** Nothing in `db/data` was changed.

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

## Load (when decided)

```bash
python3 tools/scenario-seed/apply.py docs/test-data/scenarios/JetBlue_B6_Scenario_Seed_2026-09-24_to_26.xlsx db/data db/data
python3 tools/scenario-seed/apply.py docs/test-data/scenarios/TAP_TP_Scenario_Seed_2026-10-20_to_22.xlsx db/data db/data
```

JetBlue first. `PROPOSED_*` sheets are never loaded: they need the schema in `Proposed_Schema`.
Then run `tools/seed-burns-and-ledger.js`, `tools/seed-fifo-valuation.js`, `tools/seed-idr-rule-status.js`
and the harness suite, one process per harness.

## Measured, not assumed

Both workbooks were merged into a scratch copy of the project, the service booted on it, and
`validateForPosting` / `derivePrice` / the reconciliation were run against every scenario invoice.
The `Expected system result` column is what that run returned, including two defects it exposed
(Findings F1 and F12).

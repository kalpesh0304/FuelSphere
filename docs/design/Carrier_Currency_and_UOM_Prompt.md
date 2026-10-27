# Prompt: carrier currency and carrier units of measure

> Paste everything below the line into a Claude Code session on this repository.
> Written 27 Oct 2026 from a review session; every file and line reference was measured then.

---

## Goal

Every carrier keeps its fuel records in **its own currency, volume unit and mass unit**. Today the
screens assume USD, litres and kilograms. Make the carrier's settings drive what is stored, converted
and displayed.

Read `CLAUDE.md` first, in particular sections 12 and 13. Commit **schema changes separately** from
behaviour changes. Do **not** rename any existing element: the `*_usd` columns are embedded in 185
projections and the seed files.

## Decisions already taken (do not reopen)

1. **The carrier's currency is the company code's currency.** No FX conversion: a carrier buys in the
   currency its ledger is kept in. (B6 USD, B7 USD, TP EUR, AC CAD.)
2. **Tickets and invoices arrive in the CONTRACT's unit of measure**, because the vendor issues them.
   That quantity is kept exactly as captured. It is then **converted to the carrier's units** for every
   comparison and every display.
3. The litre ↔ US gallon ratio is an **exact** fact (1 USG = 3.785411784 L) and must live as **its own
   master-data value**, not as a constant in code and not derived from `conversion_to_kg`.
4. Mass ↔ volume conversion uses the **measured density on the ticket** (`density_value`, KGL), never an
   assumed one. Where the density is missing, the converted value is **null, not 0** (CLAUDE.md §13).

Values to seed (confirm with the business before loading; mark anything unconfirmed as PLACEHOLDER
in `notes`):

| Carrier | Currency | Volume UOM | Mass UOM |
|---|---|---|---|
| B6, B7 | USD | USG | LB |
| TP | EUR | LTR | KG |
| AC | CAD | LTR | KG |

## What exists today (measured)

- `CARRIER_MASTER` (`db/mapping-tables.cds`) has `company_code` and tolerances, and **no currency or
  unit fields**.
- `MASTER_CONTRACTS` has `currency_code` and **no unit of measure**. `CONTRACT_PRODUCTS` has none
  either.
- `UNIT_OF_MEASURE` has `conversion_to_kg` only. On GAL and USG it holds **kilograms per gallon at an
  assumed density** (3.028329), not a volume ratio. `srv/lib/fuel-uom.js:135-227` therefore refuses
  gallons ("no litre factor … see open point F19"). There is no LB row.
- **USD is hard-coded** in:
  - `srv/reconciliation-service.js:468, 567, 640`: `currency_code: 'USD'` on every row.
  - About 50 labels in `srv/burn-fiori-annotations.cds` and `srv/valuation-fiori-annotations.cds`,
    such as "Value USD", "MAP USD/kg" and "Rate USD/L", over columns named `value_usd`,
    `map_usd_per_kg`, `rate_usd_per_kg` and so on.
  - Fallbacks `|| 'USD'` in `srv/order-service.js:1146`, `srv/invoice-service.js:548` and
    `srv/lib/ticket-measurement.js:95`.
- **Kilograms and litres are hard-coded** across ten annotation files: delivery, order, ticket,
  invoice, burn, valuation, reconciliation, planning, pricing and aircraft-registration
  (`*-fiori-annotations.cds`). For example, `quantity_kg`, `fob_*_kg`, `ordered_quantity_kg` and the
  ledger's `*_kg` columns are all labelled kg.
- The ledger tools value each uplift at the ticket's own amount, so `value_usd` already holds the
  **ticket's** currency. With the decision above (one currency per carrier) it is correct once the
  label shows the carrier's currency.

## Work

### Schema (one commit)

- `CARRIER_MASTER`: `currency_code` (String(3)), `volume_uom_code` and `mass_uom_code` (String(3)),
  extended in `db/mapping-tables.cds`.
- `MASTER_CONTRACTS`: `uom_code` (String(3)), the unit the vendor prices and tickets in.
- `UNIT_OF_MEASURE`: `conversion_to_ltr` (Decimal), the volume ratio. LTR 1, USG and GAL 3.785411784.
  Add an LB row (`uom_category` MASS, `conversion_to_kg` 0.45359237, `sap_uom` LB). Leave the existing
  `conversion_to_kg` values on GAL and USG where they are: removing them breaks existing readers.
- On tickets, deliveries, invoice lines and orders, add **carrier-unit** quantities beside the captured
  ones, for example `quantity_carrier_vol` and `quantity_carrier_mass`. Choose the names, but follow
  the `lower_snake_case` convention and say in a comment which unit they are in (the carrier's). Store
  them if any of them is filtered or sorted on. CLAUDE.md D52: a virtual element cannot be `$filter`ed.

### Behaviour (separate commits)

1. **Conversion library.** Extend `srv/lib/fuel-uom.js`: volume ↔ volume through `conversion_to_ltr`;
   mass ↔ mass through `conversion_to_kg` on MASS rows only; volume ↔ mass through the ticket's
   density. Every conversion returns `{ value, factor, source }` or null with a reason, and records
   which UOM row produced it (CLAUDE.md §13: record which configuration row produced a resolved value).
   Assign an error code for a missing factor from section 8. **Measure the prefix before choosing a code.**
2. **Capture.** A ticket's quantity and UOM default from its contract's `uom_code`. The carrier-unit
   columns are derived at save.
3. **Invoice checks.** `srv/lib/invoice-checks.js` INV451, INV467 and INV468 compare quantities. They
   must compare **like with like**: line, ticket, GR and order all converted to the carrier's volume
   unit. INV468 (UOM mismatch) should then fire only where **no conversion exists**, not wherever two
   units merely differ.
4. **Currency.** Reconciliation returns the carrier's `currency_code`. Fallbacks default to the
   carrier's currency, resolved via the station or contract, not `'USD'`.
5. **Screens.** Every value column carries `@Measures.ISOCurrency` and every quantity `@Measures.Unit`,
   pointing at the carrier's code. Labels drop the literal "USD", "kg" and "L". It takes a **path**:
   `@Measures.ISOCurrency: invoice.currency_code` emits `Path="invoice/currency_code"`, and every hop
   must be to-ONE (the `units-harness` row in CLAUDE.md §12). The ledger rows (`ROB_LEDGER`,
   `FUEL_STOCK_*`, `FUEL_BURN_HEADER`) need a path to the carrier. `FUEL_STOCK_MOVEMENT_LEDGER`
   already has `carrier_code`, but `ROB_LEDGER` has none. Decide and write down how a ledger row
   reaches its carrier (a stored `carrier_code` written by `srv/lib/rob-uplift.js` and the seed tools
   is the simplest).
6. **Mass on the ledger.** `ROB_LEDGER` and valuation hold kilograms. Display in the carrier's mass
   unit (LB for B6). Keep storing kg. Converting the stored figures would change every replay in
   `srv/lib/rob-recalculate.js`.

### Seed

- Fill the new columns on `CARRIER_MASTER`, `MASTER_CONTRACTS` (`uom_code` LTR on every existing
  contract: they all price per litre today) and `UNIT_OF_MEASURE`.
- The TAP scenario workbook (`docs/test-data/scenarios/`) is all EUR, so TP rows need no currency change.

## Acceptance

- A B6 ticket captured in LTR shows its USG and LB figures; a TP ticket shows LTR and KG; the captured
  quantity is unchanged.
- An invoice line in LTR against a GR in USG passes INV451 when the converted quantities agree within
  tolerance, and INV468 does not fire.
- A ticket with no density shows null carrier mass, and the screen says why.
- The reconciliation for TP reports EUR. No screen label contains a literal currency or unit.
- A harness asserts each of the above in **both directions**: a plant that breaks the conversion makes
  it fail. Its rules must come from somewhere other than the code (CLAUDE.md §13), e.g. the exact
  3.785411784 and 0.45359237 constants and a hand-computed ticket.
- `cds compile srv` **and** a service boot both succeed (CLAUDE.md §12: they disagree). The harness
  suite passes one process per harness (`test/run-harnesses.sh`). Compare against a run on the
  pre-change tree, because some harnesses already fail on `main` (`into-plane-agent` EXIT-9 times out).

## Stop and ask if

- The business units differ from the table above.
- A screen needs a carrier but its row has no path to one.
- Any change would alter a stored kg or currency value rather than add a converted one beside it.

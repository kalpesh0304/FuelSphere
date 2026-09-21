# Invoice Views — Work Packages

**FuelSphere — WP-35 to WP-39**

Three views and one workflow, from the invoicing requirements of 21 Sep 2026.

| View | Entity | Floorplan |
|---|---|---|
| Invoice header list | `InvoiceService.Invoices` | List Report |
| Invoice line item list | `InvoiceService.InvoiceItems` | List Report |
| Invoice detail | `InvoiceService.Invoices` | Object Page |

Both lists drill down to the detail view. Schema commits separately from
behaviour, per the rule in `04-WORK-PACKAGES.md`, which is why WP-35 exists
rather than being folded into the two list packages.

---

## Read this first — three findings that shape the sequence

**1. An invoice has no flight.** `INVOICES` carries no flight reference of any
kind. Five requested header columns and five line columns are flight
attributes, and each is reached the long way round:
`INVOICES -> items -> ticket -> flight`. That chain breaks wherever a line did
not resolve to a ticket — `resolution_source` already records `UNRESOLVED` —
so these columns are blank on exactly the invoices most worth looking at.
A flight-keyed invoice is a schema decision, not a UI task.

**2. Every ticket-side figure is new.** Amount, Rate and Qty "(ticket)" appear
on both views. Nothing on `INVOICE_ITEMS` holds them: the entity carries the
invoice side and a pointer to the ticket, never the ticket own numbers. Six
header columns and three line columns depend on this.

**3. The quantities are in different units and the comparison is unguarded.**
Invoice quantity is in `INVOICE_ITEMS.uom_code`; the ticket mass is
`quantity_kg` and its metered figure is in the ticket own unit. Subtracting
one from the other without normalising produces a variance that looks
plausible and means nothing. This is the same defect class already fixed in
`srv/lib/flight-variance.js` — fix it the same way, in kilograms, once.

---

## WP-35 · Invoice flight, settlement and ticket-side fields

**Entry:** a decision on finding 1 — is the flight resolved per invoice, per
line, or both (see Q1).

**Scope:** Schema only. Add to `INVOICES`: `received_date`,
`sap_invoice_number`, `s4_payment_document`, `payment_date`. Add to
`INVOICE_ITEMS`: `sap_line_number`, and the ticket-side trio
`ticket_quantity_kg`, `ticket_rate`, `ticket_amount`, populated at match time
from the resolved ticket. Add the flight reference agreed under Entry. Extend
`InvoiceStatus` to carry In process / Posted / Paid. Add `tolerance_status`
(within / exceeded) as a measurement verdict, separate from review state.

**Out of scope:** The views. Workflow. Backfilling history.

**Exit:**
- `cds compile srv --to csn` clean
- Every column in the WP-36 and WP-37 tables resolves to an element or a
  documented derivation — none left undecided
- A ticket-side figure is written by the matcher, never typed on a screen

---

## WP-36 · Invoice header list view

**Entry:** WP-35

**Scope:** `SelectionFields` for the eight filters. `LineItem` for the
twenty-four columns. Derived aggregates over `items`: line counts, reconciled
and unreconciled counts, invoice and ticket totals, both weighted average
rates, and the value variance. Tolerance verdict resolved through
`TOLERANCE_RULES`, not a literal.

**Out of scope:** Line item view. Workflow buttons.

**Exit:**
- Twenty-four columns render; none blank on a fully matched invoice
- Reconciled + unreconciled = total lines, on every row
- Weighted average rate reconciles to total amount / total qty to 4 dp
- An invoice with no resolved ticket reads blank, never zero

---

## WP-37 · Invoice line item list view

**Entry:** WP-35

**Scope:** `SelectionFields` for the eight filters. `LineItem` for the
twenty-six columns. Per-line absolute variances (total, quantity, price)
beside the existing percentages. Tolerance column — see Q2 before building it.

**Out of scope:** Create or edit. Lines are received, never entered.

**Exit:**
- Twenty-six columns render
- Quantity variance is stated in one unit, and the unit is on the label
- `price_variance_pct` and the new absolute value agree in sign on every row
- No Create button on the list

---

## WP-38 · Invoice detail view and drill-down

**Entry:** WP-36, WP-37

**Scope:** Object Page on `Invoices`, reached from both lists. Items as a
table section, Exceptions as a second section. Header facets for settlement
(SAP document, payment document, payment date) and for the variance summary.

**Out of scope:** Editing the invoice. Posting.

**Exit:**
- Drill-down works from both lists and returns to the list it came from
- The detail totals equal the header list totals, read from one derivation
- A line drilled from the line list opens its parent invoice with that line
  in view

---

## WP-39 · Tolerance review workflow and supplier dispute — buttons only

**Entry:** WP-38

**Scope:** Two buttons, enabled only where tolerance is exceeded: **Create
review workflow** and **Create note to supplier**. Routing recorded, not
executed: quantity variance to reviewer 1, price variance to reviewer 2.

**Out of scope, at the customer instruction:** the workflow engine itself, the
routing, and the supplier communication. Buttons only, not to be fully
developed at this point.

**Exit:**
- Both buttons are disabled where tolerance is within
- Pressing either records who it would route to, and changes no invoice state
- No workflow is triggered

---

## Field mapping

`E` exists · `D` derive from existing data · `N` new field (WP-35)

### Header list view — 24 columns

| # | Column | Source | |
|---|---|---|---|
| 1 | Flight number | items -> ticket -> flight | D |
| 2 | Flight date | items -> ticket -> flight | D |
| 3 | Departure airport | flight.origin_airport | D |
| 4 | Arrival airport | flight.destination_airport | D |
| 5 | Flight status | flight.status | D |
| 6 | Vendor invoice number | `invoice_number` | E |
| 7 | SAP invoice number | `sap_invoice_number` | N |
| 8 | Invoice status | `status`, enum extended | N |
| 9 | Invoice received date | `received_date` | N |
| 10 | SAP document number | `s4_document_number` | E |
| 11 | Invoice posting date | `posting_date` | E |
| 12 | SAP payment document number | `s4_payment_document` | N |
| 13 | Payment date | `payment_date` | N |
| 14 | Total invoice lines | count(items) | D |
| 15 | Lines reconciled to tickets | count(items, ticket set) | D |
| 16 | Unreconciled lines | count(items, ticket null) | D |
| 17 | Total amount (invoice) | `net_amount` | E |
| 18 | Wgt avg rate (invoice) | sum(qty x rate) / sum(qty) | D |
| 19 | Total qty (invoice) | sum(items.quantity) | D |
| 20 | Wgt avg rate (ticket) | sum over resolved tickets | D |
| 21 | Total qty (ticket) | sum(ticket_quantity_kg) | D |
| 22 | Total amount (ticket) | sum(ticket_amount) | D |
| 23 | Variance, value | invoice amount less ticket amount | D |
| 24 | Tolerance check status | vs `TOLERANCE_RULES` | D |

**Filters (8):** flight number, flight date, flight status, departure airport,
vendor invoice number, SAP invoice number, supplier, invoice status.
Six of the eight are new or derived, so the filter bar cannot ship before
WP-35.

### Line item list view — 26 columns

Columns 1-6 and 8-16 as above. Additionally:

| Column | Source | |
|---|---|---|
| Vendor line item number | `line_number` | E |
| SAP line item number | `sap_line_number` | N |
| Fuel ticket number | `ticket_number` | E |
| Amount (invoice) | `net_amount` | E |
| Rate (invoice) | `unit_price` | E |
| Qty (invoice) | `quantity` | E |
| Amount (ticket) | `ticket_amount` | N |
| Rate (ticket) | `ticket_rate` | N |
| Qty (ticket) | `ticket_quantity_kg` | N |
| Total variance | invoice less ticket amount | D |
| Qty variance | absolute, beside `qty_variance_pct` | D |
| Price variance | absolute, beside `price_variance_pct` | D |
| Tolerance check status | see Q2 | D |

**Filters (8):** as the header view.

---

## Open questions

**Q1 — Is the flight on the invoice, or only on the line?** A supplier invoice
can span several flights. If the header carries one flight, the model breaks
on the first multi-flight invoice; if it carries none, the five header flight
columns have no single value to show.
*Recommendation: flight on the LINE. The header shows it where all lines
agree and blank otherwise.*

**Q2 — The four-state tolerance column mixes two axes.** "Exceeds tolerance"
and "Within tolerance" are measurement verdicts. "Exceeded - reviewing" and
"Dispute raised to supplier" are workflow states. As one column you cannot
express *exceeded and not yet picked up*, and the verdict is overwritten the
moment someone starts reviewing, so the measurement is lost.
*Recommendation: `tolerance_status` (within / exceeded) and `review_status`
(none / reviewing / disputed) as two fields. Merge them for display if the
screen wants one column.*

**Q3 — Which unit does Qty variance report?** Invoice quantity is in the line
`uom_code`, usually litres; the comparable ticket figure is kilograms.
*Recommendation: kilograms on both sides, stated on the label, same rule as
`srv/lib/flight-variance.js`.*

**Q4 — What is the ticket rate per?** `FUEL_TICKETS.rate_per_litre` is per
litre; a weighted average rate per kilogram is a different number. State the
basis on both rate columns.

**Q5 — "Det airport" is read as Departure airport** throughout, since arrival
airport is listed separately. Confirm.

**Q6 — Total amount: net or gross?** `INVOICES` holds both. The ticket side
carries no tax, so comparing gross against ticket value builds tax into the
variance.
*Recommendation: net.*

---

## Effort

| WP | Package | Estimate |
|---|---|---|
| WP-35 | Schema — flight, settlement, ticket-side | 1-2 d |
| WP-36 | Header list view | 1-2 d |
| WP-37 | Line item list view | 1 d |
| WP-38 | Detail view and drill-down | 1 d |
| WP-39 | Workflow and dispute buttons | 0.5 d |

Roughly **5-7 days**, assuming Q1 is answered before WP-35 starts. The
annotation layer for `Invoices`, `InvoiceItems` and `InvoiceExceptions`
already exists (LineItem, SelectionFields, Facets, FieldGroups, HeaderInfo),
so the cost is the new fields and the derivations, not the screens.

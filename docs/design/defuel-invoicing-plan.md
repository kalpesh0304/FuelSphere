# Defuel charges and expected credits in invoicing — plan

**Status: PLAN ONLY. Nothing below is built.** Requested 27 Oct 2026, alongside the
defueling corrections that *were* built the same day.

Two asks:

1. Defuel charges should be matchable against an invoice.
2. Invoicing should have a tab showing expected credits from a vendor.

They look like one feature and are not. The first is **money the airline OWES** — a
handling charge on an invoice, matched like any other line. The second is **money the
airline is OWED** — a credit the vendor should return for fuel handed back. They flow in
opposite directions, and building them as one thing is how a credit ends up reducing a
payable by accident.

---

## What exists today

`INVOICE_ITEMS` already resolves a line to the thing it is billing for:

```cds
delivery   : Association to FUEL_DELIVERIES;   // the ePOD / goods receipt
fuel_order : Association to FUEL_ORDERS;       // the order
ticket     : Association to FUEL_TICKETS;      // what it resolved to, if anything
```

plus `match_status` and `resolution_source`, which the invoice screens already colour. The
reconciliation engine fires `INV4xx` exceptions when a line disagrees with what it
resolved to.

On the defuel side, after 27 Oct a `DEFUEL` carries `defuel_charges_usd`, `taxes_usd`,
`fuel_value_usd`, `expected_credit_usd`, `write_off_usd`, a `supplier` (the defuelling
agent) and a status of `PARKED` / `POSTING_PENDING` / `POSTED` / `REVERSED`.

So both sides exist. Nothing joins them.

---

## Part 1 — matching defuel charges against an invoice

### The shape

A defuelling agent invoices for the work: pump time, truck, disposal. That is an ordinary
payable line and should match the way a fuel line does.

**One new association on the invoice line:**

```cds
defuel : Association to DEFUEL;   // what this charge was for, if anything
```

beside `delivery`, `fuel_order` and `ticket`. Not instead of them — a single invoice
routinely carries both uplift lines and defuel lines, and a line that resolved to a defuel
is a different fact from one that resolved to a ticket.

### How a line finds its defuel

Same ladder the ticket resolver already uses, in this order:

| Rung | Match on | Confidence |
|---|---|---|
| 1 | the defuel number quoted on the line (`DFL-JFK-202609-000001`) | exact |
| 2 | vendor + station + date + amount within tolerance | strong |
| 3 | vendor + station + date, amount outside tolerance | matched, exception raised |
| 4 | nothing | unresolved, exception raised |

Rung 3 is the one that matters: a charge that clearly belongs to a defuel but bills the
wrong amount should **match and raise**, not fail to match. A line that does not resolve
tells the user nothing about why.

### Validations (new `INV` codes, registered in CLAUDE.md §8 before any code)

- charge billed against a **reversed** defuel
- charge billed **twice** against the same defuel — cumulative, like `DFL401` was: the
  message must say what was already billed
- billed amount differs from `defuel_charges_usd + taxes_usd` beyond tolerance
- vendor on the line is not the defuelling agent on the defuel

Tolerances come from `TOLERANCE_RULES`, which already drives the quantity and price
ladders. No new tolerance mechanism.

### Effort

Small. One association, one resolver branch, four validations, one column on the invoice
item list. The resolver is the only real work, and it is a copy of a pattern that exists.

---

## Part 2 — expected credits from a vendor

### Why this is not a tab on the invoice list

An expected credit is not an invoice. It has no invoice number, no payment terms and no
document in the vendor's system — it is the airline's own assertion that a vendor owes it
money. Putting it in the invoice list as a fourth view would mean every count, every total
and every "overdue" figure on that screen silently mixes payables with receivables.

**Recommendation: a separate `ExpectedCredits` entity set in `InvoiceService`, surfaced as
its own view with its own counts**, reachable from the invoicing tile. Same app, same
tile, its own list — not a tab stapled onto the payables list.

If you want it literally as a tab on the existing list, say so and I will build it that
way; it is the same backend either way, and only the manifest differs. But the totals
problem above is real and will be noticed in a demo.

### The entity

```cds
@readonly entity ExpectedCredits as projection on dfl.DEFUEL {
    defuel_id, defuel_date, station_code, tail_number,
    supplier.supplier_name as vendor_name,
    quantity_l, quantity_kg,
    fuel_value_usd      as original_value_usd,
    expected_credit_usd,
    write_off_usd,
    status
} where defuel_type = 'TO_SUPPLIER' and status <> 'REVERSED';
```

Grouped by vendor, oldest first — an expected credit nobody chases becomes a write-off by
default, so the stalest belongs at the top. That is the same reasoning the defueling app's
own "Open credits" view used before the 26 Oct redesign removed it.

### What the view must show

Vendor, defuel number, date, station, tail, original value, expected credit, write-off,
status, and **age in days**. Age is the point of the screen.

### The one question this part raises

**When does an expected credit stop being expected?** Three candidates, and they are not
equivalent:

1. the vendor issues a credit note, and it arrives as a document to match
2. somebody marks it received by hand
3. it nets against the next invoice from that vendor

Option 1 is correct and is the most work: a credit note is an inbound document, so it
needs capture, matching and its own exceptions. Option 2 is a demo. Option 3 is how
several airlines actually settle, and needs the netting to be visible or finance will not
trust it.

**I have not assumed one.** Everything above works regardless; this decides what happens
after the credit is agreed, and it is the difference between a screen that reports and a
screen that closes the loop.

---

## Sequencing

| | What | Depends on |
|---|---|---|
| 1 | `defuel` association on the invoice line + resolver rungs 1–2 | nothing |
| 2 | Validations and their `INV` codes | 1 |
| 3 | `ExpectedCredits` entity and its view | the 27 Oct defuel changes, which are built |
| 4 | Resolver rungs 3–4 and the exception colouring | 2 |
| 5 | Whatever closes a credit | the question above |

Items 1–4 are a few days and carry no open questions. Item 5 should not start until the
question is answered, because each answer builds a different screen.

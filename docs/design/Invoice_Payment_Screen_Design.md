# Invoice and Payment — Screen Design

**FuelSphere · three screens**
26 August 2026

---

## 0. What these screens are for, and what they are not

**SAP Document AI performs the three-way match.** Decision C-6. It reads the supplier's invoice, finds the purchase order and the goods receipt, and reports whether they agree.

**FuelSphere's contribution is the fuel context around that result** — which ticket, which delivery, which flight, which tail, and what the meter and the gauge said. **Nothing else in the landscape can supply it**, and it is the reason these screens exist rather than an accounts-payable queue.

> So every screen here answers a question an AP clerk cannot answer from SAP alone: **not *does this invoice match*, but *what fuel is this, and does the fuel agree with the paperwork*.**

**Three screens, three questions:**

| | Question |
|---|---|
| **Invoice Worklist** | What has arrived, and what needs a decision |
| **Exceptions** | Which checks fired, and what should happen about each |
| **Payment Status** | What is stuck, and what expires if nobody acts |

---

## 1. Where these sit in the standard

The seven principles govern. Three of them decide most of what follows.

**P1 — the worklist is the home screen.** Nobody opens an invoice application to browse invoices. They open it to find the ones that need them.

**P2 — every number drills to its source.** A price variance leads to the price components; a quantity variance leads to the ticket and the meter reading behind it.

**P3 — filters are the primary interaction.** **An unfiltered invoice list is a failure**, not a default. Each screen opens filtered to *what needs me*.

**And P6 — nothing is silently excluded.** A screen that quietly drops rows it cannot classify is the failure that made the Exception Queue read *"all clear"* for months.

---

## 2. Screen one — Invoice Worklist

**List Report and Object Page.** The home screen.

### Opens filtered

```
status IN (Submitted, Exception, Blocked)
```

**Not all invoices.** A verifier's day is the ones that stopped, and a posted invoice is finished unless something goes wrong later — which is screen three's job.

The filter is visible and removable. **A default filter nobody can see is a lie about the dataset.**

### Columns

| | |
|---|---|
| Invoice number | The supplier's, as received |
| Supplier | |
| Invoice date · Received date | Two facts, and the gap between them matters |
| Station | |
| Gross amount · Currency | |
| **Status** | With criticality |
| **Exceptions** | A count, with criticality by the **highest** severity present |
| Age | Days since received |

**The exception count carries the severity, not the number.** Three warnings and one hard error are not four of anything — **the row is red because one line cannot post**, and the count says four.

### Filters

```
status · supplier · station · invoice date range
severity present · has exceptions · age bracket
```

**Severity present** is the one that earns its place. *Show me everything with a hard error* is the question, and counting is not it.

### The object page

| # | Section | |
|---|---|---|
| 1 | **Header** | Invoice number, supplier, gross, status, exception count |
| 2 | Invoice details | Dates, currency, payment terms, supplier reference |
| 3 | **Lines** | The table. One row per invoice line |
| 4 | **Exceptions** | Every check that fired, at any severity |
| 5 | **Matching** | PO, GR, invoice — Document AI's result |
| 6 | **Fuel context** | **The differentiator.** Ticket, delivery, flight, tail |
| 7 | Approvals | Who, when, at what limit |
| 8 | Payment | Posting, clearing, due date |
| 9 | Documents | The scanned invoice, and the ticket image beside it |
| 10 | Administration | |

**Section 6 is why this screen is not an SAP transaction.** From an invoice line, one click to the ticket that recorded the fuel, the delivery that measured it, and the flight that burned it.

---

## 2A. The check panel — all twenty-two, not only the failures

**On the invoice object page**, and it answers a question the exception list cannot: **what else was checked.**

### Why failures alone are not enough

`INVOICE_EXCEPTIONS` holds **failures only** — `check_code`, `severity` and `message` are all `@mandatory` and there is no passed state. It is an exception-instance table, not a check-run record.

So a verifier sees three failures and **nothing about the nineteen that passed.**

> **A verifier deciding whether to release a soft error wants to know what else was checked.** *Nineteen passed* is the context that makes one failure proportionate — and without it, three exceptions and twenty-two look the same.

### The join, and it needs no new table

```
INVOICE_CHECK_REGISTRY   all 22, always
  LEFT OUTER JOIN
INVOICE_EXCEPTIONS       this invoice's failures

matched    -> the exception, with severity and message
unmatched  -> PASSED
```

**Passed by absence**, which is sound because `checksSkipped = 0` on every run. **A check that did not raise, ran and cleared.**

### What each row shows

| | |
|---|---|
| Check code | `INV450` and the rest of the twenty-two |
| What it asserts | The registry's description, **not what failed** |
| **Status** | `PASSED` · `WARNING` · `SOFT_ERROR` · `HARD_ERROR` |
| Line | Which line raised it, or blank for a header check |
| Expected · Actual · Variance | From the exception. Blank on a pass |
| **Severity source** | **`TOLERANCE_LADDER` or `REGISTRY_DEFAULT`** |
| Bypass | Available on `SOFT_ERROR`. **Disabled on `HARD_ERROR`, not hidden** |

**Severity source is the column that earns its place.** It distinguishes *“SOFT because the variance was 3%”* from *“SOFT because that is what the registry says”* — and one invoice in the seed fires the same check at three rungs on three lines, which is the clearest demonstration of a configured threshold this system has.

### And the header states the run

```
22 checks ran · 0 skipped · evaluated 26 Aug 14:02
3 raised — 1 hard, 1 soft, 1 warning
```

**From `gate_evaluated_at`, `open_hard_count`, `open_soft_count` and `warning_count`** on the invoice. **So “checked and clean” and “never checked” are distinguishable**, which the exception list alone cannot do.

> **Default the panel to failures, with a toggle for all twenty-two.** Nineteen green rows above three red ones buries the finding; nineteen green rows **one click away** supplies the context without costing the attention.

---

## 3. Screen two — Exceptions

**A separate screen, not a section.** A verifier works through exceptions across invoices; they do not open invoices hoping to find them.

### It is line-level, and that changes the floorplan

An exception belongs to a **line**, not to an invoice. An invoice with four exceptions is four pieces of work, possibly for different people.

**So the list is exceptions**, and the invoice is a column.

### Opens sorted, not just filtered

```
severity DESC, then age DESC
```

**Hard errors first, oldest first within severity.** A hard error blocks posting; a warning does not. Sorting by age alone puts an old warning above a new blocker.

### Columns

| | |
|---|---|
| **Severity** | `HARD` · `SOFT` · `WARNING`, with criticality |
| Check code | `INV403`, `INV404`, and the rest of the 33 |
| Check description | What the check asserts, not what failed |
| Invoice · Line | |
| Supplier | |
| **Expected · Actual · Variance** | Three columns, because a variance without its operands is unactionable |
| Status | `OPEN` · `BYPASSED` · `RETURNED` |
| Bypassed by · when · why | Empty unless bypassed |
| Age | |

### The three severities, and what each permits

| | |
|---|---|
| **`WARNING`** | Recorded and visible. **Does not gate.** The line stands |
| **`SOFT`** | Gates, and an authorised user may release it. **Who, when and why are recorded** |
| **`HARD`** | **Cannot be bypassed by anyone.** Needs a corrected invoice from the vendor |

**The bypass reason is mandatory and free text.** A dropdown of reasons produces *"other"* on every row that matters.

> **One person can bypass a soft error today.** A second signature is a later control, and until it exists the screen should not imply otherwise — **no "pending approval" state for something one person completes.**

### And the fuel context belongs here too

A quantity variance of 350 litres is a number. **A quantity variance of 350 litres against a ticket that says the bowser metered 2,884 and a gauge that agrees to half a kilogram is a supplier conversation.**

**One click from the exception to the ticket.** That is the whole argument for this screen living in FuelSphere.

---

## 4. Screen three — Payment Status

**What is stuck, and what expires.**

### Four states, and they are not one entity

| State | Means | Lives on |
|---|---|---|
| **Not billed** | Fuel delivered, no invoice line | **The delivery**, not the invoice |
| **Unposted** | Invoice held on a hard error | The invoice |
| **Unpaid** | Posted, awaiting payment | The invoice |
| **Claim expiring** | A variance whose notification window is closing | **The delivery** |

**Two of the four are not invoices at all.** Modelling them as one list means a union or an analytical view.

> **Recommendation: four tabs on one page**, each a list of its own entity, rather than a union that flattens four different things into a shape none of them has. The tabs share a page because they share a question, not a table.

### Sorted by time remaining, not by age

**A claim window is a deadline.** The one expiring first escalates — whatever its age, whatever its value.

**An ageing report sorts the oldest to the top and lets the urgent one fall through.** That is the single most important behaviour on this screen.

### Columns, per tab

**Not billed** — delivery, date, station, tail, quantity, estimated value, days since

**Unposted** — invoice, supplier, gross, the blocking check, days held

**Unpaid** — invoice, supplier, gross, posted date, due date, **days to due**, terms

**Claim expiring** — delivery, variance, claim type, window opens, **days remaining**

### One thing this screen must not imply

**Payment is not held for a discrepancy.** The supplier is paid on metered volume and the dispute runs on its own track.

**If payment could simply be withheld, a fifteen-day notification deadline would be pointless** — and the claim window tab would not need to exist.

---

## 5. Navigation

```
Worklist ──► invoice ──► line ──► exception
                    │              │
                    │              └──► ticket ──► delivery ──► flight
                    │
                    └──► fuel context ──► ticket, delivery, flight, tail

Exceptions ──► the invoice it belongs to
           └──► the ticket behind the variance

Payment ──► the invoice
        └──► the delivery, for the two tabs that are deliveries
```

**Every path reaches the fuel.** That is the test: from any number on any of these three screens, **can a person reach the physical event it describes?**

### The service question, which decides what is buildable

**A facet needs the service to expose both ends.** `InvoiceService` will need `FUEL_TICKETS`, `FUEL_DELIVERIES` and `FLIGHT_SCHEDULE` exposed read-only, or the fuel context sections have nothing to point at.

**That is the same decision taken for `PlanningService`:** the service exposes, read-only, what its subject reaches. **An invoice reaches its fuel.**

---

## 6. What must be established before any of this is built

I have never looked at `InvoiceService`. **Every field name below is a guess and should be treated as one.**

| | |
|---|---|
| **Does anything render at all?** | Is `InvoiceService` annotated, and do its entities have `LineItem`, `Facets`, `HeaderInfo`? |
| **What holds an exception?** | `EXCEPTION_ITEMS` has **0 rows and is never written**. `INVOICE_CHECK_REGISTRY` holds 33 checks. **Is there an instance entity, or only the registry?** |
| **What holds a match?** | `INVOICE_MATCHES` exists. Populated? |
| **Are there seeded invoices?** | And do any carry an exception, at any severity? |
| **What is the status enum?** | `InvoiceStatus` gained `Submitted`. What else does it hold, and does anything write the rest? |
| **The amounts** | **D32 says the shipped UI reads `total_amount` and the entity has `net_amount`, `tax_amount`, `gross_amount`.** Confirm which exist |
| **Payment fields** | Posting date, due date, clearing document — declared, or designed? |

> **`InvoiceService` has 401 lines of handler and is one of the four services with no authorisation of any kind** — D23. Whatever is built here inherits that.

---

## 7. What I would build first, and why

**Screen one, list report only.** No object page, no sections.

**It is the smallest thing that answers whether the data supports any of this.** If the list renders with a status, a supplier and an amount, the rest is annotation. If it does not, everything above is a design for a screen that cannot exist yet.

**Then the exception screen**, because it is the one that carries the argument — three severities, a bypass with a recorded reason, and a route to the ticket.

**Payment last.** Four tabs across four entities is the most work and the least novel; an AP department already has an ageing report.

---

## 8. Two things I would not do

**Do not build a three-way match view that duplicates Document AI's.** C-6 settled that the match is theirs. **A screen showing PO, GR and invoice side by side with a tick is a screen that will disagree with SAP eventually** — and when it does, nobody will know which is right.

**Do not put a payment block on a discrepancy.** The design says payment runs on its own track, and a button that holds payment would be the first thing an SME asks about — and the answer would contradict the design.

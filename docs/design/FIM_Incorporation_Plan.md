# Fuel Invoice Management — incorporating the HLD

**FuelSphere · what exists, what conflicts, and what it costs**
26 August 2026

---

## 0. What arrived

`FuelSphere_Invoice_Management_HLD_v0_1.docx` — **twenty sections, fifty-one tables**, aligned to enterprise vendor-invoice-management conventions.

| | |
|---|---|
| **52 business rules** | Across four groups, each with a step number, a bypass flag and an initial role |
| **12 document statuses** | Four terminal |
| **11 roles** | With determination rules |
| **6 document types** | `ZFUEL_ITP` · `BLK` · `FEE` · `TAX` · `CM` · `PPD` |
| **5 inbound channels** | Structured preferred; unstructured OCR'd |
| **8 variance categories** | Each with a named owner |
| **5-pass matching cascade** | Plus reverse matching for unbilled tickets |
| **7 tolerance types** | With a fallback hierarchy |
| **14 Fiori applications** | |

**This is a module specification, not an enhancement.** FuelSphere holds a fragment of it.

---

## 1. The one sentence that decides the architecture

> **FIM does not ask whether the invoice matches the PO. It asks whether the price is right.**

**And the engine is the same one used by fuel ordering and accrual**, so the price challenged on the invoice is the price the airline expected when it ordered.

That is the difference between this and accounts payable, and it is why the module belongs in FuelSphere rather than beside it. **A general AP solution can match three documents. It cannot recompute an index average, apply a differential, convert at a delivered density and tell you which of eight things moved.**

---

## 2. What already exists, and how much of it maps

| HLD needs | FuelSphere has | |
|---|---|---|
| Invoice header and lines | `INVOICES`, `INVOICE_ITEMS` | **Maps** |
| Match results | `INVOICE_MATCHES` — *"links PO, GR (ePOD) and Invoice"* | **Partial.** Three-way, not four |
| A rule registry | `INVOICE_CHECK_REGISTRY` — **33 checks, 3 severities** | **Partial.** 52 needed |
| Approval records | `INVOICE_APPROVALS` | **Maps.** No DOA behind it |
| Tolerances | `TOLERANCE_RULES` with a resolution hierarchy | **Maps.** Needs the seven types |
| A recalculation engine | **WP-20's `derivePrice`** | **This is the asset.** See §3 |
| Exception instances | `EXCEPTION_ITEMS` — **0 rows, never written** | **Declared, unbuilt** |
| Error codes | `INV401`–`INV410` designed | **Ten of fifty-two** |
| Document capture | **WP-31's `SOURCE_DOCUMENTS`** | **Maps to the archive** |

**And 401 lines of handler in `invoice-service.js`.**

### The asset nobody has counted

**WP-20 built the price derivation** — index, differential, into-plane, throughput, levies, resolved from `PRICING_FORMULAS` and `FORMULA_COMPONENTS`, with `PRICE_DERIVATION_LOGS` recording every input.

**The HLD's section 8 is eleven steps and WP-20 built most of them.** That is the largest single piece of FIM already in place, and it was built for ordering rather than for invoicing.

> **Reusing it is not an optimisation. It is the design** — the HLD says the engine must be the same one, so that the price challenged is the price expected.

---

## 3. Three conflicts to settle before anything is built

### 3.1 · Who performs the match — C-6 versus the HLD

**Decision C-6 says invoice matching is SAP Document AI's, and FuelSphere wraps the result in fuel context.**

**The HLD says FIM performs a 4-way match**, extending the familiar three with the **ticket**.

**These are reconcilable and the reconciliation should be written down:**

```
Document AI     reads the invoice, finds the PO and the GR
FIM             matches the line to the TICKET, and recalculates the price
```

**The fourth leg is FuelSphere's and nothing else can do it.** But the HLD's five-pass cascade also matches on station, date, flight and quantity — which is a matching engine, not a wrapper.

**Decide explicitly**: does FIM own the ticket leg only, or all four?

### 3.2 · The rule registry — 33 against 52

**WP-21A built a 33-check registry with three severities and a single-person bypass.** The HLD has 52 with a bypass flag and an initial role.

**Nobody has compared them.** Some of the 33 will be the HLD's; some will be FuelSphere-specific and absent from it; some of the 52 will need building.

**That comparison is the first survey**, and it sizes the whole module.

### 3.3 · The default owner is the Fuel Controller, not AP

> *"This is the principal organizational difference from a general AP invoice solution."*

**FuelSphere has no roles on `InvoiceService` at all** — D23, one of four services with no authorisation of any kind.

**So the role model is not a refinement of something. It is the first authorisation on that service**, and it arrives with eleven roles and a determination rule each.

---

## 4. The gaps, honestly sized

| | Size | |
|---|---|---|
| **Document types** | Small | Six `ZFUEL_*` values, a determination rule each |
| **Status model** | Small | 12 statuses against the current enum. Mostly additive |
| **Channels** | **Large** | Five inbound, none exist. EDI, XML, portal, email, manual |
| **Extraction and OCR** | Medium | **WP-31 built the capture layer.** Field-level confidence is new |
| **Normalization** | Medium | Density, UoM, currency — **WP-11 built the conversion** |
| **The 52 rules** | **Large** | After the 33-check comparison |
| **Matching cascade** | **Large** | Five passes, confidence per pass, ambiguity handling |
| **Reverse matching** | Medium | Unbilled tickets — **the "not billed" state already designed** |
| **Roles and routing** | **Large** | Eleven roles, work items, delegation, reminders, SLA |
| **DOA and approval** | Medium | `INVOICE_APPROVALS` exists; the matrix does not |
| **Dispute and short-pay** | **Large** | 14 reason codes, a lifecycle, supplier notification |
| **Posting** | **Blocked** | Needs S/4. **D19's environment half is still open** |
| **14 applications** | **Large** | Three are designed already in the screen design |

---

## 5. What I would build, and in what order

**Nothing here is small. But three packages give a demonstrable module**, and the rest is depth.

### First — the survey that sizes everything

```
compare INVOICE_CHECK_REGISTRY's 33 against the HLD's 52
what does invoice-service.js's 401 lines actually do
what does INVOICE_MATCHES hold, and is it populated
what does InvoiceStatus hold against the HLD's 12
and does WP-20's derivePrice cover section 8's eleven steps
```

**That last question decides the largest item.** If `derivePrice` covers eight of eleven, the recalculation engine is a wiring job. If it covers three, it is a package.

### Then — the three that make it demonstrable

**FIM-01 · Document, status and type.** The six `ZFUEL_*` types, the 12 statuses, the determination rules. **Small, and everything else references it.**

**FIM-02 · Recalculation and variance.** Reuse `derivePrice`, add the eight variance categories with their owners, and persist every input against the line. **This is the module's argument** — and section 8.1 already says every input must be persisted.

**FIM-03 · The four-way match, ticket leg.** The five-pass cascade against `FUEL_TICKETS`, with confidence per pass and pass 5 always presented for confirmation. **Nothing else in the landscape can do this.**

### And the three screens already designed

`Invoice_Payment_Screen_Design.md` covers the Worklist, Exceptions and Payment Status — **three of the HLD's fourteen**, and the three that carry the story.

**The HLD's "Reconcile Invoice" is the fourth and it is the strongest**: invoiced against recalculated, side by side, with the variance decomposed into its eight categories.

---

## 6. Four things in the HLD worth keeping verbatim

**Tolerances are a control, not a target.** *"Reporting shows the value auto-accepted under tolerance by supplier and station"* — so a supplier who prices consistently just inside tolerance is visible.

**Fee tolerance is 0%.** *"Fees are fixed and any difference is investigated."* The one place where nothing is absorbed.

**The first pass that returns exactly one candidate wins; a pass returning several is ambiguity, not a match.** That is the anti-pattern this project has now measured three times — a business-key join that over-matches and looks correct on any row you inspect.

**And every input to the calculation is persisted against the line** — the quotation values and dates, the differential, the density. **A recalculation nobody can reproduce is a recalculation nobody can defend.**

---

## 7. Four open points the HLD names, and one it does not

**From the document:**

```
consolidated statements without ticket-level detail
retrospective index republication
into-plane agents billing through the supplier
short-pay not permitted in all jurisdictions
```

**The third is F25's shape** — *no contract-to-formula link* — arriving from the commercial side.

### And one the HLD does not name

**Multi-carrier.** The HLD determines company code, tax registration, DOA and role assignment **per company code** throughout — and F40 records that FuelSphere has no carrier entity at all.

**An airline group operating two codes has two sets of books**, and every FIM rule that resolves *by company code* needs to know which. **That is not a FIM gap; it is F40 arriving in a second place.**

---

## 8. What I would decide first, before any survey

**Is FIM in scope for this release, or is it the next one?**

**The three screens in the demo are worth building either way** — they show the fuel context an AP system cannot supply, and they need a fraction of this.

**The module is a quarter of work, not a sprint.** Fifty-two rules, eleven roles, five channels and fourteen applications, on a service with no authorisation and no S/4 connection.

> **The honest framing: this HLD is good and it is a roadmap.** Building three of its fourteen applications and two of its seven components gives a demonstration that is true rather than staged — **and pretending the rest is close would be the first false thing in this project's documentation.**

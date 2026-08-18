# SME Requirements Assessment Register

> ## NOT A SPECIFICATION
>
> This document is a **record of how the SME requirements were assessed and dispositioned**. It does not authorise any change.
>
> Where a requirement was accepted, the change is specified in `docs/design/01-TARGET-SCHEMA.md`, `02-BEHAVIOUR.md` or `03-VALIDATION-RULES.md`, and the decision is recorded in `docs/design/00-DECISIONS.md`. **Those documents are authoritative. This one is not.**
>
> **Do not implement anything from this document.** Items marked ACCEPTED here are not a to-do list — each was either already present in the design or written into the specifications at the time it was accepted. If something here appears to require a change the design documents do not specify, **stop and ask**.


**FuelSphere Design Requirements Catalog — Shailesh Chodankar SME sessions, July 2026**
Assessed against the current design and the merged build, 17 August 2026.

**Status: ASSESSMENT ONLY. No design document has been changed.**

---

## How to read this

52 requirements across seven sections, plus 11 out-of-scope items and 10 open items.

| Disposition | Meaning |
|---|---|
| **COVERED** | Already in the design. Reference given |
| **PARTIAL** | Design addresses part of it. The gap is stated |
| **NEW** | Not in the design. Needs adding |
| **CONFLICT** | Contradicts a closed decision. Reopens it |
| **NOT IN SCOPE** | With reason |

### Summary

| Disposition | Count |
|---|---|
| COVERED | 24 |
| PARTIAL | 13 |
| NEW | 9 |
| CONFLICT | 3 |
| NOT IN SCOPE | 3 |

**All three conflicts are resolved.** See "Decisions taken during review" below. Two new requirements were raised during the review and are recorded as NEW-01 and NEW-02.

---

## The three conflicts

### C-1 · REQ-FL-008 — discrepancy handled on two tracks

> Track 1 (P2P / uplift): supplier payment is based on metered volume. Three-way match on volume. **Payment is never held pending discrepancy resolution.** Track 2 (burn).

**Conflicts with:** the design's reconciliation model, which treats a metered-versus-gauge variance as a single control with a status, and with the claim-window design where an unresolved variance approaching day 15 escalates.

**The substance of the conflict.** The design assumes a variance may hold something. The SME position is that **payment never waits** — the supplier is paid on the metered volume, and any dispute runs separately on its own track.

**My view: the SME is right, and this improves the design.** It matches the IATA model agreement, where the seller's measurement is *prima facie* evidence and the buyer's remedy is a claim, not withholding. It also explains why claim windows exist at all — if you could simply not pay, you would not need a 15-day notification deadline.

**What changes if accepted:** reconciliation status stops gating invoice posting. The variance becomes a claim trigger, not a payment block. The claim window design already supports this; the reconciliation design assumes otherwise.

**Decision needed.**

---

### C-2 · REQ-SAP-004 — three configurable burn calculation methods

> Method 1 — goods issue at takeoff (sector burn as a separate goods issue). Plus two further methods, configurable per airline.

**Conflicts with:** decision **B4**, which settled on inventory by tail with goods issue to expense per leg, as a single model with `EXPENSE_ON_UPLIFT` as a transitional fallback.

**The substance.** B4 chose one accounting model and positioned the alternative as a migration step. The SME position is that three methods are all first-class and configurable.

**My view: needs the detail before deciding.** The document names Method 1 and says three exist, but the other two are not described in the extract. If they are variations on *when* the goods issue posts — takeoff versus on-blocks versus period-end — that is compatible with B4 and is a refinement. If one of them is expense-on-uplift as an equal option, it reopens B4.

**Ask Shailesh for methods 2 and 3 before deciding.**

---

### C-3 · REQ-CP-004 versus REQ-SAP-001 — units

> **REQ-CP-004:** PO and GR must be in volume — litres or kilolitres, **not kilograms**.
> **REQ-SAP-001:** split valuation by tail, with a Moving Average Price per tail.

**Not a conflict with the design** — decision A2 already puts orders and deliveries in litres, and B4 already specifies split valuation by tail.

**But the two requirements are in tension with each other**, and the design has not resolved it either. MAP is a price per unit of the material's base unit of measure. If the material's base UoM is litres, then MAP is per litre, and a tail's fuel value changes with temperature even when no fuel moves. If the base UoM is kilograms, the PO and GR are in kilograms and REQ-CP-004 is violated.

The usual SAP answer is **base UoM in kilograms with litres as an alternative unit of measure**, and the conversion carried on the material. That satisfies the three-way match in litres while valuing in mass.

**My view: this needs confirming with Shailesh explicitly.** The design says "orders in litres" without stating the SAP base UoM, and that is the field that decides it.

---

## Decisions taken during review — 17 August 2026

### Group C — closed

| # | Decision |
|---|---|
| REQ-PF-001 | **ACCEPT.** Adopt the 22-step numbering as a cross-reference on work packages, screens and validation rules. Not as a work breakdown. Needs the 22-step list from Shailesh |
| REQ-FL-007 | **ACCEPT.** State MAP per tail explicitly, and adopt the SME's framing — a cross-tail average destroys the tankering signal |
| REQ-INT-007 | **DEFER.** AOOS becomes relevant when FuelSphere extends to suppliers |
| REQ-INT-008 | **DEFER.** Crew data source feed needs clarity first — whether captain name arrives on the schedule feed or requires a fourth interface |
| Remainder of C | **ACCEPT** |

### Group D — deferred, as recommended

REQ-FT-010 OCR · REQ-UI-009 pilot tablet · REQ-FT-005 delay and service fees · REQ-INT-002 Trip Record path · REQ-SAP-005 PaPM allocation · REQ-UI-002 six prototype roles

### C-1 · Discrepancy and payment — RESOLVED, better than either position

> Discrepancy is recorded and reviewed always. It affects payment **only** where the parameter `HOLD_PAYMENT_ON_DISCREPANCY` is set **and** tolerance is exceeded. Where the parameter is not set, payment is never held.

**This is a parameter, not a position.** Better than both the SME's "never hold" and the design's implicit "variance gates posting" — it keeps both behaviours available and makes the choice the airline's.

**Effect on the design:** reconciliation status does not gate invoice posting by default. The claim-window design already assumes this.

### C-2 · Burn calculation method — RESOLVED

**Method 2 selected: goods issue on burn confirmation.**

```
ACARS arrives, or does not
   → burn proposed, status PRELIMINARY
   → variance ladder runs, staff review
   → staff amend where needed
   → staff confirm
   → ROB entry written, goods issue posts
```

The confirmation step is **identical whichever way the figure arrived**. Where ACARS carries no usable FOB values, the burn is entered manually and confirmed through the same path. The posting trigger does not vary with data quality; only the proposal does.

**This matches what is already built** — `burn-service.js` has `PRELIMINARY`, `confirm` and `reject`, with the ROB entry created on confirm, and `data_source` distinguishing ACARS, EFB, MANUAL and JEFFERSON.

**Consequence worth naming:** if nobody confirms, no goods issue posts. The burn sits `PRELIMINARY`, fuel stays in stock on the tail, and the difference surfaces at period close as a stock variance. That is the completeness control working as intended — but **confirmation throughput becomes a month-end dependency**.

**Recommendation: keep the parameter, implement one value.** `BURN_POSTING_TRIGGER` with `ON_CONFIRMATION` built, `AT_TAKEOFF` and `PERIOD_END` reserved. Methods 1 and 3 are not built; REQ-SAP-004 asks for three configurable methods and one is delivered.

### C-3 · Units and the document flow — RESOLVED

```
Value contract           per vendor, in SAP
   └── one PO per fuel ticket        technical, internal, LITRES
          └── GR auto-created at PO creation      LITRES
                 carries the supplier ticket number
                        └── invoice matched on ticket number
```

| Track | Unit | Why |
|---|---|---|
| Procurement — contract, PO, GR, invoice | **Litres** | Suppliers meter and invoice in volume. One unit throughout, so the three-way match never crosses units |
| Operational — plan, burn, ROB, ledger | **Kilograms** | Flight planning is a mass calculation |
| **Material base UoM** | **Kilograms** | So MAP is per kilogram |

**Decision A2 stands as written.**

**This resolves REQ-INT-006, REQ-CP-005 and REQ-CP-006 as accepted**, since the described flow already satisfies all three: the PO is internal and never shared, it carries no custom fields, and the ticket number is the matching key.

---

## NEW-01 · Periodic physical inventory reconciliation and variance allocation

**Raised by Ajesh during review, 17 August 2026. Not in the SME catalogue and not in either design.**

### Why it is necessary

The GR posts in litres. SAP converts to the material's base UoM — kilograms — using the **material master's fixed conversion factor**. The actual mass delivered is `litres × actual density`, and actual density varies per delivery while the fixed factor does not.

**A variance therefore accumulates structurally, not through error.** Sources compound:

| Source | Character |
|---|---|
| Fixed conversion factor versus actual density | The main term. Every delivery contributes |
| Temperature at fuelling | Volume expands; mass does not |
| Meter versus FQIS measurement error | Bidirectional |
| Uncaptured events | One-directional |

**This is the necessary companion to Method 2.** Method 3 — period-end allocation of uplift less closing balance — would need no true-up, because it allocates actual consumption including all losses by construction. Method 2 posts what was *burned* from a book stock built on *converted* litres, so the gap must be corrected explicitly.

### Required functionality

Periodically, suggested quarterly:

1. Compare book stock per tail against actual fuel on board
2. Compute the variance
3. Allocate it across the period's flights in proportion
4. Post the correction

`TAIL_STOCK_RECON` **detects** the difference — SAP stock against ledger against gauge, decomposed into timing and unexplained, at each tail's last on-blocks before period end. **It does not correct or allocate.** That is the gap.

### Four open questions

| # | Question | Recommendation |
|---|---|---|
| 1 | What is "actual"? | FQIS at the tail's last on-blocks before period end, per the existing cutoff design. A physical dip is more accurate and rarer |
| 2 | Allocation basis | **Burn quantity** — the variance arose through consumption. Alternatives: flight count (simplest, charges a 30-minute sector as much as a trans-Pacific), block hours, fuel value. Make the basis a parameter |
| 3 | Where it posts | A goods movement adjustment against the tail's valuation type, then cost allocation to flights — keeps stock correct. Or a single allocation posting — fixes cost only |
| 4 | Direction | Physical above book is as likely as below. A credit allocation to flights is unusual but correct, and will be queried |

**Interval.** Quarterly means a quarter of accumulated variance arriving at once, allocated across three months of flights already reported. Monthly would be smaller and closer to the flights that caused it. **Worth deciding deliberately rather than by default.**

---

## NEW-02 · Batch-specific unit of measure — OPEN POINT

**Could the conversion factor be the specific density on each ticket, rather than a fixed material factor?**

Yes. SAP's **batch-specific unit of measure** exists for exactly this, and is used for fuels, oils and chemicals because density varies per delivery.

```
Material is batch-managed
   → each batch carries density as a characteristic
   → the L ↔ KG conversion derives from the batch, not the material master
   → a GR in litres converts at the actual delivered density
```

Each delivery becomes a batch; the ticket's specific gravity populates the characteristic. **The conversion variance disappears at receipt.**

### The complication

Batch is a **stock attribute**, not merely a receipt attribute. Stock becomes per tail *per batch* under split valuation, and goods issue for burn needs **batch determination** — which batch was burned?

**Fuel commingles.** After the second uplift there are no distinguishable batches in the tank. Any determination rule — FIFO, proportional — is a fiction chosen for accounting convenience. Not fatal, since SAP does this routinely for bulk commingled materials, but it should be a conscious choice.

### The four options

| | Approach | Variance | Cost |
|---|---|---|---|
| **1** | Fixed material conversion | **Structural, accumulating** | None. Needs NEW-01's true-up |
| **2** | Batch-specific UoM | **Eliminated at receipt** | Batch management, plus a fictional batch determination on burn |
| **3** | Post GR in KG, FuelSphere converts | Eliminated | Invoice in litres no longer matches GR directly |
| **4** | Base UoM litres | Eliminated | MAP per litre. Tail value moves with temperature while no fuel moves |

### Two questions to verify before choosing

1. **Can `BAPI_GOODSMVT_CREATE` accept an entry quantity in litres and an explicit base quantity in kilograms**, bypassing the material conversion? If so, option 3 becomes attractive — clean valuation with the litre figure still on the document for matching
2. **Does batch determination on goods issue create an unacceptable operational burden** for a system posting per leg?

Neither is answerable from the design side. Both need Shailesh or an MM consultant.

### Provisional position

**Option 1 is the design position. Option 2 is an optimisation, not a prerequisite.**

The true-up has a virtue batch management does not: it catches uncaptured events and measurement error as well as density drift. **Under option 2 those still accumulate, just more slowly — so the reconciliation is needed either way.** The question is only whether it corrects a large structural variance or a small residual one.

**Status: OPEN. Revisit with NEW-01.**

---

## 1 · Process flow — 3 requirements

| # | Requirement | Disposition | Where | Note |
|---|---|---|---|---|
| REQ-PF-001 | 22-step end-to-end process flow | **PARTIAL** | Spec §3–§14 | The design covers the same lifecycle but is not expressed as 22 numbered steps. **Recommend adopting the step numbering** as a traceability spine — it gives every requirement, screen and work package a common reference the design currently lacks |
| REQ-PF-002 | Steps 10 and 12 in the Supplier Systems swim lane | **COVERED** | Decision B2 | The design already treats the ticket as the supplier's document and the delivery as the airline's event |
| REQ-PF-003 | FuelSphere registers a ticket replica between steps 12 and 13 | **COVERED** | Decision B2, `01-TARGET-SCHEMA` §4 | This is precisely the three-entity model. The replica is `FUEL_TICKETS` |

---

## 2 · Integration — 9 requirements

| # | Requirement | Disposition | Where | Note |
|---|---|---|---|---|
| REQ-INT-001 | Three inbound CPI interfaces | **PARTIAL** | `02-BEHAVIOUR` §5, WP-15 | Design has staging for two feeds — schedule and dispatch. **The third, fuel ticket inbound, is not designed.** Add |
| REQ-INT-002 | Two flight schedule paths — Trip Record, or direct | **NEW** | — | The design assumes one inbound pattern. **Path A reading the Trip Record object in BTP/S4 is not designed at all.** Material |
| REQ-INT-003 | FuelSphere publishes a data protocol; customers conform | **ACCEPTED** | To be added to `02-BEHAVIOUR` §5 | A stated product principle: FuelSphere defines the field list and XML format per interface; customers conform regardless of middleware. Replaces per-customer mapping |
| REQ-INT-004 | ROB manual entry fallback for aircraft without ACARS | **COVERED** | `01-TARGET-SCHEMA` §6 `FobSource` | `CREW_REPORTED` and `PANEL_PRESET` already carry it, with rounding recorded |
| REQ-INT-005 | Auto PO and GR on ticket confirmation | **PARTIAL** | `02-BEHAVIOUR` §10, WP-23 | Posting is designed. **The trigger being ticket confirmation is new** — the design triggers on the ePOD acknowledgement. Reconcile |
| REQ-INT-006 | PO is internal only, never shared with the supplier | **ACCEPTED** | C-3 above | Confirmed: the PO is technical and internal, one per fuel ticket, never shared |
| REQ-INT-007 | AOOS is the upstream source for flight schedules | **NEW** | — | The design says "ops system" generically. Naming AOOS as the industry pattern is useful context and may affect the feed design |
| REQ-INT-008 | Crew data from the Flight Operating System, not maintained here | **NEW** | — | The design does not mention crew at all. Cheap to state; prevents scope creep later |
| REQ-INT-009 | Flight-to-contract mapping custom table | **PARTIAL** | Contract scoping, AFSMA location agreements | Design scopes contracts by station. **Scoping by flight number is not designed.** The reason given — SAP standard contracts carry no flight-level determination — is correct |

---

## 3 · Fuel log — 10 requirements

The SME's "fuel log" is the design's `ROB_LEDGER` plus ticket fields. Terminology differs; substance overlaps heavily.

| # | Requirement | Disposition | Where | Note |
|---|---|---|---|---|
| REQ-FL-001 | Fuel log field set, components A–H | **PARTIAL** | `01-TARGET-SCHEMA` §6 | Most fields map. **Component B, "fuel before refuelling", is distinct from arrival fuel and the design conflates them.** See REQ-FL-003 |
| REQ-FL-002 | Arrival fuel from ACARS; chocks-on reading is definitive | **COVERED** | `FobSource: ACARS` | The design does not name chocks-on as the definitive reading. Worth adding — it removes ambiguity about *which* ACARS reading |
| REQ-FL-003 | Fuel before refuelling may differ from arrival fuel | **ACCEPTED** | `01-TARGET-SCHEMA` §6 | Both fields added: `fob_at_arrival_kg` and `fob_before_kg`, with `ground_burn_kg` derived. `fob_before_kg` remains the reconciliation input; the arrival reading makes the ground-time gap visible. **Apportioning that gap between the arriving and departing flights is recorded against WP-19** — see the design notes in `04-WORK-PACKAGES.md` |
| REQ-FL-004 | Specific gravity from the ticket, not the meter | **COVERED** | `01-TARGET-SCHEMA` §6, decision B6 | `density_kg_per_l` on the ticket, `density_basis` MEA/STD |
| REQ-FL-005 | Conversion factor from specific gravity and temperature | **PARTIAL** | Decision B6 | Design has density as the conversion. **Temperature as a second input to a standard industry formula is not designed.** Open item OI-002 asks for the formula — it is not yet known |
| REQ-FL-006 | Ledger at tail level, continuous, closing = next opening | **COVERED** | WP-03 delivered, `02-BEHAVIOUR` §4 | Exactly the implemented ROB formula |
| REQ-FL-007 | **Moving Average Price maintained per tail** | **PARTIAL** | Decision B4 | B4 chose inventory by tail with split valuation, which produces MAP per tail. **But the design never states MAP explicitly**, and the SME's reasoning — a cross-tail average destroys the tankering signal — is the clearest justification yet for B4. Add it |
| REQ-FL-008 | Two-track discrepancy handling | **CONFLICT** | See C-1 | |
| REQ-FL-009 | Temperature at fuelling is mandatory | **COVERED** | `FUEL_DELIVERIES.temperature`, `EPD403` | Already `@assert.range: [-40, 50]` |
| REQ-FL-010 | ACARS is tail-based; resolve tail to flight | **ACCEPTED** | Decision B2, `01-TARGET-SCHEMA` §4 | The stated key — tail + date + departure time — replaces the design's vaguer "time window". Two follow-ons recorded against F2: the tolerance either side of departure time, and whether the join uses scheduled or actual departure |

---

## 4 · Fuel ticket — 10 requirements

| # | Requirement | Disposition | Where | Note |
|---|---|---|---|---|
| REQ-FT-001 | Ticket is the supplier's document; airline creates a replica. **No ticket creation screen for airline users** | **COVERED** in principle, **NEW** in constraint | Decision B2 | The model matches. **The constraint — never present a creation screen — is new and firm.** The design's UI-11 "Manual Ticket Entry" screen contradicts it. Reconcile: capture is not creation, but the screen must not read as issuing a ticket |
| REQ-FT-002 | Complete ticket field set | **PARTIAL** | `01-TARGET-SCHEMA` §6 | Substantial overlap. Needs a field-by-field comparison against the 22 Jul list, which the extract does not fully reproduce |
| REQ-FT-003 | Specific gravity missing from the SAP Labs prototype | **COVERED** | Decision B6 | The design already has it. Confirms the gap rather than creating work |
| REQ-FT-004 | IPA vendor ID separate from supplier vendor ID | **COVERED** | `FS_SUPPLIER_ROLE_MAP`, split-vendor PO model | The design carries both parties and raises a service PO where they differ |
| REQ-FT-005 | Delay recording with reason code; overtime and service fee flags | **NEW** | — | **Not in the design at all.** Contractual fuelling windows with penalty clauses — AFSMA Annex V defines fuelling delay and disruption with compensation. Ties to the supplier scorecard gap, G5 |
| REQ-FT-006 | Multiple tickets per flight | **COVERED** | Decision B2 | One delivery, many tickets. Top-up after re-plan is an explicit case |
| REQ-FT-007 | DEFUEL ticket type | **COVERED** | `01-TARGET-SCHEMA`, IATA-03 `DF`/`F` | Already adopted under G1 |
| REQ-FT-008 | Review and approval workflow for deviation above tolerance | **PARTIAL** | Reconciliation status | Design flags and routes to an exception queue. **An approval workflow with a named approver is not designed** |
| REQ-FT-009 | Ticket and meter images in DMS, linked to the ticket | **NEW** | — | Not in the design. Two images: the meter for OCR and compliance, the ticket for audit |
| REQ-FT-010 | **OCR meter capture is a firm requirement** | **NEW** | — | The design lists OCR as a capability but not as a firm requirement with a mobile capture flow. **This is a product commitment**, and it interacts with the UI decision C4 |

---

## 5 · Contracts and pricing — 6 requirements

| # | Requirement | Disposition | Where | Note |
|---|---|---|---|---|
| REQ-CP-001 | Contract list filtered by airport and flight number | **PARTIAL** | Contract scoping | Station filter aligns. **Flight number filter is new** and follows from REQ-INT-009 |
| REQ-CP-002 | Fuel grade column in contract list | **COVERED** | IATA-09 `ProductCode` | Adopted under G1 |
| REQ-CP-003 | Contract consumption percentage retained | **COVERED** | Gap G2, contract volume commitment | Already identified as a gap; this confirms it and gives the display form |
| REQ-CP-004 | PO and GR in volume, not kilograms | **COVERED** with a caveat | Decision A2 | See conflict C-3 on base UoM |
| REQ-CP-005 | **SAP PO remains completely standard — no custom fields.** Link via fuel ticket number | **ACCEPTED** | C-3 above | The GR carries the supplier ticket number; that is the link. Constrains WP-23 |
| REQ-CP-006 | Invoice matching keyed on fuel ticket number | **ACCEPTED** | C-3 above | The GR carries the ticket number. Matches the IATA Transaction standard, where the ticket number is the settlement key |

---

## 6 · Persona and UI — 9 requirements

| # | Requirement | Disposition | Where | Note |
|---|---|---|---|---|
| REQ-UI-001 | Tile set differs between buyer and seller personas | **PARTIAL** | UI standard, roles | The design has roles per screen. **Buyer versus seller as a fundamental split is new** and relates to open point F10, the supplier-facing direction |
| REQ-UI-002 | Six prototype roles from the SAP Labs demo | **CONFLICT (minor)** | `authorization.cds` scopes | The build has 17 scopes and 12 test users; the prototype has 6 roles. **These are different layers** — prototype roles are personas, not scopes. Needs mapping, not replacing |
| REQ-UI-003 | Launchpad tile groups | **NEW** | — | The design has 88 screens and no launchpad grouping. Cheap to adopt |
| REQ-UI-004 | Ticket list view column set | **PARTIAL** | UI-09 | Column sets differ. Adopt the prototype's where they conflict — it has been demonstrated |
| REQ-UI-005 | **Two screens absent from the prototype must be built** — fuel acceptance / ledger, and invoice matching | **COVERED** | UI-59 ledger, UI-17 invoice exceptions | The design has both. Confirms they are FuelSphere-specific |
| REQ-UI-006 | Maintain Schedule screen filters and tabs | **NEW** | — | Specific filter and tab set from the prototype |
| REQ-UI-007 | Review Tickets screen filters and columns | **NEW** | — | As above |
| REQ-UI-008 | Charter flights out of scope; **no manual flight creation screen** | **NEW constraint** | — | The design does not have one, so no conflict. **Worth recording explicitly** so nobody adds one |
| REQ-UI-009 | Pilot view via tablet or EFB, device linked to tail | **NEW** | — | `SHOULD`. Not designed. Relates to the mobile capture gap, G15 |

---

## 7 · SAP configuration — 5 requirements

| # | Requirement | Disposition | Where | Note |
|---|---|---|---|---|
| REQ-SAP-001 | Split valuation by tail | **COVERED** | Decision B4 | Confirms it |
| REQ-SAP-002 | **Align to the SAP model company framework for aviation** | **PART-ACCEPTED** | Decision B9, `01-TARGET-SCHEMA` §2A | **Flight = PM order: accepted**, as one of two parameterised models. `PM_ORDER` is a lookup from the trip record; `COST_CENTER` derives from event category, station, service type and carrier code. **Aircraft = cost centre: provisioned, not consumed** — nullable mapping on `AIRCRAFT_REGISTRATIONS`, no determination logic until a use case exists. **Airport = plant only.** Cost centre and profit centre mappings not adopted — station is a determination dimension in the cost centre derivation, so station cost is addressable without the station being a cost object |
| REQ-SAP-003 | Do not follow Leg State flight number formatting | **COVERED** | Flight identity design | The design takes the flight number from the source system |
| REQ-SAP-004 | Three configurable burn calculation methods | **CONFLICT** | See C-2 | |
| REQ-SAP-005 | Month-end fuel cost allocation via SAP PaPM | **NEW** | — | Allocation is designed; **PaPM as the mechanism is not.** The stated method — sum uplift per tail, deduct closing tank balance, allocate consumed fuel — is a different calculation from the design's per-leg goods issue. May interact with C-2 |

---

## 8 · Out-of-scope items — all 11 confirmed

Every item on the SME's out-of-scope list is already out of scope in the design, or newly confirmed as such. No conflict.

| Item | Design position |
|---|---|
| SAP TRM hedging | Already excluded. Design supplies physical exposure only |
| Ariba strategic sourcing / RFx | Already excluded — tender execution |
| Direct Platts / Argus API | Design assumes feed **or** manual. **File import only in v1 is a tightening** — accept |
| AI price prediction | Not in the design |
| Charter flight creation | Newly confirmed. Record it |
| Manual flight creation screen | Newly confirmed. Record it |
| Annual budgeting in SAC | Aligns with gap G1 being backlog |
| Leg State flight number formatting | REQ-SAP-003 |
| FuelSphere performing the dispatch calculation | Already excluded — dispatch owns it |
| Invoice matching screen missing from prototype | Design has it |
| Fuel acceptance / ledger screen missing from prototype | Design has it |

---

## 9 · Open items — 10, mapped to the design's own

| Ref | Open item | Design equivalent |
|---|---|---|
| OI-001 | Terminology for dispatch quantity, pilot discretionary, uplift | Partly settled by IATA-30 `FuelOrderMode` |
| OI-002 | **Standard conversion factor formula** | **Blocks REQ-FL-005.** The design has density but not the temperature term |
| OI-003 | Can one contract cover two fuel grades | New. Affects contract master |
| OI-004 | Line maintenance engineer persona | New |
| OI-005 | IPA / supplier portal persona | **Same question as F10** |
| OI-006 | Trip Record structure and test feed | **Blocks REQ-INT-002 Path A** |
| OI-007 | Prototype screenshots | Reference material |
| OI-008 | Burn and cost allocation mechanics session | **Blocks C-2 and REQ-SAP-005** |
| OI-009 | AP versus Finance Controller as one role or two | Affects authorisation |
| OI-010 | SmartDOC as optional schedule source | New |

---

## What I recommend

**Decide the three conflicts first.** C-1 changes the reconciliation model, C-2 and C-3 need input from Shailesh before they can be decided at all.

**Then two items that outrank the rest:**

**REQ-SAP-002 — the model company framework.** Flight as maintenance order, aircraft as cost centre, airport as plant plus cost centre plus profit centre. If FuelSphere is to sit inside SAP's aviation go-to-market solution, this is not optional, and it changes cost object determination from something the design invents to something it inherits. **This is the highest-impact requirement in the catalogue.**

**REQ-INT-003 — publish a data protocol.** Absent from the design and a genuinely better product position than per-customer mapping. Cheap to adopt now, expensive later.

**Then the nine NEW items**, most of which are small and additive.

**Nothing is incorporated until you agree the disposition.**

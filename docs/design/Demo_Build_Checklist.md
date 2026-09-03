# Demo build — requirements checklist

**FuelSphere · Aerolíneas Argentinas walkthrough**
Raised 26 August 2026 · nothing below is built

---

## How to use this

**Every line is a requirement from the demo conversation.** `[x]` means **CONFIRMED FOR BUILD** by Ajesh on 1 September — not that it is implemented. Nothing here is implemented. Tick as they land, and where something is deliberately not done, **say so on the line rather than deleting it** — an unticked box is a question and a deleted one is nothing.

---

## A · Flight Schedule screen

### Route

- [x] **Linked flight's origin and destination** resolved and displayed
- [ ] So a turnaround reads as one — *this flight arrives YUL, the linked one departs YUL*
- [ ] `linked_flight_number` and `linked_flight_date` exist today; only the resolution is missing

### The reader, and what the LIST must carry

- [ ] **The user is a FUEL PLANNER**, responsible for a station or a set of stations
- [x] **Origin filter matters. Destination does not** — *"destination probably I will not need, but origin is important because I'm responsible for that station"*
- [x] **DESIGNATED SUPPLIER AS A FILTER** — *"which of those flights do I need to be worried about with this particular supplier"*
- [x] **DESIGNATED SUPPLIER AS A LIST COLUMN** — *"I don't see supplier here"* — both ways, filter and item level
- [x] **Gate / stand (bay) number visible** — the information the supplier today gets from the airport authority
- [x] Terminal visible
- [ ] Flight status — `SCHEDULED` · `DEPARTED` · `ARRIVED` · `CANCELLED`
- [ ] Adapt Filters — more dimensions. **Deferred by the SME**, *"we can do this later"*

### Related records — reachable from one flight

- [ ] Dispatch plan **(built)**
- [ ] Fuel orders — **a table, several are possible** **(built)**
- [ ] Fuel tickets **(built)**
- [ ] Deliveries **(built)**
- [ ] **Burn** — declared, unrendered. **Reversal agreed and not yet built**

### Designated Supplier block — NEW · CONFIRMED 1 Sept

- [x] Supplier name and **contract**, resolved as at the flight date
- [x] **Invoicing** contact — phone, email
- [x] **Uplift** contact — phone, email. **Moves to the agent when the flag is FALSE**
- [x] **Disputes** contact — phone, email

### Into-Plane Agent block — NEW, and this is the PRIMARY operational contact

- [ ] > *"Who you would be talking to is basically the into-plane agent. He's the guy who is bringing it in from an operational perspective."*
- [ ] **Two suppliers on one flight** — the fuel supplier and the into-plane agent
- [ ] **Contacts on the SCREEN, not a drill-down** — *"that'll be too far. This is a front-end system. If I need to call somebody, that one tab should be available. Time is of the essence."*


- [x] Agent name **and its own contract**
- [x] Operations contact — **24h, this is the number rung at 05:00**
- [x] Supervisor contact

### Aircraft block — NEW, from the tail master

- [x] MTOW · MLW · MZFW · DOW
- [x] **Fuel capacity** — *whether the uplift physically fits*
- [x] **Engine burn rate** — does not exist today
- [x] APU burn rate
- [ ] Performance factor
- [ ] Aircraft type
- [x] **Record status** — `PROVISIONAL` blocks order creation

### The rule that governs all of it

- [ ] **Resolved through associations, never copied onto the flight**
- [ ] A supplier changes a number and **every flight shows the new one**
- [ ] A denormalised copy shows the old one forever and nothing says which is current

---

## B · Tail Master

### `AIRCRAFT_PERFORMANCE` — NEW, dated per tail

- [ ] `engine_burn_rate_kgph` — **does not exist today**
- [ ] `apu_burn_rate_kg_hr` — exists, **undated**
- [ ] `mtow_kg` · `mlw_kg` · `mzfw_kg` · `dow_kg` — on the **type** today, undated
- [ ] `performance_factor_pct`
- [ ] `valid_from` · `valid_to` · `source`

### On the register screen

- [ ] **Performance history** section — one row per validity period
- [ ] Current values in the header, resolved **as at today**
- [ ] **`apu_rate_source` visible** — nine of thirty-one are proposals

### Why dated

- [ ] Engine burn **drifts with age**; airlines re-baseline
- [ ] MTOW and MLW change on a **weight variant** or a modification
- [ ] DOW moves on a **cabin reconfiguration**
- [ ] **A March burn must use March's rate**

### And the consequence

- [ ] **Every derived figure inherits the date.** Recomputing a March ground burn with today's rate silently changes history
- [ ] S1's 52.50 kg derives from a rate of 105 — **if that becomes dated and is revised, the extract's zero-mismatch check must catch it**

---

## B2 · Tank master — NEW · SCOPE REDUCED 1 Sept

**Master data only. No impact on uplift or any other function for now.**

- [ ] **`AIRCRAFT_TANKS`** — per tail, **multiple tanks**
- [ ] Tank identifier — left wing, right wing, centre, and however many the type carries
- [ ] **Tank capacity** per tank
- [ ] Type varies: *"some aircraft have two tanks and some have six"*

### Explicitly OUT for now

- [ ] **No tank field on the uplift.** Not built, not configurable, no validation
- [ ] The provision exists in master data so the capability can be shown; **nothing consumes it**
- [ ] *"Let's keep a provision"* — the SME's own framing

### Why it exists at all, for when it is asked

- [ ] **Load and trim** — how fuel is balanced across the aircraft
- [ ] Matters to an **engineer, a pilot, or dispatch**. *"If I am a planner, I don't really care"*
- [ ] **Uplift only, if ever built.** The gauge reports total FOB across all tanks, so burn can never be tank-wise

---

## C · Supplier Master — TO BE BUILT

### `MASTER_SUPPLIERS` — extend

- [ ] `iata_code` · `icao_code`
- [ ] `supplier_type` — `INTO_PLANE` · `TRADER` · `REFINER` · `AGENT`
- [ ] `parent_supplier` — **agents billing through a supplier**
- [ ] `status` · `tenant_id`

### `SUPPLIER_CONTACTS` — NEW

- [ ] `contact_role` — `INVOICING` · `UPLIFT` · `DISPUTES` · `OPERATIONS`
- [ ] `name` · `position`
- [ ] `phone` · `mobile` · `email`
- [ ] `hours` · `timezone`
- [ ] **`is_primary`** per role
- [ ] `valid_from` · `valid_to`

### Two design points

- [ ] **Role is a VALUE, not a column set.** A supplier with two disputes contacts is normal, and a column set cannot hold the second
- [ ] **`is_primary` per role** — *who do I ring first for uplift* has one answer

### The agent question, answered by SAP's own shape

- [ ] S/4 models an into-plane agent as **partner role `WL`, goods supplier**, with the supplier remaining `LF`
- [ ] So: **one entity**, `supplier_type = AGENT`, `parent_supplier` pointing at whoever invoices
- [ ] **Not a separate entity** — that mirrors SAP without pre-empting it

### Seed

- [ ] World Fuel Services with **all four roles** populated, distinct numbers
- [ ] **One role with two contacts**, so `is_primary` does something
- [ ] **One agent** — `supplier_type = AGENT`, `parent_supplier` set — so the into-plane block is not the same row as the supplier block

### When integration comes

- [ ] `SUPPLIER_CONTACTS` → BP relationship **`BUR001`**, contact person
- [ ] `contact_role` → department / function
- [ ] `valid_from` · `valid_to` → **BP relationship validity, native**
- [ ] `supplier_type` → partner function on `WYT3`
- [ ] **Every field has a home. That is the test for a bridge rather than a divergence**

---

## D · Designated Supplier — NEW

### `DESIGNATED_SUPPLIERS`

- [ ] **`flight_number` — THE PRIMARY AXIS.** Corrected 1 September from the SME session
- [ ] `station` — secondary, for a default where no flight designation exists
- [ ] > *"Every flight is designated to a supplier, FIXED. Not like today you do it and tomorrow somebody else does it. Suppose I have 50 flights, I must split those 50 flights across 3 suppliers."*
- [ ] **I designed station as primary and flight as the exception. It is the other way round** — a supplier positions bowsers and tankage against named flights, which is why it cannot float
- [ ] `carrier_code`
- [ ] `product` — Jet A-1 versus SAF
- [ ] `supplier` · `contract`
- [ ] `valid_from` · `valid_to` · `priority`
- [ ] `designation_type` — `PRIMARY` · `ALTERNATE` · `EMERGENCY`

### Resolution — a cascade with a fallback · CONFIRMED 1 Sept

- [ ] **1 · a designation for this FLIGHT + date** → use it
- [ ] **2 · else a designation for the DEPARTING STATION + date** → use it
- [x] **3 · else NOTHING DEFAULTS.** The order can still be created; the supplier field is simply **empty** and the user picks one · CONFIRMED 1 Sept
- [ ] **Not a refusal.** An undesignated station is a gap in master data, not a reason to stop an order
- [ ] And **not a fallback to any contract at that station** — picking one arbitrarily is the join that over-matches, in a new place
- [ ] Departing station, not arriving — the uplift happens where the flight leaves from

### The into-plane structure · CONFIRMED 1 Sept

- [x] `supplier` — the fuel supplier, **always present**
- [x] **`supplier_contract`** — the contract for the fuel · CONFIRMED 1 Sept
- [x] **`supplier_performs_uplift`** — Boolean
- [x] `TRUE` → the supplier fuels directly, the agent fields **left blank**
- [x] `FALSE` → a third party fuels, `into_plane_agent` **MANDATORY**
- [x] **`into_plane_contract`** — the agent's own contract · CONFIRMED 1 Sept
- [ ] **Conditionally mandatory, not optional.** A blank agent could mean *the supplier fuels* or *nobody filled it in* — the flag distinguishes them
- [ ] Same shape as `apu_rate_source` and `severity_source`: **the fact, and the reason the fact looks that way**

### Two contracts, because there are two commercial relationships

- [ ] **The fuel is bought under one agreement; the service of putting it in the wing is bought under another**
- [ ] Different parties, different terms, **different invoices** — the HLD's `ZFUEL_ITP` and `ZFUEL_FEE` are exactly this split
- [ ] So an into-plane fee can be checked against **its own contract** rather than against the fuel contract
- [ ] Where the supplier performs the uplift, `into_plane_contract` is **blank** and the fee sits in the fuel contract — which the flag already tells you

### And it answers a question F25 could not

- [ ] `MASTER_CONTRACTS` today has no notion of **which contract applies to which flight**
- [ ] The designation now carries it — **flight or station, plus date, resolves to a contract**
- [ ] That is a resolution path the pricing engine does not have: `PRICING_FORMULAS` scopes by `company_code` and `supplier_id` and **has no contract column at all**
- [ ] **Worth flagging when the price story is built** — the designation knows the contract and the formula cannot be scoped to one

### And the uplift contact moves with the flag

- [ ] `TRUE` — invoicing, uplift and disputes contacts all on the supplier
- [ ] `FALSE` — invoicing and disputes on the supplier; **uplift and supervisor on the AGENT**
- [ ] **The uplift contact belongs to whoever fuels**

### Where it is consumed

- [ ] **The dispatch plan shows quantities ONLY.** Not the supplier
- [x] **The order defaults to the designated supplier and into-plane agent** — **where one resolves**
- [x] **Where none resolves, the order is still created and the field is blank.** The user picks
- [ ] So the default is a **convenience**, not a gate — and an empty supplier on an order is a visible prompt rather than a silent wrong choice
- [ ] **The user can override to an alternate**
- [ ] The flight schedule **displays** the designation; the order **commits** to it

---

## D2 · Fuelling responsibility — NEW, and it is the session's largest item

**A flag at FLIGHT level, time-dependent.** Not at tail level.

- [ ] `fuelling_required` — **yes/no, per flight, per station, DATE-RANGED**
- [ ] Maintained by the **customer** as master data
- [ ] > *"When I'm passing my flight schedule to the fuelling solution, somewhere I need a tick mark that I need to fuel or no. If I need to fuel, then I manage the operation."*

### Why NOT at tail level — I would have got this wrong

- [ ] **The tail is irrelevant.** *"You are serving the flight. The aircraft is just holding the fuel."*
- [ ] A tail swap onto a leased aircraft **does not change who fuels** — the lease is drawn against named flights, not open-ended
- [ ] > *"It is not an open-ended contract that says my tail, do whatever you feel like doing."*

### The pattern to copy — SIA's airport profile

- [ ] Flight number → **airport profile** → **services** beneath it
- [ ] Each service classified **routine / non-routine** and **mandatory / optional**
- [ ] ~1,000 services exist; ~100 apply to an average flight
- [ ] **Fuel is one service among them**, ticked or not
- [ ] When the flight operates at that airport, **every ticked service drops with its rate, quantity and amount**

### The qualifying fields · CONFIRMED 1 Sept

**Time-dependent mapping at FLIGHT level, and two qualifying fields beside the flag.**

- [ ] **`fuelling_required`** — the flag. Yes or no, per flight, per station, **date-ranged**
- [ ] **`arrangement_type`** — `OWN` · `CODESHARE` · `WET_LEASE` · `DAMP_LEASE` · `DRY_LEASE`
- [ ] **`primary_codeshare_flight_number`** — **the operating carrier's number**, where this is a codeshare

### Why the primary flight number matters

- [ ] A codeshare row is `EK231` in our schedule and **somebody else's flight in reality**
- [ ] The primary number says **which flight actually gets fuelled**, by whoever operates it
- [ ] Without it, a planner sees a flight with no fuelling and **no way to know what it maps to**
- [ ] > *"Neither is the aircraft yours, nor the fuel. Only you sold the ticket."*

### And the attributes explain, they do not determine

- [ ] **The FLAG decides whether fuelling is tracked.** The arrangement type says why
- [ ] So a wet-leased flight and a codeshare both read `fuelling_required = false` **for visibly different reasons**
- [ ] > *"You can mark all those attributes — this flight is managed through a wet lease agreement — and then yes fuel, no fuel, you can still maintain that reference."*

### The three wet-lease variants, confirmed by the SME

- [ ] `crew + DOC, EXCEPT fuel` — lessee fuels
- [ ] `crew + DOC, INCLUDING fuel` — lessor fuels and **may not even invoice**
- [ ] `crew only` — **the most common** — lessee takes DOC and fuel
- [ ] And a fourth: lessor fuels **and invoices the lessee later**, where the lessor holds the supplier agreements

---

## E · The effective-dating resolver — ONE, NOT FOUR

**Nothing in FuelSphere resolves by date today.** `valid_from`, `valid_to` and `priority` exist on several entities and **no code reads them.**

- [ ] tail → **carrier assignment** — F40
- [ ] contract → **carrier** — F40
- [ ] station or flight → **designated supplier**
- [ ] tail → **performance**

- [ ] **Build it once.** Three times is how it ends up inconsistent, and the fourth is where someone finds the first three disagree
- [ ] Every consumer asks *as at which date*, and **nothing currently does**

---

## E2 · Flight Fuel Overview page — NEW · CONFIRMED 1 Sept

**A Fiori overview page. Nine cards, everything about one flight in one screen.**
Mockup: `docs/design/flight_overview.html`

- [x] The scenario slides are already cards, so the format translates directly
- [x] **Every card drills to the screen it summarises**
- [ ] Note the UI standard's position: **an overview page is a MONITORING floorplan**, distinct from a working screen. This one is a reading surface, not a place to act

### Identity strip — what the slides did not carry

- [x] **Flight number · route · date** — large, and first
- [x] Tail · type · carrier
- [x] **Terminal · gate · stand**
- [x] STD · STA in UTC
- [x] **Supplier and into-plane agent by name**
- [x] **Linked flight** with its route
- [x] Three tags: flight status, **`FUELLING REQUIRED`**, **arrangement type**

### The nine cards, in the planner's order not the model's

- [x] **1 · Fuel status** — the verdict. By meter, by gauge, variance, tolerance, and **which rung governed**
- [x] **2 · Dispatch plan** — the stack that sums, and the required uplift
- [x] **3 · Aircraft** — MTOW · MLW · MZFW · DOW · capacity · engine burn · APU burn · **register status**
- [x] **4 · Supplier and into-plane agent** — **double width.** Both contracts, and the contacts
- [x] **5 · Fuel orders** — a table, several possible
- [x] **6 · Fuel tickets** — a table, several possible
- [x] **7 · Delivery** — the gauge pair, the refuel window, supplier count
- [x] **8 · Burn** — **double width.** The OOOI timeline, block/trip/taxi, and the ground split at closure
- [x] **9 · Invoicing** — the IDR, the vendor reference, and the posting gate

### Two things the supplier card does deliberately

- [x] **`performs uplift: NO`** → the **uplift contact sits with the AGENT**; invoicing and disputes stay with the supplier
- [x] **Both contracts shown** — one for the fuel, one for the handling

### And the burn card carries the closure split

- [x] `APU in block 0.00` **with the reason beneath it** — *no cycle falls between OUT and IN*
- [x] Ground YYZ and ground YUL as separate figures, **split at flight closure**

---

## F · Demo script — steps agreed

- [ ] **Step 1 · Flight Schedule.** View only. *The schedule is received, not created*
- [ ] Filtered list, then drill into one flight
- [ ] From one flight: dispatch, orders, tickets, deliveries, burn
- [ ] **Step 2 · Dispatch Plan.** Quantities and the stack that sums
- [ ] Contingency is **5% of TRIP**, not of block
- [ ] Uplift is **block less fuel already on board**
- [ ] Versioning mentioned **only if asked**

---

## G · Open, and needing an answer

- [ ] **Is the demo airline on S/4 or ECC?** `KNVK`/`WYT3` are ECC-era; S/4 uses BP relationships. **Ask Shailesh**
- [ ] Does the S/4 integration pull **contact persons**? Depends on the `SAP_COM_0008` payload
- [ ] **Do contacts on a POSTED invoice need pinning?** *Who did we call at the time* is a different question from *who do we call now* — not on the flight schedule, but somewhere
- [ ] F40's carrier entity — **every determination above resolves by company code and there is no carrier**

---

## H · Not raised, and worth a decision

- [ ] **SAF versus Jet A-1** — `product` is on the designation and nothing else in the demo distinguishes them
- [ ] **Emergency designation** — `EMERGENCY` is in the enum. What triggers it, and does anything show it?
- [x] ~~**A station with no designation at all**~~ — **ANSWERED 1 Sept.** The order is created and **the vendor does not default.** Neither refusal nor fallback: an empty field the user fills

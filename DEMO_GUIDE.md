# FuelSphere Demo Guide — Complete Lifecycle Walkthrough

## Pre-Demo Setup

```bash
# Start fresh with clean data
cd /home/user/FuelSphere
rm -f db.sqlite && npx cds deploy && npx cds serve all --port 4004
```

Open browser to: `http://localhost:4004/admin/index.html`

**Test Users** (any password works):
| User | Role | Best for |
|------|------|----------|
| alice | Full Admin | Demo walkthrough |
| dispatch | Dispatch Team | Planning persona |
| cockpit | Cockpit Crew | Planning persona |
| supplier | Supplier Planner | Fulfillment persona |
| delivery | Delivery Crew | Fulfillment persona |
| ops | Operations Manager | Operations persona |
| finance | Finance Controller | Invoicing persona |

---

## Demo Story: Air Canada Fuel Lifecycle

The demo follows **Air Canada flights on March 24-27, 2026** through every stage of the fuel order lifecycle. Each flight is at a different stage, showing the complete journey from planning to invoice settlement.

### Flight Summary (12 AC Flights)

| Flight | Route | Date | Aircraft | Status | Lifecycle Stage |
|--------|-------|------|----------|--------|-----------------|
| AC601/602 | YYZ-YUL-YYZ | Mar 24 | A220 C-GROV | ARRIVED | **Step 7: Completed & Invoiced** |
| AC101 | YYZ-LHR | Mar 25 | B777 C-FITU | SCHEDULED | **Step 5: InProgress (delivery happening)** |
| AC102 | LHR-YYZ | Mar 25 | B777 C-FITU | SCHEDULED | **Step 6: Delivered (ticket signed)** |
| AC401 | YVR-NRT | Mar 25 | B787 C-GHPX | DEPARTED | **Step 4B: Crew adjusted quantity** |
| AC301 | YYZ-CDG | Mar 26 | B787 C-GHPQ | SCHEDULED | **Step 3: Confirmed (dispatch done)** |
| AC501 | YYZ-FLL | Mar 26 | A330 C-GFAH | SCHEDULED | **Step 4: Crew confirmed** |
| AC201 | YYZ-YVR | Mar 26 | A220 C-GROV | SCHEDULED | **Step 2: Draft order** |
| AC901 | YYZ-LHR | Mar 27 | (none) | SCHEDULED | **Step 1: No aircraft assigned** |

---

## Part 1: Admin Portal (Hub)

**URL:** `/admin/index.html`

### What to Show
1. **Cross-App KPIs** — Active Flights, Open Fuel Orders, Pending Deliveries, Invoices to Process
2. **Application Tiles** — 4 apps in lifecycle sequence (Step 1-4 badges):
   - Planning -> Fulfillment -> Operations -> Invoicing
3. **Fiori Quick Links** — Master Data, Fuel Orders, Invoices, Burns, Pricing, Integration

### Talking Points
- "FuelSphere is a unified hub managing the entire fuel lifecycle from planning through settlement"
- "Each tile represents a step in the process, with role-based access for different personas"
- "KPIs give leadership an at-a-glance view of operational health"

---

## Part 2: Planning App (Step 1)

**URL:** `/planning/index.html`

### Demo Flow (5 minutes)

1. **KPIs** — Show flights needing fuel plans, pending crew reviews, pilot overrides, confirmed plans
2. **3-Figure Comparison Grid** — This is the key differentiator:
   - **Dispatch Qty** (blue column): From TripRecord/Legate system
   - **Planner Qty** (purple column): FuelSphere calculated quantity
   - **Cockpit Qty** (orange column): Captain's final decision
   - Show AC401 where captain adjusted from 65,000 to 63,000 kg due to tailwinds
3. **Persona Dropdown** — Switch between Dispatch Team, Fuel Planner, Cockpit Crew
   - Each persona highlights their relevant column
4. **Flight Schedule Table** — Show the 12 AC flights with enrichment status
   - AC901 has no aircraft (needs enrichment)
   - AC101 is fully enriched (B777, C-FITU, Gate G45)
5. **Upload Areas** — Flight schedule upload and dispatch data upload

### Key Data Points
| Flight | Dispatch Qty | Planner Qty | Cockpit Qty | Status |
|--------|-------------|-------------|-------------|--------|
| AC301 YYZ-CDG | 48,000 kg | 48,000 kg | (pending) | Confirmed |
| AC101 YYZ-LHR | 82,000 kg | 82,000 kg | 82,000 kg | InProgress |
| AC401 YVR-NRT | 65,000 kg | 65,000 kg | 63,000 kg | **Adjusted** |
| AC601 YYZ-YUL | 2,200 kg | 2,200 kg | 2,200 kg | Completed |

### Talking Points
- "The 3-figure comparison ensures safety — dispatch, planner, and cockpit all independently calculate fuel"
- "When the captain adjusts quantity, the system requires a reason (e.g., tailwinds forecast)"
- "SOX-compliant audit trail tracks every change with timestamp and user"

---

## Part 3: Fulfillment App (Step 2)

**URL:** `/fulfillment/index.html`

### Demo Flow (5 minutes)

1. **Fulfillment Pipeline** — 6-stage visual pipeline:
   - RECEIVED (2) -> CONFIRMED (2) -> SCHEDULED (1) -> IN_DELIVERY (0) -> DELIVERED (1) -> INVOICED (1)
   - Plus 1 CLOSED order
2. **KPIs** — Active Orders, Deliveries Scheduled, Tickets Pending, Completed
3. **Persona Dropdown** — Switch between Supplier Planner and Delivery Crew:
   - **Supplier Planner**: Sees pipeline overview + sales orders table
   - **Delivery Crew**: Sees ticket generation + photo upload + UoM validation
4. **Fuel Ticket Cards** — Show delivery records with ePOD data:
   - EPD-YYZ-20260324-001: AC601, 2,180 kg, Posted
   - EPD-LHR-20260325-001: AC102, 79,800 kg, Posted
5. **UoM Cross-Validation Table** — KG/LTR/GAL/USG conversion factors
6. **Sales Orders Table** — 8 orders showing the full supplier view

### Key Data Points — Supplier View (Sales Orders)
| SO # | Flight | Station | Status | Qty |
|------|--------|---------|--------|-----|
| SO-YYZ-20260327-001 | AC201 | YYZ | RECEIVED | 8,500 kg |
| SO-YYZ-20260326-001 | AC301 | YYZ | RECEIVED | 48,000 kg |
| SO-YYZ-20260326-002 | AC501 | YYZ | CONFIRMED | 15,000 kg |
| SO-YVR-20260325-001 | AC401 | YVR | SCHEDULED | 65,000 kg |
| SO-YYZ-20260325-001 | AC101 | YYZ | CONFIRMED | 82,000 kg |
| SO-LHR-20260325-001 | AC102 | LHR | DELIVERED | 79,800 kg |
| SO-CDG-20260326-001 | AC302 | CDG | INVOICED | 48,500 kg |
| SO-YYZ-20260324-001 | AC601 | YYZ | CLOSED | 2,180 kg |

### Talking Points
- "This is the SELLER'S view — the fuel supplier sees orders flowing through their pipeline"
- "Delivery crew uses mobile devices to capture ePOD with photos, meter readings, signatures"
- "UoM validation ensures KG/LTR/GAL conversions are within density specs (0.775-0.840 kg/L)"

---

## Part 4: Operations App (Step 3)

**URL:** `/operations/index.html`

### Demo Flow (7 minutes)

1. **D-Minus Timeline** — Show the 4 planning horizons:
   - D-3: Flights created (AC901 — no aircraft yet)
   - D-2: Flights enriched (aircraft/tail assigned)
   - D-1: Dispatch complete (quantities confirmed)
   - D-0: Day of flight (refueling, tickets, invoicing)
2. **Flight Cycle Events** — 8-stage visual:
   Landing -> Taxi In -> Chocks On -> **Refueling** -> Chocks Off -> Taxi Out -> Takeoff -> Airborne
3. **7-Step Journey Timeline** — The core of operations:
   - Step 1: Flight Created (flights without orders)
   - Step 2: Flight Enriched (Draft/Submitted orders)
   - Step 3: Dispatch Complete (Confirmed, no crew review)
   - Step 4: Crew Review (Captain confirmed/adjusted)
   - Step 5: Refueling (InProgress deliveries)
   - Step 6: Ticket Signed (Delivered with PO/GR)
   - Step 7: Invoice Settled (Completed)
4. **KPIs** — Active Orders, Pending Crew Reviews, InProgress Deliveries, Completed
5. **Burn Analysis Tiles** — Total Burn, Avg Burn/Flight, Total Uplift, Variance Records
   - Total burn across 4 flights: ~133,700 kg
   - AC102 LHR-YYZ used 63,500 kg (planned 64,000 — 0.78% under)
   - AC101 YYZ-LHR used 67,200 kg (planned 68,000 — 1.18% under)
6. **Persona Dropdown** — Dispatch Team vs Ops Manager:
   - **Dispatch Team**: D-minus timeline + journey focus (hides burn analysis)
   - **Ops Manager**: Full view including burn data

### Talking Points
- "The D-minus timeline mirrors airline operations — planning starts 3 days before departure"
- "The 7-step journey shows EXACTLY where every fuel order is in the lifecycle"
- "Burn variance analysis catches fuel efficiency issues — all within 2% normal range"
- "ROB tracking: C-FITU (B777) went from 96,300 kg in YYZ to 110,900 kg after LHR delivery"

---

## Part 5: Invoicing App (Step 4)

**URL:** `/invoicing/index.html`

### Demo Flow (5 minutes)

1. **KPIs** — Total Invoices (3), Pending Verification (2), Exception Queue (2), Posted (1)
2. **Three-Way Match Diagram** — Visual PO-GR-Invoice matching:
   - PO count, GR count, Invoice count with green check connectors
   - Tolerance indicators: Qty (5%), Price (2%), Exceeds threshold
3. **Invoice Table** — 3 invoices at different stages:
   | Invoice | Supplier | Amount | Status | Match | Tolerance |
   |---------|----------|--------|--------|-------|-----------|
   | INV-WFS-20260324-001 | WFS (YYZ) | USD 2,094.40 | POSTED | MATCHED | OK |
   | INV-BPUK-20260325-001 | BP (LHR) | USD 73,288.32 | SUBMITTED | PARTIAL | OK |
   | INV-TFS-20260326-001 | TFS (CDG) | EUR 45,016.70 | DRAFT | PENDING | N/A |
4. **Exception Queue** — Shows SUBMITTED and DRAFT invoices needing review
5. **Buyer/Seller Toggle**:
   - **Buyer View**: Full 3-way match + exception queue + approval workflow
   - **Seller View**: Hides exception queue (seller doesn't see buyer's internal review)

### Talking Points
- "Three-way match is a SOX control — PO, Goods Receipt, and Invoice must agree within tolerance"
- "The AC601 invoice is a perfect match: PO ordered 2,200 kg, delivered 2,180 kg (-0.91% variance), invoiced at exact delivery quantity"
- "The AC102 LHR invoice is SUBMITTED and awaiting verification — $73K needs finance controller approval"
- "The CDG invoice is still DRAFT — supplier submitted but AP clerk hasn't processed it yet"
- "Buyer vs Seller view demonstrates role-based access — the supplier never sees the exception queue"

---

## Part 6: Cross-App Navigation

### Demonstrate the Lifecycle Flow
1. Start at **Admin Portal** -> Click **Planning** tile
2. In Planning, use header nav -> Click **Step 2: Fulfillment**
3. In Fulfillment, use header nav -> Click **Step 3: Operations**
4. In Operations, use header nav -> Click **Step 4: Invoicing**
5. In Invoicing, use footer links -> Click **Admin Portal** to return

### Demonstrate Persona Switching
1. In **Planning**: Switch Dispatch -> Planner -> Cockpit (column highlights change)
2. In **Fulfillment**: Switch Supplier Planner -> Delivery Crew (sections show/hide)
3. In **Operations**: Switch Dispatch Team -> Ops Manager (burn section shows/hides)
4. In **Invoicing**: Switch Buyer -> Seller view (exception queue hides)

---

## Appendix: Complete Data Map

### How Data Flows Across Apps

```
FLIGHT_SCHEDULE (12 flights)
    |
    v
FUEL_ORDERS (7 orders at steps 2-7)
    |
    +---> FLIGHT_DISPATCH (7 dispatches)  -----> Planning App
    |
    +---> FUEL_DELIVERIES (3 deliveries)  -----> Fulfillment App
    |         |
    |         +---> FUEL_TICKETS (2 tickets)
    |
    +---> FUEL_SALES_ORDERS (8 seller-view) ----> Fulfillment App
    |
    +---> FUEL_BURNS (4 burn records)      -----> Operations App
    |         |
    |         +---> ROB_LEDGER (9 entries)
    |
    +---> INVOICES (3 invoices)            -----> Invoicing App
              |
              +---> INVOICE_ITEMS (3 line items)
              +---> INVOICE_MATCHES (2 matches)
              +---> INVOICE_APPROVALS (3 actions)
```

### The "Golden Thread" — AC601 YYZ-YUL (Complete Journey)

This single flight shows every step:

1. **Planning**: Flight scheduled Mar 24, A220 C-GROV, YYZ-YUL
2. **Dispatch**: 2,200 kg planned, ROB 8,500 kg departure
3. **Crew Review**: Capt. L. Tremblay confirmed as-planned
4. **Delivery**: EPD-YYZ-20260324-001, delivered 2,180 kg at 06:30
5. **Ticket**: WFS-YYZ-2026032401, closed and verified
6. **Burn**: ACARS confirmed 1,480 kg actual (planned 1,500, -1.33% variance)
7. **ROB**: Started 0 -> Uplift 2,200+2,180 -> Burn 1,480+1,520 -> Final 1,380 kg
8. **Invoice**: INV-WFS-20260324-001, USD 2,094.40, POSTED to S/4HANA
9. **Settlement**: 3-way match PASSED (qty variance -0.91%, within 2% tolerance)

### FAQ for Managers

**Q: How does FuelSphere integrate with S/4HANA?**
A: PO creation (SAP_COM_0164), Goods Receipt (SAP_COM_0367), Invoice posting (SAP_COM_0028). See orders A006/A007 with s4_po_number fields.

**Q: What are the SOX controls?**
A: INV-001 (creator can't approve), INV-003 (3-way match), INV-004 (duplicate detection), INV-005/006 (variance thresholds).

**Q: How is fuel demand calculated?**
A: Total = Trip + Taxi + Contingency + Alternate + Reserve + Extra. The 3-figure comparison validates across dispatch, planner, and cockpit.

**Q: What roles exist?**
A: 6 personas — Dispatch Team, Fuel Planner, Cockpit Crew, Supplier Planner, Delivery Crew, Finance Controller. Plus Admin and Ops Manager.

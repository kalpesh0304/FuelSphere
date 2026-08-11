# UI_INVENTORY.md — Screens & Actions (As Built)

> **Framing:** The brief assumes SAP Fiori Elements apps (App ID, semantic object/action, floorplans). The build's real UI is **5 hand-coded freestyle HTML/JS "dashboard" apps** under `app/*/webapp/` served by `@sap/approuter`. They are **not** UI5/Fiori Elements apps — no `manifest.json`, no `sap.app` component, no semantic objects. Each is a single `index.html` + `app.js` + `style.css` calling OData v4 with `fetch()`. There is **also** an auto-generated `$fiori-preview` (list reports from `*-fiori-annotations.cds`), separate from these apps.

## 1. App-router configuration (`app/xs-app.json`)

| Property | Value | Note |
|---|---|---|
| `welcomeFile` | `/admin/index.html` | Landing page = Admin Portal |
| `authenticationMethod` | `route` | |
| `sessionTimeout` | `60` (min) | |
| UI routes (`/admin`, `/operations`, `/planning`, `/fulfillment`, `/invoicing`) | `authenticationType: "none"` | **UI static content is unauthenticated** |
| `/odata/v4/*` | `authenticationType: "xsuaa"`, `csrfProtection: true`, destination `srv-api` | Backend requires auth |

## 2. Fiori app inventory (the 5 freestyle apps)

There are no App IDs / semantic objects (not UI5). "Technical name" = route folder. Floorplan = freestyle dashboard.

### 2.1 Admin Portal — `app/admin`
- **Title:** "FuelSphere — Admin Portal" · **Route:** `/admin` (welcome file)
- **Purpose:** KPI landing/overview tiles.
- **Floorplan:** Freestyle overview (KPI cards). ~63 lines.
- **OData:** `/odata/v4/orders`, `/odata/v4/invoice` (reads `FuelOrders`, `Invoices`, `FlightSchedule`).
- **Actions:** **Read-only** (0 write methods). Functions: `loadKPIs`, `odata`, `setText`, `updateDateTime`.
- **Users/roles:** not enforced at UI (route auth `none`); backend needs any authenticated user.

### 2.2 Operations Dashboard — `app/operations`
- **Title:** "FuelSphere — Operations Dashboard" · **Route:** `/operations`
- **Purpose:** Cross-domain ops monitoring — burn analysis, delivery tracker, finance summary, ROB.
- **Floorplan:** Freestyle multi-panel dashboard with persona switch (`applyPersona`). ~445 lines.
- **OData:** `/odata/v4/burn`, `/odata/v4/orders` (reads `FuelBurns`, `ROBLedger`, `FuelDeliveries`, `FuelOrders`, `FuelTickets`, `FlightSchedule`, `FlightDispatches`).
- **Actions:** **Read-only** (0 writes). Renders status badges (CONFIRMED/ADJUSTED/POSTED/PENDING/SIGNED).

### 2.3 Fuel Planning — `app/planning`
- **Title:** "FuelSphere — Fuel Planning" · **Route:** `/planning`
- **Purpose:** Flight schedule management, crew review, Excel uploads. ~933 lines (largest app).
- **Floorplan:** Freestyle worklist + upload + modal editor.
- **OData:** `/odata/v4/planning`, `/odata/v4/orders`, `/odata/v4/master`.
- **Actions (the only app with writes):**

| Label | What it does | Method → target | Precondition | Result |
|---|---|---|---|---|
| Save (crew adjust modal) | Edits flight schedule / crew-review fields | `PATCH /planning/FlightSchedule(id)` (app.js:544, 757) | flight row selected | fields updated |
| Upload Flight Schedule | Imports flight schedule xlsx | `POST /planning/importFlightScheduleExcel` (app.js:792) | .xlsx/.xls, valid cols | flights + Draft orders created |
| Upload Flight Dispatch | Imports dispatch xlsx | `POST /orders/importFlightDispatchExcel` (app.js:810) | flight match exists | `FLIGHT_DISPATCH` rows |
| Confirm / Adjust (crew) | Sets crew review status (PENDING/CONFIRMED/ADJUSTED) | via PATCH above | — | crew fields set |

- Single-record (modal) + file upload (bulk import). Not multi-select.

### 2.4 Fulfillment & Delivery — `app/fulfillment`
- **Title:** "FuelSphere — Fulfillment & Delivery" · **Route:** `/fulfillment`
- **Purpose:** Delivery tracking, ePOD display, document flow, sales orders. ~780 lines.
- **OData:** `/odata/v4/orders`, `/odata/v4/refueler` (reads `SalesOrders`, `FuelDeliveries`, `FuelOrders`, `FuelTickets`).
- **Actions:** **No backend writes found (0 POST/PATCH/PUT).** A **"Capture Signature"** button (app.js:337) opens an ePOD modal with **read-only** fields (app.js:691); **no `fetch` to `captureSignatures`** exists. ⇒ the ePOD capture action is **present in the UI but not wired to the backend** (backend `captureSignatures` action exists in `order-service.js` but this app never calls it). Photo-upload button is disabled once a ticket exists.

### 2.5 Invoice Verification — `app/invoicing`
- **Title:** "FuelSphere — Invoice Verification" · **Route:** `/invoicing`
- **Purpose:** Invoice dashboard — match status, tolerance badges, approval queue view. ~174 lines.
- **OData:** `/odata/v4/invoice`, `/odata/v4/orders` (reads `Invoices`, `InvoiceMatches`, `FuelOrders`, `FuelDeliveries`).
- **Actions:** **Read-only** (0 writes). Renders `matchBadge`, `toleranceBadge`, `statusBadge` (EXCEEDS/PENDING/Review). No approve/reject/post buttons wired (and the backend has no invoice JS anyway).

## 3. Navigation map

```
approuter welcomeFile → /admin (Admin Portal)
   ├─ /operations   (Operations Dashboard)
   ├─ /planning     (Fuel Planning)      ── PATCH/POST to planning+orders
   ├─ /fulfillment  (Fulfillment)        ── read-only (+ non-wired ePOD button)
   └─ /invoicing    (Invoice Verification) ── read-only
```
- Apps are siblings under the router; cross-navigation is via shared `fuelOrderLink()` helpers (deep links between operations/planning/fulfillment on order id). No central Fiori Launchpad tile page is served (the `CONFIG_TILES`/`CONFIG_PERSONAS` data is **not** consumed by these apps).

## 4. Screens that exist but are not reachable from a launchpad

- **`$fiori-preview` list reports** — generated from `*-fiori-annotations.cds` for ~40 entities (FuelOrders, FuelTickets, FuelBurns, Invoices, PricingFormulas, MarketIndices, Airports, Aircraft, etc.). These are **dev-preview only** (`fiori.preview` in package.json), **not** in the app router, so not reachable by end users. They render bare `UI.LineItem` tables only — **no object pages** (0 `UI.Facets`/`HeaderInfo`/`SelectionFields` across all annotation files).
- **9 services have no UI at all:** Compliance, Contracts, Pricing, Allocation, Analytics, Security, Admin(service), Integration, and most Burn actions — reachable only via raw OData or `$fiori-preview`.

## 5. Actions present in OData service but NOT exposed in any UI

The vast majority of declared OData actions are unreachable from the 5 apps:

| Service | Actions declared | Exposed in a UI app |
|---|---|---|
| FuelOrderService | submit, confirm, startDelivery, cancel, crewReview, calculatePrice, captureSignatures, verifyQuantity, dispute, validateDelivery, createOrderFromFlight, importFlightDispatchExcel (12+) | Only `importFlightDispatchExcel` (via planning). **`captureSignatures` button exists but not wired.** submit/confirm/startDelivery/cancel/etc. **not in any UI** |
| BurnService | ingestACARS/EFB, confirm, reject, adjustROB, batchConfirm, imports (30+) | **None** (operations app only reads burn data) |
| RefuelerService | confirmOrder, scheduleDelivery, recordDelivery, createInvoice, cancel | **None** (fulfillment only reads) |
| InvoiceService | executeThreeWayMatch, approve, finalApprove, postToS4HANA, checkDuplicate (20+) | **None** (invoicing only reads) — and no backend impl either |
| PricingService, AllocationService, ComplianceService, SecurityService, IntegrationService, AnalyticsService, ContractsService, AdminService | 100+ actions/functions | **None** |

**Net:** of the ~250 declared OData actions/functions across services, only **3 import actions** and **PATCH-based flight-schedule editing** are actually invoked by the shipped UI.

## Unanswered / needs access

| Item | Why | Access needed |
|---|---|---|
| Whether a separate FuelSphere-UI (Fiori Elements) project provides the "real" apps | CLAUDE.md references a separate `FuelSphere-UI` repo not in this repo | The FuelSphere-UI repository |
| Role-to-app mapping in production launchpad | No launchpad served here; persona data unused by these apps | BTP launchpad / Work Zone config |
| Whether `$fiori-preview` is enabled in production | It's a dev feature flag | Deployed config |

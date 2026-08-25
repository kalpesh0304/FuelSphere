# Scenario 1 — UI Walkthrough Plan

**Which screens, which exist, what Claude can build**
25 August 2026

---

## 1. The short answer

**Every screen the walkthrough needs already renders.** Twelve entities, all measured as *demo-ready* — curated columns, a filter bar, and a structured object page.

**What is missing is not screens. It is three things:**

| | |
|---|---|
| **Field placement** | 22 fields from UI-B-03, plus 25 from WP-33 and 5 from WP-31, all carry a label and appear nowhere |
| **Navigation** | Related-items facets, so an order leads to its delivery leads to its tickets |
| **Seed data** | The corrected S1 set. Screens showing wrong figures are worse than no screens |

**Claude can do the first two.** The third is a seeding task Claude can also do. **The fourth thing — moving between the two service clusters — cannot be done here.**

---

## 2. The walkthrough — nine stops

Following the scenario as the deck tells it.

| | Screen | Service | What it shows |
|---|---|---|---|
| **1** | Flight Schedule | `PlanningService` | `AC410`, 10 April, `C-FDMO`, `ARRIVED` |
| **2** | Dispatch Plan | `FuelOrderService` | The regulated stack summing to 4,202.50 |
| **3** | Fuel Order | `FuelOrderService` | 2,881.25 LTR, its density and its source |
| **4** | Fuel Ticket | `FuelOrderService` | Meter start and end, density, 2,305.76 kg |
| **5** | Delivery | `FuelOrderService` | The gauge pair, the variance, `RECONCILED` |
| **6** | APU Usage | `BurnService` | **Two cycles — where 52.50 and 33.25 come from** |
| **7** | Fuel Burn | `BurnService` | Block, trip, taxi, engine and APU split |
| **8** | ROB Ledger | `BurnService` | Five rows, one chain, closing 1,889.25 |
| **9** | Master data | `MasterDataService` | Aircraft, supplier, contract, airport |

**Stop 6 is the one that earns its place.** Everywhere else the number is on the screen; here the screen shows *how the number was produced* — two timestamps and a per-tail rate.

---

## 3. What already exists

Measured against a running service, not inferred.

| Entity | Columns | Filters | Facets | Verdict |
|---|---|---|---|---|
| `PlanningService.FlightSchedule` | 12 | 7 | 7 | **demo-ready** |
| `FuelOrderService.FlightDispatches` | 12 | 4 | 6 | **demo-ready** |
| `FuelOrderService.FuelOrders` | 11 | 6 | 9 | **demo-ready** |
| `FuelOrderService.FuelTickets` | 12 | 4 | 3 | **demo-ready** |
| `FuelOrderService.FuelDeliveries` | 15 | 5 | 7 | **demo-ready** |
| `BurnService.ApuUsage` | 9 | 4 | 3 | **demo-ready** |
| `BurnService.FuelBurns` | 13 | 5 | 5 | **demo-ready** |
| `BurnService.ROBLedger` | 12 | 4 | 4 | **demo-ready** |
| `MasterDataService.AircraftRegistrations` | 10 | 5 | 4 | **demo-ready** |
| `MasterDataService.Contracts` | 9 | 6 | 5 | **demo-ready** |
| `MasterDataService.Airports` | 8 | 6 | 4 | **demo-ready** |
| `MasterDataService.Suppliers` | 7 | 5 | 3 | **demo-ready** |

**Twelve of twelve.** Nothing has to be built from nothing.

> And these annotations reach the deployed apps directly. **Every deployed app's `annotation.xml` is an empty stub**, so every column, filter and facet comes from the CDS through `$metadata`.

---

## 4. Navigation — and the shape of it decides the demo

### Two clusters, and each is self-contained

**`FuelOrderService` exposes** `FuelOrders`, `FuelDeliveries`, `FuelTickets`, `FlightSchedule`, `FlightDispatches`, plus every master entity.

**`BurnService` exposes** `FuelBurns`, `ROBLedger`, `ApuUsage`, and — usefully — `FlightSchedule`, `FuelDeliveries` and `FuelOrders` as well.

**So stops 2 to 5 are one service. Stops 6 to 8 are another. And each cluster can reach back to the flight.**

### Within a cluster, navigation is pure annotation

```cds
UI.Facets : [
  { $Type : 'UI.ReferenceFacet',
    Target: 'tickets/@UI.LineItem',
    Label : 'Fuel Tickets' }
]
```

**That puts a related-items table on the object page**, and a row in it navigates to that entity's own object page. **No app change, no launchpad, no code.**

### Between clusters, it is not

Moving from a delivery in `FuelOrderService` to the burn in `BurnService` needs **intent-based navigation** — semantic objects and a launchpad site.

**That is BTP cockpit configuration and cannot be done from here.**

> **The practical answer:** the walkthrough crosses that boundary once, between stop 5 and stop 6. **Cross it by opening a second tab.** One deliberate hop in a nine-stop walk is not a flaw worth a week of launchpad work.

### One thing to establish before building any of it

**Do the associations exist?** A `ReferenceFacet` needs one, and the target must be exposed on the same service.

`FUEL_ORDERS.dispatch_plan` was added by WP-18. `FUEL_TICKETS` reaches its order and its delivery. **The rest I have not verified**, and I have asserted schema facts wrongly enough this week to say so rather than assume.

---

## 5. What has to be built

| | Effort | Who |
|---|---|---|
| **Place the unplaced fields** | 52 across five entities. Annotations only | **Claude** |
| **Related-items facets** | Roughly eight, within the two clusters | **Claude** |
| **Seed the corrected S1** | Per the correction specification, including the four empty tables | **Claude** |
| **Cross-cluster navigation** | Semantic objects, launchpad site | **Not here** |
| **A launchpad at all** | Portal service entitlement | **Not here** |

### The 52 fields

```
UI-B-03    22    dispatch stack, versioning, tail associations
WP-33      25    fob at OOOI, closure, actual stations, order
                 communication, lineage, tankering, refuel window
WP-31       5    document associations
```

**Every one has a `@title` and no placement**, because every package since WP-UI-02 added a label and deferred the rest.

**Stop 2 is where this bites hardest** — seventeen of the twenty-two are on the dispatch plan, which means **the regulated stack is currently invisible on the screen that exists to show it.**

---

## 6. Can Claude build it

**Yes, for everything except the launchpad.**

| | |
|---|---|
| **Annotations** | Claude Code writes them and verifies in `$fiori-preview`, which you now have running locally |
| **Navigation within a service** | Same — it is a `UI.Facets` entry |
| **Seed data** | CSVs, and the correction specification has every value |
| **Verification** | Against a running service, which is how everything else has been checked |
| **The launchpad, semantic objects, cross-service intents** | **No.** BTP cockpit, tenant access, and the Portal entitlement that does not exist |

### And there is a way to demonstrate without a launchpad

**`$fiori-preview` renders every one of the twelve**, on your machine, from the corrected seed:

```
http://localhost:4004/$fiori-preview/PlanningService/FlightSchedule
http://localhost:4004/$fiori-preview/FuelOrderService/FlightDispatches
http://localhost:4004/$fiori-preview/FuelOrderService/FuelOrders
http://localhost:4004/$fiori-preview/FuelOrderService/FuelTickets
http://localhost:4004/$fiori-preview/FuelOrderService/FuelDeliveries
http://localhost:4004/$fiori-preview/BurnService/ApuUsage
http://localhost:4004/$fiori-preview/BurnService/FuelBurns
http://localhost:4004/$fiori-preview/BurnService/ROBLedger
```

**Navigation within each service works.** Crossing between them is a bookmark.

> **Say plainly what it is if asked.** These are development previews of the production Fiori applications, rendering the same annotations those applications read. **What is missing is the launchpad, not the screens.**

---

## 7. Sequence

**1 · Seed the corrected S1.** Everything else shows wrong figures until this lands, and a screen showing 4,803 kg beside a slide showing 2,305 is worse than no screen.

**2 · Place the fields.** Start with the dispatch stack — seventeen fields, and the biggest single gain.

**3 · Add the facets.** Survey the associations first; build only where one exists.

**4 · Walk it locally**, against the seed, and fix whatever the walk finds.

**5 · Then decide about the launchpad**, knowing what it would add — which is one hop out of nine.

---

## 8. Two things worth deciding

**Does the demo run locally or on BTP?**

Locally: works today, no entitlement, no deployment. **Reads as a development environment**, and the URLs say `localhost`.

On BTP: needs the `srv` module deployed and the four apps repointed. **Looks like a product**, and the launchpad hop still needs the Portal service.

**And does stop 9 belong at the start or the end?**

The master data explains where the supplier, contract and product came from. **Shown first, the resolution later does not look like magic. Shown last, it answers a question the audience has been carrying.**

I would show it first and briefly. **Magic invites doubt, and it invites it early.**

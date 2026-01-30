# FuelSphere - Claude Development Guide

This file contains project-specific patterns, conventions, and context for Claude to reference during development.

## Project Overview

- **Name**: FuelSphere - Airline Fuel Lifecycle Management Solution
- **Tech Stack**: SAP CAP (Node.js), SAP HANA Cloud, OData V4
- **Target Platform**: SAP BTP (Business Technology Platform)
- **Architecture**: CAPM Backend Only (UI in separate FuelSphere-UI project)
- **Node.js**: Requires Node 18, 20, or 22 (NOT Node 24)
- **CDS Version**: @sap/cds ^8

## Project Architecture

FuelSphere follows a decoupled architecture:

```
FuelSphere/           # CAPM Backend (this project)
├── db/               # Data model definitions (schema.cds ~185KB)
│   └── data/         # 75+ CSV seed data files
├── srv/              # 18 OData service definitions
├── docs/             # Design specifications & Figma exports
├── mta.yaml          # BTP deployment descriptor
└── xs-security.json  # XSUAA security config (17 scopes, 9 roles)

FuelSphere-UI/        # Fiori UI Applications (separate project)
├── apps/             # Individual UI5 apps
├── router/           # App Router
└── mta.yaml          # UI deployment descriptor
```

## Project Structure

```
FuelSphere/
├── db/
│   ├── schema.cds              # Complete data model (~185KB, 75+ entities)
│   └── data/                   # 75 CSV mock data files
├── srv/
│   ├── admin-service.cds       # Administration service
│   ├── allocation-service.cds  # Cost allocation module (FDD-09)
│   ├── analytics-service.cds   # Reporting & analytics (FDD-12)
│   ├── authorization.cds       # RBAC annotations for all services
│   ├── burn-service.cds        # Fuel burn & ROB tracking (FDD-08)
│   ├── compliance-service.cds  # Embargo compliance (FDD-07)
│   ├── contracts-service.cds   # Contract management (FDD-03)
│   ├── fiori-annotations.cds   # UI annotations for Fiori preview
│   ├── integration-service.cds # API monitoring (FDD-11)
│   ├── invoice-service.cds     # Invoice verification (FDD-06)
│   ├── invoice-fiori-annotations.cds
│   ├── master-data-service.cds # Master data CRUD (FDD-01)
│   ├── order-service.cds       # Fuel orders & ePOD (FDD-04/05)
│   ├── order-fiori-annotations.cds
│   ├── planning-service.cds    # Annual planning (FDD-02)
│   ├── pricing-service.cds     # Native pricing engine (FDD-10)
│   ├── pricing-fiori-annotations.cds
│   └── security-service.cds    # Security management (FDD-13)
├── docs/
│   ├── original/               # 28 design documents (.docx)
│   ├── figma/                  # 86 UI specification JSONs
│   ├── data/                   # Data documentation
│   └── design/                 # Design assets
├── mta.yaml                    # BTP deployment descriptor
├── xs-security.json            # XSUAA security (17 scopes, 9 roles)
├── .cdsrc.json                 # CDS config with dev users
└── package.json
```

## OData Services

All services use OData V4 protocol.

| Service | Path | FDD | Description |
|---------|------|-----|-------------|
| MasterDataService | `/odata/v4/master` | FDD-01 | Master data CRUD (11 entities) |
| PlanningService | `/odata/v4/planning` | FDD-02 | Forecasting, budgets, SAC integration |
| ContractsService | `/odata/v4/contracts` | FDD-03 | Contract management, CPE integration |
| FuelOrderService | `/odata/v4/orders` | FDD-04/05 | Fuel orders, ePOD, fuel tickets |
| InvoiceService | `/odata/v4/invoice` | FDD-06 | Three-way matching, approvals |
| ComplianceService | `/odata/v4/compliance` | FDD-07 | Embargo/sanction screening |
| BurnService | `/odata/v4/burn` | FDD-08 | Fuel burn, ROB tracking |
| AllocationService | `/odata/v4/allocation` | FDD-09 | Cost allocation |
| PricingService | `/odata/v4/pricing` | FDD-10 | Native pricing engine |
| IntegrationService | `/odata/v4/integration` | FDD-11 | API monitoring, health checks |
| AnalyticsService | `/odata/v4/analytics` | FDD-12 | Reports, KPIs, dashboards |
| SecurityService | `/odata/v4/security` | FDD-13 | User management, SOD |
| AdminService | `/odata/v4/admin` | - | System administration |

## Data Model Entities

### Reference Data (S/4HANA Synchronized - Read-only)

| Entity | Table | Description |
|--------|-------|-------------|
| Countries | T005_COUNTRY | SAP country master with embargo flags |
| Currencies | CURRENCY_MASTER | ISO 4217 currencies |
| UnitsOfMeasure | UNIT_OF_MEASURE | UoM codes (KG, LTR, GAL) |
| Plants | T001W_PLANT | SAP plant master |

### FuelSphere Native Entities

| Entity | Table | Description |
|--------|-------|-------------|
| Manufacturers | MANUFACTURE | Aircraft manufacturers |
| Aircraft | AIRCRAFT_MASTER | Aircraft types with fuel capacity |
| Airports | MASTER_AIRPORTS | Airport master with IATA/ICAO codes |
| Routes | ROUTE_MASTER | Route definitions |
| FlightSchedule | FLIGHT_SCHEDULE | Flight schedule records |

### Bidirectional Entities (S/4HANA Integration)

| Entity | Table | Description |
|--------|-------|-------------|
| Suppliers | MASTER_SUPPLIERS | Vendor master (synced to BP) |
| Products | MASTER_PRODUCTS | Fuel products (synced to Material) |
| Contracts | MASTER_CONTRACTS | Purchase contracts |

### Transactional Entities

| Module | Key Entities |
|--------|--------------|
| Orders | FUEL_ORDERS, FUEL_DELIVERIES, FUEL_TICKETS |
| Planning | PLANNING_VERSION, PLANNING_LINE, DEMAND_CALCULATION, ROUTE_AIRCRAFT_MATRIX |
| Pricing | PRICING_CONFIG, PRICING_FORMULA, FORMULA_COMPONENTS, MARKET_INDEX, INDEX_VALUE |
| Invoice | INVOICES, INVOICE_ITEMS, INVOICE_MATCHES, INVOICE_APPROVALS, TOLERANCE_RULES |
| Burn | FUEL_BURNS, ROB_LEDGER, VARIANCE_RECORDS |
| Integration | INTEGRATION_MESSAGES, ERROR_LOGS, EXCEPTION_ITEMS, SYSTEM_HEALTH_LOGS |
| Compliance | SANCTION_LISTS, SANCTIONED_ENTITIES, COMPLIANCE_CHECKS, COMPLIANCE_EXCEPTIONS |
| Analytics | KPI_DEFINITIONS, KPI_VALUES, REPORT_DEFINITIONS, ANALYTICS_SNAPSHOTS |
| Security | SECURITY_USERS, SOD_RULES, ACCESS_REVIEW_CAMPAIGNS, SECURITY_INCIDENTS |

## Authorization Model

### Scopes (17 defined in xs-security.json)

| Scope | Description |
|-------|-------------|
| MasterDataRead | Read master data entities |
| MasterDataWrite | Create/update master data |
| MasterDataAdmin | Full admin including delete |
| FuelOrderCreate | Create fuel orders |
| FuelOrderApprove | Approve fuel orders |
| ePODCapture | Capture electronic proof of delivery |
| ePODApprove | Approve ePOD records |
| InvoiceVerify | Verify and process invoices |
| InvoiceApprove | Approve invoices for payment |
| FinancePost | Post journal entries to S/4HANA |
| BurnDataView | View fuel burn and ROB data |
| BurnDataEdit | Edit and correct fuel burn records |
| ContractManage | Manage fuel purchase contracts |
| PlanningAccess | Access fuel planning and forecasting |
| ReportView | View reports and analytics |
| IntegrationMonitor | Monitor integration status |
| AdminAccess | Full system administration |

### Role Templates (9 defined)

| Role | Key Scopes |
|------|------------|
| MasterDataManager | MasterDataRead, MasterDataWrite |
| FuelPlanner | MasterDataRead, FuelOrderCreate, PlanningAccess, ReportView |
| StationCoordinator | MasterDataRead, FuelOrderCreate, ePODCapture |
| ProcurementSpecialist | MasterDataRead, ContractManage, ReportView |
| FinanceController | MasterDataRead, InvoiceVerify, InvoiceApprove, FinancePost |
| OperationsManager | FuelOrderApprove, ePODApprove, BurnDataView, BurnDataEdit |
| IntegrationAdministrator | IntegrationMonitor |
| SystemAdministrator | AdminAccess (full access) |
| Viewer | MasterDataRead, ReportView |

### Attributes (for row-level security)

- **CompanyCode**: Company code filtering
- **Plant**: Plant/Airport filtering
- **CostCenter**: Cost center filtering

## Local Development

### Starting the Server

```bash
# Standard start (port 4004)
cds watch --port 4004

# Or use npm script (rebuilds first)
npm run dev

# Production build
npm run build
```

### Test Users (.cdsrc.json)

| User | Password | Roles | Attributes |
|------|----------|-------|------------|
| alice | (any) | FullAdmin | station=*, region=* |
| kalpesh | (any) | FullAdmin | station=*, region=* |
| planner | (any) | FuelPlanner | - |
| ops | (any) | OperationsManager, StationCoordinator | station=MNL,CEB, region=APAC |
| finance | (any) | FinanceManager, FinanceController | - |
| analyst | (any) | Analyst | - |
| * | (any) | authenticated-user | - |

### Testing URLs

```
# Service index
http://localhost:4004

# OData metadata
http://localhost:4004/odata/v4/master/$metadata
http://localhost:4004/odata/v4/orders/$metadata
http://localhost:4004/odata/v4/invoice/$metadata

# Entity data
http://localhost:4004/odata/v4/master/Airports
http://localhost:4004/odata/v4/orders/FuelOrders
http://localhost:4004/odata/v4/invoice/Invoices

# Fiori preview
http://localhost:4004/$fiori-preview/MasterDataService/Airports
http://localhost:4004/$fiori-preview/FuelOrderService/FuelOrders
```

## Build & Deploy

### Build Commands

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Build MTA archive
mbt build
```

### Deploy to BTP

```bash
# Login to Cloud Foundry
cf login -a https://api.cf.<region>.hana.ondemand.com

# Deploy
cf deploy mta_archives/fuelsphere_1.0.0.mtar
```

### BTP Services Required

| Service | Plan | Resource Name | Purpose |
|---------|------|---------------|---------|
| SAP HANA Cloud | hdi-shared | fuelsphere-db | Database |
| XSUAA | application | fuelsphere-auth | Authentication |
| Destination | lite | fuelsphere-destination | S/4HANA connectivity |
| Application Logging | lite | fuelsphere-logging | Logs |

## S/4HANA Integration

### Destinations

| Name | Authentication | Purpose |
|------|----------------|---------|
| S4HC_TECHNICAL | OAuth2ClientCredentials | Batch/scheduled jobs |
| S4HC_USER | OAuth2SAMLBearerAssertion | User context APIs |

### Communication Scenarios

| Scenario | Description |
|----------|-------------|
| SAP_COM_0008 | Business Partner Integration |
| SAP_COM_0009 | Product Master Integration |
| SAP_COM_0028 | Journal Entry Integration |
| SAP_COM_0053 | Purchase Contract Integration |
| SAP_COM_0164 | Purchase Order Integration |
| SAP_COM_0367 | Goods Receipt Integration |

## Error Codes

### Fuel Orders (FDD-04/05)

| Code | Description |
|------|-------------|
| EPD401 | Delivered quantity exceeds tolerance (>5% variance) |
| EPD402 | Missing required signature before status change |
| EPD403 | Temperature out of range (-40C to +50C) |
| EPD404 | Density out of specification (0.775-0.840 kg/L) |
| EPD410 | Duplicate ticket number for supplier |
| EPD411 | Meter reading does not match ticket quantity |
| INT401 | S/4HANA PO creation failed |
| INT402 | S/4HANA GR posting failed |
| INT403 | Shell Skypad communication timeout |
| INT404 | Object Store PDF upload failed |

### Invoice Verification (FDD-06)

| Code | Description |
|------|-------------|
| INV401 | PO not found for matching |
| INV402 | GR not found for matching |
| INV403 | Price variance exceeds tolerance |
| INV404 | Quantity variance exceeds tolerance |
| INV405 | Duplicate invoice detected |
| INV406 | S/4HANA FI posting failed |
| INV407 | Invalid tax code for jurisdiction |
| INV408 | Posting period closed |
| INV409 | Approval limit exceeded |
| INV410 | Currency conversion error |

### Planning (FDD-02)

| Code | Description |
|------|-------------|
| PLN401 | Version not found |
| PLN402 | Version status invalid for operation |
| PLN403 | Missing required flight schedule |
| PLN404 | Route-Aircraft Matrix not found |
| PLN405 | Price assumption missing for station/period |
| PLN410 | SSIM file parsing error |
| PLN411 | Invalid SSIM record format |
| PLN420 | SAC connection failed |
| PLN421 | SAC writeback failed |
| PLN422 | SAC model not configured |

## SOX Controls

### Invoice Verification (FDD-06)

| Control | Description |
|---------|-------------|
| INV-001 | Invoice creator cannot approve same invoice |
| INV-002 | Dual approval for variances > threshold |
| INV-003 | Three-way match: PO-GR-Invoice |
| INV-004 | Duplicate invoice detection |
| INV-005 | Variance threshold alerts (quantity) |
| INV-006 | Variance threshold alerts (price) |
| INV-007 | Approval workflow audit trail |
| INV-008 | Approval value limits per role |

### Pricing Engine (FDD-10)

| Control | Description |
|---------|-------------|
| FPE-001 | Formula creator cannot approve own formula |
| FPE-002 | Index importer cannot execute price derivation |
| FPE-003 | Formula version audit trail |
| FPE-004 | Index value verification required |
| FPE-005 | Price derivation log - complete calculation audit |
| FPE-006 | Dual approval for high-value formulas |
| FPE-007 | Hybrid variance threshold alerts |

## Documentation

### Foundation Documents (docs/original/)

| Document | Description |
|----------|-------------|
| FS-FND-001 | Solution Architecture Specification |
| FS-FND-002 | Data Model ERD |
| FS-FND-003 | Security Authorization Specification |
| FS-FND-004 | UI/UX Standards Specification |
| FS-INT-001 | S/4HANA Integration Guide |
| FS-INT-002 | External Systems Integration Guide |
| FS-INT-003 | Event Messaging Specification |
| FS-OPS-001 | Configuration Guide |
| FS-OPS-002 | Deployment Guide |

### Functional Design Documents (FDD)

| FDD | Module | Description |
|-----|--------|-------------|
| FDD-02 | Planning | Annual Planning & Forecasting |
| FDD-03 | Contracts | Contracts & CPE Integration |
| FDD-04 | Orders | Fuel Orders & Milestones |
| FDD-05 | ePOD | Fuel Ticket & ePOD |
| FDD-06 | Invoice | Invoice Verification |
| FDD-07 | Compliance | Embargo Compliance |
| FDD-08 | Burn | Fuel Burn & ROB Tracking |
| FDD-09 | Allocation | Cost Allocation |
| FDD-10 | Pricing | Native Pricing Engine |
| FDD-11 | Integration | Integration Monitoring |
| FDD-12 | Analytics | Reporting & Analytics |
| FDD-13 | Security | Security Management |

### Reading .docx Files

Claude cannot read `.docx` files directly. Extract text using:

```bash
unzip -p <file.docx> word/document.xml | sed -e 's/<[^>]*>//g' | tr -s ' \n'
```

### Figma Specifications

86 UI specification JSON files in `docs/figma/` for each screen/dialog.

## File Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| CDS files | kebab-case.cds | `order-service.cds` |
| CSV data | namespace-ENTITY_NAME.csv | `fuelsphere-MASTER_AIRPORTS.csv` |
| JS handlers | entity-name.js | `fuel-orders.js` |
| FDD docs | FDD-##-HLD_Module_Name_v#_#.docx | `FDD-06-HLD_Invoice_Verification_v1_0.docx` |

## Common Issues & Solutions

### Node.js Version

SAP CAP supports Node 18, 20, 22. NOT Node 24.

```bash
# Check version
node --version

# Switch with nvm
nvm use 20

# Rebuild native modules after switch
npm rebuild
```

### Fiori Preview Not Loading

1. Check server is running: `curl http://localhost:4004`
2. Use VS Code Simple Browser (not external browser in Codespaces)
3. Clear browser cache
4. Restart server: `pkill -f "cds watch" && cds watch`

### CSV Data Loading Issues

- Ensure column headers match exactly with CDS entity properties
- Check for trailing commas or whitespace
- Validate date formats: YYYY-MM-DD
- UUID fields must have valid UUIDs or be empty

## Key Business Processes

### Fuel Order Lifecycle

```
Draft → Submitted → Confirmed → InProgress → Delivered → Completed
                                     ↓
                              Signatures captured (ePOD)
                                     ↓
                            S/4HANA PO/GR created
```

### Invoice Verification Flow

```
Draft → Submitted → Three-Way Match → Verified → Approved → Posted
                           ↓
                    Exception Queue
                           ↓
                   Finance Manager Review
```

### ROB Calculation

```
ROB_current = ROB_previous + Uplift - Burn + Adjustment
```

### Fuel Demand Calculation

```
Total Fuel = Trip + Taxi + Contingency + Alternate + Reserve + Extra
```

## Related Projects

- **FuelSphere-UI**: SAP Fiori UI applications (separate repository)

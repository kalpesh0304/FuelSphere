# FuelSphere - Claude Development Guide

This file contains project-specific patterns, conventions, and skills for Claude to reference during development.

## Project Overview

- **Name**: FuelSphere - Airline Fuel Lifecycle Management Solution (CAPM Backend)
- **Tech Stack**: SAP CAP (Node.js), SAP HANA, OData V4
- **Target Platform**: SAP BTP (Business Technology Platform)
- **Architecture**: CAPM Backend Only (UI in separate FuelSphere-UI project)

## Project Architecture

FuelSphere follows a decoupled architecture with separate repositories:

```
FuelSphere/           # CAPM Backend (this project)
├── db/               # Data model definitions
├── srv/              # OData services & authorization
├── mta.yaml          # Backend deployment descriptor
└── xs-security.json  # XSUAA security config

FuelSphere-UI/        # Fiori UI Applications (separate project)
├── apps/             # Individual UI5 apps
│   └── airports/     # Airports Master Data app
├── router/           # App Router
└── mta.yaml          # UI deployment descriptor
```

## Project Structure (Backend)

```
FuelSphere/
├── db/
│   ├── schema.cds              # Data model definitions
│   └── data/                   # CSV mock data files
├── srv/
│   ├── master-data-service.cds # Master Data service definitions
│   ├── authorization.cds       # RBAC authorization annotations
│   ├── fiori-annotations.cds   # UI annotations (for Fiori preview)
│   └── admin-service.cds       # Admin service definitions
├── docs/
│   └── original/               # Design specifications
│       ├── FS-FND-001_*.docx   # Solution Architecture
│       ├── FS-FND-002_*.docx   # Data Model ERD
│       ├── FS-FND-003_*.docx   # Security Specification
│       ├── FS-FND-003-A_xs-security.json
│       ├── FS-FND-003-B_authorization.cds
│       └── FS-FND-004_*.docx   # UI/UX Standards
├── mta.yaml                    # BTP deployment descriptor
├── xs-security.json            # XSUAA security config
├── .cdsrc.json                 # CDS configuration
└── package.json
```

## Service Definitions

### Master Data Service

```cds
using { fuelsphere as db } from '../db/schema';

@path: '/odata/v4/master'
service MasterDataService {
    @readonly
    entity Countries as projection on db.T005_COUNTRY;

    entity Airports as projection on db.MASTER_AIRPORTS {
        *,
        country : redirected to Countries
    };
}
```

### Service Paths (Architecture Spec FS-FND-001)

| Service | Path | Purpose |
|---------|------|---------|
| MasterDataService | `/odata/v4/master` | Master data CRUD |
| PlanningService | `/odata/v4/planning` | Forecasting, budgets |
| OrderService | `/odata/v4/orders` | Fuel order management |
| DeliveryService | `/odata/v4/delivery` | ePOD, fuel tickets |
| InvoiceService | `/odata/v4/invoice` | Invoice verification |
| BurnService | `/odata/v4/burn` | Fuel burn, ROB tracking |
| FinanceService | `/odata/v4/finance` | Financial postings |
| IntegrationService | `/odata/v4/integration` | Monitoring, health |
| AdminService | `/odata/v4/admin` | Administration |

## Authorization (FS-FND-003)

### Scopes (xs-security.json)

| Scope | Description |
|-------|-------------|
| MasterDataRead | Read master data entities |
| MasterDataWrite | Create/update master data |
| MasterDataAdmin | Full admin including delete |
| FuelOrderCreate | Create fuel orders |
| FuelOrderApprove | Approve fuel orders |
| ePODCapture | Capture ePOD |
| ePODApprove | Approve ePOD |
| InvoiceVerify | Verify invoices |
| InvoiceApprove | Approve invoices |
| FinancePost | Post to S/4HANA |
| BurnDataView | View fuel burn data |
| BurnDataEdit | Edit fuel burn |
| ContractManage | Manage contracts |
| PlanningAccess | Planning access |
| ReportView | View reports |
| IntegrationMonitor | Monitor integration |
| AdminAccess | Full admin access |

### Role Templates

| Role | Description |
|------|-------------|
| MasterDataManager | Maintains master data |
| FuelPlanner | Demand forecasting, planning |
| StationCoordinator | Fuel orders, ePOD capture |
| ProcurementSpecialist | Contracts, CPE |
| FinanceController | Invoice verification |
| OperationsManager | Burn monitoring, approvals |
| IntegrationAdministrator | API monitoring |
| SystemAdministrator | Full system admin |
| Viewer | Read-only access |

## Commands

### Development

```bash
# Start local server
cds watch --port 4004

# With auto-rebuild for Node version issues
npm rebuild && cds watch --port 4004

# Fiori Preview URL (built-in)
http://localhost:4004/$fiori-preview/MasterDataService/Airports
```

### Build & Deploy (BTP)

```bash
# Build MTA archive
mbt build

# Deploy to Cloud Foundry
cf deploy mta_archives/fuelsphere_1.0.0.mtar

# Login to CF
cf login -a https://api.cf.<region>.hana.ondemand.com
```

### Git

```bash
# Branch for this project
git checkout claude/setup-btp-project-J1Bhp

# Push changes
git push -u origin claude/setup-btp-project-J1Bhp
```

## Master Data Entities

| Entity | Service Path | CRUD | Notes |
|--------|-------------|------|-------|
| Airports | /odata/v4/master/Airports | Yes | FuelSphere native |
| Aircraft | /odata/v4/master/Aircraft | Yes | FuelSphere native |
| Routes | /odata/v4/master/Routes | Yes | FuelSphere native |
| Suppliers | /odata/v4/master/Suppliers | Yes | Bidirectional S/4 |
| Products | /odata/v4/master/Products | Yes | Bidirectional S/4 |
| Contracts | /odata/v4/master/Contracts | Yes | Bidirectional S/4 |
| Manufacturers | /odata/v4/master/Manufacturers | Yes | FuelSphere native |
| Countries | /odata/v4/master/Countries | No | Read-only, S/4HANA |
| Currencies | /odata/v4/master/Currencies | No | Read-only, S/4HANA |
| Plants | /odata/v4/master/Plants | No | Read-only, S/4HANA |
| UnitsOfMeasure | /odata/v4/master/UnitsOfMeasure | No | Read-only, S/4HANA |

## Authentication

### Local Development (.cdsrc.json)

```json
{
  "[development]": {
    "auth": {
      "kind": "dummy",
      "users": {
        "alice": { "roles": ["MasterDataRead", "MasterDataWrite"] },
        "admin": { "roles": ["AdminAccess", "MasterDataAdmin"] },
        "*": true
      }
    }
  }
}
```

### Production (xs-security.json)

- 17 Scopes for fine-grained authorization
- 9 Role Templates: MasterDataManager, FuelPlanner, etc.
- 9 Role Collections: FuelSphere_MasterDataManager, etc.
- Attribute-based access: CompanyCode, Plant, CostCenter

## S/4HANA Integration

### Destinations

| Name | Authentication | Purpose |
|------|---------------|---------|
| S4HC_TECHNICAL | OAuth2ClientCredentials | Batch/scheduled jobs |
| S4HC_USER | OAuth2SAMLBearerAssertion | User context APIs |

### Communication Scenarios (S/4HANA Cloud)

| Scenario | Description |
|----------|-------------|
| SAP_COM_0008 | Business Partner Integration |
| SAP_COM_0009 | Product Master Integration |
| SAP_COM_0028 | Journal Entry Integration |
| SAP_COM_0053 | Purchase Contract Integration |
| SAP_COM_0164 | Purchase Order Integration |
| SAP_COM_0367 | Goods Receipt Integration |

## Testing URLs

```
# Service index
http://localhost:4004

# OData metadata
http://localhost:4004/odata/v4/master/$metadata

# Entity data
http://localhost:4004/odata/v4/master/Airports

# Fiori preview
http://localhost:4004/$fiori-preview/MasterDataService/Airports
```

## BTP Services Required

| Service | Plan | Purpose |
|---------|------|---------|
| SAP HANA Cloud | hdi-shared | Database |
| XSUAA | application | Authentication |
| Destination | lite | S/4HANA connectivity |
| App Logging | lite | Logs |

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

## File Naming Conventions

- CDS files: `kebab-case.cds`
- CSV data: `namespace-ENTITY_NAME.csv` (e.g., `fuelsphere-MASTER_AIRPORTS.csv`)
- JS handlers: `entity-name.js`

## Document Handling

### Reading .docx Files

Claude's Read tool cannot read `.docx` files directly (they are binary ZIP archives).

**To extract text from .docx files, use this command:**

```bash
unzip -p <file.docx> word/document.xml | sed -e 's/<[^>]*>//g' | tr -s ' \n'
```

| Step | Purpose |
|------|---------|
| `unzip -p` | Extract document.xml from ZIP without creating files |
| `sed -e 's/<[^>]*>//g'` | Strip XML tags, leaving only text |
| `tr -s ' \n'` | Clean up extra whitespace |

**Limitations:**
- Loses formatting (bold, tables, headers)
- Images/diagrams not accessible
- Complex tables may be hard to read

### Preferred Document Formats

For FDD and design documents, prefer these formats (in order):

| Format | Readability | Best For |
|--------|-------------|----------|
| Markdown (.md) | Excellent | All documentation |
| Plain text (.txt) | Excellent | Simple specs |
| Screenshots/Images | Good | Diagrams, UI mockups |
| .docx (with extraction) | Limited | When no alternative |

### FDD Document Location

FDD documents are stored in `docs/original/`:
- `FDD-03-HLD_Contracts_CPE_Integration_v2_0.docx`
- `FDD-04-HLD_Fuel_Orders_Milestones_v1.0.docx`
- `FDD-05-HLD_FuelTicket_ePOD_v1_0.docx`

## Related Projects

- **FuelSphere-UI**: Fiori UI applications (../FuelSphere-UI)

# FuelSphere - Claude Development Guide

This file contains project-specific patterns, conventions, and skills for Claude to reference during development.

## Project Overview

- **Name**: FuelSphere - Airline Fuel Lifecycle Management Solution
- **Tech Stack**: SAP CAP (Node.js), SAP HANA, Fiori Elements, OData V4
- **Target Platform**: SAP BTP (Business Technology Platform)

## Project Structure

```
FuelSphere/
├── db/
│   ├── schema.cds          # Data model definitions
│   └── data/               # CSV mock data files
├── srv/
│   ├── master-data-service.cds    # Service definitions
│   ├── fiori-annotations.cds      # UI annotations
│   └── *.js                       # Service handlers
├── app/
│   ├── airports/           # Fiori Elements app
│   │   ├── webapp/
│   │   │   ├── manifest.json
│   │   │   └── Component.js
│   │   ├── ui5.yaml
│   │   └── package.json
│   └── router/             # App Router for BTP
├── mta.yaml                # BTP deployment descriptor
├── xs-security.json        # XSUAA security config
├── .cdsrc.json            # CDS configuration
└── package.json
```

## Key Patterns

### 1. CDS Entity Definition (db/schema.cds)

```cds
namespace fuelsphere;
using { cuid, managed } from '@sap/cds/common';

entity MASTER_AIRPORTS : cuid, managed {
    iata_code     : String(3) @mandatory;
    icao_code     : String(4);
    airport_name  : String(100) @mandatory;
    city          : String(50);
    country_code  : String(2);
    timezone      : String(50);
    is_active     : Boolean default true;
}
```

### 2. Service Definition (srv/*.cds)

```cds
using { fuelsphere as db } from '../db/schema';

@path: '/api/master-data'
service MasterDataService {
    // Read-only entity (S/4HANA synced)
    @readonly
    entity Countries as projection on db.T005_COUNTRY;

    // Editable entity
    entity Airports as projection on db.MASTER_AIRPORTS {
        *,
        country : redirected to Countries
    };
}
```

### 3. Fiori Annotations (srv/fiori-annotations.cds)

```cds
using MasterDataService as service from './master-data-service';

// Enable CRUD operations
annotate service.Airports with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: true }
    }
);

// UI Annotations
annotate service.Airports with @(
    UI: {
        CreateHidden: false,
        UpdateHidden: false,
        DeleteHidden: false,
        HeaderInfo: {
            TypeName: 'Airport',
            TypeNamePlural: 'Airports',
            Title: { Value: airport_name },
            Description: { Value: iata_code }
        },
        SelectionFields: [ iata_code, country_code, is_active ],
        LineItem: [
            { Value: iata_code, Label: 'IATA Code' },
            { Value: airport_name, Label: 'Airport Name' },
            { Value: is_active, Label: 'Active' }
        ],
        Facets: [{
            $Type: 'UI.ReferenceFacet',
            Label: 'General Information',
            Target: '@UI.FieldGroup#General'
        }],
        FieldGroup#General: {
            Data: [
                { Value: iata_code },
                { Value: airport_name }
            ]
        }
    }
);
```

### 4. Fiori Elements App (app/*/webapp/manifest.json)

```json
{
  "sap.app": {
    "id": "airports",
    "type": "application",
    "dataSources": {
      "mainService": {
        "uri": "/api/master-data/",
        "type": "OData",
        "settings": { "odataVersion": "4.0" }
      }
    }
  },
  "sap.ui5": {
    "models": {
      "": { "dataSource": "mainService" }
    },
    "routing": {
      "routes": [
        { "pattern": ":?query:", "name": "List", "target": "List" }
      ],
      "targets": {
        "List": {
          "type": "Component",
          "name": "sap.fe.templates.ListReport",
          "options": {
            "settings": { "contextPath": "/Airports" }
          }
        }
      }
    }
  }
}
```

## Commands

### Development

```bash
# Start local server
cds watch --port 4004

# With auto-rebuild for Node version issues
npm rebuild && cds watch --port 4004

# Fiori Preview URL
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
| Airports | /api/master-data/Airports | Yes | FuelSphere native |
| Aircraft | /api/master-data/Aircraft | Yes | FuelSphere native |
| Routes | /api/master-data/Routes | Yes | FuelSphere native |
| Suppliers | /api/master-data/Suppliers | Yes | Bidirectional S/4 |
| Products | /api/master-data/Products | Yes | Bidirectional S/4 |
| Contracts | /api/master-data/Contracts | Yes | Bidirectional S/4 |
| Manufacturers | /api/master-data/Manufacturers | Yes | FuelSphere native |
| Countries | /api/master-data/Countries | No | Read-only, S/4HANA |
| Currencies | /api/master-data/Currencies | No | Read-only, S/4HANA |
| Plants | /api/master-data/Plants | No | Read-only, S/4HANA |
| UnitsOfMeasure | /api/master-data/UnitsOfMeasure | No | Read-only, S/4HANA |

## Authentication

### Local Development (.cdsrc.json)

```json
{
  "[development]": {
    "auth": {
      "kind": "dummy",
      "users": {
        "alice": { "roles": ["FullAdmin"] },
        "*": true
      }
    }
  }
}
```

### Production (xs-security.json)

- 11 Role Templates: FuelPlanner, ContractsManager, FinanceManager, etc.
- 11 Role Collections: FuelSphere_FuelPlanner, FuelSphere_FullAdmin, etc.
- XSUAA scopes for fine-grained authorization

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

### CRUD Buttons Not Showing

Ensure annotations include:
```cds
@(Capabilities: {
    InsertRestrictions: { Insertable: true },
    UpdateRestrictions: { Updatable: true },
    DeleteRestrictions: { Deletable: true }
})
@(UI: {
    CreateHidden: false,
    UpdateHidden: false,
    DeleteHidden: false
})
```

## File Naming Conventions

- CDS files: `kebab-case.cds`
- CSV data: `namespace-ENTITY_NAME.csv` (e.g., `fuelsphere-MASTER_AIRPORTS.csv`)
- JS handlers: `entity-name.js`

## Testing URLs

```
# Service index
http://localhost:4004

# OData metadata
http://localhost:4004/api/master-data/$metadata

# Entity data
http://localhost:4004/api/master-data/Airports

# Fiori preview
http://localhost:4004/$fiori-preview/MasterDataService/Airports
```

## BTP Services Required

| Service | Plan | Purpose |
|---------|------|---------|
| SAP HANA Cloud | hdi-shared | Database |
| XSUAA | application | Authentication |
| Destination | lite | S/4HANA connectivity |
| HTML5 Repo | app-host | UI hosting |
| App Logging | lite | Logs |

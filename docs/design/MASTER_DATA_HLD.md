# FuelSphere - Master Data Module High-Level Design

**Document ID**: FDD-01-HLD
**Version**: 2.1
**Status**: Active
**Last Updated**: January 12, 2026
**Prepared by**: Diligent Global

---

## 1. Document Control

### 1.1 Amendment History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 2026 | Kalpesh Chavda | Initial Draft |
| 2.0 | Jan 2026 | Kalpesh Chavda | Updated with FIGMA specs and validated entities |
| 2.1 | Jan 12, 2026 | Claude (Technical Architect) | Added data validation findings, TH country, fuel_required clarification |

---

## 2. Overview

### 2.1 Module Purpose

The Master Data module serves as the foundational layer of FuelSphere, providing centralized management and synchronization of all reference data entities required for fuel operations. This module ensures data consistency across the solution and maintains real-time integration with SAP S/4HANA for enterprise master data.

### 2.2 Key Capabilities

- Real-time OData integration with S/4HANA for master data synchronization
- Centralized management of Aircraft, Airport, Route, and Flight master data
- CPE (Commodity Pricing Engine) formula validation and caching
- Master Data Cockpit for monitoring, error handling, and data governance
- Support for Supplier, Product, Plant, Tax Code, UoM, and Currency entities from S/4HANA

---

## 3. Data Entities

### 3.1 FuelSphere Native Entities (11 Validated)

| Entity | Description | Primary Key | Source |
|--------|-------------|-------------|--------|
| T005_COUNTRY | SAP country master with currency mapping | land1 (String 3) | S/4HANA |
| CURRENCY_MASTER | Currency definitions with decimal places | currency_code (String 3) | S/4HANA |
| UNIT_OF_MEASURE | UoM codes (KG, LTR, GAL, etc.) | uom_code (String 3) | S/4HANA |
| T001W_PLANT | SAP plant master with airport mapping | werks (String 4) | S/4HANA |
| MANUFACTURE | Aircraft manufacturer codes | manufacture_code (String 2) | FuelSphere |
| AIRCRAFT_MASTER | Aircraft types with fuel capacity/burn rates | type_code (String 10) | FuelSphere |
| MASTER_AIRPORTS | Airport data with IATA/ICAO codes | id (UUID) + iata_code | FuelSphere |
| MASTER_SUPPLIERS | Supplier data with S/4 vendor reference | id (UUID) | Bidirectional |
| MASTER_PRODUCTS | Fuel product specifications | id (UUID) | S/4HANA |
| MASTER_CONTRACTS | Purchase contracts with CPE references | id (UUID) | FuelSphere |
| ROUTE_MASTER | Route definitions with fuel requirements | route_code (String 20) | FuelSphere |

### 3.2 Entity Definitions

#### T005_COUNTRY (Country Master)

| Field | Type | Description | Required |
|-------|------|-------------|----------|
| land1 | String(3) | SAP Country key (PK) | Yes |
| landx | String(50) | Country name | Yes |
| landx50 | String(100) | Full country name | No |
| natio | String(3) | Nationality code | No |
| landgr | String(3) | Country group/region | No |
| currcode | String(3) | Currency code | No |
| spras | String(2) | Language key | No |
| isActive | Boolean | Active status | Yes |

> **Data Validation Update (Jan 12, 2026)**: Added Thailand (TH) to country master - required for BKK airport reference.

#### AIRCRAFT_MASTER (Aircraft Type Master)

| Field | Type | Description | Required |
|-------|------|-------------|----------|
| type_code | String(10) | Aircraft type code (PK) | Yes |
| aircraft_model | String(50) | Full aircraft model name | Yes |
| manufacturer_code | String(2) | FK to MANUFACTURE | Yes |
| fuel_capacity_kg | Decimal(15,2) | Maximum fuel capacity in kg | Yes |
| mtow_kg | Decimal(15,2) | Maximum takeoff weight in kg | Yes |
| cruise_burn_kgph | Decimal(10,2) | Cruise fuel burn rate kg/hour | Yes |
| fleet_size | Integer | Number in fleet | No |
| status | String(20) | Active/Inactive/Maintenance | Yes |
| created_at | DateTime | Creation timestamp | Yes |
| created_by | String(100) | Created by user | Yes |
| updated_at | DateTime | Last update timestamp | No |
| updated_by | String(100) | Updated by user | No |

#### MASTER_AIRPORTS (Airport Master)

| Field | Type | Description | Required |
|-------|------|-------------|----------|
| id | UUID | Unique Airport identifier (PK) | Yes |
| iata_code | String(3) | IATA airport code (Unique) | Yes |
| icao_code | String(4) | ICAO airport code | Yes |
| airport_name | String(100) | Full airport name | Yes |
| city | String(50) | City name | Yes |
| country | String(3) | FK to T005_COUNTRY.land1 | Yes |
| timezone | String(50) | Airport timezone | Yes |
| s4_plant_code | String(4) | FK to T001W_PLANT.werks | No |
| is_active | Boolean | Active status | Yes |

#### ROUTE_MASTER (Route Master)

| Field | Type | Description | Required |
|-------|------|-------------|----------|
| route_code | String(20) | Route code Origin-Dest (PK) | Yes |
| origin_airport | String(3) | FK to MASTER_AIRPORTS.iata_code | Yes |
| destination_airport | String(3) | FK to MASTER_AIRPORTS.iata_code | Yes |
| distance_km | Decimal(10,2) | Distance in kilometers | Yes |
| avg_flight_time | String(10) | Average flight time (HH:MM) | No |
| fuel_required | Decimal(15,2) | Standard fuel requirement in **kg** | No |
| alternate_count | Integer | Number of alternate airports | No |
| status | String(20) | ACTIVE/INACTIVE | Yes |
| created_at | DateTime | Creation timestamp | Yes |
| created_by | String(100) | Created by user | Yes |

> **Data Validation Update (Jan 12, 2026)**: `fuel_required` field confirmed as **Decimal** (kg), not Boolean. Sample data to be corrected.

#### MASTER_SUPPLIERS (Supplier Master)

| Field | Type | Description | Required |
|-------|------|-------------|----------|
| id | UUID | Unique Supplier identifier (PK) | Yes |
| supplier_code | String(20) | Supplier code | Yes |
| supplier_name | String(100) | Full supplier name | Yes |
| supplier_type | String(20) | EXTERNAL / INTO_PLANE | Yes |
| country | String(3) | FK to T005_COUNTRY.land1 | Yes |
| payment_terms | String(20) | Payment terms | No |
| s4_vendor_no | String(10) | S/4HANA Vendor Number | No |
| is_active | Boolean | Active status | Yes |
| created_at | DateTime | Creation timestamp | Yes |
| modified_at | DateTime | Last modification | No |

#### MASTER_PRODUCTS (Product Master)

| Field | Type | Description | Required |
|-------|------|-------------|----------|
| id | UUID | Unique Product identifier (PK) | Yes |
| product_code | String(20) | Product code | Yes |
| product_name | String(100) | Full product name | Yes |
| product_type | String(20) | JET_FUEL / AVGAS / BIOFUEL | Yes |
| specification | String(50) | ASTM/DEF STAN specification | Yes |
| uom | String(3) | FK to UNIT_OF_MEASURE.uom_code | Yes |
| s4_material_number | String(18) | S/4HANA Material Number | No |
| is_active | Boolean | Active status | Yes |

#### MASTER_CONTRACTS (Contract Master)

| Field | Type | Description | Required |
|-------|------|-------------|----------|
| id | UUID | Unique Contract identifier (PK) | Yes |
| contract_number | String(20) | Contract number | Yes |
| contract_name | String(100) | Contract description | Yes |
| supplier_id | UUID | FK to MASTER_SUPPLIERS.id | Yes |
| valid_from | Date | Contract start date | Yes |
| valid_to | Date | Contract end date | Yes |
| contract_type | String(20) | Contract type | Yes |
| price_type | String(20) | CPE / FIXED / INDEX | Yes |
| currency | String(3) | FK to CURRENCY_MASTER.currency_code | Yes |
| is_active | Boolean | Active status | Yes |

---

## 4. Entity Relationships

### 4.1 Foreign Key Matrix (10 Relationships)

| Source Entity | Foreign Key | Target Entity | Target Key |
|---------------|-------------|---------------|------------|
| master_airports | country | t005_country | land1 |
| master_airports | s4_plant_code | t001w_plant | werks |
| t001w_plant | land1 | t005_country | land1 |
| aircraft_master | manufacturer_code | manufacture | manufacture_code |
| route_master | origin_airport | master_airports | iata_code |
| route_master | destination_airport | master_airports | iata_code |
| master_suppliers | country | t005_country | land1 |
| master_contracts | supplier_id | master_suppliers | id |
| master_contracts | currency | currency_master | currency_code |
| master_products | uom | unit_of_measure | uom_code |

### 4.2 ERD Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    FUELSPHERE MASTER DATA ERD                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌──────────────┐     ┌───────────────┐     ┌──────────────────┐               │
│  │ T005_COUNTRY │────→│  T001W_PLANT  │────→│  MASTER_AIRPORTS │               │
│  │   (land1)    │     │    (werks)    │     │   (s4_plant_code)│               │
│  └──────────────┘     └───────────────┘     └────────┬─────────┘               │
│         │                                            │                         │
│         ↓                                            ↓                         │
│  ┌──────────────────┐                     ┌──────────────────┐                 │
│  │ MASTER_SUPPLIERS │                     │   ROUTE_MASTER   │                 │
│  │    (country)     │                     │ (origin/dest_apt)│                 │
│  └────────┬─────────┘                     └──────────────────┘                 │
│           │                                                                     │
│           ↓                                                                     │
│  ┌──────────────────┐     ┌───────────────────┐                                │
│  │ MASTER_CONTRACTS │────→│  CURRENCY_MASTER  │                                │
│  │  (supplier_id)   │     │  (currency_code)  │                                │
│  └──────────────────┘     └───────────────────┘                                │
│                                                                                 │
│  ┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐           │
│  │  MANUFACTURE │────→│  AIRCRAFT_MASTER │     │  MASTER_PRODUCTS │           │
│  │(manuf_code)  │     │ (manufacturer_cd)│     │      (uom)       │           │
│  └──────────────┘     └──────────────────┘     └────────┬─────────┘           │
│                                                         │                      │
│                                                         ↓                      │
│                                              ┌──────────────────┐              │
│                                              │ UNIT_OF_MEASURE  │              │
│                                              │    (uom_code)    │              │
│                                              └──────────────────┘              │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. S/4HANA Integration

### 5.1 API Mapping

| FuelSphere Entity | S/4HANA API | Sync Direction | Frequency |
|-------------------|-------------|----------------|-----------|
| t005_country | API_COUNTRY_SRV | S/4 → FuelSphere | Daily |
| currency_master | API_CURRENCY_EXCHANGE_RATES | S/4 → FuelSphere | Daily |
| t001w_plant | ZAPI_PLANT_SRV (custom) | S/4 → FuelSphere | Daily |
| master_suppliers | API_BUSINESS_PARTNER | Bidirectional | Real-time |
| master_products | API_PRODUCT_SRV | S/4 → FuelSphere | Real-time |
| master_contracts | API_PURCHASECONTRACT_SRV | Bidirectional | Real-time |
| CPE Formula | ZAPI_CPEFORMULA_SRV | S/4 → FuelSphere | 15-30 min TTL |

### 5.2 Key Field Mappings

| FuelSphere Field | S/4HANA Field | Purpose |
|------------------|---------------|---------|
| master_airports.s4_plant_code | WERKS | Plant determination for PO/GR |
| master_suppliers.s4_vendor_no | LIFNR | Vendor number for Purchase Orders |
| master_products.s4_material_number | MATNR | Material number for PO line items |
| master_contracts.contract_number | EBELN | Purchase contract reference |

---

## 6. UI Screen Specifications

### 6.1 Screen Inventory (12 Screens)

| Screen ID | Screen Name | Floorplan | Layout |
|-----------|-------------|-----------|--------|
| MASTER_DATA_DASHBOARD_001 | Master Data Dashboard | Overview Page | Full-width Dashboard |
| AIRCRAFT_MASTER_001 | Aircraft Master Data | List Report | Full-width List Report |
| AIRCRAFT_DETAIL_001 | Aircraft Detail | Object Page | Display/Edit |
| AIRPORT_MASTER_001 | Airport Master Data | List Report | Full-width List Report |
| AIRPORT_DETAIL_001 | Airport Detail | Object Page | Display/Edit |
| AIRPORT_REGISTER_001 | Airport Register | List Report | Full-width List Report |
| ROUTE_MASTER_001 | Route Master Data | List Report | Full-width List Report |
| ROUTE_DETAIL_001 | Route Detail | Object Page | Display/Edit |
| FLIGHT_MASTER_001 | Flight Master Data | List Report | Full-width List Report |
| FLIGHT_RECORD_DETAILS_001 | Flight Record Details | Object Page | Display |
| FLIGHT_RECORDS_MONITOR_001 | Flight Records Monitor | List Report | Status Filters |
| FUEL_REQUIREMENTS_MANAGEMENT_001 | Fuel Requirements Mgmt | List Report | Editable Table |

### 6.2 SAP UI5 Component Mapping

| Component Type | SAP UI5 Equivalent | Usage |
|----------------|-------------------|-------|
| Filter Bar | sap.ui.comp.filterbar.FilterBar | List Report - search/filtering |
| Responsive Table | sap.m.Table | Data display, growing threshold 50 |
| Object Page Header | sap.uxap.ObjectPageHeader | Detail screens |
| Anchor Navigation | sap.uxap.AnchorBar | Section navigation |
| KPI Tiles | sap.m.GenericTile | Dashboard KPIs |
| Charts | sap.viz.ui5.controls | Line, Bar, Donut, Area |

---

## 7. Visual Design System

### 7.1 Color Palette

| Color Name | Hex Value | CSS Variable | Usage |
|------------|-----------|--------------|-------|
| Primary Blue | #0070F2 | --primary-blue | Primary actions, links |
| Secondary Blue | #5CAAFF | --secondary-blue | Secondary elements |
| Success Green | #30914C | --success-green | Approved, Completed |
| Warning Amber | #E76500 | --warning-amber | Pending, In Progress |
| Error Red | #D32F2F | --error-red | Cancelled, Rejected |
| Background | #F5F6F7 | --background | Page background |
| Card | #FFFFFF | --card | Card backgrounds |
| Border | #D9D9D9 | --border | Borders, dividers |
| Text Primary | #32363A | --text-primary | Main text |
| Text Secondary | #6C6C6C | --text-secondary | Labels |

### 7.2 Typography

- **Font Family**: '72', Arial, sans-serif (SAP 72 Font)
- **H1**: 32px, Bold
- **H2**: 24px, Bold
- **H3**: 20px, Bold
- **Base**: 14px, Normal
- **Small**: 12px, Normal

### 7.3 Spacing System (8px Grid)

| Token | Value | Usage |
|-------|-------|-------|
| XS | 4px | Tight spacing |
| S | 8px | Small gaps |
| M | 16px | Standard spacing |
| L | 24px | Section spacing |
| XL | 32px | Large gaps |
| XXL | 48px | Page sections |

---

## 8. Error Handling

### 8.1 Error Code Family: MD4xx

| Error Code | Description | Resolution |
|------------|-------------|------------|
| MD400 | Master data validation failed | Review and correct input |
| MD401 | IATA code must be exactly 3 characters | Correct IATA format |
| MD402 | ICAO code must be exactly 4 characters | Correct ICAO format |
| MD403 | Fuel capacity must be greater than 0 | Provide valid value |
| MD404 | Fuel burn rate must be less than capacity | Verify calculation |
| MD405 | Origin and destination must differ | Correct route |
| MD406 | Distance must be greater than 0 | Provide valid distance |
| MD407 | Contract end date must be after start | Correct date range |
| MD408 | S/4 vendor number must be numeric (max 10) | Correct format |

---

## 9. Data Validation Findings

### 9.1 Validation Report (Jan 12, 2026)

| Issue | Entity | Severity | Resolution |
|-------|--------|----------|------------|
| Missing country TH (Thailand) | t005_country | High | Add TH record |
| fuel_required is Boolean | route_master | High | Change to Decimal (kg) |
| inactive column all NULL | t001w_plant | Low | Set to false explicitly |

---

## Appendix: Sample Data Summary

| Entity | Sample Records | Status |
|--------|----------------|--------|
| t005_country | 8 (+1 TH to add) | Validated |
| currency_master | 8 | Validated |
| unit_of_measure | 5 | Validated |
| t001w_plant | 10 | Validated |
| manufacture | 5 | Validated |
| aircraft_master | 10 | Validated |
| master_airports | 12 | Validated |
| master_suppliers | 6 | Validated |
| master_products | 3 | Validated |
| master_contracts | 6 | Validated |
| route_master | 15 | Needs fuel_required fix |

---

*Document ID: FDD-01-HLD | Version 2.1 | FuelSphere Master Data Module*
*© 2026 Diligent Global. All Rights Reserved.*

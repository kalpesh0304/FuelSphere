# FuelSphere - Contracts & CPE Integration High-Level Design

**Document ID**: FDD-03-HLD
**Version**: 1.0
**Status**: Active
**Last Updated**: January 18, 2026
**Prepared by**: Claude (Technical Architect)

---

## 1. Document Control

### 1.1 Amendment History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 18, 2026 | Claude (Technical Architect) | Initial Release |

---

## 2. Overview

### 2.1 Module Purpose

The Contracts & CPE (Commodity Pricing Engine) Integration module manages fuel purchase contracts and their associated pricing mechanisms. This module provides:

- Comprehensive contract lifecycle management
- CPE formula configuration and calculation
- Location-based pricing assignments
- Price index integration (Platts, MOPS, etc.)
- Real-time price calculation for fuel orders

### 2.2 Key Capabilities

| Capability | Description |
|------------|-------------|
| Contract Management | Create, update, and manage fuel purchase contracts |
| CPE Formula Definition | Configure multi-component pricing formulas |
| Location Assignment | Assign contracts to specific airports/plants |
| Product Coverage | Define which fuel products are covered per contract |
| Price Index Integration | Integrate external price indices (Platts Singapore, MOPS) |
| Price Calculation | Real-time fuel price calculation based on CPE rules |
| Contract Validity | Automatic validity period enforcement |
| Multi-Currency Support | Handle contracts in different currencies |

### 2.3 Business Value

| Metric | Benefit |
|--------|---------|
| Pricing Accuracy | Automated CPE calculations reduce manual errors |
| Contract Compliance | System-enforced contract terms and validity |
| Cost Visibility | Real-time price breakdown visibility |
| Audit Trail | Full history of price calculations and changes |
| Integration | Seamless sync with S/4HANA contract data |

---

## 3. Data Entities

### 3.1 Entity Overview

| Entity | Description | Primary Key | Source |
|--------|-------------|-------------|--------|
| MASTER_CONTRACTS | Contract header (existing) | id (UUID) | FuelSphere/S/4 |
| CONTRACT_PRICE_ELEMENTS | CPE formula components | id (UUID) | FuelSphere |
| CONTRACT_LOCATIONS | Airport/Plant assignments | id (UUID) | FuelSphere |
| CONTRACT_PRODUCTS | Product assignments per contract | id (UUID) | FuelSphere |
| PRICE_INDICES | External price indices | id (UUID) | External |
| PRICE_INDEX_VALUES | Historical index values | id (UUID) | External |

### 3.2 Entity Definitions

#### MASTER_CONTRACTS (Enhanced)

The existing MASTER_CONTRACTS entity is enhanced with additional fields:

| Field | Type | Description | Required |
|-------|------|-------------|----------|
| id | UUID | Unique identifier (PK) | Yes |
| contract_number | String(20) | Contract number | Yes |
| contract_name | String(100) | Contract description | Yes |
| supplier_id | UUID | FK to MASTER_SUPPLIERS | Yes |
| valid_from | Date | Contract start date | Yes |
| valid_to | Date | Contract end date | Yes |
| contract_type | String(20) | SPOT / TERM / FRAMEWORK | Yes |
| price_type | String(20) | CPE / FIXED / INDEX | Yes |
| currency_code | String(3) | Contract currency | Yes |
| payment_terms | String(20) | Payment terms (NET30, etc.) | No |
| incoterms | String(10) | Incoterms (DAP, FCA, etc.) | No |
| min_volume_kg | Decimal(15,2) | Minimum annual volume | No |
| max_volume_kg | Decimal(15,2) | Maximum annual volume | No |
| s4_contract_number | String(10) | S/4HANA Contract (EBELN) | No |
| is_active | Boolean | Active status | Yes |

#### CONTRACT_PRICE_ELEMENTS (New)

CPE formula components that define how fuel prices are calculated.

| Field | Type | Description | Required |
|-------|------|-------------|----------|
| id | UUID | Unique identifier (PK) | Yes |
| contract_id | UUID | FK to MASTER_CONTRACTS | Yes |
| element_code | String(20) | Element code (BASE, DIFF, TAX, etc.) | Yes |
| element_name | String(100) | Element description | Yes |
| element_type | String(20) | INDEX / FIXED / PERCENTAGE / FORMULA | Yes |
| sequence | Integer | Calculation sequence (1-99) | Yes |
| price_index_id | UUID | FK to PRICE_INDICES (if INDEX type) | No |
| fixed_value | Decimal(15,4) | Fixed value (if FIXED type) | No |
| percentage_value | Decimal(8,4) | Percentage (if PERCENTAGE type) | No |
| formula_expression | String(500) | Formula (if FORMULA type) | No |
| operation | String(10) | ADD / SUBTRACT / MULTIPLY | Yes |
| uom_code | String(3) | Unit of measure (KG, LTR, GAL) | No |
| currency_code | String(3) | Currency for this element | No |
| valid_from | Date | Element validity start | Yes |
| valid_to | Date | Element validity end | No |
| is_active | Boolean | Active status | Yes |

**Element Types:**

| Type | Description | Example |
|------|-------------|---------|
| INDEX | Based on external price index | Platts Singapore MOPS |
| FIXED | Fixed amount per unit | $0.05/kg location premium |
| PERCENTAGE | Percentage of base price | 3% tax |
| FORMULA | Calculated from other elements | (BASE + DIFF) * TAX_RATE |

#### CONTRACT_LOCATIONS (New)

Assigns contracts to specific airports/plants.

| Field | Type | Description | Required |
|-------|------|-------------|----------|
| id | UUID | Unique identifier (PK) | Yes |
| contract_id | UUID | FK to MASTER_CONTRACTS | Yes |
| airport_id | UUID | FK to MASTER_AIRPORTS | No |
| plant_code | String(4) | FK to T001W_PLANT | No |
| location_type | String(20) | PRIMARY / ALTERNATE | Yes |
| location_premium | Decimal(15,4) | Location-specific premium | No |
| priority | Integer | Selection priority (1=highest) | Yes |
| valid_from | Date | Location validity start | Yes |
| valid_to | Date | Location validity end | No |
| is_active | Boolean | Active status | Yes |

> **Note**: Either airport_id OR plant_code should be provided, not both.

#### CONTRACT_PRODUCTS (New)

Defines which fuel products are covered under each contract.

| Field | Type | Description | Required |
|-------|------|-------------|----------|
| id | UUID | Unique identifier (PK) | Yes |
| contract_id | UUID | FK to MASTER_CONTRACTS | Yes |
| product_id | UUID | FK to MASTER_PRODUCTS | Yes |
| product_premium | Decimal(15,4) | Product-specific premium | No |
| min_quantity | Decimal(15,2) | Minimum order quantity | No |
| max_quantity | Decimal(15,2) | Maximum order quantity | No |
| is_default | Boolean | Default product for contract | Yes |
| is_active | Boolean | Active status | Yes |

#### PRICE_INDICES (New)

External price index definitions.

| Field | Type | Description | Required |
|-------|------|-------------|----------|
| id | UUID | Unique identifier (PK) | Yes |
| index_code | String(20) | Index code (PLATTS_SG, MOPS, etc.) | Yes |
| index_name | String(100) | Full index name | Yes |
| index_provider | String(50) | Provider (Platts, Argus, etc.) | Yes |
| index_region | String(50) | Geographic region | Yes |
| product_type | String(20) | JET_FUEL / AVGAS / BIOFUEL | Yes |
| currency_code | String(3) | Index currency | Yes |
| uom_code | String(3) | Index UoM (BBL, MT, KG) | Yes |
| publication_frequency | String(20) | DAILY / WEEKLY / MONTHLY | Yes |
| publication_lag_days | Integer | Days after period end | No |
| data_source_url | String(500) | External data source URL | No |
| is_active | Boolean | Active status | Yes |

#### PRICE_INDEX_VALUES (New)

Historical price index values.

| Field | Type | Description | Required |
|-------|------|-------------|----------|
| id | UUID | Unique identifier (PK) | Yes |
| price_index_id | UUID | FK to PRICE_INDICES | Yes |
| effective_date | Date | Price effective date | Yes |
| price_value | Decimal(15,4) | Index price value | Yes |
| price_low | Decimal(15,4) | Daily low (if available) | No |
| price_high | Decimal(15,4) | Daily high (if available) | No |
| source_reference | String(100) | Publication reference | No |
| imported_at | DateTime | Import timestamp | Yes |
| imported_by | String(100) | Import user/system | No |

---

## 4. Entity Relationships

### 4.1 Foreign Key Matrix

| Source Entity | Foreign Key | Target Entity | Target Key |
|---------------|-------------|---------------|------------|
| CONTRACT_PRICE_ELEMENTS | contract_id | MASTER_CONTRACTS | id |
| CONTRACT_PRICE_ELEMENTS | price_index_id | PRICE_INDICES | id |
| CONTRACT_LOCATIONS | contract_id | MASTER_CONTRACTS | id |
| CONTRACT_LOCATIONS | airport_id | MASTER_AIRPORTS | id |
| CONTRACT_PRODUCTS | contract_id | MASTER_CONTRACTS | id |
| CONTRACT_PRODUCTS | product_id | MASTER_PRODUCTS | id |
| PRICE_INDEX_VALUES | price_index_id | PRICE_INDICES | id |

### 4.2 ERD Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    CONTRACTS & CPE ERD                                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌──────────────────┐                                                          │
│  │   PRICE_INDICES  │◄──────────────┐                                          │
│  │   (index_code)   │               │                                          │
│  └────────┬─────────┘               │                                          │
│           │                         │                                          │
│           ▼                         │                                          │
│  ┌──────────────────────┐           │                                          │
│  │ PRICE_INDEX_VALUES   │           │                                          │
│  │ (effective_date)     │           │                                          │
│  └──────────────────────┘           │                                          │
│                                     │                                          │
│  ┌──────────────────┐     ┌─────────┴──────────────┐                          │
│  │ MASTER_SUPPLIERS │◄────│   MASTER_CONTRACTS     │                          │
│  │  (supplier_id)   │     │   (contract_number)    │                          │
│  └──────────────────┘     └─────────┬──────────────┘                          │
│                                     │                                          │
│        ┌────────────────────────────┼────────────────────────────┐             │
│        ▼                            ▼                            ▼             │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐    │
│  │CONTRACT_PRICE_ELEMS │  │ CONTRACT_LOCATIONS  │  │ CONTRACT_PRODUCTS   │    │
│  │  (element_code)     │  │   (location_type)   │  │   (product_id)      │    │
│  └─────────┬───────────┘  └─────────┬───────────┘  └─────────┬───────────┘    │
│            │                        │                        │                 │
│            ▼                        ▼                        ▼                 │
│  ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐       │
│  │  PRICE_INDICES   │     │ MASTER_AIRPORTS  │     │ MASTER_PRODUCTS  │       │
│  └──────────────────┘     └──────────────────┘     └──────────────────┘       │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Service Definition

### 5.1 Service Path

| Service | Path | Purpose |
|---------|------|---------|
| ContractsService | `/odata/v4/contracts` | Contract and CPE management |

### 5.2 Entity Projections

| Entity | Service Name | Read | Create | Update | Delete |
|--------|--------------|------|--------|--------|--------|
| MASTER_CONTRACTS | Contracts | Yes | Yes | Yes | Yes* |
| CONTRACT_PRICE_ELEMENTS | PriceElements | Yes | Yes | Yes | Yes |
| CONTRACT_LOCATIONS | ContractLocations | Yes | Yes | Yes | Yes |
| CONTRACT_PRODUCTS | ContractProducts | Yes | Yes | Yes | Yes |
| PRICE_INDICES | PriceIndices | Yes | Yes | Yes | No |
| PRICE_INDEX_VALUES | PriceIndexValues | Yes | Yes | No | No |

> *Delete is soft-delete (set is_active = false)

### 5.3 Actions

| Action | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| calculatePrice | contractId, locationId, productId, quantity, date | PriceBreakdown | Calculate price using CPE formula |
| validateContract | contractId | ValidationResult | Validate contract completeness |
| syncFromS4 | contractNumber | SyncResult | Sync contract from S/4HANA |
| importPriceIndex | indexCode, fromDate, toDate | ImportResult | Import price index values |

### 5.4 Price Calculation Logic

```
calculatePrice(contractId, locationId, productId, quantity, effectiveDate):
    1. Retrieve contract and validate:
       - Contract is active
       - effectiveDate within valid_from/valid_to

    2. Retrieve applicable price elements (ordered by sequence)

    3. For each element:
       - INDEX: Fetch latest price_index_value for effective_date
       - FIXED: Use fixed_value
       - PERCENTAGE: Calculate from previous total
       - FORMULA: Evaluate formula_expression

    4. Apply location premium from CONTRACT_LOCATIONS

    5. Apply product premium from CONTRACT_PRODUCTS

    6. Return PriceBreakdown with:
       - base_price
       - elements[] with individual amounts
       - location_premium
       - product_premium
       - total_price
       - currency_code
       - calculation_date
```

---

## 6. S/4HANA Integration

### 6.1 API Mapping

| FuelSphere Entity | S/4HANA API | Direction | Frequency |
|-------------------|-------------|-----------|-----------|
| MASTER_CONTRACTS | API_PURCHASECONTRACT_SRV | Bidirectional | Real-time |
| CONTRACT_PRICE_ELEMENTS | ZAPI_CPEFORMULA_SRV | Inbound | 15-30 min TTL |
| PRICE_INDICES | External API (Platts, Argus) | Inbound | Daily |

### 6.2 Field Mappings (S/4HANA)

| FuelSphere Field | S/4HANA Field | Purpose |
|------------------|---------------|---------|
| contract_number | EBELN | Purchase contract number |
| supplier_id → s4_vendor_no | LIFNR | Vendor account number |
| valid_from | BEDAT | Contract start date |
| valid_to | ENDDT | Contract end date |

---

## 7. Authorization

### 7.1 Persona Access Matrix

| Persona | Contracts | PriceElements | Locations | Products | Indices |
|---------|-----------|---------------|-----------|----------|---------|
| contracts-manager | CRUD | CRUD | CRUD | CRUD | CR |
| fuel-planner | R | R | R | R | R |
| finance-manager | R | R | R | R | R |
| finance-controller | R | R | R | R | R |
| operations-manager | R | R | R | R | - |
| station-coordinator | R | - | R | R | - |
| integration-admin | CRUD | CRUD | CRUD | CRUD | CRUD |
| full-admin | CRUD | CRUD | CRUD | CRUD | CRUD |

> R = Read, C = Create, U = Update, D = Delete

### 7.2 Scope Requirements

| Scope | Description |
|-------|-------------|
| ContractRead | Read contract data |
| ContractWrite | Create/update contracts |
| ContractManage | Full contract administration |
| CPERead | Read CPE formulas |
| CPEWrite | Configure CPE formulas |

---

## 8. UI Screens

### 8.1 Screen Inventory

| Screen ID | Screen Name | Floorplan | Persona |
|-----------|-------------|-----------|---------|
| CT-001 | Contract Overview | List Report | contracts-manager |
| CT-002 | Contract Detail | Object Page | contracts-manager |
| CT-003 | Create Contract | Wizard | contracts-manager |
| CT-004 | CPE Formula Editor | Form | contracts-manager |
| CT-005 | Price Index Monitor | List Report | finance-manager |

### 8.2 Contract Detail Page Sections

| Section | Content |
|---------|---------|
| Header | Contract number, supplier, validity dates, status |
| General | Contract type, price type, currency, volumes |
| Price Elements | CPE formula components table |
| Locations | Assigned airports/plants table |
| Products | Covered fuel products table |
| S/4 Integration | S/4HANA contract reference, sync status |
| History | Change log, audit trail |

---

## 9. Error Codes

### 9.1 Error Code Family: CT4xx

| Error Code | Description | Resolution |
|------------|-------------|------------|
| CT400 | Contract validation failed | Review and correct input |
| CT401 | Contract number already exists | Use unique contract number |
| CT402 | Invalid validity period | End date must be after start |
| CT403 | Supplier not found | Select valid supplier |
| CT404 | Contract not found | Check contract ID |
| CT405 | Contract expired | Update validity dates |
| CT406 | No price elements defined | Add at least one CPE element |
| CT407 | Price index not found | Verify index code |
| CT408 | Price index value missing for date | Import index data |
| CT409 | Invalid formula expression | Correct formula syntax |
| CT410 | Location already assigned | Remove duplicate location |
| CT411 | Product already assigned | Remove duplicate product |
| CT412 | S/4HANA sync failed | Check integration settings |

---

## 10. Sample Data

### 10.1 Price Indices

| Index Code | Name | Provider | Region | Currency |
|------------|------|----------|--------|----------|
| PLATTS_SG | Platts Singapore Jet Kerosene | S&P Global Platts | Singapore | USD |
| MOPS_JET | MOPS Jet Kerosene | Platts | Asia Pacific | USD |
| ARGUS_EU | Argus European Jet | Argus Media | Northwest Europe | USD |
| NYMEX_HO | NYMEX Heating Oil | CME Group | North America | USD |

### 10.2 CPE Formula Example

For contract "SHELL-MNL-2026":

| Seq | Element | Type | Value | Operation |
|-----|---------|------|-------|-----------|
| 1 | BASE | INDEX | PLATTS_SG | BASE |
| 2 | DIFF | FIXED | 0.025 USD/kg | ADD |
| 3 | ITP | FIXED | 0.015 USD/kg | ADD |
| 4 | GOVT_TAX | PERCENTAGE | 3.5% | ADD |
| 5 | LOCATION | FIXED | -0.005 USD/kg | ADD |

**Calculation Example:**
- Base (Platts SG): $0.850/kg
- Differential: +$0.025/kg
- Into-Plane Fee: +$0.015/kg
- Subtotal: $0.890/kg
- Government Tax (3.5%): +$0.031/kg
- Location Adjustment: -$0.005/kg
- **Total Price: $0.916/kg**

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| CPE | Commodity Pricing Engine - dynamic pricing calculation |
| Differential | Premium/discount from base index price |
| Into-Plane (ITP) | Fee for fuel delivery to aircraft |
| MOPS | Mean of Platts Singapore - regional benchmark |
| Platts | S&P Global Platts - commodity price reporting |
| Spot | Single delivery contract at current market price |
| Term | Multi-delivery contract over a period |

---

*Document ID: FDD-03-HLD | Version 1.0 | FuelSphere Contracts & CPE Integration*
*© 2026 Diligent Global. All Rights Reserved.*

# FuelSphere - Overall Solution High-Level Design

**Document ID**: FS-HLD-001
**Version**: 1.1
**Status**: Active
**Last Updated**: January 12, 2026
**Prepared by**: Diligent Global

---

## 1. Document Control

### 1.1 Amendment History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 2026 | Kalpesh Chavda | Initial Release |
| 1.1 | Jan 12, 2026 | Claude (Technical Architect) | Added configurable personas, approval limits as setup data |

---

## 2. Executive Summary

### 2.1 Solution Overview

FuelSphere is a comprehensive airline fuel lifecycle management solution developed by Diligent Global that addresses the complete fuel lifecycle from strategic planning through financial closure. Built on SAP Business Technology Platform (BTP) and integrated with SAP S/4HANA, it targets airlines seeking to modernize fuel operations within existing SAP ecosystems.

The solution provides end-to-end visibility and control over fuel procurement, delivery, consumption tracking, and financial settlement. FuelSphere follows an innovative **ePOD-triggered lifecycle** where Purchase Orders and Goods Receipts are automatically created AFTER fuel delivery when the electronic Proof of Delivery (ePOD) is received from suppliers, ensuring financial documents reflect actual delivered quantities.

### 2.2 Business Value Proposition

| Metric | Current State | Target State | Business Impact |
|--------|---------------|--------------|-----------------|
| Invoice Processing Time | 7 days | < 2 days | 65% reduction in AP cycle |
| Manual Accruals | 100% | < 20% | Automated financial close |
| ePOD Availability | Manual paper | 100% digital | Real-time delivery visibility |
| Integration Error Rate | Variable | < 5% | Improved data quality |
| System Availability | N/A | 99.5% SLA | Enterprise reliability |
| Fuel Cost Visibility | Monthly | Real-time | Proactive cost management |

### 2.3 Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Platform | SAP Business Technology Platform (Cloud Foundry) | Cloud runtime environment |
| Database | SAP HANA Cloud | In-memory data persistence |
| Backend | SAP Cloud Application Programming Model (CAP) - Node.js | Business logic and API layer |
| Frontend | SAP Fiori Elements, SAPUI5, SAP Fiori 3 Horizon theme | User interface |
| Integration | SAP Integration Suite (CPI), SAP Event Mesh, OData V4 | System connectivity |
| Analytics | SAP Analytics Cloud (SAC) | Reporting and dashboards |
| ERP | SAP S/4HANA (FI/CO, MM) | Financial and material management |
| Authentication | SAP IAS/IPS, XSUAA, OAuth 2.0 | Identity and access management |

---

## 3. Solution Architecture

### 3.1 Architecture Overview

FuelSphere employs a cloud-native architecture built on SAP BTP, leveraging microservices patterns and event-driven integration. The solution architecture consists of three primary tiers:

- **Presentation Layer**: SAP Fiori Elements-based responsive UI accessible via desktop, tablet, and mobile devices
- **Application Layer**: CAP-based Node.js services handling business logic, validations, and orchestration
- **Data Layer**: SAP HANA Cloud for transactional data with integration to S/4HANA for master data

### 3.2 Integration Architecture

| Integration Point | Protocol | Direction | Purpose |
|-------------------|----------|-----------|---------|
| SAP S/4HANA | OData V4 / BAPI | Bidirectional | Master data, PO/GR posting, financial documents |
| SAP Event Mesh | MQTT / AMQP | Bidirectional | Real-time event distribution |
| Supplier EDI Gateway | AS2 / SFTP | Inbound | ePOD receipt, invoice import |
| Flight Operations System | REST API / SFTP | Inbound | Flight schedules (SSIM format) |
| Aircraft ACARS | WebSocket / REST | Inbound | Real-time fuel burn data |
| Flight Dispatch System | REST API | Bidirectional | Fuel uplift requirements |
| Shell Skypad | REST API | Bidirectional | Fuel delivery coordination |
| CPE (Commodity Pricing) | OData / Custom API | Inbound | Dynamic fuel pricing |
| SAP Analytics Cloud | OData | Outbound | Analytics and reporting |

### 3.3 Security Architecture

**Authentication:**
- SAP Identity Authentication Service (IAS) for user authentication
- OAuth 2.0 for API authentication with token-based access
- XSUAA for authorization token management and scope validation

**Authorization:**
- Role-based access control (RBAC) with predefined business roles
- Station-level data restrictions for operational roles
- Field-level security for sensitive financial attributes

**Data Protection:**
- Encryption at rest via HANA Cloud native encryption (AES-256)
- Encryption in transit via TLS 1.2+ for all communications
- SAP Object Store with encryption for document storage

---

## 4. Functional Modules Overview

FuelSphere comprises **13 functional modules** that work together to provide end-to-end fuel lifecycle management.

| Module ID | Module Name | Primary Function | Key Users |
|-----------|-------------|------------------|-----------|
| FDD-01 | Master Data Management | Centralized reference data | Data Manager, IT Admin |
| FDD-02 | Annual Fuel Planning & Budgeting | Demand forecasting, budgets | Fuel Planner, Finance |
| FDD-03 | Contracts & Commodity Pricing | Contract and CPE management | Procurement, Finance |
| FDD-04 | Fuel Orders & Milestones | Order lifecycle tracking | Fuel Planner, Station Ops |
| FDD-05 | Fuel Ticket & ePOD | Delivery confirmation | Station Coordinator |
| FDD-06 | Invoice Verification | Three-way matching | AP Specialist, Finance |
| FDD-07 | Compliance & Embargo | Regulatory validation | Compliance Officer |
| FDD-08 | Fuel Burn & ROB | Consumption tracking | Operations Manager |
| FDD-09 | Fuel Cost Allocation | COPA posting | Cost Controller |
| FDD-10 | Finance Postings & Settlement | S/4 financial integration | Finance Manager |
| FDD-11 | Integration Monitoring | API health and errors | Integration Admin |
| FDD-12 | Reporting & Analytics | Dashboards and insights | All Personas |
| FDD-13 | Security & Access | RBAC, Admin, Configuration | System Admin |

### 4.4 Fuel Orders & Milestones (FDD-04)

**9-Milestone Lifecycle:**

| Seq | Milestone Code | Milestone Name | Trigger | S/4 Action |
|-----|----------------|----------------|---------|------------|
| 1 | CREATED | Order Created | Planner creates order | PM Order created |
| 2 | SUBMITTED | Submitted to Supplier | Order dispatched via EDI | None |
| 3 | CONFIRMED | Supplier Confirmed | Supplier acknowledgment | None |
| 4 | DISPATCHED | Fuel Dispatched | Bowser leaves depot | None |
| 5 | ARRIVED | Arrived at Aircraft | Bowser at aircraft | None |
| 6 | FUELING | Fueling In Progress | Fueling started | None |
| 7 | COMPLETED | Fueling Complete | ePOD received | **Auto PO + GR created** |
| 8 | INVOICED | Invoice Received | Supplier invoice | Invoice verification |
| 9 | SETTLED | Financially Settled | Payment complete | AP posting complete |

---

## 5. Authorization & Personas

### 5.1 Persona Summary

FuelSphere implements **11 personas** with role-based access control:

| Persona ID | Persona Name | Apps | Primary Function |
|------------|--------------|------|------------------|
| `fuel-planner` | Fuel Planning Manager | 14 | Strategic fuel planning |
| `contracts-manager` | Fuel Contracts Manager | 5 | Supplier contracts |
| `finance-manager` | Finance Manager | 9 | Invoice approval |
| `finance-controller` | Finance Controller | 9 | Invoice verification |
| `operations-manager` | Operations Manager | 12 | Station operations |
| `station-coordinator` | Station Coordinator | 8 | Daily operations |
| `ap-clerk` | Accounts Payable Clerk | 7 | Invoice entry |
| `integration-admin` | Integration Administrator | 11 | System monitoring |
| `analyst` | Fuel Analyst | 10 | Reporting |
| `auditor` | Internal Auditor | 6 | Compliance |
| `full-admin` | System Administrator | 42 | Full access |

### 5.2 Configurable Authorization (Design Decision DD-001)

> **Decision Date**: January 12, 2026

Personas and their tile assignments are **configurable**, not hardcoded:

- **Personas**: Delivered as recommended seed data, customers can customize
- **Tile Assignments**: Configurable via Administration menu
- **User-Persona Mapping**: Managed by customer administrators
- **Station Assignments**: Configurable per user

**Configuration Entities:**
```
CONFIG_PERSONAS          - Persona definitions (seed data)
CONFIG_TILES             - Application tile definitions
CONFIG_PERSONA_TILES     - Persona ↔ Tile mapping (customizable)
CONFIG_USER_PERSONAS     - User ↔ Persona assignment
CONFIG_USER_STATIONS     - User ↔ Station assignment
```

### 5.3 Configurable Approval Limits (Design Decision DD-002)

> **Decision Date**: January 12, 2026

Approval limits are **setup data** configured at deployment:

**Fuel Order Approval Limits (Default):**

| Persona | Single Order (kg) | Daily Limit (kg) |
|---------|-------------------|------------------|
| station-coordinator | 10,000 | 50,000 |
| operations-manager | 100,000 | 500,000 |
| full-admin | Unlimited | Unlimited |

**Invoice Approval Limits (Default):**

| Persona | Single Invoice | Monthly Limit |
|---------|----------------|---------------|
| ap-clerk | $0 (no approval) | - |
| finance-controller | $50,000 | $500,000 |
| finance-manager | Unlimited | Unlimited |

**Configuration Entity:**
```
CONFIG_APPROVAL_LIMITS   - Approval thresholds per persona (customizable)
```

---

## 6. Data Model

### 6.1 Core Database Entities

| Namespace | Entity | Description | Primary Key |
|-----------|--------|-------------|-------------|
| fuel | FuelOrders | Main fuel order entity | ID (String 20) |
| fuel | FuelOrderItems | Line items | ID (UUID) |
| fuel | FuelOrderPricing | CPE price breakdown | ID (UUID) |
| fuel | FuelOrderMilestones | 9-milestone tracking | ID (UUID) |
| fuel | FuelTickets | Delivery records | ID (String 30) |
| master | Suppliers | Supplier master | ID (UUID) |
| master | Contracts | Contract master | ID (UUID) |
| master | Airports | Airport master | ID (UUID) |
| master | Products | Fuel products | ID (UUID) |
| procurement | PurchaseOrders | Auto-created after ePOD | poNumber (String 10) |
| materials | GoodsReceipts | Auto-created after ePOD | grNumber (String 10) |
| finance | Invoices | Supplier invoices | invoiceNumber (String 16) |

---

## 7. S/4HANA Integration APIs

| API | Type | Direction | Purpose |
|-----|------|-----------|---------|
| API_BUSINESS_PARTNER | Standard | Bidirectional | Supplier master data sync |
| API_PRODUCT_SRV | Standard | Inbound | Material/Product data |
| API_PURCHASEORDER_SRV | Standard | Outbound | Create PO from ePOD |
| API_MATERIAL_DOCUMENT_SRV | Standard | Outbound | Create GR (Movement 101) |
| API_SUPPLIERINVOICE_SRV | Standard | Outbound | Post vendor invoices |
| API_JOURNALENTRY_SRV | Standard | Outbound | COPA and accrual postings |
| API_PURCHASECONTRACT_SRV | Standard | Bidirectional | Purchase contract sync |
| API_CURRENCY_EXCHANGE_RATES | Standard | Inbound | FX rates |
| ZAPI_CPEFORMULA_SRV | Custom | Inbound | CPE pricing formulas |
| ZAPI_PLANT_SRV | Custom | Inbound | Plant/Airport mapping |
| ZAPI_STLOC_SRV | Custom | Inbound | Storage location data |

---

## 8. UI Screen Inventory

### 8.1 Complete Screen List (42 Screens)

| Module | Screen ID | Screen Name | Floorplan |
|--------|-----------|-------------|-----------|
| Master Data | MD-001 | Master Data Dashboard | Overview Page |
| Master Data | MD-002 | Airport Master Data | List Report |
| Master Data | MD-003 | Aircraft Master Data | List Report |
| Master Data | MD-004 | Route Master Data | List Report |
| Master Data | MD-005 | Fuel Requirements Management | Editable Table |
| Master Data | MD-006 | Flight Records Monitor | List Report |
| Planning | PF-001 | Fuel Planner Workspace | Overview Page |
| Planning | PF-002 | Fuel Demand Forecast | Analytical List |
| Planning | PF-003 | Forecast Accuracy Analysis | Analytical Page |
| Planning | PF-004 | Flight Dispatch Calculation | Wizard |
| Planning | PF-005 | Route Aircraft Matrix | Matrix View |
| Planning | PF-006 | Fuel Burn & ROB Dashboard | Overview Page |
| Planning | PF-007 | Fuel Cost Forecast | Analytical Page |
| Fuel Ops | FO-001 | Fuel Order Overview | List Report |
| Fuel Ops | FO-002 | Fuel Order Detail | Object Page |
| Fuel Ops | FO-003 | Create Fuel Order | Wizard |
| Finance | FI-001 | Invoice Verification Dashboard | Overview Page |
| Finance | FI-002 | Invoice Register | List Report |
| Finance | FI-003 | Invoice Detail (Three-Way Match) | Object Page |
| Finance | FI-004 | Cost Allocation & COPA | Analytical Page |
| Finance | FI-005 | Fuel Cost Forecast | Analytical Page |
| Finance | FI-006 | Financial Reconciliation Dashboard | Overview Page |
| Analytics | AR-001 | Fuel Dashboard (Executive) | Overview Page |
| Analytics | AR-002 | Historical Fuel Analysis | Analytical Page |
| Analytics | AR-003 | Supplier Performance Scorecard | Analytical Page |
| Analytics | AR-004 | Route Profitability Analysis | Analytical Page |
| Analytics | AR-005 | Fuel Cost Trends & Forecasting | Analytical Page |
| Admin | IA-001 | Integration Cockpit | Overview Page |
| Admin | IA-002 | Error Management Console | Worklist |
| Admin | IA-003 | System Health Monitor | Overview Page |
| Admin | IA-004 | User Administration | List Report |
| Admin | IA-005 | Persona-Tile Configuration | Configuration Page |
| Admin | IA-006 | Approval Limits Configuration | Configuration Page |

---

## 9. Testing Requirements

### 9.1 Performance Requirements

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Page Load Time | < 2 seconds | Lighthouse Performance Score |
| API Response Time | < 500ms (95th percentile) | Application Insights |
| Concurrent Users | 500 simultaneous users | Load testing (JMeter) |
| Batch Processing | 100,000 records/hour | Scheduled job monitoring |
| S/4 Integration | < 3 seconds round-trip | Integration monitoring |
| System Availability | 99.5% uptime | BTP monitoring |

---

## 10. Assumptions & Constraints

### 10.1 Assumptions

- SAP S/4HANA is the system of record for supplier, product, and organizational master data
- FuelSphere is the system of record for aircraft, airport, route, and flight schedule data
- CPE formulas are maintained in SAP Commodity Pricing Engine
- Network latency between BTP and S/4HANA is acceptable for real-time operations (< 100ms)
- All fuel quantities are standardized to kilograms (KG) as the base UoM

### 10.2 Out of Scope (Release 1.0)

- Multi-tenant master data management
- Advanced data quality scoring algorithms (AI/ML)
- Machine learning-based demand prediction
- Bi-directional sync for FuelSphere native entities to S/4HANA
- Third-party flight data provider integrations (e.g., OAG)
- Mobile-native applications (responsive web only for v1.0)
- Multi-language UI support (English only for v1.0)
- Biofuel blending calculations and sustainability reporting

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| ACARS | Aircraft Communications Addressing and Reporting System |
| BTP | SAP Business Technology Platform |
| CAP | Cloud Application Programming Model |
| COPA | Profitability Analysis in SAP |
| CPE | Commodity Pricing Engine |
| ePOD | Electronic Proof of Delivery |
| GR | Goods Receipt |
| IATA | International Air Transport Association |
| ICAO | International Civil Aviation Organization |
| OData | Open Data Protocol |
| PO | Purchase Order |
| ROB | Remaining On Board |
| SSIM | Standard Schedules Information Manual |

---

*Document ID: FS-HLD-001 | Version 1.1 | FuelSphere Overall High-Level Design*
*© 2026 Diligent Global. All Rights Reserved.*

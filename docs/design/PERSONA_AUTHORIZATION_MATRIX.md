# Fuelsphere - Persona Authorization Matrix
## Complete Role-Based Access Control Documentation

**Version**: 1.0  
**Date**: January 12, 2026  
**Status**: Production-Ready  
**System**: Fuelsphere Airline Fuel Management System

---

## 📋 Document Overview

This document provides a comprehensive mapping of all Fuelsphere personas (roles) and their authorized access to application tiles and screens. The authorization model follows SAP Fiori 3 Horizon design principles with role-based access control (RBAC) aligned to business processes.

### Authorization Principles
- **Role-Based Access**: Users are assigned one or more personas based on job responsibilities
- **Least Privilege**: Users have access only to applications required for their role
- **Segregation of Duties**: Finance, operations, and planning roles are separated
- **Audit Trail**: All access and actions are logged for compliance

---

## 👥 Persona Summary

| Persona ID | Persona Name | User Example | Email | Total Apps | Primary Function |
|------------|--------------|--------------|-------|------------|------------------|
| `fuel-planner` | Fuel Planning Manager | John Doe (JD) | john.doe@airline.com | 14 | Strategic fuel planning & forecasting |
| `contracts-manager` | Fuel Contracts Manager | Sarah Martinez (SM) | sarah.martinez@airline.com | 5 | Supplier contracts & pricing |
| `finance-manager` | Finance Manager | Michael Chen (MC) | michael.chen@airline.com | 9 | Invoice processing & financial control |
| `finance-controller` | Finance Controller | John Tan (JT) | john.tan@airline.com | 9 | Invoice verification & reconciliation |
| `operations-manager` | Operations Manager | Lisa Thompson (LT) | lisa.thompson@airline.com | 12 | Station operations & fuel coordination |
| `station-coordinator` | Station Coordinator | Maria Garcia (MG) | maria.garcia@airline.com | 8 | Daily station fuel operations |
| `ap-clerk` | Accounts Payable Clerk | Jennifer Wong (JW) | jennifer.wong@airline.com | 7 | Invoice data entry & verification |
| `integration-admin` | Integration Administrator | David Kumar (DK) | david.kumar@airline.com | 11 | System integration & monitoring |
| `analyst` | Fuel Analyst | Robert Lee (RL) | robert.lee@airline.com | 10 | Data analysis & reporting |
| `auditor` | Internal Auditor | Patricia Smith (PS) | patricia.smith@airline.com | 6 | Compliance & audit review |
| `full-admin` | System Administrator | Admin User (AD) | admin@airline.com | 42 | Full system access |

---

## 🎯 Detailed Persona Authorization

### 1. Fuel Planning Manager (`fuel-planner`)

**Primary Responsibilities**: Strategic fuel planning, demand forecasting, scenario analysis, flight schedule planning

**Authorized Applications**: 14 tiles

#### Planning & Forecasting (8 tiles)
- ✅ **Fuel Planning** (`planner-home`) - Home dashboard with KPIs
- ✅ **Planning Workspace** (`planner-workspace`) - Annual planning tool
- ✅ **Planning Versions** (`planning-versions`) - Version management
- ✅ **Scenario Analysis** (`scenario-comparison`) - Scenario comparison workbench
- ✅ **Flight Schedule** (`flight-schedule`) - Flight schedule management
- ✅ **Calculation Results** (`calculation-results`) - Demand calculation analytics
- ✅ **Matrix View** (`matrix-view`) - Route-Aircraft matrix planning
- ✅ **Mobile Planning** (`mobile-view`) - Mobile planning workspace

#### Fuel Operations (2 tiles)
- ✅ **Fuel Requests** (`fuel-request-dashboard`) - Request dashboard with KPIs
- ✅ **Request Register** (`fuel-request-register`) - Browse all requests

#### Master Data (2 tiles)
- ✅ **Master Data** (`master-data-dashboard`) - Master data overview
- ✅ **Route Master** (`route-master`) - Route configuration

#### Resources (2 tiles)
- ✅ **Documentation** (`documentation-hub`) - User guides and help
- ✅ **Launchpad** (`launchpad-home`) - Home page

**Screen-Level Access**: View, Edit planning data; View-only Fuel Orders; No Finance access

---

### 2. Fuel Contracts Manager (`contracts-manager`)

**Primary Responsibilities**: Supplier contract management, pricing negotiation, compliance monitoring, supplier performance tracking

**Authorized Applications**: 5 tiles

#### Contracts & Procurement (4 tiles)
- ✅ **Contracts** (`contract-manager-home`) - Contract management dashboard
- ✅ **Supplier Performance** (`supplier-scorecard`) - Supplier scorecard analytics
- ✅ **Compliance Tracker** (`compliance-tracker`) - Contract compliance monitoring
- ✅ **CPE Analysis** (`cpe-analysis`) - Commodity Pricing Engine workbench

#### Resources (1 tile)
- ✅ **Documentation** (`documentation-hub`) - User guides and help

**Screen-Level Access**: Full edit on Contracts, Suppliers, Pricing; View-only Fuel Orders; No Finance posting access

---

### 3. Finance Manager (`finance-manager`)

**Primary Responsibilities**: Invoice approval, financial control, budget management, cost allocation oversight

**Authorized Applications**: 9 tiles

#### Finance Operations (6 tiles)
- ✅ **Finance Controller** (`finance-controller`) - Main finance dashboard
- ✅ **Smart Invoice Queue** (`smart-invoice-queue`) - AI-powered invoice prioritization
- ✅ **Invoice Validation** (`invoice-validation-wizard`) - Guided validation workflow
- ✅ **AP Analytics** (`ap-analytics`) - Personal performance analytics
- ✅ **Cost Allocation** (`finance-cost-allocation`) - CO-PA segment assignment
- ✅ **Reconciliation** (`finance-reconciliation`) - Budget vs actual analysis

#### Fuel Operations (2 tiles)
- ✅ **Fuel Requests** (`fuel-request-dashboard`) - Request dashboard (view-only)
- ✅ **Request Register** (`fuel-request-register`) - Browse requests (view-only)

#### Resources (1 tile)
- ✅ **Documentation** (`documentation-hub`) - User guides and help

**Screen-Level Access**: Full access to Invoice processing, approval, posting; View-only Fuel Orders; Edit Cost allocation

---

### 4. Finance Controller (`finance-controller`)

**Primary Responsibilities**: Invoice verification, 3-way matching, goods receipt verification, payment processing

**Authorized Applications**: 9 tiles

#### Finance Operations (6 tiles)
- ✅ **Finance Controller** (`finance-controller`) - Main finance dashboard
- ✅ **Smart Invoice Queue** (`smart-invoice-queue`) - AI-powered invoice prioritization
- ✅ **Invoice Validation** (`invoice-validation-wizard`) - Guided validation workflow
- ✅ **AP Analytics** (`ap-analytics`) - Personal performance analytics
- ✅ **Cost Allocation** (`finance-cost-allocation`) - CO-PA segment assignment
- ✅ **Reconciliation** (`finance-reconciliation`) - Budget vs actual analysis

#### Fuel Operations (2 tiles)
- ✅ **Fuel Requests** (`fuel-request-dashboard`) - Request dashboard (view-only)
- ✅ **Request Register** (`fuel-request-register`) - Browse requests (view-only)

#### Resources (1 tile)
- ✅ **Documentation** (`documentation-hub`) - User guides and help

**Screen-Level Access**: Full access to Invoice verification, 3-way match, GR verification; View-only Fuel Orders; Limited posting (requires approval)

---

### 5. Operations Manager (`operations-manager`)

**Primary Responsibilities**: Station operations coordination, fuel delivery management, exception handling, shift oversight

**Authorized Applications**: 12 tiles

#### Station Operations (5 tiles)
- ✅ **Operations Center** (`station-operations`) - Real-time control center
- ✅ **My Work Queue** (`work-queue`) - Personal task queue
- ✅ **Quick Request** (`quick-request`) - Quick fuel request creation
- ✅ **Exceptions** (`exception-management`) - Exception tracking
- ✅ **Shift Handover** (`shift-handover`) - Shift documentation

#### Fuel Operations (2 tiles)
- ✅ **Fuel Requests** (`fuel-request-dashboard`) - Request dashboard with KPIs
- ✅ **Request Register** (`fuel-request-register`) - Browse all requests

#### Flight Schedule (1 tile)
- ✅ **Flight Schedule** (`flight-schedule`) - Flight schedule management

#### Master Data (2 tiles)
- ✅ **Master Data** (`master-data-dashboard`) - Master data overview
- ✅ **Airport Master** (`airport-master`) - Airport configuration

#### Resources (2 tiles)
- ✅ **Documentation** (`documentation-hub`) - User guides and help
- ✅ **Launchpad** (`launchpad-home`) - Home page

**Screen-Level Access**: Full edit Fuel Orders, ROB, Fuel Tickets; View Flight schedules; No Finance access; No Planning edit

---

### 6. Station Coordinator (`station-coordinator`)

**Primary Responsibilities**: Daily fuel ordering, delivery tracking, ROB management, ePOD processing

**Authorized Applications**: 8 tiles

#### Station Operations (4 tiles)
- ✅ **Operations Center** (`station-operations`) - Real-time control center
- ✅ **My Work Queue** (`work-queue`) - Personal task queue
- ✅ **Quick Request** (`quick-request`) - Quick fuel request creation
- ✅ **Exceptions** (`exception-management`) - Exception tracking

#### Fuel Operations (2 tiles)
- ✅ **Fuel Requests** (`fuel-request-dashboard`) - Request dashboard
- ✅ **Request Register** (`fuel-request-register`) - Browse requests

#### Resources (2 tiles)
- ✅ **Documentation** (`documentation-hub`) - User guides and help
- ✅ **Launchpad** (`launchpad-home`) - Home page

**Screen-Level Access**: Create/Edit Fuel Orders for assigned station only; Full ROB management; ePOD upload; No approval authority; No Finance access

---

### 7. Accounts Payable Clerk (`ap-clerk`)

**Primary Responsibilities**: Invoice data entry, document verification, payment preparation, vendor communication

**Authorized Applications**: 7 tiles

#### Finance Operations (5 tiles)
- ✅ **Finance Controller** (`finance-controller`) - Main finance dashboard
- ✅ **Smart Invoice Queue** (`smart-invoice-queue`) - Invoice queue
- ✅ **Invoice Validation** (`invoice-validation-wizard`) - Validation workflow
- ✅ **AP Analytics** (`ap-analytics`) - Personal performance analytics
- ✅ **Cost Allocation** (`finance-cost-allocation`) - Cost allocation (view-only)

#### Fuel Operations (1 tile)
- ✅ **Request Register** (`fuel-request-register`) - Browse requests (view-only)

#### Resources (1 tile)
- ✅ **Documentation** (`documentation-hub`) - User guides and help

**Screen-Level Access**: Create/Edit invoices; Submit for approval; No posting authority; View-only Fuel Orders and Cost allocation

---

### 8. Integration Administrator (`integration-admin`)

**Primary Responsibilities**: System integration monitoring, API management, error resolution, data quality oversight

**Authorized Applications**: 11 tiles

#### Integration & Admin (7 tiles)
- ✅ **Integration** (`integration-dashboard`) - Integration health monitoring
- ✅ **API Performance** (`api-performance`) - API metrics and trends
- ✅ **Error Console** (`error-console`) - Error tracking and resolution
- ✅ **Master Data Sync** (`master-data-sync`) - S/4HANA sync monitoring
- ✅ **Data Quality** (`data-quality`) - Data validation dashboard
- ✅ **System Health** (`system-health`) - BTP platform monitoring
- ✅ **Audit Log** (`audit-log`) - System audit trail

#### Master Data (2 tiles)
- ✅ **Master Data** (`master-data-dashboard`) - Master data overview
- ✅ **Configuration** (`integration-config`) - Integration configuration

#### Resources (2 tiles)
- ✅ **Documentation** (`documentation-hub`) - User guides and help
- ✅ **Launchpad** (`launchpad-home`) - Home page

**Screen-Level Access**: Full access to Integration tools; View/Edit Master data; View-only operational screens; No Finance posting

---

### 9. Fuel Analyst (`analyst`)

**Primary Responsibilities**: Data analysis, reporting, trend analysis, performance metrics

**Authorized Applications**: 10 tiles

#### Analytics & Reporting (4 tiles)
- ✅ **Analytics Dashboard** (`analytics-dashboard`) - Main analytics hub
- ✅ **Fuel Cost Forecast** (`fuel-cost-forecast`) - Cost forecasting
- ✅ **Historical Analysis** (`historical-analysis`) - Historical fuel analysis
- ✅ **Reconciliation Reports** (`reconciliation-reports`) - Variance reporting

#### Planning & Forecasting (3 tiles)
- ✅ **Calculation Results** (`calculation-results`) - Demand calculation analytics
- ✅ **Scenario Analysis** (`scenario-comparison`) - Scenario comparison (view-only)
- ✅ **Matrix View** (`matrix-view`) - Route-Aircraft matrix (view-only)

#### Fuel Operations (2 tiles)
- ✅ **Fuel Requests** (`fuel-request-dashboard`) - Request dashboard (view-only)
- ✅ **Request Register** (`fuel-request-register`) - Browse requests (view-only)

#### Resources (1 tile)
- ✅ **Documentation** (`documentation-hub`) - User guides and help

**Screen-Level Access**: View-only all operational screens; Full access to Analytics; Export to Excel; Create custom reports

---

### 10. Internal Auditor (`auditor`)

**Primary Responsibilities**: Compliance review, audit trail verification, control testing, risk assessment

**Authorized Applications**: 6 tiles

#### Audit & Compliance (2 tiles)
- ✅ **Audit Log** (`audit-log`) - Complete audit trail
- ✅ **Compliance Tracker** (`compliance-tracker`) - Contract compliance (view-only)

#### Finance Operations (2 tiles)
- ✅ **Finance Controller** (`finance-controller`) - Finance dashboard (view-only)
- ✅ **Reconciliation** (`finance-reconciliation`) - Reconciliation reports (view-only)

#### Fuel Operations (1 tile)
- ✅ **Request Register** (`fuel-request-register`) - Browse requests (view-only)

#### Resources (1 tile)
- ✅ **Documentation** (`documentation-hub`) - User guides and help

**Screen-Level Access**: View-only ALL screens; Full access to Audit logs; Export audit reports; No edit or approval authority

---

### 11. System Administrator (`full-admin`)

**Primary Responsibilities**: System administration, user management, configuration, full oversight

**Authorized Applications**: 42 tiles (ALL)

#### Access Level
- ✅ **ALL APPLICATIONS** - Complete system access
- ✅ **ALL SCREENS** - Full view and edit permissions
- ✅ **User Management** - Create, modify, deactivate users
- ✅ **Authorization Management** - Assign roles and permissions
- ✅ **System Configuration** - Global settings and customization

**Screen-Level Access**: Full unrestricted access to all modules and functions

---

## 📊 Application Access Matrix

### Fuel Planning Applications

| Application | Tile ID | fuel-planner | operations-manager | analyst | full-admin |
|-------------|---------|:------------:|:------------------:|:-------:|:----------:|
| Fuel Planning Home | `planner-home` | ✅ Edit | ❌ | ❌ | ✅ Edit |
| Planning Workspace | `planner-workspace` | ✅ Edit | ❌ | ❌ | ✅ Edit |
| Planning Versions | `planning-versions` | ✅ Edit | ❌ | ❌ | ✅ Edit |
| Scenario Analysis | `scenario-comparison` | ✅ Edit | ❌ | 👁️ View | ✅ Edit |
| Flight Schedule | `flight-schedule` | ✅ Edit | 👁️ View | ❌ | ✅ Edit |
| Calculation Results | `calculation-results` | ✅ Edit | ❌ | 👁️ View | ✅ Edit |
| Matrix View | `matrix-view` | ✅ Edit | ❌ | 👁️ View | ✅ Edit |
| Mobile Planning | `mobile-view` | ✅ Edit | ❌ | ❌ | ✅ Edit |

---

### Contracts & Procurement Applications

| Application | Tile ID | contracts-manager | full-admin |
|-------------|---------|:-----------------:|:----------:|
| Contracts Home | `contract-manager-home` | ✅ Edit | ✅ Edit |
| Supplier Performance | `supplier-scorecard` | ✅ Edit | ✅ Edit |
| Compliance Tracker | `compliance-tracker` | ✅ Edit | ✅ Edit |
| CPE Analysis | `cpe-analysis` | ✅ Edit | ✅ Edit |

---

### Station Operations Applications

| Application | Tile ID | operations-manager | station-coordinator | full-admin |
|-------------|---------|:------------------:|:-------------------:|:----------:|
| Operations Center | `station-operations` | ✅ Edit | ✅ Edit* | ✅ Edit |
| My Work Queue | `work-queue` | ✅ Edit | ✅ Edit* | ✅ Edit |
| Quick Request | `quick-request` | ✅ Edit | ✅ Edit* | ✅ Edit |
| Exceptions | `exception-management` | ✅ Edit | ✅ Edit* | ✅ Edit |
| Shift Handover | `shift-handover` | ✅ Edit | ❌ | ✅ Edit |

**Note**: * Station Coordinator access limited to assigned station only

---

### Fuel Operations Applications

| Application | Tile ID | fuel-planner | operations-manager | station-coordinator | finance-controller | analyst | auditor | full-admin |
|-------------|---------|:------------:|:------------------:|:-------------------:|:------------------:|:-------:|:-------:|:----------:|
| Fuel Request Dashboard | `fuel-request-dashboard` | 👁️ View | ✅ Edit | ✅ Edit* | 👁️ View | 👁️ View | 👁️ View | ✅ Edit |
| Request Register | `fuel-request-register` | 👁️ View | ✅ Edit | ✅ Edit* | 👁️ View | 👁️ View | 👁️ View | ✅ Edit |

**Note**: * Station Coordinator can only edit requests for assigned station

---

### Finance Operations Applications

| Application | Tile ID | finance-manager | finance-controller | ap-clerk | auditor | full-admin |
|-------------|---------|:---------------:|:------------------:|:--------:|:-------:|:----------:|
| Finance Controller | `finance-controller` | ✅ Edit | ✅ Edit | ✅ Edit** | 👁️ View | ✅ Edit |
| Smart Invoice Queue | `smart-invoice-queue` | ✅ Edit | ✅ Edit | ✅ Edit** | ❌ | ✅ Edit |
| Invoice Validation | `invoice-validation-wizard` | ✅ Edit | ✅ Edit | ✅ Edit** | ❌ | ✅ Edit |
| AP Analytics | `ap-analytics` | ✅ View | ✅ View | ✅ View | ❌ | ✅ View |
| Cost Allocation | `finance-cost-allocation` | ✅ Edit | ✅ Edit | 👁️ View | 👁️ View | ✅ Edit |
| Reconciliation | `finance-reconciliation` | ✅ View | ✅ View | ❌ | 👁️ View | ✅ Edit |

**Note**: ** AP Clerk has no posting authority (create/edit only, requires approval)

---

### Integration & Admin Applications

| Application | Tile ID | integration-admin | full-admin |
|-------------|---------|:-----------------:|:----------:|
| Integration Dashboard | `integration-dashboard` | ✅ Edit | ✅ Edit |
| API Performance | `api-performance` | ✅ View | ✅ View |
| Error Console | `error-console` | ✅ Edit | ✅ Edit |
| Master Data Sync | `master-data-sync` | ✅ Edit | ✅ Edit |
| Data Quality | `data-quality` | ✅ Edit | ✅ Edit |
| System Health | `system-health` | ✅ View | ✅ View |
| Audit Log | `audit-log` | ✅ View | ✅ View |

---

### Master Data Applications

| Application | Tile ID | fuel-planner | operations-manager | integration-admin | full-admin |
|-------------|---------|:------------:|:------------------:|:-----------------:|:----------:|
| Master Data Dashboard | `master-data-dashboard` | 👁️ View | 👁️ View | ✅ Edit | ✅ Edit |
| Route Master | `route-master` | 👁️ View | ❌ | ✅ Edit | ✅ Edit |
| Airport Master | `airport-master` | ❌ | 👁️ View | ✅ Edit | ✅ Edit |
| Aircraft Master | `aircraft-master` | ❌ | ❌ | ✅ Edit | ✅ Edit |
| Supplier Master | `supplier-master` | ❌ | ❌ | ✅ Edit | ✅ Edit |

---

### Analytics & Reporting Applications

| Application | Tile ID | analyst | fuel-planner | full-admin |
|-------------|---------|:-------:|:------------:|:----------:|
| Analytics Dashboard | `analytics-dashboard` | ✅ View | 👁️ View | ✅ View |
| Fuel Cost Forecast | `fuel-cost-forecast` | ✅ View | 👁️ View | ✅ View |
| Historical Analysis | `historical-analysis` | ✅ View | 👁️ View | ✅ View |
| Reconciliation Reports | `reconciliation-reports` | ✅ View | ❌ | ✅ View |

---

## 🔐 Authorization Controls

### Field-Level Security

#### Fuel Orders
| Field | fuel-planner | operations-manager | station-coordinator | finance-controller |
|-------|:------------:|:------------------:|:-------------------:|:------------------:|
| Order Number | 👁️ View | 👁️ View | 👁️ View | 👁️ View |
| Station | 👁️ View | ✅ Edit | ✅ Edit* | 👁️ View |
| Supplier | 👁️ View | ✅ Edit | ✅ Edit | 👁️ View |
| Quantity | 👁️ View | ✅ Edit | ✅ Edit | 👁️ View |
| Price | 👁️ View | 👁️ View | 👁️ View | 👁️ View |
| Approval Status | 👁️ View | ✅ Edit** | ❌ | 👁️ View |
| PO Number | 👁️ View | 👁️ View | 👁️ View | 👁️ View |

**Note**: * Limited to assigned station | ** Approval authority based on threshold

#### Invoices
| Field | finance-manager | finance-controller | ap-clerk |
|-------|:---------------:|:------------------:|:--------:|
| Invoice Number | 👁️ View | 👁️ View | ✅ Edit |
| Vendor | 👁️ View | 👁️ View | ✅ Edit |
| Amount | 👁️ View | 👁️ View | ✅ Edit |
| Cost Center | ✅ Edit | ✅ Edit | 👁️ View |
| GL Account | ✅ Edit | ✅ Edit | 👁️ View |
| Posting Status | ✅ Edit | ✅ Edit*** | 👁️ View |
| Payment Status | ✅ Edit | 👁️ View | 👁️ View |

**Note**: *** Finance Controller requires manager approval for posting over threshold

---

### Action-Level Security

#### Fuel Orders
| Action | fuel-planner | operations-manager | station-coordinator | finance-controller |
|--------|:------------:|:------------------:|:-------------------:|:------------------:|
| Create | ❌ | ✅ | ✅* | ❌ |
| Edit | ❌ | ✅ | ✅* | ❌ |
| Delete | ❌ | ✅** | ❌ | ❌ |
| Submit | ❌ | ✅ | ✅* | ❌ |
| Approve | ❌ | ✅** | ❌ | ❌ |
| Cancel | ❌ | ✅** | ❌ | ❌ |
| View History | 👁️ View | 👁️ View | 👁️ View | 👁️ View |

**Note**: * Station only | ** Based on approval authority threshold

#### Invoices
| Action | finance-manager | finance-controller | ap-clerk |
|--------|:---------------:|:------------------:|:--------:|
| Create | ✅ | ✅ | ✅ |
| Edit | ✅ | ✅ | ✅*** |
| Delete | ✅** | ❌ | ❌ |
| Post | ✅ | ✅**** | ❌ |
| Approve | ✅ | ❌ | ❌ |
| Release Payment | ✅ | ❌ | ❌ |
| Reverse | ✅** | ❌ | ❌ |

**Note**: ** Manager only | *** Before submission only | **** Requires approval over threshold

---

## 🔄 Approval Authorities

### Fuel Order Approval Limits

| Persona | Single Order Limit (kg) | Cumulative Daily (kg) | Special Authority |
|---------|------------------------:|----------------------:|-------------------|
| Station Coordinator | 10,000 kg | 50,000 kg | None |
| Operations Manager | 100,000 kg | 500,000 kg | Emergency orders |
| Fuel Planning Manager | Unlimited (view-only) | - | Planning approval |
| System Administrator | Unlimited | Unlimited | Override all |

### Invoice Approval Limits

| Persona | Single Invoice Limit | Cumulative Monthly | Special Authority |
|---------|---------------------:|-------------------:|-------------------|
| AP Clerk | $0 (no approval) | - | None |
| Finance Controller | $50,000 | $500,000 | 3-way match variances < 2% |
| Finance Manager | Unlimited | Unlimited | All approvals |
| System Administrator | Unlimited | Unlimited | Override all |

---

## 🌍 Station-Level Restrictions

### Station Coordinator Access

Station Coordinators are restricted to their assigned station(s) only:

| Station Code | Assigned Coordinator | Access Level |
|--------------|---------------------|--------------|
| MNL | Maria Garcia | Create/Edit/View MNL orders only |
| SIN | James Tan | Create/Edit/View SIN orders only |
| HKG | Wei Zhang | Create/Edit/View HKG orders only |
| NRT | Yuki Tanaka | Create/Edit/View NRT orders only |
| ICN | Min-jun Kim | Create/Edit/View ICN orders only |

**Data Filtering**: 
- All views automatically filtered by assigned station
- Cannot view or search other station data
- Exception queue shows assigned station exceptions only
- Work queue shows assigned station tasks only

### Operations Manager Access

Operations Managers can view and manage multiple stations based on region:

| Region | Manager | Assigned Stations |
|--------|---------|-------------------|
| Asia-Pacific | Lisa Thompson | All APAC stations |
| Europe | Thomas Mueller | All European stations |
| Americas | Carlos Rodriguez | All Americas stations |
| Middle East | Fatima Al-Rashid | All Middle East stations |

---

## 📱 Device-Specific Access

### Mobile Access

| Persona | Mobile Access | Authorized Apps |
|---------|:-------------:|-----------------|
| Station Coordinator | ✅ Full | Operations Center, Quick Request, Work Queue, Fuel Requests |
| Operations Manager | ✅ Full | All operational apps, Approvals |
| Fuel Planner | ✅ Limited | Mobile Planning, Dashboard (view-only) |
| Finance Controller | ✅ Limited | Invoice Queue, Approval (view-only) |
| Others | ❌ Desktop Only | - |

### Offline Capability

| Persona | Offline Access | Sync Required |
|---------|:--------------:|:-------------:|
| Station Coordinator | ✅ ROB entry, ePOD upload | Yes, on reconnect |
| Operations Manager | ✅ Dashboard view, Work queue | Yes, on reconnect |
| Others | ❌ Online only | N/A |

---

## 🔒 Security & Compliance

### Audit Logging

All personas have their actions logged:

| Action Type | Logged Details | Retention Period |
|-------------|----------------|------------------|
| Login/Logout | User, time, IP, device | 2 years |
| Data Access | User, record, timestamp | 1 year |
| Data Modification | User, old/new values, timestamp | 7 years |
| Approval | User, record, decision, reason | 10 years |
| Export | User, data range, timestamp | 2 years |
| Configuration Change | User, setting, old/new value | 10 years |

### Segregation of Duties (SoD)

**Incompatible Role Combinations** (system prevents):
- Finance Manager + AP Clerk (same user)
- Operations Manager + Finance Controller (same process)
- Station Coordinator + Contracts Manager (same supplier)

**Allowed Multi-Role Assignments**:
- Fuel Planner + Analyst ✅
- Operations Manager + Station Coordinator ✅ (different stations)
- Integration Admin + System Admin ✅

### Password & Session Policy

| Policy | Requirement |
|--------|-------------|
| Password Complexity | Minimum 12 characters, mixed case, numbers, special chars |
| Password Expiry | 90 days |
| Session Timeout | 30 minutes (idle), 8 hours (maximum) |
| Multi-Factor Authentication | Required for Finance Manager, Finance Controller, System Admin |
| Concurrent Sessions | Maximum 2 per user |

---

## 📋 Implementation Notes

### SAP CAP Authorization Annotations

Authorization is enforced in SAP CAP using `@restrict` annotations:

\`\`\`cds
// Example: Fuel Order entity restriction
entity FuelOrders @(restrict: [
  { grant: ['READ'], to: ['fuel-planner', 'operations-manager', 'station-coordinator', 'finance-controller', 'analyst', 'auditor', 'full-admin'] },
  { grant: ['WRITE'], to: ['operations-manager', 'station-coordinator', 'full-admin'],
    where: 'station_code = $user.station OR $user.role = "operations-manager" OR $user.role = "full-admin"' },
  { grant: ['APPROVE'], to: ['operations-manager', 'full-admin'],
    where: 'approvalAmount <= $user.approvalLimit OR $user.role = "full-admin"' }
]) {
  // ... fields
}
\`\`\`

### Fiori Launchpad Role Assignment

User-to-role assignment in Fiori Launchpad configuration:

\`\`\`json
{
  "users": [
    {
      "userId": "john.doe@airline.com",
      "roles": ["fuel-planner"],
      "station": null,
      "approvalLimits": null
    },
    {
      "userId": "maria.garcia@airline.com",
      "roles": ["station-coordinator"],
      "station": "MNL",
      "approvalLimits": { "orderKg": 10000, "dailyKg": 50000 }
    }
  ]
}
\`\`\`

---

## 🔄 Change History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 12, 2026 | System Team | Initial persona authorization matrix |

---

## 📞 Support Contacts

| Topic | Contact | Email |
|-------|---------|-------|
| Authorization Issues | IAM Team | iam.support@airline.com |
| Role Requests | HR System Admin | hr.admin@airline.com |
| Technical Support | Fuelsphere Team | fuelsphere.support@airline.com |

---

**Document Classification**: Internal Use Only  
**Next Review Date**: April 12, 2026  
**Document Owner**: Fuelsphere Product Team

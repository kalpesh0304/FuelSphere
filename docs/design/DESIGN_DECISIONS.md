# FuelSphere - Design Decisions Log

**Purpose**: This document tracks all design decisions made during the FuelSphere project. Each decision is logged with context, rationale, and impact.

**Last Updated**: January 12, 2026

---

## Decision Summary

| ID | Date | Decision | Category | Impact |
|----|------|----------|----------|--------|
| DD-001 | Jan 12, 2026 | Configurable Personas | Authorization | High |
| DD-002 | Jan 12, 2026 | Approval Limits as Setup Data | Authorization | High |
| DD-003 | Jan 12, 2026 | Cloud Foundry Runtime | Infrastructure | High |
| DD-004 | Jan 12, 2026 | Mock S/4HANA First | Integration | Medium |
| DD-005 | Jan 12, 2026 | Wait for FIGMA Before UI | Development | Medium |
| DD-006 | Jan 12, 2026 | route_master.fuel_required as Decimal | Data Model | Medium |
| DD-007 | Jan 12, 2026 | Add Thailand (TH) to Country Master | Data Model | Low |
| DD-008 | Jan 12, 2026 | Markdown-based Documentation | Documentation | Medium |

---

## Detailed Decisions

### DD-001: Configurable Personas

**Date**: January 12, 2026
**Decided By**: Kalpesh Chavda (Functional Architect)
**Category**: Authorization

**Context**:
FuelSphere defines 11 personas (fuel-planner, contracts-manager, finance-manager, etc.) with specific application tile access. The question was whether these should be hardcoded or configurable.

**Decision**:
Personas and their tile assignments are **configurable**, not hardcoded:
- Personas are delivered as **recommended seed data**
- Tile assignments are **customizable** via Administration menu
- User-Persona mapping is managed by customer administrators

**Rationale**:
- FuelSphere is being built as a **product**, not a single-client solution
- Different customers may have different organizational structures
- Flexibility allows customers to adapt without code changes

**Impact**:
- Add `CONFIG_PERSONAS` entity (seed data)
- Add `CONFIG_TILES` entity (seed data)
- Add `CONFIG_PERSONA_TILES` entity (customizable mapping)
- Add `CONFIG_USER_PERSONAS` entity (user assignments)
- Add Administration screens for configuration

**Related Documents**:
- OVERALL_HLD.md (Section 5.2)
- PERSONA_AUTHORIZATION_MATRIX.md

---

### DD-002: Approval Limits as Setup Data

**Date**: January 12, 2026
**Decided By**: Kalpesh Chavda (Functional Architect)
**Category**: Authorization

**Context**:
The Persona Authorization Matrix defines approval limits (e.g., Station Coordinator: 10,000 kg single order, Finance Controller: $50,000 invoice). The question was whether these should be hardcoded per role or configurable.

**Decision**:
Approval limits are **setup data** configured at deployment, changeable by business users.

**Default Values**:
| Persona | Fuel Order (kg) | Daily (kg) | Invoice ($) | Monthly ($) |
|---------|-----------------|------------|-------------|-------------|
| station-coordinator | 10,000 | 50,000 | - | - |
| operations-manager | 100,000 | 500,000 | - | - |
| finance-controller | - | - | 50,000 | 500,000 |
| finance-manager | Unlimited | Unlimited | Unlimited | Unlimited |

**Rationale**:
- Different airlines have different approval thresholds
- Business requirements may change over time
- Reduces need for code changes

**Impact**:
- Add `CONFIG_APPROVAL_LIMITS` entity
- Add Administration screen for limit configuration
- Implement approval limit checks in service layer

**Related Documents**:
- OVERALL_HLD.md (Section 5.3)
- PERSONA_AUTHORIZATION_MATRIX.md

---

### DD-003: Cloud Foundry Runtime

**Date**: January 12, 2026
**Decided By**: Kalpesh Chavda (Functional Architect)
**Category**: Infrastructure

**Context**:
SAP BTP offers two runtime environments: Cloud Foundry and Kyma (Kubernetes).

**Decision**:
Use **Cloud Foundry** runtime for FuelSphere deployment.

**Rationale**:
- Standard approach for CAP-based applications
- Simpler deployment model
- Well-documented and widely used
- Kyma adds unnecessary complexity for this use case

**Impact**:
- MTA deployment descriptor for Cloud Foundry
- CF-specific services (XSUAA, HANA Cloud, etc.)
- No Kubernetes/Helm charts needed

---

### DD-004: Mock S/4HANA First

**Date**: January 12, 2026
**Decided By**: Kalpesh Chavda (Functional Architect)
**Category**: Integration

**Context**:
S/4HANA integration is critical but complex. Options were to integrate from Day 1 or use mocks/stubs initially.

**Decision**:
Use **mock/stub services** first, real S/4HANA integration later.

**Rationale**:
- Faster initial development progress
- Reduces dependencies on S/4HANA availability
- Allows parallel development of integration layer
- Can validate business logic independently

**Impact**:
- Create mock service implementations
- Define clear integration interfaces
- Plan integration phase separately
- S/4HANA connection required before go-live testing

---

### DD-005: Wait for FIGMA Before UI

**Date**: January 12, 2026
**Decided By**: Kalpesh Chavda (Functional Architect)
**Category**: Development

**Context**:
UI development could start with standard Fiori Elements or wait for FIGMA exports.

**Decision**:
**Wait for FIGMA exports** before building UI components.

**Rationale**:
- Ensures UI matches approved designs exactly
- Reduces rework from design mismatches
- FIGMA JSON specs provide detailed component specifications

**Impact**:
- Backend development proceeds first
- UI development starts after FIGMA review
- 12 FIGMA JSON specs received for Master Data module

---

### DD-006: route_master.fuel_required as Decimal

**Date**: January 12, 2026
**Decided By**: Kalpesh Chavda (Functional Architect)
**Category**: Data Model

**Context**:
Sample data in Excel showed `fuel_required` as Boolean (True/False), but HLD specified Decimal.

**Decision**:
`fuel_required` field is **Decimal** representing fuel quantity in **kilograms (kg)**.

**Rationale**:
- Aligns with HLD specification
- Provides actual fuel requirement values for planning
- Boolean would not provide meaningful planning data

**Impact**:
- Sample data needs correction
- Entity definition confirmed as Decimal(15,2)
- Documentation updated

**Related Documents**:
- MASTER_DATA_HLD.md (Section 3.2 - ROUTE_MASTER)

---

### DD-007: Add Thailand (TH) to Country Master

**Date**: January 12, 2026
**Decided By**: Kalpesh Chavda (Functional Architect)
**Category**: Data Model

**Context**:
Data validation found that BKK airport references country "TH" (Thailand), but TH was not in the t005_country sample data.

**Decision**:
**Add Thailand (TH)** to the country master seed data.

**Details**:
```
land1: TH
landx: Thailand
landx50: Kingdom of Thailand
natio: THA
landgr: SEA
currcode: THB
spras: E
isActive: true
```

**Impact**:
- Add TH record to seed data
- Add THB to currency_master
- Foreign key validation passes

---

### DD-008: Markdown-based Documentation

**Date**: January 12, 2026
**Decided By**: Kalpesh Chavda (Functional Architect)
**Category**: Documentation

**Context**:
HLD documents were in .docx format. Question was how to keep documentation in sync with design decisions.

**Decision**:
Convert key documents to **Markdown format** for easier maintenance.

**Folder Structure**:
```
/docs/
├── design/           ← Markdown design docs
│   ├── OVERALL_HLD.md
│   ├── MASTER_DATA_HLD.md
│   ├── DESIGN_DECISIONS.md
│   └── ...
├── figma/            ← FIGMA JSON exports
├── data/             ← Sample data (Excel)
└── original/         ← Original .docx files
```

**Rationale**:
- Technical Architect (Claude) can easily update Markdown
- Version controlled with git
- Renders nicely on GitHub
- Can export to Word/PDF when needed

**Impact**:
- Converted OVERALL_HLD and MASTER_DATA_HLD to Markdown
- Created DESIGN_DECISIONS.md (this document)
- Original .docx files archived

---

## Template for New Decisions

```markdown
### DD-XXX: [Decision Title]

**Date**: [Date]
**Decided By**: [Name] ([Role])
**Category**: [Authorization | Data Model | Integration | Infrastructure | Development | Documentation]

**Context**:
[What was the question or problem?]

**Decision**:
[What was decided?]

**Rationale**:
[Why was this decision made?]

**Impact**:
[What changes are needed as a result?]

**Related Documents**:
[List related documents]
```

---

*Last Updated: January 12, 2026*
*Maintained by: Claude (Technical Architect)*

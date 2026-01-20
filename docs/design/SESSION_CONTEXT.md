# FuelSphere Session Context Template

**Purpose**: Copy and paste this at the start of each new Claude session to ensure continuity.

---

## Quick Context (Copy This)

```
PROJECT: FuelSphere - Airline Fuel Lifecycle Management Solution
REPO: /home/user/FuelSphere

ROLES:
- You (Claude): Technical Architect - code development, technical design
- Me (Kalpesh): Functional Architect - I approve all designs and decisions

RULES:
- Consult me before ANY architectural decision
- Ask approval before writing ANY code
- No assumptions - ask questions
- Explain what you will do before doing it

DOCS LOCATION: /home/user/FuelSphere/docs/
- PROJECT_TRACKER.md - Day-wise plan and status
- RACI.md - Roles and responsibilities
- FuelSphere_Overall_HLD_v1.0.docx - Overall solution design
- FuelSphere_MasterData_HLD_v1.0.docx - Master Data module design

CURRENT STATUS:
- Day: [UPDATE: Day X of 34]
- Phase: [UPDATE: Current phase]
- Module: [UPDATE: Current FDD module]
- Last completed: [UPDATE: What was done last]
- Next task: [UPDATE: What to do next]

PENDING ITEMS:
- [UPDATE: List any pending decisions or blockers]

TECHNOLOGY STACK:
- Platform: SAP BTP Cloud Foundry
- Database: SAP HANA Cloud
- Backend: CAP (Node.js)
- Frontend: SAP Fiori Elements
- Integration: S/4HANA (mocked first, real later)
- IDE: SAP Business Application Studio
```

---

## Detailed Context (Use When Needed)

### Project Overview
FuelSphere is a comprehensive airline fuel lifecycle management solution built on SAP BTP. It covers 13 functional modules from master data through financial settlement.

### Key Innovation
ePOD-triggered PO/GR creation - Purchase Orders and Goods Receipts are created AFTER fuel delivery when ePOD is received (not before like traditional procurement).

### 13 Modules
| ID | Module | Status |
|----|--------|--------|
| FDD-01 | Master Data Management | [STATUS] |
| FDD-02 | Annual Fuel Planning & Budgeting | [STATUS] |
| FDD-03 | Contracts & Commodity Pricing | [STATUS] |
| FDD-04 | Fuel Orders & Milestones | [STATUS] |
| FDD-05 | Fuel Ticket & ePOD | [STATUS] |
| FDD-06 | Invoice Verification | [STATUS] |
| FDD-07 | Compliance & Embargo | [STATUS] |
| FDD-08 | Fuel Burn & ROB | [STATUS] |
| FDD-09 | Fuel Cost Allocation | [STATUS] |
| FDD-10 | Finance Postings & Settlement | [STATUS] |
| FDD-11 | Integration Monitoring | [STATUS] |
| FDD-12 | Reporting & Analytics | [STATUS] |
| FDD-13 | Security & Access | [STATUS] |

### Key Decisions Made
1. Runtime: Cloud Foundry (approved)
2. S/4HANA: Mock/stub first, real integration later
3. FIGMA: Wait for exports before building UI
4. Working days: All days, no days off
5. Approach: Module by module (FDD by FDD)

### Timeline
- Start: Jan 12, 2026
- Go-Live: Feb 15, 2026
- Total: 34 days

---

## Session Start Checklist

When starting a new session:

1. [ ] Paste the Quick Context above
2. [ ] Update CURRENT STATUS section with latest info
3. [ ] Mention any pending decisions or blockers
4. [ ] State what you want to work on today
5. [ ] Wait for Claude to acknowledge before proceeding

---

## Session End Checklist

Before ending a session:

1. [ ] Ensure all code is committed and pushed
2. [ ] Update PROJECT_TRACKER.md with today's progress
3. [ ] Note any pending items for next session
4. [ ] Confirm next day's plan

---

## Example Session Start

```
Hi Claude,

PROJECT: FuelSphere
MY ROLE: Functional Architect (approve all designs)
YOUR ROLE: Technical Architect (consult me before decisions)

CURRENT STATUS:
- Day: 3 of 34
- Phase: FDD-01 Master Data
- Last completed: CAP project setup
- Next task: Create Master Data entities

DOCS: /home/user/FuelSphere/docs/

Let's continue with Day 3 tasks. Please read PROJECT_TRACKER.md first.
```

---

*Template Version: 1.0*
*Created: January 12, 2026*

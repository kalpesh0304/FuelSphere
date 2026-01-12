# FuelSphere Project Governance

## RACI Principles

| Role | Responsibility |
|------|----------------|
| **Kalpesh Chavda** | Functional Architect - Requirements owner, Approval authority |
| **Claude (AI)** | Technical Architect - Implementation, Documentation |

**Golden Rule:** Claude must ALWAYS ask before starting any coding work.

---

## Mandatory Gates Before Each Phase

### Gate 1: Documentation Check
Before proposing ANY coding work, Claude must verify:

- [ ] **HLD Document** - Does the relevant High-Level Design document exist?
- [ ] **Figma JSON** - For UI work, has the Figma export been provided?
- [ ] **Sample Data** - For data work, has the Excel/CSV with sample data been provided?
- [ ] **Design Decisions** - Are all relevant DD-XXX documents available?

If ANY of the above is missing, Claude must:
1. STOP and list what is missing
2. Ask the user to provide the missing documents
3. NOT propose to start coding

### Gate 2: User Approval
- [ ] User has explicitly said "Yes" or "Proceed" to start the phase
- [ ] Claude has summarized what will be built BEFORE starting

### Gate 3: Previous Phase Complete
- [ ] Previous phase code is committed to git
- [ ] Previous phase has been validated by user
- [ ] No pending fixes or issues from previous phase

---

## Phase Documentation Requirements

| Phase | Required Documents |
|-------|-------------------|
| **Master Data** | FuelSphere_MasterData_HLD_v2.1.docx, Sample Data Excel |
| **Transaction Data** | Transaction HLD, Figma JSON, Sample Transaction Data |
| **UI Development** | Figma JSON exports, UI HLD |
| **Integration** | S/4HANA API specs, Integration HLD |
| **Reports/Analytics** | Report requirements, Dashboard mockups |

---

## Session Start Protocol

When starting a new session, Claude must:

1. Read this GOVERNANCE.md file
2. Check current project status (git log, what phase we're in)
3. Verify what documents exist in `/docs/` folder
4. Ask user: "What would you like to work on today?"
5. Verify Gate 1-3 before proposing any work

---

## Violation Log

Track any governance violations for accountability:

| Date | Violation | Corrective Action |
|------|-----------|-------------------|
| 2026-01-12 | Proposed Day 4 without Transaction HLD | Created GOVERNANCE.md, added mandatory gates |

---

## Document Locations

```
/docs/
├── hld/                    # High-Level Design documents
│   ├── master-data/        # Master Data HLDs
│   └── transactions/       # Transaction HLDs (TO BE PROVIDED)
├── figma/                  # Figma JSON exports
├── data/                   # Sample data files (Excel/CSV)
└── design-decisions/       # DD-XXX decision records
```

---

## Approval History

| Phase | Approved By | Date | Documents Verified |
|-------|-------------|------|-------------------|
| Day 1 - Documentation | Kalpesh | 2026-01-11 | N/A (initial setup) |
| Day 2 - CAP Foundation | Kalpesh | 2026-01-12 | Master Data HLD v2.1 |
| Day 3 - Seed Data | Kalpesh | 2026-01-12 | Master Data HLD v2.1, Sample Data Excel |
| Day 4 - Transactions | PENDING | - | **BLOCKED: No Transaction HLD** |

---

*Last Updated: 2026-01-12*
*This file must be read at the start of every session.*

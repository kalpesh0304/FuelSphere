# FuelSphere — As-Built Baseline (Reconciliation)

Independent documentation of the FuelSphere backend **as implemented in code**, to be reconciled against an independent design. Accuracy over completeness; every claim carries a source (`file:line`, table, or transaction). Where code and docs conflict, both are reported and the conflict flagged. Production-looking data is anonymised (VENDOR_A, TAIL_01) with structure preserved.

| File | Scope |
|---|---|
| [SCHEMA.md](SCHEMA.md) | Data model — 97 CDS entities (full field tables), enums, ERDs, look-alike-but-unlinked tables, projections, versioning strategy |
| [UI_INVENTORY.md](UI_INVENTORY.md) | 5 freestyle apps (not Fiori Elements), routes/auth, actions, navigation, unreachable screens, OData actions with no UI |
| [FUNCTIONAL.md](FUNCTIONAL.md) | Behaviour as built — inbound/outbound, order/ticket/delivery, burn/ROB, invoice, S/4 integration, master data, authorisation |
| [CONFIG.md](CONFIG.md) | Config tables, hardcoded values (file:line), number ranges, effective-dating |
| [DATA_PROFILE.md](DATA_PROFILE.md) | Seed-CSV profile — row counts, status distributions, null FKs, undocumented values, rule violations |
| [FINDINGS.md](FINDINGS.md) | Analysis + explicit YES/NO/PARTIAL answers to the 20 decision-point questions |

## Headline findings (detail in FINDINGS.md)

1. **9 of 15 services have no implementation** (Invoice, Pricing, Compliance, Allocation, Analytics, Security, Integration, Contracts, Admin) — declarations only.
2. **RBAC is effectively open** — every `@restrict` grant includes pseudo-role `'any'` (93×); no row-level security; no SoD enforced.
3. **Two parallel pricing entity families** coexist (singular vs plural), used by different services.
4. **No staging layer** on any inbound feed; **no optimistic locking** anywhere.
5. **Order status uses `'Created'`** (not in the enum); never reaches `'Completed'`.
6. **S/4 "posting" is simulated** (random PO/GR numbers); invoice/allocation posting unimplemented.
7. **Density captured but unused**; ACARS variance is dead code; ROB confirm-path clamps negatives.

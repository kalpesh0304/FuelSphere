# CONFIG.md — What Is Configurable

> **Central paradox (Q5):** The system ships **populated configuration tables** for tolerances, SoD, allocation and pricing — but the services that would *read* them are **unimplemented** (invoice, pricing, allocation, security, compliance have no JS). Conversely, the tolerances that are **actually enforced** at runtime (fuel-burn variance, order/delivery variance, temperature correction) are **hardcoded in JS**, not read from any config table. So: *configurable by design, hardcoded in practice.*

## 1. Configuration tables (seeded)

| Table | Purpose | Key | Sample entries (anonymised) | Consumed by |
|---|---|---|---|---|
| `TOLERANCE_RULES` | Invoice match tolerances | `ID` / `rule_code` | `TOL-PRICE-STD` PRICE ±2.0000% `block_on_exceed=true` `require_dual_approval=true`; `TOL-QTY-STD` QUANTITY ±5.0000% | **Nothing** — InvoiceService has no JS |
| `SOD_RULES` | Segregation-of-duties rules | `rule_id` | `SOD-RULE-001` InvoiceCreate vs InvoiceApprove (CRITICAL, `sox_control_id=SOX-SEC-003`, `max_exception_days=180`); `SOD-RULE-002` FuelOrderCreate vs Approve (HIGH) | **Nothing** — SecurityService has no JS |
| `ALLOCATION_RULES` | Cost allocation basis/receivers | `rule_code` | `ALLOC-PH-STD` basis=AMOUNT receiver=COST_CENTER cc=`CC-FUEL-PH` gl=`400100`; `ALLOC-SG-STD` cc=`CC-FUEL-SG` | **Nothing** — AllocationService has no JS |
| `COST_CENTER_MAPPING` | Airport→cost/profit center | `ID` | MNL→`CC-MNL-OPS`/`PC-PH-DOM`; CEB→`CC-CEB-OPS` | **Nothing** (allocation unimpl.) |
| `PRICING_CONFIG` (singular) | Engine mode per company | `config_code` | `DEFAULT` NATIVE `variance_threshold=5.00` `cpe_cache_ttl_mins=30`; `PAL_HYBRID` HYBRID 3.00 / 15 | Referenced by Planning projection; no derivation JS |
| `PRICING_CONFIGURATIONS` (plural) | FDD-10 engine config | `company_code` | `1000` HYBRID `variance_threshold_pct=2.50` `derivation_schedule=0 6 * * *`; `2000` NATIVE 5.00 | **Nothing** — PricingService has no JS |
| `INTEGRATION_CONFIGS` | Integration parameters | `config_key` | `s4.api.timeout.ms=30000` (min 1000/max 120000); `s4.api.retry.max=3` (min1/max10) | **Nothing** — IntegrationService has no JS; sync uses hardcoded values instead |
| `CONFIG_APPROVAL_LIMITS` | Approval thresholds per persona | `ID` | limit_type FUEL_ORDER_KG / INVOICE_USD (schema `db/schema.cds:522`) | Not read by any handler |
| `CONFIG_PERSONAS` / `CONFIG_TILES` / `CONFIG_PERSONA_TILES` | Launchpad persona→tile mapping | `persona_id` / `tile_id` | `fuel-planner`, `station-coordinator`; tiles `fuel-order-overview`→`#FuelOrders-manage` | Freestyle apps do not read these (static HTML) |
| `ALERT_DEFINITIONS` | Alert thresholds | `ID` | 5 rows | IntegrationService (unimpl.) |

**Effective-dating:** `TOLERANCE_RULES`, `ALLOCATION_RULES`, `COST_CENTER_MAPPING`, `PRICING_CONFIG`, `CONTRACT_LOCATIONS`, pricing formulas all carry `valid_from`/`valid_to` (or `effective_from`/`effective_to`) + `priority`. **However, no handler performs date-effective resolution** (no code selects the row where `valid_from ≤ date ≤ valid_to` ordered by priority). So historical resolution is *modelled but not implemented* — the columns exist, the resolution logic does not.

## 2. Hardcoded business values (enforced at runtime)

All values below are **in JS handler code**, not config tables. This is the authoritative "magic numbers" list for reconciliation.

### 2.1 Orders / delivery / ePOD — `srv/order-service.js`

| Value | Meaning | Line |
|---|---|---|
| `100000` | Large-order quantity guard (blocks) | 79 |
| `> 5` / `> 2` | Variance % criticality (red/yellow) | 63, 64 |
| `> 5` (abs) | Delivery variance flag (captureSignatures, verifyQuantity) | 316, 374 |
| `1.05` | Delivered ≤ ordered +5% | 460 |
| `-40` / `50` | Temperature valid range °C | 466 |
| `0.775` / `0.840` | Density valid range kg/L | 475 |
| `0.00099` | Thermal expansion coefficient α | 423 |
| `15.0` | Reference temperature °C | 424 |
| `4500001000 + rand*9000` | Simulated S/4 PO number | 305 |
| `5000001000 + rand*9000` | Simulated S/4 GR number | 306 |
| `'00010'` / `'0001'` | Hardcoded PO/GR line item | 340, 328 |
| `'KG'` / `'USD'` / `'Normal'` | Default UoM / currency / priority | 266, 270, 272 |
| `['TRIPRECORD','MANUAL','SMARTDOC']` | Valid dispatch sources | 765 |
| `'XXX'` | Fallback station code in number gen | 90, 540, 556 |
| `3` | Sequence zero-pad width (`padStart(3,'0')`) | 100 |

### 2.2 Fuel burn / ROB — `srv/burn-service.js`

| Value | Meaning | Line |
|---|---|---|
| `5` / `10` / `20` | Variance status ladder NORMAL/WARNING/EXCEPTION/CRITICAL (abs %) | 89-91 (dup 320-323, 750-752) |
| `EXCEPTION`\|`CRITICAL` | Sets `requiresReview` (>10%) | 94 |
| `Math.max(0, …)` | ROB negative-clamp on burn confirm | 1145 |
| `20` / `30` | Fleet ROB% status LOW_FUEL / NEEDS_ATTENTION / OK | 611 |
| `1440` | minutes/day next-day rollover | 767 |
| `60000` | ms→min (EFB duration) | 394 |
| `['ACARS','EFB','MANUAL','JEFFERSON']` | Valid data sources | 729 |
| `0` (planned) | ACARS `plannedBurnKg` hardcoded — **variance dead code** | 304 |
| `.toFixed(2)` | Rounding, all pct/qty | 85, 318, 453, 567, 748, 935, 1098 |

### 2.3 Planning / S4 sync — `srv/planning-service.js`, `srv/config/s4-sync-config.js`, `srv/master-data-service.js`

| Value | Meaning | Location |
|---|---|---|
| `'KG'` / `0` / `'Normal'` / `'Draft'` | Auto-created order defaults | planning-service.js:324-329, 597-601 |
| `'SCHEDULED'` | Default flight status | planning-service.js:299 |
| `['J','F','C','G','M','P']` | Valid service-type codes | planning-service.js:242 |
| `86400` | Seconds/day (Excel time fraction) | planning-service.js:139 |
| `'EXTERNAL'` / `'LOW'` / `false` / `true` | Hardcoded supplier_type / country risk_level / embargo / active on sync map | s4-sync-config.js:97, 47, 44, 49 |
| `'2'` / `'EN'` | BP category filter / country language filter | s4-sync-config.js:91, 31 |
| `200` | INSERT chunk size (full-replace load) | master-data-service.js:194 |
| `'S2A'` / `'odata_api'` | Hardcoded destination / required-service | master-data-service.js:106; package.json |

### 2.4 Schema defaults (declared)

| Value | Meaning | Line |
|---|---|---|
| `5.00` | `PRICING_CONFIG.variance_threshold` default | db/schema.cds:293 |
| `30` | `cpe_cache_ttl_mins` default | db/schema.cds:294 |
| `60000` | S2A destination timeout ms (hybrid) | package.json `[hybrid].S2A.options.timeout` |
| `60` | app-router `sessionTimeout` (min) | app/xs-app.json |

## 3. Number ranges & key generation

All client-side **`max + 1`** generators (SELECT last matching row, split on `-`, increment, `padStart(3,'0')`). **No DB sequence, no locking → race-condition prone.**

| Number | Format | Generator |
|---|---|---|
| Order number | `FO-{station}-{YYYYMMDD}-{NNN}` | order-service.js:87-102, 537-551; planning-service.js:111, 586 |
| Delivery number | `EPD-{station}-{YYYYMMDD}-{NNN}` | order-service.js:553-567; refueler-service.js:131-142 |
| Ticket internal number | `FT-{station}-{YYYYMMDD}-{NNN}` | ticket-service.js:43-68, 142-156 |
| Sales order number | `SO-{station}-{YYYYMMDD}-{SEQ}` (doc) | **NOT generated in JS** — must be supplied externally |
| S/4 PO / GR number | random 10-digit simulation | order-service.js:305-306 |
| Planning version id | `PV-{TYPE}-{FY}-{SEQ}` (doc) | **NOT generated** (`generateVersionId` unimplemented) |
| SAC export id | `EXP-SAC-{DATE}-{SEQ}` (doc) | **NOT generated** |

## 4. Config that looks maintainable but isn't wired

- `INTEGRATION_CONFIGS.s4.api.timeout.ms` (30000, maintainable with min/max) vs the **actual** timeout `60000` hardcoded in `package.json` `[hybrid].S2A.options.timeout` — the config value is not consulted.
- `INTEGRATION_CONFIGS.s4.api.retry.max=3` — no retry loop exists in `master-data-service.js`.
- `PRICING_CONFIGURATIONS.derivation_schedule=0 6 * * *` — implies a scheduled derivation job; **no scheduler exists** in the codebase.
- `PRICING_CONFIG.cpe_endpoint_url` / `cpe_cache_ttl_mins` — no CPE adapter code exists to use them.

## Unanswered / needs access

| Item | Why | Access needed |
|---|---|---|
| Whether `CONFIG_APPROVAL_LIMITS` is enforced anywhere | Not read by any handler found; may be intended for unbuilt approval engine | Product owner / future code |
| Who maintains each config table in production | No admin UI for most tables (freestyle apps don't expose them) | Ops/runbook docs |
| Real effective-dated resolution | Columns exist; logic absent | Implementation or design intent |

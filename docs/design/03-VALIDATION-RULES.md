# 03-VALIDATION-RULES.md

**FuelSphere — validation rules with error codes**
195 rules, every one carrying a code from the project taxonomy.

---

## How to read this

The design workbook catalogued 195 validation rules and gave none of them an identifier. The build has a coherent error code taxonomy and uses it. This document joins the two.

| Column | Meaning |
|---|---|
| **Code** | The error code to raise. Assign this in the handler |
| **Was** | The rule's identifier in the design workbook, for tracing back |
| **Applies to** | The entity **in this repository's names**. `—` means the entity does not exist yet |
| **Rule** | The assertion, as written in the design |
| **Severity** | Error blocks; Warning records and continues |

**A rule without a code is not implemented.** That is the point of this document.

---

## Numbering

Per `05-CONVENTIONS.md`:

- `4xx` — business rule violation · `5xx` — technical failure
- **Existing codes keep their numbers.** `FB401-405`, `FB500`, `EPD401-404`, `EPD410-411`, `IMP401-404`, `ENR401-402`, `DSP401-402`, `DSP500`, and the designed `INT401-404`, `INV401-410`, `PLN401-405/410-411/420-422` are all reserved
- **New codes in an existing prefix start at `x450`**, so nothing collides with what is already in use or documented
- **New prefixes start at `x401`**

### Prefixes

| Prefix | Domain | Status |
|---|---|---|
| `FB` | Fuel burn and ROB | Implemented |
| `EPD` | ePOD, delivery, order, ticket | Implemented |
| `IMP` | Flight schedule import | Implemented |
| `ENR` | Flight schedule enrichment | Implemented |
| `DSP` | Flight dispatch import | Implemented |
| `INT` | S/4 integration | Documented, unimplemented |
| `INV` | Invoice verification | Documented, unimplemented |
| `PLN` | Planning and SAC | Documented, unimplemented |
| **`LDG`** | **Fuel ledger** | **New** |
| **`MDM`** | **Master data lifecycle** | **New** |
| **`CFG`** | **Configuration resolution** | **New** |
| **`STG`** | **Inbound staging** | **New** |
| **`APU`** | **APU usage** | **New** |
| **`CMP`** | **Completeness and stock reconciliation** | **New** |
| **`CLM`** | **Claim windows** | **New** |
| **`POS`** | **Posting determination** | **New** |
| **`CAR`** | **Carrier arrangement** | **New** |
| **`PRC`** | **Pricing** | **New** |

Ten new prefixes. Add each to `CLAUDE.md` section 8 in the commit that first uses it.

---

## What is implementable now

| | Rules |
|---|---|
| Against entities that exist in the build today | **~94** |
| Against entities that do not exist yet | **~101** |

The second group is not backlog — each rule arrives with the package that creates its entity. `STG` has 26 rules and no entities; those land with WP-15. `POS` has 17 and lands with WP-23.

**Do not implement a rule whose entity does not exist.** Do not create the entity to satisfy the rule. The entity arrives with its own package, specified in `01-TARGET-SCHEMA.md` or later.

---

## Three rules that are not really validations

Three deserve flagging because implementing them as a field check would be wrong.

**`FB402` — negative closing ROB.** Already implemented under WP-03. Not a field assertion but a chain outcome: the row is withheld, the error carries the computed value and all four inputs, and subsequent entries for that tail continue. Decision B8.

**`CMP` completeness rules.** These test the *absence* of a record against an expectation derived from the plan. A leg with no ticket is only a gap where `required_uplift > 0`. Implementing them as not-null checks would flag every legitimately fuel-free leg.

**`CLM` claim windows.** These measure time remaining against a contractual deadline, not elapsed time since creation. The queue sorts by least time remaining and escalates before expiry, not after. A conventional ageing implementation inverts the priority.

---

## The rules


### EPD4xx — ePOD, order, ticket, delivery

26 rules · 26 against entities that exist today · package: WP-10, WP-11, WP-12, WP-17

| Code | Was | Applies to | Rule | Severity |
|---|---|---|---|---|
| `EPD450` | VR06 | `FUEL_ORDERS` | delivered_qty is derived by summing linked tickets, never stored as a scalar | Error |
| `EPD451` | VR07 | `FUEL_ORDERS` | order_status = PART_FULFILLED requires a populated under_delivery_reason | Error |
| `EPD452` | VR08 | `FUEL_ORDERS` | A negative ordered_qty is valid and denotes a DEFUEL instruction | Warning |
| `EPD453` | VR09 | `FUEL_TICKETS` | quantity_kg = quantity_metered x density_value, rounded at display only. **Derives only where uom_code is a volume unit whose conversion is established** — returns null for gallons pending F19 | Error |
| `EPD454` | VR10 | `FUEL_TICKETS` | fuel_order_id and fd_fuel_plan_id may be NULL; ticket must still be accepted at ingestion | Error |
| `EPD455` | VR11 | `FUEL_TICKETS` | A ticket links to the plan version it executed against, not the latest ACTIVE version | Error |
| `EPD456` | VR12 | `FUEL_TICKETS` | Multiple tickets may reference one fuel_order_id, distinguished by uplift_sequence | Error |
| `EPD457` | VR13 | `FUEL_TICKETS` | recon_variance_kg beyond +/- 2 percent of quantity_kg raises an exception for review | Warning |
| `EPD458` | VR14 | `FUEL_TICKETS` | event_type JETTISON permits null meter, litres and density; quantity taken from FQIS | Error |
| `EPD459` | VR15 | `FUEL_TICKETS` | station on the ticket may differ from the leg departure_station | Warning |
| `EPD460` | VR16 | `FUEL_TICKETS` | cost_allocation_basis must be populated when flight_status is CANCELLED or the ticket is unmatched | Error |
| `EPD461` | VR21 | `FUEL_DELIVERIES` | recon_variance_kg = quantity_kg (meter x density) minus fob_delta_kg (FQIS) | Error |
| `EPD462` | VR22 | `FUEL_DELIVERIES` | Tolerance is the greater of 2 percent of metered mass or a 50 kg absolute floor | Error |
| `EPD463` | VR23 | `FUEL_DELIVERIES` | Status FAIL blocks automatic invoice approval and raises an exception task | Error |
| `EPD464` | VR24 | `FUEL_DELIVERIES` | Missing FQIS readings yield NOT_RECONCILED, excluded from variance statistics | Error |
| `EPD465` | VR25 | `FUEL_DELIVERIES` | Consistent one directional variance across a bowser flags meter calibration, even when each ticket passes | Warning |
| `EPD466` | VR26 | `FUEL_DELIVERIES` | Plan fuel_on_board is compared against actual fob_before at fuelling start; breach raises a pre departure alert | Error |
| `EPD467` | VR32 | `FUEL_TICKETS` | ticket_source and raw_payload_ref are mandatory so any field value can be traced to its origin | Error |
| `EPD468` | VR37 | `FUEL_ORDERS` | variance_qty = sum of linked ticket quantities minus ordered_qty, evaluated at order level | Error |
| `EPD469` | VR38 | `FUEL_ORDERS` | Order fulfilment tolerance is the greater of 1 percent of ordered quantity or 50 kg | Error |
| `EPD470` | VR39 | `FUEL_ORDERS` | fulfilment_check must distinguish UNDER_DELIVERED from OVER_DELIVERED; sign is never assumed | Error |
| `EPD471` | VR40 | `FUEL_ORDERS` | A SUPERSEDED order is NOT_APPLICABLE, never reported as under-delivered | Error |
| `EPD472` | VR41 | `FUEL_ORDERS` | Order fulfilment and ticket FOB reconciliation are independent checks; passing one does not clear the other | Warning |
| `EPD473` | VR88 | `FUEL_TICKETS` | A ticket for a leg in NONE mode is accepted with match_status NOT_EXPECTED, never rejected | Error |
| `EPD474` | VR97 | `FUEL_TICKETS` | Where the active plan version at uplift time was never received, version_coverage is GAPPED and the ticket does not bind to an earlier version | Error |
| `EPD475` | VR188 | `FUEL_TICKETS` | A reconciliation exception is never suppressed because an ePOD signature exists | Error |

### ENR4xx — Flight schedule enrichment

14 rules · 14 against entities that exist today · package: WP-09, WP-15

| Code | Was | Applies to | Rule | Severity |
|---|---|---|---|---|
| `ENR450` | VR17 | `FLIGHT_SCHEDULE` | Unique key holds when one flight number departs the same station twice on one date | Error |
| `ENR451` | VR18 | `FLIGHT_SCHEDULE` | flight_status and ops_phase are independent; freeze logic keys off ops_phase | Error |
| `ENR452` | VR19 | `FLIGHT_SCHEDULE` | A tail swap changes actual_registration only; flight_leg_id is immutable | Error |
| `ENR453` | VR20 | `FLIGHT_SCHEDULE` | return_type must be RAMP or AIR when flight_status indicates a return | Error |
| `ENR454` | VR57 | `FLIGHT_SCHEDULE` | sync_status is unchanged by an IGNORED_NO_CHANGE record; only last_source_confirmed_utc advances | Error |
| `ENR455` | VR58 | `FLIGHT_SCHEDULE` | A leg with sync_status PENDING_UPDATE on a critical field must surface that state on every screen that reads it | Error |
| `ENR456` | VR124 | `FLIGHT_SCHEDULE` | All four OOOI times are requested separately; out and in alone give block burn but no trip or taxi split | Error |
| `ENR457` | VR125 | `FLIGHT_SCHEDULE` | Block, flight and taxi minutes are derived from OOOI timestamps, never keyed | Error |
| `ENR458` | VR126 | `FLIGHT_SCHEDULE` | Timestamps crossing midnight roll to the following day; derived durations are never negative | Error |
| `ENR459` | VR127 | `FLIGHT_SCHEDULE` | delay_minutes is derived from out_utc minus std_utc; a keyed value is overwritten | Error |
| `ENR460` | VR128 | `FLIGHT_SCHEDULE` | dep_stand_type and arr_stand_type feed APU avoidability; where absent, gpu_source falls back below STAND_TYPE | Error |
| `ENR461` | VR129 | `FLIGHT_SCHEDULE` | Actual ZFW, TOW and payload are held so burn variance can be attributed to weight rather than to inefficiency | Warning |
| `ENR462` | VR130 | `FLIGHT_SCHEDULE` | Planned and flown cruise level are both held; level deviation is a primary cause of burn variance | Warning |
| `ENR463` | VR131 | `FLIGHT_SCHEDULE` | codeshare_numbers is informational only; carrier arrangement resolves on operating and marketing carrier, never on the codeshare list | Error |

### DSP4xx — Flight dispatch

8 rules · 8 against entities that exist today · package: WP-18

| Code | Was | Applies to | Rule | Severity |
|---|---|---|---|---|
| `DSP450` | VR01 | `FLIGHT_DISPATCH` | block_fuel = trip + contingency + alternate + final_reserve + additional + taxi + extra | Error |
| `DSP451` | VR02 | `FLIGHT_DISPATCH` | required_uplift = block_fuel - fuel_on_board, where fuel_on_board includes any fuel already delivered | Error |
| `DSP452` | VR03 | `FLIGHT_DISPATCH` | Exactly one row per plan_group_id may have plan_status = ACTIVE | Error |
| `DSP453` | VR04 | `FLIGHT_DISPATCH` | A superseded version is never updated in place; a new row is inserted | Error |
| `DSP454` | VR05 | `FLIGHT_DISPATCH` | extra_fuel and additional_fuel are distinct fields and must not be merged | Warning |
| `DSP455` | VR63 | `FLIGHT_DISPATCH` | A plan whose registration matches a pending unapplied tail change fails with LEG_STALE_PENDING_TAIL, not a generic mismatch | Error |
| `DSP456` | VR98 | `FLIGHT_DISPATCH` | version_gap_flag and versions_skipped are stamped on the applied plan row and never back-updated | Error |
| `DSP457` | VR99 | `FLIGHT_DISPATCH` | Variance analysis on a GAPPED leg is reported with a coverage qualifier, not as a clean figure | Warning |

### FB4xx — Fuel burn

8 rules · 8 against entities that exist today · package: WP-19

| Code | Was | Applies to | Rule | Severity |
|---|---|---|---|---|
| `FB450` | VR108 | `FUEL_BURNS` | Burn is derived from gauge readings; it is never keyed directly | Error |
| `FB451` | VR109 | `FUEL_BURNS` | Exactly one row per flight_leg_id may carry is_primary = Y | Error |
| `FB452` | VR110 | `FUEL_BURNS` | The primary row is the lowest source_priority available; lower priority rows are retained, never deleted | Error |
| `FB453` | VR111 | `FUEL_BURNS` | A missing gauge point yields a null derived value, never zero | Error |
| `FB454` | VR112 | `FUEL_BURNS` | Legs with source ESTIMATED are excluded from variance statistics and labelled in any report that includes them | Error |
| `FB455` | VR113 | `FUEL_BURNS` | engine_burn = block_burn minus apu_burn; the two must be separable for efficiency reporting | Error |
| `FB456` | VR114 | `FUEL_BURNS` | Jettisoned and defuelled quantities are excluded from burn; they are separate ledger events | Error |
| `FB457` | VR122 | `FUEL_BURNS` | Burn variance against plan is not computed for legs that did not complete as planned - air return, diversion, return to ramp. The planned trip fuel refers to a sector that was not flown | Error |

### LDG4xx — Fuel ledger

4 rules · 4 against entities that exist today · package: WP-03 done, WP-17

| Code | Was | Applies to | Rule | Severity |
|---|---|---|---|---|
| `LDG401` | VR118 | `ROB_LEDGER` | computed FOB = prior FOB plus signed quantity; every event chains | Error |
| `LDG402` | VR119 | `ROB_LEDGER` | The ledger keys on registration, not on flight leg; it chains through tail swaps and unmatched tickets | Error |
| `LDG403` | VR120 | `ROB_LEDGER` | Closure beyond the outer tolerance is BROKEN_CHAIN and raised as unexplained fuel | Error |
| `LDG404` | VR121 | `ROB_LEDGER` | Ledger closure is the only check that detects an entirely uncaptured event | Warning |

### INV4xx — Invoice

9 rules · 9 against entities that exist today · package: WP-21

| Code | Was | Applies to | Rule | Severity |
|---|---|---|---|---|
| `INV450` | VR27 | `INVOICE_ITEMS` | Every invoice line must resolve to exactly one ticket_id; unresolved lines are NO_TICKET | Error |
| `INV451` | VR28 | `INVOICE_ITEMS` | Invoiced quantity must agree with ticket quantity within the same tolerance as FOB reconciliation | Error |
| `INV452` | VR29 | `INVOICE_ITEMS` | Unit price must equal the contract formula price within 0.0005 per litre | Error |
| `INV453` | VR30 | `INVOICE_ITEMS` | A ticket with no invoice line after the billing period closes is reported as unbilled exposure | Warning |
| `INV454` | VR31 | `INVOICES` | Invoice total and line count are derived from lines, never keyed from the supplier document | Error |
| `INV455` | VR33 | `INVOICE_ITEMS` | A ticket_id may appear on at most one payable invoice line across all billing periods | Error |
| `INV456` | VR34 | `INVOICE_ITEMS` | Negative lines are valid for DEFUEL and must reduce, not increase, the invoice total | Error |
| `INV457` | VR35 | `INVOICE_ITEMS` | Pricing basis may be CONTRACT or POSTED; the basis determines which reference price applies | Error |
| `INV458` | VR36 | `INVOICE_ITEMS` | A MATCHED status on quantity and price does not clear a density error; FQIS cross check is required | Warning |

### MDM4xx — Master data

14 rules · 10 against entities that exist today · package: WP-07, WP-16

| Code | Was | Applies to | Rule | Severity |
|---|---|---|---|---|
| `MDM401` | VR59 | `AIRCRAFT_REGISTRATIONS *new*` | Auto provisioned aircraft are created PROVISIONAL and never auto promoted | Error |
| `MDM402` | VR60 | `AIRCRAFT_REGISTRATIONS *new*` | Order creation and order send are blocked while the tail is PROVISIONAL; ticket capture is not | Error |
| `MDM403` | VR61 | `AIRCRAFT_REGISTRATIONS *new*` | Provisioning warns when a registration differs from an existing one by a single character | Warning |
| `MDM404` | VR62 | `AIRCRAFT_REGISTRATIONS *new*` | PROVISIONAL beyond the configured window escalates; the state is time boxed | Warning |
| `MDM405` | VR100 | `AIRCRAFT_MASTER` | aircraft_type is a parameter scope level and must be an FK; free text on the tail would break tolerance resolution silently | Error |
| `MDM406` | VR101 | `AIRCRAFT_MASTER` | Type resolution never uses IATA or ICAO code alone; both are shared across engine variants with different burn | Error |
| `MDM407` | VR102 | `—` | Every inbound type code resolves through an alias; source_system plus alias_code is unique | Error |
| `MDM408` | VR103 | `—` | Alias codes are normalised before lookup: trimmed, uppercased, internal spacing collapsed | Error |
| `MDM409` | VR104 | `AIRCRAFT_MASTER` | An unknown type auto provisions as PROVISIONAL; tolerance resolution falling back to GLOBAL is flagged, never silent | Error |
| `MDM410` | VR105 | `—` | When AIRCRAFT_CONFIG_GRANULARITY is NONE the config table is not presented and DOW is held on the tail | Error |
| `MDM411` | VR106 | `—` | Config specific DOW overrides the type default; tail specific values override both | Error |
| `MDM412` | VR107 | `AIRCRAFT_MASTER` | PRIMARY_TYPE_CODE_SCHEME governs display and reporting only; resolution always uses aircraft_type_id | Error |
| `MDM413` | VR132 | `AIRCRAFT_MASTER` | apu_reporting_available records whether the AMI carries an APU report; it is held per fleet, never per airline | Error |
| `MDM414` | VR135 | `AIRCRAFT_MASTER` | apu_reporting_available UNKNOWN is distinct from N; unknown falls back to MANUAL and is resolved at type confirmation | Error |

### CFG4xx — Configuration resolution

6 rules · 4 against entities that exist today · package: WP-13

| Code | Was | Applies to | Rule | Severity |
|---|---|---|---|---|
| `CFG401` | VR42 | `TOLERANCE_RULES` | Resolution picks the highest specificity_rank whose scope, grade, quantity band and date window all match | Error |
| `CFG402` | VR43 | `TOLERANCE_RULES` | The as-of date for resolution is the uplift date, never the query date | Error |
| `CFG403` | VR44 | `TOLERANCE_RULES` | Only one row per parameter_code and scope_key may be ACTIVE for any given date | Error |
| `CFG404` | VR45 | `TOLERANCE_RULES` | Value columns must match the parameter_code; enforce by check constraint, not by the config screen | Error |
| `CFG405` | VR46 | `—` | Rows are immutable once written; a later config change never alters an applied value | Error |
| `CFG406` | VR47 | `—` | Every tolerance driven status must have a corresponding applied row naming the parameter_id used | Error |

### STG4xx — Inbound staging

26 rules · 0 against entities that exist today · package: WP-15

| Code | Was | Applies to | Rule | Severity |
|---|---|---|---|---|
| `STG401` | VR48 | `— staging, WP-15` | Identity resolution happens before content validation; a record that fails validation still carries a resolved business key | Error |
| `STG402` | VR49 | `— staging, WP-15` | Exactly one record per business key may hold is_latest_for_key = Y | Error |
| `STG403` | VR50 | `— staging, WP-15` | The error worklist shows only record_status ERROR with is_latest_for_key Y | Error |
| `STG404` | VR51 | `— staging, WP-15` | Superseded records are retained, never deleted; recurrence count is itself a signal | Warning |
| `STG405` | VR52 | `— staging, WP-15` | payload_hash covers mapped fields only; source timestamps and sequence numbers are excluded | Error |
| `STG406` | VR53 | `— staging, WP-15` | change_type compares against the latest staging record for the key, not against the target | Error |
| `STG407` | VR54 | `— staging, WP-15` | A payload matching the target but differing from the latest staging record is REVERSAL, never NO_CHANGE | Error |
| `STG408` | VR55 | `— staging, WP-15` | Apply ordering uses source_change_utc; a record older than last_applied_source_utc is IGNORED_STALE | Error |
| `STG409` | VR56 | `—` | Criticality is resolved from configuration at runtime, never hardcoded in the apply logic | Error |
| `STG410` | VR66 | `— staging, WP-15` | NO_CHANGE suppresses a record only when the prior latest record was APPLIED; a resend against a failed record keeps the error alive and supersedes it | Error |
| `STG411` | VR67 | `— staging, WP-15` | record_status is derived from change_type plus the prior record outcome plus validation, in that order | Error |
| `STG412` | VR89 | `— staging, WP-15` | The dispatch feed transmits the current plan only; missing intermediate versions will never arrive | Error |
| `STG413` | VR90 | `— staging, WP-15` | A version gap is flagged and the record applied; it is never held, because holding would deadlock | Error |
| `STG414` | VR91 | `— staging, WP-15` | versions_skipped is recorded on the applied plan row and reported as an interface health metric | Warning |
| `STG415` | VR92 | `— staging, WP-15` | A resent version already applied is IGNORED_DUPLICATE; plan versions are inserts, not updates | Error |
| `STG416` | VR93 | `— staging, WP-15` | HELD statuses are not errors and occupy a separate queue; they retry automatically and escalate only on ageing | Error |
| `STG417` | VR94 | `— staging, WP-15` | A plan arriving before its leg is HELD_AWAITING_LEG, never rejected | Error |
| `STG418` | VR95 | `— staging, WP-15` | A plan for a leg with an unapplied critical change is HELD_STALE_LEG naming the blocking staging record | Error |
| `STG419` | VR96 | `— staging, WP-15` | Ordering is by plan_version; a lower version arriving later is IGNORED_STALE | Error |
| `STG420` | VR75 | `— staging, WP-15` | run_mode is DELTA, SNAPSHOT or RECONCILIATION; divergence detection runs only on the latter two | Error |
| `STG421` | VR76 | `— staging, WP-15` | The staleness check runs before change_type is acted on; STALE short circuits and wins over REVERSAL | Error |
| `STG422` | VR77 | `— staging, WP-15` | A snapshot value differing from the applied value with no explaining delta raises a divergence exception even though the correction is applied | Error |
| `STG423` | VR78 | `— staging, WP-15` | Absence inside the declared window raises divergence; absence outside the window is ignored | Error |
| `STG424` | VR79 | `— staging, WP-15` | Cancellation is never inferred from absence; it arrives as an explicit record | Error |
| `STG425` | VR80 | `— staging, WP-15` | Sequence gap detection applies to the delta stream only; a snapshot run resets the expected position | Error |
| `STG426` | VR81 | `— staging, WP-15` | Divergence count is reported as an interface health metric, not only as individual exceptions | Warning |

### APU4xx — APU usage

14 rules · 0 against entities that exist today · package: WP-19

| Code | Was | Applies to | Rule | Severity |
|---|---|---|---|---|
| `APU401` | VR115 | `—` | APU burn is always derived as minutes over 60 times the rate from aircraft master; no meter exists | Error |
| `APU402` | VR116 | `—` | Avoidable minutes require gpu_available = Y and gpu_used = N; total APU minutes alone is not actionable | Error |
| `APU403` | VR117 | `—` | Where APU event data is absent, minutes are estimated from ground time and the source recorded as GROUND_TIME_EST | Error |
| `APU404` | VR117a | `—` | One row per APU cycle, not per phase; usage_phase is an attribute and phase totals are an aggregation | Error |
| `APU405` | VR117b | `—` | Running minutes are derived from full UTC timestamps wherever both exist; only the manual path is keyed | Error |
| `APU406` | VR117c | `—` | A cycle with no stop event is flagged open, capped and escalated; minutes and burn are never computed for it | Error |
| `APU407` | VR117d | `—` | A stop earlier than its start is rejected; negative minutes are never stored or displayed | Error |
| `APU408` | VR117e | `—` | gpu_available carries a source and a confidence; HANDLER and BILLING are HIGH, STAND_TYPE MEDIUM, STATION LOW | Error |
| `APU409` | VR117f | `—` | With no GPU data at any level, avoidable_minutes is NULL and confidence NOT_COMPUTED; it is never defaulted to zero | Error |
| `APU410` | VR149 | `—` | APU burn posts at turn granularity because most of it falls outside any single leg | Error |
| `APU411` | VR133 | `—` | minutes_source defaults from apu_minutes_default_source on the aircraft type unless a better source is present for the cycle | Error |
| `APU412` | VR134 | `—` | Where apu_reporting_available is N, GROUND_TIME_EST is the expected path and is not treated as a data quality exception | Error |
| `APU413` | VR136 | `—` | Estimated APU figures remain comparable station to station and are labelled; they are never presented beside ACARS figures as equivalent | Error |
| `APU414` | VR117g | `—` | Null avoidable and zero avoidable are displayed distinctly; a station with no GPU data must not appear perfectly efficient | Error |

### CMP4xx — Completeness and stock reconciliation

15 rules · 3 against entities that exist today · package: WP-22

| Code | Was | Applies to | Rule | Severity |
|---|---|---|---|---|
| `CMP401` | VR64 | `multiple` | Aircraft confirmation and leg tail confirmation are separate; both must clear before an order is sent | Error |
| `CMP402` | VR65 | `multiple` | provisional_tail_flag is stamped at creation on plan, order and ticket and is never back-updated | Error |
| `CMP403` | VR150 | `—` | Absence of a ticket is only a gap where the active plan required uplift is above zero | Error |
| `CMP404` | VR151 | `—` | Legs with processing mode NONE are EXCLUDED and never counted in completeness percentages | Error |
| `CMP405` | VR152 | `—` | Where no plan was received, uplift expectation is INDETERMINATE; neither a gap nor a legitimate absence may be asserted | Error |
| `CMP406` | VR153 | `—` | Burn is expected only where the leg departed; a cancelled leg is NOT_APPLICABLE, not MISSING | Error |
| `CMP407` | VR154 | `—` | Capture and posting are separate dimensions; a captured uplift with no goods receipt is PART_POSTED, not complete | Error |
| `CMP408` | VR155 | `—` | Estimated burn is neither COMPLETE nor MISSING; it is its own state with its own posting rule | Error |
| `CMP409` | VR156 | `—` | The cutoff is each tail's last on-blocks before period end, never a clock time | Error |
| `CMP410` | VR157 | `—` | A tail with no on-blocks event in the cutoff window is EXCLUDED_NO_GAUGE, never reported as a difference | Error |
| `CMP411` | VR158 | `—` | The difference is decomposed into timing and unexplained before any status is assigned | Error |
| `CMP412` | VR159 | `—` | UNEXPLAINED takes precedence over TIMING_ONLY; a material timing difference is still reported even when nothing is unexplained | Error |
| `CMP413` | VR160 | `—` | Tolerance scales with the quantity on board; a fixed absolute tolerance would fail every widebody | Error |
| `CMP414` | VR161 | `—` | Unposted uplift and unposted burn quantities are carried on the reconciliation as the accrual basis | Error |
| `CMP415` | VR123 | `multiple` | Band 1 control metrics are presented above band 2 and 3 analytics; analytics are qualified when band 1 is below target | Error |

### CLM4xx — Claim windows

7 rules · 0 against entities that exist today · package: Claim windows, unscheduled

| Code | Was | Applies to | Rule | Severity |
|---|---|---|---|---|
| `CLM401` | VR181 | `—` | A claim window is a contractual deadline, not backlog ageing; after expiry the right to claim is waived | Error |
| `CLM402` | VR182 | `—` | An ePOD signature is proof of delivery only; it is never treated as acceptance of quantity and never closes a variance | Error |
| `CLM403` | VR183 | `—` | Notification at delivery and the written claim are separate obligations with separate clocks | Error |
| `CLM404` | VR184 | `—` | Windows resolve from the contract by claim type; the IATA model agreement default applies only where none is configured | Error |
| `CLM405` | VR185 | `—` | Claim queues sort by least time remaining, never by oldest first | Error |
| `CLM406` | VR186 | `—` | Escalation occurs before the deadline, never after it | Error |
| `CLM407` | VR187 | `—` | Expiry without a claim is recorded as a write off requiring authorisation, never a silent close | Error |

### POS4xx — Posting determination

17 rules · 0 against entities that exist today · package: WP-23

| Code | Was | Applies to | Rule | Severity |
|---|---|---|---|---|
| `POS401` | VR176 | `—` | Where the fuel supplier also performs into-plane, the service side is NOT_APPLICABLE, never missing | Error |
| `POS402` | VR177 | `—` | One fuel ticket or ePOD acknowledgement maps to both the goods receipt and the service entry sheet | Error |
| `POS403` | VR178 | `—` | Fuel and service sides progress independently; a completed fuel side does not imply a completed service side | Error |
| `POS404` | VR179 | `—` | A corrected ticket reverses both the goods receipt and the service entry sheet, in dependency order | Error |
| `POS405` | VR180 | `—` | Fuel and service PO quantities are both in litres; the order in mass converts using the resolved conversion density | Error |
| `POS406` | VR137 | `—` | FuelSphere supplies the movement type and cost object only; the GL account is always derived by SAP through OBYC | Error |
| `POS407` | VR138 | `—` | GL_ACCOUNT is never populated on the BAPI call; supplying it would bypass standard account determination | Error |
| `POS408` | VR139 | `—` | Engine burn and APU burn use distinct movement types with distinct account modifications | Error |
| `POS409` | VR140 | `—` | Every movement type has a reversal counterpart; burn revisions reverse and repost rather than adjust | Error |
| `POS410` | VR141 | `—` | allow_estimated_posting is set per event category; estimated APU is postable, estimated engine burn is not | Error |
| `POS411` | VR142 | `—` | Jettison posts to its own movement type and account; it is never posted as consumption | Error |
| `POS412` | VR143 | `—` | Cost object resolves per fuel event, not per leg; engine and APU burn on one leg may resolve differently | Error |
| `POS413` | VR144 | `—` | Highest specificity_rank whose scope, event category and date window all match wins | Error |
| `POS414` | VR145 | `—` | A GLOBAL rank 0 rule must always exist; posting never fails for want of a cost object | Error |
| `POS415` | VR146 | `—` | object_source FROM_STATION, FROM_AIRCRAFT and FROM_ARRANGEMENT read the value from master data at resolution time | Error |
| `POS416` | VR147 | `—` | account_assignment_category must agree with object_type; a cost centre rule never populates ORDERID | Error |
| `POS417` | VR148 | `—` | The resolved movement type and cost object are stamped on the posted document and never re-resolved | Error |

### CAR4xx — Carrier arrangement

13 rules · 0 against entities that exist today · package: WP-24

| Code | Was | Applies to | Rule | Severity |
|---|---|---|---|---|
| `CAR401` | VR68 | `—` | Every leg resolves to exactly one arrangement; highest specificity_rank whose scope, counterparty and date window all match | Error |
| `CAR402` | VR69 | `—` | fuel_processing_mode is DERIVED from buys_fuel and bears_cost; it is never keyed directly | Error |
| `CAR403` | VR70 | `—` | buys_fuel alone determines whether an order and ticket are expected | Error |
| `CAR404` | VR71 | `—` | bears_cost alone determines cost allocation and recharge direction | Error |
| `CAR405` | VR72 | `—` | RECHARGE_OUT and RECHARGE_IN both require counterparty_party to be populated | Error |
| `CAR406` | VR73 | `—` | RECHARGE_IN expects a counterparty invoice and no supplier ticket; absence of a ticket is not an exception | Error |
| `CAR407` | VR74 | `—` | A missing arrangement at every scope level is an exception, never a silent default to FULL | Error |
| `CAR408` | VR82 | `—` | REGISTRATION_PERIOD outranks FLIGHT_NUMBER; leased metal is governed by the lease whatever number it operates | Error |
| `CAR409` | VR83 | `—` | Overlapping rows at the same specificity_rank raise an exception; they are never resolved by ordering | Error |
| `CAR410` | VR84 | `—` | Dry lease resolves to the own metal default; no arrangement row is created for it | Error |
| `CAR411` | VR85 | `—` | Arrangement resolves at leg creation and re-resolves on any critical field change, then is stamped on the leg | Error |
| `CAR412` | VR86 | `—` | A re-resolution that changes processing mode after an order was sent blocks and raises an exception | Error |
| `CAR413` | VR87 | `—` | fuel_processing_mode and cost_allocation_basis are independent; FULL processing may allocate to AIRCRAFT | Error |

### PRC4xx — Pricing

14 rules · 11 against entities that exist today · package: WP-20

| Code | Was | Applies to | Rule | Severity |
|---|---|---|---|---|
| `PRC401` | VR162 | `PRICING_FORMULAS` | pricing_source is resolved per contract, never per airline; mixed CPE and native deployments are normal | Error |
| `PRC402` | VR163 | `PRICING_FORMULAS` | A contract may not specify CPE where CPE_AVAILABLE is N; validated at configuration time, not at pricing time | Error |
| `PRC403` | VR164 | `PRICING_FORMULAS` | The native engine calculates the basic fuel price only; tax and duty amounts are calculated by SAP | Error |
| `PRC404` | VR165 | `FORMULA_COMPONENTS` | Components are stored individually and never folded into a single unit price | Error |
| `PRC405` | VR166 | `FORMULA_COMPONENTS` | vendor_role and po_type determine whether a component lands on the fuel PO or the service PO | Error |
| `PRC406` | VR167 | `DERIVED_PRICES` | Index in contract UoM converts to price UoM using the density basis stated on the scheme | Error |
| `PRC407` | VR168 | `DERIVED_PRICES` | Every quote used and the scheme version are stamped on the calculation, so a price is re-explainable without recomputation | Error |
| `PRC408` | VR169 | `DERIVED_PRICES` | price_status PROVISIONAL suppresses the invoice price variance check; a provisional price is not a variance | Error |
| `PRC409` | VR170 | `DERIVED_PRICES` | Provisional to final difference is settled by credit or debit note and reported as a distinct accrual | Error |
| `PRC410` | VR171 | `MARKET_INDEX_VALUES` | A restated quotation retains the original value and triggers repricing of anything priced on that date | Error |
| `PRC411` | VR172 | `MARKET_INDEX_VALUES` | Non business days carry no assessment; missing_quote_policy governs resolution, never a silent zero | Error |
| `PRC412` | VR173 | `—` | The tax code is determined by FuelSphere and supplied on the purchase document; SAP calculates the amount | Error |
| `PRC413` | VR174 | `—` | Contract default applies only where no rule matches; flight nature overrides it | Error |
| `PRC414` | VR175 | `—` | A diversion changing flight nature after pricing triggers tax code reassessment | Warning |

---

## Severity

**Error** blocks the operation. **Warning** records and continues.

Where a rule is marked Error against an entity that captures a physical event — a ticket, a delivery, a burn — check `00-DECISIONS.md` before blocking. Decisions A1, A3 and A4 all say the same thing: **capture is never blocked; external commitment is gated.** An Error on such a rule means flag and route to an exception queue, not refuse the record.

## Before implementing any rule

Two Phase 0 packages found the target in more places than stated, and a third found fifteen violations that appeared on no list. **Survey the field before asserting on it.** A rule enforced in one of five handlers looks implemented and is not.

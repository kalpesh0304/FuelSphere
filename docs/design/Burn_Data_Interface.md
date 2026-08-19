# Burn Data Interface — Specification

**FuelSphere · inbound interface from the flight operations system**
Draft 1 · 17 August 2026

---

## 1. What this interface is, and what it is not

**It is not an ACARS interface.** ACARS is a source, not a channel. FuelSphere does not connect to SITA or ARINC, does not decode datalink messages, and does not hold an aircraft addressing account.

**The flight operations system is the source.** It receives ACARS downlinks where the aircraft transmits, and holds the decoded values. FuelSphere reads from it.

```
Aircraft  ──ACARS──►  SITA / ARINC  ──►  Flight Ops System  ──►  FuelSphere
   FQIS, APU controller,                    decodes, stores          this interface
   squat switches, doors
```

**Where the operations system cannot supply a value, FuelSphere accepts it another way — but not every field can be keyed.** Three sources, not two.

| Source | Covers |
|---|---|
| **Transmitted** | Anything the aircraft sends and ops retains |
| **Manually entered** | What a human observes or records |
| **Derived** | What nobody observes, estimated from what is known |

### What can be keyed

OOOI times, from the tech log. `fob_out_kg` and `fob_in_kg`, which crew read at both block points. APU start and stop, usually reconstructed rather than observed. Ground power flags, from the turnaround record or the handling invoice. Weights, payload and cruise level, from the loadsheet and the OFP. Stand and delay, from the movement record.

### What cannot

**`fob_off_kg` and `fob_on_kg` — takeoff and touchdown fuel.** Nobody reads a gauge at rotation or at fifty feet. These exist only where the aircraft transmits them.

**The consequence: manual entry yields block burn, never trip burn.** The taxi split goes with it, since both need the same two readings.

`fob_before_refuel_kg` is possible in principle but requires someone at the aircraft before fuelling starts, which is a process the airline may not have. See open point E.

### What is derived rather than entered

Where APU cycles are neither transmitted nor recorded — the common case, since on and off times are not naturally observed by anyone — **minutes are estimated from ground time** at a station or fleet factor. That is `GROUND_TIME_EST`, a derivation and not an entry, and it carries low confidence accordingly.

**The posting trigger does not vary with data quality; only the proposal does** — decision C-2, Method 2. A manually entered burn and a transmitted one are confirmed through the same path.

---

## 2. One interface, not a fourth

The flight operations system already supplies the flight schedule. Burn data concerns the same flights, from the same system, on the same connection.

**Burn is a companion message on the operations interface**, not a separate integration. `REQ-INT-001` names three inbound CPI interfaces — schedule, dispatch, ticket — and this does not make a fourth.

| Message | Timing | Content |
|---|---|---|
| Schedule | Ahead of the flight, revised on change | Flight identity, times, tail, route |
| **Burn** | **After the flight** | OOOI actuals, fuel on board, APU cycles |

Whether they arrive as one payload with optional sections or two messages on one channel is an implementation choice. **The count of interfaces does not change either way.**

---

## 3. Field set

### 3.1 Identity — mandatory

| Field | Note |
|---|---|
| `aircraft_registration` | **The join key.** ACARS transmits for a tail, not a flight number |
| `flight_date` | Date of departure |
| `departure_time` | Scheduled or actual. **See §6** |
| `flight_number` | Where the ops system holds it. Convenience, not the key |
| `source_change_timestamp` | **Mandatory, non-negotiable.** MC-01. Without it, out-of-order arrivals corrupt data with no detection possible |
| `source_message_id` | For idempotency. `FB403` on duplicate |

**The join is registration + date + departure time** — REQ-FL-010. A narrowbody flies four to six sectors a day; tail plus date cannot separate them.

### 3.2 OOOI — the four movement events

| Field | Event | Source |
|---|---|---|
| `out_utc` | Off-blocks, pushback | Parking brake, door |
| `off_utc` | Takeoff | Weight-on-wheels |
| `on_utc` | Touchdown | Weight-on-wheels |
| `in_utc` | On-blocks | Parking brake, door |

**All four are requested.** Out and in alone give block burn but no trip or taxi split, and the taxi split is where APU and ground inefficiency hide.

Block, flight, taxi-out and taxi-in minutes are **derived by FuelSphere**, never keyed. A supplied value is overwritten — a derived figure that disagrees with its own inputs is worse than no figure.

### 3.3 Fuel on board — four gauge points

| Field | When | Feeds |
|---|---|---|
| `fob_out_kg` | Off-blocks | Block burn |
| `fob_off_kg` | Takeoff | Trip burn, taxi-out |
| `fob_on_kg` | Touchdown | Trip burn |
| `fob_in_kg` | On-blocks | Block burn, taxi-in |

```
block_burn = fob_out − fob_in
trip_burn  = fob_off − fob_on
taxi_out   = fob_out − fob_off
taxi_in    = fob_on  − fob_in
```

**A missing reading produces a null, never a zero.** Zero says measured and it was nothing; null says not measured.

### 3.4 Fuel on board at arrival and before refuelling

Two further readings, and they are **not the same** — REQ-FL-003:

| Field | When |
|---|---|
| `fob_at_arrival_kg` | Chocks-on, end of the arriving leg. Equals `fob_in_kg` of that leg |
| `fob_before_refuel_kg` | Immediately before uplift begins |

Between them sits ground time — temperature change, APU running, defuel, transfer. An aircraft landing at 10:00 and refuelling at 14:00 has four hours of drift.

**Do not populate one from the other.** Where only one is available, send it and leave the other empty. Copying manufactures a zero ground burn where the truth is unknown.

### 3.5 Source and confidence

| Field | Values |
|---|---|
| `fob_source` | `ACARS` · `CREW_REPORTED` · `PANEL_PRESET` · `NONE` |
| `fob_rounding_kg` | `0` where ACARS; **`100` where crew-reported** |

Crew-reported figures are typically rounded to 100 kg — **0.9% of a narrowbody uplift, 25% of a small top-up.** That rounding sets a floor under every tolerance downstream, so it must travel with the data rather than being assumed.

**An ACARS reading and a crew-reported one cannot be held to the same threshold.**

### 3.6 APU — one row per cycle

**APU on and off times are expected from the operations system**, on the same basis as everything else: where the aircraft transmits an APU report and ops retains it, it arrives here; where it does not, the same fields are keyed manually.

| Field | Note |
|---|---|
| `apu_start_utc` | Full UTC timestamp |
| `apu_stop_utc` | Full UTC timestamp. Empty means the cycle is open |
| `usage_phase` | `PRE_DEPARTURE` · `IN_FLIGHT` · `POST_ARRIVAL` · `OVERNIGHT` · `MAINTENANCE` · `PARKED` |
| `apu_source` | `ACARS` · `MANUAL` · `GROUND_TIME_EST` |

**One row per cycle, not per phase.** A turnaround produces several cycles across two phases and two legs — the arrival of one flight and the departure of the next.

**Full timestamps, not bare times.** A bare time cannot represent an overnight cycle.

**APU burn is never metered.** It is derived: `running minutes ÷ 60 × apu_burn_rate_kg_hr` from the aircraft register. An open cycle is flagged, not computed. A stop before its start is rejected.

**Most APU burn falls outside block time** — before off-blocks and after on-blocks — so no gauge reading captures it. That is why the cycle times matter and why estimation is a first-class path rather than a degraded one.

> **APU availability is a per-fleet property, not per-airline.** The AMI is loaded per fleet and defines which messages an aircraft sends. APU reports have no operational value to ops control and are billed per message, so they are frequently not configured. `apu_reporting_available` on the aircraft type governs the fallback. See open point F4.

### 3.7 Ground power — for avoidable APU

| Field | Note |
|---|---|
| `gpu_available` | Was ground power available at the stand |
| `gpu_used` | Was it connected |
| `gpu_source` | `HANDLER` · `BILLING` · `STAND_TYPE` · `STATION` · `NONE` |

**Avoidable minutes require `gpu_available = Y` and `gpu_used = N`.** Total APU minutes are not actionable — running where no ground power exists is necessary, not waste.

**Where `gpu_source` is `NONE`, avoidable minutes are not computed.** They are not zero. **A station with no ground power data must never display as perfectly efficient.**

### 3.8 Context for variance attribution

Optional, but variance is unattributable without it.

| Field | Explains |
|---|---|
| `actual_zfw_kg`, `actual_tow_kg`, `actual_lw_kg` | Weight — **the largest single cause of burn variance** |
| `pax_actual`, `cargo_kg` | Payload |
| `cruise_level_planned`, `cruise_level_flown` | Level deviation — the other main cause |
| `alternate_planned`, `alternate_used` | Route deviation |
| `dep_stand`, `dep_stand_type`, `arr_stand`, `arr_stand_type` | **Contact versus remote determines APU avoidability** |
| `single_engine_taxi_flag`, `deicing_flag` | Efficiency context |
| `delay_code`, `delay_minutes` | Ground delay correlates with APU burn. **Primary code and total minutes** — see below |

A leg burning 3% above plan because it carried three tonnes more cargo is not inefficiency — and without the weights, nothing can tell the difference.

> **Delay is not one-to-one with a flight.** IATA coding allows several delays on one departure — a technical hold followed by ATC flow carries two codes with two durations. `FLIGHT_SCHEDULE` holds a single `delay_code` and `delay_minutes`, which is the common simplification: **primary cause and total minutes**, with the remainder lost.
>
> That is adequate here. The design uses delay only to correlate ground time with APU burn, and the total serves that. **Do not implement a one-to-one relationship** — the ops system's own data does not have one, and attributing avoidable APU cost to a specific cause would need the full set.

---

## 4. Delivery

### 4.1 Pattern

**Push on completion**, per leg, after on-blocks. Burn is a settled fact once the aircraft is parked.

A daily reconciliation batch is expected in addition, carrying the same legs, to close gaps where a push was missed. **Absence never implies anything** — a leg not present in a batch is not a cancelled leg.

### 4.2 Latency

**The design assumes burn data arrives after the flight.** Method 2 posts the goods issue on confirmation, so nothing depends on burn being available before departure.

ACARS may deliver within minutes. Revised or corrected figures may take days. Both are accommodated: a later, better figure supersedes an earlier one, and where it arrives after posting, the movement is reversed and reposted rather than adjusted in place.

### 4.3 Idempotency and supersession

`source_message_id` gives message-level idempotency — a repeat raises `FB403` and is discarded.

Staging supersession is separate and complementary: three failing arrivals for one business key produce **one** actionable item, not three. Both controls apply. WP-15.

### 4.4 Correction

**Corrections arrive as new messages with a later `source_change_timestamp`**, never as edits. The original payload is retained.

A correction after burn confirmation triggers reverse-and-repost, carrying the cost object of the flight being corrected — not of the period in which the correction was made.

---

## 5. Protocol

Per `REQ-INT-003`: **FuelSphere publishes the field list and format. The sending system conforms.**

XML, on the same channel as the flight schedule. Field names, cardinality and types are published; middleware is the customer's concern.

> This replaces per-customer mapping, which is what the design previously assumed. Cheap to establish now; expensive once three customers are live on bespoke mappings.

Where the ops system emits AIDX, the **Operational Fuel Message** is the natural carrier — its Fuel Summary reflects a fuelling event and excludes commercial data, which is the right shape. That is a mapping exercise, not a second interface.

---

## 6. Open points

| # | Question | Why it matters |
|---|---|---|
| **A** | **Scheduled or actual departure time on the join key?** | Actual is more accurate; scheduled is available earlier. A slip from 15:00 to 17:30 moves the join, and a reading at 15:20 changes meaning. Part of **F2** |
| **B** | Does the ops system **retain** fuel-on-board, or process and discard it? | A system can consume a message without keeping every field. Determines whether these fields are available at all |
| **C** | Push or poll? | Section 4.1 assumes push. If the ops system only stores, FuelSphere polls, and latency grows |
| **D** | Does the ops system hold **APU cycle times**? | Section 3.6 expects them. Where routing sends APU reports to maintenance rather than ops, they are not there to send. **F4** |
| **E** | Is `fob_before_refuel_kg` recorded at all? | Many carriers record fuel on board only on the OFP at departure — after fuelling and after taxi has started, so not the reading §3.4 needs |
| **F** | Are the four gauge points all present, or only two? | Out and in alone give block burn without the trip or taxi split |

**Questions D, E and F determine which controls work.** None blocks the interface; each narrows what can be computed from it.

---

## 7. What degrades, and how

| Missing | Effect |
|---|---|
| All four gauge points | No burn derivation. Manual entry only |
| `fob_off`, `fob_on` | Block burn only. No trip or taxi split |
| APU cycle times | Ground-time estimation at low confidence, or manual entry |
| Ground power flags | Total APU minutes only. **Avoidable is not computed, and is not zero** |
| Weights and levels | Variance computed but unattributable |
| Stand identifiers | Station-level APU analysis only |

**Nothing here stops the interface working.** Each absence narrows what can be reported, and every derived figure carries its source and confidence so that a narrower answer is never mistaken for a complete one.

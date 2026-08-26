# Scenario figures — extracted from the seed, with derivations

Generated from the deployed database, not from a document. Every derivation
is recomputed from the row and compared against the stored value.

**Quote the derivation, not the figure.** `2,305.76 = 2,884.00 × 0.7995` cannot
be mistaken for a number computed somewhere else; `2,305.76` can.

---

## S1 — AC410, 2026-04-10, C-FDMO A320, YYZ→YUL

### 1 · PlanningService / FlightSchedule

  scheduled (local)          07:15:00 → 08:35:00
  sobt / sibt (UTC)          2026-04-10T11:15:00.000Z → 2026-04-10T12:35:00.000Z
  OOOI                       OUT 2026-04-10T11:20:00.000Z  OFF 2026-04-10T11:35:00.000Z
                             ON  2026-04-10T12:25:00.000Z  IN  2026-04-10T12:33:00.000Z
  planned_block_mins                     80
  actual_block_mins                      73
  fob_at_out_kg                     4,202.5   = the gauge after uplift = FUEL_DELIVERIES.fob_after_kg
  fob_at_off_kg                     4,052.5   = fob_at_out 4,202.5 − taxi_out 150
  fob_at_on_kg                      2,002.5   = fob_at_in 1,922.5 + taxi_in 80
  fob_at_in_kg                      1,922.5   = fob_at_out 4,202.5 − block burn 2,280
  fob_source                 ACARS
  flight_closure_utc         2026-04-10T12:52:00.000Z   source OCR
  cargo_kg / pax             1,850 / 147

### 2 · FuelOrderService / FlightDispatches — the regulated stack

  trip_fuel_kg                        2,050   = 1,538 kg/h over 80 min
  contingency_fuel_kg                 102.5   = 5% of TRIP 2,050
  alternate_fuel_kg                     700   = diversion to YOW
  final_reserve_kg                    1,150   = 30 minutes holding
  taxi_fuel_kg                          200
  additional_fuel_kg                      0   = no known delay
  extra_fuel_kg                           0   = no tankering
  block_fuel_kg                     4,202.5   = the seven above, summed
  required_uplift_kg                  2,305   = block 4,202.5 − fob_before 1,897.5
  rob_departure_kg                  4,202.5   = PLANNED on board at OUT — not the actual reading
                                              actual fob_at_out 4,202.5 — the plan was met
  plan                       v1 ACTIVE, source ASSIGNED

### 3 · FuelOrderService / FuelOrders

  ordered_quantity (L)             2,881.25   = required uplift 2,305 ÷ 0.8
  ordered_quantity_kg                 2,305   = 2,881.25 L × 0.8 kg/L  (UOM_MASTER)
  total_amount (CAD)               2,045.69   = 2,881.25 L × 0.71/L
  communication              ACKNOWLEDGED at 2026-04-09T18:30:00.000Z

### 4 · FuelOrderService / FuelTickets — 1 bowser(s)

  WFS-YYZ-20260410-11   meter 100,000 → 102,884
    quantity_metered (L)              2,884   = 102,884 − 100,000
    quantity_kg                    2,305.76   = 2,884 L × 0.7995 kg/L at 11.5 °C

### 5 · FuelOrderService / FuelDeliveries — the reconciliation

  fob_at_arrival_kg                   1,950   = gauge at chocks-on, end of the arriving leg
  ground_burn_kg                       52.5   = fob_at_arrival 1,950 − fob_before 1,897.5
  fob_before_kg                     1,897.5   = gauge immediately before uplift — the reconciliation input
  fob_after_kg                      4,202.5   = fob_before 1,897.5 + gauge uplift 2,305
  fob_delta_kg                        2,305   = fob_after 4,202.5 − fob_before 1,897.5
  recon_variance_kg                    0.76   = metered 2,305.76 − FQIS 2,305
  tolerance                              50   = max(0.5% of 2,305.76 = 11.53, floor 50) — the 50 kg FLOOR governs
  recon_status                   RECONCILED   0.76 ≤ 50
  fob_source                          ACARS

### 6 · BurnService / ApuUsage

    PRE_DEPARTURE                      52.5   = 30 min × 105 kg/h ÷ 60   [AIRCRAFT_REGISTRATIONS]
                             2026-04-10T09:50:00.000Z → 2026-04-10T10:20:00.000Z
    POST_ARRIVAL                      33.25   = 19 min × 105 kg/h ÷ 60   [AIRCRAFT_REGISTRATIONS]
                             2026-04-10T12:33:00.000Z → 2026-04-10T12:52:00.000Z

### 7 · BurnService / FuelBurns

  actual_burn_kg (block)              2,280   = fob_at_out 4,202.5 − fob_at_in 1,922.5
  trip_fuel_kg                        2,050   = fob_at_off 4,052.5 − fob_at_on 2,002.5
  taxi_out + taxi_in                    230   = block 2,280 − trip 2,050
  apu_burn_kg (in block)                  0   = no APU cycle overlaps [OUT, IN] — block burn cannot contain ground APU
  engine_burn_kg                      2,280   = block 2,280 − APU in block 0
  planned_burn_kg                     2,050   = FLIGHT_DISPATCH.trip_fuel_kg
  variance_kg                             0   = trip burn 2,050 − planned 2,050
  variance_status                    NORMAL

### 8 · BurnService / ROBLedger — one chain

  seq1 OPENING     YYZ         1,950               →         1,950
  seq2 ADJUSTMENT  YYZ         1,950        −52.5  →       1,897.5
  seq3 UPLIFT      YYZ       1,897.5       +2,305  →       4,202.5
  seq4 BURN        YUL       4,202.5       −2,280  →       1,922.5
  seq5 ADJUSTMENT  YUL       1,922.5       −33.25  →      1,889.25
                     row 3 closing = FUEL_DELIVERIES.fob_after_kg   4,202.5 = 4,202.5
                     row 4 closing = FLIGHT_SCHEDULE.fob_at_in_kg   1,922.5 = 1,922.5

### 9 · MasterDataService / AircraftRegistrations

  registration               C-FDMO   A320   operator ACA
  apu_burn_rate_kg_hr                   105   = the rate every APU figure above derives from
  fuel_capacity_kg                   19,100
  dry_operating_weight_kg            42,800
  record_status              CONFIRMED

---

## S2 — AC856, 2026-04-10, C-GDMS A350, YYZ→LHR

### 1 · PlanningService / FlightSchedule

  scheduled (local)          21:40:00 → 09:30:00
  sobt / sibt (UTC)          2026-04-11T01:40:00.000Z → 2026-04-11T08:30:00.000Z
  OOOI                       OUT 2026-04-11T01:52:00.000Z  OFF 2026-04-11T02:10:00.000Z
                             ON  2026-04-11T08:35:00.000Z  IN  2026-04-11T08:44:00.000Z
  planned_block_mins                    410
  actual_block_mins                     412
  fob_at_out_kg                      46,350   = the gauge after uplift = FUEL_DELIVERIES.fob_after_kg
  fob_at_off_kg                      45,930   = fob_at_out 46,350 − taxi_out 420
  fob_at_on_kg                        6,930   = fob_at_in 6,750 + taxi_in 180
  fob_at_in_kg                        6,750   = fob_at_out 46,350 − block burn 39,600
  fob_source                 ACARS
  flight_closure_utc         2026-04-11T09:02:00.000Z   source MANUAL
  cargo_kg / pax             12,400 / 302

### 2 · FuelOrderService / FlightDispatches — the regulated stack

  trip_fuel_kg                       39,000   = 5,707 kg/h over 410 min
  contingency_fuel_kg                 1,950   = 5% of TRIP 39,000
  alternate_fuel_kg                   2,500   = diversion to LGW
  final_reserve_kg                    2,300   = 30 minutes holding
  taxi_fuel_kg                          600
  additional_fuel_kg                      0   = no known delay
  extra_fuel_kg                           0   = no tankering
  block_fuel_kg                      46,350   = the seven above, summed
  required_uplift_kg                 41,950   = block 46,350 − fob_before 4,400
  rob_departure_kg                   46,350   = PLANNED on board at OUT — not the actual reading
                                              actual fob_at_out 46,350 — the plan was met
  plan                       v1 ACTIVE, source ASSIGNED

### 3 · FuelOrderService / FuelOrders

  ordered_quantity (L)             52,437.5   = required uplift 41,950 ÷ 0.8
  ordered_quantity_kg                41,950   = 52,437.5 L × 0.8 kg/L  (UOM_MASTER)
  total_amount (CAD)              37,230.63   = 52,437.5 L × 0.71/L
  communication              None at None

### 4 · FuelOrderService / FuelTickets — 2 bowser(s)

  WFS-YYZ-20260410-21   meter 200,000 → 232,000
    quantity_metered (L)             32,000   = 232,000 − 200,000
    quantity_kg                    25,542.4   = 32,000 L × 0.7982 kg/L at 11.5 °C
  WFS-YYZ-20260410-22   meter 450,000 → 470,650
    quantity_metered (L)             20,650   = 470,650 − 450,000
    quantity_kg                   16,482.83   = 20,650 L × 0.7982 kg/L at 11.5 °C
  METERED TOTAL                   42,025.23   = 25,542.4 + 16,482.83

### 5 · FuelOrderService / FuelDeliveries — the reconciliation

  fob_at_arrival_kg                   4,490   = gauge at chocks-on, end of the arriving leg
  ground_burn_kg                         90   = fob_at_arrival 4,490 − fob_before 4,400
  fob_before_kg                       4,400   = gauge immediately before uplift — the reconciliation input
  fob_after_kg                       46,350   = fob_before 4,400 + gauge uplift 41,950
  fob_delta_kg                       41,950   = fob_after 46,350 − fob_before 4,400
  recon_variance_kg                   75.23   = metered 42,025.23 − FQIS 41,950
  tolerance                          210.13   = max(0.5% of 42,025.23 = 210.13, floor 50) — 0.5% governs
  recon_status                   RECONCILED   75.23 ≤ 210.13
  fob_source                          ACARS

### 6 · BurnService / ApuUsage

    PRE_DEPARTURE                        90   = 40 min × 135 kg/h ÷ 60   [AIRCRAFT_REGISTRATIONS]
                             2026-04-10T23:40:00.000Z → 2026-04-11T00:20:00.000Z
    POST_ARRIVAL                         45   = 20 min × 135 kg/h ÷ 60   [AIRCRAFT_REGISTRATIONS]
                             2026-04-11T08:44:00.000Z → 2026-04-11T09:04:00.000Z

### 7 · BurnService / FuelBurns

  actual_burn_kg (block)             39,600   = fob_at_out 46,350 − fob_at_in 6,750
  trip_fuel_kg                       39,000   = fob_at_off 45,930 − fob_at_on 6,930
  taxi_out + taxi_in                    600   = block 39,600 − trip 39,000
  apu_burn_kg (in block)                  0   = no APU cycle overlaps [OUT, IN] — block burn cannot contain ground APU
  engine_burn_kg                     39,600   = block 39,600 − APU in block 0
  planned_burn_kg                    39,000   = FLIGHT_DISPATCH.trip_fuel_kg
  variance_kg                             0   = trip burn 39,000 − planned 39,000
  variance_status                    NORMAL

### 8 · BurnService / ROBLedger — one chain

  seq1 OPENING     YYZ         4,490               →         4,490
  seq2 ADJUSTMENT  YYZ         4,490          −90  →         4,400
  seq3 UPLIFT      YYZ         4,400      +41,950  →        46,350
  seq4 BURN        LHR        46,350      −39,600  →         6,750
  seq5 ADJUSTMENT  LHR         6,750          −45  →         6,705
                     row 3 closing = FUEL_DELIVERIES.fob_after_kg   46,350 = 46,350
                     row 4 closing = FLIGHT_SCHEDULE.fob_at_in_kg   6,750 = 6,750

### 9 · MasterDataService / AircraftRegistrations

  registration               C-GDMS   A350   operator ACA
  apu_burn_rate_kg_hr                   135   = the rate every APU figure above derives from
  fuel_capacity_kg                  111,000
  dry_operating_weight_kg           145,200
  record_status              CONFIRMED

---

## S3 — AC412, 2026-04-10, C-FDMP A320, YYZ→YUL

### 1 · PlanningService / FlightSchedule

  scheduled (local)          11:05:00 → 12:25:00
  sobt / sibt (UTC)          2026-04-10T15:05:00.000Z → 2026-04-10T16:25:00.000Z
  OOOI                       OUT 2026-04-10T15:10:00.000Z  OFF 2026-04-10T15:25:00.000Z
                             ON  2026-04-10T16:15:00.000Z  IN  2026-04-10T16:22:00.000Z
  planned_block_mins                     80
  actual_block_mins                      72
  fob_at_out_kg                     4,082.5   = the gauge after uplift = FUEL_DELIVERIES.fob_after_kg
  fob_at_off_kg                     3,932.5   = fob_at_out 4,082.5 − taxi_out 150
  fob_at_on_kg                      1,882.5   = fob_at_in 1,802.5 + taxi_in 80
  fob_at_in_kg                      1,802.5   = fob_at_out 4,082.5 − block burn 2,280
  fob_source                 ACARS
  flight_closure_utc         2026-04-10T16:40:00.000Z   source MANUAL
  cargo_kg / pax             1,620 / 147

### 2 · FuelOrderService / FlightDispatches — the regulated stack

  trip_fuel_kg                        2,050   = 1,538 kg/h over 80 min
  contingency_fuel_kg                 102.5   = 5% of TRIP 2,050
  alternate_fuel_kg                     700   = diversion to YOW
  final_reserve_kg                    1,150   = 30 minutes holding
  taxi_fuel_kg                          200
  additional_fuel_kg                      0   = no known delay
  extra_fuel_kg                           0   = no tankering
  block_fuel_kg                     4,202.5   = the seven above, summed
  required_uplift_kg                  2,305   = block 4,202.5 − fob_before 1,897.5
  rob_departure_kg                  4,202.5   = PLANNED on board at OUT — not the actual reading
                                      120.0   = planned 4,202.5 − actual fob_at_out 4,082.5
                                                the aircraft departed 120.0 kg LIGHT
  plan                       v1 ACTIVE, source ASSIGNED

### 3 · FuelOrderService / FuelOrders

  ordered_quantity (L)             2,881.25   = required uplift 2,305 ÷ 0.8
  ordered_quantity_kg                 2,305   = 2,881.25 L × 0.8 kg/L  (UOM_MASTER)
  total_amount (CAD)               2,045.69   = 2,881.25 L × 0.71/L
  communication              None at None

### 4 · FuelOrderService / FuelTickets — 1 bowser(s)

  WFS-YYZ-20260410-31   meter 100,000 → 102,884
    quantity_metered (L)              2,884   = 102,884 − 100,000
    quantity_kg                    2,305.76   = 2,884 L × 0.7995 kg/L at 11.5 °C

### 5 · FuelOrderService / FuelDeliveries — the reconciliation

  fob_at_arrival_kg                 2,002.5   = gauge at chocks-on, end of the arriving leg
  ground_burn_kg                        105   = fob_at_arrival 2,002.5 − fob_before 1,897.5
  fob_before_kg                     1,897.5   = gauge immediately before uplift — the reconciliation input
  fob_after_kg                      4,082.5   = fob_before 1,897.5 + gauge uplift 2,185
  fob_delta_kg                        2,185   = fob_after 4,082.5 − fob_before 1,897.5
  recon_variance_kg                  120.76   = metered 2,305.76 − FQIS 2,185
  tolerance                              50   = max(0.5% of 2,305.76 = 11.53, floor 50) — the 50 kg FLOOR governs
  recon_status                     VARIANCE   120.76 > 50
  fob_source                          ACARS

### 6 · BurnService / ApuUsage

    PRE_DEPARTURE                       105   = 60 min × 105 kg/h ÷ 60   [AIRCRAFT_REGISTRATIONS]
                             2026-04-10T13:15:00.000Z → 2026-04-10T14:15:00.000Z
    POST_ARRIVAL                         35   = 20 min × 105 kg/h ÷ 60   [AIRCRAFT_REGISTRATIONS]
                             2026-04-10T16:22:00.000Z → 2026-04-10T16:42:00.000Z

### 7 · BurnService / FuelBurns

  actual_burn_kg (block)              2,280   = fob_at_out 4,082.5 − fob_at_in 1,802.5
  trip_fuel_kg                        2,050   = fob_at_off 3,932.5 − fob_at_on 1,882.5
  taxi_out + taxi_in                    230   = block 2,280 − trip 2,050
  apu_burn_kg (in block)                  0   = no APU cycle overlaps [OUT, IN] — block burn cannot contain ground APU
  engine_burn_kg                      2,280   = block 2,280 − APU in block 0
  planned_burn_kg                     2,050   = FLIGHT_DISPATCH.trip_fuel_kg
  variance_kg                             0   = trip burn 2,050 − planned 2,050
  variance_status                    NORMAL

### 8 · BurnService / ROBLedger — one chain

  seq1 OPENING     YYZ       2,002.5               →       2,002.5
  seq2 ADJUSTMENT  YYZ       2,002.5         −105  →       1,897.5
  seq3 UPLIFT      YYZ       1,897.5       +2,185  →       4,082.5
  seq4 BURN        YUL       4,082.5       −2,280  →       1,802.5
  seq5 ADJUSTMENT  YUL       1,802.5          −35  →       1,767.5
                     row 3 closing = FUEL_DELIVERIES.fob_after_kg   4,082.5 = 4,082.5
                     row 4 closing = FLIGHT_SCHEDULE.fob_at_in_kg   1,802.5 = 1,802.5

### 9 · MasterDataService / AircraftRegistrations

  registration               C-FDMP   A320   operator ACA
  apu_burn_rate_kg_hr                   105   = the rate every APU figure above derives from
  fuel_capacity_kg                   19,100
  dry_operating_weight_kg            42,750
  record_status              CONFIRMED

---

## The pair — one number, two verdicts

  S3   variance 120.76   vs tolerance 50   = max(0.5% of 2,305.76, floor 50)   → VARIANCE
  S2   the SAME 120.76   vs tolerance 210.13   = max(0.5% of 42,025.23, floor 50)   → RECONCILED

  120.76 kg is 5.24% of S3's uplift and 0.29% of S2's.
  The rule is identical in both. Only the quantity differs.

  And S2 passes on 75.23 kg — larger than S3's ENTIRE tolerance of 50.

---

## The two register cases — no order, for two opposite reasons

Both turn on a tail. `applyPolicy` never reads `record_status`;
`assertOrderable` does — so the two states are opposite on BOTH axes.

### S6 — PR501, 2026-04-07, RP-C8805 A320, MNL→SIN

  register status               PROVISIONAL   resolves, and BLOCKS the order (MDM402)

#### The regulated stack
  trip fuel                         5,827.5
  contingency fuel                   291.38
  alternate fuel                    1,102.5
  final reserve                       1,150
  additional fuel                         0
  taxi fuel                             250
  extra fuel                              0
  block fuel                       8,621.38   = sum of the seven components (DSP450)
  required uplift                  2,121.38   = 8,621.38 − 6,500.00 on board (DSP451)
  contingency check                  291.38   = 5% of TRIP 5,827.5 — and 3.38% of block, so the two cannot be confused

#### The empty fields are the content
  dispatch_order_id                 (empty)   the commercial commitment, set on confirmation
  fuel_order_ID                     (empty)   MDM402 refused it, so there is none
  every other dispatch row               10   of 11 carry one, because every other flight has an order

### The unresolved tail — AC414, 2026-04-10, A321, YYZ→YUL

  aircraft_reg                       C-GXLW   as RECEIVED. Renders as text
  tail_registration                  (null)   as RESOLVED. Renders BLANK
  rows in the register                    0   the register has never seen this tail
  order creation                  PERMITTED   unknown ≠ provisional; auto-provisioning defers to WP-16

  A blank Aircraft beside a populated Registration is a visible state that
  means something. S6 is the opposite: the link resolves and the order does not.


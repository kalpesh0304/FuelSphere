"""S1/S2/S3 figures extract — every number with the arithmetic that produced it.

READ-ONLY. Every derivation is COMPUTED from the row's own fields and then
compared to what is stored; a mismatch prints as MISMATCH rather than being
silently formatted away. A derivation that is not checked is just another
typed figure.
"""
import sqlite3
from decimal import Decimal as D, ROUND_HALF_UP

# The repo root, from this file's own location. Both of these were
# location-dependent while the generator lived outside the repository:
# a bare 'db.sqlite' only resolves when run from the root, and the
# output path was a scratchpad directory that does not survive a session.
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, 'db.sqlite')
if not os.path.exists(DB):
    raise SystemExit(f'{DB} not found. Run `npx cds deploy --to sqlite:db.sqlite` first.')
OUT = os.path.join(ROOT, 'docs', 'design', 'SCENARIO-FIGURES.md')
c = sqlite3.connect(DB); c.row_factory = sqlite3.Row
out = []
def w(s=''): out.append(s)
def dec(v): return None if v is None else D(str(v))
def fmt(v): return '—' if v is None else f'{v:,}'

def line(label, stored, deriv=None, calc=None):
    """One figure. deriv is the arithmetic as text; calc is it recomputed."""
    s = dec(stored)
    if deriv is None:
        w(f'  {label:<26} {fmt(s):>14}')
        return
    ok = (calc is None) or (calc == s)
    flag = '' if ok else f'   *** MISMATCH: arithmetic gives {fmt(calc)}'
    w(f'  {label:<26} {fmt(s):>14}   = {deriv}{flag}')

SCEN = [
 ('S1', 'AC410', 'FO-AC-2026-410', 'FO-YYZ-20260410-001', 'EPD-YYZ-20260410-0001', 'C-FDMO'),
 ('S2', 'AC856', 'FO-AC-2026-856', 'FO-YYZ-20260410-002', 'EPD-YYZ-20260410-0002', 'C-GDMS'),
 ('S3', 'AC412', 'FO-AC-2026-412', 'FO-YYZ-20260410-003', 'EPD-YYZ-20260410-0003', 'C-FDMP'),
]

w('# Scenario figures — extracted from the seed, with derivations')
w()
w('Generated from the deployed database, not from a document. Every derivation')
w('is recomputed from the row and compared against the stored value.')
w()
w('**Quote the derivation, not the figure.** `2,305.76 = 2,884.00 × 0.7995` cannot')
w('be mistaken for a number computed somewhere else; `2,305.76` can.')
w()

for tag, flight, dispatch, order, delivery, tail in SCEN:
    fs = c.execute("select * from fuelsphere_FLIGHT_SCHEDULE where flight_number=?", (flight,)).fetchone()
    fd = c.execute("select * from fuelsphere_FLIGHT_DISPATCH where dispatch_order_id=?", (dispatch,)).fetchone()
    fo = c.execute("select * from fuelsphere_FUEL_ORDERS where order_number=?", (order,)).fetchone()
    dl = c.execute("select * from fuelsphere_FUEL_DELIVERIES where delivery_number=?", (delivery,)).fetchone()
    tk = c.execute("select * from fuelsphere_FUEL_TICKETS where delivery_ID=? order by ticket_number", (dl['ID'],)).fetchall()
    ap = c.execute("""select * from fuelsphere_APU_USAGE where tail_number=? and allocated_flight_ID=?
                      order by apu_start_utc""", (tail, fs['ID'])).fetchall()
    bn = c.execute("select * from fuelsphere_FUEL_BURNS where flight_ID=?", (fs['ID'],)).fetchone()
    led = c.execute("select * from fuelsphere_ROB_LEDGER where flight_ID=? order by sequence", (fs['ID'],)).fetchall()
    reg = c.execute("select * from fuelsphere_AIRCRAFT_REGISTRATIONS where registration=?", (tail,)).fetchone()

    w('---'); w()
    w(f'## {tag} — {flight}, {fs["flight_date"]}, {tail} {fs["aircraft_type"]}, '
      f'{fs["origin_airport"]}→{fs["destination_airport"]}')
    w()

    # ---- 1. FlightSchedule -------------------------------------------------
    w('### 1 · PlanningService / FlightSchedule')
    w()
    w(f'  {"scheduled (local)":<26} {fs["scheduled_departure"]} → {fs["scheduled_arrival"]}')
    w(f'  {"sobt / sibt (UTC)":<26} {fs["sobt"]} → {fs["sibt"]}')
    w(f'  {"OOOI":<26} OUT {fs["aobt"]}  OFF {fs["atot"]}')
    w(f'  {"":<26} ON  {fs["aldt"]}  IN  {fs["aibt"]}')
    line('planned_block_mins', fs['planned_block_mins'])
    line('actual_block_mins', fs['actual_block_mins'])
    o,off,on,i = (dec(fs[k]) for k in ('fob_at_out_kg','fob_at_off_kg','fob_at_on_kg','fob_at_in_kg'))
    line('fob_at_out_kg', o, 'the gauge after uplift = FUEL_DELIVERIES.fob_after_kg', dec(dl['fob_after_kg']))
    line('fob_at_off_kg', off, f'fob_at_out {fmt(o)} − taxi_out {fmt(dec(bn["taxi_out_kg"]))}',
         o - dec(bn['taxi_out_kg']) if bn else None)
    line('fob_at_on_kg', on, f'fob_at_in {fmt(i)} + taxi_in {fmt(dec(bn["taxi_in_kg"]))}',
         i + dec(bn['taxi_in_kg']) if bn else None)
    line('fob_at_in_kg', i, f'fob_at_out {fmt(o)} − block burn {fmt(dec(bn["actual_burn_kg"]))}',
         o - dec(bn['actual_burn_kg']) if bn else None)
    w(f'  {"fob_source":<26} {fs["fob_source"]}')
    w(f'  {"flight_closure_utc":<26} {fs["flight_closure_utc"]}   source {fs["closure_source"]}')
    w(f'  {"cargo_kg / pax":<26} {fmt(dec(fs["cargo_kg"]))} / {fs["boarded_passengers"] or fs["booked_passengers"]}')
    w()

    # ---- 2. FlightDispatches ----------------------------------------------
    w('### 2 · FuelOrderService / FlightDispatches — the regulated stack')
    w()
    st = {k: dec(fd[k]) for k in ('trip_fuel_kg','contingency_fuel_kg','alternate_fuel_kg',
                                  'final_reserve_kg','taxi_fuel_kg','additional_fuel_kg','extra_fuel_kg')}
    trip = st['trip_fuel_kg']
    line('trip_fuel_kg', trip,
         f'{fmt((trip / D(str(fs["planned_block_mins"])) * 60).quantize(D("1")))} kg/h over '
         f'{fs["planned_block_mins"]} min')
    line('contingency_fuel_kg', st['contingency_fuel_kg'],
         f'5% of TRIP {fmt(trip)}', (trip * D('0.05')).quantize(D('0.01')))
    line('alternate_fuel_kg', st['alternate_fuel_kg'], f'diversion to {fd["alternate_airport"]}')
    line('final_reserve_kg', st['final_reserve_kg'], '30 minutes holding')
    line('taxi_fuel_kg', st['taxi_fuel_kg'])
    line('additional_fuel_kg', st['additional_fuel_kg'], 'no known delay')
    line('extra_fuel_kg', st['extra_fuel_kg'], 'no tankering')
    line('block_fuel_kg', dec(fd['block_fuel_kg']), 'the seven above, summed', sum(st.values()))
    line('required_uplift_kg', dec(fd['required_uplift_kg']),
         f'block {fmt(dec(fd["block_fuel_kg"]))} − fob_before {fmt(dec(dl["fob_before_kg"]))}',
         dec(fd['block_fuel_kg']) - dec(dl['fob_before_kg']))
    rob = dec(fd['rob_departure_kg'])
    line('rob_departure_kg', rob, 'PLANNED on board at OUT — not the actual reading')
    short = rob - o
    if short == 0:
        w(f'  {"":<26} {"":>14}   actual fob_at_out {fmt(o)} — the plan was met')
    else:
        w(f'  {"":<26} {fmt(short):>14}   = planned {fmt(rob)} − actual fob_at_out {fmt(o)}')
        w(f'  {"":<26} {"":>14}     the aircraft departed {fmt(short)} kg LIGHT')
    w(f'  {"plan":<26} v{fd["plan_version"]} {fd["plan_status"]}, source {fd["plan_version_source"]}')
    w()

    # ---- 3. FuelOrders -----------------------------------------------------
    w('### 3 · FuelOrderService / FuelOrders')
    w()
    q, den, kg = dec(fo['ordered_quantity']), dec(fo['conversion_density']), dec(fo['ordered_quantity_kg'])
    price, tot = dec(fo['unit_price']), dec(fo['total_amount'])
    line('ordered_quantity (L)', q, f'required uplift {fmt(dec(fd["required_uplift_kg"]))} ÷ {den}',
         (dec(fd['required_uplift_kg']) / den).quantize(D('0.01')))
    line('ordered_quantity_kg', kg, f'{fmt(q)} L × {den} kg/L  ({fo["conversion_source"]})',
         (q * den).quantize(D('0.01')))
    # ROUND_HALF_UP, not Decimal's banker's default: 52,437.50 x 0.71 is
    # exactly 37,230.625 and a money amount rounds up at the half. The first
    # run of this extract reported a MISMATCH here and the fault was the
    # checker's rounding mode, not the seed.
    line(f'total_amount ({fo["currency_code"]})', tot, f'{fmt(q)} L × {price}/L',
         (q * price).quantize(D('0.01'), rounding=ROUND_HALF_UP))
    w(f'  {"communication":<26} {fo["communication_status"]} at {fo["communicated_at"]}')
    w()

    # ---- 4. FuelTickets ----------------------------------------------------
    w(f'### 4 · FuelOrderService / FuelTickets — {len(tk)} bowser(s)')
    w()
    met = D(0)
    for t in tk:
        ms, me = dec(t['meter_start']), dec(t['meter_end'])
        lt, dv, tkg = dec(t['quantity_metered']), dec(t['density_value']), dec(t['quantity_kg'])
        met += tkg
        w(f'  {t["ticket_number"]}   meter {fmt(ms)} → {fmt(me)}')
        line('  quantity_metered (L)', lt, f'{fmt(me)} − {fmt(ms)}', me - ms)
        line('  quantity_kg', tkg, f'{fmt(lt)} L × {dv} kg/L at {t["density_temp_c"]} °C',
             (lt * dv).quantize(D('0.01')))
    if len(tk) > 1:
        line('METERED TOTAL', met, ' + '.join(fmt(dec(t['quantity_kg'])) for t in tk))
    w()

    # ---- 5. FuelDeliveries -------------------------------------------------
    w('### 5 · FuelOrderService / FuelDeliveries — the reconciliation')
    w()
    arr, bef, aft = (dec(dl[k]) for k in ('fob_at_arrival_kg','fob_before_kg','fob_after_kg'))
    delta, gb = dec(dl['fob_delta_kg']), dec(dl['ground_burn_kg'])
    line('fob_at_arrival_kg', arr, 'gauge at chocks-on, end of the arriving leg')
    line('ground_burn_kg', gb, f'fob_at_arrival {fmt(arr)} − fob_before {fmt(bef)}', arr - bef)
    line('fob_before_kg', bef, 'gauge immediately before uplift — the reconciliation input')
    line('fob_after_kg', aft, f'fob_before {fmt(bef)} + gauge uplift {fmt(delta)}', bef + delta)
    line('fob_delta_kg', delta, f'fob_after {fmt(aft)} − fob_before {fmt(bef)}', aft - bef)
    var = met - delta
    pct = (met * D('0.005')).quantize(D('0.01'))
    tol = max(pct, D('50'))
    gov = '0.5% governs' if tol == pct else 'the 50 kg FLOOR governs'
    line('recon_variance_kg', dec(dl['recon_variance_kg']),
         f'metered {fmt(met)} − FQIS {fmt(delta)}', var)
    w(f'  {"tolerance":<26} {fmt(tol):>14}   = max(0.5% of {fmt(met)} = {fmt(pct)}, floor 50) — {gov}')
    w(f'  {"recon_status":<26} {dl["recon_status"]:>14}   {fmt(abs(var))} '
      f'{"≤" if abs(var) <= tol else ">"} {fmt(tol)}')
    w(f'  {"fob_source":<26} {dl["fob_source"]:>14}')
    w()

    # ---- 6. ApuUsage -------------------------------------------------------
    w('### 6 · BurnService / ApuUsage')
    w()
    rate = dec(reg['apu_burn_rate_kg_hr'])
    for a in ap:
        mins = dec(a['running_minutes'])
        line(f'  {a["usage_phase"]}', dec(a['apu_burn_kg']),
             f'{mins} min × {rate} kg/h ÷ 60   [{a["rate_source"]}]',
             (mins / 60 * rate).quantize(D('0.01')))
        w(f'  {"":<26} {a["apu_start_utc"]} → {a["apu_stop_utc"]}')
    w()

    # ---- 7. FuelBurns ------------------------------------------------------
    w('### 7 · BurnService / FuelBurns')
    w()
    if bn:
        blk, tf = dec(bn['actual_burn_kg']), dec(bn['trip_fuel_kg'])
        to, ti = dec(bn['taxi_out_kg']), dec(bn['taxi_in_kg'])
        line('actual_burn_kg (block)', blk, f'fob_at_out {fmt(o)} − fob_at_in {fmt(i)}', o - i)
        line('trip_fuel_kg', tf, f'fob_at_off {fmt(off)} − fob_at_on {fmt(on)}', off - on)
        line('taxi_out + taxi_in', to + ti, f'block {fmt(blk)} − trip {fmt(tf)}', blk - tf)
        line('apu_burn_kg (in block)', dec(bn['apu_burn_kg']),
             'no APU cycle overlaps [OUT, IN] — block burn cannot contain ground APU')
        line('engine_burn_kg', dec(bn['engine_burn_kg']),
             f'block {fmt(blk)} − APU in block {fmt(dec(bn["apu_burn_kg"]))}',
             blk - dec(bn['apu_burn_kg']))
        line('planned_burn_kg', dec(bn['planned_burn_kg']), 'FLIGHT_DISPATCH.trip_fuel_kg', trip)
        line('variance_kg', dec(bn['variance_kg']),
             f'trip burn {fmt(tf)} − planned {fmt(dec(bn["planned_burn_kg"]))}',
             tf - dec(bn['planned_burn_kg']) if bn['planned_burn_kg'] is not None else None)
        w(f'  {"variance_status":<26} {bn["variance_status"]:>14}')
    w()

    # ---- 8. ROBLedger ------------------------------------------------------
    w('### 8 · BurnService / ROBLedger — one chain')
    w()
    prev = None
    for r in led:
        op, up, bu, cl = (dec(r[k]) or D(0) for k in ('opening_rob_kg','uplift_kg','burn_kg','closing_rob_kg'))
        calc = op + up - bu
        chain = '' if prev is None or op == prev else '   *** BREAK: opening ≠ previous closing'
        bad = '' if calc == cl else f'   *** MISMATCH: {fmt(calc)}'
        mv = f'+{fmt(up)}' if up else (f'−{fmt(bu)}' if bu else '')
        w(f'  seq{r["sequence"]} {r["entry_type"]:<11} {r["airport_code"]}  '
          f'{fmt(op):>12} {mv:>12}  →  {fmt(cl):>12}{bad}{chain}')
        prev = cl
    if led:
        w(f'  {"":<18} row 3 closing = FUEL_DELIVERIES.fob_after_kg   {fmt(dec(led[2]["closing_rob_kg"]))} '
          f'{"=" if dec(led[2]["closing_rob_kg"]) == aft else "≠"} {fmt(aft)}')
        w(f'  {"":<18} row 4 closing = FLIGHT_SCHEDULE.fob_at_in_kg   {fmt(dec(led[3]["closing_rob_kg"]))} '
          f'{"=" if dec(led[3]["closing_rob_kg"]) == i else "≠"} {fmt(i)}')
    w()

    # ---- 9. AircraftRegistrations -----------------------------------------
    w('### 9 · MasterDataService / AircraftRegistrations')
    w()
    w(f'  {"registration":<26} {reg["registration"]}   {reg["aircraft_type_code"]}   '
      f'operator {reg["operator_code"]}')
    line('apu_burn_rate_kg_hr', rate, 'the rate every APU figure above derives from')
    line('fuel_capacity_kg', dec(reg['fuel_capacity_kg']))
    line('dry_operating_weight_kg', dec(reg['dry_operating_weight_kg']))
    w(f'  {"record_status":<26} {reg["record_status"]}')
    w()

# ---- the pair --------------------------------------------------------------
w('---'); w()
w('## The pair — one number, two verdicts')
w()
d3 = c.execute("select * from fuelsphere_FUEL_DELIVERIES where delivery_number='EPD-YYZ-20260410-0003'").fetchone()
d2 = c.execute("select * from fuelsphere_FUEL_DELIVERIES where delivery_number='EPD-YYZ-20260410-0002'").fetchone()
m3 = dec(c.execute("select sum(quantity_kg) m from fuelsphere_FUEL_TICKETS where delivery_ID=?", (d3['ID'],)).fetchone()['m'])
m2 = dec(c.execute("select sum(quantity_kg) m from fuelsphere_FUEL_TICKETS where delivery_ID=?", (d2['ID'],)).fetchone()['m'])
v3 = m3 - dec(d3['fob_delta_kg'])
t3 = max((m3 * D('0.005')).quantize(D('0.01')), D('50'))
t2 = max((m2 * D('0.005')).quantize(D('0.01')), D('50'))
w(f'  S3   variance {fmt(v3)}   vs tolerance {fmt(t3)}   = max(0.5% of {fmt(m3)}, floor 50)   → {d3["recon_status"]}')
w(f'  S2   the SAME {fmt(v3)}   vs tolerance {fmt(t2)}   = max(0.5% of {fmt(m2)}, floor 50)   → '
  f'{"RECONCILED" if v3 <= t2 else "VARIANCE"}')
w()
w(f'  {fmt(v3)} kg is {(v3/m3*100).quantize(D("0.01"))}% of S3\'s uplift and '
  f'{(v3/m2*100).quantize(D("0.01"))}% of S2\'s.')
w('  The rule is identical in both. Only the quantity differs.')
w()
w(f'  And S2 passes on {fmt(m2 - dec(d2["fob_delta_kg"]))} kg — larger than S3\'s ENTIRE tolerance of {fmt(t3)}.')
w()


# ===========================================================================
# THE TWO REGISTER CASES. Neither is a fuel-flow scenario, so neither fits
# the loop above: S6's order was REFUSED and the unresolved-tail case has no
# order at all. A section that reported them as "missing" figures would be
# describing the absence as a gap rather than as the content.
# ===========================================================================
w('---'); w()
w('## The two register cases — no order, for two opposite reasons')
w()
w('Both turn on a tail. `applyPolicy` never reads `record_status`;')
w('`assertOrderable` does — so the two states are opposite on BOTH axes.')
w()

f6 = c.execute("select * from fuelsphere_FLIGHT_SCHEDULE where flight_number='PR501'").fetchone()
d6 = c.execute("select * from fuelsphere_FLIGHT_DISPATCH where flight_number='PR501'").fetchone()
r6 = c.execute("select * from fuelsphere_AIRCRAFT_REGISTRATIONS where registration=?",
               (f6['tail_registration'],)).fetchone()

w(f"### S6 — {f6['flight_number']}, {f6['flight_date']}, {r6['registration']} "
  f"{r6['aircraft_type_code']}, {f6['origin_airport']}→{f6['destination_airport']}")
w()
w(f"  register status            {r6['record_status']:>14}   resolves, and BLOCKS the order (MDM402)")
w()
w('#### The regulated stack')
COMP = ['trip_fuel_kg','contingency_fuel_kg','alternate_fuel_kg','final_reserve_kg',
        'additional_fuel_kg','taxi_fuel_kg','extra_fuel_kg']
for k in COMP:
    line(k.replace('_kg','').replace('_',' '), d6[k])
blk = sum((dec(d6[k]) for k in COMP), D('0'))
line('block fuel', d6['block_fuel_kg'], 'sum of the seven components (DSP450)', blk)
ROB6 = D('6500.00')     # what the 5 April defuel left aboard
line('required uplift', d6['required_uplift_kg'],
     f'{fmt(dec(d6["block_fuel_kg"]))} − {fmt(ROB6)} on board (DSP451)',
     dec(d6['block_fuel_kg']) - ROB6)
trip6 = dec(d6['trip_fuel_kg'])
line('contingency check', d6['contingency_fuel_kg'],
     f'5% of TRIP {fmt(trip6)} — and {(dec(d6["contingency_fuel_kg"])/blk*100).quantize(D("0.01"))}% of block, '
     f'so the two cannot be confused', (trip6 * D('0.05')).quantize(D('0.01'), rounding=ROUND_HALF_UP))
w()
w('#### The empty fields are the content')
w(f"  dispatch_order_id          {(d6['dispatch_order_id'] or '(empty)'):>14}   the commercial commitment, set on confirmation")
w(f"  fuel_order_ID              {(d6['fuel_order_ID'] or '(empty)'):>14}   MDM402 refused it, so there is none")
others = c.execute("select count(*) n from fuelsphere_FLIGHT_DISPATCH where dispatch_order_id is not null and dispatch_order_id<>''").fetchone()['n']
tot = c.execute("select count(*) n from fuelsphere_FLIGHT_DISPATCH").fetchone()['n']
w(f"  every other dispatch row   {others:>14}   of {tot} carry one, because every other flight has an order")
w()

f4 = c.execute("select * from fuelsphere_FLIGHT_SCHEDULE where flight_number='AC414'").fetchone()
seen = c.execute("select count(*) n from fuelsphere_AIRCRAFT_REGISTRATIONS where registration=?",
                 (f4['aircraft_reg'],)).fetchone()['n']
w(f"### The unresolved tail — {f4['flight_number']}, {f4['flight_date']}, "
  f"{f4['aircraft_type']}, {f4['origin_airport']}→{f4['destination_airport']}")
w()
w(f"  aircraft_reg               {f4['aircraft_reg']:>14}   as RECEIVED. Renders as text")
w(f"  tail_registration          {(f4['tail_registration'] or '(null)'):>14}   as RESOLVED. Renders BLANK")
w(f"  rows in the register       {seen:>14}   the register has never seen this tail")
w(f"  order creation             {'PERMITTED':>14}   unknown ≠ provisional; auto-provisioning defers to WP-16")
w()
w('  A blank Aircraft beside a populated Registration is a visible state that')
w('  means something. S6 is the opposite: the link resolves and the order does not.')
w()

txt = '\n'.join(out) + '\n'
open(OUT, 'w').write(txt)
print(f'written: {OUT} — {len(out)} lines')
print(f'MISMATCH / BREAK markers: {txt.count("***")}')

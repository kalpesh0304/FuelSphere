"""
The seventeen demo scenarios, applied to one airline's working set.

Every scenario returns THREE references and says, per reference, what was
seeded and what the system is expected to do with it. Where the current
schema cannot hold what a scenario needs, the rows go to a PROPOSED sheet
instead of the loadable ones, and the scenario says so.
"""
import copy
import datetime as dt
from common import uid, f2, f3, f4, num, h, ts, parse_ts

GL = {
    # role: (B6 account, TP account, description, placeholder?)
    'UPLIFT':          ('600780', '610100', 'Fuel expense - uplift into plane', None),
    'GRIR':            ('211100', '211100', 'GR/IR clearing - fuel and fuel services', True),
    'VENDOR':          ('200000', '200000', 'Accounts payable reconciliation - fuel vendors', True),
    'UNBURNT_FUEL':    ('160100', '160100', 'Unburnt fuel on board - deferred fuel burn (balance sheet)', True),
    'COMP_INTO_PLANE': ('600782', '610110', 'Fuel expense component - into-plane fee', True),
    'COMP_THROUGHPUT': ('600783', '610120', 'Fuel expense component - airport throughput / hydrant fee', True),
    'COMP_TAX':        ('600784', '610130', 'Fuel expense component - non-recoverable fuel taxes and duties', True),
    'DEFUEL_SERVICE':  ('600785', '610140', 'Defuel service charges', True),
    'FUEL_WRITE_OFF':  ('600786', '610150', 'Fuel write-off - disposal of defueled fuel', True),
    'FUEL_EXP_ADJ':    ('600787', '610160', 'Fuel expense adjustment - defuel returned', True),
    'EXPECTED_CREDIT': ('141900', '141900', 'Expected credit from fuel vendors (clearing)', True),
    'MAINT_FUEL':      ('600788', '610170', 'Fuel consumed in maintenance (engine runs, leak checks)', True),
}


class Ctx:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def acct(ctx, role):
    a = GL[role]
    return a[0] if ctx.code == 'B6' else a[1]


class Engine:
    def __init__(self, D, ctx, tagger):
        self.D, self.c, self.tg = D, ctx, tagger
        self.used_flights, self.used_invoices, self.used_tickets = set(), set(), set()
        self.po, self.gr = ctx.po_start, ctx.gr_start
        self.results = []
        self.refs = {}

    # ------------------------------------------------------------ utilities
    @property
    def T(self):
        return self.D.t

    def S(self, sid):
        return f'S{sid:02d}'

    def tag(self, sid, entity, key, role):
        self.tg.tag(self.S(sid) if isinstance(sid, int) else sid, entity, key, role)

    def mine(self, f):
        return f and f['airline_code'] == self.c.code

    def flight_of(self, t):
        f = self.T['FLIGHT_SCHEDULE'].get(t.get('flight_ID')) if t.get('flight_ID') else None
        if not f and t.get('order_ID'):
            o = self.T['FUEL_ORDERS'].get(t['order_ID'])
            f = self.T['FLIGHT_SCHEDULE'].get(o['flight_ID']) if o and o['flight_ID'] else None
        return f

    def ref(self, label, t=None, inv=None, f=None, extra=None, seeded='', expected=''):
        f = f or (self.flight_of(t) if t else None)
        r = {'ref': label,
             'flight': f"{f['flight_number']} / {f['flight_date']} {f['origin_airport']}-{f['destination_airport']}" if f else '',
             'tail': (t or {}).get('aircraft_reg') or (f or {}).get('aircraft_reg', ''),
             'ticket': (t or {}).get('ticket_number', ''),
             'invoice': (inv or {}).get('invoice_number', ''),
             'other': extra or '', 'seeded': seeded, 'expected': expected}
        return r

    def is_clean_invoice(self, inv):
        if not inv or inv['ID'] in self.used_invoices:
            return False
        if inv['invoice_number'].startswith('ITP-'):
            return False
        if self.c.code == 'B6':
            return inv['status'] == 'VERIFIED' and inv['posting_gate'] == 'CLEAR' and \
                   inv['created_by'] == 'SEED_B6_ADSB'
        return inv['status'] == 'SUBMITTED' and inv['created_by'].startswith('SEED_TP')

    def fuel_lines(self, inv):
        return [i for i in self.D.items_of(inv['ID']) if (i['charge_type'] or 'FUEL') == 'FUEL']

    def clean_invoices(self, min_lines, max_lines=10 ** 6, exclude_agent_stations=False):
        out = []
        for inv in self.T['INVOICES'].rows:
            if not self.is_clean_invoice(inv):
                continue
            lines = self.fuel_lines(inv)
            if not (min_lines <= len(lines) <= max_lines):
                continue
            if exclude_agent_stations and any(self.lines_have_agent(lines)):
                continue
            out.append((inv, lines))
        out.sort(key=lambda p: h(self.c.code, p[0]['invoice_number']))
        return out

    def lines_have_agent(self, lines):
        for it in lines:
            yield bool(self.D.lines_by_ticket.get(it['ticket_ID']) and
                       len([x for x in self.D.lines_by_ticket[it['ticket_ID']] if x['charge_type'] == 'INTO_PLANE']))

    def pick_sources(self, n, k, distinct_supplier=True, **kw):
        """n source invoices, each with at least k clean single-ticket lines."""
        picked, sups = [], set()
        for inv, lines in self.clean_invoices(k + 2, **kw):
            if distinct_supplier and inv['supplier_ID'] in sups:
                continue
            good = [i for i in lines if i['ticket_ID'] and i['ticket_ID'] not in self.used_tickets
                    and len([x for x in self.D.lines_by_ticket[i['ticket_ID']] if x['charge_type'] == 'FUEL']) == 1]
            if len(good) < k:
                continue
            picked.append((inv, good[:k]))
            sups.add(inv['supplier_ID'])
            self.used_invoices.add(inv['ID'])
            for i in good[:k]:
                self.used_tickets.add(i['ticket_ID'])
            if len(picked) == n:
                return picked
        raise RuntimeError(f'not enough source invoices for {n}x{k}')

    def carve(self, sid, inv, lines, tag, notes, date=None):
        base = inv['invoice_number'].rsplit('-', 1)[0]
        number = f'{base}-{tag}'
        internal = f"{inv['internal_number']}-{tag}"[:30]
        new = self.D.carve(inv, lines, number, internal, self.c.by, self.c.stamp, notes, invoice_date=date)
        self.used_invoices.add(new['ID'])
        self.tag(sid, 'INVOICES', new['ID'], f'scenario invoice {number}')
        self.tag(sid, 'INVOICES', inv['ID'], f'source invoice {inv["invoice_number"]} restated (lines moved out)')
        for it in lines:
            self.tag(sid, 'INVOICE_ITEMS', it['ID'], 'moved to scenario invoice')
        return new

    def ticket(self, it):
        return self.T['FUEL_TICKETS'].get(it['ticket_ID'])

    def next_po(self):
        self.po += 1
        return str(self.po)

    def next_gr(self):
        self.gr += 1
        return str(self.gr)

    def add_journal(self, sid, sub, ref, lines, basis):
        for n, (role, dr, cr, text) in enumerate(lines, 1):
            self.D.journal.append({
                'scenario': f'S17{sub}', 'source_scenario': self.S(sid) if sid else '', 'reference': ref,
                'step': n, 'gl_account': acct(self.c, role), 'account_role': role, 'account_name': GL[role][2],
                'placeholder_account': 'YES' if GL[role][3] else 'NO (given by the functional consultant)',
                'debit': f2(dr) if dr else '', 'credit': f2(cr) if cr else '', 'currency': self.c.ccy_of(ref),
                'text': text, 'basis': basis})

    # ================================================================ S1
    def s01(self):
        refs = []
        for (inv, lines), label in zip(self.pick_sources(3, 1, exclude_agent_stations=False), 'ABC'):
            t = self.ticket(lines[0])
            refs.append(self.ref(label, t, inv, extra=f"{len(self.fuel_lines(inv))} lines, {inv['currency_code']} {inv['gross_amount']}",
                                 seeded='Unchanged clean invoice: every line resolves to exactly one ticket at the ticket quantity and the order price.',
                                 expected=('Already validated: posting gate CLEAR, auto-approved. Post to S/4 is available.'
                                           if self.c.code == 'B6' else
                                           'Press Validate: every check PASSED or NOT_APPLICABLE, posting gate CLEAR, three-way match within tolerance. Then Post to S/4.')))
            self.tag(1, 'INVOICES', inv['ID'], 'clean invoice')
        self.refs[1] = refs
        return refs

    # ================================================================ S2
    def s02(self):
        refs = []
        rungs = [(0.6, 'WARNING rung (0.25-1%): INV452 raised as WARNING. Not gating - the invoice still posts.'),
                 (1.8, 'SOFT rung (1-3%): INV452 SOFT_ERROR. Gate GATED; an approver may bypass it with a reason.'),
                 (4.5, 'HARD rung (>3%): INV452 HARD_ERROR. Gate GATED, not bypassable. Dispute with the supplier.')]
        for (inv, lines), label, (pct, exp) in zip(self.pick_sources(3, 2), 'ABC', rungs):
            it = lines[0]
            p0 = num(it['unit_price'])
            self.D.set_line(it, price=round(p0 * (1 + pct / 100), 4))
            self.D.set_line(lines[1])
            new = self.carve(2, inv, lines, f'P{label}',
                             f'SCENARIO 2 - price mismatch. Line 10 billed at {it["unit_price"]} against the order price '
                             f'{f4(p0)} (+{pct}%). Line 20 is correct. Not validated: press Validate.')
            t = self.ticket(it)
            refs.append(self.ref(label, t, new, extra=f'line 10: {f4(p0)} -> {it["unit_price"]} (+{pct}%)',
                                 seeded=f'Line 10 unit price raised {pct}% above the order price; line 20 unchanged.',
                                 expected=exp))
        self.refs[2] = refs
        return refs

    # ================================================================ S3
    def s03(self):
        c = self.c
        refs = []
        # One station, one supplier, three different flights.
        cands = {}
        for inv, lines in self.clean_invoices(5):
            if self.c.code == 'TP' and not inv['invoice_number'].split('-')[1] in c.component_stations:
                continue
            if self.c.code == 'B6' and inv['supplier_ID'] in c.suppliers_with_formula:
                continue
            good = [i for i in lines if i['ticket_ID'] not in self.used_tickets]
            if len(good) >= 3:
                cands[inv['ID']] = (inv, good)
        inv, good = sorted(cands.values(), key=lambda p: (p[0]['invoice_number'].split('-')[1] not in c.component_stations,
                                                          h(p[0]['invoice_number'])))[0]
        lines = good[:3]
        for i in lines:
            self.used_tickets.add(i['ticket_ID'])
        self.used_invoices.add(inv['ID'])
        o0 = self.T['FUEL_ORDERS'].get(lines[0]['fuel_order_ID'])
        stn = o0['station_code']
        old_contract = self.T['MASTER_CONTRACTS'].get(o0['contract_ID'])
        cur = old_contract['currency_code']
        pfx = inv['invoice_number'].split('-')[0]
        cnum = f'{c.code}-{pfx}-2026-CMP'
        cid = uid(c.code, 'CON', cnum)
        self.T['MASTER_CONTRACTS'].add({**old_contract, 'ID': cid, 'contract_number': cnum,
                                        'contract_name': f'{old_contract["contract_name"]} - component-priced (scenario 3)',
                                        's4_contract_number': c.cmp_s4_contract, 'created_by': c.by,
                                        'modified_by': c.by, 'created_at': c.stamp, 'modified_at': c.stamp})
        self.tag(3, 'MASTER_CONTRACTS', cid, 'dedicated component-priced contract')
        cl = {'ID': uid(c.code, 'CL', cid, stn), 'contract_ID': cid, 'airport_ID': o0['airport_ID'], 'plant_code': '',
              'location_type': 'PRIMARY', 'location_premium': '0.0000', 'priority': '2', 'valid_from': '2026-01-01',
              'valid_to': '', 'is_active': 'true', 'created_at': c.stamp, 'created_by': c.by, 'modified_at': c.stamp,
              'modified_by': c.by}
        self.T['CONTRACT_LOCATIONS'].add(cl)
        self.T['CONTRACT_PRODUCTS'].add({'ID': uid(c.code, 'CP', cid), 'contract_ID': cid, 'product_ID': o0['product_ID'],
                                         'product_premium': '0.0000', 'min_quantity': '500.00', 'max_quantity': '500000.00',
                                         'is_default': 'true', 'is_active': 'true', 'created_at': c.stamp,
                                         'created_by': c.by, 'modified_at': c.stamp, 'modified_by': c.by})
        # The formula: index + three fixed components, per litre.
        comps = c.components
        fixed = sum(v for _, _, v in comps[1:])
        idx_id = uid(c.code, 'IDX', c.index_code)
        self.T['MARKET_INDICES'].add({
            'ID': idx_id, 'index_code': c.index_code, 'index_name': c.index_name,
            'index_description': 'SAMPLE index authored for the price-components demo. Not a market assessment.',
            'provider': 'PLATTS', 'provider_reference': 'SAMPLE', 'index_type': c.index_type, 'product_type': 'JET_A1',
            'region': c.index_region, 'currency_ID': cur, 'uom_ID': 'LTR', 'frequency': 'DAILY',
            'publication_time': '16:30:00', 'timezone': 'Europe/London', 'publication_lag_days': '0',
            'import_enabled': 'false', 'requires_verification': 'false', 'min_expected_value': '0.5000',
            'max_expected_value': '2.0000', 'max_daily_change_pct': '5.00', 'is_active': 'true',
            'created_at': c.stamp, 'created_by': c.by, 'modified_at': c.stamp, 'modified_by': c.by})
        self.tag(3, 'MARKET_INDICES', idx_id, 'sample index')
        target = num(o0['unit_price']) - fixed
        prev = None
        d0 = dt.date.fromisoformat(c.window[0]) - dt.timedelta(days=6)
        for i in range(12):
            day = (d0 + dt.timedelta(days=i)).isoformat()
            v = round(target + ((h('iv', c.code, day) % 61) - 30) / 10000.0, 4)
            vid = uid(c.code, 'IDXV', day)
            self.T['MARKET_INDEX_VALUES'].add({
                'ID': vid, 'market_index_ID': idx_id, 'effective_date': day, 'index_value': f4(v),
                'previous_value': f4(prev) if prev else '', 'daily_change': f4(v - prev) if prev else '',
                'daily_change_pct': f2((v - prev) / prev * 100) if prev else '',
                'import_source': f'SAMPLE-{c.index_code}', 'import_batch_id': f'BATCH-{day.replace("-", "")}-SAMPLE',
                'imported_at': f'{day}T20:00:00Z', 'imported_by': 'demo.seed@airline.com',
                'verification_status': 'UNVERIFIED',
                'verification_notes': 'SAMPLE DATA, NOT A MARKET ASSESSMENT. Authored for the price-components demo. '
                                      'Do not cite, invoice or settle against it.',
                'is_estimated': 'true', 'is_holiday': 'false', 'is_corrected': 'false', 'is_current': 'true',
                'created_at': f'{day}T20:00:00Z', 'created_by': c.by, 'modified_at': f'{day}T20:00:00Z',
                'modified_by': c.by})
            prev = v
        fid = uid(c.code, 'FRM', c.formula_id)
        sup = old_contract['supplier_ID']
        self.T['PRICING_FORMULAS'].add({
            'ID': fid, 'formula_id': c.formula_id, 'formula_name': f'{pfx} {stn} component-priced Jet fuel (scenario 3)',
            'formula_description': 'Index + supplier differential + into-plane fee + airport throughput fee, per litre.',
            'formula_type': 'INDEX_LINKED', 'base_index_type': c.index_type, 'currency_ID': cur, 'uom_ID': 'LTR',
            'valid_from': '2026-01-01', 'valid_to': '2026-12-31', 'version': '1', 'status': 'ACTIVE',
            'requires_approval': 'true', 'requested_by': 'pricing.analyst@airline.com', 'requested_at': c.stamp,
            'approved_by': 'pricing.admin@airline.com', 'approved_at': c.stamp, 'company_code': '',
            'supplier_id': sup, 'created_at': c.stamp, 'created_by': c.by, 'modified_at': c.stamp, 'modified_by': c.by})
        self.tag(3, 'PRICING_FORMULAS', fid, 'formula')
        for n, (name, ctype, val) in enumerate(comps, 1):
            cpid = uid(c.code, 'FC', c.formula_id, n)
            self.T['FORMULA_COMPONENTS'].add({
                'ID': cpid, 'formula_ID': fid, 'sequence': str(n), 'component_name': name,
                'component_description': name, 'component_type': ctype,
                'calculation_type': 'LOOKUP' if ctype == 'BASE_INDEX' else 'FIXED',
                'fixed_value': '' if ctype == 'BASE_INDEX' else f4(val),
                'lookup_index_ID': idx_id if ctype == 'BASE_INDEX' else '', 'index_offset_days': '0',
                'missing_quote_policy': 'PRIOR_PUBLISHED', 'use_average': 'false', 'average_days': '5',
                'apply_to': 'BASE' if ctype == 'BASE_INDEX' else 'CUMULATIVE',
                'component_currency_currency_code': cur, 'is_active': 'true', 'created_at': c.stamp,
                'created_by': c.by, 'modified_at': c.stamp, 'modified_by': c.by})
        names = [n for n, _, _ in comps]
        variants = [
            ('A', ' + '.join(names), 'Names all four contract components. Expected after Derive Price: INV471 PASSED, INV472 PASSED.'),
            ('B', ' + '.join(names[:3]), f'Omits "{names[3]}". Expected: INV472 WARNING "contract component absent". Not gating.'),
            ('C', 'all-in delivered price', 'Names no contract component. Expected: INV471 SOFT_ERROR "charge with no contract component". Gated, bypassable.'),
        ]
        for it, (label, suffix, exp) in zip(lines, variants):
            o = self.T['FUEL_ORDERS'].get(it['fuel_order_ID'])
            o['contract_ID'] = cid
            self.tag(3, 'FUEL_ORDERS', o['ID'], 'repointed to the component-priced contract')
            it['description'] = f"{it['description']} | {suffix}"[:200]
            new = self.carve(3, inv, [it], f'C{label}',
                             f'SCENARIO 3 - price components. The order is on contract {cnum}, whose formula '
                             f'{c.formula_id} prices {", ".join(names)}. Run Derive Price on the contract first, then Validate.')
            refs.append(self.ref(label, self.ticket(it), new, extra=f'contract {cnum}, formula {c.formula_id}',
                                 seeded=f'Line description: "...| {suffix}"', expected=exp))
        self.cmp = {'contract': cnum, 'formula': c.formula_id, 'components': comps, 'lines': lines, 'cur': cur}
        self.refs[3] = refs
        return refs

    # ================================================================ S4
    def s04(self):
        refs = []
        rungs = [(-1.5, 'INV451 WARNING (0.5-2%). Short-billed, so INV467 does not fire. Not gating - the invoice posts.'),
                 (-3.5, 'INV451 SOFT_ERROR (2-5%). Gated; bypassable with a reason.'),
                 (6.0, 'INV451 HARD_ERROR (>5%) and INV467 SOFT_ERROR (more invoiced than ordered). Gated, not bypassable.')]
        for (inv, lines), label, (pct, exp) in zip(self.pick_sources(3, 2), 'ABC', rungs):
            it = lines[0]
            q0 = num(it['quantity'])
            self.D.set_line(it, qty=round(q0 * (1 + pct / 100), 0))
            self.D.set_line(lines[1])
            new = self.carve(4, inv, lines, f'Q{label}',
                             f'SCENARIO 4 - quantity mismatch. Line 10 bills {it["quantity"]} L against the ticket and '
                             f'goods receipt of {f3(q0)} L ({pct:+}%). Line 20 is correct. Press Validate.')
            refs.append(self.ref(label, self.ticket(it), new, extra=f'line 10: {f3(q0)} L -> {it["quantity"]} L ({pct:+}%)',
                                 seeded=f'Line 10 quantity changed by {pct:+}% against the ticket; price unchanged.',
                                 expected=exp))
        self.refs[4] = refs
        return refs

    # ================================================================ S5
    def s05(self):
        refs = []
        itp = sorted([i for i in self.T['INVOICES'].rows if i['invoice_number'].startswith('ITP-')
                      and i['supplier_ID'] and self.D.items_of(i['ID'])
                      and self.mine(self.flight_of(self.ticket(self.D.items_of(i['ID'])[0]) or {}))],
                     key=lambda i: i['invoice_number'])
        chosen, agents = [], set()
        for inv in itp:
            if inv['supplier_ID'] in agents and len(agents) < 2:
                continue
            chosen.append(inv)
            agents.add(inv['supplier_ID'])
            if len(chosen) == 3:
                break
        for inv, label in zip(chosen, 'ABC'):
            it = next(i for i in self.D.items_of(inv['ID']) if i['ticket_ID'] not in self.used_tickets)
            self.used_tickets.add(it['ticket_ID'])
            t = self.ticket(it)
            fuel = [x for x in self.D.lines_by_ticket[t['ID']] if x['charge_type'] == 'FUEL']
            finv = self.T['INVOICES'].get(fuel[0]['invoice_ID']) if fuel else None
            self.tag(5, 'INVOICES', inv['ID'], 'into-plane invoice')
            refs.append(self.ref(label, t, inv,
                                 extra=f"rate {it['unit_price']}/L; same ticket billed for fuel on {finv['invoice_number'] if finv else '-'}",
                                 seeded='Agent invoice, one INTO_PLANE line per uplift, against tickets that the supplier also bills for fuel.',
                                 expected='INV455 PASSES (ticket + charge type: fuel and into-plane are two charges). '
                                          'DEFECT TODAY: INV452 compares the into-plane rate with the FUEL order price and '
                                          'fails HARD on every line, so the invoice stays GATED. Needs the into-plane '
                                          'contract rate as the reference - see Findings.'))
        self.refs[5] = refs
        return refs

    # ================================================================ S6
    def s06(self):
        refs = []
        if self.c.code == 'B6':
            for num_, label in zip(['WFS-FLL-457474', 'CGA-SFO-275626', 'SHL-BOS-696888'], 'ABC'):
                t = next(x for x in self.T['FUEL_TICKETS'].rows if x['ticket_number'] == num_)
                billed = self.D.lines_by_ticket.get(t['ID'], [])
                assert not [x for x in billed if x['charge_type'] == 'FUEL'], num_
                note = ('already in the JetBlue seed; the into-plane agent HAS billed it, the fuel supplier has not'
                        if billed else 'already in the JetBlue seed')
                refs.append(self.ref(label, t, extra=note,
                                     seeded='Ticket with an order and no invoice line (existing seed row, unchanged).',
                                     expected='Unbilled Tickets report: state UNBILLED. INV453 (period-close warning) is '
                                              'registered and NOT implemented, so no invoice carries it.'))
                self.tag(6, 'FUEL_TICKETS', t['ID'], 'unbilled ticket')
        else:
            for (inv, lines), label in zip(self.pick_sources(3, 1, exclude_agent_stations=True), 'ABC'):
                it = lines[0]
                t = self.ticket(it)
                self.T['INVOICE_ITEMS'].rows.remove(it)
                self.T['INVOICE_ITEMS'].reindex()
                for n, x in enumerate(self.D.items_of(inv['ID']), 1):
                    x['line_number'] = str(n * 10)
                self.D.recompute_header(inv)
                self.used_invoices.discard(inv['ID'])
                self.tag(6, 'FUEL_TICKETS', t['ID'], 'unbilled ticket (no invoice line)')
                refs.append(self.ref(label, t, extra=f"supplier invoice {inv['invoice_number']} omits it",
                                     seeded='Ticket left off the supplier invoice that covers the rest of the station.',
                                     expected='Unbilled Tickets report: state UNBILLED, exposure = ticket amount. '
                                              'INV453 is registered and NOT implemented, so nothing warns at period close.'))
        self.refs[6] = refs
        return refs

    # ================================================================ S7
    def s07(self):
        c = self.c
        refs = []
        cands = []
        for inv, lines in self.clean_invoices(6, exclude_agent_stations=True):
            late = [i for i in lines if self.ticket(i)['delivery_timestamp'][:10] == c.window[1]
                    and i['ticket_ID'] not in self.used_tickets]
            if len(late) >= 3:
                cands.append((inv, sorted(late, key=lambda i: self.ticket(i)['delivery_timestamp'])[-3:]))
        inv, lines = cands[0]
        self.used_invoices.add(inv['ID'])
        for it in lines:
            self.used_tickets.add(it['ticket_ID'])
        for n, it in enumerate(lines):
            t = self.ticket(it)
            o = self.T['FUEL_ORDERS'].get(t['order_ID'])
            dl = self.T['FUEL_DELIVERIES'].get(t['delivery_ID'])
            con = self.T['MASTER_CONTRACTS'].get(o['contract_ID'])
            when = f"{c.late_date}T{9 + n:02d}:{15 + 7 * n:02d}:00Z"
            t.update({'created_at': when, 'modified_at': when, 'verified_at': when,
                      's4_posting_status': 'S', 's4_posting_message': 'PO and GR created (mock posting).',
                      's4_posted_at': when, 's4_contract_number': con['s4_contract_number'],
                      's4_po_number': o['s4_po_number'], 's4_po_item': '00010', 's4_po_quantity': t['quantity'],
                      's4_po_unit': 'L', 's4_gr_number': dl['s4_gr_number'], 's4_gr_year': '2026',
                      's4_fi_posting_date': c.late_date})
            dl.update({'created_at': when, 'modified_at': when})
            self.tag(7, 'FUEL_TICKETS', t['ID'], f'captured and posted {c.late_date}, after the {c.close_period} close')
            self.tag(7, 'FUEL_DELIVERIES', dl['ID'], 'captured late')
        new = self.carve(7, inv, lines, 'L1', f'SCENARIO 7 - uplifts flown on {c.window[1]} and captured on '
                                              f'{c.late_date}, after the {c.close_period} close. Invoiced late.',
                         date=c.late_invoice_date)
        for it, label in zip(lines, 'ABC'):
            t = self.ticket(it)
            refs.append(self.ref(label, t, new,
                                 extra=f"flown {t['delivery_timestamp'][:10]}, captured and FI-posted {c.late_date}",
                                 seeded=f'Ticket created {c.late_date}; s4_posting_status S; s4_fi_posting_date {c.late_date} '
                                        f'(period {c.late_date[:7]}) against a {c.close_period} uplift.',
                                 expected=f'FS-to-Finance reconciliation: the value moves out of {c.close_period} and into '
                                          f'{c.late_date[:7]} under "Posting to subsequent period" (signed both ways). '
                                          + c.s07_note))
        self.refs[7] = refs
        return refs

    # ================================================================ S8 / S14 helpers
    def overnight_candidates(self, gap_hours, previous_date=True):
        out = []
        for f in self.T['FLIGHT_SCHEDULE'].rows:
            if not self.mine(f) or f['ID'] in self.used_flights:
                continue
            o = self.D.order_by_flight.get(f['ID'])
            t = self.D.ticket_by_order.get(o['ID']) if o else None
            if not t or t['ID'] in self.used_tickets or len(self.D.lines_by_ticket.get(t['ID'], [])) != 1:
                continue
            if any(x['charge_type'] == 'INTO_PLANE' for x in self.D.lines_by_ticket[t['ID']]):
                continue
            inv = self.T['INVOICES'].get(self.D.lines_by_ticket[t['ID']][0]['invoice_ID'])
            # A base fuel invoice no other scenario has claimed. S8 and S14
            # reset the verdict of the invoice they touch, so 'clean' would
            # exclude every other line on it.
            if inv['ID'] in self.used_invoices or inv['invoice_number'].startswith('ITP-') or \
                    not inv['created_by'] in ('SEED_B6_ADSB', 'SEED_TP_COMMERCIAL'):
                continue
            if self.D.snapshot and self.D.snapshot['INVOICES'][inv['ID']]['posting_gate'] != 'CLEAR':
                continue    # an invoice the JetBlue seed already put in exception
            prev = self.D.previous_leg(f)
            if not prev or prev['destination_airport'] != f['origin_airport'] or not prev['aibt']:
                continue
            midnight = dt.datetime.fromisoformat(f'{f["flight_date"]}T00:00:00')
            arr = parse_ts(prev['aibt'])
            dep = parse_ts(f['aobt'])
            # One hour after the inbound is on blocks, but not before early
            # evening, and still on the PREVIOUS UTC date.
            refuel = max(arr + dt.timedelta(minutes=60),
                         midnight - dt.timedelta(hours=24 - self.c.evening_hour + 3)).replace(second=0, microsecond=0)
            refuel = refuel.replace(minute=(refuel.minute // 5) * 5)
            if not previous_date:
                # Preflight: on the ground long enough, fuelled an hour after
                # on-blocks, whatever the date.
                refuel = (arr + dt.timedelta(minutes=60)).replace(second=0, microsecond=0)
                refuel = refuel.replace(minute=(refuel.minute // 5) * 5)
                if dt.timedelta(hours=gap_hours) <= dep - refuel <= dt.timedelta(hours=16):
                    out.append((f, o, t, refuel))
                continue
            if refuel < midnight - dt.timedelta(minutes=20) and \
                    dt.timedelta(hours=gap_hours) <= dep - refuel <= dt.timedelta(hours=16) \
                    and dep.date().isoformat() == f['flight_date']:
                out.append((f, o, t, refuel))
        out.sort(key=lambda x: h(self.c.code, x[0]['ID']))
        return out

    def move_uplift(self, t, refuel):
        dl = self.T['FUEL_DELIVERIES'].get(t['delivery_ID'])
        old_s, old_e = parse_ts(dl['refuel_start_utc']), parse_ts(dl['refuel_end_utc'])
        end = refuel + (old_e - old_s)
        dl.update({'delivery_date': refuel.date().isoformat(), 'delivery_time': refuel.strftime('%H:%M:%S'),
                   'refuel_start_utc': ts(refuel), 'refuel_end_utc': ts(end), 'created_at': ts(refuel),
                   'modified_at': ts(end)})
        t.update({'delivery_timestamp': ts(refuel), 'created_at': ts(end), 'modified_at': ts(end),
                  'verified_at': ts(end + dt.timedelta(hours=2))})
        return dl

    # ================================================================ S8
    def s08(self):
        refs = []
        for (f, o, t, refuel), label in zip(self.overnight_candidates(5), 'ABC'):
            self.used_flights.add(f['ID'])
            self.used_tickets.add(t['ID'])
            dl = self.move_uplift(t, refuel)
            t['flight_ID'] = ''
            it = self.D.lines_by_ticket[t['ID']][0]
            it['flight_ID'] = ''
            self.tag(8, 'FUEL_TICKETS', t['ID'], 'fuelled the evening before; flight left off the ticket')
            self.tag(8, 'FUEL_DELIVERIES', dl['ID'], 'moved to the evening before')
            self.tag(8, 'INVOICE_ITEMS', it['ID'], 'flight cleared so Validate re-resolves it')
            inv = self.T['INVOICES'].get(it['invoice_ID'])
            self.D.reset_verdict(inv)
            self.used_invoices.add(inv['ID'])
            self.tag(8, 'INVOICES', inv['ID'], 'verdict reset (a line changed)')
            refs.append(self.ref(label, t, inv, f=f,
                                 extra=f"fuelled {t['delivery_timestamp']} (UTC), flight dated {f['flight_date']}, off-blocks {f['aobt']}",
                                 seeded='Ticket and delivery moved to the previous evening, after the inbound leg '
                                        'arrived. The ticket keeps its order and flight NUMBER; the flight link is cleared.',
                                 expected='Measured: the order still resolves PO and GR and the gate clears. But Validate '
                                          'looks the flight up by flight number + ticket DATE (the evening before). Where '
                                          'that number did not fly the day before, the line is left with NO flight; where '
                                          'it did (a daily flight), the line is attached to the PREVIOUS DAY\'s flight - '
                                          'wrong, although the order names the right one. Finding F12.'))
        self.refs[8] = refs
        return refs

    # ================================================================ S9
    def s09(self):
        refs = []
        multi = []
        for fid, vs in self.D.versions.items():
            f = self.T['FLIGHT_SCHEDULE'].get(fid)
            if not self.mine(f) or fid in self.used_flights or len(vs) < 2:
                continue
            o = self.D.order_by_flight.get(fid)
            t = self.D.ticket_by_order.get(o['ID']) if o else None
            if not t or t['ID'] in self.used_tickets:
                continue
            act = [v for v in vs if v['plan_status'] == 'ACTIVE']
            if not act or o['dispatch_plan_ID'] != act[-1]['ID']:
                continue
            multi.append((f, o, t, vs, act[-1]))
        multi.sort(key=lambda x: h(self.c.code, x[0]['ID']))
        plain = next(x for x in multi if x[4]['version_gap_flag'] != 'true')
        gap = next(x for x in multi if x[4]['version_gap_flag'] == 'true' and x is not plain)
        late = next(x for x in multi if x is not plain and x is not gap and x[4]['version_gap_flag'] != 'true'
                    and abs(num(x[4]['required_uplift_kg']) - num(x[3][-2]['required_uplift_kg'])) > 150)
        for x in (plain, gap, late):
            self.used_flights.add(x[0]['ID'])
            self.used_tickets.add(x[2]['ID'])
        f, o, t, vs, a = plain
        refs.append(self.ref('A', t, f=f, extra=f"plan group {a['plan_group_id']}: v{', v'.join(v['plan_version'] for v in vs)}; order on v{a['plan_version']}",
                             seeded='Existing flight with a revised plan. Order and uplift both on the ACTIVE version.',
                             expected='Flight page Dispatch Plans: earlier versions SUPERSEDED. The order names '
                                      f"dispatch plan v{a['plan_version']}; the uplift reconciles against that version's required uplift."))
        f, o, t, vs, a = gap
        refs.append(self.ref('B', t, f=f, extra=f"v{', v'.join(v['plan_version'] for v in vs)}; version_gap_flag on v{a['plan_version']} ({a['versions_skipped']} skipped)",
                             seeded='Existing flight whose plan arrived after a missing version.',
                             expected='DSP456 version gap shown on the plan; the uplift maps to the version that arrived '
                                      '(the active one), not to the missing one.'))
        f, o, t, vs, a = late
        prior = vs[-2]
        dl = self.T['FUEL_DELIVERIES'].get(t['delivery_ID'])
        revised = parse_ts(dl['refuel_end_utc']) + dt.timedelta(minutes=12)
        a['dispatch_timestamp'] = ts(revised)
        o['dispatch_plan_ID'] = prior['ID']
        o['planned_quantity_kg'] = prior['required_uplift_kg']
        o['notes'] = (o['notes'] + f" SCENARIO 9: fuelled against plan v{prior['plan_version']}; v{a['plan_version']} "
                      f"arrived at {ts(revised)}, after the uplift.")[:1000]
        self.tag(9, 'FLIGHT_DISPATCH', a['ID'], 'revision timestamped after the uplift')
        self.tag(9, 'FUEL_ORDERS', o['ID'], 'order kept on the plan version active at fuelling')
        refs.append(self.ref('C', t, f=f,
                             extra=f"uplift ended {dl['refuel_end_utc']}; v{a['plan_version']} issued {ts(revised)}; "
                                   f"v{prior['plan_version']} required {prior['required_uplift_kg']} kg, v{a['plan_version']} {a['required_uplift_kg']} kg",
                             seeded=f"Latest plan re-timed to 12 min after the uplift ended; the order points at v{prior['plan_version']}, "
                                    'the version that was active when the fuel went in.',
                             expected='The fuelling event belongs to the superseded version. Order-to-plan variance is '
                                      'measured against that version; the later version shows as issued after fuelling.'))
        self.refs[9] = refs
        return refs

    # ================================================================ S10 / S14 / maintenance helpers
    def station_supply(self, stn_airport_id):
        for m in self.T['STATION_SUPPLIER_MAP'].rows:
            if m['airport_ID'] == stn_airport_id and m['carrier_carrier_code'] == self.c.code and m['is_default'] == 'true':
                return m
        raise RuntimeError('no station map')

    def s10(self):
        c = self.c
        refs = []
        if not self.T['ORDER_CATEGORY'].get('MAINTENANCE'):
            self.T['ORDER_CATEGORY'].add({'code': 'MAINTENANCE', 'name': 'Maintenance uplift (no flight)'})
            self.tag(10, 'ORDER_CATEGORY', 'MAINTENANCE', 'new code-list value')
        ap = self.c.airport_of(c.maint_station)
        m = self.station_supply(ap['ID'])
        con = self.T['MASTER_CONTRACTS'].get(m['contract_ID'])
        # Tails on the ground at the maintenance base for six hours or more.
        slots = []
        for reg, legs in self.D.legs_by_tail.items():
            if not legs or not self.mine(legs[0]):
                continue
            for a_, b_ in zip(legs, legs[1:] + [None]):
                if a_['destination_airport'] != c.maint_station or not a_['aibt']:
                    continue
                start = parse_ts(a_['aibt'])
                end = parse_ts(b_['aobt']) if b_ and b_['aobt'] else start + dt.timedelta(hours=14)
                if end - start >= dt.timedelta(hours=7):
                    slots.append((reg, a_, start, end))
        slots.sort(key=lambda s: h(c.code, s[0]))
        tails, picked = set(), []
        for s in slots:
            if s[0] not in tails:
                picked.append(s)
                tails.add(s[0])
            if len(picked) == 3:
                break
        sample_t = next(t for t in self.T['FUEL_TICKETS'].rows if t['order_ID'] and
                        self.T['FUEL_ORDERS'].get(t['order_ID'])['station_code'] == c.maint_station)
        price = num(sample_t['rate_per_litre'])
        prod = self.T['FUEL_ORDERS'].get(sample_t['order_ID'])['product_ID']
        reasons = ['Engine ground run after component change', 'Fuel-system leak check after wing tank access',
                   'Post-maintenance engine run-up before return to service']
        items = []
        for n, ((reg, arr, start, end), label, why) in enumerate(zip(picked, 'ABC', reasons), 1):
            when = start + dt.timedelta(hours=3, minutes=10 * n)
            day = when.date().isoformat()
            ymd = day.replace('-', '')
            litres = float(2400 + h('mnt', reg) % 2000)
            dens = 0.8010
            tag = f'{c.maint_station}-{ymd}-M{n}'
            oid = uid(c.code, 'MNT-ORD', reg, day)
            po = self.next_po()
            self.T['FUEL_ORDERS'].add({
                'ID': oid, 'order_number': f'FO-{tag}', 'flight_ID': '', 'airport_ID': ap['ID'],
                'station_code': c.maint_station, 'supplier_ID': m['supplier_ID'], 'contract_ID': m['contract_ID'],
                'product_ID': prod, 'uom_code': 'LTR', 'ordered_quantity': f2(litres),
                'ordered_quantity_kg': f2(litres * 0.8), 'conversion_source': 'UOM_MASTER', 'conversion_density': '0.8000',
                'unit_price': f4(price), 'total_amount': f2(litres * price), 'currency_code': con['currency_code'],
                'requested_date': day, 'requested_time': (when - dt.timedelta(minutes=30)).strftime('%H:%M:%S'),
                'priority': 'Normal', 'status': 'Completed', 's4_po_number': po, 's4_po_item': '00010',
                'notes': f'SCENARIO 10 - maintenance uplift to tail {reg} at {c.maint_station}: {why}. No flight. '
                         'Cost object: maintenance, not a flight.',
                'communication_status': 'ACKNOWLEDGED', 'order_relationship': 'ORIGINAL', 'is_tankering': 'false',
                'created_at': ts(when - dt.timedelta(hours=1)), 'created_by': c.by, 'modified_at': ts(when),
                'modified_by': c.by, 'order_type': 'ORIGINAL', 'planned_quantity_kg': '', 'order_category': 'MAINTENANCE',
                'into_plane_agent_ID': m['into_plane_agent_ID'], 'into_plane_contract_ID': m['into_plane_contract_ID']})
            did = uid(c.code, 'MNT-DEL', reg, day)
            gr = self.next_gr()
            self.T['FUEL_DELIVERIES'].add({
                'ID': did, 'order_ID': oid, 'aircraft_reg': reg, 'tail_registration': reg,
                'delivery_number': f'EPD-{tag}', 'delivery_date': day, 'delivery_time': when.strftime('%H:%M:%S'),
                'delivered_quantity': f2(litres), 'uom_code': 'LTR', 'temperature': '14.00', 'density': f4(dens),
                'temperature_corrected_qty': f2(litres * (1 - 0.00099 * -1)), 'fob_source': 'NONE',
                'fob_rounding_kg': '0', 'recon_status': 'NOT_ATTRIBUTABLE', 'supplier_count': '1',
                'delivery_method': 'TRK', 'vehicle_id': f'TRK-{c.maint_station}-MRO',
                'driver_name': 'Fueler 777 (synthetic)', 'ground_crew_name': 'MRO technician 312 (synthetic)',
                's4_gr_number': gr, 's4_gr_year': '2026', 's4_gr_item': '0001', 'status': 'Verified',
                'variance_flag': 'false', 'refuel_start_utc': ts(when), 'refuel_end_utc': ts(when + dt.timedelta(minutes=15)),
                'refuel_complete': 'true', 'created_at': ts(when), 'created_by': c.by,
                'modified_at': ts(when + dt.timedelta(minutes=15)), 'modified_by': c.by, 'flight_ID': '',
                'flight_variance_status': 'NOT_ATTRIBUTABLE'})
            pfx = c.prefix_of(m['supplier_ID'])
            tnum = f'{pfx}-{c.maint_station}-M{ymd[2:]}{n}'
            tid = uid(c.code, 'MNT-TKT', reg, day)
            t = self.T['FUEL_TICKETS'].add({
                'ID': tid, 'order_ID': oid, 'match_status': 'MATCHED', 'ticket_source': 'M', 'delivery_ID': did,
                'ticket_number': tnum, 'internal_number': f'FT-{tag}', 'aircraft_reg': reg, 'tail_registration': reg,
                'flight_number': '', 'quantity': f2(litres), 'uom_code': 'LTR', 'quantity_metered': f2(litres),
                'meter_start': '50000.00', 'meter_end': f2(50000 + litres),
                'density_value': f4(dens), 'density_uom': 'KGL', 'density_basis': 'MEA', 'density_temp_c': '14.00',
                'quantity_flag': 'GR', 'quantity_kg': f2(litres * dens), 'delivery_timestamp': ts(when),
                'supplier_ticket_ref': tnum, 'status': 'Verified', 'verified_by': 'mro.planner@airline.com',
                'verified_at': ts(when + dt.timedelta(hours=1)), 'vehicle_id': f'TRK-{c.maint_station}-MRO',
                'meter_serial': f'MTR-TRK-{c.maint_station}-MRO', 'ticket_capture_source': 'MANUAL',
                'created_at': ts(when + dt.timedelta(minutes=20)), 'created_by': c.by,
                'modified_at': ts(when + dt.timedelta(minutes=20)), 'modified_by': c.by, 'flight_ID': '',
                'rate_per_litre': f4(price), 'total_amount': f2(litres * price), 'currency_code': con['currency_code']})
            it = c.new_line(self.D, '', 0, t, self.T['FUEL_ORDERS'].get(oid))
            it['description'] = f'Jet fuel to tail {reg} {c.maint_station} {day} - maintenance (no flight)'
            it['cost_center'] = f'MRO{c.maint_station}'
            it['gl_account'] = acct(c, 'MAINT_FUEL')
            items.append(it)
            for e, k in (('FUEL_ORDERS', oid), ('FUEL_DELIVERIES', did), ('FUEL_TICKETS', tid)):
                self.tag(10, e, k, f'maintenance uplift, tail {reg}')
            refs.append(self.ref(label, t, extra=f"tail on ground at {c.maint_station} {ts(start)} - {ts(end)}; order FO-{tag}",
                                 seeded=f'Order category MAINTENANCE (new code-list row), no flight. {why}.',
                                 expected='Ticket matches its order (PO and GR resolve), invoice line validates. No flight '
                                          'is involved, so flight variance is NOT_ATTRIBUTABLE and the fuel is charged '
                                          'to maintenance, not to a flight.'))
        inv = c.new_invoice(self.D, m['supplier_ID'], f"{c.prefix_of(m['supplier_ID'])}-{c.maint_station}-{c.inv_tag}-MNT",
                            con['currency_code'], 'SCENARIO 10 - maintenance uplifts to tails with no flight.')
        for n, it in enumerate(items, 1):
            it['invoice_ID'] = inv['ID']
            it['line_number'] = str(n * 10)
            it['ID'] = uid(c.code, 'MNT-ITM', it['ticket_ID'])
            self.T['INVOICE_ITEMS'].add(it)
            self.tag(10, 'INVOICE_ITEMS', it['ID'], 'maintenance uplift line')
        self.D.recompute_header(inv)
        self.tag(10, 'INVOICES', inv['ID'], 'maintenance uplift invoice')
        for r in refs:
            r['invoice'] = inv['invoice_number']
        self.refs[10] = refs
        return refs

    # ================================================================ S14
    def s14(self):
        refs = []
        cands, invs = [], set()
        for c_ in self.overnight_candidates(3, previous_date=False):
            iv = self.D.lines_by_ticket[c_[2]['ID']][0]['invoice_ID']
            if iv not in invs:
                cands.append(c_)
                invs.add(iv)
        for (f, o, t, refuel), label in zip(cands, 'ABC'):
            self.used_flights.add(f['ID'])
            self.used_tickets.add(t['ID'])
            dl = self.move_uplift(t, refuel)
            t.update({'order_ID': '', 'flight_ID': '', 'flight_number': '', 'match_status': 'UNMATCHED',
                      'status': 'Open', 'verified_by': '', 'verified_at': ''})
            dl.update({'order_ID': '', 'flight_ID': '', 'status': 'Pending'})
            it = self.D.lines_by_ticket[t['ID']][0]
            it.update({'flight_ID': '', 'fuel_order_ID': '', 'delivery_ID': dl['ID']})
            o['status'] = 'Confirmed'
            inv = self.T['INVOICES'].get(it['invoice_ID'])
            self.D.reset_verdict(inv)
            self.used_invoices.add(inv['ID'])
            for e, k, r in (('FUEL_TICKETS', t['ID'], 'tail-only ticket, no order and no flight'),
                            ('FUEL_DELIVERIES', dl['ID'], 'preflight delivery, unattached'),
                            ('FUEL_ORDERS', o['ID'], 'planned order left waiting for its uplift'),
                            ('INVOICE_ITEMS', it['ID'], 'billed by ticket and tail only'),
                            ('INVOICES', inv['ID'], 'verdict reset (a line changed)')):
                self.tag(14, e, k, r)
            refs.append(self.ref(label, t, inv, f=f,
                                 extra=f"tail fuelled {t['delivery_timestamp']} for next departure {f['flight_number']} "
                                       f"{f['aobt']}; waiting order {o['order_number']}",
                                 seeded='Preflight uplift recorded against the TAIL only: no order, no flight, ticket UNMATCHED. '
                                        "The next flight's planned order is left Confirmed with no delivery.",
                                 expected='Ticket appears UNMATCHED (chaseable). Invoice Validate raises INV463 "ticket has no '
                                          'order" (HARD) until the ticket is attached to the waiting order of the next flight; '
                                          'after attaching, PO and GR resolve and the line clears.'))
        self.refs[14] = refs
        return refs

    # ================================================================ S15
    def s15(self):
        c = self.c
        refs = []
        srcs = self.pick_sources(2, 1)
        variants = [('A', 'exact', 'Same supplier, same ticket number, same tail, timestamp and quantity - the electronic feed re-sent the ticket.'),
                    ('B', 'rekeyed', 'Same uplift keyed again by hand: ticket number without separators (OCR/manual), timestamp +4 min, identical quantity and meter readings.')]
        for (inv, lines), (label, kind, why) in zip(srcs, variants):
            self.used_invoices.discard(inv['ID'])
            t0 = self.ticket(lines[0])
            d = copy.deepcopy(t0)
            when = parse_ts(t0['created_at']) + dt.timedelta(hours=2)
            d.update({'ID': uid(c.code, 'DUP-TKT', t0['ID'], kind), 'internal_number': f"{t0['internal_number']}-D",
                      'status': 'Open', 'verified_by': '', 'verified_at': '', 'created_at': ts(when),
                      'modified_at': ts(when), 'created_by': c.by, 'modified_by': c.by})
            if kind == 'rekeyed':
                d['ticket_number'] = t0['ticket_number'].replace('-', '')
                d['ticket_source'] = 'M'
                d['ticket_capture_source'] = 'MANUAL'
                d['delivery_timestamp'] = ts(parse_ts(t0['delivery_timestamp']) + dt.timedelta(minutes=4))
            for k in [k for k in d if k.startswith('s4_')]:
                d[k] = ''
            self.T['FUEL_TICKETS'].add(d)
            self.tag(15, 'FUEL_TICKETS', d['ID'], f'duplicate ({kind}) of {t0["ticket_number"]}')
            self.tag(15, 'FUEL_TICKETS', t0['ID'], 'original ticket')
            refs.append(self.ref(label, d, extra=f"original {t0['ticket_number']} ({t0['internal_number']}); duplicate internal {d['internal_number']}",
                                 seeded=why,
                                 expected='SHOULD be refused at capture or held from S/4 posting. CRITERIA: (1) same supplier + '
                                          'same ticket number; (2) same tail + same supplier + delivery time within 30 min + '
                                          'quantity within 0.5%. TODAY: nothing refuses it - EPD410 is DESIGNED, not built, '
                                          'and ticket save posts PO+GR. It surfaces only as UNBILLED, and as INV455 if a '
                                          'supplier ever bills it.'))
        # Control: same tail, same station, same day, two genuine uplifts.
        pairs = {}
        for t in self.T['FUEL_TICKETS'].rows:
            f = self.flight_of(t)
            if not self.mine(f) or not t['order_ID']:
                continue
            o = self.T['FUEL_ORDERS'].get(t['order_ID'])
            pairs.setdefault((t['aircraft_reg'], o['station_code'], o['supplier_ID'], t['delivery_timestamp'][:10]), []).append(t)
        ctrl = sorted([v for v in pairs.values() if len(v) >= 2], key=lambda v: h(c.code, v[0]['ID']))[0]
        a, b = sorted(ctrl, key=lambda t: t['delivery_timestamp'])[:2]
        refs.append(self.ref('C', b, extra=f"same tail {a['aircraft_reg']} at the same station on the same day as {a['ticket_number']} "
                                           f"({a['delivery_timestamp']} vs {b['delivery_timestamp']})",
                             seeded='CONTROL, unchanged: two genuine uplifts to one tail at one station on one day, for two flights.',
                             expected='NOT a duplicate: different ticket numbers, different flights, more than 30 minutes '
                                      'apart. Both must post. Any duplicate rule must leave this pair alone.'))
        self.refs[15] = refs
        return refs

    # ================================================================ S16
    def s16(self):
        c = self.c
        refs = []
        (ia, la), (ib, lb), (ic, lc) = self.pick_sources(3, 2)

        def posted(inv, docno):
            inv.update({'status': 'POSTED', 'approval_status': 'APPROVED', 'posting_gate': 'CLEAR',
                        'match_status': 'MATCHED', 'tolerance_status': 'WITHIN',
                        'first_approver': 'ap.clerk@airline.com', 'first_approved_at': f"{inv['invoice_date']}T16:00:00Z",
                        'final_approver': 'ap.clerk@airline.com', 'final_approved_at': f"{inv['invoice_date']}T16:00:00Z",
                        'posting_date': (dt.date.fromisoformat(inv['invoice_date']) + dt.timedelta(days=2)).isoformat(),
                        's4_document_number': docno, 's4_fiscal_year': '2026', 'sap_invoice_number': docno,
                        'fi_posting_status': 'SUCCESS', 'gate_evaluated_at': f"{inv['invoice_date']}T16:00:00Z"})

        def copy_of(orig, number, received_days, notes):
            dup = dict(orig)
            rec = (dt.date.fromisoformat(orig['invoice_date']) + dt.timedelta(days=received_days)).isoformat()
            dup.update({'ID': uid(c.code, 'DUPINV', number, received_days), 'invoice_number': number,
                        'internal_number': f"{orig['internal_number']}-DUP{received_days}"[:30], 'received_date': rec,
                        'created_at': f'{rec}T10:00:00Z', 'modified_at': f'{rec}T10:00:00Z', 'notes': notes,
                        's4_document_number': '', 'sap_invoice_number': '', 'fi_posting_status': '', 'posting_date': ''})
            self.D.reset_verdict(dup)
            self.T['INVOICES'].add(dup)
            for it in self.D.items_of(orig['ID']):
                x = dict(it)
                x.update({'ID': uid(c.code, 'DUPITM', dup['ID'], it['ID']), 'invoice_ID': dup['ID']})
                self.D.set_line(x)
                self.T['INVOICE_ITEMS'].add(x)
                self.tag(16, 'INVOICE_ITEMS', x['ID'], 'duplicate line')
            self.D.recompute_header(dup)
            self.tag(16, 'INVOICES', dup['ID'], f'duplicate of {orig["invoice_number"]}')
            return dup

        n1, n2 = c.dup_numbers
        A = self.carve(16, ia, la, 'X', 'SCENARIO 16 - original invoice, ALREADY POSTED (simulated S/4 document, mock mode).')
        A['invoice_number'] = n1
        posted(A, c.dup_docs[0])
        B = copy_of(A, n1, 3, f'SCENARIO 16A - the supplier sent invoice {n1} again three days later. Same number, same vendor, same lines.')
        refs.append(self.ref('A', self.ticket(self.D.items_of(B['ID'])[0]), B,
                             extra=f"original {n1} POSTED as {c.dup_docs[0]}; duplicate received {B['received_date']}",
                             seeded='Criterion 1 - same invoice number + same vendor.',
                             expected='Validate the duplicate: INV473 HARD (same number, same vendor) and INV455 HARD on '
                                      'every line (ticket already billed for fuel). Gate GATED - stays in exception; the '
                                      'original remains the only posted document. Do NOT re-validate the posted original.'))
        A2 = self.carve(16, ib, lb, 'Y', 'SCENARIO 16 - original invoice, ALREADY POSTED (simulated S/4 document, mock mode).')
        A2['invoice_number'] = n2
        posted(A2, c.dup_docs[1])
        B2 = copy_of(A2, f'{n2}-R', 5, f'SCENARIO 16B - the supplier re-issued {n2} under a NEW number {n2}-R, billing the same tickets.')
        refs.append(self.ref('B', self.ticket(self.D.items_of(B2['ID'])[0]), B2,
                             extra=f"original {n2} POSTED as {c.dup_docs[1]}; re-issue {n2}-R",
                             seeded='Criterion 2 - different invoice number, same tickets and same charge.',
                             expected='INV473 PASSES (number differs). INV455 HARD on every line: the tickets are already '
                                      'billed for fuel on the posted original. Gate GATED.'))
        C = self.carve(16, ic, lc, 'Z', f'SCENARIO 16C - CONTROL. Another vendor happens to use invoice number {n1}.')
        C['invoice_number'] = n1
        refs.append(self.ref('C', self.ticket(self.D.items_of(C['ID'])[0]), C,
                             extra=f'same number {n1} as 16A, DIFFERENT vendor, different tickets',
                             seeded='Control - same invoice number, different vendor.',
                             expected='NOT a duplicate: INV473 keys on number AND vendor; INV455 finds no ticket billed '
                                      'twice. Validate -> CLEAR; it posts.'))
        self.refs[16] = refs
        return refs

    # ================================================================ S11-S13 (proposed schema)
    def defuel(self):
        c = self.c
        pool = []
        for f in self.T['FLIGHT_SCHEDULE'].rows:
            if not self.mine(f) or f['ID'] in self.used_flights:
                continue
            o = self.D.order_by_flight.get(f['ID'])
            t = self.D.ticket_by_order.get(o['ID']) if o else None
            if not t or t['ID'] in self.used_tickets or num(t['quantity']) < 6000:
                continue
            fl = [x for x in self.D.lines_by_ticket.get(t['ID'], []) if x['charge_type'] == 'FUEL']
            if len(fl) != 1:
                continue
            pool.append((f, o, t, fl[0]))
        pool.sort(key=lambda x: h(c.code, 'dfl', x[0]['ID']))
        reasons = {
            11: ['Payload increase after fuelling put the aircraft over MTOW; supplier defuelled the excess',
                 'Aircraft change after fuelling (tail swap); fuel taken off the original tail by the supplier',
                 'Fuel quality hold - supplier defuelled for sampling, service charged'],
            12: ['Flight cancelled after fuelling; fuel returned to the supplier, credit note expected',
                 'Over-fuelled by the supplier against the order; excess returned for credit',
                 'Contamination suspected; fuel returned, part credited and part disposed (write-off)'],
            13: ['Tankering plan cancelled; fuel moved to the airline storage tank at the station',
                 'Defuel ahead of a heavy check; fuel held in the airline storage tank for re-use',
                 'Fuel transferred off the tail into the airline storage tank pending re-uplift'],
        }
        disp = {11: 'SUPPLIER_SERVICE', 12: 'RETURN_TO_SUPPLIER', 13: 'STORAGE'}
        k = 0
        out = {}
        for sid in (11, 12, 13):
            refs = []
            for label, why in zip('ABC', reasons[sid]):
                f, o, t, line = pool[k]
                k += 1
                self.used_flights.add(f['ID'])
                self.used_tickets.add(t['ID'])
                inv = self.T['INVOICES'].get(line['invoice_ID'])
                litres = float(1500 + h('dfq', t['ID']) % 2500)
                dens = num(t['density_value'])
                end = parse_ts(t['delivery_timestamp']) + dt.timedelta(minutes=55)
                ymd = end.strftime('%Y%m%d')
                stn = o['station_code']
                pfx = c.prefix_of(o['supplier_ID'])
                dnum = f'DF-{pfx}-{stn}-{ymd[2:]}{sid}{label}'
                dl0 = self.T['FUEL_DELIVERIES'].get(t['delivery_ID'])
                after0 = num(dl0['fob_after_kg']) or 0
                did = uid(c.code, 'DFL-DEL', t['ID'])
                dtid = uid(c.code, 'DFL-TKT', t['ID'])
                storage = f'{stn}-FS01' if sid == 13 else ''
                self.D.proposed['DEFUEL_DELIVERIES'].append({**{k_: '' for k_ in self.T['FUEL_DELIVERIES'].header}, **{
                    'ID': did, 'order_ID': o['ID'], 'aircraft_reg': t['aircraft_reg'], 'tail_registration': t['aircraft_reg'],
                    'delivery_number': f'EPD-{stn}-{ymd}-DF{sid}{label}', 'delivery_date': end.date().isoformat(),
                    'delivery_time': end.strftime('%H:%M:%S'), 'delivered_quantity': f2(-litres), 'uom_code': 'LTR',
                    'density': f4(dens), 'fob_before_kg': f2(after0), 'fob_after_kg': f2(after0 - litres * dens),
                    'fob_delta_kg': f2(-litres * dens), 'fob_source': 'CREW_REPORTED', 'recon_status': 'NOT_RECONCILED',
                    'delivery_method': 'DEFUEL', 'vehicle_id': f'TRK-{stn}-DF', 'status': 'Pending',
                    'refuel_start_utc': ts(end), 'refuel_end_utc': ts(end + dt.timedelta(minutes=25)),
                    'refuel_complete': 'true', 'created_at': ts(end), 'created_by': c.by, 'modified_at': ts(end),
                    'modified_by': c.by, 'flight_ID': f['ID'],
                    'PROPOSED_movement_type': 'DEFUEL', 'PROPOSED_defuel_disposition': disp[sid],
                    'PROPOSED_storage_location': storage, 'PROPOSED_reason': why}})
                dt_row = {**{k_: '' for k_ in self.T['FUEL_TICKETS'].header}, **{
                    'ID': dtid, 'order_ID': o['ID'], 'match_status': 'MATCHED', 'ticket_source': 'M', 'delivery_ID': did,
                    'ticket_number': dnum, 'internal_number': f'FT-{stn}-{ymd}-DF{sid}{label}',
                    'aircraft_reg': t['aircraft_reg'], 'tail_registration': t['aircraft_reg'],
                    'flight_number': t['flight_number'], 'quantity': f2(-litres), 'uom_code': 'LTR',
                    'density_value': f4(dens), 'density_uom': 'KGL', 'density_basis': 'MEA', 'quantity_flag': 'GR',
                    'quantity_kg': f2(-litres * dens), 'delivery_timestamp': ts(end), 'status': 'Open',
                    'ticket_capture_source': 'MANUAL', 'created_at': ts(end), 'created_by': c.by, 'modified_at': ts(end),
                    'modified_by': c.by, 'flight_ID': f['ID'], 'rate_per_litre': t['rate_per_litre'],
                    'total_amount': f2(-litres * num(t['rate_per_litre'])), 'currency_code': t['currency_code'],
                    'PROPOSED_movement_type': 'DEFUEL', 'PROPOSED_defuel_disposition': disp[sid],
                    'PROPOSED_storage_location': storage, 'PROPOSED_reference_ticket_ID': t['ID'],
                    'PROPOSED_reference_ticket_number': t['ticket_number']}}
                self.D.proposed['DEFUEL_TICKETS'].append(dt_row)
                info = {'f': f, 'o': o, 't': t, 'dt': dt_row, 'litres': litres, 'inv': inv, 'why': why}
                if sid == 11:
                    rate = c.defuel_rate
                    iid = uid(c.code, 'DFL-INV', dnum)
                    number = f'DFS-{pfx}-{stn}-{ymd[2:]}{label}'
                    self.D.proposed['DEFUEL_INVOICES'].append(c.defuel_header(iid, number, o, inv, 'INVOICE', '',
                        f'SCENARIO 11 - defuel service charge: {why}.'))
                    self.D.proposed['DEFUEL_INVOICE_ITEMS'].append(c.defuel_item(
                        iid, 10, dt_row, o, litres, rate, 'DEFUEL_SERVICE', f'Defuel service {stn} {t["aircraft_reg"]} {dnum}'))
                    info['amount'] = round(litres * rate, 2)
                    exp = ('TARGET: matches the defuel ticket quantity and the defuel service rate. NEEDS SCHEMA: '
                           'charge_type DEFUEL_SERVICE, movement type on the ticket, a service-rate reference. MEASURED '
                           'TODAY (core columns loaded into a scratch copy): INV451 HARD (quantity vs the negative '
                           'defuel GR), INV452 HARD (service rate vs the FUEL order price), INV466 HARD (no GR on the '
                           'defuel delivery).')
                    seeded = f'Defuel ticket {dnum} (-{litres:g} L) and a service invoice {number}: {litres:g} L x {rate}/L.'
                    inv_no = number
                elif sid == 12:
                    credited = litres if label != 'C' else litres - 300
                    iid = uid(c.code, 'DFL-CN', dnum)
                    number = f'CN-{pfx}-{stn}-{ymd[2:]}{label}'
                    self.D.proposed['DEFUEL_INVOICES'].append(c.defuel_header(iid, number, o, inv, 'CREDIT_NOTE', inv['ID'],
                        f'SCENARIO 12 - credit note for defuelled fuel returned to the supplier: {why}.'))
                    self.D.proposed['DEFUEL_INVOICE_ITEMS'].append(c.defuel_item(
                        iid, 10, dt_row, o, -credited, num(t['rate_per_litre']), 'FUEL',
                        f'Credit - fuel returned {stn} {t["aircraft_reg"]} ref {t["ticket_number"]}'))
                    info.update({'amount': round(credited * num(t['rate_per_litre']), 2),
                                 'disposed': round((litres - credited) * num(t['rate_per_litre']), 2)})
                    exp = ('Credit note referencing the original invoice and uplift ticket; quantity equals the defuel '
                           'ticket' + (' less 300 L disposed as contaminated (no credit; written off)' if label == 'C' else '')
                           + '. MEASURED TODAY (core columns loaded into a scratch copy): INV456 HARD - "no field '
                             'distinguishes a defuel line" - and INV466 HARD (no GR on the defuel delivery). NEEDS '
                             'document_type CREDIT_NOTE + reference invoice + defuel movement type.')
                    seeded = f'Defuel ticket {dnum} (-{litres:g} L) and credit note {number} for -{credited:g} L at the uplift price.'
                    inv_no = number
                else:
                    exp = ('Fuel moves from the tail to storage location ' + storage + ' (no supplier, no invoice). The '
                           'ROB ledger takes a DEFUEL/TRANSFER out of the tail; stock moves into the storage location '
                           '(S/4 transfer posting). NEEDS SCHEMA: storage location master + movement type on the ticket.')
                    seeded = f'Defuel ticket {dnum} (-{litres:g} L) with disposition STORAGE to {storage}; no invoice.'
                    inv_no = ''
                    info['amount'] = round(litres * num(t['rate_per_litre']), 2)
                r = self.ref(label, t, extra=f'defuel ticket {dnum}; uplift invoice {inv["invoice_number"]}',
                             seeded=seeded + ' ' + why + '.', expected=exp)
                r['invoice'] = inv_no
                refs.append(r)
                info['number'] = inv_no
                out.setdefault(sid, []).append(info)
                self.tag(sid, 'DEFUEL_TICKETS (proposed)', dtid, f'defuel {disp[sid]}')
            self.refs[sid] = refs
        self.defuels = out
        stn_rows = {(x['o']['station_code']) for x in out[13]}
        for stn in sorted(stn_rows):
            self.D.proposed['STORAGE_LOCATIONS'].append({
                'PROPOSED_ID': uid(c.code, 'SLOC', stn), 'carrier_code': c.code, 'station_code': stn,
                'plant_code': f'{stn}1', 'storage_location': f'{stn}-FS01',
                'description': f'{c.code} airline fuel storage tank at {stn} (defuel / re-uplift)',
                'capacity_litres': '60000', 'is_active': 'true'})

    # ================================================================ S17
    def s17(self):
        c = self.c
        D = self.D
        T = self.T
        # a/b/h - an S1 uplift, its GR and its invoice.
        inv = T['INVOICES'].get(next(r for r in self.tg.rows if r['scenario'] == 'S01')['key'])
        it = self.fuel_lines(inv)[0]
        t = self.ticket(it)
        amt = num(t['total_amount'])
        self.add_journal(1, 'a', t['ticket_number'], [('UPLIFT', amt, None, 'Goods receipt of the uplift (PO-based, account-assigned)'),
                                                       ('GRIR', None, amt, 'GR/IR clearing credited at GR')],
                         f"ticket total {t['total_amount']} = {t['quantity']} L x {t['rate_per_litre']}")
        self.add_journal(1, 'b', t['ticket_number'], [('UPLIFT', amt, None, 'Fuel expense recognised at uplift (same document as 17a, expense side)'),
                                                       ('GRIR', None, amt, 'GR/IR')],
                         'Fuel is expensed at uplift; the unburnt share is deferred at period end (17c)')
        net, tax = num(it['net_amount']), num(it['tax_amount']) or 0
        lines = [('GRIR', net, None, 'Clear GR/IR at invoice receipt (MIRO)'),
                 ('VENDOR', None, net + tax, f"Vendor payable, invoice {inv['invoice_number']} line {it['line_number']}")]
        if tax:
            lines.insert(1, ('COMP_TAX', tax, None, 'Tax on the line'))
        self.add_journal(1, 'h', inv['invoice_number'], lines, f'line net {it["net_amount"]}, tax {it["tax_amount"] or "0.00"}')
        # c - unburnt fuel at period end on three tails.
        tails = sorted({f['aircraft_reg'] for f in T['FLIGHT_SCHEDULE'].rows if self.mine(f)},
                       key=lambda r: h(c.code, 'unb', r))[:3]
        for reg in tails:
            last = [f for f in D.legs_by_tail[reg] if f['aibt']][-1]
            rob = num(last['fob_at_in_kg']) or 0
            tk = [x for x in T['FUEL_TICKETS'].rows if x['aircraft_reg'] == reg and num(x['quantity_kg'] or 0) > 0]
            tk.sort(key=lambda x: x['delivery_timestamp'])
            rate = num(tk[-1]['total_amount']) / num(tk[-1]['quantity_kg']) if tk else 1.5
            val = round(rob * rate, 2)
            ref = f"{reg} after {last['flight_number']} {last['flight_date']} (IN {last['aibt']})"
            self.add_journal(None, 'c', ref, [('UNBURNT_FUEL', val, None, 'Defer the fuel still on board at period end'),
                                              ('UPLIFT', None, val, 'Reduce fuel expense by the unburnt fuel')],
                             f'ROB at IN {rob:g} kg x {rate:.4f}/kg (last uplift rate - the ledger MAP replaces this at load). '
                             'Reversed on day 1 of the next period.')
            self.add_journal(None, 'c', ref + ' - reversal', [('UPLIFT', val, None, 'Reverse the deferral on day 1 of the next period'),
                                                               ('UNBURNT_FUEL', None, val, 'Deferred fuel burn released')],
                             'Auto-reversal')
        # d - fuel expense components (S3 ref A).
        cm = self.cmp
        it = cm['lines'][0]
        q = num(it['quantity'])
        t = self.ticket(it)
        idx_val = num(t['rate_per_litre']) - sum(v for _, _, v in cm['components'][1:])
        role = {'BASE_INDEX': 'UPLIFT', 'PREMIUM': 'UPLIFT', 'INTO_PLANE': 'COMP_INTO_PLANE', 'HANDLING': 'COMP_THROUGHPUT'}
        jl, tot = [], 0
        for name, ctype, v in cm['components']:
            val = round(q * (idx_val if ctype == 'BASE_INDEX' else v), 2)
            tot += val
            jl.append((role[ctype], val, None, f'{name} ({"index" if ctype == "BASE_INDEX" else f"{v}/L"})'))
        jl.append(('GRIR', None, round(tot, 2), 'GR/IR at the full delivered price'))
        self.add_journal(3, 'd', t['ticket_number'], jl, f'{q:g} L, contract {cm["contract"]}, formula {cm["formula"]}')
        # e, f, g - defuel and credit notes.
        x = self.defuels[12][0]
        self.add_journal(12, 'e', x['number'], [('EXPECTED_CREDIT', x['amount'], None, 'Defuel returned: expected credit raised against the vendor'),
                                                 ('FUEL_EXP_ADJ', None, x['amount'], 'Reverse the fuel expense for the returned fuel')],
                         f"{x['litres']:g} L x {x['t']['rate_per_litre']}")
        self.add_journal(12, 'e', x['number'] + ' (credit note)', [('VENDOR', x['amount'], None, 'Credit note reduces the vendor balance'),
                                                                   ('EXPECTED_CREDIT', None, x['amount'], 'Expected credit cleared')],
                         'Credit note receipt')
        x = self.defuels[11][0]
        self.add_journal(11, 'f', x['number'], [('DEFUEL_SERVICE', x['amount'], None, 'Defuel service (service entry / GR)'),
                                                 ('GRIR', None, x['amount'], 'GR/IR')],
                         f"{x['litres']:g} L x {c.defuel_rate}/L")
        self.add_journal(11, 'f', x['number'] + ' (invoice)', [('GRIR', x['amount'], None, 'Clear GR/IR'),
                                                                ('VENDOR', None, x['amount'], 'Vendor payable for the defuel service')],
                         'Service invoice receipt')
        x = self.defuels[12][2]
        total = round(x['litres'] * num(x['t']['rate_per_litre']), 2)
        self.add_journal(12, 'g', x['number'], [('EXPECTED_CREDIT', x['amount'], None, 'Credited share of the returned fuel'),
                                                 ('FUEL_WRITE_OFF', x['disposed'], None, 'Disposed share - contaminated, not credited'),
                                                 ('FUEL_EXP_ADJ', None, total, 'Fuel expense adjustment for everything taken off the tail')],
                         f"{x['litres']:g} L defuelled, 300 L disposed, at {x['t']['rate_per_litre']}")
        refs = [self.ref('a/b', self.ticket(self.fuel_lines(inv)[0]), inv, extra='GR: Dr fuel expense / Cr GR/IR',
                         seeded='S1 clean uplift', expected='See Expected_Journal_Entries S17a, S17b'),
                self.ref('c/d', cm['lines'][0] and self.ticket(cm['lines'][0]), extra=f'unburnt fuel on {", ".join(tails)}; components on {cm["contract"]}',
                         seeded='S3 + period-end ROB', expected='See S17c (deferral and reversal) and S17d (component accounts)'),
                self.ref('e/f/g/h', self.defuels[12][0]['t'], extra='credit note, defuel service, disposal, invoice',
                         seeded='S11/S12 defuels + S1 invoice', expected='See S17e-S17h')]
        self.refs[17] = refs
        # GL accounts as loadable master data.
        for role, (b6, tp, desc, ph) in GL.items():
            gl = b6 if c.code == 'B6' else tp
            gid = uid(c.code, 'GL', role, gl)
            if c.code == 'B6' and role == 'UPLIFT':
                continue    # 600780 and 600781 are already in the seed
            self.T['RECON_GL_ACCOUNTS'].add({
                'ID': gid, 'carrier_carrier_code': c.code, 'company_code': c.company, 'gl_account': gl,
                'account_role': role, 'description': desc, 'valid_from': '2026-01-01', 'valid_to': '',
                'is_active': 'true', 'notes': ('PLACEHOLDER ACCOUNT - confirm with the functional consultant before load.'
                                               if ph else 'Mirrors the UPLIFT account pattern.'),
                'created_at': c.stamp, 'created_by': c.by, 'modified_at': c.stamp, 'modified_by': c.by})
            self.tag(17, 'RECON_GL_ACCOUNTS', gid, f'{role} {gl}')
        return refs

    def run(self):
        self.D.index()
        out = {}
        for sid, fn in [(16, self.s16), (1, self.s01), (2, self.s02), (3, self.s03), (4, self.s04), (5, self.s05),
                        (6, self.s06), (7, self.s07), (8, self.s08), (9, self.s09), (14, self.s14),
                        (15, self.s15), (10, self.s10)]:
            out[sid] = fn()
            self.D.index()
        self.defuel()
        out[17] = self.s17()
        return self.refs

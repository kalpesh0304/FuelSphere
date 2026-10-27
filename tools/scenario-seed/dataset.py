"""
The working set one airline's scenarios are applied to.

For JetBlue it is LOADED from db/data (the seed already in the build) and the
output is a DIFF: rows added and fields changed. For TAP it is BUILT from the
uploaded schedule and dispatch, and the output is every row.
"""
import copy
from collections import defaultdict
from common import Table, read_csv, uid, f2, f3, f4, num

ENTITIES = [
    'CARRIER_MASTER', 'CURRENCY_MASTER', 'T005_COUNTRY', 'MASTER_AIRPORTS', 'AIRCRAFT_MASTER',
    'AIRCRAFT_REGISTRATIONS', 'AIRCRAFT_FUEL_TYPES', 'ORDER_CATEGORY',
    'MASTER_SUPPLIERS', 'MASTER_CONTRACTS', 'CONTRACT_LOCATIONS', 'CONTRACT_PRODUCTS',
    'STATION_SUPPLIER_MAP', 'MARKET_INDICES', 'MARKET_INDEX_VALUES', 'PRICING_FORMULAS',
    'FORMULA_COMPONENTS', 'RECON_GL_ACCOUNTS',
    'FLIGHT_SCHEDULE', 'FLIGHT_DISPATCH', 'FUEL_ORDERS', 'FUEL_DELIVERIES', 'FUEL_TICKETS',
    'INVOICES', 'INVOICE_ITEMS',
]


class Dataset:
    def __init__(self, airline, load_existing):
        self.airline = airline
        self.t = {}
        for e in ENTITIES:
            head, rows = read_csv(e)
            self.t[e] = Table(e, head, rows if load_existing else [])
        self.snapshot = ({e: {k: copy.deepcopy(r) for k, r in tb.by_id.items()} for e, tb in self.t.items()}
                         if load_existing else None)
        # Sheets for rows the CURRENT schema cannot hold. Not loadable as-is.
        self.proposed = defaultdict(list)
        self.journal = []

    # ------------------------------------------------------------------ indexes
    def index(self):
        T = self.t
        for tb in T.values():
            tb.reindex()
        self.flights = T['FLIGHT_SCHEDULE'].by_id
        self.versions = defaultdict(list)
        for d in T['FLIGHT_DISPATCH'].rows:
            self.versions[d['flight_schedule_ID']].append(d)
        for v in self.versions.values():
            v.sort(key=lambda d: int(d['plan_version'] or 0))
        self.order_by_flight = {}
        for o in T['FUEL_ORDERS'].rows:
            if o['flight_ID'] and o.get('order_category', 'PLANNED') in ('PLANNED', '') \
                    and o['order_type'] in ('ORIGINAL', ''):
                self.order_by_flight.setdefault(o['flight_ID'], o)
        self.delivery_by_order = {}
        for d in T['FUEL_DELIVERIES'].rows:
            if d['order_ID']:
                self.delivery_by_order.setdefault(d['order_ID'], d)
        self.ticket_by_order = {}
        for k in T['FUEL_TICKETS'].rows:
            if k['order_ID']:
                self.ticket_by_order.setdefault(k['order_ID'], k)
        self.lines_by_ticket = defaultdict(list)
        self.items_by_invoice = defaultdict(list)
        for it in T['INVOICE_ITEMS'].rows:
            if it['ticket_ID']:
                self.lines_by_ticket[it['ticket_ID']].append(it)
            self.items_by_invoice[it['invoice_ID']].append(it)
        self.legs_by_tail = defaultdict(list)
        for f in T['FLIGHT_SCHEDULE'].rows:
            if f['aircraft_reg']:
                self.legs_by_tail[f['aircraft_reg']].append(f)
        for legs in self.legs_by_tail.values():
            legs.sort(key=lambda f: f['aobt'] or f['sobt'] or '')

    def previous_leg(self, flight):
        legs = self.legs_by_tail.get(flight['aircraft_reg'], [])
        i = legs.index(flight)
        return legs[i - 1] if i > 0 else None

    def next_leg(self, flight):
        legs = self.legs_by_tail.get(flight['aircraft_reg'], [])
        i = legs.index(flight)
        return legs[i + 1] if i + 1 < len(legs) else None

    # ------------------------------------------------------------------ invoices
    def recompute_header(self, inv):
        items = [i for i in self.t['INVOICE_ITEMS'].rows if i['invoice_ID'] == inv['ID']]
        net = round(sum(num(i['net_amount']) or 0 for i in items), 2)
        tax = round(sum(num(i['tax_amount']) or 0 for i in items), 2)
        inv['net_amount'] = f2(net)
        inv['tax_amount'] = f2(tax)
        inv['gross_amount'] = f2(net + tax)
        inv['stated_net_amount'] = f2(net)
        inv['stated_gross_amount'] = f2(net + tax)
        inv['stated_line_count'] = str(len(items))

    @staticmethod
    def reset_verdict(inv):
        """A header whose lines changed has no verdict until Validate runs again."""
        inv.update({'status': 'SUBMITTED', 'posting_gate': 'NOT_CHECKED', 'approval_status': 'PENDING',
                    'match_status': 'UNMATCHED', 'gate_evaluated_at': '', 'open_hard_count': '0',
                    'open_soft_count': '0', 'warning_count': '0', 'rules_evaluated': '', 'rules_passed': '',
                    'rules_failed': '', 'rules_bypassed': '', 'rules_not_applicable': '',
                    'first_approver': '', 'first_approved_at': '', 'final_approver': '',
                    'final_approved_at': '', 'tolerance_status': '', 'price_variance': '',
                    'quantity_variance': '', 'variance_percentage': ''})

    def items_of(self, inv_id):
        return sorted([i for i in self.t['INVOICE_ITEMS'].rows if i['invoice_ID'] == inv_id],
                      key=lambda i: int(i['line_number']))

    def carve(self, src_inv, items, number, internal, by, stamp, notes, invoice_date=None):
        """Move lines off a supplier invoice onto a new header of their own.

        The source keeps its other lines and has its totals restated. Both
        headers lose any stored verdict, because the lines it was computed
        over are no longer the lines they hold.
        """
        new = dict(src_inv)
        new.update({'ID': uid(self.airline, 'INV', number, internal), 'invoice_number': number,
                    'internal_number': internal, 'notes': notes, 'created_by': by, 'modified_by': by,
                    'created_at': stamp, 'modified_at': stamp, 'is_duplicate': 'false', 'duplicate_of_ID': '',
                    's4_document_number': '', 's4_fiscal_year': '', 'sap_invoice_number': '',
                    'fi_posting_status': '', 'posting_date': '', 's4_payment_document': '', 'payment_date': ''})
        if invoice_date:
            new['invoice_date'] = invoice_date
            new['baseline_date'] = invoice_date
            new['received_date'] = invoice_date
        self.reset_verdict(new)
        new = self.t['INVOICES'].add(new)
        for n, it in enumerate(items, 1):
            it['invoice_ID'] = new['ID']
            it['line_number'] = str(n * 10)
        self.recompute_header(new)
        if src_inv:
            self.recompute_header(src_inv)
            self.reset_verdict(src_inv)
        self.t['INVOICES'].reindex()
        return self.t['INVOICES'].get(new['ID'])

    @staticmethod
    def set_line(it, qty=None, price=None):
        q = num(it['quantity']) if qty is None else qty
        p = num(it['unit_price']) if price is None else price
        old_net = num(it['net_amount']) or 0
        rate = (num(it['tax_amount']) or 0) / old_net if old_net else 0
        net = round(q * p, 2)
        it['quantity'] = f3(q)
        it['unit_price'] = f4(p)
        it['net_amount'] = f2(net)
        it['tax_amount'] = f2(round(net * rate, 2))
        # Written by Validate from the ticket; cleared so a stale figure never
        # sits beside a changed line.
        for c in ('ticket_quantity_kg', 'ticket_rate', 'ticket_amount', 'tolerance_status',
                  'resolved_po_number', 'resolved_gr_number', 'resolution_source',
                  'price_variance_pct', 'qty_variance_pct'):
            if c in it:
                it[c] = ''
        it['line_match_status'] = 'UNMATCHED'

    # ------------------------------------------------------------------ diff
    def diff(self):
        adds, updates = defaultdict(list), []
        for e, tb in self.t.items():
            tb.sync_header()
            old = self.snapshot[e]
            for r in tb.rows:
                k = tb.key(r)
                if k not in old:
                    adds[e].append(r)
                    continue
                o = old[k]
                for c in tb.header:
                    if (o.get(c, '') or '') != (r.get(c, '') or ''):
                        updates.append({'entity': e, 'key_column': 'ID' if 'ID' in tb.header else '',
                                        'key': k, 'column': c, 'current_value': o.get(c, ''),
                                        'new_value': r.get(c, '')})
        return adds, updates

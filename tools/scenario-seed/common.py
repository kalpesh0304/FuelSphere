"""
Shared helpers for the JetBlue and TAP scenario seed workbooks.

NOTHING HERE WRITES TO db/data. The output is two Excel workbooks under
docs/test-data/scenarios/, reviewed before anything is loaded.
"""
import csv, json, os, uuid, copy, hashlib, datetime as dt

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DATA = os.path.join(ROOT, 'db', 'data')
NS = uuid.UUID('7d3f1c2a-5b6e-4f80-9a1b-2c3d4e5f6a70')


def uid(*parts):
    return str(uuid.uuid5(NS, '|'.join(str(p) for p in parts)))


def h(*parts):
    """A stable pseudo-random integer from the parts - no RNG state anywhere."""
    return int(hashlib.sha1('|'.join(map(str, parts)).encode()).hexdigest()[:12], 16)


def frac(*parts):
    return (h(*parts) % 1000000) / 1000000.0


def read_csv(entity):
    path = os.path.join(DATA, f'fuelsphere-{entity}.csv')
    with open(path, encoding='utf-8-sig', newline='') as f:
        r = csv.reader(f, delimiter=';', quotechar='"')
        head = next(r)
        rows = [dict(zip(head, row + [''] * (len(head) - len(row)))) for row in r if any(row)]
    return head, rows


def f2(x):
    return '' if x is None or x == '' else f'{float(x):.2f}'


def f3(x):
    return '' if x is None or x == '' else f'{float(x):.3f}'


def f4(x):
    return '' if x is None or x == '' else f'{float(x):.4f}'


def num(v):
    return None if v is None or v == '' else float(v)


def ts(d):
    return d.strftime('%Y-%m-%dT%H:%M:%SZ')


def parse_ts(s):
    s = str(s).replace('Z', '')
    return dt.datetime.fromisoformat(s[:19])


class Table:
    """Rows as dicts of strings, in a fixed header order."""

    def __init__(self, name, header, rows=None):
        self.name, self.header = name, list(header)
        self.rows = rows or []
        self.by_id = {}
        self.reindex()

    def key(self, r):
        for k in ('ID', 'registration', 'carrier_code', 'code', 'currency_code', 'land1', 'type_code', 'werks', 'uom_code'):
            if k in self.header:
                return r.get(k)
        return None

    def sync_header(self):
        """A column set on a row by dict update must reach the header, or it
        is silently dropped by everything that walks the header."""
        for r in self.rows:
            for k in r:
                if k not in self.header:
                    self.header.append(k)
        for r in self.rows:
            for k in self.header:
                r.setdefault(k, '')

    def reindex(self):
        self.by_id = {self.key(r): r for r in self.rows}

    def add(self, row):
        for c in row:
            if c not in self.header:
                self.header.append(c)
        full = {c: '' for c in self.header}
        full.update({k: ('' if v is None else str(v)) for k, v in row.items()})
        self.rows.append(full)
        self.by_id[self.key(full)] = full
        return full

    def get(self, k):
        return self.by_id.get(k)


class Tagger:
    """Which scenario every seeded or changed row belongs to."""

    def __init__(self):
        self.rows = []

    def tag(self, scenario, entity, key, role):
        self.rows.append({'scenario': scenario, 'entity': entity, 'key': key, 'role': role})


def load_model_columns():
    p = os.environ.get('FS_COLS_JSON')
    with open(p) as f:
        return json.load(f)

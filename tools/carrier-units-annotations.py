#!/usr/bin/env python3
"""
Put the screens on the carrier's currency and units.

    node tools/service-elements.js /tmp/svc.json
    python3 tools/carrier-units-annotations.py /tmp/svc.json

TWO OUTPUTS, ONE RULE SET.

1. srv/carrier-units-annotations.cds (generated, overwritten): every converted
   field gets @Measures.Unit pointing at the carrier's unit on the SAME entity,
   and every money field @Measures.ISOCurrency at the carrier's currency. Its
   @title is the source field's with the literal unit taken out.

2. The existing *-fiori-annotations.cds files, edited in place: a line item or
   field group showing a kg figure shows its carrier-mass twin instead; a
   litre figure its carrier-volume twin; a CAPTURED volume (a vendor's ticket
   or invoice quantity, in the contract's unit) keeps its place and gains the
   carrier-volume twin beside it. Literal units leave those labels, because
   the unit now comes from @Measures and a label saying "kg" beside a value in
   pounds would be wrong.

ONLY WHERE THE TWIN EXISTS on that entity, checked against the compiled
service model - never by name alone. Re-running is idempotent.
"""
import json, os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRV = os.path.join(ROOT, 'srv')
svc = {k: {e['name']: e for e in v} for k, v in json.load(open(sys.argv[1])).items()}

RATE = {'rate_usd_per_kg': 'rate_per_cm', 'map_usd_per_kg': 'map_per_cm', 'burn_rate_usd_per_kg': 'burn_rate_per_cm',
        'burn_rate_kg_hr': 'burn_rate_cm_hr', 'apu_rate_kg_hr': 'apu_rate_cm_hr',
        'rate_usd_per_l': 'rate_per_cv', 'map_usd_per_l': 'map_per_cv'}
CAPTURED = ['quantity', 'quantity_metered', 'ordered_quantity', 'delivered_quantity', 'temperature_corrected_qty',
            'quantity_variance', 'crew_adjusted_quantity']
NO_CONVERT = {'carbon_emission_kg', 'carbon_projected_kg', 'fob_rounding_kg'}   # CO2 stays kg; rounding is config


def twin(field, elements):
    """The converted field that replaces `field` on this entity, or None."""
    if field in NO_CONVERT:
        return None
    if field in RATE and RATE[field] in elements:
        return RATE[field]
    if field.endswith('_kg') and field[:-3] + '_cm' in elements:
        return field[:-3] + '_cm'
    if field.endswith('_l') and field[:-2] + '_cv' in elements:
        return field[:-2] + '_cv'
    return None


def strip_units(label):
    s = label
    for a, b in [(r'USD\s*/\s*kg', 'per unit'), (r'USD\s*/\s*L\b', 'per unit'), (r'\(per LTR\)', '(per unit)'),
                 (r'\(kg/h(r)?\)', '(per hour)'), (r'\bkg/h(r)?\b', 'per hour'),
                 (r'\s*\((kg|KG|L|LTR|litres?|USD|kg CO2)\)', ''), (r'\bUSD\b', ''), (r'\s+kg\b', ''),
                 (r'\bkg\s+', ''), (r'\s+\(L\)', ''), (r'\s+(L|LTR)$', '')]:
        s = re.sub(a, b, s)
    return re.sub(r'\s{2,}', ' ', s).strip() or label


def is_money(name):
    return ('usd' in name or name.endswith('_value')) and not name.startswith('carrier_')


# --------------------------------------------------------------- 1. rebinding
REC = re.compile(r"\{[^{}]*?\bValue\s*:\s*(\w+)[^{}]*\}")
ANN = re.compile(r"\bannotate\s+([A-Za-z0-9_.]+)\s+with")
LABEL = re.compile(r"(Label\s*:\s*')([^']*)(')")
report = {}
for fn in sorted(os.listdir(SRV)):
    if not fn.endswith('annotations.cds') or fn == 'carrier-units-annotations.cds':
        continue
    path = os.path.join(SRV, fn)
    text = open(path, encoding='utf-8').read()
    marks = [(m.start(), m.group(1)) for m in ANN.finditer(text)]
    out, pos, n_rebind, n_twin, n_label = [], 0, 0, 0, 0
    for m in REC.finditer(text):
        target = None
        for p, t in marks:
            if p < m.start():
                target = t
            else:
                break
        els = svc.get(target)
        rec = m.group(0)
        if not els or not els.get('carrier_mass_uom'):
            continue
        field = m.group(1)
        new = rec
        tw = twin(field, els)
        if not tw and (field.endswith('_cm') or field.endswith('_cv') or field in RATE.values()):
            new = LABEL.sub(lambda x: x.group(1) + strip_units(x.group(2)) + x.group(3), new)
        elif tw:
            new = re.sub(r"(\bValue\s*:\s*)" + field + r"\b", r"\g<1>" + tw, new, count=1)
            new = LABEL.sub(lambda x: x.group(1) + strip_units(x.group(2)) + x.group(3), new)
            n_rebind += 1
        elif is_money(field):
            new2 = LABEL.sub(lambda x: x.group(1) + strip_units(x.group(2)) + x.group(3), new)
            n_label += new2 != new
            new = new2
        elif field in CAPTURED and field + '_cv' in els and (field + '_cv') not in text[m.end():m.end() + 400]:
            fixed = LABEL.sub(lambda x: x.group(1) + strip_units(x.group(2)) + x.group(3), rec)
            lab = LABEL.search(fixed)
            twin_rec = re.sub(r"(\bValue\s*:\s*)" + field + r"\b", r"\g<1>" + field + '_cv', fixed, count=1)
            twin_rec = LABEL.sub(lambda x: x.group(1) + x.group(2) + ' (carrier)' + x.group(3), twin_rec) if lab \
                else twin_rec.replace(field + '_cv', field + "_cv, Label: '" + field.replace('_', ' ').capitalize() + " (carrier)'", 1)
            new = fixed + ',\n            ' + twin_rec
            n_twin += 1
        if new != rec:
            out.append(text[pos:m.start()])
            out.append(new)
            pos = m.end()
    if pos:
        out.append(text[pos:])
        text = ''.join(out)
    # Element titles on money fields: "Value USD" -> "Value". The currency now
    # comes from @Measures.ISOCurrency.
    before = text
    text = re.sub(r"(\b\w*usd\w*\s+@title\s*:\s*')([^']*)(')",
                  lambda x: x.group(1) + strip_units(x.group(2)) + x.group(3), text)
    n_label += sum(1 for a, b in zip(before.splitlines(), text.splitlines()) if a != b)
    if pos or text != before:
        open(path, 'w', encoding='utf-8').write(text)
        report[fn] = (n_rebind, n_twin, n_label)

# --------------------------------------------------- 2. element-level measures
SRC = {v: k for k, v in RATE.items()}
lines = ["/**",
         " * GENERATED by tools/carrier-units-annotations.py - do not edit by hand.",
         " *",
         " * Every converted figure carries the carrier's unit and every money figure",
         " * the carrier's currency, each as a field of the SAME entity",
         " * (carrier_mass_uom, carrier_volume_uom, carrier_currency - calculated in",
         " * db/carrier-units.cds), so no path reaches a target a service may not expose.",
         " */",
         "using from './carrier-units-projections';", ""]
for ent in sorted(svc):
    els = svc[ent]
    if 'carrier_mass_uom' not in els:
        continue
    body = []
    for name in sorted(els):
        src = SRC.get(name) or (name[:-3] + '_kg' if name.endswith('_cm') else None)
        if name.endswith('_cv'):
            src = name[:-3] if name[:-3] in els else (name[:-3] + '_l' if name[:-3] + '_l' in els else name[:-3])
        title = None
        if src and src in els and els[src].get('title'):
            title = strip_units(els[src]['title'])
        if not title and src:
            title = strip_units(src.replace('_', ' ').capitalize())
        title = (title or name).replace("'", "''")
        if name in RATE.values():
            body.append(f"    {name} @Measures.ISOCurrency: carrier_currency @title: '{title}';")
        elif name.endswith('_cm') or name.endswith('_cm_hr'):
            body.append(f"    {name} @Measures.Unit: carrier_mass_uom @title: '{title}';")
        elif name.endswith('_cv'):
            body.append(f"    {name} @Measures.Unit: carrier_volume_uom @title: '{title}';")
        elif is_money(name) and 'usd' in name:
            # The title stays where it is (its own file strips the "USD" from
            # it below); a second @title here would be a duplicate assignment.
            body.append(f"    {name} @Measures.ISOCurrency: carrier_currency;")
    if body:
        lines.append(f"annotate {ent} with {{")
        lines += body
        lines.append("}")
        lines.append("")
open(os.path.join(SRV, 'carrier-units-annotations.cds'), 'w').write('\n'.join(lines))

for fn, (a, b, c) in report.items():
    print(f'  {fn}: {a} rebound to carrier units, {b} carrier twins added, {c} money labels cleaned')
print(f"  carrier-units-annotations.cds: {sum(1 for l in lines if l.startswith('annotate'))} entities")

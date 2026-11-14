"""Compare a capture's two sources, patient by patient: the printed report CORES makes (what cores_parse reads from its
HTML) and CORES's own clinical data from the patient list, which captureCores() carries in the capture
(<!-- CORES data ... -->, read by cores_parse.attach_clinical into each record's 'cores_data').

For each vital sign, lab and the medication list it counts the patients where both sources have a value and they
agree, where they differ, and where only one has it; it also lists the result labels CORES used for each item (and the
labels it did not place), so the matching can be tuned. Only counts and labels shared by 3 or more patients are
printed: never a patient's values, names or numbers, so the output can be pasted anywhere.

Usage:  python cores_compare.py CAPTURE.html | PARSED.json        (or `cores compare [FILE]`)
"""
import datetime
import json
import re
import sys

# report key -> what a CORES result label (event_display) looks like for it; the first that matches wins
VITALS = [
    ('temp', r'\btemp'), ('hr', r'heart rate|\bpulse\b(?!.*ox)|\bhr\b'), ('sbp', r'systolic'), ('dbp', r'diastolic'),
    ('map_noninvasive', r'mean arterial|\bmap\b'), ('rr', r'resp(iratory)?\s*rate|\brr\b'), ('spo2', r'spo2|o2 sat|oxygen sat|pulse ox'),
]
LABS = [
    ('wbc', r'\bwbc\b|white blood'), ('hgb', r'\bhgb\b|hemoglobin(?!\s*a1c)'), ('hct', r'\bhct\b|hematocrit'),
    ('plt', r'platelet|\bplt\b'), ('na', r'\bsodium\b|^na\b'), ('k', r'potassium|^k\b'), ('cl', r'chloride|^cl\b'),
    ('co2', r'\bco2\b(?!.*(art|ven|pco2))|bicarb'), ('bun', r'\bbun\b|urea nitrogen'), ('creatinine', r'creatinine(?!.*clear)'),
    ('glucose', r'glucose'), ('ca', r'\bcalcium\b(?!.*ion)|^ca\b'), ('mg', r'magnesium|^mg\b'), ('phos', r'phos'),
    ('lactate', r'lact'), ('pt', r'^pt\b|prothrombin time'), ('ptt', r'\bptt\b|thromboplastin'), ('inr', r'\binr\b'),
    ('albumin', r'albumin'), ('total_bili', r'total bili|bilirubin,? total|^bilirubin$'), ('direct_bili', r'direct bili|bilirubin,? direct'),
    ('ast', r'\bast\b'), ('alt', r'\balt\b'), ('alk_phos', r'alk(aline)? phos'), ('total_protein', r'total protein|protein,? total'),
]


def num(s):
    m = re.search(r'-?\d+(?:\.\d+)?', str(s or ''))
    return float(m.group()) if m else None


def same(a, b, key=''):
    """Two printed values agree: equal as text, or as numbers (a temperature in either scale)."""
    if a is None or b is None:
        return False
    if str(a).strip().lower() == str(b).strip().lower():
        return True
    x, y = num(a), num(b)
    if x is None or y is None:
        return False
    if abs(x - y) <= max(0.05, abs(y) * 0.001):
        return True
    if key == 'temp':   # 38.3 C and 100.9 F are the same temperature
        return abs((x - 32) / 1.8 - y) < 0.15 or abs((y - 32) / 1.8 - x) < 0.15
    return False


TIME_FORMATS = ('%Y-%m-%dT%H:%M:%S', '%Y-%m-%dT%H:%M:%S.%f', '%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M', '%m/%d/%Y %H:%M:%S',
                '%m/%d/%Y %H:%M', '%m/%d/%y %H:%M', '%m/%d/%Y %I:%M %p', '%m/%d/%y %I:%M %p', '%m/%d/%Y', '%m/%d/%y')


def when(s):
    """A CORES date-time, in whatever form it comes (ISO, US, /Date(ms)/); None when it cannot be read."""
    s = str(s or '').strip()
    m = re.search(r'/Date\((-?\d+)', s)
    if m:
        return datetime.datetime.utcfromtimestamp(int(m.group(1)) / 1000)
    s = re.sub(r'(Z|[+-]\d\d:?\d\d)$', '', s)
    for f in TIME_FORMATS:
        try:
            return datetime.datetime.strptime(s, f)
        except ValueError:
            pass
    return None


def entries(cd):
    """All of a patient's CORES result entries, each (label, value, time or None, position)."""
    out, n = [], 0
    for col in cd.get('results') or []:
        for e in col.get('entries') or []:
            out.append((str(e.get('event_display') or ''), e.get('result_val'), when(e.get('event_end_dt_tm')), n))
            n += 1
    return out


def latest(es):
    timed = [e for e in es if e[2]]
    if timed:
        return max(timed, key=lambda e: (e[2], e[3]))
    return max(es, key=lambda e: e[3]) if es else None


def drug(s):
    w = re.findall(r'[a-z]+', str(s or '').lower())
    return w[0] if w else ''


def compare(data):
    recs = data.get('records') or []
    have = [r for r in recs if r.get('cores_data')]
    lines = [f'Compare: {len(recs)} patients in the report; {len(have)} with CORES clinical data'
             + (f' (captured {data.get("header", {}).get("cores_data", {}).get("captured", "")})' if have else '')]
    if not have:
        lines.append('No CORES clinical data in this capture: it was made by an older captureCores(), or the list had not loaded.'
                     ' Capture again with the current script (cores capture), after opening a report.')
        return '\n'.join(lines)
    used, unplaced = {}, {}   # label -> set of patients

    def tally(items, report_of, kind):
        rows = []
        for key, rx in items:
            pat = re.compile(rx, re.I)
            both = agree = differ = only_r = only_c = 0
            for i, r in enumerate(have):
                es = [e for e in entries(r['cores_data']) if pat.search(e[0])]
                for e in es:
                    used.setdefault((kind, key, e[0]), set()).add(i)
                rv = report_of(r, key)
                lv = latest(es)
                if rv not in (None, '') and lv:
                    both += 1
                    if same(lv[1], rv, key):
                        agree += 1
                    else:
                        differ += 1
                elif rv not in (None, ''):
                    only_r += 1
                elif lv:
                    only_c += 1
            if both or only_r or only_c:
                rows.append(f'  {key:<16} both {both:>3}: agree {agree:>3}, differ {differ:>3} | only report {only_r:>3} | only CORES {only_c:>3}')
        return rows

    lines += ['', 'VITALS (report "last" vs the newest CORES value)']
    lines += tally(VITALS, lambda r, k: ((r.get('vitals') or {}).get(k) or {}).get('last'), 'vital')
    lines += ['', 'LABS (report "current" vs the newest CORES value)']
    lines += tally(LABS, lambda r, k: ((r.get('labs') or {}).get(k) or {}).get('current'), 'lab')
    # meds: the drugs in the report's lists vs the CORES orders, by the first word of the name
    m_both = m_rep = m_cor = 0
    for r in have:
        rep = {drug(m.get('drug')) for cat in (r.get('meds') or {}).values() for m in (cat or []) if drug(m.get('drug'))}
        cor = {drug(m.get('order_mnemonic') or m.get('name') or m.get('ordered_as_mnemonic')) for m in r['cores_data'].get('meds') or []}
        cor.discard('')
        m_both += len(rep & cor)
        m_rep += len(rep - cor)
        m_cor += len(cor - rep)
    lines += ['', 'MEDS (drug names, first word, over all patients)',
              f'  in both {m_both}, only in the report {m_rep}, only in CORES orders {m_cor}']
    # labels: which CORES result labels each item took, and the ones no item took (shared by 3+ patients only)
    placed = set()
    for (kind, key, label), pts in used.items():
        placed.add(label)
    for i, r in enumerate(have):
        for e in entries(r['cores_data']):
            if e[0] not in placed:
                unplaced.setdefault(e[0], set()).add(i)
    by_item = {}
    for (kind, key, label), pts in used.items():
        if len(pts) >= 3:
            by_item.setdefault(key, []).append(f'"{label}" {len(pts)}')
    lines += ['', 'CORES RESULT LABELS EACH ITEM USED (in how many patients; labels shared by 3+ patients)']
    for key in [k for k, _ in VITALS + LABS if k in by_item]:
        lines.append(f'  {key}: ' + ', '.join(sorted(by_item[key])))
    rest = sorted(((label, len(pts)) for label, pts in unplaced.items() if len(pts) >= 3), key=lambda x: (-x[1], x[0]))
    lines += ['', f'CORES RESULT LABELS NO ITEM USED ({len(rest)}, shared by 3+ patients)']
    lines.append('  ' + (', '.join(f'"{label}" {n}' for label, n in rest[:120]) or '(none)'))
    sets = {}
    for r in have:
        for s in r['cores_data'].get('result_sets') or []:
            if s.get('event_set'):
                sets.setdefault(s['event_set'], 0)
                sets[s['event_set']] += 1
    if sets:
        lines += ['', 'CORES RESULT COLUMNS (event sets, in how many patients)',
                  '  ' + ', '.join(f'"{k}" {v}' for k, v in sorted(sets.items(), key=lambda x: -x[1]) if v >= 3)]
    times = sum(1 for r in have for e in entries(r['cores_data']) if e[2])
    total = sum(len(entries(r['cores_data'])) for r in have)
    lines += ['', f'{total:,} CORES result entries; {times:,} with a time this script could read.',
              'Only counts and labels shared by 3+ patients are shown: no patient values, names or numbers.']
    return '\n'.join(lines)


def load(path):
    if str(path).lower().endswith('.json'):
        with open(path, encoding='utf-8') as fh:
            return json.load(fh)
    from cores_parse import parse_file
    return parse_file(str(path))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    print(compare(load(sys.argv[1])))

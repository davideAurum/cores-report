"""Parse a CORES report saved/captured as HTML into JSON with named fields.

Usage:  python cores_parse.py "CORES report 281 2026-09-16 0715.html" [out.json]

Handles two layouts, chosen by the report title in the page header:
  - "I-PASS Detailed"     (six columns)               -> parse_row() below
  - "Anesthesia Report"   (nine columns)              -> cores_parse_anes.parse_row()

Both produce the same record shape. Field names follow REPORT_GLOSSARY.md (David's names):
  unit, room, bed, location, code_status, isolation, covid, severity,
  patient_name, mrn, dob, age, sex, los_days, admit_attending, admit_service, allergies, contact,
  admit_diagnosis, summary {narrative, status, lines}, tld [{days, description}], vent {...}, diet, tube_feeds,
  restraints, procedures, vitals {temp|hr|rr|spo2|sbp|dbp|map_noninvasive|map_invasive|art_bp|gcs: {last,min,max}},
  o2_delivery, gases [...], labs {analyte: {current, prior}}, glucose_trend, lactate_trend,
  net_io_since_admission, io {columns, rows}, handoff {...}, tasks [...], sit_awareness [...],
  meds {infusions|antibiotics|scheduled|prn: [{drug, dose_frequency, days_on, highlighted, last_dose}]}, notes [...]
Requires: beautifulsoup4, lxml
"""
import json
import re
import sys

from bs4 import BeautifulSoup

# fishbone cell class -> analyte, taken from the page's own Mustache templates
SLOT = {
    'fishbone_cbc_value_middle_left': 'wbc', 'fishbone_cbc_value_top_center': 'hgb',
    'fishbone_cbc_value_bottom_center': 'hct', 'fishbone_cbc_value_middle_right': 'plt',
    'fishbone_chem7_value_top_left': 'na', 'fishbone_chem7_value_top_center': 'cl',
    'fishbone_chem7_value_top_right': 'bun', 'fishbone_chem7_value_bottom_left': 'k',
    'fishbone_chem7_value_bottom_center': 'co2', 'fishbone_chem7_value_bottom_right': 'creatinine',
    'fishbone_chem7_value_middle_right': 'glucose',
    'fishbone_chem2_value_top': 'ca', 'fishbone_chem2_value_bottom': 'mg',
    'fishbone_chem3_value_top': 'ca', 'fishbone_chem3_value_middle': 'mg',
    'fishbone_chem3_value_bottom': 'phos',
    'fishbone_coag_value_top_left': 'pt', 'fishbone_coag_value_top_right': 'ptt',
    'fishbone_coag_value_bottom_center': 'inr',
    'fishbone_hepatic_value_top_left': 'total_protein', 'fishbone_hepatic_value_top_right': 'albumin',
    'fishbone_hepatic_value_middle_left': 'total_bili', 'fishbone_hepatic_value_middle_right': 'direct_bili',
    'fishbone_hepatic_value_bottom_left': 'ast', 'fishbone_hepatic_value_bottom_right': 'alt',
    'fishbone_hepatic_value_bottom_center': 'alk_phos',
}

# CORES vital-sign labels -> field names
VITAL_KEYS = {'T': 'temp', 'HR': 'hr', 'RR': 'rr', 'SpO2': 'spo2', 'SBP': 'sbp', 'DBP': 'dbp',
              'MAP (NON-inv)': 'map_noninvasive', 'MAP (Invasive)': 'map_invasive', 'GCS': 'gcs'}

# CORES vent labels (both report layouts) -> field names
VENT_KEYS = {'Type': 'mode', 'Set': 'set_rate', 'Set Rate': 'set_rate', 'VT Set': 'vt_set', 'VT set': 'vt_set',
             'VT vent': 'vt_measured', 'VT spont': 'vt_spont', 'Min vol spont': 'minute_volume_spont',
             'FiO2': 'fio2', 'PEEP': 'peep', 'PSV': 'psv', 'I:E': 'ie_ratio', 'MAP': 'mean_airway_pressure',
             'Static Comp': 'static_compliance'}

# CORES medication section labels -> field names
MED_KEYS = {'Infusions': 'infusions', 'IVF': 'infusions', 'Antibiotics': 'antibiotics',
            'Scheduled Meds': 'scheduled', 'PRN Meds': 'prn'}

BR = re.compile(r'<br\s*/?>', re.I)


def txt(el):
    return re.sub(r'\s+', ' ', el.get_text(' ', strip=True)) if el is not None else ''


def clean(s):
    return re.sub(r'\s+', ' ', s).strip()


def lines_of(el):
    """Split an element into text lines on <br>, dropping empties."""
    if el is None:
        return []
    out = []
    for piece in BR.split(''.join(str(c) for c in el.contents)):
        t = txt(BeautifulSoup(piece, 'lxml'))
        if t:
            out.append(t)
    return out


def kv_pairs(text):
    """'pH: 7.26 pCO2: 39.4 pO2 ven: 88' -> {'pH': '7.26', 'pCO2': '39.4', 'pO2 ven': '88'}"""
    return {k.strip(): v.strip() for k, v in re.findall(r'([A-Za-z][A-Za-z0-9/ ]*?):\s*(-?[\d.:]+|[A-Za-z][^:;]*?)(?=\s+[A-Za-z][A-Za-z0-9/ ]*?:|;|$)', text)}


def split_location(unit, room, bed):
    """('MCCU','P320','01') -> location 'MCCU P320-01'; ('UED','','') -> 'UED'."""
    loc = unit + (' ' + room if room else '') + ('-' + bed if bed else '')
    return {'unit': unit, 'room': room, 'bed': bed, 'location': loc.strip()}


def lab_cell(td):
    """Fishbone cell: prior value is italic/gray (<i class=report_result_gray> in I-PASS, <i style=color:#999> in
    the Anesthesia report); current value is <b>."""
    cur, pri = [], []
    for node in td.find_all(string=True):
        s = node.strip().replace('\xa0', '')
        if not s or s == '→':
            continue
        gray = False
        for p in node.parents:
            if p is td or not p.name:
                break
            if p.name == 'i' or 'report_result_gray' in (p.get('class') or []) or '#999' in (p.get('style') or ''):
                gray = True
        (pri if gray else cur).append(s)
    return {'current': ' '.join(cur), 'prior': ' '.join(pri)}


def fishbone_labs(container):
    """All fishbone slots under `container` -> {analyte: {'current','prior'}}. Slots are tds in I-PASS, and
    tds or trs (chem3 stack) in the Anesthesia report."""
    labs = {}
    for cell in container.find_all(['td', 'tr'], class_=re.compile(r'^fishbone_.*_value_')):
        k = SLOT.get(cell['class'][0])
        v = lab_cell(cell)
        if k and (v['current'] or v['prior']):
            labs[k] = v
    return labs


VITAL_RE = re.compile(r'(T|HR|RR|SpO2|GCS|MAP \(Invasive\)|MAP \(NON-inv\)|SBP|DBP): ?(-?[\d.]*) ?\( ?(-?[\d.]*) ?- ?(-?[\d.]*) ?\)')


def vitals_from_text(vt):
    """'T: 99.5 ( 96.3 - 101.7 ) HR: 83 ( 78 - 113 ) ... O2: Ventilator Art BP 134 / 57'
    -> ({'temp': {'last':'99.5','min':'96.3','max':'101.7'}, ...}, 'Ventilator')"""
    vitals = {VITAL_KEYS[k]: {'last': v, 'min': lo, 'max': hi} for k, v, lo, hi in VITAL_RE.findall(vt) if (v or lo or hi)}
    m = re.search(r'Art BP ?(-?[\d.]*) ?/ ?(-?[\d.]*)', vt)
    if m and (m.group(1) or m.group(2)):
        vitals['art_bp'] = {'last': f'{m.group(1)}/{m.group(2)}', 'min': '', 'max': ''}
    m = re.search(r'(?<!Sp)O2: ?(.*?)(?= (?:MAP|SBP|DBP|Art BP|GCS|T|HR|RR|SpO2)\b ?[:(]|$)', vt)
    return vitals, (clean(m.group(1)) if m else '')


def normalize_vent(raw):
    """{'Type': 'PC (Pressure control)', 'FiO2': '40', ...} -> {'mode': ..., 'fio2': '40', ...}; unknown labels kept
    under their own lower-cased label."""
    out = {}
    for k, v in raw.items():
        out[VENT_KEYS.get(k, k.lower().replace(' ', '_'))] = v
    return out


def parse_patient_info(td):
    f = [txt(x) for x in td.find_all(class_='t4m_report_field')]
    t = txt(td)
    rec = {'severity': txt(td.find(class_='report_signout_acuity'))}
    rec.update(split_location(f[6], f[7], f[8]))
    rec.update({'patient_name': f[1], 'mrn': f[2], 'dob': f[3], 'age': f[4], 'sex': f[5],
                'los_days': int(f[9]) if f[9].isdigit() else None})
    m = re.search(r'LOS: ?\d+ ?(.*?) ?Allergy: ?(.*?) ?Code: ?(.*?) ?Diet: ?(.*)$', t)
    rec['extra'], rec['allergies'], rec['code_status'], rec['diet'] = (clean(x) for x in m.groups()) if m else ('', '', '', '')
    return rec


def parse_summary(td):
    lines = lines_of(td.find(class_='t4m_report_field'))
    narrative, status = [], {}
    for ln in lines:
        m = re.match(r'^([A-Za-z][A-Za-z /]{0,20}):\s*(.*)$', ln)
        if m and len(ln) < 80:
            status[m.group(1)] = m.group(2)
        else:
            narrative.append(ln)
    return {'narrative': narrative, 'status': status, 'lines': lines}


def parse_action(td):
    out = {'tasks': [], 'sit_awareness': []}
    for sec in td.find_all('span', class_='section'):
        items = lines_of(sec.find(class_='t4m_report_field'))
        key = 'tasks' if sec.get('section_name') == 'Action List' else 'sit_awareness'
        out[key] = items
    return out


def parse_vitals_labs(td):
    out = {'vitals': {}, 'o2_delivery': '', 'gases': [], 'vent': None, 'io': None, 'labs': {}}
    top = td.find('span', class_='t4m_report_color_black', recursive=False)
    out['vitals'], out['o2_delivery'] = vitals_from_text(txt(top))
    for ch in td.find_all(recursive=False):
        if ch is top or (ch.name == 'span' and 'section' in (ch.get('class') or [])):
            continue
        t = txt(ch)
        if ch.get('title') == 'Vent' or t.startswith('Vent:'):
            body = t.split('Vent:', 1)[1]
            parts = [p.strip() for p in body.split(';') if p.strip()]
            raw = {'Type': parts[0]} if parts and ':' not in parts[0] else {}
            for p in (parts[1:] if raw else parts):
                if ': ' in p:
                    k, v = p.split(': ', 1)
                    raw[k.strip()] = v.strip()
            out['vent'] = normalize_vent(raw)
        else:
            # point-of-care gas: "iStat: (09/14 18:20) pH: 7.26 pCO2: 39.4 ..."
            for m in re.finditer(r'(iStat|VBG):\s*\(([^)]*)\)\s*(.*?)(?=(?:iStat|ABG(?: \(lab\))?|VBG):|$)', t):
                out['gases'].append({'type': m.group(1), 'time': m.group(2).strip(), 'values': kv_pairs(m.group(3))})
            # lab gas: "ABG (lab): 09/13 14:43 - 7.32 / 33 / 147 / 17"  (pH / pCO2 / pO2 / HCO3)
            for m in re.finditer(r'ABG(?: \(lab\))?:\s*([\d/]+ [\d:]+)\s*-\s*([\d.]*) ?/ ?([\d.]*) ?/ ?([\d.]*) ?/ ?([\d.]*)', t):
                vals = dict(zip(('pH', 'pCO2', 'pO2', 'HCO3'), m.groups()[1:]))
                out['gases'].append({'type': 'ABG', 'time': m.group(1), 'values': {k: v for k, v in vals.items() if v}})
    io = td.find(class_='report_io_table')
    if io:
        rows = [[txt(x) for x in rr.find_all(class_=re.compile('report_io_table_cell'))]
                for rr in io.find_all(class_=re.compile('^report_io_table_row'))]
        if rows:
            out['io'] = {'columns': rows[0][1:], 'rows': {rr[0].strip(): rr[1:] for rr in rows[1:] if rr}}
    out['labs'] = fishbone_labs(td)
    return out


def parse_meds(td):
    out = {}
    for sec in td.find_all('span', class_='section'):
        name = MED_KEYS.get(sec.get('title') or sec.get('section_name'), (sec.get('title') or '').lower())
        items = []
        for piece in BR.split(''.join(str(c) for c in sec.contents)):
            frag = BeautifulSoup(piece, 'lxml')
            if frag.find(class_='column_section_header'):
                continue
            highlighted = any(not b.get_text().strip().startswith('@') for b in frag.find_all('b'))
            last_dose = ''
            for b in frag.find_all('b'):  # trailing <b>@ 6 hrs</b> = time since last PRN dose
                if b.get_text().strip().startswith('@'):
                    last_dose = clean(b.get_text().strip()[1:])
                    b.decompose()
            det_el = frag.find('span')
            detail = txt(det_el) if det_el else ''
            if det_el:
                det_el.decompose()
            drug = txt(frag)
            m = re.search(r'\s*@ ?(\([^)]*\)|[\d.]+ hrs)\s*$', drug)  # plain-text variant: "drug @ (9/12)"
            if m:
                last_dose = last_dose or m.group(1)
                drug = drug[:m.start()].strip()
            if not drug and not detail:
                continue
            item = {'drug': drug, 'dose_frequency': detail, 'highlighted': highlighted}
            m = re.match(r'^(\d+) - (.*)$', drug)
            if m:
                item['days_on'] = int(m.group(1))
                item['drug'] = m.group(2)
            if last_dose:
                item['last_dose'] = last_dose
            items.append(item)
        out[name] = items
    return out


def parse_row(tr):
    c = {td['column_name']: td for td in tr.find_all('td', attrs={'column_name': True})}
    rec = parse_patient_info(c['Illness Severity'])
    rec['summary'] = parse_summary(c['Patient Summary'])
    rec.update(parse_action(c['Action List']))
    rec.update(parse_vitals_labs(c['Situational Awareness (Vitals/Labs)']))
    rec['meds'] = parse_meds(c['Situational Awareness (Meds)'])
    rec['notes'] = lines_of(c['Notes'])
    return rec


def parse_header(soup):
    h = soup.find('table', class_='page_header_template')
    if h is None:
        return {}
    raw = {f['field']: txt(f) for f in h.find_all(attrs={'field': True})}
    return {'report_format': txt(h.find('td')), 'service': raw.get('service', ''), 'team': raw.get('team', ''),
            'report_date': raw.get('print_date', ''), 'printed_by': raw.get('name', ''), 'printed_by_id': raw.get('username', '')}


def parse_file(path):
    soup = BeautifulSoup(open(path, encoding='utf-8', errors='replace').read(), 'lxml')
    for s in soup.find_all('script'):
        s.decompose()
    header = parse_header(soup)
    if 'Anesthesia' in header.get('report_format', ''):
        from cores_parse_anes import parse_row as parse_row_fn
    else:
        parse_row_fn = parse_row
    records = []
    for tr in soup.select('tr.row_template'):
        if tr.find('td', attrs={'column_name': True}):
            records.append(parse_row_fn(tr))
    return {'header': header, 'source': path, 'records': records}


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    data = parse_file(sys.argv[1])
    out = sys.argv[2] if len(sys.argv) > 2 else re.sub(r'\.html?$', '', sys.argv[1]) + '.json'
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, indent=1, ensure_ascii=False)
    print(f"{len(data['records'])} records -> {out}")

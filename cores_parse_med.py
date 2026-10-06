"""Row parser for the CORES 'Medicine Report +VS/Meds' (report_id 7; five columns: Pt Info, Pt Summary, Vitals/Meds,
Tasks/Plan, Notes). Produces the same record shape as the I-PASS parser in cores_parse.py (field names per
REPORT_GLOSSARY.md). The report has no labs, vent, I&O or lines; its vitals come as a LAST / MIN / MAX table, with
temperature in degrees C.

Used automatically by cores_parse.parse_file() when the report title contains 'Medicine'.
"""
import re

from bs4 import BeautifulSoup

from cores_parse import BR, MED_KEYS, clean, lines_of, parse_summary, split_location, txt

# Vitals table column headers -> field names. The 'O2' column is skipped on purpose: it seems to take any result with
# O2 in its name, blood gases included (VBG pO2 ~40, FiO2 21 / 40 / 50, flow 2 / 0, saturations), so its LAST / MIN / MAX
# mean nothing.
VITAL_COLS = {'Temp': 'temp', 'SBP': 'sbp', 'DBP': 'dbp', 'HR': 'hr', 'RR': 'rr', 'SpO2': 'spo2'}


def parse_pt_info(td):
    """Gray bar = patient name; section 'Patient Info' = MRN | DOB | age sex, then unit - room bed, then labelled rows
    (LOS, COVID when tested, Allergies, Diet)."""
    rows = td.find(class_='section', section_name='Patient Info').find_all('tr')
    mrn, dob, age, sex = ([txt(x) for x in rows[0].find_all(class_='t4m_report_field')] + [''] * 4)[:4]
    unit, room, bed = ([txt(x) for x in rows[1].find_all(class_='t4m_report_field')] + [''] * 3)[:3]
    labelled = {}
    for tr in rows[2:]:
        m = re.match(r'^([A-Za-z ]+): ?(.*)$', txt(tr))
        if m:
            labelled[m.group(1)] = re.sub(r'\( ?(.*?) ?\)', r'(\1)', clean(m.group(2)))  # 'Not Detected ( 09/27 )'
    los = labelled.get('LOS', '')
    rec = split_location(unit, room, bed)
    rec.update({
        'patient_name': txt(td.find(class_='t4m_report_field')), 'mrn': mrn, 'dob': dob, 'age': age, 'sex': sex,
        'los_days': int(los) if los.isdigit() else None, 'covid': labelled.get('COVID', ''), 'isolation': '',
        'allergies': labelled.get('Allergies', ''), 'diet': labelled.get('Diet', ''),
    })
    return rec


def parse_vitals(sec):
    """Header row of labels, then LAST / MIN / MAX rows. Cells are read by position: an uncharted vital (no cuff BP
    with an arterial line) is an empty cell, so reading the text in order would shift every later value."""
    if sec is None:
        return {}
    trs = sec.find_all('tr')
    heads = [txt(c) for c in trs[0].find_all('td')]
    rows = {}
    for tr in trs[1:]:
        cells = [txt(c) for c in tr.find_all('td')]
        if cells:
            rows[cells[0].rstrip(':').lower()] = cells  # 'last' / 'min' / 'max'
    vitals = {}
    for i, h in enumerate(heads):
        if h not in VITAL_COLS:
            continue
        v = {k: (rows.get(k) or [])[i] if i < len(rows.get(k) or []) else '' for k in ('last', 'min', 'max')}
        if any(v.values()):
            vitals[VITAL_COLS[h]] = v
    return vitals


def parse_meds(sec, name):
    """One '• drug<span>dose frequency</span>' per <br>, the drug bold when highlighted, then an optional '@ ...' tag
    (bold, or plain for a date): time since the last PRN dose, or an IV drip's current rate
    ('norepinephrine @ 0.18 mcg/kg/min'). The first entry shares its <br> segment with the section heading."""
    items = []
    for piece in BR.split(''.join(str(c) for c in sec.contents)):
        frag = BeautifulSoup(piece, 'lxml')
        for h in frag.find_all(class_='column_section_header'):
            h.decompose()
        det_el, tag = frag.find('span'), ''
        if det_el:
            for sib in list(det_el.next_siblings):
                tag += ' ' + (sib.get_text(' ') if hasattr(sib, 'get_text') else str(sib))
                sib.extract()
            det_el.extract()
        detail = txt(det_el) if det_el else ''
        drug = re.sub(r'^•\s*', '', txt(frag))
        if not drug and not detail:
            continue
        item = {'drug': drug, 'dose_frequency': detail, 'highlighted': bool(frag.find('b'))}
        m = re.match(r'^(\d+) - (.*)$', drug)
        if m:
            item['days_on'] = int(m.group(1))
            item['drug'] = m.group(2)
        if '@' in tag:
            item['rate' if name == 'infusions' else 'last_dose'] = clean(tag.split('@', 1)[1])
        items.append(item)
    return items


def parse_vitals_meds(td):
    out = {'vitals': parse_vitals(td.find(class_='section', section_name='Vitals')), 'meds': {}}
    for sec in td.find_all('span', class_='section'):
        name = MED_KEYS.get(sec.get('section_name'))
        if name:
            out['meds'][name] = parse_meds(sec, name)
    return out


def parse_tasks_plan(td):
    """Gray bar = code status; 'Action Items' = a task list (one div per task, all unchecked in this report);
    'Sit. Aware. / Contingency' = free-text lines (and a second field after it, empty so far)."""
    fields = td.find_all(class_='t4m_report_field')
    sit = [ln for f in fields[1:] if 'task_list' not in (f.get('class') or []) for ln in lines_of(f)]
    return {'code_status': txt(fields[0]) if fields else '',
            'tasks': ['[ ] ' + txt(x) for x in td.find_all(class_='task_list_item') if txt(x)],
            'sit_awareness': sit}


def parse_row(tr):
    c = {td['column_name']: td for td in tr.find_all('td', attrs={'column_name': True})}
    rec = parse_pt_info(c['Pt Info'])
    rec['severity'] = txt(c['Pt Summary'].find(class_='t4m_report_field'))  # gray bar: Stable / Watcher / Unstable
    rec['admit_diagnosis'] = ''  # the report's 'Admission Dx' section is commented out in its template
    rec['summary'] = parse_summary(c['Pt Summary'].find(class_='section', section_name='Pt Summary'))
    rec.update(parse_vitals_meds(c['Vitals/Meds']))
    rec['o2_delivery'] = ''
    rec.update(parse_tasks_plan(c['Tasks/Plan']))
    rec['notes'] = lines_of(c['Notes'].find(class_='t4m_report_field'))
    return rec

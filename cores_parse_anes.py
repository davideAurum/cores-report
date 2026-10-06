"""Row parser for the CORES 'Anesthesia Report' (nine columns: Bed, Patient, Summary, Access, PROCEDURES/VITALS,
SYSTEMS, Results, Handoff, Action List). Produces the same record shape as the I-PASS parser in cores_parse.py
(field names per REPORT_GLOSSARY.md).

Used automatically by cores_parse.parse_file() when the patient rows have these columns (cores_parse.LAYOUTS).
"""
import re

from bs4 import BeautifulSoup

from cores_parse import BR, MED_KEYS, clean, fishbone_labs, lines_of, normalize_vent, split_location, txt, vitals_from_text


def parse_bed(td):
    f = [txt(x) for x in td.find_all(class_='t4m_report_field')]
    unit, room, bed = (f + ['', '', ''])[:3]
    t = txt(td)
    iso = re.search(r'Isolation (.*?Precautions)', t)
    covid = re.search(r'COVID: ?(.*?)(?= Isolation|\[|$)', t)
    rec = split_location(unit, room, bed)
    rec.update({
        'code_status': f[3] if len(f) > 3 and not f[3].startswith('Isolation') and not re.match(r'\d\d/\d\d', f[3]) else '',
        'isolation': clean(iso.group(1)) if iso else '',
        'covid': clean(covid.group(1)) if covid and covid.group(1).strip() else '',
    })
    return rec


def parse_patient(td):
    f = [txt(x) for x in td.find_all(class_='t4m_report_field')]
    t = txt(td)

    def grab(label, stop=r'(?= (?:MRN|DOB|LOS|ADT Att|ADT Srvc|Allergy|Contact):|$)'):
        m = re.search(re.escape(label) + r': ?(.*?)' + stop, t)
        return clean(m.group(1)) if m else ''
    dob = re.search(r'DOB: ?(\S+) (\S+) (\S+)', t)
    los = grab('LOS')
    return {
        'patient_name': f[0] if f else '', 'mrn': grab('MRN'),
        'dob': dob.group(1) if dob else '', 'age': dob.group(2) if dob else '', 'sex': dob.group(3) if dob else '',
        'los_days': int(los) if los.isdigit() else None,
        'admit_attending': grab('ADT Att'), 'admit_service': grab('ADT Srvc'), 'allergies': grab('Allergy'), 'contact': grab('Contact'),
    }


def parse_summary(td):
    dx = ''
    narrative, status, lines = [], {}, []
    for sec in td.find_all(class_='section'):
        name = (sec.get('section_name') or '').rstrip('`')
        if name == 'Dx':
            dx = clean(txt(sec).replace('Dx:', '', 1))
        else:
            fld = sec.find(class_='t4m_report_field')
            lines = lines_of(fld)
            for ln in lines:
                m = re.match(r'^([A-Za-z][A-Za-z /]{0,20}):\s*(.*)$', ln)
                if m and len(ln) < 80:
                    status[m.group(1)] = m.group(2)
                else:
                    narrative.append(ln)
    return dx, {'narrative': narrative, 'status': status, 'lines': lines}


def parse_access(td):
    out = {'tld': [], 'vent': None, 'diet': '', 'tube_feeds': '', 'restraints': ''}
    sec = td.find(class_='section', section_name='TLD/Diet/Restraint')
    if sec:
        box = sec.find('div', style=re.compile('nowrap'))
        for ln in (lines_of(box) if box else []):
            ln = re.sub(r'^\u2022\s*', '', ln)
            m = re.match(r'^(\d+)-(.*)$', ln)      # "7-Left, Femoral vein 7 French CVL Insert" = 7 days since placed
            out['tld'].append({'days': int(m.group(1)), 'description': m.group(2).strip()} if m else {'days': None, 'description': ln})
    vent = td.find('span', title='Vent')
    if vent:
        raw = {}
        for d in vent.find_all('div', class_='hide_if_empty'):
            s = txt(d)
            if ': ' in s:
                k, val = s.split(': ', 1)
                raw[k.strip()] = val.strip()
        if raw:
            out['vent'] = normalize_vent(raw)
    for d in td.find_all('div', class_='section'):
        b = d.find('b')
        label = txt(b).rstrip(': ').strip() if b else ''
        val = clean(txt(d).replace(txt(b), '', 1)) if b else txt(d)
        if label == 'Diet':
            out['diet'] = val
        elif label == 'TF':
            out['tube_feeds'] = val
        elif label == 'Restraint':
            out['restraints'] = val
    return out


def parse_vitals(td):
    procedures = ''
    m = re.search(r'Procedures: ?(.*?) ?Vitals:', txt(td))
    if m:
        procedures = clean(m.group(1))
    vt = txt(td).split('Vitals:', 1)[-1]
    vitals, o2 = vitals_from_text(vt)
    return procedures, vitals, o2


def parse_results(td):
    out = {'labs': fishbone_labs(td), 'gases': [], 'io': None, 'net_io_since_admission': '', 'glucose_trend': [], 'lactate_trend': []}
    t = txt(td)
    for m in re.finditer(r'(\d\d/\d\d \d\d:\d\d) - ([\d.]+) / ([\d.]+) / ([\d.]+) / ([\d.]+)(?: / ([\d.]+) ?% on ([\d.]+) ?%)?', t):
        vals = {'pH': m.group(2), 'pCO2': m.group(3), 'pO2': m.group(4), 'HCO3': m.group(5)}
        if m.group(6):
            vals['SaO2'] = m.group(6) + '%'
            vals['FiO2'] = m.group(7) + '%'
        out['gases'].append({'type': 'ABG', 'time': m.group(1), 'values': vals})
    for label, key in (('Glu', 'glucose_trend'), ('LA', 'lactate_trend')):
        m = re.search(label + r': ?([\d.]+(?:\s*\u2192\s*[\d.]+)*)', t)
        if m:
            out[key] = [x.strip() for x in m.group(1).split('\u2192')]
    if out['lactate_trend']:
        v = out['lactate_trend']
        out['labs']['lactate'] = {'current': v[-1], 'prior': v[-2] if len(v) > 1 else ''}
    m = re.search(r'Fluid Balance: ?(-?[\d,]+ mL)', t)
    out['net_io_since_admission'] = m.group(1) if m else ''
    io = td.find(class_='report_io_table')
    if io:
        rows = [[txt(x) for x in rr.find_all(class_=re.compile('report_io_table_cell'))]
                for rr in io.find_all(class_=re.compile('^report_io_table_row'))]
        if rows:
            out['io'] = {'columns': rows[0][1:], 'rows': {rr[0].strip(): rr[1:] for rr in rows[1:] if rr}}
    return out


def parse_handoff(td):
    out = {}
    for sec in td.find_all(class_='section'):
        name = sec.get('section_name', '')
        body = clean(txt(sec).replace(name + ':', '', 1))
        if body:
            out[name] = body
    return out


def parse_action(td):
    out = {'tasks': [], 'sit_awareness': []}
    for sec in td.find_all(class_='section'):
        fld = sec.find(class_='t4m_report_field')
        items = lines_of(fld) if fld else []
        if sec.get('section_name') == 'Action List':
            out['tasks'] = items
        else:
            out['sit_awareness'] = items
    return out


def parse_meds_row(tr):
    """Full-width row: <u><b>Antibiotics:</b></u> • 2 - drug<span>dose freq</span>; • ... <u><b>Scheduled Meds:</b></u> ..."""
    meds = {}
    cell = tr.find('td')
    if cell is None:
        return meds
    parts = re.split(r'<u>\s*<b>([^<]+?):\s*</b>\s*</u>', ''.join(str(c) for c in cell.contents))
    for label, body in zip(parts[1::2], parts[2::2]):
        name = MED_KEYS.get(label.strip(), label.strip().lower())
        items = []
        for chunk in body.split('\u2022'):
            frag = BeautifulSoup(chunk, 'lxml')
            det_el = frag.find('span')
            detail = txt(det_el) if det_el else ''
            if det_el:
                det_el.decompose()
            drug = txt(frag).strip(' ;\xa0')
            if not drug and not detail:
                continue
            item = {'drug': drug, 'dose_frequency': detail.strip(' ;\xa0'), 'highlighted': bool(BeautifulSoup(chunk, 'lxml').find('b'))}
            m = re.match(r'^(\d+) - (.*)$', item['drug'])
            if m:
                item['days_on'] = int(m.group(1))
                item['drug'] = m.group(2)
            items.append(item)
        meds[name] = items
    return meds


def parse_row(tr):
    c = {td['column_name']: td for td in tr.find_all('td', attrs={'column_name': True})}
    rec = parse_bed(c['Bed'])
    rec.update(parse_patient(c['Patient']))
    rec['admit_diagnosis'], rec['summary'] = parse_summary(c['Summary'])
    rec.update(parse_access(c['Access']))
    rec['procedures'], rec['vitals'], rec['o2_delivery'] = parse_vitals(c['PROCEDURES/VITALS'])
    rec['systems'] = clean(txt(c['SYSTEMS']))
    rec.update(parse_results(c['Results']))
    rec['handoff'] = parse_handoff(c['Handoff'])
    rec.update(parse_action(c['Action List']))
    meds_tr = next((r for r in tr.find_all('tr') if r.find('u') and r.find('td', attrs={'colspan': '9'})), None)
    rec['meds'] = parse_meds_row(meds_tr) if meds_tr is not None else {}
    rec['notes'] = []
    return rec

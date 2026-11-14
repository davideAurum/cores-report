"""Write a made-up CORES report (JSON) for testing the Daily Report's layout and printing, with no PHI in it.

Usage:  python make_synthetic.py [out.json] [--patients N] [--seed S]
        python cores_report.py out.json            # then render it like any parsed capture

Every patient, MRN, date of birth and clinical detail is invented (names are "Testpatient, Alpha" and so on, MRNs start
with 999). Units are the ones UNIT_PINNED in cores_report.py knows, plus one it does not, so the unit colors and the unit
locations both get exercised. The default output, reports/SYNTHETIC test report.json, is inside the git-ignored reports
folder like everything else this tool writes.
"""
import json
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
GREEK = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima',
         'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'Xray']
UNITS = [('MICU', 'MI'), ('MICU', 'MI'), ('MICU', 'MI'), ('MCCU', 'P'), ('CCU', 'C'), ('ICVU', 'V'), ('NICU', 'N'),
         ('BMT', 'B'), ('UED', ''), ('ZZTEST', 'Z')]
DX = ['Septic shock from pneumonia', 'Acute hypoxemic respiratory failure', 'DKA', 'Upper GI bleed', 'COPD exacerbation',
      'Cardiogenic shock', 'Status epilepticus', 'Alcohol withdrawal', 'Pulmonary embolism', 'Neutropenic fever']
STORY = ('Made-up patient for layout testing. Presented with {dx}; intubated in the ED and started on pressors. '
         'Cultures pending, on broad-spectrum antibiotics. Family updated at bedside. Plan to reassess sedation and '
         'try a spontaneous breathing trial in the morning if FiO2 stays at or below 40%.')
DRIPS = [('Norepinephrine', '0.08 mcg/kg/min'), ('Propofol', '30 mcg/kg/min'), ('Fentanyl', '50 mcg/hr'),
         ('Vasopressin', '0.03 units/min'), ('Insulin regular', '4 units/hr'), ('Heparin', '18 units/kg/hr')]
ABX = [('Vancomycin', '1,250 mg IV q12h'), ('Cefepime', '2 g IV q8h'), ('Piperacillin-tazobactam', '4.5 g IV q6h'),
       ('Azithromycin', '500 mg IV daily')]
SCHED = [('Pantoprazole', '40 mg IV daily'), ('Enoxaparin', '40 mg subcut daily'), ('Chlorhexidine', '15 mL oral BID'),
         ('Thiamine', '100 mg IV daily'), ('Metoprolol tartrate', '25 mg per tube q12h'), ('Senna', '17.2 mg per tube nightly')]
PRN = [('Acetaminophen', '650 mg per tube q6h PRN fever'), ('Ondansetron', '4 mg IV q6h PRN nausea'),
       ('Hydromorphone', '0.5 mg IV q3h PRN pain'), ('Albuterol', '2.5 mg neb q4h PRN wheeze')]


def med(drug, detail, rng, rate=''):
    return {'drug': drug, 'dose_frequency': detail, 'days_on': str(rng.randint(1, 9)), 'highlighted': rng.random() < .15,
            'last_dose': '', 'rate': rate}


def patient(i, rng):
    unit, pre = UNITS[i % len(UNITS)]
    room = f'{pre}{rng.randint(1, 40):02d}' if pre else ''
    bed = '01' if room else ''
    dx = DX[i % len(DX)]
    vented = rng.random() < .6
    days = ['9/12', '9/13', '9/14', 'Yst', 'Tdy']
    intake = [rng.randint(800, 3500) for _ in days]
    urine = [rng.randint(300, 2500) for _ in days]
    output = [u + rng.choice([0, 0, 150, 400]) for u in urine]
    return {
        'unit': unit, 'room': room, 'bed': bed, 'location': (unit + (' ' + room if room else '') + ('-' + bed if bed else '')).strip(),
        'code_status': rng.choice(['Full Code', 'Full Code', 'DNR']), 'isolation': 'Contact Precautions' if i % 4 == 0 else '',
        'covid': '', 'severity': rng.choice(['Unstable', 'Watcher', 'Stable']),
        'patient_name': f'TESTPATIENT, {GREEK[i % len(GREEK)].upper()}', 'mrn': f'999{i:05d}', 'dob': f'01/01/{1940 + i}',
        'age': f'{86 - i}y', 'sex': 'MF'[i % 2], 'los_days': rng.randint(0, 21), 'admit_attending': 'Doctor, Test',
        'admit_service': 'MICU', 'allergies': rng.choice(['NKA', 'Penicillin', 'Sulfa, Iodinated contrast']), 'contact': '',
        'admit_diagnosis': f'ADMIT: {dx.upper()}',
        'summary': {'narrative': [STORY.format(dx=dx.lower())], 'status': {'Abx': 'Vanc/cefepime', 'Pressors': 'Levo'} if vented else {},
                    'lines': []},
        'tld': [{'days': str(rng.randint(1, 8)), 'description': 'Right internal jugular vein triple-lumen CVC'},
                {'days': str(rng.randint(1, 8)), 'description': 'Left radial arterial line'},
                {'days': str(rng.randint(1, 8)), 'description': 'Urethral catheter 16 Fr'}],
        'vent': {'mode': 'PRVC (Pressure regulated volume control)', 'set_rate': '18', 'vt_set': '420', 'fio2': str(rng.choice([30, 40, 60])),
                 'peep': str(rng.choice([5, 8, 10])), 'vt_measured': '415'} if vented else None,
        'diet': rng.choice(['NPO', 'Tube feeds: Vital 1.5 at 50 mL/hr', 'Regular cardiac diet']), 'tube_feeds': '', 'restraints': '',
        'procedures': [],
        'vitals': {'temp': {'last': '38.3', 'min': '36.9', 'max': '38.9'}, 'hr': {'last': str(rng.randint(70, 125)), 'min': '68', 'max': '131'},
                   'sbp': {'last': str(rng.randint(85, 140)), 'min': '80', 'max': '150'}, 'dbp': {'last': '58', 'min': '42', 'max': '80'},
                   'map_noninvasive': {'last': '67', 'min': '55', 'max': '95'}, 'rr': {'last': '22', 'min': '14', 'max': '30'},
                   'spo2': {'last': str(rng.randint(88, 99)), 'min': '86', 'max': '100'}, 'gcs': {'last': '10T', 'min': '', 'max': ''}},
        'o2_delivery': 'Ventilator' if vented else rng.choice(['NC', 'HFNC', 'RA']),
        'gases': [{'type': 'ABG', 'time': '04:12', 'values': {'pH': '7.31', 'pCO2': '48', 'pO2': '72', 'HCO3': '23'}}] if vented else [],
        'labs': {k: {'current': c, 'prior': p} for k, c, p in [
            ('wbc', '14.2', '16.8'), ('hgb', '8.1', '8.4'), ('hct', '24.6', '25.9'), ('plt', '142', '160'), ('na', '134', '131'),
            ('k', '4.9', '5.4'), ('cl', '101', '99'), ('co2', '20', '18'), ('bun', '38', '41'), ('creatinine', '2.1', '2.4'),
            ('glucose', '182', '240'), ('ca', '8.1', '7.9'), ('mg', '1.8', '1.6'), ('phos', '4.6', '5.1'), ('lactate', '2.8', '4.1'),
            ('pt', '15.2', '16.0'), ('ptt', '38', '41'), ('inr', '1.4', '1.5'), ('albumin', '2.6', '2.7'), ('total_bili', '1.3', '1.6'),
            ('ast', '64', '88'), ('alt', '52', '61'), ('alk_phos', '110', '120'), ('total_protein', '5.6', '5.8'), ('direct_bili', '0.4', '0.5')]},
        'glucose_trend': ['201', '240', '166', '182'], 'lactate_trend': ['5.0', '4.1', '2.8'],
        'net_io_since_admission': f'{rng.randint(-2000, 9000):,} mL',
        'io': {'columns': days, 'rows': {'Intake': [str(x) for x in intake], 'Output': [str(x) for x in output],
                                         'Urine': [str(x) for x in urine], 'Net': [f'{a - b:+d}' for a, b in zip(intake, output)]}},
        'handoff': {},
        'tasks': ['[ ] Follow up blood cultures', '[ ] Repeat lactate at noon', '[ ] Call family after rounds'][:rng.randint(0, 3)],
        'sit_awareness': ['- If MAP < 65 despite levo 0.2, add vasopressin', '- Hold sedation at 06:00 for SAT'],
        'meds': {'infusions': [med(d, r, rng, r) for d, r in rng.sample(DRIPS, rng.randint(0, 3))],
                 'antibiotics': [med(d, r, rng) for d, r in rng.sample(ABX, rng.randint(0, 2))],
                 'scheduled': [med(d, r, rng) for d, r in rng.sample(SCHED, rng.randint(2, 6))],
                 'prn': [med(d, r, rng) for d, r in rng.sample(PRN, rng.randint(1, 4))]},
        'notes': [],
    }


def main(argv):
    n = int(argv[argv.index('--patients') + 1]) if '--patients' in argv else 14
    seed = int(argv[argv.index('--seed') + 1]) if '--seed' in argv else 7
    skip = {argv.index(f) + 1 for f in ('--patients', '--seed') if f in argv}
    args = [a for i, a in enumerate(argv) if not a.startswith('--') and i not in skip]
    out = Path(args[0]) if args else HERE / 'reports' / 'SYNTHETIC test report.json'
    rng = random.Random(seed)
    records = [patient(i, rng) for i in range(n)]
    # each patient's team, as a capture from a CORES list of two teams brings it (cores_parse.attach_teams); the last
    # patient has none, so the report's Team field is exercised both ways
    teams = ['Pulmonary - Consult', 'Pulmonary IP - IP']
    for i, r in enumerate(records[:-1]):
        r['team'] = teams[i % 3 == 2]
    data = {'header': {'report_format': 'SYNTHETIC test report (no real patients)', 'service': '', 'team': ', '.join(teams), 'teams': teams,
                       'report_date': '09/15/26 06:30', 'printed_by': 'Test User', 'printed_by_id': 'test'},
            'source': out.name, 'records': records}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=1), encoding='utf-8')
    print(f'{n} made-up patients -> {out}')


if __name__ == '__main__':
    main(sys.argv[1:])

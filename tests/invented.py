"""Invented captures and a temporary cores setup, shared by the tests. Nothing here is a real report: the "patients"
are made-up names (ZZTEST, ...) on a made-up unit, written the way report 281 (Anesthesia ICU w/ Meds, nine columns)
lays a row out. No test reads a real capture, the real clipboard or the real log folder.
"""
import contextlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cores  # noqa: E402
import cores_log  # noqa: E402

HAVE_PARSER = all(importlib.util.find_spec(m) for m in ('bs4', 'lxml'))
NEEDS_PARSER = unittest.skipUnless(HAVE_PARSER, 'needs beautifulsoup4 and lxml')

HEADER = ('<table class="page_header_template"><tr><td>UAB Core Work Mgr Anesthesia Report</td>'
          '<td><span field="service">Zservice</span> <span field="team">Zteam</span> <span field="print_date">11/14/26 07:00</span></td></tr></table>')


def row(n, name=None, drop=()):
    """One invented patient row of report 281; `drop` leaves columns out (a row cores cannot read)."""
    name = name or f'ZZTEST, PATIENT{n}'
    cells = {
        'Bed': f'<span class="t4m_report_field">ZICU</span><span class="t4m_report_field">Z{100 + n}</span>'
               '<span class="t4m_report_field">01</span><span class="t4m_report_field">Full Code</span>',
        'Patient': f'<span class="t4m_report_field">{name}</span> MRN: 99900{n:02d} DOB: 01/01/1950 76y M LOS: {n} '
                   'ADT Att: Zzdoc ADT Srvc: Ztest Allergy: NKA Contact: none',
        'Summary': f'<span class="section" section_name="Dx">Dx: invented diagnosis {n}</span>'
                   f'<span class="section" section_name="Summary"><span class="t4m_report_field">Invented summary {n}</span></span>',
        'Access': '',
        'PROCEDURES/VITALS': 'Procedures: none Vitals: T: 98.6 ( 97.0 - 99.0 ) HR: 80 ( 70 - 90 )',
        'SYSTEMS': '',
        'Results': '',
        'Handoff': '',
        'Action List': '',
    }
    tds = ''.join(f'<td column_name="{col}">{body}</td>' for col, body in cells.items() if col not in drop)
    return f'<tr class="row_template">{tds}</tr>'


def capture(name='CORES report 281 2026-11-14 0700.html', patients=3, rows=None, comment=True):
    """A whole invented capture as captureCores() writes it: its name in the first comment, the report, </html> last."""
    rows = rows if rows is not None else [row(i + 1) for i in range(patients)]
    first = f'<!-- CORES capture {name} -->\n' if comment else ''
    return f'{first}<html><head><title>x</title></head><body class="t4m_report">\n{HEADER}\n<table>\n' + '\n'.join(rows) + '\n</table>\n</body>\n</html>'


class FakeClipboard:
    """Stands in for the Windows clipboard: cores.clipboard_text and cores.to_clipboard read and write its text."""

    def __init__(self, text=''):
        self.text, self.writes = text, []

    def read(self):
        return self.text

    def write(self, text):
        self.text = text
        self.writes.append(text)
        return True


class TempCores(unittest.TestCase):
    """cores.py with a temporary cores.config.json: the reports folder, the inbox ("Downloads") and the log folder
    are all inside one temporary folder, and the clipboard is a FakeClipboard."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.reports, self.inbox, self.log = self.tmp / 'reports', self.tmp / 'inbox', self.tmp / 'log'
        self.inbox.mkdir()
        self.config = self.tmp / 'cores.config.json'
        self.settings()
        self.clip = FakeClipboard()
        cores_log._noted = False
        for p in (mock.patch.object(cores, 'CONFIG_FILE', self.config), mock.patch.dict(os.environ, {'COMPUTERNAME': 'PC-A'}),
                  mock.patch.object(cores, 'clipboard_text', self.clip.read), mock.patch.object(cores, 'to_clipboard', self.clip.write),
                  mock.patch.object(cores, 'open_in_browser', lambda *a, **k: 'no browser in a test')):
            p.start()
            self.addCleanup(p.stop)

    def settings(self, **changes):
        cfg = {'reports_dir': str(self.reports), 'inbox_dirs': [str(self.inbox)], 'check_updates': False, 'open_after_run': False,
               'log_dir': str(self.log)}
        cfg.update(changes)
        self.config.write_text(json.dumps(cfg), encoding='utf-8')

    def run_cores(self, *argv):
        """(exit code, what it printed)"""
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = cores.main(list(argv))
        return code, out.getvalue()

    def download(self, name='CORES report 281 2026-11-14 0700.html', text=None, **kw):
        """Put an invented capture in the inbox, as the browser's download would."""
        p = self.inbox / name
        p.write_text(text if text is not None else capture(name, **kw), encoding='utf-8', newline='')
        return p

    def names(self, folder=None):
        folder = folder or self.reports
        return sorted(p.name for p in folder.iterdir()) if folder.is_dir() else []

    def log_entries(self):
        f = cores_log.log_file(self.log, 'PC-A')
        return [json.loads(x) for x in f.read_text(encoding='ascii').splitlines()] if f.exists() else []

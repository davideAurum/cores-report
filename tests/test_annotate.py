"""Tests that `cores annotate`'s "Copy list" and the browser's storage carry no text from the report (code review,
finding 1). The capture here is a few invented lines of HTML in a temporary folder; the "patients" are made up.

The part of the annotate page's script that decides what may leave the page has no DOM in it, so it is run here under
node (those tests are skipped on a PC without node). The rest is checked on the page's text.

    python -m unittest discover -s tests -v
"""
import contextlib
import io
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import annotate_source  # noqa: E402

NODE = shutil.which('node')

# invented patient text: none of these words may reach the copied list or the storage
SECRETS = ('ZZTESTPATIENT', 'Zzdaughter', '9990001', 'zzfreetext')

CAPTURE = """<!-- CORES capture CORES report test.html -->
<html><head><meta charset="windows-1250"></head><body class="t4m_report"><table>
<tr class="row_template"><td column_name="Patient"><span class="t4m_report_field">ZZTESTPATIENT, ONE</span> MRN: 9990001</td></tr>
</table></body></html>"""


def pure_block():
    m = re.search(r'/\*PURE\*/(.*?)/\*END PURE\*/', annotate_source.OVERLAY, re.S)
    assert m, 'the /*PURE*/ ... /*END PURE*/ block is missing from annotate_source.OVERLAY'
    return m.group(1)


def node(driver):
    """Run the pure block plus `driver` (which must console.log one JSON value) under node; the value."""
    r = subprocess.run([NODE, '-'], input=pure_block() + '\n' + driver, capture_output=True, text=True, encoding='utf-8', timeout=60)
    if r.returncode:
        raise AssertionError(r.stderr)
    return json.loads(r.stdout)


# Three invented patient rows as the page describes them to sharedIn(): their text and their column / section / title names.
ROWS = """
var rows = [
  {text: 'ZZTESTPATIENT, ONE MRN: 9990001 Diet: Regular Infusions: Intake 100 Zzdaughter Jane: 555-0100', names: {'=Patient': 1, '=Summary': 1, '=Vent': 1, '=zzfreetext tooltip': 1}},
  {text: 'ZZTESTPATIENT, TWO MRN: 9990002 Diet: NPO Infusions: Intake 200', names: {'=Patient': 1, '=Summary': 1, '=Vent': 1}},
  {text: 'ZZTESTPATIENT, THREE MRN: 9990003 Diet: Cardiac Infusions: Intake 300', names: {'=Patient': 1, '=Summary': 1}}
];
var shared = sharedIn(rows);
"""

LEGACY = """
var legacy = [
  {name: 'pt name', parser: 'Column "Patient" › Section "Summary" › Label "Diet" › value field',
   path: 'tr.row_template > td.cell[column_name="Patient"] > span.t4m_report_field', sample: 'ZZTESTPATIENT, ONE 9990001'},
  {name: 'contact', parser: 'Column "Patient" › Label "Zzdaughter Jane"', path: 'td > b', sample: 'Zzdaughter Jane: 555-0100'},
  {name: 'tooltip', parser: 'Column "Patient" › Section "zzfreetext tooltip" › Lab slot WBC (prior) › field=name', path: 'td[column_name="zzfreetext"] > i', sample: 'zzfreetext'},
  {name: 'meds', parser: 'Meds row › Meds section "Infusions" › I&O table row "Intake" › Meds section "Zzdaughter"', path: 'td > u', sample: 'x'},
  {name: 'odd', parser: 'Label "a" zzfreetext "b" › zzfreetext › Label ""', path: 'td > zzfreetext 9990001 > b', sample: 'x', extra: 'ZZTESTPATIENT'},
  'ZZTESTPATIENT', null
];
"""


@unittest.skipUnless(NODE, 'needs node to run the annotate page\'s script')
class WhatLeavesThePage(unittest.TestCase):
    def test_an_older_copys_entries_lose_their_sample_and_any_text_not_shared_by_3_patients(self):
        got = node(ROWS + LEGACY + 'var clean = legacy.map(function(a){ return cleanEntry(a, shared); });\n'
                   'console.log(JSON.stringify({clean: clean, text: listText(clean)}));')
        clean = got['clean']
        for entry in clean:
            self.assertEqual(sorted(entry), ['name', 'parser', 'path'])
        self.assertEqual(clean[0], {'name': 'pt name', 'parser': 'Column "Patient" › Section "Summary" › Label "Diet" › value field',
                                    'path': 'tr.row_template > td.cell[column_name="Patient"] > span.t4m_report_field'})
        self.assertEqual(clean[1]['parser'], 'Column "Patient" › Label (left out)')       # in one patient's row only
        self.assertEqual(clean[2]['parser'], 'Column "Patient" › Section (left out) › Lab slot WBC (prior) › field=name')
        self.assertEqual(clean[2]['path'], 'td[column_name (left out)] > i')
        self.assertEqual(clean[3]['parser'], 'Meds row › Meds section "Infusions" › I&O table row "Intake" › Meds section (left out)')
        self.assertEqual(clean[4]['parser'], '(left out) › (left out) › (left out)')
        self.assertEqual(clean[4]['path'], 'td > ? > b')
        self.assertEqual(clean[5], {'name': '', 'parser': '(left out)', 'path': '?'})
        everything = json.dumps(got)
        for word in SECRETS:
            self.assertNotIn(word, everything)
        self.assertNotIn('e.g.', got['text'])
        self.assertIn('1. "pt name"  =  Column "Patient"', got['text'])

    def test_cleaning_twice_changes_nothing(self):
        """An entry is cleaned when it is made, when the page loads and when the list is copied: the result must hold still."""
        got = node(ROWS + LEGACY + 'var once = legacy.map(function(a){ return cleanEntry(a, shared); });\n'
                   'console.log(JSON.stringify({once: once, twice: once.map(function(a){ return cleanEntry(a, shared); })}));')
        self.assertEqual(got['once'], got['twice'])

    def test_a_label_counts_as_the_reports_wording_from_three_patients_up(self):
        got = node(ROWS + 'var two = sharedIn(rows.slice(0, 2));\n'
                   'console.log(JSON.stringify({three: [shared("attr", "Patient"), shared("text", "Diet:"), shared("attr", "Vent"), '
                   'shared("text", "Zzdaughter Jane:"), shared("attr", "zzfreetext tooltip"), shared("text", "9990001")], '
                   'two: [two("attr", "Patient"), two("text", "Diet:")], none: sharedIn([])("attr", "Patient")}));')
        self.assertEqual(got['three'], [True, True, False, False, False, False])
        self.assertEqual(got['two'], [False, False])     # a list of two patients: nothing read from the page is copied
        self.assertFalse(got['none'])

    def test_the_annotations_of_other_captures_lose_their_samples_too(self):
        got = node(LEGACY + 'console.log(JSON.stringify(withoutSample(legacy.slice(0, 2))));')
        self.assertEqual([sorted(e) for e in got], [['name', 'parser', 'path']] * 2)
        self.assertNotIn('9990001', json.dumps(got))
        self.assertEqual(node('console.log(JSON.stringify(withoutSample("not a list")));'), [])


class ThePage(unittest.TestCase):
    def test_nothing_in_the_script_stores_or_copies_a_parts_text(self):
        js = annotate_source.OVERLAY
        self.assertNotIn('sample:', js)          # what the older copy stored: the first 80 characters of the part
        self.assertNotIn('.sample', js)
        self.assertNotIn('e.g.', js)
        self.assertNotIn('for Claude', js)
        self.assertIn('It carries no text from the report', js)
        # the three places where an entry is made, read back or copied all go through cleanEntry()
        self.assertEqual(len(re.findall(r'cleanEntry\(', js)), 4)   # its definition and those three
        self.assertRegex(js, r'ann\.push\(cleanEntry\(\{ name: name, parser: parserName\(pending\), path: pathOf\(pending\) \}, shared\)\)')
        self.assertRegex(js, r'var txt = listText\(ann\.map\(function\(a\)\{ return cleanEntry\(a, shared\); \}\)\);')
        # textOf(...) of the part under the mouse is shown on screen only: in the tip and in the name box
        used = re.findall(r'^.*textOf\((?:t|pending)\).*$', js, re.M)
        self.assertEqual(len(used), 2)
        for line in used:
            self.assertRegex(line, r'^\s*(tip|askInfo)\.innerHTML = ')

    def test_the_annotate_copy_is_written_next_to_the_capture(self):
        with tempfile.TemporaryDirectory() as tmp:
            cap = Path(tmp) / 'CORES report test.html'
            cap.write_text(CAPTURE, encoding='utf-8')
            with contextlib.redirect_stdout(io.StringIO()):
                out = Path(annotate_source.main(str(cap)))
            self.assertEqual(out, Path(tmp) / 'CORES report test - annotate.html')
            html = out.read_text(encoding='utf-8')
            self.assertIn('<meta charset="utf-8">', html)
            self.assertIn('id="ann-panel"', html)
            self.assertIn('ZZTESTPATIENT, ONE', html)     # the copy is the report itself, with the panel added
            self.assertLess(html.index('id="ann-panel"'), html.index('</body>'))
            self.assertNotIn('__SLOT__', html)

    @unittest.skipUnless(NODE, 'needs node')
    def test_the_whole_script_is_valid_javascript(self):
        m = re.search(r'<script>(.*?)</script>', annotate_source.OVERLAY.replace('__SLOT__', annotate_source.SLOT_JS), re.S)
        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp) / 'overlay.js'
            f.write_text(m.group(1), encoding='utf-8')
            r = subprocess.run([NODE, '--check', str(f)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)


if __name__ == '__main__':
    unittest.main()

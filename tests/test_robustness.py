"""Tests for three fixes from the code review: one unreadable patient row no longer stops the report (finding 3),
`cores generate` takes the fresher of Downloads and the clipboard (finding 7), and a wrong `cores config --set` value
is refused instead of saved (finding 12). Every capture is invented (tests/invented.py), the clipboard is a
FakeClipboard, and everything happens in a temporary folder.

    python -m unittest discover -s tests -v
"""
import datetime as dt
import json
import re
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cores  # noqa: E402
from invented import NEEDS_PARSER, TempCores, capture, row  # noqa: E402


def taken(minutes_ago, report=281):
    """The file name captureCores() gives a capture taken that long ago."""
    return f'CORES report {report} {dt.datetime.now() - dt.timedelta(minutes=minutes_ago):%Y-%m-%d %H%M}.html'


def set_of(name):
    """The files one capture leaves in the reports folder."""
    return sorted([name, name[:-5] + ' - Daily Report.html', name[:-5] + '.json'])


# ---------------------------------------------------------------- finding 3: one unreadable row

@NEEDS_PARSER
class UnreadableRow(TempCores):
    def parse(self, rows):
        import cores_parse
        p = self.tmp / 'CORES report test.html'
        p.write_text(capture(p.name, rows=rows), encoding='utf-8')
        return cores_parse.parse_file(str(p))

    def test_the_other_rows_are_parsed_and_the_odd_one_is_marked(self):
        data = self.parse([row(1), row(2, drop=('Results',)), row(3)])
        self.assertEqual(data['unreadable'], {'rows': [2], 'errors': ['KeyError']})
        one, two, three = data['records']
        self.assertEqual([one['patient_name'], three['patient_name']], ['ZZTEST, PATIENT1', 'ZZTEST, PATIENT3'])
        self.assertNotIn('unreadable', one)
        self.assertEqual(one['vitals']['hr'], {'last': '80', 'min': '70', 'max': '90'})
        self.assertTrue(two['unreadable'])
        self.assertEqual((two['patient_name'], two['unit'], two['room'], two['mrn']), ('ZZTEST, PATIENT2', 'ZICU', 'Z102', '9990002'))
        self.assertIn('NOT READ', two['summary']['narrative'][0])
        # nothing else of the row is kept, not even what did parse: half a row would read as "the rest is normal"
        self.assertEqual((two['vitals'], two['meds'], two['labs'], two['code_status'], two['allergies']), ({}, {}, {}, '', ''))

    def test_a_row_without_its_name_cell_is_named_by_its_number(self):
        data = self.parse([row(1), row(2), row(3, drop=('Patient', 'Summary'))])
        three = data['records'][2]
        self.assertEqual((three['patient_name'], three['unit'], three['mrn']), ('ROW 3 NOT READ', 'ZICU', ''))
        self.assertEqual(data['unreadable']['rows'], [3])

    def test_every_layout_can_name_a_row_it_could_not_read(self):
        import importlib
        import cores_parse
        for _, _, module in cores_parse.LAYOUTS:
            m = importlib.import_module(module)
            self.assertTrue(callable(m.parse_row) and callable(m.parse_identity), module)
        # a stand-in takes the bed and the name from what a layout hands it, and nothing else
        rec = cores_parse.unreadable_record(7, {'unit': 'ZICU', 'patient_name': 'ZZTEST, SEVEN', 'code_status': 'DNR', 'los_days': 3, 'mrn': None})
        self.assertEqual((rec['unit'], rec['patient_name'], rec['code_status'], rec['los_days'], rec['mrn']), ('ZICU', 'ZZTEST, SEVEN', '', None, ''))
        self.assertEqual(cores_parse.unreadable_record(7)['patient_name'], 'ROW 7 NOT READ')

    def test_a_capture_with_no_odd_row_says_nothing_about_it(self):
        data = self.parse([row(1), row(2)])
        self.assertNotIn('unreadable', data)
        self.assertEqual(len(data['records']), 2)

    def test_the_stand_in_renders(self):
        from cores_report import render
        html = render(self.parse([row(1), row(2, drop=('Results',)), row(3, drop=('Bed', 'Patient'))]))
        for words in ('ZZTEST, PATIENT1', 'PATIENT2', 'ROW 3 NOT READ', 'NOT READ: cores could not read'):
            self.assertIn(words, html)
        self.assertEqual(html.count('data-name="Patient block"'), 3)     # no patient dropped

    def test_no_row_readable_is_refused_without_quoting_a_row(self):
        import cores_parse
        with self.assertRaises(cores_parse.NoRowReadable) as caught:
            self.parse([row(1, drop=('Results',)), row(2, drop=('Handoff',))])
        self.assertEqual(str(caught.exception), 'none of the 2 patient rows could be read (KeyError)')

    def test_generate_builds_the_report_and_says_how_many_rows(self):
        self.download(rows=[row(n) if n != 2 else row(n, drop=('Results',)) for n in range(1, 6)])
        code, out = self.run_cores('generate')
        self.assertEqual(code, 0, out)
        self.assertIn('Warning:  1 of 5 patient rows could not be read (row 2 of the report).', out)
        self.assertIn('The other 4 are complete.', out)
        self.assertIn('5 patients, 1 of them NOT READ', out)
        report = (self.reports / 'CORES report 281 2026-11-14 0700 - Daily Report.html').read_text(encoding='utf-8')
        self.assertIn('NOT READ: cores could not read', report)
        self.assertEqual(report.count('data-name="Patient block"'), 5)
        self.assertNotIn('ZZTEST', out)                                  # the message counts; it names no one
        self.assertEqual(self.log_entries()[-1]['counts']['patients'], 5)
        code, out = self.run_cores('reload')                             # built again from its JSON: the warning comes again
        self.assertIn('1 of 5 patient rows could not be read', out)

    def test_the_text_of_an_error_never_reaches_the_screen_or_the_log(self):
        import cores_parse_anes
        real = cores_parse_anes.parse_row

        def parse_row(tr):
            rec = real(tr)
            if rec['patient_name'].endswith('PATIENT2') or rec['patient_name'].endswith('PATIENT3'):
                raise ValueError(f"cannot read {rec['patient_name']} MRN {rec['mrn']}")
            return rec
        self.download(patients=4)
        with mock.patch.object(cores_parse_anes, 'parse_row', parse_row):
            code, out = self.run_cores('generate')
        self.assertEqual(code, 0, out)
        self.assertIn('2 of 4 patient rows could not be read (rows 2, 3 of the report)', out)
        for word in ('ZZTEST', '9990002', 'cannot read'):
            self.assertNotIn(word, out)
            self.assertNotIn(word, str(self.log_entries()))
        saved = json.loads((self.reports / 'CORES report 281 2026-11-14 0700.json').read_text(encoding='utf-8'))
        self.assertEqual(saved['unreadable'], {'rows': [2, 3], 'errors': ['ValueError']})

    def test_every_row_unreadable_is_still_refused(self):
        cap = self.download(rows=[row(1, drop=('Results',)), row(2, drop=('Results',))])
        code, out = self.run_cores('generate')
        self.assertEqual(code, 1)
        self.assertIn('none of the 2 patient rows could be read (KeyError)', out)
        self.assertNotIn('ZZTEST', out)
        self.assertTrue(cap.exists())                                    # left where it was
        self.assertEqual(self.names(), [])


# ---------------------------------------------------------------- finding 7: the fresher of Downloads and the clipboard

class Ages(unittest.TestCase):
    def test_ago(self):
        now = 1_800_000_000
        for seconds, words in ((0, 'just now'), (89, 'just now'), (90, '2 minutes ago'), (60 * 12, '12 minutes ago'), (5399, '90 minutes ago'),
                               (5400, '2 hours ago'), (3600 * 5, '5 hours ago'), (3600 * 35, '35 hours ago'), (3600 * 36, '2 days ago'),
                               (86400 * 3, '3 days ago'), (-600, 'just now')):
            self.assertEqual(cores.ago(now - seconds, now), words)

    def test_stamp_time(self):
        self.assertEqual(cores.stamp_time('CORES report 281 2026-11-14 0700.html'), dt.datetime(2026, 11, 14, 7, 0).timestamp())
        self.assertEqual(cores.stamp_time('CORES report 281 2026-11-14 0700 (1).html'), dt.datetime(2026, 11, 14, 7, 0).timestamp())
        self.assertIsNone(cores.stamp_time('a page saved from the browser.html'))
        self.assertIsNone(cores.stamp_time('CORES report 281 2026-13-45 9999.html'))   # not a date


@NEEDS_PARSER
class FresherWins(TempCores):
    def test_an_old_capture_in_downloads_no_longer_hides_a_fresh_one_on_the_clipboard(self):
        old, fresh = taken(60 * 50), taken(3)
        self.download(old)
        self.clip.text = capture(fresh, patients=2)
        code, out = self.run_cores('generate')
        self.assertEqual(code, 0, out)
        self.assertEqual(self.names(), set_of(fresh))
        self.assertEqual(self.names(self.inbox), [old])                  # left where it is
        self.assertRegex(out, r'Source:   the clipboard, taken [34] minutes ago: newer than the newest capture in')
        self.assertIn('2 days ago', out)
        self.assertNotIn('Warning', out)

    def test_a_broken_capture_left_in_downloads_does_not_block_the_next_one(self):
        """What happened before: the refused file stayed the newest in Downloads and was picked, and refused, every time."""
        broken = self.download(taken(40), text=capture(taken(40))[:-300])
        self.assertEqual(self.run_cores('generate')[0], 1)               # refused, and left where it is
        self.assertTrue(broken.exists())
        fresh = taken(1)
        self.clip.text = capture(fresh)
        code, out = self.run_cores('generate')
        self.assertEqual(code, 0, out)
        self.assertEqual(self.names(), set_of(fresh))

    def test_a_newer_download_wins_and_the_older_clipboard_report_is_saved_aside(self):
        new, older = taken(2), taken(45)
        self.download(new)
        self.clip.text = capture(older, patients=2)
        code, out = self.run_cores('generate')
        self.assertEqual(code, 0, out)
        self.assertEqual(self.names(), sorted(set_of(new) + [older]))
        self.assertRegex(out, 'Source:   the newest capture in ' + re.escape(str(self.inbox)) + ', taken [23] minutes ago')
        self.assertRegex(out, r'the clipboard holds an older report, taken 4[56] minutes ago')
        self.assertEqual(self.clip.text, cores.SAVED_NOTE.format(name=older))

    def test_the_same_capture_in_both_places_comes_from_the_file(self):
        name = taken(4)
        self.download(name[:-5] + ' (1).html', text=capture(name))       # a second download of it, as the browser names one
        self.clip.text = capture(name)
        code, out = self.run_cores('generate')
        self.assertEqual(code, 0, out)
        self.assertEqual(self.names(), set_of(name[:-5] + ' (1).html'))
        self.assertIn('Source:   the newest capture in', out)
        self.assertNotIn('older report', out)

    def test_a_cut_short_download_gives_way_to_the_whole_copy_on_the_clipboard(self):
        name = taken(4)
        cut = self.download(name, text=capture(name)[:-300])
        self.clip.text = capture(name)
        code, out = self.run_cores('generate')
        self.assertEqual(code, 0, out)
        self.assertIn('is cut short, the clipboard has it whole', out)
        self.assertEqual(self.names(), set_of(name))                     # built from the clipboard's whole copy
        self.assertTrue(cut.exists())

    def test_clipboard_option_still_uses_the_clipboard_whatever_downloads_has(self):
        new, older = taken(2), taken(45)
        self.download(new)
        self.clip.text = capture(older, patients=2)
        code, out = self.run_cores('generate', '--clipboard')
        self.assertEqual(code, 0, out)
        self.assertEqual(self.names(), set_of(older))
        self.assertEqual(self.names(self.inbox), [new])

    def test_an_old_capture_is_built_with_a_warning(self):
        old = taken(60 * 30)
        self.download(old)
        code, out = self.run_cores('generate')
        self.assertEqual(code, 0, out)
        self.assertEqual(self.names(), set_of(old))
        self.assertIn('taken 30 hours ago', out)
        self.assertIn('Warning:  this capture is old: taken 30 hours ago', out)
        self.assertIn('capture again', out)

    def test_a_fresh_capture_and_a_file_given_by_name_get_no_warning(self):
        self.download(taken(20))
        code, out = self.run_cores('generate')
        self.assertEqual(code, 0, out)
        self.assertRegex(out, r'taken 2[01] minutes ago')
        self.assertNotIn('Warning', out)
        old = self.download(taken(60 * 80))
        code, out = self.run_cores('generate', str(old))                 # asked for by name: that is a choice, not a mix-up
        self.assertEqual(code, 0, out)
        self.assertNotIn('Warning', out)

    def test_a_second_generate_uses_the_saved_report_not_the_stale_download(self):
        stale, fresh = taken(60 * 50), taken(3)
        self.download(stale)
        self.clip.text = capture(fresh, patients=2)
        self.assertEqual(self.run_cores('generate')[0], 0)
        code, out = self.run_cores('generate')                           # the clipboard now holds the line naming the saved file
        self.assertEqual(code, 0, out)
        self.assertIn('this report was saved before', out)
        self.assertEqual(self.names(), set_of(fresh))
        self.assertEqual(self.names(self.inbox), [stale])

    def test_looking_changes_nothing(self):
        self.download(taken(60 * 50))
        self.clip.text = capture(taken(3))
        kind, path, when, other = cores.pick_source(cores.load_config())
        self.assertEqual((kind, path, other[0]), ('clipboard', None, 'inbox'))
        code, out = self.run_cores('latest')
        self.assertEqual(code, 0, out)
        self.assertRegex(out, r'`cores generate` would use: the report on the clipboard, taken [34] minutes ago')
        self.assertFalse(self.reports.exists())
        self.assertEqual(self.clip.writes, [])
        self.clip.text = ''
        self.assertIn(f'`cores generate` would use: {self.inbox}', self.run_cores('latest')[1])

    def test_nothing_anywhere_says_so(self):
        code, out = self.run_cores('generate')
        self.assertEqual(code, 1)
        self.assertIn('no CORES report in Downloads or on the clipboard', out)
        self.assertIn('would use: nothing yet', self.run_cores('latest')[1])


# ---------------------------------------------------------------- finding 12: a wrong setting

class Settings(TempCores):
    def saved(self):
        return json.loads(self.config.read_text(encoding='utf-8'))

    def test_a_wrong_value_is_refused_with_the_allowed_ones_and_nothing_is_saved(self):
        before = self.config.read_text(encoding='utf-8')
        for key, value, allowed in (('paper', 'a4', 'legal or letter'), ('orientation', 'sideways', 'landscape or portrait'),
                                    ('import_mode', 'link', 'move or copy'), ('keep', 'three', 'a whole number, 0 or more'),
                                    ('log', 'maybe', 'true or false'), ('black_and_white', 'grey', 'true or false'),
                                    ('open_after_run', 'sometimes', 'true or false')):
            code, out = self.run_cores('config', '--set', key, value)
            self.assertEqual(code, 1, out)
            self.assertIn(f'"{key}" must be {allowed}; "{value}" is not. Nothing was changed.', out)
            self.assertEqual(self.config.read_text(encoding='utf-8'), before)
        self.assertEqual(self.run_cores('latest')[0], 0)                 # nothing is locked
        code, out = self.run_cores('config', '--set', 'colour', 'blue')
        self.assertEqual(code, 1)
        self.assertIn('unknown setting "colour"', out)

    def test_a_right_value_is_saved_as_cores_uses_it(self):
        for key, value, stored in (('paper', 'LETTER', 'letter'), ('orientation', ' Portrait ', 'portrait'), ('black_and_white', 'yes', True),
                                   ('log', 'off', False), ('keep', '5', 5), ('inbox_dirs', 'a;b', ['a', 'b']), ('printer', 'EPSON ET-4800', 'EPSON ET-4800')):
            code, out = self.run_cores('config', '--set', key, value)
            self.assertEqual(code, 0, out)
            self.assertEqual(self.saved()[key], stored)
            self.assertEqual(cores.load_config()[key], stored)

    def test_a_config_that_is_already_bad_does_not_lock_cores_config(self):
        self.settings(paper='a4')                                        # as an older `cores config --set paper a4` left it
        code, out = self.run_cores('latest')
        self.assertEqual(code, 1)
        self.assertIn('"paper" in cores.config.json is "a4", but it must be legal or letter', out)
        self.assertIn('cores config --set paper legal', out)
        self.assertEqual(self.run_cores('generate')[0], 1)
        self.assertEqual(self.run_cores('help')[0], 0)                   # help still answers
        self.assertEqual(self.run_cores()[0], 0)                         # and so does `cores` alone
        code, out = self.run_cores('config')                             # shows the settings and the problem
        self.assertEqual(code, 1)
        self.assertIn('Problem:  "paper" in cores.config.json is "a4", but it must be legal or letter', out)
        self.assertIn('"orientation": "landscape"', out)
        code, out = self.run_cores('config', '--set', 'orientation', 'portrait')   # another setting can be set meanwhile
        self.assertEqual(code, 1)
        self.assertEqual(self.saved()['orientation'], 'portrait')
        self.assertIn('Problem:  "paper"', out)
        code, out = self.run_cores('config', '--set', 'paper', 'legal')            # the repair
        self.assertEqual(code, 0, out)
        self.assertNotIn('Problem', out)
        self.assertEqual(self.run_cores('latest')[0], 0)

    def test_values_typed_by_hand_into_the_file(self):
        self.settings(open_after_run='no', check_updates='FALSE', black_and_white='Yes', keep='2', import_mode=' Copy ', inbox_dirs=str(self.inbox))
        cfg = cores.load_config()
        self.assertEqual((cfg['open_after_run'], cfg['check_updates'], cfg['black_and_white'], cfg['keep'], cfg['import_mode'], cfg['inbox_dirs']),
                         (False, False, True, 2, 'copy', [str(self.inbox)]))
        self.settings(keep=-4, log_dir=None)
        cfg = cores.load_config()
        self.assertEqual((cfg['keep'], cfg['log_dir']), (0, ''))
        self.settings(orientation='upside down', keep=[1])
        problems = []
        cfg = cores.load_config(problems)
        self.assertEqual([(k, a) for k, _, a in problems], [('keep', 'a whole number, 0 or more'), ('orientation', 'landscape or portrait')])
        self.assertEqual((cfg['keep'], cfg['orientation']), (3, 'landscape'))       # each at its default meanwhile
        with self.assertRaises(cores.CoresError):
            cores.load_config()

    def test_a_file_that_is_not_json_has_to_be_repaired_by_hand(self):
        self.config.write_text('{"paper": "legal",', encoding='utf-8')
        for argv in (('config',), ('config', '--set', 'paper', 'letter'), ('latest',)):
            code, out = self.run_cores(*argv)
            self.assertEqual(code, 1)
            self.assertIn('is not valid JSON', out)
            self.assertIn('delete it to go back to the defaults', out)
        self.assertEqual(self.config.read_text(encoding='utf-8'), '{"paper": "legal",')   # --set did not write over it

    def test_doctor_runs_and_marks_a_bad_setting(self):
        self.settings(paper='a4')
        with mock.patch.object(cores, 'github_release', side_effect=cores.CoresError('offline')), \
                mock.patch.object(cores, 'windows_printers', return_value=[]), \
                mock.patch.object(cores, 'bundle_check', return_value=(True, 'not checked in this test')), \
                mock.patch.object(cores, 'clipboard_history_on', return_value=False):
            code, out = self.run_cores('doctor')
        self.assertEqual(code, 1)
        self.assertRegex(out, r'\[!! \] Config: "paper" in cores\.config\.json is "a4"')


if __name__ == '__main__':
    unittest.main()

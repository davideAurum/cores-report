"""Tests for the cores log (cores_log.py and its use in cores.py). Standard unittest, temporary folders, no network:

    python -m unittest discover -s tests -v        (from the folder with cores.py, or with PYTHONPATH set to it)

Every capture here is a few invented lines of HTML; no test reads a real capture or report, and none writes outside
its temporary folder (the log folder is always given, never the automatic OneDrive one).
"""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cores_log  # noqa: E402


def capture_html(events=None, raw=None):
    """An invented capture: no patients, and the HUD's log comment before </html> when events (or raw text for it) are given."""
    comment = ''
    if raw is not None:
        comment = f'<!-- CORES log {raw} -->\n'
    elif events is not None:
        text = json.dumps({'v': 1, 'events': events}).replace('<', '\\u003c').replace('>', '\\u003e').replace('--', '-\\u002d')
        comment = f'<!-- CORES log {text} -->\n'
    return f'<!-- CORES capture CORES report test.html -->\n<html><body><table></table></body>\n{comment}</html>'


EVENTS = [{'id': 'k3f9a2-17', 't': '2026-11-14T07:01:02.345Z', 'ev': 'verdict', 'k': 'success', 'n': 57, 'ms': 8123},
          {'id': 'k3f9a2-18', 't': '2026-11-14T07:01:03Z', 'ev': 'delivered'}]


class TempFolder(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.log = self.tmp / 'log'
        cores_log._noted = False

    def lines(self, computer='PC-A'):
        return cores_log.log_file(self.log, computer).read_text(encoding='ascii').splitlines()

    def capture(self, name='CORES report test.html', **kw):
        p = self.tmp / name
        p.write_text(capture_html(**kw), encoding='utf-8')
        return p


class FolderChoice(TempFolder):
    def env(self, **dirs):
        env = {}
        for var, exists in dirs.items():
            d = self.tmp / var
            if exists:
                d.mkdir()
            env[var] = str(d)
        return env

    def test_setting_wins(self):
        env = self.env(OneDrive=True, LOCALAPPDATA=True)
        self.assertEqual(cores_log.log_folder(str(self.tmp / 'mine'), env), (self.tmp / 'mine', 'setting'))

    def test_onedrive_work_account_first(self):
        env = self.env(OneDriveConsumer=True, OneDrive=True, OneDriveCommercial=True, LOCALAPPDATA=True)
        self.assertEqual(cores_log.log_folder('', env), (self.tmp / 'OneDriveCommercial' / 'CORES Report log', 'onedrive'))

    def test_onedrive_variable_naming_no_folder_is_skipped(self):
        env = self.env(OneDriveCommercial=False, OneDrive=False, OneDriveConsumer=True, LOCALAPPDATA=True)
        self.assertEqual(cores_log.log_folder(None, env), (self.tmp / 'OneDriveConsumer' / 'CORES Report log', 'onedrive'))

    def test_user_profile_without_onedrive(self):
        env = self.env(OneDrive=False, LOCALAPPDATA=True)
        self.assertEqual(cores_log.log_folder('', env), (self.tmp / 'LOCALAPPDATA' / 'CORES Report' / 'log', 'profile'))

    def test_under_onedrive(self):
        env = self.env(OneDrive=True, LOCALAPPDATA=True)
        self.assertTrue(cores_log.under_onedrive(cores_log.log_folder('', env)[0], env))
        self.assertTrue(cores_log.under_onedrive(self.tmp / 'OneDrive' / 'elsewhere' / 'log', env))
        self.assertFalse(cores_log.under_onedrive(self.tmp / 'LOCALAPPDATA' / 'log', env))

    def test_computer_name_is_sanitized(self):
        self.assertEqual(cores_log.computer_name({'COMPUTERNAME': 'ICU PC.03/x'}), 'ICU-PC-03-x')
        self.assertEqual(cores_log.log_file(self.log, 'ICU-PC').name, 'cores-log.ICU-PC.jsonl')


class Writing(TempFolder):
    def test_one_line_per_entry(self):
        for i, cmd in enumerate(('capture', 'generate', 'print')):
            n = cores_log.log_command(self.log, cmd, '1.0.0', 'ok', 0, 100 + i, {'patients': 57}, started=1_800_000_000 + i,
                                      computer='PC-A')
            self.assertEqual(n, 1)
        raw = cores_log.log_file(self.log, 'PC-A').read_bytes()
        self.assertTrue(raw.endswith(b'\n'))
        lines = raw.decode('ascii').splitlines()
        self.assertEqual(len(lines), 3)
        entries = [json.loads(x) for x in lines]
        self.assertEqual([e['command'] for e in entries], ['capture', 'generate', 'print'])
        self.assertEqual(entries[1], {'t': '2027-01-15T08:00:01.000Z', 'computer': 'PC-A', 'source': 'pc', 'command': 'generate',
                                      'version': '1.0.0', 'outcome': 'ok', 'exit': 0, 'ms': 101, 'counts': {'patients': 57}})

    def test_only_this_computers_file_is_written(self):
        cores_log.log_command(self.log, 'doctor', '1.0.0', 'ok', 0, 5, computer='PC-A')
        self.assertEqual([p.name for p in self.log.iterdir()], ['cores-log.PC-A.jsonl'])

    def test_fixed_fields_only(self):
        """Nothing free-form gets in: an unknown count, a count that is not a whole number, an error that is not a class name."""
        cores_log.log_command(self.log, 'generate', '1.0.0', 'refused', 1, 12,
                              {'patients': 3, 'name': 7, 'bytes': 'Smith, John', 'files': -1, 'captures': True},
                              error='Smith, John is incomplete', computer='PC-A')
        e = json.loads(self.lines()[0])
        self.assertEqual(e['counts'], {'patients': 3})
        self.assertNotIn('error', e)
        self.assertNotIn('Smith', self.lines()[0])
        cores_log.log_command(self.log, 'generate', '1.0.0', 'refused', 1, 12, error='CoresError', computer='PC-A')
        self.assertEqual(json.loads(self.lines()[1])['error'], 'CoresError')

    def test_an_entry_that_is_not_one_is_not_written(self):
        self.assertEqual(cores_log.log_command(self.log, 'rm -rf C:\\Users', '1.0.0', 'ok', 0, 1, computer='PC-A'), 0)
        self.assertEqual(cores_log.log_command(self.log, 'generate', '1.0.0', 'went fine', 0, 1, computer='PC-A'), 0)
        self.assertEqual(cores_log.append(self.log, [{'t': 'yesterday', 'computer': 'PC-A', 'source': 'pc', 'command': 'open',
                                                      'outcome': 'ok'}], 'PC-A'), 0)
        self.assertFalse(self.log.exists())

    def test_a_cut_short_last_line_does_not_swallow_the_next(self):
        self.log.mkdir()
        cores_log.log_file(self.log, 'PC-A').write_bytes(b'{"t":"2026-11-14T07:00:00.000Z","comp')
        cores_log.log_command(self.log, 'open', '1.0.0', 'ok', 0, 1, computer='PC-A')
        self.assertEqual(len(self.lines()), 2)
        self.assertEqual([e['command'] for e in cores_log.read_all(self.log)], ['open'])

    def test_unwritable_folder_is_swallowed(self):
        blocker = self.tmp / 'a file, not a folder'
        blocker.write_text('x')
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.assertEqual(cores_log.log_command(blocker / 'log', 'open', '1.0.0', 'ok', 0, 1, computer='PC-A'), 0)
            self.assertEqual(cores_log.log_hud(blocker / 'log', self.capture(events=EVENTS), '1.0.0', computer='PC-A'), 0)
        self.assertEqual(cores_log.read_all(blocker / 'log'), [])
        self.assertEqual(len(err.getvalue().splitlines()), 1)   # one short note for the run, however many writes failed
        self.assertNotIn(str(self.tmp), err.getvalue())


class HudEvents(TempFolder):
    def test_events_are_read_from_the_comment(self):
        got = cores_log.hud_events(capture_html(events=EVENTS))
        self.assertEqual(got, [EVENTS[0], {'id': 'k3f9a2-18', 't': '2026-11-14T07:01:03.000Z', 'ev': 'delivered'}])

    def test_capture_without_the_comment_is_fine(self):
        self.assertEqual(cores_log.hud_events(capture_html()), [])
        self.assertEqual(cores_log.log_hud(self.log, self.capture(), '1.0.0', computer='PC-A'), 0)
        self.assertFalse(self.log.exists())
        self.assertFalse(cores_log._noted)

    def test_a_comment_that_is_not_json_or_another_version_is_ignored(self):
        self.assertEqual(cores_log.hud_events(capture_html(raw='{"v":1,"events":[{"id":')), [])
        self.assertEqual(cores_log.hud_events(capture_html(raw=json.dumps({'v': 2, 'events': EVENTS}))), [])
        self.assertEqual(cores_log.hud_events(capture_html(raw=json.dumps(EVENTS))), [])
        self.assertEqual(cores_log.hud_events('<!-- CORES log {"v":1,"events":[]}'), [])

    def test_free_text_or_an_unknown_key_drops_the_event(self):
        ok = EVENTS[0]
        bad = [dict(ok, id='a1-01', k='Smith, John'),            # free text where a keyword belongs
               dict(ok, id='a1-02', ev='Patient list loaded'),
               dict(ok, id='a1-03', msg='saved CORES report 281.html'),   # a key outside the six
               dict(ok, id='a1-04', name='x'),
               dict(ok, id='A1 05'),                             # an id that is not [a-z0-9-]{3,40}
               dict(ok, id='a1-06', t='14 Nov 2026 07:01'),
               dict(ok, id='a1-07', t='2026-11-14T07:01:02+01:00'),   # not UTC
               dict(ok, id='a1-08', n=-1),
               dict(ok, id='a1-09', n='57'),
               dict(ok, id='a1-10', ms=8.5),
               dict(ok, id='a1-11', n=True),
               {'id': 'a1-12', 't': ok['t']},                    # no ev
               'verdict success', None, 7]
        self.assertEqual(cores_log.hud_events(capture_html(events=bad + [ok])), [ok])
        self.assertEqual(cores_log.log_hud(self.log, self.capture(events=bad + [ok]), '1.0.0', computer='PC-A'), 1)
        text = cores_log.log_file(self.log, 'PC-A').read_text(encoding='ascii')
        for word in ('Smith', 'Patient', 'saved', 'a1-'):
            self.assertNotIn(word, text)

    def test_escaped_like_the_cores_data_comment(self):
        """captureCores() writes < > and -- as JSON escapes so nothing can end the comment early; a keyword cannot hold
        them anyway, so such an event is dropped and the ones around it are kept."""
        events = [dict(EVENTS[0], id='b2-01', k='a--><b'), EVENTS[1]]
        html = capture_html(events=events)
        self.assertEqual(html.count('-->'), 2)   # the capture-name comment's and the log comment's own
        self.assertEqual([e['id'] for e in cores_log.hud_events(html)], ['k3f9a2-18'])

    def test_deduplicated_by_id(self):
        cap = self.capture(events=EVENTS)
        self.assertEqual(cores_log.log_hud(self.log, cap, '1.0.0', computer='PC-A'), 2)
        self.assertEqual(cores_log.log_hud(self.log, cap, '1.0.0', computer='PC-A'), 0)
        more = self.capture('CORES report later.html', events=EVENTS + [{'id': 'k3f9a2-19', 't': '2026-11-14T07:05:00.000Z', 'ev': 'armed'}])
        self.assertEqual(cores_log.log_hud(self.log, more, '1.0.0', computer='PC-A'), 1)
        entries = [json.loads(x) for x in self.lines()]
        self.assertEqual([e['id'] for e in entries], ['k3f9a2-17', 'k3f9a2-18', 'k3f9a2-19'])
        self.assertEqual(entries[0], {'t': '2026-11-14T07:01:02.345Z', 'computer': 'PC-A', 'source': 'hud', 'id': 'k3f9a2-17',
                                      'ev': 'verdict', 'k': 'success', 'n': 57, 'ms': 8123, 'version': '1.0.0'})

    def test_an_id_repeated_inside_one_capture_is_taken_once(self):
        self.assertEqual(len(cores_log.hud_events(capture_html(events=EVENTS + EVENTS))), 2)


class Reading(TempFolder):
    def test_merge_in_time_order_across_two_computers(self):
        for sec, cmd, pc in ((10, 'capture', 'PC-A'), (30, 'generate', 'PC-A'), (20, 'doctor', 'PC-B'), (40, 'print', 'PC-B')):
            cores_log.log_command(self.log, cmd, '1.0.0', 'ok', 0, 1, started=1_800_000_000 + sec, computer=pc)
        cores_log.log_hud(self.log, self.capture(events=[{'id': 'c3-01', 't': cores_log.utc(1_800_000_025), 'ev': 'armed'}]),
                          '1.0.0', computer='PC-B')
        self.assertEqual(len(cores_log.log_files(self.log)), 2)
        got = [(e['computer'], e.get('command') or e['ev']) for e in cores_log.read_all(self.log)]
        self.assertEqual(got, [('PC-A', 'capture'), ('PC-B', 'doctor'), ('PC-B', 'armed'), ('PC-A', 'generate'), ('PC-B', 'print')])

    def test_a_hud_event_imported_on_two_computers_shows_once(self):
        cap = self.capture(events=EVENTS)
        self.assertEqual(cores_log.log_hud(self.log, cap, '1.0.0', computer='PC-A'), 2)
        self.assertEqual(cores_log.log_hud(self.log, cap, '1.0.0', computer='PC-B'), 2)
        self.assertEqual([e['id'] for e in cores_log.read_all(self.log)], ['k3f9a2-17', 'k3f9a2-18'])

    def test_lines_that_are_not_entries_are_skipped(self):
        cores_log.log_command(self.log, 'open', '1.0.0', 'ok', 0, 1, computer='PC-A')
        with open(cores_log.log_file(self.log, 'PC-B'), 'w', encoding='utf-8') as fh:
            fh.write('not json\n[1, 2]\n{"t": "2026-11-14T07:00:00Z", "computer": "PC-B", "source": "pc", "command": "open", '
                     '"outcome": "ok", "exit": 0, "note": "Smith, John"}\n')
        entries = cores_log.read_all(self.log)
        self.assertEqual(len(entries), 2)
        self.assertNotIn('note', entries[0])   # a field outside the fixed ones does not come back out either

    def test_table(self):
        cores_log.log_command(self.log, 'generate', '1.0.0', 'ok', 0, 2140, {'patients': 57, 'bytes': 1_203_311, 'captures': 1},
                              started=1_800_000_000, computer='PC-A')
        cores_log.log_command(self.log, 'generate', '1.0.0', 'refused', 1, 80, error='CoresError', started=1_800_000_100, computer='PC-B')
        cores_log.log_hud(self.log, self.capture(events=EVENTS), '1.0.0', computer='PC-A')
        text = cores_log.table(cores_log.read_all(self.log))
        rows = text.splitlines()
        self.assertEqual(len(rows), 5)
        self.assertEqual(rows[0].split(), ['When', 'Computer', 'From', 'What', 'Result', 'Exit', 'Took', 'Counts'])
        self.assertRegex(text, r'PC-A +hud +verdict +success +8\.1 s +n=57')
        self.assertRegex(text, r'PC-A +pc +generate +ok +0 +2\.1 s +patients=57  bytes=1\.2 MB  captures=1')
        self.assertRegex(text, r'PC-B +pc +generate +refused \(CoresError\) +1 +80 ms')


if __name__ == '__main__':
    unittest.main()

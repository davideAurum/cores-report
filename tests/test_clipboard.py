"""Tests that the report leaves the clipboard once `cores generate` or `cores watch` has saved it (code review,
finding 2), and that a second `cores generate` still finds the saved file. The clipboard is a FakeClipboard and every
capture is invented (tests/invented.py); nothing reads the real clipboard or a real report.

    python -m unittest discover -s tests -v
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cores  # noqa: E402
from invented import NEEDS_PARSER, TempCores, capture  # noqa: E402

NAME = 'CORES report 281 2026-11-14 0700.html'
REPORT = 'CORES report 281 2026-11-14 0700 - Daily Report.html'
SET = sorted([NAME, REPORT, 'CORES report 281 2026-11-14 0700.json'])   # what one capture leaves in the reports folder


class Holding(TempCores):
    """The pieces: when a file counts as holding what is on the clipboard, and when the clipboard is replaced."""

    def saved(self, text, name=NAME):
        self.reports.mkdir(exist_ok=True)
        p = self.reports / name
        p.write_text(text, encoding='utf-8', newline='')
        return p

    def test_released_only_when_the_file_holds_what_the_clipboard_holds(self):
        text = capture()
        p = self.saved(text)
        self.clip.text = text.replace('\n', '\r\n')            # Windows line ends on the clipboard: still the same report
        self.assertTrue(cores.release_clipboard(p))
        self.assertEqual(self.clip.text, cores.SAVED_NOTE.format(name=NAME))
        self.assertNotIn('ZZTEST', self.clip.text)

    def test_something_else_copied_meanwhile_is_not_touched(self):
        p = self.saved(capture())
        for other in ('a phone number someone just copied', '', capture(patients=4),            # another report, not saved
                      (cores.HERE / 'capture_report.js').read_text(encoding='utf-8') + '\ncaptureCores();\n'):
            self.clip.text = other
            self.assertFalse(cores.release_clipboard(p))
            self.assertEqual(self.clip.text, other)
        self.assertEqual(self.clip.writes, [])

    def test_a_file_that_is_gone_or_different_does_not_release(self):
        self.clip.text = capture()
        self.assertFalse(cores.release_clipboard(self.reports / NAME))          # never saved
        self.assertFalse(cores.release_clipboard(self.saved(capture()[:-200])))   # the file is the cut-short one
        self.assertEqual(self.clip.writes, [])

    def test_a_cut_short_clipboard_copy_of_a_whole_saved_capture_counts_as_saved(self):
        text = capture()
        p = self.saved(text)
        self.clip.text = text[:len(text) // 2]
        cfg = cores.load_config()
        self.assertEqual(cores.clipboard_capture(cfg)[::2], (p, False))    # found, not saved again as "... (2)"
        self.assertEqual(self.names(), [NAME])
        self.assertTrue(cores.release_clipboard(p))

    def test_the_note_names_a_file_in_the_reports_folder_and_nothing_else(self):
        cfg = cores.load_config()
        p = self.saved(capture())
        self.clip.text = cores.SAVED_NOTE.format(name=NAME)
        self.assertEqual(cores.noted_capture(cfg), (p, NAME))
        self.assertEqual(cores.clipboard_capture(cfg), (None, None, False))     # the note is not a capture
        self.clip.text = cores.SAVED_NOTE.format(name='CORES report gone.html')
        self.assertEqual(cores.noted_capture(cfg), (None, 'CORES report gone.html'))
        (self.tmp / 'outside.html').write_text(capture(), encoding='utf-8')
        for sneaky in ('..\\outside.html', '../outside.html', str(self.tmp / 'outside.html')):
            self.clip.text = cores.SAVED_NOTE.format(name=sneaky)
            self.assertEqual(cores.noted_capture(cfg), (None, None))
        self.clip.text = 'CORES report saved as nothing in particular'
        self.assertEqual(cores.noted_capture(cfg), (None, None))


@NEEDS_PARSER
class Generate(TempCores):
    def test_the_report_leaves_the_clipboard_once_it_is_saved(self):
        self.clip.text = capture()
        code, out = self.run_cores('generate')
        self.assertEqual(code, 0, out)
        self.assertEqual(self.names(), SET)
        self.assertEqual(self.clip.text, cores.SAVED_NOTE.format(name=NAME))
        self.assertNotIn('ZZTEST', self.clip.text)
        self.assertIn('taken off the clipboard', out)
        self.assertEqual((self.reports / NAME).read_text(encoding='utf-8'), capture())   # saved whole before it was cleared

    def test_a_second_generate_still_finds_the_saved_file(self):
        self.clip.text = capture()
        self.assertEqual(self.run_cores('generate')[0], 0)
        (self.reports / REPORT).unlink()
        code, out = self.run_cores('generate')
        self.assertEqual(code, 0, out)
        self.assertIn('this report was saved before', out)
        self.assertEqual(self.names(), SET)                      # built again from the saved file: no "... (2)"
        self.assertEqual(self.clip.text, cores.SAVED_NOTE.format(name=NAME))
        code, out = self.run_cores('generate', '--clipboard')
        self.assertEqual(code, 0, out)
        self.assertEqual(self.names(), SET)

    def test_from_downloads_the_same_capture_on_the_clipboard_is_taken_off_too(self):
        self.download()
        self.clip.text = capture()
        code, out = self.run_cores('generate')
        self.assertEqual(code, 0, out)
        self.assertEqual(self.names(), SET)
        self.assertEqual(self.names(self.inbox), [])             # moved in, as before
        self.assertEqual(self.clip.text, cores.SAVED_NOTE.format(name=NAME))
        self.assertIn('the report was taken off the clipboard', out)

    def test_another_report_on_the_clipboard_is_saved_before_it_is_taken_off(self):
        self.download()
        other = 'CORES report 281 2026-11-14 0630.html'
        self.clip.text = capture(other, patients=2)
        code, out = self.run_cores('generate')
        self.assertEqual(code, 0, out)
        self.assertEqual(self.names(), sorted(SET + [other]))
        self.assertEqual((self.reports / other).read_text(encoding='utf-8'), capture(other, patients=2))
        self.assertEqual(self.clip.text, cores.SAVED_NOTE.format(name=other))
        self.assertIn('it held another CORES report', out)

    def test_anything_else_on_the_clipboard_is_left_alone(self):
        script = (cores.HERE / 'capture_report.js').read_text(encoding='utf-8') + '\ncaptureCores();\n'
        for other in ('a phone number someone just copied', script, ''):
            self.download()
            self.clip.text = other
            code, out = self.run_cores('generate')
            self.assertEqual(code, 0, out)
            self.assertEqual(self.clip.text, other)
        self.assertEqual(self.clip.writes, [])

    def test_a_refused_clipboard_capture_is_saved_taken_off_and_found_again(self):
        self.clip.text = capture()[:-300]                         # cut short: no closing </html>
        code, out = self.run_cores('generate')
        self.assertEqual(code, 1)
        self.assertIn('is incomplete', out)
        self.assertEqual(self.names(), [NAME])
        self.assertEqual(self.clip.text, cores.SAVED_NOTE.format(name=NAME))
        code, out = self.run_cores('generate')                    # the same answer, from the saved file, and no second copy
        self.assertEqual(code, 1)
        self.assertIn('is incomplete', out)
        self.assertEqual(self.names(), [NAME])

    def test_a_refused_download_leaves_the_clipboard_alone(self):
        self.download(text=capture()[:-300])
        self.clip.text = 'something else'
        self.assertEqual(self.run_cores('generate')[0], 1)
        self.assertEqual(self.clip.writes, [])

    def test_the_note_for_a_file_that_was_cleaned_away_says_so(self):
        self.clip.text = cores.SAVED_NOTE.format(name=NAME)
        code, out = self.run_cores('generate')
        self.assertEqual(code, 1)
        self.assertIn('no longer in', out)
        self.assertIn('cores capture', out)

    def test_cores_capture_still_rescues_a_report_from_the_clipboard(self):
        self.clip.text = capture()
        code, out = self.run_cores('capture')
        self.assertEqual(code, 0, out)
        self.assertEqual(self.names(), [NAME])
        self.assertIn('The clipboard held a report from CORES: saved as', out)
        self.assertTrue(cores.clipboard_is_script(self.clip.text))
        code, out = self.run_cores('generate')                    # the clipboard holds the script: the rescued report is used
        self.assertEqual(code, 0, out)
        self.assertEqual(self.names(), SET)

    def test_nothing_about_the_clipboard_reaches_the_log(self):
        self.clip.text = capture()
        self.run_cores('generate')
        self.run_cores('generate')
        text = str(self.log_entries())
        self.assertEqual([e['command'] for e in self.log_entries()], ['generate', 'generate'])
        for word in ('ZZTEST', 'CORES report', 'saved as'):
            self.assertNotIn(word, text)


@NEEDS_PARSER
class Watch(TempCores):
    def watch(self, *argv, ticks):
        """`cores watch` for len(ticks) checks: before each sleep the next of `ticks` runs (None = nothing happens), then Ctrl+C."""
        steps = list(ticks)

        def sleep(_):
            if not steps:
                raise KeyboardInterrupt
            step = steps.pop(0)
            if step:
                step()
        with mock.patch.object(cores.time, 'sleep', sleep):
            code, out = self.run_cores('watch', '--interval', '0', *argv)
        self.assertEqual(code, 130)
        return out

    def test_watch_clipboard_takes_each_report_once_and_clears_it(self):
        later = 'CORES report 281 2026-11-14 0900.html'
        self.clip.text = capture()
        seen = []

        def next_capture():
            seen.append(self.clip.text)
            self.clip.text = capture(later, patients=2)
        out = self.watch('--clipboard', ticks=[None, None, next_capture, None, None])
        self.assertEqual(seen, [cores.SAVED_NOTE.format(name=NAME)])       # cleared after the first, and it stayed so
        self.assertEqual(out.count('capture from the clipboard:'), 2)       # each report once: no loop on the note
        self.assertEqual(out.count('Rendered:'), 2)
        self.assertNotIn('already processed', out)
        self.assertEqual(self.names(), sorted(SET + [later, later[:-5] + ' - Daily Report.html', later[:-5] + '.json']))
        self.assertEqual(self.clip.text, cores.SAVED_NOTE.format(name=later))
        self.assertEqual(len(self.clip.writes), 2)

    def test_watch_clipboard_started_on_a_report_already_built(self):
        self.clip.text = capture()
        self.assertEqual(self.run_cores('generate', '--clipboard')[0], 0)
        self.clip.text = capture()                                           # copied again, e.g. the banner's Copy button
        out = self.watch('--clipboard', ticks=[None, None])
        self.assertEqual(out.count('already processed'), 1)
        self.assertNotIn('Rendered:', out)
        self.assertEqual(self.names(), SET)
        self.assertEqual(self.clip.text, cores.SAVED_NOTE.format(name=NAME))

    def test_watch_without_clipboard_clears_the_downloaded_captures_copy_and_saves_nothing_else(self):
        self.clip.text = capture()
        out = self.watch(ticks=[self.download, None, None, None])
        self.assertEqual(out.count('Rendered:'), 1)
        self.assertEqual(self.names(), SET)
        self.assertEqual(self.clip.text, cores.SAVED_NOTE.format(name=NAME))
        other = capture('CORES report 281 2026-11-14 0630.html', patients=2)   # a different report: not this watch's business
        self.clip.text = other
        self.watch(ticks=[lambda: self.download('CORES report 281 2026-11-14 0930.html'), None, None, None])
        self.assertEqual(self.clip.text, other)
        self.assertNotIn('CORES report 281 2026-11-14 0630.html', self.names())


class Doctor(TempCores):
    def doctor(self, history):
        with mock.patch.object(cores, 'github_release', side_effect=cores.CoresError('offline')), \
                mock.patch.object(cores, 'windows_printers', return_value=[]), \
                mock.patch.object(cores, 'bundle_check', return_value=(True, 'not checked in this test')), \
                mock.patch.object(cores, 'clipboard_history_on', return_value=history):
            return self.run_cores('doctor')[1]

    def test_doctor_says_whether_windows_keeps_a_clipboard_history(self):
        self.assertRegex(self.doctor(True), r'\[-- \] Windows clipboard history \(Win\+V\): on')
        self.assertRegex(self.doctor(False), r'\[OK \] Windows clipboard history \(Win\+V\): off')
        self.assertNotIn('clipboard history', self.doctor(None))     # not Windows: nothing to say


if __name__ == '__main__':
    unittest.main()

"""Tests for what `cores capture` puts on the clipboard: which calls end the pasted script. Nothing touches the real
clipboard, and no capture or report is read.

    python -m unittest discover -s tests -v
"""
import argparse
import contextlib
import io
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cores  # noqa: E402

SCRIPT_END = '})();'   # the last line of capture_report.js itself


def run_capture(**flags):
    """cmd_capture with the clipboard replaced: (the text it would copy or None, what it printed)."""
    a = argparse.Namespace(id='281', auto=False, direct=False, no_download=False, folder=False, no_run=False, trace=False)
    for k, v in flags.items():
        setattr(a, k, v)
    copied = []
    out = io.StringIO()
    with mock.patch.object(cores, 'to_clipboard', lambda text: copied.append(text) or True), \
            mock.patch.object(cores, 'clipboard_capture', lambda cfg, skip_sha=None: (None, None, False)), \
            contextlib.redirect_stdout(out):
        try:
            cores.cmd_capture(a, {'inbox_dirs': []})
        finally:
            run_capture.copied = list(copied)
    return copied[0], out.getvalue()


def tail(text):
    """The lines after the script's own last line."""
    lines = text.rstrip('\n').split('\n')
    last = max(i for i, ln in enumerate(lines) if ln == SCRIPT_END)
    return [ln for ln in lines[last + 1:] if ln.strip()]


class CaptureCalls(unittest.TestCase):
    def test_default_ends_with_the_capture_call(self):
        text, said = run_capture()
        self.assertEqual(tail(text), ['captureCores();'])
        self.assertIn('captureCores();', said)

    def test_direct_with_options(self):
        text, _ = run_capture(direct=True, id='8', no_download=True)
        self.assertEqual(tail(text), ['captureCores(8, {download: false});'])

    def test_trace_arms_the_capture_then_the_trace(self):
        text, said = run_capture(trace=True)
        self.assertEqual(tail(text), ['captureCores();', 'traceCores();'])
        self.assertIn('Trace', said)

    def test_no_run_with_trace_is_the_trace_alone(self):
        text, said = run_capture(no_run=True, trace=True)
        self.assertEqual(tail(text), ['traceCores();'])
        self.assertIn('Stop trace', said)
        self.assertNotIn('cores generate', said)   # nothing is captured, so no step 4

    def test_no_run_alone_has_no_call_and_says_nothing_will_show(self):
        text, said = run_capture(no_run=True)
        self.assertEqual(tail(text), [])
        self.assertIn('NOTHING SHOWS', said)
        self.assertIn('traceCores()', said)


class Auto(unittest.TestCase):
    """`cores capture --auto`: the paste ends with captureCores({auto: true}), the script pressing CORES's buttons itself."""

    def test_auto_ends_with_the_auto_call(self):
        text, said = run_capture(auto=True)
        self.assertEqual(tail(text), ['captureCores({auto: true});'])
        self.assertIn('captureCores({auto: true});', said)

    def test_other_options_go_in_the_same_object(self):
        self.assertEqual(tail(run_capture(auto=True, no_download=True)[0]), ['captureCores({auto: true, download: false});'])
        self.assertEqual(tail(run_capture(auto=True, folder=True)[0]), ['captureCores({auto: true, folder: true});'])
        self.assertEqual(tail(run_capture(auto=True, no_download=True, folder=True)[0]),
                         ['captureCores({auto: true, download: false, folder: true});'])

    def test_trace_still_comes_after_it(self):
        text, said = run_capture(auto=True, trace=True)
        self.assertEqual(tail(text), ['captureCores({auto: true});', 'traceCores();'])
        self.assertIn('Trace', said)

    def test_the_steps_say_what_the_script_presses_and_what_a_handed_back_step_means(self):
        _, said = run_capture(auto=True)
        for words in ('Nothing to click', 'Reports', 'ANES ICU w/ Meds', 'Just Print', 'hands a step back',
                      'press that button yourself', 'stays armed', 'cores generate'):
            self.assertIn(words, said)
        self.assertNotIn('Open the report from CORES as you normally do', said)

    def test_auto_with_direct_or_no_run_is_refused_and_nothing_is_copied(self):
        for flags, words in (({'direct': True}, ('--auto', '--direct')), ({'no_run': True}, ('--auto', '--no-run')),
                             ({'no_run': True, 'trace': True}, ('--auto', '--no-run')), ({'id': '8'}, ('--auto', '--id'))):
            with self.assertRaises(cores.CoresError) as caught:
                run_capture(auto=True, **flags)
            for w in words:
                self.assertIn(w, str(caught.exception))
            self.assertEqual(run_capture.copied, [])

    def test_auto_is_opt_in(self):
        """Without --auto the paste and the steps are what they were: no mention of it, and the same call."""
        text, said = run_capture()
        script = (cores.HERE / 'capture_report.js').read_text(encoding='utf-8')
        self.assertEqual(text, script.rstrip('\n') + '\n\ncaptureCores();\n')
        self.assertNotIn('--auto', said)
        self.assertNotIn('auto:', said)
        self.assertIn('Open the report from CORES as you normally do', said)

    def test_the_command_line_option(self):
        parse = cores.build_parser().parse_args
        self.assertFalse(parse(['capture']).auto)
        a = parse(['capture', '--auto', '--no-download', '--trace'])
        self.assertTrue(a.auto and a.no_download and a.trace)
        self.assertEqual(tail(run_capture(**{k: getattr(a, k) for k in ('id', 'auto', 'direct', 'no_download', 'folder', 'no_run', 'trace')})[0]),
                         ['captureCores({auto: true, download: false});', 'traceCores();'])


if __name__ == '__main__':
    unittest.main()

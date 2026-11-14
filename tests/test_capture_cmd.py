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
    """cmd_capture with the clipboard replaced: (the text it would copy, what it printed)."""
    a = argparse.Namespace(id='281', direct=False, no_download=False, folder=False, no_run=False, trace=False)
    for k, v in flags.items():
        setattr(a, k, v)
    copied = []
    out = io.StringIO()
    with mock.patch.object(cores, 'to_clipboard', lambda text: copied.append(text) or True), \
            mock.patch.object(cores, 'clipboard_capture', lambda cfg, skip_sha=None: (None, None, False)), \
            contextlib.redirect_stdout(out):
        cores.cmd_capture(a, {'inbox_dirs': []})
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


if __name__ == '__main__':
    unittest.main()

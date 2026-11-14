"""Local server for the fake CORES page (test/fake_cores.html) and the HUD self-test (test/selftest.html).

Usage, from the project folder:   python test/serve.py [port]        (default port 8765)
Then open                         http://127.0.0.1:8765/fake_cores.html
                                  http://127.0.0.1:8765/selftest.html

It serves ONLY the files in this test folder, plus capture_report.js from the folder above (as /capture_report.js),
and only to this computer (127.0.0.1). The same files also answer under an address shaped like CORES's own,
/cores/uab/prod/cores.9.9.9/base/public_web/fake_cores.html (any version number), for the self-test. It is used instead of `python -m http.server` in the project folder, which
would also serve reports\\ (patient data) to anything that can reach the port.

Any POST is answered with a small made-up reply (the fake page posts like CORES does: a log call, the report's
generate_pdf_2.php form); nothing posted is read or kept.
"""
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / 'capture_report.js'
CORES_PATH = re.compile(r'^/cores/[\w.-]+/[\w.-]+/cores\.[\d.]+/base/public_web/')


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(HERE), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _send(self, body, ctype):
        data = body.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        # the same files under an address shaped like CORES's own (/cores/<site>/<stage>/cores.<version>/base/public_web/),
        # for trying how the capture script finds the report's address; the folder itself, asked with a report's
        # parameters, is the fake report window (CORES opens its reports at public_web/?prg_name=...)
        m = CORES_PATH.match(self.path)
        if m:
            rest = self.path[m.end():]
            if rest == '' or rest.startswith('?'):
                rest = 'fake_report.html' + rest
            self.path = '/' + rest
        if self.path.split('?', 1)[0] == '/capture_report.js':
            self._send(SCRIPT.read_text(encoding='utf-8'), 'application/javascript; charset=utf-8')
            return
        super().do_GET()

    def do_POST(self):
        length = int(self.headers.get('Content-Length') or 0)
        if length:
            self.rfile.read(length)   # read and dropped
        if self.path.split('?', 1)[0].endswith('.php') and 'generate_pdf' in self.path:
            self._send('<!doctype html><title>fake PDF</title><p>Fake CORES: this is where the PDF would be.</p>',
                       'text/html; charset=utf-8')
        else:
            self._send('{"ok": true}', 'application/json')

    def log_message(self, fmt, *args):   # quiet: one line per request is noise in a test run
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    srv = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print(f'fake CORES on http://127.0.0.1:{port}/fake_cores.html   self-test: http://127.0.0.1:{port}/selftest.html   (Ctrl+C stops)')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass

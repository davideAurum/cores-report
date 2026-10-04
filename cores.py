#!/usr/bin/env python3
"""cores -- CORES ICU Daily Report: `cores capture`, then `cores generate`.

`cores` on its own lists only those two. Also available: watch, open, print, pdf, clean, doctor, setup, config,
bundle, parse, render, latest, annotate, har; `cores help COMMAND` shows one, README.md describes them all.
"""
import argparse
import contextlib
import datetime as dt
import hashlib
import importlib.util
import io
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))  # the parser / renderer modules live next to this file

IS_WIN = platform.system() == 'Windows'
IS_MAC = platform.system() == 'Darwin'
CONFIG_FILE = HERE / 'cores.config.json'
DEFAULTS = {
    'reports_dir': 'reports',        # where captures are collected and outputs written; relative to this folder unless absolute
    'inbox_dirs': ['~/Downloads'],   # where the browser saves captures (the Windows Downloads folder is looked up when redirected)
    'import_mode': 'move',           # 'move' or 'copy' a capture from an inbox into reports_dir (PHI: move leaves no copy behind)
    'browser': '',                   # Chromium browser exe for PDF / kiosk printing; '' = first of Edge, Chrome found
    'printer': '',                   # printer name for `--print` without a dialog (needs Adobe Acrobat); '' = browser print dialog
    'acrobat': '',                   # Acrobat.exe / AcroRd32.exe used for printing to a named printer; '' = auto
    'keep': 3,                       # capture sets kept by `cores clean`
    'open_after_run': True,          # `cores generate` opens the Daily Report in the browser
    'orientation': 'landscape',      # paper a new Daily Report prints on: 'landscape' or 'portrait' (its Paper switch overrides)
}
REPORT_IDS = {'281': 'Anesthesia ICU w/ Meds (nine columns)', '8': 'I-PASS Detailed (six columns)'}
DERIVED = {'json': '{stem}.json', 'report': '{stem} - Daily Report.html', 'pdf': '{stem} - Daily Report.pdf',
           'annotate': '{stem} - annotate.html'}
# derived-file names, tolerating the " (2)" a browser or Explorer appends to a duplicate
DERIVED_RE = {'part': re.compile(r' - Daily Report( \(\d+\))?\.part\.pdf$', re.I),   # a PDF still being written (or abandoned)
              'report': re.compile(r' - Daily Report( \(\d+\))?\.html?$', re.I), 'pdf': re.compile(r' - Daily Report( \(\d+\))?\.pdf$', re.I),
              'annotate': re.compile(r' - annotate( \(\d+\))?\.html?$', re.I)}
SUFFIX_RE = re.compile(r' - (Daily Report|annotate)( \(\d+\))?(\.part)?$', re.I)
STAMP_RE = re.compile(r'(\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})')  # the date and time captureCores() puts in the file name
KIND_NAMES = {'capture': 'capture', 'json': 'parsed JSON', 'report': 'Daily Report', 'pdf': 'PDF', 'annotate': 'annotate copy',
              'part': 'unfinished PDF'}
CAPTURE_NAME_RE = re.compile(r'<!--\s*CORES capture ([^<>\r\n\\/:*?"|]+?\.html)\s*-->')  # written by captureCores()
CF_UNICODETEXT = 13


class CoresError(Exception):
    pass


def say(msg=''):
    try:
        print(msg, flush=True)
    except OSError:  # stdout closed early, e.g. `cores ... | head`: leave quietly, without a flush error at exit
        os._exit(0)


def rel(p):
    """Path for messages: relative to this folder when inside it, else absolute."""
    p = Path(p)
    try:
        return str(p.resolve().relative_to(HERE))
    except ValueError:
        return str(p)


# ---------------------------------------------------------------- config

def load_config():
    cfg = dict(DEFAULTS)
    if CONFIG_FILE.exists():
        try:
            user = json.loads(CONFIG_FILE.read_text(encoding='utf-8-sig'))
        except ValueError as ex:
            raise CoresError(f'{CONFIG_FILE.name} is not valid JSON: {ex}')
        if not isinstance(user, dict):
            raise CoresError(f'{CONFIG_FILE.name} must contain a JSON object')
        unknown = sorted(set(user) - set(DEFAULTS))
        if unknown:
            say(f'note: ignoring unknown setting(s) in {CONFIG_FILE.name}: {", ".join(unknown)}')
        cfg.update({k: v for k, v in user.items() if k in DEFAULTS})
    if isinstance(cfg['inbox_dirs'], str):
        cfg['inbox_dirs'] = [cfg['inbox_dirs']]
    try:
        cfg['keep'] = max(0, int(cfg['keep']))
    except (TypeError, ValueError):
        raise CoresError('"keep" in the config must be a whole number')
    if cfg['import_mode'] not in ('move', 'copy'):
        raise CoresError('"import_mode" in the config must be "move" or "copy"')
    cfg['orientation'] = str(cfg['orientation']).strip().lower()
    if cfg['orientation'] not in ('landscape', 'portrait'):
        raise CoresError('"orientation" in the config must be "landscape" or "portrait"')
    return cfg


def save_config(cfg_user):
    CONFIG_FILE.write_text(json.dumps(cfg_user, indent=2) + '\n', encoding='utf-8')


def windows_downloads():
    """The real Downloads folder (it can be redirected, e.g. into OneDrive)."""
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders') as k:
            val = winreg.QueryValueEx(k, '{374DE290-123F-4565-9164-39C4925E467B}')[0]
        p = Path(os.path.expandvars(val))
        if p.is_dir():
            return p
    except OSError:
        pass
    return None


def expand(p):
    """Config path -> absolute Path: '~/Downloads', '%USERPROFILE%\\x', or 'reports' (relative to this folder)."""
    s = str(p)
    if IS_WIN and s.replace('\\', '/').lower() == '~/downloads':
        d = windows_downloads()
        if d:
            return d
    q = Path(os.path.expandvars(os.path.expanduser(s)))
    return q if q.is_absolute() else HERE / q


def reports_dir(cfg, create=True):
    d = expand(cfg['reports_dir'])
    if create:
        d.mkdir(parents=True, exist_ok=True)
    return d


def inbox_dirs(cfg):
    return [expand(d) for d in cfg['inbox_dirs']]


def in_inbox(p, cfg):
    """True when p sits directly in one of the inbox folders."""
    return Path(p).resolve().parent in [d.resolve() for d in inbox_dirs(cfg) if d.is_dir()]


# ---------------------------------------------------------------- files

def stem_of(p):
    """'CORES report 281 2026-09-15 1957 - Daily Report.html' -> 'CORES report 281 2026-09-15 1957'."""
    return SUFFIX_RE.sub('', Path(p).stem)


def derived(p, kind):
    """The 'json' / 'report' / 'pdf' / 'annotate' file of p's capture set, next to p."""
    p = Path(p)
    return p.with_name(DERIVED[kind].format(stem=stem_of(p)))


_SNIFFED = {}  # (path, size, mtime) -> bool, so `watch` does not re-read every stray .html in Downloads on each poll


def looks_like_capture(p):
    n = p.name
    if n.startswith('CORES report ') or ' - UAB Core Work Mgr' in n:
        return True
    try:
        st = p.stat()
        key = (str(p), st.st_size, st.st_mtime_ns)
        if key in _SNIFFED:
            return _SNIFFED[key]
        if st.st_size > 50_000_000:
            return False
        blob = p.read_bytes()
    except OSError:
        return False
    _SNIFFED[key] = b'row_template' in blob and b'column_name=' in blob
    return _SNIFFED[key]


def looks_like_parsed(p):
    """A cores_parse JSON starts with its header, source and records keys."""
    try:
        with open(p, 'rb') as fh:
            head = fh.read(4096)
    except OSError:
        return False
    return b'"header"' in head and b'"records"' in head


def kind_of(p):
    """'capture' | 'json' | 'report' | 'pdf' | 'annotate' | None for a path."""
    p = Path(p)
    for kind, rx in DERIVED_RE.items():
        if rx.search(p.name):
            return kind
    if p.suffix.lower() == '.json':
        return 'json' if p.name.lower() != CONFIG_FILE.name.lower() and looks_like_parsed(p) else None
    if p.suffix.lower() in ('.html', '.htm') and p.is_file() and looks_like_capture(p):
        return 'capture'
    return None


def files_of_kind(d, kind):
    if not d.is_dir():
        return []
    return [p for p in d.iterdir() if p.is_file() and kind_of(p) == kind]


def newest(paths):
    return max(paths, key=lambda p: p.stat().st_mtime, default=None)


def search_dirs(cfg, include_inbox):
    dirs = [reports_dir(cfg, create=False), HERE]
    if include_inbox:
        dirs += inbox_dirs(cfg)
    out = []
    for d in dirs:
        if d.is_dir() and d.resolve() not in [x.resolve() for x in out]:
            out.append(d)
    return out


def find_newest(kind, cfg, include_inbox=False):
    return newest([p for d in search_dirs(cfg, include_inbox) for p in files_of_kind(d, kind)])


def resolve_file(given, kind, cfg, include_inbox=False):
    """The file to work on: the one given (relative to the current folder), else the newest of that kind."""
    if given:
        p = Path(given).expanduser()
        if not p.exists():
            raise CoresError(f'not found: {p}')
        return p.resolve()
    p = find_newest(kind, cfg, include_inbox)
    if p is None:
        where = ' or '.join(rel(d) for d in search_dirs(cfg, include_inbox))
        hint = '  Run `cores capture` for the capture steps.' if kind == 'capture' else '  Run `cores generate` first.'
        raise CoresError(f'no {KIND_NAMES[kind]} found in {where}.{hint}')
    return p


def unique_path(p):
    for i in range(2, 100):
        q = p.with_name(f'{p.stem} ({i}){p.suffix}')
        if not q.exists():
            return q
    raise CoresError(f'too many copies of {p.name}')


def same_bytes(a, b):
    try:
        return a.stat().st_size == b.stat().st_size and a.read_bytes() == b.read_bytes()
    except OSError:
        return False


def import_capture(src, cfg, copy=False):
    """Bring a capture into reports_dir. A capture already there stays put; one in an inbox folder or next to the
    scripts (left from before reports\\ existed) is moved in (copied with copy=True or import_mode 'copy'); one
    anywhere else is copied. Returns (path, how)."""
    src = Path(src).resolve()
    rd = reports_dir(cfg).resolve()
    if src.parent == rd:
        return src, 'in place'
    from_inbox = src.parent == HERE or in_inbox(src, cfg)
    move = from_inbox and not copy and cfg['import_mode'] == 'move'
    dst = rd / src.name
    if dst.exists():
        if same_bytes(dst, src):
            if move:
                src.unlink()
                return dst, f'already in {rel(rd)}; removed the duplicate in {src.parent}'
            return dst, f'already in {rel(rd)}'
        dst = unique_path(dst)
    try:
        if move:
            shutil.move(str(src), str(dst))
        else:
            shutil.copy2(str(src), str(dst))
    except PermissionError as ex:
        raise PermissionError(f'{src.name} is still in use by another program (the browser?): {ex}') from ex
    return dst, f'{"moved" if move else "copied"} from {src.parent}'


# ---------------------------------------------------------------- parse / render

def describe(data):
    h = data.get('header') or {}
    fmt = re.sub(r'^UAB Core Work Mgr\s*', '', h.get('report_format', '')).strip() or 'unknown format'
    return (f"{len(data['records'])} patients, {fmt}, {h.get('service') or '?'} / {h.get('team') or '?'}, "
            f"data as of {h.get('report_date') or '?'}")


def parse_capture(capture):
    """Parse a capture with cores_parse, turning a parser crash or an empty result into a clear message."""
    from cores_parse import parse_file
    capture = Path(capture)
    try:
        data = parse_file(str(capture))
    except PermissionError:
        raise  # still being written by the browser: not a bad capture, `watch` tries again
    except Exception as ex:  # a truncated / template-only capture crashes the row parsers
        size = capture.stat().st_size
        raise CoresError(f'could not parse {capture.name} ({type(ex).__name__}: {ex}). The file is {size:,} bytes'
                         + ('; a complete capture is usually well over 100,000 bytes, so this one was probably cut short. '
                            if size < 100_000 else '. ')
                         + 'Run captureCores() again in CORES (`cores capture` shows the steps); the new, newer capture is '
                         + f'picked up automatically and this file is left where it is: {capture}')
    data['source'] = capture.name
    if not data['records']:
        raise CoresError(f'no patient rows found in {capture.name}; is it a CORES report capture? File: {capture}')
    try:
        holes = capture.read_bytes().count(b'{{')  # Mustache placeholders: a rendered report has a few dozen, the bare template thousands
    except OSError:
        holes = 0
    if holes > 200 and not (data.get('header') or {}).get('report_date'):
        raise CoresError(f'{capture.name} is the unrendered CORES report template ({holes:,} unfilled {{{{placeholders}}}}, no report date): '
                         'CORES did not render the report before it was captured. Look at the report popup in CORES for an error message, '
                         f'then capture again; this file is left where it is: {capture}')
    return data


def do_parse(capture, out=None, data=None):
    capture = Path(capture)
    data = data if data is not None else parse_capture(capture)
    data['source'] = capture.name
    out = Path(out) if out else derived(capture, 'json')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding='utf-8')
    return data, out


def do_render(src, out=None, data=None, cfg=None):
    from cores_report import render
    src = Path(src)
    if data is None:
        if src.suffix.lower() == '.json':
            data = json.loads(src.read_text(encoding='utf-8-sig'))
            if not isinstance(data, dict) or 'records' not in data:
                raise CoresError(f'{src.name} is not a parsed CORES report (no "records")')
        else:
            data = parse_capture(src)
    out = Path(out) if out else derived(src, 'report')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render(data, (cfg or {}).get('orientation', 'landscape')), encoding='utf-8')
    return data, out


def take_capture(src, cfg, copy=False, parse=True):
    """Validate a capture where it is, then bring it into the reports folder. Returns (path, data or None)."""
    src = Path(src)
    data = parse_capture(src) if parse else None
    cap, how = import_capture(src, cfg, copy=copy)
    say(f'Capture:  {rel(cap)}  ({how})')
    if how.startswith('copied'):
        say(f'          the original stays in {src.parent} (PHI); delete it when it is no longer needed')
    return cap, data


# ---------------------------------------------------------------- browser, pdf, print

def _program_dirs():
    return [Path(v) for v in (os.environ.get(k) for k in ('ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA')) if v]


def chromium_exe(cfg):
    """Edge or Chrome, for headless PDF and kiosk printing. None if neither is found."""
    if cfg.get('browser'):
        p = expand(cfg['browser'])
        if not p.is_file():
            raise CoresError(f'"browser" in {CONFIG_FILE.name} is not a program file: {p}')
        return p
    cands = []
    if IS_WIN:
        cands += [d / 'Microsoft' / 'Edge' / 'Application' / 'msedge.exe' for d in _program_dirs()]
        cands += [d / 'Google' / 'Chrome' / 'Application' / 'chrome.exe' for d in _program_dirs()]
    elif IS_MAC:
        cands += [Path('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
                  Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')]
    for name in ('msedge', 'microsoft-edge', 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'):
        w = shutil.which(name)
        if w:
            cands.append(Path(w))
    return next((c for c in cands if c.is_file()), None)


def acrobat_exe(cfg):
    if cfg.get('acrobat'):
        p = expand(cfg['acrobat'])
        if not p.is_file():
            raise CoresError(f'"acrobat" in {CONFIG_FILE.name} is not a program file: {p}')
        return p
    if not IS_WIN:
        return None
    cands = []
    for d in _program_dirs():
        cands += [d / 'Adobe' / 'Acrobat DC' / 'Acrobat' / 'Acrobat.exe', d / 'Adobe' / 'Acrobat' / 'Acrobat' / 'Acrobat.exe',
                  d / 'Adobe' / 'Acrobat Reader DC' / 'Reader' / 'AcroRd32.exe', d / 'Adobe' / 'Acrobat Reader' / 'Reader' / 'AcroRd32.exe']
    return next((c for c in cands if c.is_file()), None)


def default_browser_exe():
    """The user's default browser exe on Windows (so a URL with a #fragment can be handed to it), else None."""
    if not IS_WIN:
        return None
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice') as k:
            progid = winreg.QueryValueEx(k, 'ProgId')[0]
        with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, progid + r'\shell\open\command') as k:
            cmd = winreg.QueryValueEx(k, None)[0]
    except OSError:
        return None
    m = re.match(r'\s*"([^"]+)"|\s*(\S+)', os.path.expandvars(cmd))
    exe = Path(m.group(1) or m.group(2)) if m else None
    return exe if exe and exe.is_file() else None


def file_url(path, fragment=''):
    return Path(path).resolve().as_uri() + (f'#{fragment}' if fragment else '')


def start(cmd, **kw):
    try:
        return subprocess.Popen(cmd, **kw)
    except OSError as ex:
        raise CoresError(f'could not start {cmd[0]}: {ex}')


def open_in_browser(path, cfg, fragment=''):
    """Open a file in the browser. With a fragment (e.g. 'print'), the browser exe is launched directly, because the
    OS file opener drops the fragment. Returns a short description of what was used."""
    path = Path(path).resolve()
    if fragment:
        exe = default_browser_exe() or chromium_exe(cfg)
        if exe:
            start([str(exe), file_url(path, fragment)])
            return exe.stem
        if not IS_WIN:
            start(['open' if IS_MAC else 'xdg-open', file_url(path, fragment)])
            return 'default browser'
        raise CoresError('no browser found to open the report with')
    try:
        if IS_WIN:
            os.startfile(str(path))
        else:
            start(['open' if IS_MAC else 'xdg-open', str(path)])
    except OSError as ex:
        raise CoresError(f'could not open {path.name}: {ex}')
    return 'default browser'


def powershell(script, timeout=30):
    """Run a PowerShell snippet (Windows PowerShell 5.1 is always present); its stdout as text, or None on failure.
    Output is forced to UTF-8 so printer or process names outside the console code page cannot break decoding."""
    cmd = ['powershell', '-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' + script]
    try:
        r = subprocess.run(cmd, capture_output=True, encoding='utf-8', errors='replace', timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout if r.returncode == 0 else None


def browser_pids_using(marker):
    """PIDs of Edge/Chrome processes whose command line contains `marker` (a temp profile folder name): [] when none,
    None when it cannot be determined (no PowerShell, or not Windows: there the child process is waited on directly)."""
    if not IS_WIN:
        return None
    out = powershell("@(Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' or Name='chrome.exe'\" | "
                     f"Where-Object {{ $_.CommandLine -like '*{marker}*' }} | ForEach-Object {{ $_.ProcessId }}) -join ','")
    if out is None:
        return None
    try:
        return [int(x) for x in out.strip().split(',') if x.strip()]
    except ValueError:
        return None


def wait_for_browser(proc, profile, timeout):
    """Wait until the browser launched with --user-data-dir=profile has exited; True if it has. On Windows msedge.exe
    hands the work to a detached process and returns at once, so the profile's users are polled instead of the child.
    Whatever is still running at the deadline is terminated, so the temporary profile can be removed."""
    try:
        proc.wait(timeout=5 if IS_WIN else timeout)
        if not IS_WIN:
            return True
    except subprocess.TimeoutExpired:
        if not IS_WIN:
            proc.terminate()
            return False
    marker = Path(profile).name
    deadline = time.time() + timeout
    pids = browser_pids_using(marker)
    if pids == []:  # the detached browser process may not be listed yet right after the launcher returns
        time.sleep(2)
        pids = browser_pids_using(marker)
    while pids and time.time() < deadline:
        time.sleep(1.5)
        pids = browser_pids_using(marker)
    if pids is None:  # cannot tell: give a detached process a moment
        time.sleep(3)
        return True
    for pid in pids:
        try:
            os.kill(pid, 9)
        except OSError:
            pass
    if pids:
        time.sleep(1)
    return not pids


def wait_for_file(path, timeout):
    """True once `path` exists, is non-empty, has kept its size over two checks, and is not held open for writing."""
    path = Path(path)
    deadline, last = time.time() + timeout, -1
    while time.time() < deadline:
        if path.exists():
            size = path.stat().st_size
            if size and size == last:
                try:
                    with open(path, 'ab'):
                        return True
                except OSError:
                    pass
            last = size
        time.sleep(0.5)
    return False


def remove_dir(d):
    """rmtree with retries (a closing browser releases files late, and a helper process of Edge can re-create the
    profile folder moments after it is gone); True when the folder is gone. Also used to replace python\\."""
    for _ in range(10):
        shutil.rmtree(d, ignore_errors=True)
        if not Path(d).exists():
            time.sleep(1.5)
            shutil.rmtree(d, ignore_errors=True)
            if not Path(d).exists():
                return True
        time.sleep(1)
    say(f'note: could not remove {d}; delete it by hand')
    return False


def make_pdf(report, cfg, out=None):
    """Daily Report -> PDF with headless Edge/Chrome, honouring the report's @page CSS (letter, landscape or portrait).
    The PDF is written under a temporary name and swapped into place; if the old PDF is open elsewhere (Acrobat keeps a printed
    PDF open) the new one gets a " (2)" name instead of failing."""
    exe = chromium_exe(cfg)
    if not exe:
        raise CoresError('no Microsoft Edge or Google Chrome found for PDF output; set "browser" in cores.config.json')
    report = Path(report).resolve()
    out = Path(out).resolve() if out else derived(report, 'pdf')
    out.parent.mkdir(parents=True, exist_ok=True)
    part = out.with_name(out.stem + '.part.pdf')
    tmp = tempfile.mkdtemp(prefix='cores-pdf-')
    proc, done = None, False
    try:
        if part.exists():
            part.unlink()
        cmd = [str(exe), '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-sync',
               f'--user-data-dir={tmp}', '--no-pdf-header-footer', f'--print-to-pdf={part}', file_url(report)]
        proc = start(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        # Chrome writes the PDF before it exits; Edge on Windows returns at once and a detached process writes it
        if not wait_for_file(part, timeout=180):
            raise CoresError(f'{exe.name} produced no PDF within 3 minutes; try `cores open` and print from the browser')
        done = True
    except OSError as ex:
        raise CoresError(f'could not write the PDF: {ex}')
    finally:
        if proc is not None:
            wait_for_browser(proc, tmp, timeout=30)
        remove_dir(tmp)
        if not done:  # never raise from here: an unfinished PDF is PHI, so remove it once the browser lets go
            for _ in range(10):
                try:
                    part.unlink(missing_ok=True)
                    break
                except OSError:
                    time.sleep(1)
            if part.exists():
                say(f'note: an unfinished PDF was left at {part}; `cores clean` removes it with its capture set')
    try:
        os.replace(part, out)
    except PermissionError:
        alt = unique_path(out)
        os.replace(part, alt)
        say(f'note: {out.name} is open in another program (Acrobat?), so the new PDF is {alt.name}')
        out = alt
    return out, exe


def windows_printers():
    """['*Default printer', ' Other printer', ...] on Windows, [] elsewhere or on failure."""
    if not IS_WIN:
        return []
    out = powershell("Get-CimInstance Win32_Printer | ForEach-Object { ($(if ($_.Default) {'*'} else {' '}) + $_.Name) }") or ''
    return [ln.rstrip() for ln in out.splitlines() if ln.strip()]


def default_printer():
    return next((p[1:].strip() for p in windows_printers() if p.startswith('*')), '')


def do_print(report, cfg, to=None, kiosk=False, dialog=False):
    """Print a Daily Report.
      default          open it in the browser with the print dialog already up (choose printer, press Print)
      to=PRINTER       no dialog: PDF via headless Edge/Chrome, then Adobe Acrobat sends it to that printer
      kiosk=True       no dialog: Edge/Chrome '--kiosk-printing' sends it to the OS default printer
      dialog=True      the dialog even when a printer is set in the config
    Returns (description, report_is_now_open_on_screen)."""
    report = Path(report).resolve()
    if kiosk:
        exe = chromium_exe(cfg)
        if not exe:
            raise CoresError('no Microsoft Edge or Google Chrome found for kiosk printing')
        default = default_printer()
        tmp = tempfile.mkdtemp(prefix='cores-print-')
        try:
            cmd = [str(exe), '--kiosk-printing', '--no-first-run', '--no-default-browser-check', '--disable-sync',
                   f'--user-data-dir={tmp}', file_url(report, 'print-close')]
            proc = start(cmd)
            finished = wait_for_browser(proc, tmp, timeout=120)  # the page prints on load and closes itself afterwards
        finally:
            remove_dir(tmp)
        if not finished:
            raise CoresError(f'{exe.stem} had not finished printing after 2 minutes and was closed. Default printer: '
                             f'{default or "unknown"}. Check the printer, or use `cores print` for the dialog.')
        return f'sent to the default printer{f" ({default})" if default else ""} by {exe.stem} (kiosk printing)', False
    printer = '' if dialog else (to or cfg.get('printer') or '')
    if printer:
        acro = acrobat_exe(cfg)
        if not acro:
            raise CoresError('printing to a named printer needs Adobe Acrobat / Acrobat Reader, which was not found. '
                             'Use `cores print` (dialog) or `cores print --kiosk` (default printer) instead.')
        pdf, _ = make_pdf(report, cfg)
        start([str(acro), '/h', '/t', str(pdf), printer])
        return f'{pdf.name} sent to "{printer}" by {acro.stem} (Acrobat stays open in the background afterwards; that is normal)', False
    used = open_in_browser(report, cfg, fragment='print')
    return f'opened in {used} with the print dialog', True


# ---------------------------------------------------------------- clipboard, PATH

def win_clipboard_api():
    """(ctypes, user32, kernel32) with the clipboard and global-memory functions typed for 64-bit handles."""
    import ctypes
    from ctypes import wintypes
    u, k = ctypes.windll.user32, ctypes.windll.kernel32
    k.GlobalAlloc.restype = wintypes.HGLOBAL
    k.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
    k.GlobalLock.restype = ctypes.c_void_p
    k.GlobalLock.argtypes = [wintypes.HGLOBAL]
    k.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
    u.SetClipboardData.restype = wintypes.HANDLE
    u.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
    u.GetClipboardData.restype = wintypes.HANDLE
    u.GetClipboardData.argtypes = [wintypes.UINT]
    return ctypes, u, k


def to_clipboard(text):
    try:
        if IS_WIN:
            ctypes, u, k = win_clipboard_api()
            data = text.encode('utf-16-le') + b'\0\0'
            if not u.OpenClipboard(None):
                return False
            try:
                u.EmptyClipboard()
                h = k.GlobalAlloc(0x0042, len(data))  # GMEM_MOVEABLE | GMEM_ZEROINIT
                ptr = k.GlobalLock(h)
                ctypes.memmove(ptr, data, len(data))
                k.GlobalUnlock(h)
                return bool(u.SetClipboardData(CF_UNICODETEXT, h))  # the system owns h from here
            finally:
                u.CloseClipboard()
        if IS_MAC:
            subprocess.run(['pbcopy'], input=text.encode('utf-8'), check=True)
            return True
        for tool in (['wl-copy'], ['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard', '--input']):
            if shutil.which(tool[0]):
                subprocess.run(tool, input=text.encode('utf-8'), check=True)
                return True
    except Exception:
        pass
    return False


def clipboard_text():
    """Text on the clipboard, or ''."""
    try:
        if IS_WIN:
            ctypes, u, k = win_clipboard_api()
            if not u.IsClipboardFormatAvailable(CF_UNICODETEXT):
                return ''
            for _ in range(5):  # another program may hold the clipboard for a moment
                if u.OpenClipboard(None):
                    break
                time.sleep(0.1)
            else:
                return ''
            try:
                h = u.GetClipboardData(CF_UNICODETEXT)
                if not h:
                    return ''
                p = k.GlobalLock(h)
                try:
                    return ctypes.wstring_at(p) if p else ''
                finally:
                    k.GlobalUnlock(h)
            finally:
                u.CloseClipboard()
        if IS_MAC:
            return subprocess.run(['pbpaste'], capture_output=True, text=True, timeout=10).stdout
        for tool in (['wl-paste', '--no-newline'], ['xclip', '-selection', 'clipboard', '-o'], ['xsel', '--clipboard', '--output']):
            if shutil.which(tool[0]):
                return subprocess.run(tool, capture_output=True, text=True, timeout=10).stdout
    except Exception:
        pass
    return ''


def clipboard_is_script(text):
    """True when the clipboard holds the capture script itself (put there by `cores capture`), not a report."""
    return 'captureCores' in text and 'CORES report capture' in text[:300]


def clipboard_capture(cfg, skip_sha=None):
    """A CORES report on the clipboard (captureCores puts it there) -> saved into the reports folder.
    Returns (path or None, sha of the clipboard text or None, saved_now); skip_sha = a text already handled."""
    text = clipboard_text()
    if not text or 'row_template' not in text or 'column_name=' not in text or clipboard_is_script(text):
        return None, None, False
    text = text.replace('\r\n', '\n')
    sha = hashlib.sha256(text.encode('utf-8', 'surrogatepass')).hexdigest()
    if sha == skip_sha:
        return None, sha, False
    m = CAPTURE_NAME_RE.search(text[:400])
    name = m.group(1).strip() if m else f'CORES report clip {dt.datetime.now():%Y-%m-%d %H%M}.html'
    dst = reports_dir(cfg) / name
    if dst.exists():
        try:
            with open(dst, encoding='utf-8', errors='replace', newline='') as fh:
                if fh.read() == text:
                    return dst, sha, False  # this capture was saved already
        except OSError:
            pass
        dst = unique_path(dst)
    with open(dst, 'w', encoding='utf-8', newline='') as fh:
        fh.write(text)
    return dst, sha, True


def add_to_user_path(folder):
    folder = str(Path(folder).resolve())
    if not IS_WIN:
        say(f'Add this folder to your PATH, e.g. in ~/.bashrc or ~/.zshrc:\n  export PATH="{folder}:$PATH"')
        return
    import ctypes
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment', 0, winreg.KEY_READ | winreg.KEY_WRITE) as k:
        try:
            cur, typ = winreg.QueryValueEx(k, 'Path')
        except FileNotFoundError:
            cur, typ = '', winreg.REG_EXPAND_SZ
        parts = [p for p in cur.split(';') if p]
        if any(os.path.normcase(os.path.expandvars(p).rstrip('\\')) == os.path.normcase(folder) for p in parts):
            say(f'Already on your user PATH: {folder}')
            return
        winreg.SetValueEx(k, 'Path', 0, typ, ';'.join(parts + [folder]))
    ctypes.windll.user32.SendMessageTimeoutW(0xFFFF, 0x1A, 0, 'Environment', 2, 5000, None)
    say(f'Added to your user PATH: {folder}\nOpen a new terminal, then `cores` works from any folder.')


# ---------------------------------------------------------------- pipeline

def run_pipeline(src, cfg, do_open=True, want_print=False, want_pdf=False, copy=False, clean=False, printer=None, kiosk=False, dialog=False,
                 skip_done=False):
    """skip_done: leave a capture alone when an identical copy was already processed (used by `watch`, where the same
    report can arrive twice, on the clipboard and as a download)."""
    src = Path(src)
    kind = kind_of(src)
    if kind == 'report':
        report = src.resolve()
        say(f'Daily Report: {rel(report)}')
    elif kind == 'json':
        data, report = do_render(src, cfg=cfg)
        say(f'Rendered: {rel(report)}  ({describe(data)})')
    elif kind == 'capture':
        if skip_done:
            rd = reports_dir(cfg)
            twin = rd / src.name
            done = derived(twin, 'report')
            if src.resolve().parent != rd.resolve() and done.exists() and same_bytes(twin, src):
                if cfg['import_mode'] == 'move' and not copy and in_inbox(src, cfg):
                    src.unlink()
                    say(f'Capture:  {src.name} was already processed from the clipboard; removed the duplicate in {src.parent}')
                else:
                    say(f'Capture:  {src.name} was already processed; left alone')
                return done
        cap, data = take_capture(src, cfg, copy=copy)   # parsed where it is, moved in only when it parses
        data, js = do_parse(cap, data=data)
        say(f'Parsed:   {rel(js)}  ({describe(data)})')
        data, report = do_render(js, data=data, cfg=cfg)
        say(f'Rendered: {rel(report)}')
    else:
        raise CoresError(f'{src.name} is not a CORES capture, parsed JSON, or Daily Report')
    if want_pdf:
        pdf, exe = make_pdf(report, cfg)
        say(f'PDF:      {rel(pdf)}  (via {exe.stem})')
    on_screen = False
    if want_print:
        msg, on_screen = do_print(report, cfg, to=printer, kiosk=kiosk, dialog=dialog)
        say(f'Print:    {msg}')
    if do_open and not on_screen:
        say(f'Opened:   {rel(report)} in the {open_in_browser(report, cfg)}')
    if clean:
        clean_sets(cfg, keep=cfg['keep'], dry_run=False, yes=True, inbox=False)
    return report


def capture_sets(cfg):
    """{stem: [files]} for everything in reports_dir that belongs to a capture."""
    rd = reports_dir(cfg, create=False)
    sets = {}
    if rd.is_dir():
        for p in rd.iterdir():
            if p.is_file() and kind_of(p):
                sets.setdefault(stem_of(p), []).append(p)
    return sets


def set_time(stem, files):
    """When a capture set was taken: the date and time in its name, else the capture file's mtime, else the newest file."""
    m = STAMP_RE.search(stem)
    if m:
        try:
            return dt.datetime(*map(int, m.groups())).timestamp()
        except ValueError:
            pass
    caps = [p for p in files if kind_of(p) == 'capture']
    return max(p.stat().st_mtime for p in (caps or files))


def clean_sets(cfg, keep, dry_run, yes, inbox):
    rd = reports_dir(cfg, create=False)
    sets = capture_sets(cfg)
    order = sorted(sets, key=lambda s: set_time(s, sets[s]), reverse=True)
    doomed = [p for s in order[keep:] for p in sorted(sets[s])]
    kept_dupes = []
    if inbox:
        rd_caps = files_of_kind(rd, 'capture')
        for d in inbox_dirs(cfg):
            for p in files_of_kind(d, 'capture'):
                # its copy in the reports folder may have been renamed "... (2)" on import
                twins = [c for c in rd_caps if re.fullmatch(re.escape(p.stem) + r'( \(\d+\))?' + re.escape(p.suffix), c.name, re.I)]
                if any(same_bytes(c, p) for c in twins):
                    doomed.append(p)          # an identical copy is already in the reports folder
                elif twins:
                    kept_dupes.append(p)      # same name, different content: not processed yet
    for p in kept_dupes:
        say(f'  left alone (same name as a capture in {rel(rd)} but different content, so not processed yet): {p}')
    if rd.resolve() != HERE:
        root = sorted(p for p in HERE.iterdir() if p.is_file() and kind_of(p))
        if root:
            say(f'note: {len(root)} report file(s) (PHI) sit next to the scripts in {HERE}; `cores clean` does not touch them. '
                f'`cores generate` on a capture there moves it into {rel(rd)}; delete or move the rest by hand:')
            for p in root:
                say(f'    {p.name}')
    if not doomed:
        say(f'Nothing to clean: {len(sets)} capture set(s) in {rel(rd)}, keeping the newest {keep}.')
        return 0
    for p in doomed:
        say(('  would delete ' if dry_run else '  delete ') + str(p))
    if dry_run:
        return 0
    if not yes:
        try:
            ans = input(f'Delete these {len(doomed)} file(s)? [y/N] ')
        except EOFError:
            ans = ''
        if ans.strip().lower() not in ('y', 'yes'):
            say('Cancelled.')
            return 0
    for p in doomed:
        p.unlink()
    say(f'Deleted {len(doomed)} file(s); kept the newest {min(keep, len(sets))} capture set(s) in {rel(rd)}.')
    return len(doomed)


# ---------------------------------------------------------------- commands

def pipeline_opts(a, cfg):
    """run_pipeline() keyword arguments from the options `run` and `watch` share."""
    return dict(do_open=not a.no_open and cfg['open_after_run'], want_print=bool(a.print or a.to or a.kiosk or a.dialog),
                want_pdf=a.pdf, copy=a.copy, clean=a.clean, printer=a.to, kiosk=a.kiosk, dialog=a.dialog)


def say_error(ex):
    say(f'error: {ex}' if isinstance(ex, (CoresError, PermissionError)) else f'error: {type(ex).__name__}: {ex}')


def unrendered_capture(cfg):
    """Newest capture in the reports folder that has no Daily Report yet (e.g. rescued from the clipboard by `capture`)."""
    return newest([p for p in files_of_kind(reports_dir(cfg, create=False), 'capture') if not derived(p, 'report').exists()])


def generate_source(a, cfg):
    """What `generate` works on: FILE if given; else the newest capture in Downloads; else the clipboard."""
    if a.file:
        return resolve_file(a.file, 'capture', cfg)
    if not a.clipboard:
        src = newest([p for d in inbox_dirs(cfg) for p in files_of_kind(d, 'capture')])
        if src:
            return src
        say(f'No capture in {" or ".join(str(d) for d in inbox_dirs(cfg))}; using the clipboard.')
    src, _, saved_now = clipboard_capture(cfg)
    if src:
        say(f'Clipboard: {rel(src)}' + ('' if saved_now else '  (this report was saved before)'))
        return src
    if clipboard_is_script(clipboard_text()):
        src = unrendered_capture(cfg)
        if src:
            say(f'The clipboard holds the capture script; using the report `cores capture` saved before it: {rel(src)}')
            return src
        raise CoresError('the clipboard holds the capture script (from `cores capture`), not a report. Open the report in '
                         'CORES with the script running, then run this again.')
    raise CoresError('no CORES report in Downloads or on the clipboard. `cores capture` shows the steps to capture one.')


def cmd_generate(a, cfg):
    run_pipeline(generate_source(a, cfg), cfg, **pipeline_opts(a, cfg))


def cmd_capture(a, cfg):
    js_path = HERE / 'capture_report.js'
    if not js_path.exists():
        raise CoresError(f'{js_path.name} is missing from {HERE}')
    rid = str(a.id)
    opts = [o for o, on in (('download: false', a.no_download), ('folder: true', a.folder)) if on]
    optstr = '{' + ', '.join(opts) + '}' if opts else ''
    call = f'captureCores({rid}{", " + optstr if optstr else ""});' if a.direct else f'captureCores({optstr});'
    text = js_path.read_text(encoding='utf-8')
    if not a.no_run:
        text = text.rstrip('\n') + '\n\n' + call + '\n'
    rescued, _, saved_now = clipboard_capture(cfg)  # a report still on the clipboard from the last capture must not be lost
    if rescued:
        say(f'The clipboard held a report from CORES: {"saved as" if saved_now else "already saved as"} {rel(rescued)}. '
            'Run `cores generate` to build its Daily Report.')
    copied = to_clipboard(text)
    inbox = ', '.join(str(d) for d in inbox_dirs(cfg))
    say('CORES capture')
    say('  1. In the CORES patient-list window (the Cerner-hosted one, inside Citrix) press F12 and open the Console tab.')
    if copied:
        say(f'  2. Paste and press Enter. The clipboard holds the capture script with   {call}   at the end.')
    else:
        say(f'  2. Paste the contents of {js_path.name} (clipboard unavailable here), press Enter, then run   {call}')
    say('     First time only: Chrome refuses the paste until you type   allow pasting   and press Enter; then paste again.')
    say('     (DevTools > Sources > Snippets never asks: paste into a new snippet once and run it with Ctrl+Enter.)')
    if a.direct:
        say(f'  3. The script opens report {rid} itself in a popup ({REPORT_IDS.get(rid, "report id " + rid)}).')
    else:
        say('  3. Open the report from CORES as you normally do (its own report / print button). The script captures the window')
        say('     CORES opens, so it works whenever CORES\'s own button works. (--direct makes the script open the report itself.)')
    say('     When the report has rendered, its HTML goes on the clipboard'
        + ('' if a.no_download else ' and downloads as "CORES report <id> <date> <time>.html"')
        + ('; the patient list shows a button to save it into your folder' if a.folder else '') + '. The report window closes.')
    say('  4. Back on this PC:')
    say(f'       cores generate --print              newest capture in {inbox}, else the clipboard -> Daily Report -> print')
    say('       cores watch --clipboard --print     ... automatically for every capture, until Ctrl+C')
    say(f'  Report ids (for --direct): {", ".join(f"{k} = {v}" for k, v in REPORT_IDS.items())}.')
    say('  Options: --direct [--id 8], --no-download (clipboard only, no save dialog), --folder (also save into a folder picked once).')
    say('  If the CORES console says it could not copy, click "Copy to clipboard" in the banner at the top of the patient list.')


def cmd_parse(a, cfg):
    src = resolve_file(a.file, 'capture', cfg, include_inbox=True)
    cap, data = take_capture(src, cfg, copy=a.copy)
    data, out = do_parse(cap, a.out, data=data)
    say(f'Parsed:   {rel(out)}  ({describe(data)})')


def cmd_render(a, cfg):
    if a.file:
        src = resolve_file(a.file, 'capture', cfg)
    else:
        src = find_newest('json', cfg) or resolve_file(None, 'capture', cfg, include_inbox=True)
    if src.suffix.lower() == '.json':
        data, out = do_render(src, a.out, cfg=cfg)
    else:
        cap, data = take_capture(src, cfg, copy=a.copy)
        data, out = do_render(cap, a.out, data=data, cfg=cfg)
    say(f'Rendered: {rel(out)}  ({describe(data)})')
    if a.open:
        say(f'Opened:   in the {open_in_browser(out, cfg)}')


def cmd_open(a, cfg):
    rep = resolve_file(a.file, 'report', cfg)
    say(f'Opened:   {rel(rep)} in the {open_in_browser(rep, cfg)}')


def cmd_print(a, cfg):
    rep = resolve_file(a.file, 'report', cfg)
    msg, _ = do_print(rep, cfg, to=a.to, kiosk=a.kiosk, dialog=a.dialog)
    say(f'Print:    {rel(rep)}: {msg}')


def cmd_pdf(a, cfg):
    rep = resolve_file(a.file, 'report', cfg)
    pdf, exe = make_pdf(rep, cfg, a.out)
    say(f'PDF:      {rel(pdf)}  ({pdf.stat().st_size:,} bytes, via {exe.stem})')
    if a.open:
        open_in_browser(pdf, cfg)


def cmd_watch(a, cfg):
    if a.inbox:  # a folder given on the command line is relative to the current folder, like every other path argument
        cfg = dict(cfg, inbox_dirs=[str(Path(a.inbox).expanduser().resolve())])
    dirs = [d for d in inbox_dirs(cfg) if d.is_dir()]
    if not dirs:
        raise CoresError('none of the inbox folders exist; check "inbox_dirs" in cores.config.json or pass --inbox')

    def snapshot():
        out = {}
        for d in dirs:
            for p in files_of_kind(d, 'capture'):
                try:
                    st = p.stat()
                except OSError:
                    continue  # vanished between listing and stat
                out[p.resolve()] = (st.st_size, st.st_mtime_ns)
        return out

    seen = snapshot()  # what is already there is left alone; a file that reappears with new content counts as new
    pending, busy, clip_sha, clip_sha_seen = {}, {}, None, None
    opts = pipeline_opts(a, cfg)
    say(f'Watching {", ".join(str(d) for d in dirs)}{" and the clipboard" if a.clipboard else ""} for new captures every '
        f'{a.interval:g}s (Ctrl+C to stop)')
    while True:
        if a.clipboard:
            try:
                path, sha, saved_now = clipboard_capture(cfg, skip_sha=clip_sha)
            except (OSError, CoresError) as ex:
                path, sha, saved_now = None, None, False
                say(f'error reading the clipboard capture: {ex}')
            clip_sha = sha or clip_sha
            # a report that was saved and rendered before (e.g. by `cores generate` just before this watch started) is left alone
            if path and (saved_now or not derived(path, 'report').exists()):
                say(f'\n{dt.datetime.now():%H:%M:%S}  capture from the clipboard: {path.name}')
                try:
                    run_pipeline(path, cfg, **opts)
                except Exception as ex:  # keep watching whatever went wrong with this capture
                    say_error(ex)
            elif path and sha != clip_sha_seen:
                say(f'{dt.datetime.now():%H:%M:%S}  the clipboard holds {path.name}, which is already processed')
            clip_sha_seen = sha or clip_sha_seen
        for path, sig in snapshot().items():
            if seen.get(path) == sig:
                continue
            if sig[0] == 0 or pending.get(path) != sig:
                pending[path] = sig  # still being written; wait for a stable size
                continue
            say(f'\n{dt.datetime.now():%H:%M:%S}  new capture: {path.name}')
            try:
                run_pipeline(path, cfg, **opts, skip_done=True)
            except PermissionError as ex:
                busy[path] = busy.get(path, 0) + 1
                if busy[path] <= 5:
                    say(f'  {ex}; trying again shortly')
                    pending.pop(path, None)
                    continue  # not marked seen: retried on a later tick
                say_error(ex)
            except Exception as ex:  # keep watching whatever went wrong with this one file
                say_error(ex)
            seen[path] = sig
            pending.pop(path, None)
            busy.pop(path, None)
        time.sleep(a.interval)


def cmd_latest(a, cfg):
    rd = reports_dir(cfg, create=False)
    say('Inbox (where the browser saves captures):')
    for d in inbox_dirs(cfg):
        if not d.is_dir():
            say(f'  {d}: folder not found')
            continue
        caps = files_of_kind(d, 'capture')
        n = newest(caps)
        say(f'  {d}: {len(caps)} capture(s)' + (f', newest {n.name} ({dt.datetime.fromtimestamp(n.stat().st_mtime):%Y-%m-%d %H:%M})' if n else ''))
    say(f'Reports folder: {rd}' + ('' if rd.is_dir() else ' (not created yet)'))
    say('Newest files (in the reports folder or next to the scripts):')
    for kind in ('capture', 'json', 'report', 'pdf'):
        n = find_newest(kind, cfg)
        say(f'  newest {KIND_NAMES[kind]:<12} {rel(n) if n else "-"}')
    use = newest([p for d in inbox_dirs(cfg) for p in files_of_kind(d, 'capture')])
    say(f'`cores generate` would use: {use or "the clipboard (no capture in Downloads)"}')


def cmd_clean(a, cfg):
    keep = a.keep if a.keep is not None else cfg['keep']
    clean_sets(cfg, keep=max(0, keep), dry_run=a.dry_run, yes=a.yes, inbox=a.inbox)


def cmd_annotate(a, cfg):
    src = resolve_file(a.file, 'capture', cfg, include_inbox=True)
    try:
        cap, _ = take_capture(src, cfg, copy=a.copy)
    except CoresError as ex:  # a capture that does not parse is exactly what one wants to look at, but it is not moved
        say(f'note: {ex}')
        say('Annotating it where it is.')
        cap = src
    from annotate_source import main as annotate_main
    with contextlib.redirect_stdout(io.StringIO()):  # it prints the output path itself
        out = annotate_main(str(cap))
    say(f'Annotate copy: {rel(out)}')
    if a.open:
        open_in_browser(out, cfg)


def cmd_har(a, cfg):
    f = Path(a.file).expanduser()
    if not f.is_file():
        raise CoresError(f'not found: {f}')
    from har_extract import main as har_main
    try:
        har_main([str(f)] + ([a.prefix] if a.prefix else []))
    except (OSError, ValueError, AttributeError, TypeError, KeyError) as ex:
        raise CoresError(f'could not read {f.name} as a HAR export or copied request ({type(ex).__name__}: {ex})')


def cmd_doctor(a, cfg):
    problems = 0

    def line(ok, label, detail='', required=True):
        nonlocal problems
        mark = 'OK ' if ok else ('!! ' if required else '-- ')
        if not ok and required:
            problems += 1
        say(f'  [{mark}] {label}' + (f': {detail}' if detail else ''))

    say(f'cores doctor  ({HERE})')
    line(sys.version_info >= (3, 10), 'Python 3.10+', f'{platform.python_version()} at {sys.executable}')
    for mod, pkg in (('bs4', 'beautifulsoup4'), ('lxml', 'lxml')):
        try:
            __import__(mod)
            line(True, f'{pkg} installed')
        except ImportError:
            line(False, f'{pkg} installed', f'missing; run `cores setup` or `{Path(sys.executable).name} -m pip install {pkg}`')
    for f in ('cores_parse.py', 'cores_parse_anes.py', 'cores_report.py', 'capture_report.js', 'annotate_source.py', 'har_extract.py'):
        line((HERE / f).exists(), f, '' if (HERE / f).exists() else 'missing')
    try:
        b = chromium_exe(cfg)
        line(bool(b), 'Edge / Chrome for PDF and printing', str(b) if b else 'not found (PDF, --kiosk and named-printer printing unavailable)', required=False)
    except CoresError as ex:
        line(False, 'Edge / Chrome for PDF and printing', str(ex), required=False)
    try:
        acro = acrobat_exe(cfg)
        line(bool(acro), 'Adobe Acrobat for printing to a named printer', str(acro) if acro else 'not found (`--to PRINTER` unavailable)', required=False)
    except CoresError as ex:
        line(False, 'Adobe Acrobat for printing to a named printer', str(ex), required=False)
    if IS_WIN:
        prs = windows_printers()
        line(bool(prs), 'Printers', ('  '.join(p[1:].strip() + (' (default)' if p.startswith('*') else '') for p in prs)) if prs else 'none found', required=False)
    for d in inbox_dirs(cfg):
        line(d.is_dir(), f'Inbox {d}', f'{len(files_of_kind(d, "capture"))} capture(s)' if d.is_dir() else 'folder not found', required=False)
    rd = reports_dir(cfg, create=False)
    line(True, f'Reports folder {rd}', f'{len(capture_sets(cfg))} capture set(s)' if rd.is_dir() else 'will be created on first run')
    line(True, 'Config', f'{CONFIG_FILE}' if CONFIG_FILE.exists() else 'defaults (create with `cores config --init`)')
    ok, detail = bundle_check()
    broken = not ok and (HERE / 'python').exists()  # a missing python\ is fine; one that is there but unusable is not
    line(ok, 'Bundled Python', detail + ('; rebuild it with `.\\bundle`' if broken else ''), required=broken)
    say('  ' + ('All required checks passed.' if not problems else f'{problems} problem(s) marked !! above.'))
    return 1 if problems else 0


def cmd_setup(a, cfg):
    req = HERE / 'requirements.txt'
    if importlib.util.find_spec('pip') is None:  # the bundled (embeddable) Python has no pip; its packages come with it
        try:
            import bs4, lxml  # noqa: F401
            say(f'Bundled Python at {sys.executable}: packages already included, nothing to install.')
        except ImportError:
            raise CoresError('this Python has no pip and lacks the packages; rebuild it by running `.\\bundle` in this folder')
    else:
        say(f'Installing Python packages from {req.name} with {sys.executable} ...')
        r = subprocess.run([sys.executable, '-m', 'pip', 'install', '-r', str(req)])
        if r.returncode:
            say('Retrying with --user ...')
            r = subprocess.run([sys.executable, '-m', 'pip', 'install', '--user', '-r', str(req)])
            if r.returncode:
                raise CoresError('pip could not install the requirements; see the messages above')
    reports_dir(cfg)
    if a.add_path:
        add_to_user_path(HERE)
    say('')
    return cmd_doctor(a, cfg)


BUNDLE_PROBE = (
    'import json, os, sys, bs4, lxml.etree; '
    'print(json.dumps({"version": sys.version.split()[0], "prefix": sys.prefix, "bs4_version": bs4.__version__, '
    '"lxml_version": lxml.etree.__version__, '
    '"files": {"stdlib": os.__file__, "bs4": bs4.__file__, "lxml": lxml.etree.__file__}}))'
)


def bundle_check(dest=None):
    """Is <folder>\\python a Python that carries its own stdlib and packages? Returns (ok, detail).

    Checked the hard way, by running it, because the failure that matters is silent: an embeddable Python whose
    python*._pth is missing drops out of isolated mode and borrows an installed Python's stdlib. It then works
    perfectly on the machine that built it and dies on the PC the folder was copied to -- which is the only machine
    the bundle exists for. `-I` plus the "every file it loaded lives under python\\" test below is what catches that.
    """
    dest = Path(dest or HERE / 'python')
    exe = dest / 'python.exe'
    if not exe.exists():
        return False, 'none; this folder needs an installed Python (`.\\bundle` adds a private one)'
    if next(dest.glob('python*._pth'), None) is None:
        return False, f'{rel(exe)} is not self-contained (no python*._pth, so it falls back to an installed Python)'
    try:
        r = subprocess.run([str(exe), '-I', '-c', BUNDLE_PROBE], capture_output=True, text=True,
                           errors='replace', timeout=120)
    except (OSError, subprocess.SubprocessError) as ex:
        return False, f'{rel(exe)} does not run ({ex})'
    if r.returncode:
        why = ((r.stderr or '').strip().splitlines() or ['no output'])[-1]
        return False, f'{rel(exe)} is missing its stdlib or packages ({why})'
    try:
        got = json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return False, f'{rel(exe)} did not report its version'
    outside = sorted(k for k, f in got['files'].items() if not Path(f).is_relative_to(dest))
    if outside:
        return False, (f'{rel(exe)} borrows {", ".join(outside)} from elsewhere on this PC ({got["files"][outside[0]]}), '
                       'so the folder would not run once copied')
    return True, f'{rel(exe)}: Python {got["version"]}, beautifulsoup4 {got["bs4_version"]}, lxml {got["lxml_version"]}'


def http_request(url, method='GET'):
    return urllib.request.Request(url, method=method, headers={'User-Agent': 'cores-cli'})


def http_get(url, timeout=120):
    try:
        with urllib.request.urlopen(http_request(url), timeout=timeout) as r:
            return r.read()
    except OSError as ex:
        raise CoresError(f'could not download {url}: {ex}')


def http_size(url):
    try:
        with urllib.request.urlopen(http_request(url, 'HEAD'), timeout=30) as r:
            return int(r.headers.get('Content-Length') or 0)
    except OSError as ex:
        raise CoresError(f'not available: {url} ({ex})')


def pypi_wheel(pkg, tag):
    """The newest wheel on PyPI whose file name ends in `tag`: (filename, url, size, sha256)."""
    info = json.loads(http_get(f'https://pypi.org/pypi/{pkg}/json'))

    def pick(files):
        return next(((f['filename'], f['url'], f['size'], f['digests']['sha256']) for f in files if f['filename'].endswith(tag)), None)

    found = pick(info.get('urls') or [])
    if found is None:  # the newest release has no such wheel yet: look back through earlier releases
        def vkey(v):
            return tuple(int(x) if x.isdigit() else -1 for x in re.split(r'[.\-]', v))
        for ver in sorted(info.get('releases') or {}, key=vkey, reverse=True):
            found = pick(info['releases'][ver])
            if found:
                break
    if found is None:
        raise CoresError(f'PyPI has no {pkg} wheel ending in "{tag}"; pick another Python with `cores bundle --version X.Y.Z`')
    return found


def cmd_bundle(a, cfg):
    """Put python.org's embeddable Python plus beautifulsoup4 / soupsieve / lxml into <folder>\\python, so cores.cmd can
    run on a computer with no Python installed. Needs internet once (python.org and pypi.org)."""
    if not IS_WIN:
        raise CoresError('bundling uses the Windows embeddable Python; run it on Windows')
    ver = a.version or platform.python_version()
    parts = ver.split('.')
    if len(parts) != 3 or not all(x.isdigit() for x in parts) or (int(parts[0]), int(parts[1])) < (3, 10):
        raise CoresError(f'--version must be a full Python version of 3.10 or newer, e.g. 3.13.7 (got "{ver}")')
    cp = f'cp{parts[0]}{parts[1]}'
    arch = a.arch or ('arm64' if platform.machine().upper() == 'ARM64' else 'amd64')
    dest = HERE / 'python'
    zip_url = f'https://www.python.org/ftp/python/{ver}/python-{ver}-embed-{arch}.zip'
    say(f'Bundle Python {ver} ({arch}) into {dest}')
    plan = [('python.org', zip_url, http_size(zip_url), None)]
    # Every wheel has to be named here: the embeddable Python has no pip, so nothing resolves dependencies for us.
    # soupsieve and typing_extensions are beautifulsoup4's; bundle_check() below is what notices when one is missing.
    for pkg, tag in (('beautifulsoup4', 'py3-none-any.whl'), ('soupsieve', 'py3-none-any.whl'),
                     ('typing_extensions', 'py3-none-any.whl'), ('lxml', f'{cp}-{cp}-win_{arch}.whl')):
        _, url, size, sha = pypi_wheel(pkg, tag)
        plan.append((pkg, url, size, sha))
    total = 0
    for name, url, size, _ in plan:
        total += size
        say(f'  {name:<16} {size / 1e6:6.1f} MB  {url}')
    say(f'  total download   {total / 1e6:6.1f} MB (about twice that on disk)')
    if a.dry_run:
        say('Dry run: nothing downloaded.')
        return 0
    if dest.exists():
        ok, detail = bundle_check(dest)
        if not a.force:
            raise CoresError(f'{rel(dest)}\\ already exists and ' + ('works', 'is broken')[not ok] + f': {detail}.\n'
                             '       Replace it with `cores bundle --force` (or `.\\bundle`, which works with no Python installed).')
        say(f'Replacing the existing {rel(dest)} ({("works", "broken")[not ok]}) ...')
        if not remove_dir(dest):
            raise CoresError(f'could not remove {rel(dest)}; close anything running from it and try again')
    dest.mkdir(parents=True)
    say('Downloading Python ...')
    zipfile.ZipFile(io.BytesIO(http_get(zip_url))).extractall(dest)
    pth = next(dest.glob('python*._pth'), None)
    if pth is None:
        raise CoresError(f'the embeddable zip did not contain a python*._pth file; is {ver} a real release?')
    lines = [ln for ln in pth.read_text(encoding='utf-8').splitlines() if ln.strip() and not ln.startswith('#')]
    lines = [ln for ln in lines if ln != 'import site']
    pth.write_text('\n'.join(lines + ['Lib\\site-packages', 'import site']) + '\n', encoding='utf-8')  # packages live here
    site = dest / 'Lib' / 'site-packages'
    site.mkdir(parents=True, exist_ok=True)
    for name, url, size, sha in plan[1:]:
        say(f'Downloading {name} ...')
        data = http_get(url)
        if hashlib.sha256(data).hexdigest() != sha:
            raise CoresError(f'{name}: the download did not match the checksum PyPI publishes; try again')
        zipfile.ZipFile(io.BytesIO(data)).extractall(site)  # a wheel is a zip laid out like site-packages
    ok, detail = bundle_check(dest)
    if not ok:
        remove_dir(dest)  # never leave a half-good python\ behind: cores.cmd would prefer it to a working Python
        raise CoresError(f'the download finished but the result is not usable, so {rel(dest)} was removed again:\n'
                         f'       {detail}')
    used = sum(p.stat().st_size for p in dest.rglob('*') if p.is_file())
    say(f'Bundled Python works, carrying its own stdlib and packages: {detail} ({used / 1e6:.0f} MB).')
    say('cores.cmd now uses it first. Copy this folder (without reports\\) to any Windows PC and run .\\cores; no installation needed.')
    return 0


def cmd_help(a, cfg):
    p = build_parser()
    if a.topic:
        sp = p.sub.choices.get(a.topic)
        if sp is None:
            say(f'cores: no command called "{a.topic}". Commands: {", ".join(p.sub.choices)}\n')
        else:
            sp.print_help()
            return 0
    p.print_help()
    return 0


def cmd_config(a, cfg):
    user = {}
    if CONFIG_FILE.exists():
        user = json.loads(CONFIG_FILE.read_text(encoding='utf-8-sig'))
    if a.init:
        if CONFIG_FILE.exists():
            say(f'{CONFIG_FILE.name} already exists.')
        else:
            save_config(DEFAULTS)
            user = dict(DEFAULTS)
            say(f'Wrote {CONFIG_FILE} with the defaults; edit it in any text editor.')
    if a.set:
        key, val = a.set
        if key not in DEFAULTS:
            raise CoresError(f'unknown setting "{key}"; settings: {", ".join(DEFAULTS)}')
        if isinstance(DEFAULTS[key], list):
            parsed = [v.strip() for v in val.split(';') if v.strip()]
        elif isinstance(DEFAULTS[key], bool):
            parsed = val.strip().lower() in ('1', 'true', 'yes', 'on')
        elif isinstance(DEFAULTS[key], int):
            try:
                parsed = int(val)
            except ValueError:
                raise CoresError(f'"{key}" must be a whole number')
        else:
            parsed = val
        user[key] = parsed
        save_config(user)
        say(f'Set {key} = {json.dumps(parsed)} in {CONFIG_FILE.name}')
    cfg = load_config()
    say(f'Config file: {CONFIG_FILE}' + ('' if CONFIG_FILE.exists() else ' (not present; using defaults)'))
    show = dict(cfg)
    show['reports_dir'] = f'{cfg["reports_dir"]}  -> {reports_dir(cfg, create=False)}'
    show['inbox_dirs'] = [f'{d}  -> {expand(d)}' for d in cfg['inbox_dirs']]
    say(json.dumps(show, indent=2))


# ---------------------------------------------------------------- main

def build_parser():
    p = argparse.ArgumentParser(prog='cores', description='CORES ICU Daily Report')
    sub = p.add_subparsers(dest='cmd', metavar='command')

    def add(name, fn, help, listed=None, **kw):
        """listed: the one-line text for the overview; commands without it work but are not listed there."""
        if listed:
            kw['help'] = listed
        sp = sub.add_parser(name, description=help, formatter_class=argparse.RawDescriptionHelpFormatter, **kw)
        sp.set_defaults(fn=fn)
        return sp

    sp = add('capture', cmd_capture, 'put capture_report.js (plus its captureCores(...) call) on the clipboard and show how to run it in the CORES window',
             listed='put the capture script on the clipboard and show the steps for CORES')
    sp.add_argument('--direct', action='store_true', help='the script opens the report itself (captureCores(ID)) instead of capturing the window CORES opens')
    sp.add_argument('--id', default='281', help='report id for --direct (281 = Anesthesia ICU w/ Meds, 8 = I-PASS Detailed)')
    sp.add_argument('--no-download', action='store_true', help='clipboard hand-off only: the browser does not download a file')
    sp.add_argument('--folder', action='store_true', help='also save into a folder chosen once with the browser\'s folder picker')
    sp.add_argument('--no-run', action='store_true', help='copy the script without the captureCores(...) call at the end')

    def print_opts(sp, implies=False):
        pre = '(implies --print) ' if implies else ''
        g = sp.add_mutually_exclusive_group()
        g.add_argument('--to', metavar='PRINTER', help=pre + 'print without a dialog to this printer (needs Adobe Acrobat)')
        g.add_argument('--kiosk', action='store_true', help=pre + 'print without a dialog to the OS default printer (Edge/Chrome kiosk printing)')
        g.add_argument('--dialog', action='store_true', help=pre + 'use the browser print dialog even when "printer" is set in the config')

    def copy_opt(sp):
        sp.add_argument('--copy', action='store_true', help='copy the capture into the reports folder instead of moving it')

    sp = add('generate', cmd_generate, 'make the Daily Report from the newest capture in Downloads, or from the clipboard when '
                                       'Downloads has none, and open it. FILE may also be a .json or a Daily Report.',
             listed='make the Daily Report from the newest capture in Downloads, else the clipboard')
    sp.add_argument('file', nargs='?', metavar='FILE', help='capture to process (default: newest in Downloads, else the clipboard)')
    sp.add_argument('--clipboard', action='store_true', help='use the clipboard even when Downloads has a capture')
    sp.add_argument('--print', action='store_true', help='print the Daily Report: browser print dialog, or no dialog with --to / --kiosk or a "printer" in the config')
    print_opts(sp, implies=True)
    sp.add_argument('--pdf', action='store_true', help='also write "<capture> - Daily Report.pdf" with headless Edge/Chrome')
    sp.add_argument('--no-open', action='store_true', help='do not open the Daily Report in the browser')
    copy_opt(sp)
    sp.add_argument('--clean', action='store_true', help='afterwards delete older capture sets, keeping "keep" (config) newest')

    sp = add('parse', cmd_parse, 'capture HTML -> parsed JSON (the capture is moved into the reports folder first; the JSON is written next to it)')
    sp.add_argument('file', nargs='?', metavar='FILE')
    sp.add_argument('-o', '--out', help='output .json path')
    copy_opt(sp)

    sp = add('render', cmd_render, 'capture HTML or parsed JSON -> Daily Report HTML (a capture is moved into the reports folder first; output next to the source)')
    sp.add_argument('file', nargs='?', metavar='FILE', help='default: newest parsed JSON, else newest capture')
    sp.add_argument('-o', '--out', help='output .html path')
    sp.add_argument('--open', action='store_true', help='open the result in the browser')
    copy_opt(sp)

    sp = add('open', cmd_open, 'open a Daily Report in the browser (default: the newest)')
    sp.add_argument('file', nargs='?', metavar='FILE')

    sp = add('print', cmd_print, 'print a Daily Report (default: the newest). Without options the browser opens with the print dialog up, '
                                 'unless "printer" is set in the config.')
    sp.add_argument('file', nargs='?', metavar='FILE')
    print_opts(sp)

    sp = add('pdf', cmd_pdf, 'Daily Report -> PDF with headless Edge/Chrome (letter, in the orientation the report was made with)')
    sp.add_argument('file', nargs='?', metavar='FILE')
    sp.add_argument('-o', '--out', help='output .pdf path')
    sp.add_argument('--open', action='store_true', help='open the PDF afterwards')

    sp = add('watch', cmd_watch, 'watch the inbox folder(s) (and the clipboard with --clipboard); run every new capture automatically (Ctrl+C to stop)')
    sp.add_argument('--clipboard', action='store_true', help='also take captures that captureCores puts on the clipboard')
    sp.add_argument('--inbox', metavar='DIR', help='folder to watch (default: "inbox_dirs" in the config)')
    sp.add_argument('--interval', type=float, default=2.0, help='seconds between checks (default 2)')
    sp.add_argument('--print', action='store_true', help='print each Daily Report')
    print_opts(sp, implies=True)
    sp.add_argument('--pdf', action='store_true', help='also write a PDF for each')
    sp.add_argument('--no-open', action='store_true', help='do not open each Daily Report in the browser')
    copy_opt(sp)
    sp.add_argument('--clean', action='store_true', help='delete older capture sets after each run')

    add('latest', cmd_latest, 'show the newest capture, JSON, Daily Report and PDF, and what `cores generate` would use')

    sp = add('clean', cmd_clean, 'delete older capture sets (capture, JSON, Daily Report, PDF, annotate copy) from the reports folder')
    sp.add_argument('--keep', type=int, metavar='N', help='capture sets to keep (default: "keep" in the config, 3)')
    sp.add_argument('--inbox', action='store_true', help='also delete captures left in the inbox folders that are identical to a copy in the reports folder')
    sp.add_argument('--dry-run', action='store_true', help='only list what would be deleted')
    sp.add_argument('-y', '--yes', action='store_true', help='do not ask for confirmation')

    sp = add('annotate', cmd_annotate, 'make an annotatable copy of a capture (hover = parser field, click = name it); the capture is moved into the reports folder first')
    sp.add_argument('file', nargs='?', metavar='FILE')
    sp.add_argument('--open', action='store_true', help='open the annotate copy in the browser')
    copy_opt(sp)

    sp = add('har', cmd_har, 'fallback capture: recover report HTML from a DevTools HAR export or a copied cURL / request payload')
    sp.add_argument('file', metavar='FILE')
    sp.add_argument('prefix', nargs='?', help='output name prefix')

    add('doctor', cmd_doctor, 'check Python, packages, browsers, printers and folders')

    sp = add('setup', cmd_setup, 'install the Python packages, create the reports folder, run doctor')
    sp.add_argument('--add-path', action='store_true', help='add this folder to your user PATH so `cores` works from anywhere (Windows)')

    sp = add('config', cmd_config, 'show the settings; --init writes cores.config.json; --set changes one setting')
    sp.add_argument('--init', action='store_true', help='write cores.config.json with the defaults (if it does not exist yet)')
    sp.add_argument('--set', nargs=2, metavar=('KEY', 'VALUE'), help='e.g. --set printer "EPSON ET-4800"   --set inbox_dirs "~/Downloads;D:/drop"')

    sp = add('bundle', cmd_bundle, 'download a private copy of Python (python.org embeddable build) and the packages into python\\, '
                                   'so the folder runs on a PC with no Python installed; needs internet once')
    sp.add_argument('--version', metavar='X.Y.Z', help='Python version to bundle (default: the one running now)')
    sp.add_argument('--arch', choices=['amd64', 'arm64'], help='Windows build (default: this machine)')
    sp.add_argument('--dry-run', action='store_true', help='only show what would be downloaded and how big it is')
    sp.add_argument('--force', action='store_true', help='replace an existing python\\ folder')

    sp = add('help', cmd_help, 'show this help, or the options of one command: cores help run')
    sp.add_argument('topic', nargs='?', metavar='COMMAND')
    p.sub = sub
    return p


HELP_ALIASES = {'-help', '-?', '/?', '/help'}  # what Windows users tend to type; all mean --help
NEEDS_PACKAGES = {'run', 'capture', 'parse', 'watch'}  # the commands that import cores_parse (bs4 + lxml)


def missing_packages():
    missing = []
    for mod, pkg in (('bs4', 'beautifulsoup4'), ('lxml', 'lxml')):
        try:
            __import__(mod)
        except ImportError:
            missing.append(pkg)
    return missing


def check_dependencies(cfg):
    """Has `cores setup` been done for this Python? The import test is the answer (a marker file would go stale whenever
    the launcher picks a different interpreter). If not, offer to run setup now, then carry on with the command."""
    if sys.version_info < (3, 10):
        raise CoresError(f'Python 3.10+ is required; this is {platform.python_version()} ({sys.executable}). '
                         'Install a newer Python, or run `.\\bundle` to get a private one.')
    missing = missing_packages()
    if not missing:
        return
    say(f'First-time setup needed: {", ".join(missing)} not installed for {sys.executable}.')
    if not (sys.stdin and sys.stdin.isatty()):
        raise CoresError('run `.\\cores setup` (or `.\\bundle` for a private Python), then try again.')
    try:
        answer = input('Run `cores setup` now? [Y/n] ').strip().lower()
    except EOFError:
        answer = 'n'
    if answer not in ('', 'y', 'yes'):
        raise CoresError('not set up; run `.\\cores setup` when ready (`.\\bundle` makes a private Python with everything included).')
    import argparse as _ap, importlib
    cmd_setup(_ap.Namespace(add_path=False), cfg)
    importlib.invalidate_caches()
    if missing_packages():
        raise CoresError('setup finished but the packages still cannot be imported; run `.\\cores doctor` for details.')
    say('Setup complete; continuing.\n')


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors='replace')
        except (AttributeError, ValueError):
            pass
    argv = ['--help' if t.lower() in HELP_ALIASES else t for t in (sys.argv[1:] if argv is None else argv)]
    parser = build_parser()
    a = parser.parse_args(argv)
    try:
        cfg = load_config()
        if not a.cmd:
            parser.print_help()
            return 0
        if a.cmd in NEEDS_PACKAGES:
            check_dependencies(cfg)
        return a.fn(a, cfg) or 0
    except (CoresError, PermissionError) as ex:
        say(f'cores: {ex}')
        return 1
    except KeyboardInterrupt:
        say('\nStopped.')
        return 130


if __name__ == '__main__':
    sys.exit(main())

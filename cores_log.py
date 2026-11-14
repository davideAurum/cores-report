#!/usr/bin/env python3
"""cores_log -- the cores log: one line for every run of a cores command and for every event of a capture's HUD, kept
beyond any one capture, report or session, in a folder that can follow you between computers.

Where: the "log_dir" setting when set; else "<OneDrive>\\CORES Report log" on a PC that has OneDrive; else
"%LOCALAPPDATA%\\CORES Report\\log". One file per computer, cores-log.<computer>.jsonl, so two computers never write
the same file; `cores log` reads them all together.

What: JSON Lines, only ever appended to, one write per line. Because the folder leaves this PC, a line holds fixed
fields only, each checked against a pattern before it is written and again when it is read: when, which computer,
which command, the cores version, how it ended, the exit code, how long it took, a few named counts, and for an error
the name of its exception class. Never a message, a path, a file name, or anything out of a report.

    {"t": "2026-11-14T07:01:10.120Z", "computer": "ICU-PC", "source": "pc", "command": "generate", "version": "1.0.0",
     "outcome": "ok", "exit": 0, "ms": 2140, "counts": {"patients": 57, "bytes": 1203311, "captures": 1}}
    {"t": "2026-11-14T07:01:02.345Z", "computer": "ICU-PC", "source": "hud", "id": "k3f9a2-17", "ev": "verdict",
     "k": "success", "n": 57, "ms": 8123, "version": "1.0.0"}

The HUD's events come in the capture, written by captureCores() just before its closing </html>:
    <!-- CORES log {"v":1,"events":[{"id":"k3f9a2-17","t":"2026-11-14T07:01:02.345Z","ev":"verdict","k":"success","n":57,"ms":8123}]} -->

Writing the log never stops or holds up a command: whatever goes wrong is swallowed, with at most one short note on
stderr per run. Standard library only.
"""
import datetime as dt
import json
import os
import platform
import re
import sys
import time
from pathlib import Path

FOLDER_NAME = 'CORES Report log'                                  # under OneDrive
ONEDRIVE_VARS = ('OneDriveCommercial', 'OneDrive', 'OneDriveConsumer')  # the first that names an existing folder wins
FILE_GLOB = 'cores-log.*.jsonl'
OUTCOMES = ('ok', 'error', 'refused', 'interrupted')
COUNT_KEYS = ('patients', 'bytes', 'captures', 'files', 'hud_events')  # the only counts an entry can carry
HUD_START = b'<!-- CORES log '
HUD_VERSION = 1
HUD_KEYS = {'id', 't', 'ev', 'k', 'n', 'ms'}
MAX_INT = 2 ** 53        # what JavaScript counts to exactly
MAX_EVENTS = 5000        # per capture; a HUD keeps far fewer
MAX_CAPTURE = 50_000_000

TIME_RE = re.compile(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z')
COMPUTER_RE = re.compile(r'[A-Za-z0-9_-]{1,40}')
COMMAND_RE = re.compile(r'[a-z][a-z_-]{0,29}')
VERSION_RE = re.compile(r'[0-9A-Za-z.+-]{1,20}')
ERROR_RE = re.compile(r'[A-Za-z_][A-Za-z0-9_]{0,59}')   # an exception class name
ID_RE = re.compile(r'[a-z0-9-]{3,40}')
EV_RE = re.compile(r'[a-z_]{2,30}')
K_RE = re.compile(r'[a-z0-9_]{1,30}')

_noted = False


def note(ex):
    """The one line a run may print about its log: that it was not written, and the kind of error. Nothing else."""
    global _noted
    if _noted:
        return
    _noted = True
    try:
        sys.stderr.write(f'note: the cores log was not written ({type(ex).__name__}); the command itself is unaffected\n')
    except Exception:
        pass


# ---------------------------------------------------------------- where

def computer_name(env=None):
    """This computer's name as it appears in the log and in its file name: letters, digits, - and _ only."""
    env = os.environ if env is None else env
    raw = env.get('COMPUTERNAME') or platform.node() or ''
    return re.sub(r'[^A-Za-z0-9_-]+', '-', raw).strip('-')[:40] or 'unknown'


def onedrive_dirs(env=None):
    """The OneDrive folders this PC has, work account first."""
    env = os.environ if env is None else env
    out = []
    for var in ONEDRIVE_VARS:
        val = env.get(var)
        if val and Path(val).is_dir() and Path(val) not in out:
            out.append(Path(val))
    return out


def log_folder(setting=None, env=None):
    """(folder, how): the "log_dir" setting when set ('setting'); else "CORES Report log" in OneDrive ('onedrive');
    else "CORES Report\\log" in the user profile's local app data ('profile'). Nothing is created here."""
    env = os.environ if env is None else env
    if setting and str(setting).strip():
        return Path(os.path.expandvars(os.path.expanduser(str(setting).strip()))), 'setting'
    drives = onedrive_dirs(env)
    if drives:
        return drives[0] / FOLDER_NAME, 'onedrive'
    local = env.get('LOCALAPPDATA')
    if local:
        return Path(local) / 'CORES Report' / 'log', 'profile'
    return Path.home() / '.cores-report' / 'log', 'profile'


def under_onedrive(folder, env=None):
    """True when the folder is inside one of this PC's OneDrive folders, so OneDrive carries it to the other computers."""
    try:
        f = Path(folder).resolve()
    except OSError:
        return False
    for d in onedrive_dirs(env):
        try:
            f.relative_to(d.resolve())
            return True
        except (ValueError, OSError):
            pass
    return False


def log_file(folder, computer=None):
    return Path(folder) / f'cores-log.{computer or computer_name()}.jsonl'


def log_files(folder):
    """Every computer's log file in the folder, by name."""
    try:
        return sorted(p for p in Path(folder).glob(FILE_GLOB) if p.is_file())
    except OSError:
        return []


# ---------------------------------------------------------------- what an entry may hold

def utc(epoch=None):
    """Seconds since 1970 (default: now) -> '2026-11-14T07:01:02.345Z'."""
    t = dt.datetime.fromtimestamp(time.time() if epoch is None else epoch, dt.timezone.utc)
    return t.strftime('%Y-%m-%dT%H:%M:%S.') + f'{t.microsecond // 1000:03d}Z'


def clean_time(t):
    """An ISO 8601 UTC time ('...Z') -> the same to the millisecond, or None when it is not one."""
    m = TIME_RE.fullmatch(t) if isinstance(t, str) else None
    if not m:
        return None
    try:
        dt.datetime.strptime(m.group(1), '%Y-%m-%dT%H:%M:%S')
    except ValueError:
        return None
    return f'{m.group(1)}.{(m.group(2) or "")[:3]:0<3}Z'


def _text(v, rx):
    return v if isinstance(v, str) and rx.fullmatch(v) else None


def _whole(v):
    """A non-negative whole number, or None (True and 3.0 are not whole numbers here)."""
    return v if type(v) is int and 0 <= v <= MAX_INT else None


def clean_event(ev):
    """One HUD event as the capture carries it -> {id, t, ev[, k][, n][, ms]}, or None when anything about it is off:
    a key outside those six, a missing id / t / ev, or a value that does not match its pattern. This is what keeps
    free text out of the log, so it refuses rather than repairs."""
    if not isinstance(ev, dict) or not set(ev) <= HUD_KEYS:
        return None
    out = {'id': _text(ev.get('id'), ID_RE), 't': clean_time(ev.get('t')), 'ev': _text(ev.get('ev'), EV_RE)}
    if None in out.values():
        return None
    if 'k' in ev:
        out['k'] = _text(ev['k'], K_RE)
    for key in ('n', 'ms'):
        if key in ev:
            out[key] = _whole(ev[key])
    return None if None in out.values() else out


def clean_entry(e):
    """A log entry with nothing but its fixed fields, in a fixed order; None when it is not a log entry. Used on the
    way in and on the way out: a line written by another computer is trusted no more than one about to be written."""
    if not isinstance(e, dict):
        return None
    t, computer, source = clean_time(e.get('t')), _text(e.get('computer'), COMPUTER_RE), e.get('source')
    if not t or not computer:
        return None
    version = _text(e.get('version'), VERSION_RE)
    if source == 'hud':
        ev = clean_event({k: e[k] for k in HUD_KEYS if k in e})
        if not ev:
            return None
        out = {'t': t, 'computer': computer, 'source': 'hud', 'id': ev['id'], 'ev': ev['ev']}
        out.update({k: ev[k] for k in ('k', 'n', 'ms') if k in ev})
        if version:
            out['version'] = version
        return out
    if source != 'pc':
        return None
    command = _text(e.get('command'), COMMAND_RE)
    if not command or e.get('outcome') not in OUTCOMES:
        return None
    out = {'t': t, 'computer': computer, 'source': 'pc', 'command': command}
    if version:
        out['version'] = version
    out['outcome'] = e['outcome']
    code = e.get('exit')
    out['exit'] = code if type(code) is int and -MAX_INT <= code <= MAX_INT else 1
    if _whole(e.get('ms')) is not None:
        out['ms'] = e['ms']
    counts = e.get('counts') if isinstance(e.get('counts'), dict) else {}
    counts = {k: counts[k] for k in COUNT_KEYS if _whole(counts.get(k)) is not None}
    if counts:
        out['counts'] = counts
    if _text(e.get('error'), ERROR_RE):
        out['error'] = e['error']
    return out


# ---------------------------------------------------------------- writing

def append(folder, entries, computer=None):
    """Append the entries to this computer's file in the folder, one line and one write each. Returns how many were
    written; never raises (see note())."""
    try:
        lines = []
        for e in entries:
            e = clean_entry(e)
            if e:
                lines.append((json.dumps(e, separators=(',', ':')) + '\n').encode('ascii'))
        if not lines:
            return 0
        folder = Path(folder)
        folder.mkdir(parents=True, exist_ok=True)
        with open(log_file(folder, computer), 'a+b', buffering=0) as fh:
            if fh.seek(0, os.SEEK_END) > 0:   # a last line cut short (a crash, a sync conflict) must not swallow the next one
                fh.seek(-1, os.SEEK_END)
                if fh.read(1) != b'\n':
                    lines[0] = b'\n' + lines[0]
            for line in lines:
                fh.write(line)
        return len(lines)
    except Exception as ex:
        note(ex)
        return 0


def log_command(folder, command, version, outcome, exit_code, ms, counts=None, error=None, started=None, computer=None):
    """One entry for a cores command that has just ended. started: when it began, in seconds since 1970 (default: now
    less its duration); error: the exception's class name, nothing more."""
    try:
        ms = max(0, int(ms))
        entry = {'t': utc(time.time() - ms / 1000 if started is None else started), 'computer': computer or computer_name(),
                 'source': 'pc', 'command': command, 'version': version, 'outcome': outcome, 'exit': exit_code, 'ms': ms,
                 'counts': dict(counts or {}), 'error': error}
        return append(folder, [entry], computer)
    except Exception as ex:
        note(ex)
        return 0


# ---------------------------------------------------------------- the HUD's events, out of a capture

def hud_events(blob):
    """The HUD events a capture carries, each checked by clean_event(); [] for a capture without the comment (every
    capture made before it existed), with one that does not parse, or of a version this does not know.

    Read the way cores_parse reads <!-- CORES data ... -->: the last such comment, up to its -->, as JSON.
    captureCores() writes < > and -- inside it as \\u003c \\u003e and -\\u002d, which the JSON reader turns back."""
    if isinstance(blob, str):
        blob = blob.encode('utf-8', 'replace')
    i = blob.rfind(HUD_START)
    if i < 0:
        return []
    j = blob.find(b'-->', i)
    if j < 0:
        return []
    try:
        info = json.loads(blob[i + len(HUD_START):j].decode('utf-8'))
    except ValueError:
        return []
    if not isinstance(info, dict) or info.get('v') != HUD_VERSION or not isinstance(info.get('events'), list):
        return []
    out, seen = [], set()
    for ev in info['events'][:MAX_EVENTS]:
        ev = clean_event(ev)
        if ev and ev['id'] not in seen:
            seen.add(ev['id'])
            out.append(ev)
    return out


def logged_ids(path):
    """The ids of the HUD events already in one log file."""
    ids = set()
    try:
        with open(path, 'rb') as fh:
            for line in fh:
                if b'"hud"' in line:
                    try:
                        e = json.loads(line)
                    except ValueError:
                        continue
                    if isinstance(e, dict) and isinstance(e.get('id'), str):
                        ids.add(e['id'])
    except OSError:
        pass
    return ids


def log_hud(folder, capture, version, computer=None):
    """Append a capture file's HUD events to this computer's log, leaving out the ones it already has (the same
    capture is often read more than once: from the clipboard and from Downloads, or again by `cores parse`).
    Returns how many were added; never raises."""
    try:
        capture = Path(capture)
        try:
            if capture.stat().st_size > MAX_CAPTURE:
                return 0
            blob = capture.read_bytes()
        except OSError:   # gone, or still being written by the browser: the command reading it next says so itself
            return 0
        events = hud_events(blob)
        if not events:
            return 0
        computer = computer or computer_name()
        have = logged_ids(log_file(folder, computer))
        new = [dict(ev, computer=computer, source='hud', version=version) for ev in events if ev['id'] not in have]
        return append(folder, new, computer)
    except Exception as ex:
        note(ex)
        return 0


# ---------------------------------------------------------------- reading

def read_all(folder):
    """Every computer's entries in the folder, oldest first. Lines that are not log entries are skipped, and so is a
    repeat: a HUD event two computers both imported, or a line in a sync-conflict copy of a file."""
    entries, seen = [], set()
    for path in log_files(folder):
        try:
            with open(path, 'rb') as fh:
                lines = fh.read().splitlines()
        except OSError:
            continue
        for line in lines:
            try:
                e = clean_entry(json.loads(line))
            except ValueError:
                continue
            if not e:
                continue
            key = ('hud', e['id']) if e['source'] == 'hud' else json.dumps(e, sort_keys=True)
            if key not in seen:
                seen.add(key)
                entries.append(e)
    entries.sort(key=lambda e: e['t'])   # stable: entries of the same millisecond stay in file order
    return entries


def _took(ms):
    if ms is None:
        return ''
    if ms < 1000:
        return f'{ms} ms'
    s = ms / 1000
    if s < 60:
        return f'{s:.1f} s'
    if s < 3600:
        return f'{int(s // 60)}m {int(s % 60):02d}s'
    return f'{int(s // 3600)}h {int(s % 3600 // 60):02d}m'


def _amount(key, n):
    if key == 'bytes' and n >= 1000:
        return f'{n / 1e6:.1f} MB' if n >= 100_000 else f'{n / 1000:.0f} KB'
    return f'{n:,}'


def _local(t):
    """The entry's time on this computer's clock."""
    try:
        return dt.datetime.strptime(t, '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=dt.timezone.utc).astimezone().strftime('%Y-%m-%d %H:%M:%S')
    except (ValueError, OSError, OverflowError):
        return t


def table(entries):
    """The entries as a table, one line each: when (this computer's clock), computer, pc or hud, the command or HUD
    event, how it ended, the exit code, how long it took, the counts."""
    rows = [('When', 'Computer', 'From', 'What', 'Result', 'Exit', 'Took', 'Counts')]
    for e in entries:
        if e['source'] == 'hud':
            rows.append((_local(e['t']), e['computer'], 'hud', e['ev'], e.get('k', ''), '', _took(e.get('ms')),
                         f'n={e["n"]:,}' if 'n' in e else ''))
        else:
            result = e['outcome'] + (f' ({e["error"]})' if e.get('error') else '')
            counts = '  '.join(f'{k}={_amount(k, v)}' for k, v in e.get('counts', {}).items())
            rows.append((_local(e['t']), e['computer'], 'pc', e['command'], result, str(e['exit']), _took(e.get('ms')), counts))
    widths = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
    right = {5, 6}   # Exit and Took line up on the right
    out = []
    for r in rows:
        out.append('  '.join(c.rjust(w) if i in right else c.ljust(w) for i, (c, w) in enumerate(zip(r, widths))).rstrip())
    return '\n'.join(out)

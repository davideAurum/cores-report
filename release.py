#!/usr/bin/env python3
"""release.py -- publish a new version of cores as a GitHub Release, which `cores update` then installs.

    py release.py patch            1.4.2 -> 1.4.3   (fixes)
    py release.py minor            1.4.2 -> 1.5.0   (new features)
    py release.py major            1.4.2 -> 2.0.0
    py release.py 1.5.0            that version exactly
    py release.py minor --dry-run  build and check the zip in dist\\, change nothing

Run it on main, with everything committed and pushed. It
  1. sets VERSION in cores.py, commits "Release X.Y.Z" and tags vX.Y.Z,
  2. builds dist\\cores-report-X.Y.Z.zip from the tag with `git archive` (release.py and .gitattributes are left out;
     see .gitattributes) plus its .sha256,
  3. unpacks the zip and checks it the way `cores update` will: a cores.py reporting X.Y.Z, every .py compiling,
  4. after asking, pushes main and the tag and creates the release with `gh`, the zip and checksum attached, the
     notes being the commit subjects since the previous release (edit them on GitHub afterwards if you like).
Nothing is pushed until step 4; answering no there leaves the commit and tag local (`git tag -d vX.Y.Z` and
`git reset --hard HEAD~1` undo them).

Needs git and the GitHub CLI (`gh`, logged in). Dev-only: it is not in the release zip.
"""
import argparse
import hashlib
import io
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
VERSION_RE = re.compile(r"^VERSION = '([^']*)'", re.M)


class ReleaseError(Exception):
    pass


def run(*args, capture=True, check=True):
    r = subprocess.run(args, cwd=HERE, capture_output=capture, text=True, encoding='utf-8', errors='replace')
    if check and r.returncode:
        raise ReleaseError(f'`{" ".join(args)}` failed:\n{(r.stderr or r.stdout or "").strip()}')
    return (r.stdout or '').strip()


def parse_version(v):
    m = re.fullmatch(r'v?(\d+)\.(\d+)\.(\d+)', v.strip())
    return tuple(int(x) for x in m.groups()) if m else None


def next_version(cur, bump):
    major, minor, patch = parse_version(cur)
    if bump == 'major':
        return f'{major + 1}.0.0'
    if bump == 'minor':
        return f'{major}.{minor + 1}.0'
    if bump == 'patch':
        return f'{major}.{minor}.{patch + 1}'
    if not parse_version(bump):
        raise ReleaseError(f'give patch, minor, major or a version like 1.2.3 (got "{bump}")')
    return bump.lstrip('v')


def with_version(source, ver):
    if not VERSION_RE.search(source):
        raise ReleaseError("cores.py has no line `VERSION = '...'`")
    return VERSION_RE.sub(f"VERSION = '{ver}'", source, count=1)


def build_zip(ref, ver, out):
    """`git archive` of `ref` as cores-report-<ver>/..., with cores.py's VERSION set to `ver` (already so for a release
    tag; for --dry-run it is what the commit would make it)."""
    prefix = f'cores-report-{ver}/'
    raw = subprocess.run(['git', 'archive', '--format=zip', f'--prefix={prefix}', ref], cwd=HERE, capture_output=True)
    if raw.returncode:
        raise ReleaseError(f'git archive failed: {raw.stderr.decode(errors="replace").strip()}')
    out.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(raw.stdout)) as src, zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info)
            if info.filename == prefix + 'cores.py':
                data = with_version(data.decode('utf-8'), ver).encode('utf-8')
            dst.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED)
    sha = hashlib.sha256(out.read_bytes()).hexdigest()
    out.with_name(out.name + '.sha256').write_text(f'{sha}  {out.name}\n', encoding='ascii')
    return sha


def check_zip(path, ver):
    """What `cores update` relies on: one top folder, a cores.py that says it is `ver`, every .py compiling."""
    tmp = Path(tempfile.mkdtemp(prefix='cores-release-check-'))
    try:
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            z.extractall(tmp)
        tops = {n.split('/', 1)[0] for n in names}
        if tops != {f'cores-report-{ver}'}:
            raise ReleaseError(f'the zip should hold one folder cores-report-{ver}, not {sorted(tops)}')
        root = tmp / f'cores-report-{ver}'
        leaked = [n for n in ('release.py', '.gitattributes') if (root / n).exists()]
        if leaked:
            raise ReleaseError(f'{", ".join(leaked)} should be export-ignore\'d (see .gitattributes) but is in the zip')
        for py in root.rglob('*.py'):
            compile(py.read_bytes(), str(py.relative_to(root)), 'exec')
        got = run(sys.executable, str(root / 'cores.py'), '--version')
        if got != f'cores {ver}':
            raise ReleaseError(f'the zipped cores.py reports "{got}", not "cores {ver}"')
        cmd = (root / 'cores.cmd').read_bytes()
        if b'\r\n' not in cmd or re.search(rb'(?<!\r)\n', cmd):
            raise ReleaseError('cores.cmd in the zip does not have CRLF line endings (see .gitattributes)')
        return len(names)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def notes_since(tag):
    rng = f'{tag}..HEAD' if tag else 'HEAD'
    subjects = run('git', 'log', '--no-merges', '--format=%s', rng).splitlines()
    subjects = [s for s in subjects if not s.startswith('Release ')]
    return '\n'.join(f'- {s}' for s in subjects) or '- Maintenance release'


def main(argv=None):
    ap = argparse.ArgumentParser(prog='release.py', description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('bump', help='patch, minor, major, or a version like 1.2.3')
    ap.add_argument('--dry-run', action='store_true', help='build and check the zip in dist\\ only: no commit, tag, push or release')
    ap.add_argument('--notes', help='release notes (default: commit subjects since the previous release)')
    ap.add_argument('-y', '--yes', action='store_true', help='push and publish without asking')
    a = ap.parse_args(argv)

    cores_py = HERE / 'cores.py'
    source = cores_py.read_text(encoding='utf-8')
    m = VERSION_RE.search(source)
    if not m or not parse_version(m.group(1)):
        raise ReleaseError("cores.py has no line `VERSION = 'X.Y.Z'`")
    cur = m.group(1)
    ver = next_version(cur, a.bump)
    if parse_version(ver) <= parse_version(cur):
        raise ReleaseError(f'{ver} is not newer than the current {cur}')
    tag = f'v{ver}'
    prev = run('git', 'describe', '--tags', '--abbrev=0', '--match', 'v*', check=False) or None

    if not a.dry_run:
        if shutil.which('gh') is None:
            raise ReleaseError('the GitHub CLI `gh` is needed to publish; install it and run `gh auth login`')
        run('gh', 'auth', 'status')
        branch = run('git', 'rev-parse', '--abbrev-ref', 'HEAD')
        if branch != 'main':
            raise ReleaseError(f'releases are made from main; this is {branch}')
        if run('git', 'status', '--porcelain'):
            raise ReleaseError('commit or stash your changes first; a release is built from what is committed')
        run('git', 'fetch', '--tags', 'origin')
        if run('git', 'rev-parse', 'HEAD') != run('git', 'rev-parse', 'origin/main'):
            raise ReleaseError('main and origin/main differ; pull or push first, so the release is what GitHub has')
        if run('git', 'tag', '--list', tag):
            raise ReleaseError(f'tag {tag} already exists')

    notes = a.notes or notes_since(prev)
    print(f'cores {cur} -> {ver}' + (f'   (changes since {prev})' if prev else '   (first release)'))
    print(notes)
    print()

    zip_path = HERE / 'dist' / f'cores-report-{ver}.zip'
    if a.dry_run:
        sha = build_zip('HEAD', ver, zip_path)
        n = check_zip(zip_path, ver)
        print(f'Dry run: {zip_path.relative_to(HERE)} ({n} files, sha256 {sha[:12]}...) checks out. Nothing committed, tagged or pushed.')
        print(f'Try it on a copy of the folder:  cores update --from "{zip_path}"')
        return 0

    cores_py.write_text(with_version(source, ver), encoding='utf-8', newline='')
    run('git', 'commit', '-q', '-m', f'Release {ver}', '--', 'cores.py')
    run('git', 'tag', '-a', tag, '-m', f'cores {ver}')
    sha = build_zip(tag, ver, zip_path)
    n = check_zip(zip_path, ver)
    print(f'Built {zip_path.relative_to(HERE)}: {n} files, sha256 {sha}')

    if not a.yes:
        answer = input(f'Push main and {tag} to origin and publish the release on GitHub? [y/N] ').strip().lower()
        if answer not in ('y', 'yes'):
            print(f'Not published. The commit and tag are local only; undo with  git tag -d {tag}  and  git reset --hard HEAD~1')
            return 1
    run('git', 'push', '-q', 'origin', 'main', tag, capture=False)
    url = run('gh', 'release', 'create', tag, str(zip_path), str(zip_path) + '.sha256',
              '--title', f'cores {ver}', '--notes', notes, '--verify-tag')
    print(f'Published {url}')
    print('Every copy of the folder picks it up with `cores update` (and `cores generate` mentions it within a day).')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except ReleaseError as ex:
        print(f'release.py: {ex}', file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(130)

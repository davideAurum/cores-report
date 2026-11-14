"""Tests that the development-only files stay out of a release zip: tests\\, test\\ (the fake CORES page and the HUD
self-test), docs\\, release.py and .gitattributes. release.py builds the zip with `git archive`, which leaves out what
.gitattributes marks export-ignore; these tests ask git itself, with the .gitattributes of this folder.

    python -m unittest discover -s tests -v
"""
import io
import shutil
import subprocess
import sys
import unittest
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import release  # noqa: E402


def git(*args):
    return subprocess.run(['git', *args], cwd=HERE, capture_output=True)


IN_GIT = bool(shutil.which('git')) and git('rev-parse', '--is-inside-work-tree').stdout.strip() == b'true'


class DevOnlyNames(unittest.TestCase):
    def test_dev_only_picks_the_files_and_everything_in_the_folders(self):
        names = ['cores-report-9.9.9/cores.py', 'cores-report-9.9.9/tests/test_x.py', 'cores-report-9.9.9/test/fake.html',
                 'cores-report-9.9.9/docs/code-review.md', 'cores-report-9.9.9/release.py', 'cores-report-9.9.9/.gitattributes',
                 'cores-report-9.9.9/testing.py', 'cores-report-9.9.9/reports/.gitkeep', 'cores-report-9.9.9/README.md']
        self.assertEqual(release.dev_only(names, 'cores-report-9.9.9/'),
                         ['tests/test_x.py', 'test/fake.html', 'docs/code-review.md', 'release.py', '.gitattributes'])
        self.assertEqual(release.dev_only(['cores.py', 'cores_log.py']), [])


@unittest.skipUnless(IN_GIT, 'needs git and a git checkout (a folder installed from a release zip has neither tests nor this check)')
class ReleaseZip(unittest.TestCase):
    def archive(self):
        """The file names `git archive` puts in a zip of HEAD, going by the .gitattributes in this folder as it is now."""
        r = git('archive', '--format=zip', '--worktree-attributes', '--prefix=cores-report-9.9.9/', 'HEAD')
        self.assertEqual(r.returncode, 0, r.stderr.decode(errors='replace'))
        with zipfile.ZipFile(io.BytesIO(r.stdout)) as z:
            return z.namelist()

    def test_git_archive_leaves_the_dev_only_files_out(self):
        tracked = git('ls-files').stdout.decode().splitlines()
        self.assertTrue(release.dev_only(tracked), 'nothing development-only is tracked, so this test would prove nothing')
        names = self.archive()
        self.assertEqual(release.dev_only(names, 'cores-report-9.9.9/'), [])
        files = {n[len('cores-report-9.9.9/'):] for n in names}
        for kept in ('cores.py', 'cores.cmd', 'cores_log.py', 'capture_report.js', 'README.md', 'CORES_PAGE_NOTES.md', 'reports/.gitkeep'):
            self.assertIn(kept, files)
        self.assertFalse([n for n in files if n.startswith(('tests', 'test/', 'docs'))])

    def test_every_tracked_file_is_either_shipped_or_dev_only(self):
        """Nothing else falls out of the zip by accident (an export-ignore pattern that matches too much)."""
        tracked = set(git('ls-files').stdout.decode().splitlines())
        shipped = {n[len('cores-report-9.9.9/'):] for n in self.archive() if not n.endswith('/')}
        self.assertEqual(shipped, tracked - set(release.dev_only(tracked)))


if __name__ == '__main__':
    unittest.main()

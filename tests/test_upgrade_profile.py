"""Fail-closed checks for the real-profile harness; no browser/account needed."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/test_upgrade_profile.mjs'


class UpgradeHarnessGuards(unittest.TestCase):
    def run_harness(self, *args):
        return subprocess.run(['node', str(SCRIPT), *map(str, args)], cwd=ROOT,
                              text=True, capture_output=True, timeout=20)

    def test_missing_package_identity_cannot_return_success(self):
        result = self.run_harness()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Usage:', result.stderr)

    def test_original_profile_directory_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            marker = root / 'baseline.json'
            marker.write_text('immutable original')
            result = self.run_harness('--old-zip', 'missing-old.zip', '--candidate-zip',
                                      'missing-new.zip', '--output-dir', root)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(marker.read_text(), 'immutable original')
            self.assertEqual(list(root.iterdir()), [marker])

    def test_unverified_old_package_fails_with_diagnostic_without_creating_profile(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old = root / 'fake-v1.7.0.zip'
            old.write_bytes(b'Unverified release bytes')
            output = root / 'new-run'
            result = self.run_harness('--old-zip', old, '--candidate-zip', old, '--output-dir', output)
            self.assertNotEqual(result.returncode, 0)
            report = json.loads((output / 'report.json').read_text())
            self.assertEqual(report['status'], 'failed')
            self.assertEqual(report['stages'][0]['status'], 'failed')
            self.assertIn('verified official v1.7.0', report['error'])
            self.assertFalse((output / 'profile').exists())


if __name__ == '__main__':
    unittest.main()

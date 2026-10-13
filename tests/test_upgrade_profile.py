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


    def test_persisted_baseline_and_na_contract_reject_loss_without_seeding_profile(self):
        code = """
import assert from 'node:assert/strict';
import {bodyFacts,byteFacts,assertPersistedBaseline,upgradeOutcome} from './scripts/upgrade_baseline.mjs';
const empty={local:{gemini_conversations:[{id:'a',title:'Metadata only',messageCount:2}]},databases:{}};
assert.equal(bodyFacts(empty).length,0);
assert.equal(upgradeOutcome([{status:'passed'},{status:'not_applicable'}]),'passed_with_na');
assert.equal(upgradeOutcome([{status:'failed'},{status:'not_applicable'}]),'failed');
assert.equal(upgradeOutcome([{status:'running'}]),'failed');
const before={local:{gemini_conversations:[{id:'a',messages:[{role:'user',content:'Persisted body'}]}]},databases:{bytes:{binarySnapshot:true,sha256:'a'.repeat(64),byteLength:3}}};
assert.equal(bodyFacts(before)[0].texts[0],'Persisted body');
assert.equal(byteFacts(before).length,1);
assert.equal(byteFacts({metadata:{sha256:'a'.repeat(64),byteLength:3}}).length,0); // Declared metadata is not physical bytes.
assertPersistedBaseline(before,{local:empty.local,databases:{backup:before}});
assert.throws(()=>assertPersistedBaseline(before,empty),/body lost/);
const corrupt=structuredClone(before);corrupt.databases.bytes.sha256='b'.repeat(64);
assert.throws(()=>assertPersistedBaseline(before,corrupt),/bytes lost/);
const shared=structuredClone(before);shared.local.gemini_conversations_u1=[{id:'a'}];
assert.throws(()=>bodyFacts(shared),/ambiguous account/);
assert.equal(bodyFacts(empty).length,0); // An export ZIP cannot fabricate disk evidence.
"""
        result = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT,
                                text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()

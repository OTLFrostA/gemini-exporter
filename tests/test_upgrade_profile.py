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
await assertPersistedBaseline(before,structuredClone(before));
await assert.rejects(()=>assertPersistedBaseline(before,{local:empty.local,databases:{backup:before}}),/body lost/);
await assert.rejects(()=>assertPersistedBaseline(before,empty),/body lost/);
const corrupt=structuredClone(before);corrupt.databases.bytes.sha256='b'.repeat(64);
await assert.rejects(()=>assertPersistedBaseline(before,corrupt),/bytes lost/);
const shared=structuredClone(before);shared.local.gemini_conversations=[{id:'a'}];shared.local.gemini_conversations_u1=[{id:'a'}];shared.databases.gemini_exporter_details_idb={stores:{conversation_details:[before.local.gemini_conversations[0]]}};
assert.throws(()=>bodyFacts(shared),/ambiguous account/);
assert.equal(bodyFacts(empty).length,0); // An export ZIP cannot fabricate disk evidence.
const wrongAccount=structuredClone(before);wrongAccount.local={gemini_conversations:[{id:'a'}],gemini_conversations_u1:before.local.gemini_conversations};
await assert.rejects(()=>assertPersistedBaseline(before,wrongAccount),/body lost/);
const wrongConversation=structuredClone(before);wrongConversation.local.gemini_conversations[0].id='other';
await assert.rejects(()=>assertPersistedBaseline(before,wrongConversation),/body lost/);
const detail={local:empty.local,databases:{...before.databases,gemini_exporter_details_idb:{stores:{conversation_details:[{...before.local.gemini_conversations[0],id:'c_a'}]}}}};
await assertPersistedBaseline(before,detail);
const sameIdTwoAccounts=structuredClone(before);sameIdTwoAccounts.local.gemini_conversations_u1=[{id:'a',messages:[{role:'user',content:'Other account body'}]}];
assert.equal(bodyFacts(sameIdTwoAccounts).length,2); // Inline bodies carry their own account identity.
// Actual migration contract, loaded independently to construct the valid disk fixture.
const {build}=await import('esbuild');
const bundle=await build({stdin:{contents:"export {parseLegacyStorageConversation} from './src/core/parsers/legacyStorage/parseConversation.ts'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
const {parseLegacyStorageConversation}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const conversation=parseLegacyStorageConversation({metadata:before.local.gemini_conversations[0]},{providerId:'gemini'}).conversation;
const record={key:JSON.stringify(['gemini','u0','a']),storageVersion:2,domainVersion:2,origin:'legacy-storage',revision:'test-revision',savedAt:1234,acquisitionHints:{},resources:[],identity:{providerId:'gemini',accountSlot:'u0',conversationId:'a'},conversation};
const migrated={local:empty.local,databases:{...before.databases,gemini_exporter_domain:{stores:{conversations:[record]}}}};
await assertPersistedBaseline(before,migrated);
const padded=structuredClone(before);padded.local.gemini_conversations[0].id=' c_a '.trim();
await assertPersistedBaseline(padded,migrated); // Same production c_ normalization.
const spaced=structuredClone(before);spaced.local.gemini_conversations[0].id=' a ';
await assertPersistedBaseline(spaced,migrated); // Production normalizes surrounding whitespace.
for(const change of [
 r=>{r.identity.accountSlot='u1';r.key=JSON.stringify(['gemini','u1','a']);},
 r=>{r.identity.conversationId='other';r.key=JSON.stringify(['gemini','u0','other']);r.conversation.index.id='other';},
 r=>{r.identity.accountSlot='u1';}, // Correct-looking key cannot mask mismatched identity.
 r=>{r.conversation.index.id='other';},
 r=>{r.conversation.detail.messages=[];},
]){
 const lost=structuredClone(migrated);change(lost.databases.gemini_exporter_domain.stores.conversations[0]);
 lost.databases.backup=before; // Arbitrary backup must never satisfy the bound assertion.
 await assert.rejects(()=>assertPersistedBaseline(before,lost));
}
const missingStore=structuredClone(migrated);missingStore.databases.gemini_exporter_domain.stores={legacy_imports:[record]};
await assert.rejects(()=>assertPersistedBaseline(before,missingStore),/body lost/);
const backupOnly=structuredClone(migrated);backupOnly.databases.gemini_exporter_domain.stores={conversations:[],legacy_imports:[record]};
await assert.rejects(()=>assertPersistedBaseline(before,backupOnly),/body lost/);

"""
        result = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT,
                                text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_offline_failures_require_exact_ids_and_expected_reasons(self):
        code = """
import assert from 'node:assert/strict';
import {NativeExportFailure,assertOfflineFailures,assertExpectedOfflineFailure} from './scripts/upgrade_failures.mjs';
const ids=['a','b'];
const valid=ids.map(id=>({id,error:'fetch failed: Failed to fetch'}));
assertOfflineFailures(JSON.parse(JSON.stringify(valid)),ids); // ZIP report evidence.
assertExpectedOfflineFailure(new NativeExportFailure(valid),ids); // Bound UI evidence.
for(const failed of [
 [{id:'other',error:valid[0].error},{id:'elsewhere',error:valid[0].error}],
 [valid[0]], [valid[0],valid[0]], [...valid,{id:'other',error:valid[0].error}],
 ...['Timeout 120000ms exceeded','ZIP generation failed','Invalid Domain schema','Harness error','offline schema missing','Detail fetch failed','Failed to fetch: schema invalid',undefined].map(error=>[{...valid[0],error},valid[1]]),
 undefined,
]){
 assert.throws(()=>assertOfflineFailures(failed,ids));
 assert.throws(()=>assertExpectedOfflineFailure(new NativeExportFailure(failed),ids));
}
for(const error of [new Error('Native export failure: fake prefix'),new Error('Timeout'),new Error('ZIP generation failed')])
 assert.throws(()=>assertExpectedOfflineFailure(error,ids), e=>e===error);
"""
        result = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT,
                                text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()

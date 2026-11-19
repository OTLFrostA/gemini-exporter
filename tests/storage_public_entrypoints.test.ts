import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import vm from 'node:vm';
import * as batch from '../src/l3a/batchStorageService.js';
import * as conversations from '../src/l3a/conversationStore.js';
import * as exports from '../src/l3a/exportRecordStore.js';

function exportKeys(entryPoint: string): string[] {
    const code = buildSync({ entryPoints: [entryPoint], bundle: true, write: false, format: 'cjs' }).outputFiles[0].text;
    const context = { module: { exports: {} } };
    vm.runInNewContext(code, context);
    return Object.keys(context.module.exports).sort();
}

test('batch Storage exposes exactly the three agreed passive IO functions', () => {
    assert.deepEqual(exportKeys('src/l3a/batchStorageService.ts'), [
        'getConversationSnapshot', 'updateConversationsAtomically', 'putExportRecords',
    ].sort());
    assert.equal(batch.getConversationSnapshot, conversations.getConversationSnapshot);
    assert.equal(batch.updateConversationsAtomically, conversations.updateConversationsAtomically);
    assert.equal(batch.putExportRecords, exports.putExportRecords);
});

test('vault Storage exposes exactly the agreed passive IO functions', () => {
    assert.deepEqual(exportKeys('src/l3a/vaultStorageService.ts'), [
        'clearCloudSyncSession', 'clearSyncedCloudRecordsForOwner', 'countCloudOutbox',
        'countOversizedCloudRecords', 'enqueueCloudOutboxKeys', 'getCloudSyncSession',
        'getStoredLocalVaultHandle', 'getSyncedCloudRecord', 'getSyncedCloudRecordByBlindId',
        'listDueCloudOutbox', 'putCloudSyncSession', 'putLocalVaultConnection',
        'putSyncedCloudRecord', 'recordCloudOutboxFailure', 'removeCloudOutboxEntry',
        'setStoredLocalVaultHandle', 'activateVaultKeyring', 'getInitializedVaultKeyring',
    ].sort());
});

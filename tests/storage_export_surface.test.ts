import test from 'node:test';
import assert from 'node:assert/strict';
import * as storage from '../src/l3a/storageService.js';
import { indexStorage, useIndexStorage } from './helpers/indexStorage.js';
import { fixtureKey } from './helpers/domainFixture.js';

import { buildSync } from 'esbuild';
import vm from 'node:vm';
test('Storage exposes exactly the frozen 22 passive IO functions', () => {
    const code = buildSync({ entryPoints: ['src/l3a/storageService.ts'], bundle: true, write: false, format: 'cjs' }).outputFiles[0].text;
    const context = { module: { exports: {} } }; vm.runInNewContext(code, context);
    assert.deepEqual(Object.keys(context.module.exports).sort(), [
        'getAccount', 'listAccounts', 'insertAccountIfAbsent', 'putAccount',
        'getIndex', 'listIndexes', 'putIndexes', 'updateIndexesAtomically',
        'getDetail', 'updateConversationAtomically', 'deleteStoredConversation',
        'getCoverage', 'updateCoverageAtomically', 'getExportRecord', 'listExportRecords',
        'putExportRecord', 'clearStoredAccountExportRecords', 'getStoredSettings',
        'patchStoredSettings', 'getDirectoryHandle', 'setDirectoryHandle', 'clearStoredAccountScanRecords',
    ].sort());
});
useIndexStorage();
test('ExportRecord writes do not finalize or mutate Index/Detail', async () => {
    const key = fixtureKey('export');
    await storage.putIndexes([{ key, title: 'Authoritative', titleSource: 'provider', updatedAt: 1 }]);
    const before = await storage.getIndex(key);
    await storage.putExportRecord(key, { exportedAt: 2, format: 'html', status: 'partial' });
    assert.deepEqual(await storage.getIndex(key), before);
    assert.equal(await storage.getDetail(key), null);
    assert.deepEqual(await storage.getExportRecord(key), { exportedAt: 2, format: 'html', status: 'partial' });
});

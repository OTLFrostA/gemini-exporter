import { seed, request, reset, key } from './helpers/applicationHarness.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Directory from '../src/ui/controllers/dirHandleController.js';
import type { DirectoryHandle } from '../src/core/engine/writers/directoryHandle.js';
import { startSync } from '../src/ui/controllers/syncController.js';
import { handleTakeoutImport } from '../src/ui/controllers/takeoutController.js';
import { runExport as uiExport } from '../src/ui/controllers/exportController.js';
import { runExport } from '../src/core/application/export/runExport.js';
import { errorText } from '../src/ui/utils/settings.js';
const id = '10000000-0000-4000-8000-000000000001';
test.beforeEach(reset);

test('dirHandleController - exports and in-memory handle state', () => {
    for (const method of ['getStoredDirHandle', 'saveStoredDirHandle', 'verifyDirPermission', 'restoreSavedDirHandle', 'requestDirHandle'] as const) assert.equal(typeof Directory[method], 'function');
    const handle = { name: 'exports' } as DirectoryHandle;
    Directory.setDirHandle(handle); assert.strictEqual(Directory.getDirHandle(), handle);
    Directory.setDirHandle(null); assert.equal(Directory.getDirHandle(), null);
});
test('exportController - delegates to the unique Application workflow without another engine state machine', () => {
    assert.strictEqual(uiExport, runExport);
});
test('ExportController progress uses the Application current/total/key contract unchanged', async () => {
    seed(); seed('second'); const seen: unknown[] = [];
    const result = await uiExport(request({ keys: [key(), key('second')] }), { onProgress: progress => seen.push(progress) });
    assert.equal(result.exported, 2);
    assert.deepEqual(seen, [{ current: 1, total: 2, key: key() }, { current: 2, total: 2, key: key('second') }]);
});
test('syncController - running cancellation belongs to this invocation AbortSignal', async () => {
    const controller = new AbortController(); let called = false;
    const operation = startSync(id, { signal: controller.signal, onTarget: async () => controller.abort() }, {
        resolveScanTarget: async () => id, scanAll: async () => { called = true; throw Error('unexpected'); }
    });
    await assert.rejects(operation, { name: 'AbortError' }); assert.equal(called, false);
});
test('syncController - connection failures retain the actionable original error', () => {
    const error = new Error('Could not establish connection. Receiving end does not exist.');
    assert.equal(errorText(error), error.message); assert.equal(errorText('HTTP 503 Service Unavailable'), 'HTTP 503 Service Unavailable');
});
test('syncController - failed source resolution rejects and never dispatches a scan', async () => {
    const failure = new Error('Receiving end does not exist'); let scans = 0, targets = 0;
    await assert.rejects(startSync(id, { signal: new AbortController().signal, onTarget: async () => { targets++; } }, {
        resolveScanTarget: async () => { throw failure; }, scanAll: async () => { scans++; throw Error('unexpected'); }
    }), error => error === failure);
    assert.equal(scans, 0); assert.equal(targets, 0);
});
test('takeoutController - typed File input reaches the current importer with its target and progress', async () => {
    const file = new File(['fixture'], 'takeout.zip'), seen: unknown[] = [];
    const account = { id, providerId: 'gemini', providerAccountId: 'fixture' };
    const result = await handleTakeoutImport(file, id, { onTarget: async target => { seen.push(target); }, onProgress: p => seen.push(p) }, {
        listAccounts: async () => [account], getAccount: async () => account, getOrCreateAccount: async () => { throw Error('unexpected'); },
        updateSettings: async patch => { seen.push(patch); }, importTakeout: async (actual, target, progress) => {
            assert.strictEqual(actual, file); assert.equal(target, id); progress?.(100); return { imported: 1, status: 'ok' as const };
        }
    });
    assert.deepEqual(seen, [id, { takeoutPromptCompleted: true }, 100]); assert.equal(result.imported, 1);
});

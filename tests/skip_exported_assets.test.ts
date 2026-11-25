import test from 'node:test';
import assert from 'node:assert/strict';
import { runExport } from '../src/application/export/runExport.js';
import { shouldSkipExport } from '../src/application/export/exportPipeline.js';
import { getExportRecord } from '../src/l3a/storageService.js';
import { liveKey, seedLiveDetail, v2LiveSaveHost } from './helpers/v2LiveSaveHost.js';

const request = (id: string, includeAssets: boolean) => ({ keys: [liveKey(id)], format: 'markdown' as const,
    delivery: 'folderWriter' as const, includeAssets, skipUnchanged: true });

test('Skip exported upgrades a text-only export to include assets, then skips the covered request', async t => {
    const host = v2LiveSaveHost(t), id = 'asset-upgrade', url = 'https://lh3.googleusercontent.com/image.png';
    const bytes = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
    await seedLiveDetail(id, [{ id: 'image', kind: 'image', name: 'image.png', sourceUri: url, mediaType: 'image/png' }]);
    host.source(url, bytes);
    assert.equal((await runExport(request(id, false))).exported, 1);
    assert.deepEqual(host.requests, []);
    const upgraded = await runExport(request(id, true));
    assert.equal(upgraded.skipped, 0);
    assert.equal(upgraded.exported, 1);
    assert.deepEqual(host.requests, [url]);
    assert.ok([...host.files.entries()].some(([name, value]) => name.endsWith('.png') && value instanceof Uint8Array));
    assert.equal((await runExport(request(id, true))).skipped, 1);
    assert.equal((await runExport(request(id, false))).skipped, 1);
    assert.equal((await getExportRecord(liveKey(id)))?.status, 'ok');
});

test('Skip exported does not assume legacy or missing records cover requested assets', () => {
    const record = { format: 'markdown' as const, status: 'ok' as const, exportedAt: 200, chatTime: 100 };
    assert.equal(shouldSkipExport(null, 100, request('empty', true)), false);
    assert.equal(shouldSkipExport(record, 100, request('legacy', false)), true);
    assert.equal(shouldSkipExport(record, 100, request('legacy', true)), false);
});

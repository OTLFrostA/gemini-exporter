import test from 'node:test';
import assert from 'node:assert/strict';
import { v2LiveSaveHost, seedLiveDetail, liveKey } from './helpers/v2LiveSaveHost.js';
import { runLiveSave } from '../src/runtime/background/liveSaveHandler.js';
import { getExportRecord } from '../src/l3a/storageService.js';
import { prepareExportResources } from '../src/application/export/prepareExportResources.js';
import { acquireSourceResource } from '../src/l1/resources/sourceResources.js';

test('search image export acquires bytes from the extension context and writes the actual image', async t => {
    const host = v2LiveSaveHost(t), key = liveKey('search');
    const url = 'https://encrypted-tbn2.gstatic.com/licensed-image?q=test';
    const bytes = Uint8Array.of(1, 2, 3);
    await seedLiveDetail(key.conversationId, [{ id: 'search-image', kind: 'image', name: 'search.png', sourceUri: url }]);
    host.source(url, bytes);
    assert.equal((await runLiveSave(key))?.exported, 1);
    assert.deepEqual(host.requests, [url]);
    const asset = [...host.files.entries()].find(([name]) => name.startsWith('assets/') && name.endsWith('search.png'));
    assert.ok(asset); assert.deepEqual(asset[1], bytes);
    assert.ok([...host.files.values()].some(value => typeof value === 'string' && value.includes(asset[0])));
    assert.equal((await getExportRecord(key))?.status, 'ok');
});
test('missing search images preserve the HTTP error and never create a fake successful asset', async t => {
    const host = v2LiveSaveHost(t), key = liveKey('missing-search');
    const url = 'https://encrypted-tbn2.gstatic.com/licensed-image?q=missing';
    await seedLiveDetail(key.conversationId, [{ id: 'missing', kind: 'image', sourceUri: url }]);
    t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }));
    const results = await prepareExportResources([{ id: 'missing', kind: 'image', sourceUri: url }], new Set(['missing']),
        (asset, signal) => acquireSourceResource(asset, signal, undefined, 'gemini'));
    const failure = results.get('missing');
    assert.ok(failure && !failure.ok);
    assert.match(failure.reason, /404/);
    const result = await runLiveSave(key);
    assert.equal(result?.partial, 1);
    assert.equal([...host.files.keys()].some(name => name.startsWith('assets/')), false);
    assert.equal((await getExportRecord(key))?.status, 'partial');
});

test('Live Save keeps external image links as placeholders without requesting their bytes', async t => {
    const host = v2LiveSaveHost(t), key = liveKey('external-image');
    const sourceUri = 'https://example.test/image.png';
    await seedLiveDetail(key.conversationId, [{ id: 'external', kind: 'image', sourceUri }]);
    host.source(sourceUri, Uint8Array.of(1, 2, 3));
    assert.equal((await runLiveSave(key))?.partial, 1);
    assert.deepEqual(host.requests, []);
    assert.equal([...host.files.keys()].some(name => name.startsWith('assets/')), false);
    assert.ok([...host.files.values()].some(value => typeof value === 'string'
        && value.includes('[Open source](https://example.test/image.png)')));
});

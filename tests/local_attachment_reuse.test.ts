import test from 'node:test';
import assert from 'node:assert/strict';
import { v2LiveSaveHost, seedLiveDetail, liveKey } from './helpers/v2LiveSaveHost.js';
import { runExport } from '../src/application/export/runExport.js';
import { getExportRecord, putExportRecord } from '../src/l3a/storageService.js';
import type { DomainAsset } from '../src/l2/conversationDetail.js';

for (const format of ['markdown', 'html', 'json'] as const) {
    test(`${format}: repeated folder export reuses same-name bytes and redownloads only deleted attachments`, async t => {
        const host = v2LiveSaveHost(t);
        const key = liveKey('reuse-chat');
        const assets: DomainAsset[] = [
            { id: 'image', kind: 'image', name: 'photo.png', mediaType: 'image/png', sourceUri: 'https://example.test/photo.png' },
            { id: 'file', kind: 'file', name: 'notes.txt', mediaType: 'text/plain', sourceUri: 'https://example.test/notes.txt' },
        ];
        await seedLiveDetail(key.conversationId, assets);
        host.source('https://example.test/photo.png', Uint8Array.of(1, 2, 3));
        host.source('https://example.test/notes.txt', Uint8Array.of(4, 5), 'text/plain');
        const request = { keys: [key], format, delivery: 'folderWriter' as const, includeAssets: true, skipUnchanged: false };
        assert.equal((await runExport(request)).partial, 0);
        assert.equal(host.requests.length, 2);
        const image = `assets/gemini/${key.accountId}/${key.conversationId}/photo.png`;
        const file = `files/gemini/${key.accountId}/${key.conversationId}/notes.txt`;
        assert.deepEqual(host.files.get(image), Uint8Array.of(1, 2, 3));
        assert.deepEqual(host.files.get(file), Uint8Array.of(4, 5));
        // Local edits are deliberately retained by the filename-only policy.
        host.files.set(image, Uint8Array.of(9));
        host.source('https://example.test/photo.png', null);
        host.requests.length = 0; host.events.length = 0;
        await seedLiveDetail(key.conversationId, assets, { savedAt: 1700000001000, title: 'Updated title' });
        const progress: number[] = [];
        const repeated = await runExport(request, { onResourceProgress: value => progress.push(value.downloaded) });
        assert.equal(repeated.exported, 1); assert.equal(repeated.partial, 0);
        assert.deepEqual(host.requests, []);
        assert.deepEqual(host.files.get(image), Uint8Array.of(9));
        assert.ok(host.events.every(event => !event.endsWith(image) && !event.endsWith(file)));
        assert.ok(progress.every(downloaded => downloaded === 0));
        const body = [...host.files.values()].find((value): value is string => typeof value === 'string');
        assert.ok(body);
        assert.ok(body.includes(image));
        assert.ok(body.includes(file));
        assert.match(body, /Updated title/);
        assert.equal((await getExportRecord(key))?.status, 'ok');
        host.files.delete(file);
        const restored = await runExport(request);
        assert.equal(restored.exported, 1); assert.equal(restored.partial, 0);
        assert.deepEqual(host.requests, ['https://example.test/notes.txt']);
        assert.deepEqual(host.files.get(file), Uint8Array.of(4, 5));

        // A 0-byte crash stub left by an interrupted write must NOT be treated as reusable.
        host.requests.length = 0;
        host.files.set(file, new Uint8Array(0));
        const recovered = await runExport(request);
        assert.equal(recovered.exported, 1); assert.equal(recovered.partial, 0);
        assert.deepEqual(host.requests, ['https://example.test/notes.txt']);
        assert.deepEqual(host.files.get(file), Uint8Array.of(4, 5));
    });
}

test('putExportRecord atomically preserves an existing folderBaseName when a concurrent browserDownload export omits it', async t => {
    v2LiveSaveHost(t);
    const key = liveKey('concurrent-record');
    await putExportRecord(key, {
        format: 'markdown',
        status: 'ok',
        exportedAt: 100,
        chatTime: 100,
        folderBaseName: 'Original Title_abc123',
    });
    await putExportRecord(key, {
        format: 'pdf',
        status: 'ok',
        exportedAt: 200,
        chatTime: 100,
    });
    const merged = await getExportRecord(key);
    assert.equal(merged?.format, 'pdf');
    assert.equal(merged?.folderBaseName, 'Original Title_abc123');
});

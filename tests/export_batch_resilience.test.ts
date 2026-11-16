import test from 'node:test';
import assert from 'node:assert/strict';
import { runExport } from '../src/application/export/runExport.js';
import { getExportRecord } from '../src/l3a/storageService.js';
import { v2ExportHost, exportKey, exportRequest, seedExportConversation, seedExportIndexOnly } from './helpers/v2ExportHost.js';
import { __setZipConstructor, __getZipConstructor } from '../src/l4/packaging/writers/zipWriter.js';

const JSZip = require('../lib/jszip.min.js');

test('failed L1 acquisition affects only its key while sibling conversations export and commit', async t => {
    const host = v2ExportHost(t);
    await seedExportIndexOnly('broken');
    await seedExportConversation('healthy');

    const progress: string[] = [];
    const result = await runExport(exportRequest(['broken', 'healthy']), {
        onProgress: item => progress.push(item.key.conversationId),
    });

    assert.deepEqual(progress, ['broken', 'healthy']);
    assert.equal(result.aborted, false);
    assert.equal(result.exported, 1);
    assert.equal(result.partial, 0);
    assert.deepEqual(result.failed, [exportKey('broken')]);
    assert.equal(result.skipped, 0);
    assert.equal(host.clicks(), 1);
    assert.match(host.filenames[0], /\.md$/);
    assert.equal(host.blobs.length, 1);
    assert.match(await host.blobs[0].text(), /Answer for healthy/);
    assert.doesNotMatch(await host.blobs[0].text(), /Unavailable broken/);

    assert.equal(await getExportRecord(exportKey('broken')), null);
    const healthy = await getExportRecord(exportKey('healthy'));
    assert.ok(healthy);
    assert.equal(healthy.format, 'markdown');
    assert.equal(healthy.status, 'ok');
    assert.equal(healthy.chatTime, 100);
});

test('multi-conversation batch export reports ordered progress and delivers one ZIP with committed records', async t => {
    const host = v2ExportHost(t);
    const previousZip = __getZipConstructor();
    __setZipConstructor(JSZip);
    t.after(() => __setZipConstructor(previousZip));
    const ids = ['progress-a', 'progress-b', 'progress-c', 'progress-d'];
    for (const id of ids) await seedExportConversation(id);
    const updates: Array<{ current: number; total: number; id: string }> = [];
    const result = await runExport(exportRequest(ids), {
        onProgress: ({ current, total, key }) => {
            updates.push({ current, total, id: key.conversationId });
        },
    });

    assert.equal(result.exported, 4);
    assert.deepEqual(result.failed, []);
    assert.equal(host.clicks(), 1, 'one ZIP is delivered for the full batch');
    assert.deepEqual(updates, ids.map((id, i) => ({ current: i + 1, total: ids.length, id })));
    const zip = await JSZip.loadAsync(await host.blobs[0].arrayBuffer());
    const bodies = await Promise.all(
        Object.values(zip.files)
            .filter((entry: any) => !entry.dir && entry.name.endsWith('.md'))
            .map((entry: any) => entry.async('string')),
    );
    assert.equal(bodies.length, ids.length);
    for (const id of ids) {
        assert.ok(bodies.some((body: string) => body.includes('Answer for ' + id)));
        assert.equal((await getExportRecord(exportKey(id)))?.status, 'ok');
    }
});

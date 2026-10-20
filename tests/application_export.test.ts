import { account, key, address, seed, request, reset, records, events, deliveries, state, provider, indexes, details, contexts } from './helpers/applicationHarness.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runExport, shouldSkipExport } from '../src/core/application/export/runExport.js';
import { prepareExportResources } from '../src/core/application/export/prepareExportResources.js';
import type { ExportRecord } from '../src/core/application/export/types.js';

test.beforeEach(reset);
const previous: ExportRecord = { format: 'markdown', exportedAt: 999, chatTime: 100, status: 'ok' };
test('Skip requires same format, ok record and comparable source versions; delivery options do not matter', () => {
    assert.equal(shouldSkipExport(previous, 100, request({ skipUnchanged: true })), true);
    for (const record of [{ ...previous, format: 'pdf' as const }, { ...previous, status: 'partial' as const }, { ...previous, chatTime: undefined }, { ...previous, chatTime: 99 }]) {
        assert.equal(shouldSkipExport(record, 100, request({ skipUnchanged: true })), false);
    }
    assert.equal(shouldSkipExport(previous, undefined, request({ skipUnchanged: true })), false);
    assert.equal(shouldSkipExport(previous, 100, request()), false);
    assert.equal(shouldSkipExport(previous, 100, request({ skipUnchanged: true, includeAssets: false, delivery: 'folderWriter', })), true);
});
for (const format of ['markdown', 'html', 'json', 'pdf'] as const) {
    test(`${format} uses local Domain, shared resources, then delivery before the minimal Record`, async () => {
        seed();
        const result = await runExport(request({ format }));
        assert.equal(result.exported, 1); assert.equal(result.partial, 0);
        assert.deepEqual(events, ['delivery', 'record:first']);
        const record = records.get(address(key()))!;
        assert.deepEqual(Object.keys(record).sort(), ['chatTime', 'exportedAt', 'format', 'status']);
        assert.equal(record.chatTime, 100); assert.equal(record.format, format);
        assert.equal(deliveries[0].length, 1);
        if (format !== 'pdf') assert.match(String(deliveries[0][0].content), /Body first/);
        if (format === 'pdf') assert.equal(state.disposed, 1);
    });
    test(`${format} includeAssets=false does not acquire bytes or mark intentional omissions partial`, async () => {
        seed('first', { assets: true });
        const result = await runExport(request({ format, includeAssets: false }));
        assert.equal(result.exported, 1); assert.equal(result.partial, 0);
        assert.ok(!events.some(event => event.startsWith('acquire:')));
        if (format === 'json') {
            const json = JSON.parse(String(deliveries[0][0].content));
            assert.equal(json.conversation.detail.assets.length, 3); assert.deepEqual(json.resources, {});
        }
    });
    test(`${format} chooses only the format's required resource IDs`, async () => {
        seed('first', { assets: true });
        const result = await runExport(request({ format }));
        assert.equal(result.exported, 1);
        assert.deepEqual(events.filter(event => event.startsWith('acquire:')), format === 'pdf' ? ['acquire:image']
            : format === 'json' ? ['acquire:image', 'acquire:file', 'acquire:unused'] : ['acquire:image', 'acquire:file']);
        if (format === 'pdf') { assert.deepEqual(state.pdfPrepared, ['image']); assert.ok(state.pdfBindings.image); }
        else assert.equal(deliveries[0][0].mimeType, 'application/zip');
    });
}
test('Popup bypasses records; Options and Live Save can Skip', async () => {
    seed(); records.set(address(key()), previous);
    assert.equal((await runExport(request({ skipUnchanged: true }))).skipped, 1);
    assert.equal((await runExport(request())).exported, 1);
    assert.equal(events.filter(event => event === 'delivery').length, 1);
});
test('unknown source version refreshes, exports without inventing chatTime and never skips', async () => {
    const { detail } = seed(); delete detail.savedAt;
    records.set(address(key()), { ...previous, chatTime: undefined });
    const result = await runExport(request({ skipUnchanged: true }));
    assert.equal(result.exported, 1); assert.equal(result.skipped, 0);
    assert.deepEqual(events, ['refresh', 'delivery', 'record:first']);
    assert.equal(records.get(address(key()))?.chatTime, undefined);
});
test('stale refresh failure exports old Detail as partial with its actual version', async () => {
    seed('first', { savedAt: 90 });
    provider.fetchConversationDetail = async () => { events.push('refresh'); throw new Error('offline'); };
    const result = await runExport(request());
    assert.equal(result.partial, 1); assert.equal(records.get(address(key()))?.chatTime, 90);
});
test('unknown Detail quality exports as partial and cannot satisfy Skip after refresh failure', async () => {
    seed('first', { quality: 'unknown' });
    provider.fetchConversationDetail = async () => { events.push('refresh'); throw new Error('offline'); };
    const first = await runExport(request({ skipUnchanged: true }));
    assert.equal(first.exported, 1);
    assert.equal(first.partial, 1);
    assert.equal(records.get(address(key()))?.status, 'partial');
    const second = await runExport(request({ skipUnchanged: true }));
    assert.equal(second.skipped, 0);
    assert.equal(second.partial, 1);
    assert.equal(events.filter(event => event === 'refresh').length, 2);
    assert.equal(events.filter(event => event === 'delivery').length, 2);
});
for (const format of ['markdown', 'html', 'json', 'pdf'] as const) {
    test(`${format} exports a valid Detail with zero messages`, async () => {
        const { detail } = seed();
        detail.messages.splice(0);
        const result = await runExport(request({ format }));
        assert.equal(result.exported, 1);
        assert.deepEqual(result.failed, []);
        if (format === 'json') {
            const json = JSON.parse(String(deliveries[0][0].content));
            assert.deepEqual(json.conversation.detail.messages, []);
        }
    });
}
test('batch planning consistently reserves colliding file names for separate conversations', async () => {
    const first = seed('alpha_sameid'), second = seed('beta_sameid');
    first.index.title = 'Collision';
    second.index.title = 'Collision';
    const result = await runExport(request({
        keys: [key('alpha_sameid'), key('beta_sameid')], format: 'markdown', delivery: 'folderWriter',
    }));
    assert.equal(result.exported, 2);
    assert.deepEqual(deliveries.map(group => group[0].fileName), ['Collision_sameid.md', 'Collision_sameid_2.md']);
});
test('refresh is void; Export rereads L2 instead of using a Provider response', async () => {
    seed('first', { savedAt: 90 });
    provider.fetchConversationDetail = async (accountId, conversationId) => {
        assert.equal(accountId, account.id); assert.equal(conversationId, 'first');
        const { detail } = seed(); detail.messages[0].content = [{ type: 'paragraph', children: [{ type: 'text', text: 'Committed replacement' }] }];
    };
    const result = await runExport(request());
    assert.equal(result.partial, 0); assert.match(String(deliveries[0][0].content), /Committed replacement/);
});
test('Popup with no local Index still refreshes and rereads Domain', async () => {
    provider.fetchConversationDetail = async () => { seed(); };
    assert.equal((await runExport(request())).exported, 1);
});
test('missing Detail fails only that target and preserves old record', async () => {
    records.set(address(key()), previous); seed('second');
    const result = await runExport(request({ keys: [key(), key('second')] }));
    assert.deepEqual(result.failed, [key()]); assert.equal(result.exported, 1);
    assert.equal(records.get(address(key())), previous);
});
test('resource failure yields readable partial and no dangling binding', async () => {
    seed('first', { assets: true });
    provider.acquireResource = async () => { throw new Error('unavailable'); };
    const result = await runExport(request({ format: 'json' }));
    assert.equal(result.partial, 1);
    assert.deepEqual(JSON.parse(String(deliveries[0][0].content)).resources, {});
});
test('Folder Writer writes each item before acquiring the next and releases prior readers', async () => {
    seed('first', { assets: true, savedAt: 90 });
    seed('second', { assets: true, savedAt: 90 });
    provider.fetchConversationDetail = async (_account, id) => {
        if (id === 'second') {
            assert.equal(deliveries.length, 1, 'first item must be written before second preparation');
            assert.ok(events.includes('record:first'));
            const old = await state.sourceContext!.acquire(key('first'), { id: 'image', kind: 'image' }, undefined,
                async () => ({ bytes: new TextEncoder().encode('released') }));
            assert.equal(new TextDecoder().decode(old.bytes), 'released', 'first item reader must be released');
        }
        state.sourceContext!.retain(key(id), 'image', async () => ({ bytes: new TextEncoder().encode(id) }));
        seed(id, { assets: true });
    };
    provider.acquireResource = async (conversationKey, asset, signal) => state.sourceContext!.acquire(
        conversationKey, asset, signal, async () => ({ bytes: new Uint8Array([9]), mediaType: asset.mediaType }));
    const result = await runExport(request({ keys: [key(), key('second')], delivery: 'folderWriter' }));
    assert.equal(result.exported, 2);
    const images = deliveries.map(group => group.find(file => file.fileName.startsWith('assets/'))!.content as Uint8Array);
    assert.deepEqual(images.map(bytes => new TextDecoder().decode(bytes)), ['first', 'second']);
});
test('resources stay keyed by Conversation as well as asset ID and task context releases', async () => {
    seed('first', { assets: true, savedAt: 90 }); seed('second', { assets: true, savedAt: 90 });
    provider.fetchConversationDetail = async (_account, id) => {
        state.sourceContext!.retain(key(id), 'image', async () => ({ bytes: new TextEncoder().encode(id) }));
        seed(id, { assets: true });
    };
    provider.acquireResource = async (key, asset, signal) => state.sourceContext!.acquire(key, asset, signal,
        async () => ({ bytes: new Uint8Array([1]) }));
    await runExport(request({ keys: [key(), key('second')], delivery: 'folderWriter' }));
    assert.equal(contexts.length, 1);
    const images = deliveries.map(group => group.find(file => file.fileName.startsWith('assets/'))!.content);
    assert.equal(new TextDecoder().decode(images[0] as Uint8Array), 'first');
    assert.equal(new TextDecoder().decode(images[1] as Uint8Array), 'second');
    await assert.rejects(contexts[0].acquire(key(), { id: 'image', kind: 'image' }), /released/);
});
test('resource preparation retains failure results and propagates Abort', async () => {
    const controller = new AbortController();
    const prepared = await prepareExportResources([{ id: 'empty', kind: 'file' }], new Set(['empty', 'missing']),
        async () => ({ bytes: new Uint8Array() }));
    assert.equal(prepared.get('empty')?.ok, false); assert.equal(prepared.get('missing')?.ok, false);
    await assert.rejects(prepareExportResources([{ id: 'a', kind: 'file' }], new Set(['a']), async () => {
        controller.abort(); return { bytes: new Uint8Array([1]) };
    }, controller.signal), { name: 'AbortError' });
});
for (const delivery of ['browserDownload', 'folderWriter'] as const) {
    test(`${delivery} ZIP failure fails only actual participants, never overwrites old records`, async () => {
        seed(); seed('second'); seed('skipped');
        records.set(address(key()), previous); records.set(address(key('skipped')), previous);
        state.failDelivery = 1;
        const result = await runExport(request({ keys: [key(), key('second'), key('skipped')], format: 'markdown', delivery,
            skipUnchanged: true }));
        assert.equal(result.skipped, 2); assert.equal(result.exported, 0);
        assert.deepEqual(result.failed, [key('second')]); assert.equal(records.get(address(key())), previous);
        assert.equal(events.some(event => event.startsWith('record:')), false);
    });
    test(`${delivery} cancellation after delivery finalizes only the delivered group`, async () => {
        seed(); seed('second');
        const controller = new AbortController(); state.onDelivery = () => controller.abort();
        const result = await runExport(request({ keys: [key(), key('second')], delivery, }), { signal: controller.signal });
        assert.equal(result.aborted, true); assert.equal(result.exported, delivery === 'browserDownload' ? 2 : 1); assert.deepEqual(result.failed, []);
    });
}
test('ZIP Record failure counts only committed records without a second delivery', async () => {
    seed(); seed('second'); state.failRecord = 'first';
    const result = await runExport(request({ keys: [key(), key('second')] }));
    assert.equal(result.exported, 1); assert.deepEqual(result.failed, [key()]); assert.equal(deliveries.length, 1);
});
test('Folder groups finalize independently; later failure preserves earlier records', async () => {
    seed(); seed('second'); state.failDelivery = 2;
    const result = await runExport(request({ keys: [key(), key('second')], delivery: 'folderWriter' }));
    assert.equal(result.exported, 1); assert.deepEqual(result.failed, [key('second')]);
    assert.deepEqual(events, ['delivery', 'record:first', 'delivery']);
});
test('Folder cancellation after first group stops later delivery and does not mark untouched keys failed', async () => {
    seed(); seed('second'); const controller = new AbortController(); state.onDelivery = () => controller.abort();
    const result = await runExport(request({ keys: [key(), key('second')], delivery: 'folderWriter' }), { signal: controller.signal });
    assert.equal(result.aborted, true); assert.equal(result.exported, 1); assert.deepEqual(result.failed, []); assert.equal(deliveries.length, 1);
});
test('cancel before final packaging delivers nothing and keeps old record', async () => {
    seed(); records.set(address(key()), previous); const controller = new AbortController();
    const result = await runExport(request(), { signal: controller.signal, onProgress() { controller.abort(); } });
    assert.equal(result.aborted, true); assert.equal(result.exported, 0); assert.deepEqual(result.failed, []);
    assert.equal(deliveries.length, 0); assert.equal(records.get(address(key())), previous);
});
test('missing Folder capability rejects initialization and never falls back to Browser Download', async () => {
    seed(); state.directory = null;
    await assert.rejects(runExport(request({ delivery: 'folderWriter' })), /directory unavailable/);
    assert.equal(deliveries.length, 0);
});
test('progress describes requested targets, not delivery completion; all-skipped does not produce ZIP', async () => {
    seed(); records.set(address(key()), previous);
    const progress: unknown[] = [];
    await runExport(request({ skipUnchanged: true }), { onProgress(value) { progress.push(value); } });
    assert.deepEqual(progress, [{ current: 1, total: 1, key: key() }]); assert.equal(deliveries.length, 0);
});
test('Storage read failure is reported, never treated as a missing snapshot followed by network refresh', async () => {
    state.failRead = true;
    const result = await runExport(request());
    assert.deepEqual(result.failed, [key()]); assert.deepEqual(events, []);
});

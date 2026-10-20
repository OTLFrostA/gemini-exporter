import { account, key, address, seed, request, reset, records, events, deliveries, state, provider, indexes, details, contexts } from './helpers/applicationHarness.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runExport, shouldSkipExport } from '../src/application/export/runExport.js';
import { prepareExportResources } from '../src/application/export/prepareExportResources.js';
import { updateSettings } from '../src/application/settings/index.js';
import type { ExportRecord } from '../src/application/export/types.js';

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
test('Skip accepts zero epoch-ms but rejects fractional, nonfinite and unsafe source versions', () => {
    const skip = request({ skipUnchanged: true });
    assert.equal(shouldSkipExport({ ...previous, chatTime: 0 }, 0, skip), true);
    for (const invalid of [NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal(shouldSkipExport({ ...previous, chatTime: invalid }, 100, skip), false);
        assert.equal(shouldSkipExport(previous, invalid, skip), false);
    }
});
for (const format of ['markdown', 'html', 'json', 'pdf'] as const) {
    test(`${format} uses local Domain, shared resources, then delivery before the minimal Record`, async () => {
        seed();
        const startedAt = Date.now();
        const result = await runExport(request({ format }));
        assert.equal(result.exported, 1); assert.equal(result.partial, 0);
        assert.deepEqual(events, ['delivery', 'record:first']);
        const record = records.get(address(key()))!;
        assert.deepEqual(Object.keys(record).sort(), ['chatTime', 'exportedAt', 'format', 'status']);
        assert.equal(record.chatTime, 100); assert.equal(record.format, format);
        assert.ok(record.exportedAt >= startedAt && record.exportedAt <= Date.now(), 'delivery record uses real epoch-ms');
        assert.equal(deliveries[0].length, 1);
        if (format === 'pdf') { assert.equal(state.disposed, 1); assert.equal(state.pdfRenderKey, 'first'); }
        else assert.deepEqual(state.rendererCalls.map(call => [call.format, call.key]), [[format, 'first']]);
        assert.equal(state.compositions.length, format === 'json' ? 0 : 1);
        assert.equal(state.jsonInputs.length, format === 'json' ? 1 : 0);
    });
    test(`${format} includeAssets=false does not acquire bytes or mark intentional omissions partial`, async () => {
        seed('first', { assets: true });
        const result = await runExport(request({ format, includeAssets: false }));
        assert.equal(result.exported, 1); assert.equal(result.partial, 0);
        assert.ok(!events.some(event => event.startsWith('acquire:')));
        if (format === 'json') {
            assert.equal(state.jsonInputs[0].detail.assets.length, 3);
            assert.deepEqual(state.rendererCalls[0].bindings, {});
        }
    });
    test(`${format} chooses only the format's required resource IDs`, async () => {
        seed('first', { assets: true });
        const result = await runExport(request({ format }));
        assert.equal(result.exported, 1);
        assert.deepEqual(events.filter(event => event.startsWith('acquire:')), format === 'json'
            ? ['acquire:image', 'acquire:file', 'acquire:unused'] : ['acquire:image', 'acquire:file']);
        assert.deepEqual(state.browserPlans.map(plan => plan.preparedIds), [format === 'json'
            ? ['image', 'file', 'unused'] : ['image', 'file']]);
        assert.deepEqual(state.browserPlans[0].fileIds, format === 'json' ? [] : ['file']);
        if (format === 'pdf') {
            assert.deepEqual(state.pdfPrepared, ['image', 'file']);
            assert.ok(state.pdfBindings.image); assert.ok(state.pdfBindings.file);
        }
        assert.equal(state.packages.length, 1);
        assert.deepEqual(state.packages[0], { delivery: 'browserDownload', groups: 1, files: 1 });
    });
}
test('PDF supplies L4 the referenced original-file IDs and all prepared bytes', async () => {
    seed('first', { assets: true });
    const result = await runExport(request({ format: 'pdf', delivery: 'folderWriter' }));
    assert.equal(result.exported, 1);
    assert.deepEqual(state.folderPlans.map(plan => plan.fileIds), [['file']]);
    assert.deepEqual(state.folderPlans[0].preparedIds, ['image', 'file']);
    assert.deepEqual(state.pdfPrepared, ['image', 'file']);
    assert.equal(state.builtFiles[0].format, 'pdf');
    assert.equal(deliveries.length, 1);
    // Emitting original files vs embedded media is L4's responsibility, not an Application unit assertion.
});
for (const format of ['markdown', 'html', 'pdf'] as const) {
    test(`${format} uses the shared Settings language for renderer-owned text`, async () => {
        await updateSettings({ language: 'zh' });
        seed();
        const result = await runExport(request({ format }));
        assert.equal(result.exported, 1);
        assert.equal(state.settingsReads, 1);
        if (format === 'pdf') assert.equal(state.pdfLocale, 'zh');
        else assert.equal(state.rendererCalls[0].locale, 'zh');
    });
}
test('Export resolves renderer language once per task and JSON does not read renderer preferences', async () => {
    await updateSettings({ language: 'en' });
    seed(); seed('second');
    const result = await runExport(request({ keys: [key(), key('second')], delivery: 'folderWriter' }));
    assert.equal(result.exported, 2);
    assert.equal(state.settingsReads, 1);
    reset(); seed();
    assert.equal((await runExport(request({ format: 'json' }))).exported, 1);
    assert.equal(state.settingsReads, 0);
});
test('HTML warning diagnostics keep ok, while L4 content omission produces partial', async () => {
    seed();
    state.htmlDiagnostics = [{ severity: 'warning', code: 'FONT_SUBSTITUTED', message: 'fallback' }];
    const first = await runExport(request({ format: 'html' }));
    assert.equal(first.exported, 1); assert.equal(first.partial, 0);
    state.htmlDiagnostics = [{ severity: 'warning', code: 'FORMAT_CONTENT_OMITTED', message: 'omitted' }];
    const second = await runExport(request({ format: 'html' }));
    assert.equal(second.exported, 1); assert.equal(second.partial, 1);
    assert.equal(records.get(address(key()))?.status, 'partial');
});
test('PDF ordinary renderer diagnostics do not mark partial, but FORMAT_CONTENT_OMITTED does', async () => {
    seed();
    state.pdfDiagnostics = [{ severity: 'warning', code: 'TYPST_LOCAL_FONT_READ_FAILED', message: 'fallback used' }];
    const first = await runExport(request({ format: 'pdf' }));
    assert.equal(first.exported, 1); assert.equal(first.partial, 0);
    assert.equal(records.get(address(key()))?.status, 'ok');
    state.pdfDiagnostics = [{ severity: 'warning', code: 'FORMAT_CONTENT_OMITTED', message: 'content omitted' }];
    const second = await runExport(request({ format: 'pdf' }));
    assert.equal(second.exported, 1); assert.equal(second.partial, 1);
    assert.equal(records.get(address(key()))?.status, 'partial');
});
test('skipUnchanged opt-in uses the matching Record; false always performs the export', async () => {
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
test('confirmed remote Detail deletion fails the Key instead of exporting its stale local snapshot', async () => {
    seed('first', { savedAt: 90 });
    records.set(address(key()), previous);
    provider.fetchConversationDetail = async () => { events.push('refresh'); throw new Error('conversation_not_found'); };
    const result = await runExport(request());
    assert.equal(result.exported, 0);
    assert.deepEqual(result.failed, [key()]);
    assert.deepEqual(events, ['refresh']);
    assert.equal(records.get(address(key())), previous);
    assert.equal(deliveries.length, 0);
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
        if (format === 'json') assert.deepEqual(state.jsonInputs[0].detail.messages, []);
        else assert.deepEqual(state.compositions[0].detail.messages, []);
    });
}
test('Folder Writer creates one shared L4 planner and calls it once per conversation', async () => {
    seed('alpha_sameid'); seed('beta_sameid');
    const result = await runExport(request({
        keys: [key('alpha_sameid'), key('beta_sameid')], format: 'markdown', delivery: 'folderWriter',
    }));
    assert.equal(result.exported, 2);
    assert.deepEqual(state.folderPlannerCreations, ['markdown']);
    assert.deepEqual(state.folderPlans.map(plan => plan.key), ['alpha_sameid', 'beta_sameid']);
    assert.equal(state.browserPlans.length, 0);
    assert.equal(state.packages.length, 0, 'Folder groups go directly to Delivery');
});
test('refresh is void; Export rereads L2 instead of using a Provider response', async () => {
    seed('first', { savedAt: 90 });
    provider.fetchConversationDetail = async (accountId, conversationId) => {
        assert.equal(accountId, account.id); assert.equal(conversationId, 'first');
        const { detail } = seed(); detail.messages[0].content = [{ type: 'paragraph', children: [{ type: 'text', text: 'Committed replacement' }] }];
    };
    const result = await runExport(request());
    assert.equal(result.partial, 0);
    assert.match(JSON.stringify(state.compositions[0].detail.messages), /Committed replacement/);
    assert.equal(state.compositions.length, 1);
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
    assert.deepEqual(state.rendererCalls[0].bindings, {});
    assert.equal(state.jsonInputs[0].detail.assets.length, 3);
});
test('Folder Writer finalizes and releases one conversation before preparing the next', async () => {
    seed('first', { assets: true, savedAt: 90 });
    seed('second', { assets: true, savedAt: 90 });
    provider.fetchConversationDetail = async (_account, id) => {
        if (id === 'second') {
            assert.equal(deliveries.length, 1, 'first group delivered before next refresh');
            assert.ok(events.includes('record:first'), 'first group recorded before next refresh');
            assert.deepEqual(state.releasedKeys, ['first'], 'first reader released before next refresh');
        }
        seed(id, { assets: true });
    };
    const result = await runExport(request({ keys: [key(), key('second')], delivery: 'folderWriter' }));
    assert.equal(result.exported, 2);
    assert.deepEqual(state.releasedKeys, ['first', 'second']);
    assert.equal(state.releasedContexts, 1);
    assert.deepEqual(state.folderPlans.map(plan => plan.key), ['first', 'second']);
});
test('resource preparation passes ConversationKey independently for identical asset IDs', async () => {
    seed('first', { assets: true }); seed('second', { assets: true });
    const acquisitions: string[] = [];
    provider.acquireResource = async (conversationKey, asset) => {
        acquisitions.push(conversationKey.conversationId + ':' + asset.id);
        return { bytes: new Uint8Array([9]) };
    };
    await runExport(request({ keys: [key(), key('second')], delivery: 'folderWriter' }));
    assert.deepEqual(acquisitions, ['first:image', 'first:file', 'second:image', 'second:file']);
    assert.equal(contexts.length, 1, 'one task-level L1 context, not one context per item');
    assert.equal(state.releasedContexts, 1);
    assert.deepEqual(state.releasedKeys, ['first', 'second']);
});
test('AST resource reference selection is delegated to L3b and forwarded by Application', async () => {
    seed('first', { assets: true });
    // The fake L3b returns a controlled set, not a traversed AST.
    const { references } = require('./helpers/applicationHarness.js') as typeof import('./helpers/applicationHarness.js');
    references.set('first', { referencedIds: ['file'], fileIds: ['file'], imageIds: [] });
    const result = await runExport(request({ format: 'markdown' }));
    assert.equal(result.exported, 1);
    assert.deepEqual(events.filter(event => event.startsWith('acquire:')), ['acquire:file']);
    assert.deepEqual(state.browserPlans[0].fileIds, ['file']);
    assert.deepEqual(state.browserPlans[0].preparedIds, ['file']);
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
    test(`${delivery} delivery failure affects only participating keys and preserves old records`, async () => {
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
test('Browser uses one L4 batch plan and one final delivery for multiple prepared conversations', async () => {
    seed(); seed('second');
    const result = await runExport(request({ keys: [key(), key('second')] }));
    assert.equal(result.exported, 2);
    assert.deepEqual(state.browserPlans.map(plan => plan.key), ['first', 'second']);
    assert.equal(state.folderPlannerCreations.length, 0);
    assert.deepEqual(state.packages, [{ delivery: 'browserDownload', groups: 2, files: 2 }]);
    assert.deepEqual(events, ['delivery', 'record:first', 'record:second']);
    assert.equal(deliveries.length, 1);
});
test('L4 packaging failure prevents Browser delivery and does not overwrite previous Records', async () => {
    seed(); seed('second');
    records.set(address(key()), previous);
    state.failPackage = true;
    const result = await runExport(request({ keys: [key(), key('second')] }));
    assert.equal(result.exported, 0);
    assert.deepEqual(result.failed, [key(), key('second')]);
    assert.equal(deliveries.length, 0);
    assert.equal(records.get(address(key())), previous);
});
test('one L4 formatting failure does not block a different pending conversation', async () => {
    seed(); seed('second');
    state.failRender = 'markdown'; state.failRenderKey = 'first';
    const result = await runExport(request({ keys: [key(), key('second')] }));
    assert.deepEqual(result.failed, [key()]);
    assert.equal(result.exported, 1);
    assert.equal(deliveries.length, 1);
    assert.equal(state.packages[0].groups, 1);
    assert.equal(records.has(address(key('second'))), true);
});
test('Browser batch Record failure counts only committed records without a second delivery', async () => {
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

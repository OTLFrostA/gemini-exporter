import test from 'node:test';
import assert from 'node:assert/strict';
import { ExportOrchestrator } from '../src/core/engine/export/exportOrchestrator.js';
import { AssetPipeline, type AssetPipelineOptions } from '../src/core/engine/assetPipeline.js';
import { BatchWorker } from '../src/core/engine/export/batchWorker.js';
import { saveDomainConversation, __clearDomainMemory } from '../src/core/storage/domain/domainStore.js';
import { historicalFixture } from './helpers/nativeFixture.js';
import { __setModuleOverride, __clearModuleOverrides } from '../src/core/utils/moduleOverrides.js';
import { OptionsSync } from '../src/ui/options/modules/optionsSync.js';
import { setScanRunning } from '../src/ui/controllers/syncController.js';

function globals(values: Record<string, unknown>): () => void {
    const previous = Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
    return () => { for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    } };
}
function exportMocks() {
    const files: Record<string, unknown> = {};
    const records: Record<string, unknown> = {};
    __setModuleOverride('JSZip', class {
        folder() { return { file: (path: string, content: unknown) => { files[path] = content; } }; }
        async generateAsync() { return new Blob(['zip']); }
    });
    __setModuleOverride('StorageService', {
        getExportedIds: async () => records,
        saveExportRecord: async (_slot: string, id: string, record: unknown) => { records[id] = record; return records; }
    });
    return { files, records };
}

test('deleted export uses Domain / Takeout assets and immediately records missing assets without any remote request or retry', async () => {
    __clearDomainMemory();
    const { files, records } = exportMocks();
    const source = historicalFixture({ id: 'deleted_local', title: 'Deleted local', messages: [{ role: 'model', content: 'Saved answer', images: [
        { url: 'https://example.com/domain.png', fileName: 'domain.png' },
        { url: 'https://example.com/takeout.png', fileName: 'takeout.png' },
        { url: 'https://example.com/missing.png', fileName: 'missing.png' }
    ] }] });
    const [domain, takeout] = source.conversation.assets;
    await saveDomainConversation('u0', source, [{ assetId: domain.id, bytes: new Uint8Array([1, 2, 3]) }]);
    let requests = 0;
    const logs: string[] = [];
    __setModuleOverride('TabService', { sendToGeminiTab: async () => { requests++; return { success: false, error: 'unexpected request' }; } });
    __setModuleOverride('AssetPipeline', class extends AssetPipeline {
        constructor(options: AssetPipelineOptions) { super({ ...options, fetchAsset: async () => {
            requests++; return { success: true, dataBase64: 'AQID' };
        } }); }
    });
    try {
        const result = await new ExportOrchestrator().run({ selected: [{ id: 'deleted_local' }], currentSlot: 'u0',
            conversations: [{ id: 'deleted_local', title: 'Deleted local', timestamp: 1, cloudAvailability: 'deleted' }], worker: BatchWorker,
            takeoutEngine: { getTakeoutOfflineChat: () => null, getTakeoutMediaForChat: () => [],
                getTakeoutFallbackMedia: async (_id, lookup) => lookup.assetId === takeout.id ? new Uint8Array([4, 5, 6]) : null }
        }, { onLog: message => logs.push(message) });
        assert.equal(requests, 0, 'deleted bodies and missing resources must never reach remote acquisition');
        assert.equal(result.landedChats, 1);
        assert.equal(result.downloadedAssets, 2);
        assert.equal(result.failedAttachments.length, 1);
        assert.match(result.failedAttachments[0].error || '', /local|Local/);
        assert.doesNotMatch(logs.join(' '), /后重试|backoff/);
        assert.equal((records.deleted_local as { status: string }).status, 'partial');
        assert.match(Object.values(files).filter(value => typeof value === 'string').join(' '), /Saved answer/);
    } finally { __clearModuleOverrides(); __clearDomainMemory(); }
});

test('unlisted export fetches fresh cloud content first and falls back to a local snapshot only after failure', async () => {
    __clearDomainMemory();
    const local = historicalFixture({ id: 'unlisted_local', title: 'Unlisted local', messages: [{ role: 'user', content: 'Stale snapshot' }] });
    const fresh = historicalFixture({ id: 'unlisted_local', title: 'Unlisted local', messages: [{ role: 'user', content: 'Fresh cloud answer' }] });
    await saveDomainConversation('u0', local);
    let calls = 0;
    try {
        for (const error of [null, 'HTTP 503', 'Malformed direct response envelope']) {
            const { files } = exportMocks();
            __setModuleOverride('TabService', { sendToGeminiTab: async () => {
                calls++; return error ? { success: false, error } : { success: true, data: fresh };
            } });
            const logs: string[] = [];
            const result = await new ExportOrchestrator().run({ selected: [{ id: 'unlisted_local' }], currentSlot: 'u0', includeAssets: false,
                conversations: [{ id: 'unlisted_local', title: 'Unlisted local', timestamp: 1, cloudAvailability: 'unlisted' }], worker: BatchWorker
            }, { onLog: message => logs.push(message) });
            assert.equal(result.landedChats, 1);
            assert.equal(result.failedChats.length, 0);
            const text = Object.values(files).filter(value => typeof value === 'string').join(' ');
            assert.match(text, error ? /Stale snapshot/ : /Fresh cloud answer/);
            if (error) assert.match(logs.join(' '), /local snapshot/);
            else assert.doesNotMatch(text, /Stale snapshot/);
        }
        assert.equal(calls, 3, 'unlisted must attempt cloud for each export');
    } finally { __clearModuleOverrides(); __clearDomainMemory(); }
});

test('sync UI never reaches success completion for partial_limit / aborted / error via broadcasts or final replies', async () => {
    const bar = { style: { width: '0%' } };
    const text = { textContent: '' };
    const wrap = { style: { display: 'none' } };
    const clicks: Record<string, () => void> = {};
    let listener: (message: unknown) => void = () => {};
    let status = 'error';
    let success = false;
    let reloads = 0;
    let prompts = 0;
    const restore = globals({ document: { getElementById: (id: string) => {
        if (id === 'bar') return bar;
        if (id === 'progText') return text;
        if (id === 'progWrap') return wrap;
        if (['btnDeepScan', 'btnIncrementalScan', 'btnStopScan'].includes(id)) return {
            style: {}, addEventListener: (_event: string, callback: () => void) => { clicks[id] = callback; }
        };
        return null;
    } }, chrome: { runtime: {
        sendMessage: (_message: unknown, callback: (response: unknown) => void) => callback({ success, status, count: 3,
            error: 'remaining pages unavailable', hitGoogleLimit: status === 'partial_limit' }),
        onMessage: { addListener: (callback: typeof listener) => { listener = callback; } }
    } } });
    __setModuleOverride('TabService', { getGeminiTab: async () => null });
    __setModuleOverride('ConversationsStore', { getCurrentSlot: () => 'u0', getConversations: () => [] });
    __setModuleOverride('ExportController', { isRunning: () => false });
    try {
        await OptionsSync.init({ loadStore: async () => { reloads++; }, log: () => {}, maybePromptTakeout: () => { prompts++; } });
        for (status of ['partial_limit', 'aborted', 'error']) {
            for (const button of ['btnDeepScan', 'btnIncrementalScan']) {
                clicks[button]();
                listener({ action: 'scanProgress', status, percent: 100, done: 1, count: 3, title: 'Incomplete', hitGoogleLimit: status === 'partial_limit' });
                assert.notEqual(bar.style.width, '100%', `${status} broadcast`);
                await new Promise(resolve => setImmediate(resolve));
                assert.notEqual(bar.style.width, '100%', `${status} reply`);
                assert.equal(wrap.style.display, 'block', 'incomplete result remains visible');
            }
        }
        assert.equal(reloads, 6, 'saved partial data is reloaded');
        assert.ok(prompts > 0, 'partial limit still offers Takeout');
        for (status of ['complete', 'up_to_date']) {
            success = true;
            clicks.btnDeepScan();
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(bar.style.width, '100%');
            listener({ action: 'scanProgress', status, percent: 100, done: 1, title: 'Complete' });
            assert.equal(bar.style.width, '100%');
        }
        clicks.btnStopScan();
        assert.notEqual(bar.style.width, '100%', 'stop request must not show success');
    } finally { await new Promise(resolve => setImmediate(resolve)); setScanRunning(false); __clearModuleOverrides(); restore(); }
});

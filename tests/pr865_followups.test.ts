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
import { OptionsExport } from '../src/ui/options/modules/optionsExport.js';
import { ProgressView } from '../src/ui/views/progressView.js';
import { LOCALES } from '../src/core/utils/i18n.js';
import type { Conversation } from '../src/types/conversation.js';
import type { UIExportResult } from '../src/types/ui.js';

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

test('normal export fetches fresh cloud content first and falls back to a local snapshot only after failure', async () => {
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
                conversations: [{ id: 'unlisted_local', title: 'Unlisted local', timestamp: 1 }], worker: BatchWorker
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

test('normal snapshot records stay partial and skipExported retries cloud; fresh cloud and normal deleted local exports remain ok', async () => {
    __clearDomainMemory();
    const { records, files } = exportMocks();
    const local = historicalFixture({ id: 'retry_snapshot', title: 'Retry snapshot', messages: [{ role: 'user', content: 'Saved snapshot' }] });
    const fresh = historicalFixture({ id: 'retry_snapshot', title: 'Retry snapshot', messages: [{ role: 'user', content: 'Fresh cloud content' }] });
    await saveDomainConversation('u0', local);
    let calls = 0;
    let available = false;
    const list: Conversation = { id: 'retry_snapshot', title: 'Retry snapshot', timestamp: 1 };
    __setModuleOverride('TabService', { sendToGeminiTab: async () => {
        calls++; return available ? { success: true, data: fresh } : { success: false, error: 'HTTP 503' };
    } });
    const run = (skip: boolean) => new ExportOrchestrator().run({ selected: [{ id: list.id }], conversations: [list],
        currentSlot: 'u0', includeAssets: false, skip, worker: BatchWorker });
    const status = () => (records.retry_snapshot as { status: string }).status;
    try {
        await run(false);
        assert.equal(status(), 'partial', 'a saved snapshot cannot confirm cloud freshness');
        const retry = await run(true);
        assert.equal(retry.skipped, 0); assert.equal(calls, 2); assert.equal(status(), 'partial');
        available = true;
        await run(true);
        assert.equal(calls, 3); assert.equal(status(), 'ok');
        assert.match(Object.values(files).filter(value => typeof value === 'string').join(' '), /Fresh cloud content/);
        assert.equal((await run(true)).skipped, 1); assert.equal(calls, 3);
        list.cloudAvailability = 'deleted';
        await run(false);
        assert.equal(status(), 'ok', 'known deleted local export remains complete');
        assert.equal(calls, 3);
        assert.equal((await run(true)).skipped, 1);
    } finally { __clearModuleOverrides(); __clearDomainMemory(); }
});

test('confirmed deletion updates memory before persistence and retains localOnly even if that write fails', async () => {
    __clearDomainMemory();
    const { records } = exportMocks();
    const source = historicalFixture({ id: 'delete_write_failure', title: 'Delete write failure', messages: [{ role: 'model', content: 'Retained answer',
        images: [{ url: 'https://example.com/missing-deleted.png', fileName: 'missing.png' }] }] });
    await saveDomainConversation('u0', source);
    let assetRequests = 0;
    let writes = 0;
    let memoryAtWrite: Conversation['cloudAvailability'];
    const list: Conversation = { id: source.conversation.id, title: source.conversation.title, timestamp: 1, cloudAvailability: 'unlisted' };
    __setModuleOverride('StorageService', { getExportedIds: async () => records,
        saveExportRecord: async (_slot: string, id: string, record: unknown) => { records[id] = record; return records; },
        updateConversation: async (_slot: string, _id: string, update: unknown) => {
            if (update && typeof update === 'object' && 'cloudAvailability' in update) {
                writes++; memoryAtWrite = list.cloudAvailability; throw new Error('Injected deleted marker write failure');
            }
        }
    });
    __setModuleOverride('TabService', { sendToGeminiTab: async () => ({ success: true, data: { id: list.id, isDeleted: true, error: 'HTTP 404' } }) });
    __setModuleOverride('AssetPipeline', class extends AssetPipeline {
        constructor(options: AssetPipelineOptions) { super({ ...options, fetchAsset: async () => {
            assetRequests++; return { success: true, dataBase64: 'AQID' };
        } }); }
    });
    try {
        const logs: string[] = [];
        const result = await new ExportOrchestrator().run({ selected: [{ id: list.id }], conversations: [list], currentSlot: 'u0', worker: BatchWorker },
            { onLog: message => logs.push(message) });
        assert.equal(memoryAtWrite, 'deleted', 'memory must be restricted before any storage await');
        assert.equal(list.cloudAvailability, 'deleted');
        assert.equal(writes, 1);
        assert.equal(assetRequests, 0);
        assert.equal(result.landedChats, 1); assert.equal(result.failedAttachments.length, 1);
        assert.match(logs.join(' '), /Injected deleted marker write failure/);
        // Confirmed deletion is also restrictive when the caller has no list metadata.
        const noList = await new ExportOrchestrator().run({ selected: [{ id: list.id }], currentSlot: 'u0', worker: BatchWorker });
        assert.equal(noList.landedChats, 1); assert.equal(noList.failedAttachments.length, 1);
        assert.equal(assetRequests, 0);
    } finally { __clearModuleOverrides(); __clearDomainMemory(); }
});

test('export completion warns for attachment-only and mixed failures in both languages; a complete export still reports success', async () => {
    const progressText = { textContent: '' };
    const restore = globals({ document: { getElementById: (id: string) => id === 'progText' ? progressText : null } });
    const selected = [{ id: 'completion_test', title: 'Completion test', timestamp: 1 }];
    let result: UIExportResult = {};
    const logs: { message: string; level?: string }[] = [];
    __setModuleOverride('ConversationsStore', { getCurrentSlot: () => 'u0', getConversations: () => selected, getExportedIds: () => ({}) });
    __setModuleOverride('ListView', { getSelectedIds: () => new Set(['completion_test']), setSelectedIds: () => {} });
    __setModuleOverride('FormatStore', { loadFormat: async () => ({ format: 'markdown' }) });
    __setModuleOverride('DirHandleController', { getDirHandle: () => null, restoreSavedDirHandle: async () => null });
    __setModuleOverride('DialogView', { hideExportFailureBanner: () => {}, renderExportFailureBanner: () => {} });
    __setModuleOverride('ExportController', { runExport: async () => result });
    try {
        await OptionsExport.init({ log: (message, level) => logs.push({ message, level }) });
        for (const lang of ['en', 'zh']) {
            __setModuleOverride('I18n', { getLang: () => lang, t: (key: string, ...args: unknown[]) => {
                const template = LOCALES[lang][key];
                return typeof template === 'string' ? template.replace(/\{(\d+)\}/g, (_match, index: string) => String(args[Number(index)])) : key;
            } });
            for (const failedChats of [[], [{ id: 'failed_chat', title: 'Failed chat', error: 'unavailable' }]]) {
                result = { landedChats: 1, failedChats, failedAttachments: [{ chatId: 'completion_test', file: 'missing.png', error: 'missing' }] };
                await OptionsExport.startExportPipeline(selected, 'markdown', false, false, true, true, null);
                assert.equal(logs[logs.length - 1].level, 'warn', 'attachment failure is not a successful completion');
                assert.match(progressText.textContent, lang === 'en' ? /Attachments failed: 1/ : /附件失败 1/);
                assert.doesNotMatch(progressText.textContent, /Export completed!|导出完成！/);
            }
            result = { landedChats: 1, failedChats: [], failedAttachments: [] };
            await OptionsExport.startExportPipeline(selected, 'markdown', false, false, true, true, null);
            assert.equal(logs[logs.length - 1].level, 'info');
            assert.match(progressText.textContent, /Export completed!|导出完成！/);
        }
    } finally { ProgressView.hide(); __clearModuleOverrides(); restore(); }
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
        if (['btnSyncAll', 'btnStopScan'].includes(id)) return {
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
            for (const button of ['btnSyncAll']) {
                clicks[button]();
                listener({ action: 'scanProgress', status, percent: 100, done: 1, count: 3, title: 'Incomplete', hitGoogleLimit: status === 'partial_limit' });
                assert.notEqual(bar.style.width, '100%', `${status} broadcast`);
                await new Promise(resolve => setImmediate(resolve));
                assert.notEqual(bar.style.width, '100%', `${status} reply`);
                assert.equal(wrap.style.display, 'block', 'incomplete result remains visible');
            }
        }
        assert.equal(reloads, 3, 'saved partial data is reloaded');
        assert.ok(prompts > 0, 'partial limit still offers Takeout');
        for (status of ['complete', 'up_to_date']) {
            success = true;
            clicks.btnSyncAll();
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(bar.style.width, '100%');
            listener({ action: 'scanProgress', status, percent: 100, done: 1, title: 'Complete' });
            assert.equal(bar.style.width, '100%');
        }
        clicks.btnStopScan();
        assert.notEqual(bar.style.width, '100%', 'stop request must not show success');
    } finally { await new Promise(resolve => setImmediate(resolve)); setScanRunning(false); __clearModuleOverrides(); restore(); }
});

test('a failed cloud fetch without a same-account body remains a failed export', async () => {
    __clearDomainMemory();
    const { records } = exportMocks();
    const foreign = historicalFixture({ id: 'missing_local', title: 'Other account', messages: [{ role: 'user', content: 'Private other-account answer' }] });
    await saveDomainConversation('u1', foreign);
    __setModuleOverride('TabService', { sendToGeminiTab: async () => ({ success: false, error: 'HTTP 503' }) });
    try {
        const result = await new ExportOrchestrator().run({ selected: [{ id: 'missing_local' }], currentSlot: 'u0', includeAssets: false,
            conversations: [{ id: 'missing_local', title: 'Unavailable', timestamp: 1 }], worker: BatchWorker });
        assert.equal(result.landedChats, 0);
        assert.equal(result.failedChats.length, 1);
        assert.equal(records.missing_local, undefined);
    } finally { __clearModuleOverrides(); __clearDomainMemory(); }
});

import { domainFixtureBrowser } from './domainFixtureBrowser';
import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import * as path from 'node:path';

let bundle: string;
test.beforeAll(async () => {
    const output = await build({ stdin: { contents: `
        import { indexFixture } from './tests/helpers/indexFixture.ts';
        import * as store from './src/core/storage/domain/domainStore.ts';
        import { migrate, CURRENT_SCHEMA_VERSION } from './src/core/storage/schemaMigration.ts';
        import { saveConversationDetail, getConversationDetail } from './src/core/storage/conversationDetailStore.ts';
        import * as StorageService from './src/core/storage/storageService.ts';
        import { getDomainConversationResult } from './src/core/storage/domain/nativePersistence.ts';
        import { AssetPipeline } from './src/core/engine/assetPipeline.ts';
        import { preparePdfResources } from './src/core/export/pdf/prepareResources.ts';
        import { formatMarkdownDocument } from './src/core/engine/chatFormatter.ts';
        globalThis.storageProbe = { indexFixture, ...store, migrate, CURRENT_SCHEMA_VERSION, saveConversationDetail, getConversationDetail, StorageService, getDomainConversationResult, AssetPipeline, formatMarkdownDocument, preparePdfResources };
    `, resolveDir: path.resolve(__dirname, '../..'), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife' });
    bundle = output.outputFiles[0].text;
});
test.beforeEach(async ({ page }) => {
    await page.route('https://storage.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Storage contract</body></html>' }));
    await page.addInitScript({ content: domainFixtureBrowser });
    await page.goto('https://storage.test/');
});
async function install(page: import('@playwright/test').Page): Promise<void> {
    await page.addScriptTag({ content: `
        globalThis.chrome = { runtime: { async sendMessage(message) { if(message.action!=='accountRegistry')return; return {ok:true,value: {id:message.accountId,providerId:'gemini',providerAccountId:'fixture'}}; } }, storage: { local: {
            async get(keys) { const all = JSON.parse(localStorage.getItem('chrome-local') || '{}'); if (!keys) return all; return Object.fromEntries((typeof keys === 'string' ? [keys] : keys).map(k => [k, all[k]])); },
            async set(values) { const all = await this.get(null); localStorage.setItem('chrome-local', JSON.stringify({...all, ...values})); },
            async remove(keys) { const all = await this.get(null); for (const k of typeof keys === 'string' ? [keys] : keys) delete all[k]; localStorage.setItem('chrome-local', JSON.stringify(all)); }
        }, session: { async get() { return {}; }, async set() {} } } };
    ` });
    await page.addScriptTag({ content: bundle });
}

test('durable attachment bytes remain outside Domain and are acquired offline after restart', async ({ page }) => {
    await install(page);
    await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'storageProbe');
        await chrome.storage.local.set({ gemini_schema_version: 3 });
        await api.saveDomainConversation('10000000-0000-4000-8000-000000000001', { account: fixtureAccount(), conversation: { index: { key: fixtureKey(String('offline'), 'gemini'),   titleSource: "derived",   title: 'Offline' }, detail: { key: fixtureKey(String('offline'), 'gemini'), quality: { status: 'unknown' }, assets: [{ id: 'image', kind: 'image', sourceUri: 'Takeout/source.png' }], messages: [{ role: 'assistant', content: [{ type: 'image', assetId: 'image' }] }] } }, resourceHints: {}, acquisitionHints: {}, diagnostics: [] }, [{ assetId: 'image', sourcePath: 'Takeout/source.png', bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]) }]);
    });
    await page.reload(); await install(page);
    const restored = await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'storageProbe');
        const view = await api.getDomainConversationResult('10000000-0000-4000-8000-000000000001', 'offline');
        const pipeline = new api.AssetPipeline({ accountId: '10000000-0000-4000-8000-000000000001', fetchAsset: async () => { throw new Error('Network must not be needed'); } });
        const bytes = await pipeline.acquireAssetBytes({ assetId: view.conversation.detail.assets[0].id, url: view.conversation.detail.assets[0].sourceUri }, { id: 'offline', title: 'Offline' });
        return { bytes: [...bytes.value.bytes], conversation: view.conversation };
    });
    expect(restored.bytes).toEqual([137, 80, 78, 71, 13, 10, 26, 10, 1]);
    expect(JSON.stringify(restored.conversation)).not.toMatch(/bytes|dataBuffer|archivePath|localName/);
});

test('online byte cache survives restart, deletion erases bytes and a late migration cannot restore the body', async ({ page }) => {
    await install(page);
    await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'storageProbe');
        const parsed = { account: fixtureAccount(), conversation: { index: { key: fixtureKey(String('cached'), 'gemini'),   titleSource: "derived",   title: 'Cached' }, detail: { key: fixtureKey(String('cached'), 'gemini'), quality: { status: 'unknown' }, assets: [{ id: 'asset', kind: 'image', sourceUri: 'https://example.test/image' }], messages: [{ role: 'assistant', content: [{ type: 'image', assetId: 'asset' }] }] } }, acquisitionHints: {}, resourceHints: {}, diagnostics: [] };
        await api.saveDomainConversation('10000000-0000-4000-8000-000000000001', parsed);
        await api.cacheDomainResource(api.storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', 'cached'), 'asset', 'https://example.test/image', new Uint8Array([1, 2, 3]));
    });
    await page.reload(); await install(page);
    const result = await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'storageProbe');
        const identity = api.storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', 'cached');
        const record = await api.getStoredDomain(identity);
        const bytes = await api.getDomainResource(identity, 'asset');
        await api.removeStoredDomain(identity);
        const late = await api.saveDomainConversation('10000000-0000-4000-8000-000000000001', api.storedParseResult(record, fixtureAccountFor(record.conversation)), [], true);
        const removed = await api.getStoredDomain(identity);
        await api.saveDomainConversation('10000000-0000-4000-8000-000000000001', api.storedParseResult(record, fixtureAccountFor(record.conversation)));
        return { bytes: [...bytes], late, removed, restoredBytes: await api.getDomainResource(identity, 'asset') };
    });
    expect(result).toEqual({ bytes: [1, 2, 3], late: null, removed: null, restoredBytes: null });
});

for (const method of ['remove', 'clear'] as const) {
    for (const failure of ['domain', 'exports'] as const) {
        test(`${method} retries ${failure} deletion failure after list removal and restart`, async ({ page }) => {
            await install(page);
            const failed = await page.evaluate(async ({ method, failure }) => {
                const api = Reflect.get(globalThis, 'storageProbe');
                const parsed = { account: fixtureAccount(),
                    conversation: { index: { key: fixtureKey(String('retry-delete'), 'gemini'),   titleSource: "derived",   title: 'Delete' }, detail: { key: fixtureKey(String('retry-delete'), 'gemini'), quality: { status: 'unknown' }, assets: [{ id: 'archive', kind: 'image', sourceUri: 'Takeout/source.png' },
                            { id: 'online', kind: 'image', sourceUri: 'https://example.test/online.png' }], messages: [{ role: 'assistant', content: [{ type: 'image', assetId: 'archive' }, { type: 'image', assetId: 'online' }] }] } },
                    acquisitionHints: {}, resourceHints: {}, diagnostics: []
                };
                await chrome.storage.local.set({ gemini_schema_version: 3,
                    ['conversations_10000000-0000-4000-8000-000000000001']: [{ id: 'retry-delete', title: 'Delete' }].map(api.indexFixture),
                    ['conversations_10000000-0000-4000-8000-000000000002']: [{ ...api.indexFixture({ id: 'retry-delete', title: 'Other account' }), key: { accountId: '10000000-0000-4000-8000-000000000002', conversationId: 'retry-delete' } }],
                    ['exported_10000000-0000-4000-8000-000000000001']: { 'retry-delete': { timestamp: 1 }, 'c_retry-delete': { timestamp: 1 }, keep: { timestamp: 1 } },
                    ['exported_10000000-0000-4000-8000-000000000002']: { 'retry-delete': { timestamp: 2 } }
                });
                await api.saveDomainConversation('10000000-0000-4000-8000-000000000001', parsed, [{ assetId: 'archive', bytes: new Uint8Array([1, 2, 3]) }]);
                parsed.conversation.index.title = 'New revision';
                await api.saveDomainConversation('10000000-0000-4000-8000-000000000001', parsed);
                const other = structuredClone(parsed); other.account.id = '10000000-0000-4000-8000-000000000002'; other.conversation.index.key.accountId = other.account.id; other.conversation.detail.key.accountId = other.account.id;
                await api.saveDomainConversation('10000000-0000-4000-8000-000000000002', other, [{ assetId: 'archive', bytes: new Uint8Array([4, 5]) }]);
                for (const slot of ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002']) await api.cacheDomainResource(api.storageIdentity('gemini', slot, 'retry-delete'), 'online', 'https://example.test/online.png', new Uint8Array([6, 7]));
                const originalDelete = IDBObjectStore.prototype.delete;
                const originalSet = chrome.storage.local.set.bind(chrome.storage.local);
                IDBObjectStore.prototype.delete = function (...args) {
                    if (failure === 'domain' && this.transaction.db.name === 'gemini_exporter_domain' && this.name === 'conversations') {
                        throw new DOMException('Injected deletion failure', 'UnknownError');
                    }
                    return originalDelete.apply(this, args);
                };
                chrome.storage.local.set = async function (values) {
                    if (failure === 'exports' && 'exported_10000000-0000-4000-8000-000000000001' in values) throw new Error('Injected export-record deletion failure');
                    return originalSet(values);
                };
                let error = '';
                try {
                    if (method === 'remove') await api.StorageService.removeConversation('10000000-0000-4000-8000-000000000001', 'c_retry-delete');
                    else await api.StorageService.clearConversations('10000000-0000-4000-8000-000000000001');
                } catch (e) { error = String(e); }
                finally { IDBObjectStore.prototype.delete = originalDelete; chrome.storage.local.set = originalSet; }
                return {
                    error,
                    local: await chrome.storage.local.get(['conversations_10000000-0000-4000-8000-000000000001', 'gemini_pending_deletions_10000000-0000-4000-8000-000000000001']),
                    native: await api.getStoredDomain(api.storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', 'retry-delete'))
                };
            }, { method, failure });
            expect(failed.error).toContain('Injected');
            if (method === 'remove') expect(failed.local['conversations_10000000-0000-4000-8000-000000000001']).toEqual([]);
            else expect(failed.local['conversations_10000000-0000-4000-8000-000000000001']).toEqual([expect.objectContaining({ key: { accountId: '10000000-0000-4000-8000-000000000001', conversationId: 'retry-delete' } })]);
            expect(failed.local['gemini_pending_deletions_10000000-0000-4000-8000-000000000001']).toEqual(['retry-delete']);
            if (failure === 'domain') expect(failed.native).not.toBeNull();
            else expect(failed.native).toBeNull();

            // Retry from a new JS context: recovery must use disk intent, not the list or memory.
            await page.reload(); await install(page);
            const cleaned = await page.evaluate(async method => {
                const api = Reflect.get(globalThis, 'storageProbe');
                const result = method === 'remove'
                    ? await api.StorageService.removeConversation('10000000-0000-4000-8000-000000000001', 'retry-delete')
                    : await api.StorageService.clearConversations('10000000-0000-4000-8000-000000000001');
                const db = await api.openDomainDB();
                const stores = await new Promise<Record<string, unknown[]>>((resolve, reject) => {
                    const names = ['conversations', 'resource_bytes', 'removed_conversations'];
                    const tx = db.transaction(names, 'readonly');
                    const rows: Record<string, unknown[]> = {};
                    tx.oncomplete = () => resolve(rows);
                    tx.onabort = tx.onerror = () => reject(tx.error);
                    for (const name of names) {
                        const req = tx.objectStore(name).getAll();
                        req.onsuccess = () => { rows[name] = req.result; };
                    }
                });
                db.close();
                const repeat = method === 'remove'
                    ? await api.StorageService.removeConversation('10000000-0000-4000-8000-000000000001', 'c_retry-delete')
                    : await api.StorageService.clearConversations('10000000-0000-4000-8000-000000000001');
                return { result, repeat, stores,
                    local: await chrome.storage.local.get(['conversations_10000000-0000-4000-8000-000000000001', 'gemini_pending_deletions_10000000-0000-4000-8000-000000000001', 'last_count_10000000-0000-4000-8000-000000000001', 'gemini_account_slots', 'exported_10000000-0000-4000-8000-000000000001', 'exported_10000000-0000-4000-8000-000000000002']),
                    otherArchive: [...await api.getDomainResource(api.storageIdentity('gemini', '10000000-0000-4000-8000-000000000002', 'retry-delete'), 'archive')],
                    otherOnline: [...await api.getDomainResource(api.storageIdentity('gemini', '10000000-0000-4000-8000-000000000002', 'retry-delete'), 'online')]
                };
            }, method);
            expect(cleaned.result).toEqual(method === 'remove' ? false : undefined);
            expect(cleaned.repeat).toEqual(method === 'remove' ? false : undefined);
            expect(cleaned.local['conversations_10000000-0000-4000-8000-000000000001']).toEqual([]);
            expect(cleaned.local['gemini_pending_deletions_10000000-0000-4000-8000-000000000001']).toEqual([]);
            expect(cleaned.local['last_count_10000000-0000-4000-8000-000000000001']).toBe(0);
            expect(cleaned.local.gemini_account_slots).toBeUndefined();
            expect(cleaned.local['exported_10000000-0000-4000-8000-000000000001']).toEqual(method === 'remove' ? { keep: { timestamp: 1 } } : {});
            expect(cleaned.local['exported_10000000-0000-4000-8000-000000000002']).toEqual({ 'retry-delete': { timestamp: 2 } });
            // Only the other account survives in current and cached bytes.
            expect(cleaned.stores.conversations).toHaveLength(1);
            expect(cleaned.stores.resource_bytes).toHaveLength(2); // imported and downloaded bytes both live in the selected account cache
            expect(cleaned.stores.removed_conversations).toHaveLength(1);
            expect(cleaned.stores.removed_conversations[0]).toMatchObject({ key: JSON.stringify(['gemini', '10000000-0000-4000-8000-000000000001', 'retry-delete']) });
            expect(cleaned.otherArchive).toEqual([4, 5]);
            expect(cleaned.otherOnline).toEqual([6, 7]);
        });
    }
}

test('current storage rejects intermediate versions and obsolete fields without rewriting disk', async ({ page }) => {
    await install(page);
    const result = await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'storageProbe');
        const identity = api.storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', 'strict');
        const conversation = { index: { key: fixtureKey(String('strict'), 'gemini'),   titleSource: "derived",   title: 'Current' }, detail: { key: fixtureKey(String('strict'), 'gemini'), quality: { status: 'unknown' }, assets: [], messages: [] } };
        const record = { key: api.domainStorageKey(identity), storageVersion: 3, domainVersion: 3, identity,
            origin: 'source', revision: 'original', resources: [], acquisitionHints: {}, conversation };
        const db = await api.openDomainDB();
        const put = (value: unknown) => new Promise<void>((resolve, reject) => {
            const tx = db.transaction('conversations', 'readwrite'); tx.objectStore('conversations').put(value);
            tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error);
        });
        const get = () => new Promise<unknown>((resolve, reject) => {
            const tx = db.transaction('conversations', 'readonly'), req = tx.objectStore('conversations').get(record.key);
            tx.oncomplete = () => resolve(req.result); tx.onabort = tx.onerror = () => reject(tx.error);
        });
        try {
            const failures = [];
            for (const invalid of [{ ...record, domainVersion: 1 }, { ...record, domainVersion: 4 }, { ...record, savedAt: 1 },
                { ...record, conversation: { ...conversation, detail: {   ...conversation.detail, timestamp: 123 } } }]) {
                await put(invalid);
                let error = '';
                try { await api.getStoredDomain(identity); } catch (failure) { error = String(failure); }
                failures.push({ error, unchanged: JSON.stringify(await get()) === JSON.stringify(invalid) });
            }
            await put(record);
            let rejectedWrite = '';
            try { await api.saveDomainRequest(fixtureAccount(), { conversation: { ...conversation, detail: {   ...conversation.detail, timestamp: 123 } }, acquisitionHints: {} }); }
            catch (error) { rejectedWrite = String(error); }
            return { failures, rejectedWrite, unchanged: JSON.stringify(await get()) === JSON.stringify(record),
                current: await api.getStoredDomain(identity) };
        } finally { db.close(); }
    });
    expect(result.failures.map(f => f.unchanged)).toEqual([true, true, true, true]);
    expect(result.failures[0].error).toContain('Unsupported Domain storage version');
    expect(result.failures[1].error).toContain('Unsupported Domain storage version');
    expect(result.failures[2].error).toContain('Invalid Domain storage envelope');
    expect(result.failures[3].error).toContain('timestamp');
    expect(result.rejectedWrite).toContain('timestamp');
    expect(result.unchanged).toBe(true);
    expect(result.current.domainVersion).toBe(3);
});

test('restart retains report caution and detects missing image bytes without saved failure state', async ({ page }) => {
    await install(page);
    await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'storageProbe');
        await api.saveDomainRequest(fixtureAccount(), { conversation: { index: { key: fixtureKey(String('report-caution'), 'gemini'),     title: 'Deep Research', titleSource: "provider" }, detail: { key: fixtureKey(String('report-caution'), 'gemini'), quality: { status: 'partial' }, assets: [{ id: 'report', kind: 'file', document: { id: 'source-report', contentMarkdown: '# Report\n\nRetained research body' } },
                { id: 'image', kind: 'image', sourceUri: 'Takeout/missing.png', generation: { imageOrdinal: 0 } }], messages: [{ role: 'assistant', content: [{ type: 'image', assetId: 'image' }], attachmentIds: ['report'], generation: { mediaKind: 'image', outputCount: 1 } }] } }, acquisitionHints: {} });
    });
    await page.reload(); await install(page);
    const result = await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'storageProbe');
        const parsed = await api.getDomainConversationResult('10000000-0000-4000-8000-000000000001', 'report-caution');
        const prepared = await api.preparePdfResources(parsed.conversation.detail, new Set(['image']), parsed.acquisitionHints);
        return { account: fixtureAccount(), conversation: parsed.conversation, quality: parsed.conversation.detail.quality, diagnostics: prepared.diagnostics,
            bytesMissing: !prepared.resources.get('image').ok, failure: prepared.resources.get('image').reason };
    });
    expect(result.conversation.detail.assets[0].document).toEqual({ id: 'source-report', contentMarkdown: '# Report\n\nRetained research body' });
    expect(result.conversation.detail.assets[1]).not.toHaveProperty('failureReason');
    expect(result.conversation.detail.messages[0].generation).toEqual({ mediaKind: 'image', outputCount: 1 });
    expect(result.quality).toEqual({ status: 'partial' });
    expect(result.bytesMissing).toBe(true);
    expect(result.failure).toBeTruthy();
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'RESOURCE_UNAVAILABLE', path: 'asset:image' })]);
});


test('partial native imports retain indexes and aligned source versions through physical reload', async ({ page }) => {
    await install(page);
    await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'storageProbe');
        await chrome.storage.local.set({ gemini_schema_version: 3 });
        await api.StorageService.setConversations('10000000-0000-4000-8000-000000000001', [
            api.indexFixture({ id: 'retained', title: 'Untouched index', updatedAt: 50 }),
            api.indexFixture({ id: 'chat', title: 'RPC metadata', titleSource: 'rpc', updatedAt: 100, cloudAvailability: 'deleted' })
        ]);
        const parsed = { account: fixtureAccount(), sourceVersion: 999999, conversation: { index: { key: fixtureKey(String('chat'), 'gemini'),     title: 'Weaker body title', titleSource: "derived", updatedAt: 999999 }, detail: { key: fixtureKey(String('chat'), 'gemini'), quality: { status: 'complete' }, assets: [], messages: [{ role: 'user', timestamp: 200,
                content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Body retained on disk' }] }] }] } },
            acquisitionHints: {}, resourceHints: {}, diagnostics: [] };
        await api.StorageService.setNativeConversations('10000000-0000-4000-8000-000000000001', [parsed]);
        await api.StorageService.setNativeConversations('10000000-0000-4000-8000-000000000001', []);
    });
    await page.reload(); await install(page);
    const restored = await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'storageProbe');
        return { indexes: await api.StorageService.getConversations('10000000-0000-4000-8000-000000000001'),
            detail: await api.StorageService.conversationRepository({ providerId: 'gemini', accountId: '10000000-0000-4000-8000-000000000001' }).getConversation('chat') };
    });
    expect(restored.indexes.map((row: { key: { conversationId: string } }) => row.key.conversationId)).toEqual(['chat', 'retained']);
    expect(restored.indexes[0]).toMatchObject({ title: 'RPC metadata', updatedAt: 999999 });
    expect(restored.detail.capture.savedAt).toBe(999999);
    expect(restored.detail.detail).not.toHaveProperty('updatedAt');
    expect(restored.detail.detail.messages[0].content[0].children[0].text).toBe('Body retained on disk');
});

test('saved source version survives reload and stays behind a newer Index until the body is refreshed', async ({ page }) => {
    await install(page);
    await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'storageProbe');
        await chrome.storage.local.set({ gemini_schema_version: 3 });
        const parsed = { account: fixtureAccount(), sourceVersion: 1700000000000, conversation: { index: { key: fixtureKey(String('versioned'), 'gemini'),   titleSource: "derived",   title: 'Versioned body' }, detail: { key: fixtureKey(String('versioned'), 'gemini'), quality: { status: 'complete' }, assets: [], messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Old body' }] }] }] } },
            acquisitionHints: {}, resourceHints: {}, diagnostics: [] };
        await api.saveDomainConversation('10000000-0000-4000-8000-000000000001', parsed);
        await api.StorageService.setConversations('10000000-0000-4000-8000-000000000001', [api.indexFixture({ id: 'versioned', title: 'Versioned body', updatedAt: 1700000005000 })]);
        await api.saveDomainConversation('10000000-0000-4000-8000-000000000001', { ...parsed, sourceVersion: 1700000010000, conversation: { index: { ...parsed.conversation.index }, detail: {   ...parsed.conversation.detail, quality: { status: 'partial' } } } });
    });
    await page.reload(); await install(page);
    const old = await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'storageProbe');
        return { record: await api.getStoredDomain(api.storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', 'versioned')), indexes: await api.StorageService.getConversations('10000000-0000-4000-8000-000000000001') };
    });
    expect(old.record.savedAt).toBe(1700000000000);
    expect(old.record.conversation).not.toHaveProperty('updatedAt');
    expect(old.indexes[0].updatedAt).toBe(1700000005000);
    await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'storageProbe');
        const record = await api.getStoredDomain(api.storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', 'versioned'));
        await api.saveDomainConversation('10000000-0000-4000-8000-000000000001', { account: fixtureAccount(), sourceVersion: 1700000005000, conversation: record.conversation, acquisitionHints: {}, resourceHints: {}, diagnostics: [] });
    });
    await page.reload(); await install(page);
    const fresh = await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'storageProbe');
        return api.getStoredDomain(api.storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', 'versioned'));
    });
    expect(fresh.savedAt).toBe(1700000005000);
    expect(fresh.conversation).not.toHaveProperty('updatedAt');
    expect(fresh).not.toHaveProperty('sourceVersion');
});

test('scoped aggregate survives reload with one metadata authority and the actual saved body version', async ({ page }) => {
    await install(page);
    await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'storageProbe');
        await chrome.storage.local.set({ gemini_schema_version: 3 });
        const parsed = { account: fixtureAccount(), sourceVersion: 100, conversation: { index: { key: fixtureKey(String('gateway'), 'gemini'),     title: 'Old title', titleSource: "provider", createdAt: 90,  }, detail: { key: fixtureKey(String('gateway'), 'gemini'), quality: { status: 'unknown' }, assets: [], messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Saved body' }] }] }] } },
            acquisitionHints: {}, resourceHints: {}, diagnostics: [] };
        await api.StorageService.setNativeConversations('10000000-0000-4000-8000-000000000001', [parsed]);
        await api.StorageService.updateConversation('10000000-0000-4000-8000-000000000001', 'gateway', { title: 'Renamed', titleSource: 'provider', createdAt: 50,
            updatedAt: 200 });
        await api.StorageService.setConversations('10000000-0000-4000-8000-000000000002', [{ ...api.indexFixture({ id: 'gateway', title: 'Other account' }), key: { accountId: '10000000-0000-4000-8000-000000000002', conversationId: 'gateway' } }]);
    });
    await page.reload(); await install(page);
    const read = await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'storageProbe');
        const repository = api.StorageService.conversationRepository({ providerId: 'gemini', accountId: '10000000-0000-4000-8000-000000000001' });
        const identity = api.storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', 'gateway');
        const before = await api.getStoredDomain(identity);
        const chromeBefore = await chrome.storage.local.get(null);
        const aggregate = await repository.getConversation('c_gateway');
        const other = await api.StorageService.conversationRepository({ providerId: 'gemini', accountId: '10000000-0000-4000-8000-000000000002' }).getConversation('gateway');
        return { before, after: await api.getStoredDomain(identity), chromeBefore, chromeAfter: await chrome.storage.local.get(null),
            aggregate, other, absent: await repository.getConversation('missing') };
    });
    expect(read.aggregate.index).toMatchObject({ title: 'Renamed', createdAt: 50, updatedAt: 200 });
    expect(Object.keys(read.aggregate.detail).sort()).toEqual(['assets', 'key', 'messages', 'quality', 'savedAt']);
    expect(read.aggregate.detail.messages[0].content[0].children[0].text).toBe('Saved body');
    expect(read.aggregate.capture.savedAt).toBe(100);
    expect(read.aggregate.index).toMatchObject({ title: 'Renamed', createdAt: 50 });
    expect(read.before.conversation.index.title).toBe('Old title');
    expect(read.after).toEqual(read.before);
    expect(read.chromeAfter).toEqual(read.chromeBefore);
    expect(read.other.index.title).toBe('Other account');
    expect(read.other).not.toHaveProperty('detail');
    expect(read.absent).toBeNull();
});

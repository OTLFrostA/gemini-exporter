import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import * as path from 'node:path';

let bundle: string;
test.beforeAll(async () => {
    const output = await build({ stdin: { contents: `
        import * as store from './src/core/storage/domain/domainStore.ts';
        import { migrate, CURRENT_SCHEMA_VERSION } from './src/core/storage/schemaMigration.ts';
        import { saveConversationDetail, getConversationDetail } from './src/core/storage/conversationDetailStore.ts';
        import * as StorageService from './src/core/storage/storageService.ts';
        import { getDomainConversationResult } from './src/core/storage/domain/nativePersistence.ts';
        import { AssetPipeline } from './src/core/engine/assetPipeline.ts';
        import { formatMarkdownDocument } from './src/core/engine/chatFormatter.ts';
        globalThis.storageProbe = { ...store, migrate, CURRENT_SCHEMA_VERSION, saveConversationDetail, getConversationDetail, StorageService, getDomainConversationResult, AssetPipeline, formatMarkdownDocument };
    `, resolveDir: path.resolve(__dirname, '../..'), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife' });
    bundle = output.outputFiles[0].text;
});
test.beforeEach(async ({ page }) => {
    await page.route('https://storage.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Storage contract</body></html>' }));
    await page.goto('https://storage.test/');
});
async function install(page: import('@playwright/test').Page): Promise<void> {
    await page.addScriptTag({ content: `
        globalThis.chrome = { storage: { local: {
            async get(keys) { const all = JSON.parse(localStorage.getItem('chrome-local') || '{}'); if (!keys) return all; return Object.fromEntries((typeof keys === 'string' ? [keys] : keys).map(k => [k, all[k]])); },
            async set(values) { const all = await this.get(null); localStorage.setItem('chrome-local', JSON.stringify({...all, ...values})); },
            async remove(keys) { const all = await this.get(null); for (const k of typeof keys === 'string' ? [keys] : keys) delete all[k]; localStorage.setItem('chrome-local', JSON.stringify(all)); }
        }, session: { async get() { return {}; }, async set() {} } } };
    ` });
    await page.addScriptTag({ content: bundle });
}

test('history cleanup upgrades v1 atomically and retains current, cached bytes and legacy backups after restart', async ({ page }) => {
    // Seed the released disk layout before any new-code database access.
    const seeded = await page.evaluate(async () => {
        const key = JSON.stringify(['gemini', 'u0', 'upgrade']);
        const record = { key, storageVersion: 2, domainVersion: 1,
            identity: { providerId: 'gemini', accountSlot: 'u0', conversationId: 'upgrade' },
            origin: 'source', revision: 'old-current', savedAt: 1, acquisitionHints: {}, resources: [],
            conversation: { providerId: 'gemini', id: 'upgrade', title: 'Keep current', timestamp: 1,
                completeness: { status: 'complete' },
                assets: [{ id: 'asset', kind: 'image', source: { uri: 'Takeout/kept.png' } }],
                messages: [{ role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Complete persisted body' }] }, { type: 'image', assetId: 'asset' }] }] } };
        await new Promise<void>((resolve, reject) => {
            const req = indexedDB.open('gemini_exporter_domain', 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                db.createObjectStore('conversations', { keyPath: 'key' }).put(record);
                const history = db.createObjectStore('revisions', { keyPath: 'revision' });
                history.createIndex('conversation', 'key');
                for (let i = 0; i < 120; i++) history.put({ ...record, revision: `old-${i}`,
                    resources: [{ assetId: 'asset', bytes: new Uint8Array(256 * 1024).fill(i) }] });
                const cache = db.createObjectStore('resource_bytes', { keyPath: 'key' });
                cache.createIndex('conversation', 'conversationKey');
                cache.put({ key: JSON.stringify([key, 'asset', 'Takeout/kept.png']), conversationKey: key,
                    assetId: 'asset', sourceUri: 'Takeout/kept.png', bytes: new Uint8Array([7, 8, 9]) });
                db.createObjectStore('legacy_imports', { keyPath: 'key' }).put({ key: 'original', value: { body: 'Legacy recovery copy' }, savedAt: 1 });
                db.createObjectStore('removed_conversations', { keyPath: 'key' }).put({ key: 'removed-account-chat', removedAt: 1 });
            };
            req.onsuccess = () => { req.result.close(); resolve(); }; req.onerror = () => reject(req.error);
        });
        return record;
    });
    await install(page);
    const rolledBack = await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'storageProbe');
        const original = IDBDatabase.prototype.deleteObjectStore;
        IDBDatabase.prototype.deleteObjectStore = function (name) {
            original.call(this, name);
            if (name === 'revisions') this.createObjectStore('__cleanup_abort_probe').transaction.abort();
        };
        let failed = false;
        try { const db = await api.openDomainDB(); db.close(); } catch { failed = true; }
        finally { IDBDatabase.prototype.deleteObjectStore = original; }
        return new Promise<{ failed: boolean; version: number; snapshots: number; backups: number }>((resolve, reject) => {
            const req = indexedDB.open('gemini_exporter_domain', 1);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction(['revisions', 'legacy_imports'], 'readonly');
                const snapshots = tx.objectStore('revisions').count(), backups = tx.objectStore('legacy_imports').count();
                tx.oncomplete = () => { db.close(); resolve({ failed, version: db.version, snapshots: snapshots.result, backups: backups.result }); };
                tx.onabort = tx.onerror = () => reject(tx.error);
            };
        });
    });
    expect(rolledBack).toEqual({ failed: true, version: 1, snapshots: 120, backups: 1 });
    const upgraded = await page.evaluate(async () => {
        const db = await Reflect.get(globalThis, 'storageProbe').openDomainDB();
        const result = { version: db.version, names: [...db.objectStoreNames] }; db.close(); return result;
    });
    expect(upgraded.version).toBe(2);
    expect(upgraded.names).toEqual(['conversations', 'legacy_imports', 'removed_conversations', 'resource_bytes']);
    await page.reload(); await install(page);
    const restored = await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'storageProbe');
        const identity = api.storageIdentity('gemini', 'u0', 'upgrade');
        const current = await api.getStoredDomain(identity);
        const shorter = api.storedParseResult(current);
        shorter.conversation.messages = [];
        shorter.conversation.updatedAt = 100;
        shorter.conversation.completeness = { status: 'partial' };
        await api.saveDomainConversation('u0', shorter);
        const db = await api.openDomainDB();
        const backups = await new Promise<unknown[]>((resolve, reject) => {
            const tx = db.transaction('legacy_imports', 'readonly'), req = tx.objectStore('legacy_imports').getAll();
            tx.oncomplete = () => resolve(req.result); tx.onabort = tx.onerror = () => reject(tx.error);
        }); db.close();
        const bytes = [...await api.getDomainResource(identity, 'asset')];
        const kept = await api.getStoredDomain(identity);
        await api.removeStoredDomain(identity);
        const deleted = await api.getStoredDomain(identity);
        const cleanDB = await api.openDomainDB();
        const cacheCount = await new Promise<number>((resolve, reject) => {
            const tx = cleanDB.transaction('resource_bytes', 'readonly'), req = tx.objectStore('resource_bytes').count();
            tx.oncomplete = () => resolve(req.result); tx.onabort = tx.onerror = () => reject(tx.error);
        }); cleanDB.close();
        return { current, kept, backups, bytes, deleted, cacheCount };
    });
    expect(restored.current).toEqual(seeded);
    expect(restored.kept.conversation).toEqual(seeded.conversation);
    expect(restored.backups).toEqual([{ key: 'original', value: { body: 'Legacy recovery copy' }, savedAt: 1 }]);
    expect(restored.bytes).toEqual([7, 8, 9]);
    expect(restored.deleted).toBeNull();
    expect(restored.cacheCount).toBe(0);
});
// Probe code runs in the browser against its real IndexedDB and survives actual page reloads.
test('v1 disk migration joins metadata/body, survives restart and exports native content', async ({ page }) => {
    await install(page);
    const result = await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'storageProbe');
        await chrome.storage.local.set({ gemini_schema_version: 1, gemini_conversations: [{ id: 'c_old', title: 'Legacy title', timestamp: 1700000000000, messageCount: 2 }] });
        await api.saveConversationDetail('old', { messages: [{ role: 'user', content: 'Question' }, { role: 'model', model: 'Remembered model', content: '**Remembered answer**', thoughts: 'Remembered reasoning' }] });
        return api.migrate();
    });
    expect(result).toEqual({ ok: true, frozen: false });
    await page.reload(); await install(page);
    const restored = await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'storageProbe');
        const view = await api.getDomainConversationResult('u0', 'old');
        const markdown = await api.formatMarkdownDocument(view);
        return { version: (await chrome.storage.local.get(['gemini_schema_version'])).gemini_schema_version, conversation: view.conversation, markdown: markdown.content };
    });
    expect(restored.version).toBe(2);
    expect(restored.conversation.messages).toHaveLength(2);
    expect(restored.conversation.messages[1].model).toBe('Remembered model');
    expect(restored.conversation.messages[1].reasoning).toBeTruthy();
    expect(restored.markdown).toContain('Remembered answer');
    expect(restored.markdown).toContain('Remembered model');
});

test('aborted actual IDB transaction withholds schema stamp and retries without damaging v1', async ({ page }) => {
    await install(page);
    const failed = await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'storageProbe');
        const metadata = [{ id: 'retry', title: 'Retry', timestamp: 1 }];
        await chrome.storage.local.set({ gemini_schema_version: 1, gemini_conversations: metadata });
        await api.saveConversationDetail('retry', { messages: [{ role: 'user', content: 'Keep original body' }] });
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
            if (this.name === 'conversations') throw new DOMException('Injected quota failure', 'QuotaExceededError');
            return original.apply(this, args);
        };
        let result;
        try { result = await api.migrate(); } finally { IDBObjectStore.prototype.put = original; }
        return { result, legacy: await chrome.storage.local.get(['gemini_schema_version', 'gemini_conversations']), native: await api.getStoredDomain(api.storageIdentity('gemini', 'u0', 'retry')) };
    });
    expect(failed.result.ok).toBe(false);
    expect(failed.legacy.gemini_schema_version).toBe(1);
    expect(failed.legacy.gemini_conversations).toEqual([{ id: 'retry', title: 'Retry', timestamp: 1 }]);
    expect(failed.native).toBeNull();
    const retried = await page.evaluate(async () => Reflect.get(globalThis, 'storageProbe').migrate());
    expect(retried).toEqual({ ok: true, frozen: false });
});

test('durable attachment bytes remain outside Domain and are acquired offline after restart', async ({ page }) => {
    await install(page);
    await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'storageProbe');
        await chrome.storage.local.set({ gemini_schema_version: 2 });
        await api.saveDomainConversation('u0', { conversation: { providerId: 'gemini', id: 'offline', title: 'Offline', timestamp: null, assets: [{ id: 'image', kind: 'image', source: { uri: 'Takeout/source.png' } }], messages: [{ role: 'assistant', content: [{ type: 'image', assetId: 'image' }] }] }, resourceHints: {}, acquisitionHints: {}, diagnostics: [] }, [{ assetId: 'image', sourcePath: 'Takeout/source.png', bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]) }]);
    });
    await page.reload(); await install(page);
    const restored = await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'storageProbe');
        const view = await api.getDomainConversationResult('u0', 'offline');
        const pipeline = new api.AssetPipeline({ currentSlot: 'u0', fetchAsset: async () => { throw new Error('Network must not be needed'); } });
        const bytes = await pipeline.acquireAssetBytes({ assetId: view.conversation.assets[0].id, url: view.conversation.assets[0].source.uri }, { id: 'offline', title: 'Offline' });
        return { bytes: [...bytes.bytes], conversation: view.conversation };
    });
    expect(restored.bytes).toEqual([137, 80, 78, 71, 13, 10, 26, 10, 1]);
    expect(JSON.stringify(restored.conversation)).not.toMatch(/bytes|dataBuffer|archivePath|localName/);
});

test('online byte cache survives restart, deletion erases bytes and a late migration cannot restore the body', async ({ page }) => {
    await install(page);
    await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'storageProbe');
        const parsed = { conversation: { providerId: 'gemini', id: 'cached', title: 'Cached', timestamp: null, assets: [{ id: 'asset', kind: 'image', source: { uri: 'https://example.test/image' } }], messages: [{ role: 'assistant', content: [{ type: 'image', assetId: 'asset' }] }] }, acquisitionHints: {}, resourceHints: {}, diagnostics: [] };
        await api.saveDomainConversation('u0', parsed);
        await api.cacheDomainResource(api.storageIdentity('gemini', 'u0', 'cached'), 'asset', 'https://example.test/image', new Uint8Array([1, 2, 3]));
    });
    await page.reload(); await install(page);
    const result = await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'storageProbe');
        const identity = api.storageIdentity('gemini', 'u0', 'cached');
        const record = await api.getStoredDomain(identity);
        const bytes = await api.getDomainResource(identity, 'asset');
        await api.removeStoredDomain(identity);
        const late = await api.saveDomainConversation('u0', api.storedParseResult(record), [], true);
        const removed = await api.getStoredDomain(identity);
        await api.saveDomainConversation('u0', api.storedParseResult(record));
        return { bytes: [...bytes], late, removed, restoredBytes: await api.getDomainResource(identity, 'asset') };
    });
    expect(result).toEqual({ bytes: [1, 2, 3], late: null, removed: null, restoredBytes: null });
});

for (const method of ['remove', 'reconcile'] as const) {
    for (const failure of ['domain', 'legacy', 'exports'] as const) {
        test(`${method} retries ${failure} deletion failure after list removal and restart`, async ({ page }) => {
            await install(page);
            const failed = await page.evaluate(async ({ method, failure }) => {
                const api = Reflect.get(globalThis, 'storageProbe');
                const parsed = {
                    conversation: { providerId: 'gemini', id: 'retry-delete', title: 'Delete', timestamp: null,
                        assets: [{ id: 'archive', kind: 'image', source: { uri: 'Takeout/source.png' } },
                            { id: 'online', kind: 'image', source: { uri: 'https://example.test/online.png' } }],
                        messages: [{ role: 'assistant', content: [{ type: 'image', assetId: 'archive' }, { type: 'image', assetId: 'online' }] }] },
                    acquisitionHints: {}, resourceHints: {}, diagnostics: []
                };
                await chrome.storage.local.set({ gemini_schema_version: 2,
                    gemini_conversations: [{ id: 'c_retry-delete', title: 'Delete' }],
                    gemini_conversations_u1: [{ id: 'retry-delete', title: 'Other account' }],
                    exportedIds: { 'retry-delete': { timestamp: 1 }, 'c_retry-delete': { timestamp: 1 }, keep: { timestamp: 1 } },
                    gemini_exported_u1: { 'retry-delete': { timestamp: 2 } }
                });
                await api.saveDomainConversation('u0', parsed, [{ assetId: 'archive', bytes: new Uint8Array([1, 2, 3]) }]);
                parsed.conversation.title = 'New revision';
                await api.saveDomainConversation('u0', parsed);
                await api.saveDomainConversation('u1', parsed, [{ assetId: 'archive', bytes: new Uint8Array([4, 5]) }]);
                for (const slot of ['u0', 'u1']) await api.cacheDomainResource(api.storageIdentity('gemini', slot, 'retry-delete'), 'online', 'https://example.test/online.png', new Uint8Array([6, 7]));
                await api.saveConversationDetail('retry-delete', { messages: [{ role: 'user', content: 'Legacy body' }] });
                const originalDelete = IDBObjectStore.prototype.delete;
                const originalSet = chrome.storage.local.set.bind(chrome.storage.local);
                IDBObjectStore.prototype.delete = function (...args) {
                    if ((failure === 'domain' && this.transaction.db.name === 'gemini_exporter_domain' && this.name === 'conversations')
                        || (failure === 'legacy' && this.name === 'conversation_details')) {
                        throw new DOMException('Injected deletion failure', 'UnknownError');
                    }
                    return originalDelete.apply(this, args);
                };
                chrome.storage.local.set = async function (values) {
                    if (failure === 'exports' && 'exportedIds' in values) throw new Error('Injected export-record deletion failure');
                    return originalSet(values);
                };
                let error = '';
                try {
                    if (method === 'remove') await api.StorageService.removeConversation('u0', 'c_retry-delete');
                    else await api.StorageService.reconcileConversations('u0', []);
                } catch (e) { error = String(e); }
                finally { IDBObjectStore.prototype.delete = originalDelete; chrome.storage.local.set = originalSet; }
                return {
                    error,
                    local: await chrome.storage.local.get(['gemini_conversations', 'gemini_pending_deletions_u0']),
                    native: await api.getStoredDomain(api.storageIdentity('gemini', 'u0', 'retry-delete')),
                    legacy: await api.getConversationDetail('retry-delete')
                };
            }, { method, failure });
            expect(failed.error).toContain('Injected');
            expect(failed.local.gemini_conversations).toEqual([]);
            expect(failed.local.gemini_pending_deletions_u0).toEqual(['retry-delete']);
            if (failure === 'domain') expect(failed.native).not.toBeNull();
            else expect(failed.native).toBeNull();
            if (failure !== 'exports') expect(failed.legacy).not.toBeNull();

            // Retry from a new JS context: recovery must use disk intent, not the list or memory.
            await page.reload(); await install(page);
            const cleaned = await page.evaluate(async method => {
                const api = Reflect.get(globalThis, 'storageProbe');
                const result = method === 'remove'
                    ? await api.StorageService.removeConversation('u0', 'retry-delete')
                    : await api.StorageService.reconcileConversations('u0', []);
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
                    ? await api.StorageService.removeConversation('u0', 'c_retry-delete')
                    : await api.StorageService.reconcileConversations('u0', []);
                return { result, repeat, stores,
                    local: await chrome.storage.local.get(['gemini_conversations', 'gemini_pending_deletions_u0', 'gemini_last_count', 'gemini_account_slots', 'exportedIds', 'gemini_exported_u1']),
                    legacy: await api.getConversationDetail('retry-delete'),
                    otherArchive: [...await api.getDomainResource(api.storageIdentity('gemini', 'u1', 'retry-delete'), 'archive')],
                    otherOnline: [...await api.getDomainResource(api.storageIdentity('gemini', 'u1', 'retry-delete'), 'online')]
                };
            }, method);
            expect(cleaned.result).toEqual(method === 'remove' ? false : { kept: 0, removed: 1, removedIds: ['retry-delete'] });
            expect(cleaned.repeat).toEqual(method === 'remove' ? false : { kept: 0, removed: 0, removedIds: [] });
            expect(cleaned.local.gemini_conversations).toEqual([]);
            expect(cleaned.local.gemini_pending_deletions_u0).toEqual([]);
            expect(cleaned.local.gemini_last_count).toBe(0);
            expect(cleaned.local.gemini_account_slots).toMatchObject({ u0: { count: 0 } });
            expect(cleaned.local.exportedIds).toEqual({ keep: { timestamp: 1 } });
            expect(cleaned.local.gemini_exported_u1).toEqual({ 'retry-delete': { timestamp: 2 } });
            expect(cleaned.legacy).toBeNull();
            // Only the other account survives in current and cached bytes.
            expect(cleaned.stores.conversations).toHaveLength(1);
            expect(cleaned.stores.resource_bytes).toHaveLength(2); // imported and downloaded bytes both live in the selected account cache
            expect(cleaned.stores.removed_conversations).toHaveLength(1);
            expect(cleaned.stores.removed_conversations[0]).toMatchObject({ key: JSON.stringify(['gemini', 'u0', 'retry-delete']) });
            expect(cleaned.otherArchive).toEqual([4, 5]);
            expect(cleaned.otherOnline).toEqual([6, 7]);
        });
    }
}

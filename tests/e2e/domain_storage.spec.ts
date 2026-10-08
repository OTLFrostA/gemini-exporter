import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import * as path from 'node:path';

let bundle: string;
test.beforeAll(async () => {
    const output = await build({ stdin: { contents: `
        import * as store from './src/core/storage/domain/domainStore.ts';
        import { migrate, CURRENT_SCHEMA_VERSION } from './src/core/storage/schemaMigration.ts';
        import { saveConversationDetail } from './src/core/storage/conversationDetailStore.ts';
        import { getDomainConversationView } from './src/core/storage/domain/nativePersistence.ts';
        import { AssetPipeline } from './src/core/engine/assetPipeline.ts';
        import { formatMarkdownDocument } from './src/core/engine/chatFormatter.ts';
        globalThis.storageProbe = { ...store, migrate, CURRENT_SCHEMA_VERSION, saveConversationDetail, getDomainConversationView, AssetPipeline, formatMarkdownDocument };
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
        const view = await api.getDomainConversationView('u0', 'old');
        const markdown = await api.formatMarkdownDocument(view);
        return { version: (await chrome.storage.local.get(['gemini_schema_version'])).gemini_schema_version, conversation: view.parsed.conversation, markdown: markdown.content };
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
            if (this.name === 'revisions') throw new DOMException('Injected quota failure', 'QuotaExceededError');
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
        const view = await api.getDomainConversationView('u0', 'offline');
        const pipeline = new api.AssetPipeline({ currentSlot: 'u0', fetchAsset: async () => { throw new Error('Network must not be needed'); } });
        const bytes = await pipeline.acquireAssetBytes(view.messages[0].attachments[0], { id: 'offline', title: 'Offline' });
        return { bytes: [...bytes.bytes], conversation: view.parsed.conversation };
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

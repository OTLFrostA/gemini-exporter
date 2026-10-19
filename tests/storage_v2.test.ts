import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from '@playwright/test';
import { buildSync } from 'esbuild';
import type * as Storage from '../src/core/storage/storageService.js';
import type { GlobalSettings } from '../src/core/application/settings/index.js';

declare global {
    interface Window {
        storage: typeof Storage;
        settingsData: Record<string, Partial<GlobalSettings>>;
        settingsChanges: unknown[];
        failSettings: boolean;
    }
}
let browser: Browser;
let page: Page;
const bundle = buildSync({ entryPoints: ['src/core/storage/storageService.ts'], bundle: true,
    format: 'iife', globalName: 'storage', write: false }).outputFiles[0].text;

before(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.route('http://localhost/storage-test', route => route.fulfill({ body: '<html></html>', contentType: 'text/html' }));
    await page.goto('http://localhost/storage-test');
});
after(async () => { await browser?.close(); });
beforeEach(async () => {
    await page.reload();
    await page.evaluate(async () => {
        await new Promise<void>((resolve, reject) => {
            const request = indexedDB.deleteDatabase('gemini_exporter_v2');
            request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
        });
        window.settingsData = {}; window.settingsChanges = []; window.failSettings = false;
        const listeners: ((changes: unknown, area: string) => void)[] = [];
        Object.defineProperty(window, 'chrome', { configurable: true, value: { storage: {
            onChanged: { addListener: (listener: (changes: unknown, area: string) => void) => listeners.push(listener) },
            local: {
                get: async (key: string) => {
                    if (window.failSettings) throw new Error('settings I/O');
                    return structuredClone({ [key]: window.settingsData[key] });
                },
                set: async (updates: Record<string, Partial<GlobalSettings>>) => {
                    if (window.failSettings) throw new Error('settings I/O');
                    for (const [key, value] of Object.entries(updates)) {
                        const change = { [key]: { oldValue: window.settingsData[key], newValue: structuredClone(value) } };
                        window.settingsData[key] = structuredClone(value);
                        for (const listener of listeners) listener(change, 'local');
                    }
                }
            }
        } } });
        chrome.storage.onChanged.addListener((changes, area) => window.settingsChanges.push({ changes, area }));
    });
    await page.addScriptTag({ content: bundle });
});

test('storage v2 initializes exactly six stores and only the specified indexes', async () => {
    const result = await page.evaluate(async () => {
        await window.storage.listAccounts();
        const db = await new Promise<IDBDatabase>(resolve => {
            const request = indexedDB.open('gemini_exporter_v2'); request.onsuccess = () => resolve(request.result);
        });
        const stores = Array.from(db.objectStoreNames);
        const tx = db.transaction(stores);
        const layout = stores.map(name => {
            const store = tx.objectStore(name);
            return { name, keyPath: store.keyPath, indexes: Array.from(store.indexNames) };
        });
        const version = db.version; db.close();
        return { version, layout, chromeKeys: Object.keys(window.settingsData) };
    });
    assert.deepEqual(result, { version: 1, chromeKeys: [], layout: [
        { name: 'accounts', keyPath: 'id', indexes: ['providerIdentity'] },
        { name: 'coverage', keyPath: ['accountId', 'streamId'], indexes: [] },
        { name: 'details', keyPath: ['key.accountId', 'key.conversationId'], indexes: [] },
        { name: 'directoryHandles', keyPath: null, indexes: [] },
        { name: 'exportRecords', keyPath: ['accountId', 'conversationId'], indexes: ['byAccount'] },
        { name: 'indexes', keyPath: ['key.accountId', 'key.conversationId'], indexes: ['byAccount'] }
    ] });
});

test('storage v2 missing values use the frozen null/list/map defaults', async () => {
    assert.deepEqual(await page.evaluate(async () => {
        const s = window.storage, key = { accountId: 'a', conversationId: 'missing' };
        return Promise.all([s.getAccount('a'), s.listAccounts(), s.getIndex(key), s.listIndexes('a'),
            s.getDetail(key), s.getCoverage('a', 'recent'), s.getExportRecord(key), s.listExportRecords('a'),
            s.getStoredSettings(), s.getDirectoryHandle()]);
    }), [null, [], null, [], null, null, null, {}, {}, null]);
});

test('storage v2 atomic account insertion reuses the identity and leaves profile choices to L2', async () => {
    const result = await page.evaluate(async () => {
        const s = window.storage;
        const account = { id: 'a', providerId: 'gemini', providerAccountId: 'subject', displayName: 'first' };
        const inserted = await Promise.all([s.insertAccountIfAbsent(account),
            s.insertAccountIfAbsent({ ...account, id: 'b', displayName: 'later' })]);
        await s.putAccount({ ...account, displayName: 'selected' });
        await s.insertAccountIfAbsent({ ...account, id: 'c', providerId: 'other' });
        let failed = false;
        try { await s.putAccount({ ...account, id: 'duplicate' }); } catch { failed = true; }
        return { inserted, current: await s.getAccount('a'), accounts: (await s.listAccounts()).length, failed };
    });
    assert.deepEqual(result.inserted.map(a => a.id), ['a', 'a']);
    assert.deepEqual(result.inserted.map(a => a.displayName), ['first', 'first']);
    assert.equal(result.current?.displayName, 'selected');
    assert.equal(result.accounts, 2); assert.equal(result.failed, true);
});

test('storage v2 batch indexes isolate accounts, replace without merge, and never manufacture details', async () => {
    const result = await page.evaluate(async () => {
        const s = window.storage, key = { accountId: 'a', conversationId: 'same' };
        await s.putIndexes([{ key, title: 'old', titleSource: 'provider', updatedAt: 100 },
            { key: { ...key, accountId: 'b' }, title: 'other', titleSource: 'provider' },
            { key: { ...key, conversationId: 'second' } }]);
        await s.putIndexes([{ key, title: 'accepted', titleSource: 'derived', updatedAt: 1 }]);
        await s.putIndexes([]);
        return { index: await s.getIndex(key), a: (await s.listIndexes('a')).length,
            b: (await s.listIndexes('b'))[0].title, detail: await s.getDetail(key) };
    });
    assert.deepEqual(result, { index: { key: { accountId: 'a', conversationId: 'same' }, title: 'accepted', titleSource: 'derived', updatedAt: 1 }, a: 2, b: 'other', detail: null });
});

test('storage v2 failed batch aborts all writes and propagates I/O errors', async () => {
    assert.deepEqual(await page.evaluate(async () => {
        const s = window.storage;
        let failed = false;
        try { await s.putIndexes([{ key: { accountId: 'a', conversationId: 'valid' } },
            { key: { accountId: 'a', conversationId: undefined! } }]); } catch { failed = true; }
        const indexes = await s.listIndexes('a');
        const original = indexedDB.open;
        indexedDB.open = () => { throw new Error('IDB I/O'); };
        let readFailed = false;
        try { await s.getAccount('a'); } catch { readFailed = true; }
        indexedDB.open = original;
        return { failed, indexes, readFailed };
    }), { failed: true, indexes: [], readFailed: true });
});

test('storage v2 details are exact snapshots; single deletes do not cascade', async () => {
    const result = await page.evaluate(async () => {
        const s = window.storage, key = { accountId: 'a', conversationId: 'same' };
        const detail = { key, messages: [], assets: [{ id: 'image', kind: 'image' as const, sourceUri: 'https://source.test/image' }], quality: { status: 'unknown' as const }, savedAt: 100 };
        await s.putIndexes([{ key }]); await s.putDetail(detail);
        await s.putCoverage('a', 'recent', { range: null });
        await s.putExportRecord(key, { exportedAt: 1, format: 'markdown', status: 'ok' });
        await s.deleteIndex(key);
        const preserved = await s.getDetail(key);
        await s.putDetail({ ...detail, savedAt: 1, assets: [] });
        const replaced = await s.getDetail(key);
        await s.deleteDetail(key);
        return { preserved, replaced, removed: await s.getDetail(key), index: await s.getIndex(key),
            record: await s.getExportRecord(key), coverage: await s.getCoverage('a', 'recent') };
    });
    assert.equal(result.preserved?.assets.length, 1);
    assert.equal(result.replaced?.savedAt, 1); assert.deepEqual(result.replaced?.assets, []);
    assert.equal(result.removed, null); assert.equal(result.index, null);
    assert.equal(result.record?.status, 'ok'); assert.deepEqual(result.coverage, { range: null });
});

test('storage v2 coverage and export records are keyed, isolated, replaced, and explicitly deleted', async () => {
    const result = await page.evaluate(async () => {
        const s = window.storage, key = { accountId: 'a', conversationId: '__proto__' };
        await s.putIndexes([{ key }]);
        await s.putCoverage('a', 'recent', { range: { head: { id: 'h', time: 10 }, tail: { id: 't', time: 1 } } });
        await s.putCoverage('a', 'recent', { range: null });
        await s.putCoverage('a', 'archive', { range: null }); await s.putCoverage('b', 'recent', { range: null });
        await s.putExportRecord(key, { exportedAt: 1, format: 'markdown', status: 'ok', chatTime: 5 });
        await s.putExportRecord(key, { exportedAt: 2, format: 'html', status: 'partial' });
        await s.putExportRecord({ ...key, accountId: 'b' }, { exportedAt: 3, format: 'json', status: 'ok' });
        const records = await s.listExportRecords('a'), coverage = await s.getCoverage('a', 'recent');
        await s.deleteCoverage('a', 'recent'); await s.deleteExportRecord(key);
        return { records: Object.entries(records), coverage, deleted: await s.getCoverage('a', 'recent'), record: await s.getExportRecord(key),
            archive: await s.getCoverage('a', 'archive'), other: await s.getExportRecord({ ...key, accountId: 'b' }), index: await s.getIndex(key) };
    });
    assert.deepEqual(result.records, [['__proto__', { exportedAt: 2, format: 'html', status: 'partial' }]]);
    assert.deepEqual(result.coverage, { range: null }); assert.equal(result.deleted, null); assert.equal(result.record, null);
    assert.deepEqual(result.archive, { range: null }); assert.equal(result.other?.format, 'json'); assert.ok(result.index);
});

test('storage v2 settings patch preserves false, omitted fields, and native change notification', async () => {
    const result = await page.evaluate(async () => {
        const s = window.storage;
        await s.patchStoredSettings({ includeAssets: true, enabledDisk: true, language: 'zh' });
        await s.patchStoredSettings({ includeAssets: false, enabledDisk: false });
        const settings = await s.getStoredSettings();
        window.failSettings = true;
        let readFailed = false, writeFailed = false;
        try { await s.getStoredSettings(); } catch { readFailed = true; }
        try { await s.patchStoredSettings({ includeAssets: true }); } catch { writeFailed = true; }
        return { settings, changes: window.settingsChanges, keys: Object.keys(window.settingsData), readFailed, writeFailed };
    });
    assert.deepEqual(result.settings, { includeAssets: false, enabledDisk: false, language: 'zh' });
    assert.deepEqual(result.keys, ['gemini_exporter_v2_settings']); assert.equal(result.changes.length, 2);
    assert.equal(result.readFailed, true); assert.equal(result.writeFailed, true);
});

test('storage v2 real directory handles survive a context reload without permission state or memory fallback', async () => {
    await page.evaluate(async () => {
        const directory = await navigator.storage.getDirectory();
        await window.storage.setDirectoryHandle(await directory.getDirectoryHandle('first', { create: true }));
        await window.storage.setDirectoryHandle(await directory.getDirectoryHandle('selected', { create: true }));
    });
    await page.reload(); await page.addScriptTag({ content: bundle });
    assert.deepEqual(await page.evaluate(async () => {
        const handle = await window.storage.getDirectoryHandle();
        await window.storage.clearDirectoryHandle();
        return { kind: handle?.kind, name: handle?.name, cleared: await window.storage.getDirectoryHandle() };
    }), { kind: 'directory', name: 'selected', cleared: null });
});

test('storage v2 account clear removes orphans and all streams while preserving identity, settings, handle, other accounts', async () => {
    const result = await page.evaluate(async () => {
        const s = window.storage;
        await s.putAccount({ id: 'a', providerId: 'gemini', providerAccountId: 'subject' });
        await s.patchStoredSettings({ includeAssets: false });
        await s.setDirectoryHandle(await navigator.storage.getDirectory());
        for (const accountId of ['a', 'b']) {
            const key = { accountId, conversationId: 'orphan' };
            await s.putIndexes([{ key: { accountId, conversationId: 'index-only' } }]);
            await s.putDetail({ key, messages: [], assets: [], quality: { status: 'unknown' } });
            await s.putExportRecord(key, { exportedAt: 1, format: 'markdown', status: 'ok' });
            for (const stream of ['recent', 'archive']) await s.putCoverage(accountId, stream, { range: null });
        }
        await s.clearStoredAccountData('a');
        const a = { accountId: 'a', conversationId: 'orphan' }, b = { ...a, accountId: 'b' };
        return { cleared: await Promise.all([s.listIndexes('a'), s.getDetail(a), s.listExportRecords('a'),
            s.getCoverage('a', 'recent'), s.getCoverage('a', 'archive')]),
            retained: [!!await s.getAccount('a'), !!await s.getDirectoryHandle(), (await s.getStoredSettings()).includeAssets,
                (await s.listIndexes('b')).length, !!await s.getDetail(b), !!await s.getExportRecord(b),
                !!await s.getCoverage('b', 'recent'), !!await s.getCoverage('b', 'archive')] };
    });
    assert.deepEqual(result.cleared, [[], null, {}, null, null]);
    assert.deepEqual(result.retained, [true, true, false, 1, true, true, true, true]);
});

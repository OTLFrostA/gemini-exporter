import { describe as __suiteDescribe } from 'node:test';
import test from "node:test";
import assert from "node:assert/strict";
import * as storage from "../src/l3a/storageService.js";
import { putExportRecords } from "../src/l3a/exportRecordStore.js";
import { useStorageUnitEnvironment as useIndexStorage } from "./helpers/l3aStorageUnitEnvironment.js";
import { fixtureKey } from "./helpers/domainFixture.js";
import { openStorageDB } from "../src/l3a/idb.js";
import { isDirectoryHandle } from "../src/shared/types/directoryHandle.js";
import { storageUnitEnvironment as indexStorage } from "./helpers/l3aStorageUnitEnvironment.js";
import { useStorageUnitEnvironment } from "./helpers/l3aStorageUnitEnvironment.js";
import { type ConversationIndex } from "../src/l2/conversationIndex.js";
import { type ConversationDetail } from "../src/l2/conversationDetail.js";
import { type GlobalSettings } from "../src/application/settings/index.js";
import { patchStoredSettings } from "../src/l3a/storageService.js";
import { getStoredSettings } from "../src/l3a/storageService.js";
import { IDBObjectStore } from "fake-indexeddb";

__suiteDescribe("storage_service", () => {
useIndexStorage();
test('compound storage keys partition identical provider IDs by Account UUID', async () => {
    const key = fixtureKey('same'), other = { ...key, accountId: '20000000-0000-4000-8000-000000000002' };
    await storage.putIndexes([{ key, title: 'First', titleSource: 'provider' }, { key: other, title: 'Second', titleSource: 'provider' }]);
    assert.equal((await storage.getIndex(key))?.title, 'First');
    assert.equal((await storage.listIndexes(other.accountId))[0].title, 'Second');
});
test('storage never infers deletions from an incoming page or migration batch', async () => {
    const key = fixtureKey('older'), next = fixtureKey('newer');
    await storage.putIndexes([{ key }]);
    await storage.putIndexes([{ key: next }]);
    await storage.putIndexes([]);
    assert.equal((await storage.listIndexes(key.accountId)).length, 2);
});
test('Settings patches persist exactly the caller-supplied v2 values', async () => {
    assert.deepEqual(await storage.getStoredSettings(), {});
    await storage.patchStoredSettings({ defaultFormat: 'markdown', skipExported: false });
    assert.deepEqual(await storage.getStoredSettings(), { defaultFormat: 'markdown', skipExported: false });
    await storage.patchStoredSettings({ defaultFormat: 'pdf' });
    assert.deepEqual(await storage.getStoredSettings(), { defaultFormat: 'pdf', skipExported: false });
});

test('L3a connection pool reuses one IDBDatabase across sequential transactions and batch ExportRecord writes preserve folderBaseName', async () => {
    let opens = 0;
    const rawOpen = indexedDB.open;
    indexedDB.open = function (...args: Parameters<IDBFactory['open']>) {
        opens++;
        return rawOpen.apply(this, args);
    };
    try {
        const k1 = fixtureKey('pool-1');
        const k2 = fixtureKey('pool-2');
        await storage.putIndexes([{ key: k1, title: 'One', titleSource: 'provider' }, { key: k2, title: 'Two', titleSource: 'provider' }]);
        await storage.putExportRecord(k1, { exportedAt: 10, format: 'markdown', status: 'ok', folderBaseName: 'KeepFolderOne' });
        await putExportRecords([
            { key: k1, record: { exportedAt: 20, format: 'html', status: 'ok' } },
            { key: k2, record: { exportedAt: 20, format: 'html', status: 'ok', folderBaseName: 'FolderTwo' } },
        ]);
        assert.equal((await storage.getExportRecord(k1))?.folderBaseName, 'KeepFolderOne');
        assert.equal((await storage.getExportRecord(k2))?.folderBaseName, 'FolderTwo');
        assert.equal(opens, 1, 'pooled connection must open IndexedDB only once per factory/open binding');
    } finally {
        indexedDB.open = rawOpen;
    }
});
});

__suiteDescribe("idb_handle_store", () => {
useIndexStorage();
test('directory selection uses the single default key in the shared v2 DB', async () => {
    assert.equal(await storage.getDirectoryHandle(), null);
    const first = { name: 'First', kind: 'directory' } as FileSystemDirectoryHandle;
    const second = { name: 'Second', kind: 'directory' } as FileSystemDirectoryHandle;
    await storage.setDirectoryHandle(first); await storage.setDirectoryHandle(second);
    assert.deepEqual(await storage.getDirectoryHandle(), second);
    const db = await openStorageDB();
    try {
        const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
            const request = db.transaction('directoryHandles').objectStore('directoryHandles').getAllKeys();
            request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        assert.deepEqual(keys, ['default']);
    } finally { db.close(); }
});
test('directory IO fails visibly when IndexedDB is unavailable, without memory fallback', async () => {
    const previous = globalThis.indexedDB;
    try {
        Object.assign(globalThis, { indexedDB: undefined });
        await assert.rejects(storage.getDirectoryHandle());
        await assert.rejects(storage.setDirectoryHandle({ name: 'Fake' } as FileSystemDirectoryHandle));
    } finally { globalThis.indexedDB = previous; }
});

test('restored directory permission methods must be present before use', () => {
    const legacy = { name: 'Legacy', kind: 'directory' } as FileSystemDirectoryHandle;
    assert.equal(isDirectoryHandle(legacy), false);
    const missingRequest = { ...legacy, queryPermission: async () => 'granted' };
    assert.equal(isDirectoryHandle(missingRequest), false);
    const ready = { ...missingRequest, requestPermission: async () => 'granted' };
    assert.equal(isDirectoryHandle(ready), true);
});
});

__suiteDescribe("storage_reconciliation", () => {
useIndexStorage();
test('explicit deletion uses the exact opaque ConversationKey without c_ alias rewriting', async () => {
    const key = fixtureKey('id'), alias = fixtureKey('c_id'), other = { ...key, accountId: '20000000-0000-4000-8000-000000000002' };
    await storage.putIndexes([{ key }, { key: alias }, { key: other }]);
    await storage.deleteStoredConversation(alias);
    assert.equal(await storage.getIndex(alias), null);
    assert.ok(await storage.getIndex(key)); assert.ok(await storage.getIndex(other));
    await storage.deleteStoredConversation(fixtureKey('absent'));
    assert.equal((await storage.listIndexes(key.accountId)).length, 1);
});
test('empty atomic admission never reconciles away previously stored history', async () => {
    const key = fixtureKey('offline'); await storage.putIndexes([{ key, title: 'Offline', titleSource: 'derived' }]);
    await storage.updateIndexesAtomically([], () => []);
    assert.equal((await storage.getIndex(key))?.title, 'Offline');
});
test('deleting one conversation leaves Coverage and other conversation records intact', async () => {
    const key = fixtureKey('delete'), kept = fixtureKey('keep');
    for (const k of [key, kept]) await storage.putExportRecord(k, { exportedAt: 0, format: 'json', status: 'ok' });
    await storage.updateCoverageAtomically(key.accountId, 'recent', () => ({ next: { range: null }, result: undefined }));
    await storage.deleteStoredConversation(key);
    assert.equal(await storage.getExportRecord(key), null); assert.ok(await storage.getExportRecord(kept));
    assert.deepEqual(await storage.getCoverage(key.accountId, 'recent'), { range: null });
});
});

__suiteDescribe("ts_c2_storage_service", () => {
useIndexStorage();
test('normal ExportRecord storage preserves provider-native IDs and replaces the accepted value', async () => {
    const key = fixtureKey('c_native');
    await storage.putExportRecord(key, { exportedAt: 10, chatTime: 5, format: 'markdown', status: 'partial' });
    await storage.putExportRecord(key, { exportedAt: 2, format: 'html', status: 'ok' });
    assert.deepEqual(await storage.listExportRecords(key.accountId), { c_native: { exportedAt: 2, format: 'html', status: 'ok' } });
    assert.equal(await storage.getExportRecord(fixtureKey('native')), null);
});
test('concurrent IDB admission sees committed predecessors without JavaScript/WebLock queues', async () => {
    const key = fixtureKey('counter');
    const original = navigator.locks.request;
    navigator.locks.request = () => { throw new Error('IDB must not use Settings lock'); };
    try {
        await Promise.all(Array.from({ length: 12 }, () => storage.updateIndexesAtomically([key], old => [{ key, updatedAt: (old[0]?.updatedAt ?? 0) + 1 }])));
        assert.equal((await storage.getIndex(key))?.updatedAt, 12);
    } finally { navigator.locks.request = original; }
});
test('a failed native transaction rolls back the batch and cannot stall later admissions', async () => {
    const key = fixtureKey('valid');
    await assert.rejects(storage.putIndexes([{ key }, { key: { ...key, conversationId: undefined! } }]));
    assert.equal(await storage.getIndex(key), null);
    await storage.updateIndexesAtomically([key], () => [{ key, updatedAt: 1 }]);
    assert.equal((await storage.getIndex(key))?.updatedAt, 1);
});
test('ordinary reads never fall back to old slots, export scalars, lastSync or Chrome lists', async () => {
    const key = fixtureKey('legacy');
    const env = indexStorage({ [`conversations_${key.accountId}`]: [{ id: 'legacy' }], [`exported_${key.accountId}`]: { legacy: true }, gemini_account_slots: { u0: {} }, last_sync: 1 });
    try {
        assert.deepEqual(await storage.listIndexes(key.accountId), []);
        assert.deepEqual(await storage.listExportRecords(key.accountId), {});
        assert.deepEqual(await storage.listAccounts(), []);
        await storage.putExportRecord(key, { exportedAt: 0, format: 'json', status: 'ok' });
        assert.deepEqual(env.local[`exported_${key.accountId}`], { legacy: true });
    } finally { env.restore(); }
});
});

__suiteDescribe("storage_trust_snapshot", () => {
useStorageUnitEnvironment();

test('Storage persists detached v2 Index and Detail facts without transforming their content', async () => {
    const key = fixtureKey('copy');
    // L2's v2 schemas are type-only contracts. No L2 validator or admission code runs here.
    const index = { key, title: 'Original', titleSource: 'provider' } satisfies ConversationIndex;
    const detail = {
        key, quality: { status: 'complete' },
        messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Body' }] }] }],
        assets: [{ id: 'asset', kind: 'file', sourceUri: 'opaque:original' }],
    } satisfies ConversationDetail;
    await storage.updateConversationAtomically(key, () => ({ index, detail, result: undefined }));

    index.title = 'Changed';
    detail.assets[0].sourceUri = 'changed';
    const read = await storage.getDetail(key);
    assert.ok(read);
    assert.equal((await storage.getIndex(key))?.title, 'Original');
    assert.equal(read.assets[0].sourceUri, 'opaque:original');
    read.assets.length = 0;
    assert.equal((await storage.getDetail(key))?.assets.length, 1);
});
});

__suiteDescribe("live_storage_manager", () => {
useStorageUnitEnvironment();

test('L3a stores the v2 Settings patch without applying Application defaults', async () => {
    assert.deepEqual(await storage.getStoredSettings(), {});
    const patch = { enabledDisk: true, includeAssets: false } satisfies Partial<GlobalSettings>;
    await storage.patchStoredSettings(patch);
    assert.deepEqual(await storage.getStoredSettings(), patch);
    await storage.patchStoredSettings({ enabledDisk: false });
    assert.deepEqual(await storage.getStoredSettings(), { enabledDisk: false, includeAssets: false });
});

test('directory handle persists independently from the installed Settings fields', async () => {
    const handle = { kind: 'directory', name: 'Selected' } as FileSystemDirectoryHandle;
    await storage.patchStoredSettings({ enabledDisk: true });
    assert.equal(await storage.getDirectoryHandle(), null);
    await storage.setDirectoryHandle(handle);
    await storage.patchStoredSettings({ defaultFormat: 'pdf' });
    assert.deepEqual(await storage.getDirectoryHandle(), handle);
    assert.deepEqual(await storage.getStoredSettings(), { enabledDisk: true, defaultFormat: 'pdf' });
    await storage.setDirectoryHandle(null);
    assert.equal(await storage.getDirectoryHandle(), null);
    assert.deepEqual(await storage.getStoredSettings(), { enabledDisk: true, defaultFormat: 'pdf' });
});
});

__suiteDescribe("schema_badge", () => {
test('passive Storage propagates IO errors without a global schema freeze or badge side effects', async () => {
    const env = indexStorage();
    let badgeCalls = 0;
    Object.assign(chrome, { action: {
        setBadgeText: async () => { badgeCalls++; throw new Error('Badge unavailable'); },
        setBadgeBackgroundColor: async () => { badgeCalls++; throw new Error('Color unavailable'); },
    } });
    try {
        env.fail('gemini_exporter_v2_settings');
        await assert.rejects(patchStoredSettings({ enabledDisk: true }), /write failed/);
        assert.deepEqual(await getStoredSettings(), {});
        env.fail(); await patchStoredSettings({ enabledDisk: false });
        assert.deepEqual(await getStoredSettings(), { enabledDisk: false });
        assert.equal(badgeCalls, 0);
    } finally { env.restore(); }
});
});

__suiteDescribe("storage_export_surface", () => {
useIndexStorage();

test('folder basename metadata persists separately for the same conversation ID in different accounts', async () => {
    const first = fixtureKey('shared-folder-id', 'gemini');
    const second = fixtureKey('shared-folder-id', 'chatgpt');
    await storage.putExportRecord(first, { exportedAt: 1, format: 'markdown', status: 'ok', folderBaseName: 'Gemini file' });
    await storage.putExportRecord(second, { exportedAt: 2, format: 'markdown', status: 'ok', folderBaseName: 'ChatGPT file' });
    assert.equal((await storage.getExportRecord(first))?.folderBaseName, 'Gemini file');
    assert.equal((await storage.getExportRecord(second))?.folderBaseName, 'ChatGPT file');
});

test('ExportRecord writes do not finalize or mutate Index/Detail', async () => {
    const key = fixtureKey('export');
    await storage.putIndexes([{ key, title: 'Authoritative', titleSource: 'provider', updatedAt: 1 }]);
    const before = await storage.getIndex(key);
    await storage.putExportRecord(key, { exportedAt: 2, format: 'html', status: 'partial' });
    assert.deepEqual(await storage.getIndex(key), before);
    assert.equal(await storage.getDetail(key), null);
    assert.deepEqual(await storage.getExportRecord(key), { exportedAt: 2, format: 'html', status: 'partial' });
});

test('Node Storage fixture preserves native in-line and out-of-line key semantics', async () => {
    const originalPut = IDBObjectStore.prototype.put;
    const calls: Array<[string, number]> = [];
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
        if (this.name === 'exportRecords' || this.name === 'directoryHandles')
            calls.push([this.name, arguments.length]);
        return arguments.length === 1 ? originalPut.call(this, value) : originalPut.call(this, value, key);
    };
    try {
        const key = fixtureKey('key-mode');
        const record = { exportedAt: 1, format: 'markdown' as const, status: 'ok' as const };
        const directory = { kind: 'directory', name: 'selected' } as FileSystemDirectoryHandle;
        await storage.putExportRecord(key, record);
        await storage.setDirectoryHandle(directory);
        assert.deepEqual(calls, [['exportRecords', 1], ['directoryHandles', 2]]);
        assert.deepEqual(await storage.getExportRecord(key), record);
        assert.deepEqual(await storage.getDirectoryHandle(), directory);
    } finally {
        IDBObjectStore.prototype.put = originalPut;
    }
});
});

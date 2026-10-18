const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory, IDBDatabase, IDBObjectStore } = require('fake-indexeddb');
const { ensureUpgraded } = require('../src/core/migration/upgradeV1.ts');
const storage = require('../src/core/storage/storageService.ts');
const marker = 'gemini_exporter_v2_initialized';
const settingsKey = 'gemini_exporter_v2_settings';
const a = { id: '12345678-1234-4234-8234-123456789abc', providerId: 'gemini', providerAccountId: 'one' };
const b = { ...a, id: '22345678-1234-4234-8234-123456789abc', providerAccountId: 'two' };
const index = account => ({ key: { accountId: account.id, conversationId: 'shared' }, title: 'History', titleSource: 'provider', updatedAt: 123 });
let data, writes, failKey;
beforeEach(() => {
    global.indexedDB = new IDBFactory();
    data = {}; writes = []; failKey = undefined;
    global.chrome = { storage: { local: {
        get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(data[key])])),
        set: async patch => {
            if (failKey && Object.hasOwn(patch, failKey)) throw new Error('injected write failure');
            writes.push(structuredClone(patch)); Object.assign(data, structuredClone(patch));
        }
    } } };
});
async function seed(name, stores) {
    const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onupgradeneeded = () => { for (const store of Object.keys(stores)) req.result.createObjectStore(store); };
        req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    await new Promise((resolve, reject) => {
        const tx = db.transaction(Object.keys(stores), 'readwrite');
        for (const [name, rows] of Object.entries(stores)) for (const [key, value] of rows) tx.objectStore(name).put(value, key);
        tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    });
    db.close();
}
async function accounts(...values) {
    await seed('gemini_exporter_domain', { accounts: values.map(value => [value.id, value]), conversations: [['forbidden', 'do not read']] });
}

test('fresh install marks complete without creating old DBs or storing defaults', async () => {
    await Promise.all([ensureUpgraded(), ensureUpgraded()]);
    assert.deepEqual(data, { [marker]: true });
    assert.deepEqual(await indexedDB.databases(), []);
    assert.equal(writes.length, 1);
});

test('migrates exactly five categories, isolates accounts, and retains old sources', async () => {
    await accounts(a, b);
    const handle = { kind: 'directory', name: 'chosen' }; // IDB structured-clone stand-in; no permission methods called.
    await seed('gemini_exporter_idb', { handles: [['export_dir_handle', handle]] });
    const at = '2026-10-17T12:00:00.000Z';
    data = {
        [`conversations_${a.id}`]: [index(a)], [`conversations_${b.id}`]: [index(b)],
        [`exported_${a.id}`]: {
            c_shared: { status: 'ok', format: 'markdown', exportedAt: at, chatTime: 456 },
            shared: { status: 'ok', format: 'pdf', exportedAt: at, hasFailedAssets: true },
            failed: { status: 'failed', format: 'markdown', exportedAt: at },
            empty: { status: 'empty', format: 'markdown', exportedAt: at },
            bad: { status: 'ok', format: 'unknown', exportedAt: at },
            truncated: { status: 'ok', format: 'html', exportedAt: at, truncated: true, chatTime: 'invalid' }
        },
        [`exported_${b.id}`]: { shared: { status: 'partial', format: 'json', exportedAt: Date.parse(at), chatTime: at } },
        gemini_export_format: 'pdf', gemini_export_zip: false, gemini_dev_mode: false,
        gemini_exporter_lang: 'zh', gemini_export_badge_pos: { left: 0, top: 15 },
        live_save_config: { enabledDisk: true, includeAssets: false },
        has_imported_takeout: true, last_seen_feature_version: '1.7.0',
        scan_checkpoint_ignored: 'ignored', gemini_last_export_session: 'ignored'
    };
    const old = structuredClone(data);
    const accessed = [];
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(names, ...rest) {
        if (this.name !== 'gemini_exporter_v2') accessed.push(...(Array.isArray(names) ? names : [names]));
        return original.call(this, names, ...rest);
    };
    try { await ensureUpgraded(); } finally { IDBDatabase.prototype.transaction = original; }
    assert.deepEqual(accessed.sort(), ['accounts', 'handles']);
    assert.deepEqual(await storage.listAccounts(), [a, b]);
    assert.deepEqual(await storage.listIndexes(a.id), [index(a)]);
    assert.deepEqual(await storage.listIndexes(b.id), [index(b)]);
    assert.equal(await storage.getDetail(index(a).key), null);
    assert.deepEqual(await storage.listExportRecords(a.id), {
        shared: { exportedAt: Date.parse(at), format: 'pdf', status: 'partial' },
        truncated: { exportedAt: Date.parse(at), format: 'html', status: 'partial' }
    });
    assert.deepEqual(await storage.getExportRecord(index(b).key), { exportedAt: Date.parse(at), format: 'json', status: 'partial', chatTime: Date.parse(at) });
    assert.deepEqual(data[settingsKey], { defaultFormat: 'pdf', useZip: false, developerMode: false,
        language: 'zh', badgePosition: { left: 0, top: 15 }, enabledDisk: true,
        tourShown: true, takeoutPromptCompleted: true, lastSeenFeatureVersion: '1.7.0' });
    assert.deepEqual(await storage.getDirectoryHandle(), handle);
    for (const [key, value] of Object.entries(old)) assert.deepEqual(data[key], value);
    assert.deepEqual(writes.at(-1), { [marker]: true });
    indexedDB.databases = () => { throw new Error('must not read legacy after completion'); };
    await ensureUpgraded();
});

test('preferences alone identify an upgrade; invalid preferences keep defaults sparse', async () => {
    data = { gemini_export_format: 'invalid', gemini_exporter_lang: 'fr', gemini_export_zip: false,
        gemini_export_badge_pos: { left: NaN, top: 2 }, has_completed_takeout_prompt: true };
    await ensureUpgraded();
    assert.deepEqual(data[settingsKey], { useZip: false, tourShown: true, takeoutPromptCompleted: true });
    assert.deepEqual(await indexedDB.databases(), []);
});

test('invalid accounts or index ownership fail before writing and allow retry', async () => {
    await accounts(a);
    data[`conversations_${a.id}`] = [index(b)];
    await assert.rejects(ensureUpgraded(), /account mismatch/);
    assert.equal(data[marker], undefined);
    assert.deepEqual(writes, []);
    assert.deepEqual(await storage.listAccounts(), []);
    data[`conversations_${a.id}`] = [{ ...index(a), updatedAt: NaN }];
    await assert.rejects(ensureUpgraded(), /index schema/);
    data[`conversations_${a.id}`] = [index(a)];
    await ensureUpgraded();
    assert.deepEqual(await storage.listIndexes(a.id), [index(a)]);
});

test('mid-write failure leaves marker unset; retry overwrites stable keys without duplicates', async () => {
    await accounts(a);
    data[`conversations_${a.id}`] = [index(a)];
    data[`exported_${a.id}`] = { c_shared: { status: 'ok', exportedAt: 1000, format: 'markdown', chatTime: 500 } };
    failKey = settingsKey;
    const first = ensureUpgraded();
    assert.equal(first, ensureUpgraded());
    await assert.rejects(first, /injected/);
    assert.equal(data[marker], undefined);
    failKey = undefined;
    await ensureUpgraded();
    assert.equal((await storage.listAccounts()).length, 1);
    assert.equal((await storage.listIndexes(a.id)).length, 1);
    assert.deepEqual(await storage.getExportRecord(index(a).key), { exportedAt: 1000, format: 'markdown', status: 'ok', chatTime: 500 });
});

test('existing directory write failure blocks completion and remains retryable', async () => {
    await seed('gemini_exporter_idb', { handles: [['export_dir_handle', { kind: 'directory', name: 'chosen' }]] });
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) {
        if (this.name === 'directoryHandles') throw new Error('directory write failed');
        return original.apply(this, args);
    };
    try { await assert.rejects(ensureUpgraded(), /directory write failed/); }
    finally { IDBObjectStore.prototype.put = original; }
    assert.equal(data[marker], undefined);
    await ensureUpgraded();
    assert.equal((await storage.getDirectoryHandle()).name, 'chosen');
});

test('invalid account registry is rejected without completion', async () => {
    await accounts({ ...a, id: 'invalid' });
    await assert.rejects(ensureUpgraded(), /UUID/);
    assert.equal(data[marker], undefined);
    assert.deepEqual(writes, []);
});

test('malformed and duplicate index containers never silently discard history', async () => {
    await accounts(a);
    for (const list of [null, {}, [index(a), index(a)]]) {
        data[`conversations_${a.id}`] = list;
        await assert.rejects(ensureUpgraded(), /index container|Duplicate legacy index/);
        assert.equal(data[marker], undefined);
        assert.deepEqual(writes, []);
    }
});

test('failure to commit the final marker is retryable and never clears legacy sources', async () => {
    data = { gemini_export_zip: false };
    failKey = marker;
    await assert.rejects(ensureUpgraded(), /injected/);
    assert.equal(data[marker], undefined);
    assert.equal(data.gemini_export_zip, false);
    failKey = undefined;
    await ensureUpgraded();
    assert.equal(data[marker], true);
    assert.equal(data[settingsKey].useZip, false);
});

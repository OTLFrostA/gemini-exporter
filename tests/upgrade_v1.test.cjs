const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory, IDBDatabase, IDBObjectStore } = require('fake-indexeddb');
const { ensureUpgraded } = require('../src/migration/upgradeV1.ts');
const storage = require('../src/l3a/storageService.ts');
const marker = 'gemini_exporter_v2_initialized';
const settingsKey = 'gemini_exporter_v2_settings';
const a = { id: '12345678-1234-4234-8234-123456789abc', providerId: 'gemini', providerAccountId: 'one' };
const b = { ...a, id: '22345678-1234-4234-8234-123456789abc', providerAccountId: 'two' };
const index = account => ({ key: { accountId: account.id, conversationId: 'shared' }, title: 'History', titleSource: 'provider', updatedAt: 123 });
const { indexStorage } = require('./helpers/indexStorage.ts');
let data, writes, failKey, environment;
afterEach(() => environment.restore());
beforeEach(() => {
    environment = indexStorage();
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
    assert.deepEqual(data[settingsKey], { defaultFormat: 'pdf', developerMode: false,
        language: 'zh', badgePosition: { left: 0, top: 15 }, enabledDisk: true,
        takeoutPromptCompleted: true, lastSeenFeatureVersion: '1.7.0' });
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
    assert.deepEqual(data[settingsKey], { takeoutPromptCompleted: true });
    assert.deepEqual(await indexedDB.databases(), []);
});

test('invalid legacy index rows are skipped while valid accounts, indexes, settings and exports migrate', async () => {
    await accounts(a, b);
    const badTime = { ...index(a), key: { ...index(a).key, conversationId: 'bad-time' }, updatedAt: NaN };
    data[`conversations_${a.id}`] = [index(a), badTime, index(b), index(a), null];
    data[`conversations_${b.id}`] = [index(b)];
    data[`exported_${a.id}`] = { shared: { status: 'ok', exportedAt: 1000, format: 'markdown' } };
    data.gemini_export_format = 'html';
    const legacy = structuredClone(data);
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try { await ensureUpgraded(); } finally { console.warn = originalWarn; }
    assert.deepEqual(await storage.listAccounts(), [a, b]);
    assert.deepEqual(await storage.listIndexes(a.id), [index(a)]);
    assert.deepEqual(await storage.listIndexes(b.id), [index(b)]);
    assert.deepEqual(await storage.getExportRecord(index(a).key), { status: 'ok', exportedAt: 1000, format: 'markdown' });
    assert.equal(data[settingsKey]?.defaultFormat, 'html');
    assert.equal(data[marker], true);
    assert.equal(warnings.filter(args => args[0] === '[Migration] Ignoring unconvertible legacy index').length, 4);
    for (const [key, value] of Object.entries(legacy)) assert.deepEqual(data[key], value);
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

test('malformed whole index containers still fail rather than inventing a history', async () => {
    await accounts(a);
    for (const list of [null, {}]) {
        data[`conversations_${a.id}`] = list;
        await assert.rejects(ensureUpgraded(), /index container/);
        assert.equal(data[marker], undefined);
        assert.deepEqual(writes, []);
    }
});

test('duplicate legacy indexes preserve one valid record instead of blocking upgrade', async () => {
    await accounts(a);
    data[`conversations_${a.id}`] = [index(a), index(a)];
    await ensureUpgraded();
    assert.deepEqual(await storage.listIndexes(a.id), [index(a)]);
    assert.equal(data[marker], true);
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
    assert.equal(data[settingsKey]?.useZip, undefined);
});

test('upgrade normalizes provable source Index times to safe millisecond integers', async () => {
    await accounts(a);
    data[`conversations_${a.id}`] = [{ ...index(a), createdAt: '2026-10-17T12:00:00+02:00', updatedAt: '0' }];
    await ensureUpgraded();
    assert.deepEqual(await storage.getIndex(index(a).key), { ...index(a), createdAt: Date.parse('2026-10-17T10:00:00Z'), updatedAt: 0 });
});
for (const value of [0.25, Number.MAX_SAFE_INTEGER + 1, Infinity, '2026-10-17T12:00:00', 'unknown']) {
    test(`invalid Index source time ${value} is skipped without losing a valid sibling`, async () => {
        await accounts(a);
        data[`conversations_${a.id}`] = [{ ...index(a), key: { ...index(a).key, conversationId: 'bad' }, updatedAt: value }, index(a)];
        await ensureUpgraded();
        assert.deepEqual(await storage.listIndexes(a.id), [index(a)]);
        assert.equal(data[marker], true);
    });
}
test('invalid optional export times are omitted, invalid exportedAt records rejected, epoch zero preserved', async () => {
    await accounts(a);
    data[`exported_${a.id}`] = {
        valid: { exportedAt: 0, chatTime: 0, status: 'ok', format: 'json' },
        optional: { exportedAt: '123', chatTime: '2026-10-17T12:00:00', status: 'partial', format: 'html' },
        invalid: { exportedAt: 0.5, status: 'ok', format: 'pdf' },
    };
    await ensureUpgraded();
    assert.deepEqual(await storage.listExportRecords(a.id), {
        valid: { exportedAt: 0, chatTime: 0, status: 'ok', format: 'json' },
        optional: { exportedAt: 123, status: 'partial', format: 'html' },
    });
});

for (const initialized of [false, true]) test(`released 1.7 slot lists migrate even with initialized=${initialized}`, async () => {
    const old = {
        gemini_account_slots: {
            u0: { accountId: 'one@example.com', email: 'one@example.com', name: 'One' },
            u1: { accountId: 'two@example.com', email: 'two@example.com', name: 'Two' }
        },
        gemini_conversations: [{ id: 'c_shared', title: 'First', titleSource: 'rpc', chatTime: 123,
            accountSlot: 'u0' }, { id: 'second', title: 'Offline', titleSource: 'derived', updatedAt: 456 }],
        gemini_conversations_u1: [{ id: 'shared', title: 'Other account', titleSource: 'dom', updatedAt: 789, accountSlot: 'u1' }],
        exportedIds: { c_shared: { status: 'partial', format: 'markdown', exportedAt: 1000 } },
        gemini_exported_u1: { shared: { status: 'ok', format: 'html', exportedAt: 2000, chatTime: 789 } },
        ...(initialized ? { [marker]: true } : {})
    };
    data = structuredClone(old);
    await ensureUpgraded();
    const saved = await storage.listAccounts();
    assert.equal(saved.length, 2);
    const one = saved.find(row => row.email === 'one@example.com');
    const two = saved.find(row => row.email === 'two@example.com');
    assert.equal((await storage.listIndexes(one.id)).length, 2);
    assert.deepEqual(await storage.getIndex({ accountId: one.id, conversationId: 'shared' }), {
        key: { accountId: one.id, conversationId: 'shared' }, title: 'First', titleSource: 'provider', updatedAt: 123
    });
    assert.equal((await storage.listIndexes(two.id))[0].title, 'Other account');
    assert.equal((await storage.getExportRecord({ accountId: one.id, conversationId: 'shared' })).status, 'partial');
    assert.equal((await storage.getExportRecord({ accountId: two.id, conversationId: 'shared' })).format, 'html');
    assert.equal(data.gemini_exporter_v17_migrated, true);
    for (const [k,v] of Object.entries(old)) if (k !== marker) assert.deepEqual(data[k], v);
    const { getOrCreateAccount } = require('../src/l2/accountAdmission.ts');
    const verified = await getOrCreateAccount('gemini', '123456789012345', 'one@example.com', 'Verified');
    assert.equal(verified.id, one.id, 'verified Gaia keeps the migrated UUID and its conversations');
    assert.equal((await storage.listAccounts()).length, 2);
    assert.equal((await storage.listIndexes(verified.id)).length, 2);
    await storage.deleteStoredConversation({ accountId: one.id, conversationId: 'shared' });
    await ensureUpgraded();
    assert.equal(await storage.getIndex({ accountId: one.id, conversationId: 'shared' }), null, 'later reload cannot resurrect cleanup');
});

test('released 1.7 retry preserves current v2 facts and keeps stable account identity', async () => {
    data = { [marker]: true, gemini_account_slots: { u0: { email: 'one@example.com' } },
        gemini_conversations: [{ id: 'shared', title: 'Old', titleSource: 'rpc', updatedAt: 123 }] };
    failKey = 'gemini_exporter_v17_migrated';
    await assert.rejects(ensureUpgraded(), /injected/);
    const [account] = await storage.listAccounts();
    assert.ok(account);
    await storage.putIndexes([{ key: { accountId: account.id, conversationId: 'shared' }, title: 'New', titleSource: 'user', updatedAt: 456 }]);
    failKey = undefined;
    await ensureUpgraded();
    assert.equal((await storage.listAccounts()).length, 1);
    assert.equal((await storage.listIndexes(account.id))[0].title, 'New');
    assert.equal(data.gemini_exporter_v17_migrated, true);
});

test('released 1.7 recovery reuses a verified account but never merges distinct known Gaia subjects by email', async () => {
    const existing = { ...a, providerAccountId: '123456789', email: 'same@example.com' };
    await storage.putAccount(existing);
    data = { [marker]: true, gemini_account_slots: {
        u0: { email: 'same@example.com' }, u1: { accountId: '987654321', email: 'same@example.com' }
    }, gemini_conversations: [{ id: 'one' }], gemini_conversations_u1: [{ id: 'two' }] };
    await ensureUpgraded();
    assert.equal((await storage.listAccounts()).length, 2);
    assert.deepEqual((await storage.listIndexes(a.id)).map(row => row.key.conversationId), ['one']);
    const other = (await storage.listAccounts()).find(row => row.providerAccountId === '987654321');
    assert.deepEqual((await storage.listIndexes(other.id)).map(row => row.key.conversationId), ['two']);
});

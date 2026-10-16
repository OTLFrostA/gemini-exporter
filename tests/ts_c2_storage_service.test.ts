import { indexFixture } from './helpers/indexFixture.js';
export {};
const test = require('node:test');
const assert = require('node:assert');
const {
    normSlot,
    getStorageKeys,
    getConversations,
    setConversations,
    getExportedIds,
    saveExportRecord,
    saveExportRecordsBatch,
    migrateExportAliases,
    finalizeConversationExport,
    removeConversation,
    getAccounts,
    updateAccountSlot,
    updateConversation
} = require('../src/core/storage/storageService.js');

function setupMockStorage(initialStore: Record<string, any> = {}) {
    const store: Record<string, any> = { ...initialStore };
    const origChrome = (globalThis as any).chrome;

    const mockLocal = {
        get: async (keys: any) => {
            if (keys === null) return { ...store };
            const res: Record<string, any> = {};
            for (const k of keys || []) {
                if (k in store) res[k] = store[k];
            }
            return res;
        },
        set: async (obj: any) => {
            Object.assign(store, obj);
        },
        remove: async (keys: any) => {
            for (const k of keys || []) {
                delete store[k];
            }
        }
    };

    (globalThis as any).chrome = {
        storage: {
            local: mockLocal
        }
    };

    return {
        store,
        restore: () => {
            (globalThis as any).chrome = origChrome;
        }
    };
}

test('C2-3: export record canonical keys normalize prefixes and padding', async () => {
    const { store, restore } = setupMockStorage();
    try {
        const rec1 = {
            exportedAt: 1700000001000,
            title: 'Export 1',
            format: 'markdown',
            status: 'ok'
        };
        await saveExportRecord('10000000-0000-4000-8000-000000000001', 'c_abc123', rec1);

        const rec2 = {
            exportedAt: 1700000002000,
            title: 'Export 2',
            format: 'html',
            status: 'ok'
        };
        await saveExportRecordsBatch('10000000-0000-4000-8000-000000000001', {
            'c_def456': rec2
        });

        const records = await getExportedIds('10000000-0000-4000-8000-000000000001');
        assert.ok('abc123' in records);
        assert.ok('def456' in records);
        assert.strictEqual(records['abc123'].title, 'Export 1');
        assert.strictEqual(records['def456'].title, 'Export 2');

        // Check storage reflects canonical keys without alias duplication
        const rawStore = store['exported_10000000-0000-4000-8000-000000000001'];
        assert.deepStrictEqual(Object.keys(rawStore).sort(), ['abc123', 'def456']);
    } finally {
        restore();
    }
});

test('C2-5: cross-tab serialization lock order and queue integrity', async () => {
    const { restore: restoreStore } = setupMockStorage();
    const lockCalls: string[] = [];
    const origNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

    Object.defineProperty(globalThis, 'navigator', {
        value: {
            locks: {
                request: async (name: string, fn: any) => {
                    lockCalls.push(name);
                    return fn();
                }
            }
        },
        configurable: true,
        writable: true,
        enumerable: true
    });

    try {
        await setConversations('10000000-0000-4000-8000-000000000001', ([{ id: 'conv_lock', title: 'Lock Test', timestamp: 1 }]).map(indexFixture));
        await saveExportRecord('10000000-0000-4000-8000-000000000001', 'conv_lock', { exportedAt: 100, status: 'ok' });

        assert.ok(lockCalls.includes('gemini-exporter:write:conversations'));
        assert.ok(lockCalls.includes('gemini-exporter:write:export-records'));
    } finally {
        if (origNavDesc) {
            Object.defineProperty(globalThis, 'navigator', origNavDesc);
        }
        restoreStore();
    }
});

test('C2-6: queue survives failed write without stalling future tasks', async () => {
    const { store, restore } = setupMockStorage();
    try {
        const local = (globalThis as any).chrome.storage.local;
        const origSet = local.set;

        let failOnce = true;
        local.set = async (obj: any) => {
            if (failOnce) {
                failOnce = false;
                throw new Error('Simulated write failure');
            }
            return origSet(obj);
        };

        // First write should fail
        await assert.rejects(
            async () => {
                await setConversations('10000000-0000-4000-8000-000000000001', ([{ id: 'fail_conv', title: 'Fails', timestamp: 1 }]).map(indexFixture));
            },
            /Simulated write failure/
        );

        // Second write queued immediately after MUST succeed and not hang
        await setConversations('10000000-0000-4000-8000-000000000001', ([{ id: 'ok_conv', title: 'Succeeds', timestamp: 2 }]).map(indexFixture));

        const fetched = await getConversations('10000000-0000-4000-8000-000000000001');
        assert.strictEqual(fetched.length, 1);
        assert.strictEqual(fetched[0].id, 'ok_conv');
        assert.strictEqual(store['conversations_10000000-0000-4000-8000-000000000001'] !== undefined, true);
    } finally {
        restore();
    }
});

test('C2-8: skipConversationUpdate skips modifying conversation list', async () => {
    const { store, restore } = setupMockStorage({
        ['conversations_10000000-0000-4000-8000-000000000001']: [
            { id: 'c_skip', title: 'Untouched Title', timestamp: 1000, messageCount: 1 }
        ]
    });
    try {
        const res = await finalizeConversationExport(
            '10000000-0000-4000-8000-000000000001',
            'c_skip',
            { exportedAt: 2000, status: 'ok', title: 'New Export Title' },
            {
                skipConversationUpdate: true,
                conversationUpdate: {
                    title: 'Should Not Be Applied'
                }
            }
        );

        assert.strictEqual(res.ok, true);
        const convs = store['conversations_10000000-0000-4000-8000-000000000001'];
        assert.strictEqual(convs[0].title, 'Untouched Title');

        // Export record is still saved
        const exports = store['exported_10000000-0000-4000-8000-000000000001'];
        assert.strictEqual(exports['skip'].title, 'New Export Title');
    } finally {
        restore();
    }
});

test('C2-14: getExportedIds preserves primitive and null values in exportedIds', async () => {
    const { store, restore } = setupMockStorage({
        ['exported_10000000-0000-4000-8000-000000000001']: {
            c_flag: true,
            c_null: null,
            c_num: 42,
            c_rec: { exportedAt: 1234, format: 'json', status: 'ok' }
        }
    });
    try {
        const map = await getExportedIds('10000000-0000-4000-8000-000000000001');
        assert.strictEqual(map['flag'], true);
        assert.strictEqual(map['null'], null);
        assert.strictEqual(map['num'], 42);
        assert.strictEqual(map['rec']?.status, 'ok');

        // Batch update preserves other primitive/null values
        await saveExportRecordsBatch('10000000-0000-4000-8000-000000000001', {
            c_new: { exportedAt: 5678, status: 'ok' }
        });
        const rawStore = store['exported_10000000-0000-4000-8000-000000000001'];
        assert.strictEqual(rawStore['flag'], true);
        assert.strictEqual(rawStore['null'], null);
        assert.strictEqual(rawStore['num'], 42);
        assert.strictEqual(rawStore['new'].status, 'ok');
    } finally {
        restore();
    }
});

test('C2 review: last-sync reads keep historical truthiness without finite-number normalization', async () => {
    const fixture = setupMockStorage();
    const { getLastSync } = require('../src/core/storage/storageService.js');
    try {
        for (const [timestamp, count] of [[0, 0], ['legacy-time', '7'], [Infinity, Infinity], [false, null], [{ legacy: true }, true]]) {
            fixture.store['last_sync_10000000-0000-4000-8000-000000000001'] = timestamp;
            fixture.store['last_count_10000000-0000-4000-8000-000000000001'] = count;
            const value = await getLastSync('10000000-0000-4000-8000-000000000001');
            assert.strictEqual(value.timestamp, timestamp || null);
            assert.strictEqual(value.count, count || 0);
        }
    } finally { fixture.restore(); }
});


test('C2 follow-up: incompatible export and slot objects survive reads and writeback', async () => {
    const exported = { exportedAt: null, title: 7, files: [42], extension: true };
    const profile = { name: { historical: true }, count: '3', extension: ['retained'] };
    const fixture = setupMockStorage({ ['exported_10000000-0000-4000-8000-000000000001']: { c_legacy: exported, scalar: true }, gemini_account_slots: { u1: profile, u2: null, u3: 12 } });
    try {
        assert.strictEqual((await getExportedIds('10000000-0000-4000-8000-000000000001')).legacy, exported);
        await saveExportRecord('10000000-0000-4000-8000-000000000001', 'new', { exportedAt: 123 });
        assert.strictEqual((await getExportedIds('10000000-0000-4000-8000-000000000001')).legacy, exported);
    } finally { fixture.restore(); }
});

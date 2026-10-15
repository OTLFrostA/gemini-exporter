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
    getAccountSlots,
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

test('C2-1: slot key mapping handles u0 aliases and multi-slot keys canonically', () => {
    assert.strictEqual(normSlot(null), 'u0');
    assert.strictEqual(normSlot(undefined), 'u0');
    assert.strictEqual(normSlot(''), 'u0');
    assert.strictEqual(normSlot('default'), 'u0');
    assert.strictEqual(normSlot('u0'), 'u0');
    assert.strictEqual(normSlot('U0'), 'u0');
    assert.strictEqual(normSlot('u1'), 'u1');
    assert.strictEqual(normSlot('u2'), 'u2');
    assert.strictEqual(normSlot('invalid'), 'u0');

    const k0 = getStorageKeys('u0');
    assert.strictEqual(k0.convKey, 'gemini_conversations');
    assert.strictEqual(k0.expKey, 'exportedIds');
    assert.strictEqual(k0.syncKey, 'gemini_last_sync');
    assert.strictEqual(k0.countKey, 'gemini_last_count');
    assert.strictEqual(k0.checkpointKey, 'gemini_scan_checkpoint');

    const kDefault = getStorageKeys('default');
    assert.deepStrictEqual(kDefault, k0);

    const k1 = getStorageKeys('u1');
    assert.strictEqual(k1.convKey, 'gemini_conversations_u1');
    assert.strictEqual(k1.expKey, 'gemini_exported_u1');
    assert.strictEqual(k1.syncKey, 'gemini_last_sync_u1');
    assert.strictEqual(k1.countKey, 'gemini_last_count_u1');
    assert.strictEqual(k1.checkpointKey, 'gemini_scan_checkpoint_u1');
});

test('C2-3: export record canonical keys normalize prefixes and padding', async () => {
    const { store, restore } = setupMockStorage();
    try {
        const rec1 = {
            exportedAt: 1700000001000,
            title: 'Export 1',
            format: 'markdown',
            status: 'ok'
        };
        await saveExportRecord('u0', 'c_abc123', rec1);

        const rec2 = {
            exportedAt: 1700000002000,
            title: 'Export 2',
            format: 'html',
            status: 'ok'
        };
        await saveExportRecordsBatch('u0', {
            'c_def456': rec2
        });

        const records = await getExportedIds('u0');
        assert.ok('abc123' in records);
        assert.ok('def456' in records);
        assert.strictEqual(records['abc123'].title, 'Export 1');
        assert.strictEqual(records['def456'].title, 'Export 2');

        // Check storage reflects canonical keys without alias duplication
        const rawStore = store['exportedIds'];
        assert.deepStrictEqual(Object.keys(rawStore).sort(), ['abc123', 'def456']);
    } finally {
        restore();
    }
});

test('C2-4: legacy u0 alias migration cleans up gemini_exported_u0', async () => {
    const { store, restore } = setupMockStorage({
        exportedIds: {
            c_old1: { exportedAt: 1000, title: 'Old 1' }
        },
        gemini_exported_u0: {
            old2: { exportedAt: 2000, title: 'Old 2' }
        }
    });
    try {
        const changed = await migrateExportAliases('u0');
        assert.strictEqual(changed, true);

        // gemini_exported_u0 must be cleaned up
        assert.strictEqual(store['gemini_exported_u0'], undefined);

        // exportedIds must have merged, canonical keys
        const rawStore = store['exportedIds'];
        assert.deepStrictEqual(Object.keys(rawStore).sort(), ['old1', 'old2']);
        assert.strictEqual(rawStore['old1'].title, 'Old 1');
        assert.strictEqual(rawStore['old2'].title, 'Old 2');

        // Second run detects no changes
        const changedAgain = await migrateExportAliases('u0');
        assert.strictEqual(changedAgain, false);
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
        await setConversations('u0', ([{ id: 'conv_lock', title: 'Lock Test', timestamp: 1 }]).map(indexFixture));
        await saveExportRecord('u0', 'conv_lock', { exportedAt: 100, status: 'ok' });

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
                await setConversations('u0', ([{ id: 'fail_conv', title: 'Fails', timestamp: 1 }]).map(indexFixture));
            },
            /Simulated write failure/
        );

        // Second write queued immediately after MUST succeed and not hang
        await setConversations('u0', ([{ id: 'ok_conv', title: 'Succeeds', timestamp: 2 }]).map(indexFixture));

        const fetched = await getConversations('u0');
        assert.strictEqual(fetched.length, 1);
        assert.strictEqual(fetched[0].id, 'ok_conv');
        assert.strictEqual(store['gemini_conversations'] !== undefined, true);
    } finally {
        restore();
    }
});

test('C2-8: skipConversationUpdate skips modifying conversation list', async () => {
    const { store, restore } = setupMockStorage({
        gemini_conversations: [
            { id: 'c_skip', title: 'Untouched Title', timestamp: 1000, messageCount: 1 }
        ]
    });
    try {
        const res = await finalizeConversationExport(
            'u0',
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
        const convs = store['gemini_conversations'];
        assert.strictEqual(convs[0].title, 'Untouched Title');

        // Export record is still saved
        const exports = store['exportedIds'];
        assert.strictEqual(exports['skip'].title, 'New Export Title');
    } finally {
        restore();
    }
});

test('C2-14: getExportedIds preserves primitive and null values in exportedIds', async () => {
    const { store, restore } = setupMockStorage({
        exportedIds: {
            c_flag: true,
            c_null: null,
            c_num: 42,
            c_rec: { exportedAt: 1234, format: 'json', status: 'ok' }
        }
    });
    try {
        const map = await getExportedIds('u0');
        assert.strictEqual(map['flag'], true);
        assert.strictEqual(map['null'], null);
        assert.strictEqual(map['num'], 42);
        assert.strictEqual(map['rec']?.status, 'ok');

        // Batch update preserves other primitive/null values
        await saveExportRecordsBatch('u0', {
            c_new: { exportedAt: 5678, status: 'ok' }
        });
        const rawStore = store['exportedIds'];
        assert.strictEqual(rawStore['flag'], true);
        assert.strictEqual(rawStore['null'], null);
        assert.strictEqual(rawStore['num'], 42);
        assert.strictEqual(rawStore['new'].status, 'ok');
    } finally {
        restore();
    }
});

test('C2-15: getAccountSlots and updateAccountSlot preserve primitive and null values in slots', async () => {
    const { store, restore } = setupMockStorage({
        gemini_account_slots: {
            u0: { slot: 'u0', name: 'Primary Account' },
            legacy_bool: true,
            tombstone: null
        }
    });
    try {
        const slots = await getAccountSlots();
        assert.strictEqual(slots['u0']?.name, 'Primary Account');
        assert.strictEqual((slots as any)['legacy_bool'], true);
        assert.strictEqual((slots as any)['tombstone'], null);

        // Updating slot does not strip other entries
        await updateAccountSlot('u0', { email: 'primary@example.com' });
        const updatedStore = store['gemini_account_slots'];
        assert.strictEqual(updatedStore['u0'].name, 'Primary Account');
        assert.strictEqual(updatedStore['u0'].email, 'primary@example.com');
        assert.strictEqual(updatedStore['legacy_bool'], true);
        assert.strictEqual(updatedStore['tombstone'], null);
    } finally {
        restore();
    }
});

test('C2 review: last-sync reads keep historical truthiness without finite-number normalization', async () => {
    const fixture = setupMockStorage();
    const { getLastSync } = require('../src/core/storage/storageService.js');
    try {
        for (const [timestamp, count] of [[0, 0], ['legacy-time', '7'], [Infinity, Infinity], [false, null], [{ legacy: true }, true]]) {
            fixture.store.gemini_last_sync = timestamp;
            fixture.store.gemini_last_count = count;
            const value = await getLastSync('u0');
            assert.strictEqual(value.timestamp, timestamp || null);
            assert.strictEqual(value.count, count || 0);
        }
    } finally { fixture.restore(); }
});


test('C2 follow-up: incompatible export and slot objects survive reads and writeback', async () => {
    const exported = { exportedAt: null, title: 7, files: [42], extension: true };
    const profile = { name: { historical: true }, count: '3', extension: ['retained'] };
    const fixture = setupMockStorage({ exportedIds: { c_legacy: exported, scalar: true }, gemini_account_slots: { u1: profile, u2: null, u3: 12 } });
    try {
        assert.strictEqual((await getExportedIds('u0')).legacy, exported);
        await saveExportRecord('u0', 'new', { exportedAt: 123 });
        assert.strictEqual((await getExportedIds('u0')).legacy, exported);
        const slots = await getAccountSlots();
        assert.strictEqual(slots.u1, profile);
        await updateAccountSlot('u0', { email: 'current@example.com' });
        const after = await getAccountSlots();
        assert.strictEqual(after.u1, profile);
        assert.strictEqual(after.u2, null);
        assert.strictEqual(after.u3, 12);
        assert.deepStrictEqual(after.u1, { name: { historical: true }, count: '3', extension: ['retained'] });
    } finally { fixture.restore(); }
});

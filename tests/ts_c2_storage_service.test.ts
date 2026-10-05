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
    updateAccountSlot
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

test('C2-2: conversation roundtrip slims messages and preserves typed fields', async () => {
    const { store, restore } = setupMockStorage();
    try {
        const conv = {
            id: 'conv_1',
            title: 'Roundtrip Test',
            timestamp: 1700000000000,
            messageCount: 2,
            messages: [
                { role: 'user', content: 'hello' },
                { role: 'model', content: 'world' }
            ]
        };

        await setConversations('u0', [conv]);

        // Stored list must have messages stripped (slimming contract)
        const storedList = store['gemini_conversations'];
        assert.ok(Array.isArray(storedList));
        assert.strictEqual(storedList.length, 1);
        assert.strictEqual(storedList[0].id, 'conv_1');
        assert.strictEqual(storedList[0].title, 'Roundtrip Test');
        assert.strictEqual(storedList[0].messageCount, 2);
        assert.strictEqual(storedList[0].messages, undefined);

        // getConversations returns valid Conversation[]
        const fetched = await getConversations('u0');
        assert.strictEqual(fetched.length, 1);
        assert.strictEqual(fetched[0].id, 'conv_1');
        assert.strictEqual(fetched[0].title, 'Roundtrip Test');
    } finally {
        restore();
    }
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
        await setConversations('u0', [{ id: 'conv_lock', title: 'Lock Test', timestamp: 1 }]);
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
                await setConversations('u0', [{ id: 'fail_conv', title: 'Fails', timestamp: 1 }]);
            },
            /Simulated write failure/
        );

        // Second write queued immediately after MUST succeed and not hang
        await setConversations('u0', [{ id: 'ok_conv', title: 'Succeeds', timestamp: 2 }]);

        const fetched = await getConversations('u0');
        assert.strictEqual(fetched.length, 1);
        assert.strictEqual(fetched[0].id, 'ok_conv');
        assert.strictEqual(store['gemini_conversations'] !== undefined, true);
    } finally {
        restore();
    }
});

test('C2-7: finalize existing conversation updates metadata and returns ok', async () => {
    const { store, restore } = setupMockStorage({
        gemini_conversations: [
            { id: 'c_exist', title: 'Original Title', timestamp: 1000, messageCount: 2 }
        ]
    });
    try {
        let callbackCalled = false;
        const res = await finalizeConversationExport(
            'u0',
            'c_exist',
            { exportedAt: 2000, format: 'markdown', status: 'ok', title: 'Exported Title' },
            {
                conversationUpdate: {
                    title: 'Updated Title',
                    titleSource: 'rpc',
                    messageCount: 5,
                    updatedAt: 3000
                },
                onItemExported: (id: string, rec: any) => {
                    assert.strictEqual(id, 'exist');
                    assert.strictEqual(rec.status, 'ok');
                    callbackCalled = true;
                }
            }
        );

        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.record.status, 'ok');
        assert.strictEqual(callbackCalled, true);

        const convs = store['gemini_conversations'];
        assert.strictEqual(convs[0].title, 'Updated Title');
        assert.strictEqual(convs[0].titleSource, 'rpc');
        assert.strictEqual(convs[0].messageCount, 5);
        assert.strictEqual(convs[0].updatedAt, 3000);
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

test('C2-9: messageCount and timestamp advance monotonically', async () => {
    const { store, restore } = setupMockStorage({
        gemini_conversations: [
            { id: 'c_mono', title: 'Mono Test', timestamp: 5000, updatedAt: 5000, messageCount: 10 }
        ]
    });
    try {
        // Attempt update with smaller messageCount and older timestamp
        await finalizeConversationExport(
            'u0',
            'c_mono',
            { exportedAt: 6000, status: 'ok' },
            {
                conversationUpdate: {
                    messageCount: 3, // Smaller than 10
                    updatedAt: 2000 // Older than 5000
                }
            }
        );

        let convs = store['gemini_conversations'];
        assert.strictEqual(convs[0].messageCount, 10, 'messageCount must not decrease');
        assert.strictEqual(convs[0].updatedAt, 5000, 'updatedAt must not rewind');

        // Now attempt update with larger messageCount and newer timestamp
        await finalizeConversationExport(
            'u0',
            'c_mono',
            { exportedAt: 7000, status: 'ok' },
            {
                conversationUpdate: {
                    messageCount: 15,
                    updatedAt: 8000
                }
            }
        );

        convs = store['gemini_conversations'];
        assert.strictEqual(convs[0].messageCount, 15, 'messageCount must advance');
        assert.strictEqual(convs[0].updatedAt, 8000, 'updatedAt must advance forward');
    } finally {
        restore();
    }
});

test('C2-10: missing-conversation registration creates conversation with clean metadata', async () => {
    const { store, restore } = setupMockStorage({
        gemini_conversations: []
    });
    try {
        const res = await finalizeConversationExport(
            'u0',
            'c_new_chat',
            { exportedAt: 5000, title: 'Brand New Chat', status: 'ok', messageCount: 4, chatTime: 4000 },
            {
                conversationUpdate: {
                    title: 'Brand New Chat',
                    titleSource: 'rpc',
                    titles: { rpc: 'Brand New Chat' },
                    messageCount: 4
                }
            }
        );

        assert.strictEqual(res.ok, true);
        const convs = store['gemini_conversations'];
        assert.strictEqual(convs.length, 1);
        assert.strictEqual(convs[0].id, 'new_chat');
        assert.strictEqual(convs[0].title, 'Brand New Chat');
        assert.strictEqual(convs[0].titleSource, 'rpc');
        assert.strictEqual(convs[0].titles?.rpc, 'Brand New Chat');
        assert.strictEqual(convs[0].messageCount, 4);
        assert.strictEqual(convs[0].timestamp, undefined, 'timestamp must remain missing on registered newConv');
        assert.strictEqual(convs[0].updatedAt, 4000, 'updatedAt must be populated from export chatTime');
    } finally {
        restore();
    }
});

test('C2-11: title writeback enforces provenance arbitration without downgrade', async () => {
    const { store, restore } = setupMockStorage({
        gemini_conversations: [
            {
                id: 'c_arb',
                title: 'RPC Authoritative Title',
                titleSource: 'rpc',
                titles: { rpc: 'RPC Authoritative Title' },
                timestamp: 1000
            }
        ]
    });
    try {
        // Weaker takeout candidate cannot downgrade RPC title
        await finalizeConversationExport(
            'u0',
            'c_arb',
            { exportedAt: 2000, status: 'ok', title: 'Takeout Older Title' },
            {
                conversationUpdate: {
                    title: 'Takeout Older Title',
                    titleSource: 'takeout',
                    titles: { takeout: 'Takeout Older Title' }
                }
            }
        );

        const convs = store['gemini_conversations'];
        assert.strictEqual(convs[0].title, 'RPC Authoritative Title', 'RPC title must prevail');
        assert.strictEqual(convs[0].titleSource, 'rpc');
        assert.strictEqual(convs[0].titles?.takeout, 'Takeout Older Title');
        assert.strictEqual(convs[0].titles?.rpc, 'RPC Authoritative Title');
    } finally {
        restore();
    }
});

test('C2-12: removeConversation cleans up conversation, details, and export records', async () => {
    const { store, restore } = setupMockStorage({
        gemini_conversations: [
            { id: 'c_target', title: 'Target', timestamp: 1 },
            { id: 'c_keep', title: 'Keep', timestamp: 2 }
        ],
        exportedIds: {
            target: { exportedAt: 10, status: 'ok' },
            c_target: { exportedAt: 10, status: 'ok' },
            keep: { exportedAt: 20, status: 'ok' }
        }
    });
    try {
        const removed = await removeConversation('u0', 'c_target');
        assert.strictEqual(removed, true);

        const convs = store['gemini_conversations'];
        assert.strictEqual(convs.length, 1);
        assert.strictEqual(convs[0].id, 'c_keep');

        const exports = store['exportedIds'];
        assert.strictEqual(exports['target'], undefined);
        assert.strictEqual(exports['c_target'], undefined);
        assert.strictEqual(exports['keep'] !== undefined, true);
    } finally {
        restore();
    }
});

test('C2-13: getConversations preserves historical partial metadata rows without filtering or mutation', async () => {
    const historicalRows = [
        { id: 'part_1' },
        { id: 'part_2', title: 'Only Title' },
        { id: 'part_3', timestamp: null, extraField: 'custom_value' }
    ];
    const { store, restore } = setupMockStorage({
        gemini_conversations: historicalRows
    });
    try {
        const fetched = await getConversations('u0');
        assert.strictEqual(fetched.length, 3);
        assert.strictEqual(fetched[0].id, 'part_1');
        assert.strictEqual((fetched[0] as any).title, undefined);
        assert.strictEqual(fetched[1].title, 'Only Title');
        assert.strictEqual((fetched[2] as any).extraField, 'custom_value');

        // Roundtrip via setConversations preserves rows
        await setConversations('u0', fetched);
        const stored = store['gemini_conversations'];
        assert.strictEqual(stored.length, 3);
        assert.strictEqual(stored[0].id, 'part_1');
        assert.strictEqual(stored[2].extraField, 'custom_value');
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

test('C2-16: finalizeConversationExport preserves {ok: true, record} and missing timestamp semantics', async () => {
    const { store, restore } = setupMockStorage({
        gemini_conversations: []
    });
    try {
        const customRecord = { format: 'typst', exportedAt: 9999, customProp: 'hello' };
        const res = await finalizeConversationExport(
            'u0',
            'c_fresh_chat',
            customRecord,
            {
                conversationUpdate: {
                    title: 'Fresh Chat Without Timestamp'
                }
            }
        );

        // Return shape must be exact { ok: true, record }
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.record, customRecord);
        assert.strictEqual((res.record as any).customProp, 'hello');

        const convs = store['gemini_conversations'];
        assert.strictEqual(convs.length, 1);
        assert.strictEqual(convs[0].id, 'fresh_chat');
        assert.strictEqual(convs[0].title, 'Fresh Chat Without Timestamp');
        // Missing timestamp in original registration must NOT be injected
        assert.strictEqual(convs[0].timestamp, undefined, 'timestamp must remain missing');
        assert.ok(typeof convs[0].updatedAt === 'number' && convs[0].updatedAt > 0, 'updatedAt must be generated');
    } finally {
        restore();
    }
});

export {};
const test = require('node:test');
const assert = require('node:assert');
const StorageService = require('../src/core/storage/storageService.js');

test('storage_service - normSlot', () => {
    assert.strictEqual(StorageService.normSlot(null), 'u0');
    assert.strictEqual(StorageService.normSlot(''), 'u0');
    assert.strictEqual(StorageService.normSlot('default'), 'u0');
    assert.strictEqual(StorageService.normSlot('u0'), 'u0');
    assert.strictEqual(StorageService.normSlot('u1'), 'u1');
    assert.strictEqual(StorageService.normSlot('u2'), 'u2');
});

test('storage_service - getStorageKeys', () => {
    const keys0 = StorageService.getStorageKeys('u0');
    assert.strictEqual(keys0.convKey, 'gemini_conversations');
    assert.strictEqual(keys0.expKey, 'exportedIds');

    const keys1 = StorageService.getStorageKeys('u1');
    assert.strictEqual(keys1.convKey, 'gemini_conversations_u1');
    assert.strictEqual(keys1.expKey, 'gemini_exported_u1');
});

test('storage_service - reconcileConversations preserves takeout entries and purges deleted cloud entries', async () => {
    const mockStorage: Record<string, any> = {};
    const origChrome = (global as any).chrome;
    (global as any).chrome = {
        storage: {
            local: {
                get: async (keys: any) => {
                    if (keys === null) return { ...mockStorage };
                    if (typeof keys === 'string') keys = [keys];
                    const res: Record<string, any> = {};
                    for (const k of (keys || [])) {
                        if (k in mockStorage) res[k] = mockStorage[k];
                    }
                    return res;
                },
                set: async (obj: any) => {
                    Object.assign(mockStorage, obj);
                },
                remove: async (keys: any) => {
                    if (typeof keys === 'string') keys = [keys];
                    for (const k of (keys || [])) delete mockStorage[k];
                }
            }
        }
    };

    try {
        await StorageService.setConversations('u0', [
            { id: 'chat_active_1', title: 'Active Chat 1', source: 'network-list', timestamp: 1700000000000 },
            { id: 'chat_deleted', title: 'Deleted Cloud Chat', source: 'network-list', timestamp: 1700000000000 },
            { id: 'chat_takeout_only', title: 'Takeout Imported Chat', source: 'takeout', isTakeoutOnly: true, timestamp: 1700000000000 }
        ]);

        const activeCloud = [{ id: 'chat_active_1', title: 'Active Chat 1' }];
        const result = await StorageService.reconcileConversations('u0', activeCloud);
        assert.strictEqual(result.kept, 2, 'should keep active chat and takeout chat');
        assert.strictEqual(result.removed, 1, 'should remove deleted cloud chat');
        assert.deepStrictEqual(result.removedIds, ['chat_deleted']);

        const remaining = await StorageService.getConversations('u0');
        assert.strictEqual(remaining.length, 2);
        assert.ok(remaining.some((c: any) => c.id === 'chat_active_1'));
        assert.ok(remaining.some((c: any) => c.id === 'chat_takeout_only'));
    } finally {
        (global as any).chrome = origChrome;
    }
});

test('format_store - normalizeFormat validates against allowed formats and devMode', () => {
    const FormatStore = require('../src/core/storage/formatStore.js');
    assert.strictEqual(FormatStore.normalizeFormat('markdown', false), 'markdown');
    assert.strictEqual(FormatStore.normalizeFormat('json_openai', false), 'json_openai');
    assert.strictEqual(FormatStore.normalizeFormat('unknown_format', false), 'markdown');

    assert.strictEqual(FormatStore.normalizeFormat('json_raw', false), 'markdown');
    assert.strictEqual(FormatStore.normalizeFormat('json_raw', true), 'json_raw');
});

test('storage_service - two-tier storage offloads messages to detail store and slims chrome.storage.local', async () => {
    const mockStorage: Record<string, any> = {};
    const origChrome = (global as any).chrome;
    (global as any).chrome = {
        storage: {
            local: {
                get: async (keys: any) => {
                    if (keys === null) return { ...mockStorage };
                    if (typeof keys === 'string') keys = [keys];
                    const res: Record<string, any> = {};
                    for (const k of (keys || [])) {
                        if (k in mockStorage) res[k] = mockStorage[k];
                    }
                    return res;
                },
                set: async (obj: any) => {
                    Object.assign(mockStorage, obj);
                },
                remove: async (keys: any) => {
                    if (typeof keys === 'string') keys = [keys];
                    for (const k of (keys || [])) delete mockStorage[k];
                }
            }
        }
    };

    try {
        const fullMessages = [
            { id: 'm1', role: 'user', content: 'Explain quantum computing in detail...' },
            { id: 'm2', role: 'model', content: 'Quantum computing uses qubits...' }
        ];

        await StorageService.setConversations('u0', [
            {
                id: 'chat_heavy_1',
                title: 'Quantum Chat',
                messages: fullMessages,
                turns: [{ user: 'Explain quantum', model: 'Quantum computing' }],
                timestamp: 1700000000000
            }
        ]);

        // 1. Verify chrome.storage.local has slimmed metadata only
        const localList = mockStorage['gemini_conversations'];
        assert.ok(Array.isArray(localList));
        assert.strictEqual(localList.length, 1);
        const storedMeta = localList[0];
        assert.strictEqual(storedMeta.id, 'chat_heavy_1');
        assert.strictEqual(storedMeta.title, 'Quantum Chat');
        assert.strictEqual(storedMeta.messages, undefined, 'messages must be stripped from chrome.storage.local');
        assert.strictEqual(storedMeta.turns, undefined, 'turns must be stripped from chrome.storage.local');
        assert.strictEqual(storedMeta.messageCount, 2, 'messageCount must be preserved as 2');

        // 2. Verify details are accessible via getConversationDetail
        const detail = await StorageService.getConversationDetail('chat_heavy_1');
        assert.ok(detail);
        assert.strictEqual(detail.id, 'chat_heavy_1');
        assert.strictEqual(detail.messages.length, 2);
        assert.strictEqual(detail.messages[0].content, 'Explain quantum computing in detail...');

        // 3. Verify getConversationWithDetail reconstructs full object
        const full = await StorageService.getConversationWithDetail('u0', 'chat_heavy_1');
        assert.ok(full);
        assert.strictEqual(full.id, 'chat_heavy_1');
        assert.strictEqual(full.title, 'Quantum Chat');
        assert.strictEqual(full.messages.length, 2);
        assert.strictEqual(full.turns.length, 1);

        // 4. Verify removeConversation purges details as well
        await StorageService.removeConversation('u0', 'chat_heavy_1');
        assert.strictEqual(mockStorage['gemini_conversations'].length, 0);
        const detailAfterDelete = await StorageService.getConversationDetail('chat_heavy_1');
        assert.strictEqual(detailAfterDelete, null, 'detail must be purged on conversation removal');
    } finally {
        (global as any).chrome = origChrome;
    }
});

test('storage_service - auto-migrates legacy conversations with embedded messages', async () => {
    const mockStorage: Record<string, any> = {
        'gemini_conversations': [
            {
                id: 'legacy_chat',
                title: 'Legacy Chat',
                messages: [{ id: 'm1', role: 'user', content: 'Legacy Message' }],
                timestamp: 1700000000000
            }
        ]
    };
    const origChrome = (global as any).chrome;
    (global as any).chrome = {
        storage: {
            local: {
                get: async (keys: any) => {
                    if (keys === null) return { ...mockStorage };
                    if (typeof keys === 'string') keys = [keys];
                    const res: Record<string, any> = {};
                    for (const k of (keys || [])) {
                        if (k in mockStorage) res[k] = mockStorage[k];
                    }
                    return res;
                },
                set: async (obj: any) => {
                    Object.assign(mockStorage, obj);
                },
                remove: async (keys: any) => {
                    if (typeof keys === 'string') keys = [keys];
                    for (const k of (keys || [])) delete mockStorage[k];
                }
            }
        }
    };

    try {
        // Calling getConversations triggers background auto-migration
        const list = await StorageService.getConversations('u0');
        assert.strictEqual(list.length, 1);

        // Give microtasks / lock time to finish migration
        await new Promise(r => setTimeout(r, 50));

        // Verify that chrome.storage.local was slimmed down
        const slimmedList = mockStorage['gemini_conversations'];
        assert.strictEqual(slimmedList[0].messages, undefined);
        assert.strictEqual(slimmedList[0].messageCount, 1);

        // Verify that detail is now in detail store
        const detail = await StorageService.getConversationDetail('legacy_chat');
        assert.ok(detail);
        assert.strictEqual(detail.messages[0].content, 'Legacy Message');
    } finally {
        (global as any).chrome = origChrome;
    }
});


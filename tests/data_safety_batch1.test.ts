import { useIndexStorage } from './helpers/indexStorage.js';
useIndexStorage();
import { indexFixture } from './helpers/indexFixture.js';
export {};
const test = require('node:test');
const assert = require('node:assert');

// 2. D2: Narrowed error detection
test('D2: BatchWorker does not delete conversation when error contains 11167 or other non-deletion numbers', async () => {
    const BatchWorker = require('../src/core/engine/export/batchWorker.js');
    const { __setModuleOverride, __clearModuleOverrides } = require('../src/core/utils/moduleOverrides.js');

    let removedId: string | null = null;
    const mockStorage = {
        removeConversation: async (_slot: string, id: string) => {
            removedId = id;
            return true;
        }
    };
    __setModuleOverride('StorageService', mockStorage);

    try {
        const logs: string[] = [];
        const chatWith11167 = {
            id: 'chat_safe_1',
            title: 'Safe Chat',
            messages: [],
            error: 'Server returned error code 11167',
            _empty: true
        };
        const reqItem = { id: 'chat_safe_1', title: 'Safe Chat' };

        const res = await BatchWorker.resolveChat(
            chatWith11167,
            reqItem,
            null,
            null,
            'u0',
            () => {},
            (msg: string) => logs.push(msg)
        );

        assert.strictEqual(removedId, null, '11167 must NOT trigger removeConversation');
        assert.strictEqual(res.isConfirmedDeleted, false);
    } finally {
        __clearModuleOverrides();
    }
});

test('D2: BatchWorker confirms deletion but retains local metadata on BardErrorInfo: 1167 or 404', async () => {
    const BatchWorker = require('../src/core/engine/export/batchWorker.js');
    const { __setModuleOverride, __clearModuleOverrides } = require('../src/core/utils/moduleOverrides.js');

    let removedId: string | null = null;
    const mockStorage = {
        removeConversation: async (_slot: string, id: string) => {
            removedId = id;
            return true;
        }
    };
    __setModuleOverride('StorageService', mockStorage);

    try {
        const logs: string[] = [];
        const deletedChat = {
            id: 'chat_del_1',
            title: 'Deleted Chat',
            messages: [],
            error: '会话已在服务端删除 (chat_del_1) [BardErrorInfo: 1167]',
            _empty: true
        };
        const reqItem = { id: 'chat_del_1', title: 'Deleted Chat' };

        const res = await BatchWorker.resolveChat(
            deletedChat,
            reqItem,
            null,
            null,
            'u0',
            () => {},
            (msg: string) => logs.push(msg)
        );

        assert.strictEqual(removedId, null, 'Confirmed deletion must retain the local archive');
        assert.ok(logs.some(message => message.includes('retained')));
        assert.strictEqual(res.isConfirmedDeleted, true);
    } finally {
        __clearModuleOverrides();
    }
});

// 3. D4: Clear All clears list, details, checkpoint, and exported records
test('D4: StorageService.clearConversations cleans up checkpoint and exported records map', async () => {
    const StorageService = require('../src/core/storage/storageService.js');

    const mockStore: Record<string, any> = {
        gemini_conversations: ([{ id: 'chat_1', title: 'Chat 1' }]).map(indexFixture),
        gemini_last_count: 1,
        gemini_scan_checkpoint: 1700000000000,
        exportedIds: { 'chat_1': { status: 'ok', exportedAt: 1700000000000 } }
    };

    const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    try {
    (globalThis as any).chrome = {
        storage: {
            local: {
                get: async (keys: any) => {
                    const out: Record<string, any> = {};
                    const arr = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(mockStore));
                    for (const k of arr) {
                        if (mockStore[k] !== undefined) out[k] = mockStore[k];
                    }
                    return out;
                },
                set: async (items: Record<string, any>) => {
                    Object.assign(mockStore, items);
                },
                remove: async (keys: any) => {
                    const arr = Array.isArray(keys) ? keys : [keys];
                    for (const k of arr) {
                        delete mockStore[k];
                    }
                }
            }
        }
    };

    await StorageService.clearConversations('u0');

    assert.deepStrictEqual(mockStore.gemini_conversations, []);
    assert.strictEqual(mockStore.gemini_last_count, 0);
    assert.strictEqual(mockStore.gemini_scan_checkpoint, undefined, 'Scan checkpoint must be removed');
    assert.deepStrictEqual(mockStore.exportedIds, {}, 'Exported records must be emptied');

    const checkpoint = await StorageService.getScanCoverage('u0');
    assert.strictEqual(checkpoint, null, 'getScanCoverage must return null after clearConversations');
    } finally {
        if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
        else delete (globalThis as any).chrome;
    }
});

// 4. Page-world deletion notices must be verified by the active content tab, not trusted as deletion commands.
test('MessageBridge rejects malformed deletion IDs and verifies valid events in the active account', async () => {
    const MessageBridge = require('../src/content/messageBridge.js');
    const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    const sent: any[] = [];
    let removedCalled = false;
    try {
        (globalThis as any).chrome = {
            runtime: {
                sendMessage: async (message: unknown) => {
                    sent.push(message);
                    return { data: { isDeleted: true } };
                }
            }
        };
        const api = MessageBridge.init({
            Storage: { removeConversation: async () => { removedCalled = true; return true; } },
            getAccountSlot: () => 'u0',
            upsertConversations: async () => {}
        });
        const event = (id: string, slot: string) => ({
            origin: typeof location === 'undefined' ? undefined : location.origin,
            source: typeof window === 'undefined' ? null : window,
            data: { type: 'GEMINI_CONVERSATION_DELETED', payload: { id, slot } }
        });
        await api.handleWindowMessage(event('../../malicious/path', 'u999'));
        assert.deepStrictEqual(sent, [], 'malformed IDs cannot trigger a background fetch');
        await api.handleWindowMessage(event('c_12345678abcdef', 'u999'));
        assert.deepStrictEqual(sent, [{
            action: 'fetchChat',
            conversationId: 'c_12345678abcdef',
            accountSlot: 'u0'
        }], 'valid page events verify through the active content account, not the injected slot');
        assert.strictEqual(removedCalled, false, 'untrusted page-world deletion never removes the local archive');
    } finally {
        if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
        else delete (globalThis as any).chrome;
    }
});

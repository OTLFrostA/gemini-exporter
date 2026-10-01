export {};
const test = require('node:test');
const assert = require('node:assert');
const StorageService = require('../src/core/storage/storageService.js');

function createMockChromeStorage(initialData: Record<string, any> = {}) {
    const mockStorage: Record<string, any> = { ...initialData };
    return {
        mockStorage,
        chrome: {
            storage: {
                local: {
                    get: async (keys: any) => {
                        if (keys === null || keys === undefined) return { ...mockStorage };
                        if (typeof keys === 'string') keys = [keys];
                        const res: Record<string, any> = {};
                        for (const k of (keys || [])) {
                            if (mockStorage[k] !== undefined) res[k] = mockStorage[k];
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
        }
    };
}

test('finalizeConversationExport: promotes generic placeholder title to authoritative export title', async () => {
    const { mockStorage, chrome } = createMockChromeStorage({
        gemini_conversations: [
            { id: 'c_abc123', title: '未命名对话', titleSource: 'default', messageCount: 1, updatedAt: 1000 }
        ]
    });
    const origChrome = (global as any).chrome;
    (global as any).chrome = chrome;

    try {
        let callbackCalled = false;
        const res = await StorageService.finalizeConversationExport('u0', 'c_abc123', {
            title: '量子纠缠推演报告',
            format: 'markdown',
            exportedAt: new Date(2000).toISOString(),
            status: 'ok',
            messageCount: 5,
            chatTime: 2000
        }, {
            conversationUpdate: {
                title: '量子纠缠推演报告',
                titleSource: 'api-detail',
                messageCount: 5,
                updatedAt: 2000
            },
            onItemExported: (id: string, record: any) => {
                assert.strictEqual(id, StorageService.normId('c_abc123'));
                assert.strictEqual(record.title, '量子纠缠推演报告');
                callbackCalled = true;
            }
        });

        assert.strictEqual(res.ok, true);
        assert.strictEqual(callbackCalled, true);

        // Verify exportedIds SSoT
        const expMap = await StorageService.getExportedIds('u0');
        assert.ok(expMap['abc123']);
        assert.strictEqual(expMap['abc123'].title, '量子纠缠推演报告');
        assert.strictEqual(expMap['abc123'].status, 'ok');

        // Verify gemini_conversations promotion
        const convs = await StorageService.getConversations('u0');
        assert.strictEqual(convs.length, 1);
        assert.strictEqual(convs[0].title, '量子纠缠推演报告');
        assert.strictEqual(convs[0].titleSource, 'api-detail');
        assert.strictEqual(convs[0].messageCount, 5);
        assert.strictEqual(convs[0].updatedAt, 2000);
    } finally {
        (global as any).chrome = origChrome;
    }
});

test('finalizeConversationExport: prevents downgrade of higher-authority RPC title', async () => {
    const { mockStorage, chrome } = createMockChromeStorage({
        gemini_conversations: [
            {
                id: 'c_xyz789',
                title: '线上RPC权威标题',
                titleSource: 'rpc',
                titles: { rpc: '线上RPC权威标题' },
                messageCount: 2
            }
        ]
    });
    const origChrome = (global as any).chrome;
    (global as any).chrome = chrome;

    try {
        await StorageService.finalizeConversationExport('u0', 'c_xyz789', {
            title: 'Takeout旧标题',
            format: 'markdown',
            exportedAt: new Date().toISOString(),
            status: 'ok'
        }, {
            conversationUpdate: {
                title: 'Takeout旧标题',
                titleSource: 'takeout',
                titles: { takeout: 'Takeout旧标题' }
            }
        });

        const convs = await StorageService.getConversations('u0');
        assert.strictEqual(convs[0].title, '线上RPC权威标题', '权威RPC标题绝不能被takeout旧标题降级覆盖');
        assert.strictEqual(convs[0].titleSource, 'rpc');
        assert.strictEqual(convs[0].titles.takeout, 'Takeout旧标题');
    } finally {
        (global as any).chrome = origChrome;
    }
});

test('finalizeConversationExport: automatically registers brand new conversation at top of list', async () => {
    const { mockStorage, chrome } = createMockChromeStorage({
        gemini_conversations: [
            { id: 'c_older_chat', title: 'Older Chat', messageCount: 1 }
        ]
    });
    const origChrome = (global as any).chrome;
    (global as any).chrome = chrome;

    try {
        await StorageService.finalizeConversationExport('u0', 'c_brand_new', {
            title: '全新实时发帖对话',
            format: 'markdown',
            exportedAt: new Date().toISOString(),
            messageCount: 2,
            status: 'ok'
        });

        const convs = await StorageService.getConversations('u0');
        assert.strictEqual(convs.length, 2);
        assert.strictEqual(convs[0].id, 'brand_new', '新会话必须登记在列表首位');
        assert.strictEqual(convs[0].title, '全新实时发帖对话');
        assert.strictEqual(convs[0].messageCount, 2);
    } finally {
        (global as any).chrome = origChrome;
    }
});

test('finalizeConversationExport: skipConversationUpdate respects flag', async () => {
    const { mockStorage, chrome } = createMockChromeStorage({
        gemini_conversations: [
            { id: 'c_skip_test', title: 'Original Title', messageCount: 1 }
        ]
    });
    const origChrome = (global as any).chrome;
    (global as any).chrome = chrome;

    try {
        await StorageService.finalizeConversationExport('u0', 'c_skip_test', {
            title: 'Different Title',
            status: 'ok'
        }, {
            skipConversationUpdate: true
        });

        // exportedIds should be saved
        const expMap = await StorageService.getExportedIds('u0');
        assert.ok(expMap['skip_test']);

        // conversation should NOT be changed
        const convs = await StorageService.getConversations('u0');
        assert.strictEqual(convs[0].title, 'Original Title');
    } finally {
        (global as any).chrome = origChrome;
    }
});

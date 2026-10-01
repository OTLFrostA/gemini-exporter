export {};
const test = require('node:test');
const assert = require('node:assert');
const { normId } = require('../src/core/utils/pathUtils.js');
const StorageService = require('../src/core/storage/storageService.js');
const {
    buildExportCompletion,
    completeConversationExport,
    computeExportMessageCount,
    computeAuthoritativeTimestamp,
    resolveExportRecordStatus
} = require('../src/core/engine/export/exportCompletion.js');

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

// 1. Batch production-shape: no conversationUpdate provided, generic existing title promoted
test('1. Batch production-shape: promotes generic title to real export title without fake provenance', async () => {
    const { mockStorage, chrome } = createMockChromeStorage({
        gemini_conversations: [
            { id: 'c_batch_1', title: '未命名对话', titleSource: 'default', messageCount: 1, updatedAt: 1000 }
        ]
    });
    const origChrome = (global as any).chrome;
    (global as any).chrome = chrome;

    try {
        let callbackCalled = false;
        // Batch pipeline call shape from sessionRecovery: only passes record and onItemExported
        const res = await StorageService.finalizeConversationExport(
            'u0',
            'c_batch_1',
            {
                title: '量子纠缠推演报告',
                format: 'markdown',
                exportedAt: new Date(2000).toISOString(),
                status: 'ok',
                messageCount: 5,
                chatTime: 2000
            },
            {
                onItemExported: (id: string, record: any) => {
                    assert.strictEqual(id, 'batch_1');
                    assert.strictEqual(record.title, '量子纠缠推演报告');
                    callbackCalled = true;
                }
            }
        );

        assert.strictEqual(res.ok, true);
        assert.strictEqual(callbackCalled, true);

        // Verify exportedIds SSoT
        const expMap = await StorageService.getExportedIds('u0');
        assert.ok(expMap['batch_1']);
        assert.strictEqual(expMap['batch_1'].title, '量子纠缠推演报告');

        // Verify gemini_conversations promotion: promoted to real title, source is 'legacy' (not fake api-detail/export)
        const convs = await StorageService.getConversations('u0');
        assert.strictEqual(convs.length, 1);
        assert.strictEqual(convs[0].title, '量子纠缠推演报告');
        assert.strictEqual(convs[0].titleSource, 'legacy');
        assert.notStrictEqual(convs[0].titleSource, 'api-detail', 'Must not synthesize fake api-detail provenance');
        assert.notStrictEqual(convs[0].titleSource, 'export', 'Must not synthesize unindexed export tier');
        assert.strictEqual(convs[0].messageCount, 5);
    } finally {
        (global as any).chrome = origChrome;
    }
});

// 2. Unknown candidate does NOT overwrite authoritative RPC title
test('2. Unknown candidate does NOT overwrite authoritative RPC title', async () => {
    const { mockStorage, chrome } = createMockChromeStorage({
        gemini_conversations: [
            {
                id: 'c_rpc_chat',
                title: '线上RPC权威标题',
                titleSource: 'rpc',
                titles: { rpc: '线上RPC权威标题' },
                messageCount: 3
            }
        ]
    });
    const origChrome = (global as any).chrome;
    (global as any).chrome = chrome;

    try {
        await StorageService.finalizeConversationExport(
            'u0',
            'c_rpc_chat',
            {
                title: '某种未提供来源的候选标题',
                format: 'markdown',
                exportedAt: new Date().toISOString(),
                status: 'ok'
            }
        );

        const convs = await StorageService.getConversations('u0');
        assert.strictEqual(convs[0].title, '线上RPC权威标题', '权威RPC标题绝不能被无来源候选标题覆盖');
        assert.strictEqual(convs[0].titleSource, 'rpc');
    } finally {
        (global as any).chrome = origChrome;
    }
});

// 3. Unknown candidate does NOT overwrite API-detail or Takeout existing real titles
test('3. Unknown candidate does NOT overwrite API-detail or Takeout existing real titles', async () => {
    const { mockStorage, chrome } = createMockChromeStorage({
        gemini_conversations: [
            {
                id: 'c_api_chat',
                title: 'API详细端权威标题',
                titleSource: 'api-detail',
                titles: { 'api-detail': 'API详细端权威标题' },
                messageCount: 2
            },
            {
                id: 'c_takeout_chat',
                title: 'Takeout历史真实标题',
                titleSource: 'takeout',
                titles: { takeout: 'Takeout历史真实标题' },
                messageCount: 4
            }
        ]
    });
    const origChrome = (global as any).chrome;
    (global as any).chrome = chrome;

    try {
        // Attempt overwrite on API-detail
        await StorageService.finalizeConversationExport('u0', 'c_api_chat', {
            title: '无来源导出标题A',
            status: 'ok'
        });
        // Attempt overwrite on Takeout
        await StorageService.finalizeConversationExport('u0', 'c_takeout_chat', {
            title: '无来源导出标题B',
            status: 'ok'
        });

        const convs = await StorageService.getConversations('u0');
        const apiChat = convs.find((c: any) => normId(c.id) === 'api_chat');
        const takeoutChat = convs.find((c: any) => normId(c.id) === 'takeout_chat');

        assert.strictEqual(apiChat.title, 'API详细端权威标题', 'api-detail 绝不能被无来源候选标题覆盖');
        assert.strictEqual(apiChat.titleSource, 'api-detail');

        assert.strictEqual(takeoutChat.title, 'Takeout历史真实标题', 'takeout 真实标题绝不能被无来源候选标题覆盖');
        assert.strictEqual(takeoutChat.titleSource, 'takeout');
    } finally {
        (global as any).chrome = origChrome;
    }
});

// 4. Live titleSource = default: promotes generic title without synthesizing fake api-detail
test('4. Live titleSource = default: promotes generic title without synthesizing fake api-detail', async () => {
    const { mockStorage, chrome } = createMockChromeStorage({
        gemini_conversations: [
            { id: 'c_live_chat', title: '未命名对话', titleSource: 'default', messageCount: 1 }
        ]
    });
    const origChrome = (global as any).chrome;
    (global as any).chrome = chrome;

    try {
        const liveChatObj = {
            id: 'c_live_chat',
            title: '未命名对话',
            titleSource: 'default',
            messages: [{ role: 'user', content: 'hello' }, { role: 'model', content: 'world' }]
        };

        await completeConversationExport(
            StorageService,
            'u0',
            {
                conversation: liveChatObj,
                conversationId: 'c_live_chat',
                format: 'markdown',
                exportedAt: Date.now(),
                titleCandidate: '流式量子分析报告',
                titleProvenance: liveChatObj.titleSource // 'default'
            }
        );

        const convs = await StorageService.getConversations('u0');
        assert.strictEqual(convs[0].title, '流式量子分析报告', '未命名对话应成功晋级为流式提取的真实标题');
        assert.strictEqual(convs[0].titleSource, 'legacy', '无可靠来源时应归为 legacy，不得伪造 api-detail');
        assert.notStrictEqual(convs[0].titleSource, 'api-detail');
    } finally {
        (global as any).chrome = origChrome;
    }
});

// 5. Known provenance continues source-tier arbitration
test('5. Known provenance continues source-tier arbitration (rpc > takeout, titles map merged)', async () => {
    const { mockStorage, chrome } = createMockChromeStorage({
        gemini_conversations: [
            {
                id: 'c_tier_test',
                title: 'Takeout旧标题',
                titleSource: 'takeout',
                titles: { takeout: 'Takeout旧标题' }
            }
        ]
    });
    const origChrome = (global as any).chrome;
    (global as any).chrome = chrome;

    try {
        // Upgrade with RPC source
        await StorageService.finalizeConversationExport(
            'u0',
            'c_tier_test',
            {
                title: 'RPC线上权威新标题',
                format: 'markdown',
                status: 'ok'
            },
            {
                conversationUpdate: {
                    title: 'RPC线上权威新标题',
                    titleSource: 'rpc',
                    titles: { rpc: 'RPC线上权威新标题' }
                }
            }
        );

        let convs = await StorageService.getConversations('u0');
        assert.strictEqual(convs[0].title, 'RPC线上权威新标题', 'RPC 必须晋级覆盖 Takeout');
        assert.strictEqual(convs[0].titleSource, 'rpc');
        assert.strictEqual(convs[0].titles.takeout, 'Takeout旧标题');
        assert.strictEqual(convs[0].titles.rpc, 'RPC线上权威新标题');

        // Subsequent weaker takeout update must NOT downgrade RPC
        await StorageService.finalizeConversationExport(
            'u0',
            'c_tier_test',
            {
                title: '另一个Takeout更旧标题',
                format: 'markdown',
                status: 'ok'
            },
            {
                conversationUpdate: {
                    title: '另一个Takeout更旧标题',
                    titleSource: 'takeout',
                    titles: { takeout: '另一个Takeout更旧标题' }
                }
            }
        );

        convs = await StorageService.getConversations('u0');
        assert.strictEqual(convs[0].title, 'RPC线上权威新标题', '弱势 Takeout 绝不能降级已有的 RPC');
        assert.strictEqual(convs[0].titleSource, 'rpc');
    } finally {
        (global as any).chrome = origChrome;
    }
});

// 6. Partial export: status = partial and hasFailedAssets = true on asset failure
test('6. Partial export: status = partial and hasFailedAssets = true matches across batch and live', () => {
    // Shared completion logic test
    const okCompletion = buildExportCompletion({
        conversationId: 'c_test_ok',
        conversation: { messages: [1, 2] },
        titleCandidate: 'Normal Chat',
        failedAssets: []
    });
    assert.strictEqual(okCompletion.exportRecord.status, 'ok');
    assert.strictEqual(okCompletion.exportRecord.hasFailedAssets, false);

    const partialCompletion = buildExportCompletion({
        conversationId: 'c_test_partial',
        conversation: { messages: [1, 2] },
        titleCandidate: 'Partial Chat',
        failedAssets: [{ file: 'img.png', error: 'fetch failed' }]
    });
    assert.strictEqual(partialCompletion.exportRecord.status, 'partial');
    assert.strictEqual(partialCompletion.exportRecord.hasFailedAssets, true);

    const emptyCompletion = buildExportCompletion({
        conversationId: 'c_test_empty',
        conversation: { messages: [] },
        titleCandidate: 'Empty Chat',
        failedAssets: []
    });
    assert.strictEqual(emptyCompletion.exportRecord.status, 'empty');
});

// 7. Callback: invoked after persistence, error in callback does not abort, not invoked on failure
test('7. Callback semantics: invoked after persistence, error does not abort, not invoked on failure', async () => {
    const { mockStorage, chrome } = createMockChromeStorage({ gemini_conversations: [] });
    const origChrome = (global as any).chrome;
    (global as any).chrome = chrome;

    try {
        let callbackCount = 0;
        // Case A: callback throws, finalize still succeeds
        const resA = await StorageService.finalizeConversationExport(
            'u0',
            'c_cb_success',
            { title: 'Callback Test', status: 'ok' },
            {
                onItemExported: () => {
                    callbackCount++;
                    throw new Error('Callback intentionally threw error');
                }
            }
        );
        assert.strictEqual(resA.ok, true, 'Callback throwing must not abort finalizeConversationExport');
        assert.strictEqual(callbackCount, 1);

        // Case B: saveExportRecord failure, callback must NOT be invoked
        let failureCallbackCalled = false;
        const brokenAdapter = {
            saveExportRecord: async () => { throw new Error('Disk IO failure'); },
            finalizeConversationExport: undefined
        };

        await assert.rejects(async () => {
            await completeConversationExport(
                brokenAdapter,
                'u0',
                { conversationId: 'c_fail', titleCandidate: 'Fail Chat' },
                {
                    onItemExported: () => { failureCallbackCalled = true; }
                }
            );
        }, /Disk IO failure/);

        assert.strictEqual(failureCallbackCalled, false, 'Callback must NOT be invoked if record persistence fails');
    } finally {
        (global as any).chrome = origChrome;
    }
});

import { useIndexStorage } from './helpers/indexStorage.js';
useIndexStorage();
import { indexFixture } from './helpers/indexFixture.js';
const { historicalFixture } = require('./helpers/nativeFixture.js');
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
const { finalizeChatExport } = require('../src/core/engine/export/sessionRecovery.js');
const { resolveChat } = require('../src/core/engine/export/batchWorker.js');

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


/** A real FsWriter-compatible directory; capture files only after close. */
function createMemoryDirectory() {
    const files = new Map<string, unknown>();
    const dir = (prefix: string): any => ({
        name: prefix ? prefix.split('/').filter(Boolean).at(-1) : 'test-root',
        queryPermission: async () => 'granted',
        keys: async function* () {},
        getDirectoryHandle: async (name: string) => dir(prefix + name + '/'),
        getFileHandle: async (name: string) => ({
            createWritable: async () => {
                let content: unknown;
                return {
                    write: async (data: unknown) => { content = data; },
                    close: async () => { files.set(prefix + name, content); },
                    abort: async () => {}
                };
            }
        })
    });
    return { handle: dir(''), files };
}

test('Storage finalization preserves catalog metadata and records delivery', async () => {
    const { mockStorage, chrome } = createMockChromeStorage({
        gemini_conversations: ([
            { id: 'c_batch_1', title: '未命名对话', titleSource: 'default', messageCount: 1, updatedAt: 1000 }
        ]).map(indexFixture)
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
        assert.strictEqual(convs[0].title, '');
        assert.strictEqual(convs[0].titleSource, 'default');
        assert.notStrictEqual(convs[0].titleSource, 'api-detail', 'Must not synthesize fake api-detail provenance');
        assert.notStrictEqual(convs[0].titleSource, 'export', 'Must not synthesize unindexed export tier');
        assert.strictEqual(convs[0].messageCount, 1);
    } finally {
        (global as any).chrome = origChrome;
    }
});

test('Unknown candidate does NOT overwrite authoritative RPC title', async () => {
    const { mockStorage, chrome } = createMockChromeStorage({
        gemini_conversations: ([
            {
                id: 'c_rpc_chat',
                title: '线上RPC权威标题',
                titleSource: 'rpc',
                titles: { rpc: '线上RPC权威标题' },
                messageCount: 3
            }
        ]).map(indexFixture)
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

test('Unknown candidate does NOT overwrite API-detail or Takeout existing real titles', async () => {
    const { mockStorage, chrome } = createMockChromeStorage({
        gemini_conversations: ([
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
        ]).map(indexFixture)
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

test('completeConversationExport cannot publish title candidates to the catalog', async () => {
    const { mockStorage, chrome } = createMockChromeStorage({
        gemini_conversations: ([
            { id: 'c_live_chat', title: '未命名对话', titleSource: 'default', messageCount: 1 }
        ]).map(indexFixture)
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
        assert.strictEqual(convs[0].title, '');
        assert.strictEqual(convs[0].titleSource, 'default');
        assert.notStrictEqual(convs[0].titleSource, 'api-detail');
    } finally {
        (global as any).chrome = origChrome;
    }
});

test('ingestion arbitrates title authority before completion', async () => {
    const native = (title: string, titleSource: string) => historicalFixture({ id: 'tier-test', title, titleSource,
        messages: [{ role: 'user', content: 'Question' }] });
    await StorageService.ingestConversation('u0', native('Imported', 'takeout'), [], 'takeout');
    await StorageService.ingestConversation('u0', native('Online', 'rpc'));
    await StorageService.ingestConversation('u0', native('Old import', 'takeout'), [], 'takeout');
    const [index] = await StorageService.getConversations('u0');
    assert.strictEqual(index.title, 'Online');
    assert.strictEqual(index.titleSource, 'rpc');
    assert.strictEqual(index.hasTakeoutImport, true);
});

test('Callback semantics: invoked after persistence, error does not abort, not invoked on failure', async () => {
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


test('actual Batch and background Live Save produce the same completion record for complete and partial bodies', async () => {
    const { ExportOrchestrator } = require('../src/core/engine/export/exportOrchestrator.js');
    const { makeTestWorker } = require('./helpers/makeTestWorker.js');
    const { handleLiveSaveViaHandle } = require('../src/background/liveSaveHandler.js');
    const { getMemoryDirHandle, setMemoryDirHandle } = require('../src/core/storage/idbHandleStore.js');
    const previousChrome = (global as any).chrome;
    const previousHandle = getMemoryDirHandle();
    try {
        for (const completeness of ['complete', 'partial'] as const) {
            const id = 'completion-parity-' + completeness;
            const title = 'Shared Domain completion';
            const sourceVersion = 1727777777000;
            const source = historicalFixture({
                id, title, titleSource: 'rpc', updatedAt: sourceVersion,
                completeness: { status: completeness },
                messages: [{ role: 'user', content: 'Question' }, { role: 'model', content: 'Answer' }]
            });
            const index = indexFixture({ id, title, titleSource: 'rpc', updatedAt: sourceVersion, messageCount: 2 });
            const { chrome } = createMockChromeStorage({
                gemini_conversations_u1: [index],
                gemini_conversations_u2: [index]
            });
            (global as any).chrome = chrome;

            const batchDir = createMemoryDirectory();
            const batch = await new ExportOrchestrator().run({
                selected: [{ id, title }],
                currentSlot: 'u1',
                format: 'markdown',
                useZip: false,
                dirHandle: batchDir.handle,
                concurrency: 1,
                includeAssets: false,
                worker: makeTestWorker({ fetchChatDetail: async () => ({ success: true, chat: source }) })
            });
            assert.strictEqual(batch.landedChats, 1, 'Batch must actually deliver ' + completeness);
            assert.ok([...batchDir.files.keys()].some(file => file.endsWith('.md')), 'Batch file must be closed');
            const batchRecord = (await StorageService.getExportedIds('u1'))[normId(id)];
            assert.ok(batchRecord && typeof batchRecord === 'object' && !Array.isArray(batchRecord),
                'Batch record must be a persisted object');

            const liveDir = createMemoryDirectory();
            setMemoryDirHandle(liveDir.handle);
            const live = await handleLiveSaveViaHandle({
                chat: source, safeTitle: title, nid: id, assets: []
            }, 'u2');
            assert.strictEqual(live.ok, true, 'Live Save must actually deliver ' + completeness);
            assert.ok([...liveDir.files.keys()].some(file => file.endsWith('.md')), 'Live file must be closed');
            const liveRecord = (await StorageService.getExportedIds('u2'))[normId(id)];
            assert.ok(liveRecord && typeof liveRecord === 'object' && !Array.isArray(liveRecord),
                'Live record must be a persisted object');

            // Export time is local wall-clock metadata, not a source-version fact.
            const { exportedAt: batchExportedAt, ...batchFacts } = batchRecord;
            const { exportedAt: liveExportedAt, ...liveFacts } = liveRecord;
            assert.ok(typeof batchExportedAt === 'string' && Number.isFinite(Date.parse(batchExportedAt)));
            assert.ok(typeof liveExportedAt === 'string' && Number.isFinite(Date.parse(liveExportedAt)));
            assert.deepStrictEqual(batchFacts, liveFacts, 'real entrypoints must agree on durable completion facts');
            assert.strictEqual(batchFacts.status, completeness === 'partial' ? 'partial' : 'ok');
            for (const slot of ['u1', 'u2']) {
                const [stored] = await StorageService.getConversations(slot);
                assert.strictEqual(stored.title, title);
                assert.strictEqual(stored.titleSource, 'rpc');
                assert.strictEqual(stored.updatedAt, sourceVersion);
            }
        }
    } finally {
        setMemoryDirHandle(previousHandle);
        (global as any).chrome = previousChrome;
    }
});


test('real Batch export respects title provenance from the conversation index without fabricating sources', async () => {
    const { ExportOrchestrator } = require('../src/core/engine/export/exportOrchestrator.js');
    const { makeTestWorker } = require('./helpers/makeTestWorker.js');
    const previousChrome = (global as any).chrome;
    try {
        for (const listSource of ['rpc', 'api-detail', 'takeout', 'default'] as const) {
            const id = 'batch-title-' + listSource;
            const title = 'Real imported title';
            const list = indexFixture({
                id, title: listSource === 'default' ? '' : title, titleSource: listSource
            });
            const { chrome } = createMockChromeStorage({ gemini_conversations: [list] });
            (global as any).chrome = chrome;
            const source = historicalFixture({
                id, title, titleSource: 'default',
                messages: [{ role: 'user', content: 'Hello' }, { role: 'model', content: 'World' }]
            });
            const dir = createMemoryDirectory();
            const result = await new ExportOrchestrator().run({
                selected: [{ id, title }],
                currentSlot: 'u0',
                format: 'markdown',
                useZip: false,
                dirHandle: dir.handle,
                conversations: [list],
                includeAssets: false,
                concurrency: 1,
                worker: makeTestWorker({ fetchChatDetail: async () => ({ success: true, chat: source }) })
            });
            assert.strictEqual(result.landedChats, 1, listSource + ': Batch must deliver a file');
            assert.ok([...dir.files.keys()].some(file => file.endsWith('.md')));
            const [stored] = await StorageService.getConversations('u0');
            assert.strictEqual(stored.title, title);
            assert.strictEqual(stored.titleSource, listSource === 'default' ? 'legacy' : listSource,
                'Batch must use the real available provenance, never a guessed api-detail/rpc source');
            const record = (await StorageService.getExportedIds('u0'))[normId(id)];
            assert.ok(record && typeof record === 'object' && !Array.isArray(record));
            assert.strictEqual(record.title, title);
        }
    } finally {
        (global as any).chrome = previousChrome;
    }
});

test('completeConversationExport requires an adapter with a persistence method', async () => {
    const invalidAdapter = {
        someOtherMethod: () => {}
    };

    await assert.rejects(async () => {
        await completeConversationExport(
            invalidAdapter,
            'u0',
            { conversationId: 'c_invalid_adapter', titleCandidate: 'Invalid Adapter Chat' }
        );
    }, /storageAdapter must implement finalizeConversationExport or saveExportRecord/);
});

test('completing an uncatalogued export does not establish conversation existence', async () => {
    await StorageService.finalizeConversationExport('u0', 'fresh', { title: 'Delivery title', status: 'ok' });
    assert.deepStrictEqual(await StorageService.getConversations('u0'), []);
    assert.strictEqual((await StorageService.getExportedIds('u0')).fresh.title, 'Delivery title');
});

test('BatchWorker keeps dirty legacy title slots outside canonical index', async () => {
    const chat: any = {
        id: 'c_adv_j',
        title: 'RPC Title',
        messages: [{ role: 'user', content: 'hello' }],
        titles: {
            'random-source': 'Dirty',
            rpc: 'RPC Title'
        }
    };
    const listConversation = indexFixture({
        id: 'c_adv_j',
        title: '未命名对话',
        titleSource: 'default',
        titles: {}
    });

    await resolveChat(historicalFixture(chat), { id: 'c_adv_j' }, listConversation);

    assert.equal('titles' in listConversation, false);
    assert.strictEqual(listConversation.title, 'RPC Title', 'resolved title must be RPC Title');
    assert.strictEqual(listConversation.titleSource, 'rpc', 'resolved titleSource must be rpc');
});



// Completion consumes metadata capabilities, not a branded Domain. Keep the
// historical primitive and numeric-container behavior while narrowing its API.
test('completion metadata retains primitive and count-only compatibility', () => {
    for (const value of [null, undefined, false, 0, 'legacy primitive']) {
        assert.strictEqual(computeExportMessageCount(value), 0);
        assert.strictEqual(computeExportMessageCount(value, 3), 3);
        assert.strictEqual(computeAuthoritativeTimestamp(value), undefined);
        assert.strictEqual(computeAuthoritativeTimestamp(value, 1234), 1234);
        const result = buildExportCompletion({ conversation: value, conversationId: 'count-only', exportedAt: 1234 });
        assert.strictEqual(result.exportRecord.messageCount, 0);
        assert.strictEqual(result.exportRecord.status, 'empty');
    }
    const facts = { id: 'count-only', title: 'Stored metadata', messageCount: '5', messages: 12, turns: 20, updatedAt: 4567 };
    assert.strictEqual(computeExportMessageCount(facts), 5); // Numeric containers never pretend to be message arrays.
    assert.strictEqual(computeAuthoritativeTimestamp(facts), 4567);
    const result = buildExportCompletion({ conversation: facts, exportedAt: 6789 });
    assert.strictEqual(result.exportRecord.messageCount, 5);
    assert.strictEqual(result.exportRecord.chatTime, 4567);
    assert.strictEqual(result.exportRecord.status, 'ok');
    assert.strictEqual(computeExportMessageCount({ messages: 12, turns: 20 }), 0);
});

test('completion integrity facts are monotonic and preserve status precedence', () => {
    const cases = [
        { quality: { status: 'unknown' }, expected: 'ok' },
        { quality: { status: 'complete' }, expected: 'ok' },
        { quality: { status: 'partial' }, expected: 'partial' },
        { usedLocalSnapshot: true, expected: 'partial' },
        { failedAssetsCount: 1, expected: 'partial' },
        { statusOverride: 'ok', failedAssetsCount: 1, expected: 'partial' },
        { statusOverride: 'failed', quality: { status: 'partial' }, messageCount: 0, expected: 'failed' },
        { messageCount: 0, quality: { status: 'partial', truncation: 'limit' }, expected: 'empty' },
    ];
    for (const { expected, ...facts } of cases) {
        const result = resolveExportRecordStatus({ messageCount: 2, ...facts });
        assert.equal(result.status, expected, JSON.stringify(facts));
        assert.equal(result.hasFailedAssets, (facts.failedAssetsCount ?? 0) > 0);
    }
    for (const status of ['partial', 'unknown', 'complete']) {
        const result = buildExportCompletion({
            conversation: { id: 'monotonic', messages: [{}], quality: { status } },
        });
        assert.equal(result.exportRecord.status, status === 'partial' ? 'partial' : 'ok');
    }
    assert.equal(buildExportCompletion({ conversation: { id: 'truncated', messages: [{}], quality: { status: 'partial', truncation: 'limit' } } }).exportRecord.status, 'partial');
});

test('Directory finalizes real Storage and UI immediately after file close, before the next conversation', async () => {
    const { ExportOrchestrator } = require('../src/core/engine/export/exportOrchestrator.js');
    const { makeTestWorker } = require('./helpers/makeTestWorker.js');
    const { __setModuleOverride, __clearModuleOverrides } = require('../src/core/utils/moduleOverrides.js');
    const { mockStorage, chrome } = createMockChromeStorage();
    const previousChrome = Reflect.get(globalThis, 'chrome');
    Reflect.set(globalThis, 'chrome', chrome);
    __setModuleOverride('StorageService', StorageService);
    const closed: string[] = [], notified: string[] = [];
    const directory = {
        name: 'delivery',
        getDirectoryHandle: async (): Promise<unknown> => directory,
        getFileHandle: async (name: string, options?: { create?: boolean }) => {
            if (!options?.create) throw new Error('File does not exist');
            return { createWritable: async () => ({ write: async () => {}, close: async () => { closed.push(name); } }) };
        },
    };
    const slot = 'u1', { expKey } = StorageService.getStorageKeys(slot);
    try {
        const result = await new ExportOrchestrator().run({
            selected: [{ id: 'dir-one', title: 'dir-one' }, { id: 'dir-two', title: 'dir-two' }],
            useZip: false, currentSlot: slot, dirHandle: directory, includeAssets: false, concurrency: 1,
            worker: makeTestWorker({ fetchChatDetail: async (item: { id: string }) => {
                if (item.id === 'dir-two') {
                    assert.ok(mockStorage[expKey]['dir-one'], 'first record is already persisted');
                    assert.deepEqual(notified, ['dir-one']);
                }
                return { success: true, chat: historicalFixture({ id: item.id, title: item.id, messages: [{ role: 'user', content: 'Q' }] }) };
            } }),
        }, { onItemExported: (id: string) => {
            assert.ok(closed.length > notified.length, 'Writer.close precedes record notification');
            assert.ok(mockStorage[expKey][id], 'record persisted before UI notification');
            notified.push(id);
        } });
        assert.equal(result.landedChats, 2);
        assert.equal(result.exportedCount, 2);
        assert.deepEqual(notified, ['dir-one', 'dir-two']);
    } finally {
        __clearModuleOverrides();
        if (previousChrome === undefined) Reflect.deleteProperty(globalThis, 'chrome');
        else Reflect.set(globalThis, 'chrome', previousChrome);
    }
});

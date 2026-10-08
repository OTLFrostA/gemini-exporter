import { historicalFixture } from './helpers/nativeFixture.js';
import type { FetchAssetParams } from '../src/core/engine/assetPipeline.js';
import { makeTestWorker } from './helpers/makeTestWorker.js';
const test = require('node:test');
const assert = require('node:assert');

const { ExportOrchestrator, AsyncQueue } = require('../src/core/engine/export/exportOrchestrator.js');
const { RateLimitManager, isRateLimited, calculateBackoff } = require('../src/core/engine/export/rateLimiter.js');
const { BatchWorker, formatDebugInfo } = require('../src/core/engine/export/batchWorker.js');
const { ChatFormatter } = require('../src/core/engine/chatFormatter.js');
const { __setModuleOverride, __getModuleOverride } = require('../src/core/utils/moduleOverrides.js');

// ---------------------------------------------------------------------------
// AsyncQueue
// ---------------------------------------------------------------------------
test('AsyncQueue - push, pop, length, FIFO order, and close', async () => {
    const queue = new AsyncQueue();
    assert.strictEqual(queue.length, 0);

    queue.push('task-1');
    queue.push('task-2');
    assert.strictEqual(queue.length, 2);

    const item1 = await queue.pop();
    assert.strictEqual(item1, 'task-1');
    assert.strictEqual(queue.length, 1);

    const item2 = await queue.pop();
    assert.strictEqual(item2, 'task-2');
    assert.strictEqual(queue.length, 0);

    // Test waiting on empty queue
    let popResolved = false;
    const popPromise = queue.pop().then((val: any) => {
        popResolved = true;
        return val;
    });
    assert.strictEqual(popResolved, false);

    queue.push('task-3');
    const item3 = await popPromise;
    assert.strictEqual(item3, 'task-3');

    // Test close
    const closeWaitPromise = queue.pop();
    queue.close();
    const itemAfterClose = await closeWaitPromise;
    assert.strictEqual(itemAfterClose, null);
    assert.strictEqual(await queue.pop(), null);

    // Test pushing to closed queue returns false
    assert.strictEqual(queue.push('task-after-close'), false, 'pushing to closed queue must return false');
});

// ---------------------------------------------------------------------------
// RateLimitManager
// ---------------------------------------------------------------------------
test('RateLimitManager - detect rate limit and exponential backoff', async () => {
    assert.strictEqual(isRateLimited({ success: false, status: 429 }), true);
    assert.strictEqual(isRateLimited({ success: false, error: 'Quota exceeded: too many requests' }), true);
    assert.strictEqual(isRateLimited({ success: true, status: 200 }), false);
    assert.strictEqual(isRateLimited({ success: false, error: '500 internal server error' }), false);

    const delay0 = calculateBackoff(0, { initialDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 });
    assert.strictEqual(delay0, 100);

    const delay1 = calculateBackoff(1, { initialDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 });
    assert.strictEqual(delay1, 200);

    const delayMax = calculateBackoff(10, { initialDelayMs: 100, maxDelayMs: 500, jitterMs: 0 });
    assert.strictEqual(delayMax, 500);

    const manager = new RateLimitManager({ initialDelayMs: 50, maxDelayMs: 200, jitterMs: 0 });
    assert.strictEqual(manager.rateLimitCooldownUntil, 0);

    manager.recordRateLimit(100);
    assert.ok(manager.rateLimitCooldownUntil > Date.now());

    await manager.waitForCooldown();
    assert.ok(Date.now() >= manager.rateLimitCooldownUntil);
    manager.reset();
    assert.strictEqual(manager.rateLimitCooldownUntil, 0);
});

// ---------------------------------------------------------------------------
// ExportOrchestrator: Mock JSZip
// ---------------------------------------------------------------------------
function setupMockJSZip() {
    const instances: any[] = [];
    __setModuleOverride('JSZip', class MockJSZip {
        files: Record<string, any> = {};
        constructor() {
            this.files = {};
            instances.push(this);
        }
        folder(_name: string) {
            return {
                file: (path: string, content: any) => { this.files[path] = content; }
            };
        }
        async generateAsync(_options?: any, cb?: (p: { percent: number }) => void) {
            if (cb) cb({ percent: 100 });
            return new Blob(['mock-zip'], { type: 'application/zip' });
        }
    });
    return instances;
}


// ---------------------------------------------------------------------------
// ExportOrchestrator: Mock StorageService
// Phase A (P1-4): orchestrator 不再接受 Storage=null（静态 fallback 保证生产环境
// 永远有真 StorageService）；无 chrome 的 node 测试必须显式注册 mock adapter，
// 且它必须实现 saveExportRecord（finalizeChatExport fail-closed）。
// ---------------------------------------------------------------------------
function setupMockStorage() {
    const mem: Record<string, any> = {};
    __setModuleOverride('StorageService', {
        getExportedIds: async (_slot: string) => ({ ...mem }),
        saveExportRecord: async (_slot: string, id: string, rec: any) => {
            mem[id] = rec;
            return { ...mem };
        },
    });
    return { savedRecords: mem };
}

// ---------------------------------------------------------------------------
// ExportOrchestrator: Batch export success and failure accounting (S-2)
// ---------------------------------------------------------------------------
test('ExportOrchestrator - accurate accounting for successful and failed chats (S-2)', async () => {
    setupMockJSZip();
    setupMockStorage();
    const orchestrator = new ExportOrchestrator();

    const selected = [
        { id: 'chat-1', title: 'Conversation 1' },
        { id: 'chat-2', title: 'Conversation 2' },
        { id: 'chat-3', title: 'Conversation 3' }
    ];

    const mockWorker = makeTestWorker({
        fetchChatDetail: async (requestedItem: any) => {
            if (requestedItem.id === 'chat-2') {
                return {
                    success: false,
                    error: '429 Rate Limit Exceeded'
                };
            }
            return {
                success: true,
                chat: historicalFixture({
                    id: requestedItem.id,
                    title: requestedItem.title,
                    messages: [
                        { role: 'user', content: 'Hello' },
                        { role: 'model', content: 'Hi there!' }
                    ]
                }),
                listTitle: requestedItem.title
            };
        }
    });

    const logs: string[] = [];
    const result = await orchestrator.run({
        selected,
        format: 'markdown',
        useZip: true,
        includeAssets: false,
        worker: mockWorker
    }, {
        onLog: (msg: string) => logs.push(msg)
    });

    assert.strictEqual(result.landedChats, 2, '2 chats should have succeeded');
    assert.strictEqual(result.exportedCount, 2, 'exportedCount should equal landedChats');
    assert.strictEqual(result.failedChats.length, 1, '1 chat should have failed');
    assert.strictEqual(result.failedChats[0].id, 'chat-2');
    assert.ok(result.failedChats[0].error.includes('429'), 'Error reason should be captured');
    assert.strictEqual(result.aborted, false);
});

// ---------------------------------------------------------------------------
// ExportOrchestrator: Permission revocation immediate abort (S-5)
// ---------------------------------------------------------------------------
test('ExportOrchestrator - stops pipeline immediately on NotAllowedError (S-5)', async () => {
    setupMockStorage();
    const orchestrator = new ExportOrchestrator();

    const selected = [
        { id: 'chat-p1', title: 'Permission 1' },
        { id: 'chat-p2', title: 'Permission 2' },
        { id: 'chat-p3', title: 'Permission 3' }
    ];

    let fetchCount = 0;
    const mockWorker = makeTestWorker({
        fetchChatDetail: async (requestedItem: any) => {
            fetchCount++;
            return {
                success: true,
                chat: historicalFixture({
                    id: requestedItem.id,
                    title: requestedItem.title,
                    messages: [{ role: 'user', content: 'test' }]
                }),
                listTitle: requestedItem.title
            };
        }
    });

    // Mock dirHandle where getFileHandle throws NotAllowedError
    const mockDirHandle: any = {
        name: 'test_folder',
        getDirectoryHandle: async () => mockDirHandle,
        getFileHandle: async () => {
            const err = new Error('The user revoked directory permission');
            err.name = 'NotAllowedError';
            throw err;
        }
    };

    const logs: string[] = [];
    const result = await orchestrator.run({
        selected,
        format: 'markdown',
        useZip: false,
        includeAssets: false,
        dirHandle: mockDirHandle,
        worker: mockWorker,
        concurrency: 1
    }, {
        onLog: (msg: string) => logs.push(msg)
    });

    // Verify pipeline aborted
    assert.strictEqual(orchestrator.aborted, true, 'Orchestrator should be aborted');
    assert.strictEqual(result.aborted, true, 'Result should flag aborted');
    assert.strictEqual(result.landedChats, 0, 'No chats should have landed');
    assert.strictEqual(fetchCount, 1, 'Only one chat should have been fetched before abort');
    assert.strictEqual(result.failedChats.length, 1, 'Pipeline should record exactly one failed chat on immediate abort');
    assert.ok(
        logs.some(l => l.includes('权限') || l.includes('permission')),
        'Logs should contain permission revocation warning'
    );
});

// ---------------------------------------------------------------------------
// ExportOrchestrator: Fast Upfront Skip Filter
// ---------------------------------------------------------------------------
test('ExportOrchestrator - skip: true skips already exported up-to-date chats upfront and only fetches unexported/updated chats', async () => {
    setupMockJSZip();
    setupMockStorage();
    const orchestrator = new ExportOrchestrator();

    const tExported = 1700000000000;
    const conversations = [
        { id: 'chat-new', title: 'New Conversation', timestamp: tExported },
        { id: 'chat-updated', title: 'Updated Conversation', timestamp: tExported, updatedAt: tExported + 30000 },
        { id: 'chat-synced', title: 'Synced Conversation', timestamp: tExported, updatedAt: tExported },
        { id: 'chat-old', title: 'Old Synced Conversation', timestamp: tExported - 10000 }
    ];

    const exportedIds = {
        'chat-updated': { exportedAt: new Date(tExported).toISOString(), chatTime: tExported, title: 'Updated Conversation' },
        'chat-synced': { exportedAt: new Date(tExported + 5000).toISOString(), chatTime: tExported, title: 'Synced Conversation' },
        'chat-old': { exportedAt: new Date(tExported).toISOString(), chatTime: tExported - 10000, title: 'Old Synced Conversation' }
    };

    const fetchedIds: string[] = [];
    const mockWorker = makeTestWorker({
        fetchChatDetail: async (requestedItem: any) => {
            fetchedIds.push(requestedItem.id);
            return {
                success: true,
                chat: historicalFixture({
                    id: requestedItem.id,
                    title: requestedItem.title,
                    messages: [{ role: 'user', content: 'test' }]
                }),
                listTitle: requestedItem.title
            };
        }
    });

    const logs: string[] = [];
    const result = await orchestrator.run({
        selected: conversations,
        format: 'markdown',
        useZip: true,
        skip: true,
        conversations,
        exportedIds,
        includeAssets: false,
        worker: mockWorker
    }, {
        onLog: (msg: string) => logs.push(msg)
    });

    assert.strictEqual(result.landedChats, 2, 'Only 2 chats (new and updated) should be exported');
    assert.strictEqual(result.skipped, 2, '2 chats (synced and old) should be skipped upfront');
    assert.deepStrictEqual(fetchedIds.sort(), ['chat-new', 'chat-updated'].sort(), 'Only new and updated chats should be fetched');
    assert.ok(logs.some(l => (l.includes('Synced Conversation') || l.includes('chat-synced')) && (l.includes('跳过') || l.includes('skipped'))), 'Logs should report chat-synced skipped');
    assert.ok(logs.some(l => (l.includes('Old Synced Conversation') || l.includes('chat-old')) && (l.includes('跳过') || l.includes('skipped'))), 'Logs should report chat-old skipped');
});

test('ExportOrchestrator - skip: true when all selected chats are up-to-date completes instantly without network calls or empty zip', async () => {
    setupMockStorage();
    let zipGenerated = false;
    __setModuleOverride('JSZip', class MockJSZipAllSkip {
        files: Record<string, any> = {};
        folder() { return { file: () => {} }; }
        async generateAsync() {
            zipGenerated = true;
            return new Blob(['mock-zip'], { type: 'application/zip' });
        }
    });

    const orchestrator = new ExportOrchestrator();

    const tExported = 1700000000000;
    const conversations = [
        { id: 'chat-1', title: 'Conversation 1', timestamp: tExported, updatedAt: tExported },
        { id: 'chat-2', title: 'Conversation 2', timestamp: tExported, updatedAt: tExported }
    ];

    const exportedIds = {
        'chat-1': { exportedAt: new Date(tExported + 10000).toISOString(), chatTime: tExported, title: 'Conversation 1' },
        'chat-2': { exportedAt: new Date(tExported + 10000).toISOString(), chatTime: tExported, title: 'Conversation 2' }
    };

    let fetchCalls = 0;
    const mockWorker = makeTestWorker({
        fetchChatDetail: async () => {
            fetchCalls++;
            return { success: true };
        }
    });

    const logs: string[] = [];
    const result = await orchestrator.run({
        selected: conversations,
        format: 'markdown',
        useZip: true,
        skip: true,
        conversations,
        exportedIds,
        includeAssets: false,
        worker: mockWorker
    }, {
        onLog: (msg: string) => logs.push(msg)
    });

    assert.strictEqual(fetchCalls, 0, 'Zero network calls should be made when all chats are skipped upfront');
    assert.strictEqual(result.landedChats, 0, 'Zero chats landed');
    assert.strictEqual(result.skipped, 2, 'All 2 chats should be skipped');
    assert.strictEqual(result.failedChats.length, 0, 'Zero failures');
    assert.strictEqual(zipGenerated, false, 'No empty zip should be generated when all chats are skipped');
    assert.ok(logs.some(l => l.includes('无需生成 ZIP') || l.includes('No ZIP generated')), 'Logs should confirm no zip generated');
});

test('ExportOrchestrator - skip: false exports all selected chats regardless of export records', async () => {
    setupMockJSZip();
    setupMockStorage();
    const orchestrator = new ExportOrchestrator();

    const tExported = 1700000000000;
    const conversations = [
        { id: 'chat-1', title: 'Conversation 1', timestamp: tExported, updatedAt: tExported },
        { id: 'chat-2', title: 'Conversation 2', timestamp: tExported, updatedAt: tExported }
    ];

    const exportedIds = {
        'chat-1': { exportedAt: new Date(tExported + 10000).toISOString(), chatTime: tExported, title: 'Conversation 1' },
        'chat-2': { exportedAt: new Date(tExported + 10000).toISOString(), chatTime: tExported, title: 'Conversation 2' }
    };

    let fetchCalls = 0;
    const mockWorker = makeTestWorker({
        fetchChatDetail: async (item: any) => {
            fetchCalls++;
            return {
                success: true,
                chat: historicalFixture({ id: item.id, title: item.title, messages: [{ role: 'user', content: 'Body' }] }),
                listTitle: item.title
            };
        }
    });

    const result = await orchestrator.run({
        selected: conversations,
        format: 'markdown',
        useZip: true,
        skip: false,
        conversations,
        exportedIds,
        includeAssets: false,
        worker: mockWorker
    });

    assert.strictEqual(fetchCalls, 2, 'All chats should be fetched when skip is false');
    assert.strictEqual(result.landedChats, 2, 'All chats should land');
    assert.strictEqual(result.skipped, 0, 'Zero chats skipped');
});

// ---------------------------------------------------------------------------
// formatDebugInfo tests
// ---------------------------------------------------------------------------
test('formatDebugInfo - formats debug info cleanly without [object Object]', () => {
    assert.strictEqual(formatDebugInfo(null), '');
    assert.strictEqual(formatDebugInfo(undefined), '');
    assert.strictEqual(formatDebugInfo('plain error message'), ' plain error message');

    const rpcDebug = { batchexecuteEmptyDebug: { error: 'BardErrorInfo: 1167' } };
    assert.strictEqual(formatDebugInfo(rpcDebug), ' (RPC: BardErrorInfo: 1167)');

    const domDebug = { domDebug: { error: 'DOM not ready' } };
    assert.strictEqual(formatDebugInfo(domDebug), ' (DOM: DOM not ready)');

    const errDebug = { error: 'Explicit error' };
    assert.strictEqual(formatDebugInfo(errDebug), ' (Explicit error)');

    const objDebug = { isNotFound: true, statusCode: 404, rawPreview: 'huge string to ignore' };
    const formatted = formatDebugInfo(objDebug);
    assert.ok(!formatted.includes('[object Object]'), 'Must never format to [object Object]');
    assert.ok(formatted.includes('"isNotFound":true'), 'Must serialize key fields');
    assert.ok(!formatted.includes('huge string to ignore'), 'Must strip out rawPreview bloat');
});

// ---------------------------------------------------------------------------
// BatchWorker.resolveChat - Empty Chat and Deleted Chat handling
// ---------------------------------------------------------------------------
test('BatchWorker.resolveChat - reports unavailable bodies without fabricating an empty conversation', async () => {
    const logs: string[] = [];
    const chat = {
        id: 'empty-chat-123',
        title: 'Used an Assistant feature',
        messages: [],
        error: 'DOM 返回内容为空',
        _empty: true,
        _debug: { domHtmlLen: 0 }
    };
    const reqItem = { id: 'empty-chat-123', title: 'Used an Assistant feature' };

    const res = await BatchWorker.resolveChat(
        chat,
        reqItem,
        null,
        null,
        'u0',
        () => {},
        (msg: string) => logs.push(msg)
    );

    assert.strictEqual(res.isError, true);
    assert.strictEqual(res.isConfirmedDeleted, false);
    assert.equal(res.errMsg, chat.error);
    assert.equal('chat' in res, false);
});

test('BatchWorker.resolveChat - detects cloud-deleted chat with BardErrorInfo: 1167', async () => {
    const logs: string[] = [];
    const chat = {
        id: 'del-chat-456',
        title: 'Deleted Chat',
        messages: [],
        error: '会话已在服务端删除或不可访问 (BardErrorInfo: 1167)',
        _empty: true
    };
    const reqItem = { id: 'del-chat-456', title: 'Deleted Chat' };

    const res = await BatchWorker.resolveChat(
        chat,
        reqItem,
        null,
        null,
        'u0',
        () => {},
        (msg: string) => logs.push(msg)
    );

    assert.strictEqual(res.isError, true, 'Deleted chat should be marked as error/pruned');
    assert.strictEqual(res.isConfirmedDeleted, true, 'Must identify as confirmed deleted');
});

// ---------------------------------------------------------------------------
// ChatFormatter - Empty Chat Markdown Notice
// ---------------------------------------------------------------------------
test('Canonical Markdown preserves the header for empty chats', async () => {
    const emptyChat = {
        id: 'cca63136d0630930',
        title: 'Used an Assistant feature',
        messages: [],
        isEmpty: true
    };

    const { content: mdZh } = await ChatFormatter.formatMarkdownDocument(historicalFixture(emptyChat), { lang: 'zh' });
    assert.ok(mdZh.includes('title: "Used an Assistant feature"'), 'Frontmatter title');
    assert.ok(!mdZh.includes('## 👤'), 'empty chat has no fabricated messages');

    const { content: mdEn } = await ChatFormatter.formatMarkdownDocument(historicalFixture(emptyChat), { lang: 'en' });
    assert.ok(mdEn.includes('# Used an Assistant feature'), 'empty chat retains title');
});

// ---------------------------------------------------------------------------
// ExportOrchestrator - Empty Chat end-to-end export without deadlock
// ---------------------------------------------------------------------------
test('ExportOrchestrator - unavailable body remains retryable and is not marked exported', async () => {
    setupMockJSZip();
    setupMockStorage();
    const orchestrator = new ExportOrchestrator();

    const conversations = [
        { id: 'cca63136d0630930', title: 'Used an Assistant feature', timestamp: 1710000000000 }
    ];

    const mockWorker = makeTestWorker({
        fetchChatDetail: async () => ({
            success: true,
            chat: historicalFixture({
                id: 'cca63136d0630930',
                title: 'Used an Assistant feature',
                messages: [],
            })
        }),
        resolveChat: BatchWorker.resolveChat
    });

    const exportedIds: Record<string, any> = {};
    const logs: string[] = [];

    const result = await orchestrator.run({
        selected: conversations,
        format: 'markdown',
        useZip: true,
        skip: true,
        conversations,
        exportedIds,
        includeAssets: false,
        worker: mockWorker,
        onExportFinalized: async (id: string) => {
            exportedIds[id] = { exportedAt: new Date().toISOString(), status: 'empty' };
        }
    }, {
        onLog: (msg: string) => logs.push(msg)
    });

    assert.strictEqual(result.landedChats, 0);
    assert.strictEqual(result.failedChats.length, 1);
    assert.equal(exportedIds['cca63136d0630930'], undefined);
});

test('ExportOrchestrator - records effective timestamp (updatedAt) in chatTime and fires onItemPendingAssets for queued assets', async () => {
    setupMockJSZip();
    const { savedRecords } = setupMockStorage();
    const orchestrator = new ExportOrchestrator();

    const tCreate = 1700000000000;
    const tUpdate = 1700086400000; // 24h newer than creation timestamp
    const conversations = [
        { id: 'chat_with_img', title: 'Image Chat', timestamp: tCreate, updatedAt: tUpdate }
    ];

    const mockWorker = makeTestWorker({
        fetchChatDetail: async () => ({
            success: true,
            chat: historicalFixture({
                id: 'chat_with_img',
                title: 'Image Chat',
                timestamp: tCreate,
                updatedAt: tUpdate,
                messages: [
                    {
                        role: 'model',
                        content: 'Here is an image',
                        images: [{ url: 'https://lh3.googleusercontent.com/fake_img', localName: 'assets/img.png', fileName: 'img.png' }]
                    }
                ]
            })
        }),
        resolveChat: BatchWorker.resolveChat
    });

    const origPipeline = __getModuleOverride('AssetPipeline');
    __setModuleOverride('AssetPipeline', class {
        async processAsset(item: any) {
            return { saved: true, localName: item.localName || 'assets/img.png' };
        }
    });

    const pendingEvents: Array<{ id: string; count: number }> = [];
    const finalizedEvents: Array<{ id: string; rec: any }> = [];

    try {
        const result = await orchestrator.run({
            selected: conversations,
            format: 'markdown',
            useZip: true,
            skip: false,
            conversations,
            exportedIds: {},
            includeAssets: true,
            worker: mockWorker
        }, {
            onItemPendingAssets: (id: string, count: number) => pendingEvents.push({ id, count }),
            onItemExported: (id: string, rec: any) => finalizedEvents.push({ id, rec })
        });

        assert.strictEqual(result.landedChats, 1);
        assert.strictEqual(pendingEvents.length, 1, 'onItemPendingAssets must fire when chat has queued assets');
        assert.strictEqual(pendingEvents[0].id, 'chat_with_img');
        assert.strictEqual(pendingEvents[0].count, 1);
        assert.strictEqual(finalizedEvents.length, 1, 'onItemExported must fire after asset queue completes');
        assert.strictEqual(finalizedEvents[0].rec.chatTime, tUpdate, 'record.chatTime must use effective timestamp (updatedAt), not stale creation timestamp');
        assert.strictEqual(savedRecords['chat_with_img']?.chatTime, tUpdate);

        const { checkIsUpdated } = require('../src/core/utils/titleUtils.js');
        assert.strictEqual(
            checkIsUpdated(conversations[0], finalizedEvents[0].rec),
            false,
            'Freshly exported conversation with updatedAt > timestamp must not be flagged as updated'
        );
    } finally {
        __setModuleOverride('AssetPipeline', origPipeline);
    }
});

test('ExportOrchestrator - resolves the original first candidate without changing its source identity without skipping later results', async () => {
    setupMockJSZip();
    setupMockStorage();
    const orchestrator = new ExportOrchestrator();
    const malformedFirst = { id: 42, title: 'Malformed first result', messages: [] };
    const validSecond = { id: 'candidate_second', title: 'Must not be selected', messages: [] };
    const selected = [{ id: 'candidate_first', title: 'First candidate' }];
    let receivedChat: unknown;

    const result = await orchestrator.run({
        selected,
        useZip: true,
        includeAssets: false,
        worker: makeTestWorker({
            fetchChatDetail: async () => ({ success: true, results: [malformedFirst, historicalFixture(validSecond)], chat: historicalFixture(validSecond) }),
            resolveChat: async (chat: any) => {
                receivedChat = chat;
                return {
                    isError: true,
                    chat,
                    listTitle: 'First candidate',
                    displayTitle: 'First candidate',
                    isConfirmedDeleted: false,
                    errMsg: 'Expected regression path',
                    convsNeedSave: false
                };
            }
        })
    });

    assert.strictEqual(receivedChat, malformedFirst, 'The original first candidate object must be passed to resolveChat');
    assert.strictEqual(malformedFirst.id, 42, 'Source data must remain unchanged');
    assert.notStrictEqual(receivedChat, validSecond, 'A later valid candidate must not be selected');
    assert.strictEqual(result.landedChats, 0, 'The mocked resolver reports the first candidate as a failure');
    assert.strictEqual(result.failedChats.length, 1, 'The first candidate must follow the existing per-chat failure path');
});

test('ExportOrchestrator - rejects a primitive first candidate without choosing a later result', async () => {
    setupMockJSZip();
    setupMockStorage();
    const orchestrator = new ExportOrchestrator();
    const validSecond = { id: 'candidate_second', title: 'Must not be selected', messages: [] };
    let resolveCalls = 0;

    const result = await orchestrator.run({
        selected: [{ id: 'candidate_primitive', title: 'Primitive candidate' }],
        useZip: true,
        includeAssets: false,
        worker: makeTestWorker({
            fetchChatDetail: async () => ({ success: true, results: [42, historicalFixture(validSecond)] }),
            resolveChat: async (value, ...args) => {
                resolveCalls++;
                return BatchWorker.resolveChat(value, ...args);
            }
        })
    });

    assert.strictEqual(resolveCalls, 1, 'The native boundary validates the selected source');
    assert.strictEqual(result.landedChats, 0, 'A truthy primitive first candidate must fail');
    assert.strictEqual(result.failedChats.length, 1, 'The primitive failure must be isolated to its chat');
    assert.match(result.failedChats[0].error || '', /body is unavailable/);
});

test('ExportOrchestrator - prepares asset destinations while retaining Domain asset identity', async () => {
    setupMockJSZip();
    setupMockStorage();
    const orchestrator = new ExportOrchestrator();
    const attachment = { url: 'https://example.com/image.png', localName: 'assets/original.png', fileName: 'original.png' };
    const fetchedChat = {
        id: 'asset_identity',
        title: 'Fetched chat',
        messages: [{ role: 'model', content: 'Image', images: [attachment] }]
    };
    const resolvedChat = {
        id: 'asset_identity',
        title: 'Resolved chat',
        messages: fetchedChat.messages
    };
    let receivedItem: unknown;
    let receivedChat: unknown;
    const origPipeline = __getModuleOverride('AssetPipeline');
    __setModuleOverride('AssetPipeline', class {
        async processAsset(item: unknown, chat: unknown) {
            receivedItem = item;
            receivedChat = chat;
            return { saved: true, localName: attachment.localName };
        }
    });

    try {
        const result = await orchestrator.run({
            selected: [{ id: 'asset_identity', title: 'Resolved chat' }],
            useZip: true,
            includeAssets: true,
            worker: makeTestWorker({
                fetchChatDetail: async () => ({ success: true, chat: historicalFixture(fetchedChat) }),
                resolveChat: async () => ({
                    chat: historicalFixture(resolvedChat),
                    listTitle: 'Resolved chat',
                    displayTitle: 'Resolved chat',
                    isConfirmedDeleted: false,
                    isError: false,
                    errMsg: null,
                    convsNeedSave: false
                })
            })
        });

        assert.strictEqual(result.landedChats, 1);
        assert.equal((receivedItem as any).url, attachment.url);
        assert.equal((receivedItem as any).localName, attachment.localName);
        assert.ok((receivedItem as any).assetId);
        assert.equal((receivedChat as any).id, resolvedChat.id);
        assert.equal((receivedChat as any).title, resolvedChat.title);
    } finally {
        __setModuleOverride('AssetPipeline', origPipeline);
    }
});

test('ExportOrchestrator - writes native document content without reinterpreting it at runtime', async () => {
    const mockZips = setupMockJSZip();
    setupMockStorage();
    const orchestrator = new ExportOrchestrator();

    const conversations = [
        { id: 'chat_doc_1', title: 'Doc Analysis', timestamp: 1700000000000 }
    ];

    const mockWorker = makeTestWorker({
        fetchChatDetail: async () => ({
            success: true,
            chat: historicalFixture({
                id: 'chat_doc_1',
                title: 'Doc Analysis',
                timestamp: 1700000000000,
                messages: [
                    {
                        role: 'user',
                        content: 'Please analyze this system.'
                    },
                    {
                        role: 'model',
                        content: 'Analysis generated: [供水管网报告](files/chat_doc_1_pipe_analysis.md)',
                        attachments: [
                            {
                                type: 'file',
                                title: '供水管网报告',
                                localName: 'files/chat_doc_1_pipe_analysis.md',
                                contentMarkdown: 'http://googleusercontent.com/immersive_entry_chip/0\n# 城市供水管网水力建模分析\n\n## 1. 建模方程\n连续性方程与水头损失计算。'
                            },
                            {
                                type: 'file',
                                title: '仅包含Chip的无用文档',
                                localName: 'files/chat_doc_1_empty_chip.md',
                                contentMarkdown: 'http://googleusercontent.com/immersive_entry_chip/0\n'
                            }
                        ]
                    }
                ]
            })
        }),
        resolveChat: BatchWorker.resolveChat
    });

    const result = await orchestrator.run({
        selected: conversations,
        format: 'markdown',
        useZip: true,
        skip: false,
        conversations,
        exportedIds: {},
        includeAssets: true,
        worker: mockWorker
    });

    assert.strictEqual(result.landedChats, 1);
    assert.strictEqual(result.failedChats.length, 0);

    // Verify mock zip files
    const zipInstance = mockZips[0];
    assert.ok(zipInstance, 'Mock JSZip instance must be created');

    // 1. Cleaned document must be written
    assert.ok(zipInstance.files['files/chat_doc_1_pipe_analysis.md'], 'Document file must be written to archive');
    const writtenContent = zipInstance.files['files/chat_doc_1_pipe_analysis.md'];
    assert.strictEqual(writtenContent.includes('immersive_entry_chip'), true, 'Export preparation preserves the supplied native document content');
    assert.ok(writtenContent.includes('# 城市供水管网水力建模分析'), 'Written document must contain document title and content');
    assert.ok(writtenContent.includes('连续性方程与水头损失计算'), 'Written document must contain document body');

    // 2. Pure chip telemetry document (empty after cleaning) must NOT be written
    assert.ok(zipInstance.files['files/chat_doc_1_empty_chip.md'], 'Every supplied native document is written');
});

test('BatchWorker - validates native closure and refuses historical runtime records', async () => {
    const { isWorkerChat } = require('../src/core/engine/export/batchWorker.js');
    const record = { id: 'boundary', title: 'Boundary', messages: [{ role: 'user', content: 'Question' }] };
    const native = historicalFixture(record);
    assert.equal(isWorkerChat(record), false);
    assert.equal((await BatchWorker.resolveChat(record, { id: 'boundary' })).isError, true);
    assert.equal((await BatchWorker.resolveChat(native, { id: 'boundary' })).isError, false);
    const invalid = structuredClone(native);
    invalid.conversation.messages[0].attachmentIds = ['missing'];
    await assert.rejects(BatchWorker.resolveChat(invalid, { id: 'boundary' }), /asset|missing|reference/i);
});

test('ExportOrchestrator - uses native envelope bodies and reports missing bodies', async () => {
    for (const mode of ['envelope', 'missing', 'falsy-first']) {
        const useEnvelopeChat = mode === 'envelope';
        setupMockJSZip();
        setupMockStorage();
        const candidate = historicalFixture({ id: 'fallback', title: 'Envelope chat', messages: [{ role: 'user', content: 'Question' }] });
        let received: unknown;
        const worker = makeTestWorker({
            fetchChatDetail: async () => ({ success: true, results: mode === 'falsy-first' ? [null] : [], ...(mode !== 'missing' ? { chat: candidate } : {}) }),
            resolveChat: async (chat, ...args) => {
                received = chat;
                assert.ok(chat == null || typeof chat === 'object');

                return BatchWorker.resolveChat(chat, ...args);
            }
        });
        const result = await new ExportOrchestrator().run({
            selected: [{ id: 'fallback', title: 'Requested title' }], useZip: true, includeAssets: false, worker
        });
        if (useEnvelopeChat) assert.strictEqual(received, candidate);
        assert.strictEqual(result.landedChats, useEnvelopeChat ? 1 : 0);
        assert.strictEqual(result.failedChats.length, useEnvelopeChat ? 0 : 1);
    }
});

test('AssetPipeline - preserves URL priorities and filename fallbacks for typed items', async () => {
    const { AssetPipeline } = require('../src/core/engine/assetPipeline.js');
    const cases = [
        { item: { url: 'https://example.com/url', sourceUrl: 'https://example.com/source', resolvedUrl: 'https://example.com/resolved', src: 'https://example.com/src', localName: 'local.png', fileName: 'file.png' }, isImage: true, url: 'https://example.com/resolved', localName: 'local.png' },
        { item: { url: 'https://example.com/url', sourceUrl: 'https://example.com/source', src: 'https://example.com/src', fileName: 'file.png' }, isImage: true, url: 'https://example.com/source', localName: 'file.png' },
        { item: { url: 'https://example.com/url', src: 'https://example.com/src' }, isImage: true, url: 'https://example.com/url', localName: 'image.jpg' },
        { item: { src: 'https://example.com/src' }, isImage: true, url: 'https://example.com/src', localName: 'image.jpg' },
        { item: { url: 'https://example.com/viewer/thumb', sourceUrl: 'https://example.com/source', src: 'https://example.com/src', title: 'report.pdf' }, isImage: false, url: 'https://example.com/source', localName: 'report.pdf' },
        { item: { url: 'https://example.com/url', sourceUrl: 'https://example.com/source' }, isImage: false, url: 'https://example.com/url', localName: 'file.bin' },
    ];
    const chat = { id: 'asset_priority', title: 'Asset priority' };
    for (const scenario of cases) {
        const requests: FetchAssetParams[] = [];
        const pipeline = new AssetPipeline({ fetchAssetDelegate: async (params: FetchAssetParams) => {
            requests.push(params);
            return { success: true, dataBuffer: new Uint8Array([1, 2, 3]) };
        } });
        const result = await pipeline.acquireAssetBytes(scenario.item, chat, { isImage: scenario.isImage, maxRetries: 0 });
        assert.strictEqual(result.ok, true);
        assert.strictEqual(requests[0].url, scenario.url);
        assert.strictEqual(requests[0].item, scenario.item);
        assert.strictEqual(requests[0].chat, chat);
        assert.strictEqual(result.localName, scenario.localName);
    }
});

test('AssetPipeline - passes the original generation identity to Takeout fallback', async () => {
    const { AssetPipeline } = require('../src/core/engine/assetPipeline.js');
    const generation = { chatId: 'generated_boundary', generationOrdinal: 2, imageOrdinal: 1, providerRequestId: 'request' };
    let received: unknown[] = [];
    const pipeline = new AssetPipeline({
        currentSlot: 'u1',
        takeoutEngine: { getTakeoutFallbackMedia: async (...args: unknown[]) => {
            received = args;
            return new Uint8Array([4, 5, 6]);
        } }
    });
    const result = await pipeline.acquireAssetBytes({ fileName: 'generated.png', generation }, { id: 'generated_boundary' }, { isImage: true });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.recoveredFromTakeout, true);
    assert.deepStrictEqual(received.slice(0, 3), ['generated_boundary', 'generated.png', 'u1']);
    assert.strictEqual(received[3], generation);
});

test('ExportOrchestrator - queues image and file attachments while preserving image deduplication', async () => {
    setupMockJSZip();
    setupMockStorage();
    const image = { type: 'image', localName: 'assets/image.png', fileName: 'image.png', url: 'https://example.com/image.png' };
    const file = { type: 'file', localName: 'assets/file.pdf', fileName: 'file.pdf', url: 'https://example.com/file.pdf' };
    const chat = {
        id: 'mixed_assets', title: 'Mixed assets', messages: [{
            role: 'model', content: 'Assets', images: [image], attachments: [
                image, file
            ]
        }]
    };
    const received: { item: unknown; isImage: boolean }[] = [];
    const origPipeline = __getModuleOverride('AssetPipeline');
    __setModuleOverride('AssetPipeline', class {
        async processAsset(item: { localName?: string }, receivedChat: unknown, options: { isImage: boolean }) {
            assert.equal((receivedChat as any).id, chat.id);
            received.push({ item, isImage: options.isImage });
            return { saved: true, localName: item.localName };
        }
    });
    try {
        const result = await new ExportOrchestrator().run({
            selected: [{ id: 'mixed_assets', title: 'Mixed assets' }], useZip: true, includeAssets: true,
            worker: makeTestWorker({ fetchChatDetail: async () => ({ success: true, chat: historicalFixture(chat) }) })
        });
        assert.strictEqual(result.failedChats.length, 0);
        assert.strictEqual(result.totalAssets, 2);
        assert.strictEqual(received.length, 2);
        assert.strictEqual(received.find(entry => (entry.item as any).url === image.url)?.isImage, true);
        assert.strictEqual(received.find(entry => (entry.item as any).url === file.url)?.isImage, false);
    } finally {
        __setModuleOverride('AssetPipeline', origPipeline);
    }
});

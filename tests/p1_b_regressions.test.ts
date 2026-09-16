// tests/p1_b_regressions.test.ts — B组 P1-011~P1-030 + P1-039 行为回归测试
// 以及 exportOrchestrator 拆分的契约锁。
// 运行: node -r./tests/ts_register.js --test tests/p1_b_regressions.test.ts
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'src');
const readTs = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

// ============================================================================
// 拆分契约锁: exportOrchestrator 拆出后公开 API 与模块边界
// ============================================================================

test('split-lock: exportEngine facade still exposes the old public API', () => {
    const eng = require('../src/core/engine/exportEngine.js');
    assert.strictEqual(typeof eng.ExportOrchestrator, 'function', 'ExportOrchestrator class');
    assert.strictEqual(typeof eng.AsyncQueue, 'function', 'AsyncQueue class');
    assert.strictEqual(typeof eng.ensureSubDir, 'function', 'ensureSubDir');
    assert.strictEqual(typeof eng.sanitizeFileName, 'function', 'sanitizeFileName');
    assert.strictEqual(typeof eng.sanitizeZipPath, 'function', 'sanitizeZipPath');
    assert.strictEqual(typeof eng.getExtensionVersion, 'function', 'getExtensionVersion');
    assert.ok(eng.sanitizeZipPath('a/../b'), 'sanitizeZipPath callable');
});

test('split-lock: exportOrchestrator depends on its split modules, one direction', () => {
    const src = readTs('core/engine/export/exportOrchestrator.ts');
    for (const m of ['exportTypes.js', 'asyncQueue.js', 'exportProgress.js', 'exportSession.js', 'exportWriter.js', 'chatExporter.js']) {
        assert.ok(src.includes(m), `exportOrchestrator must import ./${m}`);
    }
    // chatExporter must not import the orchestrator back (no cycle).
    const chat = readTs('core/engine/export/chatExporter.ts');
    assert.ok(!/from\s+['"]\.\/exportOrchestrator/.test(chat) && !chat.includes("require('./exportOrchestrator"),
        'chatExporter must not depend on exportOrchestrator');
});

test('split-lock: run() keeps the old constructor/run calling convention', async () => {
    const eng = require('../src/core/engine/exportEngine.js');
    const ExportEngine = eng.ExportEngine;
    const engine = new ExportEngine();
    assert.strictEqual(typeof engine.run, 'function', 'run(options, callbacks) must exist');
    assert.strictEqual(typeof engine.abort, 'function', 'abort() must exist');
});

// ============================================================================
// chatExporter 测试脚手架
// ============================================================================

function makeChatCtx(overrides = {}) {
    const chatExporter = require('../src/core/engine/export/chatExporter.js');
    const { AsyncQueue } = require('../src/core/engine/export/asyncQueue.js');
    const state = chatExporter.createChatExportState(0);
    return {
        options: {},
        format: 'markdown',
        skip: false,
        includeAssets: false,
        useZip: true,
        currentSlot: 'u0',
        conversations: [],
        takeoutEngine: null,
        totalChats: 1,
        slot: 'u0',
        curIds: {},
        exportedIds: {},
        Storage: null,
        state,
        worker: null,
        assetPipeline: null,
        attachmentQueue: new AsyncQueue(),
        rateLimiter: null,
        folder: { file: async () => {} },
        writeFileDirect: async () => true,
        abortSignal: null,
        isAborted: () => false,
        onProgress: () => {},
        onLog: () => {},
        onTitleUpdated: () => {},
        onItemExported: () => {},
        finalizeChatExport: async () => true,
        updateProgress: () => {},
        updateSessionStatus: async () => {},
        ...overrides
    };
}

const fakeWorker = (overrides = {}) => ({
    fetchChatDetail: async () => ({
        success: true,
        results: [{ id: 'c_aaa', title: 'Chat A', messages: [{ role: 'user', content: 'hi' }] }]
    }),
    resolveChat: async (chat: any) => ({
        chat,
        listTitle: chat.title,
        displayTitle: chat.title,
        isError: false,
        nid: 'nidA'
    }),
    ...overrides
});

test('P1-011: fetchChatDetail throws -> single chat fails, others continue', async () => {
    const chatExporter = require('../src/core/engine/export/chatExporter.js');
    let calls = 0;
    const worker = fakeWorker({
        fetchChatDetail: async () => {
            calls++;
            if (calls === 1) throw new Error('port exploded');
            return { success: true, results: [{ id: 'c_bbb', title: 'Chat B', messages: [] }] };
        }
    });
    const ctx = makeChatCtx({ worker, totalChats: 2 });
    await chatExporter.exportSingleChat(ctx, { id: 'c_aaa', title: 'Chat A' }, 0);
    assert.strictEqual(ctx.state.failedChats.length, 1, 'first chat must be recorded as failed');
    assert.strictEqual(ctx.state.landedChats, 0);
    await chatExporter.exportSingleChat(ctx, { id: 'c_bbb', title: 'Chat B' }, 1);
    assert.strictEqual(ctx.state.landedChats, 1, 'second chat must still export');
    assert.strictEqual(ctx.state.failedChats.length, 1, 'failure count stays at 1');
});

test('P1-011: resolveChat throws -> recorded as failed, no crash', async () => {
    const chatExporter = require('../src/core/engine/export/chatExporter.js');
    const worker = fakeWorker({
        resolveChat: async () => { throw new Error('resolve exploded'); }
    });
    const ctx = makeChatCtx({ worker });
    await chatExporter.exportSingleChat(ctx, { id: 'c_aaa', title: 'Chat A' }, 0);
    assert.strictEqual(ctx.state.failedChats.length, 1);
    assert.strictEqual(ctx.state.failedChats[0].id, 'c_aaa');
});

test('P1-013: finalizeChatExport is awaited before exportSingleChat returns', async () => {
    const chatExporter = require('../src/core/engine/export/chatExporter.js');
    const events: string[] = [];
    const ctx = makeChatCtx({
        worker: fakeWorker(),
        finalizeChatExport: async () => {
            events.push('finalize-start');
            await new Promise(r => setTimeout(r, 10));
            events.push('finalize-done');
            return true;
        }
    });
    await chatExporter.exportSingleChat(ctx, { id: 'c_aaa', title: 'Chat A' }, 0);
    assert.deepStrictEqual(
        events,
        ['finalize-start', 'finalize-done'],
        'finalize must fully complete before exportSingleChat returns (fire-and-forget would leave done pending)'
    );
});

test('P1-016: throwing attachment task decrements pending and finalizes the chat', async () => {
    const chatExporter = require('../src/core/engine/export/chatExporter.js');
    const { AsyncQueue } = require('../src/core/engine/export/asyncQueue.js');
    const state = chatExporter.createChatExportState(0);
    state.pendingAssetsPerChat.set('nid1', 1);
    const finalized: string[] = [];
    const queue = new AsyncQueue();
    const ctx = {
        state,
        attachmentQueue: queue,
        abortSignal: null,
        isAborted: () => false,
        onLog: () => {},
        finalizeChatExport: async (id: string) => { finalized.push(id); return true; }
    };
    const badTask = async () => { throw new Error('task boom'); };
    badTask.__assetMeta = { nid: 'nid1', chatId: 'c_aaa', listTitle: 'Chat A', fileName: 'a.jpg' };
    const goodRan: string[] = [];
    queue.push(badTask);
    queue.push(async () => { goodRan.push('ok'); });
    const pool = chatExporter.startAttachmentConsumers(ctx, 1);
    queue.close();
    await Promise.all(pool);
    assert.strictEqual(state.failedAttachments.length, 1, 'failed attachment must be recorded');
    assert.strictEqual(state.pendingAssetsPerChat.get('nid1'), 0, 'pending counter must reach zero');
    assert.deepStrictEqual(finalized, ['c_aaa'], 'chat must be finalized after its last asset fails');
    assert.deepStrictEqual(goodRan, ['ok'], 'consumer loop must continue after a task throws');
});

// ============================================================================
// P1-012: batchWorker 回调式 sender 兜底
// ============================================================================

test('P1-012: sender never calls back -> explicit timeout failure', async () => {
    const { BatchWorker } = require('../src/core/engine/export/batchWorker.js');
    const res = await BatchWorker.fetchChatDetail(
        { id: 'x', title: 't' }, 0, 1, 'u0', false, 'markdown', null,
        { messageSender: () => {}, sendTimeoutMs: 50 }
    );
    assert.strictEqual(res.success, false);
    assert.ok(/timed out/.test(res.error), `expected timeout error, got: ${res.error}`);
});

test('P1-012: sender throws synchronously -> failure, not a hang', async () => {
    const { BatchWorker } = require('../src/core/engine/export/batchWorker.js');
    const res = await BatchWorker.fetchChatDetail(
        { id: 'x', title: 't' }, 0, 1, 'u0', false, 'markdown', null,
        { messageSender: () => { throw new Error('port closed'); }, sendTimeoutMs: 500 }
    );
    assert.strictEqual(res.success, false);
    assert.ok(/sender threw/.test(res.error), `expected sender-threw error, got: ${res.error}`);
});

test('P1-012: aborted signal -> immediate failure without waiting', async () => {
    const { BatchWorker } = require('../src/core/engine/export/batchWorker.js');
    const ctrl = new AbortController();
    ctrl.abort();
    const res = await BatchWorker.fetchChatDetail(
        { id: 'x', title: 't' }, 0, 1, 'u0', false, 'markdown', ctrl.signal,
        { messageSender: () => {}, sendTimeoutMs: 5000 }
    );
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'aborted');
});

// ============================================================================
// P1-014 / P1-015: sessionRecovery
// ============================================================================

test('P1-014: storage write failure -> throws and memory success state stays clean', async () => {
    const sr = require('../src/core/engine/export/sessionRecovery.js');
    const utilsMod = require('../src/core/utils/utils.js');
    const normId = utilsMod.normId || utilsMod.default.normId;
    const nid = normId('c_aaa');
    const rec = { title: 'Chat A', format: 'markdown' };
    const finalizedChatsSet = new Set();
    const curIds: Record<string, any> = {};
    const storageAdapter = {
        async saveExportRecord() { throw new Error('disk full'); }
    };
    let threw = null;
    try {
        await sr.finalizeChatExport('c_aaa', {
            storageAdapter,
            chatRecordsMap: new Map([[nid, rec]]),
            finalizedChatsSet,
            curIds,
            exportedIds: {},
            onItemExported: () => {}
        });
    } catch (e) { threw = e; }
    assert.ok(threw, 'storage failure must propagate');
    assert.strictEqual(finalizedChatsSet.has(nid), false,
        'failed write must not mark the chat finalized in memory');
    assert.ok(!curIds['c_aaa'] && !curIds[nid], 'curIds must not gain the record on failure');
});

test('P1-014: storage success -> memory state updated exactly once', async () => {
    const sr = require('../src/core/engine/export/sessionRecovery.js');
    const utilsMod = require('../src/core/utils/utils.js');
    const normId = utilsMod.normId || utilsMod.default.normId;
    const nid = normId('c_aaa');
    const rec = { title: 'Chat A', format: 'markdown' };
    const saved = [];
    const storageAdapter = {
        async saveExportRecord(slot: any, id: any, record: any) { saved.push({ slot, id, record }); }
    };
    const finalizedChatsSet = new Set();
    const curIds: Record<string, any> = {};
    const ok = await sr.finalizeChatExport('c_aaa', {
        storageAdapter,
        chatRecordsMap: new Map([[nid, rec]]),
        finalizedChatsSet,
        curIds,
        exportedIds: {},
        onItemExported: () => {}
    });
    assert.strictEqual(ok, true);
    assert.strictEqual(saved.length, 1, 'exactly one record write');
    assert.ok(finalizedChatsSet.has(nid), 'chat must be marked finalized after successful write');
});

test('P1-015: concurrent updateSessionStatus does not lose a patch', async () => {
    const sr = require('../src/core/engine/export/sessionRecovery.js');
    let stored: any = null;
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
    (globalThis as any).chrome = {
        storage: {
            local: {
                get: async (): Promise<any> => { await delay(25); return { gemini_last_export_session: stored ? { ...stored } : {} }; },
                set: async (obj: any) => { stored = { ...obj.gemini_last_export_session }; }
            }
        }
    };
    try {
        await Promise.all([
            sr.updateSessionStatus({ status: 'running', total: 10 }),
            sr.updateSessionStatus({ status: 'running', completed: 3 })
        ]);
        assert.strictEqual(stored.total, 10, 'first patch must survive');
        assert.strictEqual(stored.completed, 3, 'second patch must survive');
    } finally {
        (globalThis as any).chrome = undefined;
    }
});

// ============================================================================
// P1-023: 进度公式单一且单调
// ============================================================================

test('P1-023: progress never regresses when attachments grow mid-export', () => {
    const { calculateExportProgress } = require('../src/core/engine/export/exportProgress.js');
    // old dual formula: 9/10 chats + 5/50 assets -> 70 (regression from 90).
    const pct = calculateExportProgress({
        current: 9, total: 10, downloadedAssets: 5, totalAssets: 50, prevPct: 90
    });
    assert.ok(pct >= 90, `progress must not regress, got ${pct}`);
});

test('P1-023: pure-chat progress matches the single formula', () => {
    const { calculateExportProgress } = require('../src/core/engine/export/exportProgress.js');
    assert.strictEqual(calculateExportProgress({ current: 5, total: 10 }), 50);
    assert.strictEqual(calculateExportProgress({ current: 10, total: 10 }), 100);
});

test('P1-023: orchestrator uses the shared formula, not a second blend', () => {
    const src = readTs('core/engine/export/exportOrchestrator.ts');
    assert.ok(src.includes('calculateExportProgress'), 'orchestrator must call the shared formula');
    assert.ok(!src.includes('CHAT_PROGRESS_WEIGHT'),
        'orchestrator must not define its own progress weights');
});

// ============================================================================
// P1-017/018: background 同 slot 串行 + guarded response (结构锁)
// ============================================================================

test('P1-017: background serializes fetchBatchChains per slot', () => {
    const src = readTs('background/background.ts');
    assert.ok(src.includes('fetchBatchChains'), 'fetchBatchChains chain map must exist');
    assert.ok(src.includes('fetchBatchChains.get(slot)'), 'each slot must queue on its own chain');
    assert.ok(src.includes('fetchBatchChains.set(slot'), 'the chain tail must be stored per slot');
});

test('P1-018: background always responds exactly once to fetchBatch', () => {
    const src = readTs('background/background.ts');
    assert.ok(src.includes('guardedResponse'), 'guarded response helper must exist');
    assert.ok(src.includes('fetchBatch completed without a response'),
        'missing response must fail closed with an explicit error');
    assert.ok(src.includes('} catch (e: any) {'), 'handler throw must be caught');
});

// ============================================================================
// P1-019: batchFetcher abort 语义 / P1-039: messageRouter retryAfterMs 透出 (结构锁)
// ============================================================================

test('P1-019: aborted batch is never reported as success', () => {
    const src = readTs('background/batchFetcher.ts');
    assert.ok(src.includes('aborted: wasAborted'), 'abort flag must be propagated');
    assert.ok(src.includes('success: !wasAborted'), 'aborted batch must report success:false');
});

test('P1-020: deepScan null result is failure, not empty success', () => {
    const src = readTs('content/messageRouter.ts');
    assert.ok(src.includes('success: false'), 'null deep scan must fail');
    assert.ok(src.includes('deep scan did not produce a result'), 'null deep scan must be labeled');
});

test('P1-039: messageRouter exposes top-level retryAfterMs on detail responses', () => {
    const src = readTs('content/messageRouter.ts');
    assert.ok(src.includes('retryAfterMs: (detail as any)?.retryAfterMs'), 'detail response must expose retryAfterMs at top level');
});

// ============================================================================
// P1-021/022: UI 互斥与 prompt 生命周期 (结构锁)
// ============================================================================

test('P1-021: exportController constructs the engine inside the try', () => {
    const src = readTs('ui/controllers/exportController.ts');
    const tryIdx = src.indexOf('try {');
    const newIdx = src.indexOf('new engineClass(');
    assert.ok(tryIdx !== -1 && newIdx !== -1 && newIdx > tryIdx,
        'new engineClass() must sit inside the try so finally always unlocks the UI');
});

test('P1-022: optionsExport prompt decision is observable and closable', () => {
    const src = readTs('ui/options/modules/optionsExport.ts');
    assert.ok(src.includes('decisionPromise'), 'direct-write prompt must return a decision promise');
    assert.ok(src.includes('MutationObserver'), 'prompt must detect Escape/X dismissal');
    assert.ok(src.includes('settleDecision'), 'decision must be settled exactly once');
});

// ============================================================================
// P1-024~026: 监听器/内存泄漏 (结构锁)
// ============================================================================

test('P1-024: syncEngine bounds and ages the last-touched map', () => {
    const src = readTs('content/syncEngine.ts');
    assert.ok(src.includes('LAST_TOUCHED_MAX_ENTRIES'), 'capacity constant must exist');
    assert.ok(src.includes('pruneLastTouchedMap(now)'), 'prune must be called');
    assert.ok(src.includes('LAST_TOUCHED_TTL_MS'), 'stale entries must expire by TTL');
});

test('P1-025: liveSaveObserver module-level handlers are idempotent and removable', () => {
    const src = readTs('content/liveSaveObserver.ts');
    assert.ok(src.includes('__onLocationChange'), 'location handler must be module-level');
    assert.ok(src.includes('__initialized'), 'init must be idempotent');
    assert.ok(src.includes('removeEventListener(\'popstate\', __onLocationChange)'),
        'cleanup must remove the popstate listener');
});

test('P1-026: content.ts runs the previous bundle cleanup on re-injection', () => {
    const src = readTs('content/content.ts');
    assert.ok(src.includes('__gemExporterCleanups'), 'cross-bundle cleanup registry must exist');
    assert.ok(src.includes('runPreviousBundleCleanups()'), 're-injection must run previous cleanups');
    assert.ok(src.includes('removeListener'), 'router removeListener must be captured');
});

// ============================================================================
// P1-027: assetFetcher base64 上限 (结构锁)
// ============================================================================

test('P1-027: both blob handlers gate size before base64 encoding', () => {
    const src = readTs('content/assetFetcher.ts');
    const gates = (src.match(/if \(blob\.size > MAX_BASE64_BLOB_SIZE\)/g) || []).length;
    assert.ok(gates >= 2, `both blob handlers must gate size before toDataUrl, found ${gates}`);
    assert.ok(src.includes('MAX_BASE64_BLOB_SIZE'), 'cap constant must exist');
});

// ============================================================================
// P1-028: hookCredentials 3MB stream cap (行为测试)
// ============================================================================

function createCappedHookSandbox() {
    const hookCode = fs.readFileSync(path.join(SRC, 'content', 'hookCredentials.js'), 'utf8');
    const protocolCode = fs.readFileSync(path.join(SRC, 'core', 'protocol', 'protocol.js'), 'utf8');
    const posted: any[] = [];
    const CHUNK = 64 * 1024;
    const TOTAL = 4 * 1024 * 1024; // 4MB > 3MB cap
    const listMarker = new TextEncoder().encode(')]}') + '' ;
    const markerBytes = new TextEncoder().encode('MaZiqc'); // LIST rpc id, forces broadcast
    let sent = 0;
    const win: any = {};
    win.postMessage = (msg: any, origin: any) => posted.push({ msg, origin });
    win.addEventListener = () => {};
    win.fetch = async () => ({
        ok: true,
        clone() {
            return {
                body: {
                    getReader() {
                        return {
                            async read() {
                                if (sent >= TOTAL) return { done: true, value: undefined };
                                const size = Math.min(CHUNK, TOTAL - sent);
                                const buf = new Uint8Array(size).fill(65);
                                if (sent === 0) buf.set(markerBytes, 0);
                                sent += size;
                                return { done: false, value: buf };
                            },
                            releaseLock() {},
                            cancel() {}
                        };
                    }
                }
            };
        }
    });
    const sandbox = {
        window: win,
        location: { origin: 'https://gemini.google.com', href: 'https://gemini.google.com/app', pathname: '/app' },
        document: { querySelectorAll: () => [] },
        console: { log: () => {}, warn: () => {}, debug: () => {} },
        setTimeout: (fn: any) => 0,
        URLSearchParams,
        TextDecoder,
        TextEncoder
    };
    vm.createContext(sandbox);
    vm.runInContext(protocolCode, sandbox, { filename: 'protocol.js' });
    (win as any).GeminiProtocol = (sandbox as any).GeminiProtocol;
    vm.runInContext(hookCode, sandbox, { filename: 'hookCredentials.js' });
    return { posted, win };
}

test('P1-028: batchexecute sniff reads at most ~3MB from a 4MB stream', async () => {
    const { posted, win } = createCappedHookSandbox();
    await win.fetch('https://gemini.google.com/_/batchexecute', { method: 'POST', body: 'x' });
    await new Promise(r => setTimeout(r, 50));
    const texts = posted
        .map(p => p.msg && p.msg.payload && p.msg.payload.text)
        .filter(t => typeof t === 'string');
    assert.ok(texts.length > 0, 'streamed batchexecute containing LIST rpc must be broadcast');
    for (const t of texts) {
        assert.ok(t.length <= 3 * 1024 * 1024,
            `sniffed text must be capped at 3MB, got ${t.length}`);
    }
});

test('P1-028: stream path is preferred and capped via reader', () => {
    const src = readTs('content/hookCredentials.ts');
    assert.ok(src.includes('readCappedText'), 'capped stream reader must exist');
    assert.ok(src.includes('getReader'), 'streaming body must be consumed via getReader');
});

// ============================================================================
// P1-029/030: liveSaveCoordinator (结构锁)
// ============================================================================

test('P1-029: live-save image processing is bounded to a small worker pool', () => {
    const src = readTs('content/liveSaveCoordinator.ts');
    assert.ok(src.includes('IMAGE_FETCH_CONCURRENCY'), 'concurrency constant must exist');
    assert.ok(src.includes('Math.min(IMAGE_FETCH_CONCURRENCY'), 'worker count must be bounded by the constant');
});

test('P1-030: oversized live-save payloads fail closed and warn', () => {
    const src = readTs('content/liveSaveCoordinator.ts');
    assert.ok(src.includes('LIVE_SAVE_PAYLOAD_CAP'), 'payload cap constant must exist');
    assert.ok(src.includes('payload_too_large'), 'oversize must surface a warning badge');
});

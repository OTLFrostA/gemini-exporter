import { useIndexStorage } from './helpers/indexStorage.js';
useIndexStorage();
const { historicalFixture } = require('./helpers/nativeFixture.js');
// tests/export_cancel_semantics.test.ts
// B3: 取消语义 —— 取消是用户意图，不记失败、不写 _export_errors.json、无下载回调。
// 覆盖三类：
//   1. 用户取消（AbortError）：failedChats 为空、无下载回调、不写错误文件
//   2. 权限被收回（ExportPipelineError + isPermissionRevoked）：记一条真实失败，仍无下载
//   3. B2: 限流退避可被取消打断 —— abortableSleep 让 30s 退避在取消后即时结束
import { makeTestWorker } from './helpers/makeTestWorker.js';
const test = require('node:test');
const assert = require('node:assert');

const { ExportOrchestrator } = require('../src/core/engine/export/exportOrchestrator.js');
const { __setModuleOverride } = require('../src/core/utils/moduleOverrides.js');

// 不失败的 MockJSZip（记录写入文件，用于断言 _export_errors.json 未产生）
function setupMockJSZip() {
    const seen: string[] = [];
    __setModuleOverride('JSZip', class MockJSZip {
        files: Record<string, any> = {};
        folder(_name: string) {
            const self = this;
            return {
                file: (path: string, content: any) => {
                    seen.push(path);
                    self.files[path] = content;
                }
            };
        }
        async generateAsync(_options?: any, cb?: (p: { percent: number }) => void) {
            if (cb) cb({ percent: 100 });
            return new Blob(['mock-zip'], { type: 'application/zip' });
        }
    });
    return seen;
}

// 抛 NotAllowedError 的 MockJSZip（模拟目录句柄权限被收回）
function setupPermissionRevokedJSZip() {
    __setModuleOverride('JSZip', class MockJSZip {
        files: Record<string, any> = {};
        folder(_name: string) {
            const self = this;
            return {
                file: (path: string, content: any) => {
                    if (/\.md$/.test(path)) {
                        throw new DOMException('Permission denied', 'NotAllowedError');
                    }
                    self.files[path] = content;
                }
            };
        }
        async generateAsync(_options?: any, cb?: (p: { percent: number }) => void) {
            if (cb) cb({ percent: 100 });
            return new Blob(['mock-zip'], { type: 'application/zip' });
        }
    });
}

// 内存 StorageService：必须实现 saveExportRecord（finalize fail-closed）
function setupMockStorage() {
    const mem: Record<string, any> = {};
    __setModuleOverride('StorageService', {
        getExportedIds: async (_slot: string) => ({}),
        saveExportRecord: async (_slot: string, id: string, rec: any) => {
            mem[id] = rec;
            return { ...mem };
        },
    });
    return mem;
}

function collectLogs() {
    const logs: Array<{ msg: string; level?: string }> = [];
    return {
        logs,
        onLog: (msg: string, level?: string) => logs.push({ msg, level }),
    };
}

function baseOptions(overrides: any = {}) {
    return {
        selected: [
            { id: 'chat-cancel-1', title: 'Cancel Chat 1' },
            { id: 'chat-cancel-2', title: 'Cancel Chat 2' }
        ],
        format: 'markdown',
        useZip: true,
        includeAssets: false,
        concurrency: 1,
        ...overrides
    };
}

// 1. 用户取消：第二个会话在 resolveChat 阶段（抓取完、写入前）被取消 ——
// writeFileDirect 入口抛原生 AbortError，取消不记失败、无下载、不写错误文件
test('cancel semantics - user cancel mid-export: no failedChats, no download, no error file', async () => {
    const seenFiles = setupMockJSZip();
    const records = setupMockStorage();
    let exportedCalls = 0;
    const { onLog } = collectLogs();
    const orchestrator = new ExportOrchestrator();
    let downloadCalls = 0;

    const worker = makeTestWorker({
        fetchChatDetail: async (requestedItem: any) => ({
            success: true,
            chat: historicalFixture({
                id: requestedItem.id,
                title: requestedItem.title,
                messages: [{ role: 'user', content: 'Hello' }]
            })
        }),
        // 注入点：抓取完成、主 md 写入前 —— 用户点了取消
        resolveChat: async (chat: any, _requestedItem: any) => {
            if (chat.conversation.id === 'chat-cancel-2') {
                orchestrator.abort();
            }
            return {
                chat,
                listTitle: chat.conversation.title,
                displayTitle: chat.conversation.title,
                isError: false,
                source: 'online',
                errMsg: null,
                isConfirmedDeleted: false,
                convsNeedSave: false
            };
        }
    });

    const result = await orchestrator.run(baseOptions({
        worker,
        downloadHandler: async (_blob: Blob, _name: string) => { downloadCalls++; }
    }), { onLog, onItemExported: () => { exportedCalls++; } });

    assert.strictEqual(result.aborted, true, 'result must carry aborted:true');
    assert.strictEqual(result.landedChats, 0, 'staged ZIP bodies were never delivered');
    assert.deepEqual(records, {}, 'cancelled staging must not save records');
    assert.equal(exportedCalls, 0, 'cancelled staging must not notify UI');
    assert.strictEqual(result.failedChats.length, 0, 'cancel must not be recorded as failure');
    assert.strictEqual(result.failedAttachments.length, 0, 'cancel must not pollute attachment failures');
    assert.strictEqual(downloadCalls, 0, 'cancel must not trigger the download callback');
    assert.ok(
        !seenFiles.some(p => /_export_errors\.json$/.test(p)),
        'cancel must not write _export_errors.json'
    );
});

// 2. 权限被收回：ExportPipelineError(isPermissionRevoked) —— 真实失败，记一条；仍无下载
test('cancel semantics - permission revoked: one real failure recorded, still no download', async () => {
    setupPermissionRevokedJSZip();
    setupMockStorage();
    const { onLog } = collectLogs();
    const orchestrator = new ExportOrchestrator();
    let downloadCalls = 0;

    const worker = makeTestWorker({
        fetchChatDetail: async (requestedItem: any) => ({
            success: true,
            chat: historicalFixture({
                id: requestedItem.id,
                title: requestedItem.title,
                messages: [{ role: 'user', content: 'Hello' }]
            })
        })
    });

    const result = await orchestrator.run(baseOptions({
        selected: [{ id: 'chat-revoked-1', title: 'Revoked Chat' }],
        worker,
        downloadHandler: async (_blob: Blob, _name: string) => { downloadCalls++; }
    }), { onLog });

    assert.strictEqual(result.aborted, true);
    assert.strictEqual(result.failedChats.length, 1, 'permission revocation is a real failure');
    assert.strictEqual(
        result.failedChats[0].error, 'Aborted due to permission revocation',
        'must distinguish permission-revoked from user-cancel'
    );
    assert.strictEqual(downloadCalls, 0, 'revoked run must not trigger the download callback');
});

// 3. B2: 限流退避可被取消打断 —— 30s 退避在取消后即时结束，不傻等
test('cancel semantics - rate-limit backoff is abortable (no 30s stall on cancel)', async () => {
    setupMockJSZip();
    setupMockStorage();
    const { onLog } = collectLogs();
    const orchestrator = new ExportOrchestrator();
    let downloadCalls = 0;

    // 始终判限流、退避 30s：若 abortableSleep 未接 signal，这里会卡 30s
    orchestrator.rateLimiter = {
        rateLimitCooldownUntil: 0,
        isRateLimited: () => true,
        calculateBackoff: () => 30000,
        recordRateLimit: () => {}
    };

    let fetchCalls = 0;
    const worker = makeTestWorker({
        fetchChatDetail: async (requestedItem: any) => {
            fetchCalls++;
            if (fetchCalls === 1) {
                setTimeout(() => orchestrator.abort(), 50);
            }
            return { success: false, error: 'rate limited' };
        }
    });

    const startedAt = Date.now();
    const result = await orchestrator.run(baseOptions({
        selected: [{ id: 'chat-backoff-1', title: 'Backoff Chat' }],
        worker,
        downloadHandler: async (_blob: Blob, _name: string) => { downloadCalls++; }
    }), { onLog });
    const elapsed = Date.now() - startedAt;

    assert.ok(elapsed < 15000, `backoff must be interrupted by cancel (took ${elapsed}ms)`);
    assert.strictEqual(result.aborted, true);
    assert.strictEqual(result.failedChats.length, 0, 'cancel during backoff must not be recorded as failure');
    assert.strictEqual(downloadCalls, 0);
});

test('ZIP delivery makes cancellation during Storage await ineffective; next run can still cancel', async () => {
    const Storage = require('../src/core/storage/storageService.js');
    const { SessionStore } = require('../src/core/storage/sessionStore.js');
    const { __clearModuleOverrides } = require('../src/core/utils/moduleOverrides.js');
    const previousChrome = Reflect.get(globalThis, 'chrome');
    const memory: Record<string, unknown> = {};
    const { expKey } = Storage.getStorageKeys('u0');
    let releaseWrite = () => {};
    let startedWrite = () => {};
    const paused = new Promise<void>(resolve => { startedWrite = resolve; });
    const release = new Promise<void>(resolve => { releaseWrite = resolve; });
    let blockFirstWrite = true, downloads = 0, cancellations = 0;
    Reflect.set(globalThis, 'chrome', {
        runtime: { sendMessage: (message: { action: string }, callback: () => void) => {
            if (message.action === 'cancelExport') cancellations++;
            callback();
        } },
        storage: { local: {
            get: async (keys: string | string[] | null) => structuredClone(Object.fromEntries(Object.entries(memory)
                .filter(([key]) => keys === null || (Array.isArray(keys) ? keys.includes(key) : keys === key)))),
            set: async (patch: Record<string, unknown>) => {
                if (patch[expKey] && blockFirstWrite) {
                    blockFirstWrite = false;
                    assert.equal(downloads, 1);
                    startedWrite();
                    await release;
                }
                Object.assign(memory, structuredClone(patch));
            },
            remove: async () => {},
        } },
    });
    setupMockJSZip();
    __setModuleOverride('StorageService', Storage);
    const orchestrator = new ExportOrchestrator();
    const worker = makeTestWorker({ fetchChatDetail: async (item: { id: string }) => ({ success: true,
        chat: historicalFixture({ id: item.id, messages: [{ role: 'user', content: 'Hello' }] }),
    }) });
    const notified: string[] = [];
    try {
        const pending = orchestrator.run(baseOptions({ worker, downloadHandler: () => { downloads++; } }), {
            onItemExported: (id: string) => { notified.push(id); },
        });
        await paused;
        orchestrator.abort();
        assert.equal(cancellations, 0, 'confirmed delivery must not send backend cancellation');
        assert.equal((await SessionStore.getSession()).status, 'running');
        releaseWrite();
        const result = await pending;
        assert.equal(result.aborted, false);
        assert.equal(result.landedChats, 2);
        assert.equal(result.exportedCount, 2);
        assert.equal(downloads, 1);
        assert.deepEqual(Object.keys(await Storage.getExportedIds('u0')).sort(), ['chat-cancel-1', 'chat-cancel-2']);
        assert.equal(notified.length, 2);
        assert.equal((await SessionStore.getSession()).status, 'completed');
        assert.equal(cancellations, 0);

        const before = structuredClone(memory);
        notified.length = 0;
        const cancelled = await orchestrator.run(baseOptions({ worker, downloadHandler: () => {
            downloads++;
            orchestrator.abort();
        } }), { onItemExported: (id: string) => { notified.push(id); } });
        assert.equal(cancelled.aborted, true, 'delivery flag must reset on every run');
        assert.equal(cancelled.landedChats, 0);
        assert.deepEqual(memory[expKey], before[expKey], 'cancellation inside download callback cannot commit');
        assert.deepEqual(notified, []);
        assert.equal((await SessionStore.getSession()).status, 'aborted');
        assert.equal(cancellations, 1);
    } finally {
        releaseWrite();
        __clearModuleOverrides();
        if (previousChrome === undefined) Reflect.deleteProperty(globalThis, 'chrome');
        else Reflect.set(globalThis, 'chrome', previousChrome);
    }
});

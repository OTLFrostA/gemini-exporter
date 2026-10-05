import test from 'node:test';
import assert from 'node:assert';
import {
    writeIndexAndMeta,
    writeDiagnostics,
    buildSessionLogText,
    finalizeChatExport,
    updateSessionStatus,
    SessionRecovery,
    type FinalizeChatExportContext
} from '../src/core/engine/export/sessionRecovery.js';
import { SessionStore } from '../src/core/storage/sessionStore.js';
import type { IExportWriter } from '../src/core/engine/writers/writerInterface.js';
import type { StoredExportRecordMap, StoredExportRecord } from '../src/core/storage/storageCompatibility.js';

interface MockMemoryWriter extends IExportWriter {
    files: Record<string, string>;
    writeHistory: string[];
}

function createMemoryWriter(): MockMemoryWriter {
    const files: Record<string, string> = {};
    const writeHistory: string[] = [];
    return {
        files,
        writeHistory,
        writeFile: async (filePath: string, content: string | Uint8Array) => {
            writeHistory.push(filePath);
            files[filePath] = typeof content === 'string' ? content : new TextDecoder().decode(content);
            return filePath;
        }
    };
}

// 1. Concurrent claim before first await & deduplication
test('C4-1: finalizeChatExport claims before first await, deduplicating concurrent calls', async () => {
    let pauseSaveResolve: (() => void) | undefined;
    const pausePromise = new Promise<void>((resolve) => {
        pauseSaveResolve = resolve;
    });

    let firstCallFinished = false;
    let saveCount = 0;

    const pausingAdapter = {
        saveExportRecord: async () => {
            saveCount++;
            await pausePromise;
            return {};
        }
    };

    const finalizedChatsSet = new Set<string>();
    const chatRecordsMap = new Map<string, StoredExportRecord>([
        ['chat_concurrent', {
            title: 'Concurrent Chat',
            status: 'ok',
            exportedAt: '2026-10-05T12:00:00.000Z'
        }]
    ]);

    const context: FinalizeChatExportContext = {
        finalizedChatsSet,
        chatRecordsMap,
        storageAdapter: pausingAdapter,
        slot: 'u0'
    };

    // Launch first call: it claims before first await, then suspends in saveExportRecord
    const firstCallPromise = finalizeChatExport('c_chat_concurrent', context).then((res) => {
        firstCallFinished = true;
        return res;
    });

    // Verify synchronous claim happened before the first await resumed
    assert.strictEqual(finalizedChatsSet.has('chat_concurrent'), true);

    // Launch concurrent second call while first call is suspended in flight
    const secondCallPromise = finalizeChatExport('chat_concurrent', context);

    // Second call must return false immediately without re-saving
    const secondResult = await secondCallPromise;
    assert.strictEqual(secondResult, false);
    assert.strictEqual(firstCallFinished, false, 'First call must still be paused');
    assert.strictEqual(saveCount, 1);

    // Resume first call and assert success
    if (pauseSaveResolve) pauseSaveResolve();
    const firstResult = await firstCallPromise;
    assert.strictEqual(firstResult, true);
    assert.strictEqual(firstCallFinished, true);
    assert.strictEqual(saveCount, 1, 'saveExportRecord must only have run once');
});

// 2. Claim release on failure & map/callback isolation
test('C4-2: claim released on write failure, maps not updated early, callback not called', async () => {
    const finalizedChatsSet = new Set<string>();
    const curIds: StoredExportRecordMap = {};
    const exportedIds: StoredExportRecordMap = {};
    let callbackCount = 0;
    let attempts = 0;
    let shouldFail = true;

    const failingAdapter = {
        saveExportRecord: async () => {
            attempts++;
            // Verify maps have NOT been updated before write completes
            assert.strictEqual(curIds['chat_fail'], undefined);
            assert.strictEqual(exportedIds['chat_fail'], undefined);
            if (shouldFail) {
                throw new Error('Storage write failed');
            }
            return {};
        }
    };

    const context: FinalizeChatExportContext = {
        finalizedChatsSet,
        chatRecordsMap: new Map<string, StoredExportRecord>([
            ['chat_fail', { title: 'Fail Chat', exportedAt: '2026-10-05T12:00:00.000Z' }]
        ]),
        curIds,
        exportedIds,
        storageAdapter: failingAdapter,
        onItemExported: () => {
            callbackCount++;
        }
    };

    // First attempt fails
    await assert.rejects(
        () => finalizeChatExport('chat_fail', context),
        /Storage write failed/
    );

    // Claim released
    assert.strictEqual(finalizedChatsSet.has('chat_fail'), false);
    // Maps untouched
    assert.strictEqual(curIds['chat_fail'], undefined);
    assert.strictEqual(exportedIds['chat_fail'], undefined);
    // Callback never fired
    assert.strictEqual(callbackCount, 0);
    assert.strictEqual(attempts, 1);

    // Retry succeeds
    shouldFail = false;
    const retryOk = await finalizeChatExport('chat_fail', context);
    assert.strictEqual(retryOk, true);
    assert.strictEqual(finalizedChatsSet.has('chat_fail'), true);
    assert.ok(curIds['chat_fail']);
    assert.ok(exportedIds['chat_fail']);
    assert.strictEqual(callbackCount, 1);
    assert.strictEqual(attempts, 2);
});

// 3. finalizeConversationExport preferred & callback called once via adapter
test('C4-3: finalizeConversationExport preferred over saveExportRecord and delegates callback once', async () => {
    let finalizeCalls = 0;
    let saveCalls = 0;
    let callbackCount = 0;

    const dualAdapter = {
        finalizeConversationExport: async <T>(
            _slot: string | null | undefined,
            id: string | number,
            record: T,
            options?: { onItemExported?: (id: string, record: T) => void }
        ) => {
            finalizeCalls++;
            // The adapter executes the callback
            options?.onItemExported?.(String(id), record);
            return { ok: true, record };
        },
        saveExportRecord: async () => {
            saveCalls++;
            return {};
        }
    };

    const recordObj: StoredExportRecord = {
        title: 'Dual Adapter Chat',
        exportedAt: '2026-10-05T12:00:00.000Z'
    };

    const context: FinalizeChatExportContext = {
        chatRecordsMap: new Map([
            ['chat_dual', {
                ...recordObj,
                exportRecord: recordObj,
                conversationUpdate: { title: 'Dual Title', titleSource: 'rpc' }
            }]
        ]),
        storageAdapter: dualAdapter,
        onItemExported: () => {
            callbackCount++;
        }
    };

    const ok = await finalizeChatExport('c_chat_dual', context);
    assert.strictEqual(ok, true);
    assert.strictEqual(finalizeCalls, 1, 'finalizeConversationExport must be invoked');
    assert.strictEqual(saveCalls, 0, 'saveExportRecord must NOT be invoked when finalizeConversationExport exists');
    assert.strictEqual(callbackCount, 1, 'Callback must be called exactly once via adapter');
});

// 4. saveExportRecord fallback path
test('C4-4: saveExportRecord fallback invokes onItemExported and survives callback errors', async () => {
    let saveCalls = 0;
    let callbackCount = 0;

    const saveOnlyAdapter = {
        saveExportRecord: async () => {
            saveCalls++;
            return {};
        }
    };

    const context: FinalizeChatExportContext = {
        chatRecordsMap: new Map<string, StoredExportRecord>([
            ['chat_fallback_err', { title: 'Fallback Error Chat', exportedAt: '2026-10-05T12:00:00.000Z' }]
        ]),
        storageAdapter: saveOnlyAdapter,
        onItemExported: () => {
            callbackCount++;
            throw new Error('Callback throws deliberately');
        }
    };

    const ok = await finalizeChatExport('chat_fallback_err', context);
    assert.strictEqual(ok, true, 'Fallback must succeed even if callback throws');
    assert.strictEqual(saveCalls, 1);
    assert.strictEqual(callbackCount, 1);
});

// 5. failed assets -> partial mutation while preserving empty and failed
test('C4-5: failed assets mutates ok to partial while preserving failed and empty', async () => {
    const chatFailedAssetsSet = new Set<string>(['ok', 'empty', 'failed']);
    const okRecord: StoredExportRecord = { title: 'OK', status: 'ok', hasFailedAssets: false, exportedAt: 1 };
    const emptyRecord: StoredExportRecord = { title: 'Empty', status: 'empty', hasFailedAssets: false, exportedAt: 2 };
    const failedRecord: StoredExportRecord = { title: 'Failed', status: 'failed', hasFailedAssets: false, exportedAt: 3 };

    const chatRecordsMap = new Map<string, StoredExportRecord>([
        ['ok', okRecord],
        ['empty', emptyRecord],
        ['failed', failedRecord]
    ]);

    const mockAdapter = {
        saveExportRecord: async () => ({})
    };

    await finalizeChatExport('c_ok', { chatRecordsMap, chatFailedAssetsSet, storageAdapter: mockAdapter });
    assert.strictEqual(okRecord.status, 'partial', 'ok must become partial');
    assert.strictEqual(okRecord.hasFailedAssets, true);

    await finalizeChatExport('c_empty', { chatRecordsMap, chatFailedAssetsSet, storageAdapter: mockAdapter });
    assert.strictEqual(emptyRecord.status, 'empty', 'empty status must be preserved');
    assert.strictEqual(emptyRecord.hasFailedAssets, true);

    await finalizeChatExport('c_failed', { chatRecordsMap, chatFailedAssetsSet, storageAdapter: mockAdapter });
    assert.strictEqual(failedRecord.status, 'failed', 'failed status must be preserved');
    assert.strictEqual(failedRecord.hasFailedAssets, true);
});

// 6. Diagnostics fail-closed on 2nd and 3rd write failures
test('C4-6: writeDiagnostics fail-closed on 2nd and 3rd write failures without reporting success', async () => {
    // Missing writer throws
    await assert.rejects(
        () => writeDiagnostics(false, {}, 'log', null),
        /IExportWriter is required/
    );

    // 2nd write failure (_export_errors.json)
    const writerFailsOnSecond: IExportWriter = {
        writeFile: async (filePath: string) => {
            if (filePath === '_export_errors.json') {
                throw new Error('Errors JSON write failed');
            }
            return filePath;
        }
    };

    let logReported = false;
    await assert.rejects(
        () => writeDiagnostics(
            true,
            { failedChats: ['c1'] },
            'log',
            writerFailsOnSecond,
            () => { logReported = true; }
        ),
        /Errors JSON write failed/
    );
    assert.strictEqual(logReported, false, 'onLog must NOT be called when writing errors JSON fails');

    // 3rd write failure (_export_session_dev.json)
    const writerFailsOnThird: IExportWriter = {
        writeFile: async (filePath: string) => {
            if (filePath === '_export_session_dev.json') {
                throw new Error('Session Dev JSON write failed');
            }
            return filePath;
        }
    };

    logReported = false;
    await assert.rejects(
        () => writeDiagnostics(
            true,
            { failedChats: ['c1'] },
            'log',
            writerFailsOnThird,
            () => { logReported = true; }
        ),
        /Session Dev JSON write failed/
    );
    assert.strictEqual(logReported, false, 'onLog must NOT be called when writing session dev JSON fails');
});

// 7. Session update queue FIFO continuity after rejection
test('C4-7: session update queue executes subsequent items in FIFO order after a rejection', async () => {
    const origUpdateSession = SessionStore.updateSession;
    const executionOrder: string[] = [];

    let rejectFirst: ((err: Error) => void) | undefined;
    const firstGate = new Promise<void>((_, reject) => {
        rejectFirst = reject;
    });

    let resolveSecond: (() => void) | undefined;
    const secondGate = new Promise<void>((resolve) => {
        resolveSecond = resolve;
    });

    let callCount = 0;
    SessionStore.updateSession = async () => {
        callCount++;
        if (callCount === 1) {
            executionOrder.push('start:1');
            await firstGate;
            executionOrder.push('end:1');
        } else if (callCount === 2) {
            executionOrder.push('start:2');
            await secondGate;
            executionOrder.push('end:2');
        }
    };

    try {
        // Enqueue write 1
        const p1 = updateSessionStatus({ status: 'running', current: 1 });
        await Promise.resolve();
        assert.deepStrictEqual(executionOrder, ['start:1']);

        // While write 1 is in-flight, enqueue write 2
        const p2 = updateSessionStatus({ status: 'completed', current: 2 });
        await Promise.resolve();
        // Write 2 is waiting behind write 1; has not started yet
        assert.deepStrictEqual(executionOrder, ['start:1']);

        // Reject write 1
        if (rejectFirst) rejectFirst(new Error('Write 1 failed'));
        await assert.rejects(() => p1, /Write 1 failed/);

        // Allow microtask to process write 2 start
        await new Promise((r) => setTimeout(r, 10));
        assert.deepStrictEqual(executionOrder, ['start:1', 'start:2']);

        // Complete write 2
        if (resolveSecond) resolveSecond();
        await p2;
        assert.deepStrictEqual(executionOrder, ['start:1', 'start:2', 'end:2']);
    } finally {
        SessionStore.updateSession = origUpdateSession;
    }
});

// 8. Fixed-clock session log & debug/raw precedence & missing fields formatting
test('C4-8: session-log formatting matches exact sections, debug/raw precedence, and missing fields', () => {
    const origToISOString = Date.prototype.toISOString;
    Date.prototype.toISOString = () => '2026-10-05T12:00:00.000Z';

    try {
        // Test empty/default options
        const emptyLog = buildSessionLogText();
        assert.ok(emptyLog.includes('Gemini Exporter Session Log (Error Report)'));
        assert.ok(emptyLog.includes('Summary: Landed 0/0 chats, Assets 0/0, Skipped 0'));
        assert.ok(emptyLog.includes('Failed Chats: 0, Failed Assets: 0'));
        assert.strictEqual(emptyLog, [
            '=======================================================',
            ' Gemini Exporter Session Log (Error Report)',
            ' Time: 2026-10-05T12:00:00.000Z',
            ' Summary: Landed 0/0 chats, Assets 0/0, Skipped 0',
            ' Failed Chats: 0, Failed Assets: 0',
            '=======================================================', '', ''
        ].join('\n'));

        // Test comprehensive formatting
        const longDebugStr = 'x'.repeat(900);
        const longRawStr = 'y'.repeat(500);
        const suppressedRawStr = 'z'.repeat(500);

        const fullLog = buildSessionLogText({
            landedChats: 5,
            totalChats: 8,
            downloadedAssets: 10,
            totalAssets: 12,
            skipped: 2,
            isDevMode: true,
            failedChats: [
                'plain_chat_string',
                {
                    id: 'chat_with_both_debug_and_raw',
                    title: 'Title Debug Beats Raw',
                    error: 'Error 1',
                    debug: { payload: longDebugStr },
                    raw: { payload: suppressedRawStr }
                },
                {
                    id: 'chat_raw_only',
                    title: 'Title Raw Only',
                    error: 'Error 2',
                    raw: { payload: longRawStr }
                },
                {
                    chatId: 'legacy_chat',
                    chatTitle: 'Legacy Title',
                    reason: 'Legacy Reason'
                },
                {}
            ],
            failedAttachments: [
                {
                    chatTitle: 'Chat Attach 1',
                    file: 'img.png',
                    error: '404'
                },
                {
                    chat: 'Chat Attach Legacy',
                    file: 'file.bin',
                    reason: 'EIO'
                },
                {}
            ],
            parseDrift: [
                {
                    id: 'drift_1',
                    title: 'Drift Title',
                    turnsRejected: 2,
                    hasHeuristicDocs: true,
                    schemaDrift: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6_excess']
                },
                {}
            ]
        });

        // Verify Dev Mode title
        assert.ok(fullLog.includes('Gemini Exporter Session Log (Dev Mode)'));
        assert.ok(fullLog.includes('Summary: Landed 5/8 chats, Assets 10/12, Skipped 2'));
        assert.ok(fullLog.includes('Failed Chats: 5, Failed Assets: 3'));

        // Failed conversations assertions
        assert.ok(fullLog.includes('  - plain_chat_string\n'));
        assert.ok(fullLog.includes('  - chat_with_both_debug_and_raw | "Title Debug Beats Raw" | Error 1\n'));
        // Debug precedence: debug must be printed (truncated to 800 chars), raw_preview must NOT appear for this chat
        assert.ok(fullLog.includes('    [debug] {"payload":"' + 'x'.repeat(788)));
        assert.ok(!fullLog.includes('[raw_preview] {"payload":"zzzz'));

        // Raw only: raw_preview printed (truncated to 400 chars)
        assert.ok(fullLog.includes('  - chat_raw_only | "Title Raw Only" | Error 2\n'));
        assert.ok(fullLog.includes('    [raw_preview] {"payload":"' + 'y'.repeat(388)));

        // Legacy fields
        assert.ok(fullLog.includes('  - legacy_chat | "Legacy Title" | Legacy Reason\n'));
        // Empty object failed chat
        assert.ok(fullLog.includes('  - unknown | "" | unknown\n'));

        // Failed attachments assertions
        assert.ok(fullLog.includes('  - Chat: "Chat Attach 1" | File: "img.png" | Reason: 404\n'));
        assert.ok(fullLog.includes('  - Chat: "Chat Attach Legacy" | File: "file.bin" | Reason: EIO\n'));
        assert.ok(fullLog.includes('  - Chat: "undefined" | File: "undefined" | Reason: undefined\n'));

        // Parse drift assertions
        assert.ok(fullLog.includes('  - drift_1 | "Drift Title" | turnsRejected=2, heuristicDocs\n'));
        assert.ok(fullLog.includes('    [drift] d1\n'));
        assert.ok(fullLog.includes('    [drift] d5\n'));
        assert.ok(!fullLog.includes('    [drift] d6_excess\n'), 'schemaDrift must be sliced to 5');
        assert.ok(fullLog.includes('  - unknown | "" | schema drift\n'));
        assert.strictEqual(fullLog, [
            '=======================================================',
            ' Gemini Exporter Session Log (Dev Mode)',
            ' Time: 2026-10-05T12:00:00.000Z',
            ' Summary: Landed 5/8 chats, Assets 10/12, Skipped 2',
            ' Failed Chats: 5, Failed Assets: 3',
            '=======================================================', '',
            '[FAILED CONVERSATIONS]',
            '  - plain_chat_string',
            '  - chat_with_both_debug_and_raw | "Title Debug Beats Raw" | Error 1',
            '    [debug] {"payload":"' + 'x'.repeat(788),
            '  - chat_raw_only | "Title Raw Only" | Error 2',
            '    [raw_preview] {"payload":"' + 'y'.repeat(388),
            '  - legacy_chat | "Legacy Title" | Legacy Reason',
            '  - unknown | "" | unknown', '',
            '[FAILED ASSETS / ATTACHMENTS]',
            '  - Chat: "Chat Attach 1" | File: "img.png" | Reason: 404',
            '  - Chat: "Chat Attach Legacy" | File: "file.bin" | Reason: EIO',
            '  - Chat: "undefined" | File: "undefined" | Reason: undefined', '',
            '[PARSE DRIFT / PARTIAL SESSIONS]',
            '  - drift_1 | "Drift Title" | turnsRejected=2, heuristicDocs',
            '    [drift] d1', '    [drift] d2', '    [drift] d3',
            '    [drift] d4', '    [drift] d5',
            '  - unknown | "" | schema drift', '', ''
        ].join('\n'));
    } finally {
        Date.prototype.toISOString = origToISOString;
    }
});

// 9. Fixed-clock writeIndexAndMeta markdown & JSON output
test('C4-9: writeIndexAndMeta matches exact index table escaping and meta.json structure', async () => {
    const origToISOString = Date.prototype.toISOString;
    const origToLocaleString = Date.prototype.toLocaleString;
    Date.prototype.toISOString = () => '2026-10-05T12:00:00.000Z';
    Date.prototype.toLocaleString = () => '10/5/2026, 12:00:00 PM';

    try {
        const writer = createMemoryWriter();

        await writeIndexAndMeta(
            [
                {
                    title: 'Title | With [Special] \\ Chars',
                    exportFile: 'export_01.md',
                    messageCount: 10,
                    attachmentCount: 3,
                    url: 'https://gemini.google.com/app/test1'
                },
                {}
            ],
            2,
            3,
            4,
            writer
        );

        assert.deepStrictEqual(writer.writeHistory, ['00_INDEX.md', 'meta.json']);

        const indexMd = writer.files['00_INDEX.md'];
        assert.ok(indexMd.includes('| **[Title \\| With \\[Special\\] \\\\ Chars](export_01.md)** | 10 | 3 | [🔗 Link](https://gemini.google.com/app/test1) | `export_01.md` |\n'));
        assert.ok(indexMd.includes('| **[](undefined)** | undefined | undefined | [🔗 Link](undefined) | `undefined` |\n'));
        assert.ok(indexMd.includes('_Generated by Gemini Exporter at 2026-10-05T12:00:00.000Z_'));

        assert.strictEqual(writer.files['meta.json'], JSON.stringify({
            exportedAt: '2026-10-05T12:00:00.000Z',
            version: SessionRecovery.getExtensionVersion(),
            total: 2,
            conversations: [{
                title: 'Title | With [Special] \\ Chars',
                exportFile: 'export_01.md',
                messageCount: 10,
                attachmentCount: 3,
                url: 'https://gemini.google.com/app/test1'
            }, {}]
        }, null, 2));
    } finally {
        Date.prototype.toISOString = origToISOString;
        Date.prototype.toLocaleString = origToLocaleString;
    }
});

// 10. SessionRecovery module export parity
test('C4-10: SessionRecovery default and named exports expose exact module contract', () => {
    assert.strictEqual(typeof SessionRecovery.writeIndexAndMeta, 'function');
    assert.strictEqual(typeof SessionRecovery.writeDiagnostics, 'function');
    assert.strictEqual(typeof SessionRecovery.buildSessionLogText, 'function');
    assert.strictEqual(typeof SessionRecovery.finalizeChatExport, 'function');
    assert.strictEqual(typeof SessionRecovery.updateSessionStatus, 'function');
    assert.strictEqual(typeof SessionRecovery.getExtensionVersion, 'function');
    assert.strictEqual(SessionRecovery.finalizeChatExport, finalizeChatExport);
    assert.strictEqual(SessionRecovery.updateSessionStatus, updateSessionStatus);
});

test('C4-11: bare and wrapped records retain identity and metadata in both maps and callbacks', async () => {
    for (const wrapped of [false, true]) {
        const record: StoredExportRecord = { status: 'ok', custom: { retained: true } };
        const update = { title: 'RPC title', titleSource: 'rpc', messageCount: 3 };
        const curIds: StoredExportRecordMap = {};
        const exportedIds: StoredExportRecordMap = {};
        let callbacks = 0;
        const entry = wrapped ? { exportRecord: record, conversationUpdate: update } : record;
        const context: FinalizeChatExportContext = {
            chatRecordsMap: new Map([['abc', entry]]), curIds, exportedIds,
            Storage: {
                finalizeConversationExport: async (slot, id, received, options) => {
                    assert.strictEqual(slot, 'u0');
                    assert.strictEqual(id, 'c_abc');
                    assert.strictEqual(received, record);
                    assert.strictEqual(options?.conversationUpdate, wrapped ? update : undefined);
                    options?.onItemExported?.('c_abc', received);
                    return { ok: true, record: received };
                }
            },
            onItemExported: (id, received) => {
                callbacks++;
                assert.strictEqual(id, 'c_abc');
                assert.strictEqual(received, record);
                assert.deepStrictEqual(curIds, {});
            }
        };
        assert.strictEqual(await finalizeChatExport('c_abc', context), true);
        assert.strictEqual(curIds.abc, record);
        assert.strictEqual(exportedIds.abc, record);
        assert.strictEqual(callbacks, 1);
    }
});

test('C4-12: disappearing fallback retains rejection and releases the finalize claim', async () => {
    let reads = 0;
    const claimed = new Set<string>();
    const adapter: FinalizeChatExportContext['storageAdapter'] = {
        get saveExportRecord() {
            reads++;
            return reads === 1 ? async () => ({}) : undefined;
        }
    };
    await assert.rejects(finalizeChatExport('abc', {
        finalizedChatsSet: claimed,
        chatRecordsMap: new Map([['abc', { status: 'ok' }]]),
        storageAdapter: adapter
    }), TypeError);
    assert.strictEqual(claimed.has('abc'), false);
});

test('C4-13: diagnostics and index stop on the first rejected write', async () => {
    const failure = new Error('write rejected');
    for (const failedFile of ['_export_dev.log', '_export_errors.json', '_export_session_dev.json']) {
        const writes: string[] = [];
        let reports = 0;
        await assert.rejects(writeDiagnostics(true, { failedChats: ['abc'] }, 'LOG', {
            writeFile: async file => {
                writes.push(file);
                if (file === failedFile) throw failure;
                return file;
            }
        }, () => { reports++; }), error => error === failure);
        const order = ['_export_dev.log', '_export_errors.json', '_export_session_dev.json'];
        assert.deepStrictEqual(writes, order.slice(0, order.indexOf(failedFile) + 1));
        assert.strictEqual(reports, 0);
    }
    const writes: string[] = [];
    await assert.rejects(writeIndexAndMeta([{}], 1, 0, 0, {
        writeFile: async file => { writes.push(file); throw failure; }
    }), error => error === failure);
    assert.deepStrictEqual(writes, ['00_INDEX.md']);
});

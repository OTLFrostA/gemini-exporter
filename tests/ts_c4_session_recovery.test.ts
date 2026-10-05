export {};
const test = require('node:test');
const assert = require('node:assert');
const {
    writeIndexAndMeta,
    writeDiagnostics,
    buildSessionLogText,
    finalizeChatExport,
    updateSessionStatus,
    SessionRecovery
} = require('../src/core/engine/export/sessionRecovery.js');
const { SessionStore } = require('../src/core/storage/sessionStore.js');

function createMockWriter() {
    const files: Record<string, string> = {};
    return {
        files,
        writeFile: async (filePath: string, content: string) => {
            files[filePath] = content;
            return filePath;
        }
    };
}

// 1. finalize only once
test('C4-1: finalize only once - concurrent or repeated calls are deduplicated', async () => {
    const finalizedChatsSet = new Set<string>();
    const chatRecordsMap = new Map<string, any>([
        ['chat_once', {
            title: 'Only Once Chat',
            status: 'ok',
            messageCount: 3,
            exportedAt: '2026-10-05T12:00:00.000Z'
        }]
    ]);

    let callbackCount = 0;
    let persistCount = 0;
    const mockAdapter = {
        saveExportRecord: async () => {
            persistCount++;
        }
    };

    const context = {
        finalizedChatsSet,
        chatRecordsMap,
        storageAdapter: mockAdapter,
        slot: 'u0',
        onItemExported: () => {
            callbackCount++;
        }
    };

    // First call succeeds
    const first = await finalizeChatExport('c_chat_once', context);
    assert.strictEqual(first, true);
    assert.strictEqual(persistCount, 1);
    assert.strictEqual(callbackCount, 1);
    assert.ok(finalizedChatsSet.has('chat_once'));

    // Second call with same normalized id is deduped
    const second = await finalizeChatExport('chat_once', context);
    assert.strictEqual(second, false);
    assert.strictEqual(persistCount, 1, 'Storage must not be called a second time');
    assert.strictEqual(callbackCount, 1, 'Callback must not be called a second time');

    // Third call with c_ prefix is also deduped
    const third = await finalizeChatExport('c_chat_once', context);
    assert.strictEqual(third, false);
    assert.strictEqual(persistCount, 1);
    assert.strictEqual(callbackCount, 1);
});

// 2. claim released after failed write
test('C4-2: claim released after failed write - allows subsequent retry', async () => {
    const finalizedChatsSet = new Set<string>();
    const chatRecordsMap = new Map<string, any>([
        ['chat_fail', {
            title: 'Retry Chat',
            status: 'ok',
            exportedAt: '2026-10-05T12:00:00.000Z'
        }]
    ]);

    let shouldFail = true;
    let persistAttempts = 0;
    const mockAdapter = {
        saveExportRecord: async () => {
            persistAttempts++;
            if (shouldFail) {
                throw new Error('Disk write failed');
            }
        }
    };

    const context = {
        finalizedChatsSet,
        chatRecordsMap,
        storageAdapter: mockAdapter,
        slot: 'u0'
    };

    // First attempt fails
    await assert.rejects(
        () => finalizeChatExport('c_chat_fail', context),
        /Disk write failed/
    );
    assert.strictEqual(persistAttempts, 1);
    assert.strictEqual(finalizedChatsSet.has('chat_fail'), false, 'Claim must be removed from set on write failure');

    // Second attempt succeeds after fixing failure condition
    shouldFail = false;
    const retry = await finalizeChatExport('c_chat_fail', context);
    assert.strictEqual(retry, true);
    assert.strictEqual(persistAttempts, 2);
    assert.strictEqual(finalizedChatsSet.has('chat_fail'), true, 'Claim must be retained after successful write');
});

// 3. finalizeConversationExport preferred when available
test('C4-3: finalizeConversationExport preferred when available over saveExportRecord', async () => {
    let finalizeCalls = 0;
    let saveRecordCalls = 0;
    let passedOptions: any = null;

    const mockAdapter = {
        finalizeConversationExport: async (_slot: any, _id: any, _rec: any, options: any) => {
            finalizeCalls++;
            passedOptions = options;
        },
        saveExportRecord: async () => {
            saveRecordCalls++;
        }
    };

    const chatRecordsMap = new Map<string, any>([
        ['chat_pref', {
            title: 'Preferred Method Chat',
            status: 'ok',
            exportedAt: '2026-10-05T12:00:00.000Z',
            conversationUpdate: { title: 'Updated Title', titleSource: 'rpc' }
        }]
    ]);

    let callbackInvoked = false;
    const ok = await finalizeChatExport('c_chat_pref', {
        chatRecordsMap,
        storageAdapter: mockAdapter,
        slot: 'u1',
        onItemExported: () => {
            callbackInvoked = true;
        }
    });

    assert.strictEqual(ok, true);
    assert.strictEqual(finalizeCalls, 1, 'finalizeConversationExport must be invoked');
    assert.strictEqual(saveRecordCalls, 0, 'saveExportRecord must NOT be called when finalizeConversationExport is present');
    assert.ok(passedOptions);
    assert.strictEqual(passedOptions.conversationUpdate.title, 'Updated Title');
    assert.strictEqual(typeof passedOptions.onItemExported, 'function');
});

// 4. saveExportRecord fallback
test('C4-4: saveExportRecord fallback when finalizeConversationExport is missing', async () => {
    let saveRecordCalls = 0;
    let savedSlot: any = null;
    let savedId: any = null;
    let savedRec: any = null;

    const mockAdapter = {
        saveExportRecord: async (slot: any, id: any, rec: any) => {
            saveRecordCalls++;
            savedSlot = slot;
            savedId = id;
            savedRec = rec;
        }
    };

    const chatRecordsMap = new Map<string, any>([
        ['chat_fb', {
            title: 'Fallback Chat',
            status: 'ok',
            messageCount: 5,
            exportedAt: '2026-10-05T12:00:00.000Z'
        }]
    ]);

    let callbackRec: any = null;
    const ok = await finalizeChatExport('c_chat_fb', {
        chatRecordsMap,
        storageAdapter: mockAdapter,
        slot: 'u2',
        onItemExported: (_id: string, record: any) => {
            callbackRec = record;
        }
    });

    assert.strictEqual(ok, true);
    assert.strictEqual(saveRecordCalls, 1);
    assert.strictEqual(savedSlot, 'u2');
    assert.strictEqual(savedId, 'c_chat_fb');
    assert.strictEqual(savedRec.title, 'Fallback Chat');
    assert.strictEqual(callbackRec.title, 'Fallback Chat');
});

// 5. failed assets -> partial record
test('C4-5: failed assets -> partial record and hasFailedAssets flag', async () => {
    // Case A: ok status gets upgraded to partial
    const chatFailedAssetsSet = new Set<string>(['asset_fail_1']);
    const chatRecordsMap = new Map<string, any>([
        ['asset_fail_1', {
            title: 'Asset Failure Chat',
            status: 'ok',
            hasFailedAssets: false,
            exportedAt: '2026-10-05T12:00:00.000Z'
        }],
        ['asset_fail_empty', {
            title: 'Empty Asset Failure Chat',
            status: 'empty',
            hasFailedAssets: false,
            exportedAt: '2026-10-05T12:00:00.000Z'
        }],
        ['asset_fail_failed', {
            title: 'Failed Asset Failure Chat',
            status: 'failed',
            hasFailedAssets: false,
            exportedAt: '2026-10-05T12:00:00.000Z'
        }]
    ]);

    let persistedRec: any = null;
    const mockAdapter = {
        saveExportRecord: async (_slot: any, _id: any, rec: any) => {
            persistedRec = rec;
        }
    };

    // Test Case A: ok -> partial
    await finalizeChatExport('c_asset_fail_1', {
        chatRecordsMap,
        chatFailedAssetsSet,
        storageAdapter: mockAdapter
    });
    assert.strictEqual(persistedRec.status, 'partial', 'ok status must become partial when assets fail');
    assert.strictEqual(persistedRec.hasFailedAssets, true);

    // Test Case B: empty preserves empty status
    chatFailedAssetsSet.add('asset_fail_empty');
    await finalizeChatExport('c_asset_fail_empty', {
        chatRecordsMap,
        chatFailedAssetsSet,
        storageAdapter: mockAdapter
    });
    assert.strictEqual(persistedRec.status, 'empty', 'empty status must be preserved');
    assert.strictEqual(persistedRec.hasFailedAssets, true);

    // Test Case C: failed preserves failed status
    chatFailedAssetsSet.add('asset_fail_failed');
    await finalizeChatExport('c_asset_fail_failed', {
        chatRecordsMap,
        chatFailedAssetsSet,
        storageAdapter: mockAdapter
    });
    assert.strictEqual(persistedRec.status, 'failed', 'failed status must be preserved');
    assert.strictEqual(persistedRec.hasFailedAssets, true);
});

// 6. curIds/exportedIds updated
test('C4-6: curIds and exportedIds maps updated on successful finalization', async () => {
    const curIds: Record<string, any> = {};
    const exportedIds: Record<string, any> = {};
    const chatRecordsMap = new Map<string, any>([
        ['map_update_chat', {
            title: 'Map Update Chat',
            status: 'ok',
            messageCount: 7,
            exportedAt: '2026-10-05T12:00:00.000Z'
        }]
    ]);

    const mockAdapter = {
        saveExportRecord: async () => {}
    };

    const ok = await finalizeChatExport('c_map_update_chat', {
        chatRecordsMap,
        curIds,
        exportedIds,
        storageAdapter: mockAdapter
    });

    assert.strictEqual(ok, true);
    assert.ok(curIds['map_update_chat'], 'curIds must be populated with normalized id');
    assert.strictEqual(curIds['map_update_chat'].title, 'Map Update Chat');
    assert.ok(exportedIds['map_update_chat'], 'exportedIds must be populated with normalized id');
    assert.strictEqual(exportedIds['map_update_chat'].title, 'Map Update Chat');
});

// 7. callback called once and callback errors do not abort
test('C4-7: onItemExported callback called once, and callback errors do not abort finalization', async () => {
    let callCount = 0;
    const chatRecordsMap = new Map<string, any>([
        ['cb_err_chat', {
            title: 'Callback Error Chat',
            status: 'ok',
            exportedAt: '2026-10-05T12:00:00.000Z'
        }]
    ]);

    const mockAdapter = {
        saveExportRecord: async () => {}
    };

    const ok = await finalizeChatExport('c_cb_err_chat', {
        chatRecordsMap,
        storageAdapter: mockAdapter,
        onItemExported: () => {
            callCount++;
            throw new Error('Callback boom');
        }
    });

    assert.strictEqual(ok, true, 'Callback throwing must not abort fallback finalization');
    assert.strictEqual(callCount, 1, 'Callback must be called once');
});

// 8. writeDiagnostics fail-closed behavior
test('C4-8: writeDiagnostics fail-closed behavior - throws on missing or failing writer', async () => {
    // Missing writer throws
    await assert.rejects(
        () => writeDiagnostics(false, {}, 'log text', null),
        /IExportWriter is required/
    );

    await assert.rejects(
        () => writeDiagnostics(false, {}, 'log text', {} as any),
        /IExportWriter is required/
    );

    // Failing writer rethrows
    const failingWriter = {
        writeFile: async () => {
            throw new Error('IO error during diagnostics write');
        }
    };
    await assert.rejects(
        () => writeDiagnostics(false, {}, 'log text', failingWriter as any),
        /IO error during diagnostics write/
    );

    // writeIndexAndMeta also fail-closed
    await assert.rejects(
        () => writeIndexAndMeta([{ title: 't' }], 1, 0, 0, null),
        /IExportWriter is required/
    );
    await assert.rejects(
        () => writeIndexAndMeta([{ title: 't' }], 1, 0, 0, failingWriter as any),
        /IO error during diagnostics write/
    );

    // Successful writeDiagnostics outputs appropriate files
    const writer = createMockWriter();
    const logs: string[] = [];
    await writeDiagnostics(
        true,
        {
            failedChats: ['c1'],
            failedAttachments: [{ chatId: 'c1', file: 'a.png' }],
            parseDrift: [{ id: 'c1', turnsRejected: 1 }]
        },
        'FULL LOG',
        writer,
        (msg: string) => logs.push(msg)
    );

    assert.ok(writer.files['_export_dev.log'], '_export_dev.log must be written');
    assert.strictEqual(writer.files['_export_dev.log'], 'FULL LOG');
    assert.ok(writer.files['_export_errors.json'], '_export_errors.json must be written when errors exist');
    assert.ok(writer.files['_export_session_dev.json'], '_export_session_dev.json must be written in devMode');
    assert.strictEqual(logs.length, 1);
});

// 9. session update queue survives rejection
test('C4-9: session update queue survives rejection without wedging subsequent writes', async () => {
    const origUpdateSession = SessionStore.updateSession;
    let callIndex = 0;
    const receivedPatches: any[] = [];

    SessionStore.updateSession = async (patch: any) => {
        callIndex++;
        if (callIndex === 1) {
            throw new Error('First update rejected');
        }
        receivedPatches.push(patch);
    };

    try {
        // First update fails
        await assert.rejects(
            () => updateSessionStatus({ status: 'running', current: 1 }),
            /First update rejected/
        );

        // Second update succeeds and is not blocked by previous rejection
        await updateSessionStatus({ status: 'completed', current: 2 });
        assert.strictEqual(receivedPatches.length, 1);
        assert.strictEqual(receivedPatches[0].status, 'completed');
        assert.strictEqual(receivedPatches[0].current, 2);
    } finally {
        SessionStore.updateSession = origUpdateSession;
    }
});

// 10. session-log formatting
test('C4-10: session-log formatting matches all required sections and data shapes', () => {
    const logText = buildSessionLogText({
        landedChats: 8,
        totalChats: 10,
        downloadedAssets: 15,
        totalAssets: 20,
        skipped: 1,
        isDevMode: true,
        failedChats: [
            'raw_string_chat_id',
            {
                id: 'chat_detailed',
                title: 'Detailed Title That Is Quite Long And Will Be Safely Processed By Slice Method',
                error: 'HTTP 500 error',
                debug: { trace: 'stacktrace-123' },
                raw: { payload: 'preview-456' }
            },
            {
                chatId: 'legacy_chat_id',
                chatTitle: 'Legacy Title',
                reason: 'Timed out'
            }
        ],
        failedAttachments: [
            {
                chatTitle: 'Chat With Failed Img',
                file: 'photo.jpg',
                error: 'Network 404'
            },
            {
                chat: 'Legacy Asset Chat',
                file: 'data.bin',
                reason: 'Corrupted bytes'
            }
        ],
        parseDrift: [
            {
                id: 'drift_chat_1',
                title: 'Drift Chat Title',
                turnsRejected: 2,
                hasHeuristicDocs: true,
                schemaDrift: ['unknown field x', 'invalid turn shape']
            }
        ]
    });

    // Header & Summary
    assert.ok(logText.includes('Gemini Exporter Session Log (Dev Mode)'));
    assert.ok(logText.includes('Summary: Landed 8/10 chats, Assets 15/20, Skipped 1'));
    assert.ok(logText.includes('Failed Chats: 3, Failed Assets: 2'));

    // Failed Chats Section
    assert.ok(logText.includes('[FAILED CONVERSATIONS]'));
    assert.ok(logText.includes('- raw_string_chat_id'));
    assert.ok(logText.includes('chat_detailed | "Detailed Title That Is Quite Long And Will Be Safely Process" | HTTP 500 error'));
    assert.ok(logText.includes('[debug] {"trace":"stacktrace-123"}'));
    assert.ok(logText.includes('legacy_chat_id | "Legacy Title" | Timed out'));

    // Failed Assets Section
    assert.ok(logText.includes('[FAILED ASSETS / ATTACHMENTS]'));
    assert.ok(logText.includes('Chat: "Chat With Failed Img" | File: "photo.jpg" | Reason: Network 404'));
    assert.ok(logText.includes('Chat: "Legacy Asset Chat" | File: "data.bin" | Reason: Corrupted bytes'));

    // Parse Drift Section
    assert.ok(logText.includes('[PARSE DRIFT / PARTIAL SESSIONS]'));
    assert.ok(logText.includes('drift_chat_1 | "Drift Chat Title" | turnsRejected=2, heuristicDocs'));
    assert.ok(logText.includes('[drift] unknown field x'));
    assert.ok(logText.includes('[drift] invalid turn shape'));

    // Non-dev mode header
    const prodLog = buildSessionLogText({ isDevMode: false });
    assert.ok(prodLog.includes('Gemini Exporter Session Log (Error Report)'));
});

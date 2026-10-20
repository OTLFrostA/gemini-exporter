export {};
const test = require('node:test');
const assert = require('node:assert');
const { resolveConversationExportState, checkIsUpdated } = require('../src/shared/utils/titleUtils.js');
const { buildExportCompletion, computeAuthoritativeTimestamp } = require('../src/core/engine/export/exportCompletion.js');
const { historicalFixture } = require('./helpers/nativeFixture.js');
const { indexFixture } = require('./helpers/indexFixture.js');

test('completion record tracks captured conversation version across successive exports', () => {
    // Unit-level contract only. This deliberately does not mock or claim to run
    // LiveSave, browser events, or export persistence.
    const id = 'continued_chat_test_1';
    const T1 = 1700000000500, T2 = 1700000100800, T3 = 1700000300900;

    const domainAt = (turns: number) => historicalFixture({
        id, title: 'Continued conversation',
        messages: Array.from({ length: turns * 2 }, (_, index) => ({
            role: index % 2 ? 'model' : 'user',
            content: `Turn ${Math.floor(index / 2) + 1} part ${index % 2}`,
        })),
    }).conversation;
    const indexAt = (version: number, count: number) => indexFixture({
        id, title: 'Continued conversation', titleSource: 'rpc',
        updatedAt: version, messageCount: count,
    });
    const completionAt = (turns: number, capturedVersion: number, localExportedAt: number) =>
        buildExportCompletion({
            conversation: domainAt(turns), conversationId: id,
            chatTime: capturedVersion, exportedAt: new Date(localExportedAt).toISOString(),
        }).exportRecord;

    const exportedV1 = completionAt(1, T1, T1 + 500);
    assert.equal(exportedV1.chatTime, T1);
    assert.equal(exportedV1.messageCount, 2);
    assert.equal(exportedV1.status, 'ok');
    assert.equal(resolveConversationExportState(indexAt(T1, 2), exportedV1).state, 'exported_ok');

    const indexV2 = indexAt(T2, 4);
    const beforeExport = resolveConversationExportState(indexV2, exportedV1);
    assert.equal(beforeExport.hasNewerActivity, true);
    assert.equal(beforeExport.badge.kind, 'updated');
    assert.equal(checkIsUpdated(indexV2, exportedV1), true);

    // The second export stores the source capture version, not local file time.
    const exportedV2 = completionAt(2, T2, T2 + 500);
    assert.equal(exportedV2.chatTime, T2);
    assert.equal(exportedV2.messageCount, 4);
    assert.equal(exportedV2.status, 'ok');
    const afterExport = resolveConversationExportState(indexV2, exportedV2);
    assert.equal(afterExport.badge.kind, 'exported_ok');
    assert.equal(afterExport.hasNewerActivity, false);
    assert.equal(checkIsUpdated(indexV2, exportedV2), false);

    // A third source update must invalidate the second export, even if the
    // previous export's local time is later than its captured version.
    const indexV3 = indexAt(T3, 6);
    assert.equal(resolveConversationExportState(indexV3, exportedV2).state, 'updated');
    assert.equal(checkIsUpdated(indexV3, exportedV2), true);

    // Message growth alone also indicates newer activity when source time ties.
    assert.equal(resolveConversationExportState(indexAt(T2, 5), exportedV2).state, 'exported_ok');
});

test('export versions require source updatedAt rather than inferring it from messages', () => {
    // 消息时间属于消息；只有显式的源会话版本可以建立导出基线。
    const chatFromRpc = {
        id: 'rpc_chat',
        title: 'RPC 对话',
        messages: [
            { role: 'user', content: 'q1', timestamp: 1700000001000 },
            { role: 'model', content: 'a1', timestamp: 1700000002000 },
            { role: 'user', content: 'q2', timestamp: 1700000005000 },
            { role: 'model', content: 'a2', timestamp: 1700000006500 }
        ]
    };
    const ts = computeAuthoritativeTimestamp(chatFromRpc);
    assert.strictEqual(ts, undefined, '消息时间不能替代源会话版本');
    assert.strictEqual(computeAuthoritativeTimestamp({ ...chatFromRpc, updatedAt: 1700000006500 }), 1700000006500);
});

test('clock skew robustness: client clock behind Google server clock never falsely triggers updated badge when chatTime matches', () => {
    // 模拟客户端时钟比 Google 服务端时钟慢 10 秒（本地 now 为 T - 10000，而 Google turn 时间戳为 T）
    const GOOGLE_SERVER_TS = 1700000050000;
    const CLIENT_SKEW_NOW = GOOGLE_SERVER_TS - 10000;

    const chat = {
        id: 'skew_chat',
        title: '时钟偏差对话',
        updatedAt: GOOGLE_SERVER_TS,
        messageCount: 4
    };

    const completion = buildExportCompletion({
        conversation: chat,
        conversationId: 'skew_chat',
        exportedAt: new Date(CLIENT_SKEW_NOW).toISOString(), // 客户端本地时间（比服务端慢 10s）
        chatTime: GOOGLE_SERVER_TS
    });

    // 导出的记录 chatTime 权威记录了服务端的 1700000050000
    assert.strictEqual(completion.exportRecord.chatTime, GOOGLE_SERVER_TS);

    // 状态判定：即使 c.updatedAt (服务端) > rec.exportedAt (客户端)，因为 c.updatedAt === rec.chatTime，
    // 依然判定为 exported_ok，绝不误触 updated！
    const state = resolveConversationExportState(chat, completion.exportRecord);
    assert.strictEqual(state.hasNewerActivity, false, '相同 chatTime 下时钟偏差绝不能导致 false positive updated');
    assert.strictEqual(state.badge.kind, 'exported_ok', '徽章必须保持 exported_ok');
    assert.strictEqual(checkIsUpdated(chat, completion.exportRecord), false);
});


export {};
const test = require('node:test');
const assert = require('node:assert');
test('finalizeChatExport: storageAdapter 缺 saveExportRecord 即抛错', async () => {
    const SessionRecovery = require('../src/core/engine/export/sessionRecovery.js');

    const recordsMap = new Map();
    recordsMap.set('abc123', { id: 'abc123', title: 'T' });

    await assert.rejects(
        SessionRecovery.finalizeChatExport('abc123', {
            chatRecordsMap: recordsMap,
            // 只有 set/get 的 mock adapter：旧逻辑会静默走降级分支，新逻辑必须抛错
            storageAdapter: {
                set: async () => {},
                get: async () => ({})
            },
            slot: '10000000-0000-4000-8000-000000000001'
        } as any),
        /adapter must implement finalizeConversationExport or saveExportRecord/,
        '缺少必要接口的 adapter 必须抛错，不得静默降级'
    );
});

test('finalizeChatExport: 正式路径 saveExportRecord 照常工作', async () => {
    const SessionRecovery = require('../src/core/engine/export/sessionRecovery.js');

    const recordsMap = new Map();
    recordsMap.set('abc123', { id: 'abc123', title: 'T' });
    let saved: any = null;

    const ok = await SessionRecovery.finalizeChatExport('abc123', {
        chatRecordsMap: recordsMap,
        storageAdapter: {
            saveExportRecord: async (slot: string, id: string, rec: any) => {
                saved = { slot, id, rec };
            }
        },
        slot: '10000000-0000-4000-8000-000000000001'
    } as any);

    assert.strictEqual(ok, true);
    assert.ok(saved, '应经 saveExportRecord 保存');
    assert.strictEqual(saved.slot, '10000000-0000-4000-8000-000000000001');
    assert.strictEqual(saved.id, 'abc123');
});

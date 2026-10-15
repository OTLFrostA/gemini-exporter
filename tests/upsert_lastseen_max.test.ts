import { indexFixture } from './helpers/indexFixture.js';
/**
 * upsert lastSeen 单调性回归测试。
 *
 * 契约（与 mergeUtils.mergeConversation 的 bestLastSeen 一致）：
 *   1. incoming 携带陈旧 lastSeen（takeoutHtmlParser 会从活动时间 seed）时，
 *      不得把已有记录的 lastSeen 往回调；
 *   2. incoming 更 新时应推进；
 *   3. 双方都缺失时 seed 当前时间（保留现有"新记录"行为）。
 *
 * 运行: node -r ./tests/ts_register.js --test tests/upsert_lastseen_max.test.ts
 */
export {};
const test = require('node:test');
const assert = require('node:assert');
const SyncEngine = require('../src/content/syncEngine.js');
const { __setModuleOverride, __getModuleOverride } = require('../src/core/utils/moduleOverrides.js');

function mockStorageContext() {
    let savedList: any[] = [];
    const mockStorage = {
        getConversations: async () => ([...savedList]).map(indexFixture),
        transactConversations: async (_slot: string, updater: any) => {
            const res = updater([...savedList]);
            if (res && res.list) savedList = res.list;
            return { list: savedList, changed: res?.changed || 0, written: !!res };
        },
        setLastSync: async () => {},
        updateAccountSlot: async () => {},
        getScanCheckpoint: async () => null,
        setScanCheckpoint: async () => {}
    };
    (global as any).chrome = { runtime: { sendMessage: () => {} } };
    __setModuleOverride('StorageService', mockStorage);
    return {
        seed: (items: any[]) => { savedList = items.map(indexFixture); },
        find: (id: string) => savedList.find((c: any) => c.id === id),
    };
}

test('local observation time never enters an existing or new index', async () => {
    for (const previous of [[], [{ id: 'chat1', title: 'Research', updatedAt: 1000, lastSeen: 'old' }]]) {
        const ctx = mockStorageContext(); ctx.seed(previous);
        await SyncEngine.upsertConversations([{ id: 'chat1', title: 'Research', updatedAt: 900, lastSeen: '2099-01-01' }], 'page-sync', true, 'u0');
        const index = ctx.find('chat1');
        assert.equal(index.updatedAt, previous.length ? 1000 : 900);
        assert.equal('lastSeen' in index, false);
        assert.equal('timestamp' in index, false);
    }
});
test('an observation without authored time stays undated', async () => {
    const ctx = mockStorageContext(); ctx.seed([]);
    await SyncEngine.upsertConversations([{ id: 'chat1', title: 'Research' }], 'page-sync', true, 'u0');
    assert.equal(ctx.find('chat1').updatedAt, undefined);
    assert.equal(ctx.find('chat1').createdAt, undefined);
});

/**
 * touch 实时置顶回归测试（#403 后续修复）。
 *
 * 契约：
 *   1. 用户在旧会话里发消息（stream-complete）→ 该会话必须立刻排到列表顶部；
 *   2. 但 timestamp/updatedAt 保持服务端权威，touch 不得写客户端时钟；
 *   3. 排序用的展示热度（lastActiveAt）不得污染 getEffectiveTimestamp
 *     （水位线 / 导出新鲜度只认服务端时间戳）。
 *
 * 运行: node -r ./tests/ts_register.js --test tests/touch_active_bump.test.ts
 */
export {};
const test = require('node:test');
const assert = require('node:assert');
const SyncEngine = require('../src/content/syncEngine.js');
const { compareConversations, getEffectiveTimestamp } = require('../src/core/utils/titleUtils.js');
const { mergeConversation } = require('../src/core/utils/mergeUtils.js');
const { __setModuleOverride } = require('../src/core/utils/moduleOverrides.js');

function mockStorageContext() {
    let savedList: any[] = [];
    const mockStorage = {
        getConversations: async () => [...savedList],
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
        seed: (items: any[]) => { savedList = items.map(c => ({ ...c })); },
        getSavedList: () => savedList,
        find: (id: string) => savedList.find((c: any) => c.id === id),
    };
}

test('touch 让旧会话立刻置顶，但服务端时间戳保持不动', async () => {
    const ctx = mockStorageContext();
    ctx.seed([
        { id: 'newer', title: 'Newer', timestamp: 2000, updatedAt: 2000, createdAt: 1500, sidebarIndex: 1, url: 'https://gemini.google.com/app/newer' },
        { id: 'older', title: 'Older', timestamp: 1000, updatedAt: 1000, createdAt: 800, sidebarIndex: 5, url: 'https://gemini.google.com/app/older' },
    ]);

    const before = Date.now();
    await SyncEngine.touchActiveConversation('older', 'u0', { source: 'stream-complete' });
    const after = Date.now();

    const older = ctx.find('older');
    // 1. 服务端权威不受 touch 影响
    assert.strictEqual(older.timestamp, 1000, 'touch 不得改写 timestamp');
    assert.strictEqual(older.updatedAt, 1000, 'touch 不得改写 updatedAt');
    // 2. 展示热度被记录
    assert.ok(
        typeof older.lastActiveAt === 'number' && older.lastActiveAt >= before && older.lastActiveAt <= after,
        'touch 应记录客户端观察到的活跃时间 lastActiveAt'
    );
    // 3. 水位线 / 导出新鲜度语义不受影响
    assert.strictEqual(getEffectiveTimestamp(older), 1000, 'getEffectiveTimestamp 仍只认服务端时间戳');
    // 4. 排序：被 touch 的旧会话排到第一
    const sorted = [...ctx.getSavedList()].sort(compareConversations);
    assert.strictEqual(sorted[0].id, 'older', '被活跃交互的旧会话必须置顶');
    assert.strictEqual(sorted[1].id, 'newer');
});

test('merge 对 lastActiveAt 取最大单调，不回退', () => {
    const old = { id: 'c1', title: 'T', timestamp: 1000, updatedAt: 1000, lastActiveAt: 5000 };
    const incoming = { id: 'c1', sidebarIndex: 0, lastActiveAt: 3000 }; // 更旧的观察，不得回退
    const res = mergeConversation(old, incoming, { source: 'stream-complete' });
    assert.strictEqual(res.merged.lastActiveAt, 5000, 'lastActiveAt 不得被更旧的观察回退');
    assert.strictEqual(res.merged.timestamp, 1000, 'timestamp 不受影响');

    const res2 = mergeConversation(old, { id: 'c1', sidebarIndex: 0, lastActiveAt: 9000 }, { source: 'stream-complete' });
    assert.strictEqual(res2.merged.lastActiveAt, 9000, '更新的观察应推进 lastActiveAt');
    assert.strictEqual(res2.isChanged, true, 'lastActiveAt 推进必须计入 isChanged，否则落不了盘');
});

/**
 * P1-3 回归测试：conversationsStore.clearExported 必须走
 * removeExportRecords(slot, allIds) 事务性删除路径，禁止用
 * setExportedIds(s, {}) 整 map 裸写清零 —— 裸写与并发的 saveExportRecord
 * 写入存在"清记录+写记录"竞态丢失窗口。
 *
 * 运行: node -r ./tests/ts_register.js --test tests/clear_exported_race.test.ts
 */
export {};
const test = require('node:test');
const assert = require('node:assert');

const ConversationsStore = require('../src/ui/state/conversationsStore.js');
const { __setModuleOverride } = require('../src/core/utils/moduleOverrides.js');

function makeMockStorage(initial: Record<string, any>) {
    const state: Record<string, any> = { ...initial };
    const calls: any[][] = [];
    const storage: any = {
        calls,
        getExportedIds: async (_slot: string) => ({ ...state }),
        // 模拟生产 removeExportRecords 的关键语义：只删传入名单里的 id，
        // 写链内重读，名单外的并发写入不受影响。
        removeExportRecords: async (slot: string, ids: string[] | null | undefined) => {
            calls.push(['removeExportRecords', slot, ids]);
            let removed = 0;
            for (const id of ids || []) {
                if (id in state) { delete state[id]; removed++; }
            }
            return removed;
        },
        get state() { return state; },
    };
    return storage;
}

test('P1-3: clearExported 走 removeExportRecords(slot, allIds)，不用裸写', async () => {
    ConversationsStore.setCurrentSlot('u0');
    const storage = makeMockStorage({ a: { id: 'a' }, b: { id: 'b' } });
    __setModuleOverride('StorageService', storage);
    try {
        await ConversationsStore.clearExported('u0');

        const dels = storage.calls.filter((c: any[]) => c[0] === 'removeExportRecords');
        assert.strictEqual(dels.length, 1, '应恰好调用一次 removeExportRecords');
        assert.strictEqual(dels[0][1], 'u0');
        assert.deepStrictEqual(new Set(dels[0][2]), new Set(['a', 'b']),
            '应传入当前全部导出 id');

        // 裸写原语在 mock 上根本不存在：若 clearExported 仍走旧路径会直接抛错
        assert.strictEqual(storage.setExportedIds, undefined,
            'storage mock 不应提供 setExportedIds');

        assert.deepStrictEqual(storage.state, {}, 'storage 侧 map 应被清空');
        assert.deepStrictEqual(ConversationsStore.getExportedIds(), {},
            '内存 map 应同步清空');
    } finally {
        __setModuleOverride('StorageService', undefined as any);
    }
});

test('P1-3: 并发 clear + write 不丢失新记录', async () => {
    ConversationsStore.setCurrentSlot('u0');
    const storage = makeMockStorage({ a: { id: 'a' } });
    const origRemove = storage.removeExportRecords;
    storage.removeExportRecords = async (slot: string, ids: string[] | null | undefined) => {
        // 模拟一次在 clear 读名单之后、删执行之前落盘的并发写入
        storage.state['c'] = { id: 'c' };
        return origRemove(slot, ids);
    };
    __setModuleOverride('StorageService', storage);
    try {
        await ConversationsStore.clearExported('u0');
        assert.ok(!('a' in storage.state), '名单内的旧记录应被删除');
        assert.ok('c' in storage.state, '并发写入的新记录不得丢失（旧裸写会整 map 覆盖丢掉它）');
    } finally {
        __setModuleOverride('StorageService', undefined as any);
    }
});

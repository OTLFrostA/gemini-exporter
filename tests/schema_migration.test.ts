/**
 * Phase D 规格测试 —— 存储迁移框架 (P1-10 / P1-13)
 * red-by-design: 修复前失败（schemaMigration 模块不存在）、修复后通过。
 *
 * 运行：node -r ./tests/ts_register.js --test tests/schema_migration.test.ts
 */
export {};
const test = require('node:test');
const assert = require('node:assert');

const StorageService = require('../src/core/storage/storageService.js');
const SchemaMigration = require('../src/core/storage/schemaMigration.js');
const DetailStore = require('../src/core/storage/conversationDetailStore.js');

function makeChromeMock() {
    const localStore: Record<string, any> = {};
    const sessionStore: Record<string, any> = {};
    const badgeCalls: any[] = [];
    const area = (store: Record<string, any>) => ({
        get: async (keys: any) => {
            if (keys === null || keys === undefined) return { ...store };
            if (typeof keys === 'string') keys = [keys];
            const res: Record<string, any> = {};
            for (const k of (keys || [])) {
                if (k in store) res[k] = store[k];
            }
            return res;
        },
        set: async (obj: any) => { Object.assign(store, obj); },
        remove: async (keys: any) => {
            if (typeof keys === 'string') keys = [keys];
            for (const k of (keys || [])) delete store[k];
        }
    });
    return {
        localStore, sessionStore, badgeCalls,
        chrome: {
            storage: { local: area(localStore), session: area(sessionStore) },
            action: {
                setBadgeText: async (o: any) => { badgeCalls.push({ type: 'text', ...o }); },
                setBadgeBackgroundColor: async (o: any) => { badgeCalls.push({ type: 'color', ...o }); }
            }
        }
    };
}

function installMock() {
    const m = makeChromeMock();
    const origChrome = (global as any).chrome;
    (global as any).chrome = m.chrome;
    SchemaMigration.__setSchemaFrozenForTest(false);
    DetailStore.__clearMemoryStore();
    return { ...m, restore() { (global as any).chrome = origChrome; SchemaMigration.__setSchemaFrozenForTest(false); } };
}

// ---------------------------------------------------------------- P1-13: 版本戳
test('P1-13a: 全新安装 migrate() 串行跑四步并戳 version=1', async () => {
    const m = installMock();
    try {
        const res = await SchemaMigration.migrate();
        assert.deepStrictEqual(res, { ok: true, frozen: false });
        assert.strictEqual(m.localStore['gemini_schema_version'], 1, '首版 current=1');
        assert.strictEqual(SchemaMigration.isSchemaFrozen(), false);
    } finally { m.restore(); }
});

test('P1-13b: version=1 时 migrate() 为空操作', async () => {
    const m = installMock();
    try {
        m.localStore['gemini_schema_version'] = 1;
        m.localStore['gemini_conversations'] = [{ id: 'a', title: 'A', timestamp: 1 }];
        const res = await SchemaMigration.migrate();
        assert.deepStrictEqual(res, { ok: true, frozen: false });
        assert.strictEqual(m.localStore['gemini_conversations'][0].title, 'A');
    } finally { m.restore(); }
});

// ---------------------------------------------------------------- P1-10: slim 迁移锁内重读
test('P1-10a: 遗留胖会话在启动迁移中被 slim 并 offload 到 IDB', async () => {
    const m = installMock();
    try {
        // 直接写裸存储，模拟“版本框架之前”的遗留胖数据（setConversations 会当场 slim，不能用它播种）
        m.localStore['gemini_conversations'] = [
            { id: 'fat1', title: 'Fat', messages: [{ id: 'm1', role: 'user' }], timestamp: 1 }
        ];
        const res = await SchemaMigration.migrate();
        assert.strictEqual(res.ok, true);
        const list = m.localStore['gemini_conversations'];
        assert.ok(!Array.isArray((list[0] as any).messages), '读回的列表应已 slim');
        const mem = DetailStore.__getMemoryStore();
        assert.ok(mem.has('fat1'), 'messages 应 offload 到 detail store');
    } finally { m.restore(); }
});

test('P1-10b: 并发迁移 + transact 不丢数据（锁内重读回归）', async () => {
    const m = installMock();
    try {
        m.localStore['gemini_conversations'] = [
            { id: 'fat1', title: 'Fat', messages: [{ id: 'm1', role: 'user' }], timestamp: 1 }
        ];
        const [migRes] = await Promise.all([
            SchemaMigration.migrate(),
            StorageService.transactConversations('u0', (list: any[]) => ({
                list: [...list, { id: 'new1', title: 'New', timestamp: 2 }],
                changed: 1
            }))
        ]);
        assert.strictEqual(migRes.ok, true);
        const ids = (m.localStore['gemini_conversations'] as any[]).map((c: any) => c.id).sort();
        assert.deepStrictEqual(ids, ['fat1', 'new1'], '并发写入不得丢失任何一方');
        assert.ok(!(m.localStore['gemini_conversations'] as any[]).some((c: any) => Array.isArray(c.messages)), '最终应 slim');
    } finally { m.restore(); }
});

test('P1-10c: 读路径不再触发迁移写（getConversations 纯读）', async () => {
    const m = installMock();
    try {
        m.localStore['gemini_conversations'] = [
            { id: 'fat1', title: 'Fat', messages: [{ id: 'm1' }], timestamp: 1 }
        ];
        const src = require('fs').readFileSync(require('path').join(__dirname, '../src/core/storage/storageService.ts'), 'utf8');
        assert.ok(!src.includes('_migrateLegacyConversations'), 'fire-and-forget 迁移函数应已删除');
        const list = await StorageService.getConversations('u0');
        assert.strictEqual(list.length, 1);
        // 读路径不写：裸存储仍是胖数据（迁移只在 migrate() 跑）
        assert.ok(Array.isArray((m.localStore['gemini_conversations'] as any[])[0].messages), '读路径不得写回 slim 结果');
    } finally { m.restore(); }
});

// ---------------------------------------------------------------- P1-13: 别名 / 凭证迁移
test('P1-13c: 导出记录别名在迁移中收敛', async () => {
    const m = installMock();
    try {
        m.localStore['exportedIds'] = {
            'c_abc': { status: 'ok', alias: true },
            'abc': { status: 'ok', canonical: true }
        };
        await SchemaMigration.migrate();
        const map = m.localStore['exportedIds'];
        assert.ok(!('c_abc' in map), '别名键应被收敛');
        assert.ok('abc' in map, '规范键保留');
    } finally { m.restore(); }
});

test('P1-13d: 遗留单凭证在迁移中并入 map', async () => {
    const m = installMock();
    try {
        m.sessionStore['gemini_credentials'] = { sid: 's1', at: 'at1', bl: 'bl1' };
        await SchemaMigration.migrate();
        const map = m.sessionStore['gemini_credentials_map'];
        assert.ok(map && map['s1'], '单凭证应并入 map');
        assert.strictEqual(map['s1'].at, 'at1');
    } finally { m.restore(); }
});

// ---------------------------------------------------------------- P1-13: 未知版本冻结
test('P1-13e: 未知未来版本 → migrate 返回 frozen，读可用、写被拦、badge 告警', async () => {
    const m = installMock();
    try {
        m.localStore['gemini_schema_version'] = 999;
        m.localStore['gemini_conversations'] = [{ id: 'a', title: 'A', timestamp: 1 }];
        const res = await SchemaMigration.migrate();
        assert.deepStrictEqual(res, { ok: false, frozen: true });
        assert.strictEqual(SchemaMigration.isSchemaFrozen(), true);
        // 读路径保持可用
        const list = await StorageService.getConversations('u0');
        assert.strictEqual(list.length, 1, '冻结时读路径必须可用');
        // 写路径 fail-closed：抛用户可见 i18n 错误
        await assert.rejects(
            SchemaMigration.assertSchemaWritable(),
            (e: any) => {
                assert.ok(e instanceof Error);
                assert.ok(e.message && e.message.length > 0 && e.message !== 'schemaFrozenWriteBlocked', '错误信息应为 i18n 文案而非 key');
                return true;
            }
        );
        // badge 警告
        assert.ok(m.badgeCalls.some((c: any) => c.type === 'text' && c.text === '!'), '应设置 badge 告警');
    } finally { m.restore(); }
});

test('P1-13f: 未冻结时 assertSchemaWritable() 为空操作', async () => {
    const m = installMock();
    try {
        await SchemaMigration.assertSchemaWritable(); // 不抛
    } finally { m.restore(); }
});

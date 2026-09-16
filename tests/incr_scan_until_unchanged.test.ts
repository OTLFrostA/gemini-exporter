/**
 * 增量同步纯语义回归测试 —— "连续扫描直到有 5 个时间戳没变的"。
 *
 * 还原后的契约：
 *   1. resolveListSyncMode 不再做基线预判（条数 proxy 已删除）、不再给增量设
 *      小页数上限：增量默认 maxPages = 2000（与全量同一上限，纯防死循环）。
 *   2. 攒了一大批新对话时，增量必须连续翻页、直到命中 5 连击才停 —— 不能在
 *      旧的 2 页处截断（"150 个新对话只找回 100 个"）。
 *   3. 无基线（新安装/本地为空）时，所有条目都判"有变化"，扫描自然走到服务
 *      端尽头才停 —— 等价于一次全量，不需要基线检查。
 *
 * 运行: node -r ./tests/ts_register.js --test tests/incr_scan_until_unchanged.test.ts
 */
export {};
const test = require('node:test');
const assert = require('node:assert');
const { mergeConversation } = require('../src/core/utils/mergeUtils.js');
const Pagination = require('../src/core/api/client/pagination.js');
const { resolveListSyncMode } = require('../src/content/syncEngine.js');

const NOW = 1757980000000;

function listItem(id: string, tsMs: number, title: string) {
    return {
        id,
        title,
        titleSource: 'rpc',
        titles: { rpc: title },
        createdAt: tsMs - 86400000,
        updatedAt: tsMs,
        chatTime: tsMs,
        timestamp: tsMs,
        messageCount: 3,
        url: `https://gemini.google.com/app/${id}`,
    };
}

// ---- 1. 模式决策：纯语义，无基线预判、无小页数上限 ----

test('resolveListSyncMode: 默认与 forceIncremental 都是增量，上限 2000（不再 2 页截断）', () => {
    for (const opts of [undefined, {}, { forceIncremental: true } as any]) {
        const r = resolveListSyncMode(opts);
        assert.strictEqual(r.useIncremental, true);
        assert.strictEqual(r.maxPages, 2000);
    }
});

test('resolveListSyncMode: forceFull 切全量，上限同样 2000', () => {
    const r = resolveListSyncMode({ forceFull: true });
    assert.strictEqual(r.useIncremental, false);
    assert.strictEqual(r.maxPages, 2000);
});

test('resolveListSyncMode: 显式 maxPages 仍然生效', () => {
    const r = resolveListSyncMode({ maxPages: 7 });
    assert.strictEqual(r.maxPages, 7);
    assert.strictEqual(r.useIncremental, true);
});

// ---- 2. 行为证明：150 个新对话跨过旧 2 页边界，直到 5 连击才停 ----

function storedFixtures(count: number): any[] {
    const stored: any[] = [];
    for (let i = 0; i < count; i++) {
        const ts = NOW - (i + 200) * 3600000;
        const r = mergeConversation(null, listItem(`old${i}`, ts, `Old ${i}`), {
            // 必须是 'batchexecute'（列表扫描）：该源盖 'scan' 戳，是 5 连击唯一认可
            // 的出身。'network-list'（嗅探）现在盖 'sniff' 戳——时间戳值相同但不能
            // 证明尾巴被扫过，用它构造"已扫描"基线会掩盖新安装静默截断 bug。
            source: 'batchexecute',
            isRpcSource: true,
        });
        stored.push(r.merged);
    }
    return stored;
}

test('增量连续翻页：150 条新对话（3 页）全部找回，第 4 页 5 连击早退', async () => {
    const stored = storedFixtures(40);
    const existingMap = new Map(stored.map((c: any) => [c.id, c]));

    // 3 页 × 50 条全新对话（旧 2 页上限下只能找回 100 条）。
    const pages: any[][] = [];
    for (let p = 0; p < 3; p++) {
        const page: any[] = [];
        for (let k = 0; k < 50; k++) {
            const idx = p * 50 + k;
            page.push(listItem(`new${idx}`, NOW - idx * 60000, `New ${idx}`));
        }
        pages.push(page);
    }
    // 第 4 页：5 条未变化（与 existingMap 时间戳一致）→ 在第 5 条处早退。
    const page4 = stored.slice(0, 10).map((s: any) => listItem(s.id, s.timestamp, s.title));
    pages.push(page4);

    let calls = 0;
    const client: any = {
        aborted: false,
        getConversationList: async () => {
            const page = pages[Math.min(calls, pages.length - 1)];
            const hasMore = calls < pages.length - 1;
            calls++;
            return { conversations: page, nextPageToken: hasMore ? `tok${calls}` : null };
        },
    };

    const savedIds = new Set<string>();
    let earlyExitProg: any = null;
    const res: any = await Pagination.getAllConversations(client, {
        maxPages: 2000, // 还原后的增量上限
        existingMap,
        incremental: true,
        unchangedThreshold: 5,
        onProgress: (prog: any) => {
            if (prog.batch && prog.batch.length) {
                for (const c of prog.batch) savedIds.add(c.id);
            }
            if (prog.stoppedEarly) earlyExitProg = prog;
        },
    });

    // 关键断言：翻了 4 页（跨过旧 2 页边界），而不是在第 2 页截断。
    assert.strictEqual(calls, 4, `应连续扫描到第 4 页 5 连击才停，实际只扫了 ${calls} 页`);
    assert.ok(earlyExitProg, '应在第 4 页触发增量早退');
    // 150 条新对话全部经由 batch 交付（#387 早退页带 batch 的保证）。
    for (let i = 0; i < 150; i++) {
        assert.ok(savedIds.has(`new${i}`), `new${i} 必须被找回并落盘`);
    }
    assert.strictEqual(res.stoppedEarly, true);
});

// ---- 3. 无基线：自然扫到服务端尽头，等价于全量 ----

test('无基线（本地为空）：全部判有变化，扫到服务端尽头自然结束', async () => {
    const existingMap = new Map();
    const pages: any[][] = [];
    for (let p = 0; p < 3; p++) {
        const page: any[] = [];
        for (let k = 0; k < 50; k++) {
            const idx = p * 50 + k;
            page.push(listItem(`c${idx}`, NOW - idx * 60000, `Chat ${idx}`));
        }
        pages.push(page);
    }
    let calls = 0;
    const client: any = {
        aborted: false,
        getConversationList: async () => {
            const page = pages[Math.min(calls, pages.length - 1)];
            const hasMore = calls < pages.length - 1;
            calls++;
            return { conversations: page, nextPageToken: hasMore ? `tok${calls}` : null };
        },
    };
    const savedIds = new Set<string>();
    const res: any = await Pagination.getAllConversations(client, {
        maxPages: 2000,
        existingMap,
        incremental: true,
        unchangedThreshold: 5,
        onProgress: (prog: any) => {
            if (prog.batch && prog.batch.length) {
                for (const c of prog.batch) savedIds.add(c.id);
            }
        },
    });
    assert.strictEqual(calls, 3, '无 5 连击时应扫完全部 3 页');
    assert.strictEqual(savedIds.size, 150, '150 条应全部交付');
    assert.strictEqual(res.stoppedEarly, undefined, '自然结束不应标记 stoppedEarly');
});

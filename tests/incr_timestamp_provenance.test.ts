/**
 * 时间戳出身（timestamp provenance）回归测试。
 *
 * 背景：增量 5 连击的有效性依赖"没变 ⟹ 之前扫过"。嗅探（hook 抓到的页面
 * 自身列表响应）会给最新一页带上有效时间戳，打破这个蕴含——新安装打开
 * Gemini → 嗅探第一页 → 点增量 → 首屏 5 连击即早退 → 旧会话静默截断。
 *
 * 契约：
 *   1. 戳跟着值的变化走：incoming 严格更新（cUpdated > oldUpdated）时按
 *      写入方重盖（'batchexecute'→'scan'，'network-list'→'sniff'）；同值重
 *      观察是 upgrade-only：只有扫描写入方（'batchexecute'）能把同值的
 *      'sniff'/'unknown' 提升为 'scan'（证明本轮扫描实际覆盖了该条目），
 *      嗅探写入方永远不得把 'scan' 降级；更旧的重观察保留旧戳。
 *      （这能工作是因为增量早退只看扫描开始前的快照：本轮晋升的戳不
 *      参与本轮 5 连击，从下一轮开始生效。）
 *   2. updatedAt 本身严格单调（merge 已有 Math.max），旧值写不进去。
 *   3. 增量早退只计数 timestampSource === 'scan' 的记录；缺字段视为非 scan。
 *
 * 运行: node -r ./tests/ts_register.js --test tests/incr_timestamp_provenance.test.ts
 */
export {};
const test = require('node:test');
const assert = require('node:assert');
const { mergeConversation } = require('../src/core/utils/mergeUtils.js');
const Pagination = require('../src/core/api/client/pagination.js');

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

// ---- 1. 盖戳：插入时按写入方 ----

test('插入：network-list 盖 sniff，batchexecute 盖 scan', () => {
    const sniffed: any = mergeConversation(null, listItem('a', 1000, 'A'), { source: 'network-list' });
    assert.strictEqual(sniffed.merged.timestampSource, 'sniff');
    const scanned: any = mergeConversation(null, listItem('b', 1000, 'B'), { source: 'batchexecute' });
    assert.strictEqual(scanned.merged.timestampSource, 'scan');
});

test('插入：其他源（detail/DOM）不盖戳', () => {
    const r: any = mergeConversation(null, listItem('c', 1000, 'C'), { source: 'page-sync' });
    assert.strictEqual(r.merged.timestampSource, undefined);
});

// ---- 2. 戳跟着值走：同值不动，严格新值才翻 ----

test('同值 sniff 重写 scan 记录：值不变、戳不动（防降级）', () => {
    const scanned: any = mergeConversation(null, listItem('c', 1000, 'C'), { source: 'batchexecute' }).merged;
    assert.strictEqual(scanned.timestampSource, 'scan');
    // 页面重载又嗅到同一页：值相同，戳必须保持 scan
    const again: any = mergeConversation(scanned, listItem('c', 1000, 'C'), { source: 'network-list' });
    assert.strictEqual(again.merged.timestamp, 1000);
    assert.strictEqual(again.merged.timestampSource, 'scan');
});

test('同值 scan 重写 sniff 记录：值不变、戳提升为 scan', () => {
    const sniffed: any = mergeConversation(null, listItem('c', 1000, 'C'), { source: 'network-list' }).merged;
    assert.strictEqual(sniffed.timestampSource, 'sniff');
    // 主动扫描看到相同时间戳：证明扫描实际覆盖了该条目，戳提升为 scan
    const promoted: any = mergeConversation(sniffed, listItem('c', 1000, 'C'), { source: 'batchexecute' });
    assert.strictEqual(promoted.merged.timestamp, 1000);
    assert.strictEqual(promoted.merged.timestampSource, 'scan');
});

test('同值 scan 重写无戳老记录：戳提升为 scan', () => {
    const legacy: any = listItem('c', 1000, 'C');
    assert.strictEqual(legacy.timestampSource, undefined);
    const promoted: any = mergeConversation(legacy, listItem('c', 1000, 'C'), { source: 'batchexecute' });
    assert.strictEqual(promoted.merged.timestampSource, 'scan');
});

test('同值 scan 重写 scan 记录：戳保持 scan（幂等）', () => {
    const scanned: any = mergeConversation(null, listItem('c', 1000, 'C'), { source: 'batchexecute' }).merged;
    const again: any = mergeConversation(scanned, listItem('c', 1000, 'C'), { source: 'batchexecute' });
    assert.strictEqual(again.merged.timestamp, 1000);
    assert.strictEqual(again.merged.timestampSource, 'scan');
});

test('同值非扫描写入（page-sync）重写 sniff 记录：戳不动', () => {
    const sniffed: any = mergeConversation(null, listItem('c', 1000, 'C'), { source: 'network-list' }).merged;
    const again: any = mergeConversation(sniffed, listItem('c', 1000, 'C'), { source: 'page-sync' });
    assert.strictEqual(again.merged.timestampSource, 'sniff');
});

test('sniff 带来严格新值：值取新、戳翻成 sniff', () => {
    const scanned: any = mergeConversation(null, listItem('c', 1000, 'C'), { source: 'batchexecute' }).merged;
    const newer: any = mergeConversation(scanned, listItem('c', 2000, 'C'), { source: 'network-list' });
    assert.strictEqual(newer.merged.timestamp, 2000);
    assert.strictEqual(newer.merged.timestampSource, 'sniff');
});

test('更旧的 incoming：值保留 max、戳不动', () => {
    const cur: any = mergeConversation(null, listItem('c', 2000, 'C'), { source: 'network-list' }).merged;
    assert.strictEqual(cur.timestampSource, 'sniff');
    // 扫描的旧批次晚到（V1 < V2）：Math.max 丢弃旧值，戳也不动
    const stale: any = mergeConversation(cur, listItem('c', 1500, 'C'), { source: 'batchexecute' });
    assert.strictEqual(stale.merged.timestamp, 2000);
    assert.strictEqual(stale.merged.timestampSource, 'sniff');
});

// ---- 3. 增量早退只认 scan 戳 ----

function mockClient(pages: any[][]) {
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
    return { client, getCalls: () => calls };
}

test('核心场景：30 条 sniff 记录 + 服务端 60 条 → 不早退，3 页全取', async () => {
    // 本地：新安装打开页面被嗅探到的第一页（值有效、戳 sniff）
    const stored: any[] = [];
    for (let i = 0; i < 30; i++) {
        const ts = NOW - i * 60000;
        stored.push(mergeConversation(null, listItem(`s${i}`, ts, `S ${i}`), { source: 'network-list' }).merged);
    }
    assert.ok(stored.every((c: any) => c.timestampSource === 'sniff'));
    const existingMap = new Map(stored.map((c: any) => [c.id, c]));

    // 服务端：3 页 × 20 条（前 30 条与本地一致，后 30 条全新）
    const pages: any[][] = [];
    for (let p = 0; p < 3; p++) {
        const page: any[] = [];
        for (let k = 0; k < 20; k++) {
            const idx = p * 20 + k;
            page.push(listItem(`s${idx}`, NOW - idx * 60000, `S ${idx}`));
        }
        pages.push(page);
    }
    const { client, getCalls } = mockClient(pages);

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

    assert.strictEqual(getCalls(), 3, 'sniff 戳不参与 5 连击，必须扫完 3 页');
    assert.ok(!res.stoppedEarly, '不应早退');
    for (let i = 0; i < 60; i++) {
        assert.ok(savedIds.has(`s${i}`), `s${i} 必须被找回并交付`);
    }
});

test('稳态：30 条 scan 记录、首屏一致 → 第 1 页 5 连击早退', async () => {
    const stored: any[] = [];
    for (let i = 0; i < 30; i++) {
        const ts = NOW - i * 60000;
        stored.push(mergeConversation(null, listItem(`s${i}`, ts, `S ${i}`), { source: 'batchexecute' }).merged);
    }
    assert.ok(stored.every((c: any) => c.timestampSource === 'scan'));
    const existingMap = new Map(stored.map((c: any) => [c.id, c]));

    const pages: any[][] = [
        stored.slice(0, 30).map((s: any) => listItem(s.id, s.timestamp, s.title)),
        [listItem('older', NOW - 99999999, 'Older')],
    ];
    const { client, getCalls } = mockClient(pages);

    const res: any = await Pagination.getAllConversations(client, {
        maxPages: 2000,
        existingMap,
        incremental: true,
        unchangedThreshold: 5,
        onProgress: () => {},
    });

    assert.strictEqual(getCalls(), 1, '稳态应第 1 页即早退');
    assert.strictEqual(res.stoppedEarly, true);
});

test('无戳老记录：不计数、不早退', () => {
    // 老版本/未知来源的记录：没有 timestampSource 字段
    const stored: any[] = [];
    for (let i = 0; i < 10; i++) {
        const c: any = listItem(`s${i}`, NOW - i * 60000, `S ${i}`);
        delete c.timestampSource;
        stored.push(c);
    }
    const existingMap = new Map(stored.map((c: any) => [c.id, c]));
    const pages: any[][] = [stored.map((s: any) => listItem(s.id, s.timestamp, s.title))];

    let calls = 0;
    let streakSawExit = false;
    const client: any = {
        aborted: false,
        getConversationList: async () => {
            calls++;
            return { conversations: pages[0], nextPageToken: null };
        },
    };
    return Pagination.getAllConversations(client, {
        maxPages: 2000,
        existingMap,
        incremental: true,
        unchangedThreshold: 5,
        onProgress: (prog: any) => {
            if (prog.stoppedEarly) streakSawExit = true;
        },
    }).then((res: any) => {
        assert.strictEqual(calls, 1);
        assert.ok(!streakSawExit && !res.stoppedEarly, '无戳记录不能触发早退');
    });
});

test('两轮闭环：首轮增量不早退且晋升戳，次轮增量首屏早退', async () => {
    // 第 0 步：新安装，嗅探写入第一页（sniff 戳）
    let stored: any[] = [];
    for (let i = 0; i < 30; i++) {
        const ts = NOW - i * 60000;
        stored.push(mergeConversation(null, listItem(`s${i}`, ts, `S ${i}`), { source: 'network-list' }).merged);
    }
    assert.ok(stored.every((c: any) => c.timestampSource === 'sniff'));

    // 第一轮增量：快照全是 sniff → 不早退，扫完 3 页；
    // saveQueue 按 'batchexecute' 把每批写回（模拟真实存储写入）
    const snapshot1 = new Map(stored.map((c: any) => [c.id, c]));
    const pages1: any[][] = [];
    for (let p = 0; p < 3; p++) {
        const page: any[] = [];
        for (let k = 0; k < 20; k++) {
            const idx = p * 20 + k;
            page.push(listItem(`s${idx}`, NOW - idx * 60000, `S ${idx}`));
        }
        pages1.push(page);
    }
    const db = new Map(stored.map((c: any) => [c.id, c]));
    const { client: client1, getCalls: getCalls1 } = mockClient(pages1);
    const res1: any = await Pagination.getAllConversations(client1, {
        maxPages: 2000,
        existingMap: snapshot1,
        incremental: true,
        unchangedThreshold: 5,
        onProgress: (prog: any) => {
            if (prog.batch && prog.batch.length) {
                for (const c of prog.batch) {
                    const prev = db.get(c.id) || null;
                    db.set(c.id, mergeConversation(prev, c, { source: 'batchexecute' }).merged);
                }
            }
        },
    });
    assert.ok(!res1.stoppedEarly, '首轮（sniff 快照）不应早退');
    assert.strictEqual(getCalls1(), 3, '首轮必须扫完 3 页');
    // 首轮写入把 s0..s29 的戳晋升为 scan；新发现的 s30..s59 直接盖 scan
    for (let i = 0; i < 60; i++) {
        assert.strictEqual(db.get(`s${i}`).timestampSource, 'scan', `s${i} 应为 scan 戳`);
    }
    // 快照本身未被本轮写入污染（早退判断用的是扫描开始前的旧快照）
    assert.ok([...snapshot1.values()].every((c: any) => c.timestampSource === 'sniff'));

    // 第二轮增量：快照全是 scan，服务端无变化 → 首屏 5 连击早退
    const snapshot2 = new Map([...db.entries()]);
    const pages2: any[][] = [
        [...db.values()].slice(0, 30).map((s: any) => listItem(s.id, s.timestamp, s.title)),
        [listItem('older', NOW - 99999999, 'Older')],
    ];
    const { client: client2, getCalls: getCalls2 } = mockClient(pages2);
    const res2: any = await Pagination.getAllConversations(client2, {
        maxPages: 2000,
        existingMap: snapshot2,
        incremental: true,
        unchangedThreshold: 5,
        onProgress: () => {},
    });
    assert.strictEqual(getCalls2(), 1, '次轮应第 1 页即早退');
    assert.strictEqual(res2.stoppedEarly, true, '次轮（scan 快照）应早退');
});

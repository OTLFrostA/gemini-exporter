/**
 * 增量同步早退丢页回归测试。
 *
 * Bug: pagination.getAllConversations 的增量早退路径在 5 连击命中后直接 return，
 * 跳过了循环之后带 batch 的 onProgress —— 导致触发早退的那一页里、
 * 排在 5 连击之前的"新增/有变化"会话被检测到却永远写不进存储
 * （下次增量仍判为有变化、再次早退丢弃，标题/时间戳元数据永久 stale）。
 *
 * 修复: 早退时的 onProgress 也带上 batch: res.conversations，
 * 调用方（syncEngine 的 upsert）按正常页处理。
 *
 * 运行: node -r ./tests/ts_register.js --test tests/incr_earlyexit_batch.test.ts
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

test('增量早退时，触发页的新增/变化会话必须经由 batch 交付（否则永久丢页）', async () => {
    // 1. 模拟一次全量同步后的存储：40 条已存会话。
    const stored: any[] = [];
    for (let i = 0; i < 40; i++) {
        const ts = NOW - (i + 10) * 3600000;
        const r = mergeConversation(null, listItem(`conv${i}`, ts, `Title ${i}`), {
            // 'batchexecute' = 列表扫描，盖 'scan' 戳（5 连击唯一认可）；
            // 'network-list'（嗅探）盖 'sniff' 戳，不能计入早退。
            source: 'batchexecute',
            isRpcSource: true,
        });
        stored.push(r.merged);
    }
    const existingMap = new Map(stored.map((c: any) => [c.id, c]));

    // 2. 新一页：顶部 2 条新增（不在 existingMap），随后是未变化的旧会话。
    //    按早退逻辑，第 7 条（第 5 条连续未变化）处触发早退。
    const freshNew = [
        listItem('conv_new1', NOW - 60000, 'New chat 1'),
        listItem('conv_new2', NOW - 120000, 'New chat 2'),
    ];
    const freshOld = stored.map((s: any) => listItem(s.id, s.timestamp, s.title));
    const page1 = [...freshNew, ...freshOld];

    const client: any = {
        aborted: false,
        getConversationList: async () => ({ conversations: page1, nextPageToken: 'tok2' }),
    };

    // 3. 模拟 syncEngine 的消费者：只经由 prog.batch 落盘。
    const savedIds = new Set<string>();
    const progresses: any[] = [];
    const res: any = await Pagination.getAllConversations(
        client,
        {
            maxPages: 2,
            existingMap,
            incremental: true,
            unchangedThreshold: 5,
            onProgress: (prog: any) => {
                progresses.push(prog);
                if (prog.batch && prog.batch.length) {
                    for (const c of prog.batch) savedIds.add(c.id);
                }
            },
        }
    );

    assert.strictEqual(res.stoppedEarly, true, '本用例应触发增量早退');
    assert.match(
        String(res.diagnostics && res.diagnostics.stopReason),
        /增量同步命中连续 5 条已存在历史/
    );
    // 早退前只拉了 1 页（maxPages=2 的上限没跑满，说明早退逻辑本身仍在工作）。
    assert.ok(
        progresses.every((p: any) => p.page <= 1),
        '早退应在第 1 页发生'
    );

    // 核心断言：触发页的 2 条新增会话必须被交付过（修复前这里失败：batch 缺失）。
    assert.ok(savedIds.has('conv_new1'), 'conv_new1 在早退页被丢弃，未经由 batch 交付');
    assert.ok(savedIds.has('conv_new2'), 'conv_new2 在早退页被丢弃，未经由 batch 交付');
});

test('增量早退本身不受影响：无变化时仍在第 1 页停止', async () => {
    const stored: any[] = [];
    for (let i = 0; i < 40; i++) {
        const ts = NOW - (i + 10) * 3600000;
        const r = mergeConversation(null, listItem(`conv${i}`, ts, `Title ${i}`), {
            // 'batchexecute' = 列表扫描，盖 'scan' 戳（5 连击唯一认可）；
            // 'network-list'（嗅探）盖 'sniff' 戳，不能计入早退。
            source: 'batchexecute',
            isRpcSource: true,
        });
        stored.push(r.merged);
    }
    const existingMap = new Map(stored.map((c: any) => [c.id, c]));
    const page1 = stored.map((s: any) => listItem(s.id, s.timestamp, s.title));

    let pages = 0;
    const client: any = {
        aborted: false,
        getConversationList: async () => {
            pages++;
            return { conversations: page1, nextPageToken: 'tok2' };
        },
    };
    const res: any = await Pagination.getAllConversations(client, {
        maxPages: 2,
        existingMap,
        incremental: true,
        unchangedThreshold: 5,
    });
    assert.strictEqual(res.stoppedEarly, true);
    assert.strictEqual(pages, 1, '无变化时早退仍应在第 1 页触发');
});

import { listFixture } from './helpers/listFixture.js';
/** Unverified ordering must never truncate list pagination based on local timestamps. */
export {};
const test = require('node:test');
const assert = require('node:assert');
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

// ---- 2. 无基线：自然扫到服务端尽头，等价于全量 ----

test('无基线（本地为空）：扫到服务端尽头自然结束', async () => {
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
            return listFixture(page, hasMore ? `tok${calls}` : null);
        },
    };
    const savedIds = new Set<string>();
    const res: any = await Pagination.getAllConversations(client, {
        maxPages: 2000,
        incremental: true,
        onProgress: (prog: any) => {
            if (prog.batch && prog.batch.length) {
                for (const c of prog.batch) savedIds.add(c.id);
            }
        },
    });
    assert.strictEqual(calls, 3, '应扫完全部 3 页');
    assert.strictEqual(savedIds.size, 150, '150 条应全部交付');
    assert.strictEqual(res.stoppedEarly, undefined, '自然结束不应标记 stoppedEarly');
    assert.strictEqual(res.exhaustive, true, 'server exhaustion must be explicitly verified');
    assert.strictEqual(res.completionReason, 'natural_exhaustion');
    assert.deepStrictEqual(res.conversations.map((c: any) => c.id), pages.flat().map(c => c.id),
        'the returned list must contain every fetched page without loss or duplication');
});

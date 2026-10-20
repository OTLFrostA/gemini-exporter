/**
 * PR-3 回归测试（核心词表审计 D2，方案 a）：
 * getEffectiveTimestamp 删除 lastSeen fallback。
 *
 * 契约：
 *   1. 只有 lastSeen、无服务端时间戳的会话 → getEffectiveTimestamp 返回 0
 *      （lastSeen 是客户端观察到的时间，可能是 seed，不可当作服务端权威时间）。
 *   2. 未知来源版本不能根据客户端观察时间跳过导出。
 *
 * 运行: node -r ./tests/ts_register.js --test tests/pr3_lastseen_fallback.test.ts
 */
export {};
const test = require('node:test');
const assert = require('node:assert');
const { getEffectiveTimestamp } = require('../src/shared/utils/titleUtils.js');

// Case 1: lastSeen-only 会话返回 0，不再返回 lastSeen。
test('getEffectiveTimestamp: lastSeen-only chat returns 0', () => {
    const chat = { id: 'c_lastseen_only', lastSeen: '2026-09-03T12:00:00.000Z' };
    assert.strictEqual(getEffectiveTimestamp(chat), 0, 'lastSeen must not feed the authoritative timestamp');

    // 数字型 lastSeen 也一样
    assert.strictEqual(getEffectiveTimestamp({ id: 'c2', lastSeen: 1788100000000 }), 0);

    // A newer local observation must not override a known authoritative server timestamp.
    const serverUpdatedAt = 1788000000000;
    assert.strictEqual(getEffectiveTimestamp({
        id: 'c3', updatedAt: serverUpdatedAt, lastSeen: 1788100000000
    }), serverUpdatedAt);
});

// Unknown source versions must remain eligible for export regardless of local observation time.
test('lastSeen-only chats cannot authorize skipping an export with unknown source version', () => {
    const { shouldSkipExport } = require('../src/application/export/runExport.js');
    const record = { exportedAt: 1788000000000, chatTime: 1788000000000, format: 'markdown', status: 'ok' };
    const request = { skipUnchanged: true, format: 'markdown' };
    assert.equal(shouldSkipExport(record, undefined, request), false);
    assert.equal(shouldSkipExport(record, 1788000000000, request), true);
    assert.equal(shouldSkipExport(record, 1788100000000, request), false);
});

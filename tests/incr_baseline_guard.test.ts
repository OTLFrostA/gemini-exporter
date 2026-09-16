/**
 * 增量基线守卫回归测试。
 *
 * Bug: 新安装（本地存储为空）时点击"增量同步"，forceIncremental 会覆盖
 * `beforeList.length > 30` 的基线检查，导致 maxPages=2 静默截断，
 * UI 却上报"增量同步完成" —— 用户有 500 条会话只拿到约 100 条，
 * 剩下的永远不出现（除非自己发现"全量"按钮）。
 *
 * 修复: resolveListSyncMode —— forceIncremental 不得绕过基线检查，
 * 无基线时回退全量（这也是无强制选项时自动路径本来的判定）。
 * 另将实际执行的模式（syncMode）经 messageRouter 带回 UI，
 * 回退时按"全量同步完成"如实上报，不谎报"增量完成"。
 *
 * 运行: node -r ./tests/ts_register.js --test tests/incr_baseline_guard.test.ts
 */
export {};
const test = require('node:test');
const assert = require('node:assert');
const { resolveListSyncMode } = require('../src/content/syncEngine.js');

test('新安装（0 条）+ 强制增量 → 必须回退全量（2000 页），不能截断到 2 页', () => {
    const r = resolveListSyncMode(0, { forceIncremental: true });
    assert.equal(r.useIncremental, false);
    assert.equal(r.maxPages, 2000);
});

test('基线不足（20 条）+ 强制增量 → 回退全量', () => {
    const r = resolveListSyncMode(20, { forceIncremental: true });
    assert.equal(r.useIncremental, false);
    assert.equal(r.maxPages, 2000);
});

test('有基线（31 条）+ 强制增量 → 增量（2 页），原有行为不变', () => {
    const r = resolveListSyncMode(31, { forceIncremental: true });
    assert.equal(r.useIncremental, true);
    assert.equal(r.maxPages, 2);
});

test('有基线（100 条）无强制 → 增量（自动路径不变）', () => {
    const r = resolveListSyncMode(100);
    assert.equal(r.useIncremental, true);
    assert.equal(r.maxPages, 2);
});

test('无基线（0 条）无强制 → 全量（自动路径不变）', () => {
    const r = resolveListSyncMode(0);
    assert.equal(r.useIncremental, false);
    assert.equal(r.maxPages, 2000);
});

test('forceFull 覆盖一切 → 全量', () => {
    const r = resolveListSyncMode(100, { forceFull: true });
    assert.equal(r.useIncremental, false);
    assert.equal(r.maxPages, 2000);
});

test('显式 maxPages 覆盖页数计算', () => {
    const r = resolveListSyncMode(100, { forceIncremental: true, maxPages: 5 });
    assert.equal(r.useIncremental, true);
    assert.equal(r.maxPages, 5);
});

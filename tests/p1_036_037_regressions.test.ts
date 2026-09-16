export {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// P1-036 / P1-037 回归测试（集成阶段补修：此前未分组覆盖）
// P1-036: 429 退避 sleep 与限频 cooldown 等待都不响应 abort，取消最长 30s 无反应
// P1-037: 限频 cooldown 到期后所有 worker 同时惊醒（thundering herd）
// 运行：node -r ./tests/ts_register.js --test tests/p1_036_037_regressions.test.ts

const { RateLimitManager, abortableSleep } = require('../src/core/engine/export/rateLimiter.js');

function readTs(rel: string): string {
    return fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8');
}

// ---------------------------------------------------------------------------
// P1-036: abortableSleep 基础语义
// ---------------------------------------------------------------------------

test('P1-036: abortableSleep 完整等待返回 false，被 abort 中断返回 true', async () => {
    const t0 = Date.now();
    assert.strictEqual(await abortableSleep(80), false, 'uninterrupted sleep resolves false');
    assert.ok(Date.now() - t0 >= 60, 'full delay should elapse');

    const controller = new AbortController();
    const t1 = Date.now();
    const p = abortableSleep(10000, controller.signal);
    setTimeout(() => controller.abort(), 60);
    assert.strictEqual(await p, true, 'aborted sleep resolves true');
    assert.ok(Date.now() - t1 < 2000, `abort must cut the 10s sleep short (took ${Date.now() - t1}ms)`);

    const dead = new AbortController();
    dead.abort();
    assert.strictEqual(await abortableSleep(5000, dead.signal), true, 'pre-aborted signal resolves true immediately');
});

// ---------------------------------------------------------------------------
// P1-036: waitForCooldown 可被取消中断（不再睡满整个冷却窗口）
// ---------------------------------------------------------------------------

test('P1-036: waitForCooldown 在冷却等待中被取消立即返回 false', async () => {
    const manager = new RateLimitManager({ initialDelayMs: 50, maxDelayMs: 200, jitterMs: 0 });
    manager.recordRateLimit(10000); // 10s 冷却
    const controller = new AbortController();
    const t0 = Date.now();
    setTimeout(() => controller.abort(), 120);
    const ok = await manager.waitForCooldown(controller.signal, 0);
    const elapsed = Date.now() - t0;
    assert.strictEqual(ok, false, 'aborted cooldown wait must resolve false');
    assert.ok(elapsed < 2000, `cancel during cooldown must be fast, not 10s (took ${elapsed}ms)`);
});

test('P1-036: waitForCooldown 无取消时正常等待并返回 true', async () => {
    const manager = new RateLimitManager({ initialDelayMs: 50, maxDelayMs: 200, jitterMs: 0 });
    manager.recordRateLimit(150);
    const t0 = Date.now();
    const ok = await manager.waitForCooldown(null, 0);
    const elapsed = Date.now() - t0;
    assert.strictEqual(ok, true, 'uninterrupted cooldown wait resolves true');
    assert.ok(elapsed >= 120, `cooldown window should elapse (took ${elapsed}ms)`);
});

// ---------------------------------------------------------------------------
// P1-037: 冷却到期后 worker 错峰唤醒（thundering herd）
// ---------------------------------------------------------------------------

test('P1-037: 共享冷却到期后并发等待者被错峰唤醒，而非同时惊醒', async () => {
    const mk = () => {
        const m = new RateLimitManager({ initialDelayMs: 50, maxDelayMs: 200, jitterMs: 0 });
        m.recordRateLimit(120);
        return m;
    };
    // staggerMs=0: 对照组，应几乎同时唤醒
    const tight = await Promise.all(
        Array.from({ length: 4 }, () => mk().waitForCooldown(null, 0).then(() => Date.now()))
    );
    const tightSpread = Math.max(...tight) - Math.min(...tight);
    // staggerMs=1500: 实验组，唤醒时间应明显分散
    const t0 = Date.now();
    const spread = await Promise.all(
        Array.from({ length: 6 }, () => mk().waitForCooldown(null, 1500).then(() => Date.now() - t0))
    );
    const wakeSpread = Math.max(...spread) - Math.min(...spread);
    assert.ok(tightSpread < 300, `stagger=0 control should wake together (spread ${tightSpread}ms)`);
    assert.ok(wakeSpread > 200, `staggered wakeups must spread out (spread ${wakeSpread}ms)`);
});

// ---------------------------------------------------------------------------
// 结构锁：调用侧真正使用了可中断等待，死代码分支已删除
// ---------------------------------------------------------------------------

test('P1-036/037 结构锁: chatExporter 429 退避走 abortableSleep，中断后不记失败', () => {
    const src = readTs('core/engine/export/chatExporter.ts');
    assert.ok(src.includes('abortableSleep(delayMs, ctx.abortSignal)'), '429 backoff must be abort-interruptible');
    assert.ok(
        src.includes('if (ctx.isAborted() || (ctx.abortSignal && ctx.abortSignal.aborted)) return;'),
        'aborted-during-backoff must exit without marking the chat failed'
    );
});

test('P1-036/037 结构锁: exportOrchestrator 使用 waitForCooldown 返回值并删除死分支', () => {
    const src = readTs('core/engine/export/exportOrchestrator.ts');
    assert.ok(src.includes('waitForCooldown(abortSignal)'), 'worker loop must pass the abort signal');
    assert.ok(src.includes('if (!cooldownOk) break;'), 'aborted cooldown must stop dispatching');
    assert.ok(!src.includes('this._rateLimitCooldownUntil && Date.now()'), 'dead legacy cooldown branch must be gone');
});

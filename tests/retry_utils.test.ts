import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { calculateBackoff, abortableSleep } from '../src/core/utils/retryUtils.js';
import {
    handleHttp429,
    interruptibleSleep
} from '../src/core/api/client/retryPolicy.js';
import {
    RateLimitManager,
    calculateBackoff as engineCalculateBackoff,
    abortableSleep as engineAbortableSleep
} from '../src/core/engine/export/rateLimiter.js';

const SRC = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// ---------------------------------------------------------------------------
// 1. calculateBackoff: Formula, Exponential Growth, Jitter & Retry-After Cap
// ---------------------------------------------------------------------------

test('retryUtils - calculateBackoff computes deterministic exponential delays when jitter is 0', () => {
    const opts = { initialDelayMs: 1000, maxDelayMs: 20000, jitterMs: 0 };
    assert.strictEqual(calculateBackoff(0, opts), 1000, 'attempt 0 = 1000ms');
    assert.strictEqual(calculateBackoff(1, opts), 2000, 'attempt 1 = 2000ms');
    assert.strictEqual(calculateBackoff(2, opts), 4000, 'attempt 2 = 4000ms');
    assert.strictEqual(calculateBackoff(3, opts), 8000, 'attempt 3 = 8000ms');
    assert.strictEqual(calculateBackoff(4, opts), 16000, 'attempt 4 = 16000ms');
    assert.strictEqual(calculateBackoff(5, opts), 20000, 'attempt 5 capped at maxDelayMs 20000ms');
});

test('retryUtils - calculateBackoff applies jitter within [base, base + jitterMs)', () => {
    const opts = { initialDelayMs: 500, maxDelayMs: 10000, jitterMs: 300 };
    for (let i = 0; i < 20; i++) {
        const delay = calculateBackoff(1, opts); // base = 500 * 2^1 = 1000
        assert.ok(delay >= 1000, `delay ${delay} >= 1000`);
        assert.ok(delay <= 1300, `delay ${delay} <= 1300`);
    }
});

test('retryUtils - calculateBackoff default values match contract (initial 2000, max 30000, jitter 1000)', () => {
    for (let i = 0; i < 10; i++) {
        const d0 = calculateBackoff(0);
        assert.ok(d0 >= 2000 && d0 <= 3000, `attempt 0 in [2000, 3000], got ${d0}`);

        const d10 = calculateBackoff(10);
        assert.strictEqual(d10, 30000, `attempt 10 capped at 30000, got ${d10}`);
    }
});

test('retryUtils - calculateBackoff honors server Retry-After floor even beyond maxDelayMs', () => {
    // When server specifies Retry-After 60s, delay should honor it
    const delayHigh = calculateBackoff(0, { initialDelayMs: 1000, maxDelayMs: 10000, retryAfterMs: 60000, jitterMs: 0 });
    assert.strictEqual(delayHigh, 60000, 'honors retryAfterMs 60000');

    // When server Retry-After is smaller than natural backoff, natural backoff is not lowered
    const delayLow = calculateBackoff(3, { initialDelayMs: 1000, maxDelayMs: 10000, retryAfterMs: 2000, jitterMs: 0 });
    assert.strictEqual(delayLow, 8000, 'does not decrease natural backoff (8000ms)');

    // Non-positive or undefined retryAfterMs is ignored
    const delayZero = calculateBackoff(0, { initialDelayMs: 1000, maxDelayMs: 10000, retryAfterMs: 0, jitterMs: 0 });
    assert.strictEqual(delayZero, 1000, 'zero retryAfterMs ignored');
    const delayNeg = calculateBackoff(0, { initialDelayMs: 1000, maxDelayMs: 10000, retryAfterMs: -500, jitterMs: 0 });
    assert.strictEqual(delayNeg, 1000, 'negative retryAfterMs ignored');
});

// ---------------------------------------------------------------------------
// 2. abortableSleep: Non-positive, No-Signal, Pre-aborted, & Mid-sleep Abort
// ---------------------------------------------------------------------------

test('retryUtils - abortableSleep resolves immediately on non-positive ms', async () => {
    const resZero = await abortableSleep(0);
    assert.strictEqual(resZero, false, 'ms=0 resolves false');

    const resNeg = await abortableSleep(-100);
    assert.strictEqual(resNeg, false, 'ms=-100 resolves false');

    const controller = new AbortController();
    controller.abort();
    const resPreAbortedZero = await abortableSleep(0, controller.signal);
    assert.strictEqual(resPreAbortedZero, true, 'ms=0 with aborted signal resolves true');
});

test('retryUtils - abortableSleep without signal sleeps full duration and resolves false', async (t: TestContext) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
        let done1 = false;
        const p1 = abortableSleep(5000).then((res: boolean) => { done1 = true; return res; });
        assert.strictEqual(done1, false, 'should not resolve before delay');
        t.mock.timers.tick(5000);
        const res1 = await p1;
        assert.strictEqual(res1, false, 'undefined signal resolves false');

        let done2 = false;
        const p2 = abortableSleep(5000, null).then((res: boolean) => { done2 = true; return res; });
        assert.strictEqual(done2, false, 'should not resolve before delay');
        t.mock.timers.tick(5000);
        const res2 = await p2;
        assert.strictEqual(res2, false, 'null signal resolves false');
    } finally {
        t.mock.timers.reset();
    }
});

test('retryUtils - abortableSleep with pre-aborted signal returns true immediately', async () => {
    const controller = new AbortController();
    controller.abort();

    const res = await abortableSleep(5000, controller.signal);
    assert.strictEqual(res, true, 'pre-aborted signal resolves true');
});

test('retryUtils - abortableSleep cuts sleep short when aborted mid-way', async (t: TestContext) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const controller = new AbortController();
        const sleepPromise = abortableSleep(5000, controller.signal);

        t.mock.timers.tick(100);
        controller.abort();

        const res = await sleepPromise;
        assert.strictEqual(res, true, 'aborted sleep resolves true');
    } finally {
        t.mock.timers.reset();
    }
});

test('retryUtils - abortableSleep completes normally when signal never aborts', async (t: TestContext) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const controller = new AbortController();
        const sleepPromise = abortableSleep(5000, controller.signal);
        t.mock.timers.tick(5000);
        const res = await sleepPromise;
        assert.strictEqual(res, false, 'unaborted sleep resolves false');
    } finally {
        t.mock.timers.reset();
    }
});

// ---------------------------------------------------------------------------
// 3. interruptibleSleep (in retryPolicy.ts) & handleHttp429 Integration
// ---------------------------------------------------------------------------

test('retryPolicy - interruptibleSleep delegates to abortableSleep when isAborted is omitted', async (t: TestContext) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const fullPromise = interruptibleSleep(5000);
        t.mock.timers.tick(5000);
        const full = await fullPromise;
        assert.strictEqual(full, false, 'unaborted resolves false');

        const controller = new AbortController();
        const cutPromise = interruptibleSleep(5000, controller.signal);
        t.mock.timers.tick(100);
        controller.abort();
        const cut = await cutPromise;
        assert.strictEqual(cut, true, 'aborted resolves true');
    } finally {
        t.mock.timers.reset();
    }
});

test('retryPolicy - interruptibleSleep polling handles custom isAborted predicate', async (t: TestContext) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
        // 1. Initially aborted
        let abortedFlag = true;
        const resInit = await interruptibleSleep(5000, undefined, () => abortedFlag);
        assert.strictEqual(resInit, true, 'initially aborted returns true');

        // 2. Aborted via polling mid-sleep
        abortedFlag = false;
        const pPoll = interruptibleSleep(5000, undefined, () => abortedFlag);
        t.mock.timers.tick(50);
        abortedFlag = true;
        t.mock.timers.tick(50);
        const resPoll = await pPoll;
        assert.strictEqual(resPoll, true, 'polling aborted returns true');

        // 3. Completes naturally with isAborted staying false
        abortedFlag = false;
        const pNormal = interruptibleSleep(5000, undefined, () => abortedFlag);
        t.mock.timers.tick(5000);
        const resNormal = await pNormal;
        assert.strictEqual(resNormal, false, 'non-aborted predicate resolves false');
    } finally {
        t.mock.timers.reset();
    }
});

test('retryPolicy - handleHttp429 honors Retry-After header and backoff options', async (t: TestContext) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const resPromise = handleHttp429({
            resp: {
                status: 429,
                headers: { get: (h: string) => (h === 'retry-after' ? '1' : null) }
            },
            retryCount: 0,
            maxRetries: 3,
            label: 'test-429'
        });
        t.mock.timers.tick(35000);
        const res = await resPromise;
        assert.strictEqual(res.shouldRetry, true);
        assert.strictEqual(res.nextRetryCount, 1);
        assert.ok(typeof res.delayMs === 'number' && res.delayMs >= 2000, `delayMs >= 2000 (was ${res.delayMs})`);
    } finally {
        t.mock.timers.reset();
    }
});

// ---------------------------------------------------------------------------
// 4. RateLimiter re-exports & Parity
// ---------------------------------------------------------------------------

test('rateLimiter - engine re-exports calculateBackoff and abortableSleep matching retryUtils', () => {
    assert.strictEqual(typeof engineCalculateBackoff, 'function', 'rateLimiter re-exports calculateBackoff');
    assert.strictEqual(typeof engineAbortableSleep, 'function', 'rateLimiter re-exports abortableSleep');

    const val1 = calculateBackoff(2, { initialDelayMs: 500, jitterMs: 0 });
    const val2 = engineCalculateBackoff(2, { initialDelayMs: 500, jitterMs: 0 });
    assert.strictEqual(val1, val2, 'calculateBackoff parity between modules');

    const mgr = new RateLimitManager({ initialDelayMs: 500, maxDelayMs: 5000, jitterMs: 0 });
    assert.strictEqual(mgr.calculateBackoff(2), 2000);
});

// ---------------------------------------------------------------------------
// 5. Architectural Boundary Check: No Inverted Dependencies
// ---------------------------------------------------------------------------

test('architecture - retryPolicy.ts does not import export engine or rateLimiter', () => {
    const src = SRC('src/core/api/client/retryPolicy.ts');
    assert.ok(!/from\s+['"][^'"]*engine/i.test(src), 'retryPolicy must not import from engine');
    assert.ok(!/from\s+['"][^'"]*rateLimiter/i.test(src), 'retryPolicy must not import rateLimiter');
    assert.ok(src.includes('retryUtils'), 'retryPolicy imports from retryUtils');
});

test('architecture - retryUtils.ts does not import engine or api modules', () => {
    const src = SRC('src/core/utils/retryUtils.ts');
    assert.ok(!/from\s+['"][^'"]*engine/i.test(src), 'retryUtils must not import from engine');
    assert.ok(!/from\s+['"][^'"]*api/i.test(src), 'retryUtils must not import from api');
});

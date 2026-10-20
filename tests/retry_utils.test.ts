import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { calculateBackoff, abortableSleep } from '../src/shared/utils/retryUtils.js';
import {
    handleHttp429,
    interruptibleSleep
} from '../src/l1/client/gemini/api/retryPolicy.js';
import {
    RateLimitManager,
    calculateBackoff as engineCalculateBackoff,
    abortableSleep as engineAbortableSleep
} from '../src/l1/client/rateLimiter.js';

const SRC = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

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
    const src = SRC('src/l1/client/gemini/api/retryPolicy.ts');
    assert.ok(!/from\s+['"][^'"]*engine/i.test(src), 'retryPolicy must not import from engine');
    assert.ok(!/from\s+['"][^'"]*rateLimiter/i.test(src), 'retryPolicy must not import rateLimiter');
    assert.ok(src.includes('retryUtils'), 'retryPolicy imports from retryUtils');
});


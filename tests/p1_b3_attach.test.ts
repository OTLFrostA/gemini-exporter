import test from 'node:test';
import assert from 'node:assert/strict';
import { ProgressReporter } from '../src/core/engine/export/progressReporter.js';
import { handleGetImageBlob } from '../src/content/assetFetcher.js';
import { RateLimitManager } from '../src/core/engine/export/rateLimiter.js';

// P1-023: observe reported progress rather than the name of the internal tracker.
test('P1-023: progress percentage never regresses when progress inputs decrease', () => {
    const reported: number[] = [];
    const reporter = new ProgressReporter({ totalChats: 4, onProgress: (p) => reported.push(p.pct) });
    assert.equal(reporter.update(2, 'first'), 50);
    assert.equal(reporter.update(1, 'stale'), 50);
    assert.equal(reporter.update(3, 'later'), 75);
    assert.deepEqual(reported, [50, 50, 75]);
});

// P1-027: a large image may travel as raw bytes, but not through Base64 encoding.
test('P1-027: >50 MiB image succeeds as a buffer and is rejected as Base64', async () => {
    const originalFetch = globalThis.fetch;
    const bytes = new Uint8Array([1, 2, 3]);
    const oversize = {
        size: 51 * 1024 * 1024,
        type: 'image/png',
        arrayBuffer: async () => bytes.buffer,
    };
    globalThis.fetch = (async () => {
        return {
            ok: true, status: 200,
            headers: { get: () => 'image/png' },
            blob: async () => oversize,
        } as unknown as Response;
    }) as typeof fetch;
    try {
        const replies: Array<{ success: boolean; dataBuffer?: ArrayBuffer; error?: string }> = [];
        await handleGetImageBlob(
            { url: 'https://lh3.googleusercontent.com/example', preferBuffer: true },
            (reply) => replies.push(reply)
        );
        assert.equal(replies.length, 1);
        assert.equal(replies[0].success, true);
        assert.deepEqual(new Uint8Array(replies[0].dataBuffer!), bytes);

        replies.length = 0;
        await handleGetImageBlob(
            { url: 'https://lh3.googleusercontent.com/example', preferBuffer: false },
            (reply) => replies.push(reply)
        );
        assert.equal(replies.length, 1);
        assert.equal(replies[0].success, false);
        assert.match(replies[0].error || '', /too large/i);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

// P1-036: ensure an active rate-limit cooldown can be interrupted.
test('P1-036: aborting a cooldown stops waiting and returns false', async () => {
    const limiter = new RateLimitManager();
    limiter.recordRateLimit(5000);
    const controller = new AbortController();
    const result = limiter.waitForCooldown(controller.signal, 0);
    controller.abort();
    assert.equal(await result, false);
});

// P1-037: stagger is an externally observable delay, not a variable-name contract.
test('P1-037: nonzero stagger delays a completed cooldown', async () => {
    const limiter = new RateLimitManager();
    const originalRandom = Math.random;
    Math.random = () => 0.99;
    try {
        limiter.rateLimitCooldownUntil = Date.now() + 5;
        const started = Date.now();
        assert.equal(await limiter.waitForCooldown(null, 50), true);
        assert.ok(Date.now() - started >= 35, 'stagger should add a meaningful delay');
    } finally {
        Math.random = originalRandom;
    }
});

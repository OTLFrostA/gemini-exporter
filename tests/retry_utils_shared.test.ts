import { describe as __suiteDescribe } from 'node:test';
import test from "node:test";
import { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { calculateBackoff } from "../src/shared/utils/retryUtils.js";
import { abortableSleep } from "../src/shared/utils/retryUtils.js";
import { createSemaphore } from "../src/shared/utils/concurrency.js";
import { mapWithConcurrency } from "../src/shared/utils/concurrency.js";
import { buildExportFileName } from "../src/shared/utils/pathUtils.js";
import { sanitizeFileName } from "../src/shared/utils/pathUtils.js";
import { sanitizeRelativePath } from "../src/shared/utils/pathUtils.js";
import { shortId } from "../src/shared/utils/pathUtils.js";
import { shortScope } from "../src/shared/utils/pathUtils.js";

__suiteDescribe("retry_utils_shared", () => {
const SRC = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');


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

// Shared ownership must never import real L1 implementations.
test('architecture - retryUtils.ts does not import engine or api modules', () => {
    const src = SRC('src/shared/utils/retryUtils.ts');
    assert.ok(!/from\s+['"][^'"]*engine/i.test(src), 'retryUtils must not import from engine');
    assert.ok(!/from\s+['"][^'"]*api/i.test(src), 'retryUtils must not import from api');
});

test('concurrency - createSemaphore enforces capacity and cancels queued waiters cleanly without leaking slots', async () => {
    const sem = createSemaphore(2);
    let active = 0;
    let peak = 0;
    const makeGate = () => {
        let release = () => {};
        const promise = new Promise<void>(resolve => { release = resolve; });
        return { promise, release };
    };
    const holdA = makeGate();
    const holdB = makeGate();
    const abortMiddle = new AbortController();

    const taskA = sem.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await holdA.promise;
        active--;
        return 'A';
    });
    const taskB = sem.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await holdB.promise;
        active--;
        return 'B';
    });
    const taskAborted = sem.run(async () => 'never', abortMiddle.signal);
    const taskC = sem.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>(resolve => setImmediate(resolve));
        active--;
        return 'C';
    });

    abortMiddle.abort();
    await assert.rejects(taskAborted, { name: 'AbortError' });
    holdA.release();
    holdB.release();
    assert.deepEqual(await Promise.all([taskA, taskB, taskC]), ['A', 'B', 'C']);
    assert.equal(peak, 2);
});

test('concurrency - mapWithConcurrency bounds parallel workers and preserves deterministic input order', async () => {
    let active = 0;
    let peak = 0;
    const items = [30, 5, 20, 1, 15, 10];
    const results = await mapWithConcurrency(items, 3, async (delay, index) => {
        active++;
        peak = Math.max(peak, active);
        for (let step = 0; step < (delay % 4) + 1; step++) {
            await new Promise<void>(resolve => setImmediate(resolve));
        }
        active--;
        return `${index}:${delay}`;
    });
    assert.equal(peak, 3);
    assert.deepEqual(results, items.map((d, i) => `${i}:${d}`));
});
});

__suiteDescribe("path_utils_unicode", () => {
test('shortId and shortScope extract bounded 6-character identifiers and fall back safely', () => {
    assert.equal(shortId('c_12345678'), '345678');
    assert.equal(shortId('c_abc123xyz'), '123xyz');
    assert.equal(shortId('abcdef'), 'abcdef');
    assert.equal(shortId('c_abcdef'), 'abcdef');
    assert.equal(shortId('abc'), 'abc');
    assert.equal(shortId('12345'), '12345');
    assert.equal(shortId(123456789), '456789');
    for (const empty of [null, undefined, '', '   ']) {
        assert.equal(shortId(empty), 'chat');
        assert.equal(shortScope(empty), '');
    }
    assert.equal(shortScope('c_12345678'), '345678_');
    assert.equal(shortScope('abcdef'), 'abcdef_');
    assert.equal(shortScope('abc'), 'abc_');
    assert.equal(buildExportFileName('My Chat', 'c_12345678', 'md'), 'My Chat_345678.md');
    assert.equal(buildExportFileName('Deep Research', 'c_xyz987', 'json'), 'Deep Research_xyz987.json');
    assert.equal(buildExportFileName(null, null), 'untitled_chat.md');
});

test('export filenames remove Unicode noncharacters from diagnostic titles', () => {
    assert.equal(buildExportFileName('确认Amazon余额充值 \u{5FFFF}', '6ae0497e-40d0-83e8-80f5-544b41748b97'),
        '确认Amazon余额充值_748b97.md');
    for (let codePoint = 0xFDD0; codePoint <= 0xFDEF; codePoint++) {
        assert.equal(sanitizeFileName(`文件${String.fromCodePoint(codePoint)}.md`), '文件.md');
    }
    for (let plane = 0; plane <= 16; plane++) {
        for (const suffix of [0xFFFE, 0xFFFF]) {
            assert.equal(sanitizeFileName(`文件${String.fromCodePoint(plane * 0x10000 + suffix)}.md`), '文件.md');
        }
    }
    assert.equal(sanitizeRelativePath('assets/图\u{5FFFF}片.png'), 'assets/图片.png');
});

test('filename sanitization removes lone surrogates and retains assigned Unicode', () => {
    const valid = '中文😀🧑🏽‍💻é e\u0301\u{31350}\uE000\u{F0000}.md';
    assert.equal(sanitizeFileName(valid), valid);
    assert.equal(sanitizeFileName('中\uD800文\uDC00😀.md'), '中文😀.md');
    assert.equal(sanitizeFileName('\uDBFF😀\uDFFF.md'), '😀.md');
});

test('native macOS EILSEQ titles lose unassigned scalars before filename reservation', () => {
    assert.equal(buildExportFileName('代码依赖可视化\u{4E7D9}', '6ab84970-7684-83e8-b454-0baaa20585e8'),
        '代码依赖可视化_0585e8.md');
    for (const codePoint of [0x378, 0x35000, 0x3E7D9, 0x40000, 0x4E7D9]) {
        assert.equal(sanitizeFileName(`文件${String.fromCodePoint(codePoint)}.md`), '文件.md');
    }
    assert.equal(sanitizeRelativePath('assets/图\u{4E7D9}片.png'), 'assets/图片.png');
    assert.equal(sanitizeFileName('\u{4E7D9}'), 'untitled');
});

test('titles containing only invalid Unicode fall back to a stable export filename', () => {
    assert.equal(sanitizeFileName('\u{5FFFF}\uD800'), 'untitled');
    assert.equal(sanitizeFileName('\uFFFF', 'attachment'), 'attachment');
    assert.equal(buildExportFileName('\u{5FFFF}\uD800', 'c_abcdef'), 'untitled_abcdef.md');
});
});

__suiteDescribe("errors_and_messaging", () => {
const test = require('node:test');
const assert = require('node:assert');

test('errors - active TakeoutParseError extends GeminiError', () => {
    const {
        GeminiError,
        TakeoutParseError
    } = require('../src/shared/types/errors.js');

    const rootErr = new GeminiError('Root error');
    assert.ok(rootErr instanceof Error);
    assert.ok(rootErr instanceof GeminiError);
    assert.strictEqual(rootErr.name, 'GeminiError');
    assert.strictEqual(rootErr.message, 'Root error');

    const takeoutErr = new TakeoutParseError('Structure changed', true, 'MyActivity.html');
    assert.ok(takeoutErr instanceof GeminiError);
    assert.strictEqual(takeoutErr.formatDrift, true);
    assert.strictEqual(takeoutErr.entryName, 'MyActivity.html');
});

test('errors - getErrorMessage safely normalizes all error types', () => {
    const { getErrorMessage } = require('../src/shared/utils/errorText.js');

    assert.strictEqual(getErrorMessage('Simple error string'), 'Simple error string');
    assert.strictEqual(getErrorMessage(new Error('Standard Error object')), 'Standard Error object');
    assert.strictEqual(getErrorMessage({ message: 'Custom object message' }), 'Custom object message');
    assert.strictEqual(getErrorMessage(null), 'Unknown error');
    assert.strictEqual(getErrorMessage(undefined), 'Unknown error');
    assert.strictEqual(getErrorMessage(404), '404');

});
});

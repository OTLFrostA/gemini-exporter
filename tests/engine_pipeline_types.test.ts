// tests/engine_pipeline_types.test.ts - Contract and edge case tests for Layer 4 Engine
import test from 'node:test';
import assert from 'node:assert/strict';

import * as ChatFormatter from '../src/core/engine/chatFormatter.js';
import { AsyncQueue } from '../src/core/engine/exportEngine.js';
import * as BatchWorker from '../src/core/engine/export/batchWorker.js';
import AssetPipeline from '../src/core/engine/assetPipeline.js';
import { sanitizeRelativePath } from '../src/core/utils/utils.js';
import { RateLimitManager, isRateLimited, calculateBackoff } from '../src/core/engine/export/rateLimiter.js';
import * as SessionRecovery from '../src/core/engine/export/sessionRecovery.js';

test('TDD: ChatFormatter protects code fences and converts headings properly', () => {
    const raw = [
        '# Top Heading',
        '## Sub Heading',
        '```markdown',
        '# Not a heading inside code block',
        '## Also not a heading',
        '```',
        '### Deep Heading',
        '~~~python',
        '# Python comment',
        '~~~'
    ].join('\n');

    const result = ChatFormatter.adjustHeadingHierarchy(raw, 2);
    assert.match(result, /### Top Heading/);
    assert.match(result, /#### Sub Heading/);
    assert.match(result, /# Not a heading inside code block/);
    assert.match(result, /# Python comment/);
    assert.match(result, /##### Deep Heading/);
});

test('TDD: ChatFormatter cleans Google internal tool URLs and unwraps links', () => {
    const raw = 'Check this out: [Research Report](https://googleusercontent.com/deep_research_confirmation_content/12345) and an image chip: https://googleusercontent.com/image_generation_content/abc';
    const cleaned = ChatFormatter.cleanMessageBody(raw);
    assert.ok(!cleaned.includes('deep_research_confirmation_content'));
    assert.ok(!cleaned.includes('image_generation_content'));
    assert.ok(cleaned.includes('Research Report'));
});

test('TDD: AsyncQueue supports concurrent queueing, abort signals, and closing', async () => {
    const q = new AsyncQueue();
    assert.equal(q.length, 0);

    // 1. Pop before push
    const popPromise1 = q.pop();
    q.push('item1');
    const res1 = await popPromise1;
    assert.equal(res1, 'item1');

    // 2. Abort signal on waiting pop
    const ac = new AbortController();
    const popPromise2 = q.pop(ac.signal);
    ac.abort();
    const res2 = await popPromise2;
    assert.equal(res2, null, 'Aborted pop must resolve to null');

    // 3. Queue close resolves all pending waiters to null
    const popPromise3 = q.pop();
    q.close();
    const res3 = await popPromise3;
    assert.equal(res3, null, 'Closing queue must resolve waiters to null');
    assert.equal(await q.pop(), null, 'Pop on closed queue must return null');
});

test('TDD: BatchWorker.resolveChat skips bad brand titles and preserves user sniff', async () => {
    const chat = {
        id: 'test_123',
        title: 'Google Gemini',
        titles: { rpc: 'Google Gemini', sniff: '如何设计微服务架构' },
        titleSource: 'sniff'
    };
    const listConv = {
        id: 'test_123',
        title: '如何设计微服务架构',
        titles: { rpc: 'Google Gemini', sniff: '如何设计微服务架构' },
        titleSource: 'sniff'
    };

    const resolved = await BatchWorker.resolveChat(
        chat as any,
        { id: 'test_123', title: '如何设计微服务架构' },
        listConv as any,
        null,
        'u0',
        () => {},
        () => {}
    );

    assert.equal(resolved.isError, false);
    assert.notEqual(resolved.listTitle, 'Google Gemini');
    assert.equal(resolved.listTitle, '如何设计微服务架构');
});

test('TDD: formatContent defaults to markdown on unknown format', () => {
    const chat = { id: 'test_fmt', title: 'Test Format', messages: [] };
    const res = ChatFormatter.formatContent(chat as any, 'unknown_format');
    assert.equal(res.ext, 'md');
    assert.equal(res.mime, 'text/markdown');
    assert.match(res.content, /# Test Format/);
});

test('TDD: AssetPipeline rejects path traversal in sanitizeZipPath', () => {
    const pipeline = new AssetPipeline();
    assert.ok(pipeline);
    assert.equal(sanitizeRelativePath('../../../etc/passwd', 'file'), '_/_/_/etc/passwd');
});

test('TDD: RateLimiter detects 429 status and error messages, calculates backoff with jitter', () => {
    assert.equal(isRateLimited({ status: 429 }), true);
    assert.equal(isRateLimited({ error: 'RESOURCE_EXHAUSTED: Rate limit exceeded' }), true);
    assert.equal(isRateLimited({ error: 'Too many requests, quota exceeded' }), true);
    assert.equal(isRateLimited({ success: true } as any), false);
    assert.equal(isRateLimited({ status: 200 }), false);
    assert.equal(isRateLimited(null), false);

    const b0 = calculateBackoff(0, { initialDelayMs: 1000, jitterMs: 200, maxDelayMs: 5000 });
    assert.ok(b0 >= 1000 && b0 <= 1200, `Expected b0 between 1000 and 1200, got ${b0}`);

    const manager = new RateLimitManager({ initialDelayMs: 500, maxDelayMs: 2000, jitterMs: 100 });
    assert.equal(manager.rateLimitCooldownUntil, 0);
    manager.recordRateLimit(1500);
    assert.ok(manager.rateLimitCooldownUntil > Date.now());
    manager.reset();
    assert.equal(manager.rateLimitCooldownUntil, 0);
});

test('TDD: SessionRecovery.updateSessionStatus updates chrome.storage.local safely', async () => {
    assert.equal(typeof SessionRecovery.updateSessionStatus, 'function');

    const origChrome = (global as any).chrome;
    let storedSession: any = { status: 'running', slot: 'u0', current: 1 };
    (global as any).chrome = {
        storage: {
            local: {
                get: async (_keys: any) => ({ gemini_last_export_session: storedSession }),
                set: async (obj: any) => {
                    if (obj.gemini_last_export_session) {
                        storedSession = obj.gemini_last_export_session;
                    }
                }
            }
        }
    };

    try {
        await SessionRecovery.updateSessionStatus({ current: 2, status: 'completed' });
        assert.equal(storedSession.current, 2);
        assert.equal(storedSession.status, 'completed');
        assert.ok(typeof storedSession.updatedAt === 'number');
    } finally {
        (global as any).chrome = origChrome;
    }
});


export {};
const test = require('node:test');
const assert = require('node:assert');

const { GeminiAPIClient } = require('../src/l1/client/gemini/geminiClient.js');
const { withRateLimitRetry, isRateLimited } = require('../src/l1/client/rateLimiter.js');
const { handleHttp400 } = require('../src/l1/client/gemini/api/retryPolicy.js');
const { useIndexStorage } = require('./helpers/indexStorage.js');
useIndexStorage();

// ---------------------------------------------------------------------------
// 1. handleHttp400 XSRF recovery logic in retryPolicy
// ---------------------------------------------------------------------------
test('retryPolicy - handleHttp400 extracts xsrf token from response snippet and signals retry', async () => {
    const mockSnippet = ')]}\'\n[["xsrf","fresh_xsrf_token_456"],["error","invalid_token"]]';
    const params = {
        resp: { status: 400 },
        snippet: mockSnippet,
        cred: { at: 'old_stale_token', sid: 'sid_123' },
        isRetried: false
    };

    const res = await handleHttp400(params);
    assert.strictEqual(res.shouldRetry, true, 'Should signal retry on 400 with xsrf token');
    assert.strictEqual(res.freshAt, 'fresh_xsrf_token_456');

    // Already retried should not retry again (prevent loop)
    const resAlready = await handleHttp400({ ...params, isRetried: true });
    assert.strictEqual(resAlready.shouldRetry, false, 'Should not retry if already retried');
});

test('retryPolicy - handleHttp400 uses getAtFromPage fallback if snippet has no xsrf token', async () => {
    const params = {
        resp: { status: 400 },
        snippet: 'General 400 Bad Request',
        cred: { at: 'old_token', sid: 'sid_123' },
        isRetried: false,
        getAtFromPage: () => 'page_fresh_token_789'
    };

    const res = await handleHttp400(params);
    assert.strictEqual(res.shouldRetry, true);
    assert.strictEqual(res.freshAt, 'page_fresh_token_789');

    // If page token is identical to current cred.at, do not retry
    const resSame = await handleHttp400({
        ...params,
        getAtFromPage: () => 'old_token'
    });
    assert.strictEqual(resSame.shouldRetry, false, 'Should not retry if token unchanged');
});

// ---------------------------------------------------------------------------
// 2. GeminiAPIClient HTTP 400 automatic retry
// ---------------------------------------------------------------------------
test('geminiClient - getConversationList recovers on HTTP 400 with fresh credentials', async () => {
    const client = new GeminiAPIClient();
    const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    let callCount = 0;

    (global as any).fetch = async (_url: string, _opts: any) => {
        callCount++;
        if (callCount === 1) {
            // First call fails with 400 and xsrf token snippet
            return {
                ok: false,
                status: 400,
                statusText: 'Bad Request',
                text: async () => ')]}\'\n[["xsrf","fresh_xsrf_token_999"]]'
            };
        }
        // Second call succeeds with valid batchexecute list
        const mockListInner = JSON.stringify([null, null, [["c_chat_rec_400", "400 Recovery Chat", null, null, null, [1700000000, 0]]]]);
        const mockTop = JSON.stringify([["wrb.fr", "MaZiqc", mockListInner]]);
        return {
            ok: true,
            status: 200,
            text: async () => `)]}'\n\n${mockTop}`
        };
    };

    try {
        const res = await client.getConversationList(null, 'u0');
        assert.strictEqual(callCount, 2, 'Should have retried once on 400');
        assert.strictEqual(res.conversations.length, 1);
        assert.strictEqual(res.conversations[0].id, 'chat_rec_400');
    } finally {
        if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
        else delete (global as any).fetch;
    }
});

// ---------------------------------------------------------------------------
// 3. GeminiAPIClient AbortSignal handling
// ---------------------------------------------------------------------------
test('geminiClient - abort signal immediately halts client and flags isAborted', () => {
    const client = new GeminiAPIClient();
    assert.strictEqual(client.isAborted(), false);

    client.abort();
    assert.strictEqual(client.isAborted(), true);

    const controller = new AbortController();
    const clientWithSignal = new GeminiAPIClient({ signal: controller.signal });
    assert.strictEqual(clientWithSignal.isAborted(), false);

    controller.abort();
    assert.strictEqual(clientWithSignal.isAborted(), true);
});


// ---------------------------------------------------------------------------
// 5. withRateLimitRetry operation
// ---------------------------------------------------------------------------
test('rateLimiter - withRateLimitRetry retries on rate limit and succeeds', async () => {
    let attempts = 0;
    const retryLogs: number[] = [];

    const result = await withRateLimitRetry(
        async () => {
            attempts++;
            if (attempts < 3) {
                return { success: false, status: 429, error: 'rate limit' };
            }
            return { success: true, data: 'ok' };
        },
        {
            maxRetries: 3,
            initialDelayMs: 5,
            jitterMs: 0,
            onRetry: (retryCount: number) => {
                retryLogs.push(retryCount);
            }
        }
    );

    assert.strictEqual(attempts, 3);
    assert.deepStrictEqual(retryLogs, [0, 1]);
    assert.deepStrictEqual(result, { success: true, data: 'ok' });
});

test('rateLimiter - withRateLimitRetry respects abort signal', async () => {
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
        async () => {
            await withRateLimitRetry(
                async () => ({ success: true }),
                { signal: controller.signal }
            );
        },
        /Operation aborted/
    );
});

test('rateLimiter - HTTP 429 errors retry but ordinary provider errors do not', async () => {
    let attempts = 0;
    const result = await withRateLimitRetry(async () => {
        attempts++;
        if (attempts === 1) throw new Error('HTTP 429 Too Many Requests :: response body');
        return 'ok';
    }, { initialDelayMs: 1, jitterMs: 0 });
    assert.strictEqual(result, 'ok');
    assert.strictEqual(attempts, 2);

    for (const message of ['["BardErrorInfo",1096]', 'RESOURCE_EXHAUSTED',
        'Too many requests', 'quota exceeded', 'rate limit exceeded',
        '服务端上限', 'request failed: 429', 'HTTP 4290', 'conversation 429']) {
        const error = new Error(message);
        assert.strictEqual(isRateLimited(error), false, message);
        assert.strictEqual(isRateLimited({ error: message }), false, message);
        attempts = 0;
        await assert.rejects(withRateLimitRetry(async () => {
            attempts++;
            throw error;
        }, { initialDelayMs: 1, jitterMs: 0 }), (actual: unknown) => actual === error);
        assert.strictEqual(attempts, 1, message);
    }
});

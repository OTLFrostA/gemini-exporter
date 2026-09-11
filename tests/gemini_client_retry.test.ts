export {};
const test = require('node:test');
const assert = require('node:assert');

const { GeminiAPIClient } = require('../src/core/api/geminiClient.js');
const { GeminiResponseParserClass } = require('../src/core/api/geminiParser.js');
const { handleHttp400 } = require('../src/core/api/client/retryPolicy.js');

(global as any).GeminiResponseParserClass = GeminiResponseParserClass;

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
    const origFetch = (global as any).fetch;
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
        const mockListInner = JSON.stringify([null, [["c_chat_rec_400", "400 Recovery Chat", [1700000000, 0], [1700000000, 0], 1]], null]);
        const mockTop = JSON.stringify([["wrb.fr", "MaZiqc", mockListInner]]);
        return {
            ok: true,
            status: 200,
            text: async () => `)]}'\n\n${mockTop}`
        };
    };

    try {
        const res = await client.getConversationList(null, 'test_sid_400');
        assert.strictEqual(callCount, 2, 'Should have retried once on 400');
        assert.strictEqual(res.conversations.length, 1);
        assert.strictEqual(res.conversations[0].id, 'chat_rec_400');
    } finally {
        (global as any).fetch = origFetch;
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
// 4. GeminiAPIClient getAllConversations multi-page pagination
// ---------------------------------------------------------------------------
test('geminiClient - getAllConversations traverses pages until completion', async () => {
    const client = new GeminiAPIClient();
    const origFetch = (global as any).fetch;
    let pageCalls = 0;

    (global as any).fetch = async (_url: string, _opts: any) => {
        pageCalls++;
        let inner: string;
        if (pageCalls === 1) {
            // Page 1 returns chat_1 and valid next token starting with "tC_"
            inner = JSON.stringify([null, [["c_chat_p1", "Chat Page 1", [1700000000, 0], [1700000000, 0], 1]], "tC_page_2_token"]);
        } else {
            // Page 2 returns chat_2 and null next token (terminates)
            inner = JSON.stringify([null, [["c_chat_p2", "Chat Page 2", [1700000000, 0], [1700000000, 0], 1]], null]);
        }
        const mockTop = JSON.stringify([["wrb.fr", "MaZiqc", inner]]);
        return {
            ok: true,
            status: 200,
            text: async () => `)]}'\n\n${mockTop}`
        };
    };

    try {
        const res = await client.getAllConversations();
        assert.strictEqual(pageCalls, 2, 'Should fetch exactly 2 pages');
        assert.strictEqual(res.conversations.length, 2, 'Should accumulate conversations across pages');
        assert.strictEqual(res.conversations[0].id, 'chat_p1');
        assert.strictEqual(res.conversations[1].id, 'chat_p2');
    } finally {
        (global as any).fetch = origFetch;
    }
});

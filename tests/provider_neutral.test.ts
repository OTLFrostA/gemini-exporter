export {};
const test = require('node:test');
const assert = require('node:assert');

const { GeminiProvider } = require('../src/core/provider/gemini/geminiProvider.js');
const { ChatGPTProvider, flattenChatGPTMapping } = require('../src/core/provider/chatgpt/chatgptProvider.js');

function makeGeminiClient() {
    return {
        getAllConversations: async (_opts: any) => ({
            conversations: [{
                id: 'c1', title: 'T1', titleSource: 'api-list', titles: { rpc: 'T1' },
                createdAt: 1, updatedAt: 2, chatTime: 2, timestamp: 2, messageCount: 3, url: 'u'
            }],
            total: 1, stoppedEarly: true, diagnostics: { d: 1 }, hitGoogleLimit: false
        }),
        getConversationDetail: async (id: string, _sid: any) => ({
            id, title: 'DT', titleSource: 'api-detail', titles: { rpc: 'DT' },
            messages: [{ role: 'user', content: 'hi' }],
            createdAt: 1, chatTime: 1, timestamp: 1, updatedAt: 1,
            url: 'u2', nextPageToken: null, attachmentCount: 0
        })
    };
}

test('provider-neutral - GeminiProvider.listConversations maps to ProviderPageResult', async () => {
    const gp = new GeminiProvider(makeGeminiClient() as any);
    const page = await gp.listConversations({ maxPages: 5 });
    assert.strictEqual(page.items.length, 1);
    assert.strictEqual(page.items[0].id, 'c1');
    assert.strictEqual(page.items[0].title, 'T1');
    assert.strictEqual(page.total, 1);
    assert.strictEqual(page.hasMore, true); // stoppedEarly=true -> more may exist
    assert.strictEqual(page.nextCursor, null);
    assert.deepStrictEqual(page.diagnostics, { d: 1 });

    const gp2 = new GeminiProvider({
        getAllConversations: async () => ({ conversations: [], total: 0, stoppedEarly: false, diagnostics: null, hitGoogleLimit: false })
    } as any);
    const page2 = await gp2.listConversations();
    assert.strictEqual(page2.hasMore, false); // exhausted -> no more
    assert.strictEqual(page2.items.length, 0);
});

test('provider-neutral - GeminiProvider.fetchConversationDetail guarantees id/title/messages', async () => {
    const gp = new GeminiProvider(makeGeminiClient() as any);
    const det = await gp.fetchConversationDetail('c9', { slot: 'u1' });
    assert.strictEqual(det.id, 'c9');
    assert.strictEqual(det.title, 'DT');
    assert.strictEqual(det.messages.length, 1);
    assert.strictEqual(det.nextPageToken, null); // extra Gemini fields preserved via spread
});

test('provider-neutral - ChatGPT fetch calls carry credentials:include (P0-3)', async () => {
    const calls: Array<[string, any]> = [];
    (global as any).fetch = async (url: string, init?: any) => {
        calls.push([url, init]);
        if (url.includes('/api/auth/session')) {
            return { ok: true, json: async () => ({ accessToken: 'tok', user: { email: 'a@b.c' } }) };
        }
        if (url.includes('/backend-api/conversations?')) {
            return { ok: true, json: async () => ({ items: [{ id: 'g1', title: 'GT', create_time: 1700000000, update_time: 1700000100 }] }) };
        }
        if (url.includes('/backend-api/conversation/')) {
            return { ok: true, json: async () => ({ id: 'g1', title: 'GT', mapping: {}, create_time: 1700000000, update_time: 1700000100 }) };
        }
        throw new Error('unexpected ' + url);
    };
    try {
        const cp = new ChatGPTProvider();
        const ready = await cp.checkReadiness();
        assert.strictEqual(ready.ready, true);
        await cp.listConversations({ maxPages: 1 });
        await cp.fetchConversationDetail('g1');
        assert.strictEqual(calls.length, 3);
        for (const [url, init] of calls) {
            assert.strictEqual(init && init.credentials, 'include', `credentials:include on ${url}`);
        }
    } finally {
        delete (global as any).fetch;
    }
});

test('provider-neutral - ChatGPTProvider returns neutral page/detail shapes', async () => {
    (global as any).fetch = async (url: string) => {
        if (url.includes('/backend-api/conversations?')) {
            return { ok: true, json: async () => ({ items: [{ id: 'g1', title: 'GT', create_time: 1700000000, update_time: 1700000100 }] }) };
        }
        throw new Error('unexpected ' + url);
    };
    try {
        const cp = new ChatGPTProvider();
        const page = await cp.listConversations({ maxPages: 1 });
        assert.strictEqual(page.items.length, 1);
        assert.strictEqual(page.items[0].id, 'g1');
        assert.strictEqual(page.items[0].title, 'GT');
        assert.strictEqual(page.items[0].url, 'https://chatgpt.com/c/g1');
        assert.strictEqual(typeof page.items[0].updatedAt, 'number');
        assert.strictEqual(page.total, 1);
        assert.strictEqual(page.nextCursor, null);
        assert.ok(!('conversations' in page), 'no Gemini-flavored field names leak');
    } finally {
        delete (global as any).fetch;
    }
});

test('provider-neutral - flattenChatGPTMapping returns neutral detail shape', () => {
    const m = flattenChatGPTMapping({
        id: 'x', title: ' T ',
        mapping: { n1: { id: 'n1', parent: null, message: { id: 'm1', author: { role: 'user' }, content: { parts: ['hello'] }, create_time: 1700000000 } } },
        current_node: 'n1', create_time: 1700000000, update_time: 1700000100
    }, 'x');
    assert.strictEqual(m.id, 'x');
    assert.strictEqual(m.title, 'T');
    assert.strictEqual(m.messages.length, 1);
    assert.strictEqual(m.messages[0].role, 'user');
    assert.strictEqual(m.messages[0].content, 'hello');
});

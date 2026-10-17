import { historicalFixture, rpcFixture } from './helpers/nativeFixture.js';
import { useIndexStorage } from './helpers/indexStorage.js';
import { fixtureAccount, bindFixture, sourceIndex as asSource } from './helpers/domainFixture.js';
useIndexStorage();
import { indexFixture } from './helpers/indexFixture.js';
export {};
const test = require('node:test');
const assert = require('node:assert');

const { GeminiProvider } = require('../src/core/provider/gemini/geminiProvider.js');

function makeGeminiClient() {
    return {
        getAllConversations: async (_opts: any) => ({
            conversations: ([{
                id: 'c1', title: 'T1', titleSource: 'rpc', titles: { rpc: 'T1' },
                createdAt: 1, updatedAt: 2, chatTime: 2, timestamp: 2, messageCount: 3, url: 'u'
            }]).map(indexFixture).map(asSource),
            total: 1, stoppedEarly: true, diagnostics: { d: 1 }, hitGoogleLimit: false
        }),
        getConversationDetail: async (id: string, _sid: any, account: any) => bindFixture(rpcFixture({ id, title: 'DT', messages: [{ role: 'user', content: 'hi' }] }), account)

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
    const det = await gp.fetchConversationDetail('c9', { slot: '10000000-0000-4000-8000-000000000002' });
    assert.strictEqual(det.conversation.index.key.conversationId, 'c9');
    assert.strictEqual(det.conversation.index.title, 'DT');
    assert.strictEqual(det.conversation.detail.messages.length, 1);
    assert.strictEqual(det.transport.nextPageToken, null); // declared Gemini companion fields are preserved
});

test('provider-neutral - listing preserves sync completeness evidence and callback control', async () => {
    const batch = [{ id: 'audit-chat', title: 'Audit', timestamp: null }];
    const diagnostics = { hitGoogleLimit: true, stopReason: 'window limit' };
    const options = {
        maxPages: 3,
        onPageBatch: async (items: unknown[], info: { page: number; hasMore: boolean }) => {
            assert.strictEqual(items, batch);
            assert.deepStrictEqual(info, { page: 1, hasMore: true });
            return { shouldStop: true, reason: 'watermark' };
        }
    };
    let observedDecision: unknown;
    const gp = new GeminiProvider({
        getAllConversations: async (received: typeof options) => {
            assert.strictEqual(received, options);
            observedDecision = await received.onPageBatch(batch, { page: 1, hasMore: true });
            return {
                conversations: batch, total: 1, stoppedEarly: true,
                exhaustive: false, completionReason: 'hit_google_limit',
                hitGoogleLimit: true, diagnostics
            };
        }
    } as any);
    const page = await gp.listConversations(options);
    assert.deepStrictEqual(observedDecision, { shouldStop: true, reason: 'watermark' });
    assert.strictEqual(page.items, batch);
    assert.strictEqual(page.conversations, batch);
    assert.strictEqual(page.exhaustive, false);
    assert.strictEqual(page.completionReason, 'hit_google_limit');
    assert.strictEqual(page.hitGoogleLimit, true);
    assert.strictEqual(page.diagnostics, diagnostics);
});

test('provider-neutral - detail keeps export evidence and targetSid precedence', async () => {
    const messages = [{ role: 'model', content: 'Report', documents: [{ contentMarkdown: '# Report' }] }];
    const raw = [null, ['wire evidence']];
    const detail = {
        id: 'audit-chat', title: 'Audit', messages, timestamp: null,
        createdAt: null, updatedAt: null, chatTime: null, messageCount: 1,
        url: 'https://gemini.google.com/app/audit-chat', nextPageToken: null, attachmentCount: 0,
        titleSource: 'rpc', titles: { rpc: 'Audit' }, _raw: raw,
        schemaDrift: ['unknown turn'], turnsRejected: 1,
        truncated: true, isTruncated: true, truncateReason: 'token_loop'
    };
    const slots: Array<string | null> = [];
    const gp = new GeminiProvider({
        getConversationDetail: async (id: string, sid: string | null, account: any) => {
            assert.strictEqual(id, detail.id);
            slots.push(sid);
            return bindFixture(rpcFixture(detail, { decodedPayload: raw }), account);
        }
    } as any);
    const result = await gp.fetchConversationDetail(detail.id, { targetSid: '10000000-0000-4000-8000-000000000003', slot: '10000000-0000-4000-8000-000000000002' });
    await gp.fetchConversationDetail(detail.id, { slot: '10000000-0000-4000-8000-000000000002' });
    await gp.fetchConversationDetail(detail.id);
    assert.deepStrictEqual(slots, ['10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', null]);
    assert.equal(result.conversation.index.title, detail.title);
    assert.equal(result.conversation.detail.messages.length, messages.length);
    assert.deepEqual(result.transport.decodedPayload, raw);
});

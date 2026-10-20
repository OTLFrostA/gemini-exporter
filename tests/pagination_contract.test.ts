import test from 'node:test';
import assert from 'node:assert/strict';
import { useIndexStorage } from './helpers/indexStorage.js';
import { ACCOUNT_UUID } from './helpers/accountRuntime.js';
import { sourceDetail, sourceList, sourceMessage } from './helpers/l1SourceFixture.js';
import { GeminiProvider } from '../src/l1/client/gemini/geminiProvider.js';
import { getConversationDetail, type GeminiPaginationDetailClient } from '../src/l1/client/gemini/api/pagination.js';
import type { GeminiRpcParseResult } from '../src/l1/parsers/gemini/rpc/parseConversation.js';
import type { ListParseResult } from '../src/l1/parsers/gemini/rpc/parseList.js';
import { listIndexes as getConversations } from '../src/l3a/storageService.js';
import { getCoverage } from '../src/l2/coverageAdmission.js';
useIndexStorage();
function listProvider(pages: (ListParseResult | Error)[]) {
    return new GeminiProvider({ async getConversationList() { const p = pages.shift(); if (p instanceof Error) throw p; assert.ok(p); return p; },
        getConversationDetail: async () => sourceDetail() }, async () => 'u0');
}
function detailClient(pages: GeminiRpcParseResult[]): GeminiPaginationDetailClient {
    return { async fetchConversationPage() { const page = pages.shift(); assert.ok(page); return page; } };
}
const options = { accountId: ACCOUNT_UUID, streamId: 'recent' };
for (const ids of [[], ['one']]) test(`list: terminal ${ids.length} rows commit before natural end`, async () => {
    assert.equal(await listProvider([sourceList(ids)]).listConversations(options), 'source_end');
    assert.equal((await getConversations(ACCOUNT_UUID)).length, ids.length);
    if (ids.length) assert.ok((await getCoverage(ACCOUNT_UUID, 'recent'))?.range);
});
test('list: invalid populated page saves valid rows but throws and cannot certify coverage', async () => {
    const invalid = sourceList(['two']); invalid.pageEvidence.valid = false;
    const progress: number[] = [];
    await assert.rejects(listProvider([sourceList(['one'], 'tC_next'), invalid]).listConversations({ ...options, onPageCommitted: async p => { progress.push(p.totalObserved); return false; } }), /Malformed/);
    assert.deepEqual((await getConversations(ACCOUNT_UUID)).map(i => i.key.conversationId).sort(), ['one', 'two']);
    assert.equal((await getCoverage(ACCOUNT_UUID, 'recent'))?.range, null);
    assert.deepEqual(progress, [1, 2]);
});
test('list: loop and ordinary errors propagate after committed progress', async () => {
    for (const last of [sourceList(['two'], 'tC_loop'), new Error('HTTP 429')]) {
        await assert.rejects(listProvider([sourceList(['one'], 'tC_loop'), last]).listConversations(options), /loop|429/);
    }
});
test('list: safety budget is internal and reports max_pages without coverage', async () => {
    let pages = 0;
    const provider = new GeminiProvider({ getConversationList: async () => sourceList(['one'], 'tC_' + ++pages), getConversationDetail: async () => sourceDetail() }, async () => 'u0');
    assert.equal(await provider.listConversations(options), 'max_pages'); assert.equal(pages, 2000);
    assert.equal((await getCoverage(ACCOUNT_UUID, 'recent'))?.range, null);
});
test('Detail: complete source chain reverses pages, keeps source version and exposes no Account/Key', async () => {
    const newer = sourceDetail({ messages: [sourceMessage('new')], nextPageToken: 'next' });
    const older = sourceDetail({ messages: [sourceMessage('old')], nextPageToken: null });
    const result = await getConversationDetail(detailClient([newer, older]), 'source_chat_123');
    assert.deepEqual(result.conversation.detail.messages.map(m => m.id), ['old', 'new']);
    assert.equal(result.conversation.detail.quality.status, 'complete');
    assert.equal(result.conversation.detail.savedAt, 1700000000000);
    assert.equal('account' in result, false); assert.equal('key' in result.conversation.detail, false);
});
test('Detail: token loop and twenty-page safety limit keep partial quality', async () => {
    const looping = sourceDetail({ nextPageToken: 'loop' });
    const loop = await getConversationDetail(detailClient([looping, looping]), 'source_chat_123');
    assert.equal(loop.conversation.detail.quality.status, 'partial');
    const pages = Array.from({ length: 20 }, (_, i) => sourceDetail({ messages: [sourceMessage('m' + i)], nextPageToken: 'next' + i }));
    const limit = await getConversationDetail(detailClient(pages), 'source_chat_123');
    assert.equal(limit.conversation.detail.messages.length, 20); assert.equal(limit.conversation.detail.quality.status, 'partial');
});
test('Detail: identity mismatch and transport errors reject instead of inventing completion', async () => {
    await assert.rejects(getConversationDetail(detailClient([sourceDetail({ id: 'other' })]), 'source_chat_123'), /identity/);
    await assert.rejects(getConversationDetail({ fetchConversationPage: async () => { throw new Error('offline'); } }, 'source_chat_123'), /offline/);
});
test('Detail: abort between pages prevents another request', async () => {
    const controller = new AbortController(); let calls = 0;
    await assert.rejects(getConversationDetail({ fetchConversationPage: async () => { calls++; controller.abort(); return sourceDetail({ nextPageToken: 'next' }); } }, 'source_chat_123', 'u0', undefined, controller.signal), { name: 'AbortError' });
    assert.equal(calls, 1);
});
test('Detail: metadata-only fallback follows the replacement chain and remains source-bound', async () => {
    const metadata = sourceDetail({ messages: [], _raw: [null, null, [['c_source_chat_123']]] });
    const requested: unknown[] = [];
    const pages = [metadata, sourceDetail({ nextPageToken: 'retry-next' }), sourceDetail({ messages: [sourceMessage('old')] })];
    const result = await getConversationDetail({ fetchConversationPage: async (_id, cursor, _slot, opts) => { requested.push([cursor, opts?.altParams]); return pages.shift()!; } }, 'source_chat_123');
    assert.equal(result.conversation.detail.quality.status, 'complete');
    assert.deepEqual(requested, [[null, undefined], [null, true], ['retry-next', true]]);
});
test('Detail: empty source and failed metadata fallback never claim complete', async () => {
    const metadata = sourceDetail({ messages: [], _raw: [null, null, [['c_source_chat_123']]] });
    let calls = 0;
    const result = await getConversationDetail({ fetchConversationPage: async () => { if (calls++) throw new Error('no alternate'); return metadata; } }, 'source_chat_123');
    assert.equal(result.conversation.detail.messages.length, 0); assert.equal(result.conversation.detail.quality.status, 'unknown');
});

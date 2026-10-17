import { upsertConversations, persistConversationBatch } from '../src/content/geminiIndexCapture.js';
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { indexStorage } from './helpers/indexStorage.js';
import { ACCOUNT_UUID, OTHER_ACCOUNT_UUID, ACCOUNT_OBSERVATION } from './helpers/accountRuntime.js';
import { GeminiProvider } from '../src/core/provider/gemini/geminiProvider.js';
import type { GeminiProviderClient } from '../src/core/provider/gemini/geminiContracts.js';
import type { CommittedListPage } from '../src/core/provider/aiProvider.js';
import { parseList, type ListParseResult } from '../src/core/parsers/gemini/rpc/parseList.js';
import { readGeminiDetailRequest } from '../src/core/parsers/gemini/rpc/detailRequest.js';
import { parseGeminiRpcConversation } from '../src/core/parsers/gemini/rpc/parseConversation.js';
import { getConversationDetail } from '../src/core/api/client/pagination.js';
import { getConversations } from '../src/core/storage/conversationCatalogStore.js';
import { getStoredDomain } from '../src/core/storage/domain/domainStore.js';
import { getCoverage } from '../src/core/domain/coverageAdmission.js';
import { getAccount } from '../src/core/api/accountRegistry.js';
import { init, handleWindowMessage } from '../src/content/messageBridge.js';
import { CrossWorldEvents } from '../src/core/protocol/protocol.js';
import { importTakeout } from '../src/core/imports/takeout/importTakeout.js';
import { parseChatGPTConversation } from '../src/core/parsers/chatgpt/parseConversation.js';
import { ChatGPTProvider } from '../src/core/provider/chatgpt/chatgptProvider.js';
import { fixtureAccount } from './helpers/domainFixture.js';

let storage: ReturnType<typeof indexStorage>;
beforeEach(() => { storage = indexStorage(); init(); });
afterEach(() => storage.restore());
const row = (id = 'source_chat_123', seconds = 1700000050) => [`c_${id}`, 'Source title', null, null, null, [seconds, 0]];
const listWire = (rows: unknown[] = [], next: string | null = null) => JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, next, rows])]]);
const list = (rows: unknown[] = [], next: string | null = null) => parseList(listWire(rows, next));
function client(pages: (ListParseResult | Error)[], requests: unknown[] = []): GeminiProviderClient {
    return { async getConversationList(cursor, slot, filter, options) {
        requests.push({ cursor, slot, filter, signal: options?.signal });
        const page = pages.shift();
        if (page instanceof Error) throw page;
        assert.ok(page, 'unexpected next request');
        return page;
    }, async getConversationDetail() { throw new Error('Unexpected detail acquisition'); } };
}
const provider = (pages: (ListParseResult | Error)[], requests: unknown[] = []) => new GeminiProvider(client(pages, requests), async () => 'u0');
const options = () => ({ accountId: ACCOUNT_UUID, streamId: 'recent' });
const detailWire = (prompt = 'Question', next: string | null = null, version = true) => JSON.stringify([
    ['wrb.fr', 'hNvQHb', JSON.stringify([[[['c_source_chat_123', `r_${prompt}`], [1700000000, 0], [[prompt]], [[['rc_' + prompt, [['Answer']]]]]]], next])],
    ...(version ? [['wrb.fr', 'MaZiqc', JSON.stringify([null, null, [row()]])]] : []),
]);
const sourceEvent = (text: string, extra: Record<string, unknown> = {}) => ({ origin: typeof location !== 'undefined' ? location.origin : 'https://gemini.google.com', data: {
    type: CrossWorldEvents.NETWORK_BATCHEXECUTE, payload: { text, slot: 'u0', requestedAt: Date.now(), truncated: false,
        url: 'https://gemini.google.com/_/BardChatUi/data/batchexecute', requestAccountObservation: ACCOUNT_OBSERVATION, ...extra },
} } as MessageEvent);

test('L1 list commits each page before callback and emits only first trusted head', async () => {
    const requests: unknown[] = [], progress: CommittedListPage[] = [];
    const end = await provider([list([row()], 'tC_NEXT_PAGE_123456789'), list()], requests).listConversations({ ...options(),
        async onPageCommitted(info) {
            assert.equal((await getConversations(ACCOUNT_UUID)).length, 1);
            progress.push(info); return false;
        } });
    assert.equal(end, 'source_end');
    assert.deepEqual(progress.map(page => [page.page, page.totalObserved]), [[1, 1], [2, 1]]);
    assert.ok(progress[0].scanHead); assert.equal(progress[1].scanHead, undefined);
    assert.equal('items' in progress[0], false);
    assert.equal((await getCoverage(ACCOUNT_UUID, 'recent'))?.range !== null, true);
    assert.deepEqual(requests.map(request => (request as { cursor: unknown }).cursor), [null, 'tC_NEXT_PAGE_123456789']);
});
test('L1 callback stop never overrides a real source terminal', async () => {
    assert.equal(await provider([list([row()])]).listConversations({ ...options(), onPageCommitted: async () => true }), 'source_end');
    assert.equal(await provider([list([row()], 'tC_NEXT_PAGE_123456789')]).listConversations({ ...options(), onPageCommitted: async () => true }), 'stopped');
});
test('L1 preserves row counts independently of Domain deduplication', async () => {
    const counts: number[] = [];
    await provider([list([row()], 'tC_NEXT_PAGE_123456789'), list([row()])]).listConversations({ ...options(), onPageCommitted: async info => { counts.push(info.totalObserved); return false; } });
    assert.deepEqual(counts, [1, 2]); assert.equal((await getConversations(ACCOUNT_UUID)).length, 1);
});
test('L1 propagates commit failure without callback or another request', async () => {
    storage.fail(`conversations_${ACCOUNT_UUID}`);
    let called = false;
    await assert.rejects(provider([list([row()])]).listConversations({ ...options(), onPageCommitted: async () => { called = true; return false; } }), /write failed/);
    assert.equal(called, false);
});
test('L1 propagates network errors even after a committed page', async () => {
    await assert.rejects(provider([list([row()], 'tC_NEXT_PAGE_123456789'), new Error('offline')]).listConversations(options()), /offline/);
    assert.equal((await getConversations(ACCOUNT_UUID)).length, 1);
});
test('L1 rejects malformed pages and cursor loops', async () => {
    await assert.rejects(provider([list([row()], 'tC_NEXT_PAGE_123456789'), list([row()], 'tC_NEXT_PAGE_123456789')]).listConversations(options()), /cursor loop/);
    await assert.rejects(provider([parseList('garbage')]).listConversations(options()), /list failed/);
});
test('L1 abort never reports exhaustion or starts another page', async () => {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(provider([]).listConversations({ ...options(), signal: controller.signal }), { name: 'AbortError' });
});
test('L1 routes exactly the requested stream', async () => {
    const requests: unknown[] = [];
    assert.equal(await provider([list()], requests).listConversations({ ...options(), streamId: 'pinned' }), 'source_end');
    assert.deepEqual((requests[0] as { filter: unknown }).filter, [1, null, 1]); assert.equal(requests.length, 1);
});
test('L1 rejects account mismatch and route changes before acquisition', async () => {
    await assert.rejects(provider([]).listConversations({ ...options(), accountId: fixtureAccount('chatgpt').id }), /mismatch/);
    let routeCalls = 0;
    const p = new GeminiProvider(client([]), async () => ++routeCalls === 1 ? 'u0' : 'u1');
    await assert.rejects(p.listConversations(options()), /route changed/);
});
test('L1 unknown identity can retain rows but emits no trusted scanHead', async () => {
    const defaultId = '10000000-0000-4000-8000-000000000003';
    let head: unknown;
    await provider([list([row()])]).listConversations({ ...options(), accountId: defaultId,
        onPageCommitted: async info => { head = info.scanHead; return false; } });
    assert.equal(head, undefined); assert.equal(await getCoverage(defaultId, 'recent'), null);
});
test('L1 unknown Bard errors cannot become a history-window terminal', () => {
    for (const error of ['BardErrorInfo: cursor expired', '["BardErrorInfo",9999]']) {
        const parsed = parseList(JSON.stringify([['wrb.fr', 'MaZiqc', null, null, null, ['generic', error]]]));
        assert.equal(parsed.failure, 'invalid_response');
    }
});
test('L1 detail request decoding accepts only the actual RPC layout', () => {
    const body = (args: unknown) => new URLSearchParams({ 'f.req': JSON.stringify([[['hNvQHb', JSON.stringify(args), null, 'generic']]]) }).toString();
    assert.deepEqual(readGeminiDetailRequest(body(['c_source_chat_123', 10, 'tC_NEXT_PAGE_123456789', 1, [1], [4], null, 1])), { conversationId: 'source_chat_123', requestCursor: 'tC_NEXT_PAGE_123456789' });
    assert.equal(readGeminiDetailRequest(body(['c_source_chat_123', 10, 'tC_NEXT_PAGE_123456789'])), null);
    assert.equal(readGeminiDetailRequest('garbage'), null);
});
test('L1 passive list commits directly, including the empty terminal', async () => {
    await handleWindowMessage(sourceEvent(listWire([row()], 'tC_NEXT_PAGE_123456789'), { listRequest: { streamId: 'recent', requestCursor: null } }));
    await handleWindowMessage(sourceEvent(listWire(), { listRequest: { streamId: 'recent', requestCursor: 'tC_NEXT_PAGE_123456789' } }));
    assert.equal((await getConversations(ACCOUNT_UUID)).length, 1);
    assert.ok((await getCoverage(ACCOUNT_UUID, 'recent'))?.range);
});
test('L1 passive list uses captured identity and never borrows current account', async () => {
    await handleWindowMessage(sourceEvent(listWire([row()]), { requestAccountObservation: { providerId: 'gemini', providerAccountId: '10000000002' } }));
    assert.equal((await getConversations(ACCOUNT_UUID)).length, 0);
    assert.equal((await getConversations(OTHER_ACCOUNT_UUID)).length, 1);
});
test('L1 passive input validates URL, required fields and capture limits', async () => {
    for (const extra of [{ url: 'https://evil.test/batchexecute' }, { requestedAt: undefined }, { truncated: undefined }, { text: 'a'.repeat(3000001) }]) {
        await handleWindowMessage(sourceEvent(listWire([row()]), extra));
    }
    assert.equal((await getConversations(ACCOUNT_UUID)).length, 0);
});
test('L1 passive uncorrelated detail cannot become complete or issue a request', async () => {
    await handleWindowMessage(sourceEvent(detailWire()));
    const stored = await getStoredDomain({ providerId: 'gemini', accountId: ACCOUNT_UUID, conversationId: 'source_chat_123' });
    assert.ok(stored); assert.equal(stored.conversation.detail.quality.status, 'unknown');
});
test('L1 passive observed detail chain shares active source assembly', async () => {
    const next = 'tC_NEXT_PAGE_123456789';
    await handleWindowMessage(sourceEvent(detailWire('Newer', next), { detailRequest: { conversationId: 'source_chat_123', requestCursor: null } }));
    await handleWindowMessage(sourceEvent(detailWire('Older'), { detailRequest: { conversationId: 'source_chat_123', requestCursor: next } }));
    const stored = await getStoredDomain({ providerId: 'gemini', accountId: ACCOUNT_UUID, conversationId: 'source_chat_123' });
    assert.ok(stored); assert.equal(stored.conversation.detail.quality.status, 'complete');
    assert.equal(stored.conversation.detail.messages.length, 4);
});
test('L1 delete only emits existing source control callback', async () => {
    let observed: unknown;
    init({ onConversationDeleted: (id, accountId) => { observed = [id, accountId]; } });
    await handleWindowMessage({ ...sourceEvent('unused'), data: { type: CrossWorldEvents.CONVERSATION_DELETED,
        payload: { id: 'source_chat_123', slot: 'u0', requestAccountObservation: ACCOUNT_OBSERVATION } } });
    assert.deepEqual(observed, ['source_chat_123', ACCOUNT_UUID]);
});
test('L1 detail returns void after successful L2 admission', async () => {
    const account = await getAccount(ACCOUNT_UUID); assert.ok(account);
    const source = parseGeminiRpcConversation(detailWire(), { providerId: 'gemini', account });
    const p = new GeminiProvider({ ...client([]), getConversationDetail: async () => source }, async () => 'u0');
    assert.equal(await p.fetchConversationDetail(ACCOUNT_UUID, 'source_chat_123'), undefined);
    assert.equal((await getConversations(ACCOUNT_UUID)).length, 1);
});
test('L1 active Detail forwards AbortSignal to every source request', async () => {
    const controller = new AbortController(), account = await getAccount(ACCOUNT_UUID); assert.ok(account);
    const parsed = parseGeminiRpcConversation(detailWire(), { providerId: 'gemini', account });
    let seen: unknown;
    await getConversationDetail({ fetchConversationPage: async (_id, _token, _slot, opts) => { seen = opts?.signal; return parsed; } }, 'source_chat_123', 'u0', account, controller.signal);
    assert.equal(seen, controller.signal);
});
test('L1 import submits facts and returns count/status with numerical progress', async () => {
    const html = '<div class="outer-cell"><a href="https://gemini.google.com/app/source_chat_123">Conversation</a><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Prompted Question<br>2026-09-02T12:00:00Z<br><p>Answer</p></div></div>';
    const archive = { file() {}, files: { 'Takeout/Gemini/MyActivity.html': { _data: { uncompressedSize: html.length }, async: async () => html } } };
    const progress: number[] = [];
    const result = await importTakeout(archive as unknown as File, ACCOUNT_UUID, percent => progress.push(percent));
    assert.deepEqual(result, { imported: 1, status: 'partial' });
    assert.equal((await getConversations(ACCOUNT_UUID)).length, 1);
    assert.ok(progress.every(value => typeof value === 'number' && value >= 0 && value <= 100)); assert.equal(progress.at(-1), 100);
});
test('L1 ChatGPT body quality is independent of missing image bytes', () => {
    const parsed = parseChatGPTConversation({ account: fixtureAccount('chatgpt'), conversation: { id: 'chatgpt_123', create_time: 1700000000, update_time: 1700000001, is_archived: false, title: 'Images', current_node: 'node', mapping: {
        node: { id: 'node', parent: 'root', children: [], message: { id: 'msg', author: { role: 'assistant', metadata: {} }, recipient: 'all', status: 'finished_successfully', weight: 1, content: { content_type: 'multimodal_text', parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_123' }] } } },
    } }, assetsByNode: new Map() });
    assert.equal(parsed.conversation.detail.quality.status, 'complete');
    assert.equal(parsed.conversation.detail.assets.length, 1);
});
test('L1 ChatGPT rejects conflicting session identity before list submission', async () => {
    const p = new ChatGPTProvider({ fetchFn: async () => ({ ok: true, json: async () => ({ accessToken: 'token', user: { id: 'other-user' }, account: { id: 'workspace' } }) } as Response) });
    await assert.rejects(p.listConversations({ accountId: fixtureAccount('chatgpt').id, streamId: 'recent' }), /account mismatch/);
});

test('L1 known window heuristic commits empty terminal after real continuation, never on first page', async () => {
    const limited = parseList(JSON.stringify([['wrb.fr', 'MaZiqc', null, null, null, ['BardErrorInfo', 1096]]]));
    assert.equal(limited.failure, 'hit_google_limit');
    const progress: CommittedListPage[] = [];
    assert.equal(await provider([list([row()], 'tC_NEXT_PAGE_123456789'), limited]).listConversations({ ...options(),
        onPageCommitted: async info => { progress.push(info); return false; } }), 'provider_limit');
    assert.equal(progress.length, 2);
    assert.ok((await getCoverage(ACCOUNT_UUID, 'recent'))?.range);
    await assert.rejects(provider([limited]).listConversations(options()), /list failed/);
});

test('L1 HTTP 429 stays a network failure after committed rows', async () => {
    await assert.rejects(provider([list([row()], 'tC_NEXT_PAGE_123456789'), new Error('HTTP 429 :: BardErrorInfo 1096')]).listConversations(options()), /HTTP 429/);
    assert.equal((await getCoverage(ACCOUNT_UUID, 'recent'))?.range, null);
});
test('L1 source resource operation returns bytes and respects pre-abort', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(Uint8Array.of(1, 2, 3));
    try {
        const p = provider([]);
        const asset = { id: 'image', kind: 'image' as const, sourceUri: 'https://example.test/image', mediaType: 'image/png' };
        const result = await p.acquireResource(ACCOUNT_UUID, asset);
        assert.deepEqual(result, { bytes: Uint8Array.of(1, 2, 3), mediaType: 'image/png' });
        const controller = new AbortController(); controller.abort();
        await assert.rejects(p.acquireResource(ACCOUNT_UUID, asset, controller.signal), { name: 'AbortError' });
        await assert.rejects(p.acquireResource(ACCOUNT_UUID, { ...asset, sourceUri: 'blob:temporary' }), /locator/);
    } finally { globalThis.fetch = original; }
});

test('L1 DOM capture commits source metadata without fabricating activity clocks', async () => {
    assert.equal(await upsertConversations([{ id: 'dom_source_123', title: 'Observed title', titleSource: 'dom' }], 'dom', false, ACCOUNT_UUID), 1);
    const [index] = await getConversations(ACCOUNT_UUID);
    assert.equal(index.titleSource, 'provider');
    assert.equal(index.updatedAt, undefined);
    assert.equal(await getCoverage(ACCOUNT_UUID, 'recent'), null);
});
test('L1 capture preserves valid source rows when another row is malformed', async () => {
    const result = await persistConversationBatch([{ id: 'valid_source_123' }, { broken: true }], 'dom', false, ACCOUNT_UUID);
    assert.equal(result.accepted, 1); assert.equal(result.rejected, 1);
});

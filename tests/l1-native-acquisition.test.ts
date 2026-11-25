import { describe as __suiteDescribe } from 'node:test';
import { fixtureAccount } from "./helpers/domainFixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGeminiRpcConversation } from "../src/l1/parsers/gemini/rpc/parseConversation.js";
import { mergeConversationPages } from "../src/l1/parsers/gemini/rpc/mergePages.js";
import { getConversationDetail } from "../src/l1/client/gemini/api/pagination.js";
import { assertDomainClosure } from "../src/l2/closure.js";
import { textOfBlock } from "./helpers/contentText.js";
import { type SourceConversationParseResult } from "../src/l1/parsers/parsingResult.js";
import { detailGen as geminiDetailGen } from "./fixtures/providers/geminiDetail.js";
import { geminiListPage } from "./fixtures/providers/geminiListCapture.js";
import { GEMINI_LIST_CAPTURE } from "./fixtures/providers/geminiListCapture.js";
import test__s2 from "node:test";
import { useIndexStorage } from "./helpers/indexStorage.js";
import { GeminiAPIClient } from "../src/l1/client/gemini/geminiClient.js";
import retryPolicy from "../src/l1/client/gemini/api/retryPolicy.js";
import { geminiRpcPacket } from "./fixtures/providers/geminiRpcCapture.js";
import { GEMINI_DETAIL_CAPTURE } from "./fixtures/providers/geminiRpcCapture.js";
import test__s3 from "node:test";
import { ACCOUNT_UUID } from "./helpers/accountRuntime.js";
import { OTHER_ACCOUNT_UUID } from "./helpers/accountRuntime.js";
import { sourceDetail } from "./helpers/l1SourceFixture.js";
import { sourceList } from "./helpers/l1SourceFixture.js";
import { GeminiProvider } from "../src/l1/client/gemini/geminiProvider.js";
import credentials from "../src/l1/client/gemini/api/credentialManager.js";
import { listIndexes as getConversations } from "../src/l3a/storageService.js";
import { getDetail } from "../src/l3a/storageService.js";
import { createSourceResourceContext } from "../src/l1/resources/sourceResources.js";
import { attemptResource } from "../src/shared/resources/resourceResult.js";
import { resourceFailureText } from "../src/shared/resources/resourceResult.js";
import test__s4 from "node:test";
import { type CommittedListPage } from "../src/l1/client/aiProvider.js";
import { ClaudeProvider } from "../src/l1/client/claude/claudeProvider.js";
import { listGen as claudeListGen } from "./fixtures/providers/claudeList.js";
import { organizationsGen as claudeOrganizationsGen } from "./fixtures/providers/claudeOrganizations.js";
import test__s5 from "node:test";
import { parseChatGPTList } from "../src/l1/parsers/chatgpt/parseList.js";
import { listGen as chatgptListGen } from "./fixtures/providers/chatgpt.js";
import { sessionGen as chatgptSessionGen } from "./fixtures/providers/chatgptSession.js";
import { listGen as geminiListGen } from "./fixtures/providers/gemini.js";
import { parseList } from "../src/l1/parsers/gemini/rpc/parseList.js";
import { domListGen } from "./fixtures/providers/geminiDomList.js";
import { ChatGPTProvider } from "../src/l1/client/chatgpt/chatgptProvider.js";
import { geminiListObservation } from "../src/l1/client/gemini/listObservation.js";
import { getOrCreateAccount } from "../src/runtime/api/accountRegistry.js";
import { parseGeminiDomIndex } from "../src/l1/parsers/gemini/dom/parseIndex.js";
import test__s6 from "node:test";
import { indexStorage } from "./helpers/indexStorage.js";
import { accountRuntime } from "./helpers/accountRuntime.js";
import { ACCOUNT_OBSERVATION } from "./helpers/accountRuntime.js";
import { ingestIndexes } from "../src/l2/ingestion.js";
import { ingestDeletedConversation } from "../src/l2/ingestion.js";
import { listIndexes } from "../src/l3a/storageService.js";
import { getIndex } from "../src/l3a/storageService.js";
import { init } from "../src/l1/sniffer/gemini/messageBridge.js";
import { handleWindowMessage } from "../src/l1/sniffer/gemini/messageBridge.js";
import { parseGeminiIndexObservation } from "../src/l1/parsers/gemini/parseIndexObservation.js";
import test__s7 from "node:test";
import { getCoverage } from "../src/l3a/storageService.js";
import test__s8 from "node:test";
import test__s9 from "node:test";

__suiteDescribe("l1-native-acquisition", () => {
function page(key: Parameters<typeof geminiDetailGen>[0]) {
    return parseGeminiRpcConversation(geminiDetailGen(key), {
        account: fixtureAccount('gemini'), providerId: 'gemini', targetConvId: 'native',
    });
}
const activity = (prompt: string) => `<div class="outer-cell"><a href="https://gemini.google.com/app/c_native">Chat</a><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Prompted ${prompt}<br>2026-09-02T12:00:00Z<br><p>Answer</p></div></div>`;
const result = (uri?: string, messageId = 'm1', timestamp = 1): SourceConversationParseResult => ({
    conversationId: 'native', sourceVersion: timestamp,
    conversation: { index: { title: 'Title' }, detail: { quality: { status: 'unknown' },
        messages: [{ id: messageId, role: 'assistant', timestamp, content: [{ type: 'paragraph', children: [{ type: 'image', assetId: 'image' }] }], attachmentIds: ['image'] }],
        assets: [{ id: 'image', kind: 'image', name: 'photo.png', ...(uri ? { sourceUri: uri } : {}) }] } },
    diagnostics: [], acquisitionHints: {},
});

test('production pagination merges native pages chronologically and closes renamed resources', async () => {
    const pages = [page('G_NATIVE_ACQ_MIXED_01'), page('G_NATIVE_ACQ_MIXED_02')];
    let index = 0;
    const detail = await getConversationDetail({ async fetchConversationPage() { return pages[index++]; } }, 'native');
    const native = detail;
    assert.equal(index, 2);
    assert.deepEqual(native.conversation.detail.messages.filter(m => m.role === 'user').map(m => textOfBlock(m.content[0])), ['Question r_old', 'Question r_new']);
    assert.equal(native.conversation.index.createdAt, undefined);
    assert.equal(detail.conversation.index.createdAt, native.conversation.index.createdAt);
    assert.equal(detail.sourceVersion, 1700000010000);
    assertDomainClosure((native.conversation).detail);
    const merged = mergeConversationPages([result('https://example.test/new.png', 'new', 20), result('https://example.test/old.png', 'old', 10)]);
    assert.deepEqual(merged.conversation.detail.messages.map(m => m.attachmentIds), [['image_page1'], ['image']]);
    assert.equal(merged.conversation.detail.assets.length, 2);
    assertDomainClosure((merged.conversation).detail);
});


test('page merge dedupes stable messages and shared source images without collapsing anonymous assets', () => {
    const same = result('https://example.test/shared.png');
    const merged = mergeConversationPages([same, structuredClone(same)]);
    assert.equal(merged.conversation.detail.messages.length, 1);
    assert.equal(merged.conversation.detail.assets.length, 1);
    const anonymous = mergeConversationPages([result(undefined, 'new'), result(undefined, 'old')]);
    assert.equal(anonymous.conversation.detail.assets.length, 2);
    assert.throws(() => mergeConversationPages([same, { ...same, conversationId: 'other' }]), /different conversations/);
});


test('native token loops retain diagnostics and explicitly mark incomplete coverage', async () => {
    const view = page('G_NATIVE_ACQ_MIXED_03');
    const detail = await getConversationDetail({ async fetchConversationPage() { return view; } }, 'native');
    assert.equal(detail.evidence?.truncation, 'token_loop');
    assert.equal(detail.conversation.detail.messages.length, 2);
    assert.equal(detail.conversation.detail.quality.status, 'partial');
    assert.ok(detail.diagnostics.some(d => d.code === 'GEMINI_PAGINATION_TRUNCATED'));
});


test('production RPC client parses raw responses without invoking the legacy detail facade', async () => {
    const credentials = require('../src/l1/client/gemini/api/credentialManager.js') as typeof import('../src/l1/client/gemini/api/credentialManager.js');
    const transport = require('../src/l1/client/gemini/api/rpcClient.js') as typeof import('../src/l1/client/gemini/api/rpcClient.js');
    const originalCred = credentials.resolveCred, originalPost = transport.postBatchexecute;
    credentials.resolveCred = async () => ({ at: 'test', bl: 'test', accountSlot: 'u0', fSid: 'test' });
    transport.postBatchexecute = async () => ({ response: new Response(), text: geminiDetailGen('G_NATIVE_ACQ_01') });
    try {
        const { GeminiAPIClient } = require('../src/l1/client/gemini/geminiClient.js') as typeof import('../src/l1/client/gemini/geminiClient.js');
        const detail = await new GeminiAPIClient().fetchConversationPage('native', null, 'u0');
        assert.equal(detail.conversation.index.title, 'Native title');
        assert.equal(detail.conversation.detail.messages.length, 2);
        assert.equal(Reflect.get(detail.conversation.detail.messages[0], 'provenance'), undefined);
    } finally { credentials.resolveCred = originalCred; transport.postBatchexecute = originalPost; }
});


test('native pagination rejects mixed legacy message pages instead of dropping their bodies', async () => {
    const native = page('G_NATIVE_ACQ_MIXED_04');
    const legacy = { id: 'native', messages: [{ role: 'model', content: 'old' }] };
    let index = 0;
    await assert.rejects(getConversationDetail({ async fetchConversationPage() { return [native, legacy][index++] as never; } }, 'native'), TypeError);
});



test('metadata-only detail retry follows native pagination to its terminal page', async () => {
    const calls: Array<{ token?: string | null; detailOnly?: boolean }> = [];
    const empty = parseGeminiRpcConversation(geminiDetailGen('G_NATIVE_ACQ_02'), { account: fixtureAccount('gemini'), providerId: 'gemini', targetConvId: 'native' });
    const detail = await getConversationDetail({ async fetchConversationPage(_id, token, _sid, options) {
        calls.push({ token, detailOnly: options?.detailOnly });
        if (!options?.detailOnly) return empty;
        return token ? page('G_NATIVE_ACQ_MIXED_05') : page('G_NATIVE_ACQ_MIXED_06');
    } }, 'native');
    assert.equal(calls.length, 3);
    assert.equal(calls[2].token, 'tC_retry_older');
    assert.equal(calls[2].detailOnly, true);
    assert.equal(detail.conversation.detail.messages.length, 4);
    assert.equal(Boolean(detail.evidence?.truncation), false);
});


test('an explicit empty native Detail turn array remains a valid source result', async () => {
    const empty = parseGeminiRpcConversation(geminiDetailGen('G_NATIVE_ACQ_03'), {
        account: fixtureAccount('gemini'), providerId: 'gemini', targetConvId: 'native',
    });
    const result = await getConversationDetail({
        async fetchConversationPage() { return empty; },
    }, 'native');
    assert.equal(result.conversationId, 'native');
    assert.deepEqual(result.conversation.detail.messages, []);
    assert.equal(result.conversation.detail.quality.status, 'unknown');
});

test('metadata-only retry accepts a native explicit empty Detail without using stale metadata transport', async () => {
    const metadata = parseGeminiRpcConversation(geminiDetailGen('G_NATIVE_ACQ_04'), {
        account: fixtureAccount('gemini'), providerId: 'gemini', targetConvId: 'native',
    });
    const emptyBody = [[], null, 'Verified empty conversation'];
    const verified = parseGeminiRpcConversation(geminiDetailGen('G_NATIVE_ACQ_05'), {
        account: fixtureAccount('gemini'), providerId: 'gemini', targetConvId: 'native',
    });
    const calls: Array<{ detailOnly?: boolean; altParams?: boolean }> = [];
    const result = await getConversationDetail({
        async fetchConversationPage(_id, _token, _sid, options) {
            calls.push({ detailOnly: options?.detailOnly, altParams: options?.altParams });
            return options?.detailOnly ? verified : metadata;
        },
    }, 'native');
    assert.deepEqual(calls, [
        { detailOnly: undefined, altParams: undefined },
        { detailOnly: true, altParams: true },
    ]);
    assert.deepEqual(result.conversation.detail.messages, []);
    assert.equal(result.conversation.detail.quality.status, 'unknown');
    assert.deepEqual(result.transport.decodedPayload, emptyBody);
});

test('native metadata-only Detail cannot succeed when its alternate also has no turns', async () => {
    const metadata = parseGeminiRpcConversation(geminiDetailGen('G_NATIVE_ACQ_06'), {
        account: fixtureAccount('gemini'), providerId: 'gemini', targetConvId: 'native',
    });
    let calls = 0;
    await assert.rejects(getConversationDetail({
        async fetchConversationPage() { calls++; return metadata; },
    }, 'native'), /GEMINI_DETAIL_EMPTY_UNVERIFIED/);
    assert.equal(calls, 2);
});


test('cooperative ZIP decoding yields to the event loop and preserves synchronous HTML semantics', async () => {
    const { parseGeminiTakeoutArchive, parseGeminiTakeoutArchiveAsync } = require('../src/l1/parsers/gemini/takeout/parseConversation.js') as typeof import('../src/l1/parsers/gemini/takeout/parseConversation.js');
    const raw = { htmlText: Array.from({ length: 120 }, (_, index) => activity(`Question ${index}`)).join('') };
    let yielded = false;
    const timer = setTimeout(() => { yielded = true; }, 0);
    const progress: number[][] = [];
    try {
        const asyncResults = await parseGeminiTakeoutArchiveAsync(raw, { account: fixtureAccount('gemini'), providerId: 'gemini' }, (completed, total) => progress.push([completed, total]));
        assert.equal(yielded, true);
        assert.ok(progress.some(([completed, total]) => completed === 100 && total === 120));
        assert.deepEqual(asyncResults, parseGeminiTakeoutArchive(raw, { account: fixtureAccount('gemini'), providerId: 'gemini' }));
        assert.equal(asyncResults[0].conversation.detail.messages.length, 240);
    } finally { clearTimeout(timer); }
});



test('Takeout prompt-cell attachments and audio stay user-owned while response references remain assistant-owned', () => {
    const { parseGeminiTakeoutArchive } = require('../src/l1/parsers/gemini/takeout/parseConversation.js') as typeof import('../src/l1/parsers/gemini/takeout/parseConversation.js');
    const htmlText = `<div class="outer-cell"><a href="https://gemini.google.com/app/c_native">Chat</a><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Prompted Read files<br>Attached 1 file.<br><a href="same.png">Image</a><br><a href="recording.wav">Audio</a><br>2026-09-02T12:00:00Z<br><p>Answer <img src="same.png"></p></div><div class="content-cell mdl-typography--text-right"><img src="same.png" class="image-preview"></div><img src="unowned.png"></div>`;
    const result = parseGeminiTakeoutArchive({ htmlText, archiveFiles: { 'same.png': {}, 'recording.wav': {}, 'unowned.png': {} } }, { account: fixtureAccount('gemini'), providerId: 'gemini' })[0];
    const assets = new Map(result.conversation.detail.assets.map(asset => [asset.id, asset]));
    assert.deepEqual(result.conversation.detail.messages[0].attachmentIds!.map(id => assets.get(id)!.kind), ['image', 'audio']);
    assert.deepEqual(result.conversation.detail.messages[1].attachmentIds!.map(id => assets.get(id)!.name), ['same.png']);
    assert.equal(result.conversation.detail.messages[0].attachmentIds![0], result.conversation.detail.messages[1].attachmentIds![0]);
    assert.equal(result.diagnostics.filter(d => d.code === 'TAKEOUT_UNBOUND_RESOURCE').length, 1);
    assertDomainClosure((result.conversation).detail);
});



test('metadata-only retry cannot hide a subsequent detail-page fetch failure', async () => {
    const empty = parseGeminiRpcConversation(geminiDetailGen('G_NATIVE_ACQ_07'), { account: fixtureAccount('gemini'), providerId: 'gemini', targetConvId: 'native' });
    await assert.rejects(getConversationDetail({ async fetchConversationPage(_id, token, _sid, options) {
        if (!options?.detailOnly) return empty;
        if (token) throw new Error('Interrupted detail chain');
        return page('G_NATIVE_ACQ_MIXED_07');
    } }, 'native'), /Interrupted detail chain/);
});
});

__suiteDescribe("gemini_client_retry", () => {
const test = require('node:test');
const assert = require('node:assert');

const { GeminiAPIClient } = require('../src/l1/client/gemini/geminiClient.js');
const { handleHttp400 } = require('../src/l1/client/gemini/api/retryPolicy.js');
const { useIndexStorage } = require('./helpers/indexStorage.js');
useIndexStorage();

// 1. handleHttp400 XSRF recovery logic in retryPolicy
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

// 2. GeminiAPIClient HTTP 400 automatic retry
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
        return {
            ok: true,
            status: 200,
            text: async () => geminiListPage().responseBody
        };
    };

    try {
        const res = await client.getConversationList(null, 'u0');
        assert.strictEqual(callCount, 2, 'Should have retried once on 400');
        assert.strictEqual(res.conversations.length, GEMINI_LIST_CAPTURE.firstPageRows);
        assert.strictEqual(res.conversations[0].id, GEMINI_LIST_CAPTURE.first.id);
    } finally {
        if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
        else delete (global as any).fetch;
    }
});

// 3. GeminiAPIClient AbortSignal handling
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
});

__suiteDescribe("client_cancellation", () => {
useIndexStorage();
for (const operation of ['list', 'detail'] as const) for (const signalSource of ['call', 'client'] as const) {
    test__s2(`${operation}: cancellation during actual HTTP 429 backoff propagates AbortError (${signalSource} signal)`, async () => {
        const originalFetch = globalThis.fetch, originalRetry = retryPolicy.handleHttp429;
        const controller = new AbortController();
        let requests = 0, backoffs = 0;
        globalThis.fetch = async () => { requests++; return new Response('rate limited', { status: 429, headers: { 'retry-after': '30' } }); };
        retryPolicy.handleHttp429 = async params => {
            backoffs++;
            const waiting = originalRetry(params);
            queueMicrotask(() => controller.abort());
            return waiting;
        };
        try {
            const client = new GeminiAPIClient(signalSource === 'client' ? { signal: controller.signal } : {});
            const opts = signalSource === 'call' ? { signal: controller.signal } : undefined;
            await assert.rejects(operation === 'list' ? client.getConversationList(null, 'u0', undefined, opts)
                : client.fetchConversationPage('source_chat_123', null, 'u0', opts), { name: 'AbortError' });
            assert.equal(requests, 1); assert.equal(backoffs, 1);
        } finally { globalThis.fetch = originalFetch; retryPolicy.handleHttp429 = originalRetry; }
    });
}
test__s2('exhausted 429 retries remain an ordinary source failure', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response('rate limited', { status: 429 });
    try { await assert.rejects(new GeminiAPIClient().getConversationList(null, 'u0', undefined, { maxRetries: 0 }), error => error instanceof Error && error.name !== 'AbortError' && /429/.test(error.message)); }
    finally { globalThis.fetch = original; }
});
});

__suiteDescribe("provider_adapter", () => {
useIndexStorage();

test__s3('missing document bodies report unavailable locators without requiring an account route', async () => {
    let routes = 0;
    const provider = new GeminiProvider(undefined, async () => { routes++; throw new Error('No source tab'); });
    const key = { accountId: ACCOUNT_UUID, conversationId: 'missing-document' };
    const asset = { id: 'report', kind: 'file' as const, name: 'Research report', document: { id: 'native-report' } };
    for (const sourceUri of [undefined, 'http://immersive_entry_chip/report']) {
        const result = await attemptResource(asset.id, () => provider.acquireResource(key, { ...asset, sourceUri }));
        assert.ok(!result.ok);
        assert.equal(result.code, 'RESOURCE_LOCATOR_UNAVAILABLE');
        assert.equal(result.httpStatus, undefined, 'absence of a locator does not prove a server 404');
        assert.equal(resourceFailureText(result, 'zh'), '缺少可用的附件下载地址');
    }
    assert.equal(routes, 0);
    const owned = { ...asset, document: { id: asset.document.id, contentMarkdown: '# Real owned body\n\nExact bytes.' } };
    assert.equal(new TextDecoder().decode((await provider.acquireResource(key, owned)).bytes), owned.document.contentMarkdown);
    assert.equal(routes, 0);
    await assert.rejects(provider.acquireResource(key, { ...asset, sourceUri: 'https://example.test/report' }), /No source tab/);
    assert.equal(routes, 1, 'authenticated remote resources retain route verification');
});

test__s3('adapter: prefixed request IDs use the canonical source ID for admission and task resources', async () => {
    const raw = geminiDetailGen('G_PROVIDER_ADAPTER_01');
    const parsed = parseGeminiRpcConversation(raw, { providerId: 'gemini', targetConvId: 'c_prefixed_detail' });
    assert.equal(parsed.conversationId, 'prefixed_detail');
    assert.equal(parsed.conversation.detail.assets.length, 1);
    const resources = createSourceResourceContext();
    let requestedId = '';
    const provider = new GeminiProvider({
        async getConversationList() { throw new Error('unexpected list request'); },
        async getConversationDetail(id) { requestedId = id; return parsed; },
    }, async () => 'u0', resources);
    try {
        assert.equal(await provider.fetchConversationDetail(ACCOUNT_UUID, 'c_prefixed_detail'), undefined);
        assert.equal(requestedId, 'c_prefixed_detail');
        const key = { accountId: ACCOUNT_UUID, conversationId: 'prefixed_detail' };
        const detail = await getDetail(key); assert.ok(detail);
        assert.deepEqual(detail.key, key);
        assert.deepEqual(detail.messages, parsed.conversation.detail.messages);
        assert.deepEqual((await getConversations(ACCOUNT_UUID)).map(index => index.key.conversationId), ['prefixed_detail']);
        assert.equal(await getDetail({ ...key, conversationId: 'c_prefixed_detail' }), null);
        const asset = detail.assets[0];
        assert.deepEqual((await provider.acquireResource(key, asset)).bytes, Uint8Array.of(1, 2, 3));
        await assert.rejects(resources.acquire({ ...key, conversationId: 'c_prefixed_detail' }, { id: asset.id, kind: asset.kind }), /locator/);
    } finally { resources.release(); }
});

test__s3('adapter submits source Detail and returns completion without a Domain/transport payload', async () => {
    const parsed = parseGeminiRpcConversation(geminiRpcPacket('detail').responseBody, { providerId: 'gemini' });
    parsed.transport.decodedPayload = { source: 'wire' };
    const before = structuredClone(parsed);
    let request: unknown;
    const provider = new GeminiProvider({ getConversationList: async () => sourceList('G_SOURCE_EMPTY_01'),
        getConversationDetail: async (...args) => { request = args; return parsed; } }, async () => 'u1');
    const controller = new AbortController();
    assert.equal(await provider.fetchConversationDetail(ACCOUNT_UUID, parsed.conversationId, controller.signal), undefined);
    assert.equal((request as unknown[])[1], 'u1');
    assert.equal((request as unknown[])[3], controller.signal);
    assert.deepEqual(parsed, before);
    const stored = await getDetail({ accountId: ACCOUNT_UUID, conversationId: parsed.conversationId });
    assert.ok(stored); assert.equal(stored.messages.length, GEMINI_DETAIL_CAPTURE.messages);
    assert.equal(Reflect.get(stored, 'transport'), undefined);
    assert.equal((await getConversations(OTHER_ACCOUNT_UUID)).length, 0);
});
test__s3('adapter commits a natural empty terminal before callback and exposes no aggregate fields', async () => {
    const provider = new GeminiProvider({ getConversationList: async () => sourceList('G_SOURCE_EMPTY_01'), getConversationDetail: async () => sourceDetail() }, async () => 'u0');
    let progress: unknown;
    assert.equal(await provider.listConversations({ accountId: ACCOUNT_UUID, streamId: 'recent', onPageCommitted: async info => { progress = info; return false; } }), 'source_end');
    assert.deepEqual(Object.keys(progress as object).sort(), ['indexChanges', 'page', 'scanHead', 'totalObserved']);
});
test__s3('adapter readiness is account-bound and reports credential failures without manufacturing account names', async () => {
    const original = credentials.resolveCred;
    try {
        const provider = new GeminiProvider(undefined, async () => 'u0');
        credentials.resolveCred = async () => { throw new Error('credential failure'); };
        assert.deepEqual(await provider.checkReadiness(ACCOUNT_UUID), { ready: false, error: 'credential failure' });
        credentials.resolveCred = async () => { throw 'unknown failure'; };
        assert.deepEqual(await provider.checkReadiness(ACCOUNT_UUID), { ready: false, error: 'Gemini unavailable' });
        assert.equal((await provider.checkReadiness('u0')).ready, false);
    } finally { credentials.resolveCred = original; }
});
});

__suiteDescribe("provider_neutral", () => {
useIndexStorage();

test__s4('neutral listing returns ListEnd and callbacks contain committed progress only', async () => {
    const pages = [sourceList('G_SOURCE_ONE_MORE_01'), sourceList('G_SOURCE_TWO_01')];
    const provider = new GeminiProvider({ getConversationList: async () => pages.shift()!, getConversationDetail: async () => sourceDetail() }, async () => 'u0');
    const seen: CommittedListPage[] = [];
    const result = await provider.listConversations({ accountId: ACCOUNT_UUID, streamId: 'recent', onPageCommitted: async info => {
        seen.push(info); assert.equal((await getConversations(ACCOUNT_UUID)).length, info.totalObserved); return false;
    } });
    assert.equal(result, 'source_end'); assert.deepEqual(seen.map(p => p.totalObserved), [1, 2]);
    assert.equal('items' in seen[0], false); assert.equal('nextCursor' in seen[0], false);
});
test__s4('neutral Detail has explicit Account/Conversation and routes internally', async () => {
    const routed: string[] = [];
    const provider = new GeminiProvider({ getConversationList: async () => sourceList('G_SOURCE_EMPTY_01'), getConversationDetail: async (id, slot, account) => {
        assert.equal(account?.id, ACCOUNT_UUID); routed.push(slot!); return sourceDetail({ id });
    } }, async accountId => { assert.equal(accountId, ACCOUNT_UUID); return 'u3'; });
    assert.equal(await provider.fetchConversationDetail(ACCOUNT_UUID, 'conversation9'), undefined);
    assert.deepEqual(routed, ['u3']);
});
test__s4('neutral callback requests stop using a boolean after admission', async () => {
    let calls = 0;
    const provider = new GeminiProvider({ getConversationList: async () => { calls++; return sourceList('G_SOURCE_ONE_MORE_01'); }, getConversationDetail: async () => sourceDetail() }, async () => 'u0');
    assert.equal(await provider.listConversations({ accountId: ACCOUNT_UUID, streamId: 'recent', onPageCommitted: async () => true }), 'stopped');
    assert.equal(calls, 1); assert.equal((await getConversations(ACCOUNT_UUID)).length, 1);
});
});

__suiteDescribe("list-source-boundary", () => {
useIndexStorage();

















test__s5('ChatGPT lists emit exact Domain indexes with source times and no invented fallback facts', () => {
    const page = parseChatGPTList(chatgptListGen('C_LIST_SOURCE_BOUNDARY_01'));
    assert.deepEqual(page.conversations[0], { id: 'api-chat', title: 'Source title',
        titleSource: 'provider', createdAt: 1700000000125, updatedAt: 1700000060000 });
    const empty = page.conversations[1];
    assert.equal(empty.title, undefined);
    assert.equal(empty.titleSource, undefined);
    assert.equal(Object.hasOwn(empty, 'updatedAt'), false);
    assert.equal(Object.hasOwn(empty, 'createdAt'), false);
    assert.equal(page.conversations[2].createdAt, 1700000000123);
    assert.equal(Object.hasOwn(page.conversations[2], 'updatedAt'), false);
    for (const index of page.conversations) assert.equal(Object.hasOwn(index, 'key'), false);
    assert.equal(page.total, 3);
    assert.equal(page.nextCursor, 'next');
});

test__s5('malformed ChatGPT pages cannot masquerade as empty exhausted history', async () => {
    for (const key of ['C_LIST_SOURCE_BOUNDARY_02_0', 'C_LIST_SOURCE_BOUNDARY_02_1', 'C_LIST_SOURCE_BOUNDARY_02_2', 'C_LIST_SOURCE_BOUNDARY_02_3', 'C_LIST_SOURCE_BOUNDARY_02_4', 'C_LIST_SOURCE_BOUNDARY_02_5'] as const) {
        const value = chatgptListGen(key);
        assert.throws(() => parseChatGPTList(value), TypeError);
    }
    const account = await getOrCreateAccount('chatgpt', 'default');
    let progress = 0;
    const provider = new ChatGPTProvider({ fetchFn: async url => new Response(JSON.stringify(
        url.includes('/api/auth/session') ? chatgptSessionGen('C_LIST_SOURCE_BOUNDARY_03') : chatgptListGen('C_LIST_SOURCE_BOUNDARY_04')
    )) });
    await assert.rejects(provider.listConversations({ accountId: account.id, streamId: 'recent', onPageCommitted: async () => { progress++; return false; } }), TypeError);
    assert.equal(progress, 0);
});

test__s5('provider commits indexes before progress and exposes control facts only', async () => {
    const provider = new ChatGPTProvider({ fetchFn: async url => new Response(JSON.stringify(
        url.includes('/api/auth/session') ? chatgptSessionGen('C_LIST_SOURCE_BOUNDARY_05')
            : chatgptListGen('C_LIST_SOURCE_BOUNDARY_06')
    )) });
    const account = await getOrCreateAccount('chatgpt', JSON.stringify(['u-index', 'w-index']));
    let observed: unknown;
    const result = await provider.listConversations({ accountId: account.id, streamId: 'recent', onPageCommitted: async info => {
        observed = info; assert.equal((await getConversations(account.id)).length, 1); return false;
    } });
    assert.equal(result, 'source_end');
    assert.equal((observed as { page: number; totalObserved: number }).page, 1);
    assert.equal((observed as { page: number; totalObserved: number }).totalObserved, 1);
    assert.deepEqual((observed as { scanHead: { keys: unknown[] } }).scanHead.keys, [{ id: 'listed', time: 1700000060000 }]);

});

test__s5('Gemini observations and pagination consume parsed evidence without reading decoded payloads', async () => {
    const parsed = parseList(geminiListGen('G_LIST_SOURCE_BOUNDARY_07'));
    Object.defineProperty(parsed, '_raw', { get() { throw new Error('downstream interpreted raw source'); } });
    const observation = geminiListObservation(parsed, { streamId: 'recent', requestCursor: null }, 'account');
    assert.equal(observation.valid, true);
    assert.equal(observation.ordered, true);
    assert.deepEqual(observation.keys, [{ id: 'boundary123', time: 1700000060000 }]);
    const provider = new GeminiProvider({ getConversationList: async () => parsed, getConversationDetail: async () => sourceDetail() }, async () => 'u0');
    assert.equal(await provider.listConversations({ accountId: ACCOUNT_UUID, streamId: 'recent' }), 'source_end');
    assert.equal((await getConversations(ACCOUNT_UUID))[0].updatedAt, 1700000060000);
});

test__s5('Gemini parser rejects incomplete row coverage and unknown layouts as exhaustion evidence', () => {
    for (const key of ['G_LIST_SOURCE_BOUNDARY_08_0', 'G_LIST_SOURCE_BOUNDARY_08_1', 'G_LIST_SOURCE_BOUNDARY_08_2', 'G_LIST_SOURCE_BOUNDARY_08_3'] as const) {
        const source = geminiListGen(key);
        const page = parseList(source);
        assert.equal(page.pageEvidence.valid, false, source);
        assert.equal(page.pageEvidence.ordered, false);
    }
});

test__s5('an empty Gemini continuation page preserves its cursor instead of claiming exhaustion', () => {
    const parsed = parseList(geminiListGen('G_LIST_SOURCE_BOUNDARY_09'));
    assert.equal(parsed.pageEvidence.valid, true);
    assert.equal(parsed.nextPageToken, 'tC_cursor');
    assert.deepEqual(parsed.conversations, []);
});

test__s5('Gemini list requires an explicit natural-terminal cursor, not an unrecognized slot', () => {
    const explicit = parseList(geminiListGen('G_LIST_SOURCE_BOUNDARY_10_EXPLICIT'));
    const ambiguous = parseList(geminiListGen('G_LIST_SOURCE_BOUNDARY_10_AMBIGUOUS'));
    assert.equal(explicit.pageEvidence.valid, true);
    assert.equal(ambiguous.nextPageToken, null);
    assert.equal(ambiguous.pageEvidence.valid, false);
    assert.equal(ambiguous.pageEvidence.ordered, false);
});

test__s5('DOM metadata preserves title precedence and keeps UI labels and observation clocks out of Domain', () => {
    const { header, doc } = domListGen('G_LIST_SOURCE_BOUNDARY_11');
    const index = parseGeminiDomIndex(doc, 'boundary123');
    assert.equal(index.title, 'Header title');
    assert.equal(index.titleSource, 'dom');
    assert.equal(Reflect.get(index, 'cloudAvailability'), undefined);
    assert.equal(Object.hasOwn(index, 'key'), false);
    header.textContent = 'Google Gemini';
    const fallback = parseGeminiDomIndex(doc, 'boundary123');
    assert.equal(fallback.title, 'First user question');
    assert.equal(fallback.titleSource, 'sniff');
    assert.equal(Object.hasOwn(fallback, 'updatedAt'), false);
    assert.equal(Object.hasOwn(fallback, 'createdAt'), false);
});

test__s5('Claude readiness narrows unknown organization members before matching the account', async () => {
    const account = await getOrCreateAccount('claude', '11111111-1111-4111-8111-111111111111');
    const matching = new ClaudeProvider({ apiGet: async path => {
        assert.equal(path, '/api/organizations');
        return claudeOrganizationsGen('CL_ACCOUNT_MIXED_ROWS_01');
    } });
    assert.equal((await matching.checkReadiness(account.id)).ready, true);
    const wrongShape = new ClaudeProvider({ apiGet: async () =>
        claudeOrganizationsGen('CL_ACCOUNT_INVALID_ENVELOPE_01') });
    assert.equal((await wrongShape.checkReadiness(account.id)).ready, false);
});

test__s5('Claude rejects malformed search_incomplete before trusting a list page', async () => {
    const account = await getOrCreateAccount('claude', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    for (const key of ['CL_LIST_BOUNDARY_BAD_SEARCH_STRING_01',
        'CL_LIST_BOUNDARY_BAD_SEARCH_NUMBER_01', 'CL_LIST_BOUNDARY_BAD_SEARCH_NULL_01'] as const) {
        let committed = 0;
        const provider = new ClaudeProvider({ apiGet: async () => claudeListGen(key) });
        await assert.rejects(provider.listConversations({ accountId: account.id, streamId: 'recent',
            onPageCommitted: async () => { committed++; return false; } }), /Invalid Claude paginated list/);
        assert.equal(committed, 0, key);
        assert.deepEqual(await getConversations(account.id), [], key);
    }
    const withoutFlag = new ClaudeProvider({ apiGet: async () => claudeListGen('CL_LIST_BOUNDARY_SEARCH_ABSENT_01') });
    assert.equal(await withoutFlag.listConversations({ accountId: account.id, streamId: 'recent' }), 'source_end');
});

test__s5('Claude provider refuses malformed stored organization and conversation UUIDs before making API calls', async () => {
    const valid = await getOrCreateAccount('claude', '11111111-1111-4111-8111-111111111111');
    const malformed = await getOrCreateAccount('claude', '-'.repeat(36));
    const calls: string[] = [];
    const provider = new ClaudeProvider({ apiGet: async path => {
        calls.push(path);
        throw new Error('Unexpected source read');
    } });
    await assert.rejects(provider.listConversations({ accountId: malformed.id, streamId: 'recent' }), /Claude account mismatch/);
    await assert.rejects(provider.fetchConversationDetail(valid.id, '-'.repeat(36)), /Invalid Claude conversation UUID/);
    assert.deepEqual(calls, []);
});

test__s5('Claude paginated source proves exhaustion and rejects unordered or truncated pages', async () => {
    const account = await getOrCreateAccount('claude', '11111111-1111-4111-8111-111111111111');
    const paths: string[] = [];
    const provider = new ClaudeProvider({ apiGet: async path => {
        paths.push(path);
        return claudeListGen('CL_LIST_BOUNDARY_VALID_01');
    } });
    let head: unknown;
    assert.equal(await provider.listConversations({ accountId: account.id, streamId: 'recent',
        onPageCommitted: async info => { head = info.scanHead; return false; } }), 'source_end');
    assert.equal(paths.length, 1);
    assert.ok(paths[0].endsWith('chat_conversations_v2?limit=100&offset=0&consistency=strong'));
    assert.equal((head as { nextCursor: unknown }).nextCursor, null);
    for (const key of [
        'CL_LIST_BOUNDARY_REVERSED_01',
        'CL_LIST_BOUNDARY_TRUNCATED_01',
        'CL_LIST_BOUNDARY_INCOMPLETE_01',
        'CL_LIST_BOUNDARY_MISSING_FLAG_01',
    ] as const) {
        await assert.rejects(new ClaudeProvider({ apiGet: async () => claudeListGen(key) }).listConversations({
            accountId: account.id, streamId: 'recent' }), /Claude/);
    }
});
});

__suiteDescribe("rpc_list_ingest", () => {
const text = geminiListPage().responseBody;
const items = () => parseList(text).conversations.map(item => parseGeminiIndexObservation(item,'rpc-list'));
const capture = (): MessageEvent => ({origin:location.origin,source:window,data:{type:'GEMINI_NETWORK_BATCHEXECUTE',payload:{
    text,slot:'u2',requestAccountObservation:ACCOUNT_OBSERVATION,truncated:false,requestedAt:1,
    url:'https://gemini.google.com/_/BardChatUi/data/batchexecute',listRequest:{streamId:'recent',requestCursor:null}
}}}) as unknown as MessageEvent;

test__s6('RPC bridge and active L2 admission persist identical current Index facts',async()=>{
    const env=indexStorage(),runtime=accountRuntime('u2');
    try {
        init(); await handleWindowMessage(capture());
        const passive=await listIndexes(ACCOUNT_UUID);
        assert.equal(passive.length,GEMINI_LIST_CAPTURE.firstPageRows);
        assert.equal(passive[0].title,GEMINI_LIST_CAPTURE.first.title); assert.equal(passive[0].updatedAt,GEMINI_LIST_CAPTURE.first.updatedAt);
        assert.equal(passive[0].titleSource,'provider');
        await ingestIndexes(ACCOUNT_UUID,items());
        assert.deepEqual(await listIndexes(ACCOUNT_UUID),passive);
        assert.deepEqual(Object.keys(passive[0]).sort(),['key','title','titleSource','updatedAt']);
    } finally {runtime.restore();env.restore();}
});
test__s6('confirmed deletion leaves no tombstone; fresh source observation may recreate the Index',async()=>{
    const env=indexStorage();
    try {
        await ingestIndexes(ACCOUNT_UUID,items()); await ingestDeletedConversation(ACCOUNT_UUID,GEMINI_LIST_CAPTURE.first.id);
        assert.equal(await getIndex({accountId:ACCOUNT_UUID,conversationId:GEMINI_LIST_CAPTURE.first.id}),null);
        await ingestIndexes(ACCOUNT_UUID,items());
        assert.equal((await listIndexes(ACCOUNT_UUID))[0].title,GEMINI_LIST_CAPTURE.first.title);
        assert.deepEqual(env.local,{});
    } finally {env.restore();}
});
test__s6('active and passive admissions propagate failed commits and retry through the same L2 owner',async()=>{
    const env=indexStorage(),runtime=accountRuntime('u2');
    try {
        init();env.fail('indexes');
        await assert.rejects(ingestIndexes(ACCOUNT_UUID,items()),/write failed/);
        await assert.rejects(handleWindowMessage(capture()),/write failed/);
        assert.deepEqual(await listIndexes(ACCOUNT_UUID),[]);
        env.fail();await handleWindowMessage(capture());
        assert.equal((await listIndexes(ACCOUNT_UUID)).length,GEMINI_LIST_CAPTURE.firstPageRows);
    } finally {runtime.restore();env.restore();}
});
test__s6('duplicate and unchanged Index admissions use the atomic merge without retired receipts',async()=>{
    const env=indexStorage();
    try {
        assert.deepEqual(await ingestIndexes(ACCOUNT_UUID,[...items(),...items()]),
            {added:GEMINI_LIST_CAPTURE.firstPageRows,updated:0,accepted:GEMINI_LIST_CAPTURE.firstPageRows*2,rejected:0});
        const writes=env.writes();
        assert.deepEqual(await ingestIndexes(ACCOUNT_UUID,items()),{added:0,updated:0,accepted:GEMINI_LIST_CAPTURE.firstPageRows,rejected:0});
        assert.equal(env.writes(),writes);assert.equal((await listIndexes(ACCOUNT_UUID)).length,GEMINI_LIST_CAPTURE.firstPageRows);
    } finally {env.restore();}
});
});

__suiteDescribe("observed_page_ingest", () => {
const text = geminiListPage().responseBody;
const request = { streamId: 'recent' as const, requestCursor: null };
const parsed = parseList(text);
const capture = (extra = {}): MessageEvent => ({ origin: location.origin, source: window,
    data: { type: 'GEMINI_NETWORK_BATCHEXECUTE', payload: { text, slot: 'u0', listRequest: request,
        url: 'https://gemini.google.com/_/BardChatUi/data/batchexecute', truncated: false,
        requestedAt: 100, requestAccountObservation: ACCOUNT_OBSERVATION, ...extra } } }) as unknown as MessageEvent;

test__s7('active and passive list admissions preserve the same Index facts without inventing a partial boundary', async () => {
    const outcomes: unknown[] = [];
    for (const active of [true, false]) {
        const storage = indexStorage(), runtime = accountRuntime();
        try {
            if (active) await ingestIndexes(ACCOUNT_UUID, parsed.conversations.map(item => parseGeminiIndexObservation(item, 'rpc-list')),
                geminiListObservation(parsed, request, ACCOUNT_UUID, false, 100));
            else { init(); await handleWindowMessage(capture()); }
            assert.deepEqual(await getCoverage(ACCOUNT_UUID, 'recent'), { range: null });
            const indexes = await listIndexes(ACCOUNT_UUID); assert.equal(indexes.length, GEMINI_LIST_CAPTURE.firstPageRows); outcomes.push(indexes);
        } finally { runtime.restore(); storage.restore(); }
    }
    assert.deepEqual(outcomes[0], outcomes[1]);
});

test__s7('failed Index commit prevents passive Coverage admission and rejects the operation', async () => {
    const storage = indexStorage(), runtime = accountRuntime();
    try {
        init(); storage.fail('indexes');
        await assert.rejects(handleWindowMessage(capture()), /write failed/);
        assert.equal(await getCoverage(ACCOUNT_UUID, 'recent'), null);
        storage.fail(); await handleWindowMessage(capture());
        assert.equal((await listIndexes(ACCOUNT_UUID)).length, GEMINI_LIST_CAPTURE.firstPageRows);
        assert.deepEqual(await getCoverage(ACCOUNT_UUID, 'recent'), { range: null });
    } finally { runtime.restore(); storage.restore(); }
});

test__s7('uncertain identity and truncated captures cannot certify the identified account boundary', async () => {
    const storage = indexStorage(), runtime = accountRuntime();
    try {
        init();
        await handleWindowMessage(capture({ requestAccountObservation: null }));
        assert.equal(await getCoverage(ACCOUNT_UUID, 'recent'), null);
        await handleWindowMessage(capture({ truncated: true }));
        assert.equal((await getCoverage(ACCOUNT_UUID, 'recent'))?.range ?? null, null);
        // Passive capture is independent of Application cancellation; it never owns a ScanRun.
        assert.equal((await listIndexes(ACCOUNT_UUID)).length, GEMINI_LIST_CAPTURE.firstPageRows);
    } finally { runtime.restore(); storage.restore(); }
});
});

__suiteDescribe("sniff_watermark_isolation", () => {
/** Trusted passive pages can advance Coverage; uncorrelated facts cannot. */







function capture(key: Parameters<typeof geminiListGen>[0], correlated: boolean): MessageEvent {
    return { origin: location.origin, source: window, data: { type: 'GEMINI_NETWORK_BATCHEXECUTE', payload: {
        text: geminiListGen(key), slot: 'u0', requestAccountObservation: ACCOUNT_OBSERVATION, requestedAt: Date.now(),
        truncated: false, url: 'https://gemini.google.com/_/BardChatUi/data/batchexecute',
        ...(correlated ? { listRequest: { streamId: 'recent', requestCursor: null } } : {}),
    } } } as unknown as MessageEvent;
}
test__s8('repeated uncorrelated captures preserve authoritative timestamps without establishing Coverage', async () => {
    const storage = indexStorage(), runtime = accountRuntime();
    try {
        init();
        for (const key of ['G_DYNAMIC_WATERMARK_LIST_01', 'G_DYNAMIC_WATERMARK_LIST_02',
            'G_DYNAMIC_WATERMARK_LIST_01'] as const) await handleWindowMessage(capture(key, false));
        const indexes = await listIndexes(ACCOUNT_UUID);
        assert.equal(indexes.length, 1); assert.equal(indexes[0].updatedAt, 1700000000000);
        assert.equal(await getCoverage(ACCOUNT_UUID, 'recent'), null);
        assert.equal(Object.hasOwn(indexes[0], 'cloudAvailability'), false);
        await handleWindowMessage(capture('G_DYNAMIC_WATERMARK_LIST_01', true));
        assert.deepEqual((await getCoverage(ACCOUNT_UUID, 'recent'))?.range, {
            head: { id: 'abcdef123', time: 1700000000000 }, tail: { id: 'abcdef123', time: 1700000000000 }
        });
    } finally { runtime.restore(); storage.restore(); }
});
});

__suiteDescribe("index-source-boundary", () => {
test__s9('historical aliases cannot become current Gemini metadata or cloud evidence', () => {
    const raw = { id: 'c_boundary123', title: 'Current title', titleSource: 'dom',
        titles: { rpc: 'Historical authoritative title', takeout: 'Historical offline title' },
        timestamp: '1700000000', chatTime: 1700000010000, lastSeen: 1900000000000,
        href: 'https://example.com/historical', source: 'takeout-import', isTakeoutOnly: true,
        cloudAvailability: 'available', messageCount: 6 };

    const current = parseGeminiIndexObservation(raw, 'dom').fields;
    assert.equal(current.title, 'Current title');
    assert.equal(current.titleSource, 'provider');
    assert.equal(current.updatedAt, undefined);
    assert.equal(Reflect.get(current ?? {}, 'url'), undefined);
    assert.equal(Reflect.get(current ?? {}, 'hasTakeoutImport'), undefined);
    assert.equal(Reflect.get(current ?? {}, 'cloudAvailability'), undefined);
    assert.equal(Reflect.get(current ?? {}, 'messageCount'), undefined);
    assert.equal(Reflect.get(parseGeminiIndexObservation(raw, 'rpc-list').fields ?? {}, 'messageCount'), undefined);
});

test__s9('current metadata treats numeric strings as milliseconds without historical seconds inference', () => {
    const raw = { id: 'time-boundary', title: 'Title', updatedAt: '1700000000', createdAt: '1700000000' };
    const current = parseGeminiIndexObservation(raw, 'dom').fields;
    assert.equal(current.updatedAt, 1700000000);
    assert.equal(current.createdAt, 1700000000);
    assert.throws(() => parseGeminiIndexObservation({ id: 123 }, 'dom'), TypeError);
});
});

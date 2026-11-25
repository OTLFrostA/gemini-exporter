import { describe as __suiteDescribe } from 'node:test';
import { parseGeminiRpcConversation } from "../src/l1/parsers/gemini/rpc/parseConversation.js";
import { ConfirmedSourceEmptyError } from "../src/l1/client/sourceErrors.js";
import test from "node:test";
import assert from "node:assert/strict";
import { useIndexStorage } from "./helpers/indexStorage.js";
import { ACCOUNT_UUID } from "./helpers/accountRuntime.js";
import { sourceDetail } from "./helpers/l1SourceFixture.js";
import { sourceList } from "./helpers/l1SourceFixture.js";
import { sourceMessage } from "./helpers/l1SourceFixture.js";
import { GeminiProvider } from "../src/l1/client/gemini/geminiProvider.js";
import { getConversationDetail } from "../src/l1/client/gemini/api/pagination.js";
import { type GeminiPaginationDetailClient } from "../src/l1/client/gemini/api/pagination.js";
import { type GeminiRpcParseResult } from "../src/l1/parsers/gemini/rpc/parseConversation.js";
import { type ListParseResult } from "../src/l1/parsers/gemini/rpc/parseList.js";
import { listIndexes as getConversations } from "../src/l3a/storageService.js";
import { getCoverage } from "../src/l2/coverageAdmission.js";
import { detailGen as geminiDetailGen } from "./fixtures/providers/geminiDetail.js";
import { geminiRpcPacket } from "./fixtures/providers/geminiRpcCapture.js";
import { parseList } from "../src/l1/parsers/gemini/rpc/parseList.js";
import { observeDomainChanges } from "../src/runtime/api/domainChanges.js";
import { indexStorage } from "./helpers/indexStorage.js";
import { defaultGeminiProvider } from "../src/l1/client/gemini/geminiProvider.js";
import { ProviderRegistry } from "../src/l1/client/providerRegistry.js";
import { scanAll } from "../src/application/sync/scanController.js";
import { listGen as geminiListGen } from "./fixtures/providers/gemini.js";
import { getCoverage as getCoverage__s4 } from "../src/l3a/storageService.js";
import { accountRuntime } from "./helpers/accountRuntime.js";
import { startSync } from "../src/ui/options/controllers/syncController.js";
import assert__s5 from "node:assert";
import { type ActiveClientContract } from "../src/runtime/content/contentContext.js";
import { ContentContext } from "../src/runtime/content/contentContext.js";
import { contentContext } from "../src/runtime/content/contentContext.js";
import { runCleanups } from "../src/runtime/content/cleanupRegistry.js";
import { init as initMessageRouter } from "../src/runtime/content/messageRouter.js";
import { ACCOUNT_OBSERVATION } from "./helpers/accountRuntime.js";
import { ingestIndexes } from "../src/l2/ingestion.js";
import { listIndexes } from "../src/l3a/storageService.js";
import { init } from "../src/l1/sniffer/gemini/messageBridge.js";
import { handleWindowMessage } from "../src/l1/sniffer/gemini/messageBridge.js";
import { test as test__s7 } from "node:test";
import { geminiListObservation } from "../src/l1/client/gemini/listObservation.js";
import { type GeminiProviderClient } from "../src/l1/client/gemini/geminiContracts.js";
import { type ScanProgress } from "../src/application/sync/scanController.js";
import { getCoverage as getCoverage__s8 } from "../src/l3a/storageService.js";
import { putExportRecord } from "../src/l3a/storageService.js";
import { getExportRecord } from "../src/l3a/storageService.js";
import { bindTabAccounts } from "./helpers/tabAccounts.js";
import assert__s9 from "node:assert";
import * as TabService from "../src/runtime/capabilities/tabService.js";
import { readClaudeSource } from "../src/l1/client/claude/claudeSource.js";
import { readClaudeFile } from "../src/l1/client/claude/fileAssets.js";
import { readGrokSource } from "../src/l1/client/grok/grokSource.js";

__suiteDescribe("pagination_contract", () => {
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
    assert.equal(await listProvider([sourceList(ids.length ? 'G_SOURCE_ONE_01' : 'G_SOURCE_EMPTY_01')]).listConversations(options), 'source_end');
    assert.equal((await getConversations(ACCOUNT_UUID)).length, ids.length);
    if (ids.length) assert.ok((await getCoverage(ACCOUNT_UUID, 'recent'))?.range);
});
test('list: invalid populated page saves valid rows but throws and cannot certify coverage', async () => {
    const invalid = sourceList('G_SOURCE_TWO_01'); invalid.pageEvidence.valid = false;
    const progress: number[] = [];
    await assert.rejects(listProvider([sourceList('G_SOURCE_ONE_NEXT_01'), invalid]).listConversations({ ...options, onPageCommitted: async p => { progress.push(p.totalObserved); return false; } }), /Unverified Gemini list page/);
    assert.deepEqual((await getConversations(ACCOUNT_UUID)).map(i => i.key.conversationId).sort(), ['one', 'two']);
    assert.equal((await getCoverage(ACCOUNT_UUID, 'recent'))?.range, null);
    assert.deepEqual(progress, [1, 2]);
});
test('list: loop and ordinary errors propagate after committed progress', async () => {
    for (const last of [sourceList('G_SOURCE_TWO_LOOP_01'), new Error('HTTP 429')]) {
        await assert.rejects(listProvider([sourceList('G_SOURCE_ONE_LOOP_01'), last]).listConversations(options), /loop|429/);
    }
});
test('list: safety budget is internal and reports max_pages without coverage', async () => {
    let pages = 0;
    const provider = new GeminiProvider({ getConversationList: async () => sourceList(`G_SOURCE_PAGINATION_BUDGET_PAGE_${++pages}`), getConversationDetail: async () => sourceDetail() }, async () => 'u0');
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
for (const retry of [false, true]) {
    const mode = retry ? 'metadata-only retry' : 'normal';
    function paginatedClient(count: number, terminal: 'end' | 'loop' | 'error' | 'abort' | 'budget', controller?: AbortController) {
        let calls = 0;
        const cursors: (string | null | undefined)[] = [];
        const client: GeminiPaginationDetailClient = { async fetchConversationPage(_id, cursor, _slot, opts) {
            cursors.push(cursor);
            if (retry && calls++ === 0) return sourceDetail({ messages: [], _raw: [null, null, [['c_source_chat_123']]] });
            assert.equal(opts?.altParams, retry ? true : undefined);
            const index = cursors.length - (retry ? 2 : 1);
            if (terminal === 'error' && index === count - 1) throw new Error('HTTP 429');
            if (terminal === 'abort' && index === count - 1) controller?.abort();
            return sourceDetail({ messages: [sourceMessage('m' + index)], nextPageToken: index === count - 1
                ? terminal === 'end' ? null : terminal === 'loop' ? 'next1' : 'next' + index
                : 'next' + index });
        } };
        return { client, cursors };
    }
    test(`Detail: ${mode} reads 25 pages through natural end without losing oldest messages`, async () => {
        const { client, cursors } = paginatedClient(25, 'end');
        const result = await getConversationDetail(client, 'source_chat_123');
        assert.equal(cursors.length, 25 + Number(retry));
        assert.deepEqual(result.conversation.detail.messages.map(m => m.id), Array.from({ length: 25 }, (_, i) => 'm' + (24 - i)));
        assert.equal(result.conversation.detail.quality.status, 'complete');
        assert.equal(result.transport.nextPageToken, null);
    });
    test(`Detail: ${mode} detects late token loops and preserves partial evidence`, async () => {
        const { client, cursors } = paginatedClient(25, 'loop');
        const result = await getConversationDetail(client, 'source_chat_123');
        assert.equal(cursors.length, 25 + Number(retry));
        assert.equal(result.conversation.detail.quality.status, 'partial');
        assert.equal(result.evidence?.truncation, 'token_loop');
    });
    test(`Detail: ${mode} propagates late errors and cancellation`, async () => {
        const { client } = paginatedClient(25, 'error');
        await assert.rejects(getConversationDetail(client, 'source_chat_123'), /429/);
        const controller = new AbortController();
        const aborted = paginatedClient(25, 'abort', controller);
        await assert.rejects(getConversationDetail(aborted.client, 'source_chat_123', 'u0', undefined, controller.signal), { name: 'AbortError' });
        assert.equal(aborted.cursors.length, 25 + Number(retry));
    });
    test(`Detail: ${mode} stops runaway unique tokens with explicit incomplete evidence`, async () => {
        const { client, cursors } = paginatedClient(2000, 'budget');
        const result = await getConversationDetail(client, 'source_chat_123');
        assert.equal(cursors.length, 2000 + Number(retry));
        assert.equal(result.conversation.detail.quality.status, 'partial');
        assert.equal(result.evidence?.truncation, 'max_turns_page_limit_2000');
        assert.ok(result.transport.nextPageToken);
    });
}
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
test('Detail: failed metadata-only retry rejects empty content rather than admitting it', async () => {
    const metadata = sourceDetail({ messages: [], _raw: [null, null, [['c_source_chat_123']]] });
    let calls = 0;
    await assert.rejects(
        getConversationDetail({ fetchConversationPage: async () => { if (calls++) throw new Error('no alternate'); return metadata; } }, 'source_chat_123'),
        /GEMINI_DETAIL_EMPTY_UNVERIFIED/,
    );
    assert.equal(calls, 2);
});

test('Detail: metadata-only retry returning another empty response still fails closed', async () => {
    const metadata = sourceDetail({ messages: [], _raw: [null, null, [['c_source_chat_123']]] });
    let calls = 0;
    await assert.rejects(
        getConversationDetail({ fetchConversationPage: async () => { calls++; return metadata; } }, 'source_chat_123'),
        /GEMINI_DETAIL_EMPTY_UNVERIFIED/,
    );
    assert.equal(calls, 2);
});

test('Detail: unrecognized empty response without affirmative empty-turn evidence fails closed', async () => {
    const unknown = sourceDetail({ messages: [], _raw: [null, 'unexpected', 'Title'] });
    let calls = 0;
    await assert.rejects(
        getConversationDetail({ fetchConversationPage: async () => { calls++; return unknown; } }, 'source_chat_123'),
        /GEMINI_DETAIL_EMPTY_UNVERIFIED/,
    );
    assert.equal(calls, 1);
});

test('Detail: verified blank native turns have a distinct empty-source outcome; schema drift remains an error', async () => {
    const page = parseGeminiRpcConversation(geminiDetailGen('G_PAGINATION_EMPTY_01'),
        { providerId: 'gemini', targetConvId: 'source_chat_123' });
    assert.equal(page.transport.bodyShape, 'confirmed_empty_turns');
    Object.defineProperty(page.transport, 'decodedPayload', {
        get() { throw new Error('Pagination must not read opaque audit payload'); },
    });
    await assert.rejects(getConversationDetail(detailClient([page]), 'source_chat_123'), ConfirmedSourceEmptyError);
    const drift = parseGeminiRpcConversation(geminiDetailGen('G_PAGINATION_EMPTY_01'), { providerId: 'gemini' });
    drift.diagnostics.push({ code: 'GEMINI_SCHEMA_DRIFT', severity: 'warning', message: 'Unknown field' });
    await assert.rejects(getConversationDetail(detailClient([drift]), 'source_chat_123'), /GEMINI_DETAIL_EMPTY_UNVERIFIED/);
    for (const [key, error] of [
        ['G_PAGINATION_EMPTY_FOREIGN', /identity/],
        ['G_PAGINATION_EMPTY_DOCUMENT', /GEMINI_DETAIL_EMPTY_UNVERIFIED/],
    ] as const) {
        const malformed = parseGeminiRpcConversation(geminiDetailGen(key), { providerId: 'gemini', targetConvId: 'source_chat_123' });
        await assert.rejects(getConversationDetail(detailClient([malformed]), 'source_chat_123'), error);
    }
});
});

__suiteDescribe("incr_scan_until_unchanged", () => {
useIndexStorage();
test('without a caller stop the Client commits all three pages and reports source_end', async () => {
    let calls = 0;
    const provider = new GeminiProvider({ getConversationList: async () => {
        const page = calls++;
        return sourceList(`G_SOURCE_150_PAGE_${page + 1}`);
    }, getConversationDetail: async () => sourceDetail() }, async () => 'u0');
    const counts: number[] = [];
    assert.equal(await provider.listConversations({ accountId: ACCOUNT_UUID, streamId: 'recent', onPageCommitted: async info => { counts.push(info.totalObserved); return false; } }), 'source_end');
    assert.equal(calls, 3); assert.deepEqual(counts, [50, 100, 150]);
    assert.equal((await getConversations(ACCOUNT_UUID)).length, 150);
});
});

__suiteDescribe("pagination_detail_dedupe", () => {
/**
 * W3: pagination.ts getConversationDetail message dedupe root-cause fix.
 * The old `seenMsgIds` bypass let any message whose id equals the conversation
 * id skip dedupe permanently, so a repeated page (token loop / re-fetch)
 * duplicated turns in the source data itself (markdown/JSON/HTML all affected).
 * Rule after fix: a stable non-empty message id is accepted exactly once,
 * regardless of whether it equals the conversation id; id-less messages are
 * still kept (no risky content hashing).
 *
 * 运行：node -r ./tests/ts_register.js --test tests/pagination_detail_dedupe.test.ts
 */

const test = require('node:test');
const assert = require('node:assert');

const Pagination = require('../src/l1/client/gemini/api/pagination.js');

function makeClient(pages: any[]): any {
    let calls = 0;
    return {
        fetchConversationPage: async (_cid: string, _token: string | null) => {
            const p = pages[Math.min(calls++, pages.length - 1)];
            return { conversationId: _cid.replace(/^c_/, ''),
                conversation: { index: { title: p.title, titleSource: 'provider' }, detail: {
                    quality: { status: 'unknown' }, assets: [], messages: p.messages.map((message: any) => ({
                        ...(message.id ? { id: message.id } : {}), role: message.role === 'model' ? 'assistant' : message.role || 'unknown',
                        content: message.content ? [{ type: 'paragraph', children: [{ type: 'text', text: message.content }] }] : []
                    })) } },
                resourceHints: {}, acquisitionHints: {}, diagnostics: [], transport: { nextPageToken: p.nextPageToken } };

        },
    };
}

test('W3-case1: message id equal to conversation id is deduped across pages (appears once)', async () => {
    const convId = 'c_det1';
    const client = makeClient([
        { messages: [{ id: convId, role: 'user', content: 'q' }, { id: 'rc_a', role: 'model', content: 'a' }], nextPageToken: 't1', title: 'T' },
        // Server repeats the same first-turn user message on page 2.
        { messages: [{ id: convId, role: 'user', content: 'q' }, { id: 'rc_b', role: 'model', content: 'b' }], nextPageToken: null, title: 'T' },
    ]);
    const res = await Pagination.getConversationDetail(client, convId);
    const ids = (res.conversation.detail.messages as any[]).map((m: any) => m.id);
    assert.deepStrictEqual(ids, ['rc_b', convId, 'rc_a'], `convId message leaked a duplicate: ${JSON.stringify(ids)}`);
});

test('W3-case2: ordinary repeated message ids appear exactly once', async () => {
    const client = makeClient([
        { messages: [{ id: 'm1' }, { id: 'm2' }], nextPageToken: 't1', title: 'T' },
        { messages: [{ id: 'm2' }, { id: 'm3' }], nextPageToken: null, title: 'T' },
    ]);
    const res = await Pagination.getConversationDetail(client, 'c_det2');
    const ids = (res.conversation.detail.messages as any[]).map((m: any) => m.id);
    assert.deepStrictEqual(ids, ['m3', 'm1', 'm2'], `duplicate message leaked: ${JSON.stringify(ids)}`);
});

test('W3-case3: id-less messages are kept, never content-deduped', async () => {
    const client = makeClient([
        { messages: [{ role: 'user', content: 'same text' }, { id: '', role: 'model', content: 'same text' }], nextPageToken: 't1', title: 'T' },
        { messages: [{ role: 'user', content: 'same text' }], nextPageToken: null, title: 'T' },
    ]);
    const res = await Pagination.getConversationDetail(client, 'c_det3');
    assert.strictEqual((res.conversation.detail.messages as any[]).length, 3, 'id-less messages must be preserved');
});
});

__suiteDescribe("pinned_scan", () => {
useIndexStorage();

test('each Client call acquires exactly its requested stream with independent cursors', async () => {
    const pages = [sourceList('G_SOURCE_SHARED_CURSOR_01'), sourceList('G_SOURCE_EMPTY_01'), sourceList('G_SOURCE_SHARED_CURSOR_01'), sourceList('G_SOURCE_RECENT_01')];
    const requests: unknown[] = [];
    const provider = new GeminiProvider({ getConversationList: async (cursor, _slot, filter) => { requests.push([cursor, filter]); return pages.shift()!; }, getConversationDetail: async () => sourceDetail() }, async () => 'u0');
    for (const streamId of ['pinned', 'recent']) assert.equal(await provider.listConversations({ accountId: ACCOUNT_UUID, streamId }), 'source_end');
    assert.deepEqual(requests, [[null, [1, null, 1]], ['tC_same_token_123456789', [1, null, 1]], [null, undefined], ['tC_same_token_123456789', undefined]]);
    assert.ok(await getCoverage(ACCOUNT_UUID, 'pinned'));
    assert.ok(await getCoverage(ACCOUNT_UUID, 'recent'));
});
test('recent acquisition never implicitly fetches pinned or establishes its coverage', async () => {
    const provider = new GeminiProvider({ getConversationList: async (_cursor, _slot, filter) => { assert.equal(filter, undefined); return sourceList('G_SOURCE_EMPTY_01'); }, getConversationDetail: async () => sourceDetail() }, async () => 'u0');
    assert.equal(await provider.listConversations({ accountId: ACCOUNT_UUID, streamId: 'recent' }), 'source_end');
    assert.equal(await getCoverage(ACCOUNT_UUID, 'pinned'), null);
});
test('unknown stream is rejected before network acquisition', async () => {
    const provider = new GeminiProvider({ getConversationList: async () => { assert.fail('unexpected request'); }, getConversationDetail: async () => sourceDetail() }, async () => 'u0');
    await assert.rejects(provider.listConversations({ accountId: ACCOUNT_UUID, streamId: 'all' }), /stream/);
});

test('real empty pinned response commits pinned coverage without recent coverage', async () => {
    const provider = new GeminiProvider({
        getConversationList: async (cursor, _slot, filter) => {
            assert.equal(cursor, null);
            assert.deepEqual(filter, [1, null, 1]);
            return parseList(geminiRpcPacket('pinned').responseBody);
        },
        getConversationDetail: async () => sourceDetail(),
    }, async () => 'u0');
    assert.equal(await provider.listConversations({ accountId: ACCOUNT_UUID, streamId: 'pinned' }), 'source_end');
    assert.ok(await getCoverage(ACCOUNT_UUID, 'pinned'));
    assert.equal(await getCoverage(ACCOUNT_UUID, 'recent'), null);
});
});

__suiteDescribe("verified_scan_overlap", () => {
test('production scan entry admits one pagination call per account and releases the lock on completion', async () => {
    const store = indexStorage();
    const original = ProviderRegistry.get('gemini');
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let calls = 0;
    let first: ReturnType<typeof scanAll> | undefined;
    const provider = Object.create(defaultGeminiProvider) as typeof defaultGeminiProvider;
    provider.listConversations = async () => { calls++; entered(); await gate; return 'source_end'; };
    ProviderRegistry.unregister('gemini');
    ProviderRegistry.register(provider);
    try {
        first = scanAll({ accountId: ACCOUNT_UUID });
        await started;
        assert.deepEqual(await scanAll({ accountId: ACCOUNT_UUID }), {
            status: 'error', reason: 'Scan already running', pagesFetched: 0, conversationsFetched: 0,
        });
        assert.equal(calls, 1);
        release();
        assert.equal((await first).status, 'complete');
        assert.equal((await scanAll({ accountId: ACCOUNT_UUID })).status, 'complete');
        assert.equal(calls, 2);
    } finally {
        release(); await first;
        ProviderRegistry.unregister('gemini');
        if (original) ProviderRegistry.register(original);
        store.restore();
    }
});

test('failed scan retains the bound parser diagnostics without establishing coverage', async () => {
    const store = indexStorage();
    const original = ProviderRegistry.get('gemini');
    const wire = geminiListGen('G_VERIFIED_SCAN_OVERLAP_01');
    const parsed = parseList(wire);
    const provider = new GeminiProvider({ getConversationList: async () => parsed,
        getConversationDetail: async () => sourceDetail() }, async () => 'u0');
    ProviderRegistry.unregister('gemini');
    ProviderRegistry.register(provider);
    try {
        const result = await scanAll({ accountId: ACCOUNT_UUID });
        assert.equal(result.status, 'error');
        assert.equal(result.reason, 'Gemini list failed: invalid_response');
        assert.equal(result.diagnostics?.page, 1);
        assert.equal(result.diagnostics?.requestCursor, null);
        assert.equal(result.diagnostics?.failure, 'invalid_response');
        assert.deepEqual(result.diagnostics?.details, parsed._debug);
        assert.equal((await getCoverage__s4(ACCOUNT_UUID, 'recent'))?.range ?? null, null);
    } finally {
        ProviderRegistry.unregister('gemini');
        if (original) ProviderRegistry.register(original);
        store.restore();
    }
});


test('active scan publishes committed pages without waiting for the view to refresh', async () => {
    const store = indexStorage();
    const original = ProviderRegistry.get('gemini');
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const notifications: string[] = [];
    let finishedViewReads = 0;
    const stop = observeDomainChanges(async id => { notifications.push(id); await gate; finishedViewReads++; });
    const provider = Object.create(defaultGeminiProvider) as typeof defaultGeminiProvider;
    provider.listConversations = async options => {
        await options.onPageCommitted?.({ page: 1, totalObserved: 50 });
        await options.onPageCommitted?.({ page: 2, totalObserved: 100 });
        return 'source_end';
    };
    ProviderRegistry.unregister('gemini'); ProviderRegistry.register(provider);
    try {
        const result = await scanAll({ accountId: ACCOUNT_UUID });
        assert.equal(result.status, 'complete');
        assert.equal(result.conversationsFetched, 100);
        assert.deepEqual(notifications, [ACCOUNT_UUID, ACCOUNT_UUID]);
        assert.equal(finishedViewReads, 0, 'view work must not block page fetching or scan completion');
        release(); await new Promise<void>(resolve => setTimeout(resolve, 0));
        assert.equal(finishedViewReads, 2);
    } finally {
        release(); stop(); ProviderRegistry.unregister('gemini');
        if (original) ProviderRegistry.register(original);
        store.restore();
    }
});
});

__suiteDescribe("active_client_contract", () => {
// 1. Compile-time regression:
// Prove that a valid ActiveClientContract WITHOUT abort() can be assigned
// to window.__gemExporterActiveClient and ContentContext without type error.
const clientWithoutAbort: ActiveClientContract = {};

const _compileTimeCheck = () => {
    window.__gemExporterActiveClient = clientWithoutAbort;
    window.__gemExporterActiveClient = null;
    window.__gemExporterActiveClient = undefined;
    const ctx = new ContentContext();
    ctx.setActiveClient(clientWithoutAbort);
    const retrieved: ActiveClientContract | null = ctx.getActiveClient();
    void retrieved;
};
void _compileTimeCheck;

// 2. Runtime regression: the mock Chrome listener and window must be scoped
// to each test; mutating the host globals at module import polluted other tests.
type MessageListener = (msg: any, sender: any, respond: (response: any) => void) => unknown;
type Dispatch = (msg: any) => Promise<any>;

async function withMessageRouter<T>(
    execute: (dispatch: Dispatch, mockWindow: any) => Promise<T>,
): Promise<T> {
    const g = globalThis as any;
    const originalChrome = Object.getOwnPropertyDescriptor(g, 'chrome');
    const originalWindow = Object.getOwnPropertyDescriptor(g, 'window');
    const activeClient = contentContext.getActiveClient();
    const wasAborted = contentContext.isAborted();
    const listeners = new Set<MessageListener>();
    const mockWindow = { __gemExporterCleanups: [] as Array<() => void> } as any;
    const mockChrome = {
        runtime: {
            onMessage: {
                addListener: (fn: MessageListener) => { listeners.add(fn); },
                removeListener: (fn: MessageListener) => { listeners.delete(fn); },
            },
            lastError: null,
            sendMessage: (_msg: any, _cb?: any) => {},
        },
    };
    Object.defineProperty(g, 'chrome', { value: mockChrome, writable: true, configurable: true });
    Object.defineProperty(g, 'window', { value: mockWindow, writable: true, configurable: true });

    const runtime = accountRuntime();
    try {
        contentContext.setActiveClient(null);
        contentContext.setAborted(false);
        initMessageRouter();
        assert__s5.equal(listeners.size, 1, 'test must exercise the actual registered router');
        const dispatch: Dispatch = (msg) => new Promise((resolve, reject) => {
            const listener = [...listeners][0];
            if (!listener) return reject(new Error('No message listener registered'));
            try { if (listener(msg, {}, resolve) === false) resolve({ unhandled: true }); }
            catch (error) { reject(error); }
        });
        return await execute(dispatch, window);
    } finally {
        runCleanups();
        runtime.restore();
        contentContext.setActiveClient(activeClient);
        contentContext.setAborted(wasAborted);
        if (originalWindow) Object.defineProperty(g, 'window', originalWindow);
        else delete g.window;
        if (originalChrome) Object.defineProperty(g, 'chrome', originalChrome);
        else delete g.chrome;
    }
}

test('ActiveClient contract - ContentContext.abort behavior with and without abort()', () => {
    const ctx = new ContentContext();

    let clientAbortCalled = 0;
    const clientWithAbort: ActiveClientContract = {
        abort: () => { clientAbortCalled++; },
    };
    ctx.setActiveClient(clientWithAbort);
    ctx.abort();
    assert__s5.strictEqual(clientAbortCalled, 1, 'client.abort() should be invoked once');
    assert__s5.strictEqual(ctx.isAborted(), true);

    const ctx2 = new ContentContext();
    ctx2.setActiveClient(clientWithoutAbort);
    assert__s5.doesNotThrow(() => ctx2.abort());
    assert__s5.strictEqual(ctx2.isAborted(), true);

    const ctx3 = new ContentContext();
    ctx3.setActiveClient({ abort: () => { throw new Error('Abort failure'); } });
    assert__s5.doesNotThrow(() => ctx3.abort(), 'ContentContext.abort() is best-effort');
    assert__s5.strictEqual(ctx3.isAborted(), true, 'abort state must survive an exception in client.abort()');
});

test('ActiveClient contract - Scan cancellation uses invocation signals rather than retired router abort commands', async () => {
    await withMessageRouter(async dispatch => {
        for (const action of ['stopDeepScan', 'abortSync', 'deepScan']) assert__s5.deepEqual(await dispatch({ action }), { unhandled: true });
    });
    const a = new AbortController(), b = new AbortController(); let dispatched = 0;
    const options = (signal: AbortSignal) => ({ signal, onTarget: async () => {} });
    const ports = { resolveScanTarget: async () => '10000000-0000-4000-8000-000000000001',
        scanAll: async (_request: unknown, runtime?: { signal?: AbortSignal }) => {
            dispatched++; assert__s5.strictEqual(runtime?.signal, b.signal);
            return { status: 'complete' as const, pagesFetched: 1, conversationsFetched: 3 };
        } };
    a.abort(); await assert__s5.rejects(startSync(undefined, options(a.signal), ports), { name: 'AbortError' });
    assert__s5.equal((await startSync(undefined, options(b.signal), ports)).status, 'complete'); assert__s5.equal(dispatched, 1);
});

test('scan failures, limits, cancellation and completion keep the explicit Application result or rejection', async () => {
    for (const status of ['complete', 'up_to_date', 'partial_limit', 'aborted', 'error'] as const) {
        const expected = { status, pagesFetched: 2, conversationsFetched: 3 };
        const result = await startSync(undefined, { signal: new AbortController().signal, onTarget: async () => {} }, {
            resolveScanTarget: async () => '10000000-0000-4000-8000-000000000001', scanAll: async () => expected,
        });
        assert__s5.strictEqual(result, expected);
    }
    const error = Error('HTTP 429 rate limit');
    await assert__s5.rejects(startSync(undefined, { signal: new AbortController().signal, onTarget: async () => {} }, {
        resolveScanTarget: async () => '10000000-0000-4000-8000-000000000001', scanAll: async () => { throw error; },
    }), actual => actual === error);
});
});

__suiteDescribe("active_title_fetch", () => {
// V2 retires title-driven active detail fetching. The passive source observation
// upgrades titles through L2 without starting network acquisition or inventing time.
test('passive RPC titles upgrade unresolved, derived and undated titles without active fetches', async t => {
    const store = indexStorage(), runtime = accountRuntime('u2');
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Passive ingestion must not fetch'); });
    const ids = ['generic_title_01', 'sniff_title_01', 'resolved_title_01', 'undated_rpc_01'];
    try {
        await ingestIndexes(ACCOUNT_UUID, [
            { conversationId: ids[0], fields: {} },
            { conversationId: ids[1], fields: { title: 'Initial question', titleSource: 'derived', updatedAt: 1700000000000 } },
            { conversationId: ids[2], fields: { title: 'Resolved title', titleSource: 'provider', updatedAt: 1700000000000 } },
            { conversationId: ids[3], fields: { title: 'Undated title', titleSource: 'provider' } },
        ]);
        const text = geminiListGen('G_ACTIVE_TITLE_01');
        const capture = () => ({ origin: location.origin, source: window, data: {
            type: 'GEMINI_NETWORK_BATCHEXECUTE', payload: { text, slot: 'u2',
                requestAccountObservation: ACCOUNT_OBSERVATION, truncated: false, requestedAt: 1,
                url: 'https://gemini.google.com/_/BardChatUi/data/batchexecute',
                listRequest: { streamId: 'recent', requestCursor: null } },
        } }) as unknown as MessageEvent;
        init(); await handleWindowMessage(capture());
        const indexes = await listIndexes(ACCOUNT_UUID);
        for (const id of ids) {
            const index = indexes.find(index => index.key.conversationId === id);
            assert.equal(index?.title, 'Observed ' + id);
            assert.equal(index?.titleSource, 'provider');
            assert.equal(index?.updatedAt, id === ids[3] ? undefined : 1700000000000);
        }
        await handleWindowMessage(capture());
        assert.deepEqual(await listIndexes(ACCOUNT_UUID), indexes, 'duplicate passive observations remain idempotent');
        assert.equal(fetch.mock.callCount(), 0);
    } finally { runtime.restore(); store.restore(); }
});
});

__suiteDescribe("l1-list-rpc-isolation", () => {
test__s7('unrelated RPC empty array cannot certify an empty natural LIST terminal', () => {
    const parsed = parseList(geminiListGen('G_L1_LIST_RPC_ISOLATION_01'));
    assert.equal(parsed.failure, 'invalid_response');
    assert.equal(parsed.pageEvidence.valid, false);
    assert.deepEqual(parsed.conversations, []);
    const observed = geminiListObservation(parsed, { streamId: 'recent', requestCursor: null }, 'account', false);
    assert.equal(observed.valid, false);
    assert.equal(observed.terminal, undefined);
});

test__s7('missing LIST envelope does not allow non-target rows or terminal sentinels', () => {
    for (const key of ['G_L1_LIST_RPC_ISOLATION_02_0', 'G_L1_LIST_RPC_ISOLATION_02_1', 'G_L1_LIST_RPC_ISOLATION_02_2'] as const) {
        const parsed = parseList(geminiListGen(key));
        assert.equal(parsed.failure, 'invalid_response');
        assert.equal(parsed.pageEvidence.valid, false);
        assert.deepEqual(parsed.conversations, []);
    }
});

test__s7('actual LIST wrapper wins over unrelated RPC output irrespective of row order', () => {
    for (const key of ['G_L1_LIST_RPC_ISOLATION_03_0', 'G_L1_LIST_RPC_ISOLATION_03_1'] as const) {
        const parsed = parseList(geminiListGen(key));
        assert.equal(parsed.failure, undefined);
        assert.equal(parsed.conversations[0].id, 'verifiedrpc123');
        assert.equal(parsed.pageEvidence.valid, true);
    }
});

test__s7('only explicit LIST BardErrorInfo 1096 can certify the provider window limit', () => {
    const limited = parseList(geminiListGen('G_L1_LIST_RPC_ISOLATION_04_LIMIT'));
    const unrelated = parseList(geminiListGen('G_L1_LIST_RPC_ISOLATION_04_UNRELATED'));
    assert.equal(limited.failure, 'hit_google_limit');
    assert.equal(limited.pageEvidence.valid, false);
    assert.equal(unrelated.failure, 'invalid_response');
});

test__s7('LIST window limit recognizes the native protobuf Any error envelope', () => {
    const parsed = parseList(geminiListGen('G_L1_LIST_RPC_ISOLATION_05'));
    assert.equal(parsed.failure, 'hit_google_limit');
    const bound = geminiListObservation(parsed, { streamId: 'recent', requestCursor: 'tC_last' }, 'account');
    assert.equal(bound.valid, true);
    assert.equal(bound.ordered, true);
    assert.equal(bound.terminal, 'provider_limit');
    for (const request of [{ streamId: 'recent' as const, requestCursor: null },
        { streamId: 'pinned' as const, requestCursor: 'tC_last' }]) {
        assert.equal(geminiListObservation(parsed, request, 'account').valid, false);
    }
});

test__s7('native error envelopes still require the exact type, numeric code, and target LIST RPC', () => {
    for (const key of ['G_L1_LIST_RPC_ISOLATION_06_0', 'G_L1_LIST_RPC_ISOLATION_06_1',
        'G_L1_LIST_RPC_ISOLATION_06_2', 'G_L1_LIST_RPC_ISOLATION_06_3',
        'G_L1_LIST_RPC_ISOLATION_06_4', 'G_L1_LIST_RPC_ISOLATION_06_5'] as const) {
        const parsed = parseList(geminiListGen(key));
        assert.equal(parsed.failure, 'invalid_response');
        assert.equal(parsed.pageEvidence.valid, false);
    }
});
});

__suiteDescribe("sync_provider_contract", () => {
// Former syncEngine/checkpoint/receipt contracts are replaced by committed L1
// pages, L2 facts, and the current Scan controller. Badge rendering is a UI owner.
async function fixture(run: (env: ReturnType<typeof indexStorage>, provider: (pages: (ListParseResult | Error)[], onRequest?: NonNullable<GeminiProviderClient['getConversationList']>) => GeminiProvider) => Promise<void>) {
    const env = indexStorage(), previous = ProviderRegistry.get('gemini');
    try {
        await ingestIndexes(ACCOUNT_UUID,[
            {conversationId:'offline',fields:{title:'Offline archive',titleSource:'derived'}},
            {conversationId:'old',fields:{title:'Older online',titleSource:'provider',updatedAt:10}},
        ]);
        await putExportRecord({accountId:ACCOUNT_UUID,conversationId:'old'},{exportedAt:100,status:'ok',format:'markdown'});
        const provider = (pages: (ListParseResult | Error)[], onRequest?: NonNullable<GeminiProviderClient['getConversationList']>) => {
            let next = 0;
            const p = new GeminiProvider({getConversationDetail:async()=>sourceDetail(),getConversationList:async(...args)=>{
                if(onRequest) await onRequest(...args);
                const result=pages[next++];
                if(result instanceof Error) throw result;
                if(!result) throw new Error('Unexpected page request');
                return result;
            }},async()=> 'u2');
            ProviderRegistry.unregister('gemini');ProviderRegistry.register(p);return p;
        };
        await run(env,provider);
    } finally {
        ProviderRegistry.unregister('gemini');if(previous)ProviderRegistry.register(previous);env.restore();
    }
}
const limit = (): ListParseResult => ({...sourceList('G_SOURCE_EMPTY_01'), failure:'hit_google_limit',pageEvidence:{valid:false,ordered:false,keys:[]}});

test('Scan progress counts only committed pages and source entries',async()=>fixture(async(_env,provider)=>{
    provider([sourceList('G_SOURCE_FIRST_NEXT_01'),sourceList('G_SOURCE_SECOND_01')]);
    const progress: ScanProgress[]=[];
    const result=await scanAll({accountId:ACCOUNT_UUID,forceFull:true},{onProgress:p=>progress.push(p)});
    assert.deepEqual(progress,[{pagesFetched:1,conversationsFetched:1},{pagesFetched:2,conversationsFetched:2}]);
    assert.deepEqual(result,{status:'complete',pagesFetched:2,conversationsFetched:2,indexChanges:{added:2,updated:0}});
    assert.equal((await listIndexes(ACCOUNT_UUID)).length,4);
}));
test('complete and empty Recent sources preserve unseen local Index and export facts',async()=>fixture(async(_env,provider)=>{
    for(const page of [sourceList('G_SOURCE_VISIBLE_01'),sourceList('G_SOURCE_EMPTY_01')]){
        provider([page]);assert.equal((await scanAll({accountId:ACCOUNT_UUID,forceFull:true})).status,'complete');
        assert.ok((await listIndexes(ACCOUNT_UUID)).some(i=>i.key.conversationId==='offline'));
        assert.ok(await getExportRecord({accountId:ACCOUNT_UUID,conversationId:'old'}));
    }
}));
test('partial provider limit is an explicit continuation result and preserves observed pages',async()=>fixture(async(_env,provider)=>{
    provider([sourceList('G_SOURCE_VISIBLE_LIMIT_01'),limit()]);
    const result=await scanAll({accountId:ACCOUNT_UUID,forceFull:true});
    assert.equal(result.status,'partial_limit');assert.equal(result.reason,'provider_limit');
    assert.equal(result.pagesFetched,2);assert.ok((await listIndexes(ACCOUNT_UUID)).some(i=>i.key.conversationId==='visible'));
}));
test('1096 at the initial Recent request is not a confirmed continuation boundary',async()=>fixture(async(_env,provider)=>{
    provider([limit()]);const result=await scanAll({accountId:ACCOUNT_UUID});
    assert.equal(result.status,'error');assert.equal((await getCoverage__s8(ACCOUNT_UUID,'recent'))?.range ?? null,null);
}));
test('cancellation returns aborted without deleting existing facts or manufacturing Coverage',async()=>fixture(async(_env,provider)=>{
    provider([sourceList('G_SOURCE_NEVER_01')]);const controller=new AbortController();controller.abort();
    assert.equal((await scanAll({accountId:ACCOUNT_UUID},{signal:controller.signal})).status,'aborted');
    assert.equal((await listIndexes(ACCOUNT_UUID)).length,2);assert.equal((await getCoverage__s8(ACCOUNT_UUID,'recent'))?.range ?? null,null);
}));
test('malformed pages and cursor loops remain errors without reconciliation',async()=>fixture(async(_env,provider)=>{
    const malformed={...sourceList('G_SOURCE_EMPTY_01'),failure:'invalid_response' as const};
    for(const pages of [[malformed],[sourceList('G_SOURCE_FIRST_LOOP_01'),sourceList('G_SOURCE_SECOND_LOOP_01')]]){
        provider(pages);assert.equal((await scanAll({accountId:ACCOUNT_UUID,forceFull:true})).status,'error');
        assert.ok((await listIndexes(ACCOUNT_UUID)).some(i=>i.key.conversationId==='offline'));
    }
}));
test('Recent pages with unverified source ordering never advertise source_end',async()=>fixture(async(_env,provider)=>{
    const page=sourceList('G_SOURCE_UNTRUSTED_01');page.pageEvidence.ordered=false;
    provider([page]);
    const result=await scanAll({accountId:ACCOUNT_UUID,forceFull:true});
    assert.equal(result.status,'error');
    assert.equal(result.pagesFetched,1);
    assert.ok((await listIndexes(ACCOUNT_UUID)).some(i=>i.key.conversationId==='untrusted'));
    assert.equal((await getCoverage__s8(ACCOUNT_UUID,'recent'))?.range ?? null,null);
}));
test('a repeated Recent source ID across pages cannot certify complete Coverage',async()=>fixture(async(_env,provider)=>{
    provider([sourceList('G_SOURCE_REPEATED_CURSOR_01'),sourceList('G_SOURCE_REPEATED_01')]);
    const result=await scanAll({accountId:ACCOUNT_UUID,forceFull:true});
    assert.equal(result.status,'error');
    assert.equal(result.pagesFetched,2);
    assert.equal((await getCoverage__s8(ACCOUNT_UUID,'recent'))?.range ?? null,null);
}));
test('ordinary request failures cannot manufacture a provider limit or reusable boundary',async()=>fixture(async(_env,provider)=>{
    provider([sourceList('G_SOURCE_FIRST_NEXT_01'),new Error('HTTP 500')]);
    assert.equal((await scanAll({accountId:ACCOUNT_UUID,forceFull:true})).status,'error');
    assert.deepEqual(await getCoverage__s8(ACCOUNT_UUID,'recent'),{range:null});
}));
test('Index write failure prevents commit progress; a later scan recovers',async()=>fixture(async(env,provider)=>{
    const progress:ScanProgress[]=[];env.fail('indexes');provider([sourceList('G_SOURCE_VISIBLE_01')]);
    assert.equal((await scanAll({accountId:ACCOUNT_UUID},{onProgress:p=>progress.push(p)})).status,'error');
    assert.deepEqual(progress,[]);env.fail();provider([sourceList('G_SOURCE_VISIBLE_01')]);
    assert.equal((await scanAll({accountId:ACCOUNT_UUID,forceFull:true})).status,'complete');
}));
test('legacy lastSync/checkpoint timestamps cannot authorize early stop',async()=>fixture(async(env,provider)=>{
    env.local.lastSync=Number.MAX_SAFE_INTEGER;env.local.scanCheckpoint=Number.MAX_SAFE_INTEGER;
    provider([sourceList('G_SOURCE_HEAD_NEXT_01'),sourceList('G_SOURCE_LATER_01')]);
    const result=await scanAll({accountId:ACCOUNT_UUID});assert.equal(result.pagesFetched,2);assert.equal(result.status,'complete');
    assert.ok((await listIndexes(ACCOUNT_UUID)).some(i=>i.key.conversationId==='later'));
}));
test('Recent acquisition uses the verified slot and excludes the Pinned filter',async()=>fixture(async(_env,provider)=>{
    provider([sourceList('G_SOURCE_VISIBLE_01')],async(cursor,slot,filter)=>{
        assert.equal(cursor,null);assert.equal(slot,'u2');assert.equal(filter,undefined);return sourceList('G_SOURCE_EMPTY_01');
    });
    assert.equal((await scanAll({accountId:ACCOUNT_UUID})).status,'complete');
    assert.equal(await getCoverage__s8(ACCOUNT_UUID,'pinned'),null);
}));
test('later-page rename persists at the same activity timestamp',async()=>fixture(async(_env,provider)=>{
    const renamed=sourceList('G_SOURCE_OLD_01');renamed.conversations[0].title='Renamed elsewhere';renamed.conversations[0].updatedAt=10;
    provider([sourceList('G_SOURCE_NEW_NEXT_01'),renamed]);
    assert.equal((await scanAll({accountId:ACCOUNT_UUID,forceFull:true})).status,'complete');
    const old=(await listIndexes(ACCOUNT_UUID)).find(i=>i.key.conversationId==='old')!;
    assert.equal(old.title,'Renamed elsewhere');assert.equal(old.updatedAt,10);
}));
test('diagnostic strings do not override authoritative business results',async()=>fixture(async(_env,provider)=>{
    const page=sourceList('G_SOURCE_VISIBLE_01');Object.assign(page,{_debug:{error:'BARD_ERROR_INFO',bardError:'quota speculation',textLen:0,rawPreview:'',topParsed:null}});
    provider([page]);assert.equal((await scanAll({accountId:ACCOUNT_UUID})).status,'complete');
}));
test('the current Scan result exposes no legacy completeness/receipt/checkpoint schema',async()=>fixture(async(_env,provider)=>{
    provider([sourceList('G_SOURCE_EMPTY_01')]);const result=await scanAll({accountId:ACCOUNT_UUID});
    assert.deepEqual(Object.keys(result).sort(),['conversationsFetched','indexChanges','pagesFetched','status']);
    assert.deepEqual(result.indexChanges,{added:0,updated:0});
}));
});

__suiteDescribe("provider_abstraction", () => {
useIndexStorage();
/**
 * tests/provider_abstraction.test.ts
 * Comprehensive unit test suite for AIProvider abstraction layer,
 * ProviderRegistry and GeminiProvider.
 */





test('TabService - getAITab and sendToAITab integration', async () => {
    const origChrome = (global as any).chrome;
    try {
        const queries: string[] = [];
        const messages: Array<{ tabId: number; message: unknown }> = [];
        const runtime = chrome.runtime;
        (global as any).chrome = {
            ...chrome,
            tabs: {
                query: async ({ url }: { url: string }) => {
                    queries.push(url);
                    try {
                        const parsed = new URL(url.replace(/\*$/, ''));
                        if (parsed.hostname === 'chatgpt.com') {
                            return [{ id: 101, url: 'https://chatgpt.com/c/test', active: true }];
                        }
                        if (parsed.hostname === 'gemini.google.com') {
                            return [{ id: 202, url: 'https://gemini.google.com/app', active: true }];
                        }
                    } catch {}
                    return [];
                },
                sendMessage: (tabId: number, message: unknown, cb: (res: unknown) => void) => {
                    messages.push({ tabId, message });
                    cb({ ok: true, data: 'tab-response' });
                }
            },
            runtime
        };

        await assert__s9.rejects(TabService.getAITab('chatgpt'), /Provider\/account mismatch/);

        await require('../src/l3a/storageService.js').putAccount({ id: ACCOUNT_UUID, providerId: 'gemini', providerAccountId: '10000000001' });
        bindTabAccounts({ 202: ACCOUNT_UUID });
        const geminiTab = await TabService.getAITab('gemini', ACCOUNT_UUID);
        assert__s9.strictEqual(geminiTab?.id, 202, 'Should resolve Gemini tab');

        await assert__s9.rejects(TabService.sendToAITab('chatgpt', { action: 'test' }), /Provider\/account mismatch/);
        const res = await TabService.sendToAITab('gemini', { action: 'test' }, ACCOUNT_UUID);
        assert__s9.deepStrictEqual(res, { ok: true, data: 'tab-response' });
        assert__s9.deepStrictEqual(queries, ['https://gemini.google.com/*', 'https://gemini.google.com/*']);
        assert__s9.deepStrictEqual(messages, [{ tabId: 202, message: { action: 'test', accountId: ACCOUNT_UUID } }]);
    } finally {
        (global as any).chrome = origChrome;
    }
});
});

__suiteDescribe("provider_tab_identity", () => {
for (const [provider, read] of [
    ['Claude', () => readClaudeSource('/api/organizations')],
    ['Grok', () => readGrokSource('/rest/auth/get-user')],
] as const) test(`${provider} skips ID-less tabs, tries active tabs first and falls back to ID zero`, async t => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    t.after(() => {
        if (original) Object.defineProperty(globalThis, 'chrome', original);
        else Reflect.deleteProperty(globalThis, 'chrome');
    });
    const calls: number[] = [];
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
        permissions: { contains: async () => true },
        tabs: { query: async () => [{ id: 0 }, { active: true }, { id: 2, active: true }, { id: 3 }] },
        scripting: { executeScript: async ({ target }: { target: { tabId: number } }) => {
            calls.push(target.tabId);
            if (target.tabId === 2) throw new Error('Tab closed');
            return [{ result: { ok: true, value: { source: provider } } }];
        } },
    } });
    assert.deepEqual(await read(), { source: provider });
    assert.deepEqual(calls, [2, 0]);
});

test('Claude attachments accept ID zero and reject a tab list without IDs before injection', async t => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    t.after(() => {
        if (original) Object.defineProperty(globalThis, 'chrome', original);
        else Reflect.deleteProperty(globalThis, 'chrome');
    });
    let tabs: Array<{ id?: number; active?: boolean }> = [{ active: true }, { id: 0 }];
    let calls = 0;
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
        permissions: { contains: async () => true }, tabs: { query: async () => tabs },
        scripting: { executeScript: async ({ target }: { target: { tabId: number } }) => {
            calls++; assert.equal(target.tabId, 0);
            return [{ result: { status: 200, base64: 'AQI=', mediaType: 'application/octet-stream' } }];
        } },
    } });
    const id = '11111111-1111-4111-8111-111111111111';
    const result = await readClaudeFile(id, id);
    assert.deepEqual(result.bytes, new Uint8Array([1, 2]));
    tabs = [{ active: true }, { id: 9, active: true }, { id: 0 }];
    let attempt = 0;
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
        permissions: { contains: async () => true }, tabs: { query: async () => tabs },
        scripting: { executeScript: async ({ target }: { target: { tabId: number } }) => {
            calls++;
            if (++attempt === 1) {
                assert.equal(target.tabId, 9);
                throw new Error('Active tab navigated');
            }
            assert.equal(target.tabId, 0);
            return [{ result: { status: 200, base64: 'AQI=', mediaType: 'application/octet-stream' } }];
        } },
    } });
    const fallbackResult = await readClaudeFile(id, id);
    assert.deepEqual(fallbackResult.bytes, new Uint8Array([1, 2]));
    tabs = [{ active: true }];
    await assert.rejects(readClaudeFile(id, id), /Open Claude/);
    assert.equal(calls, 3);
});

test('Claude file download verifies /api/organizations membership when lastActiveOrg cookie is absent', async t => {
    const saved = ['chrome', 'document', 'fetch'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);
    t.after(() => {
        for (const [k, desc] of saved) {
            if (desc) Object.defineProperty(globalThis, k, desc);
            else Reflect.deleteProperty(globalThis, k);
        }
    });
    const orgId = '11111111-1111-4111-8111-111111111111';
    const fileId = '22222222-2222-4222-8222-222222222222';
    let memberOrgs: Array<{ uuid: string }> = [{ uuid: orgId }];
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: '' } });
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url: string) => {
        if (url === '/api/organizations') return new Response(JSON.stringify(memberOrgs), { status: 200 });
        return new Response(new Uint8Array([7, 8, 9]), { status: 200, headers: { 'content-type': 'application/pdf' } });
    } });
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
        permissions: { contains: async () => true },
        tabs: { query: async () => [{ id: 1, active: true }] },
        scripting: { executeScript: async (inj: { func: (...a: string[]) => Promise<unknown>; args: string[] }) =>
            [{ result: await inj.func(...inj.args) }] },
    } });
    const ok = await readClaudeFile(orgId, fileId);
    assert.deepEqual(ok.bytes, new Uint8Array([7, 8, 9]));
    assert.equal(ok.mediaType, 'application/pdf');

    memberOrgs = [{ uuid: '33333333-3333-4333-8333-333333333333' }];
    await assert.rejects(readClaudeFile(orgId, fileId), /organization\/account changed/);
});
});

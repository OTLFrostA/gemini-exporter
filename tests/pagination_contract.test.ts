import { rpcFixture, historicalFixture } from './helpers/nativeFixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAllConversations, getConversationDetail, isPaginationExhaustive } from '../src/core/api/client/pagination.js';
import type { GeminiPaginationListClient, GeminiPaginationDetailClient, PaginationOptions, PaginationResult, PaginationProgressInfo, PaginatedDetailResult, GeminiPaginationDiagnostics } from '../src/core/api/client/pagination.js';
import type { ConversationListItem, ListParseResult } from '../src/core/parsers/gemini/rpc/parseList.js';
import type { DetailParseResult } from '../src/core/api/client/detailTypes.js';
import { parseList } from '../src/core/parsers/gemini/rpc/parseList.js';
import type { ListParseDiagnostics } from '../src/core/parsers/gemini/rpc/parseList.js';
import type { GeminiAPIClient } from '../src/core/api/geminiClient.js';

function item(id: string): ConversationListItem {
    return { id, title: id, titleSource: 'rpc', titles: { rpc: id },
        createdAt: null, updatedAt: null, chatTime: null, timestamp: null,
        messageCount: 0, url: `https://gemini.google.com/app/${id}` };
}
function page(ids: string[], nextPageToken: string | null = null): ListParseResult {
    return { conversations: ids.map(item), nextPageToken };
}
function listClient(pages: (ListParseResult | Error)[]): GeminiPaginationListClient & { calls: number } {
    return { aborted: false, calls: 0, async getConversationList() {
        const result = pages[this.calls++];
        if (result instanceof Error) throw result;
        assert.ok(result, 'unexpected extra page request');
        return result;
    } };
}
function detailPage(ids: string[], nextPageToken: string | null = null): DetailParseResult {
    return rpcFixture({ id: 'test', title: 'Typed detail', titleSource: 'rpc', titles: { rpc: 'Typed detail' },
        messages: ids.map(id => ({ id, role: 'model', content: id, timestamp: 1700000000000 })),
        createdAt: null, chatTime: null, timestamp: null, updatedAt: null,
        url: 'https://gemini.google.com/app/test', nextPageToken }, { nextPageToken, decodedPayload: undefined, schemaDrift: undefined, turnsRejected: undefined });
}
function detailClient(pages: DetailParseResult[]): GeminiPaginationDetailClient {
    let calls = 0;
    return { async fetchConversationPage() {
        const result = pages[calls++];
        assert.ok(result, 'unexpected extra detail request');
        return result;
    } };
}

// Keep the producer's required completeness/diagnostic contracts from widening
// when the provider adapter is migrated. The legacy guard intentionally accepts {}.
type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type RequiredField<T, K extends keyof T> = {} extends Pick<T, K> ? false : true;
type TypeContracts = [
    Assert<RequiredField<PaginationResult, 'exhaustive'>>,
    Assert<RequiredField<PaginationResult, 'completionReason'>>,
    Assert<Equal<PaginationResult['diagnostics'], GeminiPaginationDiagnostics>>,
    Assert<Equal<PaginationResult['diagnostics']['pageHistory'][number]['debugInfo'], ListParseDiagnostics | null>>,
    Assert<Equal<Parameters<NonNullable<PaginationOptions['onPageBatch']>>[0], ConversationListItem[]>>,
    Assert<Equal<Parameters<NonNullable<PaginationOptions['onProgress']>>[0], PaginationProgressInfo>>,
    Assert<GeminiAPIClient extends GeminiPaginationListClient & GeminiPaginationDetailClient ? true : false>,
    Assert<Equal<Awaited<ReturnType<GeminiAPIClient['getAllConversations']>>, PaginationResult>>,
    Assert<Equal<Awaited<ReturnType<GeminiAPIClient['getConversationDetail']>>, PaginatedDetailResult>>,
    Assert<Equal<Awaited<ReturnType<typeof getAllConversations>>, PaginationResult>>,
    Assert<Equal<Awaited<ReturnType<typeof getConversationDetail>>, PaginatedDetailResult>>
];
const typeContracts: TypeContracts = [true, true, true, true, true, true, true, true, true, true, true];

test('list: empty page and terminal populated page are naturally exhaustive', async () => {
    assert.ok(typeContracts.every(Boolean));
    for (const terminal of [page([]), page(['one'])]) {
        const result = await getAllConversations(listClient([terminal]), { incremental: true });
        assert.equal(result.exhaustive, true);
        assert.equal(result.completionReason, 'natural_exhaustion');
        assert.equal(result.stoppedEarly, undefined);
        assert.equal(result.hitGoogleLimit, false);
        assert.equal(result.total, terminal.conversations.length);
        assert.equal(isPaginationExhaustive(result), true);
    }
});

test('list: dedupe, callback batch, progress and diagnostic token evidence keep their meanings', async () => {
    const debug: NonNullable<ListParseResult['_debug']> = {
        error: 'NO_INNER_STR', bardError: null, textLen: 3, rawPreview: 'raw', topParsed: null
    };
    const second = { ...page(['one', 'two']), _debug: debug, _raw: { unvalidated: true } };
    const client = listClient([page(['one'], 'tC_cursor'), second]);
    const progress: PaginationProgressInfo[] = [];
    const batches: { ids: string[]; page: number; hasMore: boolean }[] = [];
    const result = await getAllConversations(client, { incremental: true,
        onProgress: info => { progress.push(info); },
        onPageBatch: async (batch, info) => { batches.push({ ids: batch.map(c => c.id), ...info }); }
    });
    assert.deepEqual(result.conversations.map(c => c.id), ['one', 'two']);
    assert.deepEqual(batches, [{ ids: ['one'], page: 1, hasMore: true }, { ids: ['one', 'two'], page: 2, hasMore: false }]);
    assert.deepEqual(progress.map(({ page, added, total, hasMore }) => ({ page, added, total, hasMore })),
        [{ page: 1, added: 1, total: 1, hasMore: true }, { page: 2, added: 1, total: 2, hasMore: false }]);
    assert.strictEqual(progress[1].batch, second.conversations);
    assert.deepEqual(result.diagnostics.pageHistory[1].requestedToken, { len: 9, preview: 'tC_cursor...' });
    assert.strictEqual(result.diagnostics.pageHistory[1].debugInfo, debug);
    assert.equal(result.diagnostics.totalPagesFetched, 2);
    assert.equal(result.diagnostics.totalConversations, 2);
    assert.ok(result.diagnostics.startTime);
    assert.ok(result.diagnostics.endTime);
});

test('list: watermark and arbitrary callback stops both map to unchanged_boundary even without a cursor', async () => {
    for (const reason of [undefined, 'explicit user callback', '历史水位线']) {
        const progress: PaginationProgressInfo[] = [];
        const client = listClient([page(['one'])]);
        const result = await getAllConversations(client, { incremental: true,
            onPageBatch: async () => ({ shouldStop: true, reason }),
            onProgress: info => { progress.push(info); }
        });
        assert.equal(result.completionReason, 'unchanged_boundary');
        assert.equal(result.exhaustive, false);
        assert.equal(result.stoppedEarly, true);
        assert.equal(isPaginationExhaustive(result), false);
        assert.equal(result.diagnostics.stopReason, reason || '已与历史水位线闭环咬合，早退终止');
        assert.equal(progress[0].reason, reason || '增量同步完成');
        assert.equal(progress[0].hasMore, false);
        assert.equal(progress[0].stoppedEarly, true);
    }
});

test('list: token loops and max-page stops preserve fetched partial data and block reconciliation', async () => {
    const loop = await getAllConversations(listClient([page(['one'], 'tC_loop'), page(['two'], 'tC_loop')]), { incremental: true });
    const max = await getAllConversations(listClient([page(['one'], 'tC_more')]), { maxPages: 1, incremental: true });
    for (const [result, reason, total] of [[loop, 'token_loop', 2], [max, 'max_pages', 1]] as const) {
        assert.equal(result.completionReason, reason);
        assert.equal(result.total, total);
        assert.equal(result.exhaustive, false);
        assert.equal(result.stoppedEarly, true);
        assert.equal(isPaginationExhaustive(result), false);
    }
});

test('list: Bard error evidence and later HTTP 429 are incomplete Google-limit results', async () => {
    for (const last of [
        { ...page([]), _debug: { error: 'BARD_ERROR_INFO' as const, bardError: '["BardErrorInfo",1096]', textLen: 0, rawPreview: '', topParsed: null } },
        new Error('HTTP 429 Too Many Requests')
    ]) {
        const result = await getAllConversations(listClient([page(['one'], 'tC_more'), last]), { incremental: true });
        assert.equal(result.completionReason, 'hit_google_limit');
        assert.equal(result.hitGoogleLimit, true);
        assert.equal(result.diagnostics.hitGoogleLimit, true);
        assert.equal(result.exhaustive, false);
        assert.equal(isPaginationExhaustive(result), false);
        assert.equal(result.total, 1);
    }
});

test('list: a later fetch error returns partial data, first-page and callback errors reject', async () => {
    const error = new Error('fixture network failure');
    const result = await getAllConversations(listClient([page(['one'], 'tC_more'), error]), { incremental: true });
    assert.equal(result.completionReason, 'error');
    assert.equal(result.exhaustive, false);
    assert.equal(result.stoppedEarly, true);
    assert.equal(result.diagnostics.totalPagesFetched, 1);
    assert.equal(result.diagnostics.stopReason, '网络或服务异常: fixture network failure');
    assert.equal(isPaginationExhaustive(result), false);
    await assert.rejects(getAllConversations(listClient([error])), value => value === error);
    await assert.rejects(getAllConversations(listClient([page(['one'])]), {
        onPageBatch: async () => { throw error; }
    }), value => value === error);
});

test('list: client and signal pre-aborts do not fetch or reset cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    for (const byClient of [false, true]) {
        const client = listClient([]);
        client.aborted = byClient;
        const result = await getAllConversations(client, { signal: byClient ? undefined : controller.signal });
        assert.equal(client.calls, 0);
        assert.equal(client.aborted, byClient);
        assert.equal(result.completionReason, 'aborted');
        assert.equal(result.exhaustive, false);
        assert.equal(result.total, 0);
        assert.equal(result.diagnostics.totalPagesFetched, 0);
    }
});

test('list: signal cancellation after a batch preserves partial data as aborted', async () => {
    const controller = new AbortController();
    const client = listClient([page(['one'], 'tC_more')]);
    const result = await getAllConversations(client, { incremental: true, signal: controller.signal,
        onProgress: () => { controller.abort(); }
    });
    assert.equal(client.calls, 1);
    assert.equal(result.completionReason, 'aborted');
    assert.equal(result.total, 1);
    assert.equal(result.exhaustive, false);
    assert.equal(result.stoppedEarly, true);
});

test('list: object options take precedence over positional callbacks and targetSid', async () => {
    let calls = 0;
    let objectProgress = 0;
    const client: GeminiPaginationListClient = { async getConversationList(token, sid, filter, opts) {
        calls++;
        assert.equal(token, null);
        assert.equal(sid, 'u2');
        assert.equal(filter, undefined);
        assert.equal(opts?.signal, undefined);
        return page(['one']);
    } };
    const result = await getAllConversations(client, { maxPages: 1, targetSid: 'u2', onProgress: () => { objectProgress++; } },
        () => { assert.fail('positional callback must be overridden'); }, 'u1');
    assert.equal(calls, 1);
    assert.equal(objectProgress, 1);
    assert.equal(result.diagnostics.maxPages, 1);
    assert.equal(result.completionReason, 'natural_exhaustion');
});

test('completeness guard preserves legacy absence semantics and rejects each explicit incomplete flag', () => {
    assert.equal(isPaginationExhaustive({}), true);
    assert.equal(isPaginationExhaustive(null), false);
    for (const evidence of [{ stoppedEarly: true }, { exhaustive: false }, { hitGoogleLimit: true },
        { diagnostics: { hitGoogleLimit: true } }, { completionReason: 'future_incomplete_reason' }]) {
        assert.equal(isPaginationExhaustive(evidence), false);
    }
    assert.equal(isPaginationExhaustive({ stoppedEarly: false, exhaustive: true, completionReason: 'natural_exhaustion' }), true);
});

test('detail: typed aggregation preserves reverse page order, dedupe, diagnostics and raw evidence', async () => {
    const first = detailPage(['new'], 'tC_more'); first.transport = { ...first.transport, turnsRejected: 1, schemaDrift: ['drift one'], decodedPayload: { evidence: 'not validated' } };
    const second = detailPage(['old', 'new']); second.transport = { ...second.transport, turnsRejected: 2, schemaDrift: ['drift one', 'drift two'] };
    const result: PaginatedDetailResult = await getConversationDetail(detailClient([first, second]), 'c_test');
    assert.equal(result.conversation.id, 'test');
    assert.deepEqual(result.conversation.messages.map(m => m.id), ['old', 'new']);
    assert.equal(result.conversation.messages.length, 2);
    assert.equal(result.transport.turnsRejected, 3);
    assert.deepEqual(result.transport.schemaDrift, ['drift one', 'drift two']);
    assert.strictEqual(result.transport.decodedPayload, first.transport.decodedPayload);
    assert.equal(result.transport.truncated, undefined);
    assert.equal(result.transport.truncateReason, undefined);
});

test('detail: token loop and 20-page cap retain exact truncation reasons', async () => {
    const loop = await getConversationDetail(detailClient([detailPage(['one'], 'tC_loop'), detailPage(['two'], 'tC_loop')]), 'test');
    assert.equal(loop.transport.truncateReason, 'token_loop');
    assert.equal(loop.transport.truncated, true);
    const max = await getConversationDetail(detailClient(Array.from({ length: 20 }, (_, i) => detailPage([`m${i}`], `tC_${i}`))), 'test');
    assert.equal(max.conversation.messages.length, 20);
    assert.equal(max.transport.truncateReason, 'max_turns_page_limit_20');
    assert.equal(max.transport.truncated, true);
});

test('list: first-page Bard limit returns an incomplete empty result; first-page HTTP limit rejects', async () => {
    const limited = { ...page([]), _debug: { error: 'BARD_ERROR_INFO' as const,
        bardError: '["BardErrorInfo",1096]', textLen: 0, rawPreview: '', topParsed: null } };
    const result = await getAllConversations(listClient([limited]));
    assert.equal(result.total, 0);
    assert.equal(result.exhaustive, false);
    assert.equal(result.completionReason, 'hit_google_limit');
    assert.equal(result.diagnostics.totalPagesFetched, 1);
    const error = new Error('HTTP 429 Too Many Requests');
    await assert.rejects(getAllConversations(listClient([error])), value => value === error);
});

test('list: global abort fallback is observed before the first fetch and preserves the cancellation result', async () => {
    const flags = globalThis as typeof globalThis & { __gemExporterAborted?: unknown };
    const before = flags.__gemExporterAborted;
    try {
        flags.__gemExporterAborted = true;
        const client = listClient([]);
        const result = await getAllConversations(client);
        assert.equal(client.calls, 0);
        assert.equal(result.completionReason, 'aborted');
        assert.equal(result.exhaustive, false);
        assert.equal(isPaginationExhaustive(result), false);
    } finally {
        if (before === undefined) delete flags.__gemExporterAborted;
        else flags.__gemExporterAborted = before;
    }
});

test('list: zero maxPages keeps its default fallback and negative maxPages is an incomplete budget stop', async () => {
    const zero = await getAllConversations(listClient([page([])]), { maxPages: 0 });
    assert.equal(zero.diagnostics.maxPages, 2000);
    assert.equal(zero.completionReason, 'natural_exhaustion');
    const client = listClient([]);
    const negative = await getAllConversations(client, { maxPages: -1 });
    assert.equal(client.calls, 0);
    assert.equal(negative.diagnostics.maxPages, -1);
    assert.equal(negative.diagnostics.totalPagesFetched, 0);
    assert.equal(negative.exhaustive, false);
    assert.equal(negative.completionReason, 'max_pages');
    assert.equal(negative.stoppedEarly, true);
    assert.equal(isPaginationExhaustive(negative), false);
});

test('detail: metadata-only retry flags and authoritative primary title remain unchanged', async () => {
    const first = detailPage([]);
    first.conversation.title = 'Authoritative metadata title'; first.conversation.titles = { rpc: first.conversation.title };
    first.transport = { ...first.transport, decodedPayload: [null, null, [['c_test', 'metadata title']]], turnsRejected: 1, schemaDrift: ['initial drift'] };
    const retry = detailPage(['answer']); retry.conversation.title = 'Prompt fallback'; retry.conversation.titleSource = 'sniff'; retry.conversation.titles = { sniff: 'Prompt fallback' };
    retry.transport = { ...retry.transport, turnsRejected: 2, schemaDrift: ['retry drift'] };
    let calls = 0;
    const client: GeminiPaginationDetailClient = { async fetchConversationPage(id, token, sid, opts) {
        assert.equal(id, 'c_test');
        assert.equal(token, null);
        assert.equal(sid, 'u2');
        if (calls++ === 0) {
            assert.equal(opts, undefined);
            return first;
        }
        assert.deepEqual(opts, { detailOnly: true, altParams: true });
        return retry;
    } };
    const result = await getConversationDetail(client, 'c_test', 'u2');
    assert.equal(calls, 2);
    assert.equal(result.conversation.title, 'Authoritative metadata title');
    assert.equal(result.conversation.titleSource, 'rpc');
    assert.deepEqual(result.conversation.titles, { rpc: 'Authoritative metadata title' });
    assert.deepEqual(result.conversation.messages.map(m => m.id), ['answer']);
    assert.equal(result.transport.turnsRejected, 3);
    assert.deepEqual(result.transport.schemaDrift, ['initial drift', 'retry drift']);
});

test('list: an empty NO_INNER_STR parser result is incomplete', async () => {
    const result = await getAllConversations(listClient([{ ...page([]), _debug: {
        error: 'NO_INNER_STR', bardError: null, textLen: 3, rawPreview: 'raw', topParsed: null
    } }]));
    assert.equal(result.exhaustive, false);
    assert.equal(result.completionReason, 'error');
    assert.equal(isPaginationExhaustive(result), false);
    assert.equal(result.hitGoogleLimit, false);
    assert.equal(result.diagnostics.pageHistory[0].debugInfo?.error, 'NO_INNER_STR');
});

test('list: an in-flight AbortError preserves partial data as aborted', async () => {
    const aborted = new Error('fixture request aborted');
    aborted.name = 'AbortError';
    const result = await getAllConversations(listClient([page(['one'], 'tC_more'), aborted]), { incremental: true });
    assert.equal(result.completionReason, 'aborted');
    assert.equal(result.exhaustive, false);
    assert.equal(result.stoppedEarly, true);
    assert.equal(result.total, 1);
    assert.equal(isPaginationExhaustive(result), false);
});

test('list: actual empty/malformed NO_INNER_STR responses cannot exhaust a partially fetched account', async () => {
    for (const text of ['', 'not JSON', '{}', '[null]']) {
        const malformed = parseList(text);
        assert.equal(malformed._debug?.error, 'NO_INNER_STR');
        const result = await getAllConversations(listClient([page(['one'], 'tC_more'), malformed]), { incremental: true });
        assert.equal(result.completionReason, 'error', text);
        assert.equal(result.exhaustive, false, text);
        assert.equal(result.stoppedEarly, true, text);
        assert.equal(result.total, 1);
        assert.equal(isPaginationExhaustive(result), false);
    }
});

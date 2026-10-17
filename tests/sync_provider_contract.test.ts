import { sourceIndex } from './helpers/domainFixture.js';
import { withRegistry } from './helpers/registryMock.js';
import { accountRuntime } from './helpers/accountRuntime.js';
import { listFixture } from './helpers/listFixture.js';
import { indexFixture } from './helpers/indexFixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncConversations } from '../src/content/syncEngine.js';
import type { ProviderSyncResult } from '../src/content/syncEngine.js';
import { contentContext } from '../src/content/contentContext.js';
import { ProviderRegistry } from '../src/core/provider/providerRegistry.js';
import { __setModuleOverride, __clearModuleOverrides } from '../src/core/utils/moduleOverrides.js';
import type { GeminiProviderContract, GeminiProviderConversationItem, GeminiProviderPageResult, GeminiProviderListOptions } from '../src/core/provider/gemini/geminiContracts.js';
import { getAllConversations } from '../src/core/api/client/pagination.js';
import { GeminiProvider } from '../src/core/provider/gemini/geminiProvider.js';
import type { ListParseResult } from '../src/core/parsers/gemini/rpc/parseList.js';
import type { PaginationCompletionReason, PaginationStopDecision, GeminiPaginationDiagnostics } from '../src/core/api/client/pagination.js';
import type { DomainConversationIndex as Conversation } from '../src/core/domain/conversationIndex.js';
import { GeminiProtocol } from '../src/core/protocol/protocol.js';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const typedResult: Assert<Equal<Awaited<ReturnType<typeof syncConversations>>, ProviderSyncResult | null>> = true;
const typedDiagnostics: Assert<Equal<ProviderSyncResult['diagnostics'], GeminiPaginationDiagnostics>> = true;
const NOW = 1700000000000;
function item(id = 'chat_visible'): GeminiProviderConversationItem {
    return sourceIndex(indexFixture({ id, title: 'RPC title', titleSource: 'rpc', titles: { rpc: 'RPC title' },
        createdAt: null, updatedAt: NOW, timestamp: NOW, chatTime: NOW,
        messageCount: 2, url: `https://gemini.google.com/u/2/app/${id}` }));
}
function page(reason: PaginationCompletionReason = 'natural_exhaustion'): GeminiProviderPageResult {
    const items = [item()];
    const complete = reason === 'natural_exhaustion';
    return { items,
        // Canonical items must be the only list field read by the sync consumer.
        get conversations(): GeminiProviderConversationItem[] { throw new Error('legacy conversations read'); },
        total: 1, hasMore: false, nextCursor: null,
        exhaustive: complete, completionReason: reason,
        ...(complete ? {} : { stoppedEarly: true as const }),
        hitGoogleLimit: reason === 'hit_google_limit',
        diagnostics: { startTime: 'start', endTime: 'end', maxPages: 4, incremental: false,
            totalPagesFetched: 1, totalConversations: 1, stopReason: reason,
            hitGoogleLimit: reason === 'hit_google_limit', pageHistory: [] } };
}
interface Setup {
    checkpoint?: number | null;
    abort?: boolean;
    slidingLimit?: number;
    failWrite?: boolean;
    failDiagnostics?: boolean;
    language?: 'zh' | 'en';
    wirePages?: ListParseResult[];
    pinnedPages?: ListParseResult[];
}
async function scan(input: GeminiProviderPageResult, setup: Setup = {}) {
    const original = ProviderRegistry.get('gemini');
    const originalLanguage = contentContext.getLanguage();
    contentContext.setLanguage(setup.language || 'zh');
    const globals = ['document', 'location', 'chrome', 'localStorage'] as const;
    const descriptors = globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    let records: Conversation[] = ([
        { id: 'chat_old', title: 'Old server chat', timestamp: NOW - 1000, accountSlot: '10000000-0000-4000-8000-000000000003' },
        { id: 'chat_archive', title: 'Takeout archive', timestamp: NOW - 2000, isTakeoutOnly: true, accountSlot: '10000000-0000-4000-8000-000000000003' }
    ]).map(indexFixture);
    const initialCheckpoint = setup.checkpoint === undefined ? null : setup.checkpoint;
    let checkpoint = initialCheckpoint;
    const trace = {
        reconcileCalls: 0, slots: [] as string[], checkpointWrites: [] as number[], badgeTexts: [] as string[],
        diagnostics: [] as unknown[], progress: [] as unknown[],
        prompts: [] as { accountId: string; count: number; hitGoogleLimit: boolean; timestamp: number }[],
        decisions: [] as (PaginationStopDecision | void)[], options: null as GeminiProviderListOptions | null
    };
    const store = {
        async preparePageCoverage() { return {}; },
        async recordPageCoverage() { return true; },
        async getConversations(slot: string) { trace.slots.push(slot); return records; },
        async beginScanCoverage(slot: string) { trace.slots.push(slot); return { runId: 'fixture-run', previous: null }; },
        async isScanCoverageCurrent(slot: string) { trace.slots.push(slot); return true; },
        async finishScanCoverage(slot: string, _runId: string, status: string, baseline?: { headTimestamp: number | null }) {
            trace.slots.push(slot);
            if (status === 'complete' && baseline) trace.checkpointWrites.push(baseline.headTimestamp ?? 0);
            return true;
        },
        async transactConversations(slot: string, apply: (existing: Conversation[]) => { list: Conversation[]; changed: number } | null) {
            trace.slots.push(slot);
            if (setup.failWrite) throw new Error('Injected quota failure');
            const result = apply(records.map(indexFixture));
            if (result) records = result.list;
            return { list: records, written: !!result, changed: result?.changed || 0 };
        },
        async setLastSync() {}, async updateAccountSlot() {},
        async setLastSyncDiagnostics(value: unknown) {
            if (setup.failDiagnostics) throw new Error('Diagnostic sink unavailable');
            trace.diagnostics.push(value);
        },
        async setPendingTakeoutPrompt(value: typeof trace.prompts[number]) { trace.prompts.push(value); },
        async reconcileConversations(slot: string, items: GeminiProviderConversationItem[], options: { keepTakeout: boolean }) {
            trace.reconcileCalls++; trace.slots.push(slot);
            assert.strictEqual(items, input.items);
            assert.deepEqual(options, { keepTakeout: true });
            const ids = new Set(items.map(c => c.id));
            const removedIds = records.filter(c => !Reflect.get(c ?? {}, 'hasTakeoutImport') && !ids.has(c.key.conversationId)).map(c => c.key.conversationId);
            records = records.filter(c => Reflect.get(c ?? {}, 'hasTakeoutImport') || ids.has(c.key.conversationId));
            return { kept: records.length, removed: removedIds.length, removedIds };
        }
    };
    const provider: GeminiProviderContract = {
        id: 'gemini', name: 'Sync contract fixture', hostPatterns: ['https://gemini.google.com/*'], matchesUrl: () => true,
        async checkReadiness() { return { ready: true }; },
        async fetchConversationDetail() { throw new Error('unexpected detail request'); },
        async listConversations(options) {
            trace.options = options || null;
            if (setup.wirePages) {
                let index = 0;
                let pinnedIndex = 0;
                const adapter = new GeminiProvider({
                    async getAllConversations(opts) {
                        return getAllConversations({ async getConversationList(_token, _sid, filter) {
                            if (Array.isArray(filter) && filter[0] === 1) {
                                return setup.pinnedPages?.[pinnedIndex++] ?? listFixture();
                            }
                            assert.ok(index < setup.wirePages!.length, 'must stop at the actual terminal response');
                            return setup.wirePages![index++];
                        } }, opts);
                    },
                    async getConversationDetail() { throw new Error('unexpected detail'); }
                });
                return adapter.listConversations(options);
            }
            trace.decisions.push(await options?.onPageBatch?.(input.items, { page: 1, hasMore: true }));
            options?.onProgress?.({ page: 1, added: input.items.length, total: input.items.length, hasMore: false,
                stoppedEarly: input.stoppedEarly, batch: input.items });
            if (setup.abort) contentContext.setAborted(true);
            return input;
        }
    };
    let badgeValue = '';
    const badgeText = { get textContent() { return badgeValue; }, set textContent(value: string) { badgeValue = value; trace.badgeTexts.push(value); } };
    const badge = { isConnected: true, style: {}, classList: { add() {}, remove() {}, contains: () => false } };
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {
        getElementById: (id: string) => id === 'geminiExportBadgeText' ? badgeText : id === 'geminiExportBadge' ? badge : null,
        querySelectorAll: () => [], querySelector: () => null
    } });
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'https://gemini.google.com/u/2/app', pathname: '/u/2/app' } });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {} } });
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: withRegistry({
        runtime: { sendMessage: async (message: unknown) => { trace.progress.push(message); } },
        storage: { local: { get: async () => ({}) } }
    }) });
    const account = accountRuntime();
    __setModuleOverride('StorageService', store);
    if (setup.slidingLimit) __setModuleOverride('GeminiProtocol', { ...GeminiProtocol, LIMITS: { ...GeminiProtocol.LIMITS, SLIDING_WINDOW: setup.slidingLimit } });
    ProviderRegistry.register(provider);
    contentContext.setDeepScanPromise(null);
    contentContext.setAborted(false);
    try {
        const result = await syncConversations({ maxPages: 4 });
        assert.equal(contentContext.getDeepScanPromise(), null);
        assert.equal(contentContext.getActiveClient(), null);
        return { result, trace, records };
    } finally {
        account.restore();
        if (original) ProviderRegistry.register(original);
        else ProviderRegistry.unregister('gemini');
        __clearModuleOverrides(); contentContext.setAborted(false); contentContext.setLanguage(originalLanguage);
        for (const [key, descriptor] of descriptors) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
}

test('floating badge only shows the stored tracked total while scan outcomes remain available to the workbench', async () => {
    for (const language of ['zh', 'en'] as const) {
        for (const reason of ['natural_exhaustion', 'hit_google_limit', 'aborted', 'error'] as const) {
            const input = page(reason);
            input.items = Array.from({ length: 600 }, (_, i) => item(`tracked_${i}`));
            input.total = 600;
            input.diagnostics.totalConversations = 600;
            const { result, trace, records } = await scan(input, { language });
            const expected = language === 'zh' ? '正在追踪 602 条对话' : 'Tracking 602 conversations';
            assert.equal(records.length, 602, 'includes retained cloud and Takeout records beyond this scan');
            assert.ok(trace.badgeTexts.length > 0);
            assert.ok(trace.badgeTexts.every(text => text === expected), `${reason}: ${trace.badgeTexts.join(' | ')}`);
            const terminal = [...trace.progress].reverse().find(message => (message as { status?: string }).status) as { status: string; title: string; percent: number; done: number };
            assert.equal(terminal.status, result?.status);
            if (reason === 'natural_exhaustion') {
                assert.equal(terminal.percent, 100);
                assert.equal(terminal.done, 1);
            } else {
                assert.notEqual(terminal.percent, 100);
                assert.notEqual(terminal.done, 1);
                assert.match(terminal.title, language === 'zh' ? /同步未完成，已保存 600 条/ : /Sync incomplete: 600 saved/);
            }
        }
    }
});

test('sync provider: complete cloud data preserves unseen local archives and Takeout/time/title/slot data', async () => {
    assert.equal(typedResult && typedDiagnostics, true);
    const input = page();
    input.hasMore = true; // availability hint must not override explicit completeness
    const { result, trace, records } = await scan(input);
    assert.equal(trace.reconcileCalls, 0);
    assert.equal(result?.status, 'complete');
    assert.equal(result?.count, 1); // successfully fetched cloud items
    assert.deepEqual(records.map(c => c.key.conversationId).sort(), ['chat_archive', 'chat_old', 'chat_visible']);
    const visible = records.find(c => c.key.conversationId === 'chat_visible');
    assert.equal(visible?.updatedAt, NOW);
    assert.equal(visible?.createdAt, undefined);
    assert.equal(visible?.titleSource, 'provider');
    assert.equal(visible?.titleSource, 'provider');
    assert.ok(trace.slots.every(slot => slot === '10000000-0000-4000-8000-000000000001'));
    assert.deepEqual(trace.checkpointWrites, [NOW]);
    assert.strictEqual(result?.diagnostics, input.diagnostics);
});

test('sync provider: every incomplete reason preserves unseen historical cloud records even with hasMore=false', async () => {
    for (const reason of ['unchanged_boundary', 'token_loop', 'max_pages', 'hit_google_limit', 'error', 'aborted'] as const) {
        const input = page(reason);
        const { result, trace, records } = await scan(input);
        assert.equal(trace.reconcileCalls, 0, reason);
        assert.ok(records.some(c => c.key.conversationId === 'chat_old'), reason);
        assert.deepEqual(trace.checkpointWrites, [], reason);
        assert.equal(result?.count, 1, reason);
        assert.equal(result?.status, reason === 'hit_google_limit' ? 'partial_limit' : reason === 'aborted' ? 'aborted' : 'error');
        const terminal = [...trace.progress].reverse().find(message => (message as { status?: string }).status);
        assert.ok(terminal);
        assert.notEqual((terminal as { percent: number }).percent, 100, reason);
        assert.notEqual((terminal as { done: number }).done, 1, reason);
        assert.strictEqual(trace.diagnostics[0], input.diagnostics);
    }
});

test('sync provider: explicit false completeness, Google evidence and cancellation veto reconciliation', async () => {
    for (const cause of ['exhaustive', 'top-limit', 'cancelled'] as const) {
        const input = page();
        if (cause === 'exhaustive') input.exhaustive = false;
        if (cause === 'top-limit') input.hitGoogleLimit = true;
        const { trace, records } = await scan(input, { abort: cause === 'cancelled' });
        assert.equal(trace.reconcileCalls, 0, cause);
        assert.ok(records.some(c => c.key.conversationId === 'chat_old'), cause);
        assert.deepEqual(trace.checkpointWrites, [], cause);
    }
});

test('sync provider: legacy timestamps cannot authorize an unverified overlap early stop', async () => {
    const { result, trace, records } = await scan(page('unchanged_boundary'), { checkpoint: NOW + 1000 });
    assert.equal(result?.status, 'error');
    assert.deepEqual(trace.decisions, [undefined]);
    assert.equal(trace.options?.incremental, false);
    assert.equal(trace.options?.includePinned, true);
    assert.equal(trace.options?.maxPages, 4);
    assert.equal(trace.options?.targetSid, 'u2');
    assert.deepEqual(trace.checkpointWrites, []);
    assert.ok(records.some(c => c.key.conversationId === 'chat_old'));
});

test('sync provider: explicit Google limit outcome preserves quota prompt regardless of diagnostics', async () => {
    for (const nested of [false, true]) {
        const input = page('hit_google_limit');
        input.hitGoogleLimit = !nested;
        input.diagnostics.hitGoogleLimit = nested;
        const { result, trace } = await scan(input);
        assert.equal(result?.hitGoogleLimit, true);
        assert.strictEqual(result?.diagnostics, input.diagnostics);
        assert.equal(trace.prompts[0].accountId, '10000000-0000-4000-8000-000000000001');
        assert.equal(trace.prompts[0].hitGoogleLimit, true);
        assert.ok(trace.progress.some(message => typeof message === 'object' && message !== null && 'hitGoogleLimit' in message && message.hitGoogleLimit === true));
    }
    const { result, trace } = await scan(page(), { slidingLimit: 1 });
    assert.equal(result?.hitGoogleLimit, false);
    assert.equal(trace.prompts.length, 0); // local counts are not evidence of a cloud limit
});

test('sync provider: empty complete account retains the existing conservative no-prune policy', async () => {
    const input = page(); input.items = []; input.total = 0;
    const { result, trace, records } = await scan(input);
    assert.equal(result?.count, 0);
    assert.equal(trace.reconcileCalls, 0);
    assert.ok(records.some(c => c.key.conversationId === 'chat_old'));
    assert.equal(trace.checkpointWrites.length, 1);
});

test('sync safety: real pagination edge results pass through adapter without reconciling unseen history', async () => {
    const abort = new Error('request aborted'); abort.name = 'AbortError';
    const malformed: ListParseResult = { ...listFixture(), failure: 'invalid_response', pageEvidence: { valid: false, ordered: false, keys: [] }, _debug: { error: 'NO_INNER_STR', bardError: null, textLen: 3, rawPreview: 'bad', topParsed: null } };
    for (const edge of ['negative-budget', 'empty-no-inner', 'partial-no-inner', 'partial-abort'] as const) {
        let calls = 0;
        const actual = await getAllConversations({ async getConversationList() {
            if (edge === 'negative-budget') throw new Error('negative budget must not fetch');
            if (edge === 'empty-no-inner') return malformed;
            if (calls++ === 0) return listFixture(([item()]).map(indexFixture), 'tC_more');
            if (edge === 'partial-abort') throw abort;
            return malformed;
        } }, { maxPages: edge === 'negative-budget' ? -1 : 4, incremental: true });
        assert.equal(actual.exhaustive, false, edge);
        assert.equal(actual.completionReason, edge === 'negative-budget' ? 'max_pages' : edge === 'partial-abort' ? 'aborted' : 'error', edge);
        const adapter = new GeminiProvider({ async getAllConversations() { return actual; }, async getConversationDetail() { throw new Error('unexpected detail'); } });
        const mapped = await adapter.listConversations();
        const { trace, records } = await scan(mapped);
        assert.equal(trace.reconcileCalls, 0, edge);
        assert.ok(records.some(c => c.key.conversationId === 'chat_old'), edge);
        assert.deepEqual(trace.checkpointWrites, [], edge);
    }
});

 test('sync safety: write failure rejects scan, preserves old data and checkpoint, and queue recovers', async () => {
    await assert.rejects(scan(page(), { failWrite: true }), /Injected quota failure/);
    const { result, trace, records } = await scan(page());
    assert.ok(result);
    assert.deepEqual(trace.checkpointWrites, [NOW]);
    assert.ok(records.some(c => c.key.conversationId === 'chat_old'));
});


test('sync safety: later pages with newer updates are saved even when the first page crosses the legacy checkpoint', async () => {
    const timed = (id: string, delta: number) => ({ ...item(id), timestamp: NOW + delta, updatedAt: NOW + delta });
    const first = listFixture(([timed('head120', 120), timed('head110', 110), timed('old090', 90)]).map(indexFixture), 'tC_more');
    const later = listFixture(([timed('late105', 105)]).map(indexFixture), null);
    const { result, records, trace } = await scan(page(), { checkpoint: NOW + 100, wirePages: [first, later] });
    assert.equal(result?.status, 'complete');
    assert.equal(result?.diagnostics.totalPagesFetched, 3);
    assert.equal(records.find(record => record.key.conversationId === 'late105')?.updatedAt, NOW + 105);
    assert.deepEqual(trace.checkpointWrites, [NOW + 120]);
});

test('sync safety: a limited first scan and retry never claim complete coverage', async () => {
    const limited: ListParseResult = { ...listFixture(), failure: 'hit_google_limit', pageEvidence: { valid: false, ordered: false, keys: [] },
        _debug: { error: 'BARD_ERROR_INFO', bardError: 'limit', textLen: 0, rawPreview: '', topParsed: null } };
    for (let attempt = 0; attempt < 2; attempt++) {
        const { result, trace, records } = await scan(page(), { wirePages: [
            listFixture(([item()]).map(indexFixture), 'tC_limit'), limited
        ] });
        assert.equal(result?.status, 'partial_limit');
        assert.equal(result?.diagnostics.totalPagesFetched, 3);
        assert.deepEqual(trace.checkpointWrites, []);
        assert.ok(records.some(record => record.key.conversationId === 'chat_visible'));
        assert.ok(records.some(record => record.key.conversationId === 'chat_old'));
    }
});


test('sync safety: missing producer completeness cannot establish trusted coverage', async () => {
    const input = page();
    Reflect.deleteProperty(input, 'exhaustive');
    Reflect.deleteProperty(input, 'completionReason');
    const { result, trace } = await scan(input);
    assert.equal(result?.status, 'error');
    assert.deepEqual(trace.checkpointWrites, []);
});

test('sync covers pinned-only chats and persists a later-page rename with an unchanged timestamp', async () => {
    const pinned = { ...item('pinned_only'), timestamp: NOW - 10000, updatedAt: NOW - 10000 };
    const renamed = { ...item('chat_old'), title: 'Renamed on another device', titles: { rpc: 'Renamed on another device' },
        timestamp: NOW - 1000, updatedAt: NOW - 1000 };
    const { result, records, trace } = await scan(page(), { pinnedPages: [listFixture(([pinned]).map(indexFixture), null)],
        wirePages: [listFixture(([item()]).map(indexFixture), 'tC_old'), listFixture(([renamed]).map(indexFixture), null)] });
    assert.equal(result?.status, 'complete');
    assert.equal(result?.count, 3);
    assert.equal(result?.diagnostics.totalPagesFetched, 3);
    assert.equal(records.find(record => record.key.conversationId === 'chat_old')?.title, 'Renamed on another device');
    assert.equal(records.find(record => record.key.conversationId === 'chat_old')?.updatedAt, NOW - 1000);
    assert.ok(records.some(record => record.key.conversationId === 'pinned_only'));
    assert.deepEqual(trace.checkpointWrites, [NOW]);
});


test('scan business outcomes ignore diagnostic limit flags and diagnostic persistence failure', async () => {
    for (const reason of ['natural_exhaustion', 'hit_google_limit'] as const) {
        const expected = reason === 'natural_exhaustion' ? 'complete' : 'partial_limit';
        const input = page(reason);
        input.diagnostics.hitGoogleLimit = !input.hitGoogleLimit;
        const normal = await scan(input);
        const unavailable = await scan(input, { failDiagnostics: true });
        assert.equal(normal.result?.status, expected);
        assert.equal(unavailable.result?.status, expected);
        assert.deepEqual(normal.trace.checkpointWrites, unavailable.trace.checkpointWrites);
        assert.deepEqual(normal.records, unavailable.records);
        assert.equal(normal.trace.prompts.length, input.hitGoogleLimit ? 1 : 0);
        assert.equal(unavailable.trace.prompts.length, normal.trace.prompts.length);
    }
});

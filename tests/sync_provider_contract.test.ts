import test from 'node:test';
import assert from 'node:assert/strict';
import { tryBatchExecuteFull } from '../src/content/syncEngine.js';
import type { ProviderSyncResult } from '../src/content/syncEngine.js';
import { contentContext } from '../src/content/contentContext.js';
import { ProviderRegistry } from '../src/core/provider/providerRegistry.js';
import { __setModuleOverride, __clearModuleOverrides } from '../src/core/utils/moduleOverrides.js';
import type { GeminiProviderContract, GeminiProviderConversationItem, GeminiProviderPageResult, GeminiProviderListOptions } from '../src/core/provider/gemini/geminiContracts.js';
import type { PaginationCompletionReason, PaginationStopDecision } from '../src/core/api/client/pagination.js';
import type { Conversation } from '../src/types/conversation.js';
import { GeminiProtocol } from '../src/core/protocol/protocol.js';

type Assert<T extends true> = T;
type NotAny<T> = 0 extends (1 & T) ? false : true;
const typedResult: Assert<NotAny<Awaited<ReturnType<typeof tryBatchExecuteFull>>>> = true;
const typedDiagnostics: Assert<NotAny<ProviderSyncResult['diagnostics']>> = true;
const NOW = 1700000000000;
function item(id = 'chat_visible'): GeminiProviderConversationItem {
    return { id, title: 'RPC title', titleSource: 'rpc', titles: { rpc: 'RPC title' },
        createdAt: null, updatedAt: NOW, timestamp: NOW, chatTime: NOW,
        messageCount: 2, url: `https://gemini.google.com/u/2/app/${id}` };
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
    forceFull?: boolean;
    abort?: boolean;
    slidingLimit?: number;
}
async function scan(input: GeminiProviderPageResult, setup: Setup = {}) {
    const original = ProviderRegistry.get('gemini');
    const globals = ['document', 'location', 'chrome'] as const;
    const descriptors = globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    let records: Conversation[] = [
        { id: 'chat_old', title: 'Old server chat', timestamp: NOW - 1000, accountSlot: 'u2' },
        { id: 'chat_archive', title: 'Takeout archive', timestamp: NOW - 2000, isTakeoutOnly: true, accountSlot: 'u2' }
    ];
    const initialCheckpoint = setup.checkpoint === undefined ? null : setup.checkpoint;
    let checkpoint = initialCheckpoint;
    const trace = {
        reconcileCalls: 0, slots: [] as string[], checkpointWrites: [] as number[],
        diagnostics: [] as unknown[], progress: [] as unknown[],
        prompts: [] as { slot: string; count: number; hitGoogleLimit: boolean; timestamp: number }[],
        decisions: [] as (PaginationStopDecision | void)[], options: null as GeminiProviderListOptions | null
    };
    const store = {
        async getScanCheckpoint(slot: string) { trace.slots.push(slot); return checkpoint; },
        async setScanCheckpoint(slot: string, value: number) { trace.slots.push(slot); checkpoint = value; trace.checkpointWrites.push(value); },
        async transactConversations(slot: string, apply: (existing: Conversation[]) => { list: Conversation[]; changed: number } | null) {
            trace.slots.push(slot);
            const result = apply(records);
            if (result) records = result.list;
            return { list: records, written: !!result, changed: result?.changed || 0 };
        },
        async setLastSync() {}, async updateAccountSlot() {},
        async setLastSyncDiagnostics(value: unknown) { trace.diagnostics.push(value); },
        async setPendingTakeoutPrompt(value: typeof trace.prompts[number]) { trace.prompts.push(value); },
        async reconcileConversations(slot: string, items: GeminiProviderConversationItem[], options: { keepTakeout: boolean }) {
            trace.reconcileCalls++; trace.slots.push(slot);
            assert.strictEqual(items, input.items);
            assert.deepEqual(options, { keepTakeout: true });
            const ids = new Set(items.map(c => c.id));
            const removedIds = records.filter(c => !c.isTakeoutOnly && !ids.has(c.id)).map(c => c.id);
            records = records.filter(c => c.isTakeoutOnly || ids.has(c.id));
            return { kept: records.length, removed: removedIds.length, removedIds };
        }
    };
    const provider: GeminiProviderContract = {
        id: 'gemini', name: 'Sync contract fixture', hostPatterns: ['https://gemini.google.com/*'], matchesUrl: () => true,
        async checkReadiness() { return { ready: true }; },
        async fetchConversationDetail() { throw new Error('unexpected detail request'); },
        async listConversations(options) {
            trace.options = options || null;
            trace.decisions.push(await options?.onPageBatch?.(input.items, { page: 1, hasMore: true }));
            options?.onProgress?.({ page: 1, added: input.items.length, total: input.items.length, hasMore: false,
                stoppedEarly: input.stoppedEarly, batch: input.items });
            if (setup.abort) contentContext.setAborted(true);
            return input;
        }
    };
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null } });
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'https://gemini.google.com/u/2/app', pathname: '/u/2/app' } });
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
        runtime: { sendMessage: async (message: unknown) => { trace.progress.push(message); } },
        storage: { local: { get: async () => ({}) } }
    } });
    __setModuleOverride('StorageService', store);
    if (setup.slidingLimit) __setModuleOverride('GeminiProtocol', { ...GeminiProtocol, LIMITS: { ...GeminiProtocol.LIMITS, SLIDING_WINDOW: setup.slidingLimit } });
    ProviderRegistry.register(provider);
    contentContext.setDeepScanPromise(null);
    contentContext.setAborted(false);
    try {
        const result = await tryBatchExecuteFull({ forceFull: setup.forceFull ?? true, maxPages: 4 });
        assert.equal(contentContext.getDeepScanPromise(), null);
        assert.equal(contentContext.getActiveClient(), null);
        return { result, trace, records };
    } finally {
        if (original) ProviderRegistry.register(original);
        else ProviderRegistry.unregister('gemini');
        __clearModuleOverrides(); contentContext.setAborted(false);
        for (const [key, descriptor] of descriptors) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
}

test('sync provider: canonical items reconcile complete cloud data and retain Takeout/time/title/slot data', async () => {
    assert.equal(typedResult && typedDiagnostics, true);
    const input = page();
    input.hasMore = true; // availability hint must not override explicit completeness
    const { result, trace, records } = await scan(input);
    assert.equal(trace.reconcileCalls, 1);
    assert.equal(result?.count, 2); // visible cloud chat plus retained archive
    assert.deepEqual(records.map(c => c.id).sort(), ['chat_archive', 'chat_visible']);
    const visible = records.find(c => c.id === 'chat_visible');
    assert.equal(visible?.timestamp, NOW);
    assert.equal(visible?.createdAt, null);
    assert.equal(visible?.titleSource, 'rpc');
    assert.equal(visible?.titles?.rpc, 'RPC title');
    assert.ok(trace.slots.every(slot => slot === 'u2'));
    assert.deepEqual(trace.checkpointWrites, [NOW]);
    assert.strictEqual(result?.diagnostics, input.diagnostics);
});

test('sync provider: every incomplete reason preserves unseen historical cloud records even with hasMore=false', async () => {
    for (const reason of ['unchanged_boundary', 'token_loop', 'max_pages', 'hit_google_limit', 'error', 'aborted'] as const) {
        const input = page(reason);
        const { result, trace, records } = await scan(input);
        assert.equal(trace.reconcileCalls, 0, reason);
        assert.ok(records.some(c => c.id === 'chat_old'), reason);
        assert.deepEqual(trace.checkpointWrites, [], reason);
        assert.equal(result?.count, 1, reason);
        assert.strictEqual(trace.diagnostics[0], input.diagnostics);
    }
});

test('sync provider: explicit false completeness, Google evidence and cancellation veto reconciliation', async () => {
    for (const cause of ['exhaustive', 'top-limit', 'diagnostic-limit', 'cancelled'] as const) {
        const input = page();
        if (cause === 'exhaustive') input.exhaustive = false;
        if (cause === 'top-limit') input.hitGoogleLimit = true;
        if (cause === 'diagnostic-limit') input.diagnostics.hitGoogleLimit = true;
        const { trace, records } = await scan(input, { abort: cause === 'cancelled' });
        assert.equal(trace.reconcileCalls, 0, cause);
        assert.ok(records.some(c => c.id === 'chat_old'), cause);
        assert.deepEqual(trace.checkpointWrites, [], cause);
    }
});

test('sync provider: watermark callback stop retains the same reason and incremental controls', async () => {
    const { trace, records } = await scan(page('unchanged_boundary'), { checkpoint: NOW + 1000, forceFull: false });
    assert.deepEqual(trace.decisions, [{ shouldStop: true, reason: '已与历史水位线闭环咬合，增量同步完成' }]);
    assert.equal(trace.options?.incremental, true);
    assert.equal(trace.options?.forceFull, false);
    assert.equal(trace.options?.maxPages, 4);
    assert.equal(trace.options?.targetSid, null);
    assert.equal(trace.reconcileCalls, 0);
    assert.ok(records.some(c => c.id === 'chat_old'));
});

test('sync provider: typed Google diagnostics preserve quota prompt and completion progress', async () => {
    for (const nested of [false, true]) {
        const input = page('hit_google_limit');
        input.hitGoogleLimit = !nested;
        input.diagnostics.hitGoogleLimit = nested;
        const { result, trace } = await scan(input);
        assert.equal(result?.hitGoogleLimit, true);
        assert.strictEqual(result?.diagnostics, input.diagnostics);
        assert.equal(trace.prompts[0].slot, 'u2');
        assert.equal(trace.prompts[0].hitGoogleLimit, true);
        assert.ok(trace.progress.some(message => typeof message === 'object' && message !== null && 'hitGoogleLimit' in message && message.hitGoogleLimit === true));
    }
    const { result, trace } = await scan(page(), { slidingLimit: 1 });
    assert.equal(result?.hitGoogleLimit, true);
    assert.equal(trace.prompts[0].hitGoogleLimit, false); // count heuristic remains distinct from direct Google evidence
});

test('sync provider: empty complete account retains the existing conservative no-prune policy', async () => {
    const input = page(); input.items = []; input.total = 0;
    const { result, trace, records } = await scan(input);
    assert.equal(result?.count, 0);
    assert.equal(trace.reconcileCalls, 0);
    assert.ok(records.some(c => c.id === 'chat_old'));
    assert.equal(trace.checkpointWrites.length, 1);
});

import { key, reset, stubModule, provider } from './helpers/applicationHarness.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { StreamCoverage } from '../src/l2/streamCoverage.js';
import type { ScanHead } from '../src/l2/coverageAdmission.js';
import type { ListEnd } from '../src/l1/client/aiProvider.js';
let baseline: StreamCoverage | null;
let boundary: boolean;
let reads = 0;
const checks: { baseline: StreamCoverage; head: ScanHead }[] = [];
stubModule('../../src/l2/coverageAdmission.js', { __esModule: true, default: {
    async getCoverage(accountId: string, streamId: string) {
        assert.equal(accountId, key().accountId); assert.equal(streamId, 'recent'); reads++; return baseline;
    },
    async hasTrustedBoundary(_account: string, baseline: StreamCoverage, head: ScanHead) { checks.push({ baseline, head }); return boundary; },
} });
const { scanAll } = require('../src/application/sync/scanController.js') as typeof import('../src/application/sync/scanController.js');
const head: ScanHead = { streamId: 'recent', requestKnown: true, requestCursor: null, nextCursor: 'next',
    valid: true, ordered: true, requestedAt: 1, keys: [{ id: 'first', time: 100 }] };
function trusted(): StreamCoverage {
    // L2 evidence is opaque to Application; use a real-shaped frozen historical range.
    return { range: { head: { id: 'old', time: 90 }, tail: { id: 'older', time: 10 } } } as StreamCoverage;
}
test.beforeEach(() => { reset(); baseline = null; boundary = false; reads = 0; checks.length = 0; });
for (const [end, status, reason] of [ ['source_end', 'complete', undefined], ['provider_limit', 'partial_limit', 'provider_limit'],
    ['max_pages', 'partial_limit', 'max_pages'], ['stopped', 'error', 'Unverified scan stop'] ] as const) {
    test(`L1 ${end} maps to ${status} using only committed counters`, async () => {
        provider.listConversations = async options => {
            assert.equal(options.streamId, 'recent'); assert.equal(options.accountId, key().accountId);
            assert.equal('cursor' in options, false); assert.equal('maxPages' in options, false);
            await options.onPageCommitted!({ page: 1, totalObserved: 25, scanHead: head });
            await options.onPageCommitted!({ page: 2, totalObserved: 40 });
            return end as ListEnd;
        };
        const progress: unknown[] = [];
        const result = await scanAll({ accountId: key().accountId }, { onProgress: p => progress.push(p) });
        assert.deepEqual(result, { status, pagesFetched: 2, conversationsFetched: 40, ...(reason ? { reason } : {}) });
        assert.deepEqual(progress, [{ pagesFetched: 1, conversationsFetched: 25 }, { pagesFetched: 2, conversationsFetched: 40 }]);
        assert.equal(checks.length, 0); assert.equal(reads, 1);
    });
}
test('historical range never skips the head request; trusted L2 connection stops the same sequential pipeline', async () => {
    baseline = trusted(); boundary = true;
    provider.listConversations = async options => {
        assert.equal(checks.length, 0);
        assert.equal(await options.onPageCommitted!({ page: 1, totalObserved: 1, scanHead: head }), true);
        return 'stopped';
    };
    assert.equal((await scanAll({ accountId: key().accountId })).status, 'up_to_date');
    assert.equal(checks.length, 1); assert.equal(checks[0].head, head);
});
test('baseline is cloned once; fresh coverage cannot replace startup history', async () => {
    baseline = trusted(); const original = structuredClone(baseline);
    provider.listConversations = async options => {
        baseline!.range = null;
        await options.onPageCommitted!({ page: 1, totalObserved: 2, scanHead: head });
        await options.onPageCommitted!({ page: 2, totalObserved: 4 });
        return 'source_end';
    };
    await scanAll({ accountId: key().accountId });
    assert.equal(checks.length, 2); assert.deepEqual(checks[0].baseline, original); assert.equal(reads, 1);
});
test('Force Full only bypasses boundary stopping and still calls the same Recent provider', async () => {
    baseline = trusted(); boundary = true;
    provider.listConversations = async options => {
        assert.equal(await options.onPageCommitted!({ page: 1, totalObserved: 1, scanHead: head }), false);
        return 'source_end';
    };
    assert.equal((await scanAll({ accountId: key().accountId, forceFull: true })).status, 'complete');
    assert.equal(checks.length, 0);
});
test('no baseline or no scanHead cannot produce trusted early stop', async () => {
    baseline = trusted(); boundary = true;
    provider.listConversations = async options => {
        assert.equal(await options.onPageCommitted!({ page: 1, totalObserved: 0 }), false); return 'source_end';
    };
    assert.equal((await scanAll({ accountId: key().accountId })).status, 'complete'); assert.equal(checks.length, 0);
});
test('failed later admission reports error and retains only previously committed counts', async () => {
    provider.listConversations = async options => {
        await options.onPageCommitted!({ page: 1, totalObserved: 10 }); throw new Error('Index commit failed');
    };
    assert.deepEqual(await scanAll({ accountId: key().accountId }), { status: 'error', pagesFetched: 1, conversationsFetched: 10, reason: 'Index commit failed' });
});
test('AbortSignal reaches L1; cancellation preserves committed pages and releases reentry guard', async () => {
    const controller = new AbortController();
    provider.listConversations = async options => {
        assert.equal(options.signal, controller.signal);
        await options.onPageCommitted!({ page: 1, totalObserved: 5 }); controller.abort(); options.signal!.throwIfAborted(); return 'source_end';
    };
    assert.deepEqual(await scanAll({ accountId: key().accountId }, { signal: controller.signal }), { status: 'aborted', pagesFetched: 1, conversationsFetched: 5 });
    provider.listConversations = async () => 'source_end';
    assert.equal((await scanAll({ accountId: key().accountId })).status, 'complete');
});
test('same-account reentry fails without starting a second scan', async () => {
    let nested: unknown;
    provider.listConversations = async () => { nested = await scanAll({ accountId: key().accountId }); return 'source_end'; };
    await scanAll({ accountId: key().accountId });
    assert.deepEqual(nested, { status: 'error', pagesFetched: 0, conversationsFetched: 0, reason: 'Scan already running' });
});

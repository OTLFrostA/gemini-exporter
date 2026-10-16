import { indexFixture } from './helpers/indexFixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { StorageService } from '../src/core/storage/storageService.js';
import { readScanCoverage } from '../src/core/storage/scanCoverage.js';
import { __clearModuleOverrides } from '../src/core/utils/moduleOverrides.js';
import { ingestRpcList } from '../src/content/syncEngine.js';

async function fixture(run: (data: Record<string, unknown>) => Promise<void>) {
    const data: Record<string, unknown> = { gemini_scan_checkpoint: 9999999999999 };
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
        runtime: { sendMessage: async () => {} }, storage: { local: {
            async get(keys: string[] | string | null) {
                if (keys === null) return structuredClone(data);
                const result: Record<string, unknown> = {};
                for (const key of typeof keys === 'string' ? [keys] : keys) result[key] = structuredClone(data[key]);
                return result;
            },
            async set(value: Record<string, unknown>) { Object.assign(data, structuredClone(value)); },
            async remove(keys: string[] | string) { for (const key of typeof keys === 'string' ? [keys] : keys) delete data[key]; }
        } }
    } });
    __clearModuleOverrides();
    try { await run(data); } finally {
        if (previous) Object.defineProperty(globalThis, 'chrome', previous);
        else Reflect.deleteProperty(globalThis, 'chrome');
    }
}
const baseline = { headTimestamp: 1700000000000, conversationCount: 2 };
const observation = (streamId = 'recent', keys = [{ id: 'abcdef123', time: 1700000000000 }], requestCursor: string | null = null, nextCursor: string | null = null) => ({
    providerId: 'gemini', accountId: '10000000-0000-4000-8000-000000000001', streamId, keys, items: [], requestKnown: true,
    requestedAt: Date.now() + 1, requestCursor, nextCursor, valid: true, ordered: streamId === 'recent'
});
async function observe(runId: string, page = observation(), slot = 'u0') {
    const current = (await StorageService.getScanCoverage(slot))!;
    return StorageService.recordPageCoverage(slot, page, current, page.streamId === 'recent', ['recent', 'pinned'], runId);
}

test('legacy versions 1 and 2 cannot certify stream coverage or initialize the new watermark', async () => fixture(async data => {
    for (const version of [1, 2]) {
        data.gemini_scan_coverage = { version, revision: 10, accountId: '10000000-0000-4000-8000-000000000001', complete: true, baseline, lastStatus: 'complete', activeRunId: null };
        assert.equal(await StorageService.getScanCoverage('u0'), null);
        const run = await StorageService.beginScanCoverage('u0', '10000000-0000-4000-8000-000000000001');
        assert.equal(run.previous, null);
        const current = await StorageService.getScanCoverage('u0');
        assert.equal(current?.version, 4); assert.equal(current?.initialized, false); assert.equal(current?.historyComplete, false);
    }
}));

test('a previous complete history cannot certify a broken current cursor chain', async () => fixture(async () => {
    const first = await StorageService.beginScanCoverage('u0', '10000000-0000-4000-8000-000000000001');
    await observe(first.runId, observation('pinned', []));
    await observe(first.runId);
    await StorageService.finishScanCoverage('u0', first.runId, 'complete', baseline);
    const second = await StorageService.beginScanCoverage('u0', '10000000-0000-4000-8000-000000000001');
    const head = observation('recent', [{ id: 'duplicate', time: 1800000000000 }], null, 'next');
    await observe(second.runId, head);
    await observe(second.runId, observation('recent', head.keys, 'next'));
    assert.equal((await StorageService.getScanCoverage('u0'))?.historyComplete, true, 'previous history remains available');
    await assert.rejects(StorageService.finishScanCoverage('u0', second.runId, 'complete', baseline), /durable complete coverage/);
}));
test('partial first scans initialize from fully persisted trusted pages, while a first-page failure remains uninitialized', async () => fixture(async () => {
    for (const status of ['partial_limit', 'aborted', 'error'] as const) {
        await StorageService.clearConversations('u0');
        const first = await StorageService.beginScanCoverage('u0', '10000000-0000-4000-8000-000000000001');
        await StorageService.finishScanCoverage('u0', first.runId, status);
        assert.equal((await StorageService.getScanCoverage('u0'))?.initialized, false);
        const saved = await StorageService.beginScanCoverage('u0', '10000000-0000-4000-8000-000000000001');
        assert.equal(await observe(saved.runId, observation('recent', undefined, 'not-the-head', 'next')), true);
        await StorageService.finishScanCoverage('u0', saved.runId, status);
        const current = await StorageService.getScanCoverage('u0');
        assert.equal(current?.initialized, true); assert.equal(current?.historyComplete, false); assert.equal(current?.baseline, null);
        assert.equal((await StorageService.beginScanCoverage('u0', '10000000-0000-4000-8000-000000000001')).previous?.initialized, true);
    }
}));
test('natural exhaustion requires both independent streams; empty accounts have no client-clock ordering key', async () => fixture(async () => {
    const run = await StorageService.beginScanCoverage('u0', '10000000-0000-4000-8000-000000000001');
    await observe(run.runId, observation('pinned', []));
    assert.equal((await StorageService.getScanCoverage('u0'))?.historyComplete, false);
    await observe(run.runId, observation('recent', []));
    await StorageService.finishScanCoverage('u0', run.runId, 'complete', { headTimestamp: null, conversationCount: 0 });
    const current = await StorageService.getScanCoverage('u0');
    assert.equal(current?.historyComplete, true); assert.equal(current?.initialized, true);
    assert.equal(current?.streams.recent.range, null); assert.equal(current?.streams.pinned.range, null);
}));
test('cache writes and Takeout-compatible ingestion cannot advance RPC coverage; frozen baselines remain immutable', async () => fixture(async () => {
    const run = await StorageService.beginScanCoverage('u0', '10000000-0000-4000-8000-000000000001');
    await observe(run.runId);
    await observe(run.runId, observation('pinned', []));
    await StorageService.finishScanCoverage('u0', run.runId, 'complete', baseline);
    const next = await StorageService.beginScanCoverage('u0', '10000000-0000-4000-8000-000000000001');
    const frozen = structuredClone(next.previous);
    const before = structuredClone(await StorageService.getScanCoverage('u0'));
    await ingestRpcList([indexFixture({ id: 'newabcdef123', title: 'Sniffed', titleSource: 'rpc', titles: { rpc: 'Sniffed' },
        timestamp: 1800000000000, updatedAt: 1800000000000, createdAt: null, chatTime: 1800000000000, url: '', messageCount: 1 })], 'u0');
    assert.deepEqual(await StorageService.getScanCoverage('u0'), before);
    assert.deepEqual(next.previous, frozen);
}));
test('newer active runs, account changes and clearing reject old commits including late passive responses', async () => fixture(async data => {
    const older = await StorageService.beginScanCoverage('u0', '10000000-0000-4000-8000-000000000001');
    const context = (await StorageService.getScanCoverage('u0'))!;
    const newer = await StorageService.beginScanCoverage('u0', '10000000-0000-4000-8000-000000000001');
    const before = structuredClone(data);
    assert.equal(await StorageService.recordPageCoverage('u0', observation(), context, true, ['recent', 'pinned'], older.runId), false);
    assert.equal(await StorageService.finishScanCoverage('u0', older.runId, 'complete', baseline), false);
    assert.deepEqual(data, before);
    assert.equal(await observe(newer.runId), true);
    const switched = await StorageService.beginScanCoverage('u0', '10000000-0000-4000-8000-000000000002');
    assert.equal(switched.previous, null);
    assert.equal(await StorageService.recordPageCoverage('u0', observation(), context, true, ['recent', 'pinned']), false);
    await StorageService.clearConversations('u0');
    assert.equal(await StorageService.getScanCoverage('u0'), null);
    assert.equal(await StorageService.finishScanCoverage('u0', switched.runId, 'complete', baseline), false);
    const afterClear = await StorageService.preparePageCoverage('u0', '10000000-0000-4000-8000-000000000001');
    assert.equal(await StorageService.recordPageCoverage('u0', { ...observation(), requestedAt: afterClear.resetAt - 1 }, afterClear, true, ['recent', 'pinned']), false);
    assert.equal(data.gemini_scan_checkpoint, undefined);
}));
test('unknown identities and invalid evidence cannot initialize coverage; cancellation guards also run under the write lock', async () => fixture(async data => {
    const run = await StorageService.beginScanCoverage('u0', '10000000-0000-4000-8000-000000000001');
    const context = (await StorageService.getScanCoverage('u0'))!;
    const before = structuredClone(data);
    assert.equal(await StorageService.recordPageCoverage('u0', observation(), context, true, ['recent', 'pinned'], run.runId, () => false), false);
    assert.deepEqual(data, before);
    await observe(run.runId, { ...observation(), requestKnown: false });
    assert.equal((await StorageService.getScanCoverage('u0'))?.initialized, false);
    await assert.rejects(StorageService.beginScanCoverage('u0', null), /Registry account UUID/);
    await assert.rejects(StorageService.beginScanCoverage('u0', 'email@example.com'), /Registry account UUID/);
    assert.equal((await StorageService.getScanCoverage('u0'))?.initialized, false);
    for (const value of [123, {}, { version: 1 }, { version: 2 }, { version: 3 }]) assert.equal(readScanCoverage(value), null);
}));

test('completed or incremental scan absence never changes archives, other accounts, bodies, resources or export records', async () => fixture(async data => {
    data.gemini_conversations = ([{ id: 'absent', title: 'Archived', timestamp: 1 },
        { id: 'deleted', title: 'Deleted archive', timestamp: 2, cloudAvailability: 'deleted' },
        { id: 'offline', title: 'Takeout archive', timestamp: 3, isTakeoutOnly: true }]).map(indexFixture);
    data.gemini_conversations_u1 = ([{ id: 'absent', title: 'Other account', timestamp: 9 }]).map(indexFixture);
    data.exportedIds = { absent: { status: 'ok' } };
    data.domainBodies = { absent: { messages: ['Saved answer'], assets: [1, 2, 3] } };
    const untouched = structuredClone(data);
    for (const status of ['complete', 'up_to_date', 'partial_limit'] as const) {
        const run = await StorageService.beginScanCoverage('u0', '10000000-0000-4000-8000-000000000001');
        await observe(run.runId, observation('pinned', []));
        await observe(run.runId);
        await StorageService.finishScanCoverage('u0', run.runId, status, baseline, ['only-visible']);
        for (const key of Object.keys(untouched)) if (key !== 'gemini_scan_checkpoint') assert.deepEqual(data[key], untouched[key]);
    }
}));

test('terminal status cannot disagree with persisted stream coverage or ordering invalidation', async () => fixture(async () => {
    const run = await StorageService.beginScanCoverage('u0', '10000000-0000-4000-8000-000000000001');
    await observe(run.runId, observation('pinned', []));
    await assert.rejects(StorageService.finishScanCoverage('u0', run.runId, 'complete', baseline), /durable complete coverage/);
    await observe(run.runId, { ...observation(), ordered: false });
    assert.equal((await StorageService.getScanCoverage('u0'))?.historyComplete, true);
    await assert.rejects(StorageService.finishScanCoverage('u0', run.runId, 'up_to_date'), /trusted activity coverage/);
    await StorageService.finishScanCoverage('u0', run.runId, 'complete', baseline);
    const persisted = (await StorageService.getScanCoverage('u0'))!;
    assert.equal(persisted.lastStatus, 'complete');
    assert.equal(persisted.streams.recent.orderingInvalidated, true);
    assert.equal(persisted.streams.recent.range, null);
    for (const malformed of [false, 'true']) {
        const value = structuredClone(persisted) as unknown as { streams: { recent: { orderingInvalidated: unknown } } };
        value.streams.recent.orderingInvalidated = malformed;
        assert.equal(readScanCoverage(value), null);
    }
}));

import { accountRuntime, ACCOUNT_UUID, ACCOUNT_OBSERVATION } from './helpers/accountRuntime.js';
import { isStoredObject } from '../src/core/storage/storageCompatibility.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestPageObservation } from '../src/content/syncEngine.js';
import { init } from '../src/content/messageBridge.js';
import { StorageService } from '../src/core/storage/storageService.js';
import { parseList } from '../src/core/parsers/gemini/rpc/parseList.js';
import { geminiListObservation } from '../src/core/provider/gemini/listObservation.js';
import { contentContext } from '../src/content/contentContext.js';
import { __clearModuleOverrides } from '../src/core/utils/moduleOverrides.js';
const account = ACCOUNT_UUID;
const text = JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, [
    ['c_abcdef123', 'Newest', null, null, null, [1700000020, 0]],
    ['c_abcdef456', 'Older', null, null, null, [1700000010, 0]]
], 'tC_tail'])]]);
const request = { streamId: 'recent' as const, requestCursor: null };
async function fixture(run: (state: { data: Record<string, unknown>; fail: boolean }) => Promise<void>) {
    const names = ['chrome', 'document', 'location'] as const;
    const descriptors = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
    const state = { data: {} as Record<string, unknown>, fail: false };
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: { sendMessage: async () => {} }, storage: { local: {
        async get(keys: string[] | string | null) {
            if (keys === null) return structuredClone(state.data);
            return Object.fromEntries((typeof keys === 'string' ? [keys] : keys).map(key => [key, structuredClone(state.data[key])]));
        },
        async set(value: Record<string, unknown>) {
            if (state.fail && 'conversations_10000000-0000-4000-8000-000000000001' in value) throw new Error('disk failed');
            Object.assign(state.data, structuredClone(value));
        },
        async remove(keys: string[] | string) { for (const key of typeof keys === 'string' ? [keys] : keys) delete state.data[key]; }
    } } } });
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'https://gemini.google.com/app', pathname: '/app', origin: 'https://gemini.google.com' } });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {
        getElementById: () => null, querySelector: () => null,
        querySelectorAll: () => [{ getAttribute: (name: string) => name === 'data-email' ? account : null }]
    } });
    __clearModuleOverrides(); contentContext.setAborted(false);
    const runtime = accountRuntime();
    try { await run(state); } finally {
        runtime.restore();
        contentContext.setAborted(false);
        for (const [name, descriptor] of descriptors) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
    }
}

test('production bridge and active observer persist identical stream coverage after the full page receipt', async () => {
    const outcomes: unknown[] = [];
    for (const active of [false, true]) await fixture(async () => {
        const requestedAt = Date.now() + 1;
        if (active) {
            const run = await StorageService.beginScanCoverage('10000000-0000-4000-8000-000000000001', account);
            const receipt = await ingestPageObservation(geminiListObservation(parseList(text), request, account, false, requestedAt), '10000000-0000-4000-8000-000000000001', run.runId);
            assert.equal(receipt.persisted, 2);
        } else {
            const bridge = init({ ingestPageObservation, getAccountSlot: () => 'u0' });
            await bridge.handleWindowMessage({ origin: 'https://gemini.google.com', data: { type: 'GEMINI_NETWORK_BATCHEXECUTE', payload: {
                text, slot: 'u0', listRequest: request, requestedAt, requestAccountObservation: ACCOUNT_OBSERVATION
            } } } as MessageEvent);
        }
        const coverage = await StorageService.getScanCoverage('10000000-0000-4000-8000-000000000001');
        assert.equal(coverage?.initialized, true); assert.equal(coverage?.historyComplete, false);
        const records = await StorageService.getConversations('10000000-0000-4000-8000-000000000001');
        assert.equal(records.length, 2);
        outcomes.push({ streams: coverage?.streams, rows: records.map(row => {
            assert.ok(isStoredObject(row) && !Array.isArray(row));
            return { id: row.id, title: row.title, timestamp: row.timestamp, source: row.source };
        }) });
    });
    assert.deepEqual(outcomes[0], outcomes[1]);
});
test('conversation persistence failures do not initialize coverage; a retry commits normally', async () => fixture(async state => {
    const run = await StorageService.beginScanCoverage('10000000-0000-4000-8000-000000000001', account);
    const page = geminiListObservation(parseList(text), request, account, false, Date.now() + 1);
    state.fail = true;
    await assert.rejects(ingestPageObservation(page, '10000000-0000-4000-8000-000000000001', run.runId), /disk failed/);
    assert.equal((await StorageService.getScanCoverage('10000000-0000-4000-8000-000000000001'))?.initialized, false);
    assert.deepEqual((await StorageService.getScanCoverage('10000000-0000-4000-8000-000000000001'))?.streams, {});
    state.fail = false;
    await ingestPageObservation(page, '10000000-0000-4000-8000-000000000001', run.runId);
    assert.equal((await StorageService.getScanCoverage('10000000-0000-4000-8000-000000000001'))?.initialized, true);
}));

test('real list parsing persists unordered rows and complete coverage without authorizing early stop', async () => fixture(async () => {
    const run = await StorageService.beginScanCoverage('10000000-0000-4000-8000-000000000001', account);
    const pinned = geminiListObservation(parseList(JSON.stringify([['wrb.fr', 'MaZiqc', '[]']])),
        { streamId: 'pinned', requestCursor: null }, account, false, Date.now() + 1);
    await ingestPageObservation(pinned, '10000000-0000-4000-8000-000000000001', run.runId);
    const head = observed([100, 60, 90], null, 'tC_next');
    assert.equal(head.page.valid, true); assert.equal(head.page.ordered, false);
    await ingestPageObservation(head.page, '10000000-0000-4000-8000-000000000001', run.runId);
    const partial = (await StorageService.getScanCoverage('10000000-0000-4000-8000-000000000001'))!;
    assert.equal(partial.historyComplete, false);
    await ingestPageObservation(observed([50, 40], 'tC_next', null).page, '10000000-0000-4000-8000-000000000001', run.runId);
    await StorageService.finishScanCoverage('10000000-0000-4000-8000-000000000001', run.runId, 'complete', { conversationCount: 5, headTimestamp: 1700000100000 });
    const complete = (await StorageService.getScanCoverage('10000000-0000-4000-8000-000000000001'))!;
    assert.equal(complete.complete, true); assert.equal(complete.streams.recent.range, null);
    assert.equal(complete.streams.recent.orderingInvalidated, true);
    assert.equal((await StorageService.getConversations('10000000-0000-4000-8000-000000000001')).length, 5);
    const next = await StorageService.beginScanCoverage('10000000-0000-4000-8000-000000000001', account);
    const ordered = observed([120, 110], null, 'tC_fresh');
    await ingestPageObservation(ordered.page, '10000000-0000-4000-8000-000000000001', next.runId);
    assert.equal(await StorageService.hasScanCoverageOverlap('10000000-0000-4000-8000-000000000001', next.runId, ordered.page, complete.streams.recent), false);
    assert.equal((await StorageService.getScanCoverage('10000000-0000-4000-8000-000000000001'))!.streams.recent.range, null);
}));
test('responses captured under a different identity and cancelled passive requests cannot write coverage', async () => fixture(async () => {
    const bridge = init({ ingestPageObservation, getAccountSlot: () => 'u0' });
    await bridge.handleWindowMessage({ origin: 'https://gemini.google.com', data: { type: 'GEMINI_NETWORK_BATCHEXECUTE', payload: {
        text, slot: 'u0', listRequest: request, requestedAt: Date.now() + 1, requestAccountObservation: { providerId: 'gemini', providerAccountId: '10000000002' }
    } } } as MessageEvent);
    assert.equal(await StorageService.getScanCoverage('10000000-0000-4000-8000-000000000001'), null);
    contentContext.abort();
    await assert.rejects(ingestPageObservation(geminiListObservation(parseList(text), request, account, false, Date.now() - 10), '10000000-0000-4000-8000-000000000001'), /cancelled/);
    assert.equal(await StorageService.getScanCoverage('10000000-0000-4000-8000-000000000001'), null);
}));

function observed(times: number[], cursor: string | null, next: string | null, prefix = 'new') {
    const wire = JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null,
        times.map(time => ['c_' + prefix + time, prefix + time, null, null, null, [1700000000 + time, 0]]), next])]]);
    return { wire, page: geminiListObservation(parseList(wire), { streamId: 'recent', requestCursor: cursor }, account, false, Date.now() + 1) };
}

test('active and passive persisted pages share cursor evidence and overlap uses the frozen prior interval', async () => fixture(async () => {
    const old = observed([100, 70], null, 'tC_old_tail', 'old');
    await ingestPageObservation(old.page, '10000000-0000-4000-8000-000000000001');
    const run = await StorageService.beginScanCoverage('10000000-0000-4000-8000-000000000001', account);
    const frozen = structuredClone(run.previous!.streams.recent);
    const head = observed([120, 110], null, 'tC_middle');
    await ingestPageObservation(head.page, '10000000-0000-4000-8000-000000000001', run.runId);
    assert.deepEqual((await StorageService.getScanCoverage('10000000-0000-4000-8000-000000000001'))!.streams.recent, frozen);
    assert.equal((await StorageService.getConversations('10000000-0000-4000-8000-000000000001')).length, 4, 'non-overlapping conversations still persist');
    assert.equal(await StorageService.hasScanCoverageOverlap('10000000-0000-4000-8000-000000000001', run.runId, head.page, frozen), false);

    const bridge = init({ ingestPageObservation, getAccountSlot: () => 'u0' });
    // Isolated evidence overlaps the baseline but cannot connect the active head.
    const isolated = observed([95, 85], 'tC_unrelated', 'tC_unread', 'isolated');
    await bridge.handleWindowMessage({ origin: 'https://gemini.google.com', data: { type: 'GEMINI_NETWORK_BATCHEXECUTE', payload: {
        text: isolated.wire, slot: 'u0', listRequest: { streamId: 'recent', requestCursor: 'tC_unrelated' },
        requestedAt: isolated.page.requestedAt, requestAccountObservation: ACCOUNT_OBSERVATION
    } } } as MessageEvent);
    assert.equal(await StorageService.hasScanCoverageOverlap('10000000-0000-4000-8000-000000000001', run.runId, head.page, frozen), false);
    const middle = observed([105, 95], 'tC_middle', 'tC_tail');
    await bridge.handleWindowMessage({ origin: 'https://gemini.google.com', data: { type: 'GEMINI_NETWORK_BATCHEXECUTE', payload: {
        text: middle.wire, slot: 'u0', listRequest: { streamId: 'recent', requestCursor: 'tC_middle' },
        requestedAt: middle.page.requestedAt, requestAccountObservation: ACCOUNT_OBSERVATION
    } } } as MessageEvent);
    const tail = observed([85, 65], 'tC_tail', 'tC_unread_tail');
    await ingestPageObservation(tail.page, '10000000-0000-4000-8000-000000000001', run.runId);
    const current = (await StorageService.getScanCoverage('10000000-0000-4000-8000-000000000001'))!;
    assert.deepEqual(current.streams.recent.range,
        { head: { id: 'new120', time: 1700000120000 }, tail: { id: 'new65', time: 1700000065000 } });
    assert.equal(current.historyComplete, false);
    assert.equal(await StorageService.hasScanCoverageOverlap('10000000-0000-4000-8000-000000000001', run.runId, head.page, frozen), true);
    assert.deepEqual(run.previous!.streams.recent, frozen, 'the current run cannot mutate its frozen baseline');
    assert.equal(await StorageService.hasScanCoverageOverlap('10000000-0000-4000-8000-000000000001', run.runId, head.page, frozen, () => false), false);
    await StorageService.beginScanCoverage('10000000-0000-4000-8000-000000000001', account);
    assert.equal(await StorageService.hasScanCoverageOverlap('10000000-0000-4000-8000-000000000001', run.runId, head.page, frozen), false);
    const switched = await StorageService.beginScanCoverage('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002');
    assert.equal(await StorageService.hasScanCoverageOverlap('10000000-0000-4000-8000-000000000001', switched.runId, head.page, frozen), false);
    assert.equal((await StorageService.getScanCoverage('10000000-0000-4000-8000-000000000002'))!.initialized, false);
}));

test('passive pages observed before an active run connect without persisting cursors', async () => fixture(async () => {
    const middle = observed([100, 70], 'tC_middle', 'tC_unread', 'prior');
    await ingestPageObservation(middle.page, '10000000-0000-4000-8000-000000000001');
    const run = await StorageService.beginScanCoverage('10000000-0000-4000-8000-000000000001', account);
    const head = observed([120, 110], null, 'tC_middle');
    await ingestPageObservation(head.page, '10000000-0000-4000-8000-000000000001', run.runId);
    const current = (await StorageService.getScanCoverage('10000000-0000-4000-8000-000000000001'))!;
    assert.equal(await StorageService.hasScanCoverageOverlap('10000000-0000-4000-8000-000000000001', run.runId, head.page, run.previous!.streams.recent), true);
    assert.equal(current.streams.recent.range!.head.time, 1700000120000);
    assert.equal(JSON.stringify(current).includes('tC_unread'), false);
}));

test('invalid or failed pages cannot extend an existing interval and a retry recovers', async () => fixture(async state => {
    await ingestPageObservation(observed([100, 70], null, 'tC_old_tail', 'old').page, '10000000-0000-4000-8000-000000000001');
    const run = await StorageService.beginScanCoverage('10000000-0000-4000-8000-000000000001', account);
    const frozen = run.previous!.streams.recent;
    const head = observed([120, 110], null, 'tC_middle');
    await ingestPageObservation(head.page, '10000000-0000-4000-8000-000000000001', run.runId);
    const middle = observed([105, 85], 'tC_middle', 'tC_unread');
    await ingestPageObservation({ ...middle.page, valid: false }, '10000000-0000-4000-8000-000000000001', run.runId);
    assert.deepEqual((await StorageService.getScanCoverage('10000000-0000-4000-8000-000000000001'))!.streams.recent, frozen);
    assert.equal(await StorageService.hasScanCoverageOverlap('10000000-0000-4000-8000-000000000001', run.runId, head.page, frozen), false);
    state.fail = true;
    await assert.rejects(ingestPageObservation(middle.page, '10000000-0000-4000-8000-000000000001', run.runId), /disk failed/);
    assert.deepEqual((await StorageService.getScanCoverage('10000000-0000-4000-8000-000000000001'))!.streams.recent, frozen);
    assert.equal(await StorageService.hasScanCoverageOverlap('10000000-0000-4000-8000-000000000001', run.runId, head.page, frozen), false);
    state.fail = false;
    await ingestPageObservation(middle.page, '10000000-0000-4000-8000-000000000001', run.runId);
    assert.equal(await StorageService.hasScanCoverageOverlap('10000000-0000-4000-8000-000000000001', run.runId, head.page, frozen), true);
    await StorageService.clearConversations('10000000-0000-4000-8000-000000000001');
    assert.equal(await StorageService.hasScanCoverageOverlap('10000000-0000-4000-8000-000000000001', run.runId, head.page, frozen), false);
}));

test('late passive heads persist normally without severing an active full scan, and passive tails still complete it', async () => fixture(async () => {
    const run = await StorageService.beginScanCoverage('10000000-0000-4000-8000-000000000001', account);
    const pinned = geminiListObservation(parseList(JSON.stringify([['wrb.fr', 'MaZiqc', '[]']])),
        { streamId: 'pinned', requestCursor: null }, account, false, Date.now() + 1);
    await ingestPageObservation(pinned, '10000000-0000-4000-8000-000000000001', run.runId);
    const head = observed([100, 90], null, 'tC_active_next', 'active');
    await ingestPageObservation(head.page, '10000000-0000-4000-8000-000000000001', run.runId);
    const anchored = (await StorageService.getScanCoverage('10000000-0000-4000-8000-000000000001'))!.streams.recent;
    const passive = observed([105, 100], null, 'tC_passive_next', 'passive');
    await ingestPageObservation(passive.page, '10000000-0000-4000-8000-000000000001');
    assert.deepEqual((await StorageService.getScanCoverage('10000000-0000-4000-8000-000000000001'))!.streams.recent, anchored);
    assert.equal((await StorageService.getConversations('10000000-0000-4000-8000-000000000001')).length, 4);
    const tail = observed([90, 80], 'tC_active_next', null, 'tail');
    await ingestPageObservation(tail.page, '10000000-0000-4000-8000-000000000001');
    const complete = (await StorageService.getScanCoverage('10000000-0000-4000-8000-000000000001'))!;
    assert.equal(complete.historyComplete, true);
    assert.equal(complete.streams.pinned.historyComplete, true);
    assert.equal(complete.streams.recent.historyComplete, true);
    assert.deepEqual(complete.streams.recent.range, { head: head.page.keys[0], tail: tail.page.keys[1] });
    assert.equal((await StorageService.getConversations('10000000-0000-4000-8000-000000000001')).length, 6);
    await StorageService.finishScanCoverage('10000000-0000-4000-8000-000000000001', run.runId, 'complete', { conversationCount: 4, headTimestamp: head.page.keys[0].time });
    await ingestPageObservation(passive.page, '10000000-0000-4000-8000-000000000001');
    assert.equal((await StorageService.getScanCoverage('10000000-0000-4000-8000-000000000001'))!.streams.recent.range!.head.time, passive.page.keys[0].time);
}));


test('a null or non-UUID page identity cannot write rows or initialize coverage', async () => fixture(async () => {
    for (const id of [null, 'profile@example.com', '10000000001']) {
        await assert.rejects(ingestPageObservation(geminiListObservation(parseList(text), request, id, false, Date.now() + 1), '10000000-0000-4000-8000-000000000001'), /Registry UUID/);
    }
    assert.deepEqual(await StorageService.getConversations('10000000-0000-4000-8000-000000000001'), []);
    assert.equal(await StorageService.getScanCoverage('10000000-0000-4000-8000-000000000001'), null);
}));

test('missing request identity cannot enter either passive list or detail ingestion', async () => fixture(async () => {
    const bridge = init({ ingestPageObservation, getAccountSlot: () => 'u0' });
    const detail = JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([
        [[[['c_unverified123', 'r_turn'], [1700000000, 0], [['Question']], [['rc_turn', [['Answer']]]]]]], null, 'Source title'
    ])]]);
    for (const response of [text, detail]) {
        for (const requestAccountObservation of [undefined, null, { providerId: 'gemini', email: 'profile@example.com' }]) {
            await bridge.handleWindowMessage({ origin: location.origin, data: { type: 'GEMINI_NETWORK_BATCHEXECUTE', payload: {
                text: response, slot: 'u0', listRequest: request, requestedAt: Date.now() + 1, requestAccountObservation
            } } } as MessageEvent);
        }
    }
    assert.deepEqual(await StorageService.getConversations('10000000-0000-4000-8000-000000000001'), []);
    assert.equal(await StorageService.getScanCoverage('10000000-0000-4000-8000-000000000001'), null);
}));

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
const account = 'sync@example.com';
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
            if (state.fail && 'gemini_conversations' in value) throw new Error('disk failed');
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
    try { await run(state); } finally {
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
            const run = await StorageService.beginScanCoverage('u0', account);
            const receipt = await ingestPageObservation(geminiListObservation(parseList(text), request, account, false, requestedAt), 'u0', run.runId);
            assert.equal(receipt.persisted, 2);
        } else {
            const bridge = init({ ingestPageObservation, getAccountSlot: () => 'u0' });
            await bridge.handleWindowMessage({ origin: 'https://gemini.google.com', data: { type: 'GEMINI_NETWORK_BATCHEXECUTE', payload: {
                text, slot: 'u0', listRequest: request, requestedAt, requestAccountId: account
            } } } as MessageEvent);
        }
        const coverage = await StorageService.getScanCoverage('u0');
        assert.equal(coverage?.initialized, true); assert.equal(coverage?.historyComplete, false);
        const records = await StorageService.getConversations('u0');
        assert.equal(records.length, 2);
        outcomes.push({ streams: coverage?.streams, rows: records.map(row => {
            assert.ok(isStoredObject(row) && !Array.isArray(row));
            return { id: row.id, title: row.title, timestamp: row.timestamp, source: row.source };
        }) });
    });
    assert.deepEqual(outcomes[0], outcomes[1]);
});
test('conversation persistence failures do not initialize coverage; a retry commits normally', async () => fixture(async state => {
    const run = await StorageService.beginScanCoverage('u0', account);
    const page = geminiListObservation(parseList(text), request, account, false, Date.now() + 1);
    state.fail = true;
    await assert.rejects(ingestPageObservation(page, 'u0', run.runId), /disk failed/);
    assert.equal((await StorageService.getScanCoverage('u0'))?.initialized, false);
    assert.deepEqual((await StorageService.getScanCoverage('u0'))?.streams, {});
    state.fail = false;
    await ingestPageObservation(page, 'u0', run.runId);
    assert.equal((await StorageService.getScanCoverage('u0'))?.initialized, true);
}));
test('responses captured under a different identity and cancelled passive requests cannot write coverage', async () => fixture(async () => {
    const bridge = init({ ingestPageObservation, getAccountSlot: () => 'u0' });
    await bridge.handleWindowMessage({ origin: 'https://gemini.google.com', data: { type: 'GEMINI_NETWORK_BATCHEXECUTE', payload: {
        text, slot: 'u0', listRequest: request, requestedAt: Date.now() + 1, requestAccountId: 'previous@example.com'
    } } } as MessageEvent);
    assert.equal(await StorageService.getScanCoverage('u0'), null);
    contentContext.abort();
    await assert.rejects(ingestPageObservation(geminiListObservation(parseList(text), request, account, false, Date.now() - 10), 'u0'), /cancelled/);
    assert.equal(await StorageService.getScanCoverage('u0'), null);
}));

function observed(times: number[], cursor: string | null, next: string | null, prefix = 'new') {
    const wire = JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null,
        times.map(time => ['c_' + prefix + time, prefix + time, null, null, null, [1700000000 + time, 0]]), next])]]);
    return { wire, page: geminiListObservation(parseList(wire), { streamId: 'recent', requestCursor: cursor }, account, false, Date.now() + 1) };
}

test('active and passive persisted pages share cursor evidence and overlap uses the frozen prior interval', async () => fixture(async () => {
    const old = observed([100, 70], null, 'tC_old_tail', 'old');
    await ingestPageObservation(old.page, 'u0');
    const run = await StorageService.beginScanCoverage('u0', account);
    const frozen = structuredClone(run.previous!.streams.recent);
    const head = observed([120, 110], null, 'tC_middle');
    await ingestPageObservation(head.page, 'u0', run.runId);
    assert.deepEqual((await StorageService.getScanCoverage('u0'))!.streams.recent, frozen);
    assert.equal((await StorageService.getConversations('u0')).length, 4, 'non-overlapping conversations still persist');
    assert.equal(await StorageService.hasScanCoverageOverlap('u0', run.runId, head.page, frozen), false);

    const bridge = init({ ingestPageObservation, getAccountSlot: () => 'u0' });
    // Isolated evidence overlaps the baseline but cannot connect the active head.
    const isolated = observed([95, 85], 'tC_unrelated', 'tC_unread', 'isolated');
    await bridge.handleWindowMessage({ origin: 'https://gemini.google.com', data: { type: 'GEMINI_NETWORK_BATCHEXECUTE', payload: {
        text: isolated.wire, slot: 'u0', listRequest: { streamId: 'recent', requestCursor: 'tC_unrelated' },
        requestedAt: isolated.page.requestedAt, requestAccountId: account
    } } } as MessageEvent);
    assert.equal(await StorageService.hasScanCoverageOverlap('u0', run.runId, head.page, frozen), false);
    const middle = observed([105, 95], 'tC_middle', 'tC_tail');
    await bridge.handleWindowMessage({ origin: 'https://gemini.google.com', data: { type: 'GEMINI_NETWORK_BATCHEXECUTE', payload: {
        text: middle.wire, slot: 'u0', listRequest: { streamId: 'recent', requestCursor: 'tC_middle' },
        requestedAt: middle.page.requestedAt, requestAccountId: account
    } } } as MessageEvent);
    const tail = observed([85, 65], 'tC_tail', 'tC_unread_tail');
    await ingestPageObservation(tail.page, 'u0', run.runId);
    const current = (await StorageService.getScanCoverage('u0'))!;
    assert.deepEqual(current.streams.recent.range,
        { head: { id: 'new120', time: 1700000120000 }, tail: { id: 'new65', time: 1700000065000 } });
    assert.equal(current.historyComplete, false);
    assert.equal(await StorageService.hasScanCoverageOverlap('u0', run.runId, head.page, frozen), true);
    assert.deepEqual(run.previous!.streams.recent, frozen, 'the current run cannot mutate its frozen baseline');
    assert.equal(await StorageService.hasScanCoverageOverlap('u0', run.runId, head.page, frozen, () => false), false);
    await StorageService.beginScanCoverage('u0', account);
    assert.equal(await StorageService.hasScanCoverageOverlap('u0', run.runId, head.page, frozen), false);
    const switched = await StorageService.beginScanCoverage('u0', 'other@example.com');
    assert.equal(await StorageService.hasScanCoverageOverlap('u0', switched.runId, head.page, frozen), false);
    assert.equal((await StorageService.getScanCoverage('u0'))!.initialized, false);
}));

test('passive pages observed before an active run connect without persisting cursors', async () => fixture(async () => {
    const middle = observed([100, 70], 'tC_middle', 'tC_unread', 'prior');
    await ingestPageObservation(middle.page, 'u0');
    const run = await StorageService.beginScanCoverage('u0', account);
    const head = observed([120, 110], null, 'tC_middle');
    await ingestPageObservation(head.page, 'u0', run.runId);
    const current = (await StorageService.getScanCoverage('u0'))!;
    assert.equal(await StorageService.hasScanCoverageOverlap('u0', run.runId, head.page, run.previous!.streams.recent), true);
    assert.equal(current.streams.recent.range!.head.time, 1700000120000);
    assert.equal(JSON.stringify(current).includes('tC_unread'), false);
}));

test('invalid or failed pages cannot extend an existing interval and a retry recovers', async () => fixture(async state => {
    await ingestPageObservation(observed([100, 70], null, 'tC_old_tail', 'old').page, 'u0');
    const run = await StorageService.beginScanCoverage('u0', account);
    const frozen = run.previous!.streams.recent;
    const head = observed([120, 110], null, 'tC_middle');
    await ingestPageObservation(head.page, 'u0', run.runId);
    const middle = observed([105, 85], 'tC_middle', 'tC_unread');
    await ingestPageObservation({ ...middle.page, valid: false }, 'u0', run.runId);
    assert.deepEqual((await StorageService.getScanCoverage('u0'))!.streams.recent, frozen);
    assert.equal(await StorageService.hasScanCoverageOverlap('u0', run.runId, head.page, frozen), false);
    state.fail = true;
    await assert.rejects(ingestPageObservation(middle.page, 'u0', run.runId), /disk failed/);
    assert.deepEqual((await StorageService.getScanCoverage('u0'))!.streams.recent, frozen);
    assert.equal(await StorageService.hasScanCoverageOverlap('u0', run.runId, head.page, frozen), false);
    state.fail = false;
    await ingestPageObservation(middle.page, 'u0', run.runId);
    assert.equal(await StorageService.hasScanCoverageOverlap('u0', run.runId, head.page, frozen), true);
    await StorageService.clearConversations('u0');
    assert.equal(await StorageService.hasScanCoverageOverlap('u0', run.runId, head.page, frozen), false);
}));

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

test('legacy checkpoints cannot establish coverage; partial first scans and retries stay incomplete', async () => fixture(async () => {
    assert.equal(await StorageService.getScanCoverage('u0'), null);
    for (const status of ['partial_limit', 'aborted', 'error'] as const) {
        const run = await StorageService.beginScanCoverage('u0', 'account-a');
        assert.equal(run.previous?.complete ?? false, false);
        await StorageService.finishScanCoverage('u0', run.runId, status);
        const current = await StorageService.getScanCoverage('u0');
        assert.equal(current?.complete, false);
        assert.equal(current?.baseline, null);
        assert.equal(current?.lastStatus, status);
    }
}));

test('natural completion stores a server baseline and freezes it separately from subsequent sniffing', async () => fixture(async () => {
    const run = await StorageService.beginScanCoverage('u0', 'account-a');
    await StorageService.finishScanCoverage('u0', run.runId, 'complete', baseline, []);
    const next = await StorageService.beginScanCoverage('u0', 'account-a');
    const frozen = structuredClone(next.previous);
    await ingestRpcList([{ id: 'abcdef123', title: 'Sniffed', titleSource: 'rpc', titles: { rpc: 'Sniffed' },
        timestamp: 1800000000000, updatedAt: 1800000000000, createdAt: null, chatTime: 1800000000000,
        url: '', messageCount: 1 }], 'u0');
    assert.deepEqual((await StorageService.getScanCoverage('u0'))?.baseline, baseline);
    assert.deepEqual(next.previous, frozen);
    await StorageService.finishScanCoverage('u0', next.runId, 'partial_limit');
    assert.equal((await StorageService.getScanCoverage('u0'))?.lastStatus, 'partial_limit');
    assert.deepEqual((await StorageService.getScanCoverage('u0'))?.baseline, baseline);
}));

test('empty natural exhaustion records complete empty history without a client-clock timestamp', async () => fixture(async () => {
    const run = await StorageService.beginScanCoverage('u1', 'account-b');
    await StorageService.finishScanCoverage('u1', run.runId, 'complete', { headTimestamp: null, conversationCount: 0 }, []);
    assert.deepEqual((await StorageService.getScanCoverage('u1'))?.baseline, { headTimestamp: null, conversationCount: 0 });
    assert.equal((await StorageService.getScanCoverage('u1'))?.complete, true);
    assert.equal(await StorageService.getScanCoverage('u0'), null);
}));

test('newer runs, account changes, and local clearing invalidate older coverage commits', async () => fixture(async data => {
    const older = await StorageService.beginScanCoverage('u0', 'account-a');
    const newer = await StorageService.beginScanCoverage('u0', 'account-a');
    const before = structuredClone(data);
    assert.equal(await StorageService.finishScanCoverage('u0', older.runId, 'complete', baseline, []), false);
    assert.deepEqual(data, before);
    assert.equal(await StorageService.isScanCoverageCurrent('u0', older.runId), false);
    await StorageService.finishScanCoverage('u0', newer.runId, 'complete', baseline, []);
    const switched = await StorageService.beginScanCoverage('u0', 'account-b');
    assert.equal(switched.previous, null);
    assert.equal((await StorageService.getScanCoverage('u0'))?.complete, false);
    await StorageService.clearConversations('u0');
    assert.equal(await StorageService.finishScanCoverage('u0', switched.runId, 'complete', baseline, []), false);
    assert.equal(await StorageService.getScanCoverage('u0'), null);
    assert.equal(data.gemini_scan_checkpoint, undefined);
}));

test('unknown identities never inherit another run coverage; malformed coverage fails closed', async () => fixture(async () => {
    const known = await StorageService.beginScanCoverage('u0', 'account-a');
    await StorageService.finishScanCoverage('u0', known.runId, 'complete', baseline);
    const unknown = await StorageService.beginScanCoverage('u0', null);
    assert.equal(unknown.previous, null);
    await StorageService.finishScanCoverage('u0', unknown.runId, 'complete', baseline);
    assert.equal((await StorageService.beginScanCoverage('u0', null)).previous, null);
    for (const value of [123, {}, { version: 1 }, { version: 2 }, { version: 1, revision: -1 }]) {
        assert.equal(readScanCoverage(value), null);
    }
}));


test('cancellation while a completion commit is queued cannot advance the baseline', async () => fixture(async data => {
    const run = await StorageService.beginScanCoverage('u0', 'account-a');
    const before = structuredClone(data);
    assert.equal(await StorageService.finishScanCoverage('u0', run.runId, 'complete', baseline, [], () => false), false);
    assert.deepEqual(data, before);
    await StorageService.finishScanCoverage('u0', run.runId, 'aborted');
    assert.equal((await StorageService.getScanCoverage('u0'))?.complete, false);
    assert.equal((await StorageService.getScanCoverage('u0'))?.lastStatus, 'aborted');
}));

import { getCoverage, hasTrustedBoundary } from '../src/core/domain/coverageAdmission.js';
import { beginScanCoverage, finishScanCoverage } from '../src/core/application/sync/scanLifecycle.js';
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

test('active and passive list observations persist the same Index facts without inventing a partial boundary', async () => {
    const outcomes: unknown[] = [];
    for (const active of [false, true]) await fixture(async () => {
        const requestedAt = Date.now() + 1;
        if (active) await ingestPageObservation(geminiListObservation(parseList(text), request, account, false, requestedAt), account);
        else {
            const bridge = init({ ingestPageObservation, getAccountSlot: () => 'u0' });
            await bridge.handleWindowMessage({ origin: 'https://gemini.google.com', data: { type: 'GEMINI_NETWORK_BATCHEXECUTE', payload: {
                text, slot: 'u0', listRequest: request, requestedAt, requestAccountObservation: ACCOUNT_OBSERVATION
            } } } as MessageEvent);
        }
        assert.deepEqual(await getCoverage(account, 'recent'), { range: null });
        const rows = await StorageService.getConversations(account);
        assert.equal(rows.length, 2); outcomes.push(rows);
    });
    assert.deepEqual(outcomes[0], outcomes[1]);
});
test('Index commit failure prevents coverage admission and rejects the L1 operation', async () => fixture(async state => {
    state.fail = true;
    await assert.rejects(ingestPageObservation(geminiListObservation(parseList(text), request, account, false, Date.now() + 1), account), /disk failed/);
    assert.equal(await getCoverage(account, 'recent'), null);
    state.fail = false;
    await ingestPageObservation(geminiListObservation(parseList(text), request, account, false, Date.now() + 2), account);
    assert.deepEqual(await getCoverage(account, 'recent'), { range: null });
}));
test('request identity conflicts and cancelled passive requests cannot write coverage', async () => fixture(async () => {
    const bridge = init({ ingestPageObservation, getAccountSlot: () => 'u0' });
    await bridge.handleWindowMessage({ origin: 'https://gemini.google.com', data: { type: 'GEMINI_NETWORK_BATCHEXECUTE', payload: {
        text, slot: 'u0', listRequest: request, requestedAt: Date.now() + 1,
        requestAccountObservation: { providerId: 'gemini', providerAccountId: '10000000002' }
    } } } as MessageEvent);
    assert.equal(await getCoverage(account, 'recent'), null);
    contentContext.abort();
    await assert.rejects(ingestPageObservation(geminiListObservation(parseList(text), request, account, false, Date.now() - 10), account), /cancelled/);
}));

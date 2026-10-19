import { catalogMock } from './helpers/catalogMock.js';
import { accountRuntime, ACCOUNT_UUID, ACCOUNT_OBSERVATION } from './helpers/accountRuntime.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestRpcList, markConfirmedDeleted } from '../src/content/syncEngine.js';
import { init } from '../src/content/messageBridge.js';
import { parseList } from '../src/core/parsers/gemini/rpc/parseList.js';
import { __setModuleOverride, __clearModuleOverrides } from '../src/core/utils/moduleOverrides.js';
import type { DomainConversationIndex as Conversation } from '../src/core/domain/conversationIndex.js';
import { indexFixture } from './helpers/indexFixture.js';

const text = JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, null,
    [['c_abcdef123456', 'Server title', null, null, null, [1700000000, 0]]]])]]);
const batch = () => parseList(text).conversations;
async function fixture(run: (state: { availability: Record<string, string>; records: Conversation[]; fail: boolean; writes: number; reads: number; checkpoints: number }) => Promise<void>) {
    const state = { availability: {} as Record<string, string>, records: [indexFixture({ id: 'abcdef123456', title: 'Old title', cloudAvailability: 'unlisted' })], fail: false, writes: 0, reads: 0, checkpoints: 0 };
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: { sendMessage: async () => {} }, storage: catalogMock(() => { state.reads++; return state.records; }, list => { if (state.fail) throw new Error('disk failed'); state.records = list; state.writes++; }) } });
    __setModuleOverride('StorageService', {
        async transactConversations(slot: string, apply: (items: Conversation[]) => { list: Conversation[]; changed: number } | null) {
            assert.equal(slot, ACCOUNT_UUID);
            if (state.fail) throw new Error('disk failed');
            const result = apply(state.records);
            if (result) { state.records = result.list; state.writes++; }
            return { list: state.records, written: !!result, changed: result?.changed || 0 };
        },
        async setConversationAvailability(_slot: string, id: string, value: string) { state.availability[id] = value; },
        async setLastSync() {}, async updateAccountSlot() {},
        async getScanCheckpoint() { return 1700000000000; },
        async setScanCheckpoint() { state.checkpoints++; }
    });
    const runtime = accountRuntime('u2');
    try { await run(state); } finally {
        runtime.restore();
        __clearModuleOverrides();
        if (previous) Object.defineProperty(globalThis, 'chrome', previous);
        else Reflect.deleteProperty(globalThis, 'chrome');
    }
}

test('RPC lists from the bridge and scanner persist identical titles, time, source and availability', async () => fixture(async state => {
    const bridge = init({ ingestRpcList, getAccountSlot: () => 'u2' });
    await bridge.handleWindowMessage({ origin: location.origin, data: { type: 'GEMINI_NETWORK_BATCHEXECUTE', payload: { text, slot: 'u2', requestAccountObservation: ACCOUNT_OBSERVATION } } } as MessageEvent);
    const sniffed = structuredClone(state.records);
    assert.equal(sniffed[0].title, 'Server title');
    assert.equal(sniffed[0].titleSource, 'provider');
    assert.equal(sniffed[0].updatedAt, 1700000000000, 'server-authored activity must survive ingest');
    assert.equal('source' in sniffed[0], false);
    assert.equal(state.availability[sniffed[0].key.conversationId], 'available');
    await ingestRpcList(batch(), ACCOUNT_UUID);
    assert.deepEqual(state.records, sniffed);
    assert.equal(state.checkpoints, 0);
}));

test('RPC receipts reject invalid/stale observations and acknowledge fresh authoritative cloud restoration', async () => fixture(async state => {
    state.records.push(indexFixture({ id: 'deleted123456', title: 'Archived', timestamp: 1690000000000, cloudAvailability: 'deleted' }));
    const good = batch()[0];
    const items = [good, { ...good, id: 'c_unknown' }, { ...good, id: 'deleted123456' }];
    markConfirmedDeleted(ACCOUNT_UUID, 'deleted123456');
    const stale = await ingestRpcList(items, ACCOUNT_UUID, 0);
    assert.deepEqual(stale, { count: 2, accepted: 1, rejected: 2, persisted: 1 });
    assert.equal(state.records.find(item => item.key.conversationId === 'deleted123456')?.title, 'Archived');
    const fresh = await ingestRpcList(items, ACCOUNT_UUID, Date.now() + 1000);
    assert.deepEqual(fresh, { count: 2, accepted: 2, rejected: 1, persisted: 2 });
    assert.equal(state.availability.deleted123456, 'available');
    assert.equal(state.records.find(item => item.key.conversationId === 'deleted123456')?.title, 'Server title');
}));

test('scanner sees storage failures; bridge catches them at its event boundary and a retry commits', async () => fixture(async state => {
    state.fail = true;
    await assert.rejects(ingestRpcList(batch(), ACCOUNT_UUID), /disk failed/);
    const bridge = init({ ingestRpcList });
    await bridge.handleWindowMessage({ origin: location.origin, data: { type: 'GEMINI_NETWORK_BATCHEXECUTE', payload: { text, slot: 'u2', requestAccountObservation: ACCOUNT_OBSERVATION } } } as MessageEvent);
    assert.equal(state.writes, 0);
    assert.equal(state.checkpoints, 0);
    state.fail = false;
    assert.equal((await ingestRpcList(batch(), ACCOUNT_UUID)).persisted, 1);
}));


test('Index capture reads once for admission and once for the UI total, including unchanged batches', async () => fixture(async state => {
    const incoming = [{ ...batch()[0], id: 'c_another123456' }];
    const first = await ingestRpcList(incoming, ACCOUNT_UUID);
    assert.equal(first.count, 2, 'UI total includes existing conversations outside this batch');
    assert.equal(first.persisted, 1);
    assert.equal(state.reads, 2);
    assert.equal(state.writes, 1);
    const repeated = await ingestRpcList(incoming, ACCOUNT_UUID);
    assert.deepEqual(repeated, first);
    assert.equal(state.reads, 4);
    assert.equal(state.writes, 1, 'L2 still skips unchanged canonical Index writes');
}));

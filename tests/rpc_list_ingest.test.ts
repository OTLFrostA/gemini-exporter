import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestRpcList } from '../src/content/syncEngine.js';
import { init } from '../src/content/messageBridge.js';
import { parseList } from '../src/core/parsers/gemini/rpc/parseList.js';
import { __setModuleOverride, __clearModuleOverrides } from '../src/core/utils/moduleOverrides.js';
import type { Conversation } from '../src/types/conversation.js';

const text = JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, null,
    [['c_abcdef123456', 'Server title', null, null, null, [1700000000, 0]]]])]]);
const batch = () => parseList(text).conversations;
async function fixture(run: (state: { records: Conversation[]; fail: boolean; writes: number; checkpoints: number }) => Promise<void>) {
    const state = { records: [{ id: 'abcdef123456', title: 'Old title', cloudAvailability: 'unlisted' }] as Conversation[], fail: false, writes: 0, checkpoints: 0 };
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: { sendMessage: async () => {} } } });
    __setModuleOverride('StorageService', {
        async transactConversations(slot: string, apply: (items: Conversation[]) => { list: Conversation[]; changed: number } | null) {
            assert.equal(slot, 'u2');
            if (state.fail) throw new Error('disk failed');
            const result = apply(state.records);
            if (result) { state.records = result.list; state.writes++; }
            return { list: state.records, written: !!result, changed: result?.changed || 0 };
        },
        async setLastSync() {}, async updateAccountSlot() {},
        async getScanCheckpoint() { return 1700000000000; },
        async setScanCheckpoint() { state.checkpoints++; }
    });
    try { await run(state); } finally {
        __clearModuleOverrides();
        if (previous) Object.defineProperty(globalThis, 'chrome', previous);
        else Reflect.deleteProperty(globalThis, 'chrome');
    }
}

test('RPC lists from the bridge and scanner persist identical titles, time, source and availability', async () => fixture(async state => {
    const bridge = init({ ingestRpcList, getAccountSlot: () => 'u2' });
    await bridge.handleWindowMessage({ data: { type: 'GEMINI_NETWORK_BATCHEXECUTE', payload: { text, slot: 'u2' } } } as MessageEvent);
    const sniffed = structuredClone(state.records);
    assert.equal(sniffed[0].title, 'Server title');
    assert.equal(sniffed[0].source, 'network-list');
    assert.equal(sniffed[0].cloudAvailability, undefined);
    await ingestRpcList(batch(), 'u2');
    assert.deepEqual(state.records, sniffed);
    assert.equal(state.checkpoints, 0);
}));

test('RPC ingest receipts reject invalid and confirmed-deleted IDs without claiming they persisted', async () => fixture(async state => {
    state.records.push({ id: 'deleted123456', title: 'Archived', timestamp: 1690000000000, cloudAvailability: 'deleted' });
    const good = batch()[0];
    const receipt = await ingestRpcList([good, { ...good, id: 'c_unknown' }, { ...good, id: 'deleted123456' }], 'u2');
    assert.deepEqual(receipt, { count: 2, accepted: 1, rejected: 2, persisted: 1 });
    assert.equal(state.records.find(item => item.id === 'deleted123456')?.title, 'Archived');
}));

test('scanner sees storage failures; bridge catches them at its event boundary and a retry commits', async () => fixture(async state => {
    state.fail = true;
    await assert.rejects(ingestRpcList(batch(), 'u2'), /disk failed/);
    const bridge = init({ ingestRpcList });
    await bridge.handleWindowMessage({ data: { type: 'GEMINI_NETWORK_BATCHEXECUTE', payload: { text, slot: 'u2' } } } as MessageEvent);
    assert.equal(state.writes, 0);
    assert.equal(state.checkpoints, 0);
    state.fail = false;
    assert.equal((await ingestRpcList(batch(), 'u2')).persisted, 1);
}));

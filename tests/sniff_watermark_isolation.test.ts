/** Passive captures only save records; they cannot establish or advance scan coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestRpcList } from '../src/content/syncEngine.js';
import { __setModuleOverride, __clearModuleOverrides } from '../src/core/utils/moduleOverrides.js';
import type { Conversation } from '../src/types/conversation.js';

test('interleaved repeated RPC captures preserve authoritative timestamps without accessing coverage', async () => {
    let records: Conversation[] = [];
    __setModuleOverride('StorageService', {
        async transactConversations(_slot: string, apply: (items: Conversation[]) => { list: Conversation[]; changed: number }) {
            records = apply(records).list; return { list: records, changed: 0, written: true };
        },
        async setLastSync() {}, async updateAccountSlot() {},
        async beginScanCoverage() { throw new Error('Sniff must not begin coverage'); },
        async finishScanCoverage() { throw new Error('Sniff must not finish coverage'); },
        async preparePageCoverage() { throw new Error('Sniff must not prepare coverage'); },
        async recordPageCoverage() { throw new Error('Sniff must not advance coverage'); }
    });
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: { sendMessage: async () => {} } } });
    const item = { id: 'abcdef123', title: 'A', titleSource: 'rpc' as const, titles: { rpc: 'A' },
        timestamp: 1700000000000, updatedAt: 1700000000000, createdAt: null, chatTime: 1700000000000, messageCount: 1, url: '' };
    try {
        await ingestRpcList([item], 'u0');
        await ingestRpcList([{ ...item, timestamp: item.timestamp - 1000, updatedAt: item.updatedAt - 1000 }], 'u0');
        assert.equal(records.length, 1, 'an older repeated capture must not create a second chat');
        assert.equal(records[0].updatedAt, item.updatedAt, 'an older capture must not regress updatedAt');
        assert.equal(records[0].timestamp, item.timestamp, 'an older capture must not regress timestamp');
        await ingestRpcList([{ ...item }], 'u0');
        assert.equal(records.length, 1);
        assert.equal(records[0].updatedAt, item.updatedAt);
        assert.equal(records[0].source, 'network-list');
    } finally {
        __clearModuleOverrides();
        if (previous) Object.defineProperty(globalThis, 'chrome', previous);
        else Reflect.deleteProperty(globalThis, 'chrome');
    }
});

/** Passive captures only save records; they cannot establish or advance scan coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestRpcList } from '../src/content/syncEngine.js';
import { __setModuleOverride, __clearModuleOverrides } from '../src/core/utils/moduleOverrides.js';
import type { DomainConversationIndex as Conversation } from '../src/core/domain/conversationIndex.js';
import { parseGeminiIndexObservation } from '../src/core/parsers/gemini/parseIndexObservation.js';

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
    const item = parseGeminiIndexObservation({ id: 'abcdef123', title: 'A', titleSource: 'rpc',
        updatedAt: 1700000000000 }, 'rpc-list');
    try {
        await ingestRpcList([item], '10000000-0000-4000-8000-000000000001');
        await ingestRpcList([{ ...item, updatedAt: item.updatedAt! - 1000 }], '10000000-0000-4000-8000-000000000001');
        assert.equal(records.length, 1, 'an older repeated capture must not create a second chat');
        assert.equal(records[0].updatedAt, item.updatedAt, 'an older capture must not regress updatedAt');
        await ingestRpcList([{ ...item }], '10000000-0000-4000-8000-000000000001');
        assert.equal(records.length, 1);
        assert.equal(records[0].updatedAt, item.updatedAt);
        assert.equal(records[0].cloudAvailability, 'available');
    } finally {
        __clearModuleOverrides();
        if (previous) Object.defineProperty(globalThis, 'chrome', previous);
        else Reflect.deleteProperty(globalThis, 'chrome');
    }
});

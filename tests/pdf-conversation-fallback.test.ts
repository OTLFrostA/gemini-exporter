import { useIndexStorage } from './helpers/indexStorage.js';
import { StorageService as catalogStorage } from '../src/core/storage/storageService.js';
useIndexStorage();
const { historicalFixture } = require('./helpers/nativeFixture.js');
export {};
const test = require('node:test');
const assert = require('node:assert/strict');
const { preparePdfItem, extractChatFromDetailResult, PDF_NO_MESSAGES } = require('../src/core/export/pdf/prepareItem.js');
const { resolveConversationData } = require('../src/core/engine/export/batchWorker.js');
const store = require('../src/core/storage/domain/domainStore.js');
const message = (text: string) => ({ id: 'm1', role: 'model', content: text });

test('PDF successful empty online response recovers Takeout messages before normalization', async () => {
    const result = await preparePdfItem({ id: 'fallback' }, {
        includeAssets: false,
        fetchChatDetail: async () => ({ success: true, results: [historicalFixture({ messages: [] })] }),
        takeoutEngine: { getTakeoutOfflineChat: () => historicalFixture({ id: 'fallback', messages: [message('Recovered Takeout')] }) },
    });
    assert.equal(result.ok, true);
    assert.match(JSON.stringify(result.document), /Recovered Takeout/);
});

test('shared acquisition prefers online and uses cache only after unusable Takeout', async () => {
    let calls = 0;
    const takeout = { getTakeoutOfflineChat: () => { calls++; return historicalFixture({ id: 'fallback', messages: [] }); } };
    const online = historicalFixture({ id: 'fallback', messages: [message('online')] });
    assert.equal((await resolveConversationData(online, 'fallback', null, takeout)).result, online);
    assert.equal(calls, 0);
    await catalogStorage.setNativeConversations('u0', [historicalFixture({ id: 'fallback', messages: [message('cache')] })]);
    try {
        const recovered = await resolveConversationData({ messages: [] }, 'fallback', null, takeout);
        assert.match(JSON.stringify(recovered.result.conversation.messages), /cache/);
        const pdf = await preparePdfItem({ id: 'fallback' }, {
            includeAssets: false, takeoutEngine: takeout,
            fetchChatDetail: async () => ({ success: false, error: 'offline' }),
        });
        assert.equal(pdf.ok, true);
        assert.match(JSON.stringify(pdf.document), /cache/);
    } finally { store.__clearDomainMemory(); }
});

test('PDF reports no messages only after all sources fail', async () => {
    const result = await preparePdfItem({ id: 'missing' }, {
        includeAssets: false,
        fetchChatDetail: async () => ({ success: true, results: [historicalFixture({ messages: [] })] }),
        takeoutEngine: { getTakeoutOfflineChat: () => null },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, new RegExp(PDF_NO_MESSAGES));
});

test('metadata-only selected item triggers detail fetch and prepares PDF document', async () => {
    let fetched = false;
    const result = await preparePdfItem({ id: 'meta-only', title: 'Meta Only Title' }, {
        includeAssets: false,
        fetchChatDetail: async (item: { id: string; title?: string }) => {
            fetched = true;
            assert.equal(item.id, 'meta-only');
            return {
                success: true,
                results: [historicalFixture({
                    id: 'meta-only',
                    title: 'Authoritative Title',
                    messages: [message('Detail payload content')],
                })],
            };
        },
    });
    assert.equal(fetched, true);
    assert.equal(result.ok, true);
    assert.match(JSON.stringify(result.document), /Detail payload content/);
    assert.equal(result.id, 'meta-only');
});

test('extractChatFromDetailResult and preparePdfItem: results[0] wins over chat', async () => {
    const fromResults = { id: 'r1', messages: [message('winner from results')] };
    const fromChat = { id: 'c1', messages: [message('loser from chat')] };
    const fallback = { id: 'f1', messages: [message('loser from fallback')] };

    const extracted = extractChatFromDetailResult(
        { success: true, results: [historicalFixture(fromResults)], chat: fromChat },
        'norm-id',
        fallback,
    );
    assert.equal(extracted.conversation.id, 'r1');
    assert.match(JSON.stringify(extracted.conversation.messages), /winner from results/);

    const result = await preparePdfItem({ id: 'precedence' }, {
        includeAssets: false,
        fetchChatDetail: async () => ({
            success: true,
            results: [historicalFixture(fromResults)],
            chat: fromChat,
        }),
    });
    assert.equal(result.ok, true);
    assert.match(JSON.stringify(result.document), /winner from results/);
    assert.doesNotMatch(JSON.stringify(result.document), /loser from chat/);
});

test('acquisition reports provenance beside the result and never mutates parser objects', async () => {
    const parsed = historicalFixture({ id: 'provenance', messages: [message('source')] });
    Object.freeze(parsed);
    const unspecified = await resolveConversationData(parsed, 'provenance');
    assert.equal(unspecified.result, parsed);
    assert.equal(unspecified.source, 'unspecified');
    const online = await resolveConversationData(parsed, 'provenance', null, null, 'u0', () => {}, 'online');
    assert.equal(online.source, 'online');
    const takeout = await resolveConversationData(undefined, 'provenance', null, { getTakeoutOfflineChat: () => parsed });
    assert.equal(takeout.result, parsed);
    assert.equal(takeout.source, 'takeout');
    await catalogStorage.setNativeConversations('u0', [parsed]);
    try {
        const snapshot = await resolveConversationData(undefined, 'provenance');
        assert.equal(snapshot.source, 'local_snapshot');
        assert.equal('resolvedSource' in snapshot.result, false);
        const direct = await preparePdfItem(parsed, { includeAssets: false });
        assert.equal(direct.usedLocalSnapshot, false);
        const explicit = await preparePdfItem(parsed, { includeAssets: false, source: 'local_snapshot' });
        assert.equal(explicit.usedLocalSnapshot, true);
    } finally { store.__clearDomainMemory(); }
    assert.equal('resolvedSource' in parsed, false);
});

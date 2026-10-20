import { admitFixture, admitFixtures } from './helpers/admitFixture.js';
import * as DomainAdmission from '../src/l2/ingestion.js';
import { acquiredReply } from './helpers/acquisitionFixture.js';
import { useIndexStorage } from './helpers/indexStorage.js';
import { StorageService as catalogStorage } from '../src/l3a/storageService.js';
useIndexStorage();
const { historicalFixture } = require('./helpers/nativeFixture.js');
export {};
const test = require('node:test');
const assert = require('node:assert/strict');
const { preparePdfItem, extractChatFromDetailResult, PDF_NO_MESSAGES } = require('./helpers/pdfAcquisitionFixture.js');
const { resolveConversationData } = require('../src/core/engine/export/batchWorker.js');
const store = require('../src/l3a/domain/domainStore.js');
const message = (text: string) => ({ id: 'm1', role: 'model', content: text });

test('PDF successful empty online response selects Takeout rather than reporting a cache fallback', async () => {
    const id = 'pdf-takeout-044', slot = '10000000-0000-4000-8000-000000000001';
    const takeout = historicalFixture({ id, completeness: { status: 'complete' }, messages: [message('Recovered Takeout')] });
    let takeoutReads = 0;
    await admitFixtures(slot, [takeout]);
    try {
        const result = await preparePdfItem({ id }, {
            accountId: slot,
            includeAssets: false,
            fetchChatDetail: async () => await acquiredReply(({ success: true, results: [historicalFixture({ id, messages: [] })] })),
            takeoutEngine: {
                getTakeoutOfflineChat: (requestedId: string, requestedSlot?: string | null) => {
                    assert.equal(requestedId, id);
                    assert.equal(requestedSlot, slot);
                    takeoutReads++;
                    return takeout;
                },
            },
        });
        assert.equal(takeoutReads, 1, 'empty online results must actually consult the Takeout source');
        assert.equal(result.ok, true);
        assert.match(JSON.stringify(result.document), /Recovered Takeout/);
        assert.equal(result.usedLocalSnapshot, false, 'Takeout recovery must not be mislabeled as a local snapshot');
    } finally { store.__clearDomainMemory(); }
});

test('shared acquisition prefers valid online input and uses local cache after unusable Takeout', async () => {
    const id = 'pdf-cache-044', slot = '10000000-0000-4000-8000-000000000001';
    let calls = 0;
    const takeout = { getTakeoutOfflineChat: () => { calls++; return historicalFixture({ id, messages: [] }); } };
    const online = historicalFixture({ id, messages: [message('online')] });
    assert.equal((await resolveConversationData(online, id, null, takeout, slot)).result, online);
    assert.equal(calls, 0, 'valid online input must not consult Takeout');
    await admitFixtures(slot, [historicalFixture({ id, messages: [message('cache')] })]);
    try {
        const recovered = await resolveConversationData({ messages: [] }, id, null, takeout, slot);
        assert.equal(calls, 1, 'unusable source must attempt Takeout before local cache');
        assert.equal(recovered.source, 'local_snapshot');
        assert.match(JSON.stringify(recovered.result.conversation.detail.messages), /cache/);
        const pdf = await preparePdfItem({ id }, {
            accountId: slot, includeAssets: false, takeoutEngine: takeout,
            fetchChatDetail: async () => await acquiredReply(({ success: false, error: 'offline' })),
        });
        assert.equal(calls, 2);
        assert.equal(pdf.ok, true);
        assert.equal(pdf.usedLocalSnapshot, true, 'cached PDF export must retain its provenance');
        assert.match(JSON.stringify(pdf.document), /cache/);
    } finally { store.__clearDomainMemory(); }
});

test('PDF reports no messages only after all sources fail', async () => {
    const result = await preparePdfItem({ id: 'missing' }, { accountId: '10000000-0000-4000-8000-000000000001', ...({
        includeAssets: false,
        fetchChatDetail: async () => await acquiredReply(({ success: true, results: [historicalFixture({ messages: [] })] })),
        takeoutEngine: { getTakeoutOfflineChat: () => null },
    }) });
    assert.equal(result.ok, false);
    assert.match(result.error, new RegExp(PDF_NO_MESSAGES));
});

test('metadata-only selected item triggers detail fetch and prepares PDF document', async () => {
    let fetched = false;
    const result = await preparePdfItem({ id: 'meta-only', title: 'Meta Only Title' }, { accountId: '10000000-0000-4000-8000-000000000001', ...({
        includeAssets: false,
        fetchChatDetail: async (item: { id: string; title?: string }) => {
            fetched = true;
            assert.equal(item.id, 'meta-only');
            return await acquiredReply({
                success: true,
                results: [historicalFixture({
                    id: 'meta-only',
                    title: 'Authoritative Title',
                    messages: [message('Detail payload content')],
                })],
            });
        },
    }) });
    assert.equal(fetched, true);
    assert.equal(result.ok, true);
    assert.match(JSON.stringify(result.document), /Detail payload content/);
    assert.equal(result.id, 'meta-only');
});

test('detail extraction prefers the native results envelope over a competing native chat', async () => {
    const id = 'pdf-precedence-044';
    const fromResults = historicalFixture({ id, messages: [message('winner from results')] });
    const fromChat = historicalFixture({ id, messages: [message('loser from chat')] });

    const extracted = extractChatFromDetailResult(
        { success: true, results: [fromResults], chat: fromChat }, id,
    );
    assert.equal(extracted, fromResults, 'both candidates must be valid native payloads');
    assert.match(JSON.stringify(extracted.conversation.detail.messages), /winner from results/);
    assert.equal(
        extractChatFromDetailResult({ success: true, results: [{ id, messages: [] }], chat: fromChat }, id),
        null, 'a malformed results envelope must not silently switch to a different representation'
    );

    const result = await preparePdfItem({ id }, {
        accountId: '10000000-0000-4000-8000-000000000001', includeAssets: false,
        fetchChatDetail: async () => await acquiredReply(({ success: true, results: [fromResults], chat: fromChat })),
    });
    assert.equal(result.ok, true);
    assert.match(JSON.stringify(result.document), /winner from results/);
    assert.doesNotMatch(JSON.stringify(result.document), /loser from chat/);
});

test('acquisition reports provenance beside the result and never mutates parser objects', async () => {
    const parsed = historicalFixture({ id: 'provenance', messages: [message('source')] });
    const original = structuredClone(parsed);
    Object.freeze(parsed);
    const unspecified = await resolveConversationData(parsed, 'provenance', null, null, '10000000-0000-4000-8000-000000000001');
    assert.equal(unspecified.result, parsed);
    assert.equal(unspecified.source, 'unspecified');
    const online = await resolveConversationData(parsed, 'provenance', null, null, '10000000-0000-4000-8000-000000000001', () => {}, 'online');
    assert.equal(online.source, 'online');
    const takeout = await resolveConversationData(undefined, 'provenance', null, { getTakeoutOfflineChat: () => parsed }, '10000000-0000-4000-8000-000000000001');
    assert.equal(takeout.result, parsed);
    assert.equal(takeout.source, 'takeout');
    await admitFixtures('10000000-0000-4000-8000-000000000001', [parsed]);
    try {
        const snapshot = await resolveConversationData(undefined, 'provenance', null, null, '10000000-0000-4000-8000-000000000001');
        assert.equal(snapshot.source, 'local_snapshot');
        assert.equal('resolvedSource' in snapshot.result, false);
        const direct = await preparePdfItem(parsed, { accountId: '10000000-0000-4000-8000-000000000001', ...({ includeAssets: false }) });
        assert.equal(direct.usedLocalSnapshot, false);
        const explicit = await preparePdfItem(parsed, { accountId: '10000000-0000-4000-8000-000000000001', ...({ includeAssets: false, source: 'local_snapshot' }) });
        assert.equal(explicit.usedLocalSnapshot, true);
    } finally { store.__clearDomainMemory(); }
    assert.equal('resolvedSource' in parsed, false);
    assert.deepEqual(parsed, original, 'acquisition and rendering must not modify the supplied parser result');
});

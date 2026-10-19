import { admitFixture, admitFixtures } from './helpers/admitFixture.js';
import * as DomainAdmission from '../src/core/domain/ingestion.js';
import { sourceIndex } from './helpers/domainFixture.js';
import { fixtureAccount, fixtureKey } from './helpers/domainFixture.js';
import { useIndexStorage } from './helpers/indexStorage.js';
import { StorageService as catalogStorage } from '../src/core/storage/storageService.js';
useIndexStorage();
import { indexFixture } from './helpers/indexFixture.js';
import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { __clearDomainMemory, storageIdentity } from '../src/core/storage/domain/domainStore.js';
import { getDomainResource } from '../src/core/storage/domain/resourceContext.js';
import { getDomainConversationResult } from '../src/core/storage/domain/nativePersistence.js';
import { resolveChat, fetchChatDetail } from '../src/core/engine/export/batchWorker.js';
import { historicalFixture } from './helpers/nativeFixture.js';
import { __setModuleOverride, __clearModuleOverrides } from '../src/core/utils/moduleOverrides.js';
import { upsertConversations, ingestRpcList } from '../src/content/syncEngine.js';
import type { ResourceConversationParseResult } from '../src/core/parsers/parsingResult.js';

test('cloud-deleted archive exports durable body and resource bytes without fetching cloud or deleting metadata', async () => {
    __clearDomainMemory();
    const source: ResourceConversationParseResult = { account: fixtureAccount(), sourceVersion: 1, conversation: validateParserDomain({ index: { key: fixtureKey(String('retained'), 'gemini'),   titleSource: "derived",   title: 'Saved conversation' }, detail: { key: fixtureKey(String('retained'), 'gemini'), quality: { status: 'unknown' }, assets: [{ id: 'image', kind: 'image', sourceUri: 'assets/image.png' }], messages: [
            { role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Archived question' }] }] },
            { role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Archived answer' }, { type: 'image', assetId: 'image' }] }], attachmentIds: ['image'] }
        ] } }), diagnostics: [], resourceHints: {}, acquisitionHints: {} };
    await admitFixtures('10000000-0000-4000-8000-000000000001', [source]);
    await admitFixture('10000000-0000-4000-8000-000000000001', source, [{ assetId: 'image', bytes: new Uint8Array([1, 2, 3]) }]);
    await admitFixture('10000000-0000-4000-8000-000000000002', historicalFixture({ id: 'retained', messages: [{ role: 'user', content: 'Other account' }] }, { account: fixtureAccount('gemini', '10000000-0000-4000-8000-000000000002') }));
    let deleted = false; let fetched = false;
    __setModuleOverride('StorageService', { removeConversation: async () => { deleted = true; } });
    try {
        const result = await fetchChatDetail({ id: 'retained', cloudAvailability: 'deleted' }, 0, 1, '10000000-0000-4000-8000-000000000001', false, 'markdown', null,
            { tabService: { sendToGeminiTab: async () => { fetched = true; throw new Error('Must not fetch cloud'); } } });
        assert.ok(result && typeof result === 'object' && 'source' in result && 'results' in result);
        assert.equal(result.source, 'local-cache');
        assert.ok(Array.isArray(result.results));
        const resolved = await resolveChat(result.results[0], { id: 'retained' }, null, null, '10000000-0000-4000-8000-000000000001');
        assert.equal(resolved.isError, false);
        if (!resolved.isError) assert.deepEqual(resolved.chat.conversation.detail.messages, source.conversation.detail.messages);
        assert.equal(fetched, false); assert.equal(deleted, false);
        assert.deepEqual(await getDomainResource(storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', 'retained'), 'image'), new Uint8Array([1, 2, 3]));
        assert.match(JSON.stringify((await getDomainConversationResult('10000000-0000-4000-8000-000000000002', 'retained'))?.conversation), /Other account/);
        const logs: string[] = [];
        const fallback = await resolveChat({ error: 'HTTP 404', isDeleted: true }, { id: 'retained' }, null, null, '10000000-0000-4000-8000-000000000001', undefined, message => logs.push(message));
        assert.equal(fallback.isError, false); assert.match(logs.join(' '), /local snapshot/);
        const onlyMetadata = await resolveChat({ error: 'HTTP 404', isDeleted: true }, { id: 'missing-body' }, null, null, '10000000-0000-4000-8000-000000000001');
        assert.equal(onlyMetadata.isError, true); assert.equal(deleted, false);
    } finally { __clearModuleOverrides(); __clearDomainMemory(); }
});

test('failed persistence keeps previous records and subsequent queued writes succeed', async () => {
    const slot = '10000000-0000-4000-8000-000000000001';
    await catalogStorage.setConversations(slot, [indexFixture({ id: 'existing', title: 'Preserved', updatedAt: 100 })]);
    const set = chrome.storage.local.set;
    let fail = true;
    chrome.storage.local.set = async values => {
        if (fail && ('conversations_' + slot) in values) throw new Error('Injected persistence failure');
        return set(values);
    };
    try {
        await assert.rejects(ingestRpcList([sourceIndex(indexFixture({ id: 'incoming', title: 'Incoming', titleSource: 'rpc', updatedAt: 2000 }))], slot), /Injected/);
        assert.deepEqual((await catalogStorage.getConversations(slot)).map(c => c.key.conversationId), ['existing']);
        fail = false;
        await upsertConversations([{ id: 'retry', title: 'Retry' }], 'retry', slot);
        const records = await catalogStorage.getConversations(slot);
        assert.ok(records.some(c => c.key.conversationId === 'retry')); assert.ok(records.some(c => c.key.conversationId === 'existing'));
    } finally { chrome.storage.local.set = set; }
});

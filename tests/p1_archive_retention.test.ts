import { useIndexStorage } from './helpers/indexStorage.js';
import { StorageService as catalogStorage } from '../src/core/storage/storageService.js';
useIndexStorage();
import { indexFixture } from './helpers/indexFixture.js';
import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveDomainConversation, __clearDomainMemory, getDomainResource, storageIdentity } from '../src/core/storage/domain/domainStore.js';
import { getDomainConversationResult } from '../src/core/storage/domain/nativePersistence.js';
import { resolveChat, fetchChatDetail } from '../src/core/engine/export/batchWorker.js';
import { historicalFixture } from './helpers/nativeFixture.js';
import { __setModuleOverride, __clearModuleOverrides } from '../src/core/utils/moduleOverrides.js';
import { upsertConversations, ingestRpcList } from '../src/content/syncEngine.js';
import type { ResourceConversationParseResult } from '../src/core/parsers/parsingResult.js';

test('cloud-deleted archive exports durable body and resource bytes without fetching cloud or deleting metadata', async () => {
    __clearDomainMemory();
    const source: ResourceConversationParseResult = { sourceVersion: 1, conversation: validateParserDomain({ index: { cloudAvailability: 'unknown', hasTakeoutImport: false, titleSource: 'legacy', providerId: 'gemini', id: 'retained', title: 'Saved conversation' }, detail: { quality: { status: 'unknown' }, assets: [{ id: 'image', kind: 'image', sourceUri: 'assets/image.png' }], messages: [
            { role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Archived question' }] }] },
            { role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Archived answer' }, { type: 'image', assetId: 'image' }] }], attachmentIds: ['image'] }
        ] } }), diagnostics: [], resourceHints: {}, acquisitionHints: {} };
    await catalogStorage.setNativeConversations('10000000-0000-4000-8000-000000000001', [source]);
    await saveDomainConversation('10000000-0000-4000-8000-000000000001', source, [{ assetId: 'image', bytes: new Uint8Array([1, 2, 3]) }]);
    await saveDomainConversation('10000000-0000-4000-8000-000000000002', historicalFixture({ id: 'retained', messages: [{ role: 'user', content: 'Other account' }] }));
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

test('failed persistence never advances checkpoint, keeps previous records, and subsequent queued writes succeed', async () => {
    let checkpoint = 1000;
    let records = [{ id: 'existing', title: 'Preserved', timestamp: 100 }];
    let fail = true;
    __setModuleOverride('StorageService', {
        async transactConversations(_slot: string, apply: (items: typeof records) => { list: typeof records; changed: number }) {
            if (fail) throw new Error('Injected persistence failure');
            records = apply(records).list; return { list: records, written: true };
        },
        async setLastSync() {}, async updateAccountSlot() {},
        async getScanCheckpoint() { return checkpoint; }, async setScanCheckpoint(_slot: string, ts: number) { checkpoint = ts; }
    });
    try {
        await assert.rejects(ingestRpcList([indexFixture({ id: 'incoming', title: 'Incoming', titleSource: 'rpc', titles: { rpc: 'Incoming' }, createdAt: null, updatedAt: 2000, timestamp: 2000, chatTime: 2000, messageCount: 1, url: '' })], '10000000-0000-4000-8000-000000000001'), /Injected/);
        assert.equal(checkpoint, 1000); assert.deepEqual(records.map(c => c.id), ['existing']);
        fail = false;
        await upsertConversations([{ id: 'retry', title: 'Retry' }], 'retry', true, '10000000-0000-4000-8000-000000000001');
        assert.ok(records.some(c => c.id === 'retry')); assert.ok(records.some(c => c.id === 'existing'));
    } finally { __clearModuleOverrides(); }
});

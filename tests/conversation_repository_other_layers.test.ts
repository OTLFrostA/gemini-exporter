// Export preparation/completion scenarios retained for their Application owner; normal full discovery still runs these.
import { putDetail, getDetail } from '../src/core/storage/domain/domainStore.js';
import { admitFixture, admitFixtures } from './helpers/admitFixture.js';
import * as DomainAdmission from '../src/core/domain/ingestion.js';
import { bindFixture, fixtureAccountFor } from './helpers/domainFixture.js';
import { fixtureAccount } from './helpers/domainFixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { indexStorage } from './helpers/indexStorage.js';
import { indexFixture } from './helpers/indexFixture.js';
import { historicalFixture } from './helpers/nativeFixture.js';
import { StorageService as storage } from '../src/core/storage/storageService.js';
import { storageIdentity } from '../src/core/storage/domain/domainStore.js';
import { readFixture } from './helpers/admitFixture.js';
import { createConversationRepository } from '../src/core/storage/conversationRepository.js';
import { preparePdfItem } from './helpers/pdfAcquisitionFixture.js';
import { resolveChat } from '../src/core/engine/export/batchWorker.js';
import { buildExportCompletion, completeConversationExport } from '../src/core/engine/export/exportCompletion.js';
import { finalizeChatExport } from '../src/core/engine/export/sessionRecovery.js';
import { withConversationMetadata } from '../src/core/domain/runtimeValidation.js';

const scope = { providerId: 'gemini', accountId: '10000000-0000-4000-8000-000000000001' };
const parsed = () => ({   ...historicalFixture({ id: 'chat', title: 'Old title', titleSource: 'rpc', updatedAt: 100,
    completeness: { status: 'complete' }, messages: [{ role: 'user', content: 'Question' }, { role: 'model', content: 'Answer' }] }), sourceVersion: 100 });


test('cached projections cannot roll back newer metadata passed by a caller', async () => {
    const env = indexStorage();
    try {
        const cached = parsed();
        await admitFixture(scope.accountId, cached);
        const current = indexFixture({ id: 'chat', title: 'Renamed', titleSource: 'rpc', updatedAt: 200, createdAt: 50,
            url: 'https://gemini.google.com/u/1/app/chat' });
        await storage.setConversations('10000000-0000-4000-8000-000000000001', [current]);
        const selection = indexFixture({ id: 'chat', title: 'Older selection title', titleSource: 'rpc', updatedAt: 150 });
        const resolved = await resolveChat(cached, { id: 'chat' }, selection, null, '10000000-0000-4000-8000-000000000001', undefined, undefined, { source: 'local_snapshot' });
        assert.equal(resolved.isError, false);
        if (!resolved.isError) {
            assert.equal(resolved.chat.conversation.index.title, 'Renamed');
            assert.equal(resolved.chat.conversation.index.createdAt, 50);
            assert.equal(Reflect.get(resolved.chat.conversation.index ?? {}, 'url'), Reflect.get(current ?? {}, 'url'));
        }
        assert.equal(cached.conversation.index.title, 'Old title');
    } finally { env.restore(); }
});
test('a rename after preparation survives direct and staged cached export completion', async () => {
    const env = indexStorage();
    try {
        await admitFixtures('10000000-0000-4000-8000-000000000001', [parsed()]);
        const resolved = await resolveChat(undefined, { id: 'chat' }, undefined, null, '10000000-0000-4000-8000-000000000001');
        assert.equal(resolved.isError, false);
        if (resolved.isError) return;
        const old = resolved.chat;
        await DomainAdmission.updateConversation('10000000-0000-4000-8000-000000000001', 'chat', { title: 'Rename during export', titleSource: "provider", updatedAt: 200 });
        const input = { conversation: old.conversation, chatTime: old.sourceVersion, usedLocalSnapshot: true };
        await completeConversationExport(storage, '10000000-0000-4000-8000-000000000001', input);
        assert.equal((await storage.getConversations('10000000-0000-4000-8000-000000000001'))[0].title, 'Rename during export');
        const completion = buildExportCompletion(input);
        await finalizeChatExport('chat', { slot: '10000000-0000-4000-8000-000000000001', Storage: storage,
            chatRecordsMap: new Map([['chat', { ...completion }]]) });
        assert.equal((await storage.getConversations('10000000-0000-4000-8000-000000000001'))[0].title, 'Rename during export');
        assert.equal(Reflect.get((await storage.getExportedIds('10000000-0000-4000-8000-000000000001')).chat as object, 'chatTime'), 100);
    } finally { env.restore(); }
});
test('fresh acquisition commits all metadata before rendering, independently of export completion', async () => {
    const env = indexStorage();
    try {
        const fresh = parsed();
        fresh.conversation.index.createdAt = 20;

        const prepared = await preparePdfItem({ id: 'chat', title: 'Stale selection' }, { accountId: '10000000-0000-4000-8000-000000000001', ...({ includeAssets: false,
            fetchChatDetail: async () => ({ success: true, chat: await admitFixture(scope.accountId, fresh) }) }) });
        assert.equal(prepared.ok, true);
        const stored = await storage.conversationRepository(scope).getConversation('chat');
        assert.ok(stored?.detail);
        assert.equal(stored.index.title, fresh.conversation.index.title);
        assert.equal(stored.index.titleSource, 'provider');
        assert.equal(stored.index.createdAt, 20);
        assert.equal(stored.index.updatedAt, 100);
        assert.equal(Reflect.get(stored.index ?? {}, 'url'), Reflect.get(fresh.conversation.index ?? {}, 'url'));
        assert.equal(Reflect.get(stored.index ?? {}, 'messageCount'), undefined);
        assert.deepEqual(await storage.getExportedIds('10000000-0000-4000-8000-000000000001'), {});
    } finally { env.restore(); }
});
test('Takeout export cache reads current Domain and cannot republish old metadata or resurrect a missing Index', async () => {
    const env = indexStorage();
    try {
        const cached = await admitFixture('10000000-0000-4000-8000-000000000001', parsed(), []);
        const fresh = parsed(); fresh.sourceVersion = 200; fresh.conversation.index.updatedAt = 200; fresh.conversation.index.title = 'New title';
        fresh.conversation.detail.messages[0].content = [{ type: 'paragraph', children: [{ type: 'text', text: 'New body' }] }];
        await admitFixture('10000000-0000-4000-8000-000000000001', fresh);
        const writes = env.writes();
        const takeout = { getTakeoutOfflineChat: () => cached };
        const resolved = await resolveChat({ error: 'offline' }, { id: 'chat' }, null, takeout, '10000000-0000-4000-8000-000000000001');
        assert.equal(resolved.isError, false);
        if (!resolved.isError) {
            assert.equal(resolved.chat.conversation.index.title, 'New title');
            assert.match(JSON.stringify(resolved.chat.conversation.detail.messages), /New body/);
            assert.equal(resolved.chat.sourceVersion, 200);
        }
        assert.equal(env.writes(), writes);
        await storage.setConversations('10000000-0000-4000-8000-000000000001', []);
        const absent = await resolveChat({ error: 'offline' }, { id: 'chat' }, null, takeout, '10000000-0000-4000-8000-000000000001');
        assert.equal(absent.isError, true);
        assert.deepEqual(await storage.getConversations('10000000-0000-4000-8000-000000000001'), []);
    } finally { env.restore(); }
});

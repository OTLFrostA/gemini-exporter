import test from 'node:test';
import assert from 'node:assert/strict';
import { indexStorage } from './helpers/indexStorage.js';
import { indexFixture } from './helpers/indexFixture.js';
import { historicalFixture } from './helpers/nativeFixture.js';
import { StorageService as storage } from '../src/core/storage/storageService.js';
import { saveDomainConversation, getStoredDomain, storageIdentity } from '../src/core/storage/domain/domainStore.js';
import { createConversationRepository } from '../src/core/storage/conversationRepository.js';
import { preparePdfItem } from '../src/core/export/pdf/prepareItem.js';
import { resolveChat } from '../src/core/engine/export/batchWorker.js';
import { buildExportCompletion, completeConversationExport } from '../src/core/engine/export/exportCompletion.js';
import { finalizeChatExport } from '../src/core/engine/export/sessionRecovery.js';
import { withConversationMetadata } from '../src/core/domain/runtimeValidation.js';

const scope = { providerId: 'gemini', accountSlot: 'u0' };
const parsed = () => ({ ...historicalFixture({ id: 'chat', title: 'Old title', titleSource: 'rpc', updatedAt: 100,
    messages: [{ role: 'user', content: 'Question' }, { role: 'model', content: 'Answer' }] }), sourceVersion: 100 });

test('metadata projection erases absent optional fields even when passed a structurally assignable full snapshot', () => {
    const source = parsed().conversation;
    source.index.createdAt = 90; source.index.url = 'https://gemini.google.com/app/old';
    const { url: _url, ...index } = indexFixture({ id: 'chat', title: 'Canonical' });
    const projected = withConversationMetadata(source.detail, index);
    assert.equal(Object.hasOwn(projected, 'createdAt'), false);
    assert.equal(Object.hasOwn(projected, 'url'), false);
    assert.equal(projected.detail.messages, source.detail.messages);
    assert.equal(source.index.createdAt, 90);
});

test('index-only, absent, empty saved body and incomplete body remain distinct without read repair', async () => {
    const env = indexStorage();
    try {
        const repository = storage.conversationRepository(scope);
        assert.equal(await repository.getConversation('missing'), null);
        await storage.setConversations('u0', [indexFixture({ id: 'chat' })]);
        const writes = env.writes();
        const metadataOnly = await repository.getConversation('chat');
        assert.ok(metadataOnly); assert.equal(Object.hasOwn(metadataOnly, 'detail'), false);
        assert.equal(env.writes(), writes);
        await saveDomainConversation('u0', historicalFixture({ id: 'chat', messages: [] }));
        const empty = await repository.getConversation('chat');
        assert.deepEqual(empty?.detail?.messages, []);
        const partial = parsed(); partial.conversation.detail.quality.status = 'partial';
        await saveDomainConversation('u0', partial);
        const capture = await repository.getConversation('chat');
        assert.equal(capture?.detail?.quality.status, 'partial');
        assert.equal(capture?.capture?.savedAt, undefined);
    } finally { env.restore(); }
});

test('index owns every metadata field while capture retains the actual older body version', async () => {
    const env = indexStorage();
    try {
        await storage.setNativeConversations('u0', [parsed()]);
        await storage.updateConversation('u0', 'chat', { title: 'Renamed', titleSource: 'rpc', createdAt: 50, updatedAt: 200,
            url: 'https://gemini.google.com/u/1/app/chat', cloudAvailability: 'deleted' });
        const repository = storage.conversationRepository(scope);
        const before = await getStoredDomain(storageIdentity('gemini', 'u0', 'chat'));
        const writes = env.writes();
        const stored = await repository.getConversation('c_chat');
        assert.ok(stored?.detail);
        assert.deepEqual(Object.keys(stored.detail).sort(), ['assets', 'messages', 'quality']);
        assert.equal(stored.index.updatedAt, 200);
        assert.equal(stored.capture?.savedAt, 100);
        const resolved = await resolveChat(undefined, { id: 'chat' }, stored.index, null, 'u0');
        assert.equal(resolved.isError, false);
        if (resolved.isError) return;
        const projected = resolved.chat;
        assert.equal(projected.conversation.index.title, 'Renamed');
        assert.equal(projected.conversation.index.createdAt, 50);
        assert.equal(projected.conversation.index.url, 'https://gemini.google.com/u/1/app/chat');
        assert.equal(projected.sourceVersion, 100);
        assert.equal('updatedAt' in projected.conversation, false);
        assert.equal(resolved.isError, false);
        if (!resolved.isError) {
            assert.equal(resolved.chat.conversation.index.title, 'Renamed');
            assert.equal(resolved.chat.conversation.index.createdAt, 50);
            assert.equal(resolved.chat.conversation.index.url, projected.conversation.index.url);
            assert.equal(resolved.chat.sourceVersion, 100);
        }
        assert.equal(env.writes(), writes);
        assert.deepEqual(await getStoredDomain(storageIdentity('gemini', 'u0', 'chat')), before);
        stored.detail.messages.length = 0;
        stored.index.title = 'Caller mutation';
        assert.equal((await repository.getConversation('chat'))?.detail?.messages.length, 2);
        assert.equal((await repository.getConversationIndex('chat'))?.title, 'Renamed');
    } finally { env.restore(); }
});

test('cached projections cannot roll back newer metadata passed by a caller', async () => {
    const env = indexStorage();
    try {
        const cached = parsed();
        const current = indexFixture({ id: 'chat', title: 'Renamed', titleSource: 'rpc', updatedAt: 200, createdAt: 50,
            url: 'https://gemini.google.com/u/1/app/chat' });
        await storage.setConversations('u0', [current]);
        const selection = indexFixture({ id: 'chat', title: 'Older selection title', titleSource: 'rpc', updatedAt: 150 });
        const resolved = await resolveChat(cached, { id: 'chat' }, selection, null, 'u0', undefined, undefined, { source: 'local_snapshot' });
        assert.equal(resolved.isError, false);
        if (!resolved.isError) {
            assert.equal(resolved.chat.conversation.index.title, 'Renamed');
            assert.equal(resolved.chat.conversation.index.createdAt, 50);
            assert.equal(resolved.chat.conversation.index.url, current.url);
        }
        assert.equal(cached.conversation.index.title, 'Old title');
    } finally { env.restore(); }
});

test('a rename after preparation survives direct and staged cached export completion', async () => {
    const env = indexStorage();
    try {
        await storage.setNativeConversations('u0', [parsed()]);
        const resolved = await resolveChat(undefined, { id: 'chat' }, undefined, null, 'u0');
        assert.equal(resolved.isError, false);
        if (resolved.isError) return;
        const old = resolved.chat;
        await storage.updateConversation('u0', 'chat', { title: 'Rename during export', titleSource: 'rpc', updatedAt: 200 });
        const input = { conversation: old.conversation, chatTime: old.sourceVersion, usedLocalSnapshot: true };
        await completeConversationExport(storage, 'u0', input);
        assert.equal((await storage.getConversations('u0'))[0].title, 'Rename during export');
        const completion = buildExportCompletion(input);
        await finalizeChatExport('chat', { slot: 'u0', Storage: storage,
            chatRecordsMap: new Map([['chat', { ...completion }]]) });
        assert.equal((await storage.getConversations('u0'))[0].title, 'Rename during export');
        assert.equal(Reflect.get((await storage.getExportedIds('u0')).chat as object, 'chatTime'), 100);
    } finally { env.restore(); }
});

test('bound scope isolates accounts/providers, rejects unsupported slots and ignores bodies without an index', async () => {
    const env = indexStorage();
    try {
        const mutableScope = { ...scope };
        const repository = storage.conversationRepository(mutableScope);
        mutableScope.accountSlot = 'u1';
        await storage.setNativeConversations('u0', [parsed()]);
        const other = parsed(); other.conversation.index.title = 'Other account';
        await storage.setNativeConversations('u1', [other]);
        const foreign = parsed(); foreign.conversation.index.providerId = 'other'; foreign.conversation.index.title = 'Other provider';
        await storage.setNativeConversations('u0', [foreign]);
        assert.equal((await repository.getConversationIndex('chat'))?.title, 'Old title');
        assert.equal((await storage.conversationRepository({ ...scope, accountSlot: 'u1' }).getConversationIndex('chat'))?.title, 'Other account');
        assert.equal((await storage.conversationRepository({ ...scope, providerId: 'other' }).getConversationIndex('chat'))?.title, 'Other provider');
        assert.equal((await storage.conversationRepository({ ...scope, accountSlot: 'default' }).getConversationIndex('chat'))?.title, 'Old title');
        assert.throws(() => storage.conversationRepository({ ...scope, accountSlot: 'typo' }), /slot/);
        assert.throws(() => storage.conversationRepository({ ...scope, providerId: ' gemini' }), /scope/);
        await assert.rejects(repository.getConversation(''), /ID/);
        await assert.rejects(repository.getConversationIndex('c_'), /ID/);
        const orphan = parsed(); orphan.conversation.index.id = 'orphan';
        await saveDomainConversation('u0', orphan);
        assert.equal(await repository.getConversation('orphan'), null);
        assert.ok(await getStoredDomain(storageIdentity('gemini', 'u0', 'orphan')));
        const writes = env.writes();
        assert.equal(await repository.getConversationIndex('orphan'), null);
        assert.equal(env.writes(), writes);
    } finally { env.restore(); }
});

test('index reads avoid body I/O; malformed identities and storage failures reject instead of looking absent', async () => {
    const env = indexStorage();
    try {
        const record = await saveDomainConversation('u0', parsed());
        let reads = 0;
        const repository = createConversationRepository(scope, {
            readIndexes: async () => [indexFixture({ id: 'chat' })],
            readBody: async () => { reads++; return { ...record, identity: { ...record.identity, accountSlot: 'u1' } }; },
            readConsistently: read => read(),
        });
        assert.ok(await repository.getConversationIndex('chat')); assert.equal(reads, 0);
        await assert.rejects(repository.getConversation('chat'), /identity mismatch/);
        const failure = new Error('Disk unavailable');
        const broken = createConversationRepository(scope, {
            readIndexes: async () => { throw failure; }, readBody: async () => null, readConsistently: read => read(),
        });
        await assert.rejects(broken.getConversationIndex('chat'), error => error === failure);
        await assert.rejects(broken.getConversation('chat'), error => error === failure);
        await storage.setNativeConversations('u0', [parsed()]);
        const ordered = storage.conversationRepository(scope);
        const write = storage.updateConversation('u0', 'chat', { title: 'Queued rename', titleSource: 'rpc' });
        const read = ordered.getConversation('chat');
        await write; assert.equal((await read)?.index.title, 'Queued rename');
    } finally { env.restore(); }
});

test('fresh acquisition commits all metadata before rendering, independently of export completion', async () => {
    const env = indexStorage();
    try {
        const fresh = parsed();
        fresh.conversation.index.createdAt = 20;
        fresh.conversation.index.url = 'https://gemini.google.com/u/0/app/chat';
        const prepared = await preparePdfItem({ id: 'chat', title: 'Stale selection' }, { includeAssets: false,
            fetchChatDetail: async () => ({ success: true, chat: fresh }) });
        assert.equal(prepared.ok, true);
        const stored = await storage.conversationRepository(scope).getConversation('chat');
        assert.ok(stored?.detail);
        assert.equal(stored.index.title, fresh.conversation.index.title);
        assert.equal(stored.index.titleSource, 'rpc');
        assert.equal(stored.index.createdAt, 20);
        assert.equal(stored.index.updatedAt, 100);
        assert.equal(stored.index.url, fresh.conversation.index.url);
        assert.equal(stored.index.messageCount, 2);
        assert.deepEqual(await storage.getExportedIds('u0'), {});
    } finally { env.restore(); }
});

test('accepting a partial observation advances Index but returns the retained complete body and its version', async () => {
    const env = indexStorage();
    try {
        await storage.ingestConversation('u0', parsed());
        const partial = parsed();
        partial.conversation.detail.messages = partial.conversation.detail.messages.slice(0, 1);
        partial.conversation.detail.quality.status = 'partial';
        partial.conversation.index.title = 'New authoritative title';
        partial.sourceVersion = 200; partial.conversation.index.updatedAt = 200;
        const accepted = await storage.ingestConversation('u0', partial);
        assert.equal(accepted.conversation.index.title, 'New authoritative title');
        assert.equal(accepted.conversation.detail.messages.length, 2);
        assert.equal(accepted.sourceVersion, 100);
        const index = await storage.conversationRepository(scope).getConversationIndex('chat');
        assert.equal(index?.updatedAt, 200);
        assert.equal(index?.messageCount, 2);
    } finally { env.restore(); }
});


test('initial partial capture publishes activity to Index without claiming a saved complete-body version', async () => {
    const env = indexStorage();
    try {
        const partial = parsed(); partial.conversation.detail.quality.status = 'partial';
        const accepted = await storage.ingestConversation('u0', partial);
        assert.equal(accepted.sourceVersion, undefined);
        const stored = await storage.conversationRepository(scope).getConversation('chat');
        assert.equal(stored?.capture?.savedAt, undefined);
        assert.equal(stored?.index.updatedAt, 100);
    } finally { env.restore(); }
});

test('Takeout export cache reads current Domain and cannot republish old metadata or resurrect a missing Index', async () => {
    const env = indexStorage();
    try {
        const cached = await storage.ingestConversation('u0', parsed(), [], 'takeout');
        const fresh = parsed(); fresh.sourceVersion = 200; fresh.conversation.index.updatedAt = 200; fresh.conversation.index.title = 'New title';
        fresh.conversation.detail.messages[0].content = [{ type: 'paragraph', children: [{ type: 'text', text: 'New body' }] }];
        await storage.ingestConversation('u0', fresh);
        const writes = env.writes();
        const takeout = { getTakeoutOfflineChat: () => cached };
        const resolved = await resolveChat({ error: 'offline' }, { id: 'chat' }, null, takeout);
        assert.equal(resolved.isError, false);
        if (!resolved.isError) {
            assert.equal(resolved.chat.conversation.index.title, 'New title');
            assert.match(JSON.stringify(resolved.chat.conversation.detail.messages), /New body/);
            assert.equal(resolved.chat.sourceVersion, 200);
        }
        assert.equal(env.writes(), writes);
        await storage.setConversations('u0', []);
        const absent = await resolveChat({ error: 'offline' }, { id: 'chat' }, null, takeout);
        assert.equal(absent.isError, true);
        assert.deepEqual(await storage.getConversations('u0'), []);
    } finally { env.restore(); }
});

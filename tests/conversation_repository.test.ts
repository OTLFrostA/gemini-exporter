import test from 'node:test';
import assert from 'node:assert/strict';
import { indexStorage } from './helpers/indexStorage.js';
import { indexFixture } from './helpers/indexFixture.js';
import { historicalFixture } from './helpers/nativeFixture.js';
import { StorageService as storage } from '../src/core/storage/storageService.js';
import { saveDomainConversation, getStoredDomain, storageIdentity } from '../src/core/storage/domain/domainStore.js';
import { conversationParseResult, createConversationRepository } from '../src/core/storage/conversationRepository.js';
import { resolveChat } from '../src/core/engine/export/batchWorker.js';
import { buildExportCompletion, completeConversationExport } from '../src/core/engine/export/exportCompletion.js';
import { finalizeChatExport } from '../src/core/engine/export/sessionRecovery.js';
import { withConversationMetadata } from '../src/core/domain/runtimeValidation.js';

const scope = { providerId: 'gemini', accountSlot: 'u0' };
const parsed = () => ({ ...historicalFixture({ id: 'chat', title: 'Old title', titleSource: 'rpc',
    messages: [{ role: 'user', content: 'Question' }, { role: 'model', content: 'Answer' }] }), sourceVersion: 100 });

test('metadata projection erases absent optional fields even when passed a structurally assignable full snapshot', () => {
    const source = parsed().conversation;
    source.createdAt = 90; source.url = 'https://gemini.google.com/app/old';
    const { url: _url, ...index } = indexFixture({ id: 'chat', title: 'Canonical' });
    const projected = withConversationMetadata(source, index);
    assert.equal(Object.hasOwn(projected, 'createdAt'), false);
    assert.equal(Object.hasOwn(projected, 'url'), false);
    assert.equal(projected.messages, source.messages);
    assert.equal(source.createdAt, 90);
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
        assert.equal(conversationParseResult((await repository.getStoredConversation('chat'))!), null);
        assert.equal(env.writes(), writes);
        await saveDomainConversation('u0', historicalFixture({ id: 'chat', messages: [] }));
        const empty = await repository.getConversation('chat');
        assert.deepEqual(empty?.detail?.messages, []);
        const partial = parsed(); partial.conversation.completeness = 'partial';
        await saveDomainConversation('u0', partial);
        const capture = await repository.getStoredConversation('chat');
        assert.equal(capture?.conversation.detail?.completeness, 'partial');
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
        const stored = await repository.getStoredConversation('c_chat');
        assert.ok(stored?.conversation.detail);
        assert.deepEqual(Object.keys(stored.conversation.detail).sort(), ['assets', 'completeness', 'messages']);
        assert.equal(stored.conversation.index.updatedAt, 200);
        assert.equal(stored.capture?.savedAt, 100);
        const projected = conversationParseResult(stored)!;
        assert.equal(projected.conversation.title, 'Renamed');
        assert.equal(projected.conversation.createdAt, 50);
        assert.equal(projected.conversation.url, 'https://gemini.google.com/u/1/app/chat');
        assert.equal(projected.sourceVersion, 100);
        assert.equal('updatedAt' in projected.conversation, false);
        const resolved = await resolveChat(projected, { id: 'chat' }, stored.conversation.index, null, 'u0', undefined, undefined, { source: 'local_snapshot' });
        assert.equal(resolved.isError, false);
        if (!resolved.isError) {
            assert.equal(resolved.chat.conversation.title, 'Renamed');
            assert.equal(resolved.chat.conversation.createdAt, 50);
            assert.equal(resolved.chat.conversation.url, projected.conversation.url);
            assert.equal(resolved.chat.sourceVersion, 100);
            assert.equal(resolved.convsNeedSave, false);
        }
        assert.equal(env.writes(), writes);
        assert.deepEqual(await getStoredDomain(storageIdentity('gemini', 'u0', 'chat')), before);
        stored.conversation.detail.messages.length = 0;
        stored.conversation.index.title = 'Caller mutation';
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
            assert.equal(resolved.chat.conversation.title, 'Renamed');
            assert.equal(resolved.chat.conversation.createdAt, 50);
            assert.equal(resolved.chat.conversation.url, current.url);
            assert.equal(resolved.convsNeedSave, false);
        }
        assert.equal(cached.conversation.title, 'Old title');
    } finally { env.restore(); }
});

test('a rename after preparation survives direct and staged cached export completion', async () => {
    const env = indexStorage();
    try {
        await storage.setNativeConversations('u0', [parsed()]);
        const old = await storage.getConversationWithDetail('u0', 'chat');
        assert.ok(old);
        await storage.updateConversation('u0', 'chat', { title: 'Rename during export', titleSource: 'rpc', updatedAt: 200 });
        const input = { conversation: old.conversation, chatTime: old.sourceVersion, usedLocalSnapshot: true };
        await completeConversationExport(storage, 'u0', input, { skipConversationUpdate: false });
        assert.equal((await storage.getConversations('u0'))[0].title, 'Rename during export');
        const completion = buildExportCompletion(input);
        await finalizeChatExport('chat', { slot: 'u0', Storage: storage,
            chatRecordsMap: new Map([['chat', { ...completion }]]) });
        assert.equal((await storage.getConversations('u0'))[0].title, 'Rename during export');
        assert.equal(Reflect.get((await storage.getExportedIds('u0')).chat as object, 'chatTime'), 100);
    } finally { env.restore(); }
});

test('bound scope isolates accounts/providers, rejects unsupported slots and leaves orphan bodies unpublished', async () => {
    const env = indexStorage();
    try {
        const mutableScope = { ...scope };
        const repository = storage.conversationRepository(mutableScope);
        mutableScope.accountSlot = 'u1';
        await storage.setNativeConversations('u0', [parsed()]);
        const other = parsed(); other.conversation.title = 'Other account';
        await storage.setNativeConversations('u1', [other]);
        const foreign = parsed(); foreign.conversation.providerId = 'other'; foreign.conversation.title = 'Other provider';
        await storage.setNativeConversations('u0', [foreign]);
        assert.equal((await repository.getConversationIndex('chat'))?.title, 'Old title');
        assert.equal((await storage.conversationRepository({ ...scope, accountSlot: 'u1' }).getConversationIndex('chat'))?.title, 'Other account');
        assert.equal((await storage.conversationRepository({ ...scope, providerId: 'other' }).getConversationIndex('chat'))?.title, 'Other provider');
        assert.equal((await storage.conversationRepository({ ...scope, accountSlot: 'default' }).getConversationIndex('chat'))?.title, 'Old title');
        assert.throws(() => storage.conversationRepository({ ...scope, accountSlot: 'typo' }), /slot/);
        assert.throws(() => storage.conversationRepository({ ...scope, providerId: ' gemini' }), /scope/);
        await assert.rejects(repository.getConversation(''), /ID/);
        await assert.rejects(repository.getConversationIndex('c_'), /ID/);
        const orphan = parsed(); orphan.conversation.id = 'orphan';
        await saveDomainConversation('u0', orphan);
        assert.equal(await repository.getConversation('orphan'), null);
        assert.ok(await getStoredDomain(storageIdentity('gemini', 'u0', 'orphan')));
        const writes = env.writes();
        const recovered = await repository.recoverStoredConversation('orphan');
        assert.equal(recovered?.indexOrigin, 'recovered');
        assert.equal(recovered?.conversation.index.cloudAvailability, 'unknown');
        assert.equal(recovered?.capture?.savedAt, 100);
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

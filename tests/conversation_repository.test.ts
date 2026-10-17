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

test('metadata projection erases absent optional fields even when passed a structurally assignable full snapshot', () => {
    const source = parsed().conversation;
    source.index.createdAt = 90;
    const index = indexFixture({ id: 'chat', title: 'Canonical' });
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
        await storage.setConversations('10000000-0000-4000-8000-000000000001', [indexFixture({ id: 'chat' })]);
        const writes = env.writes();
        const metadataOnly = await repository.getConversation('chat');
        assert.ok(metadataOnly); assert.equal(Object.hasOwn(metadataOnly, 'detail'), false);
        assert.equal(env.writes(), writes);
        await admitFixture('10000000-0000-4000-8000-000000000001', historicalFixture({ id: 'chat', messages: [] }));
        const empty = await repository.getConversation('chat');
        assert.deepEqual(empty?.detail?.messages, []);
        const partial = parsed(); partial.conversation.detail.quality.status = 'partial';
        await admitFixture('10000000-0000-4000-8000-000000000001', partial);
        const capture = await repository.getConversation('chat');
        assert.equal(capture?.detail?.quality.status, 'partial');
        assert.equal(capture?.capture?.savedAt, 100);
    } finally { env.restore(); }
});

test('index owns every metadata field while capture retains the actual older body version', async () => {
    const env = indexStorage();
    try {
        await admitFixtures('10000000-0000-4000-8000-000000000001', [parsed()]);
        await DomainAdmission.updateConversation('10000000-0000-4000-8000-000000000001', 'chat', { title: 'Renamed', titleSource: "provider", createdAt: 50, updatedAt: 200,
             });
        const repository = storage.conversationRepository(scope);
        const before = await readFixture(storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', 'chat'));
        const writes = env.writes();
        const stored = await repository.getConversation('chat');
        assert.ok(stored?.detail);
        assert.deepEqual(Object.keys(stored.detail).sort(), ['assets', 'key', 'messages', 'quality', 'savedAt']);
        assert.equal(stored.index.updatedAt, 200);
        assert.equal(stored.capture?.savedAt, 100);
        const resolved = await resolveChat(undefined, { id: 'chat' }, stored.index, null, '10000000-0000-4000-8000-000000000001');
        assert.equal(resolved.isError, false);
        if (resolved.isError) return;
        const projected = resolved.chat;
        assert.equal(projected.conversation.index.title, 'Renamed');
        assert.equal(projected.conversation.index.createdAt, 50);
        assert.equal(Reflect.get(projected.conversation.index ?? {}, 'url'), undefined);
        assert.equal(projected.sourceVersion, 100);
        assert.equal('updatedAt' in projected.conversation, false);
        assert.equal(resolved.isError, false);
        if (!resolved.isError) {
            assert.equal(resolved.chat.conversation.index.title, 'Renamed');
            assert.equal(resolved.chat.conversation.index.createdAt, 50);
            assert.equal(Reflect.get(resolved.chat.conversation.index ?? {}, 'url'), Reflect.get(projected.conversation.index ?? {}, 'url'));
            assert.equal(resolved.chat.sourceVersion, 100);
        }
        assert.equal(env.writes(), writes);
        assert.deepEqual(await readFixture(storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', 'chat')), before);
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

test('bound scope isolates accounts/providers, rejects unsupported slots and ignores bodies without an index', async () => {
    const env = indexStorage();
    try {
        const mutableScope = { ...scope };
        const repository = storage.conversationRepository(mutableScope);
        mutableScope.accountId = '10000000-0000-4000-8000-000000000002';
        await admitFixtures('10000000-0000-4000-8000-000000000001', [parsed()]);
        const other = bindFixture(parsed(), '10000000-0000-4000-8000-000000000002'); other.conversation.index.title = 'Other account';
        await admitFixtures('10000000-0000-4000-8000-000000000002', [other]);
        const foreign = bindFixture(parsed(), { ...fixtureAccount('other'), id: scope.accountId });
        await assert.rejects(admitFixtures(scope.accountId, [foreign]), /mismatch/);
        assert.equal((await repository.getConversationIndex('chat'))?.title, 'Old title');
        assert.equal((await storage.conversationRepository({ ...scope, accountId: '10000000-0000-4000-8000-000000000002' }).getConversationIndex('chat'))?.title, 'Other account');
        assert.throws(() => storage.conversationRepository({ ...scope, accountId: 'typo' }), /UUID/);
        assert.throws(() => storage.conversationRepository({ ...scope, providerId: ' gemini' }), /scope/);
        await assert.rejects(repository.getConversation(''), /ID/);
        assert.equal(await repository.getConversationIndex('c_'), null, 'Provider IDs are opaque at the repository boundary');
        const orphan = parsed(); orphan.conversation.index.key.conversationId = 'orphan'; orphan.conversation.detail.key.conversationId = 'orphan';
        await putDetail(orphan.conversation.detail);
        assert.equal(await repository.getConversation('orphan'), null);
        assert.ok(await getDetail({accountId: scope.accountId, conversationId: 'orphan'}));
        const writes = env.writes();
        assert.equal(await repository.getConversationIndex('orphan'), null);
        assert.equal(env.writes(), writes);
    } finally { env.restore(); }
});

test('index reads avoid body I/O; malformed identities and storage failures reject instead of looking absent', async () => {
    const env = indexStorage();
    try {
        const record = await admitFixture('10000000-0000-4000-8000-000000000001', parsed());
        let reads = 0;
        const repository = createConversationRepository(scope, {
            readIndexes: async () => [indexFixture({ id: 'chat' })],
            readBody: async () => { reads++; return { ...record.conversation.detail, key: { ...record.conversation.detail.key, accountId: '10000000-0000-4000-8000-000000000002' } }; },
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
        await admitFixtures('10000000-0000-4000-8000-000000000001', [parsed()]);
        const ordered = storage.conversationRepository(scope);
        const write = DomainAdmission.updateConversation('10000000-0000-4000-8000-000000000001', 'chat', { title: 'Queued rename', titleSource: "provider" });
        const read = ordered.getConversation('chat');
        await write; assert.equal((await read)?.index.title, 'Queued rename');
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

test('accepting a partial observation advances Index but returns the retained complete body and its version', async () => {
    const env = indexStorage();
    try {
        await admitFixture('10000000-0000-4000-8000-000000000001', parsed());
        const partial = parsed();
        partial.conversation.detail.messages = partial.conversation.detail.messages.slice(0, 1);
        partial.conversation.detail.quality.status = 'partial';
        partial.conversation.index.title = 'New authoritative title';
        partial.sourceVersion = 200; partial.conversation.index.updatedAt = 200;
        const accepted = await admitFixture('10000000-0000-4000-8000-000000000001', partial);
        assert.equal(accepted.conversation.index.title, 'New authoritative title');
        assert.equal(accepted.conversation.detail.messages.length, 2);
        assert.equal(accepted.sourceVersion, 100);
        const index = await storage.conversationRepository(scope).getConversationIndex('chat');
        assert.equal(index?.updatedAt, 200);
        assert.equal(Reflect.get(index ?? {}, 'messageCount'), undefined);
    } finally { env.restore(); }
});


test('initial partial capture publishes activity to Index without claiming a saved complete-body version', async () => {
    const env = indexStorage();
    try {
        const partial = parsed(); partial.conversation.detail.quality.status = 'partial';
        const accepted = await admitFixture('10000000-0000-4000-8000-000000000001', partial);
        assert.equal(accepted.sourceVersion, 100);
        const stored = await storage.conversationRepository(scope).getConversation('chat');
        assert.equal(stored?.capture?.savedAt, 100);
        assert.equal(stored?.index.updatedAt, 100);
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

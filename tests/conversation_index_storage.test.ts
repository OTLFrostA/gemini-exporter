import * as DomainAdmission from '../src/core/domain/ingestion.js';
import { sourceIndex } from './helpers/domainFixture.js';
import { fixtureAccount } from './helpers/domainFixture.js';
import { buildExportCompletion } from '../src/core/engine/export/exportCompletion.js';
import { ingestRpcList, markConfirmedDeleted, upsertConversations } from '../src/content/syncEngine.js';
import { getDomainConversationResult } from '../src/core/storage/domain/nativePersistence.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { indexStorage } from './helpers/indexStorage.js';
import { indexFixture } from './helpers/indexFixture.js';
import { historicalFixture } from './helpers/nativeFixture.js';
import { StorageService as storage } from '../src/core/storage/storageService.js';
import { parseGeminiIndexObservation } from '../src/core/parsers/gemini/parseIndexObservation.js';
import { indexActivityTime, mergeConversationIndex, restoreConversationIndex } from '../src/core/domain/conversationIndex.js';

const row = () => indexFixture({ id: 'chat', title: 'Research', titleSource: 'rpc', updatedAt: 50, messageCount: 4 });

test('physical index roundtrip is exact, detached and account isolated', async () => {
    const env = indexStorage();
    try {
        await storage.setConversations('10000000-0000-4000-8000-000000000001', [row()]);
        const read = await storage.getConversations('10000000-0000-4000-8000-000000000001');
        assert.deepEqual(read, [row()]);
        read[0].title = 'External mutation';
        assert.deepEqual(await storage.getConversations('10000000-0000-4000-8000-000000000001'), [row()]);
        assert.deepEqual(await storage.getConversations('10000000-0000-4000-8000-000000000002'), []);
    } finally { env.restore(); }
});
test('index boundary rejects unknown fields, malformed values and duplicate identities without writes', async () => {
    const env = indexStorage();
    try {
        for (const bad of [null, 'row', [], { ...row(), messages: [] }, { ...row(), titles: {} }, { ...row(), timestamp: 5 },
            { ...row(), lastMessageAt: NaN }, { ...row(), lastMessageAt: '5' }, { ...row(), updatedAt: '5' }, { ...row(), messageCount: -1 }, { ...row(), messageCount: 1.5 },
            { ...row(), createdAt: '5' }, { ...row(), createdAt: null }, { ...row(), createdAt: NaN },
            { ...row(), createdAt: Infinity }, { ...row(), updatedAt: null }, { ...row(), updatedAt: NaN }, { ...row(), updatedAt: -Infinity },
            { ...row(), titleSource: 'made-up' }, { ...row(), titleSource: 'toString' }, { ...row(), title: '', titleSource: 'rpc' },
            { ...row(), url: 'https://' }, { ...row(), url: 'javascript:alert(1)' },
            { ...row(), cloudAvailability: new String('available') }, { ...row(), cloudAvailability: 'maybe' }, { ...row(), hasTakeoutImport: undefined }]) {
            assert.throws(() => restoreConversationIndex(bad), TypeError);
            env.local['conversations_10000000-0000-4000-8000-000000000001'] = [bad];
            await assert.rejects(storage.getConversations('10000000-0000-4000-8000-000000000001'), TypeError);
        }
        await assert.rejects(storage.setConversations('10000000-0000-4000-8000-000000000001', [row(), row()]), /Duplicate/);
        assert.equal(env.writes(), 0);
    } finally { env.restore(); }
});
test('atomic patches preserve title authority, observed count, import and authored time', async () => {
    const env = indexStorage();
    try {
        await storage.setConversations('10000000-0000-4000-8000-000000000001', [row()]);
        await DomainAdmission.updateConversation('10000000-0000-4000-8000-000000000001', 'chat', { title: 'Weaker', titleSource: "provider", updatedAt: 20 });
        assert.deepEqual((await storage.getConversations('10000000-0000-4000-8000-000000000001'))[0], { ...row(), title: 'Weaker' });
        await DomainAdmission.updateConversation('10000000-0000-4000-8000-000000000001', 'chat', { title: 'Renamed', titleSource: "provider", updatedAt: 70 });
        assert.equal((await storage.getConversations('10000000-0000-4000-8000-000000000001'))[0].title, 'Renamed');
        const writes = env.writes();
        await assert.rejects(DomainAdmission.updateConversation('10000000-0000-4000-8000-000000000001', 'chat', value => { Object.assign(value, { messages: [] }); }), TypeError);
        assert.equal(env.writes(), writes);
    } finally { env.restore(); }
});
test('native detail persists separately and index updates cannot truncate or replace its body', async () => {
    const env = indexStorage();
    try {
        const detail = historicalFixture({ id: 'chat', title: 'Research', titleSource: 'rpc', messages: [
            { role: 'user', content: 'Question' }, { role: 'model', content: 'Answer' }
        ] });
        await DomainAdmission.ingestDetails('10000000-0000-4000-8000-000000000001', [detail]);
        const before = await getDomainConversationResult('10000000-0000-4000-8000-000000000001', 'chat');
        const index = (await storage.getConversations('10000000-0000-4000-8000-000000000001'))[0];
        assert.equal(Reflect.get(index ?? {}, 'messageCount'), undefined);
        assert.equal('messages' in index, false);
        await DomainAdmission.updateConversation('10000000-0000-4000-8000-000000000001', 'chat', {  title: 'Renamed', titleSource: "provider" });
        assert.deepEqual(await getDomainConversationResult('10000000-0000-4000-8000-000000000001', 'chat'), before);
        assert.equal((await storage.conversationRepository({ providerId: 'gemini', accountId: '10000000-0000-4000-8000-000000000001' }).getConversation('chat'))?.index.title, 'Renamed');
        await storage.clearConversations('10000000-0000-4000-8000-000000000001');
        assert.equal(await getDomainConversationResult('10000000-0000-4000-8000-000000000001', 'chat'), null);
    } finally { env.restore(); }
});
test('export completion records delivery without creating an Index', async () => {
    const env = indexStorage();
    try {
        const record = { title: 'Exported title', messageCount: 2, exportedAt: new Date().toISOString() };
        await storage.finalizeConversationExport('10000000-0000-4000-8000-000000000001', 'chat', record);
        assert.deepEqual(await storage.getConversations('10000000-0000-4000-8000-000000000001'), []);
        assert.deepEqual((await storage.getExportedIds('10000000-0000-4000-8000-000000000001')).chat, record);
    } finally { env.restore(); }
});

test('partial and concurrent native imports retain unrelated indexes and existing metadata facts', async () => {
    const env = indexStorage();
    try {
        const existing = row();
        await storage.setConversationAvailability(fixtureAccount().id, 'chat', 'deleted');
        const other = indexFixture({ id: 'other', title: 'Other conversation', updatedAt: 10 });
        await storage.setConversations('10000000-0000-4000-8000-000000000001', [existing, other]);
        await storage.setConversations('10000000-0000-4000-8000-000000000002', [{ ...other, key: { ...other.key, accountId: '10000000-0000-4000-8000-000000000002' } }]);
        const first = historicalFixture({ id: 'chat', title: 'Weaker detail', titleSource: 'sniff', updatedAt: 999999,
            messages: [{ role: 'user', content: 'Question', timestamp: 70 }] });
        const second = historicalFixture({ id: 'added', title: 'Added conversation', messages: [{ role: 'user', content: 'New body', timestamp: 80 }] });
        await Promise.all([DomainAdmission.ingestDetails('10000000-0000-4000-8000-000000000001', [first]), DomainAdmission.ingestDetails('10000000-0000-4000-8000-000000000001', [second])]);
        const rows = await storage.getConversations('10000000-0000-4000-8000-000000000001');
        assert.deepEqual(rows.map(value => value.key.conversationId).sort(), ['added', 'chat', 'other']);
        assert.deepEqual(rows.find(value => value.key.conversationId === 'other'), other);
        assert.deepEqual(rows.find(value => value.key.conversationId === 'chat'), { ...existing, updatedAt: 999999 });
        assert.equal((await storage.getConversations('10000000-0000-4000-8000-000000000002'))[0].title, other.title);
        assert.equal((await getDomainConversationResult('10000000-0000-4000-8000-000000000001', 'chat'))?.conversation.detail.messages.length, 1);
        const writes = env.writes();
        await DomainAdmission.ingestDetails('10000000-0000-4000-8000-000000000001', []);
        assert.equal(env.writes(), writes, 'empty partial import cannot clear the list');
    } finally { env.restore(); }
});

test('native Detail source versions align with Index without claiming cloud restoration', () => {
    const old = { ...row(), createdAt: 10, updatedAt: 100 };
    const detail = historicalFixture({ id: 'chat', title: 'Research', updatedAt: 300,
        messages: [{ role: 'user', content: 'Question', timestamp: 200 }] });
    for (const source of ['detail', 'snapshot', 'takeout'] as const) {
        const observed = restoreConversationIndex(detail.conversation.index);
        assert.equal(observed.updatedAt, 300);
        assert.equal(Reflect.get(observed ?? {}, 'cloudAvailability'), undefined);
        const merged = mergeConversationIndex(old, observed);
        assert.equal(merged.updatedAt, 300);
        assert.equal(indexActivityTime(merged), 300);
        assert.equal(merged.createdAt, 10);
        assert.equal(Reflect.get(merged ?? {}, 'cloudAvailability'), undefined);
        const listed = mergeConversationIndex(merged, parseGeminiIndexObservation({ id: 'chat', title: 'Research', updatedAt: 350 }, 'rpc-list', fixtureAccount().id));
        assert.equal(listed.updatedAt, 350);
        assert.equal(Reflect.get(listed ?? {}, 'cloudAvailability'), undefined);
    }
    const { sourceVersion, ...unversioned } = detail;
    assert.equal(restoreConversationIndex(unversioned.conversation.index).updatedAt, 300, 'Index retains source-authored activity independently of the body capture envelope');
    assert.equal(Reflect.get(mergeConversationIndex(old, { ...old,  }) ?? {}, 'cloudAvailability'), undefined);
});

test('export chatTime remains an export baseline and never poisons metadata updatedAt', async () => {
    const env = indexStorage();
    try {
        await storage.setConversations('10000000-0000-4000-8000-000000000001', [row()]);
        await storage.finalizeConversationExport('10000000-0000-4000-8000-000000000001', 'chat', { title: 'Research', chatTime: 999999, messageCount: 4 });
        assert.equal((await storage.getConversations('10000000-0000-4000-8000-000000000001'))[0].updatedAt, 50);
        const completion = buildExportCompletion({ conversation: { id: 'chat', title: 'Research', updatedAt: 999999,
            messages: [{ timestamp: 200 }] } });
        await storage.finalizeConversationExport('10000000-0000-4000-8000-000000000001', 'chat', completion.exportRecord);
        assert.equal((await storage.getConversations('10000000-0000-4000-8000-000000000001'))[0].updatedAt, 50);
    } finally { env.restore(); }
});


test('fresh list evidence restores deleted indexes, while stale requests, cached detail and failed recovery stay fenced', async () => {
    const env = indexStorage();
    const id = 'cloud-recovery';
    try {
        const deleted = { ...row(), key: { ...row().key, conversationId: id } };
        await storage.setConversationAvailability(fixtureAccount().id, id, 'deleted');
        await storage.setConversations('10000000-0000-4000-8000-000000000001', [deleted]);
        markConfirmedDeleted('10000000-0000-4000-8000-000000000001', id);
        const listed = { ...sourceIndex(deleted), title: 'Restored RPC title' };
        assert.equal((await ingestRpcList([listed], '10000000-0000-4000-8000-000000000001', 0)).accepted, 0, 'request begun before deletion is stale');
        await upsertConversations([{ id, title: 'Stale page title', cloudAvailability: 'available' }], 'network-detail', true, '10000000-0000-4000-8000-000000000001');
        assert.deepEqual(await storage.getConversations('10000000-0000-4000-8000-000000000001'), [deleted]);
        env.fail('conversations_10000000-0000-4000-8000-000000000001');
        await assert.rejects(ingestRpcList([listed], '10000000-0000-4000-8000-000000000001', Date.now() + 1000), /write failed/);
        env.fail();
        await upsertConversations([{ id, title: 'Stale page title' }], 'page-sync', true, '10000000-0000-4000-8000-000000000001');
        assert.deepEqual(await storage.getConversations('10000000-0000-4000-8000-000000000001'), [deleted], 'failed recovery cannot clear the deletion fence');
        assert.equal((await ingestRpcList([listed], '10000000-0000-4000-8000-000000000001', Date.now() + 1000)).accepted, 1);
        const restored = (await storage.getConversations('10000000-0000-4000-8000-000000000001'))[0];
        assert.equal(Reflect.get(restored ?? {}, 'cloudAvailability'), undefined);
        assert.equal(Reflect.get(restored ?? {}, 'hasTakeoutImport'), undefined);
        assert.equal(restored.title, 'Restored RPC title');
        await upsertConversations([{ id, title: 'Next page title' }], 'page-sync', true, '10000000-0000-4000-8000-000000000001');
        assert.equal(Reflect.get((await storage.getConversations('10000000-0000-4000-8000-000000000001'))[0] ?? {}, 'messageCount'), undefined, 'successful recovery clears the old in-memory fence');
        await storage.setConversations('10000000-0000-4000-8000-000000000002', [{ ...deleted, key: { ...deleted.key, accountId: '10000000-0000-4000-8000-000000000002' } }]);
        assert.equal((await ingestRpcList([listed], '10000000-0000-4000-8000-000000000002')).accepted, 1, 'persisted deletion without a local fence also recovers');
        assert.equal(Reflect.get((await storage.getConversations('10000000-0000-4000-8000-000000000002'))[0] ?? {}, 'cloudAvailability'), undefined);
    } finally { env.restore(); }
});

import { buildExportCompletion } from '../src/core/engine/export/exportCompletion.js';
import { ingestRpcList, markConfirmedDeleted, upsertConversations } from '../src/content/syncEngine.js';
import { getDomainConversationResult } from '../src/core/storage/domain/nativePersistence.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { indexStorage } from './helpers/indexStorage.js';
import { indexFixture } from './helpers/indexFixture.js';
import { historicalFixture } from './helpers/nativeFixture.js';
import { StorageService as storage } from '../src/core/storage/storageService.js';
import { migrate, CURRENT_SCHEMA_VERSION } from '../src/core/storage/schemaMigration.js';
import { __getLegacyBackupForTest as getLegacyBackup } from '../src/core/storage/domain/domainStore.js';
import { indexFromDetail, indexFromParsed } from '../src/core/storage/conversationIndexFromParsed.js';
import { parseGeminiIndexObservation } from '../src/core/parsers/gemini/parseIndexObservation.js';
import { indexActivityTime, mergeConversationIndex, restoreConversationIndex } from '../src/core/domain/conversationIndex.js';

const row = () => indexFixture({ id: 'chat', title: 'Research', titleSource: 'rpc', updatedAt: 50, messageCount: 4 });

test('physical index roundtrip is exact, detached and account isolated', async () => {
    const env = indexStorage();
    try {
        await storage.setConversations('u0', [row()]);
        const read = await storage.getConversations('u0');
        assert.deepEqual(read, [row()]);
        read[0].title = 'External mutation';
        assert.deepEqual(await storage.getConversations('u0'), [row()]);
        assert.deepEqual(await storage.getConversations('u1'), []);
    } finally { env.restore(); }
});
test('index boundary rejects unknown fields, malformed values and duplicate identities without writes', async () => {
    const env = indexStorage();
    try {
        for (const bad of [null, 'row', [], { ...row(), messages: [] }, { ...row(), titles: {} }, { ...row(), timestamp: 5 },
            { ...row(), lastMessageAt: NaN }, { ...row(), lastMessageAt: '5' }, { ...row(), updatedAt: '5' }, { ...row(), messageCount: -1 }, { ...row(), messageCount: 1.5 },
            { ...row(), titleSource: 'made-up' }, { ...row(), title: '', titleSource: 'rpc' },
            { ...row(), url: 'https://' }, { ...row(), url: 'javascript:alert(1)' },
            { ...row(), cloudAvailability: new String('available') }, { ...row(), cloudAvailability: 'maybe' }, { ...row(), hasTakeoutImport: undefined }]) {
            assert.throws(() => restoreConversationIndex(bad), TypeError);
            env.local.gemini_conversations = [bad];
            await assert.rejects(storage.getConversations('u0'), TypeError);
        }
        await assert.rejects(storage.setConversations('u0', [row(), row()]), /Duplicate/);
        assert.equal(env.writes(), 0);
    } finally { env.restore(); }
});
test('atomic patches preserve title authority, observed count, import and authored time', async () => {
    const env = indexStorage();
    try {
        await storage.setConversations('u0', [row()]);
        await storage.updateConversation('u0', 'chat', { title: 'Weaker', titleSource: 'dom', updatedAt: 20, messageCount: 2, hasTakeoutImport: true });
        assert.deepEqual((await storage.getConversations('u0'))[0], { ...row(), hasTakeoutImport: true });
        await storage.updateConversation('u0', 'chat', { title: 'Renamed', titleSource: 'rpc', updatedAt: 70 });
        assert.equal((await storage.getConversations('u0'))[0].title, 'Renamed');
        const writes = env.writes();
        await assert.rejects(storage.updateConversation('u0', 'chat', value => { Object.assign(value, { messages: [] }); }), TypeError);
        assert.equal(env.writes(), writes);
    } finally { env.restore(); }
});
test('native detail persists separately and index updates cannot truncate or replace its body', async () => {
    const env = indexStorage();
    try {
        const detail = historicalFixture({ id: 'chat', title: 'Research', titleSource: 'rpc', messages: [
            { role: 'user', content: 'Question' }, { role: 'model', content: 'Answer' }
        ] });
        await storage.setNativeConversations('u0', [detail]);
        const before = await getDomainConversationResult('u0', 'chat');
        const index = (await storage.getConversations('u0'))[0];
        assert.equal(index.messageCount, 2);
        assert.equal('messages' in index, false);
        await storage.updateConversation('u0', 'chat', { messageCount: 1, title: 'Renamed', titleSource: 'rpc' });
        assert.deepEqual(await getDomainConversationResult('u0', 'chat'), before);
        assert.equal((await storage.conversationRepository({ providerId: 'gemini', accountSlot: 'u0' }).getConversation('chat'))?.index.title, 'Renamed');
        await storage.clearConversations('u0');
        assert.equal(await getDomainConversationResult('u0', 'chat'), null);
    } finally { env.restore(); }
});
test('released v1 upgrades directly to final v2 indexes once, merges u0 aliases, preserves raw evidence and reports rejected rows', async () => {
    const raw = [{ id: 'c_chat', title: 'Google Gemini', titles: { takeout: 'Offline title' }, timestamp: '1700000000', lastSeen: '2099', messageCount: 7, source: 'takeout' }, null];
    const env = indexStorage({ gemini_schema_version: 1, gemini_conversations: raw,
        gemini_conversations_u0: [{ id: 'chat', title: 'Online title', titleSource: 'rpc', updatedAt: 1700000005000 }],
        gemini_conversations_u1: [{ id: 'chat', title: 'Other account', updatedAt: 1 }] });
    try {
        await assert.rejects(storage.getConversations('u0'), TypeError);
        assert.deepEqual(await migrate(), { ok: true, frozen: false });
        assert.equal(CURRENT_SCHEMA_VERSION, 2);
        assert.equal(env.local.gemini_schema_version, 2);
        const index = (await storage.getConversations('u0'))[0];
        assert.equal(index.title, 'Online title'); assert.equal(index.titleSource, 'rpc');
        assert.equal(index.hasTakeoutImport, true); assert.equal(index.updatedAt, 1700000005000);
        assert.equal(index.createdAt, undefined); assert.equal(index.messageCount, undefined);
        assert.equal(env.local.gemini_conversations_u0, undefined);
        assert.equal((await storage.getConversations('u1'))[0].title, 'Other account');
        assert.deepEqual(await getLegacyBackup('index-v2:gemini_conversations'), raw);
        assert.equal((env.local.gemini_index_migration_v2 as { issues: unknown[] }).issues.length, 1);
        const writes = env.writes(); await migrate(); await storage.getConversations('u0'); assert.equal(env.writes(), writes);
    } finally { env.restore(); }
});
test('failed index migration withholds schema stamp and retries without losing alias data or backups', async () => {
    const raw = [{ id: 'chat', title: 'Research', timestamp: 42 }];
    const env = indexStorage({ gemini_schema_version: 1, gemini_conversations_u0: raw });
    try {
        env.fail('gemini_conversations');
        assert.equal((await migrate()).ok, false);
        assert.equal(env.local.gemini_schema_version, 1);
        assert.deepEqual(env.local.gemini_conversations_u0, raw);
        assert.deepEqual(await getLegacyBackup('index-v2:gemini_conversations_u0'), raw);
        env.fail(); assert.equal((await migrate()).ok, true);
        assert.equal((await storage.getConversations('u0'))[0].updatedAt, 42);
    } finally { env.restore(); }
});
test('export completion records delivery without creating an Index', async () => {
    const env = indexStorage();
    try {
        const record = { title: 'Exported title', messageCount: 2, exportedAt: new Date().toISOString() };
        await storage.finalizeConversationExport('u0', 'chat', record);
        assert.deepEqual(await storage.getConversations('u0'), []);
        assert.deepEqual((await storage.getExportedIds('u0')).chat, record);
    } finally { env.restore(); }
});

test('partial and concurrent native imports retain unrelated indexes and existing metadata facts', async () => {
    const env = indexStorage();
    try {
        const existing = { ...row(), cloudAvailability: 'deleted' as const, hasTakeoutImport: true };
        const other = indexFixture({ id: 'other', title: 'Other conversation', updatedAt: 10 });
        await storage.setConversations('u0', [existing, other]);
        await storage.setConversations('u1', [other]);
        const first = historicalFixture({ id: 'chat', title: 'Weaker detail', titleSource: 'sniff', updatedAt: 999999,
            messages: [{ role: 'user', content: 'Question', timestamp: 70 }] });
        const second = historicalFixture({ id: 'added', title: 'Added conversation', messages: [{ role: 'user', content: 'New body', timestamp: 80 }] });
        await Promise.all([storage.setNativeConversations('u0', [first]), storage.setNativeConversations('u0', [second])]);
        const rows = await storage.getConversations('u0');
        assert.deepEqual(rows.map(value => value.id).sort(), ['added', 'chat', 'other']);
        assert.deepEqual(rows.find(value => value.id === 'other'), other);
        assert.deepEqual(rows.find(value => value.id === 'chat'), { ...existing, updatedAt: 999999 });
        assert.deepEqual(await storage.getConversations('u1'), [other]);
        assert.equal((await getDomainConversationResult('u0', 'chat'))?.conversation.messages.length, 1);
        const writes = env.writes();
        await storage.setNativeConversations('u0', []);
        assert.equal(env.writes(), writes, 'empty partial import cannot clear the list');
    } finally { env.restore(); }
});

test('native Detail source versions align with Index without claiming cloud restoration', () => {
    const old = { ...row(), createdAt: 10, updatedAt: 100, cloudAvailability: 'deleted' as const };
    const detail = historicalFixture({ id: 'chat', title: 'Research', updatedAt: 300,
        messages: [{ role: 'user', content: 'Question', timestamp: 200 }] });
    for (const source of ['detail', 'snapshot', 'takeout'] as const) {
        const observed = indexFromParsed(detail, source);
        assert.equal(observed.updatedAt, 300);
        assert.equal(observed.cloudAvailability, 'unknown');
        const merged = mergeConversationIndex(old, observed);
        assert.equal(merged.updatedAt, 300);
        assert.equal(indexActivityTime(merged), 300);
        assert.equal(merged.createdAt, 10);
        assert.equal(merged.cloudAvailability, 'deleted');
        const listed = mergeConversationIndex(merged, parseGeminiIndexObservation({ id: 'chat', title: 'Research', updatedAt: 350 }, 'rpc-list'));
        assert.equal(listed.updatedAt, 350);
        assert.equal(listed.cloudAvailability, 'available');
    }
    const { sourceVersion, ...unversioned } = detail;
    assert.equal(indexFromParsed(unversioned).updatedAt, undefined, 'message dates cannot manufacture a source version');
    assert.equal(mergeConversationIndex(old, { ...old, cloudAvailability: 'unlisted' }).cloudAvailability, 'deleted');
});

test('export chatTime remains an export baseline and never poisons metadata updatedAt', async () => {
    const env = indexStorage();
    try {
        await storage.setConversations('u0', [row()]);
        await storage.finalizeConversationExport('u0', 'chat', { title: 'Research', chatTime: 999999, messageCount: 4 });
        assert.equal((await storage.getConversations('u0'))[0].updatedAt, 50);
        const completion = buildExportCompletion({ conversation: { id: 'chat', title: 'Research', updatedAt: 999999,
            messages: [{ timestamp: 200 }] } });
        await storage.finalizeConversationExport('u0', 'chat', completion.exportRecord);
        assert.equal((await storage.getConversations('u0'))[0].updatedAt, 50);
    } finally { env.restore(); }
});


test('fresh list evidence restores deleted indexes, while stale requests, cached detail and failed recovery stay fenced', async () => {
    const env = indexStorage();
    const id = 'cloud-recovery';
    try {
        const deleted = { ...row(), id, cloudAvailability: 'deleted' as const, hasTakeoutImport: true };
        await storage.setConversations('u0', [deleted]);
        markConfirmedDeleted('u0', id);
        const listed = { ...deleted, title: 'Restored RPC title', cloudAvailability: 'available' as const };
        assert.equal((await ingestRpcList([listed], 'u0', 0)).accepted, 0, 'request begun before deletion is stale');
        await upsertConversations([{ id, title: 'Stale page title', cloudAvailability: 'available' }], 'network-detail', true, 'u0');
        assert.deepEqual(await storage.getConversations('u0'), [deleted]);
        env.fail('gemini_conversations');
        await assert.rejects(ingestRpcList([listed], 'u0', Date.now() + 1000), /write failed/);
        env.fail();
        await upsertConversations([{ id, title: 'Stale page title' }], 'page-sync', true, 'u0');
        assert.deepEqual(await storage.getConversations('u0'), [deleted], 'failed recovery cannot clear the deletion fence');
        assert.equal((await ingestRpcList([listed], 'u0', Date.now() + 1000)).accepted, 1);
        const restored = (await storage.getConversations('u0'))[0];
        assert.equal(restored.cloudAvailability, 'available');
        assert.equal(restored.hasTakeoutImport, true);
        assert.equal(restored.title, 'Restored RPC title');
        await upsertConversations([{ id, messageCount: 9 }], 'page-sync', true, 'u0');
        assert.equal((await storage.getConversations('u0'))[0].messageCount, 9, 'successful recovery clears the old in-memory fence');
        await storage.setConversations('u1', [deleted]);
        assert.equal((await ingestRpcList([listed], 'u1')).accepted, 1, 'persisted deletion without a local fence also recovers');
        assert.equal((await storage.getConversations('u1'))[0].cloudAvailability, 'available');
    } finally { env.restore(); }
});

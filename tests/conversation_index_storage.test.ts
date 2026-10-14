import { getDomainConversationResult } from '../src/core/storage/domain/nativePersistence.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { indexStorage } from './helpers/indexStorage.js';
import { indexFixture } from './helpers/indexFixture.js';
import { historicalFixture } from './helpers/nativeFixture.js';
import { StorageService as storage } from '../src/core/storage/storageService.js';
import { migrate, CURRENT_SCHEMA_VERSION } from '../src/core/storage/schemaMigration.js';
import { __getLegacyBackupForTest as getLegacyBackup } from '../src/core/storage/domain/domainStore.js';
import { restoreConversationIndex } from '../src/core/domain/conversationIndex.js';

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
            { ...row(), updatedAt: '5' }, { ...row(), messageCount: -1 }, { ...row(), messageCount: 1.5 },
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
        assert.equal((await storage.getConversationWithDetail('u0', 'chat'))?.conversation.title, 'Renamed');
        await storage.clearConversations('u0');
        assert.equal(await getDomainConversationResult('u0', 'chat'), null);
    } finally { env.restore(); }
});
test('v2 migration normalizes once, merges u0 aliases, preserves raw evidence and reports rejected rows', async () => {
    const raw = [{ id: 'c_chat', title: 'Google Gemini', titles: { takeout: 'Offline title' }, timestamp: '1700000000', lastSeen: '2099', messageCount: 7, source: 'takeout' }, null];
    const env = indexStorage({ gemini_schema_version: 2, gemini_conversations: raw,
        gemini_conversations_u0: [{ id: 'chat', title: 'Online title', titleSource: 'rpc', updatedAt: 1700000005000 }],
        gemini_conversations_u1: [{ id: 'chat', title: 'Other account', updatedAt: 1 }] });
    try {
        await assert.rejects(storage.getConversations('u0'), TypeError);
        assert.deepEqual(await migrate(), { ok: true, frozen: false });
        assert.equal(env.local.gemini_schema_version, CURRENT_SCHEMA_VERSION);
        const index = (await storage.getConversations('u0'))[0];
        assert.equal(index.title, 'Online title'); assert.equal(index.titleSource, 'rpc');
        assert.equal(index.hasTakeoutImport, true); assert.equal(index.updatedAt, 1700000005000);
        assert.equal(index.createdAt, undefined); assert.equal(index.messageCount, undefined);
        assert.equal(env.local.gemini_conversations_u0, undefined);
        assert.equal((await storage.getConversations('u1'))[0].title, 'Other account');
        assert.deepEqual(await getLegacyBackup('index-v3:gemini_conversations'), raw);
        assert.equal((env.local.gemini_index_migration_v3 as { issues: unknown[] }).issues.length, 1);
        const writes = env.writes(); await migrate(); await storage.getConversations('u0'); assert.equal(env.writes(), writes);
    } finally { env.restore(); }
});
test('failed index migration withholds schema stamp and retries without losing alias data or backups', async () => {
    const raw = [{ id: 'chat', title: 'Research', timestamp: 42 }];
    const env = indexStorage({ gemini_schema_version: 2, gemini_conversations_u0: raw });
    try {
        env.fail('gemini_conversations');
        assert.equal((await migrate()).ok, false);
        assert.equal(env.local.gemini_schema_version, 2);
        assert.deepEqual(env.local.gemini_conversations_u0, raw);
        assert.deepEqual(await getLegacyBackup('index-v3:gemini_conversations_u0'), raw);
        env.fail(); assert.equal((await migrate()).ok, true);
        assert.equal((await storage.getConversations('u0'))[0].updatedAt, 42);
    } finally { env.restore(); }
});
test('export completion registers undated metadata without inventing conversation activity', async () => {
    const env = indexStorage();
    try {
        const record = { title: 'Exported title', messageCount: 2, exportedAt: new Date().toISOString() };
        assert.deepEqual(await storage.finalizeConversationExport('u0', 'c_chat', record), { ok: true, record });
        const index = (await storage.getConversations('u0'))[0];
        assert.equal(index.title, record.title); assert.equal(index.titleSource, 'legacy'); assert.equal(index.messageCount, 2);
        assert.equal(index.updatedAt, undefined); assert.equal(index.createdAt, undefined);
        await storage.updateConversation('u0', 'chat', { cloudAvailability: 'deleted' });
        await storage.finalizeConversationExport('u0', 'chat', record);
        assert.equal((await storage.getConversations('u0'))[0].cloudAvailability, 'deleted');
    } finally { env.restore(); }
});

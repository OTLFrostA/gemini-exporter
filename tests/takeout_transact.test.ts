import test from 'node:test';
import assert from 'node:assert/strict';
import { useIndexStorage } from './helpers/indexStorage.js';
import { historicalFixture } from './helpers/nativeFixture.js';
import { StorageService as storage } from '../src/core/storage/storageService.js';
import { handleTakeoutImport } from '../src/ui/controllers/takeoutController.js';
import { __setModuleOverride, __clearModuleOverrides } from '../src/core/utils/moduleOverrides.js';

useIndexStorage();
test.afterEach(() => __clearModuleOverrides());
const parsed = (id: string, titleSource = 'takeout') => historicalFixture({ id, title: `Title ${id}`, titleSource,
    messages: [{ role: 'user', content: 'Question' }] });

test('Takeout commits once through ingestion; UI refresh retains concurrent writes and authoritative metadata', async () => {
    await storage.ingestConversation('10000000-0000-4000-8000-000000000001', parsed('online', 'rpc'));
    let visible: unknown;
    __setModuleOverride('ConversationsStore', { getCurrentAccountId: () => '10000000-0000-4000-8000-000000000001', setConversations: (list: unknown) => { visible = list; } });
    __setModuleOverride('StorageService', { ...storage, transactConversations: () => assert.fail('UI must not merge or publish imported metadata') });
    __setModuleOverride('TakeoutEngine', { parseTakeoutZip: async () => {
        await Promise.all(['online', 'imported', 'concurrent'].map(id => storage.ingestConversation('10000000-0000-4000-8000-000000000001', parsed(id), [], 'takeout')));
        return { conversations: (await storage.getConversations('10000000-0000-4000-8000-000000000001')).filter(row => row.key.conversationId !== 'concurrent'), totalMediaCount: 0 };
    } });
    let added = -1;
    await handleTakeoutImport({} as File, { onFinished: result => { added = result.addedCount; }, onError: error => { throw error; } });
    const canonical = await storage.getConversations('10000000-0000-4000-8000-000000000001');
    assert.deepEqual(visible, canonical);
    assert.deepEqual(canonical.map(row => row.key.conversationId).sort(), ['concurrent', 'imported', 'online']);
    assert.equal(canonical.find(row => row.key.conversationId === 'online')?.titleSource, 'provider');
    assert.equal(Reflect.get(canonical.find(row => row.key.conversationId === 'online') ?? {}, 'hasTakeoutImport'), undefined);
    assert.equal(added, 1);
});

test('Takeout refresh stays bound to the importing account when selection changes', async () => {
    let visibleSlot = '10000000-0000-4000-8000-000000000001';
    __setModuleOverride('ConversationsStore', { getCurrentAccountId: () => visibleSlot, setConversations: () => assert.fail('must not refresh another account') });
    __setModuleOverride('TakeoutEngine', { parseTakeoutZip: async (_file: unknown, _progress: unknown, slot: string) => {
        assert.equal(slot, '10000000-0000-4000-8000-000000000001');
        await storage.ingestConversation(slot, parsed('imported'), [], 'takeout');
        visibleSlot = '10000000-0000-4000-8000-000000000002';
        return { conversations: await storage.getConversations(slot), totalMediaCount: 0 };
    } });
    await handleTakeoutImport({} as File, { onError: error => { throw error; } });
    assert.equal((await storage.getConversations('10000000-0000-4000-8000-000000000001')).length, 1);
    assert.deepEqual(await storage.getConversations('10000000-0000-4000-8000-000000000002'), []);
});

for (const initial of ['', '10000000-0000-4000-8000-000000000002']) test(`Takeout without Gemini accounts selects Gemini default from selection ${initial || 'empty'}`, async () => {
    const fallback = { id: '10000000-0000-4000-8000-000000000003', providerId: 'gemini', providerAccountId: 'default' };
    let selected = initial;
    let importedInto = '';
    __setModuleOverride('ConversationsStore', {
        getCurrentAccountId: () => selected, setCurrentAccountId: (id: string) => { selected = id; }, setConversations() {},
    });
    __setModuleOverride('StorageService', {
        listAccounts: async (providerId: string) => { assert.equal(providerId, 'gemini'); return []; },
        getAccount: () => assert.fail('unrelated provider selection is not an import target'),
        getOrCreateAccount: async (providerId: string, identity: string) => {
            assert.equal(providerId, 'gemini'); assert.equal(identity, 'default'); return fallback;
        },
        getConversations: async (id: string) => { assert.equal(id, fallback.id); return []; },
    });
    __setModuleOverride('TakeoutEngine', { parseTakeoutZip: async (_file: unknown, _progress: unknown, id: string) => {
        importedInto = id; return { conversations: [], totalMediaCount: 0 };
    } });
    await handleTakeoutImport({} as File, { onError: error => { throw error; } });
    assert.equal(selected, fallback.id);
    assert.equal(importedInto, fallback.id);
});

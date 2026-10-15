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
    await storage.ingestConversation('u0', parsed('online', 'rpc'));
    let visible: unknown;
    __setModuleOverride('ConversationsStore', { getCurrentSlot: () => 'u0', setConversations: (list: unknown) => { visible = list; } });
    __setModuleOverride('StorageService', { ...storage, transactConversations: () => assert.fail('UI must not merge or publish imported metadata') });
    __setModuleOverride('TakeoutEngine', { parseTakeoutZip: async () => {
        await Promise.all(['online', 'imported', 'concurrent'].map(id => storage.ingestConversation('u0', parsed(id), [], 'takeout')));
        return { conversations: (await storage.getConversations('u0')).filter(row => row.id !== 'concurrent'), totalMediaCount: 0 };
    } });
    let added = -1;
    await handleTakeoutImport({} as File, { onFinished: result => { added = result.addedCount; }, onError: error => { throw error; } });
    const canonical = await storage.getConversations('u0');
    assert.deepEqual(visible, canonical);
    assert.deepEqual(canonical.map(row => row.id).sort(), ['concurrent', 'imported', 'online']);
    assert.equal(canonical.find(row => row.id === 'online')?.titleSource, 'rpc');
    assert.equal(canonical.find(row => row.id === 'online')?.hasTakeoutImport, true);
    assert.equal(added, 1);
});

test('Takeout refresh stays bound to the importing account when selection changes', async () => {
    let visibleSlot = 'u0';
    __setModuleOverride('ConversationsStore', { getCurrentSlot: () => visibleSlot, setConversations: () => assert.fail('must not refresh another account') });
    __setModuleOverride('TakeoutEngine', { parseTakeoutZip: async (_file: unknown, _progress: unknown, slot: string) => {
        assert.equal(slot, 'u0');
        await storage.ingestConversation(slot, parsed('imported'), [], 'takeout');
        visibleSlot = 'u1';
        return { conversations: await storage.getConversations(slot), totalMediaCount: 0 };
    } });
    await handleTakeoutImport({} as File, { onError: error => { throw error; } });
    assert.equal((await storage.getConversations('u0')).length, 1);
    assert.deepEqual(await storage.getConversations('u1'), []);
});

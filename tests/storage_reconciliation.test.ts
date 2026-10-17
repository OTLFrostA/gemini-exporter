import { withRegistry } from './helpers/registryMock.js';
import { indexFixture } from './helpers/indexFixture.js';
export {};
const test = require('node:test');
const assert = require('node:assert');

// Mock chrome.storage.local; restore the global after this file's tests.
const previousChrome = (global as any).chrome;
const mockStorage: Record<string, any> = {};
(global as any).chrome = withRegistry({
    storage: {
        local: {
            get: async (keys: any) => {
                if (keys === null) return { ...mockStorage };
                if (typeof keys === 'string') keys = [keys];
                const res: Record<string, any> = {};
                for (const k of keys) {
                    if (k in mockStorage) res[k] = mockStorage[k];
                }
                return res;
            },
            set: async (obj: any) => {
                Object.assign(mockStorage, obj);
            },
            remove: async (keys: any) => {
                if (typeof keys === 'string') keys = [keys];
                for (const k of keys) delete mockStorage[k];
            }
        }
    }
});

test.after(() => { (global as any).chrome = previousChrome; });

test.beforeEach(() => {
    for (const k of Object.keys(mockStorage)) {
        delete mockStorage[k];
    }
});

const StorageService = require('../src/core/storage/storageService.js');

test('StorageService.removeConversation - removes target conversation by id or c_id', async () => {
    await StorageService.setConversations('10000000-0000-4000-8000-000000000001', ([
        { id: 'cca63136d0630930', title: 'Deleted Chat', source: 'page-sync', timestamp: 1700000000000 },
        { id: '1dc469a46941004f', title: 'Active Chat 1', source: 'network-list', timestamp: 1700000000000 },
        { id: 'c_6ea653f1f5f2f533', title: 'Active Chat 2', source: 'network-list', timestamp: 1700000000000 }
    ]).map(indexFixture));

    const res1 = await StorageService.removeConversation('10000000-0000-4000-8000-000000000001', 'cca63136d0630930');
    assert.strictEqual(res1, true);

    const list1 = await StorageService.getConversations('10000000-0000-4000-8000-000000000001');
    assert.strictEqual(list1.length, 2);
    assert.strictEqual(list1.some((c: any) => c.key.conversationId === 'cca63136d0630930'), false);

    const res2 = await StorageService.removeConversation('10000000-0000-4000-8000-000000000001', 'c_1dc469a46941004f');
    assert.strictEqual(res2, true);

    const list2 = await StorageService.getConversations('10000000-0000-4000-8000-000000000001');
    assert.strictEqual(list2.length, 1);
    assert.strictEqual(list2[0].key.conversationId.replace(/^c_/, ''), '6ea653f1f5f2f533');

    const res3 = await StorageService.removeConversation('10000000-0000-4000-8000-000000000001', 'non_existent_id');
    assert.strictEqual(res3, false);
});

test('StorageService.reconcileConversations - prunes absent cloud chats while keeping Takeout chats', async () => {
    await StorageService.setConversations('10000000-0000-4000-8000-000000000001', ([
        { id: 'cca63136d0630930', title: 'Deleted on Cloud', source: 'page-sync', timestamp: 1700000000000 },
        { id: '0214ab4226767bf9', title: 'Active Cloud Chat', source: 'network-list', timestamp: 1700000000000 },
        { providerId: 'gemini', id: 'takeout_offline_1', title: 'Imported Chat Renamed Online', titleSource: 'rpc', cloudAvailability: 'unknown', hasTakeoutImport: true },
        { providerId: 'gemini', id: 'takeout_offline_2', title: 'Takeout Title Source', titleSource: 'takeout', cloudAvailability: 'unknown', hasTakeoutImport: true },
        { providerId: 'gemini', id: 'takeout_title_only', title: 'Takeout-looking Title', titleSource: 'takeout', cloudAvailability: 'unknown', hasTakeoutImport: false }
    ]).map(indexFixture));

    const activeCloudList = [
        { id: '0214ab4226767bf9', title: 'Active Cloud Chat' }
    ];

    const result = await StorageService.reconcileConversations('10000000-0000-4000-8000-000000000001', activeCloudList, { keepTakeout: true });

    assert.strictEqual(result.removed, 0);
    assert.deepStrictEqual(result.removedIds, []);
    assert.strictEqual(result.kept, 5);

    const updatedList = await StorageService.getConversations('10000000-0000-4000-8000-000000000001');
    assert.strictEqual(updatedList.length, 5);
    const updatedIds = updatedList.map((c: any) => c.key.conversationId);
    assert.strictEqual(updatedIds.includes('cca63136d0630930'), true);
    assert.strictEqual(updatedIds.includes('0214ab4226767bf9'), true);
    assert.strictEqual(updatedIds.includes('takeout_offline_1'), true);
    assert.strictEqual(updatedIds.includes('takeout_offline_2'), true);
    assert.strictEqual(updatedIds.includes('takeout_title_only'), true);
    assert.equal(updatedList.find((c: any) => c.key.conversationId === 'takeout_offline_1')?.title, 'Imported Chat Renamed Online');
});

test('StorageService.reconcileConversations - keepTakeout false removes offline imports', async () => {
    await StorageService.setConversations('10000000-0000-4000-8000-000000000001', [
        indexFixture({ providerId: 'gemini', id: 'offline_import', title: 'Offline import', titleSource: 'takeout', cloudAvailability: 'unknown', hasTakeoutImport: true }),
        indexFixture({ providerId: 'gemini', id: 'cloud_active', title: 'Cloud chat', titleSource: 'rpc', cloudAvailability: 'available', hasTakeoutImport: false }),
    ]);
    const result = await StorageService.reconcileConversations('10000000-0000-4000-8000-000000000001', [{ id: 'cloud_active' }], { keepTakeout: false });
    assert.deepStrictEqual(result, { kept: 2, removed: 0, removedIds: [] });
    assert.deepStrictEqual((await StorageService.getConversations('10000000-0000-4000-8000-000000000001')).map((c: any) => c.key.conversationId), ['offline_import', 'cloud_active']);
});

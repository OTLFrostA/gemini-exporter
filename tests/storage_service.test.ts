import { withRegistry } from './helpers/registryMock.js';
import { indexFixture } from './helpers/indexFixture.js';
export {};
const test = require('node:test');
const assert = require('node:assert');
const StorageService = require('../src/core/storage/storageService.js');
const SchemaMigration = require('../src/core/storage/schemaMigration.js');
const DetailStore = require('../src/core/storage/conversationDetailStore.js');

test('storage_service requires UUIDs and partitions storage without a global fallback', () => {
    const first = '10000000-0000-4000-8000-000000000001';
    const second = '10000000-0000-4000-8000-000000000002';
    assert.strictEqual(StorageService.getStorageKeys(first).convKey, `conversations_${first}`);
    assert.strictEqual(StorageService.getStorageKeys(first).expKey, `exported_${first}`);
    assert.notStrictEqual(StorageService.getStorageKeys(first).convKey, StorageService.getStorageKeys(second).convKey);
    for (const invalid of [null, '', 'default', 'u0', 'u1', 'alice@example.com']) assert.throws(() => StorageService.getStorageKeys(invalid));
});

test('storage_service - reconcileConversations preserves takeout entries and purges deleted cloud entries', async () => {
    const mockStorage: Record<string, any> = {};
    const origChrome = (global as any).chrome;
    (global as any).chrome = withRegistry({
        storage: {
            local: {
                get: async (keys: any) => {
                    if (keys === null) return { ...mockStorage };
                    if (typeof keys === 'string') keys = [keys];
                    const res: Record<string, any> = {};
                    for (const k of (keys || [])) {
                        if (k in mockStorage) res[k] = mockStorage[k];
                    }
                    return res;
                },
                set: async (obj: any) => {
                    Object.assign(mockStorage, obj);
                },
                remove: async (keys: any) => {
                    if (typeof keys === 'string') keys = [keys];
                    for (const k of (keys || [])) delete mockStorage[k];
                }
            }
        }
    });

    try {
        await StorageService.setConversations('10000000-0000-4000-8000-000000000001', [
            { id: 'chat_active_1', title: 'Active Chat 1', source: 'network-list', timestamp: 1700000000000 },
            { id: 'chat_deleted', title: 'Deleted Cloud Chat', source: 'network-list', timestamp: 1700000000000 },
            { id: 'chat_takeout_only', title: 'Takeout Imported Chat', source: 'takeout', isTakeoutOnly: true, timestamp: 1700000000000 }
        ].map(indexFixture));

        const activeCloud = [{ id: 'chat_active_1', title: 'Active Chat 1' }];
        const result = await StorageService.reconcileConversations('10000000-0000-4000-8000-000000000001', activeCloud);
        assert.strictEqual(result.kept, 2, 'should keep active chat and takeout chat');
        assert.strictEqual(result.removed, 1, 'should remove deleted cloud chat');
        assert.deepStrictEqual(result.removedIds, ['chat_deleted']);

        const remaining = await StorageService.getConversations('10000000-0000-4000-8000-000000000001');
        assert.strictEqual(remaining.length, 2);
        assert.ok(remaining.some((c: any) => c.id === 'chat_active_1'));
        assert.ok(remaining.some((c: any) => c.id === 'chat_takeout_only'));
    } finally {
        (global as any).chrome = origChrome;
    }
});

test('format_store - normalizeFormat validates against allowed formats', () => {
    const FormatStore = require('../src/core/storage/formatStore.js');
    assert.strictEqual(FormatStore.normalizeFormat('markdown'), 'markdown');
    assert.strictEqual(FormatStore.normalizeFormat('json_openai'), 'markdown');
    assert.strictEqual(FormatStore.normalizeFormat('unknown_format'), 'markdown');

    assert.strictEqual(FormatStore.normalizeFormat('json_raw'), 'markdown');
});


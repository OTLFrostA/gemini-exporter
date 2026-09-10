export {};
const test = require('node:test');
const assert = require('node:assert');
const LiveStorageManager = require('../src/core/storage/liveStorageManager.js');

test('liveStorageManager - default configuration structure', () => {
    const def = LiveStorageManager.DEFAULT_LIVE_CONFIG;
    assert.strictEqual(def.enabledDb, true);
    assert.strictEqual(def.enabledDisk, false);
    assert.strictEqual(def.format, 'markdown');
    assert.strictEqual(def.includeAssets, true);
    assert.strictEqual(def.updateIndex, true);
});

test('liveStorageManager - IDB mock and live conversation persistence', async () => {
    const memoryStores: Record<string, Map<any, any>> = {
        conversations: new Map(),
        settings: new Map()
    };

    const mockIdb = {
        open: () => {
            const req: any = {
                result: {
                    objectStoreNames: {
                        contains: (name: string) => name in memoryStores
                    },
                    createObjectStore: (name: string) => {
                        memoryStores[name] = new Map();
                    },
                    transaction: (storeName: string, mode: string) => {
                        const store = memoryStores[storeName];
                        return {
                            objectStore: () => ({
                                put: (val: any, key?: any) => {
                                    const actualKey = key !== undefined ? key : val.id;
                                    store.set(actualKey, val);
                                },
                                get: (key: any) => {
                                    const reqGet: any = { result: store.get(key) };
                                    setTimeout(() => reqGet.onsuccess && reqGet.onsuccess(), 0);
                                    return reqGet;
                                },
                                getAll: () => {
                                    const reqAll: any = { result: Array.from(store.values()) };
                                    setTimeout(() => reqAll.onsuccess && reqAll.onsuccess(), 0);
                                    return reqAll;
                                },
                                delete: (key: any) => {
                                    store.delete(key);
                                },
                                clear: () => {
                                    store.clear();
                                }
                            }),
                            oncomplete: null as any,
                            onerror: null as any
                        };
                    }
                },
                onsuccess: null as any,
                onerror: null as any
            };
            // Trigger transaction auto-complete simulation
            setTimeout(() => {
                req.onsuccess && req.onsuccess();
            }, 0);
            return req;
        }
    };

    const origIdb = (global as any).indexedDB;
    (global as any).indexedDB = mockIdb;

    // Helper to simulate IDB transaction completion
    const origOpen = mockIdb.open;
    mockIdb.open = () => {
        const req: any = origOpen();
        const origResult = req.result;
        req.result = {
            ...origResult,
            transaction: (storeName: string, mode: string) => {
                const tx = origResult.transaction(storeName, mode);
                setTimeout(() => {
                    if (typeof tx.oncomplete === 'function') tx.oncomplete();
                }, 1);
                return tx;
            }
        };
        return req;
    };

    try {
        // 1. Test saveLiveConversation
        const saved = await LiveStorageManager.saveLiveConversation({
            id: 'c_test_conv_123',
            title: 'Test Live Conversation',
            messages: [
                { role: 'user', content: 'Hello Gemini' },
                { role: 'model', content: 'Hello! How can I help you today?' }
            ]
        });
        assert.strictEqual(saved, true);

        // 2. Test getLiveConversation
        const retrieved = await LiveStorageManager.getLiveConversation('test_conv_123');
        assert.ok(retrieved);
        assert.strictEqual(retrieved.id, 'test_conv_123');
        assert.strictEqual(retrieved.title, 'Test Live Conversation');
        assert.strictEqual(retrieved.turnCount, 2);

        // 3. Test setLiveConfig & getLiveConfig
        await LiveStorageManager.setLiveConfig({ enabledDisk: true, dirName: 'MyNotes' });
        const cfg = await LiveStorageManager.getLiveConfig();
        assert.strictEqual(cfg.enabledDisk, true);
        assert.strictEqual(cfg.dirName, 'MyNotes');

        // 4. Test listLiveConversations
        const list = await LiveStorageManager.listLiveConversations();
        assert.strictEqual(list.length, 1);
        assert.strictEqual(list[0].id, 'test_conv_123');

        // 5. Test removeLiveConversation
        const removed = await LiveStorageManager.removeLiveConversation('test_conv_123');
        assert.strictEqual(removed, true);
        const afterRemove = await LiveStorageManager.getLiveConversation('test_conv_123');
        assert.strictEqual(afterRemove, null);
    } finally {
        (global as any).indexedDB = origIdb;
    }
});

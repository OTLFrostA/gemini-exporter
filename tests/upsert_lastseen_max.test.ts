import { indexFixture } from './helpers/indexFixture.js';
/**
 * Server-authored updatedAt is monotonic across index observations.
 * Legacy/local lastSeen is not an activity version and must not enter Domain;
 * unknown source times remain absent rather than being seeded from Date.now().
 */
export {};
const test = require('node:test');
const assert = require('node:assert');
const SyncEngine = require('../src/content/syncEngine.js');
const { __setModuleOverride, __getModuleOverride } = require('../src/core/utils/moduleOverrides.js');

function mockStorageContext() {
    const previousChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    const previousStorage = __getModuleOverride('StorageService');
    let savedList: any[] = [];
    const mockStorage = {
        getConversations: async () => ([...savedList]).map(indexFixture),
        transactConversations: async (_slot: string, updater: any) => {
            const res = updater([...savedList]);
            if (res && res.list) savedList = res.list;
            return { list: savedList, changed: res?.changed || 0, written: !!res };
        },
        setLastSync: async () => {},
        updateAccountSlot: async () => {},
        getScanCheckpoint: async () => null,
        setScanCheckpoint: async () => {}
    };
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: { sendMessage: () => {} } } });
    __setModuleOverride('StorageService', mockStorage);
    return {
        seed: (items: any[]) => { savedList = items.map(indexFixture); },
        find: (id: string) => savedList.find((c: any) => c.id === id),
        restore: () => {
            __setModuleOverride('StorageService', previousStorage);
            if (previousChrome) Object.defineProperty(globalThis, 'chrome', previousChrome);
            else Reflect.deleteProperty(globalThis, 'chrome');
        },
    };
}

test('local observation time never enters an existing or new index', async () => {
    for (const previous of [[], [{ id: 'chat1', title: 'Research', updatedAt: 1000, lastSeen: 'old' }]]) {
        const ctx = mockStorageContext();
        try {
            ctx.seed(previous);
            await SyncEngine.upsertConversations([{ id: 'chat1', title: 'Research', updatedAt: 900, lastSeen: '2099-01-01' }], 'page-sync', true, 'u0');
            const index = ctx.find('chat1');
            assert.equal(index.updatedAt, previous.length ? 1000 : 900);
            assert.equal('lastSeen' in index, false);
            assert.equal('timestamp' in index, false);
        } finally { ctx.restore(); }
    }
});
test('an observation without authored time stays undated', async () => {
    const ctx = mockStorageContext();
    try {
        ctx.seed([]);
        await SyncEngine.upsertConversations([{ id: 'chat1', title: 'Research' }], 'page-sync', true, 'u0');
        assert.equal(ctx.find('chat1').updatedAt, undefined);
        assert.equal(ctx.find('chat1').createdAt, undefined);
    } finally { ctx.restore(); }
});

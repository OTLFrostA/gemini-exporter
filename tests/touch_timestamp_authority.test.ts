import { useAccountRuntime } from './helpers/accountRuntime.js';
useAccountRuntime();
import { indexFixture } from './helpers/indexFixture.js';
export {};
const test = require('node:test');
const assert = require('node:assert');
const SyncEngine = require('../src/content/syncEngine.js');
const { __setModuleOverride } = require('../src/core/utils/moduleOverrides.js');

// Timestamp authority:
// Local touch observations never author server timestamps. A later provider index observation
// supplies updatedAt; the touch path must not move scan checkpoints.

function mockStorageContext() {
    let savedList: any[] = [];
    let checkpoint: number | null = null;
    const mockStorage = {
        getConversations: async () => ([...savedList]).map(indexFixture),
        transactConversations: async (_slot: string, updater: any) => {
            const res = updater([...savedList]);
            if (res && res.list) savedList = res.list;
            return { list: savedList, changed: res?.changed || 0, written: !!res };
        },
        setLastSync: async () => {},
        updateAccountSlot: async () => {},
        getScanCheckpoint: async () => checkpoint,
        setScanCheckpoint: async (_s: any, ts: number | null) => { checkpoint = ts; }
    };
    (global as any).chrome = { runtime: globalThis.chrome.runtime };
    __setModuleOverride('StorageService', mockStorage);
    return {
        seed: (items: any[]) => { savedList = items.map(indexFixture); },
        getSavedList: () => savedList,
        find: (id: string) => savedList.find((c: any) => c.id === id),
        getCheckpoint: () => checkpoint,
        setCheckpoint: (ts: number | null) => { checkpoint = ts; }
    };
}

function serverItem(id: string, ts: number) {
    return {
        id,
        title: `Server ${id}`,
        titleSource: 'rpc',
        titles: { rpc: `Server ${id}` },
        timestamp: ts,
        updatedAt: ts,
        createdAt: ts - 3600000,
        url: `https://gemini.google.com/app/${id}`
    };
}

test('touch preserves server timestamp on existing record', async () => {
    const ctx = mockStorageContext();
    const SERVER_TS = 1700000000000;
    ctx.seed([serverItem('srv_chat_1', SERVER_TS)]);

    await SyncEngine.touchActiveConversation('srv_chat_1', '10000000-0000-4000-8000-000000000001', { source: 'stream-complete' });

    const rec = ctx.find('srv_chat_1');
    assert.ok(rec, 'record still exists');
    assert.strictEqual(rec.updatedAt, SERVER_TS, 'server updatedAt must not be overwritten by client clock');
    assert.equal('sidebarIndex' in rec, false);
    assert.equal('lastSeen' in rec, false);
});

test('touch on unknown record creates entry without client timestamp', async () => {
    const ctx = mockStorageContext();

    await SyncEngine.touchActiveConversation('brand_new_chat', '10000000-0000-4000-8000-000000000001', { source: 'stream-start' });

    const rec = ctx.find('brand_new_chat');
    assert.ok(rec, 'record created');
    assert.ok(rec.timestamp == null, 'no client-stamped timestamp on new record');
    assert.ok(rec.updatedAt == null, 'no client-stamped updatedAt on new record');
    assert.equal('sidebarIndex' in rec, false);
    assert.equal('lastSeen' in rec, false);
});

test('touch never moves the scan checkpoint', async () => {
    const ctx = mockStorageContext();
    const CP = 1700000050000;
    ctx.seed([serverItem('srv_chat_3', 1700000000000)]);
    ctx.setCheckpoint(CP);

    await SyncEngine.touchActiveConversation('srv_chat_3', '10000000-0000-4000-8000-000000000001', { source: 'stream-complete' });

    assert.strictEqual(ctx.getCheckpoint(), CP, 'checkpoint untouched by touch path');
});

// tests/takeout_storage_pipeline_types.test.js - TDD tests for Takeout & Storage pipeline
import test from 'node:test';
import assert from 'node:assert';

// Mock chrome.storage.local for StorageService
const mockStorage: Record<string, any> = {};
(global as any).chrome = {
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
};

import * as MediaIndex from '../src/core/engine/takeout/mediaIndex.js';
import * as TakeoutParser from '../src/core/engine/takeout/takeoutParser.js';
import * as TakeoutEngine from '../src/core/engine/takeoutEngine.js';
import StorageService from '../src/core/storage/storageService.js';
import * as FormatStore from '../src/core/storage/formatStore.js';


test('TDD: MediaIndex - extractC2PATimestamp extracts ISO timestamp from C2PA binary block', () => {
    assert.strictEqual(MediaIndex.extractC2PATimestamp(null), null);
    assert.strictEqual(MediaIndex.extractC2PATimestamp(Buffer.from('hello world')), null);

    // Simulated C2PA header with compact Google YYYYMMDDHHMMSSZ timestamp
    const fakeC2PA = Buffer.from('xpacket start="W5M0MpCehiHzreSzNTczkc9d" c2pa:claim_generator="Google" date="20260322143000Z" end="w"');
    const ts = MediaIndex.extractC2PATimestamp(fakeC2PA);
    assert.ok(typeof ts === 'number', 'should return numeric epoch timestamp');
    assert.strictEqual(new Date(ts).toISOString(), '2026-03-22T14:30:00.000Z');
});

test('TDD: MediaIndex - slot isolation ensures multi-account takeouts do not leak', () => {
    MediaIndex.clearTakeoutData();

    MediaIndex.commitTakeoutData('u0', {
        mediaMap: { 'chat_1': [{ filename: 'img0.jpg' }] },
        globalMedia: { 'img0.jpg': { path: 'u0/img0.jpg' } },
        convCache: { 'c_chat_1': { id: 'chat_1', title: 'Slot 0 Chat' } }
    });

    MediaIndex.commitTakeoutData('u1', {
        mediaMap: { 'chat_2': [{ filename: 'img1.jpg' }] },
        globalMedia: { 'img1.jpg': { path: 'u1/img1.jpg' } },
        convCache: { 'c_chat_2': { id: 'chat_2', title: 'Slot 1 Chat' } }
    });

    const storeU0 = MediaIndex.getStore('u0');
    const storeU1 = MediaIndex.getStore('u1');

    assert.ok(storeU0.convCache['c_chat_1'], 'u0 has chat_1');
    assert.ok(!storeU0.convCache['c_chat_2'], 'u0 must not have chat_2');

    assert.ok(storeU1.convCache['c_chat_2'], 'u1 has chat_2');
    assert.ok(!storeU1.convCache['c_chat_1'], 'u1 must not have chat_1');

    MediaIndex.clearTakeoutData('u1');
    assert.strictEqual(Object.keys(MediaIndex.getStore('u1').convCache).length, 0);
    assert.ok(MediaIndex.getStore('u0').convCache['c_chat_1'], 'u0 cache remains intact after clearing u1');

    MediaIndex.clearTakeoutData();
});

test('TDD: TakeoutParser - stripHtmlTags removes nested HTML and script injections safely', () => {
    assert.strictEqual(TakeoutParser.stripHtmlTags(''), '');
    assert.strictEqual(TakeoutParser.stripHtmlTags(null), '');
    assert.strictEqual(TakeoutParser.stripHtmlTags(12345), '');

    const dirty = '<div class="outer"><p>Hello <b>World</b>!</p><script>alert(1)</script></div>';
    const clean = TakeoutParser.stripHtmlTags(dirty);
    assert.strictEqual(clean, 'Hello World!alert(1)');

    const nested = '<div><span>deep <i>text</i></span></div>';
    assert.strictEqual(TakeoutParser.stripHtmlTags(nested), 'deep text');
});

test('TDD: TakeoutEngine - exports facade delegates correctly', () => {
    assert.strictEqual(typeof TakeoutEngine.getTakeoutOfflineChat, 'function');
    assert.strictEqual(typeof TakeoutEngine.getTakeoutFallbackMedia, 'function');
    assert.strictEqual(typeof TakeoutEngine.getTakeoutMediaForChat, 'function');
    assert.strictEqual(typeof TakeoutEngine.extractC2PATimestamp, 'function');
    assert.strictEqual(typeof TakeoutEngine.parseTakeoutZip, 'function');
    assert.strictEqual(typeof TakeoutEngine.clearTakeoutData, 'function');
    assert.strictEqual(typeof TakeoutEngine.getStore, 'function');
});

test('TDD: StorageService - normSlot and getStorageKeys manage slot namespace isolation', () => {
    assert.strictEqual(StorageService.normSlot(null), 'u0');
    assert.strictEqual(StorageService.normSlot(''), 'u0');
    assert.strictEqual(StorageService.normSlot('default'), 'u0');
    assert.strictEqual(StorageService.normSlot('u0'), 'u0');
    assert.strictEqual(StorageService.normSlot('u1'), 'u1');
    assert.strictEqual(StorageService.normSlot('U5'), 'u5');

    const keysU0 = StorageService.getStorageKeys('u0');
    assert.strictEqual(keysU0.convKey, 'gemini_conversations');
    assert.strictEqual(keysU0.expKey, 'exportedIds');

    const keysU2 = StorageService.getStorageKeys('u2');
    assert.strictEqual(keysU2.convKey, 'gemini_conversations_u2');
    assert.strictEqual(keysU2.expKey, 'gemini_exported_u2');
    assert.strictEqual(keysU2.syncKey, 'gemini_last_sync_u2');
});

test('TDD: StorageService - reconcileConversations preserves takeout entries and purges deleted cloud entries', async () => {
    await StorageService.setConversations('u0', [
        { id: 'chat_active_1', title: 'Active Chat 1', source: 'network-list', timestamp: 1700000000000 },
        { id: 'chat_deleted', title: 'Deleted Cloud Chat', source: 'network-list', timestamp: 1700000000000 },
        { id: 'chat_takeout_only', title: 'Takeout Imported Chat', source: 'takeout', isTakeoutOnly: true, timestamp: 1700000000000 }
    ]);

    // Active cloud scan returns only chat_active_1 (chat_deleted was removed by user)
    const activeCloud = [
        { id: 'chat_active_1', title: 'Active Chat 1' }
    ];

    const result = await StorageService.reconcileConversations('u0', activeCloud);
    assert.strictEqual(result.kept, 2, 'should keep active chat and takeout chat');
    assert.strictEqual(result.removed, 1, 'should remove deleted cloud chat');
    assert.deepStrictEqual(result.removedIds, ['chat_deleted']);

    const remaining = await StorageService.getConversations('u0');
    assert.strictEqual(remaining.length, 2);
    assert.ok(remaining.some(c => c.id === 'chat_active_1'));
    assert.ok(remaining.some(c => c.id === 'chat_takeout_only'));
});

test('TDD: FormatStore - normalizeFormat validates against allowed formats and devMode', () => {
    assert.strictEqual(FormatStore.normalizeFormat('markdown', false), 'markdown');
    assert.strictEqual(FormatStore.normalizeFormat('json_openai', false), 'json_openai');
    assert.strictEqual(FormatStore.normalizeFormat('unknown_format', false), 'markdown');

    // json_raw is only allowed when devMode is true
    assert.strictEqual(FormatStore.normalizeFormat('json_raw', false), 'markdown');
    assert.strictEqual(FormatStore.normalizeFormat('json_raw', true), 'json_raw');
});

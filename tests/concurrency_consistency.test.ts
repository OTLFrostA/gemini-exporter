import { indexFixture } from './helpers/indexFixture.js';
export {};
const test = require('node:test');
const assert = require('node:assert');
const StorageService = require('../src/core/storage/storageService.js');
const { mergeConversation } = require('../src/core/utils/mergeUtils.js');

function setupMockChromeStorage(options: { beforeSet?: (data: Record<string, any>) => Promise<void> } = {}) {
    const mockStorage: Record<string, any> = {};
    const prior = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    Object.defineProperty(globalThis, 'chrome', {
        configurable: true, writable: true,
        value: {
            storage: {
                local: {
                    get: async (keys: any) => {
                        if (keys === null) return structuredClone(mockStorage);
                        if (typeof keys === 'string') keys = [keys];
                        const result: Record<string, any> = {};
                        for (const key of (keys || [])) {
                            if (Object.prototype.hasOwnProperty.call(mockStorage, key)) {
                                result[key] = structuredClone(mockStorage[key]);
                            }
                        }
                        return result;
                    },
                    set: async (data: Record<string, any>) => {
                        await options.beforeSet?.(data);
                        Object.assign(mockStorage, structuredClone(data));
                    },
                    remove: async (keys: any) => {
                        for (const key of (typeof keys === 'string' ? [keys] : keys || [])) delete mockStorage[key];
                    },
                },
            },
        },
    });
    return {
        mockStorage,
        restore: () => {
            if (prior) Object.defineProperty(globalThis, 'chrome', prior);
            else Reflect.deleteProperty(globalThis, 'chrome');
        },
    };
}

test('StorageService.updateConversation patches only the target record and rejects missing IDs', async () => {
    const env = setupMockChromeStorage();
    try {
        await StorageService.setConversations('u0', ([
            { id: 'chat_1', title: 'Old Title 1', messageCount: 2 },
            { id: 'chat_2', title: 'Title 2', messageCount: 5 },
            { id: 'chat_3', title: 'Title 3', messageCount: 1 }
        ]).map(indexFixture));

        // 1. Update with partial object
        const updated = await StorageService.updateConversation('u0', 'chat_1', {
            title: 'New Title 1',
            messageCount: 10
        });
        assert.strictEqual(updated, true);

        const listAfter1 = await StorageService.getConversations('u0');
        assert.strictEqual(listAfter1.length, 3);
        assert.strictEqual(listAfter1[0].title, 'New Title 1');
        assert.strictEqual(listAfter1[0].messageCount, 10);
        assert.strictEqual(listAfter1[1].title, 'Title 2');
        assert.strictEqual(listAfter1[2].title, 'Title 3');

        // 2. Update with mutator function
        const updated2 = await StorageService.updateConversation('u0', 'chat_2', (conv: any) => {
            conv.title = 'Updated Title 2';
            conv.titleSource = 'rpc';
        });
        assert.strictEqual(updated2, true);

        const listAfter2 = await StorageService.getConversations('u0');
        assert.strictEqual(listAfter2[1].title, 'Updated Title 2');
        assert.strictEqual(listAfter2[1].titleSource, 'rpc');

        // 3. Non-existent conversation
        const updated3 = await StorageService.updateConversation('u0', 'chat_nonexistent', { title: 'X' });
        assert.strictEqual(updated3, false);
    } finally {
        env.restore();
    }
});

test('mergeConversation keeps source updatedAt monotonic and earliest createdAt', () => {
    const existing = {
        id: 'chat_monotonic',
        title: 'Monotonic Test',
        updatedAt: 1700000050000,
        timestamp: 1700000050000,
        createdAt: 1700000000000
    };

    // Case 1: Older RPC response arrives out of order
    const olderIncoming = {
        id: 'chat_monotonic',
        title: 'Monotonic Test Older RPC',
        updatedAt: 1700000010000,
        timestamp: 1700000010000,
        createdAt: 1700000005000,
        titleSource: 'rpc',
        source: 'network-list'
    };

    const res1 = mergeConversation(indexFixture(existing), indexFixture(olderIncoming));
    // An older index version must not overwrite the latest known source timestamp.
    assert.strictEqual(res1.merged.updatedAt, 1700000050000, 'updatedAt must not regress');
    // createdAt must remain earliest known
    assert.strictEqual(res1.merged.createdAt, 1700000000000, 'createdAt must remain earliest');

    // Case 2: Newer RPC response arrives
    const newerIncoming = {
        id: 'chat_monotonic',
        title: 'Monotonic Test Newer RPC',
        updatedAt: 1700000090000,
        timestamp: 1700000090000,
        createdAt: 1699999990000,
        titleSource: 'rpc',
        source: 'network-list'
    };

    const res2 = mergeConversation(indexFixture(existing), indexFixture(newerIncoming));
    assert.strictEqual(res2.merged.updatedAt, 1700000090000, 'updatedAt must advance to newer timestamp');
    assert.strictEqual(res2.merged.createdAt, 1699999990000, 'createdAt must advance to earlier timestamp');
});

test('overlapping updateConversation writes preserve both independent changes', async () => {
    // Unlike a sequential "export snapshot" scenario, this suspends the first
    // actual indexed-list write while a second update races on the same slot.
    let blockNext = false;
    let releaseWrite: (() => void) | undefined;
    let firstWriteEntered: (() => void) | undefined;
    const hold = new Promise<void>(resolve => { releaseWrite = resolve; });
    const entered = new Promise<void>(resolve => { firstWriteEntered = resolve; });
    const env = setupMockChromeStorage({
        beforeSet: async data => {
            if (blockNext && Object.prototype.hasOwnProperty.call(data, 'gemini_conversations')) {
                blockNext = false;
                firstWriteEntered!();
                await hold;
            }
        },
    });
    try {
        await StorageService.setConversations('u0', [
            { id: 'first', title: 'Before', messageCount: 1 },
            { id: 'second', title: 'Independent', messageCount: 1 },
        ].map(indexFixture));

        blockNext = true;
        const writeFirst = StorageService.updateConversation('u0', 'first', { title: 'After' });
        await entered; // First read-modify-write is now intentionally in flight.
        const writeSecond = StorageService.updateConversation('u0', 'second', { messageCount: 7 });
        await new Promise<void>(resolve => setImmediate(resolve)); // Give a broken unlocked implementation a chance to read stale state.
        releaseWrite!();
        const results = await Promise.all([writeFirst, writeSecond]);
        assert.deepStrictEqual(results, [true, true]);

        const final = await StorageService.getConversations('u0');
        assert.equal(final.length, 2);
        assert.equal(final.find((c: any) => c.id === 'first')?.title, 'After',
            'first committed change must not be lost by the second write');
        assert.equal(final.find((c: any) => c.id === 'second')?.messageCount, 7,
            'second committed change must not be lost by the first write');
    } finally {
        releaseWrite?.();
        env.restore();
    }
});

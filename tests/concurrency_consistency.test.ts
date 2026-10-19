import * as DomainAdmission from '../src/core/domain/ingestion.js';
import { indexFixture } from './helpers/indexFixture.js';
export {};
const test = require('node:test');
const assert = require('node:assert');
const StorageService = require('../src/core/storage/storageService.js');
const { mergeConversation } = require('../src/core/domain/indexCollection.js');

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

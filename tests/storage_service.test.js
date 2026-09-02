const test = require('node:test');
const assert = require('node:assert');
const StorageService = require('../src/core/storage/storageService.js');

test('storage_service - normSlot', () => {
    assert.strictEqual(StorageService.normSlot(null), 'u0');
    assert.strictEqual(StorageService.normSlot(''), 'u0');
    assert.strictEqual(StorageService.normSlot('default'), 'u0');
    assert.strictEqual(StorageService.normSlot('u0'), 'u0');
    assert.strictEqual(StorageService.normSlot('u1'), 'u1');
    assert.strictEqual(StorageService.normSlot('u2'), 'u2');
});

test('storage_service - getStorageKeys', () => {
    const keys0 = StorageService.getStorageKeys('u0');
    assert.strictEqual(keys0.convKey, 'gemini_conversations');
    assert.strictEqual(keys0.expKey, 'exportedIds');

    const keys1 = StorageService.getStorageKeys('u1');
    assert.strictEqual(keys1.convKey, 'gemini_conversations_u1');
    assert.strictEqual(keys1.expKey, 'gemini_exported_u1');
});

export {};
const test = require('node:test');
const assert = require('node:assert');

// Protocol anti-corruption layer must be present before consumers (mirrors
// the browser load order where protocol.js is the first content script).
if (typeof globalThis !== 'undefined' && !(globalThis as any).GeminiProtocol) {
    (globalThis as any).GeminiProtocol = require('../src/core/protocol/protocol.js');
}

const SyncController = require('../src/ui/controllers/syncController.js');

test('syncController - exports', () => {
    assert.ok(SyncController);
    assert.strictEqual(typeof SyncController.startIncrementalScan, 'function');
    assert.strictEqual(typeof SyncController.startDeepScan, 'function');
    assert.strictEqual(typeof SyncController.stopScan, 'function');
    assert.strictEqual(typeof SyncController.setScanRunning, 'function');
});

test('syncController - isScanning state management', () => {
    SyncController.setScanRunning(true);
    assert.strictEqual(SyncController.isScanning(), true);
    SyncController.setScanRunning(false);
    assert.strictEqual(SyncController.isScanning(), false);
});

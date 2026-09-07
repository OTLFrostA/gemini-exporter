const test = (typeof require !== 'undefined' && require('node:test')) ? require('node:test') : (name, fn) => { try { fn(); } catch (e) { throw new Error(`FAIL: ${name} - ${e.message}`); } };
const assert = (typeof require !== 'undefined' && require('node:assert')) ? require('node:assert') : {
    strictEqual: (a, b) => { if (a !== b) throw new Error(`${a} !== ${b}`); },
    deepStrictEqual: (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); },
    ok: (a) => { if (!a) throw new Error(`Expected truthy, got ${a}`); }
};

// Protocol anti-corruption layer must be present before consumers (mirrors
// the browser load order where protocol.js is the first content script).
if (typeof globalThis !== 'undefined' && !globalThis.GeminiProtocol) {
    globalThis.GeminiProtocol = require('../src/core/protocol/protocol.js');
}

const SyncController = (typeof require !== 'undefined') ? require('../src/ui/controllers/syncController.js') : (typeof globalThis.SyncController !== 'undefined' ? globalThis.SyncController : null);

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

const test = (typeof require !== 'undefined' && require('node:test')) ? require('node:test') : (name, fn) => { try { fn(); } catch (e) { throw new Error(`FAIL: ${name} - ${e.message}`); } };
const assert = (typeof require !== 'undefined' && require('node:assert')) ? require('node:assert') : {
    strictEqual: (a, b) => { if (a !== b) throw new Error(`${a} !== ${b}`); },
    deepStrictEqual: (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); },
    ok: (a) => { if (!a) throw new Error(`Expected truthy, got ${a}`); }
};

const ExportController = (typeof require !== 'undefined') ? require('../src/ui/controllers/exportController.js') : (typeof globalThis.ExportController !== 'undefined' ? globalThis.ExportController : null);

test('exportController - state machine and flags', () => {
    assert.strictEqual(ExportController.isRunning(), false);
    ExportController.setRunning(true);
    assert.strictEqual(ExportController.isRunning(), true);
    ExportController.setRunning(false);
    assert.strictEqual(ExportController.isRunning(), false);
});

test('exportController - exports API signatures', () => {
    assert.strictEqual(typeof ExportController.runExport, 'function');
    assert.strictEqual(typeof ExportController.abort, 'function');
    assert.strictEqual(typeof ExportController.setRunning, 'function');
    assert.strictEqual(typeof ExportController.isRunning, 'function');
    assert.strictEqual(typeof ExportController.getActiveEngine, 'function');
});

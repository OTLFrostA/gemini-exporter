export {};
const test = require('node:test');
const assert = require('node:assert');

const TakeoutController = require('../src/ui/controllers/takeoutController.js');

test('takeoutController - exports', () => {
    assert.ok(TakeoutController);
    assert.strictEqual(typeof TakeoutController.handleTakeoutImport, 'function');
});

test('takeoutController - gracefully handles null file', async () => {
    let called = false;
    await TakeoutController.handleTakeoutImport(null as any, {
        onFinished: () => { called = true; }
    });
    assert.strictEqual(called, false);
});

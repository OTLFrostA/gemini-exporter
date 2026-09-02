const test = (typeof require !== 'undefined' && require('node:test')) ? require('node:test') : (name, fn) => { try { fn(); } catch (e) { throw new Error(`FAIL: ${name} - ${e.message}`); } };
const assert = (typeof require !== 'undefined' && require('node:assert')) ? require('node:assert') : {
    strictEqual: (a, b) => { if (a !== b) throw new Error(`${a} !== ${b}`); },
    deepStrictEqual: (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); },
    ok: (a) => { if (!a) throw new Error(`Expected truthy, got ${a}`); }
};

const TakeoutController = (typeof require !== 'undefined') ? require('../src/ui/controllers/takeoutController.js') : (typeof globalThis.TakeoutController !== 'undefined' ? globalThis.TakeoutController : null);

test('takeoutController - exports', () => {
    assert.ok(TakeoutController);
    assert.strictEqual(typeof TakeoutController.handleTakeoutImport, 'function');
});

test('takeoutController - gracefully handles null file', async () => {
    let called = false;
    await TakeoutController.handleTakeoutImport(null, {
        onFinished: () => { called = true; }
    });
    assert.strictEqual(called, false);
});

const test = (typeof require !== 'undefined' && require('node:test')) ? require('node:test') : (name, fn) => { try { fn(); } catch (e) { throw new Error(`FAIL: ${name} - ${e.message}`); } };
const assert = (typeof require !== 'undefined' && require('node:assert')) ? require('node:assert') : {
    strictEqual: (a, b) => { if (a !== b) throw new Error(`${a} !== ${b}`); },
    deepStrictEqual: (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); },
    ok: (a) => { if (!a) throw new Error(`Expected truthy, got ${a}`); }
};

const DirHandleController = (typeof require !== 'undefined') ? require('../src/ui/controllers/dirHandleController.js') : (typeof globalThis.DirHandleController !== 'undefined' ? globalThis.DirHandleController : null);

test('dirHandleController - exports', () => {
    assert.ok(DirHandleController);
    assert.strictEqual(typeof DirHandleController.getStoredDirHandle, 'function');
    assert.strictEqual(typeof DirHandleController.saveStoredDirHandle, 'function');
    assert.strictEqual(typeof DirHandleController.verifyDirPermission, 'function');
    assert.strictEqual(typeof DirHandleController.restoreSavedDirHandle, 'function');
    assert.strictEqual(typeof DirHandleController.requestDirHandle, 'function');
    assert.strictEqual(typeof DirHandleController.getDirHandle, 'function');
    assert.strictEqual(typeof DirHandleController.setDirHandle, 'function');
});

test('dirHandleController - in-memory get and set', () => {
    const mockHandle = { name: 'my_export_folder' };
    DirHandleController.setDirHandle(mockHandle);
    assert.strictEqual(DirHandleController.getDirHandle(), mockHandle);
    DirHandleController.setDirHandle(null);
    assert.strictEqual(DirHandleController.getDirHandle(), null);
});

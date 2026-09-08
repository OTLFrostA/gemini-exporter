export {};
const test = require('node:test');
const assert = require('node:assert');

const DirHandleController = require('../src/ui/controllers/dirHandleController.js');

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

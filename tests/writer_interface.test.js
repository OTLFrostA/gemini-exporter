const test = (typeof require !== 'undefined' && require('node:test')) ? require('node:test') : (name, fn) => { try { fn(); } catch (e) { throw new Error(`FAIL: ${name} - ${e.message}`); } };
const assert = (typeof require !== 'undefined' && require('node:assert')) ? require('node:assert') : {
    strictEqual: (a, b) => { if (a !== b) throw new Error(`${a} !== ${b}`); },
    deepStrictEqual: (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); },
    ok: (a) => { if (!a) throw new Error(`Expected truthy, got ${a}`); },
    throws: (fn) => {
        let threw = false;
        try { fn(); } catch { threw = true; }
        if (!threw) throw new Error('Expected function to throw');
    }
};

const WriterInterface = (typeof require !== 'undefined') ? require('../src/core/engine/writers/writerInterface.js') : (typeof globalThis.WriterInterface !== 'undefined' ? globalThis.WriterInterface : null);

test('writerInterface - isWriter validation', () => {
    assert.ok(WriterInterface);
    assert.strictEqual(typeof WriterInterface.isWriter, 'function');
    assert.strictEqual(typeof WriterInterface.createWriter, 'function');

    assert.strictEqual(WriterInterface.isWriter(null), false);
    assert.strictEqual(WriterInterface.isWriter({}), false);
    assert.strictEqual(WriterInterface.isWriter({ writeFile: () => {} }), true);
});

test('writerInterface - createWriter factory', () => {
    // Mock JSZip
    global.JSZip = class MockJSZip {
        constructor() { this.files = {}; }
        folder() { return { file: () => {} }; }
        async generateAsync() { return new Blob(['']); }
    };

    const zipWriter = WriterInterface.createWriter('zip', { folderName: 'test_export' });
    assert.ok(zipWriter);
    assert.strictEqual(WriterInterface.isWriter(zipWriter), true);

    const mockDirHandle = {
        name: 'test_export',
        getDirectoryHandle: async () => mockDirHandle,
        getFileHandle: async () => ({ createWritable: async () => ({ write: async () => {}, close: async () => {} }) })
    };
    const fsWriter = WriterInterface.createWriter('fs', { dirHandle: mockDirHandle });
    assert.ok(fsWriter);
    assert.strictEqual(WriterInterface.isWriter(fsWriter), true);

    assert.throws(() => {
        WriterInterface.createWriter('invalid_type');
    });
});

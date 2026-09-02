const test = (typeof require !== 'undefined' && require('node:test')) ? require('node:test') : (name, fn) => { try { fn(); } catch (e) { throw new Error(`FAIL: ${name} - ${e.message}`); } };
const assert = (typeof require !== 'undefined' && require('node:assert')) ? require('node:assert') : {
    strictEqual: (a, b) => { if (a !== b) throw new Error(`${a} !== ${b}`); },
    deepStrictEqual: (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); },
    ok: (a) => { if (!a) throw new Error(`Expected truthy, got ${a}`); }
};

const FsWriterModule = (typeof require !== 'undefined') ? require('../src/core/exporter/fsWriter.js') : (typeof globalThis.FsWriter !== 'undefined' ? globalThis.FsWriter : null);

test('fsWriter - exports and helpers', () => {
    assert.ok(FsWriterModule);
    assert.ok(FsWriterModule.FsWriter);
    assert.strictEqual(typeof FsWriterModule.ensureSubDir, 'function');
    assert.strictEqual(typeof FsWriterModule.sanitizeFileName, 'function');
});

test('fsWriter - sanitizeFileName', () => {
    assert.strictEqual(FsWriterModule.sanitizeFileName('valid_name.md'), 'valid_name.md');
    assert.strictEqual(FsWriterModule.sanitizeFileName(''), 'untitled');
});

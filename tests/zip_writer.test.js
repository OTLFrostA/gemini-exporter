const test = (typeof require !== 'undefined' && require('node:test')) ? require('node:test') : (name, fn) => { try { fn(); } catch (e) { throw new Error(`FAIL: ${name} - ${e.message}`); } };
const assert = (typeof require !== 'undefined' && require('node:assert')) ? require('node:assert') : {
    strictEqual: (a, b) => { if (a !== b) throw new Error(`${a} !== ${b}`); },
    deepStrictEqual: (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); },
    ok: (a) => { if (!a) throw new Error(`Expected truthy, got ${a}`); }
};

const ZipWriter = (typeof require !== 'undefined') ? require('../src/core/exporter/zipWriter.js') : (typeof globalThis.ZipWriter !== 'undefined' ? globalThis.ZipWriter : null);

test('zipWriter - exports and instantiation', () => {
    assert.ok(ZipWriter);
    // Mock JSZip
    global.JSZip = class MockJSZip {
        constructor() {
            this.files = {};
        }
        folder(name) {
            return {
                file: (path, content) => {
                    this.files[path] = content;
                }
            };
        }
        async generateAsync(options, cb) {
            if (cb) cb({ percent: 100 });
            return new Blob(['mock-zip'], { type: 'application/zip' });
        }
    };

    const writer = new ZipWriter('test_folder');
    assert.ok(writer);
    assert.strictEqual(typeof writer.writeFile, 'function');
    assert.strictEqual(typeof writer.generateBlob, 'function');
    assert.strictEqual(typeof writer.sanitizePath, 'function');

    assert.strictEqual(writer.sanitizePath('foo/../bar/test.md'), 'foo/_/bar/test.md');
});

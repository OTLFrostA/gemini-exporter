export {};
const test = require('node:test');
const assert = require('node:assert');

const { FsWriter, ensureSubDir, sanitizeFileName } = require('../src/core/engine/writers/fsWriter.js');
const ZipWriter = require('../src/core/engine/writers/zipWriter.js');
const WriterInterface = require('../src/core/engine/writers/writerInterface.js');

// ---------------------------------------------------------------------------
// FsWriter
// ---------------------------------------------------------------------------
test('fsWriter - exports and helpers', () => {
    assert.ok(FsWriter);
    assert.strictEqual(typeof ensureSubDir, 'function');
    assert.strictEqual(typeof sanitizeFileName, 'function');
    assert.strictEqual(sanitizeFileName('valid_name.md'), 'valid_name.md');
    assert.strictEqual(sanitizeFileName(''), 'untitled');
});

// ---------------------------------------------------------------------------
// ZipWriter
// ---------------------------------------------------------------------------
test('zipWriter - exports, instantiation, and sanitization', () => {
    assert.ok(ZipWriter);
    (global as any).JSZip = class MockJSZip {
        files: Record<string, any> = {};
        constructor() { this.files = {}; }
        folder(_name: string) {
            return {
                file: (path: string, content: any) => { this.files[path] = content; }
            };
        }
        async generateAsync(_options?: any, cb?: (p: { percent: number }) => void) {
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

test('zipWriter - writeFile and generateBlob', async () => {
    const writer = new ZipWriter('my_export');
    writer.writeFile('test.txt', 'Hello world');
    assert.strictEqual(writer.getTotalBytes(), 11);
    let progressReported = null;
    const blob = await writer.generateBlob((pct: any) => {
        progressReported = pct;
    });
    assert.ok(blob);
    assert.strictEqual(progressReported, 100);
});

// ---------------------------------------------------------------------------
// WriterInterface
// ---------------------------------------------------------------------------
test('writerInterface - isWriter and createWriter factory', () => {
    assert.ok(WriterInterface);
    assert.strictEqual(typeof WriterInterface.isWriter, 'function');
    assert.strictEqual(typeof WriterInterface.createWriter, 'function');

    assert.strictEqual(WriterInterface.isWriter(null), false);
    assert.strictEqual(WriterInterface.isWriter({}), false);
    assert.strictEqual(WriterInterface.isWriter({ writeFile: () => {} }), true);

    (global as any).JSZip = class MockJSZip {
        files: Record<string, any> = {};
        constructor() { this.files = {}; }
        folder(_name: string) { return { file: (_p: string, _c: any) => {} }; }
        async generateAsync(_opts?: any) { return new Blob(['']); }
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

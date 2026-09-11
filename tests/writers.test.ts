export {};
const test = require('node:test');
const assert = require('node:assert');

const { FsWriter, ensureSubDir, sanitizeFileName } = require('../src/core/engine/writers/fsWriter.js');
const ZipWriter = require('../src/core/engine/writers/zipWriter.js');
const WriterInterface = require('../src/core/engine/writers/writerInterface.js');

// ---------------------------------------------------------------------------
// FsWriter
// ---------------------------------------------------------------------------
test('fsWriter - sanitizeFileName and ensureSubDir nested resolution', async () => {
    // 1. sanitizeFileName edge cases
    assert.strictEqual(sanitizeFileName('valid_name.md'), 'valid_name.md');
    assert.strictEqual(sanitizeFileName(''), 'untitled');
    assert.strictEqual(sanitizeFileName(null), 'untitled');
    assert.strictEqual(sanitizeFileName('invalid:name*with?chars.txt'), 'invalid_name_with_chars.txt');

    // 2. ensureSubDir nested path resolution
    const createdDirs: string[] = [];
    const mockRootHandle = {
        name: 'root',
        async getDirectoryHandle(name: string, options: any) {
            createdDirs.push(name);
            assert.strictEqual(options.create, true);
            return {
                name,
                async getDirectoryHandle(sub: string, subOpts: any) {
                    createdDirs.push(sub);
                    assert.strictEqual(subOpts.create, true);
                    return { name: sub };
                }
            };
        }
    };

    const finalSub = await ensureSubDir(mockRootHandle, 'assets/images');
    assert.deepStrictEqual(createdDirs, ['assets', 'images']);
    assert.strictEqual(finalSub.name, 'images');

    // 3. FsWriter requires valid directory handle
    assert.throws(() => {
        new FsWriter(null as any);
    }, /Directory handle is required for FsWriter/);

    // 4. FsWriter.init throws if permission is denied
    const deniedHandle = {
        queryPermission: async () => 'denied',
        requestPermission: async () => 'denied'
    };
    const deniedWriter = new FsWriter(deniedHandle);
    await assert.rejects(async () => {
        await deniedWriter.init();
    }, /Directory permission not granted: denied/);
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

test('fsWriter - rejects invalid or empty plain object content before touching file handle', async () => {
    let fileHandleCreated = false;
    const mockDirHandle = {
        name: 'gemini_export',
        getFileHandle: async () => {
            fileHandleCreated = true;
            return {
                createWritable: async () => ({
                    write: async () => {},
                    close: async () => {}
                })
            };
        }
    };

    const writer = new FsWriter(mockDirHandle, 'gemini_export');
    await writer.init();

    // Plain empty object from broken JSON serialization must throw and not create file handle
    await assert.rejects(async () => {
        await writer.writeFile('', 'broken_image.jpg', {});
    }, /Invalid content object passed to writeFile/);
    assert.strictEqual(fileHandleCreated, false, 'Must not create file handle on disk for invalid object');

    // Null or undefined content must throw
    await assert.rejects(async () => {
        await writer.writeFile('', 'null_file.md', null);
    }, /Cannot write null or undefined content/);
    assert.strictEqual(fileHandleCreated, false, 'Must not create file handle on disk for null');

    // Valid string or Uint8Array must succeed and call getFileHandle
    const okName = await writer.writeFile('', 'valid.txt', 'Hello world');
    assert.strictEqual(okName, 'valid.txt');
    assert.strictEqual(fileHandleCreated, true);
});

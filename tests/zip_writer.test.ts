import test from 'node:test';
import assert from 'node:assert';

import ZipWriter from '../src/core/engine/writers/zipWriter.js';

test('zipWriter - exports and instantiation', () => {
    assert.ok(ZipWriter);
    // Mock JSZip
    (global as any).JSZip = class MockJSZip {
        files: Record<string, any> = {};
        constructor() {
            this.files = {};
        }
        folder(_name: string) {
            return {
                file: (path: string, content: any) => {
                    this.files[path] = content;
                }
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
    const blob = await writer.generateBlob((pct) => {
        progressReported = pct;
    });
    assert.ok(blob);
    assert.strictEqual(progressReported, 100);
});

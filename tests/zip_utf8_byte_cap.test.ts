import test from 'node:test';
import assert from 'node:assert/strict';
import { runExport } from '../src/application/export/runExport.js';
import { getExportRecord } from '../src/l3a/storageService.js';
import { ZipWriter, __getZipConstructor, __setZipConstructor } from '../src/l4/packaging/writers/zipWriter.js';
import { exportKey, exportRequest, seedExportConversation, v2ExportHost } from './helpers/v2ExportHost.js';

const JSZip = require('../lib/jszip.min.js');

test('batch browser export enforces the ZIP cap in UTF-8 bytes before delivery or commit', async t => {
    const host = v2ExportHost(t);
    const previousZip = __getZipConstructor();
    const originalWrite = ZipWriter.prototype.writeFile;
    let writes = 0;
    __setZipConstructor(JSZip);
    ZipWriter.prototype.writeFile = function (...args) {
        this.MAX_SAFE_ZIP_BYTES = 4096;
        writes++;
        return originalWrite.apply(this, args);
    };
    t.after(() => {
        ZipWriter.prototype.writeFile = originalWrite;
        __setZipConstructor(previousZip);
    });
    const ids = ['汉'.repeat(600), 'small'];
    for (const id of ids) await seedExportConversation(id);
    const result = await runExport(exportRequest(ids));

    assert.ok(writes > 0, 'the application must reach the real ZIP writer');
    assert.equal(host.clicks(), 0, 'oversized UTF-8 content must not be downloaded');
    assert.equal(host.blobs.length, 0);
    assert.equal(result.exported, 0);
    assert.deepEqual(result.failed, ids.map(exportKey));
    for (const id of ids) assert.equal(await getExportRecord(exportKey(id)), null);
});

test('ZIP cap accepts exact UTF-8 boundaries and rejects overflow before adding a file', t => {
    const previousZip = __getZipConstructor();
    __setZipConstructor(JSZip);
    t.after(() => __setZipConstructor(previousZip));
    for (const content of ['', 'a'.repeat(10), '汉汉汉a', '😀😀aa']) {
        const writer = new ZipWriter();
        writer.MAX_SAFE_ZIP_BYTES = 10;
        writer.writeFile('body.txt', content);
        assert.equal(writer.totalBytes, new TextEncoder().encode(content).byteLength);
        writer.writeFile('empty.txt', '');
    }
    for (const content of ['汉'.repeat(10), 'a'.repeat(11), '😀😀汉']) {
        const writer = new ZipWriter();
        writer.MAX_SAFE_ZIP_BYTES = 10;
        assert.throws(() => writer.writeFile('body.txt', content), { code: 'PACKAGING_SIZE_LIMIT' });
        assert.equal((writer.zip as InstanceType<typeof JSZip>).file('body.txt'), null);
    }
    const writer = new ZipWriter();
    writer.MAX_SAFE_ZIP_BYTES = 10;
    writer.writeFile('first.txt', '汉汉');
    assert.throws(() => writer.writeFile('second.txt', '汉汉'), { code: 'PACKAGING_SIZE_LIMIT' });
});

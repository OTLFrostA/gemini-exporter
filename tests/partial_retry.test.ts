import { useIndexStorage } from './helpers/indexStorage.js';
import { indexFixture } from './helpers/indexFixture.js';
useIndexStorage();

const { historicalFixture } = require('./helpers/nativeFixture.js');
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkIsUpdated, resolveConversationExportState } = require('../src/core/utils/titleUtils.js');
const { handleLiveSaveViaHandle } = require('../src/background/liveSaveHandler.js');
const idbStore = require('../src/core/storage/idbHandleStore.js');
const { StorageService } = require('../src/core/storage/storageService.js');

function mockDirHandle(writtenFiles: Record<string, Uint8Array | string>) {
    const writable = (name: string) => ({
        createWritable: async () => ({
            write: async (content: Uint8Array | string) => { writtenFiles[name] = content; },
            close: async () => {},
        }),
    });
    const batchDir = {
        getFileHandle: async (name: string) => writable(name),
        getDirectoryHandle: async () => ({ getFileHandle: async (name: string) => writable(`assets/${name}`) }),
    };
    return {
        name: 'UserSelectedFolder',
        queryPermission: async () => 'granted',
        getDirectoryHandle: async () => batchDir,
    };
}

async function withLiveSaveFolder<T>(fn: (written: Record<string, Uint8Array | string>) => Promise<T>): Promise<T> {
    const written: Record<string, Uint8Array | string> = {};
    const original = idbStore.getStoredDirHandle;
    idbStore.getStoredDirHandle = async () => mockDirHandle(written);
    try { return await fn(written); }
    finally { idbStore.getStoredDirHandle = original; }
}

const chatId = 'abcdef1234567890';
const nid = `c_${chatId}`;
const chat = historicalFixture({
    id: chatId, title: 'Attachment retry',
    messages: [{ role: 'user', content: 'hi' }],
});

test('live save: corrupt bytes leave a retryable partial export record in actual storage', async () => {
    await withLiveSaveFolder(async written => {
        const result = await handleLiveSaveViaHandle({
            chat, safeTitle: 'Attachment retry', nid,
            assets: [{ fileName: 'bad_img.png', subDir: 'assets', base64: '!!!' }],
        }, '10000000-0000-4000-8000-000000000001');

        assert.equal(result.ok, false);
        assert.deepEqual(result.failedAssets?.map((failure: any) => failure.file), ['bad_img.png']);
        assert.ok(result.targetFile && written[result.targetFile], 'main Markdown must be saved despite an asset failure');
        assert.equal(written['assets/bad_img.png'], undefined, 'invalid binary must never be written');

        const records = await StorageService.getExportedIds('10000000-0000-4000-8000-000000000001');
        const record = records[chatId];
        assert.ok(record, 'the real exportedIds storage must contain a record for the requested chat');
        assert.equal(record.status, 'partial');
        assert.equal(record.hasFailedAssets, true);
        assert.equal(checkIsUpdated(indexFixture({ id: chatId, updatedAt: 1000 }), record), true,
            'a failed asset must remain retryable even when the source version does not change');
        assert.equal(resolveConversationExportState(indexFixture({ id: chatId, updatedAt: 1000 }), record).needsIncrementalExport, true);
        assert.equal(Object.keys(records).length, 1, 'an alias must not create a second export record');
    });
});

test('live save: valid bytes persist and a subsequent upstream download failure becomes partial', async () => {
    await withLiveSaveFolder(async written => {
        const originalBytes = Buffer.from('img-bytes');
        const first = await handleLiveSaveViaHandle({
            chat, safeTitle: 'Attachment retry', nid,
            assets: [{ fileName: 'good_img.png', subDir: 'assets', base64: originalBytes.toString('base64') }],
        }, '10000000-0000-4000-8000-000000000001');
        assert.equal(first.ok, true);
        assert.deepEqual(first.failedAssets, []);
        assert.deepEqual(Buffer.from(written['assets/good_img.png'] as Uint8Array), originalBytes,
            'the live-save writer must preserve the actual binary payload');
        let record = (await StorageService.getExportedIds('10000000-0000-4000-8000-000000000001'))[chatId];
        assert.equal(record?.status, 'ok');
        assert.equal(record?.hasFailedAssets, false);

        const retry = await handleLiveSaveViaHandle({
            chat, safeTitle: 'Attachment retry', nid, assets: [],
            failedAssets: [{ file: 'missing.png', error: 'download returned no bytes' }],
        }, '10000000-0000-4000-8000-000000000001');
        assert.equal(retry.ok, false);
        assert.deepEqual(retry.failedAssets?.map((f: any) => f.file), ['missing.png']);
        record = (await StorageService.getExportedIds('10000000-0000-4000-8000-000000000001'))[chatId];
        assert.equal(record?.status, 'partial', 'a retry cannot silently reuse the earlier successful status');
        assert.equal(record?.hasFailedAssets, true);
    });
});

const test = require('node:test');
const assert = require('node:assert');

// Ensure GeminiUtils is loaded into globalThis if needed by core modules
const GeminiUtils = require('../src/core/utils/utils.js');
globalThis.GeminiUtils = GeminiUtils;

const AssetPipeline = require('../src/core/engine/assetPipeline.js');
const BatchWorker = require('../src/core/engine/export/batchWorker.js');
const SessionRecovery = require('../src/core/engine/export/sessionRecovery.js');
const { GeminiAPIClient } = require('../src/core/api/geminiClient.js');

test('Decoupling 1: AssetPipeline runs without chrome.tabs via fetchAssetDelegate', async () => {
    const origChrome = global.chrome;
    delete global.chrome;

    try {
        const savedFiles = [];
        const mockFolder = {
            file: (name, bytes) => {
                savedFiles.push({ name, bytes });
            }
        };

        const delegateCalls = [];
        const pipeline = new AssetPipeline({
            currentSlot: 'u0',
            useZip: true,
            folder: mockFolder,
            fetchAssetDelegate: async (req) => {
                delegateCalls.push(req);
                return {
                    success: true,
                    dataBuffer: new Uint8Array([1, 2, 3, 4]).buffer
                };
            }
        });

        const item = { url: 'https://example.com/asset.png', fileName: 'asset.png' };
        const chat = { id: 'c_test_1' };

        const result = await pipeline.processAsset(item, chat, { isImage: true });

        assert.strictEqual(delegateCalls.length, 1, 'fetchAssetDelegate must be invoked');
        assert.strictEqual(delegateCalls[0].url, 'https://example.com/asset.png');
        assert.strictEqual(delegateCalls[0].preferBuffer, true);
        assert.strictEqual(result.saved, true, 'Asset should be successfully marked as saved');
        assert.strictEqual(savedFiles.length, 1, 'Asset file must be written to zip folder');
        assert.strictEqual(savedFiles[0].name, 'asset.png');
    } finally {
        global.chrome = origChrome;
    }
});

test('Decoupling 2: BatchWorker.fetchChatDetail runs without chrome.runtime via injected messageSender', async () => {
    const origChrome = global.chrome;
    const origTabService = global.TabService;
    delete global.chrome;
    delete global.TabService;

    try {
        let sentMessage = null;
        const mockSender = (msg, callback) => {
            sentMessage = msg;
            callback({
                success: true,
                results: [{ id: 'chat_999', title: 'Decoupled Remote Chat' }]
            });
        };

        const result = await BatchWorker.fetchChatDetail(
            { id: 'chat_999' },
            0,
            1,
            'u0',
            false,
            'md',
            null,
            { messageSender: mockSender }
        );

        assert.ok(sentMessage, 'Injected messageSender must be called');
        assert.strictEqual(sentMessage.action, 'fetchBatch');
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.results[0].title, 'Decoupled Remote Chat');
    } finally {
        global.chrome = origChrome;
        global.TabService = origTabService;
    }
});

test('Decoupling 3: GeminiAPIClient respects standard AbortSignal without window.__gemExporterAborted', () => {
    const origWindow = global.window;
    delete global.window;
    if (globalThis.__gemExporterAborted) delete globalThis.__gemExporterAborted;

    try {
        const controller = new AbortController();
        const client = new GeminiAPIClient({ signal: controller.signal });

        assert.strictEqual(client.isAborted(), false, 'Should not be aborted initially');

        controller.abort();
        assert.strictEqual(
            client.isAborted(),
            true,
            'client.isAborted() must return true when AbortSignal triggers abort'
        );
    } finally {
        global.window = origWindow;
    }
});

test('Decoupling 4: SessionRecovery.finalizeChatExport uses storageAdapter without chrome.storage', async () => {
    const origChrome = global.chrome;
    delete global.chrome;

    try {
        let persistedRecord = null;
        const mockStorageAdapter = {
            saveExportRecord: async (slot, id, rec) => {
                persistedRecord = { slot, id, rec };
            }
        };

        const recordsMap = new Map();
        recordsMap.set('12345', { id: '12345', title: 'Exported Test Chat' });

        const finalized = await SessionRecovery.finalizeChatExport('12345', {
            chatRecordsMap: recordsMap,
            storageAdapter: mockStorageAdapter,
            slot: 'u0'
        });

        assert.strictEqual(finalized, true);
        assert.ok(persistedRecord, 'Record must be saved via storageAdapter');
        assert.strictEqual(persistedRecord.id, '12345');
        assert.strictEqual(persistedRecord.slot, 'u0');
    } finally {
        global.chrome = origChrome;
    }
});

import { historicalFixture } from './helpers/nativeFixture.js';
import test from 'node:test';
import assert from 'node:assert';

import { __setModuleOverride, __getModuleOverride, __resolveModule } from '../src/core/utils/moduleOverrides.js';

import AssetPipeline from '../src/core/engine/assetPipeline.js';
import * as BatchWorker from '../src/core/engine/export/batchWorker.js';
import * as SessionRecovery from '../src/core/engine/export/sessionRecovery.js';
import { GeminiAPIClient } from '../src/core/api/geminiClient.js';

test('Decoupling 1: AssetPipeline runs without chrome.tabs via fetchAssetDelegate', async () => {
    const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    delete (global as any).chrome;


    try {
        const savedFiles: any[] = [];
        const mockWriter = {
            writeFile: async (name: string, bytes: any) => {
                savedFiles.push({ name, bytes });
                return name;
            }
        };

        const delegateCalls: any[] = [];
        const pipeline = new AssetPipeline({
            currentSlot: 'u0',
            useZip: true,
            writer: mockWriter,
            fetchAssetDelegate: async (req) => {
                delegateCalls.push(req);
                return {
                    success: true,
                    dataBuffer: new Uint8Array([1, 2, 3, 4]).buffer
                };
            }
        });

        const item = { assetId: 'test-asset', url: 'https://example.com/asset.png', fileName: 'asset.png' };
        const chat = { id: 'c_test_1' };

        const result = await pipeline.processAsset(item, chat, { isImage: true });

        assert.strictEqual(delegateCalls.length, 1, 'fetchAssetDelegate must be invoked');
        assert.strictEqual(delegateCalls[0].url, 'https://example.com/asset.png');
        assert.strictEqual(delegateCalls[0].preferBuffer, true);
        assert.strictEqual(result.ok, true, 'Asset should be successfully marked as saved');
        assert.strictEqual(savedFiles.length, 1, 'Asset file must be written to zip folder');
        assert.strictEqual(savedFiles[0].name, 'asset.png');
        assert.deepStrictEqual([...new Uint8Array(savedFiles[0].bytes)], [1, 2, 3, 4], 'saved asset bytes must match the delegate response');

    } finally {
        if (chromeDescriptor) Object.defineProperty(globalThis, 'chrome', chromeDescriptor);
        else delete (global as any).chrome;
    }
});

test('Decoupling 2: BatchWorker.fetchChatDetail runs without chrome.runtime via injected messageSender', async () => {
    const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    delete (global as any).chrome;
    // Clear any TabService test override so the seam resolves to null
    const previousTabService = __getModuleOverride('TabService');
    __setModuleOverride('TabService', undefined);

    try {
        let sentMessage: any = null;
        const mockSender = (msg: any, callback: any) => {
            sentMessage = msg;
            callback({
                success: true, domainEnvelopeVersion: 2,
                results: [historicalFixture({ id: 'chat_999', title: 'Decoupled Remote Chat' })]
            });
        };

        const result = await BatchWorker.fetchChatDetail(
            { id: 'chat_999' } as any,
            0,
            1,
            'u0',
            false,
            'md',
            null as any,
            { messageSender: mockSender } as any
        );

        assert.ok(sentMessage, 'Injected messageSender must be called');
        assert.strictEqual(sentMessage.action, 'fetchBatch');
        assert.ok(result && typeof result === 'object' && 'success' in result && 'results' in result);
        assert.strictEqual(result.success, true);
        assert.ok(Array.isArray(result.results));
        const chat = result.results![0];
        assert.ok(chat && 'conversation' in chat);
        assert.strictEqual(chat.conversation.index.title, 'Decoupled Remote Chat');
    } finally {
        if (chromeDescriptor) Object.defineProperty(globalThis, 'chrome', chromeDescriptor);
        else delete (global as any).chrome;
        __setModuleOverride('TabService', previousTabService);
    }
});

test('Decoupling 3: GeminiAPIClient respects standard AbortSignal without window.__gemExporterAborted', () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const abortFlagDescriptor = Object.getOwnPropertyDescriptor(globalThis, '__gemExporterAborted');
    delete (global as any).window;
    delete (globalThis as any).__gemExporterAborted;

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
        if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
        else delete (global as any).window;
        if (abortFlagDescriptor) Object.defineProperty(globalThis, '__gemExporterAborted', abortFlagDescriptor);
        else delete (globalThis as any).__gemExporterAborted;
    }
});

test('Decoupling 4: SessionRecovery.finalizeChatExport uses storageAdapter without chrome.storage', async () => {
    const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    delete (global as any).chrome;

    try {
        let persistedRecord: any = null;
        const mockStorageAdapter = {
            saveExportRecord: async (slot: any, id: any, rec: any) => {
                persistedRecord = { slot, id, rec };
            }
        };

        const recordsMap = new Map();
        recordsMap.set('12345', { id: '12345', title: 'Exported Test Chat' });

        const finalized = await SessionRecovery.finalizeChatExport('12345', {
            chatRecordsMap: recordsMap,
            storageAdapter: mockStorageAdapter as any,
            slot: 'u0'
        } as any);

        assert.strictEqual(finalized, true);
        assert.ok(persistedRecord, 'Record must be saved via storageAdapter');
        assert.strictEqual(persistedRecord.id, '12345');
        assert.strictEqual(persistedRecord.slot, 'u0');
    } finally {
        if (chromeDescriptor) Object.defineProperty(globalThis, 'chrome', chromeDescriptor);
        else delete (global as any).chrome;
    }
});

test('Decoupling 5: moduleOverrides rejects overrides and ignores mocks in NODE_ENV=production', () => {
    const origEnv = process.env.NODE_ENV;
    try {
        process.env.NODE_ENV = 'production';
        __setModuleOverride('TestMockSeam', { mock: true });
        assert.strictEqual(__getModuleOverride('TestMockSeam'), undefined, 'Overrides must not be stored in production');
        const resolved = __resolveModule('TestMockSeam', 'defaultFallback');
        assert.strictEqual(resolved, 'defaultFallback', 'Must resolve to fallback directly in production');
    } finally {
        if (origEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = origEnv;
    }
});


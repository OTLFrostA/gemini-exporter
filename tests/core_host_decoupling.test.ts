import { historicalFixture } from './helpers/nativeFixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { __setModuleOverride, __getModuleOverride, __resolveModule } from '../src/core/utils/moduleOverrides.js';
import AssetPipeline from '../src/core/engine/assetPipeline.js';
import * as BatchWorker from '../src/core/engine/export/batchWorker.js';
import * as SessionRecovery from '../src/core/engine/export/sessionRecovery.js';
import { GeminiAPIClient } from '../src/core/api/geminiClient.js';

/** Temporarily hide one host API without leaking an absent/undefined property. */
async function withoutGlobal<T>(key: 'chrome' | 'window', run: () => Promise<T> | T): Promise<T> {
    const host = globalThis as any;
    const prior = Object.getOwnPropertyDescriptor(host, key);
    try {
        Reflect.deleteProperty(host, key);
        assert.equal(key in host, false, `${key} must actually be absent during this test`);
        return await run();
    } finally {
        if (prior) Object.defineProperty(host, key, prior);
        else Reflect.deleteProperty(host, key);
    }
}

test('AssetPipeline uses an injected asset fetcher and writer without Chrome tabs', async () => {
    await withoutGlobal('chrome', async () => {
        const savedFiles: Array<{ name: string; bytes: Uint8Array }> = [];
        const delegateCalls: any[] = [];
        const pipeline = new AssetPipeline({
            currentSlot: 'u0',
            useZip: true,
            writer: {
                writeFile: async (name: string, bytes: Uint8Array) => {
                    savedFiles.push({ name, bytes });
                    return name;
                },
            },
            fetchAssetDelegate: async req => {
                delegateCalls.push(req);
                return { success: true, dataBuffer: new Uint8Array([1, 2, 3, 4]).buffer };
            },
        });

        const result = await pipeline.processAsset(
            { assetId: 'test-asset', url: 'https://example.com/asset.png', fileName: 'asset.png' },
            { id: 'c_test_1' }, { isImage: true },
        );
        assert.equal(delegateCalls.length, 1);
        assert.equal(delegateCalls[0].url, 'https://example.com/asset.png');
        assert.equal(delegateCalls[0].preferBuffer, true);
        assert.equal(result.ok, true);
        assert.equal(savedFiles.length, 1);
        assert.equal(savedFiles[0].name, 'asset.png');
        assert.deepEqual([...savedFiles[0].bytes], [1, 2, 3, 4],
            'the writer must receive the delegate\'s original bytes, not just a success marker');
        if (result.ok) assert.equal(result.value.path, 'asset.png');
    });
});

test('BatchWorker uses the injected message sender without Chrome runtime or TabService', async () => {
    await withoutGlobal('chrome', async () => {
        const requests: unknown[] = [];
        const result = await BatchWorker.fetchChatDetail(
            { id: 'chat_999' },
            0, 1, 'u0', false, 'md', null,
            {
                tabService: {}, // force the transport seam instead of trying the browser implementation
                messageSender: (msg: unknown, callback: (reply: unknown) => void) => {
                    requests.push(msg);
                    callback({
                        success: true, domainEnvelopeVersion: 2,
                        results: [historicalFixture({ id: 'chat_999', title: 'Decoupled Remote Chat' })],
                    });
                },
            },
        );
        assert.equal(requests.length, 1, 'the injected transport must receive the request');
        assert.deepEqual(requests[0], {
            action: 'fetchBatch', ids: [{ id: 'chat_999' }], format: 'md',
            skipExported: false, globalOffset: 0, globalTotal: 1, accountSlot: 'u0',
        });
        assert.equal(result.success, true);
        assert.ok(Array.isArray(result.results));
        assert.equal(result.results?.length, 1);
        const chat = result.results![0];
        assert.ok(chat && 'conversation' in chat);
        assert.equal(chat.conversation.index.title, 'Decoupled Remote Chat');
    });
});

test('GeminiAPIClient honors constructor and request AbortSignals without browser state', async () => {
    const host = globalThis as any;
    const previous = Object.getOwnPropertyDescriptor(host, '__gemExporterAborted');
    try {
        Reflect.deleteProperty(host, '__gemExporterAborted');
        await withoutGlobal('window', () => {
            const controller = new AbortController();
            const perCall = new AbortController();
            const client = new GeminiAPIClient({ signal: controller.signal });
            assert.equal(client.isAborted(), false);
            perCall.abort();
            assert.equal(client.isAborted(perCall.signal), true, 'per-call cancellation must work without a window');
            assert.equal(client.isAborted(), false, 'per-call cancellation must not permanently abort the client');
            controller.abort();
            assert.equal(client.isAborted(), true);
            const already = new AbortController();
            already.abort();
            assert.equal(new GeminiAPIClient({ signal: already.signal }).isAborted(), true);
        });
    } finally {
        if (previous) Object.defineProperty(host, '__gemExporterAborted', previous);
        else Reflect.deleteProperty(host, '__gemExporterAborted');
    }
});

test('SessionRecovery finalizes through its injected adapter without Chrome storage', async () => {
    await withoutGlobal('chrome', async () => {
        const writes: Array<{ slot: string; id: string; rec: any }> = [];
        const callbacks: Array<{ id: string; rec: any }> = [];
        const record = { id: '12345', title: 'Exported Test Chat', exportedAt: 1700000000000 };
        const finalized = await SessionRecovery.finalizeChatExport('12345', {
            chatRecordsMap: new Map([['12345', record]]),
            storageAdapter: {
                saveExportRecord: async (slot: string, id: string, rec: any) => { writes.push({ slot, id, rec }); },
            },
            onItemExported: (id: string, rec: any) => { callbacks.push({ id, rec }); },
            slot: 'u0',
        } as any);
        assert.equal(finalized, true);
        assert.equal(writes.length, 1);
        assert.deepEqual(writes[0], { slot: 'u0', id: '12345', rec: record });
        assert.deepEqual(callbacks, [{ id: '12345', rec: record }]);
    });
});

test('production mode ignores injected test overrides and cannot install new ones', () => {
    const key = 'Batch046ProdOnly';
    const previous = __getModuleOverride(key);
    const priorMode = process.env.NODE_ENV;
    try {
        __setModuleOverride(key, { value: 'dev-mock' });
        assert.deepEqual(__resolveModule(key, { value: 'fallback' }), { value: 'dev-mock' });
        process.env.NODE_ENV = 'production';
        __setModuleOverride(key, { value: 'should-not-appear' });
        assert.equal(__getModuleOverride(key), undefined);
        assert.deepEqual(__resolveModule(key, { value: 'fallback' }), { value: 'fallback' });
    } finally {
        if (priorMode === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = priorMode;
        __setModuleOverride(key, previous);
    }
    assert.deepEqual(__getModuleOverride(key), previous,
        'production-mode test must restore its override state for other tests');
});

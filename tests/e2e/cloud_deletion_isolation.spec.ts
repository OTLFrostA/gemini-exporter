import { test, expect, seedRegistryAccounts } from './fixtures';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const JSZip = require(path.resolve(__dirname, '../../lib/jszip.min.js'));

test.beforeEach(async ({ context }) => { await seedRegistryAccounts(context); });

let bundle: string;
test.beforeAll(async () => {
    const result = await build({ stdin: { contents: `
        import { init } from './src/content/messageRouter.ts';
        import { SyncEngine } from './src/content/syncEngine.ts';
        import { ProviderRegistry } from './src/core/provider/providerRegistry.ts';
        import { StorageService } from './src/core/storage/storageService.ts';
        import { BatchWorker } from './src/core/engine/export/batchWorker.ts';
        import { ExportOrchestrator } from './src/core/engine/export/exportOrchestrator.ts';
        import { AssetPipeline } from './src/core/engine/assetPipeline.ts';
        import * as domain from './src/core/storage/domain/domainStore.ts';
        import { saveDomainConversation } from './src/core/domain/snapshotAdmission.ts';
        import { getDomainConversationResult } from './src/core/storage/domain/nativePersistence.ts';
        import { indexFixture } from './tests/helpers/indexFixture.ts';
        import { historicalFixture } from './tests/helpers/nativeFixture.ts';
        import { __setModuleOverride, __clearModuleOverrides } from './src/core/utils/moduleOverrides.ts';
        globalThis.deletionProbe = { ...domain, getDomainConversationResult, async run(scenario) {
            const id = 'deletion-isolation';
            const source = historicalFixture({ id, title: 'Retained archive', messages: [{ role: 'model', content: 'Saved local answer', images: [
                { url: 'https://lh3.googleusercontent.com/deletion-domain.png', fileName: 'domain.png' },
                { url: 'https://lh3.googleusercontent.com/deletion-takeout.png', fileName: 'takeout.png' },
                { url: 'https://lh3.googleusercontent.com/deletion-missing.png', fileName: 'missing.png' }
            ] }] });
            const [cached, takeout] = source.conversation.detail.assets;
            await saveDomainConversation('10000000-0000-4000-8000-000000000001', source, [{ assetId: cached.id, bytes: new Uint8Array([1, 2, 3]) }]);
            const list = scenario.noList ? [] : [indexFixture({ id, title: source.conversation.index.title, timestamp: 1, cloudAvailability: 'unlisted' })];
            await StorageService.setConversations('10000000-0000-4000-8000-000000000001', list);
            await StorageService.setConversationAvailability('10000000-0000-4000-8000-000000000001', id, 'unlisted');
            let writeFailures = 0, remoteCalls = 0, domCalls = 0;
            const order = [], warnings = [], logs = [], replies = [];
            const storage = { ...StorageService, setConversationAvailability: async (slot, cid, state) => {
                if (state === 'deleted') {
                    order.push('storage');
                    if (scenario.writeFailure) { writeFailures++; throw new Error('Injected deletion persistence failure'); }
                }
                return StorageService.setConversationAvailability(slot, cid, state);
            } };
            const provider = ProviderRegistry.getDefault();
            const originalFetch = provider.fetchConversationDetail;
            provider.fetchConversationDetail = async () => {
                if (scenario.route === 'rpc') throw new Error('rpc error (BardErrorInfo: 1167)');
                throw new Error('HTTP 503');
            };
            const originalAdd = chrome.runtime.onMessage.addListener;
            const originalWarn = console.warn;
            let listener;
            console.warn = (...args) => { warnings.push(args.map(String).join(' ')); };
            chrome.runtime.onMessage.addListener = fn => { listener = fn; };
            init({ storage, assets: null,
                syncEngine: { ...SyncEngine, markConfirmedDeleted: (slot, cid) => {
                    order.push('memory'); SyncEngine.markConfirmedDeleted(slot, cid);
                } },
                scraper: { contentFetchChatDetail: async () => {
                    domCalls++;
                    return { id, error: scenario.route === 'network' ? 'HTTP 503' : 'Not found',
                        isDeleted: scenario.route !== 'network',
                        _debug: { isNotFound: scenario.route === 'network' } };
                } }
            });
            chrome.runtime.onMessage.addListener = originalAdd;
            __setModuleOverride('StorageService', storage);
            // Control the transport only; fetchChatDetail invokes the real content router.
            __setModuleOverride('TabService', { sendToGeminiTab: message => new Promise(resolve => {
                listener(message, {}, response => { replies.push(response); resolve(response); });
            }) });
            __setModuleOverride('AssetPipeline', class extends AssetPipeline {
                constructor(options) { super({ ...options, fetchAsset: async ({ url }) => {
                    remoteCalls++;
                    const response = await fetch(url);
                    const bytes = new Uint8Array(await response.arrayBuffer());
                    return { success: true, dataBase64: btoa(String.fromCharCode(...bytes)) };
                } }); }
            });
            try {
                const result = await new ExportOrchestrator().run({ selected: [{ id }], conversations: list,
                    accountId: '10000000-0000-4000-8000-000000000001', worker: BatchWorker, useZip: true,
                    takeoutEngine: { getTakeoutOfflineChat: () => null, getTakeoutMediaForChat: () => [],
                        getTakeoutFallbackMedia: async (_id, lookup) => lookup.assetId === takeout.id ? new Uint8Array([4, 5, 6]) : null },
                    downloadHandler: blob => {
                        const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
                        link.download = 'deletion-isolation.zip'; link.click();
                    }
                }, { onLog: message => logs.push(message) });
                return { result, remoteCalls, domCalls, writeFailures, order, warnings, logs, replies,
                    availability: (await StorageService.getConversationAvailability('10000000-0000-4000-8000-000000000001'))[id],
                    persistedList: await StorageService.getConversations('10000000-0000-4000-8000-000000000001'),
                    records: await StorageService.getExportedIds('10000000-0000-4000-8000-000000000001'),
                    savedConversation: await StorageService.conversationRepository({ providerId: 'gemini', accountId: '10000000-0000-4000-8000-000000000001' }).getConversation(id),
                    conversation: source.conversation, assetId: cached.id };
            } finally {
                provider.fetchConversationDetail = originalFetch;
                console.warn = originalWarn;
                __clearModuleOverrides();
            }
        } };
    `, resolveDir: path.resolve(__dirname, '../..'), loader: 'ts' }, bundle: true, write: false,
        platform: 'browser', format: 'iife' });
    bundle = result.outputFiles[0].text;
});

const scenarios = [
    { name: 'RPC deletion', route: 'rpc', writeFailure: false, noList: false },
    { name: 'DOM deletion', route: 'dom', writeFailure: false, noList: false },
    { name: 'RPC deletion with failed persistence', route: 'rpc', writeFailure: true, noList: false },
    { name: 'DOM deletion with failed persistence', route: 'dom', writeFailure: true, noList: false },
    { name: 'RPC deletion without list metadata and failed persistence', route: 'rpc', writeFailure: true, noList: true },
    { name: 'DOM deletion without list metadata and failed persistence', route: 'dom', writeFailure: true, noList: true },
    { name: 'ordinary network failure remains unlisted', route: 'network', writeFailure: true, noList: false }
];

for (const scenario of scenarios) {
    test(`cloud deletion isolation: ${scenario.name}`, async ({ context, extensionId }, testInfo) => {
        const page = await context.newPage();
        const assetRequests: string[] = [];
        page.on('request', request => {
            if (request.url().includes('googleusercontent.com/deletion-')) assetRequests.push(request.url());
        });
        await page.route('https://lh3.googleusercontent.com/deletion-*.png', route => route.fulfill({
            status: 200, contentType: 'image/png', body: Buffer.from([7, 8, 9])
        }));
        await page.goto(`chrome-extension://${extensionId}/src/ui/options/options.html?notour=1`);
        await page.evaluate(() => {
            // The router runs in this extension document; supply explicit MAIN identity evidence.
            window.addEventListener('message', event => {
                if (event.source !== window || event.data?.type !== 'GEMINI_ACCOUNT_REQUESTED') return;
                window.postMessage({ type: 'GEMINI_ACCOUNT_OBSERVED', payload: {
                    requestId: event.data.payload.requestId, slot: 'u0',
                    observation: { providerId: 'gemini', providerAccountId: '10000000001' }
                } }, location.origin);
            });
        });
        await page.evaluate(bundle);
        const download = scenario.noList ? null : page.waitForEvent('download');
        const observed = await page.evaluate(scenario => Reflect.get(globalThis, 'deletionProbe').run(scenario), scenario);
        if (scenario.noList) {
            // Detail alone is not a conversation: absent Index blocks archive export.
            expect(observed.savedConversation).toBeNull();
            expect(observed.result.landedChats).toBe(0);
            expect(observed.result.failedChats).toHaveLength(1);
            expect(observed.result.failedChats[0].isDeleted).toBe(true);
            expect(observed.records['deletion-isolation']).toBeUndefined();
            expect(observed.persistedList).toEqual([]);
            expect(observed.remoteCalls).toBe(0);
            expect(assetRequests).toEqual([]);
            expect(observed.writeFailures).toBe(2);
            return;
        }
        const archive = await download!;
        const archivePath = testInfo.outputPath('deletion-isolation.zip');
        await archive.saveAs(archivePath);
        const zip = await JSZip.loadAsync(readFileSync(archivePath));
        const files = Object.keys(zip.files).filter(name => !zip.files[name].dir);
        const markdown = (await Promise.all(files.filter(name => name.endsWith('.md')).map(name => zip.files[name].async('string')))).join('\n');
        expect(markdown).toContain('Saved local answer');
        const contents = await Promise.all(files.map(async name => [...await zip.files[name].async('uint8array')]));
        expect(contents).toContainEqual([1, 2, 3]);
        expect(observed.replies).toHaveLength(1);
        expect(observed.result.landedChats).toBe(1);
        expect(observed.result.failedChats).toEqual([]);
        expect(observed.records['deletion-isolation'].status).toBe('partial');
        if (scenario.route === 'network') {
            expect(observed.replies[0].data.isDeleted).toBe(false);
            expect(observed.availability).toBe('unlisted');
            expect(observed.availability).toBe('unlisted');
            expect(observed.writeFailures).toBe(0);
            expect(observed.remoteCalls).toBe(2);
            expect(assetRequests).toHaveLength(2);
            expect(observed.result.failedAttachments).toEqual([]);
        } else {
            expect(observed.replies[0].success).toBe(true);
            expect(observed.replies[0].data.isDeleted).toBe(true);
            expect(observed.remoteCalls).toBe(0);
            expect(assetRequests).toEqual([]);
            expect(observed.domCalls).toBe(scenario.route === 'rpc' ? 0 : 1);
            expect(observed.result.downloadedAssets).toBe(2);
            expect(observed.result.failedAttachments).toHaveLength(1);
            expect(observed.result.failedAttachments[0].error).toMatch(/local/i);
            expect(contents).toContainEqual([4, 5, 6]);
            expect(observed.logs.join(' ')).not.toMatch(/后重试|backoff/);
            expect(observed.order.slice(0, 2)).toEqual(['memory', 'storage']);
            expect(observed.persistedList[0]).not.toHaveProperty('cloudAvailability');
            if (scenario.writeFailure) {
                expect(observed.writeFailures).toBe(2);
                expect(observed.warnings.join(' ')).toContain('Injected deletion persistence failure');
                if (!scenario.noList) expect(observed.availability).toBe('unlisted');
            } else expect(observed.availability).toBe('deleted');
        }
        // Reload proves the archive body and cached bytes survived on disk.
        await page.reload(); await page.evaluate(bundle);
        const retained = await page.evaluate(async assetId => {
            const api = Reflect.get(globalThis, 'deletionProbe');
            return { body: (await api.getDomainConversationResult('10000000-0000-4000-8000-000000000001', 'deletion-isolation')).conversation,
                bytes: [...await api.getDomainResource(api.storageIdentity('gemini', '10000000-0000-4000-8000-000000000001', 'deletion-isolation'), assetId)] };
        }, observed.assetId);
        expect(retained.body).toEqual(observed.conversation);
        expect(retained.bytes).toEqual([1, 2, 3]);
    });
}

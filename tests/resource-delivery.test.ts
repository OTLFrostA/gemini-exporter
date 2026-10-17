import { admitFixture } from './helpers/admitFixture.js';
import { acquiredReply } from './helpers/acquisitionFixture.js';
import { fixtureAccount, fixtureKey } from './helpers/domainFixture.js';
import { useIndexStorage } from './helpers/indexStorage.js';
useIndexStorage();
import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ExportOrchestrator } from '../src/core/engine/export/exportOrchestrator.js';
import { __setModuleOverride, __clearModuleOverrides } from '../src/core/utils/moduleOverrides.js';
import type { ResourceConversationParseResult } from '../src/core/parsers/parsingResult.js';
import type { AssetPipelineOptions } from '../src/core/engine/assetPipeline.js';
import type { ResourceRequest } from '../src/core/resources/resourceAcquisition.js';
import type { ResourceResult, ResourceDelivery } from '../src/core/resources/resourceResult.js';
import { makeTestWorker } from './helpers/makeTestWorker.js';
import { prepareDomainResources } from '../src/core/export/assets/prepareDomainResources.js';
import { formatHtmlDocument, formatMarkdownDocument, formatContent } from '../src/core/engine/chatFormatter.js';
import { preparePdfItem } from './helpers/pdfAcquisitionFixture.js';
import { resourceStage } from '../src/core/export/pdf/pipeline/resourceStage.js';
import { payloadStage } from '../src/core/export/pdf/pipeline/payloadStage.js';
import { PdfExporter } from '../src/core/export/pdf/pdfExporter.js';
import { StubPdfCompiler } from './helpers/stubPdfCompiler.js';
import { parseTakeoutZip } from '../src/core/imports/takeout/importTakeout.js';
import { clearTakeoutData } from '../src/core/resources/takeout/mediaIndex.js';
import { attemptResource, waitForResources } from '../src/core/resources/resourceResult.js';
const JSZip = require('../lib/jszip.min.js');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6aAAAAABJRU5ErkJggg==', 'base64');
afterEach(() => { __clearModuleOverrides(); mock.restoreAll(); });
function native(failure: string): ResourceConversationParseResult {
    return { account: fixtureAccount(), conversation: validateParserDomain({ index: { key: fixtureKey(String(`delivery-${failure}`), 'gemini'),   titleSource: "derived",   title: 'Resource failure' }, detail: { key: fixtureKey(String(`delivery-${failure}`), 'gemini'), quality: { status: 'unknown' }, assets: [
        { id: 'good', kind: 'image', name: `${'delivered_'.repeat(10)}.png`, mediaType: 'image/png', sourceUri: 'https://example.test/good' },
        { id: 'good-doc', kind: 'file', name: 'good.md', document: { contentMarkdown: '# Delivered companion' } },
        { id: 'bad', kind: failure === 'file-write' ? 'file' : 'image', name: 'bad.png',
            ...(failure === 'inline' ? {} : { sourceUri: 'missing/bad.png' }),
            ...(failure === 'file-write' ? { document: { contentMarkdown: '# Cannot write' } } : {}) },
    ], messages: [{ id: 'answer', role: 'assistant', content: [
        { type: 'paragraph', children: [{ type: 'text', text: 'Conversation survives resource failure' }] },
        { type: 'image', assetId: 'good' }, { type: 'file', assetId: 'good-doc' },
        { type: failure === 'file-write' ? 'file' : 'image', assetId: 'bad' },
    ] }] } }), diagnostics: [], acquisitionHints: failure === 'inline' ? { bad: { dataBase64: '!broken!' } } : {}, resourceHints: { bad: { archivePath: 'assets/never-delivered.png' } } };
}
for (const format of ['markdown', 'html', 'json']) for (const failure of ['throw', 'empty', 'write', 'file-write', 'inline']) {
    test(`${format}: ${failure} preserves body, delivered references and partial status in actual ZIP`, async () => {
        const source = native(failure), before = structuredClone(source);
        __setModuleOverride('JSZip', JSZip);
        const records: Record<string, { status: string; hasFailedAssets?: boolean }> = {};
        __setModuleOverride('StorageService', { getExportedIds: async () => ({}), saveExportRecord: async (_slot: string, id: string, record: { status: string }) => { records[id] = record; return records; } });
        __setModuleOverride('AssetPipeline', class {
            constructor(private readonly options: AssetPipelineOptions) {}
            async processAsset(item: ResourceRequest): Promise<ResourceResult<ResourceDelivery>> {
                if (item.assetId === 'bad' && failure !== 'write') {
                    if (failure === 'empty') return { ok: false as const, resourceId: item.assetId, reason: 'zero bytes', code: 'RESOURCE_UNAVAILABLE' };
                    throw new Error('Injected acquisition failure');
                }
                await this.options.writer!.writeFile(item.localName!, png);
                return { ok: true as const, resourceId: item.assetId, value: { path: item.localName! } };
            }
        });
        // Exercise real writer rejection, including inline document companion writes.
        if (failure === 'write' || failure === 'file-write') {
            const { ZipWriter } = require('../src/core/engine/writers/zipWriter.js');
            const originalWrite = ZipWriter.prototype.writeFile;
            mock.method(ZipWriter.prototype, 'writeFile', function (this: InstanceType<typeof ZipWriter>, path: string, data: string | Uint8Array) {
                if (path.includes('bad') || path.includes('never-delivered')) throw new Error('Injected resource write failure');
                return originalWrite.call(this, path, data);
            });
        }
        let archive: Blob | undefined;
        const worker = makeTestWorker({ fetchChatDetail: async () => await ({ success: true, chat: source }) });
        const result = await new ExportOrchestrator().run({ accountId: '10000000-0000-4000-8000-000000000001', ...({ selected: [{ id: source.conversation.index.key.conversationId, title: source.conversation.index.title }], format, useZip: true, includeAssets: true, includeIndex: true,
            worker, downloadHandler: blob => { assert.deepEqual(records, {}, 'no partial records before ZIP delivery'); archive = blob; } }) });
        assert.equal(result.landedChats, 1); assert.equal(result.failedChats.length, 0);
        assert.equal(result.failedAttachments.length, 1); assert.equal(records[source.conversation.index.key.conversationId].status, 'partial');
        assert.ok(archive);
        const zip = await JSZip.loadAsync(await archive.arrayBuffer());
        assert.equal(JSON.parse(await zip.file('gemini_export/meta.json').async('string')).conversations[0].status, records[source.conversation.index.key.conversationId].status);
        const bodyPath = Object.keys(zip.files).find(path => path.endsWith(format === 'html' ? '.html' : format === 'markdown' ? '.md' : '.json') && !path.includes('/files/'))!;
        const body: string = await zip.files[bodyPath].async('text');
        assert.match(body, /Conversation survives resource failure/);
        assert.ok(!body.includes('never-delivered.png'));
        if (format !== 'json') assert.match(body, /unavailable|不可用|missing-asset/i);
        const references = format === 'html' ? [...body.matchAll(/(?:src|href)="((?:assets|files)\/[^\"]+)"/g)].map(match => match[1])
            : format === 'markdown' ? [...body.matchAll(/\]\(((?:assets|files)\/[^)]+)\)/g)].map(match => match[1])
            : Object.values(JSON.parse(body).resources).map(resource => (resource as { path: string }).path);
        assert.equal(new Set(references).size, 2);
        for (const ref of references) assert.ok((await zip.files[`gemini_export/${decodeURIComponent(ref)}`].async('uint8array')).length > 0, ref);
        assert.deepEqual(source, before, 'source Domain and hints remain unchanged');
    });
}
test('formatters cannot turn an unconfirmed destination plan into local references', async () => {
    const source = native('throw');
    const html = await formatHtmlDocument(source), md = await formatMarkdownDocument(source);
    assert.ok(!html.content.includes('never-delivered.png')); assert.ok(!md.content.includes('never-delivered.png'));
    assert.equal(JSON.parse(formatContent(source, 'json').content).resources, undefined);
    assert.deepEqual(await prepareDomainResources([{ ok: false, resourceId: 'bad', reason: 'not written', code: 'RESOURCE_UNAVAILABLE' }]), {});
});
for (const failure of ['throw', 'empty', 'corrupt']) for (const useZip of [false, true]) for (const includeAssets of [false, true]) test(`PDF ${failure} ZIP=${useZip} assets=${includeAssets} preserves requested resource status`, async () => {
    const source = native('throw'), before = structuredClone(source);
    const pipeline = { acquireAssetBytes: async (item: ResourceRequest) => {
        if (item.assetId === 'bad') {
            if (failure === 'throw') throw new Error('Injected PDF acquisition failure');
            return { ok: true as const, resourceId: item.assetId, value: { bytes: failure === 'empty' ? new Uint8Array() : new Uint8Array([1, 2, 3]), mediaType: 'image/png' } };
        }
        return { ok: true as const, resourceId: item.assetId, value: { bytes: png, mediaType: 'image/png' } };
    } };
    const prep = await preparePdfItem(source, { accountId: '10000000-0000-4000-8000-000000000001', ...({ assetPipeline: pipeline }) }); assert.ok(prep.ok);
    const ctx = { signal: new AbortController().signal, reportProgress: () => {}, log: () => {} };
    const resources = await resourceStage({ document: prep.document, resources: prep.resources }, ctx);
    assert.deepEqual(resources.output.resourceResults.map(result => [result.resourceId, result.ok]), [['good', true], ['bad', false]]);
    assert.equal(resources.output.mounts.length, 1); assert.deepEqual(resources.output.unresolved.map(item => item.assetId), ['bad']);
    const payload = await payloadStage({ document: prep.document, pathMap: resources.output.pathMap, locale: 'en' }, ctx);
    assert.match(JSON.stringify(payload.output.payload), /Conversation survives resource failure/);
    assert.ok(!JSON.stringify(payload.output.payload).includes('never-delivered.png'));
    const files: Uint8Array[] = [], records: Array<{ status: string; hasFailedAssets: boolean }> = [];
    const result = await new PdfExporter(new StubPdfCompiler()).run({ accountId: '10000000-0000-4000-8000-000000000001', ...({ selected: [source], assetPipeline: pipeline, useZip, includeAssets, downloadHandler: async () => {},
        writer: { type: 'directory', writeFile: (_name: string, bytes: Uint8Array) => { files.push(bytes); return 'file.pdf'; }, generateBlob: async () => new Blob(['zip']) },
    }) }, { onItemExported: (_id, record) => records.push(record) });
    assert.equal(result.succeeded, 1); assert.equal(result.failed.length, 0); assert.equal(files.length, 1);
    assert.equal(records[0].status, includeAssets ? 'partial' : 'ok'); assert.equal(records[0].hasFailedAssets, includeAssets); assert.deepEqual(source, before);
});
test('Takeout entry rejection or zero bytes retains its conversation and healthy resource bytes', async () => {
    for (const mode of ['throw', 'empty']) {
        const slot = '10000000-0000-4000-8000-000000000001';
        const zip = new JSZip();
        zip.file('Takeout/Gemini/MyActivity.html', '<div class="outer-cell"><a href="https://gemini.google.com/app/delivery-takeout">Conversation</a><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Prompted Resource failure<br>2026-10-07T09:00:00Z<br><p>Conversation survives</p><img src="good.png"><img src="bad.png"></div></div>');
        zip.file('Takeout/Gemini/good.png', png); zip.file('Takeout/Gemini/bad.png', png);
        const archive = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }));
        archive.files['Takeout/Gemini/bad.png'].async = async () => { if (mode === 'throw') throw new Error('Injected CRC read failure'); return new Uint8Array(); };
        const imported = await parseTakeoutZip(archive, null, slot);
        assert.equal(imported.conversations.length, 1); assert.equal(imported.status, 'partial');
        const result = imported.convCache['delivery-takeout']; assert.ok(result.conversation.detail.messages.length);
        assert.equal(Object.keys(result.resourceHints).length, 1); assert.equal(imported.resourceResults.filter(result => !result.ok).length, 1);
        assert.ok(imported.diagnostics.some(diagnostic => diagnostic.code === 'RESOURCE_UNAVAILABLE'));
        const good = imported.resourceResults.find(result => result.ok); assert.ok(good?.ok);
        assert.ok((await imported.globalMedia[good.value.path].async!('uint8array') as Uint8Array).length);
        clearTakeoutData(slot);
    }
});
test('queued resource wait cancels promptly and ordinary resource exceptions remain recoverable', async () => {
    assert.equal((await attemptResource('broken', async () => { throw new Error('Resource error'); })).ok, false);
    const controller = new AbortController();
    const pending = waitForResources(new Promise<never>(() => {}), controller.signal);
    controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
});

test('background live save renders only after attachments settle and keeps a partial Markdown body on write failure', async () => {
    const { setMemoryDirHandle } = require('../src/core/storage/idbHandleStore.js');
    const { handleLiveSaveViaHandle } = require('../src/background/liveSaveHandler.js');
    const { StorageService } = require('../src/core/storage/storageService.js');
    const written = new Map<string, string | Uint8Array>();
    const records: Array<{ status: string }> = [];
    mock.method(StorageService, 'getConversations', async () => []);
    mock.method(StorageService, 'saveExportRecord', async (_slot: string, _id: string, record: { status: string }) => { records.push(record); return {}; });
    const directory = (prefix: string) => ({
        name: 'resource-test',
        queryPermission: async () => 'granted',
        keys: async function* () {},
        getDirectoryHandle: async (name: string) => directory(`${prefix}${name}/`),
        getFileHandle: async (name: string) => ({ createWritable: async () => ({
            write: async (data: string | Uint8Array) => {
                if (name === 'bad.png') throw new Error('Injected live attachment write failure');
                if (name.endsWith('.md')) assert.ok(written.has('gemini_export/assets/good.png'), 'attachment must settle before rendering body');
                written.set(`${prefix}${name}`, data);
            }, close: async () => {}, abort: async () => {},
        }) }),
    });
    setMemoryDirHandle(directory(''));
    try {
        const source = native('throw');
        await admitFixture(source.account.id, source);
        const result = await handleLiveSaveViaHandle({ chat: source, safeTitle: source.conversation.index.title, nid: source.conversation.index.key.conversationId,
            assets: ['good', 'bad'].map(assetId => ({ assetId, fileName: `${assetId}.png`, subDir: 'assets', base64: png.toString('base64') })) }, '10000000-0000-4000-8000-000000000001');
        assert.equal(result.ok, false); assert.equal(result.failedAssets.length, 1);
        assert.equal(records[0].status, 'partial');
        const body = written.get(`gemini_export/${result.targetFile}`) as string;
        assert.match(body, /Conversation survives resource failure/); assert.match(body, /Image unavailable/);
        assert.ok(!body.includes('never-delivered.png')); assert.ok(!body.includes('assets/bad.png'));
        assert.match(body, /assets\/good.png/); assert.ok(!written.has('gemini_export/assets/bad.png'));
    } finally { setMemoryDirHandle(null); }
});

for (const mode of ['queued', 'transport']) test(`resource cancellation ${mode} stops the batch without downloading or recording a conversation failure`, async () => {
    __setModuleOverride('JSZip', JSZip);
    __setModuleOverride('StorageService', { getExportedIds: async () => ({}), saveExportRecord: async () => { throw new Error('Cancelled export must not finalize'); } });
    const source = native('throw');
    let started!: () => void;
    const startedWork = new Promise<void>(resolve => { started = resolve; });
    __setModuleOverride('AssetPipeline', class {
        async processAsset(): Promise<ResourceResult<ResourceDelivery>> {
            started();
            if (mode === 'transport') throw new DOMException('Transport cancelled', 'AbortError');
            return new Promise<ResourceResult<ResourceDelivery>>(() => {});
        }
    });
    const engine = new ExportOrchestrator(); let downloaded = false;
    const pending = engine.run({ accountId: '10000000-0000-4000-8000-000000000001', ...({ selected: [{ id: source.conversation.index.key.conversationId, title: source.conversation.index.title }],
        worker: makeTestWorker({ fetchChatDetail: async () => await ({ success: true, chat: source }) }),
        useZip: true, includeIndex: false, downloadHandler: () => { downloaded = true; } }) });
    await startedWork;
    if (mode === 'queued') engine.abort();
    const result = await pending;
    assert.equal(result.aborted, true); assert.equal(downloaded, false);
    assert.equal(result.landedChats, 0); assert.deepEqual(result.failedChats, []);
});

test('long companion filenames remain distinct after writer normalization and receipts name actual files', async () => {
    const { planExportResources } = require('../src/core/export/assets/planExportResources.js');
    const { ZipWriter } = require('../src/core/engine/writers/zipWriter.js');
    __setModuleOverride('JSZip', JSZip);
    const source = native('throw');
    source.conversation.detail.assets = ['first', 'second'].map(id => ({ id, kind: 'file', name: `${'same-long-name-'.repeat(10)}.md`, document: { contentMarkdown: `# ${id}` } }));
    source.conversation.detail.messages[0].content = source.conversation.detail.assets.map(asset => ({ type: 'file', assetId: asset.id }));
    const planned = await planExportResources(source);
    const writer = new ZipWriter('gemini_export');
    const receipts = planned.assets.map((asset: { assetId: string; item: { localName: string }; content: string }) => ({
        ok: true as const, resourceId: asset.assetId, value: { path: writer.writeFile(asset.item.localName, asset.content) },
    }));
    assert.equal(new Set(receipts.map((receipt: { value: { path: string } }) => receipt.value.path)).size, 2);
    const body = (await formatMarkdownDocument(source, { resourceResults: receipts })).content;
    const zip = await JSZip.loadAsync(await (await writer.generateBlob()).arrayBuffer());
    for (const receipt of receipts) {
        assert.ok(body.includes(receipt.value.path));
        assert.equal(await zip.files[`gemini_export/${receipt.value.path}`].async('text'), `# ${receipt.resourceId}`);
    }
});


for (const [kind, broken] of [
    ['PNG', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
    ['JPEG', new Uint8Array([255, 216, 255])],
    ['WebP', new TextEncoder().encode('RIFFxxxxWEBP')],
    ['SVG', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><broken')],
] as const) test(`real WASM PDF: magic-valid broken ${kind} preserves body and healthy image after precise recovery`, async () => {
    const { TypstSandboxCompiler } = require('../src/core/export/typst/typstSandboxCompiler.js');
    const { RealWasmSandboxHost } = require('./helpers/realWasmSandbox.js');
    const { extractPdfText } = require('./helpers/pdfTextExtract.js');
    const compiler = new TypstSandboxCompiler({ host: new RealWasmSandboxHost() });
    const source = native('throw');
    // Two distinct assets with identical broken bytes share one content-addressed mount.
    source.conversation.detail.assets.push({ id: 'bad-alias', kind: 'image', name: 'also-broken.png' });
    source.conversation.detail.messages[0].content.push({ type: 'paragraph', children: [{ type: 'image', assetId: 'bad-alias' }] });
    const pipeline = { acquireAssetBytes: async (item: ResourceRequest) => ({ ok: true as const, resourceId: item.assetId, value: { bytes: item.assetId === 'good' ? Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') : broken, mediaType: 'image/png' } }) };
    const files: Uint8Array[] = [], records: Array<{ status: string; hasFailedAssets: boolean }> = [];
    try {
        await admitFixture(source.account.id, source);
        const result = await new PdfExporter(compiler).run({ accountId: '10000000-0000-4000-8000-000000000001', ...({ selected: [source], assetPipeline: pipeline, useZip: false,
            writer: { type: 'directory', writeFile: (_name: string, bytes: Uint8Array) => { files.push(bytes); return 'recovered.pdf'; } },
        }) }, { onItemExported: (_id, record) => records.push(record) });
        assert.equal(result.failed.length, 0); assert.equal(result.succeeded, 1); assert.equal(files.length, 1);
        assert.equal(records[0].status, 'partial'); assert.equal(records[0].hasFailedAssets, true);
        const extracted = extractPdfText(files[0]);
        assert.match(extracted.text, /Conversation survives resource failure/);
        assert.ok(extracted.imageXObjectCount >= 1, 'healthy image remains embedded in delivered PDF');
    } finally { compiler.dispose(); }
});

test('direct live save uses distinct actual filesystem paths for long image names', async () => {
    const { createLiveSaveWriter } = require('../src/core/engine/liveSaveWriter.js');
    const { processAndSaveImages } = require('../src/content/liveSaveCoordinator.js');
    const written = new Map<string, string | Uint8Array>();
    const directory = (prefix: string) => ({
        name: 'long-live-test',
        getDirectoryHandle: async (name: string) => directory(`${prefix}${name}/`),
        getFileHandle: async (name: string) => ({ createWritable: async () => ({
            write: async (bytes: string | Uint8Array) => { written.set(`${prefix}${name}`, bytes); }, close: async () => {}, abort: async () => {},
        }) }),
    });
    const source = native('throw');
    for (const asset of source.conversation.detail.assets.filter(asset => asset.kind === 'image')) {
        asset.name = `${'long_name_'.repeat(10)}${asset.id}.png`;
        source.acquisitionHints = { ...source.acquisitionHints, [asset.id]: { dataBase64: png.toString('base64') } };
        delete asset.sourceUri;
    }
    const receipts: import('../src/core/resources/resourceResult.js').ResourceResult<import('../src/core/resources/resourceResult.js').ResourceDelivery>[] = [];
    const failures: Array<{ file: string; error: string }> = [];
    const writer = await createLiveSaveWriter(directory(''));
    await processAndSaveImages(source, source.conversation.index.key.conversationId, writer, failures, receipts);
    assert.equal(failures.length, 0); assert.equal(receipts.length, 2);
    const paths = receipts.flatMap(result => result.ok ? [result.value.path] : []);
    assert.equal(new Set(paths).size, 2);
    const body = await formatMarkdownDocument(source, { resourceResults: receipts });
    for (const path of paths) {
        assert.ok(written.has(`gemini_export/${path}`), path);
        assert.ok(body.content.includes(path));
    }
});

test('real WASM PDF: unrelated Typst compile failure stays fatal and does not discard healthy images', async () => {
    const { TypstSandboxCompiler } = require('../src/core/export/typst/typstSandboxCompiler.js');
    const { RealWasmSandboxHost } = require('./helpers/realWasmSandbox.js');
    const host = new RealWasmSandboxHost();
    const createFrame = host.createFrame.bind(host);
    host.createFrame = (url: string) => {
        const frame = createFrame(url);
        const post = frame.postToSandbox.bind(frame);
        frame.postToSandbox = (message: { files?: Array<{ path: string; text: string }> }, transfer: Transferable[]) => {
            // Inject a document error; isolated image probes still use their actual product source.
            if (message.files?.some(file => file.path === '/payload.json')) {
                message.files.push({ path: '/main.typ', text: '#undefined_document_function()' });
            }
            post(message, transfer);
        };
        return frame;
    };
    const compiler = new TypstSandboxCompiler({ host });
    let writes = 0;
    const pipeline = { acquireAssetBytes: async (item: ResourceRequest) => ({ ok: true as const, resourceId: item.assetId, value: { bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'), mediaType: 'image/png' } }) };
    try {
        const result = await new PdfExporter(compiler).run({ accountId: '10000000-0000-4000-8000-000000000001', ...({ selected: [await admitFixture(fixtureAccount().id, native('throw'))], assetPipeline: pipeline, useZip: false,
            writer: { type: 'directory', writeFile: () => { writes++; return 'should-not-exist.pdf'; } },
        }) });
        assert.equal(result.succeeded, 0); assert.equal(result.failed.length, 1); assert.equal(writes, 0);
        assert.match(result.failed[0].error ?? '', /compiler.*failed/i);
        assert.ok(!result.failed[0].diagnostics.some(d => d.code === 'TYPST_ASSET_DECODE_FAILED'));
    } finally { compiler.dispose(); }
});

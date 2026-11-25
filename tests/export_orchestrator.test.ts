import { describe as __suiteDescribe } from 'node:test';
import test from "node:test";
import assert from "node:assert/strict";
import { type DomainAsset } from "../src/l2/conversationDetail.js";
import { ingestDetail } from "../src/l2/ingestion.js";
import { ingestDeletedConversation } from "../src/l2/ingestion.js";
import { readConversation } from "../src/l2/readConversation.js";
import { getIndex } from "../src/l3a/storageService.js";
import { getDetail } from "../src/l3a/storageService.js";
import { getExportRecord } from "../src/l3a/storageService.js";
import { putExportRecord } from "../src/l3a/storageService.js";
import { runExport } from "../src/application/export/runExport.js";
import { __getZipConstructor } from "../src/l4/packaging/writers/zipWriter.js";
import { __setZipConstructor } from "../src/l4/packaging/writers/zipWriter.js";
import { v2ExportHost } from "./helpers/v2ExportHost.js";
import { readDeliveredFiles } from "./helpers/v2ExportHost.js";
import { exportKey } from "./helpers/v2ExportHost.js";
import { exportRequest } from "./helpers/v2ExportHost.js";
import { seedExportConversation } from "./helpers/v2ExportHost.js";
import { seedExportIndexOnly } from "./helpers/v2ExportHost.js";
import { applicationHost } from "../src/application/host.js";
import { provideApplicationHost } from "../src/application/host.js";
import { type ApplicationHost } from "../src/application/host.js";
import { useIndexStorage } from "./helpers/indexStorage.js";
import { importTakeout } from "../src/application/imports/importTakeout.js";
import { createSourceResourceContext } from "../src/l1/resources/sourceResources.js";
import { prepareExportResources } from "../src/application/export/prepareExportResources.js";
import { buildExportFiles } from "../src/l4/packaging/index.js";
import { runLiveSave } from "../src/runtime/background/liveSaveHandler.js";
import { liveKey } from "./helpers/v2LiveSaveHost.js";
import { seedLiveDetail } from "./helpers/v2LiveSaveHost.js";
import { v2LiveSaveHost } from "./helpers/v2LiveSaveHost.js";
import { type TestContext } from "node:test";
import { fixtureAccount } from "./helpers/domainFixture.js";
import { putAccount } from "../src/l3a/storageService.js";
import { sendToGeminiTab } from "../src/runtime/capabilities/tabService.js";
import { resolveAccountTab } from "../src/runtime/capabilities/tabService.js";
import { sendTabMessage } from "../src/runtime/capabilities/tabService.js";
import { sendToAITab } from "../src/runtime/capabilities/tabService.js";
import { shouldSkipExport } from "../src/application/export/runExport.js";
import { ingestIndexes } from "../src/l2/ingestion.js";
import { getOrCreateAccount } from "../src/runtime/api/accountRegistry.js";
import { sessionGen } from "./fixtures/providers/chatgptSession.js";
import { handleHttp429 } from "../src/l1/client/gemini/api/retryPolicy.js";
import { ChatGPTProvider } from "../src/l1/client/chatgpt/chatgptProvider.js";
import { acquireSourceResource } from "../src/l1/resources/sourceResources.js";
import { type Diagnostic } from "../src/shared/diagnostics/diagnostic.js";
import { fileDownloadGen } from "./fixtures/providers/chatgptFileDownload.js";
import { detailGen } from "./fixtures/providers/chatgptDetail.js";
import { attemptResource } from "../src/shared/resources/resourceResult.js";
import { resourceIssueKind } from "../src/shared/resources/resourceResult.js";
import { parseChatGPTConversation } from "../src/l1/parsers/chatgpt/parseConversation.js";
import { decodeChatGPTDetail } from "../src/l1/parsers/chatgpt/decodeDetail.js";
import { ExportIssueCollector } from "../src/ui/options/state/exportIssues.js";
import { copyExportFailures } from "../src/ui/options/views/exportFailures.js";
import { failureGroupLabel } from "../src/ui/options/views/exportFailures.js";
import { exportSummary } from "../src/ui/shared/exportSummary.js";
import { type OperationIssue } from "../src/shared/errors/operationError.js";
import { type DocumentAst } from "../src/l3b/ast/ast.js";
import { renderDocumentHtml } from "../src/l4/format/html/renderHtml.js";
import { renderDocumentMarkdown } from "../src/l4/format/markdown/renderMarkdown.js";
import { renderMathHtml } from "../src/l4/format/html/htmlMath.js";
import { indexFixture } from "./helpers/indexFixture.js";
import { mergeConversationIndex } from "../src/l2/conversationIndex.js";
import { detailGen as chatgptDetailGen } from "./fixtures/providers/chatgptDetail.js";
import { GeminiProvider } from "../src/l1/client/gemini/geminiProvider.js";
import { ConfirmedSourceEmptyError } from "../src/l1/client/sourceErrors.js";
import { ProviderRegistry } from "../src/l1/client/providerRegistry.js";
import { type AIProvider } from "../src/l1/client/aiProvider.js";
import { type ExportDiagnostic } from "../src/application/export/types.js";
import { type ExportRecord } from "../src/application/export/types.js";
import { type ExportItemUpdate } from "../src/application/export/types.js";
import { mediaSources } from "./helpers/mediaSourceFixture.js";
import { mediaChatId } from "./helpers/mediaSourceFixture.js";
import { mediaPrompt } from "./helpers/mediaSourceFixture.js";
import { mediaBytes } from "./helpers/mediaSourceFixture.js";
import { readTakeoutBytes } from "../src/l1/imports/takeout/readArchive.js";
import { type GeminiTakeoutParseResult } from "../src/l1/parsers/gemini/takeout/parseConversation.js";
import { composeDomainDocument } from "../src/l3b/compose/composeDomainDocument.js";
import { collectDocumentResources } from "../src/l3b/ast/resourceReferences.js";
import { serializeDomainJson } from "../src/l4/format/json/serializeDomainJson.js";
import { planExportPaths } from "../src/l4/packaging/index.js";
import { packageExportFiles } from "../src/l4/packaging/index.js";
import { startBrowserDownload } from "../src/l4/delivery/index.js";
import { test as test__s16 } from "node:test";
import { type SourceConversationParseResult } from "../src/l1/parsers/parsingResult.js";
import { test as test__s17 } from "node:test";
import { mediaTime } from "./helpers/mediaSourceFixture.js";
import { OperationError } from "../src/shared/errors/operationError.js";
import { operationError } from "../src/shared/errors/operationError.js";
import { operationIssue } from "../src/shared/errors/operationError.js";
import { readOperationIssue } from "../src/shared/errors/operationError.js";
import { readSourceExecution } from "../src/l1/client/sourceExecution.js";
import { ResourceHttpError } from "../src/shared/resources/resourceResult.js";
import { readClaudeSource } from "../src/l1/client/claude/claudeSource.js";
import { readGrokSource } from "../src/l1/client/grok/grokSource.js";
import { listExportRecords } from "../src/l3a/storageService.js";
import { updateSettings } from "../src/application/settings/index.js";
import { getSettings } from "../src/application/settings/index.js";
import { compileDocumentPdf } from "../src/l4/format/pdf/compileDocumentPdf.js";
import { type IPdfCompiler } from "../src/l4/format/pdf/pdfCompiler.js";
import { missingResource } from "../src/shared/resources/resourceResult.js";
import { shouldSkipExport as shouldSkipExport__s22 } from "../src/application/export/exportPipeline.js";
import { sourceDetail } from "./helpers/l1SourceFixture.js";
import { sourceList } from "./helpers/l1SourceFixture.js";
import { sourceMessage } from "./helpers/l1SourceFixture.js";
import { activityHtml } from "./helpers/l1SourceFixture.js";
import { takeoutArchive } from "./helpers/l1SourceFixture.js";
import { ConfirmedGeminiConversationNotFound } from "../src/l1/client/gemini/geminiClient.js";
import { type DomainMessage } from "../src/l2/conversationDetail.js";
import { type DomainConversation } from "../src/l2/conversation.js";
import { type DomainConversationWithDetail } from "../src/l2/conversation.js";
import { validateParserDomain } from "../src/l2/runtimeValidation.js";
import { restoreDomainSnapshot } from "../src/l2/runtimeValidation.js";
import { fixtureAccountFor } from "./helpers/domainFixture.js";
import { fixtureKey } from "./helpers/domainFixture.js";
import { renderDocumentTypst } from "./helpers/renderTypstFixture.js";
import { makeTestExportProvider } from "./helpers/makeTestWorker.js";
import { makeTestWorker } from "./helpers/makeTestWorker.js";

__suiteDescribe("export_orchestrator", () => {
/**
 * V2 cross-module Export integration regression suite.
 *
 * The old ExportOrchestrator, AsyncQueue, BatchWorker, ChatFormatter,
 * AssetPipeline, completion sessions and v1 StorageService are gone.
 * Every case below exercises real L2 admission, L3a IndexedDB, Application
 * runExport, L3b composition, and L4 rendering/packaging/delivery as relevant.
 * Only the extension browser/transport/IndexedDB host is simulated.
 */










const JSZip = require('../lib/jszip.min.js');
const P = (text: string) => ({ type: 'paragraph' as const, children: [{ type: 'text' as const, text }] });

function realZip(t: { after(fn: () => void): void }) {
    const old = __getZipConstructor();
    __setZipConstructor(JSZip);
    t.after(() => __setZipConstructor(old));
}
async function contents(blob: Blob) {
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const files = Object.values(zip.files) as Array<{
        name: string; dir: boolean; async(type: string): Promise<string | Uint8Array>;
    }>;
    return { zip, files: files.filter(file => !file.dir) };
}
async function deliveredContents(host: {blobs: readonly Blob[]; filenames: readonly string[]}) {
    return {files:await readDeliveredFiles(host)};
}
async function seedAssets(id: string, assets: DomainAsset[], opts: {
    savedAt?: number; updatedAt?: number; quality?: 'complete' | 'partial';
    includeReferences?: boolean;
} = {}) {
    const savedAt = opts.savedAt ?? 100;
    const updatedAt = opts.updatedAt ?? savedAt;
    const includeReferences = opts.includeReferences !== false;
    await ingestDetail(exportKey(id).accountId, id, {
        savedAt, quality: { status: opts.quality ?? 'complete' }, assets,
        messages: [{
            role: 'user', content: [P('Prompt for ' + id)],
        }, {
            role: 'assistant',
            content: [P('Answer for ' + id), ...(includeReferences
                ? assets.filter(asset => asset.kind === 'image')
                    .map(asset => ({ type: 'image' as const, assetId: asset.id }))
                : [])],
            ...(includeReferences && assets.some(asset => asset.kind !== 'image')
                ? { attachmentIds: assets.filter(asset => asset.kind !== 'image').map(asset => asset.id) }
                : {}),
        }],
    }, { title: 'Conversation ' + id, titleSource: 'provider', updatedAt });
}
const source = (id: string, kind: DomainAsset['kind'], url: string,
    extra: Partial<DomainAsset> = {}): DomainAsset => ({
    id, kind, name: id + (kind === 'image' ? '.png' : '.md'),
    mediaType: kind === 'image' ? 'image/png' : 'text/markdown',
    sourceUri: url, ...extra,
});

/** Transport/cookie routing is external; the real GeminiProvider performs acquisition. */
function sourceTransport(t: { after(fn: () => void): void }, entries: Record<string, {
    bytes: Uint8Array; type: string;
}>) {
    const chromeHost = globalThis.chrome;
    const previousTabs = Object.getOwnPropertyDescriptor(globalThis.chrome, 'tabs');
    const oldFetch = globalThis.fetch;
    const requested: string[] = [];
    Object.defineProperty(chromeHost, 'tabs', { configurable: true, value: {
        query: async () => [{ id: 9, url: 'https://gemini.google.com/app/source' }],
        sendMessage: async () => ({ ok: true, accountContext: {
            accountId: exportKey('fixture').accountId, providerId: 'gemini', slot: 'u0',
        } }),
    } });
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        requested.push(url);
        const item = entries[url];
        if (!item) return new Response(null, { status: 404 });
        return new Response(new Uint8Array(item.bytes) as BodyInit, {
            status: 200, headers: { 'content-type': item.type },
        });
    }) as typeof fetch;
    t.after(() => {
        globalThis.fetch = oldFetch;
        if (previousTabs) Object.defineProperty(chromeHost, 'tabs', previousTabs);
        else Reflect.deleteProperty(chromeHost, 'tabs');
    });
    return requested;
}

// Linked documents and attachments share one final browser package.
test('S-2: a missing Detail fails its Key while two native v2 conversations land in one ZIP', async t => {
    const host = v2ExportHost(t); realZip(t);
    await seedExportConversation('accounting-one');
    await seedExportIndexOnly('accounting-missing');
    await seedExportConversation('accounting-two');
    const progress: string[] = [];
    const result = await runExport(exportRequest(['accounting-one', 'accounting-missing', 'accounting-two']), {
        onProgress: ({ key }) => progress.push(key.conversationId),
    });
    assert.deepEqual(progress, ['accounting-one', 'accounting-missing', 'accounting-two']);
    assert.equal(result.exported, 2);
    assert.equal(result.partial, 0);
    assert.equal(result.skipped, 0);
    assert.equal(result.aborted, false);
    assert.deepEqual(result.failed, [exportKey('accounting-missing')]);
    assert.equal(host.clicks(), 1);
    assert.match(host.filenames[0], /\.zip$/);
    const { files } = await contents(host.blobs[0]);
    const bodies = await Promise.all(files.filter(file => file.name.endsWith('.md')).map(file => file.async('string')));
    assert.equal(bodies.length, 2);
    assert.ok(bodies.some(text => String(text).includes('Answer for accounting-one')));
    assert.ok(bodies.some(text => String(text).includes('Answer for accounting-two')));
    assert.equal(await getExportRecord(exportKey('accounting-missing')), null);
    assert.equal((await getExportRecord(exportKey('accounting-one')))?.status, 'ok');
    assert.equal((await getExportRecord(exportKey('accounting-two')))?.status, 'ok');
});

test('S-5: a browser permission rejection fails all staged v2 Keys without a partial commit', async t => {
    const host = v2ExportHost(t, () => { throw new DOMException('Access revoked', 'NotAllowedError'); });
    realZip(t);
    for (const id of ['denied-a', 'denied-b', 'denied-c']) await seedExportConversation(id);
    const result = await runExport(exportRequest(['denied-a', 'denied-b', 'denied-c']));
    assert.equal(host.clicks(), 1);
    assert.equal(result.aborted, false);
    assert.equal(result.exported, 0);
    assert.deepEqual(result.failed, ['denied-a', 'denied-b', 'denied-c'].map(exportKey));
    for (const id of ['denied-a', 'denied-b', 'denied-c']) assert.equal(await getExportRecord(exportKey(id)), null);
});

test('skipUnchanged exports only new Keys while preserving a matching committed Record', async t => {
    const host = v2ExportHost(t);
    await seedExportConversation('cached');
    assert.equal((await runExport(exportRequest(['cached']))).exported, 1);
    const before = await getExportRecord(exportKey('cached'));
    await seedExportConversation('uncached');
    const result = await runExport(exportRequest(['cached', 'uncached'], { skipUnchanged: true }));
    assert.equal(result.skipped, 1);
    assert.equal(result.exported, 1);
    assert.deepEqual(result.failed, []);
    assert.equal(host.clicks(), 2);
    assert.deepEqual(await getExportRecord(exportKey('cached')), before);
    assert.equal((await getExportRecord(exportKey('uncached')))?.status, 'ok');
    assert.match(await host.blobs[1].text(), /Answer for uncached/);
    assert.doesNotMatch(await host.blobs[1].text(), /Answer for cached/);
});

test('skipUnchanged with all v2 Keys up to date performs no acquisition, packaging or download', async t => {
    const host = v2ExportHost(t);
    realZip(t);
    await seedExportConversation('already-a'); await seedExportConversation('already-b');
    const first = await runExport(exportRequest(['already-a', 'already-b']));
    assert.equal(first.exported, 2);
    const events: string[] = [];
    const second = await runExport(exportRequest(['already-a', 'already-b'], { skipUnchanged: true }), {
        onProgress: ({ key }) => events.push(key.conversationId),
    });
    assert.deepEqual(events, ['already-a', 'already-b']);
    assert.equal(second.skipped, 2);
    assert.equal(second.exported, 0);
    assert.deepEqual(second.failed, []);
    assert.equal(host.clicks(), 1);
    assert.equal(host.blobs.length, 1);
});

test('skipUnchanged=false reexports the complete requested batch regardless of prior v2 records', async t => {
    const host = v2ExportHost(t); realZip(t);
    await seedExportConversation('redo-a'); await seedExportConversation('redo-b');
    assert.equal((await runExport(exportRequest(['redo-a', 'redo-b']))).exported, 2);
    const result = await runExport(exportRequest(['redo-a', 'redo-b'], { skipUnchanged: false }));
    assert.equal(result.skipped, 0);
    assert.equal(result.exported, 2);
    assert.equal(host.clicks(), 2);
    for (const id of ['redo-a', 'redo-b']) assert.equal((await getExportRecord(exportKey(id)))?.format, 'markdown');
});

test('partial, wrong-format, or older source records never suppress real v2 exports', async t => {
    const host = v2ExportHost(t); realZip(t);
    for (const id of ['was-partial', 'was-html', 'was-old']) await seedExportConversation(id, 200);
    await putExportRecord(exportKey('was-partial'), { exportedAt: 1, format: 'markdown', status: 'partial', chatTime: 200 });
    await putExportRecord(exportKey('was-html'), { exportedAt: 2, format: 'html', status: 'ok', chatTime: 200 });
    await putExportRecord(exportKey('was-old'), { exportedAt: 3, format: 'markdown', status: 'ok', chatTime: 199 });
    const result = await runExport(exportRequest(['was-partial', 'was-html', 'was-old'], { skipUnchanged: true }));
    assert.equal(result.skipped, 0);
    assert.equal(result.exported, 3);
    assert.equal(host.clicks(), 1);
    for (const id of ['was-partial', 'was-html', 'was-old']) {
        const record = await getExportRecord(exportKey(id));
        assert.equal(record?.status, 'ok');
        assert.equal(record?.format, 'markdown');
        assert.equal(record?.chatTime, 200);
    }
});

test('a missing Detail remains retryable and no fake empty export is recorded', async t => {
    const host = v2ExportHost(t);
    await seedExportIndexOnly('retryable');
    const first = await runExport(exportRequest(['retryable']));
    assert.deepEqual(first.failed, [exportKey('retryable')]);
    assert.equal(first.exported, 0);
    assert.equal(host.clicks(), 0);
    assert.equal(await getExportRecord(exportKey('retryable')), null);
    await seedExportConversation('retryable');
    const second = await runExport(exportRequest(['retryable'], { skipUnchanged: true }));
    assert.equal(second.exported, 1);
    assert.deepEqual(second.failed, []);
    assert.equal(host.clicks(), 1);
    assert.match(await host.blobs[0].text(), /Answer for retryable/);
});

test('confirmed v2 deletion clears Detail, Index and ExportRecord before later export requests', async t => {
    const host = v2ExportHost(t);
    await seedExportConversation('deleted');
    assert.equal((await runExport(exportRequest(['deleted']))).exported, 1);
    assert.ok(await getExportRecord(exportKey('deleted')));
    await ingestDeletedConversation(exportKey('deleted').accountId, 'deleted');
    assert.equal(await getIndex(exportKey('deleted')), null);
    assert.equal(await getDetail(exportKey('deleted')), null);
    assert.equal(await getExportRecord(exportKey('deleted')), null);
    const result = await runExport(exportRequest(['deleted'], { skipUnchanged: true }));
    assert.equal(result.exported, 0);
    assert.deepEqual(result.failed, [exportKey('deleted')]);
    assert.equal(host.clicks(), 1);
});

test('a legitimate empty v2 Detail renders its title, never a fabricated placeholder message', async t => {
    const host = v2ExportHost(t);
    const key = exportKey('empty');
    await ingestDetail(key.accountId, key.conversationId, {
        savedAt: 100, quality: { status: 'complete' }, assets: [], messages: [],
    }, { title: 'Title of empty conversation', titleSource: 'provider', updatedAt: 100 });
    const result = await runExport(exportRequest(['empty']));
    assert.equal(result.exported, 1);
    assert.equal(result.partial, 0);
    const markdown = await host.blobs[0].text();
    assert.match(markdown, /Title of empty conversation/);
    assert.doesNotMatch(markdown, /Answer for empty/);
    assert.equal((await getExportRecord(key))?.status, 'ok');
});

test('ExportRecord chatTime comes from actual Detail.savedAt, not Index.updatedAt or run time', async t => {
    const host = v2ExportHost(t);
    await seedAssets('stale', [], { savedAt: 100, updatedAt: 200 });
    const result = await runExport(exportRequest(['stale']));
    assert.equal(result.exported, 1, 'a failed refresh retains readable local Detail');
    assert.equal(result.partial, 1, 'stale source facts cannot claim a complete export');
    assert.equal(host.clicks(), 1);
    const record = await getExportRecord(exportKey('stale'));
    assert.equal(record?.chatTime, 100);
    assert.equal(record?.status, 'partial');
    assert.equal((await getIndex(exportKey('stale')))?.updatedAt, 200);
});

test('L2 rejects a mutated typed Detail before Storage, leaving the last trusted body exportable', async t => {
    const host = v2ExportHost(t);
    await seedExportConversation('trusted');
    const before = await readConversation(exportKey('trusted'));
    assert.ok(before);
    await assert.rejects(ingestDetail(exportKey('trusted').accountId, 'trusted', {
        savedAt: 100, quality: { status: 'complete' }, assets: [],
        messages: [{ role: 'assistant', content: [P('should not persist')], untrusted: true }],
    } as never), /Domain contract/);
    assert.deepEqual(await readConversation(exportKey('trusted')), before);
    const result = await runExport(exportRequest(['trusted']));
    assert.equal(result.exported, 1);
    assert.match(await host.blobs[0].text(), /Answer for trusted/);
});

test('L4 JSON exports the canonical account-bound v2 Domain without old DTO or session fields', async t => {
    const host = v2ExportHost(t);
    await seedExportConversation('json-native');
    const stored = await readConversation(exportKey('json-native'));
    const result = await runExport(exportRequest(['json-native'], { format: 'json' }));
    assert.equal(result.exported, 1);
    assert.equal(host.clicks(), 1);
    const archive = JSON.parse(await host.blobs[0].text());
    assert.equal(archive.format, 'gemini-exporter-domain');
    assert.equal(archive.version, 1);
    assert.deepEqual(archive.conversation, stored);
    assert.equal(archive.account.id, exportKey('json-native').accountId);
    assert.equal('sourceVersion' in archive, false);
    assert.equal('sessionId' in archive, false);
    assert.equal((await getExportRecord(exportKey('json-native')))?.format, 'json');
});

test('L3b -> L4 HTML formats native v2 content without DOM source scraping', async t => {
    const host = v2ExportHost(t);
    await seedExportConversation('html-native');
    const result = await runExport(exportRequest(['html-native'], { format: 'html' }));
    assert.equal(result.exported, 1);
    assert.equal(host.clicks(), 1);
    const html = await host.blobs[0].text();
    assert.match(html, /Answer for html-native/);
    assert.match(html, /Prompt for html-native/);
    assert.match(html, /<html/i);
    assert.equal((await getExportRecord(exportKey('html-native')))?.format, 'html');
});

test('unreferenced v2 resource metadata never causes an acquisition request or sidecar', async t => {
    const host = v2ExportHost(t);
    const asset = source('unused', 'image', 'https://lh3.googleusercontent.com/unused.png');
    await seedAssets('unreferenced', [asset], { includeReferences: false });
    const result = await runExport(exportRequest(['unreferenced'], { includeAssets: true }));
    assert.equal(result.exported, 1);
    assert.equal(result.partial, 0);
    assert.equal(host.clicks(), 1);
    assert.match(host.filenames[0], /\.md$/);
    assert.equal(host.blobs.length, 1);
    assert.doesNotMatch(await host.blobs[0].text(), /lh3\.googleusercontent\.com/);
});

test('includeAssets=false keeps a referenced image readable without fetching or false partial', async t => {
    const host = v2ExportHost(t);
    const asset = source('ignored-image', 'image', 'https://lh3.googleusercontent.com/ignored.png');
    await seedAssets('no-resources', [asset]);
    const result = await runExport(exportRequest(['no-resources'], { includeAssets: false }));
    assert.equal(result.exported, 1);
    assert.equal(result.partial, 0);
    assert.equal(host.clicks(), 1);
    assert.match(host.filenames[0], /\.md$/);
    assert.match(await host.blobs[0].text(), /Answer for no-resources/);
    assert.equal((await getExportRecord(exportKey('no-resources')))?.status, 'ok');
});

test('an unavailable resource leaves its document intact and delivers a failure report without fabricated image bytes', async t => {
    const host = v2ExportHost(t); realZip(t);
    const asset = source('lost-image', 'image', 'https://lh3.googleusercontent.com/missing.png');
    await seedAssets('resource-fails', [asset]);
    const result = await runExport(exportRequest(['resource-fails'], { includeAssets: true }));
    assert.equal(result.exported, 1);
    assert.equal(result.partial, 1);
    assert.deepEqual(result.failed, []);
    assert.equal(host.clicks(), 1);
    assert.match(host.filenames[0], /\.zip$/);
    const {files} = await deliveredContents(host);
    const markdown = String(await files.find(file => file.name.endsWith('.md'))!.async('string'));
    assert.match(markdown, /Answer for resource-fails/);
    assert.match(markdown, /unavailable|failed|missing/i);
    assert.doesNotMatch(markdown, /!\[[^\]]*\]\(https:/);
    assert.equal(files.filter(file=>file.name.startsWith('assets/')).length,0);
    const report = files.find(file=>file.name.startsWith('attachment-reports/'));
    assert.ok(report);
    assert.match(String(await report.async('string')), /lh3\.googleusercontent\.com\/missing\.png/);
    assert.equal((await getExportRecord(exportKey('resource-fails')))?.status, 'partial');
});

test('real Gemini L1 bytes follow the L4 resource binding while Domain asset identity remains unchanged', async t => {
    const host = v2ExportHost(t); realZip(t);
    const uri = 'https://lh3.googleusercontent.com/snapshot-image.png';
    const raw = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 22, 33);
    const calls = sourceTransport(t, { [uri]: { bytes: raw, type: 'image/png' } });
    await seedAssets('with-image', [source('snapshot', 'image', uri)]);
    const before = await readConversation(exportKey('with-image'));
    const result = await runExport(exportRequest(['with-image'], { includeAssets: true }));
    assert.equal(result.exported, 1);
    assert.equal(result.partial, 0);
    assert.deepEqual(calls, [uri]);
    assert.equal(host.clicks(), 1);
    assert.match(host.filenames[0], /\.zip$/);
    const { files } = await deliveredContents(host);
    const image = files.find(file => file.name.startsWith('assets/') && file.name.endsWith('.png'));
    assert.ok(image, 'planned asset path is present in the actual ZIP');
    assert.deepEqual(await image.async('uint8array'), raw);
    const markdown = files.find(file => file.name.endsWith('.md'));
    assert.ok(markdown);
    assert.match(String(await markdown.async('string')), /assets\//);
    assert.deepEqual(await readConversation(exportKey('with-image')), before);
    assert.equal((await getExportRecord(exportKey('with-image')))?.status, 'ok');
});

test('native file attachment is written as original L1 bytes under its planned files/ path', async t => {
    const host = v2ExportHost(t); realZip(t);
    const uri = 'https://resources.example.test/source.md';
    const bytes = new TextEncoder().encode('# original attachment source\nAnd some content');
    sourceTransport(t, { [uri]: { bytes, type: 'text/markdown' } });
    await seedAssets('with-document', [source('notes', 'file', uri, {
        document: { contentMarkdown: '# parsed document text' },
    })]);
    const result = await runExport(exportRequest(['with-document'], { includeAssets: true }));
    assert.equal(result.exported, 1);
    assert.equal(result.partial, 0);
    const { files } = await deliveredContents(host);
    const attachment = files.find(file => file.name.startsWith('files/') && file.name.endsWith('notes.md'));
    assert.ok(attachment);
    assert.deepEqual(await attachment.async('uint8array'), bytes);
    const main = files.find(file => !file.name.startsWith('files/') && file.name.endsWith('.md'));
    assert.ok(main);
    assert.match(String(await main.async('string')), /files\//);
    assert.equal((await getExportRecord(exportKey('with-document')))?.status, 'ok');
});

test('a captured document without a remote locator exports its semantic source as UTF-8', async t => {
    const host = v2ExportHost(t); realZip(t);
    const markdown = '# Captured source\n中文 and exact document content';
    const calls = sourceTransport(t, {});
    await seedAssets('captured-document', [source('notes', 'file', 'rc_captured', {
        document: { contentMarkdown: markdown },
    })]);
    const result = await runExport(exportRequest(['captured-document'], { includeAssets: true }));
    assert.equal(result.exported, 1);
    assert.equal(result.partial, 0);
    assert.deepEqual(calls, []);
    const { files } = await deliveredContents(host);
    const attachment = files.find(file => file.name.startsWith('files/') && file.name.endsWith('notes.md'));
    assert.ok(attachment);
    assert.equal(await attachment.async('string'), markdown);
});

test('two v2 conversations with identical asset IDs never share bytes or packaging paths', async t => {
    const host = v2ExportHost(t); realZip(t);
    const firstUri = 'https://lh3.googleusercontent.com/a.png';
    const secondUri = 'https://lh3.googleusercontent.com/b.png';
    const a = Uint8Array.of(1, 2, 3);
    const b = Uint8Array.of(4, 5, 6, 7);
    const calls = sourceTransport(t, { [firstUri]: { bytes: a, type: 'image/png' },
        [secondUri]: { bytes: b, type: 'image/png' } });
    await seedAssets('owner-a', [source('shared', 'image', firstUri)]);
    await seedAssets('owner-b', [source('shared', 'image', secondUri)]);
    const result = await runExport(exportRequest(['owner-a', 'owner-b'], { includeAssets: true }));
    assert.equal(result.exported, 2);
    assert.equal(result.partial, 0);
    assert.deepEqual(calls, [firstUri, secondUri]);
    assert.equal(host.clicks(), 1);
    const { files } = await deliveredContents(host);
    const images = files.filter(file => file.name.startsWith('assets/') && file.name.endsWith('.png'));
    assert.equal(images.length, 2);
    assert.notEqual(images[0].name, images[1].name);
    const bodies = await Promise.all(images.map(file => file.async('uint8array')));
    assert.ok(bodies.some(bytes => Buffer.from(bytes as Uint8Array).equals(Buffer.from(a))));
    assert.ok(bodies.some(bytes => Buffer.from(bytes as Uint8Array).equals(Buffer.from(b))));
    assert.equal((await getExportRecord(exportKey('owner-a')))?.status, 'ok');
    assert.equal((await getExportRecord(exportKey('owner-b')))?.status, 'ok');
});

test('resource failure makes only the affected v2 conversation partial, not its healthy batch peer', async t => {
    const host = v2ExportHost(t); realZip(t);
    const good = 'https://lh3.googleusercontent.com/good.png';
    const bad = 'https://lh3.googleusercontent.com/bad.png';
    sourceTransport(t, { [good]: { bytes: Uint8Array.of(10, 11), type: 'image/png' } });
    await seedAssets('one-good', [source('good', 'image', good)]);
    await seedAssets('one-bad', [source('bad', 'image', bad)]);
    const result = await runExport(exportRequest(['one-good', 'one-bad'], { includeAssets: true }));
    assert.equal(result.exported, 2);
    assert.equal(result.partial, 1);
    assert.deepEqual(result.failed, []);
    assert.equal(host.clicks(), 1);
    assert.equal((await getExportRecord(exportKey('one-good')))?.status, 'ok');
    assert.equal((await getExportRecord(exportKey('one-bad')))?.status, 'partial');
    const { files } = await deliveredContents(host);
    assert.equal(files.filter(file => file.name.startsWith('assets/')).length, 1);
    assert.equal(files.filter(file => file.name.endsWith('.md')).length, 2);
});

test('L4 ZIP generation failure after staging delivers nothing and cannot commit any records', async t => {
    const host = v2ExportHost(t);
    const prior = __getZipConstructor();
    __setZipConstructor(class {
        file() {}
        async generateAsync(): Promise<never> { throw new Error('Broken ZIP generator'); }
    });
    t.after(() => __setZipConstructor(prior));
    await seedExportConversation('zip-one');
    await seedExportConversation('zip-two');
    const result = await runExport(exportRequest(['zip-one', 'zip-two']));
    assert.equal(result.exported, 0);
    assert.deepEqual(result.failed, [exportKey('zip-one'), exportKey('zip-two')]);
    assert.equal(host.clicks(), 0);
    assert.equal(host.blobs.length, 0);
    assert.equal(await getExportRecord(exportKey('zip-one')), null);
    assert.equal(await getExportRecord(exportKey('zip-two')), null);
});

test('a failed post-delivery v2 ExportRecord write is reported, never counted or downloaded twice', async t => {
    const host = v2ExportHost(t); realZip(t);
    await seedExportConversation('record-a');
    await seedExportConversation('record-b');
    host.failStorage('exportRecords');
    const result = await runExport(exportRequest(['record-a', 'record-b']));
    assert.equal(host.clicks(), 1, 'delivery is complete, and records never trigger a second ZIP');
    assert.equal(result.exported, 0);
    assert.deepEqual(result.failed, [exportKey('record-a'), exportKey('record-b')]);
    assert.equal(await getExportRecord(exportKey('record-a')), null);
    assert.equal(await getExportRecord(exportKey('record-b')), null);
    const { files } = await contents(host.blobs[0]);
    assert.equal(files.filter(file => file.name.endsWith('.md')).length, 2);
    host.failStorage();
});

test('the same v2 Domain can be exported as Markdown, JSON and HTML without reinterpreting its facts', async t => {
    const host = v2ExportHost(t);
    await seedExportConversation('source-preserved');
    const before = await readConversation(exportKey('source-preserved'));
    assert.ok(before);
    for (const format of ['markdown', 'json', 'html'] as const) {
        const result = await runExport(exportRequest(['source-preserved'], { format }));
        assert.equal(result.exported, 1);
        assert.deepEqual(result.failed, []);
        assert.deepEqual(await readConversation(exportKey('source-preserved')), before);
        assert.equal((await getExportRecord(exportKey('source-preserved')))?.format, format);
    }
    assert.equal(host.clicks(), 3);
    assert.match(await host.blobs[0].text(), /Answer for source-preserved/);
    const archive = JSON.parse(await host.blobs[1].text());
    assert.deepEqual(archive.conversation, before);
    assert.match(await host.blobs[2].text(), /Answer for source-preserved/);
});

test('404 and retryable attachment failures deliver text, persist reasons and never count as failed conversations', async t => {
    const host = v2ExportHost(t); realZip(t);
    sourceTransport(t, {});
    globalThis.fetch = async input => new Response('', {status:String(input).includes('expired') ? 404 : 503});
    await seedAssets('expired-only', [source('expired', 'image', 'https://lh3.googleusercontent.com/expired')]);
    await seedAssets('mixed-resources', [source('expired', 'image', 'https://lh3.googleusercontent.com/expired'), source('retry', 'image', 'https://lh3.googleusercontent.com/retry')]);
    const result = await runExport(exportRequest(['expired-only','mixed-resources'], {includeAssets:true}));
    assert.equal(result.exported, 2);
    assert.equal(result.partial, 2);
    assert.equal(result.expiredConversations, 2);
    assert.equal(result.otherPartial, 0);
    assert.deepEqual(result.failed, []);
    assert.equal(result.attachmentIssues?.length, 3);
    const record = await getExportRecord(exportKey('mixed-resources'));
    assert.deepEqual(record?.attachmentIssues?.map(issue => issue.httpStatus), [404,503]);
    assert.equal(record?.attachmentIssues?.[0].sourceUrl, 'https://lh3.googleusercontent.com/expired');
    const {files} = await deliveredContents(host);
    for (const file of files.filter(file => file.name.endsWith('.md'))) {
        const body = await file.async('string') as string;
        assert.match(body, /HTTP 404/);
        assert.match(body, /Answer for/);
    }
    const reports = files.filter(file=>file.name.startsWith('attachment-reports/'));
    assert.equal(reports.length,2);
    const issues = (await Promise.all(reports.map(async file=>JSON.parse(String(await file.async('string'))).failures))).flat();
    assert.deepEqual(issues.map(issue=>issue.httpStatus).sort(),[404,404,503]);
});
});

__suiteDescribe("application_host", () => {
test('Application host requires provision and preserves the supplied operations', async () => {
    const hostPath = require.resolve('../src/application/host.js');
    const cached = require.cache[hostPath];
    delete require.cache[hostPath];
    try {
        const fresh = require(hostPath) as {
            applicationHost: typeof applicationHost;
            provideApplicationHost: typeof provideApplicationHost;
        };
        assert.throws(() => fresh.applicationHost(), /Application host has not been provided/);
        const account = { id: 'account', providerId: 'gemini', providerAccountId: 'source' };
        const notifications: string[] = [];
        const host: ApplicationHost = {
            async getAccount(id) { return id === account.id ? account : null; },
            async getOrCreateAccount() { return account; },
            notifyDomainChanged(id) { notifications.push(id); },
        };
        fresh.provideApplicationHost(host);
        assert.equal(fresh.applicationHost(), host);
        assert.equal(await fresh.applicationHost().getAccount(account.id), account);
        assert.equal(await fresh.applicationHost().getAccount('missing'), null);
        assert.equal(await fresh.applicationHost().getOrCreateAccount('gemini', 'source'), account);
        fresh.applicationHost().notifyDomainChanged(account.id);
        assert.deepEqual(notifications, [account.id]);
        fresh.provideApplicationHost({ ...host, async getAccount() { throw new Error('lookup failed'); } });
        await assert.rejects(fresh.applicationHost().getAccount(account.id), /lookup failed/);
    } finally {
        if (cached) require.cache[hostPath] = cached;
        else delete require.cache[hostPath];
    }
});
});

__suiteDescribe("asset_dedup_and_matching", () => {
useIndexStorage();









test('asset_dedup - ZIP import preserves exact image bytes and per-turn Domain ownership', async () => {
    const slot = '10000000-0000-4000-8000-000000000001';
    const id = 'chat_multi_img_123';
    const g = globalThis;
    const resources = createSourceResourceContext();
    const key = { accountId: slot, conversationId: id };
    const originalJSZip = Object.getOwnPropertyDescriptor(g, 'JSZip');
    const JSZip = require('../lib/jszip.min.js');
    Object.defineProperty(g, 'JSZip', { value: JSZip, configurable: true, writable: true });

    try {
        const zip = new JSZip();
        const images = [
            { filename: 'image-adb659a48f83024b.png', bytes: [10, 20, 30] },
            { filename: 'image-088981d4885e6166.png', bytes: [40, 50, 60] },
            { filename: 'image-b70178f36ab8ed17.png', bytes: [70, 80, 90] },
        ];
        const html = `<html><body>${images.map((image, i) => `
            <div class="outer-cell">
              <a href="https://gemini.google.com/app/${id}">Chat Multi</a>
              <div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Prompted Question ${i + 1}<br>
                Attached 1 file.<br>
                - <a href="${image.filename}">image.png</a><br>
                <p>Response ${i + 1}</p></div>
            </div>`).join('')}</body></html>`;
        zip.file('Takeout/Gemini/MyActivity.html', html);
        for (const image of images) zip.file(`Takeout/Gemini/${image.filename}`, new Uint8Array(image.bytes));
        zip.file('Takeout/Gemini/unreferenced.png', new Uint8Array([97, 98, 99]));

        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
        const imported = await importTakeout(zipBuffer as unknown as File, slot, undefined, resources);
        assert.equal(imported.imported, 1);
        const detail = await getDetail(key);
        assert.ok(detail, 'real ZIP import must persist the admitted Domain Detail');
        assert.equal(detail.assets.length, 3, 'unreferenced files must not become Domain assets');
        const userMessages = detail.messages.filter(message => message.role === 'user');
        assert.equal(userMessages.length, images.length);
        const owned = new Set<string>();
        for (let i = 0; i < images.length; i++) {
            const ids = userMessages[i].attachmentIds || [];
            assert.strictEqual(ids.length, 1, `turn ${i + 1} must own one source image`);
            assert.strictEqual(owned.has(ids[0]), false, 'distinct source images must not share an asset ID');
            owned.add(ids[0]);
            const asset: DomainAsset | undefined = detail.assets.find(candidate => candidate.id === ids[0]);
            assert.ok(asset);
            assert.deepEqual((await resources.acquire(key, asset)).bytes, new Uint8Array(images[i].bytes),
                'each turn must resolve its exact archive bytes, not a similarly named image');
        }
        for (const sourceUri of ['image.png', 'unreferenced.png']) {
            await assert.rejects(resources.acquire(key, { id: '', kind: 'image', sourceUri }), /No supported source locator/,
                'generic or unused archive names must not select a sibling resource');
        }
    } finally {
        resources.release();
        if (originalJSZip) Object.defineProperty(g, 'JSZip', originalJSZip);
        else Reflect.deleteProperty(g, 'JSZip');
    }
});

test('asset_dedup - resource preparation and Packaging preserve sliced buffer bounds', async () => {
    const slab = new Uint8Array([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
    const prepared = await prepareExportResources([{ id: 'sliced', kind: 'image', mediaType: 'image/png' }],
        new Set(['sliced']), async () => ({ bytes: new Uint8Array(slab.buffer, 3, 4) }));
    const files = buildExportFiles('markdown', {
        fileName: 'chat.md', resources: { sliced: 'assets/sliced.png' }, externalResourceIds: new Set(['sliced']),
    }, 'conversation', prepared);
    const resource = files.find(file => file.fileName === 'assets/sliced.png');
    assert.ok(resource?.content instanceof Uint8Array);
    assert.equal(resource.content.byteLength, 4);
    assert.deepEqual(Array.from(resource.content), [30, 40, 50, 60]);
});
});

__suiteDescribe("asset_direct_write_failure", () => {
/**
 * V2 replacement for the retired AssetPipeline direct-write failure test.
 *
 * L1 acquires source bytes; L2/L3a own facts; Application + L3b/L4 write the
 * main Markdown and its sidecar. Only HTTP and the FileSystemDirectoryHandle
 * host are simulated. Failed delivery never commits a successful ExportRecord.
 */






test('direct sidecar write rejects after one acquisition, with no refetch and no committed record', async t => {
    const host = v2LiveSaveHost(t), id = 'disk-full';
    const url = 'https://encrypted-tbn2.gstatic.com/licensed-image?q=test';
    const bytes = Uint8Array.of(1, 2, 3);
    await seedLiveDetail(id, [{ id: 'search', kind: 'image', name: 'search.png',
        mediaType: 'image/png', sourceUri: url }]);
    host.source(url, bytes, 'image/png');
    host.failWrite('assets/');
    const result = await runLiveSave(liveKey(id));
    assert.ok(result);
    assert.equal(result.exported, 0);
    assert.equal(result.partial, 0);
    assert.deepEqual(result.failed, [liveKey(id)]);
    assert.deepEqual(host.requests, [url], 'a disk error must not refetch already acquired source bytes');
    assert.equal(host.events.filter(event => event.startsWith('write:assets/')).length, 1);
    assert.equal(host.events.filter(event => event.startsWith('abort:assets/')).length, 1);
    assert.equal([...host.files.keys()].filter(name => name.startsWith('assets/')).length, 0);
    assert.ok([...host.files.keys()].some(name => name.endsWith('.md')),
        'Markdown can already have landed before the sidecar error');
    assert.equal(await getExportRecord(liveKey(id)), null, 'no success may be recorded for failed L4 delivery');
});

test('retry after direct disk failure reacquires once and commits exactly the delivered v2 asset', async t => {
    const host = v2LiveSaveHost(t), id = 'disk-recovered';
    const url = 'https://lh3.googleusercontent.com/restored-image.png';
    const bytes = Uint8Array.of(137, 80, 78, 71, 9, 8, 7);
    await seedLiveDetail(id, [{ id: 'restored', kind: 'image', name: 'restored.png',
        mediaType: 'image/png', sourceUri: url }]);
    host.source(url, bytes);
    host.failWrite('assets/');
    const first = await runLiveSave(liveKey(id));
    assert.equal(first?.exported, 0);
    assert.equal(await getExportRecord(liveKey(id)), null);

    host.failWrite(null);
    const retry = await runLiveSave(liveKey(id));
    assert.equal(retry?.exported, 1);
    assert.equal(retry?.partial, 0);
    assert.deepEqual(retry?.failed, []);
    assert.deepEqual(host.requests, [url, url], 'one source acquisition per export attempt');
    const resource = [...host.files.entries()].find(([name]) => name.startsWith('assets/') && name.endsWith('restored.png'));
    assert.ok(resource);
    assert.deepEqual(resource[1], bytes);
    const main = [...host.files.values()].find(value => typeof value === 'string') as string | undefined;
    assert.ok(main);
    assert.ok(main.includes(resource[0]));
    assert.equal((await getExportRecord(liveKey(id)))?.status, 'ok');
});
});

__suiteDescribe("asset_tab_fallback", () => {
/**
 * V2 tab transport is Account-verified Runtime IPC, not AssetPipeline tab
 * iteration. Only a Tab that responds with the requested Account UUID may
 * receive a resource request. A business-request failure does not start a
 * speculative retry to another tab.
 */







useIndexStorage();
const account = fixtureAccount('gemini');
type TabMessage = { action: string; accountId?: string; url?: string };
type Reply = (value: unknown) => void;
function tabs(t: TestContext,
    handler: (id: number, message: TabMessage, reply: Reply) => void,
    list: Array<{ id: number; active?: boolean }> = [{ id: 11 }, { id: 22 }]) {
    const chromeHost = globalThis.chrome;
    const previous = Object.getOwnPropertyDescriptor(globalThis.chrome, 'tabs');
    const runtime = globalThis.chrome.runtime;
    const previousError = Object.getOwnPropertyDescriptor(runtime, 'lastError');
    const calls: Array<{ id: number; message: TabMessage }> = [];
    Object.defineProperty(chromeHost, 'tabs', { configurable: true, value: {
        query: async () => list.map(tab => ({ ...tab, url: 'https://gemini.google.com/app' })),
        sendMessage: (id: number, message: TabMessage, reply: Reply) => {
            calls.push({ id, message });
            handler(id, message, reply);
        },
    } });
    t.after(() => {
        if (previous) Object.defineProperty(chromeHost, 'tabs', previous);
        else Reflect.deleteProperty(chromeHost, 'tabs');
        if (previousError) Object.defineProperty(runtime, 'lastError', previousError);
        else Reflect.deleteProperty(runtime, 'lastError');
    });
    return { calls, failReceiver(reply: Reply) {
        Reflect.set(runtime, 'lastError', { message: 'Receiving end does not exist' });
        try { reply(undefined); }
        finally { Reflect.deleteProperty(runtime, 'lastError'); }
    } };
}

test('resource IPC skips an unavailable Content receiver and reaches the next verified Account tab', async t => {
    await putAccount(account);
    let failFirst!: (reply: Reply) => void;
    const host = tabs(t, (id, message, reply) => {
        assert.equal(message.action === 'getAccountContext' || message.accountId === account.id, true);
        if (id === 11) return failFirst(reply);
        if (message.action === 'getAccountContext') return reply({
            ok: true, accountContext: { accountId: account.id, providerId: 'gemini', slot: 'u0' },
        });
        reply({ success: true, dataBase64: 'AQID', mimeType: 'image/png' });
    });
    failFirst = host.failReceiver;
    const result: unknown = await sendToGeminiTab({
        action: 'getImageBlob', url: 'https://lh3.googleusercontent.com/source.png',
    }, account.id);
    assert.deepEqual(result, { success: true, dataBase64: 'AQID', mimeType: 'image/png' });
    assert.deepEqual(host.calls.map(({ id, message }) => [id, message.action]), [
        [11, 'getAccountContext'], [22, 'getAccountContext'], [22, 'getImageBlob'],
    ]);
    assert.equal(host.calls[2].message.accountId, account.id);
});

test('a verified tab that fails during a resource request cannot trigger speculative cross-tab resend', async t => {
    await putAccount(account);
    let fail!: (reply: Reply) => void;
    const host = tabs(t, (id, message, reply) => {
        if (message.action === 'getAccountContext') return reply({
            ok: true, accountContext: { accountId: account.id, providerId: 'gemini', slot: 'u0' },
        });
        assert.equal(id, 11);
        fail(reply);
    });
    fail = host.failReceiver;
    await assert.rejects(sendToGeminiTab({ action: 'getImageBlob', url: 'https://example.test/image.png' },
        account.id), /Receiving end does not exist/);
    assert.deepEqual(host.calls.map(({ id, message }) => [id, message.action]), [
        [11, 'getAccountContext'], [11, 'getImageBlob'],
    ], 'a failed bound request never forwards bytes/credentials to tab 22');
});

test('a foreign active tab cannot become the resource target even when its Content responder is healthy', async t => {
    await putAccount(account);
    const foreignAccount = '10000000-0000-4000-8000-000000000002';
    const host = tabs(t, (id, message, reply) => {
        if (message.action === 'getAccountContext') return reply({
            ok: true, accountContext: { accountId: id === 11 ? foreignAccount : account.id,
                providerId: 'gemini', slot: 'u0' },
        });
        assert.equal(id, 22);
        reply({ success: true, dataBase64: 'BAUG' });
    }, [{ id: 11, active: true }, { id: 22 }]);
    const result = await sendToGeminiTab({ action: 'getImageBlob', url: 'https://example.test/p.png' }, account.id);
    assert.deepEqual(result, { success: true, dataBase64: 'BAUG' });
    assert.deepEqual(host.calls.map(({ id, message }) => [id, message.action]), [
        [11, 'getAccountContext'], [22, 'getAccountContext'], [22, 'getImageBlob'],
    ]);
});
});

__suiteDescribe("batch_fetcher_abort", () => {
/**
 * V2 Runtime routing regressions replacing removed batchFetcher/abortManager.
 * The trusted execution target is an Account UUID verified by Content IPC,
 * never a caller-provided slot. Cancellation is tested on L1's AbortSignal.
 * Real Runtime TabService and L3a Account store; only Chrome tabs are mocked.
 */







useIndexStorage();
const selected = fixtureAccount('gemini');
const foreign = '10000000-0000-4000-8000-000000000002';

function installTabs(t: { after(fn: () => void): void }, tabs: Array<{ id: number; active?: boolean }>,
    onMessage: (tabId: number, message: Record<string, unknown>, reply: (value: unknown) => void) => void) {
    const chromeHost = globalThis.chrome;
    const previous = Object.getOwnPropertyDescriptor(globalThis.chrome, 'tabs');
    const observations: Array<{ tabId: number; message: Record<string, unknown> }> = [];
    Object.defineProperty(chromeHost, 'tabs', { configurable: true, value: {
        query: async () => tabs.map(tab => ({ ...tab, url: 'https://gemini.google.com/app' })),
        sendMessage: (tabId: number, message: Record<string, unknown>, reply: (value: unknown) => void) => {
            observations.push({ tabId, message });
            onMessage(tabId, message, reply);
        },
    } });
    t.after(() => {
        if (previous) Object.defineProperty(chromeHost, 'tabs', previous);
        else Reflect.deleteProperty(chromeHost, 'tabs');
    });
    return observations;
}

test('v2 Runtime bypasses an active foreign Gemini tab and sends to the verified Account only', async t => {
    await putAccount(selected);
    const messages = installTabs(t, [{ id: 11, active: true }, { id: 22, active: false }],
        (tabId, message, reply) => {
            if (message.action === 'getAccountContext') return reply({
                ok: true, accountContext: { providerId: 'gemini',
                    accountId: tabId === 11 ? foreign : selected.id, slot: 'u0' },
            });
            return reply({ ok: true, received: message });
        });
    const result = await sendToGeminiTab({ action: 'fetchDetail', conversationId: 'source-only' }, selected.id);
    assert.deepEqual(result, {
        ok: true, received: { action: 'fetchDetail', conversationId: 'source-only', accountId: selected.id },
    });
    assert.deepEqual(messages.map(({ tabId, message }) => [tabId, message.action]), [
        [11, 'getAccountContext'], [22, 'getAccountContext'], [22, 'fetchDetail'],
    ]);
    const resolved = await resolveAccountTab(selected.id);
    assert.equal(resolved.id, 22);
});

test('v2 Runtime fails closed when no tab has the requested Account UUID', async t => {
    await putAccount(selected);
    const calls = installTabs(t, [{ id: 30, active: true }, { id: 40, active: false }],
        (_id, message, reply) => {
            assert.equal(message.action, 'getAccountContext', 'no unverified business message is sent');
            reply({ ok: true, accountContext: { accountId: foreign, providerId: 'gemini', slot: 'u0' } });
        });
    await assert.rejects(resolveAccountTab(selected.id), /No open Provider Tab matches this Account/);
    await assert.rejects(sendToGeminiTab({ action: 'fetchDetail' }, selected.id), /No open Provider Tab matches this Account/);
    assert.ok(calls.length >= 2);
    assert.ok(calls.every(call => call.message.action === 'getAccountContext'));
});

test('v2 Runtime tab IPC timeout settles once and ignores a late browser callback', async t => {
    let delayedReply: ((value: unknown) => void) | undefined;
    installTabs(t, [{ id: 55 }], (_id, _message, reply) => { delayedReply = reply; });
    await assert.rejects(sendTabMessage(55, { action: 'getAccountContext' }, 10), /timed out/);
    assert.equal(typeof delayedReply, 'function');
    delayedReply!({ ok: true, accountContext: { accountId: selected.id } });
});

test('v2 Runtime rejects non-UUID targets and unsupported Content providers without falling back to a slot', async t => {
    await putAccount(selected);
    const observations = installTabs(t, [{ id: 1 }], () => { throw new Error('Must not be called'); });
    await assert.rejects(sendToGeminiTab({ action: 'fetchDetail' }, 'u0'), /Account UUID/);
    await assert.rejects(sendToAITab('chatgpt', { action: 'fetchDetail' }, selected.id),
        /Provider\/account mismatch/);
    assert.deepEqual(observations, []);
});
});

__suiteDescribe("continued_chat_export_badge", () => {
async function version(id: string, time: number | undefined, turns: number) {
    await ingestDetail(exportKey(id).accountId, id, {
        ...(time !== undefined ? { savedAt: time } : {}), quality: { status: 'complete' }, assets: [],
        messages: Array.from({ length: turns * 2 }, (_, i) => ({ role: i % 2 ? 'assistant' as const : 'user' as const,
            timestamp: 1700000000000 + i, content: [{ type: 'paragraph' as const,
                children: [{ type: 'text' as const, text: `Turn ${Math.floor(i / 2) + 1} part ${i % 2}` }] }] })),
    }, { title: 'Continued conversation', titleSource: 'provider', ...(time !== undefined ? { updatedAt: time } : {}) });
}
test('completion records retain captured source versions across successive exports and skip only known unchanged versions', async t => {
    const host = v2ExportHost(t), id = 'continued_chat_test_1';
    const request = exportRequest([id], { skipUnchanged: true });
    const T1 = 1700000000500, T2 = 1700000100800, T3 = 1700000300900;
    await version(id, T1, 1);
    assert.equal((await runExport(request)).exported, 1);
    const first = await getExportRecord(exportKey(id));
    assert.equal(first?.chatTime, T1); assert.equal(first?.status, 'ok');
    assert.equal(shouldSkipExport(first, T1, request), true);
    assert.equal(shouldSkipExport(first, T2, request), false);
    await version(id, T2, 2);
    assert.equal((await runExport(request)).exported, 1);
    const second = await getExportRecord(exportKey(id));
    assert.equal(second?.chatTime, T2); assert.equal(second?.status, 'ok');
    assert.equal((await runExport(request)).skipped, 1);
    assert.equal(shouldSkipExport(second, T3, request), false);
    assert.equal(host.clicks(), 2);
    assert.match(await host.blobs[1].text(), /Turn 2 part 1/);
    assert.equal(Object.hasOwn(second!, 'messageCount'), false, 'the minimal Record has no parallel message-count freshness rule');
});
test('message timestamps cannot manufacture an unknown conversation source version', async t => {
    const host = v2ExportHost(t), id = 'undated';
    await version(id, undefined, 2);
    const request = exportRequest([id], { skipUnchanged: true });
    assert.equal((await runExport(request)).exported, 1);
    const record = await getExportRecord(exportKey(id));
    assert.equal(record?.chatTime, undefined);
    assert.equal(shouldSkipExport(record, undefined, request), false);
    assert.equal(host.clicks(), 1);
});
test('a client clock behind the source clock cannot invalidate a matching source export version', async t => {
    v2ExportHost(t);
    const sourceTime = 1700000050000, clientTime = sourceTime - 10000;
    t.mock.method(Date, 'now', () => clientTime);
    await version('skew_chat', sourceTime, 2);
    const request = exportRequest(['skew_chat'], { skipUnchanged: true });
    assert.equal((await runExport(request)).exported, 1);
    const record = await getExportRecord(exportKey('skew_chat'));
    assert.equal(record?.exportedAt, clientTime); assert.equal(record?.chatTime, sourceTime);
    assert.equal((await runExport(request)).skipped, 1);
});
});

__suiteDescribe("export_batch_resilience", () => {
const JSZip = require('../lib/jszip.min.js');

test('failed L1 acquisition affects only its key while sibling conversations export and commit', async t => {
    const host = v2ExportHost(t);
    await seedExportIndexOnly('broken');
    await seedExportConversation('healthy');

    const progress: string[] = [];
    const result = await runExport(exportRequest(['broken', 'healthy']), {
        onProgress: item => progress.push(item.key.conversationId),
    });

    assert.deepEqual(progress, ['broken', 'healthy']);
    assert.equal(result.aborted, false);
    assert.equal(result.exported, 1);
    assert.equal(result.partial, 0);
    assert.deepEqual(result.failed, [exportKey('broken')]);
    assert.equal(result.skipped, 0);
    assert.equal(host.clicks(), 1);
    assert.match(host.filenames[0], /\.md$/);
    assert.equal(host.blobs.length, 1);
    assert.match(await host.blobs[0].text(), /Answer for healthy/);
    assert.doesNotMatch(await host.blobs[0].text(), /Unavailable broken/);

    assert.equal(await getExportRecord(exportKey('broken')), null);
    const healthy = await getExportRecord(exportKey('healthy'));
    assert.ok(healthy);
    assert.equal(healthy.format, 'markdown');
    assert.equal(healthy.status, 'ok');
    assert.equal(healthy.chatTime, 100);
});

test('multi-conversation batch export reports ordered progress and delivers one ZIP with committed records', async t => {
    const host = v2ExportHost(t);
    const previousZip = __getZipConstructor();
    __setZipConstructor(JSZip);
    t.after(() => __setZipConstructor(previousZip));
    const ids = ['progress-a', 'progress-b', 'progress-c', 'progress-d'];
    for (const id of ids) await seedExportConversation(id);
    const updates: Array<{ current: number; total: number; id: string }> = [];
    const result = await runExport(exportRequest(ids), {
        onProgress: ({ current, total, key }) => {
            updates.push({ current, total, id: key.conversationId });
        },
    });

    assert.equal(result.exported, 4);
    assert.deepEqual(result.failed, []);
    assert.equal(host.clicks(), 1, 'one ZIP is delivered for the full batch');
    assert.deepEqual(updates, ids.map((id, i) => ({ current: i + 1, total: ids.length, id })));
    const zip = await JSZip.loadAsync(await host.blobs[0].arrayBuffer());
    const bodies = await Promise.all(
        Object.values(zip.files)
            .filter((entry: any) => !entry.dir && entry.name.endsWith('.md'))
            .map((entry: any) => entry.async('string')),
    );
    assert.equal(bodies.length, ids.length);
    for (const id of ids) {
        assert.ok(bodies.some((body: string) => body.includes('Answer for ' + id)));
        assert.equal((await getExportRecord(exportKey(id)))?.status, 'ok');
    }
});
});

__suiteDescribe("export_cancel_semantics", () => {
/**
 * V2 cancellation ownership:
 * - Application uses one AbortSignal, not an ExportOrchestrator session.
 * - Cancelled linked batches salvage staged files; only delivered, settled items get records.
 * - Real delivery errors fail keys without being mistaken for user abort.
 * - Once delivery is accepted, cancellation cannot retroactively erase Records.
 */

test('cancellation packages completed staged bodies into a readable ZIP and records only delivered keys', async t => {
    const host = v2ExportHost(t);
    await seedExportConversation('cancel-first');
    await seedExportConversation('cancel-second');
    await seedExportConversation('cancel-third');
    const zip = __getZipConstructor();
    __setZipConstructor(require('../lib/jszip.min.js'));
    t.after(() => __setZipConstructor(zip));
    const controller = new AbortController();
    const progress: number[] = [];

    const result = await runExport(exportRequest(['cancel-first', 'cancel-second', 'cancel-third']), {
        signal: controller.signal,
        onProgress: item => {
            progress.push(item.current);
            if (item.current === 3) controller.abort();
        },
    });

    assert.deepEqual(progress, [1, 2, 3]);
    assert.equal(result.aborted, true);
    assert.equal(result.exported, 2);
    assert.equal(result.partial, 0);
    assert.deepEqual(result.failed, []);
    assert.equal(host.clicks(), 1);
    assert.match(host.filenames[0], /\.zip$/);
    const files = await readDeliveredFiles(host);
    assert.equal(files.length, 2);
    const text = (await Promise.all(files.map(file => file.async('string')))).join('\n');
    assert.match(text, /Answer for cancel-first/);
    assert.match(text, /Answer for cancel-second/);
    assert.doesNotMatch(text, /Answer for cancel-third/);
    assert.equal((await getExportRecord(exportKey('cancel-first')))?.status, 'ok');
    assert.equal((await getExportRecord(exportKey('cancel-second')))?.status, 'ok');
    assert.equal(await getExportRecord(exportKey('cancel-third')), null);
});

test('host permission revocation fails the delivered key, not the v2 AbortSignal', async t => {
    const host = v2ExportHost(t, () => {
        throw new DOMException('Download permission was revoked', 'NotAllowedError');
    });
    await seedExportConversation('permission-revoked');
    const result = await runExport(exportRequest(['permission-revoked']));

    assert.equal(host.clicks(), 1);
    assert.equal(result.aborted, false, 'a host error is not a user cancellation');
    assert.equal(result.exported, 0);
    assert.deepEqual(result.failed, [exportKey('permission-revoked')]);
    assert.equal(await getExportRecord(exportKey('permission-revoked')), null);
});

test('real L1 429 backoff obeys the same AbortSignal and never waits out 30 seconds', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = handleHttp429({
        resp: { status: 429, headers: { get: () => '30' } },
        retryAfterMs: 30_000,
        signal: controller.signal,
    });
    controller.abort();

    const response = await pending;
    assert.deepEqual(response, { shouldRetry: false, aborted: true });
    assert.ok(Date.now() - started < 1500, 'abort must interrupt rate-limit backoff immediately');
});

test('cancel during confirmed browser delivery cannot roll back the v2 ExportRecord', async t => {
    const controller = new AbortController();
    const host = v2ExportHost(t, () => controller.abort());
    await seedExportConversation('already-delivered');

    const result = await runExport(exportRequest(['already-delivered']), { signal: controller.signal });

    assert.equal(host.clicks(), 1);
    assert.equal(result.exported, 1, 'L4 delivery preceded and committed the v2 record');
    assert.deepEqual(result.failed, []);
    assert.equal(result.aborted, true, 'the caller signal still reports its final state');
    assert.equal((await getExportRecord(exportKey('already-delivered')))?.status, 'ok');
    assert.match(await host.blobs[0].text(), /Answer for already-delivered/);

    // The next task owns a fresh AbortSignal. No stale cancellation/session state.
    const retry = await runExport(exportRequest(['already-delivered'], { skipUnchanged: true }));
    assert.equal(retry.aborted, false);
    assert.equal(retry.skipped, 1);
    assert.equal(retry.exported, 0);
    assert.equal(host.clicks(), 1);
});

test('cancel requested by a new task does not erase previous committed v2 records', async t => {
    const host = v2ExportHost(t);
    await seedExportConversation('committed');
    await seedExportConversation('new-pending');
    const first = await runExport(exportRequest(['committed']));
    assert.equal(first.exported, 1);
    assert.equal(host.clicks(), 1);

    const controller = new AbortController();
    const second = await runExport(exportRequest(['new-pending']), {
        signal: controller.signal, onProgress: () => controller.abort(),
    });
    assert.equal(second.aborted, true);
    assert.equal(second.exported, 0);
    assert.deepEqual(second.failed, []);
    assert.equal(host.clicks(), 1);
    assert.equal(await getExportRecord(exportKey('new-pending')), null);
    assert.equal((await getExportRecord(exportKey('committed')))?.status, 'ok');
});

for (const stage of ['source', 'attachment'] as const) {
    test(`real ChatGPT ${stage} 429 stops the batch and salvages readable files without false success`, async t => {
        const host = v2ExportHost(t);
        const zip = __getZipConstructor();
        __setZipConstructor(require('../lib/jszip.min.js'));
        t.after(() => __setZipConstructor(zip));
        const account = await getOrCreateAccount('chatgpt', JSON.stringify(['export-user', 'export-space']));
        const keys = ['first', 'second', 'limited'].map(conversationId => ({ accountId: account.id, conversationId }));
        for (const key of keys.slice(0, stage === 'source' ? 2 : 3)) {
            const hasAsset = stage === 'attachment' && key.conversationId === 'limited'
                || stage === 'source' && key.conversationId === 'first';
            await ingestDetail(account.id, key.conversationId, {
                savedAt: 100, quality: { status: 'complete', sourceTurn: 'finished' },
                assets: hasAsset ? [{ id: 'file', kind: 'file', name: 'pending.txt', sourceUri: stage === 'source' ? 'https://example.test/ready.txt' : 'sediment://file_pending' }] : [],
                messages: [{ role: 'assistant', content: [
                    { type: 'paragraph', children: [{ type: 'text', text: 'Saved body ' + key.conversationId }] },
                    ...(hasAsset ? [{ type: 'file' as const, assetId: 'file' }] : []),
                ] }],
            }, { title: key.conversationId, titleSource: 'provider', updatedAt: 100 });
        }
        if (stage === 'source') await ingestIndexes(account.id, [{ conversationId: 'limited', fields: {
            title: 'limited', titleSource: 'provider', updatedAt: 100,
        } }]);
        let calls = 0;
        let acquired = () => {};
        const completedAsset = new Promise<void>(resolve => { acquired = resolve; });
        t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
            if (String(input).endsWith('/api/auth/session')) return Response.json(sessionGen(
                stage === 'source' ? 'C_EXPORT_CANCEL_429_SOURCE_SESSION' : 'C_EXPORT_CANCEL_429_ASSET_SESSION'));
            if (String(input) === 'https://example.test/ready.txt') return new Response('SAVED ATTACHMENT', { headers: { 'Content-Type': 'text/plain' } });
            calls++;
            if (stage === 'source') {
                await completedAsset;
                await new Promise(resolve => setImmediate(resolve));
            }
            return new Response(null, { status: 429, headers: { 'Retry-After': '24' } });
        });
        const result = await runExport({ ...exportRequest([]), keys, includeAssets: true }, {
            onResourceProgress: p => { if (p.downloaded === 1) acquired(); },
        });
        assert.equal(result.aborted, true);
        assert.equal(result.exported, 2);
        assert.deepEqual(result.failed, []);
        assert.ok(result.rateLimitedUntil && result.rateLimitedUntil >= Date.now() + 3_590_000);
        assert.equal(calls, 1, 'no retry or next source request after the first 429');
        const files = await readDeliveredFiles(host);
        assert.equal(files.length, 3);
        if (stage === 'source') {
            const attachment = files.find(file => file.name.startsWith('files/'));
            assert.ok(attachment);
            assert.equal(await attachment.async('string'), 'SAVED ATTACHMENT');
        }
        const text = (await Promise.all(files.map(file => file.async('string')))).join('\n');
        assert.match(text, /Saved body first/);
        assert.match(text, /Saved body second/);
        assert.equal((await getExportRecord(keys[0]))?.status, 'ok');
        assert.equal((await getExportRecord(keys[1]))?.status, 'ok');
        assert.equal(await getExportRecord(keys[2]), null, 'unfinished source/attachment work has no success record');
        const retry = await runExport({ ...exportRequest([]), keys: [keys[2]], includeAssets: true });
        assert.equal(retry.aborted, true);
        assert.equal(retry.rateLimitedUntil, result.rateLimitedUntil);
        assert.equal(calls, 1, 'a new export cannot bypass the persisted cooldown');
    });
}

test('ZIP delivery failure during cancellation is reported without writing success records', async t => {
    const controller = new AbortController();
    v2ExportHost(t, () => { throw new DOMException('Download denied', 'NotAllowedError'); });
    await seedExportConversation('staged-failure');
    await seedExportConversation('never-started');
    const result = await runExport(exportRequest(['staged-failure', 'never-started']), {
        signal: controller.signal, onProgress: p => { if (p.current === 2) controller.abort(); },
    });
    assert.equal(result.aborted, true);
    assert.equal(result.exported, 0);
    assert.deepEqual(result.failed, [exportKey('staged-failure')]);
    assert.equal(await getExportRecord(exportKey('staged-failure')), null);
});
});

__suiteDescribe("export_diagnostic_evidence", () => {
useIndexStorage();

for (const failure of ['locator', 'payload', 'signed', 'body'] as const) {
    test(`ChatGPT acquisition diagnostics identify ${failure} failure without signed URL disclosure`, async () => {
        const account = await getOrCreateAccount('chatgpt', 'default');
        const diagnostics: Diagnostic[] = [];
        const provider = new ChatGPTProvider({ fetchFn: async url => {
            if (url.endsWith('/api/auth/session')) return Response.json(sessionGen('C_FILE_DOWNLOAD_SESSION_01'));
            if (url.includes('/backend-api/')) {
                if (failure === 'locator') throw new TypeError('Failed to fetch');
                return Response.json(fileDownloadGen(failure === 'payload'
                    ? 'C_FILE_DOWNLOAD_ACQUIRE_02' : 'C_DIAGNOSTIC_SIGNED_DOWNLOAD_01'));
            }
            if (failure === 'signed') throw new TypeError('Failed to fetch');
            return new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('Body read failed')); } }));
        } });
        await assert.rejects(provider.acquireResource({ accountId: account.id, conversationId: 'diagnostic-resource' },
            { id: 'file', kind: 'file', sourceUri: 'file-download:file_diagnostic' }, undefined, d => diagnostics.push(d)));
        const failed = diagnostics.find(d => d.code === 'CHATGPT_RESOURCE_REQUEST_FAILED');
        assert.ok(failed);
        assert.ok(failed.details && typeof failed.details === 'object' && !Array.isArray(failed.details));
        assert.equal(failed.details.phase, { locator: 'download_locator', payload: 'download_payload', signed: 'resource_fetch', body: 'read_body' }[failure]);
        assert.equal(failed.details.origin, failure === 'signed' || failure === 'body' ? 'https://files.example' : 'https://chatgpt.com');
        if (failure === 'payload') {
            const invalid = diagnostics.find(d => d.code === 'CHATGPT_DOWNLOAD_PAYLOAD_INVALID');
            assert.ok(invalid?.details && typeof invalid.details === 'object' && !Array.isArray(invalid.details));
            assert.deepEqual(invalid.details.responseKeys, ['status']);
            assert.equal(invalid.details.downloadUrlPresent, false);
        }
        assert.doesNotMatch(JSON.stringify(diagnostics), /do-not-log|private-path|accessToken/);
    });
}

test('source request diagnostics preserve the original failure and redact URL paths', async t => {
    const failure = new TypeError('Failed to fetch');
    t.mock.method(globalThis, 'fetch', async () => { throw failure; });
    const diagnostics: Diagnostic[] = [];
    await assert.rejects(acquireSourceResource({ id: 'external', kind: 'image',
        sourceUri: 'https://images.openai.com/private?signature=secret' }, undefined, d => diagnostics.push(d), 'chatgpt'), error => error instanceof Error && error.cause === failure && 'code' in error && error.code === 'RESOURCE_DOWNLOAD_FAILED');
    const failed = diagnostics.find(d => d.code === 'RESOURCE_FETCH_FAILED');
    assert.ok(failed?.details && typeof failed.details === 'object' && !Array.isArray(failed.details));
    assert.equal(failed.details.origin, 'https://images.openai.com');
    assert.equal(failed.details.phase, 'fetch');
    assert.equal(failed.details.errorName, 'TypeError');
    assert.equal(failed.details.httpStatus, null);
    assert.equal(failed.details.credentials, 'omit');
    assert.doesNotMatch(JSON.stringify(diagnostics), /private|signature|secret/);
    const result = await attemptResource('external', () => acquireSourceResource({ id: 'external', kind: 'image',
        sourceUri: 'https://images.openai.com/private?signature=secret' }, undefined, undefined, 'chatgpt'));
    if (result.ok) assert.fail('browser transport failure cannot produce attachment bytes');
    assert.equal(result.code, 'RESOURCE_DOWNLOAD_FAILED');
    assert.equal(resourceIssueKind(result), 'download');
});

test('source images recover from wildcard CORS without breaking authenticated downloads', async t => {
    const attempts: RequestCredentials[] = [];
    t.mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
        const credentials = init?.credentials ?? 'same-origin';
        attempts.push(credentials);
        assert.equal(init?.redirect, 'manual');
        if (credentials === 'include') throw new TypeError('Failed to fetch');
        return new Response('public-image');
    });
    const result = await acquireSourceResource({ id: 'public', kind: 'image', sourceUri: 'https://images.openai.com/image.png' }, undefined, undefined, 'chatgpt');
    assert.equal(new TextDecoder().decode(result.bytes), 'public-image');
    assert.deepEqual(attempts, ['include', 'omit']);
    t.mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
        assert.equal(init?.credentials, 'include');
        return new Response('authenticated-image');
    });
    assert.equal(new TextDecoder().decode((await acquireSourceResource({ id: 'private', kind: 'image',
        sourceUri: 'https://lh3.googleusercontent.com/image' }, undefined, undefined, 'gemini')).bytes), 'authenticated-image');
});

test('source acquisition never retries an HTTP error or a cancelled request without credentials', async t => {
    const controller = new AbortController();
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('', { status: 403 }); });
    await assert.rejects(acquireSourceResource({ id: 'restricted', kind: 'image', sourceUri: 'https://images.openai.com/image' }, undefined, undefined, 'chatgpt'));
    assert.equal(calls, 1);
    t.mock.method(globalThis, 'fetch', async () => { calls++; controller.abort(); throw new TypeError('Failed to fetch'); });
    await assert.rejects(acquireSourceResource({ id: 'cancelled', kind: 'image', sourceUri: 'https://images.openai.com/image' }, controller.signal, undefined, 'chatgpt'),
        { name: 'AbortError' });
    assert.equal(calls, 2);
});

test('native sandbox expiration remains distinct from HTTP 404 and does not disclose the error body', async () => {
    const account = await getOrCreateAccount('chatgpt', 'default');
    const diagnostics: Diagnostic[] = [];
    const provider = new ChatGPTProvider({ fetchFn: async url => Response.json(url.endsWith('/api/auth/session')
        ? sessionGen('C_FILE_DOWNLOAD_SESSION_01') : fileDownloadGen('C_DIAGNOSTIC_EXPIRED_SANDBOX_01')) });
    const result = await attemptResource('expired', () => provider.acquireResource(
        { accountId: account.id, conversationId: 'expired' }, { id: 'expired', kind: 'file', sourceUri: 'file-download:file_expired' },
        undefined, d => diagnostics.push(d)));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'RESOURCE_SOURCE_EXPIRED');
    assert.equal(resourceIssueKind(result), 'expired');
    assert.equal(result.httpStatus, undefined);
    assert.match(result.reason, /ace_pod_expired/);
    const invalid = diagnostics.find(d => d.code === 'CHATGPT_DOWNLOAD_PAYLOAD_INVALID');
    assert.ok(invalid?.details && typeof invalid.details === 'object' && !Array.isArray(invalid.details));
    assert.equal(invalid.details.errorCode, 'ace_pod_expired');
    assert.equal(invalid.details.errorType, 'GetDownloadLinkError');
    assert.doesNotMatch(JSON.stringify(diagnostics), /do-not-log|private-path|secret/);
});

for (const origin of ['https://chatgpt.com', 'https://chat.openai.com']) test(`relative downloads resolve against provider origin ${origin}`, async () => {
    const account = await getOrCreateAccount('chatgpt', 'default');
    const diagnostics: Diagnostic[] = [];
    const requests: string[] = [];
    const provider = new ChatGPTProvider({ origin, fetchFn: async url => {
        requests.push(url);
        if (url.endsWith('/api/auth/session')) return Response.json(sessionGen('C_FILE_DOWNLOAD_SESSION_01'));
        if (url.includes('/backend-api/')) return Response.json(fileDownloadGen('C_DIAGNOSTIC_RELATIVE_DOWNLOAD_01'));
        assert.equal(url, `${origin}/private-path?token=do-not-log`);
        return new Response('uploaded-file-bytes');
    } });
    const result = await provider.acquireResource({ accountId: account.id, conversationId: 'relative' },
        { id: 'relative', kind: 'file', sourceUri: 'file-download:file_relative' }, undefined, d => diagnostics.push(d));
    assert.equal(new TextDecoder().decode(result.bytes), 'uploaded-file-bytes');
    assert.equal(requests.length, 3);
    const shape = diagnostics.find(d => d.code === 'CHATGPT_DOWNLOAD_URL_SHAPE');
    assert.ok(shape?.details && typeof shape.details === 'object' && !Array.isArray(shape.details));
    assert.deepEqual(shape.details.shape, { kind: 'root_relative', scheme: null, length: 30, surroundingWhitespace: false });
    assert.equal(shape.details.origin, origin);
    assert.doesNotMatch(JSON.stringify(diagnostics), /private-path|do-not-log/);
});

test('internal tool termination is a tool step without claiming missing snapshot content', () => {
    const raw = detailGen('C_DETAIL_L1_SOURCE_01');
    const conversation = decodeChatGPTDetail(raw, raw.id);
    const leaf = conversation.mapping.get(conversation.current_node);
    assert.ok(leaf?.message);
    leaf.message.end_turn = false;
    leaf.message.recipient = 'python';
    leaf.message.channel = 'analysis';
    const parsed = parseChatGPTConversation({ conversation, assetsByNode: new Map() });
    assert.deepEqual(parsed.conversation.detail.quality, { status: 'complete', sourceTurn: 'tool_pending' });
    assert.ok(!parsed.diagnostics.some(d => d.code === 'CHATGPT_BRANCH_COVERAGE_INCOMPLETE'));
    const observation = parsed.diagnostics.find(d => d.code === 'CHATGPT_SOURCE_TURN_STATUS');
    assert.ok(observation?.details && typeof observation.details === 'object' && !Array.isArray(observation.details));
    assert.equal(observation.details.recipient, 'python');
    assert.equal(observation.details.channel, 'analysis');
    assert.equal(observation.details.sourceTurn, 'tool_pending');
    assert.equal('content' in observation.details, false);
});

test('diagnostic observers cannot break successful downloads or detail admission', async t => {
    t.mock.method(console, 'warn', () => {});
    const account = await getOrCreateAccount('chatgpt', 'default');
    const provider = new ChatGPTProvider({ fetchFn: async url => {
        if (url.endsWith('/api/auth/session')) return Response.json(sessionGen('C_FILE_DOWNLOAD_SESSION_01'));
        if (url.includes('/conversation/source-chatgpt-1')) return Response.json(detailGen('C_DETAIL_L1_SOURCE_01'));
        if (url.includes('/backend-api/')) return Response.json(fileDownloadGen('C_DIAGNOSTIC_SIGNED_DOWNLOAD_01'));
        return new Response('attachment');
    } });
    const admission: Diagnostic[] = [];
    await provider.fetchConversationDetail(account.id, 'source-chatgpt-1', undefined, d => admission.push(d));
    const observation = admission.find(d => d.code === 'CHATGPT_DETAIL_ADMISSION');
    assert.ok(observation?.details && typeof observation.details === 'object' && !Array.isArray(observation.details));
    assert.equal(observation.details.accepted, true);
    assert.equal(observation.details.quality, 'complete');
    const result = await provider.acquireResource({ accountId: account.id, conversationId: 'diagnostic-resource' },
        { id: 'file', kind: 'file', sourceUri: 'file-download:file_diagnostic' }, undefined, () => { throw new Error('Observer failed'); });
    assert.equal(new TextDecoder().decode(result.bytes), 'attachment');
});
});

__suiteDescribe("export_failure_summary", () => {
const accountId = fixtureAccount('gemini').id;
const key = (conversationId: string) => ({ accountId, conversationId });

test('429 termination names the cooldown and manual retry instead of ordinary cancellation', () => {
    const summary = exportSummary({ exported: 2, skipped: 0, partial: 0, failed: [], aborted: true,
        rateLimitedUntil: Date.now() + 3600000 });
    assert.match(summary, /429.*export stopped.*cooling down.*Retry manually/);
    assert.equal(summary.split('\n')[0], 'Successfully downloaded: 2');
    assert.equal(summary.split('\n').length, 2);
    assert.doesNotMatch(summary, /Skipped:|Conversation export failed:/);
    assert.doesNotMatch(summary, /Cancelled/);
});

test('100 HTTP failures with different IDs and messages aggregate by actual cause and status', () => {
    const collector = new ExportIssueCollector();
    for (let i = 0; i < 100; i++) collector.add({ key: key(String(i)), stage: 'export', code: 'EXPORT_FAILED',
        severity: 'error', message: `HTTP 403 conversation ${i}`, issue: { code: 'SOURCE_HTTP_ERROR', httpStatus: 403, message: `HTTP 403 conversation ${i}` } });
    const groups = collector.groups();
    assert.equal(groups.length, 1);
    assert.equal(groups[0].conversations.length, 100);
    assert.equal(groups[0].occurrences, 100);
    assert.match(failureGroupLabel(groups[0]), /Platform access restricted.*403/);
    const copied = copyExportFailures(groups);
    assert.equal(copied.split('HTTP 403 conversation 0').length - 1, 1);
    assert.match(copied, new RegExp(`${accountId}/99`));
});

test('different HTTP statuses remain separate, without guessing from message text', () => {
    const collector = new ExportIssueCollector();
    for (const status of [401, 403, 404, 429, 500]) collector.add({ key: key(String(status)), stage: 'source_refresh',
        code: 'SOURCE_REFRESH_FAILED', severity: 'warning', message: 'request failed',
        issue: { code: 'SOURCE_HTTP_ERROR', message: 'request failed', httpStatus: status } });
    collector.add({ key: key('unknown'), stage: 'export', code: 'EXPORT_FAILED', message: 'HTTP 429 login expired CORS offline disk full' });
    assert.equal(collector.groups().length, 6);
    assert.equal(collector.groups()[5].category, 'UNKNOWN_ERROR');
    assert.equal(collector.groups()[5].httpStatus, undefined);
    assert.match(failureGroupLabel(collector.groups()[5]), /Unknown error/);
});

test('partial export warnings count occurrences and distinct account-scoped conversations', () => {
    const collector = new ExportIssueCollector();
    for (let i = 0; i < 2; i++) collector.add({ key: key('a'), stage: 'resource', code: 'RESOURCE_PROCESSING_FAILED', severity: 'warning', message: `asset ${i}` });
    collector.add({ key: { ...key('a'), accountId: fixtureAccount('claude').id }, stage: 'resource', code: 'RESOURCE_PROCESSING_FAILED', severity: 'warning', message: 'asset 3' });
    assert.equal(collector.groups().length, 1);
    assert.equal(collector.groups()[0].conversations.length, 2);
    assert.equal(collector.groups()[0].occurrences, 3);
    assert.equal(collector.groups()[0].severity, 'warning');
    assert.equal(JSON.parse(JSON.stringify(collector))[0].occurrences, 3);
});

test('cancellation, confirmed empty source and ordinary informational diagnostics do not become errors', () => {
    const collector = new ExportIssueCollector();
    for (const code of ['EXPORT_CANCELLED', 'SOURCE_CONVERSATION_EMPTY']) collector.add({ stage: 'run', code, message: code });
    collector.add({ stage: 'pdf', code: 'TYPST_LOCAL_FONTS_RESOLVED', severity: 'info', message: 'resolved' });
    assert.deepEqual(collector.groups(), []);
});

test('attachment locator 404 is a source-unavailable warning in diagnostics and the final summary', () => {
    const issue: OperationIssue = { code: 'RESOURCE_LOCATOR_UNAVAILABLE', httpStatus: 404, message: 'HTTP 404' };
    const collector = new ExportIssueCollector();
    collector.add({ key: key('missing'), stage: 'resource', code: issue.code, severity: 'warning', message: issue.message, issue });
    assert.equal(collector.groups()[0].severity, 'warning');
    assert.match(failureGroupLabel(collector.groups()[0]), /Source attachment unavailable.*404/);
    const summary = exportSummary({ exported: 1, partial: 1, skipped: 0, failed: [], aborted: false,
        expiredConversations: 1, otherPartial: 0,
        attachmentIssues: [{ ...issue, resourceId: 'missing', name: 'report.md' }] }, true);
    assert.match(summary, /1 conversation contains unavailable source attachments \(1 attachment\)/);
    assert.doesNotMatch(summary, /Attachment download failed|retry later|Other incomplete/);
});

test('missing download locators have a known cause without claiming a server expiry', () => {
    const summary = exportSummary({ exported: 1, partial: 1, skipped: 0, failed: [], aborted: false,
        otherPartial: 1,
        attachmentIssues: [{ code: 'RESOURCE_LOCATOR_UNAVAILABLE', resourceId: 'report', name: 'Research report' }] }, true);
    assert.match(summary, /Download location unavailable: 1 attachment(?:;|$)/);
    assert.match(summary, /Other incomplete conversations: 1/);
    assert.doesNotMatch(summary, /unknown cause|unavailable source attachments|retry later/);
});

test('normal mode hides attachment warnings while retaining body failures and cooldown', () => {
    const result = { exported: 1, partial: 1, skipped: 2, failed: [key('body')], aborted: true,
        expiredConversations: 1, otherPartial: 1, rateLimitedUntil: Date.now() + 3600000,
        attachmentIssues: ['RESOURCE_SOURCE_EXPIRED', 'RESOURCE_ACCESS_RESTRICTED', 'RESOURCE_DOWNLOAD_FAILED',
            'RESOURCE_PROCESSING_FAILED', 'RESOURCE_UNAVAILABLE'].map(code => ({ resourceId: code, name: code, code })) };
    const normal = exportSummary(result, false);
    assert.doesNotMatch(normal, /attachments|Attachment|RESOURCE_/);
    assert.match(normal, /Other incomplete conversations: 1/);
    assert.match(normal, /Conversation export failed: 1/);
    assert.match(normal, /Skipped: 2/);
    assert.match(normal, /429/);
    const developer = exportSummary(result, true);
    assert.match(developer, /unavailable source attachments/);
    assert.match(developer, /Attachment download failed/);
    assert.match(developer, /Attachment processing failed/);
    assert.match(developer, /Access restricted: 1 attachment(?:;|$)/);
});

test('source termination metadata never becomes an export failure, even for legacy warning events', () => {
    const collector = new ExportIssueCollector();
    for (const code of ['SOURCE_TURN_UNKNOWN', 'SOURCE_TURN_UNFINISHED', 'SOURCE_TURN_INTERRUPTED',
        'SOURCE_TURN_HANDOFF', 'SOURCE_TURN_AWAITING_REPLY', 'SOURCE_TURN_TOOL_PENDING']) {
        collector.add({ key: key(code), stage: 'detail', code, severity: 'warning', message: 'Source state only' });
    }
    assert.deepEqual(collector.groups(), []);
    collector.add({ key: key('body'), stage: 'detail', code: 'DETAIL_NOT_COMPLETE', severity: 'warning', message: 'Missing ancestor' });
    collector.add({ key: key('file'), stage: 'resource', code: 'RESOURCE_DOWNLOAD_FAILED', severity: 'warning', message: 'Download failed' });
    collector.add({ key: key('delivery'), stage: 'export', code: 'EXPORT_FAILED', severity: 'error', message: 'Disk write failed',
        issue: { code: 'FILE_WRITE_FAILED', message: 'Disk write failed' } });
    assert.deepEqual(collector.groups().map(group => group.category), ['DETAIL_NOT_COMPLETE', 'RESOURCE_DOWNLOAD_FAILED', 'FILE_WRITE_FAILED']);
});
});

__suiteDescribe("export_hardening", () => {
function baseDoc(overrides: Partial<DocumentAst> = {}): DocumentAst {
    return {
        title: 'Hardening Test',
        metadata: { id: 'conv-1', provider: 'gemini', createdAt: 1700000000000, updatedAt: 1700000000000 },
        messages: [],
        ...overrides,
    };
}

test('HTML file attachment links include rel="noopener noreferrer" with target="_blank"', () => {
    const doc = baseDoc({
        messages: [{
            role: 'assistant',
            blocks: [{
                type: 'file',
                resourceId: 'file-1',
                label: 'report.svg',
                kind: 'file',
                mediaType: 'image/svg+xml',
            }],
        }],
    });
    const { html } = renderDocumentHtml(doc, { 'file-1': 'files/report.svg' });
    assert.match(html, /<a class="gem-att-card gem-att-file"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
});

test('Markdown unlinked source labels are escaped and flattened onto a single blockquote line', () => {
    const doc = baseDoc({
        messages: [{
            role: 'assistant',
            blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'Answer' }] }],
            sources: [{
                id: 'src-1',
                number: 1,
                label: '<script>alert(1)</script>\n# Injected Heading',
            }],
        }],
    });
    const md = renderDocumentMarkdown(doc, {});
    assert.ok(!md.includes('<script>'), 'raw HTML tag must be escaped');
    assert.ok(!md.includes('\n# Injected Heading'), 'newline must not break out of blockquote');
    assert.ok(md.includes('> [1] [&lt;script&gt;alert(1)&lt;/script&gt; \\# Injected Heading]'));
});

test('HTML math renderer enforces trust: false and maxExpand limit', () => {
    const res = renderMathHtml('\\href{javascript:alert(1)}{click}', false, 'Fallback');
    assert.ok(!res.html.includes('<a '), 'untrusted KaTeX href must not render an anchor tag');
    assert.ok(!res.html.includes('href='), 'untrusted KaTeX href must not emit an href attribute');
    const expanded = renderMathHtml('\\def\\a{\\a}\\a', false, 'Fallback');
    assert.equal(expanded.diagnostic?.code, 'HTML_MATH_RENDER_FAILED');
});
});

__suiteDescribe("export_title_arbitration", () => {
test('authoritative online title replaces Takeout title without erasing import history or mutating inputs', () => {
    const old = indexFixture({ id: 'chat', title: 'Imported title', titleSource: 'takeout', hasTakeoutImport: true });
    const incoming = indexFixture({ id: 'chat', title: 'Online rename', titleSource: 'rpc', hasTakeoutImport: false });
    const merged = mergeConversationIndex(old, incoming);
    assert.equal(merged.title, 'Online rename');
    assert.equal(merged.titleSource, 'provider');
    assert.equal(Reflect.get(merged ?? {}, 'hasTakeoutImport'), undefined);
    assert.equal(Object.hasOwn(merged, 'titles'), false);
    assert.equal(old.title, 'Imported title');
    assert.equal(Reflect.get(old ?? {}, 'hasTakeoutImport'), undefined);
    assert.equal(incoming.title, 'Online rename');
    assert.equal(Reflect.get(incoming ?? {}, 'hasTakeoutImport'), undefined);
});
});

__suiteDescribe("finalize_conversation_export", () => {
/**
 * V2 export completion regression: L2 admits Index/Detail once, Application
 * coordinates one runExport path, L4 delivers, and only then L3a records outcome.
 * No retired SessionRecovery, ExportOrchestrator, BatchWorker or catalog callbacks.
 */













const account = fixtureAccount('gemini');
test('ChatGPT authored private-use prose survives parsing and Markdown export beside citations', async t => {
    const host = v2ExportHost(t);
    const raw = chatgptDetailGen('C_DETAIL_L1_SOURCE_01');
    const question = raw.mapping.question?.message;
    const answer = raw.mapping.answer?.message;
    assert.ok(question && answer);
    const authored = 'Logo: \uE000 / Icon: \uF000; control `\uE000`';
    question.content = { content_type: 'text', parts: [authored] };
    answer.content = { content_type: 'text', parts: [
        'Source\uE200cite\uE202turn388160search0\uE202turn388160search1\uE201\uF000',
    ] };
    const parsed = parseChatGPTConversation({
        conversation: decodeChatGPTDetail(raw, raw.id), assetsByNode: new Map(),
    });
    const key = { accountId: fixtureAccount('chatgpt').id, conversationId: raw.id };
    await ingestDetail(key.accountId, key.conversationId, parsed.conversation.detail, parsed.conversation.index);
    const result = await runExport(exportRequest([], { keys: [key] }));
    assert.equal(result.exported, 1);
    const markdown = await host.blobs[0].text();
    assert.ok(markdown.includes(authored), JSON.stringify(markdown));
    assert.ok(markdown.includes('Source\uF000'));
    assert.doesNotMatch(markdown, /[\uE200-\uE202]|turn388160|cite/);
    assert.deepEqual(parsed.conversation.detail.messages[0].content, [{ type: 'paragraph', children: [
        { type: 'text', text: 'Logo: \uE000 / Icon: \uF000; control ' },
        { type: 'inlineCode', code: '\uE000' },
    ] }]);
});

const old: ExportRecord = { exportedAt: 90, format: 'markdown', status: 'ok', chatTime: 90 };
const body = (text: string) => ({
    savedAt: 100,
    quality: { status: 'complete' as const },
    assets: [],
    messages: [{ role: 'assistant' as const, content: [
        { type: 'paragraph' as const, children: [{ type: 'text' as const, text }] },
    ] }],
});
function replaceProvider(t: TestContext, fetchConversationDetail: AIProvider['fetchConversationDetail']) {
    const previous = ProviderRegistry.get('gemini');
    const provider: AIProvider = {
        id: 'gemini', name: 'Completion provider test', hostPatterns: [],
        matchesUrl: () => false, checkReadiness: async () => ({ ready: true }),
        listConversations: async () => 'source_end',
        fetchConversationDetail,
        acquireResource: async () => { throw new Error('No assets in this test'); },
    };
    ProviderRegistry.register(provider);
    t.after(() => {
        ProviderRegistry.unregister('gemini');
        if (previous) ProviderRegistry.register(previous);
    });
}

test('a completed delivery creates one minimal v2 ExportRecord without modifying Index metadata', async t => {
    const observed: string[] = [];
    const host = v2ExportHost(t, () => observed.push('delivered'));
    await seedExportConversation('completion-success', 100);
    const key = exportKey('completion-success');
    const before = await getIndex(key);
    assert.ok(before);
    assert.equal(await getExportRecord(key), null);

    const result = await runExport(exportRequest([key.conversationId]));
    assert.deepEqual({ exported: result.exported, partial: result.partial, failed: result.failed },
        { exported: 1, partial: 0, failed: [] });
    assert.deepEqual(observed, ['delivered']);
    assert.equal(host.blobs.length, 1);
    assert.match(await host.blobs[0].text(), /Answer for completion-success/);
    const record = await getExportRecord(key);
    assert.ok(record);
    assert.deepEqual(Object.keys(record).sort(), ['chatTime', 'exportedAt', 'format', 'includeAssets', 'status']);
    assert.equal(record.format, 'markdown');
    assert.equal(record.status, 'ok');
    assert.equal(record.chatTime, 100, 'source version belongs to Detail, not the delivery clock');
    assert.ok(Number.isSafeInteger(record.exportedAt));
    assert.deepEqual(await getIndex(key), before, 'Export cannot promote its file title into L2 Index');
});

test('Index title authority is independent of ExportRecord and exported text', async t => {
    const host = v2ExportHost(t);
    await seedExportConversation('completion-title');
    const key = exportKey('completion-title');
    await ingestIndexes(account.id, [{ conversationId: key.conversationId,
        fields: { title: 'Authoritative imported name', titleSource: 'user', updatedAt: 100 } }]);
    // A later low-priority source cannot displace the user title.
    await ingestDetail(account.id, key.conversationId, body('Original answer'),
        { title: 'Derived candidate', titleSource: 'derived', updatedAt: 100 });

    const result = await runExport(exportRequest([key.conversationId]));
    assert.equal(result.exported, 1);
    assert.equal((await getIndex(key))?.title, 'Authoritative imported name');
    assert.equal((await getIndex(key))?.titleSource, 'user');
    const text = await host.blobs[0].text();
    assert.match(text, /Authoritative imported name/);
    assert.doesNotMatch(text, /Derived candidate/);
    const record = await getExportRecord(key);
    assert.ok(record);
    assert.equal('title' in record, false, 'v2 records do not duplicate Index title facts');
    assert.equal('messageCount' in record, false, 'message count belongs to Detail, not ExportRecord');
});

test('a missing Detail is never exported or recorded as successful completion', async t => {
    const host = v2ExportHost(t);
    await seedExportIndexOnly('completion-index-only');
    const key = exportKey('completion-index-only');
    replaceProvider(t, async () => { /* Source returned without committing Detail. */ });

    const result = await runExport(exportRequest([key.conversationId]));
    assert.equal(result.exported, 0);
    assert.deepEqual(result.failed, [key]);
    assert.equal(host.blobs.length, 0);
    assert.equal(await readConversation(key), null);
    assert.equal(await getExportRecord(key), null);
    assert.equal((await getIndex(key))?.title, 'Unavailable completion-index-only');
});

test('a Delivery failure must not replace the prior record; successful retry commits afterwards', async t => {
    let fail = true;
    const host = v2ExportHost(t, () => { if (fail) throw new Error('Browser download failed'); });
    await seedExportConversation('completion-retry');
    const key = exportKey('completion-retry');
    await putExportRecord(key, old);

    const diagnostics: ExportDiagnostic[] = [];
    const failed = await runExport(exportRequest([key.conversationId]), { onDiagnostic: event => diagnostics.push(event) });
    assert.ok(diagnostics.some(event => event.key?.conversationId === key.conversationId
        && event.code === 'EXPORT_FAILED' && event.message === 'Browser download failed'));
    assert.equal(failed.exported, 0);
    assert.deepEqual(failed.failed, [key]);
    assert.deepEqual(await getExportRecord(key), old);
    fail = false;

    const success = await runExport(exportRequest([key.conversationId]));
    assert.equal(success.exported, 1);
    assert.deepEqual(success.failed, []);
    const next = await getExportRecord(key);
    assert.ok(next);
    assert.equal(next.status, 'ok');
    assert.equal(next.chatTime, 100);
    assert.ok(next.exportedAt >= old.exportedAt);
    assert.ok(host.clicks() >= 2);
});

test('ExportRecord write failure is reported only after delivery and leaves the previous value', async t => {
    const host = v2ExportHost(t);
    await seedExportConversation('completion-write-failure');
    const key = exportKey('completion-write-failure');
    await putExportRecord(key, old);
    host.failStorage('exportRecords');

    const failed = await runExport(exportRequest([key.conversationId]));
    assert.equal(failed.exported, 0);
    assert.deepEqual(failed.failed, [key]);
    assert.equal(host.blobs.length, 1, 'the file is already delivered before record persistence');
    assert.deepEqual(await getExportRecord(key), old);

    host.failStorage();
    const recovered = await runExport(exportRequest([key.conversationId]));
    assert.equal(recovered.exported, 1);
    assert.equal((await getExportRecord(key))?.chatTime, 100);
});

test('Export completion never creates a catalog row from a standalone ExportRecord', async t => {
    v2ExportHost(t);
    const key = exportKey('uncatalogued-record');
    await putExportRecord(key, old);
    assert.equal(await getIndex(key), null, 'export history is not evidence of an L2 conversation');
    assert.equal(await readConversation(key), null);
    assert.deepEqual(await getExportRecord(key), old);
});

test('batch completion stores records per key and Skip consumes only delivered versions', async t => {
    const host = v2ExportHost(t);
    const previousZip = __getZipConstructor();
    __setZipConstructor(require('../lib/jszip.min.js'));
    t.after(() => __setZipConstructor(previousZip));
    await seedExportConversation('completion-batch-1');
    await seedExportConversation('completion-batch-2');
    const ids = ['completion-batch-1', 'completion-batch-2'];
    const first = await runExport(exportRequest(ids));
    assert.equal(first.exported, 2);
    assert.deepEqual(first.failed, []);
    assert.equal(host.blobs.length, 1, 'the batch has one final browser artifact');
    for (const id of ids) {
        const record = await getExportRecord(exportKey(id));
        assert.equal(record?.status, 'ok');
        assert.equal(record?.chatTime, 100);
    }

    const skipped = await runExport(exportRequest(ids, { skipUnchanged: true }));
    assert.equal(skipped.skipped, 2);
    assert.equal(skipped.exported, 0);
    assert.equal(host.blobs.length, 1, 'skipped exports cannot trigger another delivery');
});


test('partial fallback diagnostics explain freshness and source failure without changing delivery', async t => {
    const host = v2ExportHost(t);
    await seedExportIndexOnly('diagnostic-partial');
    const key = exportKey('diagnostic-partial');
    await ingestDetail(account.id, key.conversationId, {
        ...body('Cached answer'), quality: { status: 'partial' },
    }, { updatedAt: 200 });
    const diagnostics: ExportDiagnostic[] = [];
    const result = await runExport(exportRequest([key.conversationId]), {
        onDiagnostic: event => diagnostics.push(event),
    });
    assert.equal(result.exported, 1);
    assert.equal(result.partial, 1);
    assert.equal(host.blobs.length, 1);
    assert.ok(diagnostics.some(event => event.key?.conversationId === key.conversationId
        && event.code === 'SOURCE_REFRESH_FAILED' && event.message.length > 0));
    assert.deepEqual(diagnostics.find(event => event.code === 'DETAIL_NOT_COMPLETE')?.details,
        { quality: 'partial', messageCount: 1, savedAt: 100, indexUpdatedAt: 200,
            lastMessageId: null, lastMessageRole: 'assistant' });
    assert.deepEqual(diagnostics.find(event => event.code === 'DETAIL_STALE')?.details,
        { savedAt: 100, updatedAt: 200, lagMs: 100 });
    assert.deepEqual(diagnostics.find(event => event.code === 'DETAIL_REFRESH_RESULT')?.details, {
        refreshFailed: true, requestedExplicitly: false, needsSourceReaders: false,
        before: { savedAt: 100, indexUpdatedAt: 200, quality: 'partial', messageCount: 1 },
        after: { savedAt: 100, indexUpdatedAt: 200, quality: 'partial', messageCount: 1 },
    });
    assert.equal((await getExportRecord(key))?.otherContentMissing, true);
    const retry = await runExport(exportRequest([key.conversationId]), {
        onDiagnostic: () => { throw new Error('Diagnostic observer failed'); },
    });
    assert.equal(retry.exported, 1, 'diagnostic observer cannot break delivery');
    assert.equal(retry.partial, 1);
});

test('confirmed source-empty conversations are skipped without delivery, replacing local bodies or success records', async t => {
    const host = v2ExportHost(t);
    await seedExportConversation('confirmed-empty', 100);
    const key = exportKey('confirmed-empty');
    const before = await readConversation(key);
    const originalFetch = GeminiProvider.prototype.fetchConversationDetail;
    GeminiProvider.prototype.fetchConversationDetail = async () => { throw new ConfirmedSourceEmptyError(); };
    t.after(() => { GeminiProvider.prototype.fetchConversationDetail = originalFetch; });
    const diagnostics: ExportDiagnostic[] = [];
    const result = await runExport(exportRequest([key.conversationId]), { refreshDetail: true,
        onDiagnostic: event => diagnostics.push(event) });
    assert.equal(result.skipped, 1);
    assert.equal(result.partial, 0);
    assert.deepEqual(result.failed, []);
    assert.equal(host.blobs.length, 0);
    assert.equal(await getExportRecord(key), null);
    assert.deepEqual(await readConversation(key), before);
    assert.ok(diagnostics.some(d => d.code === 'SOURCE_CONVERSATION_EMPTY'));
    assert.ok(!diagnostics.some(d => d.code === 'SOURCE_REFRESH_FAILED'));
});

test('unchanged exports with only attachment 404s skip before refreshing or acquiring resources', async t => {
    const host = v2ExportHost(t);
    await seedExportConversation('expired-only', 100);
    const key = exportKey('expired-only');
    const record: ExportRecord = { exportedAt: 200, chatTime: 100, format: 'markdown', status: 'partial',
        attachmentIssues: [{ resourceId: 'expired', name: 'Expired image', code: 'RESOURCE_SOURCE_EXPIRED', httpStatus: 404 }] };
    await putExportRecord(key, record);
    const originalFetch = GeminiProvider.prototype.fetchConversationDetail;
    GeminiProvider.prototype.fetchConversationDetail = async () => { assert.fail('404-only unchanged exports must not refresh'); };
    t.after(() => { GeminiProvider.prototype.fetchConversationDetail = originalFetch; });
    const result = await runExport({ ...exportRequest([key.conversationId]), skipUnchanged: true });
    assert.equal(result.skipped, 1);
    assert.equal(result.exported, 0);
    assert.equal(host.blobs.length, 0);
    assert.deepEqual(await getExportRecord(key), record);
});


test('batch delivery failure carries the same diagnostic to every affected item', async t => {
    v2ExportHost(t, () => { throw new Error('Browser download failed'); });
    const previousZip = __getZipConstructor();
    __setZipConstructor(require('../lib/jszip.min.js'));
    t.after(() => __setZipConstructor(previousZip));
    const ids = ['batch-failed-one', 'batch-failed-two'];
    for (const id of ids) await seedExportConversation(id);
    const updates: ExportItemUpdate[] = [];
    const result = await runExport(exportRequest(ids), { onItemUpdate: update => updates.push(update) });
    assert.deepEqual(result.failed, ids.map(exportKey));
    const failures = updates.filter(update => update.status === 'failed');
    assert.equal(failures.length, 2);
    for (const update of failures) {
        assert.equal(update.diagnostic.issue?.code, 'FILE_WRITE_FAILED');
        assert.equal(update.diagnostic.message, 'Browser download failed');
        assert.equal(await getExportRecord(update.key), null);
    }
});

for (const sourceTurn of ['unfinished', 'interrupted', 'handoff', 'awaiting_reply', 'tool_pending', 'unknown'] as const) {
    test(`${sourceTurn} source reply delivers all available text without marking missing body`, async t => {
        const host = v2ExportHost(t);
        const id = 'source-turn-' + sourceTurn;
        await seedExportConversation(id);
        const key = exportKey(id);
        const snapshot = { ...body('Earlier complete reply\n\n本批完成：Migration / Released 1.7\n\n已'),
            quality: { status: 'complete' as const, sourceTurn } };
        await ingestDetail(account.id, id, snapshot, { updatedAt: 200 });
        let refreshes = 0;
        t.mock.method(GeminiProvider.prototype, 'fetchConversationDetail', async () => {
            refreshes++; await ingestDetail(account.id, id, snapshot, { updatedAt: 200 });
        });
        const diagnostics: ExportDiagnostic[] = [];
        const result = await runExport(exportRequest([id]), { onDiagnostic: event => diagnostics.push(event) });
        assert.equal(result.exported, 1);
        assert.equal(result.partial, 0);
        assert.deepEqual(result.failed, []);
        assert.equal(host.blobs.length, 1);
        const markdown = await host.blobs[0].text();
        assert.match(markdown, /Earlier complete reply/);
        assert.match(markdown, /本批完成：Migration \/ Released 1.7/);
        assert.match(markdown, /已/);
        const record = await getExportRecord(key);
        assert.equal(record?.status, 'ok');
        assert.equal(record?.sourceTurn, sourceTurn);
        assert.equal(record?.otherContentMissing, undefined);
        assert.ok(diagnostics.some(d => d.code === 'SOURCE_TURN_' + sourceTurn.toUpperCase() && d.severity === 'info'));
        assert.ok(!diagnostics.some(d => d.code === 'DETAIL_NOT_COMPLETE'));
        // Timestamp disagreement is retained as freshness evidence, never fabricated body loss.
        assert.ok(diagnostics.some(d => d.code === 'DETAIL_STALE'));
        assert.equal(refreshes, 1);
        await runExport(exportRequest([id], { skipUnchanged: true }));
        assert.equal(refreshes, 2, 'unfinished/uncertain or stale source snapshots are refreshed on the next export');
    });
}

test('Work handoff card is physically delivered as readable Markdown with a successful export record', async t => {
    const host = v2ExportHost(t);
    const id = 'visible-work-handoff';
    await seedExportConversation(id);
    const raw = { id, title: 'Handoff', current_node: 'handoff', update_time: 0.1, mapping: {
        root: { id: 'root', children: ['question'] },
        question: { id: 'question', parent: 'root', children: ['handoff'], message: {
            id: 'message-question', author: { role: 'user' }, recipient: 'all',
            content: { content_type: 'text', parts: ['Review the repository'] } } },
        handoff: { id: 'handoff', parent: 'question', children: [], message: {
            id: 'message-handoff', author: { role: 'assistant' }, recipient: 'local.handoff',
            status: 'finished_successfully', end_turn: false,
            content: { content_type: 'code', language: 'json', text: JSON.stringify({
                reason: 'Work can inspect the repository and prepare the requested changes.',
                prompt: 'INTERNAL-WORK-PROMPT' }) } } },
    } };
    const snapshot = parseChatGPTConversation({ conversation: decodeChatGPTDetail(raw, id), assetsByNode: new Map() }).conversation.detail;
    await ingestDetail(account.id, id, snapshot, { updatedAt: 100 });
    t.mock.method(GeminiProvider.prototype, 'fetchConversationDetail', async () => {
        await ingestDetail(account.id, id, snapshot, { updatedAt: 100 });
    });
    const result = await runExport(exportRequest([id]));
    assert.equal(result.exported, 1);
    assert.equal(result.partial, 0);
    assert.deepEqual(result.failed, []);
    const markdown = await host.blobs[0].text();
    assert.match(markdown, /Review the repository/);
    assert.match(markdown, /Continue in ChatGPT Work/);
    assert.match(markdown, /Work can inspect the repository/);
    assert.doesNotMatch(markdown, /INTERNAL-WORK-PROMPT|"reason"/);
    const record = await getExportRecord(exportKey(id));
    assert.equal(record?.status, 'ok');
    assert.equal(record?.sourceTurn, 'handoff');
    assert.equal(record?.otherContentMissing, undefined);
});

for (const sourceTurn of ['finished', 'awaiting_reply', 'tool_pending', 'unknown'] as const) {
    test(`${sourceTurn} never turns actual incomplete body coverage into a successful full export`, async t => {
        const host = v2ExportHost(t);
        const id = 'incomplete-source-' + sourceTurn;
        await seedExportIndexOnly(id);
        const snapshot = { ...body('Available part only'), quality: { status: 'partial' as const, sourceTurn } };
        await ingestDetail(account.id, id, snapshot, { updatedAt: 200 });
        t.mock.method(GeminiProvider.prototype, 'fetchConversationDetail', async () => {
            await ingestDetail(account.id, id, snapshot, { updatedAt: 200 });
        });
        const diagnostics: ExportDiagnostic[] = [];
        const result = await runExport(exportRequest([id]), { onDiagnostic: event => diagnostics.push(event) });
        assert.equal(result.exported, 1);
        assert.equal(result.partial, 1);
        assert.deepEqual(result.failed, []);
        assert.match(await host.blobs[0].text(), /Available part only/);
        const record = await getExportRecord(exportKey(id));
        assert.equal(record?.status, 'partial');
        assert.equal(record?.otherContentMissing, true);
        assert.ok(diagnostics.some(d => d.code === 'DETAIL_NOT_COMPLETE' && d.severity === 'warning'));
    });
}
});

__suiteDescribe("local_attachment_reuse", () => {
for (const format of ['markdown', 'html', 'json'] as const) {
    test(`${format}: repeated folder export reuses same-name bytes and redownloads only deleted attachments`, async t => {
        const host = v2LiveSaveHost(t);
        const key = liveKey('reuse-chat');
        const assets: DomainAsset[] = [
            { id: 'image', kind: 'image', name: 'photo.png', mediaType: 'image/png', sourceUri: 'https://lh3.googleusercontent.com/photo.png' },
            { id: 'file', kind: 'file', name: 'notes.txt', mediaType: 'text/plain', sourceUri: 'https://example.test/notes.txt' },
        ];
        await seedLiveDetail(key.conversationId, assets);
        host.source('https://lh3.googleusercontent.com/photo.png', Uint8Array.of(1, 2, 3));
        host.source('https://example.test/notes.txt', Uint8Array.of(4, 5), 'text/plain');
        const request = { keys: [key], format, delivery: 'folderWriter' as const, includeAssets: true, skipUnchanged: false };
        assert.equal((await runExport(request)).partial, 0);
        assert.equal(host.requests.length, 2);
        const image = `assets/gemini/${key.accountId}/${key.conversationId}/photo.png`;
        const file = `files/gemini/${key.accountId}/${key.conversationId}/notes.txt`;
        assert.deepEqual(host.files.get(image), Uint8Array.of(1, 2, 3));
        assert.deepEqual(host.files.get(file), Uint8Array.of(4, 5));
        // Local edits are deliberately retained by the filename-only policy.
        host.files.set(image, Uint8Array.of(9));
        host.source('https://lh3.googleusercontent.com/photo.png', null);
        host.requests.length = 0; host.events.length = 0;
        await seedLiveDetail(key.conversationId, assets, { savedAt: 1700000001000, title: 'Updated title' });
        const progress: number[] = [];
        const repeated = await runExport(request, { onResourceProgress: value => progress.push(value.downloaded) });
        assert.equal(repeated.exported, 1); assert.equal(repeated.partial, 0);
        assert.deepEqual(host.requests, []);
        assert.deepEqual(host.files.get(image), Uint8Array.of(9));
        assert.ok(host.events.every(event => !event.endsWith(image) && !event.endsWith(file)));
        assert.ok(progress.every(downloaded => downloaded === 0));
        const body = [...host.files.values()].find((value): value is string => typeof value === 'string');
        assert.ok(body);
        assert.ok(body.includes(image));
        assert.ok(body.includes(file));
        assert.match(body, /Updated title/);
        assert.equal((await getExportRecord(key))?.status, 'ok');
        host.files.delete(file);
        const restored = await runExport(request);
        assert.equal(restored.exported, 1); assert.equal(restored.partial, 0);
        assert.deepEqual(host.requests, ['https://example.test/notes.txt']);
        assert.deepEqual(host.files.get(file), Uint8Array.of(4, 5));

        // A 0-byte crash stub left by an interrupted write must NOT be treated as reusable.
        host.requests.length = 0;
        host.files.set(file, new Uint8Array(0));
        const recovered = await runExport(request);
        assert.equal(recovered.exported, 1); assert.equal(recovered.partial, 0);
        assert.deepEqual(host.requests, ['https://example.test/notes.txt']);
        assert.deepEqual(host.files.get(file), Uint8Array.of(4, 5));
    });
}

test('putExportRecord atomically preserves an existing folderBaseName when a concurrent browserDownload export omits it', async t => {
    v2LiveSaveHost(t);
    const key = liveKey('concurrent-record');
    await putExportRecord(key, {
        format: 'markdown',
        status: 'ok',
        exportedAt: 100,
        chatTime: 100,
        folderBaseName: 'Original Title_abc123',
    });
    await putExportRecord(key, {
        format: 'pdf',
        status: 'ok',
        exportedAt: 200,
        chatTime: 100,
    });
    const merged = await getExportRecord(key);
    assert.equal(merged?.format, 'pdf');
    assert.equal(merged?.folderBaseName, 'Original Title_abc123');
});
});

__suiteDescribe("media-identity-delivery", () => {
/**
 * V2 integration regression: real L1 Gemini RPC / Takeout source facts, L2
 * snapshot selection, task-owned source bytes, Application resource preparation,
 * L3b composition and L4 packaging/delivery. An export never resurrects the
 * removed AssetPipeline or a persistent, cross-source Takeout media cache.
 */



















const account = fixtureAccount('gemini');
const key = { accountId: account.id, conversationId: mediaChatId };
const JSZip = require('../lib/jszip.min.js');

function useZip(t: TestContext): void {
    const previous = __getZipConstructor();
    __setZipConstructor(JSZip);
    t.after(() => __setZipConstructor(previous));
}

for (const [label, options] of [
    ['single generated image', {}],
    ['missing online generation time', { noTime: true }],
    ['missing online prompt', { noPrompt: true }],
    ['multiple generated images', { multi: true }],
    ['duplicate generation activity', { duplicate: true }],
] as const) {
    test('Takeout ' + label + ': source-bound bytes survive real v2 Markdown ZIP delivery', async t => {
        const host = v2ExportHost(t);
        useZip(t);
        const { online, offline } = mediaSources(options);
        const takeout = offline as GeminiTakeoutParseResult;
        const context = createSourceResourceContext();
        t.after(() => context.release());

        // The online source has different image identities/locators. They must
        // never be used to guess the ownership of the Takeout archive entries.
        const onlineIds = new Set(online.conversation.detail.assets.map(asset => asset.id));
        const admitted = await ingestDetail(key.accountId, key.conversationId,
            offline.conversation.detail, offline.conversation.index);
        assert.equal(admitted.accepted, true);
        context.retainParsed(key, offline);
        for (const [assetId, bound] of Object.entries(takeout.archiveResources)) {
            context.retain(key, assetId, async () => {
                const bytes = await readTakeoutBytes(bound.entry);
                if (!bytes) throw new Error('Empty Takeout entry');
                return { bytes };
            });
        }

        const stored = await readConversation(key);
        assert.ok(stored);
        assert.equal('archiveResources' in stored.detail, false);
        assert.equal('acquisitionHints' in stored.detail, false);
        const document = composeDomainDocument(stored, account);
        const refs = collectDocumentResources(document);
        const prepared = await prepareExportResources(stored.detail.assets, refs.referencedIds,
            (asset, signal) => context.acquire(key, asset, signal));
        const [plan] = planExportPaths([{ conversation: stored, prepared, fileIds: refs.fileIds }], 'markdown');
        const markdown = renderDocumentMarkdown(document, plan.resources);
        const files = buildExportFiles('markdown', plan, markdown, prepared);
        const delivered = await packageExportFiles([files], 'browserDownload');
        assert.equal(delivered.length, 1);
        await startBrowserDownload(delivered[0]);
        assert.equal(host.clicks(), 1);
        assert.match(host.filenames[0], /\.zip$/);

        const zip = await JSZip.loadAsync(await host.blobs[0].arrayBuffer());
        const body = zip.file(plan.fileName);
        assert.ok(body);
        assert.equal(await body.async('string'), markdown);

        const referencedArchive = Object.entries(takeout.archiveResources)
            .filter(([assetId]) => refs.referencedIds.has(assetId));
        assert.ok(referencedArchive.length > 0, 'at least one explicitly owned ZIP image remains referenced');
        for (const [assetId, bound] of referencedArchive) {
            assert.equal(onlineIds.has(assetId), false, 'no cross-source asset identity is guessed');
            assert.equal(prepared.get(assetId)?.ok, true);
            const destination = plan.resources[assetId];
            assert.ok(destination?.startsWith('assets/'));
            const entry = zip.file(destination);
            assert.ok(entry, 'the L4 path must be an actual delivered ZIP member');
            assert.deepEqual(await entry.async('uint8array'), await readTakeoutBytes(bound.entry));
            assert.ok(markdown.includes(destination), 'AST references the delivered path');
        }

        const generated = offline.conversation.detail.assets.find(asset => asset.generation?.prompt === mediaPrompt);
        assert.ok(generated);
        const source = takeout.archiveResources[generated.id];
        assert.ok(source);
        assert.match(source.path, /archive-0\.png$/);
        const matchingMember = zip.file(plan.resources[generated.id]);
        assert.ok(matchingMember);
        assert.deepEqual(await matchingMember.async('uint8array'), mediaBytes);
    });
}

test('a rejected Takeout snapshot cannot replace online Domain bytes or supply export sidecars', async t => {
    const host = v2ExportHost(t);
    useZip(t);
    const { online, offline } = mediaSources();
    const context = createSourceResourceContext();
    t.after(() => context.release());
    const first = await ingestDetail(key.accountId, key.conversationId,
        online.conversation.detail, online.conversation.index);
    assert.equal(first.accepted, true);
    context.retainParsed(key, online);

    // L2 selects complete online Detail instead of the partial Takeout
    // candidate. Only an accepted candidate may update this task's readers.
    const rejected = await ingestDetail(key.accountId, key.conversationId,
        offline.conversation.detail, offline.conversation.index);
    assert.equal(rejected.accepted, false);
    const stored = await readConversation(key);
    assert.ok(stored);
    const asset = stored.detail.assets[0];
    assert.ok(asset);
    assert.equal(asset.id, online.conversation.detail.assets[0].id);
    assert.equal(offline.conversation.detail.assets.some(item => item.id === asset.id), false);

    const onlineBytes = Uint8Array.of(12, 34, 56);
    const previousFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        urls.push(url);
        assert.equal(url, asset.sourceUri);
        return new Response(new Uint8Array(onlineBytes) as BodyInit,
            { status: 200, headers: { 'content-type': 'image/png' } });
    }) as typeof fetch;
    t.after(() => { globalThis.fetch = previousFetch; });

    const prepared = await prepareExportResources(stored.detail.assets, new Set([asset.id]),
        (candidate, signal) => context.acquire(key, candidate, signal, undefined, undefined, 'gemini'));
    assert.equal(prepared.get(asset.id)?.ok, true);
    const [plan] = planExportPaths([{ conversation: stored, prepared, fileIds: new Set<string>() }], 'json');
    const content = serializeDomainJson(stored, account, plan.resources);
    const files = buildExportFiles('json', plan, content, prepared);
    const delivered = await packageExportFiles([files], 'browserDownload');
    await startBrowserDownload(delivered[0]);
    assert.equal(host.clicks(), 1);
    assert.deepEqual(urls, [asset.sourceUri]);
    assert.equal(JSON.parse(content).resources[asset.id], plan.resources[asset.id]);
    const zip = await JSZip.loadAsync(await host.blobs[0].arrayBuffer());
    const bundled = zip.file(plan.resources[asset.id]);
    assert.ok(bundled);
    assert.deepEqual(await bundled.async('uint8array'), onlineBytes);
    assert.notDeepEqual(await bundled.async('uint8array'), mediaBytes);
});
});

__suiteDescribe("media-identity-persistence", () => {
useIndexStorage();







const key = { accountId: '10000000-0000-4000-8000-000000000001', conversationId: mediaChatId };
const commit = (source: SourceConversationParseResult) => ingestDetail(key.accountId, key.conversationId, source.conversation.detail, source.conversation.index);
for (const order of ['online-first', 'takeout-first'] as const) {
    test__s16(`L2 ${order}: source selection retains a complete body without importing acquisition bytes`, async () => {
        const { online, offline } = mediaSources();
        online.conversation.detail.quality.status = 'complete'; offline.conversation.detail.quality.status = 'partial';
        const snapshot = structuredClone(online.conversation.detail);
        if (order === 'online-first') await commit(online);
        await commit(offline);
        if (order === 'takeout-first') await commit(online);
        const stored = await readConversation(key); assert.ok(stored);
        assert.deepEqual(stored.detail, { ...snapshot, key });
        assert.equal('resources' in stored.detail, false); assert.equal('resourceDigests' in stored.detail, false);
        assert.equal('acquisitionHints' in stored, false); assert.equal('hasTakeoutImport' in stored.index, false);
        await commit(offline); assert.deepEqual((await readConversation(key))?.detail, stored.detail);
    });
}


test__s16('task resources isolate accounts and conversations; fresh tasks cannot recover a persistent byte cache', async () => {
    const { online } = mediaSources(); const asset = { ...online.conversation.detail.assets[0] }; delete asset.sourceUri;
    const context = createSourceResourceContext(), fresh = createSourceResourceContext();
    try {
        context.retain(key, asset.id, async () => ({ bytes: mediaBytes.slice() }));
        assert.deepEqual((await context.acquire(key, asset)).bytes, mediaBytes);
        await assert.rejects(context.acquire({ ...key, accountId: '10000000-0000-4000-8000-000000000002' }, asset), /locator/);
        await assert.rejects(context.acquire({ ...key, conversationId: 'other' }, asset), /locator/);
        await assert.rejects(fresh.acquire(key, asset), /locator/);
    } finally { context.release(); fresh.release(); }
});
test__s16('URI-less imported resources stay in task acquisition output while repeated L2 admission stays byte-free', async () => {
    const parsed = mediaSources().online, asset = parsed.conversation.detail.assets[0]; delete asset.sourceUri;
    parsed.acquisitionHints = { [asset.id]: { dataBase64: btoa(String.fromCharCode(...mediaBytes)) } };
    const context = createSourceResourceContext();
    try {
        context.retainParsed(key, parsed); await commit(parsed); const initial = await readConversation(key); assert.ok(initial);
        parsed.conversation.index.title = 'Continued conversation'; await commit(parsed);
        const continued = await readConversation(key); assert.ok(continued);
        assert.deepEqual(continued.detail, initial.detail);
        assert.deepEqual((await context.acquire(key, asset)).bytes, mediaBytes);
        assert.equal(JSON.stringify(continued).includes('dataBase64'), false);
        await ingestDeletedConversation(key.accountId, key.conversationId); assert.equal(await readConversation(key), null);
    } finally { context.release(); }
    await assert.rejects(context.acquire(key, asset), /released/);
});
test__s16('acquisition receipt/path changes never become Domain fields or change an idempotent Detail', async () => {
    const parsed = mediaSources().online; await commit(parsed); const first = await readConversation(key);
    const asset = parsed.conversation.detail.assets[0];
    parsed.acquisitionHints = { [asset.id]: { localName: 'archive/relocated.png', dataBase64: 'AQID' } };
    assert.deepEqual(await commit(parsed), { accepted: true, changed: false }); assert.deepEqual(await readConversation(key), first);
    assert.equal(JSON.stringify(first).includes('archive/relocated.png'), false);
});
});

__suiteDescribe("media-identity-source", () => {
test__s17('real RPC turns expose only source-authored event time/prompt and single-image position', () => {
    const { online, offline } = mediaSources();
    const onlineImage = online.conversation.detail.assets[0];
    const offlineImage = offline.conversation.detail.assets.find(a => a.generation?.prompt === mediaPrompt)!;
    assert.equal(onlineImage.generation?.time, mediaTime + 123);
    assert.equal(onlineImage.generation?.prompt, mediaPrompt);
    assert.equal(onlineImage.generation?.providerRequestId, 'r_request-9');
    assert.equal(onlineImage.generation?.imageCount, 1);
    assert.equal(onlineImage.generation?.imageOrdinal, 0);
    assert.notEqual(onlineImage.generation?.generationOrdinal, offlineImage.generation?.generationOrdinal);
    assert.notEqual(onlineImage.id, offlineImage.id);
    assert.notEqual(onlineImage.sourceUri, offlineImage.sourceUri);
    for (const options of [{ noTime: true }, { noPrompt: true }]) {
        const image = mediaSources(options).online.conversation.detail.assets[0];
        assert.equal(options.noTime ? image.generation?.time : image.generation?.prompt, undefined);
    }
    for (const image of mediaSources({ multi: true }).online.conversation.detail.assets) assert.equal(image.generation?.imageOrdinal, undefined, 'a traversal index is not a stable source ordinal');
});
});

__suiteDescribe("operation_errors", () => {
test('injected source readers serialize real HTTP and account failures across Chrome', async context => {
    const descriptors = ['chrome', 'document'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
    let status = 403;
    let calls = 0;
    context.mock.method(globalThis, 'fetch', async () => {
        calls++;
        return new Response(JSON.stringify({ userId: '22222222-2222-4222-8222-222222222222' }), { status });
    });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: '' } });
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
        permissions: { contains: async () => true },
        tabs: { query: async () => [{ id: 1 }, { id: 2 }] },
        scripting: { executeScript: async (injection: {
            func: (path: string, owner?: string | null, body?: { responseIds: string[] } | null) => Promise<unknown>;
            args: [string, (string | null)?, ({ responseIds: string[] } | null)?];
        }) => [{ result: JSON.parse(JSON.stringify(await injection.func(...injection.args))) }] },
    } });
    try {
        for (const read of [() => readClaudeSource('/api/organizations'), () => readGrokSource('/rest/auth/get-user')]) {
            for (const httpStatus of [403, 429]) {
                status = httpStatus;
                calls = 0;
                await assert.rejects(read(), error => error instanceof OperationError
                    && error.code === 'SOURCE_HTTP_ERROR' && error.httpStatus === httpStatus);
                assert.equal(calls, httpStatus === 429 ? 1 : 2, 'rate limits must stop tab retries');
            }
        }
        status = 200;
        await assert.rejects(readGrokSource('/rest/auth/get-user', '11111111-1111-4111-8111-111111111111'),
            error => error instanceof OperationError && error.code === 'ACCOUNT_CHANGED');
        Object.defineProperty(globalThis, 'document', { configurable: true,
            value: { cookie: 'lastActiveOrg=22222222-2222-4222-8222-222222222222' } });
        await assert.rejects(readClaudeSource('/api/organizations', '11111111-1111-4111-8111-111111111111'),
            error => error instanceof OperationError && error.code === 'ACCOUNT_CHANGED');
    } finally {
        for (const [name, descriptor] of descriptors) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
    }
});

test('known causes survive boundary wrapping; unknown text never invents an HTTP status or reason', () => {
    const error = new OperationError('SOURCE_HTTP_ERROR', 'HTTP 403 for conversation abc', 403);
    assert.equal(operationError(error, 'FILE_WRITE_FAILED'), error);
    assert.deepEqual(operationIssue(error), { code: 'SOURCE_HTTP_ERROR', message: error.message, httpStatus: 403 });
    assert.deepEqual(operationIssue(new Error('HTTP 429: login expired')), { code: 'UNKNOWN_ERROR', message: 'HTTP 429: login expired' });
    assert.deepEqual(operationIssue({ arbitrary: true }), { code: 'UNKNOWN_ERROR', message: 'Unknown error' });
    assert.equal(operationIssue(operationError(new Error('close failed'), 'FILE_WRITE_FAILED')).code, 'FILE_WRITE_FAILED');
});

test('Chrome source execution decodes structured HTTP/account failures and rejects invalid envelopes', () => {
    assert.deepEqual(readSourceExecution({ ok: true, value: { data: 1 } }), { data: 1 });
    for (const code of ['SOURCE_HTTP_ERROR', 'ACCOUNT_CHANGED']) {
        assert.throws(() => readSourceExecution({ ok: false, issue: { code, message: 'native fact', httpStatus: 403 } }),
            error => error instanceof OperationError && error.code === code && error.httpStatus === 403);
    }
    for (const invalid of [null, {}, { code: 'made_up', message: 'x' }, { code: 'SOURCE_HTTP_ERROR', message: 'x', httpStatus: '403' }])
        assert.equal(readOperationIssue(invalid), null);
    assert.throws(() => readSourceExecution({ ok: false, issue: { code: 'made_up', message: 'x' } }),
        error => error instanceof OperationError && error.code === 'SOURCE_RESPONSE_INVALID');
});

test('resource preparation retains typed failures and actual HTTP statuses without consuming cancellation', async () => {
    const http = await attemptResource('img', async () => { throw new ResourceHttpError(404); });
    assert.equal(http.ok, false);
    if (!http.ok) assert.deepEqual(http.issue, { code: 'RESOURCE_SOURCE_EXPIRED', message: 'Resource request failed: HTTP 404', httpStatus: 404 });
    const size = await attemptResource('file', async () => { throw new OperationError('RESOURCE_SIZE_LIMIT', 'limit exceeded'); });
    assert.equal(size.ok, false);
    if (!size.ok) assert.equal(size.issue?.code, 'RESOURCE_SIZE_LIMIT');
    await assert.rejects(attemptResource('cancel', async () => { throw new DOMException('cancelled', 'AbortError'); }), /cancelled/);
});
});

__suiteDescribe("partial_retry", () => {
/**
 * Real v2 Live Save / Export partial-retry behavior:
 * L2 Detail -> L3a Index/Detail -> L1 resource -> Application -> L3b/L4
 * Folder Writer -> committed minimal ExportRecord. External disk and HTTP only
 * are simulated. The v1 asset Base64, 'hasFailedAssets' and StorageService
 * APIs were intentionally removed.
 */








const png = (id: string, url: string) => ({ id, kind: 'image' as const,
    name: id + '.png', sourceUri: url, mediaType: 'image/png' });
const request = (id: string) => ({ keys: [liveKey(id)], format: 'markdown' as const,
    delivery: 'folderWriter' as const, includeAssets: true, skipUnchanged: true });
function markdown(files: Map<string, string | Uint8Array>): string {
    const result = [...files.entries()].find(([name]) => name.endsWith('.md') && !name.startsWith('files/'));
    assert.ok(result, 'the real folder writer must have saved Markdown');
    assert.equal(typeof result[1], 'string');
    return result[1] as string;
}

test('Live Save: unavailable bytes write readable partial Markdown, remain retryable at the same source version, then recover', async t => {
    const host = v2LiveSaveHost(t), id = 'retry-image', url = 'https://lh3.googleusercontent.com/retry.png';
    await seedLiveDetail(id, [png('image', url)], { title: 'Attachment retry' });
    host.source(url, null);

    const first = await runLiveSave(liveKey(id));
    assert.ok(first);
    assert.equal(first.exported, 1);
    assert.equal(first.partial, 1);
    assert.deepEqual(first.failed, []);
    assert.match(markdown(host.files), /Answer for retry-image/);
    assert.match(markdown(host.files), /\[Open source\]\(https:\/\/lh3\.googleusercontent\.com\/retry\.png\)/);
    assert.doesNotMatch(markdown(host.files), /!\[[^\]]*\]\(https:/);
    assert.equal([...host.files.keys()].filter(name => name.startsWith('assets/')).length, 0);
    assert.equal((await getExportRecord(liveKey(id)))?.status, 'partial');
    assert.deepEqual(Object.keys(await listExportRecords(liveKey(id).accountId)), [id]);

    // SkipUnchanged applies only to a matching 'ok' record, never a partial.
    const stillFailed = await runExport(request(id));
    assert.equal(stillFailed.skipped, 0);
    assert.equal(stillFailed.exported, 1);
    assert.equal(stillFailed.partial, 1);

    const bytes = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 9, 8, 7);
    host.source(url, bytes);
    const recovered = await runLiveSave(liveKey(id));
    assert.ok(recovered);
    assert.equal(recovered.exported, 1);
    assert.equal(recovered.partial, 0);
    assert.equal((await getExportRecord(liveKey(id)))?.status, 'ok');

    const asset = [...host.files.entries()].find(([name]) => name.startsWith('assets/') && name.endsWith('.png'));
    assert.ok(asset);
    assert.deepEqual(asset[1], bytes);
    assert.ok(markdown(host.files).includes(asset[0]), 'recovered Markdown uses its actual saved asset path');
    const unchanged = await runExport(request(id));
    assert.equal(unchanged.skipped, 1);
    assert.equal(unchanged.exported, 0);
    assert.equal(Object.keys(await listExportRecords(liveKey(id).accountId)).length, 1);
});

test('Live Save: local attachments survive source failure, while deleted attachments remain retryable', async t => {
    const host = v2LiveSaveHost(t), id = 'source-regressed', url = 'https://lh3.googleusercontent.com/dynamic.png';
    await seedLiveDetail(id, [png('fresh-image', url)]);
    host.source(url, Uint8Array.of(12, 34, 56));
    const first = await runLiveSave(liveKey(id));
    assert.equal(first?.exported, 1);
    assert.equal(first?.partial, 0);
    assert.equal((await getExportRecord(liveKey(id)))?.status, 'ok');

    host.source(url, null);
    const second = await runLiveSave(liveKey(id));
    assert.equal(second?.exported, 1, 'Live Save is triggered by accepted Detail changes, not by skipUnchanged');
    assert.equal(second?.partial, 0);
    assert.equal((await getExportRecord(liveKey(id)))?.status, 'ok');
    assert.match(markdown(host.files), /assets\//, 'existing local bytes remain usable when their source expires');
    assert.deepEqual(host.requests, [url], 'the existing file bypasses reacquisition');
    for (const path of host.files.keys()) if (path.startsWith('assets/')) host.files.delete(path);
    const missing = await runLiveSave(liveKey(id));
    assert.equal(missing?.partial, 1);
    assert.equal((await getExportRecord(liveKey(id)))?.status, 'partial');
    assert.doesNotMatch(markdown(host.files), /assets\//, 'a missing local file with an unavailable source cannot retain a dangling link');
    const pending = await runExport(request(id));
    assert.equal(pending.skipped, 0);
    assert.equal(pending.partial, 1);
});

test('Live Save: an L4 folder-sidecar write error preserves a written Markdown file but never commits a successful record', async t => {
    const host = v2LiveSaveHost(t), id = 'disk-fails', url = 'https://lh3.googleusercontent.com/disk.png';
    await seedLiveDetail(id, [png('image', url)]);
    host.source(url, Uint8Array.of(1, 2, 3, 4));
    host.failWrite('assets/');
    const failed = await runLiveSave(liveKey(id));
    assert.ok(failed);
    assert.equal(failed.exported, 0);
    assert.deepEqual(failed.failed, [liveKey(id)]);
    assert.equal(await getExportRecord(liveKey(id)), null);
    assert.ok([...host.files.keys()].some(name => name.endsWith('.md')));
    assert.ok(![...host.files.keys()].some(name => name.startsWith('assets/')));
    assert.ok(host.events.some(event => event.startsWith('abort:assets/')));

    host.failWrite(null);
    const retried = await runLiveSave(liveKey(id));
    assert.equal(retried?.exported, 1);
    assert.equal(retried?.partial, 0);
    assert.equal((await getExportRecord(liveKey(id)))?.status, 'ok');
    assert.ok([...host.files.keys()].some(name => name.startsWith('assets/')));
});

test('Live Save: a missing or revoked directory prompts reauthorization without asking permission in the Worker', async t => {
    const host = v2LiveSaveHost(t), id = 'permission';
    await seedLiveDetail(id);
    host.directory(null);
    await assert.rejects(runLiveSave(liveKey(id)), /Choose a Live Save directory in Options/);
    host.directory(host.root);
    host.permission('prompt');
    await assert.rejects(runLiveSave(liveKey(id)), /Reauthorize the Live Save directory in Options/);
    assert.equal(host.requestCount(), 0);
    assert.equal(host.queryCount(), 1);
    assert.equal(host.files.size, 0);
    assert.equal(await getExportRecord(liveKey(id)), null);
    assert.equal((await getSettings()).enabledDisk, true, 'intention is retained for explicit reauthorization');
});

test('Live Save: disabled intention or non-Markdown format does not touch the directory or create records', async t => {
    const host = v2LiveSaveHost(t), id = 'paused-live';
    await seedLiveDetail(id);
    await updateSettings({ enabledDisk: false });
    assert.equal(await runLiveSave(liveKey(id)), null);
    await updateSettings({ enabledDisk: true, defaultFormat: 'pdf' });
    assert.equal(await runLiveSave(liveKey(id)), null);
    await updateSettings({ defaultFormat: 'html' });
    assert.equal(await runLiveSave(liveKey(id)), null);
    assert.equal(host.queryCount(), 0);
    assert.equal(host.requestCount(), 0);
    assert.equal(host.files.size, 0);
    assert.equal(await getExportRecord(liveKey(id)), null);
});
});

__suiteDescribe("resource-delivery", () => {
/**
 * V2 cross-module resource delivery: L2 facts -> L3a -> L1 acquisition ->
 * Application preparation -> L3b composition -> L4 packaging/delivery.
 * The deleted ExportOrchestrator, AssetPipeline, ChatFormatter, PDF stages and
 * Takeout media cache are not integration boundaries. Mock browser HTTP,
 * Chrome account-route IPC and the external PDF compiler only.
 */




















const JSZip = require('../lib/jszip.min.js');
const account = fixtureAccount('gemini');
const png = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 9, 8, 7, 6);
const goodUri = 'https://lh3.googleusercontent.com/good.png';
const badUri = 'https://lh3.googleusercontent.com/bad.png';
const paragraph = (text: string) => ({ type: 'paragraph' as const, children: [{ type: 'text' as const, text }] });
const image = (id: string, uri: string, name = id + '.png'): DomainAsset => ({
    id, kind: 'image', name, sourceUri: uri, mediaType: 'image/png',
});
async function seed(id: string, assets: DomainAsset[] = [
    image('good', goodUri), image('bad', badUri),
], unreferenced: DomainAsset[] = []) {
    const fileIds = assets.filter(asset => asset.kind !== 'image').map(asset => asset.id);
    await ingestDetail(account.id, id, {
        savedAt: 100, quality: { status: 'complete' }, assets: [...assets, ...unreferenced],
        messages: [{
            role: 'assistant',
            content: [paragraph('Conversation survives resource failure'),
                ...assets.filter(asset => asset.kind === 'image').map(asset => ({
                    type: 'image' as const, assetId: asset.id, alt: asset.name,
                }))],
            ...(fileIds.length ? { attachmentIds: fileIds } : {}),
        }],
    }, { title: 'Resources ' + id, titleSource: 'provider', updatedAt: 100 });
}
function useZip(t: TestContext) {
    const old = __getZipConstructor();
    __setZipConstructor(JSZip);
    t.after(() => __setZipConstructor(old));
}
function network(t: TestContext, get: (url: string, signal?: AbortSignal) => Response | Promise<Response>) {
    const previousFetch = globalThis.fetch;
    // Keep the exact Chrome host instance; v2ExportHost may restore the global
    // before this test-specific network teardown runs.
    const chrome = globalThis.chrome;
    const previousTabs = Object.getOwnPropertyDescriptor(chrome, 'tabs');
    const requests: string[] = [];
    Object.defineProperty(chrome, 'tabs', { configurable: true, value: {
        query: async () => [{ id: 21, url: 'https://gemini.google.com/app/resource' }],
        sendMessage: async () => ({ ok: true, accountContext: {
            accountId: account.id, providerId: 'gemini', slot: 'u0',
        } }),
    } });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        requests.push(url);
        return await get(url, init?.signal ?? undefined);
    }) as typeof fetch;
    t.after(() => {
        globalThis.fetch = previousFetch;
        if (previousTabs) Object.defineProperty(chrome, 'tabs', previousTabs);
        else Reflect.deleteProperty(chrome, 'tabs');
    });
    return requests;
}
function response(bytes: Uint8Array, type = 'image/png') {
    return new Response(new Uint8Array(bytes) as BodyInit, { status: 200,
        headers: { 'content-type': type } });
}

for (const format of ['markdown', 'html', 'json'] as const) for (const failure of ['throw', 'empty', 'http'] as const) {
    test(format + ': ' + failure + ' keeps healthy binary bytes and commits a partial ExportRecord after ZIP delivery', async t => {
        const host = v2ExportHost(t); useZip(t);
        const id = 'delivery-' + format + '-' + failure;
        await seed(id);
        const requests = network(t, url => {
            if (url.startsWith('https://gemini.google.com/')) return new Response(null, { status: 503 });
            if (url === goodUri) return response(png);
            if (url === badUri) {
                if (failure === 'throw') throw new Error('Source transport unavailable');
                if (failure === 'empty') return response(new Uint8Array());
                return new Response(null, { status: 404 });
            }
            throw new Error('Unexpected resource URL: ' + url);
        });
        const original = await readConversation(exportKey(id));
        const result = await runExport(exportRequest([id], { format, includeAssets: true }));
        assert.equal(result.aborted, false);
        assert.equal(result.exported, 1);
        assert.equal(result.partial, 1);
        assert.deepEqual(result.failed, []);
        assert.deepEqual(requests.filter(url => !url.startsWith('https://gemini.google.com/')), [goodUri, badUri],
            'the L1 provider acquires only requested resources');
        assert.equal(requests.filter(url => url.startsWith('https://gemini.google.com/')).length, failure === 'http' ? 1 : 0,
            'only an actual expiry response triggers one background refresh; failed refresh preserves healthy bytes');
        assert.equal(host.clicks(), 1);
        assert.match(host.filenames[0], /\.zip$/);
        const files = await readDeliveredFiles(host);
        const main = files.find(file => file.name.endsWith(format === 'markdown' ? '.md' : format === 'html' ? '.html' : '.json'));
        assert.ok(main);
        const body = String(await main.async('string'));
        assert.match(body, /Conversation survives resource failure/);
        const sidecars = files.filter(file => file.name.startsWith('assets/'));
        assert.equal(sidecars.length, 1);
        assert.deepEqual(await sidecars[0].async('uint8array'), png);
        if (format === 'json') {
            const archive = JSON.parse(body);
            assert.equal(archive.conversation.detail.quality.status, 'complete');
            assert.ok(archive.resources.good);
            assert.equal(archive.resources.bad, undefined, 'the final corrected document excludes failed bindings');
        } else {
            assert.ok(body.includes(sidecars[0].name), 'body references an actually packaged image');
            assert.match(body, {throw:/Attachment failed: Unknown error/,empty:/Attachment could not be processed/,http:/Source attachment unavailable.*HTTP 404/}[failure]);
            assert.match(body, /https:\/\/lh3\.googleusercontent\.com\/bad\.png/, 'retain a source link for inspection');
            assert.doesNotMatch(body, /src="https:\/\/lh3\.googleusercontent\.com\/bad\.png|!\[[^\]]*\]\(https:\/\/lh3\.googleusercontent\.com\/bad\.png/, 'never embed a broken remote image');
        }
        const record = await getExportRecord(exportKey(id));
        assert.equal(record?.status, 'partial');
        assert.equal(record?.format, format);
        assert.equal(record?.chatTime, 100);
        assert.deepEqual(await readConversation(exportKey(id)), original, 'resource failures cannot rewrite stored Domain');
    });
}

for (const format of ['markdown', 'html', 'json'] as const) {
    test(format + ': includeAssets=false skips acquisition and delivers a complete main file without a ZIP', async t => {
        const host = v2ExportHost(t);
        const id = 'without-assets-' + format;
        await seed(id);
        const before = await readConversation(exportKey(id));
        const requests = network(t, () => { throw new Error('No resource should be fetched'); });
        const result = await runExport(exportRequest([id], { format, includeAssets: false }));
        assert.equal(result.exported, 1);
        assert.equal(result.partial, 0);
        assert.deepEqual(result.failed, []);
        assert.deepEqual(requests, []);
        assert.equal(host.clicks(), 1);
        const extension = { markdown: '.md', html: '.html', json: '.json' }[format];
        assert.ok(host.filenames[0].endsWith(extension));
        assert.equal(host.blobs.length, 1);
        const body = await host.blobs[0].text();
        assert.match(body, /Conversation survives resource failure/);
        if (format === 'json') {
            const archive = JSON.parse(body);
            assert.equal(archive.conversation.detail.assets.length, 2);
            assert.deepEqual(archive.resources, {});
        } else {
            assert.match(body, /unavailable/i, 'AST resource nodes remain readable without bytes');
            assert.doesNotMatch(body, /src="assets\/|!\[[^\]]+\]\(assets\//);
        }
        assert.equal((await getExportRecord(exportKey(id)))?.status, 'ok');
        assert.deepEqual(await readConversation(exportKey(id)), before);
    });
}

for (const format of ['markdown', 'json'] as const) {
    test(format + ': resource selection uses AST references for reading formats and all Domain assets for JSON', async t => {
        const host = v2ExportHost(t); useZip(t);
        const id = 'unreferenced-resource-' + format;
        const orphanUri = 'https://source.example.test/orphan.txt';
        const orphanBytes = new TextEncoder().encode('Unreferenced original');
        await seed(id, [image('good', goodUri)], [
            { id: 'orphan', kind: 'file', name: 'orphan.txt', mediaType: 'text/plain', sourceUri: orphanUri },
        ]);
        const requests = network(t, url => {
            if (url === goodUri) return response(png);
            if (url === orphanUri) return response(orphanBytes, 'text/plain');
            throw new Error('Unexpected resource URL: ' + url);
        });
        const result = await runExport(exportRequest([id], { format, includeAssets: true }));
        assert.equal(result.exported, 1);
        assert.equal(result.partial, 0);
        assert.deepEqual(result.failed, []);
        assert.deepEqual(requests, format === 'json' ? [goodUri, orphanUri] : [goodUri]);
        assert.equal(host.clicks(), 1);
        assert.match(host.filenames[0], /\.zip$/);
        const files = await readDeliveredFiles(host);
        const main = files.find(file => file.name.endsWith(format === 'json' ? '.json' : '.md'));
        assert.ok(main);
        const body = String(await main.async('string'));
        const orphan = files.find(file => file.name.includes('orphan.txt'));
        if (format === 'json') {
            const archive = JSON.parse(body);
            assert.equal(archive.conversation.detail.assets.length, 2);
            assert.ok(archive.resources.good);
            assert.equal(archive.resources.orphan, orphan?.name);
            assert.deepEqual(await orphan?.async('uint8array'), orphanBytes);
        } else {
            assert.equal(orphan, undefined);
            assert.doesNotMatch(body, /orphan\.txt/);
        }
        assert.equal((await getExportRecord(exportKey(id)))?.status, 'ok');
    });
}

test('L4 Markdown/HTML never emit a local sidecar link until an acquisition result has a planned binding', async t => {
    v2ExportHost(t);
    const id = 'unbound-resource';
    await seed(id, [image('unavailable', badUri)]);
    const conversation = await readConversation(exportKey(id));
    assert.ok(conversation);
    const document = composeDomainDocument(conversation, account);
    const refs = collectDocumentResources(document);
    const prepared = await prepareExportResources(conversation.detail.assets, refs.referencedIds,
        async () => { throw new Error('HTTP 404'); });
    const [plan] = planExportPaths([{ conversation, prepared, fileIds: refs.fileIds }], 'markdown');
    assert.deepEqual(Object.keys(plan.resources), []);
    const markdown = renderDocumentMarkdown(document, plan.resources);
    const html = renderDocumentHtml(document, plan.resources).html;
    assert.match(markdown, /unavailable/i);
    assert.match(html, /unavailable/i);
    assert.doesNotMatch(markdown, /assets\/[^)\s]+/);
    assert.doesNotMatch(html, /src="assets\//);
    assert.equal(prepared.get('unavailable')?.ok, false);
});

test('a file companion uses its original L1 bytes in the real ZIP files/ namespace', async t => {
    const host = v2ExportHost(t); useZip(t);
    const id = 'file-companion';
    const uri = 'https://source.example.test/notes.md', bytes = new TextEncoder().encode('# Original file bytes');
    await seed(id, [{ id: 'notes', kind: 'file', name: 'notes.md',
        mediaType: 'text/markdown', sourceUri: uri, document: { contentMarkdown: '# Derived preview' } }]);
    const calls = network(t, url => {
        assert.equal(url, uri);
        return response(bytes, 'text/markdown');
    });
    const result = await runExport(exportRequest([id], { format: 'markdown', includeAssets: true }));
    assert.equal(result.exported, 1);
    assert.equal(result.partial, 0);
    assert.deepEqual(calls, [uri]);
    const files = await readDeliveredFiles(host);
    const original = files.find(file => file.name.startsWith('files/') && file.name.endsWith('notes.md'));
    assert.ok(original);
    assert.deepEqual(await original.async('uint8array'), bytes);
    const main = files.find(file => !file.name.startsWith('files/') && file.name.endsWith('.md'));
    assert.ok(main);
    assert.ok(String(await main.async('string')).includes(original.name));
    assert.equal((await getExportRecord(exportKey(id)))?.status, 'ok');
});

test('failed Browser Download start does not commit an ExportRecord', async t => {
    const host = v2ExportHost(t, () => { throw new Error('Download start failed'); }); useZip(t);
    const id = 'delivery-start-failed';
    await seed(id, [image('good', goodUri)]);
    const requests = network(t, url => {
        assert.equal(url, goodUri);
        return response(png);
    });
    const result = await runExport(exportRequest([id], { includeAssets: true }));
    assert.equal(result.aborted, false);
    assert.equal(result.exported, 0);
    assert.equal(result.partial, 0);
    assert.deepEqual(result.failed, [exportKey(id)]);
    assert.deepEqual(requests, [goodUri]);
    assert.equal(host.clicks(), 1);
    assert.equal(await getExportRecord(exportKey(id)), null);
});

test('ordinary transport exceptions remain per-asset failures', async () => {
    const result = await attemptResource('rejected', async () => { throw new Error('Resource request failed'); });
    assert.deepEqual(result, missingResource('rejected', 'Resource request failed'));
});

test('cancel during L1 acquisition preserves the delivered body without committing a full ExportRecord', async t => {
    const host = v2ExportHost(t), id = 'cancel-media';
    await seed(id, [image('pending', badUri)]);
    let started!: () => void;
    const awaited = new Promise<void>(resolve => { started = resolve; });
    network(t, async (_url, signal) => {
        started();
        return await new Promise<Response>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(signal.reason ?? new DOMException('Cancelled', 'AbortError')), { once: true });
        });
    });
    const controller = new AbortController();
    const pending = runExport(exportRequest([id], { includeAssets: true }), { signal: controller.signal });
    await awaited;
    assert.equal(host.clicks(), 0);
    controller.abort();
    const result = await pending;
    assert.equal(result.aborted, true);
    assert.equal(result.exported, 0);
    assert.deepEqual(result.failed, []);
    assert.equal(host.clicks(), 1);
    assert.match(await host.blobs[0].text(), /Conversation survives resource failure/);
    assert.equal(await getExportRecord(exportKey(id)), null);
});

test('long near-colliding media names get distinct actual ZIP paths and correct bytes', async t => {
    const host = v2ExportHost(t); useZip(t);
    const id = 'near-colliding-assets';
    const longName = 'same-repeated-segment-'.repeat(8);
    const assets = [
        image('first', 'https://lh3.googleusercontent.com/one.png', longName + 'first.png'),
        image('second', 'https://lh3.googleusercontent.com/two.png', longName + 'second.png'),
    ];
    await seed(id, assets);
    const calls = network(t, url => response(url.includes('/one.png') ? Uint8Array.of(1, 2) : Uint8Array.of(9, 8, 7)));
    const result = await runExport(exportRequest([id], { includeAssets: true }));
    assert.equal(result.exported, 1);
    assert.equal(result.partial, 0);
    assert.equal(calls.length, 2);
    const files = await readDeliveredFiles(host);
    const assetsWritten = files.filter(file => file.name.startsWith('assets/'));
    assert.equal(assetsWritten.length, 2);
    assert.equal(new Set(assetsWritten.map(file => file.name.toLowerCase())).size, 2);
    const bytes = await Promise.all(assetsWritten.map(file => file.async('uint8array')));
    assert.ok(bytes.some(value => Buffer.from(value as Uint8Array).equals(Buffer.from([1, 2]))));
    assert.ok(bytes.some(value => Buffer.from(value as Uint8Array).equals(Buffer.from([9, 8, 7]))));
    const main = files.find(file => file.name.endsWith('.md'));
    assert.ok(main);
    const body = String(await main.async('string'));
    for (const asset of assetsWritten) assert.ok(body.includes(asset.name));
    assert.equal((await getExportRecord(exportKey(id)))?.status, 'ok');
});

test('PDF Image/File dual-use resource is acquired once, embedded, and delivered as one original file', async t => {
    v2ExportHost(t);
    const id = 'pdf-dual-use';
    await ingestDetail(account.id, id, {
        savedAt: 100, quality: { status: 'complete' },
        assets: [image('both', goodUri)],
        messages: [{ role: 'assistant', content: [
            { type: 'image', assetId: 'both', alt: 'Embedded image' },
            { type: 'file', assetId: 'both', label: 'Original image file' },
        ] }],
    }, { title: 'Dual-use PDF', titleSource: 'provider', updatedAt: 100 });
    const conversation = await readConversation(exportKey(id));
    assert.ok(conversation);
    const document = composeDomainDocument(conversation, account);
    const refs = collectDocumentResources(document);
    assert.deepEqual([...refs.referencedIds], ['both']);
    assert.deepEqual([...refs.imageIds], ['both']);
    assert.deepEqual([...refs.fileIds], ['both']);
    let requests = 0;
    const prepared = await prepareExportResources(conversation.detail.assets, refs.referencedIds,
        async () => { requests++; return { bytes: png, mediaType: 'image/png' }; });
    const [plan] = planExportPaths([{ conversation, prepared, fileIds: refs.fileIds }], 'pdf');
    assert.equal(plan.externalResourceIds.has('both'), true);
    const compiler: IPdfCompiler = { name: 'PDF compiler host probe',
        async compile(payload, context) {
            assert.equal(payload.assetPaths.get('both'), plan.resources.both);
            assert.deepEqual((await context.assets.resolve('both'))?.bytes, png);
            return { pdfBytes: fakePdfBytes(), diagnostics: [] };
        },
    };
    const pdf = await compileDocumentPdf(document, plan.resources, prepared, compiler,
        { signal: new AbortController().signal, reportProgress() {} });
    assert.ok(!pdf.diagnostics.some(diagnostic => diagnostic.code === 'FORMAT_CONTENT_OMITTED'));
    const files = buildExportFiles('pdf', plan, pdf.pdfBytes, prepared);
    assert.equal(files.length, 2);
    assert.equal(files[1].fileName, plan.resources.both);
    assert.deepEqual(files[1].content, png);
    assert.equal(requests, 1);
});

function fakePdfBytes() {
    const bytes = new Uint8Array(100);
    bytes.set(new TextEncoder().encode('%PDF-1.7'));
    return bytes;
}
async function pdfPreparation(id: string, corruptBadImage = false) {
    await seed(id);
    const conversation = await readConversation(exportKey(id));
    assert.ok(conversation);
    const document = composeDomainDocument(conversation, account);
    const refs = collectDocumentResources(document);
    const acquisitions: string[] = [];
    const prepared = await prepareExportResources(conversation.detail.assets, refs.referencedIds, async asset => {
        acquisitions.push(asset.id);
        return { bytes: asset.id === 'good' ? png
            : corruptBadImage ? Uint8Array.of(1, 2, 3)
                : Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 1, 2),
            mediaType: 'image/png', name: asset.name };
    });
    const [plan] = planExportPaths([{ conversation, prepared, fileIds: refs.fileIds }], 'pdf');
    return { document, prepared, plan, acquisitions };
}

test('PDF uses the canonical Packaging image path and reports corrupt acquired bytes as Format omission', async t => {
    v2ExportHost(t);
    const { document, prepared, plan, acquisitions } = await pdfPreparation('pdf-image-validation', true);
    assert.equal(prepared.get('bad')?.ok, true, 'acquisition succeeded; the failure belongs to PDF Format');
    let compiles = 0;
    const compiler: IPdfCompiler = { name: 'PDF compiler host probe',
        async compile(payload, context) {
            compiles++;
            assert.deepEqual([...payload.assetPaths.keys()], ['good']);
            assert.equal(payload.assetPaths.get('good'), plan.resources.good);
            assert.deepEqual((await context.assets.resolve('good'))?.bytes, png);
            assert.equal(await context.assets.resolve('bad'), null);
            assert.match(JSON.stringify(payload.document), /missing-image/);
            return { pdfBytes: fakePdfBytes(), diagnostics: [] };
        },
    };
    const pdf = await compileDocumentPdf(document, plan.resources, prepared, compiler,
        { signal: new AbortController().signal, reportProgress() {} });
    assert.equal(compiles, 1);
    assert.deepEqual(acquisitions, ['good', 'bad'], 'Format does not reacquire resources');
    assert.equal(String.fromCharCode(...pdf.pdfBytes.subarray(0, 5)), '%PDF-');
    assert.ok(pdf.diagnostics.some(diagnostic =>
        diagnostic.code === 'FORMAT_CONTENT_OMITTED' && diagnostic.path === 'asset:bad'));
});

test('an unrelated PDF compiler error remains fatal and never becomes a recoverable asset failure', async t => {
    v2ExportHost(t);
    const { document, prepared, plan } = await pdfPreparation('pdf-fatal');
    let calls = 0;
    const compiler: IPdfCompiler = { name: 'PDF compiler host probe',
        async compile() { calls++; throw new Error('Typst document compile error'); },
    };
    await assert.rejects(compileDocumentPdf(document, plan.resources, prepared, compiler,
        { signal: new AbortController().signal, reportProgress() {} }), /Typst document compile error/);
    assert.equal(calls, 1);
});
});

__suiteDescribe("search_image_export", () => {
test('search image export acquires bytes from the extension context and writes the actual image', async t => {
    const host = v2LiveSaveHost(t), key = liveKey('search');
    const url = 'https://encrypted-tbn2.gstatic.com/licensed-image?q=test';
    const bytes = Uint8Array.of(1, 2, 3);
    await seedLiveDetail(key.conversationId, [{ id: 'search-image', kind: 'image', name: 'search.png', sourceUri: url }]);
    host.source(url, bytes);
    assert.equal((await runLiveSave(key))?.exported, 1);
    assert.deepEqual(host.requests, [url]);
    const asset = [...host.files.entries()].find(([name]) => name.startsWith('assets/') && name.endsWith('search.png'));
    assert.ok(asset); assert.deepEqual(asset[1], bytes);
    assert.ok([...host.files.values()].some(value => typeof value === 'string' && value.includes(asset[0])));
    assert.equal((await getExportRecord(key))?.status, 'ok');
});
test('missing search images preserve the HTTP error and never create a fake successful asset', async t => {
    const host = v2LiveSaveHost(t), key = liveKey('missing-search');
    const url = 'https://encrypted-tbn2.gstatic.com/licensed-image?q=missing';
    await seedLiveDetail(key.conversationId, [{ id: 'missing', kind: 'image', sourceUri: url }]);
    t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }));
    const results = await prepareExportResources([{ id: 'missing', kind: 'image', sourceUri: url }], new Set(['missing']),
        (asset, signal) => acquireSourceResource(asset, signal, undefined, 'gemini'));
    const failure = results.get('missing');
    assert.ok(failure && !failure.ok);
    assert.match(failure.reason, /404/);
    const result = await runLiveSave(key);
    assert.equal(result?.partial, 1);
    assert.equal([...host.files.keys()].some(name => name.startsWith('assets/')), false);
    assert.equal((await getExportRecord(key))?.status, 'partial');
});

test('Live Save keeps external image links as placeholders without requesting their bytes', async t => {
    const host = v2LiveSaveHost(t), key = liveKey('external-image');
    const sourceUri = 'https://example.test/image.png';
    await seedLiveDetail(key.conversationId, [{ id: 'external', kind: 'image', sourceUri }]);
    host.source(sourceUri, Uint8Array.of(1, 2, 3));
    assert.equal((await runLiveSave(key))?.partial, 1);
    assert.deepEqual(host.requests, []);
    assert.equal([...host.files.keys()].some(name => name.startsWith('assets/')), false);
    assert.ok([...host.files.values()].some(value => typeof value === 'string'
        && value.includes('[Open source](https://example.test/image.png)')));
});
});

__suiteDescribe("skip_exported_assets", () => {
const request = (id: string, includeAssets: boolean) => ({ keys: [liveKey(id)], format: 'markdown' as const,
    delivery: 'folderWriter' as const, includeAssets, skipUnchanged: true });

test('Skip exported upgrades a text-only export to include assets, then skips the covered request', async t => {
    const host = v2LiveSaveHost(t), id = 'asset-upgrade', url = 'https://lh3.googleusercontent.com/image.png';
    const bytes = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
    await seedLiveDetail(id, [{ id: 'image', kind: 'image', name: 'image.png', sourceUri: url, mediaType: 'image/png' }]);
    host.source(url, bytes);
    assert.equal((await runExport(request(id, false))).exported, 1);
    assert.deepEqual(host.requests, []);
    const upgraded = await runExport(request(id, true));
    assert.equal(upgraded.skipped, 0);
    assert.equal(upgraded.exported, 1);
    assert.deepEqual(host.requests, [url]);
    assert.ok([...host.files.entries()].some(([name, value]) => name.endsWith('.png') && value instanceof Uint8Array));
    assert.equal((await runExport(request(id, true))).skipped, 1);
    assert.equal((await runExport(request(id, false))).skipped, 1);
    assert.equal((await getExportRecord(liveKey(id)))?.status, 'ok');
});

test('Skip exported does not assume legacy or missing records cover requested assets', () => {
    const record = { format: 'markdown' as const, status: 'ok' as const, exportedAt: 200, chatTime: 100 };
    assert.equal(shouldSkipExport__s22(null, 100, request('empty', true)), false);
    assert.equal(shouldSkipExport__s22(record, 100, request('legacy', false)), true);
    assert.equal(shouldSkipExport__s22(record, 100, request('legacy', true)), false);
});
});

__suiteDescribe("test_batch_worker_c1", () => {
/**
 * V2 replacement for the retired BatchWorker/fetchChatDetail/resolveChat APIs.
 * Keep real Gemini L1 parsing/Provider, L2 admission, L3a IndexedDB and
 * L3b/L4 presentation. Only Provider network transport and tab slot are faked.
 */















useIndexStorage();
const account = fixtureAccount('gemini');
const key = (conversationId: string) => ({ accountId: account.id, conversationId });
function native(id: string, title: string, answer: string, updatedAt = 1800000000000) {
    const result = sourceDetail({ id, title, updatedAt,
        messages: [sourceMessage('r_' + id, answer, 'model')] });
    result.conversation.detail.savedAt = updatedAt;
    result.conversation.detail.quality.status = 'complete';
    return result;
}
function provider(getConversationDetail: (conversationId: string, slot?: string | null) =>
    Promise<ReturnType<typeof native>>, route: (accountId: string) => Promise<string> = async () => 'u0') {
    return new GeminiProvider({
        getConversationList: async () => sourceList('G_SOURCE_EMPTY_01'),
        getConversationDetail,
    }, route);
}

test('C1: native online Detail flows through real L1 -> L2 -> L3a; no BatchWorker envelope is persisted', async () => {
    const id = 'c1-online-1';
    const resourceContext = createSourceResourceContext();
    const parsed = native(id, 'Source RPC title', 'Provider model answer');
    parsed.conversation.detail.assets.push({ id: 'diagram', kind: 'image', name: 'diagram.png', mediaType: 'image/png' });
    parsed.conversation.detail.messages[0].content.push({ type: 'image', assetId: 'diagram' });
    parsed.acquisitionHints = { diagram: { dataBase64: 'AQID' } };
    const requests: Array<{ id: string; slot: string | null | undefined }> = [];
    const actual = new GeminiProvider({
        getConversationList: async () => sourceList('G_SOURCE_EMPTY_01'),
        getConversationDetail: async (conversationId, slot) => {
            requests.push({ id: conversationId, slot });
            return parsed;
        },
    }, async () => 'u0', resourceContext);
    try {
        await actual.fetchConversationDetail(account.id, id);
        assert.deepEqual(requests, [{ id, slot: 'u0' }]);
        const saved = await readConversation(key(id));
        assert.ok(saved);
        assert.equal(saved.index.title, 'Source RPC title');
        assert.equal(saved.index.titleSource, 'provider');
        assert.equal(saved.detail.quality.status, 'complete');
        assert.equal(saved.detail.messages.length, 1);
        assert.match(JSON.stringify(saved.detail.messages), /Provider model answer/);
        assert.ok(!JSON.stringify(saved).includes('AQID'), 'acquisition hints are task-only');
        assert.equal(await getDetail({ ...key(id), accountId: '10000000-0000-4000-8000-000000000002' }), null);
        const bytes = await actual.acquireResource(key(id), saved.detail.assets[0]);
        assert.deepEqual([...bytes.bytes], [1, 2, 3]);
        const document = composeDomainDocument(saved, account);
        assert.match(renderDocumentMarkdown(document, {}), /Provider model answer/);
    } finally { resourceContext.release(); }
});

test('C1: pre-cancelled and in-flight AbortSignal stop v2 acquisition without admitting Detail', async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    let called = 0;
    const skipped = provider(async id => { called++; return native(id, 'Not fetched', 'Should not appear'); });
    await assert.rejects(skipped.fetchConversationDetail(account.id, 'c1-preabort', cancelled.signal),
        (error: unknown) => error instanceof Error && error.name === 'AbortError');
    assert.equal(called, 0);
    assert.equal(await getDetail(key('c1-preabort')), null);

    let release!: () => void, entered!: () => void;
    const gated = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const pending = provider(async id => {
        entered();
        await gated;
        return native(id, 'Late response', 'Should never commit');
    });
    const controller = new AbortController();
    const operation = pending.fetchConversationDetail(account.id, 'c1-midflight', controller.signal);
    await started;
    controller.abort();
    release();
    await assert.rejects(operation,
        (error: unknown) => error instanceof Error && error.name === 'AbortError');
    assert.equal(await getIndex(key('c1-midflight')), null);
    assert.equal(await getDetail(key('c1-midflight')), null);
});

test('C1: verified account route change and foreign Detail identity fail closed', async () => {
    const id = 'c1-owned', reply = native(id, 'Trusted title', 'Trusted body');
    let calls = 0;
    const changed = provider(async () => reply, async () => ++calls === 1 ? 'u0' : 'u1');
    await assert.rejects(changed.fetchConversationDetail(account.id, id), /route changed/);
    assert.equal(await getDetail(key(id)), null);

    const foreign = provider(async () => native('other-conversation', 'Foreign', 'Foreign body'));
    await assert.rejects(foreign.fetchConversationDetail(account.id, id), /Detail identity mismatch/);
    assert.equal(await getDetail(key('other-conversation')), null);
    assert.equal(await getDetail(key(id)), null);
});

test('C1: malformed native body fails L2 schema validation without replacing a trusted stored snapshot', async () => {
    const id = 'c1-untrusted';
    await ingestDetail(account.id, id, {
        savedAt: 100, quality: { status: 'complete' }, assets: [],
        messages: [{ role: 'assistant', content: [{
            type: 'paragraph', children: [{ type: 'text', text: 'Last trusted answer' }],
        }] }],
    }, { title: 'Saved title', titleSource: 'user', updatedAt: 100 });
    const before = await readConversation(key(id));
    const broken = native(id, 'Malformed reply', 'Untrusted text');
    broken.conversation.detail.messages[0].role = 'model' as never;
    await assert.rejects(provider(async () => broken).fetchConversationDetail(account.id, id), /Domain contract/);
    assert.deepEqual(await readConversation(key(id)), before);
});

test('C1: incomplete Takeout survives transient online failure; a newer complete native response supersedes its body', async () => {
    const id = 'c1-history';
    const imported = await importTakeout(takeoutArchive(activityHtml('<p>Takeout offline answer</p>', id)), account.id);
    assert.equal(imported.imported, 1);
    const offline = await readConversation(key(id));
    assert.ok(offline);
    assert.equal(offline.detail.quality.status, 'partial');
    const unavailable = provider(async () => { throw new Error('transient provider network error'); });
    await assert.rejects(unavailable.fetchConversationDetail(account.id, id), /transient provider network error/);
    assert.deepEqual(await readConversation(key(id)), offline, 'failed L1 fetch cannot erase durable L2 Detail');

    const online = native(id, 'Updated RPC answer', 'Full online answer', 1893456000000);
    await provider(async () => online).fetchConversationDetail(account.id, id);
    const stored = await readConversation(key(id));
    assert.ok(stored);
    assert.equal(stored.detail.quality.status, 'complete');
    assert.match(JSON.stringify(stored.detail.messages), /Full online answer/);
    assert.equal(stored.index.title, 'Updated RPC answer');
    assert.equal(stored.index.titleSource, 'provider');
});

test('C1: unknown semantic blocks remain readable without reconstructing obsolete legacy messages', async () => {
    const id = 'c1-unknown';
    await ingestDetail(account.id, id, {
        savedAt: 101, quality: { status: 'complete' }, assets: [],
        messages: [{ role: 'unknown', content: [{
            type: 'unknown', sourceType: 'provider-tool', text: 'Opaque but readable tool result',
        }] }],
    }, { title: 'Unexpected source role', titleSource: 'derived', updatedAt: 101 });
    const saved = await readConversation(key(id));
    assert.ok(saved);
    assert.equal(saved.detail.messages[0].role, 'unknown');
    assert.deepEqual(saved.detail.messages[0].content, [{
        type: 'unknown', sourceType: 'provider-tool', text: 'Opaque but readable tool result',
    }]);
    const rendered = renderDocumentMarkdown(composeDomainDocument(saved, account), {});
    assert.match(rendered, /Opaque but readable tool result/);
    assert.match(rendered, /provider-tool/);
});

test('C1: only an exactly confirmed provider deletion removes v2 Index, Detail and ExportRecord', async () => {
    const target = 'c1-delete', other = 'c1-preserve';
    for (const id of [target, other]) {
        await ingestDetail(account.id, id, {
            savedAt: 100, quality: { status: 'complete' }, assets: [],
            messages: [{ role: 'assistant', content: [] }],
        }, { title: id, titleSource: 'provider', updatedAt: 100 });
        await putExportRecord(key(id), { exportedAt: 200, format: 'markdown', status: 'ok' });
    }
    const wrongReply = provider(async () => { throw new ConfirmedGeminiConversationNotFound('c_' + other); });
    await assert.rejects(wrongReply.fetchConversationDetail(account.id, target), /Confirmed Gemini Detail not found/);
    assert.ok(await getDetail(key(target)), 'wrong request identity cannot authorize deletion');

    const confirmed = provider(async () => { throw new ConfirmedGeminiConversationNotFound('c_' + target); });
    await assert.rejects(confirmed.fetchConversationDetail(account.id, target), /conversation_not_found/);
    assert.equal(await getIndex(key(target)), null);
    assert.equal(await getDetail(key(target)), null);
    assert.equal(await getExportRecord(key(target)), null);
    assert.ok(await getDetail(key(other)), 'another conversation is preserved');
    assert.equal((await getExportRecord(key(other)))?.status, 'ok');
});
});

__suiteDescribe("tier2_completion_freshness", () => {
const messages = (turns: number): DomainMessage[] => Array.from({ length: turns * 2 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: `Turn ${Math.floor(i / 2) + 1} ${i % 2 ? 'answer' : 'prompt'}` }] },
        ...(i === 1 ? [{ type: 'image' as const, assetId: 'earlier-image' }] : [])],
}));

test('Tier 2 continued reply with Live Save off refreshes source, badge and all six exported turns including the earlier image', async t => {
    const host = v2LiveSaveHost(t), key = liveKey('continued-live-off');
    const assets = [{ id: 'earlier-image', kind: 'image' as const, name: 'earlier.png', sourceUri: 'https://lh3.googleusercontent.com/earlier.png' }];
    await seedLiveDetail(key.conversationId, assets, { savedAt: 1700000000000, messages: messages(5) });
    host.source(assets[0].sourceUri, Uint8Array.of(1, 2, 3));
    await runLiveSave(key);
    const record = await getExportRecord(key);
    host.files.clear(); host.requests.length = 0;
    await updateSettings({ enabledDisk: false });
    let acquired = 0;
    t.mock.method(GeminiProvider.prototype, 'fetchConversationDetail', async (accountId: string, conversationId: string) => {
        assert.deepEqual({ accountId, conversationId }, key);
        acquired++;
        await ingestDetail(accountId, conversationId, {
            savedAt: 1700000100000, quality: { status: 'complete' }, assets, messages: messages(6),
        }, { updatedAt: 1700000100000 });
    });
    assert.equal(await runLiveSave(key, true), null);
    assert.equal(acquired, 1, 'verified completion must acquire even when disk saving is disabled');
    assert.equal((await getDetail(key))?.messages.length, 12);
    assert.equal((await getIndex(key))?.updatedAt, 1700000100000);
    assert.deepEqual(await getExportRecord(key), record, 'refresh does not falsely mark a file delivered');
    assert.equal(host.files.size, 0); assert.equal(host.requests.length, 0, 'refresh does not download assets');
    const request = { keys: [key], format: 'markdown' as const, delivery: 'folderWriter' as const, includeAssets: true, skipUnchanged: true };
    assert.equal(shouldSkipExport(record, (await getIndex(key))?.updatedAt, request), false);
    assert.equal((await runExport(request)).exported, 1);
    const markdown = [...host.files.values()].find((value): value is string => typeof value === 'string')!;
    for (let turn = 1; turn <= 6; turn++) {
        assert.match(markdown, new RegExp(`Turn ${turn} prompt`));
        assert.match(markdown, new RegExp(`Turn ${turn} answer`));
    }
    const image = [...host.files.keys()].find(path => path.startsWith('assets/'))!;
    assert.ok(image); assert.ok(markdown.indexOf(image) < markdown.indexOf('Turn 2 prompt'), 'image stays in its original reply');
    assert.equal(acquired, 1, 'manual export uses the refreshed complete Domain');
});
});

__suiteDescribe("tier2_hidden_file_citation", () => {
for (const fallback of [false, true]) test(`Tier 2 uploaded-file chip ${fallback ? 'with Markdown fallback' : 'with native body'} does not add [1]; literals survive in physical Markdown`, async t => {
    const host = v2ExportHost(t);
    const parsed = sourceDetail({ id: 'hidden-file-chip', messages: [{ ...sourceMessage('answer'),
        content: 'Loaded input.txt[cite: 1]. Literal [1] and `[cite: 1]` remain.',
        groundingCitationMarkers: ['[cite: 1]'],
        structuredContent: { children: [{ nodeType: 'paragraph', children: [
            { nodeType: 18, text: 'Loaded input.txt' },
            { nodeType: 'citation', number: 1, title: 'input.txt' },
            { nodeType: 18, text: '. Literal [1] and ' },
            { nodeType: 18, text: '[cite: 1]', annotations: [{ start: 0, end: 9, type: 7 }] },
            { nodeType: 18, text: ' remain.' },
        ] }, ...(fallback ? [{ nodeType: 18 as const, text: 'unsupported', annotations: [{ start: 0, end: 99, type: 7 as const }] }] : [])] },
    }] });
    assert.equal(parsed.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK'), fallback);
    const { index, detail } = parsed.conversation;
    await ingestDetail(exportKey('hidden-file-chip').accountId, 'hidden-file-chip', detail, index);
    assert.equal((await runExport(exportRequest(['hidden-file-chip']))).exported, 1);
    const markdown = await host.blobs[0].text();
    assert.ok(markdown.includes('Loaded input.txt. Literal \\[1\\] and `[cite: 1]` remain.'), markdown);
    assert.equal(markdown.includes('input.txt[1]'), false);
});
});

__suiteDescribe("trusted_domain_export", () => {
/**
 * V2 trust boundary: L2 owns Domain facts, L3b composes the single reading AST,
 * and L4 renders that AST (or archives the original Domain for JSON).
 * No v1 ChatFormatter, PDF request adapter, or parallel metadata DTO exists.
 */











/** Compile-time boundary checks; never invoked at runtime. */
function v2FormatTypeBoundaries(indexOnly: DomainConversation, raw: DomainConversationWithDetail): void {
    const account = fixtureAccount('independent');
    // @ts-expect-error L3b requires a Domain with Detail, not an Index-only view.
    composeDomainDocument(indexOnly, account);
    // @ts-expect-error L4 JSON also requires a complete Domain view.
    serializeDomainJson(indexOnly, account, {});
    // @ts-expect-error Markdown consumes a DocumentAst, not a raw L2 Domain.
    renderDocumentMarkdown(raw, {});
    // @ts-expect-error HTML consumes a DocumentAst, not a raw L2 Domain.
    renderDocumentHtml(raw, {});
    // @ts-expect-error Typst/PDF consumes a DocumentAst, not a raw L2 Domain.
    renderDocumentTypst(raw, {});
    // @ts-expect-error Request metadata cannot impersonate the L2 Domain archive input.
    serializeDomainJson({ id: 'request-metadata', conversation: raw }, account, {});
}
void v2FormatTypeBoundaries;

test('request metadata cannot impersonate Domain; v2 composition requires matching Account and keys', () => {
    const key = fixtureKey('pdf-source', 'independent');
    const raw: DomainConversationWithDetail = {
        index: { key, titleSource: 'derived', title: 'Title' },
        detail: {
            key, quality: { status: 'unknown' }, assets: [],
            messages: [{ role: 'assistant', content: [{ type: 'paragraph', children: [
                { type: 'text', text: 'Independent body' },
            ] }] }],
        },
    };
    assert.throws(
        () => restoreDomainSnapshot({ id: 'pdf-source', conversation: raw }),
        /Invalid Domain conversation/,
        'metadata wrappers are not L2 snapshots',
    );

    const trusted = validateParserDomain(raw);
    const account = fixtureAccountFor(trusted);
    const document = composeDomainDocument(trusted, account);
    assert.equal(document.messages.length, 1);
    assert.equal(document.messages[0].role, 'assistant');
    assert.match(JSON.stringify(renderDocumentTypst(document, {})), /Independent body/);

    assert.throws(
        () => composeDomainDocument(trusted, fixtureAccount('gemini')),
        /Composition Account\/key mismatch/,
    );
    assert.throws(
        () => serializeDomainJson(trusted, fixtureAccount('gemini'), {}),
        /JSON Account\/key mismatch/,
    );
    const mismatchedKeys = { ...trusted, detail: { ...trusted.detail, key: fixtureKey('other-source', 'independent') } };
    assert.throws(
        () => composeDomainDocument(mismatchedKeys, account),
        /Composition Account\/key mismatch/,
    );
    assert.throws(
        () => serializeDomainJson(mismatchedKeys, account, {}),
        /JSON Account\/key mismatch/,
    );
});

test('one admitted Domain preserves messages, reasoning and source facts in HTML, Markdown, JSON and PDF projection', () => {
    const key = fixtureKey('exports', 'independent');
    const raw: DomainConversationWithDetail = {
        index: { key, titleSource: 'derived', title: '<Independent>', createdAt: 100, updatedAt: 200 },
        detail: {
            key, savedAt: 200, assets: [], quality: { status: 'partial' },
            messages: [
                { id: 'q', role: 'user', content: [{ type: 'paragraph', children: [
                    { type: 'text', text: 'Question <safe>' },
                ] }] },
                { id: 'a', role: 'assistant', reasoning: [{ type: 'paragraph', children: [
                    { type: 'text', text: 'Reasoning evidence' },
                ] }], content: [{ type: 'code', language: 'ts', code: 'const value = 2;' }] },
            ],
        },
    };
    const conversation = validateParserDomain(raw);
    const account = fixtureAccountFor(conversation);
    const before = structuredClone(conversation);
    const document = composeDomainDocument(conversation, account);

    const { html } = renderDocumentHtml(document, {});
    const markdown = renderDocumentMarkdown(document, {});
    const archive = JSON.parse(serializeDomainJson(conversation, account, {}));
    const pdf = renderDocumentTypst(document, {});

    assert.equal(document.title, '<Independent>');
    assert.equal(document.metadata.id, 'exports');
    assert.equal(document.metadata.provider, 'independent');
    assert.equal(document.metadata.createdAt, 100);
    assert.equal(document.metadata.updatedAt, 200);
    assert.deepEqual(document.messages.map(message => message.role), ['user', 'assistant']);
    assert.equal(document.messages[1].blocks[0].type, 'disclosure', 'reasoning belongs to the shared AST');
    assert.equal(document.messages[1].blocks[1].type, 'code');

    assert.match(html, /Question &lt;safe&gt;/, 'HTML escapes source content');
    assert.match(html, /Reasoning evidence/);
    assert.match(html, /const value = 2;/);
    assert.match(markdown, /Question &lt;safe&gt;/, 'Markdown escapes embedded HTML syntax');
    assert.match(markdown, /Reasoning evidence/);
    assert.match(markdown, /const value = 2;/);
    assert.equal(pdf.messages.length, 2);
    assert.match(JSON.stringify(pdf.messages), /Reasoning evidence/);
    assert.match(JSON.stringify(pdf.messages), /const value = 2;/);

    assert.equal(archive.format, 'gemini-exporter-domain');
    assert.equal(archive.version, 1);
    assert.equal(archive.account.id, account.id);
    assert.equal(archive.conversation.detail.quality.status, 'partial');
    assert.deepEqual(archive.conversation.detail.messages.map((message: { role: string }) => message.role), ['user', 'assistant']);
    assert.equal(archive.conversation.index.title, '<Independent>');
    assert.deepEqual(archive.conversation, conversation, 'JSON preserves trusted Domain rather than serializing the reading AST');
    assert.deepEqual(archive.resources, {});
    assert.deepEqual(conversation, before, 'renderers cannot mutate admitted Domain facts');
});
});

__suiteDescribe("v2_export_provider_harness", () => {
const accountId = '10000000-0000-4000-8000-000000000001';

test('v2 Export provider mock uses the L1 Promise<void> Detail refresh contract', async () => {
    const refreshed: string[] = [];
    const signal = new AbortController().signal;
    const provider: AIProvider = makeTestExportProvider({
        async fetchConversationDetail(account, conversationId, receivedSignal) {
            assert.equal(account, accountId);
            assert.equal(receivedSignal, signal);
            refreshed.push(conversationId);
            // The mocked L1 side would commit to L2 here; no parse result is
            // returned for Application to re-admit.
        },
    });

    assert.equal(await provider.fetchConversationDetail(accountId, 'detail-a', signal), undefined);
    assert.deepEqual(refreshed, ['detail-a']);
    assert.deepEqual(await provider.checkReadiness(accountId), { ready: true });
    assert.equal(await provider.listConversations({ accountId, streamId: 'recent' }), 'source_end');
});

test('v2 Export provider mock only returns task-owned resource bytes through acquireResource', async () => {
    const key = { accountId, conversationId: 'detail-b' };
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const provider = makeTestExportProvider({
        async acquireResource(receivedKey, asset) {
            assert.deepEqual(receivedKey, key);
            assert.equal(asset.id, 'image');
            return { bytes, mediaType: 'image/png' };
        },
    });
    const resource = await provider.acquireResource(key, { id: 'image', kind: 'image', mediaType: 'image/png' });
    assert.strictEqual(resource.bytes, bytes);
    assert.equal(resource.mediaType, 'image/png');
});

test('v2 provider mock fails on unconfigured external operations, never silently succeeds', async () => {
    const provider = makeTestExportProvider();
    await assert.rejects(
        provider.fetchConversationDetail(accountId, 'missing'),
        /fetchConversationDetail must be supplied/,
    );
    await assert.rejects(
        provider.acquireResource({ accountId, conversationId: 'missing' }, { id: 'x', kind: 'file' }),
        /acquireResource must be supplied/,
    );
});

test('the old helper name cannot silently accept a v1 BatchWorker contract', async () => {
    assert.throws(
        () => makeTestWorker({ fetchChatDetail: async () => ({ success: true }) }),
        /Unsupported v1 BatchWorker overrides: fetchChatDetail/,
    );
    const provider = makeTestWorker({ fetchConversationDetail: async () => {} });
    assert.equal(await provider.fetchConversationDetail(accountId, 'v2'), undefined);
});
});

__suiteDescribe("write_failure_semantics", () => {
/**
 * V2 write/commit failure semantics, on the real Export pipeline.
 *
 * The removed BatchWorker's 00_INDEX.md and _export_dev.log writers are not
 * v2 delivery artifacts. Failure boundaries are now Packaging, Delivery,
 * and the post-delivery ExportRecord write; no v1 compatibility mocks.
 */












const JSZip = require('../lib/jszip.min.js');

test('failed Browser Download start does not replace a previous ExportRecord and is retryable', async t => {
    let rejectDownload = true;
    const host = v2ExportHost(t, () => {
        if (rejectDownload) throw new Error('Browser download rejected');
    });
    const id = 'write-failure-retry';
    await seedExportConversation(id);
    const previous = { exportedAt: 12, format: 'html' as const, status: 'ok' as const, chatTime: 95 };
    await putExportRecord(exportKey(id), previous);

    const failed = await runExport(exportRequest([id]));
    assert.equal(failed.exported, 0);
    assert.equal(failed.partial, 0);
    assert.deepEqual(failed.failed, [exportKey(id)]);
    assert.equal(host.clicks(), 1, 'the actual download action was attempted');
    assert.deepEqual(await getExportRecord(exportKey(id)), previous);

    rejectDownload = false;
    const retried = await runExport(exportRequest([id]));
    assert.equal(retried.exported, 1);
    assert.deepEqual(retried.failed, []);
    assert.equal(host.clicks(), 2);
    assert.match(await host.blobs[1].text(), /Answer for write-failure-retry/);
    const record = await getExportRecord(exportKey(id));
    assert.equal(record?.format, 'markdown');
    assert.equal(record?.status, 'ok');
    assert.equal(record?.chatTime, 100);
    assert.ok((record?.exportedAt ?? 0) > previous.exportedAt);
});

test('ZIP writer error while staging multiple conversations fails all Keys before any delivery', async t => {
    const host = v2ExportHost(t);
    const previous = __getZipConstructor();
    const attempted: string[] = [];
    __setZipConstructor(class {
        file(path: string) {
            attempted.push(path);
            if (attempted.length === 2) throw new Error('Second staged Markdown failed');
        }
        async generateAsync(): Promise<never> { throw new Error('ZIP should not generate after a file failure'); }
    });
    t.after(() => __setZipConstructor(previous));
    await seedExportConversation('staged-one');
    await seedExportConversation('staged-two');

    const failed = await runExport(exportRequest(['staged-one', 'staged-two']));
    assert.equal(failed.exported, 0);
    assert.deepEqual(failed.failed, [exportKey('staged-one'), exportKey('staged-two')]);
    assert.equal(attempted.length, 2, 'failure occurs in the actual v2 ZIP file writer');
    assert.ok(attempted.every(path => path.endsWith('.md')));
    assert.equal(host.clicks(), 0, 'a staged ZIP is not a delivered file');
    assert.equal(await getExportRecord(exportKey('staged-one')), null);
    assert.equal(await getExportRecord(exportKey('staged-two')), null);

    __setZipConstructor(JSZip);
    const retried = await runExport(exportRequest(['staged-one', 'staged-two']));
    assert.equal(retried.exported, 2);
    assert.deepEqual(retried.failed, []);
    assert.equal(host.clicks(), 1);
    assert.match(host.filenames[0], /\.zip$/);
    const zip = await JSZip.loadAsync(await host.blobs[0].arrayBuffer());
    assert.equal(Object.keys(zip.files).filter(name => name.endsWith('.md')).length, 2);
});

test('a failed ExportRecord write is reported only after real delivery; retry succeeds', async t => {
    const host = v2ExportHost(t);
    await seedExportConversation('record-write-failure');
    host.failStorage('exportRecords');

    const failed = await runExport(exportRequest(['record-write-failure']));
    assert.equal(host.clicks(), 1, 'download was started before the record was attempted');
    assert.equal(failed.exported, 0);
    assert.deepEqual(failed.failed, [exportKey('record-write-failure')]);
    assert.equal(await getExportRecord(exportKey('record-write-failure')), null);

    host.failStorage();
    const retried = await runExport(exportRequest(['record-write-failure']));
    assert.equal(retried.exported, 1);
    assert.deepEqual(retried.failed, []);
    assert.equal(host.clicks(), 2);
    assert.equal((await getExportRecord(exportKey('record-write-failure')))?.status, 'ok');
});

test('a missing companion resource leaves a readable main file and a partial record after delivery', async t => {
    const host = v2ExportHost(t);
    const previousZip = __getZipConstructor();
    __setZipConstructor(JSZip);
    t.after(()=>__setZipConstructor(previousZip));
    const account = fixtureAccount('custom');
    const id = 'missing-companion';
    const key = { accountId: account.id, conversationId: id };
    const priorProvider = ProviderRegistry.get('custom');
    let acquisitions = 0;
    ProviderRegistry.register(makeTestExportProvider({
        id: 'custom',
        async acquireResource(receivedKey, asset) {
            assert.deepEqual(receivedKey, key);
            assert.equal(asset.id, 'missing-file');
            acquisitions++;
            throw new Error('Source file unavailable');
        },
    }));
    t.after(() => {
        ProviderRegistry.unregister('custom');
        if (priorProvider) ProviderRegistry.register(priorProvider);
    });
    await ingestDetail(account.id, id, {
        savedAt: 100, quality: { status: 'complete' },
        assets: [{ id: 'missing-file', kind: 'file', name: 'attachment.txt', mediaType: 'text/plain' }],
        messages: [{
            role: 'assistant',
            content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Readable main answer' }] }],
            attachmentIds: ['missing-file'],
        }],
    }, { title: 'Missing companion', titleSource: 'provider', updatedAt: 100 });
    const before = await readConversation(key);

    const result = await runExport({ ...exportRequest([]), keys: [key], includeAssets: true });
    assert.equal(acquisitions, 1);
    assert.equal(result.exported, 1);
    assert.equal(result.partial, 1);
    assert.deepEqual(result.failed, []);
    assert.equal(host.clicks(), 1);
    assert.match(host.filenames[0], /\.zip$/);
    assert.equal(host.blobs.length, 1, 'the final ZIP includes the document and failure report');
    const zip = await JSZip.loadAsync(await host.blobs[0].arrayBuffer());
    const name = Object.keys(zip.files).find(name => name.endsWith('.md'));
    assert.ok(name);
    assert.match(await zip.file(name).async('string'), /Readable main answer/);
    assert.equal((await getExportRecord(key))?.status, 'partial');
    assert.deepEqual(await readConversation(key), before, 'resource acquisition never alters the trusted Domain');
});
});

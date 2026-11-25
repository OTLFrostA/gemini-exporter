import { describe as __suiteDescribe } from 'node:test';
import test from "node:test";
import { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { type BlockNode } from "../src/l2/content/blocks.js";
import { type DomainAsset } from "../src/l2/conversationDetail.js";
import { fixtureAccount } from "./helpers/domainFixture.js";
import { v2ExportHost } from "./helpers/v2ExportHost.js";
import { exportKey } from "./helpers/v2ExportHost.js";
import { exportRequest } from "./helpers/v2ExportHost.js";
import { ingestDetail } from "../src/l2/ingestion.js";
import { readConversation } from "../src/l2/readConversation.js";
import { getExportRecord } from "../src/l3a/storageService.js";
import { runExport } from "../src/application/export/runExport.js";
import { updateSettings } from "../src/application/settings/index.js";
import { prepareExportResources } from "../src/application/export/prepareExportResources.js";
import { composeDomainDocument } from "../src/l3b/compose/composeDomainDocument.js";
import { collectDocumentResources } from "../src/l3b/ast/resourceReferences.js";
import { compileDocumentPdf } from "../src/l4/format/pdf/compileDocumentPdf.js";
import { TypstSandboxCompiler } from "../src/l4/format/pdf/typst/typstSandboxCompiler.js";
import { type IPdfCompiler } from "../src/l4/format/pdf/pdfCompiler.js";
import { PdfResourceError } from "../src/l4/format/pdf/errors.js";
import { buildMinimalValidPdf } from "./helpers/stubPdfCompiler.js";
import { StubPdfCompiler } from "./helpers/stubPdfCompiler.js";
import { extractPdfText } from "./helpers/pdfTextExtract.js";
import { parseObjects } from "./helpers/pdfTextExtract.js";
import { planExportPaths } from "../src/l4/packaging/index.js";
import { buildExportFiles } from "../src/l4/packaging/index.js";
import { packageExportFiles } from "../src/l4/packaging/index.js";
import { startBrowserDownload } from "../src/l4/delivery/index.js";
import { missingResource } from "../src/shared/resources/resourceResult.js";
import { __getZipConstructor } from "../src/l4/packaging/writers/zipWriter.js";
import { __setZipConstructor } from "../src/l4/packaging/writers/zipWriter.js";
import { test as test__s1 } from "node:test";
import { ingestIndexes } from "../src/l2/ingestion.js";
import { type ConversationDetail } from "../src/l2/conversationDetail.js";
import { type ExportRequest } from "../src/application/export/types.js";
import { ProviderRegistry } from "../src/l1/client/providerRegistry.js";
import { type AIProvider } from "../src/l1/client/aiProvider.js";
import { renderDocumentTypst } from "./helpers/renderTypstFixture.js";
import { fixtureAccountFor } from "./helpers/domainFixture.js";
import { resourceValue } from "./helpers/resources.js";
import { type ResourceBytes } from "../src/shared/resources/resourceResult.js";
import { createSourceResourceContext } from "../src/l1/resources/sourceResources.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { historicalFixture } from "./helpers/nativeFixture.js";
import { v2LiveSaveHost } from "./helpers/v2LiveSaveHost.js";
import { seedExportConversation } from "./helpers/v2ExportHost.js";
import { type DocumentAst } from "../src/l3b/ast/ast.js";
import { ingestDeletedConversation } from "../src/l2/ingestion.js";
import { getIndex } from "../src/l3a/storageService.js";
import { getDetail } from "../src/l3a/storageService.js";
import { type ConversationKey } from "../src/l2/conversationKey.js";
import { useIndexStorage } from "./helpers/indexStorage.js";
import { fixtureKey } from "./helpers/domainFixture.js";
import { test as test__s8 } from "node:test";
import { deflateSync } from "node:zlib";
import { inflateIfNeeded } from "./helpers/pdfTextExtract.js";
import { OperationError } from "../src/shared/errors/operationError.js";
import { validateParserDomain } from "../src/l2/runtimeValidation.js";
import { type SourceConversationParseResult } from "../src/l1/parsers/parsingResult.js";
import { ResourceHttpError } from "../src/shared/resources/resourceResult.js";
import { attemptResource } from "../src/shared/resources/resourceResult.js";
import { resourceIssueKind } from "../src/shared/resources/resourceResult.js";
import { resourceFailureText } from "../src/shared/resources/resourceResult.js";
import { acquireSourceResource } from "../src/l1/resources/sourceResources.js";
import { renderDocumentMarkdown } from "../src/l4/format/markdown/renderMarkdown.js";
import { renderDocumentHtml } from "../src/l4/format/html/renderHtml.js";
import { renderDocumentTypstCore } from "../src/l4/format/typst/renderTypstCore.js";
import { exportSummary } from "../src/ui/shared/exportSummary.js";
import { test as test__s10 } from "node:test";
import { v2Document } from "./helpers/l4V2Fixtures.js";
import { type DisplayBlock } from "../src/l3b/ast/ast.js";
import { restoreDomainSnapshot } from "../src/l2/runtimeValidation.js";

__suiteDescribe("pdf-export", () => {
/**
 * Application.runExport owns item failures, batch delivery and ExportRecord.
 * L3b builds the AST; L4 PDF Format accepts an IPdfCompiler boundary and L4
 * Packaging/Delivery owns the output. The old PdfExporter / StorageService,
 * writer callbacks, session aliases and manual ZIP finalization no longer exist.
 * Only the external Typst sandbox compiler and browser surfaces are doubled.
 */

























const account = fixtureAccount('gemini');
const JSZip = require('../lib/jszip.min.js');
const png = new Uint8Array(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg+M/wHwAEAQH/cetH5QAAAABJRU5ErkJggg==', 'base64'));

function paragraph(text: string): BlockNode {
    return { type: 'paragraph', children: [{ type: 'text', text }] };
}
async function seed(id: string, options: {
    title?: string;
    assets?: DomainAsset[];
    content?: BlockNode[];
    quality?: 'complete' | 'partial' | 'unknown';
    savedAt?: number;
    updatedAt?: number;
} = {}): Promise<void> {
    await ingestDetail(account.id, id, {
        savedAt: options.savedAt ?? 100,
        quality: { status: options.quality ?? 'complete' },
        assets: options.assets ?? [],
        messages: [{ role: 'assistant', content: options.content ?? [paragraph('PDF output for ' + id)] }],
    }, { title: options.title ?? 'PDF ' + id, titleSource: 'provider', updatedAt: options.updatedAt ?? 100 });
    // The fake browser navigator has no language; v2 settings supply it.
    await updateSettings({ language: 'en' });
}
/** Stub the external PDF sandbox only; Application and PDF Format stay real. */
function sandbox(t: TestContext, compile: IPdfCompiler['compile'] =
    async () => ({ pdfBytes: buildMinimalValidPdf(), diagnostics: [] })): void {
    const prior = TypstSandboxCompiler.prototype.compile;
    TypstSandboxCompiler.prototype.compile = compile;
    t.after(() => { TypstSandboxCompiler.prototype.compile = prior; });
}
function zip(t: TestContext): void {
    const prior = __getZipConstructor();
    __setZipConstructor(JSZip);
    t.after(() => __setZipConstructor(prior));
}
function context(signal: AbortSignal = new AbortController().signal) {
    return { signal, reportProgress() {} };
}
async function pdfInput(id: string, getBytes: (asset: DomainAsset) => Promise<Uint8Array>) {
    const conversation = await readConversation(exportKey(id));
    assert.ok(conversation);
    const document = composeDomainDocument(conversation, account);
    const refs = collectDocumentResources(document);
    const prepared = await prepareExportResources(conversation.detail.assets, refs.referencedIds,
        async asset => ({ bytes: await getBytes(asset), mediaType: asset.mediaType, name: asset.name }));
    const [plan] = planExportPaths([{ conversation, prepared, fileIds: refs.fileIds }], 'pdf');
    return { conversation, document, refs, prepared, plan };
}

test('v2 PDF export commits its ExportRecord only after real browser delivery, then skips unchanged data', async t => {
    const host = v2ExportHost(t);
    sandbox(t);
    const id = 'delivered';
    await seed(id);
    assert.equal(await getExportRecord(exportKey(id)), null);
    const result = await runExport(exportRequest([id], { format: 'pdf' }));
    assert.deepEqual(result, { exported: 1, skipped: 0, partial: 0, failed: [], aborted: false });
    assert.equal(host.clicks(), 1);
    assert.ok(host.filenames[0].endsWith('.pdf'));
    const body = new Uint8Array(await host.blobs[0].arrayBuffer());
    assert.deepEqual(body, buildMinimalValidPdf(), 'real PDF bytes reach Browser Download');
    assert.match(new TextDecoder().decode(body), /startxref[\s\S]*%%EOF/);
    const record = await getExportRecord(exportKey(id));
    assert.equal(record?.format, 'pdf');
    assert.equal(record?.status, 'ok');
    assert.equal(record?.chatTime, 100);
    assert.ok(record?.exportedAt);
    const skipped = await runExport(exportRequest([id], { format: 'pdf', skipUnchanged: true }));
    assert.equal(skipped.skipped, 1);
    assert.equal(skipped.exported, 0);
    assert.equal(host.clicks(), 1);
});

test('a failed Browser Download cannot create a PDF ExportRecord; the next attempt remains retryable', async t => {
    let failClick = true;
    const host = v2ExportHost(t, () => {
        if (failClick) throw new Error('Download start rejected');
    });
    sandbox(t);
    const id = 'download-retry';
    await seed(id);
    const first = await runExport(exportRequest([id], { format: 'pdf' }));
    assert.equal(first.exported, 0);
    assert.deepEqual(first.failed, [exportKey(id)]);
    assert.equal(await getExportRecord(exportKey(id)), null);
    failClick = false;
    const second = await runExport(exportRequest([id], { format: 'pdf' }));
    assert.equal(second.exported, 1);
    assert.deepEqual(second.failed, []);
    assert.equal(host.clicks(), 2);
    assert.equal((await getExportRecord(exportKey(id)))?.status, 'ok');
});

test('one PDF compile error does not block other batch items, which are ZIP-delivered and recorded', async t => {
    const host = v2ExportHost(t);
    zip(t);
    let compiles = 0;
    sandbox(t, async payload => {
        compiles++;
        if (payload.document.title.includes('bad')) throw new Error('Typst fatal document error');
        return { pdfBytes: buildMinimalValidPdf(), diagnostics: [] };
    });
    const ids = ['batch-good-one', 'batch-bad', 'batch-good-two'];
    for (const id of ids) await seed(id);
    const result = await runExport(exportRequest(ids, { format: 'pdf' }));
    assert.equal(compiles, 3);
    assert.equal(result.exported, 2);
    assert.equal(result.partial, 0);
    assert.deepEqual(result.failed, [exportKey('batch-bad')]);
    assert.equal(host.clicks(), 1);
    assert.match(host.filenames[0], /\.zip$/);
    const archive = await JSZip.loadAsync(await host.blobs[0].arrayBuffer());
    const files = Object.keys(archive.files).filter(name => name.endsWith('.pdf'));
    assert.equal(files.length, 2);
    assert.ok(files.some(name => name.includes('batch-good-one')));
    assert.ok(files.some(name => name.includes('batch-good-two')));
    for (const file of files) assert.deepEqual(await archive.file(file)!.async('uint8array'), buildMinimalValidPdf());
    assert.equal(await getExportRecord(exportKey('batch-bad')), null);
    assert.equal((await getExportRecord(exportKey('batch-good-one')))?.status, 'ok');
    assert.equal((await getExportRecord(exportKey('batch-good-two')))?.status, 'ok');
});

test('failed PDF batch ZIP delivery cannot commit any records, and a retry can deliver the same items', async t => {
    let failClick = true;
    const host = v2ExportHost(t, () => {
        if (failClick) throw new Error('ZIP delivery failed');
    });
    zip(t);
    sandbox(t);
    const ids = ['zip-one', 'zip-two'];
    for (const id of ids) await seed(id);
    const first = await runExport(exportRequest(ids, { format: 'pdf' }));
    assert.equal(first.exported, 0);
    assert.deepEqual(first.failed, ids.map(exportKey));
    for (const id of ids) assert.equal(await getExportRecord(exportKey(id)), null);
    failClick = false;
    const second = await runExport(exportRequest(ids, { format: 'pdf' }));
    assert.equal(second.exported, 2);
    assert.deepEqual(second.failed, []);
    assert.equal(host.clicks(), 2);
    for (const id of ids) assert.equal((await getExportRecord(exportKey(id)))?.format, 'pdf');
});

test('cancelling during PDF compilation stops delivery and leaves unfinished items unrecorded', async t => {
    const host = v2ExportHost(t);
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    sandbox(t, async (_payload, compileContext) => {
        entered();
        return new Promise((_resolve, reject) => {
            compileContext.signal.addEventListener('abort',
                () => reject(new DOMException('Compile cancelled', 'AbortError')), { once: true });
        });
    });
    const ids = ['cancel-one', 'cancel-two'];
    for (const id of ids) await seed(id);
    const controller = new AbortController();
    const pending = runExport(exportRequest(ids, { format: 'pdf' }), { signal: controller.signal });
    await started;
    controller.abort();
    const result = await pending;
    assert.equal(result.aborted, true);
    assert.equal(result.exported, 0);
    assert.deepEqual(result.failed, []);
    assert.equal(host.clicks(), 0);
    for (const id of ids) assert.equal(await getExportRecord(exportKey(id)), null);
});

test('PDF delivery remains completed even when persisting ExportRecord fails', async t => {
    const host = v2ExportHost(t);
    sandbox(t);
    const id = 'record-write-failure';
    await seed(id);
    host.failStorage('exportRecords');
    const result = await runExport(exportRequest([id], { format: 'pdf' }));
    assert.equal(host.clicks(), 1, 'the browser received the actual PDF');
    assert.equal(result.exported, 0, 'v2 counts records only after they commit');
    assert.deepEqual(result.failed, [exportKey(id)]);
    assert.equal(await getExportRecord(exportKey(id)), null);
    assert.deepEqual(new Uint8Array(await host.blobs[0].arrayBuffer()), buildMinimalValidPdf());
});

test('includeAssets=false retains readable PDF without downloading or persisting source image bytes', async t => {
    const host = v2ExportHost(t);
    let seenPaths = 0;
    sandbox(t, async payload => {
        seenPaths = payload.assetPaths.size;
        assert.match(JSON.stringify(payload.document), /missing-image/);
        return { pdfBytes: buildMinimalValidPdf(), diagnostics: [] };
    });
    const id = 'without-image';
    await seed(id, { assets: [{ id: 'image', kind: 'image', sourceUri: 'https://example.test/photo.png' }],
        content: [paragraph('Keep this conversation'), { type: 'image', assetId: 'image' }] });
    const before = await readConversation(exportKey(id));
    const result = await runExport(exportRequest([id], { format: 'pdf', includeAssets: false }));
    assert.equal(result.exported, 1);
    assert.equal(result.partial, 0, 'intentional resource exclusion is not an acquisition failure');
    assert.equal(seenPaths, 0);
    assert.equal(host.clicks(), 1);
    assert.ok(host.filenames[0].endsWith('.pdf'));
    assert.deepEqual(await readConversation(exportKey(id)), before);
    assert.equal((await getExportRecord(exportKey(id)))?.status, 'ok');
});

test('the L4 PDF compiler contract emits a structurally valid stub PDF and diagnostic', async t => {
    v2ExportHost(t);
    const id = 'stub-compiler';
    await seed(id);
    const input = await pdfInput(id, async () => { throw new Error('No resources expected'); });
    const result = await compileDocumentPdf(input.document, input.plan.resources, input.prepared,
        new StubPdfCompiler(), context());
    const text = new TextDecoder().decode(result.pdfBytes);
    assert.match(text, /^%PDF-/);
    assert.match(text, /xref[\s\S]*trailer[\s\S]*startxref[\s\S]*%%EOF/);
    const content = parseObjects(Buffer.from(result.pdfBytes)).get(4);
    assert.ok(content?.stream);
    const expectedContent = 'BT /F1 24 Tf 72 720 Td (stub pdf) Tj ET';
    assert.equal(content.stream.toString('utf8'), expectedContent);
    const declaredLength = Number(/\/Length\s+(\d+)/.exec(content.dict)?.[1]);
    assert.equal(declaredLength, new TextEncoder().encode(expectedContent).byteLength);
    assert.equal(content.stream.byteLength, declaredLength);
    const streamStart = text.indexOf('stream\n') + 'stream\n'.length;
    assert.equal(text.slice(streamStart + declaredLength, streamStart + declaredLength + '\nendstream'.length), '\nendstream');
    assert.equal(extractPdfText(result.pdfBytes).text, 'stub pdf');
    assert.ok(result.diagnostics.some(d => d.code === 'STUB_COMPILER_PLACEHOLDER'));
    const artifacts = buildExportFiles('pdf', input.plan, result.pdfBytes, input.prepared);
    assert.equal(artifacts.length, 1);
    assert.ok(artifacts[0].fileName.endsWith('.pdf'));
});

test('L4 passes compiler warnings through PDF diagnostics without swallowing or converting them', async t => {
    v2ExportHost(t);
    const id = 'compiler-warning';
    await seed(id);
    const input = await pdfInput(id, async () => { throw new Error('No resources expected'); });
    const compiler: IPdfCompiler = { name: 'warning probe', async compile() {
        return { pdfBytes: buildMinimalValidPdf(), diagnostics: [
            { severity: 'warning', code: 'TEST_COMPILE_WARNING', message: 'font fallback used' },
        ] };
    } };
    const result = await compileDocumentPdf(input.document, input.plan.resources, input.prepared,
        compiler, context());
    assert.ok(result.diagnostics.some(d => d.code === 'TEST_COMPILE_WARNING' && d.message === 'font fallback used'));
});

test('generic PDF compilation failure is fatal and cannot be reclassified as a missing image', async t => {
    const host = v2ExportHost(t);
    const id = 'fatal-compiler';
    await seed(id);
    const input = await pdfInput(id, async () => { throw new Error('No resources expected'); });
    let compiles = 0;
    const compiler: IPdfCompiler = { name: 'fatal probe', async compile() {
        compiles++;
        throw new Error('Typst invalid document');
    } };
    await assert.rejects(compileDocumentPdf(input.document, input.plan.resources, input.prepared,
        compiler, context()), /Typst invalid document/);
    assert.equal(compiles, 1);
    assert.equal(host.clicks(), 0);
    assert.equal(await getExportRecord(exportKey(id)), null);
});

test('PDF image is embedded from prepared bytes, while a dual-use File ships the original as one ZIP sidecar', async t => {
    const host = v2ExportHost(t);
    zip(t);
    const id = 'embedded-with-original';
    await seed(id, { assets: [{ id: 'dual', kind: 'image', name: 'original.png', mediaType: 'image/png' }],
        content: [
            { type: 'image', assetId: 'dual', alt: 'Embedded image' },
            { type: 'file', assetId: 'dual', label: 'Original bytes' },
        ] });
    let acquisition = 0;
    const input = await pdfInput(id, async () => { acquisition++; return png; });
    assert.deepEqual([...input.refs.imageIds], ['dual']);
    assert.deepEqual([...input.refs.fileIds], ['dual']);
    assert.equal(input.plan.externalResourceIds.has('dual'), true);
    const compiler: IPdfCompiler = { name: 'asset binding probe', async compile(payload, compileContext) {
        assert.equal(payload.assetPaths.get('dual'), input.plan.resources.dual);
        assert.deepEqual((await compileContext.assets.resolve('dual'))?.bytes, png);
        return { pdfBytes: buildMinimalValidPdf(), diagnostics: [] };
    } };
    const result = await compileDocumentPdf(input.document, input.plan.resources, input.prepared,
        compiler, context());
    assert.equal(acquisition, 1, 'PDF Format does not fetch the same source twice');
    assert.ok(!result.diagnostics.some(d => d.code === 'FORMAT_CONTENT_OMITTED'));
    const files = buildExportFiles('pdf', input.plan, result.pdfBytes, input.prepared);
    assert.equal(files.length, 2);
    assert.equal(files[1].fileName, input.plan.resources.dual);
    assert.deepEqual(files[1].content, png);
    const deliverable = await packageExportFiles([files], 'browserDownload');
    assert.equal(deliverable.length, 1);
    assert.ok(deliverable[0].fileName.endsWith('.zip'));
    await startBrowserDownload(deliverable[0]);
    assert.equal(host.clicks(), 1);
    const archive = await JSZip.loadAsync(await host.blobs[0].arrayBuffer());
    const sidecar = archive.file(input.plan.resources.dual);
    assert.ok(sidecar);
    assert.deepEqual(await sidecar.async('uint8array'), png);
    const pdf = archive.file(input.plan.fileName);
    assert.ok(pdf);
    assert.deepEqual(await pdf.async('uint8array'), buildMinimalValidPdf());
});

test('corrupt acquired image bytes become a visible PDF omission without refetching or losing the PDF', async t => {
    v2ExportHost(t);
    const id = 'corrupt-image';
    await seed(id, { assets: [{ id: 'img', kind: 'image', name: 'broken.png', mediaType: 'image/png' }],
        content: [{ type: 'image', assetId: 'img' }] });
    let acquisitions = 0;
    const input = await pdfInput(id, async () => { acquisitions++; return Uint8Array.of(1, 2, 3); });
    assert.equal(input.prepared.get('img')?.ok, true, 'acquisition itself succeeded');
    const compiler: IPdfCompiler = { name: 'omission probe', async compile(payload, compileContext) {
        assert.equal(payload.assetPaths.size, 0, 'only validated bytes reach Typst');
        assert.equal(await compileContext.assets.resolve('img'), null);
        assert.match(JSON.stringify(payload.document), /missing-image/);
        return { pdfBytes: buildMinimalValidPdf(), diagnostics: [] };
    } };
    const result = await compileDocumentPdf(input.document, input.plan.resources, input.prepared, compiler, context());
    assert.equal(acquisitions, 1);
    assert.ok(result.diagnostics.some(d => d.code === 'ASSET_CORRUPT' && d.path === 'asset:img'));
    assert.ok(result.diagnostics.some(d => d.code === 'FORMAT_CONTENT_OMITTED' && d.path === 'asset:img'));
    assert.match(new TextDecoder().decode(result.pdfBytes), /^%PDF-/);
});

test('PDF image decoder failure retries the technical compile once without reacquiring bytes or changing paths', async t => {
    v2ExportHost(t);
    const id = 'pdf-image-retry';
    await seed(id, { assets: [{ id: 'img', kind: 'image', name: 'retry.png', mediaType: 'image/png' }],
        content: [{ type: 'image', assetId: 'img' }] });
    let acquisitions = 0;
    const input = await pdfInput(id, async () => { acquisitions++; return png; });
    let calls = 0;
    const compiler: IPdfCompiler = { name: 'decoder retry probe', async compile(payload) {
        calls++;
        if (calls === 1) {
            assert.equal(payload.assetPaths.get('img'), input.plan.resources.img);
            throw new PdfResourceError([missingResource('img', 'Typst image decode failure')]);
        }
        assert.equal(payload.assetPaths.size, 0);
        assert.match(JSON.stringify(payload.document), /missing-image/);
        return { pdfBytes: buildMinimalValidPdf(), diagnostics: [] };
    } };
    const result = await compileDocumentPdf(input.document, input.plan.resources, input.prepared,
        compiler, context());
    assert.equal(calls, 2);
    assert.equal(acquisitions, 1);
    assert.ok(result.diagnostics.some(d => d.code === 'FORMAT_CONTENT_OMITTED' && d.path === 'asset:img'));
});

test('Packaging refuses colliding PDF file paths before browser download', async t => {
    const host = v2ExportHost(t);
    const bytes = buildMinimalValidPdf();
    await assert.rejects(packageExportFiles([
        [{ fileName: 'duplicate.pdf', mimeType: 'application/pdf', content: bytes }],
        [{ fileName: 'duplicate.pdf', mimeType: 'application/pdf', content: bytes }],
    ], 'browserDownload'), /Duplicate export path/);
    assert.equal(host.clicks(), 0);
});
});

__suiteDescribe("pdf-content-order", () => {
function fixture(atomic?: 'Formula' | 'Code' | 'matrix'): Buffer {
    const stream = (text: string) => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`;
    const span = (mcid: number, text: string) => `/Span << /MCID ${mcid} >> BDC BT /F1 10 Tf (${text}) Tj ET EMC\n`;
    const objects = new Map<number, string>([
        [1, '<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 30 0 R >>'],
        [2, '<< /Type /Pages /Count 2 /Kids [4 0 R 5 0 R] >>'],
        [3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
        [4, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 6 0 R >>'],
        [5, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 7 0 R >>'],
        [6, stream(span(0, 'Question.First sentence.Middle sentence.Final sentence.') + span(1, 'Alpha') + span(2, 'Beta') + span(3, 'x') + '/Artifact << /Subtype /Footer >> BDC BT /F1 10 Tf (1) Tj ET EMC')],
        [7, stream(span(0, 'endA') + span(1, 'endB') + span(2, 'Answer tail.') + span(3, 'if x < 3: print(x)'))],
        [10, '<< /Type /StructElem /S /Document /P 30 0 R /K [11 0 R 12 0 R 20 0 R 21 0 R] >>'],
        [11, '<< /Type /StructElem /S /P /P 10 0 R /Pg 4 0 R /K [0] >>'],
        [12, '<< /Type /StructElem /S /Table /P 10 0 R /K [13 0 R] >>'],
        [13, '<< /Type /StructElem /S /TR /P 12 0 R /K [14 0 R 15 0 R] >>'],
        // Explicit MCR dictionaries cross pages; nested Pg is not a parent Pg.
        [14, '<< /Type /StructElem /S /TD /P 13 0 R /K [<< /Type /MCR /Pg 4 0 R /MCID 1 >> 16 0 R << /Type /MCR /Pg 5 0 R /MCID 0 >>] >>'],
        [15, '<< /Type /StructElem /S /TD /P 13 0 R /K [<< /Type /MCR /Pg 4 0 R /MCID 2 >> << /Type /MCR /Pg 5 0 R /MCID 1 >>] >>'],
        [16, '<< /Type /StructElem /S /Formula /P 14 0 R /Pg 4 0 R /K [3] >>'],
        [20, '<< /Type /StructElem /S /P /P 10 0 R /Pg 5 0 R /K [2] >>'],
        [21, '<< /Type /StructElem /S /Code /P 10 0 R /K [22 0 R] >>'],
        [22, '<< /Type /StructElem /S /P /P 21 0 R /Pg 5 0 R /K [3] >>'],
        [30, '<< /Type /StructTreeRoot /K [10 0 R] >>'],
    ]);
    if (atomic === 'matrix') {
        // Live Typst array/cases output: Formula > Table > TD > Formula.
        // Cell formulas belong to the single outer authored expression.
        objects.set(10, '<< /Type /StructElem /S /Document /P 30 0 R /K [11 0 R 23 0 R 20 0 R 21 0 R] >>');
        objects.set(23, '<< /Type /StructElem /S /Formula /P 10 0 R /K [12 0 R] >>');
        objects.set(12, '<< /Type /StructElem /S /Table /P 23 0 R /K [13 0 R] >>');
    } else if (atomic) {
        for (const id of [12, 13, 14, 15, 21, 22]) objects.delete(id);
        objects.set(6, stream(span(0, 'first')));
        objects.set(7, stream(span(0, 'second') + span(1, 'tail')));
        objects.set(10, '<< /Type /StructElem /S /Document /P 30 0 R /K [16 0 R 20 0 R] >>');
        objects.set(16, `<< /Type /StructElem /S /${atomic} /P 10 0 R /Pg 4 0 R /K [0 << /Type /MCR /MCID 0 /Pg 5 0 R >>] >>`);
        objects.set(20, '<< /Type /StructElem /S /P /P 10 0 R /Pg 5 0 R /K [1] >>');
    }
    let text = '%PDF-1.7\n';
    const offsets = new Map<number, number>();
    for (const [number, body] of objects) { offsets.set(number, Buffer.byteLength(text)); text += `${number} 0 obj\n${body}\nendobj\n`; }
    const start = Buffer.byteLength(text);
    text += 'xref\n0 31\n0000000000 65535 f \n';
    for (let n = 1; n <= 30; n++) text += offsets.has(n) ? `${String(offsets.get(n)).padStart(10, '0')} 00000 n \n` : '0000000000 00000 f \n';
    text += `trailer\n<< /Size 31 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
    return Buffer.from(text);
}

test__s1('nested tagged matrix cells count as one formula and retain every cell across pages', () => {
    const pdf = extractPdfText(fixture('matrix'));
    assert.deepEqual(pdf.contentRuns, [
        { kind: 'text', group: null, text: 'Question.First sentence.Middle sentence.Final sentence.' },
        { kind: 'math', group: 23, text: 'AlphaBetaxendAendB' },
        { kind: 'text', group: null, text: 'Answer tail.' },
        { kind: 'code', group: 21, text: 'if x < 3: print(x)' },
    ]);
});

test__s1('independent PDF extraction preserves complete prose/code and logical paginated cell order', () => {
    const pdf = extractPdfText(fixture());
    assert.equal(pdf.pageCount, 2);
    assert.deepEqual(pdf.contentRuns, [
        { kind: 'text', group: null, text: 'Question.First sentence.Middle sentence.Final sentence.Alpha' },
        { kind: 'math', group: 16, text: 'x' },
        { kind: 'text', group: null, text: 'endABetaendBAnswer tail.' },
        { kind: 'code', group: 21, text: 'if x < 3: print(x)' },
    ]);
    assert.ok(pdf.text.includes('1'), 'raw extraction still includes pagination for existing callers');
    assert.ok(!pdf.contentRuns.some(run => run.text === '1'), 'semantic content excludes tagged footer');
});


for (const role of ['Formula', 'Code'] as const) {
    test__s1(`independent PDF extraction keeps ${role} classification across explicit page references`, () => {
        const pdf = extractPdfText(fixture(role));
        assert.equal(pdf.pageCount, 2);
        assert.deepEqual(pdf.contentRuns, [
            { kind: role === 'Formula' ? 'math' : 'code', group: 16, text: 'firstsecond' },
            { kind: 'text', group: null, text: 'tail' },
        ]);
    });
}
});

__suiteDescribe("pdf-conversation-fallback", () => {
/**
 * V2 PDF/Export source fallback contract.
 *
 * Source selection is L2 Detail admission; Export fetches via L1 and then
 * rereads the committed Domain. PDF consumes the same L3b AST as other
 * reading formats, with no private Takeout/cache resolver or PDF item stage.
 * Only the external Provider and browser download/PDF compiler host are faked.
 */



















const account = fixtureAccount('custom');
const sourceTime = 1_700_000_000_000;
const key = (conversationId: string) => ({ accountId: account.id, conversationId });
const request = (id: string, changes: Partial<ExportRequest> = {}): ExportRequest => ({
    keys: [key(id)], format: 'markdown', delivery: 'browserDownload',
    includeAssets: false, skipUnchanged: false, ...changes,
});
const paragraph = (text: string) => ({
    type: 'paragraph' as const, children: [{ type: 'text' as const, text }],
});
function detail(text: string | null, savedAt: number, quality: 'complete' | 'partial' | 'unknown' = 'complete'):
    Omit<ConversationDetail, 'key'> {
    return { savedAt, quality: { status: quality }, assets: [],
        messages: text === null ? [] : [{ role: 'assistant', content: [paragraph(text)] }] };
}
async function seed(id: string, text: string | null, opts: {
    savedAt?: number; updatedAt?: number; quality?: 'complete' | 'partial' | 'unknown';
    title?: string; titleSource?: 'provider' | 'derived' | 'user';
} = {}) {
    const savedAt = opts.savedAt ?? sourceTime;
    return ingestDetail(account.id, id, detail(text, savedAt, opts.quality ?? 'complete'), {
        title: opts.title ?? 'PDF ' + id, titleSource: opts.titleSource ?? 'provider',
        updatedAt: opts.updatedAt ?? savedAt,
    });
}
async function host(t: TestContext) {
    const browser = v2ExportHost(t);
    await updateSettings({ language: 'en' });
    return browser;
}
/** L1 test seam: the Provider must commit through L2, returning no Domain DTO. */
function provider(t: TestContext, fetchDetail: AIProvider['fetchConversationDetail']) {
    const prior = ProviderRegistry.get(account.providerId);
    const fake: AIProvider = {
        id: account.providerId, name: 'PDF source fallback fixture', hostPatterns: [],
        matchesUrl: () => false, checkReadiness: async () => ({ ready: true }),
        listConversations: async () => 'source_end',
        fetchConversationDetail: fetchDetail,
        acquireResource: async () => { throw new Error('Unexpected resource request'); },
    };
    ProviderRegistry.register(fake);
    t.after(() => {
        ProviderRegistry.unregister(account.providerId);
        if (prior) ProviderRegistry.register(prior);
    });
}
async function pdfProjection(id: string) {
    const conversation = await readConversation(key(id));
    assert.ok(conversation, 'L2 must have a committed Detail to compose PDF');
    const document = composeDomainDocument(conversation, account);
    return { conversation, document, typst: renderDocumentTypst(document, {}) };
}

test('a complete Takeout Detail survives a later empty partial online candidate; PDF uses the selected L2 body', async t => {
    const browser = await host(t);
    const id = 'takeout-complete';
    await seed(id, 'Recovered Takeout', { savedAt: sourceTime });
    const competing = await ingestDetail(account.id, id,
        detail(null, sourceTime + 100, 'partial'), {
            title: 'Partial online response', titleSource: 'derived', updatedAt: sourceTime,
        });
    assert.deepEqual(competing, { accepted: false, changed: false },
        'message count alone is not a PDF-specific source-selection rule; L2 retains complete content');
    provider(t, async () => assert.fail('fresh committed Detail must not trigger a second source fetch'));

    const { conversation, document, typst } = await pdfProjection(id);
    assert.equal(conversation.detail.savedAt, sourceTime);
    assert.equal(conversation.detail.quality.status, 'complete');
    assert.equal(conversation.index.title, 'PDF ' + id);
    assert.match(JSON.stringify(typst.messages), /Recovered Takeout/);
    assert.equal(typst.messages.length, 1);
    assert.equal('resolvedSource' in conversation.detail, false, 'transient Takeout provenance is not durable Domain');

    let compiles = 0;
    const compiler: IPdfCompiler = {
        name: 'capture-final-pdf-input',
        async compile(payload) {
            compiles++;
            assert.match(JSON.stringify(payload.document.messages), /Recovered Takeout/);
            assert.doesNotMatch(JSON.stringify(payload.document.messages), /Partial online response/);
            assert.equal(payload.assetPaths.size, 0);
            return { pdfBytes: buildMinimalValidPdf(), diagnostics: [] };
        },
    };
    const pdf = await compileDocumentPdf(document, {}, new Map(), compiler, {
        signal: new AbortController().signal, reportProgress() {},
    });
    assert.equal(compiles, 1);
    assert.equal(new TextDecoder().decode(pdf.pdfBytes.subarray(0, 5)), '%PDF-');

    const result = await runExport(request(id));
    assert.equal(result.exported, 1);
    assert.equal(result.partial, 0);
    assert.equal(browser.clicks(), 1);
    assert.match(await browser.blobs[0].text(), /Recovered Takeout/);
    assert.equal((await getExportRecord(key(id)))?.chatTime, sourceTime);
});

test('new complete online Detail replaces an older partial Takeout snapshot for all reading formats', async t => {
    const browser = await host(t);
    const id = 'online-complete';
    await seed(id, 'Incomplete Takeout body', { quality: 'partial', savedAt: sourceTime });
    const result = await seed(id, 'Authoritative online body', {
        quality: 'complete', savedAt: sourceTime + 100,
    });
    assert.deepEqual(result, { accepted: true, changed: true });
    provider(t, async () => assert.fail('fresh online Detail must be reused without another fetch'));

    const { conversation, typst } = await pdfProjection(id);
    assert.equal(conversation.detail.quality.status, 'complete');
    assert.equal(conversation.detail.savedAt, sourceTime + 100);
    assert.match(JSON.stringify(typst.messages), /Authoritative online body/);
    assert.doesNotMatch(JSON.stringify(typst.messages), /Incomplete Takeout body/);

    const delivered = await runExport(request(id));
    assert.equal(delivered.exported, 1);
    assert.equal(delivered.partial, 0);
    assert.match(await browser.blobs[0].text(), /Authoritative online body/);
    assert.doesNotMatch(await browser.blobs[0].text(), /Incomplete Takeout body/);
    assert.equal((await getExportRecord(key(id)))?.chatTime, sourceTime + 100);
});

test('an Index-only selection fetches L1 Detail, then rereads its committed content and authoritative title', async t => {
    const browser = await host(t);
    const id = 'metadata-only';
    await ingestIndexes(account.id, [{
        conversationId: id,
        fields: { title: 'Selection metadata', titleSource: 'derived', updatedAt: sourceTime },
    }]);
    assert.equal(await readConversation(key(id)), null, 'Index-only must not be treated as an empty body');
    const calls: string[] = [];
    provider(t, async (accountId, conversationId) => {
        assert.equal(accountId, account.id);
        assert.equal(conversationId, id);
        calls.push(conversationId);
        await ingestDetail(accountId, conversationId,
            detail('Fetched PDF detail payload', sourceTime), {
                title: 'Authoritative Title', titleSource: 'provider', updatedAt: sourceTime,
            });
    });

    const result = await runExport(request(id));
    assert.equal(result.exported, 1);
    assert.equal(result.partial, 0);
    assert.deepEqual(result.failed, []);
    assert.deepEqual(calls, [id], 'L1 returns void; Export reads L2 again after admission');
    assert.match(await browser.blobs[0].text(), /Fetched PDF detail payload/);
    assert.match(await browser.blobs[0].text(), /Authoritative Title/);

    const { conversation, document, typst } = await pdfProjection(id);
    assert.equal(conversation.index.title, 'Authoritative Title');
    assert.equal(document.title, 'Authoritative Title');
    assert.match(JSON.stringify(typst.messages), /Fetched PDF detail payload/);
    assert.equal((await getExportRecord(key(id)))?.status, 'ok');
});

test('transient L1 refresh failure retains an older local Detail as partial and never promotes its version', async t => {
    const browser = await host(t);
    const id = 'offline-with-local';
    await seed(id, 'Saved local PDF body', { savedAt: sourceTime });
    await ingestIndexes(account.id, [{
        conversationId: id, fields: { updatedAt: sourceTime + 100 },
    }]);
    let attempts = 0;
    provider(t, async () => { attempts++; throw new Error('HTTP 503: transient'); });

    const original = await readConversation(key(id));
    const first = await runExport(request(id));
    assert.deepEqual({ exported: first.exported, partial: first.partial, failed: first.failed },
        { exported: 1, partial: 1, failed: [] });
    assert.equal(attempts, 1);
    assert.match(await browser.blobs[0].text(), /Saved local PDF body/);
    assert.deepEqual(await readConversation(key(id)), original, 'refresh failure does not rewrite the selected Domain');
    assert.equal((await getExportRecord(key(id)))?.chatTime, sourceTime);
    assert.equal((await getExportRecord(key(id)))?.status, 'partial');

    const { typst } = await pdfProjection(id);
    assert.match(JSON.stringify(typst.messages), /Saved local PDF body/);
    const retry = await runExport(request(id, { skipUnchanged: true }));
    assert.equal(retry.skipped, 0, 'partial fallback cannot be skipped next time');
    assert.equal(retry.partial, 1);
    assert.equal(attempts, 2);
    assert.equal(browser.clicks(), 2);
});

test('missing Detail fails; an explicitly accepted empty Detail is not a fabricated PDF_NO_MESSAGES error', async t => {
    const browser = await host(t);
    const id = 'empty-valid';
    await ingestIndexes(account.id, [{
        conversationId: id, fields: { title: 'Empty but valid', titleSource: 'provider', updatedAt: sourceTime },
    }]);
    let attempts = 0;
    provider(t, async () => { attempts++; /* no Detail was admitted */ });

    const missing = await runExport(request(id));
    assert.equal(missing.exported, 0);
    assert.deepEqual(missing.failed, [key(id)]);
    assert.equal(browser.clicks(), 0);
    assert.equal(await getExportRecord(key(id)), null);

    await ingestDetail(account.id, id, detail(null, sourceTime, 'complete'));
    const { conversation, document, typst } = await pdfProjection(id);
    assert.deepEqual(conversation.detail.messages, []);
    assert.equal(document.messages.length, 0);
    assert.equal(typst.messages.length, 0, 'PDF can render the valid empty-conversation fallback');
    const delivered = await runExport(request(id));
    assert.equal(delivered.exported, 1);
    assert.equal(delivered.partial, 0);
    assert.deepEqual(delivered.failed, []);
    assert.equal(attempts, 1, 'fresh accepted empty Detail does not need another fetch');
    assert.equal(browser.clicks(), 1);
    assert.match(await browser.blobs[0].text(), /Empty but valid/);
    assert.equal((await getExportRecord(key(id)))?.status, 'ok');
});
});

__suiteDescribe("pdf-dataurl-assets", () => {
const { historicalFixture } = require('./helpers/nativeFixture.js');
/** Inline source data stays in acquisition context; decoded bytes belong to PreparedResources. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { composeDomainDocument } = require('../src/l3b/compose/composeDomainDocument.js');





const { collectDocumentResources } = require('../src/l3b/ast/resourceReferences.js');
const { assertDomainClosure } = require('../src/l2/closure.js');
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
async function prepare(content: string, id = 'dataurl') {
    const input = { id, title: 'data url assets', messages: [{ id: 'm1', role: 'user', content }] };
    const before = JSON.stringify(input);
    const parsed = historicalFixture(input, { providerId: 'gemini' });
    const domain = parsed.conversation;
    assertDomainClosure((domain).detail);
    const document = composeDomainDocument(domain, fixtureAccountFor(domain));
    const semantic = JSON.stringify({ domain, document });
    const context = createSourceResourceContext();
    const key = domain.index.key;
    // Retain only inline readers here. Remote acquisition is intentionally offline.
    context.retainParsed(key, { ...parsed, conversationId: key.conversationId, acquisitionHints: Object.fromEntries(Object.entries(parsed.acquisitionHints).filter(([, value]: [string, any]) => /^data:/i.test(value.url ?? value.sourceUrl ?? ''))) });
    try {
        const references = collectDocumentResources(document);
        const resources = await prepareExportResources(domain.detail.assets, references.referencedIds,
            (asset, signal) => context.acquire(key, asset, signal, async () => { throw new Error('no network fetch in offline test'); }));
        const [plan] = planExportPaths([{ conversation: domain, prepared: resources, fileIds: references.fileIds }], 'pdf');
        const mounts: Array<{ id: string; bytes: Uint8Array }> = [];
        let pathMap = new Map<string, string>();
        const compiled = await compileDocumentPdf(document, plan.resources, resources, {
            name: 'mount-inspection', async compile(payload, ctx) {
                pathMap = new Map(payload.assetPaths);
                for (const id of pathMap.keys()) {
                    const resolved = await ctx.assets.resolve(id);
                    if (resolved?.bytes) mounts.push({ id, bytes: resolved.bytes });
                }
                return { pdfBytes: buildMinimalValidPdf(), diagnostics: [] };
            },
        }, { signal: new AbortController().signal, reportProgress() {} });
        assert.equal(JSON.stringify({ domain, document }), semantic);
        assert.equal(JSON.stringify(input), before);
        return { domain, acquisitionHints: parsed.acquisitionHints, document, resources, pathMap, mounts,
            diagnostics: compiled.diagnostics,
            unresolved: [...resources.values()].filter(value => !value.ok) };
    } finally { context.release(); }
}
test('inline PNG bytes stay outside Domain; Packaging paths mount the exact prepared bytes', async () => {
    const source = `data:image/png;base64,${PNG_B64}`;
    const result = await prepare(`![dot](${source})`);
    assert.equal(result.domain.detail.assets.length, 1);
    const asset = result.domain.detail.assets[0];
    assert.equal(asset.sourceUri, undefined);
    assert.equal(result.acquisitionHints[asset.id].url, source);
    assert.match(result.pathMap.get(asset.id), /^assets\/.*\.png$/);
    assert.equal(resourceValue<ResourceBytes>(result.resources.get(asset.id)).mediaType, 'image/png');
    assert.deepEqual(Buffer.from(resourceValue<ResourceBytes>(result.resources.get(asset.id)).bytes), Buffer.from(PNG_B64, 'base64'));
    assert.deepEqual(Buffer.from(result.mounts[0].bytes), Buffer.from(PNG_B64, 'base64'), 'mounted bytes must equal the original PNG');
    assert.ok(!result.diagnostics.some((d: {code: string}) => d.code === 'FORMAT_CONTENT_OMITTED'));
    assert.deepEqual(JSON.parse(JSON.stringify(result.domain)), result.domain);
    for (const field of ['storageRef', 'status', 'sha256']) assert.ok(!(field in asset));
});
test('image without authored alt remains resolvable without inventing a semantic filename', async () => {
    const result = await prepare(`![](data:image/png;base64,${PNG_B64})`);
    assert.match(result.pathMap.get(result.domain.detail.assets[0].id), /^assets\/.*\.png$/);
    assert.equal(result.mounts.length, 1);
});
test('percent-encoded SVG input decodes before image mounting', async () => {
    const text = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const result = await prepare(`![v](data:image/svg+xml,${encodeURIComponent(text)})`);
    const id = result.domain.detail.assets[0].id;
    assert.deepEqual(Buffer.from(resourceValue<ResourceBytes>(result.resources.get(id)).bytes), Buffer.from(text));
    assert.ok(result.pathMap.get(id)?.endsWith('.svg'));
    assert.ok(!result.diagnostics.some((d: {code: string}) => d.code === 'FORMAT_CONTENT_OMITTED'));
});
test('malformed original data URL failures remain failed resource sidecars', async () => {
    for (const uri of ['data:image/png;base64', 'data:image/png;base64,!!!not-base64!!!', 'data:image/png,%zz']) {
        const result = await prepare(`![x](${uri})`);
        const id = result.domain.detail.assets[0].id;
        assert.equal(result.domain.detail.assets[0].sourceUri, undefined);
        assert.equal(result.acquisitionHints[id].url, uri);
        assert.equal(result.mounts.length, 0);
        const prepared = result.resources.get(id);
        if (!prepared) throw new Error('invalid data URL must have a prepared resource result');
        if (prepared.ok) {
            // Some malformed data URLs decode to bytes but are rejected during PDF content validation.
            assert.ok(result.diagnostics.some(d => d.code === 'FORMAT_CONTENT_OMITTED'),
                'a decoded but invalid image must be reported by the PDF compiler');
        } else {
            assert.ok(result.unresolved.some(item => item.resourceId === id),
                'an acquisition failure must remain a failed resource sidecar');
        }
    }
});
test('remote input remains a URI fact; offline preparation cannot invent bytes', async () => {
    const uri = 'https://example.com/inline.png';
    const result = await prepare(`![a](${uri})`);
    const id = result.domain.detail.assets[0].id;
    assert.equal(result.domain.detail.assets[0].sourceUri, uri);
    assert.equal(result.resources.get(id)?.ok, false);
    assert.equal(result.pathMap.size, 0);
    assert.match(result.unresolved[0]?.reason, /no network fetch/);
});
test('prepared bytes are isolated between export runs and remain intact in the owning run', async () => {
    const first = await prepare(`![dot](data:image/png;base64,${PNG_B64})`, 'first');
    const second = await prepare('no images', 'second');
    assert.notEqual(first.resources, second.resources);
    assert.equal(second.domain.detail.assets.length, 0);
    assert.equal(second.resources.size, 0);
    const id = first.domain.detail.assets[0].id;
    assert.equal(second.resources.get(id), undefined);
    assert.deepEqual(Buffer.from(resourceValue<ResourceBytes>(first.resources.get(id)).bytes), Buffer.from(PNG_B64, 'base64'));
});
test('repeated original data URI has one semantic asset and two content placements', async () => {
    const uri = `data:image/png;base64,${PNG_B64}`;
    const result = await prepare(`![one](${uri})\n\n![two](${uri})`);
    assert.equal(result.domain.detail.assets.length, 1);
    assert.equal(result.resources.size, 1);
    assert.equal(result.mounts.length, 1);
    assert.equal(result.domain.detail.messages[0].content.length, 2);
    const ids = result.domain.detail.messages[0].content.map((block: any) => block.children[0].assetId);
    assert.deepEqual(ids, [result.domain.detail.assets[0].id, result.domain.detail.assets[0].id]);
});
});

__suiteDescribe("pdf-e2e-disk", () => {
/** Physical disk delivery checks. Only the platform host and PDF compiler are
 * adapted; unified Export, Composer, Packaging, Delivery and records are real. */














const JSZip = require('../lib/jszip.min.js');
const fixtureDir = path.join(__dirname, 'fixtures', 'provider');
const sample = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'conversation-sample.json'), 'utf8'));

// Fixture helpers

function makeSample(idSuffix: string, title: string, marker?: string) {
    const c = JSON.parse(JSON.stringify(sample));
    c.id = `pdf-e2e-disk-${idSuffix}`;
    c.title = title;
    c.titles = { [c.titleSource || 'legacy']: title };
    if (marker) {
        // Distinct body text per conversation so per-PDF text correctness is
        // verifiable (flows through the real normalizer into the bundle).
        for (const m of c.messages) {
            if (typeof m.content === 'string') {
                m.content = `${m.content}\n\n${marker}\n`;
            }
        }
    }
    return c;
}

/** Recursively collect plain text from the prepared display transport inline/block nodes. */
function flattenText(node: any): string {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(flattenText).join(' ');
    if (typeof node === 'object') {
        if (typeof node.text === 'string') return node.text;
        if (Array.isArray(node.children)) return node.children.map(flattenText).join('');
        return Object.values(node).filter(value=>typeof value==='object').map(flattenText).join(' ');
    }
    return '';
}

function documentBodyText(document: any, maxLen = 600): string {
    const msgs = document?.messages ?? [];
    const parts: string[] = [];
    for (const m of msgs) {
        for (const b of m?.blocks ?? []) parts.push(flattenText(b));
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function escapePdfLiteral(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Build a structurally valid minimal PDF (real xref offsets, startxref
 * pointer, trailer, %%EOF) whose content stream shows the given title and
 * body text with WinAnsi (Helvetica) text operators.
 */
function buildTextPdf(title: string, body: string): Uint8Array {
    const enc = new TextEncoder();
    const content = [
        'BT /F1 24 Tf 72 720 Td',
        `(${escapePdfLiteral(title)}) Tj`,
        '0 -36 Td',
        '/F1 12 Tf',
        `(${escapePdfLiteral(body)}) Tj`,
        'ET',
    ].join('\n');
    const contentBytes = enc.encode(content);
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        `<< /Length ${contentBytes.length} >>\nstream\n${content}\nendstream`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let bodyOut = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((dict, i) => {
        offsets.push(enc.encode(bodyOut).length);
        bodyOut += `${i + 1} 0 obj\n${dict}\nendobj\n`;
    });
    const xrefOffset = enc.encode(bodyOut).length;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
    const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return enc.encode(bodyOut + xref + trailer);
}

/** Test-local compiler (NOT the stub): embeds title + text into a real PDF. */
class TitleTextPdfCompiler {
    readonly name = 'title-text-test-compiler';
    async compile(payload: any, _context: any) {
        const title = payload.document.title;
        const body = documentBodyText(payload.document);
        return { pdfBytes: buildTextPdf(String(title), body), diagnostics: [] };
    }
}

// Node-backed FileSystemDirectoryHandle adapter for the REAL FsWriter.
// Only the browser platform API is adapted; FsWriter itself is untouched.

function makeNodeDirHandle(absDir: string): any {
    return {
        name: path.basename(absDir),
        kind: 'directory',
        queryPermission: async () => 'granted',
        getDirectoryHandle: async (name: string, opts?: any) => {
            const sub = path.join(absDir, name);
            if (opts && opts.create) fs.mkdirSync(sub, { recursive: true });
            if (!fs.existsSync(sub)) throw new Error(`directory not found: ${sub}`);
            return makeNodeDirHandle(sub);
        },
        getFileHandle: async (name: string, opts?: any) => {
            const filePath = path.join(absDir, name);
            if (opts && opts.create) {
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
                fs.closeSync(fs.openSync(filePath, 'a'));
            }
            if (!fs.existsSync(filePath)) throw new Error(`file not found: ${filePath}`);
            return {
                kind: 'file',
                name,
                createWritable: async () => ({
                    write: async (content: any) => {
                        const buf =
                            content instanceof Uint8Array
                                ? Buffer.from(content)
                                : typeof content === 'string'
                                  ? Buffer.from(content, 'utf8')
                                  : Buffer.from(await content.arrayBuffer());
                        fs.writeFileSync(filePath, buf);
                    },
                    close: async () => {},
                    abort: async () => {},
                }),
            };
        },
    };
}

function freshTempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function pdfFilesRecursive(dir: string): string[] {
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...pdfFilesRecursive(p));
        else if (e.name.endsWith('.pdf')) out.push(p);
    }
    return out;
}


async function seed(conv: ReturnType<typeof makeSample>) {
    const parsed=historicalFixture(conv);const {index,detail}=parsed.conversation;
    await ingestDetail(index.key.accountId,index.key.conversationId,detail,index);
    return index.key.conversationId;
}
function compiler(t: import('node:test').TestContext) {
    const instance=new TitleTextPdfCompiler();
    t.mock.method(TypstSandboxCompiler.prototype,'compile',instance.compile.bind(instance));
}
test('e2e-disk: unified PDF Folder Writer creates a parseable physical file',async t=>{
    const h=v2LiveSaveHost(t);compiler(t);const tmp=freshTempDir('pdf-e2e-disk-single-');
    try{
        h.directory(makeNodeDirHandle(tmp));const title='E2E Disk Single Chat';
        const id=await seed(makeSample('single',title));
        const result=await runExport(exportRequest([id],{format:'pdf',delivery:'folderWriter',includeAssets:true}));
        assert.equal(result.exported,1);assert.deepEqual(result.failed,[]);
        const pdfs=pdfFilesRecursive(tmp);assert.equal(pdfs.length,1);
        const bytes=fs.readFileSync(pdfs[0]);assert.ok(bytes.length>0);assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
        const extracted=extractPdfText(bytes);assert.ok(extracted.pageCount>=1);assert.ok(extracted.text.includes(title));
        assert.ok(extracted.text.includes('Shopping list'));assert.ok(extracted.text.includes('milk'));
        const record=await getExportRecord(exportKey(id));assert.equal(record?.format,'pdf');assert.equal(record?.status,'partial');
        assert.deepEqual(Object.keys(record!).sort(),['attachmentIssues','exportedAt','folderBaseName','format','includeAssets','otherContentMissing','status']);
        assert.equal(record?.folderBaseName, path.basename(pdfs[0], '.pdf'));
        assert.ok(record!.attachmentIssues!.length > 0, 'persist attachment reasons for the delivered partial PDF');
    }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
test('e2e-disk: Browser batch ZIP reopens from disk with three distinct parseable PDFs',async t=>{
    const h=v2ExportHost(t);compiler(t);const tmp=freshTempDir('pdf-e2e-disk-zip-');
    const previous=__getZipConstructor();__setZipConstructor(JSZip);t.after(()=>__setZipConstructor(previous));
    try{
        const specs=[{suffix:'a',title:'E2E Batch Chat Alpha',marker:'UNIQUE-MARKER-ALPHA-7f3a'},
            {suffix:'b',title:'E2E Batch Chat Beta',marker:'UNIQUE-MARKER-BETA-9c1e'},
            {suffix:'c',title:'E2E Batch Chat Gamma',marker:'UNIQUE-MARKER-GAMMA-42bd'}];
        const ids=[];for(const spec of specs)ids.push(await seed(makeSample(spec.suffix,spec.title,spec.marker)));
        const result=await runExport(exportRequest(ids,{format:'pdf',includeAssets:false}));
        assert.equal(result.exported,3);assert.deepEqual(result.failed,[]);assert.equal(h.clicks(),1);assert.equal(h.blobs.length,1);
        const zipPath=path.join(tmp,h.filenames[0]);fs.writeFileSync(zipPath,Buffer.from(await h.blobs[0].arrayBuffer()));assert.ok(fs.statSync(zipPath).size>0);
        const zip=await JSZip.loadAsync(fs.readFileSync(zipPath));
        const entries=Object.values(zip.files).filter((f:any)=>!f.dir&&f.name.endsWith('.pdf')) as any[];assert.equal(entries.length,3);
        const seen=new Set<string>();for(const entry of entries){
            const data=await entry.async('uint8array');assert.equal(Buffer.from(data.subarray(0,5)).toString(),'%PDF-');
            const extracted=extractPdfText(data);assert.ok(extracted.pageCount>=1);
            const spec=specs.find(s=>extracted.text.includes(s.title));assert.ok(spec);assert.ok(extracted.text.includes(spec.marker));
            for(const other of specs)if(other!==spec)assert.ok(!extracted.text.includes(other.marker));seen.add(spec.marker);
        }
        assert.equal(seen.size,3);for(const id of ids)assert.equal((await getExportRecord(exportKey(id)))?.format,'pdf');
    }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
});

__suiteDescribe("pdf-exporter-dispose", () => {
// Compiler lifetime moved from PdfExporter/UI controller into unified Export.
const document: DocumentAst = { title: 'Owned compiler', metadata: { id: 'dispose', provider: 'gemini' }, messages: [] };
const context = () => ({ signal: new AbortController().signal, reportProgress() {} });
test('pure PDF format leaves an injected compiler owned by its caller on success and failure', async () => {
    let disposed = 0, fail = false;
    const compiler = { name: 'caller-owned', dispose() { disposed++; }, async compile() {
        if (fail) throw new Error('compile failed'); return { pdfBytes: buildMinimalValidPdf(), diagnostics: [] };
    } };
    await compileDocumentPdf(document, {}, new Map(), compiler, context());
    fail = true;
    await assert.rejects(compileDocumentPdf(document, {}, new Map(), compiler, context()), /compile failed/);
    assert.equal(disposed, 0);
});
for (const mode of ['success', 'failure', 'abort'] as const) {
    test(`unified Export disposes its owned compiler exactly once after ${mode}`, async t => {
        const host = v2ExportHost(t);
        await seedExportConversation('dispose');
        const controller = new AbortController();
        const compile = t.mock.method(TypstSandboxCompiler.prototype, 'compile', async () => {
            if (mode === 'failure') throw new Error('compile failed');
            if (mode === 'abort') { controller.abort(); controller.signal.throwIfAborted(); }
            return { pdfBytes: buildMinimalValidPdf(), diagnostics: [] };
        });
        const dispose = t.mock.method(TypstSandboxCompiler.prototype, 'dispose');
        const result = await runExport(exportRequest(['dispose'], { format: 'pdf' }), { signal: controller.signal });
        assert.equal(compile.mock.callCount(), 1);
        assert.equal(dispose.mock.callCount(), 1);
        assert.equal(host.clicks(), mode === 'success' ? 1 : 0);
        assert.equal(result.exported, mode === 'success' ? 1 : 0);
        assert.equal(result.aborted, mode === 'abort');
        assert.equal(result.failed.length, mode === 'failure' ? 1 : 0);
    });
}
test('cancellation before compiler initialization allocates no sandbox', async t => {
    v2ExportHost(t);
    const dispose = t.mock.method(TypstSandboxCompiler.prototype, 'dispose');
    const controller = new AbortController(); controller.abort();
    assert.equal((await runExport(exportRequest(['unstarted'], { format: 'pdf' }), { signal: controller.signal })).aborted, true);
    assert.equal(dispose.mock.callCount(), 0);
});
test('batch conversations share one compiler and dispose it once at task end', async t => {
    v2ExportHost(t);
    await seedExportConversation('one'); await seedExportConversation('two');
    const { __setZipConstructor, __getZipConstructor } = require('../src/l4/packaging/writers/zipWriter.js');
    const previous = __getZipConstructor(); __setZipConstructor(require('../lib/jszip.min.js'));
    t.after(() => __setZipConstructor(previous));
    const instances = new Set<TypstSandboxCompiler>();
    t.mock.method(TypstSandboxCompiler.prototype, 'compile', async function(this: TypstSandboxCompiler) {
        instances.add(this); return { pdfBytes: buildMinimalValidPdf(), diagnostics: [] };
    });
    const dispose = t.mock.method(TypstSandboxCompiler.prototype, 'dispose');
    assert.equal((await runExport(exportRequest(['one', 'two'], { format: 'pdf' }))).exported, 2);
    assert.equal(instances.size, 1); assert.equal(dispose.mock.callCount(), 1);
});
test('sandbox disposal itself is idempotent before and after initialization', () => {
    const compiler = new TypstSandboxCompiler();
    assert.doesNotThrow(() => compiler.dispose());
    assert.doesNotThrow(() => compiler.dispose());
});
});

__suiteDescribe("pdf-options-metadata-resolution", () => {
/**
 * V2 metadata-only Options/PDF regression.
 *
 * Options now supplies only ConversationKey[] to runExport. L1 admits a fetched
 * Detail through L2; Export re-reads the trusted Index + Detail. No PdfExporter,
 * fetchChatDetail DTO, duplicate StorageService, or old PDF stage exists.
 */


















useIndexStorage();

const account = fixtureAccount('custom');
const VERSION = 1_700_000_000_000;
const MARKER = 'REGRESSION-MARKER-9f2c71';

function key(conversationId: string): ConversationKey {
    return { accountId: account.id, conversationId };
}
function request(conversationId: string): ExportRequest {
    return { keys: [key(conversationId)], format: 'markdown', delivery: 'browserDownload',
        includeAssets: false, skipUnchanged: false };
}
function detail(body: string, savedAt = VERSION) {
    return {
        savedAt,
        quality: { status: 'complete' as const },
        assets: [],
        messages: [{ role: 'assistant' as const, content: [
            { type: 'paragraph' as const, children: [{ type: 'text' as const, text: body }] },
        ] }],
    };
}
async function admitMetadata(conversationId: string, title: string, updatedAt = VERSION): Promise<void> {
    await ingestIndexes(account.id, [{ conversationId,
        fields: { title, titleSource: 'user', updatedAt } }]);
}
async function exportMarkdown(conversationId: string) {
    // The indexStorage fake navigator only implements Web Locks, not navigator.language.
    await updateSettings({ language: 'en' });
    return runExport(request(conversationId));
}
function mockProvider(fetchConversationDetail: AIProvider['fetchConversationDetail']): () => void {
    const previous = ProviderRegistry.get('custom');
    const provider: AIProvider = {
        id: 'custom', name: 'Options metadata test provider', hostPatterns: [],
        matchesUrl: () => false,
        checkReadiness: async () => ({ ready: true }),
        listConversations: async () => 'source_end',
        fetchConversationDetail,
        acquireResource: async () => { throw new Error('No assets needed'); },
    };
    ProviderRegistry.register(provider);
    return () => {
        ProviderRegistry.unregister('custom');
        if (previous) ProviderRegistry.register(previous);
    };
}
function captureDownloads() {
    const blobs: Blob[] = [];
    const fileNames: string[] = [];
    const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const oldMouseEvent = Object.getOwnPropertyDescriptor(globalThis, 'MouseEvent');
    Object.defineProperty(globalThis, 'MouseEvent', { configurable: true, value: Event });
    const oldCreate = URL.createObjectURL;
    const oldRevoke = URL.revokeObjectURL;
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
            body: { appendChild() {} },
            createElement(tag: string) {
                assert.equal(tag, 'a');
                return {
                    href: '', download: '',
                    dispatchEvent() { fileNames.push(this.download); return true; },
                    remove() {},
                };
            },
        },
    });
    URL.createObjectURL = ((blob: Blob) => {
        blobs.push(blob);
        return 'blob:pdf-metadata-' + blobs.length;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = () => {};
    return {
        blobs, fileNames,
        restore() {
            URL.createObjectURL = oldCreate;
            URL.revokeObjectURL = oldRevoke;
            if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
            else Reflect.deleteProperty(globalThis, 'document');
            if (oldMouseEvent) Object.defineProperty(globalThis, 'MouseEvent', oldMouseEvent);
            else Reflect.deleteProperty(globalThis, 'MouseEvent');
        },
    };
}

/** Keep the PDF check at the v2 L4 IPdfCompiler seam, not a removed PdfExporter. */
function textOf(value: unknown): string {
    if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(' ');
    if (!value || typeof value !== 'object') return '';
    const node = value as Record<string, unknown>;
    return [
        typeof node.text === 'string' ? node.text : '',
        textOf(node.children), textOf(node.blocks), textOf(node.items),
    ].filter(Boolean).join(' ');
}
function escapePdfText(text: string): string {
    return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
function textPdf(title: string, body: string): Uint8Array {
    const enc = new TextEncoder();
    const stream = [
        'BT /F1 24 Tf 72 720 Td',
        '(' + escapePdfText(title) + ') Tj',
        '0 -36 Td /F1 12 Tf',
        '(' + escapePdfText(body.slice(0, 400)) + ') Tj',
        'ET',
    ].join('\n');
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        '<< /Length ' + enc.encode(stream).length + ' >>\nstream\n' + stream + '\nendstream',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let content = '%PDF-1.4\n';
    const offsets: number[] = [];
    for (const [index, object] of objects.entries()) {
        offsets.push(enc.encode(content).length);
        content += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
    }
    const xrefAt = enc.encode(content).length;
    content += 'xref\n0 6\n0000000000 65535 f \n';
    for (const off of offsets) content += String(off).padStart(10, '0') + ' 00000 n \n';
    return enc.encode(content + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrefAt + '\n%%EOF\n');
}

test('Options list metadata alone refreshes L2 Detail before exporting the full body', async () => {
    const id = 'options-metadata';
    await admitMetadata(id, 'Canonical list title');
    assert.equal(await getDetail(key(id)), null, 'list metadata must not masquerade as a Detail');
    let fetches = 0;
    const restoreProvider = mockProvider(async (accountId, conversationId) => {
        fetches++;
        assert.deepEqual({ accountId, conversationId }, key(id));
        await ingestDetail(accountId, conversationId, detail('Complete conversation body ' + MARKER),
            { title: 'Lower authority candidate', titleSource: 'derived', updatedAt: VERSION });
    });
    const downloads = captureDownloads();
    try {
        const result = await exportMarkdown(id);
        assert.deepEqual({ exported: result.exported, partial: result.partial, failed: result.failed },
            { exported: 1, partial: 0, failed: [] });
        assert.equal(fetches, 1, 'only L1 fetches; the response is never treated as a Detail DTO');
        assert.equal(downloads.blobs.length, 1);
        assert.equal(downloads.fileNames.length, 1);
        const output = await downloads.blobs[0].text();
        assert.match(output, /Canonical list title/);
        assert.match(output, /REGRESSION-MARKER-9f2c71/);
        assert.doesNotMatch(output, /Lower authority candidate/);
        assert.equal((await readConversation(key(id)))?.detail.messages.length, 1);
        const record = await getExportRecord(key(id));
        assert.ok(record);
        assert.equal(record.status, 'ok');
        assert.equal(record.chatTime, VERSION);
        assert.ok(!('title' in record), 'v2 ExportRecord stores no duplicate title');
    } finally {
        downloads.restore();
        restoreProvider();
    }
});

test('a key-only selection without an Index may still be resolved by L1 and exported', async () => {
    const id = 'key-only';
    assert.equal(await getIndex(key(id)), null);
    let calls = 0;
    const restoreProvider = mockProvider(async (accountId, conversationId) => {
        calls++;
        await ingestDetail(accountId, conversationId, detail('Key-only full body ' + MARKER),
            { title: 'Resolved by provider', titleSource: 'provider', updatedAt: VERSION });
    });
    const downloads = captureDownloads();
    try {
        const result = await exportMarkdown(id);
        assert.equal(result.exported, 1);
        assert.equal(result.failed.length, 0);
        assert.equal(calls, 1);
        assert.equal((await getIndex(key(id)))?.title, 'Resolved by provider');
        assert.match(await downloads.blobs[0].text(), /Key-only full body REGRESSION-MARKER-9f2c71/);
    } finally {
        downloads.restore();
        restoreProvider();
    }
});

test('metadata-only Index cannot produce an empty export if the provider returns without admitting Detail', async () => {
    const id = 'no-detail-commit';
    await admitMetadata(id, 'Index only');
    let fetches = 0;
    const restoreProvider = mockProvider(async () => { fetches++; });
    const downloads = captureDownloads();
    try {
        const result = await exportMarkdown(id);
        assert.equal(fetches, 1);
        assert.deepEqual(result.failed, [key(id)]);
        assert.equal(result.exported, 0);
        assert.equal(downloads.blobs.length, 0);
        assert.equal(await getDetail(key(id)), null);
        assert.equal(await getExportRecord(key(id)), null);
    } finally {
        downloads.restore();
        restoreProvider();
    }
});

test('offline metadata-only resolution fails closed without writing an ExportRecord', async () => {
    const id = 'unavailable-detail';
    await admitMetadata(id, 'Not fetched');
    const restoreProvider = mockProvider(async () => { throw new Error('network unavailable'); });
    const downloads = captureDownloads();
    try {
        const result = await exportMarkdown(id);
        assert.deepEqual(result.failed, [key(id)]);
        assert.equal(result.exported, 0);
        assert.equal(downloads.blobs.length, 0);
        assert.equal(await getExportRecord(key(id)), null);
    } finally {
        downloads.restore();
        restoreProvider();
    }
});

test('a newer authoritative Index title survives stale local Detail fallback; version stays on Detail', async () => {
    const id = 'title-and-version';
    await ingestDetail(account.id, id, detail('Retained older body ' + MARKER),
        { title: 'Old body title', titleSource: 'derived', updatedAt: VERSION });
    await admitMetadata(id, 'Current Index Title', VERSION + 1000);
    const restoreProvider = mockProvider(async () => { throw new Error('temporarily offline'); });
    const downloads = captureDownloads();
    try {
        const result = await exportMarkdown(id);
        assert.equal(result.exported, 1, 'recoverable fetch failure may use already-admitted Detail');
        assert.equal(result.partial, 1, 'body is older than current Index version');
        assert.deepEqual(result.failed, []);
        const output = await downloads.blobs[0].text();
        assert.match(output, /Current Index Title/);
        assert.match(output, /Retained older body REGRESSION-MARKER-9f2c71/);
        assert.doesNotMatch(output, /Old body title/);
        const record = await getExportRecord(key(id));
        assert.ok(record);
        assert.equal(record.status, 'partial');
        assert.equal(record.chatTime, VERSION, 'must not substitute Index.updatedAt for the saved body version');
        assert.equal((await readConversation(key(id)))?.index.title, 'Current Index Title');

        await ingestDeletedConversation(account.id, id);
        assert.equal(await readConversation(key(id)), null);
        assert.equal(await getExportRecord(key(id)), null);
        const second = await exportMarkdown(id);
        assert.equal(second.exported, 0);
        assert.deepEqual(second.failed, [key(id)]);
        assert.equal(downloads.blobs.length, 1, 'deleted Detail cannot be exported through stale selection metadata');
    } finally {
        downloads.restore();
        restoreProvider();
    }
});

test('v2 L2 Index metadata and nonempty Detail reach PDF Format as the same document', async () => {
    const id = 'pdf-boundary';
    await ingestDetail(account.id, id, detail('PDF authored body ' + MARKER),
        { title: 'Old snapshot heading', titleSource: 'derived', updatedAt: VERSION });
    await admitMetadata(id, 'Authoritative PDF Title', VERSION + 1000);
    const conversation = await readConversation(key(id));
    assert.ok(conversation);
    const document = composeDomainDocument(conversation, account);
    assert.equal(document.title, 'Authoritative PDF Title');
    assert.equal(document.messages.length, 1);
    let compiled = 0;
    const compiler: IPdfCompiler = {
        name: 'metadata-content-pdf-check',
        async compile(payload) {
            compiled++;
            assert.equal(payload.document.title, 'Authoritative PDF Title');
            assert.equal(payload.document.messages.length, 1);
            const body = textOf(payload.document.messages);
            assert.match(body, /PDF authored body REGRESSION-MARKER-9f2c71/);
            return { pdfBytes: textPdf(payload.document.title, body), diagnostics: [] };
        },
    };
    const pdf = await compileDocumentPdf(document, {}, new Map(), compiler,
        { signal: new AbortController().signal, reportProgress() {} }, { locale: 'en' });
    assert.equal(compiled, 1);
    const extracted = extractPdfText(pdf.pdfBytes);
    assert.equal(extracted.pageCount, 1);
    assert.match(extracted.text, /Authoritative PDF Title/);
    assert.match(extracted.text, /PDF authored body REGRESSION-MARKER-9f2c71/);
    assert.doesNotMatch(extracted.text, /0 messages|Old snapshot heading/);
});
});

__suiteDescribe("pdf-release-gates", () => {
/**
 * tests/pdf-release-gates.test.ts
 * §16 P0 release-blocker gates: formula-as-text + Chinese lossless at the
 * Typst payload level (Tier 1, runs before build.js — no dist/ dependency).
 *
 * P0 formal experiment结论 (goals/gemini-exporter/hidden_files/p0-formal/REPORT.md):
 *  - 公式必须为可选文本，绝不是图片 (pypdf 提取到 𝑥/Δ/±/√ 等真实字形, 嵌入图片数=0)
 *  - 中文 2000+ 字零丢失
 *  - 转换失败的公式必须可见 (原文回退), 不静默丢
 *
 * These tests pin those invariants at the Document AST/PDF backend boundary: if the
 * adapter ever turns math into an image placeholder, mangles Chinese text,
 * or silently drops an unconvertible formula, the gate fails.
 *
 * 已知缺口 (生产逻辑, 本测试不覆盖、留给 P1a/F2 完整转换器):
 *  payload.ts 对 convertMath 失败当前只做原文回退, 不发射 diagnostic。
 *  本测试锁定"原文回退可见"这一现有保证; 加 diagnostic 属 src/ 生产逻辑
 *  改动, 不在本 PR 地盘内。
 */

const test = require('node:test');
const assert = require('node:assert');

const { renderTypstFixture } = require('./helpers/renderTypstFixture.js');
const { composeDomainDocument } = require('../src/l3b/compose/composeDomainDocument.js');


/** 千字文 + 常用符号/数字/希腊字母, 单份 ~1100 字; 重复两次 > 2000 字。 */
const ZH_UNIT =
    '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天地玄黄宇宙洪荒日月盈昃' +
    '辰宿列张寒来暑往秋收冬藏闰余成岁律吕调阳云腾致雨露结为霜金生丽水玉出' +
    '昆冈剑号巨阙珠称夜光果珍李柰菜重芥姜海咸河淡鳞潜羽翔龙师火帝鸟官人皇' +
    '始制文字乃服衣裳推位让国有虞陶唐吊民伐罪周发殷汤坐朝问道垂拱平章爱育' +
    '黎首臣伏戎羌遐迩一体率宾归王鸣凤在竹白驹食场化被草木赖及万方盖此身发' +
    '四大五常恭惟鞠养岂敢毁伤女慕贞洁男效才良知过必改得能莫忘罔谈彼短靡恃' +
    '己长信使可覆器欲难量墨悲丝染诗赞羔羊景行维贤克念作圣德建名立形端表正' +
    '空谷传声虚堂习听祸因恶积福缘善庆尺璧非宝寸阴是竞资父事君曰严与敬孝当' +
    '竭力忠则尽命临深履薄夙兴温凊似兰斯馨如松之盛川流不息渊澄取映容止若思' +
    '言辞安定笃初诚美慎终宜令荣业所基籍甚无竟学优登仕摄职从政存以甘棠去而' +
    '益咏乐殊贵贱礼别尊卑上和下睦夫唱妇随外受傅训入奉母仪诸姑伯叔犹子比儿' +
    '孔怀兄弟同气连枝交友投分切磨箴规仁慈隐恻造次弗离节义廉退颠沛匪亏性静' +
    '情逸心动神疲守真志满逐物意移坚持雅操好爵自縻都邑华夏东西二京背邙面洛' +
    '浮渭据泾宫殿盘郁楼观飞惊图写禽兽画彩仙灵丙舍旁启甲帐对楹肆筵设席鼓瑟' +
    '吹笙升阶纳陛弁转疑星右通广内左达承明既集坟典亦聚群英杜稿钟文漆书壁经' +
    '府罗将相路侠槐卿户封八县家给千兵高冠陪辇驱毂振缨世禄侈富车驾肥轻策功' +
    '茂实勒碑刻铭磻溪伊尹佐时阿衡奄宅曲阜微旦孰营桓公匡合济弱扶倾绮回汉惠' +
    '说感武丁俊乂密勿多士实宁晋楚更霸赵魏困横假途灭虢践土会盟何遵约法韩弊' +
    '烦刑起翦颇牧用军最精宣威沙漠驰誉丹青九州禹迹百郡秦并岳宗泰岱禅主云亭' +
    '雁门紫塞鸡田赤城昆池碣石巨野洞庭旷远绵邈岩岫杳冥治本于农务兹稼穑俶载' +
    '南亩我艺黍稷税熟贡新劝赏黜陟孟轲敦素史鱼秉直庶几中庸劳谦谨敕聆音察理' +
    '鉴貌辨色贻厥嘉猷勉其祗植省躬讥诫宠增抗极殆辱近耻林皋幸即两疏见机解组' +
    '谁逼索居闲处沉默寂寥求古寻论散虑逍遥欣奏累遣戚谢欢招渠荷的历园莽抽条' +
    '枇杷晚翠梧桐蚤凋陈根委翳落叶飘摇游鹍独运凌摩绛霄耽读玩市寓目囊箱易輶' +
    '攸畏属耳垣墙具膳餐饭适口充肠饱饫烹宰饥厌糟糠亲戚故旧老少异粮妾御绩纺' +
    '侍巾帷房纨扇圆洁银烛炜煌昼眠夕寐蓝笋象床弦歌酒宴接杯举觞矫手顿足悦豫' +
    '且康嫡后嗣续祭祀烝尝稽颡再拜悚惧恐惶笺牒简要顾答审详骸垢想浴执热愿凉' +
    '驴骡犊特骇跃超骧诛斩贼盗捕获奸宄满招损谦受益时中 1234567890 ' +
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz ' +
    '零一二三四五六七八九十百千万亿兆 π≈3.14159265358979 e≈2.71828182845905 ' +
    'αβγδεζηθικλμνξοπρστυφχψω ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ ' +
    '∂∇∫∑∏√±×÷∞∠∴∵∽≈≠≡≤≥∈∀∃∅△□○◇☆★';

/** > 2000 字的混合中英数长文本, 确定性构造。 */
const ZH_LONG = `${ZH_UNIT}‖${ZH_UNIT}`;
assert.ok(ZH_LONG.length > 2000, `fixture must exceed 2000 chars, got ${ZH_LONG.length}`);

const INLINE_LATEX = 'E = mc^2';
const DISPLAY_LATEX_OK = '\\frac{a}{b} + \\sqrt{x}';
/** P0 报告同款故意不可转换公式: mathshim 子集拒收 operatormame。 */
const DISPLAY_LATEX_UNCONVERTIBLE = '\\operatorname{erf}(x) = \\frac{2}{\\sqrt{\\pi}}\\int_0^x e^{-t^2}\\,dt';

/**
 * 最小受控转换器 (模拟 P0 实验 mathshim): 只认 frac/sqrt 子集,
 * 其余返回 undefined -> adapter 走原文回退。
 */
function fakeConvertMath(source: string, _display: boolean): string | undefined {
    if (source.includes('\\operatorname')) return undefined;
    if (source.includes('\\frac') || source.includes('\\sqrt')) return `TYPST(${source})`;
    if (/^[A-Za-z0-9 =^+_\-{}]+$/.test(source)) return `TYPST(${source})`;
    return undefined;
}

function domainFixture(messages: any[], assets: any[] = []) {
    return { index: { key: fixtureKey(String('c1'), 'gemini'),   titleSource: "derived",   title: 'P0 门禁回归', createdAt: '2026-09-26T10:00:00Z' }, detail: { key: fixtureKey(String('c1'), 'gemini'), quality: { status: 'unknown' }, assets, messages: messages } };
}

function msg(id: string, role: string, blocks: any[]) {
    return { id, role, content: blocks };
}

const opts = { convertMath: fakeConvertMath };

function gatesBundle() {
    const mid = Math.floor(ZH_LONG.length / 2);
    const zhHead = ZH_LONG.slice(0, mid);
    const zhTail = ZH_LONG.slice(mid);
    return domainFixture([
        msg('m1', 'user', [
            { type: 'heading', level: 2, children: [{ type: 'text', text: '中文长文本完整性验证' }] },
            {
                type: 'paragraph',
                children: [
                    { type: 'text', text: zhHead },
                    { type: 'inlineMath', source: INLINE_LATEX },
                    { type: 'text', text: zhTail },
                ],
            },
        ]),
        msg('m2', 'assistant', [
            { type: 'math', source: DISPLAY_LATEX_OK },
            { type: 'math', source: DISPLAY_LATEX_UNCONVERTIBLE },
            { type: 'paragraph', children: [{ type: 'text', text: '以上是两个公式, 其中第二个故意超出转换器能力。' }] },
        ]),
    ]);
}

/** 递归收集 payload 里所有 math/inlineMath 节点。 */
function collectMathNodes(payload: any): any[] {
    const out: any[] = [];
    const walk = (o: any): void => {
        if (Array.isArray(o)) { o.forEach(walk); return; }
        if (o && typeof o === 'object') {
            if (o.type === 'math' || o.type === 'inlineMath') out.push(o);
            Object.values(o).forEach(walk);
        }
    };
    walk(payload);
    return out;
}

/** 递归收集 payload 里所有 image 节点。 */
function collectImageNodes(payload: any): any[] {
    const out: any[] = [];
    const walk = (o: any): void => {
        if (Array.isArray(o)) { o.forEach(walk); return; }
        if (o && typeof o === 'object') {
            if (o.type === 'image') out.push(o);
            Object.values(o).forEach(walk);
        }
    };
    walk(payload);
    return out;
}

/** 递归收集对象里所有字符串值 (用于 JSON 往返后的可见性断言)。 */
function collectAllStrings(o: any): string[] {
    const out: string[] = [];
    const walk = (v: any): void => {
        if (typeof v === 'string') { out.push(v); return; }
        if (Array.isArray(v)) { v.forEach(walk); return; }
        if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(o);
    return out;
}


test('P0 gate (a): math travels as TEXT in the payload, never an image placeholder', () => {
    const { payload, diagnostics } = renderTypstFixture(composeDomainDocument(gatesBundle(), fixtureAccountFor(gatesBundle())), {}, opts);
    assert.strictEqual(payload.messages.length, 2);

    const maths = collectMathNodes(payload);
    assert.strictEqual(maths.length, 3, `expected 1 inline + 2 display math nodes, got ${maths.length}`);

    const byLatex = new Map(maths.map((m: any) => [m.latex, m]));

    // 行内公式: latex 源码逐字保留, 且有文本形式的转换结果。
    const inline = byLatex.get(INLINE_LATEX);
    assert.ok(inline, 'inline math node must exist');
    assert.strictEqual(inline.type, 'inlineMath');
    assert.strictEqual(inline.latex, INLINE_LATEX, 'inline latex must be byte-identical');
    assert.ok(typeof inline.typst === 'string' && inline.typst.length > 0, 'converted math must be text');

    // 行间公式 (可转换): 同样走文本。
    const displayOk = byLatex.get(DISPLAY_LATEX_OK);
    assert.ok(displayOk, 'display math node must exist');
    assert.strictEqual(displayOk.type, 'math');
    assert.strictEqual(displayOk.latex, DISPLAY_LATEX_OK);
    assert.ok(typeof displayOk.typst === 'string' && displayOk.typst.includes('TYPST('));

    // 绝不是图片占位: payload 里没有任何 image 节点携带公式, 也没有任何
    // data:image URI (P0: 4 份 PDF 嵌入图片数 = 0, 公式为可选文本)。
    const images = collectImageNodes(payload);
    assert.deepStrictEqual(images, [], 'no image nodes may appear for math content');
    const json = JSON.stringify(payload);
    assert.ok(!json.includes('data:image'), 'payload must not embed image data URIs');
    // JSON 往返后 (模板走 json() 消费), 公式源码必须仍以文本形式存在。
    const allText = collectAllStrings(JSON.parse(json)).join('\n');
    for (const src of [INLINE_LATEX, DISPLAY_LATEX_OK, DISPLAY_LATEX_UNCONVERTIBLE]) {
        assert.ok(allText.includes(src), `math source must survive JSON round-trip as text: ${src.slice(0, 30)}…`);
    }
    void diagnostics;
});


test('P0 gate (b): 2000+ char Chinese text survives byte-identical', () => {
    const { payload } = renderTypstFixture(composeDomainDocument(gatesBundle(), fixtureAccountFor(gatesBundle())), {}, opts);
    assert.strictEqual(payload.messages.length, 2);

    // 用户消息段落: text 节点拼接必须与输入逐字相等。
    const para: any = payload.messages[0].blocks[1];
    assert.strictEqual(para.type, 'paragraph');
    const roundTripped = para.children.map((c: any) => c.text ?? '').join('');
    assert.strictEqual(roundTripped, ZH_LONG, 'Chinese long text must be byte-identical (exact equality)');
    assert.ok(roundTripped.length > 2000, `must exceed 2000 chars, got ${roundTripped.length}`);

    // 标题中文同样精确无损。
    const heading: any = payload.messages[0].blocks[0];
    assert.strictEqual(heading.children[0].text, '中文长文本完整性验证');

    // JSON 序列化往返 (模板走 json() 消费) 不丢字: 在解析后的结构上重组段落文本。
    const reparsed = JSON.parse(JSON.stringify(payload));
    const reParaText = reparsed.messages[0].blocks[1].children.map((c: any) => c.text ?? '').join('');
    assert.strictEqual(reParaText, ZH_LONG, 'full 2000+ char text must survive JSON round-trip intact');
    const allText = collectAllStrings(reparsed).join('');
    assert.ok(allText.includes('中文长文本完整性验证'), 'heading Chinese must survive JSON round-trip');

    // plainText 摘要同样包含完整中文 (P0: s4 2076 字全部命中)。
    // 注: plainInline 把行内公式展开为源码, 所以摘要 = 中文前半 + 公式源码 + 中文后半。
    const plain: string = payload.messages[0].plainText ?? '';
    const mid = Math.floor(ZH_LONG.length / 2);
    assert.ok(plain.includes(ZH_LONG.slice(0, mid)), 'plainText must contain Chinese head verbatim');
    assert.ok(plain.includes(ZH_LONG.slice(mid)), 'plainText must contain Chinese tail verbatim');
    assert.ok(plain.includes(INLINE_LATEX), 'plainText must contain inline math source');
});


test('P0 gate (c): unconvertible formula degrades to visible source fallback, never silently dropped', () => {
    const { payload, diagnostics } = renderTypstFixture(composeDomainDocument(gatesBundle(), fixtureAccountFor(gatesBundle())), {}, opts);

    const maths = collectMathNodes(payload);
    const failed = maths.find((m: any) => m.latex === DISPLAY_LATEX_UNCONVERTIBLE);
    assert.ok(failed, 'unconvertible formula node must still exist in payload (not dropped)');
    assert.strictEqual(failed.type, 'math');
    // 原文回退: latex 源码逐字保留, 无伪造的 typst 转换结果。
    assert.strictEqual(failed.latex, DISPLAY_LATEX_UNCONVERTIBLE, 'failed formula source must be preserved verbatim');
    assert.ok(!('typst' in failed), 'no fabricated typst output for failed conversion');

    // 可见性: 源码全文在 JSON 往返后仍以文本存在 (模板侧渲染为可见注释, 见 payload.ts 模块注释)。
    const allText = collectAllStrings(JSON.parse(JSON.stringify(payload))).join('\n');
    assert.ok(allText.includes(DISPLAY_LATEX_UNCONVERTIBLE), 'failed formula source must be visible in payload as text');

    // 节点计数对账: 3 个输入公式 -> 3 个 payload 公式节点, 一个都不能少。
    assert.strictEqual(maths.length, 3, 'every input formula must yield exactly one payload node');
    void diagnostics;
});

test('P0 gate (c2): formula node count reconciles against bundle input (no silent loss)', () => {
    const b = gatesBundle();
    const inputMathCount = b.detail.messages
        .flatMap((m: any) => m.content)
        .filter((blk: any) => blk.type === 'math').length
        + b.detail.messages
            .flatMap((m: any) => m.content)
            .flatMap((blk: any) => blk.children ?? [])
            .filter((n: any) => n.type === 'inlineMath').length;
    assert.strictEqual(inputMathCount, 3);
    const { payload } = renderTypstFixture(composeDomainDocument(b, fixtureAccountFor(b)), Object.fromEntries(b.detail.assets.map((asset: { id: string }) => [asset.id, `assets/${asset.id}.png`])), opts);
    assert.strictEqual(collectMathNodes(payload).length, inputMathCount,
        'payload math node count must equal bundle math node count');
});
});

__suiteDescribe("pdf-stream-parser", () => {
for (const ending of [0x0a, 0x0d]) {
    test__s8(`PDF probe preserves compressed stream ending in ${ending.toString(16)}`, () => {
        const original = Buffer.from([0, ending - 1]);
        const compressed = deflateSync(original);
        assert.equal(compressed.at(-1), ending, 'fixture exercises a real compressed CR/LF byte');
        const pdf = Buffer.concat([
            Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`),
            compressed, Buffer.from('\nendstream\nendobj\n%%EOF\n'),
        ]);
        const obj = parseObjects(pdf).get(1)!;
        assert.deepEqual(obj.stream, compressed);
        assert.deepEqual(inflateIfNeeded(obj), original);
    });
}

test__s8('PDF probe preserves declared plain-text stream including trailing line breaks', () => {
    const original = Buffer.from('BT (text) Tj ET\n\n');
    const pdf = Buffer.concat([Buffer.from(`1 0 obj\n<< /Length ${original.length} >>\nstream\n`), original, Buffer.from('\nendstream\nendobj')]);
    assert.deepEqual(parseObjects(pdf).get(1)?.stream, original);
});


test__s8('outer ActualText replaces nested glyph spans once and preserves real repetition', () => {
    const content = 'BT /Span << /ActualText <FEFF00780302> >> BDC /Span << /ActualText (x) >> BDC (x) Tj EMC (hat) Tj EMC (xx) Tj ET';
    const pdf = Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n2 0 obj\n<< /Type /Page /Contents 1 0 R >>\nendobj`);
    assert.equal(extractPdfText(pdf).text, 'x\u0302xx');
});
});

__suiteDescribe("pdf_resource_acquisition", () => {
const url = 'https://lh3.googleusercontent.com/shared-image';
const firstBytes = new Uint8Array([11, 22, 33]);
const secondBytes = new Uint8Array([44, 55, 66]);

/** V2 identities and durable locators are L2 facts; network hints/bytes are not. */
function conversation() {
    const key = fixtureKey('resource-boundary');
    const assets: DomainAsset[] = [
        { id: 'image-request-one', kind: 'image', name: 'same.png', mediaType: 'image/png',
            sourceUri: url, generation: { providerRequestId: 'request-one', imageOrdinal: 0 } },
        { id: 'image-request-two', kind: 'image', name: 'same.png', mediaType: 'image/png',
            sourceUri: url, generation: { providerRequestId: 'request-two', imageOrdinal: 0 } },
    ];
    return validateParserDomain({
        index: { key, title: 'Boundary', titleSource: 'provider' },
        detail: { key, quality: { status: 'complete' }, assets, messages: [
            { role: 'assistant', content: [{ type: 'image', assetId: assets[0].id }] },
            { role: 'assistant', content: [{ type: 'image', assetId: assets[1].id }] },
        ] },
    });
}

test('same source URL with distinct generation identities is acquired once per v2 Asset ID', async () => {
    const domain = conversation();
    const original = structuredClone(domain);
    const ids = domain.detail.assets.map(asset => asset.id);
    const document = composeDomainDocument(domain, fixtureAccountFor(domain));
    const references = collectDocumentResources(document);
    assert.deepEqual([...references.imageIds], ids);
    assert.deepEqual([...references.referencedIds], ids);

    const calls: string[] = [];
    const prepared = await prepareExportResources(domain.detail.assets, references.referencedIds, async asset => {
        calls.push(asset.id);
        assert.equal(asset.sourceUri, url);
        assert.equal(asset.name, 'same.png', 'the shared export name is not the acquisition key');
        assert.equal(asset.generation?.providerRequestId, asset.id === ids[0] ? 'request-one' : 'request-two');
        return { bytes: asset.id === ids[0] ? firstBytes : secondBytes };
    });

    assert.deepEqual(calls, ids);
    assert.deepEqual(resourceValue(prepared.get(ids[0])).bytes, firstBytes);
    assert.deepEqual(resourceValue(prepared.get(ids[1])).bytes, secondBytes);
    assert.equal(resourceValue(prepared.get(ids[0])).mediaType, 'image/png', 'v2 preparation retains trusted MIME metadata');
    assert.deepEqual(domain, original);
    assert.deepEqual(composeDomainDocument(domain, fixtureAccountFor(domain)), document);
});

test('prepared bytes and acquisition failures stay outside Domain and Document AST', async () => {
    const domain = conversation();
    const json = JSON.stringify(domain);
    const document = composeDomainDocument(domain, fixtureAccountFor(domain));
    const astJson = JSON.stringify(document);
    const ids = collectDocumentResources(document).referencedIds;
    let acquisitions = 0;

    for (const success of [true, false]) {
        const prepared = await prepareExportResources(domain.detail.assets, ids, async asset => {
            acquisitions++;
            if (!success) throw new Error('HTTP 404 for ' + asset.id);
            return { bytes: firstBytes, mediaType: 'image/png' };
        });
        assert.equal(prepared.size, ids.size, 'each referenced image retains its acquisition outcome');
        for (const [id, outcome] of prepared) {
            if (success) {
                assert.deepEqual(resourceValue(outcome).bytes, firstBytes);
            } else {
                assert.equal(outcome.ok, false, 'failure must not become a successful blank image');
                if (!outcome.ok) {
                    assert.equal(outcome.resourceId, id);
                    assert.equal(outcome.code, 'RESOURCE_UNAVAILABLE');
                    assert.match(outcome.reason, /HTTP 404/);
                }
            }
        }
        assert.equal(JSON.stringify(domain), json);
        assert.equal(JSON.stringify(document), astJson);
        assert.equal(JSON.stringify(composeDomainDocument(domain, fixtureAccountFor(domain))), astJson);
        assert.ok(!json.includes('dataBase64') && !json.includes('failureReason'));
        assert.ok(!astJson.includes('dataBase64') && !astJson.includes('RESOURCE_UNAVAILABLE'));
    }

    const none = await prepareExportResources(domain.detail.assets, new Set<string>(), async () => {
        assert.fail('includeAssets=false must not acquire any bytes');
    });
    assert.equal(none.size, 0);
    assert.equal(acquisitions, ids.size * 2);
    const restored = validateParserDomain(JSON.parse(json));
    assert.deepEqual(composeDomainDocument(restored, fixtureAccountFor(restored)), document);
});

test('inline source bytes are reusable in the same task but never persisted in v2 Domain JSON', async () => {
    const domain = conversation();
    const asset = domain.detail.assets[0];
    const key = domain.index.key;
    const { key: _detailKey, ...detail } = domain.detail;
    const inline = Buffer.from(firstBytes).toString('base64');
    const parsed: SourceConversationParseResult = {
        conversationId: key.conversationId,
        conversation: { index: {}, detail },
        acquisitionHints: { [asset.id]: { dataBase64: inline } },
        diagnostics: [],
    };
    const json = JSON.stringify(domain);
    assert.ok(!json.includes(inline));
    assert.ok(!json.includes('dataBase64'));

    const resources = createSourceResourceContext();
    try {
        // This is the L1 side channel retained only after the Detail candidate is accepted.
        resources.retainParsed(key, parsed);
        const prepared = await prepareExportResources(domain.detail.assets, new Set([asset.id]),
            item => resources.acquire(key, item, undefined, async () => {
                assert.fail('same-task inline bytes must not require a remote fetch');
            }));
        assert.deepEqual(resourceValue(prepared.get(asset.id)).bytes, firstBytes);
        assert.equal(JSON.stringify(domain), json);
        assert.deepEqual(composeDomainDocument(validateParserDomain(JSON.parse(json)), fixtureAccountFor(domain)),
            composeDomainDocument(domain, fixtureAccountFor(domain)));
    } finally {
        resources.release();
    }
    await assert.rejects(resources.acquire(key, asset), /Resource context released/);
});







test('actual attachment response status distinguishes unavailable, restricted and retryable resources', async t => {
    const originalFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = originalFetch; });
    for (const [status, kind] of [[404, 'expired'], [410, 'expired'], [401, 'restricted'], [403, 'restricted'], [429, 'download'], [500, 'download']] as const) {
        globalThis.fetch = async () => new Response('', {status});
        const failure = await attemptResource('asset', () => acquireSourceResource({id:'asset',kind:'image',sourceUri:'https://lh3.googleusercontent.com/photo'}, undefined, undefined, 'gemini'));
        assert.equal(failure.ok, false);
        if (failure.ok) continue;
        assert.equal(failure.httpStatus, status);
        assert.equal(resourceIssueKind(failure), kind);
        assert.match(resourceFailureText(failure, 'zh'), new RegExp(`HTTP ${status}`));
    }
    for (const error of [new TypeError('Failed to fetch'), new Error('HTTP 404 mentioned in unrelated text')]) {
        const failure = await attemptResource('asset', async () => { throw error; });
        assert.ok(!failure.ok);
        assert.equal(resourceIssueKind(failure), 'unknown', 'never infer expiry or download cause from an error message');
    }
    const abort = new AbortController(); abort.abort();
    await assert.rejects(attemptResource('asset', async () => { throw new ResourceHttpError(404); }, abort.signal), {name:'AbortError'});
});

test('Markdown, HTML and PDF payload preserve the actual missing attachment reason and name', async () => {
    const domain = conversation();
    const document = composeDomainDocument(domain, fixtureAccountFor(domain));
    const prepared = await prepareExportResources(domain.detail.assets, collectDocumentResources(document).referencedIds,
        async () => { throw new ResourceHttpError(404); });
    const resourceFailures = Object.fromEntries([...prepared].filter((entry): entry is [string, import('../src/shared/resources/resourceResult.js').ResourceFailure] => !entry[1].ok));
    const options = {locale:'zh' as const, resourceFailures};
    const markdown = renderDocumentMarkdown(document, {}, options);
    const html = renderDocumentHtml(document, {}, options).html;
    const typst = JSON.stringify(renderDocumentTypstCore(document, {}, options));
    for (const output of [markdown, html, typst]) {
        assert.match(output, /来源附件无法获取/);
        assert.match(output, /HTTP 404/);
        assert.match(output, /same\.png/);
        assert.doesNotMatch(output, /<img[^>]+src="https:\/\/lh3\.googleusercontent\.com\/shared-image|!\[[^\]]*\]\(https:\/\/lh3\.googleusercontent\.com\/shared-image/);
        assert.match(output, /https:\/\/lh3\.googleusercontent\.com\/shared-image/);
    }
});


test('delivery summary separates unavailable source attachments from retryable failures', () => {
    const base = {exported:2,skipped:0,partial:2,failed:[],aborted:false,expiredConversations:2,otherPartial:0};
    const summary = exportSummary({...base, attachmentIssues:[
        {resourceId:'one',name:'one.png',code:'RESOURCE_SOURCE_EXPIRED',httpStatus:404},
        {resourceId:'two',name:'two.png',code:'RESOURCE_SOURCE_EXPIRED',httpStatus:410},
        {resourceId:'three',name:'three.png',code:'RESOURCE_DOWNLOAD_FAILED',httpStatus:503},
    ]}, true);
    assert.match(summary, /2 conversations contain unavailable source attachments \(2 attachments\)/);
    assert.match(summary, /Attachment download failed: 1; retry later/);
    assert.doesNotMatch(summary, /Conversation export failed:/);
    assert.doesNotMatch(summary, /Other incomplete/);
});

test('ChatGPT attachment API HTTP failures retain status and a useful summary', async () => {
    for (const status of [403, 404, 503]) {
        const result = await attemptResource('upload', async () => {
            throw new OperationError('RESOURCE_LOCATOR_UNAVAILABLE', `File exchange HTTP ${status}`, status);
        });
        assert.equal(result.ok, false);
        if (result.ok) throw new Error('Expected resource failure');
        assert.equal(result.httpStatus, status);
        assert.equal(resourceIssueKind(result), status === 404 ? 'expired' : status === 403 ? 'restricted' : 'download');
        assert.match(resourceFailureText(result, 'zh'), new RegExp(`HTTP ${status}`));
        assert.doesNotMatch(resourceFailureText(result, 'zh'), /未知/);
    }
});
});

__suiteDescribe("l4-cross-header-rowspan", () => {
const table: Extract<DisplayBlock, { type: 'table' }> = {
    type: 'table', columnAlignments: ['default', 'default'],
    headerRows: [[
        { column: 0, colSpan: 1, rowSpan: 2, children: [{ type: 'text', text: 'Group' }] },
        { column: 1, colSpan: 1, rowSpan: 1, children: [{ type: 'text', text: 'Label' }] },
    ]],
    rows: [[{ column: 1, colSpan: 1, rowSpan: 1, children: [{ type: 'text', text: 'Value' }] }]],
};

test__s10('HTML and Markdown keep a header rowspan crossing the first body row in one table rowgroup', () => {
    const doc = v2Document([table]);
    const html = renderDocumentHtml(doc, {}).html;
    const markdown = renderDocumentMarkdown(doc, {});
    for (const output of [html, markdown]) {
        assert.doesNotMatch(output, /<thead>/, 'a spanning cell cannot cross HTML rowgroup boundaries');
        assert.match(output, /<tbody>\s*<tr><th rowspan="2">Group<\/th><th>Label<\/th><\/tr>\s*<tr><td>Value<\/td><\/tr>\s*<\/tbody>/);
    }
});

test__s10('ordinary HTML tables retain separate rowgroups while Markdown keeps GFM output', () => {
    const ordinary = { ...table, headerRows: table.headerRows.map(row => row.map(cell => ({ ...cell, rowSpan: 1 }))) };
    const doc = v2Document([ordinary]);
    const html = renderDocumentHtml(doc, {}).html;
    assert.match(html, /<thead>\s*<tr><th>Group<\/th><th>Label<\/th><\/tr>\s*<\/thead>/);
    assert.match(html, /<tbody>\s*<tr><td>Value<\/td><\/tr>\s*<\/tbody>/);
    const markdown = renderDocumentMarkdown(doc, {});
    assert.doesNotMatch(markdown, /<thead>|<tbody>/);
    assert.match(markdown, /\| Group \| Label \|\n\| --- \| --- \|\n\|  \| Value \|/);
});
});

__suiteDescribe("typst-nested-semantics", () => {
const test = require('node:test');
const assert = require('node:assert');

const { renderTypstFixture } = require('./helpers/renderTypstFixture.js');
const { composeDomainDocument } = require('../src/l3b/compose/composeDomainDocument.js');

function domainFixture(messages: any[], assets: any[] = []) {
    return restoreDomainSnapshot({ index: { key: fixtureKey(String('c1'), 'gemini'),   titleSource: "derived",   title: 'Fixture', createdAt: Date.parse('2026-09-26T10:00:00Z') }, detail: { key: fixtureKey(String('c1'), 'gemini'), quality: { status: 'unknown' }, assets, messages: messages } });
}

function msg(id: string, role: string, blocks: any[], extra: any = {}) {
    return { id, role, content: blocks, ...extra };
}

function imgAsset(id: string) {
    return { id, kind: 'image', name: `${id}.png`, mediaType: 'image/png', byteLength: 1024 };
}

const withPath = {};

test('quote keeps nested image as a real image node', async () => {
    const b = domainFixture([msg('m1', 'assistant', [
        {
            type: 'quote',
            blocks: [
                { type: 'paragraph', children: [{ type: 'text', text: 'hello' }] },
                { type: 'image', assetId: 'a1', alt: 'pic' },
            ],
        },
    ])], [imgAsset('a1')]);
    const { payload, diagnostics } = renderTypstFixture(composeDomainDocument(b, fixtureAccountFor(b)), Object.fromEntries(b.detail.assets.map((asset: { id: string }) => [asset.id, `assets/${asset.id}.png`])), withPath);
    const quote = payload.messages[0].blocks[0] as any;
    assert.strictEqual(quote.type, 'quote');
    assert.strictEqual(quote.blocks.length, 2);
    assert.strictEqual(quote.blocks[0].type, 'paragraph');
    assert.strictEqual(quote.blocks[1].type, 'image');
    assert.strictEqual(quote.blocks[1].asset, 'assets/a1.png');
    assert.ok(!diagnostics.some((d: any) => d.severity === 'warning' && /quote/i.test(d.code)));
});

test('thought keeps nested image as a real image node', async () => {
    const b = domainFixture([msg('m1', 'assistant', [], { reasoning: [
        { type: 'paragraph', children: [{ type: 'text', text: 'thinking' }] },
        { type: 'image', assetId: 'a1', alt: 'pic' },
    ] })], [imgAsset('a1')]);
    const { payload } = renderTypstFixture(composeDomainDocument(b, fixtureAccountFor(b)), Object.fromEntries(b.detail.assets.map((asset: { id: string }) => [asset.id, `assets/${asset.id}.png`])), withPath);
    const note = payload.messages[0].blocks[0] as any;
    assert.strictEqual(note.type, 'note');
    assert.strictEqual(note.blocks.length, 2);
    assert.strictEqual(note.blocks[1].type, 'image');
    assert.strictEqual(note.blocks[1].asset, 'assets/a1.png');
});

test('quote keeps code and math as structured nodes instead of flat text', async () => {
    const b = domainFixture([msg('m1', 'assistant', [
        {
            type: 'quote',
            blocks: [
                { type: 'code', language: 'python', code: 'print(1)' },
                { type: 'math', source: 'E=mc^2' },
            ],
        },
    ])]);
    const { payload } = renderTypstFixture(composeDomainDocument(b, fixtureAccountFor(b)), Object.fromEntries(b.detail.assets.map((asset: { id: string }) => [asset.id, `assets/${asset.id}.png`])), withPath);
    const quote = payload.messages[0].blocks[0] as any;
    assert.strictEqual(quote.blocks[0].type, 'code');
    assert.strictEqual(quote.blocks[0].text, 'print(1)');
    assert.strictEqual(quote.blocks[1].type, 'math');
    assert.strictEqual(quote.blocks[1].latex, 'E=mc^2');
});

test('thought keeps code as a structured node instead of flat text', async () => {
    const b = domainFixture([msg('m1', 'assistant', [], { reasoning: [{ type: 'code', language: 'ts', code: 'const x = 1' }] })]);
    const { payload } = renderTypstFixture(composeDomainDocument(b, fixtureAccountFor(b)), Object.fromEntries(b.detail.assets.map((asset: { id: string }) => [asset.id, `assets/${asset.id}.png`])), withPath);
    const note = payload.messages[0].blocks[0] as any;
    assert.strictEqual(note.blocks[0].type, 'code');
    assert.strictEqual(note.blocks[0].text, 'const x = 1');
});





test('strikethrough is transported natively without a warning', async () => {
    const b = domainFixture([msg('m1', 'user', [
        { type: 'paragraph', children: [{ type: 'strikethrough', children: [{ type: 'text', text: 'gone' }] }] },
    ])]);
    const { payload, diagnostics } = renderTypstFixture(composeDomainDocument(b, fixtureAccountFor(b)), Object.fromEntries(b.detail.assets.map((asset: { id: string }) => [asset.id, `assets/${asset.id}.png`])), withPath);
    assert.ok(!diagnostics.some((d: any) => d.code === 'TYPST_STRIKETHROUGH_DROPPED'));
    const node = (payload.messages[0].blocks[0] as any).children[0];
    assert.strictEqual(node.type, 'strikethrough');
    assert.strictEqual(node.children[0].text, 'gone');
});
});

import { historicalFixture, rpcFixture } from './helpers/nativeFixture.js';
import { makeTestWorker } from './helpers/makeTestWorker.js';
import { StubPdfCompiler } from './helpers/stubPdfCompiler.js';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
    resolveExportRecordStatus,
    buildExportCompletion,
} = require('../src/core/engine/export/exportCompletion.js');
const { extractChatParseDrift } = require('../src/core/engine/export/parseDrift.js');
const { ExportOrchestrator } = require('../src/core/engine/export/exportOrchestrator.js');
const { PdfExporter } = require('../src/core/export/pdf/index.js');
const { __setModuleOverride } = require('../src/core/utils/moduleOverrides.js');

const fixtureDir = path.join(__dirname, 'fixtures', 'provider');
const sampleFixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'conversation-sample.json'), 'utf8'));

function makeTestConversation(id: string, title: string, overrides: Record<string, any> = {}) {
    const copy = JSON.parse(JSON.stringify(sampleFixture));
    copy.id = id;
    copy.title = title;
    Object.assign(copy, overrides);
    return copy;
}

function makePlainTestConversation(id: string, title: string, overrides: Record<string, any> = {}) {
    return {
        id,
        title,
        createdAt: 1727000000000,
        updatedAt: 1727003600000,
        messages: [
            { id: 'm-u1', role: 'user', content: 'Hello world', timestamp: 1727000001000 },
            { id: 'm-m1', role: 'model', content: 'Hello! How can I help you today?', timestamp: 1727000010000 }
        ],
        ...overrides
    };
}

function setupMockJSZip() {
    const files: Record<string, any> = {};
    const instances: any[] = [];
    __setModuleOverride('JSZip', class MockJSZip {
        files: Record<string, any>;
        constructor() {
            this.files = files;
            instances.push(this);
        }
        folder(_name: string) {
            return {
                file: (p: string, content: any) => {
                    files[p] = content;
                    return this;
                }
            };
        }
        file(p: string, content: any) {
            files[p] = content;
            return this;
        }
        async generateAsync(_options?: any, cb?: (p: { percent: number }) => void) {
            if (cb) cb({ percent: 100 });
            return new Blob(['mock-zip'], { type: 'application/zip' });
        }
    });
    return { instances, files };
}

function setupMockStorage() {
    const mem: Record<string, any> = {};
    __setModuleOverride('StorageService', {
        getExportedIds: async (_slot: string) => ({ ...mem }),
        saveExportRecord: async (_slot: string, id: string, rec: any) => {
            mem[id] = rec;
            return { ...mem };
        },
    });
    return { savedRecords: mem };
}

function makeFakeWriter(opts?: { failOn?: (name: string) => boolean }) {
    const files: Array<{ name: string; bytes: Uint8Array }> = [];
    const writer = {
        files,
        written: 0,
        async writeFile(relativePath: string, content: any) {
            if (opts && opts.failOn && opts.failOn(relativePath)) {
                throw new Error('simulated write failure');
            }
            const bytes = content instanceof Uint8Array ? content : new TextEncoder().encode(String(content));
            files.push({ name: relativePath, bytes });
            writer.written++;
            return relativePath;
        },
        async generateBlob() {
            return new Blob(files.map((f) => f.bytes as any), { type: 'application/zip' });
        },
    };
    return writer;
}

// ===========================================================================
// Section A: Pure function status matrix (resolveExportRecordStatus & buildExportCompletion)
// ===========================================================================

test('Matrix A: resolveExportRecordStatus pure function truth table', () => {
    // 1. Normal body, no asset failure -> ok
    const normal = resolveExportRecordStatus({
        messageCount: 5,
        failedAssetsCount: 0,
        evidence: {}
    });
    assert.strictEqual(normal.status, 'ok');
    assert.strictEqual(normal.hasFailedAssets, false);

    // 2. sourcePartial=true -> partial
    const srcPartial = resolveExportRecordStatus({
        messageCount: 5,
        failedAssetsCount: 0,
        evidence: { sourcePartial: true }
    });
    assert.strictEqual(srcPartial.status, 'partial');
    assert.strictEqual(srcPartial.hasFailedAssets, false);

    // 3. turnsRejected=1 -> partial
    const turnsRej = resolveExportRecordStatus({
        messageCount: 5,
        failedAssetsCount: 0,
        evidence: { turnsRejected: 1 }
    });
    assert.strictEqual(turnsRej.status, 'partial');
    assert.strictEqual(turnsRej.hasFailedAssets, false);

    // 4. hasHeuristicDocs=true -> partial
    const heuristic = resolveExportRecordStatus({
        messageCount: 5,
        failedAssetsCount: 0,
        evidence: { hasHeuristicDocs: true }
    });
    assert.strictEqual(heuristic.status, 'partial');
    assert.strictEqual(heuristic.hasFailedAssets, false);

    // 5. truncated=true -> partial
    const trunc = resolveExportRecordStatus({
        messageCount: 5,
        failedAssetsCount: 0,
        evidence: { truncated: true }
    });
    assert.strictEqual(trunc.status, 'partial');
    assert.strictEqual(trunc.hasFailedAssets, false);

    // 6. usedLocalSnapshot=true -> partial
    const localSnap = resolveExportRecordStatus({
        messageCount: 5,
        failedAssetsCount: 0,
        evidence: { usedLocalSnapshot: true }
    });
    assert.strictEqual(localSnap.status, 'partial');
    assert.strictEqual(localSnap.hasFailedAssets, false);

    // 7. actual requested resource failure -> partial
    const resFail = resolveExportRecordStatus({
        messageCount: 5,
        failedAssetsCount: 2,
        evidence: {}
    });
    assert.strictEqual(resFail.status, 'partial');
    assert.strictEqual(resFail.hasFailedAssets, true);

    // 8. benign schemaDrift warning alone -> ok
    const schemaWarn = resolveExportRecordStatus({
        messageCount: 5,
        failedAssetsCount: 0,
        evidence: { sourcePartial: false, turnsRejected: 0, hasHeuristicDocs: false, truncated: false }
    });
    assert.strictEqual(schemaWarn.status, 'ok');
    assert.strictEqual(schemaWarn.hasFailedAssets, false);

    // 9. completeness=unknown -> ok
    const compUnknown = resolveExportRecordStatus({
        messageCount: 5,
        failedAssetsCount: 0,
        evidence: { sourcePartial: false }
    });
    assert.strictEqual(compUnknown.status, 'ok');
    assert.strictEqual(compUnknown.hasFailedAssets, false);

    // 10. completeness missing -> ok
    const compMissing = resolveExportRecordStatus({
        messageCount: 5,
        failedAssetsCount: 0,
        evidence: undefined
    });
    assert.strictEqual(compMissing.status, 'ok');
    assert.strictEqual(compMissing.hasFailedAssets, false);

    // 11. includeAssets=false (failedAssetsCount=0) -> ok
    const noAssetsRequested = resolveExportRecordStatus({
        messageCount: 5,
        failedAssetsCount: 0,
        evidence: {}
    });
    assert.strictEqual(noAssetsRequested.status, 'ok');
    assert.strictEqual(noAssetsRequested.hasFailedAssets, false);

    // 12. definite failure override -> failed
    const failOverride = resolveExportRecordStatus({
        messageCount: 5,
        statusOverride: 'failed',
        evidence: {}
    });
    assert.strictEqual(failOverride.status, 'failed');
    assert.strictEqual(failOverride.hasFailedAssets, false);

    // 13. confirmed empty session -> empty
    const emptyCount = resolveExportRecordStatus({
        messageCount: 0,
        evidence: {}
    });
    assert.strictEqual(emptyCount.status, 'empty');
    assert.strictEqual(emptyCount.hasFailedAssets, false);

    const emptyOverride = resolveExportRecordStatus({
        statusOverride: 'empty',
        evidence: {}
    });
    assert.strictEqual(emptyOverride.status, 'empty');
    assert.strictEqual(emptyOverride.hasFailedAssets, false);
});

test('Matrix A (continued): Combinations and strict status precedence (failed > empty > partial > ok)', () => {
    // failed + resourceFailure stays failed
    const failedPlusRes = resolveExportRecordStatus({
        statusOverride: 'failed',
        failedAssetsCount: 3
    });
    assert.strictEqual(failedPlusRes.status, 'failed', 'Hard failure must not be downgraded to partial');
    assert.strictEqual(failedPlusRes.hasFailedAssets, true);

    // partial + resourceFailure stays partial
    const partialPlusRes = resolveExportRecordStatus({
        statusOverride: 'partial',
        failedAssetsCount: 2
    });
    assert.strictEqual(partialPlusRes.status, 'partial');
    assert.strictEqual(partialPlusRes.hasFailedAssets, true);

    // empty + resourceFailure stays empty
    const emptyPlusRes = resolveExportRecordStatus({
        statusOverride: 'empty',
        failedAssetsCount: 1
    });
    assert.strictEqual(emptyPlusRes.status, 'empty');
    assert.strictEqual(emptyPlusRes.hasFailedAssets, true);

    // ok override with evidence loss -> partial
    const okWithLoss = resolveExportRecordStatus({
        statusOverride: 'ok',
        evidence: { sourcePartial: true }
    });
    assert.strictEqual(okWithLoss.status, 'partial', 'statusOverride ok must be gated by integrity evidence');

    // ok override with asset loss -> partial
    const okWithAssetLoss = resolveExportRecordStatus({
        statusOverride: 'ok',
        failedAssetsCount: 1
    });
    assert.strictEqual(okWithAssetLoss.status, 'partial');
    assert.strictEqual(okWithAssetLoss.hasFailedAssets, true);
});

test('Matrix A (continued): buildExportCompletion automatically propagates integrity evidence', () => {
    // 1. Partial completeness
    const partialComp = buildExportCompletion({
        conversation: {
            id: 'c_part',
            title: 'Partial Chat',
            messages: [{ role: 'user', content: 'test' }],
            completeness: { status: 'partial', reason: 'cut_off' }
        }
    });
    assert.strictEqual(partialComp.exportRecord.status, 'partial');

    // 2. Truncate reason
    const truncChat = buildExportCompletion({
        conversation: {
            id: 'c_trunc',
            title: 'Truncated Chat',
            messages: [{ role: 'user', content: 'test' }],
            truncateReason: 'context_window_limit'
        }
    });
    assert.strictEqual(truncChat.exportRecord.status, 'partial');

    // 3. Unknown completeness -> ok
    const unknownComp = buildExportCompletion({
        conversation: {
            id: 'c_unk',
            title: 'Unknown Chat',
            messages: [{ role: 'user', content: 'test' }],
            completeness: { status: 'unknown' }
        }
    });
    assert.strictEqual(unknownComp.exportRecord.status, 'ok');

    // 4. Failed assets count passed in
    const assetFailComp = buildExportCompletion({
        conversation: {
            id: 'c_assets',
            title: 'Assets Fail Chat',
            messages: [{ role: 'user', content: 'test' }]
        },
        failedAssets: 3
    });
    assert.strictEqual(assetFailComp.exportRecord.status, 'partial');
    assert.strictEqual(assetFailComp.exportRecord.hasFailedAssets, true);
});

// ===========================================================================
// Section B: Normal export integration (ExportOrchestrator & meta.json)
// ===========================================================================

test('Matrix B: ExportOrchestrator aligns ExportRecord and meta.json for partial chat (completeness=partial)', async () => {
    const { files } = setupMockJSZip();
    const { savedRecords } = setupMockStorage();
    const orchestrator = new ExportOrchestrator();

    const selected = [{ id: 'chat_part_1', title: 'Partial Export Chat' }];
    const mockWorker = makeTestWorker({
        fetchChatDetail: async (item: any) => ({
            success: true,
            chat: historicalFixture({
                id: item.id,
                title: item.title,
                messages: [
                    { role: 'user', content: 'User question' },
                    { role: 'model', content: 'Model answer (incomplete)' }
                ],
                completeness: { status: 'partial', reason: 'exceeded_limit' }
            }),
            listTitle: item.title
        })
    });

    const result = await orchestrator.run({
        selected,
        format: 'markdown',
        useZip: true,
        includeAssets: false,
        includeIndex: true,
        worker: mockWorker
    });

    assert.strictEqual(result.landedChats, 1);
    assert.strictEqual(result.failedChats.length, 0);

    // 1. ExportRecord status must be 'partial'
    const record = savedRecords['chat_part_1'];
    assert.ok(record, 'ExportRecord must be persisted');
    assert.strictEqual(record.status, 'partial', 'ExportRecord.status must be partial');

    // 2. meta.json entry status must match exactly: 'partial'
    assert.ok(files['meta.json'], 'meta.json must be written');
    const metaObj = JSON.parse(files['meta.json']);
    assert.strictEqual(metaObj.conversations.length, 1);
    assert.strictEqual(metaObj.conversations[0].status, 'partial', 'meta.json entry must be partial');
});

test('Matrix B: ExportOrchestrator aligns ExportRecord and meta.json for rejected turns', async () => {
    const { files } = setupMockJSZip();
    const { savedRecords } = setupMockStorage();
    const orchestrator = new ExportOrchestrator();

    const selected = [{ id: 'chat_rej_1', title: 'Rejected Turn Chat' }];
    const parsed = rpcFixture({
        id: 'chat_rej_1',
        title: 'Rejected Turn Chat',
        messages: [{ role: 'user', content: 'Q' }, { role: 'model', content: 'A' }]
    }, { turnsRejected: 1 });

    const mockWorker = makeTestWorker({
        fetchChatDetail: async (item: any) => ({
            success: true,
            chat: parsed,
            listTitle: item.title
        })
    });

    const result = await orchestrator.run({
        selected,
        format: 'markdown',
        useZip: true,
        includeAssets: false,
        includeIndex: true,
        worker: mockWorker
    });

    assert.strictEqual(result.landedChats, 1);
    const record = savedRecords['chat_rej_1'];
    assert.strictEqual(record.status, 'partial', 'turnsRejected > 0 must result in partial ExportRecord');

    const metaObj = JSON.parse(files['meta.json']);
    assert.strictEqual(metaObj.conversations[0].status, 'partial', 'meta.json entry must be partial for rejected turn');
    assert.strictEqual(metaObj.conversations[0].turnsRejected, 1);
});

test('Matrix B: ExportOrchestrator aligns ExportRecord and meta.json for benign schema warnings (ok -> success)', async () => {
    const { files } = setupMockJSZip();
    const { savedRecords } = setupMockStorage();
    const orchestrator = new ExportOrchestrator();

    const selected = [{ id: 'chat_clean_1', title: 'Clean Chat With Benign Warning' }];
    const parsed = historicalFixture({
        id: 'chat_clean_1',
        title: 'Clean Chat With Benign Warning',
        messages: [{ role: 'user', content: 'Hello' }, { role: 'model', content: 'World' }]
    });
    parsed.diagnostics.push({
        severity: 'warning',
        code: 'SCHEMA_FIELD_EXTRA',
        message: 'Non-fatal unexpected field in stream'
    });

    const mockWorker = makeTestWorker({
        fetchChatDetail: async (item: any) => ({
            success: true,
            chat: parsed,
            listTitle: item.title
        })
    });

    const result = await orchestrator.run({
        selected,
        format: 'markdown',
        useZip: true,
        includeAssets: false,
        includeIndex: true,
        worker: mockWorker
    });

    assert.strictEqual(result.landedChats, 1);
    const record = savedRecords['chat_clean_1'];
    assert.strictEqual(record.status, 'ok', 'Benign warning must NOT make ExportRecord partial');

    const metaObj = JSON.parse(files['meta.json']);
    assert.strictEqual(metaObj.conversations[0].status, 'success', 'ExportRecord ok maps to meta.json success');
    assert.ok(metaObj.conversations[0].schemaDrift.some((w: string) => w.includes('SCHEMA_FIELD_EXTRA')));
});

// ===========================================================================
// Section C: PDF export integration (prepareItem & pdfExporter)
// ===========================================================================

test('Matrix C (PDF): Directory mode marks partial when domain completeness is partial', async () => {
    const writer = makeFakeWriter();
    const exporter = new PdfExporter(new StubPdfCompiler());
    const exported: any[] = [];

    const conv = makePlainTestConversation('pdf_part_dir', 'PDF Partial Dir Chat', {
        completeness: { status: 'partial', reason: 'exceeded_tokens' }
    });

    const result = await exporter.run(
        {
            selected: [{ id: conv.id, title: conv.title }],
            conversations: [conv],
            fetchChatDetail: async () => ({
                success: true,
                results: [historicalFixture(conv)]
            }),
            useZip: false,
            writer,
        },
        {
            onItemExported: (id: string, record: any) => exported.push({ id, record })
        }
    );

    assert.strictEqual(result.succeeded, 1);
    assert.strictEqual(exported.length, 1);
    assert.strictEqual(exported[0].record.status, 'partial', 'Directory PDF must mark partial on domain completeness=partial');
});

test('Matrix C (PDF): Directory mode marks partial when turns are rejected by parser', async () => {
    const writer = makeFakeWriter();
    const exporter = new PdfExporter(new StubPdfCompiler());
    const exported: any[] = [];

    const conv = makePlainTestConversation('pdf_rej_dir', 'PDF Rejected Dir Chat');
    const parsed = rpcFixture(conv, { turnsRejected: 2 });

    const result = await exporter.run(
        {
            selected: [{ id: conv.id, title: conv.title }],
            conversations: [conv],
            fetchChatDetail: async () => ({
                success: true,
                results: [parsed]
            }),
            useZip: false,
            writer,
        },
        {
            onItemExported: (id: string, record: any) => exported.push({ id, record })
        }
    );

    assert.strictEqual(result.succeeded, 1);
    assert.strictEqual(exported.length, 1);
    assert.strictEqual(exported[0].record.status, 'partial', 'Directory PDF must mark partial on turnsRejected > 0');
});

test('Matrix C (PDF): ZIP mode preserves staged partial status upon delivery commit', async () => {
    const writer = makeFakeWriter();
    const exporter = new PdfExporter(new StubPdfCompiler());
    const exported: any[] = [];

    const conv = makePlainTestConversation('pdf_part_zip', 'PDF Partial ZIP Chat', {
        completeness: { status: 'partial', reason: 'cut_off' }
    });

    const result = await exporter.run(
        {
            selected: [{ id: conv.id, title: conv.title }],
            conversations: [conv],
            fetchChatDetail: async () => ({
                success: true,
                results: [historicalFixture(conv)]
            }),
            useZip: true,
            writer,
            downloadHandler: async () => {},
        },
        {
            onItemExported: (id: string, record: any) => exported.push({ id, record })
        }
    );

    assert.strictEqual(result.succeeded, 1);
    assert.strictEqual(exported.length, 1);
    assert.strictEqual(exported[0].record.status, 'partial', 'ZIP PDF must commit partial status preserved from staging');
});

test('Matrix C (PDF): Clean conversation yields ok status in both directory and ZIP modes', async () => {
    const exporter = new PdfExporter(new StubPdfCompiler());
    const conv = makePlainTestConversation('pdf_clean', 'PDF Clean Chat');

    // 1. Directory mode
    const writerDir = makeFakeWriter();
    const exportedDir: any[] = [];
    const resDir = await exporter.run(
        {
            selected: [{ id: conv.id, title: conv.title }],
            conversations: [conv],
            fetchChatDetail: async () => ({ success: true, results: [historicalFixture(conv)] }),
            useZip: false,
            writer: writerDir,
        },
        { onItemExported: (id: string, record: any) => exportedDir.push({ id, record }) }
    );
    assert.strictEqual(resDir.succeeded, 1);
    assert.strictEqual(exportedDir[0].record.status, 'ok', 'Clean PDF must be ok in directory mode');

    // 2. ZIP mode
    const writerZip = makeFakeWriter();
    const exportedZip: any[] = [];
    const resZip = await exporter.run(
        {
            selected: [{ id: conv.id, title: conv.title }],
            conversations: [conv],
            fetchChatDetail: async () => ({ success: true, results: [historicalFixture(conv)] }),
            useZip: true,
            writer: writerZip,
            downloadHandler: async () => {},
        },
        { onItemExported: (id: string, record: any) => exportedZip.push({ id, record }) }
    );
    assert.strictEqual(resZip.succeeded, 1);
    assert.strictEqual(exportedZip[0].record.status, 'ok', 'Clean PDF must be ok in ZIP mode');
});

test('Matrix C (PDF): Metadata-only file attachments without image bytes do not cause partial', async () => {
    const exporter = new PdfExporter(new StubPdfCompiler());
    const conv = makePlainTestConversation('pdf_metadata_att', 'PDF Metadata-only Attachment Chat', {
        messages: [
            {
                id: 'm-u1',
                role: 'user',
                content: 'Please examine this document',
                attachments: [
                    {
                        name: 'report.pdf',
                        type: 'file',
                        mimeType: 'application/pdf',
                        size: 1024,
                        url: 'https://example.com/report.pdf'
                    }
                ]
            },
            {
                id: 'm-m1',
                role: 'model',
                content: 'I have inspected the metadata.'
            }
        ]
    });

    const writer = makeFakeWriter();
    const exported: any[] = [];
    const res = await exporter.run(
        {
            selected: [{ id: conv.id, title: conv.title }],
            conversations: [conv],
            fetchChatDetail: async () => ({ success: true, results: [historicalFixture(conv)] }),
            useZip: false,
            writer,
        },
        { onItemExported: (id: string, record: any) => exported.push({ id, record }) }
    );

    assert.strictEqual(res.succeeded, 1);
    assert.strictEqual(exported[0].record.status, 'ok', 'Metadata-only attachments must not cause partial in PDF');
});

// ===========================================================================
// Section D: Cross-format consistency (Markdown, HTML, JSON, PDF)
// ===========================================================================

test('Matrix D: Same lossy domain produces partial across all formats (Markdown, HTML, JSON, PDF)', async () => {
    setupMockJSZip();
    const lossyConv = makePlainTestConversation('lossy_cross', 'Lossy Cross-Format Chat', {
        completeness: { status: 'partial', reason: 'cloud_cut_off' }
    });

    const parsedLossy = historicalFixture(lossyConv);

    // 1. Markdown
    const memMd = setupMockStorage();
    const orchMd = new ExportOrchestrator();
    await orchMd.run({
        selected: [{ id: lossyConv.id, title: lossyConv.title }],
        format: 'markdown',
        useZip: true,
        includeAssets: false,
        worker: makeTestWorker({ fetchChatDetail: async () => ({ success: true, chat: parsedLossy, listTitle: lossyConv.title }) })
    });
    assert.strictEqual(memMd.savedRecords[lossyConv.id].status, 'partial', 'Markdown export must be partial');

    // 2. HTML
    const memHtml = setupMockStorage();
    const orchHtml = new ExportOrchestrator();
    await orchHtml.run({
        selected: [{ id: lossyConv.id, title: lossyConv.title }],
        format: 'html',
        useZip: true,
        includeAssets: false,
        worker: makeTestWorker({ fetchChatDetail: async () => ({ success: true, chat: parsedLossy, listTitle: lossyConv.title }) })
    });
    assert.strictEqual(memHtml.savedRecords[lossyConv.id].status, 'partial', 'HTML export must be partial');

    // 3. JSON
    const memJson = setupMockStorage();
    const orchJson = new ExportOrchestrator();
    await orchJson.run({
        selected: [{ id: lossyConv.id, title: lossyConv.title }],
        format: 'json',
        useZip: true,
        includeAssets: false,
        worker: makeTestWorker({ fetchChatDetail: async () => ({ success: true, chat: parsedLossy, listTitle: lossyConv.title }) })
    });
    assert.strictEqual(memJson.savedRecords[lossyConv.id].status, 'partial', 'JSON export must be partial');

    // 4. PDF
    const pdfExporter = new PdfExporter(new StubPdfCompiler());
    const pdfExported: any[] = [];
    await pdfExporter.run(
        {
            selected: [{ id: lossyConv.id, title: lossyConv.title }],
            conversations: [lossyConv],
            fetchChatDetail: async () => ({ success: true, results: [parsedLossy] }),
            useZip: false,
            writer: makeFakeWriter(),
        },
        { onItemExported: (id: string, record: any) => pdfExported.push({ id, record }) }
    );
    assert.strictEqual(pdfExported[0].record.status, 'partial', 'PDF export must be partial');
});

test('Matrix D: Same clean domain produces ok across all formats (Markdown, HTML, JSON, PDF)', async () => {
    setupMockJSZip();
    const cleanConv = makePlainTestConversation('clean_cross', 'Clean Cross-Format Chat');
    const parsedClean = historicalFixture(cleanConv);

    // 1. Markdown
    const memMd = setupMockStorage();
    const orchMd = new ExportOrchestrator();
    await orchMd.run({
        selected: [{ id: cleanConv.id, title: cleanConv.title }],
        format: 'markdown',
        useZip: true,
        includeAssets: false,
        worker: makeTestWorker({ fetchChatDetail: async () => ({ success: true, chat: parsedClean, listTitle: cleanConv.title }) })
    });
    assert.strictEqual(memMd.savedRecords[cleanConv.id].status, 'ok', 'Markdown export must be ok');

    // 2. HTML
    const memHtml = setupMockStorage();
    const orchHtml = new ExportOrchestrator();
    await orchHtml.run({
        selected: [{ id: cleanConv.id, title: cleanConv.title }],
        format: 'html',
        useZip: true,
        includeAssets: false,
        worker: makeTestWorker({ fetchChatDetail: async () => ({ success: true, chat: parsedClean, listTitle: cleanConv.title }) })
    });
    assert.strictEqual(memHtml.savedRecords[cleanConv.id].status, 'ok', 'HTML export must be ok');

    // 3. JSON
    const memJson = setupMockStorage();
    const orchJson = new ExportOrchestrator();
    await orchJson.run({
        selected: [{ id: cleanConv.id, title: cleanConv.title }],
        format: 'json',
        useZip: true,
        includeAssets: false,
        worker: makeTestWorker({ fetchChatDetail: async () => ({ success: true, chat: parsedClean, listTitle: cleanConv.title }) })
    });
    assert.strictEqual(memJson.savedRecords[cleanConv.id].status, 'ok', 'JSON export must be ok');

    // 4. PDF
    const pdfExporter = new PdfExporter(new StubPdfCompiler());
    const pdfExported: any[] = [];
    await pdfExporter.run(
        {
            selected: [{ id: cleanConv.id, title: cleanConv.title }],
            conversations: [cleanConv],
            fetchChatDetail: async () => ({ success: true, results: [parsedClean] }),
            useZip: false,
            writer: makeFakeWriter(),
        },
        { onItemExported: (id: string, record: any) => pdfExported.push({ id, record }) }
    );
    assert.strictEqual(pdfExported[0].record.status, 'ok', 'PDF export must be ok');
});

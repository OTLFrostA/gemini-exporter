import { useIndexStorage } from './helpers/indexStorage.js';
useIndexStorage();
import { historicalFixture } from './helpers/nativeFixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { preparePdfItem } from '../src/core/export/pdf/prepareItem.js';
import { resourceStage } from '../src/core/export/pdf/pipeline/resourceStage.js';
import { payloadStage } from '../src/core/export/pdf/pipeline/payloadStage.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { TypstSandboxCompiler } from '../src/core/export/typst/typstSandboxCompiler.js';
import { RealWasmSandboxHost, repoRoot } from './helpers/realWasmSandbox.js';
import { extractPdfText } from './helpers/pdfTextExtract.js';

const ctx = { signal: new AbortController().signal, log() {}, reportProgress() {} };
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const secondPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nB0AAAAASUVORK5CYII=';
const fixture = () => ({ id: 'direct-pdf', title: 'Direct PDF boundary', timestamp: 1700000000000, updatedAt: 1700000000000, messages: [
    { id: 'user', role: 'user', content: 'Explain the pipeline.' },
    { id: 'model', role: 'model', thoughts: 'Check **every** relation.', content: '# Results\n\n**Strong** text and [source](https://example.test).\n\n> A quoted result.\n\n1. First\n2. Second\n\n```ts filename=pipeline.ts\nconst layers = 2;\n```\n\n$$\\frac{a}{b}$$\n\n| Item | Value |\n|---|---:|\n| Result | 42 |\n\n![Sample](assets/sample.png)\n\n' + Array.from({ length: 100 }, (_, i) => `Paragraph ${i}: This detailed explanation exercises physical page breaks and flowing text.`).join('\n\n'),
        attachments: [{ type: 'image', name: 'Sample', localName: 'assets/sample.png', sourceUrl: 'https://example.test/sample.png', dataBase64: png, mimeType: 'image/png' }, { type: 'file', name: 'report.pdf', mimeType: 'application/pdf', size: 1234567 }],
    },
] });

test('PDF parser closes resources and reasoning; Domain and AST JSON round-trips preserve meaning', async () => {
    const raw = fixture(), before = structuredClone(raw);
    const parsed = historicalFixture(raw, { providerId: 'gemini' });
    const domain = structuredClone(parsed.conversation);
    const roundTrip = JSON.parse(JSON.stringify(domain)) as typeof domain;
    assert.deepEqual(composeDomainDocument(roundTrip), composeDomainDocument(domain));
    const prepared = await preparePdfItem(historicalFixture(raw), { includeAssets: false });
    assert.ok(prepared.ok);
    assert.deepEqual(prepared.document, composeDomainDocument({ index: { ...domain.index, url: `https://gemini.google.com/app/${domain.index.id}` }, detail: { ...domain.detail } }).document);
    assert.deepEqual(JSON.parse(JSON.stringify(prepared.document)), prepared.document);
    assert.ok(!('bundle' in prepared) && !('byteStore' in prepared));
    assert.deepEqual(parsed.conversation, domain);
    assert.deepEqual(raw, before);
});

test('intrinsic file size and unknown role survive parser and JSON without output formatting', () => {
    const raw = { id: 'file', messages: [{ role: 'historical-tool', content: 'Answer', attachments: [{ type: 'file', name: 'note.txt', dataBuffer: new Uint8Array([65, 66, 67]) }] }] };
    const parsed = historicalFixture(raw, { providerId: 'gemini' }).conversation;
    assert.equal(parsed.detail.assets[0].byteLength, 3);
    assert.equal(parsed.detail.messages[0].role, 'unknown');
    assert.equal(Object.hasOwn(parsed.detail.messages[0], 'provenance'), false);
    const restored = JSON.parse(JSON.stringify(parsed)) as typeof parsed;
    assert.deepEqual(composeDomainDocument(restored), composeDomainDocument(parsed));
    const file = composeDomainDocument(parsed).document.messages[0].blocks.find(block => block.type === 'file');
    assert.ok(file && file.type === 'file');
    assert.equal(file.byteLength, 3);
    assert.equal(file.label, 'note.txt');
});

test('PDF hydration cannot conflate two sources sharing an export destination', async () => {
    const urls: string[] = [];
    const raw = { id: 'collision', messages: [{ role: 'model', content: 'Two images', images: [
        { type: 'image', localName: 'assets/same.png', url: 'https://example.test/one' },
        { type: 'image', localName: 'assets/same.png', url: 'https://example.test/two' },
    ] }] };
    const prepared = await preparePdfItem(historicalFixture(raw), { fetchAsset: async request => {
        const url = typeof request === 'string' ? request : request.url ?? '';
        urls.push(url);
        return { success: true, mime: 'image/png', dataBase64: url.endsWith('/one') ? png : secondPng };
    } });
    assert.ok(prepared.ok);
    assert.deepEqual(urls, ['https://example.test/one', 'https://example.test/two']);
    assert.equal(prepared.resources.size, 2);
    const imageIds = prepared.document.messages[0].blocks
        .filter(block => block.type === 'image')
        .map(block => block.type === 'image' ? block.resourceId : '');
    assert.equal(new Set(imageIds).size, 2, 'source images sharing an export name must remain separate Domain assets');
    const recoveredBytes = imageIds.map(id => {
        const outcome = prepared.resources.get(id);
        assert.ok(outcome?.ok, `missing prepared resource for ${id}`);
        return Buffer.from(outcome.value.bytes).toString('base64');
    });
    assert.deepEqual(recoveredBytes, [png, secondPng],
        'each prepared resource must retain its OWN source bytes, not just exist in a two-entry map');
});

test('PDF transport matches reference and real compiled pages contain source-authored text', async () => {
    const raw = fixture();
    const prepared = await preparePdfItem(historicalFixture(raw), { includeAssets: false });
    assert.ok(prepared.ok);
    const resolved = await resourceStage(prepared, ctx);
    const direct = await payloadStage({ document: prepared.document, pathMap: resolved.output.pathMap, locale: 'en' }, ctx);
    const reference: TypstConversationRenderPayload = JSON.parse(readFileSync('tests/fixtures/pdf-domain-direct-reference.json', 'utf8'));
    // Engine transport should match independently of the source identity namespace.
    assert.deepEqual(direct.output.payload, reference);
    const host = new RealWasmSandboxHost(repoRoot());
    const compiler = new TypstSandboxCompiler({ host });
    try {
        const rendered = (await compiler.compile(
            { rendererSchemaVersion: 1, document: direct.output.payload, assetPaths: resolved.output.pathMap },
            { ...ctx, assets: { resolve: async id => {
                const path = resolved.output.pathMap.get(id);
                const mount = resolved.output.mounts.find(item => item.virtualPath === path);
                return mount ? { bytes: mount.bytes } : null;
            } } },
        )).pdfBytes;
        const physical = extractPdfText(rendered);
        assert.ok(physical.pageCount >= 3, 'long source text must paginate in the compiled PDF');
        assert.match(physical.text, /Explain the pipeline/, 'actual PDF must contain the user question');
        assert.match(physical.text, /Paragraph 99:/, 'actual PDF must contain the end of the long model answer');
        assert.match(physical.text, /Results/, 'actual PDF must preserve the authored heading');
    } finally { compiler.dispose(); }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { preparePdfItem } from '../src/core/export/pdf/prepareItem.js';
import { resourceStage } from '../src/core/export/pdf/pipeline/resourceStage.js';
import { payloadStage } from '../src/core/export/pdf/pipeline/payloadStage.js';
import { parseProviderConversation } from '../src/core/compatibility/conversationParser.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { TypstSandboxCompiler } from '../src/core/export/typst/typstSandboxCompiler.js';
import { RealWasmSandboxHost, repoRoot } from './helpers/realWasmSandbox.js';
import { extractPdfText, parseObjects, inflateIfNeeded } from './helpers/pdfTextExtract.js';
import type { TypstConversationRenderPayload } from '../src/core/renderers/typst/transport.js';

const ctx = { signal: new AbortController().signal, log() {}, reportProgress() {} };
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const fixture = () => ({ id: 'direct-pdf', title: 'Direct PDF boundary', timestamp: 1700000000000, messages: [
    { id: 'user', role: 'user', content: 'Explain the pipeline.' },
    { id: 'model', role: 'model', thoughts: 'Check **every** relation.', content: '# Results\n\n**Strong** text and [source](https://example.test).\n\n> A quoted result.\n\n1. First\n2. Second\n\n```ts filename=pipeline.ts\nconst layers = 2;\n```\n\n$$\\frac{a}{b}$$\n\n| Item | Value |\n|---|---:|\n| Result | 42 |\n\n![Sample](assets/sample.png)\n\n' + Array.from({ length: 100 }, (_, i) => `Paragraph ${i}: This detailed explanation exercises physical page breaks and flowing text.`).join('\n\n'),
        attachments: [{ type: 'image', name: 'Sample', localName: 'assets/sample.png', sourceUrl: 'https://example.test/sample.png', dataBase64: png, mimeType: 'image/png' }, { type: 'file', name: 'report.pdf', mimeType: 'application/pdf', size: 1234567 }],
    },
] });

test('PDF parser closes resources and reasoning; Domain and AST JSON round-trips preserve meaning', async () => {
    const raw = fixture(), before = structuredClone(raw);
    const parsed = parseProviderConversation(raw);
    const domain = structuredClone(parsed.conversation);
    const roundTrip = JSON.parse(JSON.stringify(domain)) as typeof domain;
    assert.deepEqual(composeDomainDocument(roundTrip), composeDomainDocument(domain));
    const prepared = await preparePdfItem(raw, { includeAssets: false });
    assert.ok(prepared.ok);
    assert.deepEqual(prepared.document, composeDomainDocument(domain).document);
    assert.deepEqual(JSON.parse(JSON.stringify(prepared.document)), prepared.document);
    assert.ok(!('bundle' in prepared) && !('byteStore' in prepared));
    assert.deepEqual(parsed.conversation, domain);
    assert.deepEqual(raw, before);
});

test('intrinsic file size and unknown role survive parser and JSON without output formatting', () => {
    const raw = { id: 'file', messages: [{ role: 'historical-tool', content: 'Answer', attachments: [{ type: 'file', name: 'note.txt', dataBuffer: new Uint8Array([65, 66, 67]) }] }] };
    const parsed = parseProviderConversation(raw).conversation;
    assert.equal(parsed.assets[0].byteLength, 3);
    assert.equal(parsed.messages[0].role, 'unknown');
    assert.equal(parsed.messages[0].provenance?.rawRole, 'historical-tool');
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
    const prepared = await preparePdfItem(raw, { fetchAsset: async request => { urls.push(typeof request === 'string' ? request : request.url ?? ''); return { success: true, mime: 'image/png', dataBase64: png }; } });
    assert.ok(prepared.ok);
    assert.deepEqual(urls, ['https://example.test/one', 'https://example.test/two']);
    assert.equal(prepared.resources.size, 2);
    assert.equal(prepared.document.messages[0].blocks.filter(block => block.type === 'image').length, 2);
});

test('production PDF pipeline only consumes Document AST and prepared resources', () => {
    for (const name of ['prepareItem.ts', 'pdfExporter.ts', 'pipeline/types.ts', 'pipeline/orchestrator.ts', 'pipeline/resourceStage.ts', 'pipeline/payloadStage.ts', 'pipeline/compileStage.ts']) {
        const source = readFileSync(join(__dirname, '../src/core/export/pdf', name), 'utf8');
        assert.doesNotMatch(source, /CanonicalConversationBundle|normalizeGeminiConversation|composeDocument\(|\.bundle\b|\.byteStore\b/);
        if (name.startsWith('pipeline/')) assert.doesNotMatch(source, /parseProviderConversation|provider\/|domain\//);
    }
});

test('direct PDF keeps Typst layout and physical page content parity with the historical route', async () => {
    const raw = fixture();
    const prepared = await preparePdfItem(raw, { includeAssets: false });
    assert.ok(prepared.ok);
    const resolved = await resourceStage(prepared, ctx);
    const direct = await payloadStage({ document: prepared.document, pathMap: resolved.output.pathMap, locale: 'en' }, ctx);
    const reference: TypstConversationRenderPayload = JSON.parse(readFileSync('tests/fixtures/pdf-domain-direct-reference.json', 'utf8'));
    // Engine transport should match independently of the source identity namespace.
    assert.deepEqual(direct.output.payload, reference);
    const host = new RealWasmSandboxHost(repoRoot());
    const compiler = new TypstSandboxCompiler({ host });
    const compile = async (document: TypstConversationRenderPayload) => (await compiler.compile({ rendererSchemaVersion: 1, document, assetPaths: resolved.output.pathMap }, { ...ctx, assets: { resolve: async id => {
        const path = resolved.output.pathMap.get(id), mount = resolved.output.mounts.find(item => item.virtualPath === path);
        return mount ? { bytes: mount.bytes } : null;
    } } })).pdfBytes;
    try {
        const before = await compile(reference), after = await compile(direct.output.payload);
        assert.deepEqual(extractPdfText(after), extractPdfText(before));
        // XMP records wall-clock creation dates and derived instance IDs. They are not page content.
        const content = (bytes: Uint8Array) => [...parseObjects(Buffer.from(bytes)).values()]
            .filter(object => object.stream && !/\/Type\s*\/Metadata\b/.test(object.dict))
            .map(object => inflateIfNeeded(object)?.toString('base64'));
        assert.deepEqual(content(after), content(before));
        assert.ok(extractPdfText(after).pageCount >= 3);
        const output = join(repoRoot(), 'tests/output/pdf-domain-direct'); mkdirSync(output, { recursive: true });
        writeFileSync(join(output, 'before.pdf'), before); writeFileSync(join(output, 'after.pdf'), after);
    } finally { compiler.dispose(); }
});

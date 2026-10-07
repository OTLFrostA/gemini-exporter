import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CanonicalConversationBundle } from '../src/core/export/canonical/conversation.js';
import type { DocumentAst } from '../src/core/export/document/ast.js';
import { composePdfDocument } from '../src/core/export/document/composePdf.js';
import { renderDocumentTypst } from '../src/core/export/document/renderTypst.js';
import { TypstSandboxCompiler } from '../src/core/export/typst/typstSandboxCompiler.js';
import { RealWasmSandboxHost, repoRoot } from './helpers/realWasmSandbox.js';
import { extractPdfText } from './helpers/pdfTextExtract.js';

function fixture(): CanonicalConversationBundle {
    return { schemaVersion: 1, conversation: { key: { providerId: 'example', accountId: 'a', conversationId: 'c' }, title: 'Title', createdAt: '2026-10-06T00:00:00Z', messages: [
        { id: 'u', role: 'user', blocks: [{ type: 'file', assetId: 'file' }, { type: 'paragraph', children: [{ type: 'text', text: 'Question' }] }] },
        { id: 'a', role: 'assistant', author: { model: 'Test model' }, citationIds: ['c'], blocks: [
            { type: 'heading', level: 2, children: [{ type: 'text', text: 'Heading' }] },
            { type: 'paragraph', children: [{ type: 'text', text: 'Before code' }] },
            { type: 'code', filename: 'example.py', language: 'python', meta: 'sample', code: 'print(1)' },
            { type: 'quote', blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'Nested intro' }] }, { type: 'code', code: 'nested' }] },
            { type: 'table', caption: [{ type: 'strong', children: [{ type: 'text', text: 'Table caption' }] }], headerRows: [{ cells: [{ children: [{ type: 'text', text: 'Merged' }], colSpan: 2 }] }], rows: [{ cells: [{ children: [{ type: 'text', text: 'Left' }] }, { children: [{ type: 'text', text: 'Right' }] }] }] },
            { type: 'image', assetId: 'image', caption: [{ type: 'strong', children: [{ type: 'text', text: '123' }] }] },
            { type: 'image', assetId: 'image', alt: 'Again' },
        ] },
        { id: 's', role: 'system', blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'System content' }] }] },
        { id: 'u2', role: 'user', blocks: [] },
    ] }, assets: [{ id: 'file', kind: 'file', name: 'Reference.pdf', status: 'remote', mimeType: 'application/pdf', sizeBytes: 4096 }, { id: 'image', kind: 'image', name: 'asset_987654.png', status: 'available' }], citations: [{ id: 'c', kind: 'web', title: 'Source', url: 'https://example.com' }] };
}
function freeze(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    Object.freeze(value); Object.values(value).forEach(freeze);
}
const resources = { image: '/assets/image.png' };

test('PDF composition resolves layout and display metadata without mutating input', () => {
    const input = fixture(); const before = JSON.stringify(input); freeze(input);
    const result = composePdfDocument(input, resources);
    assert.deepEqual(composePdfDocument(input, resources), result); assert.equal(JSON.stringify(input), before);
    const doc = result.document; const blocks = doc.messages[1].blocks;
    assert.equal(doc.profile.id, 'pdf'); assert.equal(doc.header.metadata, 'example · 2026-10-06 · 4 messages');
    assert.equal(doc.messages[0].variant, 'bubble'); assert.equal(doc.messages[1].variant, 'flow');
    assert.deepEqual(doc.messages[0].minWidthCards, [{ label: 'Reference.pdf', metadata: 'PDF · 4.00 KB' }]);
    assert.deepEqual(doc.messages.map(message => message.gapAfterPt), [22.5, 22.5, 30, 0]);
    assert.equal(blocks[0].layout?.keepWithNext, true); assert.equal(blocks[1].layout?.gapBeforePt, 9);
    assert.equal(blocks[1].layout?.keepWithNext, true); assert.equal(blocks[2].layout?.gapBeforePt, 13.5);
    const quote = blocks[3]; if (quote.type !== 'quote') throw new Error('Expected quote');
    assert.equal(quote.blocks[0].layout?.keepWithNext, false, 'nested compatibility policy is explicit');
    assert.equal(quote.blocks[1].layout?.gapBeforePt, 13.5);
    assert.equal(doc.messages[2].blocks[0].type, 'note'); assert.equal(blocks.at(-1)?.type, 'note');
    assert.equal(doc.pdfLayout?.bubble.maxWidthRatio, 0.85); assert.equal(doc.pdfLayout?.figure.maxPageHeightRatio, 0.6);
    const table = blocks[4]; if (table.type !== 'table') throw new Error('Expected table');
    assert.equal(table.repeatHeader, true); assert.equal(table.columnAlignments.length, 2);
    assert.deepEqual(table.caption, [{ type: 'text', text: 'Table caption' }]);
});

test('PDF backend lowers a JSON display tree, honors policy edits and keeps resource identity', () => {
    const { document } = composePdfDocument(fixture(), resources);
    const restored: DocumentAst = JSON.parse(JSON.stringify(document));
    const first = renderDocumentTypst(document, resources); assert.deepEqual(renderDocumentTypst(restored, resources), first);
    assert.equal(first.messages[1].blocks.filter(block => block.type === 'image').length, 2);
    assert.equal(first.messages[1].blocks[5].type === 'image' && first.messages[1].blocks[5].caption, '123');
    restored.header.metadata = 'Chosen metadata'; restored.messages[0].variant = 'flow'; restored.messages[0].gapAfterPt = 42;
    restored.messages[1].blocks[1].layout = { gapBeforePt: 31, keepWithNext: false, width: 'full' };
    const code = restored.messages[1].blocks[2]; if (code.type !== 'code') throw new Error('Expected code'); code.header = 'Chosen code header';
    const table = restored.messages[1].blocks[4]; if (table.type !== 'table') throw new Error('Expected table'); table.repeatHeader = false;
    const changed = renderDocumentTypst(restored, resources);
    assert.equal(changed.metadata, 'Chosen metadata'); assert.equal(changed.messages[0].variant, 'flow'); assert.equal(changed.messages[0].gapAfterPt, 42);
    assert.deepEqual(changed.messages[1].blocks[1].layout, { gapBeforePt: 31, keepWithNext: false, width: 'full' });
    assert.equal(changed.messages[1].blocks[2].type === 'code' && changed.messages[1].blocks[2].header, 'Chosen code header');
    assert.equal(changed.messages[1].blocks[4].type === 'table' && changed.messages[1].blocks[4].repeatHeader, false);
    assert.throws(() => renderDocumentTypst(document, {}), /Missing prepared resource/);
});

test('real PDF engine consumes explicit page policy and display labels without a conversation', async () => {
    const input = fixture(); input.conversation.messages = [{ id: 'a', role: 'assistant', blocks: Array.from({ length: 25 }, (_, index) => ({ type: 'paragraph', children: [{ type: 'text', text: `Passage ${index}. ` + 'Page layout remains an engine responsibility. '.repeat(8) }] })) }];
    const { document } = composePdfDocument(input, {}); const smaller: DocumentAst = JSON.parse(JSON.stringify(document));
    smaller.header.metadata = 'Chosen header metadata'; smaller.pdfLayout!.page.heightMm = 150;
    const compiler = new TypstSandboxCompiler({ host: new RealWasmSandboxHost(repoRoot()) });
    const context = { assets: { resolve: async () => null }, signal: new AbortController().signal, reportProgress: () => undefined };
    try {
        const original = extractPdfText((await compiler.compile({ rendererSchemaVersion: 1, document: renderDocumentTypst(document, {}), assetPaths: new Map() }, context)).pdfBytes);
        const changed = extractPdfText((await compiler.compile({ rendererSchemaVersion: 1, document: renderDocumentTypst(smaller, {}), assetPaths: new Map() }, context)).pdfBytes);
        assert.ok(changed.pageCount > original.pageCount); assert.ok(changed.text.includes('Chosen header metadata'));
        assert.ok(changed.text.includes('Passage 24.')); assert.ok(original.text.includes('Passage 24.'));
    } finally { compiler.dispose(); }
});

test('PDF serializer/compiler/templates have no semantic or neighboring-node layout inference', () => {
    for (const file of ['src/core/export/document/renderTypst.ts', 'src/core/export/typst/transport.ts', 'src/core/export/pdf/pdfCompiler.ts', 'src/core/export/typst/typstSandboxCompiler.ts']) {
        const code = readFileSync(file, 'utf8');
        assert.doesNotMatch(code, /from ['"].*canonical\/|from ['"].*content\/|from ['"].*provider\/|\.bundle\b|\.role\b|assetPresentation|citationDisplayLabel/);
    }
    const messages = readFileSync('src/core/export/typst/templates/render-message.typ', 'utf8');
    const blocks = readFileSync('src/core/export/typst/templates/render-block.typ', 'utf8');
    const components = readFileSync('src/core/export/typst/templates/components.typ', 'utf8');
    assert.doesNotMatch(messages, /\.role|\.filter\(|messages\.at\(/);
    assert.doesNotMatch(blocks, /block-gap|should-keep-with-next|blocks\.at\(/);
    assert.doesNotMatch(components, /logical-cols|filename \+|kind \+ " · " \+ size/);
});

test('PDF missing placements preserve authored numeric captions and descriptions', () => {
    const input = fixture(); input.conversation.messages[1].blocks = [
        { type: 'image', assetId: 'image', caption: [{ type: 'strong', children: [{ type: 'text', text: '123' }] }] },
        { type: 'file', assetId: 'missing', label: 'Missing.pdf', description: [{ type: 'strong', children: [{ type: 'text', text: 'Authored description' }] }] },
    ];
    const { document, diagnostics } = composePdfDocument(input, {});
    const payload = renderDocumentTypst(document, {});
    const image = payload.messages[1].blocks[0]; const file = payload.messages[1].blocks[1];
    assert.equal(image.type === 'unknown' && image.fallback, '123');
    assert.equal(file.type === 'unknown' && file.fallback, 'Missing.pdf\n\nAuthored description');
    assert.ok(diagnostics.some(d => d.code === 'TYPST_V8_IMAGE_MISSING'));
});

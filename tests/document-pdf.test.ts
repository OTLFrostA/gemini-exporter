import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CanonicalConversationBundle } from '../src/core/export/canonical/conversation.js';
import type { DocumentAst } from '../src/core/export/document/ast.js';
import { composeDocument } from '../src/core/export/document/composeDocument.js';
import { renderDocumentTypst, defaultPdfLayout } from '../src/core/export/document/renderTypst.js';
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

test('PDF backend derives policies and metadata from immutable JSON display data', () => {
    const input = fixture(); const before = JSON.stringify(input); freeze(input);
    const { document } = composeDocument(input);
    const restored: DocumentAst = JSON.parse(JSON.stringify(document)); freeze(document);
    const payload = renderDocumentTypst(document, resources);
    assert.deepEqual(renderDocumentTypst(restored, resources), payload); assert.equal(JSON.stringify(input), before);
    assert.deepEqual(payload.messages[0].minWidthCards, [{ label: 'Reference.pdf', metadata: 'PDF · 4.00 KB' }]);
    assert.deepEqual(payload.messages.map(message => message.gapAfterPt), [22.5, 22.5, 30, 0]);
    assert.equal(payload.messages[1].blocks[0].layout.keepWithNext, true);
    const table = document.messages[1].blocks[4]; if (table.type !== 'table') throw new Error('Expected table');
    assert.deepEqual(table.caption, [{ type: 'strong', children: [{ type: 'text', text: 'Table caption' }] }]);
    const changed = renderDocumentTypst(restored, resources, { repeatTableHeader: false, locale: 'zh' });
    assert.equal(changed.messages[1].blocks[4].type === 'table' && changed.messages[1].blocks[4].repeatHeader, false);
    assert.equal(changed.messages[1].blocks[5].type === 'image' && changed.messages[1].blocks[5].caption, '123');
});

test('real PDF engine changes page policy without recomposing the document', async () => {
    const input = fixture(); input.conversation.messages = [{ id: 'a', role: 'assistant', blocks: Array.from({ length: 25 }, (_, index) => ({ type: 'paragraph', children: [{ type: 'text', text: `Passage ${index}. ` + 'Page layout remains an engine responsibility. '.repeat(8) }] })) }];
    const { document } = composeDocument(input); const originalJson = JSON.stringify(document);
    const layout = defaultPdfLayout(); layout.page.heightMm = 150;
    const compiler = new TypstSandboxCompiler({ host: new RealWasmSandboxHost(repoRoot()) });
    const context = { assets: { resolve: async () => null }, signal: new AbortController().signal, reportProgress: () => undefined };
    try {
        const original = extractPdfText((await compiler.compile({ rendererSchemaVersion: 1, document: renderDocumentTypst(document, {}), assetPaths: new Map() }, context)).pdfBytes);
        const changed = extractPdfText((await compiler.compile({ rendererSchemaVersion: 1, document: renderDocumentTypst(document, {}, { layout }), assetPaths: new Map() }, context)).pdfBytes);
        assert.ok(changed.pageCount > original.pageCount); assert.ok(changed.text.includes('Passage 24.')); assert.ok(original.text.includes('Passage 24.'));
        assert.equal(JSON.stringify(document), originalJson);
    } finally { compiler.dispose(); }
});

test('PDF backend/compiler have no source-model imports; backend may infer layout from display neighbors', () => {
    for (const file of ['src/core/export/document/renderTypst.ts', 'src/core/export/typst/transport.ts', 'src/core/export/typst/layout.ts', 'src/core/export/pdf/pdfCompiler.ts', 'src/core/export/typst/typstSandboxCompiler.ts']) {
        const code = readFileSync(file, 'utf8');
        assert.doesNotMatch(code, /from ['"].*canonical\/|from ['"].*content\/|from ['"].*provider\/|\.bundle\b|\.role\b|assetPresentation|citationDisplayLabel/);
    }
});

test('PDF missing placements preserve authored numeric captions and descriptions', () => {
    const input = fixture(); input.conversation.messages[1].blocks = [
        { type: 'image', assetId: 'image', caption: [{ type: 'strong', children: [{ type: 'text', text: '123' }] }] },
        { type: 'file', assetId: 'missing', label: 'Missing.pdf', description: [{ type: 'strong', children: [{ type: 'text', text: 'Authored description' }] }] },
    ];
    const { document } = composeDocument(input);
    const payload = renderDocumentTypst(document, {});
    const image = payload.messages[1].blocks[0], file = payload.messages[1].blocks[1];
    assert.equal(image.type === 'unknown' && image.fallback, '123');
    assert.equal(file.type === 'unknown' && file.fallback, 'Missing.pdf\n\nAuthored description');
});

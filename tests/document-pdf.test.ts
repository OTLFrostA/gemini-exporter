import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';
import type { DocumentAst } from '../src/core/export/document/ast.js';
import { composeDomainDocument } from '../src/core/export/document/composeDomainDocument.js';
import { renderDocumentTypst, defaultPdfLayout } from '../src/core/export/document/renderTypst.js';
import { TypstSandboxCompiler } from '../src/core/export/typst/typstSandboxCompiler.js';
import { RealWasmSandboxHost, repoRoot } from './helpers/realWasmSandbox.js';
import { extractPdfText } from './helpers/pdfTextExtract.js';

function fixture(): DomainConversationDetail {
    return JSON.parse(readFileSync('tests/fixtures/document-domain/document-pdf.json', 'utf8'));
}

function freeze(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    Object.freeze(value); Object.values(value).forEach(freeze);
}
const resources = { image: '/assets/image.png' };

test('PDF backend derives policies and metadata from immutable JSON display data', () => {
    const input = fixture(); const before = JSON.stringify(input); freeze(input);
    const { document } = composeDomainDocument(input);
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
    assert.deepEqual(changed.messages[1].blocks[5].type === 'image' && changed.messages[1].blocks[5].caption, [{ type: 'strong', children: [{ type: 'text', text: '123' }] }]);
});

test('real PDF engine changes page policy without recomposing the document', async () => {
    const input = fixture(); input.messages = [{ id: 'a', role: 'assistant', content: Array.from({ length: 25 }, (_, index) => ({ type: 'paragraph', children: [{ type: 'text', text: `Passage ${index}. ` + 'Page layout remains an engine responsibility. '.repeat(8) }] })) }];
    const { document } = composeDomainDocument(input); const originalJson = JSON.stringify(document);
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
    const input = fixture(); input.messages[1].content = [
        { type: 'image', assetId: 'image', caption: [{ type: 'strong', children: [{ type: 'text', text: '123' }] }] },
        { type: 'file', assetId: 'missing', label: 'Missing.pdf', description: [{ type: 'strong', children: [{ type: 'text', text: 'Authored description' }] }] },
    ];
    input.assets.push({ id: 'missing', kind: 'file' });
    const { document } = composeDomainDocument(input);
    const payload = renderDocumentTypst(document, {});
    const image = payload.messages[1].blocks[0], file = payload.messages[1].blocks[1];
    assert.deepEqual(image.type === 'unknown' && image.details, [{ type: 'strong', children: [{ type: 'text', text: '123' }] }]);
    assert.ok(file.type === 'file');
    assert.equal(file.name, 'Missing.pdf');
    assert.deepEqual(file.description, [{ type: 'strong', children: [{ type: 'text', text: 'Authored description' }] }]);
    document.messages[1].blocks[1] = { type: 'placeholder', resourceId: 'missing', kind: 'file', text: 'Missing.pdf', details: [{ type: 'strong', children: [{ type: 'text', text: 'Authored description' }] }] };
    const placeholder = renderDocumentTypst(document, {}).messages[1].blocks[1];
    assert.equal(placeholder.type === 'unknown' && placeholder.fallback, 'Missing.pdf');
    assert.deepEqual(placeholder.type === 'unknown' && placeholder.details, [{ type: 'strong', children: [{ type: 'text', text: 'Authored description' }] }]);
});

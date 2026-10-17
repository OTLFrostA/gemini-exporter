import { preparedResources } from './helpers/resources.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DocumentAst, DisplayInline } from '../src/core/document/ast/ast.js';
import { renderDocumentTypst } from '../src/core/renderers/typst/renderTypst.js';
import { collectDocumentResources } from '../src/core/document/ast/resourceReferences.js';
import { compileDocumentPdf } from '../src/core/export/pdf/compileDocumentPdf.js';
import { TypstSandboxCompiler, stripConvertedMath } from '../src/core/export/typst/typstSandboxCompiler.js';
import { RealWasmSandboxHost, repoRoot } from './helpers/realWasmSandbox.js';
import { probePdfLayout } from './helpers/pdfPageProbe.js';
import { extractPdfText } from './helpers/pdfTextExtract.js';

function fixture(): DocumentAst {
    const rich = (label: string): DisplayInline[] => [{ type: 'strong', children: [
        { type: 'text', text: label }, { type: 'image', resourceId: 'rich', alt: label }, { type: 'inlineMath', source: 'x' },
    ] }];
    return { schemaVersion: 2, metadata: { id: 'fixture', provider: 'test' }, header: { title: 'Rich PDF', providerLabel: 'custom', messageCount: 1 }, messages: [{
        type: 'message', id: 'm', variant: 'flow', label: 'assistant', blocks: [
            { type: 'image', resourceId: 'main', alt: 'Main', caption: rich('Image caption') },
            { type: 'table', caption: rich('Table caption'), columnAlignments: ['left'], headerRows: [], rows: [[{ column: 0, colSpan: 1, rowSpan: 1, align: 'left', children: rich('Table cell') }]] },
            { type: 'file', resourceId: 'file', kind: 'file', label: 'File', description: rich('File description') },
            { type: 'image', resourceId: 'unavailable', alt: 'Unavailable', caption: rich('Missing image caption') },
            { type: 'placeholder', kind: 'file', text: 'Unavailable file', details: rich('Placeholder details') },
            { type: 'paragraph', children: rich('Body ending') },
        ], sources: { type: 'sources', items: [{ id: 's', number: 1, label: 'Source title' }] },
    }] };
}

test('rich PDF fields render physical images, including captions of missing parents', async () => {
    const document = fixture(), before = JSON.stringify(document);
    const corpus = JSON.parse(readFileSync('tests/fixtures/visual-corpus/08-image-caption.json', 'utf8'));
    const png = new Uint8Array(Buffer.from(Object.values(corpus.binaries)[0] as string, 'base64'));
    assert.deepEqual([...collectDocumentResources(document).imageIds].sort(), ['main', 'rich', 'unavailable']);
    const bindings = { main: 'assets/main.png', rich: 'assets/rich.png' };
    const resources = preparedResources(['main', 'rich'].map(id => [id, { bytes: png, mediaType: 'image/png' }]));
    const mounted = new Set<string>();
    const compiler = new TypstSandboxCompiler({ host: new RealWasmSandboxHost(repoRoot()) });
    try {
        const result = await compileDocumentPdf(document, bindings, resources, {
            name: compiler.name,
            async compile(payload, context) {
                assert.deepEqual([...payload.assetPaths], Object.entries(bindings));
                return compiler.compile(payload, { ...context, assets: { async resolve(id) {
                    mounted.add(id);
                    return context.assets.resolve(id);
                } } });
            },
        }, { signal: new AbortController().signal, reportProgress() {} }, { convertMath: () => undefined });
        const extracted = extractPdfText(result.pdfBytes);
        const probe = probePdfLayout(result.pdfBytes);
        assert.equal(probe.pages.reduce((sum, page) => sum + page.imageDraws.length, 0), 8, 'main figure plus seven rich inline placements are physically drawn');
        for (const label of ['Image caption', 'Table caption', 'Table cell', 'File description', 'Missing image caption', 'Placeholder details', 'Body ending', 'Source title']) assert.ok(extracted.text.includes(label), label);
        assert.equal(mounted.size, 2);
        assert.equal(JSON.stringify(document), before);
    } finally { compiler.dispose(); }
});

test('font fallback visits converted math in all rich PDF fields', () => {
    const payload = renderDocumentTypst(fixture(), { main: 'assets/main.png', rich: 'assets/rich.png' }, { convertMath: () => 'x' });
    assert.equal(stripConvertedMath(payload), 7);
    assert.ok(!JSON.stringify(payload).includes('"typst"'));
});

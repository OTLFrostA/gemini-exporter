/** Real WASM end-to-end compilation: deliberately NOT in the isolated L4 unit gate. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { probePdfLayout } from './helpers/pdfPageProbe.js';
import type { PreparedResources } from '../src/shared/resources/resourceResult.js';
import { v2Document } from './helpers/l4V2Fixtures.js';
import { compileDocumentPdf } from '../src/l4/format/pdf/compileDocumentPdf.js';
import { TypstSandboxCompiler } from '../src/l4/format/pdf/typst/typstSandboxCompiler.js';
import { RealWasmSandboxHost, repoRoot } from './helpers/realWasmSandbox.js';
import { extractPdfText } from './helpers/pdfTextExtract.js';

const document = v2Document([
    { type: 'image', resourceId: 'image', alt: 'Figure' },
    { type: 'file', resourceId: 'file', label: 'notes.pdf', kind: 'file' },
    { type: 'math', source: 'x^2' },
]);
const context = () => ({ signal: new AbortController().signal, reportProgress() {} });

test('real WASM compiles an image at the supplied Packaging path and releases its sandbox', async () => {
    const compiler = new TypstSandboxCompiler({ host: new RealWasmSandboxHost(repoRoot()) });
    const bytes = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    const resources: PreparedResources = new Map([['image', { ok: true, resourceId: 'image', value: { bytes } }]]);
    try {
        const result = await compileDocumentPdf(document, { image: 'assets/packaging-image.png' }, resources, compiler, context());
        const extracted = extractPdfText(result.pdfBytes);
        assert.ok(extracted.imageXObjectCount >= 1);
        assert.match(extracted.text, /notes\.pdf/);
        assert.equal(result.diagnostics.some(d => d.severity === 'error'), false);
    } finally {
        compiler.dispose();
    }
});


test('real PDF keeps character diagrams on source lines and combining graphemes selectable once', async t => {
    const courier = ['/System/Library/Fonts/Supplemental/Courier New.ttf', 'C:/Windows/Fonts/cour.ttf']
        .find(existsSync);
    if (!courier) { t.skip('Courier New unavailable on this host'); return; }
    const compiler = new TypstSandboxCompiler({ host: new RealWasmSandboxHost(repoRoot()) });
    const diagram = '[Fluorophore distribution] ' + '─'.repeat(70) + '> [Optical field]';
    try {
        compiler.setRuntimeFonts([new Uint8Array(readFileSync(courier))]);
        const result = await compileDocumentPdf(v2Document([
            { type: 'code', language: 'text', code: diagram + '\n[Density x\u0302] x\u0302x\u0302' },
        ]), {}, new Map(), compiler, context());
        const text = extractPdfText(result.pdfBytes).contentRuns.filter(run => run.kind === 'code').map(run => run.text).join('');
        assert.equal(text.replace(/\s/g, ''), (diagram + '[Density x\u0302] x\u0302x\u0302').replace(/\s/g, ''));
        const page = probePdfLayout(result.pdfBytes).pages[0];
        const left = page.runs.find(run => run.text.includes('Fluorophore'))!;
        const right = page.runs.find(run => run.text.includes('Optical'))!;
        assert.ok(left && right);
        assert.ok(Math.abs(left.y - right.y) < 0.2, 'long diagram endpoints share one baseline');
    } finally { compiler.dispose(); }
});


test('short PDF source footers retain the preceding context across page boundaries', async () => {
    const compiler = new TypstSandboxCompiler({ host: new RealWasmSandboxHost(repoRoot()) });
    try {
        for (const count of [24, 28, 32, 36, 40]) {
            const doc = v2Document([
                ...Array.from({ length: count }, (_, index) => ({ type: 'paragraph' as const, children: [{ type: 'text' as const, text: 'Paragraph ' + index + ': ' + 'Physical evidence and explanatory context. '.repeat(3) }] })),
                { type: 'paragraph', children: [{ type: 'text', text: 'Final source context survives.' }] },
            ]);
            doc.messages[0].sources = Array.from({ length: 6 }, (_, index) => ({ id: String(index), number: index + 1, label: 'Reference ' + index, href: 'https://example.com/' + index }));
            const result = await compileDocumentPdf(doc, {}, new Map(), compiler, context());
            const last = probePdfLayout(result.pdfBytes).pages.at(-1)!;
            assert.ok(last.text.includes('Reference 5'));
            assert.ok(last.text.includes('Final source context survives.'), 'reference footer must not be orphaned');
        }
    } finally { compiler.dispose(); }
});


test('live negated implication has a real PDF formula instead of a raw-LaTeX fallback', async () => {
    const compiler = new TypstSandboxCompiler({ host: new RealWasmSandboxHost(repoRoot()) });
    try {
        const result = await compileDocumentPdf(v2Document([
            { type: 'math', source: String.raw`a \to b \centernot\implies V(a) < V(b)` },
        ]), {}, new Map(), compiler, context());
        const extracted = extractPdfText(result.pdfBytes);
        assert.equal(extracted.contentRuns.filter(run => run.kind === 'math').length, 1);
        assert.ok(extracted.contentRuns.find(run => run.kind === 'math')?.text.includes('⇏'));
        assert.equal(result.diagnostics.some(d => d.code === 'TYPST_MATH_CONVERT_FAILED'), false);
    } finally { compiler.dispose(); }
});

/** Real WASM end-to-end compilation: deliberately NOT in the isolated L4 unit gate. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
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

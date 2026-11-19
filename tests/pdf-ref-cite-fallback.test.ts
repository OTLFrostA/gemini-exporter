import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { reset, seed, request, deliveries, stubModule } from './helpers/applicationHarness.js';
import { RealWasmSandboxHost, repoRoot } from './helpers/realWasmSandbox.js';
import { extractPdfText } from './helpers/pdfTextExtract.js';

// Keep browser/storage ports in memory, but use the production composition,
// packaging, conversion and PDF compiler all the way from the popup entrypoint.
for (const path of [
    '../src/l2/accountRegistry.js',
    '../src/l3b/compose/composeDomainDocument.js',
    '../src/l3b/ast/resourceReferences.js',
    '../src/l4/packaging/index.js',
    '../src/l4/format/pdf/compileDocumentPdf.js',
    '../src/l4/format/pdf/typst/typstSandboxCompiler.js',
]) delete require.cache[require.resolve(path)];
const { TypstSandboxCompiler } = require('../src/l4/format/pdf/typst/typstSandboxCompiler.js');
stubModule('../../src/l4/format/pdf/typst/typstSandboxCompiler.js', {
    TypstSandboxCompiler: class extends TypstSandboxCompiler {
        constructor() { super({ host: new RealWasmSandboxHost(repoRoot()) }); }
    },
});
const { runExport } = require('../src/application/export/runExport.js');

for (const command of ['ref', 'eqref', 'cite']) {
    for (const display of [false, true]) {
        test(`popup PDF export preserves raw \\${command} in ${display ? 'block' : 'inline'} math`, async () => {
            reset();
            const { detail } = seed();
            const source = `x + \\${command}{eq1}`;
            const content = [
                { type: 'paragraph', children: [{ type: 'text', text: 'Before formula' }] },
                display ? { type: 'math', source } : { type: 'paragraph', children: [{ type: 'inlineMath', source }] },
                { type: 'paragraph', children: [{ type: 'inlineMath', source: 'x^2' }, { type: 'text', text: ' After formula' }] },
            ];
            // The fixture is a storage port, not a replacement for composition.
            Object.assign(detail, { messages: [{ role: 'assistant', content }] });
            const result = await runExport(request({ format: 'pdf' }));
            assert.equal(result.exported, 1, JSON.stringify(result));
            assert.equal(result.partial, 0);
            const bytes = deliveries[0][0].content;
            assert.ok(bytes instanceof Uint8Array);
            if (process.env.PDF_FALLBACK_EVIDENCE && command === 'cite' && display) {
                writeFileSync(process.env.PDF_FALLBACK_EVIDENCE, bytes);
            }
            const { text } = extractPdfText(Buffer.from(bytes));
            assert.ok(text.includes(source), text);
            assert.ok(text.includes('Before formula'), text);
            assert.ok(text.includes('After formula'), text);
            assert.ok(!text.includes('x^2'), 'supported math must not fall back');
        });
    }
}

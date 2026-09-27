/**
 * tests/typst-math-int-integral.test.ts
 *
 * W2 regression suite: `\int` must map to Typst `integral`, not `int`.
 * Typst `int` is the integer type / constructor, so a bare `int` in math
 * mode produced "unknown variable" errors. This suite proves:
 *  - W2-1: string-level mapping for \int_0^1 and \int_0^\infty
 *  - W2-2: sum/prod mappings are untouched (string level)
 *  - W2-3: real end-to-end through the vendored WASM compiler —
 *    convertMath -> Typst string -> real compile -> zero error diagnostics
 *    -> extracted PDF text carries the ∫ glyph (U+222B).
 *    \sum rides along as a compile-clean sanity check only.
 */
export {};
const test = require('node:test');
const assert = require('node:assert');

const { TypstSandboxCompiler } = require('../src/core/export/typst/typstSandboxCompiler.js');
const { toTypstPayload } = require('../src/core/export/typst/payload.js');
const { convertMath } = require('../src/core/export/typst/mathConverter.js');
const { extractPdfText } = require('./helpers/pdfTextExtract.js');
const { RealWasmSandboxHost, repoRoot } = require('./helpers/realWasmSandbox.js');

test('W2-1: \\int maps to Typst `integral` (not `int`)', () => {
    assert.strictEqual(
        convertMath('\\int_0^1 x^2 dx', 'latex', true),
        'integral_0^1 x^2 d x',
        'definite integral over [0,1]',
    );
    assert.strictEqual(
        convertMath('\\int_0^\\infty e^{-x} dx', 'latex', true),
        'integral_0^oo e^(- x) d x',
        'improper integral to infinity',
    );
});

test('W2-2: sum/prod mappings are untouched', () => {
    assert.strictEqual(convertMath('\\sum_{i=1}^{n}', 'latex', true), 'sum_(i = 1)^n');
    assert.strictEqual(convertMath('\\prod_{k=1}^m', 'latex', true), 'prod_(k = 1)^m');
});

test('W2-3: real WASM compile: zero errors, PDF carries ∫ (U+222B)', async () => {
    const bundle = {
        schemaVersion: 1,
        conversation: {
            key: { providerId: 'gemini', conversationId: 'w2-integral' },
            title: { value: 'W2 integral regression' },
            createdAt: '2026-09-26T00:00:00Z',
            messages: [{
                id: 'm1',
                role: 'assistant',
                blocks: [
                    { id: 'b1', type: 'math', source: '\\int_0^1 x^2 dx', notation: 'latex' },
                    { id: 'b2', type: 'math', source: '\\int_0^\\infty e^{-x} dx', notation: 'latex' },
                    // \sum rides along as a compile-clean sanity check (mapping untouched).
                    { id: 'b3', type: 'math', source: '\\sum_{i=1}^{n} i', notation: 'latex' },
                    // NOTE: \prod -> `prod` does NOT compile in Typst (unknown variable;
                    // the real symbol is `product`). Pre-existing bug of the same class,
                    // deliberately left out of scope for W2; reported separately.
                ],
            }],
        },
        assets: [],
        citations: [],
    };
    const assetPath = (a: { id: string }) => `/assets/${a.id}`;
    const { payload: document } = toTypstPayload(bundle, { assetPath, convertMath });
    const host = new RealWasmSandboxHost(repoRoot());
    const compiler = new TypstSandboxCompiler({ host });
    const context = {
        bundle: null,
        assets: { resolve: async () => null },
        locale: 'zh',
        signal: new AbortController().signal,
        reportProgress: () => undefined,
    };
    try {
        const result = await compiler.compile(
            {
                rendererSchemaVersion: 1,
                sourceSchemaVersion: 1,
                bundle,
                document,
                assetPaths: new Map(),
            },
            context,
        );
        const errors = (result.diagnostics ?? []).filter(
            (d: { severity: string }) => d.severity === 'error',
        );
        assert.deepStrictEqual(errors, [], `compile errors: ${JSON.stringify(errors)}`);
        assert.strictEqual(
            Buffer.from(result.pdfBytes.slice(0, 5)).toString('latin1'),
            '%PDF-',
            'real PDF bytes produced',
        );
        const extracted = extractPdfText(result.pdfBytes);
        assert.ok(
            extracted.text.includes('∫'),
            `PDF text must contain the integral glyph ∫ (U+222B); ` +
            `extracted head: ${JSON.stringify(extracted.text.slice(0, 200))}`,
        );
    } finally {
        compiler.dispose();
    }
});

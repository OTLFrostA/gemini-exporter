/**
 * tests/typst-math-cases-operatorname.test.ts
 *
 * W3 regression suite for the math converter correctness fixes:
 *  - \begin{cases} rows keep row boundaries (one cases() argument per row,
 *    & aligns cells within a row) instead of flattening cells
 *  - \operatorname* keeps its limits semantics, distinct from the unstarred form
 *  - \circ maps to U+2218 (function composition), not the degree sign
 *
 * W3-1 proves the string-level shapes; W3-2 runs the real converter output
 * through the vendored WASM compiler (convertMath -> Typst source -> real
 * compile) and requires zero error diagnostics plus a real PDF.
 */
export {};
const test = require('node:test');
const assert = require('node:assert');

const { TypstSandboxCompiler } = require('../src/core/export/typst/typstSandboxCompiler.js');
const { toTypstPayload } = require('../src/core/export/typst/payload.js');
const { convertMath, convertMathWithDiagnostic } = require('../src/core/export/typst/mathConverter.js');
const { RealWasmSandboxHost, repoRoot } = require('./helpers/realWasmSandbox.js');

test('W3-1: cases rows, operatorname star distinction, circ mapping', () => {
    assert.strictEqual(
        convertMath('\\begin{cases} 1 & x > 0 \\\\ 0 & x \\le 0 \\end{cases}', 'latex', true),
        'cases(1 & x > 0, 0 & x <= 0)',
        'two rows stay two cases() arguments',
    );
    assert.strictEqual(
        convertMath('\\begin{cases} a \\\\ b \\end{cases}', 'latex', true),
        'cases(a, b)',
        'one-column form keeps one row per line',
    );
    const starred = convertMath('\\operatorname*{max}_{x} f(x)', 'latex', true);
    const plain = convertMath('\\operatorname{max}_{x} f(x)', 'latex', true);
    assert.notStrictEqual(starred, plain, 'starred and unstarred operatorname must differ');
    assert.strictEqual(starred, 'op("max", limits: #true)_x f ( x )');
    assert.strictEqual(plain, 'op("max", limits: #false)_x f ( x )');
    assert.strictEqual(convertMath('f \\circ g', 'latex', true), 'f compose g');
});

test('W3-2: real WASM compile of cases + operatorname* + compose, zero errors', async () => {
    const sources = [
        '\\begin{cases} 1 & x > 0 \\\\ 0 & x \\le 0 \\end{cases}',
        '\\begin{cases} a \\\\ b \\end{cases}',
        '\\operatorname*{max}_{x} f(x)',
        '\\operatorname{Tr}(A)',
        'f \\circ g',
    ];
    for (const source of sources) {
        const r = convertMathWithDiagnostic(source, 'latex', true);
        assert.ok(r.typst, `converter must succeed for: ${source}`);
    }
    const bundle = {
        schemaVersion: 1,
        conversation: {
            key: { providerId: 'gemini', conversationId: 'w3-cases-op' },
            title: { value: 'W3 cases/operatorname regression' },
            createdAt: '2026-09-26T00:00:00Z',
            messages: [{
                id: 'm1',
                role: 'assistant',
                blocks: sources.map((source, i) => ({
                    id: `b${i + 1}`,
                    type: 'math',
                    source,
                    notation: 'latex',
                })),
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
    } finally {
        compiler.dispose();
    }
});

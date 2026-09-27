export {};
const test = require('node:test');
const assert = require('node:assert');

const { TypstSandboxCompiler } = require('../src/core/export/typst/typstSandboxCompiler.js');
const { toTypstPayload } = require('../src/core/export/typst/payload.js');
const { convertMath, convertMathWithDiagnostic } = require('../src/core/export/typst/math/convertMath.js');
const { TYPST_MATH_CORPUS } = require('./fixtures/typst-math-corpus.js');
const { RealWasmSandboxHost, repoRoot } = require('./helpers/realWasmSandbox.js');

test('typst math corpus: parser correctness across semantic categories', () => {
    for (const item of TYPST_MATH_CORPUS) {
        if (item.shouldFallback) {
            const res = convertMath(item.latex, 'latex', item.display);
            assert.strictEqual(
                res,
                undefined,
                `[${item.category}] '${item.name}' should fallback to raw LaTeX but got: ${res}`,
            );
            const diag = convertMathWithDiagnostic(item.latex, 'latex', item.display);
            assert.ok(
                diag.diagnostic !== undefined,
                `[${item.category}] '${item.name}' must produce a diagnostic`,
            );
        } else if (item.expectedTypst !== undefined) {
            const res = convertMath(item.latex, 'latex', item.display);
            assert.strictEqual(
                res,
                item.expectedTypst,
                `[${item.category}] '${item.name}' conversion mismatch`,
            );
        }
    }
});

test('typst math corpus: representative cases real WASM compilation smoke test', async () => {
    const wasmItems = TYPST_MATH_CORPUS.filter((i: { wasmSmoke?: boolean }) => i.wasmSmoke);
    assert.ok(wasmItems.length >= 5, 'must test a representative selection of WASM smoke items');

    const bundle = {
        schemaVersion: 1,
        conversation: {
            key: { providerId: 'gemini', conversationId: 'math-corpus-smoke' },
            title: { value: 'Typst Math Corpus Smoke Test' },
            createdAt: '2026-09-26T00:00:00Z',
            messages: [{
                id: 'm1',
                role: 'assistant',
                blocks: wasmItems.map((item: { latex: string }, idx: number) => ({
                    id: `b${idx + 1}`,
                    type: 'math',
                    source: item.latex,
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
            'real PDF bytes produced from representative corpus',
        );
    } finally {
        compiler.dispose();
    }
});

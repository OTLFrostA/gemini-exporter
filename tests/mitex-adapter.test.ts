/**
 * tests/mitex-adapter.test.ts
 *
 * Tier 1 unit tests for MiTeX LaTeX -> Typst conversion engine (Phase T).
 * Conforms to TeX Test Layers (Plan Section 12, 16, 17, 28):
 * - Layer T1: MiTeX adapter tests (initialization, conversion, error handling, diagnostics)
 * - Layer T2: Representative standard LaTeX syntax
 * - Layer T4: Real Typst WASM compilation gate
 */

export {};
const test = require('node:test');
const assert = require('node:assert');

const {
    convertMathWithMitex,
    convertMathMitex,
    initMitexWasm,
    isMitexReady,
    mitexConvertMath,
} = require('../src/core/export/typst/mitex/index.js');
const { toTypstPayload } = require('../src/core/export/typst/payload.js');
const { TypstSandboxCompiler } = require('../src/core/export/typst/typstSandboxCompiler.js');
const { RealWasmSandboxHost, repoRoot } = require('./helpers/realWasmSandbox.js');

test('T1.1: MiTeX WASM initializes and reports ready state', async () => {
    await initMitexWasm();
    assert.strictEqual(isMitexReady(), true, 'MiTeX WASM should be ready');
});

test('T1.2: Empty or whitespace input emits TYPST_MATH_EMPTY diagnostic', async () => {
    const emptyRes = convertMathWithMitex('');
    assert.strictEqual(emptyRes.typst, undefined);
    assert.ok(emptyRes.diagnostic);
    assert.strictEqual(emptyRes.diagnostic.code, 'TYPST_MATH_EMPTY');
    assert.strictEqual(emptyRes.diagnostic.severity, 'warning');

    const wsRes = convertMathWithMitex('   \n\t  ');
    assert.strictEqual(wsRes.typst, undefined);
    assert.ok(wsRes.diagnostic);
    assert.strictEqual(wsRes.diagnostic.code, 'TYPST_MATH_EMPTY');
});

test('T1.3: Unknown command fails closed with TYPST_MATH_CONVERT_FAILED and preserves raw source', async () => {
    const raw = '\\notarealcommand{x}{y}';
    const res = convertMathWithMitex(raw);
    assert.strictEqual(res.typst, undefined);
    assert.ok(res.diagnostic);
    assert.strictEqual(res.diagnostic.code, 'TYPST_MATH_CONVERT_FAILED');
    assert.strictEqual(res.diagnostic.severity, 'warning');
    assert.ok(res.diagnostic.message.includes(raw), 'Diagnostic message should contain preserved raw LaTeX');
});

test('T1.4: convertMathMitex helper respects notation and display flags', async () => {
    assert.strictEqual(convertMathMitex('x^2', 'asciimath', false), undefined, 'Non-latex notation should return undefined');
    const typst = convertMathMitex('\\frac{1}{2}', 'latex', true);
    assert.ok(typeof typst === 'string' && typst.length > 0);
});

test('T2.1: Representative standard LaTeX: Arithmetic and fractions', async () => {
    const res1 = convertMathWithMitex('a + b - c \\times d / e');
    assert.ok(res1.typst, 'Arithmetic converts cleanly');

    const res2 = convertMathWithMitex('\\frac{a + 1}{b - 1}');
    assert.ok(res2.typst?.includes('frac'), 'Fraction converts to frac()');

    const res3 = convertMathWithMitex('\\frac12');
    assert.ok(res3.typst?.includes('frac'), 'Single-token fraction converts to frac()');
});

test('T2.2: Representative standard LaTeX: Roots and scripts', async () => {
    const sqrt1 = convertMathWithMitex('\\sqrt{x + y}');
    assert.ok(sqrt1.typst?.includes('sqrt'), 'Square root converts cleanly');

    const sqrt2 = convertMathWithMitex('\\sqrt[3]{x}');
    assert.ok(sqrt2.typst, 'Cube root converts cleanly');

    const scripts = convertMathWithMitex('x_i^2 + y_{n+1}^{2k}');
    assert.ok(scripts.typst?.includes('x _') || scripts.typst?.includes('x_'), 'Sub/superscripts convert cleanly');
});

test('T2.3: Representative standard LaTeX: Greek and operators', async () => {
    const greek = convertMathWithMitex('\\alpha + \\beta \\le \\gamma \\cdot \\Omega');
    assert.ok(greek.typst?.includes('alpha'), 'Greek letters convert cleanly');
    assert.ok(greek.typst?.includes('beta'), 'Beta converts cleanly');

    const bigOp = convertMathWithMitex('\\sum_{i=1}^n i = \\prod_{k=1}^m k');
    assert.ok(bigOp.typst?.includes('sum'), 'Sum converts cleanly');
    assert.ok(bigOp.typst?.includes('prod'), 'Product converts cleanly');

    const integral = convertMathWithMitex('\\int_0^\\infty e^{-x} dx');
    assert.ok(integral.typst, 'Integral converts cleanly');
});

test('T2.4: Representative standard LaTeX: Matrices and cases', async () => {
    const matrix = convertMathWithMitex('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}');
    assert.ok(matrix.typst?.includes('pmatrix'), 'Matrix converts cleanly');

    const cases = convertMathWithMitex('\\begin{cases} 1 & x > 0 \\\\ 0 & x \\le 0 \\end{cases}');
    assert.ok(cases.typst?.includes('cases'), 'Cases converts cleanly');
});

test('T2.5: Representative standard LaTeX: Delimiters and operatorname', async () => {
    const delim = convertMathWithMitex('\\left( \\frac{a}{b} \\right)');
    assert.ok(delim.typst, 'Delimiters convert cleanly');

    const op = convertMathWithMitex('\\operatorname*{argmax}_{x} f(x)');
    assert.ok(op.typst?.includes('operatornamewithlimits') || op.typst?.includes('argmax'), 'Operatorname converts cleanly');
});

test('T4: Genuine Typst WASM compilation gate for MiTeX-converted formulas', async () => {
    const host = new RealWasmSandboxHost(repoRoot());
    const compiler = new TypstSandboxCompiler({ host });

    const equations = [
        'a + b - c \\times d',
        '\\frac{a+1}{b-1}',
        '\\sqrt{x + y}',
        '\\sqrt[3]{x}',
        'x_i^2 + y_{n+1}^{2k}',
        '\\sum_{i=1}^n i',
        '\\int_0^\\infty e^{-x} dx',
        '\\alpha + \\beta \\le \\gamma',
        '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
        '\\begin{cases} 1 & x > 0 \\\\ 0 & x \\le 0 \\end{cases}',
        '\\left( \\frac{a}{b} \\right)',
        '\\operatorname*{argmax}_{x} f(x)',
    ];

    const blocks = equations.map((latex, idx) => ({
        id: `math-${idx}`,
        type: 'math',
        notation: 'latex',
        source: latex,
        display: true,
    }));

    const bundle = {
        schemaVersion: 1,
        conversation: {
            key: { providerId: 'gemini', conversationId: 'mitex-compile-test' },
            title: { value: 'MiTeX WASM Compilation Test' },
            createdAt: '2026-09-28T00:00:00Z',
            updatedAt: '2026-09-28T00:00:00Z',
            source: { format: 'gemini-web', rawPayloadAvailable: false },
            messages: [
                {
                    id: 'm1',
                    role: 'user',
                    createdAt: '2026-09-28T00:00:00Z',
                    blocks: [{ id: 'b0', type: 'paragraph', children: [{ id: 't0', type: 'text', text: 'Math test' }] }],
                },
                {
                    id: 'm2',
                    role: 'model',
                    createdAt: '2026-09-28T00:00:00Z',
                    blocks,
                },
            ],
        },
        assets: [],
        citations: [],
    };

    const { payload } = toTypstPayload(bundle as any, {
        assetPath: () => undefined,
        convertMath: (source: string, notation: string, display: boolean) => {
            return convertMathMitex(source, notation, display);
        },
    });

    const context = {
        bundle: null,
        assets: { resolve: async () => null },
        locale: 'en',
        signal: new AbortController().signal,
        reportProgress: () => undefined,
    };

    try {
        const result = await compiler.compile(
            {
                rendererSchemaVersion: 1,
                sourceSchemaVersion: 1,
                bundle: bundle as any,
                document: payload,
                assetPaths: new Map(),
            },
            context as any,
        );

        assert.ok(result.pdfBytes, 'PDF bytes must be returned');
        assert.ok(result.pdfBytes.length > 5000, `PDF size should be substantial (got ${result.pdfBytes.length} bytes)`);

        const magic = String.fromCharCode(...result.pdfBytes.slice(0, 5));
        assert.strictEqual(magic, '%PDF-', 'PDF magic header must match %PDF-');

        const errors = (result.diagnostics ?? []).filter((d: { severity: string }) => d.severity === 'error');
        assert.strictEqual(errors.length, 0, `MiTeX formulas must compile with 0 errors (got: ${JSON.stringify(errors)})`);
    } finally {
        await compiler.dispose();
    }
});

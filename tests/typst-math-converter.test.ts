/**
 * tests/typst-math-converter.test.ts
 * Tier 1 tests for the controlled LaTeX -> Typst math converter (Phase D).
 *
 * Covers: inline/display conversion for every supported command class,
 * sub/superscript attachment, \text escaping, \left\right delimiters,
 * display-only \\ line breaks, whole-input failure (unknown commands,
 * unclosed braces) with a diagnostic path, empty input, non-latex
 * notations, and plug-compatibility with the payload adapter hook.
 */
export {};
const test = require('node:test');
const assert = require('node:assert');

const { convertMath, convertMathWithDiagnostic } = require('../src/core/export/typst/mathConverter.js');

function eq(source: string, expected: string, display = false) {
    assert.strictEqual(convertMath(source, 'latex', display), expected, `convertMath(${JSON.stringify(source)})`);
}

test('inline and display basics', async () => {
    eq('x^2 + y', 'x^2 + y');
    eq('E = mc^2', 'E = m c^2');
    eq('\\frac{1}{2}', 'frac(1, 2)', true);
    eq('\\frac{1}{2}', 'frac(1, 2)', false);
});

test('frac / sqrt / nested', async () => {
    eq('\\frac{a}{b}', 'frac(a, b)');
    eq('\\sqrt{x}', 'sqrt(x)');
    eq('\\sqrt[3]{x}', 'root(3, x)');
    eq('\\frac{\\sqrt{2}}{x_i}', 'frac(sqrt(2), x_i)');
    eq('\\frac12', 'frac(1, 2)');
});

test('sub/superscripts incl. multi-char and big operators', async () => {
    eq('x_i', 'x_i');
    eq('x^{10}', 'x^10');
    eq('x^{a+b}', 'x^(a + b)');
    eq('x_i^2', 'x_i^2');
    eq('\\sum_{i=1}^{n}', 'sum_(i = 1)^n');
    eq('\\int_0^\\infty', 'integral_0^oo');
    eq('\\prod_{k=1}^m', 'prod_(k = 1)^m');
    eq('{a+b}^2', '(a + b)^2');
});

test('greek letters', async () => {
    eq('\\alpha + \\beta', 'alpha + beta');
    eq('\\pi \\approx 3.14', 'pi approx 3.14');
    eq('\\Omega + \\Gamma', 'Omega + Gamma');
});

test('operators and relations', async () => {
    eq('a \\times b \\div c', 'a times b div c');
    eq('x \\leq y \\geq z', 'x <= y >= z');
    eq('x \\le y \\ge z', 'x <= y >= z');
    eq('a \\neq b', 'a != b');
    eq('p \\pm q \\cdot r', 'p plus.minus q dot r');
    eq('p \\mp q', 'p minus.plus q');
    eq('A \\equiv B', 'A equiv B');
    eq('A \\otimes B', 'A times.circle B');
    eq('A \\implies B', 'A ==> B');
    eq('x \\to \\infty', 'x -> oo');
    eq('f: x \\mapsto x^2', 'f : x |-> x^2');
    eq('\\uparrow \\downarrow', 'arrow.t arrow.b');
    eq('120^\\circ', '120^compose');
    eq('f \\circ g', 'f compose g');
    eq('a \\quad b \\qquad c', 'a quad b wide c');
    eq('a\\,b\\ c\\;d', 'a b c d');
});

test('functions, calculus, sets', async () => {
    eq('\\sin x + \\cos y', 'sin x + cos y');
    eq('\\frac{\\partial f}{\\partial x}', 'frac(diff f, diff x)');
    eq('x \\in A \\cup B', 'x in A union B');
    eq('\\forall x \\exists y', 'forall x exists y');
});

test('accents', async () => {
    eq('\\hat{x} + \\bar{y}', 'hat(x) + bar(y)');
    eq('\\tilde{\\alpha}', 'tilde(alpha)');
    eq('\\vec{a} + \\vec{S}_i', 'arrow(a) + arrow(S)_i');
});

test('bra-ket and standalone angle delimiters', async () => {
    eq('\\langle \\psi |', 'angle.l psi |');
    eq('| \\psi \\rangle', '| psi angle.r');
    eq('\\sum_{\\langle i, j \\rangle}', 'sum_(angle.l i , j angle.r)');
});

test('text is escaped into a Typst string literal', async () => {
    eq('\\text{hello}', '"hello"');
    eq('\\text{say "hi"}', '"say \\"hi\\""');
    eq('\\text{a\\\\b}', '"a\\\\\\\\b"'); // two literal backslashes survive, escaped
    // hostile text cannot break out of the string
    const out = convertMath('\\text{"); evil("}', 'latex', false);
    assert.strictEqual(out, '"\\"); evil(\\""');
    assert.ok(!out.includes('"); evil("'));
});

test('left/right delimiters', async () => {
    eq('\\left( \\frac{a}{b} \\right)', '( frac(a, b) )');
    eq('\\left[ x \\right]', '[ x ]');
    eq('\\left\\{ x \\right\\}', 'brace.l x brace.r');
    eq('\\left| x \\right|', '| x |');
    eq('\\left\\langle x \\right\\rangle', 'angle.l x angle.r');
    eq('\\left. x \\right|', 'x |');
});

test('line break \\\\ only in display mode', async () => {
    const out = convertMath('a \\\\ b', 'latex', true);
    assert.ok(out.includes('\\\n'), `expected Typst line break, got ${JSON.stringify(out)}`);
    assert.strictEqual(convertMath('a \\\\ b', 'latex', false), undefined);
    const diag = convertMathWithDiagnostic('a \\\\ b', 'latex', false).diagnostic;
    assert.ok(diag && diag.code === 'TYPST_MATH_CONVERT_FAILED');
});

test('multiple formulas in one source', async () => {
    eq('\\alpha^2 + \\beta^2 = \\gamma^2', 'alpha^2 + beta^2 = gamma^2');
});

test('illegal input fails whole with diagnostic', async () => {
    for (const bad of ['\\frac{1}{2', '\\foo', '\\frac{1}{\\foo}', 'x & y', 'x^']) {
        assert.strictEqual(convertMath(bad, 'latex', false), undefined, `should fail: ${bad}`);
        const r = convertMathWithDiagnostic(bad, 'latex', false);
        assert.ok(!('typst' in r) || r.typst === undefined, `no partial output for: ${bad}`);
        assert.ok(r.diagnostic, `diagnostic for: ${bad}`);
        assert.strictEqual(r.diagnostic.severity, 'warning');
        assert.strictEqual(r.diagnostic.code, 'TYPST_MATH_CONVERT_FAILED');
    }
});

test('empty input returns undefined with empty diagnostic', async () => {
    for (const src of ['', '   ', '\n\t ']) {
        assert.strictEqual(convertMath(src, 'latex', false), undefined);
        const r = convertMathWithDiagnostic(src, 'latex', false);
        assert.strictEqual(r.diagnostic?.code, 'TYPST_MATH_EMPTY');
        assert.strictEqual(r.diagnostic?.severity, 'warning');
    }
});

test('non-latex notations are unsupported with diagnostic', async () => {
    for (const notation of ['mathml', 'asciimath', 'plain', 'unknown']) {
        assert.strictEqual(convertMath('x^2', notation, false), undefined);
        const r = convertMathWithDiagnostic('x^2', notation, false);
        assert.strictEqual(r.diagnostic?.code, 'TYPST_MATH_UNSUPPORTED_NOTATION');
        assert.ok(r.diagnostic?.message.includes(notation));
    }
});

test('prototype-chain command names cannot smuggle JS builtins', async () => {
    for (const bad of ['\\toString', '\\constructor', '\\hasOwnProperty']) {
        assert.strictEqual(convertMath(bad, 'latex', false), undefined, `should fail: ${bad}`);
    }
});

test('diagnostic message carries a source preview for debugging', async () => {
    const r = convertMathWithDiagnostic('\\begin{align} a = b \\end{align}', 'latex', true);
    assert.strictEqual(r.diagnostic?.code, 'TYPST_MATH_CONVERT_FAILED');
    assert.ok(r.diagnostic?.message.includes('\\begin'));
});

test('rich symbols, styles, functions, and multiple integrals', async () => {
    eq('\\mathbf{r} + \\boldsymbol{\\phi}', 'bold(r) + bold(phi)');
    eq('\\mathcal{F}\\{\\psi\\}', 'cal(F) brace.l psi brace.r');
    eq('\\mathbb{R}^3', 'bb(R)^3');
    eq('\\Psi^\\dagger', 'Psi^dagger');
    eq('\\hbar \\omega', 'planck.reduce omega');
    eq('A \\ne B', 'A != B');
    eq('\\ln x + \\exp y + \\det M', 'ln x + exp y + det M');
    eq('\\iint f \\, dx \\, dy + \\iiint g', 'integral.double f d x d y + integral.triple g');
    eq('\\left\\{ x \\;\\middle|\\; x > 0 \\right\\}', 'brace.l x | x > 0 brace.r');
});

test('matrix and cases environments', async () => {
    eq('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', 'mat(a, b; c, d)', true);
    eq('\\begin{bmatrix} 1 & 0 \\\\ 0 & 1 \\end{bmatrix}', 'mat(delim: "[", 1, 0; 0, 1)', true);
    eq('\\begin{matrix} x & y \\\\ z & w \\end{matrix}', 'mat(delim: none, x, y; z, w)', true);
    // Each LaTeX row is one cases() argument; & aligns cells within the row.
    eq('\\begin{cases} 1 & x > 0 \\\\ 0 & x \\le 0 \\end{cases}', 'cases(1 & x > 0, 0 & x <= 0)', true);
    eq(
        '\\begin{cases} x^2 & x > 0 \\\\ 0 & x = 0 \\\\ -x & x < 0 \\end{cases}',
        'cases(x^2 & x > 0, 0 & x = 0, - x & x < 0)',
        true,
    );
    eq('\\begin{cases} a \\\\ b \\end{cases}', 'cases(a, b)', true);
});

test('operatorname and custom operators', async () => {
    eq('\\operatorname{Tr}(A)', 'op("Tr", limits: #false) ( A )');
    // Starred and unstarred must stay semantically distinct: \operatorname*
    // keeps display limits, the plain form pins limits off.
    eq('\\operatorname*{max}_{x} f(x)', 'op("max")_x f ( x )');
    eq('\\operatorname{max}_{x} f(x)', 'op("max", limits: #false)_x f ( x )');
    eq('-\\operatorname{Re}\\chi_{ij}', '- op("Re", limits: #false) chi_(i j)');
    eq('\\Tr(A)', 'op("Tr") ( A )');
    eq('\\Re(z) + \\Im(z)', 'Re ( z ) + Im ( z )');
});

test('malformed \\operatorname fails the whole conversion with a diagnostic', async () => {
    for (const bad of ['\\operatorname{Tr', '\\operatorname', '\\operatorname{}', '\\operatorname*{max']) {
        assert.strictEqual(convertMath(bad, 'latex', false), undefined, `should fail: ${bad}`);
        const r = convertMathWithDiagnostic(bad, 'latex', false);
        assert.ok(!('typst' in r) || r.typst === undefined, `no partial output for: ${bad}`);
        assert.strictEqual(r.diagnostic?.code, 'TYPST_MATH_CONVERT_FAILED', `diagnostic for: ${bad}`);
    }
});

test('plugs into the payload adapter convertMath hook', async () => {
    const { toTypstPayload } = require('../src/core/export/typst/payload.js');
    const bundle = {
        schemaVersion: 1,
        conversation: {
            key: { providerId: 'gemini', accountId: 't', conversationId: 'c1' },
            title: { value: 'T', source: 'derived', candidates: [] },
            createdAt: '2026-09-20T10:00:00Z',
            messages: [{
                id: 'm1', role: 'assistant',
                blocks: [
                    { type: 'math', source: '\\frac{1}{2}', notation: 'latex' },
                    {
                        type: 'paragraph',
                        children: [{ type: 'inlineMath', source: 'x_i^2', notation: 'latex' }],
                    },
                    { type: 'math', source: '\\foo', notation: 'latex' },
                ],
            }],
        },
        assets: [], citations: [],
    };
    const { payload, diagnostics } = toTypstPayload(bundle, {
        assetPath: () => undefined,
        convertMath,
    });
    const [blockMath, para, badMath] = payload.messages[0].blocks;
    assert.strictEqual(blockMath.typst, 'frac(1, 2)');
    assert.strictEqual(blockMath.latex, '\\frac{1}{2}');
    assert.strictEqual(para.children[0].typst, 'x_i^2');
    // failed conversion degrades to latex-only, no crash, no partial typst
    assert.ok(!('typst' in badMath));
    assert.strictEqual(badMath.latex, '\\foo');
    assert.ok(Array.isArray(diagnostics));
});

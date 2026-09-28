/**
 * tests/compat_rules.test.ts
 *
 * Tier 1 unit test for Parser Compatibility Rule Registry.
 * Asserts:
 * 1. Initial state is empty (Section 2.4 / Section 31).
 * 2. Immutable/frozen rule registries.
 * 3. Identity transformation when registry is empty (input === output).
 * 4. Preserves arbitrary text, Markdown, LaTeX, and Unicode exactly.
 */
export {};
const test = require('node:test');
const assert = require('node:assert');

const {
    GEMINI_MARKDOWN_COMPAT_RULES,
    GEMINI_TEX_COMPAT_RULES,
    preprocessGeminiMarkdown,
    preprocessGeminiLatex,
} = require('../src/core/export/canonical/compat/rules.js');

test('Compatibility Rules: Initial state is strictly empty', () => {
    assert.strictEqual(Array.isArray(GEMINI_MARKDOWN_COMPAT_RULES), true);
    assert.strictEqual(GEMINI_MARKDOWN_COMPAT_RULES.length, 0, 'Markdown compat rules must initially be empty');
    assert.strictEqual(Object.isFrozen(GEMINI_MARKDOWN_COMPAT_RULES), true, 'Markdown compat rules array must be frozen');

    assert.strictEqual(Array.isArray(GEMINI_TEX_COMPAT_RULES), true);
    assert.strictEqual(GEMINI_TEX_COMPAT_RULES.length, 0, 'TeX compat rules must initially be empty');
    assert.strictEqual(Object.isFrozen(GEMINI_TEX_COMPAT_RULES), true, 'TeX compat rules array must be frozen');
});

test('Compatibility Rules: preprocessGeminiMarkdown is strict identity no-op', () => {
    const testCases = [
        '',
        'Hello World',
        '# Heading 1\n\n**bold** *italic* `code`',
        '| A | B |\n|---|---|\n| x | `a|b` |',
        '$$E = mc^2$$',
        'Multi-line\n\n\n\nwith trailing space   \n',
        'CJK 中文测试，带公式 $x^2 + y^2 = z^2$ 和表情 😊🚀',
    ];
    for (const input of testCases) {
        assert.strictEqual(preprocessGeminiMarkdown(input), input, 'preprocessGeminiMarkdown must be identity function');
    }
});

test('Compatibility Rules: preprocessGeminiLatex is strict identity no-op', () => {
    const testCases = [
        '',
        '\\frac{a}{b}',
        '\\sum_{i=1}^n x_i',
        '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
        '\\arg\\left(\\gamma\'(z_c)\\right) \\pmod\\pi',
        '\\Box \\psi = \\nabla^2 \\psi',
    ];
    for (const input of testCases) {
        assert.strictEqual(preprocessGeminiLatex(input), input, 'preprocessGeminiLatex must be identity function');
    }
});

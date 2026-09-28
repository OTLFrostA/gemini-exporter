/**
 * tests/diff_runner.test.ts
 *
 * Tier 1 unit test for Parser Differential Runner (Section 8.4 & 22).
 * Verifies:
 * 1. Semantic AST fingerprint extraction.
 * 2. Markdown comparison & four-tier diff categorization (A/B/C/D).
 * 3. Math conversion comparison & four-tier diff categorization.
 */
export {};
const test = require('node:test');
const assert = require('node:assert');

const {
    extractAstFingerprint,
    compareMarkdownAst,
    compareMathConversion,
} = require('../scripts/parser_migration/diff_runner.ts');

test('Differential Runner: extracts semantic AST fingerprint', () => {
    const fakeBundle = {
        conversation: {
            messages: [
                {
                    blocks: [
                        { type: 'paragraph', children: [{ type: 'text', text: 'Hello' }] },
                        { type: 'heading', level: 1, text: 'Title' },
                        { type: 'code', code: 'console.log(1)' },
                    ],
                },
            ],
        },
    };

    const fp = extractAstFingerprint(fakeBundle);
    assert.strictEqual(fp.blockCount, 3);
    assert.deepStrictEqual(fp.blockTypes, ['paragraph', 'heading', 'code']);
    assert.strictEqual(fp.totalTextLength, 24);
});

test('Differential Runner: Markdown AST comparison identifies identical structures', () => {
    const bundle = {
        conversation: {
            messages: [{ blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'Sample' }] }] }],
        },
    };

    const result = compareMarkdownAst('Sample', bundle, bundle);
    assert.strictEqual(result.hasDiff, false);
    assert.strictEqual(result.domain, 'markdown');
});

test('Differential Runner: Markdown AST categorization adheres to Section 8.4', () => {
    const bundleBase = {
        conversation: {
            messages: [{ blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'Sample' }] }] }],
        },
    };
    const bundleWithUnknown = {
        conversation: {
            messages: [{ blocks: [{ type: 'unknown', text: 'Sample' }] }],
        },
    };

    // Category B: Candidate introduced unknown fallback where baseline parsed cleanly
    const diffB = compareMarkdownAst('Sample', bundleBase, bundleWithUnknown);
    assert.strictEqual(diffB.hasDiff, true);
    assert.strictEqual(diffB.category, 'B_OLD_PARSER_GEMINI_DIALECT');

    // Category A: Candidate parsed cleanly where baseline introduced fallback
    const diffA = compareMarkdownAst('Sample', bundleWithUnknown, bundleBase);
    assert.strictEqual(diffA.hasDiff, true);
    assert.strictEqual(diffA.category, 'A_NEW_PARSER_CORRECT');
});

test('Differential Runner: Math comparison identifies improvements vs regressions', () => {
    // Both identical
    const same = compareMathConversion('x^2', { typst: 'x^2' }, { typst: 'x^2' });
    assert.strictEqual(same.hasDiff, false);

    // Improvement (Candidate converts where baseline failed) -> Category A
    const improve = compareMathConversion(
        '\\arg(z)',
        { diagnostic: { code: 'FAILED' } },
        { typst: 'op("arg", limits: #false)(z)' }
    );
    assert.strictEqual(improve.hasDiff, true);
    assert.strictEqual(improve.category, 'A_NEW_PARSER_CORRECT');

    // Regression (Candidate failed where baseline succeeded) -> Category B
    const regress = compareMathConversion(
        '\\frac{1}{2}',
        { typst: 'frac(1, 2)' },
        { diagnostic: { code: 'FAILED' } }
    );
    assert.strictEqual(regress.hasDiff, true);
    assert.strictEqual(regress.category, 'B_OLD_PARSER_GEMINI_DIALECT');
});

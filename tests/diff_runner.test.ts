/**
 * tests/diff_runner.test.ts
 *
 * Tier 1 unit test for Parser Differential Runner (Section 8.4, 22 & Remediation 1.1).
 * Verifies:
 * 1. Semantic AST fingerprint extraction.
 * 2. Unresolved diffs default to 'D_CANNOT_DETERMINE' (Old parser is NOT an oracle).
 * 3. Never auto-classifies differences as 'B_OLD_PARSER_GEMINI_DIALECT'.
 * 4. Math conversion comparison correctly identifies candidate improvements (Category A)
 *    and defaults unknown regressions to 'D_CANNOT_DETERMINE'.
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

test('Differential Runner: Structural diffs default to D_CANNOT_DETERMINE (No automatic B bias)', () => {
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

    // Any diff MUST default to D_CANNOT_DETERMINE: Old parser is NOT an oracle
    const diff = compareMarkdownAst('Sample', bundleBase, bundleWithUnknown);
    assert.strictEqual(diff.hasDiff, true);
    assert.strictEqual(diff.category, 'D_CANNOT_DETERMINE');
    assert.ok(diff.rationale?.includes('Old parser is not an oracle'));

    // Explicit override permitted only with verified rationale
    const overridden = compareMarkdownAst('Sample', bundleBase, bundleWithUnknown, {
        category: 'B_OLD_PARSER_GEMINI_DIALECT',
        rationale: 'Verified against raw Takeout evidence fixture tests/fixtures/real-gemini/demo.json',
    });
    assert.strictEqual(overridden.category, 'B_OLD_PARSER_GEMINI_DIALECT');
});

test('Differential Runner: Math comparison identifies improvements vs unverified diffs', () => {
    // Both identical
    const same = compareMathConversion('x^2', { typst: 'x^2' }, { typst: 'x^2' });
    assert.strictEqual(same.hasDiff, false);

    // Candidate converts where baseline failed -> Category A (improvement)
    const improve = compareMathConversion(
        '\\arg(z)',
        { diagnostic: { code: 'FAILED' } },
        { typst: 'op("arg", limits: #false)(z)' }
    );
    assert.strictEqual(improve.hasDiff, true);
    assert.strictEqual(improve.category, 'A_NEW_PARSER_CORRECT');

    // Candidate failed where baseline succeeded -> Defaults to D_CANNOT_DETERMINE (investigation required, not assumed B)
    const diverge = compareMathConversion(
        '\\frac{1}{2}',
        { typst: 'frac(1, 2)' },
        { diagnostic: { code: 'FAILED' } }
    );
    assert.strictEqual(diverge.hasDiff, true);
    assert.strictEqual(diverge.category, 'D_CANNOT_DETERMINE');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { convertHtmlToMarkdown } from '../src/l1/parsers/shared/html/htmlToMarkdown.js';
import { parseMarkdownToBlocks } from '../src/l1/parsers/shared/markdown/parseMarkdown.js';
import type { BlockNode } from '../src/l2/content/blocks.js';

const SEED = 20261124;

function assertValidBlocks(blocks: readonly BlockNode[]): void {
    assert.ok(Array.isArray(blocks));
    for (let i = 0; i < blocks.length; i++) {
        assert.ok(i in blocks, 'BlockNode array must not contain holes');
        assert.ok(blocks[i] && typeof blocks[i].type === 'string', 'Every block must have a string type');
    }
}

const delimiterFragmentArb = fc.oneof(
    fc.constantFrom(
        '`', '``', '```', '````', '~~~',
        '$', '$$', '\\$', '\\(', '\\)', '\\[', '\\]',
        '__TABLE_BR__', '\uFFFD', '\uE200', '\uE201',
        '<table>', '</table>', '<tr>', '</tr>', '<td>', '</td>', '<th>', '</th>',
        '<td colspan="2" rowspan="2">', '<th colspan="0" rowspan="9999">',
        '<code>', '</code>', '<pre><code class="language-ts">', '</code></pre>',
        '<!-- comment -->', '<br>', '<p>', '</p>', '|', '\n', '\n\n', '\\', '*', '_',
    ),
    fc.string({ minLength: 0, maxLength: 24 }),
);

test('fuzz: HTML-to-Markdown and Markdown parser handle arbitrary delimiter/sentinel soup without throwing or ReDoS', () => {
    fc.assert(
        fc.property(
            fc.array(delimiterFragmentArb, { minLength: 1, maxLength: 35 }).map(parts => parts.join('')),
            (raw) => {
                const start = performance.now();
                const md = convertHtmlToMarkdown(raw);
                assert.equal(typeof md, 'string');
                const diagnostics: import('../src/shared/diagnostics/diagnostic.js').Diagnostic[] = [];
                const blocks = parseMarkdownToBlocks(md, 'fuzz-msg', {
                    diagnostics,
                    sourceRef: { providerId: 'gemini', locator: 'fuzz' },
                });
                const elapsed = performance.now() - start;
                assertValidBlocks(blocks);
                assert.ok(elapsed < 500, `Unexpected parser slowdown (${elapsed.toFixed(1)}ms) for input length ${raw.length}`);
            },
        ),
        { seed: SEED, numRuns: 150 },
    );
});

test('fuzz: fenced code blocks conserve arbitrary literal payloads including math, HTML, pipes, and sentinels', () => {
    const codeLineArb = fc.oneof(
        fc.constantFrom(
            'const x = "$a + b$";',
            '<table><tr><td>__TABLE_BR__</td></tr></table>',
            'sentinel \uFFFD \uE200 | col1 | col2 |',
            'inline `tick` and ``double``',
            '$$\\frac{1}{2}$$',
            '<script>alert(1)</script>',
        ),
        fc.string({ minLength: 1, maxLength: 40 }).map(s => s.replace(/[\r\n`]/g, 'x')),
    );

    fc.assert(
        fc.property(
            fc.array(codeLineArb, { minLength: 1, maxLength: 8 }),
            (lines) => {
                const payload = lines.join('\n');
                const maxBackticks = Math.max(2, ...[...payload.matchAll(/`+/g)].map(m => m[0].length));
                const fence = '`'.repeat(maxBackticks + 1);
                const markdown = `${fence}ts\n${payload}\n${fence}\n`;
                const diagnostics: import('../src/shared/diagnostics/diagnostic.js').Diagnostic[] = [];
                const blocks = parseMarkdownToBlocks(markdown, 'fuzz-code', {
                    diagnostics,
                    sourceRef: { providerId: 'gemini', locator: 'fuzz-code' },
                });
                const codeBlock = blocks.find(b => b.type === 'code');
                assert.ok(codeBlock && codeBlock.type === 'code', 'Expected fenced code block');
                assert.equal(codeBlock.code, payload);
            },
        ),
        { seed: SEED + 1, numRuns: 100 },
    );
});

test('fuzz: HTML tables with adversarial colspan/rowspan attributes convert and parse safely', () => {
    const spanAttrArb = fc.oneof(
        fc.constant(''),
        fc.integer({ min: -5, max: 12 }).map(n => ` colspan="${n}"`),
        fc.integer({ min: -5, max: 12 }).map(n => ` rowspan="${n}"`),
        fc.constant(' colspan="99999" rowspan="abc"'),
    );
    const cellArb = fc.tuple(
        fc.constantFrom('td', 'th'),
        spanAttrArb,
        fc.string({ minLength: 0, maxLength: 20 }).map(s => s.replace(/[<>]/g, '')),
    ).map(([tag, attr, body]) => `<${tag}${attr}>${body}</${tag}>`);
    const rowArb = fc.array(cellArb, { minLength: 1, maxLength: 5 }).map(cells => `<tr>${cells.join('')}</tr>`);
    const tableArb = fc.array(rowArb, { minLength: 1, maxLength: 5 }).map(rows => `<table>${rows.join('')}</table>`);

    fc.assert(
        fc.property(tableArb, (html) => {
            const md = convertHtmlToMarkdown(html);
            const diagnostics: import('../src/shared/diagnostics/diagnostic.js').Diagnostic[] = [];
            const blocks = parseMarkdownToBlocks(md, 'fuzz-table', {
                diagnostics,
                sourceRef: { providerId: 'gemini', locator: 'fuzz-table' },
            });
            assertValidBlocks(blocks);
        }),
        { seed: SEED + 2, numRuns: 100 },
    );
});

/**
 * tests/markdown_adapter.test.ts
 *
 * Layer M1 (MDAST -> Canonical AST Adapter Unit Tests) &
 * Layer M2 (Integration Smoke Tests for micromark / mdast-util-from-markdown pipeline)
 *
 * Conforms to Section 8 of the Parser Migration & Validation Plan.
 */

export {};
const test = require('node:test');
const assert = require('node:assert');

const {
    parseMarkdownToBlocks,
    parseMarkdownToInlines,
    mdastRootToBlocks,
    adaptInlines,
    mergeAdjacentTextNodes,
} = require('../src/core/export/canonical/markdown/index.js');
const { newAssetLinkIndex, indexAssetRef } = require('../src/core/export/canonical/gemini/normalizeAssets.js');

function createTestContext(overrides: any = {}) {
    let blockSeq = 0;
    const diagnostics: any[] = [];
    const inlineAssets: any[] = [];
    const assetIndex = newAssetLinkIndex();
    const ctx = {
        idPrefix: 'test-msg',
        nextBlockId: () => `test-msg-b${blockSeq++}`,
        diagnostics,
        inlineAssets,
        assetIndex,
        sourceRef: { providerId: 'test-provider', locator: 'test.0' },
        ...overrides,
    };
    return { ctx, diagnostics, inlineAssets, assetIndex };
}

// =========================================================================
// Layer M1: Adapter Unit Tests (Direct MDAST -> Canonical Mapping)
// =========================================================================

test('Layer M1: Text node coalescing merges adjacent text nodes', () => {
    const raw = [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'World' },
    ];
    const merged = mergeAdjacentTextNodes(raw as any);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual((merged[0] as any).text, 'Hello World');
});

test('Layer M1: Nested inlines coalesce adjacent text nodes inside parents', () => {
    const raw = [
        {
            type: 'strong',
            children: [
                { type: 'text', text: 'Part 1 ' },
                { type: 'text', text: 'Part 2' },
            ],
        },
    ];
    const merged = mergeAdjacentTextNodes(raw as any);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual((merged[0] as any).children.length, 1);
    assert.strictEqual((merged[0] as any).children[0].text, 'Part 1 Part 2');
});

test('Layer M1: adaptInlines maps text with newlines to text and soft lineBreak', () => {
    const { ctx } = createTestContext();
    const mdastNodes: any[] = [
        { type: 'text', value: 'Line 1\nLine 2\nLine 3' },
    ];
    const inlines = adaptInlines(mdastNodes, ctx);
    assert.strictEqual(inlines.length, 5);
    assert.strictEqual(inlines[0].type, 'text');
    assert.strictEqual((inlines[0] as any).text, 'Line 1');
    assert.strictEqual(inlines[1].type, 'lineBreak');
    assert.strictEqual((inlines[1] as any).kind, 'soft');
    assert.strictEqual(inlines[2].type, 'text');
    assert.strictEqual((inlines[2] as any).text, 'Line 2');
    assert.strictEqual(inlines[3].type, 'lineBreak');
    assert.strictEqual((inlines[3] as any).kind, 'soft');
    assert.strictEqual(inlines[4].type, 'text');
    assert.strictEqual((inlines[4] as any).text, 'Line 3');
});

test('Layer M1: adaptInlines maps break and <br> to hard lineBreak', () => {
    const { ctx } = createTestContext();
    const mdastNodes: any[] = [
        { type: 'text', value: 'Before' },
        { type: 'break' },
        { type: 'html', value: '<br />' },
        { type: 'text', value: 'After' },
    ];
    const inlines = adaptInlines(mdastNodes, ctx);
    assert.strictEqual(inlines.length, 4);
    assert.strictEqual((inlines[1] as any).kind, 'hard');
    assert.strictEqual((inlines[2] as any).kind, 'hard');
});

test('Layer M1: adaptInlines maps delete to strikethrough', () => {
    const { ctx } = createTestContext();
    const mdastNodes: any[] = [
        {
            type: 'delete',
            children: [{ type: 'text', value: 'struck' }],
        },
    ];
    const inlines = adaptInlines(mdastNodes, ctx);
    assert.strictEqual(inlines.length, 1);
    assert.strictEqual(inlines[0].type, 'strikethrough');
    assert.strictEqual((inlines[0] as any).children[0].text, 'struck');
});

test('Layer M1: mdastRootToBlocks maps heading levels 1 through 6', () => {
    const { ctx } = createTestContext();
    const mdastRoot: any = {
        type: 'root',
        children: [
            { type: 'heading', depth: 1, children: [{ type: 'text', value: 'H1' }] },
            { type: 'heading', depth: 3, children: [{ type: 'text', value: 'H3' }] },
            { type: 'heading', depth: 6, children: [{ type: 'text', value: 'H6' }] },
        ],
    };
    const blocks = mdastRootToBlocks(mdastRoot, ctx, '');
    assert.strictEqual(blocks.length, 3);
    assert.strictEqual(blocks[0].type, 'heading');
    assert.strictEqual((blocks[0] as any).level, 1);
    assert.strictEqual((blocks[1] as any).level, 3);
    assert.strictEqual((blocks[2] as any).level, 6);
});

test('Layer M1: mdastRootToBlocks maps code block language and meta', () => {
    const { ctx } = createTestContext();
    const mdastRoot: any = {
        type: 'root',
        children: [
            {
                type: 'code',
                lang: 'typescript',
                meta: 'filename=main.ts',
                value: 'const x = 1;',
            },
        ],
    };
    const blocks = mdastRootToBlocks(mdastRoot, ctx, '');
    assert.strictEqual(blocks.length, 1);
    const code = blocks[0] as any;
    assert.strictEqual(code.type, 'code');
    assert.strictEqual(code.language, 'typescript');
    assert.strictEqual(code.meta, 'filename=main.ts');
    assert.strictEqual(code.code, 'const x = 1;');
});

test('Layer M1: mdastRootToBlocks maps table alignments and cell structures', () => {
    const { ctx } = createTestContext();
    const mdastRoot: any = {
        type: 'root',
        children: [
            {
                type: 'table',
                align: ['left', 'center', 'right', null],
                children: [
                    {
                        type: 'tableRow',
                        children: [
                            { type: 'tableCell', children: [{ type: 'text', value: 'H1' }] },
                            { type: 'tableCell', children: [{ type: 'text', value: 'H2' }] },
                            { type: 'tableCell', children: [{ type: 'text', value: 'H3' }] },
                            { type: 'tableCell', children: [{ type: 'text', value: 'H4' }] },
                        ],
                    },
                    {
                        type: 'tableRow',
                        children: [
                            { type: 'tableCell', children: [{ type: 'text', value: 'D1' }] },
                            { type: 'tableCell', children: [{ type: 'text', value: 'D2' }] },
                            { type: 'tableCell', children: [{ type: 'text', value: 'D3' }] },
                            { type: 'tableCell', children: [{ type: 'text', value: 'D4' }] },
                        ],
                    },
                ],
            },
        ],
    };
    const blocks = mdastRootToBlocks(mdastRoot, ctx, '');
    assert.strictEqual(blocks.length, 1);
    const table = blocks[0] as any;
    assert.strictEqual(table.type, 'table');
    assert.deepStrictEqual(table.columns.map((c: any) => c.align), ['left', 'center', 'right', 'default']);
    assert.strictEqual(table.headerRows.length, 1);
    assert.strictEqual(table.rows.length, 1);
    assert.strictEqual(table.headerRows[0].cells[0].children[0].text, 'H1');
    assert.strictEqual(table.rows[0].cells[2].children[0].text, 'D3');
});

test('Layer M1: Task list checkbox prepends marker to item text', () => {
    const { ctx } = createTestContext();
    const mdastRoot: any = {
        type: 'root',
        children: [
            {
                type: 'list',
                ordered: false,
                children: [
                    {
                        type: 'listItem',
                        checked: false,
                        children: [
                            { type: 'paragraph', children: [{ type: 'text', value: 'Todo task' }] },
                        ],
                    },
                    {
                        type: 'listItem',
                        checked: true,
                        children: [
                            { type: 'paragraph', children: [{ type: 'text', value: 'Done task' }] },
                        ],
                    },
                ],
            },
        ],
    };
    const blocks = mdastRootToBlocks(mdastRoot, ctx, '');
    const list = blocks[0] as any;
    assert.strictEqual(list.items.length, 2);
    assert.strictEqual(list.items[0].blocks[0].children[0].text, '[ ] Todo task');
    assert.strictEqual(list.items[1].blocks[0].children[0].text, '[x] Done task');
});

// =========================================================================
// Layer M2: Integration Smoke Tests (micromark -> mdast -> Canonical AST)
// =========================================================================

test('Layer M2: Smoke test - Headings, paragraphs, and standard inlines', () => {
    const { ctx } = createTestContext();
    const doc = [
        '# Document Title',
        '',
        'Here is a paragraph with **bold**, *italic*, and `code`.',
        '',
        'Visit [OpenAI](https://openai.com "AI Company") for more info.',
    ].join('\n');

    const blocks = parseMarkdownToBlocks(doc, 'smoke', ctx);
    assert.strictEqual(blocks.length, 3);
    assert.strictEqual(blocks[0].type, 'heading');
    assert.strictEqual((blocks[0] as any).level, 1);
    assert.strictEqual((blocks[0] as any).children[0].text, 'Document Title');

    assert.strictEqual(blocks[1].type, 'paragraph');
    const p1Inlines = (blocks[1] as any).children;
    assert.strictEqual(p1Inlines.find((c: any) => c.type === 'strong').children[0].text, 'bold');
    assert.strictEqual(p1Inlines.find((c: any) => c.type === 'emphasis').children[0].text, 'italic');
    assert.strictEqual(p1Inlines.find((c: any) => c.type === 'inlineCode').code, 'code');

    assert.strictEqual(blocks[2].type, 'paragraph');
    const link = (blocks[2] as any).children.find((c: any) => c.type === 'link');
    assert.ok(link, 'link found');
    assert.strictEqual(link.href, 'https://openai.com');
    assert.strictEqual(link.title, 'AI Company');
    assert.strictEqual(link.children[0].text, 'OpenAI');
});

test('Layer M2: Smoke test - Fenced code blocks with language and info', () => {
    const { ctx } = createTestContext();
    const doc = '```python title=script.py\nprint("hello world")\n```';
    const blocks = parseMarkdownToBlocks(doc, 'smoke', ctx);
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].type, 'code');
    const code = blocks[0] as any;
    assert.strictEqual(code.language, 'python');
    assert.strictEqual(code.meta, 'title=script.py');
    assert.strictEqual(code.code, 'print("hello world")');
});

test('Layer M2: Smoke test - Blockquotes and thematic breaks', () => {
    const { ctx } = createTestContext();
    const doc = '> Quote line 1\n> Quote line 2\n\n---';
    const blocks = parseMarkdownToBlocks(doc, 'smoke', ctx);
    assert.strictEqual(blocks.length, 2);
    assert.strictEqual(blocks[0].type, 'quote');
    assert.strictEqual(blocks[1].type, 'thematicBreak');
    const q = blocks[0] as any;
    assert.strictEqual(q.blocks.length, 1);
    assert.strictEqual(q.blocks[0].type, 'paragraph');
});

test('Layer M2: Smoke test - Ordered and nested lists', () => {
    const { ctx } = createTestContext();
    const doc = [
        '1. First item',
        '2. Second item',
        '   - Nested bullet A',
        '   - Nested bullet B',
        '3. Third item',
    ].join('\n');
    const blocks = parseMarkdownToBlocks(doc, 'smoke', ctx);
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].type, 'list');
    const list = blocks[0] as any;
    assert.strictEqual(list.ordered, true);
    assert.strictEqual(list.items.length, 3);
    assert.strictEqual(list.items[1].blocks.length, 2);
    assert.strictEqual(list.items[1].blocks[1].type, 'list');
    assert.strictEqual(list.items[1].blocks[1].ordered, false);
});

test('Layer M2: Smoke test - GFM table parsing with column alignments', () => {
    const { ctx } = createTestContext();
    const doc = [
        '| Metric | Value | Status |',
        '| :--- | :---: | ---: |',
        '| Latency | 24ms | OK |',
        '| Error | 0% | Nominal |',
    ].join('\n');
    const blocks = parseMarkdownToBlocks(doc, 'smoke', ctx);
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].type, 'table');
    const table = blocks[0] as any;
    assert.deepStrictEqual(table.columns.map((c: any) => c.align), ['left', 'center', 'right']);
    assert.strictEqual(table.headerRows.length, 1);
    assert.strictEqual(table.rows.length, 2);
    assert.strictEqual(table.headerRows[0].cells[0].children[0].text, 'Metric');
    assert.strictEqual(table.rows[0].cells[1].children[0].text, '24ms');
});

test('Layer M2: Smoke test - Inline and display math formulas', () => {
    const { ctx } = createTestContext();
    const doc = [
        'The formula is $E = mc^2$ in relativity.',
        '',
        '$$',
        '\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}',
        '$$',
    ].join('\n');
    const blocks = parseMarkdownToBlocks(doc, 'smoke', ctx);
    assert.strictEqual(blocks.length, 2);
    assert.strictEqual(blocks[0].type, 'paragraph');
    const inlineMath = (blocks[0] as any).children.find((c: any) => c.type === 'inlineMath');
    assert.ok(inlineMath, 'inlineMath found');
    assert.strictEqual(inlineMath.source, 'E = mc^2');

    assert.strictEqual(blocks[1].type, 'math');
    const mathBlock = blocks[1] as any;
    assert.strictEqual(mathBlock.source, '\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}');
    assert.strictEqual(mathBlock.notation, 'latex');
});

test('Layer M2: Smoke test - Standalone single-line $$...$$ is recognized as MathBlock', () => {
    const { ctx } = createTestContext();
    const doc = '$$\\frac{a}{b}$$';
    const blocks = parseMarkdownToBlocks(doc, 'smoke', ctx);
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].type, 'math');
    assert.strictEqual((blocks[0] as any).source, '\\frac{a}{b}');
});

test('Layer M2: Smoke test - Asset index link matching for inline images', () => {
    const { ctx, assetIndex } = createTestContext();
    indexAssetRef(assetIndex, 'https://example.com/photo.png', 'asset-img-001');

    const doc = 'Here is an image: ![A mountain](https://example.com/photo.png "Mountain peak")';
    const blocks = parseMarkdownToBlocks(doc, 'smoke', ctx);
    assert.strictEqual(blocks.length, 1);
    const img = (blocks[0] as any).children.find((c: any) => c.type === 'image');
    assert.ok(img, 'image found');
    assert.strictEqual(img.assetId, 'asset-img-001');
    assert.strictEqual(img.alt, 'A mountain');
    assert.strictEqual(img.title, 'Mountain peak');
});

test('Layer M2: Smoke test - parseMarkdownToInlines returns inline list', () => {
    const { ctx } = createTestContext();
    const text = 'Simple **bold** and *italic* text';
    const inlines = parseMarkdownToInlines(text, 'smoke', ctx);
    assert.strictEqual(inlines.length, 5);
    assert.strictEqual(inlines[0].text, 'Simple ');
    assert.strictEqual(inlines[1].type, 'strong');
    assert.strictEqual(inlines[2].text, ' and ');
    assert.strictEqual(inlines[3].type, 'emphasis');
    assert.strictEqual(inlines[4].text, ' text');
});

import { describe as __suiteDescribe } from 'node:test';
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseGeminiBody } from "../src/l1/parsers/gemini/shared/contentAdapter.js";
import { normalizeEscapedDollarMath } from "../src/l1/parsers/gemini/shared/markdownCompatibility.js";
import { parseMarkdownAst } from "../src/l1/parsers/shared/markdown/parseMarkdown.js";
import { inlineMathMarkdown } from "../src/shared/utils/markdownMath.js";
import { test as test__s2 } from "node:test";
import { convertHtmlToMarkdown } from "../src/l1/parsers/shared/html/htmlToMarkdown.js";
import { test as test__s3 } from "node:test";
import { fixtureKey } from "./helpers/domainFixture.js";
import { fixtureAccountFor } from "./helpers/domainFixture.js";
import { validateParserDomain } from "../src/l2/runtimeValidation.js";
import { test as test__s4 } from "node:test";
import { extractMarkdownResourceReferences } from "../scripts/extract_markdown_resource_refs.js";
import { renderDocumentMarkdown } from "../src/l4/format/markdown/renderMarkdown.js";
import { composeDomainDocument } from "../src/l3b/compose/composeDomainDocument.js";
import { type DomainConversationWithDetail } from "../src/l2/conversation.js";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transformMarkdownOutsideCode } from "../src/l1/parsers/shared/markdown/texBrackets.js";
import { normalizeTexBracketsInProse } from "../src/l1/parsers/shared/markdown/texBrackets.js";
import { sourceDetail } from "./helpers/l1SourceFixture.js";
import { sourceMessage } from "./helpers/l1SourceFixture.js";
import { normalizeTableMathPipes } from "../src/l1/parsers/gemini/shared/markdownCompatibility.js";
import { preprocessGeminiMarkdown } from "../src/l1/parsers/gemini/shared/markdownCompatibility.js";
import { parseMarkdownToBlocks } from "../src/l1/parsers/shared/markdown/parseMarkdown.js";
import { decodeGeminiStructuredNode } from "../src/l1/parsers/gemini/rpc/structuredContent.js";
import { geminiStructuredToContent } from "../src/l1/parsers/gemini/shared/structuredContentAdapter.js";
import { type BlockNode } from "../src/l2/content/blocks.js";

__suiteDescribe("markdown_adapter", () => {
/**
 * tests/markdown_adapter.test.ts
 *
 * Layer M1 (MDAST -> Content AST Adapter Unit Tests) &
 * Layer M2 (Integration Smoke Tests for micromark / mdast-util-from-markdown pipeline)
 *
 * Conforms to Section 8 of the Parser Migration & Validation Plan.
 */


const test = require('node:test');
const assert = require('node:assert');

const {
    parseMarkdownToBlocks: parseGenericMarkdownToBlocks,
    mdastRootToBlocks,
    adaptInlines,
    mergeAdjacentTextNodes,
} = require('../src/l1/parsers/shared/markdown/index.js');

const { preprocessGeminiMarkdown } = require('../src/l1/parsers/gemini/shared/markdownCompatibility.js');
// This corpus includes captured Gemini compatibility evidence; preprocess at its input boundary.
function parseMarkdownToBlocks(text: string, prefix: string, ctx: any) {
    return parseGenericMarkdownToBlocks(preprocessGeminiMarkdown(text), prefix, ctx);
}

function createTestContext(overrides: any = {}) {
    const diagnostics: any[] = [];
    const inlineAssets: any[] = [];
    const assetIndex = new Map<string, string>();
    const ctx = {
        idPrefix: 'test-msg',
        diagnostics,
        inlineAssets,
        assetIndex,
        sourceRef: { providerId: 'test-provider', locator: 'test.0' },
        ...overrides,
    };
    Object.assign(ctx, { resolveImage: (ref: string, alt: string, title?: string) => {
        let assetId = assetIndex.get(ref);
        if (!assetId) { assetId = `inline-${inlineAssets.length}`; assetIndex.set(ref, assetId); inlineAssets.push({ id: assetId, uri: ref }); }
        return { type: 'image', assetId, alt, ...(title ? { title } : {}) };
    } });
    return { ctx, diagnostics, inlineAssets, assetIndex };
}

// =========================================================================
// Layer M1: Adapter Unit Tests (Direct MDAST -> Content Mapping)
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
    assert.deepStrictEqual(table.columns.map((c: any) => c.align), ['left', 'center', 'right', undefined]);
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
// Layer M2: Integration Smoke Tests (micromark -> mdast -> Content AST)
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
    assetIndex.set('https://example.com/photo.png', 'asset-img-001');

    const doc = 'Here is an image: ![A mountain](https://example.com/photo.png "Mountain peak")';
    const blocks = parseMarkdownToBlocks(doc, 'smoke', ctx);
    assert.strictEqual(blocks.length, 1);
    const img = (blocks[0] as any).children.find((c: any) => c.type === 'image');
    assert.ok(img, 'image found');
    assert.strictEqual(img.assetId, 'asset-img-001');
    assert.strictEqual(img.alt, 'A mountain');
    assert.strictEqual(img.title, 'Mountain peak');
});

test('Layer M2: parsed Markdown paragraph retains inline nodes', () => {
    const { ctx } = createTestContext();
    const text = 'Simple **bold** and *italic* text';
    const [paragraph] = parseMarkdownToBlocks(text, 'smoke', ctx);
    assert.strictEqual(paragraph.type, 'paragraph');
    const inlines = paragraph.children;
    assert.strictEqual(inlines.length, 5);
    assert.strictEqual(inlines[0].text, 'Simple ');
    assert.strictEqual(inlines[1].type, 'strong');
    assert.strictEqual(inlines[2].text, ' and ');
    assert.strictEqual(inlines[3].type, 'emphasis');
    assert.strictEqual(inlines[4].text, ' text');
});

// =========================================================================
// Reference Nodes & Definition Resolution (PR 2.1 Hardening)
// =========================================================================

test('Reference Nodes: Standard full, collapsed, and shortcut linkReference resolve definitions', () => {
    const { ctx } = createTestContext();
    const doc = [
        'See [Google Link][google-ref], [GitHub][], and [CommonMark].',
        '',
        '[google-ref]: https://google.com "Google Search"',
        '[GitHub]: https://github.com',
        '[CommonMark]: https://commonmark.org "Specification"',
    ].join('\n');

    const blocks = parseMarkdownToBlocks(doc, 'ref-test', ctx);
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].type, 'paragraph');

    const para = blocks[0] as any;
    const links = para.children.filter((c: any) => c.type === 'link');
    assert.strictEqual(links.length, 3);

    // Full reference
    assert.strictEqual(links[0].href, 'https://google.com');
    assert.strictEqual(links[0].title, 'Google Search');
    assert.strictEqual(links[0].children[0].text, 'Google Link');

    // Collapsed reference
    assert.strictEqual(links[1].href, 'https://github.com');
    assert.strictEqual(links[1].children[0].text, 'GitHub');

    // Shortcut reference
    assert.strictEqual(links[2].href, 'https://commonmark.org');
    assert.strictEqual(links[2].title, 'Specification');
    assert.strictEqual(links[2].children[0].text, 'CommonMark');
});

test('Reference Nodes: Case-insensitive definition matching and first-definition precedence', () => {
    const { ctx } = createTestContext();
    const doc = [
        'Jump to [Section A][SEC_A].',
        '',
        '[sec_a]: https://example.com/first',
        '[SEC_A]: https://example.com/second-ignored',
    ].join('\n');

    const blocks = parseMarkdownToBlocks(doc, 'case-test', ctx);
    assert.strictEqual(blocks.length, 1);
    const link = (blocks[0] as any).children.find((c: any) => c.type === 'link');
    assert.ok(link, 'Link must be resolved');
    // First definition takes precedence per CommonMark 4.7
    assert.strictEqual(link.href, 'https://example.com/first');
});

test('Reference Nodes: Definition lifetime is isolated per parse run (no leakage across calls with same ctx)', () => {
    const { ctx } = createTestContext();

    const doc1 = [
        'First: [x]',
        '',
        '[x]: https://example.com/A',
    ].join('\n');

    const doc2 = [
        'Second: [x]',
        '',
        '[x]: https://example.com/B',
    ].join('\n');

    const blocks1 = parseMarkdownToBlocks(doc1, 'run1', ctx);
    const link1 = (blocks1[0] as any).children.find((c: any) => c.type === 'link');
    assert.ok(link1, 'First link must be resolved');
    assert.strictEqual(link1.href, 'https://example.com/A');

    // Second parse run with the SAME ctx must resolve to B, never leaking A
    const blocks2 = parseMarkdownToBlocks(doc2, 'run2', ctx);
    const link2 = (blocks2[0] as any).children.find((c: any) => c.type === 'link');
    assert.ok(link2, 'Second link must be resolved');
    assert.strictEqual(link2.href, 'https://example.com/B');

    // Also test additional short parses with the same ctx
    const inlines1 = parseMarkdownToBlocks('[x]\n\n[x]: https://example.com/A', 'inline1', ctx)[0].children;
    const inlineLink1 = inlines1.find((c: any) => c.type === 'link');
    assert.ok(inlineLink1);
    assert.strictEqual((inlineLink1 as any).href, 'https://example.com/A');

    const inlines2 = parseMarkdownToBlocks('[x]\n\n[x]: https://example.com/B', 'inline2', ctx)[0].children;
    const inlineLink2 = inlines2.find((c: any) => c.type === 'link');
    assert.ok(inlineLink2);
    assert.strictEqual((inlineLink2 as any).href, 'https://example.com/B');
});

test('Reference Nodes: Image reference resolves definition and asset linking', () => {
    const { ctx, assetIndex } = createTestContext();
    assetIndex.set('https://example.com/diagram.png', 'asset-diag-42');

    const doc = [
        'Architecture: ![System Diagram][diag-ref]',
        '',
        '[diag-ref]: https://example.com/diagram.png "Architecture Flow"',
    ].join('\n');

    const blocks = parseMarkdownToBlocks(doc, 'img-ref-test', ctx);
    assert.strictEqual(blocks.length, 1);
    const img = (blocks[0] as any).children.find((c: any) => c.type === 'image');
    assert.ok(img, 'Image must be resolved');
    assert.strictEqual(img.assetId, 'asset-diag-42');
    assert.strictEqual(img.alt, 'System Diagram');
    assert.strictEqual(img.title, 'Architecture Flow');
});

test('Reference Nodes: Programmatic linkReference without definition emits diagnostic and preserves text', () => {
    const { ctx, diagnostics } = createTestContext();
    const orphanRefNode: any = {
        type: 'linkReference',
        identifier: 'missing-ref',
        label: 'missing-ref',
        referenceType: 'full',
        children: [{ type: 'text', value: 'Unresolved Link' }],
    };

    const inlines = adaptInlines([orphanRefNode], ctx);
    assert.strictEqual(inlines.length, 1);
    assert.strictEqual(inlines[0].type, 'text');
    assert.strictEqual((inlines[0] as any).text, 'Unresolved Link');

    const diag = diagnostics.find((d: any) => d.code === 'REFERENCE_DEFINITION_MISSING');
    assert.ok(diag, 'Must record REFERENCE_DEFINITION_MISSING diagnostic');
});

test('Reference Nodes: Programmatic imageReference without definition emits diagnostic and preserves fallback text', () => {
    const { ctx, diagnostics } = createTestContext();
    const orphanImgRef: any = {
        type: 'imageReference',
        identifier: 'missing-img',
        label: 'missing-img',
        referenceType: 'full',
        alt: 'Missing Photo',
    };

    const inlines = adaptInlines([orphanImgRef], ctx);
    assert.strictEqual(inlines.length, 1);
    assert.strictEqual(inlines[0].type, 'text');
    assert.strictEqual((inlines[0] as any).text, '![Missing Photo][missing-img]');

    const diag = diagnostics.find((d: any) => d.code === 'REFERENCE_DEFINITION_MISSING');
    assert.ok(diag, 'Must record REFERENCE_DEFINITION_MISSING diagnostic');
});

// =========================================================================
// Unknown != Disappear (Hardening: Never silently return [])
// =========================================================================

test('Unknown != Disappear: Unsupported phrasing node extracts child text and records diagnostic', () => {
    const { ctx, diagnostics } = createTestContext();
    const unknownWithChildren: any = {
        type: 'customPhrasingContainer',
        children: [{ type: 'text', value: 'nested text' }],
    };

    const inlines = adaptInlines([unknownWithChildren], ctx);
    assert.strictEqual(inlines.length, 1);
    assert.strictEqual(inlines[0].type, 'text');
    assert.strictEqual((inlines[0] as any).text, 'nested text');

    const diag = diagnostics.find((d: any) => d.code === 'MDAST_UNKNOWN_INLINE');
    assert.ok(diag, 'Must record MDAST_UNKNOWN_INLINE diagnostic');
});

test('unsupported inline wrapper flattens rich children to text without asset placements', () => {
    const { ctx, diagnostics, inlineAssets } = createTestContext();
    const inlines = adaptInlines([{ type: 'customWrapper', children: [
        { type: 'strong', children: [{ type: 'text', value: 'hello' }] },
        { type: 'break' },
        { type: 'image', alt: 'diagram', url: 'https://example.com/pic.png' },
        { type: 'inlineMath', value: 'x^2' },
        { type: 'link', url: 'https://example.com', children: [{ type: 'text', value: 'site' }] },
        { type: 'inlineCode', value: 'code' },
    ] } as any], ctx);
    assert.ok(inlines.every((node: any) => node.type === 'text' || node.type === 'lineBreak'));
    assert.strictEqual(inlines.map((node: any) => node.type === 'lineBreak' ? '\n' : node.text).join(''), 'hello\ndiagramx^2sitecode');
    assert.strictEqual(inlineAssets.length, 0);
    assert.strictEqual(diagnostics.filter((d: any) => d.code === 'MDAST_UNKNOWN_INLINE').length, 1);
    assert.deepStrictEqual(diagnostics[0].sourceRef, ctx.sourceRef);
});

test('Unknown != Disappear: Unsupported phrasing node with value preserves text and records diagnostic', () => {
    const { ctx, diagnostics } = createTestContext();
    const unknownWithValue: any = {
        type: 'customBadge',
        value: 'STATUS: OK',
    };

    const inlines = adaptInlines([unknownWithValue], ctx);
    assert.strictEqual(inlines.length, 1);
    assert.strictEqual(inlines[0].type, 'text');
    assert.strictEqual((inlines[0] as any).text, 'STATUS: OK');

    const diag = diagnostics.find((d: any) => d.code === 'MDAST_UNKNOWN_INLINE');
    assert.ok(diag, 'Must record MDAST_UNKNOWN_INLINE diagnostic');
});

test('Unknown != Disappear: Unsupported phrasing node without value/children returns visible text', () => {
    const { ctx, diagnostics } = createTestContext();
    const emptyUnknown: any = {
        type: 'mysteryInline',
        label: 'mystery-label',
    };

    const inlines = adaptInlines([emptyUnknown], ctx);
    assert.strictEqual(inlines.length, 1);
    assert.deepStrictEqual(inlines[0], { type: 'text', text: 'mystery-label' });
    assert.deepStrictEqual(adaptInlines([{ type: 'emptyWidget' } as any], ctx), [{ type: 'text', text: '[Unsupported inline: emptyWidget]' }]);

    const diag = diagnostics.find((d: any) => d.code === 'MDAST_UNKNOWN_INLINE');
    assert.ok(diag, 'Must record MDAST_UNKNOWN_INLINE diagnostic');
});

test('unsupported inline text follows children, value, alt, label, identifier priority', () => {
    const { ctx } = createTestContext();
    const samples = [
        { type: 'customInline', children: [{ type: 'text', value: 'child' }], value: 'value', alt: 'alt' },
        { type: 'customInline', value: 'value', alt: 'alt' },
        { type: 'customInline', alt: 'alt', label: 'label' },
        { type: 'customInline', label: 'label', identifier: 'identifier' },
        { type: 'customInline', identifier: 'identifier' },
    ];
    for (const [index, node] of samples.entries()) {
        assert.deepStrictEqual(adaptInlines([node as any], ctx), [{ type: 'text', text: ['child', 'value', 'alt', 'label', 'identifier'][index] }]);
    }
});

test('unsupported blocks retain raw slices, visible values, image alt text and empty placeholders', () => {
    const { ctx, diagnostics, inlineAssets } = createTestContext();
    const nodes: any[] = [
        { type: 'widget', position: { start: { offset: 0 }, end: { offset: 9 } }, value: 'value' },
        { type: 'widget', value: 'visible value' },
        { type: 'widget', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'see ' }, { type: 'image', alt: 'diagram', url: 'https://example.com/image.png' }] }] },
        { type: 'emptyWidget' },
    ];
    const blocks = mdastRootToBlocks({ type: 'root', children: nodes } as any, ctx, 'raw slice');
    assert.deepStrictEqual(blocks.map((b: any) => b.text), ['raw slice', 'visible value', 'see diagram', '[Unsupported block: emptyWidget]']);
    assert.strictEqual(inlineAssets.length, 0, 'text-only unknown blocks do not manufacture asset placements');
    assert.strictEqual(diagnostics.filter((d: any) => d.code === 'MDAST_UNKNOWN_BLOCK').length, 4);
});

test('unsupported inline fallback ignores malformed fields while preserving nested text and breaks', () => {
    const { ctx, diagnostics, inlineAssets } = createTestContext();
    const node = {
        type: 'customInline',
        value: { unexpected: 'not visible' },
        children: [null, 7, false, { type: 'customLeaf', value: 42, alt: 'diagram' },
            { type: 'break' }, { type: 'customLeaf', children: 'invalid', source: 'x^2' }],
    };
    const before = structuredClone(node);
    assert.deepStrictEqual(adaptInlines([node], ctx), [
        { type: 'text', text: 'diagram' },
        { type: 'lineBreak', kind: 'soft' },
        { type: 'text', text: 'x^2' },
    ]);
    assert.deepStrictEqual(node, before);
    assert.deepStrictEqual(diagnostics[0].details, { nodeType: 'customInline' });
    assert.strictEqual(inlineAssets.length, 0);
});

test('unsupported block fallback tolerates malformed descendants and positions without losing visible text', () => {
    const { ctx, diagnostics, inlineAssets } = createTestContext();
    const nodes = [
        { type: 'widget', position: { start: null, end: { offset: 9 } }, children: [
            null, 7, false, { type: 'paragraph', children: [
                { type: 'text', value: 'see ' }, { type: 'image', value: 12, alt: 'diagram' },
            ] }, { type: 'widget', value: { unexpected: true }, label: 'second paragraph' },
        ] },
        { type: 'widget', position: { start: { offset: '0' }, end: { offset: 9 } }, value: 'visible value' },
        { type: 'widget', children: { unexpected: true } },
    ];
    const before = structuredClone(nodes);
    const blocks = mdastRootToBlocks({ type: 'root', children: nodes }, ctx, 'raw slice');
    assert.deepStrictEqual(blocks, [
        { type: 'unknown', sourceType: 'widget', text: 'see diagram\nsecond paragraph' },
        { type: 'unknown', sourceType: 'widget', text: 'visible value' },
        { type: 'unknown', sourceType: 'widget', text: '[Unsupported block: widget]' },
    ]);
    assert.deepStrictEqual(nodes, before);
    assert.strictEqual(diagnostics.filter((d: { code: string }) => d.code === 'MDAST_UNKNOWN_BLOCK').length, 3);
    assert.strictEqual(inlineAssets.length, 0);
});

test('Unknown != Disappear: Unsupported block node collapses visible content to text and records diagnostic', () => {
    const { ctx, diagnostics } = createTestContext();
    const root: any = {
        type: 'root',
        children: [
            {
                type: 'customCalloutBox',
                children: [
                    {
                        type: 'paragraph',
                        children: [{ type: 'text', value: 'Inside callout' }],
                    },
                ],
            },
        ],
    };

    const blocks = mdastRootToBlocks(root, ctx, '');
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].type, 'unknown');
    const unknownBlock = blocks[0] as any;
    assert.strictEqual(unknownBlock.sourceType, 'customCalloutBox');
    assert.strictEqual(unknownBlock.text, 'Inside callout');
    assert.deepStrictEqual(Object.keys(unknownBlock).sort(), ['sourceType', 'text', 'type']);

    const diag = diagnostics.find((d: any) => d.code === 'MDAST_UNKNOWN_BLOCK');
    assert.ok(diag, 'Must record MDAST_UNKNOWN_BLOCK diagnostic');
    assert.deepStrictEqual(diag.sourceRef, ctx.sourceRef, 'diagnostic retains parser location');
    assert.strictEqual(unknownBlock.sourceRef, undefined, 'document block has no sourceRef');
});

test('GM-MD-001 Regression: Attached multiline display math fences do not swallow following blocks', () => {
    const { ctx } = createTestContext();
    const doc = [
        '#### 3. Teukolsky 主方程（TME）',
        '',
        '将方向导数转化为 Boyer-Lindquist 坐标微商，Teukolsky 统一方程写作：',
        '$$\\begin{aligned}',
        '\\Biggl[ &\\left(\\frac{(r^2+a^2)^2}{\\Delta} - a^2\\sin^2\\theta\\right)\\frac{\\partial^2\\psi}{\\partial t^2} \\\\',
        '&+ (s^2\\cot^2\\theta - s) \\psi \\Biggr] = 4\\pi \\Sigma T',
        '\\end{aligned}$$',
        '在真空辐射规范（Radiation Gauge / 无外源）条件下，令源项 $T = 0$。',
        '',
        '---',
    ].join('\n');

    const blocks = parseMarkdownToBlocks(doc, 'gm-md-001-test', ctx);
    assert.strictEqual(blocks.length, 5, 'Must cleanly parse into 5 distinct blocks without unclosed fence swallowing');

    assert.strictEqual(blocks[0].type, 'heading');
    assert.strictEqual((blocks[0] as any).level, 4);

    assert.strictEqual(blocks[1].type, 'paragraph');

    assert.strictEqual(blocks[2].type, 'math');
    const mathBlock = blocks[2] as any;
    assert.ok(mathBlock.source.startsWith('\\begin{aligned}'), 'Must retain \\begin{aligned} in math source');
    assert.ok(mathBlock.source.endsWith('\\end{aligned}'), 'Must retain \\end{aligned} in math source');
    assert.ok(!mathBlock.source.includes('$$'), 'Must not contain fence delimiters in math source');

    assert.strictEqual(blocks[3].type, 'paragraph');
    assert.ok(!mathBlock.source.includes('真空辐射规范'), 'Subsequent paragraph must not be swallowed into math block');

    assert.strictEqual(blocks[4].type, 'thematicBreak');
});


test('MDAST HTML containing an hr tag preserves authored text; a lone hr remains a break', () => {
    const { ctx } = createTestContext();
    const mixed = mdastRootToBlocks({ type: 'root', children: [{ type: 'html', value: 'Before<hr>After' }] }, ctx, '');
    assert.deepStrictEqual(mixed, [{ type: 'paragraph', children: [{ type: 'text', text: 'Before<hr>After' }] }]);
    const lone = mdastRootToBlocks({ type: 'root', children: [{ type: 'html', value: '  <hr class="rule" />  ' }] }, ctx, '');
    assert.deepStrictEqual(lone, [{ type: 'thematicBreak' }]);
});

test('MDAST mathflow accepts longer dollar fences without treating internal $$ as a closing fence', () => {
    const { ctx } = createTestContext();
    const parsed = parseGenericMarkdownToBlocks('$$$\nx = 1\n$$\ny = 2\n$$$', 'long-math-fence', ctx);
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].type, 'math');
    assert.strictEqual((parsed[0] as any).source, 'x = 1\n$$\ny = 2');
});
});

__suiteDescribe("escaped_dollar_math", () => {
test('captured escaped-dollar formulas retain their TeX sources and neighboring prose', () => {
    const raw = readFileSync('tests/fixtures/provider/math/gm_md_003_evidence.md', 'utf8').split('-->')[1].trim();
    const blocks = parseGeminiBody(raw);
    assert.equal(blocks[0].type, 'paragraph');
    if (blocks[0].type !== 'paragraph') return;
    assert.deepEqual(blocks[0].children.filter(n => n.type === 'inlineMath').map(n => n.source),
        [String.raw`\\$`, String.raw`f(\\$) = 1`, String.raw`\\$`]);
    assert.equal(normalizeEscapedDollarMath(normalizeEscapedDollarMath(raw)), normalizeEscapedDollarMath(raw));
});

test('safe Markdown math delimiters round-trip dollar runs without changing TeX', () => {
    for (const source of [String.raw`\$`, String.raw`f(\$) = 1`, String.raw`\\$`, String.raw`\text{a$$b}`]) {
        const tree = parseMarkdownAst('formula ' + inlineMathMarkdown(source) + ' end');
        const paragraph = tree.children[0];
        assert.equal(paragraph.type, 'paragraph');
        if (paragraph.type !== 'paragraph') continue;
        assert.deepEqual(paragraph.children.map(n => n.type), ['text', 'inlineMath', 'text']);
        const math = paragraph.children[1];
        assert.equal(math.type === 'inlineMath' && math.value, source);
    }
});

test('compatibility preserves code, display math, ordinary formulas, currency and unmatched input', () => {
    for (const source of [String.raw`cost \$5 and \$10`, String.raw`$x + y$`, String.raw`$f(\$)`,
        '`' + String.raw`$f(\$) = 1$` + '`', '```md\n' + String.raw`$f(\$) = 1$` + '\n```',
        '    ' + String.raw`$f(\$) = 1$`, String.raw`$$ f(\$) = 1 $$`, '$$\n' + String.raw`f(\$) = 1` + '\n$$']) {
        assert.equal(normalizeEscapedDollarMath(source), source);
    }
});
});

__suiteDescribe("html_to_markdown_code_fences", () => {
test__s2('source Markdown code fences protect HTML-like literals before any tag rewriting', () => {
    for (const fence of ['```', '~~~']) {
        const source = [fence + 'html', '<h2>Not a heading</h2>', '<pre><code>not a nested block</code></pre>', fence, '<p>Real paragraph</p>'].join('\n');
        const converted = convertHtmlToMarkdown(source);
        assert.ok(converted.includes([fence + 'html', '<h2>Not a heading</h2>', '<pre><code>not a nested block</code></pre>', fence].join('\n')));
        assert.ok(converted.includes('Real paragraph'));
        const blocks = parseGeminiBody(source, undefined, { diagnostics: [], sourceRef: { providerId: 'gemini', locator: 'test' } });
        const code = blocks.find(block => block.type === 'code');
        assert.ok(code && code.code.includes('<h2>Not a heading</h2>'));
        assert.ok(code && code.code.includes('<pre><code>not a nested block</code></pre>'));
    }
});

test__s2('HTML links and images retain escaped targets and do not rewrite code literals', () => {
    const source = '<p><a href="https://example.com/a(b)?x=1&amp;y=2">Article</a>'
        + '<img src="https://example.com/i.png" alt="Image [1]">'
        + '<code>&lt;img src="literal.png"&gt;</code></p>';
    const converted = convertHtmlToMarkdown(source);
    assert.ok(converted.includes('[Article](https://example.com/a%28b%29?x=1&y=2)'));
    assert.ok(converted.includes('![Image \\[1\\]](https://example.com/i.png)'));
    assert.ok(converted.includes('`<img src="literal.png">`'));
    assert.ok(convertHtmlToMarkdown('<img src="https://example.com/i.png" alt="Image">').includes('![Image](https://example.com/i.png)'));
    assert.equal(convertHtmlToMarkdown('<a href="javascript:alert(1)">Visible</a>'), 'Visible');
    assert.equal(convertHtmlToMarkdown('<img src="data:text/html,body" alt="Visible">'), 'Visible');
});

test__s2('HTML pre/code source is stashed before HTML normalization and uses a noncolliding fence', () => {
    const source = '<pre><code class="language-html">&lt;p&gt;literal&lt;/p&gt;\n```\n&lt;em&gt;code&lt;/em&gt;</code></pre><p>Outside</p>';
    const converted = convertHtmlToMarkdown(source);
    assert.ok(converted.includes('````html\n<p>literal</p>\n```\n<em>code</em>\n````'));
    assert.ok(converted.includes('Outside'));
    assert.ok(converted.includes('<em>code</em>'));
    assert.equal(converted.includes('**code**'), false);
});

test__s2('HTML inline code preserves literal tag text while converting surrounding markup', () => {
    const converted = convertHtmlToMarkdown('<p>Prefix <code>&lt;h1&gt;Literal&lt;/h1&gt;</code> <strong>Actual</strong></p>');
    assert.ok(converted.includes('`<h1>Literal</h1>`'));
    assert.ok(converted.includes('**Actual**'));
});

test__s2('Markdown code spans preserve HTML while surrounding markup is converted', () => {
    const inline = '`<strong>literal</strong>`';
    const multi = '``<code>`literal`\n&amp;</code>``';
    const html = '<code>`literal` &amp;</code>';
    assert.equal(
        convertHtmlToMarkdown(`Use ${inline} and ${multi}; <strong>real</strong> and ${html}.`),
        `Use ${inline} and ${multi}; **real** and ` + '`` `literal` & ``.',
    );
    assert.equal(convertHtmlToMarkdown('```<b>literal</b>``` and <b>real</b>'), '```<b>literal</b>``` and **real**');
});

test__s2('unmatched and escaped Markdown backticks do not shield surrounding HTML', () => {
    const source = '\`\`<b>first</b> \\\`<b>second</b> \`\n\n<b>third</b> \`\`';
    assert.equal(convertHtmlToMarkdown(source), '\`\`**first** \\\`**second** \`\n\n**third** \`\`');
    assert.equal(convertHtmlToMarkdown('\\``<b>literal</b>` <b>real</b>'), '\\``<b>literal</b>` **real**');
});

test__s2('backticks inside HTML attributes or comments cannot close Markdown code spans', () => {
    assert.equal(convertHtmlToMarkdown('Unmatched ` then <b title="`">real</b>.'), 'Unmatched ` then **real**.');
    assert.equal(convertHtmlToMarkdown('Unmatched ` then <!-- hidden ` --> <b>real</b>.'), 'Unmatched ` then  **real**.');
    assert.equal(convertHtmlToMarkdown('Use `<code>` and <b>real</b> and `</code>`.'), 'Use `<code>` and **real** and `</code>`.');
    const span = '`<b title="`">example</b>`';
    assert.equal(convertHtmlToMarkdown('Use ' + span + ' and <b>real</b>.'), 'Use ' + span + ' and **real**.');
});

test__s2('backticks inside real HTML code cannot close an unmatched prose delimiter', () => {
    assert.equal(convertHtmlToMarkdown('Unmatched ` then <code>`raw` &lt;b&gt;</code>.'), 'Unmatched ` then `` `raw` <b> ``.');
    assert.equal(convertHtmlToMarkdown('Use `<code>` then <code>`real` &lt;b&gt;</code> and `</code>`.'),
        'Use `<code>` then `` `real` <b> `` and `</code>`.');
});

test__s2('literal HTML comment openers in code do not consume following prose', () => {
    assert.equal(
        convertHtmlToMarkdown('Type `<!--` and keep this text. <!-- hidden --> <b>real</b>.'),
        'Type `<!--` and keep this text.  **real**.',
    );
});

test__s2('partial HTML examples preserve literal tags without shielding intervening markup', () => {
    assert.equal(
        convertHtmlToMarkdown('Use `use <code>` then <code>x</code> and `</code>`.'),
        'Use `use <code>` then `x` and `</code>`.',
    );
    assert.equal(
        convertHtmlToMarkdown('Use `use <code>` then <b>real</b> and `</code>`.'),
        'Use `use <code>` then **real** and `</code>`.',
    );
});

test__s2('formatted HTML between separate partial code tags is converted', () => {
    for (const [opening, closing] of [
        ['`<code>example`', '`</code>`'],
        ['``<code>example with a ` backtick``', '``end </code> suffix``'],
    ]) {
        const input = `Use ${opening} and <b>real</b> and ${closing}.`;
        const expected = `Use ${opening} and **real** and ${closing}.`;
        assert.equal(convertHtmlToMarkdown(input), expected);
        assert.equal(convertHtmlToMarkdown(`<p>${input}</p>`).trim(), expected);
        assert.ok(convertHtmlToMarkdown(`<table><tr><td>${input}</td><td>Other</td></tr></table>`)
            .includes(`| ${expected} | Other |`));
    }
});

test__s2('backticks in separate HTML code elements cannot form a Markdown span across the elements', () => {
    const source = '<code>left`</code> <b>one</b> <code>`middle`</code> <b>two</b> <code>`right</code>';
    assert.equal(convertHtmlToMarkdown(source), '`` left` `` **one** `` `middle` `` **two** `` `right ``');
    assert.equal(
        convertHtmlToMarkdown('Unmatched ` then <code>`first`</code> <b>and</b> <code>`second</code>'),
        'Unmatched ` then `` `first` `` **and** `` `second ``',
    );
});

test__s2('adjacent HTML and Markdown code preserve both code spans without leaking placeholders', () => {
    assert.equal(
        convertHtmlToMarkdown('<code>` raw `</code>`md`'),
        '`` ` raw ` `` `md`',
    );
});

test__s2('mixed HTML and Markdown never expose internal code placeholders', () => {
    const nested = '`<code>` ``<code>`` <b>real</b> ``</code>`` `</code>`';
    const inputs = [
        nested,
        '``<code>`` `<code>` <b>real</b> `</code>` ``</code>``',
        '`<code>` ``<code data-demo>`` <em>real</em> ``</code>`` `</code>`',
        '<code>` raw `</code>`md`',
        '<pre><code>`&lt;code&gt;`</code></pre>',
    ];
    for (const input of inputs) {
        for (const source of [input, `<p>${input}</p>`, `<table><tr><td>${input}</td></tr></table>`]) {
            assert.doesNotMatch(convertHtmlToMarkdown(source), /[\uE000\uFFFD]CODE\d+[\uE000\uFFFD]/, source);
        }
    }
});

test__s2('source text shaped like a code placeholder is retained verbatim', () => {
    const literal = '\uFFFDCODE7\uFFFD \uFFFDCODE0:0\uFFFD';
    assert.equal(
        convertHtmlToMarkdown(`${literal} then \`${literal}\` and <b>real</b>.`),
        `${literal} then \`${literal}\` and **real**.`,
    );
});

test__s2('literal closing cell tags are preserved in Markdown code outside HTML tables', () => {
    const example = 'Close cells with `</td>` or `</th>` here.';
    assert.equal(convertHtmlToMarkdown(example + ' <b>Real</b>'), example + ' **Real**');
    const table = '<table><tr><td>left</td><td>right</td></tr></table>';
    assert.equal(convertHtmlToMarkdown(example + table + example),
        example + '\n\n| left | right |\n| --- | --- |\n\n' + example);
    assert.equal(convertHtmlToMarkdown(example + ' Use `</table>` for tables. <b>Real</b>'),
        example + ' Use `</table>` for tables. **Real**');
});
});

__suiteDescribe("l1_html_table_width", () => {
const tableLines = (html: string) => convertHtmlToMarkdown(html).trim().split('\n');

test__s3('LPC-03: a later row wider than the header retains every cell', () => {
    const rows = tableLines('<table><tr><th>Header</th></tr>'
        + '<tr><td>First</td><td>Second</td><td>Third</td></tr></table>');
    assert.deepEqual(rows, [
        '| Header |  |  |',
        '| --- | --- | --- |',
        '| First | Second | Third |',
    ]);
});

test__s3('LPC-03: colspan occupies the right number of columns without dropping later rows', () => {
    const rows = tableLines('<table><tr><th colspan="2">Group</th><th>Final</th></tr>'
        + '<tr><td>One</td><td>Two</td><td>Three</td><td>Four</td></tr>'
        + '<tr><td colspan=2>Pair</td><td>Tail</td></tr></table>');
    assert.deepEqual(rows, [
        '| Group |  | Final |  |',
        '| --- | --- | --- | --- |',
        '| One | Two | Three | Four |',
        '| Pair |  | Tail |  |',
    ]);
});

test__s3('LPC-03: rowspan reserves its occupied column in the next row', () => {
    const rows = tableLines("<table><tr><th rowspan='2'>Group</th><th>Metric</th></tr>"
        + '<tr><th>Value</th></tr>'
        + '<tr><td>A</td><td>10</td></tr></table>');
    assert.deepEqual(rows, [
        '| Group | Metric |',
        '| --- | --- |',
        '|  | Value |',
        '| A | 10 |',
    ]);
});

test__s3('LPC-03: ordinary table and pipe escaping remain unchanged', () => {
    const rows = tableLines('<table><tr><th>A</th><th>B</th></tr>'
        + '<tr><td>left | right</td><td>two<br>lines</td></tr></table>');
    assert.deepEqual(rows, [
        '| A | B |',
        '| --- | --- |',
        '| left \\| right | two<br>lines |',
    ]);
});

test__s3('HTML table cells escape pipes in stashed Markdown code spans', () => {
    const rows = tableLines('<table><tr><td>`a|b`</td><td>`<b>a|b</b>`</td></tr>'
        + '<tr><td>`a\\|b`</td><td>right</td></tr></table>');
    assert.deepEqual(rows, [
        '| `a\\|b` | `<b>a\\|b</b>` |',
        '| --- | --- |',
        '| `a\\|b` | right |',
    ]);
});

test__s3('Markdown backticks in distinct HTML table cells do not pair', () => {
    const rows = tableLines('<table><tr><th>`left</th><th>right`</th></tr>'
        + '<tr><td>`first</td><td>second`</td></tr></table>');
    assert.deepEqual(rows, [
        '| `left | right` |',
        '| --- | --- |',
        '| `first | second` |',
    ]);
    const example = '`<table><tr><td>literal</td></tr></table>`';
    assert.equal(convertHtmlToMarkdown('Use ' + example + ' with <b>HTML</b>.'), 'Use ' + example + ' with **HTML**.');
});
});

__suiteDescribe("markdown-resource-parser", () => {
test__s4('production MDAST links and images retain URLs and reference definition precedence', () => {
    assert.deepEqual(extractMarkdownResourceReferences(
        '[attachment][ref]\n\n[ref]: files/foo.md "title"\n[ref]: files/wrong.md\n\n![image](assets/foo.png)',
    ), [
        { kind: 'link', reference: 'files/foo.md' },
        { kind: 'image', reference: 'assets/foo.png' },
    ]);
});

test__s4('syntax helper emits external references for the archive resolver to classify', () => {
    assert.deepEqual(extractMarkdownResourceReferences('[remote](https://example.com) [section](#section)'), [
        { kind: 'link', reference: 'https://example.com' },
        { kind: 'link', reference: '#section' },
    ]);
});









test__s4('serialized literal dollars round-trip as text while links and math retain their nodes', () => {
    const domain: DomainConversationWithDetail = { index: { key: fixtureKey(String('currency'), 'gemini'),   titleSource: "derived",   title: 'Currency' }, detail: { key: fixtureKey(String('currency'), 'gemini'), quality: { status: 'unknown' }, assets: [{ id: 'receipt', kind: 'file', name: 'receipt' }], messages: [{ id: 'message', role: 'assistant', content: [
                { type: 'paragraph', children: [
                    { type: 'text', text: 'The price changed from $5 ' },
                    { type: 'link', href: 'https://example.com/receipt', children: [{ type: 'text', text: 'receipt' }] },
                    { type: 'text', text: ' to $10. ' },
                    { type: 'inlineMath', source: 'E = mc^2' },
                ] },
                { type: 'math', source: String.raw`\left[W(k)\right](\mathbf{t})` },
                { type: 'file', assetId: 'receipt', label: 'receipt' },
                { type: 'code', language: 'md', code: '[fake](files/missing.pdf)' },
                { type: 'paragraph', children: [{ type: 'inlineCode', code: '[fake](files/missing.pdf)' }] },
            ] }] } };
    const markdown = renderDocumentMarkdown(composeDomainDocument(validateParserDomain(domain), fixtureAccountFor(validateParserDomain(domain))), { receipt: 'files/foo.pdf' });
    assert.ok(markdown.includes(String.raw`The price changed from \$5 [receipt](https://example.com/receipt) to \$10. $E = mc^2$`));
    assert.ok(markdown.includes('$$\n' + String.raw`\left[W(k)\right](\mathbf{t})` + '\n$$'));
    const tree = parseMarkdownAst(markdown);
    const paragraph = tree.children.find(node => node.type === 'paragraph' && node.children.some(child => child.type === 'link'));
    assert.ok(paragraph?.type === 'paragraph');
    assert.deepEqual(paragraph.children.map(node => node.type), ['text', 'link', 'text', 'inlineMath']);
    assert.equal(paragraph.children[0].type === 'text' && paragraph.children[0].value, 'The price changed from $5 ');
    assert.equal(paragraph.children[2].type === 'text' && paragraph.children[2].value, ' to $10. ');
    assert.equal(paragraph.children[3].type === 'inlineMath' && paragraph.children[3].value, 'E = mc^2');
    assert.deepEqual(extractMarkdownResourceReferences(markdown), [{ kind: 'link', reference: 'https://example.com/receipt' }, { kind: 'link', reference: 'files/foo.pdf' }]);

    const root = mkdtempSync(join(tmpdir(), 'serialized-resources-'));
    try {
        const validate = () => {
            const result = spawnSync('python3', ['-c',
                'import json,sys; from scripts.framework.archive_resources import validate_archive_resources; print(json.dumps(validate_archive_resources(sys.argv[1], "chat.md", sys.stdin.read())))', root,
            ], { input: markdown, encoding: 'utf8' });
            assert.equal(result.status, 0, result.stderr);
            return JSON.parse(result.stdout) as string[];
        };
        assert.deepEqual(validate(), ['files/foo.pdf: missing or empty resource: files/foo.pdf']);
        mkdirSync(join(root, 'files'));
        writeFileSync(join(root, 'files/foo.pdf'), 'nonempty attachment');
        assert.deepEqual(validate(), []);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test__s4('shared AST primitive preserves source offsets without Gemini preprocessing', () => {
    // GM-MD-001 inserts fence newlines for raw Gemini fallback. The syntax
    // primitive must preserve the final artifact exactly, including positions.
    const source = '$$\\begin{aligned}\nx = 1\n\\end{aligned}$$\n';
    const tree = parseMarkdownAst(source);
    assert.equal(tree.position?.end.offset, source.length);
});
});

__suiteDescribe("markdown-tex-fences", () => {
for (const [name, code] of [
    ['shorter backticks', '````text\nbefore\n```\n\\(x+y\\)\n````'],
    ['shorter tildes', '~~~~text\nbefore\n~~~\n\\(x+y\\)\n~~~~'],
    ['backticks inside tildes', '~~~text\n```\n\\(x+y\\)\n~~~'],
    ['longer closing fence', '```text\n\\(x+y\\)\n````'],
    ['indented closing fence', '   ````text\n```\n\\(x+y\\)\n   `````  '],
    ['non-line closing run', '````text\nbefore ```` after\n\\(x+y\\)\n````'],
    ['closing run with text', '````text\n```` not a closer\n\\(x+y\\)\n````'],
    ['inline span', '`\\(x+y\\)`'],
    ['list continuation', '1. Step\n   ```text\n   \\(x+y\\)\n   ```'],
    ['list marker opener', '- ```text\n  \\(x+y\\)\n  ```'],
    ['blockquote', '> ```text\n> \\(x+y\\)\n> ```'],
    ['nested containers', '> 1. - ```text\n>      \\(x+y\\)\n>      ```'],
    ['nested list continuation', '1. Step\n   - Nested\n     ```text\n     \\(x+y\\)\n     ```'],
    ['list marker is not a top-level closer', '```text\n- ```\n\\(x+y\\)\n```'],
    ['quote marker is not a top-level closer', '```text\n> ```\n\\(x+y\\)\n```'],
    ['four-space indentation is not a closer', '```text\n    ```\n\\(x+y\\)\n```'],
] as const) {
    test(`TeX shielding: ${name}`, () => {
        assert.equal(transformMarkdownOutsideCode(`\\(a+b\\)\n${code}\n\\(c+d\\)`, normalizeTexBracketsInProse),
            `$a+b$\n${code}\n$c+d$`);
    });
}

for (const [name, code] of [
    ['blockquote ends an unclosed fence', '> ```text\n> \\(x+y\\)'],
    ['list ends an unclosed fence', '- ```text\n  \\(x+y\\)'],
    ['indented backticks are code, not a fence opener', '    ```text\n    \\(x+y\\)'],
    ['indented code', '    literal \\(x+y\\)'],
] as const) {
    test(`TeX shielding: ${name}`, () => {
        assert.equal(transformMarkdownOutsideCode(`${code}\n\nFollowing \\(z\\)`, normalizeTexBracketsInProse),
            `${code}\n\nFollowing $z$`);
    });
}

test('TeX shielding keeps unclosed fences literal through EOF', () => {
    const source = '\\(a+b\\)\n````text\n```\n\\(x+y\\)';
    assert.equal(transformMarkdownOutsideCode(source, normalizeTexBracketsInProse), source.replace('\\(a+b\\)', '$a+b$'));
});

test('backticks in an info string invalidate a backtick fence, not a tilde fence', () => {
    const source = '```code``` then \\(x\\)\nFollowing \\(y\\)';
    assert.equal(transformMarkdownOutsideCode(source, normalizeTexBracketsInProse),
        '```code``` then $x$\nFollowing $y$');
    const tilde = '~~~code`info\n\\(x\\)\n~~~\nFollowing \\(y\\)';
    assert.equal(transformMarkdownOutsideCode(tilde, normalizeTexBracketsInProse),
        '~~~code`info\n\\(x\\)\n~~~\nFollowing $y$');
});

test('TeX shielding handles empty input and propagates transform errors', () => {
    assert.equal(transformMarkdownOutsideCode('', () => { throw new Error('unused'); }), '');
    assert.throws(() => transformMarkdownOutsideCode('prose', () => { throw new Error('failed'); }), /failed/);
});
});

__suiteDescribe("provider-nested-inline-fidelity", () => {
const { historicalFixture } = require('./helpers/nativeFixture.js');
/**
 * tests/provider-nested-inline-fidelity.test.ts
 * Tier 1 unit tests for HTML export fidelity & nested inline Markdown semantics.
 *
 * Verifies:
 * - Table cell bold: <strong>bold</strong>, not literal **bold**
 * - Table cell line breaks: <br>, not literal &lt;br&gt;
 * - Mixed inline semantics: **State**<br>`code` and *italic*
 * - Code and math spans nested inside emphasis: **bold `code` bold**, **bold $x$ bold**
 * - Links nested inside emphasis and emphasis inside links: **[link](...)**, [**bold**](...)
 * - Various break variants (<br>, <br/>, <br />) supported in paragraphs and tables
 */

const test = require('node:test');


const { composeDomainDocument } = require('../src/l3b/compose/composeDomainDocument.js');
const { renderDocumentHtml } = require('../src/l4/format/html/renderHtml.js');

async function normAndRender(content: string, options: any = {}) {
    const raw: any = {
        id: 'fidelity_test_chat',
        title: 'Fidelity Test',
        messages: [{ id: 'm1', role: 'model', content }],
    };
    const { conversation: domain, diagnostics } = await historicalFixture(raw, { providerId: 'gemini', ...options });
    const { html } = renderDocumentHtml(composeDomainDocument(domain, fixtureAccountFor(domain)), {});
    const msg = domain.detail.messages[0];
    return { domain, msg, html, diagnostics };
}

test('Fidelity 1: Table cell bold renders as <strong> and does not leak **', async () => {
    const md = '| Dimension |\n| :--- |\n| **bold text** |\n';
    const { msg, html } = await normAndRender(md);

    const table = msg.content.find((b: any) => b.type === 'table');
    assert.ok(table?.type === 'table');
    const cellChildren = table.rows[0].cells[0].children;
    assert.strictEqual(cellChildren.length, 1);
    assert.strictEqual(cellChildren[0].type, 'strong');
    assert.strictEqual(cellChildren[0].children[0].text, 'bold text');

    // HTML assertions
    assert.ok(html.includes('<strong>bold text</strong>'), 'HTML contains <strong>bold text</strong>');
    assert.ok(!html.includes('**bold text**'), 'HTML does not leak **bold text**');
});

test('Fidelity 2: Table cell HTML break <br> renders as lineBreak and does not leak literal &lt;br&gt;', async () => {
    const md = '| 对比维度 | 经典比特 (Bit) |\n| :--- | :--- |\n| **叠加态** | **确定状态**<br>任意时刻只能处于确定的 $0$ 或 $1$ 状态。 |\n';
    const { msg, html } = await normAndRender(md);

    const table = msg.content.find((b: any) => b.type === 'table');
    assert.ok(table?.type === 'table');
    const cellChildren = table.rows[0].cells[1].children;

    // Check Domain content structure
    assert.strictEqual(cellChildren[0].type, 'strong');
    assert.strictEqual(cellChildren[0].children[0].text, '确定状态');
    assert.strictEqual(cellChildren[1].type, 'lineBreak');
    assert.strictEqual(cellChildren[1].kind, 'hard');

    // HTML assertions
    assert.ok(html.includes('<strong>确定状态</strong><br>任意时刻只能处于确定的'), 'HTML contains <br> line break after strong');
    assert.ok(!html.includes('&lt;br&gt;'), 'HTML does not escape <br> to literal &lt;br&gt;');
    assert.ok(!html.includes('&lt;br/&gt;'), 'HTML does not contain literal &lt;br/&gt;');
});

test('Fidelity 3: Mixed inline semantics (**State**<br>`code` and *italic*) render completely and accurately', async () => {
    const md = '**State**<br>`code` and *italic*';
    const { msg, html } = await normAndRender(md);

    const p = msg.content[0];
    assert.strictEqual(p.type, 'paragraph');
    const types = p.children.map((c: any) => c.type);
    assert.deepStrictEqual(types, ['strong', 'lineBreak', 'inlineCode', 'text', 'emphasis']);

    assert.strictEqual(p.children[0].children[0].text, 'State');
    assert.strictEqual(p.children[2].code, 'code');
    assert.strictEqual(p.children[3].text, ' and ');
    assert.strictEqual(p.children[4].children[0].text, 'italic');

    // HTML assertions
    assert.ok(html.includes('<strong>State</strong><br><code class="gem-inline-code">code</code> and <em>italic</em>'),
        'HTML contains all inline elements correctly typeset');
    assert.ok(!html.includes('**State**'), 'HTML does not leak **State**');
    assert.ok(!html.includes('&lt;br&gt;'), 'HTML does not leak &lt;br&gt;');
});

test('Fidelity 4: Emphasis wrapping code spans and math spans preserves nesting without delimiter leakage', async () => {
    const md = '**bold `code` bold** and *italic `code` italic* and **bold $x$ bold**';
    const { msg, html } = await normAndRender(md);

    const p = msg.content[0];
    assert.strictEqual(p.type, 'paragraph');

    // First node is strong
    assert.strictEqual(p.children[0].type, 'strong');
    const strongChildren = p.children[0].children;
    assert.strictEqual(strongChildren[0].text, 'bold ');
    assert.strictEqual(strongChildren[1].type, 'inlineCode');
    assert.strictEqual(strongChildren[1].code, 'code');
    assert.strictEqual(strongChildren[2].text, ' bold');

    // HTML assertions
    assert.ok(html.includes('<strong>bold <code class="gem-inline-code">code</code> bold</strong>'),
        'HTML renders strong wrapping inline code');
    assert.ok(html.includes('<em>italic <code class="gem-inline-code">code</code> italic</em>'),
        'HTML renders emphasis wrapping inline code');
    assert.ok(html.includes('<strong>bold <span class="gem-math-inline">') && html.includes('<math') && html.includes('</span> bold</strong>'),
        'HTML renders strong wrapping inline math');
    assert.ok(!html.includes('**bold'), 'HTML does not leak **bold');
});

test('Fidelity 5: Emphasis wrapping links and links wrapping emphasis', async () => {
    const md = '**[bold link](https://example.com/1)** and [**nested bold**](https://example.com/2)';
    const { msg, html } = await normAndRender(md);

    const p = msg.content[0];
    // First: strong containing link
    assert.strictEqual(p.children[0].type, 'strong');
    const link1 = p.children[0].children[0];
    assert.strictEqual(link1.type, 'link');
    assert.strictEqual(link1.href, 'https://example.com/1');

    // Second: link containing strong
    assert.strictEqual(p.children[2].type, 'link');
    assert.strictEqual(p.children[2].href, 'https://example.com/2');
    assert.strictEqual(p.children[2].children[0].type, 'strong');
    assert.strictEqual(p.children[2].children[0].children[0].text, 'nested bold');

    // HTML assertions
    assert.ok(html.includes('<strong><a href="https://example.com/1"'), 'HTML renders strong wrapping <a>');
    const nestedLinkHtml = html.match(/<a\b[^>]*><strong>nested bold<\/strong><\/a>/)?.[0];
    assert.ok(nestedLinkHtml, 'HTML renders link wrapping emphasis');
    assert.ok(nestedLinkHtml.includes('href="https://example.com/2"'));
    assert.ok(nestedLinkHtml.includes('target="_blank"'));
    assert.ok(nestedLinkHtml.includes('rel="noopener noreferrer"'));
    assert.ok(!html.includes('**['), 'HTML does not leak **[');
    assert.ok(!html.includes('[**'), 'HTML does not leak [**');
});

test('Fidelity 7: Various break variants (<br>, <br/>, <br />) are supported in both paragraph and tables', async () => {
    const md = 'line1<br>line2<br/>line3<br />line4';
    const { msg, html } = await normAndRender(md);

    const p = msg.content[0];
    const breakCount = p.children.filter((c: any) => c.type === 'lineBreak').length;
    assert.strictEqual(breakCount, 3, 'all 3 breaks recognized');

    assert.ok(html.includes('line1<br>line2<br>line3<br>line4'), 'HTML renders clean <br> tags');
    assert.ok(!html.includes('&lt;br'), 'HTML does not leak escaped &lt;br');
    // These forms are also valid inside Markdown table cells, not only paragraphs.
    for (const variant of ['<br>', '<br/>', '<br />']) {
        const tableMarkdown = `| Text |\n| :--- |\n| first${variant}second |\n`;
        const { msg: tableMsg, html: tableHtml } = await normAndRender(tableMarkdown);
        const table = tableMsg.content.find((block: any) => block.type === 'table');
        assert.ok(table, `table parsed with ${variant}`);
        assert.deepStrictEqual(table.rows[0].cells[0].children.map((node: any) => node.type), ['text', 'lineBreak', 'text']);
        assert.ok(tableHtml.includes('first<br>second'), `table renders actual break for ${variant}`);
    }
});
});

__suiteDescribe("provider-parser-hardening", () => {
const { historicalFixture } = require('./helpers/nativeFixture.js');
/**
 * tests/provider-parser-hardening.test.ts
 * Tier 1 tests for the F2 canonical Markdown parser hardening:
 * display-math block policy (P0 formal case), borderless tables, escaped /
 * code-span pipes, balanced-paren link targets, first-class inline images
 * (bare / linked / reuse / missing / multi), nested emphasis, and malformed
 * input preservation.
 */

const test = require('node:test');


const { assertDomainClosure } = require('../src/l2/closure.js');
const { composeDomainDocument } = require('../src/l3b/compose/composeDomainDocument.js');
const { renderDocumentHtml } = require('../src/l4/format/html/renderHtml.js');

async function norm(content: string, extra?: Record<string, unknown>) {
    const raw: any = {
        id: 'c1',
        messages: [{ id: 'm1', role: 'user', content, ...(extra || {}) }],
    };
    const { conversation: domain, diagnostics } = await historicalFixture(raw, { providerId: 'gemini' });
    return { domain, diagnostics, msg: domain.detail.messages[0] };
}

function inlineText(nodes: any[]): string {
    return nodes
        .map((n) => {
            if (n.type === 'text' || n.type === 'inlineCode') return n.text ?? n.code ?? '';
            if (n.type === 'inlineMath') return `$${n.source}$`;
            if (n.type === 'image') return `[img:${n.alt ?? ''}]`;
            if (n.children) return inlineText(n.children);
            return '';
        })
        .join('');
}

test('F1: display formula with trailing text keeps both, never an empty MathBlock', async () => {
    const { msg, diagnostics } = await norm('$$F_n = \\\\frac{a}{b}$$ 其中 text。');
    assert.strictEqual(msg.content.length, 1);
    const p = msg.content[0];
    assert.strictEqual(p.type, 'paragraph');
    assert.ok(p?.type === 'paragraph');
    const kinds = p.children.map((c: any) => c.type);
    assert.deepStrictEqual(kinds, ['inlineMath', 'text']);
    assert.strictEqual(p.children[0].source, 'F_n = \\\\frac{a}{b}');
    assert.ok(p.children[1].text.includes('其中 text。'));
    assert.ok(!diagnostics.some((d: any) => d.code === 'MATH_BLOCK_EMPTY'));
});

test('standalone display formula is a MathBlock', async () => {
    const { msg } = await norm('$$x^2 + y^2$$');
    assert.strictEqual(msg.content.length, 1);
    assert.strictEqual(msg.content[0].type, 'math');
    assert.ok(msg.content[0]?.type === 'math');
    assert.strictEqual(msg.content[0].source, 'x^2 + y^2');
});

test('multiple formulas on one line all survive as inline math', async () => {
    const { msg } = await norm('$$a$$ and $$b$$ done');
    assert.strictEqual(msg.content.length, 1);
    const kinds = msg.content[0].children.map((c: any) => c.type);
    assert.deepStrictEqual(kinds, ['inlineMath', 'text', 'inlineMath', 'text']);
    assert.strictEqual(msg.content[0].children[0].source, 'a');
    assert.strictEqual(msg.content[0].children[2].source, 'b');
});

test('unclosed display-math fence keeps the lines and raises a diagnostic', async () => {
    const { msg, diagnostics } = await norm('$$\nE = mc^2\nstill open');
    assert.strictEqual(msg.content[0].type, 'math');
    assert.ok(msg.content[0]?.type === 'math');
    assert.ok(msg.content[0].source.includes('E = mc^2'));
    assert.ok(
        diagnostics.some((d: any) => d.code === 'MATH_FENCE_UNCLOSED'),
        'MATH_FENCE_UNCLOSED raised',
    );
});

test('borderless table parses without leading/trailing pipes', async () => {
    const { msg } = await norm('a | b\n--- | ---\n1 | 2\n');
    const t = msg.content.find((b: any) => b.type === 'table');
    assert.ok(t?.type === 'table');
    assert.strictEqual(t.headerRows.length, 1);
    assert.strictEqual(t.rows.length, 1);
    assert.deepStrictEqual(
        t.headerRows[0].cells.map((c: any) => inlineText(c.children)),
        ['a', 'b'],
    );
    assert.deepStrictEqual(
        t.rows[0].cells.map((c: any) => inlineText(c.children)),
        ['1', '2'],
    );
});

test('escaped pipes and code-span pipes do not split columns', async () => {
    const { msg } = await norm('| a | b |\n| --- | --- |\n| `x\\|y` | z\\|w |\n');
    const t = msg.content.find((b: any) => b.type === 'table');
    assert.ok(t?.type === 'table');
    const body = t.rows[t.rows.length - 1];
    assert.deepStrictEqual(
        body.cells.map((c: any) => inlineText(c.children)),
        ['x|y', 'z|w'],
    );
});

test('link target with balanced parentheses is preserved', async () => {
    const { msg } = await norm('[x](https://a/b_(c))');
    const link = msg.content[0].children.find((c: any) => c.type === 'link');
    assert.ok(link?.type === 'link');
    assert.strictEqual(link.href, 'https://a/b_(c)');
});

test('bare remote image becomes a first-class ImageInline with a remote asset', async () => {
    const { domain, msg } = await norm('see ![alt text](https://example.com/i.png) here');
    const img = msg.content[0].children.find((c: any) => c.type === 'image');
    assert.ok(img?.type === 'image');
    assert.strictEqual(img.alt, 'alt text');
    const asset = domain.detail.assets.find((a: any) => a.id === img.assetId);
    assert.ok(asset, 'asset registered');
    assert.strictEqual(asset.sourceUri, 'https://example.com/i.png');
    assert.doesNotThrow(() => assertDomainClosure((domain).detail));
});

test('linked image parses as link wrapping an ImageInline', async () => {
    const { domain, msg } = await norm('[![alt](https://example.com/i.png)](https://example.com/page)');
    const link = msg.content[0].children.find((c: any) => c.type === 'link');
    assert.ok(link?.type === 'link');
    assert.strictEqual(link.href, 'https://example.com/page');
    assert.strictEqual(link.children.length, 1);
    assert.strictEqual(link.children[0].type, 'image');
    assert.ok(link.children[0]?.type === 'image');
    assert.strictEqual(link.children[0].alt, 'alt');
    assert.ok(domain.detail.assets.some((a: any) => a.id === link.children[0].assetId), 'asset registered');
});

test('inline image reuses the matching attachment asset', async () => {
    const { domain, msg } = await norm('see ![pic](assets/shot.png) here', {
        attachments: [{ localName: 'assets/shot.png', mimeType: 'image/png' }],
    });
    const img = msg.content[0].children.find((c: any) => c.type === 'image');
    assert.ok(img?.type === 'image');
    assert.strictEqual(img.assetId, domain.detail.assets[0].id);
    assert.strictEqual(domain.detail.assets.length, 1);
});

test('image with no source remains a semantic asset and the backend reports unavailable resources', async () => {
    const { domain, msg } = await norm('x ![]() y');
    const img = msg.content[0].children.find((c: any) => c.type === 'image');
    assert.ok(img?.type === 'image');
    const asset = domain.detail.assets.find((a: any) => a.id === img.assetId);
    assert.ok(asset, 'asset registered');
    assert.ok(!asset.sourceUri);
    assert.doesNotThrow(() => assertDomainClosure((domain).detail));
    const rendered = renderDocumentHtml(composeDomainDocument(domain, fixtureAccountFor(domain)), {});
    assert.ok(rendered.diagnostics.some((d: any) => d.code === 'HTML_ASSET_UNRESOLVED'));
    assert.ok(rendered.html.includes('gem-missing-asset'));
});

test('multiple images in one paragraph each get their own asset', async () => {
    const { domain, msg } = await norm('![one](https://example.com/1.png) ![two](https://example.com/2.png)');
    const imgs = msg.content[0].children.filter((c: any) => c.type === 'image');
    assert.strictEqual(imgs.length, 2);
    assert.notStrictEqual(imgs[0].assetId, imgs[1].assetId);
    assert.strictEqual(domain.detail.assets.length, 2);
});

test('nested emphasis: strong containing emphasis', async () => {
    const { msg } = await norm('**bold *bold-italic* end**');
    const strong = msg.content[0].children.find((c: any) => c.type === 'strong');
    assert.ok(strong?.type === 'strong');
    const kinds = strong.children.map((c: any) => c.type);
    assert.deepStrictEqual(kinds, ['text', 'emphasis', 'text']);
    assert.strictEqual(inlineText(strong.children), 'bold bold-italic end');
});

test('nested emphasis: emphasis containing strong', async () => {
    const { msg } = await norm('*italic **bold** end*');
    const em = msg.content[0].children.find((c: any) => c.type === 'emphasis');
    assert.ok(em?.type === 'emphasis');
    const kinds = em.children.map((c: any) => c.type);
    assert.deepStrictEqual(kinds, ['text', 'strong', 'text']);
});

test('triple-star and strikethrough keep their node shapes', async () => {
    const { msg } = await norm('***both*** and ~~gone~~');
    const first = msg.content[0].children[0];
    const hasBoth = (first.type === 'strong' && first.children[0].type === 'emphasis') ||
                    (first.type === 'emphasis' && first.children[0].type === 'strong');
    assert.ok(hasBoth, 'both strong and emphasis found');
    const strike = msg.content[0].children.find((c: any) => c.type === 'strikethrough');
    assert.ok(strike?.type === 'strikethrough');
});

test('unclosed emphasis markers stay literal text', async () => {
    const { msg } = await norm('**unclosed and *also');
    assert.deepStrictEqual(
        msg.content[0].children.map((c: any) => c.type),
        ['text'],
    );
    assert.ok(msg.content[0].children[0].text.includes('**unclosed'));
});

test('dollar prices are not treated as math', async () => {
    const { msg } = await norm('price is $5 and $10');
    assert.deepStrictEqual(
        msg.content[0].children.map((c: any) => c.type),
        ['text'],
    );
    assert.ok(msg.content[0].children[0].text.includes('$5 and $10'));
});
});

__suiteDescribe("provider-underscore-delimiter", () => {
/**
 * tests/provider-underscore-delimiter.test.ts
 * Parser-level regression for parseEmphasis() underscore delimiter rules.
 *
 * Underscore markers (`_` / `__` / `___`) may only open/close emphasis when
 * CommonMark left/right-flanking rules allow it. Intra-word underscores
 * (foo_bar, T_N, LaTeX subscripts, file names) must stay plain text.
 * No LaTeX-specific special-casing is used; the fix is delimiter rules only.
 */

const test = require('node:test');
const assert = require('node:assert');


async function inlineNodes(content: string): Promise<any[]> {
    const { conversation: domain } = sourceDetail({ messages: [sourceMessage('m1', content, 'model')] });
    const msg = domain.detail.messages[0];
    const out: any[] = [];
    for (const b of msg.content) {
        if (b.type === 'paragraph' || b.type === 'heading') out.push(...b.children);
    }
    return out;
}

function hasEmphasis(nodes: any[]): boolean {
    for (const n of nodes) {
        if (n.type === 'emphasis' || n.type === 'strong') return true;
        if (n.children && hasEmphasis(n.children)) return true;
    }
    return false;
}

function allText(nodes: any[]): string {
    return nodes
        .map((n) => {
            if (n.type === 'text') return n.text ?? '';
            if (n.children) return allText(n.children);
            return '';
        })
        .join('');
}

// Must stay plain text: no emphasis/strong node anywhere, text preserved verbatim.
const STAY_TEXT = [
    'foo_bar',
    'foo_bar_baz',
    'T_N',
    'S_i',
    'V_{eff}',
    '\\omega_c',
    '\\sum_{\\langle i, j \\rangle} \\vec{S}_i',
    '|\\Theta_{CW}|/T_N',
    'gemini_test_1790464921_a7b4a079.custom',
    'file_name.txt',
    'snake_case_variable',
    'gemini_test_123',
];

for (const input of STAY_TEXT) {
    test(`underscore stays text: ${input}`, async () => {
        const nodes = await inlineNodes(input);
        assert.ok(!hasEmphasis(nodes), `unexpected emphasis/strong in ${JSON.stringify(input)}`);
        assert.strictEqual(allText(nodes), input, 'text must be preserved verbatim');
    });
}

// Legit underscore Markdown must keep working.
test('legit italic: _this is italic_', async () => {
    const nodes = await inlineNodes('_this is italic_');
    assert.ok(hasEmphasis(nodes), 'expected an emphasis node');
    assert.strictEqual(allText(nodes), 'this is italic');
});

test('legit italic inside sentence: word _italic_ word', async () => {
    const nodes = await inlineNodes('word _italic_ word');
    const kinds = nodes.map((n: any) => n.type);
    assert.ok(kinds.includes('emphasis'), `expected emphasis, got ${JSON.stringify(kinds)}`);
    assert.strictEqual(allText(nodes), 'word italic word');
});

test('legit strong: __strong__', async () => {
    const nodes = await inlineNodes('__strong__');
    const kinds = nodes.map((n: any) => n.type);
    assert.ok(kinds.includes('strong'), `expected strong, got ${JSON.stringify(kinds)}`);
    assert.strictEqual(allText(nodes), 'strong');
});

test('legit strong inside sentence: word __strong__ word', async () => {
    const nodes = await inlineNodes('word __strong__ word');
    const kinds = nodes.map((n: any) => n.type);
    assert.ok(kinds.includes('strong'), `expected strong, got ${JSON.stringify(kinds)}`);
    assert.strictEqual(allText(nodes), 'word strong word');
});

// Star markers keep their existing (non-flanking) behavior.
test('star emphasis unchanged: *italic* and **bold**', async () => {
    const a = await inlineNodes('*italic*');
    assert.ok(hasEmphasis(a), 'expected emphasis for *italic*');
    const b = await inlineNodes('**bold**');
    assert.ok(b.some((n: any) => n.type === 'strong'), 'expected strong for **bold**');
});
});

__suiteDescribe("provider-underscore-html-regression", () => {
const { historicalFixture } = require('./helpers/nativeFixture.js');
/**
 * tests/provider-underscore-html-regression.test.ts
 * Production regression: Tier-2-class inputs must survive the full
 * historicalFixture -> composeDomainDocument -> renderDocumentHtml pipeline without
 * <em> being injected into LaTeX-like underscores or file names.
 *
 * Reuses the #636 Tier 2 gate assertions locally (the gate itself,
 * feat_html_export_download, needs live Chrome + a Gemini account and cannot
 * run on this VM; it is intentionally NOT modified here).
 */

const test = require('node:test');
const assert = require('node:assert');

const { composeDomainDocument } = require('../src/l3b/compose/composeDomainDocument.js');
const { renderDocumentHtml } = require('../src/l4/format/html/renderHtml.js');

// Mirrors the #636 Tier 2 gate: LaTeX macro followed by <em> means the parser
// shattered a formula (e.g. \hat{H}<em>{JC}, \omega<em>a).
const CORRUPTED_MATH_RE = /\\[a-zA-Z]+<em>[^<]+<\/em>/;

const CASES = [
    '\\sum_{\\langle i, j \\rangle} \\vec{S}_i',
    '|\\Theta_{CW}|/T_N',
    'gemini_test_1790464921_a7b4a079.custom',
    'foo_bar_baz and T_N stay intact',
];

test('full pipeline keeps LaTeX-like underscores and file names intact', async () => {
    const content = CASES.join('\n\n');
    const chat: any = {
        id: 'underscore_regression_001',
        title: 'Underscore regression',
        messages: [{ id: 'm1', role: 'user', content }],
    };
    const { conversation: domain } = await historicalFixture(chat, { providerId: 'gemini' });
    const { html } = renderDocumentHtml(composeDomainDocument(domain, fixtureAccountFor(domain)), {}, { locale: 'zh' });

    for (const c of CASES) {
        assert.ok(html.includes(c), `expected verbatim output to contain ${JSON.stringify(c)}`);
    }
    assert.ok(!CORRUPTED_MATH_RE.test(html), 'no <em> injected into LaTeX macros');
    assert.ok(!html.includes('\\sum<em>'), 'no \\sum<em>');
    assert.ok(!html.includes('\\Theta<em>'), 'no \\Theta<em>');
    assert.ok(!html.includes('gemini<em>'), 'no gemini<em>');
});

test('legit underscore emphasis still renders in HTML', async () => {
    const chat: any = {
        id: 'underscore_regression_002',
        title: 'Underscore legit',
        messages: [{ id: 'm1', role: 'user', content: 'word _italic_ word and __strong__ here' }],
    };
    const { conversation: domain } = await historicalFixture(chat, { providerId: 'gemini' });
    const { html } = renderDocumentHtml(composeDomainDocument(domain, fixtureAccountFor(domain)), {}, { locale: 'zh' });
    assert.ok(html.includes('<em>italic</em>'), 'legit _italic_ renders');
    assert.ok(html.includes('<strong>strong</strong>'), 'legit __strong__ renders');
});
});

__suiteDescribe("table_math_compat", () => {
test('captured Gemini table keeps eight columns and complete absolute-value formulas', () => {
    const original = readFileSync('tests/fixtures/provider/math/gm_md_002_evidence.md', 'utf8');
    const normalized = preprocessGeminiMarkdown(original);
    const table = parseMarkdownAst(normalized).children.find(node => node.type === 'table');
    assert.ok(table?.type === 'table');
    assert.equal(table.children.length, 2);
    assert.ok(table.children.every(row => row.children.length === 8));
    const residual = table.children[0].children[4].children.find(node => node.type === 'inlineMath');
    assert.equal(residual?.type === 'inlineMath' && residual.value, String.raw`\vert{}F(\beta)\vert{}`);
    assert.equal(normalizeTableMathPipes(normalized), normalized);
});
test('table compatibility excludes prose, code, escaped bars, unmatched math and mismatched columns', () => {
    for (const source of [String.raw`Text $|x|$`, '```md\n| $|x|$ | b |\n| --- | --- |\n```',
        '| `$|x|$` | b |\n| --- | --- |', String.raw`| $\|x\|$ | b |`+'\n| --- | --- |',
        '| $|x | b |\n| --- | --- |', '| $|x|$ | b | c |\n| --- | --- |']) {
        assert.equal(normalizeTableMathPipes(source), source);
    }
});






test('Domain and serialized Markdown preserve the captured numeric row and all eight headers', () => {
    const raw = readFileSync('tests/fixtures/provider/math/gm_md_002_evidence.md', 'utf8');
    const blocks = parseMarkdownToBlocks(preprocessGeminiMarkdown(raw), 'live', { sourceRef: { providerId: 'gemini', locator: 'live.5' }, diagnostics: [] });
    const domain: DomainConversationWithDetail = { index: { key: fixtureKey(String('live'), 'gemini'),   titleSource: "derived",   title: 'Live' }, detail: { key: fixtureKey(String('live'), 'gemini'), quality: { status: 'unknown' }, assets: [], messages: [{ id: 'm', role: 'assistant', content: blocks }] } };
    const output = renderDocumentMarkdown(composeDomainDocument(validateParserDomain(domain), fixtureAccountFor(validateParserDomain(domain))), {});
    const table = parseMarkdownAst(output).children.find(node => node.type === 'table');
    assert.ok(table?.type === 'table');
    const content = (node: { value?: string; children?: unknown[] }): string => node.value ?? (node.children ?? []).map(child => content(child as typeof node)).join('');
    assert.deepEqual(table.children[1].children.map(cell => content(cell)), [
        '10^{-4}', 'Bisection', '15', '36.938477', String.raw`3.5 \times 10^{-4}`,
        String.raw`1.9 \times 10^{-4}`, String.raw`1.2 \times 10^{-3}`, String.raw`Rejected (\Delta\Pi > 0.01 u_c)`,
    ]);
    assert.equal(table.children[0].children.length, 8);
    assert.equal(content(table.children[0].children[4]), String.raw`Final Residual \vert{}F(\beta)\vert{}`);
    assert.equal(content(table.children[0].children[5]), String.raw`Numerical Error \vert{}\beta - \beta^*\vert{} [^\circ]`);
});





const liveTables = JSON.parse(readFileSync('tests/fixtures/provider/math/gemini_table_display_math.json', 'utf8')) as { displayTable: unknown; normTable: unknown };
function renderCapturedTable(wire: unknown): { blocks: BlockNode[]; output: string } {
    const node = decodeGeminiStructuredNode(wire);
    assert.ok(node);
    const blocks = geminiStructuredToContent({ children: [node] });
    assert.ok(blocks, 'all native table children must remain supported');
    const domain: DomainConversationWithDetail = { index: { key: fixtureKey(String('captured'), 'gemini'),   titleSource: "derived",   title: 'Captured' }, detail: { key: fixtureKey(String('captured'), 'gemini'), quality: { status: 'unknown' }, assets: [], messages: [{ id: 'm', role: 'assistant', content: blocks }] } };
    return { blocks, output: renderDocumentMarkdown(composeDomainDocument(validateParserDomain(domain), fixtureAccountFor(validateParserDomain(domain))), {}) };
}

test('native display math inside a captured table does not reinterpret neighboring literal TeX', () => {
    const { blocks, output } = renderCapturedTable(liveTables.displayTable);
    const native = blocks[0];
    assert.equal(native.type, 'table');
    if (native.type !== 'table') return;
    assert.ok(native.rows[1].cells[1].children.some(node => node.type === 'inlineMath'
        && node.source === String.raw`Q = \int_{\Psi_{\text{leaf}}}^{\Psi_{\text{soil}}} K(\Psi)\,d\Psi`));
    const table = parseMarkdownAst(output).children.find(node => node.type === 'table');
    assert.ok(table?.type === 'table');
    assert.ok(table.children.every(row => row.children.length === 5));
    const text = (node: { value?: string; children?: unknown[] }): string => node.value ?? (node.children ?? []).map(child => text(child as typeof node)).join('');
    assert.equal(text(table.children[1].children[1]), String.raw`Constant K_{\text{plant}}:$$\Delta\Psi = \frac{E}{K_{\text{plant}}}$$Flow is linearly proportional to the water-potential gradient via Ohm's law analogy.`);
    assert.ok(text(table.children[4].children[1]).includes(String.raw`Q_{\text{in}}!\left`));
});

test('native norm formulas serialize as valid six-column GFM without becoming absolute-value bars', () => {
    const { output } = renderCapturedTable(liveTables.normTable);
    const table = parseMarkdownAst(output).children.find(node => node.type === 'table');
    assert.ok(table?.type === 'table');
    assert.equal(table.children.length, 6);
    assert.ok(table.children.every(row => row.children.length === 6));
    const norm = table.children[0].children[2].children.find(node => node.type === 'inlineMath');
    assert.equal(norm?.type === 'inlineMath' && norm.value, String.raw`\Vert{}\cdot\Vert{}_{\infty}`);
    assert.ok(!output.includes(String.raw`\\|`));
    const cellText = (node: { value?: string; children?: unknown[] }): string =>
        node.value ?? (node.children ?? []).map(child => cellText(child as typeof node)).join('');
    assert.equal(cellText(table.children[1].children[0]), '120.0',
        'the first numeric value must remain in its original table row and column');
    assert.equal(cellText(table.children[5].children[0]), '7.5',
        'the last numeric value must remain in its original table row and column');
});
});

__suiteDescribe("chip_utils", () => {
const test = require('node:test');
const assert = require('node:assert');

const { isInternalChipUrl, stripInternalChipMarkdown } = require('../src/l1/parsers/shared/chipUtils.js');

test('chipUtils - isInternalChipUrl detects all Google internal chip URLs', () => {
    // Both long and short variants
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/deep_research/abc'), true);
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/deep_research_confirmation_content/xyz'), true);
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/map_content/1'), true);
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/map_location/2'), true);
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/map_location_reference/3'), true);
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/web_search/query'), true);
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/web_search_content/query'), true);
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/grounding_content/ref'), true);
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/youtube_content/video'), true);
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/image_generation_content/img'), true);
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/generated_image/art'), true);
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/workspace_content/doc'), true);

    // Negative cases
    assert.strictEqual(isInternalChipUrl(null), false);
    assert.strictEqual(isInternalChipUrl(''), false);
    assert.strictEqual(isInternalChipUrl('https://google.com'), false);
    assert.strictEqual(isInternalChipUrl('https://googleusercontent.com/avatar/profile.jpg'), false);
    assert.strictEqual(isInternalChipUrl('https://example.com/deep_research'), false);
});

test('chipUtils - stripInternalChipMarkdown removes standalone chips and unwraps links', () => {
    const textWithLink = 'Refer to the report: [Deep Research Analysis](https://googleusercontent.com/deep_research/ref123).';
    assert.strictEqual(
        stripInternalChipMarkdown(textWithLink),
        'Refer to the report: Deep Research Analysis.'
    );

    // User-authored external links, including other googleusercontent resources, are not UI chips.
    const legitimateLinks = 'Read [manual](https://example.com/deep_research) and https://googleusercontent.com/avatar/profile.jpg';
    assert.strictEqual(stripInternalChipMarkdown(legitimateLinks), legitimateLinks);

    const textWithStandalone = 'Line 1\nhttps://googleusercontent.com/map_content/loc1\nLine 2';
    assert.strictEqual(
        stripInternalChipMarkdown(textWithStandalone),
        'Line 1\n\nLine 2'
    );

    const textWithBracketed = 'Header\n[https://googleusercontent.com/web_search_content/q1]\nFooter';
    assert.strictEqual(
        stripInternalChipMarkdown(textWithBracketed),
        'Header\n\nFooter'
    );

    const textWithMarkup = [
        'Main content line 1.',
        '<ElicitationsGroup message="想要进一步探索量子计算的相关概念，可以尝试以下方向：">',
        '  <Elicitation label="了解量子退相干物理机制" query="详细解释退相干"/>',
        '  <Elicitation label="对比 Shor 与 Grover" query="对比原理"/>',
        '</ElicitationsGroup>',
        '<FollowUp label="需要支持 async 吗？" query="支持 async"/>',
        '<GenerateWidget id="w1"/>',
        'Main content line 2.',
    ].join('\n');
    const cleaned = stripInternalChipMarkdown(textWithMarkup);
    assert.strictEqual(cleaned.includes('ElicitationsGroup'), false);
    assert.strictEqual(cleaned.includes('Elicitation'), false);
    assert.strictEqual(cleaned.includes('FollowUp'), false);
    assert.strictEqual(cleaned.includes('GenerateWidget'), false);
    assert.ok(cleaned.includes('Main content line 1.'));
    assert.ok(cleaned.includes('Main content line 2.'));
});

test('chipUtils - stripInternalChipMarkdown strips immersive_entry_chip and preserves document content', () => {
    const docWithChip = [
        'http://googleusercontent.com/immersive_entry_chip/0',
        '# 城市供水管网水力建模与参数辨识',
        '',
        '## 1. 理论模型',
        '根据连续性方程与 Hazen-Williams 经验公式：',
        'h_f = 10.67 L Q^{1.852} d^{-4.87} C^{-1.852}'
    ].join('\n');

    const cleaned = stripInternalChipMarkdown(docWithChip).trim();
    assert.strictEqual(cleaned.includes('immersive_entry_chip'), false, 'Should strip immersive_entry_chip');
    assert.strictEqual(cleaned.includes('http://googleusercontent.com'), false, 'Should strip internal googleusercontent URL');
    assert.ok(cleaned.startsWith('# 城市供水管网水力建模与参数辨识'), 'Cleaned text must preserve document title');
    assert.ok(cleaned.includes('Hazen-Williams'), 'Cleaned text must preserve body content');


    const onlyChip = 'http://googleusercontent.com/immersive_entry_chip/0\n';
    assert.strictEqual(stripInternalChipMarkdown(onlyChip).trim(), '', 'Doc with only chip URL should result in empty text');
});

test('chipUtils - internal UI cleanup preserves consecutive blank lines and code indentation', () => {
    const code = '```python\nimport math\n\n\nclass Encoder:\n    def encode(self):\n        return 1\n\n\n\nprint(Encoder().encode())\n```';
    assert.strictEqual(stripInternalChipMarkdown(code), code);
    const answer = `Explanation\nhttps://googleusercontent.com/deep_research/ref123\n\n${code}\n\n\nConclusion`;
    assert.strictEqual(stripInternalChipMarkdown(answer), `Explanation\n\n${code}\n\n\nConclusion`);
});

test('chipUtils - UI-shaped literals in code and escaped text survive cleanup', () => {
    for (const literal of [
        '`<FollowUp label="literal"/>`',
        '```xml\n<ElicitationsGroup>\n<Elicitation query="literal"/>\n</ElicitationsGroup>\n```',
        '~~~text\nhttps://googleusercontent.com/deep_research/literal\n~~~',
        '    <GenerateWidget id="literal"/>',
        '`[report](https://googleusercontent.com/deep_research/literal)`',
        '\\<FollowUp label="literal"/>',
        '<UnknownWidget>Visible content</UnknownWidget>',
        '<FollowUp-extension>Visible content</FollowUp-extension>',
    ]) {
        assert.strictEqual(stripInternalChipMarkdown(literal), literal);
        assert.strictEqual(stripInternalChipMarkdown(literal + '\n\n<FollowUp query="Next"/>'), literal + '\n\n');
    }
});
});

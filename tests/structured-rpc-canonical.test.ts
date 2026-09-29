/**
 * tests/structured-rpc-canonical.test.ts
 *
 * Verification suite for Gemini Structured RPC -> Canonical AST integration.
 * Tests:
 * 1. Structured path is actively used (decision point prioritized over Markdown parser).
 * 2. #705 Divergence cases:
 *    - Display math (multiline and after prose) mapped directly to Canonical math block.
 *    - Table + math pipe ($|\alpha|^2$ and $\|\psi\rangle$) preserving intact cells and math.
 * 3. Real Tier 2 Probe fixtures validation against Canonical schema.
 * 4. Wire JSPB decoding in Gemini parser layer.
 * 5. Fallback semantics:
 *    - Missing structuredContent -> fallback to Markdown parser.
 *    - Unknown nodeType -> fallback to Markdown parser.
 *    - Malformed node / crossing annotations -> fallback to Markdown parser.
 *    - Empty structured doc with non-empty raw markdown -> fallback to Markdown parser.
 * 6. HTML renderer compatibility with Canonical AST from structured path.
 */
export {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
    normalizeGeminiConversation,
    validateBundle,
    validateMessageTree,
    renderCanonicalHtml,
} = require('../src/core/export/canonical/index.js');
const {
    geminiStructuredToCanonical,
    convertGeminiInlines,
} = require('../src/core/export/canonical/gemini/structuredAdapter.js');
const {
    decodeGeminiStructuredPayload,
    extractStructuredContent,
} = require('../src/core/api/parser/structuredContent.js');
const { parseDetail } = require('../src/core/api/parser/parseDetail.js');

const fixturesDir = path.join(__dirname, 'fixtures', 'canonical', 'structured_rpc');

function loadProbeFixture(filename: string): any {
    const fullPath = path.join(fixturesDir, filename);
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

test('Structured path is actively used and bypasses Markdown parser', async () => {
    const conv = {
        id: 'c_structured_test',
        title: 'Structured Test',
        messages: [
            {
                id: 'm1',
                role: 'user',
                content: 'Hello',
            },
            {
                id: 'm2',
                role: 'model',
                content: 'Raw markdown that would parse completely differently: **raw markdown text**',
                structuredContent: {
                    children: [
                        {
                            nodeType: 18,
                            text: 'Authoritative structured text from RPC',
                            annotations: [
                                { start: 14, end: 24, type: 0 }, // "structured" in bold
                            ],
                        },
                        {
                            nodeType: 12,
                            FTa: 'E = mc^2',
                        },
                    ],
                },
            },
        ],
    };

    const { bundle, diagnostics } = await normalizeGeminiConversation(conv as any);
    assert.strictEqual(diagnostics.filter((d: any) => d.severity === 'error').length, 0);

    const modelMsg = bundle.conversation.messages.find((m: any) => m.id === 'm2');
    assert.ok(modelMsg, 'Model message present');

    // Should have 2 blocks: paragraph and math (NOT the raw markdown text)
    assert.strictEqual(modelMsg.blocks.length, 2);
    assert.strictEqual(modelMsg.blocks[0].type, 'paragraph');
    assert.strictEqual(modelMsg.blocks[1].type, 'math');

    // Check paragraph inlines:
    const p = modelMsg.blocks[0];
    const strongInline = p.children.find((c: any) => c.type === 'strong');
    assert.ok(strongInline, 'Strong inline exists from annotation');
    assert.strictEqual(strongInline.children[0].text, 'structured');

    // Check math block:
    const math = modelMsg.blocks[1];
    assert.strictEqual(math.source, 'E = mc^2');
    assert.strictEqual(math.notation, 'latex');

    // Ensure raw markdown string was NOT used
    const allText = JSON.stringify(modelMsg.blocks);
    assert.ok(!allText.includes('raw markdown text'), 'Raw markdown was bypassed');
});

test('#705 Divergence Case: Display Math directly to Canonical math block', async () => {
    const multilineFormula = 'W^{(1)}_{RB}(v) = \\begin{cases}    0 & \\text{若 } v \\in C_{RG} \\\\    W^{(0)}(v) & \\text{若 } v \\notin C_{RG}    \\end{cases}';
    const afterProseFormula = 'A(a, \\lambda) = \\pm 1, \\quad B(b, \\lambda) = \\pm 1';

    const conv = {
        id: 'c_math_test',
        title: 'Math Divergence Test',
        messages: [
            {
                id: 'm1',
                role: 'model',
                content: 'prose before math\n\n' + multilineFormula,
                structuredContent: {
                    children: [
                        {
                            nodeType: 18,
                            text: 'prose before math',
                        },
                        {
                            nodeType: 12,
                            FTa: multilineFormula,
                        },
                        {
                            nodeType: 12,
                            FTa: afterProseFormula,
                        },
                    ],
                },
            },
        ],
    };

    const { bundle } = await normalizeGeminiConversation(conv as any);
    const msg = bundle.conversation.messages[0];
    assert.strictEqual(msg.blocks.length, 3);
    assert.strictEqual(msg.blocks[0].type, 'paragraph');
    assert.strictEqual(msg.blocks[1].type, 'math');
    assert.strictEqual(msg.blocks[2].type, 'math');

    const math1 = msg.blocks[1];
    assert.strictEqual(math1.source, multilineFormula);
    assert.strictEqual(math1.notation, 'latex');

    const math2 = msg.blocks[2];
    assert.strictEqual(math2.source, afterProseFormula);
    assert.strictEqual(math2.notation, 'latex');
});

test('#705 Divergence Case: Table + Math Pipe (|alpha|^2 and ||psi>) cell count and math intact', async () => {
    const tableFixture = loadProbeFixture('table-stack-structured.json');
    const psiTableFixture = loadProbeFixture('psi-table-stack-structured.json');

    // Case C-alpha
    const convAlpha = {
        id: 'c_table_alpha',
        title: 'Table Alpha Test',
        messages: [
            {
                id: 'm1',
                role: 'model',
                content: 'raw table markdown',
                structuredContent: tableFixture,
            },
        ],
    };

    const { bundle: bundleAlpha } = await normalizeGeminiConversation(convAlpha as any);
    const msgAlpha = bundleAlpha.conversation.messages[0];
    const tableBlockAlpha = msgAlpha.blocks.find((b: any) => b.type === 'table');
    assert.ok(tableBlockAlpha, 'Table block exists for Case C-alpha');

    // Header row should have exactly 5 cells
    assert.strictEqual(tableBlockAlpha.headerRows.length, 1);
    assert.strictEqual(tableBlockAlpha.headerRows[0].cells.length, 5);

    // All data rows must have exactly 5 cells
    assert.strictEqual(tableBlockAlpha.rows.length, 4);
    for (let r = 0; r < tableBlockAlpha.rows.length; r++) {
        assert.strictEqual(tableBlockAlpha.rows[r].cells.length, 5, `Row ${r} must have 5 cells`);
    }

    // Verify cell r2c4 contains the alpha^2 math intact
    const cellAlpha = tableBlockAlpha.rows[1].cells[4]; // row 2 in 0-indexed data rows is index 1
    const mathNodeAlpha = cellAlpha.children.find((c: any) => c.type === 'inlineMath' && c.source.includes('\\alpha'));
    assert.ok(mathNodeAlpha, 'InlineMath node found in table cell');
    assert.strictEqual(mathNodeAlpha.source, String.raw`\vert{}\alpha\vert{}^2`);

    // Case C-psi
    const convPsi = {
        id: 'c_table_psi',
        title: 'Table Psi Test',
        messages: [
            {
                id: 'm1',
                role: 'model',
                content: 'raw table psi markdown',
                structuredContent: psiTableFixture,
            },
        ],
    };

    const { bundle: bundlePsi } = await normalizeGeminiConversation(convPsi as any);
    const msgPsi = bundlePsi.conversation.messages[0];
    const tableBlockPsi = msgPsi.blocks.find((b: any) => b.type === 'table');
    assert.ok(tableBlockPsi, 'Table block exists for Case C-psi');

    // Header row should have exactly 3 cells
    assert.strictEqual(tableBlockPsi.headerRows[0].cells.length, 3);
    for (let r = 0; r < tableBlockPsi.rows.length; r++) {
        assert.strictEqual(tableBlockPsi.rows[r].cells.length, 3, `Row ${r} must have 3 cells`);
    }

    // Verify cell r1c2 contains \\Vert{}\\psi\\rangle math intact
    const cellPsi = tableBlockPsi.rows[0].cells[2];
    const mathNodePsi = cellPsi.children.find((c: any) => c.type === 'inlineMath' && c.source.includes('\\Vert{}\\psi'));
    assert.ok(mathNodePsi, 'InlineMath node found in table cell for psi');
    assert.ok(mathNodePsi.source.includes(String.raw`\Vert{}\psi\rangle`), 'Math source contains \\Vert{}\\psi\\rangle');
});

test('Real Tier 2 probe data: full documents validate cleanly against Canonical schema', async () => {
    const aStack = loadProbeFixture('a-stack-structured.json');
    const bStack = loadProbeFixture('b-stack-structured.json');

    // Case A: 50 root nodes
    assert.strictEqual(aStack.children.length, 50);
    const convA = {
        id: 'c_probe_a',
        title: 'Case A Multiline Display',
        messages: [{ id: 'm1', role: 'model', content: 'raw', structuredContent: aStack }],
    };
    const resA = await normalizeGeminiConversation(convA as any);
    const bundleErrorsA = validateBundle(resA.bundle).filter((d: any) => d.severity === 'error');
    assert.strictEqual(bundleErrorsA.length, 0, 'Case A bundle has no error diagnostics');
    const treeIssuesA = validateMessageTree(resA.bundle.conversation);
    assert.strictEqual(treeIssuesA.length, 0, 'Case A message tree is valid');

    // Case B: 49 root nodes
    assert.strictEqual(bStack.children.length, 49);
    const convB = {
        id: 'c_probe_b',
        title: 'Case B Display After Text',
        messages: [{ id: 'm1', role: 'model', content: 'raw', structuredContent: bStack }],
    };
    const resB = await normalizeGeminiConversation(convB as any);
    const bundleErrorsB = validateBundle(resB.bundle).filter((d: any) => d.severity === 'error');
    assert.strictEqual(bundleErrorsB.length, 0, 'Case B bundle has no error diagnostics');
    const treeIssuesB = validateMessageTree(resB.bundle.conversation);
    assert.strictEqual(treeIssuesB.length, 0, 'Case B message tree is valid');
});

test('Wire JSPB decoding in Gemini parser layer', () => {
    // Construct wire JSPB node for display math: field 34
    const wireMathNode = new Array(35).fill(null);
    wireMathNode[34] = ['\\sum_{i=1}^n i = \\frac{n(n+1)}{2}'];

    // Construct wire JSPB node for paragraph with inline math annotation
    const wireTextNode = [
        null,
        [null, 0, 'The formula is \\alpha + \\beta', [[15, 30, [null, null, []]]]],
    ];

    // Construct wire JSPB node for code block
    const wireCodeNode = [null, null, null, ['console.log(42);', 'typescript']];

    const wirePayload = [[[wireTextNode, wireMathNode, wireCodeNode]]];

    const decoded = decodeGeminiStructuredPayload(wirePayload);
    assert.ok(decoded, 'Decoded structured document');
    assert.strictEqual(decoded.children.length, 3);
    assert.strictEqual(decoded.children[0].nodeType, 18);
    assert.strictEqual(decoded.children[1].nodeType, 12);
    assert.strictEqual((decoded.children[1] as any).FTa, '\\sum_{i=1}^n i = \\frac{n(n+1)}{2}');
    assert.strictEqual(decoded.children[2].nodeType, 1);
    assert.strictEqual((decoded.children[2] as any).code, 'console.log(42);');
    assert.strictEqual((decoded.children[2] as any).info, 'typescript');

    // Test extractStructuredContent from turn
    const mockTurn = [
        'r_123',
        [1700000000, 0],
        [['User question']],
        [[['rc_ans', [null, ['Answer text']]]], null, null, null, null, null, null, null, null, null, null, null, wirePayload],
    ];

    const extracted = extractStructuredContent(mockTurn);
    assert.ok(extracted, 'Extracted structured document from turn');
    assert.strictEqual(extracted.children.length, 3);
});

test('Fallback: missing structuredContent falls back to existing Markdown parser', async () => {
    const conv = {
        id: 'c_fallback_missing',
        title: 'Fallback Missing Test',
        messages: [
            {
                id: 'm1',
                role: 'model',
                content: '# Header\n\nParagraph with **bold** text and `inline code`.',
            },
        ],
    };

    const { bundle } = await normalizeGeminiConversation(conv as any);
    const msg = bundle.conversation.messages[0];
    assert.strictEqual(msg.blocks.length, 2);
    assert.strictEqual(msg.blocks[0].type, 'heading');
    assert.strictEqual(msg.blocks[1].type, 'paragraph');

    const strong = msg.blocks[1].children.find((c: any) => c.type === 'strong');
    assert.ok(strong, 'Markdown parser bold succeeded');
});

test('Fallback: unknown nodeType triggers complete fallback to Markdown parser', async () => {
    const conv = {
        id: 'c_fallback_unknown',
        title: 'Fallback Unknown Test',
        messages: [
            {
                id: 'm1',
                role: 'model',
                content: 'Fallback to markdown text when structured has unknown nodeType.',
                structuredContent: {
                    children: [
                        { nodeType: 18, text: 'Normal text' },
                        { nodeType: 9999, weirdField: 'unknown' }, // Unknown nodeType!
                    ],
                },
            },
        ],
    };

    const { bundle } = await normalizeGeminiConversation(conv as any);
    const msg = bundle.conversation.messages[0];
    assert.strictEqual(msg.blocks.length, 1);
    assert.strictEqual(msg.blocks[0].type, 'paragraph');
    assert.strictEqual(msg.blocks[0].children[0].text, 'Fallback to markdown text when structured has unknown nodeType.');
});

test('Fallback: crossing overlap annotations trigger fallback to Markdown parser', async () => {
    const conv = {
        id: 'c_fallback_overlap',
        title: 'Fallback Overlap Test',
        messages: [
            {
                id: 'm1',
                role: 'model',
                content: 'Fallback text on crossing overlap.',
                structuredContent: {
                    children: [
                        {
                            nodeType: 18,
                            text: 'ABCDEFGHIJ',
                            annotations: [
                                { start: 0, end: 6, type: 0 }, // 0..6
                                { start: 3, end: 9, type: 2 }, // 3..9 (crosses 0..6!)
                            ],
                        },
                    ],
                },
            },
        ],
    };

    const { bundle } = await normalizeGeminiConversation(conv as any);
    const msg = bundle.conversation.messages[0];
    assert.strictEqual(msg.blocks.length, 1);
    assert.strictEqual(msg.blocks[0].children[0].text, 'Fallback text on crossing overlap.');
});

test('Fallback: empty structured document with non-empty raw markdown triggers fallback', async () => {
    const conv = {
        id: 'c_fallback_empty',
        title: 'Fallback Empty Test',
        messages: [
            {
                id: 'm1',
                role: 'model',
                content: 'Non-empty raw markdown should not be lost if structured is empty.',
                structuredContent: {
                    children: [],
                },
            },
        ],
    };

    const { bundle } = await normalizeGeminiConversation(conv as any);
    const msg = bundle.conversation.messages[0];
    assert.strictEqual(msg.blocks.length, 1);
    assert.strictEqual(msg.blocks[0].children[0].text, 'Non-empty raw markdown should not be lost if structured is empty.');
});

test('Generic HTML renderer renders Canonical AST from structured path cleanly', async () => {
    const conv = {
        id: 'c_html_compat',
        title: 'HTML Compat Test',
        messages: [
            {
                id: 'm1',
                role: 'model',
                content: 'raw',
                structuredContent: {
                    children: [
                        { nodeType: 18, text: 'Heading 2 Title', jJ: 2 },
                        { nodeType: 18, text: 'Paragraph with math ', annotations: [{ start: 10, end: 14, type: 4 }] },
                        { nodeType: 12, FTa: '\\int_0^1 f(x) dx' },
                        { nodeType: 1, code: 'print("hello")', info: 'python' },
                        {
                            nodeType: 20,
                            items: [
                                { children: [{ nodeType: 18, text: 'Item 1' }] },
                                { children: [{ nodeType: 18, text: 'Item 2' }] },
                            ],
                        },
                    ],
                },
            },
        ],
    };

    const { bundle } = await normalizeGeminiConversation(conv as any);
    const { html } = renderCanonicalHtml(bundle);
    assert.ok(html.includes('<h2'), 'Heading 2 rendered');
    assert.ok(html.includes('Heading 2 Title'), 'Heading text rendered');
    assert.ok(html.includes('language-python'), 'Code block rendered with language');
    assert.ok(html.includes('print(&quot;hello&quot;)'), 'Code rendered');
    assert.ok(html.includes('<ul'), 'Unordered list rendered');
    assert.ok(html.includes('<li>'), 'List item rendered');
});

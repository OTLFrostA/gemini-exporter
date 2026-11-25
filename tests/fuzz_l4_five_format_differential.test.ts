import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { validateParserDomain } from '../src/l2/runtimeValidation.js';
import { composeDomainDocument } from '../src/l3b/compose/composeDomainDocument.js';
import { renderDocumentMarkdown } from '../src/l4/format/markdown/renderMarkdown.js';
import { renderDocumentHtml } from '../src/l4/format/html/renderHtml.js';
import { serializeDomainJson, JSON_ARCHIVE_VERSION } from '../src/l4/format/json/serializeDomainJson.js';
import { renderDocumentDocx } from '../src/l4/format/docx/renderDocx.js';
import { renderDocumentTypstCore } from '../src/l4/format/typst/renderTypstCore.js';
import type { Account } from '../src/l2/accountRegistry.js';
import type { DomainConversationWithDetail } from '../src/l2/conversation.js';
import type { BlockNode } from '../src/l2/content/blocks.js';
import type { InlineNode } from '../src/l2/content/inline.js';

const JSZip = require('../lib/jszip.min.js');
const SEED = 20261124;

const ACCOUNT: Account = {
    id: '10000000-0000-4000-8000-000000000001',
    providerId: 'gemini',
    providerAccountId: 'fuzz-account',
};
const CONV_KEY = { accountId: ACCOUNT.id, conversationId: 'fuzz-export-conv' };

const safeTextArb = fc.oneof(
    fc.stringMatching(/^[A-Za-z0-9]{4,14}$/),
    fc.constantFrom(
        'alpha <script>alert(1)</script> beta',
        'price $100 and #heading *bold* _italic_',
        'pipe | cell & ampersand "quote"',
        '中文内容 🚀 日本語テスト',
    ),
);

const leafInlineArb: fc.Arbitrary<InlineNode> = fc.oneof(
    safeTextArb.map(text => ({ type: 'text' as const, text })),
    fc.stringMatching(/^[a-z0-9_]{2,12}$/).map(code => ({ type: 'inlineCode' as const, code })),
    fc.constantFrom('x^2 + y^2', '\\frac{a}{b}', '\\alpha + \\beta').map(source => ({ type: 'inlineMath' as const, source })),
    fc.tuple(
        fc.constantFrom('https://example.test/doc', 'javascript:alert(1)', 'https://example.test/?a=1&b=2'),
        fc.stringMatching(/^[A-Za-z0-9]{3,10}$/),
    ).map(([href, label]) => ({
        type: 'link' as const,
        href,
        children: [{ type: 'text' as const, text: label }],
    })),
);

const inlineArb: fc.Arbitrary<InlineNode> = fc.oneof(
    leafInlineArb,
    fc.tuple(
        fc.constantFrom<'strong' | 'emphasis' | 'strikethrough'>('strong', 'emphasis', 'strikethrough'),
        fc.array(leafInlineArb, { minLength: 1, maxLength: 2 }),
    ).map(([type, children]) => ({ type, children })),
);

const simpleBlockArb: fc.Arbitrary<BlockNode> = fc.oneof(
    fc.array(inlineArb, { minLength: 1, maxLength: 3 }).map(children => ({ type: 'paragraph' as const, children })),
    fc.tuple(
        fc.constantFrom<1 | 2 | 3 | 4 | 5 | 6>(1, 2, 3, 4, 5, 6),
        fc.array(leafInlineArb, { minLength: 1, maxLength: 2 }),
    ).map(([level, children]) => ({ type: 'heading' as const, level, children })),
    fc.tuple(
        fc.constantFrom('ts', 'python', 'html', ''),
        fc.constantFrom('const x = 1 < 2;\n```nested```', 'def f():\n    return "#typst"', '<script>x</script>'),
    ).map(([language, code]) => ({
        type: 'code' as const,
        code,
        ...(language ? { language } : {}),
    })),
    fc.constantFrom('E = mc^2', '\\int_0^1 x^2 dx = \\frac{1}{3}').map(source => ({ type: 'math' as const, source })),
    fc.constant({ type: 'thematicBreak' as const }),
    fc.tuple(
        fc.array(fc.array(leafInlineArb, { minLength: 1, maxLength: 2 }), { minLength: 1, maxLength: 3 }),
        fc.array(fc.array(leafInlineArb, { minLength: 1, maxLength: 2 }), { minLength: 1, maxLength: 3 }),
    ).map(([headerCells, bodyCells]) => ({
        type: 'table' as const,
        headerRows: [{ cells: headerCells.map(children => ({ children })) }],
        rows: [{ cells: bodyCells.map(children => ({ children })) }],
    })),
);

const blockArb: fc.Arbitrary<BlockNode> = fc.oneof(
    simpleBlockArb,
    fc.tuple(
        fc.boolean(),
        fc.array(fc.array(simpleBlockArb, { minLength: 1, maxLength: 2 }), { minLength: 1, maxLength: 3 }),
    ).map(([ordered, items]) => ({
        type: 'list' as const,
        ordered,
        items: items.map(blocks => ({ blocks })),
    })),
    fc.array(simpleBlockArb, { minLength: 1, maxLength: 2 }).map(blocks => ({ type: 'quote' as const, blocks })),
);

test('fuzz: arbitrary valid Domain ASTs render across Markdown, HTML, JSON, DOCX, and Typst without crash or injection', async () => {
    const convArb = fc.record({
        title: fc.stringMatching(/^[A-Za-z0-9]{3,16}$/),
        sentinel: fc.stringMatching(/^SENTINEL[0-9]{6}$/),
        blocks: fc.array(blockArb, { minLength: 1, maxLength: 4 }),
        withReasoning: fc.boolean(),
    });

    await fc.assert(
        fc.asyncProperty(convArb, async ({ title, sentinel, blocks, withReasoning }) => {
            const raw: DomainConversationWithDetail = {
                index: { key: CONV_KEY, title, titleSource: 'provider', updatedAt: 1700000000000 },
                detail: {
                    key: CONV_KEY,
                    savedAt: 1700000000000,
                    quality: { status: 'complete' },
                    assets: [],
                    messages: [
                        {
                            role: 'user',
                            content: [{ type: 'paragraph', children: [{ type: 'text', text: `Prompt ${sentinel}` }] }],
                        },
                        {
                            role: 'assistant',
                            ...(withReasoning ? { reasoning: [{ type: 'paragraph', children: [{ type: 'text', text: 'Thought step' }] }] } : {}),
                            content: [
                                ...blocks,
                                { type: 'paragraph', children: [{ type: 'text', text: `Answer ${sentinel}` }] },
                            ],
                            citations: [{ id: 'c1', url: 'https://example.test/ref', title: 'Ref' }],
                        },
                    ],
                },
            };

            const trusted = validateParserDomain(raw);
            const document = composeDomainDocument(trusted, ACCOUNT);

            // 1. Markdown
            const md = renderDocumentMarkdown(document, {});
            assert.ok(md.includes(sentinel), 'Markdown must preserve prose sentinel');

            // 2. HTML (and verify no raw <script> or javascript: href injection)
            const { html } = renderDocumentHtml(document, {});
            assert.ok(html.includes(sentinel), 'HTML must preserve prose sentinel');
            assert.ok(!/<script>alert\(1\)<\/script>/i.test(html), 'HTML must escape raw <script> tags');
            assert.ok(!/href="javascript:/i.test(html), 'HTML must sanitize javascript: links');

            // 3. JSON
            const jsonText = serializeDomainJson(trusted, ACCOUNT, {});
            const parsedJson = JSON.parse(jsonText);
            assert.equal(parsedJson.format, 'gemini-exporter-domain');
            assert.equal(parsedJson.version, JSON_ARCHIVE_VERSION);
            assert.ok(jsonText.includes(sentinel), 'JSON must preserve prose sentinel');

            // 4. Typst IR
            const typst = renderDocumentTypstCore(document, {}, { locale: 'en' });
            assert.equal(typst.messages.length, 2);
            assert.ok(JSON.stringify(typst).includes(sentinel), 'Typst IR must preserve prose sentinel');

            // 5. DOCX binary archive
            const docxBytes = await renderDocumentDocx(document, {}, new Map());
            assert.deepEqual(Array.from(docxBytes.subarray(0, 4)), [0x50, 0x4b, 0x03, 0x04], 'DOCX must be a valid ZIP archive');
            const zip = await JSZip.loadAsync(docxBytes);
            const docXml = await zip.file('word/document.xml')?.async('string');
            assert.ok(docXml && docXml.includes(sentinel), 'DOCX word/document.xml must preserve prose sentinel');
        }),
        { seed: SEED, numRuns: 35 },
    );
});

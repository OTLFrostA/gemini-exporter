import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGeminiRpcConversation } from '../src/l1/parsers/gemini/rpc/parseConversation.js';
import { composeDomainDocument } from '../src/l3b/compose/composeDomainDocument.js';
import { renderDocumentMarkdown } from '../src/l4/format/markdown/renderMarkdown.js';
import { assertDomainClosure } from '../src/l2/closure.js';
import { validateParserDomain } from '../src/l2/runtimeValidation.js';
import { detailGen } from './fixtures/providers/geminiDetail.js';
import { fixtureAccount, fixtureKey } from './helpers/domainFixture.js';
import { decodeGeminiStructuredNode } from '../src/l1/parsers/gemini/rpc/structuredContent.js';
import { citationField } from './fixtures/providers/gemini/detail/content.js';
import { citation, fileSource } from './fixtures/providers/gemini/detail/nativeCitationCases.js';

test('native strikethrough annotations preserve their exact text range', () => {
    const result = parseGeminiRpcConversation(detailGen('G_NATIVE_DOCUMENT_STRIKETHROUGH'), { account: fixtureAccount('gemini'), providerId: 'gemini' });
    assert.ok(!result.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK'));
    assert.deepEqual(result.conversation.detail.messages[1].content, [{ type: 'paragraph', children: [
        { type: 'text', text: 'Keep ' }, { type: 'strikethrough', children: [{ type: 'text', text: 'old' }] },
        { type: 'text', text: ' new.' },
    ] }]);
});

test('empty native blockquotes introduce no visible quotation or invented body text', () => {
    const result = parseGeminiRpcConversation(detailGen('G_NATIVE_DOCUMENT_EMPTY_QUOTES'), { account: fixtureAccount('gemini'), providerId: 'gemini' });
    assert.ok(!result.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK'));
    assert.deepEqual(result.conversation.detail.messages[1].content, [
        { type: 'paragraph', children: [{ type: 'text', text: 'Before.' }] },
        { type: 'paragraph', children: [{ type: 'text', text: 'After.' }] },
    ]);
});

test('an empty structured body cannot erase a nonempty independent Markdown response', () => {
    for (const key of ['G_STRUCTURED_CITATIONS_05', 'G_STRUCTURED_CITATIONS_06'] as const) {
        const result = parseGeminiRpcConversation(detailGen(key), { account: fixtureAccount('gemini'), providerId: 'gemini' });
        assert.ok(result.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK'
            && d.details && typeof d.details === 'object' && !Array.isArray(d.details)
            && d.details.reason === 'adapter_rejected'), key);
        assert.deepEqual(result.conversation.detail.messages[1].content, [
            { type: 'paragraph', children: [{ type: 'text', text: 'UNRELATED_MARKDOWN_SENTINEL' }] },
        ]);
    }
});

test('citation quote metadata is validated independently from the source identity', () => {
    const result = parseGeminiRpcConversation(detailGen('G_NATIVE_CITATION_QUOTE_METADATA'), { account: fixtureAccount('gemini'), providerId: 'gemini' });
    assert.ok(!result.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK'));
    assert.deepEqual(result.conversation.detail.messages[1].citations, [{ id: 'grounding-1', title: 'example.txt' }]);
    for (const metadata of [0, 1, 7, 128]) {
        const reference = citation([fileSource()]);
        reference[2] = ['Quoted source text', metadata];
        assert.deepEqual(decodeGeminiStructuredNode(citationField(31, [reference])), { nodeType: 'citation', number: 1, title: 'example.txt' });
    }
    for (const metadata of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
        const reference = citation([fileSource()]);
        reference[2] = ['Quoted source text', metadata];
        assert.equal(decodeGeminiStructuredNode(citationField(31, [reference])), null);
    }
});

test('the historical heading-only composite preserves its declared block type', () => {
    const result = parseGeminiRpcConversation(detailGen('G_STRUCTURED_CITATIONS_24'), { account: fixtureAccount('gemini'), providerId: 'gemini' });
    assert.ok(!result.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK'));
    assert.deepEqual(result.conversation.detail.messages[1].content, [{ type: 'heading', level: 2, children: [{ type: 'text', text: 'heading' }] }]);
});

test('composite native headings retain all six levels and their linked citations', () => {
    const account = fixtureAccount('gemini');
    const result = parseGeminiRpcConversation(detailGen('G_NATIVE_CITATION_HEADING_LEVELS'), { account, providerId: 'gemini' });
    assert.ok(!result.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK'));
    assert.deepEqual(result.conversation.detail.messages[1].content, Array.from({ length: 6 }, (_, index) => ({
        type: 'heading', level: index + 1, children: [
            { type: 'text', text: `Heading ${index + 1}.` }, { type: 'citationRef', citationId: 'citation-0' },
        ],
    })));
    assertDomainClosure(result.conversation.detail);
    const key = fixtureKey(result.conversationId, 'gemini');
    const domain = validateParserDomain({ index: { ...result.conversation.index, key }, detail: { ...result.conversation.detail, key } });
    const markdown = renderDocumentMarkdown(composeDomainDocument(domain, account), {});
    for (let level = 1; level <= 6; level++) assert.ok(markdown.includes(`${'#'.repeat(level)} Heading ${level}.`));
    assert.ok(markdown.includes('](https://example.com/source)'));
});

test('compound and nested heading references retain one source identity', () => {
    for (const key of ['G_NATIVE_CITATION_HEADING_COMPOUND', 'G_NATIVE_CITATION_HEADING_NESTED'] as const) {
        const result = parseGeminiRpcConversation(detailGen(key), { account: fixtureAccount('gemini'), providerId: 'gemini' });
        assert.ok(!result.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK'), key);
        assert.deepEqual(result.conversation.detail.messages[1].content, [{ type: 'heading', level: 4, children: [
            { type: 'text', text: 'A heading.' }, { type: 'citationRef', citationId: 'citation-0' },
        ] }]);
        assertDomainClosure(result.conversation.detail);
    }
});

test('a composite heading preserves visible web citations and hidden file-source facts', () => {
    const result = parseGeminiRpcConversation(detailGen('G_NATIVE_CITATION_HEADING_MIXED_SOURCES'), { account: fixtureAccount('gemini'), providerId: 'gemini' });
    assert.ok(!result.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK'));
    assert.deepEqual(result.conversation.detail.messages[1].content, [{ type: 'heading', level: 4, children: [
        { type: 'text', text: 'A heading.' }, { type: 'citationRef', citationId: 'citation-0' },
    ] }]);
    assert.deepEqual(result.conversation.detail.messages[1].citations, [
        { id: 'citation-0', title: 'Example source', url: 'https://example.com/source' },
        { id: 'grounding-1', title: 'example.txt' },
    ]);
    assertDomainClosure(result.conversation.detail);
});

test('mixed block kinds and table-cell headings still explicitly fall back with complete authored content', () => {
    for (const key of ['G_NATIVE_CITATION_HEADING_MIXED_LEVELS', 'G_NATIVE_CITATION_HEADING_MIXED_PARAGRAPH',
        'G_NATIVE_CITATION_HEADING_TABLE', 'G_NATIVE_CITATION_HEADING_BLOCK_CHILD'] as const) {
        const context = { account: fixtureAccount('gemini'), providerId: 'gemini' as const };
        const wire = detailGen(key);
        const result = parseGeminiRpcConversation(wire, context);
        assert.ok(result.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK'
            && d.details && typeof d.details === 'object' && !Array.isArray(d.details)
            && d.details.reason === 'adapter_rejected'), key);
        const markdown = parseGeminiRpcConversation(wire, { ...context, bodyRepresentation: 'markdown' });
        assert.deepEqual(result.conversation.detail.messages[1].content, markdown.conversation.detail.messages[1].content);
        assertDomainClosure(result.conversation.detail);
    }
});

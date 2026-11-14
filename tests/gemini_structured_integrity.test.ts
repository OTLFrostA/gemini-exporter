import test from 'node:test';
import assert from 'node:assert/strict';
import { detailGen } from './fixtures/providers/geminiDetail.js';
import { malformedNativeNodes, ambiguousNativeNodes } from './fixtures/providers/gemini/detail/nativeIntegrityCases.js';
import { citationField } from './fixtures/providers/gemini/detail/content.js';
import { fixtureAccount, fixtureKey } from './helpers/domainFixture.js';
import { parseGeminiRpcConversation } from '../src/l1/parsers/gemini/rpc/parseConversation.js';
import { mergeConversationPages } from '../src/l1/parsers/gemini/rpc/mergePages.js';
import { decodeGeminiStructuredNode, type GeminiStructuredDecodeIssue } from '../src/l1/parsers/gemini/rpc/structuredContent.js';
import { convertGeminiInlines } from '../src/l1/parsers/gemini/shared/structuredContentAdapter.js';
import { validateParserDomain } from '../src/l2/runtimeValidation.js';
import { composeDomainDocument } from '../src/l3b/compose/composeDomainDocument.js';
import { renderDocumentMarkdown } from '../src/l4/format/markdown/renderMarkdown.js';

const account = fixtureAccount('gemini');
const parse = (key: Parameters<typeof detailGen>[0]) => parseGeminiRpcConversation(detailGen(key), { account, providerId: 'gemini' });

for (const key of ['G_NATIVE_INTEGRITY_UNKNOWN_NEIGHBOR', 'G_NATIVE_INTEGRITY_BAD_FORMAT_RANGE',
    'G_NATIVE_INTEGRITY_BAD_SOURCE_RANGE', 'G_NATIVE_INTEGRITY_MALFORMED', 'G_NATIVE_INTEGRITY_AMBIGUOUS'] as const) {
    test(`${key}: exhaustive pagination cannot certify rejected native content`, () => {
        const page = parse(key);
        // Include pagination_pending: it must not mask an independent body failure.
        const pending = { ...page, evidence: { ...page.evidence, truncation: 'pagination_pending' } };
        const merged = mergeConversationPages([pending], undefined, true);
        assert.ok(page.diagnostics.some(d => (d.code === 'GEMINI_STRUCTURED_FALLBACK' || d.code === 'GEMINI_SOURCE_ANNOTATION_FALLBACK') && d.severity === 'warning'));
        assert.equal(merged.sourceVersion, 1700000000000);
        assert.equal(merged.conversation.detail.quality.status, 'partial');
        const domainKey = fixtureKey(merged.conversationId);
        const domain = validateParserDomain({ index: { ...merged.conversation.index, key: domainKey },
            detail: { ...merged.conversation.detail, key: domainKey } });
        const markdown = renderDocumentMarkdown(composeDomainDocument(domain, account), {});
        if (key === 'G_NATIVE_INTEGRITY_UNKNOWN_NEIGHBOR') {
            assert.ok(markdown.includes('Introduction.') && markdown.includes('Conclusion.'));
            assert.ok(!markdown.includes('PLAN_TITLE_ONLY_IN_NATIVE'));
            assert.ok(!markdown.includes('PLAN_DESCRIPTION_ONLY_IN_NATIVE'));
        }
    });
}

for (const key of ['G_NATIVE_INTEGRITY_MARKDOWN_ONLY', 'G_NATIVE_INTEGRITY_KNOWN', 'G_NATIVE_INTEGRITY_PLAN'] as const) {
    test(`${key}: valid native and authoritative Markdown-only bodies remain complete`, () => {
        const merged = mergeConversationPages([parse(key)], undefined, true);
        assert.equal(merged.conversation.detail.quality.status, 'complete');
        assert.ok(!merged.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK' && d.severity === 'warning'));
    });
}

test('malformed payloads and unexplained sibling content cannot decode to successful empty nodes', () => {
    for (const raw of [...malformedNativeNodes, ...ambiguousNativeNodes]) {
        const issues: GeminiStructuredDecodeIssue[] = [];
        assert.equal(decodeGeminiStructuredNode(raw, issues), null, JSON.stringify(raw));
        assert.equal(issues.length, 1);
        assert.equal(issues[0].kind, 'node');
        assert.deepEqual(issues[0].rawValue, raw);
    }
});

test('explicitly empty payloads remain distinct from malformed payloads', () => {
    for (const [field, payload, expected] of [
        [1, [null, 0, '', []], { nodeType: 18, text: '' }],
        [3, ['', 'python'], { nodeType: 1, code: '', info: 'python' }],
        [10, [[]], { nodeType: 17, rows: [] }],
        [10, [], { nodeType: 17, rows: [] }],
        [11, [[]], { nodeType: 20, items: [] }],
        [11, [], { nodeType: 20, items: [] }],
        [12, [[], 4], { nodeType: 14, items: [], VHa: 4 }],
        [12, [], { nodeType: 14, items: [], VHa: 1 }],
        [15, [[]], { nodeType: 15, children: [] }],
        [16, [], { nodeType: 15, children: [] }],
        [34, [''], { nodeType: 12, FTa: '' }],
    ] as const) assert.deepEqual(decodeGeminiStructuredNode(citationField(field, payload)), expected);
});

test('every annotation kind rejects UTF-16 boundaries inside emoji and preserves valid nested spans', () => {
    for (const type of [0, 2, 4, 5, 7, 12] as const) {
        for (const [start, end] of [[1, 2], [0, 1], [1, 1]]) {
            assert.equal(convertGeminiInlines('😀x', [{ start, end, type }]), null);
        }
        assert.notEqual(convertGeminiInlines('😀x', [{ start: 0, end: 2, type }]), null);
    }
    assert.equal(convertGeminiInlines('😀x', [{ start: 1, end: 2, type: 6, url: 'https://example.com' }]), null);
    assert.deepEqual(convertGeminiInlines('😀x', [{ start: 0, end: 3, type: 0 }, { start: 0, end: 2, type: 2 }]), [
        { type: 'strong', children: [{ type: 'emphasis', children: [{ type: 'text', text: '😀' }] }, { type: 'text', text: 'x' }] },
    ]);
});

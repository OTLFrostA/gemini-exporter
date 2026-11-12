import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeGeminiStructuredPayload } from '../src/l1/parsers/gemini/rpc/structuredContent.js';
import { convertGeminiInlines, geminiStructuredToContent } from '../src/l1/parsers/gemini/shared/structuredContentAdapter.js';
import type { GeminiAnnotation, GeminiStructuredDocument } from '../src/l1/parsers/gemini/rpc/structuredContent.js';
import { parseGeminiRpcConversation } from '../src/l1/parsers/gemini/rpc/parseConversation.js';
import { fixtureAccount } from './helpers/domainFixture.js';
import { citationWire, citationField, citationText } from './fixtures/providers/gemini/detail/content.js';
import { assertDomainClosure } from '../src/l2/closure.js';

// Shape-only reproductions of the local 2.1.1 diagnostic report; no private
// conversation text, account IDs, mail links or attachment tokens are retained.
const sources = new Map([
    ['spp_first', [{ id: 'first', url: 'https://example.com/first' }]],
    ['spp_second', [{ id: 'second', url: 'https://example.com/second' }]],
]);
const source = (start: number, end: number, id = 'spp_first'): GeminiAnnotation =>
    ({ start, end, type: 'source', sourceIds: [id] });

test('composite paragraphs and table cells accept resource-owned attachment nodes', () => {
    const paragraph: GeminiStructuredDocument = { children: [{ nodeType: 'paragraph', children: [
        { nodeType: 18, text: 'An illustration follows. ' }, { nodeType: 0 },
    ] }] };
    assert.deepEqual(geminiStructuredToContent(paragraph), [{ type: 'paragraph', children: [
        { type: 'text', text: 'An illustration follows. ' },
    ] }]);
    const table: GeminiStructuredDocument = { children: [{ nodeType: 17, rows: [{ cells: [
        { children: paragraph.children },
    ] }] }] };
    assert.notEqual(geminiStructuredToContent(table), null);
    assert.equal(geminiStructuredToContent({ children: [{ nodeType: 'paragraph', children: [
        { nodeType: 1, code: 'unsupported block inside an inline paragraph' },
    ] }] }), null);
});

test('crossing source ranges retain both references and original Unicode text', () => {
    assert.deepEqual(convertGeminiInlines('😀abcd', [source(0, 4), source(2, 6, 'spp_second')], sources), [
        { type: 'text', text: '😀ab' }, { type: 'citationRef', citationId: 'first' },
        { type: 'text', text: 'cd' }, { type: 'citationRef', citationId: 'second' },
    ]);
});

test('citations preserve formatting at equal endpoints and leave math atomic', () => {
    assert.deepEqual(convertGeminiInlines('abc', [source(0, 3), { start: 0, end: 3, type: 0 }], sources), [
        { type: 'strong', children: [{ type: 'text', text: 'abc' }] },
        { type: 'citationRef', citationId: 'first' },
    ]);
    assert.deepEqual(convertGeminiInlines('x+y', [{ start: 0, end: 3, type: 4 }, source(0, 2)], sources), [
        { type: 'inlineMath', source: 'x+y' }, { type: 'citationRef', citationId: 'first' },
    ]);
});

test('invalid source bounds, unresolved sources and crossing formatting still reject', () => {
    for (const annotation of [source(0, 4), source(-1, 2), source(2, 1), source(0, 1, 'spp_missing')]) {
        assert.equal(convertGeminiInlines('abc', [annotation], sources), null);
    }
    assert.equal(convertGeminiInlines('abcd', [{ start: 0, end: 3, type: 0 }, { start: 2, end: 4, type: 5 }]), null);
    assert.equal(convertGeminiInlines('😀abc', [source(0, 1)], sources), null);
});

test('captured file-reference marker and excerpt variants retain source identity', () => {
    const file = [[null, 0, 'example.txt', null, null, null, null, null, 1, null, null, 'text/plain'],
        null, null, null, null, null, 'example.txt'];
    const citation = [['[cite: 1]', 0], [[null, file, 'Quoted source excerpt']], ['body excerpt', 0], ['[cite_start]', 0]];
    const field = Object.assign(Array(32).fill(null), { 31: [citation] });
    assert.deepEqual(decodeGeminiStructuredPayload([[[field]]]), { children: [
        { nodeType: 'citation', number: 1, title: 'example.txt' },
    ] });
    citation[3] = ['unknown marker', 0];
    assert.equal(decodeGeminiStructuredPayload([[[field]]]), null);
});

test('Workspace references bind their own URLs through RPC parsing and Domain closure', () => {
    const metadata = [[1], 'https://mail.google.com/mail/u/0/#all/example', 'Example source', ['example'],
        'Source date', 'Source author', [1700000000], [], 'opaque-token', null, null, 4];
    const citation = [['[cite: 1]', 0], [[metadata]], ['quoted source text', 0], ['[cite_start]', 0]];
    const body = [[[citationText('A supported claim. '), citationField(31, [citation])]]];
    const result = parseGeminiRpcConversation(citationWire(body), { account: fixtureAccount('gemini'), providerId: 'gemini' });
    assert.ok(!result.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK'));
    assertDomainClosure(result.conversation.detail);
    const message = result.conversation.detail.messages[1];
    assert.deepEqual(message.citations, [{ id: 'citation-0', url: metadata[1], title: 'Example source' }]);
    assert.deepEqual(message.content[0], { type: 'paragraph', children: [
        { type: 'text', text: 'A supported claim. ' }, { type: 'citationRef', citationId: 'citation-0' },
    ] });
    assert.ok(!JSON.stringify(result.conversation.detail).includes('opaque-token'));
    metadata[1] = 'javascript:invalid';
    assert.equal(decodeGeminiStructuredPayload(body), null);
});

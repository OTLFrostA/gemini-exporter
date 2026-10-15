import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeGeminiAnnotation, decodeGeminiStructuredPayload } from '../src/core/parsers/gemini/rpc/structuredContent.js';
import { parseGeminiBody } from '../src/core/parsers/gemini/shared/contentAdapter.js';
import { parseGeminiRpcConversation } from '../src/core/parsers/gemini/rpc/parseConversation.js';
import { extractSourceAttributions } from '../src/core/parsers/gemini/rpc/sourceAttributions.js';
import { assertDomainClosure } from '../src/core/domain/closure.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { renderDocumentMarkdown } from '../src/core/renderers/markdown/renderMarkdown.js';
import { renderDocumentHtml } from '../src/core/renderers/html/renderHtml.js';
import { renderDocumentTypst } from '../src/core/renderers/typst/renderTypst.js';

const fixture = (name: string): unknown => JSON.parse(readFileSync(`tests/fixtures/provider/structured_rpc/${name}.json`, 'utf8'));
const fallback = 'UNRELATED_MARKDOWN_SENTINEL';
const text = (value: string, annotations: unknown[] = []): unknown[] => [null, [null, 0, value, annotations]];
const field = (index: number, value: unknown): unknown[] => Object.assign(Array(index + 1).fill(null), { [index]: value });
const sourceAnnotation = (start: number, end: number, ids = ['spp_fixture']): unknown[] => [start, end, [null, null, null, [null, ids]]];
const sourceTable = (sources: unknown[] = [['https://example.com/source', 'Source title']]): unknown[] => [null, [[['cited span'], [1], sources, 'spp_fixture']]];
function wire(raw: unknown, table?: unknown, alternatives: unknown[] = []): string {
    const payload: unknown[] = [[['rc_primary', [[fallback]], table], ...alternatives]];
    payload[12] = raw;
    return JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[[['c_citationfixture', 'r_fixture'], [1700000000, 0], [['Question']], payload]]])]]);
}
const parse = (raw: unknown, table?: unknown, alternatives?: unknown[]) => parseGeminiRpcConversation(wire(raw, table, alternatives), { providerId: 'gemini' });
function successful(result: ReturnType<typeof parse>) {
    assert.ok(!result.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK'), JSON.stringify(result.diagnostics));
    assert.ok(!JSON.stringify(result.conversation.detail.messages[1].content).includes(fallback));
    assertDomainClosure(result.conversation.detail);
    return result.conversation.detail.messages[1];
}
function rejected(result: ReturnType<typeof parse>, reason: string) {
    assert.ok(result.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK' && d.details && typeof d.details === 'object' && !Array.isArray(d.details) && d.details.reason === reason));
    assert.ok(JSON.stringify(result.conversation.detail.messages[1].content).includes(fallback));
}
// Captured 2026-10-15: preserve actual protocol shapes, omit account/transport data.
const capturedFiles = fixture('live-file-citations');
const decodedFiles = decodeGeminiStructuredPayload(capturedFiles);
assert.ok(decodedFiles);
const first = decodedFiles.children[0];
assert.equal(first.nodeType, 'paragraph');
if (first.nodeType !== 'paragraph') throw new Error('fixture shape');
const fileCitation = first.children.find(node => node.nodeType === 'citation');
assert.ok(fileCitation);

test('captured file references use structured content, preserving inline code, list order, and source labels', () => {
    const result = parse(capturedFiles);
    const message = successful(result);
    assert.deepEqual(message.citations, [{ id: 'grounding-1', title: 'test_config.json' }]);
    assert.deepEqual(message.content[0], { type: 'paragraph', children: [
        { type: 'text', text: 'Loaded ' }, { type: 'inlineCode', code: 'test_config.json' },
        { type: 'citationRef', citationId: 'grounding-1', label: '[1]' }, { type: 'text', text: ':' },
    ] });
    const list = message.content[1];
    assert.equal(list.type, 'list');
    if (list.type !== 'list') return;
    for (const item of list.items) {
        assert.equal(item.blocks.length, 1, 'trailing citations stay in their list paragraph');
        const paragraph = item.blocks[0];
        assert.equal(paragraph.type, 'paragraph');
        if (paragraph.type === 'paragraph') assert.equal(paragraph.children.at(-1)?.type, 'citationRef');
    }
    const serialized = JSON.stringify(message.content);
    assert.ok(!serialized.includes('json`'), 'quoted citation metadata is not duplicated as body text');
});

test('composite paragraphs preserve math, Unicode, punctuation and multiple citations in tables and lists', () => {
    const second = { ...fileCitation, number: 2, title: 'other.png' };
    const composite = { nodeType: 'paragraph', children: [
        { nodeType: 18, text: '😀 x_1', annotations: [{ start: 3, end: 6, type: 4 }] },
        fileCitation, { nodeType: 18, text: ' / ' }, second, { nodeType: 18, text: '. [1]' },
    ] };
    const containers = [composite,
        { nodeType: 20, items: [{ children: [composite] }] },
        { nodeType: 17, rows: [{ cells: [{ children: [composite] }] }] },
        { nodeType: 15, children: [composite] },
    ];
    for (const node of containers) {
        const result = parse({ children: [node] });
        const message = successful(result);
        assert.ok(JSON.stringify(message.content).includes('"source":"x_1"'));
        assert.equal((JSON.stringify(message.content).match(/"type":"citationRef"/g) ?? []).length, 2);
        assert.ok(JSON.stringify(message.content).includes('. [1]'), 'literal numeric prose must not become a source reference');
        assert.equal(message.citations?.length, 2);
    }
});

test('captured optics table preserves cited cells on the native wire path', () => {
    const message = successful(parse(fixture('live-optics-table-citations')));
    assert.equal(message.content.length, 1);
    assert.equal(message.content[0].type, 'table');
    assert.ok(JSON.stringify(message.content).includes('citationRef'));
    assert.deepEqual(message.citations, [{ id: 'grounding-1', title: 'fixture-optics.jpg' }]);
});

test('captured native blockquote retains paragraph formatting without Markdown fallback', () => {
    const result = parse(fixture('live-blockquote'));
    const message = successful(result);
    assert.deepEqual(message.content, [{ type: 'quote', blocks: [{ type: 'paragraph', children: [
        { type: 'strong', children: [{ type: 'text', text: '切忌拿单调流量做线性外推，严防影子标识丢失穿透真实下游。' }] },
    ] }] }]);
    const document = composeDomainDocument(result.conversation).document;
    assert.ok(renderDocumentMarkdown(document, {}).includes('> **切忌'));
    assert.ok(renderDocumentHtml(document, {}).html.includes('<blockquote'));
    const quote = field(16, [[text('different quoted text')]]);
    const nested = successful(parse({ children: [{ nodeType: 20, items: [{ children: [quote] }] }] }));
    assert.equal(nested.content[0].type, 'list');
    assert.ok(JSON.stringify(nested.content).includes('different quoted text'));
    for (const raw of [field(16, []), field(16, [[]]), field(16, ['bad']), field(16, [[field(38, ['unknown'])]])]) {
        rejected(parse([[[raw]]]), 'decode_rejected');
    }
    quote[17] = 'conflicting content';
    rejected(parse([[[quote]]]), 'decode_rejected');
});

test('unbound file citations fail closed for callers without a native citation registry', () => {
    assert.ok(JSON.stringify(parseGeminiBody(fallback, decodedFiles)).includes(fallback));
});

test('standalone citation after display math is preserved after the equation', () => {
    const message = successful(parse({ children: [{ nodeType: 12, FTa: 'a=b' }, fileCitation] }));
    assert.equal(message.content[0].type, 'math');
    assert.equal(message.content[1].type, 'paragraph');
    assert.ok(JSON.stringify(message.content[1]).includes('grounding-1'));
});

test('captured source attributions retain all six URLs and nested bold formatting across output backends', () => {
    const table = fixture('live-source-table');
    const result = parse(fixture('live-source-attributions'), table);
    const message = successful(result);
    assert.equal(message.citations?.length, 6);
    assert.ok(!JSON.stringify(result.conversation).includes('spp_'), 'provider source IDs end at the parser boundary');
    assert.deepEqual(composeDomainDocument(JSON.parse(JSON.stringify(result.conversation))).document, composeDomainDocument(result.conversation).document);
    assert.ok(JSON.stringify(message.content).includes('"type":"strong","children":[{"type":"text","text":"2021年12月25日："}]'));
    assert.equal((JSON.stringify(message.content).match(/"type":"citationRef"/g) ?? []).length, 6);
    const document = composeDomainDocument(result.conversation).document;
    const md = renderDocumentMarkdown(document, {});
    const html = renderDocumentHtml(document, {}).html;
    const typst = JSON.stringify(renderDocumentTypst(document, {}));
    for (const citation of message.citations ?? []) {
        assert.ok(md.includes(citation.url!.replaceAll('(', '%28').replaceAll(')', '%29')));
        assert.ok(html.includes(citation.url!.replaceAll('&', '&amp;').replaceAll("'", '&#39;')));
        assert.ok(typst.includes(citation.url!));
    }
    assert.ok(md.includes('**2021年12月25日：**'));
});

test('one attributed span may resolve multiple sources, including duplicate URL aliases', () => {
    const table = sourceTable([['https://example.com/a', 'A'], ['https://example.com/b', 'B'], ['https://example.com/a', 'A']]);
    const raw = [[[text('😀 bold italic [1]', [sourceAnnotation(0, 14), [3, 14, [[null, null, null, null, 2]]], [8, 14, [[null, null, null, null, 1]]]])]]];
    const message = successful(parse(raw, table));
    assert.equal(message.citations?.length, 2);
    assert.deepEqual(message.content[0], { type: 'paragraph', children: [
        { type: 'text', text: '😀 ' }, { type: 'strong', children: [{ type: 'text', text: 'bold ' }, { type: 'emphasis', children: [{ type: 'text', text: 'italic' }] }] },
        { type: 'citationRef', citationId: 'citation-0' }, { type: 'citationRef', citationId: 'citation-1' }, { type: 'text', text: ' [1]' },
    ] });
});

test('source resolution never borrows another candidate source table', () => {
    const raw = [[[text('body', [sourceAnnotation(0, 4)])]]];
    rejected(parse(raw, undefined, [['rc_alternative', [['other body']], sourceTable()]]), 'adapter_rejected');
    const own = parse(raw, sourceTable(), [['rc_alternative', [['other body']]]]);
    const primary = own.conversation.detail.messages[1];
    assert.ok(JSON.stringify(primary.content).includes('citationRef'));
    assert.equal(own.conversation.detail.messages.length, 2, 'only the selected draft is exported');
    assert.ok(!JSON.stringify(own.conversation.detail.messages).includes('other body'));
});

test('unknown composite children, malformed citations and ambiguous wire fields reject the complete document', () => {
    const composites = [
        field(13, [[]]), field(13, ['invalid']),
        field(13, [[text('valid'), field(38, ['unknown'])]]),
        { nodeType: 'paragraph', children: [{ nodeType: 1, code: 'not inline' }] },
        { nodeType: 'paragraph', children: [{ nodeType: 18, text: 'heading', jJ: 2 }] },
    ];
    for (const raw of composites) {
        const result = parse({ children: [raw] });
        assert.ok(result.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK'));
        assert.ok(JSON.stringify(result.conversation.detail.messages[1].content).includes(fallback));
    }
    const good: unknown[] = field(31, [[['[cite: 1]', 0], [[null, [[null, 0, 'file.json', null, null, null, null, null, 1, null, null, 'application/json'], null, null, null, null, null, 'file.json']]], ['quote', 0]]]);
    assert.ok(decodeGeminiStructuredPayload([[[good]]]));
    for (const payload of [[], [['[cite: 1]', 0]], [[['[cite: 0]', 0], [], ['quote', 0]]], [[['[cite: 1]', 0], [], ['quote', 0]]]]) {
        rejected(parse([[[field(31, payload)]]]), 'decode_rejected');
    }
    good[32] = 'unknown visible payload';
    rejected(parse([[[good]]]), 'decode_rejected');
});

test('malformed/unresolved attribution, crossing ranges and source annotations inside leaves fail closed', () => {
    const badAnnotations = [sourceAnnotation(0, 99), sourceAnnotation(0, 4, []), sourceAnnotation(0, 4, ['unknown']),
        [0, 4, [null, null, null, [null, ['spp_fixture']], 'unknown']],
        [0, 4, [[null, null, null, null, 2], null, null, [null, []]]],
    ];
    for (const annotation of badAnnotations) {
        const result = parse([[[text('body', [annotation])]]], sourceTable());
        assert.ok(result.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK'));
    }
    for (const annotations of [
        [sourceAnnotation(0, 3), [2, 4, [[null, null, null, null, 2]]]],
        [[0, 4, [[null, null, null, null, 3]]], sourceAnnotation(1, 3)],
    ]) rejected(parse([[[text('body', annotations)]]], sourceTable()), 'adapter_rejected');
    const table = sourceTable();
    const entries = table[1] as unknown[][];
    entries.push([['same ID different URL'], [1], [['https://example.com/conflict', 'Conflict']], 'spp_fixture']);
    assert.deepEqual(extractSourceAttributions(['rc', [], table]), []);
    rejected(parse([[[text('body', [sourceAnnotation(0, 4)])]]], table), 'adapter_rejected');
    rejected(parse([[[text('body', [sourceAnnotation(0, 4)])]]], sourceTable([['javascript:bad', 'Bad']])), 'adapter_rejected');
    assert.equal(decodeGeminiAnnotation([0, 4, [null, null, null, ['wrong', ['spp_fixture']]]]), null);
});

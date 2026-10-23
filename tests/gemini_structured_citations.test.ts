import { fixtureAccount } from './helpers/domainFixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeGeminiAnnotation, decodeGeminiStructuredPayload } from '../src/l1/parsers/gemini/rpc/structuredContent.js';
import { parseGeminiBody } from '../src/l1/parsers/gemini/shared/contentAdapter.js';
import { parseGeminiRpcConversation } from '../src/l1/parsers/gemini/rpc/parseConversation.js';
import { detailGen as geminiDetailGen } from './fixtures/providers/geminiDetail.js';
import { extractSourceAttributions } from '../src/l1/parsers/gemini/rpc/sourceAttributions.js';
import { assertDomainClosure } from '../src/l2/closure.js';

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
const parse = (raw: unknown, table?: unknown, alternatives?: unknown[]) => parseGeminiRpcConversation(wire(raw, table, alternatives), { account: fixtureAccount('gemini'), providerId: 'gemini' });
const parseKey = (key: Parameters<typeof geminiDetailGen>[0]) =>
    parseGeminiRpcConversation(geminiDetailGen(key), { account: fixtureAccount('gemini'), providerId: 'gemini' });
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

test('captured file references use structured content, preserving inline code, list order, and hidden file-source metadata', () => {
    const result = parseKey('G_STRUCTURED_CITATIONS_01');
    const message = successful(result);
    assert.deepEqual(message.citations, [{ id: 'grounding-1', title: 'test_config.json' }]);
    assert.deepEqual(message.content[0], { type: 'paragraph', children: [
        { type: 'text', text: 'Loaded ' }, { type: 'inlineCode', code: 'test_config.json' },
        { type: 'text', text: ':' },
    ] });
    const list = message.content[1];
    assert.equal(list.type, 'list');
    if (list.type !== 'list') return;
    for (const item of list.items) {
        assert.equal(item.blocks.length, 1, 'trailing citations stay in their list paragraph');
        const paragraph = item.blocks[0];
        assert.equal(paragraph.type, 'paragraph');
        if (paragraph.type === 'paragraph') assert.ok(!paragraph.children.some(node => node.type === 'citationRef'));
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
        assert.equal((JSON.stringify(message.content).match(/"type":"citationRef"/g) ?? []).length, 0);
        assert.ok(JSON.stringify(message.content).includes('. [1]'), 'literal numeric prose must not become a source reference');
        assert.equal(message.citations?.length, 2);
    }
});

test('captured optics table preserves cited cells on the native wire path', () => {
    const message = successful(parseKey('G_STRUCTURED_CITATIONS_02'));
    assert.equal(message.content.length, 1);
    assert.equal(message.content[0].type, 'table');
    assert.ok(!JSON.stringify(message.content).includes('citationRef'));
    assert.deepEqual(message.citations, [{ id: 'grounding-1', title: 'fixture-optics.jpg' }]);
});

test('captured native blockquote retains paragraph formatting without Markdown fallback', () => {
    const result = parseKey('G_STRUCTURED_CITATIONS_03');
    const message = successful(result);
    assert.deepEqual(message.content, [{ type: 'quote', blocks: [{ type: 'paragraph', children: [
        { type: 'strong', children: [{ type: 'text', text: '切忌拿单调流量做线性外推，严防影子标识丢失穿透真实下游。' }] },
    ] }] }]);
    const nested = successful(parseKey('G_STRUCTURED_CITATIONS_04'));
    assert.equal(nested.content[0].type, 'list');
    assert.ok(JSON.stringify(nested.content).includes('different quoted text'));
    for (const key of ['G_STRUCTURED_CITATIONS_05', 'G_STRUCTURED_CITATIONS_06',
        'G_STRUCTURED_CITATIONS_07', 'G_STRUCTURED_CITATIONS_08'] as const) {
        rejected(parseKey(key), 'decode_rejected');
    }
    rejected(parseKey('G_STRUCTURED_CITATIONS_09'), 'decode_rejected');
});

test('unbound file citations fail closed for callers without a native citation registry', () => {
    assert.ok(JSON.stringify(parseGeminiBody(fallback, decodedFiles)).includes(fallback));
});

test('combined native file markers bind each number to its ordered source record', () => {
    const raw = fixture('live-combined-file-citations');
    const decoded = decodeGeminiStructuredPayload(raw);
    assert.ok(decoded);
    const message = successful(parseKey('G_STRUCTURED_CITATIONS_10'));
    assert.deepEqual(message.citations, [
        { id: 'grounding-1', title: 'first-diagram.jpg' },
        { id: 'grounding-2', title: 'second-diagram.jpg' },
    ]);
    assert.deepEqual(message.content, [{ type: 'paragraph', children: [] }]);
    const inline = successful(parse({ children: [{ nodeType: 'paragraph', children: [
        { nodeType: 18, text: 'Before ' }, ...decoded.children, { nodeType: 18, text: ' after.' },
    ] }] }));
    assert.equal(inline.content.length, 1);
    assert.ok(!JSON.stringify(inline.content).includes('propagation of light'), 'quoted metadata must not become prose');
    for (const key of ['G_STRUCTURED_CITATIONS_15', 'G_STRUCTURED_CITATIONS_16',
        'G_STRUCTURED_CITATIONS_17', 'G_STRUCTURED_CITATIONS_18', 'G_STRUCTURED_CITATIONS_19'] as const) {
        rejected(parseKey(key), 'decode_rejected');
    }
});

test('standalone hidden file chip after display math adds no visible marker', () => {
    const message = successful(parse({ children: [{ nodeType: 12, FTa: 'a=b' }, fileCitation] }));
    assert.equal(message.content[0].type, 'math');
    assert.equal(message.content[1].type, 'paragraph');
    assert.deepEqual(message.content[1], { type: 'paragraph', children: [] });
});

test('captured source attributions retain all six URLs and nested bold formatting in source content', () => {
    const result = parseKey('G_STRUCTURED_CITATIONS_11');
    const message = successful(result);
    assert.equal(message.citations?.length, 6);
    assert.ok(!JSON.stringify(result.conversation).includes('spp_'), 'provider source IDs end at the parser boundary');
    assert.ok(JSON.stringify(message.content).includes('"type":"strong","children":[{"type":"text","text":"2021年12月25日："}]'));
    assert.equal((JSON.stringify(message.content).match(/"type":"citationRef"/g) ?? []).length, 6);
    assert.deepEqual(JSON.parse(JSON.stringify(result.conversation)), result.conversation);
});

test('one attributed span may resolve multiple sources, including duplicate URL aliases', () => {
    const message = successful(parseKey('G_STRUCTURED_CITATIONS_12'));
    assert.equal(message.citations?.length, 2);
    assert.deepEqual(message.content[0], { type: 'paragraph', children: [
        { type: 'text', text: '😀 ' }, { type: 'strong', children: [{ type: 'text', text: 'bold ' }, { type: 'emphasis', children: [{ type: 'text', text: 'italic' }] }] },
        { type: 'citationRef', citationId: 'citation-0' }, { type: 'citationRef', citationId: 'citation-1' }, { type: 'text', text: ' [1]' },
    ] });
});

test('source resolution never borrows another candidate source table', () => {
    rejected(parseKey('G_STRUCTURED_CITATIONS_13'), 'adapter_rejected');
    const own = parseKey('G_STRUCTURED_CITATIONS_14');
    const primary = own.conversation.detail.messages[1];
    assert.ok(JSON.stringify(primary.content).includes('citationRef'));
    assert.equal(own.conversation.detail.messages.length, 2, 'only the selected draft is exported');
    assert.ok(!JSON.stringify(own.conversation.detail.messages).includes('other body'));
});

test('unknown composite children, malformed citations and ambiguous wire fields reject the complete document', () => {
    for (const key of ['G_STRUCTURED_CITATIONS_20', 'G_STRUCTURED_CITATIONS_21',
        'G_STRUCTURED_CITATIONS_22', 'G_STRUCTURED_CITATIONS_23', 'G_STRUCTURED_CITATIONS_24'] as const) {
        const result = parseKey(key);
        assert.ok(result.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK'));
        assert.ok(JSON.stringify(result.conversation.detail.messages[1].content).includes(fallback));
    }
    const good: unknown[] = field(31, [[['[cite: 1]', 0], [[null, [[null, 0, 'file.json', null, null, null, null, null, 1, null, null, 'application/json'], null, null, null, null, null, 'file.json']]], ['quote', 0]]]);
    assert.ok(decodeGeminiStructuredPayload([[[good]]]));
    for (const key of ['G_STRUCTURED_CITATIONS_25', 'G_STRUCTURED_CITATIONS_26',
        'G_STRUCTURED_CITATIONS_27', 'G_STRUCTURED_CITATIONS_28'] as const) {
        rejected(parseKey(key), 'decode_rejected');
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

import { describe as __suiteDescribe } from 'node:test';
import { geminiRpcPacket } from "./fixtures/providers/geminiRpcCapture.js";
import { GEMINI_DETAIL_CAPTURE } from "./fixtures/providers/geminiRpcCapture.js";
import { fixtureAccount } from "./helpers/domainFixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseGeminiRpcConversation } from "../src/l1/parsers/gemini/rpc/parseConversation.js";
import { decodeGeminiDetail } from "../src/l1/parsers/gemini/rpc/detailDecoder.js";
import { assertDomainClosure } from "../src/l2/closure.js";
import { textOfBlocks } from "./helpers/contentText.js";
import { detailGen as geminiDetailGen } from "./fixtures/providers/geminiDetail.js";
import test__s1 from "node:test";
import test__s3 from "node:test";
import { decodeGeminiAnnotation } from "../src/l1/parsers/gemini/rpc/structuredContent.js";
import { decodeGeminiStructuredPayload } from "../src/l1/parsers/gemini/rpc/structuredContent.js";
import { parseGeminiBody } from "../src/l1/parsers/gemini/shared/contentAdapter.js";
import { extractSourceAttributions } from "../src/l1/parsers/gemini/rpc/sourceAttributions.js";

__suiteDescribe("provider-gemini-rpc-domain", () => {
const ID = 'c_native12345678';
const native = (data: string) => parseGeminiRpcConversation(data, { account: fixtureAccount('gemini'), providerId: 'gemini' });
const text = textOfBlocks;

test('raw RPC code keeps consecutive blank lines in source Content AST', () => {
    const code = 'import math\n\n\nclass Encoder:\n    def encode(self):\n        return 1\n\n\n\nprint(Encoder().encode())';
    const { conversation } = native(geminiDetailGen('G_RPC_DOMAIN_01'));
    const block = conversation.detail.messages[1].content.find(node => node.type === 'code');
    assert.ok(block?.type === 'code');
    assert.equal(block.code, code + '\n', 'preserve the source newline immediately before the closing fence');

});

test('raw RPC input constructs Domain content, reasoning and citations directly', () => {
    const result = native(geminiDetailGen('G_RPC_DOMAIN_02'));
    assert.equal(result.conversation.index.title, 'Authored title');
    assert.deepEqual(result.conversation.detail.messages.map(m => m.role), ['user', 'assistant']);
    const answer = result.conversation.detail.messages[1];
    assert.ok(answer.content[0].type === 'paragraph');
    assert.ok(answer.content[0].children.some(n => n.type === 'strong'));
    assert.ok(answer.content[0].children.some(n => n.type === 'citationRef'));
    assert.equal(text(answer.reasoning!), 'Check facts');
    assert.deepEqual(answer.citations, [{ id: 'citation-0', url: 'https://example.test/source', title: 'Source' }]);
    assertDomainClosure((result.conversation).detail);
});

test('native parsing imports no historical persisted detail parser', () => {
    assert.equal(native(geminiRpcPacket('detail').responseBody).conversation.detail.messages.length, GEMINI_DETAIL_CAPTURE.messages);
    const source = readFileSync(join(__dirname, '../src/l1/parsers/gemini/rpc/parseConversation.ts'), 'utf8');
    assert.doesNotMatch(source, /parseConversationRecord|parseConversation|parseLegacyConversation|types\/conversation|l3a/);
});

test('source request tokens survive intact in source evidence and Domain', () => {
    const raw = geminiDetailGen('G_RPC_DOMAIN_04');
    assert.equal(decodeGeminiDetail(raw).messages[0].rawProviderRequestId, 'r_AbCd12');
    assert.equal(Reflect.get(native(raw).conversation.detail.messages[0], 'provenance'), undefined);

});

test('wire chronology, primary answers and source dates remain explicit', () => {
    const { conversation } = native(geminiDetailGen('G_RPC_DOMAIN_05'));
    assert.deepEqual(conversation.detail.messages.map(m => text(m.content)), ['Older', 'Old answer', 'Newer', 'First']);
    assert.equal(conversation.index.createdAt, undefined);
    assert.equal(Reflect.get(conversation, 'updatedAt'), undefined, 'message dates do not establish the metadata version');
    assert.equal(conversation.detail.messages.at(-1)?.timestamp, 1700000010000);
    for (const field of ['chatTime', 'lastSeen', 'href', 'turns']) assert.equal(field in conversation, false);
});

test('missing timestamps and request evidence are never fabricated', () => {
    const { conversation } = native(geminiDetailGen('G_RPC_DOMAIN_06'));
    assert.equal(Reflect.get(conversation, 'updatedAt'), undefined);
    assert.equal(conversation.index.createdAt, undefined);
    assert.equal(Reflect.get(conversation, 'updatedAt'), undefined);
    for (const message of conversation.detail.messages) {
        assert.equal(message.timestamp, undefined);
        assert.equal(Object.hasOwn(message, 'provenance'), false);
    }
});

test('pagination and rejected turns yield partial coverage and side-channel diagnostics', () => {
    const result = native(geminiDetailGen('G_RPC_DOMAIN_07'));
    assert.equal(result.conversation.detail.quality.status, 'partial');
    assert.equal(result.transport.nextPageToken, 'tC_native_cursor');
    assert.equal(result.evidence?.rejectedTurns, 1);
    assert.ok(result.diagnostics.some(d => d.code === 'GEMINI_TURNS_REJECTED'));
    assert.ok(result.diagnostics.some(d => d.code === 'GEMINI_SCHEMA_DRIFT'));
    const json = JSON.stringify(result.conversation);
    for (const field of ['transport', 'nextPageToken', '_raw', '_debug', 'schemaDrift', 'turnsRejected', 'diagnostics']) assert.ok(!json.includes(`"${field}":`));
    assert.ok(!json.includes('tC_native_cursor'));
    assert.equal(native(geminiDetailGen('G_RPC_DOMAIN_08')).conversation.detail.quality.status, 'unknown');
});

test('metadata-only pages preserve title evidence without claiming a complete conversation', () => {
    const result = native(geminiDetailGen('G_RPC_DOMAIN_09'));
    assert.equal(result.conversation.index.title, 'Metadata title');
    assert.equal(result.conversationId, ID.replace(/^c_/, ''));
    assert.equal(result.conversation.index.titleSource, 'provider');
    assert.equal(decodeGeminiDetail(geminiDetailGen('G_RPC_DOMAIN_10')).metadataConversation?.title, 'Metadata title');
    assert.equal(result.conversation.detail.messages.length, 0);
    assert.equal(result.conversation.detail.quality.status, 'unknown');
    assert.ok(result.diagnostics.some(d => d.code === 'GEMINI_SCHEMA_DRIFT'));
});

test('source candidates round-trip as keyless JSON without transport or credentials in the graph', () => {
    const result = native(geminiRpcPacket('detail').responseBody);
    const restored = JSON.parse(JSON.stringify(result.conversation));
    assert.deepEqual(restored, result.conversation);
    assertDomainClosure(restored.detail);
    assert.equal('key' in restored.index, false); assert.equal('key' in restored.detail, false);
    assert.equal('account' in result, false); assert.equal('transport' in restored, false);
});

test('sanitized existing wire evidence retains structured content and closed image references', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: 1700000000000 });
    const raw = geminiDetailGen('G_RPC_DOMAIN_CAPTURED_STACK_01');
    const result = native(raw);
    assert.ok(result.conversation.detail.assets.some(a => a.kind === 'image'));
    assertDomainClosure((result.conversation).detail);
    const asset = result.conversation.detail.assets.find(asset => asset.kind === 'image')!;
    assert.ok(result.conversation.detail.messages[1].attachmentIds?.includes(asset.id));
    assert.equal(decodeGeminiDetail(raw).messages[1].images?.[0].title, '贝尔不等式实验示意图');
    assert.deepEqual(JSON.parse(JSON.stringify(result.conversation)), result.conversation);
    for (const asset of result.conversation.detail.assets) assert.equal('sourceEvidence' in asset, false);

});

test('generated resources retain their authored request token independently of archive paths', () => {
    const raw = geminiDetailGen('G_RPC_DOMAIN_12');
    const result = native(raw);
    const generated = result.conversation.detail.assets.find(asset => asset.generation);
    assert.ok(generated);
    assert.equal(generated.generation?.providerRequestId, 'r_Ab12');
    assert.equal('resourceHints' in result, false);
    for (const field of ['localName', 'subDir', 'rawProviderRequestId']) assert.equal(field in generated, false);
    assertDomainClosure((result.conversation).detail);
});

test('raw format validation rejects wrong providers and malformed envelopes', () => {
    assert.throws(() => parseGeminiRpcConversation(geminiRpcPacket('detail').responseBody, { account: fixtureAccount('openai'), providerId: 'openai' }), /providerId gemini/);
    assert.throws(() => parseGeminiRpcConversation({} as never, { account: fixtureAccount('gemini'), providerId: 'gemini' }), /raw response text/);
    for (const key of ['G_RPC_DOMAIN_20', 'G_RPC_DOMAIN_21', 'G_RPC_DOMAIN_14'] as const) assert.throws(() => native(geminiDetailGen(key)), /detail parse fail/);
    const empty = parseGeminiRpcConversation(geminiDetailGen('G_RPC_DOMAIN_15'), { account: fixtureAccount('gemini'), providerId: 'gemini', targetConvId: ID });
    assert.equal(empty.conversationId, ID.replace(/^c_/, ''));
    assert.equal(empty.conversation.detail.messages.length, 0);
});

test('source extraction has no export paths and retains unsanitized source filenames', () => {
    const raw = geminiDetailGen('G_RPC_DOMAIN_16');
    const evidence = decodeGeminiDetail(raw);
    const source = evidence.messages[1].images![0];
    assert.equal(source.fileName, 'source:photo?.png');
    for (const message of evidence.messages) {
        for (const resource of [...message.images ?? [], ...message.documents ?? [], ...message.attachments ?? []]) {
            assert.equal('localName' in resource, false);
            assert.equal('resolvedUrl' in resource, false);
        }
    }
    const bare = decodeGeminiDetail(geminiDetailGen('G_RPC_DOMAIN_17'));
    assert.equal(bare.messages[1].images![0].fileName, undefined);
    assert.equal(native(raw).conversation.detail.assets.find(a => a.generation)?.name, 'source:photo?.png');
});

test('raw decoding never substitutes conversation or request IDs for absent message identities', () => {
    const raw = geminiDetailGen('G_RPC_DOMAIN_18');
    const result = native(raw);
    assert.equal(result.conversation.detail.messages.length, 4);
    for (const message of result.conversation.detail.messages) assert.equal(message.id, undefined);
    assertDomainClosure(result.conversation.detail);
    assert.deepEqual(JSON.parse(JSON.stringify(result.conversation)), result.conversation);
    assert.equal(decodeGeminiDetail(raw).messages[0].id, '');
    const request = geminiDetailGen('G_RPC_DOMAIN_19');
    assert.equal(decodeGeminiDetail(request).messages[0].providerRequestId, 'r_Ab12');
});
});

__suiteDescribe("gemini_prompt_literal", () => {
test__s1('native Gemini prompts preserve literal syntax while assistant Markdown remains structured', () => {
    const prompt = String.raw`Use f(\$)=1, **literal**, $x$, <input> and C:\temp\file.

Keep [link](https://example.com) and \* intact.`;
    const wire = geminiDetailGen('G_PROMPT_LITERAL_01');
    const { conversation } = parseGeminiRpcConversation(wire, { account: fixtureAccount('gemini'), providerId: 'gemini' });
    const user = conversation.detail.messages[0];
    assert.equal(user.role, 'user');
    assert.equal(textOfBlocks(user.content), prompt);
    assert.ok(user.content.every(block => block.type === 'paragraph'));
    const answer = conversation.detail.messages[1];
    assert.ok(answer.content.some(block => block.type === 'paragraph' && block.children.some(node => node.type === 'strong')));
    assert.equal('key' in conversation.detail, false);
});
});

__suiteDescribe("gemini_selected_candidate", () => {
// Sanitized shape observed in the failing 2026-10-09 Tier 2 spray-dryer RPC:
// one request, two answer drafts, turn[3][3] naming the displayed candidate.
const ID = 'c_selected12345678';
const candidates = [
    ['rc_displayed', [['## System Definition and Mass Balances\n\nDisplayed balance.']]],
    ['rc_alternative', [['## System Boundaries and Assumptions\n\nUnselected balance.']]],
];
const parse = (wire: string) => parseGeminiRpcConversation(wire, { account: fixtureAccount('gemini'), providerId: 'gemini' });
const answerText = (wire: string) => textOfBlocks(parse(wire).conversation.detail.messages[1].content);

test('ID-only detail candidate does not become exported assistant text', () => {
    const wire = geminiDetailGen('G_BOUNDARY_DETAIL_08');
    const messages = parse(wire).conversation.detail.messages;
    assert.deepEqual(messages.map(message => [message.role, textOfBlocks(message.content)]), [
        ['user', 'Missing body prompt'],
    ]);
});

test('selected wire answer exports one Assistant section and retains raw alternative evidence', () => {
    const wire = geminiDetailGen('G_SELECTED_CANDIDATE_01');
    const result = parse(wire);
    assert.deepEqual(result.conversation.detail.messages.map(m => [m.role, m.id]), [['user', 'r_request'], ['assistant', 'rc_displayed']]);
    assert.match(answerText(wire), /Displayed balance/);
    assert.doesNotMatch(answerText(wire), /Unselected balance/);
    assert.equal(result.conversation.detail.messages.filter(message => message.role === 'assistant').length, 1);
    const raw = result.transport.decodedPayload as unknown[][];
    assert.deepEqual(raw[0][0], [[ID, 'r_request'], [1700000000, 0], [['Derive the mass balance.']], [candidates, null, null, 'rc_displayed']]);
});

test('selection is by candidate identity even when the displayed answer is not first', () => {
    const wire = geminiDetailGen('G_SELECTED_CANDIDATE_02');
    assert.equal(parse(wire).conversation.detail.messages[1].id, 'rc_alternative');
    assert.match(answerText(wire), /Unselected balance/);
    assert.doesNotMatch(answerText(wire), /Displayed balance/);
});

test('legacy missing, telemetry and unknown selections use a single primary draft', () => {
    for (const key of ['G_SELECTED_CANDIDATE_03', 'G_SELECTED_CANDIDATE_04',
        'G_SELECTED_CANDIDATE_05', 'G_SELECTED_CANDIDATE_06'] as const) {
        const parsed = decodeGeminiDetail(geminiDetailGen(key));
        assert.equal(parsed.messages.length, 2);
        assert.equal(parsed.messages[1].id, 'rc_displayed');
    }
});

test('unselected images do not leak into the selected answer or consume its resources', () => {
    const unselectedImage = 'https://lh3.googleusercontent.com/unselected-image.png';
    const selectedImage = 'https://lh3.googleusercontent.com/selected-image.png';
    const wire = geminiDetailGen('G_SELECTED_CANDIDATE_07');
    const parsed = decodeGeminiDetail(wire);
    assert.equal(parsed.messages.length, 2);
    assert.equal(parsed.messages[1].id, 'rc_selected');
    assert.equal(parsed.messages[1].images?.length, 1);
    assert.equal(parsed.messages[1].images?.[0].sourceUrl, selectedImage);

    // Resource ownership must survive the native Domain boundary, not just decoding.
    const domain = parse(wire).conversation;
    assert.ok(domain.detail.assets.some(asset => asset.sourceUri === selectedImage));
    assert.ok(!domain.detail.assets.some(asset => asset.sourceUri === unselectedImage));
    assert.equal(domain.detail.messages.filter(message => message.role === 'assistant').length, 1);
});
});

__suiteDescribe("gemini_structured_citations", () => {
const fixture = (name: string): unknown => JSON.parse(readFileSync(`tests/fixtures/provider/structured_rpc/${name}.json`, 'utf8'));
const fallback = 'UNRELATED_MARKDOWN_SENTINEL';
const field = (index: number, value: unknown): unknown[] => Object.assign(Array(index + 1).fill(null), { [index]: value });
const sourceTable = (sources: unknown[] = [['https://example.com/source', 'Source title']]): unknown[] => [null, [[['cited span'], [1], sources, 'spp_fixture']]];
const parseKey = (key: Parameters<typeof geminiDetailGen>[0]) =>
    parseGeminiRpcConversation(geminiDetailGen(key), { account: fixtureAccount('gemini'), providerId: 'gemini' });
function successful(result: ReturnType<typeof parseKey>) {
    assert.ok(!result.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK'), JSON.stringify(result.diagnostics));
    assert.ok(!result.diagnostics.some(d => d.code === 'GEMINI_SOURCE_ANNOTATION_FALLBACK'));
    assert.ok(!JSON.stringify(result.conversation.detail.messages[1].content).includes(fallback));
    assertDomainClosure(result.conversation.detail);
    return result.conversation.detail.messages[1];
}
function sourceDegraded(result: ReturnType<typeof parseKey>, citationCount = 0) {
    assert.ok(result.diagnostics.some(d => d.code === 'GEMINI_SOURCE_ANNOTATION_FALLBACK'));
    assert.equal(result.conversation.detail.quality.status, 'partial');
    assert.equal(result.evidence?.unrepresentedContent, true);
    const message = result.conversation.detail.messages[1];
    assert.ok(!JSON.stringify(message.content).includes(fallback));
    assert.ok(JSON.stringify(message.content).includes('"text":"body"'));
    assert.equal(message.citations?.length ?? 0, citationCount);
    assertDomainClosure(result.conversation.detail);
    return message;
}
function rejected(result: ReturnType<typeof parseKey>, reason: string) {
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

test__s3('captured file references use structured content, preserving inline code, list order, and hidden file-source metadata', () => {
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

test__s3('composite paragraphs preserve math, Unicode, punctuation and multiple citations in tables and lists', () => {
    for (const key of [
        'G_STRUCTURED_CITATION_COMPOSITE_PARAGRAPH_01',
        'G_STRUCTURED_CITATION_COMPOSITE_LIST_01',
        'G_STRUCTURED_CITATION_COMPOSITE_TABLE_01',
        'G_STRUCTURED_CITATION_COMPOSITE_QUOTE_01',
    ] as const) {
        const result = parseKey(key);
        const message = successful(result);
        assert.ok(JSON.stringify(message.content).includes('"source":"x_1"'));
        assert.equal((JSON.stringify(message.content).match(/"type":"citationRef"/g) ?? []).length, 0);
        assert.ok(JSON.stringify(message.content).includes('. [1]'), 'literal numeric prose must not become a source reference');
        assert.equal(message.citations?.length, 2);
    }
});

test__s3('captured optics table preserves cited cells on the native wire path', () => {
    const message = successful(parseKey('G_STRUCTURED_CITATIONS_02'));
    assert.equal(message.content.length, 1);
    assert.equal(message.content[0].type, 'table');
    assert.ok(!JSON.stringify(message.content).includes('citationRef'));
    assert.deepEqual(message.citations, [{ id: 'grounding-1', title: 'fixture-optics.jpg' }]);
});

test__s3('captured native blockquote retains paragraph formatting without Markdown fallback', () => {
    const result = parseKey('G_STRUCTURED_CITATIONS_03');
    const message = successful(result);
    assert.deepEqual(message.content, [{ type: 'quote', blocks: [{ type: 'paragraph', children: [
        { type: 'strong', children: [{ type: 'text', text: '切忌拿单调流量做线性外推，严防影子标识丢失穿透真实下游。' }] },
    ] }] }]);
    const nested = successful(parseKey('G_STRUCTURED_CITATIONS_04'));
    assert.equal(nested.content[0].type, 'list');
    assert.ok(JSON.stringify(nested.content).includes('different quoted text'));
    for (const key of ['G_STRUCTURED_CITATIONS_07', 'G_STRUCTURED_CITATIONS_08'] as const) {
        rejected(parseKey(key), 'decode_rejected');
    }
    rejected(parseKey('G_STRUCTURED_CITATIONS_09'), 'decode_rejected');
});

test__s3('unbound file citations fail closed for callers without a native citation registry', () => {
    assert.ok(JSON.stringify(parseGeminiBody(fallback, decodedFiles)).includes(fallback));
});

test__s3('combined native file markers bind each number to its ordered source record', () => {
    const raw = fixture('live-combined-file-citations');
    const decoded = decodeGeminiStructuredPayload(raw);
    assert.ok(decoded);
    const message = successful(parseKey('G_STRUCTURED_CITATIONS_10'));
    assert.deepEqual(message.citations, [
        { id: 'grounding-1', title: 'first-diagram.jpg' },
        { id: 'grounding-2', title: 'second-diagram.jpg' },
    ]);
    assert.deepEqual(message.content, [{ type: 'paragraph', children: [] }]);
    const inline = successful(parseKey('G_STRUCTURED_CITATION_INLINE_COMBINED_01'));
    assert.equal(inline.content.length, 1);
    assert.ok(!JSON.stringify(inline.content).includes('propagation of light'), 'quoted metadata must not become prose');
    for (const key of ['G_STRUCTURED_CITATIONS_15', 'G_STRUCTURED_CITATIONS_16',
        'G_STRUCTURED_CITATIONS_17', 'G_STRUCTURED_CITATIONS_18', 'G_STRUCTURED_CITATIONS_19'] as const) {
        rejected(parseKey(key), 'decode_rejected');
    }
});

test__s3('standalone hidden file chip after display math adds no visible marker', () => {
    const message = successful(parseKey('G_STRUCTURED_CITATION_MATH_FILE_CHIP_01'));
    assert.equal(message.content[0].type, 'math');
    assert.equal(message.content[1].type, 'paragraph');
    assert.deepEqual(message.content[1], { type: 'paragraph', children: [] });
});

test__s3('captured source attributions retain all six URLs and nested bold formatting in source content', () => {
    const result = parseKey('G_STRUCTURED_CITATIONS_11');
    const message = successful(result);
    assert.equal(message.citations?.length, 6);
    assert.ok(!JSON.stringify(result.conversation).includes('spp_'), 'provider source IDs end at the parser boundary');
    assert.ok(JSON.stringify(message.content).includes('"type":"strong","children":[{"type":"text","text":"2021年12月25日："}]'));
    assert.equal((JSON.stringify(message.content).match(/"type":"citationRef"/g) ?? []).length, 6);
    assert.deepEqual(JSON.parse(JSON.stringify(result.conversation)), result.conversation);
});

test__s3('one attributed span may resolve multiple sources, including duplicate URL aliases', () => {
    const message = successful(parseKey('G_STRUCTURED_CITATIONS_12'));
    assert.equal(message.citations?.length, 2);
    assert.deepEqual(message.content[0], { type: 'paragraph', children: [
        { type: 'text', text: '😀 ' }, { type: 'strong', children: [{ type: 'text', text: 'bold ' }, { type: 'emphasis', children: [{ type: 'text', text: 'italic' }] }] },
        { type: 'citationRef', citationId: 'citation-0' }, { type: 'citationRef', citationId: 'citation-1' }, { type: 'text', text: ' [1]' },
    ] });
});

test__s3('source resolution never borrows another candidate source table', () => {
    const unbound = sourceDegraded(parseKey('G_STRUCTURED_CITATIONS_13'));
    assert.ok(!JSON.stringify(unbound).includes('citationRef'), 'alternative source table must not bind the primary body');
    const own = parseKey('G_STRUCTURED_CITATIONS_14');
    const primary = own.conversation.detail.messages[1];
    assert.ok(JSON.stringify(primary.content).includes('citationRef'));
    assert.equal(own.conversation.detail.messages.length, 2, 'only the selected draft is exported');
    assert.ok(!JSON.stringify(own.conversation.detail.messages).includes('other body'));
});

test__s3('unknown composite children, malformed citations and ambiguous wire fields reject the complete document', () => {
    for (const key of ['G_STRUCTURED_CITATIONS_20', 'G_STRUCTURED_CITATIONS_21',
        'G_STRUCTURED_CITATIONS_22', 'G_STRUCTURED_CITATIONS_23'] as const) {
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
    rejected(parseKey('G_STRUCTURED_CITATIONS_38'), 'decode_rejected');
});

test__s3('malformed attributions reject and unresolved bindings remain partial without fabricated sources', () => {
    const degraded = sourceDegraded(parseKey('G_STRUCTURED_CITATIONS_29'), 1);
    assert.equal(degraded.citations?.[0].url, 'https://example.com/source');
    for (const key of ['G_STRUCTURED_CITATIONS_30',
        'G_STRUCTURED_CITATIONS_31', 'G_STRUCTURED_CITATIONS_32',
        'G_STRUCTURED_CITATIONS_33'] as const) {
        const result = parseKey(key);
        assert.ok(result.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK'));
    }
    const table = sourceTable();
    const entries = table[1] as unknown[][];
    entries.push([['same ID different URL'], [1], [['https://example.com/conflict', 'Conflict']], 'spp_fixture']);
    assert.deepEqual(extractSourceAttributions(['rc', [], table]), []);
    for (const key of ['G_STRUCTURED_CITATIONS_36', 'G_STRUCTURED_CITATIONS_37'] as const) {
        const message = sourceDegraded(parseKey(key));
        assert.ok(!JSON.stringify(message).includes('citationRef'));
        assert.ok(!JSON.stringify(message).includes('javascript:') && !JSON.stringify(message).includes('/conflict'));
    }
    assert.equal(decodeGeminiAnnotation([0, 4, [null, null, null, ['wrong', ['spp_fixture']]]]), null);
});

test__s3('source ranges may cross formatting and end inside atomic inline code', () => {
    const crossed = successful(parseKey('G_STRUCTURED_CITATIONS_34'));
    assert.deepEqual(crossed.content[0], { type: 'paragraph', children: [
        { type: 'text', text: 'bo' },
        { type: 'strong', children: [{ type: 'text', text: 'd' },
            { type: 'citationRef', citationId: 'citation-0' }, { type: 'text', text: 'y' }] },
    ] });
    const code = successful(parseKey('G_STRUCTURED_CITATIONS_35'));
    assert.deepEqual(code.content[0], { type: 'paragraph', children: [
        { type: 'inlineCode', code: 'body' }, { type: 'citationRef', citationId: 'citation-0' },
    ] });
});
});

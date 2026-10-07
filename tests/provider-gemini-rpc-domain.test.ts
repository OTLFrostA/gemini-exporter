import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseConversation } from '../src/core/parsers/parseConversation.js';
import { parseGeminiRpcConversation } from '../src/core/parsers/gemini/rpc/parseConversation.js';
import { parseDetail } from '../src/core/compatibility/gemini/parseDetail.js';
import { decodeGeminiDetail } from '../src/core/parsers/gemini/rpc/detailDecoder.js';
import { parseProviderConversation } from '../src/core/compatibility/conversationParser.js';
import { assertDomainClosure } from '../src/core/domain/closure.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { renderDocumentHtml } from '../src/core/renderers/html/renderHtml.js';
import { renderDocumentMarkdown } from '../src/core/renderers/markdown/renderMarkdown.js';
import { renderDocumentTypst } from '../src/core/renderers/typst/renderTypst.js';
import { extractBlockText } from '../src/core/domain/content/unknownFallback.js';

const ID = 'c_native12345678';
const rpc = (inner: unknown) => `)]}'\n\n${JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify(inner)]])}`;
function turn(prompt = 'Question', seconds: number | null = 1700000000, candidates: unknown[] = [['rc_answer', [['Answer']]]], request = 'r_AB12'): unknown[] {
    return [[ID, request], seconds === null ? null : [seconds, 0], [[prompt]], [candidates]];
}
const native = (data: string) => parseConversation({ format: 'gemini-rpc', providerId: 'gemini', data });
const text = (blocks: Parameters<typeof extractBlockText>[0][]) => blocks.map(block => extractBlockText(block)).join('\n');

test('raw RPC input constructs Domain content, reasoning and citations directly', () => {
    const body = [['**Answer** [1]'], ['THOUGHT', 'Check **facts**'], ['https://example.test/source', 'Source']];
    const result = native(rpc([[turn('Question', 1700000000, [['rc_answer', body]])], null, 'Authored title']));
    assert.equal(result.conversation.title, 'Authored title');
    assert.deepEqual(result.conversation.messages.map(m => m.role), ['user', 'assistant']);
    const answer = result.conversation.messages[1];
    assert.ok(answer.content[0].type === 'paragraph');
    assert.ok(answer.content[0].children.some(n => n.type === 'strong'));
    assert.ok(answer.content[0].children.some(n => n.type === 'citationRef'));
    assert.equal(text(answer.reasoning!), 'Check facts');
    assert.deepEqual(answer.citations, [{ id: 'citation-0', url: 'https://example.test/source', title: 'Source' }]);
    assertDomainClosure(result.conversation);
});

test('native parsing never calls the historical persisted detail parser', () => {
    const module = require('../src/core/compatibility/gemini/parseDetail.js') as { parseDetail: typeof parseDetail };
    const old = module.parseDetail;
    module.parseDetail = () => { throw new Error('Historical parser must not run'); };
    try {
        assert.equal(native(rpc([[turn()]])).conversation.messages.length, 2);
    } finally { module.parseDetail = old; }
    const source = readFileSync(join(__dirname, '../src/core/parsers/gemini/rpc/parseConversation.ts'), 'utf8');
    assert.doesNotMatch(source, /parseConversationRecord|parseProviderConversation|parseLegacyConversation|types\/conversation|core\/storage/);
});

test('source request tokens survive intact while the persisted parser keeps normalized keys', () => {
    const raw = rpc([[turn('Question', null, undefined, 'r_AbCd12')]]);
    assert.equal(decodeGeminiDetail(raw).messages[0].rawProviderRequestId, 'r_AbCd12');
    assert.equal(native(raw).conversation.messages[0].provenance?.providerRequestId, 'r_AbCd12');
    const legacy = parseDetail(raw);
    assert.equal(legacy.messages[0].providerRequestId, 'abcd12');
    for (const message of legacy.messages) assert.equal('rawProviderRequestId' in message, false);
});

test('wire chronology, multiple candidates and source dates remain explicit', () => {
    const older = turn('Older', 1700000000, [['rc_old', [['Old answer']]]], 'r_old');
    const newer = turn('Newer', 1700000010, [['rc_new1', [['First']]], ['rc_new2', [['Second']]]], 'r_new');
    const { conversation } = native(rpc([[newer, older]]));
    assert.deepEqual(conversation.messages.map(m => text(m.content)), ['Older', 'Old answer', 'Newer', 'First', 'Second']);
    assert.equal(conversation.createdAt, 1700000000000);
    assert.equal(conversation.updatedAt, 1700000010000);
    assert.equal(conversation.timestamp, 1700000010000);
    for (const field of ['chatTime', 'lastSeen', 'href', 'turns']) assert.equal(field in conversation, false);
});

test('missing timestamps and request evidence are never fabricated', () => {
    const rawTurn = [[ID], null, [['Question']], [[['rc_answer', [['Answer']]]]]];
    const { conversation } = native(rpc([[rawTurn]]));
    assert.equal(conversation.timestamp, null);
    assert.equal(conversation.createdAt, null);
    assert.equal(conversation.updatedAt, null);
    for (const message of conversation.messages) {
        assert.equal(message.timestamp, undefined);
        assert.equal(message.provenance, undefined);
    }
});

test('pagination and rejected turns yield partial coverage and side-channel diagnostics', () => {
    const rejected = [['x_not_a_turn'], null, [['Unrecognized source prompt']]];
    const result = native(rpc([[turn(), rejected], 'tC_native_cursor']));
    assert.equal(result.conversation.completeness?.status, 'partial');
    assert.equal(result.transport.nextPageToken, 'tC_native_cursor');
    assert.equal(result.transport.turnsRejected, 1);
    assert.ok(result.diagnostics.some(d => d.code === 'GEMINI_TURNS_REJECTED'));
    assert.ok(result.diagnostics.some(d => d.code === 'GEMINI_SCHEMA_DRIFT'));
    const json = JSON.stringify(result.conversation);
    for (const field of ['transport', 'nextPageToken', '_raw', '_debug', 'schemaDrift', 'turnsRejected', 'diagnostics']) assert.ok(!json.includes(`"${field}":`));
    assert.ok(!json.includes('tC_native_cursor'));
    assert.equal(native(rpc([[turn()]])).conversation.completeness?.status, 'unknown');
});

test('metadata-only pages preserve title evidence without claiming a complete conversation', () => {
    const result = native(rpc([null, null, [[ID, 'Metadata title']]]));
    assert.equal(result.conversation.title, 'Metadata title');
    assert.equal(result.conversation.id, ID);
    assert.equal(result.conversation.titleSource, 'rpc');
    assert.equal('metadataConversation' in parseDetail(rpc([null, null, [[ID, 'Metadata title']]])), false);
    assert.equal(result.conversation.messages.length, 0);
    assert.equal(result.conversation.completeness?.status, 'unknown');
    assert.ok(result.diagnostics.some(d => d.code === 'GEMINI_SCHEMA_DRIFT'));
});

test('native Domain composition matches the existing route without moving transport into the graph', () => {
    const raw = rpc([[turn('**Question**', 1700000000, [['rc_answer', [['# Answer\n\n```ts\nconst value = 1;\n```']]]])], null, 'Title']);
    const result = native(raw);
    const legacy = parseProviderConversation(parseDetail(raw));
    const document = composeDomainDocument(result.conversation).document;
    assert.deepEqual(document, composeDomainDocument(legacy.conversation).document);
    const restored = JSON.parse(JSON.stringify(result.conversation));
    assertDomainClosure(restored);
    assert.deepEqual(composeDomainDocument(restored).document, document);
    const before = JSON.stringify(result.conversation);
    for (const backend of [renderDocumentHtml, renderDocumentMarkdown, renderDocumentTypst]) {
        assert.deepEqual(backend(document, {}), backend(composeDomainDocument(restored).document, {}));
    }
    assert.equal(JSON.stringify(result.conversation), before);
});

test('sanitized existing wire evidence retains structured content and closed image references', () => {
    const fixture = (name: string): unknown => JSON.parse(readFileSync(join(__dirname, 'fixtures/provider/structured_rpc', name), 'utf8'));
    const candidate = fixture('wire-case-b-cand.json');
    const structured = fixture('wire-turn-3-12-b-stack.json');
    const rawTurn = turn('Explain Bell inequalities', null, [candidate]);
    assert.ok(Array.isArray(rawTurn[3]));
    rawTurn[3][12] = structured;
    const raw = rpc([[rawTurn]]);
    const result = native(raw);
    assert.ok(result.conversation.assets.some(a => a.kind === 'image'));
    assertDomainClosure(result.conversation);
    const document = composeDomainDocument(result.conversation).document;
    const legacyDocument = composeDomainDocument(parseProviderConversation(parseDetail(raw)).conversation).document;
    const image = document.messages[1].blocks.find(block => block.type === 'image');
    const oldImage = legacyDocument.messages[1].blocks.find(block => block.type === 'image');
    assert.ok(image?.type === 'image' && oldImage?.type === 'image');
    assert.equal(image.alt, '贝尔不等式实验示意图');
    assert.equal(oldImage.alt, `${image.alt}.png`);
    // Only the old fabricated filename extension differs from the authored caption.
    oldImage.alt = image.alt;
    oldImage.caption = image.caption;
    assert.deepEqual(document, legacyDocument);
    for (const asset of result.conversation.assets) assert.equal('sourceEvidence' in asset, false);
});

test('generated resources retain their authored request token independently of archive paths', () => {
    const url = 'https://lh3.googleusercontent.com/native_generated_image';
    const image: unknown[] = [];
    image[2] = 'watermarked_img_native.png';
    image[3] = url;
    image[11] = 'image/png';
    image[15] = [640, 480, 100];
    const raw = rpc([[turn('Draw', null, [['rc_image', [['Image'], image]]], 'r_Ab12')]]);
    const result = native(raw);
    const generated = result.conversation.assets.find(asset => asset.generated);
    assert.ok(generated);
    assert.equal(generated.generation?.providerRequestId, 'r_Ab12');
    assert.equal(result.resourceHints[generated.id]?.archivePath, undefined);
    for (const field of ['localName', 'subDir', 'rawProviderRequestId']) assert.equal(field in generated, false);
    assertDomainClosure(result.conversation);
});

test('raw format validation rejects wrong providers and malformed envelopes', () => {
    assert.throws(() => parseGeminiRpcConversation(rpc([]), { providerId: 'openai' }), /providerId gemini/);
    assert.throws(() => parseGeminiRpcConversation({} as never, { providerId: 'gemini' }), /raw response text/);
    for (const raw of ['', 'not JSON', rpc(null)]) assert.throws(() => native(raw), /detail parse fail/);
    const empty = parseConversation({ format: 'gemini-rpc', providerId: 'gemini', data: rpc([]), targetConvId: ID });
    assert.equal(empty.conversation.id, ID);
    assert.equal(empty.conversation.messages.length, 0);
});


test('source extraction has no export paths and retains unsanitized source filenames', () => {
    const image: unknown[] = [];
    image[2] = 'source:photo?.png'; image[3] = 'https://lh3.googleusercontent.com/source-photo';
    image[11] = 'image/png'; image[15] = [640, 480, 100];
    const raw = rpc([[turn('Draw', null, [['rc_image', [['Image'], image]]])]]);
    const evidence = decodeGeminiDetail(raw);
    const source = evidence.messages[1].images![0];
    assert.equal(source.fileName, 'source:photo?.png');
    for (const message of evidence.messages) {
        for (const resource of [...message.images ?? [], ...message.documents ?? [], ...message.attachments ?? []]) {
            assert.equal('localName' in resource, false);
            assert.equal('resolvedUrl' in resource, false);
        }
    }
    assert.equal(parseDetail(raw).messages[1].images![0].localName, 'assets/345678_source_photo.png');
    const bare = decodeGeminiDetail(rpc([[turn('Draw', null, [['rc_inline', [['Image'], ['https://lh3.googleusercontent.com/inline', 1, 1]]]])]]));
    assert.equal(bare.messages[1].images![0].fileName, undefined);
    assert.equal(native(raw).conversation.assets.find(a => a.generated)?.name, 'source:photo?.png');
});


test('raw decoding never substitutes conversation or request IDs for absent message identities', () => {
    const rawTurn = [[ID], null, [['Question']], [[['', [['Answer']]]]]];
    const raw = rpc([[rawTurn, rawTurn]]);
    const result = native(raw);
    assert.equal(result.conversation.messages.length, 4);
    for (const message of result.conversation.messages) assert.equal(message.id, undefined);
    assert.doesNotThrow(() => composeDomainDocument(result.conversation));
    assert.equal(parseDetail(raw).messages[0].id, ID);
    const request = rpc([[turn('Question', null, undefined, 'r_Ab12')]]);
    assert.equal(decodeGeminiDetail(request).messages[0].providerRequestId, 'r_Ab12');
    assert.equal(parseDetail(request).messages[0].providerRequestId, 'ab12');
});

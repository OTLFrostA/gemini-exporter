import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureAccount } from './helpers/domainFixture.js';
import { citationText, coverageWire } from './fixtures/providers/gemini/detail/content.js';
import { parseGeminiRpcConversation } from '../src/l1/parsers/gemini/rpc/parseConversation.js';
import { mergeConversationPages } from '../src/l1/parsers/gemini/rpc/mergePages.js';
import { extractSourceAttributions } from '../src/l1/parsers/gemini/rpc/sourceAttributions.js';
import { assertDomainClosure } from '../src/l2/closure.js';
import { createDocumentReader } from '../src/l1/parsers/gemini/rpc/sourceAttachments.js';

const target = 'https://example.com/owned-source';
const table = (id: string, url = target) => [null, [[['`code`'], [1], [[url, 'Owned source']], id]]];
const parse = (raw: unknown, metadata?: unknown, alternatives: unknown[] = [], artifactPackets?: unknown, candidateText = 'Selected Markdown.') => {
    const primary: unknown[] = ['rc_primary', [[candidateText]], metadata];
    if (artifactPackets !== undefined) primary[30] = artifactPackets;
    return mergeConversationPages([parseGeminiRpcConversation(coverageWire(raw, [primary, ...alternatives]), {
        account: fixtureAccount('gemini'), providerId: 'gemini',
    })], undefined, true);
};
const rawBody = (id: string, end = 4) => [[[citationText('code', [
    [0, 4, [[null, null, null, null, 3]]],
    [0, end, [null, null, null, [null, [id]]]],
])]]];
function sourceDiagnostic(result: ReturnType<typeof parse>) {
    const diagnostic = result.diagnostics.find(d => d.code === 'GEMINI_SOURCE_ANNOTATION_FALLBACK');
    assert.ok(diagnostic?.details && typeof diagnostic.details === 'object' && !Array.isArray(diagnostic.details));
    return diagnostic.details;
}

test('all supported source identities bind only to their explicit selected-candidate source records', () => {
    for (const id of ['spp_owned', 'sp_owned', 'cit_owned', '0']) {
        const result = parse(rawBody(id), table(id));
        assert.equal(result.conversation.detail.quality.status, 'complete', id);
        assert.ok(!result.diagnostics.some(d => d.code === 'GEMINI_SOURCE_ANNOTATION_FALLBACK'), id);
        const message = result.conversation.detail.messages.find(m => m.role === 'assistant');
        assert.ok(message);
        assert.deepEqual(message.citations, [{ id: 'citation-0', url: target, title: 'Owned source' }]);
        assert.ok(JSON.stringify(message.content).includes('"citationId":"citation-0"'));
        assertDomainClosure(result.conversation.detail);
    }
    const nested = [[[citationText('code', [[0, 4, [null, null, null, [[null, null, 'cit_owned']]]]])]]];
    assert.equal(parse(nested, table('cit_owned')).conversation.detail.quality.status, 'complete');
});

function quotedEntry(id: string, quote: string, candidateText: string) {
    const start = candidateText.indexOf(quote);
    assert.ok(start >= 0);
    const bytes = new TextEncoder();
    return [[quote, null, null, [
        [bytes.encode(candidateText.slice(0, start)).length, bytes.encode(candidateText.slice(0, start + quote.length)).length],
        [start, start + quote.length],
    ]], [1], [[target, 'Owned source']], id];
}

test('invalid source ranges recover only from a verified selected-candidate quote at one exact native location', () => {
    const candidateText = '引言😀\n\n😀 Prefix `code` suffix.';
    const raw = [[[citationText('😀 Prefix code suffix.', [
        [10, 14, [[null, null, null, null, 3]]],
        [3, 999, [null, null, null, [null, ['spp_owned']]]],
    ])]]];
    const original = structuredClone(raw);
    const result = parse(raw, [null, [quotedEntry('spp_owned', '`code`', candidateText)]], [], undefined, candidateText);
    assert.deepEqual(raw, original, 'recovery must not rewrite captured wire evidence');
    assert.equal(result.conversation.detail.quality.status, 'complete');
    assert.ok(!result.diagnostics.some(d => d.code === 'GEMINI_SOURCE_ANNOTATION_FALLBACK'));
    assert.ok(result.diagnostics.some(d => d.code === 'GEMINI_SOURCE_RANGE_RECOVERED' && d.severity === 'info'));
    const message = result.conversation.detail.messages.find(m => m.role === 'assistant');
    assert.ok(message);
    assert.deepEqual(message.content, [{ type: 'paragraph', children: [
        { type: 'text', text: '😀 Prefix ' }, { type: 'inlineCode', code: 'code' },
        { type: 'citationRef', citationId: 'citation-0' }, { type: 'text', text: ' suffix.' },
    ] }]);
    assertDomainClosure(result.conversation.detail);
});

test('a source quote cannot repair duplicate native occurrences, changed code whitespace or literal punctuation', () => {
    for (const [native, quote] of [['code then code', 'code'], ['a  b', '`a b`'], ['a * b', 'a b'], ['Code', '`code`']]) {
        const raw = [[[citationText(native, [[0, 999, [null, null, null, [null, ['spp_owned']]]]])]]];
        const result = parse(raw, [null, [quotedEntry('spp_owned', quote, quote)]], [], undefined, quote);
        sourceDiagnostic(result);
        assert.equal(result.conversation.detail.quality.status, 'partial');
        assert.ok(!result.diagnostics.some(d => d.code === 'GEMINI_SOURCE_RANGE_RECOVERED'));
    }
    const raw = [[[citationText('code', [[0, 999, [null, null, null, [null, ['spp_owned']]]]]), citationText('code')]]];
    sourceDiagnostic(parse(raw, [null, [quotedEntry('spp_owned', 'code', 'code')]], [], undefined, 'code'));
});

test('source quote byte/UTF-16 coordinates and source identity must agree with the selected Markdown', () => {
    const candidateText = '😀 `code`';
    const raw = rawBody('spp_owned', 999);
    const badHeaders = [
        ['`code`', null, null, [[4, 10], [3, 9]]], // UTF-8 prefix is five bytes, not four.
        ['`code`', null, null, [[5, 11], [2, 8]]], // UTF-16 substring does not equal the quote.
        ['`Code`', null, null, [[5, 11], [3, 9]]],
    ];
    for (const header of badHeaders) {
        const result = parse(raw, [null, [[header, [1], [[target, 'Owned source']], 'spp_owned']]], [], undefined, candidateText);
        sourceDiagnostic(result);
    }
    sourceDiagnostic(parse(raw, [null, [quotedEntry('sp_owned', '`code`', candidateText)]], [], undefined, candidateText));
});

test('conflicting source quotes do not repair ranges even when their source URL agrees', () => {
    const candidateText = 'code and tail';
    const result = parse(rawBody('spp_owned', 999), [null, [
        quotedEntry('spp_owned', 'code', candidateText), quotedEntry('spp_owned', 'tail', candidateText),
    ]], [], undefined, candidateText);
    sourceDiagnostic(result);
    assert.ok(!result.diagnostics.some(d => d.code === 'GEMINI_SOURCE_RANGE_RECOVERED'));
});

test('valid source coordinates remain unchanged even when a quote points elsewhere', () => {
    const candidateText = 'one code';
    const raw = [[[citationText(candidateText, [[0, 3, [null, null, null, [null, ['spp_owned']]]]])]]];
    const result = parse(raw, [null, [quotedEntry('spp_owned', 'code', candidateText)]], [], undefined, candidateText);
    const message = result.conversation.detail.messages.find(m => m.role === 'assistant');
    assert.ok(message);
    assert.deepEqual(message.content, [{ type: 'paragraph', children: [
        { type: 'text', text: 'one' }, { type: 'citationRef', citationId: 'citation-0' }, { type: 'text', text: ' code' },
    ] }]);
    assert.ok(!result.diagnostics.some(d => d.code === 'GEMINI_SOURCE_RANGE_RECOVERED'));
});

test('verified quotes cannot override malformed formatting or disagreeing source spans', () => {
    const candidateText = '`code` and tail';
    const metadata = [null, [quotedEntry('spp_owned', '`code`', candidateText), quotedEntry('spp_tail', 'tail', candidateText)]];
    const conflict = [[[citationText('code and tail', [[0, 999, [null, null, null, [null, ['spp_owned', 'spp_tail']]]]])]]];
    sourceDiagnostic(parse(conflict, metadata, [], undefined, candidateText));
    const badFormat = [[[citationText('code', [
        [0, 999, [[null, null, null, null, 3]]], [0, 999, [null, null, null, [null, ['spp_owned']]]],
    ])]]];
    const result = parse(badFormat, metadata, [], undefined, candidateText);
    assert.equal(result.conversation.detail.quality.status, 'partial');
    assert.ok(result.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK' && d.severity === 'warning'));
    assert.ok(!result.diagnostics.some(d => d.code === 'GEMINI_SOURCE_RANGE_RECOVERED'));
});

test('uncertain document binding retains the native document and selected packet evidence for a new diagnostic', () => {
    const candidateText = '# Narrative\n\n' + 'The answer explains the source, rather than supplying an owned document body. '.repeat(4);
    const chip = Object.assign(Array(25).fill(null), { 24: [[
        ['http://immersive_entry_chip/owned-report'], 'owned-document-id', null, 'Owned report', null, [1700000000, 0], null, 1,
    ]] });
    const raw = [[[citationText(candidateText), chip]]];
    const result = parse(raw, undefined, [], undefined, candidateText);
    assert.equal(result.conversation.detail.quality.status, 'partial');
    assert.equal(result.conversation.detail.assets.length, 1);
    assert.equal(result.conversation.detail.assets[0].document?.id, 'owned-document-id');
    assert.equal(result.conversation.detail.assets[0].document?.contentMarkdown, undefined, 'assistant narrative is not a document body');
    const diagnostic = result.diagnostics.find(d => d.code === 'GEMINI_DOCUMENT_BINDING_FALLBACK');
    assert.ok(diagnostic?.details && typeof diagnostic.details === 'object' && !Array.isArray(diagnostic.details));
    assert.deepEqual(diagnostic.details.rawDocument, raw);
    assert.deepEqual(diagnostic.details.candidateEvidence, {
        candidateIndex: 0, candidateId: 'rc_primary', candidateText, sourceMetadata: null,
    });
});

test('native document packets retain their owned body while foreign same-title packets cannot fill a chip', () => {
    const candidateText = '# Narrative\n\n' + 'This is the assistant narrative. '.repeat(12);
    const raw = [[[citationText('See the owned report.'), Object.assign(Array(25).fill(null), { 24: [[
        ['http://immersive_entry_chip/report'], 'c_coverage_report', null, 'Owned report', null, [1700000000, 0], null, 1,
    ]] })]]];
    const packet = (id: string) => Object.assign([id, null, 'Owned report', null,
        '# Owned report\n\n' + 'This is the actual artifact body. '.repeat(12)], { 10: 1 });
    const own = parse(raw, undefined, [], [packet('c_coverage_report')], candidateText);
    assert.equal(own.conversation.detail.quality.status, 'complete');
    assert.equal(own.conversation.detail.assets.length, 1);
    assert.ok(own.conversation.detail.assets[0].document?.contentMarkdown?.includes('actual artifact body'));
    const foreign = parse(raw, undefined, [], [packet('c_foreign_report')], candidateText);
    assert.equal(foreign.conversation.detail.quality.status, 'partial');
    assert.equal(foreign.conversation.detail.assets[0].document?.id, 'c_coverage_report');
    assert.equal(foreign.conversation.detail.assets[0].document?.contentMarkdown, undefined);
    assert.ok(!JSON.stringify(foreign.conversation.detail).includes('actual artifact body'));
});

test('cleaning a research-prompt title cannot discard its strict document identity', () => {
    const narrative = '# Narrative\n\n' + 'This answer is not the owned research document. '.repeat(8);
    const chip = Object.assign(Array(25).fill(null), { 24: [[
        ['http://immersive_entry_chip/report'], 'owned-research-id', null, "I've completed your research", null, null, null, 3,
    ]] });
    const result = parse([[[citationText(narrative), chip]]], undefined, [], undefined, narrative);
    assert.equal(result.conversation.detail.quality.status, 'partial');
    assert.equal(result.conversation.detail.assets.length, 1);
    assert.equal(result.conversation.detail.assets[0].document?.id, 'owned-research-id');
    assert.equal(result.conversation.detail.assets[0].document?.contentMarkdown, undefined);
    assert.ok(result.diagnostics.some(d => d.code === 'GEMINI_DOCUMENT_BINDING_FALLBACK'));
});

test('one owned document packet cannot hide another chip whose body is missing', () => {
    const raw = [[[citationText('Two reports.'), Object.assign(Array(25).fill(null), { 24: [
        [['http://immersive_entry_chip/first'], 'c_coverage_first', null, 'First report', null, null, null, 1],
        [['http://immersive_entry_chip/second'], 'c_coverage_second', null, 'Second report', null, null, null, 1],
    ] })]]];
    const packet = Object.assign(['c_coverage_first', null, 'First report', null, 'First owned body.'], { 10: 1 });
    const result = parse(raw, undefined, [], [packet]);
    assert.equal(result.conversation.detail.quality.status, 'partial');
    assert.equal(result.conversation.detail.assets.length, 2);
    const documents = result.conversation.detail.assets.map(asset => asset.document);
    assert.equal(documents.find(doc => doc?.id === 'c_coverage_first')?.contentMarkdown, 'First owned body.');
    assert.equal(documents.find(doc => doc?.id === 'c_coverage_second')?.contentMarkdown, undefined);
    assert.ok(result.diagnostics.some(d => d.code === 'GEMINI_DOCUMENT_BINDING_FALLBACK'));
    assertDomainClosure(result.conversation.detail);
});

test('document IDs prefer exact evidence and reject two conflicting exact bodies', () => {
    const one = 'First document paragraph with enough content to be a complete native section. '.repeat(3);
    const two = 'Second document paragraph with different independently authored source content. '.repeat(3);
    const reader = createDocumentReader([['prefix-doc1-suffix', [[one]]], ['doc1', [[two]]]]);
    assert.equal(reader.byId('doc1')?.contentMarkdown, two);
    assert.equal(createDocumentReader([['doc1', [[one]]], ['doc1', [[two]]]]).byId('doc1'), null);
    assert.equal(createDocumentReader([['doc1', [[one]]], ['doc1', [[one]]]]).byId('doc1')?.contentMarkdown, one);
});

test('exact alternative matching keeps punctuation adjacent to a composite citation', () => {
    const selected = { nodeType: 'paragraph', children: [
        { nodeType: 18, text: '引言' }, { nodeType: 'citation', number: 1, title: 'Source', url: target },
        { nodeType: 18, text: '：尾巴' },
    ] };
    const result = parse([[[selected]], [[citationText('Other body.')]]], undefined, [], undefined, '引言[cite: 1]：尾巴');
    assert.equal(result.conversation.detail.quality.status, 'complete');
    assert.ok(!result.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK' && d.severity === 'warning'));
    assert.ok(!JSON.stringify(result.conversation.detail.messages).includes('Other body.'));
    assertDomainClosure(result.conversation.detail);
});

test('source identity prefixes never alias or borrow a foreign candidate table', () => {
    for (const id of ['sp_owned', 'cit_owned', '0']) {
        const result = parse(rawBody(id), table('spp_owned'), [['rc_foreign', [['Other answer']], table(id)]]);
        sourceDiagnostic(result);
        assert.equal(result.conversation.detail.quality.status, 'partial');
        assert.ok(!JSON.stringify(result.conversation.detail.messages).includes('citationRef'));
    }
});

test('explicit source tables still reject conflicting identities and malformed HTTP targets', () => {
    for (const id of ['spp_owned', 'sp_owned', 'cit_owned', '0']) {
        assert.deepEqual(extractSourceAttributions(['rc', [], table(id, 'https://')]), []);
        assert.deepEqual(extractSourceAttributions(['rc', [], [null, [
            [['first'], [1], [[target, 'First']], id],
            [['second'], [1], [['https://example.com/conflict', 'Second']], id],
        ]]]), []);
    }
});

test('source-only failures retain raw coordinates and the selected candidate source/packet evidence', () => {
    const raw = rawBody('spp_owned', 6);
    const metadata = table('spp_owned');
    const packets = [['unsupported-packet', null, 'Owned packet', null, 'Packet body']];
    const result = parse(raw, metadata, [['rc_foreign', [['Other answer']], table('spp_foreign')]], packets);
    const details = sourceDiagnostic(result);
    assert.deepEqual(details.rawDocument, raw);
    assert.deepEqual(details.candidateEvidence, {
        candidateIndex: 0, candidateId: 'rc_primary', candidateText: 'Selected Markdown.',
        sourceMetadata: metadata, artifactPackets: packets,
    });
    assert.equal(result.conversation.detail.quality.status, 'partial');
    assert.ok(!JSON.stringify(result.conversation.detail).includes('candidateEvidence'));
    assertDomainClosure(result.conversation.detail);
});

test('decode rejection retains the original alternatives and candidate metadata before filtering', () => {
    const raw = [[[citationText('First body.')]], [[citationText('Second body.')]]];
    const malformedMetadata = [null, [[['quoted span'], [1], [['https://', 'Invalid source']], 'cit_owned']]];
    const result = parse(raw, malformedMetadata);
    const diagnostic = result.diagnostics.find(d => d.code === 'GEMINI_STRUCTURED_FALLBACK' && d.severity === 'warning');
    assert.ok(diagnostic?.details && typeof diagnostic.details === 'object' && !Array.isArray(diagnostic.details));
    assert.deepEqual(diagnostic.details.rawDocument, raw);
    assert.deepEqual(diagnostic.details.candidateEvidence, {
        candidateIndex: 0, candidateId: 'rc_primary', candidateText: 'Selected Markdown.', sourceMetadata: malformedMetadata,
    });
});

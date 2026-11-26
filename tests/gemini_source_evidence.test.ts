import { describe as __suiteDescribe } from 'node:test';
import test from "node:test";
import assert from "node:assert/strict";
import { fixtureAccount } from "./helpers/domainFixture.js";
import { citationText } from "./fixtures/providers/gemini/detail/content.js";
import { coverageWire } from "./fixtures/providers/gemini/detail/content.js";
import { sourceReplayFixture } from "./fixtures/providers/gemini/detail/content.js";
import { parseGeminiRpcConversation } from "../src/l1/parsers/gemini/rpc/parseConversation.js";
import { parseGeminiDetailEvidence } from "../src/l1/parsers/gemini/rpc/parseConversation.js";
import { decodeGeminiDetail } from "../src/l1/parsers/gemini/rpc/detailDecoder.js";
import { boundaryTop } from "./fixtures/providers/gemini/detail/protocol.js";
import { mergeConversationPages } from "../src/l1/parsers/gemini/rpc/mergePages.js";
import { extractSourceAttributions } from "../src/l1/parsers/gemini/rpc/sourceAttributions.js";
import { assertDomainClosure } from "../src/l2/closure.js";
import { recoverGeminiSourceRanges } from "../src/l1/parsers/gemini/shared/sourceRanges.js";
import { inspectStructuredContent } from "../src/l1/parsers/gemini/rpc/structuredContent.js";
import { type GeminiStructuredDocument } from "../src/l1/parsers/gemini/rpc/structuredContent.js";
import { detailGen } from "./fixtures/providers/geminiDetail.js";
import { composeDomainDocument } from "../src/l3b/compose/composeDomainDocument.js";
import { renderDocumentMarkdown } from "../src/l4/format/markdown/renderMarkdown.js";
import { validateParserDomain } from "../src/l2/runtimeValidation.js";
import { fixtureKey } from "./helpers/domainFixture.js";
import { decodeGeminiStructuredNode } from "../src/l1/parsers/gemini/rpc/structuredContent.js";
import { citationField } from "./fixtures/providers/gemini/detail/content.js";
import { citation } from "./fixtures/providers/gemini/detail/nativeCitationCases.js";
import { fileSource } from "./fixtures/providers/gemini/detail/nativeCitationCases.js";
import { parseGeminiRequest } from "../src/l1/parsers/gemini/rpc/request.js";
import { createDocumentReader } from "../src/l1/parsers/gemini/rpc/sourceAttachments.js";
import { parseGeminiCredential } from "../src/l1/parsers/gemini/credentials.js";
import { attachmentCard } from "./fixtures/providers/gemini/detail/remainingFallbackCases.js";
import { test as test__s5 } from "node:test";
import { type JsonValue } from "../src/shared/utils/jsonTypes.js";
import { extractImageEvidence } from "../src/l1/parsers/gemini/rpc/sourceAttachments.js";
import { listGen as geminiListGen } from "./fixtures/providers/gemini.js";
import { decodeGeminiListRow } from "../src/l1/parsers/gemini/rpc/parseList.js";
import { parseList } from "../src/l1/parsers/gemini/rpc/parseList.js";
import { findListConversationMetadata } from "../src/l1/parsers/gemini/rpc/listMetadata.js";
import { GeminiResponseEnvelope } from "../src/l1/parsers/gemini/rpc/responseEnvelope.js";
import { parseRemainingFixture } from "./helpers/geminiRemainingRecovery.js";
import { invalidSourceRangeNodes } from "./fixtures/providers/gemini/detail/remainingSourceRanges.js";
import { legalSourceRangeControls } from "./fixtures/providers/gemini/detail/remainingSourceRanges.js";
import { convertGeminiInlines } from "../src/l1/parsers/gemini/shared/structuredContentAdapter.js";
import { type InlineNode } from "../src/l2/content/inline.js";
import { parseGeminiResponse } from "../src/l1/parsers/gemini/rpc/parseResponse.js";
import { isConfirmedGeminiDetailNotFound } from "../src/l1/parsers/gemini/rpc/parseDeletion.js";
import { listGen } from "./fixtures/providers/gemini.js";
import { geminiRpcPacket } from "./fixtures/providers/geminiRpcCapture.js";
import { geminiDetailIdentityVariant } from "./fixtures/providers/geminiRpcCapture.js";
import { GEMINI_DETAIL_CAPTURE as expected } from "./fixtures/providers/geminiRpcCapture.js";
import { editCapturedRpc } from "./fixtures/providers/geminiCaptureWire.js";
import { geminiListPage } from "./fixtures/providers/geminiListCapture.js";
import { geminiListRow } from "./fixtures/providers/geminiListCapture.js";
import { geminiListVariant } from "./fixtures/providers/geminiListCapture.js";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { relative } from "node:path";
import { decodeGeminiStructuredPayload } from "../src/l1/parsers/gemini/rpc/structuredContent.js";
import { decodeDocumentLinks } from "../src/l1/parsers/gemini/rpc/cardNodes.js";
import { decodeResearchPlan } from "../src/l1/parsers/gemini/rpc/cardNodes.js";
import { decodeMailCard } from "../src/l1/parsers/gemini/rpc/cardNodes.js";
import { parseGeminiBody } from "../src/l1/parsers/gemini/shared/contentAdapter.js";
import { type GeminiStructuredNode } from "../src/l1/parsers/gemini/rpc/structuredContent.js";
import { type Diagnostic } from "../src/shared/diagnostics/diagnostic.js";
import { geminiStructuredToContent } from "../src/l1/parsers/gemini/shared/structuredContentAdapter.js";
import { type GeminiAnnotation } from "../src/l1/parsers/gemini/rpc/structuredContent.js";
import { type GeminiStructuredDocument as GeminiStructuredDocument__s13 } from "../src/l1/parsers/gemini/rpc/structuredContent.js";
import { citationWire } from "./fixtures/providers/gemini/detail/content.js";
import { malformedNativeNodes } from "./fixtures/providers/gemini/detail/nativeIntegrityCases.js";
import { ambiguousNativeNodes } from "./fixtures/providers/gemini/detail/nativeIntegrityCases.js";
import { type GeminiStructuredDecodeIssue } from "../src/l1/parsers/gemini/rpc/structuredContent.js";
import { v2ExportHost } from "./helpers/v2ExportHost.js";
import { readDeliveredFiles } from "./helpers/v2ExportHost.js";
import { exportKey } from "./helpers/v2ExportHost.js";
import { exportRequest } from "./helpers/v2ExportHost.js";
import { GeminiProvider } from "../src/l1/client/gemini/geminiProvider.js";
import { ingestDetail } from "../src/l2/ingestion.js";
import { runExport } from "../src/application/export/runExport.js";
import { shouldSkipExport } from "../src/application/export/runExport.js";
import { getExportRecord } from "../src/l3a/storageService.js";
import { __getZipConstructor } from "../src/l4/packaging/writers/zipWriter.js";
import { __setZipConstructor } from "../src/l4/packaging/writers/zipWriter.js";
import { closeGeminiCodeCitations } from "../src/l1/parsers/gemini/shared/codeCitations.js";
import { workspace } from "./fixtures/providers/gemini/detail/nativeCitationCases.js";
import { webSource } from "./fixtures/providers/gemini/detail/nativeCitationCases.js";
import { sourceUrl } from "./fixtures/providers/gemini/detail/nativeCitationCases.js";

__suiteDescribe("gemini_source_evidence", () => {
const target = 'https://example.com/owned-source';
const table = (id: string, url = target) => [null, [[['`code`'], [1], [[url, 'Owned source']], id]]];
const directCitation = (id: string, url = target) => [0, 4, [url, ...Array(19).fill(null), 'https://example.com/cache'],
    1, null, 1, null, 0, null, id];
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

test('candidate direct-citation records bind their exact IDs without a span-attribution table', () => {
    const metadata = [[directCitation('cit_owned')]];
    const result = parse(rawBody('cit_owned'), metadata);
    assert.equal(result.conversation.detail.quality.status, 'complete');
    const message = result.conversation.detail.messages.find(m => m.role === 'assistant');
    assert.ok(message);
    assert.deepEqual(message.citations, [{ id: 'citation-0', url: target, title: target }]);
    assert.ok(JSON.stringify(message.content).includes('"citationId":"citation-0"'));
    assert.equal(JSON.stringify(message).includes('https://example.com/cache'), false);
    assertDomainClosure(result.conversation.detail);
    const both = [[directCitation('cit_owned')], table('cit_owned')[1]];
    assert.equal(parse(rawBody('cit_owned'), both).conversation.detail.quality.status, 'complete');
});

test('zero-width source ID zero cannot be inferred from a source record position or another candidate', () => {
    const raw = [[[citationText('Native body.', [[0, 0, [null, null, null, [[null, null, '0']]]]])]]];
    const metadata = [[[null, null, [target, ...Array(18).fill(null), 'https://example.com/cache'], 3]],
        null, null, null, [null, null, 8]];
    const result = parse(raw, metadata, [['rc_foreign', [['Other answer']], table('0')]]);
    assert.equal(result.conversation.detail.quality.status, 'partial');
    assert.deepEqual(sourceDiagnostic(result).rawDocument, raw);
    assert.deepEqual(sourceDiagnostic(result).sourceFailures, [{ nativeText: 'Native body.', annotations: [
        { start: 0, end: 0, sourceIds: ['0'], rangeValid: true, unboundSourceIds: ['0'] },
    ] }]);
    assert.ok(JSON.stringify(result.conversation.detail.messages[1].content).includes('Native body.'));
    assert.ok(!JSON.stringify(result.conversation.detail.messages[1].content).includes('citationRef'));
    assertDomainClosure(result.conversation.detail);
});

test('direct-citation binding rejects foreign candidates, conflicting targets and malformed entries', () => {
    sourceDiagnostic(parse(rawBody('cit_owned'), undefined, [['rc_other', [['Other body.']], [[directCitation('cit_owned')]]]]));
    sourceDiagnostic(parse(rawBody('cit_owned'), [[directCitation('cit_other')]]));
    sourceDiagnostic(parse(rawBody('cit_owned'), [[directCitation('cit_owned'), directCitation('cit_owned', 'https://example.com/other')]]));
    sourceDiagnostic(parse(rawBody('cit_owned'), [[directCitation('cit_owned', 'https://example.com/other')], table('cit_owned')[1]]));
    for (const malformed of [
        directCitation('cit_owned', 'javascript:alert(1)'),
        Object.assign(directCitation('cit_owned'), { 0: -1 }),
        Object.assign(directCitation('cit_owned'), { 1: 0.5 }),
        Object.assign(directCitation('cit_owned'), { 2: [] }),
    ]) sourceDiagnostic(parse(rawBody('cit_owned'), [[malformed]]));
    // Binding is proven here, but these byte-only records are not dual-coordinate
    // source quotes and cannot repair invalid local native coordinates.
    sourceDiagnostic(parse(rawBody('cit_owned', 999), [[directCitation('cit_owned')]]));
});

function quotedEntry(id: string, quote: string, candidateText: string, start = candidateText.indexOf(quote)) {
    assert.ok(start >= 0);
    const bytes = new TextEncoder();
    return [[quote, null, null, [
        [bytes.encode(candidateText.slice(0, start)).length, bytes.encode(candidateText.slice(0, start + quote.length)).length],
        [start, start + quote.length],
    ]], [1], [[target, 'Owned source']], id];
}

test('verified Markdown positions recover partial code quotes and disambiguate repeated snippets by a whole paragraph', () => {
    const cases = [
        { markdown: 'Prefix `alpha beta` suffix.', native: 'Prefix alpha beta suffix.', quote: 'beta`', start: 13, end: 17 },
        { markdown: 'Prefix `alpha beta` suffix.', native: 'Prefix alpha beta suffix.', quote: 'beta` suffix.', start: 13, end: 25 },
        { markdown: '**Prefix** `alpha beta` suffix.', native: 'Prefix alpha beta suffix.', quote: '**Prefix** `alpha beta`', start: 0, end: 17 },
        { markdown: 'First `code` mention.\n\nSecond `code` mention.', native: 'Second code mention.', quote: '`code`', start: 7, end: 11 },
        { markdown: 'code then code', native: 'code then code', quote: 'code', start: 10, end: 14 },
    ];
    for (const example of cases) {
        const at = example.markdown.lastIndexOf(example.quote);
        const metadata = [null, [quotedEntry('spp_owned', example.quote, example.markdown, at)]];
        const source = extractSourceAttributions(['rc_primary', [[example.markdown]], metadata], example.markdown);
        const doc: GeminiStructuredDocument = { children: [
            { nodeType: 18, text: 'First code mention.' },
            { nodeType: 18, text: example.native, annotations: [{ type: 'source', start: 0, end: 999, sourceIds: ['spp_owned'] }] },
        ] };
        const recovery = recoverGeminiSourceRanges(doc, source, example.markdown);
        assert.equal(recovery.recovered, 1, example.quote);
        const node = recovery.document.children[1];
        assert.ok(node.nodeType === 18);
        assert.deepEqual(node.annotations, [{ type: 'source', start: example.start, end: example.end, sourceIds: ['spp_owned'] }]);
        const raw = [[[citationText('First code mention.'), citationText(example.native, [
            [0, 999, [null, null, null, [null, ['spp_owned']]]],
        ])]]];
        const result = parse(raw, metadata, [], undefined, example.markdown);
        assert.equal(result.conversation.detail.quality.status, 'complete');
        assertDomainClosure(result.conversation.detail);
    }
});

test('contextual source recovery rejects duplicate paragraphs, changed code, and conflicting quote positions', () => {
    for (const markdown of ['Repeated `code`.\n\nRepeated `code`.', 'Repeated `Code`.', 'Repeated `co  de`.']) {
        const quote = markdown.includes('co  de') ? 'co  de`' : markdown.includes('Code') ? 'Code`' : 'code`';
        const metadata = [null, [quotedEntry('spp_owned', quote, markdown)]];
        const raw = [[[citationText('Repeated code.', [[0, 999, [null, null, null, [null, ['spp_owned']]]]]),
            citationText('Repeated code.')]]];
        sourceDiagnostic(parse(raw, metadata, [], undefined, markdown));
    }
    const markdown = 'code then code';
    const metadata = [null, [quotedEntry('spp_owned', 'code', markdown, 0), quotedEntry('spp_owned', 'code', markdown, 10)]];
    const raw = [[[citationText(markdown, [[0, 999, [null, null, null, [null, ['spp_owned']]]]])]]];
    sourceDiagnostic(parse(raw, metadata, [], undefined, markdown));
});

test('contextual projection cannot truncate multi-block quotes or approximate entity and code normalization', () => {
    for (const [markdown, quote, native] of [
        ['`first`\n\n`second`', 'first`\n\n`second', 'first'],
        ['A &amp; B', 'amp;', 'A & B'],
        ['A ` padded ` B', 'padded `', 'A padded B'],
        ['A `line\nbreak` B', 'break`', 'A line break B'],
        ['A ![image](https://example.com/a) B', '![image]', 'A image B'],
    ]) {
        const metadata = [null, [quotedEntry('spp_owned', quote, markdown)]];
        const raw = [[[citationText(native, [[0, 999, [null, null, null, [null, ['spp_owned']]]]])]]];
        const result = parse(raw, metadata, [], undefined, markdown);
        assert.equal(result.conversation.detail.quality.status, 'partial', markdown);
        sourceDiagnostic(result);
        assert.ok(!result.diagnostics.some(d => d.code === 'GEMINI_SOURCE_RANGE_RECOVERED'));
    }
});

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

test('an exact document ID in a mixed container cannot claim neighboring prose or links', () => {
    const raw = [[[citationText('See the report.'), Object.assign(Array(25).fill(null), { 24: [[
        ['http://immersive_entry_chip/target'], 'owned-document-id', null, 'Target report', null, null, null, 1,
    ]] })]]];
    const foreign = '# Foreign report\n\n' + 'This independently owned document must never become the target body. '.repeat(5);
    for (const container of [
        ['owned-document-id', [['foreign-document-id', [[foreign, 'https://example.com/foreign']]]]],
        ['owned-document-id', [[foreign, 'https://example.com/foreign']]],
    ]) {
        const result = parse(raw, container);
        assert.equal(result.conversation.detail.quality.status, 'partial');
        assert.equal(result.conversation.detail.assets[0].document?.contentMarkdown, undefined);
        assert.ok(!JSON.stringify(result.conversation).includes('independently owned document'));
        assert.ok(!JSON.stringify(result.conversation).includes('https://example.com/foreign'));
        assert.ok(result.diagnostics.some(d => d.code === 'GEMINI_DOCUMENT_BINDING_FALLBACK'));
    }
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

test('Deep Research packets require an exact chip ID in the selected answer', () => {
    const id = 'im_0123456789abcdef';
    const body = '# Research report\n\nThis is the exact report body.';
    const chip = (chipId: string) => Object.assign(Array(25).fill(null), { 24: [[
        ['http://googleusercontent.com/immersive_entry_chip/0'], chipId, 'agency-placeholder-task-id',
        'Research report', null, [1700000000, 0], null, 3,
    ]] });
    const packet = Object.assign([id, null, 'Research report', 'agency-placeholder-task-id', body], { 10: 3 });
    const textNode = citationText('See the report.');
    const selected = [[textNode, chip(id)]];
    const other = [[textNode, chip('im_fedcba9876543210')]];

    const matched = parse([selected], undefined, [], [packet]);
    assert.equal(matched.conversation.detail.quality.status, 'complete');
    assert.equal(matched.conversation.detail.assets.length, 1);
    assert.equal(matched.conversation.detail.assets[0].document?.contentMarkdown, body);
    assert.ok(!matched.diagnostics.some(d => d.code === 'GEMINI_DOCUMENT_BINDING_FALLBACK'));
    assertDomainClosure(matched.conversation.detail);

    const siblingOnly = parse([other, selected], undefined, [['rc_sibling', [['Another answer.']]]], [packet]);
    assert.equal(siblingOnly.conversation.detail.quality.status, 'partial');
    assert.equal(siblingOnly.conversation.detail.assets.length, 1);
    assert.equal(siblingOnly.conversation.detail.assets[0].document?.contentMarkdown, undefined);
    assert.ok(siblingOnly.diagnostics.some(d => d.code === 'GEMINI_DOCUMENT_BINDING_FALLBACK'));
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

test('selected native document keeps punctuation adjacent to a composite citation', () => {
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
    assert.deepEqual(details.sourceFailures, [{ nativeText: 'code', annotations: [
        { start: 0, end: 6, sourceIds: ['spp_owned'], rangeValid: false, unboundSourceIds: [] },
    ] }]);
    assert.equal(result.conversation.detail.quality.status, 'partial');
    assert.ok(!JSON.stringify(result.conversation.detail).includes('candidateEvidence'));
    assertDomainClosure(result.conversation.detail);
});

test('source failures capture one complete Detail payload per page in developer mode only', () => {
    const { wire, payload } = sourceReplayFixture();
    const context = { account: fixtureAccount('gemini'), providerId: 'gemini' };
    const defaultParsed = parseGeminiRpcConversation(wire, context);
    assert.equal(defaultParsed.diagnostics.filter(d => d.code === 'GEMINI_SOURCE_ANNOTATION_FALLBACK').length, 2);
    assert.equal(defaultParsed.diagnostics.some(d => d.code === 'GEMINI_SOURCE_REPLAY_EVIDENCE'), false,
        'normal exports must not retain full multi-turn RPC page dumps');

    const prevDev = globalThis.__gemExporterDevMode;
    globalThis.__gemExporterDevMode = true;
    try {
        const parsed = parseGeminiRpcConversation(wire, context);
        assert.equal(parsed.diagnostics.filter(d => d.code === 'GEMINI_SOURCE_ANNOTATION_FALLBACK').length, 2);
        const evidence = parsed.diagnostics.filter(d => d.code === 'GEMINI_SOURCE_REPLAY_EVIDENCE');
        assert.equal(evidence.length, 1);
        assert.equal(evidence[0].severity, 'info');
        assert.deepEqual(evidence[0].details, { rpcId: 'hNvQHb', conversationId: 'c_source_replay',
            providerMessageIds: ['rc_source_old', 'rc_source_new'], captureStatus: 'captured', payload });
        const serialized = JSON.stringify(evidence);
        for (const field of ['UNPARSED_CANDIDATE_SOURCE_SLOT', 'UNPARSED_MODEL_SOURCE_SLOT', 'UNPARSED_DETAIL_SOURCE_SLOT'])
            assert.ok(serialized.includes(field));
        assert.ok(!serialized.includes('UNRELATED_RPC_SAMPLE'));
        assert.ok(!JSON.stringify(parsed.conversation).includes('UNPARSED_'));
        const replay = parseGeminiRpcConversation(boundaryTop(payload), context);
        assert.deepEqual(replay.conversation, parsed.conversation);
        assertDomainClosure(parsed.conversation.detail);
    } finally {
        globalThis.__gemExporterDevMode = prevDev;
    }
});

test('successful source parsing does not retain complete Detail payload samples even in developer mode', () => {
    const prevDev = globalThis.__gemExporterDevMode;
    globalThis.__gemExporterDevMode = true;
    try {
        const { wire } = sourceReplayFixture(false);
        const parsed = parseGeminiRpcConversation(wire, { account: fixtureAccount('gemini'), providerId: 'gemini' });
        assert.ok(!parsed.diagnostics.some(d => d.code === 'GEMINI_SOURCE_REPLAY_EVIDENCE'));
        assert.ok(!JSON.stringify(parsed.diagnostics).includes('UNPARSED_'));
    } finally {
        globalThis.__gemExporterDevMode = prevDev;
    }
});

test('successful decoded messages retain no per-candidate replay fields or raw documents', () => {
    const decoded = decodeGeminiDetail(sourceReplayFixture(false).wire);
    const model = decoded.messages.find(message => message.role === 'model');
    assert.ok(model);
    assert.equal(Object.hasOwn(model, 'candidateEvidence'), false);
    assert.equal(Object.hasOwn(model.structuredExtraction ?? {}, 'rawDocument'), false);
});

test('successful structured decoding does not traverse foreign documents for diagnostic portability', () => {
    const foreign = Object.defineProperty([null], 0, { enumerable: true,
        get() { throw new Error('Unneeded diagnostic traversal'); } });
    const decoded = inspectStructuredContent({ turnDocument: [[[citationText('Owned body.')]], foreign], candidateIndex: 0 });
    assert.equal(decoded.status, 'decoded');
    assert.equal(Object.hasOwn(decoded, 'rawDocument'), false);
});

test('source replay evidence explicitly reports when a decoded-only input has no original payload', () => {
    const prevDev = globalThis.__gemExporterDevMode;
    globalThis.__gemExporterDevMode = true;
    try {
        const decoded = decodeGeminiDetail(sourceReplayFixture().wire);
        const parsed = parseGeminiDetailEvidence({ ...decoded, _raw: undefined },
            { account: fixtureAccount('gemini'), providerId: 'gemini' });
        const evidence = parsed.diagnostics.find(d => d.code === 'GEMINI_SOURCE_REPLAY_EVIDENCE');
        assert.deepEqual(evidence?.details, { rpcId: 'hNvQHb', conversationId: 'c_source_replay',
            providerMessageIds: ['rc_source_old', 'rc_source_new'], captureStatus: 'unavailable' });
    } finally {
        globalThis.__gemExporterDevMode = prevDev;
    }
});

test('decode rejection retains original document indices and candidate metadata before filtering', () => {
    const selected = [[citationText('First body.'), [null, null, null, null, null, null, null, 'unsupported']]];
    const raw = [selected, [[citationText('Second body.')]]];
    const malformedMetadata = [null, [[['quoted span'], [1], [['https://', 'Invalid source']], 'cit_owned']]];
    const result = parse(raw, malformedMetadata);
    const diagnostic = result.diagnostics.find(d => d.code === 'GEMINI_STRUCTURED_FALLBACK' && d.severity === 'warning');
    assert.ok(diagnostic?.details && typeof diagnostic.details === 'object' && !Array.isArray(diagnostic.details));
    assert.deepEqual(diagnostic.details.rawDocument, raw);
    assert.deepEqual(diagnostic.details.candidateEvidence, {
        candidateIndex: 0, candidateId: 'rc_primary', candidateText: 'Selected Markdown.', sourceMetadata: malformedMetadata,
    });
});
});

__suiteDescribe("gemini-turn-admission", () => {
test('unidentified metadata and non-array junk are discarded, counted, and never assigned a role', () => {
    for (const key of ['G_TURN_ADMISSION_METADATA', 'G_TURN_ADMISSION_SCALAR', 'G_TURN_ADMISSION_UNOWNED'] as const) {
        const evidence = decodeGeminiDetail(detailGen(key));
        assert.equal(evidence.turnsRejected, 1);
        assert.equal(evidence.turnsRecovered, undefined);
        assert.deepEqual(evidence.messages.map(message => [message.role, message.content]), [
            ['user', 'Real question'], ['model', 'Real answer'],
        ]);
        const parsed = parseGeminiRpcConversation(detailGen(key), { providerId: 'gemini' });
        assert.equal(parsed.evidence?.rejectedTurns, 1);
        assert.equal(parsed.conversation.detail.quality.status, 'partial');
    }
});

test('request-bound drift is recovered separately from discarded turns and stays partial after pagination', () => {
    const recovered = detailGen('G_TURN_ADMISSION_REQUEST_RECOVERY');
    const evidence = decodeGeminiDetail(recovered);
    assert.equal(evidence.turnsRejected, undefined);
    assert.equal(evidence.turnsRecovered, 1);
    assert.equal(evidence.messages[0].content, 'Recovered question');
    assert.equal(evidence.messages[0].id, 'r_recovered');
    assert.ok(evidence.schemaDrift?.some(warning => warning.includes('Turn ID meta')));
    const parsed = parseGeminiRpcConversation(recovered, { providerId: 'gemini' });
    assert.equal(parsed.evidence?.rejectedTurns, undefined);
    assert.equal(parsed.conversation.detail.quality.status, 'partial');
    assert.ok(parsed.diagnostics.some(diagnostic => diagnostic.code === 'GEMINI_TURNS_RECOVERED'));
    assert.equal(mergeConversationPages([parsed], undefined, true).conversation.detail.quality.status, 'partial');
});

test('candidate-bound drift preserves the answer without requiring an intact conversation header', () => {
    const recovered = detailGen('G_TURN_ADMISSION_CANDIDATE_RECOVERY');
    const evidence = decodeGeminiDetail(recovered);
    assert.equal(evidence.turnsRejected, undefined);
    assert.equal(evidence.turnsRecovered, 1);
    assert.equal(evidence.messages[0].role, 'model');
    assert.equal(evidence.messages[0].id, 'rc_recovered');
    assert.equal(evidence.messages[0].content, 'Recovered answer');
});
});

__suiteDescribe("gemini_composite_blocks", () => {
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
});

__suiteDescribe("gemini_decoded_context", () => {
const body = (groups: unknown[]) => new URLSearchParams({ 'f.req': JSON.stringify(groups) }).toString();
const list = ['MaZiqc', JSON.stringify([100, null, [0, null, 1]])];
const detail = ['hNvQHb', JSON.stringify(['c_12345678abcd', 10, 'older', 1, [1], [4], null, 1])];
const deletion = ['GzXR5e', JSON.stringify(['c_12345678abcd'])];

test('one mixed batch decodes once and yields independent, concrete RPC contexts', () => {
    const request = body([[list, detail, deletion, ['unknown', 'broken']]]);
    const batch = new URLSearchParams(request).get('f.req');
    const parse = JSON.parse;
    let batchReads = 0;
    JSON.parse = (text, reviver) => { if (text === batch) batchReads++; return parse(text, reviver); };
    try {
        assert.deepEqual(parseGeminiRequest(request), {
            list: { streamId: 'recent', requestCursor: null },
            detail: { conversationId: '12345678abcd', requestCursor: 'older' },
            deletionId: 'c_12345678abcd',
        });
        assert.equal(batchReads, 1);
    } finally { JSON.parse = parse; }
});

test('duplicate RPC identity is rejected across groups without discarding unrelated valid calls', () => {
    assert.deepEqual(parseGeminiRequest(body([[list, deletion], [list, deletion, detail]])), {
        list: null, deletionId: null, detail: { conversationId: '12345678abcd', requestCursor: 'older' },
    });
    assert.deepEqual(parseGeminiRequest(body([[list, ['hNvQHb', 'broken'], deletion]])), {
        list: { streamId: 'recent', requestCursor: null }, detail: null, deletionId: 'c_12345678abcd',
    });
    for (const raw of [null, {}, '', 'f.req=broken', body([null])]) {
        assert.deepEqual(parseGeminiRequest(raw), { list: null, detail: null, deletionId: null });
    }
});

test('document queries share one lazy response scan and parsed sections, preserving ambiguous title rejection', () => {
    const section = 'Document source paragraph with sufficient content to count as a complete section. '.repeat(4);
    const content = Object.freeze(['doc1', Object.freeze([Object.freeze([section, 'https://example.com/doc'])])]);
    const one = '# Report\n\n' + 'first report body '.repeat(25);
    const two = '# Report\n\n' + 'another report body '.repeat(25);
    let scans = 0;
    const source = { get evidence() { scans++; return [content, one, two]; } };
    const reader = createDocumentReader(source);
    assert.equal(scans, 0, 'responses without document queries do no document work');
    const first = reader.byId('doc1');
    assert.deepEqual(first?.sections, [section]);
    assert.equal(reader.byId('c_doc1')?.sections, first?.sections, 'aliases reuse the same parsed node');
    assert.equal(reader.byId('missing'), null);
    assert.equal(reader.byTitle({ id: 'doc1', title: 'Report' }), '', 'two distinct bodies cannot establish one document');
    assert.equal(scans, 1);
    assert.equal(Object.hasOwn(content, 'contentMatch'), false);
});

test('credential boundary rejects wrong field types before bootstrap consumes them', () => {
    const parsed = parseGeminiCredential({ sid: 12, at: {}, bl: 'build', lastUsed: Infinity,
        accountSlot: ['u0'], accountId: 'local-account' });
    assert.equal(parsed.sid, undefined);
    assert.equal(parsed.at, undefined);
    assert.equal(parsed.bl, 'build');
    assert.equal(parsed.lastUsed, undefined);
    assert.equal(parsed.accountSlot, undefined);
    assert.equal(parsed.accountId, 'local-account');
    assert.throws(() => parseGeminiCredential({ sid: 'sid', accountObservation: { providerId: 'gemini' } }));
});
});

__suiteDescribe("gemini_document_ownership", () => {
// Independently authored wire documents and output expectations. Field 13 is a
// repeated document parallel to the candidate list, not content alternatives.
function parse(documents: unknown[], markdown: string[], selected: number) {
    const wire = coverageWire(documents, markdown.map((body, index) => [
        'rc_draft_' + index, [[body]],
    ]), 'rc_draft_' + selected);
    return mergeConversationPages([parseGeminiRpcConversation(wire, {
        account: fixtureAccount('gemini'), providerId: 'gemini',
    })], undefined, true);
}

test('candidate identity selects its parallel document even when another document matches its Markdown', () => {
    for (const selected of [0, 1]) {
        const documents = ['Native first.', 'Native second.'].map(body => [[citationText(body)]]);
        const result = parse(documents, ['Native second.', 'Native first.'], selected);
        assert.equal(result.conversation.detail.quality.status, 'complete');
        const assistant = result.conversation.detail.messages.find(message => message.role === 'assistant');
        assert.equal(assistant?.id, 'rc_draft_' + selected);
        assert.deepEqual(assistant?.content, [{ type: 'paragraph', children: [{ type: 'text',
            text: selected === 0 ? 'Native first.' : 'Native second.',
        }] }]);
        assertDomainClosure(result.conversation.detail);
    }
});

test('CJK delimiter differences and identical draft text do not make document ownership ambiguous', () => {
    for (const markdown of ['推荐**“示例”**方案', '推荐“示例”方案']) {
        const result = parse([[[citationText('推荐“示例”方案')]], [[citationText('推荐“示例”方案')]]],
            [markdown, markdown], 1);
        assert.equal(result.conversation.detail.quality.status, 'complete');
        assert.deepEqual(result.conversation.detail.messages[1].content,
            [{ type: 'paragraph', children: [{ type: 'text', text: '推荐“示例”方案' }] }]);
    }
});

test('missing, empty or rejected selected document never borrows a matching neighbor', () => {
    for (const selectedDocument of [undefined, [[]], [[citationText('Native selected.'), [null, null, null, null, null, null, null, 'unsupported']]]]) {
        const documents = [[[citationText('Selected Markdown.')]]];
        if (selectedDocument !== undefined) documents.push(selectedDocument);
        const result = parse(documents, ['Other Markdown.', 'Selected Markdown.'], 1);
        assert.ok(JSON.stringify(result.conversation.detail.messages[1].content).includes('Selected Markdown.'));
        assert.ok(!JSON.stringify(result.conversation.detail.messages[1].content).includes('Native selected.'));
        if (selectedDocument?.[0]?.length) assert.equal(result.conversation.detail.quality.status, 'partial');
    }
});

test('resources in an unselected document cannot leak through a rejected selected document', () => {
    for (const selected of [0, 1]) {
        const documents = [[[citationText('Other.'), attachmentCard()]],
            [[[null, null, null, null, null, null, null, 'unsupported']]]];
        if (selected === 0) documents.reverse();
        const result = parse(documents, ['Selected Markdown.', 'Selected Markdown.'], selected);
        assert.equal(result.conversation.detail.assets.length, 0);
        assert.equal(result.conversation.detail.quality.status, 'partial');
    }
});

test('a selected nonprimary document retains its own image while excluding the primary image', () => {
    const url = 'https://example.com/selected-image.jpg';
    const result = parse([[[attachmentCard()]], [[citationText('Selected.'), attachmentCard(url)]]],
        ['Other.', 'Selected.'], 1);
    assert.equal(result.conversation.detail.quality.status, 'complete');
    assert.equal(result.conversation.detail.assets.length, 1);
    assert.equal(result.conversation.detail.assets[0].sourceUri, url);
    assertDomainClosure(result.conversation.detail);
});

test('rejected nonprimary document retains its original index for diagnostic replay', () => {
    const rejected = [null, null, null, null, null, null, null, 'unsupported'];
    const documents = [[[citationText('Other.')]], [[rejected]]];
    const result = parse(documents, ['Other.', 'Selected Markdown.'], 1);
    const diagnostic = result.diagnostics.find(d => d.code === 'GEMINI_STRUCTURED_FALLBACK' && d.severity === 'warning');
    assert.ok(diagnostic?.details && typeof diagnostic.details === 'object' && !Array.isArray(diagnostic.details));
    assert.deepEqual(diagnostic.details.rawDocument, documents);
    assert.equal(diagnostic.details.candidateIndex, 1);
    const issue = diagnostic.details.issue;
    assert.ok(issue && typeof issue === 'object' && !Array.isArray(issue));
    assert.equal(issue.path, '/1/0/0');
    assert.deepEqual(diagnostic.details.candidateEvidence,
        { candidateIndex: 1, candidateId: 'rc_draft_1', candidateText: 'Selected Markdown.' });
});

test('selected native formatting and code survive independently of Markdown formatting', () => {
    const code = 'if ok:\n    run()\n';
    const codeNode = Object.assign(Array(4).fill(null), { 3: [code, 'python'] });
    const native = '推荐“示例”方案 a  b **literal**';
    const node = citationText(native, [
        [2, 6, [[null, null, null, null, 2]]],
        [9, 13, [[null, null, null, null, 3]]],
    ]);
    const result = parse([[[citationText('Other body.')]], [[node, codeNode]]],
        ['Other body.', '推荐**“示例”**方案 `a b` literal\n\n```python\nif ok:\nrun()\n```'], 1);
    assert.equal(result.conversation.detail.quality.status, 'complete');
    assert.deepEqual(result.conversation.detail.messages[1].content, [
        { type: 'paragraph', children: [
            { type: 'text', text: '推荐' }, { type: 'strong', children: [{ type: 'text', text: '“示例”' }] },
            { type: 'text', text: '方案 ' }, { type: 'inlineCode', code: 'a  b' },
            { type: 'text', text: ' **literal**' },
        ] },
        { type: 'code', code, language: 'python' },
    ]);
});
});

__suiteDescribe("gemini_image_source_evidence", () => {
test__s5('Gemini image source evidence preserves a JSON-only wire snapshot', () => {
    const tuple = [
        'https://lh3.googleusercontent.com/source-evidence',
        640, 480, 'image-token',
        { nested: [null, true, 7, 'text', { captured: 'value' }] },
    ];
    const [image] = extractImageEvidence([tuple]);
    assert.ok(image);
    assert.equal(image.sourceEvidence?.detectorKind, 'extractImages [url,w,h]');
    const jsonSnapshot: JsonValue | undefined = image.sourceEvidence?.node;
    assert.deepEqual(jsonSnapshot, tuple);
    assert.deepEqual(JSON.parse(JSON.stringify(jsonSnapshot)), tuple);
});

test__s5('Gemini oversized image evidence remains a bounded JSON diagnostic preview', () => {
    const tuple = [
        'https://lh3.googleusercontent.com/source-evidence-large',
        640, 480, 'image-token',
        'X'.repeat(13000),
    ];
    const [image] = extractImageEvidence([tuple]);
    assert.ok(image);
    assert.deepEqual(image.sourceEvidence?.node, {
        truncated: true,
        preview: JSON.stringify(tuple).slice(0, 12000),
    });
    assert.equal(JSON.stringify(image.sourceEvidence?.node).includes('X'.repeat(13000)), false);
});
});

__suiteDescribe("gemini_list_row_boundary", () => {
function sourceRows(key: Parameters<typeof geminiListGen>[0]): unknown[] {
    const { inner } = new GeminiResponseEnvelope(geminiListGen(key)).payload('MaZiqc');
    assert.ok(Array.isArray(inner), 'LIST RPC must contain a decoded inner array');
    const rows: unknown = Array.isArray(inner[2]) ? inner[2] : inner[1];
    assert.ok(Array.isArray(rows), 'fixture must contain LIST rows');
    return rows;
}

test('LIST row boundary turns source fields into typed facts once', () => {
    const row = decodeGeminiListRow(sourceRows('G_LIST_SOURCE_BOUNDARY_07')[0]);
    assert.deepEqual(row, {
        id: 'boundary123', title: 'Source title', createdAt: null,
        updatedAt: 1700000060000, orderTime: 1700000060000
    });
    const page = parseList(geminiListGen('G_LIST_SOURCE_BOUNDARY_07'));
    assert.deepEqual(page.conversations, [{
        id: 'boundary123', title: 'Source title', titleSource: 'provider',
        updatedAt: 1700000060000
    }]);
    assert.deepEqual(page.pageEvidence.keys, [{ id: 'boundary123', time: 1700000060000 }]);
    assert.equal(page.pageEvidence.valid, true);
    assert.equal(page.pageEvidence.ordered, true);
});

test('malformed LIST rows are skipped without certifying a complete page', () => {
    const rows = sourceRows('G_BOUNDARY_LIST_01');
    for (const row of rows.slice(0, 3)) assert.equal(decodeGeminiListRow(row), null);
    const idOnly = decodeGeminiListRow(rows[3]);
    assert.equal(idOnly?.id, 'missingtitle123');
    assert.equal(idOnly?.title, '');
    assert.equal(idOnly?.updatedAt, null);
    assert.equal(idOnly?.orderTime, 0);

    const parsed = parseList(geminiListGen('G_BOUNDARY_LIST_01'));
    assert.equal(parsed.conversations.length, 4);
    assert.equal(parsed.pageEvidence.valid, false);
    assert.equal(parsed.pageEvidence.ordered, false);
    // A key and its timestamp must always describe the same decoded row.
    assert.deepEqual(parsed.pageEvidence.keys.map(item => item.id), parsed.conversations.map(item => item.id));
});

test('ordering evidence requires official timestamps, not alternative or inferred dates', () => {
    const row = decodeGeminiListRow(sourceRows('G_PAGE_OBSERVATION_03')[0]);
    assert.equal(row?.updatedAt, null);
    assert.equal(row?.orderTime, 0);
    const result = parseList(geminiListGen('G_PAGE_OBSERVATION_03'));
    assert.equal(result.pageEvidence.valid, true);
    assert.equal(result.pageEvidence.ordered, false);
    assert.deepEqual(result.pageEvidence.keys, [{ id: 'abcdef123', time: 0 }]);
});

test('detail-side LIST metadata lookup reuses validated row fields', () => {
    const top = new GeminiResponseEnvelope(geminiListGen('G_LIST_SOURCE_BOUNDARY_07'));
    assert.deepEqual(findListConversationMetadata(top, 'boundary123'), {
        id: 'boundary123', title: 'Source title', titleSource: 'rpc',
        updatedAt: 1700000060000
    });
    assert.equal(findListConversationMetadata(top, 'other'), undefined);
    assert.equal(findListConversationMetadata(new GeminiResponseEnvelope(geminiListGen('G_LIST_SOURCE_BOUNDARY_08_2')), 'unknown'), undefined);
});
});

__suiteDescribe("gemini_remaining_fallbacks", () => {
test('recognizing a card must not discard an unknown nonempty sibling branch', () => {
    for (const key of ['G_REMAINING_PLAN_UNKNOWN_SIBLING', 'G_REMAINING_DOCUMENT_UNKNOWN_SIBLING',
        'G_REMAINING_MAP_UNKNOWN_SIBLING', 'G_REMAINING_MAP_ROUTE_UNKNOWN'] as const) {
        const result = parseRemainingFixture(key);
        assert.ok(result.merged.evidence?.unrepresentedContent, key);
        assert.equal(result.domain.detail.quality.status, 'partial', key);
        assert.ok(result.markdown.includes('Before card.') && result.markdown.includes('After card.'), key);
    }
});

test('unbound source identities preserve native text without inventing citations', () => {
    for (const key of ['G_REMAINING_ANNOTATION_NESTED', 'G_REMAINING_ANNOTATION_DIRECT',
        'G_REMAINING_ANNOTATION_ZERO'] as const) {
        const result = parseRemainingFixture(key);
        assertDomainClosure(result.domain.detail);
        assert.equal(result.domain.detail.quality.status, 'partial', key);
        assert.ok(result.merged.evidence?.unrepresentedContent, key);
        assert.ok(result.markdown.includes('Fixture reference'), key);
        assert.ok(!result.markdown.includes('Fallback body remains available.'), key);
        assert.equal(result.domain.detail.messages.flatMap(message => message.citations ?? []).length, 0, key);
        assert.ok(result.merged.diagnostics.some(d => d.code === 'GEMINI_SOURCE_ANNOTATION_FALLBACK'), key);
    }
});

test('parallel candidate bodies preserve the primary document without concatenating branches', () => {
    for (const key of ['G_REMAINING_BODY_SEQUENCES', 'G_REMAINING_BODY_SEQUENCES_LIST'] as const) {
        const result = parseRemainingFixture(key);
        assertDomainClosure(result.domain.detail);
        assert.equal(result.domain.detail.quality.status, 'complete', key);
        assert.ok(!result.merged.evidence?.unrepresentedContent, key);
        assert.ok(result.markdown.includes('First body.'), key);
        assert.doesNotMatch(result.markdown, /Fallback body remains available|Second body|Second list item/);
    }
});

const sources = new Map([1, 2, 3, 4].map(n => [`spp_fixture_${n}`, [{ id: `source-${n}`, url: `https://example.com/source-${n}` }]]));
function textOf(nodes: InlineNode[]): string {
    return nodes.map(node => {
        if (node.type === 'text') return node.text;
        if (node.type === 'inlineCode') return node.code;
        if (node.type === 'inlineMath') return node.source;
        if (node.type === 'lineBreak') return '\n';
        return 'children' in node ? textOf(node.children) : '';
    }).join('');
}
function descendants(nodes: InlineNode[]): InlineNode[] {
    return nodes.flatMap(node => [node, ...('children' in node ? descendants(node.children) : [])]);
}
function citationPositions(nodes: InlineNode[]): Array<{ id: string; offset: number }> {
    let offset = 0;
    const positions: Array<{ id: string; offset: number }> = [];
    const visit = (children: InlineNode[]): void => {
        for (const node of children) {
            if (node.type === 'citationRef') positions.push({ id: node.citationId, offset });
            else if ('children' in node) visit(node.children);
            else offset += textOf([node]).length;
        }
    };
    visit(nodes);
    return positions;
}

test('all 43 diagnostic overflow snippets reject unsupported coordinates without mutation', () => {
    assert.equal(invalidSourceRangeNodes.length, 43);
    const before = JSON.stringify(invalidSourceRangeNodes);
    const excesses = new Set<number>();
    for (const node of invalidSourceRangeNodes) {
        const invalid = node.annotations.filter(a => a.type === 'source' && a.end > node.text.length);
        assert.equal(invalid.length, 1);
        excesses.add(invalid[0].end - node.text.length);
        assert.ok(node.annotations.some(a => a.type === 7));
        assert.equal(convertGeminiInlines(node.text, node.annotations, sources), null);
    }
    assert.deepEqual([...excesses].sort(), [1, 2]);
    assert.equal(JSON.stringify(invalidSourceRangeNodes), before);
});

test('all five legal +2 source/code endpoint controls retain text, code and source identity', () => {
    assert.equal(legalSourceRangeControls.length, 5);
    // Authored output positions. In the fifth snippet, source end 11 is inside
    // a second code span [10, 13); its reference must follow that atomic span.
    const expectedPositions = [
        [{ id: 'source-1', offset: 32 }],
        [{ id: 'source-1', offset: 14 }, { id: 'source-2', offset: 87 }, { id: 'source-3', offset: 194 }],
        [{ id: 'source-1', offset: 14 }, { id: 'source-2', offset: 58 }],
        [{ id: 'source-1', offset: 14 }, { id: 'source-2', offset: 63 }],
        [{ id: 'source-1', offset: 13 }],
    ];
    for (const [index, node] of legalSourceRangeControls.entries()) {
        const result = convertGeminiInlines(node.text, node.annotations, sources);
        assert.ok(result);
        assert.equal(textOf(result), node.text);
        assert.deepEqual(citationPositions(result), expectedPositions[index]);
        for (const annotation of node.annotations) {
            if (annotation.type !== 'source') continue;
            const referenceIds = new Set(annotation.sourceIds.flatMap(id => sources.get(id)?.map(source => source.id) ?? []));
            assert.ok(descendants(result).some(inline => inline.type === 'citationRef' && referenceIds.has(inline.citationId)));
        }
        for (const code of node.annotations.filter(a => a.type === 7)) {
            assert.ok(descendants(result).some(inline => inline.type === 'inlineCode' && inline.code === node.text.slice(code.start, code.end)));
        }
    }
});

test('range validation distinguishes ASCII, CJK and surrogate pairs without changing endpoints', () => {
    for (const text of ['code xy', '中文代码尾巴', '😀code尾巴']) {
        const start = text.startsWith('😀') ? 2 : 0;
        const codeEnd = text.length - 2;
        const code = { start, end: codeEnd, type: 7 } as const;
        const citation = { start, end: text.length, type: 'source', sourceIds: ['spp_fixture_1'] } as const;
        const annotations = [code, { ...citation, sourceIds: [...citation.sourceIds] }];
        const legal = convertGeminiInlines(text, annotations, sources);
        assert.ok(legal);
        assert.equal(textOf(legal), text);
        assert.deepEqual(citationPositions(legal), [{ id: 'source-1', offset: text.length }]);
        for (const excess of [1, 2]) {
            assert.equal(convertGeminiInlines(text, [code, { ...citation, sourceIds: [...citation.sourceIds], end: text.length + excess }], sources), null);
        }
    }
});

test('invalid diagnostic source ranges remain partial through RPC and complete pagination', () => {
    const result = parseRemainingFixture('G_REMAINING_RANGES_INVALID');
    assert.equal(result.domain.detail.quality.status, 'partial');
    assert.ok(result.merged.evidence?.unrepresentedContent);
    const fallback = result.merged.diagnostics.find(d => d.code === 'GEMINI_SOURCE_ANNOTATION_FALLBACK');
    assert.ok(fallback?.details && typeof fallback.details === 'object' && !Array.isArray(fallback.details));
    assert.equal(fallback.details.reason, 'source_annotations_unrepresented');
    assert.ok(fallback.details.sourceCitationsJson, 'available source identities must remain in diagnostic evidence');
    assert.ok(!result.markdown.includes('Fallback body remains available.'));
    const assistant = result.domain.detail.messages.find(message => message.role === 'assistant');
    assert.ok(assistant);
    for (const node of invalidSourceRangeNodes) {
        assert.ok(assistant.content.some(block => block.type === 'paragraph' && textOf(block.children) === node.text));
        for (const a of node.annotations.filter(a => a.type === 7)) {
            assert.ok(result.markdown.includes('`' + node.text.slice(a.start, a.end) + '`'));
        }
    }
    assert.ok((result.domain.detail.messages.flatMap(message => message.citations ?? []).length) > 0);
    assertDomainClosure(result.domain.detail);
});

test('legal diagnostic source/code controls traverse the same RPC fixture core without fallback', () => {
    const result = parseRemainingFixture('G_REMAINING_RANGES_LEGAL');
    assert.equal(result.merged.diagnostics.filter(d => d.code === 'GEMINI_STRUCTURED_FALLBACK').length, 0);
    assertDomainClosure(result.domain.detail);
    for (const n of legalSourceRangeControls) {
        for (const a of n.annotations.filter(a => a.type === 7)) assert.ok(result.markdown.includes('`' + n.text.slice(a.start, a.end) + '`'));
    }
});
});

__suiteDescribe("gemini_response_dispatch", () => {
const context = { providerId: 'gemini' };

test('mixed batch decodes transport and shared list payload once, preserving detail metadata', () => {
    const text = detailGen('G_DISPATCH_MIXED_01');
    const counts = new Map<string, number>();
    const original = JSON.parse;
    JSON.parse = (text, reviver) => {
        counts.set(text, (counts.get(text) ?? 0) + 1);
        return original(text, reviver);
    };
    try {
        const response = parseGeminiResponse(text);
        assert.equal(response.hasList, true);
        assert.equal(response.hasDetail, true);
        const list = response.list();
        const detail = response.detail(context);
        assert.equal(list.conversations.length, 1);
        assert.equal(detail.conversation.detail.messages.length, 2);
        assert.equal(detail.conversation.index.title, 'Dispatch title');
        assert.equal(detail.sourceVersion, 1700000010000);
        assert.equal(counts.get(text), 1);
        const listJson = response.envelope.rows('MaZiqc')[0][2];
        assert.equal(typeof listJson, 'string');
        if (typeof listJson === 'string') assert.equal(counts.get(listJson), 1);
    } finally { JSON.parse = original; }
});

test('RPC names inside another RPC body never trigger list or detail dispatch', () => {
    const response = parseGeminiResponse(detailGen('G_DISPATCH_DECOY_01'));
    assert.equal(response.hasList, false);
    assert.equal(response.hasDetail, false);
    assert.equal(response.list().failure, 'invalid_response');
    assert.throws(() => response.detail(context), /detail parse fail: invalid/);
});

test('a detail business error cannot recover another RPC body as successful detail', () => {
    const response = parseGeminiResponse(detailGen('G_DISPATCH_DETAIL_ERROR_01'));
    assert.equal(response.hasDetail, true);
    assert.equal(isConfirmedGeminiDetailNotFound(response.envelope), true);
    assert.throws(() => response.detail(context), /detail parse fail: invalid/);
});

test('framed mixed response keeps complete RPC chunks around malformed chunks and unfinished tails', () => {
    const response = parseGeminiResponse(detailGen('G_DISPATCH_CHUNKED_01'));
    assert.equal(response.hasList, true);
    assert.equal(response.hasDetail, true);
    assert.deepEqual(response.list().conversations, []);
    assert.equal(response.detail(context).conversation.detail.messages.length, 2);
});

test('a LIST-only metadata response stays an index observation, never a Detail result', () => {
    const response = parseGeminiResponse(listGen('G_VERSION_METADATA_ONLY_LIST_01'));
    assert.equal(response.hasList, true);
    assert.equal(response.hasDetail, false);
    assert.equal(response.list().conversations[0].id, 'metadata_chat');
    assert.throws(() => response.detail({ ...context, targetConvId: 'metadata_chat' }), /detail parse fail: invalid/);
});
});

__suiteDescribe("gemini_rpc_capture", () => {
test('captured Detail request binds all seven chronological turns to one conversation', () => {
    const packet = geminiRpcPacket('detail');
    assert.equal(packet.status, 200);
    assert.deepEqual(parseGeminiRequest(packet.requestBody).detail, { conversationId: expected.conversationId, requestCursor: null });
    const evidence = decodeGeminiDetail(packet.responseBody);
    assert.equal(evidence.messages.length, 14);
    assert.equal(evidence.messages[0].rawProviderRequestId, expected.firstRequestId);
    assert.equal(evidence.messages[0].timestamp, expected.firstTimestamp);
    assert.equal(evidence.messages.at(-1)?.timestamp, expected.lastTimestamp);
    const parsed = parseGeminiRpcConversation(packet.responseBody, { providerId: 'gemini' });
    assert.equal(parsed.conversationId, expected.conversationId);
    assert.equal(parsed.transport.nextPageToken, null);
    assert.deepEqual(parsed.diagnostics, []);
    assert.deepEqual(parsed.conversation.detail.messages.map(m => m.role), Array.from({ length: 7 }, () => ['user', 'assistant']).flat());
    assertDomainClosure(parsed.conversation.detail);
});

test('captured empty Pinned response is valid source end for its own request stream', () => {
    const packet = geminiRpcPacket('pinned');
    assert.equal(packet.status, 200);
    assert.deepEqual(parseGeminiRequest(packet.requestBody).list, { streamId: 'pinned', requestCursor: null });
    const parsed = parseList(packet.responseBody);
    assert.deepEqual(parsed.conversations, []);
    assert.equal(parsed.pageEvidence.valid, true);
    assert.equal(parsed.nextPageToken, null);
    assert.equal(parsed.failure, undefined);
});

test('explicit List state variants preserve captured row slots and isolate mutations', () => {
    const baseline = geminiListPage().responseBody;
    const row = geminiListRow('state', 'Renamed conversation', 1700000000);
    assert.equal(row.length, 25);
    editCapturedRpc(baseline, 'MaZiqc', inner => {
        const original = (inner[2] as unknown[][])[0];
        for (let index = 0; index < original.length; index++) {
            if (![0, 1, 5].includes(index)) assert.deepEqual(row[index], original[index]);
        }
    });
    const variant = geminiListVariant([row], 'tC_state');
    const parsed = parseList(variant);
    assert.equal(parsed.conversations[0].id, 'state');
    assert.equal(parsed.conversations[0].title, 'Renamed conversation');
    assert.equal(parsed.conversations[0].updatedAt, 1700000000000);
    assert.equal(parsed.nextPageToken, 'tC_state');
    row[0] = 'c_mutated';
    assert.equal(parseList(variant).conversations[0].id, 'state');
    assert.equal(geminiListPage().responseBody, baseline);
    for (const body of [variant, geminiRpcPacket('detail').responseBody, geminiRpcPacket('pinned').responseBody]) {
        const lines = body.split('\n');
        for (let i = 2; i < lines.length - 1; i += 2) assert.equal(Number(lines[i]), lines[i + 1].length + 2);
    }
});

test('identity-only Detail variants retain every captured turn and native framing', () => {
    const baseline = geminiRpcPacket('detail').responseBody;
    const derived = geminiDetailIdentityVariant('isolated_account_chat');
    const restored = editCapturedRpc(derived, 'hNvQHb', inner => {
        const restore = (value: unknown): unknown => value === 'c_isolated_account_chat'
            ? 'c_' + expected.conversationId : Array.isArray(value) ? value.map(restore) : value;
        inner.splice(0, inner.length, ...inner.map(restore));
    });
    assert.equal(restored, baseline);
    assert.equal(geminiRpcPacket('detail').responseBody, baseline);
    const evidence = decodeGeminiDetail(derived);
    assert.equal(evidence.messages.length, expected.messages);
    assert.equal(evidence.messages[0].timestamp, expected.firstTimestamp);
    assert.equal(evidence.messages.at(-1)?.timestamp, expected.lastTimestamp);
    assert.equal(parseGeminiRpcConversation(derived, { providerId: 'gemini' }).conversationId, 'isolated_account_chat');
});
});

__suiteDescribe("gemini_rpc_fixture_closure", () => {
/**
 * Gemini RPC mock responses belong to the provider fixture generators.
 * Real captured decoded payloads may still be rewrapped by geminiDualParse:
 * that is a data-adapter operation, not a synthetic RPC fixture.
 */
const root = join(__dirname);
const excluded = new Set([
    'helpers/geminiDualParse.ts',
]);
const generatorFolder = 'fixtures/providers/';

function testSources(dir: string): string[] {
    const result: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'live' || entry.name === 'node_modules') continue;
            result.push(...testSources(file));
        } else if (entry.isFile() && file.endsWith('.ts')) {
            result.push(file);
        }
    }
    return result;
}

test('Gemini native response constructors remain inside one-key provider fixture generators', () => {
    const violations: string[] = [];
    for (const file of testSources(root)) {
        const path = relative(root, file).replaceAll('\\', '/');
        if (path.startsWith(generatorFolder) || excluded.has(path)) continue;
        const text = readFileSync(file, 'utf8');
        // This catches direct synthetic wrb.fr frames, including multiline array literals.
        // Plain "wrb.fr" expectations and protocol parsing assertions are permitted.
        const inlineFrame = /JSON\.stringify\(\s*\[\s*\[\s*['"]wrb\.fr['"]\s*,/g;
        for (const match of text.matchAll(inlineFrame)) {
            const line = text.slice(0, match.index).split('\n').length;
            violations.push(path + ':' + line + ' constructs a native batchexecute response');
        }
        // Plain malformed bodies and oversize stress responses also belong to Gen(key).
        // Unlike array-based constructors, they previously escaped the basic wrb.fr guard.
        const inlineLiteralMocks = [
            /\b(?:parseList|parseGeminiRpcConversation)\s*\(\s*['"]\[\]['"]/g,
            /\.route\(\s*['"][^'"]*batchexecute[^'"]*['"]\s*,\s*(?:async\s*)?\w+\s*=>\s*\w+\.fulfill\(\s*\{\s*body\s*:\s*['"]\[\]['"]/g,
            /new\s+Response\(\s*['"]\s*['"]\s*\)/g,
            /\btext:\s*['"]\w+['"]\.repeat\(\s*\d{6,}\s*\)/g,
        ];
        for (const pattern of inlineLiteralMocks) {
            for (const match of text.matchAll(pattern)) {
                const line = text.slice(0, match.index).split('\n').length;
                violations.push(path + ':' + line + ' constructs a literal Gemini transport reply');
            }
        }
        // The common sourceList helper is a consumer of listGen(key), not a wire builder.
        if (path === 'helpers/l1SourceFixture.ts') {
            assert.match(text, /return\s+parseList\(geminiListGen\(key\)\)/);
            assert.doesNotMatch(text, /ids\.map\(|\['wrb\.fr',\s*'MaZiqc'/);
        }
    }
    assert.deepEqual(violations, [], 'new mock responses must use the matching Gemini Gen(key) fixture');
});
});

__suiteDescribe("gemini_structured_alternatives", () => {
test('parallel documents select either draft by identity and identical text remains unambiguous', () => {
    for (const key of ['G_REMAINING_ALTERNATIVE_FIRST', 'G_REMAINING_ALTERNATIVE_SECOND',
        'G_REMAINING_ALTERNATIVE_DUPLICATE'] as const) {
        const result = parseRemainingFixture(key);
        assert.equal(result.domain.detail.quality.status, 'complete');
        assert.ok(result.markdown.includes('Selected body.'));
        assert.ok(!result.markdown.includes('Other body.'));
        assert.ok(!result.merged.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK' && d.severity === 'warning'));
    }
});

test('selected nonprimary document does not inherit the other draft image', () => {
    const result = parseRemainingFixture('G_REMAINING_ALTERNATIVE_RESOURCE');
    assert.equal(result.domain.detail.quality.status, 'complete');
    assert.equal(result.domain.detail.assets.length, 0);
    assert.ok(!result.markdown.includes('image.jpg') && !result.markdown.includes('Other body.'));
});

test('opaque unbound citation identities survive normalized document roundtrip', () => {
    for (const id of ['cit_fixture', 'sp_fixture', '0']) {
        const doc = { children: [{ nodeType: 18, text: 'body', annotations: [{ start: 0, end: 0, type: 'source', sourceIds: [id] }] }] };
        assert.deepEqual(decodeGeminiStructuredPayload(doc), doc);
    }
});
});

__suiteDescribe("gemini_structured_card_boundaries", () => {
test('document links validate every chip and do not coerce kinds or accept unsafe URLs', () => {
    const chip = (target: string, kind: string | number = 1) => [[target], 'id', null, 'Title', null, null, null, kind];
    assert.ok(decodeDocumentLinks([chip('https://example.com/one'), chip('http://example.com/two', 3)]));
    for (const target of ['javascript:alert(1)', 'data:text/html,body', 'https://', 'not-a-url']) {
        assert.equal(decodeDocumentLinks([chip('https://example.com/one'), chip(target)]), null);
    }
    assert.equal(decodeDocumentLinks([chip('https://example.com', '1')]), null);
    assert.equal(decodeDocumentLinks([chip('https://example.com', 26)]), null);
    assert.equal(decodeDocumentLinks([chip('https://example.com'), [...chip('https://example.com'), 'unknown-body']]), null);
});

test('research plans reject missing step order and unknown trailing body fields', () => {
    assert.ok(decodeResearchPlan([['Plan', [[1, 'First'], [2, 'Second']], 'id']]));
    assert.equal(decodeResearchPlan([['Plan', [[2, 'First']], 'id']]), null);
    assert.equal(decodeResearchPlan([['Plan', [[1, 'First']], 'id', ['Result'], ['javascript:alert(1)', 0]]]), null);
    assert.equal(decodeResearchPlan([['Plan', [[1, 'First']], 'id', null, null, null, 'Unknown content']]), null);
});

test('mail cards reject unrecognized summary and action extensions', () => {
    const summary = { 133: [null, null, [null, 'Subject', 'Summary', ['Sender']]] };
    const mail = { 1144: ['id', null, null, ['Preview'], [['<p>Body</p>']], 2, false] };
    const card = (action: unknown, extension: unknown) => [[['https://example.com/mail'], [[2, 0, 'request', 'thread', action]], null, null, ['thread'], extension]];
    assert.ok(decodeMailCard(card(mail, summary)));
    assert.equal(decodeMailCard(card({ ...mail, 999: ['Unknown body'] }, summary)), null);
    assert.equal(decodeMailCard(card(mail, { ...summary, 999: ['Unknown body'] })), null);
    assert.equal(decodeMailCard(card({ 1144: ['id', null, null, ['Preview'], 42] }, summary)), null);
});

test('explicit image panels require an actual HTTP URL and image MIME', () => {
    const image = (target: string, mime: string) => citationField(9, [[[
        [null, null, null, [null, 1, 'image-tag', null, [3, null, 'Registration failed'], null, null, null, null, null, null, mime]],
        [target], null, [], null, null, null, null, null, null, null, [true],
    ]]]);
    assert.ok(decodeGeminiStructuredPayload([[[image('https://example.com/image.jpg', 'image/jpeg')]]]));
    for (const target of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'https://']) {
        assert.equal(decodeGeminiStructuredPayload([[[image(target, 'image/jpeg')]]]), null);
    }
    assert.equal(decodeGeminiStructuredPayload([[[image('https://example.com/file', 'text/plain')]]]), null);
});

test('source-only degradation works inside lists, quotes and table cells without repairing bad formatting', () => {
    const text: GeminiStructuredNode = { nodeType: 18, text: 'code tail', annotations: [
        { start: 0, end: 4, type: 7 }, { start: 0, end: 99, type: 'source', sourceIds: ['spp_fixture'] },
    ] };
    const wrappers: GeminiStructuredNode[] = [
        { nodeType: 20, items: [{ children: [text] }] }, { nodeType: 15, children: [text] },
        { nodeType: 17, rows: [{ cells: [{ children: [text] }] }] },
    ];
    for (const node of wrappers) {
        const diagnostics: Diagnostic[] = [];
        let partial = false;
        const blocks = parseGeminiBody('Fallback', { children: [node] }, {
            diagnostics, sourceRef: { providerId: 'gemini', locator: 'fixture' },
            sourceCitations: new Map([['spp_fixture', [{ id: 'source', url: 'https://example.com/source' }]]]),
            onStructuredFallback: () => { partial = true; },
        });
        assert.equal(partial, true);
        assert.ok(JSON.stringify(blocks).includes('"code":"code"'));
        assert.ok(JSON.stringify(blocks).includes('"citationId":"source"'));
        assert.ok(diagnostics.some(d => d.code === 'GEMINI_SOURCE_ANNOTATION_FALLBACK'));
    }
});
});

__suiteDescribe("gemini_structured_diagnostic_regressions", () => {
// Shape-only reproductions of the local 2.1.1 diagnostic report; no private
// conversation text, account IDs, mail links or attachment tokens are retained.
const sources = new Map([
    ['spp_first', [{ id: 'first', url: 'https://example.com/first' }]],
    ['spp_second', [{ id: 'second', url: 'https://example.com/second' }]],
]);
const source = (start: number, end: number, id = 'spp_first'): GeminiAnnotation =>
    ({ start, end, type: 'source', sourceIds: [id] });

test('composite paragraphs and table cells accept resource-owned attachment nodes', () => {
    const paragraph: GeminiStructuredDocument__s13 = { children: [{ nodeType: 'paragraph', children: [
        { nodeType: 18, text: 'An illustration follows. ' }, { nodeType: 0 },
    ] }] };
    assert.deepEqual(geminiStructuredToContent(paragraph), [{ type: 'paragraph', children: [
        { type: 'text', text: 'An illustration follows. ' },
    ] }]);
    const table: GeminiStructuredDocument__s13 = { children: [{ nodeType: 17, rows: [{ cells: [
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
});

__suiteDescribe("gemini_structured_integrity", () => {
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
});

__suiteDescribe("gemini_structured_integrity_export", () => {
const account = fixtureAccount('gemini');
const parse = (key: Parameters<typeof detailGen>[0]) => mergeConversationPages([
    parseGeminiRpcConversation(detailGen(key), { account, providerId: 'gemini' }),
], undefined, true);

test('native content loss produces physical fallback plus partial receipt; same source version can retry and then skip after repair', async t => {
    const host = v2ExportHost(t);
    let source = parse('G_NATIVE_INTEGRITY_UNKNOWN_NEIGHBOR');
    let refreshes = 0;
    // Only the network acquisition is replaced. Parse, admission, storage,
    // composition, Markdown bytes, delivery and receipts use production code.
    t.mock.method(GeminiProvider.prototype, 'fetchConversationDetail', async (accountId: string, id: string) => {
        refreshes++;
        await ingestDetail(accountId, id, source.conversation.detail, source.conversation.index);
    });
    await ingestDetail(account.id, source.conversationId, source.conversation.detail, source.conversation.index);
    const request = exportRequest([source.conversationId], { skipUnchanged: true });
    const first = await runExport(request);
    assert.equal(first.partial, 1);
    assert.equal(first.skipped, 0);
    const record = await getExportRecord(exportKey(source.conversationId));
    assert.equal(record?.status, 'partial');
    assert.equal(record?.otherContentMissing, true);
    assert.equal(shouldSkipExport(record, source.sourceVersion, request), false);
    const markdown = await host.blobs[0].text();
    assert.ok(markdown.includes('Introduction.') && markdown.includes('Conclusion.'));
    assert.ok(!markdown.includes('PLAN_TITLE_ONLY_IN_NATIVE'));
    const beforeRetry = refreshes;
    await runExport(request);
    assert.equal(refreshes, beforeRetry + 1, 'partial source must be retried even at the same version');
    source = parse('G_NATIVE_INTEGRITY_PLAN');
    const repaired = await runExport(request);
    assert.equal(repaired.exported, 1);
    assert.equal(repaired.partial, 0);
    const repairedMarkdown = await host.blobs[host.blobs.length - 1].text();
    assert.ok(repairedMarkdown.includes('Find sources') && repairedMarkdown.includes('Write report'));
    assert.ok(repairedMarkdown.includes('PLAN\\_DESCRIPTION\\_ONLY\\_IN\\_NATIVE'));
    assert.equal((await getExportRecord(exportKey(source.conversationId)))?.status, 'ok');
    const beforeSkip = refreshes;
    assert.equal((await runExport(request)).skipped, 1);
    assert.equal(refreshes, beforeSkip);
});

test('unversioned source-coordinate degradation writes native code and known sources and remains retryable', async t => {
    const host = v2ExportHost(t);
    const source = parse('G_REMAINING_RANGES_INVALID');
    let refreshes = 0;
    t.mock.method(GeminiProvider.prototype, 'fetchConversationDetail', async (accountId: string, id: string) => {
        refreshes++;
        await ingestDetail(accountId, id, source.conversation.detail, source.conversation.index);
    });
    await ingestDetail(account.id, source.conversationId, source.conversation.detail, source.conversation.index);
    const request = exportRequest([source.conversationId], { skipUnchanged: true });
    assert.equal((await runExport(request)).partial, 1);
    const record = await getExportRecord(exportKey(source.conversationId));
    assert.equal(record?.status, 'partial');
    assert.equal(record?.otherContentMissing, true);
    assert.equal(record?.chatTime, undefined, 'an unknown source version cannot establish unchanged input');
    const markdown = await host.blobs[0].text();
    assert.ok(!markdown.includes('Fallback body remains available.'));
    assert.ok(markdown.includes('https://example.com/spp_fixture_'));
    for (const node of invalidSourceRangeNodes) for (const span of node.annotations.filter(a => a.type === 7)) {
        assert.ok(markdown.includes('`' + node.text.slice(span.start, span.end) + '`'));
    }
    const before = refreshes;
    assert.equal((await runExport(request)).skipped, 0);
    assert.equal(refreshes, before + 1);
});

test('versioned source-only loss persists a partial receipt with native body intact and remains eligible for retry', async t => {
    const host = v2ExportHost(t);
    const frames: unknown[] = JSON.parse(sourceReplayFixture().wire);
    frames.unshift(['wrb.fr', 'MaZiqc', JSON.stringify([null, null, [
        ['c_source_replay', 'Unresolved source fixture', null, null, null, [1700000001, 0]],
    ]])]);
    const source = mergeConversationPages([parseGeminiRpcConversation(JSON.stringify(frames), {
        account, providerId: 'gemini',
    })], undefined, true);
    let refreshes = 0;
    t.mock.method(GeminiProvider.prototype, 'fetchConversationDetail', async (accountId: string, id: string) => {
        refreshes++;
        await ingestDetail(accountId, id, source.conversation.detail, source.conversation.index);
    });
    await ingestDetail(account.id, source.conversationId, source.conversation.detail, source.conversation.index);
    const request = exportRequest([source.conversationId], { skipUnchanged: true });
    assert.equal((await runExport(request)).partial, 1);
    const record = await getExportRecord(exportKey(source.conversationId));
    assert.equal(record?.status, 'partial');
    assert.equal(record?.otherContentMissing, true);
    assert.match(await host.blobs[0].text(), /Native source diagnostic\./);
    const before = refreshes;
    assert.equal((await runExport(request)).partial, 1);
    assert.equal(refreshes, before + 1);
});

test('interaction cleanup and a partial-code quote produce complete physical Markdown and a truthful receipt', async t => {
    const host = v2ExportHost(t);
    const markdown = 'Prefix `alpha beta` suffix.\n\n<FollowUp query="Next"/>';
    const quote = 'beta`';
    const start = markdown.indexOf(quote), end = start + quote.length;
    const target = 'https://example.com/verified-source';
    const metadata = [null, [[[quote, null, null, [[start, end], [start, end]]],
        [1], [[target, 'Verified source']], 'spp_owned']]];
    const raw = [
        [[citationText('Other body.')]],
        [[citationText('Prefix alpha beta suffix.', [
            [7, 17, [[null, null, null, null, 3]]],
            [0, 999, [null, null, null, [null, ['spp_owned']]]],
        ])]],
    ];
    const frames: unknown[] = JSON.parse(coverageWire(raw, [
        ['rc_other', [['Other body.']]], ['rc_selected', [[markdown]], metadata],
    ], 'rc_selected'));
    frames.unshift(['wrb.fr', 'MaZiqc', JSON.stringify([null, null, [
        ['c_coverage', 'Verified source fixture', null, null, null, [1700000000, 0]],
    ]])]);
    const source = mergeConversationPages([parseGeminiRpcConversation(JSON.stringify(frames), {
        account, providerId: 'gemini',
    })], undefined, true);
    assert.equal(source.conversation.detail.quality.status, 'complete');
    assert.ok(source.diagnostics.some(d => d.code === 'GEMINI_SOURCE_RANGE_RECOVERED'));
    t.mock.method(GeminiProvider.prototype, 'fetchConversationDetail', async (accountId: string, id: string) => {
        await ingestDetail(accountId, id, source.conversation.detail, source.conversation.index);
    });
    await ingestDetail(account.id, source.conversationId, source.conversation.detail, source.conversation.index);
    const request = exportRequest([source.conversationId], { skipUnchanged: true });
    const exported = await runExport(request);
    assert.equal(exported.exported, 1);
    assert.equal(exported.partial, 0);
    const physical = await host.blobs[0].text();
    assert.match(physical, /Prefix `alpha beta`/);
    assert.ok(physical.includes(target) && physical.includes(' suffix.'));
    assert.doesNotMatch(physical, /Other body|FollowUp/);
    assert.equal((await getExportRecord(exportKey(source.conversationId)))?.status, 'ok');
    assert.equal((await runExport(request)).skipped, 1);
});

test('a missing document body remains retryable and an owned packet supplies the physical file on repair', async t => {
    const host = v2ExportHost(t);
    const oldZip = __getZipConstructor();
    __setZipConstructor(require('../lib/jszip.min.js'));
    t.after(() => __setZipConstructor(oldZip));
    const raw = [[[citationText('See the report.'), citationField(24, [[
        ['http://immersive_entry_chip/report'], 'c_coverage_report', null, 'Owned report', null, null, null, 1,
    ]])]]];
    const foreignBody = '# Foreign body\n\n' + 'This body belongs to another document. '.repeat(8);
    const candidate: unknown[] = ['rc_primary', [['See the report.']], ['c_coverage_report', [[foreignBody]]]];
    const read = () => {
        const frames: unknown[] = JSON.parse(coverageWire(raw, [candidate]));
        frames.unshift(['wrb.fr', 'MaZiqc', JSON.stringify([null, null, [
            ['c_coverage', 'Owned document fixture', null, null, null, [1700000000, 0]],
        ]])]);
        return mergeConversationPages([parseGeminiRpcConversation(JSON.stringify(frames), {
            account, providerId: 'gemini',
        })], undefined, true);
    };
    let source = read();
    let refreshes = 0;
    t.mock.method(GeminiProvider.prototype, 'fetchConversationDetail', async (accountId: string, id: string) => {
        refreshes++;
        await ingestDetail(accountId, id, source.conversation.detail, source.conversation.index);
    });
    await ingestDetail(account.id, source.conversationId, source.conversation.detail, source.conversation.index);
    const request = exportRequest([source.conversationId], { skipUnchanged: true, includeAssets: true });
    assert.equal((await runExport(request)).partial, 1);
    const record = await getExportRecord(exportKey(source.conversationId));
    assert.equal(record?.otherContentMissing, true);
    assert.equal(shouldSkipExport(record, source.sourceVersion, request), false);
    const missingFiles = await readDeliveredFiles(host);
    for (const file of missingFiles) {
        const text = await file.async('string');
        assert.ok(typeof text === 'string' && !text.includes('This body belongs to another document.'));
    }
    const missingBodyMarkdown = missingFiles.find(file => !file.name.startsWith('files/') && file.name.endsWith('.md'));
    assert.ok(missingBodyMarkdown);
    const missingText = await missingBodyMarkdown.async('string');
    assert.ok(typeof missingText === 'string');
    assert.match(missingText, /See the report\./);
    assert.match(missingText, /Owned report/);
    assert.match(missingText, /Attachment download location unavailable/);
    assert.doesNotMatch(missingText, /Unknown error/);
    assert.ok(!missingFiles.some(file => file.name.startsWith('files/') && file.name.endsWith('.md')),
        'an unresolved chip must not create an empty or fabricated report');
    assert.ok(record?.attachmentIssues?.some(issue => issue.code === 'RESOURCE_LOCATOR_UNAVAILABLE'));
    const beforeRetry = refreshes;
    await runExport(request);
    assert.equal(refreshes, beforeRetry + 1);

    const body = '# Owned report\n\nExact owned document body.';
    candidate[30] = [Object.assign(['c_coverage_report', null, 'Owned report', null, body], { 10: 1 })];
    source = read();
    assert.equal(source.conversation.detail.quality.status, 'complete');
    const repaired = await runExport(request);
    assert.equal(repaired.exported, 1);
    assert.equal(repaired.partial, 0);
    const files = await readDeliveredFiles(host);
    const document = files.find(file => file.name.startsWith('files/') && file.name.endsWith('.md'));
    assert.ok(document);
    assert.equal(await document.async('string'), body);
    assert.equal((await getExportRecord(exportKey(source.conversationId)))?.status, 'ok');
    const beforeSkip = refreshes;
    assert.equal((await runExport(request)).skipped, 1);
    assert.equal(refreshes, beforeSkip);
});
});

__suiteDescribe("gemini_structured_protocol", () => {
test('document rendering trailers are separate from body nodes at every sequence length', () => {
    for (const count of [1, 2, 3, 14, 25]) for (const flag of [0, 1, 2, 7, 128]) {
        const nodes = Array.from({ length: count }, (_, index) => citationText(`Paragraph ${index}.`));
        const document = [[nodes, [null, null, null, null, flag]]];
        assert.deepEqual(decodeGeminiStructuredPayload(document), {
            children: nodes.map((_, index) => ({ nodeType: 18, text: `Paragraph ${index}.` })),
        });
    }
});

test('another body, unknown trailer payload or unsupported child rejects the entire document', () => {
    const body = [citationText('Known body.')];
    for (const trailer of [[citationText('Second body.')], [null, null, 'authored text', null, 1],
        [null, null, null, null, 'unknown'], [null, null, null, null, -1]]) {
        assert.equal(decodeGeminiStructuredPayload([[body, trailer]]), null);
    }
    assert.equal(decodeGeminiStructuredPayload([[body], [body]]), null);
    assert.equal(decodeGeminiStructuredPayload([[ [...body, citationField(38, ['unknown'])],
        [null, null, null, null, 1] ]]), null);
});

test('document trailer variants pass native RPC extraction and retain every paragraph in both body paths', () => {
    for (const mode of ['structured', 'markdown'] as const) {
        const result = parseGeminiRpcConversation(detailGen('G_NATIVE_DOCUMENT_TRAILER_MATRIX'), {
            account: fixtureAccount('gemini'), providerId: 'gemini', bodyRepresentation: mode,
        });
        assert.ok(!result.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK'));
        const replies = result.conversation.detail.messages.filter(message => message.role === 'assistant');
        assert.equal(replies.length, 25);
        for (const [index, message] of replies.entries()) {
            const count = [1, 2, 3, 14, 25][Math.floor(index / 5)];
            assert.deepEqual(message.content, Array.from({ length: count }, (_, paragraph) => ({
                type: 'paragraph', children: [{ type: 'text', text: `Paragraph ${paragraph}.` }],
            })));
        }
        assertDomainClosure(result.conversation.detail);
    }
});

test('unsupported selected native documents explicitly fall back without leaking extra body branches', () => {
    for (const key of [
        'G_NATIVE_DOCUMENT_SECOND_BODY', 'G_NATIVE_DOCUMENT_TRAILER_CONTENT',
        'G_NATIVE_DOCUMENT_TRAILER_UNKNOWN_FLAG', 'G_NATIVE_DOCUMENT_TRAILER_NEGATIVE_FLAG',
        'G_NATIVE_DOCUMENT_UNKNOWN_CHILD',
    ] as const) for (const mode of ['structured', 'markdown'] as const) {
        const result = parseGeminiRpcConversation(detailGen(key), {
            account: fixtureAccount('gemini'), providerId: 'gemini', bodyRepresentation: mode,
        });
        if (mode === 'structured') {
            const fallback = result.diagnostics.find(d => d.code === 'GEMINI_STRUCTURED_FALLBACK');
            assert.ok(fallback?.details && typeof fallback.details === 'object' && !Array.isArray(fallback.details), key);
            assert.equal(fallback.details.reason, 'decode_rejected', key);
        }
        const replies = result.conversation.detail.messages.filter(message => message.role === 'assistant');
        assert.equal(replies.length, 1, key);
        assert.deepEqual(replies[0].content, [{ type: 'paragraph', children: [{ type: 'text', text: 'Known body.' }] }], key);
        assertDomainClosure(result.conversation.detail);
    }
});

test('parallel native documents select the primary entry without making identical drafts ambiguous', () => {
    const result = parseGeminiRpcConversation(detailGen('G_NATIVE_DOCUMENT_MULTIPLE_BRANCHES'), {
        account: fixtureAccount('gemini'), providerId: 'gemini',
    });
    assert.ok(!result.diagnostics.some(d => d.code === 'GEMINI_STRUCTURED_FALLBACK'));
    assert.deepEqual(result.conversation.detail.messages[1].content,
        [{ type: 'paragraph', children: [{ type: 'text', text: 'Known body.' }] }]);
    assertDomainClosure(result.conversation.detail);
});

test('citation marker metadata is a nonnegative integer rather than a fixed enum', () => {
    for (const offset of [0, 1, 2, 13, 128]) {
        const node = citationField(31, [citation([fileSource()], '1', offset)]);
        assert.deepEqual(decodeGeminiStructuredNode(node), { nodeType: 'citation', number: 1, title: 'example.txt' });
    }
    for (const offset of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal(decodeGeminiStructuredNode(citationField(31, [citation([fileSource()], '1', offset)])), null);
    }
});

test('short and extended Workspace source metadata decode to the same citation facts', () => {
    for (const extended of [false, true]) for (const source of [[workspace(extended)], [workspace(extended), null, '']]) {
        assert.deepEqual(decodeGeminiStructuredNode(citationField(31, [citation([source])])), {
            nodeType: 'citation', number: 1, title: 'Example source', url: sourceUrl,
        });
    }
});

test('compact web citations retain their marker binding and reject conflicting source numbers', () => {
    const compact = [[' [cite: 1]'], [webSource(1)]];
    assert.deepEqual(decodeGeminiStructuredNode(citationField(31, [compact])), {
        nodeType: 'citation', number: 1, title: 'Example source', url: sourceUrl,
    });
    assert.equal(decodeGeminiStructuredNode(citationField(31, [[[' [cite: 1]'], [webSource(2)]]])), null);
    const empty = citationField(31, [[[' [cite: ]']]]);
    const decoded = decodeGeminiStructuredNode(empty);
    assert.deepEqual(decoded, { nodeType: 'citationGroup', children: [] });
    assert.deepEqual(decodeGeminiStructuredNode(decoded), decoded);
});

test('combined heterogeneous citations preserve source order and validate the whole group', () => {
    assert.deepEqual(decodeGeminiStructuredNode(citationField(31, [citation([fileSource(), webSource(2)], '1, 2')])), {
        nodeType: 'citationGroup', children: [
            { nodeType: 'citation', number: 1, title: 'example.txt' },
            { nodeType: 'citation', number: 2, title: 'Example source', url: sourceUrl },
        ],
    });
    for (const marker of ['1, 1', '1, 01', '1, 0', '1, 2, 3', '1.1']) {
        assert.equal(decodeGeminiStructuredNode(citationField(31, [citation([fileSource(), webSource(2)], marker)])), null);
    }
    const invalid = workspace(true);
    invalid[1] = 'javascript:invalid';
    assert.equal(decodeGeminiStructuredNode(citationField(31, [citation([[invalid]])])), null);
});

test('native field 44 and structured references share one URL identity in both body paths', () => {
    const wire = detailGen('G_NATIVE_CITATION_WORKSPACE');
    for (const mode of ['structured', 'markdown'] as const) {
        const account = fixtureAccount('gemini');
        const result = parseGeminiRpcConversation(wire, { account, providerId: 'gemini', bodyRepresentation: mode });
        const message = result.conversation.detail.messages[1];
        assert.deepEqual(message.citations, [{ id: 'citation-0', url: sourceUrl, title: 'Example source' }]);
        assertDomainClosure(result.conversation.detail);
        assert.ok(JSON.stringify(message.content).includes('"citationId":"citation-0"'));
        const key = fixtureKey(result.conversationId, 'gemini');
        const domain = validateParserDomain({ index: { ...result.conversation.index, key }, detail: { ...result.conversation.detail, key } });
        const output = renderDocumentMarkdown(composeDomainDocument(domain, account), {});
        assert.ok(output.includes(`](https://example.com/source)`), 'rendered Markdown has a linked source');
        assert.ok(!output.includes('> [2]'), 'no phantom source is introduced');
    }
});

test('a later unsupported node still falls back with the same bound source URL', () => {
    const result = parseGeminiRpcConversation(detailGen('G_NATIVE_CITATION_ADAPTER_FALLBACK'), { account: fixtureAccount('gemini'), providerId: 'gemini' });
    const diagnostic = result.diagnostics.find(d => d.code === 'GEMINI_STRUCTURED_FALLBACK');
    assert.ok(diagnostic?.details && typeof diagnostic.details === 'object' && !Array.isArray(diagnostic.details));
    assert.equal(diagnostic.details.sourceCitationsJson, JSON.stringify([['grounding-1', [
        { id: 'citation-0', url: sourceUrl, title: 'Example source' },
    ]]]));
    const message = result.conversation.detail.messages[1];
    assert.deepEqual(message.citations, [{ id: 'citation-0', url: sourceUrl, title: 'Example source' }]);
    assert.deepEqual(message.content, [{ type: 'paragraph', children: [
        { type: 'text', text: 'A claim. ' }, { type: 'citationRef', citationId: 'citation-0', label: '[1]' },
    ] }]);
});

test('compound identifiers and excerpt location groups preserve whole-source bindings', () => {
    for (const [marker, sources, expected] of [
        ['1.4', [[workspace(false)]], [{ title: 'Example source', url: sourceUrl }]],
        ['24,25', [fileSource()], [{ title: 'example.txt' }]],
        ['22-32,112-122', [fileSource()], [{ title: 'example.txt' }]],
    ] as const) {
        const decoded = decodeGeminiStructuredNode(citationField(31, [citation([...sources], marker)]));
        assert.deepEqual(decoded, { nodeType: 'sourceReference', marker: `[cite: ${marker.split(',').join(', ')}]`, sources: expected });
        assert.deepEqual(decodeGeminiStructuredNode(decoded), decoded);
    }
    for (const marker of ['0', '1.0', '2-1', '1,1', '1.4,1.4', '9007199254740992', '1-9007199254740992']) {
        assert.equal(decodeGeminiStructuredNode(citationField(31, [citation([fileSource()], marker)])), null, marker);
    }
    // Multiple legacy source chips must not be guessed into a single location.
    assert.equal(decodeGeminiStructuredNode(citationField(31, [citation([fileSource(), fileSource()], '1.4')])), null);
});

test('compound Workspace references retain URLs through structured, adapter and decoder fallback paths', () => {
    for (const key of [
        'G_NATIVE_CITATION_COMPOUND', 'G_NATIVE_CITATION_COMPOUND_ADAPTER_FALLBACK', 'G_NATIVE_CITATION_COMPOUND_DECODE_FALLBACK', 'G_NATIVE_CITATION_NESTED_METADATA',
    ] as const) for (const mode of ['structured', 'markdown'] as const) {
        const result = parseGeminiRpcConversation(detailGen(key), {
            account: fixtureAccount('gemini'), providerId: 'gemini', bodyRepresentation: mode,
        });
        const message = result.conversation.detail.messages[1];
        assert.deepEqual(message.citations, [{ id: 'citation-0', title: 'Example source', url: sourceUrl }]);
        assert.ok(JSON.stringify(message.content).includes('"citationId":"citation-0"'));
        assert.ok(!JSON.stringify(message.content).includes('cite:'));
        assertDomainClosure(result.conversation.detail);
    }
});

test('file location groups stay hidden in both body paths without inventing one file per number', () => {
    for (const key of ['G_NATIVE_CITATION_FILE_LOCATIONS', 'G_NATIVE_CITATION_FILE_RANGES'] as const) {
        for (const mode of ['structured', 'markdown'] as const) {
            const result = parseGeminiRpcConversation(detailGen(key), {
                account: fixtureAccount('gemini'), providerId: 'gemini', bodyRepresentation: mode,
            });
            const message = result.conversation.detail.messages[1];
            assert.equal(message.citations?.length, 1);
            assert.equal(message.citations?.[0].title, 'example.txt');
            assert.ok(!JSON.stringify(message.content).includes('citationRef'));
            assert.ok(!JSON.stringify(message.content).includes('cite:'));
            assertDomainClosure(result.conversation.detail);
        }
    }
});

test('marker whitespace aliases resolve native groups while plain identifiers and unbound markers stay literal', () => {
    const literal = 'Plain [1] [1.4] [1-2] [1,2]; unknown [cite:9.9].';
    const result = parseGeminiRpcConversation(detailGen('G_NATIVE_CITATION_WHITESPACE'), {
        account: fixtureAccount('gemini'), providerId: 'gemini',
    });
    const message = result.conversation.detail.messages[1];
    assert.equal(message.citations?.length, 1);
    const serialized = JSON.stringify(message.content);
    assert.equal(serialized.split('"citationId":"citation-0"').length - 1, 2);
    assert.ok(serialized.includes(literal));
    assertDomainClosure(result.conversation.detail);
});

test('native bindings belong only to the selected candidate', () => {
    const result = parseGeminiRpcConversation(detailGen('G_NATIVE_CITATION_OTHER_CANDIDATE'), { account: fixtureAccount('gemini'), providerId: 'gemini' });
    const message = result.conversation.detail.messages[1];
    assert.ok(!message.citations?.length);
    assert.ok(JSON.stringify(message.content).includes('Claim[cite:1.4]'));
});

test('code cleanup removes confirmed compound tokens and preserves quoted and unconfirmed tokens', () => {
    const blocks = [{ type: 'code' as const, code: 'label[cite:1.4,2-3] "[cite:1.4,2-3]" [cite:9.9]' }];
    closeGeminiCodeCitations(blocks, ['[cite: 1.4, 2-3]']);
    assert.equal(blocks[0].code, 'label "[cite:1.4,2-3]" [cite:9.9]');
});


test('compact file and web descriptors take their title from the native source metadata', () => {
    const source = fileSource();
    const descriptor = source[1];
    assert.ok(Array.isArray(descriptor));
    source[1] = descriptor.slice(0, 5);
    assert.deepEqual(decodeGeminiStructuredNode(citationField(31, [citation([source])])), {
        nodeType: 'citation', number: 1, title: 'example.txt',
    });
    const web = webSource(1);
    const page = web[3];
    assert.ok(Array.isArray(page));
    page[0] = [sourceUrl, 'Compact source'];
    assert.deepEqual(decodeGeminiStructuredNode(citationField(31, [[[' [cite: 1]'], [web]]])), {
        nodeType: 'citation', number: 1, title: 'Compact source', url: sourceUrl,
    });
});
});

__suiteDescribe("gemini_table_content_recovery", () => {
function markdownFrom(capture: Parameters<typeof detailGen>[0]) {
    const account = fixtureAccount('gemini');
    const parsed = parseGeminiRpcConversation(detailGen(capture), { providerId: 'gemini' });
    const key = fixtureKey(parsed.conversationId, 'gemini');
    const domain = validateParserDomain({
        index: { ...parsed.conversation.index, key },
        detail: { ...parsed.conversation.detail, key },
    });
    return renderDocumentMarkdown(composeDomainDocument(domain, account), {});
}

function tableFrom(key: Parameters<typeof detailGen>[0]) {
    const parsed = parseGeminiRpcConversation(detailGen(key), { providerId: 'gemini' });
    const answer = parsed.conversation.detail.messages.find(message => message.role === 'assistant');
    const table = answer?.content.find(block => block.type === 'table');
    assert.ok(table);
    return table;
}

for (const key of ['G_TABLE_RESTORE_LL1_20', 'G_TABLE_RESTORE_LL1_23'] as const) {
    test(`${key}: preserves native header content and restores each missing last-column production`, () => {
        const table = tableFrom(key);
        const headers = table.headerRows?.[0].cells;
        assert.equal(headers?.length, 10);
        assert.equal(headers?.[7].colSpan, 2);
        assert.deepEqual(headers?.[7].children, [
            { type: 'inlineMath', source: '(' },
            { type: 'text', text: '\\vert{}' },
            { type: 'inlineMath', source: ')' },
        ]);
        assert.deepEqual(table.rows.map(row => row.cells.length), [11, 11, 11]);
        const expectedTails = key === 'G_TABLE_RESTORE_LL1_20'
            ? ["E' \\to \\epsilon", "T' \\to \\epsilon", 'F_{\\text{tail}} \\to \\epsilon']
            : Array(3).fill('\\epsilon');
        assert.deepEqual(table.rows.map(row => row.cells.at(-1)?.children),
            expectedTails.map(source => [{ type: 'inlineMath', source }]));
        const markdown = markdownFrom(key);
        assert.ok(markdown.includes('<th colspan="2"><code>(</code>\\vert{}<code>)</code></th>'));
        const rows = [...markdown.matchAll(/<tr><td>.*?<td><code>([^<]+)<\/code><\/td><\/tr>/g)];
        assert.deepEqual(rows.map(row => row[1]), expectedTails.map(source => source.replaceAll("'", "&#39;")));
    });
}

test('preserves existing cell math and recovers the independently marked suffix', () => {
    const table = tableFrom('G_TABLE_RESTORE_SUPERSCRIPT_46');
    assert.deepEqual(table.rows[0].cells.at(-1)?.children, [
        { type: 'inlineMath', source: '0.0210' },
        { type: 'text', text: ' (SE' },
        { type: 'inlineMath', source: '^2' },
        { type: 'text', text: ')' },
    ]);
});

test('recovered superscript stays math in emitted Markdown', () => {
    const markdown = markdownFrom('G_TABLE_RESTORE_SUPERSCRIPT_46');
    assert.ok(markdown.includes('$0.0210$ (SE$^2$)'));
});

test('a conflicting header or ambiguous duplicate Markdown tables cannot supply cells', () => {
    for (const key of ['G_TABLE_RESTORE_CONFLICT', 'G_TABLE_RESTORE_AMBIGUOUS'] as const) {
        const table = tableFrom(key);
        assert.equal(table.headerRows?.[0].cells.length, 10);
        assert.deepEqual(table.rows.map(row => row.cells.length), [10, 10, 10]);
    }
});
});

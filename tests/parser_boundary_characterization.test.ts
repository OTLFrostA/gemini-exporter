import { describe as __suiteDescribe } from 'node:test';
import { createDocumentReader } from "../src/l1/parsers/gemini/rpc/sourceAttachments.js";
import { type GeminiMessageEvidence } from "../src/l1/parsers/gemini/rpc/detailEvidence.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseList } from "../src/l1/parsers/gemini/rpc/parseList.js";
import { listGen as geminiListGen } from "./fixtures/providers/gemini.js";
import { detailGen as geminiDetailGen } from "./fixtures/providers/geminiDetail.js";
import { decodeGeminiDetail } from "../src/l1/parsers/gemini/rpc/detailDecoder.js";
import { findTurnsDeep } from "../src/l1/parsers/gemini/rpc/detailDecoder.js";
import { robustFirstPayload } from "../src/l1/parsers/gemini/rpc/extractors.js";
import { extractModelCandidates } from "../src/l1/parsers/gemini/rpc/extractors.js";
import { decodeTurn } from "../src/l1/parsers/gemini/rpc/extractors.js";
import { extractCandidateText } from "../src/l1/parsers/gemini/rpc/extractors.js";
import { extractThoughts } from "../src/l1/parsers/gemini/rpc/extractors.js";
import { extractCitations } from "../src/l1/parsers/gemini/rpc/extractors.js";
import { extractInnerPayload } from "../src/l1/parsers/gemini/rpc/payload.js";
import { extractNextPageToken } from "../src/l1/parsers/gemini/rpc/payload.js";
import { extractImages } from "./helpers/recordFixture/attachments.js";
import { extractUserFiles } from "./helpers/recordFixture/attachments.js";
import { extractDocumentsMeta } from "./helpers/recordFixture/attachments.js";
import { decodeGeminiStructuredPayload } from "../src/l1/parsers/gemini/rpc/structuredContent.js";
import { type GeminiStructuredDocument } from "../src/l1/parsers/gemini/rpc/structuredContent.js";
import { decodeGeminiTurn } from "../src/l1/parsers/gemini/rpc/turnResources.js";
import { decodeGeminiUserResources } from "../src/l1/parsers/gemini/rpc/turnResources.js";
import { decodeGeminiCandidateResources } from "../src/l1/parsers/gemini/rpc/turnResources.js";
import { structuredBodyAttachments } from "../src/l1/parsers/gemini/shared/contentAdapter.js";
import { extractResponseImageEvidence } from "../src/l1/parsers/gemini/rpc/sourceAttachments.js";
import { fixtureAccount } from "./helpers/domainFixture.js";
import { type ListParseResult } from "../src/l1/parsers/gemini/rpc/parseList.js";
import { type DetailParseResult } from "../src/l1/client/gemini/api/detailTypes.js";
import { type GeminiDetailEvidence } from "../src/l1/parsers/gemini/rpc/detailEvidence.js";
import { type DecodedGeminiCandidate } from "../src/l1/parsers/gemini/rpc/extractors.js";
import { decodeCandidateArtifacts } from "../src/l1/parsers/gemini/rpc/candidateArtifacts.js";
import { parseGeminiRpcConversation } from "../src/l1/parsers/gemini/rpc/parseConversation.js";
import { type DomainMessage } from "../src/l2/conversationDetail.js";
import { type ListParseDiagnostics } from "../src/l1/parsers/gemini/rpc/parseList.js";
import { type GeminiProtocolModule } from "../src/l1/protocol/gemini/protocol.js";
import { type isConfirmedDeletedError } from "../src/l1/protocol/gemini/protocol.js";
import { type classifyDetailError } from "../src/l1/protocol/gemini/protocol.js";
import { type ListFailureDiagnostics } from "../src/l1/client/aiProvider.js";
import { type Diagnostic } from "../src/shared/diagnostics/diagnostic.js";
import { type ChatGPTApiConversation } from "../src/l1/parsers/chatgpt/chatgptTypes.js";
import { type ChatGPTNodeMessage } from "../src/l1/parsers/chatgpt/chatgptTypes.js";
import { type ChatGPTConversationNode } from "../src/l1/parsers/chatgpt/chatgptTypes.js";
import test__s4 from "node:test";
import assert__s4 from "node:assert";
import Proto from "../src/l1/protocol/gemini/protocol.js";
import { deleteGen as geminiDeleteGen } from "./fixtures/providers/geminiDelete.js";
import { requestGen as geminiListRequestGen } from "./fixtures/providers/geminiListRequest.js";
import { deleteRequestGen as geminiDeleteRequestGen } from "./fixtures/providers/geminiDeleteRequest.js";
import test__s5 from "node:test";
import { decodeGeminiStructuredNode } from "../src/l1/parsers/gemini/rpc/structuredContent.js";
import { decodeGeminiStructuredPayload as decodeBody } from "../src/l1/parsers/gemini/rpc/structuredContent.js";
import { fixtureKey } from "./helpers/domainFixture.js";
import { fixtureAccountFor } from "./helpers/domainFixture.js";
import { validateParserDomain } from "../src/l2/runtimeValidation.js";
import test__s6 from "node:test";
import { spawnSync } from "node:child_process";
import { parseGeminiBody } from "../src/l1/parsers/gemini/shared/contentAdapter.js";
import { composeDomainDocument } from "../src/l3b/compose/composeDomainDocument.js";
import { renderDocumentMarkdown } from "../src/l4/format/markdown/renderMarkdown.js";
import { type DomainConversationWithDetail } from "../src/l2/conversation.js";
import test__s7 from "node:test";
import { type GeminiAttachmentNode } from "../src/l1/parsers/gemini/rpc/structuredContent.js";
import { type GeminiStructuredDocument as GeminiStructuredDocument__s7 } from "../src/l1/parsers/gemini/rpc/structuredContent.js";
import { type ImageAttachment } from "../src/l1/parsers/gemini/rpc/sourceAttachments.js";
import test__s9 from "node:test";
import { historicalFixture } from "./helpers/nativeFixture.js";
import { rpcFixture } from "./helpers/nativeFixture.js";
import { mergeConversationPages } from "../src/l1/parsers/gemini/rpc/mergePages.js";
import { useIndexStorage } from "./helpers/indexStorage.js";
import { parseGeminiTakeoutZipArchive } from "../src/l1/imports/takeout/readArchive.js";
import { GEMINI_JSPB_SCHEMA } from "../src/l1/parsers/gemini/rpc/extractors.js";
import { createSourceResourceContext } from "../src/l1/resources/sourceResources.js";
import test__s11 from "node:test";
import { composeFixture } from "./helpers/documentFixture.js";
import test__s14 from "node:test";
import { parseGeminiDomIndex } from "../src/l1/parsers/gemini/dom/parseIndex.js";
import { isReservedRoute } from "../src/l1/protocol/gemini/url.js";

__suiteDescribe("parser_boundary_characterization", () => {
// Synthetic boundary probes based on existing gemini_parser/parse_observability
// fixtures; they characterize current behavior, not new wire compatibility.
// The final test reuses sanitized Tier-2 wire evidence from PR #705.
const ID = 'c_boundary12345678';
function turn(prompt = 'Boundary user prompt', seconds: number | null = 1700000000, candidates: unknown[] = [['rc_boundary', [['Boundary model answer'], 'en']]]): unknown[] {
    return [[ID, 'r_AB12'], seconds === null ? null : [seconds, 500000000], [[prompt]], [candidates]];
}

test('wire framing: complete chunks survive a malformed chunk and an unfinished tail', () => {
    const first = ['wrb.fr', 'MaZiqc', '[["quoted [bracket] and \\"escape\\""]]'];
    const second = ['wrb.fr', 'hNvQHb', '[]'];
    const input = geminiListGen('G_BOUNDARY_FRAMING_MIXED_01');
    assert.deepEqual(robustFirstPayload(input), [first, second]);
    assert.deepEqual(robustFirstPayload('[["closed string"'), [['closed string']]);
    assert.equal(robustFirstPayload('[["unfinished'), null);
    assert.equal(robustFirstPayload('{"not":"an array"}'), null);
});

test('inner payload decoding does not yet validate the decoded shape', () => {
    for (const [inner, key] of [
        [null, 'G_BOUNDARY_DETAIL_INNER_NULL_01'],
        [[], 'G_BOUNDARY_DETAIL_INNER_ARRAY_01'],
        [{ unexpected: true }, 'G_BOUNDARY_DETAIL_INNER_OBJECT_01'],
        [42, 'G_BOUNDARY_DETAIL_INNER_NUMBER_01'],
        ['scalar', 'G_BOUNDARY_DETAIL_INNER_SCALAR_01'],
    ] as const) {
        const innerStr = JSON.stringify(inner);
        const top: unknown = JSON.parse(geminiDetailGen(key));
        assert.deepEqual(extractInnerPayload(top, { rpcId: 'hNvQHb' }), {
            inner, innerStr, isStandardWrb: true, bardError: null
        });
    }
    const brokenTop: unknown = JSON.parse(geminiDetailGen('G_BOUNDARY_DETAIL_INNER_BROKEN_01'));
    assert.deepEqual(extractInnerPayload(brokenTop, { rpcId: 'hNvQHb' }), {
        inner: null, innerStr: '[broken', isStandardWrb: true, bardError: null
    });
});

test('list: official timestamp and count slots win while extra fields survive only in raw evidence', () => {
    const row = [ID, 'Boundary title - Gemini', [1690000000], [1680000000], 2, [1700000000, 500000000], null, { extra: true }, null, 7];
    const inner = [null, [row], null, null, 'tC_fallback_cursor', { future: true }];
    const parsed = parseList(geminiListGen('G_BOUNDARY_LIST_SLOTS_01'));
    assert.deepEqual(parsed.conversations, [{
        id: 'boundary12345678', title: 'Boundary title - Gemini', titleSource: 'provider',
        createdAt: 1680000000000, updatedAt: 1700000000500
    }]);
    assert.equal(parsed.nextPageToken, 'tC_fallback_cursor');
    assert.deepEqual(parsed._raw, inner);
});

test('list: null rows, truncated rows and malformed titles retain current defaults', () => {
    const ids = ['c_missingtitle123', 'c_nulltitle123456', 'c_objecttitle1234', 'c_blanktitle12345'];
    const parsed = parseList(geminiListGen('G_BOUNDARY_LIST_01'));
    assert.deepEqual(parsed.conversations.map(c => [c.id, c.title, c.titleSource, c.updatedAt, c.messageCount]), [
        [ids[0].slice(2), '', 'provider', undefined, undefined],
        [ids[1].slice(2), '', 'provider', undefined, undefined],
        [ids[2].slice(2), '', 'provider', undefined, undefined],
        [ids[3].slice(2), '', 'provider', undefined, undefined]
    ]);
    assert.equal(parseList(geminiListGen('G_BOUNDARY_LIST_02')).conversations[0].title, 'Secondary title');
});

test('missing or malformed envelopes distinguish list diagnostics from detail failures', () => {
    for (const text of [
        geminiListGen('G_BOUNDARY_LIST_EMPTY_TEXT_01'),
        geminiListGen('G_BOUNDARY_LIST_INVALID_JSON_01'),
        geminiListGen('G_BOUNDARY_LIST_EMPTY_JSON_01'),
        geminiListGen('G_BOUNDARY_LIST_BAD_DETAIL_01'),
        geminiListGen('G_BOUNDARY_LIST_BAD_INNER_01'),
    ]) {
        const list = parseList(text);
        assert.deepEqual(list.conversations, []);
        assert.equal(list.nextPageToken, null);
        assert.equal(list._debug!.error, 'NO_INNER_STR');
    }
    for (const text of [
        geminiDetailGen('G_BOUNDARY_DETAIL_EMPTY_TEXT_01'),
        geminiDetailGen('G_BOUNDARY_DETAIL_EMPTY_JSON_01'),
        geminiDetailGen('G_BOUNDARY_DETAIL_RPC_NULL_01'),
        geminiDetailGen('G_BOUNDARY_DETAIL_RPC_FALSE_01'),
    ]) assert.throws(() => decodeGeminiDetail(text), /detail parse fail: invalid/);
    const empty = decodeGeminiDetail(geminiDetailGen('G_BOUNDARY_DETAIL_RPC_EMPTY_01'), ID);
    assert.equal(empty.id, ID);
    assert.deepEqual(empty.messages, []);
    assert.equal(empty.titleSource, 'default');
    assert.equal(Object.hasOwn(empty, 'timestamp'), false);
    assert.equal(empty.schemaDrift, undefined);
    assert.equal(empty._debug!.turnsLen, 0);
    const emptyList = parseList(geminiListGen('G_BOUNDARY_LIST_03'));
    assert.deepEqual(emptyList.conversations, []);
    assert.equal(emptyList.nextPageToken, 'tC_empty_page');
    assert.equal(emptyList._debug, undefined);
});

test('detail: reverse wire ordering, candidates and authoritative timestamps remain stable', () => {
    const parsed = decodeGeminiDetail(geminiDetailGen('G_BOUNDARY_DETAIL_01'));
    assert.equal(parsed.id, ID);
    assert.deepEqual(parsed.messages.map(m => [m.role, m.content]), [
        ['user', 'Oldest prompt'], ['model', 'Old answer'], ['user', 'Newest prompt'], ['model', 'First variant']
    ]);
    assert.equal(parsed.messages[0].providerRequestId, 'r_AB12');
    assert.equal(parsed.messages[1].id, 'rc_old');
    assert.equal(Object.hasOwn(parsed, 'createdAt'), false);
    assert.equal(parsed.updatedAt, null, 'detail-only wire lacks a conversation metadata version');
    assert.equal(parsed.messages.at(-1)?.timestamp, 1700000010500);
    assert.equal(Object.hasOwn(parsed, 'chatTime'), false);
    assert.equal(parsed.nextPageToken, 'tC_detail_cursor');
    assert.equal(Object.hasOwn(parsed, 'titles'), false);
    assert.equal(parsed.schemaDrift, undefined);
});

test('detail: absent optional fields and truncated candidates do not fabricate messages or timestamps', () => {
    for (const [key, expected] of [
        ['G_BOUNDARY_DETAIL_02', ['User only prompt']],
        ['G_BOUNDARY_DETAIL_03', ['Model only answer']],
    ] as const) {
        const parsed = decodeGeminiDetail(geminiDetailGen(key));
        assert.deepEqual(parsed.messages.map(m => m.content), expected);
        assert.equal(Object.hasOwn(parsed, 'timestamp'), false);
        assert.equal(Object.hasOwn(parsed, 'createdAt'), false);
        assert.equal(parsed.attachmentCount, 0);
        assert.equal(parsed.turnsRejected, undefined);
    }
});

test('detail: extra wrapping and renamed envelope use the existing fallback and report envelope drift', () => {
    const wireTurn = turn();
    const wrapped = { additional: { layers: [[[wireTurn]]] }, extra: true };
    assert.deepEqual(findTurnsDeep(wrapped), [wireTurn]);
    const parsed = decodeGeminiDetail(geminiDetailGen('G_BOUNDARY_DETAIL_RENAMED_01'));
    assert.deepEqual(parsed.messages.map(m => m.content), ['Boundary user prompt', 'Boundary model answer']);
    assert.ok(parsed.schemaDrift?.some(w => w.startsWith('Envelope drift:')));
    assert.deepEqual(parsed._debug!.schemaDriftWarnings, parsed.schemaDrift);
    let atLimit: unknown = [wireTurn];
    for (let depth = 0; depth < 6; depth++) atLimit = [atLimit];
    assert.deepEqual(findTurnsDeep(atLimit), [wireTurn]);
    assert.equal(findTurnsDeep([atLimit]), null);
});

test('detail: another RPC cannot supply turns when the matching RPC has no turns', () => {
    const text = geminiDetailGen('G_BOUNDARY_ALTERNATE_RPC_01');
    const parsed = decodeGeminiDetail(text);
    assert.deepEqual(parsed.messages, []);
    assert.deepEqual(parsed._raw, [null]);
    assert.ok(parsed.schemaDrift?.some(w => w.startsWith('Payload drift:')));
});

test('detail: missing or malformed titles keep the existing newest-wire-prompt fallback', () => {
    for (const key of [
        'G_BOUNDARY_TITLE_UNDEFINED_01', 'G_BOUNDARY_TITLE_NULL_01',
        'G_BOUNDARY_TITLE_EMPTY_01', 'G_BOUNDARY_TITLE_OBJECT_01',
        'G_BOUNDARY_TITLE_BLANK_01', 'G_BOUNDARY_TITLE_SPACE_01',
        'G_BOUNDARY_TITLE_GENERIC_01',
    ] as const) {
        const parsed = decodeGeminiDetail(geminiDetailGen(key));
        assert.equal(parsed.title, 'Newest prompt title');
        assert.equal(parsed.titleSource, 'sniff');
        assert.equal(Object.hasOwn(parsed, 'titles'), false);
    }
    assert.equal(decodeGeminiDetail(geminiDetailGen('G_BOUNDARY_DETAIL_04')).title, 'Flat user prompt title');
});

test('detail: metadata-only and undiscoverable-turn payloads retain distinct drift diagnostics', () => {
    const metadata = decodeGeminiDetail(geminiDetailGen('G_BOUNDARY_DETAIL_05'));
    assert.deepEqual(metadata.messages, []);
    assert.ok(metadata.schemaDrift?.some(w => w.startsWith('metadata-only payload:')));
    assert.deepEqual(metadata._debug!.schemaDriftWarnings, metadata.schemaDrift);
    const missingTurns = decodeGeminiDetail(geminiDetailGen('G_BOUNDARY_DETAIL_06'));
    assert.deepEqual(missingTurns.messages, []);
    assert.ok(missingTurns.schemaDrift?.some(w => w.startsWith('Payload drift:')));
});

test('detail: metadata-only identity and title are decoded once without changing malformed fallbacks', () => {
    const valid = decodeGeminiDetail(geminiDetailGen('G_BOUNDARY_METADATA_TRIMMED_01'));
    assert.deepEqual(valid.metadataConversation, { id: ID, title: 'Metadata title' });
    assert.equal(valid.bodyShape, 'metadata_only');
    assert.deepEqual(valid.messages, []);
    assert.ok(valid.schemaDrift?.some(w => w.startsWith('metadata-only payload:')));

    for (const key of [
        'G_BOUNDARY_METADATA_TITLE_NULL_01',
        'G_BOUNDARY_METADATA_TITLE_NUMBER_01',
        'G_BOUNDARY_METADATA_TITLE_OBJECT_01',
        'G_BOUNDARY_METADATA_TITLE_EMPTY_01',
        'G_BOUNDARY_METADATA_TITLE_BLANK_01',
    ] as const) {
        const parsed = decodeGeminiDetail(geminiDetailGen(key));
        assert.equal(parsed.metadataConversation, undefined);
        assert.equal(parsed.bodyShape, 'metadata_only');
        assert.ok(parsed.schemaDrift?.some(w => w.startsWith('metadata-only payload:')));
    }
    for (const key of [
        'G_BOUNDARY_METADATA_ID_NULL_01',
        'G_BOUNDARY_METADATA_ID_NUMBER_01',
        'G_BOUNDARY_METADATA_ID_REQUEST_01',
        'G_BOUNDARY_METADATA_ID_PREFIX_01',
    ] as const) {
        const parsed = decodeGeminiDetail(geminiDetailGen(key));
        assert.equal(parsed.metadataConversation, undefined);
        assert.ok(!parsed.schemaDrift?.some(w => w.startsWith('metadata-only payload:')));
    }
    const notMetadataOnly = decodeGeminiDetail(geminiDetailGen('G_BOUNDARY_METADATA_NON_METADATA_01'));
    assert.equal(notMetadataOnly.metadataConversation, undefined);
});

test('unidentified metadata cannot become a user message', () => {
    const parsed = decodeGeminiDetail(geminiDetailGen('G_BOUNDARY_DETAIL_07'));
    assert.equal(parsed.turnsRejected, 1);
    assert.ok(!parsed.messages.some(message => message.content === 'Rejected recognizer prompt'));
    assert.ok(parsed.schemaDrift?.some(w => w.includes('Turn ID meta')));
});

test('candidate extraction accepts the compact layout without scanning telemetry as variants', () => {
    const compactCandidate = ['rc_compact', 'Compact answer'];
    const compact = [[ID], null, [], [compactCandidate, 'google', 'S', 6]];
    assert.deepEqual(extractModelCandidates(compact), [['rc_compact', 'Compact answer']]);
    assert.equal(extractCandidateText(['rc_parts', [['Part one', [' + part two'], null, 42], 'en']]), 'Part one + part two');
    for (const candidate of [null, [], ['rc_wrong', { wrong: true }]]) assert.equal(extractCandidateText(candidate), '');
});

const imagesAreRequired: {} extends Pick<GeminiMessageEvidence, 'structuredImages'> ? false : true = true;

test('Turn decoding validates known fields once and honors the selected draft', () => {
    const candidates = [
        ['rc_old', [['Old answer']]],
        ['rc_selected', [['Selected answer']]]
    ];
    const model = [candidates, null, 'google', 'rc_selected'];
    const raw = [[ID, 'r_AB12'], [1700000000, 500000000], [['Prompt']], model];
    const decoded = decodeTurn(raw);
    assert.ok(decoded);
    assert.equal(Object.hasOwn(decoded, 'raw'), false, 'Turn raw array is not an output field');
    assert.equal(decoded.timestamp, 1700000000500);
    assert.equal(decoded.userMessageId, 'r_AB12');
    assert.equal(decoded.fallbackTurnId, 'r_AB12');
    assert.equal(decoded.rawProviderRequestId, 'r_AB12');
    assert.equal(decoded.userText, 'Prompt');
    assert.equal(Object.hasOwn(decoded, 'rawUserPayload'), false, 'User wire evidence stays private to L1 resource decoders');
    assert.equal(decoded.candidate?.index, 1);
    assert.deepEqual(decoded.candidate, {
        source: candidates[1], body: candidates[1][1], index: 1, turnDocument: undefined,
        id: 'rc_selected',
        text: 'Selected answer',
        thoughts: null,
        citations: [],
        sourceAttributions: [],
        groundingCitationMarkers: []
    });

    assert.equal(imagesAreRequired, true);
    const parsed = decodeGeminiDetail(geminiDetailGen('G_BOUNDARY_SELECTED_DRAFT_01'));
    assert.ok(parsed.messages.every(message => Array.isArray(message.structuredImages)));
    const modelMessages = parsed.messages.filter(m => m.role === 'model');
    assert.equal(modelMessages.length, 1);
    assert.equal(modelMessages[0].content, 'Selected answer');
    assert.equal(modelMessages[0].id, 'rc_selected');
    // Source-only evidence retains the provider's original request token.
    for (const message of parsed.messages) {
        assert.equal(message.rawProviderRequestId, 'r_AB12');
        assert.equal(message.providerRequestId, 'r_AB12');
    }
});

test('single Turn decoder closes selected draft and user resources into typed message evidence', () => {
    const candidates: unknown[] = [
        ['rc_old', [['Old answer']]],
        { malformed: true },
        ['rc_selected', [['Selected answer']]]
    ];
    const raw = [[ID, 'r_AB12'], [1700000000, 500000000], [['Prompt']], [candidates, null, 'google', 'rc_selected']];
    const turn = decodeTurn(raw);
    assert.ok(turn);
    const messages = decodeGeminiTurn(turn, raw, createDocumentReader(raw), new Set(), new Set(), ID);
    assert.deepEqual(messages.map(({ role, id, content }) => [role, id, content]), [
        ['user', 'r_AB12', 'Prompt'],
        ['model', 'rc_selected', 'Selected answer']
    ]);
    assert.ok(messages.every(message => !Object.hasOwn(message, 'source')
        && !Object.hasOwn(message, 'body') && !Object.hasOwn(message, 'turnDocument')),
        'downstream message evidence must not expose raw candidate wire slots');
    assert.equal(decodeTurn(null), null);
});

test('Turn Decoder only attributes selected Candidate thoughts, citations and grounding metadata', () => {
    const wrongBody = [
        ['Unselected draft'],
        ['THOUGHT', 'Do not export'],
        ['https://wrong.example/source', 'Wrong source'],
        { '44': [[['[cite: 99]']]] },
    ];
    const source = ['https://selected.example/source', 'Selected source'];
    const selectedBody = [
        ['Selected answer'],
        ['THOUGHT', 'Selected reasoning'],
        source,
        { '44': [[['[cite: 1]']]] },
    ];
    const sourceTable = [null, [[['cited span'], [1], [source], 'spp_selected']]];
    const wrong = ['rc_wrong', wrongBody];
    const selected = ['rc_selected', selectedBody, sourceTable];
    const wire = [[ID, 'r_AB12'], null, [['Question']], [[wrong, selected], null, 'google', 'rc_selected']];
    const decoded = decodeTurn(wire);
    assert.ok(decoded?.candidate);
    assert.equal(decoded.candidate.id, 'rc_selected');
    assert.equal(decoded.candidate?.source, selected);
    assert.equal(decoded.candidate.thoughts, 'Selected reasoning');
    assert.deepEqual(decoded.candidate.citations, [{ url: source[0], title: source[1] }]);
    assert.deepEqual(decoded.candidate.sourceAttributions, [
        { sourceId: 'spp_selected', sources: [{ url: source[0], title: source[1] }] },
    ]);
    assert.deepEqual(decoded.candidate.groundingCitationMarkers, ['[cite: 1]']);
    assert.equal(JSON.stringify(decoded.candidate).includes('wrong.example'), false);

    const malformed = decodeTurn([[ID], null, [], [[['rc_empty', null, { invalid: true }]]]]);
    assert.ok(malformed?.candidate);
    assert.equal(malformed.candidate.thoughts, null);
    assert.deepEqual(malformed.candidate.citations, []);
    assert.deepEqual(malformed.candidate.sourceAttributions, []);
    assert.deepEqual(malformed.candidate.groundingCitationMarkers, []);
});

test('Turn decoder owns text fallbacks without guessing unrelated candidate metadata', () => {
    const fallbackCandidate = ['rc_fallback', { nested: [['Model fallback answer']] }];
    const wire = [[ID, 'r_AB12'], null, [['User prompt']], [[fallbackCandidate]]];
    const decoded = decodeTurn(wire);
    assert.ok(decoded);
    assert.equal(decoded.userText, 'User prompt');
    assert.equal(decoded.candidate?.text, 'Model fallback answer');
    assert.equal(Object.hasOwn(decoded.candidate ?? {}, 'raw'), false);
    assert.equal(decoded.candidate?.body, fallbackCandidate[1]);

    assert.equal(decodeTurn([[ID], null, ['Flat prompt'], null])?.userText, 'Flat prompt');
    assert.equal(decodeTurn([[ID], null, { invalid: true }, null])?.userText, '');
});

test('Turn decoding keeps compact layouts, missing IDs, malformed fields and raw media evidence', () => {
    assert.equal(decodeTurn(null), null);
    const compactCandidate = ['rc_compact', 'Compact answer'];
    const compact = [[ID], null, [], [compactCandidate, 'google', 'S', 6]];
    const single = decodeTurn(compact);
    assert.ok(single);
    assert.equal(single.candidate?.index, 0);
    assert.equal(single.candidate?.id, 'rc_compact');
    assert.equal(single.candidate?.text, 'Compact answer');
    assert.equal(single.candidate?.source, compactCandidate);

    const partialCandidate = [null, [['Text without an ID']]];
    const partial = [[ID], null, [['Prompt']], [[partialCandidate, ['rc_other', [['Other answer']]]]]];
    const decodedPartial = decodeTurn(partial);
    assert.ok(decodedPartial);
    assert.equal(decodedPartial.timestamp, null);
    assert.equal(decodedPartial.rawProviderRequestId, undefined);
    assert.equal(decodedPartial.candidate?.index, 0);
    assert.equal(decodedPartial.candidate?.id, '');
    assert.equal(decodedPartial.candidate?.text, 'Text without an ID');
    assert.equal(decodedPartial.candidate?.source, partialCandidate);
    assert.equal(Object.hasOwn(decodedPartial.candidate ?? {}, 'raw'), false);
    assert.equal(decodeTurn([null, null, null, { malformed: true }]), null);

    const mixedCandidates: unknown[] = [
        ['rc_first', [['Primary answer']]],
        { malformed: true },
        ['rc_target', [['Selected answer']]]
    ];
    const mixed = decodeTurn([[ID], null, [['Prompt']], [mixedCandidates, null, null, 'rc_target']]);
    assert.equal(mixed?.candidate?.index, 2, 'malformed draft must not shift the selected draft index');
    assert.equal(mixed?.candidate?.source, mixedCandidates[2]);
    assert.equal(mixed?.candidate?.text, 'Selected answer');
    assert.equal(decodeTurn([[ID], null, [], [[{ malformed: true }]]])?.candidate, null);

    const rawDocument = [[[null]]];
    const withMedia: unknown[] = [[ID], null, [], [[['rc_media', [['Image prompt']]]]]];
    const modelPayload = withMedia[3];
    if (!Array.isArray(modelPayload)) throw new Error('fixture model payload must be array');
    modelPayload[12] = rawDocument;
    assert.equal(Object.hasOwn(decodeTurn(withMedia) ?? {}, 'rawAnswerDocument'), false);
});

test('Gemini resource decoder consumes raw Turn/Candidate wire slots but exports only typed evidence', () => {
    const wireDocument = [[[Array.from({ length: 35 }, (_v, i) => i === 34 ? ['x^2'] : null)]]];
    const wireCandidate = ['rc_boundary', [['Answer']]];
    const modelPayload: unknown[] = [[wireCandidate]];
    modelPayload[12] = wireDocument;
    const rawTurn: unknown[] = [[ID, 'r_AB12'], null, [['Prompt']], modelPayload];
    const decoded = decodeTurn(rawTurn);
    assert.ok(decoded?.candidate);
    const userResources = decodeGeminiUserResources(rawTurn);
    assert.deepEqual(userResources.images, []);
    assert.deepEqual(userResources.files, []);
    const result = decodeGeminiCandidateResources(
        decoded.candidate, createDocumentReader(rawTurn), new Set(), new Set(), ID
    );
    assert.equal(result.structuredExtraction.status, 'decoded');
    assert.equal(result.generatedFiles.length, 0);
    assert.equal(result.documents.length, 0);
    assert.equal(result.images.length, 0);
    assert.equal(Object.hasOwn(result, 'raw'), false);
    assert.equal(Object.hasOwn(result, 'body'), false);
});

test('thinking and citation helpers ignore malformed nodes, deduplicate URLs and preserve thought order', () => {
    const body = [['Visible answer'], ['THOUGHT', 'First thought'], [null, 'thought-details', 'Second thought'],
        ['THOUGHT', null], ['https://example.com/source', 'First source title'], ['https://example.com/source', 'Duplicate title'],
        ['https://example.com/malformed', 42], ['https://googleusercontent.com/immersive_entry_chip/a', 'Internal chip']];
    assert.equal(extractThoughts(body), 'First thought\n\nSecond thought');
    assert.deepEqual(extractCitations(body), [{ url: 'https://example.com/source', title: 'First source title' }]);
    const parsed = decodeGeminiDetail(geminiDetailGen('G_BOUNDARY_THOUGHT_CITATION_01'));
    const model = parsed.messages.find(m => m.role === 'model');
    assert.equal(model?.content, 'Visible answer');
    assert.equal(model?.thoughts, 'First thought\n\nSecond thought');
    assert.deepEqual(model?.citations, extractCitations(body));
});

test('attachment helpers ignore null, empty and malformed shapes; valid response images remain attachments', () => {
    for (const raw of [null, [], [null, []], { extra: true }, [['broken.png']]]) {
        assert.deepEqual(extractImages(raw), []);
        assert.deepEqual(extractUserFiles(raw), []);
        assert.deepEqual(extractDocumentsMeta(raw), []);
    }
    const url = 'https://lh3.googleusercontent.com/boundary-image';
    const parsed = decodeGeminiDetail(geminiDetailGen('G_BOUNDARY_IMAGE_ATTACHMENT_01'));
    assert.equal(parsed.attachmentCount, 1);
    const model = parsed.messages.find(m => m.role === 'model');
    assert.equal(model?.images?.[0].sourceUrl, url);
    assert.equal(model?.attachments?.[0].type, 'image');
    assert.equal('localName' in model!.attachments![0], false);
    assert.equal(model?.documents, undefined);
});

test('cursor fallback scans extra slots and ignores malformed candidates', () => {
    assert.equal(extractNextPageToken([null, 42, [], { token: 'tC_wrong_shape' }, 'tC_extra']), 'tC_extra');
    assert.equal(extractNextPageToken([null, 'tC_first', 'tC_second']), 'tC_first');
    assert.equal(extractNextPageToken([null, 42, []]), null);
});

test('sanitized Tier-2 wire fixtures retain structured nodes and search images through detail parsing', () => {
    const fixture = (name: string): unknown => JSON.parse(readFileSync(join(__dirname, 'fixtures/provider/structured_rpc', name), 'utf8'));
    const document = fixture('wire-turn-3-12-b-stack.json');
    const decoded = decodeGeminiStructuredPayload(document);
    assert.ok(decoded);
    assert.equal(decoded.children.length, 49);
    assert.equal(decoded.children.filter(node => node.nodeType === 12).length, 13);
    const parsed = decodeGeminiDetail(geminiDetailGen('G_BOUNDARY_CAPTURED_STACK_01'));
    const model = parsed.messages.find(m => m.role === 'model');
    assert.deepEqual(model?.structuredContent, decoded);
    assert.ok(model?.content.includes('CHSH'));
    assert.ok((model?.images?.length ?? 0) > 0);
    assert.equal(parsed.schemaDrift, undefined);
    // A truncated field-12 tree must fall back, retaining the raw answer.
    const fallback = decodeGeminiDetail(geminiDetailGen('G_BOUNDARY_CAPTURED_TRUNCATED_01'))
        .messages.find(m => m.role === 'model');
    assert.equal(fallback?.structuredContent, undefined);
    assert.equal(fallback?.content, model?.content);
});


test('ID-only candidates have no body while nested single-element text remains supported', () => {
    for (const candidate of [['rc_missing'], ['candidate-without-prefix'], ['rc_missing', undefined], ['rc_missing', null]]) {
        assert.equal(extractCandidateText(candidate), '');
        assert.equal(decodeTurn(turn('Prompt', null, [candidate]))?.candidate?.text, '');
    }
    assert.equal(extractCandidateText([['text']]), 'text');
    assert.equal(extractCandidateText(['rc_valid', [['rc_literal answer']]]), 'rc_literal answer');
    const parsed = decodeGeminiDetail(geminiDetailGen('G_BOUNDARY_DETAIL_08'));
    assert.deepEqual(parsed.messages.map(message => [message.role, message.content]), [['user', 'Missing body prompt']]);
});

test('known behavior: a malformed image tuple is eligible for generic user-file fallback', () => {
    const raw = [['', ['https://lh3.googleusercontent.com/example', 'wrong-width', 200]]];
    assert.deepEqual(extractImages(raw), []);
    assert.deepEqual(extractUserFiles(raw), [{
        sourceUrl: 'https://lh3.googleusercontent.com/example', fileName: 'attachment',
        thumbnailUrl: undefined
    }]);
    assert.deepEqual(extractDocumentsMeta(raw), []);
});


test('response images decode shared wire evidence once and refresh it for the next response', () => {
    const generated: unknown[] = Array(16).fill(null);
    generated[2] = 'generated.png';
    generated[3] = 'https://lh3.googleusercontent.com/generated';
    generated[5] = 'same-image-token';
    generated[11] = 'image/png';
    generated[15] = [512, 512, 1000];
    let snapshots = 0;
    Object.defineProperty(generated, 'toJSON', { value: () => {
        snapshots++;
        return Array.from(generated);
    } });
    const inline = ['https://lh3.googleusercontent.com/preview', 512, 512, 'same-image-token'];
    const body = [inline, generated];
    const candidate = ['rc_images', body];
    const structuredContent: GeminiStructuredDocument = { children: [{ nodeType: 0, images: [{
        sourceUrl: 'https://lh3.googleusercontent.com/generated', token: 'same-image-token', isGenerated: true,
    }] }] };
    const evidence = extractResponseImageEvidence(candidate, [body], '', structuredContent);
    const { images } = evidence;
    assert.equal(snapshots, 1, 'overlapping roots must share the decoded diagnostic snapshot');
    assert.equal(images.length, 1);
    assert.equal(images[0].isGenerated, true);
    assert.equal(structuredBodyAttachments(evidence)[0].src, generated[3]);
    assert.equal(snapshots, 1, 'resource adaptation consumes decoded facts without scanning the structured tree');
    assert.equal(images[0].sourceUrl, generated[3], 'generated source supersedes the inline preview');
    generated[3] = 'https://lh3.googleusercontent.com/updated';
    const updated = extractResponseImageEvidence(candidate, [body, generated], '');
    assert.equal(snapshots, 2, 'evidence belongs to one response extraction');
    assert.equal(updated.images[0].sourceUrl, generated[3]);
});

test('response image evidence reuse preserves visible, inline and metadata-only search image rules', () => {
    const visible = { attachmentType: 36, Kc: 'https://lh3.googleusercontent.com/visible' };
    const inline = { attachmentType: 36, Kc: 'https://lh3.googleusercontent.com/inline' };
    const hidden = { attachmentType: 36, Kc: 'https://lh3.googleusercontent.com/metadata-only' };
    const body = [visible];
    const candidate = ['rc_search', body, [{ ...visible }, inline, hidden]];
    assert.deepEqual(extractResponseImageEvidence(candidate, [body], '').images.map(image => image.sourceUrl), [visible.Kc]);
    assert.deepEqual(extractResponseImageEvidence(candidate, [body], `![inline](${inline.Kc})`).images.map(image => image.sourceUrl),
        [visible.Kc, inline.Kc]);
});
});

__suiteDescribe("parse_observability", () => {
const { sourceDetail, sourceMessage } = require('./helpers/l1SourceFixture.js');
const { parseGeminiRpcConversation } = require('../src/l1/parsers/gemini/rpc/parseConversation.js');
const { detailGen: geminiDetailGen } = require('./fixtures/providers/geminiDetail.js') as typeof import('./fixtures/providers/geminiDetail.js');
/**
 * Phase C 规格测试 —— 解析可观测 (P1-8 / P1-9)
 * red-by-design: 修复前失败、修复后通过。
 *
 * 运行：node -r ./tests/ts_register.js --test tests/parse_observability.test.ts
 */

const test = require('node:test');
const assert = require('node:assert');

const detailDecoder = require('../src/l1/parsers/gemini/rpc/detailDecoder.js');
const attachments = require('../src/l1/parsers/gemini/rpc/sourceAttachments.js');
const pagination = require('../src/l1/client/gemini/api/pagination.js');
const { contentQuality } = require('../src/l1/parsers/qualityEvidence.js');

function modelMessageOf(res: any): any {
    return res.messages.find((m: any) => m.role === "model");
}

test('P1-8a: 漂移夹具产出 turnsRejected=1 且 schemaDrift 非空', () => {
    const res = detailDecoder.decodeGeminiDetail(geminiDetailGen('G_OBSERVABILITY_01'));
    assert.strictEqual(res.turnsRejected, 1, 'junk 元素应被计数为拒识');
    assert.ok(Array.isArray(res.schemaDrift) && res.schemaDrift.length > 0, 'schemaDrift 应非空');
});

test('P1-8b: 正常 payload 无拒识、无漂移', () => {
    const res = detailDecoder.decodeGeminiDetail(geminiDetailGen('G_OBSERVABILITY_02'));
    assert.strictEqual(res.turnsRejected || 0, 0, '正常 turn 不应被拒识');
    assert.ok(!res.schemaDrift || res.schemaDrift.length === 0, '正常 payload 不应有 schemaDrift');
});

test('P1-8c: parser 统一质量状态，拒识内容判 partial', () => {
    detailDecoder.decodeGeminiDetail(geminiDetailGen('G_OBSERVABILITY_03'));
    const result = parseGeminiRpcConversation(geminiDetailGen('G_OBSERVABILITY_04'), { providerId: 'gemini', account: fixtureAccount(), targetConvId: 'abc123def456' });
    const quality = result.conversation.detail.quality;
    assert.strictEqual(result.evidence?.rejectedTurns, 1);
    assert.ok(result.diagnostics.some((d: { code: string }) => d.code === 'GEMINI_TURNS_REJECTED'));
    assert.deepEqual(result.evidence?.heuristicDocumentIds ?? [], []);
    assert.strictEqual(quality.status, 'partial', 'turnsRejected>0 必须标 partial，不能是 ok');
});

test('P1-8d: 无漂移时状态保持 ok；heuristic 文档也判 partial', () => {
    const clean = contentQuality({ status: 'unknown' });
    assert.strictEqual(clean.status, 'unknown');
    const heur = contentQuality({ status: 'unknown', heuristicDocumentIds: ['doc'] });
    assert.strictEqual(heur.status, 'partial', 'heuristic 文档链必须标 partial');
});

test('P1-8e: pagination 跨页合并 turnsRejected 与 schemaDrift（去重）', async () => {
    const pages = [
        sourceDetail({ id: 'source_chat_123', messages: [sourceMessage('new')], schemaDrift: ['drift-a'], turnsRejected: 1, nextPageToken: 'tC_older' }),
        sourceDetail({ id: 'source_chat_123', messages: [sourceMessage('old')], schemaDrift: ['drift-b', 'drift-a'], turnsRejected: 2 }),
    ];
    let calls = 0;
    const client = { fetchConversationPage: async () => pages[calls++] };
    const res = await pagination.getConversationDetail(client, "source_chat_123");
    assert.strictEqual(res.evidence?.rejectedTurns, 3, 'turnsRejected 应跨页累加');
    assert.deepStrictEqual([...new Set(res.diagnostics.filter((d: { code: string }) => d.code === 'GEMINI_SCHEMA_DRIFT').map((d: { message: string }) => d.message))].sort(), ["drift-a", "drift-b"], 'schemaDrift 应跨页合并去重');
});

const UUID = "123e4567-e89b-12d3-a456-426614174099";
function strictDocItem(title = "Adequate Strict Title Here"): unknown[] {
    // DEEP_RESEARCH_DOC: [CHIP_URL:0, ?:1, ID:2, TITLE:3, CONTENT_ID:4, TIMESTAMP:5]
    return [["https://x/immersive_entry_chip/abc"], "filler", UUID, title];
}
function flatDocItem(title = "Adequate Flat Title Here"): unknown[] {
    // 非严格形态：item[0] 不是数组，长度 < 4
    return ["https://y/immersive_entry_chip/def", UUID, title];
}

test('P1-9a: 严格路径命中的文档不标 heuristic', () => {
    const out = attachments.extractDocumentsMeta([strictDocItem()]);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].source, undefined, '严格路径不应带 source 标记');
});

test('P1-9b: flat 兜底仅在严格路径产出为 0 时执行', () => {
    const out = attachments.extractDocumentsMeta([strictDocItem(), flatDocItem()]);
    assert.strictEqual(out.length, 1, '已有严格结果时 flat 兜底不应再产出');
    assert.strictEqual(out[0].source, undefined);
});

test('P1-9c: 纯 flat 形态产出标记 source=heuristic-flat', () => {
    const out = attachments.extractDocumentsMeta([flatDocItem()]);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].source, 'heuristic-flat');
});

test('P1-9d: flat 标题至少 8 字符（短标题丢弃）', () => {
    const shortTitle = attachments.extractDocumentsMeta([["https://y/immersive_entry_chip/def", UUID, "shorty"]]);
    assert.strictEqual(shortTitle.length, 0, '6 字符标题不应被 flat 兜底采纳');
    const longTitle = attachments.extractDocumentsMeta([["https://y/immersive_entry_chip/def", UUID, "long enough title here"]]);
    assert.strictEqual(longTitle.length, 1);
    assert.strictEqual(longTitle[0].title, "long enough title here");
});

test('P1-9e: flat.length > 500 直接跳过', () => {
    const big: string[] = ["https://y/immersive_entry_chip/def", UUID, "Adequate Flat Title Here"];
    while (big.length <= 500) big.push("padding-" + big.length);
    const out = attachments.extractDocumentsMeta([big]);
    assert.strictEqual(out.length, 0, '超大 flat 数组应被跳过');
});

test('P1-9e2: strict document time uses canonical finite safe milliseconds', () => {
    const cases: Array<{ wireTime: unknown; expected: number | undefined }> = [
        { wireTime: [1700000000, 500000000], expected: 1700000000000 },
        { wireTime: [1700000000000], expected: 1700000000000 },
        { wireTime: [Number.POSITIVE_INFINITY], expected: undefined },
        { wireTime: [-123], expected: undefined },
        { wireTime: ['1700000000'], expected: undefined },
        { wireTime: [Number.MAX_VALUE], expected: undefined },
    ];
    for (const { wireTime, expected } of cases) {
        const entry = strictDocItem();
        entry[5] = wireTime;
        const result = attachments.extractDocumentsMeta([entry]);
        assert.equal(result.length, 1, 'invalid timestamps must not discard otherwise valid document metadata');
        assert.equal(result[0].createdAt, expected);
    }
});

test('P1-9f: findDocContentById 全等路径不标 contentMatch', () => {
    const real = ["docExact1", "## 真实标题\n\n" + "正文".repeat(100)];
    const found = attachments.createDocumentReader([real]).byId("docExact1");
    assert.ok(found);
    assert.strictEqual(found?.contentMatch, undefined, '全等路径不应标记');
});

test('P1-9g: findDocContentById includes 长元素（>=80）不再命中', () => {
    const elem = "n".repeat(40) + "docLong1" + "m".repeat(40); // 88 字符，确实包含 docId
    assert.strictEqual(elem.length, 88);
    assert.ok(elem.includes("docLong1"));
    const found = attachments.createDocumentReader([[elem]]).byId("docLong1");
    assert.strictEqual(found, null, '>=80 字符的 includes 元素不应命中');
});

test('P1-9h: findDocContentById includes 短元素命中并标 substring', () => {
    const node = ["ab_docShort1_cd", "## 短文档标题\n\n" + "正文".repeat(100)];
    const found = attachments.createDocumentReader([node]).byId("docShort1");
    assert.ok(found);
    assert.strictEqual(found?.contentMatch, 'substring');
    assert.equal(Object.hasOwn(node, 'contentMatch'), false, 'raw source must not be mutated');
});

test('P1-9i: parseDocSections explicitly propagates typed match provenance', () => {
    const arr = [["Section Title", "https://example.com/doc"]];
    const res = attachments.parseDocSections(arr, 'substring');
    assert.strictEqual(res.contentMatch, 'substring', '应透传上游标记');
    assert.equal(Object.hasOwn(arr, 'contentMatch'), false);
    const clean = attachments.parseDocSections([["Section Title", "https://example.com/doc"]]);
    assert.strictEqual(clean.contentMatch, undefined);
});

test('P1-9k: findDocContentById substring match -> parseDocSections 端到端透传 contentMatch 标记', () => {
    const rawSection = "这是一段用于测试文档段落的文字内容，长度确保超过五十个字符以进入 sections 集合。".repeat(2);
    const substringNode = ["prefix_docSubId_suffix", [[rawSection, "https://example.com/doc-link"]]];
    const root = [substringNode];

    const found = attachments.createDocumentReader(root).byId("docSubId");
    assert.ok(found);
    assert.strictEqual(found?.contentMatch, 'substring', 'substring 匹配必须标记为启发式');
    assert.equal(Object.hasOwn(substringNode, 'contentMatch'), false, '原始 RPC 节点不得被修改');

    const res = found;
    assert.strictEqual(res.contentMatch, 'substring', 'parseDocSections 必须透传匹配依据');
    assert.ok(res.contentMarkdown.includes("这是一段用于测试文档段落的文字内容"), 'sections 内容应被正确解析为 markdown');

    // 3. 对照组：全等匹配节点不标记 contentMatch，经 parseDocSections 后 contentMatch 保持 undefined
    const exactNode = ["docExactId", [[rawSection, "https://example.com/doc-link"]]];
    const exactFound = attachments.createDocumentReader([exactNode]).byId("docExactId");
    assert.ok(exactFound);
    assert.strictEqual(exactFound?.contentMatch, undefined, '全等匹配不应带有 contentMatch 标记');
    const exactRes = exactFound;
    assert.strictEqual(exactRes.contentMatch, undefined, '全等匹配经 parseDocSections 不应带有 contentMatch');
});

test('matching content from a frozen RPC node preserves source bytes and heuristic provenance', () => {
    const rawSection = '## A fixed, immutable document section. '.repeat(10);
    const raw = Object.freeze(['prefix_docFrozen_suffix', Object.freeze([[rawSection]])]);
    const source = Object.freeze([raw]);
    const original = JSON.stringify(source);
    const result = attachments.createDocumentReader(source).byId('docFrozen');
    assert.ok(result);
    assert.strictEqual(result?.contentMatch, 'substring');
    assert.strictEqual(result.contentMatch, 'substring');
    assert.strictEqual(JSON.stringify(source), original);
    assert.equal(Object.hasOwn(raw, 'contentMatch'), false);
});

test('P1-9j: heuristic 链的文档最终标 hasFabricatedText=true', () => {
    const clueText = "## End To End Heuristic Title\n\n" + "正文".repeat(100);
    assert.ok(clueText.length > 200);
    const res = detailDecoder.decodeGeminiDetail(geminiDetailGen('G_OBSERVABILITY_DOC_01'));
    const model = modelMessageOf(res);
    assert.ok(model && model.documents && model.documents.length > 0, '应产出 documents');
    const doc = model.documents[0];
    assert.strictEqual(doc.hasFabricatedText, true, 'heuristic 链文档必须标 hasFabricatedText');
});

test('decodeGeminiDetail: strips immersive_entry_chip from document contentMarkdown and extracts heading title', () => {
    const res = detailDecoder.decodeGeminiDetail(geminiDetailGen('G_OBSERVABILITY_DOC_02'));
    const model = modelMessageOf(res);
    assert.ok(model && model.documents && model.documents.length > 0, '应产出 documents');
    const doc = model.documents[0];
    assert.strictEqual(doc.contentMarkdown.includes('immersive_entry_chip'), false, 'contentMarkdown 不应残留 internal chip url');
    assert.strictEqual(doc.title, '虚构城市水力建模分析', 'title 应提取 markdown 首行标题，而非 Document');
});

test('decodeGeminiDetail: ignores document when contentMarkdown contains only chip URL', () => {
    const res = detailDecoder.decodeGeminiDetail(geminiDetailGen('G_OBSERVABILITY_DOC_03'));
    const model = modelMessageOf(res);
    assert.ok(!model || !model.documents || model.documents.length === 0, '仅包含 chip 的空文档不应产出');
});



test('LP-03: only a unique first-heading match can bind an unattributed Research document', () => {
    const matching = '# Target Research Report\n\n' + 'Matched body '.repeat(40);
    const longerOther = '# Unrelated Research Report\n\n' + 'Unrelated body '.repeat(100);
    const meta = { id: 'doc-target', title: 'Target Research Report' };
    assert.equal(attachments.createDocumentReader([longerOther, matching]).byTitle(meta), matching);
    assert.equal(attachments.createDocumentReader([matching, matching]).byTitle(meta), matching, 'repeated same source is not ambiguous');
});

test('LP-03: missing, mentioned-only or ambiguous title must not claim an unrelated document', () => {
    const unrelated = '# Unrelated Report\n\n' + 'This discusses Target Research Report in passing. '.repeat(12);
    const target = '# Target Research Report\n\n' + 'Target body '.repeat(40);
    const otherTarget = '## Target Research Report\n\n' + 'Different body '.repeat(45);
    const meta = { id: 'doc-target', title: 'Target Research Report' };
    assert.equal(attachments.createDocumentReader([unrelated]).byTitle(meta), '', 'body mention is not a document heading');
    assert.equal(attachments.createDocumentReader([unrelated, target, otherTarget]).byTitle(meta), '', 'multiple distinct heading matches are ambiguous');
    assert.equal(attachments.createDocumentReader([unrelated]).byTitle({ ...meta, title: '' }), '', 'untitled document cannot guess');
    assert.equal(attachments.createDocumentReader([unrelated]).byTitle({ ...meta, title: 'Document' }), '', 'placeholder title cannot guess');
});

test('LP-03: Detail decoding leaves unmatched deep research content unattached', () => {
    const model = modelMessageOf(detailDecoder.decodeGeminiDetail(geminiDetailGen('G_OBSERVABILITY_DOC_04')));
    assert.ok(model, 'valid model reply remains present');
    assert.equal(model.documents?.length ?? 0, 0, 'unmatched material must not be manufactured into the target document');
});
});

__suiteDescribe("parser_contract", () => {
// Compile-time regression: native evidence and application views preserve contracts rather
// than widening media/results/dependencies back to an unchecked escape.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type OutputContracts = [
    Assert<Equal<Parameters<typeof isConfirmedDeletedError>[0], string>>,
    Assert<Equal<Parameters<typeof classifyDetailError>[0], string>>,
    Assert<Equal<Parameters<GeminiProtocolModule['isConfirmedDeletedError']>[0], string>>,
    Assert<Equal<Parameters<GeminiProtocolModule['classifyDetailError']>[0], string>>,
    Assert<Equal<ChatGPTApiConversation['mapping'], ReadonlyMap<string, ChatGPTConversationNode>>>,
    Assert<Equal<ReturnType<ChatGPTApiConversation['mapping']['get']>, ChatGPTConversationNode | undefined>>,
    Assert<Equal<ChatGPTApiConversation['createdAtMs'], number | undefined>>,
    Assert<Equal<ChatGPTApiConversation['updatedAtMs'], number | undefined>>,
    Assert<Equal<ChatGPTNodeMessage['createdAtMs'], number | undefined>>,
    Assert<Equal<ListParseResult['_raw'], unknown>>,
    Assert<Equal<DetailParseResult['transport']['decodedPayload'], unknown>>,
    Assert<Equal<DetailParseResult['transport']['bodyShape'], 'metadata_only' | 'empty_turn_array' | 'confirmed_empty_turns' | undefined>>,
    Assert<Equal<ListParseResult['_debug'], ListParseDiagnostics | undefined>>,
    Assert<Equal<ListFailureDiagnostics['details'], Diagnostic['details']>>,
    Assert<Equal<DetailParseResult['conversation']['detail']['messages'][number], DomainMessage>>,
    Assert<Equal<ReturnType<typeof parseList>, ListParseResult>>,
    Assert<Equal<ReturnType<typeof parseGeminiRpcConversation>, DetailParseResult>>,
    Assert<Equal<ReturnType<typeof decodeGeminiDetail>, GeminiDetailEvidence>>,
    Assert<Equal<DecodedGeminiCandidate['source'], unknown[]>>,
    Assert<Equal<Parameters<typeof decodeCandidateArtifacts>[0], unknown[]>>,
];
const contracts: OutputContracts = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];
// The tuple already enforces these contracts at TypeScript compile time.
// A runtime .every(Boolean) assertion on literal true values cannot detect a parser bug.
void contracts;

test('cross-provider list errors preserve JSON diagnostics without a Gemini-shaped contract', () => {
    const failure = { providerId: 'claude', streamId: 'recent', page: 2, requestCursor: 'next',
        failure: 'rate_limited', details: { retryAfterMs: 1000, code: 'throttled' } } satisfies ListFailureDiagnostics;
    assert.deepEqual(failure.details, { retryAfterMs: 1000, code: 'throttled' });
});

test('malformed list and detail wire inputs fail closed without creating conversation evidence', () => {
    const previousWarn = console.warn;
    try {
        console.warn = () => {};
        const parsed = parseList(geminiListGen('G_PARSER_CONTRACT_MALFORMED_LIST_01'));
        assert.deepEqual(parsed.conversations, []);
        assert.equal(parsed.nextPageToken, null);
        assert.equal(parsed._debug?.error, 'NO_INNER_STR');
        assert.throws(
            () => parseGeminiRpcConversation(geminiDetailGen('G_PARSER_CONTRACT_MALFORMED_DETAIL_01'), { account: fixtureAccount('gemini'), providerId: 'gemini' }),
            /detail parse fail:/,
        );
    } finally {
        console.warn = previousWarn;
    }
});
});

__suiteDescribe("parser_payload", () => {
const test = require('node:test');
const assert = require('node:assert');

const { payloadToMs, extractInnerPayload } = require('../src/l1/parsers/gemini/rpc/payload.js');
const { resolveDetailTitle } = require('../src/shared/utils/titleText.js');

test('payloadToMs - converts JSPB timestamp representations to milliseconds', () => {
    assert.strictEqual(payloadToMs([1700000000, 500000000]), 1700000000500);
    assert.strictEqual(payloadToMs([1700000000, 0]), 1700000000000);
    assert.strictEqual(payloadToMs([1700000000]), 1700000000000);

    assert.strictEqual(payloadToMs([1700000000000]), 1700000000000);

    assert.strictEqual(payloadToMs(1700000000), 1700000000000);

    assert.strictEqual(payloadToMs(1700000000123), 1700000000123);

    assert.strictEqual(payloadToMs(null), null);
    assert.strictEqual(payloadToMs(undefined), null);
    assert.strictEqual(payloadToMs(0), null);
    assert.strictEqual(payloadToMs("1700000000"), null);
    assert.strictEqual(payloadToMs([100]), null);
});

test('extractInnerPayload - standard WRB matching', () => {
    const mockTop: unknown = JSON.parse(geminiListGen('G_PARSER_PAYLOAD_TOP_01'));

    const res = extractInnerPayload(mockTop, {
        wrb: "wrb.fr",
        rpcId: "MaZiqc"
    });

    assert.strictEqual(res.isStandardWrb, true);
    assert.strictEqual(res.bardError, null);
    assert.ok(res.inner);
    assert.strictEqual(res.inner[1][0][0], "c_123");
});

test('extractInnerPayload - supports array of target RPC IDs', () => {
    const mockTop: unknown = JSON.parse(geminiListGen('G_PARSER_PAYLOAD_LEGACY_01'));

    const res = extractInnerPayload(mockTop, {
        wrb: "wrb.fr",
        rpcId: ["MaZiqc", "hXcbkd"]
    });

    assert.strictEqual(res.isStandardWrb, true);
    assert.ok(res.inner);
    assert.strictEqual(res.inner[1][0][0], "c_legacy");
});

test('extractInnerPayload - heuristic fallback scanning', () => {
    const innerData = [["turn1"]];
    const mockTop: unknown = JSON.parse(geminiListGen('G_PARSER_PAYLOAD_HEURISTIC_01'));

    const res = extractInnerPayload(mockTop, {
        wrb: "wrb.fr",
        rpcId: "hNvQHb",
        heuristicFilter: (s: string) => s.startsWith("[[")
    });

    assert.strictEqual(res.isStandardWrb, false);
    assert.strictEqual(res.bardError, null);
    assert.deepStrictEqual(res.inner, innerData);
});

test('extractInnerPayload - BardErrorInfo extraction', () => {
    const mockTop: unknown = JSON.parse(geminiListGen('G_PARSER_PAYLOAD_ERROR_01'));

    const res = extractInnerPayload(mockTop, {
        wrb: "wrb.fr",
        rpcId: "MaZiqc"
    });

    assert.strictEqual(res.inner, null);
    assert.strictEqual(res.innerStr, null);
    assert.ok(res.bardError);
    assert.ok(res.bardError.includes("BardErrorInfo"));
});

test('resolveDetailTitle - sniffs valid user prompt', () => {
    const messages = [
        { role: 'user', content: 'Quantum computing and superconducting qubits in 2026\nSecond line' },
        { role: 'model', content: 'Here is a detailed explanation...' }
    ];

    const result = resolveDetailTitle(messages, 'c_12345');
    assert.ok(result);
    assert.strictEqual(result.source, 'derived');
    assert.strictEqual(result.title, 'Quantum computing and superconducting qubits in 2026 Second');
});

test('resolveDetailTitle - returns null for empty, placeholder, or generic user messages', () => {
    assert.strictEqual(resolveDetailTitle(null, 'c_123'), null);
    assert.strictEqual(resolveDetailTitle([], 'c_123'), null);

    assert.strictEqual(resolveDetailTitle([{ role: 'user', content: 'Gemini' }], 'c_123'), null);
    assert.strictEqual(resolveDetailTitle([{ role: 'user', content: 'Untitled' }], 'c_123'), null);
    assert.strictEqual(resolveDetailTitle([{ role: 'user', content: ' ' }], 'c_123'), null);

    assert.strictEqual(resolveDetailTitle([{ role: 'model', content: 'Hello user' }], 'c_123'), null);
});
});

__suiteDescribe("protocol", () => {
// protocol.test.js — protocol anti-corruption layer contract tests (Phase 1).
// Pins the single source of truth: RPC names, token patterns, BL fallback,
// sliding-window limits, deletion anchors, and the _reqid convention.










test__s4('protocol - RPC endpoint names are centralized and match known values', () => {
    assert__s4.strictEqual(Proto.WRB, 'wrb.fr');
    assert__s4.strictEqual(Proto.RPCS.LIST, 'MaZiqc');
    assert__s4.strictEqual(Proto.RPCS.DETAIL, 'hNvQHb');
    assert__s4.strictEqual(Proto.RPCS.LEGACY_LIST, 'b7Lged');
    assert__s4.strictEqual(Proto.RPCS.DELETE, 'GzXR5e');
    assert__s4.strictEqual(Proto.RPCS.GEMS, 'CNgdBe');
});

test__s4('protocol - token keys and extraction patterns are single-sourced', () => {
    assert__s4.strictEqual(Proto.TOKENS.AT, 'SNlM0e');
    assert__s4.strictEqual(Proto.TOKENS.BL, 'cfb2h');

    const html = '<script>var x = {"SNlM0e": "ATToken123456789", "bl": "boq_assistant-bard-web-server_20260901.00_p1"};</script>';
    assert__s4.strictEqual(html.match(Proto.TOKEN_PATTERNS.atFromScript)![1], 'ATToken123456789');
    assert__s4.strictEqual(html.match(Proto.TOKEN_PATTERNS.blKeyFromScript)![1], 'boq_assistant-bard-web-server_20260901.00_p1');
    assert__s4.strictEqual(html.match(Proto.TOKEN_PATTERNS.boqBuildFromScript)![0], 'boq_assistant-bard-web-server_20260901.00_p1');

    const htmlDoc = '<html><head><script>"cfb2h":"boq_assistant-bard-web-server_20260901.00_p1","bl":"boq_assistant-bard-web-server_20260901.00_p1"</script></head></html>';
    assert__s4.strictEqual(htmlDoc.match(Proto.TOKEN_PATTERNS.blCfb2hFromHtml)![1], 'boq_assistant-bard-web-server_20260901.00_p1');
    assert__s4.strictEqual(htmlDoc.match(Proto.TOKEN_PATTERNS.blAssistantFromHtml)![1], 'boq_assistant-bard-web-server_20260901.00_p1');

});

test__s4('protocol - fallback build label is recognizable by configured token extraction', () => {
    // A fallback must be a usable Gemini build label, not a source-file grep target.
    assert__s4.ok(Proto.BL_FALLBACK.startsWith('boq_assistant-bard-web-server_'));
    const script = `<script>build="${Proto.BL_FALLBACK}";</script>`;
    assert__s4.strictEqual(script.match(Proto.TOKEN_PATTERNS.boqBuildFromScript)?.[0], Proto.BL_FALLBACK);
});

test__s4('protocol - LIMITS constants unify the sliding-window checks', () => {
    assert__s4.strictEqual(Proto.LIMITS.SLIDING_WINDOW, 500);
    assert__s4.strictEqual(Proto.LIMITS.SERVER_LIMIT_TEXT, '600条');
});

test__s4('protocol - deletion anchors match the GzXR5e-anchored id and reject decoys', () => {
    const REAL = 'deadbeef00112233';

    // Anchored payload: id directly after the delete-RPC name.
    const anchored = geminiDeleteRequestGen('G_REGRESSION_DECOY_DELETE_REQUEST_01');
    const m1 = anchored.match(Proto.DELETION_ANCHORS[0]);
    assert__s4.strictEqual(m1![1], REAL, 'anchor 1 must extract the id following the delete-RPC name');

    // Quoted-payload shape (response body form).
    const quoted = geminiDeleteGen('G_PROTOCOL_DELETE_RESPONSE_01');
    const m2 = quoted.match(Proto.DELETION_ANCHORS[0]) || quoted.match(Proto.DELETION_ANCHORS[1]);
    assert__s4.strictEqual(m2![1], 'feedface12345678', 'anchored extraction must work on the response shape');


    // A hex token with no delete-RPC anchor must never match.
    const noAnchor = geminiListRequestGen('G_PROTOCOL_NO_DELETE_ANCHOR_REQUEST_01');
    assert__s4.strictEqual(noAnchor.match(Proto.DELETION_ANCHORS[0]), null);
    assert__s4.strictEqual(noAnchor.match(Proto.DELETION_ANCHORS[1]), null);
});

test__s4('protocol - reqid generator increments (frontend fingerprint convention)', () => {
    const next = Proto.createReqidGenerator();
    const a = Number(next());
    const b = Number(next());
    const c = Number(next());
    assert__s4.ok(a >= 100000 && a < 1000000, 'reqid starts from a random 6-digit base');
    assert__s4.strictEqual(b, a + 1, 'reqid must increment by 1, not re-randomize');
    assert__s4.strictEqual(c, a + 2, 'reqid must keep incrementing');
});

test__s4('protocol - Detail rate limiting requires HTTP 429', () => {
    assert__s4.strictEqual(Proto.classifyDetailError('', 429), 'rate_limited');
    assert__s4.strictEqual(Proto.classifyDetailError('["BardErrorInfo",1096]', 200), 'inaccessible');
    assert__s4.strictEqual(Proto.classifyDetailError('RESOURCE_EXHAUSTED', 200), 'parse_error');
    assert__s4.strictEqual(Proto.classifyDetailError('Too many requests', 200), 'parse_error');
});
});

__suiteDescribe("structured_content_single_pass", () => {
interface NodeAccessTracker {
    trackNode<T extends Record<string, unknown>>(id: string, obj: T): T;
    accessCounts: Map<string, number>;
}

function createNodeAccessTracker(): NodeAccessTracker {
    const accessCounts = new Map<string, number>();
    return {
        trackNode<T extends Record<string, unknown>>(id: string, obj: T): T {
            accessCounts.set(id, 0);
            return new Proxy(obj, {
                get(target, prop, receiver) {
                    if (prop === 'nodeType') {
                        accessCounts.set(id, (accessCounts.get(id) ?? 0) + 1);
                    }
                    return Reflect.get(target, prop, receiver);
                }
            });
        },
        accessCounts
    };
}

test__s5('single-pass decode: access count per node in nested list is strictly linear O(1) per node', () => {
    const { trackNode, accessCounts } = createNodeAccessTracker();

    const depth = 6;
    const leaf = trackNode('node_leaf', {
        nodeType: 18,
        text: 'Leaf content'
    });

    let current: Record<string, unknown> = leaf;
    for (let d = depth - 1; d >= 0; d--) {
        const item = { children: [current] };
        current = trackNode(`node_list_${d}`, {
            nodeType: 20,
            items: [item]
        });
    }

    const decoded = decodeGeminiStructuredNode(current);
    assert.ok(decoded);

    // In the old implementation with redundant validation passes,
    // the leaf node was evaluated 2^depth times (2^6 = 64 times).
    // With single-pass decode, every node must be evaluated exactly ONCE.
    assert.strictEqual(accessCounts.get('node_leaf'), 1, 'Leaf nodeType must be accessed exactly once');
    for (let d = 0; d < depth; d++) {
        assert.strictEqual(accessCounts.get(`node_list_${d}`), 1, `List at depth ${d} must be accessed exactly once`);
    }
});

test__s5('single-pass decode: access count per cell child in table is strictly linear', () => {
    const { trackNode, accessCounts } = createNodeAccessTracker();

    const cellText1 = trackNode('cell_1', { nodeType: 18, text: 'Cell 1' });
    const cellText2 = trackNode('cell_2', { nodeType: 18, text: 'Cell 2' });
    const tableNode = trackNode('table', {
        nodeType: 17,
        rows: [
            {
                cells: [
                    { children: [cellText1] },
                    { children: [cellText2] }
                ]
            }
        ]
    });

    const decoded = decodeGeminiStructuredNode(tableNode);
    assert.ok(decoded);
    assert.strictEqual(accessCounts.get('table'), 1);
    assert.strictEqual(accessCounts.get('cell_1'), 1, 'Cell 1 must be decoded exactly once');
    assert.strictEqual(accessCounts.get('cell_2'), 1, 'Cell 2 must be decoded exactly once');
});

test__s5('single-pass decode: annotation access count in TextNode is strictly linear', () => {
    let annotationTypeAccessCount = 0;
    const annotationProxy = new Proxy({
        start: 0,
        end: 4,
        type: 0
    }, {
        get(target, prop, receiver) {
            if (prop === 'type') {
                annotationTypeAccessCount++;
            }
            return Reflect.get(target, prop, receiver);
        }
    });

    const textNode = {
        nodeType: 18,
        text: 'test',
        annotations: [annotationProxy]
    };

    const decoded = decodeGeminiStructuredNode(textNode);
    assert.ok(decoded);
    assert.strictEqual(annotationTypeAccessCount, 1, 'Annotation type must be inspected exactly once');
});

test__s5('single-pass decode: mixed heterogeneous hierarchy (Table -> Cell -> Quote -> OrderedList -> Text) decodes each node once and preserves AST', () => {
    const { trackNode, accessCounts } = createNodeAccessTracker();

    const text = trackNode('hetero_text', { nodeType: 18, text: 'Deepest content' });
    const orderedList = trackNode('hetero_ordered_list', {
        nodeType: 14,
        VHa: 5,
        items: [{ children: [text] }]
    });
    const quote = trackNode('hetero_quote', { nodeType: 15, children: [orderedList] });
    const table = trackNode('hetero_table', {
        nodeType: 17,
        rows: [
            {
                cells: [
                    { children: [quote], colSpan: 2, rowSpan: 1 }
                ]
            }
        ]
    });

    const decoded = decodeGeminiStructuredNode(table);
    assert.ok(decoded);
    assert.strictEqual(accessCounts.get('hetero_table'), 1);
    assert.strictEqual(accessCounts.get('hetero_quote'), 1);
    assert.strictEqual(accessCounts.get('hetero_ordered_list'), 1);
    assert.strictEqual(accessCounts.get('hetero_text'), 1);

    // Verify AST structural integrity without type assertions
    if (decoded.nodeType === 17) {
        const firstRow = decoded.rows[0];
        const firstCell = firstRow?.cells[0];
        assert.strictEqual(firstCell?.colSpan, 2);
        assert.strictEqual(firstCell?.rowSpan, 1);
        const quoteChild = firstCell?.children[0];
        if (quoteChild?.nodeType === 15) {
            const listChild = quoteChild.children[0];
            if (listChild?.nodeType === 14) {
                assert.strictEqual(listChild.VHa, 5);
                const textChild = listChild.items[0]?.children[0];
                if (textChild?.nodeType === 18) {
                    assert.strictEqual(textChild.text, 'Deepest content');
                } else {
                    assert.fail('Expected TextNode child');
                }
            } else {
                assert.fail('Expected OrderedListNode child');
            }
        } else {
            assert.fail('Expected QuoteNode child');
        }
    } else {
        assert.fail('Expected TableNode root');
    }
});

test__s5('deep nesting complexity: depth-20 list confirms linear single-pass node access without exponential explosion', () => {
    const { trackNode, accessCounts } = createNodeAccessTracker();

    let current: Record<string, unknown> = trackNode('deep_leaf', { nodeType: 18, text: 'Deepest' });
    for (let d = 0; d < 20; d++) {
        current = trackNode(`deep_list_${d}`, {
            nodeType: 20,
            items: [{ children: [current] }]
        });
    }

    const decoded = decodeGeminiStructuredNode(current);
    assert.ok(decoded);

    // In exponential 2^d recursion, 20 levels would yield over 1,000,000 evaluations.
    // In single-pass linear O(N) decoding, exactly 21 nodes are registered and each is accessed once.
    assert.strictEqual(accessCounts.size, 21, 'Total registered nodes must be 21');
    for (const [id, count] of accessCounts) {
        assert.strictEqual(count, 1, `Node ${id} must be evaluated exactly once`);
    }
});

test__s5('fail-closed semantics: invalid children at any depth or malformed containers return null', () => {
    const invalidText = decodeGeminiStructuredNode({
        nodeType: 18,
        text: 'hello',
        annotations: [{ start: 0, end: 5, type: 'unknown_invalid_type_123' }]
    });
    assert.strictEqual(invalidText, null);

    const invalidList = decodeGeminiStructuredNode({
        nodeType: 20,
        items: [
            {
                children: [
                    { nodeType: 18, text: 'valid' },
                    { nodeType: 999 } // invalid node type
                ]
            }
        ]
    });
    assert.strictEqual(invalidList, null);

    const invalidTable = decodeGeminiStructuredNode({
        nodeType: 17,
        rows: [
            {
                cells: [
                    {
                        children: [
                            { nodeType: 999 }
                        ]
                    }
                ]
            }
        ]
    });
    assert.strictEqual(invalidTable, null);

    const invalidQuote = decodeGeminiStructuredNode({
        nodeType: 15,
        children: [{ nodeType: 999 }]
    });
    assert.strictEqual(invalidQuote, null);

    assert.strictEqual(decodeGeminiStructuredNode({ nodeType: 20, items: [null] }), null);
    assert.strictEqual(decodeGeminiStructuredNode({ nodeType: 20, items: [{}] }), null);
    assert.strictEqual(decodeGeminiStructuredNode({ nodeType: 20, items: [{ children: 'invalid' }] }), null);
    assert.strictEqual(decodeGeminiStructuredNode({ nodeType: 17, rows: [null] }), null);
    assert.strictEqual(decodeGeminiStructuredNode({ nodeType: 17, rows: [{}] }), null);
    assert.strictEqual(decodeGeminiStructuredNode({ nodeType: 17, rows: [{ cells: [null] }] }), null);
    assert.strictEqual(decodeGeminiStructuredNode({ nodeType: 17, rows: [{ cells: [{}] }] }), null);
    assert.strictEqual(decodeGeminiStructuredNode({ nodeType: 17, rows: [{ cells: 123 }] }), null);
    assert.strictEqual(decodeGeminiStructuredNode({ nodeType: 15, children: 123 }), null);
});

test__s5('edge cases: empty containers preserve original structure', () => {
    const textNoAnnots = decodeGeminiStructuredNode({
        nodeType: 18,
        text: 'hello'
    });
    assert.deepStrictEqual(textNoAnnots, {
        nodeType: 18,
        text: 'hello'
    });

    const textEmptyAnnots = decodeGeminiStructuredNode({
        nodeType: 18,
        text: 'hello',
        annotations: []
    });
    assert.deepStrictEqual(textEmptyAnnots, {
        nodeType: 18,
        text: 'hello',
        annotations: []
    });

    const emptyList = decodeGeminiStructuredNode({
        nodeType: 20,
        items: []
    });
    assert.deepStrictEqual(emptyList, {
        nodeType: 20,
        items: []
    });

    const emptyTable = decodeGeminiStructuredNode({
        nodeType: 17,
        rows: []
    });
    assert.deepStrictEqual(emptyTable, {
        nodeType: 17,
        rows: []
    });

    const emptyQuote = decodeGeminiStructuredNode({
        nodeType: 15,
        children: []
    });
    assert.deepStrictEqual(emptyQuote, {
        nodeType: 15,
        children: []
    });
});
});

__suiteDescribe("structured_execution", () => {
test__s6('captured execution panels survive structured RPC, Domain and physical Markdown grammar with exact code/stdout', () => {
    const fixture = JSON.parse(readFileSync('tests/fixtures/provider/gemini_execution_nodes.json', 'utf8')) as { nodes: [{ '39': [string, string, number, null, number] }][] };
    const content = parseGeminiBody('', decodeGeminiStructuredPayload(fixture.nodes) ?? undefined);
    assert.equal(content.length, 2);
    assert.ok(content.every(node => node.type === 'code'));
    const domain: DomainConversationWithDetail = { index: { key: fixtureKey(String('execution'), 'gemini'),   titleSource: "derived",   title: 'Execution' }, detail: { key: fixtureKey(String('execution'), 'gemini'), quality: { status: 'unknown' }, assets: [], messages: [{ id: 'm', role: 'assistant', content }] } };
    const serialized = renderDocumentMarkdown(composeDomainDocument(validateParserDomain(domain), fixtureAccountFor(validateParserDomain(domain))), {});
    const result = spawnSync('node', ['scripts/framework/markdown_evidence.mjs'], { input: JSON.stringify(serialized), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const evidence = JSON.parse(result.stdout) as { executionBlocks: { code: string; stdout: string }[]; codeBlocks: string[] };
    const canonical = (text: string) => text.replace(/^\n+|\n+$/g, '');
    assert.deepEqual(evidence.executionBlocks.map(event => ({ code: canonical(event.code), stdout: canonical(event.stdout) })), [{ code: canonical(fixture.nodes[0][0]['39'][0]), stdout: canonical(fixture.nodes[1][0]['39'][0]) }]);
    assert.deepEqual(evidence.codeBlocks, []);
});
test__s6('unrecognized execution extension layouts fall back rather than inventing source or hiding body', () => {
    for (const event of [[], ['code', 'python', 1, null, 2], ['code', 'python', 0, null, 0], ['code', 'python\nunsafe', 1, null, 0]]) {
        assert.equal(decodeGeminiStructuredNode([{ '39': event }]), null);
    }
    assert.deepEqual(decodeGeminiStructuredNode([{ 'attachment': [] }]), { nodeType: 0 });
    const visible = parseGeminiBody('Visible provider reply', decodeBody({ children: [{ nodeType: 999 }] }) ?? undefined);
    assert.ok(visible.some(block => block.type === 'paragraph' && block.children.some(node =>
        node.type === 'text' && node.text === 'Visible provider reply')),
    'unknown structured extension must not replace the raw visible response');
});
});

__suiteDescribe("structured_media_contract", () => {
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type MediaContracts = [
    Assert<Equal<GeminiAttachmentNode['images'], ImageAttachment[] | undefined>>,
    Assert<Equal<Extract<keyof GeminiAttachmentNode, 'Xj'>, never>>,
    Assert<Equal<Parameters<typeof extractResponseImageEvidence>[3], GeminiStructuredDocument__s7 | undefined>>,
];
const contracts: MediaContracts = [true, true, true];
void contracts;

test__s7('typed structured images survive nested containers without raw diagnostic evidence', () => {
    const generated: ImageAttachment = { sourceUrl: 'https://lh3.googleusercontent.com/decoded-generated', token: 'shared-token', isGenerated: true };
    const table: ImageAttachment = { sourceUrl: 'https://lh3.googleusercontent.com/decoded-table' };
    const ordered: ImageAttachment = { sourceUrl: 'https://lh3.googleusercontent.com/decoded-ordered' };
    const document: GeminiStructuredDocument__s7 = { children: [
        { nodeType: 'paragraph', children: [{ nodeType: 0, images: [generated, generated] }] },
        { nodeType: 15, children: [{ nodeType: 20, items: [{ children: [
            { nodeType: 17, rows: [{ cells: [{ children: [{ nodeType: 0, images: [table] }] }] }] },
        ] }] }] },
        { nodeType: 14, items: [{ children: [{ nodeType: 0, images: [ordered] }] }] },
    ] };
    const preview = ['https://lh3.googleusercontent.com/preview', 64, 64, 'shared-token'];
    const result = extractResponseImageEvidence([preview], [preview], '', document);
    assert.deepEqual(result.structuredImages, [generated, table, ordered]);
    assert.equal(result.structuredImages[0], generated, 'typed facts must be consumed directly, without reconstructing provider tuples');
    assert.deepEqual(result.images, [generated, table, ordered], 'generated preference, ordering and deduplication also apply across raw and decoded inputs');
});
});

__suiteDescribe("compat_rules", () => {
/**
 * tests/compat_rules.test.ts
 *
 * Tier 1 unit test for Parser Compatibility Rule Registry.
 * Verifies every admitted compatibility rule has provenance evidence and
 * immutable metadata, while ordinary authored Markdown/TeX remains untouched.
 */

const test = require('node:test');
const assert = require('node:assert');

const fs = require('node:fs');
const path = require('node:path');

const {
    GEMINI_MARKDOWN_COMPAT_RULES,
    GEMINI_TEX_COMPAT_RULES,
    GM_MD_001_FENCE_NORMALIZATION,
    preprocessGeminiMarkdown,
    preprocessGeminiLatex,
    GM_MD_004_LINE_START_DISPLAY,
} = require('../src/l1/parsers/gemini/shared/markdownCompatibility.js');

test('Compatibility Rules: every admitted rule has immutable, unique provenance evidence', () => {
    assert.ok(Object.isFrozen(GEMINI_MARKDOWN_COMPAT_RULES));
    assert.ok(Object.isFrozen(GEMINI_TEX_COMPAT_RULES));
    assert.ok(GEMINI_MARKDOWN_COMPAT_RULES.includes(GM_MD_001_FENCE_NORMALIZATION));

    const all = [...GEMINI_MARKDOWN_COMPAT_RULES, ...GEMINI_TEX_COMPAT_RULES, GM_MD_004_LINE_START_DISPLAY];
    assert.strictEqual(new Set(all.map(rule => rule.id)).size, all.length, 'rule IDs must be unique across registries');
    for (const rule of all) {
        assert.match(rule.id, /^GM-(MD|TEX)-\d{3}$/);
        assert.strictEqual(rule.domain, rule.id.startsWith('GM-MD-') ? 'markdown' : 'tex');
        assert.ok(Object.isFrozen(rule), `rule ${rule.id} must be frozen`);
        assert.ok(Number.isFinite(Date.parse(rule.observedAt)), `rule ${rule.id} needs a valid observation date`);
        assert.ok(rule.description.trim().length > 20, `rule ${rule.id} needs an explanation`);
        assert.match(rule.evidence, /^tests\/fixtures\//);
        assert.ok(fs.statSync(path.resolve(__dirname, '..', rule.evidence)).isFile(),
            `rule ${rule.id} must reference an existing evidence file`);
    }
    assert.ok(all.some(rule => rule.id === 'GM-MD-002'), 'the evidenced table-math compatibility rule must remain admitted');
    assert.ok(all.some(rule => rule.id === 'GM-TEX-001'), 'the evidenced mathscr compatibility rule must remain admitted');
});

test('Compatibility Rules: preprocessGeminiMarkdown preserves standard Markdown structures', () => {
    const standardCases = [
        '',
        'Hello World',
        '# Heading 1\n\n**bold** *italic* `code`',
        '| A | B |\n|---|---|\n| x | `a|b` |',
        '$$E = mc^2$$',
        'Multi-line\n\n\n\nwith trailing space   \n',
        'CJK 中文测试，带公式 $x^2 + y^2 = z^2$ 和表情 😊🚀',
        '```markdown\n$$\\begin{aligned}\n\\end{aligned}$$\n```',
        '~~~latex\n$$\\begin{matrix} 1 & 2 \\end{matrix}$$\n~~~',
    ];
    for (const input of standardCases) {
        assert.strictEqual(preprocessGeminiMarkdown(input), input, 'Standard markdown must be preserved exactly');
    }
});

test('Compatibility Rules: GM-MD-001 normalizes attached display math fences', () => {
    const input = '$$\\begin{aligned}\nx = 1\n\\end{aligned}$$';
    const expected = '$$\n\\begin{aligned}\nx = 1\n\\end{aligned}\n$$';
    assert.strictEqual(preprocessGeminiMarkdown(input), expected);

    const bqInput = '> $$\\begin{aligned}\n> x = 1\n> \\end{aligned}$$';
    const bqExpected = '> $$\n> \\begin{aligned}\n> x = 1\n> \\end{aligned}\n> $$';
    assert.strictEqual(preprocessGeminiMarkdown(bqInput), bqExpected);
});

test('Compatibility Rules: preprocessGeminiLatex preserves standard LaTeX and normalizes mathscr', () => {
    const standardCases = [
        '',
        '\\frac{a}{b}',
        '\\sum_{i=1}^n x_i',
        '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
        '\\arg\\left(\\gamma\'(z_c)\\right) \\pmod\\pi',
        '\\Box \\psi = \\nabla^2 \\psi',
    ];
    for (const input of standardCases) {
        assert.strictEqual(preprocessGeminiLatex(input), input, 'Standard LaTeX must be preserved exactly');
    }

    const scrInput = '\\mathcal{F}_{\\mathscr{I}^+}';
    const scrExpected = '\\mathcal{F}_{\\mathcal{I}^+}';
    assert.strictEqual(preprocessGeminiLatex(scrInput), scrExpected, 'GM-TEX-001 must normalize mathscr to mathcal');
});
});

__suiteDescribe("content_quality", () => {
test__s9('parser closes heuristic document identities and rejects malformed messages before Domain', () => {
    const parsed = historicalFixture({ id: 'quality', messages: [null as never,
        { role: 'model', content: 'Body', attachments: [{ type: 'doc', id: 'source-doc', contentMarkdown: 'Report', hasFabricatedText: true }] }] });
    assert.deepEqual(parsed.conversation.detail.quality, { status: 'partial' });
    assert.deepEqual(parsed.evidence, { rejectedTurns: 1, heuristicDocumentIds: [parsed.conversation.detail.assets[0].id] });
    assert.equal('hasFabricatedText' in parsed.conversation.detail.assets[0].document!, false);
    assert.equal(parsed.conversation.detail.quality.status, 'partial', 'L2 quality is independent of delivery records');
});

test__s9('finished pagination clears pending coverage and remaps heuristic references on asset collisions', () => {
    const page = (body: string) => rpcFixture({ id: 'pages', messages: [{ id: body, role: 'model', content: body,
        attachments: [{ type: 'doc', id: 'report', contentMarkdown: body, hasFabricatedText: true }] }] });
    const first = page('new'), second = page('old');
    assert.equal(first.conversation.detail.assets[0].id, second.conversation.detail.assets[0].id);
    const merged = mergeConversationPages([first, second]);
    assert.deepEqual(merged.evidence?.heuristicDocumentIds, merged.conversation.detail.assets.map(a => a.id));
    assert.equal(merged.conversation.detail.quality.status, 'partial');
    const cleanFirst = rpcFixture({ id: 'pages', messages: [{ role: 'user', content: 'New' }] }, { nextPageToken: 'cursor' });
    const cleanLast = rpcFixture({ id: 'pages', messages: [{ role: 'user', content: 'Old' }] });
    assert.deepEqual(cleanFirst.conversation.detail.quality, { status: 'partial' });
    assert.deepEqual(mergeConversationPages([cleanFirst, cleanLast]).conversation.detail.quality, { status: 'unknown' });
    const stopped = mergeConversationPages([cleanFirst], 'token_loop');
    assert.deepEqual(stopped.conversation.detail.quality, { status: 'partial' });
    assert.equal(stopped.evidence?.truncation, 'token_loop');
    assert.deepEqual(mergeConversationPages([stopped, cleanLast]).conversation.detail.quality,
        { status: 'partial' }, 'only pending pagination may be cleared');
});
});

__suiteDescribe("generated-media-identity", () => {
useIndexStorage();

const test = require('node:test');

const fs = require('node:fs');
const path = require('node:path');




const id = '1bd028d5c5b0c0e2';
const png = 'watermarked_img_45281370108017511-1c81efe352c9ef8a.png';
const jpg = 'watermarked_img_4528137010801751197.jpg';

test('real Takeout fixture does not guess ownership of unreferenced generated image bytes', async () => {
    const JSZip = require('../lib/jszip.min.js');
    const result = await parseGeminiTakeoutZipArchive(fs.readFileSync(path.join(__dirname, 'fixtures/gemini_takeout_clean.zip')), { providerId: 'gemini', readArchive: bytes => JSZip.loadAsync(bytes) });
    const offline = result.find(source => source.conversationId === id); assert.ok(offline);
    assert.equal('key' in offline.conversation.detail, false);
    assert.deepEqual(offline.archiveResources, {});
    assert.ok(offline.diagnostics.some(d => d.code === 'TAKEOUT_GENERATED_MEDIA_UNRESOLVED'));
    const resources = createSourceResourceContext();
    try {
        resources.retainParsed({ accountId: '10000000-0000-4000-8000-000000000001', conversationId: id }, offline);
        await assert.rejects(resources.acquire({ accountId: '10000000-0000-4000-8000-000000000001', conversationId: id }, { id: png, kind: 'image' }), /locator/);
    } finally { resources.release(); }
});

test('RPC generated-media detector preserves generated status while inline images remain unmarked', () => {
    const { extractImages } = require('./helpers/recordFixture/attachments.js');
    const generated: any[] = Array(16).fill(null);
    generated[2] = jpg;
    generated[3] = 'https://lh3.googleusercontent.com/generated';
    generated[11] = 'image/jpeg';
    generated[15] = [512, 512, 1000];
    assert.equal(extractImages([generated])[0].isGenerated, true);
    assert.equal(extractImages([['https://lh3.googleusercontent.com/inline', 512, 512]])[0].isGenerated, undefined);
});

test('regression: extractImages suppresses 2x inline tuple duplicate sharing token with generated media', () => {
    const { extractImages } = require('./helpers/recordFixture/attachments.js');
    const token = '8815680899422160530';
    const inlineTuple = ['https://lh3.googleusercontent.com/inline-2x', 2816, 1536, token];
    const generatedNode: any[] = Array(16).fill(null);
    generatedNode[2] = 'watermarked_img_4528137010801751197.jpg';
    generatedNode[3] = 'https://lh3.googleusercontent.com/gg/original';
    generatedNode[5] = token;
    generatedNode[11] = 'image/jpeg';
    generatedNode[15] = [1408, 768, 924784];

    // Order 1: inline tuple first, generated node second (typical JSPB walk order)
    const imgs1 = extractImages([inlineTuple, generatedNode]);
    assert.equal(imgs1.length, 1, 'Must deduplicate to exactly 1 image');
    assert.equal(imgs1[0].fileName, 'watermarked_img_4528137010801751197.jpg');
    assert.equal(imgs1[0].isGenerated, true);
    assert.equal(imgs1[0].width, 1408);
    assert.equal(imgs1[0].height, 768);

    // Order 2: generated node first, inline tuple second
    const imgs2 = extractImages([generatedNode, inlineTuple]);
    assert.equal(imgs2.length, 1, 'Must deduplicate to exactly 1 image');
    assert.equal(imgs2[0].fileName, 'watermarked_img_4528137010801751197.jpg');
    assert.equal(imgs2[0].isGenerated, true);
    assert.equal(imgs2[0].width, 1408);
    assert.equal(imgs2[0].height, 768);
});

test('regression: extractImages suppresses 2x upscale derivative rendition (slot 8 === 2) and retains authoritative 1x watermarked image', () => {
    const { extractImages } = require('./helpers/recordFixture/attachments.js');
    const baseNode: any[] = Array(16).fill(null);
    baseNode[2] = 'watermarked_img_4528137010801751197.jpg';
    baseNode[3] = 'https://lh3.googleusercontent.com/gg/original';
    baseNode[5] = '$token_base';
    baseNode[8] = null; // base authoritative generation
    baseNode[11] = 'image/jpeg';
    baseNode[15] = [1408, 768, 934819];

    const upscaleNode: any[] = Array(25).fill(null);
    upscaleNode[2] = '8815680899422160530.jpeg';
    upscaleNode[3] = 'https://lh3.googleusercontent.com/gg/upscaled';
    upscaleNode[5] = '$token_upscale';
    upscaleNode[8] = 2; // 2x upscale derivative rendition
    upscaleNode[11] = 'image/jpeg';
    upscaleNode[15] = [2816, 1536, 3435994];

    const imgs = extractImages([baseNode, upscaleNode]);
    assert.equal(imgs.length, 1, 'Must retain only 1 authoritative base image');
    assert.equal(imgs[0].fileName, 'watermarked_img_4528137010801751197.jpg');
    assert.equal(imgs[0].width, 1408);
    assert.equal(imgs[0].height, 768);
    assert.equal(imgs[0].isGenerated, true);
});

test('regression: decodeTurn verifies request identity only in documented slots', () => {
    const extractTurnRequestId = (turn: unknown): string | undefined => decodeTurn(turn)?.rawProviderRequestId;

    // Verify schema constant
    assert.equal(GEMINI_JSPB_SCHEMA.TURN.REQUEST_ID_SLOT, 1, 'REQUEST_ID_SLOT must be index 1 in ID_META');

    // Case 1: Standard canonical slot: idMeta[1] carries "r_<hex>"
    const turnStandard = [
        ["c_d3226d9a046c1116", "r_1c81efe352c9ef8a"],
        [1725302200, 0],
        [["user text"]],
        [[["rc_model_1", ["model text"]]]]
    ];
    assert.equal(extractTurnRequestId(turnStandard), 'r_1c81efe352c9ef8a', 'Extract from standard slot 1');

    // Case 2: Standalone slot 0 when convId is absent
    const turnStandalone = [
        ["r_2b3c4d5e6f7a8b9c"],
        [1725302200, 0],
        [["user text"]],
        [[["rc_model_1", ["model text"]]]]
    ];
    assert.equal(extractTurnRequestId(turnStandalone), 'r_2b3c4d5e6f7a8b9c', 'Extract from slot 0 when convId is absent');

    // Case 3: Direct string idMeta
    const turnStringId = [
        "r_9988776655443322",
        [1725302200, 0]
    ];
    assert.equal(extractTurnRequestId(turnStringId), 'r_9988776655443322', 'Extract from direct string idMeta');

    // Case 4: Non-schema slot (e.g. slot 2) must NOT be matched via .find() heuristic (returns undefined)
    const turnUnconfirmedSlot = [
        ["c_conv123", null, "r_unconfirmed12345678"],
        [1725302200, 0]
    ];
    assert.equal(extractTurnRequestId(turnUnconfirmedSlot), undefined, 'Must return undefined for unconfirmed slot (no .find() heuristic)');

    // Case 5: "r_" in turn[1] (TIMESTAMP slot) or other non-id slots must be REJECTED
    const turnWithRInTimestamp = [
        ["c_conv123"],
        "r_fake_in_timestamp_slot"
    ];
    assert.equal(extractTurnRequestId(turnWithRInTimestamp), undefined, 'Must NEVER search outside ID_META (e.g. timestamp slot 1)');

    // Case 6: No r_ present anywhere in idMeta
    const turnNoR = [
        ["c_conv123", "non_r_identifier"],
        [1725302200, 0]
    ];
    assert.equal(extractTurnRequestId(turnNoR), undefined, 'Return undefined when no r_ present');

    // Request identity remains exactly as captured for messages and generated images.
    const mixedCase = [["c_conv123", "r_AbC-09"], [1725302200, 0]];
    assert.equal(decodeTurn(mixedCase)?.rawProviderRequestId, 'r_AbC-09');
    assert.equal(decodeTurn(turnUnconfirmedSlot)?.rawProviderRequestId, undefined);
    assert.equal(decodeTurn(turnWithRInTimestamp)?.rawProviderRequestId, undefined);
});
});

__suiteDescribe("generated_files", () => {
const fixture = JSON.parse(readFileSync('tests/fixtures/provider/gemini_generated_file.json', 'utf8')) as { packet: unknown[]; chip: unknown[] };
const packet = fixture.packet;
test__s11('generated file stays on its source turn, retains chip position, and carries exact UTF-8 source bytes', () => {
    const input = geminiDetailGen('G_GENERATED_FILES_01');
    const result = parseGeminiRpcConversation(input, { account: fixtureAccount('gemini'), providerId: 'gemini', targetConvId: 'e6dc4e0732ba568b' });
    const { conversation } = result;
    assert.equal(conversation.detail.assets.length, 1, 'no heuristic duplicate or cross-turn document');
    const asset = conversation.detail.assets[0];
    assert.equal(asset.name, packet[9]);
    const bytes = Uint8Array.from(atob(result.acquisitionHints[asset.id].dataBase64!), value => value.charCodeAt(0));
    assert.equal(new TextDecoder().decode(bytes), (packet[32] as unknown[])[2]);
    const earlier = conversation.detail.messages.find(message => message.id === 'rc_earlier')!;
    assert.equal(earlier.attachmentIds?.length ?? 0, 0);
    assert.deepEqual(earlier.content.map(node => node.type), ['paragraph']);
    const later = conversation.detail.messages.find(message => message.id === 'rc_later')!;
    assert.deepEqual(later.content.map(node => node.type), ['paragraph', 'file', 'paragraph']);
    assert.equal('key' in conversation.detail, false);
    assert.equal(later.attachmentIds?.[0], asset.id);

});
test__s11('unknown file packet versions and absent content never fabricate an attachment', () => {
    for (const mutate of ['type', 'content'] as const) {
        const row = structuredClone(packet);
        if (mutate === 'type') row[10] = 99; else row[32] = null;
        const candidate: unknown[] = [];
        candidate[30] = [row];
        assert.deepEqual(decodeCandidateArtifacts(candidate).generatedFiles, []);
    }
});

test__s11('mixed candidate[30] packets classify generated files and native documents in one pass', () => {
    const native: unknown[] = ['c_native_chat_report.md', null, '  Research notes  ', null, '# Unmodified body'];
    native[10] = 3;
    const foreign: unknown[] = ['c_other_chat_report.md', null, 'Foreign', null, '# Ignore'];
    foreign[10] = 3;
    const unsupported: unknown[] = ['c_native_chat_unknown', null, 'Other', null, '# Unknown'];
    unsupported[10] = 99;
    const candidate: unknown[] = ['rc_mixed', ['Mixed answer']];
    candidate[30] = [null, packet, native, foreign, unsupported, [26], { kind: 26 }];

    const decoded = decodeCandidateArtifacts(candidate, 'c_native_chat');
    assert.equal(decoded.generatedFiles.length, 1);
    const file = decoded.generatedFiles[0];
    assert.equal(file.id, packet[0]);
    assert.equal(file.name, packet[9]);
    assert.equal(file.fileName, packet[9]);
    assert.equal(new TextDecoder().decode(file.dataBuffer), (packet[32] as unknown[])[2]);
    assert.deepEqual(decoded.nativeDocuments, [{
        id: 'c_native_chat_report.md', title: 'Research notes', contentMarkdown: '# Unmodified body',
        type: 'file', sections: [], links: [], url: '', chipUrl: ''
    }]);

    // Generated packets have no conversation-id restriction; native documents do.
    assert.equal(decodeCandidateArtifacts(candidate).generatedFiles.length, 1);
    assert.deepEqual(decodeCandidateArtifacts(candidate).nativeDocuments, []);
    assert.deepEqual(decodeCandidateArtifacts(candidate, 'other_chat').nativeDocuments, [{
        id: 'c_other_chat_report.md', title: 'Foreign', contentMarkdown: '# Ignore',
        type: 'file', sections: [], links: [], url: '', chipUrl: ''
    }]);
});

test__s11('missing or malformed candidate packet list yields empty classified artifacts', () => {
    const candidates: unknown[][] = [[], [null], Object.assign(Array(31).fill(null), { 30: 'wrong' })];
    for (const candidate of candidates) {
        assert.deepEqual(decodeCandidateArtifacts(candidate, 'native_chat'), {
            generatedFiles: [], nativeDocuments: []
        });
    }
});
});

__suiteDescribe("imagen_generated_assets", () => {
const { historicalFixture } = require('./helpers/nativeFixture.js');
const { extractImages } = require('./helpers/recordFixture/attachments.js');


const test = require('node:test');
const assert = require('node:assert');


test('geminiParser - extracts Imagen generated image node (Pattern 2)', () => {
    const imagenNode = [
        null,
        1,
        "watermarked_img_16704480932994645752.jpg",
        "https://lh3.googleusercontent.com/gg/ACRwjavPniU5LRENaIm-6aleFKYDMfW02Me91e7oUbbDuHypWF8TDRUFAz5zE2Y7M1upuCMvqxWTVyWcLXR8BwcVS1nerGoqpPu_QVQx8_PKx7s90wbEEzU0K6jFPcN3gXW6a9r0aQRbMqAMsf5E2BbXFF-3_mNpi2NYTk2rLDYXVLuG2f-nf8sSUFMX2PNySGUpMhnTrNU2Iil4KOYL8TDvZZOI5wa85y-OZPgrXaGw55oLUzGQJJOtD3BZLbQRLm3GnxbTSA-CyHJYaTRmpJ7cK8uHN0-FKXzDVsR5hsn8aiVJ3Es0XnINPusg9R-RD24UC9C8sj2zuiqELa38-2ydh9s",
        null,
        "$AXzLiRwXeOJl0Bt2a6m8QL9S1mQCi42r7EROQ1BwqIcZuJ7TcSejJZs1+VG6z1sCdz04lS3zi0VG15MJu/gH9vxDCduu2HXts8vz4GGsQACLzMBNRkW16m2RT7Ouec1LmWXZjummxEQf6ZbbqLwtbtXEGcQJRDhYy2YazFTtCGLdjg1Pi+BDKbu4lcp9+ByL1UwZkfImLoEqSIsdcoiiXVpbCtPyTb3FfJ54JfznUZyNlnJPRnF7kESwJSf9uIscq385RSrXqTJ56Bf9SNFADjThOQ==",
        null,
        null,
        null,
        [1788550788, 840331369],
        null,
        "image/jpeg",
        null,
        null,
        null,
        [1408, 768, 924784]
    ];

    const candidateBlock = [
        "rc_3244407ff0cfc512",
        ["\n\nhttp://googleusercontent.com/image_generation_content/2_557\n\n"],
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        [
            null, null, null, null, null, null, null,
            [
                [
                    [
                        [null, null, null, imagenNode],
                        ["http://googleusercontent.com/image_generation_content/2_557"]
                    ]
                ]
            ]
        ]
    ];

    const images = extractImages(candidateBlock);
    assert.strictEqual(images.length, 1);
    assert.strictEqual(images[0].fileName, "watermarked_img_16704480932994645752.jpg");
    assert.strictEqual(images[0].mimeType, "image/jpeg");
    assert.strictEqual(images[0].width, 1408);
    assert.strictEqual(images[0].height, 768);
    assert.strictEqual(images[0].size, 924784);
    assert.ok(images[0].sourceUrl.startsWith("https://lh3.googleusercontent.com/gg/"));
});

test('geminiParser - extracts Python plot generated asset (Pattern 2)', () => {
    const plotNode = [
        null,
        1,
        "ekf_fusion_result.png",
        "https://lh3.googleusercontent.com/gg/ACRwjaub7uiGm3T7VzMR-_B160VqDtHahpFPSKkGxl83nyPiTl-gQAGRonXla9yjtkouerHkESRUW4PIsBzk-oRy4_prRC8-BU2I1iR0TB8p6ZZQJyF6bacgakdj3wTxqKqDI9tU6xGmHIC5nGU-OlDGXaG-q1ocDIvbLpwEGMy5zwJys8ynKyYhfZ2F99G8iBEwgZaFpp8Wa15Rp92w0yLMXxYVK5d6kTc_4IM-pKyGbYkpJXopNxDEyu5MT5OjsVJCwTgwuC9nKdQAkPr3sV-IVLgW2QmHaLGtOEo1ThTv8qRnaVMyuY2K61ZQEuhdOes5Waz5xEjb8RPb-70ytUu6Inpg",
        null,
        "$AXzLiRxGsTj2Vi/eWubYyP3wsoOqlIpX7K7b29iA9U+LHs7m3Q+0YN+fSvvLNMqwSUGRf4V7BlyRLZfpU8QVKbDdYyzDeMWMyrEbU0G6/v/2FgkxqzDhxcbSzutREhVQfLFWW2DNwuGmJ1qHmyng7ikzbzl9UYG1JAi15eNBTjZCJqYIId++YuNoLqi0UUKymeaVgwYNIiVrgwxTJREFX/LrCTVk0jTATeTqWeXM6yl1",
        null,
        null,
        null,
        null,
        null,
        "image/png",
        null,
        null,
        null,
        [900, 700, 93650]
    ];

    const images = extractImages(plotNode);
    assert.strictEqual(images.length, 1);
    assert.strictEqual(images[0].fileName, "ekf_fusion_result.png");
    assert.strictEqual(images[0].mimeType, "image/png");
    assert.strictEqual(images[0].width, 900);
    assert.strictEqual(images[0].height, 700);
    assert.strictEqual(images[0].size, 93650);
});

test('chatFormatter - formats generated image as markdown and cleans placeholder URLs', async () => {
    const mockChat = {
        id: '61a5e19c42b800f3',
        title: '深渊AUV材料与通信挑战',
        url: 'https://gemini.google.com/app/61a5e19c42b800f3',
        timestamp: 1788550788000,
        messages: [
            {
                role: 'user',
                content: '请帮我生成一张图片：深海潜水器'
            },
            {
                role: 'model',
                content: 'http://googleusercontent.com/image_generation_content/2_557',
                images: [
                    {
                        sourceUrl: 'https://lh3.googleusercontent.com/gg/ACRwjavPniU5LRENaIm-6aleFKYDMfW02Me91e7oUbb',
                        resolvedUrl: 'https://lh3.googleusercontent.com/gg/ACRwjavPniU5LRENaIm-6aleFKYDMfW02Me91e7oUbb=s0',
                        localName: 'assets/b800f3_watermarked_img_16704480932994645752.jpg',
                        fileName: 'watermarked_img_16704480932994645752.jpg',
                        width: 1408,
                        height: 768,
                        type: 'image'
                    }
                ]
            }
        ]
    };

    const parsed = historicalFixture(mockChat);
    const { document, resources } = await composeFixture(parsed.conversation, parsed.resourceHints);
    const res = renderDocumentMarkdown(document, resources);
    // 必须包含 Markdown 图片引用 ![]
    assert.ok(res.includes('!['));
    assert.ok(res.includes('assets/b800f3_watermarked_img_16704480932994645752.jpg'));
    // 不应泄露裸露的 image_generation_content 占位行
    assert.ok(!res.includes('http://googleusercontent.com/image_generation_content/2_557'));
});

test('assetFetcher - ensureAlr appends or preserves alr=yes parameter', () => {
    const AssetFetcher = require('../src/l1/resources/gemini/assetFetcher.js');
    const ensureAlr = AssetFetcher.ensureAlr || (AssetFetcher.AssetFetcher && AssetFetcher.AssetFetcher.ensureAlr);

    assert.strictEqual(ensureAlr('https://lh3.googleusercontent.com/gg/abc'), 'https://lh3.googleusercontent.com/gg/abc?alr=yes');
    assert.strictEqual(ensureAlr('https://lh3.googleusercontent.com/gg/abc?foo=bar'), 'https://lh3.googleusercontent.com/gg/abc?foo=bar&alr=yes');
    assert.strictEqual(ensureAlr('https://lh3.googleusercontent.com/gg/abc?alr=yes'), 'https://lh3.googleusercontent.com/gg/abc?alr=yes');
    assert.strictEqual(ensureAlr('https://lh3.googleusercontent.com/gg/abc?foo=bar&alr=yes'), 'https://lh3.googleusercontent.com/gg/abc?foo=bar&alr=yes');
});

test('assetFetcher - extractLh3 parses lh3-lh6 and unescapes json characters', () => {
    const AssetFetcher = require('../src/l1/resources/gemini/assetFetcher.js');
    const extractLh3 = AssetFetcher.extractLh3 || (AssetFetcher.AssetFetcher && AssetFetcher.AssetFetcher.extractLh3);

    const normal = 'https://lh3.google.com/rd-gg/abc123=s512?alr=yes';
    assert.strictEqual(extractLh3(normal), normal);

    const escaped = '[\"https:\\/\\/lh4.googleusercontent.com\\/rd-gg\\/xyz\\u003d512\\u0026alr=yes\"]';
    assert.strictEqual(extractLh3(escaped), 'https://lh4.googleusercontent.com/rd-gg/xyz=512&alr=yes');
});

test('assetFetcher - fetchGgChain follows multi-hop ALR text redirects to final image', async () => {
    const AssetFetcher = require('../src/l1/resources/gemini/assetFetcher.js');
    const fetchGgChain = AssetFetcher.fetchGgChain || (AssetFetcher.AssetFetcher && AssetFetcher.AssetFetcher.fetchGgChain);

    const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    const callLog: string[] = [];
    const fakeBinary = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4]);

    try {
        (global as any).fetch = async (url: string) => {
            callLog.push(url);
            if (url.includes('/gg/start')) {
                // Hop 0: returns text/plain pointing to rd-gg/hop1 (without alr=yes)
                return {
                    ok: true,
                    status: 200,
                    headers: new Map([['content-type', 'text/plain; charset=UTF-8']]),
                    clone: () => ({
                        text: async () => 'https://lh3.google.com/rd-gg/hop1'
                    })
                };
            } else if (url.includes('/rd-gg/hop1')) {
                // Hop 1: returns text/plain pointing to rd-gg/final
                return {
                    ok: true,
                    status: 200,
                    headers: new Map([['content-type', 'text/plain; charset=UTF-8']]),
                    clone: () => ({
                        text: async () => 'https://lh3.googleusercontent.com/rd-gg/final'
                    })
                };
            } else if (url.includes('/rd-gg/final')) {
                // Hop 2: returns binary image/jpeg
                return {
                    ok: true,
                    status: 200,
                    headers: new Map([['content-type', 'image/jpeg']]),
                    blob: async () => ({
                        size: fakeBinary.length,
                        type: 'image/jpeg',
                        arrayBuffer: async () => fakeBinary.buffer
                    })
                };
            }
            return { ok: false, status: 404, headers: new Map() };
        };

        const res = await fetchGgChain('https://lh3.googleusercontent.com/gg/start');
        assert.ok(res, 'Must return response');
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.headers.get('content-type'), 'image/jpeg');
        assert.deepStrictEqual(callLog, [
            'https://lh3.googleusercontent.com/gg/start?alr=yes',
            'https://lh3.google.com/rd-gg/hop1?alr=yes',
            'https://lh3.googleusercontent.com/rd-gg/final?alr=yes'
        ], 'the multi-hop fetch must follow each redirect with ALR preserved');
        const blob = await res.blob();
        assert.deepStrictEqual(new Uint8Array(await blob.arrayBuffer()), fakeBinary, 'the final image bytes must be returned intact');
    } finally {
        if (originalFetchDescriptor) Object.defineProperty(globalThis, 'fetch', originalFetchDescriptor);
        else Reflect.deleteProperty(globalThis, 'fetch');
    }
});
});

__suiteDescribe("visible_image_detection", () => {
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractResponseImageEvidence: extractResponseImages } = require('../src/l1/parsers/gemini/rpc/sourceAttachments.js');
const { parseGeminiRpcConversation } = require('../src/l1/parsers/gemini/rpc/parseConversation.js');
const { decodeGeminiDetail } = require('../src/l1/parsers/gemini/rpc/detailDecoder.js');

// Same media tuple shape as the false detections in the user's diagnostics.
const searchUrl = 'https://encrypted-tbn2.gstatic.com/licensed-image?q=example';
const searchResult = [
    [[searchUrl], null, 2048, 1536, null, null, null, 0, 'getty:example', 'getty', 'Getty Images'],
    [['https://www.gettyimages.com/detail/example'], '', 8], null,
    [[searchUrl], null, 2048, 1536, null, null, null, 0], null, null, null,
    ['http://googleusercontent.com/image_agent_tag_example', null, 'Reference diagram', null, null, 1]
];

test('candidate search metadata does not become a phantom image in native Domain Markdown', () => {
    const result = decodeGeminiDetail(geminiDetailGen('G_VISIBLE_IMAGE_01'), 'c_visible_images_test');
    const answer = result.messages.find((m: any) => m.role === 'model');
    assert.ok(answer);
    assert.equal(answer.images, undefined);
    assert.equal(answer.attachments, undefined);

    // Check the actual native parser -> Domain -> Document -> Markdown path.
    const native = parseGeminiRpcConversation(geminiDetailGen('G_VISIBLE_IMAGE_02'), { providerId: 'gemini', account: fixtureAccount() });
    assert.deepStrictEqual(native.conversation.detail.assets, [], 'search metadata is not an authored image resource');
    const markdown = JSON.stringify(native.conversation.detail.messages.map((message: any) => message.content));
    assert.match(markdown, /Answer without pictures/);
    assert.doesNotMatch(markdown, /assets\/|Reference diagram|licensed-image/);
});

test('real wire answer image survives while unrelated search metadata is excluded', () => {
    const result = decodeGeminiDetail(geminiDetailGen('G_VISIBLE_IMAGE_03'), 'c_visible_images_test');
    const answer = result.messages.find((m: any) => m.role === 'model');
    assert.equal(answer.images.length, 1);
    assert.match(answer.images[0].sourceUrl, /encrypted-tbn0\.gstatic\.com\/images/);
    assert.equal(answer.attachments.filter((a: any) => a.type === 'image').length, 1);
});

test('direct image URLs in Markdown survive without structured answer data', () => {
    const { images } = extractResponseImages([searchResult], [], `![diagram](${searchUrl})`);
    assert.equal(images.length, 1);
});

test('plain image-agent placeholders do not prove an image was rendered', () => {
    assert.equal(extractResponseImages([searchResult], [], '<Image src="image_agent_tag_example" />').images.length, 0);
});

test('uploaded image tuples remain supported outside search-result metadata', () => {
    const upload = ['https://lh3.googleusercontent.com/upload.png', 640, 480];
    assert.equal(extractResponseImages([upload], [], 'Answer').images.length, 1);
});

test('unselected candidates are omitted without losing the primary answer image', () => {
    const answers = decodeGeminiDetail(geminiDetailGen('G_VISIBLE_IMAGE_04'), 'c_visible_images_test').messages.filter((m: { role: string }) => m.role === 'model');
    assert.equal(answers.length, 1);
    assert.equal(answers[0].images.length, 1);
    assert.equal(answers[0].id, 'rc_visible_images_test');
});
});

__suiteDescribe("native_documents", () => {
function packet(kind: number, body: string, suffix = 'report.md') {
    const row: unknown[] = ['c_native_chat_' + suffix, null, 'Source document', null, body];
    row[10] = kind;
    return row;
}
function capture(key: Parameters<typeof geminiDetailGen>[0]) {
    return parseGeminiRpcConversation(geminiDetailGen(key), { providerId: 'gemini', targetConvId: 'native_chat' });
}
for (const [kind, body, key, nextKey] of [
    [1, '# Report\n\nExact source body', 'G_NATIVE_DOCUMENT_01', 'G_NATIVE_DOCUMENT_02'],
    [2, "```python\nprint(\"ok\")\n```", 'G_NATIVE_DOCUMENT_03', 'G_NATIVE_DOCUMENT_04'],
    [3, '# Research\n\nReferences and findings', 'G_NATIVE_DOCUMENT_05', 'G_NATIVE_DOCUMENT_06'],
] as const) {
    test__s14(`native document kind ${kind}: exact body without metadata or heuristic duplication`, () => {
        const parsed = capture(key);
        assert.equal(parsed.conversation.detail.assets.length, 1);
        assert.equal(parsed.conversation.detail.assets[0].document?.contentMarkdown, body);
        assert.deepEqual(parsed.evidence?.heuristicDocumentIds, []);
        assert.equal(parsed.conversation.detail.messages.length, 2);
        const merged = mergeConversationPages([parsed], undefined, true);
        assert.equal(merged.conversation.detail.quality.status, 'complete');
        assert.equal(merged.conversation.detail.savedAt, 1700000000000);
        assert.ok(merged.diagnostics.some(d => d.code === 'CONVERSATION_VERSION_MISMATCH'));
        assert.equal(mergeConversationPages([capture(nextKey)], 'token_loop', false).conversation.detail.quality.status, 'partial');
    });
}
test__s14('native document decoding rejects unrelated identities, unknown kinds and malformed bodies', () => {
    const foreign = packet(3, 'Foreign'); foreign[0] = 'c_another_chat_report';
    const noBody = packet(3, '');
    const candidate: unknown[] = []; candidate[30] = [foreign, noBody, packet(26, 'code packet'), packet(99, 'unknown')];
    assert.deepEqual(decodeCandidateArtifacts(candidate, 'native_chat').nativeDocuments, []);
    assert.deepEqual(decodeCandidateArtifacts(candidate).nativeDocuments, []);
});
test__s14('native documents stay bound to their answer when titles match', () => {
    const a = capture('G_NATIVE_DOCUMENT_07');
    const b = capture('G_NATIVE_DOCUMENT_08');
    assert.equal(a.conversation.detail.assets[0].document?.contentMarkdown, 'First body');
    assert.equal(b.conversation.detail.assets[0].document?.contentMarkdown, 'Second body');
    assert.notEqual(a.conversation.detail.assets[0].id, b.conversation.detail.assets[0].id);
});
});

__suiteDescribe("user_file_attachment", () => {
const { historicalFixture } = require('./helpers/nativeFixture.js');

const test = require('node:test');
const assert = require('node:assert');


// L1 user-file source extraction contracts live in `tests/l1_extracted_regressions.test.ts`.
// This suite covers cross-layer L2 -> L3b -> L4 Markdown rendering of user file attachments.

test('user_file_attachment: Markdown renderer renders clean attachment link without URL leakage', async () => {
    const mockChat = {
        id: '273175',
        title: 'Gemini 架构设计评估报告',
        url: 'https://gemini.google.com/app/273175',
        timestamp: 1700000000000,
        messages: [
            {
                role: 'user',
                content: '请评估这个架构',
                attachments: [
                    {
                        type: 'file',
                        title: 'architecture.md',
                        localName: 'files/273175_architecture.md',
                        name: 'architecture.md',
                    },
                    {
                        type: 'file',
                        title: 'custom_data.xyz',
                        localName: 'files/273175_custom_data.xyz',
                        name: 'custom_data.xyz',
                    },
                ],
            },
            {
                role: 'model',
                content: '架构评估完成。',
            },
        ],
    };

    const parsed = historicalFixture(mockChat);
    const { document, resources } = await composeFixture(parsed.conversation, parsed.resourceHints);
    const markdown = renderDocumentMarkdown(document, resources);
    assert.ok(markdown.includes('[architecture.md](files/273175_architecture.md)'), 'Must render clean Markdown link for architecture.md');
    assert.ok(markdown.includes('[custom\\_data.xyz](files/273175_custom_data.xyz)'), 'Must render clean Markdown link for custom_data.xyz');
    assert.ok(!markdown.includes('https___contribution'), 'Must NOT contain sanitized URL artifacts in Markdown');
    assert.ok(!markdown.includes('[https://'), 'Must NOT render URL as link title');
});

test('user_file_attachment: Markdown renderer preserves a supplied resource label without inferring one from its destination', async () => {
    const mockChat = {
        id: '273175',
        title: 'Leaked URL Title Test',
        messages: [
            {
                role: 'user',
                content: 'Test message',
                attachments: [
                    {
                        type: 'file',
                        title: 'https://contribution.usercontent.google.com/download?c=123&filename=leaked.json',
                        localName: 'files/273175_leaked.json',
                    },
                ],
            },
        ],
    };

    const parsed = historicalFixture(mockChat);
    const { document, resources } = await composeFixture(parsed.conversation, parsed.resourceHints);
    const markdown = renderDocumentMarkdown(document, resources);
    assert.ok(markdown.includes('[https://contribution.usercontent.google.com/download?c=123&amp;filename=leaked.json]'),
        'Composer preserves a supplied nonempty source name; it cannot reinterpret it as missing');
    assert.ok(markdown.includes('files/273175_leaked.json'), 'Must keep localName path');
    assert.ok(!markdown.includes('[leaked.json]'), 'Destination basename cannot replace a supplied source label');
});
});

__suiteDescribe("dom_scraper", () => {
test('only current-page Gemini metadata is read; history is not expanded or scrolled', () => {
    const doc = {
        title: 'Current page title',
        querySelectorAll: (selector: string) => {
            if (selector.includes('conversation-title')) return [{ textContent: 'Current page title' }];
            if (selector === 'user-query, model-response') return [{}, {}];
            return [];
        },
        querySelector: () => null,
        scroll: () => { throw new Error('Must not scroll history'); },
    } as unknown as Document;
    assert.deepEqual(parseGeminiDomIndex(doc, 'current_conversation'), {
        id: 'current_conversation', title: 'Current page title', titleSource: 'dom', messageCount: 2,
    });
});

test('reserved route names are not valid conversation identities', () => {
    for (const id of ['download', 'c_settings', 'trash', 'explore']) assert.equal(isReservedRoute(id), true);
    for (const id of ['c_1bd028d5c5b0c0e2', 'normal_chat_id', '', null]) assert.equal(isReservedRoute(id), false);
});
});

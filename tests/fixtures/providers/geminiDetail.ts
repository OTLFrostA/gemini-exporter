import timestampPairs from '../gemini_timestamp_pairs.json';
import generatedFile from '../provider/gemini_generated_file.json';
import sourceJson0 from '../provider/structured_rpc/live-combined-file-citations.json';
import sourceJson1 from '../provider/structured_rpc/wire-case-b-cand.json';
import sourceJson2 from '../provider/structured_rpc/wire-turn-3-12-b-stack.json';
import sourceJson3 from '../provider/structured_rpc/live-file-citations.json';
import sourceJson4 from '../provider/structured_rpc/live-optics-table-citations.json';
import sourceJson5 from '../provider/structured_rpc/live-blockquote.json';
import sourceJson6 from '../provider/structured_rpc/live-source-attributions.json';
import sourceJson7 from '../provider/structured_rpc/live-source-table.json';
import sourceJson8 from '../provider/structured_rpc/live-range-coder.json';
import sourceJson9 from '../provider/structured_rpc/live-imagen-panel.json';
import { decodeGeminiStructuredPayload } from '../../../src/l1/parsers/gemini/rpc/structuredContent.js';
import { listGen as geminiListGen } from './gemini.js';
/** Native batchexecute response bodies containing Gemini's hNvQHb Detail RPC. */
const DOMAIN_ID = 'c_native12345678';
const rpc = (inner: unknown): string => ")]}'\n\n" + JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify(inner)]]);
function domainTurn(prompt = 'Question', seconds: number | null = 1700000000,
    candidates: unknown[] = [['rc_answer', [['Answer']]]], request = 'r_AB12'): unknown[] {
    return [[DOMAIN_ID, request], seconds === null ? null : [seconds, 0], [[prompt]], [candidates]];
}

/** Raw observability probes previously in parse_observability.test.ts. */
function observabilityTurn(id = 'c_abc123def456', userPayload: unknown = [['hello']]): unknown[] {
    return [[id], [1700000000, 0], userPayload, [[['rc_cand000001', ['world'], 'en']]]];
}


/** Native Detail payloads for source-document and parser boundary tests. */
function observabilityDocumentTurn(extraCand: unknown[]): unknown[] {
    const candidate: unknown[] = ['rc_cand000001', ['world'], 'en', ...extraCand];
    return [['c_abc123def456'], [1700000000, 0], [['hello']], [[candidate]]];
}
const BOUNDARY_ID = 'c_boundary12345678';
function boundaryTurn(prompt = 'Boundary user prompt', seconds: number | null = 1700000000,
    candidates: unknown[] = [['rc_boundary', [['Boundary model answer'], 'en']]]): unknown[] {
    return [[BOUNDARY_ID, 'r_AB12'], seconds === null ? null : [seconds, 500000000], [[prompt]], [candidates]];
}

/** Wire format local to the selected-candidate Detail response fixtures. */
function selectedCandidates(): unknown[] {
    return [
        ['rc_displayed', [['## System Definition and Mass Balances\n\nDisplayed balance.']]],
        ['rc_alternative', [['## System Boundaries and Assumptions\n\nUnselected balance.']]],
    ];
}
function selectedWire(candidates: unknown[], selected?: unknown): string {
    const model = [candidates, null, null, selected];
    const turn = [['c_selected12345678', 'r_request'], [1700000000, 0], [['Derive the mass balance.']], model];
    return ")]}'\n\n" + JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[turn]])]]);
}

/** Native hNvQHb payloads used by the independent dual-parser audit tests. */
function dualAuditWire(markdown = 'Hello', document: unknown = { children: [{ nodeType: 18, text: 'Hello' }] }): string {
    const candidate: unknown[] = [[['rc_dualaudit', [markdown]]]];
    candidate[12] = document;
    return JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[[['c_dualaudit', 'r_fixture'], [1700000000, 0], [['Question']], candidate]]])]]);
}

/** hNvQHb responses for structured-content coverage probes and captured evidence. */
const COVERAGE_FALLBACK = 'MARKDOWN_FALLBACK_SENTINEL';
function coverageTextNode(value: string, flag: number): unknown[] {
    return [null, [null, 0, value, [[0, value.length, [[null, null, null, null, flag]]]]]];
}
function coverageWire(raw: unknown, candidates: unknown[] = [['rc_answer', [[COVERAGE_FALLBACK]]]]): string {
    const payload: unknown[] = [candidates];
    if (raw !== undefined) payload[12] = raw;
    return JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[[['c_coverage', 'r_coverage'], [1700000000, 0], [['Question']], payload]]])]]);
}


/** Source-attribution probes: each key resolves one native hNvQHb response. */
const citationFallback = 'UNRELATED_MARKDOWN_SENTINEL';
const citationFiles: Record<string, unknown> = {
    'live-combined-file-citations': sourceJson0,
    'wire-case-b-cand': sourceJson1,
    'wire-turn-3-12-b-stack': sourceJson2,
    'live-file-citations': sourceJson3,
    'live-optics-table-citations': sourceJson4,
    'live-blockquote': sourceJson5,
    'live-source-attributions': sourceJson6,
    'live-source-table': sourceJson7,
    'live-range-coder': sourceJson8,
    'live-imagen-panel': sourceJson9,
};
const citationFile = (name: string): unknown => {
    const data = citationFiles[name];
    if (data === undefined) throw new Error('Missing captured Gemini citation fixture ' + name);
    return structuredClone(data);
};
const citationText = (value: string, annotations: unknown[] = []): unknown[] => [null, [null, 0, value, annotations]];
const citationField = (index: number, value: unknown): unknown[] =>
    Object.assign(Array(index + 1).fill(null), { [index]: value });
const citationSourceAnnotation = (start: number, end: number, ids = ['spp_fixture']): unknown[] =>
    [start, end, [null, null, null, [null, ids]]];
const citationSourceTable = (sources: unknown[] = [['https://example.com/source', 'Source title']]): unknown[] =>
    [null, [[['cited span'], [1], sources, 'spp_fixture']]];
function citationWire(raw: unknown, table?: unknown, alternatives: unknown[] = []): string {
    const payload: unknown[] = [[['rc_primary', [[citationFallback]], table], ...alternatives]];
    payload[12] = raw;
    return JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([
        [[['c_citationfixture', 'r_fixture'], [1700000000, 0], [['Question']], payload]],
    ])]]);
}

/** Previously inline malformed citation probes, encoded as distinct source responses. */
function citationInvalidFileMarker(marker: string): string {
    const raw = citationFile('live-combined-file-citations') as unknown[][][][];
    const copy = JSON.parse(JSON.stringify(raw)) as unknown[][][][];
    const node = copy[0][0][0] as unknown[];
    const payload = node[31] as unknown[][][];
    payload[0][0][0] = marker;
    return citationWire(copy);
}

/** Raw source-turn fixture for generated file-chip placement and UTF-8 resource checks. */
function generatedFileTurn(packet: unknown[], chip: unknown[], content: string, id: string, document: boolean): unknown[] {
    const candidate: unknown[] = ['rc_' + id, [content], 'en'];
    const payload: unknown[] = [[candidate]];
    if (document) {
        candidate[30] = [packet];
        payload[12] = [[[ [null, [null, 0, 'Before']], chip, [null, [null, 0, 'After']] ]]];
    }
    return [['r_' + id, 'c_e6dc4e0732ba568b'], [1700000000, 0], [['Prompt']], payload];
}


/** Raw Gemini image-evidence Detail responses (search metadata must not become assets). */
function visibleImageResponse(document?: unknown, includeSecondary = false): string {
    const searchUrl = 'https://encrypted-tbn2.gstatic.com/licensed-image?q=example';
    const searchResult = [
        [[searchUrl], null, 2048, 1536, null, null, null, 0, 'getty:example', 'getty', 'Getty Images'],
        [['https://www.gettyimages.com/detail/example'], '', 8], null,
        [[searchUrl], null, 2048, 1536, null, null, null, 0], null, null, null,
        ['http://googleusercontent.com/image_agent_tag_example', null, 'Reference diagram', null, null, 1],
    ];
    const candidate: unknown[] = ['rc_visible_images_test', ['Answer without pictures'], 'en'];
    candidate[12] = [searchResult];
    const candidates: unknown[] = [candidate];
    if (includeSecondary) {
        const secondary: unknown[] = ['rc_secondary_images_test', ['Second answer without pictures'], 'en'];
        secondary[12] = [searchResult];
        candidates.push(secondary);
    }
    const model: unknown[] = [candidates];
    if (document) model[12] = document;
    const turn = [['c_visible_images_test'], [1700000000, 0], [['Question']], model];
    return ")]}'\n\n" + JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[turn]])]]);
}
const visibleImageDocument = (): unknown =>
    citationFile('wire-turn-3-12-b-stack');


/** Exact Detail turn layout used by the P1-E source-wire regression cases. */
function p1RegressionTurn(userPayload: unknown = [['hello']], text = 'world', extraCand: unknown[] = []): unknown[] {
    const candidate: unknown[] = ['rc_cand000001', [text], 'en', ...extraCand];
    return [['c_abc123def456'], [1700000000, 0], userPayload, [[candidate]]];
}

function mixedNativePage(request: string, seconds: number, cursor: string | null = null): string {
    const turn = [['c_native', request], [seconds, 0], [['Question ' + request]],
        [[['rc_' + request, [['**Answer**']]]]]];
    return JSON.stringify([
        ['wrb.fr', 'hNvQHb', JSON.stringify([[turn], cursor, 'Title'])],
        ['wrb.fr', 'MaZiqc', JSON.stringify([null, null,
            [['c_native', 'Title', null, null, null, [1700000010, 0]]]])],
    ]);
}
function mixedNativeDocument(kind: number, body: string, more = false, suffix = 'report.md', metadata = true): string {
    const row: unknown[] = ['c_native_chat_' + suffix, null, 'Source document', null, body];
    row[10] = kind;
    if (metadata) row[8] = [['Metadata that must never become document prose'.repeat(5)]];
    const candidate: unknown[] = ['rc_native', ['Answer before document']];
    candidate[30] = [row];
    const turn = [['c_native_chat', 'r_native'], null, [['Question']], [[candidate]], [1700000010, 0]];
    return JSON.stringify([
        ['wrb.fr', 'hNvQHb', JSON.stringify([[turn], more ? 'next' : null, null, []])],
        ['wrb.fr', 'MaZiqc', JSON.stringify([null, null,
            [['c_native_chat', 'Title', null, null, null, [1700000000, 0]]]])],
    ]);
}

function boundaryTop(inner: unknown): string {
    return JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify(inner)]]);
}
function boundaryTitleWire(value: unknown): string {
    return rpc([[boundaryTurn('Newest prompt title'), boundaryTurn('Oldest prompt title')], null, value]);
}


/** Complete native batchexecute batches for production E2E passive/live-save audit. */
function e2eProductionMixed(id: string, question: string, answer: string, title: string): string {
    const turn = [['c_' + id, 'r_question'], [1700000000, 0], [[question]],
        [[['rc_question', [[answer]]]]]];
    return JSON.stringify([
        ['wrb.fr', 'hNvQHb', JSON.stringify([[turn], null])],
        ['wrb.fr', 'MaZiqc', JSON.stringify([null, null, [
            ['c_' + id, title, null, null, null, [1700000000, 0]],
        ]])],
    ]);
}
/** Fixed Detail responses used to verify request-UUID ownership across Gaia switches. */
function e2eUuidDetail(id: string): string {
    const turn = [['c_' + id, 'r_turn'], [1700000000, 0],
        [['Question']], [[['rc_turn', [['Answer']]]]]];
    return JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[turn], null, 'Source title'])]]);
}
/** Original L1 mixed Detail+List source response; the List half is the existing List key. */
function l1ContractWire(prompt = 'Question', next: string | null = null): string {
    const listRows: unknown[][] = JSON.parse(geminiListGen('G_L1_CONTRACT_01'));
    return JSON.stringify([
        ['wrb.fr', 'hNvQHb', JSON.stringify([[
            [['c_source_chat_123', 'r_' + prompt], [1700000000, 0], [[prompt]],
                [[['rc_' + prompt, [['Answer']]]]]],
        ], next])],
        ...listRows,
    ]);
}


/** The image-bearing hNvQHb source used by Takeout/media-identity integration tests. */
function mediaOnlineDetail(missingTime = false, missingPrompt = false, multipleImages = false): string {
    const time = 1788350400000, prompt = 'Draw a diagram of a green bridge';
    const pngLength = 68;
    const images = Array.from({ length: multipleImages ? 2 : 1 }, (_, i) => {
        const image: unknown[] = Array(16).fill(null);
        image[2] = 'online-' + i + '.png';
        image[3] = 'https://lh3.googleusercontent.com/media-source-' + i;
        image[11] = 'image/png';
        image[15] = [1, 1, pngLength];
        return image;
    });
    const turns = Array.from({ length: 10 }, (_, i) => [
        ['c_source-media', 'r_request-' + i],
        missingTime && i === 9 ? null : [time / 1000 + (i === 9 ? 0 : i - 20), 123000000],
        missingPrompt && i === 9 ? null : [[i === 9 ? prompt : 'Online question ' + i]],
        [['rc_answer-' + i, [['Complete online answer ' + i], ...(i === 9 ? images : [])]]],
    ]);
    return ")]}'\n\n" + JSON.stringify([['wrb.fr', 'hNvQHb',
        JSON.stringify([turns, null, 'Complete online body'])]]);
}


/** Four finite composite-layout variants with the original captured citation node. */
function citationCompositeWire(kind: 'paragraph' | 'list' | 'table' | 'quote'): string {
    const fileCitation = { nodeType: 'citation', number: 1, title: 'test_config.json' };
    const second = { ...fileCitation, number: 2, title: 'other.png' };
    const composite = { nodeType: 'paragraph', children: [
        { nodeType: 18, text: '😀 x_1', annotations: [{ start: 3, end: 6, type: 4 }] },
        fileCitation, { nodeType: 18, text: ' / ' }, second, { nodeType: 18, text: '. [1]' },
    ] };
    const node = kind === 'list' ? { nodeType: 20, items: [{ children: [composite] }] }
        : kind === 'table' ? { nodeType: 17, rows: [{ cells: [{ children: [composite] }] }] }
        : kind === 'quote' ? { nodeType: 15, children: [composite] } : composite;
    return citationWire({ children: [node] });
}
function citationInlineCombinedWire(): string {
    const decoded = decodeGeminiStructuredPayload(citationFile('live-combined-file-citations'));
    if (!decoded) throw new Error('Invalid captured citation source fixture');
    return citationWire({ children: [{ nodeType: 'paragraph', children: [
        { nodeType: 18, text: 'Before ' }, ...decoded.children, { nodeType: 18, text: ' after.' },
    ] }] });
}


function domainCapturedStructuredWire(): string {
    const candidate = citationFile('wire-case-b-cand');
    const structured = citationFile('wire-turn-3-12-b-stack');
    const rawTurn = domainTurn('Explain Bell inequalities', null, [candidate]);
    const model = rawTurn[3] as unknown[];
    model[12] = structured;
    return rpc([[rawTurn]]);
}

/** Previously inline parser-boundary, false-envelope and native-title responses. */
function boundarySelectedDraftWire(): string {
    const candidates = [
        ['rc_old', [['Old answer']]],
        ['rc_selected', [['Selected answer']]],
    ];
    const model = [candidates, null, 'google', 'rc_selected'];
    const raw = [[BOUNDARY_ID, 'r_AB12'], [1700000000, 500000000], [['Prompt']], model];
    return rpc([[raw]]);
}
function boundaryCitationThoughtWire(): string {
    const body: unknown[] = [['Visible answer'], ['THOUGHT', 'First thought'],
        [null, 'thought-details', 'Second thought'], ['THOUGHT', null],
        ['https://example.com/source', 'First source title'],
        ['https://example.com/source', 'Duplicate title'],
        ['https://example.com/malformed', 42],
        ['https://googleusercontent.com/immersive_entry_chip/a', 'Internal chip']];
    return rpc([[boundaryTurn('Cited prompt', null, [['rc_cited', body]])]]);
}
function boundaryImageAttachmentWire(): string {
    const url = 'https://lh3.googleusercontent.com/boundary-image';
    const image = [url, 640, 480, 'boundary-token'];
    return rpc([[boundaryTurn('Look at the image', null, [
        ['rc_image', [['![Image](' + url + ')'], image, null, ['broken.png']]],
    ])]]);
}
function boundaryCapturedDocumentWire(truncated = false): string {
    const candidate = citationFile('wire-case-b-cand');
    const document = citationFile('wire-turn-3-12-b-stack');
    const rawTurn = boundaryTurn('Explain Bell inequalities', null, [candidate]);
    const model = rawTurn[3] as unknown[];
    model[12] = truncated ? [[[null]]] : document;
    return rpc([[rawTurn]]);
}
function parserBundledTitleWire(): string {
    const detailInner = [[
        [['c_d3226d9a046c1116', 'r_turn_1'], null,
            [['然后mod要怎么打呢，我下载了一个mod文件，但是https://www.nexusmods.com/slaythespire2/mods/91']],
            [[['rc_model_1', ['这是Mod安装解答内容']]]]],
    ], null, null];
    const metaInner = [null, null,
        [['c_d3226d9a046c1116', '杀戮尖塔存档删除Mod风险',
            null, null, null, [1774139824, 809290000], null, null, null, 2]]];
    return ")]}'\n\n" + JSON.stringify([
        ['wrb.fr', 'hNvQHb', JSON.stringify(detailInner)],
        ['wrb.fr', 'MaZiqc', JSON.stringify(metaInner)],
    ]);
}
function p1BadLeadingDetailWire(): string {
    const junkStr = JSON.stringify({ data: [[['c_r_12345', [1, 2], 'music_tv talk', null]]] });
    const goodInner = JSON.stringify([[p1RegressionTurn()]]);
    return ")]}'\n\n" + JSON.stringify([
        ['x.fr', 'junk', junkStr],
        ['y.fr', 'data', goodInner],
    ]);
}

const fixtureMap = {
    'G_BOUNDARY_SELECTED_DRAFT_01': () => boundarySelectedDraftWire(),
    'G_BOUNDARY_THOUGHT_CITATION_01': () => boundaryCitationThoughtWire(),
    'G_BOUNDARY_IMAGE_ATTACHMENT_01': () => boundaryImageAttachmentWire(),
    'G_BOUNDARY_CAPTURED_STACK_01': () => boundaryCapturedDocumentWire(),
    'G_BOUNDARY_CAPTURED_TRUNCATED_01': () => boundaryCapturedDocumentWire(true),
    'G_GEMINI_PARSER_MIXED_TITLE_01': () => parserBundledTitleWire(),
    'G_P1E_LEADING_DECOY_DETAIL_01': () => p1BadLeadingDetailWire(),
    'G_RPC_DOMAIN_CAPTURED_STACK_01': () => domainCapturedStructuredWire(),
    'G_STRUCTURED_CITATION_COMPOSITE_PARAGRAPH_01': () => citationCompositeWire('paragraph'),
    'G_STRUCTURED_CITATION_COMPOSITE_LIST_01': () => citationCompositeWire('list'),
    'G_STRUCTURED_CITATION_COMPOSITE_TABLE_01': () => citationCompositeWire('table'),
    'G_STRUCTURED_CITATION_COMPOSITE_QUOTE_01': () => citationCompositeWire('quote'),
    'G_STRUCTURED_CITATION_INLINE_COMBINED_01': () => citationInlineCombinedWire(),
    'G_STRUCTURED_CITATION_MATH_FILE_CHIP_01': () => citationWire({ children: [
        { nodeType: 12, FTa: 'a=b' },
        { nodeType: 'citation', number: 1, title: 'test_config.json' },
    ] }),
    'G_RPC_DOMAIN_CAPTURED_STACK_01': () => domainCapturedStructuredWire(),
    'G_STRUCTURED_CITATION_COMPOSITE_PARAGRAPH_01': () => citationCompositeWire('paragraph'),
    'G_STRUCTURED_CITATION_COMPOSITE_LIST_01': () => citationCompositeWire('list'),
    'G_STRUCTURED_CITATION_COMPOSITE_TABLE_01': () => citationCompositeWire('table'),
    'G_STRUCTURED_CITATION_COMPOSITE_QUOTE_01': () => citationCompositeWire('quote'),
    'G_STRUCTURED_CITATION_INLINE_COMBINED_01': () => citationInlineCombinedWire(),
    'G_STRUCTURED_CITATION_MATH_FILE_CHIP_01': () => citationWire({ children: [
        { nodeType: 12, FTa: 'a=b' },
        { nodeType: 'citation', number: 1, title: 'test_config.json' },
    ] }),
    'G_MEDIA_SOURCE_DEFAULT_01': () => mediaOnlineDetail(),
    'G_MEDIA_SOURCE_NO_TIME_01': () => mediaOnlineDetail(true),
    'G_MEDIA_SOURCE_NO_PROMPT_01': () => mediaOnlineDetail(false, true),
    'G_MEDIA_SOURCE_MULTI_01': () => mediaOnlineDetail(false, false, true),
    'G_E2E_PRODUCTION_PASSIVE_MIXED_01': () =>
        e2eProductionMixed('passive', 'Question from passive capture', 'Answer from passive capture', 'Passive detail'),
    'G_E2E_PRODUCTION_NATIVE_AUDIT_MIXED_01': () =>
        e2eProductionMixed('production', 'Question production', 'Current native answer', 'Current title'),
    'G_E2E_PRODUCTION_CONTINUED_MIXED_01': () =>
        e2eProductionMixed('abcdef123456', 'Final prompt', 'Final appended answer', 'Current continued title'),
    'G_E2E_UUID_DETAIL_STALE_01': () => e2eUuidDetail('staleuuid123'),
    'G_E2E_UUID_DETAIL_CURRENT_01': () => e2eUuidDetail('currentuuid123'),
    'G_L1_CONTRACT_DETAIL_DEFAULT_01': () => l1ContractWire(),
    'G_L1_CONTRACT_DETAIL_NEWER_01': () => l1ContractWire('Newer', 'tC_NEXT_PAGE_123456789'),
    'G_L1_CONTRACT_DETAIL_OLDER_01': () => l1ContractWire('Older'),
    'G_BOUNDARY_DETAIL_INNER_NULL_01': () => boundaryTop(null),
    'G_BOUNDARY_DETAIL_INNER_ARRAY_01': () => boundaryTop([]),
    'G_BOUNDARY_DETAIL_INNER_OBJECT_01': () => boundaryTop({ unexpected: true }),
    'G_BOUNDARY_DETAIL_INNER_NUMBER_01': () => boundaryTop(42),
    'G_BOUNDARY_DETAIL_INNER_SCALAR_01': () => boundaryTop('scalar'),
    'G_BOUNDARY_DETAIL_INNER_BROKEN_01': () => JSON.stringify([['wrb.fr', 'hNvQHb', '[broken']]),
    'G_BOUNDARY_DETAIL_EMPTY_TEXT_01': () => '',
    'G_BOUNDARY_DETAIL_EMPTY_JSON_01': () => '[]',
    'G_BOUNDARY_DETAIL_RPC_NULL_01': () => rpc(null),
    'G_BOUNDARY_DETAIL_RPC_FALSE_01': () => rpc(false),
    'G_BOUNDARY_DETAIL_RPC_EMPTY_01': () => rpc([]),
    'G_BOUNDARY_DETAIL_RENAMED_01': () => {
        const wireTurn = boundaryTurn();
        const wrapped = { additional: { layers: [[[wireTurn]]] }, extra: true };
        return ")]}'\n\n" + JSON.stringify([['renamedEnvelope', 'renamedRpc', JSON.stringify(wrapped)]]);
    },
    'G_BOUNDARY_TITLE_UNDEFINED_01': () => boundaryTitleWire(undefined),
    'G_BOUNDARY_TITLE_NULL_01': () => boundaryTitleWire(null),
    'G_BOUNDARY_TITLE_EMPTY_01': () => boundaryTitleWire([]),
    'G_BOUNDARY_TITLE_OBJECT_01': () => boundaryTitleWire({ title: 'wrong shape' }),
    'G_BOUNDARY_TITLE_BLANK_01': () => boundaryTitleWire(''),
    'G_BOUNDARY_TITLE_SPACE_01': () => boundaryTitleWire('  '),
    'G_BOUNDARY_TITLE_GENERIC_01': () => boundaryTitleWire('Google Gemini'),
    'G_NATIVE_CALLERS_MIXED_01': () => mixedNativePage('r_new', 1700000010, 'tC_older'),
    'G_NATIVE_CALLERS_MIXED_02': () => mixedNativePage('r_old', 1700000000),
    'G_NATIVE_CALLERS_MIXED_03': () => mixedNativePage('r_one', 1700000000, 'tC_repeat'),
    'G_NATIVE_CALLERS_MIXED_04': () => mixedNativePage('r_native', 1700000000, 'tC_old'),
    'G_NATIVE_CALLERS_MIXED_05': () => mixedNativePage('r_older', 1700000000),
    'G_NATIVE_CALLERS_MIXED_06': () => mixedNativePage('r_newer', 1700000010, 'tC_retry_older'),
    'G_NATIVE_CALLERS_MIXED_07': () => mixedNativePage('r_newer', 1700000010, 'tC_retry_older'),
    'G_NATIVE_ACQ_MIXED_01': () => mixedNativePage('r_new', 1700000010, 'tC_older'),
    'G_NATIVE_ACQ_MIXED_02': () => mixedNativePage('r_old', 1700000000),
    'G_NATIVE_ACQ_MIXED_03': () => mixedNativePage('r_one', 1700000000, 'tC_repeat'),
    'G_NATIVE_ACQ_MIXED_04': () => mixedNativePage('r_native', 1700000000, 'tC_old'),
    'G_NATIVE_ACQ_MIXED_05': () => mixedNativePage('r_older', 1700000000),
    'G_NATIVE_ACQ_MIXED_06': () => mixedNativePage('r_newer', 1700000010, 'tC_retry_older'),
    'G_NATIVE_ACQ_MIXED_07': () => mixedNativePage('r_newer', 1700000010, 'tC_retry_older'),
    'G_NATIVE_DOCUMENT_01': () => mixedNativeDocument(1, '# Report\n\nExact source body'),
    'G_NATIVE_DOCUMENT_02': () => mixedNativeDocument(1, '# Report\n\nExact source body', true),
    'G_NATIVE_DOCUMENT_03': () => mixedNativeDocument(2, "```python\nprint(\"ok\")\n```"),
    'G_NATIVE_DOCUMENT_04': () => mixedNativeDocument(2, "```python\nprint(\"ok\")\n```", true),
    'G_NATIVE_DOCUMENT_05': () => mixedNativeDocument(3, '# Research\n\nReferences and findings'),
    'G_NATIVE_DOCUMENT_06': () => mixedNativeDocument(3, '# Research\n\nReferences and findings', true),
    'G_NATIVE_DOCUMENT_07': () => mixedNativeDocument(3, 'First body', false, 'first', false),
    'G_NATIVE_DOCUMENT_08': () => mixedNativeDocument(3, 'Second body', false, 'second', false),
    'G_DYNAMIC_TITLE_ARBITRATION_DETAIL_01': () => {
        const turn = [['c_sniff_test_chat_888', 'r_question'], [1700000000, 0],
            [['如何构建高性能分布式缓存系统？']], [[['rc_question', [['构建高性能分布式缓存需要注意这些要点']]]]]];
        return JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[turn], null, ''])]]);
    },
    'G_BOUNDARY_ALTERNATE_RPC_01': () => {
        const turn = [['c_boundary12345678', 'r_AB12'], [1700000000, 500000000],
            [['Boundary user prompt']], [[['rc_boundary', [['Boundary model answer'], 'en']]]]];
        return JSON.stringify([
            ['wrb.fr', 'hNvQHb', '[null]'],
            ['wrb.fr', 'otherRpc', JSON.stringify([[turn]])],
        ]);
    },
        'G_P1E_DETAIL_01': () => rpc([[p1RegressionTurn(undefined,
        '第一行\nhttps://googleusercontent.com/immersive_entry_chip/abc123\n第三行')]]),
    'G_P1E_DETAIL_02': () => rpc([[p1RegressionTurn(undefined,
        '看这张图\nhttps://googleusercontent.com/image_generation_content/tok999\n结束',
        [['https://lh3.googleusercontent.com/img=w100', 100, 100]])]]),
    'G_P1E_DETAIL_03': () => rpc([null, null, [['c_meta1234567890', '元数据标题', 'x']]]),
    'G_P1E_DETAIL_04': () => rpc([[p1RegressionTurn(['hello world from user'])]]),
    'G_P1E_DETAIL_05': () => rpc([[p1RegressionTurn([['标准形态文本']])]]),
    'G_GEMINI_PARSER_DETAIL_01': () => {
        const model = [
            [
                ['rc_024c7ad5d90f4db8', [
                    ['不能。如果你的CAS完全没有装备机枪，是无法夺取制空权的。'],
                    'zh',
                ]],
            ],
            [['hoi4 air wing equipment filtering tags']],
            'google', 'c', 'S', 6, 6, '.',
        ];
        const turn = [
            ['c_024c7ad5d90f4db8', 'r_turn_1'],
            [1717058840, 264000000],
            [['如果cas不带机枪的话能抢制空么']],
            model,
        ];
        return ")]}'\n\n" + JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[turn], null, '钢铁雄心4制空测试'])]]);
    },
    'G_GEMINI_PARSER_DETAIL_02': () => rpc([['c_123', 'Title with [brackets] inside', 'data']]),

    'G_VISIBLE_IMAGE_01': () => visibleImageResponse(),
    'G_VISIBLE_IMAGE_02': () => visibleImageResponse(),
    'G_VISIBLE_IMAGE_03': () => visibleImageResponse(visibleImageDocument()),
    'G_VISIBLE_IMAGE_04': () => visibleImageResponse(visibleImageDocument(), true),
    'G_GROUNDING_CITATION_MARKERS_01': () => {
        const inner = [
            [
                [
                    ['c_533ac8ca2ecb8bd7', 'r_turn_u0'],
                    [1700000000, 0],
                    ['Load configuration test_config.json', 0],
                    null,
                ],
                [
                    ['c_533ac8ca2ecb8bd7', 'r_turn_m1'],
                    [1700000005, 0],
                    null,
                    [[
                        [
                            'rc_candidate_0',
                            [['Loaded \`test_config.json\`[cite: 1]:\n\n* **status**: \`"ok"\`[cite: 1]']],
                            null, null, null, null, null, null, null, null, null, null,
                            [{ '8': [], '44': [
                                [['[cite: 1]', 0], [[null, [[null, 0, 'test_config.json', null, [3, null, 'File attachment']]]]]],
                            ] }],
                        ],
                    ]],
                ],
            ],
            null,
            'c_533ac8ca2ecb8bd7',
        ];
        return ")]}'\n\n" + JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify(inner)]]);
    },
    'G_GENERATED_FILES_01': () => {
        const fixture = structuredClone(generatedFile) as { packet: unknown[]; chip: unknown[] };
        return JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[
            generatedFileTurn(fixture.packet, fixture.chip, 'Before\n\nAfter', 'later', true),
            generatedFileTurn(fixture.packet, fixture.chip, 'Earlier caption', 'earlier', false),
        ]])]]);
    },
    'G_PROVIDER_ADAPTER_01': () => {
        const turn = [['c_prefixed_detail', 'r_request'], [1700000000, 0], [['Question']],
            [[['rc_answer', [['Answer ![image](data:image/png;base64,AQID)']]]]]];
        return JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[turn], null, 'Canonical detail'])]]);
    },
    'G_MESSAGE_BRIDGE_DETAIL_01': () => JSON.stringify([['wrb.fr', 'hNvQHb',
        JSON.stringify([[[['c_bridge_chat_123', 'r_1'], [1700000000, 0], [['Question']],
            [[['rc_1', [['Answer']]]]]]]])]]),
    'G_LIVE_SAVE_OBSERVER_01': () => JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([
        [[['c_passive123', 'r_question'], [1700000000, 0], [['Question']],
            [[['rc_answer', [['Answer']]]]]]], null,
    ])]]),
    'G_MESSAGE_ROUTER_LIVE_SAVE_01': () => JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([
        [[['c_source_sniff_123', 'r_question'], [1700000000, 0], [['Question']],
            [[['rc_answer', [['Answer']]]]]]], null,
    ])]]),
    'G_STRUCTURED_CITATIONS_38': () => {
        const good = citationField(31, [[['[cite: 1]', 0], [[null, [[null, 0, 'file.json', null, null, null, null, null, 1, null, null, 'application/json'], null, null, null, null, null, 'file.json']]], ['quote', 0]]]);
        good[32] = 'unknown visible payload';
        return citationWire([[[good]]]);
    },
    'G_STRUCTURED_CITATIONS_29': () => citationWire(
        [[[citationText('body', [citationSourceAnnotation(0, 99)])]]],
        citationSourceTable()),
    'G_STRUCTURED_CITATIONS_30': () => citationWire(
        [[[citationText('body', [citationSourceAnnotation(0, 4, [])])]]],
        citationSourceTable()),
    'G_STRUCTURED_CITATIONS_31': () => citationWire(
        [[[citationText('body', [citationSourceAnnotation(0, 4, ['unknown'])])]]],
        citationSourceTable()),
    'G_STRUCTURED_CITATIONS_32': () => citationWire(
        [[[citationText('body', [[0, 4, [null, null, null, [null, ['spp_fixture']], 'unknown']]])]]],
        citationSourceTable()),
    'G_STRUCTURED_CITATIONS_33': () => citationWire(
        [[[citationText('body', [[0, 4, [[null, null, null, null, 2], null, null, [null, []]]]])]]],
        citationSourceTable()),
    'G_STRUCTURED_CITATIONS_34': () => citationWire(
        [[[citationText('body', [citationSourceAnnotation(0, 3), [2, 4, [[null, null, null, null, 2]]]])]]],
        citationSourceTable()),
    'G_STRUCTURED_CITATIONS_35': () => citationWire(
        [[[citationText('body', [[0, 4, [[null, null, null, null, 3]]], citationSourceAnnotation(1, 3)])]]],
        citationSourceTable()),
    'G_STRUCTURED_CITATIONS_36': () => {
        const table = citationSourceTable();
        const rows = table[1] as unknown[][];
        rows.push([['same ID different URL'], [1], [['https://example.com/conflict', 'Conflict']], 'spp_fixture']);
        return citationWire([[[citationText('body', [citationSourceAnnotation(0, 4)])]]], table);
    },
    'G_STRUCTURED_CITATIONS_37': () => citationWire(
        [[[citationText('body', [citationSourceAnnotation(0, 4)])]]],
        citationSourceTable([['javascript:bad', 'Bad']])),
    'G_STRUCTURED_CITATIONS_15': () => citationInvalidFileMarker('[cite: 1]'),
    'G_STRUCTURED_CITATIONS_16': () => citationInvalidFileMarker('[cite: 1, 1]'),
    'G_STRUCTURED_CITATIONS_17': () => citationInvalidFileMarker('[cite: 1, 0]'),
    'G_STRUCTURED_CITATIONS_18': () => citationInvalidFileMarker('[cite: 1, 2, 3]'),
    'G_STRUCTURED_CITATIONS_19': () => citationInvalidFileMarker('[cite: 1, unknown]'),
    'G_STRUCTURED_CITATIONS_20': () => citationWire({ children: [citationField(13, [[]])] }),
    'G_STRUCTURED_CITATIONS_21': () => citationWire({ children: [citationField(13, ['invalid'])] }),
    'G_STRUCTURED_CITATIONS_22': () => citationWire({ children: [
        citationField(13, [[citationText('valid'), citationField(38, ['unknown'])]]),
    ] }),
    'G_STRUCTURED_CITATIONS_23': () => citationWire({ children: [
        { nodeType: 'paragraph', children: [{ nodeType: 1, code: 'not inline' }] },
    ] }),
    'G_STRUCTURED_CITATIONS_24': () => citationWire({ children: [
        { nodeType: 'paragraph', children: [{ nodeType: 18, text: 'heading', jJ: 2 }] },
    ] }),
    'G_STRUCTURED_CITATIONS_25': () => citationWire([[[citationField(31, [])]]]),
    'G_STRUCTURED_CITATIONS_26': () => citationWire([[[citationField(31, [['[cite: 1]', 0]])]]]),
    'G_STRUCTURED_CITATIONS_27': () => citationWire([[[citationField(31, [
        [['[cite: 0]', 0], [], ['quote', 0]],
    ])]]]),
    'G_STRUCTURED_CITATIONS_28': () => citationWire([[[citationField(31, [
        [['[cite: 1]', 0], [], ['quote', 0]],
    ])]]]),
    'G_STRUCTURED_CITATIONS_01': () => citationWire(citationFile('live-file-citations')),
    'G_STRUCTURED_CITATIONS_02': () => citationWire(citationFile('live-optics-table-citations')),
    'G_STRUCTURED_CITATIONS_03': () => citationWire(citationFile('live-blockquote')),
    'G_STRUCTURED_CITATIONS_04': () => {
        const quote = citationField(16, [[citationText('different quoted text')]]);
        return citationWire({ children: [{ nodeType: 20, items: [{ children: [quote] }] }] });
    },
    'G_STRUCTURED_CITATIONS_05': () => citationWire([[[citationField(16, [])]]]),
    'G_STRUCTURED_CITATIONS_06': () => citationWire([[[citationField(16, [[]])]]]),
    'G_STRUCTURED_CITATIONS_07': () => citationWire([[[citationField(16, ['bad'])]]]),
    'G_STRUCTURED_CITATIONS_08': () => citationWire([[[citationField(16, [[citationField(38, ['unknown'])]])]]]),
    'G_STRUCTURED_CITATIONS_09': () => {
        const quote = citationField(16, [[citationText('different quoted text')]]);
        quote[17] = 'conflicting content';
        return citationWire([[[quote]]]);
    },
    'G_STRUCTURED_CITATIONS_10': () => citationWire(citationFile('live-combined-file-citations')),
    'G_STRUCTURED_CITATIONS_11': () => citationWire(
        citationFile('live-source-attributions'), citationFile('live-source-table')),
    'G_STRUCTURED_CITATIONS_12': () => {
        const table = citationSourceTable([
            ['https://example.com/a', 'A'], ['https://example.com/b', 'B'],
            ['https://example.com/a', 'A'],
        ]);
        const raw = [[[citationText('😀 bold italic [1]', [
            citationSourceAnnotation(0, 14),
            [3, 14, [[null, null, null, null, 2]]],
            [8, 14, [[null, null, null, null, 1]]],
        ])]]];
        return citationWire(raw, table);
    },
    'G_STRUCTURED_CITATIONS_13': () => {
        const raw = [[[citationText('body', [citationSourceAnnotation(0, 4)])]]];
        return citationWire(raw, undefined, [
            ['rc_alternative', [['other body']], citationSourceTable()],
        ]);
    },
    'G_STRUCTURED_CITATIONS_14': () => {
        const raw = [[[citationText('body', [citationSourceAnnotation(0, 4)])]]];
        return citationWire(raw, citationSourceTable(), [['rc_alternative', [['other body']]]]);
    },
    'G_DUAL_AUDIT_01': () => dualAuditWire(),
    'G_DUAL_AUDIT_02': () => dualAuditWire(),
    'G_DUAL_AUDIT_03': () => dualAuditWire('Independent raw Markdown'),
    'G_DUAL_AUDIT_04': () => dualAuditWire(),
    'G_DUAL_AUDIT_05': () => dualAuditWire('Independent answer [cite: 1]', { children: [
        { nodeType: 'paragraph', children: [{ nodeType: 18, text: 'Native answer' },
            { nodeType: 'citation', number: 1, title: 'test_config.json' }] },
    ] }),
    'G_DUAL_AUDIT_06': () => dualAuditWire('Hello', null),
    'G_DUAL_AUDIT_07': () => dualAuditWire('Hello', { children: [{ nodeType: 999, text: 'Hello' }] }),
    'G_DUAL_AUDIT_08': () => dualAuditWire('Hello', { children: [] }),
    'G_DUAL_AUDIT_09': () => dualAuditWire(),
    'G_DUAL_AUDIT_10': () => dualAuditWire(),
    'G_DUAL_AUDIT_11': () => dualAuditWire('DIFFERENT'),
    'G_DUAL_AUDIT_12': () => dualAuditWire(),
    'G_DUAL_AUDIT_13': () => dualAuditWire('Hello', null),
    'G_DUAL_AUDIT_14': () => dualAuditWire(),
    'G_DUAL_AUDIT_15': () => dualAuditWire(),
    'G_STRUCTURED_COVERAGE_01': () => coverageWire(citationFile('live-range-coder')),
    'G_STRUCTURED_COVERAGE_02': () => {
        const leaf = coverageTextNode('PRIVATE_SOURCE_TEXT', 999);
        const list = Object.assign(Array(12).fill(null), { 11: [[[[leaf]]]] });
        return coverageWire([[[coverageTextNode('known', 3), list]]]);
    },
    'G_STRUCTURED_COVERAGE_03': () => coverageWire(undefined),
    'G_STRUCTURED_COVERAGE_04': () => coverageWire(
        citationFile('live-imagen-panel'),
        [['rc_image', [['\n']]]],
    ),
    'G_TIMESTAMP_HONESTY_01': () => rpc([[
        [['c_noTsTurn_1', 'r_turn_1'], null, [['Question']], [[['rc_model_1', [['Answer']]]]]],
    ]]),
    'G_PROMPT_LITERAL_01': () => {
        const prompt = "Use f(\\$)=1, **literal**, $x$, <input> and C:\\temp\\file.\n\nKeep [link](https://example.com) and \\* intact.";
        const turn = [['c_literalprompt', 'r_prompt'], [1700000000, 0], [[prompt]],
            [[['rc_answer', [['**Rendered answer**']]]]]];
        return JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[turn]])]]);
    },
    'G_SELECTED_CANDIDATE_01': () => selectedWire(selectedCandidates(), 'rc_displayed'),
    'G_SELECTED_CANDIDATE_02': () => selectedWire(selectedCandidates(), 'rc_alternative'),
    'G_SELECTED_CANDIDATE_03': () => selectedWire(selectedCandidates(), null),
    'G_SELECTED_CANDIDATE_04': () => selectedWire(selectedCandidates(), 'c'),
    'G_SELECTED_CANDIDATE_05': () => selectedWire(selectedCandidates(), 6),
    'G_SELECTED_CANDIDATE_06': () => selectedWire(selectedCandidates(), 'rc_missing'),
    'G_SELECTED_CANDIDATE_07': () => selectedWire([
        ['rc_unselected', [['Unselected image ![image](https://lh3.googleusercontent.com/unselected-image.png)'],
            ['https://lh3.googleusercontent.com/unselected-image.png', 640, 480]]],
        ['rc_selected', [['Displayed image ![image](https://lh3.googleusercontent.com/selected-image.png)'],
            ['https://lh3.googleusercontent.com/selected-image.png', 640, 480]]],
    ], 'rc_selected'),
    'G_PAGINATION_EMPTY_01': () => {
        const candidate = ['rc_empty', [''], null, []];
        const model: unknown[] = [[candidate], null, null, 'rc_empty'];
        model[8] = 'US';
        model[12] = [[]];
        model[24] = 1;
        const raw = [[[['c_source_chat_123', 'r_empty'], null, [['']], model, [1757132274, 411870000]]], null, null, []];
        return JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify(raw)]]);
    },

    'G_OBSERVABILITY_DOC_01': () => {
        const item = ['https://y/immersive_entry_chip/e2e', '123e4567-e89b-12d3-a456-426614174099', 'End To End Heuristic Title'];
        const clue = '## End To End Heuristic Title\n\n' + '正文'.repeat(100);
        return rpc([[observabilityDocumentTurn([[item], clue])]]);
    },
    'G_OBSERVABILITY_DOC_02': () => {
        const id = '123e4567-e89b-12d3-a456-426614174099';
        const item = ['https://y/immersive_entry_chip/0', id, 'Document'];
        const content = [id, [['http://googleusercontent.com/immersive_entry_chip/0\n# 虚构城市水力建模分析\n\n' + '正文详细内容'.repeat(20)]]];
        return rpc([[observabilityDocumentTurn([[item], content])]]);
    },
    'G_OBSERVABILITY_DOC_03': () => {
        const id = '123e4567-e89b-12d3-a456-426614174099';
        const item = ['https://y/immersive_entry_chip/0', id, 'Document'];
        const content = [id, [['http://googleusercontent.com/immersive_entry_chip/0\n']]];
        return rpc([[observabilityDocumentTurn([[item], content])]]);
    },
    'G_OBSERVABILITY_DOC_04': () => {
        const item = ['https://y/immersive_entry_chip/no-match', '123e4567-e89b-12d3-a456-426614174099', 'Target Research Report'];
        const unrelated = '# Different Document\n\n' + 'Unrelated content '.repeat(35);
        return rpc([[observabilityDocumentTurn([[item], unrelated])]]);
    },
    'G_BOUNDARY_DETAIL_01': () => {
        const newest = boundaryTurn('Newest prompt', 1700000010, [['rc_new_a', [['First variant']]], ['rc_new_b', 'Second variant']]);
        const oldest = boundaryTurn('Oldest prompt', 1700000000, [['rc_old', [['Old answer']]]]);
        return rpc([[newest, oldest], 'tC_detail_cursor', 'Official detail title', { extra: true }]);
    },
    'G_BOUNDARY_DETAIL_02': () => rpc([[[[BOUNDARY_ID], null, [['User only prompt']]]]]),
    'G_BOUNDARY_DETAIL_03': () => rpc([[[[BOUNDARY_ID], null, null, [[['rc_model_only', [['Model only answer']]]]]]]]),
    'G_BOUNDARY_DETAIL_04': () => {
        const user = boundaryTurn();
        user[2] = ['Flat user prompt title'];
        return rpc([[user]]);
    },
    'G_BOUNDARY_DETAIL_05': () => rpc([null, null, [[BOUNDARY_ID, 'Metadata title']]]),
    'G_BOUNDARY_DETAIL_06': () => rpc([null, { extra: true }]),
    'G_BOUNDARY_DETAIL_07': () => rpc([[boundaryTurn(), [['x_not_a_turn'], null, [['Rejected recognizer prompt']]]]]),
    'G_BOUNDARY_DETAIL_08': () => rpc([[boundaryTurn('Missing body prompt', null, [['rc_missing']])]]),
    'G_RPC_DOMAIN_01': () => {
        const code = "import math\n\n\nclass Encoder:\n    def encode(self):\n        return 1\n\n\n\nprint(Encoder().encode())";
        const answer = "Explanation\n\n```python\n" + code + "\n```\n\nConclusion";
        return rpc([[domainTurn('Show the program', 1700000000, [['rc_answer', [[answer]]]])]]);
    },
    'G_RPC_DOMAIN_02': () => {
        const body = [['**Answer** [1]'], ['THOUGHT', 'Check **facts**'], ['https://example.test/source', 'Source']];
        return rpc([[domainTurn('Question', 1700000000, [['rc_answer', body]])], null, 'Authored title']);
    },
    'G_RPC_DOMAIN_03': () => rpc([[domainTurn()]]),
    'G_RPC_DOMAIN_04': () => rpc([[domainTurn('Question', null, undefined, 'r_AbCd12')]]),
    'G_RPC_DOMAIN_05': () => {
        const older = domainTurn('Older', 1700000000, [['rc_old', [['Old answer']]]], 'r_old');
        const newer = domainTurn('Newer', 1700000010, [['rc_new1', [['First']]], ['rc_new2', [['Second']]]], 'r_new');
        return rpc([[newer, older]]);
    },
    'G_RPC_DOMAIN_06': () => rpc([[[[DOMAIN_ID], null, [['Question']], [[['rc_answer', [['Answer']]]]]]]]),
    'G_RPC_DOMAIN_07': () => rpc([[domainTurn(), [['x_not_a_turn'], null, [['Unrecognized source prompt']]]], 'tC_native_cursor']),
    'G_RPC_DOMAIN_08': () => rpc([[domainTurn()]]),
    'G_RPC_DOMAIN_09': () => rpc([null, null, [[DOMAIN_ID, 'Metadata title']]]),
    'G_RPC_DOMAIN_10': () => rpc([null, null, [[DOMAIN_ID, 'Metadata title']]]),
    'G_RPC_DOMAIN_11': () => rpc([[domainTurn()]]),
    'G_RPC_DOMAIN_12': () => {
        const image: unknown[] = [];
        image[2] = 'watermarked_img_native.png';
        image[3] = 'https://lh3.googleusercontent.com/native_generated_image';
        image[11] = 'image/png';
        image[15] = [640, 480, 100];
        return rpc([[domainTurn('Draw', null, [['rc_image', [['Image'], image]]], 'r_Ab12')]]);
    },
    'G_RPC_DOMAIN_13': () => rpc([]),
    'G_RPC_DOMAIN_14': () => rpc(null),
    'G_RPC_DOMAIN_15': () => rpc([]),
    'G_RPC_DOMAIN_16': () => {
        const image: unknown[] = [];
        image[2] = 'source:photo?.png';
        image[3] = 'https://lh3.googleusercontent.com/source-photo';
        image[11] = 'image/png';
        image[15] = [640, 480, 100];
        return rpc([[domainTurn('Draw', null, [['rc_image', [['Image'], image]]])]]);
    },
    'G_RPC_DOMAIN_17': () => rpc([[domainTurn('Draw', null, [['rc_inline', [['Image'], ['https://lh3.googleusercontent.com/inline', 1, 1]]]])]]),
    'G_RPC_DOMAIN_18': () => {
        const rawTurn = [[DOMAIN_ID], null, [['Question']], [[['', [['Answer']]]]]];
        return rpc([[rawTurn, rawTurn]]);
    },
    'G_RPC_DOMAIN_19': () => rpc([[domainTurn('Question', null, undefined, 'r_Ab12')]]),
    'G_RPC_DOMAIN_20': () => '',
    'G_RPC_DOMAIN_21': () => 'not JSON',
    'G_DETAIL_NATIVE_TRANSPORT_01': () => {
        const turn = [
            ['c_native_bridge', 'r_abc123'],
            [1700000000, 0],
            [['Independent question']],
            [[['rc_answer', [['Independent answer']]]]],
        ];
        return JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[turn], null, 'Native title'])]]);
    },
    'G_DETAIL_PARSER_FALLBACK_01': () => {
        const inner = [
            [
                [
                    ['c_fallback_123', 'r_turn_1'],
                    null,
                    [['如何用Rust写WebAssembly插件']],
                    [[['rc_model_1', ['这是Rust WebAssembly回答']]]],
                ],
            ],
            null,
            'Rust WebAssembly 开发实战',
        ];
        return ")]}'\n\n" + JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify(inner)]]);
    },
    'G_DETAIL_PARSER_META_ONLY_01': () => {
        const inner = [
            null,
            null,
            [['c_meta_only_456', '仅元数据标题', null, null, null, [1774139824, 809290000], null, null, null, 2]],
        ];
        return ")]}'\n\n" + JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify(inner)]]);
    },
    'G_SNIFFER_DETAIL_01': () => JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([
        [[[ 'c_source_sniff_123', 'r_question'], [1700000000, 0], [['Question']],
            [[['rc_answer', [['Answer']]]]]]], null,
    ])]]),
    'G_SNIFFER_DETAIL_02': () => JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([
        [[[ 'c_source_sniff_123', 'r_question'], [1700000000, 0], [['Question']],
            [[['rc_answer', [['Answer']]]]]]], null,
    ])]]),
    'G_SNIFFER_DETAIL_03': () => JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([
        [[[ 'c_source_sniff_123', 'r_question'], [1700000000, 0], [['Question']],
            [[['rc_answer', [['Answer']]]]]]], null,
    ])]]),
    'G_NATIVE_ACQ_01': () => {
        const turn = [['c_native', 'r_one'], [1700000000, 0], [['Question']], [[['rc_one', [['Answer']]]]]];
        return ")]}'\n\n" + JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[turn], null, 'Native title'])]]);
    },
    'G_NATIVE_ACQ_02': () => ")]}'\n\n" + JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([null, null, [['c_native']]])]]),
    'G_NATIVE_ACQ_03': () => ")]}'\n\n" + JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[], null, 'Empty conversation'])]]),
    'G_NATIVE_ACQ_04': () => ")]}'\n\n" + JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([null, null, [['c_native', 'Title']]])]]),
    'G_NATIVE_ACQ_05': () => ")]}'\n\n" + JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[], null, 'Verified empty conversation'])]]),
    'G_NATIVE_ACQ_06': () => ")]}'\n\n" + JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([null, null, [['c_native', 'Title']]])]]),
    'G_NATIVE_ACQ_07': () => ")]}'\n\n" + JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([null, null, [['c_native']]])]]),
    'G_NATIVE_CALLERS_01': () => {
        const turn = [['c_native', 'r_one'], [1700000000, 0], [['Question']], [[['rc_one', [['Answer']]]]]];
        return ")]}'\n\n" + JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[turn], null, 'Native title'])]]);
    },
    'G_NATIVE_CALLERS_02': () => ")]}'\n\n" + JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([null, null, [['c_native']]])]]),
    'G_NATIVE_CALLERS_03': () => ")]}'\n\n" + JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([null, null, [['c_native']]])]]),

    'G_PROVIDER_CONTRACT_01': () => JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[[['c_source123', 'r_1'], null, [['Question']], [[['rc_1', [['Answer']]]]]]]])]]),
    'G_OBSERVABILITY_01': () => rpc([[observabilityTurn(),
        observabilityTurn('c_odd000000000001', '非数组形态的 user payload'),
        [['x_123'], [1, 0], [['u']]]]]),
    'G_OBSERVABILITY_02': () => rpc([[observabilityTurn(), observabilityTurn('c_abc123def457')]]),
    'G_OBSERVABILITY_03': () => rpc([[observabilityTurn(), [['x_123'], [1, 0], [['u']]]]]),
    'G_OBSERVABILITY_04': () => rpc([[observabilityTurn(), [['x_123'], [1, 0], [['u']]]]]),

    // Static native Detail bodies used by E2E source acquisition probes.
    'G_E2E_TIER2_DETAIL_01': () => {
        const turn = [['c_probe', 'r_question'], [1700000000, 0], [['Question']],
            [[['rc_question', [['Answer']]]]]];
        return JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[turn], null, 'Probe title'])]]);
    },
    'G_E2E_DOMAIN_STORAGE_DETAIL_01': () =>
        JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([
            [[['c_cross_origin_native', 'r_1'], [1700000000, 0], [['Persist this question']],
                [[['rc_1', [['**Persist this answer**']]]]]]], null,
        ])]]),

    // Static hNvQHb fragments used to verify selective sniffer broadcasts.
    'G_REGRESSION_LOCK_FILTER_DETAIL_01': () =>
        String.fromCharCode(41, 93, 125, 39) + '\n' + JSON.stringify([['wrb.fr', 'hNvQHb', ['c_123'], null]]),
    'G_EXTRACTED_REGRESSION_FILTER_DETAIL_01': () =>
        String.fromCharCode(41, 93, 125, 39) + '\n' + JSON.stringify([['wrb.fr', 'hNvQHb', ['c_123'], null]]),
    'G_REGRESSION_LOCK_PARSER_DETAIL_01': () =>
        rpc([[[['c_testid1234567890ab', 'r1'], null,
            [['Special test message with , null , in code and [brackets]']],
            [[['rc1', [['answer1']]]]]]], null, 'Test Title']),
    'G_EXTRACTED_REGRESSION_PARSER_DETAIL_01': () =>
        rpc([[[['c_testid1234567890ab', 'r1'], null,
            [['Special test message with , null , in code and [brackets]']],
            [[['rc1', [['answer1']]]]]]], null, 'Test Title']),

    'G_L1_VERIFIED_DETAIL_1167_01': () =>
        String.fromCharCode(41, 93, 125, 39) + '\n\n' + JSON.stringify([['wrb.fr', 'hNvQHb', null, null, null, ['BardErrorInfo', 1167]]]),
    'G_L1_VERIFIED_DETAIL_1096_01': () =>
        String.fromCharCode(41, 93, 125, 39) + '\n\n' + JSON.stringify([['wrb.fr', 'hNvQHb', null, null, null, ['BardErrorInfo', 1096]]]),
    'G_L1_VERIFIED_DETAIL_1096_02': () =>
        String.fromCharCode(41, 93, 125, 39) + '\n\n' + JSON.stringify([['wrb.fr', 'hNvQHb', null, null, null, ['BardErrorInfo', 1096]]]),
    'G_VERSION_PAIR_DETAIL_01': () => versionPairDetail(0),
    'G_VERSION_PAIR_DETAIL_02': () => versionPairDetail(1),
    'G_VERSION_PAIR_DETAIL_03': () => versionPairDetail(2),
    'G_VERSION_PAIR_DETAIL_04': () => versionPairDetail(3),
    'G_VERSION_PAIR_DETAIL_05': () => versionPairDetail(4),
    'G_VERSION_PAIR_DETAIL_06': () => versionPairDetail(5),
    'G_VERSION_DETAIL_MATCHING_01': () => versionMixed([1700000000, 0], [1700000005, 123000000]),
    'G_VERSION_DETAIL_NO_META_01': () => versionMixed([1700000000, 0]),
    'G_VERSION_DETAIL_UNRELATED_01': () => versionUnrelated(),
    'G_VERSION_DETAIL_SAVED_AT_01': () => versionMixed([1700000000, 0], [1700000000, 0]),
    'G_VERSION_DETAIL_SAVED_AT_02': () => versionMixed([1700000000, 0], [1700000000, 0]),
    'G_VERSION_DETAIL_NEWER_01': () => versionMixed([1700000005, 0], [1700000005, 0]),
    'G_VERSION_DETAIL_PARTIAL_NEWER_01': () => versionMixed([1700000010, 0], [1700000010, 0], true),
    'G_VERSION_DETAIL_OLDER_01': () => versionMixed([1700000000, 0], [1700000000, 0]),
    'G_VERSION_DETAIL_PARTIAL_ID_01': () => versionMixed([1700000000, 0], [1700000000, 0], true, 'partial_chat'),
    'G_VERSION_DETAIL_UNKNOWN_ID_01': () => versionMixed([1700000000, 0], undefined, false, 'unknown_chat'),
    'G_VERSION_DETAIL_CONFLICT_ID_01': () => versionMixed([1700000005, 0], [1700000000, 0], false, 'conflicting_chat'),
    'G_VERSION_DETAIL_PAGE_FIRST_01': () => versionMixed([1700000005, 0], [1700000005, 0], true),
    'G_VERSION_DETAIL_PAGE_CHANGED_01': () => versionMixed([1700000000, 0], [1700000010, 0]),
    'G_VERSION_DETAIL_PAGE_CONSISTENT_01': () => versionMixed([1700000000, 0], [1700000005, 0]),
    'G_VERSION_DETAIL_HEALTHY_01': () => versionMixed([1700000000, 0], [1700000005, 0]),
    'G_VERSION_DETAIL_MISMATCHED_01': () => versionMixed([1700000010, 0], [1700000005, 0]),
    'G_VERSION_LAYERS_FRESHNESS_01': () => versionMixed([1700000000, 0], [1700000000, 0]),
    'G_VERSION_LAYERS_JSON_01': () => versionMixed([1700000000, 0], [1700000000, 0]),
    'G_VERSION_LAYERS_JSON_PARTIAL_01': () => versionMixed([1700000000, 0], [1700000000, 0], true),
    'G_VERSION_LAYERS_HEALTHY_01': () => versionMixed([1700000000, 0], [1700000005, 0]),
    'G_VERSION_LAYERS_MISMATCHED_01': () => versionMixed([1700000010, 0], [1700000005, 0]),
};

/** Original List+Detail source-version proof, now shared by keyed fixtures only. */
function versionMixed(messageTime: number[], version?: number[], more = false, id = 'version_chat'): string {
    const turn = [['c_' + id, 'r_request'], null, [['Question']],
        [[['rc_answer', [['Answer']]]]], messageTime];
    const rows: Array<[string, unknown]> = [['hNvQHb', [[turn], more ? 'tCnext' : null, null, []]]];
    if (version) rows.push(['MaZiqc', [null, null, [['c_' + id, 'Source title', null, null, null, version]]]]);
    return JSON.stringify(rows.map(([name, payload]) => ['wrb.fr', name, JSON.stringify(payload)]));
}
function versionPairDetail(index: number): string {
    const pairs: Array<{ metadataWire: number[]; detailTurnWire: number[] }> =
        timestampPairs;
    const pair = pairs[index];
    if (!pair) throw new Error('Missing Gemini timestamp pair ' + index);
    return versionMixed(pair.detailTurnWire, pair.metadataWire);
}
function versionUnrelated(): string {
    const rows: Array<[string, unknown]> = [
        ['hNvQHb', [[[['c_actual_chat', 'r_req'], [1700000000, 0], [['Q']],
            [[['rc_a', [['A']]]]]]]]],
        ['MaZiqc', [null, null, [
            ['c_other_chat', 'Unrelated', null, null, null, [1700000005, 0]],
        ]]],
    ];
    return JSON.stringify(rows.map(([name, payload]) => ['wrb.fr', name, JSON.stringify(payload)]));
}

export function detailGen(key: keyof typeof fixtureMap): string {
    return fixtureMap[key]();
}

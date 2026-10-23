import { readFileSync } from 'node:fs';
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
const citationFile = (name: string): unknown =>
    JSON.parse(readFileSync('tests/fixtures/provider/structured_rpc/' + name + '.json', 'utf8'));
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

const fixtureMap = {
    'G_GENERATED_FILES_01': () => {
        const fixture = JSON.parse(readFileSync('tests/fixtures/provider/gemini_generated_file.json', 'utf8')) as { packet: unknown[]; chip: unknown[] };
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
    'G_STRUCTURED_COVERAGE_01': () => coverageWire(JSON.parse(readFileSync('tests/fixtures/provider/structured_rpc/live-range-coder.json', 'utf8'))),
    'G_STRUCTURED_COVERAGE_02': () => {
        const leaf = coverageTextNode('PRIVATE_SOURCE_TEXT', 999);
        const list = Object.assign(Array(12).fill(null), { 11: [[[[leaf]]]] });
        return coverageWire([[[coverageTextNode('known', 3), list]]]);
    },
    'G_STRUCTURED_COVERAGE_03': () => coverageWire(undefined),
    'G_STRUCTURED_COVERAGE_04': () => coverageWire(
        JSON.parse(readFileSync('tests/fixtures/provider/structured_rpc/live-imagen-panel.json', 'utf8')),
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
};

export function detailGen(key: keyof typeof fixtureMap): string {
    return fixtureMap[key]();
}

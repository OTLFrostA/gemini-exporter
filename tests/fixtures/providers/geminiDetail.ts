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

const fixtureMap = {
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

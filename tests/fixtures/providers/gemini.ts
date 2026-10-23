import { readFileSync } from 'node:fs';
/** Raw network responses for the Gemini MaZiqc List RPC only. */
function wire(rows: readonly unknown[] = [], nextCursor: string | null = null): string {
    return JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, nextCursor, rows])]]);
}
function sourceRow(id: string, title: string, seconds: number) {
    return ['c_' + id, title, null, null, null, [seconds, 0]];
}

/** Backward-compatible generator used by existing List tests via sourceList. */
function geminiList(ids: readonly string[] = [], nextCursor: string | null = null) {
    return wire(ids.map(id => sourceRow(id, 'Title ' + id, 1700000000)), nextCursor);
}

const boundaryRow = () => sourceRow('boundary123', 'Source title', 1700000060);
const contractRow = (id = 'source_chat_123', seconds = 1700000050) =>
    sourceRow(id, 'Source title', seconds);
const rpcRow = () => sourceRow('verifiedrpc123', 'Verified', 1700000050);
const rpcEnvelope = (rpc: string, inner: unknown) => ['wrb.fr', rpc, JSON.stringify(inner)];
const rpcBatchWire = (...rows: unknown[][]) => JSON.stringify(rows);
// Native Any envelope regression characterized from 2026-10-20 hNvQHb NotFound.
const nativeAnyError = (rpc: string, code: unknown,
    type = 'type.googleapis.com/assistant.boq.bard.application.BardErrorInfo') =>
    ['wrb.fr', rpc, null, null, null, [5, null, [[type, [code]]]], 'generic'];



// One unique key per consuming List test call site. Values preserve the old data.

/** Preserve the historic P1-E List envelope, whose items occupy inner slot 1. */
function p1RegressionList(items: unknown[]): string {
    return ")]}'\n\n" + JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, items, null])]]);
}


function scanFlowWire(rows: unknown[]): string {
    const inner = JSON.stringify([null, null, rows]);
    return ")]}'\n\n" + '[["wrb.fr","MaZiqc",' + JSON.stringify(inner) + ']]';
}
const scanRows = (renamed = false): unknown[] => [
    ['c_scan_003', '微服务架构与分布式事务', [1700000200, 0], [1700000200, 0], 8, [1700000200, 0]],
    ['c_scan_002', 'Rust 高性能异步网络编程', [1700000100, 0], [1700000100, 0], 6, [1700000100, 0]],
    ['c_scan_001', renamed ? '改名后的老会话' : '量子计算与超导量子比特',
        [1700000000, 0], [1700000000, 0], 4, [1700000000, 0]],
];
const fixedPage = (id: string, title: string, seconds: number): string =>
    JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, null,
        [['c_' + id, title, null, null, null, [seconds, 0]]]])]]);

const fixtureMap = {
    'G_DYNAMIC_PAGE_SYNC_01': () => fixedPage('39d5b41870e49a67', '量子纠缠物理原理深度解析', 1700000000),
    'G_DYNAMIC_PAGE_SYNC_02': () => fixedPage('takeout_chat_888', 'Renamed by Gemini', 1700000200),
    'G_DYNAMIC_TITLE_ARBITRATION_01': () => fixedPage('arbitration_chat_999', '官方服务端RPC最终权威标题', 1700000000),
    'G_DYNAMIC_TITLE_ARBITRATION_02': () => fixedPage('arbitration_chat_999', 'RPC 更晚的标题', 1700000200),
    'G_DYNAMIC_WATERMARK_LIST_01': () => fixedPage('abcdef123', 'A', 1700000000),
    'G_DYNAMIC_WATERMARK_LIST_02': () => fixedPage('abcdef123', 'A', 1699999999),
    'G_DYNAMIC_SCAN_FLOW_LIST_01': () => scanFlowWire(scanRows()),
    'G_DYNAMIC_SCAN_FLOW_LIST_02': () => scanFlowWire(scanRows(true)),
    'G_DYNAMIC_SCAN_FLOW_PINNED_01': () => scanFlowWire([
        ['c_scan_pinned', '置顶的较早会话', null, null, null, [1600000000, 0]],
    ]),
    'G_PARSER_PAYLOAD_TOP_01': () => JSON.stringify([
        ['wrb.fr', 'MaZiqc', JSON.stringify([null, [['c_123', 'Title 1']]])],
        ['wrb.fr', 'otherRpc', '{}'],
    ]),
    'G_PARSER_PAYLOAD_LEGACY_01': () => JSON.stringify([
        ['wrb.fr', 'hXcbkd', JSON.stringify([null, [['c_legacy', 'Legacy Title']]])],
    ]),
    'G_PARSER_PAYLOAD_HEURISTIC_01': () => JSON.stringify([
        ['unknown_prefix', 'unknown_rpc', JSON.stringify([['turn1']])],
    ]),
    'G_PARSER_PAYLOAD_ERROR_01': () => JSON.stringify([
        ['wrb.fr', 'error_rpc', null, null, null, ['generic', 'BardErrorInfo: quota exceeded']],
    ]),
    'G_BOUNDARY_LIST_SLOTS_01': () => {
        const row = ['c_boundary12345678', 'Boundary title - Gemini', [1690000000],
            [1680000000], 2, [1700000000, 500000000], null, { extra: true }, null, 7];
        return ")]}'\n\n" + JSON.stringify([['wrb.fr', 'MaZiqc',
            JSON.stringify([null, [row], null, null, 'tC_fallback_cursor', { future: true }])]]);
    },
    'G_BOUNDARY_LIST_EMPTY_TEXT_01': () => '',
    'G_BOUNDARY_LIST_INVALID_JSON_01': () => 'not-json',
    'G_BOUNDARY_LIST_EMPTY_JSON_01': () => '[]',
    'G_BOUNDARY_LIST_BAD_DETAIL_01': () => ")]}'\n\n" +
        JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify(null)]]),
    'G_BOUNDARY_LIST_BAD_INNER_01': () => ")]}'\n\n" +
        JSON.stringify([['wrb.fr', 'MaZiqc', '[broken']]),
    'G_BOUNDARY_FRAMING_MIXED_01': () => {
        const first = ['wrb.fr', 'MaZiqc', '[["quoted [bracket] and \\"escape\\""]]'];
        const second = ['wrb.fr', 'hNvQHb', '[]'];
        return ")]}'\n123\n" + JSON.stringify([first]) + '\n[not-json]\n'
            + JSON.stringify([second]) + '\n[["unfinished';
    },
        'G_P1E_LIST_01': () => p1RegressionList([['c_cnt1234567890', 'T', null, null, null, 1757839234]]),
    'G_P1E_LIST_02': () => p1RegressionList([['c_cnt2234567890', 'T2', null, null, 7]]),
    'G_P1E_LIST_03': () => p1RegressionList([['c_nots1234567890', 'NoTime']]),
    'G_P1E_LIST_04': () => p1RegressionList([['c_hasts1234567890', 'HasTime', null, null, null, [1700000000, 0]]]),
    'G_GEMINI_PARSER_LIST_01': () => ")]}'\n\n" + JSON.stringify([['wrb.fr', 'MaZiqc',
        JSON.stringify([null, [['c_1234567890abcdef', 'Test Title', [1700000000, 0], [1700000000, 0], 5]], 'tC_token123'])]]),
    'G_PERF_RETRY_429_01': () => {
        const inner = JSON.stringify([null, [['c_conv123', 'Conversation 1', [1700000000, 0], [1700000000, 0], 1]], null]);
        return ")]}'\n\n" + JSON.stringify([['wrb.fr', 'MaZiqc', inner]]);
    },
    'G_MESSAGE_BRIDGE_LIST_01': () => JSON.stringify([['wrb.fr', 'MaZiqc',
        JSON.stringify([null, null, [['c_bridge_chat_123', 'Title', null, null, null, [1700000000, 0]]]])]]),
    'G_TAKEOUT_LIMIT_01': () => JSON.stringify([['wrb.fr', 'MaZiqc', null, null, null, ['BardErrorInfo', 1096]]]),
    'G_CONVERSATION_ORDER_01': () => JSON.stringify([
        ['wrb.fr', 'MaZiqc', JSON.stringify([null,
            [['c_server123', 'Server title', null, null, 12, [1700000000, 0]]]])],
    ]),

    'G_BOUNDARY_LIST_01': () => {
        const ids = ['c_missingtitle123', 'c_nulltitle123456', 'c_objecttitle1234', 'c_blanktitle12345'];
        const rows = [null, [], 'not-a-row', [ids[0]], [ids[1], null], [ids[2], { title: 'wrong shape' }], [ids[3], ' \t ']];
        return ")]}'\n\n" + JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, rows])]]);
    },
    'G_BOUNDARY_LIST_02': () => ")]}'\n\n" + JSON.stringify([['wrb.fr', 'MaZiqc',
        JSON.stringify([null, null, [['c_boundary12345678', 'Secondary title']]])]]),
    'G_BOUNDARY_LIST_03': () => ")]}'\n\n" + JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, [], 'tC_empty_page'])]]),
    'G_L1_CLIENT_V2_MOCKED_01': () => geminiList(['source_alpha']),
    'G_L1_CLIENT_V2_MOCKED_02': () => JSON.stringify([
        ['wrb.fr', 'MaZiqc', null, null, null, ['BardErrorInfo', 1096]],
    ]),
    'G_L1_CLIENT_V2_MOCKED_SRC_01': () => geminiList(['source_alpha'], 'tC_NEXT_123456789'),
    'G_L1_CLIENT_V2_MOCKED_SRC_02': () => geminiList(['source_beta']),
    'G_L1_CLIENT_V2_MOCKED_SRC_03': () => geminiList(['source_alpha']),
    'G_L1_CLIENT_V2_MOCKED_SRC_04': () => geminiList(['source_alpha'], 'tC_NEXT_123456789'),
    'G_L1_CLIENT_V2_MOCKED_SRC_05': () => geminiList(['source_alpha'], 'tC_NEXT_123456789'),
    'G_L1_CLIENT_V2_MOCKED_SRC_06': () => geminiList(),
    'G_L1_CLIENT_V2_MOCKED_SRC_07': () => geminiList(),
    'G_L1_CLIENT_V2_MOCKED_SRC_08': () => geminiList(),
    'G_L1_CLIENT_V2_MOCKED_SRC_09': () => geminiList(),
    'G_L1_CLIENT_V2_MOCKED_SRC_10': () => geminiList(),
    'G_L1_LIST_RPC_ISOLATION_01': () => rpcBatchWire(
        rpcEnvelope('hNvQHb', []), ['wrb.fr', 'MaZiqc', null, null, null, ['BardErrorInfo', 429]]),
    'G_L1_LIST_RPC_ISOLATION_02_0': () => rpcBatchWire(rpcEnvelope('hNvQHb', [])),
    'G_L1_LIST_RPC_ISOLATION_02_1': () => rpcBatchWire(rpcEnvelope('hNvQHb', [null, null, [rpcRow()]])),
    'G_L1_LIST_RPC_ISOLATION_02_2': () => rpcBatchWire(rpcEnvelope('hNvQHb', [null, 'tC_next', [rpcRow()]])),
    'G_L1_LIST_RPC_ISOLATION_03_0': () => rpcBatchWire(rpcEnvelope('hNvQHb', []), rpcEnvelope('MaZiqc', [null, null, [rpcRow()]])),
    'G_L1_LIST_RPC_ISOLATION_03_1': () => rpcBatchWire(rpcEnvelope('MaZiqc', [null, 'tC_next', [rpcRow()]]), rpcEnvelope('hNvQHb', [])),
    'G_L1_LIST_RPC_ISOLATION_04_LIMIT': () => rpcBatchWire(rpcEnvelope('hNvQHb', []), ['wrb.fr', 'MaZiqc', null, null, null, ['BardErrorInfo', 1096]]),
    'G_L1_LIST_RPC_ISOLATION_04_UNRELATED': () => rpcBatchWire(['wrb.fr', 'hNvQHb', null, null, null, ['BardErrorInfo', 1096]]),
    'G_L1_LIST_RPC_ISOLATION_05': () => rpcBatchWire(nativeAnyError('MaZiqc', 1096)),
    'G_L1_LIST_RPC_ISOLATION_06_0': () => rpcBatchWire(nativeAnyError('hNvQHb', 1096)),
    'G_L1_LIST_RPC_ISOLATION_06_1': () => rpcBatchWire(nativeAnyError('MaZiqc', 1167)),
    'G_L1_LIST_RPC_ISOLATION_06_2': () => rpcBatchWire(nativeAnyError('MaZiqc', 10961)),
    'G_L1_LIST_RPC_ISOLATION_06_3': () => rpcBatchWire(nativeAnyError('MaZiqc', '1096')),
    'G_L1_LIST_RPC_ISOLATION_06_4': () => rpcBatchWire(nativeAnyError('MaZiqc', 1096, 'type.googleapis.com/other.BardErrorInfo')),
    'G_L1_LIST_RPC_ISOLATION_06_5': () => rpcBatchWire(['wrb.fr', 'MaZiqc', null, null, null, [1096]]),
    'G_L1_CONTRACT_01': () => wire([contractRow()]),
    'G_L1_CONTRACT_02': () => ((nextCursor: string | null = null, id = 'source_chat_123', seconds = 1700000050) =>
        wire([contractRow(id, seconds)], nextCursor))('tC_NEXT_PAGE_123456789'),
    'G_L1_CONTRACT_03': () => wire(),
    'G_L1_CONTRACT_04': (nextCursor: string | null = null, id = 'source_chat_123', seconds = 1700000050) =>
        wire([contractRow(id, seconds)], nextCursor),
    'G_L1_CONTRACT_05': () => ((nextCursor: string | null = null, id = 'source_chat_123', seconds = 1700000050) =>
        wire([contractRow(id, seconds)], nextCursor))('tC_NEXT_PAGE_123456789'),
    'G_L1_CONTRACT_06': () => ((nextCursor: string | null = null, id = 'source_chat_123', seconds = 1700000050) =>
        wire([contractRow(id, seconds)], nextCursor))('tC_NEXT_PAGE_123456789'),
    'G_L1_CONTRACT_07': (nextCursor: string | null = null, id = 'source_chat_123', seconds = 1700000050) =>
        wire([contractRow(id, seconds)], nextCursor),
    'G_L1_CONTRACT_08': (nextCursor: string | null = null, id = 'source_chat_123', seconds = 1700000050) =>
        wire([contractRow(id, seconds)], nextCursor),
    'G_L1_CONTRACT_09': () => ((nextCursor: string | null = null, id = 'source_chat_123', seconds = 1700000050) =>
        wire([contractRow(id, seconds)], nextCursor))('tC_NEXT_PAGE_123456789'),
    'G_L1_CONTRACT_10': () => ((nextCursor: string | null = null, id = 'source_chat_123', seconds = 1700000050) =>
        wire([contractRow(id, seconds)], nextCursor))('tC_NEXT_PAGE_123456789'),
    'G_L1_CONTRACT_11': () => ((nextCursor: string | null = null, id = 'source_chat_123', seconds = 1700000050) =>
        wire([contractRow(id, seconds)], nextCursor))('tC_NEXT_PAGE_123456789', 'different_chat_456', 1700000040),
    'G_L1_CONTRACT_12': () => 'garbage',
    'G_L1_CONTRACT_13': () => wire(),
    'G_L1_CONTRACT_14': (nextCursor: string | null = null, id = 'source_chat_123', seconds = 1700000050) =>
        wire([contractRow(id, seconds)], nextCursor),
    'G_L1_CONTRACT_15_0': () => rpcBatchWire(['wrb.fr', 'MaZiqc', null, null, null, ['generic', "BardErrorInfo: cursor expired"]]),
    'G_L1_CONTRACT_15_1': () => rpcBatchWire(['wrb.fr', 'MaZiqc', null, null, null, ['generic', "[\"BardErrorInfo\",9999]"]]),
    'G_L1_CONTRACT_16': () => ((nextCursor: string | null = null) => wire([contractRow()], nextCursor))('tC_NEXT_PAGE_123456789'),
    'G_L1_CONTRACT_17': () => wire(),
    'G_L1_CONTRACT_18': (nextCursor: string | null = null) => wire([contractRow()], nextCursor),
    'G_L1_CONTRACT_19': (nextCursor: string | null = null) => wire([contractRow()], nextCursor),
    'G_L1_CONTRACT_21': () => JSON.stringify([
        ['wrb.fr', 'MaZiqc', null, null, null, ['BardErrorInfo', 1096]],
    ]),
    'G_L1_CONTRACT_22': () => ((nextCursor: string | null = null, id = 'source_chat_123', seconds = 1700000050) =>
        wire([contractRow(id, seconds)], nextCursor))('tC_NEXT_PAGE_123456789'),
    'G_L1_CONTRACT_23': () => ((nextCursor: string | null = null, id = 'source_chat_123', seconds = 1700000050) =>
        wire([contractRow(id, seconds)], nextCursor))('tC_NEXT_PAGE_123456789'),
    'G_LIST_SOURCE_BOUNDARY_07': () => wire([boundaryRow()]),
    'G_LIST_SOURCE_BOUNDARY_08_0': () => rpcBatchWire(rpcEnvelope('MaZiqc', [null, null, [null]])),
    'G_LIST_SOURCE_BOUNDARY_08_1': () => rpcBatchWire(rpcEnvelope('MaZiqc', [null, { unexpected: true }])),
    'G_LIST_SOURCE_BOUNDARY_08_2': () => rpcBatchWire(rpcEnvelope('MaZiqc', [null, null, [['c_unknown', 'Invalid identity']]])),
    'G_LIST_SOURCE_BOUNDARY_08_3': () => rpcBatchWire(rpcEnvelope('MaZiqc', [null, null, [['c_settings', 'Reserved route']]])),
    'G_LIST_SOURCE_BOUNDARY_09': () => wire([], 'tC_cursor'),
    'G_LIST_SOURCE_BOUNDARY_10_EXPLICIT': () => wire([sourceRow('boundary123', 'Title', 1700000060)]),
    'G_LIST_SOURCE_BOUNDARY_10_AMBIGUOUS': () => rpcBatchWire(rpcEnvelope('MaZiqc', [null, { cursor: 'unrecognized' }, [sourceRow('boundary123', 'Title', 1700000060)]])),
    'G_OBSERVED_PAGE_INGEST_01': () => wire([
        sourceRow('abcdef123', 'Newest', 1700000020),
        sourceRow('abcdef456', 'Older', 1700000010),
    ], 'tC_tail'),
    'G_PAGE_OBSERVATION_01': () => wire([
        sourceRow('abcdef123', 'abcdef123', 1700000020),
        sourceRow('abcdef456', 'abcdef456', 1700000010),
    ]),
    'G_PAGE_OBSERVATION_03': () => {
        const fallback = sourceRow('abcdef123', 'abcdef123', 1700000020);
        fallback[2] = fallback[5];
        fallback[5] = null;
        return wire([fallback]);
    },
    'G_PAGE_OBSERVATION_04': () => wire([
        sourceRow('abcdef123', 'abcdef123', 1700000010),
        sourceRow('abcdef456', 'abcdef456', 1700000020),
    ]),
    'G_PAGE_OBSERVATION_06': () => JSON.stringify([['wrb.fr', 'MaZiqc', '[]']]),
    'G_PAGE_OBSERVATION_07': () =>
        JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, { unexpected: true }])]]),
    'G_PAGE_OBSERVATION_08': () => wire([
        sourceRow('abcdef123', 'abcdef123', 1700000020),
        sourceRow('abcdef456', 'abcdef456', 1700000020),
        sourceRow('abcdef789', 'abcdef789', 1700000010),
    ]),
    'G_PAGE_OBSERVATION_09': () => {
        const row = sourceRow('abcdef456', 'abcdef456', 1700000020);
        row[5] = [1700000020, 100];
        return wire([row, sourceRow('abcdef123', 'abcdef123', 1700000020)]);
    },
    'G_PAGE_OBSERVATION_10': () => wire([
        sourceRow('abcdef123', 'abcdef123', 1700000020),
        sourceRow('abcdef123', 'abcdef123', 1700000020),
    ]),
    'G_PAGE_OBSERVATION_12': () => wire([sourceRow('abcdef123', 'abcdef123', 1700000020)]),
    'G_RPC_LIST_INGEST_01': () => wire([sourceRow('abcdef123456', 'Server title', 1700000000)]),
    'G_UNIFIED_INGEST_INTEGRITY_01': () => wire([
        ['c_unknown', 'Invalid'],
        sourceRow('valid_123', 'Valid Chat', 1700000000),
    ]),
    'G_E2E_PRODUCTION_V2_01': () => wire([
        sourceRow('passive', 'Captured title', 1700000000),
    ]),
    'G_SNIFFER_LIST_01': () => wire([sourceRow('source_sniff_list', 'Title source_sniff_list', 1700000000)]),
    'G_SNIFFER_LIST_02': () => wire([sourceRow('source_sniff_list', 'Title source_sniff_list', 1700000000)]),
    'G_SNIFFER_LIST_03': () => wire([sourceRow('source_sniff_list', 'Title source_sniff_list', 1700000000)]),
    'G_SNIFFER_LIST_04': () => wire([]),
    'G_SNIFFER_LIST_05': () => wire([sourceRow('valid', 'Title valid', 1700000000)]),
    'G_ACTIVE_TITLE_01': () => wire([
        ['c_generic_title_01', 'Observed generic_title_01', null, null, null, [1700000000, 0]],
        ['c_sniff_title_01', 'Observed sniff_title_01', null, null, null, [1700000000, 0]],
        ['c_resolved_title_01', 'Observed resolved_title_01', null, null, null, [1700000000, 0]],
        ['c_undated_rpc_01', 'Observed undated_rpc_01', null, null, null, null],
    ]),
    'G_GEMINI_CLIENT_RETRY_01': () => ")]}'\n\n" + wire([
        ['c_chat_rec_400', '400 Recovery Chat', null, null, null, [1700000000, 0]],
    ]),
    'G_VERIFIED_SCAN_OVERLAP_01': () => JSON.stringify([
        ['wrb.fr', 'MaZiqc', null, null, null, [13], 'generic'],
    ]),

    // Static native List bodies used by E2E source acquisition probes.
    'G_E2E_TIER3_LIST_01': () => `)]}'\n\n${JSON.stringify([
        ['wrb.fr', 'MaZiqc', JSON.stringify([null, null, [
            ['c_first_attach', 'First attachment conversation', null, null, null, [1700000200, 0]],
        ]])],
    ])}`,
    'G_E2E_TIER2_LIST_01': () =>
        JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, null,
            [['c_probe', 'Probe title', null, null, null, [1700000000, 0]]]])]]),

    'G_E2E_INCREMENTAL_ERROR_LIST_01': () =>
        JSON.stringify([['wrb.fr', 'MaZiqc', null, null, null, [13], 'generic']]),
    'G_E2E_INCREMENTAL_PASSIVE_LIST_01': () =>
        JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, null,
            [['c_passive80', 'Passive 80', null, null, null, [1700000080, 0]]]])]]),
    'G_E2E_UUID_PROFILE_LIST_01': () =>
        JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null,
            [['c_profile_delay', 'Profile delay', null, null, null, [1700000000, 0]]], null])]]),

    // Fixed single-RPC admission and hook-filter cases; preserve native framing.
    'G_FROZEN_CONTRACT_LIST_01': () => JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, null, []])]]),
    'G_REGRESSION_LOCK_DECOY_LIST_01': () =>
        JSON.stringify([['wrb.fr', 'MaZiqc', '[["aabbccdd11223344",null]]', null]]),
    'G_REGRESSION_LOCK_FILTER_LIST_01': () =>
        String.fromCharCode(41, 93, 125, 39) + '\n' + JSON.stringify([['wrb.fr', 'MaZiqc', ['c_123'], null]]),
    'G_EXTRACTED_REGRESSION_FILTER_LIST_01': () =>
        String.fromCharCode(41, 93, 125, 39) + '\n' + JSON.stringify([['wrb.fr', 'MaZiqc', ['c_123'], null]]),
    'G_REGRESSION_LOCK_REQUEST_LIST_01': () =>
        `)]}'\n\n[["wrb.fr","MaZiqc","[]",null]]`,
    'G_EXTRACTED_REGRESSION_REQUEST_LIST_01': () =>
        `)]}'\n\n[["wrb.fr","MaZiqc","[]",null]]`,
    'G_REGRESSION_LOCK_CURSOR_LIST_01': () =>
        JSON.stringify([['wrb.fr', 'MaZiqc', '[]', null]]),
    'G_EXTRACTED_REGRESSION_CURSOR_LIST_01': () =>
        JSON.stringify([['wrb.fr', 'MaZiqc', '[]', null]]),

    // L1 target-bound 1167 / provider-limit response proofs.
    'G_L1_VERIFIED_LIST_1167_01': () =>
        String.fromCharCode(41, 93, 125, 39) + '\n\n' + JSON.stringify([['wrb.fr', 'MaZiqc', null, null, null, ['BardErrorInfo', 1167]]]),
    'G_L1_VERIFIED_LIST_FALSE_DELETE_01': () =>
        String.fromCharCode(41, 93, 125, 39) + '\n\n' + JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, 'c_deadbeef00112233'])]]),
    'G_L1_VERIFIED_LIST_LIMIT_01': () =>
        String.fromCharCode(41, 93, 125, 39) + '\n\n' + JSON.stringify([['wrb.fr', 'MaZiqc', null, null, null, ['BardErrorInfo', 1096]]]),
    'G_L1_VERIFIED_LIST_LIMIT_10961': () =>
        String.fromCharCode(41, 93, 125, 39) + '\n\n' + JSON.stringify([['wrb.fr', 'MaZiqc', null, null, null, ['BardErrorInfo', 10961]]]),
    'G_L1_VERIFIED_LIST_LIMIT_429': () =>
        String.fromCharCode(41, 93, 125, 39) + '\n\n' + JSON.stringify([['wrb.fr', 'MaZiqc', null, null, null, ['BardErrorInfo', 429]]]),
    'G_L1_VERIFIED_LIST_LIMIT_STRING': () =>
        String.fromCharCode(41, 93, 125, 39) + '\n\n' + JSON.stringify([['wrb.fr', 'MaZiqc', null, null, null, ['BardErrorInfo', '1096']]]),
    'G_VERSION_PAIR_LIST_01': () => versionPairList(0),
    'G_VERSION_PAIR_LIST_02': () => versionPairList(1),
    'G_VERSION_PAIR_LIST_03': () => versionPairList(2),
    'G_VERSION_PAIR_LIST_04': () => versionPairList(3),
    'G_VERSION_PAIR_LIST_05': () => versionPairList(4),
    'G_VERSION_PAIR_LIST_06': () => versionPairList(5),
    'G_VERSION_CREATION_SLOT_LIST_01': () => JSON.stringify([
        ['wrb.fr', 'MaZiqc', JSON.stringify([null, null, [
            ['c_version_chat', 'Source title', [1700000005, 0], [1700000000, 0], null, null],
        ]])],
    ]),
    'G_VERSION_METADATA_ONLY_LIST_01': () => JSON.stringify([
        ['wrb.fr', 'MaZiqc', JSON.stringify([null, null, [
            ['c_metadata_chat', 'Metadata only', null, null, null, [1700000000, 0]],
        ]])],
    ]),
};

/** Six fixed anonymized source timestamp pairs, consumed through List keys. */
function versionPairList(index: number): string {
    const pairs: Array<{ listWire: number[] }> =
        JSON.parse(readFileSync('tests/fixtures/gemini_timestamp_pairs.json', 'utf8'));
    const pair = pairs[index];
    if (!pair) throw new Error('Missing Gemini timestamp pair ' + index);
    return JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, null,
        [['c_version_chat', 'Source title', null, null, null, pair.listWire]]])]]);
}

/** Each ID resolves to exactly one raw MaZiqc/batchexecute response body. */
export function listGen(key: keyof typeof fixtureMap): string {
    return fixtureMap[key]();
}

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
const asWire = (raw: string): string => raw;
// Native Any envelope regression characterized from 2026-10-20 hNvQHb NotFound.
const nativeAnyError = (rpc: string, code: unknown,
    type = 'type.googleapis.com/assistant.boq.bard.application.BardErrorInfo') =>
    ['wrb.fr', rpc, null, null, null, [5, null, [[type, [code]]]], 'generic'];



// One unique key per consuming List test call site. Values preserve the old data.
const fixtureMap = {
    'G_L1_CLIENT_V2_MOCKED_01': () => geminiList(['source_alpha']),
    'G_L1_CLIENT_V2_MOCKED_02': () => asWire(JSON.stringify([
        ['wrb.fr', 'MaZiqc', null, null, null, ['BardErrorInfo', 1096]],
    ])),
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
    'G_L1_CONTRACT_12': () => asWire('garbage'),
    'G_L1_CONTRACT_13': () => wire(),
    'G_L1_CONTRACT_14': (nextCursor: string | null = null, id = 'source_chat_123', seconds = 1700000050) =>
        wire([contractRow(id, seconds)], nextCursor),
    'G_L1_CONTRACT_15_0': () => rpcBatchWire(['wrb.fr', 'MaZiqc', null, null, null, ['generic', "BardErrorInfo: cursor expired"]]),
    'G_L1_CONTRACT_15_1': () => rpcBatchWire(['wrb.fr', 'MaZiqc', null, null, null, ['generic', "[\"BardErrorInfo\",9999]"]]),
    'G_L1_CONTRACT_16': () => ((nextCursor: string | null = null) => wire([contractRow()], nextCursor))('tC_NEXT_PAGE_123456789'),
    'G_L1_CONTRACT_17': () => wire(),
    'G_L1_CONTRACT_18': (nextCursor: string | null = null) => wire([contractRow()], nextCursor),
    'G_L1_CONTRACT_19': (nextCursor: string | null = null) => wire([contractRow()], nextCursor),
    'G_L1_CONTRACT_21': () => asWire(JSON.stringify([
        ['wrb.fr', 'MaZiqc', null, null, null, ['BardErrorInfo', 1096]],
    ])),
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
    'G_PAGE_OBSERVATION_06': () => asWire(JSON.stringify([['wrb.fr', 'MaZiqc', '[]']])),
    'G_PAGE_OBSERVATION_07': () =>
        asWire(JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, { unexpected: true }])]])),
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
};

/** Each ID resolves to exactly one raw MaZiqc/batchexecute response body. */
export function listGen(key: keyof typeof fixtureMap): string {
    return fixtureMap[key]();
}

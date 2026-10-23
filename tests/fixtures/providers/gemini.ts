import { parseList } from '../../../src/l1/parsers/gemini/rpc/parseList.js';

/**
 * Gemini-specific synthetic List source data. Keep native MaZiqc rows, RPC
 * envelopes, malformed inputs and protocol error codes outside test bodies.
 * These fixtures use the real parser; they never mock GeminiProvider itself.
 */
function wire(rows: readonly unknown[] = [], nextCursor: string | null = null): string {
    return JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, nextCursor, rows])]]);
}
function parsed(rows: readonly unknown[] = [], nextCursor: string | null = null) {
    return parseList(wire(rows, nextCursor));
}
function sourceRow(id: string, title: string, seconds: number) {
    return ['c_' + id, title, null, null, null, [seconds, 0]];
}

/** Backward-compatible generator used by existing List tests via sourceList. */
function geminiList(ids: readonly string[] = [], nextCursor: string | null = null) {
    return parsed(ids.map(id => sourceRow(id, 'Title ' + id, 1700000000)), nextCursor);
}

const boundaryRow = () => sourceRow('boundary123', 'Source title', 1700000060);
const contractRow = (id = 'source_chat_123', seconds = 1700000050) =>
    sourceRow(id, 'Source title', seconds);
const rpcRow = () => sourceRow('verifiedrpc123', 'Verified', 1700000050);
const rpcEnvelope = (rpc: string, inner: unknown) => ['wrb.fr', rpc, JSON.stringify(inner)];
const parseRpcBatch = (...rows: unknown[][]) => parseList(JSON.stringify(rows));
// Native Any envelope regression characterized from 2026-10-20 hNvQHb NotFound.
const nativeAnyError = (rpc: string, code: unknown,
    type = 'type.googleapis.com/assistant.boq.bard.application.BardErrorInfo') =>
    ['wrb.fr', rpc, null, null, null, [5, null, [[type, [code]]]], 'generic'];

const fixtureValues = {
    invalidSourcePage: () => {
        const page = geminiList(['source_alpha']);
        page.pageEvidence.valid = false;
        return page;
    },
    providerLimit: () => parseList(JSON.stringify([
        ['wrb.fr', 'MaZiqc', null, null, null, ['BardErrorInfo', 1096]],
    ])),
    invalidBardErrors: () => ['BardErrorInfo: cursor expired', '["BardErrorInfo",9999]'].map(error =>
        parseList(JSON.stringify([['wrb.fr', 'MaZiqc', null, null, null, ['generic', error]]]))),
    malformedWire: () => parseList('garbage'),
    rpcIsolationUnrelatedError: () => parseRpcBatch(
        rpcEnvelope('hNvQHb', []), ['wrb.fr', 'MaZiqc', null, null, null, ['BardErrorInfo', 429]]),
    rpcIsolationMissingEnvelope: () => [[], [null, null, [rpcRow()]],
        [null, 'tC_next', [rpcRow()]]].map(inner => parseRpcBatch(rpcEnvelope('hNvQHb', inner))),
    rpcIsolationTargetWins: () => [
        parseRpcBatch(rpcEnvelope('hNvQHb', []), rpcEnvelope('MaZiqc', [null, null, [rpcRow()]])),
        parseRpcBatch(rpcEnvelope('MaZiqc', [null, 'tC_next', [rpcRow()]]), rpcEnvelope('hNvQHb', [])),
    ],
    rpcIsolationProviderLimit: () => ({
        limited: parseRpcBatch(rpcEnvelope('hNvQHb', []),
            ['wrb.fr', 'MaZiqc', null, null, null, ['BardErrorInfo', 1096]]),
        unrelated: parseRpcBatch(['wrb.fr', 'hNvQHb', null, null, null, ['BardErrorInfo', 1096]]),
    }),
    rpcIsolationNativeLimit: () => parseRpcBatch(nativeAnyError('MaZiqc', 1096)),
    rpcIsolationInvalidNativeErrors: () => [
        nativeAnyError('hNvQHb', 1096), nativeAnyError('MaZiqc', 1167),
        nativeAnyError('MaZiqc', 10961), nativeAnyError('MaZiqc', '1096'),
        nativeAnyError('MaZiqc', 1096, 'type.googleapis.com/other.BardErrorInfo'),
        ['wrb.fr', 'MaZiqc', null, null, null, [1096]],
    ].map(packet => parseRpcBatch(packet)),

    boundaryObservation: () => parsed([boundaryRow()]),
    boundaryContinuation: () => parsed([], 'tC_cursor'),
    boundaryInvalidLayouts: () => [
        [null, null, [null]],
        [null, { unexpected: true }],
        [null, null, [['c_unknown', 'Invalid identity']]],
        [null, null, [['c_settings', 'Reserved route']]],
    ].map(inner => ({
        source: JSON.stringify(inner),
        page: parseList(JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify(inner)]])),
    })),
    boundaryTerminalCursor: () => {
        const row = sourceRow('boundary123', 'Title', 1700000060);
        return {
            explicit: parsed([row]),
            ambiguous: parseList(JSON.stringify([
                ['wrb.fr', 'MaZiqc', JSON.stringify([null, { cursor: 'unrecognized' }, [row]])],
            ])),
        };
    },

    contractPage: (nextCursor: string | null = null, id = 'source_chat_123', seconds = 1700000050) =>
        parsed([contractRow(id, seconds)], nextCursor),
    contractEmptyPage: () => parsed(),
    contractWire: (nextCursor: string | null = null) => wire([contractRow()], nextCursor),
    contractEmptyWire: () => wire(),
    contractDetailSidecar: () => ['wrb.fr', 'MaZiqc', JSON.stringify([null, null, [contractRow()]])],

    browserPassiveCaptureWire: () => wire([
        sourceRow('passive', 'Captured title', 1700000000),
    ]),
    rpcIngestWire: () => wire([sourceRow('abcdef123456', 'Server title', 1700000000)]),
    observedPageWire: () => wire([
        sourceRow('abcdef123', 'Newest', 1700000020),
        sourceRow('abcdef456', 'Older', 1700000010),
    ], 'tC_tail'),
    mixedInvalidParsedPage: () => parsed([
        ['c_unknown', 'Invalid'],
        sourceRow('valid_123', 'Valid Chat', 1700000000),
    ]),

    observationOrderedPage: () => parsed([
        sourceRow('abcdef123', 'abcdef123', 1700000020),
        sourceRow('abcdef456', 'abcdef456', 1700000010),
    ]),
    observationSinglePage: () => parsed([sourceRow('abcdef123', 'abcdef123', 1700000020)]),
    observationFallbackTimePage: () => {
        const fallback = sourceRow('abcdef123', 'abcdef123', 1700000020);
        fallback[2] = fallback[5];
        fallback[5] = null;
        return parsed([fallback]);
    },
    observationRisingTimePage: () => parsed([
        sourceRow('abcdef123', 'abcdef123', 1700000010),
        sourceRow('abcdef456', 'abcdef456', 1700000020),
    ]),
    observationCapturedEmpty: () => parseList(JSON.stringify([['wrb.fr', 'MaZiqc', '[]']])),
    observationUnknownNonempty: () =>
        parseList(JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, { unexpected: true }])]])),
    observationEqualTimes: () => parsed([
        sourceRow('abcdef123', 'abcdef123', 1700000020),
        sourceRow('abcdef456', 'abcdef456', 1700000020),
        sourceRow('abcdef789', 'abcdef789', 1700000010),
    ]),
    observationSubsecondTie: () => {
        const row = sourceRow('abcdef456', 'abcdef456', 1700000020);
        row[5] = [1700000020, 100];
        return parsed([row, sourceRow('abcdef123', 'abcdef123', 1700000020)]);
    },
    observationDuplicate: () => parsed([
        sourceRow('abcdef123', 'abcdef123', 1700000020),
        sourceRow('abcdef123', 'abcdef123', 1700000020),
    ]),
    observationRequest: (streamId: 'recent' | 'pinned', cursor: string | null = null) => {
        const filter = [streamId === 'recent' ? 0 : 1, null, 1];
        return new URLSearchParams({ 'f.req': JSON.stringify([[['MaZiqc',
            JSON.stringify([50, cursor, filter]), null, 'generic']]]) }).toString();
    },
    observationUnknownRequest: () => new URLSearchParams({
        'f.req': JSON.stringify([[['MaZiqc', JSON.stringify([50, null, [2, null, 1]]), null, 'generic']]]),
    }).toString(),
    observationExpandedRequests: () => {
        const filter = [null, null, 1, null, null, null, null, null, null, 1];
        const body = (value: unknown) => new URLSearchParams({ 'f.req': JSON.stringify([
            [['MaZiqc', JSON.stringify([31, null, value]), null, 'generic']],
        ]) }).toString();
        return {
            valid: body(filter),
            invalid: [filter.slice(0, 9), [...filter, null],
                filter.map((value, index) => index === 8 ? 1 : value)].map(body),
        };
    },

    domMetadata: () => {
        const header = { textContent: 'Header title' };
        const sidebar = { textContent: 'Google Gemini', href: 'https://gemini.google.com/app/boundary123',
            querySelector: () => null };
        const query = { textContent: 'First user question' };
        const doc = { title: 'Google Gemini',
            querySelectorAll: (selector: string) => selector.includes('a[href') ? [sidebar]
                : selector.includes('conversation-title') ? [header] : [],
            querySelector: (selector: string) => selector.startsWith('user-query') ? query : null,
        } as unknown as Document;
        return { header, doc };
    },
};

// One unique key per consuming List test call site. Values preserve the old data.
const fixtureMap = {
    'G_L1_CLIENT_V2_MOCKED_01': fixtureValues.invalidSourcePage,
    'G_L1_CLIENT_V2_MOCKED_02': fixtureValues.providerLimit,
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
    'G_L1_LIST_RPC_ISOLATION_01': fixtureValues.rpcIsolationUnrelatedError,
    'G_L1_LIST_RPC_ISOLATION_02': fixtureValues.rpcIsolationMissingEnvelope,
    'G_L1_LIST_RPC_ISOLATION_03': fixtureValues.rpcIsolationTargetWins,
    'G_L1_LIST_RPC_ISOLATION_04': fixtureValues.rpcIsolationProviderLimit,
    'G_L1_LIST_RPC_ISOLATION_05': fixtureValues.rpcIsolationNativeLimit,
    'G_L1_LIST_RPC_ISOLATION_06': fixtureValues.rpcIsolationInvalidNativeErrors,
    'G_L1_CONTRACT_01': fixtureValues.contractDetailSidecar,
    'G_L1_CONTRACT_02': () => fixtureValues.contractPage('tC_NEXT_PAGE_123456789'),
    'G_L1_CONTRACT_03': fixtureValues.contractEmptyPage,
    'G_L1_CONTRACT_04': fixtureValues.contractPage,
    'G_L1_CONTRACT_05': () => fixtureValues.contractPage('tC_NEXT_PAGE_123456789'),
    'G_L1_CONTRACT_06': () => fixtureValues.contractPage('tC_NEXT_PAGE_123456789'),
    'G_L1_CONTRACT_07': fixtureValues.contractPage,
    'G_L1_CONTRACT_08': fixtureValues.contractPage,
    'G_L1_CONTRACT_09': () => fixtureValues.contractPage('tC_NEXT_PAGE_123456789'),
    'G_L1_CONTRACT_10': () => fixtureValues.contractPage('tC_NEXT_PAGE_123456789'),
    'G_L1_CONTRACT_11': () => fixtureValues.contractPage('tC_NEXT_PAGE_123456789', 'different_chat_456', 1700000040),
    'G_L1_CONTRACT_12': fixtureValues.malformedWire,
    'G_L1_CONTRACT_13': fixtureValues.contractEmptyPage,
    'G_L1_CONTRACT_14': fixtureValues.contractPage,
    'G_L1_CONTRACT_15': fixtureValues.invalidBardErrors,
    'G_L1_CONTRACT_16': () => fixtureValues.contractWire('tC_NEXT_PAGE_123456789'),
    'G_L1_CONTRACT_17': fixtureValues.contractEmptyWire,
    'G_L1_CONTRACT_18': fixtureValues.contractWire,
    'G_L1_CONTRACT_19': fixtureValues.contractWire,
    'G_L1_CONTRACT_21': fixtureValues.providerLimit,
    'G_L1_CONTRACT_22': () => fixtureValues.contractPage('tC_NEXT_PAGE_123456789'),
    'G_L1_CONTRACT_23': () => fixtureValues.contractPage('tC_NEXT_PAGE_123456789'),
    'G_LIST_SOURCE_BOUNDARY_07': fixtureValues.boundaryObservation,
    'G_LIST_SOURCE_BOUNDARY_08': fixtureValues.boundaryInvalidLayouts,
    'G_LIST_SOURCE_BOUNDARY_09': fixtureValues.boundaryContinuation,
    'G_LIST_SOURCE_BOUNDARY_10': fixtureValues.boundaryTerminalCursor,
    'G_LIST_SOURCE_BOUNDARY_11': fixtureValues.domMetadata,
    'G_OBSERVED_PAGE_INGEST_01': fixtureValues.observedPageWire,
    'G_PAGE_OBSERVATION_01': fixtureValues.observationOrderedPage,
    'G_PAGE_OBSERVATION_02_RECENT': () => fixtureValues.observationRequest('recent', 'incoming'),
    'G_PAGE_OBSERVATION_02_PINNED': () => fixtureValues.observationRequest('pinned', 'incoming'),
    'G_PAGE_OBSERVATION_03': fixtureValues.observationFallbackTimePage,
    'G_PAGE_OBSERVATION_04': fixtureValues.observationRisingTimePage,
    'G_PAGE_OBSERVATION_05': fixtureValues.observationUnknownRequest,
    'G_PAGE_OBSERVATION_06': fixtureValues.observationCapturedEmpty,
    'G_PAGE_OBSERVATION_07': fixtureValues.observationUnknownNonempty,
    'G_PAGE_OBSERVATION_08': fixtureValues.observationEqualTimes,
    'G_PAGE_OBSERVATION_09': fixtureValues.observationSubsecondTie,
    'G_PAGE_OBSERVATION_10': fixtureValues.observationDuplicate,
    'G_PAGE_OBSERVATION_11': fixtureValues.observationExpandedRequests,
    'G_PAGE_OBSERVATION_12': fixtureValues.observationSinglePage,
    'G_RPC_LIST_INGEST_01': fixtureValues.rpcIngestWire,
    'G_UNIFIED_INGEST_INTEGRITY_01': fixtureValues.mixedInvalidParsedPage,
    'G_E2E_PRODUCTION_V2_01': fixtureValues.browserPassiveCaptureWire,
};

/** Single public List data entrypoint for gemini; no cross-provider protocol abstraction. */
export function listGen<K extends keyof typeof fixtureMap>(key: K): ReturnType<(typeof fixtureMap)[K]> {
    return fixtureMap[key]() as ReturnType<(typeof fixtureMap)[K]>;
}

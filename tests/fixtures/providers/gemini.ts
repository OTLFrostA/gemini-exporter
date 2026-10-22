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
export function geminiList(ids: readonly string[] = [], nextCursor: string | null = null) {
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

export const geminiListFixtures = {
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

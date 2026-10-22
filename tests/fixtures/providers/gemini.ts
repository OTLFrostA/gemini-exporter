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

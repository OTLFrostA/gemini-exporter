import { parseList } from '../../../src/l1/parsers/gemini/rpc/parseList.js';

/**
 * Synthetic Gemini List RPC fixtures. Generate wire data independently of
 * provider behavior; the real source parser decodes the returned RPC shape.
 * Deliberately scoped to List (not Detail, Takeout or DOM observations).
 */
export function geminiListWire(rows: readonly unknown[] = [], nextCursor: string | null = null): string {
    return JSON.stringify([['wrb.fr', 'MaZiqc', JSON.stringify([null, nextCursor, rows])]]);
}

/** For tests that need exact native rows, including invalid layouts. */
export function geminiListRows(rows: readonly unknown[] = [], nextCursor: string | null = null) {
    return parseList(geminiListWire(rows, nextCursor));
}

/** Conventional list page with the same IDs, titles and timestamp as the old sourceList fixture. */
export function geminiList(ids: readonly string[] = [], nextCursor: string | null = null) {
    return geminiListRows(ids.map(id =>
        ['c_' + id, 'Title ' + id, null, null, null, [1700000000, 0]]), nextCursor);
}

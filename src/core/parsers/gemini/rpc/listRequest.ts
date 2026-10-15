export interface GeminiListRequestContext {
    streamId: 'recent' | 'pinned';
    requestCursor: string | null;
}

/** Only the exact list request layout is evidence; ambiguous batched calls are ignored. */
export function readGeminiListRequest(body: unknown): GeminiListRequestContext | null {
    if (typeof body !== 'string') return null;
    try {
        const batch: unknown = JSON.parse(new URLSearchParams(body).get('f.req') || 'null');
        if (!Array.isArray(batch)) return null;
        const calls = batch.flat().filter((call: unknown) => Array.isArray(call) && call[0] === 'MaZiqc');
        if (calls.length !== 1) return null;
        const args: unknown = JSON.parse(calls[0][1]);
        if (!Array.isArray(args) || args.length !== 3 || !Number.isInteger(args[0]) || args[0] <= 0
            || !(args[1] === null || typeof args[1] === 'string') || !Array.isArray(args[2])) return null;
        const filter = args[2];
        const classic = filter.length === 3 && [0, 1].includes(filter[0]) && filter[1] === null && filter[2] === 1;
        // Captured webpage recent-list request. The expanded filter is exact evidence;
        // arbitrary extra fields still cannot establish scan coverage.
        const expandedRecent = filter.length === 10 && filter.every((value, index) => value === (index === 2 || index === 9 ? 1 : null));
        if (!classic && !expandedRecent) return null;
        return { streamId: classic && filter[0] === 1 ? 'pinned' : 'recent', requestCursor: args[1] };
    } catch { return null; }
}

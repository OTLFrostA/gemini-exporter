/** Boundary conversion: numeric values/strings are milliseconds, never guessed seconds. */
export function normalizeTimestamp(value: unknown): number | undefined {
    if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
    if (typeof value !== 'string' || !value.trim()) return undefined;
    const s = value.trim();
    const time = /^-?\d+$/.test(s) ? Number(s) : Date.parse(s);
    return Number.isSafeInteger(time) ? time : undefined;
}

/** Parse positive provider timestamps from ISO strings or epoch numbers (auto-scaling seconds below 1e12 to ms). */
export function parseEpochOrIsoTimestamp(value: unknown, options: { allowNumeric?: boolean } = {}): number | undefined {
    if ((options.allowNumeric ?? true) && typeof value === 'number' && Number.isFinite(value) && value > 0) {
        const ms = value < 1e12 ? Math.trunc(value * 1000) : Math.trunc(value);
        return Number.isSafeInteger(ms) && ms > 0 ? ms : undefined;
    }
    if (typeof value === 'string' && value) {
        const ms = Date.parse(value);
        return Number.isSafeInteger(ms) && ms > 0 ? ms : undefined;
    }
    return undefined;
}

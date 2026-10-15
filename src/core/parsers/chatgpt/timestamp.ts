/** ChatGPT numeric source dates use seconds (or already-millisecond values); strings use ISO dates. */
export function chatGPTTimestamp(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        const ms = value < 1e12 ? Math.round(value * 1000) : Math.round(value);
        return Number.isFinite(ms) ? ms : undefined;
    }
    if (typeof value === 'string' && value) {
        const ms = Date.parse(value);
        return Number.isFinite(ms) ? ms : undefined;
    }
    return undefined;
}

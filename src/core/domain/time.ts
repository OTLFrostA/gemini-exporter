export function toIso(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    }
    if (typeof value === 'string') {
        const s = value.trim();
        if (!s) return undefined;
        if (/^-?\d+$/.test(s)) return toIso(Number(s));
        const t = Date.parse(s);
        return Number.isNaN(t) ? undefined : new Date(t).toISOString();
    }
    return undefined;
}


/** Boundary conversion: numeric values/strings are milliseconds, never guessed seconds. */
export function normalizeTimestamp(value: unknown): number | undefined {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value !== 'string' || !value.trim()) return undefined;
    const s = value.trim();
    const time = /^-?\d+$/.test(s) ? Number(s) : Date.parse(s);
    return Number.isFinite(time) ? time : undefined;
}

/** Only source-authored facts enter Domain; unknown optional fields are absent. */
export function normalizeConversationTimes(source: { timestamp?: unknown; createdAt?: unknown; updatedAt?: unknown }): {
    timestamp: number | null; createdAt?: number; updatedAt?: number;
} {
    const createdAt = normalizeTimestamp(source.createdAt);
    const updatedAt = normalizeTimestamp(source.updatedAt);
    const timestamp = typeof source.timestamp === 'number' && Number.isFinite(source.timestamp) ? source.timestamp : null;
    return { timestamp,
        ...(createdAt !== undefined ? { createdAt } : {}),
        ...(updatedAt !== undefined ? { updatedAt } : {}) };
}

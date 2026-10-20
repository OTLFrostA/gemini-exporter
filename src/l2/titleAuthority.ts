export const TITLE_AUTHORITY_RANK = { user: 3, provider: 2, derived: 1 };
export type TitleSource = keyof typeof TITLE_AUTHORITY_RANK;
export interface TitleCandidate { value: string; source: TitleSource; observedAt?: string }
export function isTitleSource(source: string): source is TitleSource { return Object.hasOwn(TITLE_AUTHORITY_RANK, source); }
export function titleAuthorityRank(source: string | null | undefined): number { return source && isTitleSource(source) ? TITLE_AUTHORITY_RANK[source] : 0; }
export function resolveTitle(candidates: TitleCandidate[]): TitleCandidate | undefined {
    let winner: TitleCandidate | undefined;
    for (const item of candidates) if (item.value?.trim() && (!winner || TITLE_AUTHORITY_RANK[item.source] >= TITLE_AUTHORITY_RANK[winner.source])) winner = item;
    return winner;
}

export const TITLE_SOURCE_PRIORITY: TitleSource[] = ['user', 'provider', 'derived'];

export const TITLE_TIER_RANK = Object.fromEntries(TITLE_SOURCE_PRIORITY.map(source => [source, TITLE_AUTHORITY_RANK[source]]));

/**
 * Normalizes a raw source string into a canonical, reliable TitleSource.
 * Returns undefined if source is falsy, unknown, or an unreliable fallback
 * tier ('default', 'legacy', 'export').
 */
export function normalizeReliableTitleSource(source?: string | null): TitleSource | undefined {
    if (typeof source !== 'string') return undefined;
    const s = source.trim();
    if (!s || s === 'default' || s === 'legacy' || s === 'export') {
        return undefined;
    }
    return TITLE_SOURCE_PRIORITY.find(candidate => candidate === s);
}

/**
 * Resolves the first reliable TitleSource from candidate sources in priority order.
 * Returns undefined if no candidate provides a reliable source.
 */
export function resolveReliableTitleSource(...sources: (string | null | undefined)[]): TitleSource | undefined {
    for (const src of sources) {
        const normalized = normalizeReliableTitleSource(src);
        if (normalized) return normalized;
    }
    return undefined;
}

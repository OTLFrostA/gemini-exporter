/**
 * src/core/export/canonical/titleAuthority.ts
 * Title authority arbitration for the canonical layer.
 *
 * Implements integration doc section 3, item 2 ("title authority"): every
 * observed title candidate stays on the record with its source; resolution is
 * by authority tier. A lower-authority observation can never downgrade a
 * higher-authority resolved title.
 *
 * The tiers mirror the repo's TITLE_TIER_RANK (src/core/utils/titleUtils.ts):
 * rpc/api-detail 50, dom 40, takeout 30, sniff 20, legacy 10, default 0.
 * The package's own sources map onto the same ladder: 'user' (the user's own
 * title) outranks all auto-derived sources; 'provider' sits with takeout;
 * 'derived' sits with legacy.
 *
 * REVIEW NOTE: this mapping is the one judgment call in F2a. Same-tier
 * semantics follow the repo (a newer same-tier candidate overwrites), so
 * legacy title upgrade behavior cannot regress. Flag for user confirmation.
 */

import type { CanonicalTitleSource, ConversationTitle, TitleCandidate } from './conversation.js';

export const CANONICAL_TITLE_TIER_RANK: Record<CanonicalTitleSource, number> = {
    user: 60,
    rpc: 50,
    'api-detail': 50,
    dom: 40,
    provider: 30,
    takeout: 30,
    sniff: 20,
    derived: 10,
    legacy: 10,
    default: 0,
};

export function titleAuthorityRank(source: CanonicalTitleSource | string | null | undefined): number {
    if (!source) return CANONICAL_TITLE_TIER_RANK.default;
    const rank = (CANONICAL_TITLE_TIER_RANK as Record<string, number>)[source];
    return typeof rank === 'number' ? rank : CANONICAL_TITLE_TIER_RANK.default;
}

function pickWinner(candidates: TitleCandidate[]): TitleCandidate | undefined {
    let winner: TitleCandidate | undefined;
    for (const c of candidates) {
        if (!c || typeof c.value !== 'string' || !c.value) continue;
        if (!winner) {
            winner = c;
            continue;
        }
        const rankDiff = titleAuthorityRank(c.source) - titleAuthorityRank(winner.source);
        if (rankDiff > 0) {
            winner = c;
        } else if (rankDiff === 0) {
            // Same tier: a newer observation overwrites (repo setTitleBySource semantics).
            // Tie policy (deterministic): a present observedAt beats a missing one;
            // equal or both-missing timestamps resolve to the later-observed
            // candidate (insertion order). An older same-tier observation can
            // never overwrite a newer title.
            const cTime = c.observedAt ? Date.parse(c.observedAt) : NaN;
            const wTime = winner.observedAt ? Date.parse(winner.observedAt) : NaN;
            if (!Number.isNaN(cTime) && (Number.isNaN(wTime) || cTime >= wTime)) winner = c;
            else if (Number.isNaN(cTime) && Number.isNaN(wTime)) winner = c;
        }
    }
    return winner;
}

/**
 * Resolve the authoritative title from a set of observed candidates.
 * Returns undefined when no usable candidate exists (unknown stays unknown).
 */
export function resolveTitle(candidates: TitleCandidate[]): ConversationTitle | undefined {
    const usable = candidates.filter((c) => c && typeof c.value === 'string' && c.value.trim());
    const winner = pickWinner(usable);
    if (!winner) return undefined;
    return {
        value: winner.value,
        source: winner.source,
        candidates: [...candidates],
    };
}

/**
 * Fold one new observation into an existing title record. The candidate is
 * always retained in the candidates history; the resolved value/source is
 * recomputed from the complete candidate set through the single resolution
 * path (resolveTitle -> pickWinner), so there is exactly one definition of
 * title authority and tie-breaking. A lower-authority observation (e.g. sniff)
 * can never downgrade a higher-authority title (e.g. rpc), and an older
 * same-tier observation can never overwrite a newer one.
 */
export function applyTitleCandidate(
    title: ConversationTitle | undefined,
    candidate: TitleCandidate,
): ConversationTitle {
    const candidates = [...(title?.candidates ?? [])];
    if (candidate && typeof candidate.value === 'string' && candidate.value) {
        candidates.push(candidate);
    }
    const resolved = resolveTitle(candidates);
    if (resolved) return resolved;
    // No usable candidate at all: keep the previous title rather than
    // synthesizing one from an empty observation.
    if (title) return { value: title.value, source: title.source, candidates };
    return { value: candidate.value, source: candidate.source, candidates };
}

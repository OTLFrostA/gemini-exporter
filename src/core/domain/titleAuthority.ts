export interface TitleCandidate {
    value: string;
    source: TitleSource;
    observedAt?: string;
}

export const TITLE_AUTHORITY_RANK = {
    user: 60,
    rpc: 50,
    'api-detail': 50,
    dom: 40,
    provider: 30,
    takeout: 30,
    openai: 30,
    sniff: 20,
    derived: 10,
    legacy: 10,
    default: 0,
};

export type TitleSource = keyof typeof TITLE_AUTHORITY_RANK;

/** Narrow untrusted legacy source strings at the parser boundary. */
export function isTitleSource(source: string): source is TitleSource {
    return Object.hasOwn(TITLE_AUTHORITY_RANK, source);
}

export function titleAuthorityRank(source: string | null | undefined): number {
    return source && isTitleSource(source) ? TITLE_AUTHORITY_RANK[source] : TITLE_AUTHORITY_RANK.default;
}

function pickWinner(candidates: TitleCandidate[]): TitleCandidate | undefined {
    let winner: TitleCandidate | undefined;
    for (const c of candidates) {
        if (!c || typeof c.value !== 'string' || !c.value) continue;
        if (!winner) {
            winner = c;
            continue;
        }
        const rankDiff = TITLE_AUTHORITY_RANK[c.source] - TITLE_AUTHORITY_RANK[winner.source];
        if (rankDiff > 0) {
            winner = c;
        } else if (rankDiff === 0) {
            // Same-tier tie-breaker: prefer valid timestamp over missing, and newer (or later-inserted on tie) over older.
            const cTime = c.observedAt ? Date.parse(c.observedAt) : NaN;
            const wTime = winner.observedAt ? Date.parse(winner.observedAt) : NaN;
            if (!Number.isNaN(cTime) && (Number.isNaN(wTime) || cTime >= wTime)) winner = c;
            else if (Number.isNaN(cTime) && Number.isNaN(wTime)) winner = c;
        }
    }
    return winner;
}

export function resolveTitle(candidates: TitleCandidate[]): TitleCandidate | undefined {
    return pickWinner(candidates.filter((c) => c && typeof c.value === 'string' && c.value.trim()));
}

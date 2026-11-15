import type { ContentQuality } from '../../l2/quality.js';
export type { ContentQuality } from '../../l2/quality.js';
export interface QualityEvidence {
    rejectedTurns?: number;
    truncation?: string;
    heuristicDocumentIds?: string[];
    /** An available source body could not be represented without unverified loss. */
    unrepresentedContent?: boolean;
}

/** Known content loss or uncertain reconstruction makes the body partial. */
export function contentQuality(facts: ContentQuality & QualityEvidence): ContentQuality {
    const sourceTurn = facts.sourceTurn ? { sourceTurn: facts.sourceTurn } : {};
    if (facts.status === 'partial' || (facts.rejectedTurns ?? 0) > 0 || facts.truncation || facts.heuristicDocumentIds?.length || facts.unrepresentedContent)
        return { ...sourceTurn, status: 'partial' };
    return { ...sourceTurn, status: facts.status };
}

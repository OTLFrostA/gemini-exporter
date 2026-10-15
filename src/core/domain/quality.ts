/** Content facts established by parsers, independent of diagnostics and resource delivery. */
export interface ContentQuality {
    status: 'complete' | 'partial' | 'unknown';
    rejectedTurns?: number;
    /** Source acquisition stopped before the full body was read. */
    truncation?: string;
    /** Asset identities whose document content was assembled heuristically. */
    heuristicDocumentIds?: string[];
}

/** Known content loss or uncertain reconstruction always makes the body partial. */
export function contentQuality(facts: ContentQuality): ContentQuality {
    const { rejectedTurns = 0, truncation, heuristicDocumentIds = [] } = facts;
    const ids = [...new Set(heuristicDocumentIds)];
    return {
        status: rejectedTurns > 0 || truncation || ids.length ? 'partial' : facts.status,
        ...(rejectedTurns ? { rejectedTurns } : {}),
        ...(truncation ? { truncation } : {}),
        ...(ids.length ? { heuristicDocumentIds: ids } : {}),
    };
}

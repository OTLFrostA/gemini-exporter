import type { GeminiDocumentEvidence } from './detailEvidence.js';

/** Native candidate[30] documents carry identity and body together; never flatten their metadata. */
export function extractNativeDocuments(candidate: unknown, conversationId?: string): GeminiDocumentEvidence[] {
    if (!conversationId || !Array.isArray(candidate) || !Array.isArray(candidate[30])) return [];
    const prefix = `c_${conversationId.replace(/^c_/, '')}_`;
    return candidate[30].flatMap((row: unknown) => {
        if (!Array.isArray(row) || ![1, 2, 3].includes(row[10])
            || typeof row[0] !== 'string' || !row[0].startsWith(prefix)
            || typeof row[2] !== 'string' || !row[2].trim()
            || typeof row[4] !== 'string' || !row[4].trim()) return [];
        return [{ id: row[0], title: row[2].trim(), contentMarkdown: row[4], type: 'file',
            sections: [], links: [], url: '', chipUrl: '' }];
    });
}

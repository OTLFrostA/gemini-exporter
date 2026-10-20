import type { GeminiAttachmentEvidence } from './detailEvidence.js';

/** Captured code-document packets: candidate[30], filename[9], UTF-8 source[32][2]. */
export function extractGeneratedFiles(candidate: unknown): GeminiAttachmentEvidence[] {
    if (!Array.isArray(candidate) || !Array.isArray(candidate[30])) return [];
    return candidate[30].flatMap((row: unknown) => {
        if (!Array.isArray(row) || row[10] !== 26 || typeof row[0] !== 'string' || !row[0]
            || typeof row[2] !== 'string' || typeof row[9] !== 'string' || !row[9]
            || !Array.isArray(row[32]) || row[32][1] !== 2 || typeof row[32][2] !== 'string') return [];
        return [{ type: 'file', id: row[0], url: row[0], name: row[9], title: row[9], fileName: row[9],
            dataBuffer: new TextEncoder().encode(row[32][2]) }];
    });
}

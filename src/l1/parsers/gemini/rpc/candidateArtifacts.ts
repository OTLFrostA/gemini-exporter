import type { GeminiAttachmentEvidence, GeminiDocumentEvidence } from './detailEvidence.js';
import { extractDocumentsMeta, type DeepResearchDocMeta } from './deepResearchDocs.js';

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

interface DecodedCandidateArtifacts {
    generatedFiles: GeminiAttachmentEvidence[];
    nativeDocuments: GeminiDocumentEvidence[];
}

/** Interpret candidate[30] once. Document ownership comes from the chat ID or
 * a matching Deep Research chip in the selected answer. */
export function decodeCandidateArtifacts(
    candidate: unknown[], conversationId?: string, selectedAnswer?: unknown,
): DecodedCandidateArtifacts {
    const generatedFiles: GeminiAttachmentEvidence[] = [];
    const nativeDocuments: GeminiDocumentEvidence[] = [];

    const rawPackets: unknown = candidate[30];
    if (!isUnknownArray(rawPackets)) return { generatedFiles, nativeDocuments };
    const nativeIdPrefix = conversationId ? `c_${conversationId.replace(/^c_/, '')}_` : null;
    let researchChips: DeepResearchDocMeta[] | undefined;

    for (const raw of rawPackets) {
        if (!isUnknownArray(raw)) continue;
        const row = raw;
        const kind = row[10];

        if (kind === 26) {
            const id = row[0];
            const name = row[9];
            const sourceMarker = row[2];
            const data = row[32];
            if (typeof id !== 'string' || !id || typeof sourceMarker !== 'string'
                || typeof name !== 'string' || !name || !isUnknownArray(data)
                || data[1] !== 2 || typeof data[2] !== 'string') continue;
            generatedFiles.push({
                type: 'file', id, url: id, name, title: name, fileName: name,
                dataBuffer: new TextEncoder().encode(data[2])
            });
            continue;
        }

        if (kind !== 1 && kind !== 2 && kind !== 3) continue;
        const id = row[0];
        const title = row[2];
        const body = row[4];
        if (typeof id !== 'string'
            || typeof title !== 'string' || !title.trim()
            || typeof body !== 'string' || !body.trim()) continue;
        let chip: DeepResearchDocMeta | undefined;
        if (!nativeIdPrefix || !id.startsWith(nativeIdPrefix)) {
            if (kind !== 3 || !/^im_[0-9a-f]+$/.test(id) || selectedAnswer === undefined) continue;
            researchChips ??= extractDocumentsMeta(selectedAnswer);
            chip = researchChips.find(meta => meta.source === 'strict' && meta.id === id);
            if (!chip) continue;
        }
        nativeDocuments.push({
            id, title: title.trim(), contentMarkdown: body, type: 'file',
            sections: [], links: [], url: '', chipUrl: chip?.chipUrl ?? '',
            ...(chip?.createdAt !== undefined ? { createdAt: chip.createdAt } : {}),
        });
    }

    return { generatedFiles, nativeDocuments };
}

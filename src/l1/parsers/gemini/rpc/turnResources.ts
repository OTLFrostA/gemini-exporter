import { GEMINI_JSPB_SCHEMA, extractModelCandidates, type DecodedGeminiCandidate } from './extractors.js';
import { decodeCandidateArtifacts } from './candidateArtifacts.js';
import type { GeminiAttachmentEvidence, GeminiDocumentEvidence } from './detailEvidence.js';
import {
    extractImageEvidence,
    extractResponseImageEvidence,
    extractUserFiles,
    extractDocumentsMeta,
    findDocContentById,
    parseDocSections,
    findDocMarkdownByClues,
    filterNewImages,
    type ImageAttachment,
    type UserFileAttachment,
    type DeepResearchDocMeta,
    type DocSectionsResult,
} from './sourceAttachments.js';
import { inspectStructuredContent, type GeminiStructuredExtraction } from './structuredContent.js';
import { stripInternalChipMarkdown } from '../../shared/chipUtils.js';
import { RESEARCH_PROMPT_PREFIX_RE } from '../../../../shared/utils/titleText.js';
import { shortId } from '../../../../shared/utils/pathUtils.js';

/** Central Gemini resource decoder: untrusted wire slots stop here.
 * Message composition only receives validated and normalized source evidence. */
export interface DetailMediaReader {
    sourceOnly?: boolean;
    images: typeof extractImageEvidence;
    responseImages: typeof extractResponseImageEvidence;
}

export interface DecodedGeminiUserResources {
    images: ImageAttachment[];
    files: UserFileAttachment[];
}

export interface DecodedGeminiCandidateResources {
    images: ImageAttachment[];
    filteredImages: ImageAttachment[];
    generatedFiles: GeminiAttachmentEvidence[];
    documents: GeminiDocumentEvidence[];
    structuredExtraction: GeminiStructuredExtraction;
}

export const DOC_TITLE_FALLBACK_RE = /^#\s+(.+)$/m;

function wireArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

/** Media decoding uses the same Turn payload that decodeTurn validated as text. */
export function decodeGeminiUserResources(
    rawTurn: unknown, media: DetailMediaReader, imageSeq: { value: number }
): DecodedGeminiUserResources {
    const rawUserPayload = wireArray(rawTurn)
        ? rawTurn[GEMINI_JSPB_SCHEMA.TURN.USER_PAYLOAD] : undefined;
    return {
        images: media.images(rawUserPayload, imageSeq),
        files: extractUserFiles(rawUserPayload),
    };
}

/** decodeTurn selects the draft; specialized decoders see only that draft's
 * raw media/document slots and never re-select a Candidate themselves. */
export function decodeGeminiCandidateResources(
    rawTurn: unknown,
    candidate: DecodedGeminiCandidate,
    candidateIndex: number,
    inner: unknown,
    media: DetailMediaReader,
    dedupSet: Set<string>,
    docDedupSet: Set<string>,
    imageSeq: { value: number },
    convId?: string
): DecodedGeminiCandidateResources {
    const cand = extractModelCandidates(rawTurn)[candidateIndex];
    const answerBody = wireArray(cand) ? cand[GEMINI_JSPB_SCHEMA.CANDIDATE.BODY] : undefined;
    const candidateBlock = answerBody || cand;
    const modelPayload = wireArray(rawTurn) ? rawTurn[GEMINI_JSPB_SCHEMA.TURN.MODEL_PAYLOAD] : undefined;
    const turnDocument = wireArray(modelPayload)
        ? modelPayload[GEMINI_JSPB_SCHEMA.MODEL_PAYLOAD.STRUCTURED_CONTENT ?? 12] : undefined;
    const responseText = candidate.text;
    // Preserve the established ownership, fallback and ordering rules.
    const structuredExtraction = inspectStructuredContent({
        candidate: cand, turnDocument, candidateIndex
    });
    const structuredContent = structuredExtraction.status === 'decoded' ? structuredExtraction.document : undefined;
    const rawAnswerDocument = candidateIndex === 0 ? turnDocument : undefined;
    const candImages = media.responseImages(cand, [answerBody, rawAnswerDocument, structuredContent], responseText, imageSeq);
    const filteredImages = filterNewImages(candImages, dedupSet);

    const { generatedFiles, nativeDocuments } = decodeCandidateArtifacts(cand, convId);
    let docsMeta: DeepResearchDocMeta[] = nativeDocuments.length ? [] : extractDocumentsMeta(candidateBlock);
    if (!nativeDocuments.length && !docsMeta.length) {
        // The conversation envelope contains documents from other turns too.
        // Only the correlated answer document may supply missing chip metadata.
        docsMeta = extractDocumentsMeta([cand, rawAnswerDocument]);
    }
    const docs = docsMeta.filter((docItem: DeepResearchDocMeta) => {
        if (generatedFiles.some(file => file.id === docItem.id)
            || generatedFiles.length > 0 && docItem.source === 'heuristic-flat') return false;
        const key = docItem.id || docItem.chipUrl;
        if (!key || docDedupSet.has(key)) return false;
        const isRc = /^rc_/.test(docItem.id) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(docItem.id);
        const isHttp = docItem.id.includes("immersive_entry_chip") || docItem.id.startsWith("http");
        if (!isRc && isHttp) return false;
        docDedupSet.add(key);
        return true;
    });

    const docDetails: GeminiDocumentEvidence[] = nativeDocuments.filter(doc => {
        if (docDedupSet.has(doc.id)) return false;
        docDedupSet.add(doc.id);
        return true;
    });
    if (docs.length) {
        try {
            for (const metaItem of docs) {
                const primary = findDocContentById(inner, metaItem.id);
                const alt = metaItem.contentId ? findDocContentById(inner, metaItem.contentId) : null;
                const parsedPrimary = parseDocSections(primary?.node, primary?.contentMatch);
                const parsedAlt: Partial<DocSectionsResult> & Pick<DocSectionsResult, "sections" | "links"> = alt
                    ? parseDocSections(alt.node, alt.contentMatch)
                    : { sections: [], links: [], contentMarkdown: void 0 };
                const md = parsedPrimary.contentMarkdown || parsedAlt.contentMarkdown || findDocMarkdownByClues(inner, metaItem);
                const cleanMd = md ? stripInternalChipMarkdown(md).trim() : "";
                if (!cleanMd) continue;

                let docTitle = metaItem.title || "";
                if (!docTitle || RESEARCH_PROMPT_PREFIX_RE.test(docTitle) || docTitle === "Document") {
                    const hMatch = cleanMd.match(DOC_TITLE_FALLBACK_RE);
                    if (hMatch && hMatch[1].trim()) {
                        docTitle = hMatch[1].trim();
                    }
                }
                if (!docTitle || RESEARCH_PROMPT_PREFIX_RE.test(docTitle)) {
                    docTitle = `深度研究报告_${shortId(metaItem.id || "doc")}`;
                }

                // P1-9: 上游链任一 heuristic 标记 → 外层写 hasFabricatedText + 日志，
                // 不得静默把拼凑结果转成正常可信结果
                const heuristicChain = metaItem.source === "heuristic-flat"
                    || parsedPrimary?.contentMatch === "substring"
                    || parsedAlt?.contentMatch === "substring";
                if (heuristicChain && typeof console !== "undefined" && console.warn) {
                    console.warn(`[GemExporter:parseDetail.ts] heuristic doc content for "${docTitle}" (id=${metaItem.id}); marked hasFabricatedText`);
                }
                docDetails.push({
                    id: metaItem.id,
                    title: docTitle,
                    createdAt: metaItem.createdAt,
                    chipUrl: media.sourceOnly ? (metaItem.chipUrl ?? "") : "",
                    sections: [...parsedPrimary.sections, ...parsedAlt.sections],
                    links: [...parsedPrimary.links, ...parsedAlt.links],
                    contentMarkdown: cleanMd,
                    url: "",
                    type: "file",
                    ...(heuristicChain ? { hasFabricatedText: true } : {})
                });
            }
        } catch (er) {
            console.warn("doc parse err", er);
        }
    }

    return {
        images: candImages,
        filteredImages,
        generatedFiles,
        documents: docDetails,
        structuredExtraction,
    };
}

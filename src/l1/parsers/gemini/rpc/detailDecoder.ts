import { geminiResponse, type GeminiResponseEnvelope } from './responseEnvelope.js';
import { findListConversationMetadata } from './listMetadata.js';
import type { GeminiDetailEvidence, GeminiMessageEvidence, GeminiAttachmentEvidence, GeminiDetailDebugEvidence } from './detailEvidence.js';
import type { GeminiProtocolModule } from "../../../protocol/gemini/protocol.js";
import { stripInternalChipMarkdown } from "../../shared/chipUtils.js";
import { __resolveModule } from "../../../../shared/utils/moduleOverrides.js";
import type { TurnDriftReport, TitleResult, DecodedGeminiTurn, DecodedGeminiCandidate } from "./extractors.js";
import type { ImageAttachment, UserFileAttachment } from "./sourceAttachments.js";

import {
    GEMINI_JSPB_SCHEMA,
    detectTurnSchemaDrift,
    hasTurnContentMarkers,
    decodeTurn,
    safeStructureClean,
    extractConversationId,
    smartSummarizePrompt,
    extractConversationTitle,
    normId,
    cleanTitle,
    isRealTitle
} from "./extractors.js";
import {
    extractImageEvidence,
    extractResponseImageEvidence,
    filterNewImages,
    isInternalChipUrl
} from "./sourceAttachments.js";
import GeminiProtocol from "../../../protocol/gemini/protocol.js";
import { isDevMode } from "../../../../runtime/devMode.js";
const GeminiUtils = { isDevMode };
import { extractNextPageToken } from "./payload.js";
import { resolveDetailTitle } from "../../../../shared/utils/titleText.js";
import {
    decodeGeminiUserResources,
    decodeGeminiCandidateResources,
    DOC_TITLE_FALLBACK_RE,
    type DetailMediaReader,
    type DecodedGeminiUserResources,
    type DecodedGeminiCandidateResources,
} from './turnResources.js';

function getUtils(): typeof GeminiUtils {
    return __resolveModule('GeminiUtils', GeminiUtils);
}

function getProtocol(): GeminiProtocolModule {
    return __resolveModule('GeminiProtocol', GeminiProtocol);
}

const isTurnCache = new WeakMap<object, boolean>();

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTurn(turn: unknown): boolean {
    if (!isUnknownArray(turn) || turn.length < 3) return false;
    const cached = isTurnCache.get(turn);
    if (cached !== undefined) return cached;
    const head = turn[0];
    let idStr = "";
    if (typeof head === "string") idStr = head;
    else if (isUnknownArray(head) && head.length) {
        idStr = typeof head[0] === "string" ? head[0] : (isUnknownArray(head[0]) && typeof head[0][0] === "string" ? head[0][0] : "");
    }
    let result = false;
    if (idStr && (idStr.startsWith("c_") || idStr.startsWith("r_"))) {
        result = hasTurnContentMarkers(turn);
    }
    isTurnCache.set(turn, result);
    return result;
}

function isTurnsArray(arr: unknown): arr is unknown[] {
    if (!isUnknownArray(arr) || arr.length === 0) return false;
    let cnt = 0;
    for (const t of arr) if (isTurn(t)) cnt++;
    return cnt >= 1 && cnt / arr.length >= 0.5;
}

function findTurnsDeep(root: unknown, depth: number = 0): unknown[] | null {
    if (!root || depth > 6) return null;
    if (isTurnsArray(root)) return root;
    if (isUnknownArray(root)) {
        for (const el of root) {
            const found = findTurnsDeep(el, depth + 1);
            if (found) return found;
        }
    } else if (isUnknownRecord(root)) {
        for (const k in root) {
            const found = findTurnsDeep(root[k], depth + 1);
            if (found) return found;
        }
    }
    return null;
}

interface TurnsExtractionResult {
    turns: unknown[];
    inner: unknown;
    schemaDriftWarnings: string[];
    turnsRejected: number;
}

function extractTurnsFromInner(
    inner: unknown,
    top: unknown[] | null,
    innerStr: string | null,
    isStandardWrb: boolean,
    wrb: string,
    detailRpc: string,
    isDevMode: boolean
): TurnsExtractionResult {
    const schemaDriftWarnings: string[] = [];
    if (isUnknownArray(top) && top.length > 0 && !isStandardWrb && innerStr) {
        schemaDriftWarnings.push(`Envelope drift: batchexecute response missing standard WRB detail RPC header [${wrb}, ${detailRpc}], fell back to heuristic payload discovery`);
    }

    let activeInner = inner;
    let turns: unknown[] | null = null;
    const innerSchema = GEMINI_JSPB_SCHEMA.INNER;
    const initialSlots = isUnknownArray(activeInner) ? activeInner : [];
    const primaryTurns = initialSlots[innerSchema.TURNS_OR_LIST_PRIMARY];
    if (isTurnsArray(primaryTurns)) {
        turns = primaryTurns;
    }
    if (!turns) turns = findTurnsDeep(activeInner);
    if (!turns && isUnknownArray(top)) {
        for (const item of top) {
            if (!isUnknownArray(item) || typeof item[2] !== "string") continue;
            if (item[2] === innerStr) continue;
            try {
                const altInner: unknown = JSON.parse(item[2]);
                const altTurns = findTurnsDeep(altInner);
                if (altTurns) {
                    turns = altTurns;
                    activeInner = altInner;
                    break;
                }
            } catch { /* intentional: parse chunk candidate fallback */ }
        }
        if (!turns) {
            const topTurns = findTurnsDeep(top);
            if (topTurns) turns = topTurns;
        }
    }
    if (!turns) turns = [];

    // 4. Detect "metadata-only" response: inner = [null, null, [[conv_id_str, title, ...]]]
    const metaListIdx = innerSchema.METADATA_ONLY_LIST;
    const activeSlots = isUnknownArray(activeInner) ? activeInner : [];
    const metaRows = activeSlots[metaListIdx];
    const firstMeta = isUnknownArray(metaRows) ? metaRows[0] : undefined;
    const firstMetaSlots = isUnknownArray(firstMeta) ? firstMeta : null;
    const isMetadataOnly = !turns.length
        && activeSlots[innerSchema.TURNS_OR_LIST_PRIMARY] === null
        && activeSlots[innerSchema.LIST_SECONDARY] === null
        && isUnknownArray(metaRows) && metaRows.length > 0
        && firstMetaSlots !== null && typeof firstMetaSlots[0] === "string" && firstMetaSlots[0].startsWith("c_");

    if (isMetadataOnly) {
        schemaDriftWarnings.push(`metadata-only payload: hNvQHb returned no turns (inner[${metaListIdx}][0] looks like a list-format row); exported messages will be empty`);
    }
    if (isMetadataOnly && isDevMode) {
        console.warn("[Parser] hNvQHb returned metadata-only payload (no turns). " +
            `inner[${metaListIdx}][0] looks like a list-format row, not a turns array. ` +
            "conv:", firstMetaSlots?.[0], "title:", firstMetaSlots?.[1],
            "rc_count:", firstMetaSlots?.filter((x: unknown) => typeof x === "string" && x.startsWith("rc_")).length);
    }
    if (!turns.length && activeInner && isUnknownArray(activeInner) && activeInner.length > 0 && !isMetadataOnly) {
        schemaDriftWarnings.push(`Payload drift: inner JSON array present (length ${activeInner.length}) but unable to locate turns array`);
    }

    // P1-8: count elements the turn recognizer rejects. They are dropped from
    // the exported messages, so the count must travel with the result instead
    // of being silently lost. The array itself is left untouched.
    let turnsRejected = 0;
    for (const t of turns) {
        if (!isTurn(t)) turnsRejected++;
    }

    return { turns, inner: activeInner, schemaDriftWarnings, turnsRejected };
}

function buildUserMessage(
    turn: DecodedGeminiTurn,
    resources: DecodedGeminiUserResources,
    media: DetailMediaReader,
    dedupSet: Set<string>,
    docDedupSet: Set<string>
): GeminiMessageEvidence | null {
    const ts = turn.timestamp;
    const uText = turn.userText;
    const uImgs = filterNewImages(resources.images, dedupSet);
    const uFiles = resources.files.filter((f: UserFileAttachment) => {
        const key = f.id || f.sourceUrl || f.fileName;
        if (!key || docDedupSet.has(key)) return false;
        docDedupSet.add(key);
        return true;
    });

    if (!uText && !uImgs.length && !uFiles.length) return null;

    const userMsgId = turn.userMessageId;

    const formattedImages = uImgs.length ? uImgs.map((i: ImageAttachment) => ({
        ...i,
        type: "image",
        isImage: true
    })) : void 0;

    const formattedDocs = uFiles.length ? uFiles.map((f: UserFileAttachment) => {
        return {
            id: f.id,
            title: f.fileName || "attachment",
            createdAt: ts,
            chipUrl: "",
            sections: [],
            links: [],
            contentMarkdown: void 0,
            url: f.sourceUrl,
            candidates: f.thumbnailUrl ? [f.sourceUrl, f.thumbnailUrl] : [f.sourceUrl],
            type: "file"
        };
    }) : void 0;

    const attachments: GeminiAttachmentEvidence[] = [];
    if (formattedImages) {
        for (const im of formattedImages) {
            attachments.push({
                type: "image",
                src: im.sourceUrl,
                alt: im.fileName,
                isBlob: false,
                isImage: true,
                originalUrl: im.sourceUrl
            });
        }
    }
    if (formattedDocs) {
        for (const d of formattedDocs) {
            attachments.push({
                type: "file",
                name: d.title || d.id,
                title: d.title,
                url: d.url,
                contentMarkdown: d.contentMarkdown
            });
        }
    }

    const rawRequestId = turn.rawProviderRequestId;
    const userRequestId = media.sourceOnly ? rawRequestId : turn.providerRequestId;

    return {
        id: media.sourceOnly ? (rawRequestId ?? "") : userMsgId,
        role: "user",
        providerRequestId: userRequestId || void 0,
        rawProviderRequestId: rawRequestId,
        turnId: userMsgId || void 0,
        content: uText,
        timestamp: ts,
        images: formattedImages,
        documents: formattedDocs,
        attachments: attachments.length ? attachments : void 0,
        attachmentCount: attachments.length,
        messageCount: 1
    };
}

function parseCandidateResponse(
    candidate: DecodedGeminiCandidate,
    turn: DecodedGeminiTurn,
    resources: DecodedGeminiCandidateResources,
    media: DetailMediaReader,
    convId?: string
): GeminiMessageEvidence | null {
    const ts = turn.timestamp;
    const candidateId = candidate.id;
    let responseText = candidate.text;
    const { images: candImages, filteredImages, generatedFiles, documents: docDetails, structuredExtraction, structuredImages } = resources;
    const structuredContent = structuredExtraction.status === 'decoded' ? structuredExtraction.document : undefined;

    const { thoughts, citations, sourceAttributions, groundingCitationMarkers } = candidate;

    if (responseText) {
        responseText = responseText.replace(/^rc_[a-z0-9_]{10,}\s*/i, "");
        responseText = stripInternalChipMarkdown(responseText);
    }

    const rawRequestId = turn.rawProviderRequestId;
    const providerRequestId = media.sourceOnly ? rawRequestId : turn.providerRequestId;
    const generatedCount = candImages.filter(img => img.isGenerated).length;
    const generationPrompt = turn.userText;
    const formattedImages = filteredImages.length ? filteredImages.map((img: ImageAttachment) => {
        const isGen = !!img.isGenerated;
        const ordinal = isGen ? (img.imageOrdinal ?? (generatedCount === 1 ? 0 : undefined)) : undefined;
        return {
            ...img,
            type: "image",
            providerRequestId: isGen ? providerRequestId : undefined,
            imageOrdinal: ordinal,
            ...(isGen ? {
                generation: {
                    chatId: String(convId || '').replace(/^c_/, ''),
                    providerRequestId,
                    imageOrdinal: ordinal,
                    generationOrdinal: 0,
                    imageCount: generatedCount,
                    ...(ts !== null ? { time: ts } : {}),
                    ...(generationPrompt.trim() ? { prompt: generationPrompt } : {}),
                }
            } : {})
        };
    }) : void 0;

    const attachments: GeminiAttachmentEvidence[] = [...generatedFiles];
    if (formattedImages) {
        for (const img of formattedImages) {
            attachments.push({
                type: "image",
                src: img.sourceUrl,
                alt: img.fileName,
                isBlob: false,
                isImage: true,
                originalUrl: img.sourceUrl,
                token: img.token,
                providerRequestId: img.providerRequestId,
                imageOrdinal: img.imageOrdinal,
                ...(img.isGenerated ? { isGenerated: true } : {}),
                ...(img.generation ? { generation: img.generation } : {})
            });
        }
    }
    if (docDetails.length) {
        for (const d of docDetails) {
            if (d.contentMarkdown || (d.url && !isInternalChipUrl(d.url))) {
                attachments.push({
                    type: "file",
                    id: d.id,
                    name: d.title || d.id,
                    title: d.title,
                    url: d.url,
                        contentMarkdown: d.contentMarkdown
                });
            }
        }
    }

    if (!responseText && !thoughts && !attachments.length && !docDetails.length && !structuredContent) return null;

    const fallbackTurnId = turn.fallbackTurnId;

    return {
        id: media.sourceOnly ? candidateId : (candidateId || fallbackTurnId || ""),
        role: "model",
        content: responseText || "",
        providerRequestId: providerRequestId || void 0,
        rawProviderRequestId: rawRequestId,
        turnId: fallbackTurnId || void 0,
        thoughts: thoughts || void 0,
        citations: citations.length ? citations : void 0,
        timestamp: ts,
        images: formattedImages,
        documents: docDetails.length ? docDetails : void 0,
        attachments: attachments.length ? attachments : void 0,
        attachmentCount: attachments.length,
        messageCount: 1,
        ...(structuredContent ? { structuredContent } : {}),
        structuredExtraction,
        structuredImages,
        ...(sourceAttributions.length ? { sourceAttributions } : {}),
        ...(groundingCitationMarkers.length ? { groundingCitationMarkers } : {})
    };
}

/** Source facts only: no archive destinations, unique names or synthetic image filenames. */
function decodeGeminiDetail(text: string | GeminiResponseEnvelope, targetConvId?: string, overrides: unknown = {}): GeminiDetailEvidence {
    return decodeDetailEvidence(text, targetConvId, overrides, { sourceOnly: true, images: extractImageEvidence, responseImages: extractResponseImageEvidence });
}

function decodeDetailEvidence(text: string | GeminiResponseEnvelope, targetConvId: string | undefined, _overrides: unknown, media: DetailMediaReader): GeminiDetailEvidence {
    try {
        const response = geminiResponse(text);
        const top = response.scope(GeminiProtocol.RPCS.DETAIL);
        const utils = getUtils();
        const isDevMode = (utils && typeof utils.isDevMode === "function") ? utils.isDevMode() : false;

        const protocol = getProtocol();
        const wrb = protocol.WRB || "wrb.fr";
        const detailRpc = protocol.RPCS ? protocol.RPCS.DETAIL : "hNvQHb";

        const { inner: extractedInner, innerStr, isStandardWrb } = response.payload(detailRpc);

        if (!extractedInner) throw new Error("invalid");

        const { turns, inner, schemaDriftWarnings, turnsRejected } = extractTurnsFromInner(
            extractedInner,
            top,
            innerStr,
            isStandardWrb,
            wrb,
            detailRpc,
            isDevMode
        );

        const innerSlots = isUnknownArray(inner) ? inner : [];
        const metadataRows = innerSlots[GEMINI_JSPB_SCHEMA.INNER.METADATA_ONLY_LIST];
        const metadataRow = !turns.length && innerSlots[0] === null && innerSlots[1] === null && isUnknownArray(metadataRows)
            ? metadataRows[0] : undefined;
        const metadataConversation = isUnknownArray(metadataRow)
            && typeof metadataRow[0] === 'string' && metadataRow[0].startsWith('c_')
            && typeof metadataRow[1] === 'string' && metadataRow[1].trim()
            ? { id: metadataRow[0], title: cleanTitle(metadataRow[1]) } : undefined;

        let convId = extractConversationId(inner, turns);
        if (convId === "c_unknown" && targetConvId) convId = targetConvId;

        const allMsgs: GeminiMessageEvidence[] = [];
        const dedupSet = new Set<string>();
        const docDedupSet = new Set<string>();
        const imageSeq = { value: 1 };
        const rev = [...turns].reverse();

        for (const rawTurn of rev) {
            const drift: TurnDriftReport = detectTurnSchemaDrift(rawTurn, convId);
            if (drift.isDrifted) {
                schemaDriftWarnings.push(...drift.warnings);
            }

            // Close known fields once; media/structured decoders retain raw evidence.
            const turn = decodeTurn(rawTurn);
            if (!turn) continue;

            const userResources = decodeGeminiUserResources(rawTurn, media, imageSeq);
            const userMsg = buildUserMessage(turn, userResources, media, dedupSet, docDedupSet);
            if (userMsg) allMsgs.push(userMsg);

            // hNvQHb may contain drafts; decodeTurn preserves the selected ID
            // and the historical primary-draft fallback in one place.
            if (turn.candidate) {
                const resources = decodeGeminiCandidateResources(
                    rawTurn, turn.candidateSource, turn.candidateIndex, turn.candidate.text,
                    inner, media, dedupSet, docDedupSet, imageSeq, convId
                );
                const modelMsg = parseCandidateResponse(turn.candidate, turn, resources, media, convId);
                if (modelMsg) allMsgs.push(modelMsg);
            }
        }

        const metadata = findListConversationMetadata(response, convId === 'c_unknown' ? targetConvId ?? '' : convId);
        const metaTitle = metadata?.title || null;
        const titleObj = extractConversationTitle(inner, turns);
        const nextToken = extractNextPageToken(inner, GEMINI_JSPB_SCHEMA.INNER.NEXT_TOKEN_CANDIDATES);
        const url = `https://gemini.google.com/app/${String(convId).replace(/^c_/, "")}`;


        let cleanT = metaTitle || cleanTitle(titleObj.title || convId);
        const isReal = isRealTitle(cleanT, convId);
        let finalSource: TitleResult["source"] = metaTitle ? "rpc" : (isReal ? titleObj.source : "default");
        if (!isReal && !metaTitle) {
            const sniffed = resolveDetailTitle(allMsgs, convId);
            if (sniffed) {
                cleanT = sniffed.title;
                finalSource = "sniff";
            }
        }
        let _debug: GeminiDetailDebugEvidence | null = null;
        if (!allMsgs.length) {
            try {
                _debug = {
                    turnsLen: turns?.length || 0,
                    innerKeys: inner ? Object.keys(inner) : null,
                    innerPreview: JSON.stringify(inner).slice(0, 1500),
                    topPreview: top ? JSON.stringify(top).slice(0, 800) : null
                };
            } catch (e) {
                if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:parseDetail.ts]", e);
            }
        }
        if (schemaDriftWarnings.length) {
            if (!_debug) _debug = {};
            _debug.schemaDriftWarnings = schemaDriftWarnings;
        }

        return {
            id: convId,
            ...(metadataConversation ? { metadataConversation } : {}),
            title: cleanT,
            titleSource: finalSource,
            messages: allMsgs,
            updatedAt: metadata?.updatedAt ?? null,
            url,
            nextPageToken: nextToken,
            attachmentCount: allMsgs.reduce((a, m) => a + (m.attachmentCount || 0), 0),
            schemaDrift: schemaDriftWarnings.length ? schemaDriftWarnings : void 0,
            turnsRejected: turnsRejected > 0 ? turnsRejected : void 0,
            _raw: inner,
            _debug
        };
    } catch (e: unknown) {
        // Non-Error throws remain unvalidated diagnostic evidence. Keep the legacy
        // property read (including its behavior for null/undefined), not String(e).
        const message = e instanceof Error ? e.message : (e as { message?: unknown }).message;
        throw new Error("detail parse fail: " + message);
    }
}


export { decodeGeminiDetail, isTurn, findTurnsDeep, DOC_TITLE_FALLBACK_RE };


import { extractSourceAttributions, type GeminiSourceAttribution } from './sourceAttributions.js';
import { normId } from '../../../../shared/utils/pathUtils.js';
import { isRealTitle, cleanTitle, RESEARCH_PROMPT_PREFIX_RE } from '../../../../shared/utils/titleText.js';
import { payloadToMs, extractCandidateValue } from './payload.js';
import { isWireArray } from './jspbSchema.js';
import type { Citation } from './types.js';
import {
    GEMINI_JSPB_SCHEMA,
    collectCandidateBodyEvidence,
    collectGroundingField44,
    deepWalk,
    extractCitations,
    extractConversationId,
    extractConversationTitle,
    extractGroundingCitationMarkers,
    extractThoughts,
    robustFirstPayload,
    safeStructureClean,
    smartSummarizePrompt,
    type GeminiJspbSchema,
    type TitleResult,
} from './payloadWalkers.js';

export type { Citation } from './types.js';
export {
    GEMINI_JSPB_SCHEMA,
    deepWalk,
    extractCitations,
    extractConversationId,
    extractConversationTitle,
    extractGroundingCitationMarkers,
    extractThoughts,
    robustFirstPayload,
    safeStructureClean,
    smartSummarizePrompt,
    type GeminiJspbSchema,
    type TitleResult,
};

export interface TurnDriftReport {
    isDrifted: boolean;
    warnings: string[];
}

/** Selected Candidate facts decoded at the Turn boundary. Raw media evidence
 * stays private to Gemini resource decoders. */
export interface DecodedGeminiCandidate {
    /** Selected wire context; only the resource decoder interprets these remaining slots. */
    source: unknown[];
    body: unknown;
    turnDocument: unknown;
    index: number;
    id: string;
    text: string;
    /** Source facts decoded once, before message assembly. */
    thoughts: string | null;
    citations: Citation[];
    sourceAttributions: GeminiSourceAttribution[];
    groundingCitationMarkers: string[];
    /** Raw field-44 citation tuples collected during Turn ingress to avoid re-walking the candidate. */
    rawGroundingEntries?: readonly unknown[];
}

/** Known fields read once from a Turn. Selected wire evidence stays within
 * the L1 decoder and is consumed by specialized resource decoders. */
export interface DecodedGeminiTurn {
    userText: string;
    timestamp: number | null;
    userMessageId: string;
    fallbackTurnId: string;
    /** Only the confirmed request-ID slots yield provider identity. */
    rawProviderRequestId: string | undefined;
    candidate: DecodedGeminiCandidate | null;
}

export function hasTurnContentMarkers(turn: unknown[]): boolean {
    if (isWireArray(turn[GEMINI_JSPB_SCHEMA.TURN.USER_PAYLOAD])) return true;
    const modelPayload = turn[GEMINI_JSPB_SCHEMA.TURN.MODEL_PAYLOAD];
    if (isWireArray(modelPayload)) {
        const cands = modelPayload[GEMINI_JSPB_SCHEMA.MODEL_PAYLOAD.CANDIDATES];
        if (isWireArray(cands)) {
            for (const c of cands) {
                if (!isWireArray(c)) continue;
                const id = c[GEMINI_JSPB_SCHEMA.CANDIDATE.ID];
                if (typeof id === 'string' && id.startsWith('rc_')) return true;
            }
        }
    }
    let budget = 2000;
    const stack: unknown[] = [turn];
    while (stack.length && budget > 0) {
        const node = stack.pop();
        if (typeof node === 'string') {
            budget--;
            if (node.startsWith('rc_') || node.startsWith('c_d')) return true;
        } else if (isWireArray(node)) {
            for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
        }
    }
    return false;
}

export function detectTurnSchemaDrift(turn: unknown, convId?: string): TurnDriftReport {
    const warnings: string[] = [];
    if (!isWireArray(turn)) {
        warnings.push('Turn is not an array');
        return { isDrifted: true, warnings };
    }
    if (turn.length < 3) {
        warnings.push(`Turn array length (${turn.length}) is less than expected minimum 3`);
    }
    const head = turn[GEMINI_JSPB_SCHEMA.TURN.ID_META];
    let idStr = '';
    if (typeof head === 'string') idStr = head;
    else if (isWireArray(head) && head.length) {
        idStr = typeof head[0] === 'string' ? head[0] : (isWireArray(head[0]) && typeof head[0][0] === 'string' ? head[0][0] : '');
    }
    if (!idStr || (!idStr.startsWith('c_') && !idStr.startsWith('r_'))) {
        warnings.push(`Turn ID meta at index 0 does not match expected pattern: ${JSON.stringify(head)?.slice(0, 30)}`);
    } else if (!hasTurnContentMarkers(turn)) {
        warnings.push(`Turn head '${idStr.slice(0, 32)}' matches turn-id pattern but no rc_/c_d content markers found; isTurn() rejects this element (treated as non-turn)`);
    }

    const userPayload = turn[GEMINI_JSPB_SCHEMA.TURN.USER_PAYLOAD];
    if (userPayload !== undefined && !isWireArray(userPayload)) {
        warnings.push(`UserPayload at index 2 is not an array (type: ${typeof userPayload})`);
    }

    const modelPayload = turn[GEMINI_JSPB_SCHEMA.TURN.MODEL_PAYLOAD];
    if (modelPayload !== undefined) {
        if (!isWireArray(modelPayload)) {
            warnings.push(`ModelPayload at index 3 is not an array (type: ${typeof modelPayload})`);
        } else if (modelPayload.length > 0) {
            const candBlock = modelPayload[GEMINI_JSPB_SCHEMA.MODEL_PAYLOAD.CANDIDATES];
            if (!isWireArray(candBlock)) {
                warnings.push(`Candidates at index 3[0] is not an array (type: ${typeof candBlock})`);
            } else if (candBlock.length > 0) {
                const firstCand = candBlock[0];
                if (isWireArray(firstCand)) {
                    const candId = firstCand[GEMINI_JSPB_SCHEMA.CANDIDATE.ID];
                    if (typeof candId !== 'string' || (!candId.startsWith('rc_') && !candId.startsWith('c_'))) {
                        warnings.push(`First candidate ID at 3[0][0][0] does not match 'rc_' prefix: ${JSON.stringify(candId)}`);
                    }
                }
            }
        }
    }

    if (warnings.length > 0 && (globalThis.__gemExporterDevMode || globalThis.__gemExporterVerboseLog)) {
        console.warn('[Gemini Exporter][Schema Drift Warning] Detected %d schema drift(s) in conv %s:', warnings.length, convId || 'unknown', warnings);
    }

    return {
        isDrifted: warnings.length > 0,
        warnings,
    };
}

export function extractModelCandidates(turn: unknown): unknown[] {
    if (!turn || !isWireArray(turn)) return [];
    const modelPayload = turn[GEMINI_JSPB_SCHEMA.TURN.MODEL_PAYLOAD];
    if (!modelPayload || !isWireArray(modelPayload) || modelPayload.length === 0) return [];

    const candidateBlock = modelPayload[GEMINI_JSPB_SCHEMA.MODEL_PAYLOAD.CANDIDATES];
    if (isWireArray(candidateBlock)) {
        if (candidateBlock.length > 0 && isWireArray(candidateBlock[0])) {
            return candidateBlock;
        }
        if (typeof candidateBlock[0] === 'string') {
            return [candidateBlock];
        }
    }
    const first = modelPayload[0];
    if (isWireArray(first) && typeof first[0] === 'string' && first[0].startsWith('rc_')) {
        return modelPayload;
    }
    return [];
}

type CandidateBodyTextExtractor = (body: unknown) => string | null;

const CANDIDATE_BODY_EXTRACTORS: readonly CandidateBodyTextExtractor[] = [
    body => (typeof body === 'string' ? body : null),
    body => {
        if (!isWireArray(body)) return null;
        const parts = body[GEMINI_JSPB_SCHEMA.CANDIDATE_BODY.PARTS];
        if (typeof parts === 'string') return parts;
        if (isWireArray(parts)) {
            const textChunks: string[] = [];
            for (const part of parts) {
                if (typeof part === 'string') textChunks.push(part);
                else if (isWireArray(part) && typeof part[0] === 'string') textChunks.push(part[0]);
            }
            if (textChunks.length) return textChunks.join('');
        }
        return null;
    },
    body => (isWireArray(body) && typeof body[0] === 'string' && body[0].length > 3 ? body[0] : null),
];

function candidateBody(cand: unknown): unknown {
    const candidateSlots = isWireArray(cand) ? cand : null;
    if (candidateSlots === null) return cand;
    const body = candidateSlots[GEMINI_JSPB_SCHEMA.CANDIDATE.BODY];
    if (body !== undefined) return body;
    if (typeof candidateSlots[GEMINI_JSPB_SCHEMA.CANDIDATE.ID] === 'string') return undefined;
    return candidateSlots.length === 1 ? candidateSlots[0] : candidateSlots;
}

export function extractCandidateText(cand: unknown): string {
    if (!cand) return '';
    const body = candidateBody(cand);

    for (const extractor of CANDIDATE_BODY_EXTRACTORS) {
        const text = extractor(body);
        if (text !== null) return text;
    }
    return '';
}

export function userTextContainer(userPayload: unknown[]): unknown[] {
    return isWireArray(userPayload[0]) ? userPayload[0] : userPayload;
}

function extractUserText(userPayload: unknown): string {
    if (!isWireArray(userPayload)) return '';
    const text = userTextContainer(userPayload)[0];
    return typeof text === 'string' ? text : '';
}

/** Resolve legacy nested text chunks strictly inside the candidate's BODY slot;
 * never walk sibling metadata, language codes or artifact packets as answer prose. */
function extractModelResponseText(candidate: unknown): string {
    const direct = extractCandidateText(candidate);
    if (direct) return direct;
    const bodyScope = candidateBody(candidate);
    if (!bodyScope) return '';
    const textArr: string[] = [];
    deepWalk(bodyScope, node => {
        if (isWireArray(node) && node.length >= 1 && typeof node[0] === 'string' && node[0].length > 0
            && !node[0].startsWith('http') && !node[0].startsWith('rc_') && !node[0].startsWith('c_')) {
            if (node[0].trim().length > 2 && !textArr.includes(node[0])) {
                textArr.push(node[0]);
            }
        }
    });
    return textArr.join('\n\n');
}

export function extractTurnTimestamp(turnData: unknown): number | null {
    if (!isWireArray(turnData)) return null;
    const candidateIndices = [
        GEMINI_JSPB_SCHEMA.TURN.TIMESTAMP,
        4,
        5,
        turnData.length - 1,
    ];
    return extractCandidateValue(turnData, candidateIndices, val => payloadToMs(val));
}

/** Decode the fields used by the message builder once, with existing
 * fallback/selection rules. Specialized parsers receive raw evidence. */
export function decodeTurn(turn: unknown): DecodedGeminiTurn | null {
    if (!isWireArray(turn)) return null;

    const idMeta = turn[GEMINI_JSPB_SCHEMA.TURN.ID_META];
    let userMessageId = '';
    if (isWireArray(idMeta)) {
        userMessageId = idMeta.find((id): id is string => typeof id === 'string' && id.startsWith('r_'))
            || (typeof idMeta[1] === 'string' ? idMeta[1] : '')
            || (typeof idMeta[0] === 'string' ? idMeta[0] : '');
    } else if (typeof idMeta === 'string') {
        userMessageId = idMeta;
    }

    const fallbackRawId = isWireArray(idMeta)
        ? (idMeta.find(id => typeof id === 'string' && (id.startsWith('rc_') || id.startsWith('r_')))
            || idMeta[1] || idMeta[0])
        : idMeta;
    const fallbackTurnId = typeof fallbackRawId === 'string' ? fallbackRawId : '';

    let rawProviderRequestId: string | undefined;
    if (isWireArray(idMeta)) {
        const request = idMeta[GEMINI_JSPB_SCHEMA.TURN.REQUEST_ID_SLOT];
        const alternative = idMeta[0];
        if (typeof request === 'string' && request.startsWith('r_')) {
            rawProviderRequestId = request;
        } else if (typeof alternative === 'string' && alternative.startsWith('r_')) {
            rawProviderRequestId = alternative;
        }
    } else if (typeof idMeta === 'string' && idMeta.startsWith('r_')) {
        rawProviderRequestId = idMeta;
    }

    const rawUserPayload = turn[GEMINI_JSPB_SCHEMA.TURN.USER_PAYLOAD];
    const modelPayload = turn[GEMINI_JSPB_SCHEMA.TURN.MODEL_PAYLOAD];
    const selectedId = isWireArray(modelPayload)
        ? modelPayload[GEMINI_JSPB_SCHEMA.MODEL_PAYLOAD.SELECTED_CANDIDATE_ID]
        : undefined;
    const candidates = extractModelCandidates(turn);
    const selectedIndex = typeof selectedId === 'string' && selectedId.startsWith('rc_')
        ? candidates.findIndex(raw => isWireArray(raw) && raw[GEMINI_JSPB_SCHEMA.CANDIDATE.ID] === selectedId)
        : -1;
    const candidateIndex = selectedIndex >= 0 ? selectedIndex : 0;
    const selected = candidates[candidateIndex];
    const slots = isWireArray(selected) ? selected : null;
    const rawId = slots?.[GEMINI_JSPB_SCHEMA.CANDIDATE.ID];
    const body = slots?.[GEMINI_JSPB_SCHEMA.CANDIDATE.BODY];
    // Scope body thoughts/citations to the BODY slot when the candidate tuple defines it,
    // preventing sourceMetadata cache URLs in sibling slots from leaking into legacy citations.
    const bodyEvidenceScope = slots !== null && slots.length > 1 ? body : (body || selected);
    const bodyEvidence = collectCandidateBodyEvidence(bodyEvidenceScope);
    const grounding = slots !== null ? collectGroundingField44(selected) : { markers: [], rawEntries: [] };
    const candidateText = slots !== null ? extractModelResponseText(selected) : '';
    const candidate: DecodedGeminiCandidate | null = slots !== null
        ? {
            source: slots,
            body,
            index: candidateIndex,
            turnDocument: isWireArray(modelPayload) ? modelPayload[GEMINI_JSPB_SCHEMA.MODEL_PAYLOAD.STRUCTURED_CONTENT ?? 12] : undefined,
            id: typeof rawId === 'string' ? rawId : '',
            text: candidateText,
            thoughts: bodyEvidence.thoughts,
            citations: bodyEvidence.citations,
            sourceAttributions: extractSourceAttributions(selected, candidateText),
            groundingCitationMarkers: grounding.markers,
            ...(grounding.rawEntries.length ? { rawGroundingEntries: grounding.rawEntries } : {}),
        }
        : null;

    const headId = isWireArray(idMeta) ? idMeta[0] : idMeta;
    const hasTurnIdentity = [headId, userMessageId].some(id => typeof id === 'string' && /^(?:c_|r_).+/.test(id));
    if (!hasTurnIdentity && !candidate?.id.startsWith('rc_')) return null;

    return {
        userText: extractUserText(rawUserPayload),
        timestamp: extractTurnTimestamp(turn),
        userMessageId,
        fallbackTurnId,
        rawProviderRequestId,
        candidate,
    };
}

export {
    RESEARCH_PROMPT_PREFIX_RE,
    normId,
    cleanTitle,
    isRealTitle,
};

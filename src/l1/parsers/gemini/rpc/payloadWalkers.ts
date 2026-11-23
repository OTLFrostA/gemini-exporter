import { isInternalChipUrl } from '../../shared/chipUtils.js';
import { cleanTitle, isRealTitle, RESEARCH_PROMPT_PREFIX_RE } from '../../../../shared/utils/titleText.js';
import { extractCandidateValue } from './payload.js';
import { isWireArray, isWireRecord } from './jspbSchema.js';
import type { Citation } from './types.js';

interface JspbTurnSchema {
    ID_META: number;
    TIMESTAMP: number;
    USER_PAYLOAD: number;
    MODEL_PAYLOAD: number;
    REQUEST_ID_SLOT: number;
}

interface JspbModelPayloadSchema {
    CANDIDATES: number;
    SEARCH_QUERIES: number;
    PROVIDER: number;
    SELECTED_CANDIDATE_ID: number;
    TELEMETRY_START: number;
    STRUCTURED_CONTENT?: number;
}

interface JspbCandidateSchema {
    ID: number;
    BODY: number;
    LANGUAGE_CODE: number;
}

interface JspbCandidateBodySchema {
    PARTS: number;
}

interface JspbListItemSchema {
    ID: number;
    TITLE: number;
    TIMESTAMP: number;
    UPDATE_TIME_ALT: number;
    CREATE_TIME_ALT: number;
    COUNT_ALT1: number;
    COUNT_ALT2: number;
}

interface JspbInnerSchema {
    TURNS_OR_LIST_PRIMARY: number;
    LIST_SECONDARY: number;
    TITLE_CANDIDATES: number[];
    CONV_ID_CANDIDATES: number[];
    NEXT_TOKEN_CANDIDATES: number[];
    METADATA_ONLY_LIST: number;
}

interface JspbInlineImageSchema {
    URL: number;
    WIDTH: number;
    HEIGHT: number;
    TOKEN: number;
}

interface JspbGeneratedImageSchema {
    FILENAME: number;
    URL: number;
    TOKEN: number;
    UPSCALE_FACTOR: number;
    MIME_TYPE: number;
    DIMENSIONS: number;
}

interface JspbDeepResearchDocSchema {
    CHIP_URL: number;
    ID: number;
    TITLE: number;
    CONTENT_ID: number;
    TIMESTAMP: number;
}

interface JspbErrorInfoSchema {
    ERROR_SLOT: number;
}

export interface GeminiJspbSchema {
    TURN: JspbTurnSchema;
    MODEL_PAYLOAD: JspbModelPayloadSchema;
    CANDIDATE: JspbCandidateSchema;
    CANDIDATE_BODY: JspbCandidateBodySchema;
    LIST_ITEM: JspbListItemSchema;
    INNER: JspbInnerSchema;
    INLINE_IMAGE: JspbInlineImageSchema;
    GENERATED_IMAGE: JspbGeneratedImageSchema;
    DEEP_RESEARCH_DOC: JspbDeepResearchDocSchema;
    ERROR_INFO: JspbErrorInfoSchema;
}

export interface TitleResult {
    title: string;
    source: 'rpc' | 'sniff' | 'default';
}

export const GEMINI_JSPB_SCHEMA: GeminiJspbSchema = Object.freeze({
    TURN: {
        ID_META: 0,
        TIMESTAMP: 1,
        USER_PAYLOAD: 2,
        MODEL_PAYLOAD: 3,
        REQUEST_ID_SLOT: 1, // Canonical request ID position in ID_META tuple: ["c_xxx", "r_xxx"][1]
    },
    MODEL_PAYLOAD: {
        CANDIDATES: 0,
        SEARCH_QUERIES: 1,
        PROVIDER: 2,
        SELECTED_CANDIDATE_ID: 3,
        TELEMETRY_START: 3,
        STRUCTURED_CONTENT: 12,
    },
    CANDIDATE: {
        ID: 0,
        BODY: 1,
        LANGUAGE_CODE: 2,
    },
    CANDIDATE_BODY: {
        PARTS: 0,
    },
    LIST_ITEM: {
        ID: 0,
        TITLE: 1,
        TIMESTAMP: 5,
        UPDATE_TIME_ALT: 2,
        CREATE_TIME_ALT: 3,
        COUNT_ALT1: 4,
        COUNT_ALT2: 9,
    },
    INNER: {
        TURNS_OR_LIST_PRIMARY: 0,
        LIST_SECONDARY: 1,
        TITLE_CANDIDATES: [2, 1],
        CONV_ID_CANDIDATES: [0, 1],
        NEXT_TOKEN_CANDIDATES: [1, 2, 3],
        METADATA_ONLY_LIST: 2,
    },
    INLINE_IMAGE: {
        URL: 0,
        WIDTH: 1,
        HEIGHT: 2,
        TOKEN: 3,
    },
    GENERATED_IMAGE: {
        FILENAME: 2,
        URL: 3,
        TOKEN: 5,
        UPSCALE_FACTOR: 8,
        MIME_TYPE: 11,
        DIMENSIONS: 15,
    },
    DEEP_RESEARCH_DOC: {
        CHIP_URL: 0,
        ID: 2,
        TITLE: 3,
        CONTENT_ID: 4,
        TIMESTAMP: 5,
    },
    ERROR_INFO: {
        ERROR_SLOT: 5,
    },
});

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object';
}

export function deepWalk(root: unknown, visitor: (node: object, depth: number) => boolean | void, maxDepth = 50): void {
    function walk(node: unknown, depth: number): void {
        if (!node || !isObjectRecord(node) || depth > maxDepth) return;
        const shouldDescend = visitor(node, depth);
        if (shouldDescend === false) return;
        if (isWireArray(node)) {
            for (let i = 0; i < node.length; i++) {
                walk(node[i], depth + 1);
            }
        } else {
            for (const k in node) {
                if (Object.prototype.hasOwnProperty.call(node, k)) {
                    walk(node[k], depth + 1);
                }
            }
        }
    }
    walk(root, 0);
}

export function safeStructureClean(str?: string | null): string {
    if (!str) return '';
    let out = '';
    let inString = false;
    let escape = false;
    for (let k = 0; k < str.length; k++) {
        const ch = str[k];
        if (inString) {
            out += ch;
            if (escape) escape = false;
            else if (ch === '\\') escape = true;
            else if (ch === '"') inString = false;
        } else if (ch === '"') {
            inString = true;
            out += ch;
        } else {
            if (ch.charCodeAt(0) < 32 && ch !== '\t' && ch !== '\r' && ch !== '\n') continue;
            out += ch;
        }
    }
    return out;
}

export function robustFirstPayload(text?: string | null): unknown[] | null {
    if (!text) return null;

    let trimmed = text.trim();
    if (trimmed.startsWith(")]}'")) {
        trimmed = trimmed.slice(4).trim();
    }
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
            const parsed: unknown = JSON.parse(trimmed);
            if (isWireArray(parsed)) return parsed;
        } catch {
            try {
                const cleaned = safeStructureClean(trimmed).trim();
                const parsed: unknown = JSON.parse(cleaned);
                if (isWireArray(parsed)) return parsed;
            } catch { /* proceed to chunk scanner */ }
        }
    }

    const allTop: unknown[] = [];
    const len = text.length;
    let inString = false;
    let escape = false;
    let depth = 0;
    let startIdx = -1;

    for (let i = 0; i < len; i++) {
        const ch = text[i];
        if (inString) {
            if (escape) escape = false;
            else if (ch === '\\') escape = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '[') {
            if (depth === 0) startIdx = i;
            depth++;
        } else if (ch === ']' && depth > 0) {
            depth--;
            if (depth === 0 && startIdx !== -1) {
                const chunk = text.slice(startIdx, i + 1);
                try {
                    const parsed: unknown = JSON.parse(chunk);
                    if (isWireArray(parsed)) allTop.push(...parsed);
                } catch {
                    try {
                        const cleaned = safeStructureClean(chunk).trim();
                        const parsed: unknown = JSON.parse(cleaned);
                        if (isWireArray(parsed)) allTop.push(...parsed);
                    } catch { /* intentional: skip malformed chunk */ }
                }
                startIdx = -1;
            }
        }
    }

    if (allTop.length > 0) return allTop;

    if (depth > 0 && startIdx !== -1) {
        try {
            const tail = text.slice(startIdx) + ']'.repeat(depth);
            const cleaned = safeStructureClean(tail).trim();
            const parsed: unknown = JSON.parse(cleaned);
            if (isWireArray(parsed)) return parsed;
        } catch { /* intentional fallback failure */ }
    }

    return null;
}

/** Single-pass collection of thought blocks and legacy citations within a candidate body block. */
export function collectCandidateBodyEvidence(candidateBlock: unknown): { thoughts: string | null; citations: Citation[] } {
    if (!isWireArray(candidateBlock)) return { thoughts: null, citations: [] };
    const thoughts: string[] = [];
    const citations: Citation[] = [];
    const seenUrls = new Set<string>();

    deepWalk(candidateBlock, node => {
        if (!isWireArray(node)) return;
        if (node.length >= 2 && node[0] === 'THOUGHT' && typeof node[1] === 'string') {
            thoughts.push(node[1]);
        }
        if (node.length >= 3 && typeof node[1] === 'string' && node[1].includes('thought') && typeof node[2] === 'string') {
            thoughts.push(node[2]);
        }
        if (node.length >= 2 && typeof node[0] === 'string'
            && (node[0].startsWith('http://') || node[0].startsWith('https://'))
            && typeof node[1] === 'string') {
            const url = node[0];
            if (!seenUrls.has(url) && !isInternalChipUrl(url)) {
                seenUrls.add(url);
                citations.push({ url, title: node[1] });
            }
        }
    });

    return {
        thoughts: thoughts.length ? thoughts.join('\n\n') : null,
        citations,
    };
}

export function extractThoughts(candidateBlock: unknown): string | null {
    return collectCandidateBodyEvidence(candidateBlock).thoughts;
}

export function extractCitations(candidateBlock: unknown): Citation[] {
    return collectCandidateBodyEvidence(candidateBlock).citations;
}

const GROUNDING_MARKER_RE = /^\[cite:\s*\d+(?:[.-]\d+)?(?:\s*,\s*\d+(?:[.-]\d+)?)*\]$/i;

/** Single-pass collection of field-44 grounding reference tuples and their declared marker strings. */
export function collectGroundingField44(candidate: unknown): { markers: string[]; rawEntries: unknown[] } {
    if (!candidate) return { markers: [], rawEntries: [] };
    const markers = new Set<string>();
    const rawEntries: unknown[] = [];

    deepWalk(candidate, node => {
        const f44 = isWireArray(node) ? node[44] : (isWireRecord(node) ? node['44'] : undefined);
        if (!isWireArray(f44)) return;
        for (const item of f44) {
            rawEntries.push(item);
            if (!isWireArray(item) || !isWireArray(item[0]) || typeof item[0][0] !== 'string') continue;
            const trimmed = item[0][0].trim();
            if (GROUNDING_MARKER_RE.test(trimmed)) markers.add(trimmed);
        }
    });

    return { markers: Array.from(markers), rawEntries };
}

export function extractGroundingCitationMarkers(candidate: unknown): string[] {
    return collectGroundingField44(candidate).markers;
}

export function extractConversationId(inner: unknown, turns?: unknown[]): string {
    const idFromCandidates = extractCandidateValue(
        inner,
        GEMINI_JSPB_SCHEMA.INNER.CONV_ID_CANDIDATES,
        val => (typeof val === 'string' && val.startsWith('c_') ? val : null),
    );
    if (idFromCandidates) return idFromCandidates;

    if (isWireArray(turns)) {
        for (const t of turns) {
            if (isWireArray(t) && isWireArray(t[0]) && typeof t[0][0] === 'string' && t[0][0].startsWith('c_')) return t[0][0];
            if (isWireArray(t) && typeof t[0] === 'string' && t[0].startsWith('c_')) return t[0];
        }
    }
    const CONV_ID_STRICT_RE = /^c_[a-zA-Z0-9_-]{8,64}$/;
    let foundId: string | null = null;
    deepWalk(inner, node => {
        if (foundId) return false;
        if (isWireArray(node)) {
            for (const el of node) {
                if (typeof el === 'string' && CONV_ID_STRICT_RE.test(el)) { foundId = el; return false; }
            }
        } else if (isObjectRecord(node)) {
            for (const k in node) {
                const v = node[k];
                if (typeof v === 'string' && CONV_ID_STRICT_RE.test(v)) { foundId = v; return false; }
            }
        }
    });
    return foundId ?? 'c_unknown';
}

export function smartSummarizePrompt(rawText?: string | null): string {
    if (!rawText) return '';
    let s = cleanTitle(rawText).trim();
    s = s.replace(/^(请问一下|请问|我想问一下|我想问|你能帮我|帮我|你能|请教一下|请教|都说|那么|那个|如果说|如果|我发现|为什么)\s*[,，:：]?\s*/i, '');
    const breakMatch = s.match(/^([^，。？！\n\r\t,?!]{4,35})/);
    return breakMatch && breakMatch[1] ? breakMatch[1].trim() : s.slice(0, 30).trim();
}

export function extractConversationTitle(inner: unknown, turns?: unknown[]): TitleResult {
    if (isWireArray(inner)) {
        const sanitizeIfTitle = (val: unknown): string | null => {
            if (typeof val === 'string' && val.length > 0 && !val.startsWith('c_') && !val.startsWith('tC') && !val.startsWith('rc_')) {
                const clean = cleanTitle(val);
                if (isRealTitle(clean)) return clean;
            }
            return null;
        };

        const candidateTitle = extractCandidateValue(inner, GEMINI_JSPB_SCHEMA.INNER.TITLE_CANDIDATES, sanitizeIfTitle);
        if (candidateTitle) return { title: candidateTitle, source: 'rpc' };

        const primary = inner[GEMINI_JSPB_SCHEMA.INNER.TURNS_OR_LIST_PRIMARY];
        if (isWireArray(primary) && typeof primary[1] === 'string') {
            const clean = cleanTitle(primary[1]);
            if (isRealTitle(clean)) return { title: clean, source: 'rpc' };
        }

        const first6Indices = Array.from({ length: Math.min(inner.length, 6) }, (_, i) => i);
        const broadTitle = extractCandidateValue(
            inner,
            first6Indices,
            val => (typeof val === 'string' && val.length >= 2 ? sanitizeIfTitle(val) : null),
        );
        if (broadTitle) return { title: broadTitle, source: 'rpc' };
    }
    if (isWireArray(turns)) {
        for (const t of turns) {
            const t2 = isWireArray(t) ? t[2] : undefined;
            const t20 = isWireArray(t2) ? t2[0] : undefined;
            const uText = isWireArray(t20) ? t20[0] : undefined;
            if (typeof uText === 'string' && uText.trim() && !RESEARCH_PROMPT_PREFIX_RE.test(uText)) {
                const concise = smartSummarizePrompt(uText);
                if (isRealTitle(concise)) return { title: concise, source: 'sniff' };
                const rawClean = cleanTitle(uText.slice(0, 40).trim());
                if (isRealTitle(rawClean)) return { title: rawClean, source: 'sniff' };
            }
        }
    }
    return { title: '未命名对话', source: 'default' };
}
